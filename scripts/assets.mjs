import fs from 'node:fs';
import { PNG } from 'pngjs';

export function readPalette(tokensPath = 'src/tokens.css') {
  const css = fs.readFileSync(tokensPath, 'utf8');
  const out = {};
  for (const m of css.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/* The transparent master is the PNG with colour type 6 and the most fully transparent pixels. */
let masterCache = null;
export function pickMaster(dir = 'brand') {
  if (masterCache) return masterCache;
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    const buf = fs.readFileSync(`${dir}/${f}`);
    if (buf.slice(1, 4).toString() !== 'PNG' || buf[25] !== 6) continue;
    const png = PNG.sync.read(buf);
    let t = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] === 0) t++;
    if (!best || t > best.t) best = { f, t, png };
  }
  if (!best) throw new Error('no RGBA PNG found in brand/');
  masterCache = best;
  return best;
}

export function bbox(png, minAlpha = 16) {
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] > minAlpha) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1 };
}

/* Area-average resize of a square crop in PREMULTIPLIED space, so pure-black transparent pixels
   cannot bleed a dark fringe into the edges. Returns straight (un-premultiplied) RGBA. */
export function resizePremul(png, crop, target) {
  const { x: cx, y: cy, s } = crop;
  const out = new Uint8Array(target * target * 4);
  const scale = s / target;
  for (let ty = 0; ty < target; ty++) {
    const sy0 = cy + ty * scale, sy1 = sy0 + scale;
    for (let tx = 0; tx < target; tx++) {
      const sx0 = cx + tx * scale, sx1 = sx0 + scale;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          const w = wy * (Math.min(x + 1, sx1) - Math.max(x, sx0));
          wsum += w;
          if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
          const i = (y * png.width + x) * 4, al = png.data[i + 3] / 255;
          r += png.data[i] * al * w; g += png.data[i + 1] * al * w; b += png.data[i + 2] * al * w; a += al * w;
        }
      }
      const o = (ty * target + tx) * 4;
      const alpha = a / wsum;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

export function squareCrop(png, margin = 0.06) {
  const b = bbox(png);
  const side = Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  const s = Math.round(side * (1 + margin * 2));
  return { x: Math.round((b.x0 + b.x1 + 1) / 2 - s / 2), y: Math.round((b.y0 + b.y1 + 1) / 2 - s / 2), s };
}

export function toPng(rgba, size) {
  const p = new PNG({ width: size, height: size });
  p.data = Buffer.from(rgba);
  return PNG.sync.write(p, { colorType: 6 });
}

export function flatten(rgba, size, bgHex) {
  const [br, bg, bb] = hexToRgb(bgHex);
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = rgba[i] * a + br * (1 - a); out[i + 1] = rgba[i + 1] * a + bg * (1 - a); out[i + 2] = rgba[i + 2] * a + bb * (1 - a); out[i + 3] = 255;
  }
  return out;
}

/* 32x32 favicon traced from the real pixel grid: premultiplied area average, each cell snapped to the
   nearest palette colour, then merged into rectangles. No comments are emitted in the SVG. */
export function traceFavicon(png, palette) {
  const N = 32;
  const crop = squareCrop(png, 0.03);
  const px = resizePremul(png, crop, N);
  const names = Object.keys(palette);
  const rgbs = names.map((n) => hexToRgb(palette[n]));
  const grid = Array.from({ length: N }, () => new Array(N).fill(null));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    if (px[i + 3] < 115) continue;
    let bi = 0, bd = Infinity;
    rgbs.forEach((c, k) => { const d = (c[0] - px[i]) ** 2 + (c[1] - px[i + 1]) ** 2 + (c[2] - px[i + 2]) ** 2; if (d < bd) { bd = d; bi = k; } });
    grid[y][x] = names[bi];
  }
  // greedy rectangle merge per colour
  const used = Array.from({ length: N }, () => new Array(N).fill(false));
  const paths = {};
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = grid[y][x];
    if (!c || used[y][x]) continue;
    let w = 1;
    while (x + w < N && grid[y][x + w] === c && !used[y][x + w]) w++;
    let h = 1;
    outer: while (y + h < N) {
      for (let k = 0; k < w; k++) if (grid[y + h][x + k] !== c || used[y + h][x + k]) break outer;
      h++;
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) used[y + yy][x + xx] = true;
    (paths[c] ||= []).push(`M${x} ${y}h${w}v${h}h-${w}z`);
  }
  const body = Object.entries(paths).map(([c, d]) => `<path fill="${palette[c]}" d="${d.join('')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${body}</svg>\n`;
}

export { hexToRgb, rgbToHex };

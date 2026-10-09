import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const dir = 'brand';
const out = {};
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function decode(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(1, 4).toString() === 'PNG') {
    const ihdr = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colourType: buf[25], interlace: buf[28] };
    const p = PNG.sync.read(buf);
    return { kind: 'png', ihdr, w: p.width, h: p.height, data: p.data, bytes: buf.length };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { kind: 'jpeg', ihdr: null, w: j.width, h: j.height, data: j.data, bytes: buf.length };
}

function kmeans(px, k = 6, iters = 14) {
  const n = px.length;
  let c = [];
  for (let i = 0; i < k; i++) c.push(px[Math.floor(((i + 0.5) / k) * n)].slice());
  let lab = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const s = c.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let b = 0, bd = 1e18;
      for (let j = 0; j < k; j++) {
        const d = (px[i][0] - c[j][0]) ** 2 + (px[i][1] - c[j][1]) ** 2 + (px[i][2] - c[j][2]) ** 2;
        if (d < bd) { bd = d; b = j; }
      }
      lab[i] = b; s[b][0] += px[i][0]; s[b][1] += px[i][1]; s[b][2] += px[i][2]; s[b][3]++;
    }
    c = c.map((o, j) => (s[j][3] ? [s[j][0] / s[j][3], s[j][1] / s[j][3], s[j][2] / s[j][3]] : o));
  }
  // snap each centroid to nearest real pixel; report coordinate via index
  return c.map((cc, j) => {
    let bi = -1, bd = 1e18, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (lab[i] !== j) continue; cnt++;
      const d = (px[i][0] - cc[0]) ** 2 + (px[i][1] - cc[1]) ** 2 + (px[i][2] - cc[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return { share: cnt / n, idx: bi };
  }).filter((x) => x.idx >= 0).sort((a, b) => b.share - a.share);
}

for (const f of fs.readdirSync(dir)) {
  const file = path.join(dir, f);
  const d = decode(file);
  const { w, h, data } = d;
  const hist = new Array(8).fill(0);
  let pureBlackTransparent = 0, transparent = 0;
  const px = [], coords = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = data[i + 3];
    hist[Math.min(7, a >> 5)]++;
    if (a < 255) transparent++;
    if (a === 0 && data[i] + data[i + 1] + data[i + 2] === 0) pureBlackTransparent++;
    if (a > 200 && x % step === 0 && y % step === 0) { px.push([data[i], data[i + 1], data[i + 2]]); coords.push([x, y]); }
  }
  const km = kmeans(px).map((c) => ({ hex: hex(...px[c.idx]), share: +c.share.toFixed(4), at: coords[c.idx] }));
  out[f] = { kind: d.kind, bytes: d.bytes, ihdr: d.ihdr, size: [w, h], alphaHist8: hist, transparentPx: transparent, pureBlackTransparentPx: pureBlackTransparent, kmeans: km };
  console.log(f, JSON.stringify(out[f]));
}
fs.writeFileSync('scripts/brand-analysis.json', JSON.stringify(out, null, 2));

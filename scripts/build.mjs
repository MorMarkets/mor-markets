import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import { readPalette, pickMaster, squareCrop, resizePremul, toPng, flatten, traceFavicon } from './assets.mjs';
import { renderPage, rpcOriginOf } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function build({ registerFile = path.join(ROOT, 'src/register.json'), outDir = path.join(ROOT, 'dist'), quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const reg = JSON.parse(fs.readFileSync(registerFile, 'utf8'));
  const palette = readPalette(path.join(ROOT, 'src/tokens.css'));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  // logo derivatives (premultiplied resize because the master holds pure-black transparent pixels)
  const prevCwd = process.cwd();
  process.chdir(ROOT);
  const master = pickMaster('brand');
  const crop = squareCrop(master.png, 0.04);
  const write = (name, buf) => fs.writeFileSync(path.join(outDir, name), buf);
  write('logo-72.png', toPng(resizePremul(master.png, crop, 72), 72));
  write('logo-560.png', toPng(resizePremul(master.png, crop, 560), 560));
  write('logo-512.png', toPng(resizePremul(master.png, crop, 512), 512));
  write('apple-touch-icon.png', toPng(flatten(resizePremul(master.png, squareCrop(master.png, 0.14), 180), 180, palette.slate), 180));
  write('favicon.svg', traceFavicon(master.png, palette));
  process.chdir(prevCwd);
  log('logo master:', master.f);

  // bundle
  const res = await esbuild.build({
    entryPoints: { app: path.join(ROOT, 'src/js/main.js') },
    outdir: path.join(outDir, 'assets'),
    entryNames: '[name]-[hash]',
    bundle: true, minify: true, format: 'esm', metafile: true, legalComments: 'none',
    target: ['chrome111', 'safari16.4', 'firefox113'], logLevel: 'warning'
  });
  const outs = Object.keys(res.metafile.outputs).map((p) => path.basename(p));
  const js = outs.find((f) => f.endsWith('.js'));
  const css = outs.find((f) => f.endsWith('.css'));

  const html = renderPage(reg, { js, css, logoSmall: 'logo-72.png', logoLarge: 'logo-560.png', ogImage: 'logo-512.png', apple: 'apple-touch-icon.png', themeColor: palette.ink });
  write('index.html', html);

  const rpc = rpcOriginOf(reg);
  const connect = ["'self'", rpc, 'https://api.dexscreener.com'].filter(Boolean).join(' ');
  write('_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src ${connect}; base-uri 'self'; form-action 'none'; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);
  log('built ->', outDir, `(${js}, ${css})`);
  return { outDir, js, css };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build({ registerFile: process.env.REGISTER_FILE || undefined, outDir: process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : undefined })
    .catch((e) => { console.error(e); process.exit(1); });
}

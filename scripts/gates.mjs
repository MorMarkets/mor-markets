import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { build } from './build.mjs';
import { readPalette, resizePremul } from './assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const read = (f) => fs.readFileSync(f, 'utf8');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const results = [];
async function gate(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  PASS  ' + name); }
  catch (e) { results.push({ name, ok: false, why: e.message }); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const mustThrow = (fn, msg) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error(msg); };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- pure checkers (reused by the mutation harness) ---------- */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const hexes = (text) => (text.match(HEX_RE) || []).map((h) => h.toLowerCase());

function checkRegister(reg) {
  ok(reg && Array.isArray(reg.records) && reg.records.length > 0, 'register has no records');
  const ids = new Set();
  for (const r of reg.records) {
    ok(typeof r.id === 'string' && !ids.has(r.id), 'duplicate or missing id ' + r.id);
    ids.add(r.id);
    ok(['stated', 'absent', 'unconfirmed'].includes(r.state), `${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated') ok(r.value === null && r.url === null, `${r.id}: inert record carries value/url`);
    else ok(r.value !== null || r.url !== null, `${r.id}: stated record is empty`);
  }
}

function checkPaletteScan(files, allowedFile) {
  const bad = [];
  for (const [f, text] of Object.entries(files)) {
    if (f === allowedFile) continue;
    const found = hexes(text);
    if (found.length) bad.push(f + ': ' + [...new Set(found)].join(','));
  }
  ok(!bad.length, 'colour literals outside the tokens file -> ' + bad.join(' | '));
}

function checkFavicon(svg, palette) {
  ok(/^<svg[^>]*\bwidth="32"[^>]*\bheight="32"/.test(svg), 'favicon is not 32x32');
  ok(/viewBox="0 0 32 32"/.test(svg), 'favicon viewBox is not 0 0 32 32');
  ok(!svg.includes('--'), 'favicon contains a double hyphen');
  ok(!svg.includes('<!--'), 'favicon contains an XML comment');
  const allowed = new Set(Object.values(palette));
  for (const h of hexes(svg)) ok(allowed.has(h), 'favicon colour not in palette: ' + h);
  ok((svg.match(/<path /g) || []).length >= 2, 'favicon has too few shapes');
}

function checkNoCh(css) { ok(!/(?:^|[^\w.-])-?\d*\.?\d+ch\b/.test(css), 'ch unit found'); }

const ADDR_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])|\b0x[0-9a-fA-F]{40}\b|\b[0-9a-fA-F]{64}\b/g;
/* Address-shaped strings are matched against the stated registry only; nothing is rejected on shape alone. */
function checkAddressScan(files, reg) {
  const statedValues = new Set(reg.records.filter((r) => r.state === 'stated' && r.value).map((r) => r.value));
  const stray = [];
  for (const [f, text] of Object.entries(files)) {
    for (const m of text.matchAll(ADDR_RE)) {
      if (statedValues.has(m[0])) continue;
      stray.push(f + ': ' + m[0].slice(0, 14) + '...');
    }
  }
  ok(!stray.length, 'address-shaped strings not in the stated registry -> ' + stray.slice(0, 4).join(' | '));
}

const words = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\b([a-z0-9-]+)\.([a-z]{2,})\b/g, '$1_$2').match(/[a-z0-9_']+/g) || [];
const bigrams = (line) => { const w = words(line); const out = []; for (let i = 0; i < w.length - 1; i++) out.push(w[i] + ' ' + w[i + 1]); return out; };
function visibleCopy(html, js) {
  const ent = { '&ldquo;': '"', '&rdquo;': '"', '&rsquo;': "'", '&amp;': '&', '&nbsp;': ' ', '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
  const lines = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<\/?(?:div|p|section|h\d|li|dt|dd|a|button|span|nav|header|footer|label|kbd|article|main|b|em|small|i)\b[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&[#a-z0-9]+;/g, (e) => ent[e] || ' ').split('\n');
  const attrs = [...html.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)].map((m) => m[1]);
  const strs = [...js.matchAll(/'([^'\\\n]{12,}?)'|"([^"\\\n]{12,}?)"/g)].map((m) => m[1] || m[2]).filter((s) => /\s/.test(s) && !/[<>{}=;]/.test(s));
  return [...lines, ...attrs, ...strs].map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function checkTwoGrams(copyLines, corpusText) {
  const ref = new Set(corpusText.split('\n').flatMap(bigrams));
  const hit = [];
  for (const l of copyLines) for (const g of bigrams(l)) if (ref.has(g)) hit.push(g);
  ok(!hit.length, 'shared 2-grams with the reference -> ' + [...new Set(hit)].slice(0, 8).join(' | '));
}

function checkInertNoHref(html, reg) {
  const inertIds = reg.records.filter((r) => r.state !== 'stated').map((r) => r.id);
  for (const id of inertIds) {
    const re = new RegExp(`<a\\b[^>]*aria-label="[^"]*\\b${id}\\b[^"]*"[^>]*href=|<a\\b[^>]*href="[^"]*"[^>]*aria-label="[^"]*\\b${id}\\b`, 'i');
    ok(!re.test(html), `inert record ${id} rendered a link`);
  }
  for (const m of html.matchAll(/<(a|span)\b[^>]*data-inert="true"[^>]*>/g)) ok(m[1] === 'span' && !/href=/.test(m[0]), 'inert icon carries an href');
}

/* ---------- build helpers ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-gates-'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const TEXT = /\.(html|css|js|svg|json|txt|mjs|md)$|_headers$/;
function distText(dir) { return Object.fromEntries(walk(dir).filter((f) => TEXT.test(f)).map((f) => [path.relative(dir, f), read(f)])); }
function srcText() {
  const files = {};
  for (const d of ['src', 'scripts']) for (const f of walk(rel(d))) if (/\.(css|js|mjs|json|html)$/.test(f) && !/brand-analysis\.json$/.test(f)) files[path.relative(ROOT, f).replaceAll('\\', '/')] = read(f);
  return files;
}
const randomAddr = () => Array.from(crypto.randomBytes(44), (b) => B58[b % 58]).join('');
const between = (s, a, b) => { const i = s.indexOf(a); return s.slice(i, s.indexOf(b, i)); };

/* ---------- run ---------- */
console.log('MOR gates\n');
const liveReg = JSON.parse(read(rel('src/register.json')));
const palette = readPalette(rel('src/tokens.css'));
const absentDir = path.join(tmp, 'absent');
const statedDir = path.join(tmp, 'stated');

await build({ outDir: absentDir, quiet: true });
// stated branch: the CA becomes stated with a freshly generated address; GitHub becomes stated from the X handle
const statedReg = JSON.parse(JSON.stringify(liveReg));
const handle = new URL(liveReg.records.find((r) => r.id === 'x').url).pathname.split('/').filter(Boolean)[0];
const testCa = randomAddr();
for (const r of statedReg.records) {
  if (r.id === 'ca') { r.state = 'stated'; r.value = testCa; r.url = null; }
  if (r.id === 'github') { r.state = 'stated'; r.value = null; r.url = 'https://github.com/' + handle; }
}
const statedFile = path.join(tmp, 'register.stated.json');
fs.writeFileSync(statedFile, JSON.stringify(statedReg));
await build({ registerFile: statedFile, outDir: statedDir, quiet: true });

const A = distText(absentDir), S_ = distText(statedDir);
const aHtml = A['index.html'], sHtml = S_['index.html'];
const aJsName = Object.keys(A).find((k) => /^assets[\\/].*\.js$/.test(k));
const aCssName = Object.keys(A).find((k) => /^assets[\\/].*\.css$/.test(k));
const src = srcText();
const tokensText = src['src/tokens.css'];
const toolsOf = (html) => between(html, '<div class="tools"', '</header>');

console.log('Registry and hygiene');
await gate('register: schema holds, inert records carry null value and null url', () => checkRegister(liveReg));
await gate('register: stated-branch register is also schema-valid', () => checkRegister(statedReg));
await gate('hygiene: no CLAUDE.md, no .claude folder anywhere', () => {
  const bad = walk(ROOT).filter((f) => !f.includes('node_modules')).map((f) => path.relative(ROOT, f)).filter((f) => /(^|[\\/])CLAUDE\.md$/i.test(f) || /(^|[\\/])\.claude([\\/]|$)/.test(f));
  ok(!bad.length, 'forbidden: ' + bad.join(', '));
});
await gate('hygiene: no AI attribution strings in the repo', () => {
  const needle = new RegExp(['Co-Auth' + 'ored', 'Generated (?:with|by)', 'Cla' + 'ude', 'Anthr' + 'opic', 'ChatG' + 'PT', 'Open' + 'AI', 'Copi' + 'lot', 'AI-generated'].join('|'), 'i');
  const bad = [];
  for (const f of walk(ROOT)) {
    if (f.includes('node_modules') || !TEXT.test(f) || /package-lock\.json$/.test(f)) continue;
    if (path.resolve(f) === path.resolve(fileURLToPath(import.meta.url))) continue;
    if (needle.test(read(f))) bad.push(path.relative(ROOT, f));
  }
  ok(!bad.length, 'attribution text in: ' + bad.join(', '));
});

console.log('\nPalette');
await gate('palette: colour literals live in src/tokens.css only (src + scripts)', () => checkPaletteScan(src, 'src/tokens.css'));
await gate('palette: every token is a real pixel of a brand/ PNG (alpha >= 200)', () => {
  const want = new Map(Object.entries(palette).map(([n, h]) => [parseInt(h.slice(1), 16), n]));
  const found = new Set();
  for (const f of fs.readdirSync(rel('brand'))) {
    const buf = fs.readFileSync(rel('brand', f));
    if (buf.slice(1, 4).toString() !== 'PNG') continue;
    const p = PNG.sync.read(buf);
    for (let i = 0; i < p.data.length && found.size < want.size; i += 4) {
      if (p.data[i + 3] < 200) continue;
      const k = (p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2];
      if (want.has(k)) found.add(k);
    }
  }
  for (const [k, n] of want) ok(found.has(k), `--${n} is not a pixel of any brand PNG`);
});
await gate('palette: every colour in dist (html, css, js, svg) belongs to the token set', () => {
  const allowed = new Set(Object.values(palette));
  for (const [f, t] of Object.entries(A)) for (const h of hexes(t)) ok(allowed.has(h), `${f}: ${h} is not a token`);
});
await gate('palette: tokens file records provenance and a pixel coordinate for every token', () => {
  for (const name of Object.keys(palette)) ok(new RegExp('--' + name + '\\s+.*\\(\\d+,\\d+\\)').test(tokensText), `--${name} has no pixel coordinate comment`);
  ok(/k-means/i.test(tokensText), 'k-means provenance missing');
});

console.log('\nAssets');
await gate('favicon: 32x32 SVG, palette-only, no comments, no double hyphen', () => checkFavicon(A['favicon.svg'], palette));
await gate('favicon: linked from the page', () => ok(/rel="icon"[^>]*favicon\.svg/.test(aHtml), 'no icon link'));
await gate('assets: logo derivatives are RGBA (colour type 6) and keep real transparency', () => {
  for (const f of ['logo-72.png', 'logo-560.png', 'logo-512.png']) {
    const buf = fs.readFileSync(path.join(absentDir, f));
    ok(buf[25] === 6, f + ' is not colour type 6');
    const p = PNG.sync.read(buf);
    let clear = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) clear++;
    ok(clear > 0, f + ' lost its transparency');
  }
});
await gate('assets: premultiplied resize leaves no dark fringe (white card beside pure-black transparent)', () => {
  const N = 64, png = { width: N, height: N, data: new Uint8Array(N * N * 4) };
  for (let y = 0; y < N; y++) for (let x = 0; x < 29; x++) { const i = (y * N + x) * 4; png.data[i] = png.data[i + 1] = png.data[i + 2] = 255; png.data[i + 3] = 255; }
  const out = resizePremul(png, { x: 0, y: 0, s: N }, 10);
  let edge = 0;
  for (let i = 0; i < out.length; i += 4) if (out[i + 3] > 0) { ok(out[i] >= 254 && out[i + 1] >= 254 && out[i + 2] >= 254, 'grey fringe pixel ' + out[i]); if (out[i + 3] < 255) edge++; }
  ok(edge > 0, 'test card produced no partial-alpha edge');
});

console.log('\nBranch A: contract address absent');
await gate('absent: CA slot is inside the sticky top bar, above main, flagged absent', () => {
  const topAt = aHtml.indexOf('class="top"'), caAt = aHtml.indexOf('id="ca"'), mainAt = aHtml.indexOf('<main');
  ok(topAt > -1 && caAt > topAt && caAt < mainAt, 'CA slot is not above main inside .top');
  ok(/id="ca" data-state="absent"/.test(aHtml), 'CA slot not marked absent');
});
await gate('absent: CA control is disabled and carries no copy payload', () => {
  const slot = between(aHtml, 'id="ca"', '</section>');
  ok(/<button[^>]*disabled/.test(slot), 'CA button not disabled');
  ok(!/data-copy/.test(slot), 'inert CA carries data-copy');
});
await gate('absent: no address-shaped string in dist or source', () => {
  checkAddressScan(A, liveReg);
  checkAddressScan(Object.fromEntries(Object.entries(src).filter(([f]) => f !== 'src/register.json')), liveReg);
});
await gate('absent: inert records render with no href (GitHub icon is a span)', () => checkInertNoHref(aHtml, liveReg));
await gate('absent: GitHub icon present in the header, inert, no github url in html', () => {
  ok(/data-inert="true"[^>]*aria-label="GitHub/.test(toolsOf(aHtml)), 'inert GitHub icon missing from header');
  ok(!/github\.com/.test(aHtml.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), 'github url leaked into html');
});

console.log('\nBranch B: contract address stated');
await gate('stated: CA slot shows the full stated address', () => {
  const ca = statedReg.records.find((r) => r.id === 'ca').value;
  ok(/id="ca" data-state="stated"/.test(sHtml), 'slot not marked stated');
  ok(sHtml.includes(`<span class="ca-full">${ca}</span>`), 'full address not rendered');
});
await gate('stated: CA control is enabled and copies exactly the register value', () => {
  const ca = statedReg.records.find((r) => r.id === 'ca').value;
  const slot = between(sHtml, 'id="ca"', '</section>');
  ok(!/<button[^>]*disabled/.test(slot), 'CA button still disabled');
  ok(slot.includes(`data-copy="${ca}"`), 'copy payload differs from register value');
});
await gate('stated: address scanner passes with the CA exempt', () => checkAddressScan(S_, statedReg));
await gate('stated: GitHub icon becomes a real link to the register url', () => {
  const g = statedReg.records.find((r) => r.id === 'github').url;
  ok(new RegExp(`<a class="ico" href="${reEsc(g)}"`).test(sHtml), 'GitHub link missing');
  checkInertNoHref(sHtml, statedReg);
});
await gate('stated: X link equals the register url in both branches', () => {
  const x = liveReg.records.find((r) => r.id === 'x');
  for (const html of [aHtml, sHtml]) ok(html.includes(`href="${x.url}"`), 'X href mismatch');
});

console.log('\nSocial icons');
await gate('social: X and GitHub icons sit in the header, icon only, official marks', () => {
  for (const html of [aHtml, sHtml]) {
    const head = toolsOf(html);
    ok(/viewBox="0 0 24 24"[^>]*><path d="M18\.244 2\.25h3\.308/.test(head), 'official X mark missing');
    ok(/viewBox="0 0 16 16"[^>]*><path d="M8 0c4\.42 0 8 3\.58 8 8a8\.013/.test(head), 'official GitHub Octicon missing');
    const text = head.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    ok(text === '', 'header icons carry visible text: ' + text);
  }
});
await gate('social: no breakpoint hides the icons', () => {
  const css = A[aCssName];
  ok(!/\.ico\{[^}]*display:none/.test(css.replace(/\s+/g, '')) && !/\.tools\{[^}]*display:none/.test(css.replace(/\s+/g, '')), 'icons hidden by css');
});

console.log('\nLive data wiring');
await gate('live: RPC url comes from the register, never a literal in src/js', () => {
  const js = Object.entries(src).filter(([f]) => f.startsWith('src/js/')).map(([, t]) => t).join('\n');
  ok(!/solana-rpc\.publicnode\.com/.test(js), 'RPC url hardcoded in js');
  ok(/reg\.url\('rpc'\)/.test(js), 'js does not read the rpc record');
  ok(/getBlockHeight/.test(js) && /commitment:\s*'confirmed'/.test(js), 'confirmed block height call missing');
  ok(/\[\s*\{ jsonrpc[\s\S]*getSlot/.test(src['src/js/feeds.js']), 'height and slot are not sent as one batch');
});
await gate('live: block height polls every 2000 ms and counts up between polls', () => {
  const main = src['src/js/main.js'];
  ok(/every:\s*2000/.test(main), '2s poll missing');
  ok(/chain\.rate/.test(main) && /performance\.now\(\)/.test(main), 'count-up estimator missing');
});
await gate('live: DexScreener search q=mor, Solana filter, logo from info.imageUrl', () => {
  const f = src['src/js/feeds.js'];
  ok(/api\.dexscreener\.com\/latest\/dex\/search\?q=/.test(f) && /readPairs\('mor'\)/.test(src['src/js/main.js']), 'search call missing');
  ok(/chainId === 'solana'/.test(f) && /info\.imageUrl/.test(f), 'solana filter or imageUrl missing');
});
await gate('live: exponential backoff on every poller', () => {
  const f = src['src/js/feeds.js'], m = src['src/js/main.js'];
  ok(/Math\.pow\(2, fails\)/.test(f), 'no doubling in poller');
  ok((m.match(/poller\(\{/g) || []).length === 2, 'expected exactly two pollers, both through poller()');
  ok(!/setInterval\([^)]*fetch/.test(m), 'raw interval fetch bypasses backoff');
});
await gate('live: skeleton, dash and error-message paths exist', () => {
  const m = src['src/js/main.js'], c = A[aCssName];
  ok(/data-state/.test(aHtml) && /\.skeleton/.test(c) && /shimmer/.test(c), 'skeleton css missing');
  ok(/DASH/.test(m) && /data-err/.test(aHtml) && /setErr\('chain'/.test(m) && /setErr\('dex'/.test(m), 'dash or error message path missing');
});
await gate('live: copy-per-address button and toast on every copy', () => {
  const m = src['src/js/main.js'];
  ok(/data-copy/.test(m) && /toast\('Copied/.test(m), 'copy handler missing');
});

console.log('\nMotion');
await gate('motion: prefers-reduced-motion CSS fallback kills animation and transition', () => {
  const c = A[aCssName];
  ok(/prefers-reduced-motion:\s*reduce/.test(c), 'media query missing');
  const block = c.slice(c.indexOf('prefers-reduced-motion'));
  ok(/animation:\s*none/.test(block) && /transition:\s*none/.test(block), 'reduced block does not zero animation and transition');
});
await gate('motion: every JS animation path checks reduced() (per function)', () => {
  const mo = src['src/js/motion.js'];
  for (const fn of ['reveal', 'initReveal', 'flash', 'setNumber', 'initSpotlight', 'initParallax']) {
    const at = mo.indexOf('export function ' + fn + '(');
    ok(at > -1, fn + ' missing');
    const next = mo.indexOf('\nexport function', at + 10);
    ok(/reduced\(\)/.test(mo.slice(at, next < 0 ? undefined : next)), fn + ' ignores reduced motion');
  }
  ok((src['src/js/main.js'].match(/reduced\(\)/g) || []).length >= 5, 'main.js has too few reduced() guards');
  ok(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(src['src/js/util.js']), 'matchMedia probe missing');
});
await gate('motion: spring reveal, parallax, spotlight, progress bar, pulsing status pill wired', () => {
  const mo = src['src/js/motion.js'], ma = src['src/js/main.js'];
  ok(/stiffness/.test(mo) && /linear\(/.test(mo), 'spring easing missing');
  ok(/initParallax\(\)/.test(ma) && /initSpotlight\(\)/.test(ma) && /initProgress\(\)/.test(ma) && /initReveal\(\)/.test(ma), 'init calls missing');
  ok(/class="progress"/.test(aHtml) && /id="pill"/.test(aHtml) && /@keyframes ping/.test(A[aCssName]), 'progress bar or pulsing pill missing');
});
await gate('motion: count-up with flash on value change', () => ok(/export function setNumber/.test(src['src/js/motion.js']) && /flash\(el/.test(src['src/js/motion.js']), 'setNumber/flash missing'));

console.log('\nMeasurement rules');
await gate('units: no ch units in source css or built css', () => { checkNoCh(src['src/styles.css']); checkNoCh(A[aCssName]); });
await gate('tap targets: every interactive selector sets a 44px minimum', () => {
  const rules = [...src['src/styles.css'].matchAll(/(?:^|\n)([^{}@\n][^{}]*)\{([^}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((s) => s.trim()), body: m[2] }));
  for (const sel of ['.brand', '.nav a', '.ico', '.ca-btn', '.pill', '.btn', '.tab', '.search', '.seg button', '.dd-btn', '.dd-list button', '.foot-links a']) {
    ok(rules.some((r) => r.sels.includes(sel) && /(?:min-)?(?:height|width):\s*44px/.test(r.body)), 'no 44px size on ' + sel);
  }
});
await gate('csp: no inline script, style attribute or event handler in html or js templates', () => {
  const body = aHtml.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  ok(!/\sstyle="/.test(body) && !/\son[a-z]+="/.test(body) && !/<script(?![^>]*\bsrc=)/.test(body), 'inline code found in html');
  ok(!/style="/.test(src['src/js/main.js']), 'inline style attribute in js template');
});
await gate('deploy: dist/ holds index, favicon, bundles, touch icon and headers', () => {
  for (const f of ['index.html', 'favicon.svg', '_headers', 'apple-touch-icon.png']) ok(fs.existsSync(path.join(absentDir, f)), f + ' missing');
  ok(aJsName && aCssName, 'bundles missing');
});

console.log('\nCopy');
await gate('copy: zero 2-grams shared with the reference site or brand captions', () => {
  const lines = visibleCopy(aHtml, src['src/js/main.js'] + '\n' + src['src/js/feeds.js']);
  ok(lines.length > 30, 'copy extraction too small');
  checkTwoGrams(lines, read(rel('scripts/reference-corpus.txt')));
});

console.log('\nMutation harness (anchors read from live state at runtime)');
await gate('mutation: giving any inert record a value or url is caught by the schema gate', () => {
  const m = JSON.parse(JSON.stringify(liveReg));
  const inert = m.records.find((r) => r.state !== 'stated');
  ok(inert, 'no inert record to mutate');
  inert.value = 'x' + inert.id;
  mustThrow(() => checkRegister(m), 'schema gate missed an inert record with a value');
  const m2 = JSON.parse(JSON.stringify(liveReg));
  m2.records.find((r) => r.state !== 'stated').url = 'https://example.invalid/' + inert.id;
  mustThrow(() => checkRegister(m2), 'schema gate missed an inert record with a url');
});
await gate('mutation: a colour literal added to any non-token file is caught', () => {
  const victim = Object.keys(src).find((f) => f !== 'src/tokens.css' && f.endsWith('.css'));
  const copy = { ...src, [victim]: src[victim] + '\n.x{color:' + palette[Object.keys(palette)[0]] + '}' };
  mustThrow(() => checkPaletteScan(copy, 'src/tokens.css'), 'palette scan missed an injected literal');
});
await gate('mutation: an href on the inert social icon is caught', () => {
  const m = aHtml.match(/<span class="ico" role="img" data-inert="true"/);
  ok(m, 'no inert icon to mutate');
  mustThrow(() => checkInertNoHref(aHtml.replace(m[0], '<a class="ico" href="https://example.invalid/x" data-inert="true"'), liveReg), 'inert-href gate missed the mutation');
});
await gate('mutation: a stray random address is caught, the stated CA is not (base58 and 0x)', () => {
  mustThrow(() => checkAddressScan({ ...S_, 'index.html': sHtml + '\n<p>' + randomAddr() + '</p>' }, statedReg), 'scanner missed a stray address');
  checkAddressScan(S_, statedReg);
  const evm = '0x' + crypto.randomBytes(20).toString('hex');
  mustThrow(() => checkAddressScan({ 'index.html': '<p>' + evm + '</p>' }, liveReg), 'scanner missed an 0x address');
  checkAddressScan({ 'index.html': '<p>' + evm + '</p>' }, { records: [{ id: 'z', state: 'stated', value: evm, url: null }] });
});
await gate('mutation: a comment, double hyphen or wrong size inside the favicon is caught', () => {
  const svg = A['favicon.svg'];
  mustThrow(() => checkFavicon(svg.replace('<path', '<!-- a--b --><path'), palette), 'favicon comment missed');
  mustThrow(() => checkFavicon(svg.replace('width="32"', 'width="31"'), palette), 'favicon size missed');
});
await gate('mutation: a bigram lifted from the reference corpus is caught', () => {
  const corpus = read(rel('scripts/reference-corpus.txt'));
  const g = corpus.split('\n').flatMap(bigrams)[0];
  ok(g, 'no bigram in corpus');
  mustThrow(() => checkTwoGrams(['Totally original line with ' + g + ' inside'], corpus), '2-gram gate missed the lifted bigram');
});
await gate('mutation: a ch unit is caught', () => mustThrow(() => checkNoCh(A[aCssName] + '.a{width:12ch}'), 'ch gate missed 12ch'));

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);

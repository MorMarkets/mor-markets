// Static shell. Every external fact comes from the register; inert records emit no href and no value.
const X_MARK = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_MARK = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const handleOf = (url) => {
  try { const p = new URL(url).pathname.split('/').filter(Boolean)[0]; return p ? '@' + p : null; } catch { return null; }
};

const live = (key, extra = '') => `<span class="live" data-live="${key}" data-state="loading"><i class="sk"></i><span class="val"></span></span>${extra}`;

function hexRings() {
  const poly = (r) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return (100 + r * Math.cos(a)).toFixed(1) + ',' + (100 + r * Math.sin(a)).toFixed(1);
  }).join(' ');
  return [92, 74, 56, 38].map((r) => `<polygon points="${poly(r)}"/>`).join('');
}

export function renderPage(reg, assets) {
  const rec = Object.fromEntries(reg.records.map((r) => [r.id, r]));
  const stated = (id) => rec[id] && rec[id].state === 'stated';
  const url = (id) => (stated(id) ? rec[id].url : null);

  const ca = stated('ca') && rec.ca.value ? rec.ca.value : null;
  const caShort = ca ? ca.slice(0, 6) + '\u2026' + ca.slice(-6) : null;
  const xUrl = url('x');
  const ghUrl = url('github');
  const domain = url('domain') ? new URL(url('domain')).host : null;
  const rpcOrigin = url('rpc') ? new URL(url('rpc')).origin : null;

  const caSlot = ca
    ? `<section class="ca" id="ca" data-state="stated" aria-label="Contract address">
  <div class="ca-in"><span class="ca-label">CA</span>
    <button class="ca-btn spot" type="button" data-copy="${esc(ca)}" aria-label="Copy contract address">
      <span class="ca-full">${esc(ca)}</span><span class="ca-short" aria-hidden="true">${esc(caShort)}</span><span class="ca-act">Copy</span>
    </button></div></section>`
    : `<section class="ca" id="ca" data-state="absent" aria-label="Contract address">
  <div class="ca-in"><span class="ca-label">CA</span>
    <button class="ca-btn" type="button" disabled aria-disabled="true" aria-label="Contract address not announced yet. This slot unlocks when one is published." title="Unlocks the moment an address is published">
      <span class="ca-full">Not announced yet</span><span class="ca-act">Locked</span>
    </button></div></section>`;

  const xLink = xUrl
    ? `<a class="ico" href="${esc(xUrl)}" target="_blank" rel="noopener noreferrer" aria-label="MOR on X, ${esc(handleOf(xUrl) || '')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${X_MARK}"/></svg></a>`
    : `<span class="ico" role="img" data-inert="true" aria-disabled="true" aria-label="X, not published yet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${X_MARK}"/></svg></span>`;
  const ghLink = ghUrl
    ? `<a class="ico" href="${esc(ghUrl)}" target="_blank" rel="noopener noreferrer" aria-label="MOR on GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GH_MARK}"/></svg></a>`
    : `<span class="ico" role="img" data-inert="true" aria-disabled="true" aria-label="GitHub, not published yet"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GH_MARK}"/></svg></span>`;

  const footX = xUrl ? `<a href="${esc(xUrl)}" target="_blank" rel="noopener noreferrer">X ${esc(handleOf(xUrl) || '')}</a>` : `<span aria-disabled="true">X, soon</span>`;
  const footGh = ghUrl ? `<a href="${esc(ghUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : `<span aria-disabled="true">GitHub, soon</span>`;

  const caNote = ca
    ? 'The only contract address MOR stands behind is the one pinned at the very top of this page. Copy it from there, never from a reply or a private message.'
    : 'MOR has not announced a contract address yet. The slot at the top stays locked until it does, so treat any address that reaches you some other way as unverified.';
  const caTile = ca
    ? 'The bar above carries the one published address. A click copies it whole and confirms with a toast.'
    : 'One address bar sits above everything. It is locked today and opens the moment an address is published.';

  const rv = (i = 0) => `rv`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MOR | Live Solana Market Board</title>
<meta name="description" content="MOR reads the confirmed Solana chain tip and every public listing it can find, live, with nothing typed in by hand.">
<meta name="theme-color" content="${assets.themeColor}">
<meta property="og:title" content="MOR | Live Solana Market Board">
<meta property="og:description" content="Confirmed chain tip and public Solana listings, live, straight from the sources.">
<meta property="og:type" content="website">
${domain ? `<meta property="og:url" content="https://${esc(domain)}/">\n<meta property="og:image" content="https://${esc(domain)}/${assets.ogImage}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="32x32">
<link rel="apple-touch-icon" href="/${assets.apple}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Graduate&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/${assets.css}">
<script type="application/json" id="register">${JSON.stringify(reg).replace(/</g, '\\u003c')}</script>
<script type="module" src="/assets/${assets.js}"></script>
</head>
<body>
<div class="progress" aria-hidden="true"><i></i></div>

<div class="top">
  <header class="wrap bar">
    <a class="brand" href="#top" aria-label="MOR, back to top"><img src="/${assets.logoSmall}" width="36" height="36" alt=""><b>MOR</b></a>
    <nav class="nav" aria-label="Sections"><a href="#pairs">Pairs</a><a href="#wiring">Feed</a><a href="#ca">Contract</a></nav>
    <div class="tools">
      <button class="ico menu-btn" id="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      ${xLink}
      ${ghLink}
    </div>
  </header>
  <nav class="menu" id="menu" data-open="false" aria-label="Sections"><a href="#pairs">Pairs</a><a href="#wiring">Feed</a><a href="#ca">Contract</a></nav>
  ${caSlot}
</div>

<main id="top">
<div class="wrap">
  <section class="hero">
    <div>
      <a class="pill rv" id="pill" data-health="warn" href="#wiring"><i class="dot"></i><span id="pill-text">Reaching Solana</span></a>
      <h1 class="rv">Prices <em>bolted</em> onto the chain.</h1>
      <p class="lede rv">MOR reads Solana directly and lines up every public listing it can find. No hand-typed figures, and no placeholders passing as data.</p>
      <div class="cta rv"><a class="btn solid spot" href="#pairs">See live pairs</a><a class="btn spot" href="#wiring">Inspect the wiring</a></div>
      <dl class="stats rv">
        <div><dt>Confirmed height</dt><dd>${live('height')}</dd></div>
        <div><dt>Confirmed slot</dt><dd>${live('slot')}</dd></div>
        <div><dt>Pairs found</dt><dd>${live('pairs')}</dd></div>
      </dl>
      <span class="err" data-err="chain" role="status"></span>
    </div>
    <div class="side">
      <div class="stage rv" aria-hidden="true">
        <div class="layer glow" data-depth="0.2"></div>
        <div class="layer grid" data-depth="0.45"><svg viewBox="0 0 200 200">${hexRings()}</svg></div>
        <div class="layer nut" data-depth="0.9"><img src="/${assets.logoLarge}" alt="" width="280" height="280"></div>
        <span class="tag">MOR / FIELD UNIT</span>
      </div>
      <div class="console rv spot" role="group" aria-label="Chain feed readout">
        <header><span>mor@feed: ~/tip</span><span>batch \u00b7 confirmed</span></header>
        <div class="rows">
          <div class="row"><span>node</span><span class="live" data-live="rpc" data-state="loading"><i class="sk"></i><span class="val"></span></span></div>
          <div class="row"><span>level</span><span>confirmed</span></div>
          <div class="row"><span>height</span>${live('height')}</div>
          <div class="row"><span>slot</span>${live('slot')}</div>
          <div class="row"><span>round trip</span>${live('rtt')}</div>
          <div class="row"><span>refreshed</span>${live('age')}</div>
        </div>
        <footer><span>[ .. ] waiting on a fresh block</span><b aria-hidden="true"></b></footer>
      </div>
    </div>
  </section>
</div>

<div class="marquee rv" id="marquee" data-state="loading" aria-label="Tokens returned by the market search">
  <div class="skel-row" aria-hidden="true"></div>
  <div class="track-host"></div>
  <p class="msg" role="status"></p>
</div>

<div class="wrap">
  <section class="block" id="pairs">
    <div class="tabs">
      <div class="tablist" role="tablist" id="tabs" aria-label="Pair filter">
        <button class="tab" role="tab" aria-selected="true" data-tab="all" title="Every Solana pair the search returned">Everything</button>
        <button class="tab" role="tab" aria-selected="false" tabindex="-1" data-tab="up" title="Pairs that rose over the last day">Climbing</button>
        <button class="tab" role="tab" aria-selected="false" tabindex="-1" data-tab="down" title="Pairs that fell over the last day">Sliding</button>
      </div>
      <p class="tab-hint">Solana pairs matching the word &ldquo;mor&rdquo;</p>
    </div>
    <div class="controls">
      <div class="find">
        <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sr">Search pairs</span><input id="q" type="search" placeholder="Find by name, symbol or mint" autocomplete="off" spellcheck="false" maxlength="64"><kbd aria-hidden="true">/</kbd></label>
        <span class="status" id="status-dot-wrap" data-health="warn" title="Market source status"><i class="dot"></i><span id="status-text">connecting</span></span>
      </div>
      <div class="opts">
        <div class="seg" id="sort" role="group" aria-label="Sort by"><button type="button" data-sort="vol" aria-pressed="true">Volume</button><button type="button" data-sort="liq" aria-pressed="false">Depth</button><button type="button" data-sort="chg" aria-pressed="false">Move</button><button type="button" data-sort="new" aria-pressed="false">Newest</button></div>
        <div class="dd"><button class="dd-btn" id="qdd-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span>Quote</span><span id="qdd-label">All quotes</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="dd-list" id="qdd-list" role="listbox" hidden></div></div>
        <div class="seg" id="depth" role="group" aria-label="Pool size"><button type="button" data-depth="all" aria-pressed="true">Any size</button><button type="button" data-depth="deep" aria-pressed="false">$10K+ pools</button></div>
      </div>
    </div>
    <span class="err" data-err="dex" role="status"></span>
    <div class="cards" id="cards" aria-live="polite"></div>
    <div class="more" id="more" hidden><button class="btn spot" type="button">Show more pairs</button></div>
    <p class="note">This list is a public search for the word &ldquo;mor&rdquo;, so it holds tokens that have no tie to this project. Appearing here is not an endorsement. ${esc(caNote)}</p>
  </section>

  <section class="block" id="wiring">
    <h2 class="sect-title rv">Under the hood</h2>
    <p class="sect-sub rv">Four moving parts, every one of them visible in your browser&rsquo;s network tab.</p>
    <div class="tiles">
      <article class="tile spot rv"><span class="n">01</span><h3>Chain tip</h3><p>One batched call to a public Solana node asks for the confirmed block height and slot. It repeats every two seconds. The counter estimates forward between answers, then lands on the node&rsquo;s own figure.</p></article>
      <article class="tile spot rv"><span class="n">02</span><h3>Market scan</h3><p>A DexScreener search runs every thirty seconds. Only Solana pairs survive the filter, and each logo, price and volume figure is passed through untouched.</p></article>
      <article class="tile spot rv"><span class="n">03</span><h3>Patient retries</h3><p>When a source stalls, the pause ahead of each retry doubles up to a ceiling. Tiles flip to a dash with a plain message rather than present stale numbers as fresh.</p></article>
      <article class="tile spot rv"><span class="n">04</span><h3>Contract slot</h3><p>${esc(caTile)}</p></article>
    </div>
  </section>
</div>
</main>

<footer class="foot">
  <div class="foot-in wrap">
    <div><b>MOR</b> &nbsp;${domain ? esc(domain) : ''}<br>Figures are informational and not financial advice.</div>
    <div class="foot-links">${footX}${footGh}<a href="#top">Back to top</a></div>
  </div>
</footer>

<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
</body>
</html>
`;
}

export { rpcOriginOf };
function rpcOriginOf(reg) {
  const r = reg.records.find((x) => x.id === 'rpc');
  return r && r.state === 'stated' ? new URL(r.url).origin : null;
}

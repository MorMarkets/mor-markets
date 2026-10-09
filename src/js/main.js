import '../styles.css';
import { $, $$, esc, reduced, readRegister, fmtInt, fmtCompact, fmtPrice, fmtPct, shortAddr, age, host, DASH } from './util.js';
import { initReveal, initProgress, initSpotlight, initParallax, reveal, setNumber, flash } from './motion.js';
import { poller, readChain, readPairs } from './feeds.js';

const reg = readRegister();
document.documentElement.classList.add('js');

/* ---------- toast + copy ---------- */
function toast(msg) {
  const box = $('#toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  box.appendChild(t);
  if (!reduced() && t.animate) t.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0,0,.2,1)' });
  setTimeout(() => {
    const done = () => t.remove();
    if (!reduced() && t.animate) t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).onfinish = done; else done();
  }, 2200);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b || b.disabled) return;
  const text = b.getAttribute('data-copy');
  if (!text) return;
  const ok = await copyText(text);
  if (ok) {
    b.setAttribute('data-copied', 'true');
    const act = b.querySelector('.ca-act');
    const old = act ? act.textContent : null;
    if (act) act.textContent = 'Copied';
    setTimeout(() => { b.removeAttribute('data-copied'); if (act && old) act.textContent = old; }, 1400);
    toast('Copied ' + shortAddr(text));
  } else toast('Copy blocked by the browser. Select the text instead.');
});

/* ---------- live tile helpers ---------- */
function setLive(key, text, state = 'ready') {
  $$('[data-live="' + key + '"]').forEach((el) => {
    el.dataset.state = state;
    const v = $('.val', el);
    if (v && text !== null) v.textContent = text;
  });
}
function setLiveState(key, state, text) { setLive(key, text === undefined ? null : text, state); }
function setErr(key, msg) { $$('[data-err="' + key + '"]').forEach((el) => { el.textContent = msg || ''; }); }

function health(state, text) {
  const p = $('#pill'); if (p) p.dataset.health = state;
  const t = $('#pill-text'); if (t) t.textContent = text.pill;
}

/* ---------- chain feed ---------- */
const chain = { height: null, slot: null, at: 0, rate: 2.5, prev: null, fails: 0, updated: 0, ok: false };

function paintHeight(n) { setLive('height', fmtInt(n), 'ready'); }

function onChain(r) {
  const now = r.at;
  if (chain.prev) {
    const dt = (now - chain.prev.at) / 1000, dh = r.height - chain.prev.height;
    if (dt > 0.2 && dh >= 0) chain.rate = Math.min(6, Math.max(0.5, chain.rate * 0.6 + (dh / dt) * 0.4));
  }
  chain.prev = { height: r.height, at: now };
  const moved = chain.height !== null && r.height !== chain.height;
  chain.height = r.height; chain.slot = r.slot; chain.at = now; chain.updated = Date.now(); chain.fails = 0; chain.ok = true;
  paintHeight(r.height);
  if (r.slot !== null) setLive('slot', fmtInt(r.slot), 'ready');
  setLive('rtt', Math.round(r.rtt) + ' ms', 'ready');
  setErr('chain', '');
  health('ok', { pill: 'Live · Solana confirmed' });
  if (moved) $$('[data-live="height"] .val').forEach((v) => flash(v, 'up'));
}

function onChainFail(err, fails, wait) {
  chain.fails = fails;
  const secs = Math.max(1, Math.round(wait / 1000));
  const msg = 'RPC not answering (' + (err && err.name === 'AbortError' ? 'timeout' : err && err.message ? err.message : 'network') + '). Retry in ' + secs + 's.';
  if (fails >= 2 || chain.height === null) {
    chain.ok = false;
    ['height', 'slot', 'rtt'].forEach((k) => setLive(k, DASH, 'error'));
    health('down', { pill: 'Offline · no RPC response' });
  } else health('warn', { pill: 'Retrying · attempt ' + (fails + 1) });
  setErr('chain', msg);
}

function tickChain() {
  if (chain.ok && chain.height !== null && !reduced()) {
    const est = chain.height + Math.floor((chain.rate * (performance.now() - chain.at)) / 1000);
    paintHeight(est);
  }
  if (chain.updated) {
    const s = Math.max(0, Math.round((Date.now() - chain.updated) / 1000));
    setLive('age', chain.ok ? s + 's ago' : DASH, chain.ok ? 'ready' : 'error');
  }
  setTimeout(() => requestAnimationFrame(tickChain), 100);
}

/* ---------- market feed ---------- */
const S = { pairs: null, failed: false, tab: 'all', sort: 'vol', depth: 'all', quote: 'all', q: '', shown: 6, nodes: new Map(), first: true };
const PAGE = 6, DEEP = 10000;

const initial = (s) => esc(String(s || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?');

function coin(p, cls) {
  return p.img
    ? '<img class="' + cls + '" src="' + esc(p.img) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fb="' + initial(p.symbol) + '">'
    : '<span class="' + cls + ' fb" aria-hidden="true">' + initial(p.symbol) + '</span>';
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
  const s = document.createElement('span');
  s.className = img.className + ' fb';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = img.dataset.fb;
  img.replaceWith(s);
}, true);

const WINDOWS = [['m5', '5m'], ['h1', '1h'], ['h6', '6h'], ['h24', '24h']];

function cardHTML(p) {
  const bars = WINDOWS.map(([k, l]) => '<i data-w="' + k + '"><b></b><span>' + l + '</span></i>').join('');
  return (
    '<div class="card-top">' + coin(p, 'logo') +
    '<div class="id"><h3>' + esc(p.name) + '</h3><p>' + esc(p.symbol) + ' / ' + esc(p.quote) + ' · <span data-k="age"></span></p></div>' +
    '<span class="chg" data-k="chg"></span></div>' +
    '<div class="bars"><small>Move by window</small><div>' + bars + '</div></div>' +
    '<dl class="facts"><div><dt>Price</dt><dd data-k="price"></dd></div><div><dt>Vol 24h</dt><dd data-k="vol"></dd></div><div><dt>Depth</dt><dd data-k="liq"></dd></div></dl>' +
    '<div class="share" title="Share of the largest 24h volume on this board"><i></i></div>' +
    '<div class="card-foot">' +
    (p.url ? '<a class="btn spot" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">Open chart</a>' : '<span class="btn" aria-disabled="true">No chart link</span>') +
    '<button class="btn spot copy" type="button" data-copy="' + esc(p.addr) + '" aria-label="Copy token address ' + esc(shortAddr(p.addr)) + '" title="Copy token address">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button>' +
    '</div>'
  );
}

function fillCard(node, p, maxVol, maxAbs) {
  const set = (k, val, fmt) => { const el = $('[data-k="' + k + '"]', node); if (el) setNumber(el, val === null ? NaN : val, (n) => { el.textContent = fmt(n); }); };
  set('price', p.price, fmtPrice);
  set('vol', p.vol, fmtCompact);
  set('liq', p.liq, fmtCompact);
  $('[data-k="age"]', node).textContent = p.created ? 'listed ' + age(p.created) + ' ago' : 'listing age ' + DASH;
  const c = $('[data-k="chg"]', node);
  const d = p.chg.h24;
  const next = d === null ? DASH : (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + fmtPct(Math.abs(d)).replace('+', '');
  if (c.textContent && c.textContent !== next && d !== null) flash(c, d >= 0 ? 'up' : 'down');
  c.textContent = next;
  c.className = 'chg' + (d > 0 ? ' up' : d < 0 ? ' down' : '');
  c.title = d === null ? 'No 24h change reported' : '24h change ' + fmtPct(d);
  WINDOWS.forEach(([k]) => {
    const i = $('[data-w="' + k + '"]', node), v = p.chg[k];
    i.classList.toggle('dn', v !== null && v < 0);
    i.title = v === null ? 'No data' : fmtPct(v);
    $('b', i).style.height = v === null ? '0%' : Math.max(6, (Math.abs(v) / maxAbs) * 100) + '%';
  });
  $('.share i', node).style.transform = 'scaleX(' + (p.vol && maxVol ? Math.min(1, p.vol / maxVol) : 0) + ')';
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  let list = (S.pairs || []).filter((p) => {
    if (S.tab === 'up' && !(p.chg.h24 > 0)) return false;
    if (S.tab === 'down' && !(p.chg.h24 < 0)) return false;
    if (S.depth === 'deep' && !(p.liq >= DEEP)) return false;
    if (S.quote !== 'all' && p.quote !== S.quote) return false;
    if (q && !(p.name + ' ' + p.symbol + ' ' + p.addr + ' ' + p.quote).toLowerCase().includes(q)) return false;
    return true;
  });
  const val = { vol: (p) => p.vol, liq: (p) => p.liq, chg: (p) => p.chg.h24, new: (p) => p.created };
  const f = val[S.sort];
  list = list.sort((a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity));
  return list;
}

function skeletonCards() {
  const one = '<div class="card sk-card" aria-hidden="true"><div class="card-top"><div class="logo skeleton"></div><div class="id"><div class="skeleton sk-name"></div><div class="skeleton sk-sub"></div></div><div class="skeleton sk-chg"></div></div><div class="bars"><div class="skeleton sk-bars"></div></div><div class="facts"><div class="skeleton sk-fact"></div><div class="skeleton sk-fact"></div><div class="skeleton sk-fact"></div></div><div class="share"></div></div>';
  return one.repeat(6);
}

function render() {
  const grid = $('#cards');
  const more = $('#more');
  const msg = (text, tone) => '<div class="empty" data-tone="' + (tone || '') + '" role="status">' + esc(text) + '</div>';

  if (S.pairs === null) {
    if (S.failed) {
      grid.innerHTML = msg(DASH + '  Market source did not answer. The board stays blank rather than guess; it keeps retrying on its own.', 'error');
      more.hidden = true; S.nodes.clear();
    }
    return;
  }

  const wasSkeleton = $('.sk-card', grid);
  if (wasSkeleton) {
    const go = () => { grid.innerHTML = ''; S.nodes.clear(); render(); };
    if (reduced()) { go(); return; }
    $$('.sk-card', grid).forEach((c) => { c.classList.add('leaving'); });
    setTimeout(go, 300);
    return;
  }

  const list = filtered();
  const slice = list.slice(0, S.shown);
  const maxVol = Math.max(0, ...(S.pairs || []).map((p) => p.vol || 0));
  const maxAbs = Math.max(1, ...slice.flatMap((p) => Object.values(p.chg).filter((v) => v !== null).map(Math.abs)));

  $$('.empty', grid).forEach((n) => n.remove());
  const keep = new Set(slice.map((p) => p.key));
  for (const [k, n] of S.nodes) if (!keep.has(k)) { n.remove(); S.nodes.delete(k); }

  let i = 0;
  slice.forEach((p, idx) => {
    let n = S.nodes.get(p.key);
    const fresh = !n;
    if (fresh) {
      n = document.createElement('article');
      n.className = 'card spot rv';
      n.innerHTML = cardHTML(p);
      S.nodes.set(p.key, n);
    }
    fillCard(n, p, maxVol, maxAbs);
    const at = grid.children[idx];
    if (at !== n) grid.insertBefore(n, at || null);
    if (fresh) reveal(n, i++ * 60);
  });

  if (!slice.length) {
    const why = !S.pairs.length ? 'DexScreener lists no Solana pair for this search right now.' : 'Nothing matches those filters.';
    grid.insertAdjacentHTML('beforeend', msg(why));
  }
  more.hidden = list.length <= S.shown;
}

function renderMarquee() {
  const m = $('#marquee');
  const host_ = $('.track-host', m);
  if (S.pairs === null) {
    if (S.failed) { m.dataset.state = 'error'; host_.innerHTML = ''; $('.msg', m).textContent = DASH + '  Logo feed unavailable. The market source is not answering; retrying.'; }
    return;
  }
  const toks = [...new Map(S.pairs.map((p) => [p.addr, p])).values()];
  if (!toks.length) { m.dataset.state = 'empty'; host_.innerHTML = ''; $('.msg', m).textContent = 'No Solana tokens came back for this search.'; return; }
  m.dataset.state = 'ready';
  const reps = Math.max(1, Math.ceil(8 / toks.length));
  const half = Array.from({ length: reps }, () => toks).flat();
  const chip = (p) => '<span class="chip">' + coin(p, 'coin') + '<span>' + esc(p.symbol) + '</span></span>';
  host_.innerHTML = '<div class="track">' + half.map(chip).join('') + '<span class="dup" aria-hidden="true">' + half.map(chip).join('') + '</span></div>';
  const t = $('.track', host_);
  if (!reduced()) t.style.animationDuration = Math.max(22, half.length * 4.5) + 's';
}

function rebuildQuotes() {
  const list = $('#qdd-list');
  const quotes = [...new Set((S.pairs || []).map((p) => p.quote))].sort();
  const counts = (q) => (S.pairs || []).filter((p) => q === 'all' || p.quote === q).length;
  list.innerHTML = ['all', ...quotes].map((q) =>
    '<button type="button" role="option" data-q="' + esc(q) + '" aria-selected="' + (S.quote === q) + '">' + (q === 'all' ? 'All quotes' : esc(q)) + '<small>' + counts(q) + '</small></button>'
  ).join('');
  if (S.quote !== 'all' && !quotes.includes(S.quote)) S.quote = 'all';
  $('#qdd-label').textContent = S.quote === 'all' ? 'All quotes' : S.quote;
}

let lastGood = 0;
function onPairs(pairs) {
  S.pairs = pairs; S.failed = false; lastGood = Date.now();
  const tot = pairs.reduce((a, p) => a + (p.vol || 0), 0);
  const el = $('[data-live="pairs"] .val');
  setLive('pairs', null, 'ready');
  if (el) setNumber(el, pairs.length, (n) => { el.textContent = fmtInt(n); });
  const v = $('[data-live="vol"] .val');
  setLive('vol', null, 'ready');
  if (v) setNumber(v, tot, (n) => { v.textContent = fmtCompact(n); });
  setErr('dex', '');
  $('#status-dot-wrap').dataset.health = 'ok';
  $('#status-text').textContent = 'live · 30s';
  rebuildQuotes(); render(); renderMarquee();
}

function onPairsFail(err, fails, wait) {
  const secs = Math.max(1, Math.round(wait / 1000));
  const why = err && err.name === 'AbortError' ? 'timed out' : err && err.message ? err.message : 'unreachable';
  setErr('dex', 'Market source ' + why + '. Next try in ' + secs + 's.');
  $('#status-dot-wrap').dataset.health = S.pairs ? 'warn' : 'down';
  $('#status-text').textContent = S.pairs ? 'stale · retry ' + secs + 's' : 'offline';
  if (S.pairs === null) {
    S.failed = true;
    ['pairs', 'vol'].forEach((k) => setLive(k, DASH, 'error'));
    render(); renderMarquee();
  }
}

/* ---------- controls ---------- */
function bindControls() {
  const tabs = $$('#tabs [role="tab"]');
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); select(n);
    });
  });
  function select(t) {
    tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === t)); x.tabIndex = x === t ? 0 : -1; });
    S.tab = t.dataset.tab; S.shown = PAGE; render();
  }

  const seg = (sel, attr, key) => $$(sel + ' button').forEach((b) => b.addEventListener('click', () => {
    $$(sel + ' button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    S[key] = b.dataset[attr]; S.shown = PAGE; render();
  }));
  seg('#sort', 'sort', 'sort');
  seg('#depth', 'depth', 'depth');

  let timer = 0;
  const q = $('#q');
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.q = q.value.slice(0, 64); S.shown = PAGE; render(); }, 200); });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]')) { e.preventDefault(); q.focus(); }
  });

  const btn = $('#qdd-btn'), list = $('#qdd-list');
  const close = () => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => { const open = list.hidden; list.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    S.quote = b.dataset.q; S.shown = PAGE; rebuildQuotes(); close(); render();
  });
  addEventListener('mousedown', (e) => { if (!e.target.closest('.dd')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  $('#more button').addEventListener('click', () => { S.shown += PAGE; render(); });
}

function bindChrome() {
  const top = $('.top');
  const onScroll = () => top.classList.toggle('compact', scrollY > 60);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const mb = $('#menu-btn'), menu = $('#menu');
  mb.addEventListener('click', () => {
    const open = menu.dataset.open !== 'true';
    menu.dataset.open = String(open); mb.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.dataset.open = 'false'; mb.setAttribute('aria-expanded', 'false'); } });
}

/* ---------- boot ---------- */
function boot() {
  $('#cards').innerHTML = skeletonCards();
  const sk = $('#marquee .skel-row');
  if (sk) sk.innerHTML = '<i class="skeleton"></i>'.repeat(8);

  bindChrome();
  bindControls();
  initProgress();
  initSpotlight();
  initParallax();
  initReveal();
  setLive('rpc', host(reg.url('rpc') || ''), 'ready');

  const rpc = reg.url('rpc');
  if (rpc) {
    poller({ run: () => readChain(rpc), every: 2000, max: 30000, onOk: onChain, onFail: onChainFail }).start();
    tickChain();
  } else {
    ['height', 'slot', 'rtt', 'age'].forEach((k) => setLive(k, DASH, 'error'));
    setErr('chain', 'No RPC endpoint is stated in the register.');
    health('down', { pill: 'Offline · no RPC stated' });
  }

  poller({ run: () => readPairs('mor'), every: 30000, max: 300000, onOk: onPairs, onFail: onPairsFail }).start();

}

boot();

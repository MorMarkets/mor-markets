import { getJson } from './util.js';

/* Self-rescheduling poller. Delay doubles per consecutive failure (with jitter) up to `max`,
   resets on success, and idles while the tab is hidden. */
export function poller({ run, every, max, onOk, onFail }) {
  let fails = 0, timer = 0, stopped = false, first = true;

  const delayFor = () => {
    if (!fails) return every;
    const base = Math.min(max, every * Math.pow(2, fails));
    return Math.round(base * (1 + Math.random() * 0.25));
  };

  const schedule = (ms) => { if (!stopped) timer = setTimeout(tick, ms); };

  async function tick() {
    if (document.hidden && !first) { schedule(1000); return; }
    first = false;
    try {
      const out = await run();
      fails = 0;
      onOk && onOk(out);
      schedule(every);
    } catch (err) {
      fails += 1;
      const wait = delayFor();
      onFail && onFail(err, fails, wait);
      schedule(wait);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !stopped) { clearTimeout(timer); schedule(0); }
  });

  return { start: () => schedule(0), stop: () => { stopped = true; clearTimeout(timer); } };
}

/* One batched JSON-RPC request: confirmed height and confirmed slot together. */
export async function readChain(rpcUrl) {
  const t0 = performance.now();
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [{ commitment: 'confirmed' }] },
    { jsonrpc: '2.0', id: 2, method: 'getSlot', params: [{ commitment: 'confirmed' }] }
  ]);
  const res = await getJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, 6000);
  const rtt = performance.now() - t0;
  const list = Array.isArray(res) ? res : [];
  const pick = (id) => list.find((r) => r && r.id === id);
  const h = pick(1), s = pick(2);
  if (!h || h.error || !Number.isFinite(h.result)) throw new Error('RPC returned no block height');
  return { height: h.result, slot: s && Number.isFinite(s.result) ? s.result : null, rtt, at: performance.now() };
}

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

export async function readPairs(query) {
  const res = await getJson('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query), {}, 9000);
  if (!res || !Array.isArray(res.pairs)) throw new Error('Unexpected market payload');
  const seen = new Set();
  return res.pairs
    .filter((p) => p && p.chainId === 'solana' && p.pairAddress && p.baseToken && !seen.has(p.pairAddress) && seen.add(p.pairAddress))
    .map((p) => ({
      key: p.pairAddress,
      addr: p.baseToken.address,
      name: p.baseToken.name || p.baseToken.symbol || 'Unnamed',
      symbol: p.baseToken.symbol || '?',
      quote: (p.quoteToken && p.quoteToken.symbol) || '?',
      price: num(p.priceUsd),
      chg: { m5: num(p.priceChange && p.priceChange.m5), h1: num(p.priceChange && p.priceChange.h1), h6: num(p.priceChange && p.priceChange.h6), h24: num(p.priceChange && p.priceChange.h24) },
      vol: num(p.volume && p.volume.h24),
      liq: num(p.liquidity && p.liquidity.usd),
      created: num(p.pairCreatedAt),
      img: (p.info && p.info.imageUrl) || null,
      url: typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null,
      dex: p.dexId || null
    }));
}

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

export const DASH = '—';

export function readRegister() {
  const raw = document.getElementById('register');
  const list = raw ? JSON.parse(raw.textContent).records : [];
  const map = Object.fromEntries(list.map((r) => [r.id, r]));
  const stated = (id) => !!map[id] && map[id].state === 'stated';
  return { map, stated, url: (id) => (stated(id) ? map[id].url : null), value: (id) => (stated(id) ? map[id].value : null) };
}

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmtInt = (n) => (Number.isFinite(n) ? nf0.format(Math.round(n)) : DASH);

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']].find(([v]) => a >= v);
  if (!u) return '$' + (a >= 100 ? nf0.format(n) : n.toFixed(2));
  const q = a / u[0];
  return '$' + (n / u[0]).toFixed(q >= 100 ? 0 : 2).replace(/\.?0+$/, '') + u[1];
}

export function fmtPrice(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return '$0';
  const a = Math.abs(n);
  if (a >= 1000) return '$' + nf0.format(n);
  if (a >= 1) return '$' + n.toFixed(2);
  if (a >= 0.01) return '$' + n.toFixed(4);
  const digits = Math.min(12, 3 - Math.floor(Math.log10(a)));
  return '$' + n.toFixed(digits);
}

export function fmtPct(n) {
  if (!Number.isFinite(n)) return DASH;
  const s = Math.abs(n) >= 100 ? nf0.format(Math.abs(n)) : Math.abs(n).toFixed(2);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + s + '%';
}

export const shortAddr = (a) => (a && a.length > 14 ? a.slice(0, 5) + '…' + a.slice(-5) : a || DASH);

export function age(ms) {
  if (!ms) return DASH;
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const t = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']].find(([v]) => s >= v);
  return t ? Math.floor(s / t[0]) + t[1] : Math.floor(s) + 's';
}

export const host = (u) => { try { return new URL(u).host; } catch { return DASH; } };
export const handleOf = (u) => {
  try { const p = new URL(u).pathname.split('/').filter(Boolean)[0]; return p ? '@' + p : null; } catch { return null; }
};

export async function getJson(url, init = {}, timeout = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

import { reduced } from './util.js';

/* Damped spring sampled into a CSS linear() easing so WAAPI can run it off the main thread. */
const cache = new Map();
export function springEasing(stiffness = 170, damping = 15, mass = 1) {
  const key = stiffness + ':' + damping + ':' + mass;
  if (cache.has(key)) return cache.get(key);
  const dt = 1 / 120;
  let x = 0, v = 0, t = 0, settled = 0;
  const pts = [0];
  while (t < 2.4 && settled < 0.08) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt;
    pts.push(x);
    settled = Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01 ? settled + dt : 0;
  }
  pts[pts.length - 1] = 1;
  const n = 36;
  const out = [];
  for (let i = 0; i < n; i++) out.push(+pts[Math.round((i / (n - 1)) * (pts.length - 1))].toFixed(4));
  const res = { easing: 'linear(' + out.join(', ') + ')', duration: Math.round(t * 1000) };
  cache.set(key, res);
  return res;
}

export function reveal(el, delay = 0) {
  if (el.classList.contains('rv-in')) return;
  if (reduced() || !el.animate) { el.classList.add('rv-in'); return; }
  const sp = springEasing(190, 17);
  el.classList.add('rv-in');
  el.animate(
    [{ opacity: 0, transform: 'translateY(26px) scale(0.975)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
    { duration: sp.duration, delay, easing: sp.easing, fill: 'backwards' }
  );
}

export function initReveal(root = document) {
  const items = [...root.querySelectorAll('.rv:not(.rv-in)')];
  if (!items.length) return;
  if (reduced() || !('IntersectionObserver' in window)) { items.forEach((e) => e.classList.add('rv-in')); return; }
  const queue = new Map();
  let frame = 0;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { queue.set(en.target, en.boundingClientRect.top); io.unobserve(en.target); } });
    if (!queue.size || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      [...queue.entries()].sort((a, b) => a[1] - b[1]).forEach(([el], i) => reveal(el, i * 70));
      queue.clear();
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((e) => io.observe(e));
}

export function flash(el, dir = 'up') {
  if (reduced()) return;
  const c = dir === 'up' ? 'flash-up' : 'flash-down';
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(c);
  clearTimeout(el._ft);
  el._ft = setTimeout(() => el.classList.remove(c), 950);
}

/* Tween a number into an element and flash it when the value moved. write(n) renders text. */
export function setNumber(el, next, write, opts = {}) {
  const prev = el._n;
  el._n = next;
  if (!Number.isFinite(next)) { cancelAnimationFrame(el._raf); write(next); return; }
  if (prev === next) return;
  if (!Number.isFinite(prev) || reduced()) { cancelAnimationFrame(el._raf); write(next); return; }
  const dur = opts.duration ?? 700, t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    write(prev + (next - prev) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) el._raf = requestAnimationFrame(step); else write(next);
  };
  el._raf = requestAnimationFrame(step);
  flash(el, next > prev ? 'up' : 'down');
}

export function initProgress() {
  const bar = document.querySelector('.progress i');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, h.scrollTop / max) : 0) + ')';
  };
  const on = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on);
  paint();
}

export function initSpotlight() {
  let raf = 0, target = null, ev = null;
  document.addEventListener('pointermove', (e) => {
    if (reduced() || e.pointerType === 'touch') return;
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    target = t; ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = target.getBoundingClientRect();
      target.style.setProperty('--mx', ev.clientX - r.left + 'px');
      target.style.setProperty('--my', ev.clientY - r.top + 'px');
    });
  }, { passive: true });
}

export function initParallax() {
  const layers = [...document.querySelectorAll('[data-depth]')];
  const stage = document.querySelector('.stage');
  if (!layers.length || !stage || reduced()) return;
  let px = 0, py = 0, sy = 0, raf = 0;
  const paint = () => {
    raf = 0;
    layers.forEach((l) => {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = 'translate3d(' + (px * d * 22).toFixed(1) + 'px,' + (py * d * 16 + sy * d * -40).toFixed(1) + 'px,0)';
    });
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(paint); };
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = stage.getBoundingClientRect();
    px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; queue();
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { px = 0; py = 0; queue(); });
  addEventListener('scroll', () => {
    const r = stage.getBoundingClientRect();
    sy = Math.max(-1, Math.min(1, r.top / innerHeight)); queue();
  }, { passive: true });
}

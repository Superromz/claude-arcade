// Small shared helpers: colors, hashing, noise, easing, DOM.

export const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (a, b, t) => [clamp(a[0] + (b[0] - a[0]) * t) | 0, clamp(a[1] + (b[1] - a[1]) * t) | 0, clamp(a[2] + (b[2] - a[2]) * t) | 0];
export const shade = (c, f) => [clamp(c[0] * f) | 0, clamp(c[1] * f) | 0, clamp(c[2] * f) | 0];
export const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
export const hex = (c) => '#' + c.map((v) => (v | 0).toString(16).padStart(2, '0')).join('');
export const norm = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
export const lum = (c) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const smooth = (f) => f * f * (3 - 2 * f);
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash(i, seed), hash(i + 1, seed), smooth(f));
}
// Periodic value noise (period p lattice cells in x) so layers tile.
export function noise2(x, y, seed = 0, p = 1 << 20) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const w = (v) => ((v % p) + p) % p;
  const a = hash(w(xi) + seed * 131, yi), b = hash(w(xi + 1) + seed * 131, yi);
  const c = hash(w(xi) + seed * 131, yi + 1), d = hash(w(xi + 1) + seed * 131, yi + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
export function fbm(x, y, seed = 0, oct = 4, p = 1 << 20) {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let o = 0; o < oct; o++) { v += amp * noise2(x * f, y * f, seed + o * 7, p * f); tot += amp; amp *= 0.5; f *= 2; }
  return v / tot;
}

export const ease = {
  outCubic: (k) => 1 - (1 - clamp01(k)) ** 3,
  inCubic: (k) => clamp01(k) ** 3,
  outBack: (k) => { k = clamp01(k); const c = 1.70158; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
  outElastic: (k) => { k = clamp01(k); return k === 0 || k === 1 ? k : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI / 3)) + 1; },
  inOut: (k) => { k = clamp01(k); return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; },
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function fmt(n) {
  n = Number(n) || 0;
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
}
export function ago(ms) {
  const s = Math.max(0, (Date.now() - (ms || 0)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const stripIcons = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

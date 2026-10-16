// ==========================================
// DeLectured — Ink Spread Theme Transition
// Animate browser snapshots when available; retain a clipped clone fallback.
// ==========================================
(function () {
  'use strict';

  let _running = false;
  const storageKey = 'delectured-theme';
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(storageKey, theme); } catch { /* Theme works without storage access. */ }
    const button = document.getElementById('theme-toggle');
    button?.setAttribute('aria-pressed', String(theme === 'dark'));
    button?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  let initial;
  try { initial = localStorage.getItem(storageKey); } catch {}
  if (!['light', 'dark'].includes(initial)) initial = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(initial);
  document.addEventListener('DOMContentLoaded', () => applyTheme(document.documentElement.dataset.theme));

  // ---- Value noise ----
  const _seed = Math.random() * 65536;
  function hash(x) {
    const n = Math.sin(x + _seed) * 43758.5453123;
    return n - Math.floor(n);
  }
  function smoothNoise(t) {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash(i) * (1 - u) + hash(i + 1) * u;
  }

  // ---- Build aggressive organic ink path ----
  function buildInkPath(cx, cy, progress, vw, vh, goingDark, noiseSeed) {
    const maxR = Math.max(...[[0,0],[vw,0],[0,vh],[vw,vh]].map(([x,y]) => Math.hypot(x-cx,y-cy))) * 1.28;
    const r = maxR * progress;


    const N = 64;
    const coords = [];

    // Direction-dependent noise character
    const loAmp = goingDark ? 0.24 : 0.18;
    const midAmp = goingDark ? 0.15 : 0.11;
    const hiAmp = goingDark ? 0.09 : 0.06;
    const fiberTh = goingDark ? 0.70 : 0.76;
    const fiberK = goingDark ? 12.0 : 7.0;
    const recTh = goingDark ? 0.24 : 0.20;
    const recK = goingDark ? 5.0 : 6.0;

    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2;

      // Multi-octave noise
      const n1 = smoothNoise(i * 0.55 + noiseSeed) - 0.5;
      const n2 = smoothNoise(i * 2.3 + noiseSeed + 47) - 0.5;
      const n3 = smoothNoise(i * 5.8 + noiseSeed + 143) - 0.5;

      // Fiber channels — sharp forward spikes
      const fn = smoothNoise(i * 0.85 + noiseSeed + 290);
      const fiber = fn > fiberTh ? (fn - fiberTh) * fiberK : 0;

      // Recessions — areas lagging behind
      const rn = smoothNoise(i * 1.05 + noiseSeed + 410);
      const recess = rn < recTh ? (recTh - rn) * recK : 0;

      // Time-varying micro-animation on the edge
      const timeMicro = smoothNoise(i * 1.7 + progress * 7 + noiseSeed + 530) * 0.025;

      const wobble = n1 * loAmp + n2 * midAmp + n3 * hiAmp
        + fiber * 0.16 - recess * 0.13 + timeMicro;
      const stretch = 1 + 0.07 * Math.cos(angle * 2 + 0.4);
      // Keep the capillary edge irregular, but guarantee it covers every corner
      // before the old page is removed (1.28 * 0.8 > 1).
      const pr = r * Math.max(0.8, Math.min(1.3, (1 + wobble) * stretch));

      coords.push({
        x: cx + Math.cos(angle) * pr,
        y: cy + Math.sin(angle) * pr
      });
    }

    // Catmull-Rom → cubic bezier, lower tension for sharper features
    const tension = 0.22;
    let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < N; i++) {
      const p0 = coords[(i - 1 + N) % N];
      const p1 = coords[i];
      const p2 = coords[(i + 1) % N];
      const p3 = coords[(i + 2) % N];

      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    d += 'Z';
    return d;
  }

  // Build the irregular outline twice, then let the browser interpolate it.
  // No per-frame path strings, DOM mutations, SVG blur, or live-page repaint loop.
  async function toggle(source = document.getElementById('theme-toggle')) {
    if (_running) return;
    const root = document.documentElement;
    const fromTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    const toTheme = fromTheme === 'dark' ? 'light' : 'dark';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches || document.hidden) { applyTheme(toTheme); return; }

    _running = true;
    root.setAttribute('data-ink-running', '');
    const vw = root.clientWidth, vh = innerHeight;
    const rect = source?.getBoundingClientRect();
    const origin = rect ? {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2} : {x: vw / 2, y: 32};
    const seed = Math.random() * 100, goingDark = toTheme === 'dark';
    const startPath = buildInkPath(origin.x, origin.y, 0, vw, vh, goingDark, seed);
    const endPath = buildInkPath(origin.x, origin.y, 1, vw, vh, goingDark, seed);
    const timing = {duration: goingDark ? 2600 : 2400, easing: 'ease-in-out', fill: 'both'};
    let transition, animation, clone, stopRequested = false;
    const finish = () => { stopRequested = true; transition?.skipTransition(); try { animation?.finish(); } catch {} };
    const motionChanged = () => {if (reducedMotion.matches) finish();};
    const visibilityChanged = () => {if (document.hidden) finish();};
    window.addEventListener('resize', finish, {once:true});
    window.addEventListener('beforeprint', finish, {once:true});
    document.addEventListener('visibilitychange', visibilityChanged);
    reducedMotion.addEventListener('change', motionChanged);
    try {
      if (typeof document.startViewTransition === 'function') {
        transition = document.startViewTransition(() => applyTheme(toTheme));
        // A skipped/hidden-tab transition must still apply and save the theme.
        transition.updateCallbackDone.catch(() => {});
        transition.finished.catch(() => {});
        await transition.ready;
        if (stopRequested) return;
        animation = root.animate({clipPath: [`path("${startPath}")`, `path("${endPath}")`]},
          {...timing, pseudoElement:'::view-transition-new(root)'});
        await animation.finished;
        await transition.finished;
      } else {
        // Older browsers keep the organic reveal, without a dynamic SVG filter.
        const bodyColor = getComputedStyle(document.body).color;
        const canvases = [...document.querySelectorAll('canvas')];
        clone = document.createElement('div');
        clone.className = 'theme-clone'; clone.inert = true;
        clone.setAttribute('aria-hidden', 'true'); clone.dataset.theme = fromTheme;
        clone.style.color = bodyColor;
        const inner = document.createElement('div'); inner.className = 'clone-inner';
        inner.style.width = `${vw}px`; inner.style.minHeight = `${document.body.scrollHeight}px`;
        for (const child of document.body.children) if (child.tagName !== 'SCRIPT') inner.append(child.cloneNode(true));
        clone.append(inner); document.body.append(clone); clone.scrollTop = scrollY;
        inner.querySelectorAll('canvas').forEach((canvas, i) => {
          try {canvas.getContext('2d').drawImage(canvases[i], 0, 0);} catch {}
        });
        const outer = `M-200,-200 L${vw+200},-200 L${vw+200},${vh+200} L-200,${vh+200} Z`;
        const clip = path => `path(evenodd, "${outer} ${path}")`;
        clone.style.clipPath = clip(startPath);
        // Paint the old page once before revealing the new theme below it.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        applyTheme(toTheme);
        if (stopRequested) return;
        animation = clone.animate({clipPath:[clip(startPath),clip(endPath)]}, timing);
        await animation.finished;
      }
    } catch {
      transition?.skipTransition();
      applyTheme(toTheme);
    } finally {
      clone?.remove(); animation?.cancel();
      window.removeEventListener('resize', finish);
      window.removeEventListener('beforeprint', finish);
      document.removeEventListener('visibilitychange', visibilityChanged);
      reducedMotion.removeEventListener('change', motionChanged);
      root.removeAttribute('data-ink-running'); _running = false;
    }
  }

  window.InkTransition = { toggle };
})();

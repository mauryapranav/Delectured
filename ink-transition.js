// ==========================================
// DeLectured — Ink Spread Theme Transition v2
// Reverse-layer architecture: clone = old theme (peeled away),
// real page = new theme (revealed beneath).
// ==========================================
(function () {
  'use strict';

  let _running = false;
  let _lastCorner = -1;

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

  // ---- Easing: slow start → fluid momentum → gentle settle ----
  function inkEase(t) {
    if (t < 0.5) return 4 * t * t * t;
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---- Corner origin (never repeat) ----
  function pickCorner() {
    let c;
    do { c = Math.floor(Math.random() * 4); } while (c === _lastCorner);
    _lastCorner = c;
    return c;
  }
  function cornerXY(corner, vw, vh) {
    switch (corner) {
      case 0: return { x: 0, y: 0 };
      case 1: return { x: vw, y: 0 };
      case 2: return { x: vw, y: vh };
      case 3: return { x: 0, y: vh };
    }
  }

  // ---- Build aggressive organic ink path ----
  function buildInkPath(cx, cy, progress, vw, vh, goingDark, noiseSeed) {
    const maxR = Math.sqrt(vw * vw + vh * vh) * 1.2;
    const r = maxR * progress;
    if (r < 1) return '';

    const N = 72;
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
      const pr = r * (1 + wobble) * stretch;

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

  // ---- Main toggle ----
  function toggle() {
    if (_running) return;

    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
      return;
    }

    _running = true;

    // Capture body's inherited color NOW, before the theme swap changes it.
    // Elements in the clone inherit color via DOM: clone → body → html.
    // After the swap, body's color changes to the new theme — making inherited
    // text in the clone invisible against the clone's old-theme background.
    const bodyColor = getComputedStyle(document.body).color;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const fromTheme = isDark ? 'dark' : 'light';
    const toTheme = isDark ? 'light' : 'dark';
    const goingDark = toTheme === 'dark';

    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const currentScrollY = window.scrollY;

    const corner = pickCorner();
    const origin = cornerXY(corner, vw, vh);
    const noiseSeed = Math.random() * 100;

    // ---- SVG clip-path (evenodd: outer rect + inner ink hole) ----
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';

    const clipPath = document.createElementNS(svgNS, 'clipPath');
    const clipId = 'ink-clip-' + Date.now();
    clipPath.id = clipId;
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');

    const pathEl = document.createElementNS(svgNS, 'path');
    const outerRect = `M-200,-200 L${vw + 200},-200 L${vw + 200},${vh + 200} L-200,${vh + 200} Z`;
    pathEl.setAttribute('d', outerRect);
    pathEl.setAttribute('clip-rule', 'evenodd');
    clipPath.appendChild(pathEl);
    svg.appendChild(clipPath);
    document.body.appendChild(svg);

    // ---- Clone body content (OLD theme) into fixed overlay ----
    const cloneWrapper = document.createElement('div');
    cloneWrapper.className = 'theme-clone';
    cloneWrapper.setAttribute('data-theme', fromTheme);
    cloneWrapper.style.clipPath = `url(#${clipId})`;
    cloneWrapper.style.color = bodyColor; // Pin old-theme color — breaks inheritance from body

    const cloneInner = document.createElement('div');
    cloneInner.className = 'clone-inner';
    cloneInner.style.width = vw + 'px';
    cloneInner.style.minHeight = document.body.scrollHeight + 'px';

    Array.from(document.body.children).forEach(child => {
      if (child === svg || child === cloneWrapper || child.tagName === 'SCRIPT') return;
      cloneInner.appendChild(child.cloneNode(true));
    });

    cloneWrapper.appendChild(cloneInner);
    document.body.appendChild(cloneWrapper);

    // Match scroll position (programmatic scrollTop works with overflow:hidden)
    cloneWrapper.scrollTop = currentScrollY;

    // ---- Fix clone rendering artifacts ----

    // 1. Fix fade-up animations resetting to opacity:0
    cloneWrapper.querySelectorAll('.fade-up').forEach(el => {
      el.style.opacity = '1';
      el.style.animation = 'none';
    });

    // 2. Copy canvas content (concept graph renders blank otherwise)
    const origCanvases = document.body.querySelectorAll('canvas');
    const cloneCanvases = cloneInner.querySelectorAll('canvas');
    origCanvases.forEach((orig, idx) => {
      if (cloneCanvases[idx]) {
        try {
          cloneCanvases[idx].width = orig.width;
          cloneCanvases[idx].height = orig.height;
          cloneCanvases[idx].getContext('2d').drawImage(orig, 0, 0);
        } catch (e) { /* cross-origin or tainted — acceptable loss */ }
      }
    });

    // 3. Fix any display:none terminal or results sections to match current state
    // (cloneNode preserves inline styles, so this is handled automatically)

    // ---- Wait for clone to be fully painted before swapping the real page ----
    // Double-rAF: first rAF = browser has processed DOM, second rAF = clone is composited.
    // Only THEN do we swap the theme underneath — the clone covers the flash completely.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.setAttribute('data-theme', toTheme);

        // ---- Animate: grow the ink hole, peeling away the old theme clone ----
        const duration = goingDark ? 1400 : 1300;
        const startTime = performance.now();

        function frame(now) {
          const elapsed = now - startTime;
          const rawT = Math.min(elapsed / duration, 1);
          const t = inkEase(rawT);

          if (t > 0.001) {
            const inkPath = buildInkPath(origin.x, origin.y, t, vw, vh, goingDark, noiseSeed);
            pathEl.setAttribute('d', outerRect + ' ' + inkPath);
          }

          if (rawT < 1) {
            requestAnimationFrame(frame);
          } else {
            cloneWrapper.remove();
            svg.remove();
            _running = false;
          }
        }

        requestAnimationFrame(frame);
      });
    });
  }

  window.InkTransition = { toggle };
})();

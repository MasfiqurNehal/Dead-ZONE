/**
 * error-handler.js — Global error handling, WebGL detection, friendly overlays
 *
 * Call initErrorHandler() as the very first thing in main.js.
 * It sets up window.onerror + unhandledrejection, checks for WebGL2,
 * and provides showFatalError() for rendering issues.
 */

import { analytics } from './analytics.js';

let _fatalShown = false;
let _crashCount = 0;

// ─── WebGL2 check ─────────────────────────────────────────────────────────────
export function checkWebGLSupport() {
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  if (gl2) return { supported: true, version: 2 };

  const gl1 = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
  if (gl1) return { supported: true, version: 1 };

  return { supported: false, version: 0 };
}

// ─── Friendly error overlay ───────────────────────────────────────────────────
function _injectCSS() {
  if (document.getElementById('dz-err-css')) return;
  const s = document.createElement('style');
  s.id = 'dz-err-css';
  s.textContent = `
    #dz-error-overlay {
      position:fixed; inset:0; z-index:999999;
      background:linear-gradient(160deg,#0a0a0f 0%,#050505 100%);
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding:2rem; font-family:'Rubik','Segoe UI',sans-serif; color:#e4e0da;
    }
    #dz-error-overlay .dz-err-logo {
      font-size:clamp(2rem,8vw,3.5rem); font-weight:900; letter-spacing:.1em;
      color:#c0202a; text-shadow:0 0 30px rgba(192,32,42,.6);
      margin-bottom:1.5rem;
    }
    #dz-error-overlay .dz-err-title {
      font-size:clamp(1.1rem,4vw,1.5rem); font-weight:700; color:#ff3b3b;
      margin-bottom:.75rem; text-align:center;
    }
    #dz-error-overlay .dz-err-msg {
      font-size:.85rem; color:#8a9090; max-width:480px; text-align:center;
      line-height:1.7; margin-bottom:2rem;
    }
    #dz-error-overlay .dz-err-detail {
      font-size:.72rem; color:#555; font-family:monospace;
      background:rgba(255,255,255,.04); border-radius:6px; padding:8px 12px;
      max-width:480px; width:100%; overflow:auto; max-height:120px;
      margin-bottom:1.5rem; display:none;
    }
    #dz-error-overlay .dz-err-detail.visible { display:block; }
    #dz-error-overlay .dz-err-btns { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
    #dz-error-overlay .dz-err-btn {
      padding:12px 28px; border-radius:8px; border:none; cursor:pointer;
      font-weight:700; font-size:.9rem; font-family:inherit; transition:opacity .15s;
    }
    #dz-error-overlay .dz-err-btn:hover { opacity:.85; }
    #dz-error-overlay .dz-err-btn-primary { background:#c0202a; color:#fff; }
    #dz-error-overlay .dz-err-btn-secondary { background:rgba(255,255,255,.08); color:#e4e0da; }
  `;
  document.head.appendChild(s);
}

export function showFatalError(title, message, detail = '') {
  if (_fatalShown) return;
  _fatalShown = true;

  _injectCSS();
  analytics.trackFatalError(`${title}: ${message}`);

  // Remove loading screen if still visible
  document.getElementById('loading-screen')?.remove();

  const el = document.createElement('div');
  el.id = 'dz-error-overlay';
  el.innerHTML = `
    <div class="dz-err-logo">DEAD ZONE</div>
    <div class="dz-err-title">${title}</div>
    <div class="dz-err-msg">${message}</div>
    ${detail ? `<div class="dz-err-detail" id="dz-err-detail">${detail}</div>` : ''}
    <div class="dz-err-btns">
      <button class="dz-err-btn dz-err-btn-primary" onclick="location.reload()">↺ Reload Game</button>
      ${detail ? `<button class="dz-err-btn dz-err-btn-secondary" onclick="document.getElementById('dz-err-detail').classList.toggle('visible')">Show Details</button>` : ''}
    </div>
  `;
  document.body.appendChild(el);
}

// ─── WebGL-specific errors ────────────────────────────────────────────────────
export function showWebGLError() {
  showFatalError(
    'WebGL Not Available',
    'DEAD ZONE requires WebGL 2 to run. Please try a different browser (Chrome or Edge recommended), update your graphics drivers, or enable hardware acceleration in your browser settings.',
    'navigator.userAgent: ' + navigator.userAgent,
  );
}

// ─── Context lost handler ─────────────────────────────────────────────────────
export function handleContextLoss(canvas) {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[WebGL] Context lost — attempting recovery...');
    setTimeout(() => location.reload(), 2000);
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    console.info('[WebGL] Context restored');
  }, false);
}

// ─── Auto-reload on repeated crashes ─────────────────────────────────────────
function _shouldAutoReload(err) {
  // Don't auto-reload user-facing logic errors, only engine crashes
  const engineErrors = ['webgl', 'three', 'rapier', 'out of memory', 'buffer'];
  const msg = String(err?.message ?? err).toLowerCase();
  return engineErrors.some(e => msg.includes(e));
}

// ─── Global error handlers ────────────────────────────────────────────────────
export function initErrorHandler() {
  window.onerror = (message, source, line, col, err) => {
    _crashCount++;
    const detail = `${source}:${line}:${col}\n${err?.stack ?? message}`;
    console.error('[DEAD ZONE] Uncaught error:', detail);
    analytics.trackError('uncaught', String(message).slice(0, 150));

    if (_crashCount >= 2 && _shouldAutoReload(err)) {
      console.warn('[DEAD ZONE] Repeated crash — reloading in 3s');
      setTimeout(() => location.reload(), 3000);
      return;
    }
    // Don't show overlay for every minor JS error — only true fatals
    return false;  // let browser also report it
  };

  window.onunhandledrejection = (e) => {
    const msg = e.reason?.message ?? String(e.reason ?? 'Unknown promise rejection');
    console.error('[DEAD ZONE] Unhandled rejection:', msg);
    analytics.trackError('promise', msg.slice(0, 150));
  };

  // Detect if the page is being throttled by the browser (e.g., background tab)
  document.addEventListener('visibilitychange', () => {
    // Re-exported so engine can pause/resume
    window.__dzPageVisible = !document.hidden;
  });
  window.__dzPageVisible = true;
}

// ─── Performance warning ──────────────────────────────────────────────────────
let _perfWarnShown = false;
export function warnLowPerformance(avgFPS) {
  if (_perfWarnShown || avgFPS > 20) return;
  _perfWarnShown = true;
  analytics.trackError('performance', `Critical FPS: ${avgFPS.toFixed(1)}`);
  // Non-fatal — don't show overlay, just log
  console.warn(`[DEAD ZONE] Very low FPS (${avgFPS.toFixed(1)}) — consider lowering quality in settings`);
}

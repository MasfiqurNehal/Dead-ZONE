/**
 * Small, dependency-free utilities used across the engine.
 */

// --- Math --------------------------------------------------------------------

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent damping toward a target. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const randRange = (min, max) => min + Math.random() * (max - min);

export const randInt = (min, max) => Math.floor(randRange(min, max + 1));

export const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const degToRad = (d) => (d * Math.PI) / 180;

export const radToDeg = (r) => (r * 180) / Math.PI;

/** Distance between two {x,z} points on the ground plane. */
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const dist3D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// --- Timing ------------------------------------------------------------------

export function debounce(fn, wait = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}

// --- Device / capability detection ------------------------------------------

/** True on phones/tablets. Uses UA + pointer + touch heuristics. */
export function isMobile() {
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // iPadOS reports as desktop Safari, so also check touch + coarse pointer.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 1;
  return uaMobile || (coarse && touch);
}

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** Rough GPU tier guess based on device + memory hints. */
export function detectQualityTier() {
  if (isMobile()) {
    const mem = navigator.deviceMemory || 4;
    return mem <= 3 ? 'low' : 'medium';
  }
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}

/** Returns true if WebGL2 is available. */
export function supportsWebGL2() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch (e) {
    return false;
  }
}

// --- Formatting --------------------------------------------------------------

export const formatScore = (n) => n.toLocaleString('en-US');

export const padNum = (n, len = 2) => String(n).padStart(len, '0');

// --- Storage (safe wrappers — never throw in private mode) -------------------

export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / privacy errors */
    }
  },
};

// --- Misc --------------------------------------------------------------------

/** Promise that resolves after `ms`. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simple unique id. */
let _id = 0;
export const uid = (prefix = 'id') => `${prefix}_${++_id}`;

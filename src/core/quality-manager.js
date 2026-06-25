/**
 * quality-manager.js — Device detection, quality presets, dynamic resolution scaling
 *
 * Tier detection runs once at boot from GPU string, memory, cores, and screen DPR.
 * Dynamic resolution kicks in during gameplay: if avg FPS < 45 for 2s, drops pixelRatio;
 * if avg FPS > 58 for 5s, nudges it back up. Never below 0.35, never above device DPR.
 */

// ─── Quality presets ──────────────────────────────────────────────────────────
export const QUALITY_PRESETS = {
  LOW: {
    label:               'Low',
    pixelRatio:          0.5,
    shadowsEnabled:      false,
    shadowMapSize:       0,
    particleMultiplier:  0.2,
    textureAnisotropy:   1,
    antialias:           false,
    postProcessing:      false,
    fogDensity:          0.05,
    drawDistance:        40,
    zombieLODDist:       8,
    dynamicResolution:   true,
    maxLights:           2,
  },
  MEDIUM: {
    label:               'Medium',
    pixelRatio:          0.75,
    shadowsEnabled:      true,
    shadowMapSize:       512,
    particleMultiplier:  0.5,
    textureAnisotropy:   2,
    antialias:           false,
    postProcessing:      false,
    fogDensity:          0.035,
    drawDistance:        70,
    zombieLODDist:       18,
    dynamicResolution:   true,
    maxLights:           4,
  },
  HIGH: {
    label:               'High',
    pixelRatio:          1.0,
    shadowsEnabled:      true,
    shadowMapSize:       1024,
    particleMultiplier:  0.8,
    textureAnisotropy:   4,
    antialias:           true,
    postProcessing:      true,
    fogDensity:          0.025,
    drawDistance:        120,
    zombieLODDist:       30,
    dynamicResolution:   true,
    maxLights:           8,
  },
  ULTRA: {
    label:               'Ultra',
    pixelRatio:          Math.min(window.devicePixelRatio, 2),
    shadowsEnabled:      true,
    shadowMapSize:       2048,
    particleMultiplier:  1.0,
    textureAnisotropy:   16,
    antialias:           true,
    postProcessing:      true,
    fogDensity:          0.018,
    drawDistance:        200,
    zombieLODDist:       60,
    dynamicResolution:   false,
    maxLights:           16,
  },
};

const LS_KEY = 'dz-quality';

// ─── GPU tier detection ───────────────────────────────────────────────────────
function _detectGPUTier() {
  try {
    const cvs = document.createElement('canvas');
    const gl  = cvs.getContext('webgl2') ?? cvs.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return 'medium';
    const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase();
    // Flagship GPU strings
    if (/rtx\s*[2-9]|rtx\s*[1-9]\d|rx\s*[6-9]\d\d\d|radeon\s*vii|apple\s*gpu|adreno\s*[7-9]\d\d|m[1-4]\s*(pro|max|ultra)?/.test(r)) return 'ultra';
    if (/gtx\s*[1-9]\d\d|rx\s*[5-6]\d\d\d|intel\s*(xe|arc)|adreno\s*6\d\d|mali-g[7-9]\d|apple/.test(r)) return 'high';
    if (/adreno\s*[3-5]\d\d|mali-g[5-6]\d|mali-t\d|powervr|sgx/.test(r)) return 'low';
    if (/llvmpipe|swiftshader|software|mesa\s*offscreen/.test(r)) return 'low';
    return 'medium';
  } catch {
    return 'medium';
  }
}

// ─── Automatic tier selection ─────────────────────────────────────────────────
function _autoDetectTier() {
  const isMobile = navigator.maxTouchPoints > 1;
  const mem      = navigator.deviceMemory  ?? 4;   // GB, Chrome only
  const cores    = navigator.hardwareConcurrency ?? 4;
  const dpr      = window.devicePixelRatio ?? 1;
  const gpuTier  = _detectGPUTier();

  let score = 0;
  // Platform base
  score += isMobile ? 0 : 4;
  // Memory
  if (mem >= 8) score += 3; else if (mem >= 4) score += 1;
  // CPU cores
  if (cores >= 8) score += 2; else if (cores >= 4) score += 1;
  // GPU
  if (gpuTier === 'ultra') score += 4;
  else if (gpuTier === 'high') score += 2;
  else if (gpuTier === 'low') score -= 2;
  // High-DPR phones get penalised — more pixels to fill
  if (isMobile && dpr >= 3) score -= 1;

  if (score >= 10) return 'ULTRA';
  if (score >= 6)  return 'HIGH';
  if (score >= 2)  return 'MEDIUM';
  return 'LOW';
}

// ─── QualityManager ───────────────────────────────────────────────────────────
export class QualityManager {
  constructor() {
    const saved    = localStorage.getItem(LS_KEY);
    const autoTier = _autoDetectTier();
    this._tier     = (saved && QUALITY_PRESETS[saved]) ? saved : autoTier;
    this._autoTier = autoTier;

    // Dynamic resolution state
    this._fpsBuf       = [];       // rolling window of FPS samples
    this._currentPR    = this.settings.pixelRatio;
    this._drCooldown   = 0;
    this._drUpTimer    = 0;
    this._renderer     = null;
    this._paused       = false;

    this.onChange = null;          // (tier, settings) => void
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  get tier()     { return this._tier; }
  get settings() { return QUALITY_PRESETS[this._tier]; }
  get autoTier() { return this._autoTier; }

  setTier(tier) {
    if (!QUALITY_PRESETS[tier]) return;
    this._tier     = tier;
    this._currentPR = this.settings.pixelRatio;
    localStorage.setItem(LS_KEY, tier);
    this._applyToRenderer();
    this.onChange?.(tier, this.settings);
  }

  // ─── Attach renderer for dynamic resolution ──────────────────────────────────
  attachRenderer(renderer) {
    this._renderer  = renderer;
    this._currentPR = this.settings.pixelRatio;
    this._applyToRenderer();
  }

  // ─── Apply current settings to a Three.js renderer ────────────────────────
  applyToRenderer(renderer) {
    const s = this.settings;
    // renderer may be our Renderer wrapper (has .renderer) or a raw WebGLRenderer
    const raw = renderer.renderer ?? renderer;
    renderer.setPixelRatio(s.pixelRatio);
    if (raw.shadowMap) {
      raw.shadowMap.enabled = s.shadowsEnabled;
      if (s.shadowsEnabled) raw.shadowMap.type = 2; // PCFSoftShadowMap
    }
  }

  _applyToRenderer() {
    if (!this._renderer) return;
    this.applyToRenderer(this._renderer);
    this._renderer.setPixelRatio(this._currentPR);
  }

  // ─── Create LOD helper for a mesh ─────────────────────────────────────────
  createLOD(highMesh, medMesh, lowMesh) {
    // Lazily import THREE to avoid circular dependency
    // Caller should pass THREE.LOD-compatible API
    const s = this.settings;
    return { highMesh, medMesh, lowMesh, dist: s.zombieLODDist };
  }

  // ─── Dynamic resolution tick ──────────────────────────────────────────────
  tick(dt, fps) {
    if (!this._renderer) return;
    const s = this.settings;
    if (!s.dynamicResolution || this._paused) return;

    this._fpsBuf.push(fps);
    if (this._fpsBuf.length > 90) this._fpsBuf.shift();  // 1.5s at 60fps
    if (this._fpsBuf.length < 30) return;                 // wait for 0.5s of data

    const avg = this._fpsBuf.reduce((a, b) => a + b, 0) / this._fpsBuf.length;

    this._drCooldown -= dt;
    if (this._drCooldown > 0) return;

    if (avg < 45 && this._currentPR > 0.35) {
      this._currentPR    = Math.max(0.35, +(this._currentPR - 0.1).toFixed(2));
      this._renderer.setPixelRatio(this._currentPR);
      this._drCooldown   = 3;
      this._drUpTimer    = 0;
      this._fpsBuf.length = 0;
    } else if (avg > 57) {
      this._drUpTimer += dt;
      if (this._drUpTimer >= 5 && this._currentPR < s.pixelRatio) {
        this._currentPR  = Math.min(s.pixelRatio, +(this._currentPR + 0.05).toFixed(2));
        this._renderer.setPixelRatio(this._currentPR);
        this._drCooldown = 5;
        this._drUpTimer  = 0;
        this._fpsBuf.length = 0;
      }
    } else {
      this._drUpTimer = 0;
    }
  }

  pauseDynamicRes()  { this._paused = true; }
  resumeDynamicRes() { this._paused = false; }

  // ─── Debug info ────────────────────────────────────────────────────────────
  getDebugInfo() {
    return {
      tier:          this._tier,
      autoDetected:  this._autoTier,
      pixelRatio:    this._currentPR.toFixed(2),
      gpu:           _detectGPUTier(),
      memory:        `${navigator.deviceMemory ?? '?'}GB`,
      cores:         navigator.hardwareConcurrency ?? '?',
      mobile:        navigator.maxTouchPoints > 1,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const qualityManager = new QualityManager();

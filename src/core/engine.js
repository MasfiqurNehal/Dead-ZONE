import * as THREE from 'three';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { QUALITY, CAMERA, WORLD, STORAGE } from '../utils/constants.js';
import { detectQualityTier, isMobile, storage, clamp } from '../utils/helpers.js';

const FIXED_DT = 1 / 60; // simulation step
const MAX_SUBSTEPS = 5; // cap to avoid spiral-of-death after a long stall

/**
 * The Engine owns the Three.js scene/camera, the renderer, the input system,
 * and the main loop. Game systems register update callbacks; the engine drives
 * them with a fixed-step simulation and a variable-step frame/render pass.
 */
export class Engine {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = isMobile();

    // --- Quality (saved preference > auto-detected tier) ---
    const saved = storage.get(STORAGE.quality);
    this.qualityName = saved && QUALITY[saved] ? saved : detectQualityTier();
    this.quality = QUALITY[this.qualityName];

    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(WORLD.skyColor);
    this.scene.fog = new THREE.FogExp2(WORLD.fogColor, this.quality.fogDensity);

    // --- Camera ---
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far
    );
    this.camera.position.set(0, 1.6, 0);

    // --- Renderer (WebGL2 + optional postprocessing) ---
    this.renderer = new Renderer(canvas, this.quality);
    this.renderer.initPostprocessing(this.scene, this.camera);

    // --- Input ---
    this.input = new Input(canvas);

    // --- Loop state ---
    this.clock = new THREE.Clock(false);
    this.elapsed = 0;
    this._acc = 0;
    this.running = false;
    this.paused = false;
    this._raf = 0;

    // --- Perf ---
    this.fps = 60;
    this._fpsSmooth = 60;

    // --- System callbacks ---
    this._updaters = new Set(); // (dt, engine) => void  — every frame
    this._fixedUpdaters = new Set(); // (FIXED_DT, engine) => void — fixed step

    // --- Events ---
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);

    this._onVisibility = () => {
      // Avoid a huge dt spike when returning to the tab.
      if (!document.hidden) this.clock.getDelta();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._loop = this._loop.bind(this);
  }

  // --- System registration ---------------------------------------------------

  /** Register a per-frame update. Returns an unsubscribe function. */
  onUpdate(fn) {
    this._updaters.add(fn);
    return () => this._updaters.delete(fn);
  }

  /** Register a fixed-step (1/60s) update. Returns an unsubscribe function. */
  onFixedUpdate(fn) {
    this._fixedUpdaters.add(fn);
    return () => this._fixedUpdaters.delete(fn);
  }

  // --- Loop control ----------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.clock.getDelta(); // discard the first (potentially large) delta
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.clock.stop();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this.clock.getDelta(); // drop accumulated paused time
    }
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);

    const dt = clamp(this.clock.getDelta(), 0, 0.1);

    // Smooth FPS readout.
    if (dt > 0) {
      const inst = 1 / dt;
      this._fpsSmooth += (inst - this._fpsSmooth) * 0.1;
      this.fps = Math.round(this._fpsSmooth);
    }

    if (!this.paused) {
      this.elapsed += dt;

      // Fixed-step simulation.
      this._acc += dt;
      let steps = 0;
      while (this._acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
        for (const fn of this._fixedUpdaters) fn(FIXED_DT, this);
        this._acc -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this._acc = 0; // drop backlog

      // Variable-step frame update.
      for (const fn of this._updaters) fn(dt, this);
    }

    this.renderer.render(this.scene, this.camera, dt);
    this.input.endFrame();
  }

  // --- Resize ----------------------------------------------------------------

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // --- Quality ---------------------------------------------------------------

  /**
   * Persist a quality choice. Pixel ratio and fog update live; shadow/AA/post
   * changes are applied on the next reload (rebuilding the GL pipeline mid-run
   * is intentionally avoided to keep this simple and robust).
   */
  applyQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name;
    this.quality = QUALITY[name];
    storage.set(STORAGE.quality, name);

    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.scene.fog) this.scene.fog.density = this.quality.fogDensity;
  }

  // --- Teardown --------------------------------------------------------------

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.input.dispose();
    this.renderer.dispose();
    this._updaters.clear();
    this._fixedUpdaters.clear();
  }
}

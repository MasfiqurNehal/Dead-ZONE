/**
 * src/fx/particle-system.js — DEAD ZONE visual effects
 *
 * Effects provided:
 *   spawnBlood     — directional blood splat + pooling droplets
 *   spawnMuzzleFlash — camera-space flash quad + gas cloud
 *   spawnSmoke     — drifting grey puff
 *   spawnSparks    — metallic sparks with gravity
 *   spawnDust      — ground impact puff
 *   spawnExplosion — multi-layer shockwave + debris
 *   spawnFire      — sustained flame column
 *   spawnAcid      — green corrosive splash
 *
 * Screen effects (no Three.js objects — pure timing):
 *   hitStop(ms)            — freezes timeScale briefly
 *   slowMo(duration, factor)
 *   screenShake(power, duration)
 *   get timeScale          — multiply engine dt by this
 *   get cameraShakeOffset  — add to camera position each frame
 */

import * as THREE from 'three';

// ─── Pool constants ───────────────────────────────────────────────────────────
const POOL_SIZE         = 2000;   // particles shared across all normal effects
const ADDITIVE_POOL     = 1000;   // additive-blend particles (fire, sparks, muzzle)

// Fire sub-system
const MAX_FIRE_EMITTERS = 8;

// ─── Particle vertex shader ───────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute vec3  aColor;
  attribute float aAlpha;
  attribute float aSize;
  varying vec3    vColor;
  varying float   vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (260.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv) * 2.0;
    if (d > 1.0) discard;
    float a  = vAlpha * (1.0 - d * d);
    gl_FragColor = vec4(vColor, a);
  }
`;

// ─── Particle object (pure data) ─────────────────────────────────────────────
class Particle {
  constructor() {
    this.alive   = false;
    this.px = 0; this.py = 0; this.pz = 0;   // position
    this.vx = 0; this.vy = 0; this.vz = 0;   // velocity
    this.ax = 0; this.ay = 0; this.az = 0;   // acceleration
    this.r = 1;  this.g = 1; this.b = 1;     // color
    this.alpha = 1;
    this.alphaDecay = 1;    // alpha per second
    this.size  = 4;
    this.sizeDecay = 0;
    this.life  = 0;
    this.maxLife = 1;
    this._idx = -1;         // index in pool geometry
  }
  reset() {
    this.alive = false;
    this.px = this.py = this.pz = 0;
    this.vx = this.vy = this.vz = 0;
    this.ax = this.ay = this.az = 0;
    this.r  = this.g = this.b  = 1;
    this.alpha = 1; this.alphaDecay = 1;
    this.size  = 4; this.sizeDecay  = 0;
    this.life  = 0; this.maxLife    = 1;
  }
}

// ─── Particle pool (shared BufferGeometry + Points) ──────────────────────────
class ParticlePool {
  /**
   * @param {THREE.Scene} scene
   * @param {number}      capacity
   * @param {boolean}     additive   true → AdditiveBlending
   */
  constructor(scene, capacity, additive = false) {
    this._capacity = capacity;
    this._pool     = Array.from({ length: capacity }, (_, i) => {
      const p = new Particle(); p._idx = i; return p;
    });
    this._free     = [...this._pool];

    // Buffer attributes
    this._pos   = new Float32Array(capacity * 3);
    this._color = new Float32Array(capacity * 3);
    this._alpha = new Float32Array(capacity);
    this._size  = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos,   3));
    geo.setAttribute('aColor',   new THREE.BufferAttribute(this._color, 3));
    geo.setAttribute('aAlpha',   new THREE.BufferAttribute(this._alpha, 1));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(this._size,  1));
    this._geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms:       {},
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors:   false,
    });

    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    scene.add(this._points);
  }

  alloc() {
    if (this._free.length === 0) return null;
    const p = this._free.pop();
    p.alive = true;
    return p;
  }

  free(p) {
    p.alive = false;
    this._free.push(p);
  }

  tick(dt) {
    for (const p of this._pool) {
      const i3 = p._idx * 3;
      if (!p.alive) {
        this._alpha[p._idx] = 0;
        continue;
      }

      // Integrate
      p.vx += p.ax * dt; p.vy += p.ay * dt; p.vz += p.az * dt;
      p.px += p.vx * dt; p.py += p.vy * dt; p.pz += p.vz * dt;
      p.alpha -= p.alphaDecay * dt;
      p.size  -= p.sizeDecay  * dt;
      p.life  += dt;

      if (p.alpha <= 0 || p.size <= 0 || p.life >= p.maxLife) {
        this.free(p);
        this._alpha[p._idx] = 0;
        continue;
      }

      this._pos[i3]   = p.px; this._pos[i3+1] = p.py; this._pos[i3+2] = p.pz;
      this._color[i3] = p.r;  this._color[i3+1]=p.g;  this._color[i3+2]=p.b;
      this._alpha[p._idx] = p.alpha;
      this._size[p._idx]  = Math.max(0, p.size);
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.aColor.needsUpdate   = true;
    this._geo.attributes.aAlpha.needsUpdate   = true;
    this._geo.attributes.aSize.needsUpdate    = true;
  }

  dispose() {
    this._geo.dispose();
    this._points.material.dispose();
    this._points.parent?.remove(this._points);
  }
}

// ─── Muzzle flash (camera-space billboard quad) ───────────────────────────────
const _FLASH_GEO  = new THREE.PlaneGeometry(0.28, 0.28);
const _FLASH_MAT  = new THREE.MeshBasicMaterial({
  color:       0xffcc44,
  transparent: true,
  depthTest:   false,
  depthWrite:  false,
  blending:    THREE.AdditiveBlending,
  renderOrder: 998,
  side:        THREE.DoubleSide,
});

// ─── Fire emitter (stateful) ──────────────────────────────────────────────────
class FireEmitter {
  constructor() {
    this.active   = false;
    this.pos      = new THREE.Vector3();
    this.scale    = 1;
    this.elapsed  = 0;
    this.duration = 0;    // 0 = permanent until deactivate()
    this._timer   = 0;
    this._rate    = 0.04; // seconds between fire particle bursts
  }
}

// ─── ParticleSystem ───────────────────────────────────────────────────────────
export class ParticleSystem {
  /**
   * @param {THREE.Scene}    scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera}   camera
   * @param {'low'|'medium'|'high'} quality
   */
  constructor(scene, renderer, camera, quality = 'high') {
    this._scene    = scene;
    this._renderer = renderer;
    this._camera   = camera;

    // Quality → particle multiplier
    const qm = { low: 0.3, medium: 0.6, high: 1.0 };
    this._qm = qm[quality] ?? 1.0;

    // Two pools: normal (blood, smoke, dust) and additive (fire, sparks)
    this._pool     = new ParticlePool(scene, Math.floor(POOL_SIZE      * this._qm), false);
    this._addPool  = new ParticlePool(scene, Math.floor(ADDITIVE_POOL  * this._qm), true);

    // Muzzle flash meshes (reuse a fixed set)
    this._flashMeshes = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(_FLASH_GEO, _FLASH_MAT.clone());
      m.visible = false;
      m.renderOrder = 998;
      scene.add(m);
      this._flashMeshes.push({ mesh: m, life: 0 });
    }

    // Fire emitters
    this._fireEmitters = Array.from({ length: MAX_FIRE_EMITTERS }, () => new FireEmitter());

    // Screen-effect state
    this._timeScale   = 1.0;
    this._tsTimer     = 0;      // remaining time at reduced scale
    this._tsTarget    = 1.0;    // target scale
    this._tsRestore   = 1.0;    // normal scale to restore to

    this._shakeAmp    = 0;
    this._shakeDur    = 0;
    this._shakeTime   = 0;
    this._shakeOffset = new THREE.Vector3();

    this._wallTime    = 0;       // actual elapsed wall time (unaffected by timeScale)
  }

  // ── Accessors ─────────────────────────────────────────────────────────────
  /** Multiply engine dt by this to apply global time scaling. */
  get timeScale() { return this._timeScale; }

  /** Add this to camera.position each frame for screen shake. */
  get cameraShakeOffset() { return this._shakeOffset; }

  // ── Screen effects ────────────────────────────────────────────────────────
  /**
   * Freeze time for `ms` milliseconds. Ideal on critical/headshot kills.
   * @param {number} ms    0–200ms recommended
   */
  hitStop(ms = 80) {
    this._timeScale = 0.0;
    this._tsTarget  = 0.0;
    this._tsTimer   = ms / 1000;
    this._tsRestore = 1.0;
  }

  /**
   * Slow the game to `factor` speed for `duration` seconds.
   * @param {number} duration   seconds
   * @param {number} factor     0.1–0.5 recommended
   */
  slowMo(duration = 1.5, factor = 0.2) {
    this._timeScale = factor;
    this._tsTarget  = factor;
    this._tsTimer   = duration;
    this._tsRestore = 1.0;
  }

  /**
   * Apply camera shake.
   * @param {number} power    amplitude in metres (0.01–0.08 for gameplay feel)
   * @param {number} duration seconds
   */
  screenShake(power = 0.04, duration = 0.45) {
    if (power > this._shakeAmp) {   // don't let a weak shake cancel a strong one
      this._shakeAmp  = power;
      this._shakeDur  = duration;
      this._shakeTime = 0;
    }
  }

  // ── Effect spawners ───────────────────────────────────────────────────────

  /**
   * Blood splatter from a zombie hit.
   * @param {THREE.Vector3} pos       world hit position
   * @param {THREE.Vector3} [normal]  surface normal (points away from zombie)
   * @param {number}        [count]
   * @param {boolean}       [headshot]
   */
  spawnBlood(pos, normal, count = 14, headshot = false) {
    const n = Math.floor(count * this._qm);
    for (let i = 0; i < n; i++) {
      const p = this._pool.alloc();
      if (!p) break;

      // Rich dark-red; headshot is brighter and more
      p.r = headshot ? 0.90 : 0.72;
      p.g = headshot ? 0.05 : 0.02;
      p.b = headshot ? 0.05 : 0.02;

      p.px = pos.x + _rf(-0.1, 0.1);
      p.py = pos.y + _rf(0, 0.15);
      p.pz = pos.z + _rf(-0.1, 0.1);

      // Velocity: bias toward normal if provided
      const nx = normal?.x ?? 0, ny = normal?.y ?? 0.2, nz = normal?.z ?? 0;
      const spd = headshot ? _rf(1.5, 4.5) : _rf(0.8, 2.8);
      p.vx = nx * spd + _rf(-spd, spd) * 0.6;
      p.vy = ny * spd + _rf(0.3, 1.6);
      p.vz = nz * spd + _rf(-spd, spd) * 0.6;

      p.ax = 0; p.ay = -9.2; p.az = 0;   // gravity

      p.size      = headshot ? _rf(3.5, 7)  : _rf(2, 5);
      p.sizeDecay = _rf(2, 5);
      p.alpha     = _rf(0.7, 1.0);
      p.alphaDecay = _rf(0.6, 1.4);
      p.maxLife   = _rf(0.4, 1.0);
      p.life = 0;
    }
  }

  /**
   * Muzzle flash at world position.
   * @param {THREE.Vector3} worldPos
   * @param {THREE.Vector3} [dir]   forward direction of barrel
   * @param {'pistol'|'smg'|'shotgun'|'ar'|'sniper'|'crossbow'} [type]
   */
  spawnMuzzleFlash(worldPos, dir, type = 'pistol') {
    // Find a free flash mesh
    const slot = this._flashMeshes.find(s => !s.mesh.visible || s.life <= 0);
    if (slot) {
      const sz = { pistol: 0.16, smg: 0.14, shotgun: 0.32, ar: 0.22, sniper: 0.26, crossbow: 0.10 }[type] ?? 0.18;
      slot.mesh.position.copy(worldPos);
      if (dir) {
        slot.mesh.position.addScaledVector(dir, 0.08);
        slot.mesh.lookAt(worldPos);
        slot.mesh.rotateZ(Math.random() * Math.PI * 2);
      }
      slot.mesh.scale.setScalar(sz * (0.8 + Math.random() * 0.5));
      slot.mesh.material.opacity = 0.9 + Math.random() * 0.1;
      slot.mesh.visible = true;
      slot.life = 0.06 + Math.random() * 0.04;
    }

    // Gas smoke cloud behind flash (additive pool)
    const gasCount = Math.floor((type === 'shotgun' ? 8 : 3) * this._qm);
    for (let i = 0; i < gasCount; i++) {
      const p = this._addPool.alloc();
      if (!p) break;
      p.r = 0.9; p.g = 0.7; p.b = 0.3;
      p.px = worldPos.x + _rf(-0.05, 0.05);
      p.py = worldPos.y + _rf(-0.02, 0.05);
      p.pz = worldPos.z + _rf(-0.05, 0.05);
      const spd = _rf(0.3, 1.2);
      p.vx = (dir?.x ?? 0) * spd + _rf(-0.2, 0.2);
      p.vy = (dir?.y ?? 0) * spd + _rf(0.1, 0.5);
      p.vz = (dir?.z ?? 0) * spd + _rf(-0.2, 0.2);
      p.ax = 0; p.ay = 0.3; p.az = 0;
      p.size      = _rf(3, 7);
      p.sizeDecay = _rf(4, 9);
      p.alpha     = _rf(0.5, 0.9);
      p.alphaDecay = _rf(2, 4);
      p.maxLife   = 0.25;
      p.life = 0;
    }
  }

  /**
   * Smoke puff (gunshot, fire aftermath).
   * @param {THREE.Vector3} pos
   * @param {number} [count]
   * @param {number} [radius]
   */
  spawnSmoke(pos, count = 6, radius = 0.25) {
    const n = Math.floor(count * this._qm);
    for (let i = 0; i < n; i++) {
      const p = this._pool.alloc();
      if (!p) break;
      const grey = _rf(0.18, 0.30);
      p.r = grey; p.g = grey; p.b = grey;
      p.px = pos.x + _rf(-radius, radius);
      p.py = pos.y + _rf(0, 0.1);
      p.pz = pos.z + _rf(-radius, radius);
      p.vx = _rf(-0.25, 0.25); p.vy = _rf(0.4, 1.1); p.vz = _rf(-0.25, 0.25);
      p.ax = 0; p.ay = 0.15; p.az = 0;
      p.size      = _rf(8, 16);
      p.sizeDecay = _rf(3, 7);
      p.alpha     = _rf(0.25, 0.45);
      p.alphaDecay = _rf(0.2, 0.5);
      p.maxLife   = _rf(1.0, 2.5);
      p.life = 0;
    }
  }

  /**
   * Metal sparks (wall/car impact).
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} [normal]
   * @param {number} [count]
   */
  spawnSparks(pos, normal, count = 12) {
    const n = Math.floor(count * this._qm);
    for (let i = 0; i < n; i++) {
      const p = this._addPool.alloc();
      if (!p) break;
      // White → orange sparks
      const t = Math.random();
      p.r = 1.0; p.g = _rf(0.5, 1.0) * t + (1 - t); p.b = t * 0.2;
      p.px = pos.x; p.py = pos.y; p.pz = pos.z;
      const nx = normal?.x ?? 0, ny = normal?.y ?? 0, nz = normal?.z ?? 0;
      const spd = _rf(1.5, 5.0);
      p.vx = nx * spd * 0.5 + _rf(-spd, spd);
      p.vy = Math.abs(ny) * spd * 0.4 + _rf(0.3, spd);
      p.vz = nz * spd * 0.5 + _rf(-spd, spd);
      p.ax = 0; p.ay = -12; p.az = 0;
      p.size      = _rf(1.5, 3.5);
      p.sizeDecay = _rf(3, 8);
      p.alpha     = 1.0;
      p.alphaDecay = _rf(1.5, 4.0);
      p.maxLife   = _rf(0.2, 0.7);
      p.life = 0;
    }
  }

  /**
   * Dust cloud on ground impact.
   * @param {THREE.Vector3} pos
   * @param {number} [count]
   */
  spawnDust(pos, count = 8) {
    const n = Math.floor(count * this._qm);
    for (let i = 0; i < n; i++) {
      const p = this._pool.alloc();
      if (!p) break;
      const brown = _rf(0.55, 0.72);
      p.r = brown; p.g = brown * 0.85; p.b = brown * 0.65;
      p.px = pos.x + _rf(-0.15, 0.15); p.py = pos.y + 0.05; p.pz = pos.z + _rf(-0.15, 0.15);
      p.vx = _rf(-0.8, 0.8); p.vy = _rf(0.4, 1.4); p.vz = _rf(-0.8, 0.8);
      p.ax = 0; p.ay = -1.5; p.az = 0;
      p.size      = _rf(4, 10);
      p.sizeDecay = _rf(4, 9);
      p.alpha     = _rf(0.4, 0.7);
      p.alphaDecay = _rf(0.5, 1.2);
      p.maxLife   = _rf(0.5, 1.2);
      p.life = 0;
    }
  }

  /**
   * Explosion effect (shockwave + fire particles + smoke + sparks).
   * @param {THREE.Vector3} pos
   * @param {number} [radius]   visual scale (metres)
   */
  spawnExplosion(pos, radius = 2.5) {
    this.screenShake(0.06 * radius, 0.6);

    // Core fire burst (additive)
    const fireN = Math.floor(30 * this._qm * Math.min(radius, 3));
    for (let i = 0; i < fireN; i++) {
      const p = this._addPool.alloc();
      if (!p) break;
      const t = Math.random();
      p.r = 1.0; p.g = _rf(0.3, 0.8); p.b = 0.0;
      p.px = pos.x + _rf(-0.2, 0.2);
      p.py = pos.y + _rf(-0.1, 0.3);
      p.pz = pos.z + _rf(-0.2, 0.2);
      const spd = radius * _rf(1.5, 4.5);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      p.vx = Math.sin(ph) * Math.cos(th) * spd;
      p.vy = Math.abs(Math.cos(ph)) * spd * 0.7 + _rf(0, 2);
      p.vz = Math.sin(ph) * Math.sin(th) * spd;
      p.ax = 0; p.ay = -7 - Math.random() * 3; p.az = 0;
      p.size      = _rf(3, 8) * radius * 0.4;
      p.sizeDecay = _rf(6, 14);
      p.alpha     = _rf(0.7, 1.0);
      p.alphaDecay = _rf(1.5, 3.5);
      p.maxLife   = _rf(0.4, 1.2);
      p.life = 0;
    }

    // Smoke aftermath
    this.spawnSmoke(pos, Math.floor(12 * this._qm), radius * 0.4);

    // Debris sparks
    this.spawnSparks(pos, new THREE.Vector3(0, 1, 0), Math.floor(20 * this._qm));

    // Dust ring at base
    this.spawnDust(pos, Math.floor(16 * this._qm));
  }

  /**
   * Flamethrower fire stream. Call every frame the trigger is held.
   * @param {THREE.Vector3} pos    nozzle world position
   * @param {THREE.Vector3} dir    barrel forward direction
   */
  spawnFireStream(pos, dir) {
    const count = Math.floor(3 * this._qm);
    for (let i = 0; i < count; i++) {
      const p = this._addPool.alloc();
      if (!p) break;
      const t = Math.random();
      p.r = 1.0; p.g = _rf(0.25, 0.7); p.b = _rf(0, 0.08);
      p.px = pos.x + _rf(-0.05, 0.05);
      p.py = pos.y + _rf(-0.05, 0.05);
      p.pz = pos.z + _rf(-0.05, 0.05);
      const spd = _rf(5, 9);
      p.vx = dir.x * spd + _rf(-0.5, 0.5);
      p.vy = dir.y * spd + _rf(0.2, 0.8);
      p.vz = dir.z * spd + _rf(-0.5, 0.5);
      p.ax = 0; p.ay = 1.5; p.az = 0;
      p.size      = _rf(4, 11);
      p.sizeDecay = _rf(5, 12);
      p.alpha     = _rf(0.6, 0.9);
      p.alphaDecay = _rf(1.5, 3.5);
      p.maxLife   = _rf(0.3, 0.7);
      p.life = 0;
    }
  }

  /**
   * Sustained fire emitter at a world position (e.g., burning barrel).
   * @param {THREE.Vector3} pos
   * @param {number}        scale   visual scale
   * @param {number}        duration  seconds; 0 = permanent
   * @returns {{ deactivate: Function }}
   */
  spawnFire(pos, scale = 1, duration = 0) {
    const em = this._fireEmitters.find(e => !e.active);
    if (!em) return { deactivate: () => {} };
    em.active   = true;
    em.pos.copy(pos);
    em.scale    = scale;
    em.elapsed  = 0;
    em.duration = duration;
    em._timer   = 0;
    em._rate    = 0.04 / Math.max(1, scale);
    return { deactivate: () => { em.active = false; } };
  }

  /**
   * Acid splash from spitter zombie.
   * @param {THREE.Vector3} pos
   * @param {number} [count]
   */
  spawnAcid(pos, count = 16) {
    const n = Math.floor(count * this._qm);
    for (let i = 0; i < n; i++) {
      const p = this._addPool.alloc();
      if (!p) break;
      p.r = _rf(0.3, 0.5); p.g = _rf(0.7, 1.0); p.b = 0.0;
      p.px = pos.x + _rf(-0.15, 0.15);
      p.py = pos.y + _rf(0, 0.2);
      p.pz = pos.z + _rf(-0.15, 0.15);
      const spd = _rf(1.0, 3.5);
      const th  = Math.random() * Math.PI * 2;
      p.vx = Math.cos(th) * spd; p.vy = _rf(0.5, 2.5); p.vz = Math.sin(th) * spd;
      p.ax = 0; p.ay = -9.5; p.az = 0;
      p.size      = _rf(2.5, 6);
      p.sizeDecay = _rf(3, 7);
      p.alpha     = _rf(0.6, 0.9);
      p.alphaDecay = _rf(0.8, 2.0);
      p.maxLife   = _rf(0.4, 0.9);
      p.life = 0;
    }

    // Corrosive smoke (slightly green)
    for (let i = 0; i < Math.floor(5 * this._qm); i++) {
      const p = this._pool.alloc();
      if (!p) break;
      p.r = 0.2; p.g = 0.4; p.b = 0.1;
      p.px = pos.x + _rf(-0.1, 0.1); p.py = pos.y + 0.2; p.pz = pos.z + _rf(-0.1, 0.1);
      p.vx = _rf(-0.3, 0.3); p.vy = _rf(0.5, 1.2); p.vz = _rf(-0.3, 0.3);
      p.ax = 0; p.ay = 0.2; p.az = 0;
      p.size = _rf(6, 12); p.sizeDecay = _rf(3, 6);
      p.alpha = 0.4; p.alphaDecay = _rf(0.4, 0.9);
      p.maxLife = _rf(1.0, 2.0); p.life = 0;
    }
  }

  // ── Per-frame update ──────────────────────────────────────────────────────
  /**
   * @param {number} wallDt   true elapsed seconds (NOT scaled by timeScale)
   */
  tick(wallDt) {
    this._wallTime += wallDt;

    // ── Time scale management
    if (this._tsTimer > 0) {
      this._tsTimer -= wallDt;
      if (this._tsTimer <= 0) {
        this._timeScale = this._tsRestore;
      }
    }

    // Scale dt for particle physics
    const dt = wallDt * this._timeScale;

    // ── Screen shake
    this._shakeOffset.set(0, 0, 0);
    if (this._shakeTime < this._shakeDur) {
      this._shakeTime += wallDt;
      const t       = this._shakeTime / this._shakeDur;
      const decay   = 1 - t;
      const noise   = Math.sin(this._wallTime * 60) * this._shakeAmp * decay;
      const noise2  = Math.cos(this._wallTime * 55 + 1.3) * this._shakeAmp * decay * 0.7;
      this._shakeOffset.set(noise, noise2, 0);
    }

    // ── Particle pools
    this._pool.tick(dt);
    this._addPool.tick(dt);

    // ── Muzzle flash quads
    for (const slot of this._flashMeshes) {
      if (!slot.mesh.visible) continue;
      slot.life -= wallDt;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
      } else {
        slot.mesh.material.opacity = Math.max(0, slot.life / 0.08);
      }
    }

    // ── Fire emitters
    for (const em of this._fireEmitters) {
      if (!em.active) continue;
      em.elapsed  += wallDt;
      em._timer   -= wallDt;
      if (em.duration > 0 && em.elapsed >= em.duration) {
        em.active = false; continue;
      }
      if (em._timer <= 0) {
        em._timer = em._rate;
        this._emitFireParticle(em);
      }
    }
  }

  /** Emit one fire particle from a FireEmitter. */
  _emitFireParticle(em) {
    const count = Math.max(1, Math.floor(em.scale * 2 * this._qm));
    for (let i = 0; i < count; i++) {
      const p = this._addPool.alloc();
      if (!p) return;
      p.r = 1.0; p.g = _rf(0.3, 0.7); p.b = 0.0;
      p.px = em.pos.x + _rf(-0.15, 0.15) * em.scale;
      p.py = em.pos.y;
      p.pz = em.pos.z + _rf(-0.15, 0.15) * em.scale;
      p.vx = _rf(-0.4, 0.4) * em.scale;
      p.vy = _rf(0.8, 2.5) * em.scale;
      p.vz = _rf(-0.4, 0.4) * em.scale;
      p.ax = 0; p.ay = 0.5; p.az = 0;
      p.size      = _rf(3, 8) * em.scale;
      p.sizeDecay = _rf(5, 11);
      p.alpha     = _rf(0.65, 0.9);
      p.alphaDecay = _rf(1.5, 3.5);
      p.maxLife   = _rf(0.3, 0.8);
      p.life = 0;
    }
    // Occasional smoke puff
    if (Math.random() < 0.15) {
      this.spawnSmoke(
        new THREE.Vector3(em.pos.x, em.pos.y + 0.5 * em.scale, em.pos.z),
        Math.max(1, Math.floor(2 * this._qm)),
        0.12 * em.scale
      );
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  dispose() {
    this._pool.dispose();
    this._addPool.dispose();
    for (const slot of this._flashMeshes) {
      slot.mesh.material.dispose();
      slot.mesh.parent?.remove(slot.mesh);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _rf(min, max) { return min + Math.random() * (max - min); }

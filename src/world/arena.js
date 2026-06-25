/**
 * Arena — DEAD ZONE abandoned city-block environment.
 *
 * 100 × 100 m post-apocalyptic arena built entirely from Three.js primitives
 * + procedural canvas textures.  No external assets required.
 *
 * Wiring (main.js):
 *   const arena = new Arena({ scene, physics, renderer, engine, camera, quality });
 *   await arena.build(pct => setLoadingPercent(pct));
 *   arena.attach(engine);             // registers update loop
 *
 *   // Per-frame pickup query (call with player world position):
 *   const loot = arena.checkAndCollectPickup(playerPos, 1.8);
 *   if (loot?.type === 'health')  player.heal(loot.amount);
 *   if (loot?.type === 'ammo')    player.addAmmo(loot.weapon, loot.rounds);
 *
 *   // Barrel / barricade damage comes from the physics entity.takeDamage path;
 *   // register an explosion callback:
 *   arena.onExplosion = (worldPos, radius) => { ... };
 *
 *   arena.setRain(true);
 */

import * as THREE from 'three';
import {
  EffectPass,
  NormalPass,
  SSAOEffect,
  HueSaturationEffect,
  BlendFunction,
} from 'postprocessing';
import { WORLD, GROUPS } from '../utils/constants.js';
import { makeGroups } from '../core/physics.js';
import { clamp } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Arena dimensions
// ---------------------------------------------------------------------------
const ARENA  = 100;
const HALF   = ARENA / 2;   // 50 — world boundary

// ---------------------------------------------------------------------------
// Layout data — all positions are world-space (Y=0 = ground)
// ---------------------------------------------------------------------------

// Buildings: { cx, cz, w, d, h }  cx/cz=centre, w=width(X), d=depth(Z), h=height
const BUILDINGS = [
  // North row (z < 0)
  { cx: -27, cz: -44, w: 22, d: 13, h: 17 },
  { cx:   8, cz: -43, w: 19, d: 11, h: 21 },
  { cx:  34, cz: -44, w: 20, d: 13, h: 13 }, // shorter — players can climb via rubble ramp
  // South row (z > 0)
  { cx: -30, cz:  43, w: 19, d: 12, h: 19 },
  { cx:   4, cz:  42, w: 23, d: 14, h: 23 },
  { cx:  34, cz:  44, w: 18, d: 11, h: 16 },
  // West row (x < 0)
  { cx: -43, cz: -20, w: 11, d: 23, h: 15 },
  { cx: -43, cz:  17, w: 11, d: 20, h: 12 }, // shorter — climbable
  // East row (x > 0)
  { cx:  43, cz: -16, w: 11, d: 22, h: 16 },
  { cx:  43, cz:  21, w: 11, d: 18, h: 20 },
  // Inner structures (small shops / ruins in mid-area)
  { cx: -21, cz:   8, w:  8, d:  8, h:  7 },
  { cx:  23, cz:  -7, w:  9, d:  8, h:  6 },
];

// Cars: { x, z, ry }
const CARS = [
  { x: -10, z: -26, ry:  0.3 },
  { x:  13, z: -23, ry: -0.8 },
  { x: -26, z:   6, ry:  1.2 },
  { x:  31, z:  11, ry:  2.1 },
  { x:   6, z:  29, ry:  0.5 },
  { x: -14, z:  31, ry: -0.3 },
  { x:  19, z: -33, ry:  1.8 },
  { x: -33, z: -13, ry:  0.9 },
];

// Streetlight pole positions
const LIGHTS = [
  { x:  -8, z: -18 }, { x:   9, z: -31 }, { x: -31, z:   2 },
  { x:  29, z:  -3 }, { x:  -8, z:  23 }, { x:  11, z:  36 },
  { x: -36, z:  -5 }, { x:  36, z:   9 },
];

// Fire/ember embers (warm glow light points)
const FIRES = [
  { x: -18, z:  7 }, { x: 25, z: -14 }, { x: -5, z:  33 },
];

// Crate clusters: [cx, cz, count]
const CRATE_CLUSTERS = [
  [-12, -20, 5], [ 16, -29, 4], [ -5,  10, 6],
  [ 26,   5, 4], [-29,  25, 4], [  9,  33, 3],
  [-22,  -8, 4], [ 18, -14, 5],
];

// Explosive barrel positions
const EXP_BARRELS = [
  { x:  14, z: -20 }, { x: -18, z:  12 }, { x:  28, z:  22 },
  { x: -10, z:  -8 }, { x:   3, z:  18 }, { x: -34, z:  -2 },
];

// Breakable barricades: { x, z, ry }
const BARRICADES = [
  { x: -17, z: -12, ry: 0   },
  { x:  10, z:  -5, ry: 1.5 },
  { x: -5,  z:  15, ry: 0.4 },
  { x:  22, z:   0, ry: 1.1 },
];

// Pickups
const PICKUPS = [
  { type: 'ammo',   weapon: 'rifle',   rounds: 60,  x: -13, z: -20 },
  { type: 'ammo',   weapon: 'shotgun', rounds: 24,  x:  16, z: -28 },
  { type: 'ammo',   weapon: 'pistol',  rounds: 48,  x: -29, z:  13 },
  { type: 'ammo',   weapon: 'rifle',   rounds: 40,  x:  22, z:  30 },
  { type: 'health', amount: 40,                     x:   9, z:  22 },
  { type: 'health', amount: 30,                     x: -18, z: -34 },
  { type: 'health', amount: 50,                     x:  26, z:  16 },
];

// Pre-placed blood decal positions
const BLOOD = [
  [ -8, -15, 0.8], [  4,   6, 0.6], [ 18, -10, 1.0],
  [-20,  20, 0.7], [ 12,  28, 0.9], [ -3, -32, 0.5],
  [ 30,  -5, 1.1], [-15,  -5, 0.8],
];

// Rubble ramp positions for climbable buildings
// { bx, bz: building centre; side: 'N'|'S'|'E'|'W'; targetH: building height }
const RAMPS = [
  { bx:  34, bz: -44, side: 'S', targetH: 13 },
  { bx: -43, bz:  17, side: 'E', targetH: 12 },
];

// ---------------------------------------------------------------------------
// Procedural canvas textures
// ---------------------------------------------------------------------------

function makeCtx(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function canvasToTexture(canvas, repeat = 4) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

function makeConcreteTexture(size = 256) {
  const { c, ctx } = makeCtx(size);
  ctx.fillStyle = '#2a2c30';
  ctx.fillRect(0, 0, size, size);
  // Noise & variation
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = Math.floor(Math.random() * 28 + 30);
    ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // Cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.lineWidth = 0.5 + Math.random();
    let cx = Math.random() * size, cy = Math.random() * size;
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += (Math.random() - 0.5) * 30;
      cy += (Math.random() - 0.5) * 30;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  // Subtle horizontal form-work lines
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.8;
  for (let y = 32; y < size; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y + (Math.random() - 0.5) * 4);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }
  return canvasToTexture(c, 8);
}

function makeAsphaltTexture(size = 256) {
  const { c, ctx } = makeCtx(size);
  ctx.fillStyle = '#111214';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = Math.floor(Math.random() * 20 + 14);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }
  // Cracks in asphalt
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.lineWidth = Math.random() * 1.5;
    let ax = Math.random() * size, ay = Math.random() * size;
    ctx.moveTo(ax, ay);
    for (let s = 0; s < 4; s++) {
      ax += (Math.random() - 0.5) * 40;
      ay += (Math.random() - 0.5) * 40;
      ctx.lineTo(ax, ay);
    }
    ctx.stroke();
  }
  return canvasToTexture(c, 10);
}

function makeMetalTexture(size = 128) {
  const { c, ctx } = makeCtx(size);
  ctx.fillStyle = '#303234';
  ctx.fillRect(0, 0, size, size);
  // Horizontal brush lines
  for (let y = 0; y < size; y++) {
    const v = Math.floor(Math.random() * 12 + 40);
    ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
    ctx.fillRect(0, y, size, 1);
  }
  // Rust streaks
  for (let i = 0; i < 6; i++) {
    const rx = Math.random() * size;
    const ry = Math.random() * size;
    const g = ctx.createLinearGradient(rx, ry, rx + 4, ry + 40);
    g.addColorStop(0, 'rgba(120,50,20,0.7)');
    g.addColorStop(1, 'rgba(120,50,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, 3 + Math.random() * 4, 40 + Math.random() * 30);
  }
  return canvasToTexture(c, 4);
}

function makeWoodTexture(size = 128) {
  const { c, ctx } = makeCtx(size);
  ctx.fillStyle = '#5a3d20';
  ctx.fillRect(0, 0, size, size);
  // Wood grain lines
  for (let y = 0; y < size; y++) {
    const noise = Math.sin(y * 0.4) * 3 + (Math.random() - 0.5) * 2;
    const v = Math.floor(noise + 85 + Math.random() * 15);
    const r = clamp(v - 15, 50, 140);
    const g = clamp(v - 30, 30, 100);
    const b = clamp(v - 50, 10, 50);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, size, 1);
  }
  return canvasToTexture(c, 3);
}

function makeBloodTexture(size = 64) {
  const { c, ctx } = makeCtx(size);
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5, cy = size * 0.5;
  // Splash circle
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
  g.addColorStop(0,   'rgba(110,8,12,0.95)');
  g.addColorStop(0.6, 'rgba(80,5,8,0.6)');
  g.addColorStop(1,   'rgba(60,3,5,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Droplets
  for (let i = 0; i < 12; i++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.9;
    const by = cy + (Math.random() - 0.5) * size * 0.9;
    const r  = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90,5,8,0.9)';
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Tiny seeded pseudo-random (so layout is deterministic per session reload)
// ---------------------------------------------------------------------------
let _seed = 0x12345678;
function seededRand() {
  _seed ^= _seed << 13; _seed ^= _seed >> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) / 0xffffffff);
}

// ---------------------------------------------------------------------------
// Interactive entity classes
// ---------------------------------------------------------------------------

class ExplosiveBarrel {
  constructor(arena, body, mesh) {
    this.arena  = arena;
    this.body   = body;
    this.mesh   = mesh;
    this.health = 50;
    this.type   = 'explosive_barrel';
    this.surface = 'metal';
  }
  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) this.arena._explodeBarrel(this);
  }
}

class Barricade {
  constructor(arena, body, mesh, maxHp = 80) {
    this.arena  = arena;
    this.body   = body;
    this.mesh   = mesh;
    this.health = maxHp;
    this.type   = 'barricade';
    this.surface = 'wood';
  }
  takeDamage(amount) {
    this.health -= amount;
    const t = clamp(1 - this.health / 80, 0, 1);
    if (this.mesh.material) this.mesh.material.color.setScalar(0.35 + 0.15 * (1 - t));
    if (this.health <= 0) this.arena._breakBarricade(this);
  }
}

// ---------------------------------------------------------------------------
// Main Arena class
// ---------------------------------------------------------------------------

export class Arena {
  constructor(ctx) {
    this.scene    = ctx.scene;
    this.physics  = ctx.physics;
    this.renderer = ctx.renderer;
    this.engine   = ctx.engine;
    this.camera   = ctx.camera;
    this.quality  = ctx.quality;

    this.rainEnabled  = false;
    this.onExplosion  = null;  // (worldPos, radius) => void

    // Disposable resource tracking
    this._geo  = [];
    this._mats = [];
    this._tex  = [];
    this._meshes = [];
    this._bodies = [];

    // Runtime state
    this._pointLights   = [];
    this._lightningLight = null;
    this._lightningTimer = 12;
    this._rain = null;
    this._rainVel = null;
    this._dust = null;
    this._pickups = [];
    this._pickupMeshes = [];
    this._explosiveBarrels = [];
    this._barricades = [];

    // Pre-built material cache (created lazily in _buildMaterials)
    this._mat = null;

    this._onUpdate = (dt, eng) => this.update(dt, eng._playerPos || null);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Builds the entire arena; `onProgress(0..100)` is called periodically. */
  async build(onProgress = () => {}) {
    const steps = [
      ['Paving streets …',     () => this._buildGround()],
      ['Raising walls …',      () => this._buildBoundary()],
      ['Constructing buildings …', () => this._buildBuildings()],
      ['Placing vehicles …',   () => this._buildStreetFeatures()],
      ['Stacking cover …',     () => this._buildCover()],
      ['Adding barricades …',  () => this._buildBarricades()],
      ['Dropping loot …',      () => this._buildPickups()],
      ['Painting the town …',  () => this._buildDecals()],
      ['Lighting the scene …', () => this._buildLighting()],
      ['Weather …',            () => this._buildParticles()],
      ['Post-processing …',    () => this._initPostProcessing()],
    ];

    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      onProgress(Math.round((i / steps.length) * 100), label);
      fn();
      // Yield to the event loop so the loading screen can repaint.
      await new Promise(r => setTimeout(r, 0));
    }
    onProgress(100, 'Arena ready');
  }

  /** Register update loop on the engine. Returns an unsubscribe function. */
  attach(engine = this.engine) {
    return engine.onUpdate(this._onUpdate);
  }

  /** Per-frame update — call with player's world position for pickup detection. */
  update(dt, playerPos = null) {
    this._updateLights(dt);
    this._updateLightning(dt);
    this._updateParticles(dt);
    this._updatePickupBob(dt);
  }

  /**
   * Check if the player is within `radius` m of any pickup and collect it.
   * @returns {{ type, amount?, weapon?, rounds? } | null}
   */
  checkAndCollectPickup(playerPos, radius = 2) {
    if (!playerPos || this._pickups.length === 0) return null;
    const r2 = radius * radius;
    for (let i = 0; i < this._pickups.length; i++) {
      const p = this._pickups[i];
      const dx = playerPos.x - p.x, dz = playerPos.z - p.z;
      if (dx * dx + dz * dz < r2) {
        this._collectPickup(i);
        return { type: p.type, amount: p.amount, weapon: p.weapon, rounds: p.rounds };
      }
    }
    return null;
  }

  setRain(on) {
    this.rainEnabled = !!on;
    if (this._rain) this._rain.visible = this.rainEnabled;
  }

  // -------------------------------------------------------------------------
  // Build helpers
  // -------------------------------------------------------------------------

  _buildMaterials() {
    // Build all canvas textures once
    const concrTex  = makeConcreteTexture(256);
    const asphTex   = makeAsphaltTexture(256);
    const metalTex  = makeMetalTexture(128);
    const woodTex   = makeWoodTexture(128);
    this._tex.push(concrTex, asphTex, metalTex, woodTex);

    const mk = (opts) => {
      const m = new THREE.MeshStandardMaterial(opts);
      this._mats.push(m);
      return m;
    };

    this._mat = {
      ground: mk({ map: asphTex, roughness: 0.94, metalness: 0.0, color: 0xbbbbcc }),
      concrete: mk({ map: concrTex, roughness: 0.9, metalness: 0.0, color: 0xccccdd }),
      concreteDark: mk({ map: concrTex, roughness: 0.95, metalness: 0.0, color: 0x777788 }),
      metal: mk({ map: metalTex, roughness: 0.65, metalness: 0.6, color: 0x888899 }),
      rust: mk({ map: metalTex, roughness: 0.85, metalness: 0.4, color: 0x6a4030 }),
      wood: mk({ map: woodTex, roughness: 0.92, metalness: 0.0, color: 0x8a6040 }),
      glass: mk({ color: 0x080c14, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 }),
      fence: mk({ map: metalTex, roughness: 0.8, metalness: 0.45, color: 0x555560, side: THREE.DoubleSide }),
      carBody: mk({ map: metalTex, roughness: 0.55, metalness: 0.65, color: 0x303035 }),
      lampPost: mk({ roughness: 0.7, metalness: 0.8, color: 0x444450 }),
      bloodDecal: mk({ color: 0x5a0808, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0.85, depthWrite: false }),
      pickupAmmo:   mk({ color: 0x4a8a3a, roughness: 0.6, metalness: 0.3, emissive: 0x1a4010, emissiveIntensity: 0.5 }),
      pickupHealth: mk({ color: 0xaa2020, roughness: 0.6, metalness: 0.2, emissive: 0x550808, emissiveIntensity: 0.7 }),
      barrel:       mk({ color: 0x303838, roughness: 0.7, metalness: 0.5 }),
      barrelExp:    mk({ color: 0x552808, roughness: 0.7, metalness: 0.4, emissive: 0x200800, emissiveIntensity: 0.4 }),
    };
  }

  _track(obj) {
    // Convenience: add a mesh to the scene and track for disposal
    if (obj.isMesh || obj.isInstancedMesh || obj.isLine || obj.isPoints || obj.isGroup) {
      this._meshes.push(obj);
      this.scene.add(obj);
    }
    return obj;
  }

  _addBody(body) { this._bodies.push(body); return body; }

  _box(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    this._geo.push(g);
    return g;
  }

  _cyl(rt, rb, h, segs = 8) {
    const g = new THREE.CylinderGeometry(rt, rb, h, segs);
    this._geo.push(g);
    return g;
  }

  _plane(w, h) {
    const g = new THREE.PlaneGeometry(w, h);
    this._geo.push(g);
    return g;
  }

  _mesh(geo, mat, { cx = 0, cy = 0, cz = 0, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, cz);
    m.rotation.set(rx, ry, rz);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    return this._track(m);
  }

  // ---- Ground ---------------------------------------------------------------

  _buildGround() {
    this._buildMaterials();

    // Base asphalt plane
    const g = this._plane(ARENA, ARENA);
    const m = this._mesh(g, this._mat.ground, { cx: 0, cy: 0, cz: 0, rx: -Math.PI / 2 });
    m.receiveShadow = true;
    m.castShadow = false;

    // Physics ground
    this._addBody(this.physics.createGround(ARENA + 10, 0));

    // Cracked plaza inset (slightly lighter patch in the middle)
    const plazaG = this._plane(28, 28);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: (() => {
        const t = makeConcreteTexture(128);
        t.repeat.set(4, 4);
        this._tex.push(t);
        return t;
      })(),
      roughness: 0.9, metalness: 0.0, color: 0x909098,
    });
    this._mats.push(plazaMat);
    const plaza = new THREE.Mesh(plazaG, plazaMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.01, 0);
    plaza.receiveShadow = true;
    this._meshes.push(plaza);
    this.scene.add(plaza);
  }

  // ---- Boundary walls -------------------------------------------------------

  _buildBoundary() {
    const H = 8, T = 0.5;
    const segments = [
      // North, South, East, West
      { cx: 0, cz: -(HALF + T/2), w: ARENA + T*2, d: T, h: H },
      { cx: 0, cz:  (HALF + T/2), w: ARENA + T*2, d: T, h: H },
      { cx:  (HALF + T/2), cz: 0, w: T, d: ARENA,  h: H },
      { cx: -(HALF + T/2), cz: 0, w: T, d: ARENA,  h: H },
    ];

    for (const s of segments) {
      const g = this._box(s.w, s.h, s.d);
      const m = this._mesh(g, this._mat.concreteDark, { cx: s.cx, cy: s.h / 2, cz: s.cz });
      // Physics body
      this._addBody(this.physics.createFixedBox(
        { x: s.cx, y: s.h / 2, z: s.cz },
        { x: s.w / 2, y: s.h / 2, z: s.d / 2 },
        GROUPS.WORLD, 0xffff
      ));
      // Rusted fence panels on top of wall
      this._buildFenceRow(s.cx, s.h, s.cz, s.w, s.d);
    }
  }

  _buildFenceRow(cx, baseY, cz, totalW, totalD) {
    const postH = 1.4, postR = 0.06;
    const isNS = totalW > totalD; // wall runs east–west
    const len = isNS ? totalW : totalD;
    const count = Math.floor(len / 2.5);
    const g = this._cyl(postR, postR, postH, 6);
    const instM = new THREE.InstancedMesh(g, this._mat.fence, count);
    instM.castShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1)) * len - len / 2;
      dummy.position.set(
        cx + (isNS ? t : 0),
        baseY + postH / 2,
        cz + (isNS ? 0 : t)
      );
      dummy.updateMatrix();
      instM.setMatrixAt(i, dummy.matrix);
    }
    instM.instanceMatrix.needsUpdate = true;
    this._meshes.push(instM);
    this.scene.add(instM);
  }

  // ---- Buildings ------------------------------------------------------------

  _buildBuildings() {
    const dummy = new THREE.Object3D();

    for (const b of BUILDINGS) {
      // Main volume
      const mainG = this._box(b.w, b.h, b.d);
      const main  = this._mesh(mainG, this._mat.concrete, { cx: b.cx, cy: b.h / 2, cz: b.cz });

      // Physics body
      this._addBody(this.physics.createFixedBox(
        { x: b.cx, y: b.h / 2, z: b.cz },
        { x: b.w / 2, y: b.h / 2, z: b.d / 2 },
        GROUPS.WORLD, 0xffff
      ));

      // Rooftop parapet
      const pW = 0.4;
      for (const side of ['n', 's', 'e', 'w']) {
        const pw = side === 'e' || side === 'w' ? pW : b.w + pW * 2;
        const pd = side === 'e' || side === 'w' ? b.d : pW;
        const px = side === 'e' ? b.cx + b.w / 2 + pW / 2 : side === 'w' ? b.cx - b.w / 2 - pW / 2 : b.cx;
        const pz = side === 'n' ? b.cz - b.d / 2 - pW / 2 : side === 's' ? b.cz + b.d / 2 + pW / 2 : b.cz;
        const pH = 0.8;
        const pg = this._box(pw, pH, pd);
        this._mesh(pg, this._mat.concreteDark, { cx: px, cy: b.h + pH / 2, cz: pz });
      }

      // Rooftop detail: AC units / water tower
      const detCount = 1 + Math.floor(seededRand() * 3);
      for (let i = 0; i < detCount; i++) {
        const dw = 0.8 + seededRand() * 1.2;
        const dh = 0.6 + seededRand() * 1.2;
        const dx = b.cx + (seededRand() - 0.5) * (b.w - dw - 0.5);
        const dz = b.cz + (seededRand() - 0.5) * (b.d - dw - 0.5);
        const dg = this._box(dw, dh, dw);
        this._mesh(dg, this._mat.concreteDark, { cx: dx, cy: b.h + dh / 2, cz: dz });
      }

      // Windows: grid of dark planes on each long face
      this._addWindows(b);
    }

    // Rubble ramps for climbable buildings
    for (const r of RAMPS) this._buildRamp(r);
  }

  _addWindows(b) {
    const wW = 0.9, wH = 1.2, wInset = 0.04;
    const faces = [
      { axis: 'z', sign: -1, faceW: b.w, faceH: b.h, px: b.cx, pz: b.cz - b.d / 2 - wInset, ry: Math.PI },
      { axis: 'z', sign:  1, faceW: b.w, faceH: b.h, px: b.cx, pz: b.cz + b.d / 2 + wInset, ry: 0 },
      { axis: 'x', sign: -1, faceW: b.d, faceH: b.h, px: b.cx - b.w / 2 - wInset, pz: b.cz, ry: -Math.PI / 2 },
      { axis: 'x', sign:  1, faceW: b.d, faceH: b.h, px: b.cx + b.w / 2 + wInset, pz: b.cz, ry:  Math.PI / 2 },
    ];

    const cols = Math.max(1, Math.floor(b.w / 2.2));
    const rows = Math.max(1, Math.floor(b.h / 2.6) - 1);

    // One instanced mesh of window panes for the whole building
    const totalWins = faces.length * cols * rows;
    const winG = this._plane(wW, wH);
    const instW = new THREE.InstancedMesh(winG, this._mat.glass, totalWins);
    instW.castShadow = false;
    instW.receiveShadow = false;

    let idx = 0;
    const dummy = new THREE.Object3D();
    for (const face of faces) {
      const fc = face.axis === 'z' ? b.w : b.d;
      const localCols = Math.max(1, Math.floor(fc / 2.2));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < localCols; c++) {
          if (seededRand() < 0.1) { idx++; continue; } // occasional missing window
          const u = (c + 0.5) / localCols;
          const v = (r + 1) / (rows + 1);
          if (face.axis === 'z') {
            dummy.position.set(face.px + (u - 0.5) * b.w, v * b.h, face.pz);
          } else {
            dummy.position.set(face.px, v * b.h, face.pz + (u - 0.5) * b.d);
          }
          dummy.rotation.y = face.ry;
          dummy.updateMatrix();
          if (idx < totalWins) instW.setMatrixAt(idx++, dummy.matrix);
        }
      }
    }
    instW.count = idx;
    instW.instanceMatrix.needsUpdate = true;
    this._meshes.push(instW);
    this.scene.add(instW);
  }

  /** Angled rubble ramp up to the climbable building's roof. */
  _buildRamp(r) {
    const b = BUILDINGS.find(b => b.cx === r.bx && b.cz === r.bz);
    if (!b) return;
    const rampL = b.h / Math.tan((45 * Math.PI) / 180); // 45° ramp
    const rampH = b.h;
    const rampT = 0.4;

    let cx = b.cx, cz = b.cz, ry = 0;
    if (r.side === 'S') { cz = b.cz + b.d / 2 + rampL / 2; ry = 0; }
    if (r.side === 'N') { cz = b.cz - b.d / 2 - rampL / 2; ry = Math.PI; }
    if (r.side === 'E') { cx = b.cx + b.w / 2 + rampL / 2; ry = -Math.PI / 2; }
    if (r.side === 'W') { cx = b.cx - b.w / 2 - rampL / 2; ry =  Math.PI / 2; }

    const rampG = this._box(3, rampT, rampL);
    const angle = Math.atan2(rampH, rampL);
    const mid = new THREE.Mesh(rampG, this._mat.concreteDark);
    mid.position.set(cx, rampH / 2, cz);
    mid.rotation.y = ry;
    mid.rotation.z = r.side === 'E' || r.side === 'W' ? 0 : 0;
    // Tilt the ramp along the approach axis
    if (r.side === 'S' || r.side === 'N') mid.rotation.x = (r.side === 'S' ? 1 : -1) * angle;
    else mid.rotation.z = (r.side === 'E' ? 1 : -1) * angle;
    mid.castShadow = true; mid.receiveShadow = true;
    this._meshes.push(mid);
    this.scene.add(mid);

    // Physics: angled box collider
    // Approximate with a series of steps (simpler than angled trimesh)
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const sy = rampH * t;
      const sOffset = rampL * (t - 0.5);
      let sx = cx, sz = cz;
      if (r.side === 'S') sz = b.cz + b.d / 2 + sOffset + rampL / 2;
      else if (r.side === 'N') sz = b.cz - b.d / 2 - sOffset - rampL / 2;
      else if (r.side === 'E') sx = b.cx + b.w / 2 + sOffset + rampL / 2;
      else sx = b.cx - b.w / 2 - sOffset - rampL / 2;
      const stepH = (rampH / steps) * 2;
      this._addBody(this.physics.createFixedBox(
        { x: sx, y: sy, z: sz },
        { x: r.side === 'E' || r.side === 'W' ? rampL / steps / 2 : 1.5,
          y: stepH / 2,
          z: r.side === 'S' || r.side === 'N' ? rampL / steps / 2 : 1.5 },
        GROUPS.WORLD, 0xffff
      ));
    }
  }

  // ---- Street features (cars, lamp posts) -----------------------------------

  _buildStreetFeatures() {
    this._buildCars();
    this._buildStreetlights();
    this._buildDebrisPiles();
  }

  _buildCars() {
    for (const c of CARS) {
      const group = new THREE.Group();
      // Chassis
      const chG = this._box(4.4, 0.7, 1.9);
      const ch  = new THREE.Mesh(chG, this._mat.carBody);
      ch.position.y = 0.35;
      ch.castShadow = true; ch.receiveShadow = true;
      group.add(ch);
      // Cabin
      const caG = this._box(2.2, 0.65, 1.75);
      const ca  = new THREE.Mesh(caG, this._mat.carBody);
      ca.position.set(-0.3, 1.02, 0);
      ca.castShadow = true;
      group.add(ca);
      // Windshield (dark glass)
      const wG = this._plane(1.6, 0.6);
      const w  = new THREE.Mesh(wG, this._mat.glass);
      w.position.set(0.82, 1.0, 0);
      w.rotation.y = 0.4;
      group.add(w);
      // Wheels (cylinders)
      const wPositions = [
        [ 1.5, 0, 0.9], [ 1.5, 0, -0.9],
        [-1.5, 0, 0.9], [-1.5, 0, -0.9],
      ];
      const wheelG = this._cyl(0.32, 0.32, 0.18, 10);
      const wheelM = this._mat.metal;
      for (const [wx, wy, wz] of wPositions) {
        const wm = new THREE.Mesh(wheelG, wheelM);
        wm.rotation.z = Math.PI / 2;
        wm.position.set(wx, 0.32, wz);
        wm.castShadow = true;
        group.add(wm);
      }
      group.position.set(c.x, 0, c.z);
      group.rotation.y = c.ry;
      // Slight random tilt for destroyed look
      group.rotation.z = (seededRand() - 0.5) * 0.12;
      this.scene.add(group);
      this._meshes.push(group);

      // Physics: one big box per car
      this._addBody(this.physics.createFixedBox(
        { x: c.x, y: 0.7, z: c.z },
        { x: 2.3, y: 0.7, z: 1.0 },
        GROUPS.WORLD, 0xffff
      ));
    }
  }

  _buildStreetlights() {
    for (const lp of LIGHTS) {
      const poleG = this._cyl(0.06, 0.06, 5.5, 6);
      this._mesh(poleG, this._mat.lampPost, { cx: lp.x, cy: 2.75, cz: lp.z });

      const armG = this._box(0.05, 0.05, 1.1);
      this._mesh(armG, this._mat.lampPost, { cx: lp.x, cy: 5.4, cz: lp.z + 0.55 });

      const hoodG = this._cyl(0.22, 0.28, 0.18, 8);
      this._mesh(hoodG, this._mat.lampPost, { cx: lp.x, cy: 5.3, cz: lp.z + 1.0 });

      // Emissive bulb
      const bulbG = this._cyl(0.12, 0.12, 0.05, 8);
      const bulbM = new THREE.MeshStandardMaterial({
        color: 0xffc060,
        emissive: 0xffa030,
        emissiveIntensity: 3.0,
        roughness: 0.4,
      });
      this._mats.push(bulbM);
      this._mesh(bulbG, bulbM, { cx: lp.x, cy: 5.2, cz: lp.z + 1.0 });

      // Point light
      const broken = seededRand() < 0.25;
      const light = new THREE.PointLight(0xffa040, broken ? 0 : 4.0, 26, 2);
      light.position.set(lp.x, 5.15, lp.z + 1.0);
      light.castShadow = this.quality.shadows;
      if (this.quality.shadows) {
        light.shadow.mapSize.set(256, 256);
        light.shadow.camera.near = 0.2;
        light.shadow.camera.far = 20;
        light.shadow.bias = -0.003;
      }
      light.userData = {
        base: 4.0,
        broken,
        fire: false,
        phase: seededRand() * Math.PI * 2,
      };
      this.scene.add(light);
      this._pointLights.push(light);
    }

    // Fire/ember glow lights
    for (const f of FIRES) {
      const light = new THREE.PointLight(0xff5500, 3.0, 8, 2);
      light.position.set(f.x, 0.7, f.z);
      light.userData = { base: 3.0, broken: true, fire: true, phase: seededRand() * Math.PI * 2 };
      this.scene.add(light);
      this._pointLights.push(light);

      // Visual fire — glowing cone
      const fG = this._cyl(0, 0.3, 0.8, 6);
      const fM = new THREE.MeshStandardMaterial({
        color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 4,
        transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      });
      this._mats.push(fM);
      this._mesh(fG, fM, { cx: f.x, cy: 0.4, cz: f.z });
    }
  }

  _buildDebrisPiles() {
    // Random rock/rubble chunks scattered around
    const positions = [
      [-8, -10], [14, 5], [-22, 18], [5, -36], [32, -20], [-38, 22],
    ];
    for (const [px, pz] of positions) {
      const n = 3 + Math.floor(seededRand() * 4);
      for (let i = 0; i < n; i++) {
        const s = 0.3 + seededRand() * 0.6;
        const g = this._box(s, s * 0.7, s * 0.8);
        this._mesh(g, this._mat.concreteDark, {
          cx: px + (seededRand() - 0.5) * 2,
          cy: s * 0.35,
          cz: pz + (seededRand() - 0.5) * 2,
          ry: seededRand() * Math.PI,
        });
      }
    }
  }

  // ---- Cover objects --------------------------------------------------------

  _buildCover() {
    // Instanced crates
    const cratePositions = [];
    for (const [cx, cz, count] of CRATE_CLUSTERS) {
      for (let i = 0; i < count; i++) {
        cratePositions.push({
          x: cx + (seededRand() - 0.5) * 3,
          y: 0,
          z: cz + (seededRand() - 0.5) * 3,
          ry: seededRand() * Math.PI,
          stack: seededRand() < 0.3 ? 1 : 0,
        });
        if (cratePositions[cratePositions.length - 1].stack) {
          cratePositions.push({
            x: cx + (seededRand() - 0.5) * 3,
            y: 0.9,
            z: cz + (seededRand() - 0.5) * 3,
            ry: seededRand() * Math.PI,
            stack: 0,
          });
        }
      }
    }

    const crateG = this._box(0.88, 0.88, 0.88);
    const crateM = new THREE.InstancedMesh(crateG, this._mat.wood, cratePositions.length);
    crateM.castShadow = true;
    crateM.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cratePositions.length; i++) {
      const cp = cratePositions[i];
      dummy.position.set(cp.x, cp.y + 0.44, cp.z);
      dummy.rotation.y = cp.ry;
      dummy.updateMatrix();
      crateM.setMatrixAt(i, dummy.matrix);
      // Physics body per crate
      this._addBody(this.physics.createFixedBox(
        { x: cp.x, y: cp.y + 0.44, z: cp.z },
        { x: 0.44, y: 0.44, z: 0.44 },
        GROUPS.WORLD, 0xffff
      ));
    }
    crateM.instanceMatrix.needsUpdate = true;
    this._meshes.push(crateM);
    this.scene.add(crateM);

    // Explosive barrels
    const barrelG = this._cyl(0.25, 0.28, 0.85, 12);
    const barrelCapG = this._cyl(0.28, 0.28, 0.08, 12);

    for (const bp of EXP_BARRELS) {
      // Visual
      const bm  = new THREE.Mesh(barrelG,    this._mat.barrelExp);
      const bc  = new THREE.Mesh(barrelCapG, this._mat.barrel);
      bm.castShadow = true;
      bc.position.y = 0.425 + 0.04;
      bm.position.set(bp.x, 0.425, bp.z);
      bc.position.x = bp.x; bc.position.z = bp.z; bc.position.y = 0.45;
      this.scene.add(bm); this.scene.add(bc);
      this._meshes.push(bm, bc);

      // Physics
      const body = this.physics.createCapsule(
        { x: bp.x, y: 0.6, z: bp.z }, 0.26, 0.2,
        GROUPS.WORLD, 0xffff, false
      );
      const entity = new ExplosiveBarrel(this, body, bm);
      this.physics.register(body, entity);
      this._explosiveBarrels.push(entity);
      this._addBody(body);
    }

    // Normal inert barrels (2-3 in corners)
    const inertBarrels = [
      { x: -15, z: -8 }, { x: 20, z: 28 }, { x: -28, z: 20 },
    ];
    const inertM = new THREE.InstancedMesh(barrelG, this._mat.barrel, inertBarrels.length);
    inertM.castShadow = true;
    for (let i = 0; i < inertBarrels.length; i++) {
      const ib = inertBarrels[i];
      dummy.position.set(ib.x, 0.425, ib.z);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      inertM.setMatrixAt(i, dummy.matrix);
      this._addBody(this.physics.createFixedBox(
        { x: ib.x, y: 0.425, z: ib.z }, { x: 0.28, y: 0.43, z: 0.28 }, GROUPS.WORLD, 0xffff
      ));
    }
    inertM.instanceMatrix.needsUpdate = true;
    this._meshes.push(inertM);
    this.scene.add(inertM);
  }

  // ---- Breakable barricades -------------------------------------------------

  _buildBarricades() {
    for (const bd of BARRICADES) {
      const g = this._box(2.4, 1.4, 0.18);
      const m = new THREE.Mesh(g, this._mat.wood.clone());
      this._mats.push(m.material);
      m.position.set(bd.x, 0.7, bd.z);
      m.rotation.y = bd.ry;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this._meshes.push(m);

      const body = this.physics.createFixedBox(
        { x: bd.x, y: 0.7, z: bd.z },
        { x: 1.2, y: 0.7, z: 0.09 },
        GROUPS.WORLD, 0xffff
      );
      const entity = new Barricade(this, body, m);
      this.physics.register(body, entity);
      this._barricades.push(entity);
      this._addBody(body);
    }
  }

  // ---- Pickups --------------------------------------------------------------

  _buildPickups() {
    for (const p of PICKUPS) {
      const isHealth = p.type === 'health';
      const g = isHealth
        ? new THREE.BoxGeometry(0.35, 0.35, 0.35)
        : new THREE.BoxGeometry(0.4, 0.2, 0.25);
      this._geo.push(g);
      const mat = isHealth ? this._mat.pickupHealth : this._mat.pickupAmmo;
      const m = new THREE.Mesh(g, mat);
      m.position.set(p.x, isHealth ? 0.5 : 0.35, p.z);
      m.castShadow = true;
      this.scene.add(m);
      this._meshes.push(m);
      this._pickups.push({ ...p, mesh: m, baseY: m.position.y });
      this._pickupMeshes.push(m);

      // Small point light above pickups for visibility
      const glow = new THREE.PointLight(isHealth ? 0xff3030 : 0x30ff60, 0.8, 3, 2);
      glow.position.set(p.x, 1.2, p.z);
      this.scene.add(glow);
      this._pointLights.push(glow);
      glow.userData = { base: 0.8, broken: false, fire: false, pickup: true, phase: seededRand() * Math.PI * 2 };
    }
  }

  // ---- Blood decals ---------------------------------------------------------

  _buildDecals() {
    const bloodTex = makeBloodTexture(64);
    this._tex.push(bloodTex);
    const bloodMat = new THREE.MeshStandardMaterial({
      map: bloodTex,
      roughness: 0.95, metalness: 0, transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    this._mats.push(bloodMat);

    for (const [bx, bz, scale] of BLOOD) {
      const g = this._plane(scale * 2, scale * 2);
      const m = new THREE.Mesh(g, bloodMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = seededRand() * Math.PI * 2;
      m.position.set(bx, 0.005, bz);
      m.receiveShadow = false;
      this.scene.add(m);
      this._meshes.push(m);
    }

    // Graffiti on a couple of building walls (coloured plane overlays)
    const graffitiData = [
      { cx: -27, cz: -44 - 6.5 - 0.02, ry: Math.PI, scale: 3.5 },
      { cx:  43 + 5.5 + 0.02, cz: -16, ry: Math.PI / 2, scale: 2.8 },
    ];
    const grMat = new THREE.MeshStandardMaterial({
      color: 0xff2020, emissive: 0x220000, emissiveIntensity: 0.3,
      roughness: 0.98, transparent: true, opacity: 0.7,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    this._mats.push(grMat);
    for (const gr of graffitiData) {
      const g = this._plane(gr.scale, gr.scale * 0.55);
      const m = new THREE.Mesh(g, grMat);
      m.position.set(gr.cx, 2.2, gr.cz);
      m.rotation.y = gr.ry;
      this.scene.add(m);
      this._meshes.push(m);
    }
  }

  // ---- Lighting -------------------------------------------------------------

  _buildLighting() {
    // Ambient — scattered moonlight, bright enough to see enemies
    const ambient = new THREE.AmbientLight(0x8090b0, 1.1);
    this.scene.add(ambient);

    // Hemisphere — strong sky bounce, warm ground
    const hemi = new THREE.HemisphereLight(0xaaccff, 0x554433, 1.2);
    this.scene.add(hemi);

    // Moonlight — bright primary directional
    const moon = new THREE.DirectionalLight(0xddeeff, 2.0);
    moon.position.set(35, 70, -25);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      const size = this.quality.shadowMapSize;
      moon.shadow.mapSize.set(size, size);
      moon.shadow.camera.near   =  1;
      moon.shadow.camera.far    = 170;
      moon.shadow.camera.left   = -60;
      moon.shadow.camera.right  =  60;
      moon.shadow.camera.top    =  60;
      moon.shadow.camera.bottom = -60;
      moon.shadow.bias         = -0.0005;
      moon.shadow.normalBias   =  0.03;
    }
    this.scene.add(moon);
    this.scene.add(moon.target);
    this._moonLight = moon;

    // Lightning strike light (created once, driven in update)
    const lx = new THREE.DirectionalLight(0xaaddff, 0);
    lx.position.set(-20, 90, 35);
    this.scene.add(lx);
    this._lightningLight = lx;
    this._lightningTimer = 10 + seededRand() * 15;
  }

  // ---- Particles ------------------------------------------------------------

  _buildParticles() {
    // Rain
    const rainCount = this.quality.postprocessing ? 4000 : 1500;
    const rainPos = new Float32Array(rainCount * 3);
    this._rainVel = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPos[i * 3]     = (seededRand() - 0.5) * 130;
      rainPos[i * 3 + 1] = seededRand() * 35;
      rainPos[i * 3 + 2] = (seededRand() - 0.5) * 130;
      this._rainVel[i * 3]     = (seededRand() - 0.5) * 0.5;
      this._rainVel[i * 3 + 1] = -18 - seededRand() * 8;
      this._rainVel[i * 3 + 2] = (seededRand() - 0.5) * 0.5;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this._geo.push(rainGeo);
    const rainMat = new THREE.PointsMaterial({
      color: 0x8899cc, size: 0.06, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._mats.push(rainMat);
    this._rain = new THREE.Points(rainGeo, rainMat);
    this._rain.visible = false; // off by default; toggle with setRain()
    this._rain.frustumCulled = false;
    this.scene.add(this._rain);

    // Dust/ash particles (always on)
    const dustCount = 350;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3]     = (seededRand() - 0.5) * 90;
      dustPos[i * 3 + 1] = seededRand() * 9;
      dustPos[i * 3 + 2] = (seededRand() - 0.5) * 90;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this._geo.push(dustGeo);
    const dustMat = new THREE.PointsMaterial({
      color: 0x998880, size: 0.18, transparent: true, opacity: 0.35,
      depthWrite: false,
    });
    this._mats.push(dustMat);
    this._dust = new THREE.Points(dustGeo, dustMat);
    this._dust.frustumCulled = false;
    this.scene.add(this._dust);
  }

  // ---- Post-processing (extends existing Renderer composer) -----------------

  _initPostProcessing() {
    const { composer } = this.renderer;
    if (!composer || !this.quality.postprocessing) return;
    const cam = this.camera;

    // Cool blue desaturated grading — no noise, no CA (both caused TV-static flicker)
    const hue = new HueSaturationEffect({
      hue: 0.04,
      saturation: -0.12,
    });

    composer.addPass(new EffectPass(cam, hue));

    // SSAO — only on high quality; lowered samples+intensity to kill temporal flicker
    if (this.quality.shadowMapSize >= 2048) {
      const normalPass = new NormalPass(this.scene, cam);
      composer.addPass(normalPass);
      const ssao = new SSAOEffect(cam, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        samples: 8,
        rings: 3,
        distanceFalloff: 0.45,
        radius: 0.35,
        bias: 0.025,
        intensity: 0.9,
        fade: 0.04,
      });
      composer.addPass(new EffectPass(cam, ssao));
      this._postNormalPass = normalPass;
    }
  }

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------

  _updateLights(dt) {
    const t = performance.now() * 0.001;
    for (const light of this._pointLights) {
      const d = light.userData;
      if (!d) continue;
      if (d.pickup) {
        // Gentle pulse for pickups
        light.intensity = d.base * (0.8 + 0.2 * Math.sin(t * 3 + d.phase));
        continue;
      }
      if (!d.broken) continue;
      if (d.fire) {
        // Organic fire flicker using multiple sine waves
        const flicker =
          0.6 + 0.25 * Math.sin(t * 7.3 + d.phase)
              + 0.15 * Math.sin(t * 13.7 + d.phase * 2);
        light.intensity = d.base * flicker;
      } else {
        // Fluorescent flicker: mostly stable with random brief offs
        const f = Math.sin(t * 4.2 + d.phase) * Math.sin(t * 11 + d.phase);
        light.intensity = f < -0.6 ? 0 : d.base * (0.85 + 0.15 * seededRand());
      }
    }
  }

  _updateLightning(dt) {
    this._lightningTimer -= dt;
    if (this._lightningTimer > 0) return;
    this._lightningTimer = 9 + seededRand() * 22;
    this._triggerLightningFlash();
  }

  _triggerLightningFlash() {
    const l = this._lightningLight;
    if (!l) return;
    const origBG = this.scene.background?.clone();
    // Primary strike
    l.intensity = 9;
    if (this.scene.background) this.scene.background = new THREE.Color(0x101828);
    setTimeout(() => {
      l.intensity = 0;
      if (origBG && this.scene.background) this.scene.background = origBG;
    }, 90);
    // Secondary flash
    setTimeout(() => { l.intensity = 5.5; }, 130);
    setTimeout(() => { l.intensity = 0; }, 210);
  }

  _updateParticles(dt) {
    if (this._rain?.visible) {
      const pos = this._rain.geometry.attributes.position.array;
      const vel = this._rainVel;
      const n   = pos.length / 3;
      for (let i = 0; i < n; i++) {
        pos[i * 3]     += vel[i * 3]     * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3]     = (Math.random() - 0.5) * 130;
          pos[i * 3 + 1] = 35;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 130;
        }
      }
      this._rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this._dust) this._dust.rotation.y += dt * 0.009;
  }

  _updatePickupBob(dt) {
    const t = performance.now() * 0.001;
    for (const p of this._pickups) {
      if (!p.mesh) continue;
      p.mesh.position.y = p.baseY + Math.sin(t * 2.4 + p.x) * 0.08;
      p.mesh.rotation.y += dt * 1.2;
    }
  }

  // -------------------------------------------------------------------------
  // Interactive systems
  // -------------------------------------------------------------------------

  _collectPickup(index) {
    const p = this._pickups[index];
    if (!p?.mesh) return;
    this.scene.remove(p.mesh);
    this._meshes = this._meshes.filter(m => m !== p.mesh);
    p.mesh = null;
    this._pickups.splice(index, 1);
  }

  _explodeBarrel(barrel) {
    // Visual flash
    const flash = new THREE.PointLight(0xff7700, 30, 14, 2);
    flash.position.copy(barrel.mesh.position);
    this.scene.add(flash);
    // Fade out the flash over ~0.4s
    const start = performance.now();
    const fadeFlash = () => {
      const t = (performance.now() - start) / 400;
      flash.intensity = 30 * (1 - t);
      if (t < 1) requestAnimationFrame(fadeFlash);
      else this.scene.remove(flash);
    };
    requestAnimationFrame(fadeFlash);

    // Remove mesh and body
    this.scene.remove(barrel.mesh);
    this._meshes = this._meshes.filter(m => m !== barrel.mesh);
    this.physics.removeBody(barrel.body);
    this._bodies  = this._bodies.filter(b => b !== barrel.body);
    this._explosiveBarrels = this._explosiveBarrels.filter(b => b !== barrel);

    // Notify the game for area damage calculation
    this.onExplosion?.(barrel.mesh.position.clone(), 8);
  }

  _breakBarricade(barricade) {
    this.scene.remove(barricade.mesh);
    this._meshes = this._meshes.filter(m => m !== barricade.mesh);
    this.physics.removeBody(barricade.body);
    this._bodies    = this._bodies.filter(b => b !== barricade.body);
    this._barricades = this._barricades.filter(b => b !== barricade);
  }

  // -------------------------------------------------------------------------
  // Zombie spawn points (queried by the wave manager)
  // -------------------------------------------------------------------------

  /** Returns world-space positions along the boundary edges. */
  getSpawnPoints(count = 10) {
    const pts = [];
    const edge = HALF - 1.5;
    for (let i = 0; i < count; i++) {
      const side = i % 4;
      const t = (seededRand() - 0.5) * (ARENA - 6);
      if (side === 0) pts.push(new THREE.Vector3(-edge, 0, t));
      else if (side === 1) pts.push(new THREE.Vector3( edge, 0, t));
      else if (side === 2) pts.push(new THREE.Vector3(t, 0, -edge));
      else                 pts.push(new THREE.Vector3(t, 0,  edge));
    }
    return pts;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose() {
    // Remove lights
    for (const l of this._pointLights) this.scene.remove(l);
    if (this._lightningLight) this.scene.remove(this._lightningLight);
    if (this._moonLight) this.scene.remove(this._moonLight);

    // Remove meshes
    for (const m of this._meshes) {
      this.scene.remove(m);
      if (m.dispose) m.dispose();
    }

    // Particles
    if (this._rain)  this.scene.remove(this._rain);
    if (this._dust)  this.scene.remove(this._dust);

    // Geometries
    for (const g of this._geo)  g.dispose?.();
    // Materials
    for (const m of this._mats) m.dispose?.();
    // Textures
    for (const t of this._tex)  t.dispose?.();

    // Physics bodies
    for (const b of this._bodies) this.physics.removeBody(b);

    this._pointLights = [];
    this._meshes      = [];
    this._bodies      = [];
    this._pickups     = [];
  }
}

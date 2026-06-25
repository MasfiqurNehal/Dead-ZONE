import * as THREE from 'three';
import { WEAPONS, GROUPS } from '../utils/constants.js';
import { makeGroups } from '../core/physics.js';

// Bullets collide with world + zombies; never the player.
const BULLET_FILTER = makeGroups(GROUPS.BULLET, GROUPS.WORLD | GROUPS.ZOMBIE);

// ── Extended per-weapon config (stats live in constants.js WEAPONS) ──────────
const WEAPON_EXTRA = {
  pistol:       { penetration: 0, hasScope: false, melee: false, flame: false, projectile: false, barrelTipZ: -0.22, shellEject: true  },
  smg:          { penetration: 0, hasScope: false, melee: false, flame: false, projectile: false, barrelTipZ: -0.22, shellEject: true  },
  shotgun:      { penetration: 0, hasScope: false, melee: false, flame: false, projectile: false, barrelTipZ: -0.46, shellEject: true  },
  rifle:        { penetration: 0, hasScope: false, melee: false, flame: false, projectile: false, barrelTipZ: -0.46, shellEject: true  },
  sniper:       { penetration: 2, hasScope: true,  melee: false, flame: false, projectile: false, barrelTipZ: -0.68, shellEject: true  },
  crossbow:     { penetration: 0, hasScope: false, melee: false, flame: false, projectile: true,  barrelTipZ: -0.22, shellEject: false, boltSpeed: 45 },
  flamethrower: { penetration: 0, hasScope: false, melee: false, flame: true,  projectile: false, barrelTipZ: -0.40, shellEject: false },
  katana:       { penetration: 0, hasScope: false, melee: true,  flame: false, projectile: false, barrelTipZ: -0.68, shellEject: false, swingRange: 2.5 },
};

// Module-level scratch vectors (avoid per-frame allocation)
const _v   = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _bit = new THREE.Vector3();
const _sp  = new THREE.Vector3();
const _ori = new THREE.Vector3();
const _hp  = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);
const _axu = new THREE.Vector3(1, 0, 0);
const _rt  = new THREE.Vector3();

// Shared shell geometry (all weapon instances reuse the same BoxGeometry)
let _shellGeo = null;
const getShellGeo = () => (_shellGeo ??= new THREE.BoxGeometry(0.008, 0.006, 0.022));

// Simple exponential damp (avoids importing from helpers.js)
const damp = (a, b, lam, dt) => a + (b - a) * (1 - Math.exp(-lam * dt));

// ─── Weapon ──────────────────────────────────────────────────────────────────
export class Weapon {
  /**
   * @param {string} key  key into WEAPONS / WEAPON_EXTRA
   * @param {{ physics, bulletPool, sound, camera?, scene? }} ctx
   *   camera and scene are optional; omit on dedicated servers or during tests.
   */
  constructor(key, { physics, bulletPool, sound, camera = null, scene = null }) {
    this.key      = key;
    this.stats    = WEAPONS[key] ?? WEAPONS.pistol;
    this.extra    = WEAPON_EXTRA[key] ?? WEAPON_EXTRA.pistol;
    this.physics  = physics;
    this.bulletPool = bulletPool;
    this.sound    = sound;
    this.camera   = camera;
    this.scene    = scene;

    // ── Ammo ──
    this.clip      = this.stats.clipSize;
    this.reserve   = this.stats.reserveAmmo;
    this.reloading = false;
    this._reloadT  = 0;
    this._reloadDur = 0;  // snapshot at reload start (upgrade-adjusted)
    this._cooldown = 0;

    // ── Upgrade levels (0–5 per stat) ──
    this.upgrades = { damage: 0, fireRate: 0, reloadSpeed: 0, magSize: 0 };
    this.killXP   = 0;
    this.level    = 0;

    // ── Camera-feel ──
    this.pendingRecoil = 0;

    // ── Model animation state ──
    this._adsTarget  = 0;   // 0 = hip, 1 = ADS
    this._adsBlend   = 0;
    this._reloadAnim = 0;   // 0 = raised, goes to 1 at reload midpoint then back
    this._swingAnim  = 0;   // katana swing progress (1 → 0)
    this._swingDir   = 1;
    this._muzzleTimer = 0;

    // ── Callbacks ──
    /** (damage: number, headshot: boolean, worldPoint: THREE.Vector3) → void */
    this.onHit   = null;
    /** () → void */
    this.onShoot = null;

    // ── 3D objects ──
    this.group        = null;
    this._muzzleLight = null;
    this._shells      = [];
    this._shellCursor = 0;
    // Flame pool (flamethrower)
    this._flamePts  = null;
    this._flameGeo  = null;
    this._flamePos  = null;
    this._flameVel  = [];
    this._flameLife = null;
    this._flameCur  = 0;

    if (camera && scene) this._buildModel();
  }

  // ── Upgrade-adjusted stat getters ─────────────────────────────────────────
  get _damage()     { return this.stats.damage   * (1 + this.upgrades.damage     * 0.15); }
  get _fireRate()   { return this.stats.fireRate * (1 + this.upgrades.fireRate   * 0.10); }
  get _reloadTime() { return Math.max(0.3, this.stats.reloadTime * (1 - this.upgrades.reloadSpeed * 0.15)); }
  get _clipMax()    { return Math.ceil(this.stats.clipSize * (1 + this.upgrades.magSize * 0.20)); }

  // ── API expected by player.js ─────────────────────────────────────────────
  get name()    { return this.stats.name; }
  get canFire() { return this._cooldown <= 0 && !this.reloading && this.clip > 0; }

  // ── 3D model ─────────────────────────────────────────────────────────────
  _buildModel() {
    const g = this.group = new THREE.Group();
    g.position.set(0.20, -0.22, -0.40);
    g.visible = false; // hidden until equip() is called

    /** Helper: add a box child in camera space. */
    const box = (w, h, d, col, x, y, z, rough = 0.45, metal = 0.75) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          color: col, roughness: rough, metalness: metal,
          depthTest: false, depthWrite: false,
        })
      );
      m.position.set(x, y, z);
      m.renderOrder = 999;
      g.add(m);
      return m;
    };

    switch (this.key) {
      case 'pistol':
        box(0.060, 0.130, 0.090, 0x5a6070, 0,     0,      0,     0.40, 0.80); // frame
        box(0.040, 0.040, 0.220, 0x445566, 0,     0.045, -0.10, 0.30, 0.92); // slide/barrel
        box(0.044, 0.008, 0.065, 0x3a4455, 0,    -0.020, -0.03, 0.50, 0.60); // trigger guard
        box(0.020, 0.060, 0.018, 0x222233, 0,    -0.055,  0.02, 0.60, 0.50); // mag base
        break;
      case 'smg':
        box(0.058, 0.100, 0.190, 0x333444, 0,     0,      0,     0.50, 0.70); // body
        box(0.040, 0.130, 0.042, 0x222333, 0,    -0.095,  0.03, 0.45, 0.55); // mag
        box(0.034, 0.034, 0.160, 0x445566, 0,     0.040, -0.15, 0.28, 0.92); // barrel
        box(0.058, 0.022, 0.040, 0x222333, 0,     0.042,  0.04, 0.60, 0.45); // top rail
        box(0.058, 0.050, 0.080, 0x444555, 0,    -0.030,  0.12, 0.60, 0.55); // stock
        break;
      case 'shotgun':
        box(0.068, 0.100, 0.260, 0x775533, 0,     0,      0,     0.65, 0.35); // receiver
        box(0.050, 0.050, 0.360, 0x554422, 0,     0.030, -0.31, 0.40, 0.80); // barrel
        box(0.065, 0.090, 0.140, 0x664422, 0,    -0.050,  0.18, 0.90, 0.08); // wood stock
        box(0.060, 0.068, 0.058, 0x885533, 0,    -0.038,  0.05, 0.80, 0.20); // pump slide
        box(0.054, 0.012, 0.070, 0x553311, 0,     0.030,  0.02, 0.50, 0.60); // heat shield
        break;
      case 'rifle':
        box(0.058, 0.100, 0.265, 0x334433, 0,     0,      0,     0.50, 0.70); // receiver
        box(0.040, 0.140, 0.050, 0x223322, 0,    -0.095,  0.07, 0.50, 0.60); // mag
        box(0.038, 0.038, 0.320, 0x445544, 0,     0.030, -0.29, 0.28, 0.92); // barrel
        box(0.058, 0.034, 0.140, 0x223322, 0,     0.065,  0.02, 0.60, 0.55); // top rail
        box(0.058, 0.068, 0.120, 0x334433, 0,    -0.044,  0.22, 0.90, 0.08); // stock
        box(0.026, 0.026, 0.080, 0x556655, 0,     0.030, -0.18, 0.40, 0.85); // FSP
        break;
      case 'sniper': {
        box(0.055, 0.090, 0.300, 0x445533, 0,     0,      0,     0.50, 0.70); // receiver
        box(0.038, 0.038, 0.500, 0x556644, 0,     0.030, -0.40, 0.28, 0.92); // barrel
        box(0.040, 0.125, 0.040, 0x334422, 0,    -0.095,  0.07, 0.50, 0.55); // mag
        box(0.058, 0.034, 0.160, 0x334422, 0,     0.074,  0.02, 0.55, 0.55); // scope rail
        // Scope body
        box(0.040, 0.040, 0.140, 0x111811, 0,     0.080,  0.00, 0.28, 0.40);
        box(0.026, 0.026, 0.012, 0x001000, 0,     0.080,  0.076, 0.28, 0.35); // eyepiece
        box(0.024, 0.024, 0.012, 0x001000, 0,     0.080, -0.076, 0.28, 0.35); // objective
        box(0.058, 0.074, 0.140, 0x445533, 0,    -0.038,  0.22, 0.90, 0.08); // stock
        break;
      }
      case 'crossbow':
        box(0.050, 0.100, 0.220, 0x664422, 0,     0,      0,     0.90, 0.08); // stock
        box(0.280, 0.038, 0.038, 0x442200, 0,     0.062, -0.08, 0.80, 0.28); // limbs
        box(0.038, 0.038, 0.180, 0x553311, 0,     0.062, -0.08, 0.72, 0.38); // prod
        box(0.032, 0.028, 0.180, 0x553311, 0,     0.038, -0.13, 0.60, 0.50); // bolt track
        box(0.005, 0.005, 0.250, 0xddddcc, -0.07, 0.065, -0.08, 0.30, 0.10); // string left
        box(0.005, 0.005, 0.250, 0xddddcc,  0.07, 0.065, -0.08, 0.30, 0.10); // string right
        box(0.004, 0.004, 0.180, 0x887755, 0,     0.045, -0.08, 0.20, 0.90); // bolt (visible when loaded)
        break;
      case 'flamethrower':
        box(0.090, 0.110, 0.320, 0x334455, 0,     0,      0,     0.80, 0.28); // main tank
        box(0.050, 0.090, 0.140, 0x445566,-0.075, 0.020,  0.08, 0.72, 0.35); // side tank
        box(0.018, 0.018, 0.040, 0x556677, 0.015,-0.008,  0.15, 0.60, 0.60); // connector
        box(0.034, 0.034, 0.220, 0x223344, 0,     0.030, -0.27, 0.50, 0.72); // nozzle tube
        box(0.026, 0.026, 0.042, 0x667788, 0,     0.030, -0.40, 0.40, 0.82); // nozzle tip
        box(0.020, 0.120, 0.010, 0x445566, 0.040, 0,      0.04, 0.60, 0.50); // tank strap
        break;
      case 'katana':
        // Blade (two thin slabs for a visible edge)
        box(0.006, 0.026, 0.700, 0xccccdd, 0,     0,     -0.26, 0.08, 1.00);
        box(0.009, 0.018, 0.700, 0xaabbcc, 0.004, 0,     -0.26, 0.18, 0.95);
        // Blood groove (decorative darker strip)
        box(0.003, 0.008, 0.550, 0x999aaa, 0,     0.006, -0.22, 0.12, 0.90);
        box(0.058, 0.058, 0.008, 0x888899, 0,     0,      0.10, 0.50, 0.50); // tsuba
        box(0.030, 0.030, 0.160, 0x774433, 0,     0,      0.22, 0.92, 0.08); // handle
        box(0.038, 0.038, 0.022, 0x556677, 0,     0,      0.31, 0.40, 0.72); // pommel
        break;
    }

    // Muzzle-flash point light (everything except katana)
    if (this.key !== 'katana') {
      const light = new THREE.PointLight(0xff7722, 0, 5);
      light.position.set(0, 0.03, this.extra.barrelTipZ);
      g.add(light);
      this._muzzleLight = light;
    }

    // Shell ejection pool
    if (this.extra.shellEject && this.scene) {
      const shellMat = new THREE.MeshStandardMaterial({
        color: 0xffcc44, metalness: 0.9, roughness: 0.12,
        depthTest: false, depthWrite: false,
      });
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(getShellGeo(), shellMat);
        m.renderOrder = 998;
        m.visible = false;
        this.scene.add(m);
        this._shells.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
      }
    }

    // Flame particle pool (flamethrower)
    if (this.extra.flame && this.scene) this._buildFlamePool();

    this.camera.add(g);
  }

  _buildFlamePool() {
    const N = 90;
    this._flamePos  = new Float32Array(N * 3);
    this._flameLife = new Float32Array(N);
    this._flameVel  = Array.from({ length: N }, () => new THREE.Vector3());

    // Park particles off-screen initially
    for (let i = 0; i < N * 3; i += 3) { this._flamePos[i + 1] = -2000; }

    this._flameGeo = new THREE.BufferGeometry();
    this._flameGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._flamePos, 3).setUsage(THREE.DynamicDrawUsage)
    );

    this._flamePts = new THREE.Points(
      this._flameGeo,
      new THREE.PointsMaterial({
        color: 0xff5500, size: 0.40, sizeAttenuation: true,
        transparent: true, opacity: 0.72,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      })
    );
    this._flamePts.frustumCulled = false;
    this.scene.add(this._flamePts);
  }

  // ── Equip / unequip (shows / hides the 3D model) ──────────────────────────
  equip()   { if (this.group) this.group.visible = true;  }
  unequip() { if (this.group) this.group.visible = false; }

  // ── Fire — same signature as original, compatible with player.js ────────────
  fire(rayOrigin, dir, muzzlePos) {
    if (this.reloading || this._cooldown > 0) return false;
    if (this.clip <= 0) {
      this.sound?.play?.('empty');
      this._cooldown = 0.18;
      return false;
    }

    if (this.key !== 'katana') this.clip--;
    this._cooldown = 1 / this._fireRate;
    this.pendingRecoil += this.stats.recoil;
    this.sound?.play?.('shoot');
    this.onShoot?.();

    const x = this.extra;
    if (x.melee)      this._meleeFire(rayOrigin, dir);
    else if (x.flame) this._flameFire(rayOrigin, dir, muzzlePos);
    else if (x.projectile) this._projectileFire(rayOrigin, dir, muzzlePos);
    else {
      const p = this.stats.pellets || 1;
      for (let i = 0; i < p; i++) this._hitscanFire(rayOrigin, dir, muzzlePos);
    }

    this._triggerMuzzleFlash();
    this._ejectShell();

    if (this.clip === 0 && !x.melee) this.reload();
    return true;
  }

  // ── (return true is already at end of fire()) ──────────────────────────────

  // ── Hitscan — instant-hit ray (with optional penetration for sniper) ────────
  _hitscanFire(rayOrigin, dir, muzzlePos) {
    this._applySpread(dir, this.stats.spread, _sp);
    _ori.copy(rayOrigin);

    let hitsLeft = 1 + (this.extra.penetration ?? 0);
    let excludeCollider = null;
    let lastMuzzle = muzzlePos;

    while (hitsLeft > 0) {
      const hit = this.physics.raycast(_ori, _sp, this.stats.range, excludeCollider, BULLET_FILTER);
      if (!hit) {
        _hp.copy(_ori).addScaledVector(_sp, this.stats.range);
        this.bulletPool.spawnTracer(lastMuzzle, _hp);
        break;
      }

      _hp.set(hit.point.x, hit.point.y, hit.point.z);
      this.bulletPool.spawnTracer(lastMuzzle, _hp);
      lastMuzzle = _hp.clone();

      if (hit.entity && typeof hit.entity.takeDamage === 'function') {
        const distRatio = hit.distance / this.stats.range;
        const falloff   = distRatio < 0.5 ? 1.0 : Math.max(0.30, 1.0 - (distRatio - 0.5) * 1.4);
        const baseDmg   = this._damage * falloff;

        const bodyY     = hit.body?.translation()?.y ?? _hp.y;
        const headshot  = _hp.y > bodyY + 0.72;
        const finalDmg  = Math.round(headshot ? baseDmg * 3 : baseDmg);

        hit.entity.takeDamage(finalDmg, _hp, _sp);
        this.onHit?.(finalDmg, headshot, _hp.clone());
        this.bulletPool.spawnImpact(_hp);

        _ori.copy(_hp).addScaledVector(_sp, 0.08);
        excludeCollider = hit.collider;
        hitsLeft--;
      } else {
        // World surface hit
        this.bulletPool.spawnImpact(_hp);
        break;
      }
    }
  }

  // ── Melee — raycast in swing arc (katana) ──────────────────────────────────
  _meleeFire(rayOrigin, dir) {
    this._swingAnim = 1.0;
    this._swingDir  = -this._swingDir;

    const range = this.extra.swingRange ?? 2.5;
    const hit   = this.physics.raycast(rayOrigin, dir, range, null, BULLET_FILTER);
    if (hit?.entity?.takeDamage) {
      _hp.set(hit.point.x, hit.point.y, hit.point.z);
      const bodyY    = hit.body?.translation()?.y ?? _hp.y;
      const headshot = _hp.y > bodyY + 0.72;
      const dmg      = Math.round(headshot ? this._damage * 2 : this._damage);
      hit.entity.takeDamage(dmg, _hp, dir);
      this.onHit?.(dmg, headshot, _hp.clone());
    }
  }

  // ── Flame — short cone, multiple hits per trigger pull ─────────────────────
  _flameFire(rayOrigin, dir, muzzlePos) {
    _ori.copy(rayOrigin);
    for (let i = 0; i < 3; i++) {
      this._applySpread(dir, this.stats.spread, _sp);
      const hit = this.physics.raycast(_ori, _sp, this.stats.range, null, BULLET_FILTER);
      if (hit?.entity?.takeDamage) {
        _hp.set(hit.point.x, hit.point.y, hit.point.z);
        const dmg = Math.round(this._damage * (0.6 + Math.random() * 0.4));
        hit.entity.takeDamage(dmg, _hp, _sp);
        this.onHit?.(dmg, false, _hp.clone());
      }
    }
    // Spawn visual flame particles at barrel tip world position
    if (this._flamePos && this.camera) {
      _v.set(0, 0.03, this.extra.barrelTipZ);
      _v.applyMatrix4(this.camera.matrixWorld);
      this._spawnFlame(_v, dir);
    }
  }

  _spawnFlame(worldPos, dir) {
    for (let i = 0; i < 5; i++) {
      const c = this._flameCur;
      this._flameCur = (c + 1) % (this._flamePos.length / 3);
      const b = c * 3;
      this._flamePos[b]   = worldPos.x;
      this._flamePos[b+1] = worldPos.y;
      this._flamePos[b+2] = worldPos.z;
      this._applySpread(dir, 0.20, _sp);
      const spd = 5 + Math.random() * 4;
      this._flameVel[c].copy(_sp).multiplyScalar(spd);
      this._flameLife[c] = 0.35 + Math.random() * 0.25;
    }
    this._flameGeo.attributes.position.needsUpdate = true;
  }

  // ── Crossbow projectile — delegates to bulletPool.fireBolt ─────────────────
  _projectileFire(rayOrigin, dir, muzzlePos) {
    const dmg = Math.round(this._damage);
    this.bulletPool.fireBolt(
      muzzlePos ?? rayOrigin,
      dir,
      this.extra.boltSpeed ?? 45,
      dmg,
      (entity, hitPoint, hitDir) => {
        if (!entity?.takeDamage) return;
        const bodyY    = entity.body?.translation()?.y ?? hitPoint.y;
        const headshot = hitPoint.y > bodyY + 0.72;
        const finalDmg = Math.round(headshot ? dmg * 2 : dmg);
        entity.takeDamage(finalDmg, hitPoint, hitDir);
        this.onHit?.(finalDmg, headshot, hitPoint.clone());
      }
    );
  }

  // ── Muzzle flash ──────────────────────────────────────────────────────────
  _triggerMuzzleFlash() {
    if (!this._muzzleLight) return;
    this._muzzleLight.intensity = 8 + Math.random() * 5;
    this._muzzleTimer = 0.065;
  }

  // ── Shell ejection ─────────────────────────────────────────────────────────
  _ejectShell() {
    if (!this._shells.length || !this.camera) return;
    const s = this._shells[this._shellCursor];
    this._shellCursor = (this._shellCursor + 1) % this._shells.length;

    // World-space position of the ejection port (right side of receiver)
    _v.set(0.065, 0.020, -0.06);
    _v.applyMatrix4(this.camera.matrixWorld);
    s.mesh.position.copy(_v);

    // Velocity: camera-right + up + tiny forward jitter
    const m = this.camera.matrixWorld.elements;
    _rt.set(m[0], m[4], m[8]).normalize();
    s.vel.copy(_rt).multiplyScalar(2.2 + Math.random() * 0.8);
    s.vel.y += 1.6 + Math.random() * 0.8;
    s.vel.z += (Math.random() - 0.5) * 0.4;

    s.mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    s.mesh.visible = true;
    s.life = 1.0 + Math.random() * 0.4;
  }

  // ── Spread utility ─────────────────────────────────────────────────────────
  _applySpread(dir, spread, out) {
    if (spread <= 0) { out.copy(dir); return; }
    const worldUp = Math.abs(dir.y) > 0.95 ? _axu : _up;
    _tan.crossVectors(worldUp, dir).normalize();
    _bit.crossVectors(dir, _tan).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * spread;
    out.copy(dir)
      .addScaledVector(_tan, Math.cos(a) * r)
      .addScaledVector(_bit, Math.sin(a) * r)
      .normalize();
  }

  // ── Reload ─────────────────────────────────────────────────────────────────
  reload() {
    if (this.reloading) return;
    if (this.clip >= this._clipMax) return;
    if (this.reserve <= 0 && this.stats.clipSize < 999) return;
    this.reloading = true;
    this._reloadDur = this._reloadTime;
    this._reloadT   = this._reloadDur;
    this.sound?.play?.('reload');
  }

  _finishReload() {
    this.reloading = false;
    if (this.stats.clipSize >= 999) return; // infinite (katana)
    const need = this._clipMax - this.clip;
    const take = Math.min(need, this.reserve);
    this.clip    += take;
    this.reserve -= take;
  }

  // ── ADS (call from WeaponManager with 0 or 1 each frame) ──────────────────
  setADS(target) {
    this._adsTarget = target;
  }

  // ── Per-frame update (called by player.fixedUpdate) ─────────────────────────
  update(dt) {
    if (this._cooldown > 0) this._cooldown -= dt;
    if (this.reloading) {
      this._reloadT -= dt;
      if (this._reloadT <= 0) this._finishReload();
    }
    if (!this.group) return;
    this._tickMuzzle(dt);
    this._tickShells(dt);
    this._tickFlame(dt);
    this._tickModel(dt);
  }

  _tickMuzzle(dt) {
    if (this._muzzleTimer <= 0) return;
    this._muzzleTimer -= dt;
    if (this._muzzleTimer <= 0 && this._muzzleLight) this._muzzleLight.intensity = 0;
  }

  _tickShells(dt) {
    for (const s of this._shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.z += dt * 6;
    }
  }

  _tickFlame(dt) {
    if (!this._flamePos) return;
    let dirty = false;
    for (let i = 0; i < this._flameLife.length; i++) {
      if (this._flameLife[i] <= 0) continue;
      this._flameLife[i] -= dt;
      dirty = true;
      const b = i * 3;
      if (this._flameLife[i] <= 0) {
        this._flamePos[b + 1] = -2000;
      } else {
        this._flamePos[b]     += this._flameVel[i].x * dt;
        this._flamePos[b + 1] += this._flameVel[i].y * dt + 0.4 * dt;
        this._flamePos[b + 2] += this._flameVel[i].z * dt;
        this._flameVel[i].x   *= 0.96;
        this._flameVel[i].z   *= 0.96;
      }
    }
    if (dirty) this._flameGeo.attributes.position.needsUpdate = true;
  }

  _tickModel(dt) {
    const g = this.group;

    // Smooth ADS blend
    this._adsBlend = damp(this._adsBlend, this._adsTarget, 12, dt);
    g.position.x = 0.20 * (1 - this._adsBlend);
    g.position.z = -0.40 - 0.06 * this._adsBlend;

    // Katana swing animation
    if (this.key === 'katana') {
      if (this._swingAnim > 0) {
        this._swingAnim = Math.max(0, this._swingAnim - dt * 5.5);
        const t = 1 - this._swingAnim;
        g.rotation.z = Math.sin(t * Math.PI) * 0.50 * this._swingDir;
        g.rotation.x = Math.sin(t * Math.PI) * -0.28;
      } else {
        g.rotation.z = damp(g.rotation.z, 0, 8, dt);
        g.rotation.x = damp(g.rotation.x, 0, 8, dt);
      }
    }

    // Reload animation: dip then raise
    if (this.reloading && this._reloadDur > 0) {
      const prog = 1 - this._reloadT / this._reloadDur;
      const dip  = prog < 0.5 ? prog * 2 : 2 - prog * 2;
      g.position.y = damp(g.position.y, -0.22 - dip * 0.14, 14, dt);
    } else {
      g.position.y = damp(g.position.y, -0.22, 10, dt);
    }
  }

  // ── Recoil (player reads + clears each frame) ──────────────────────────────
  consumeRecoil() {
    const r = this.pendingRecoil;
    this.pendingRecoil = 0;
    return r;
  }

  // ── Upgrades ───────────────────────────────────────────────────────────────
  addKillXP(headshot = false) {
    this.killXP += headshot ? 2 : 1;
    const xpThresh = (this.level + 1) * 12;
    if (this.killXP >= xpThresh && this.level < 5) this.level++;
  }

  applyUpgrade(stat) {
    if (!(stat in this.upgrades) || this.upgrades[stat] >= 5) return false;
    this.upgrades[stat]++;
    if (stat === 'magSize') {
      const extra = Math.ceil(this.stats.clipSize * 0.20);
      this.reserve += extra;
      this.clip = Math.min(this._clipMax, this.clip + extra);
    }
    return true;
  }

  // ── Refill (called on new game) ────────────────────────────────────────────
  refill() {
    this.clip    = this._clipMax;
    this.reserve = this.stats.reserveAmmo;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  dispose() {
    if (this.group) {
      this.camera?.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
      });
      this.group = null;
    }
    for (const s of this._shells) {
      this.scene?.remove(s.mesh);
      s.mesh.material?.dispose();
    }
    this._shells = [];
    if (this._flamePts) {
      this.scene?.remove(this._flamePts);
      this._flameGeo?.dispose();
      this._flamePts.material?.dispose();
      this._flamePts = null;
    }
    this._muzzleLight = null;
  }
}

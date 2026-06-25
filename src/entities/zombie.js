/**
 * zombie.js — Zombie entities for DEAD ZONE
 *
 * Types: walker, runner, brute, exploder, spitter, boss
 *
 * Wiring (done by WaveManager):
 *   const z = new Zombie({ type, scene, physics, sound, bloodPool });
 *   z.onDeath      = () => waveManager._onZombieDeath(z);
 *   z.onMeleeHit   = (dmg) => player.takeDamage(dmg);
 *   z.onExplosion  = (rawPos, radius) => arena.onExplosion?.(new THREE.Vector3(...), radius);
 *   z.onAcidDamage = (dmg) => player.takeDamage(dmg);
 *   z.spawn({ x, y, z });
 *   // engine loop:
 *   z.fixedUpdate(dt, playerCameraPos, allZombies);  // physics
 *   z.update(dt, playerCameraPos);                    // AI + animation
 */

import * as THREE from 'three';
import { GROUPS } from '../utils/constants.js';
import { makeGroups } from '../core/physics.js';
import { clamp } from '../utils/helpers.js';

// ─── AI state constants ───────────────────────────────────────────────────────
export const ZOMBIE_STATE = Object.freeze({
  IDLE: 0, CHASE: 1, ATTACK: 2, STAGGER: 3, DYING: 4, DEAD: 5,
});
const { IDLE, CHASE, ATTACK, STAGGER, DYING, DEAD } = ZOMBIE_STATE;

// ─── Type definitions ─────────────────────────────────────────────────────────
// hp / speed / damage / scale / attackRange / attackCooldown / detectRange / color / reward
export const ZOMBIE_TYPES = {
  walker:  { hp: 60,   speed: 1.5, damage: 10, scale: 1.00, attackRange: 1.5, attackCooldown: 1.2, detectRange: 35, color: 0x4a5a32, reward: 100 },
  runner:  { hp: 80,   speed: 4.2, damage:  8, scale: 0.88, attackRange: 1.4, attackCooldown: 0.7, detectRange: 45, color: 0x3d4b28, reward: 150 },
  brute:   { hp: 320,  speed: 1.1, damage: 40, scale: 1.45, attackRange: 2.0, attackCooldown: 2.0, detectRange: 30, color: 0x28321a, reward: 300 },
  exploder:{ hp: 45,   speed: 3.2, damage:  0, scale: 0.82, attackRange: 2.2, attackCooldown: 0.0, detectRange: 40, color: 0x7a4a08, reward: 200 },
  spitter: { hp: 70,   speed: 1.9, damage: 18, scale: 1.00, attackRange: 16,  attackCooldown: 2.5, detectRange: 50, color: 0x2d5218, reward: 175 },
  boss:    { hp: 2000, speed: 1.6, damage: 55, scale: 2.10, attackRange: 2.8, attackCooldown: 1.6, detectRange: 80, color: 0x111a0a, reward: 2000 },
};

// Kinematic capsule resolves only against the world (not other zombie capsules;
// zombie-zombie separation is handled in steering code).
const MOVE_FILTER = makeGroups(GROUPS.ZOMBIE, GROUPS.WORLD);

// ─── Shared geometry (allocated once across all zombie instances) ──────────────
let _geo = null;
function _getGeo() {
  return _geo ?? (_geo = {
    head:  new THREE.BoxGeometry(0.25, 0.25, 0.25),
    torso: new THREE.BoxGeometry(0.30, 0.42, 0.18),
    arm:   new THREE.BoxGeometry(0.10, 0.36, 0.10),
    leg:   new THREE.BoxGeometry(0.11, 0.38, 0.11),
    eye:   new THREE.SphereGeometry(0.038, 6, 4),
  });
}

const _eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1400, toneMapped: false });

// ─── Blood particle pool ─────────────────────────────────────────────────────
export class BloodPool {
  constructor(scene, count = 320) {
    this._n    = count;
    this._pos  = new Float32Array(count * 3);
    this._vel  = new Float32Array(count * 3);
    this._life = new Float32Array(count);
    this._cur  = 0;

    // Park all particles deep underground so they're invisible until activated.
    for (let i = 0; i < count; i++) this._pos[i * 3 + 1] = -2000;

    const geo = new THREE.BufferGeometry();
    this._attr = new THREE.BufferAttribute(this._pos, 3);
    this._attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._attr);

    this._mat = new THREE.PointsMaterial({
      color: 0x9b0000, size: 0.12,
      transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true,
    });

    this.mesh = new THREE.Points(geo, this._mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  burst(pos, count = 9) {
    for (let i = 0; i < count; i++) {
      const k = this._cur;
      this._cur = (this._cur + 1) % this._n;

      this._pos[k*3] = pos.x; this._pos[k*3+1] = pos.y; this._pos[k*3+2] = pos.z;

      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.75;
      const spd   = 1.5 + Math.random() * 5.5;
      this._vel[k*3]   = Math.sin(phi) * Math.cos(theta) * spd;
      this._vel[k*3+1] = Math.abs(Math.cos(phi)) * spd * 0.8 + 1.5;
      this._vel[k*3+2] = Math.sin(phi) * Math.sin(theta) * spd;
      this._life[k] = 0.45 + Math.random() * 0.4;
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this._n; i++) {
      if (this._life[i] <= 0) continue;
      this._life[i] -= dt;
      this._vel[i*3+1] -= 14 * dt; // gravity
      this._pos[i*3]   += this._vel[i*3]   * dt;
      this._pos[i*3+1] += this._vel[i*3+1] * dt;
      this._pos[i*3+2] += this._vel[i*3+2] * dt;
      if (this._life[i] <= 0) this._pos[i*3+1] = -2000; // re-park
      dirty = true;
    }
    if (dirty) this._attr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this._mat.dispose();
    this.mesh.removeFromParent();
  }
}

// ─── Module-scope scratch ─────────────────────────────────────────────────────
const _v = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
export class Zombie {
  /**
   * @param {{ type, scene, physics, sound?, bloodPool }} ctx
   */
  constructor({ type = 'walker', scene, physics, sound = null, bloodPool }) {
    this.type     = type;
    this.cfg      = { ...ZOMBIE_TYPES[type] ?? ZOMBIE_TYPES.walker };
    this.scene    = scene;
    this.physics  = physics;
    this.sound    = sound;
    this._blood   = bloodPool;

    // Vitals (maxHp / cfg.speed may be overridden by WaveManager for scaling)
    this.maxHp = this.cfg.hp;
    this.hp    = this.maxHp;
    this.alive = false;

    // Physics handles
    this.body     = null;
    this.collider = null;

    // AI
    this._state        = IDLE;
    this._staggerTimer = 0;
    this._attackTimer  = 0;
    this._alertTimer   = 0;

    // Death animation
    this._dyingTimer = 0;
    this._deathAxis  = new THREE.Vector3(1, 0, 0);

    // Visual animation
    this._animPhase  = Math.random() * Math.PI * 2;
    this._attackAnim = 0;   // 1 → 0, drives arm swing
    this._hitFlash   = 0;   // seconds of white emissive remaining

    // Scale derived from type
    this._scale = this.cfg.scale;

    // Mesh parts
    this.group  = null;
    this._parts = {};
    this._mat   = null;
    this._baseColor = new THREE.Color(this.cfg.color);

    // Callbacks set by WaveManager
    this.onDeath      = null; // ()              → void
    this.onMeleeHit   = null; // (damage)        → void
    this.onExplosion  = null; // ({x,y,z},radius)→ void
    this.onAcidDamage = null; // (damage)        → void
    this.onTakeDamage = null; // (hitPoint)      → void  (wired by WaveManager)
    this.onAggro      = null; // (pos)           → void  (wired by main.js via onZombieSpawn)
    this.onAttack     = null; // (pos)           → void
  }

  // ─── Spawn ──────────────────────────────────────────────────────────────────
  spawn(pos) {
    const s = this._scale;
    const r = 0.32 * s, hh = 0.52 * s;

    this.body = this.physics.createCapsule(
      { x: pos.x, y: pos.y + hh + r, z: pos.z },
      r, hh,
      GROUPS.ZOMBIE,
      GROUPS.WORLD | GROUPS.PLAYER | GROUPS.BULLET,
      true // kinematic
    );
    this.physics.register(this.body, this);
    this.collider = this.body.collider(0);

    this._buildMesh();
    this.scene.add(this.group);
    this._syncMesh();

    this.hp           = this.maxHp;
    this.alive        = true;
    this._state       = IDLE;
    this._attackTimer = 0;
    this._dyingTimer  = 0;
    this._hitFlash    = 0;
    return this;
  }

  // ─── Fixed step — physics movement ──────────────────────────────────────────
  fixedUpdate(dt, playerPos, zombies) {
    if (!this.body || !this.alive || this._state >= DYING) return;
    if (this._state !== CHASE && this._state !== STAGGER) return;

    const pos  = this.body.translation();
    const dist = _dist2(pos, playerPos);

    let dx = 0, dz = 0;

    if (this._state === CHASE) {
      const sx = playerPos.x - pos.x;
      const sz = playerPos.z - pos.z;
      const len = dist + 0.001;
      const spd = this.cfg.speed * (this.hp < this.maxHp * 0.3 ? 0.55 : 1);

      if (this.type === 'spitter' && dist < 8) {
        // Back away to maintain spit range
        dx = -(sx / len) * spd * dt;
        dz = -(sz / len) * spd * dt;
      } else {
        dx = (sx / len) * spd * dt;
        dz = (sz / len) * spd * dt;
      }
    }

    // Separation steering — push away from overlapping zombie capsules
    const SEP = 0.9 * this._scale + 0.2;
    for (const z of zombies) {
      if (z === this || !z.body || !z.alive) continue;
      const zp = z.body.translation();
      const ex = pos.x - zp.x, ez = pos.z - zp.z;
      const ed = Math.sqrt(ex*ex + ez*ez);
      if (ed > 0.01 && ed < SEP) {
        const str = ((SEP - ed) / SEP) * 1.8 * dt;
        dx += (ex / ed) * str;
        dz += (ez / ed) * str;
      }
    }

    // Clamp separation so it doesn't rocket zombies across the map
    const ml = Math.sqrt(dx*dx + dz*dz);
    const maxStep = this.cfg.speed * dt * 1.5;
    if (ml > maxStep) { dx = (dx/ml)*maxStep; dz = (dz/ml)*maxStep; }

    // Nearby zombies use the character controller (proper wall sliding + ground
    // snap); distant zombies move directly for CPU performance.
    if (dist < 30) {
      const ctrl = this.physics.getCharacterController();
      ctrl.computeColliderMovement(
        this.collider,
        { x: dx, y: -0.22 * dt * 20, z: dz },
        undefined,
        MOVE_FILTER
      );
      const m = ctrl.computedMovement();
      const t = this.body.translation();
      this.body.setNextKinematicTranslation({ x: t.x+m.x, y: t.y+m.y, z: t.z+m.z });
    } else if (dx !== 0 || dz !== 0) {
      const t = this.body.translation();
      this.body.setNextKinematicTranslation({ x: t.x+dx, y: t.y, z: t.z+dz });
    }
  }

  // ─── Frame update — AI + animation ──────────────────────────────────────────
  update(dt, playerPos) {
    if (this._state === DEAD) return;

    if (this._state === DYING) {
      this._tickDeath(dt);
      return;
    }

    if (!this.alive) return;
    this._tickAI(dt, playerPos);
    this._tickAnim(dt, playerPos);
    this._syncMesh();
  }

  // ─── AI state machine ────────────────────────────────────────────────────────
  _tickAI(dt, playerPos) {
    const pos = this.body?.translation();
    if (!pos) return;

    const dist  = _dist2(pos, playerPos);
    const dyDiff = Math.abs(pos.y - (playerPos.y ?? 0));

    switch (this._state) {
      case IDLE:
        if (dist < this.cfg.detectRange || this._alertTimer > 0) {
          this._alertTimer = 0;
          this._state = CHASE;
          this.sound?.play?.('zombie_alert');
          this.onAggro?.(pos);
        }
        break;

      case CHASE:
        if (dist < this.cfg.attackRange && dyDiff < 2.5) {
          this._state       = ATTACK;
          this._attackTimer = 0;
        }
        break;

      case ATTACK:
        this._attackTimer += dt;
        if (this._attackTimer >= this.cfg.attackCooldown) {
          this._attackTimer = 0;
          this._doAttack(pos, playerPos, dist);
        }
        // Player moved out of range — resume chase
        if (dist > this.cfg.attackRange * 1.5) this._state = CHASE;
        break;

      case STAGGER:
        this._staggerTimer -= dt;
        if (this._staggerTimer <= 0)
          this._state = dist < this.cfg.attackRange ? ATTACK : CHASE;
        break;
    }

    if (this._alertTimer > 0) this._alertTimer -= dt;
  }

  _doAttack(pos, playerPos, dist) {
    this._attackAnim = 1.0;
    this.sound?.play?.('zombie_attack');
    this.onAttack?.(pos);

    if (this.type === 'exploder') {
      this.sound?.play?.('zombie_explode');
      this._blood?.burst(pos, 24);
      this.onExplosion?.({ x: pos.x, y: pos.y, z: pos.z }, 5);
      this._kill(_v.set(0, 1, 0));
      return;
    }

    if (this.type === 'spitter') {
      // Acid damage arrives after simulated travel time
      const ms = (dist / 13) * 1000;
      setTimeout(() => { if (this.alive) this.onAcidDamage?.(this.cfg.damage); }, ms);
      // Visual: green emissive flash on spitter
      this._mat.emissive.setHex(0x00ee44);
      setTimeout(() => { if (this._mat) this._mat.emissive.setHex(0); }, 280);
      return;
    }

    // Boss: wider swing that staggers player (done via larger damage)
    this.onMeleeHit?.(this.cfg.damage);
  }

  /** Called by WaveManager on nearby gunshot or explosion. */
  alert() {
    if (this._state === IDLE) this._state = CHASE;
    this._alertTimer = Math.max(this._alertTimer, 10);
  }

  // ─── Damage (physics entity interface called by weapon raycasts) ─────────────
  takeDamage(amount, hitPoint, hitDir) {
    if (!this.alive || this._state >= DYING) return;

    const pos   = this.body?.translation() ?? this.group.position;
    const relY  = (hitPoint?.y ?? pos.y) - pos.y;
    const isHead = relY > this._scale * 0.70;
    const actual = isHead ? amount * 3 : amount;

    this.hp -= actual;
    this.sound?.play?.('zombie_hurt');
    this._blood?.burst(hitPoint ?? pos, isHead ? 18 : 9);
    this.onTakeDamage?.(hitPoint ?? pos);

    // White hit-flash via emissive
    this._hitFlash = 0.12;
    this._mat.emissive.setHex(0xffffff);

    if (this.hp <= 0) {
      this._kill(hitDir);
      return;
    }

    // Stagger on heavy hits
    if (actual > 14) {
      this._state = STAGGER;
      this._staggerTimer = clamp(0.25 + actual / 120, 0.25, 0.7);
    }
  }

  _kill(hitDir) {
    if (!this.alive) return;
    this.alive    = false;
    this._state   = DYING;
    this._dyingTimer = 0;

    // Death fall axis: perpendicular to hit direction in XZ plane
    _v.copy(hitDir ?? _v.set(0, 0, 1));
    this._deathAxis.set(_v.z, 0, -_v.x);
    if (this._deathAxis.length() < 0.05) this._deathAxis.set(1, 0, 0);
    else this._deathAxis.normalize();

    this.sound?.play?.('zombie_die');
    this._blood?.burst(this.body?.translation() ?? this.group.position, 22);

    // Remove physics body immediately so bullets/player don't interact with corpse
    if (this.body) {
      this.physics.removeBody(this.body);
      this.body = null;
    }
    this.onDeath?.();
  }

  _tickDeath(dt) {
    this._dyingTimer += dt;
    const t    = Math.min(this._dyingTimer / 0.85, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep

    // Tip the group forward/backward along the death axis
    this.group.quaternion.setFromAxisAngle(this._deathAxis, -ease * (Math.PI * 0.5 + 0.3));
    this.group.position.y -= dt * 0.55 * ease;

    if (this._dyingTimer > 3.8) this._state = DEAD;
  }

  // ─── Animation ───────────────────────────────────────────────────────────────
  _tickAnim(dt, playerPos) {
    const pos = this.body?.translation();
    if (!pos) return;
    const p = this._parts;

    // Smooth yaw toward player
    const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.05) {
      const ty = Math.atan2(dx, dz);
      let diff = ty - this.group.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * Math.min(1, dt * (this.type === 'runner' ? 14 : 9));
    }

    // Hit flash decay
    if (this._hitFlash > 0) {
      this._hitFlash -= dt;
      if (this._hitFlash <= 0) this._mat.emissive.setHex(0);
    }

    // Attack arm swing
    if (this._attackAnim > 0) {
      this._attackAnim = Math.max(0, this._attackAnim - dt * 3.5);
      const sw = Math.sin(this._attackAnim * Math.PI);
      p.rArm.rotation.x = -sw * 1.5;
      p.lArm.rotation.x = -sw * 1.0;
    }

    if (this._state === IDLE || this._state === STAGGER) {
      p.rArm.rotation.x *= 0.82; p.lArm.rotation.x *= 0.82;
      p.rLeg.rotation.x *= 0.82; p.lLeg.rotation.x *= 0.82;
      return;
    }
    if (this._attackAnim > 0.08) return; // don't blend walk into attack

    // Walk / run cycle
    const isLimping = this.hp < this.maxHp * 0.3;
    const freq = this.cfg.speed * 1.5 * (isLimping ? 0.5 : 1);
    this._animPhase += dt * freq;
    const ph = this._animPhase;
    const amp = this.type === 'brute' ? 0.45 : 0.65;

    p.rArm.rotation.x =  Math.sin(ph) * amp;
    p.lArm.rotation.x = -Math.sin(ph) * amp;
    p.rLeg.rotation.x = -Math.sin(ph) * (amp + 0.12);
    p.lLeg.rotation.x =  Math.sin(ph) * (amp + 0.12);

    // Limping: crippled left leg
    if (isLimping) {
      p.lLeg.rotation.x *= 0.28;
      p.lLeg.rotation.z  = 0.28;
    } else {
      p.lLeg.rotation.z  = 0;
    }

    // Head loll
    p.head.rotation.z = Math.sin(ph * 0.5) * 0.18;
    p.head.rotation.x = 0.18 + Math.sin(ph * 0.65) * 0.10;
  }

  _syncMesh() {
    if (!this.body || !this.group) return;
    const t = this.body.translation();
    const s = this._scale;
    // Position mesh group at feet (body centre is at feet + hh + r above ground)
    this.group.position.set(t.x, t.y - (0.52 + 0.32) * s, t.z);
  }

  // ─── Mesh construction ───────────────────────────────────────────────────────
  _buildMesh() {
    const geo = _getGeo();
    const s   = this._scale;

    const col = this._baseColor.clone();
    col.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

    this._mat = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.88, metalness: 0.04,
    });

    // Helper: create mesh at scaled pos/size
    const mk = (geo, sx, sy, sz, px, py, pz) => {
      const m = new THREE.Mesh(geo, this._mat);
      m.scale.set(sx * s, sy * s, sz * s);
      m.position.set(px * s, py * s, pz * s);
      m.castShadow = true;
      return m;
    };

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';

    const p = this._parts;
    p.torso = mk(geo.torso, 1,   1,   1,    0, 0.90,  0);
    p.head  = mk(geo.head,  1,   1,   1,    0, 1.24,  0);
    p.lArm  = mk(geo.arm,   1,   1,   1, -0.20, 0.82, 0);
    p.rArm  = mk(geo.arm,   1,   1,   1,  0.20, 0.82, 0);
    p.lLeg  = mk(geo.leg,   1,   1,   1, -0.10, 0.44, 0);
    p.rLeg  = mk(geo.leg,   1,   1,   1,  0.10, 0.44, 0);

    // Glowing red eyes on head
    const le = new THREE.Mesh(geo.eye, _eyeMat);
    const re = new THREE.Mesh(geo.eye, _eyeMat);
    le.position.set(-0.07 * s, 0.03 * s, 0.12 * s);
    re.position.set( 0.07 * s, 0.03 * s, 0.12 * s);
    p.head.add(le, re);

    // Type-specific tweaks
    if (this.type === 'brute') {
      p.lArm.scale.set(1.30 * s, 1.45 * s, 1.30 * s);
      p.rArm.scale.set(1.30 * s, 1.45 * s, 1.30 * s);
      p.torso.scale.set(1.22 * s, 1.10 * s, 1.10 * s);
    }
    if (this.type === 'exploder') {
      this._mat.color.setHex(0x8a5208);
      this._mat.emissive.setHex(0x3a1000);
    }
    if (this.type === 'boss') {
      this._mat.emissive.setHex(0x0a1a00);
      this._mat.roughness = 0.6;
      // Add three bioluminescent patches
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x44ff00, toneMapped: false });
      const glowGeo = new THREE.BoxGeometry(0.06, 0.28, 0.06);
      for (const [ox, oz] of [[-0.16, 0.09], [0.16, 0.09], [0, -0.09]]) {
        const g = new THREE.Mesh(glowGeo, glowMat);
        g.position.set(ox * s, 0.96 * s, oz * s);
        this.group.add(g);
      }
    }

    this.group.add(p.torso, p.head, p.lArm, p.rArm, p.lLeg, p.rLeg);
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────
  get position() { return this.body?.translation(); }

  // ─── Disposal ────────────────────────────────────────────────────────────────
  dispose() {
    if (this.body) { this.physics.removeBody(this.body); this.body = null; }
    if (this.group) { this.scene.remove(this.group); this.group = null; }
    this._mat?.dispose();
    this._mat = null;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _dist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx*dx + dz*dz);
}

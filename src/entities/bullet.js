import * as THREE from 'three';
import { BULLET, GROUPS } from '../utils/constants.js';
import { makeGroups } from '../core/physics.js';

const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _mid  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _prev = new THREE.Vector3();

// Crossbow bolts collide with world + zombies
const BOLT_FILTER = makeGroups(GROUPS.BULLET, GROUPS.WORLD | GROUPS.ZOMBIE);

/**
 * Visual-only pool of bullet tracers and impact sparks, plus physical crossbow
 * bolt projectiles. Hitscan weapons produce instant tracers; the crossbow gets
 * a real bolt that travels through the air and raycasts each step.
 */
export class BulletPool {
  /**
   * @param {THREE.Scene} scene
   * @param {number}      size   tracer / impact pool size
   * @param {Physics|null} physics  optional; required for fireBolt()
   */
  constructor(scene, size = BULLET.poolSize, physics = null) {
    this.scene   = scene;
    this.physics = physics;
    this.tracers  = [];
    this.impacts  = [];
    this._bolts   = [];
    this._cursor  = 0;
    this._impCursor = 0;

    // ── Tracers (emissive cylinders) ─────────────────────────────────────────
    const tracerGeo = new THREE.CylinderGeometry(BULLET.radius, BULLET.radius, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0); // pivot at base → scale.y = length
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: BULLET.trailColor,
        transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, ttl: 0.06 });
    }

    // ── Impact sparks (additive sprites) ─────────────────────────────────────
    for (let i = 0; i < 32; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: 0xffd27a, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        })
      );
      s.scale.setScalar(0.3);
      s.visible = false;
      scene.add(s);
      this.impacts.push({ sprite: s, life: 0, ttl: 0.12 });
    }
  }

  // ── Tracer from muzzle to hit point ────────────────────────────────────────
  spawnTracer(from, to) {
    const t = this.tracers[this._cursor];
    this._cursor = (this._cursor + 1) % this.tracers.length;

    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 0.001) return;
    _dir.normalize();

    t.mesh.position.copy(from);
    _quat.setFromUnitVectors(_up, _dir);
    t.mesh.quaternion.copy(_quat);
    t.mesh.scale.set(1, len, 1);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.ttl;
  }

  // ── Impact flash ──────────────────────────────────────────────────────────
  spawnImpact(point) {
    const i = this.impacts[this._impCursor];
    this._impCursor = (this._impCursor + 1) % this.impacts.length;
    i.sprite.position.copy(point);
    i.sprite.scale.setScalar(0.25 + Math.random() * 0.18);
    i.sprite.material.opacity = 1;
    i.sprite.visible = true;
    i.life = i.ttl;
  }

  // ── Crossbow bolt ─────────────────────────────────────────────────────────
  /**
   * Launch a physical crossbow bolt.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir       normalized flight direction
   * @param {number}        speed     m/s
   * @param {number}        damage    raw damage value (passed back to onHit)
   * @param {Function}      onHit     (entity, hitPoint: THREE.Vector3, hitDir: THREE.Vector3) → void
   */
  fireBolt(origin, dir, speed, damage, onHit) {
    if (!this.physics) return; // physics not wired — skip

    // Find or create an inactive slot
    let slot = this._bolts.find(b => !b.active);
    if (!slot) {
      const geo  = new THREE.CylinderGeometry(0.008, 0.008, 0.26, 5);
      geo.rotateX(Math.PI / 2); // orient along –Z
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x886644, roughness: 0.8, metalness: 0.2 })
      );
      this.scene.add(mesh);
      slot = { mesh, vel: new THREE.Vector3(), life: 0, active: false, onHit: null };
      this._bolts.push(slot);
    }

    slot.mesh.position.copy(origin);
    slot.vel.copy(dir).multiplyScalar(speed);
    // Orient mesh nose-first in flight direction
    _quat.setFromUnitVectors(_up, dir.clone().normalize());
    slot.mesh.quaternion.copy(_quat);
    slot.mesh.visible = true;
    slot.life   = 5.0;
    slot.active = true;
    slot.onHit  = onHit;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────
  update(dt) {
    // Tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, (t.life / t.ttl) * 0.9);
      if (t.life <= 0) t.mesh.visible = false;
    }

    // Impacts
    for (const i of this.impacts) {
      if (i.life <= 0) continue;
      i.life -= dt;
      i.sprite.material.opacity = Math.max(0, i.life / i.ttl);
      i.sprite.scale.x += dt * 1.5;
      i.sprite.scale.y += dt * 1.5;
      if (i.life <= 0) i.sprite.visible = false;
    }

    // Bolts
    for (const b of this._bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }

      _prev.copy(b.mesh.position);
      b.vel.y -= 2.5 * dt; // gentle arc
      b.mesh.position.addScaledVector(b.vel, dt);

      // Orient along velocity
      const spd = b.vel.length();
      if (spd > 0.01) {
        _dir.copy(b.vel).normalize();
        _quat.setFromUnitVectors(_up, _dir);
        b.mesh.quaternion.copy(_quat);
      }

      // Raycast the step for collision (step-based to avoid tunnelling)
      if (this.physics) {
        _dir.subVectors(b.mesh.position, _prev);
        const dist = _dir.length();
        if (dist > 0.001) {
          _dir.normalize();
          const hit = this.physics.raycast(_prev, _dir, dist + 0.06, null, BOLT_FILTER);
          if (hit) {
            b.active = false;
            b.mesh.visible = false;
            const hp = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
            b.onHit?.(hit.entity, hp, _dir);
            this.spawnImpact(hp);
          }
        }
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  dispose() {
    for (const t of this.tracers) {
      t.mesh.geometry?.dispose();
      t.mesh.material.dispose();
      this.scene.remove(t.mesh);
    }
    for (const i of this.impacts) {
      i.sprite.material.dispose();
      this.scene.remove(i.sprite);
    }
    for (const b of this._bolts) {
      b.mesh.geometry?.dispose();
      b.mesh.material?.dispose();
      this.scene.remove(b.mesh);
    }
  }
}

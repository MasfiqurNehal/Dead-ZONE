/**
 * wave-manager.js — Wave orchestration for DEAD ZONE
 *
 * Wiring (main.js):
 *   waveManager = new WaveManager({ scene, physics, engine, quality, sound, player, arena });
 *   waveManager.onKill      = (type, reward) => { kills++; score += reward; hud.flashHitmarker(); };
 *   waveManager.onWaveClear = () => { score += WAVES.scorePerWave; hud.announceClear(currentWave); };
 *   waveManager.attach(engine);
 *
 *   // Begin a wave (call after the rest timer fires):
 *   const pts = arena.getSpawnPoints(count);
 *   waveManager.startWave(waveNum, pts);
 *
 *   // After a gunshot:
 *   waveManager.alertZombies(camera.position, 28);
 *
 *   // On new game / reset:
 *   waveManager.killAll();
 */

import * as THREE from 'three';
import { Zombie, BloodPool, ZOMBIE_TYPES, ZOMBIE_STATE } from '../entities/zombie.js';
import { WAVES } from '../utils/constants.js';

// ─── Wave composition tiers ───────────────────────────────────────────────────
// Each tier is active from `from` wave onwards. Types are weighted picks.
const TIERS = [
  { from:  1, pool: [{ t: 'walker',   w: 10 }] },
  { from:  3, pool: [{ t: 'walker',   w:  6 }, { t: 'runner',   w: 2 }] },
  { from:  5, pool: [{ t: 'walker',   w:  5 }, { t: 'runner',   w: 3 }, { t: 'exploder', w: 1 }] },
  { from:  7, pool: [{ t: 'walker',   w:  4 }, { t: 'runner',   w: 3 }, { t: 'exploder', w: 2 }, { t: 'brute',    w: 1 }] },
  { from: 10, pool: [{ t: 'walker',   w:  3 }, { t: 'runner',   w: 3 }, { t: 'brute',    w: 2 }, { t: 'exploder', w: 1 }, { t: 'spitter',  w: 2 }] },
];

function _pickType(waveNum) {
  let tier = TIERS[0];
  for (const t of TIERS) { if (waveNum >= t.from) tier = t; }
  const total = tier.pool.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of tier.pool) { r -= e.w; if (r <= 0) return e.t; }
  return tier.pool[0].t;
}

// ─── WaveManager ─────────────────────────────────────────────────────────────
export class WaveManager {
  /**
   * @param {{ scene, physics, engine, quality, sound, player, arena }} ctx
   */
  constructor({ scene, physics, engine, quality, sound = null, player, arena }) {
    this.scene   = scene;
    this.physics = physics;
    this.engine  = engine;
    this.sound   = sound;
    this.player  = player;
    this.arena   = arena;

    // ── Callbacks set by main.js ──
    this.onKill         = null; // (type, reward, isHeadshot, pos) => void
    this.onWaveClear    = null; // () => void
    this.onZombieSpawn  = null; // (zombie) => void
    this.onZombieDamage = null; // (zombie, hitPoint) => void

    // ── State ──
    this._zombies    = [];  // active Zombie instances
    this._queue      = [];  // { type, pos } pending spawns
    this._spawnTimer = 0;
    this._wave       = 0;
    this._active     = false;
    this._hpMul      = 1;   // HP scale for this wave
    this._spdMul     = 1;   // speed scale for this wave
    this._maxCap     = quality.maxZombies;

    // Shared blood particle pool (owned here, passed into each zombie)
    this._bloodPool  = new BloodPool(scene);

    // Engine subscription handles
    this._offUpdate = null;
    this._offFixed  = null;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  attach(engine = this.engine) {
    this._offUpdate = engine.onUpdate(this._update.bind(this));
    this._offFixed  = engine.onFixedUpdate(this._fixedUpdate.bind(this));
    return () => this.detach();
  }

  detach() {
    this._offUpdate?.(); this._offFixed?.();
    this._offUpdate = this._offFixed = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Begin a new wave.
   * @param {number} waveNum  1-based wave number
   * @param {Array<{x,y,z}>} spawnPts  spawn positions (from arena.getSpawnPoints)
   */
  startWave(waveNum, spawnPts) {
    this._wave   = waveNum;
    this._active = true;
    this._hpMul  = 1 + (waveNum - 1) * 0.08;
    this._spdMul = 1 + (waveNum - 1) * 0.035;
    this._queue  = this._buildQueue(waveNum, spawnPts);
    this._spawnTimer = 0;
    this.sound?.play?.('wave_start');
  }

  /**
   * Alert all zombies within `radius` of `pos` — e.g. on a gunshot.
   * @param {{x,y,z}} pos
   * @param {number} radius
   */
  alertZombies(pos, radius) {
    const r2 = radius * radius;
    for (const z of this._zombies) {
      if (!z.alive) continue;
      const zp = z.position;
      if (!zp) continue;
      const dx = zp.x - pos.x, dz = zp.z - pos.z;
      if (dx*dx + dz*dz < r2) z.alert();
    }
  }

  /** Remove all zombies immediately (call on new game / reset). */
  killAll() {
    for (const z of this._zombies) z.dispose();
    this._zombies = [];
    this._queue   = [];
    this._active  = false;
  }

  /** Number of living zombies currently on the map. */
  get activeCount() { return this._zombies.filter(z => z.alive).length; }

  // ─── Build spawn queue ───────────────────────────────────────────────────────
  _buildQueue(waveNum, spawnPts) {
    const isBoss = waveNum % 10 === 0;
    const count  = WAVES.firstWaveCount + (waveNum - 1) * WAVES.countPerWave;
    const pts    = spawnPts?.length ? spawnPts : [{ x: 0, y: 0, z: 0 }];
    const queue  = [];

    if (isBoss) {
      queue.push({ type: 'boss', pos: pts[0] });
    }

    const n = isBoss ? Math.ceil(count * 0.6) : count;
    for (let i = 0; i < n; i++) {
      queue.push({ type: _pickType(waveNum), pos: pts[i % pts.length] });
    }

    // Shuffle so types are interleaved rather than clustered at spawn
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    // Boss always spawns first
    if (isBoss) {
      const bi = queue.findIndex(e => e.type === 'boss');
      if (bi > 0) [queue[0], queue[bi]] = [queue[bi], queue[0]];
    }
    return queue;
  }

  // ─── Fixed update — zombie physics movement ──────────────────────────────────
  _fixedUpdate(dt) {
    const pp = this._playerPos();
    if (!pp) return;
    for (const z of this._zombies) {
      if (z.alive) z.fixedUpdate(dt, pp, this._zombies);
    }
  }

  // ─── Frame update — AI, animation, spawning, cleanup ─────────────────────────
  _update(dt) {
    // Update blood pool (single call covers all zombies)
    this._bloodPool.update(dt);

    const pp = this._playerPos();
    if (!pp) return;

    // Drip-spawn from queue, respecting the active cap
    if (this._queue.length > 0 && this.activeCount < this._maxCap) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = WAVES.spawnInterval;
        this._spawnOne();
      }
    }

    // Tick all zombies (AI + animation)
    for (const z of this._zombies) {
      z.update(dt, pp);
    }

    // Purge fully dead zombies (animation finished)
    for (let i = this._zombies.length - 1; i >= 0; i--) {
      if (this._zombies[i]._state === ZOMBIE_STATE.DEAD) {
        this._zombies[i].dispose();
        this._zombies.splice(i, 1);
      }
    }

    // Wave clear: all zombies dead AND spawn queue empty
    if (this._active && this._queue.length === 0 && this._zombies.length === 0) {
      this._active = false;
      this.onWaveClear?.();
    }
  }

  // ─── Spawn one zombie from the queue ────────────────────────────────────────
  _spawnOne() {
    const entry = this._queue.shift();
    if (!entry) return;

    const z = new Zombie({
      type:      entry.type,
      scene:     this.scene,
      physics:   this.physics,
      sound:     this.sound,
      bloodPool: this._bloodPool,
    });

    // Apply per-wave scaling BEFORE calling spawn() so maxHp is already set
    z.cfg   = { ...z.cfg, speed: z.cfg.speed * this._spdMul };
    z.maxHp = Math.round(z.cfg.hp * this._hpMul);
    z.hp    = z.maxHp;

    // Wire damage / event callbacks
    z.onDeath = () => {
      this.onKill?.(z.type, ZOMBIE_TYPES[z.type]?.reward ?? 100);
    };

    z.onTakeDamage = (hitPoint) => {
      this.onZombieDamage?.(z, hitPoint);
    };

    z.onMeleeHit = (dmg) => {
      this.player?.takeDamage?.(dmg);
    };

    z.onExplosion = (rawPos, radius) => {
      // Forward to arena.onExplosion which also handles player area damage
      const worldPos = new THREE.Vector3(rawPos.x, rawPos.y, rawPos.z);
      this.arena?.onExplosion?.(worldPos, radius);
    };

    z.onAcidDamage = (dmg) => {
      this.player?.takeDamage?.(dmg);
    };

    z.spawn(entry.pos);
    this._zombies.push(z);
    this.onZombieSpawn?.(z);
  }

  // ─── Helper: player camera position ─────────────────────────────────────────
  _playerPos() {
    if (!this.player?.alive) return null;
    // player.camera is the THREE.PerspectiveCamera (set in Player constructor)
    return this.player.camera?.position ?? null;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────
  dispose() {
    this.detach();
    this.killAll();
    this._bloodPool.dispose();
  }
}

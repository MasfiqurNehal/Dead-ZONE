/**
 * src/core/sound-manager.js — DEAD ZONE audio system (Howler.js)
 *
 * Place sound files in /public/sounds/<category>/<name>.mp3
 * Free sources:
 *   Freesound.org (CC0)  →  https://freesound.org
 *   Pixabay Audio        →  https://pixabay.com/sound-effects/
 *   OpenGameArt.org      →  https://opengameart.org
 *
 * All Howl instances are created lazily (graceful no-op if files are absent).
 */

// ─── Lazy Howler import ───────────────────────────────────────────────────────
let Howl = null, Howler = null;
let _howlerReady = false;

async function _ensureHowler() {
  if (_howlerReady) return _howlerReady;
  try {
    const m = await import('howler');
    Howl   = m.Howl   ?? m.default?.Howl;
    Howler = m.Howler ?? m.default?.Howler;
    if (Howler) Howler.autoSuspend = false;
    _howlerReady = !!(Howl && Howler);
  } catch { _howlerReady = false; }
  return _howlerReady;
}

// ─── Sound bank definition ───────────────────────────────────────────────────
// Each entry: { src, volume, pool?, loop?, rate? }
// Freesound IDs are noted in comments — search those IDs at freesound.org
const BANK = {
  /* ── Weapons ── */
  // Pistol — freesound: 476178, 415510
  'gun/pistol_fire':        { src: ['sounds/weapons/pistol_fire.mp3'],        volume: 0.90, pool: 4,  rate: [0.95, 1.05] },
  'gun/pistol_reload':      { src: ['sounds/weapons/pistol_reload.mp3'],       volume: 0.75 },
  'gun/pistol_empty':       { src: ['sounds/weapons/gun_empty.mp3'],           volume: 0.55 },
  // SMG — freesound: 387186
  'gun/smg_fire':           { src: ['sounds/weapons/smg_fire.mp3'],            volume: 0.80, pool: 8,  rate: [0.98, 1.02] },
  'gun/smg_reload':         { src: ['sounds/weapons/smg_reload.mp3'],          volume: 0.72 },
  // Shotgun — freesound: 412068
  'gun/shotgun_fire':       { src: ['sounds/weapons/shotgun_fire.mp3'],        volume: 1.00, pool: 3 },
  'gun/shotgun_pump':       { src: ['sounds/weapons/shotgun_pump.mp3'],        volume: 0.80 },
  'gun/shotgun_reload':     { src: ['sounds/weapons/shotgun_reload.mp3'],      volume: 0.65 },
  // Assault Rifle — freesound: 411470
  'gun/ar_fire':            { src: ['sounds/weapons/ar_fire.mp3'],             volume: 0.88, pool: 8,  rate: [0.97, 1.03] },
  'gun/ar_reload':          { src: ['sounds/weapons/ar_reload.mp3'],           volume: 0.75 },
  // Sniper — freesound: 519093
  'gun/sniper_fire':        { src: ['sounds/weapons/sniper_fire.mp3'],         volume: 1.00 },
  'gun/sniper_bolt':        { src: ['sounds/weapons/sniper_bolt.mp3'],         volume: 0.70 },
  'gun/sniper_reload':      { src: ['sounds/weapons/sniper_reload.mp3'],       volume: 0.65 },
  // Crossbow — freesound: 243701
  'gun/crossbow_fire':      { src: ['sounds/weapons/crossbow_fire.mp3'],       volume: 0.70 },
  'gun/crossbow_reload':    { src: ['sounds/weapons/crossbow_reload.mp3'],     volume: 0.65 },
  // Flamethrower — freesound: 173955
  'gun/flamethrower_start': { src: ['sounds/weapons/flamethrower_start.mp3'],  volume: 0.70 },
  'gun/flamethrower_loop':  { src: ['sounds/weapons/flamethrower_loop.mp3'],   volume: 0.80, loop: true },
  'gun/flamethrower_end':   { src: ['sounds/weapons/flamethrower_end.mp3'],    volume: 0.55 },
  // Katana — freesound: 445974, 523524
  'gun/katana_swing':       { src: ['sounds/weapons/katana_swing.mp3'],        volume: 0.80, pool: 3,  rate: [0.90, 1.10] },
  'gun/katana_hit':         { src: ['sounds/weapons/katana_hit.mp3'],          volume: 0.85, pool: 3 },
  // Shell casings — freesound: 95078
  'gun/shell_drop':         { src: ['sounds/weapons/shell_drop.mp3'],          volume: 0.30, pool: 6,  rate: [0.80, 1.20] },

  /* ── Zombies ── */
  // freesound: 371388, 270402, 395655, 395658
  'zombie/groan_1':   { src: ['sounds/zombies/groan_1.mp3'],   volume: 0.65, rate: [0.75, 1.15] },
  'zombie/groan_2':   { src: ['sounds/zombies/groan_2.mp3'],   volume: 0.65, rate: [0.75, 1.15] },
  'zombie/groan_3':   { src: ['sounds/zombies/groan_3.mp3'],   volume: 0.65, rate: [0.80, 1.10] },
  'zombie/aggro':     { src: ['sounds/zombies/aggro.mp3'],     volume: 0.85, rate: [0.90, 1.10] },
  'zombie/attack_1':  { src: ['sounds/zombies/attack_1.mp3'],  volume: 0.80, rate: [0.85, 1.15] },
  'zombie/attack_2':  { src: ['sounds/zombies/attack_2.mp3'],  volume: 0.80, rate: [0.85, 1.15] },
  'zombie/death_1':   { src: ['sounds/zombies/death_1.mp3'],   volume: 0.75, rate: [0.85, 1.15] },
  'zombie/death_2':   { src: ['sounds/zombies/death_2.mp3'],   volume: 0.75, rate: [0.85, 1.15] },
  'zombie/death_3':   { src: ['sounds/zombies/death_3.mp3'],   volume: 0.75, rate: [0.85, 1.15] },
  'zombie/thud':      { src: ['sounds/zombies/body_thud.mp3'], volume: 0.55, pool: 4, rate: [0.85, 1.15] },

  /* ── Player / UI ── */
  'player/hurt_1':    { src: ['sounds/player/hurt_1.mp3'],     volume: 0.70, pool: 3 },
  'player/hurt_2':    { src: ['sounds/player/hurt_2.mp3'],     volume: 0.70, pool: 3 },
  'player/step_dirt': { src: ['sounds/player/step_dirt.mp3'],  volume: 0.28, pool: 4, rate: [0.88, 1.12] },
  'player/step_road': { src: ['sounds/player/step_road.mp3'],  volume: 0.25, pool: 4, rate: [0.88, 1.12] },
  'player/heartbeat': { src: ['sounds/player/heartbeat.mp3'],  volume: 0.00, loop: true },

  /* ── Impacts ── */
  'impact/flesh':     { src: ['sounds/impacts/flesh_hit.mp3'],  volume: 0.65, pool: 6,  rate: [0.80, 1.20] },
  'impact/metal':     { src: ['sounds/impacts/metal_hit.mp3'],  volume: 0.45, pool: 4,  rate: [0.85, 1.15] },
  'impact/concrete':  { src: ['sounds/impacts/concrete.mp3'],   volume: 0.40, pool: 4,  rate: [0.85, 1.15] },
  'impact/explosion': { src: ['sounds/impacts/explosion.mp3'],  volume: 1.00, pool: 2 },
  'impact/glass':     { src: ['sounds/impacts/glass_break.mp3'],volume: 0.60, pool: 3 },

  /* ── Ambient (loops) ── */
  'ambient/wind':     { src: ['sounds/ambient/wind_loop.mp3'],      volume: 0.18, loop: true },
  'ambient/drone':    { src: ['sounds/ambient/eerie_drone.mp3'],    volume: 0.22, loop: true },
  'ambient/thunder':  { src: ['sounds/ambient/distant_thunder.mp3'],volume: 0.55, rate: [0.90, 1.10] },
  'ambient/crows':    { src: ['sounds/ambient/crows.mp3'],          volume: 0.40, rate: [0.90, 1.10] },

  /* ── Music ── */
  'music/calm':    { src: ['sounds/music/calm.mp3'],    volume: 0, loop: true },
  'music/tense':   { src: ['sounds/music/tense.mp3'],   volume: 0, loop: true },
  'music/intense': { src: ['sounds/music/intense.mp3'], volume: 0, loop: true },
  'music/boss':    { src: ['sounds/music/boss.mp3'],    volume: 0, loop: true },
};

// Music state → track key
const MUSIC_TRACK = {
  menu:    'music/calm',
  calm:    'music/calm',
  tense:   'music/tense',
  intense: 'music/intense',
  boss:    'music/boss',
};

// ─── SoundManager ─────────────────────────────────────────────────────────────
export class SoundManager {
  constructor() {
    this._sounds = {};              // id → Howl
    this._loops  = new Map();       // id → soundId (Howler internal ID)
    this._camera = null;

    this._masterVol = 0.8;
    this._sfxVol    = 0.8;
    this._musicVol  = 0.5;

    this._musicState   = null;      // current music key
    this._musicFadeMs  = 2200;      // crossfade duration ms
    this._musicFadeTimer = {};      // key → timerId for fade

    this._heartbeatId  = null;      // Howler play id
    this._heartbeatRate = 1.0;

    this._ambientThunderTimer = 0;
    this._ambientCrowsTimer   = 0;
    this._ready = false;

    // Throttle 3D groans so zombies don't all groan simultaneously
    this._lastGroanTime = 0;
    this._groanCooldown = 2.5;     // seconds between any zombie groan
  }

  // ── Initialisation ─────────────────────────────────────────────────────────
  /** Load all sounds. Returns Promise<boolean>. */
  async load() {
    const ok = await _ensureHowler();
    if (!ok) { console.warn('[Sound] Howler.js not available — audio disabled'); return false; }

    const load = (id, def) => new Promise(resolve => {
      try {
        const h = new Howl({
          src:    def.src,
          volume: 0,
          loop:   def.loop ?? false,
          pool:   def.pool ?? 1,
          rate:   Array.isArray(def.rate) ? 1 : (def.rate ?? 1),
          onloaderror: () => resolve(null),
          onload:       () => resolve(h),
        });
        this._sounds[id] = h;
        h._dzBasevol = def.volume;
        h._dzRate    = def.rate;    // [min,max] or undefined
        resolve(h);
      } catch { resolve(null); }
    });

    // Load in parallel, max 12 concurrent to avoid browser limits
    const ids = Object.keys(BANK);
    for (let i = 0; i < ids.length; i += 12) {
      await Promise.all(ids.slice(i, i + 12).map(id => load(id, BANK[id])));
    }

    this._ready = true;
    return true;
  }

  // ── Volume controls ────────────────────────────────────────────────────────
  setMasterVolume(v) {
    this._masterVol = Math.max(0, Math.min(1, v));
    if (Howler) Howler.volume(this._masterVol);
  }

  setSFXVolume(v) {
    this._sfxVol = Math.max(0, Math.min(1, v));
  }

  setMusicVolume(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    // Update currently playing music volume
    for (const [state, key] of Object.entries(MUSIC_TRACK)) {
      const h = this._sounds[key];
      if (h?.playing()) h.volume(this._musicVol);
    }
  }

  // ── Core play ──────────────────────────────────────────────────────────────
  /**
   * Play a 2D (non-positional) SFX.
   * @param {string} id     sound bank key
   * @param {number} [vol]  override volume (0-1); default uses bank value × sfxVol
   * @returns {number|null} Howler play ID
   */
  play(id, vol) {
    if (!this._ready) return null;
    const h = this._sounds[id];
    if (!h) return null;
    const base = vol ?? h._dzBasevol ?? 1;
    const rate = h._dzRate ? _randRange(h._dzRate[0], h._dzRate[1]) : 1;
    h.volume(base * this._sfxVol);
    h.rate(rate);
    return h.play();
  }

  /**
   * Play a 3D positional SFX.
   * @param {string} id
   * @param {{ x,y,z }|[x,y,z]} pos   world position
   * @param {number} [refDist]  reference distance (m, default 4)
   * @param {number} [maxDist]  max audible distance (m, default 40)
   * @returns {number|null}
   */
  play3d(id, pos, refDist = 4, maxDist = 40) {
    if (!this._ready || !this._camera) return this.play(id);
    const h = this._sounds[id];
    if (!h) return null;
    const x = pos.x ?? pos[0] ?? 0;
    const y = pos.y ?? pos[1] ?? 0;
    const z = pos.z ?? pos[2] ?? 0;

    const base = h._dzBasevol ?? 1;
    const rate = h._dzRate ? _randRange(h._dzRate[0], h._dzRate[1]) : 1;
    h.volume(base * this._sfxVol);
    h.rate(rate);

    const pid = h.play();
    if (pid == null) return null;

    try {
      h.pos(x, y, z, pid);
      h.pannerAttr({ refDistance: refDist, maxDistance: maxDist, rolloffFactor: 1.4, distanceModel: 'inverse' }, pid);
    } catch (_) { /* spatial API may not be available */ }
    return pid;
  }

  // ── Camera (listener) ─────────────────────────────────────────────────────
  setListener(camera) {
    this._camera = camera;
  }

  _updateListener() {
    if (!this._ready || !this._camera || !Howler) return;
    const c = this._camera;
    const p = c.position;
    // Compute forward vector from camera quaternion
    const fwd = { x: 0, y: 0, z: -1 };
    const up  = { x: 0, y: 1, z:  0 };
    // Rotate by camera quaternion (simplified: use matrixWorld)
    const m = c.matrixWorld.elements;
    fwd.x = -m[8]; fwd.y = -m[9]; fwd.z = -m[10];
    up.x   =  m[4]; up.y  =  m[5]; up.z  =  m[6];

    try {
      Howler.pos(p.x, p.y, p.z);
      Howler.orientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    } catch (_) {}
  }

  // ── Loops (for continuous sounds) ─────────────────────────────────────────
  startLoop(id) {
    if (!this._ready) return;
    if (this._loops.has(id)) return;
    const h = this._sounds[id];
    if (!h) return;
    h.volume(h._dzBasevol * this._sfxVol);
    const pid = h.play();
    this._loops.set(id, pid);
  }

  stopLoop(id) {
    if (!this._loops.has(id)) return;
    const h = this._sounds[id];
    h?.stop(this._loops.get(id));
    this._loops.delete(id);
  }

  // ── Music system ──────────────────────────────────────────────────────────
  /**
   * Transition to a music state. Crossfades from old track to new.
   * @param {'menu'|'calm'|'tense'|'intense'|'boss'} state
   */
  playMusic(state) {
    if (!this._ready) return;
    const newKey = MUSIC_TRACK[state];
    const oldKey = this._musicState;
    if (newKey === oldKey) return;

    const fadeMs = this._musicFadeMs;

    // Fade out old
    if (oldKey && this._sounds[oldKey]) {
      const oldH = this._sounds[oldKey];
      clearTimeout(this._musicFadeTimer[oldKey]);
      oldH.fade(oldH.volume(), 0, fadeMs);
      this._musicFadeTimer[oldKey] = setTimeout(() => oldH.stop(), fadeMs + 50);
    }

    // Fade in new
    const newH = this._sounds[newKey];
    if (newH) {
      clearTimeout(this._musicFadeTimer[newKey]);
      newH.volume(0);
      if (!newH.playing()) newH.play();
      newH.fade(0, this._musicVol, fadeMs);
    }

    this._musicState = newKey;
  }

  stopMusic() {
    const key = this._musicState;
    if (!key) return;
    const h = this._sounds[key];
    if (h) { h.fade(h.volume(), 0, 1000); setTimeout(() => h.stop(), 1100); }
    this._musicState = null;
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  /** Call with player.health every frame. */
  _updateHeartbeat(hp) {
    const h = this._sounds['player/heartbeat'];
    if (!h) return;
    if (hp <= 0) { h.volume(0); return; }

    if (hp < 35) {
      // Volume increases as HP drops; rate increases too (panic)
      const t = (35 - hp) / 35;
      const vol = t * 0.55 * this._sfxVol;
      const rate = 0.9 + t * 0.8;  // 0.9 to 1.7
      h.volume(vol);
      if (!h.playing()) {
        this._heartbeatId = h.play();
      }
      if (Math.abs(h.rate() - rate) > 0.05) h.rate(rate);
      this._heartbeatRate = rate;
    } else {
      h.volume(0);
      h.stop();
    }
  }

  // ── Ambient ───────────────────────────────────────────────────────────────
  startAmbient() {
    this.startLoop('ambient/wind');
    this.startLoop('ambient/drone');
  }

  stopAmbient() {
    this.stopLoop('ambient/wind');
    this.stopLoop('ambient/drone');
    this.stopLoop('ambient/thunder');
    this.stopLoop('ambient/crows');
  }

  _tickAmbient(dt) {
    // Random thunder
    this._ambientThunderTimer -= dt;
    if (this._ambientThunderTimer <= 0) {
      this.play('ambient/thunder');
      this._ambientThunderTimer = 18 + Math.random() * 30;
    }
    // Random crows
    this._ambientCrowsTimer -= dt;
    if (this._ambientCrowsTimer <= 0) {
      this.play('ambient/crows');
      this._ambientCrowsTimer = 25 + Math.random() * 45;
    }
  }

  // ── High-level game events ─────────────────────────────────────────────────
  /** Call on weapon fire. */
  onWeaponFire(weaponType, muzzleWorldPos) {
    const map = {
      pistol:       'gun/pistol_fire',
      smg:          'gun/smg_fire',
      shotgun:      'gun/shotgun_fire',
      ar:           'gun/ar_fire',
      sniper:       'gun/sniper_fire',
      crossbow:     'gun/crossbow_fire',
      flamethrower: null,           // uses looping system
      katana:       'gun/katana_swing',
    };
    const id = map[weaponType];
    if (id) this.play3d(id, muzzleWorldPos ?? { x:0,y:0,z:0 }, 2, 35);

    // Shell drop (random pitch offset simulates tumble)
    if (weaponType !== 'katana' && weaponType !== 'crossbow') {
      setTimeout(() => this.play('gun/shell_drop'), 120 + Math.random() * 80);
    }
  }

  onWeaponEmpty(weaponType) { this.play('gun/pistol_empty'); }

  onWeaponReload(weaponType, stage = 'start') {
    const map = {
      pistol:   stage === 'start' ? 'gun/pistol_reload' : null,
      smg:      stage === 'start' ? 'gun/smg_reload'    : null,
      shotgun:  stage === 'start' ? 'gun/shotgun_pump'  : null,
      ar:       stage === 'start' ? 'gun/ar_reload'      : null,
      sniper:   stage === 'start' ? 'gun/sniper_bolt'    : null,
      crossbow: stage === 'start' ? 'gun/crossbow_reload': null,
      katana:   null,
    };
    const id = (map[weaponType] ?? null);
    if (id) this.play(id);
  }

  onFlamethrowerStart()  { this.play('gun/flamethrower_start'); this.startLoop('gun/flamethrower_loop'); }
  onFlamethrowerEnd()    { this.play('gun/flamethrower_end');   this.stopLoop('gun/flamethrower_loop');  }

  onKatanaHit()          { this.play('gun/katana_hit'); }

  onImpact(surface, pos) {
    const map = { flesh: 'impact/flesh', metal: 'impact/metal', concrete: 'impact/concrete', glass: 'impact/glass' };
    this.play3d(map[surface] ?? 'impact/concrete', pos, 1, 20);
  }

  onExplosion(pos) { this.play3d('impact/explosion', pos, 4, 60); }

  /** Called periodically while zombie is alive and idle. */
  onZombieGroan(pos) {
    const now = performance.now() / 1000;
    if (now - this._lastGroanTime < this._groanCooldown) return;
    this._lastGroanTime = now;
    const id = 'zombie/groan_' + (1 + Math.floor(Math.random() * 3));
    this.play3d(id, pos, 3, 28);
  }

  onZombieAggro(pos) {
    this.play3d('zombie/aggro', pos, 3, 35);
  }

  onZombieAttack(pos) {
    const id = Math.random() < 0.5 ? 'zombie/attack_1' : 'zombie/attack_2';
    this.play3d(id, pos, 2, 18);
  }

  onZombieDeath(pos) {
    const id = 'zombie/death_' + (1 + Math.floor(Math.random() * 3));
    this.play3d(id, pos, 2, 20);
    setTimeout(() => this.play3d('zombie/thud', pos, 1, 14), 250 + Math.random() * 200);
  }

  onPlayerHurt() {
    const id = Math.random() < 0.5 ? 'player/hurt_1' : 'player/hurt_2';
    this.play(id);
  }

  onFootstep(surface = 'road') {
    this.play(surface === 'dirt' ? 'player/step_dirt' : 'player/step_road');
  }

  // ── Music state helpers ───────────────────────────────────────────────────
  setMusicForMenu()          { this.playMusic('menu');    }
  setMusicForWaveClear()     { this.playMusic('calm');    }
  setMusicForWave(wave)      {
    if (wave <= 0)    this.playMusic('calm');
    else if (wave <= 3) this.playMusic('tense');
    else if (wave <= 7) this.playMusic('intense');
    else                this.playMusic('boss');
  }

  // ── Per-frame tick ────────────────────────────────────────────────────────
  /**
   * @param {number} dt   seconds since last frame
   * @param {import('../entities/player.js').Player} player
   */
  tick(dt, player) {
    this._updateListener();
    if (player) this._updateHeartbeat(player.health ?? 100);
    this._tickAmbient(dt);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _randRange(min, max) { return min + Math.random() * (max - min); }

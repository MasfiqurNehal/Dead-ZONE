/**
 * main.js — DEAD ZONE bootstrap
 *
 * System order:
 *   Physics → Engine → Arena → SoundManager → Player → Particles
 *   → Firebase → Progression → Achievements → DailyChallenge → Leaderboard
 *   → HUD → MenuSystem → WeaponManager → WaveManager → Menu
 */

import * as THREE from 'three';
import { Engine }              from './src/core/engine.js';
import { Physics }             from './src/core/physics.js';
import { Player }              from './src/entities/player.js';
import { BulletPool }          from './src/entities/bullet.js';
import { Arena }               from './src/world/arena.js';
import { createMobileControls } from './src/core/mobile-controls.js';
import { WaveManager }         from './src/core/wave-manager.js';
import { WeaponManager }       from './src/core/weapon-manager.js';
import { HUD }                 from './src/ui/hud.js';
import { MenuSystem, lbAdd }   from './src/ui/menu.js';
import { SoundManager }        from './src/core/sound-manager.js';
import { ParticleSystem }      from './src/fx/particle-system.js';
// ─── Performance / reliability ────────────────────────────────────────────────
import { qualityManager }      from './src/core/quality-manager.js';
import { analytics }           from './src/core/analytics.js';
import { DebugOverlay }        from './src/core/debug-overlay.js';
import { proceduralSounds }    from './src/audio/procedural-sounds.js';
import {
  initErrorHandler,
  checkWebGLSupport,
  showWebGLError,
  handleContextLoss,
  warnLowPerformance,
}                              from './src/core/error-handler.js';
// ─── Backend ─────────────────────────────────────────────────────────────────
import { initFirebase, signInAnon, onUserChange, currentUser }
                               from './src/backend/firebase-config.js';
import { Progression }         from './src/backend/progression.js';
import { AchievementManager }  from './src/backend/achievements.js';
import { DailyChallenge }      from './src/backend/challenges.js';
import { Leaderboard }         from './src/backend/leaderboard.js';
import { showShareModal }      from './src/backend/social.js';
import {
  PLAYER as PCFG,
  WORLD,
  WAVES,
  STATE,
  STORAGE,
} from './src/utils/constants.js';
import { storage, formatScore, wait } from './src/utils/helpers.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas     = document.getElementById('game-canvas');
const uiRoot     = document.getElementById('ui-root');
const loadScreen = document.getElementById('loading-screen');
const progFill   = document.getElementById('progress-fill');
const loadStatus = document.getElementById('loading-status');
const loadPct    = document.getElementById('loading-percent');

// ─── Core singletons ──────────────────────────────────────────────────────────
let engine, physics, player, arena, bulletPool, mobileControls;
let hud, menuSystem, waveManager, weaponManager;
let soundManager, particles;

// ─── Backend singletons ───────────────────────────────────────────────────────
let progression, achievements, dailyChallenge, leaderboard;

// ─── Game state ───────────────────────────────────────────────────────────────
let gameState = STATE.LOADING;
let score = 0, kills = 0, wave = 0;
let _waveTimer = 0;
let _offUpdate = null;
let _prevClip  = -1;

// Per-wave / per-run tracking
let _waveKills = 0, _waveHeadshots = 0, _shotsFired = 0, _shotsHit = 0;
let _waveDamage = 0, _wavePistolOnly = false;
let _waveStartTime = 0;
let _runCoinsSpent = 0, _runUpgradesBought = 0;
let _comboCount = 0, _comboTimer = 0;
const COMBO_WINDOW = 4.0; // seconds between kills to maintain combo

// Footstep timer
let _stepTimer = 0;
const STEP_INTERVAL_WALK = 0.52, STEP_INTERVAL_RUN = 0.30;

// Low-HP warning throttle
let _lastLowHpFlash = 0;

// ─── Utilities ────────────────────────────────────────────────────────────────
function setProgress(pct, label = '') {
  progFill.style.width  = `${Math.round(pct)}%`;
  loadPct.textContent   = `${Math.round(pct)}%`;
  if (label) loadStatus.textContent = label;
}

// ─── FPS averaging for dynamic resolution ─────────────────────────────────────
let _fpsAccum = 0, _fpsSamples = 0, _fpsReportTimer = 0;

// ─── Entry point ──────────────────────────────────────────────────────────────
async function init() {
  // Error handler first — catches failures in everything below
  initErrorHandler();

  // WebGL check before even starting the engine
  const webgl = checkWebGLSupport();
  if (!webgl.supported) { showWebGLError(); return; }

  // Init analytics (lazy-loads GA4 on first user interaction)
  analytics.init(qualityManager.tier);

  setProgress(0, 'Loading physics engine…');
  await Physics.load();

  setProgress(5, 'Initialising renderer…');
  engine  = new Engine(canvas, { quality: qualityManager.tier });
  physics = new Physics(WORLD.gravity);

  // Attach quality manager to renderer for dynamic resolution
  qualityManager.attachRenderer(engine.renderer);
  // Handle WebGL context loss gracefully
  handleContextLoss(canvas);
  bulletPool = new BulletPool(engine.scene, undefined, physics);

  setProgress(10, 'Building city block…');
  arena = new Arena({
    scene: engine.scene, physics,
    renderer: engine.renderer, engine,
    camera: engine.camera, quality: engine.quality,
  });
  await arena.build((pct) =>
    setProgress(10 + pct * 0.50, `Building city block… ${Math.round(pct)}%`)
  );
  arena.attach(engine);
  arena.onExplosion = (worldPos, radius) => {
    if (!player?.alive) return;
    const d = engine.camera.position.distanceTo(worldPos);
    if (d < radius) {
      const dmg = Math.round(80 * (1 - d / radius));
      player.takeDamage(dmg);
      soundManager?.onExplosion(worldPos);
      particles?.spawnExplosion(worldPos, radius);
      particles?.screenShake(0.06 * radius, 0.6);
      achievements?.check('exploder_survived', {});
    }
  };

  setProgress(62, 'Loading audio…');
  soundManager = new SoundManager();
  await soundManager.load();

  setProgress(70, 'Spawning survivor…');
  engine.onFixedUpdate((dt) => physics.step(dt));
  player = new Player({
    engine, physics,
    scene:    engine.scene,
    camera:   engine.camera,
    input:    engine.input,
    bulletPool,
    sound:    soundManager,
    ui:       uiRoot,
    isMobile: engine.isMobile,
    onDeath:  onPlayerDeath,
  });
  player.spawn(PCFG.spawn);
  player.attach(engine);
  _wireWeaponEvents();

  setProgress(78, 'Spawning particles…');
  particles = new ParticleSystem(engine.scene, engine.renderer, engine.camera, engine.quality);

  setProgress(82, 'Wiring controls…');
  mobileControls = createMobileControls(engine.input, { container: uiRoot });

  setProgress(84, 'Connecting to backend…');
  // Firebase + progression (non-fatal — fully offline if unconfigured)
  await _initBackend();

  setProgress(93, 'Building HUD…');
  hud        = new HUD(uiRoot, { camera: engine.camera });
  menuSystem = new MenuSystem(uiRoot, {
    engine,
    sound:     soundManager,
    hud,
    onSettings: null,
    // Feed progression info for menus
    getProgression: () => progression?.getState(),
    getChallenges:  () => dailyChallenge?.getToday() ?? [],
    getLeaderboard: (limit) => leaderboard?.getGlobal(limit) ?? Promise.resolve([]),
  });

  weaponManager = new WeaponManager({ player, camera: engine.camera, ui: uiRoot, sound: soundManager });
  weaponManager.attach(engine);

  waveManager = new WaveManager({
    scene: engine.scene, physics, engine,
    quality: engine.quality, sound: soundManager, player, arena,
  });
  waveManager.onKill      = _onKill;
  waveManager.onWaveClear = _onWaveClear;
  waveManager.onZombieSpawn  = (zombie) => _initZombieAudio(zombie);
  waveManager.onZombieDamage = (zombie, pos) => {
    particles?.spawnBlood(pos, undefined, 12, false);
    soundManager?.onImpact('flesh', pos);
    achievements?.check('shot_hit', {});
    dailyChallenge?.progress('shot_hit', null, 1);
  };
  waveManager.attach(engine);

  _offUpdate = engine.onUpdate(_gameUpdate);

  setProgress(100, 'Survive!');
  await wait(500);

  // Debug overlay — backtick to toggle, cheat keys active immediately
  new DebugOverlay({
    getPlayer:      () => player,
    getWaveManager: () => waveManager,
    getEngine:      () => engine,
    getStats:       () => ({ state: gameState, wave, kills, score }),
    onNextWave:     () => { _waveTimer = 0; },
  });

  _enterMenu();
}

// ─── Backend init (non-fatal) ─────────────────────────────────────────────────
async function _initBackend() {
  progression    = new Progression();
  achievements   = new AchievementManager();
  dailyChallenge = new DailyChallenge();
  leaderboard    = new Leaderboard();

  // Try Firebase (gracefully skipped if config not filled in)
  await initFirebase();
  if (!currentUser()) await signInAnon();

  // Load state from localStorage (+ optional cloud sync)
  await Promise.all([
    progression.init(),
    achievements.init(),
    dailyChallenge.init(),
  ]);

  // Wire progression callbacks
  progression.onLevelUp = (level, prestige) => {
    achievements?.check('level_up', { level }, progression);
    if (prestige > 0) achievements?.check('prestige', {}, progression);
    _showNotif(
      prestige > 0 ? `Prestige ${prestige}!` : `Level ${level}!`,
      prestige > 0 ? 'You have ascended. XP reset.' : progression.getNextRewardLabel(),
      prestige > 0 ? '#f5c518' : '#8fd14f'
    );
  };
  progression.onReward = (reward) => {
    if (reward.isLoot) _showNotif(reward.label, reward.tier.toUpperCase() + ' DROP', '#f59e0b');
    if (reward.isDailyLogin) {
      _showNotif(
        `Day ${reward.day} Login Reward`,
        `+${reward.coins} coins${reward.gems ? ` · +${reward.gems} gems` : ''} · ${reward.streak} day streak 🔥`,
        '#f5c518'
      );
    }
  };

  // Wire achievement callbacks
  achievements.onUnlock = (ach, prog) => {
    // Toast is shown inside AchievementManager._unlock()
  };

  // Wire daily challenge callbacks
  dailyChallenge.onComplete = (challenge) => {
    _showNotif('Challenge Complete!', challenge.desc, '#8fd14f');
    const c = dailyChallenge.completedCount();
    achievements?.check('daily_challenge_complete', { allThreeComplete: c >= 3 }, progression);
  };
  dailyChallenge.onAllComplete = (reward) => {
    progression?.addCoins(reward.coins);
    progression?.addGems(reward.gems ?? 0);
    progression?.addXP(reward.xp ?? 0);
    _showNotif('All Challenges Done! 🎉', `+${reward.coins} coins · +${reward.gems} gems · +${reward.xp} XP`, '#a3e635');
  };

  // Daily login reward
  const loginReward = progression.checkDailyLogin();
  if (loginReward) {
    achievements?.check('login', { streak: loginReward.streak }, progression);
  }

  // Auth state changes → re-sync
  onUserChange((user) => {
    if (user) {
      progression._syncFromCloud().catch(() => {});
    }
  });
}

// ─── In-game notification (non-achievement) ───────────────────────────────────
let _notifCSS = false;
function _showNotif(title, body, color = '#8fd14f') {
  if (!_notifCSS) {
    _notifCSS = true;
    const s = document.createElement('style');
    s.textContent = `
      #dz-notif-root{position:fixed;top:80px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:9998;pointer-events:none;}
      .dz-notif{padding:10px 16px;border-radius:7px;background:rgba(8,11,18,0.93);
        border-left:3px solid var(--nc,#8fd14f);backdrop-filter:blur(10px);
        font-family:'Rubik',sans-serif;min-width:220px;max-width:320px;
        animation:dz-ni .3s ease both;}
      .dz-notif.out{animation:dz-no .25s ease both;}
      .dz-notif-title{font-size:.85rem;font-weight:700;color:var(--nc,#8fd14f);}
      .dz-notif-body{font-size:.72rem;color:#8a9090;margin-top:2px;}
      @keyframes dz-ni{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
      @keyframes dz-no{from{opacity:1}to{opacity:0;transform:translateX(20px)}}
    `;
    document.head.appendChild(s);
  }
  let root = document.getElementById('dz-notif-root');
  if (!root) { root = document.createElement('div'); root.id = 'dz-notif-root'; document.body.appendChild(root); }
  const el = document.createElement('div');
  el.className = 'dz-notif';
  el.style.setProperty('--nc', color);
  el.innerHTML = `<div class="dz-notif-title">${title}</div><div class="dz-notif-body">${body}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3500);
}

// ─── Weapon event wiring ──────────────────────────────────────────────────────
function _wireWeaponEvents() {
  if (!player?.onWeaponFire) return;

  player.onWeaponFire = ({ type, muzzlePos, dir }) => {
    if (muzzlePos && dir) {
      soundManager?.onWeaponFire(type, muzzlePos);
      particles?.spawnMuzzleFlash(muzzlePos, dir, type);
    }
    // Procedural fallback audio (always audible, even without sound files)
    if (type === 'shotgun') proceduralSounds.shotgunShot();
    else if (type === 'pistol') proceduralSounds.pistolShot();
    else proceduralSounds.rifleShot();
    _shotsFired++;
    achievements?.check('shot_fired', { weapon: type });
    dailyChallenge?.progress('shot_fired', null, 1);
  };

  player.onWeaponEmpty = ({ type }) => {
    soundManager?.onWeaponEmpty(type);
    proceduralSounds.emptyClick();
  };
  player.onWeaponReload = ({ type, stage }) => {
    soundManager?.onWeaponReload(type, stage);
    if (stage === 'start') proceduralSounds.reload();
  };

  player.onBulletImpact = ({ surface, pos, normal }) => {
    soundManager?.onImpact(surface, pos);
    const v3 = pos ? new THREE.Vector3(pos.x, pos.y, pos.z) : null;
    const n3 = normal ? new THREE.Vector3(normal.x, normal.y, normal.z) : undefined;
    if (surface === 'metal')    particles?.spawnSparks(v3, n3);
    else if (surface === 'flesh') particles?.spawnBlood(v3, n3);
    else                          particles?.spawnDust(v3);
  };

  player.onFlamethrowerStart = () => soundManager?.onFlamethrowerStart();
  player.onFlamethrowerEnd   = () => soundManager?.onFlamethrowerEnd();
  player.onFlamethrowerFrame = (pos, dir) => particles?.spawnFireStream(pos, dir);

  player.onKatanaHit = (pos) => {
    soundManager?.onKatanaHit();
    if (pos) particles?.spawnBlood(new THREE.Vector3(pos.x, pos.y, pos.z), undefined, 8);
  };

  player.onHurt = (amount, fromPos) => {
    soundManager?.onPlayerHurt();
    proceduralSounds.playerHurt();
    hud?.flashDamage();
    _waveDamage += amount;
    achievements?.check('player_hurt', { amount, currentHP: player.health ?? 100 });
    if (fromPos && player) {
      particles?.screenShake(0.02 + Math.min(amount / 200, 0.04), 0.3);
      hud?.showDamageArrow(fromPos, engine.camera.position, player.yaw ?? 0);
    }
  };

  player.onHeal = (amount) => {
    achievements?.check('player_heal', { amount, currentHP: player.health ?? 100 });
  };
}

// ─── Zombie audio bootstrap ───────────────────────────────────────────────────
function _initZombieAudio(zombie) {
  const groanLoop = () => {
    if (!zombie.alive) return;
    const zpos = zombie.position;
    soundManager?.onZombieGroan(zpos);
    if (zpos && player?.alive) {
      const pp = engine.camera.position;
      const dist = Math.hypot(zpos.x - pp.x, zpos.z - pp.z);
      if (dist < 40) proceduralSounds.zombieGroan(dist);
    }
    setTimeout(groanLoop, (4 + Math.random() * 7) * 1000);
  };
  setTimeout(groanLoop, Math.random() * 5000);

  zombie.onAggro  = (pos) => {
    soundManager?.onZombieAggro(pos);
    proceduralSounds.zombieAlert();
  };
  zombie.onAttack = (pos) => soundManager?.onZombieAttack(pos);
  zombie.onDeath  = (pos) => {
    soundManager?.onZombieDeath(pos);
    proceduralSounds.zombieDeath();
    const vpos = new THREE.Vector3(pos.x, pos.y, pos.z);
    particles?.spawnBlood(vpos, undefined, 18);
    particles?.spawnDust(vpos, 4);
    if (zombie.type === 'boss') achievements?.check('boss_kill', {}, progression);
  };
}

// ─── Kill combo tracker ───────────────────────────────────────────────────────
function _updateCombo(dt) {
  if (_comboCount > 0) {
    _comboTimer -= dt;
    if (_comboTimer <= 0) _comboCount = 0;
  }
}

function _onKillCombo() {
  _comboCount++;
  _comboTimer = COMBO_WINDOW;
  achievements?.check('combo_update', { combo: _comboCount }, progression);
  dailyChallenge?.progress('combo', null, _comboCount);
}

// ─── Per-frame game logic ─────────────────────────────────────────────────────
function _gameUpdate(wallDt) {
  const tScale = particles?.timeScale ?? 1.0;
  const dt     = wallDt * tScale;

  if (particles) {
    const sh = particles.cameraShakeOffset;
    engine.camera.position.x += sh.x;
    engine.camera.position.y += sh.y;
  }

  if (gameState === STATE.PLAYING) {
    // Pickup collection
    const loot = arena.checkAndCollectPickup(engine.camera.position, 1.8);
    if (loot) {
      if (loot.type === 'health') player.heal(loot.amount);
      else if (loot.type === 'ammo') player.addAmmo(loot.weapon, loot.rounds);
    }

    bulletPool.update(dt);

    if (_waveTimer > 0) {
      _waveTimer -= dt;
      if (_waveTimer <= 0) _beginWave();
    }

    // Kill combo decay
    _updateCombo(dt);

    // Gunshot fallback detection (if player hooks not wired)
    const curClip = player.weapon?.clip ?? -1;
    if (_prevClip >= 0 && curClip < _prevClip) {
      waveManager?.alertZombies(engine.camera.position, 28);
    }
    _prevClip = curClip;

    // Heartbeat at low health
    if (player.alive && (player.health ?? 100) < 30) {
      proceduralSounds.startHeartbeat();
    } else {
      proceduralSounds.stopHeartbeat();
    }

    // Footstep audio
    if (player.alive) {
      const moving   = player.sprinting || (player.velocity?.lengthSq() ?? 0) > 0.5;
      const interval = player.sprinting ? STEP_INTERVAL_RUN : STEP_INTERVAL_WALK;
      if (moving) {
        _stepTimer -= dt;
        if (_stepTimer <= 0) {
          soundManager?.onFootstep('road');
          proceduralSounds.footstep();
          _stepTimer = interval;
        }
      } else {
        _stepTimer = Math.min(_stepTimer, interval * 0.6);
      }
    }

    // Score-based achievement check (throttled)
    if (score > 0 && score % 5000 < 50) {
      achievements?.check('score_update', { score }, progression);
    }

    if (engine.input.justPressed('pause')) _pause();
  }

  soundManager?.tick(wallDt, player);
  particles?.tick(wallDt);
  progression?.tick(wallDt);

  // Dynamic resolution — feed current FPS to quality manager
  const fps = engine.fps ?? 60;
  qualityManager.tick(wallDt, fps);

  // Report average FPS every 30s for analytics
  _fpsAccum    += fps;
  _fpsSamples  += 1;
  _fpsReportTimer += wallDt;
  if (_fpsReportTimer >= 30) {
    const avg = _fpsAccum / _fpsSamples;
    analytics.trackPerformance(qualityManager.tier, avg);
    warnLowPerformance(avg);
    _fpsAccum = _fpsSamples = _fpsReportTimer = 0;
  }

  const zombiesAlive = waveManager?.activeCount ?? 0;
  if (player?.alive) {
    const pos = engine.camera.position;
    hud.setPlayerPos(pos.x, pos.z, player.yaw ?? 0);
  }
  const zPositions = (waveManager?._zombies ?? []).filter(z => z.alive).map(z => z.position).filter(Boolean);
  hud.setZombies(zPositions);
  hud.tick(player, wave, kills, score, engine.fps, gameState, zombiesAlive);
}

// ─── Game state machine ───────────────────────────────────────────────────────
function _enterMenu() {
  gameState = STATE.MENU;
  loadScreen.style.display = 'none';
  engine.input.setEnabled(false);
  soundManager?.setMusicForMenu();
  soundManager?.startAmbient();
  proceduralSounds.startAmbientDrone();
  menuSystem.showMain(_startGame);
}

function _startGame() {
  score = 0; kills = 0; wave = 0; _waveTimer = 0; _prevClip = -1;
  _waveKills = 0; _waveHeadshots = 0; _shotsFired = 0; _shotsHit = 0;
  _waveDamage = 0; _comboCount = 0; _comboTimer = 0;
  _runCoinsSpent = 0; _runUpgradesBought = 0;
  _waveStartTime = Date.now();
  waveManager?.killAll();
  player.reset(PCFG.spawn);
  menuSystem.hideMain();
  hud.show();
  gameState = STATE.PLAYING;
  engine.start();
  engine.input.setEnabled(true);
  engine.input.lockPointer();
  _waveTimer = WAVES.restBetweenWaves;
  soundManager?.setMusicForWaveClear();
  progression?.trackStat('totalGamesPlayed', 1);
  analytics.trackGameStart();
}

function _beginWave() {
  wave++;
  _waveKills = 0; _waveHeadshots = 0; _shotsFired = 0; _shotsHit = 0;
  _waveDamage = 0;
  _waveStartTime = Date.now();
  hud.announceWave(wave);
  soundManager?.setMusicForWave(wave);
  proceduralSounds.waveStart();
  achievements?.check('wave_start', { wave });
  analytics.trackWaveStart(wave);
  const count    = WAVES.firstWaveCount + (wave - 1) * WAVES.countPerWave + 5;
  const spawnPts = arena.getSpawnPoints(count);
  waveManager.startWave(wave, spawnPts);
}

function _onKill(type, reward, isHeadshot, killPos) {
  if (gameState !== STATE.PLAYING) return;
  kills++;
  _waveKills++;
  _shotsHit++;
  if (isHeadshot) { _waveHeadshots++; _shotsHit++; }
  score += reward ?? WAVES.scorePerKill;

  // Combo
  _onKillCombo();

  proceduralSounds.hitMarker(!!isHeadshot);
  hud.flashHitmarker(!!isHeadshot);
  hud.addKill(`${_zombieDisplayName(type)} eliminated`, !!isHeadshot);
  weaponManager?.notifyKill(type);

  // Progression XP
  const xpGain = isHeadshot ? 35 : 15;
  progression?.addXP(xpGain);
  progression?.trackStat('totalKills', 1);
  if (isHeadshot) progression?.trackStat('totalHeadshots', 1);
  progression?.trackStat('totalScore', reward ?? WAVES.scorePerKill);

  // Update weapon mastery
  const currentWeapon = player.weapon?.type;
  if (currentWeapon) {
    const masteryUp = progression?.updateMastery(currentWeapon, 1, isHeadshot ? 1 : 0);
    if (masteryUp) {
      _showNotif(`${currentWeapon.toUpperCase()} Mastery ${masteryUp.level}!`, 'Weapon expertise increased.', '#f59e0b');
    }
  }

  // Battle pass XP
  progression?.progressBattlePass(10);

  // Achievements
  achievements?.check('kill', {
    type, headshot: isHeadshot, weapon: currentWeapon,
  }, progression);

  // Daily challenges
  dailyChallenge?.progress('kills',        null,          1);
  dailyChallenge?.progress('kills',        type,          1);
  dailyChallenge?.progress('weapon_kills', currentWeapon, 1);
  if (isHeadshot) {
    dailyChallenge?.progress('headshots', null,          1);
    dailyChallenge?.progress('headshots', currentWeapon, 1);
  }

  // Screen FX
  const remaining = waveManager?.activeCount ?? 1;
  if (isHeadshot)       particles?.hitStop(85);
  else if (remaining <= 1) particles?.slowMo(1.5, 0.25);

  // Blood FX
  if (killPos) {
    const pos = new THREE.Vector3(killPos.x, killPos.y, killPos.z);
    particles?.spawnBlood(pos, undefined, isHeadshot ? 24 : 14, !!isHeadshot);
  }
}

async function _onWaveClear() {
  if (gameState !== STATE.PLAYING) return;
  score += WAVES.scorePerWave;
  hud.announceClear(wave);
  soundManager?.setMusicForWaveClear();
  proceduralSounds.waveClear();

  engine.pause();
  engine.input.setEnabled(false);
  engine.input.unlockPointer();

  const waveTime = (Date.now() - _waveStartTime) / 1000;
  const accuracy = _shotsFired > 0 ? Math.round((_shotsHit / _shotsFired) * 100) : 0;

  // Progression
  const waveXP = 150 + wave * 25;
  progression?.addXP(waveXP);
  progression?.addCoins(30 + wave * 5);
  progression?.progressBattlePass(200);
  progression?.trackStat('totalWavesSurvived', 1);

  // Achievements
  achievements?.check('wave_clear', {
    wave,
    healthFull:   (player.health ?? 0) >= 100,
    noDamage:     _waveDamage === 0,
  }, progression);

  // Daily challenges
  dailyChallenge?.progress('waves',    null, wave);
  dailyChallenge?.progress('accuracy', null, accuracy);
  dailyChallenge?.progress('score',    null, score);
  if (_waveDamage === 0) dailyChallenge?.progress('no_damage', null, 1);

  // Score check
  achievements?.check('score_update', { score }, progression);

  // Save periodically
  progression?.save().catch(() => {});

  analytics.trackWaveClear(wave, _waveKills, score, waveTime);

  await menuSystem.showWaveClear({
    wave, kills: _waveKills, headshots: _waveHeadshots,
    accuracy, time: waveTime,
    xpGained:   waveXP,
    coinsGained: 30 + wave * 5,
    bpTier:      progression?.getBattlePass().tier ?? 0,
    nextReward:  progression?.getNextRewardLabel() ?? '',
  });
  if (gameState !== STATE.PLAYING) return;

  await weaponManager.openUpgradeShop?.();
  if (gameState !== STATE.PLAYING) return;

  engine.resume();
  engine.input.setEnabled(true);
  engine.input.lockPointer();
  _waveTimer = WAVES.restBetweenWaves;
}

async function onPlayerDeath() {
  if (gameState === STATE.GAME_OVER) return;
  gameState = STATE.GAME_OVER;
  engine.pause();
  engine.input.setEnabled(false);
  engine.input.unlockPointer();
  soundManager?.stopMusic();

  // Local high score
  const hi = Math.max(score, storage.get(STORAGE.highScore, 0));
  storage.set(STORAGE.highScore, hi);
  lbAdd(score, wave, kills);

  // Cloud leaderboard + final progression
  const accuracy = _shotsFired > 0 ? Math.round((_shotsHit / _shotsFired) * 100) : 0;
  progression?.trackStat('totalScore', score);
  analytics.trackDeath(wave, score, kills);
  const lbResult = await leaderboard?.submit(score, wave, kills).catch(() => null);
  if (lbResult?.rank) {
    achievements?.check('leaderboard_rank', { rank: lbResult.rank }, progression);
  }
  await progression?.save().catch(() => {});

  hud.hide();
  menuSystem.showDeath(score, hi, wave, kills, _startGame, _enterMenu, {
    onShare: () => {
      achievements?.check('share', {}, progression);
      showShareModal(canvas, score, wave, kills, accuracy, () => {
        achievements?.check('share', {}, progression);
      });
    },
    rank:        lbResult?.rank ?? null,
    xp:          progression?.xp ?? 0,
    level:       progression?.level ?? 1,
    nextReward:  progression?.getNextRewardLabel() ?? '',
    streak:      dailyChallenge?.getStreak() ?? 0,
    challenges:  dailyChallenge?.getToday() ?? [],
  });
}

function _pause() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.PAUSED;
  engine.pause();
  engine.input.setEnabled(false);
  engine.input.unlockPointer();
  menuSystem.showPause(_resume, _enterMenu);
}

function _resume() {
  if (gameState !== STATE.PAUSED) return;
  gameState = STATE.PLAYING;
  engine.resume();
  engine.input.setEnabled(true);
  engine.input.lockPointer();
  menuSystem.hidePause();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _zombieDisplayName(type) {
  const names = {
    walker: 'Walker', runner: 'Runner', brute: 'Brute',
    exploder: 'Exploder', spitter: 'Spitter', boss: 'Boss',
  };
  return names[type] ?? 'Zombie';
}

// ─── Kick off ─────────────────────────────────────────────────────────────────
init().catch((err) => {
  console.error('[DEAD ZONE] Fatal init error:', err);
  if (loadStatus) {
    loadStatus.textContent = `Fatal error: ${err.message}`;
    loadStatus.style.color = '#f44';
  }
});

/**
 * Central game configuration. Tweak gameplay, visuals, and balance from here.
 * Keeping all magic numbers in one place makes the rest of the codebase readable.
 */

// --- Quality presets ---------------------------------------------------------
// Selected automatically by device detection, overridable from the menu.
export const QUALITY = {
  low: {
    label: 'Low',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    antialias: false,
    postprocessing: false,
    maxZombies: 16,
    fogDensity: 0.022,
    anisotropy: 1,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    antialias: true,
    postprocessing: true,
    maxZombies: 32,
    fogDensity: 0.016,
    anisotropy: 4,
  },
  high: {
    label: 'High',
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    antialias: true,
    postprocessing: true,
    maxZombies: 60,
    fogDensity: 0.011,
    anisotropy: 8,
  },
};

// --- World -------------------------------------------------------------------
export const WORLD = {
  gravity: -20,
  arenaSize: 100, // square arena, units = meters
  wallHeight: 8,
  groundColor: 0x111214,
  skyColor: 0x080d1a,
  fogColor: 0x080d1a,
};

// --- Player ------------------------------------------------------------------
export const PLAYER = {
  height: 1.7,
  radius: 0.35,
  walkSpeed: 5.0,
  sprintSpeed: 8.5,
  crouchSpeed: 2.4,
  adsSpeedMul: 0.55, // movement scale while aiming down sights
  jumpSpeed: 7.0,
  maxHealth: 100,
  eyeHeight: 1.55,
  crouchEyeHeight: 1.0,
  mouseSensitivity: 0.0022,
  touchSensitivity: 0.004,
  adsSensitivityMul: 0.55, // look slows while aiming for precision
  accel: 60, // ground acceleration (units/s^2)
  airAccel: 12, // reduced control while airborne
  damping: 12, // ground friction (higher = snappier stop)
  spawn: { x: 0, y: 2, z: 0 },

  // Stamina (sprinting)
  maxStamina: 100,
  staminaDrain: 28, // per second while sprinting
  staminaRegen: 18, // per second while not sprinting
  staminaRegenDelay: 0.6, // seconds after sprint before regen kicks in
  sprintMinStamina: 12, // must recover above this before sprinting again
  jumpStaminaCost: 12,

  // Health regeneration
  regenDelay: 5.0, // seconds without damage before regen starts
  regenRate: 12, // HP per second
  lowHealthThreshold: 30, // below this -> low-health pulse vignette

  // Head bob
  bobFrequency: 9.0, // steps cadence scalar
  bobAmount: 0.045, // vertical bob (m)
  bobSway: 0.035, // horizontal sway (m)

  // Footsteps
  stepInterval: 0.46, // seconds between steps at walk speed

  // Camera feel
  fovSprintBoost: 8, // degrees added while sprinting
  fovAdsZoom: 18, // degrees removed while ADS
  fovLerp: 8, // fov easing speed
  pitchLimit: 1.5, // ~86deg, radians
  recoilRecovery: 9, // visual recoil settle speed
  shakeDecay: 7, // screen-shake decay speed
};

// --- Weapons -----------------------------------------------------------------
// Each weapon is a self-contained stats block consumed by Weapon.
export const WEAPONS = {
  pistol: {
    name: 'M9 Pistol',
    damage: 26,
    fireRate: 6, // rounds per second (semi-auto cap)
    automatic: false,
    clipSize: 12,
    reserveAmmo: 96,
    reloadTime: 1.3,
    spread: 0.012,
    range: 80,
    bulletSpeed: 120,
    muzzleVelocity: 120,
    recoil: 0.012,
  },
  rifle: {
    name: 'AR-15',
    damage: 18,
    fireRate: 11,
    automatic: true,
    clipSize: 30,
    reserveAmmo: 180,
    reloadTime: 1.8,
    spread: 0.02,
    range: 120,
    bulletSpeed: 160,
    muzzleVelocity: 160,
    recoil: 0.008,
  },
  shotgun: {
    name: 'Pump Shotgun',
    damage: 12, // per pellet
    pellets: 8,
    fireRate: 1.4,
    automatic: false,
    clipSize: 6,
    reserveAmmo: 48,
    reloadTime: 2.4,
    spread: 0.09,
    range: 35,
    bulletSpeed: 100,
    muzzleVelocity: 100,
    recoil: 0.04,
  },
  smg: {
    name: 'MP5',
    damage: 14,
    fireRate: 18,
    automatic: true,
    clipSize: 30,
    reserveAmmo: 150,
    reloadTime: 1.5,
    spread: 0.028,
    range: 60,
    bulletSpeed: 140,
    muzzleVelocity: 140,
    recoil: 0.006,
  },
  sniper: {
    name: 'AWM Sniper',
    damage: 150,
    fireRate: 1.0,
    automatic: false,
    clipSize: 5,
    reserveAmmo: 25,
    reloadTime: 2.8,
    spread: 0.001,
    range: 300,
    bulletSpeed: 300,
    muzzleVelocity: 300,
    recoil: 0.06,
  },
  crossbow: {
    name: 'Crossbow',
    damage: 80,
    fireRate: 0.8,
    automatic: false,
    clipSize: 1,
    reserveAmmo: 12,
    reloadTime: 2.0,
    spread: 0,
    range: 120,
    bulletSpeed: 45,
    muzzleVelocity: 45,
    recoil: 0.015,
  },
  flamethrower: {
    name: 'Flamethrower',
    damage: 8,
    fireRate: 24,
    automatic: true,
    clipSize: 200,
    reserveAmmo: 200,
    reloadTime: 3.0,
    spread: 0.18,
    range: 12,
    bulletSpeed: 0,
    muzzleVelocity: 0,
    recoil: 0.001,
  },
  katana: {
    name: 'Katana',
    damage: 120,
    fireRate: 2.0,
    automatic: false,
    clipSize: 999,
    reserveAmmo: 999,
    reloadTime: 0.1,
    spread: 0,
    range: 2.5,
    bulletSpeed: 0,
    muzzleVelocity: 0,
    recoil: 0.005,
  },
};

export const DEFAULT_WEAPON = 'rifle';

// --- Zombies -----------------------------------------------------------------
export const ZOMBIE = {
  radius: 0.4,
  height: 1.8,
  baseHealth: 60,
  baseSpeed: 2.2,
  baseDamage: 12,
  attackRange: 1.6,
  attackCooldown: 1.0, // seconds between bites
  detectRange: 80,
  // Per-wave scaling
  healthPerWave: 12,
  speedPerWave: 0.12,
  color: 0x4a5a32,
};

// --- Waves -------------------------------------------------------------------
export const WAVES = {
  firstWaveCount: 6,
  countPerWave: 3, // additional zombies each wave
  spawnInterval: 0.9, // seconds between spawns within a wave
  restBetweenWaves: 6, // seconds of breathing room
  scorePerKill: 100,
  scorePerWave: 500,
};

// --- Bullets -----------------------------------------------------------------
export const BULLET = {
  poolSize: 120,
  radius: 0.04,
  lifetime: 1.5, // seconds before despawn
  trailColor: 0xffe08a,
};

// --- Rendering / camera ------------------------------------------------------
export const CAMERA = {
  fov: 75,
  near: 0.1,
  far: 300,
};

// --- Physics collision groups (Rapier interaction bitmasks) ------------------
// Group is upper 16 bits (membership), filter is lower 16 bits (collides-with).
export const GROUPS = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  ZOMBIE: 0x0004,
  BULLET: 0x0008,
};

// --- Local-storage keys ------------------------------------------------------
export const STORAGE = {
  highScore: 'deadzone.highscore',
  quality: 'deadzone.quality',
  settings: 'deadzone.settings',
};

// --- Game states -------------------------------------------------------------
export const STATE = {
  LOADING: 'loading',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameover',
};

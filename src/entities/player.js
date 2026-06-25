import * as THREE from 'three';
import { PLAYER, CAMERA, GROUPS, WORLD, WEAPONS } from '../utils/constants.js';
import { makeGroups } from '../core/physics.js';
import { Weapon } from './weapon.js';
import { clamp, damp } from '../utils/helpers.js';

const WORLD_GRAVITY = WORLD.gravity;
const WEAPON_EXISTS = (key) => Object.prototype.hasOwnProperty.call(WEAPONS, key);

/** Move `current` toward `target` by at most `maxDelta`. */
function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

// The player's capsule only resolves against the static world for movement so
// that brushing a zombie never wedges the camera; zombie contact damage is
// handled by the zombie AI separately.
const MOVE_FILTER = makeGroups(GROUPS.PLAYER, GROUPS.WORLD);

const DEFAULT_LOADOUT = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'crossbow', 'flamethrower', 'katana'];

// Scratch objects (module-scoped to avoid per-frame allocation / GC churn).
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _bob = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _flashDir = new THREE.Vector3();

/**
 * First-person player: a kinematic capsule driven by the Rapier character
 * controller, with smooth mouse/touch look, acceleration-based WASD movement,
 * sprint/crouch/jump, stamina, regenerating health, head-bob, footsteps, and a
 * stack of camera-feel effects (sprint FOV, ADS zoom, recoil kick, screen
 * shake, damage flash + low-health pulse vignette).
 *
 * Wiring (from the game bootstrap, e.g. main.js):
 *   const player = new Player({ engine, physics, scene, camera, input, bulletPool, sound, ui });
 *   player.spawn(PLAYER.spawn);
 *   player.attach(engine);              // registers fixed + frame updates
 *   // The game is responsible for stepping physics each fixed tick, e.g.:
 *   //   engine.onFixedUpdate((dt) => physics.step(dt));
 *   // Register physics.step BEFORE player.attach so collisions are resolved
 *   // in the same tick they are computed.
 */
export class Player {
  constructor(ctx) {
    this.engine = ctx.engine;
    this.physics = ctx.physics;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.input = ctx.input;
    this.bulletPool = ctx.bulletPool;
    this.sound = ctx.sound || null;
    this.ui = ctx.ui || document.getElementById('ui-root') || document.body;
    this.onDeath = ctx.onDeath || null;
    this.isMobile = ctx.isMobile ?? this.engine?.isMobile ?? false;

    // --- Orientation ---
    this.yaw = 0; // around Y (left/right)
    this.pitch = 0; // around X (up/down)

    // --- Locomotion state ---
    this.velocity = new THREE.Vector3(); // world-space, m/s
    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.aiming = false;
    this._eyeHeight = PLAYER.eyeHeight;

    // --- Vitals ---
    this.health = PLAYER.maxHealth;
    this.stamina = PLAYER.maxStamina;
    this.alive = true;
    this._timeSinceDamage = PLAYER.regenDelay;
    this._timeSinceSprint = PLAYER.staminaRegenDelay;
    this._staminaLocked = false; // true after fully draining, until recovered

    // --- Feel / effects ---
    this._bobPhase = 0;
    this._stepTimer = 0;
    this._fov = CAMERA.fov;
    this._recoilPitch = 0; // transient visual kick, decays to 0
    this._recoilYaw = 0;
    this._shake = 0; // screen-shake energy
    this._damageFlash = 0; // red vignette intensity 0..1
    this._effectTime = 0;

    // --- Weapons ---
    this.weapons = [];
    this.weaponIndex = 0;
    this._buildWeapons(ctx.loadout || DEFAULT_LOADOUT);

    // --- Physics body (created on spawn) ---
    this.body = null;
    this.collider = null;

    this._buildVignette();
    this._buildFlashlight();

    this._fixedUpdate = this.fixedUpdate.bind(this);
    this._update = this.update.bind(this);
    this._detach = null;
  }

  // --- Setup -----------------------------------------------------------------

  _buildWeapons(loadout) {
    const ctx = {
      physics:    this.physics,
      bulletPool: this.bulletPool,
      sound:      this.sound,
      camera:     this.camera,  // for 3D model attachment
      scene:      this.scene,   // for shell ejection + flame particles
    };
    this.weapons = loadout
      .filter((key) => !!WEAPON_EXISTS(key))
      .map((key) => new Weapon(key, ctx));
    // Only the first weapon is visible initially
    if (this.weapons.length > 0) this.weapons[0].equip?.();
  }

  _buildVignette() {
    // Red damage / low-health vignette overlay (additive to whatever the HUD
    // shows). Uses the same look as the CSS .fx-vignette helper.
    let el = this.ui.querySelector?.('.fx-vignette.player-fx');
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-vignette player-fx';
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      el.style.boxShadow = 'inset 0 0 160px 48px rgba(192, 32, 42, 0.92)';
      el.style.transition = 'none';
      el.style.zIndex = '5';
      this.ui.appendChild?.(el);
    }
    this._vignette = el;
  }

  _buildFlashlight() {
    this._flashlight = new THREE.SpotLight(0xfff4e0, 4.5, 38, Math.PI / 4.5, 0.45, 1.3);
    this._flashlight.castShadow = false;
    this._flashlightTarget = new THREE.Object3D();
    this._flashlight.target = this._flashlightTarget;
    this.scene.add(this._flashlight);
    this.scene.add(this._flashlightTarget);
    this._flashlightOn = true;
  }

  /** Create the capsule rigid body at `pos` and snap the camera to it. */
  spawn(pos = PLAYER.spawn) {
    if (this.body) this.physics.removeBody(this.body);

    const radius = PLAYER.radius;
    // Capsule half-height excludes the two hemispherical caps.
    const halfHeight = Math.max(0.1, (PLAYER.height - 2 * radius) / 2);
    // Spawn so the capsule's centre sits half its total height above the floor.
    const centerY = pos.y + halfHeight + radius;

    this.body = this.physics.createCapsule(
      { x: pos.x, y: centerY, z: pos.z },
      radius,
      halfHeight,
      GROUPS.PLAYER,
      GROUPS.WORLD | GROUPS.ZOMBIE,
      true // kinematic position-based
    );
    this.physics.register(this.body, this);
    this.collider = this.body.collider(0);

    this._capsuleHalf = halfHeight + radius; // half total height (centre -> cap)
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this._syncCamera(0, true);
    return this;
  }

  /** Register update callbacks on the engine. Returns a detach function. */
  attach(engine = this.engine) {
    const offFixed = engine.onFixedUpdate(this._fixedUpdate);
    const offFrame = engine.onUpdate(this._update);
    this._detach = () => {
      offFixed();
      offFrame();
      this._detach = null;
    };
    return this._detach;
  }

  detach() {
    this._detach?.();
  }

  // --- Fixed-step simulation (movement + physics) ----------------------------

  fixedUpdate(dt) {
    if (!this.body || !this.alive) return;

    const input = this.input;
    const axis = input.getMoveAxis(); // x = strafe, y = forward
    const moving = axis.x !== 0 || axis.y !== 0;

    // Sprint is gated by stamina and only meaningful moving forward.
    const wantsSprint =
      input.isDown('sprint') && moving && axis.y > 0.1 && !this.crouching && !this.aiming;
    this.sprinting = wantsSprint && !this._staminaLocked && this.stamina > 0;

    this.crouching = input.isDown('crouch');

    // Target horizontal speed.
    let targetSpeed = PLAYER.walkSpeed;
    if (this.crouching) targetSpeed = PLAYER.crouchSpeed;
    else if (this.sprinting) targetSpeed = PLAYER.sprintSpeed;
    if (this.aiming && !this.sprinting) targetSpeed *= PLAYER.adsSpeedMul;

    // Build a world-space wish direction from yaw.
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish
      .copy(_forward)
      .multiplyScalar(axis.y)
      .addScaledVector(_right, axis.x);
    if (_wish.lengthSq() > 0) _wish.normalize();

    // Accelerate / decelerate horizontal velocity toward the target.
    const targetVx = _wish.x * targetSpeed;
    const targetVz = _wish.z * targetSpeed;
    const accel = this.grounded ? PLAYER.accel : PLAYER.airAccel;

    if (moving) {
      this.velocity.x = approach(this.velocity.x, targetVx, accel * dt);
      this.velocity.z = approach(this.velocity.z, targetVz, accel * dt);
    } else if (this.grounded) {
      // Exponential friction for a snappy, drift-free stop.
      const f = Math.exp(-PLAYER.damping * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
      if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;
    }

    // Gravity + jump (vertical handled separately from the controller slide).
    this.velocity.y += WORLD_GRAVITY * dt;

    if (
      input.justPressed('jump') &&
      this.grounded &&
      !this.crouching &&
      this.stamina >= PLAYER.jumpStaminaCost
    ) {
      this.velocity.y = PLAYER.jumpSpeed;
      this.stamina -= PLAYER.jumpStaminaCost;
      this._timeSinceSprint = 0;
      this.grounded = false;
      this.sound?.play?.('jump');
    }

    // Resolve the move against world geometry via the character controller.
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    const res = this.physics.moveCharacter(this.body, this.collider, desired, MOVE_FILTER);
    this.grounded = res.grounded;

    // Kill velocity along blocked axes so we don't "stick" to walls.
    if (Math.abs(res.movement.x) < Math.abs(desired.x) - 1e-4) this.velocity.x = 0;
    if (Math.abs(res.movement.z) < Math.abs(desired.z) - 1e-4) this.velocity.z = 0;

    if (this.grounded) {
      if (this.velocity.y < 0) this.velocity.y = -2; // small stick-to-ground bias
    } else if (Math.abs(res.movement.y) < Math.abs(desired.y) - 1e-4 && this.velocity.y > 0) {
      this.velocity.y = 0; // bonked head on a ceiling
    }

    this._updateStamina(dt);
    this._updateHealth(dt);
    this._updateFootsteps(dt, axis);

    for (const w of this.weapons) w.update(dt);
  }

  _updateStamina(dt) {
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      this._timeSinceSprint = 0;
      if (this.stamina <= 0) this._staminaLocked = true;
    } else {
      this._timeSinceSprint += dt;
      if (this._timeSinceSprint >= PLAYER.staminaRegenDelay) {
        this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
      }
      if (this._staminaLocked && this.stamina >= PLAYER.sprintMinStamina) {
        this._staminaLocked = false;
      }
    }
  }

  _updateHealth(dt) {
    this._timeSinceDamage += dt;
    if (
      this.health > 0 &&
      this.health < PLAYER.maxHealth &&
      this._timeSinceDamage >= PLAYER.regenDelay
    ) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }
  }

  _updateFootsteps(dt, axis) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded || speed < 0.6 || (axis.x === 0 && axis.y === 0)) {
      this._stepTimer = 0;
      return;
    }
    // Faster cadence when sprinting, slower when crouched.
    const cadence = PLAYER.stepInterval * (PLAYER.walkSpeed / Math.max(speed, 0.1));
    this._stepTimer -= dt;
    if (this._stepTimer <= 0) {
      this._stepTimer = clamp(cadence, 0.22, 0.7);
      this._playFootstep();
    }
  }

  _playFootstep() {
    const surface = this._surfaceUnderFoot();
    const vol = this.crouching ? 0.4 : this.sprinting ? 1.0 : 0.7;
    // Prefer a surface-specific cue, fall back to a generic step.
    if (this.sound?.has?.(`step_${surface}`)) this.sound.play(`step_${surface}`, { volume: vol });
    else this.sound?.play?.('step', { volume: vol, rate: this.sprinting ? 1.15 : 1 });
  }

  /** Raycast down to identify the surface material for footstep audio. */
  _surfaceUnderFoot() {
    if (!this.body) return 'concrete';
    const t = this.body.translation();
    const origin = { x: t.x, y: t.y - this._capsuleHalf + 0.05, z: t.z };
    const hit = this.physics.raycast(origin, _down, 1.2, this.collider, MOVE_FILTER);
    return hit?.entity?.surface || hit?.collider?.userData?.surface || 'concrete';
  }

  // --- Per-frame update (look, camera, combat, effects) ----------------------

  update(dt) {
    if (!this.body) return;
    this._effectTime += dt;

    if (this.alive) {
      this._applyLook();
      this._handleWeapons(dt);
    }

    this._syncCamera(dt, false);
    this._updateEffects(dt);
    this._updateFlashlight();
  }

  _updateFlashlight() {
    if (!this._flashlight) return;
    const cam = this.camera;
    this._flashlight.position.copy(cam.position);
    _flashDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this._flashlightTarget.position.copy(cam.position).addScaledVector(_flashDir, 8);
    this._flashlightTarget.updateMatrixWorld();
    this._flashlight.visible = this._flashlightOn && this.alive;
  }

  _applyLook() {
    const look = this.input.consumeLook();
    let sens = this.input.touchLook ? PLAYER.touchSensitivity : PLAYER.mouseSensitivity;
    if (this.aiming) sens *= PLAYER.adsSensitivityMul;

    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens;
    this.pitch = clamp(this.pitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);

    // Keep yaw bounded for numerical stability over long sessions.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  _handleWeapons(dt) {
    const input = this.input;
    this.aiming = input.isDown('aim');

    // Weapon switching — keys 1-8 + scroll wheel
    for (let i = 0; i < 8; i++) {
      if (input.justPressed(`weapon${i + 1}`)) this.switchWeapon(i);
    }
    const wheel = input.consumeWheel?.();
    if (wheel > 0) this.switchWeapon((this.weaponIndex + 1) % this.weapons.length);
    else if (wheel < 0) this.switchWeapon((this.weaponIndex - 1 + this.weapons.length) % this.weapons.length);

    if (input.justPressed('reload')) this.weapon?.reload();
    if (input.justPressed('flashlight')) this._flashlightOn = !this._flashlightOn;

    // Fire: automatic weapons fire while held, others on the press edge.
    const wantFire = this.weapon?.stats.automatic ? input.isDown('fire') : input.justPressed('fire');
    if (wantFire) this._tryFire();

    // Recoil kick from whatever the weapon reported last frame.
    const recoil = this.weapon?.consumeRecoil?.() || 0;
    if (recoil > 0) {
      this._recoilPitch += recoil;
      this._recoilYaw += (Math.random() - 0.5) * recoil * 0.5;
      this._shake = Math.min(1, this._shake + recoil * 6);
    }
  }

  _tryFire() {
    const w = this.weapon;
    if (!w) return;

    // Aim analytically from yaw/pitch so the shot tracks the reticle exactly,
    // unaffected by head-bob/shake or a stale camera world-matrix this frame.
    _euler.set(this.pitch + this._recoilPitch, this.yaw + this._recoilYaw, 0, 'YXZ');
    _q.setFromEuler(_euler);
    _rayDir.set(0, 0, -1).applyQuaternion(_q).normalize();

    const t = this.body.translation();
    _eye.set(t.x, t.y - this._capsuleHalf + this._eyeHeight, t.z);
    // Muzzle a little forward/down so tracers don't spawn inside the camera.
    _muzzle.copy(_eye).addScaledVector(_rayDir, 0.6);
    _muzzle.y -= 0.12;

    const fired = w.fire(_eye, _rayDir, _muzzle);
    if (fired) {
      this.onWeaponFire?.({
        type: w.key,
        muzzlePos: { x: _muzzle.x, y: _muzzle.y, z: _muzzle.z },
        dir:       { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z },
      });
    }
  }

  switchWeapon(index) {
    if (index < 0 || index >= this.weapons.length) return;
    if (index === this.weaponIndex) return;
    this.weapon?.unequip?.();   // hide outgoing 3D model
    this.weaponIndex = index;
    this.weapon?.equip?.();     // show incoming 3D model
    this.aiming = false;
    this.sound?.play?.('weapon_switch');
  }

  get weapon() {
    return this.weapons[this.weaponIndex] || null;
  }

  // --- Camera placement + effects --------------------------------------------

  _syncCamera(dt, snap) {
    const t = this.body.translation();

    // Smoothly transition eye height for crouch.
    const targetEye = this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this._eyeHeight = snap ? targetEye : damp(this._eyeHeight, targetEye, 12, dt);

    // Eye = capsule centre - halfHeight + eyeHeight.
    _eye.set(t.x, t.y - this._capsuleHalf + this._eyeHeight, t.z);

    // Head bob, scaled by horizontal speed and grounding, damped while ADS.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const speedN = clamp(speed / PLAYER.walkSpeed, 0, 1.4);
    if (this.grounded && speedN > 0.05) {
      this._bobPhase += dt * PLAYER.bobFrequency * (this.sprinting ? 1.35 : 1) * speedN;
    } else {
      // Ease the bob phase back to neutral when standing still.
      this._bobPhase = damp(this._bobPhase, Math.round(this._bobPhase / Math.PI) * Math.PI, 8, dt);
    }
    const bobScale = speedN * (this.aiming ? 0.25 : 1);
    const bobY = Math.sin(this._bobPhase * 2) * PLAYER.bobAmount * bobScale;
    const bobX = Math.cos(this._bobPhase) * PLAYER.bobSway * bobScale;

    // Apply bob in head-local space (rotate the sideways component by yaw).
    _bob.set(Math.cos(this.yaw) * bobX, bobY, -Math.sin(this.yaw) * bobX);

    // Screen shake: small random positional jitter that decays.
    const shake = this._shake;
    const sx = (Math.random() - 0.5) * shake * 0.06;
    const sy = (Math.random() - 0.5) * shake * 0.06;

    this.camera.position.set(_eye.x + _bob.x + sx, _eye.y + _bob.y + sy, _eye.z + _bob.z);

    // Orientation: yaw + pitch + transient recoil kick + shake roll.
    const roll = (Math.random() - 0.5) * shake * 0.03;
    _euler.set(
      this.pitch + this._recoilPitch,
      this.yaw + this._recoilYaw,
      roll,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(_euler);
  }

  _updateEffects(dt) {
    // FOV: base, +sprint boost, -ADS zoom.
    let targetFov = CAMERA.fov;
    if (this.sprinting) targetFov += PLAYER.fovSprintBoost;
    if (this.aiming) targetFov -= PLAYER.fovAdsZoom;
    this._fov = damp(this._fov, targetFov, PLAYER.fovLerp, dt);
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }

    // Recoil settles back to neutral.
    this._recoilPitch = damp(this._recoilPitch, 0, PLAYER.recoilRecovery, dt);
    this._recoilYaw = damp(this._recoilYaw, 0, PLAYER.recoilRecovery, dt);

    // Screen shake decays.
    this._shake = Math.max(0, this._shake - PLAYER.shakeDecay * dt * this._shake - 0.001);
    if (this._shake < 0.0005) this._shake = 0;

    // Damage flash decays; low health adds a steady red pulse.
    this._damageFlash = Math.max(0, this._damageFlash - dt * 2.2);
    let vig = this._damageFlash;
    if (this.alive && this.health > 0 && this.health < PLAYER.lowHealthThreshold) {
      const severity = 1 - this.health / PLAYER.lowHealthThreshold;
      const pulse = (Math.sin(this._effectTime * 5.5) * 0.5 + 0.5) * 0.4 * severity + 0.12 * severity;
      vig = Math.max(vig, pulse);
    }
    if (!this.alive) vig = Math.max(vig, 0.55);
    this._vignette.style.opacity = clamp(vig, 0, 0.95).toFixed(3);
  }

  // --- Vitals API ------------------------------------------------------------

  /** Apply damage; resets regen timer and triggers the red flash. */
  takeDamage(amount) {
    if (!this.alive || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this._timeSinceDamage = 0;
    this._damageFlash = clamp(0.45 + amount / 100, 0.4, 0.95);
    this._shake = Math.min(1, this._shake + clamp(amount / 60, 0.1, 0.6));
    this.sound?.play?.('hurt');
    this.onHurt?.(amount, null);
    if (this.health <= 0) this._die();
  }

  heal(amount) {
    if (!this.alive) return;
    this.health = Math.min(PLAYER.maxHealth, this.health + amount);
    this.onHeal?.(amount);
  }

  addAmmo(weaponKey, rounds) {
    const w = this.weapons.find((x) => x.key === weaponKey) || this.weapon;
    if (w) w.reserve += rounds;
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.velocity.set(0, 0, 0);
    this.input.setEnabled?.(false);
    this.sound?.play?.('death');
    this.onDeath?.();
  }

  /** Reset for a new run. */
  reset(pos = PLAYER.spawn) {
    this.health = PLAYER.maxHealth;
    this.stamina = PLAYER.maxStamina;
    this.alive = true;
    this._staminaLocked = false;
    this._timeSinceDamage = PLAYER.regenDelay;
    this._recoilPitch = this._recoilYaw = this._shake = this._damageFlash = 0;
    this.pitch = 0;
    for (const w of this.weapons) w.refill();
    this.weaponIndex = 0;
    this.input.setEnabled?.(true);
    this.spawn(pos);
  }

  get position() {
    return this.body?.translation();
  }

  dispose() {
    this.detach();
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    this._vignette?.remove?.();
  }
}

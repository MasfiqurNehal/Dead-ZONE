/**
 * Touch controls for phones/tablets. Builds a floating joystick, a right-side
 * look/swipe region, and a cluster of action buttons, then feeds everything
 * into the shared Input so gameplay code is identical to desktop.
 *
 * Usage:
 *   const mobile = new MobileControls(engine.input, { mount: uiRoot });
 *   if (engine.isMobile) mobile.show();   // auto-detected by the caller
 *
 * Design goals: low-latency multi-touch (Pointer Events), no accidental page
 * gestures, and a CoD-Mobile-style look — semi-transparent, frosted, glowing.
 */
import { isTouchDevice } from '../utils/helpers.js';

const JOY_RADIUS = 56; // px travel of the thumb from centre
const STYLE_ID = 'deadzone-mobile-style';

export class MobileControls {
  /**
   * @param {import('./input.js').Input} input
   * @param {{ mount?: HTMLElement, weapons?: number }} [opts]
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.mount = opts.mount || document.getElementById('ui-root') || document.body;
    this.weaponCount = opts.weapons ?? 3;
    this.visible = false;

    // Per-pointer ownership so multiple fingers don't fight each other.
    this._joyId = null;
    this._lookId = null;
    this._joyCenter = { x: 0, y: 0 };
    this._aimToggled = false;

    this._injectStyle();
    this._build();
    this._bindOrientation();
  }

  // --- DOM construction ------------------------------------------------------

  _build() {
    const root = document.createElement('div');
    root.className = 'dz-mobile';
    root.setAttribute('aria-hidden', 'true');
    this.root = root;

    // --- Left: floating joystick ---
    const joy = el('div', 'dz-joy');
    const joyBase = el('div', 'dz-joy-base');
    const joyThumb = el('div', 'dz-joy-thumb');
    joy.append(joyBase, joyThumb);
    this._joy = joy;
    this._joyBase = joyBase;
    this._joyThumb = joyThumb;
    this._bindJoystick(joy);

    // --- Right: look/swipe region (sits beneath the buttons) ---
    const look = el('div', 'dz-look');
    this._look = look;
    this._bindLook(look);

    // --- Action buttons ---
    const fire = this._button('fire', 'dz-btn dz-fire', svgFire(), 'press', true);
    const aim = this._button('aim', 'dz-btn dz-aim', svgAim(), 'toggle');
    const jump = this._button('jump', 'dz-btn dz-jump', svgJump(), 'press');
    const reload = this._button('reload', 'dz-btn dz-reload', svgReload(), 'press');
    const crouch = this._button('crouch', 'dz-btn dz-crouch', svgCrouch(), 'hold');

    // --- Weapon switch row ---
    const weapons = el('div', 'dz-weapons');
    for (let i = 0; i < this.weaponCount; i++) {
      const wb = this._button(`weapon${i + 1}`, 'dz-btn dz-weapon', String(i + 1), 'press');
      weapons.appendChild(wb);
    }
    this._weapons = weapons;

    // Look region first so buttons receive touches on top of it.
    root.append(look, joy, weapons, crouch, reload, jump, aim, fire);
    this.mount.appendChild(root);

    // Portrait nag overlay (forces a landscape-only experience).
    const rotate = el('div', 'dz-rotate');
    rotate.innerHTML = `<div class="dz-rotate-inner">${svgRotate()}<p>Rotate your device</p><span>DEAD ZONE plays in landscape</span></div>`;
    this._rotate = rotate;
    this.mount.appendChild(rotate);
  }

  /**
   * @param {string} action  input action name
   * @param {string} cls     css classes
   * @param {string} label   inner HTML (icon / text)
   * @param {'press'|'hold'|'toggle'} mode  how the button maps to the action
   * @param {boolean} [repeatable] keep firing while held (fire button)
   */
  _button(action, cls, label, mode = 'press', repeatable = false) {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = label;
    b.tabIndex = -1;

    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('active');
      if (mode === 'toggle') {
        if (action === 'aim') {
          this._aimToggled = !this._aimToggled;
          this.input.setVirtualButton('aim', this._aimToggled);
          b.classList.toggle('latched', this._aimToggled);
        } else {
          this.input.setVirtualButton(action, true);
        }
      } else {
        this.input.setVirtualButton(action, true);
      }
    };

    const release = (e) => {
      e?.preventDefault?.();
      b.classList.remove('active');
      if (mode === 'toggle') return; // state persists until next tap
      this.input.setVirtualButton(action, false);
    };

    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', (e) => {
      if (mode === 'hold' || repeatable) release(e); // safety for slide-off
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  // --- Joystick --------------------------------------------------------------

  _bindJoystick(zone) {
    const start = (e) => {
      if (this._joyId !== null) return;
      e.preventDefault();
      this._joyId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      // Floating origin: base re-centres under the finger for comfort.
      this._joyCenter.x = e.clientX;
      this._joyCenter.y = e.clientY;
      this._joyBase.style.left = `${e.clientX}px`;
      this._joyBase.style.top = `${e.clientY}px`;
      this._joyBase.classList.add('visible');
      this._moveJoy(e.clientX, e.clientY);
    };
    const move = (e) => {
      if (e.pointerId !== this._joyId) return;
      e.preventDefault();
      this._moveJoy(e.clientX, e.clientY);
    };
    const end = (e) => {
      if (e.pointerId !== this._joyId) return;
      this._joyId = null;
      this._joyBase.classList.remove('visible');
      this._joyThumb.style.transform = 'translate(-50%, -50%)';
      this.input.setVirtualMove(0, 0);
    };
    zone.addEventListener('pointerdown', start);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _moveJoy(cx, cy) {
    let dx = cx - this._joyCenter.x;
    let dy = cy - this._joyCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    this._joyThumb.style.left = `${this._joyCenter.x}px`;
    this._joyThumb.style.top = `${this._joyCenter.y}px`;
    this._joyThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Screen-down is +dy, but forward is up, so invert Y for the move axis.
    this.input.setVirtualMove(dx / JOY_RADIUS, -dy / JOY_RADIUS);
  }

  // --- Look / swipe ----------------------------------------------------------

  _bindLook(zone) {
    let lastX = 0;
    let lastY = 0;
    const start = (e) => {
      if (this._lookId !== null) return;
      this._lookId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const move = (e) => {
      if (e.pointerId !== this._lookId) return;
      e.preventDefault();
      this.input.addVirtualLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const end = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
    };
    zone.addEventListener('pointerdown', start);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // --- Orientation -----------------------------------------------------------

  _bindOrientation() {
    this._onResize = () => this._checkOrientation();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._checkOrientation();
  }

  /** Best-effort landscape lock (needs fullscreen on most browsers). */
  async lockLandscape() {
    try {
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* not supported / needs a user gesture + fullscreen — fall back to nag */
    }
  }

  _checkOrientation() {
    if (!this.visible) return;
    const portrait = window.innerHeight > window.innerWidth;
    this._rotate.classList.toggle('show', portrait);
  }

  // --- Visibility ------------------------------------------------------------

  show() {
    this.visible = true;
    this.input.touchLook = true;
    this.root.classList.add('active');
    this.lockLandscape();
    this._checkOrientation();
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('active');
    this._rotate.classList.remove('show');
    this.input.setVirtualMove(0, 0);
  }

  setVisible(v) {
    v ? this.show() : this.hide();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.root?.remove();
    this._rotate?.remove();
  }

  // --- Styles ----------------------------------------------------------------

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
}

/** Convenience factory: only mounts controls on touch-capable devices. */
export function createMobileControls(input, opts = {}) {
  if (!isTouchDevice()) return null;
  return new MobileControls(input, opts);
}

// --- Small DOM/icon helpers --------------------------------------------------

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const svgWrap = (inner) =>
  `<svg viewBox="0 0 24 24" width="46%" height="46%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const svgFire = () =>
  svgWrap('<circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/>');
const svgAim = () =>
  svgWrap('<circle cx="12" cy="12" r="7"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/>');
const svgJump = () => svgWrap('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>');
const svgReload = () =>
  svgWrap('<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v5h-5"/>');
const svgCrouch = () =>
  svgWrap('<path d="M5 19h14"/><path d="M12 19v-6"/><path d="M8 9l4-4 4 4"/>');
const svgRotate = () =>
  `<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 3a4 4 0 014 4M3 11a4 4 0 004 4"/></svg>`;

// --- Stylesheet --------------------------------------------------------------

const CSS = `
.dz-mobile {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 20;
  -webkit-user-select: none;
  user-select: none;
  touch-action: none;
}
.dz-mobile.active { display: block; }
.dz-mobile * { touch-action: none; }

/* Look region: right ~62% of the screen, sits under the buttons */
.dz-look {
  position: absolute;
  top: 0; right: 0;
  width: 62%; height: 100%;
  z-index: 1;
}

/* Floating joystick zone: left ~45% lower area */
.dz-joy {
  position: absolute;
  left: 0; bottom: 0;
  width: 45%; height: 70%;
  z-index: 2;
}
.dz-joy-base {
  position: absolute;
  width: 132px; height: 132px;
  margin: -66px 0 0 -66px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
  border: 1.5px solid rgba(143, 209, 79, 0.35);
  box-shadow: 0 0 24px rgba(143, 209, 79, 0.18), inset 0 0 20px rgba(0,0,0,0.4);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}
.dz-joy-base.visible { opacity: 1; }
.dz-joy-thumb {
  position: absolute;
  width: 64px; height: 64px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 40% 35%, rgba(255,255,255,0.32), rgba(143,209,79,0.22));
  border: 1.5px solid rgba(255,255,255,0.5);
  box-shadow: 0 0 18px rgba(143, 209, 79, 0.5), inset 0 2px 6px rgba(255,255,255,0.25);
  pointer-events: none;
  left: -999px;
}

/* Generic glassy, glowing action button */
.dz-btn {
  position: absolute;
  z-index: 3;
  display: grid;
  place-items: center;
  color: #fff;
  font-family: inherit;
  font-weight: 800;
  font-size: 1rem;
  border-radius: 50%;
  background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02));
  border: 1.5px solid rgba(255,255,255,0.22);
  box-shadow: 0 4px 18px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.18);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.08s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
  cursor: pointer;
}
.dz-btn svg { opacity: 0.92; }
.dz-btn.active { transform: scale(0.9); }

/* Fire — big, bottom-right, blood-red glow */
.dz-fire {
  right: calc(env(safe-area-inset-right) + 26px);
  bottom: calc(env(safe-area-inset-bottom) + 30px);
  width: 96px; height: 96px;
  background: radial-gradient(circle at 50% 40%, rgba(255,59,59,0.32), rgba(192,32,42,0.18));
  border-color: rgba(255,59,59,0.6);
  box-shadow: 0 0 26px rgba(255,59,59,0.45), inset 0 0 18px rgba(255,59,59,0.18);
  color: #ffd9d9;
}
.dz-fire.active {
  background: radial-gradient(circle at 50% 40%, rgba(255,90,90,0.6), rgba(192,32,42,0.4));
  box-shadow: 0 0 36px rgba(255,59,59,0.8);
}

/* Aim — above fire, left of it */
.dz-aim {
  right: calc(env(safe-area-inset-right) + 140px);
  bottom: calc(env(safe-area-inset-bottom) + 56px);
  width: 70px; height: 70px;
}
.dz-aim.latched {
  background: radial-gradient(circle at 50% 40%, rgba(143,209,79,0.4), rgba(92,138,50,0.25));
  border-color: rgba(143,209,79,0.8);
  box-shadow: 0 0 26px rgba(143,209,79,0.6);
}

/* Jump — above fire */
.dz-jump {
  right: calc(env(safe-area-inset-right) + 36px);
  bottom: calc(env(safe-area-inset-bottom) + 142px);
  width: 72px; height: 72px;
}

/* Reload — left of jump */
.dz-reload {
  right: calc(env(safe-area-inset-right) + 138px);
  bottom: calc(env(safe-area-inset-bottom) + 150px);
  width: 64px; height: 64px;
}

/* Crouch — lower-left above the joystick area */
.dz-crouch {
  left: calc(env(safe-area-inset-left) + 28px);
  bottom: calc(env(safe-area-inset-bottom) + 30px);
  width: 64px; height: 64px;
  z-index: 4;
}
.dz-crouch.active {
  background: radial-gradient(circle at 50% 40%, rgba(143,209,79,0.35), rgba(92,138,50,0.2));
  border-color: rgba(143,209,79,0.7);
}

/* Weapon switch row — top-right */
.dz-weapons {
  position: absolute;
  z-index: 4;
  top: calc(env(safe-area-inset-top) + 14px);
  right: calc(env(safe-area-inset-right) + 16px);
  display: flex;
  gap: 10px;
}
.dz-weapon {
  position: relative;
  width: 46px; height: 46px;
  font-size: 1.05rem;
  border-radius: 12px;
  color: var(--text, #e8e6e3);
}
.dz-weapon.active {
  background: linear-gradient(160deg, rgba(143,209,79,0.35), rgba(92,138,50,0.18));
  border-color: rgba(143,209,79,0.7);
  box-shadow: 0 0 18px rgba(143,209,79,0.5);
}

/* Rotate-device overlay (portrait) */
.dz-rotate {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
  place-items: center;
  text-align: center;
  background: linear-gradient(160deg, #0d0d0f 0%, #050505 100%);
  color: var(--text, #e8e6e3);
  padding: 2rem;
}
.dz-rotate.show { display: grid; }
.dz-rotate-inner { display: flex; flex-direction: column; align-items: center; gap: 0.8rem; }
.dz-rotate-inner svg { color: var(--toxic, #8fd14f); animation: dz-rot 2.4s ease-in-out infinite; }
.dz-rotate-inner p { font-size: 1.3rem; font-weight: 800; letter-spacing: 0.08em; }
.dz-rotate-inner span { font-size: 0.8rem; color: var(--text-dim, #9a9690); letter-spacing: 0.16em; text-transform: uppercase; }
@keyframes dz-rot {
  0%, 100% { transform: rotate(-12deg); }
  50% { transform: rotate(78deg); }
}

/* Hide all touch UI on fine-pointer (desktop) devices as a safety net */
@media (hover: hover) and (pointer: fine) {
  .dz-mobile { display: none !important; }
}
`;

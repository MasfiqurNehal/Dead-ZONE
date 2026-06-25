/**
 * Unified input. Keyboard + mouse (desktop) and the virtual joystick/buttons
 * (mobile, via MobileControls) all funnel into the same action state so gameplay
 * code never has to care where the input came from.
 *
 * Actions (the vocabulary the rest of the game queries):
 *   forward back left right   movement
 *   sprint crouch jump        locomotion modifiers
 *   fire aim reload           combat
 *   weapon1..weapon4          weapon select
 *   pause scoreboard          meta / UI
 */

const KEYMAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',

  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',

  KeyR: 'reload',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Digit3: 'weapon3',
  Digit4: 'weapon4',
  Digit5: 'weapon5',
  Digit6: 'weapon6',
  Digit7: 'weapon7',
  Digit8: 'weapon8',

  Tab: 'scoreboard',
  Escape: 'pause',
  KeyP: 'pause',
  KeyF: 'flashlight',
};

// Actions whose default browser behaviour we must suppress while playing.
const PREVENT_DEFAULT = new Set(['jump', 'scoreboard', 'pause']);

export class Input {
  /** @param {HTMLElement} domElement element that captures pointer-lock/mouse */
  constructor(domElement) {
    this.dom = domElement;

    this.down = new Set(); // actions currently held
    this.pressed = new Set(); // actions that went down this frame (rising edge)
    this.released = new Set(); // actions that came up this frame (falling edge)

    this.look  = { x: 0, y: 0 }; // accumulated look delta (px), consumed per frame
    this.move  = { x: 0, y: 0 }; // virtual joystick axis (mobile): x=strafe, y=forward
    this.wheel = 0;               // accumulated scroll; consumed via consumeWheel()

    this.pointerLocked = false;
    this.enabled = true;

    // When true (mobile), look deltas arrive from touch and should not require
    // pointer lock. The Player reads this to pick mouse vs touch sensitivity.
    this.touchLook = false;

    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const action = KEYMAP[e.code];
      if (!action) return;
      if (PREVENT_DEFAULT.has(action)) e.preventDefault();
      if (e.repeat) return; // ignore OS auto-repeat for edge detection
      if (!this.down.has(action)) this.pressed.add(action);
      this.down.add(action);
    };

    this._onKeyUp = (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      if (this.down.delete(action)) this.released.add(action);
    };

    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this._press('fire');
      else if (e.button === 2) this._press('aim');
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) this._release('fire');
      else if (e.button === 2) this._release('aim');
    };

    this._onMouseMove = (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.look.x += e.movementX || 0;
      this.look.y += e.movementY || 0;
    };

    // Block the context menu so right-click can be used to aim.
    this._onContextMenu = (e) => e.preventDefault();

    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      // Releasing the pointer (Esc / focus loss) must not leave keys stuck down.
      if (!this.pointerLocked) {
        this.down.delete('fire');
        this.down.delete('aim');
      }
    };

    this._onWheel = (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      e.preventDefault();
      this.wheel += e.deltaY > 0 ? 1 : -1;
    };

    // Window-level blur: drop everything so we never get a stuck key.
    this._onBlur = () => this._clearHeld();

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    window.addEventListener('blur', this._onBlur);
  }

  _press(action) {
    if (!this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
  }

  _release(action) {
    if (this.down.delete(action)) this.released.add(action);
  }

  // --- Pointer lock ----------------------------------------------------------

  lockPointer() {
    this.dom.requestPointerLock?.();
  }

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // --- Virtual (mobile) input hooks ------------------------------------------

  /** Joystick axis. x = strafe (+right), y = forward (+forward). */
  setVirtualMove(x, y) {
    this.move.x = x;
    this.move.y = y;
  }

  /** Touch look drag; deltas are in CSS pixels, same units as mouse movement. */
  addVirtualLook(dx, dy) {
    this.touchLook = true;
    this.look.x += dx;
    this.look.y += dy;
  }

  setVirtualButton(action, isDown) {
    if (isDown) this._press(action);
    else this._release(action);
  }

  // --- Queries ---------------------------------------------------------------

  isDown(action) {
    return this.down.has(action);
  }

  justPressed(action) {
    return this.pressed.has(action);
  }

  justReleased(action) {
    return this.released.has(action);
  }

  /** Combined movement axis from keys + virtual joystick. x=strafe, y=forward. */
  getMoveAxis() {
    let x = this.move.x;
    let y = this.move.y;
    if (this.down.has('right')) x += 1;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('forward')) y += 1;
    if (this.down.has('back')) y -= 1;

    // Normalize so diagonal movement isn't faster than cardinal.
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Returns the accumulated look delta and resets it. */
  consumeLook() {
    const x = this.look.x;
    const y = this.look.y;
    this.look.x = 0;
    this.look.y = 0;
    return { x, y };
  }

  /** Returns accumulated scroll delta (positive = down) and resets it. */
  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Called by the engine at the end of each frame to clear edge state. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  _clearHeld() {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.look.x = this.look.y = 0;
    this.move.x = this.move.y = 0;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this._clearHeld();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('mousemove', this._onMouseMove);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    window.removeEventListener('blur', this._onBlur);
  }
}

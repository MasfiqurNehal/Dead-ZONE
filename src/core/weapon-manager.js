/**
 * weapon-manager.js — Weapon meta-layer for DEAD ZONE
 *
 * Sits above the Player/Weapon classes to add:
 *   • Damage numbers (floating DOM elements projected to screen-space)
 *   • Hit marker colours (red vs gold headshot)
 *   • Per-weapon crosshair shapes
 *   • Sniper scope overlay (CSS radial gradient)
 *   • Between-wave upgrade shop (DOM overlay, returns a Promise)
 *   • Ammo drops from zombie kills (probabilistic)
 *
 * Wiring in main.js:
 *   weaponManager = new WeaponManager({ player, camera: engine.camera, ui: uiRoot });
 *   weaponManager.attach(engine);
 *   // On wave clear:
 *   await weaponManager.openUpgradeShop();
 *   // On zombie kill:
 *   weaponManager.notifyKill(zombieType);
 */

// ─── CSS injection ────────────────────────────────────────────────────────────
function _injectCSS() {
  if (document.getElementById('wm-style')) return;
  const s = document.createElement('style');
  s.id = 'wm-style';
  s.textContent = `
    /* ── Damage numbers ── */
    .wm-dmg {
      position: fixed;
      pointer-events: none;
      font-family: 'Courier New', monospace;
      font-weight: 900;
      text-shadow: 0 0 6px rgba(0,0,0,0.9);
      z-index: 30;
      transform: translateX(-50%);
      animation: wm-float 0.9s ease-out forwards;
      white-space: nowrap;
    }
    .wm-dmg.headshot {
      color: #ffd700;
      font-size: 20px;
      text-shadow: 0 0 10px rgba(255,200,0,0.8), 0 0 4px #000;
    }
    .wm-dmg.hit     { color: #ffffff; font-size: 14px; }
    .wm-dmg.fire    { color: #ff7722; font-size: 13px; }
    @keyframes wm-float {
      0%   { opacity: 1; transform: translateX(-50%) translateY(0);    }
      100% { opacity: 0; transform: translateX(-50%) translateY(-52px); }
    }

    /* ── Hit marker ── */
    .wm-hitmark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 22px; height: 22px;
      pointer-events: none; z-index: 30;
      opacity: 0;
    }
    .wm-hitmark::before, .wm-hitmark::after {
      content: '';
      position: absolute;
    }
    .wm-hitmark::before { width: 22px; height: 2px; top: 50%; left: 0; transform: translateY(-50%); }
    .wm-hitmark::after  { width: 2px; height: 22px; top: 0; left: 50%; transform: translateX(-50%); }
    .wm-hitmark.red::before,  .wm-hitmark.red::after  { background: #f44; }
    .wm-hitmark.gold::before, .wm-hitmark.gold::after { background: #ffd700; }

    /* ── Headshot banner ── */
    .wm-hs-banner {
      position: fixed; top: 38%; left: 50%;
      transform: translateX(-50%);
      font-family: 'Courier New', monospace;
      font-size: 13px; font-weight: 900;
      letter-spacing: 5px; text-transform: uppercase;
      color: #ffd700;
      text-shadow: 0 0 16px rgba(255,180,0,0.8);
      pointer-events: none; z-index: 30;
      opacity: 0;
      animation: wm-hs-fade 0.9s ease-out forwards;
    }
    @keyframes wm-hs-fade {
      0%   { opacity: 1; transform: translateX(-50%) scale(1.0); }
      30%  { opacity: 1; transform: translateX(-50%) scale(1.05); }
      100% { opacity: 0; transform: translateX(-50%) scale(0.95); }
    }

    /* ── Crosshairs ── */
    .wm-crosshair {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none; z-index: 25;
    }
    /* dot */
    .wm-ch-dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.9); }
    /* cross (default) */
    .wm-ch-cross::before, .wm-ch-cross::after { content: ''; position: absolute; background: rgba(255,255,255,0.75); }
    .wm-ch-cross::before { width: 16px; height: 1.5px; top: 50%; left: 50%; transform: translate(-50%,-50%); }
    .wm-ch-cross::after  { width: 1.5px; height: 16px; top: 50%; left: 50%; transform: translate(-50%,-50%); }
    /* wide (shotgun spread indicator) */
    .wm-ch-wide { width: 22px; height: 22px; border: 1.5px solid rgba(255,255,255,0.55); border-radius: 50%; }
    /* X (katana) */
    .wm-ch-x { width: 18px; height: 18px; }
    .wm-ch-x::before, .wm-ch-x::after { content: ''; position: absolute; width: 18px; height: 1.5px; background: rgba(255,255,255,0.75); top: 50%; left: 50%; }
    .wm-ch-x::before { transform: translate(-50%,-50%) rotate(45deg); }
    .wm-ch-x::after  { transform: translate(-50%,-50%) rotate(-45deg); }
    /* flame (flamethrower — large orange blob) */
    .wm-ch-flame { width: 28px; height: 28px; border: 1.5px solid rgba(255,100,0,0.55); border-radius: 50%; }

    /* ── Scope overlay ── */
    .wm-scope {
      position: fixed; inset: 0;
      pointer-events: none; z-index: 20;
      display: none;
      background: radial-gradient(circle 130px at 50% 50%,
        transparent 0, transparent 130px,
        rgba(0,0,0,0.97) 131px);
    }
    .wm-scope.active { display: block; }
    .wm-scope-h {
      position: absolute; top: 50%; left: 0; right: 0;
      height: 1px; background: rgba(180,255,180,0.5);
    }
    .wm-scope-v {
      position: absolute; left: 50%; top: 0; bottom: 0;
      width: 1px; background: rgba(180,255,180,0.5);
    }
    .wm-scope-c {
      position: absolute; top: 50%; left: 50%;
      width: 8px; height: 8px;
      transform: translate(-50%,-50%);
      border-radius: 50%;
      border: 1px solid rgba(180,255,180,0.7);
    }

    /* ── Upgrade shop ── */
    .wm-shop {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.88);
      backdrop-filter: blur(8px);
      z-index: 40;
      pointer-events: all;
      display: none;
    }
    .wm-shop.visible { display: flex; }
    .wm-shop-title {
      font-family: 'Courier New', monospace;
      font-size: 11px; letter-spacing: 6px;
      color: #6a8a7a; text-transform: uppercase;
      margin-bottom: 4px;
    }
    .wm-shop-weapon {
      font-family: 'Courier New', monospace;
      font-size: 26px; font-weight: 900;
      letter-spacing: 4px; color: #eee;
      margin-bottom: 6px;
    }
    .wm-shop-level {
      font-family: 'Courier New', monospace;
      font-size: 11px; letter-spacing: 3px; color: #cf6;
      margin-bottom: 32px;
    }
    .wm-shop-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      max-width: 480px; width: 90%;
    }
    .wm-shop-btn {
      padding: 18px 20px;
      font-family: 'Courier New', monospace;
      font-size: 13px; text-transform: uppercase;
      letter-spacing: 2px; color: #cdd;
      background: rgba(20,30,25,0.8);
      border: 1px solid rgba(100,180,130,0.4);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      text-align: center; line-height: 1.6;
    }
    .wm-shop-btn:hover {
      background: rgba(40,80,55,0.5);
      border-color: rgba(100,220,150,0.8);
      color: #fff;
    }
    .wm-shop-btn.maxed {
      opacity: 0.4; cursor: default;
      border-color: rgba(100,100,100,0.3);
    }
    .wm-shop-btn.maxed:hover { background: rgba(20,30,25,0.8); border-color: rgba(100,100,100,0.3); color: #cdd; }
    .wm-shop-btn-label { font-size: 13px; margin-bottom: 4px; }
    .wm-shop-btn-desc  { font-size: 10px; letter-spacing: 1px; color: #6a8a7a; }
    .wm-shop-btn-lvl   { font-size: 10px; color: #cf6; margin-top: 4px; }
    .wm-shop-skip {
      margin-top: 28px;
      font-family: 'Courier New', monospace;
      font-size: 11px; letter-spacing: 3px;
      color: #446; cursor: pointer;
      background: none; border: none;
      transition: color 0.15s;
    }
    .wm-shop-skip:hover { color: #889; }

    /* ── Ammo pickup banner ── */
    .wm-ammo-pickup {
      position: fixed; top: 30%; left: 50%;
      transform: translateX(-50%);
      font-family: 'Courier New', monospace;
      font-size: 11px; letter-spacing: 4px;
      color: #8fc; pointer-events: none; z-index: 30;
      animation: wm-hs-fade 1.4s ease-out forwards;
    }
  `;
  document.head.appendChild(s);
}

// ─── Crosshair config per weapon ─────────────────────────────────────────────
const CROSSHAIR_CLASS = {
  pistol:       'wm-ch-cross',
  smg:          'wm-ch-cross',
  shotgun:      'wm-ch-wide',
  rifle:        'wm-ch-cross',
  sniper:       'wm-ch-dot',
  crossbow:     'wm-ch-cross',
  flamethrower: 'wm-ch-flame',
  katana:       'wm-ch-x',
};

// ─── Upgrade shop config ──────────────────────────────────────────────────────
const UPGRADES = [
  { stat: 'damage',      label: 'DAMAGE',       desc: '+15% per level', icon: '⚡' },
  { stat: 'fireRate',    label: 'FIRE RATE',     desc: '+10% per level', icon: '🔥' },
  { stat: 'reloadSpeed', label: 'RELOAD SPEED',  desc: '-15% time/level', icon: '⟳' },
  { stat: 'magSize',     label: 'MAGAZINE',      desc: '+20% capacity',  icon: '▥' },
];

// Ammo drop chance per zombie type (probability 0–1)
const AMMO_DROP_CHANCE = {
  walker: 0.12,
  runner: 0.14,
  brute:  0.22,
  exploder: 0.08,
  spitter: 0.16,
  boss:   0.60,
};

// ─── WeaponManager ────────────────────────────────────────────────────────────
export class WeaponManager {
  /**
   * @param {{ player, camera, ui?: HTMLElement, sound? }} ctx
   */
  constructor({ player, camera, ui, sound = null }) {
    this.player = player;
    this.camera = camera;
    this.ui     = ui ?? document.body;
    this.sound  = sound;

    this._offUpdate = null;
    this._hitTimer  = 0;
    this._scopeActive = false;

    _injectCSS();
    this._buildDOM();
    this._wireWeaponCallbacks();
  }

  // ── DOM construction ──────────────────────────────────────────────────────
  _buildDOM() {
    // Hit marker
    this._hitMark = document.createElement('div');
    this._hitMark.className = 'wm-hitmark red';
    this.ui.appendChild(this._hitMark);

    // Crosshair (the HUD's built-in crosshair can stay; we add a dynamic one)
    this._crosshair = document.createElement('div');
    this._crosshair.className = 'wm-crosshair wm-ch-cross';
    this.ui.appendChild(this._crosshair);

    // Sniper scope
    this._scope = document.createElement('div');
    this._scope.className = 'wm-scope';
    this._scope.innerHTML = '<div class="wm-scope-h"></div><div class="wm-scope-v"></div><div class="wm-scope-c"></div>';
    this.ui.appendChild(this._scope);

    // Upgrade shop
    this._shop = document.createElement('div');
    this._shop.className = 'wm-shop';
    this.ui.appendChild(this._shop);
  }

  // ── Wire onHit callbacks on all player weapons ────────────────────────────
  _wireWeaponCallbacks() {
    for (const w of this.player.weapons) {
      w.onHit = (dmg, headshot, worldPt) => this._onHit(dmg, headshot, worldPt, w.extra?.flame);
    }
  }

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  attach(engine) {
    this._offUpdate = engine.onUpdate(this._update.bind(this));
    return () => this.detach();
  }

  detach() {
    this._offUpdate?.();
    this._offUpdate = null;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────
  _update(dt) {
    // Hit marker decay
    if (this._hitTimer > 0) {
      this._hitTimer -= dt;
      if (this._hitTimer <= 0) this._hitMark.style.opacity = '0';
    }

    const w = this.player.weapon;

    // Scope overlay (sniper ADS)
    const wantScope = !!(w?.extra?.hasScope && this.player.aiming);
    if (wantScope !== this._scopeActive) {
      this._scopeActive = wantScope;
      this._scope.classList.toggle('active', wantScope);
      // While scoped, hide the crosshair
      this._crosshair.style.display = wantScope ? 'none' : '';
    }

    // ADS blend → weapon model
    if (w) w.setADS(this.player.aiming ? 1 : 0);

    // Crosshair class
    const chClass = (w ? CROSSHAIR_CLASS[w.key] : null) ?? 'wm-ch-cross';
    if (!this._crosshair.classList.contains(chClass)) {
      this._crosshair.className = `wm-crosshair ${chClass}`;
    }
  }

  // ── Hit callback ──────────────────────────────────────────────────────────
  _onHit(dmg, headshot, worldPt, isFire = false) {
    this._flashHitMark(headshot);
    if (headshot) this._showHSBanner();
    this._spawnDmgNum(dmg, headshot, isFire, worldPt);

    // XP for kill tracking (called per hit; kills are detected by wave-manager)
    this.player.weapon?.addKillXP?.(headshot);
  }

  _flashHitMark(headshot) {
    this._hitMark.className = `wm-hitmark ${headshot ? 'gold' : 'red'}`;
    this._hitMark.style.opacity = '1';
    this._hitTimer = headshot ? 0.25 : 0.15;
  }

  _showHSBanner() {
    // Remove any in-flight banner
    this.ui.querySelectorAll('.wm-hs-banner').forEach(e => e.remove());
    const el = document.createElement('div');
    el.className = 'wm-hs-banner';
    el.textContent = '⦿ HEADSHOT';
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  _spawnDmgNum(dmg, headshot, isFire, worldPt) {
    if (!worldPt || !this.camera) return;
    const clip = worldPt.clone().project(this.camera);
    if (clip.z > 1) return; // behind camera

    const x = (clip.x *  0.5 + 0.5) * window.innerWidth  + (Math.random() - 0.5) * 32;
    const y = (-clip.y * 0.5 + 0.5) * window.innerHeight - 20;

    const el = document.createElement('div');
    el.className = `wm-dmg ${headshot ? 'headshot' : isFire ? 'fire' : 'hit'}`;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.textContent = dmg;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  // ── Ammo drops (call on every zombie kill) ────────────────────────────────
  notifyKill(zombieType) {
    const chance = AMMO_DROP_CHANCE[zombieType] ?? 0.10;
    if (Math.random() > chance) return;

    const w = this.player.weapon;
    if (!w) return;
    // Give 1–2 clips worth of reserve ammo for the current weapon
    const rounds = Math.ceil(w.stats.clipSize * (1 + Math.random()));
    w.reserve = Math.min(w.reserve + rounds, w.stats.reserveAmmo * 2);

    // Visual feedback
    const el = document.createElement('div');
    el.className = 'wm-ammo-pickup';
    el.textContent = `+ ${rounds} ${w.name.toUpperCase()} AMMO`;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 1450);
  }

  // ── Upgrade shop ───────────────────────────────────────────────────────────
  /**
   * Opens the upgrade shop for the player's current weapon.
   * Returns a Promise that resolves when the player picks an upgrade (or skips).
   */
  openUpgradeShop() {
    return new Promise((resolve) => {
      const w = this.player.weapon;
      if (!w) { resolve(); return; }

      this._shop.innerHTML = '';
      this._shop.className = 'wm-shop visible';

      // Title
      const title = document.createElement('div');
      title.className = 'wm-shop-title';
      title.textContent = 'Wave Clear — Upgrade';
      this._shop.appendChild(title);

      const wpnName = document.createElement('div');
      wpnName.className = 'wm-shop-weapon';
      wpnName.textContent = w.name;
      this._shop.appendChild(wpnName);

      const lvlEl = document.createElement('div');
      lvlEl.className = 'wm-shop-level';
      const pips = Array.from({ length: 5 }, (_, i) => i < w.level ? '●' : '○').join(' ');
      lvlEl.textContent = `LVL ${w.level} / 5  ${pips}`;
      this._shop.appendChild(lvlEl);

      const grid = document.createElement('div');
      grid.className = 'wm-shop-grid';

      const close = (chosen) => {
        this._shop.className = 'wm-shop';
        resolve(chosen);
      };

      for (const upg of UPGRADES) {
        const cur  = w.upgrades[upg.stat];
        const maxd = cur >= 5;

        const btn = document.createElement('button');
        btn.className = maxd ? 'wm-shop-btn maxed' : 'wm-shop-btn';
        btn.innerHTML = `
          <div class="wm-shop-btn-label">${upg.icon} ${upg.label}</div>
          <div class="wm-shop-btn-desc">${upg.desc}</div>
          <div class="wm-shop-btn-lvl">${'▮'.repeat(cur)}${'▯'.repeat(5 - cur)}</div>
        `;
        if (!maxd) {
          btn.addEventListener('click', () => {
            w.applyUpgrade(upg.stat);
            close(upg.stat);
          });
        }
        grid.appendChild(btn);
      }
      this._shop.appendChild(grid);

      const skip = document.createElement('button');
      skip.className = 'wm-shop-skip';
      skip.textContent = 'SKIP UPGRADE (press S)';
      skip.addEventListener('click', () => close(null));
      this._shop.appendChild(skip);

      // Keyboard shortcut: S to skip
      const onKey = (e) => {
        if (e.code === 'KeyS') { document.removeEventListener('keydown', onKey); close(null); }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  dispose() {
    this.detach();
    this._hitMark?.remove();
    this._crosshair?.remove();
    this._scope?.remove();
    this._shop?.remove();
  }
}

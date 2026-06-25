/**
 * src/ui/menu.js — All overlay / menu screens for DEAD ZONE
 *
 * Screens managed:
 *   main      — animated main menu (zombie silhouettes, fog, blood-drip logo)
 *   pause     — blurred-game pause overlay
 *   death     — YOU DIED screen with stats + leaderboard
 *   waveClear — between-waves stats + perk selection + countdown
 *   settings  — graphics / audio / controls / HUD / misc
 *   howToPlay — controls & tips
 *   credits   — credits roll
 *   leaderboard — local top-10
 */

// Lazy-load gsap from npm (Vite bundles it; gracefully no-ops if absent).
let gsap = null;
import('gsap').then(m => { gsap = m.gsap ?? m.default ?? null; }).catch(() => {});

// ─── Perk catalogue ──────────────────────────────────────────────────────────
const PERKS = [
  { id: 'speed',   icon: '⚡', name: 'Adrenaline',     desc: '+20% movement speed this wave' },
  { id: 'health',  icon: '❤️', name: 'Iron Will',       desc: 'Restore 30 HP immediately' },
  { id: 'ammo',    icon: '📦', name: 'Ammo Cache',      desc: 'Fully refill all weapon ammo' },
  { id: 'double',  icon: '✖️', name: 'Double Score',    desc: '2× score for next wave kills' },
  { id: 'vampiric',icon: '🩸', name: 'Vampiric Rounds', desc: 'Each kill restores 5 HP' },
  { id: 'grenade', icon: '💣', name: 'Fragger',         desc: 'Gain 3 frag grenades' },
  { id: 'shield',  icon: '🛡️', name: 'Guardian',        desc: 'Gain 50 armor points' },
  { id: 'reload',  icon: '🔄', name: 'Quick Hands',     desc: '-40% reload time this wave' },
];

// ─── Wave-clear countdown (seconds) ──────────────────────────────────────────
const WAVE_CLEAR_COUNTDOWN = 15;

// ─── Leaderboard helpers ──────────────────────────────────────────────────────
function lbGet()   { try { return JSON.parse(localStorage.getItem('dz-lb') || '[]'); } catch { return []; } }
function lbSave(e) { localStorage.setItem('dz-lb', JSON.stringify(e)); }

export function lbAdd(score, wave, kills) {
  const lb = lbGet();
  lb.push({ score, wave, kills, date: new Date().toLocaleDateString() });
  lb.sort((a, b) => b.score - a.score);
  lb.splice(10);
  lbSave(lb);
  return lb.findIndex(e => e.score === score && e.wave === wave) + 1;
}

// ─── MenuSystem ───────────────────────────────────────────────────────────────
export class MenuSystem {
  /**
   * @param {HTMLElement} root  #ui-root
   * @param {{ engine?, sound?, hud?, onSettings? }} opts
   */
  constructor(root, { engine = null, sound = null, hud = null, onSettings = null } = {}) {
    this.root       = root;
    this.engine     = engine;
    this.sound      = sound;
    this.hud        = hud;
    this._onSettings = onSettings;

    this._panels  = {};   // id → HTMLElement
    this._el      = {};   // cached elements
    this._wcTimer = null; // wave-clear interval handle

    // Settings defaults (read from localStorage)
    this._settings = {
      quality:     localStorage.getItem('dz-quality')     ?? 'high',
      masterVol:   Number(localStorage.getItem('dz-mvol') ?? 80),
      sfxVol:      Number(localStorage.getItem('dz-sfx')  ?? 80),
      musicVol:    Number(localStorage.getItem('dz-music') ?? 50),
      mouseSens:   Number(localStorage.getItem('dz-msens') ?? 50),
      touchSens:   Number(localStorage.getItem('dz-tsens') ?? 50),
      fov:         Number(localStorage.getItem('dz-fov')   ?? 75),
      gore:        localStorage.getItem('dz-gore')  !== 'false',
      colorblind:  localStorage.getItem('dz-cb')    ?? 'none',
      minimap:     localStorage.getItem('dz-ui-mm') !== 'false',
      killfeed:    localStorage.getItem('dz-ui-kf') !== 'false',
      compass:     localStorage.getItem('dz-ui-cp') !== 'false',
    };

    this._injectCSS();
    this._buildAll();
    this._applySettings(false); // apply stored quality/FOV without announcing
  }

  // ── CSS ─────────────────────────────────────────────────────────────────────
  _injectCSS() {
    if (document.getElementById('dz-menu-css')) return;
    const s = document.createElement('style');
    s.id = 'dz-menu-css';
    s.textContent = MENU_CSS;
    document.head.appendChild(s);
  }

  // ── Build all panels ────────────────────────────────────────────────────────
  _buildAll() {
    this._buildMainMenu();
    this._buildPause();
    this._buildDeath();
    this._buildWaveClear();
    this._buildSettings();
    this._buildHowToPlay();
    this._buildCredits();
    this._buildLeaderboard();
  }

  // ── MAIN MENU ───────────────────────────────────────────────────────────────
  _buildMainMenu() {
    const p = mk('div', 'dzm-panel dzm-main');
    p.setAttribute('aria-label', 'Main menu');

    // ── Animated background layers
    const bg = mk('div', 'dzm-bg');

    // Fog layers
    for (let i = 0; i < 3; i++) {
      const fog = mk('div', `dzm-fog dzm-fog-${i}`);
      bg.appendChild(fog);
    }

    // Zombie silhouettes (7 walkers at varying speeds/positions)
    const zombieSVG = (flip) => `
      <svg viewBox="0 0 52 110" fill="currentColor" xmlns="http://www.w3.org/2000/svg"
           style="transform:scaleX(${flip ? -1 : 1})">
        <ellipse cx="26" cy="14" rx="11" ry="13"/>
        <rect x="20" y="26" width="12" height="5" rx="2"/>
        <rect x="14" y="31" width="24" height="28" rx="3"/>
        <rect x="2" y="28" width="14" height="8" rx="4" transform="rotate(-25 2 28)"/>
        <rect x="36" y="42" width="14" height="7" rx="3.5" transform="rotate(12 36 42)"/>
        <rect x="14" y="58" width="10" height="30" rx="3"/>
        <rect x="28" y="58" width="10" height="30" rx="3"/>
        <rect x="-2" y="20" width="5" height="14" rx="2" transform="rotate(-35 -2 20)"/>
        <rect x="4" y="18" width="5" height="13" rx="2" transform="rotate(-22 4 18)"/>
      </svg>`;

    const zombiePositions = [
      { delay: '0s',   dur: '14s', bottom: '8%',  scale: 0.55, flip: false },
      { delay: '3s',   dur: '18s', bottom: '5%',  scale: 0.75, flip: true  },
      { delay: '6s',   dur: '11s', bottom: '10%', scale: 0.45, flip: false },
      { delay: '9s',   dur: '20s', bottom: '6%',  scale: 0.65, flip: true  },
      { delay: '1.5s', dur: '16s', bottom: '12%', scale: 0.38, flip: false },
      { delay: '12s',  dur: '13s', bottom: '4%',  scale: 0.80, flip: true  },
      { delay: '4s',   dur: '22s', bottom: '9%',  scale: 0.50, flip: false },
    ];

    for (const z of zombiePositions) {
      const el = mk('div', 'dzm-zombie');
      el.innerHTML = zombieSVG(z.flip);
      Object.assign(el.style, {
        animationDelay: z.delay,
        animationDuration: z.dur,
        bottom: z.bottom,
        transform: `scale(${z.scale})`,
        transformOrigin: 'bottom center',
      });
      bg.appendChild(el);
    }

    // Particle dots (floating embers)
    for (let i = 0; i < 18; i++) {
      const dot = mk('div', 'dzm-particle');
      dot.style.cssText = `
        left:${Math.random()*100}%;
        top:${Math.random()*100}%;
        animation-delay:${(Math.random()*6).toFixed(1)}s;
        animation-duration:${(4 + Math.random()*6).toFixed(1)}s;
        width:${(1.5 + Math.random()*2).toFixed(1)}px;
        height:${(1.5 + Math.random()*2).toFixed(1)}px;
        opacity:${(0.2 + Math.random()*0.4).toFixed(2)};
      `;
      bg.appendChild(dot);
    }

    p.appendChild(bg);

    // ── Logo
    const logo = mk('div', 'dzm-logo');
    logo.innerHTML = `
      <div class="dzm-logo-text">
        <span class="dzm-dead">DEAD</span><span class="dzm-zone">ZONE</span>
      </div>
      <div class="dzm-drip-row" aria-hidden="true">
        <span class="dzm-drip"></span><span class="dzm-drip"></span>
        <span class="dzm-drip"></span><span class="dzm-drip"></span>
        <span class="dzm-drip"></span>
      </div>
      <div class="dzm-tagline">Survive the Outbreak</div>
    `;
    p.appendChild(logo);

    // ── Nav buttons
    const nav = mk('div', 'dzm-nav');
    const NAV = [
      { label: '▶  PLAY',        id: 'menuPlay',    primary: true  },
      { label: '🏆 LEADERBOARD', id: 'menuLB',      primary: false },
      { label: '⚙  SETTINGS',   id: 'menuSettings', primary: false },
      { label: '?  HOW TO PLAY', id: 'menuHTP',     primary: false },
      { label: 'ℹ  CREDITS',     id: 'menuCredits', primary: false },
    ];
    for (const n of NAV) {
      const btn = mk('button', 'dzm-btn' + (n.primary ? ' primary' : ''));
      btn.id = n.id;
      btn.textContent = n.label;
      nav.appendChild(btn);
    }
    p.appendChild(nav);

    // ── Quality selector
    const qrow = mk('div', 'dzm-qrow');
    qrow.innerHTML = `<span class="dzm-qlabel">Graphics:</span>`;
    for (const q of ['low','medium','high']) {
      const b = mk('button', 'dzm-qbtn');
      b.dataset.q = q;
      b.textContent = q.charAt(0).toUpperCase() + q.slice(1);
      b.onclick = () => this._setQuality(q);
      qrow.appendChild(b);
    }
    p.appendChild(qrow);

    // ── Version / hint
    const hint = mk('div', 'dzm-hint');
    hint.textContent = 'WASD – Move  ·  Shift – Sprint  ·  R – Reload  ·  ESC – Pause  ·  Scroll – Switch Weapon';
    p.appendChild(hint);

    this._panels.main = p;
    this._el.menuPlay     = null; // resolved after append
    this.root.appendChild(p);

    // Cache nav refs
    this._el.navPlay     = document.getElementById('menuPlay');
    this._el.navLB       = document.getElementById('menuLB');
    this._el.navSettings = document.getElementById('menuSettings');
    this._el.navHTP      = document.getElementById('menuHTP');
    this._el.navCredits  = document.getElementById('menuCredits');

    // Wire sub-screen nav
    this._el.navLB.onclick      = () => this.showLeaderboard();
    this._el.navSettings.onclick = () => this.showSettings('main');
    this._el.navHTP.onclick     = () => this._showSubPanel('howToPlay');
    this._el.navCredits.onclick  = () => this._showSubPanel('credits');

    // Sync quality highlight
    this._syncQualityBtns(p);
    p.style.display = 'none';
  }

  // ── PAUSE ───────────────────────────────────────────────────────────────────
  _buildPause() {
    const p = mk('div', 'dzm-panel dzm-overlay');
    p.innerHTML = `
      <div class="dzm-overlay-inner">
        <div class="dzm-pause-title">PAUSED</div>
        <div class="dzm-btn-group">
          <button class="dzm-btn primary" id="_dzResume">RESUME</button>
          <button class="dzm-btn"         id="_dzPSettings">SETTINGS</button>
          <button class="dzm-btn secondary"id="_dzQuit">MAIN MENU</button>
        </div>
        <div class="dzm-hint" style="margin-top:18px">Press ESC to resume</div>
      </div>
    `;
    p.style.display = 'none';
    this._panels.pause = p;
    this.root.appendChild(p);

    this._el.resumeBtn = document.getElementById('_dzResume');
    this._el.pauseSettingsBtn = document.getElementById('_dzPSettings');
    this._el.quitBtn = document.getElementById('_dzQuit');
    this._el.pauseSettingsBtn.onclick = () => this.showSettings('pause');
  }

  // ── DEATH ───────────────────────────────────────────────────────────────────
  _buildDeath() {
    const p = mk('div', 'dzm-panel dzm-overlay dzm-death');
    p.innerHTML = `
      <div class="dzm-overlay-inner">
        <div class="dzm-death-logo">
          <span class="dzm-dead">YOU</span> <span style="color:#e8e4de">DIED</span>
        </div>
        <div class="dzm-drip-row small" aria-hidden="true">
          <span class="dzm-drip"></span><span class="dzm-drip"></span>
          <span class="dzm-drip"></span>
        </div>
        <div class="dzm-death-stats" id="_dzDeathStats"></div>
        <div class="dzm-lb-pos" id="_dzLBPos"></div>
        <div class="dzm-btn-group">
          <button class="dzm-btn primary" id="_dzRetry">RETRY</button>
          <button class="dzm-btn secondary" id="_dzDMenu">MAIN MENU</button>
        </div>
      </div>
    `;
    p.style.display = 'none';
    this._panels.death = p;
    this.root.appendChild(p);
    this._el.deathStats = document.getElementById('_dzDeathStats');
    this._el.lbPos      = document.getElementById('_dzLBPos');
    this._el.retryBtn   = document.getElementById('_dzRetry');
    this._el.dmenuBtn   = document.getElementById('_dzDMenu');
  }

  // ── WAVE CLEAR ──────────────────────────────────────────────────────────────
  _buildWaveClear() {
    const p = mk('div', 'dzm-panel dzm-overlay dzm-wc');
    p.innerHTML = `
      <div class="dzm-overlay-inner dzm-wc-inner">
        <div class="dzm-wc-wave" id="_dzWCWave">WAVE 1 COMPLETE</div>
        <div class="dzm-wc-stats" id="_dzWCStats"></div>
        <div class="dzm-wc-perks-title">— Choose a Perk —</div>
        <div class="dzm-wc-perks" id="_dzWCPerks"></div>
        <div class="dzm-wc-footer">
          <div class="dzm-wc-countdown-wrap">
            <div class="dzm-wc-countdown-bar"><div class="dzm-wc-cd-fill" id="_dzCdFill"></div></div>
            <div class="dzm-wc-cd-num" id="_dzCdNum">${WAVE_CLEAR_COUNTDOWN}</div>
          </div>
          <button class="dzm-btn primary" id="_dzWCReady">READY ▶</button>
        </div>
      </div>
    `;
    p.style.display = 'none';
    this._panels.waveClear = p;
    this.root.appendChild(p);
    this._el.wcWave   = document.getElementById('_dzWCWave');
    this._el.wcStats  = document.getElementById('_dzWCStats');
    this._el.wcPerks  = document.getElementById('_dzWCPerks');
    this._el.cdFill   = document.getElementById('_dzCdFill');
    this._el.cdNum    = document.getElementById('_dzCdNum');
    this._el.wcReady  = document.getElementById('_dzWCReady');
  }

  // ── SETTINGS ────────────────────────────────────────────────────────────────
  _buildSettings() {
    const p = mk('div', 'dzm-panel dzm-overlay dzm-settings');
    p.innerHTML = `
      <div class="dzm-overlay-inner dzm-settings-inner">
        <div class="dzm-settings-title">SETTINGS</div>

        <div class="dzm-settings-cols">
          <!-- Left col -->
          <div class="dzm-settings-col">
            <div class="dzm-s-section">GRAPHICS</div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Quality</span>
              <div class="dzm-qrow small" id="_sQRow">
                <button class="dzm-qbtn" data-q="low">Low</button>
                <button class="dzm-qbtn" data-q="medium">Medium</button>
                <button class="dzm-qbtn" data-q="high">High</button>
              </div>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">FOV</span>
              <input type="range" class="dzm-slider" id="_sFOV" min="60" max="110" step="1">
              <span class="dzm-s-val" id="_sFOVv">75°</span>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Gore</span>
              <div class="dzm-toggle-row" id="_sGoreRow">
                <button class="dzm-qbtn" data-v="true">On</button>
                <button class="dzm-qbtn" data-v="false">Off</button>
              </div>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Colorblind</span>
              <select class="dzm-select" id="_sCB">
                <option value="none">None</option>
                <option value="protanopia">Protanopia</option>
                <option value="deuteranopia">Deuteranopia</option>
                <option value="tritanopia">Tritanopia</option>
              </select>
            </div>

            <div class="dzm-s-section" style="margin-top:16px">AUDIO</div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Master</span>
              <input type="range" class="dzm-slider" id="_sMaster" min="0" max="100" step="1">
              <span class="dzm-s-val" id="_sMasterV">80</span>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">SFX</span>
              <input type="range" class="dzm-slider" id="_sSFX" min="0" max="100" step="1">
              <span class="dzm-s-val" id="_sSFXV">80</span>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Music</span>
              <input type="range" class="dzm-slider" id="_sMusic" min="0" max="100" step="1">
              <span class="dzm-s-val" id="_sMusicV">50</span>
            </div>
          </div>

          <!-- Right col -->
          <div class="dzm-settings-col">
            <div class="dzm-s-section">CONTROLS</div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Mouse Sens</span>
              <input type="range" class="dzm-slider" id="_sMSens" min="1" max="100" step="1">
              <span class="dzm-s-val" id="_sMSensV">50</span>
            </div>
            <div class="dzm-s-row">
              <span class="dzm-s-label">Touch Sens</span>
              <input type="range" class="dzm-slider" id="_sTSens" min="1" max="100" step="1">
              <span class="dzm-s-val" id="_sTSensV">50</span>
            </div>

            <div class="dzm-s-section" style="margin-top:16px">HUD</div>
            <div class="dzm-s-row toggle">
              <span class="dzm-s-label">Mini-map</span>
              <label class="dzm-switch"><input type="checkbox" id="_sMM"><span class="dzm-sw-track"></span></label>
            </div>
            <div class="dzm-s-row toggle">
              <span class="dzm-s-label">Kill Feed</span>
              <label class="dzm-switch"><input type="checkbox" id="_sKF"><span class="dzm-sw-track"></span></label>
            </div>
            <div class="dzm-s-row toggle">
              <span class="dzm-s-label">Compass</span>
              <label class="dzm-switch"><input type="checkbox" id="_sCP"><span class="dzm-sw-track"></span></label>
            </div>
          </div>
        </div>

        <button class="dzm-btn secondary" id="_sBack" style="margin-top:20px">← BACK</button>
      </div>
    `;
    p.style.display = 'none';
    this._panels.settings = p;
    this.root.appendChild(p);

    // Cache + wire settings controls
    const _s = (id) => document.getElementById(id);

    // Quality row in settings
    _s('_sQRow').querySelectorAll('[data-q]').forEach(b => {
      b.onclick = () => this._setQuality(b.dataset.q);
    });

    // FOV slider
    const fovSl = _s('_sFOV'), fovV = _s('_sFOVv');
    fovSl.value = this._settings.fov;
    fovV.textContent = `${this._settings.fov}°`;
    fovSl.oninput = () => {
      const v = Number(fovSl.value);
      fovV.textContent = `${v}°`;
      this._settings.fov = v;
      localStorage.setItem('dz-fov', v);
      if (this.engine?.camera) {
        this.engine.camera.fov = v;
        this.engine.camera.updateProjectionMatrix();
      }
    };

    // Gore toggle
    _s('_sGoreRow').querySelectorAll('[data-v]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.v === 'true';
        this._settings.gore = v;
        localStorage.setItem('dz-gore', v);
        this._syncToggleBtns(_s('_sGoreRow'), String(v));
      };
    });

    // Colorblind select
    const cbSel = _s('_sCB');
    cbSel.value = this._settings.colorblind;
    cbSel.onchange = () => {
      this._settings.colorblind = cbSel.value;
      localStorage.setItem('dz-cb', cbSel.value);
      this._applyColorblind(cbSel.value);
    };

    // Volume sliders
    this._wireSlider('_sMaster', '_sMasterV', 'masterVol', 'dz-mvol', '', v => this.sound?.setMasterVolume?.(v/100));
    this._wireSlider('_sSFX',    '_sSFXV',   'sfxVol',    'dz-sfx',  '', v => this.sound?.setSFXVolume?.(v/100));
    this._wireSlider('_sMusic',  '_sMusicV', 'musicVol',  'dz-music','', v => this.sound?.setMusicVolume?.(v/100));

    // Sensitivity sliders
    this._wireSlider('_sMSens', '_sMSensV', 'mouseSens', 'dz-msens', '');
    this._wireSlider('_sTSens', '_sTSensV', 'touchSens', 'dz-tsens', '');

    // HUD toggles
    this._wireCheckbox('_sMM', 'minimap',  'dz-ui-mm');
    this._wireCheckbox('_sKF', 'killfeed', 'dz-ui-kf');
    this._wireCheckbox('_sCP', 'compass',  'dz-ui-cp');

    this._el.settingsBack = _s('_sBack');
    this._el.settingsQRow = _s('_sQRow');
  }

  // ── HOW TO PLAY ─────────────────────────────────────────────────────────────
  _buildHowToPlay() {
    const p = mk('div', 'dzm-panel dzm-overlay');
    p.innerHTML = `
      <div class="dzm-overlay-inner">
        <div class="dzm-settings-title">HOW TO PLAY</div>
        <div class="dzm-htp-grid">
          <div class="dzm-htp-col">
            <div class="dzm-htp-section">Movement</div>
            <div class="dzm-htp-row"><kbd>W A S D</kbd> Move</div>
            <div class="dzm-htp-row"><kbd>SHIFT</kbd> Sprint (costs stamina)</div>
            <div class="dzm-htp-row"><kbd>C / CTRL</kbd> Crouch</div>
            <div class="dzm-htp-row"><kbd>SPACE</kbd> Jump</div>
            <div class="dzm-htp-section" style="margin-top:14px">Combat</div>
            <div class="dzm-htp-row"><kbd>LMB</kbd> Fire</div>
            <div class="dzm-htp-row"><kbd>RMB</kbd> Aim Down Sights</div>
            <div class="dzm-htp-row"><kbd>R</kbd> Reload</div>
            <div class="dzm-htp-row"><kbd>1–8</kbd> Select Weapon</div>
            <div class="dzm-htp-row"><kbd>Scroll</kbd> Cycle Weapons</div>
          </div>
          <div class="dzm-htp-col">
            <div class="dzm-htp-section">Tips</div>
            <div class="dzm-htp-row tip">🎯 Headshots deal 3× damage</div>
            <div class="dzm-htp-row tip">🔫 Sniper bullets penetrate 2 zombies</div>
            <div class="dzm-htp-row tip">🔥 Flamethrower ignores armor</div>
            <div class="dzm-htp-row tip">⚔️ Katana has infinite ammo</div>
            <div class="dzm-htp-row tip">🏃 Crouch for better accuracy</div>
            <div class="dzm-htp-row tip">💊 Stay mobile — don't get surrounded</div>
            <div class="dzm-htp-row tip">💣 Shoot barrels for area damage</div>
            <div class="dzm-htp-row tip">💾 Upgrades persist between waves</div>
            <div class="dzm-htp-section" style="margin-top:14px">UI</div>
            <div class="dzm-htp-row"><kbd>ESC / P</kbd> Pause</div>
            <div class="dzm-htp-row"><kbd>TAB</kbd> Scoreboard</div>
          </div>
        </div>
        <button class="dzm-btn secondary" id="_htpBack" style="margin-top:20px">← BACK</button>
      </div>
    `;
    p.style.display = 'none';
    this._panels.howToPlay = p;
    this.root.appendChild(p);
    document.getElementById('_htpBack').onclick = () => this._hideSubPanel('howToPlay');
  }

  // ── CREDITS ─────────────────────────────────────────────────────────────────
  _buildCredits() {
    const p = mk('div', 'dzm-panel dzm-overlay');
    p.innerHTML = `
      <div class="dzm-overlay-inner">
        <div class="dzm-settings-title">CREDITS</div>
        <div class="dzm-credits-list">
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">Game Design & Development</div>
            <div class="dzm-credit-name">DEAD ZONE Team</div>
          </div>
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">3D Engine</div>
            <div class="dzm-credit-name">Three.js</div>
          </div>
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">Physics</div>
            <div class="dzm-credit-name">Rapier3D (dimforge)</div>
          </div>
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">Post-Processing</div>
            <div class="dzm-credit-name">vanruesc/postprocessing</div>
          </div>
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">Animation</div>
            <div class="dzm-credit-name">GreenSock GSAP</div>
          </div>
          <div class="dzm-credit-block">
            <div class="dzm-credit-role">Fonts</div>
            <div class="dzm-credit-name">Creepster · Rubik — Google Fonts</div>
          </div>
          <div class="dzm-credit-block" style="margin-top:20px;color:rgba(180,160,140,0.55);font-size:12px">
            Built with Three.js · Rapier · Vite · GSAP
          </div>
        </div>
        <button class="dzm-btn secondary" id="_credBack" style="margin-top:20px">← BACK</button>
      </div>
    `;
    p.style.display = 'none';
    this._panels.credits = p;
    this.root.appendChild(p);
    document.getElementById('_credBack').onclick = () => this._hideSubPanel('credits');
  }

  // ── LEADERBOARD ─────────────────────────────────────────────────────────────
  _buildLeaderboard() {
    const p = mk('div', 'dzm-panel dzm-overlay');
    p.innerHTML = `
      <div class="dzm-overlay-inner">
        <div class="dzm-settings-title">🏆 LEADERBOARD</div>
        <div class="dzm-lb-subtitle">Local Top 10</div>
        <div class="dzm-lb-table" id="_dzLBTable"></div>
        <button class="dzm-btn secondary" id="_lbBack" style="margin-top:20px">← BACK</button>
      </div>
    `;
    p.style.display = 'none';
    this._panels.leaderboard = p;
    this.root.appendChild(p);
    this._el.lbTable = document.getElementById('_dzLBTable');
    document.getElementById('_lbBack').onclick = () => this._hideSubPanel('leaderboard');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Show the main menu. onPlay is called when PLAY is clicked. */
  showMain(onPlay) {
    const p = this._panels.main;
    p.style.display = 'flex';
    this._syncQualityBtns(p);

    this._el.navPlay.onclick = () => {
      this._animOut(p, onPlay);
    };

    // GSAP entrance (graceful fallback via CSS if absent)
    if (gsap) {
      gsap.fromTo('.dzm-logo-text', { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' });
      gsap.fromTo('.dzm-nav .dzm-btn', { y: 20, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.4,
        stagger: 0.08, ease: 'power2.out', delay: 0.35,
      });
      gsap.fromTo('.dzm-zombie', { x: '-120px' }, {
        x: '0px', duration: 0.01, // just ensure they're off-screen at start
      });
    }
  }

  hideMain() {
    this._panels.main.style.display = 'none';
  }

  /** Show the pause overlay. */
  showPause(onResume, onQuit) {
    const p = this._panels.pause;
    p.style.display = 'flex';

    this._el.resumeBtn.onclick = () => {
      p.style.display = 'none';
      onResume();
    };
    this._el.quitBtn.onclick = () => {
      p.style.display = 'none';
      onQuit();
    };

    if (gsap) gsap.fromTo('.dzm-overlay-inner', { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(1.4)' });
  }

  hidePause() {
    this._panels.pause.style.display = 'none';
  }

  /**
   * Show the death / game-over screen.
   * @param {number} score
   * @param {number} hi       all-time high score
   * @param {number} wave     wave reached
   * @param {number} kills
   * @param {Function} onRetry
   * @param {Function} onMenu
   */
  showDeath(score, hi, wave, kills, onRetry, onMenu) {
    const p = this._panels.death;

    const rank = lbAdd(score, wave, kills);

    this._el.deathStats.innerHTML = `
      <div class="dzm-stat-grid">
        <div class="dzm-stat-cell"><div class="dzm-stat-val">${wave}</div><div class="dzm-stat-lbl">Wave</div></div>
        <div class="dzm-stat-cell"><div class="dzm-stat-val">${kills}</div><div class="dzm-stat-lbl">Kills</div></div>
        <div class="dzm-stat-cell"><div class="dzm-stat-val">${fmtScore(score)}</div><div class="dzm-stat-lbl">Score</div></div>
        <div class="dzm-stat-cell"><div class="dzm-stat-val gold">${fmtScore(hi)}</div><div class="dzm-stat-lbl">Best</div></div>
      </div>
    `;

    this._el.lbPos.textContent = rank <= 10
      ? `🏆 You placed #${rank} on the local leaderboard!`
      : '';

    this._el.retryBtn.onclick = () => { p.style.display = 'none'; onRetry(); };
    this._el.dmenuBtn.onclick = () => { p.style.display = 'none'; onMenu(); };

    p.style.display = 'flex';

    if (gsap) {
      gsap.fromTo('.dzm-death-logo', { y: -20, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.2)' });
      gsap.fromTo('.dzm-stat-cell',  { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, delay: 0.5, duration: 0.4, ease: 'power2.out' });
    }
  }

  /**
   * Show between-waves screen with stats + perk selection.
   * Returns a Promise that resolves (with selected perk id) when READY is clicked
   * or countdown expires.
   * @param {{ wave, kills, headshots, accuracy, time }} stats
   * @returns {Promise<string>}  perk id selected
   */
  showWaveClear(stats) {
    const p = this._panels.waveClear;

    this._el.wcWave.textContent = `WAVE ${stats.wave} COMPLETE`;

    const acc = stats.accuracy != null ? `${stats.accuracy}%` : '—';
    this._el.wcStats.innerHTML = `
      <div class="dzm-wc-stat-row">
        <div class="dzm-wc-stat"><b>${stats.kills ?? 0}</b><span>KILLS</span></div>
        <div class="dzm-wc-stat"><b>${stats.headshots ?? 0}</b><span>HEADSHOTS</span></div>
        <div class="dzm-wc-stat"><b>${acc}</b><span>ACCURACY</span></div>
        <div class="dzm-wc-stat"><b>${_fmtTime(stats.time ?? 0)}</b><span>TIME</span></div>
      </div>
    `;

    // Random 3 perks
    const chosen = _shuffle([...PERKS]).slice(0, 3);
    this._el.wcPerks.innerHTML = '';
    let selectedPerk = null;

    for (const pk of chosen) {
      const card = mk('div', 'dzm-perk-card');
      card.innerHTML = `
        <div class="dzm-perk-icon">${pk.icon}</div>
        <div class="dzm-perk-name">${pk.name}</div>
        <div class="dzm-perk-desc">${pk.desc}</div>
      `;
      card.onclick = () => {
        if (selectedPerk) return; // already chose
        selectedPerk = pk.id;
        card.classList.add('selected');
        this._el.wcPerks.querySelectorAll('.dzm-perk-card:not(.selected)').forEach(c => c.classList.add('dim'));
      };
      this._el.wcPerks.appendChild(card);
    }

    p.style.display = 'flex';

    if (gsap) {
      gsap.fromTo('.dzm-wc-wave', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' });
      gsap.fromTo('.dzm-perk-card', { y: 20, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, delay: 0.3, duration: 0.35, ease: 'power2.out' });
    }

    return new Promise((resolve) => {
      let timeLeft = WAVE_CLEAR_COUNTDOWN;
      this._el.cdNum.textContent = timeLeft;
      this._el.cdFill.style.width = '100%';

      clearInterval(this._wcTimer);
      this._wcTimer = setInterval(() => {
        timeLeft--;
        this._el.cdNum.textContent = timeLeft;
        this._el.cdFill.style.width = `${(timeLeft / WAVE_CLEAR_COUNTDOWN) * 100}%`;
        if (timeLeft <= 0) {
          clearInterval(this._wcTimer);
          p.style.display = 'none';
          resolve(selectedPerk ?? 'none');
        }
      }, 1000);

      this._el.wcReady.onclick = () => {
        clearInterval(this._wcTimer);
        p.style.display = 'none';
        resolve(selectedPerk ?? 'none');
      };
    });
  }

  /** Open settings panel. `from` is 'main' or 'pause' (controls Back button behaviour). */
  showSettings(from = 'main') {
    this._syncSettingsUI();
    this._panels.settings.style.display = 'flex';
    this._el.settingsBack.onclick = () => {
      this._panels.settings.style.display = 'none';
      if (from === 'pause') {
        // Re-show pause (it was already visible)
      }
    };
    if (gsap) gsap.fromTo('.dzm-settings-inner', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' });
  }

  hideSettings() { this._panels.settings.style.display = 'none'; }

  showLeaderboard() {
    const lb = lbGet();
    if (lb.length === 0) {
      this._el.lbTable.innerHTML = '<div class="dzm-lb-empty">No scores yet — go survive!</div>';
    } else {
      this._el.lbTable.innerHTML = `
        <div class="dzm-lb-header">
          <span>#</span><span>Score</span><span>Wave</span><span>Kills</span><span>Date</span>
        </div>
        ${lb.map((e, i) => `
          <div class="dzm-lb-row ${i === 0 ? 'gold' : i < 3 ? 'silver' : ''}">
            <span>${i + 1}</span>
            <span>${fmtScore(e.score)}</span>
            <span>${e.wave}</span>
            <span>${e.kills}</span>
            <span>${e.date}</span>
          </div>`).join('')}
      `;
    }
    this._panels.leaderboard.style.display = 'flex';
  }

  /** Expose current settings so player.js / engine can read them. */
  getSettings() { return { ...this._settings }; }

  // ── Private helpers ─────────────────────────────────────────────────────────
  _showSubPanel(id) {
    this._panels[id].style.display = 'flex';
    if (gsap) gsap.fromTo(this._panels[id].querySelector('.dzm-overlay-inner') ?? this._panels[id],
      { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' });
  }

  _hideSubPanel(id) {
    this._panels[id].style.display = 'none';
  }

  _animOut(panel, cb) {
    if (gsap) {
      gsap.to(panel, { opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => {
        panel.style.display = 'none';
        panel.style.opacity = '';
        cb?.();
      }});
    } else {
      panel.style.display = 'none';
      cb?.();
    }
  }

  _setQuality(q) {
    this._settings.quality = q;
    localStorage.setItem('dz-quality', q);
    this.engine?.applyQuality?.(q);
    // Sync all quality button rows
    document.querySelectorAll('[data-q]').forEach(b => {
      b.classList.toggle('active', b.dataset.q === q);
    });
  }

  _applySettings(announce = true) {
    const s = this._settings;
    if (s.quality && this.engine?.applyQuality) this.engine.applyQuality(s.quality);
    if (this.engine?.camera) {
      this.engine.camera.fov = s.fov;
      this.engine.camera.updateProjectionMatrix?.();
    }
    this._applyColorblind(s.colorblind);
  }

  _applyColorblind(mode) {
    const root = document.documentElement;
    root.classList.remove('cb-protanopia', 'cb-deuteranopia', 'cb-tritanopia');
    if (mode !== 'none') root.classList.add(`cb-${mode}`);
  }

  _syncSettingsUI() {
    const s = this._settings;
    const _v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const _t = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const _c = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

    _v('_sFOV',  s.fov);    _t('_sFOVv', `${s.fov}°`);
    _v('_sMaster', s.masterVol); _t('_sMasterV', s.masterVol);
    _v('_sSFX',    s.sfxVol);    _t('_sSFXV',    s.sfxVol);
    _v('_sMusic',  s.musicVol);  _t('_sMusicV',  s.musicVol);
    _v('_sMSens',  s.mouseSens); _t('_sMSensV',  s.mouseSens);
    _v('_sTSens',  s.touchSens); _t('_sTSensV',  s.touchSens);
    _c('_sMM', s.minimap);
    _c('_sKF', s.killfeed);
    _c('_sCP', s.compass);

    const cbSel = document.getElementById('_sCB');
    if (cbSel) cbSel.value = s.colorblind;

    this._syncToggleBtns(document.getElementById('_sGoreRow'), String(s.gore));
    this._syncQualityBtns(document.getElementById('_sQRow'));
  }

  _syncQualityBtns(root) {
    if (!root) return;
    const q = this._settings.quality;
    root.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', b.dataset.q === q));
  }

  _syncToggleBtns(root, val) {
    if (!root) return;
    root.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('active', b.dataset.v === val));
  }

  _wireSlider(sliderId, valId, settingKey, lsKey, suffix, onChange) {
    const sl = document.getElementById(sliderId);
    const vl = document.getElementById(valId);
    if (!sl) return;
    sl.value = this._settings[settingKey];
    if (vl) vl.textContent = this._settings[settingKey] + suffix;
    sl.oninput = () => {
      const v = Number(sl.value);
      this._settings[settingKey] = v;
      localStorage.setItem(lsKey, v);
      if (vl) vl.textContent = v + suffix;
      onChange?.(v);
    };
  }

  _wireCheckbox(id, settingKey, lsKey) {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = this._settings[settingKey];
    cb.onchange = () => {
      this._settings[settingKey] = cb.checked;
      localStorage.setItem(lsKey, cb.checked);
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mk(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function fmtScore(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function _fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Injected CSS ──────────────────────────────────────────────────────────────
const MENU_CSS = `
/* ─── Colorblind filters ─── */
.cb-protanopia    { filter: url('#cb-protan'); }
.cb-deuteranopia  { filter: url('#cb-deutan'); }
.cb-tritanopia    { filter: url('#cb-tritan'); }

/* ─── Base panel ─── */
.dzm-panel {
  position: fixed; inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 20;
  pointer-events: all;
  font-family: 'Rubik', 'Segoe UI', system-ui, sans-serif;
  user-select: none;
  color: #e4e0da;
}

/* ─── Generic overlay (dark glass) ─── */
.dzm-overlay {
  background: rgba(3,5,7,0.86);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.dzm-overlay-inner {
  display: flex; flex-direction: column;
  align-items: center; gap: 0;
  max-height: 90vh; overflow-y: auto;
  padding: 36px 40px;
  background: rgba(8,11,15,0.75);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  box-shadow: 0 0 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(220,40,40,0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  min-width: min(480px, 92vw);
}

/* ─── MAIN MENU ─── */
.dzm-main {
  position: fixed; inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 50% 30%, rgba(60,8,8,0.28) 0%, transparent 65%),
    linear-gradient(180deg, #030507 0%, #060810 60%, #0b0c10 100%);
}

/* ─── Animated background ─── */
.dzm-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }

/* Fog layers */
.dzm-fog {
  position: absolute; bottom: 0; left: -10%; right: -10%;
  border-radius: 50%;
  animation: dzm-fog-drift linear infinite alternate;
  pointer-events: none;
}
.dzm-fog-0 {
  height: 22%; opacity: 0.18;
  background: radial-gradient(ellipse 80% 100% at 50% 100%, rgba(20,30,40,0.9) 0%, transparent 70%);
  animation-duration: 10s;
}
.dzm-fog-1 {
  height: 18%; opacity: 0.12;
  background: radial-gradient(ellipse 70% 100% at 30% 100%, rgba(15,25,35,0.9) 0%, transparent 70%);
  animation-duration: 14s; animation-delay: -4s;
}
.dzm-fog-2 {
  height: 14%; opacity: 0.10;
  background: radial-gradient(ellipse 60% 100% at 70% 100%, rgba(15,20,30,0.9) 0%, transparent 70%);
  animation-duration: 18s; animation-delay: -8s;
}
@keyframes dzm-fog-drift {
  0%   { transform: translateX(-4%) scaleX(1.08); }
  100% { transform: translateX(4%)  scaleX(0.94); }
}

/* Zombie silhouettes */
.dzm-zombie {
  position: absolute;
  color: rgba(0,0,0,0.72);
  width: 52px; height: 110px;
  animation: dzm-walk linear infinite;
  transform-origin: bottom center;
}
.dzm-zombie svg { width: 100%; height: 100%; }
@keyframes dzm-walk {
  0%   { transform: translateX(-120px) scaleX(var(--flip,1)); }
  100% { transform: translateX(calc(100vw + 120px)) scaleX(var(--flip,1)); }
}

/* Floating ember particles */
.dzm-particle {
  position: absolute;
  border-radius: 50%;
  background: rgba(200,40,20,0.6);
  box-shadow: 0 0 4px rgba(200,40,20,0.4);
  animation: dzm-float ease-in-out infinite alternate;
}
@keyframes dzm-float {
  0%   { transform: translateY(0)   scale(1); opacity: 0.3; }
  100% { transform: translateY(-24px) scale(0.6); opacity: 0.05; }
}

/* ─── Logo ─── */
.dzm-logo {
  position: relative;
  text-align: center;
  margin-bottom: 40px;
  z-index: 1;
}
.dzm-logo-text {
  font-family: 'Creepster', 'Nosifer', cursive;
  font-size: clamp(3.5rem, 12vw, 7rem);
  letter-spacing: 0.10em;
  line-height: 1;
  display: flex; gap: 0.25em; justify-content: center;
}
.dzm-dead {
  color: #c82020;
  text-shadow:
    0 0 30px rgba(200,32,32,0.7),
    0 0 80px rgba(200,32,32,0.25);
  animation: dzm-flicker 6s infinite;
}
.dzm-zone {
  color: #e8e4de;
  text-shadow:
    0 0 20px rgba(232,228,222,0.25),
    0 0 50px rgba(232,228,222,0.08);
}
@keyframes dzm-flicker {
  0%,17%,19%,21%,23%,50%,52%,100% { opacity: 1; }
  18%,20%,22%,51% { opacity: 0.35; }
}

/* Blood drip row */
.dzm-drip-row {
  display: flex; justify-content: center;
  gap: clamp(20px, 5vw, 50px);
  height: 34px; overflow: visible;
  margin-top: 4px;
}
.dzm-drip {
  display: block;
  width: 8px;
  background: linear-gradient(to bottom, #9e0c0c, #c82020);
  border-radius: 0 0 50% 50%;
  animation: dzm-drip-fall 3s ease-in-out infinite alternate;
  box-shadow: 0 0 8px rgba(200,32,32,0.6);
}
.dzm-drip:nth-child(1) { height: 20px; animation-delay: 0s; }
.dzm-drip:nth-child(2) { height: 28px; animation-delay: 0.3s; }
.dzm-drip:nth-child(3) { height: 16px; animation-delay: 0.7s; }
.dzm-drip:nth-child(4) { height: 32px; animation-delay: 0.15s; }
.dzm-drip:nth-child(5) { height: 22px; animation-delay: 0.5s; }
.dzm-drip-row.small .dzm-drip { width: 5px; }
.dzm-drip-row.small .dzm-drip:nth-child(1) { height: 14px; }
.dzm-drip-row.small .dzm-drip:nth-child(2) { height: 20px; }
.dzm-drip-row.small .dzm-drip:nth-child(3) { height: 12px; }
@keyframes dzm-drip-fall {
  0%   { transform: scaleY(0.65); opacity: 0.75; }
  100% { transform: scaleY(1.2);  opacity: 1; }
}

.dzm-tagline {
  font-size: 11px; letter-spacing: 6px; text-transform: uppercase;
  color: rgba(150,120,100,0.6); margin-top: 14px;
}

/* ─── Nav buttons ─── */
.dzm-nav {
  display: flex; flex-direction: column;
  gap: 10px; width: 280px;
  position: relative; z-index: 1;
}

/* ─── Generic button ─── */
.dzm-btn {
  appearance: none;
  display: block; width: 100%;
  padding: 13px 28px;
  font-family: 'Rubik', inherit;
  font-size: 14px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase;
  color: #ddd8d0;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(210,45,45,0.45);
  border-radius: 6px;
  cursor: pointer;
  transition: background .18s, border-color .18s, box-shadow .18s, transform .1s;
  position: relative; overflow: hidden;
}
.dzm-btn::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 60%);
  pointer-events: none;
}
.dzm-btn:hover {
  background: rgba(200,40,40,0.18);
  border-color: rgba(230,60,60,0.85);
  box-shadow: 0 0 24px rgba(200,40,40,0.25), inset 0 0 10px rgba(200,40,40,0.08);
  color: #fff;
}
.dzm-btn:active { transform: scale(0.97); }
.dzm-btn.primary {
  background: linear-gradient(180deg, rgba(180,25,25,0.85) 0%, rgba(110,12,12,0.9) 100%);
  border-color: rgba(230,60,60,0.8);
  color: #ffe8e8;
  font-size: 15px; letter-spacing: 5px;
}
.dzm-btn.primary:hover {
  background: linear-gradient(180deg, rgba(210,35,35,0.9) 0%, rgba(140,15,15,0.95) 100%);
  box-shadow: 0 0 30px rgba(220,50,50,0.35), 0 0 60px rgba(220,50,50,0.1);
}
.dzm-btn.secondary {
  font-size: 12px; letter-spacing: 3px;
  border-color: rgba(255,255,255,0.12);
  color: rgba(180,180,180,0.75);
}
.dzm-btn.secondary:hover {
  border-color: rgba(255,255,255,0.3);
  color: #e0dcd6;
  background: rgba(255,255,255,0.06);
  box-shadow: none;
}
.dzm-btn-group {
  display: flex; flex-direction: column;
  gap: 10px; width: 280px;
}

/* ─── Quality row ─── */
.dzm-qrow {
  display: flex; gap: 6px; align-items: center;
  position: relative; z-index: 1; margin-top: 16px;
}
.dzm-qrow.small { margin-top: 0; gap: 4px; }
.dzm-qlabel { font-size: 10px; color: rgba(140,160,150,0.55); letter-spacing: 2px; margin-right: 4px; }
.dzm-qbtn {
  padding: 5px 14px; font-family: inherit;
  font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
  cursor: pointer; border: 1px solid rgba(255,255,255,0.12);
  background: transparent; color: rgba(150,160,155,0.55);
  border-radius: 3px; transition: all .15s;
}
.dzm-qbtn:hover { color: #b8c0bc; border-color: rgba(255,255,255,0.25); }
.dzm-qbtn.active { border-color: rgba(100,210,140,0.65); color: #78e8a8; background: rgba(40,80,60,0.28); }

/* ─── Hint ─── */
.dzm-hint {
  font-size: 10px; letter-spacing: 2px; color: rgba(100,120,110,0.5);
  text-align: center; margin-top: 14px; max-width: 480px;
  position: relative; z-index: 1;
}

/* ─── PAUSE ─── */
.dzm-pause-title {
  font-family: 'Creepster', cursive;
  font-size: 44px; font-weight: 400; letter-spacing: 10px;
  color: #e8e4de; margin-bottom: 28px;
  text-shadow: 0 0 30px rgba(220,200,180,0.2);
}

/* ─── DEATH SCREEN ─── */
.dzm-death { background: rgba(2,2,4,0.96); }
.dzm-death-logo {
  font-family: 'Creepster', 'Nosifer', cursive;
  font-size: clamp(3rem, 10vw, 5.5rem);
  font-weight: 400; letter-spacing: 8px; line-height: 1;
  margin-bottom: 6px;
  text-shadow: 0 0 50px rgba(210,20,20,0.6);
}
.dzm-death-stats { margin: 22px 0 14px; }
.dzm-stat-grid {
  display: grid; grid-template-columns: repeat(4,1fr);
  gap: 18px; text-align: center;
}
.dzm-stat-cell { display: flex; flex-direction: column; align-items: center; }
.dzm-stat-val  {
  font-size: 32px; font-weight: 900; color: #eceae6;
  line-height: 1; font-variant-numeric: tabular-nums;
}
.dzm-stat-val.gold { color: #ffd700; text-shadow: 0 0 20px rgba(255,215,0,0.4); }
.dzm-stat-lbl { font-size: 9px; letter-spacing: 3px; color: rgba(130,160,145,0.6); margin-top: 4px; text-transform: uppercase; }
.dzm-lb-pos {
  font-size: 13px; color: #ffd700; letter-spacing: 1px; min-height: 20px; margin-bottom: 8px;
}

/* ─── WAVE CLEAR ─── */
.dzm-wc { background: rgba(2,4,6,0.92); }
.dzm-wc-inner { max-width: 680px; gap: 0; }
.dzm-wc-wave {
  font-family: 'Creepster', cursive;
  font-size: clamp(2rem, 6vw, 3rem);
  letter-spacing: 5px; color: #72e048;
  text-shadow: 0 0 30px rgba(80,200,50,0.5);
  margin-bottom: 16px;
}
.dzm-wc-stat-row {
  display: flex; gap: 28px; justify-content: center;
  margin-bottom: 22px; flex-wrap: wrap;
}
.dzm-wc-stat {
  display: flex; flex-direction: column; align-items: center; min-width: 80px;
}
.dzm-wc-stat b {
  font-size: 28px; font-weight: 900; color: #eceae6;
  font-variant-numeric: tabular-nums;
}
.dzm-wc-stat span {
  font-size: 8px; letter-spacing: 3px; color: rgba(130,160,145,0.6); text-transform: uppercase;
}
.dzm-wc-perks-title {
  font-size: 10px; letter-spacing: 5px; color: rgba(170,140,100,0.65);
  text-transform: uppercase; margin-bottom: 14px;
}
.dzm-wc-perks { display: flex; gap: 14px; justify-content: center; margin-bottom: 22px; flex-wrap: wrap; }
.dzm-perk-card {
  width: 160px; padding: 18px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(210,150,50,0.35);
  border-radius: 8px; text-align: center; cursor: pointer;
  transition: all .2s;
}
.dzm-perk-card:hover {
  background: rgba(210,150,50,0.12);
  border-color: rgba(230,170,60,0.7);
  box-shadow: 0 0 18px rgba(210,150,50,0.2);
  transform: translateY(-3px);
}
.dzm-perk-card.selected {
  background: rgba(210,150,50,0.22);
  border-color: rgba(255,210,80,0.9);
  box-shadow: 0 0 28px rgba(255,210,80,0.3);
}
.dzm-perk-card.dim { opacity: 0.35; pointer-events: none; }
.dzm-perk-icon { font-size: 28px; margin-bottom: 8px; }
.dzm-perk-name { font-size: 13px; font-weight: 700; color: #f0c850; margin-bottom: 6px; letter-spacing: 1px; }
.dzm-perk-desc { font-size: 11px; color: rgba(200,190,170,0.65); line-height: 1.4; }
.dzm-wc-footer {
  display: flex; align-items: center; gap: 20px; width: 100%; justify-content: center;
}
.dzm-wc-countdown-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; max-width: 200px; }
.dzm-wc-countdown-bar {
  width: 100%; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
}
.dzm-wc-cd-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, #78e048, #c0e828);
  transition: width 1s linear;
  box-shadow: 0 0 8px rgba(120,220,60,0.5);
}
.dzm-wc-cd-num { font-size: 13px; color: rgba(130,180,100,0.8); font-variant-numeric: tabular-nums; }

/* ─── SETTINGS ─── */
.dzm-settings { }
.dzm-settings-title {
  font-family: 'Creepster', cursive;
  font-size: 36px; letter-spacing: 6px; color: #e8e4de;
  margin-bottom: 22px; text-align: center;
  text-shadow: 0 0 20px rgba(220,180,160,0.15);
}
.dzm-settings-cols { display: flex; gap: 32px; width: 100%; flex-wrap: wrap; }
.dzm-settings-col  { flex: 1; min-width: 220px; }
.dzm-s-section {
  font-size: 9px; letter-spacing: 4px; text-transform: uppercase;
  color: rgba(210,45,45,0.75); margin-bottom: 12px; border-bottom: 1px solid rgba(210,45,45,0.18); padding-bottom: 5px;
}
.dzm-s-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.dzm-s-row.toggle { justify-content: space-between; }
.dzm-s-label { font-size: 12px; color: rgba(180,190,185,0.8); min-width: 80px; }
.dzm-s-val   { font-size: 12px; color: rgba(130,170,150,0.8); min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }

.dzm-slider {
  flex: 1; height: 4px; border-radius: 2px;
  accent-color: #c82020;
  background: rgba(255,255,255,0.1);
  cursor: pointer; border: none; outline: none;
}

.dzm-select {
  flex: 1; background: rgba(10,14,18,0.8); color: #c8c4be;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
  padding: 4px 8px; font-size: 12px; cursor: pointer; outline: none;
}
.dzm-select option { background: #0a0e12; }

/* Toggle switch */
.dzm-switch { position: relative; display: inline-block; width: 38px; height: 20px; cursor: pointer; }
.dzm-switch input { opacity: 0; width: 0; height: 0; }
.dzm-sw-track {
  position: absolute; inset: 0; border-radius: 20px;
  background: rgba(255,255,255,0.1); transition: background .2s;
  border: 1px solid rgba(255,255,255,0.12);
}
.dzm-sw-track::before {
  content: ''; position: absolute;
  height: 14px; width: 14px; border-radius: 50%;
  left: 3px; top: 2px;
  background: rgba(180,180,180,0.6);
  transition: transform .2s, background .2s;
}
.dzm-switch input:checked + .dzm-sw-track { background: rgba(180,25,25,0.6); border-color: rgba(210,45,45,0.6); }
.dzm-switch input:checked + .dzm-sw-track::before { transform: translateX(18px); background: #e84040; }

/* ─── HOW TO PLAY ─── */
.dzm-htp-grid { display: flex; gap: 32px; width: 100%; flex-wrap: wrap; }
.dzm-htp-col  { flex: 1; min-width: 200px; }
.dzm-htp-section {
  font-size: 9px; letter-spacing: 4px; text-transform: uppercase;
  color: rgba(210,45,45,0.75); margin-bottom: 10px; margin-top: 4px;
  border-bottom: 1px solid rgba(210,45,45,0.18); padding-bottom: 5px;
}
.dzm-htp-row {
  font-size: 12px; color: rgba(180,190,185,0.8);
  margin-bottom: 7px; display: flex; align-items: baseline; gap: 8px;
}
.dzm-htp-row.tip { color: rgba(160,175,165,0.7); }
kbd {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 3px; padding: 2px 6px; font-size: 10px; letter-spacing: 1px;
  color: rgba(210,220,215,0.85); white-space: nowrap;
}

/* ─── CREDITS ─── */
.dzm-credits-list { display: flex; flex-direction: column; gap: 16px; width: 100%; align-items: center; }
.dzm-credit-block { text-align: center; }
.dzm-credit-role  { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: rgba(130,160,145,0.55); }
.dzm-credit-name  { font-size: 16px; font-weight: 700; color: #ddd8d0; margin-top: 3px; }

/* ─── LEADERBOARD ─── */
.dzm-lb-subtitle { font-size: 10px; letter-spacing: 3px; color: rgba(130,160,145,0.55); margin-bottom: 16px; text-transform: uppercase; }
.dzm-lb-table { width: 100%; }
.dzm-lb-header, .dzm-lb-row {
  display: grid; grid-template-columns: 30px 1fr 60px 60px 80px;
  gap: 8px; padding: 7px 10px; font-size: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.dzm-lb-header { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: rgba(130,160,145,0.55); }
.dzm-lb-row { color: rgba(180,190,185,0.8); }
.dzm-lb-row:hover { background: rgba(255,255,255,0.04); }
.dzm-lb-row.gold   { color: #ffd700; font-weight: 700; }
.dzm-lb-row.silver { color: #c8c8d0; }
.dzm-lb-empty { color: rgba(150,160,155,0.5); font-size: 13px; text-align: center; padding: 20px 0; }

/* ─── Scrollbar ─── */
.dzm-overlay-inner::-webkit-scrollbar       { width: 4px; }
.dzm-overlay-inner::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); }
.dzm-overlay-inner::-webkit-scrollbar-thumb { background: rgba(210,45,45,0.45); border-radius: 2px; }

/* ─── Responsive ─── */
@media (max-width: 560px) {
  .dzm-overlay-inner { padding: 22px 16px; }
  .dzm-settings-cols { flex-direction: column; gap: 16px; }
  .dzm-stat-grid     { grid-template-columns: repeat(2,1fr); }
  .dzm-wc-perks      { flex-direction: column; align-items: center; }
}
`;

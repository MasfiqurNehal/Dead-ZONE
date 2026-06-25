/**
 * src/ui/hud.js — In-game HUD for DEAD ZONE
 *
 * All in-game overlays (no menus here):
 *   • Health / Armor / Stamina bars          bottom-left
 *   • Ammo counter + weapon name             bottom-right
 *   • Weapon quick-select bar                bottom-center
 *   • Wave number + enemy count              top-center
 *   • Score + kill count                     top-right
 *   • Radar / minimap (canvas)               top-left
 *   • Compass strip                          top-center below wave
 *   • Kill feed                              right side
 *   • Damage direction arrows                around crosshair
 *   • Dynamic crosshair (spreads with speed)
 *   • Wave / clear announcement banner
 *   • Hit marker (white → gold on headshot)
 *   • Low-health vignette + heartbeat pulse
 *   • FPS counter
 */

const ARENA_SIZE = 100; // world units — must match constants.js WORLD.arenaSize

// ─── HUD class ───────────────────────────────────────────────────────────────
export class HUD {
  /**
   * @param {HTMLElement} root   #ui-root element
   * @param {{ camera?: import('three').Camera }} opts
   */
  constructor(root, { camera = null } = {}) {
    this.root   = root;
    this.camera = camera;

    this._visible     = false;
    this._hitTimer    = 0;
    this._bannerTimer = 0;
    this._el          = {};

    this._feed    = [];    // kill-feed: { el, life }[]
    this._dmgPool = [];    // damage arrows: { el, life, active }[]

    this._mmZombies = []; // { x, z }[] for minimap
    this._mmPlayer  = { x: 0, z: 0, yaw: 0 };

    this._spread = 0;     // crosshair spread [0..1]

    this._injectCSS();
    this._build();
  }

  // ── CSS ────────────────────────────────────────────────────────────────────
  _injectCSS() {
    if (document.getElementById('dz-hud-css')) return;
    const s = document.createElement('style');
    s.id = 'dz-hud-css';
    s.textContent = HUD_CSS;
    document.head.appendChild(s);
  }

  // ── DOM build ──────────────────────────────────────────────────────────────
  _build() {
    const e = this._el;

    const wrap = mk('div', 'dz-hud');
    wrap.style.display = 'none';
    e.wrap = wrap;

    // ── Crosshair ─────────────────────────────────────────────────────────
    const ch = mk('div', 'dz-ch');
    e.chT  = mk('div', 'dz-ch-p dz-ch-t');  ch.appendChild(e.chT);
    e.chB  = mk('div', 'dz-ch-p dz-ch-b');  ch.appendChild(e.chB);
    e.chL  = mk('div', 'dz-ch-p dz-ch-l');  ch.appendChild(e.chL);
    e.chR  = mk('div', 'dz-ch-p dz-ch-r');  ch.appendChild(e.chR);
    e.chDot= mk('div', 'dz-ch-p dz-ch-dot');ch.appendChild(e.chDot);
    wrap.appendChild(ch);

    // ── Hit marker ────────────────────────────────────────────────────────
    e.hit = mk('div', 'dz-hitmark');
    wrap.appendChild(e.hit);

    // ── Vitals ────────────────────────────────────────────────────────────
    const vitals = mk('div', 'dz-vitals dz-glass');
    vitals.innerHTML = `
      <div class="dz-vlabel">Health</div>
      <div class="dz-track"><div class="dz-fill dz-hp-fill" id="_dzHp"></div></div>
      <div id="_dzArmRow" class="dz-arm-row">
        <div class="dz-vlabel" style="margin-top:4px">Armor</div>
        <div class="dz-track"><div class="dz-fill dz-arm-fill" id="_dzArm"></div></div>
      </div>
      <div class="dz-vlabel">Stamina</div>
      <div class="dz-track dz-stam-track"><div class="dz-fill dz-stam-fill" id="_dzStam"></div></div>
      <div class="dz-hp-num" id="_dzHpN">100</div>
    `;
    wrap.appendChild(vitals);

    // ── Ammo ──────────────────────────────────────────────────────────────
    const ammo = mk('div', 'dz-ammo dz-glass');
    ammo.innerHTML = `
      <div class="dz-wpname" id="_dzWpn">—</div>
      <div class="dz-clip"   id="_dzClip">--</div>
      <div class="dz-rsv"    id="_dzRsv">/ --</div>
      <div class="dz-rld"    id="_dzRld">RELOADING</div>
    `;
    wrap.appendChild(ammo);

    // ── Weapon quick-bar ──────────────────────────────────────────────────
    const wbar = mk('div', 'dz-wbar dz-glass');
    const ICONS = ['🔫','📻','💥','⚡','🎯','🏹','🔥','⚔️'];
    e.wslots = [];
    for (let i = 0; i < 8; i++) {
      const sl = mk('div', 'dz-wslot');
      sl.innerHTML = `<span class="dz-wicon">${ICONS[i]}</span><span class="dz-wnum">${i+1}</span>`;
      wbar.appendChild(sl);
      e.wslots.push(sl);
    }
    wrap.appendChild(wbar);

    // ── Wave info ─────────────────────────────────────────────────────────
    const winfo = mk('div', 'dz-winfo dz-glass');
    winfo.innerHTML = `
      <div class="dz-wlabel">Wave</div>
      <div class="dz-wnum" id="_dzWave">—</div>
      <div class="dz-zcnt" id="_dzZcnt"><span>Enemies </span><b id="_dzZN">—</b></div>
    `;
    wrap.appendChild(winfo);

    // ── Score ─────────────────────────────────────────────────────────────
    const score = mk('div', 'dz-score dz-glass');
    score.innerHTML = `
      <div class="dz-slabel">Score</div>
      <div class="dz-snum" id="_dzScore">0</div>
      <div class="dz-krow">Kills <b id="_dzKills">0</b></div>
    `;
    wrap.appendChild(score);

    // ── Minimap ───────────────────────────────────────────────────────────
    const mm = mk('div', 'dz-minimap');
    e.mmCv  = document.createElement('canvas');
    e.mmCv.width = e.mmCv.height = 140;
    e.mmCtx = e.mmCv.getContext('2d');
    mm.appendChild(e.mmCv);
    const mmlbl = mk('div', 'dz-mm-lbl');
    mmlbl.textContent = 'RADAR';
    mm.appendChild(mmlbl);
    wrap.appendChild(mm);

    // ── Compass ───────────────────────────────────────────────────────────
    const comp = mk('div', 'dz-compass');
    e.ctrack = mk('div', 'dz-ctrack');
    const CARDINALS = new Set(['N','E','S','W']);
    const MARKS = ['N','NE','E','SE','S','SW','W','NW'];
    for (let rep = 0; rep < 3; rep++) {
      for (const d of MARKS) {
        const m = mk('span', 'dz-cmark' + (CARDINALS.has(d) ? ' cardinal' : ''));
        m.textContent = d;
        e.ctrack.appendChild(m);
      }
    }
    const cpin = mk('div', 'dz-cpin');
    comp.append(e.ctrack, cpin);
    wrap.appendChild(comp);

    // ── Kill feed ─────────────────────────────────────────────────────────
    e.feed = mk('div', 'dz-feed');
    wrap.appendChild(e.feed);

    // ── Damage ring ───────────────────────────────────────────────────────
    e.dmgRing = mk('div', 'dz-dmg-ring');
    wrap.appendChild(e.dmgRing);

    // ── Wave banner ───────────────────────────────────────────────────────
    e.banner = mk('div', 'dz-banner');
    e.banner.innerHTML = `<div class="dz-bsub" id="_dzBSub"></div><div class="dz-bval" id="_dzBVal"></div>`;
    wrap.appendChild(e.banner);

    // ── Vignette ──────────────────────────────────────────────────────────
    e.vig = mk('div', 'dz-vig');
    wrap.appendChild(e.vig);

    // ── FPS counter ───────────────────────────────────────────────────────
    e.fps = mk('div', 'dz-fps');
    wrap.appendChild(e.fps);

    // Add to DOM, then cache IDs
    this.root.appendChild(wrap);

    e.hpBar   = document.getElementById('_dzHp');
    e.armBar  = document.getElementById('_dzArm');
    e.armRow  = document.getElementById('_dzArmRow');
    e.stamBar = document.getElementById('_dzStam');
    e.hpNum   = document.getElementById('_dzHpN');
    e.wpName  = document.getElementById('_dzWpn');
    e.clip    = document.getElementById('_dzClip');
    e.rsv     = document.getElementById('_dzRsv');
    e.rld     = document.getElementById('_dzRld');
    e.waveNum = document.getElementById('_dzWave');
    e.zN      = document.getElementById('_dzZN');
    e.scoreN  = document.getElementById('_dzScore');
    e.killsN  = document.getElementById('_dzKills');
    e.bSub    = document.getElementById('_dzBSub');
    e.bVal    = document.getElementById('_dzBVal');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  show()    { this._el.wrap.style.display = 'block'; this._visible = true; }
  hide()    { this._el.wrap.style.display = 'none';  this._visible = false; }
  showHUD() { this.show(); }
  hideHUD() { this.hide(); }

  setCamera(cam)             { this.camera = cam; }
  setZombies(positions)      { this._mmZombies = positions; }
  setPlayerPos(x, z, yaw)   { this._mmPlayer.x = x; this._mmPlayer.z = z; this._mmPlayer.yaw = yaw; }

  /** Add a kill-feed entry. */
  addKill(msg, headshot = false) {
    const el = mk('div', 'dz-fentry' + (headshot ? ' hs' : ''));
    el.innerHTML = _esc(msg) + (headshot ? '<span class="dz-hs-badge">⦿ HEADSHOT</span>' : '');
    this._el.feed.prepend(el);
    this._feed.unshift({ el, life: 4.5 });
    while (this._feed.length > 4) this._feed.pop().el.remove();
  }

  /** Flash the crosshair hit marker. */
  flashHitmarker(headshot = false) {
    this._el.hit.className = 'dz-hitmark' + (headshot ? ' hs' : '');
    this._el.hit.style.opacity = '1';
    this._hitTimer = 0.22;
  }

  /** Red vignette flash when player takes damage. */
  flashDamage() {
    const v = this._el.vig;
    v.classList.remove('hurt');
    void v.offsetWidth; // restart animation
    v.classList.add('hurt');
  }

  /**
   * Show a directional damage arrow around the crosshair.
   * @param {{ x:number, z:number }} fromPos  world position of attacker
   * @param {{ x:number, z:number }} playerPos
   * @param {number} cameraYaw  radians
   */
  showDamageArrow(fromPos, playerPos, cameraYaw) {
    const dx = fromPos.x - playerPos.x;
    const dz = fromPos.z - playerPos.z;
    const worldAngle = Math.atan2(dx, dz);
    const rel = worldAngle - cameraYaw;

    let slot = this._dmgPool.find(d => !d.active);
    if (!slot) {
      const el = mk('div', 'dz-dmg-arrow');
      this._el.dmgRing.appendChild(el);
      slot = { el, life: 0, active: false, angle: 0 };
      this._dmgPool.push(slot);
    }
    slot.life   = 2.0;
    slot.active = true;
    slot.angle  = rel;
    const R = 72;
    const ax = Math.sin(rel) * R, ay = -Math.cos(rel) * R;
    slot.el.style.transform = `translate(calc(-50% + ${ax}px), calc(-50% + ${ay}px)) rotate(${rel}rad)`;
    slot.el.style.opacity = '0.9';
  }

  announceWave(n) {
    this._el.bSub.textContent = 'Wave';
    this._el.bVal.textContent = n;
    this._el.bVal.style.color = '#e84040';
    this._el.banner.style.opacity = '1';
    this._bannerTimer = 3.0;
  }

  announceClear(n) {
    this._el.bSub.textContent = 'Wave Clear';
    this._el.bVal.textContent = `${n} ✓`;
    this._el.bVal.style.color = '#50e860';
    this._el.banner.style.opacity = '1';
    this._bannerTimer = 2.5;
  }

  /**
   * Main per-frame tick.
   * @param {import('../entities/player.js').Player} player
   * @param {number} wave
   * @param {number} kills
   * @param {number} score
   * @param {number} fps
   * @param {string} state
   * @param {number} zombiesAlive
   */
  tick(player, wave, kills, score, fps, state, zombiesAlive = 0) {
    if (!this._visible) return;
    const e = this._el;
    const dt = 0.016;

    e.fps.textContent = `${fps} fps`;
    if (!player) return;

    // Health
    const hp  = Math.max(0, player.health);
    const low = hp < 30;
    e.hpBar.style.width = `${hp}%`;
    e.hpBar.className   = 'dz-fill dz-hp-fill' + (low ? ' low' : '');
    e.hpNum.textContent = Math.ceil(hp);
    e.hpNum.className   = 'dz-hp-num' + (low ? ' low' : '');
    e.vig.className     = 'dz-vig' + (low ? ' low-hp' : '');

    // Armor (optional)
    const arm = player.armor ?? 0;
    e.armRow.style.display = arm > 0 ? 'block' : 'none';
    if (arm > 0) e.armBar.style.width = `${arm}%`;

    // Stamina
    e.stamBar.style.width = `${player.stamina ?? 100}%`;

    // Weapon / ammo
    const w = player.weapon ?? player.weapons?.[player.weaponIndex ?? 0];
    if (w) {
      e.wpName.textContent = w.name ?? '—';
      const clipTxt = w.clip >= 999 ? '∞' : String(w.clip);
      e.clip.textContent = clipTxt;
      e.clip.className   = 'dz-clip' + (w.clip === 0 && w.clip < 999 ? ' empty' : '');
      e.rsv.textContent  = w.reserve >= 999 ? '/ ∞' : `/ ${w.reserve}`;
      e.rld.style.display = w.reloading ? 'block' : 'none';

      const wi = player.weaponIndex ?? 0;
      e.wslots.forEach((sl, i) => sl.classList.toggle('active', i === wi));
    }

    // Wave / enemies
    e.waveNum.textContent = wave > 0 ? wave : '—';
    e.zN.textContent      = zombiesAlive;

    // Score
    e.scoreN.textContent = fmtScore(score);
    e.killsN.textContent = kills;

    // Minimap
    this._drawMinimap();

    // Compass
    if (this.camera) this._drawCompass();

    // Dynamic crosshair spread
    const speed  = player.velocity?.length() ?? 0;
    const target = Math.min(1, speed / 8) * 0.68;
    this._spread += (target - this._spread) * 0.16;
    this._updateCrosshair();

    // Timers
    if (this._hitTimer > 0) {
      this._hitTimer -= dt;
      if (this._hitTimer <= 0) e.hit.style.opacity = '0';
    }
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) e.banner.style.opacity = '0';
    }

    // Kill feed decay
    for (let i = this._feed.length - 1; i >= 0; i--) {
      const f = this._feed[i];
      f.life -= dt;
      if (f.life < 0.6) f.el.classList.add('fade');
      if (f.life <= 0)  { f.el.remove(); this._feed.splice(i, 1); }
    }

    // Damage arrows
    for (const a of this._dmgPool) {
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) { a.el.style.opacity = '0'; a.active = false; }
      else a.el.style.opacity = String(Math.min(0.9, a.life / 0.45).toFixed(2));
    }
  }

  // ── Private rendering ───────────────────────────────────────────────────────
  _updateCrosshair() {
    const gap = 5 + this._spread * 14;
    const e = this._el;
    e.chT.style.top  = `${-gap - 8}px`;
    e.chB.style.top  = `${gap}px`;
    e.chL.style.left = `${-gap - 8}px`;
    e.chR.style.left = `${gap}px`;
  }

  _drawMinimap() {
    const ctx = this._el.mmCtx;
    const W = 140, cx = 70, cy = 70;
    const SCALE = W / ARENA_SIZE;

    ctx.clearRect(0, 0, W, W);

    // Background
    ctx.fillStyle = 'rgba(3,6,8,0.93)';
    ctx.fillRect(0, 0, W, W);

    // Grid
    ctx.strokeStyle = 'rgba(25,45,35,0.55)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const v = i * W / 10;
      ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(W, v); ctx.stroke();
    }

    // Arena border
    ctx.strokeStyle = 'rgba(200,40,40,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, W - 2);

    // Zombie dots
    ctx.fillStyle = 'rgba(235,55,55,0.9)';
    for (const z of this._mmZombies) {
      if (!z) continue;
      const mx = cx + z.x * SCALE;
      const mz = cy + z.z * SCALE;
      if (mx < 1 || mx > W - 1 || mz < 1 || mz > W - 1) continue;
      ctx.beginPath();
      ctx.arc(mx, mz, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player triangle (direction-aware)
    const px = cx + this._mmPlayer.x * SCALE;
    const pz = cy + this._mmPlayer.z * SCALE;
    const yaw = this._mmPlayer.yaw;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px + sin * 7, pz - cos * 7);
    ctx.lineTo(px + cos * 4, pz + sin * 4);
    ctx.lineTo(px - cos * 4, pz - sin * 4);
    ctx.closePath();
    ctx.fill();

    // Edge vignette
    const grd = ctx.createRadialGradient(cx, cy, 48, cx, cy, 72);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, W);
  }

  _drawCompass() {
    // camera.rotation.order should be YXZ (set by player.js)
    // rotation.y is negative yaw in Three.js (left-positive convention)
    const yaw      = -this.camera.rotation.y;
    const bearing  = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const MARK_W   = 34;            // px per mark
    const ONE_ROT  = MARK_W * 8;   // 272px = one full revolution
    const centerPx = 90;            // half of 180px compass width

    // We have 3 repetitions (rep 0..2). Anchor rep 1 at center.
    const offset   = (bearing / (Math.PI * 2)) * ONE_ROT;
    const startX   = centerPx - offset - ONE_ROT + (MARK_W / 2);
    this._el.ctrack.style.transform = `translateX(${startX}px)`;
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

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Injected CSS ──────────────────────────────────────────────────────────────
const HUD_CSS = `
/* ─── HUD root ─── */
.dz-hud {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: 'Rubik', 'Segoe UI', system-ui, sans-serif;
  user-select: none;
}

/* ─── Glass panel ─── */
.dz-glass {
  background: rgba(5,8,11,0.74);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 6px;
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
}

/* ─── Crosshair ─── */
.dz-ch {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  width: 0; height: 0; pointer-events: none;
}
.dz-ch-p {
  position: absolute;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 0 4px rgba(0,0,0,0.9);
  border-radius: 1px;
  transition: top 0.06s linear, left 0.06s linear;
}
.dz-ch-t,.dz-ch-b { width: 2px; height: 8px; left: -1px; }
.dz-ch-l,.dz-ch-r { width: 8px; height: 2px; top: -1px; }
.dz-ch-dot { width: 3px; height: 3px; border-radius: 50%; margin: -1.5px; }
.dz-ch-t   { top: -13px; }
.dz-ch-b   { top:   5px; }
.dz-ch-l   { left: -13px; }
.dz-ch-r   { left:   5px; }

/* ─── Hit marker ─── */
.dz-hitmark {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  width: 28px; height: 28px;
  opacity: 0; pointer-events: none;
}
.dz-hitmark::before,.dz-hitmark::after {
  content: ''; position: absolute;
}
.dz-hitmark::before { width: 100%; height: 2px; top: 50%; left: 0; transform: translateY(-50%); background: #f04444; }
.dz-hitmark::after  { width: 2px; height: 100%; top: 0; left: 50%; transform: translateX(-50%); background: #f04444; }
.dz-hitmark.hs::before,.dz-hitmark.hs::after {
  background: #ffd700;
  box-shadow: 0 0 10px rgba(255,215,0,0.8);
}

/* ─── Vitals ─── */
.dz-vitals {
  position: absolute; bottom: 36px; left: 26px;
  width: 210px; padding: 12px 14px;
}
.dz-vlabel {
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(130,170,150,0.55); margin-bottom: 4px;
}
.dz-track {
  height: 8px; border-radius: 2px;
  background: rgba(0,0,0,0.65);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden; margin-bottom: 8px;
}
.dz-stam-track { height: 4px; }
.dz-fill { height: 100%; border-radius: 2px; transition: width 0.14s linear; }
.dz-hp-fill   { background: linear-gradient(90deg,#7a0e0e,#d82828); }
.dz-hp-fill.low { background: linear-gradient(90deg,#480606,#a81414); animation: dz-pulse .8s infinite; }
.dz-arm-fill  { background: linear-gradient(90deg,#0e3a5a,#28a0d8); }
.dz-stam-fill { background: linear-gradient(90deg,#0e4020,#28b840); }
.dz-hp-num {
  font-size: 34px; font-weight: 900; color: #f06060; line-height: 1;
  margin-top: 4px; text-shadow: 0 0 18px rgba(200,40,40,0.45);
  font-variant-numeric: tabular-nums;
}
.dz-hp-num.low { color: #ff1c1c; animation: dz-pulse .8s infinite; }
.dz-arm-row { overflow: hidden; }

@keyframes dz-pulse { 0%,100%{opacity:1} 50%{opacity:0.42} }

/* ─── Ammo ─── */
.dz-ammo {
  position: absolute; bottom: 36px; right: 26px;
  padding: 12px 16px; text-align: right; min-width: 148px;
}
.dz-wpname {
  font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(130,170,150,0.55); margin-bottom: 4px;
}
.dz-clip {
  font-size: 48px; font-weight: 900; color: #eceae6; line-height: 1;
  letter-spacing: 2px; font-variant-numeric: tabular-nums;
  font-family: 'Courier New', monospace;
}
.dz-clip.empty { color: #c02828; animation: dz-pulse .5s infinite; }
.dz-rsv { font-size: 14px; color: #5a7080; margin-top: 2px; letter-spacing: 1px; }
.dz-rld {
  font-size: 11px; color: #f5a020; letter-spacing: 2px;
  display: none; animation: dz-pulse .5s infinite;
}

/* ─── Weapon bar ─── */
.dz-wbar {
  position: absolute; bottom: 36px;
  left: 50%; transform: translateX(-50%);
  display: flex; gap: 4px; padding: 6px 8px;
}
.dz-wslot {
  width: 38px; height: 38px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.09);
  background: rgba(255,255,255,0.03);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: rgba(170,170,160,0.32);
  transition: all .15s ease;
}
.dz-wicon { font-size: 15px; line-height: 1; }
.dz-wnum  { font-size: 8px; margin-top: 1px; letter-spacing: 1px; }
.dz-wslot.active {
  border-color: rgba(210,45,45,0.88);
  background: rgba(155,22,22,0.30);
  color: #ece8e0;
  box-shadow: 0 0 12px rgba(210,45,45,0.28), inset 0 0 6px rgba(210,45,45,0.15);
}

/* ─── Wave info ─── */
.dz-winfo {
  position: absolute; top: 20px;
  left: 50%; transform: translateX(-50%);
  padding: 8px 22px; text-align: center; min-width: 155px;
}
.dz-wlabel {
  font-size: 9px; letter-spacing: 4px; text-transform: uppercase;
  color: rgba(90,170,120,0.65);
}
.dz-wnum {
  font-size: 28px; font-weight: 900; color: #72e048; line-height: 1.1;
  text-shadow: 0 0 20px rgba(80,200,55,0.45);
}
.dz-zcnt { font-size: 11px; color: rgba(225,85,65,0.9); margin-top: 2px; letter-spacing: .5px; }
.dz-zcnt b { font-weight: 800; }

/* ─── Score ─── */
.dz-score {
  position: absolute; top: 20px; right: 22px;
  padding: 8px 14px; text-align: right;
}
.dz-slabel { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: rgba(130,170,150,0.55); }
.dz-snum   { font-size: 24px; font-weight: 900; color: #eceae6; line-height: 1.2; font-variant-numeric: tabular-nums; }
.dz-krow   { font-size: 11px; color: #607080; margin-top: 2px; }
.dz-krow b { color: #a8b4be; }

/* ─── Minimap ─── */
.dz-minimap {
  position: absolute; top: 20px; left: 22px;
  width: 140px; height: 140px; border-radius: 4px;
  border: 1px solid rgba(210,45,45,0.45);
  box-shadow: 0 0 16px rgba(210,45,45,0.16), inset 0 0 28px rgba(0,0,0,0.5);
  overflow: hidden;
}
.dz-minimap canvas { display: block; width: 100%; height: 100%; }
.dz-mm-lbl {
  position: absolute; bottom: 3px; left: 0; right: 0;
  text-align: center; font-size: 8px; letter-spacing: 3px;
  color: rgba(210,45,45,0.45); text-transform: uppercase; pointer-events: none;
}

/* ─── Compass ─── */
.dz-compass {
  position: absolute; top: 100px;
  left: 50%; transform: translateX(-50%);
  width: 180px; height: 22px;
  background: rgba(5,8,11,0.72);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 3px; overflow: hidden;
}
.dz-ctrack {
  position: absolute; top: 0; left: 0; height: 100%;
  display: flex; align-items: center; white-space: nowrap;
  will-change: transform;
}
.dz-cmark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; font-size: 9px; letter-spacing: 1px;
  color: rgba(170,180,170,0.5);
}
.dz-cmark.cardinal { color: rgba(210,50,50,0.92); font-weight: 800; font-size: 10px; }
.dz-cpin {
  position: absolute; top: 0; left: 50%; bottom: 0;
  width: 1px; background: rgba(210,50,50,0.72); pointer-events: none;
}

/* ─── Kill feed ─── */
.dz-feed {
  position: absolute; top: 175px; right: 22px;
  width: 272px; pointer-events: none;
}
.dz-fentry {
  background: rgba(4,7,10,0.72);
  border-left: 2px solid rgba(210,45,45,0.82);
  padding: 5px 10px 5px 12px;
  margin-bottom: 4px; border-radius: 0 4px 4px 0;
  font-size: 12px; color: #a8b2ae;
  animation: dz-fin .22s ease;
  backdrop-filter: blur(4px);
  transition: opacity .4s, transform .4s;
}
.dz-fentry.hs { border-left-color: #ffd700; }
.dz-fentry.fade { opacity: 0; transform: translateX(14px); }
.dz-hs-badge {
  color: #ffd700; font-size: 9px; font-weight: 800;
  letter-spacing: 1.5px; margin-left: 6px;
}
@keyframes dz-fin { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:none} }

/* ─── Damage arrows ─── */
.dz-dmg-ring {
  position: absolute; top: 50%; left: 50%;
  width: 0; height: 0; pointer-events: none;
}
.dz-dmg-arrow {
  position: absolute; top: 0; left: 0;
  width: 0; height: 0; opacity: 0;
  pointer-events: none;
}
.dz-dmg-arrow::before {
  content: '';
  position: absolute;
  top: -20px; left: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 20px solid rgba(218,30,30,0.9);
  filter: drop-shadow(0 0 6px rgba(255,0,0,0.55));
}

/* ─── Banner ─── */
.dz-banner {
  position: absolute; top: 18%;
  left: 50%; transform: translateX(-50%);
  text-align: center; pointer-events: none;
  opacity: 0; transition: opacity .3s ease;
}
.dz-bsub {
  font-size: 10px; letter-spacing: 7px; text-transform: uppercase;
  color: rgba(120,185,145,0.72); margin-bottom: 6px;
}
.dz-bval {
  font-size: 62px; font-weight: 900; line-height: 1; letter-spacing: 5px;
  font-family: 'Creepster', 'Nosifer', cursive;
  text-shadow: 0 0 60px currentColor;
}

/* ─── Vignette ─── */
.dz-vig { position: fixed; inset: 0; pointer-events: none; }
.dz-vig.hurt { animation: dz-hurt .38s ease-out forwards; }
.dz-vig.low-hp { animation: dz-lohp 2s infinite; }
@keyframes dz-hurt {
  0% { box-shadow: inset 0 0 140px 44px rgba(218,18,18,.92); }
  100% { box-shadow: inset 0 0 0 0 rgba(218,18,18,0); }
}
@keyframes dz-lohp {
  0%,100% { box-shadow: inset 0 0 80px 22px rgba(180,12,12,.42); }
  50%     { box-shadow: inset 0 0 160px 55px rgba(180,12,12,.74); }
}

/* ─── FPS ─── */
.dz-fps {
  position: absolute; bottom: 3px; left: 5px;
  font-size: 9px; color: rgba(65,85,75,.52); letter-spacing: 1px;
}

/* ─── Mobile tweaks ─── */
@media (max-width: 640px) {
  .dz-vitals { width: 160px; }
  .dz-wbar   { display: none; }
  .dz-feed   { display: none; }
  .dz-compass{ display: none; }
}
`;

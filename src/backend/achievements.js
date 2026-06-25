/**
 * achievements.js — 55 achievements, toast notifications, gallery data
 *
 * Usage:
 *   const ach = new AchievementManager();
 *   ach.init(savedUnlocked);        // pass Set<string> of already-unlocked IDs
 *   ach.onUnlock = (a) => showToast(a);
 *   ach.check('kill', { type: 'runner', headshot: true, weapon: 'sniper', ... });
 *   ach.getAll();                   // → all achievements with .unlocked flag
 */

import { currentUser, fsSet } from './firebase-config.js';

const LS_KEY = 'dz-achievements';

// ─── Achievement catalogue ────────────────────────────────────────────────────
// Each achievement: { id, name, desc, category, icon, xpReward, gemReward }
export const ACHIEVEMENTS = [
  // ── Kills ────────────────────────────────────────────────────────────────────
  { id: 'first_blood',     name: 'First Blood',       desc: 'Get your first kill.',             category: 'kills',    icon: '🩸', xpReward: 100,  gemReward: 0  },
  { id: 'zombie_slayer',   name: 'Zombie Slayer',     desc: 'Kill 100 zombies.',                category: 'kills',    icon: '🧟', xpReward: 250,  gemReward: 0  },
  { id: 'exterminator',    name: 'Exterminator',      desc: 'Kill 500 zombies.',                category: 'kills',    icon: '☣️', xpReward: 500,  gemReward: 2  },
  { id: 'mass_murderer',   name: 'Mass Murderer',     desc: 'Kill 1,000 zombies.',              category: 'kills',    icon: '💀', xpReward: 1000, gemReward: 5  },
  { id: 'god_of_death',    name: 'God of Death',      desc: 'Kill 10,000 zombies.',             category: 'kills',    icon: '☠️', xpReward: 5000, gemReward: 25 },
  { id: 'rampage',         name: 'Rampage',           desc: 'Kill 10 zombies in 10 seconds.',   category: 'kills',    icon: '🔥', xpReward: 400,  gemReward: 2  },
  { id: 'killing_spree',   name: 'Killing Spree',     desc: 'Get 20 kills in a single wave.',   category: 'kills',    icon: '⚡', xpReward: 350,  gemReward: 1  },
  { id: 'combo_5',         name: 'Combo x5',          desc: 'Get a 5× kill combo.',             category: 'kills',    icon: '✖️', xpReward: 150,  gemReward: 0  },
  { id: 'combo_10',        name: 'Combo x10',         desc: 'Get a 10× kill combo.',            category: 'kills',    icon: '🌟', xpReward: 300,  gemReward: 1  },
  { id: 'combo_25',        name: 'Relentless',        desc: 'Get a 25× kill combo.',            category: 'kills',    icon: '💥', xpReward: 600,  gemReward: 3  },
  { id: 'combo_king',      name: 'Combo King',        desc: 'Get a 50× kill combo.',            category: 'kills',    icon: '👑', xpReward: 1500, gemReward: 10 },
  { id: 'boss_slayer',     name: 'Boss Slayer',       desc: 'Kill your first boss zombie.',     category: 'kills',    icon: '🗡️', xpReward: 500,  gemReward: 3  },

  // ── Headshots ────────────────────────────────────────────────────────────────
  { id: 'eagle_eye',       name: 'Eagle Eye',         desc: 'Get 10 headshots.',                category: 'headshots',icon: '🎯', xpReward: 150,  gemReward: 0  },
  { id: 'deadeye',         name: 'Deadeye',           desc: 'Get 50 headshots.',                category: 'headshots',icon: '🎳', xpReward: 300,  gemReward: 1  },
  { id: 'sniper_elite',    name: 'Sniper Elite',      desc: 'Get 100 headshots.',               category: 'headshots',icon: '🔭', xpReward: 500,  gemReward: 3  },
  { id: 'headhunter',      name: 'Headhunter',        desc: 'Get 500 headshots.',               category: 'headshots',icon: '🏹', xpReward: 1500, gemReward: 8  },
  { id: 'one_shot_streak', name: 'One Shot, One Kill',desc: '10 sniper headshots in a row.',   category: 'headshots',icon: '💫', xpReward: 800,  gemReward: 5  },

  // ── Waves ────────────────────────────────────────────────────────────────────
  { id: 'survivor_i',      name: 'Survivor I',        desc: 'Survive to wave 5.',               category: 'waves',    icon: '🛡️', xpReward: 200,  gemReward: 0  },
  { id: 'survivor_ii',     name: 'Survivor II',       desc: 'Survive to wave 10.',              category: 'waves',    icon: '🏅', xpReward: 400,  gemReward: 2  },
  { id: 'veteran',         name: 'Veteran',           desc: 'Survive to wave 25.',              category: 'waves',    icon: '🎖️', xpReward: 1000, gemReward: 8  },
  { id: 'legend',          name: 'Legend',            desc: 'Survive to wave 50.',              category: 'waves',    icon: '🏆', xpReward: 3000, gemReward: 25 },
  { id: 'untouchable',     name: 'Untouchable',       desc: 'Clear wave 5 with full health.',   category: 'waves',    icon: '✨', xpReward: 600,  gemReward: 3  },
  { id: 'iron_man',        name: 'Iron Man',          desc: 'Survive 3 waves without healing.', category: 'waves',    icon: '⚙️', xpReward: 700,  gemReward: 4  },
  { id: 'speed_demon',     name: 'Speed Demon',       desc: 'Clear a wave in under 30 seconds.',category: 'waves',    icon: '⚡', xpReward: 500,  gemReward: 2  },
  { id: 'blitz_clear',     name: 'Blitz!',            desc: 'Clear a wave in under 20 seconds.',category: 'waves',    icon: '🌪️', xpReward: 800,  gemReward: 5  },
  { id: 'no_damage_wave',  name: 'Flawless',          desc: 'Complete a wave without taking damage.', category: 'waves', icon: '💠', xpReward: 400, gemReward: 2 },

  // ── Weapons ──────────────────────────────────────────────────────────────────
  { id: 'pistol_pete',     name: 'Pistol Pete',       desc: '100 kills with Pistol.',           category: 'weapons',  icon: '🔫', xpReward: 250,  gemReward: 1  },
  { id: 'spray_pray',      name: 'Spray & Pray',      desc: '200 kills with SMG.',              category: 'weapons',  icon: '💨', xpReward: 300,  gemReward: 1  },
  { id: 'buckshot',        name: 'Buckshot',          desc: '100 kills with Shotgun.',          category: 'weapons',  icon: '💥', xpReward: 250,  gemReward: 1  },
  { id: 'assault_expert',  name: 'Assault Expert',    desc: '300 kills with Assault Rifle.',    category: 'weapons',  icon: '🪖', xpReward: 350,  gemReward: 2  },
  { id: 'long_shot',       name: 'Long Shot',         desc: '100 kills with Sniper Rifle.',     category: 'weapons',  icon: '🔭', xpReward: 300,  gemReward: 2  },
  { id: 'crossbowman',     name: 'Crossbowman',       desc: '50 kills with Crossbow.',          category: 'weapons',  icon: '🏹', xpReward: 300,  gemReward: 2  },
  { id: 'pyromaniac',      name: 'Pyromaniac',        desc: '100 kills with Flamethrower.',     category: 'weapons',  icon: '🔥', xpReward: 400,  gemReward: 3  },
  { id: 'katana_master',   name: 'Katana Master',     desc: '50 kills with Katana.',            category: 'weapons',  icon: '⚔️', xpReward: 400,  gemReward: 3  },
  { id: 'jack_of_all',     name: 'Jack of All Trades',desc: 'Kill with every weapon.',          category: 'weapons',  icon: '🎭', xpReward: 1000, gemReward: 8  },

  // ── Accuracy ─────────────────────────────────────────────────────────────────
  { id: 'sharpshooter',    name: 'Sharpshooter',      desc: '80%+ accuracy in a wave (≥10 shots).', category: 'accuracy', icon: '🎯', xpReward: 400, gemReward: 2 },
  { id: 'no_miss',         name: 'Perfect Precision', desc: '100% accuracy in a wave (≥10 shots).', category: 'accuracy', icon: '🌠', xpReward: 800, gemReward: 5 },

  // ── Score / Economy ───────────────────────────────────────────────────────────
  { id: 'high_roller',     name: 'High Roller',       desc: 'Score 10,000 in one run.',         category: 'score',    icon: '💰', xpReward: 300,  gemReward: 1  },
  { id: 'score_machine',   name: 'Score Machine',     desc: 'Score 50,000 in one run.',         category: 'score',    icon: '💎', xpReward: 1000, gemReward: 5  },
  { id: 'shopaholic',      name: 'Shopaholic',        desc: 'Buy 10 weapon upgrades.',          category: 'score',    icon: '🛒', xpReward: 300,  gemReward: 1  },
  { id: 'penny_pincher',   name: 'Penny Pincher',     desc: 'Reach wave 10 without spending coins.', category: 'score', icon: '🪙', xpReward: 500, gemReward: 2  },

  // ── Survival ─────────────────────────────────────────────────────────────────
  { id: 'lucky_escape',    name: 'Lucky Escape',      desc: 'Survive with under 5 HP.',         category: 'survival', icon: '🍀', xpReward: 400,  gemReward: 2  },
  { id: 'comeback_kid',    name: 'Comeback Kid',      desc: 'Heal from below 10 HP to full.',   category: 'survival', icon: '💪', xpReward: 350,  gemReward: 1  },
  { id: 'exploder_surviv', name: 'Too Close!',        desc: 'Survive an Exploder explosion.',   category: 'survival', icon: '💣', xpReward: 300,  gemReward: 1  },
  { id: 'lone_wolf',       name: 'Lone Wolf',         desc: 'Reach wave 10 without buying upgrades.', category: 'survival', icon: '🐺', xpReward: 600, gemReward: 3 },

  // ── Social / Meta ────────────────────────────────────────────────────────────
  { id: 'daily_warrior',   name: 'Daily Warrior',     desc: 'Complete 3 daily challenges.',     category: 'meta',     icon: '📅', xpReward: 500,  gemReward: 3  },
  { id: 'streak_week',     name: 'Week Warrior',      desc: 'Log in 7 days in a row.',          category: 'meta',     icon: '📆', xpReward: 800,  gemReward: 5  },
  { id: 'streak_month',    name: 'Dedicated',         desc: 'Log in 30 days in a row.',         category: 'meta',     icon: '🗓️', xpReward: 3000, gemReward: 20 },
  { id: 'social_share',    name: 'Social Butterfly',  desc: 'Share your score.',                category: 'meta',     icon: '📤', xpReward: 200,  gemReward: 1  },
  { id: 'top_100',         name: 'Top 100',           desc: 'Reach the global top 100.',        category: 'meta',     icon: '🏅', xpReward: 1500, gemReward: 10 },
  { id: 'prestige_one',    name: 'Ascended',          desc: 'Reach Prestige 1.',                category: 'meta',     icon: '⭐', xpReward: 5000, gemReward: 30 },
  { id: 'maxed_level',     name: 'Level 100',         desc: 'Reach player level 100.',          category: 'meta',     icon: '🌟', xpReward: 5000, gemReward: 20 },
  { id: 'night_owl',       name: 'Night Owl',         desc: 'Play past midnight.',              category: 'meta',     icon: '🦉', xpReward: 200,  gemReward: 1  },
  { id: 'long_session',    name: 'Marathon Runner',   desc: 'Play for 30 minutes total.',       category: 'meta',     icon: '⏱️', xpReward: 400,  gemReward: 2  },
];

const ACH_MAP = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

// ─── Toast notification ────────────────────────────────────────────────────────
let _toastCSS = false;
function _injectToastCSS() {
  if (_toastCSS) return;
  _toastCSS = true;
  const s = document.createElement('style');
  s.textContent = `
    #dz-toast-container {
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      display:flex; flex-direction:column-reverse; align-items:center;
      gap:8px; z-index:9999; pointer-events:none;
    }
    .dz-ach-toast {
      display:flex; align-items:center; gap:12px;
      padding:12px 20px; min-width:280px; max-width:420px;
      background:linear-gradient(135deg,rgba(8,11,18,0.96),rgba(16,22,36,0.95));
      border:1px solid rgba(255,210,0,0.35);
      border-left:4px solid #f5c518;
      border-radius:8px;
      box-shadow:0 4px 32px rgba(0,0,0,0.7),0 0 20px rgba(245,197,24,0.15);
      backdrop-filter:blur(12px);
      animation:dz-toast-in 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards;
      font-family:'Rubik','Segoe UI',sans-serif;
    }
    .dz-ach-toast.dz-toast-out { animation:dz-toast-out 0.3s ease forwards; }
    .dz-ach-toast .dz-t-icon { font-size:1.8rem; flex-shrink:0; }
    .dz-ach-toast .dz-t-body { display:flex; flex-direction:column; gap:2px; }
    .dz-ach-toast .dz-t-label { font-size:0.65rem; letter-spacing:0.15em; text-transform:uppercase; color:#f5c518; }
    .dz-ach-toast .dz-t-name  { font-size:1rem; font-weight:700; color:#f0ece4; }
    .dz-ach-toast .dz-t-desc  { font-size:0.75rem; color:#8a9090; }
    .dz-ach-toast .dz-t-reward{ font-size:0.72rem; color:#a3e635; font-weight:600; margin-top:2px; }
    @keyframes dz-toast-in  { from{opacity:0;transform:translateY(20px) scale(0.9)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes dz-toast-out { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(-14px) scale(0.9)} }
  `;
  document.head.appendChild(s);
}

function _getToastContainer() {
  let c = document.getElementById('dz-toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'dz-toast-container'; document.body.appendChild(c); }
  return c;
}

export function showAchievementToast(achievement) {
  _injectToastCSS();
  const container = _getToastContainer();
  const el = document.createElement('div');
  el.className = 'dz-ach-toast';
  const rewardText = [
    achievement.xpReward  ? `+${achievement.xpReward} XP` : '',
    achievement.gemReward ? `+${achievement.gemReward} 💎` : '',
  ].filter(Boolean).join('  ');
  el.innerHTML = `
    <div class="dz-t-icon">${achievement.icon}</div>
    <div class="dz-t-body">
      <span class="dz-t-label">Achievement Unlocked!</span>
      <span class="dz-t-name">${achievement.name}</span>
      <span class="dz-t-desc">${achievement.desc}</span>
      ${rewardText ? `<span class="dz-t-reward">${rewardText}</span>` : ''}
    </div>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('dz-toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 4500);
}

// ─── AchievementManager ───────────────────────────────────────────────────────
export class AchievementManager {
  constructor() {
    this._unlocked = new Set();       // Set<achievementId>
    this._session  = {
      killsThisSession:    0,
      headshotsThisSession:0,
      sniperHSStreak:      0,
      comboCount:          0,
      peakCombo:           0,
      weaponsUsed:         new Set(),
      wavesSurvived:       0,
      upgradesBought:      0,
      coinsSpent:          0,
      shareCount:          0,
      healthHealed:        0,
      wasTinyHP:           false,     // was at < 10 HP this wave
      waveDamage:          0,
      waveKills:           0,
      waveStart:           0,
      waveShots:           0,
      waveHits:            0,
      healedFromLow:       false,
      sniperHSInARow:      0,
    };
    this.onUnlock = null;  // (achievement, progression) => void
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  async init() {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { (JSON.parse(raw) ?? []).forEach(id => this._unlocked.add(id)); } catch {}
    }
    const user = currentUser();
    if (user) {
      try {
        const { currentUser: _u, fsGet: _g } = await import('./firebase-config.js');
        const cloud = await _g(`users/${user.uid}/achievements/list`);
        if (cloud?.ids) cloud.ids.forEach(id => this._unlocked.add(id));
      } catch {}
    }
  }

  _save() {
    localStorage.setItem(LS_KEY, JSON.stringify([...this._unlocked]));
  }

  async _syncCloud() {
    const user = currentUser();
    if (!user) return;
    await fsSet(`users/${user.uid}/achievements/list`, { ids: [...this._unlocked] }).catch(() => {});
  }

  // ─── Unlock ────────────────────────────────────────────────────────────────
  _unlock(id, progression = null) {
    if (this._unlocked.has(id)) return;
    const ach = ACH_MAP.get(id);
    if (!ach) return;
    this._unlocked.add(id);
    this._save();
    this._syncCloud().catch(() => {});

    showAchievementToast(ach);

    if (progression) {
      progression.addXP(ach.xpReward);
      if (ach.gemReward) progression.addGems(ach.gemReward);
    }

    this.onUnlock?.(ach, progression);
  }

  // ─── Event checks ──────────────────────────────────────────────────────────
  // eventName: 'kill' | 'wave_start' | 'wave_clear' | 'player_hurt' | 'player_heal'
  //            'upgrade_buy' | 'share' | 'login' | 'level_up' | 'prestige'
  //            'boss_kill' | 'exploder_survived' | 'score_update' | 'combo_update'
  check(eventName, data = {}, progression = null) {
    const s = this._session;
    const u = (id) => this._unlock(id, progression);

    if (eventName === 'kill') {
      s.killsThisSession++;
      s.waveKills++;
      if (data.weapon) s.weaponsUsed.add(data.weapon);

      if (data.headshot) {
        s.headshotsThisSession++;
        s.sniperHSInARow = data.weapon === 'sniper' ? s.sniperHSInARow + 1 : 0;
        if (data.weapon !== 'sniper') s.sniperHSStreak = 0;
      } else {
        s.sniperHSInARow = 0;
      }

      const totalKills = progression?.stats.totalKills ?? s.killsThisSession;
      const totalHS    = progression?.stats.totalHeadshots ?? s.headshotsThisSession;

      if (totalKills >= 1)     u('first_blood');
      if (totalKills >= 100)   u('zombie_slayer');
      if (totalKills >= 500)   u('exterminator');
      if (totalKills >= 1000)  u('mass_murderer');
      if (totalKills >= 10000) u('god_of_death');
      if (s.waveKills >= 20)   u('killing_spree');

      if (totalHS >= 10)  u('eagle_eye');
      if (totalHS >= 50)  u('deadeye');
      if (totalHS >= 100) u('sniper_elite');
      if (totalHS >= 500) u('headhunter');
      if (s.sniperHSInARow >= 10) u('one_shot_streak');

      // Weapon mastery milestones
      if (data.weapon) {
        const m = progression?.getMastery(data.weapon);
        if (m) {
          if (data.weapon === 'pistol'       && m.kills >= 100)  u('pistol_pete');
          if (data.weapon === 'smg'          && m.kills >= 200)  u('spray_pray');
          if (data.weapon === 'shotgun'      && m.kills >= 100)  u('buckshot');
          if (data.weapon === 'ar'           && m.kills >= 300)  u('assault_expert');
          if (data.weapon === 'sniper'       && m.kills >= 100)  u('long_shot');
          if (data.weapon === 'crossbow'     && m.kills >= 50)   u('crossbowman');
          if (data.weapon === 'flamethrower' && m.kills >= 100)  u('pyromaniac');
          if (data.weapon === 'katana'       && m.kills >= 50)   u('katana_master');
        }
        if (s.weaponsUsed.size >= 8) u('jack_of_all');
      }

      // 10-kill-in-10s rampage (tracked via timestamps)
      if (!s._rampageKills) s._rampageKills = [];
      const now = Date.now();
      s._rampageKills.push(now);
      s._rampageKills = s._rampageKills.filter(t => now - t < 10000);
      if (s._rampageKills.length >= 10) u('rampage');
    }

    if (eventName === 'combo_update') {
      s.comboCount = data.combo ?? 0;
      if (s.comboCount > s.peakCombo) s.peakCombo = s.comboCount;
      if (s.peakCombo >= 5)  u('combo_5');
      if (s.peakCombo >= 10) u('combo_10');
      if (s.peakCombo >= 25) u('combo_25');
      if (s.peakCombo >= 50) u('combo_king');
    }

    if (eventName === 'boss_kill') {
      u('boss_slayer');
    }

    if (eventName === 'wave_start') {
      s.waveKills   = 0;
      s.waveDamage  = 0;
      s.waveShots   = 0;
      s.waveHits    = 0;
      s.waveStart   = Date.now();
      s.wasTinyHP   = false;
    }

    if (eventName === 'wave_clear') {
      const waveNum  = data.wave  ?? 0;
      const waveTime = (Date.now() - s.waveStart) / 1000;
      const accuracy = s.waveShots > 0 ? s.waveHits / s.waveShots : 0;
      s.wavesSurvived = waveNum;

      if (waveNum >= 5)  u('survivor_i');
      if (waveNum >= 10) u('survivor_ii');
      if (waveNum >= 25) u('veteran');
      if (waveNum >= 50) u('legend');
      if (waveNum >= 5  && data.healthFull) u('untouchable');
      if (s.waveDamage === 0)               u('no_damage_wave');
      if (waveTime <= 30)                   u('speed_demon');
      if (waveTime <= 20)                   u('blitz_clear');
      if (accuracy >= 0.8  && s.waveShots >= 10) u('sharpshooter');
      if (accuracy >= 1.0  && s.waveShots >= 10) u('no_miss');
    }

    if (eventName === 'player_hurt') {
      s.waveDamage += data.amount ?? 0;
      const hp = data.currentHP ?? 100;
      if (hp < 10) s.wasTinyHP = true;
      if (hp <= 5) u('lucky_escape');
    }

    if (eventName === 'player_heal') {
      if (s.wasTinyHP && data.currentHP >= 90) u('comeback_kid');
    }

    if (eventName === 'shot_fired') {
      s.waveShots++;
    }

    if (eventName === 'shot_hit') {
      s.waveHits++;
    }

    if (eventName === 'upgrade_buy') {
      s.upgradesBought++;
      if (s.upgradesBought >= 10) u('shopaholic');
    }

    if (eventName === 'score_update') {
      const sc = data.score ?? 0;
      if (sc >= 10000) u('high_roller');
      if (sc >= 50000) u('score_machine');
    }

    if (eventName === 'share') {
      s.shareCount++;
      u('social_share');
    }

    if (eventName === 'exploder_survived') {
      u('exploder_surviv');
    }

    if (eventName === 'login') {
      const streak = data.streak ?? 0;
      const hour   = new Date().getHours();
      if (hour === 0 || hour === 23) u('night_owl');
      if (streak >= 7)  u('streak_week');
      if (streak >= 30) u('streak_month');
      const totalTime = progression?.stats.totalTimePlayed ?? 0;
      if (totalTime >= 1800) u('long_session');
    }

    if (eventName === 'level_up') {
      if (data.level >= 100) u('maxed_level');
    }

    if (eventName === 'prestige') {
      u('prestige_one');
    }

    if (eventName === 'leaderboard_rank') {
      if ((data.rank ?? Infinity) <= 100) u('top_100');
    }

    if (eventName === 'daily_challenge_complete') {
      if (data.allThreeComplete) u('daily_warrior');
    }
  }

  // ─── Query helpers ────────────────────────────────────────────────────────
  getAll() {
    return ACHIEVEMENTS.map(a => ({ ...a, unlocked: this._unlocked.has(a.id) }));
  }

  getByCategory(cat) {
    return this.getAll().filter(a => a.category === cat);
  }

  isUnlocked(id) { return this._unlocked.has(id); }

  getProgress() {
    const total    = ACHIEVEMENTS.length;
    const unlocked = this._unlocked.size;
    return { unlocked, total, pct: Math.round((unlocked / total) * 100) };
  }
}

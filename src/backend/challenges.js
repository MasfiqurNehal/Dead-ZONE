/**
 * challenges.js — Daily challenges system (3/day, streak, big reward)
 *
 * Challenges are deterministically generated from the current date seed,
 * so all players always see the same 3 challenges each day.
 * Progress is saved to localStorage and optionally synced to Firestore.
 */

import { currentUser, fsGet, fsSet } from './firebase-config.js';

const LS_KEY       = 'dz-challenges';
const STREAK_KEY   = 'dz-challenge-streak';

// ─── Challenge templates ──────────────────────────────────────────────────────
// type matches eventName used in achievements.check() / challenges.progress()
const TEMPLATES = [
  // Kill challenges
  { id: 'kill_50',       type: 'kills',      param: null,        goal: 50,  desc: 'Kill 50 zombies',                   reward: { coins: 150, xp: 200 } },
  { id: 'kill_100',      type: 'kills',      param: null,        goal: 100, desc: 'Kill 100 zombies',                  reward: { coins: 250, xp: 400 } },
  { id: 'kill_200',      type: 'kills',      param: null,        goal: 200, desc: 'Kill 200 zombies',                  reward: { coins: 500, xp: 800 } },
  { id: 'kill_runners',  type: 'kills',      param: 'runner',    goal: 30,  desc: 'Kill 30 Runners',                   reward: { coins: 200, xp: 300 } },
  { id: 'kill_brutes',   type: 'kills',      param: 'brute',     goal: 10,  desc: 'Kill 10 Brutes',                    reward: { coins: 300, xp: 400 } },
  { id: 'kill_boss',     type: 'kills',      param: 'boss',      goal: 1,   desc: 'Slay a Boss zombie',                reward: { coins: 400, xp: 600, gems: 2 } },
  { id: 'kill_exploders',type: 'kills',      param: 'exploder',  goal: 15,  desc: 'Kill 15 Exploders',                 reward: { coins: 300, xp: 450 } },

  // Headshot challenges
  { id: 'hs_20',         type: 'headshots',  param: null,        goal: 20,  desc: 'Get 20 headshots',                  reward: { coins: 200, xp: 300 } },
  { id: 'hs_50',         type: 'headshots',  param: null,        goal: 50,  desc: 'Get 50 headshots',                  reward: { coins: 350, xp: 500 } },
  { id: 'hs_sniper_10',  type: 'headshots',  param: 'sniper',    goal: 10,  desc: 'Get 10 sniper headshots',           reward: { coins: 300, xp: 450, gems: 1 } },

  // Wave challenges
  { id: 'wave_10',       type: 'waves',      param: null,        goal: 10,  desc: 'Survive to Wave 10',                reward: { coins: 300, xp: 500 } },
  { id: 'wave_15',       type: 'waves',      param: null,        goal: 15,  desc: 'Survive to Wave 15',                reward: { coins: 500, xp: 800, gems: 2 } },
  { id: 'wave_pistol',   type: 'waves_weapon', param: 'pistol',  goal: 5,   desc: 'Reach Wave 5 using only Pistol',    reward: { coins: 400, xp: 600, gems: 1 } },

  // Accuracy challenges
  { id: 'accuracy_70',   type: 'accuracy',   param: null,        goal: 70,  desc: 'Finish a wave with 70%+ accuracy',  reward: { coins: 200, xp: 300 } },
  { id: 'accuracy_90',   type: 'accuracy',   param: null,        goal: 90,  desc: 'Finish a wave with 90%+ accuracy',  reward: { coins: 400, xp: 600, gems: 1 } },

  // Score challenges
  { id: 'score_5k',      type: 'score',      param: null,        goal: 5000,  desc: 'Score 5,000 points',             reward: { coins: 150, xp: 200 } },
  { id: 'score_25k',     type: 'score',      param: null,        goal: 25000, desc: 'Score 25,000 points',            reward: { coins: 400, xp: 600 } },

  // Weapon-specific kills
  { id: 'shotgun_20',    type: 'weapon_kills', param: 'shotgun', goal: 20,  desc: 'Get 20 kills with Shotgun',         reward: { coins: 200, xp: 300 } },
  { id: 'flamer_30',     type: 'weapon_kills', param: 'flamethrower', goal: 30, desc: 'Burn 30 zombies',              reward: { coins: 300, xp: 450 } },
  { id: 'katana_10',     type: 'weapon_kills', param: 'katana',  goal: 10,  desc: 'Get 10 kills with Katana',          reward: { coins: 250, xp: 350 } },
  { id: 'crossbow_15',   type: 'weapon_kills', param: 'crossbow',goal: 15,  desc: 'Get 15 kills with Crossbow',        reward: { coins: 250, xp: 350 } },
  { id: 'no_damage',     type: 'no_damage',  param: null,        goal: 1,   desc: 'Complete 1 wave without damage',    reward: { coins: 300, xp: 400, gems: 1 } },
  { id: 'combo_15',      type: 'combo',      param: null,        goal: 15,  desc: 'Achieve a 15× kill combo',          reward: { coins: 250, xp: 350 } },
];

// ─── Seeded RNG (for deterministic daily selection) ──────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

function dateToSeed(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  return dateStr.split('-').reduce((acc, n) => acc * 100 + parseInt(n, 10), 0);
}

function getDailyChallenges(dateStr) {
  const rng  = seededRng(dateToSeed(dateStr));
  const pool = [...TEMPLATES];
  const chosen = [];
  while (chosen.length < 3 && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

// ─── DailyChallenge class ─────────────────────────────────────────────────────
export class DailyChallenge {
  constructor() {
    this._today     = '';
    this._templates = [];
    this._progress  = {};   // { [id]: number }
    this._completed = new Set();
    this._streak    = 0;
    this._allDoneToday = false;
    this.onComplete   = null;  // (challenge) => void
    this.onAllComplete = null; // (reward) => void
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  async init() {
    this._today     = new Date().toISOString().slice(0, 10);
    this._templates = getDailyChallenges(this._today);

    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.date === this._today) {
          this._progress  = saved.progress  ?? {};
          this._completed = new Set(saved.completed ?? []);
          this._allDoneToday = saved.allDone ?? false;
        }
        // else: new day, fresh progress
      } catch {}
    }

    this._streak = parseInt(localStorage.getItem(STREAK_KEY) ?? '0', 10);

    // Non-blocking cloud sync
    this._syncFromCloud().catch(() => {});
  }

  async _syncFromCloud() {
    const user = currentUser();
    if (!user) return;
    const cloud = await fsGet(`users/${user.uid}/challenges/${this._today}`);
    if (!cloud) return;
    // Merge: take highest progress values
    for (const [id, val] of Object.entries(cloud.progress ?? {})) {
      this._progress[id] = Math.max(this._progress[id] ?? 0, val);
    }
    (cloud.completed ?? []).forEach(id => this._completed.add(id));
    if (cloud.allDone) this._allDoneToday = true;
    this._saveLocal();
  }

  _saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      date:      this._today,
      progress:  this._progress,
      completed: [...this._completed],
      allDone:   this._allDoneToday,
    }));
  }

  async _saveCloud() {
    const user = currentUser();
    if (!user) return;
    await fsSet(`users/${user.uid}/challenges/${this._today}`, {
      progress:  this._progress,
      completed: [...this._completed],
      allDone:   this._allDoneToday,
    }).catch(() => {});
  }

  // ─── Progress ─────────────────────────────────────────────────────────────
  // Returns array of newly-completed challenge objects
  progress(type, param, amount = 1, extraData = {}) {
    const newlyDone = [];

    for (const tpl of this._templates) {
      if (this._completed.has(tpl.id)) continue;

      let match = false;
      if (type === 'kills'        && tpl.type === 'kills'        && (tpl.param === null || tpl.param === param)) match = true;
      if (type === 'headshots'    && tpl.type === 'headshots'    && (tpl.param === null || tpl.param === param)) match = true;
      if (type === 'weapon_kills' && tpl.type === 'weapon_kills' && tpl.param === param)  match = true;
      if (type === 'waves'        && tpl.type === 'waves'        && amount >= tpl.goal)   match = true;
      if (type === 'waves_weapon' && tpl.type === 'waves_weapon' && tpl.param === param && amount >= tpl.goal) match = true;
      if (type === 'accuracy'     && tpl.type === 'accuracy'     && amount >= tpl.goal)   match = true;
      if (type === 'score'        && tpl.type === 'score'        && amount >= tpl.goal)   match = true;
      if (type === 'no_damage'    && tpl.type === 'no_damage')   match = true;
      if (type === 'combo'        && tpl.type === 'combo'        && amount >= tpl.goal)   match = true;

      if (!match) continue;

      // Absolute types (waves, accuracy, score) — set directly
      const isAbsolute = ['waves','waves_weapon','accuracy','score','combo','no_damage'].includes(tpl.type);
      if (isAbsolute) {
        this._progress[tpl.id] = Math.max(this._progress[tpl.id] ?? 0, amount);
      } else {
        this._progress[tpl.id] = (this._progress[tpl.id] ?? 0) + amount;
      }

      if (this._progress[tpl.id] >= tpl.goal && !this._completed.has(tpl.id)) {
        this._completed.add(tpl.id);
        newlyDone.push(tpl);
        this.onComplete?.(tpl);
      }
    }

    if (newlyDone.length) {
      this._saveLocal();
      this._saveCloud().catch(() => {});
    }

    // Check if all 3 done
    if (!this._allDoneToday && this._completed.size >= 3) {
      this._allDoneToday = true;
      this._updateStreak();
      const allDoneReward = { coins: 500, gems: 5, xp: 1000, label: 'All Daily Challenges Complete!' };
      this.onAllComplete?.(allDoneReward);
    }

    return newlyDone;
  }

  _updateStreak() {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const lastDate  = localStorage.getItem('dz-challenge-last-complete') ?? '';
    this._streak = (lastDate === yesterday) ? this._streak + 1 : 1;
    localStorage.setItem(STREAK_KEY, String(this._streak));
    localStorage.setItem('dz-challenge-last-complete', this._today);
  }

  // ─── Query ────────────────────────────────────────────────────────────────
  getToday() {
    return this._templates.map(tpl => ({
      ...tpl,
      progress:  this._progress[tpl.id] ?? 0,
      completed: this._completed.has(tpl.id),
      pct: Math.min(100, Math.round(((this._progress[tpl.id] ?? 0) / tpl.goal) * 100)),
    }));
  }

  getStreak()        { return this._streak; }
  isAllDoneToday()   { return this._allDoneToday; }
  completedCount()   { return this._completed.size; }

  getTimeUntilReset() {
    const now     = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ms = midnight - now;
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }
}

/**
 * progression.js — XP, levels, prestige, currency, weapon mastery, battle pass
 *
 * Works fully offline (localStorage) with optional Firestore sync when
 * firebase-config.js is initialised and the user is signed in.
 */

import { currentUser, fsGet, fsSet } from './firebase-config.js';

// ─── XP curve ─────────────────────────────────────────────────────────────────
// xpRequired(n) = XP needed to advance FROM level n TO level n+1
// Uses quadratic: 100n + 50n²   (level 1 → 2 needs 150 XP, level 10 → 11 needs 6000, etc.)
function xpRequired(level) {
  return 100 * level + 50 * level * level;
}

export const MAX_LEVEL    = 100;
export const PRESTIGE_MAX = 10;

// Pre-compute cumulative XP table so rank lookups are O(1)
const XP_TABLE = (() => {
  const t = [0, 0]; // index 0 unused; t[n] = total XP needed to REACH level n
  let acc = 0;
  for (let n = 1; n < MAX_LEVEL + 1; n++) {
    acc += xpRequired(n);
    t[n + 1] = acc;
  }
  return t;
})();

function levelFromTotalXP(totalXP) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && totalXP >= XP_TABLE[lvl + 1]) lvl++;
  return lvl;
}

// ─── Weapon mastery ───────────────────────────────────────────────────────────
const MASTERY_THRESHOLDS = [0, 500, 1500, 3500, 7500, 15000]; // 5 mastery levels

// ─── Battle pass ──────────────────────────────────────────────────────────────
const BP_TIERS         = 100;
const BP_XP_PER_TIER   = 1000;

const BP_FREE_REWARDS = {
  10:  { type: 'coins',    amount: 200 },
  20:  { type: 'coins',    amount: 300 },
  30:  { type: 'gem',      amount: 5 },
  40:  { type: 'coins',    amount: 500 },
  50:  { type: 'gem',      amount: 10 },
  60:  { type: 'cosmetic', name: 'Bloody Pistol Skin' },
  70:  { type: 'coins',    amount: 750 },
  80:  { type: 'gem',      amount: 20 },
  90:  { type: 'cosmetic', name: 'Toxic Camo Pack' },
  100: { type: 'cosmetic', name: 'Prestige Banner' },
};

const BP_PREMIUM_REWARDS = {
  5:  { type: 'cosmetic', name: 'Neon SMG Skin' },
  10: { type: 'gem',      amount: 15 },
  15: { type: 'cosmetic', name: 'Golden Shotgun Skin' },
  20: { type: 'coins',    amount: 500 },
  25: { type: 'cosmetic', name: 'Demon AR Skin' },
  30: { type: 'gem',      amount: 25 },
  35: { type: 'cosmetic', name: 'Shadow Sniper Skin' },
  40: { type: 'coins',    amount: 1000 },
  45: { type: 'cosmetic', name: 'Void Crossbow Skin' },
  50: { type: 'cosmetic', name: 'Hellfire Flamethrower Skin' },
  55: { type: 'gem',      amount: 40 },
  60: { type: 'cosmetic', name: 'Reaper Katana Skin' },
  65: { type: 'coins',    amount: 1500 },
  70: { type: 'cosmetic', name: 'Zombie Hunter Spray' },
  75: { type: 'gem',      amount: 60 },
  80: { type: 'cosmetic', name: 'Blood Moon Weapon Pack' },
  85: { type: 'coins',    amount: 2000 },
  90: { type: 'gem',      amount: 100 },
  95: { type: 'cosmetic', name: 'Ghost Operator Suit' },
  100:{ type: 'cosmetic', name: 'DEAD ZONE ELITE Banner' },
};

// ─── Daily login rewards (7-day cycle) ────────────────────────────────────────
const DAILY_REWARDS = [
  { coins: 50,  gems: 0  },
  { coins: 100, gems: 1  },
  { coins: 150, gems: 0  },
  { coins: 200, gems: 2  },
  { coins: 250, gems: 0  },
  { coins: 300, gems: 5  },
  { coins: 500, gems: 10, loot: 'rare' },
];

// ─── Loot table ───────────────────────────────────────────────────────────────
const LOOT_TABLE = [
  { weight: 60, tier: 'common',   label: '+25 Coins',       coins: 25 },
  { weight: 25, tier: 'uncommon', label: '+50 Coins + XP',  coins: 50, xp: 200 },
  { weight: 12, tier: 'rare',     label: '+100 Coins + 2 Gems', coins: 100, gems: 2 },
  { weight:  3, tier: 'epic',     label: 'Legendary Skin Unlock!', coins: 50, gems: 5 },
];

function rollLoot(forceTier = null) {
  if (forceTier) {
    const item = LOOT_TABLE.find(l => l.tier === forceTier);
    return item ?? LOOT_TABLE[0];
  }
  const roll = Math.random() * 100;
  let acc = 0;
  for (const item of LOOT_TABLE) {
    acc += item.weight;
    if (roll < acc) return item;
  }
  return LOOT_TABLE[0];
}

// ─── Local storage key ────────────────────────────────────────────────────────
const LS_KEY = 'dz-progression';

function defaultState() {
  return {
    level:     1,
    prestige:  0,
    xp:        0,
    totalXP:   0,
    coins:     100,
    gems:      0,
    streakDays: 0,
    lastLoginDate: '',
    stats: {
      totalKills:          0,
      totalHeadshots:      0,
      totalWavesSurvived:  0,
      totalShotsFired:     0,
      totalShotsHit:       0,
      totalScore:          0,
      totalGamesPlayed:    0,
      totalTimePlayed:     0,
    },
    weaponMastery: {
      pistol: { kills: 0, headshots: 0, xp: 0, level: 0 },
      smg:    { kills: 0, headshots: 0, xp: 0, level: 0 },
      shotgun:{ kills: 0, headshots: 0, xp: 0, level: 0 },
      ar:     { kills: 0, headshots: 0, xp: 0, level: 0 },
      sniper: { kills: 0, headshots: 0, xp: 0, level: 0 },
      crossbow:{ kills: 0, headshots: 0, xp: 0, level: 0 },
      flamethrower:{ kills: 0, headshots: 0, xp: 0, level: 0 },
      katana: { kills: 0, headshots: 0, xp: 0, level: 0 },
    },
    battlePass: {
      tier: 0,
      xp:   0,
      premium: false,
      claimed: [],
    },
    lootHistory: [],
  };
}

// ─── Main class ───────────────────────────────────────────────────────────────
export class Progression {
  constructor() {
    this._state = defaultState();
    this._dirty = false;
    this._saveTimer = 0;
    this.onLevelUp   = null;  // (newLevel, prestige) => void
    this.onReward    = null;  // (reward) => void  — coins, gems, loot
    this.onBPTier    = null;  // (tier, reward) => void
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  async init() {
    // Load from localStorage first (instant)
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        this._state = { ...defaultState(), ...saved };
        // Deep-merge nested objects
        this._state.stats         = { ...defaultState().stats, ...saved.stats };
        this._state.weaponMastery = { ...defaultState().weaponMastery, ...saved.weaponMastery };
        this._state.battlePass    = { ...defaultState().battlePass, ...saved.battlePass };
      } catch {}
    }

    // Sync from Firestore if signed in (non-blocking)
    this._syncFromCloud().catch(() => {});
  }

  async _syncFromCloud() {
    const user = currentUser();
    if (!user) return;
    const cloud = await fsGet(`users/${user.uid}/progression/main`);
    if (!cloud) return;
    // Cloud wins if it has higher totalXP (anti-cheat: never let local downgrade)
    if (cloud.totalXP >= (this._state.totalXP ?? 0)) {
      this._state = { ...defaultState(), ...cloud };
    }
    this._saveLocal();
  }

  // ─── Save ────────────────────────────────────────────────────────────────────
  _saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify(this._state));
  }

  async save() {
    this._saveLocal();
    const user = currentUser();
    if (!user) return;
    try {
      await fsSet(`users/${user.uid}/progression/main`, this._state);
    } catch (e) {
      console.warn('[Progression] cloud save failed:', e.message);
    }
  }

  // Auto-save every 30 seconds of game time
  tick(dt) {
    this._saveTimer += dt;
    if (this._saveTimer >= 30) {
      this._saveTimer = 0;
      this.save().catch(() => {});
    }
    this._state.stats.totalTimePlayed += dt;
  }

  // ─── XP ──────────────────────────────────────────────────────────────────────
  addXP(amount) {
    const s = this._state;
    s.totalXP += amount;
    s.xp      += amount;

    let leveled = false;
    while (s.level < MAX_LEVEL && s.xp >= xpRequired(s.level)) {
      s.xp   -= xpRequired(s.level);
      s.level++;
      leveled = true;
      this.onLevelUp?.(s.level, s.prestige);
      this._grantLevelReward(s.level);
    }

    // At max level, reset XP and prestige
    if (s.level >= MAX_LEVEL && s.prestige < PRESTIGE_MAX) {
      s.xp      = 0;
      s.level   = 1;
      s.prestige++;
      leveled = true;
      this.onLevelUp?.(s.level, s.prestige);
    }

    this._dirty = true;
    return { leveled, level: s.level, prestige: s.prestige };
  }

  _grantLevelReward(level) {
    // Every 5 levels: coins; every 10: gems; every 25: big gem drop
    let reward = null;
    if (level % 25 === 0)     reward = { coins: 500, gems: 20, label: `Level ${level} milestone!` };
    else if (level % 10 === 0) reward = { coins: 200, gems: 5,  label: `Level ${level} reward!` };
    else if (level % 5 === 0)  reward = { coins: 100, gems: 0,  label: `Level ${level} reward!` };

    if (reward) {
      this.addCoins(reward.coins);
      if (reward.gems) this.addGems(reward.gems);
      this.onReward?.(reward);
    }

    // Random loot drop chance: 20% per level up, 60% at milestone
    const lootChance = (level % 10 === 0) ? 0.6 : 0.2;
    if (Math.random() < lootChance) {
      const loot = rollLoot();
      if (loot.coins) this.addCoins(loot.coins);
      if (loot.gems)  this.addGems(loot.gems);
      if (loot.xp)    this.addXP(loot.xp);
      this._state.lootHistory.unshift({ ...loot, ts: Date.now() });
      if (this._state.lootHistory.length > 20) this._state.lootHistory.length = 20;
      this.onReward?.({ ...loot, isLoot: true });
    }
  }

  // ─── Currency ─────────────────────────────────────────────────────────────────
  addCoins(n)    { this._state.coins  += n; this._dirty = true; }
  addGems(n)     { this._state.gems   += n; this._dirty = true; }
  spendCoins(n)  {
    if (this._state.coins < n) return false;
    this._state.coins -= n; this._dirty = true; return true;
  }
  spendGems(n)   {
    if (this._state.gems < n) return false;
    this._state.gems  -= n; this._dirty = true; return true;
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────
  trackStat(key, n = 1) {
    if (key in this._state.stats) {
      this._state.stats[key] += n;
      this._dirty = true;
    }
  }

  // ─── Weapon mastery ──────────────────────────────────────────────────────────
  updateMastery(weapon, kills = 0, headshots = 0) {
    const m = this._state.weaponMastery[weapon];
    if (!m) return null;
    m.kills     += kills;
    m.headshots += headshots;
    m.xp        += kills * 10 + headshots * 15;
    const prevLevel = m.level;
    m.level = MASTERY_THRESHOLDS.findLastIndex(t => m.xp >= t);
    this._dirty = true;
    return m.level > prevLevel ? { weapon, level: m.level } : null;
  }

  // ─── Battle pass ─────────────────────────────────────────────────────────────
  progressBattlePass(xp) {
    const bp = this._state.battlePass;
    bp.xp += xp;
    const newTier = Math.min(Math.floor(bp.xp / BP_XP_PER_TIER), BP_TIERS);
    const unlocked = [];

    for (let t = bp.tier + 1; t <= newTier; t++) {
      if (!bp.claimed.includes(t)) {
        bp.claimed.push(t);
        const freeReward    = BP_FREE_REWARDS[t];
        const premReward    = bp.premium ? BP_PREMIUM_REWARDS[t] : null;
        [freeReward, premReward].filter(Boolean).forEach(r => {
          if (r.type === 'coins')  this.addCoins(r.amount);
          if (r.type === 'gem')    this.addGems(r.amount);
          unlocked.push({ tier: t, reward: r });
          this.onBPTier?.(t, r);
        });
      }
    }
    bp.tier = newTier;
    this._dirty = true;
    return unlocked;
  }

  // ─── Daily login ─────────────────────────────────────────────────────────────
  checkDailyLogin() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._state.lastLoginDate === today) return null;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (this._state.lastLoginDate !== yesterday) this._state.streakDays = 0;

    this._state.streakDays     = (this._state.streakDays ?? 0) + 1;
    this._state.lastLoginDate  = today;

    const idx    = (this._state.streakDays - 1) % DAILY_REWARDS.length;
    const reward = DAILY_REWARDS[idx];

    this.addCoins(reward.coins);
    if (reward.gems) this.addGems(reward.gems);
    if (reward.loot) {
      const loot = rollLoot(reward.loot);
      if (loot.coins) this.addCoins(loot.coins);
      if (loot.gems)  this.addGems(loot.gems);
    }

    this._dirty = true;
    this.save().catch(() => {});
    this.onReward?.({ ...reward, isDailyLogin: true, streak: this._state.streakDays });
    return { ...reward, streak: this._state.streakDays, day: idx + 1 };
  }

  // ─── Getters ──────────────────────────────────────────────────────────────────
  get level()    { return this._state.level; }
  get prestige() { return this._state.prestige; }
  get xp()       { return this._state.xp; }
  get coins()    { return this._state.coins; }
  get gems()     { return this._state.gems; }
  get stats()    { return this._state.stats; }
  get streak()   { return this._state.streakDays; }

  get xpToNextLevel() {
    return xpRequired(this._state.level) - this._state.xp;
  }

  getNextRewardLabel() {
    const lvl = this._state.level;
    const next5 = Math.ceil(lvl / 5) * 5;
    const diff  = next5 - lvl;
    if (diff === 0) return 'Reward available now!';
    return `Next reward in ${diff} level${diff > 1 ? 's' : ''}`;
  }

  getState()  { return { ...this._state }; }
  getMastery(weapon) { return this._state.weaponMastery[weapon] ?? null; }
  getBattlePass()    { return { ...this._state.battlePass }; }
}

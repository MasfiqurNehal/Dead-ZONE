/**
 * leaderboard.js — Global top-100, weekly, and friends leaderboards
 *
 * Falls back to localStorage (menu.js lbAdd) when Firebase is unavailable.
 * Firestore collection: 'leaderboard'  — all-time best per user (upserted)
 * Firestore collection: 'leaderboard_weekly' — reset each Monday
 */

import { currentUser, db, fsSet, fsQuery } from './firebase-config.js';

const LS_CACHE_KEY  = 'dz-lb-cache';
const CACHE_TTL_MS  = 60_000;     // 1 minute
const WEEKLY_TTL_MS = 60_000 * 5; // 5 minutes

function _weekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

export class Leaderboard {
  constructor() {
    this._globalCache   = null;
    this._globalCacheTS = 0;
    this._weeklyCache   = null;
    this._weeklyCacheTS = 0;
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  async submit(score, wave, kills) {
    // Always update local leaderboard (menu.js lbAdd)
    const { lbAdd } = await import('../ui/menu.js');
    const rank = lbAdd(score, wave, kills);

    const user = currentUser();
    if (!user) return { rank, synced: false };

    const displayName = user.displayName ?? user.email?.split('@')[0] ?? 'Anonymous';
    const uid         = user.uid;
    const now         = Date.now();
    const weekKey     = _weekKey();

    const entry = { uid, displayName, score, wave, kills, ts: now };

    try {
      // All-time: one doc per user (their personal best), keyed by uid
      // We only overwrite if this is a higher score
      const existing = await this._getUserBest(uid);
      if (!existing || score > (existing.score ?? 0)) {
        await fsSet(`leaderboard/${uid}`, entry, false);
      }

      // Weekly: one doc per user per week
      const weekExisting = await this._getUserWeeklyBest(uid, weekKey);
      if (!weekExisting || score > (weekExisting.score ?? 0)) {
        await fsSet(`leaderboard_weekly/${uid}_${weekKey}`, { ...entry, weekKey }, false);
      }

      // Invalidate cache
      this._globalCacheTS = 0;
      this._weeklyCacheTS = 0;

      // Get and return rank
      const playerRank = await this.getPlayerRank(uid);
      return { rank: playerRank, synced: true };
    } catch (e) {
      console.warn('[Leaderboard] submit failed:', e.message);
      return { rank, synced: false };
    }
  }

  async _getUserBest(uid) {
    if (!db) return null;
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'leaderboard', uid));
      return snap.exists() ? snap.data() : null;
    } catch { return null; }
  }

  async _getUserWeeklyBest(uid, weekKey) {
    if (!db) return null;
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'leaderboard_weekly', `${uid}_${weekKey}`));
      return snap.exists() ? snap.data() : null;
    } catch { return null; }
  }

  // ─── Fetch global top-N ───────────────────────────────────────────────────
  async getGlobal(limit = 100) {
    const now = Date.now();
    if (this._globalCache && (now - this._globalCacheTS) < CACHE_TTL_MS) {
      return this._globalCache.slice(0, limit);
    }

    if (!db) return this._getLocalFallback(limit);

    try {
      const { collection, query, orderBy, limit: _limit, getDocs } = await import('firebase/firestore');
      const q    = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), _limit(limit));
      const snap = await getDocs(q);
      const entries = snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
      this._globalCache   = entries;
      this._globalCacheTS = now;
      return entries;
    } catch (e) {
      console.warn('[Leaderboard] fetch failed:', e.message);
      return this._getLocalFallback(limit);
    }
  }

  // ─── Weekly top-N ─────────────────────────────────────────────────────────
  async getWeekly(limit = 50) {
    const now = Date.now();
    if (this._weeklyCache && (now - this._weeklyCacheTS) < WEEKLY_TTL_MS) {
      return this._weeklyCache.slice(0, limit);
    }

    if (!db) return [];

    try {
      const { collection, query, orderBy, limit: _limit, where, getDocs } = await import('firebase/firestore');
      const q    = query(
        collection(db, 'leaderboard_weekly'),
        where('weekKey', '==', _weekKey()),
        orderBy('score', 'desc'),
        _limit(limit),
      );
      const snap   = await getDocs(q);
      const entries = snap.docs.map((d, i) => ({ rank: i + 1, ...d.data() }));
      this._weeklyCache   = entries;
      this._weeklyCacheTS = now;
      return entries;
    } catch (e) {
      console.warn('[Leaderboard] weekly fetch failed:', e.message);
      return [];
    }
  }

  // ─── Player rank ──────────────────────────────────────────────────────────
  async getPlayerRank(uid) {
    if (!uid || !db) return null;
    try {
      const global = await this.getGlobal(100);
      const idx    = global.findIndex(e => e.uid === uid);
      return idx >= 0 ? idx + 1 : null;
    } catch { return null; }
  }

  // ─── Friends leaderboard (requires Google sign-in) ────────────────────────
  async getFriends(friendUids = []) {
    if (!db || !friendUids.length) return [];
    const me = currentUser();
    if (me) friendUids = [...new Set([...friendUids, me.uid])];

    try {
      const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
      // Firestore 'in' queries support up to 30 items
      const batches = [];
      for (let i = 0; i < friendUids.length; i += 30) {
        batches.push(friendUids.slice(i, i + 30));
      }
      const allEntries = [];
      for (const batch of batches) {
        const q    = query(collection(db, 'leaderboard'), where('uid', 'in', batch), orderBy('score', 'desc'));
        const snap = await getDocs(q);
        snap.docs.forEach(d => allEntries.push(d.data()));
      }
      allEntries.sort((a, b) => b.score - a.score);
      return allEntries.map((e, i) => ({ rank: i + 1, ...e }));
    } catch (e) {
      console.warn('[Leaderboard] friends fetch failed:', e.message);
      return [];
    }
  }

  // ─── Local fallback (uses localStorage set by menu.js lbAdd) ─────────────
  _getLocalFallback(limit) {
    try {
      const raw = localStorage.getItem('dz-lb');
      if (!raw) return [];
      return (JSON.parse(raw) ?? []).slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
    } catch { return []; }
  }

  // ─── Formatted rank label ─────────────────────────────────────────────────
  static rankLabel(rank) {
    if (!rank) return '—';
    if (rank === 1) return '🥇 #1';
    if (rank === 2) return '🥈 #2';
    if (rank === 3) return '🥉 #3';
    return `#${rank}`;
  }
}

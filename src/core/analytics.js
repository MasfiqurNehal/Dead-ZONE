/**
 * analytics.js — Google Analytics 4 integration
 *
 * GA4 script is NOT loaded until the user first interacts with the page
 * (click, keydown, or touchstart). This keeps Lighthouse performance score
 * high and prevents analytics from blocking the critical render path.
 *
 * Set VITE_GA_MEASUREMENT_ID in your .env.local / Vercel env vars.
 * If the ID is missing or 'G-XXXXXXXXXX', analytics silently no-ops.
 */

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-3ZRJDG58VM';
const ENABLED = GA_ID.length > 3 && !GA_ID.startsWith('G-XXX');

let _loaded    = false;
let _sessionStart = Date.now();
let _pendingEvents = [];  // events fired before GA loads

// ─── Lazy loader ──────────────────────────────────────────────────────────────
function _loadGA() {
  if (_loaded || !ENABLED) return;
  _loaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src   = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    send_page_view:       true,
    anonymize_ip:         true,
    cookie_flags:         'SameSite=None;Secure',
    custom_map: {
      dimension1: 'wave',
      dimension2: 'quality_tier',
    },
  });

  // Drain queued events
  script.onload = () => {
    _pendingEvents.forEach(([name, params]) => _gtag(name, params));
    _pendingEvents = [];
  };
}

// ─── Interaction trigger ──────────────────────────────────────────────────────
function _setupTrigger() {
  const events = ['click', 'keydown', 'touchstart', 'pointerdown'];
  const handler = () => {
    _loadGA();
    events.forEach(e => document.removeEventListener(e, handler));
  };
  events.forEach(e => document.addEventListener(e, handler, { once: true, passive: true }));
}

function _gtag(eventName, params = {}) {
  if (!ENABLED) return;
  if (!_loaded || !window.gtag) {
    _pendingEvents.push([eventName, params]);
    return;
  }
  window.gtag('event', eventName, params);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const analytics = {
  init(qualityTier = 'HIGH') {
    _setupTrigger();
    this._tier = qualityTier;
    _sessionStart = Date.now();
  },

  // ── Game flow ──────────────────────────────────────────────────────────────
  trackGameStart() {
    _gtag('game_start', { quality_tier: this._tier ?? 'HIGH' });
  },

  trackWaveStart(wave) {
    _gtag('wave_start', { wave, quality_tier: this._tier });
  },

  trackWaveClear(wave, kills, score, timeSec) {
    _gtag('wave_clear', {
      wave, kills, score,
      time_seconds:  Math.round(timeSec),
      quality_tier:  this._tier,
    });
  },

  trackDeath(wave, score, kills, cause = 'zombie') {
    const sessionSec = Math.round((Date.now() - _sessionStart) / 1000);
    _gtag('player_death', {
      wave, score, kills, cause,
      session_seconds: sessionSec,
      quality_tier:    this._tier,
    });
    _gtag('session_end', {
      duration_seconds: sessionSec,
      waves_reached:    wave,
      total_kills:      kills,
      top_score:        score,
    });
  },

  // ── Economy ───────────────────────────────────────────────────────────────
  trackUpgradeBuy(weapon, upgradeType, cost) {
    _gtag('upgrade_purchase', {
      weapon,
      upgrade_type: upgradeType,
      cost,
      currency:     'COINS',
    });
  },

  // ── Progression ───────────────────────────────────────────────────────────
  trackLevelUp(level, prestige) {
    _gtag('level_up', { level, prestige });
  },

  trackAchievement(achievementId, achievementName) {
    _gtag('achievement_unlock', {
      achievement_id:   achievementId,
      achievement_name: achievementName,
    });
  },

  // ── Social ────────────────────────────────────────────────────────────────
  trackShare(platform, score, wave) {
    _gtag('share', {
      method:   platform,
      content_type: 'score_card',
      item_id:  `wave${wave}_score${score}`,
    });
  },

  // ── Auth / retention ──────────────────────────────────────────────────────
  trackSignIn(method) {
    _gtag('login', { method });
  },

  trackDailyLogin(streak) {
    _gtag('daily_login', { streak });
  },

  trackChallengeComplete(challengeId, allThree) {
    _gtag('challenge_complete', { challenge_id: challengeId, all_three: allThree });
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  trackError(category, message) {
    _gtag('exception', { description: `[${category}] ${message}`, fatal: false });
  },

  trackFatalError(message) {
    _gtag('exception', { description: message, fatal: true });
  },

  // ── Performance ───────────────────────────────────────────────────────────
  trackPerformance(qualityTier, avgFPS) {
    _gtag('performance_sample', { quality_tier: qualityTier, avg_fps: Math.round(avgFPS) });
  },
};

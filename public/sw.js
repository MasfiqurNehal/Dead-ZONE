/**
 * sw.js — DEAD ZONE Service Worker
 *
 * Strategy:
 *  - HTML navigation: Network-first, cache fallback (always get latest game version)
 *  - JS/CSS/WASM bundles (/assets/*): Cache-first, immutable (content-hashed filenames)
 *  - Audio/images: Cache-first, long TTL
 *  - Firebase/CDN: Network-only (never cache 3rd party auth APIs)
 *
 * Version the cache name to bust on every deploy.
 * Vite injects __CACHE_VERSION__ via import.meta.env.VITE_CACHE_VERSION if you want
 * to automate this; otherwise bump CACHE_VER manually on each deploy.
 */

const CACHE_VER      = 'v4';
const STATIC_CACHE   = `dz-static-${CACHE_VER}`;
const ASSET_CACHE    = `dz-assets-${CACHE_VER}`;
const AUDIO_CACHE    = `dz-audio-${CACHE_VER}`;

// Files to pre-cache on install (critical shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/favicon.svg',
];

// Patterns that should NEVER be cached (network-only)
const NETWORK_ONLY = [
  'firebaseapp.com',
  'googleapis.com',
  'google-analytics.com',
  'googletagmanager.com',
  'fonts.googleapis.com',
];

// ─── Install — pre-cache shell ────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache partial failure:', err))
  );
});

// ─── Activate — delete old caches ────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('dz-') && ![STATIC_CACHE, ASSET_CACHE, AUDIO_CACHE].includes(k))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch routing ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Never cache non-GET or 3rd-party APIs
  if (request.method !== 'GET') return;
  if (NETWORK_ONLY.some(domain => url.hostname.includes(domain))) return;
  if (url.protocol === 'chrome-extension:') return;

  // Vite asset bundles — immutable, cache-first forever
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(_cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Audio files — cache-first (large files, rarely change)
  if (url.pathname.startsWith('/sounds/') || url.pathname.match(/\.(mp3|ogg|wav|webm)$/i)) {
    e.respondWith(_cacheFirst(request, AUDIO_CACHE));
    return;
  }

  // Public static files — cache-first (icons, WASM, etc.)
  if (url.pathname.match(/\.(wasm|svg|png|jpg|webp|ico|json)$/i) && url.hostname === self.location.hostname) {
    e.respondWith(_cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Google Fonts stylesheet — cache-first (changes rarely)
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(_cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Tailwind CDN — network-first (we want the latest; fallback to cache)
  if (url.hostname === 'cdn.tailwindcss.com') {
    e.respondWith(_networkFirst(request, STATIC_CACHE, 4000));
    return;
  }

  // HTML navigation — network-first (always load fresh shell)
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(_networkFirst(request, STATIC_CACHE, 3000));
    return;
  }

  // Everything else — network-first
  e.respondWith(_networkFirst(request, STATIC_CACHE, 5000));
});

// ─── Cache strategies ─────────────────────────────────────────────────────────
async function _cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.status < 300) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());   // background update
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function _networkFirst(request, cacheName, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    clearTimeout(timer);
    const cached = await caches.match(request);
    if (cached) return cached;
    // Serve offline fallback for navigation requests
    if (request.headers.get('accept')?.includes('text/html')) {
      const offlineFallback = await caches.match('/index.html');
      if (offlineFallback) return offlineFallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ─── Push notification support (future use) ──────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'DEAD ZONE', {
      body:  data.body ?? 'Your daily challenges have reset!',
      icon:  '/icon.svg',
      badge: '/icon.svg',
      tag:   'dz-notification',
      data:  { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url ?? '/'));
});

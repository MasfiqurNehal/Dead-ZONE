import { defineConfig } from 'vite';

export default defineConfig({
  base: './',

  server: {
    host: true,
    port: 5173,
    open: false,
    headers: {
      // Required for SharedArrayBuffer (Rapier threads) in dev
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy':   'same-origin',
    },
  },

  preview: {
    host: true,
    port: 4173,
  },

  optimizeDeps: {
    // Rapier bundles WASM inline — keep out of pre-bundler
    exclude: ['@dimforge/rapier3d-compat'],
    // Pre-bundle Firebase sub-packages so they import fast in dev
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/storage',
    ],
  },

  build: {
    target:    'es2020',
    outDir:    'dist',
    assetsDir: 'assets',
    sourcemap: false,

    // Inline small assets; audio/images ship as hashed files via assetsDir
    assetsInlineLimit: 4096,
    cssCodeSplit:      true,
    chunkSizeWarningLimit: 4000,  // Three.js + game core; cached by SW after first load

    minify: true,  // Vite 8: uses rolldown's built-in oxc minifier

    rollupOptions: {
      output: {
        // ── Manual chunk splitting ─────────────────────────────────────────
        // Each chunk gets its own long-lived CDN cache entry (content-hashed).
        // Splitting here means a single-file change only invalidates that chunk.
        manualChunks(id) {
          // Normalise Windows backslashes so includes() checks work cross-platform
          const n = id.replace(/\\/g, '/');

          // Three.js — largest dep, always its own long-lived chunk
          // Regex handles resolved paths like /node_modules/three/build/three.module.js
          // and virtual chunk IDs that rolldown may produce
          if (/[/\\]node_modules[/\\]three([/\\]|$)/.test(id) || n.endsWith('/three')) return 'three';

          // Rapier WASM physics — changes rarely
          if (n.includes('rapier3d-compat'))               return 'physics';

          // Post-processing (optional effects)
          if (n.includes('/node_modules/postprocessing/')) return 'postprocessing';

          // Firebase SDK — split by sub-package for granular tree-shaking
          if (n.includes('@firebase/firestore'))            return 'firebase-db';
          if (n.includes('@firebase/auth'))                 return 'firebase-auth';
          if (n.includes('@firebase/storage'))              return 'firebase-storage';
          if (n.includes('firebase'))                       return 'firebase-core';

          // Audio (Howler) — only loaded after first interaction
          if (n.includes('/node_modules/howler/'))         return 'audio';

          // GSAP — menu animations only
          if (n.includes('/node_modules/gsap/'))           return 'gsap';

          // All other node_modules
          if (n.includes('/node_modules/'))                return 'vendor';

          // Game source chunks — fine-grained for cache invalidation
          if (n.includes('/src/ui/'))                      return 'ui';
          if (n.includes('/src/backend/'))                 return 'backend';
          if (n.includes('/src/fx/'))                      return 'fx';
          if (n.includes('/src/entities/'))                return 'entities';
          if (n.includes('/src/core/'))                    return 'core';
          if (n.includes('/src/world/'))                   return 'world';
        },

        // Stable content-hashed filenames for long-term caching
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          // Keep audio in a dedicated folder for the service worker to target
          if (/\.(mp3|ogg|wav|webm)$/i.test(assetInfo.name ?? '')) {
            return 'sounds/[name].[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
    },
  },
});

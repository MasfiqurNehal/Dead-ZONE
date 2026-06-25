# DEAD ZONE 🧟

A browser-based **first-person zombie survival shooter** built entirely with modern web technologies — no game engine, no plugins, just raw WebGL, physics, and audio.

![Three.js](https://img.shields.io/badge/Three.js-r184-black?logo=three.js)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)
![Firebase](https://img.shields.io/badge/Firebase-10-FFCA28?logo=firebase)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Gameplay

Survive endless waves of zombies in a post-apocalyptic environment. The city grows darker and more dangerous with every wave.

- **8 weapons** — pistol, shotgun, assault rifle, SMG, sniper, RPG, minigun, and more
- **Endless wave system** — zombie count, speed, and HP scale each wave
- **Headshot multipliers**, hit markers, and kill streaks
- **XP / level progression** with unlockable weapons and perks
- **Achievements** — 20+ unlock conditions tracked per session
- **Firebase leaderboard** — scores sync globally in real time
- **PWA** — installable, works offline after first load

---

## Tech Stack

| Layer | Library / API |
|---|---|
| 3D rendering | [Three.js r184](https://threejs.org/) |
| Physics | [Rapier3D (WASM)](https://rapier.rs/) |
| Post-processing | [postprocessing](https://github.com/pmndrs/postprocessing) — SMAA, Bloom, Vignette, SSAO |
| Audio | Web Audio API (procedural synthesis — zero audio files required) |
| Backend | Firebase 10 — Auth, Firestore, Realtime leaderboard |
| Bundler | Vite 8 (rolldown/oxc) |
| Deployment | Vercel (zero-config) |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/MasfiqurNehal/Dead-ZONE.git
cd Dead-ZONE

# 2. Install dependencies
npm install

# 3. Run dev server (opens at http://localhost:5173)
npm run dev
```

> **Mobile / LAN testing:** `npm run host` exposes the game on your network IP so you can play on a phone.

---

## Controls

### Desktop (Keyboard & Mouse)

| Action | Key / Input |
|---|---|
| Move | `W A S D` |
| Look | Mouse |
| Shoot | Left Click |
| Aim (ADS) | Right Click |
| Reload | `R` |
| Switch weapon | `1–8` or Scroll Wheel |
| Flashlight | `F` |
| Sprint | `Shift` |
| Jump | `Space` |
| Pause | `Escape` |

### Debug Overlay (Dev Mode)

Press **backtick ( `` ` `` )** to toggle the debug overlay showing FPS, position, zombie count, wave, memory, and draw calls.

| Cheat Key | Effect |
|---|---|
| `G` | God mode (invincibility toggle) |
| `K` | Kill all zombies instantly |
| `N` | Skip to next wave |
| `M` | Max ammo all weapons |
| `+` / `-` | Increase / decrease zombie spawn rate |

---

## Project Structure

```
Dead-ZONE/
├── main.js                   # App entry — wires all systems together
├── index.html
├── style.css
├── vite.config.js
├── vercel.json               # Deployment headers + SPA rewrites
├── public/
│   ├── sw.js                 # Service Worker (PWA / offline)
│   ├── manifest.json
│   └── assets/               # Static models, textures, sounds
└── src/
    ├── core/
    │   ├── engine.js          # Game loop, resize, lifecycle
    │   ├── renderer.js        # WebGLRenderer + postprocessing composer
    │   ├── input.js           # Keyboard / mouse / pointer-lock
    │   ├── physics.js         # Rapier WASM wrapper
    │   ├── wave-manager.js    # Wave spawning & difficulty scaling
    │   ├── weapon-manager.js  # 8-weapon inventory & fire logic
    │   ├── quality-manager.js # Low / Medium / High / Ultra presets
    │   ├── sound-manager.js   # Howler spatial audio wrapper
    │   ├── debug-overlay.js   # Dev HUD + cheat hotkeys
    │   ├── mobile-controls.js # Virtual joystick & touch buttons
    │   ├── analytics.js       # Session analytics
    │   └── error-handler.js   # Global error boundary
    ├── entities/
    │   ├── player.js          # FPS controller, health, flashlight
    │   ├── zombie.js          # AI pathfinding, damage, ragdoll death
    │   ├── weapon.js          # Weapon data model & animations
    │   └── bullet.js          # Raycast projectile system
    ├── world/
    │   └── arena.js           # Procedural environment, lighting, post-FX
    ├── audio/
    │   └── procedural-sounds.js  # Web Audio synthesis (no files needed)
    ├── ui/
    │   ├── hud.js             # In-game HUD (health, ammo, wave, crosshair)
    │   └── menu.js            # Main menu, pause, game-over screens
    ├── backend/
    │   ├── firebase-config.js
    │   ├── leaderboard.js
    │   ├── achievements.js
    │   ├── progression.js
    │   ├── challenges.js
    │   └── social.js
    ├── fx/
    │   └── particle-system.js # Blood, muzzle flash, explosion particles
    └── utils/
        ├── constants.js       # Game-wide tuning values
        └── helpers.js
```

---

## Build for Production

```bash
npm run build        # outputs to /dist
npm run preview      # preview the production build locally
```

Deploys automatically to **Vercel** on push to `main`. The `vercel.json` sets:
- Long-term cache headers (`immutable`) for all hashed assets
- WASM `Content-Type` header (required for Rapier)
- `COOP` / `COEP` headers for `SharedArrayBuffer` (Rapier threads)
- SPA fallback rewrite for client-side routing

---

## Firebase Setup (Optional)

The game works fully offline. Firebase is used for the global leaderboard and cross-session progression.

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Anonymous Authentication** and **Firestore**
3. Replace the config in `src/backend/firebase-config.js` with your project credentials

---

## Roadmap

- [ ] Realistic zombie mesh (CapsuleGeometry body, deformed head, glowing eyes)
- [ ] Post-apocalyptic town environment (roads, houses, bridge, river, factory)
- [ ] Multiplayer co-op via WebRTC
- [ ] Weapon upgrade crafting system
- [ ] Boss zombie waves

---

## License

MIT — do whatever you want, just keep the attribution.

---

*Built with Three.js + Rapier3D + Vite. No Unity, no Unreal, just the browser.*

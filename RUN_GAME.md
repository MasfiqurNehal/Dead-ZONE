# DEAD ZONE — Quick Start Guide

## One-command start

```bash
npm install && npm run dev
```

Open **http://localhost:5173** in Chrome or Firefox.

---

## Controls — Desktop

| Action | Key/Mouse |
|---|---|
| Move | WASD |
| Sprint | Hold Shift |
| Jump | Space |
| Crouch | Hold Ctrl |
| Look | Mouse |
| Shoot | Left Click |
| Aim Down Sights | Right Click |
| Reload | R |
| Weapons 1–8 | Keys 1–8 (or scroll wheel) |
| Pause | Escape |

---

## Controls — Mobile

| Action | Control |
|---|---|
| Move | Left virtual joystick |
| Look | Swipe right side of screen |
| Shoot | Tap shoot button (bottom-right) |
| Reload | Tap reload button |
| Switch weapon | Swipe weapon bar |

Open the network URL (shown in terminal) on your phone while on the same Wi-Fi.

---

## Debug / Dev Mode

Press **backtick `` ` ``** to toggle the debug overlay:

```
▶ DEBUG
FPS: 60       State: playing  Wave: 3
Pos: 12.3, 1.6, -8.1
HP: 100       Stamina: 100
Zombies: 4    Queue: 11
Weapon: AR-15  Clip: 28/180
```

### Cheat hotkeys (work any time)

| Key | Action |
|---|---|
| **G** | Toggle god mode (invincible) |
| **K** | Kill all zombies instantly |
| **N** | Skip to next wave |
| **M** | Max ammo on all weapons |
| **+** | Increase zombie spawn rate (×2 faster) |
| **-** | Reset spawn rate to normal |

---

## Testing on your phone

1. Start the dev server: `npm run dev`
2. Terminal shows two URLs — copy the **Network** one (e.g. `http://192.168.1.x:5173`)
3. Open that URL on your phone (must be on the same Wi-Fi)
4. Works best in Chrome for Android / Safari for iOS

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Black screen | Reload; check browser console (F12) for errors |
| "WebGL not supported" | Use Chrome, Firefox, or Edge — not IE/old Safari |
| No sound | Click/tap the screen first (browser requires user gesture) |
| Poor performance | Press backtick, check FPS — game auto-adjusts quality |
| Firebase errors | Expected if not configured — game works offline |
| Port 5173 busy | `npm run dev -- --port 5174` |

---

## Available scripts

```bash
npm run dev        # Development server with hot reload
npm run build      # Production build → dist/
npm run preview    # Serve production build locally
```

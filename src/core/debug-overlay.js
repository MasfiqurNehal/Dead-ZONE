/**
 * debug-overlay.js — Dev/test overlay for DEAD ZONE
 *
 * Toggle with backtick (`)
 * Cheat keys (only when overlay visible OR god-mode active):
 *   G  — toggle god mode (player can't take damage)
 *   K  — kill all zombies instantly
 *   N  — skip to next wave (fire _beginWave immediately)
 *   M  — max ammo on all weapons
 *   +  — decrease spawn interval (faster waves)
 *   -  — reset spawn interval
 */

export class DebugOverlay {
  /**
   * @param {{
   *   getPlayer:      () => import('../entities/player.js').Player|null,
   *   getWaveManager: () => import('./wave-manager.js').WaveManager|null,
   *   getEngine:      () => import('./engine.js').Engine|null,
   *   getStats:       () => { state:string, wave:number, kills:number, score:number },
   *   onNextWave:     () => void,
   * }} ctx
   */
  constructor({ getPlayer, getWaveManager, getEngine, getStats, onNextWave }) {
    this._getPlayer      = getPlayer;
    this._getWaveManager = getWaveManager;
    this._getEngine      = getEngine;
    this._getStats       = getStats;
    this._onNextWave     = onNextWave;

    this._visible    = false;
    this._godMode    = false;
    this._spawnMul   = 1;        // spawn-interval multiplier
    this._origTakeDamage = null; // saved player.takeDamage for god-mode toggle

    this._el = null;
    this._raf = 0;

    this._buildDOM();
    this._bindKeys();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  _buildDOM() {
    const style = document.createElement('style');
    style.textContent = `
      #dz-debug {
        position: fixed; top: 50px; left: 8px; z-index: 9999;
        background: rgba(0,0,0,0.82); color: #0f0; border: 1px solid #0f0;
        font: 11px/1.6 'Courier New', monospace; padding: 8px 12px;
        pointer-events: none; user-select: none; border-radius: 4px;
        min-width: 200px; display: none;
      }
      #dz-debug .dz-d-head {
        color: #ff0; letter-spacing: 2px; font-size: 10px; margin-bottom: 4px;
      }
      #dz-debug .dz-d-god  { color: #f44; }
      #dz-debug .dz-d-hint {
        margin-top: 6px; color: rgba(0,255,0,0.45); font-size: 9px;
        border-top: 1px solid rgba(0,255,0,0.2); padding-top: 4px;
      }
    `;
    document.head.appendChild(style);

    this._el = document.createElement('div');
    this._el.id = 'dz-debug';
    document.body.appendChild(this._el);
  }

  _show() {
    this._visible = true;
    this._el.style.display = 'block';
    this._tick();
  }

  _hide() {
    this._visible = false;
    this._el.style.display = 'none';
    cancelAnimationFrame(this._raf);
  }

  _tick() {
    if (!this._visible) return;
    this._render();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  _render() {
    const p   = this._getPlayer?.();
    const wm  = this._getWaveManager?.();
    const eng = this._getEngine?.();
    const st  = this._getStats?.() ?? {};

    const pos = p?.body?.translation?.() ?? { x: 0, y: 0, z: 0 };
    const mem = performance?.memory;
    const info = eng?.renderer?.renderer?.info;

    const lines = [
      `<div class="dz-d-head">▶ DEBUG ${this._godMode ? '<span class="dz-d-god">[GOD]</span>' : ''}</div>`,
      `FPS: ${eng?.fps ?? '?'}`,
      `State: ${st.state ?? '?'}  Wave: ${st.wave ?? 0}`,
      `Score: ${st.score ?? 0}  Kills: ${st.kills ?? 0}`,
      `Pos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`,
      `HP: ${p?.health?.toFixed(0) ?? '?'}  Stamina: ${p?.stamina?.toFixed(0) ?? '?'}`,
      `Zombies: ${wm?.activeCount ?? 0}  Queue: ${wm?._queue?.length ?? 0}`,
      `Weapon: ${p?.weapon?.name ?? '?'}  Clip: ${p?.weapon?.clip ?? '?'}/${p?.weapon?.reserve ?? '?'}`,
      `Spawn×: ${this._spawnMul.toFixed(1)}x`,
      mem ? `Heap: ${(mem.usedJSHeapSize / 1e6).toFixed(0)}/${(mem.jsHeapSizeLimit / 1e6).toFixed(0)} MB` : '',
      info ? `Draw calls: ${info.render?.calls ?? '?'}  Tris: ${(info.render?.triangles ?? 0).toLocaleString()}` : '',
      `<div class="dz-d-hint">[\`] hide  [G] god  [K] kill all  [N] next wave  [M] max ammo  [+/-] spawn rate</div>`,
    ];

    this._el.innerHTML = lines.filter(Boolean).join('<br>');
  }

  // ── Key bindings ──────────────────────────────────────────────────────────

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      // Backtick toggles the overlay
      if (e.code === 'Backquote') {
        this._visible ? this._hide() : this._show();
        return;
      }

      // Cheat keys work regardless of overlay visibility
      switch (e.code) {
        case 'KeyG': this._toggleGodMode(); break;
        case 'KeyK': this._killAll();       break;
        case 'KeyN': this._nextWave();      break;
        case 'KeyM': this._maxAmmo();       break;
        case 'Equal':
        case 'NumpadAdd':
          this._changeSpawnRate(0.5);
          break;
        case 'Minus':
        case 'NumpadSubtract':
          this._changeSpawnRate(1.0);
          break;
      }
    });
  }

  // ── Cheat implementations ─────────────────────────────────────────────────

  _toggleGodMode() {
    const p = this._getPlayer?.();
    if (!p) return;
    this._godMode = !this._godMode;
    if (this._godMode) {
      this._origTakeDamage = p.takeDamage.bind(p);
      p.takeDamage = () => {};
      console.info('[DEBUG] God mode ON');
    } else {
      if (this._origTakeDamage) p.takeDamage = this._origTakeDamage;
      this._origTakeDamage = null;
      console.info('[DEBUG] God mode OFF');
    }
  }

  _killAll() {
    const wm = this._getWaveManager?.();
    if (!wm) return;
    // Force-kill all living zombies to trigger wave-clear naturally
    for (const z of [...wm._zombies]) {
      if (z.alive) z._kill({ x: 0, y: 1, z: 0 });
    }
    console.info('[DEBUG] Kill all fired');
  }

  _nextWave() {
    this._onNextWave?.();
    console.info('[DEBUG] Next wave triggered');
  }

  _maxAmmo() {
    const p = this._getPlayer?.();
    if (!p) return;
    for (const w of p.weapons) {
      w.clip    = w._clipMax;
      w.reserve = w.stats.reserveAmmo * 3;
    }
    console.info('[DEBUG] Max ammo');
  }

  _changeSpawnRate(mul) {
    const wm = this._getWaveManager?.();
    if (!wm) return;
    this._spawnMul = mul;
    // Directly poke the spawn timer so next spawn arrives sooner/later
    wm._spawnTimer = Math.max(0, wm._spawnTimer * mul);
    console.info(`[DEBUG] Spawn rate ×${mul}`);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._el?.remove();
  }
}

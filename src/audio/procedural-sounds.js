/**
 * procedural-sounds.js — Web Audio synthesis fallback for DEAD ZONE
 *
 * Generates all game sounds procedurally — no audio files required.
 * Used when Howler/SoundManager can't load files (missing assets).
 * Browser AudioContext requires a user gesture before first play;
 * call resume() on first user interaction.
 */

class ProceduralSounds {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._drone = null;
    this._heartbeatInterval = null;
    this._enabled = true;
  }

  // Lazy-initialise AudioContext on first play (gesture required)
  _ensure() {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') this._ctx.resume();
      return true;
    }
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0.45;
      this._master.connect(this._ctx.destination);
      return true;
    } catch {
      this._enabled = false;
      return false;
    }
  }

  _noise(duration) {
    if (!this._ctx) return null;
    const size = Math.ceil(this._ctx.sampleRate * duration);
    const buf  = this._ctx.createBuffer(1, size, this._ctx.sampleRate);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.start();
    return src;
  }

  // ── Weapon sounds ────────────────────────────────────────────────────────────

  pistolShot() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const gain = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    const osc = this._ctx.createOscillator();
    const noise = this._noise(0.12);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.12);

    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(filter); noise?.connect(filter);
    filter.connect(gain).connect(this._master);
    osc.start(now); osc.stop(now + 0.2);
  }

  rifleShot() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const gain = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    const osc = this._ctx.createOscillator();
    const noise = this._noise(0.08);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3500, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.1);

    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(filter); noise?.connect(filter);
    filter.connect(gain).connect(this._master);
    osc.start(now); osc.stop(now + 0.15);
  }

  shotgunShot() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const noise = this._noise(0.35);
    const gain = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    const osc = this._ctx.createOscillator();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(25, now + 0.3);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 0.4);

    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    noise?.connect(filter); osc.connect(filter);
    filter.connect(gain).connect(this._master);
    osc.start(now); osc.stop(now + 0.5);
  }

  emptyClick() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 1800;
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(g).connect(this._master);
    osc.start(now); osc.stop(now + 0.04);
  }

  // ── Hit / feedback ───────────────────────────────────────────────────────────

  hitMarker(headshot = false) {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = headshot ? 1400 : 900;
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (headshot ? 0.14 : 0.08));
    osc.connect(g).connect(this._master);
    osc.start(now); osc.stop(now + 0.16);
  }

  reload() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    for (const [t, freq] of [[0, 300], [0.12, 500], [0.22, 250]]) {
      const osc = this._ctx.createOscillator();
      const g = this._ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.12, now + t);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.06);
      osc.connect(g).connect(this._master);
      osc.start(now + t); osc.stop(now + t + 0.07);
    }
  }

  // ── Zombie sounds ─────────────────────────────────────────────────────────────

  zombieGroan(distance = 1) {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const o1 = this._ctx.createOscillator();
    const o2 = this._ctx.createOscillator();
    const filter = this._ctx.createBiquadFilter();
    const g = this._ctx.createGain();

    o1.type = 'sawtooth'; o1.frequency.setValueAtTime(75 + Math.random() * 35, now);
    o1.frequency.linearRampToValueAtTime(55, now + 1.2);
    o2.type = 'square';   o2.frequency.setValueAtTime(115 + Math.random() * 25, now);
    o2.frequency.linearRampToValueAtTime(85, now + 1.2);

    filter.type = 'bandpass'; filter.frequency.value = 380; filter.Q.value = 2.5;

    const vol = Math.min(0.4, 0.4 / Math.max(1, distance * 0.12));
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.2);
    g.gain.linearRampToValueAtTime(vol * 0.7, now + 0.9);
    g.gain.linearRampToValueAtTime(0, now + 1.4);

    o1.connect(filter); o2.connect(filter);
    filter.connect(g).connect(this._master);
    o1.start(now); o2.start(now);
    o1.stop(now + 1.5); o2.stop(now + 1.5);
  }

  zombieDeath() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const noise = this._noise(0.7);
    const g = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.7);

    filter.type = 'lowpass'; filter.frequency.value = 800;

    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(filter); noise?.connect(filter);
    filter.connect(g).connect(this._master);
    osc.start(now); osc.stop(now + 0.9);
  }

  zombieAlert() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.5);
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(g).connect(this._master);
    osc.start(now); osc.stop(now + 0.65);
  }

  // ── Player sounds ─────────────────────────────────────────────────────────────

  footstep() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const noise = this._noise(0.05);
    const g = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 180;
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise?.connect(filter).connect(g).connect(this._master);
  }

  playerHurt() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const noise = this._noise(0.15);
    const g = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 600; filter.Q.value = 1;
    g.gain.setValueAtTime(0.45, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    noise?.connect(filter).connect(g).connect(this._master);
  }

  startHeartbeat() {
    if (this._heartbeatInterval) return;
    this._heartbeatInterval = setInterval(() => this._heartbeatPulse(), 900);
  }

  stopHeartbeat() {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
  }

  _heartbeatPulse() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    for (const offset of [0, 0.18]) {
      const osc = this._ctx.createOscillator();
      const g = this._ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 55;
      g.gain.setValueAtTime(0.35, now + offset);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
      osc.connect(g).connect(this._master);
      osc.start(now + offset); osc.stop(now + offset + 0.15);
    }
  }

  // ── Ambient / music ──────────────────────────────────────────────────────────

  startAmbientDrone() {
    if (!this._ensure() || this._drone) return;
    const ctx = this._ctx;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 320;

    const freqs = [55, 82.4, 110, 164.8];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });

    // Slow LFO for creepy swell
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.08; lfoG.gain.value = 0.035;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start();

    filter.connect(g).connect(this._master);
    this._drone = { oscs, lfo, g };
  }

  stopAmbientDrone() {
    if (!this._drone) return;
    const now = this._ctx?.currentTime ?? 0;
    this._drone.g.gain.setValueAtTime(this._drone.g.gain.value, now);
    this._drone.g.gain.linearRampToValueAtTime(0, now + 1.5);
    setTimeout(() => {
      this._drone?.oscs.forEach(o => { try { o.stop(); } catch {} });
      try { this._drone?.lfo.stop(); } catch {}
      this._drone = null;
    }, 1600);
  }

  waveStart() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    for (const [offset, freq, dur] of [
      [0, 110, 0.8], [0.3, 165, 0.7], [0.55, 220, 0.9],
    ]) {
      const osc = this._ctx.createOscillator();
      const g = this._ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + offset);
      g.gain.linearRampToValueAtTime(0.3, now + offset + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      osc.connect(g).connect(this._master);
      osc.start(now + offset); osc.stop(now + offset + dur + 0.05);
    }
  }

  waveClear() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    for (const [t, f] of [[0, 330], [0.18, 440], [0.36, 550], [0.54, 660]]) {
      const osc = this._ctx.createOscillator();
      const g = this._ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.2, now + t);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.25);
      osc.connect(g).connect(this._master);
      osc.start(now + t); osc.stop(now + t + 0.28);
    }
  }

  explosion() {
    if (!this._ensure()) return;
    const now = this._ctx.currentTime;
    const noise = this._noise(1.2);
    const g = this._ctx.createGain();
    const filter = this._ctx.createBiquadFilter();
    const osc = this._ctx.createOscillator();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.8);

    filter.type = 'lowpass'; filter.frequency.value = 500;

    g.gain.setValueAtTime(1.0, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    noise?.connect(filter); osc.connect(filter);
    filter.connect(g).connect(this._master);
    osc.start(now); osc.stop(now + 1.5);
  }

  setVolume(v) {
    if (this._master) this._master.gain.value = Math.max(0, Math.min(1, v));
  }
}

export const proceduralSounds = new ProceduralSounds();

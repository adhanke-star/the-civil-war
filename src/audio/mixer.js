// src/audio/mixer.js: the one Web Audio graph for recorded sound (DESIGN §4 Sound; the Settings panel's volumes).
//
//   sources -> [lowpass] -> gain -> [pan] -> bus (effects | ambient | voices | music | ui) -> master compressor -> out
//
// Bus gain = (master x its slider)^2 (a perceptual curve), 0 when muted; effects, ambient and the reward sounds (ui,
// src/reward/sfx.js) follow the Effects slider, cheers the Voices slider, music the Music slider. The ambient bus can be
// ducked (pause). Nothing is created, fetched or played before the first user gesture: arm() listens for it, unlock()
// builds the AudioContext inside it (iPad Safari and Chrome only start audio from a gesture), and load() waits for it.
// Banks load lazily (src/audio/bank.js); music is streamed by src/audio/music.js through this graph.
// howler.js is not used: it has no buses, and the decode/stream/pan/unlock work it would do is a few lines of Web Audio
// that src/reward/sfx.js already relied on; one graph keeps one AudioContext for the whole page.
// mixer.log keeps the last 64 play requests ({ id, bus, gain, pan, ok }) for the UI test's spy; nothing is shipped there.

import { define, get, on } from '../settings.js';
import { SOUNDS, AUDIO_DIR, bankIds } from './bank.js';

export const AUDIO_SETTINGS = Object.freeze([
  ['audio.master', { tab: 'Screens', type: 'range', default: 0.8, min: 0, max: 1, step: 0.05, label: 'Master volume',
    note: 'All recorded sound and the reward card sounds. Sound starts after your first tap or key press.' }],
  ['audio.effects', { tab: 'Screens', type: 'range', default: 0.8, min: 0, max: 1, step: 0.05, label: 'Effects volume',
    note: 'Gunfire, cannon, drum and bugle calls, horses, the field\'s wind and birds, and the reward card sounds.' }],
  ['audio.music', { tab: 'Screens', type: 'range', default: 0.6, min: 0, max: 1, step: 0.05, label: 'Music volume',
    note: 'Period music on the title, in camp and on the results; never over a battle. Streamed, not downloaded up front.' }],
  ['audio.voices', { tab: 'Screens', type: 'range', default: 0.8, min: 0, max: 1, step: 0.05, label: 'Voices volume',
    note: 'Cheers and shouts on the field.' }],
  ['audio.mute', { tab: 'Screens', type: 'toggle', default: false, label: 'Mute all sound',
    note: 'Silences every sound, music included; the volumes are kept for when you switch it back.' }],
]);
export function defineAudioSettings(S = { define }) { for (const [key, spec] of AUDIO_SETTINGS) S.define(key, spec); }
defineAudioSettings();

export const BUSES = Object.freeze(['effects', 'ambient', 'voices', 'music', 'ui']);
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
/** The slider levels now ({ master, effects, music, voices, mute }); `read` is settings.get (tests pass their own). */
export function levels(read = get) {
  return { master: read('audio.master'), effects: read('audio.effects'), music: read('audio.music'), voices: read('audio.voices'), mute: read('audio.mute') === true };
}
/** A bus's linear level: master x its slider, 0 when muted. */
export function busLevel(bus, v) {
  if (!v || v.mute) return 0;
  const slider = bus === 'music' ? v.music : bus === 'voices' ? v.voices : v.effects; // effects, ambient, ui
  return clamp01(clamp01(v.master) * clamp01(slider));
}
/** The gain node value for a bus: the level squared (equal steps on the slider sound like equal steps). */
export function busGain(bus, v, duck = 1) { const l = busLevel(bus, v); return l * l * clamp01(duck); }

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
const LOG_MAX = 64;

export class Mixer {
  constructor({ read = get } = {}) {
    this.read = read;
    this.ctx = null;
    this.buses = {};
    this.ducks = { effects: 1, ambient: 1, voices: 1, music: 1, ui: 1 };
    this.buffers = new Map(); // id -> AudioBuffer
    this.pending = new Map(); // id -> Promise<AudioBuffer|null>
    this.waiting = new Set(); // fns to run once unlocked
    this.voices = new Set(); // live handles
    this.log = [];
    this.armed = false;
    this.off = on('*', (_, key) => { if (String(key).startsWith('audio.')) this.applyLevels(); });
  }

  get unlocked() { return !!this.ctx; }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Listen for the first gesture (safe to call more than once); unlock() runs inside it. */
  arm() {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    const go = () => {
      this.unlock();
      if (this.running) for (const g of GESTURES) window.removeEventListener(g, go, true);
    };
    for (const g of GESTURES) window.addEventListener(g, go, true);
  }

  /** Build the graph (first call) and resume it. Call only from a user gesture. Returns the AudioContext or null. */
  unlock() {
    if (!this.ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { this.ctx = null; return null; }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
      comp.connect(ctx.destination);
      for (const bus of BUSES) { const g = ctx.createGain(); g.gain.value = 0; g.connect(comp); this.buses[bus] = g; }
      this.applyLevels(true);
      const fns = [...this.waiting]; this.waiting.clear();
      for (const fn of fns) { try { fn(); } catch (err) { console.warn('audio: an unlock task failed:', err?.message ?? err); } }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** fn() once the graph exists (at once if it does). */
  onUnlock(fn) { if (this.ctx) fn(); else this.waiting.add(fn); }

  bus(name) { return this.buses[name] || null; }
  level(bus) { return busLevel(bus, levels(this.read)); }
  gainOf(bus) { return busGain(bus, levels(this.read), this.ducks[bus] ?? 1); }

  applyLevels(now = false) {
    if (!this.ctx) return;
    for (const bus of BUSES) {
      const g = this.buses[bus], v = this.gainOf(bus);
      if (now) g.gain.value = v; else g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  /** Lower (factor < 1) or restore (1) one bus, gliding over about `seconds`. */
  duck(bus, factor, seconds = 0.4) {
    const f = clamp01(factor);
    if (this.ducks[bus] === f) return;
    this.ducks[bus] = f;
    if (!this.ctx) return;
    this.buses[bus].gain.setTargetAtTime(this.gainOf(bus), this.ctx.currentTime, Math.max(0.01, seconds / 3));
  }

  url(id) { return new URL(`../../${AUDIO_DIR}${SOUNDS[id].file}`, import.meta.url).href; }

  /** Fetch and decode one sound (after the first gesture); resolves to its buffer, or null if it cannot load. */
  load(id) {
    if (!SOUNDS[id] || SOUNDS[id].stream) return Promise.resolve(null);
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    const p = new Promise((resolve) => this.onUnlock(() => resolve(this.fetchDecode(id))));
    this.pending.set(id, p);
    return p;
  }
  async fetchDecode(id) {
    try {
      const res = await fetch(this.url(id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const buf = await new Promise((ok, fail) => {
        const r = this.ctx.decodeAudioData(bytes, ok, fail); // callback form for older Safari; the promise form also returns
        if (r && typeof r.then === 'function') r.then(ok, fail);
      });
      this.buffers.set(id, buf);
      return buf;
    } catch (err) {
      console.warn(`audio: ${id} not loaded:`, err?.message ?? err);
      return null;
    } finally {
      this.pending.delete(id);
    }
  }
  /** Load every sound of a bank (bank.js bankIds). */
  loadBank(bank, opts) { return Promise.all(bankIds(bank, opts).map((id) => this.load(id))); }
  has(id) { return this.buffers.has(id); }

  /**
   * Play a loaded sound now. opts: { bus (default the bank's), gain 0..1, pan -1..1, rate, lowpass (Hz, 0 = none), loop }.
   * Returns a handle { id, bus, duration, loop, stop(fade), setGain(v, seconds), setPan(p) } or null (not unlocked,
   * not loaded, or the bus is silent). Every request is recorded in mixer.log.
   */
  play(id, { bus = SOUNDS[id]?.bus || 'effects', gain = 1, pan = 0, rate = 1, lowpass = 0, loop = false } = {}) {
    const entry = { id, bus, gain: Math.round(gain * 1000) / 1000, pan: Math.round(pan * 100) / 100, ok: false };
    this.log.push(entry);
    if (this.log.length > LOG_MAX) this.log.shift();
    const buf = this.buffers.get(id);
    if (!this.ctx || !buf || this.gainOf(bus) <= 0 || !(gain > 0)) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!loop; src.playbackRate.value = rate > 0 ? rate : 1;
    let node = src;
    if (lowpass > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
    const g = ctx.createGain(); g.gain.value = clamp01(gain); node.connect(g); node = g;
    let panner = null;
    if (pan && typeof ctx.createStereoPanner === 'function') { panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(panner); node = panner; }
    node.connect(this.buses[bus] || this.buses.effects);
    const handle = {
      id, bus, loop: !!loop, duration: buf.duration / src.playbackRate.value, stopped: false,
      stop: (fade = 0.05) => {
        if (handle.stopped) return;
        handle.stopped = true;
        const t = ctx.currentTime;
        try { g.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3)); src.stop(t + fade + 0.05); } catch { /* already ended */ }
      },
      setGain: (v, seconds = 0.3) => { if (!handle.stopped) g.gain.setTargetAtTime(clamp01(v), ctx.currentTime, Math.max(0.01, seconds / 3)); },
      setPan: (p) => { if (panner) panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), ctx.currentTime, 0.05); },
    };
    src.onended = () => { this.voices.delete(handle); try { src.disconnect(); g.disconnect(); panner?.disconnect(); } catch { /* fine */ } };
    this.voices.add(handle);
    src.start();
    entry.ok = true;
    return handle;
  }

  /** Stop every one-shot (not loops) on a bus, with a short fade. */
  stopBus(bus, fade = 0.15) { for (const h of [...this.voices]) if (h.bus === bus && !h.loop) h.stop(fade); }

  stats() { return { state: this.ctx ? this.ctx.state : 'locked', voices: this.voices.size, loaded: [...this.buffers.keys()].sort() }; }
}

/** The page's mixer (created without side effects: no context, no requests, until a gesture). */
export const mixer = new Mixer();

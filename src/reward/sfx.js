// src/reward/sfx.js: synthesised reward sounds (Web Audio API; no audio files).
//
//   armAudio()            listen for the first user gesture; the AudioContext is created inside it (iPad Safari
//                         and Chrome only allow audio to start from a gesture). Nothing plays before that.
//   setSoundOn(bool)      the mute setting (screens.sound); off = silence, not a paused queue
//   play(name, opts)      'deal' | 'flip' {rank, level} | 'riser' {dur} | 'sting' {level} | 'tick' {step}
//                         | 'up' | 'down' | 'equip' | 'select' | 'cancel' | 'whoosh' | 'stamp'
//   level: 'full' | 'subtle' (the fanfare setting; 'off' is handled by the caller: flip sound only)
// Every sound is a few oscillators or a noise burst with short envelopes: cheap on the UHD 617 and A10X.
// Note: on iPad the hardware silent switch mutes Web Audio.

let ctx = null;
let out = null; // master gain
let noiseBuf = null;
let soundOn = true;
let armed = false;

const GESTURES = ['pointerdown', 'keydown', 'touchend'];

function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
    return;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  out = ctx.createGain();
  out.gain.value = soundOn ? 0.8 : 0;
  out.connect(comp).connect(ctx.destination);
  // two seconds of white noise, reused (looped) by every noise sound
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/** Start listening for the first gesture. Safe to call more than once. */
export function armAudio() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const go = () => {
    unlock();
    if (ctx && ctx.state !== 'suspended') for (const g of GESTURES) window.removeEventListener(g, go, true);
  };
  for (const g of GESTURES) window.addEventListener(g, go, true);
}

export function setSoundOn(on) {
  soundOn = !!on;
  if (out && ctx) out.gain.setTargetAtTime(soundOn ? 0.8 : 0, ctx.currentTime, 0.02);
}

export function audioReady() {
  return !!ctx && ctx.state === 'running';
}

// ---- building blocks ----------------------------------------------------------------------------------
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq, t, { type = 'sine', peak = 0.15, attack = 0.005, decay = 0.2, glide = 0, detune = 0, dest = out } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + attack + decay);
  if (detune) o.detune.value = detune;
  env(g, t, peak, attack, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function noise(t, { dur = 0.08, filter = 'bandpass', freq = 2000, to = 0, q = 1, peak = 0.2, attack = 0.004 } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + dur + 0.05);
}

// note frequencies (equal temperament, A4 = 440)
const N = { C4: 261.63, E4: 329.63, G4: 392.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

const SOUNDS = {
  deal(t) {
    noise(t, { dur: 0.06, filter: 'bandpass', freq: 3200, to: 1400, q: 0.8, peak: 0.12 });
  },
  flip(t, { rank = 0, level = 'full' } = {}) {
    // paper snap
    noise(t, { dur: 0.05, filter: 'highpass', freq: 2400, q: 0.7, peak: 0.22 });
    tone(180, t, { type: 'triangle', peak: 0.08, decay: 0.06, glide: 120 });
    if (level === 'off' || rank === 0) return;
    const soft = level === 'subtle' ? 0.5 : 1;
    // rising tones per rarity: Uncommon one note, Rare two, Very Rare a quick four-note run
    const runs = { 1: [N.E5], 2: [N.C5, N.G5], 3: [N.C5, N.E5, N.G5, N.C6], 4: [N.C5, N.E5, N.G5, N.C6] };
    (runs[rank] || []).forEach((f, i) => {
      tone(f, t + 0.05 + i * 0.07, { type: 'triangle', peak: 0.12 * soft, attack: 0.008, decay: 0.32 + i * 0.05 });
      tone(f * 2, t + 0.05 + i * 0.07, { type: 'sine', peak: 0.03 * soft, decay: 0.25 });
    });
  },
  riser(t, { dur = 0.9 } = {}) {
    // the Legendary's held beat: a filtered-noise swell with a rising tone under it
    noise(t, { dur, filter: 'bandpass', freq: 300, to: 3800, q: 2.5, peak: 0.16, attack: dur * 0.85 });
    tone(110, t, { type: 'sawtooth', peak: 0.035, attack: dur * 0.9, decay: 0.1, glide: 440 });
  },
  sting(t, { level = 'full' } = {}) {
    const soft = level === 'subtle' ? 0.45 : 1;
    // low thump
    tone(90, t, { type: 'sine', peak: 0.5 * soft, attack: 0.004, decay: 0.45, glide: 42 });
    // brassy major chord through an opening filter
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.35);
    f.Q.value = 3;
    f.connect(out);
    for (const [fr, dt] of [[N.C4, -6], [N.E4, 5], [N.G4, -4], [N.C5, 7], [N.G5, 0]]) {
      tone(fr, t + 0.01, { type: 'sawtooth', peak: 0.07 * soft, attack: 0.03, decay: 1.6, detune: dt, dest: f });
    }
    if (level === 'subtle') return;
    // shimmer
    [N.C6, N.E6, N.G6, N.C7].forEach((fr, i) => tone(fr, t + 0.18 + i * 0.06, { type: 'triangle', peak: 0.05, decay: 0.7 }));
    noise(t + 0.02, { dur: 0.9, filter: 'highpass', freq: 6000, q: 0.5, peak: 0.05, attack: 0.02 });
  },
  tick(t, { step = 0 } = {}) {
    tone(900 + Math.min(step, 30) * 22, t, { type: 'square', peak: 0.025, attack: 0.002, decay: 0.03 });
  },
  up(t) {
    tone(N.G5, t, { type: 'triangle', peak: 0.12, decay: 0.15 });
    tone(N.C6, t + 0.08, { type: 'triangle', peak: 0.12, decay: 0.3 });
  },
  down(t) {
    tone(N.E5, t, { type: 'triangle', peak: 0.1, decay: 0.15 });
    tone(N.C5, t + 0.08, { type: 'triangle', peak: 0.1, decay: 0.3 });
  },
  equip(t) {
    noise(t, { dur: 0.05, filter: 'lowpass', freq: 1200, q: 0.7, peak: 0.25 });
    tone(150, t, { type: 'sine', peak: 0.35, decay: 0.16, glide: 70 });
    tone(N.C5, t + 0.06, { type: 'triangle', peak: 0.08, decay: 0.2 });
    tone(N.G5, t + 0.12, { type: 'triangle', peak: 0.08, decay: 0.3 });
  },
  select(t) {
    tone(N.A5, t, { type: 'triangle', peak: 0.07, decay: 0.05 });
  },
  cancel(t) {
    tone(N.E5, t, { type: 'triangle', peak: 0.07, decay: 0.08, glide: N.C5 });
  },
  whoosh(t) {
    noise(t, { dur: 0.28, filter: 'bandpass', freq: 900, to: 220, q: 1.2, peak: 0.12, attack: 0.05 });
  },
  stamp(t) {
    tone(70, t, { type: 'sine', peak: 0.45, decay: 0.3, glide: 40 });
    noise(t, { dur: 0.12, filter: 'lowpass', freq: 900, q: 0.5, peak: 0.25 });
  },
};

/** Play a named sound now (or `delay` seconds from now). Silent until the first gesture, or when muted. */
export function play(name, opts = {}) {
  if (!ctx || !soundOn || !out) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    fn(ctx.currentTime + 0.01 + (opts.delay || 0), opts);
  } catch (err) {
    console.warn('reward sfx failed:', name, err);
  }
}

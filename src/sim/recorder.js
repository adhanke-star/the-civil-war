// src/sim/recorder.js: the after-action map replay's recorder. It reads the battle, never changes it.
//
//   attachRecorder(game, opts?)  -> the game's Recorder (one per game); src/game.js calls recorder.observe(game) at the end
//                                   of every tick, and the first sample is taken here at attach time
//   recorder.track(game?)        -> the replay track as plain JSON data (a last sample is taken at the game's current time)
//   validateReplay(track)        -> a frozen, validated copy, or throws 'Replay: ...'
//   replayFrame(track, t)        -> every formation at sim time t (positions, facing and strength interpolated between
//                                   samples; state and objective holder from the earlier sample)
//   replayClock(track, t)        -> 'HH:MM' on the phase's historical clock at sim time t (null without a clock)
//
// Every REPLAY_LIMITS.interval sim seconds (4: a 20-minute phase is 301 samples, under the cap of 320) it records each formation's centre,
// facing, strength and state (formed / shaken / routed / gone) and which side holds the objective. Memory is bounded:
// when a sample would pass REPLAY_LIMITS.samples, every other sample is dropped and the interval doubles, so a long
// fight-on keeps the whole battle at a coarser step. No randomness and no writes to the game: attaching a recorder
// changes no simulation result (tools/test-history.mjs proves it on a pack phase).
//
// Track: { version: 1, interval, clock: { start: 'HH:MM', ratio } | null, objective: { name, x, z, r } | null,
//          units: [{ id, side, type, name, menStart }], samples: [{ t, holder, u: [x, z, facing, men, state, ...] }] }
// `u` holds five numbers per formation in `units` order; a formation that arrived later is absent from earlier samples
// (the array is shorter). state: 0 formed, 1 shaken (shaken or wavering), 2 routed, 3 gone (destroyed, captured, removed).

export const REPLAY_LIMITS = Object.freeze({ interval: 4, samples: 320, units: 64, bytes: 1024 * 1024 });
export const REPLAY_STATES = Object.freeze(['formed', 'shaken', 'routed', 'gone']);
export const REPLAY_HOLDERS = Object.freeze(['none', 'US', 'CS', 'contested']);
const fail = (message) => { throw new Error(`Replay: ${message}`); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round = (v, k = 1) => Math.round(v * k) / k + 0;
const HHMM = /^\d{2}:\d{2}$/;

function stateOf(u) {
  if (u.removed || !(u.men >= 1) || u.state === 'captured') return 3;
  if (u.state === 'routing') return 2;
  return u.state === 'shaken' || u.state === 'wavering' ? 1 : 0;
}

export class Recorder {
  constructor({ interval = REPLAY_LIMITS.interval, maxSamples = REPLAY_LIMITS.samples } = {}) {
    if (!finite(interval) || interval <= 0 || !Number.isSafeInteger(maxSamples) || maxSamples < 4) fail('recorder needs a positive interval and room for samples.');
    this.interval = interval;
    this.maxSamples = maxSamples;
    this.units = []; // { id, side, type, name, menStart }
    this.index = new Map(); // live unit -> index in this.units
    this.samples = [];
    this.next = 0;
    this.meta = null;
    this.finished = false;
  }

  /** Per tick (src/game.js): a sample when the interval has passed, and one final sample when the game ends. */
  observe(game) {
    if (game.over) { if (!this.finished) { this.finished = true; this.sample(game); } return; }
    if (game.simTime + 1e-9 >= this.next) this.sample(game);
  }

  /** One sample now (the cap halves the stored samples and doubles the interval before it overflows). */
  sample(game) {
    if (!this.meta) this.meta = metaOf(game);
    const t = round(game.simTime, 100);
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) fail('sim time went backwards.');
    if (last && t === last.t) this.samples.pop(); // the same instant again (a final sample): keep the newest reading
    if (this.samples.length >= this.maxSamples) {
      this.samples = this.samples.filter((_, i) => i % 2 === 0);
      this.interval *= 2;
    }
    for (const u of game.units) {
      if (this.index.has(u) || this.units.length >= REPLAY_LIMITS.units) continue;
      this.index.set(u, this.units.length);
      this.units.push({ id: String(u.id), side: u.side === 'CS' ? 'CS' : 'US', type: ['artillery', 'cavalry'].includes(u.type) ? u.type : 'infantry',
        name: String(u.short || u.name || u.id), menStart: Math.max(1, Math.round(u.menMax || u.men || 1)) });
    }
    const u = new Array(this.units.length * 5);
    const seen = new Set();
    for (const unit of game.units) {
      const i = this.index.get(unit);
      if (i === undefined) continue;
      seen.add(i);
      u[i * 5] = round(unit.x); u[i * 5 + 1] = round(unit.z); u[i * 5 + 2] = round(unit.facing || 0, 100);
      u[i * 5 + 3] = Math.max(0, Math.floor(unit.men || 0)); u[i * 5 + 4] = stateOf(unit);
    }
    // a formation the game no longer lists (sandbox removal) is gone where it was last seen
    for (let i = 0; i < this.units.length; i++) {
      if (seen.has(i)) continue;
      const prev = last && last.u.length > i * 5 ? last.u : null;
      u[i * 5] = prev ? prev[i * 5] : 0; u[i * 5 + 1] = prev ? prev[i * 5 + 1] : 0; u[i * 5 + 2] = prev ? prev[i * 5 + 2] : 0;
      u[i * 5 + 3] = 0; u[i * 5 + 4] = 3;
    }
    const holder = REPLAY_HOLDERS.includes(game.holder) ? game.holder : 'none';
    this.samples.push({ t, holder, u });
    this.next = t + this.interval;
  }

  /** The track as plain data; a last sample at the game's current time when it is past the newest one. */
  track(game = null) {
    if (game && game.over && !this.finished) { this.finished = true; this.sample(game); } // a result forced without a tick
    else if (game && (!this.samples.length || round(game.simTime, 100) > this.samples[this.samples.length - 1].t)) this.sample(game);
    if (!this.samples.length) fail('nothing was recorded.');
    return { version: 1, interval: this.interval, clock: this.meta.clock, objective: this.meta.objective,
      units: this.units.map((x) => ({ ...x })), samples: this.samples.map((s) => ({ t: s.t, holder: s.holder, u: s.u.slice() })) };
  }
}

function metaOf(game) {
  const s = game.scenario || {}, o = game.objective || s.objective;
  const ratio = finite(game.clockRatio) ? game.clockRatio : finite(s.clockRatio) ? s.clockRatio : null;
  const clock = typeof s.start === 'string' && HHMM.test(s.start) && ratio && !s.practiceIntro ? { start: s.start, ratio } : null;
  const objective = o && finite(o.x) && finite(o.z) && finite(o.r) ? { name: String(o.name || 'the objective'), x: round(o.x), z: round(o.z), r: round(o.r) } : null;
  return { clock, objective };
}

/** One recorder per game: attach before the battle starts (the first sample is its opening positions). */
export function attachRecorder(game, opts) {
  if (!game || !Array.isArray(game.units)) fail('a recorder needs a game.');
  if (!game.recorder) {
    game.recorder = new Recorder(opts);
    game.recorder.sample(game);
  }
  return game.recorder;
}

function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}

/** Validate a track (shape, bounds, monotonic time, finite numbers) and return a frozen copy. */
export function validateReplay(track) {
  if (!record(track) || track.version !== 1) fail('unsupported replay version.');
  const keys = ['version', 'interval', 'clock', 'objective', 'units', 'samples'];
  if (Object.keys(track).length !== keys.length || keys.some((k) => !own(track, k))) fail('replay has missing or unsupported fields.');
  if (!finite(track.interval) || track.interval <= 0) fail('replay interval must be positive.');
  if (track.clock !== null && (!record(track.clock) || !HHMM.test(track.clock.start) || !finite(track.clock.ratio) || track.clock.ratio <= 0)) fail('replay clock is invalid.');
  const o = track.objective;
  if (o !== null && (!record(o) || typeof o.name !== 'string' || !['x', 'z', 'r'].every((k) => finite(o[k])) || o.r <= 0)) fail('replay objective is invalid.');
  if (!Array.isArray(track.units) || track.units.length > REPLAY_LIMITS.units) fail('replay units are missing or too many.');
  const ids = new Set();
  for (const u of track.units) {
    if (!record(u) || typeof u.id !== 'string' || !u.id || ids.has(u.id) || !['US', 'CS'].includes(u.side)
      || !['infantry', 'artillery', 'cavalry'].includes(u.type) || typeof u.name !== 'string'
      || !Number.isSafeInteger(u.menStart) || u.menStart < 1) fail('replay unit is invalid.');
    ids.add(u.id);
  }
  if (!Array.isArray(track.samples) || !track.samples.length || track.samples.length > REPLAY_LIMITS.samples) fail('replay samples are missing or too many.');
  let last = -Infinity, width = 0;
  for (const s of track.samples) {
    if (!record(s) || !finite(s.t) || s.t < 0 || s.t <= last || !REPLAY_HOLDERS.includes(s.holder) || !Array.isArray(s.u)
      || s.u.length % 5 || s.u.length / 5 > track.units.length || s.u.length < width) fail('replay sample is invalid.');
    for (let i = 0; i < s.u.length; i += 5) {
      if (!finite(s.u[i]) || !finite(s.u[i + 1]) || !finite(s.u[i + 2]) || !Number.isSafeInteger(s.u[i + 3]) || s.u[i + 3] < 0
        || ![0, 1, 2, 3].includes(s.u[i + 4])) fail('replay sample values are invalid.');
    }
    last = s.t; width = s.u.length;
  }
  if (new TextEncoder().encode(JSON.stringify(track)).length > REPLAY_LIMITS.bytes) fail('replay exceeds its byte bound.');
  return frozen(JSON.parse(JSON.stringify(track)));
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Every recorded formation at sim time t (clamped to the track), interpolated between the two samples around it. */
export function replayFrame(track, t) {
  const S = track.samples, end = S[S.length - 1].t;
  const at = Math.max(S[0].t, Math.min(end, typeof t === 'number' && !Number.isNaN(t) ? t : 0)); // Infinity = the end
  let i = 0;
  while (i < S.length - 1 && S[i + 1].t <= at) i++;
  const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
  const k = b.t > a.t ? (at - a.t) / (b.t - a.t) : 0;
  const units = [];
  for (let n = 0; n * 5 < a.u.length; n++) {
    const j = n * 5, def = track.units[n], nb = b.u.length > j;
    const lerp = (q) => (nb ? a.u[j + q] + (b.u[j + q] - a.u[j + q]) * k : a.u[j + q]);
    const facing = nb ? a.u[j + 2] + wrap(b.u[j + 2] - a.u[j + 2]) * k : a.u[j + 2];
    const men = lerp(3);
    units.push({ index: n, id: def.id, side: def.side, type: def.type, name: def.name, x: lerp(0), z: lerp(1), facing, men,
      frac: Math.max(0, Math.min(1, men / def.menStart)), state: REPLAY_STATES[a.u[j + 4]] });
  }
  return { t: at, sample: i, holder: a.holder, units };
}

/** The historical clock at sim time t: start + t * ratio seconds, as HH:MM (null when the track has no clock). */
export function replayClock(track, t) {
  if (!track.clock) return null;
  const [h, m] = track.clock.start.split(':').map(Number);
  const s = h * 3600 + m * 60 + Math.max(0, t) * track.clock.ratio;
  const hh = Math.floor(s / 3600) % 24, mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

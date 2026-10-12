// src/audio/director.js: the battle's sound director (DESIGN §4 Sound: gunfire, drum and bugle calls as order feedback,
// voices, an ambient field that swells with the fighting).
//
// Spawn points call it (src/fx/effects.js: volleys, cannon, shell bursts); src/main.js reads the game once a frame
// (update: who is firing, charges, mounted cavalry on the move, pause, season) and reports the player's orders.
//   volley(x, z, men)  a company volley (a single shot for under 80 men): louder for bigger units, quieter and duller
//                      with distance, panned by where it is on screen
//   cannon / burst     a gun's report; a shell bursting over its target
//   cheer(x, z)        a charge goes in
//   order(kind)        one short call per order kind (bank.js ORDER_CALLS, each labelled), rate-limited; returns the label
//   update(dt, state)  the rolling-fire bed follows how many units fire; season ambience; horses; pause stops the
//                      effects and ducks the ambience
// A cap on simultaneous one-shot voices and a cooldown per type keep a big fight from turning to noise. Nothing here
// touches the simulation or its random numbers (variants use Math.random). `now` and `locate` are injected, so the
// CPU test drives it with a fake clock and a fake mixer.

import { ORDER_CALLS, ambientFor } from './bank.js';

export const DIRECTOR = Object.freeze({
  maxVoices: 8, // one-shots at once (loops and order calls not counted)
  cooldown: Object.freeze({ volley: 0.09, shot: 0.06, cannon: 0.22, burst: 0.18, cheer: 2.5, whinny: 18 }),
  callGap: 1.2, // seconds between any two order calls
  callRepeat: 4, // seconds before the same order kind sounds again
  smallUnit: 80, // men: below this a volley is a single shot
  bedFull: 10, // units firing at once for the rolling-fire bed at full level
  bedMax: 0.75, ambient: 0.55, pausedAmbient: 0.35, horses: 0.45,
});
const VOLLEYS = ['volley-1', 'volley-2', 'volley-3'], SHOTS = ['shot-1', 'shot-2'];

export class Director {
  /**
   * mixer: { play(id, opts) -> handle|null, has(id), stopBus(bus), duck(bus, f), load?(id) };
   * now(): seconds; locate(x, z): { pan -1..1, gain 0..1, lowpass Hz|0 } for a point on the field.
   */
  constructor({ mixer, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
    locate = () => ({ pan: 0, gain: 1, lowpass: 0 }), rnd = Math.random } = {}) {
    Object.assign(this, { mixer, now, locate, rnd });
    this.last = {}; // type -> time of its last sound
    this.calls = {}; // order kind -> time of its last call
    this.lastCall = -1e9;
    this.active = []; // end times of live one-shots
    this.paused = false;
    this.bed = null; this.ambient = null; this.ambientId = null; this.horses = null;
    this.firing = 0;
    this.counts = { played: 0, capped: 0, cooled: 0 };
  }

  /** Live one-shot voices now. */
  voices() {
    const t = this.now();
    this.active = this.active.filter((end) => end > t);
    return this.active.length;
  }

  /** May a one-shot of `type` play now? (not paused, under the voice cap, past its cooldown) */
  allow(type) {
    if (this.paused) return false;
    const t = this.now(), cd = DIRECTOR.cooldown[type] ?? 0;
    if (t - (this.last[type] ?? -1e9) < cd) { this.counts.cooled++; return false; }
    if (this.voices() >= DIRECTOR.maxVoices) { this.counts.capped++; return false; }
    return true;
  }

  /** Play a one-shot of `type` at (x, z); returns the handle or null. */
  shot(type, id, x, z, { gain = 1, rate = 1, bus } = {}) {
    if (!this.allow(type)) return null;
    const at = Number.isFinite(x) ? this.locate(x, z) : { pan: 0, gain: 1, lowpass: 0 };
    const g = gain * at.gain;
    if (g < 0.04) return null;
    const h = this.mixer.play(id, { gain: Math.min(1, g), pan: at.pan, lowpass: at.lowpass, rate, ...(bus ? { bus } : {}) });
    const t = this.now();
    this.last[type] = t;
    if (h) { this.active.push(t + h.duration); this.counts.played++; }
    return h;
  }

  /** A volley from a unit of `men` at (x, z). */
  volley(x, z, men = 300) {
    const pick = (list) => list[Math.floor(this.rnd() * list.length) % list.length];
    if (men < DIRECTOR.smallUnit) return this.shot('shot', pick(SHOTS), x, z, { gain: 0.8, rate: 0.94 + this.rnd() * 0.12 });
    const size = 0.5 + 0.5 * Math.min(1, men / 500);
    return this.shot('volley', pick(VOLLEYS), x, z, { gain: size, rate: 0.92 + this.rnd() * 0.16 });
  }
  cannon(x, z) { return this.shot('cannon', 'cannon', x, z, { gain: 1, rate: 0.9 + this.rnd() * 0.2 }); }
  burst(x, z) { return this.shot('burst', 'shell-burst', x, z, { gain: 0.9, rate: 0.9 + this.rnd() * 0.2 }); }
  cheer(x, z) { return this.shot('cheer', 'cheer', x, z, { gain: 0.85, rate: 0.92 + this.rnd() * 0.12, bus: 'voices' }); }

  /** The player's order of `kind`: its call (centre, not panned), at most one per callGap and per kind per callRepeat. */
  order(kind) {
    const call = ORDER_CALLS[kind];
    if (!call) return null;
    const t = this.now();
    if (t - this.lastCall < DIRECTOR.callGap || t - (this.calls[kind] ?? -1e9) < DIRECTOR.callRepeat) return null;
    this.lastCall = t; this.calls[kind] = t;
    this.mixer.play(call.id, { gain: 0.7 });
    return call.label;
  }

  /**
   * Once a frame. state: { paused, firing (units firing now), season, cavalry: { x, z } | null (a mounted cavalry
   * brigade on the move, nearest the view) }.
   */
  update(dt, { paused = false, firing = 0, season, cavalry = null } = {}) {
    const m = this.mixer;
    if (paused !== this.paused) {
      this.paused = paused;
      if (paused) { m.stopBus?.('effects'); m.stopBus?.('voices'); this.active = []; }
      m.duck?.('ambient', paused ? DIRECTOR.pausedAmbient / DIRECTOR.ambient : 1);
    }
    // season ambience (looping all battle; ducked while paused)
    const amb = ambientFor(season);
    if (this.ambientId !== amb || (this.ambient && this.ambient.stopped)) { this.ambient?.stop(1); this.ambient = null; this.ambientId = amb; }
    if (!this.ambient && m.has(amb)) this.ambient = m.play(amb, { loop: true, gain: DIRECTOR.ambient });
    // the rolling-fire bed follows how many units are firing
    this.firing = firing;
    const bedLevel = paused ? 0 : DIRECTOR.bedMax * Math.pow(Math.min(1, firing / DIRECTOR.bedFull), 0.7);
    if (!this.bed && bedLevel > 0 && m.has('fire-bed')) this.bed = m.play('fire-bed', { loop: true, gain: 0.001 });
    this.bed?.setGain(bedLevel, bedLevel > 0 ? 1.5 : 0.6);
    // horses while mounted cavalry moves
    const ride = !paused && cavalry ? this.locate(cavalry.x, cavalry.z) : null;
    if (ride && !this.horses && m.has('horse-gallop')) this.horses = m.play('horse-gallop', { loop: true, gain: 0.001 });
    if (this.horses) { this.horses.setGain(ride ? DIRECTOR.horses * ride.gain : 0, 0.8); if (ride) this.horses.setPan(ride.pan); }
    if (ride && this.rnd() < dt / 12) this.shot('whinny', 'horse-whinny', cavalry.x, cavalry.z, { gain: 0.6 });
    return bedLevel;
  }

  /** Stop the loops (the field is left). */
  stop() { for (const h of [this.bed, this.ambient, this.horses]) h?.stop(0.5); this.bed = this.ambient = this.horses = null; this.ambientId = null; }
}

// Generic held-ground drops. Two seconds of exclusive presence; no rewards minted on capture events.
// Presence rule reused from frozen T0-field-sandbox.js fldObjectiveStep; timing is game calibration.
// Captured colours (ColourCaptures, below): which regiment colours a battle's formations took, zero random draws.
import { TIER_BY_ID } from '../reward/data.js';

export class FieldCaptures {
  constructor(defs = []) {
    if (!Array.isArray(defs) || defs.length > 20) throw new Error('Invalid field crates');
    const ids = new Set();
    this.crates = defs.map((d) => {
      if (!d || typeof d.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(d.id) || ids.has(d.id)
        || typeof d.name !== 'string' || !d.name.length || d.name.length > 80 || typeof d.tier !== 'string' || !Object.hasOwn(TIER_BY_ID, d.tier)
        || ![d.x, d.z, d.r].every(Number.isFinite) || Math.abs(d.x) > 10000 || Math.abs(d.z) > 10000
        || d.r < 10 || d.r > 200) throw new Error('Invalid field crate');
      ids.add(d.id);
      return { ...d, owner: null, status: 'unclaimed', candidate: null, seconds: 0 };
    });
  }

  step(units, dt) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Invalid capture step');
    const events = [];
    for (const c of this.crates) {
      const present = new Set(units.filter((u) => u.men >= 1 && u.alive !== false && u.state !== 'routing'
        && ['US', 'CS'].includes(u.side) && Math.hypot(u.x - c.x, u.z - c.z) <= c.r).map((u) => u.side));
      const side = present.size === 1 ? [...present][0] : null;
      c.status = present.size === 2 ? 'contested' : side || (c.owner ? 'held' : 'unclaimed');
      if (!side || side === c.owner) { c.candidate = null; c.seconds = 0; continue; }
      if (c.candidate !== side) { c.candidate = side; c.seconds = 0; }
      c.seconds = Math.min(2, c.seconds + dt);
      if (c.seconds + 1e-8 >= 2) {
        const previous = c.owner; c.owner = side; c.candidate = null; c.seconds = 0;
        events.push({ id: c.id, side, previous, x: c.x, z: c.z, tier: c.tier, name: c.name });
      }
    }
    return events;
  }

  held(side = 'US') {
    return this.crates.filter((c) => c.owner === side && c.status !== 'contested').map((c) => ({
      id: c.id, tier: c.tier, from: `Captured: ${c.name} (fictional practice stores)`,
    }));
  }
}

// ---- captured colours (P5d; game rules in src/franchise/tuning.js COLOURS; src/game.js calls these) ----------------------
// Each named regiment (def.regiments, 1-8) of an infantry or cavalry formation carries one colour; batteries and formations
// without named regiments carry none (no label is ever invented). A colour is taken once, by one formation of the other side:
// all of a formation's remaining colours when it surrenders (to its captor) or is destroyed (to the nearest unbroken enemy
// within COLOURS.radius, which the game finds), one colour when it breaks with an enemy charge on it (to the charger: the
// regiment block nearest the charger across the broken line, else the next nearest still carried). No random draws.
const colourLabel = (u, r) => (typeof u.regiments?.[r] === 'string' ? u.regiments[r].trim() : '');

/** Regiment indexes of u ordered by how near each block's centre stands to (x, z) across u's front (nearest first). */
export function colourOrder(u, x, z) {
  const n = Array.isArray(u.regiments) ? u.regiments.length : 0;
  const w = Array.isArray(u.regWeights) && u.regWeights.length === n ? u.regWeights : Array.from({ length: n }, () => 1);
  const total = w.reduce((a, b) => a + b, 0) || 1, half = Math.max(1, u.halfFront || 1);
  const s = Math.sin(u.facing || 0), c = Math.cos(u.facing || 0), lateral = (x - u.x) * c - (z - u.z) * s;
  let cum = 0;
  const at = w.map((wr) => { const mid = (cum + wr / 2) / total; cum += wr; return (2 * mid - 1) * half; });
  return at.map((lx, r) => [Math.abs(lx - lateral), r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, r]) => r);
}

export class ColourCaptures {
  constructor() {
    this.taken = new Set(); // `${unitId}#${regiment index}`
    this.list = [];
  }

  /** Does this formation carry colours? Infantry or cavalry with 1-8 named regiments. */
  carries(u) {
    return !!u && u.type !== 'artillery' && Array.isArray(u.regiments) && u.regiments.length >= 1 && u.regiments.length <= 8;
  }

  /** Take regiment r's colour of u for `by` (once); the record, or null when it was taken already or has no name. */
  take(u, r, by, atSec, how) {
    const key = `${u.id}#${r}`, regiment = colourLabel(u, r);
    if (!this.carries(u) || !by || by.side === u.side || this.taken.has(key) || !regiment) return null;
    this.taken.add(key);
    const row = Object.freeze({ unitId: u.id, regiment, formation: u.short || u.name, side: u.side, byId: by.id, by: by.short || by.name,
      bySide: by.side, atSec, how });
    this.list.push(row);
    return row;
  }

  /** Every colour u still carries (a surrender or its destruction). */
  takeAll(u, by, atSec, how) {
    const out = [];
    if (!this.carries(u)) return out;
    for (let r = 0; r < u.regiments.length; r++) { const row = this.take(u, r, by, atSec, how); if (row) out.push(row); }
    return out;
  }

  /** One colour: the block nearest `by` still carried (an overrun). */
  takeNear(u, by, atSec, how) {
    if (!this.carries(u)) return [];
    for (const r of colourOrder(u, by.x, by.z)) { const row = this.take(u, r, by, atSec, how); if (row) return [row]; }
    return [];
  }

  /** Colours taken so far (by `side` when given), oldest first, as plain copies. */
  report(side = null) {
    return this.list.filter((r) => !side || r.bySide === side).map((r) => ({ ...r }));
  }
}

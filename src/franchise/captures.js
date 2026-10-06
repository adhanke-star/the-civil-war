// Generic held-ground drops. Two seconds of exclusive presence; no rewards minted on capture events.
// Presence rule reused from frozen T0-field-sandbox.js fldObjectiveStep; timing is game calibration.
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

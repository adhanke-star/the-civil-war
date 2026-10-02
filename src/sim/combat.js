// src/sim/combat.js: one universal combat model (fire, cover, morale, rout, rally, melee).
//
// Ported from the old Field rules (old repo src/tactical/T0-field-sandbox.js, fldResolveFire T0:802-851,
// fldMoraleStep T0:927-1023, fldResolveMelee T0:853-919; constants quoted there) with these deliberate
// changes, recorded in DECISIONS.md 0005:
//   - metres, not yards; rates are per sim second; 1 sim second = CLOCK_RATIO historical seconds;
//   - fire comes in ragged volleys whose period is the weapon's real rate of fire (old data/weapons.json
//     rateOfFire, Verified: 3 rounds/min for muskets; data/artillery.json 2 rounds/min for guns);
//   - a firing arc (65 degrees each side of the facing) and a terrain line-of-sight test (the old model
//     had neither, so a reverse slope gave no protection);
//   - the rout roll is a per-second rate (the old per-tick roll made rout near-instant);
//   - melee is symmetric (the old array-order quirk is gone) and capped;
//   - Fallback keeps the unit's face to the enemy (the old T39 bug turned its back);
//   - a walking line fires at half effect with a slower reload (no fire while running or charging); the
//     player's lines march to the end of their arrow, AI lines halt to engage inside 75% of their range.
// FIRE_BASE and the drains are tuned for a few minutes of fighting per brigade, not sourced (as in the old
// model, where FIRE_BASE was "tuned so the loop runs ~90 s").

export const CLOCK_RATIO = 4;
const YD = 0.9144;
export const RANGE = { smooth: 130 * YD, rifled: 320 * YD, artillery: 980 * YD };
const CANISTER = 150 * YD;
const POW = { smooth: 1.0, rifled: 1.25, parrott: 2.6, napoleon: 2.4, smbart: 1.6 };
const RELOAD = { musket: 60 / 3 / CLOCK_RATIO, gun: 60 / 2 / CLOCK_RATIO }; // sim seconds per round
const FIRE_BASE = 1.5;
const ARC = (65 * Math.PI) / 180;
const MELEE_RANGE = 34;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Combat {
  constructor({ units, terrain, coverAt, fallen, fx, rnd, autoHaltSides = ['CS'] }) {
    this.autoHalt = new Set(autoHaltSides);
    this.units = units;
    this.terrain = terrain;
    this.coverAt = coverAt; // (x, z) -> { value, kind }
    this.fallen = fallen; // side -> SoldierPool for casualties
    this.fx = fx; // { volley(unit, muzzles), boom(unit) }
    this.rnd = rnd;
    this.targetT = 0;
    this.log = [];
  }

  enemiesOf(u) {
    return this.units.filter((e) => e.side !== u.side && e.alive);
  }

  /** Terrain line of sight between two units, eyes 2.5 m up (real, before exaggeration). */
  los(a, b) {
    const T = this.terrain;
    const ax = a.x, az = a.z, bx = b.x, bz = b.z;
    const ha = T.heightAt(ax, az) + 6, hb = T.heightAt(bx, bz) + 6;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 15);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const h = T.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (h > ha + (hb - ha) * t + 1.5) return false;
    }
    return true;
  }

  /** Flank multiplier from where the shooter stands relative to the target's facing (old T0:788). */
  arcMult(shooter, target) {
    const bearing = Math.atan2(shooter.x - target.x, shooter.z - target.z);
    const rel = Math.abs(wrap(bearing - target.facing));
    return rel <= 0.28 * Math.PI ? 1 : rel <= 0.72 * Math.PI ? 1.5 : 2;
  }

  range(u) {
    return u.type === 'artillery' ? RANGE.artillery : RANGE[u.weapon] || RANGE.smooth;
  }

  pickTargets() {
    for (const u of this.units) {
      u.target = null;
      if (!u.alive || u.state === 'routing' || u.ammo <= 0) continue;
      const rng = this.range(u);
      let best = null, bestScore = -Infinity;
      for (const e of this.enemiesOf(u)) {
        const d = Math.hypot(e.x - u.x, e.z - u.z) - e.halfFront * 0.4;
        if (d > rng) continue;
        const bearing = Math.atan2(e.x - u.x, e.z - u.z);
        const off = Math.abs(wrap(bearing - u.facing));
        if (off > ARC + Math.atan2(e.halfFront, Math.max(1, d)) * 0.8) continue;
        if (!this.los(u, e)) continue;
        const score = (rng - d) / rng + 0.4 * (this.arcMult(u, e) - 1) + 0.5 * (1 - e.men / e.menMax) + (e.state === 'routing' ? -0.6 : 0);
        if (score > bestScore) { bestScore = score; best = e; }
      }
      u.target = best;
    }
  }

  step(dt, time) {
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = 0.5;
      this.pickTargets();
      for (const u of this.units) {
        const c = this.coverAt(u.x, u.z);
        u.cover = c.value;
        u.coverKind = c.kind;
        u.inWoods = c.kind === 'woods';
      }
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      this.fireStep(u, dt, time);
    }
    this.meleeStep(dt, time);
    for (const u of this.units) {
      if (!u.alive) continue;
      this.moraleStep(u, dt);
      this.fatigueStep(u, dt);
    }
  }

  fireStep(u, dt, time) {
    const t = u.target;
    const moving = u.follow.active && Math.hypot(u.vehicle.velocity.x, u.vehicle.velocity.z) > 0.5;
    const isArt = u.type === 'artillery';
    // An AI line on the march halts to engage an enemy well inside its range (unless charging or running).
    if (t && moving && this.autoHalt.has(u.side) && !u.run && u.order.type === 'move' && u.state !== 'routing') {
      const d = Math.hypot(t.x - u.x, t.z - u.z);
      if (d < this.range(u) * (isArt ? 0.8 : 0.75)) {
        u.stop();
        u.order = { type: 'hold' };
        u.goalFacing = Math.atan2(t.x - u.x, t.z - u.z);
      }
    }
    // Holding units turn to face their target.
    if (t && !u.follow.active && u.state !== 'routing') {
      const want = Math.atan2(t.x - u.x, t.z - u.z);
      if (Math.abs(wrap(want - u.facing)) > 0.12) u.goalFacing = want;
    }
    const canFire = t && !u.melee && u.state !== 'routing' && u.order.type !== 'charge' && !(moving && (u.run || isArt)) && (!isArt || u.unlimbered);
    u.firing = !!canFire && !moving;
    const period = (isArt ? RELOAD.gun : RELOAD.musket) * (1 + 0.5 * (u.fatigue / 100)) * (moving ? 1.5 : 1);
    if (u.reload < 1) u.reload = Math.min(1, u.reload + dt / period);
    if (!canFire || u.reload < 1) return;

    // Volley.
    u.reload = this.rnd() * 0.15;
    const d = Math.hypot(t.x - u.x, t.z - u.z);
    const rng = this.range(u);
    const rngF = clamp(1 - (d / rng) * (1 - 0.55), 0.55, 1);
    const xpF = 0.85 + 0.05 * u.xp;
    const ammoF = 0.5 + 0.5 * (u.ammo / 100);
    const morF = 0.6 + 0.4 * (u.morale / u.moraleMax);
    const fatF = 1 - 0.35 * (u.fatigue / 100);
    const arc = this.arcMult(u, t);
    let fireMen = u.men;
    let pow = POW[u.weapon] || 1;
    let art = 1;
    if (isArt) {
      fireMen = u.guns * 27 * clamp(u.men / u.menMax, 0, 1); // old GUN_FIRE_WEIGHT (T5:54)
      if (d <= CANISTER) art = 2.7 * clamp(1 - (t.cover - 1) * 1.15, 0.18, 1);
      else art = 0.5;
    }
    const heightAdv = this.terrain.heightAt(t.x, t.z) - this.terrain.heightAt(u.x, u.z) > 8 ? 1.1 : 1;
    const wav = (u.state === 'wavering' ? 0.7 : 1) * (moving ? 0.5 : 1);
    const rate = FIRE_BASE * (fireMen / 1500) * pow * rngF * xpF * ammoF * morF * fatF * art * arc * wav / (t.cover * heightAdv);
    const cas = Math.min(t.men, rate * period * (0.78 + this.rnd() * 0.44));
    t.takeLosses(cas, this.fallen[t.side], time);
    t.underFire = 1.4;
    if (arc > 1) t.flanked = 1.0;
    t.casTick = (t.casTick || 0) + cas;
    u.ammo = Math.max(0, u.ammo - (isArt ? 1.0 : 1.2)); // about 80 volleys (~7 sim min) per full box
    u.shots = (u.shots || 0) + 1;
    u.kills = (u.kills || 0) + cas;
    if (this.fx) {
      if (isArt) this.fx.boom(u, t, d <= CANISTER);
      else this.fx.volley(u, u.volley(time));
    }
  }

  meleeStep(dt, time) {
    for (const u of this.units) u.melee = false;
    const done = new Set();
    for (const a of this.units) {
      if (!a.alive || a.order.type !== 'charge' || a.state === 'routing') continue;
      for (const b of this.enemiesOf(a)) {
        if (b.state === 'routing') continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (done.has(key)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const s = Math.sin(a.facing), c = Math.cos(a.facing);
        const fwd = dx * s + dz * c;
        const lat = Math.abs(dx * c - dz * s);
        if (fwd > MELEE_RANGE + b.depth || fwd < -MELEE_RANGE || lat > a.halfFront + b.halfFront) continue;
        done.add(key);
        a.melee = b.melee = true;
        a.stop();
        const armA = a.type === 'artillery' ? 0.35 : 1;
        const armB = b.type === 'artillery' ? 0.35 : 1;
        const bCharging = b.order.type === 'charge';
        const atk = a.men * armA * (0.6 + 0.4 * a.morale / a.moraleMax) * (0.9 + 0.06 * a.xp) * (bCharging ? 1 : 1.15);
        const def = b.men * armB * (0.6 + 0.4 * b.morale / b.moraleMax) * (0.9 + 0.06 * b.xp) * (bCharging ? 1 : b.cover);
        const r = atk / Math.max(1, def);
        // old: 9 x 12 men/s x ratio (108/s) with a 20% per second cap; that bled ~450 men a side in 20 s
        const base = 9 * dt;
        const aCas = Math.min(a.men, a.menMax * 0.04 * dt, base * (1 / r) * (0.7 + this.rnd() * 0.6));
        const bCas = Math.min(b.men, b.menMax * 0.04 * dt, base * r * (0.7 + this.rnd() * 0.6));
        a.takeLosses(aCas, this.fallen[a.side], time);
        b.takeLosses(bCas, this.fallen[b.side], time);
        a.casTick = (a.casTick || 0) + aCas;
        b.casTick = (b.casTick || 0) + bCas;
        if (r < 0.85) a.morale -= 18 * dt;
        if (r > 1.18) b.morale -= 18 * dt;
        a.fatigue = Math.min(100, a.fatigue + 2.4 * dt);
        b.fatigue = Math.min(100, b.fatigue + 2.4 * dt);
      }
    }
    for (const u of this.units) {
      if (u.order.type === 'charge' && !u.melee && !u.follow.active && u.alive) u.order = { type: 'hold' };
    }
  }

  moraleStep(u, dt) {
    const rally = 1 + 0.12 * u.xp;
    const cas = u.casTick || 0;
    u.casTick = 0;
    // Losses drive morale (old factor 60 with a -1.1/s under-fire drain suited a ~90 s fight; over a
    // several-minute fight the flat drain alone broke a brigade that had lost 10%).
    u.morale -= ((cas / u.menMax) * 150) / rally;
    const enemies = this.enemiesOf(u);
    const nearest = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - u.x, e.z - u.z)), Infinity);
    if (u.underFire > 0) u.morale -= (0.12 / u.cover) * dt; // men in woods or behind walls feel it less
    if (u.flanked > 0) u.morale -= 0.6 * dt;
    if (u.ammo < 18) u.morale -= 0.15 * dt;
    if (u.fatigue > 60) u.morale -= 0.45 * dt;
    if (u.order.firm) u.morale += 0.12 * dt; // Hold: steadied by orders to stand
    for (const f of this.units) {
      if (f !== u && f.side === u.side && f.state === 'routing' && !f.panicSeen?.has(u.id) && Math.hypot(f.x - u.x, f.z - u.z) < 180) {
        (f.panicSeen ||= new Set()).add(u.id);
        u.morale -= 6;
      }
    }
    if (u.state !== 'routing' && u.underFire <= 0 && nearest > 0.9 * RANGE.rifled) u.morale += 1.1 * dt;
    // Resupply from the trains behind the line (M1 simplification; the old model used a supply wagon).
    if (u.state !== 'routing' && u.underFire <= 0 && nearest > 300) u.ammo = Math.min(100, u.ammo + 2 * dt);
    u.underFire = Math.max(0, u.underFire - dt);
    u.flanked = Math.max(0, u.flanked - dt);
    u.morale = clamp(u.morale, 0, u.moraleMax);

    const routThresh = 18 - 1.5 * u.xp;
    if (u.state === 'routing') {
      // Rally: no enemy within 220 m for 6 s.
      if (nearest > 220) u.rallyT += dt; else u.rallyT = 0;
      if (u.rallyT > 6) {
        u.state = 'wavering';
        u.morale = Math.max(u.morale, 30);
        u.order = { type: 'hold' };
        u.stop();
        u.rallyT = 0;
        this.log.push({ t: performance.now(), unit: u, text: `${u.short} rallies.` });
      }
      return;
    }
    if (u.morale < routThresh) {
      const save = Math.min(0.95, 0.5 * rally);
      // per-second rout chance equal to the old per-tick roll applied twice a second
      if (this.rnd() < (1 - save) * 2 * dt) {
        u.state = 'routing';
        u.stop();
        u.run = false;
        u.order = { type: 'rout' };
        u.rallyT = 0;
        this.log.push({ t: performance.now(), unit: u, text: `${u.short} breaks and runs!` });
        return;
      }
    }
    const prev = u.state;
    u.state = u.morale > 55 ? 'steady' : u.morale > 35 ? 'shaken' : 'wavering';
    if (u.state === 'wavering' && prev !== 'wavering') {
      this.log.push({ t: performance.now(), unit: u, text: `${u.short} is wavering.` });
      if (u.order.type === 'move' || u.order.type === 'charge') { u.stop(); u.order = { type: 'hold' }; }
    }
  }

  fatigueStep(u, dt) {
    const moving = u.follow.active || u.state === 'routing';
    // as in the old model, standing still rests a unit even while it fires
    if (moving) u.fatigue += (u.state === 'routing' || u.run || u.order.type === 'charge' ? 1.2 : 0.3) * dt;
    else u.fatigue -= (u.firing ? 0.35 : 0.9) * dt;
    u.fatigue = clamp(u.fatigue, 0, 100);
  }
}

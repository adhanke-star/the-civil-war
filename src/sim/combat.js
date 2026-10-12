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
//   - a walking line fires at half effect with a slower reload (no fire while running or charging). AI lines
//     halt to engage inside 75% of their range (80% for guns) and stay halted. The player's lines follow
//     rules.moveOrder (src/sim/rules.js): 'fight' (default) halts the march at the same distance, fires, and
//     resumes once the enemy is gone, out of range or routing; 'march' keeps marching and fires on the move.
//   - Hold Fire (unit.holdFire) stops a unit firing; it still turns and moves.
//   - no fire through friends (DESIGN.md §4b "Masked", rules.friendlyMask): a shooter does not fire at an enemy
//     while another living brigade or battery of its own side stands closer than that enemy and its front
//     (half-width + MASK_PAD, across its facing) crosses the line from the shooter's centre to the enemy's centre.
//     Guns do not fire over friends either (v1). unit.masked marks a unit with targets in range but every one masked.
//   - command (src/game.js, DESIGN.md §2 "Commanders"): setCommand(fn) gives each unit a morale factor
//     ({ loss, rally } or null): morale losses (fire, casualties, flanking, panic, melee) are multiplied by `loss`
//     and a routing unit's rally clock and the out-of-contact recovery by `rally` (a general's 300 m radius or the
//     brigade's own commander: loss 0.8, rally 1.5). With a command set, every point that takes fire this step
//     (each volley's target centre, both sides of a melee) is kept for takeHits(); without one nothing is kept.
//   - cavalry (type 'cavalry', DESIGN.md §2; game values in CAV below and CAVALRY, not sourced): mounted it fires
//     short (carbine CAV.mountedRange.carbine, pistol .pistol) and weak (CAV.mountedMen of the men, each as a smoothbore man);
//     on foot (unit.afoot) its carbines reach CAV.dismountedRange, reload CAV.dismountedRate times faster (breech-loaders)
//     with CAV.dismountedMen of the men in the line (the horse-holders are out of it). While it dismounts or remounts it
//     does not fire and has no cover (cover 1). AI horsemen ride on through fire instead of halting to fire.
//   - a mounted charge (cavalryShock) is strong against shaken, wavering and routing men, against a battery whose guns
//     are not on it (limbered, aimed elsewhere, or taken from a flank) and against a line taken in flank or rear; it is
//     weak against steady infantry formed in line facing it (CAV.formedLine: the horsemen lose heavily). Horsemen that
//     catch a routing unit ride it down (rideDown: extra losses, almost none of their own, and onRideDown for the game's
//     surrender accounting) without halting; no other unit fights a routing one.
//   - screening: an infantry brigade within CAVALRY.screen of an enemy cavalry regiment that is not routing
//     marches CAVALRY.screenSlow as fast (SCREENED, refreshed with the targets; unit.js move reads it).
//   - feat statistics (DESIGN.md §3 Badges; src/franchise/badges.js FEAT_STATS): each unit's phase counters live in a
//     module WeakMap (featsOf; never an own key on the unit or the Combat): casualties inflicted by band and situation
//     (beyond 200 m, beyond 150 m on a larger formation, from a flank or the rear, falling back, from a fence line or farm
//     buildings, from woods, with canister), the first volley after Hold Fire with its target within 60 m and the 15 s
//     after it, losses taken while holding and returning fire, charges that broke a foe (one larger than the charger, one
//     in cover), charges that reached the enemy again after a failed one, guns taken, enemy formations that broke near it
//     while it held, seconds steady under flank fire or beside a routing friend, quick rallies and (unit.js) metres
//     marched. Counting draws no random number and changes nothing the battle reads.
//   - badge effects (src/franchise/tuning.js BADGE_RULES; setBadgeEffects from the unit's definition): small conditional
//     multipliers (fire by band or situation, canister, ammunition per volley, melee by situation, morale losses, rally,
//     resupply, fatigue), plus an X-Factor brigade's aura for friends within BADGE_RULES.xfactor.radius. A unit without
//     badges takes exactly the old arithmetic: every badge term sits behind a check, never a multiply by 1.
//   - camp effects (P5d; src/franchise/tuning.js CAMP.battle; setCampEffects from the unit's definition, called by unit.js):
//     camp card-bar points (`training`, through badges.js trainingEffects like the badges) add to the fire effect, the
//     reload (and, in unit.js, the wheeling) speed, melee strength and cut morale lost under fire; a battery short of horses
//     (`limber` s) must stand UNLIMBER_S + limber sim seconds after it halts before it fires (unit.js also holds it that long
//     before it moves off); pioneers (`pioneers`) pass woods faster (unit.js). Starting fatigue and rounds are the
//     definition's `fatigue` and `ammo` (unit.js). A definition without them takes exactly the old arithmetic.
// FIRE_BASE and the drains are tuned for a few minutes of fighting per brigade, not sourced (as in the old
// model, where FIRE_BASE was "tuned so the loop runs ~90 s"). The sandbox multipliers rules.fireEffect and
// rules.moraleLoss scale them at the point of use; the constants here stay as they are.

import { RULES } from './rules.js';
import { FEAT_STATS, BADGE_RULES, badgeEffects, trainingEffects } from '../franchise/badges.js';
import { CAMP } from '../franchise/tuning.js';

export const CLOCK_RATIO = 4;
const YD = 0.9144;
export const RANGE = { smooth: 130 * YD, rifled: 320 * YD, artillery: 980 * YD };
export const CANISTER = 150 * YD;
/** Share of the weapon's range at which a line halts to fire (the "effective range" of the orders). */
export const EFFECTIVE = { infantry: 0.75, artillery: 0.8 };
const RESUME_S = 1.5; // s with no enemy to fight before a halted march resumes
const POW = { smooth: 1.0, rifled: 1.25, parrott: 2.6, napoleon: 2.4, smbart: 1.6 };
const RELOAD = { musket: 60 / 3 / CLOCK_RATIO, gun: 60 / 2 / CLOCK_RATIO }; // sim seconds per round
const FIRE_BASE = 1.5;
const ARC = (65 * Math.PI) / 180;
const MELEE_RANGE = 34;
const MASK_PAD = 8; // m added to each side of a friend's front when it masks the line of fire
/** Cavalry game values (contract P3 cavalry; not sourced). Spacings are in figure metres (figures are drawn ~4x life). */
export const CAVALRY = Object.freeze({
  speed: 2.2, // mounted pace = infantry pace x this, every order (walk, run, charge, fall back, rout)
  woods: 0.6, // mounted in woods (infantry: 0.7)
  holderEvery: 4, // on foot, every fourth figure holds the horses (his own and three led)
  dismountS: 15, remountS: 20, // sim s to dismount or remount: halted, no fire, cover x1
  fileSpacing: 3.4, rankSpacing: 11, // a mounted line: two ranks of horses
  skirmishSpacing: 4.5, // a dismounted skirmish line, one rank
  holderSpacing: 14, holdersBack: 50, // the horse-holders' row behind the skirmish line
  ledHorses: 3,
  screen: 250, screenSlow: 0.8, // enemy infantry within this of a cavalry regiment (not routing) marches x screenSlow
});
export const CAVALRY_WEAPONS = Object.freeze(['carbine', 'pistol']);
/** The weapon a definition without one carries: carbines for cavalry, smoothbores otherwise. */
export const defaultWeapon = (type) => (type === 'cavalry' ? 'carbine' : 'smooth');
/** Infantry marching inside an enemy cavalry screen (screenStep keeps it; never an own key on the unit). */
export const SCREENED = new WeakSet();
/** Cavalry fire and charge (game values, not sourced; see the header). */
export const CAV = Object.freeze({
  mountedRange: { carbine: 150, pistol: 40 }, dismountedRange: 300, // m
  mountedMen: 0.35, dismountedMen: 0.8, dismountedRate: 1.2,
  shock: { shaken: 1.8, wavering: 2.5, guns: 2.5, flank: 1.6 }, formedLine: 0.45,
  rideDown: { rate: 0.025, cap: 0.05, own: 0.4 }, // fugitives lost per rider per s, at most this share of their strength per s; riders lost per s
});
/** A cavalry regiment in the saddle and not switching: it charges, rides down and fires as horsemen. */
export const horsed = (u) => u.type === 'cavalry' && !u.afoot;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- feat statistics and badge effects (no own keys; see the header) --------------------------------------------------
const FEATS = new WeakMap(); // unit -> { ...FEAT_STATS counters, plus the bookkeeping below }
const BADGE_FX = new WeakMap(); // unit -> its own badge combat fractions (badgeEffects)
const LIVE_FX = new WeakMap(); // unit -> own fractions plus any X-Factor aura, refreshed with the targets
const HELD_RANGE = 60, DISCIPLINE_S = 15, BREAK_S = 30, RALLY_QUICK_S = 30, REPULSE_RANGE = 150, PRESSED_RANGE = 300;
const FAR = 200, LONG = 150, RECENT_FIRE_S = 8;
const WORKS = new Set(['fence line', 'farm buildings']);
/** The unit's feat record for this battle (made on first use). */
export function featsOf(u) {
  let r = FEATS.get(u);
  if (!r) {
    r = { held: false, discUntil: -1, ep: null, failed: 0, meleeBy: null, meleeT: -99, routT: null, guns: new Set() };
    for (const k of FEAT_STATS) r[k] = 0;
    FEATS.set(u, r);
  }
  return r;
}
/** Whole-number feat statistics of a unit (zeros when it has none yet); the phase result reads these. */
export function featStats(u) {
  const r = FEATS.get(u), out = {};
  for (const k of FEAT_STATS) { const v = r ? r[k] : 0; out[k] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  return out;
}
/** Credit `captor` with a battery's serviceable guns, once per battery (broken by its charge or surrendered to it). */
export function featGunsTaken(captor, battery) {
  if (!captor || !battery || battery.side === captor.side) return;
  const r = featsOf(captor);
  if (r.guns.has(battery)) return;
  r.guns.add(battery);
  r.gunsTaken += Array.isArray(battery.gunSlots) ? battery.gunSlots.filter((g) => g && g.alive).length : battery.guns || 0;
}
/** Set (or clear) a unit's badge effects from its definition's badge list; returns them (null: none). */
export function setBadgeEffects(u, list) {
  const fx = badgeEffects(list);
  if (fx) BADGE_FX.set(u, fx); else { BADGE_FX.delete(u); LIVE_FX.delete(u); }
  return fx;
}
/** The badge fractions in force for a unit now (its own plus any aura), or null. */
export const badgeFx = (u) => LIVE_FX.get(u) || null;
// ---- camp effects (P5d; see the header) ----------------------------------------------------------------------------------
const CAMP_FX = new WeakMap(); // unit -> { fire?, reload?, melee?, morale?, limber, woods, hitch, halted }
/** Every battery's unlimbering time (src/units/battery.js UNLIMBER_S, drawn there); a battery short of horses adds its `limber`. */
export const UNLIMBER_S = 6;
/**
 * Set (or clear) a unit's camp effects from its definition: `training` (camp card-bar points), `limber` (batteries only) and
 * `pioneers`. Returns the record (null: none). The record also keeps a battery's hitching and halted clocks.
 */
export function setCampEffects(u, def) {
  const fx = trainingEffects(def && def.training);
  const limber = def && u.type === 'artillery' && Number.isFinite(def.limber) && def.limber > 0 ? def.limber : 0;
  const woods = def && def.pioneers === true ? CAMP.upgrades.pioneers.woods : 0;
  if (!fx && !limber && !woods) { CAMP_FX.delete(u); return null; }
  const rec = { ...(fx || {}), limber, woods, hitch: 0, halted: Infinity };
  CAMP_FX.set(u, rec);
  return rec;
}
/** A unit's camp effects in battle (setCampEffects), or null. */
export const campFx = (u) => CAMP_FX.get(u) || null;
/** The enemy whose charge was on `u` within the last second (captured colours: an overrun); reads the feat record, never makes one. */
export function chargedBy(u, now) {
  const r = FEATS.get(u);
  return r && r.meleeBy && now - r.meleeT <= 1 ? r.meleeBy : null;
}
/** A unit's X-Factor ({ kind, fraction, id } from its own badges), or null. */
export const xFactorOf = (u) => BADGE_FX.get(u)?.xfactor || null;

export class Combat {
  #batteryContact = null;
  #stepDepth = 0;
  #command = null; // (unit) => { loss, rally } | null (game.js commandFactor)
  #hits = null; // flat [x, z, ...] of points that took fire since the last takeHits(); null: not kept
  #rideDown = null; // (cavalry, router, dt) => void: the game's surrender accounting (only with surrender enabled)
  #now = 0; // sim time of the current step (feat clocks; a forced rout between steps uses the last one)
  constructor({ units, terrain, coverAt, fallen, fx, rnd, autoHaltSides = ['CS'], onBatteryContact = null, onRideDown = null }) {
    if (onBatteryContact !== null && typeof onBatteryContact !== 'function') throw new Error('Combat: battery contact callback must be a function or null.');
    if (onRideDown !== null && typeof onRideDown !== 'function') throw new Error('Combat: ride-down callback must be a function or null.');
    this.#batteryContact = onBatteryContact;
    this.#rideDown = onRideDown;
    // `units` is the game's own array: spawns and removals change it in place, so this sees them.
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

  /** Morale factors per unit (or null to clear); also starts keeping the points that take fire. */
  setCommand(factor) {
    this.#command = typeof factor === 'function' ? factor : null;
    this.#hits = this.#command ? [] : null;
  }

  /** The points that took fire since the last call ([x, z, ...], read and cleared). */
  takeHits() {
    if (!this.#hits) return [];
    const out = this.#hits;
    this.#hits = [];
    return out;
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
    if (u.type === 'cavalry') return u.afoot && u.weapon !== 'pistol' ? CAV.dismountedRange : CAV.mountedRange[u.weapon] || CAV.mountedRange.carbine;
    if (u.equipmentProfile) return u.equipmentProfile.rangeMetres;
    return u.type === 'artillery' ? RANGE.artillery : RANGE[u.weapon] || RANGE.smooth;
  }

  /** Distance at which this unit halts to fire (effective range). */
  effRange(u) {
    return this.range(u) * (u.type === 'artillery' ? EFFECTIVE.artillery : EFFECTIVE.infantry);
  }

  /**
   * Does a living friend of u (not u itself) stand across u's line of fire to e? The friend's centre is nearer u
   * than e is, and its front segment (centre ± (halfFront + MASK_PAD) across its facing) crosses the segment from
   * u's centre to e's centre. No allocation: called per candidate target and before every volley.
   */
  masks(u, e) {
    const sx = u.x, sz = u.z, dx = e.x - sx, dz = e.z - sz;
    const reach2 = dx * dx + dz * dz;
    for (const f of this.units) {
      if (f === u || f.side !== u.side || !f.alive) continue;
      const fx = f.x - sx, fz = f.z - sz;
      if (fx * fx + fz * fz >= reach2) continue;
      const h = f.halfFront + MASK_PAD, s = Math.sin(f.facing), c = Math.cos(f.facing);
      // front from p = F + (c, -s)·h to F - (c, -s)·h, i.e. p + w·r for w in [0, 1] (relative to the shooter)
      const px = fx + c * h, pz = fz - s * h, rx = -2 * c * h, rz = 2 * s * h;
      const den = dx * rz - dz * rx;
      if (den === 0) continue; // parallel: the line of fire runs along the front, not across it
      const t = (px * rz - pz * rx) / den, w = (px * dz - pz * dx) / den;
      if (t >= 0 && t <= 1 && w >= 0 && w <= 1) return true;
    }
    return false;
  }

  pickTargets() {
    const mask = RULES.friendlyMask;
    for (const u of this.units) {
      u.target = null;
      u.masked = false;
      if (!u.alive || u.state === 'routing' || u.ammo <= 0) continue;
      const rng = this.range(u);
      let best = null, bestScore = -Infinity, maskedAny = false;
      for (const e of this.enemiesOf(u)) {
        const d = Math.hypot(e.x - u.x, e.z - u.z) - e.halfFront * 0.4;
        if (d > rng) continue;
        const bearing = Math.atan2(e.x - u.x, e.z - u.z);
        const off = Math.abs(wrap(bearing - u.facing));
        if (off > ARC + Math.atan2(e.halfFront, Math.max(1, d)) * 0.8) continue;
        if (!this.los(u, e)) continue;
        const score = (rng - d) / rng + 0.4 * (this.arcMult(u, e) - 1) + 0.5 * (1 - e.men / e.menMax) + (e.state === 'routing' ? -0.6 : 0);
        if (score > bestScore) {
          // a masked enemy is passed over for the best one with a clear line (checked only when it would win)
          if (mask && this.masks(u, e)) { maskedAny = true; continue; }
          bestScore = score; best = e;
        }
      }
      u.target = best;
      u.masked = !best && maskedAny;
    }
  }

  step(dt, time) {
    this.#stepDepth++;
    if (Number.isFinite(time)) this.#now = time;
    try {
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = 0.5;
      this.pickTargets();
      for (const u of this.units) {
        const c = this.coverAt(u.x, u.z);
        u.cover = u.switching ? 1 : c.value; // a regiment dismounting or remounting has no cover
        u.coverKind = c.kind;
        u.inWoods = c.kind === 'woods';
      }
      this.screenStep();
      this.badgeStep();
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      this.fireStep(u, dt, time);
    }
    this.meleeStep(dt, time, this.#stepDepth === 1 ? this.#batteryContact : null);
    this.chargeEpisodes(time);
    for (const u of this.units) {
      if (!u.alive) continue;
      this.moraleStep(u, dt);
      this.fatigueStep(u, dt);
    }
    } finally { this.#stepDepth--; }
  }

  /** Which infantry brigades march inside an enemy cavalry screen (SCREENED). Nothing to do without cavalry. */
  screenStep() {
    let any = false;
    for (const c of this.units) if (c.type === 'cavalry') { any = true; break; }
    if (!any) return;
    const R2 = CAVALRY.screen * CAVALRY.screen;
    for (const u of this.units) {
      if (u.type !== 'infantry') continue;
      let near = false;
      for (const c of this.units) {
        if (c.type !== 'cavalry' || c.side === u.side || !c.alive || c.state === 'routing' || c.state === 'captured') continue;
        if ((c.x - u.x) ** 2 + (c.z - u.z) ** 2 <= R2) { near = true; break; }
      }
      if (near) SCREENED.add(u); else SCREENED.delete(u);
    }
  }

  /**
   * Badge effects in force (LIVE_FX): each unit's own, plus an X-Factor aura from every living, unbroken X-Factor brigade
   * of its side within BADGE_RULES.xfactor.radius (itself included). Nothing to do on a field without badges.
   */
  badgeStep() {
    let auras = null, any = false;
    for (const u of this.units) {
      const fx = BADGE_FX.get(u);
      if (!fx) continue;
      any = true;
      if (fx.xfactor && u.alive && u.state !== 'routing' && u.state !== 'captured') (auras ||= []).push(u);
    }
    if (!any) return;
    const R2 = BADGE_RULES.xfactor.radius ** 2;
    for (const u of this.units) {
      const own = BADGE_FX.get(u);
      let live = own || null;
      if (auras) for (const a of auras) {
        if (a.side !== u.side || (a.x - u.x) ** 2 + (a.z - u.z) ** 2 > R2) continue;
        const x = BADGE_FX.get(a).xfactor;
        if (live === null || live === own) live = { ...(own || {}) };
        live[x.kind] = (live[x.kind] || 0) + x.fraction;
      }
      if (live) LIVE_FX.set(u, live); else LIVE_FX.delete(u);
    }
  }

  /** A charge stays in contact while it fights; one out of contact for over 1 s is over (a failure unless its foe broke). */
  chargeEpisodes(time) {
    for (const u of this.units) {
      const r = FEATS.get(u), ep = r && r.ep;
      if (!ep || ep.done || time - ep.last <= 1) continue;
      ep.done = true;
      if (!ep.won) r.failed++;
    }
  }

  /**
   * A charging `a` in contact with `b` this step: opens a charge episode on a new foe (a charge that reaches the enemy
   * after an earlier one failed counts for Relentless), keeps it open, counts casualties dealt from b's flank or rear and
   * marks who is on b (rout() credits the break).
   */
  chargeFeat(a, b, bCas, time) {
    const ra = featsOf(a);
    if (!ra.ep || ra.ep.done || ra.ep.foe !== b) {
      if (ra.ep && !ra.ep.done) { ra.ep.done = true; if (!ra.ep.won) ra.failed++; }
      if (ra.failed > 0) ra.recharges++;
      ra.ep = { foe: b, t0: time, last: time, smaller: a.men < b.men, cover: b.cover > 1, won: false, done: false };
    }
    ra.ep.last = time;
    if (this.arcMult(a, b) > 1) ra.flankKills += bCas;
    const rb = featsOf(b);
    rb.meleeBy = a; rb.meleeT = time;
  }

  /** Losses taken by `t` while it holds its ground and returns fire (Cool Under Fire). */
  holdingFeat(t, men, time) {
    if (!(men > 0) || t.follow.active || t.state === 'routing' || t.order.type === 'fallback' || t.order.type === 'charge') return;
    if (t.firing || time - t.fireT < RECENT_FIRE_S) featsOf(t).holdingLoss += men;
  }

  /** Sim seconds per round for u at full fatigue factor 1 (cavalry on foot: breech-loading carbines, faster). */
  basePeriod(u) {
    if (u.type === 'artillery') return RELOAD.gun;
    return u.type === 'cavalry' && u.afoot ? RELOAD.musket / CAV.dismountedRate : RELOAD.musket;
  }

  fireStep(u, dt, time) {
    const t = u.target;
    const moving = u.follow.active && Math.hypot(u.vehicle.velocity.x, u.vehicle.velocity.z) > 0.5;
    const isArt = u.type === 'artillery';
    // A line on the march meets an enemy well inside its range (unless charging or running).
    if (t && moving && !u.run && u.order.type === 'move' && u.state !== 'routing' && t.state !== 'routing') {
      const d = Math.hypot(t.x - u.x, t.z - u.z);
      if (d < this.effRange(u)) {
        if (u.type === 'cavalry' && !u.afoot && this.autoHalt.has(u.side) && !u.manual) {
          // AI horsemen ride on, firing on the move (their charges and pursuit are ai.js's)
        } else if (this.autoHalt.has(u.side) && !u.manual) {
          // the AI halts for good
          u.stop();
          u.order = { type: 'hold' };
          u.goalFacing = Math.atan2(t.x - u.x, t.z - u.z);
        } else if (RULES.moveOrder === 'fight') {
          u.pauseMarch(t.x, t.z); // the player's line halts to fight and resumes later
        }
      }
    }
    // A halted march resumes when the enemy is gone, out of range or beaten (or the rule was switched off).
    if (u.engaged) {
      const gone = !t || t.state === 'routing' || !t.alive;
      if (RULES.moveOrder !== 'fight' || u.order.type !== 'move') u.resumeMarch();
      else if (gone) { u.resumeT += dt; if (u.resumeT >= RESUME_S) u.resumeMarch(); }
      else u.resumeT = 0;
    }
    // Holding units turn to face their target.
    if (t && !u.follow.active && u.state !== 'routing') {
      const want = Math.atan2(t.x - u.x, t.z - u.z);
      if (Math.abs(wrap(want - u.facing)) > 0.12) u.goalFacing = want;
    }
    // camp effects (none without them): a battery short of horses unlimbers slowly; Drill reloads faster
    const cf = CAMP_FX.get(u);
    if (cf && cf.limber) cf.halted = u.follow.active || u.state === 'routing' ? 0 : cf.halted + dt;
    const canFire = t && !u.holdFire && !u.melee && u.state !== 'routing' && u.order.type !== 'charge' && !(moving && (u.run || isArt)) && (!isArt || u.unlimbered) && !u.switching
      && !(cf && cf.limber && cf.halted < UNLIMBER_S + cf.limber);
    u.firing = !!canFire && !moving;
    if (t && u.holdFire && u.state !== 'routing') featsOf(u).held = true; // holding fire with a target (First Volley)
    const period = (u.equipmentProfile ? u.equipmentProfile.reloadSeconds : this.basePeriod(u)) * (1 + 0.5 * (u.fatigue / 100)) * (moving ? 1.5 : 1);
    if (u.reload < 1) u.reload = Math.min(1, cf && cf.reload ? u.reload + (dt * (1 + cf.reload)) / period : u.reload + dt / period);
    if (!canFire || u.reload < 1) return;
    // A friend that stepped across the line since the last target pick masks this volley; re-pick next time.
    if (RULES.friendlyMask && this.masks(u, t)) { u.target = null; u.masked = true; u.firing = false; return; }
    this.volleyAt(u, t, time, moving, period);
  }

  /** One volley (or round from every gun) from u at t, now. Also used by the sandbox's "fire a volley now". */
  volleyAt(u, t, time, moving = false, period) {
    const isArt = u.type === 'artillery';
    // Named damage is per round at the nominal musket/gun calibration, independent of faster
    // reload or an explicit direct-volley period. Preserve legacy fatigue/moving semantics:
    // default direct calls have fatigue only; fireStep supplies the moving-period factor.
    // Cavalry likewise: its carbines' faster reload on foot means more rounds, not smaller ones.
    if (u.equipmentProfile || u.type === 'cavalry') period = (isArt ? RELOAD.gun : RELOAD.musket) * (1 + 0.5 * (u.fatigue / 100)) * (moving && period !== undefined ? 1.5 : 1);
    if (period === undefined) period = this.basePeriod(u) * (1 + 0.5 * (u.fatigue / 100));
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
    if (u.equipmentProfile) pow = u.equipmentProfile.powerMultiplier;
    if (u.type === 'cavalry') fireMen = u.men * (u.afoot ? CAV.dismountedMen : CAV.mountedMen); // per man as smoothbore infantry (POW 1)
    let art = 1;
    if (isArt) {
      fireMen = u.guns * 27 * clamp(u.men / u.menMax, 0, 1); // old GUN_FIRE_WEIGHT (T5:54)
      if (d <= CANISTER) art = 2.7 * clamp(1 - (t.cover - 1) * 1.15, 0.18, 1);
      else art = 0.5;
    }
    const heightAdv = this.terrain.heightAt(t.x, t.z) - this.terrain.heightAt(u.x, u.z) > 8 ? 1.1 : 1;
    const wav = (u.state === 'wavering' ? 0.7 : 1) * (moving ? 0.5 : 1);
    const rate = FIRE_BASE * (fireMen / 1500) * pow * rngF * xpF * ammoF * morF * fatF * art * arc * wav / (t.cover * heightAdv) * RULES.fireEffect;
    const fx = LIVE_FX.get(u);
    const canister = isArt && d <= CANISTER, works = WORKS.has(u.coverKind), falling = u.order.type === 'fallback';
    let boost = 0; // badge fire effects (none without badges)
    if (fx) {
      if (d > FAR && fx.fireFar) boost += fx.fireFar;
      if (d > LONG && fx.fireLong) boost += fx.fireLong;
      if (d <= HELD_RANGE && fx.fireClose) boost += fx.fireClose;
      if (arc > 1 && fx.fireFlank) boost += fx.fireFlank;
      if (falling && fx.fireFallback) boost += fx.fireFallback;
      if (works && fx.fireCover) boost += fx.fireCover;
      if (u.inWoods && fx.fireWoods) boost += fx.fireWoods;
      if (canister && fx.canister) boost += fx.canister;
    }
    const cf = CAMP_FX.get(u);
    if (cf && cf.fire) boost += cf.fire; // camp training: Fire points (none without them)
    const tMen = t.men;
    const cas = Math.min(t.men, (boost ? rate * (1 + boost) : rate) * period * (0.78 + this.rnd() * 0.44));
    t.takeLosses(cas, this.fallen[t.side], time);
    // feat statistics (counting only)
    const r = featsOf(u);
    if (d > FAR) r.farKills += cas;
    if (d > LONG && tMen > u.men) r.screenKills += cas;
    if (arc > 1) r.flankKills += cas;
    if (falling) r.rearGuardKills += cas;
    if (works) r.worksKills += cas;
    if (u.inWoods) r.woodsKills += cas;
    if (canister) r.canisterKills += cas;
    if (r.held) {
      r.held = false;
      if (d <= HELD_RANGE) { r.heldVolley += cas; r.discUntil = time + DISCIPLINE_S; }
    }
    if (time <= r.discUntil) r.disciplineKills += cas;
    this.holdingFeat(t, cas, time);
    if (this.#hits) this.#hits.push(t.x, t.z);
    t.underFire = 1.4;
    if (arc > 1) t.flanked = 1.0;
    t.casTick = (t.casTick || 0) + cas;
    t.lastShooter = u; // brigade initiative turns to face fire from a flank (game.js)
    t.lastShotT = time;
    u.fireLoad = (u.fireLoad || 0) + cas; // engagement line weight (ui/readout.js)
    const use = isArt ? 1.0 : 1.2;
    u.ammo = Math.max(0, u.ammo - (fx && fx.ammo ? use * (1 - fx.ammo) : use)); // about 80 volleys (~7 sim min) per full box
    u.shots = (u.shots || 0) + 1;
    u.kills = (u.kills || 0) + cas;
    u.fireT = time; // guns recoil, men flash (battery.js, unit.js)
    if (this.fx) {
      if (isArt) this.fx.boom(u, t, d <= CANISTER);
      else this.fx.volley(u, u.volley(time));
    }
  }

  meleeStep(dt, time, onBatteryContact = null) {
    for (const u of this.units) u.melee = false;
    const done = new Set();
    for (const a of this.units) {
      if (!a.alive || a.order.type !== 'charge' || a.state === 'routing') continue;
      const rider = horsed(a);
      for (const b of this.enemiesOf(a)) {
        if (b.state === 'routing' && !rider) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (done.has(key)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const s = Math.sin(a.facing), c = Math.cos(a.facing);
        const fwd = dx * s + dz * c;
        const lat = Math.abs(dx * c - dz * s);
        if (fwd > MELEE_RANGE + b.depth || fwd < -MELEE_RANGE || lat > a.halfFront + b.halfFront) continue;
        done.add(key);
        if (b.state === 'routing') { this.rideDown(a, b, dt, time); continue; }
        a.melee = b.melee = true;
        if (this.#hits) this.#hits.push(a.x, a.z, b.x, b.z);
        if ((a.type === 'infantry' || a.type === 'cavalry') && b.type === 'artillery') onBatteryContact?.(a, b);
        a.stop();
        const armA = a.type === 'artillery' ? 0.35 : 1;
        const armB = b.type === 'artillery' ? 0.35 : 1;
        const bCharging = b.order.type === 'charge';
        const shock = rider ? this.cavalryShock(a, b) : 1;
        const atk = a.men * armA * (0.6 + 0.4 * a.morale / a.moraleMax) * (0.9 + 0.06 * a.xp) * (bCharging ? 1 : 1.15) * shock;
        const def = b.men * armB * (0.6 + 0.4 * b.morale / b.moraleMax) * (0.9 + 0.06 * b.xp) * (bCharging ? 1 : b.cover);
        // badge melee effects (none without badges): the charger's, and the receiver's when it stands to receive
        const fxA = LIVE_FX.get(a), fxB = LIVE_FX.get(b);
        let atkB = 0, defB = 0;
        if (fxA) atkB = (fxA.melee || 0) + (b.cover > 1 && fxA.meleeCover ? fxA.meleeCover : 0) + (b.type === 'artillery' && fxA.meleeGuns ? fxA.meleeGuns : 0);
        if (fxB && !bCharging && fxB.meleeDefend) defB = fxB.meleeDefend;
        // camp training: Melee points on either side (none without them)
        const cfA = CAMP_FX.get(a), cfB = CAMP_FX.get(b);
        if (cfA && cfA.melee) atkB += cfA.melee;
        if (cfB && cfB.melee) defB += cfB.melee;
        const r = (atkB ? atk * (1 + atkB) : atk) / Math.max(1, defB ? def * (1 + defB) : def);
        // old: 9 x 12 men/s x ratio (108/s) with a 20% per second cap; that bled ~450 men a side in 20 s
        const base = 9 * dt * RULES.chargeEffect;
        const aCas = Math.min(a.men, a.menMax * 0.04 * dt, base * (1 / r) * (0.7 + this.rnd() * 0.6));
        const bCas = Math.min(b.men, b.menMax * 0.04 * dt, base * r * (0.7 + this.rnd() * 0.6));
        a.takeLosses(aCas, this.fallen[a.side], time);
        b.takeLosses(bCas, this.fallen[b.side], time);
        a.casTick = (a.casTick || 0) + aCas;
        b.casTick = (b.casTick || 0) + bCas;
        if (r < 0.85) {
          const lossA = 18 * dt * RULES.moraleLoss * (this.#command?.(a)?.loss ?? 1);
          a.morale -= fxA && fxA.chargeMorale ? lossA * (1 - fxA.chargeMorale) : lossA;
        }
        if (r > 1.18) {
          const lossB = 18 * dt * RULES.moraleLoss * (this.#command?.(b)?.loss ?? 1);
          b.morale -= fxA && fxA.meleeShock ? lossB * (1 + fxA.meleeShock) : lossB;
        }
        this.chargeFeat(a, b, bCas, time);
        this.holdingFeat(b, bCas, time);
        a.fatigue = Math.min(100, a.fatigue + 2.4 * dt * RULES.fatigueGain);
        b.fatigue = Math.min(100, b.fatigue + 2.4 * dt * RULES.fatigueGain);
      }
    }
    for (const u of this.units) {
      if (u.order.type === 'charge' && !u.melee && !u.follow.active && u.alive) u.order = { type: 'hold' };
    }
  }

  /**
   * The weight of a mounted charge on b: shaken or wavering men, a battery whose guns are not on the horsemen (limbered,
   * aimed elsewhere, or taken outside its front) and a line taken in flank or rear give way; steady infantry (or
   * dismounted troopers) formed in line facing the charge stand and the horsemen suffer.
   */
  cavalryShock(a, b) {
    const flank = this.arcMult(a, b) > 1;
    if (b.type === 'artillery') return b.unlimbered && b.target === a && !flank && b.ammo > 0 ? 1 : CAV.shock.guns;
    if (b.state === 'wavering') return CAV.shock.wavering;
    if (b.state === 'shaken') return CAV.shock.shaken;
    if (flank) return CAV.shock.flank;
    const formed = (b.type === 'infantry' || b.type === 'cavalry' && b.afoot) && b.formation === 'line' && !b.follow.active;
    return formed ? CAV.formedLine : 1;
  }

  /**
   * Horsemen catch a routing unit: it loses men fast (they cut down and take the fugitives), the riders almost none,
   * and they ride on with it. The game counts the contact toward a surrender where surrender is enabled.
   */
  rideDown(a, b, dt, time) {
    const R = CAV.rideDown;
    const bCas = Math.min(b.men, b.menMax * R.cap * dt, R.rate * a.men * dt * RULES.chargeEffect * (0.7 + this.rnd() * 0.6));
    const aCas = Math.min(a.men, R.own * dt * RULES.chargeEffect);
    b.takeLosses(bCas, this.fallen[b.side], time);
    a.takeLosses(aCas, this.fallen[a.side], time);
    b.casTick = (b.casTick || 0) + bCas;
    a.casTick = (a.casTick || 0) + aCas;
    b.underFire = 1.4;
    b.rallyT = 0;
    a.ridingDown = time;
    a.kills = (a.kills || 0) + bCas;
    a.fatigue = Math.min(100, a.fatigue + 2.4 * dt * RULES.fatigueGain);
    if (this.#hits) this.#hits.push(a.x, a.z, b.x, b.z);
    this.#rideDown?.(a, b, dt);
  }

  moraleStep(u, dt) {
    const rally = 1 + 0.12 * u.xp;
    const cas = u.casTick || 0;
    u.casTick = 0;
    // Losses drive morale (old factor 60 with a -1.1/s under-fire drain suited a ~90 s fight; over a
    // several-minute fight the flat drain alone broke a brigade that had lost 10%).
    const k = this.#command ? this.#command(u) : null;
    let ml = RULES.moraleLoss * (k ? k.loss : 1);
    const cf = CAMP_FX.get(u);
    if (cf && cf.morale) ml *= 1 - cf.morale; // camp training: Morale points (none without them)
    const rallyRate = k ? k.rally : 1;
    // badge morale effects (none without badges): Cool Under Fire while holding; Unshaken against flank fire and panic
    const fx = LIVE_FX.get(u);
    const mlHold = fx && fx.moraleHold && !u.follow.active ? ml * (1 - fx.moraleHold) : ml;
    const mlPanic = fx && fx.panic ? ml * (1 - fx.panic) : ml;
    u.morale -= (((cas / u.menMax) * 150) / rally) * mlHold;
    const enemies = this.enemiesOf(u);
    const nearest = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.x - u.x, e.z - u.z)), Infinity);
    u.nearestEnemy = nearest; // the brigade marches in column only with no enemy near (unit.js)
    if (u.underFire > 0) u.morale -= (0.12 / u.cover) * dt * mlHold; // men in woods or behind walls feel it less
    if (u.flanked > 0) u.morale -= 0.6 * dt * mlPanic;
    if (u.ammo < 18) u.morale -= 0.15 * dt * ml;
    if (u.fatigue > 60) u.morale -= 0.45 * dt * ml;
    if (u.order.firm) u.morale += 0.12 * dt; // Hold: steadied by orders to stand
    for (const f of this.units) {
      if (f !== u && f.side === u.side && f.state === 'routing' && !f.panicSeen?.has(u.id) && Math.hypot(f.x - u.x, f.z - u.z) < 180) {
        (f.panicSeen ||= new Set()).add(u.id);
        u.morale -= 6 * mlPanic;
      }
    }
    // Unshaken (counting only): holding under fire while flanked or with a routing friend near
    if (u.underFire > 0 && u.state !== 'routing' && !u.follow.active) {
      let pressed = u.flanked > 0;
      if (!pressed) for (const f of this.units) {
        if (f !== u && f.side === u.side && f.state === 'routing' && Math.hypot(f.x - u.x, f.z - u.z) < PRESSED_RANGE) { pressed = true; break; }
      }
      if (pressed) featsOf(u).steadySeconds += dt;
    }
    u.fireLoad *= Math.exp(-dt / 4);
    if (u.state !== 'routing' && u.underFire <= 0 && nearest > 0.9 * RANGE.rifled) u.morale += 1.1 * dt * rallyRate;
    // Resupply from the trains behind the line (M1 simplification; the old model used a supply wagon).
    if (u.state !== 'routing' && u.underFire <= 0 && nearest > 300) u.ammo = Math.min(100, u.ammo + (fx && fx.resupply ? 2 * dt * (1 + fx.resupply) : 2 * dt));
    u.underFire = Math.max(0, u.underFire - dt);
    u.flanked = Math.max(0, u.flanked - dt);
    u.morale = clamp(u.morale, 0, u.moraleMax);

    const routThresh = 18 - 1.5 * u.xp;
    if (u.state === 'routing') {
      // Rally: no enemy within 220 m for 6 s.
      if (nearest > 220 && !this.rallyBlocked?.(u)) u.rallyT += fx && fx.rally ? dt * rallyRate * (1 + fx.rally) : dt * rallyRate; else u.rallyT = 0;
      if (u.rallyT > 6) {
        const r = FEATS.get(u);
        if (r && r.routT !== null && this.#now - r.routT <= RALLY_QUICK_S) r.quickRallies++;
        u.state = 'wavering';
        u.morale = Math.max(u.morale, 30);
        u.order = { type: 'hold' };
        u.stop();
        u.rallyT = 0;
        this.log.push({ t: performance.now(), unit: u, kind: 'rally', text: `${u.short} rallies.` });
      }
      return;
    }
    if (u.morale < routThresh) {
      const save = Math.min(0.95, 0.5 * rally);
      // per-second rout chance equal to the old per-tick roll applied twice a second
      if (this.rnd() < (1 - save) * 2 * dt) {
        this.rout(u);
        return;
      }
    }
    const prev = u.state;
    u.state = u.morale > 55 ? 'steady' : u.morale > 35 ? 'shaken' : 'wavering';
    if (u.state === 'wavering' && prev !== 'wavering') {
      this.log.push({ t: performance.now(), unit: u, kind: 'waver', text: `${u.short} is wavering.` });
      if (u.order.type === 'move' || u.order.type === 'charge') { u.stop(); u.order = { type: 'hold' }; }
    }
  }

  /** The brigade breaks (morale failure, or the sandbox's "Selected: rout"). */
  rout(u, forced = false) {
    if (!u.alive || u.state === 'routing') return;
    u.state = 'routing';
    u.stop();
    u.run = false;
    u.order = { type: 'rout' };
    u.rallyT = 0;
    if (forced) u.morale = Math.min(u.morale, 10);
    this.routFeat(u);
    this.log.push({ t: performance.now(), unit: u, kind: 'rout', forced, text: `${u.short} breaks and runs!` });
  }

  /**
   * Feats of a break (counting only): the charge that broke `u` within BREAK_S of reaching it (Cold Steel; Shock when the
   * charger was the smaller; Stormers when u stood in cover; Gun-takers for a battery's guns), and every enemy formation
   * holding its ground within REPULSE_RANGE (Rock). Also starts u's quick-rally clock.
   */
  routFeat(u) {
    const now = this.#now, ru = featsOf(u);
    ru.routT = now;
    const a = ru.meleeBy;
    if (a && now - ru.meleeT <= 1) {
      const ra = featsOf(a), ep = ra.ep;
      if (ep && !ep.done && ep.foe === u && now - ep.t0 <= BREAK_S) {
        ep.won = true;
        ra.chargeBreaks++;
        if (ep.smaller) ra.shockBreaks++;
        if (ep.cover) ra.stormed++;
        if (u.type === 'artillery') featGunsTaken(a, u);
      }
    }
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing' || e.state === 'captured' || e.follow.active
        || e.order.type === 'charge' || e.order.type === 'fallback' || Math.hypot(e.x - u.x, e.z - u.z) > REPULSE_RANGE) continue;
      featsOf(e).repulses++;
    }
  }

  fatigueStep(u, dt) {
    const moving = u.follow.active || u.state === 'routing';
    // as in the old model, standing still rests a unit even while it fires
    const fx = LIVE_FX.get(u);
    if (moving && fx && fx.fatigue) u.fatigue += (u.state === 'routing' || u.run || u.order.type === 'charge' ? 1.2 : 0.3) * dt * RULES.fatigueGain * (1 - fx.fatigue);
    else if (moving) u.fatigue += (u.state === 'routing' || u.run || u.order.type === 'charge' ? 1.2 : 0.3) * dt * RULES.fatigueGain;
    else u.fatigue -= (u.firing ? 0.35 : 0.9) * dt;
    u.fatigue = clamp(u.fatigue, 0, 100);
  }
}

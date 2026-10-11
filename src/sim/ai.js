// src/sim/ai.js: the side the player does not command (simple v1; Yuka goals come in M2).
//
// Each AI unit, twice a second: routing or in melee -> nothing; a wavering or routing foe within 170 m and
// this unit steady -> charge it (Jackson's counterattack); wavering with a stronger foe close -> fall back;
// otherwise hold its ground and face the nearest threat. AI never touches the player's units, nor an AI-side
// unit the sandbox player has ordered (unit.manual, with units.controlBothSides on).
//
// Roles (scenario unit `ai: { role, at?, target?, via? }`, validated in src/sim/phase.js; absent = 'hold',
// exactly the behaviour above):
//   hold     the defence above.
//   attack   holds until the battle clock reaches `at` (at once without it), then marches on `target` (default
//            the objective centre) through up to six `via` points. The march is a move order, so the line halts
//            to fire at an enemy in effective range on the way (combat.js) and this re-issues the march once
//            nothing is left to fight: at most every 8 s, never within 30 s of a fallback, never while wavering.
//            Arrived (inside the objective radius, or at its own final point) it holds firm, faces the nearest
//            enemy and, if steady, attacks an enemy standing inside the objective radius.
//            Several attackers sharing a target end side by side: each final point is offset across the line
//            of approach by the front widths of the units already placed (centre, right, left, ...).
//            A battery advances only to within its effective range of the nearest enemy or of its target and
//            fires from there; it is never marched into melee.
//   reserve  holds until `at`, or until an enemy comes within 350 m, or the objective holder becomes the enemy;
//            then it is an attacker.
// The charge and fallback rules above apply to every role. No randomness: the same battle runs the same way.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const AI_ROLES = Object.freeze(['hold', 'attack', 'reserve']);
const RESERVE_REACH = 350; // m: an enemy this close commits a reserve
const REISSUE_S = 8; // sim s between march orders to a unit that has stopped short
const FALLBACK_COOL_S = 30; // sim s after a fallback before the march is ordered again
const VIA_PASSED = 60; // m: a waypoint this close counts as passed
const ARRIVE = 25; // m: this close to its own final point a unit has arrived
const SPREAD_GAP = 32; // m between neighbouring fronts (two minimum half-fronts of 4 m make 40 m at least)
const GUN_STAND = 0.9; // a battery halts at this share of its effective range from its aim
const EDGE = 40; // m kept inside the mapped ground

const clockSec = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60; };
/** The unit's AI role: 'hold' unless its definition names attack or reserve. */
export const roleOf = (u) => {
  const ai = u.def && u.def.ai;
  return ai && (ai.role === 'attack' || ai.role === 'reserve') ? ai.role : 'hold';
};

export class Ai {
  constructor(game, opts) {
    this.game = game;
    this.side = game.playerSide === 'US' ? 'CS' : 'US';
    this.t = 0;
    this.chargeReach = opts.chargeReach || 170;
    this.memo = new WeakMap(); // unit -> { active, issued, via } (attack and reserve roles only)
    this.groups = new Map(); // target key -> { dir, pos: Map(unit -> lateral offset), n, right, left }
  }

  step(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const units = this.game.units;
    for (const u of units) {
      if (u.side !== this.side || !u.alive || u.state === 'routing' || u.melee || u.manual) continue;
      const foes = units.filter((e) => e.side !== u.side && e.alive);
      let near = null, nd = Infinity;
      for (const e of foes) {
        if (e.state === 'routing') continue;
        const d = Math.hypot(e.x - u.x, e.z - u.z);
        if (d < nd) { nd = d; near = e; }
      }
      const role = roleOf(u);
      if (role !== 'hold') { this.press(u, role, near, nd); continue; }
      if (!near) continue;
      const ahead = Math.abs(wrap(Math.atan2(near.x - u.x, near.z - u.z) - u.facing)) < 1.1;
      if (u.type === 'infantry' && u.state === 'steady' && u.order.type !== 'charge' && nd < this.chargeReach && ahead &&
          (near.state === 'wavering' || near.state === 'shaken' && near.men < u.men * 0.7)) {
        u.orderCharge(near);
        continue;
      }
      if (u.order.type === 'charge') continue;
      if (u.state === 'wavering' && nd < 200 && near.men > u.men && !u.follow.active && (u.lastFallback || -99) < this.game.simTime - 25) {
        u.lastFallback = this.game.simTime;
        u.orderFallback(110);
        continue;
      }
      if (!u.follow.active && u.order.type === 'hold' && !u.order.firm && u.state !== 'wavering') {
        u.order = { type: 'hold', firm: true }; // back in position after a charge or fallback
      }
      if (!u.follow.active && nd < 900 && !u.target) {
        const want = Math.atan2(near.x - u.x, near.z - u.z);
        if (Math.abs(wrap(want - u.facing)) > 0.35) u.goalFacing = want;
      }
    }
  }

  /** Hold firm where it stands and face the nearest threat (the defence's last two rules). */
  holdFace(u, near, nd) {
    if (!u.follow.active && u.order.type === 'hold' && !u.order.firm && u.state !== 'wavering') {
      u.order = { type: 'hold', firm: true };
    }
    if (near && !u.follow.active && nd < 900 && !u.target) {
      const want = Math.atan2(near.x - u.x, near.z - u.z);
      if (Math.abs(wrap(want - u.facing)) > 0.35) u.goalFacing = want;
    }
  }

  /** Attack and reserve roles: the shared charge and fallback rules, then wait or advance. */
  press(u, role, near, nd) {
    let s = this.memo.get(u);
    if (!s) { s = { active: false, issued: -Infinity, via: 0 }; this.memo.set(u, s); }
    if (!s.active) s.active = this.activates(u, role, nd);
    if (near) {
      const ahead = Math.abs(wrap(Math.atan2(near.x - u.x, near.z - u.z) - u.facing)) < 1.1;
      if (u.type === 'infantry' && u.state === 'steady' && u.order.type !== 'charge' && nd < this.chargeReach && ahead &&
          (near.state === 'wavering' || near.state === 'shaken' && near.men < u.men * 0.7)) {
        u.orderCharge(near);
        return;
      }
    }
    if (u.order.type === 'charge') return;
    if (near && u.state === 'wavering' && nd < 200 && near.men > u.men && !u.follow.active && (u.lastFallback || -99) < this.game.simTime - 25) {
      u.lastFallback = this.game.simTime;
      u.orderFallback(110);
      return;
    }
    if (!s.active) { this.holdFace(u, near, nd); return; }
    this.advance(u, s, near, nd);
  }

  /** Has this unit's role begun? Attack: at `at` (at once without it). Reserve: at `at`, an enemy close, or the objective lost. */
  activates(u, role, nd) {
    const ai = u.def.ai, g = this.game;
    const now = g.clockStart + g.simTime * g.clockRatio;
    if (ai.at !== undefined && now >= clockSec(ai.at)) return true;
    if (role === 'attack') return ai.at === undefined;
    return nd < RESERVE_REACH || g.holder === g.playerSide;
  }

  /** How far a battery stands from what it shoots at (its effective range). */
  gunReach(u) { return this.game.effRange(u); }

  /** The enemy standing inside the objective radius that an arrived, steady attacker engages (nearest first). */
  intruder(u) {
    const o = this.game.objective;
    let best = null, bd = Infinity;
    for (const e of this.game.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing' || Math.hypot(e.x - o.x, e.z - o.z) >= o.r) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Is the unit halted to fight an enemy still standing within its effective range? Then it stays and fires. */
  fighting(u) {
    const t = u.target;
    return !!t && t.alive && t.state !== 'routing' && Math.hypot(t.x - u.x, t.z - u.z) <= this.game.effRange(u) + 30;
  }

  /** The active attacker: march on (re-issued when stopped short), or hold and press once arrived. */
  advance(u, s, near, nd) {
    const g = this.game, o = g.objective;
    const r = this.route(u);
    while (s.via < r.via.length && Math.hypot(r.via[s.via][0] - u.x, r.via[s.via][1] - u.z) < VIA_PASSED) s.via++;
    const marching = u.follow.active || u.engaged;
    if (u.type === 'artillery') {
      const reach = this.gunReach(u);
      const inRange = (near && nd <= reach) || (s.via >= r.via.length && Math.hypot(r.aim[0] - u.x, r.aim[1] - u.z) <= reach);
      if (inRange) {
        if (marching && u.order.type === 'move') { u.stop(); u.order = { type: 'hold', firm: true }; }
        this.holdFace(u, near, nd);
        return;
      }
    }
    if (marching || u.order.type === 'attack') return; // on the way, or closing on an intruder (Game.attackStep)
    const inObjective = s.via >= r.via.length && Math.hypot(u.x - o.x, u.z - o.z) < o.r;
    const atPoint = s.via >= r.via.length && Math.hypot(u.x - r.aim[0], u.z - r.aim[1]) < ARRIVE;
    if (inObjective || atPoint) {
      const foe = u.state === 'steady' ? this.intruder(u) : null;
      if (foe && u.orderAttack(foe)) return;
      this.holdFace(u, near, nd);
      return;
    }
    if (u.state === 'wavering' || this.fighting(u) || g.simTime - s.issued < REISSUE_S
        || g.simTime - (u.lastFallback ?? -Infinity) < FALLBACK_COOL_S) { this.holdFace(u, near, nd); return; }
    const pts = [[u.x, u.z], ...r.via.slice(s.via)];
    let end = r.aim;
    if (u.type === 'artillery') {
      // stop short of the aim, at the battery's standing distance along the last leg
      const [ax, az] = pts[pts.length - 1];
      const d = Math.hypot(r.aim[0] - ax, r.aim[1] - az), stand = this.gunReach(u) * GUN_STAND;
      end = d > stand ? [r.aim[0] + ((ax - r.aim[0]) / d) * stand, r.aim[1] + ((az - r.aim[1]) / d) * stand] : [ax, az];
    }
    if (Math.hypot(end[0] - pts[pts.length - 1][0], end[1] - pts[pts.length - 1][1]) > 1) pts.push(end);
    if (pts.length < 2) { this.holdFace(u, near, nd); return; }
    if (u.orderMove(pts, { endFacing: r.facing })) s.issued = g.simTime;
  }

  /** Waypoints, the unit's own final point (target plus its lateral slot) and the facing of the approach. */
  route(u) {
    const g = this.game, ai = u.def.ai, lim = g.terrain.half - EDGE;
    const clamp = (p) => [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1]))];
    const target = clamp(ai.target || [g.objective.x, g.objective.z]);
    const via = (ai.via || []).map(clamp);
    const grp = this.slot(u, target);
    const off = grp.pos.get(u);
    // across the approach: (dz, -dx) is the line's right hand when facing along (dx, dz)
    const aim = clamp([target[0] + grp.dir[1] * off, target[1] - grp.dir[0] * off]);
    return { via, aim, facing: Math.atan2(grp.dir[0], grp.dir[1]) };
  }

  /**
   * The group of AI attackers and reserves sharing `target`, and this unit's lateral place in it. The approach
   * runs from the members' starting points (or their last waypoints) to the target; places fill centre, right,
   * left, ... by front width, and a later arrival takes the next place without moving the others.
   */
  slot(u, target) {
    const key = this.targetKey(u);
    let grp = this.groups.get(key);
    const members = () => this.game.units.filter((v) => v.side === this.side && roleOf(v) !== 'hold' && this.targetKey(v) === key);
    if (!grp) {
      const list = members();
      let sx = 0, sz = 0;
      for (const v of list) {
        const via = v.def.ai.via, from = via && via.length ? via[via.length - 1] : [v.def.x, v.def.z];
        sx += from[0]; sz += from[1];
      }
      const n = Math.max(1, list.length);
      let dx = target[0] - sx / n, dz = target[1] - sz / n;
      const len = Math.hypot(dx, dz);
      if (len < 1) { dx = 0; dz = this.side === 'US' ? 1 : -1; } else { dx /= len; dz /= len; }
      grp = { dir: [dx, dz], pos: new Map(), n: 0, right: 0, left: 0 };
      this.groups.set(key, grp);
      for (const v of list) this.place(grp, v);
    }
    if (!grp.pos.has(u)) for (const v of members()) if (!grp.pos.has(v)) this.place(grp, v);
    if (!grp.pos.has(u)) this.place(grp, u);
    return grp;
  }

  /** The group key: the unit's target (default the objective centre), kept inside the ground. */
  targetKey(v) {
    const lim = this.game.terrain.half - EDGE, o = this.game.objective, p = v.def.ai.target || [o.x, o.z];
    return Math.max(-lim, Math.min(lim, p[0])) + ',' + Math.max(-lim, Math.min(lim, p[1]));
  }

  place(grp, v) {
    const h = v.lineHalfFront();
    let pos;
    if (grp.n === 0) { pos = 0; grp.right = h; grp.left = -h; }
    else if (grp.n % 2 === 1) { pos = grp.right + SPREAD_GAP + h; grp.right = pos + h; }
    else { pos = grp.left - SPREAD_GAP - h; grp.left = pos - h; }
    grp.n++;
    grp.pos.set(v, pos);
  }
}

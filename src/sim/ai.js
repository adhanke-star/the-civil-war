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
//
// Delegation (DESIGN.md 2 "Command"): the player's own brigades with `unit.delegate = { role, x, z, since }`
// (Game.delegate) are driven here too, after the enemy pass, until a direct order reclaims them (Game.reclaim).
// Units without it are never touched, so undelegated play and the enemy AI run exactly as before.
//   attack   march (a move order: it halts to fight on the way) to its own point at the place, the units of one
//            delegation side by side across the approach (centre, right, left, ...); a battery stops once an
//            enemy is within its effective range. Arrived, it holds firm facing the nearest enemy and, if steady,
//            engages (attack order: fire) the nearest enemy within 150 m of its point; an attack drawn more than
//            260 m from the point is called off and the unit returns.
//   defend   go to its point, then hold firm facing the nearest enemy (or the enemy's side of the field).
//   support  trail 150 m behind the nearest friend at the place (an engaged one first: any own brigade not itself
//            in support, within 450 m of the place), moving up when it moves; masking (combat.js) keeps it from
//            firing through the friend, and with a clear shot in effective range it halts to fire like any march
//            (it follows again once masked or out of range). If that friend routs or falls, it marches to the
//            friend's last place and holds it. With no friend near, it waits at the place.
// The charge rule (attack and defend) and the fallback rule (every role) are the same as above.
//
// Cavalry (type 'cavalry', src/sim/combat.js): an AI regiment, twice a second, before its role (cavalryStep):
//   pursue   in the saddle and steady, it charges (rides down) the nearest routing enemy within PURSUE_REACH with no
//            fresh (not routing, not wavering) enemy within PURSUE_CLEAR of that fugitive; a reserve so commits.
//   shock    in the saddle and steady, it charges an enemy within CAV_CHARGE_REACH that a mounted charge breaks
//            (combat.js cavalryShock above 1: shaken, wavering, guns not on it, a line taken in flank).
//   attack   active, it rides (remounting first) to a flank of its prey (the nearest enemy within PREY_REACH, guns and
//            shaken men first): FLANK_GAP beyond the end of the prey's line, then charges from there. No prey: the
//            role's march on its target, as for infantry (horsemen do not halt to fire on the way, combat.js).
//   hold     carbine-armed and standing, it dismounts to fight on foot when an enemy comes within DISMOUNT_REACH.
// The fallback rule and everything else are as for infantry. Delegated cavalry follows the delegation rules.

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
export const DELEGATE_ROLES = Object.freeze(['attack', 'defend', 'support']);
const ATTACK_REACH = 150; // m from its point: a delegated attacker engages enemies this close
const ATTACK_LEASH = 260; // m from its point: an attack drawn further than this is called off
const SUPPORT_BACK = 150; // m behind the friend it supports
const SUPPORT_SLACK = 30; // m: this close to its trailing point a support stands
const SUPPORT_NEAR = 450; // m from the place: friends this close may be supported
const SUPPORT_REISSUE_S = 3; // sim s between march orders that follow a moving friend
const PURSUE_REACH = 300; // m: horsemen pursue a routing enemy this close
const PURSUE_CLEAR = 200; // m: ... when no fresh enemy stands this close to the fugitive
const CAV_CHARGE_REACH = 260; // m: horsemen charge a breakable enemy this close
const PREY_REACH = 900; // m: an attacking cavalry regiment looks for prey this far
const FLANK_GAP = 90; // m beyond the end of the prey's line where the horsemen form to charge
const FLANK_ARRIVE = 45; // m: this close to its flank point it charges
const DISMOUNT_REACH = 450; // m: a holding carbine regiment dismounts with an enemy this close

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
    this.delegation = new WeakMap(); // delegated own unit -> { d, aim, facing, issued, friend, spot, replaced }
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
      if (u.type === 'cavalry' && this.cavalryStep(u, role, near, nd)) continue;
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
    // the player's delegated brigades (none: nothing here runs)
    for (const u of units) {
      if (!u.delegate || u.side !== this.game.playerSide || !u.alive || u.state === 'routing' || u.melee) continue;
      const [near, nd] = this.nearestFoe(u);
      this.delegated(u, near, nd);
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Cavalry (see the header): pursuit, shock charges, flank attacks, dismounting to hold

  /** One AI cavalry regiment; true when it acted (the role's own step is skipped). */
  cavalryStep(u, role, near, nd) {
    if (u.order.type === 'charge' || u.switching) return true; // charging (the game steers the pursuit) or switching
    let s = null;
    if (role !== 'hold') {
      s = this.memo.get(u);
      if (!s) { s = { active: false, issued: -Infinity, via: 0 }; this.memo.set(u, s); }
      if (!s.active) s.active = this.activates(u, role, nd);
    }
    const horse = u.mounted && !u.switching;
    if (horse && u.state === 'steady') {
      const prey = this.fugitive(u);
      if (prey && u.orderCharge(prey)) { if (s) s.active = true; return true; }
      if (near && nd < CAV_CHARGE_REACH && (role !== 'hold' || near.state !== 'steady' || near.type === 'artillery')
        && this.game.combat.cavalryShock(u, near) > 1 && u.orderCharge(near)) { if (s) s.active = true; return true; }
    }
    if (role === 'hold' || !s.active) {
      if (role === 'hold' && horse && u.weapon !== 'pistol' && near && nd < DISMOUNT_REACH && !u.follow.active && u.state !== 'wavering') {
        u.toggleMount();
        return true;
      }
      return false;
    }
    return this.flankAttack(u, s);
  }

  /** The routing enemy this regiment may ride down: within PURSUE_REACH, no fresh enemy within PURSUE_CLEAR of it. */
  fugitive(u) {
    let best = null, bd = PURSUE_REACH;
    for (const e of this.game.units) {
      if (e.side === u.side || !e.alive || e.state !== 'routing') continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d >= bd) continue;
      const covered = this.game.units.some((f) => f.side === e.side && f !== e && f.alive && f.state !== 'routing' && f.state !== 'wavering'
        && f.state !== 'captured' && Math.hypot(f.x - e.x, f.z - e.z) < PURSUE_CLEAR);
      if (!covered) { bd = d; best = e; }
    }
    return best;
  }

  /** An attacking regiment rides to a flank of its prey and charges from there; false with no prey in reach. */
  flankAttack(u, s) {
    const g = this.game, lim = g.terrain.half - EDGE;
    let prey = null, best = Infinity;
    for (const e of g.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing' || e.state === 'captured') continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d > PREY_REACH) continue;
      const score = d * (e.type === 'artillery' ? 0.5 : e.state !== 'steady' ? 0.7 : 1);
      if (score < best) { best = score; prey = e; }
    }
    if (!prey) return false;
    if (!u.mounted) { if (u.state !== 'wavering') u.toggleMount(); return true; } // to the horses first
    if (u.follow.active || u.engaged) return true;
    const fs = Math.sin(prey.facing), fc = Math.cos(prey.facing);
    const side = (u.x - prey.x) * fc - (u.z - prey.z) * fs >= 0 ? 1 : -1; // the end of the prey's line nearer the horsemen
    const off = (prey.halfFront + FLANK_GAP) * side;
    const p = [Math.max(-lim, Math.min(lim, prey.x + fc * off - fs * 30)), Math.max(-lim, Math.min(lim, prey.z - fs * off - fc * 30))];
    if (Math.hypot(u.x - p[0], u.z - p[1]) < FLANK_ARRIVE) {
      if (u.state === 'steady' && u.orderCharge(prey)) return true;
      this.holdFace(u, prey, Math.hypot(prey.x - u.x, prey.z - u.z));
      return true;
    }
    if (u.state === 'wavering' || g.simTime - s.issued < REISSUE_S || g.simTime - (u.lastFallback ?? -Infinity) < FALLBACK_COOL_S) return false;
    if (u.orderMove([[u.x, u.z], p], { endFacing: Math.atan2(prey.x - p[0], prey.z - p[1]) })) s.issued = g.simTime;
    return true;
  }

  /** The nearest enemy that is not routing, and its distance. */
  nearestFoe(u) {
    let near = null, nd = Infinity;
    for (const e of this.game.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing') continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < nd) { nd = d; near = e; }
    }
    return [near, nd];
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

  // ---------------------------------------------------------------------------------------------------
  // Delegation: the player's own brigades given a place and a role (Game.delegate)

  /**
   * This unit's plan for its current delegation, made once for every unit delegated in the same act: the
   * approach runs from their centroid to the place and their points stand side by side across it (as `place`).
   */
  plan(u) {
    const m = this.delegation.get(u);
    if (m && m.d === u.delegate) return m;
    const d = u.delegate, g = this.game, lim = g.terrain.half - EDGE;
    const same = (v) => v.delegate && v.side === u.side && v.alive && v.delegate.since === d.since && v.delegate.role === d.role
      && v.delegate.x === d.x && v.delegate.z === d.z && this.delegation.get(v)?.d !== v.delegate;
    const list = g.units.filter(same);
    if (!list.includes(u)) list.push(u);
    let sx = 0, sz = 0;
    for (const v of list) { sx += v.x; sz += v.z; }
    let dx = d.x - sx / list.length, dz = d.z - sz / list.length;
    const len = Math.hypot(dx, dz);
    if (len < 1) { dx = 0; dz = u.side === 'US' ? 1 : -1; } else { dx /= len; dz /= len; }
    const grp = { pos: new Map(), n: 0, right: 0, left: 0 };
    for (const v of list) {
      this.place(grp, v);
      const off = grp.pos.get(v);
      const aim = [Math.max(-lim, Math.min(lim, d.x + dz * off)), Math.max(-lim, Math.min(lim, d.z - dx * off))];
      this.delegation.set(v, { d: v.delegate, aim, facing: Math.atan2(dx, dz), issued: -Infinity, friend: null, spot: null, replaced: false });
    }
    return this.delegation.get(u);
  }

  /** The facing a defender forms on: toward the nearest enemy from (x, z), else toward the enemy's side of the field. */
  defendFacing(u, x, z) {
    const f = this.game.ghostFacing(x, z, u.side, undefined);
    return Number.isFinite(f) ? f : u.side === 'US' ? 0 : Math.PI;
  }

  /** One delegated unit, twice a second: the shared charge and fallback rules, then its role. */
  delegated(u, near, nd) {
    const m = this.plan(u), role = u.delegate.role;
    if (u.order.type === 'charge') return;
    if (role !== 'support' && near) {
      const ahead = Math.abs(wrap(Math.atan2(near.x - u.x, near.z - u.z) - u.facing)) < 1.1;
      if (u.type === 'infantry' && u.state === 'steady' && nd < this.chargeReach && ahead &&
          (near.state === 'wavering' || near.state === 'shaken' && near.men < u.men * 0.7)) {
        u.orderCharge(near);
        return;
      }
    }
    if (near && u.state === 'wavering' && nd < 200 && near.men > u.men && !u.follow.active && (u.lastFallback || -99) < this.game.simTime - 25) {
      u.lastFallback = this.game.simTime;
      u.orderFallback(110);
      return;
    }
    if (role === 'support') { this.support(u, m, near, nd); return; }
    if (role === 'attack') {
      if (u.order.type === 'attack') {
        const t = u.order.target;
        if (t && Math.hypot(t.x - m.aim[0], t.z - m.aim[1]) > ATTACK_LEASH) { u.orderHalt(); m.issued = -Infinity; }
        return;
      }
      if (u.type === 'artillery' && near && nd <= this.gunReach(u)) {
        if ((u.follow.active || u.engaged) && u.order.type === 'move') { u.stop(); u.order = { type: 'hold', firm: true }; }
        this.holdFace(u, near, nd);
        return;
      }
    }
    if (u.follow.active || u.engaged) return; // on the way (halted to fight on a march resumes in combat.js)
    if (Math.hypot(u.x - m.aim[0], u.z - m.aim[1]) >= ARRIVE) {
      this.delegateMarch(u, m, m.aim, role === 'defend' ? this.defendFacing(u, m.aim[0], m.aim[1]) : m.facing, near, nd);
      return;
    }
    if (role === 'attack' && u.state === 'steady') {
      const foe = this.foeNear(u, m.aim, ATTACK_REACH);
      if (foe && u.orderAttack(foe)) return;
    }
    this.holdFace(u, near, nd);
  }

  /** March a delegated unit to `aim` (not while wavering, fighting, just ordered or just fallen back). */
  delegateMarch(u, m, aim, facing, near, nd, wait = REISSUE_S) {
    const g = this.game;
    if (u.state === 'wavering' || this.fighting(u) || g.simTime - m.issued < wait
        || g.simTime - (u.lastFallback ?? -Infinity) < FALLBACK_COOL_S) { this.holdFace(u, near, nd); return; }
    if (u.orderMove([[u.x, u.z], aim], { endFacing: facing })) m.issued = g.simTime;
  }

  /** The nearest enemy (not routing) within `reach` of point p. */
  foeNear(u, p, reach) {
    let best = null, bd = Infinity;
    for (const e of this.game.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing' || Math.hypot(e.x - p[0], e.z - p[1]) > reach) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** The friend a support trails: own brigades near the place that are not in support, engaged first, then nearest the place. */
  supported(u) {
    const d = u.delegate;
    let best = null, score = Infinity;
    for (const v of this.game.units) {
      if (v === u || v.side !== u.side || !v.alive || v.removed || v.state === 'routing' || v.delegate?.role === 'support') continue;
      const r = Math.hypot(v.x - d.x, v.z - d.z);
      if (r > SUPPORT_NEAR) continue;
      const s = r + (v.target || v.engaged || v.melee ? 0 : 1e4);
      if (s < score) { score = s; best = v; }
    }
    return best;
  }

  /** Support: trail the friend, follow it up, take its place if it breaks; with nobody to support, wait at the place. */
  support(u, m, near, nd) {
    const g = this.game, lim = g.terrain.half - EDGE;
    let f = m.friend;
    if (f && (!f.alive || f.removed || f.state === 'routing')) {
      if (m.spot) { m.replaced = true; m.issued = -Infinity; }
      m.friend = f = null;
    }
    if (m.replaced) { // hold the broken friend's place
      if (u.follow.active || u.engaged) return;
      if (Math.hypot(u.x - m.spot.x, u.z - m.spot.z) >= ARRIVE) this.delegateMarch(u, m, [m.spot.x, m.spot.z], m.spot.facing, near, nd);
      else this.holdFace(u, near, nd);
      return;
    }
    if (!f || !(f.target || f.engaged || f.melee)) { const next = this.supported(u); if (next) m.friend = f = next; }
    if (!f) {
      if (u.follow.active || u.engaged) return;
      if (Math.hypot(u.x - u.delegate.x, u.z - u.delegate.z) >= ARRIVE) this.delegateMarch(u, m, [u.delegate.x, u.delegate.z], this.defendFacing(u, u.delegate.x, u.delegate.z), near, nd);
      else this.holdFace(u, near, nd);
      return;
    }
    m.spot = { x: f.x, z: f.z, facing: f.facing };
    const back = [Math.max(-lim, Math.min(lim, f.x - Math.sin(f.facing) * SUPPORT_BACK)), Math.max(-lim, Math.min(lim, f.z - Math.cos(f.facing) * SUPPORT_BACK))];
    const goal = u.follow.active && u.path ? u.path[u.path.length - 1] : [u.x, u.z];
    if (Math.hypot(goal[0] - back[0], goal[1] - back[1]) <= SUPPORT_SLACK) {
      if (!u.follow.active && !u.engaged) this.holdFace(u, near, nd);
      return;
    }
    if (u.engaged) return; // halted to fight on the way; the march resumes in combat.js
    this.delegateMarch(u, m, back, f.facing, near, nd, SUPPORT_REISSUE_S);
  }
}

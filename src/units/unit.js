// src/units/unit.js: a brigade (or battery) on the field: formation, movement, figures, state.
//
// The unit's anchor is a Yuka Vehicle steered along the order path (FollowPathBehavior, which arrives at
// the last waypoint). Each figure owns a formation slot and walks to it with his own pace, so lines
// wheel (the outer end runs, the inner end slows), ripple and close up as men fall. Formations:
//   line    two dense ranks shoulder to shoulder (UG:G, and the 1861 drill), with a skirmish screen of a
//           few men spread 3-4 figure widths apart some 35 m ahead;
//   column  a column of fours along the unit's own trail (breadcrumbs behind the anchor), taken for long
//           marches with no enemy near, deploying back into line near the end of the path.
// A charge or rout spreads the men into a running swarm. One figure stands for MEN_PER_FIGURE men
// (look.menPerFigure: 10 or 5, live; setMenPerFigure + rebuildFigures) and 4 for a battery crew, so each gun
// has a crew of 4-5 figures.
//
// Drawing (FIGURE_VIEW in soldier-mesh.js, written by the game each frame): infantrymen go to the rigged
// SoldierPool, to the baked ImpostorPool (src/units/impostor.js), or to both with a clip side while
// look.figureStyle is compared split-screen. Officers, drivers and gun crews always stay rigged.
//
// Directions: yaw/facing f means forward = (sin f, cos f) in (x, z); lateral = (cos f, -sin f).
//
// Orders (set by game.js): move (march to the mark; may halt on the way to fight, see pauseMarch), attack
// (close on a target to effective range and fire; the game steers it), charge, fallback, hold. holdFire is a
// standing flag on the unit, not an order: it survives new orders until toggled off.

import { Vehicle, FollowPathBehavior, Path, Vector3 as YV } from 'yuka';
import { FIGURE_SCALE, FIGURE_VIEW } from './soldier-mesh.js';
import { framePos } from './figure.js';
import { BAKE_CLIP } from './impostor.js';
import { mulberry32 } from '../world/landscape.js';
import { RULES } from '../sim/rules.js';

export let MEN_PER_FIGURE = 10; // live binding: look.menPerFigure (the game calls setMenPerFigure)
export const MEN_PER_FIGURE_OPTIONS = [10, 5];
export const MEN_PER_CREW_FIGURE = 4;
/** Infantry density for figures made from now on (existing units: rebuildFigures). */
export function setMenPerFigure(n) {
  if (MEN_PER_FIGURE_OPTIONS.includes(n)) MEN_PER_FIGURE = n;
  return MEN_PER_FIGURE;
}
export const SPEED = { walk: 4.4, run: 7.4, charge: 8.4, fallback: 3.0, rout: 8.6 };
// Two dense ranks: at FIGURE_SCALE 4.4 a man's shoulders are about 2 m wide, so files 2.35 m apart touch.
const FILE_SPACING = 2.35;
const RANK_SPACING = 3.1;
const RANKS = 2;
const SKIRMISH_SHARE = 0.07;
const SKIRMISH_MAX = 14;
const SKIRMISH_MIN_FIGURES = 60;
const SKIRMISH_AHEAD = 36;
const SKIRMISH_SPACING = 7.5;
const COLUMN_FILES = 4;
const COLUMN_FILE_SPACING = 2.4;
const COLUMN_RANK_SPACING = 2.9;
const COLUMN_MIN_PATH = 220; // m: an order this long is marched in column
const COLUMN_DEPLOY = 95; // m before the end of the path: deploy into line
const COLUMN_ENEMY = 280; // m: an enemy closer than this keeps the brigade in line
const CRUMB = 1.5; // m between trail breadcrumbs
const TURN_RATE = 0.55; // rad/s for a whole line
const FALL_S = 0.8; // s a hit man takes to fall
const WALK_CYCLE = 1.3; // m of ground per two steps, life size
const RUN_CYCLE = 2.0;
const BLEND_RATE = 5; // 1/s crossfade between clips

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The baked pose for a figure's rigged clip. Baked: stand, an 8-frame walk, aim/fire/recover, a 5-frame load
 * and the lying frame. Run and charge use the walk (its cycle follows the ground walked); the fire clip is the
 * firing (recoil) frame then the recover; loading steps through the load frames as the reload fills
 * (bakedPhase).
 */
function bakedClip(f) {
  switch (f.clip) {
    case 'walk': case 'run': case 'charge': return BAKE_CLIP.WALK;
    case 'aim': return BAKE_CLIP.AIM;
    case 'load': return BAKE_CLIP.LOAD;
    case 'fire': return f.clipT < 0.45 ? BAKE_CLIP.FIRE : BAKE_CLIP.RECOVER;
    case 'fall-front': case 'fall-back': return BAKE_CLIP.FALLEN;
    default: return BAKE_CLIP.STAND;
  }
}

/** The baked clip's phase: walk cycles (ground walked / metres per cycle), or how far his loading has got (0..1). */
function bakedPhase(f, s, walkM) {
  return f.clip === 'load' ? f.loadT : f.stride / (s * walkM);
}

export class Unit {
  constructor(def, pool, terrain, seed) {
    Object.assign(this, {
      id: def.id,
      side: def.side,
      type: def.type || 'infantry',
      name: def.name,
      short: def.short || def.name,
      commander: def.commander || null,
      parent: def.parent || '',
      regiments: def.regiments || [],
      weapon: def.weapon || 'smooth',
      xp: def.xp || 1,
      guns: def.guns || 0,
      sources: def.sources || [],
      notes: def.notes || '',
    });
    this.def = def;
    this.terrain = terrain;
    this.pool = pool;
    this.halos = null; // set by the game (shared HaloPool)
    this.impostors = null; // set by the game (the side's baked ImpostorPool)
    this.horses = null; // set by the game (shared HorsePool) for the officer's mount
    this.fallenPool = null;
    this.menMax = def.men;
    this.men = def.men;
    this.morale = def.morale ?? 78;
    this.moraleMax = this.morale;
    this.fatigue = 0;
    this.ammo = 100;
    this.reload = 1; // 1 = loaded
    this.cover = 1;
    this.state = 'steady'; // steady | shaken | wavering | routing
    this.order = { type: 'hold' };
    this.run = false;
    this.facing = def.facing;
    this.goalFacing = def.facing;
    this.firing = false;
    this.underFire = 0;
    this.flanked = 0;
    this.melee = false;
    this.casualties = 0;
    this.rallyT = 0;
    this.target = null;
    this.nearestEnemy = Infinity;
    this.selected = false;
    this.path = null; // remaining order path [[x,z]...] for the arrow
    this.engaged = false; // halted on the way to fight (the march resumes when the enemy is gone or beaten)
    this.resumeT = 0;
    this.haltCount = 0; // times this unit halted on a march to fight (order-obedience tests read it)
    this.holdFire = false;
    this.manual = false; // a non-player-side unit the sandbox player has ordered (the AI leaves it alone)
    this.tickAcc = 0; // men lost since the last casualty tick was shown
    this.fireLoad = 0; // recent casualties inflicted, decaying (engagement line thickness)
    this.lastShooter = null;
    this.lastShotT = -99;
    this.formation = 'line';
    this.rnd = mulberry32(seed);

    this.vehicle = new Vehicle();
    this.vehicle.position.set(def.x, 0, def.z);
    this.vehicle.maxSpeed = SPEED.walk;
    this.vehicle.maxForce = 9;
    this.vehicle.mass = 1;
    this.vehicle.updateOrientation = false;
    this.follow = new FollowPathBehavior(new Path(), 18);
    this.follow.active = false;
    this.vehicle.steering.add(this.follow);

    // figures
    this.menPerFigure = this.type === 'artillery' ? MEN_PER_CREW_FIGURE : MEN_PER_FIGURE;
    this.figures = this.makeFigures(Math.max(1, Math.round(this.men / this.menPerFigure)), def.x, def.z, def.facing);
    // the brigade commander rides behind the centre of the line (only infantry brigades with a sourced commander)
    this.officer = this.type === 'infantry' && this.commander && this.commander.name
      ? { x: def.x, z: def.z, yaw: def.facing, horse: -1, phase: this.rnd(), coatVar: this.rnd(), trouserVar: this.rnd() }
      : null;
    // trail of breadcrumbs behind the anchor (for the column); starts as a straight line to the rear
    this.trail = [];
    const bs = Math.sin(def.facing), bc = Math.cos(def.facing);
    for (let i = 160; i >= 0; i--) this.trail.push([def.x - bs * i * CRUMB, def.z - bc * i * CRUMB]);
    this.columnSlots = [];
    this.layout();
    for (const f of this.figures) {
      const p = this.slotWorld(f);
      f.x = p[0];
      f.z = p[1];
    }
  }

  /** n standing figures at (x, z) facing `yaw`, a skirmish screen picked among them (infantry). */
  makeFigures(n, x, z, yaw) {
    const figures = [];
    for (let i = 0; i < n; i++) {
      figures.push({
        i,
        alive: true,
        dying: 0, front: false, gone: false,
        x, z, yaw,
        jx: (this.rnd() - 0.5) * 1.0, jz: (this.rnd() - 0.5) * 1.4,
        pace: 0.9 + this.rnd() * 0.25,
        phase: this.rnd(),
        clip: 'stand', clipT: 0, prevPos: 0, blend: 0,
        flash: 0, fireAt: -1, fireT: -1,
        lx: 0, lz: 0, rank: 0, skirmisher: false, order: i,
        coatVar: this.rnd(), trouserVar: this.rnd(),
        stride: 0, // world metres walked (scaled by pace): drives the baked walk cycle
        load0: 0, loadT: 0, // the unit's reload when he began loading; how far his loading has got (0..1)
      });
    }
    if (this.type === 'infantry' && n >= SKIRMISH_MIN_FIGURES) {
      const k = Math.min(SKIRMISH_MAX, Math.round(n * SKIRMISH_SHARE));
      const pick = [...figures].sort(() => this.rnd() - 0.5).slice(0, k);
      for (const f of pick) f.skirmisher = true;
    }
    return figures;
  }

  /**
   * Re-form an infantry brigade at the current MEN_PER_FIGURE (look.menPerFigure): new standing figures for
   * the men left, in their formation slots; men still falling finish their fall. Batteries keep their crews.
   */
  rebuildFigures() {
    if (this.type !== 'infantry' || this.menPerFigure === MEN_PER_FIGURE) return false;
    this.menPerFigure = MEN_PER_FIGURE;
    const falling = this.figures.filter((f) => !f.alive && !f.gone);
    const n = this.alive ? Math.max(1, Math.round(this.men / this.menPerFigure)) : 0;
    this.figures = this.makeFigures(n, this.x, this.z, this.facing).concat(falling);
    if (this.formation === 'column') this.layoutColumn(); else this.layout();
    this.snapFigures();
    return true;
  }

  get x() { return this.vehicle.position.x; }
  get z() { return this.vehicle.position.z; }
  get alive() { return this.men >= 1; }
  get aliveFigures() { return this.figures.filter((f) => f.alive); }

  /** Assign line slots (two dense ranks plus the skirmish screen) to living figures, keeping neighbours. */
  layout() {
    const live = this.figures.filter((f) => f.alive);
    const screen = this.formation === 'line' ? live.filter((f) => f.skirmisher) : [];
    const body = screen.length ? live.filter((f) => !f.skirmisher) : live;
    const ranks = body.length > 14 ? RANKS : 1;
    const files = Math.ceil(body.length / ranks);
    body.sort((a, b) => a.lx - b.lx || a.rank - b.rank);
    for (let k = 0; k < body.length; k++) {
      const file = Math.floor(k / ranks);
      const rank = k % ranks;
      const f = body[k];
      f.lx = (file - (files - 1) / 2) * FILE_SPACING;
      f.lz = ((ranks - 1) / 2 - rank) * RANK_SPACING;
      f.rank = rank;
    }
    screen.sort((a, b) => a.lx - b.lx);
    for (let k = 0; k < screen.length; k++) {
      const f = screen[k];
      f.lx = (k - (screen.length - 1) / 2) * SKIRMISH_SPACING;
      f.lz = SKIRMISH_AHEAD + (k % 2) * 4;
      f.rank = -1;
    }
    this.halfFront = Math.max(4, ((files - 1) / 2) * FILE_SPACING);
    this.depth = ranks * RANK_SPACING + (screen.length ? SKIRMISH_AHEAD * 0.5 : 0);
    this.files = files;
  }

  /** Half the width of the brigade's front once it stands in line (also while it marches in column). */
  lineHalfFront() {
    if (this.formation !== 'column' || !this.files) return this.halfFront;
    return Math.max(4, ((this.files - 1) / 2) * FILE_SPACING);
  }

  /** Column of fours along the trail: slot k = rank k/4 at COLUMN_RANK_SPACING back along the trail. */
  layoutColumn() {
    const live = this.figures.filter((f) => f.alive).sort((a, b) => a.order - b.order);
    const ranks = Math.ceil(live.length / COLUMN_FILES);
    // resample the trail from the head backwards at COLUMN_RANK_SPACING
    const slots = this.columnSlots;
    slots.length = 0;
    const T = this.trail;
    let hx = this.x, hz = this.z;
    let k = T.length - 1;
    let need = COLUMN_RANK_SPACING * 0.5;
    let px = hx, pz = hz;
    let tx = 0, tz = 1;
    while (slots.length < ranks && k >= 0) {
      const [cx, cz] = T[k];
      const dx = cx - px, dz = cz - pz;
      const seg = Math.hypot(dx, dz);
      if (seg > 1e-6) { tx = -dx / seg; tz = -dz / seg; }
      if (seg >= need) {
        const t = need / seg;
        px += dx * t; pz += dz * t;
        slots.push([px, pz, Math.atan2(tx, tz)]);
        need = COLUMN_RANK_SPACING;
      } else {
        need -= seg;
        px = cx; pz = cz;
        k--;
      }
    }
    while (slots.length < ranks) {
      const last = slots[slots.length - 1] || [hx, hz, this.facing];
      slots.push([last[0] - Math.sin(last[2]) * COLUMN_RANK_SPACING, last[1] - Math.cos(last[2]) * COLUMN_RANK_SPACING, last[2]]);
    }
    for (let i = 0; i < live.length; i++) {
      const f = live[i];
      f.crank = Math.floor(i / COLUMN_FILES);
      f.cfile = (i % COLUMN_FILES) - (COLUMN_FILES - 1) / 2;
      f.rank = f.crank === 0 ? 0 : 1;
    }
    this.halfFront = COLUMN_FILES * COLUMN_FILE_SPACING * 0.5 + 6;
    this.depth = Math.max(10, ranks * COLUMN_RANK_SPACING);
  }

  slotWorld(f) {
    if (this.formation === 'column' && f.crank !== undefined && this.columnSlots[f.crank]) {
      const [sx, sz, yaw] = this.columnSlots[f.crank];
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = f.cfile * COLUMN_FILE_SPACING + f.jx * 0.6;
      return [sx + c * lx, sz - s * lx, yaw];
    }
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const charging = this.order.type === 'charge' && this.follow.active;
    const spread = this.state === 'routing' ? 2.4 : charging ? 1.9 : this.state === 'wavering' ? 1.25 : 1;
    const lx = f.lx * (this.state === 'routing' ? 0.7 : 1) + f.jx * spread * 2;
    const lz = f.lz + f.jz * spread * (this.state === 'routing' ? 6 : charging ? 3.5 : 1);
    return [this.x + c * lx + s * lz, this.z - s * lx + c * lz, this.facing];
  }

  /** Is a ground point on this unit's footprint (for picking)? */
  contains(x, z, pad = 10) {
    const dx = x - this.x, dz = z - this.z;
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const lat = dx * c - dz * s;
    const fwd = dx * s + dz * c;
    if (this.formation === 'column') return Math.abs(lat) < this.halfFront + pad && fwd < pad + 6 && fwd > -this.depth - pad;
    return Math.abs(lat) < this.halfFront + pad && Math.abs(fwd) < this.depth + pad;
  }

  // ---------------------------------------------------------------------------------------------------
  // Orders
  canTakeOrders() {
    return this.alive && this.state !== 'routing';
  }

  /** Steer along points [[x,z]...] without changing the order (used by move, attack, charge, fallback). */
  setPath(points) {
    const path = new Path();
    for (const [x, z] of points) path.add(new YV(x, 0, z));
    this.follow.path = path;
    this.follow.active = true;
    this.engaged = false;
    this.resumeT = 0;
    this.path = points.map((p) => [p[0], p[1]]);
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    this.pathLength = len;
  }

  orderMove(points, { charge = false, fallback = false, endFacing } = {}) {
    if (!this.canTakeOrders()) return false;
    this.setPath(points);
    const n = points.length;
    const a = points[Math.max(0, n - 2)], b = points[n - 1];
    const face = Number.isFinite(endFacing) ? endFacing : Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.order = { type: charge ? 'charge' : fallback ? 'fallback' : 'move', endFacing: face, keepFacing: fallback, dest: [b[0], b[1]] };
    return true;
  }

  /** Close on `target` to effective range and fire (the game steers the approach, see Game.attackStep). */
  orderAttack(target, endFacing) {
    if (!this.canTakeOrders() || !target) return false;
    this.stop();
    this.order = { type: 'attack', target, endFacing: Number.isFinite(endFacing) ? endFacing : Math.atan2(target.x - this.x, target.z - this.z), goal: null };
    return true;
  }

  /** Halt on the march to fight an enemy in effective range; the path is kept and the march resumes later. */
  pauseMarch(faceX, faceZ) {
    if (this.engaged || !this.follow.active) return;
    this.follow.active = false;
    this.vehicle.velocity.set(0, 0, 0);
    this.engaged = true;
    this.resumeT = 0;
    this.haltCount++;
    this.setFormation('line');
    if (faceX !== undefined) this.goalFacing = Math.atan2(faceX - this.x, faceZ - this.z);
  }

  resumeMarch() {
    if (!this.engaged) return;
    this.engaged = false;
    this.resumeT = 0;
    if (this.path && this.path.length && this.follow.path) this.follow.active = true;
  }

  orderHold() {
    if (!this.canTakeOrders()) return false;
    this.stop();
    this.order = { type: 'hold', firm: true };
    return true;
  }

  orderHalt() {
    if (!this.canTakeOrders()) return false;
    this.stop();
    this.order = { type: 'hold' };
    return true;
  }

  orderFallback(dist = 130) {
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const bx = this.x - s * dist, bz = this.z - c * dist;
    return this.orderMove([[this.x, this.z], [bx, bz]], { fallback: true });
  }

  orderCharge(target) {
    if (!this.canTakeOrders() || !target) return false;
    const ok = this.orderMove([[this.x, this.z], [target.x, target.z]], { charge: true });
    if (ok) this.order.target = target;
    return ok;
  }

  toggleRun() {
    if (!this.canTakeOrders()) return false;
    this.run = !this.run;
    return true;
  }

  stop() {
    this.follow.active = false;
    this.vehicle.velocity.set(0, 0, 0);
    this.path = null;
    this.engaged = false;
    if (this.order.type === 'move' || this.order.type === 'charge' || this.order.type === 'fallback') {
      this.goalFacing = this.facing;
    }
    this.setFormation('line');
  }

  setFormation(kind) {
    if (this.formation === kind) return;
    this.formation = kind;
    if (kind === 'line') this.layout();
    else this.layoutColumn();
  }

  // ---------------------------------------------------------------------------------------------------
  // Per-frame movement (Yuka EntityManager updates the vehicle before this).
  move(dt, homeZ) {
    const o = this.order;
    const v = this.vehicle;
    let speed = SPEED.walk;
    if (this.state === 'routing') speed = SPEED.rout;
    else if (o.type === 'charge') speed = SPEED.charge;
    else if (o.type === 'fallback') speed = SPEED.fallback;
    else if (this.run) speed = SPEED.run;
    if (this.state === 'wavering' && o.type !== 'fallback') speed *= 0.5;
    speed *= 1 - 0.4 * (this.fatigue / 100);
    // ground: woods slow the line, slopes too
    const slope = this.terrain.slopeAt(this.x, this.z);
    speed *= Math.max(0.55, 1 - slope * 0.8);
    if (this.inWoods) speed *= 0.7;
    if (this.formation === 'column') speed *= 1.1; // a road column keeps a better pace than a line over fields
    speed *= RULES.marchSpeed;
    v.maxSpeed = speed;

    if (this.state === 'routing') {
      this.follow.active = false;
      this.setFormation('line');
      const dz = homeZ - this.z;
      const goalYaw = Math.atan2(0, dz);
      v.velocity.set(0, 0, Math.sign(dz) * speed);
      this.goalFacing = goalYaw;
      this.facing += wrap(this.goalFacing - this.facing) * Math.min(1, dt * 3);
    } else if (this.follow.active) {
      // trim the arrow behind the unit
      if (this.path && this.path.length > 1) {
        const [nx, nz] = this.path[1];
        if (Math.hypot(nx - this.x, nz - this.z) < 22) this.path.shift();
        this.path[0] = [this.x, this.z];
      }
      const sp = Math.hypot(v.velocity.x, v.velocity.z);
      const last = this.follow.path._waypoints[this.follow.path._waypoints.length - 1];
      const remain = Math.hypot(last.x - this.x, last.z - this.z);
      // column for a long march with no enemy near; deploy into line before the end
      const wantColumn = o.type === 'move' && this.type === 'infantry' && (this.pathLength || 0) > COLUMN_MIN_PATH
        && remain > COLUMN_DEPLOY && this.nearestEnemy > COLUMN_ENEMY && this.state !== 'wavering' && !this.melee;
      this.setFormation(wantColumn ? 'column' : 'line');
      if (!o.keepFacing && sp > 0.4 && remain > 25) this.goalFacing = Math.atan2(v.velocity.x, v.velocity.z);
      else if (remain <= 25 && o.endFacing !== undefined && !o.keepFacing) this.goalFacing = o.endFacing;
      if (this.follow.path.finished() && remain < 3 && sp < 0.6) {
        this.stop();
        this.run = false;
        if (o.type === 'attack') {
          // in position: the game decides whether to close further; face the target meanwhile
          if (o.target) this.goalFacing = Math.atan2(o.target.x - this.x, o.target.z - this.z);
        } else {
          // hold facing as the order set it (not wherever the wheel had got to when the men stopped)
          if (o.endFacing !== undefined && !o.keepFacing && o.type === 'move') this.goalFacing = o.endFacing;
          if (o.type === 'charge' && !this.melee) this.order = { type: 'hold' };
          else if (o.type !== 'charge') this.order = { type: 'hold' };
        }
      }
      const turn = TURN_RATE * (o.type === 'charge' ? 1.6 : this.formation === 'column' ? 2.5 : 1) * dt;
      this.facing += Math.max(-turn, Math.min(turn, wrap(this.goalFacing - this.facing)));
    } else {
      v.velocity.set(0, 0, 0);
      const turn = TURN_RATE * dt;
      this.facing += Math.max(-turn, Math.min(turn, wrap(this.goalFacing - this.facing)));
    }
    // keep inside the mapped ground
    const lim = this.terrain.half - 30;
    v.position.x = Math.max(-lim, Math.min(lim, v.position.x));
    v.position.z = Math.max(-lim, Math.min(lim, v.position.z));
    // breadcrumbs
    const T = this.trail;
    const lastC = T[T.length - 1];
    if (Math.hypot(this.x - lastC[0], this.z - lastC[1]) >= CRUMB) {
      T.push([this.x, this.z]);
      if (T.length > 420) T.splice(0, T.length - 420);
    }
  }

  /** Remove `menLost` men; the figures that die fall where they stand (see animate). */
  takeLosses(menLost, fallenPool, now) {
    if (menLost <= 0 || !this.alive) return;
    if (fallenPool) this.fallenPool = fallenPool;
    const lost = Math.min(this.men, menLost);
    this.men = Math.max(0, this.men - menLost);
    this.casualties += lost;
    this.tickAcc += lost;
    const want = Math.ceil(this.men / this.menPerFigure - 0.25);
    let live = this.figures.filter((f) => f.alive);
    let killed = 0;
    while (live.length > want && live.length > 0) {
      // front rank and the middle of the line suffer most
      let pick = Math.floor(this.rnd() * live.length);
      if (this.rnd() < 0.6) {
        const front = live.filter((f) => f.rank === 0);
        if (front.length) pick = live.indexOf(front[Math.floor(this.rnd() * front.length)]);
      }
      const f = live[pick];
      f.alive = false;
      f.dying = now > 0 ? now : 1e-6;
      f.front = this.rnd() < 0.45;
      f.dieYaw = f.yaw + (this.rnd() - 0.5) * 1.6;
      killed++;
      live.splice(pick, 1);
    }
    if (killed) {
      if (this.formation === 'line') this.layout(); else this.layoutColumn();
      this.lastHit = now;
    }
  }

  snapFigures() {
    if (this.formation === 'column') this.layoutColumn();
    for (const f of this.figures) {
      if (!f.alive) continue;
      const [x, z, yaw] = this.slotWorld(f);
      f.x = x;
      f.z = z;
      f.yaw = yaw;
    }
  }

  /** Switch a figure's clip with a short crossfade from its current pose. */
  setClip(f, clip, reset = false) {
    if (f.clip === clip) return;
    f.prevPos = framePos(f.clip, f.clipT);
    f.blend = 1;
    f.clip = clip;
    if (reset) f.clipT = 0;
  }

  /** Per-frame figure motion and upload to the pool. */
  animate(dt, time) {
    const T = this.terrain;
    const V = FIGURE_VIEW;
    const s = FIGURE_SCALE * V.scale;
    const pool = this.pool;
    const routing = this.state === 'routing';
    const charging = this.order.type === 'charge' && this.follow.active;
    const unitSpeed = Math.hypot(this.vehicle.velocity.x, this.vehicle.velocity.z);
    const maxSp = Math.max(SPEED.walk, unitSpeed) * 1.35;
    if (this.formation === 'column') this.layoutColumn();
    const infantry = this.type === 'infantry';
    const halos = this.halos;
    const haloKind = this.selected ? 1 : this.underFire > 0 ? 2 : 0;
    const haloStr = Math.min(1, this.underFire / 0.9);
    // which styles draw this unit's infantrymen (crews, drivers and officers are always rigged)
    const imp = infantry ? this.impostors : null;
    const baked = !!(imp && V.baked);
    const rigged = !baked || V.rigged;
    const rc = baked ? V.clipRigged : 0, bc = V.clipBaked;
    const walkM = imp && imp.layout ? imp.layout.walkMetres : 1.2;
    for (const f of this.figures) {
      if (f.gone) continue;
      if (!f.alive) {
        // falling: play the fall clip where he stood, then hand him to the casualty pool
        const p = (time - f.dying) / FALL_S;
        const y = T.heightAt(f.x, f.z);
        if (p < 1) {
          this.setClip(f, f.front ? 'fall-front' : 'fall-back');
          f.blend = 0;
          if (rigged) pool.push(f.x, y, f.z, f.dieYaw, s, framePos(f.clip, p), f.prevPos, 0, 0, f.coatVar, f.trouserVar, infantry ? 1 : 0, 0, rc);
          if (baked) imp.push(f.x, y, f.z, f.dieYaw, s, BAKE_CLIP.FALLEN, 0, f.coatVar, bc, f.i); // only the lying frame is baked
        } else {
          f.gone = true;
          const fp = this.fallenPool;
          if (fp) {
            const j = fp.alloc();
            if (j >= 0) fp.set(j, f.x, y, f.z, f.dieYaw, s, f.front, f.coatVar, f.trouserVar, infantry);
          }
          if (imp) imp.addFallen(f.x, y, f.z, f.dieYaw, s, f.coatVar, f.i);
        }
        continue;
      }
      if (f.mount) {
        // a driver on a limber horse: placed by the battery, rides in the saddle
        this.setClip(f, 'ride');
        f.clipT += dt * (this.follow.active ? 2.2 : 0.5);
        f.blend = Math.max(0, f.blend - dt * BLEND_RATE);
        const my = T.heightAt(f.x, f.z);
        pool.push(f.x, my + (f.mountY || 0), f.z, f.yaw, s, framePos('ride', f.clipT), f.prevPos, f.blend, 0, f.coatVar, f.trouserVar, 0, 0);
        continue;
      }
      const [tx, tz, slotYaw] = this.slotWorld(f);
      const dx = tx - f.x, dz = tz - f.z;
      const d = Math.hypot(dx, dz);
      let step = 0;
      if (d > 0.05) {
        const sp = Math.min(maxSp * f.pace, d * 2.2 + unitSpeed * 0.3);
        step = Math.min(d, sp * dt);
        f.x += (dx / d) * step;
        f.z += (dz / d) * step;
      }
      const v = step / dt;
      const moving = v > 0.35;
      const goalYaw = moving && (d > 3 || routing) ? Math.atan2(dx, dz) : slotYaw;
      // fallback: walk backwards keeping the face to the enemy
      const yawGoal = this.order.keepFacing && !routing ? this.facing : goalYaw;
      f.yaw += wrap(yawGoal - f.yaw) * Math.min(1, dt * 5);

      // clip
      if (moving) {
        const running = routing || charging || this.run || v > SPEED.walk * 1.35;
        const clip = charging && infantry ? 'charge' : running ? 'run' : 'walk';
        this.setClip(f, clip);
        f.clipT += step / (s * (running ? RUN_CYCLE : WALK_CYCLE)) * f.pace;
        f.stride += step * f.pace;
      } else if (infantry && this.firing && !routing) {
        if (f.fireAt >= 0 && time >= f.fireAt) { f.flash = 1; f.fireT = time; f.fireAt = -1; }
        const ready = 0.5 + (f.phase - 0.5) * 0.3; // the reload at which this man has loaded
        if (f.fireT >= 0 && time - f.fireT < 0.35) {
          this.setClip(f, 'fire');
          f.clipT = (time - f.fireT) / 0.35;
        } else if (f.fireAt < 0 && this.reload < ready) {
          // loading (a man whose shot is still to come in this volley keeps aiming): the baked load frames
          // follow the unit's reload, so their pace is the weapon's reload time
          if (f.clip !== 'load') f.load0 = Math.min(this.reload, ready - 0.02);
          this.setClip(f, 'load');
          f.clipT = 0;
          f.loadT = Math.min(1, Math.max(0, (this.reload - f.load0) / (ready - f.load0)));
        } else {
          this.setClip(f, 'aim');
          f.clipT = 0;
        }
      } else if (!infantry) {
        this.setClip(f, f.crewClip || 'crew');
        f.clipT = 0;
      } else {
        this.setClip(f, 'stand');
        f.clipT += dt * 0.6;
      }
      f.blend = Math.max(0, f.blend - dt * BLEND_RATE);
      f.flash = Math.max(0, f.flash - dt * 9);
      const y = T.heightAt(f.x, f.z);
      if (rigged) pool.push(f.x, y, f.z, f.yaw, s, framePos(f.clip, f.clipT), f.prevPos, f.blend, f.flash, f.coatVar, f.trouserVar, f.prop ?? (infantry ? 1 : 0), 0, rc);
      if (baked) imp.push(f.x, y, f.z, f.yaw, s, bakedClip(f), bakedPhase(f, s, walkM), f.coatVar, bc, f.i);
      // one ellipse per man (files are 2.35 m apart); a sprite carries its own baked shadow, so no blob for it
      if (halos && (haloKind || rigged)) halos.push(f.x, y, f.z, f.yaw, (haloKind ? 1.45 : 1.7) * V.scale, (haloKind ? 1.2 : 1.1) * V.scale, haloKind, haloStr, haloKind ? 0 : rc);
    }
    if (this.officer) this.animateOfficer(dt, time);
  }

  /** The brigade commander on horseback behind the centre of the line (ahead of a column). */
  animateOfficer(dt, time) {
    const o = this.officer;
    const s = FIGURE_SCALE * FIGURE_VIEW.scale;
    const T = this.terrain;
    if (o.horse < 0 && this.horses) o.horse = this.horses.alloc(o.coat || '#5a3a26');
    if (!this.alive) { if (o.horse >= 0) this.horses.set(o.horse, 0, -500, 0, 0, 0.001); return; }
    const fs = Math.sin(this.facing), fc = Math.cos(this.facing);
    let tx, tz, tyaw;
    if (this.formation === 'column' && this.columnSlots.length) {
      tx = this.x + fs * 9 + fc * 5; tz = this.z + fc * 9 - fs * 5; tyaw = this.facing;
    } else {
      const back = this.state === 'routing' ? 4 : RANK_SPACING + 7;
      tx = this.x - fs * back + fc * 3; tz = this.z - fc * back - fs * 3; tyaw = this.facing;
    }
    const dx = tx - o.x, dz = tz - o.z;
    const d = Math.hypot(dx, dz);
    const unitSpeed = Math.hypot(this.vehicle.velocity.x, this.vehicle.velocity.z);
    const sp = Math.min(Math.max(SPEED.run, unitSpeed * 1.4), d * 2.5 + unitSpeed * 0.5);
    const step = Math.min(d, sp * dt);
    if (d > 0.05) { o.x += (dx / d) * step; o.z += (dz / d) * step; }
    const moving = step / dt > 0.4;
    const goal = moving && d > 3 ? Math.atan2(dx, dz) : tyaw;
    o.yaw += wrap(goal - o.yaw) * Math.min(1, dt * 4);
    o.phase += moving ? dt * 2.2 : dt * 0.5;
    const y = T.heightAt(o.x, o.z);
    const hs = s * 0.92;
    if (o.horse >= 0) this.horses.set(o.horse, o.x, y, o.z, o.yaw, hs);
    // the rider's hip sits on the saddle (1.5 m up the horse); his root pivot is 0.98 m up the figure
    this.pool.push(o.x, y + (1.52 - 0.98) * hs, o.z, o.yaw, s, framePos('ride', o.phase), 0, 0, 0, o.coatVar, o.trouserVar, 0, 1);
    if (this.halos) this.halos.push(o.x, y, o.z, o.yaw, 1.6, 2.6, this.selected ? 1 : 0, 0);
  }

  /**
   * Schedule a ragged volley: the men fire over ~0.9 s. Returns muzzle positions for smoke:
   * about one puff per 9 m of front, so the line disappears into a bank of powder smoke.
   */
  volley(time) {
    const muzzles = [];
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    let lastLx = -Infinity;
    const shooters = this.figures.filter((f) => f.alive && (f.clip === 'aim' || f.clip === 'load' || f.clip === 'fire' || this.follow.active)).sort((a, b) => a.lx - b.lx);
    for (const f of shooters) {
      if (f.rank > 0 && this.rnd() < 0.35) continue;
      f.fireAt = time + this.rnd() * 0.9;
      if (f.rank <= 0 && f.lx - lastLx > 9) {
        lastLx = f.lx;
        muzzles.push([f.x + s * 3.5, f.z + c * 3.5, f.fireAt - time]);
      }
    }
    return muzzles;
  }
}

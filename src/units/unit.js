// src/units/unit.js: a brigade (or battery) on the field: formation, movement, figures, state.
//
// The unit's anchor is a Yuka Vehicle steered along the order path (FollowPathBehavior, which arrives at
// the last waypoint). Each figure owns a formation slot (four loose ranks) and walks to it with its own
// pace, so lines wheel, ripple and compact as men fall. One figure stands for MEN_PER_FIGURE men.
//
// Directions: yaw/facing f means forward = (sin f, cos f) in (x, z); lateral = (cos f, -sin f).

import { Vehicle, FollowPathBehavior, Path, Vector3 as YV } from 'yuka';
import { FIGURE_SCALE } from './soldier-mesh.js';
import { mulberry32 } from '../world/landscape.js';

export const MEN_PER_FIGURE = 10;
export const SPEED = { walk: 4.4, run: 7.4, charge: 8.4, fallback: 3.0, rout: 8.6 };
// Four loose ranks (a stylisation like UG:G's: one figure stands for 10 men, so frontage is already
// compressed about threefold; a deeper block reads as a brigade from the battle camera).
const FILE_SPACING = 2.6;
const RANK_SPACING = 4.2;
const RANKS = 4;
const TURN_RATE = 0.55; // rad/s for a whole line

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
    this.selected = false;
    this.path = null; // remaining order path [[x,z]...] for the arrow
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
    const n = Math.max(1, Math.round(this.men / MEN_PER_FIGURE));
    this.figures = [];
    for (let i = 0; i < n; i++) {
      this.figures.push({
        i: pool.alloc(),
        alive: true,
        x: def.x, z: def.z, yaw: def.facing,
        jx: (this.rnd() - 0.5) * 1.3, jz: (this.rnd() - 0.5) * 1.8,
        pace: 0.9 + this.rnd() * 0.25,
        phase: this.rnd() * Math.PI * 2,
        aim: 0, flash: 0, fireAt: -1,
        lx: 0, lz: 0, rank: 0,
        coatVar: this.rnd(), trouserVar: this.rnd(),
      });
    }
    this.layout();
    for (const f of this.figures) {
      const p = this.slotWorld(f);
      f.x = p[0];
      f.z = p[1];
    }
  }

  get x() { return this.vehicle.position.x; }
  get z() { return this.vehicle.position.z; }
  get alive() { return this.men >= 1; }
  get aliveFigures() { return this.figures.filter((f) => f.alive); }

  /** Assign two-rank slots to living figures, keeping men on the same side of the line. */
  layout() {
    const live = this.figures.filter((f) => f.alive);
    const ranks = live.length > 36 ? RANKS : live.length > 12 ? 2 : 1;
    const files = Math.ceil(live.length / ranks);
    live.sort((a, b) => a.lx - b.lx || a.rank - b.rank);
    for (let k = 0; k < live.length; k++) {
      const file = Math.floor(k / ranks);
      const rank = k % ranks;
      const f = live[k];
      f.lx = (file - (files - 1) / 2) * FILE_SPACING;
      f.lz = ((ranks - 1) / 2 - rank) * RANK_SPACING;
      f.rank = rank;
    }
    this.halfFront = Math.max(4, ((files - 1) / 2) * FILE_SPACING);
    this.depth = ranks * RANK_SPACING;
  }

  slotWorld(f) {
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const spread = this.state === 'routing' ? 2.4 : this.state === 'wavering' ? 1.25 : 1;
    const lx = f.lx * (this.state === 'routing' ? 0.7 : 1) + f.jx * spread * 2;
    const lz = f.lz + f.jz * spread * (this.state === 'routing' ? 6 : 1);
    return [this.x + c * lx + s * lz, this.z - s * lx + c * lz];
  }

  /** Is a ground point on this unit's footprint (for picking)? */
  contains(x, z, pad = 10) {
    const dx = x - this.x, dz = z - this.z;
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const lat = dx * c - dz * s;
    const fwd = dx * s + dz * c;
    return Math.abs(lat) < this.halfFront + pad && Math.abs(fwd) < this.depth + pad;
  }

  // ---------------------------------------------------------------------------------------------------
  // Orders
  canTakeOrders() {
    return this.alive && this.state !== 'routing';
  }

  orderMove(points, { charge = false, fallback = false } = {}) {
    if (!this.canTakeOrders()) return false;
    const path = new Path();
    for (const [x, z] of points) path.add(new YV(x, 0, z));
    this.follow.path = path;
    this.follow.active = true;
    this.path = points.map((p) => [p[0], p[1]]);
    const n = points.length;
    const a = points[Math.max(0, n - 2)], b = points[n - 1];
    const endFacing = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.order = { type: charge ? 'charge' : fallback ? 'fallback' : 'move', endFacing, keepFacing: fallback };
    return true;
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
    if (this.order.type === 'move' || this.order.type === 'charge' || this.order.type === 'fallback') {
      this.goalFacing = this.facing;
    }
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
    v.maxSpeed = speed;

    if (this.state === 'routing') {
      this.follow.active = false;
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
      if (!o.keepFacing && sp > 0.4 && remain > 25) this.goalFacing = Math.atan2(v.velocity.x, v.velocity.z);
      else if (remain <= 25 && o.endFacing !== undefined && !o.keepFacing) this.goalFacing = o.endFacing;
      if (this.follow.path.finished() && remain < 3 && sp < 0.6) {
        this.stop();
        this.run = false;
        if (o.type === 'charge' && !this.melee) this.order = { type: 'hold' };
        else if (o.type !== 'charge') this.order = { type: 'hold' };
      }
      const turn = TURN_RATE * (o.type === 'charge' ? 1.6 : 1) * dt;
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
  }

  /** Remove `menLost` men; kill figures to match and leave them lying where they fell. */
  takeLosses(menLost, fallenPool, now) {
    if (menLost <= 0 || !this.alive) return;
    this.men = Math.max(0, this.men - menLost);
    this.casualties += menLost;
    const want = Math.ceil(this.men / MEN_PER_FIGURE - 0.25);
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
      killed++;
      if (fallenPool && fallenPool.used < fallenPool.capacity) {
        const j = fallenPool.alloc();
        const y = this.terrain.heightAt(f.x, f.z);
        fallenPool.setFallen(j, f.x, y, f.z, f.yaw + (this.rnd() - 0.5) * 2.5, FIGURE_SCALE, this.rnd() < 0.5 ? 0 : (this.rnd() - 0.5) * 2.4);
        fallenPool.setTint(j, f.coatVar, f.trouserVar, 0, 0);
      }
      this.pool.set(f.i, 0, -500, 0, 0, 0.0001, 0, 0, 0, 0); // hide the standing figure
      live.splice(pick, 1);
    }
    if (killed) {
      this.layout();
      this.lastHit = now;
    }
  }

  snapFigures() {
    for (const f of this.figures) {
      if (!f.alive) continue;
      const [x, z] = this.slotWorld(f);
      f.x = x;
      f.z = z;
    }
  }

  /** Per-frame figure motion and upload to the pool. */
  animate(dt, time) {
    const T = this.terrain;
    const s = FIGURE_SCALE;
    const routing = this.state === 'routing';
    const unitSpeed = Math.hypot(this.vehicle.velocity.x, this.vehicle.velocity.z);
    const maxSp = Math.max(SPEED.walk, unitSpeed) * 1.35;
    for (const f of this.figures) {
      if (!f.alive) continue;
      const [tx, tz] = this.slotWorld(f);
      const dx = tx - f.x, dz = tz - f.z;
      const d = Math.hypot(dx, dz);
      let step = 0;
      if (d > 0.05) {
        const sp = Math.min(maxSp * f.pace, d * 2.2 + unitSpeed * 0.3);
        step = Math.min(d, sp * dt);
        f.x += (dx / d) * step;
        f.z += (dz / d) * step;
      }
      const moving = step / dt > 0.35;
      const goalYaw = moving && (d > 3 || routing) ? Math.atan2(dx, dz) : this.facing;
      // fallback: walk backwards keeping the face to the enemy
      const yawGoal = this.order.keepFacing && !routing ? this.facing : goalYaw;
      f.yaw += wrap(yawGoal - f.yaw) * Math.min(1, dt * 5);
      f.phase += (step / s) * 3.1;
      const walk = Math.min(1, (step / dt) / 1.6);
      const aimGoal = this.type === 'infantry' && this.firing && !moving && !routing ? 1 : 0;
      f.aim += (aimGoal - f.aim) * Math.min(1, dt * 4);
      if (f.fireAt >= 0 && time >= f.fireAt) {
        f.flash = 1;
        f.fireAt = -1;
      }
      f.flash = Math.max(0, f.flash - dt * 9);
      const y = T.heightAt(f.x, f.z);
      this.pool.set(f.i, f.x, y, f.z, f.yaw, s, f.phase, walk, f.aim, f.flash);
      const hurt = this.lastHit && time - this.lastHit < 0.5 ? 1 - (time - this.lastHit) / 0.5 : 0;
      this.pool.setTint(f.i, f.coatVar, f.trouserVar, this.selected ? 1 : 0, Math.max(hurt * 0.8, this.underFire > 0 ? 0.12 : 0));
    }
  }

  /**
   * Schedule a ragged volley: front-rank figures fire over ~0.9 s. Returns muzzle positions for smoke:
   * about one puff per 9 m of front, so the line disappears into a bank of powder smoke.
   */
  volley(time) {
    const muzzles = [];
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    let lastLx = -Infinity;
    const shooters = this.figures.filter((f) => f.alive && (f.aim >= 0.5 || this.follow.active)).sort((a, b) => a.lx - b.lx);
    for (const f of shooters) {
      if (f.rank !== 0 && this.rnd() < 0.5) continue;
      f.fireAt = time + this.rnd() * 0.9;
      if (f.rank === 0 && f.lx - lastLx > 9) {
        lastLx = f.lx;
        muzzles.push([f.x + s * 3.5, f.z + c * 3.5, f.fireAt - time]);
      }
    }
    return muzzles;
  }
}

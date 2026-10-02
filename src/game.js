// src/game.js: the battle: units, simulation clock, orders, AI, objective, victory.

import { EntityManager } from 'yuka';
import { Unit } from './units/unit.js';
import { Battery, GunPool } from './units/battery.js';
import { SoldierPool, UNIFORMS } from './units/soldier-mesh.js';
import { Combat, CLOCK_RATIO } from './sim/combat.js';
import { Ai } from './sim/ai.js';
import { mulberry32, inWoods, PLAN } from './world/landscape.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class Game {
  constructor({ scene, terrain, scenario, world, effects, playerSide = 'US' }) {
    this.scene = scene;
    this.terrain = terrain;
    this.scenario = scenario;
    this.effects = effects;
    this.playerSide = playerSide;
    this.rnd = mulberry32(18610721);
    this.paused = false;
    this.speed = 1;
    this.simTime = 0;
    this.selected = null;
    this.listeners = { select: [], log: [] };
    this.over = false;

    const defs = scenario.units;
    const figs = (side) => defs.filter((d) => d.side === side).reduce((s, d) => s + Math.round(d.men / 10) + 4, 0);
    this.pools = {
      US: new SoldierPool(figs('US'), UNIFORMS.US),
      CS: new SoldierPool(figs('CS'), UNIFORMS.CS),
    };
    this.fallen = {
      US: new SoldierPool(figs('US'), UNIFORMS.US),
      CS: new SoldierPool(figs('CS'), UNIFORMS.CS),
    };
    this.gunPool = new GunPool(defs.reduce((s, d) => s + (d.guns || 0), 0) + 1);
    for (const p of [this.pools.US, this.pools.CS, this.fallen.US, this.fallen.CS]) scene.add(p.mesh);
    scene.add(this.gunPool.guns, this.gunPool.limbers);

    this.entities = new EntityManager();
    this.units = defs.map((d, k) => {
      const u = d.type === 'artillery'
        ? new Battery(d, this.pools[d.side], this.gunPool, terrain, 100 + k)
        : new Unit(d, this.pools[d.side], terrain, 100 + k);
      this.entities.add(u.vehicle);
      return u;
    });

    const sites = PLAN.sites;
    const fenceField = world.fenceField;
    this.coverAt = (x, z) => {
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 45)) return { value: 1.58, kind: 'farm buildings' };
      if (inWoods(x, z)) return { value: 1.4, kind: 'woods' };
      if (fenceField && fenceField.dist(x, z) < 14) return { value: 1.25, kind: 'fence line' };
      return { value: 1, kind: 'open' };
    };
    this.combat = new Combat({ units: this.units, terrain, coverAt: this.coverAt, fallen: this.fallen, fx: effects, rnd: this.rnd });
    this.ai = new Ai(this, scenario.ai || {});
    // the defenders begin under orders to hold their ground
    for (const u of this.units) if (u.side !== playerSide) u.order = { type: 'hold', firm: true };
    const [hh, mm] = scenario.start.split(':').map(Number);
    const [eh, em] = scenario.end.split(':').map(Number);
    this.clockStart = hh * 3600 + mm * 60;
    this.clockEnd = eh * 3600 + em * 60;
    this.objective = scenario.objective;
    this.logSeen = 0;
    this.flushAll();
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev]) fn(...a); }

  // ---------------------------------------------------------------------------------------------------
  select(u) {
    if (this.selected) this.selected.selected = false;
    this.selected = u && u.alive ? u : null;
    if (this.selected) this.selected.selected = true;
    this.emit('select', this.selected);
  }

  order(u, { type, points, target }) {
    if (!u || u.side !== this.playerSide) return false;
    if (!u.canTakeOrders()) { this.emit('log', `${u.short} is routing and will not take orders.`); return false; }
    let ok;
    if (type === 'charge') {
      ok = u.orderMove(points, { charge: true });
      if (ok) u.order.target = target;
    } else {
      ok = u.orderMove(points);
    }
    if (ok) this.orders = (this.orders || 0) + 1;
    return ok;
  }

  orderSelected(kind) {
    const u = this.selected;
    if (!u || u.side !== this.playerSide) return false;
    if (!u.canTakeOrders()) { this.emit('log', `${u.short} is routing and will not take orders.`); return false; }
    let ok = false;
    if (kind === 'hold') ok = u.orderHold();
    else if (kind === 'halt') ok = u.orderHalt();
    else if (kind === 'run') ok = u.toggleRun();
    else if (kind === 'fallback') ok = u.orderFallback();
    else if (kind === 'charge') {
      const target = this.chargeTarget(u);
      if (!target) { this.emit('log', `No enemy close enough for ${u.short} to charge.`); return false; }
      ok = u.orderCharge(target);
    }
    if (ok) this.orders = (this.orders || 0) + 1;
    return ok;
  }

  /** Nearest enemy within 320 m, preferring those ahead of the line. */
  chargeTarget(u) {
    let best = null, bestScore = Infinity;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.state === 'routing') continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d > 320) continue;
      const off = Math.abs(wrap(Math.atan2(e.x - u.x, e.z - u.z) - u.facing));
      const score = d * (off < 1.2 ? 1 : 2.2);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  togglePause() { this.paused = !this.paused; return this.paused; }
  setSpeed(s) { this.speed = s; }

  clockText() {
    const t = this.clockStart + this.simTime * CLOCK_RATIO;
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    const [y, mo, d] = this.scenario.date.split('-').map(Number);
    const sfx = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
    return {
      date: `${d}${sfx} ${MONTH[mo - 1]} ${y}`,
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      frac: Math.min(1, (t - this.clockStart) / (this.clockEnd - this.clockStart)),
    };
  }

  // ---------------------------------------------------------------------------------------------------
  /** Advance the simulation by real seconds dt (scaled by speed, in fixed sub-steps). */
  step(dt) {
    if (this.paused) return 0;
    let simDt = Math.min(0.25, dt) * this.speed;
    const out = simDt;
    while (simDt > 1e-6) {
      const h = Math.min(0.05, simDt);
      simDt -= h;
      this.tick(h);
    }
    return out;
  }

  tick(h) {
    this.simTime += h;
    this.entities.update(h);
    for (const u of this.units) {
      if (!u.alive) continue;
      u.move(h, u.side === 'US' ? -this.terrain.half + 40 : this.terrain.half - 40);
    }
    this.combat.step(h, this.simTime);
    this.ai.step(h);
    while (this.logSeen < this.combat.log.length) this.emit('log', this.combat.log[this.logSeen++].text);
    this.checkObjective(h);
  }

  /** Henry House Hill: who holds the plateau? Union wins by holding it at the end, or by breaking the defence. */
  checkObjective(h) {
    this.objT = (this.objT || 0) - h;
    if (this.objT > 0) return;
    this.objT = 1;
    const o = this.objective;
    const strength = { US: 0, CS: 0 };
    for (const u of this.units) {
      if (!u.alive || u.state === 'routing') continue;
      if (Math.hypot(u.x - o.x, u.z - o.z) < o.r) strength[u.side] += u.men;
    }
    this.holder = strength.US > 0 && strength.CS === 0 ? 'US' : strength.CS > 0 && strength.US === 0 ? 'CS' : strength.US || strength.CS ? 'contested' : 'none';
    const effective = (side) => this.units.filter((u) => u.side === side && u.alive && u.state !== 'routing' && u.type === 'infantry').length;
    if (this.over) return;
    const t = this.clockStart + this.simTime * CLOCK_RATIO;
    let result = null;
    if (effective('CS') === 0) result = { winner: 'US', why: 'The Confederate line on Henry House Hill has broken.' };
    else if (effective('US') === 0) result = { winner: 'CS', why: 'Every Union brigade is in retreat.' };
    else if (t >= this.clockEnd) {
      result = this.holder === 'US'
        ? { winner: 'US', why: 'Union troops hold Henry House Hill at nightfall.' }
        : { winner: 'CS', why: 'The Confederates still hold Henry House Hill. (In 1861 they held it, and the Union army fell back to Washington.)' };
    }
    if (result) {
      this.over = true;
      this.result = result;
      this.emit('log', result.why);
    }
  }

  /** Test/fast-forward hook: advance sim seconds without rendering, then stand every man in his slot. */
  fastForward(seconds) {
    const n = Math.ceil(seconds / 0.05);
    for (let i = 0; i < n; i++) this.tick(0.05);
    for (const u of this.units) u.snapFigures();
    this.animate(0.05);
    return this.simTime;
  }

  /** Animate figures with the (speed-scaled) sim delta; upload buffers. */
  animate(simDt) {
    for (const u of this.units) u.animate(simDt, this.simTime);
    this.flushAll();
  }

  flushAll() {
    this.pools.US.flush();
    this.pools.CS.flush();
    this.fallen.US.flush();
    this.fallen.CS.flush();
    this.gunPool.flush();
  }

  figureCount() {
    return this.units.reduce((s, u) => s + u.figures.filter((f) => f.alive).length, 0);
  }
}

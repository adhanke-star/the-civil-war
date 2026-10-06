// src/game.js: the battle: units, simulation clock, orders, AI, objective, victory.
//
// Orders the player gives (DESIGN.md 4b, "Move order" / "Attack order"):
//   move    march to the mark; meeting an enemy in effective range on the way the line halts and fires
//           (rules.moveOrder 'fight') and marches on once that enemy is gone, out of range or routing; on
//           arrival it holds, facing endFacing (by default toward the nearest enemy from the mark)
//   attack  close on a target to effective range with line of sight, halt, fire, and follow it if it moves
//           (attackStep); never charges on its own
//   charge  only from the Charge button or key
// A selection may hold several brigades (box select); a drag order moves them all, keeping their places
// relative to the brigade dragged, turned with it. Brigade initiative (rules.initiative): a unit without
// orders turns to face fire from beyond its arc when nothing is in front of it; it never advances unordered.
// Events: 'select', 'log' (a toast: replies to the player's own actions), 'event' ({ text, time, x, z, side, kind }), 'alert' (an auto-pause:
// { text, x, z }), 'spawn' / 'remove' (a unit added or taken off the field in the sandbox).
// Figures (src/ui/look.js): look.figureStyle picks rigged 3D figures or baked sprites (both, split-screen, while
// it is compared); the atlas loads the first time baked is wanted and the rigged figures draw until it is in.
// look.menPerFigure re-forms the infantry at 1:10 or 1:5; pools are sized for 1:5 from the start.

import { EntityManager } from 'yuka';
import { Unit, MEN_PER_FIGURE_OPTIONS, MEN_PER_CREW_FIGURE, SPEED, setMenPerFigure } from './units/unit.js';
import { Battery, GunPool } from './units/battery.js';
import { SoldierPool, FallenPool, UNIFORMS, FIGURE_VIEW } from './units/soldier-mesh.js';
import { ImpostorPool, loadBakedAtlas } from './units/impostor.js';
import { LOOK } from './ui/look.js';
import { on as onSetting } from './settings.js';
import { compareState } from './sandbox/compare.js';
import { HaloPool } from './units/halos.js';
import { HorsePool, HORSE_COATS } from './units/mounts.js';
import { Combat, CLOCK_RATIO } from './sim/combat.js';
import { Ai } from './sim/ai.js';
import { RULES } from './sim/rules.js';
import { mulberry32, inWoods, PLAN } from './world/landscape.js';
import { FieldCaptures } from './franchise/captures.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MIN_MEN_PER_FIGURE = Math.min(...MEN_PER_FIGURE_OPTIONS); // pools are sized for the densest choice
const SPAWN_RESERVE = 2100; // figures per side kept free for sandbox spawns (four 2,500-man brigades at 1:5)
const ARC = (65 * Math.PI) / 180; // the firing arc each side of the facing (combat.js)

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
    this.selected = null; // the primary selection (the unit card shows it)
    this.selection = []; // every selected unit (box select)
    this.listeners = { select: [], log: [], event: [], alert: [], spawn: [], remove: [] };
    this.over = false;
    this.controlBoth = false; // sandbox: the player may order the other side too (units.controlBothSides)
    this.spawned = { US: 0, CS: 0 };

    const defs = scenario.units;
    // figures per side at the densest look.menPerFigure (5 men; 4 per crew figure in a battery), plus an
    // officer and slack
    setMenPerFigure(LOOK.menPerFigure);
    const figs = (side) => defs.filter((d) => d.side === side).reduce((s, d) => s + Math.round(d.men / (d.type === 'artillery' ? MEN_PER_CREW_FIGURE : MIN_MEN_PER_FIGURE)) + 6, 0);
    const outline = !/\boutline=0\b/.test(globalThis.location ? location.search : '');
    this.reserve = { US: SPAWN_RESERVE, CS: SPAWN_RESERVE };
    const cap = (side) => figs(side) + SPAWN_RESERVE;
    this.pools = {
      US: new SoldierPool(cap('US'), UNIFORMS.US, { kit: 'US', outline }),
      CS: new SoldierPool(cap('CS'), UNIFORMS.CS, { kit: 'CS', outline }),
    };
    this.fallen = {
      US: new FallenPool(cap('US'), UNIFORMS.US, { kit: 'US' }),
      CS: new FallenPool(cap('CS'), UNIFORMS.CS, { kit: 'CS' }),
    };
    this.halos = new HaloPool(cap('US') + cap('CS'));
    // baked sprites (the Confederates are a tinted PLACEHOLDER of the Union bake)
    this.impostors = {
      US: new ImpostorPool(cap('US'), { side: 'US', tint: 0 }),
      CS: new ImpostorPool(cap('CS'), { side: 'CS', tint: 1 }),
    };
    this.baked = { state: 'idle', atlas: null, error: null }; // idle | loading | ready | failed
    scene.add(this.impostors.US.mesh, this.impostors.CS.mesh);
    this.horses = new HorsePool(defs.length + 2);
    const gunsOf = (side) => defs.filter((d) => d.side === side).reduce((s, d) => s + (d.guns || 0), 0);
    this.gunPool = new GunPool({ US: gunsOf('US'), CS: gunsOf('CS') });
    for (const p of [this.pools.US, this.pools.CS, this.fallen.US, this.fallen.CS, this.halos, this.horses]) scene.add(p.mesh);
    scene.add(...this.gunPool.meshes);

    this.entities = new EntityManager();
    this.units = defs.map((d, k) => this.makeUnit(d, 100 + k));

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
    this.fieldCaptures = new FieldCaptures(scenario.crates || []);
    for (const opening of scenario.opening || []) {
      const u = this.units.find((v) => v.id === opening.id && v.side !== playerSide);
      if (u) u.orderMove(opening.points, { endFacing: opening.endFacing });
    }
    this.logSeen = 0;
    this.slowT = 0;
    onSetting('look.menPerFigure', (v) => this.applyMenPerFigure(v));
    onSetting('look.formationSpacing', () => this.applyFormationSpacing());
    this.updateFigureView();
    this.flushAll();
  }

  /** Re-form every infantry brigade at `n` men per figure (look.menPerFigure). */
  applyMenPerFigure(n) {
    setMenPerFigure(n);
    let changed = 0;
    for (const u of this.units) if (u.rebuildFigures()) changed++;
    return changed;
  }

  /** Re-layout existing infantry without rerolling figures, including while paused. */
  applyFormationSpacing() {
    let changed = 0;
    for (const u of this.units) {
      if (u.type !== 'infantry') continue;
      if (u.formation === 'column') u.layoutColumn(); else u.layout();
      u.snapFigures(); // living figures only; the fallen keep their exact positions
      changed++;
    }
    return changed;
  }

  /** Start loading the baked atlas (once); the rigged figures draw until it is ready. */
  ensureBaked() {
    if (this.baked.state !== 'idle') return;
    this.baked.state = 'loading';
    loadBakedAtlas().then((atlas) => {
      this.baked.atlas = atlas;
      this.impostors.US.attach(atlas);
      this.impostors.CS.attach(atlas);
      this.baked.state = 'ready';
    }).catch((err) => {
      this.baked.state = 'failed';
      this.baked.error = err && err.message ? err.message : String(err);
      console.warn('baked figures unavailable; drawing the rigged figures:', this.baked.error);
    });
  }

  /**
   * Which figure styles draw this frame (FIGURE_VIEW): look.figureStyle, or both clipped to their sides of
   * the divider while it is compared; baked only once its atlas is in. Also hides the rigged casualties
   * that the sprites now draw.
   */
  updateFigureView() {
    const V = FIGURE_VIEW;
    const cmp = compareState();
    let a = LOOK.figureStyle, b = null;
    if (cmp && cmp.key === 'look.figureStyle' && cmp.a !== cmp.b) { a = cmp.a; b = cmp.b; }
    const want = a === 'baked' || b === 'baked';
    if (want) this.ensureBaked();
    const ready = want && this.baked.state === 'ready';
    V.split = cmp ? cmp.split : 0.5;
    V.scale = LOOK.figureScale;
    if (b !== null && ready) {
      V.baked = true; V.rigged = true;
      V.clipRigged = a === 'rigged' ? -1 : 1;
      V.clipBaked = -V.clipRigged;
    } else {
      V.baked = ready; V.rigged = !ready;
      V.clipRigged = 0; V.clipBaked = 0;
    }
    const fallenClip = !V.baked ? 0 : V.rigged ? V.clipRigged : 2;
    this.fallen.US.setBakedClip(fallenClip);
    this.fallen.CS.setBakedClip(fallenClip);
  }

  /** One construction path for scenario units and sandbox spawns. */
  makeUnit(d, seed) {
    const u = d.type === 'artillery'
      ? new Battery(d, this.pools[d.side], this.gunPool, this.terrain, seed)
      : new Unit(d, this.pools[d.side], this.terrain, seed);
    u.halos = this.halos;
    u.impostors = this.impostors[d.side];
    u.horses = this.horses;
    u.fallenPool = this.fallen[d.side];
    if (u.officer) u.officer.coat = HORSE_COATS[seed % HORSE_COATS.length];
    this.entities.add(u.vehicle);
    return u;
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev]) fn(...a); }

  /** May the player order this unit? (His own side; the other side too with units.controlBothSides.) */
  controls(u) {
    return !!u && u.alive && (u.side === this.playerSide || this.controlBoth);
  }

  // ---------------------------------------------------------------------------------------------------
  // Selection
  select(u, { add = false } = {}) {
    if (u && !u.alive) u = null;
    if (add && u) {
      if (this.selection.includes(u)) {
        this.selection = this.selection.filter((v) => v !== u);
        u.selected = false;
        this.selected = this.selection[this.selection.length - 1] || null;
      } else if (this.controls(u) && this.selection.every((v) => this.controls(v))) {
        this.selection.push(u);
        u.selected = true;
        this.selected = u;
      } else {
        return this.select(u);
      }
      this.emit('select', this.selected);
      return;
    }
    for (const v of this.selection) v.selected = false;
    this.selection = u ? [u] : [];
    this.selected = u || null;
    if (u) u.selected = true;
    this.emit('select', this.selected);
  }

  /** Box select: only units the player may order; the first becomes the primary. */
  selectMany(list) {
    const mine = list.filter((u) => this.controls(u));
    for (const v of this.selection) v.selected = false;
    this.selection = mine;
    for (const v of mine) v.selected = true;
    this.selected = mine[0] || null;
    this.emit('select', this.selected);
  }

  /** The selected units the player may order now. */
  orderable() {
    return this.selection.filter((u) => this.controls(u) && u.canTakeOrders());
  }

  // ---------------------------------------------------------------------------------------------------
  // Orders
  order(u, { type, points, target, endFacing }) {
    if (!this.controls(u)) return false;
    if (!u.canTakeOrders()) { this.emit('log', `${u.short} is routing and will not take orders.`); return false; }
    let ok;
    if (type === 'attack') {
      ok = u.orderAttack(target, endFacing);
      if (ok) this.attackStep(u);
    } else if (type === 'charge') {
      ok = u.orderMove(points, { charge: true });
      if (ok) u.order.target = target;
    } else {
      const end = points[points.length - 1];
      const face = Number.isFinite(endFacing) ? endFacing : this.ghostFacing(end[0], end[1], u.side, undefined);
      ok = u.orderMove(points, { endFacing: face });
    }
    if (ok) {
      this.orders = (this.orders || 0) + 1;
      if (u.side !== this.playerSide) u.manual = true;
    }
    return ok;
  }

  /**
   * A drag order from `leader`: if it is part of a multiple selection, every selected brigade takes it,
   * keeping its place relative to the leader (turned with the leader's change of facing).
   */
  orderGroup(leader, spec) {
    const group = this.selection.includes(leader) ? this.orderable() : [leader];
    if (group.length <= 1) return this.order(leader, spec);
    let ok = false;
    if (spec.type !== 'move') {
      for (const u of group) ok = this.order(u, spec) || ok;
      return ok;
    }
    const end = spec.points[spec.points.length - 1];
    const face = Number.isFinite(spec.endFacing) ? spec.endFacing : this.ghostFacing(end[0], end[1], leader.side, leader.facing);
    for (const u of group) {
      if (u === leader) { ok = this.order(u, { ...spec, endFacing: face }) || ok; continue; }
      const [dx, dz] = this.groupOffset(leader, u, face);
      ok = this.order(u, { type: 'move', points: [[u.x, u.z], [end[0] + dx, end[1] + dz]], endFacing: face }) || ok;
    }
    return ok;
  }

  /** Where `u` stands relative to `leader` once the leader faces `face` (offset turned with the leader). */
  groupOffset(leader, u, face) {
    const rot = wrap(face - leader.facing);
    const c = Math.cos(rot), s = Math.sin(rot);
    const ox = u.x - leader.x, oz = u.z - leader.z;
    return [ox * c + oz * s, oz * c - ox * s];
  }

  orderSelected(kind) {
    const group = this.orderable();
    if (!group.length) {
      const u = this.selected;
      if (u && this.controls(u) && !u.canTakeOrders()) this.emit('log', `${u.short} is routing and will not take orders.`);
      return false;
    }
    let ok = false;
    if (kind === 'holdfire') {
      const on = !group[0].holdFire;
      for (const u of group) u.holdFire = on;
      this.emit('log', group.length === 1 ? `${group[0].short}: ${on ? 'hold your fire' : 'fire at will'}.` : `${group.length} brigades: ${on ? 'hold your fire' : 'fire at will'}.`);
      ok = true;
    }
    for (const u of group) {
      if (kind === 'hold') ok = u.orderHold() || ok;
      else if (kind === 'halt') ok = u.orderHalt() || ok;
      else if (kind === 'run') ok = u.toggleRun() || ok;
      else if (kind === 'fallback') ok = u.orderFallback() || ok;
      else if (kind === 'charge') {
        const target = u.order.type === 'attack' && u.order.target && u.order.target.alive ? u.order.target : this.chargeTarget(u);
        if (!target) { this.emit('log', `No enemy close enough for ${u.short} to charge.`); continue; }
        ok = u.orderCharge(target) || ok;
      }
      if (ok && u.side !== this.playerSide) u.manual = true;
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

  /** Facing from (x, z) toward the nearest enemy of `side` that is not routing (the ghost's default). */
  ghostFacing(x, z, side, fallback) {
    let best = null, bd = Infinity;
    for (const e of this.units) {
      if (e.side === side || !e.alive || e.state === 'routing') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bd) { bd = d; best = e; }
    }
    if (best && bd > 1) return Math.atan2(best.x - x, best.z - z);
    return fallback;
  }

  range(u) { return this.combat.range(u); }
  effRange(u) { return this.combat.effRange(u); }

  /** Where an attack on `target` will halt (the ghost shows it): effective range, on the line between. */
  attackHalt(u, target) {
    const d = Math.max(1, Math.hypot(u.x - target.x, u.z - target.z));
    const eff = this.effRange(u);
    if (d <= eff) return { x: u.x, z: u.z, facing: Math.atan2(target.x - u.x, target.z - u.z) };
    const x = target.x + ((u.x - target.x) / d) * eff, z = target.z + ((u.z - target.z) / d) * eff;
    return { x, z, facing: Math.atan2(target.x - x, target.z - z) };
  }

  /** March time in historical minutes for `len` metres at the walking pace (the ghost's label). */
  marchMinutes(len) {
    return (len / (SPEED.walk * RULES.marchSpeed)) * (this.scenario.practiceIntro ? 1 : CLOCK_RATIO) / 60;
  }

  /** Attack order: close to effective range with line of sight, halt and fire; follow a target that moves. */
  attackStep(u) {
    const o = u.order;
    const t = o.target;
    if (!t || !t.alive || t.state === 'routing' || !this.units.includes(t)) {
      u.stop();
      u.order = { type: 'hold' };
      this.emit('log', `${u.short}: the enemy has gone; holding here.`);
      return;
    }
    const eff = this.effRange(u), rng = this.range(u);
    const d = Math.hypot(t.x - u.x, t.z - u.z);
    const bearing = Math.atan2(t.x - u.x, t.z - u.z);
    o.endFacing = bearing;
    const los = this.combat.los(u, t);
    if (los && d <= eff + 6) {
      if (u.follow.active) { u.stop(); o.goal = null; }
      u.goalFacing = bearing;
      return;
    }
    if (!u.follow.active && los && d <= eff + 30) { u.goalFacing = bearing; return; } // a target drifting a little is not chased
    const want = los ? eff : Math.max(rng * 0.5, Math.min(eff, d - 50));
    const gx = t.x + ((u.x - t.x) / d) * want, gz = t.z + ((u.z - t.z) / d) * want;
    if (Math.hypot(gx - u.x, gz - u.z) < 8) { u.goalFacing = bearing; return; }
    if (!u.follow.active || !o.goal || Math.hypot(gx - o.goal[0], gz - o.goal[1]) > 20) {
      u.setPath([[u.x, u.z], [gx, gz]]);
      o.goal = [gx, gz];
    }
  }

  /** Brigade initiative: a unit without orders turns toward fire from beyond its arc when nothing is ahead. */
  initiativeStep(u) {
    if (!RULES.initiative || u.follow.active || u.engaged || u.order.type !== 'hold' || u.target || u.melee || u.state === 'routing') return;
    const s = u.lastShooter;
    if (!s || !s.alive || this.simTime - u.lastShotT > 4) return;
    const want = Math.atan2(s.x - u.x, s.z - u.z);
    if (Math.abs(wrap(want - u.facing)) > ARC) u.goalFacing = want;
  }

  togglePause() { this.paused = !this.paused; return this.paused; }
  setSpeed(s) { this.speed = s; }

  clockText() {
    if (this.scenario.practiceIntro) return { date: 'Practice',
      time: `${String(Math.floor(this.simTime / 60)).padStart(2, '0')}:${String(Math.floor(this.simTime % 60)).padStart(2, '0')}`,
      frac: Math.min(1, this.simTime / 45) };
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
  /** Advance the simulation by real seconds dt (scaled by speed and rules.battleSpeed, in fixed sub-steps). */
  step(dt) {
    if (this.paused) return 0;
    let simDt = Math.min(0.25, dt) * this.speed * RULES.battleSpeed;
    let out = 0;
    while (simDt > 1e-6 && !this.paused) {
      const h = Math.min(0.05, simDt);
      simDt -= h;
      out += h;
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
    this.slowT -= h;
    if (this.slowT <= 0) {
      this.slowT = 0.5;
      for (const u of this.units) {
        if (!u.alive || !this.controls(u)) continue;
        if (u.order.type === 'attack') this.attackStep(u);
        else this.initiativeStep(u);
      }
    }
    while (this.logSeen < this.combat.log.length) {
      const e = this.combat.log[this.logSeen++];
      this.event(e.text, e.unit, e.kind); // the feed shows it (or a toast with look.eventFeed off, main.js)
      if (e.kind === 'rout' && !e.forced && e.unit && e.unit.side === this.playerSide) this.alert(`${e.unit.short} is routing.`, e.unit.x, e.unit.z);
    }
    if (!this.over) for (const e of this.fieldCaptures.step(this.units, h)) {
      this.event(`${e.side === this.playerSide ? 'Your troops' : 'The enemy'} ${e.previous ? 'retake' : 'capture'} ${e.name}.`,
        null, 'capture', e);
    }
    this.checkObjective(h);
  }

  /** A line for the event feed (clock time, sentence, where). */
  event(text, unit, kind = 'info', at) {
    const p = at || (unit ? { x: unit.x, z: unit.z } : null);
    this.emit('event', { text, time: this.clockText().time, x: p ? p.x : null, z: p ? p.z : null, side: unit ? unit.side : at?.side || null, kind, unit: unit || null });
  }

  /** Auto-pause (rules.autoPause): pause and tell the HUD why (it shows a banner with "Fly there"). */
  alert(text, x, z) {
    if (!RULES.autoPause || this.paused) return;
    this.paused = true;
    this.emit('alert', { text, x, z });
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
    const prev = this.holder;
    this.holder = strength.US > 0 && strength.CS === 0 ? 'US' : strength.CS > 0 && strength.US === 0 ? 'CS' : strength.US || strength.CS ? 'contested' : 'none';
    if (prev && prev !== this.holder) {
      const ps = this.playerSide;
      if (this.holder === ps) this.event(`Your troops hold ${o.name}.`, null, 'objective', o);
      else if (prev === ps && this.holder !== 'none') {
        const text = `The enemy is on ${o.name}.`;
        this.event(text, null, 'objective', o);
        this.alert(text, o.x, o.z);
      }
    }
    const effective = (side) => this.units.filter((u) => u.side === side && u.alive && u.state !== 'routing' && u.type === 'infantry').length;
    if (this.over) return;
    const t = this.clockStart + this.simTime * CLOCK_RATIO;
    let result = null;
    if (this.scenario.practiceIntro) {
      if (effective('US') === 0 || this.holder !== 'US') result = { winner: 'CS' };
      else if (effective('CS') === 0 || t >= this.clockEnd) result = { winner: 'US' };
    }
    else if (effective('CS') === 0) result = { winner: 'US', why: 'The Confederate line on Henry House Hill has broken.' };
    else if (effective('US') === 0) result = { winner: 'CS', why: 'Every Union brigade is in retreat.' };
    else if (t >= this.clockEnd) {
      result = this.holder === 'US'
        ? { winner: 'US', why: 'Union troops hold Henry House Hill at nightfall.' }
        : { winner: 'CS', why: 'The Confederates still hold Henry House Hill. (In 1861 they held it, and the Union army fell back to Washington.)' };
    }
    if (result && this.scenario.practiceIntro) result.why = result.winner === 'US'
      ? 'Your brigades held the practice stores. The quartermaster is ready with your first issue.'
      : 'Your brigades lost the practice ground. Survivors and any stores still held return for the issue.';
    if (result) {
      this.over = true;
      this.result = result;
      this.event(result.why, null, 'result', o);
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Sandbox: place and remove brigades
  /**
   * A generic infantry brigade (never a real commander or regiment): "Union brigade 3". Same construction
   * path as the scenario's units. Returns the unit, or null when the side's figure reserve is used up.
   */
  spawnUnit({ side, men = 1000, weapon = 'smooth', xp = 1, x, z, facing }) {
    if (!Number.isInteger(xp) || xp < 1 || xp > 4) {
      this.emit('log', 'Choose Green, Trained, Veteran or Elite before placing a brigade.');
      return null;
    }
    const nFig = Math.round(men / MIN_MEN_PER_FIGURE) + 6; // counted at 1:5, so look.menPerFigure never overfills the pools
    if (this.reserve[side] < nFig) {
      this.emit('log', `No room for another ${side === 'US' ? 'Union' : 'Confederate'} brigade of ${men} (the figure reserve is used up); remove one first.`);
      return null;
    }
    this.reserve[side] -= nFig;
    const n = ++this.spawned[side];
    const name = `${side === 'US' ? 'Union' : 'Confederate'} brigade ${n}`;
    const face = Number.isFinite(facing) ? facing : this.ghostFacing(x, z, side, side === 'US' ? Math.PI / 2 : -Math.PI / 2);
    const def = {
      id: `sandbox-${side.toLowerCase()}-${n}`, side, type: 'infantry', name, short: name, commander: null, parent: 'Sandbox',
      regiments: [], men, weapon, xp, x, z, facing: face, sources: [], notes: 'Placed in the sandbox; not a historical unit.',
    };
    const u = this.makeUnit(def, 500 + n * 13 + (side === 'CS' ? 7 : 0));
    u.reserveFigs = nFig;
    u.order = side === this.playerSide ? { type: 'hold' } : { type: 'hold', firm: true };
    this.units.push(u);
    this.emit('spawn', u);
    this.emit('log', `${name} placed: ${men} men with ${weapon === 'rifled' ? 'rifled' : 'smoothbore'} muskets.`);
    return u;
  }

  removeUnit(u) {
    const i = this.units.indexOf(u);
    if (i < 0) return false;
    this.units.splice(i, 1);
    this.entities.remove(u.vehicle);
    this.reserve[u.side] += u.reserveFigs || 0;
    if (u.gunSlots) for (const g of u.gunSlots) { this.gunPool.hide(this.gunPool.guns[u.side], g.gun); this.gunPool.hide(this.gunPool.limbers, g.limber); }
    if (u.officer && u.officer.horse >= 0) this.horses.set(u.officer.horse, 0, -500, 0, 0, 0.001);
    u.men = 0; // no longer alive: targets, attack orders and charges drop it
    u.removed = true;
    for (const v of this.units) {
      if (v.target === u) v.target = null;
      if (v.lastShooter === u) v.lastShooter = null;
    }
    if (this.selection.includes(u)) {
      u.selected = false;
      this.selection = this.selection.filter((v) => v !== u);
      this.selected = this.selection[0] || null;
      this.emit('select', this.selected);
    }
    this.emit('remove', u);
    return true;
  }

  /** Test/fast-forward hook: advance sim seconds without rendering, then stand every man in his slot. */
  fastForward(seconds) {
    const n = Math.ceil(seconds / 0.05);
    for (let i = 0; i < n; i++) this.tick(0.05);
    for (const u of this.units) u.snapFigures();
    this.animate(0.05);
    return this.simTime;
  }

  /** Level of detail and outline width follow the camera (call before animate). */
  setView(camera, renderHeightPx) {
    this.pools.US.setView(camera, renderHeightPx);
    this.pools.CS.setView(camera, renderHeightPx);
    this.impostors.US.setView(camera);
    this.impostors.CS.setView(camera);
  }

  /** Animate figures with the (speed-scaled) sim delta; refill and upload the instance buffers. */
  animate(simDt) {
    this.updateFigureView();
    this.pools.US.begin();
    this.pools.CS.begin();
    this.impostors.US.begin();
    this.impostors.CS.begin();
    this.halos.begin();
    for (const u of this.units) u.animate(simDt, this.simTime);
    this.flushAll();
  }

  flushAll() {
    this.pools.US.flush();
    this.pools.CS.flush();
    this.impostors.US.flush();
    this.impostors.CS.flush();
    this.fallen.US.flush();
    this.fallen.CS.flush();
    this.halos.flush();
    this.horses.flush();
    this.gunPool.flush();
  }

  /** Figure triangles submitted this frame (both sides, all levels of detail, with outlines). */
  figureTriangles() {
    return this.pools.US.trianglesDrawn() + this.pools.CS.trianglesDrawn();
  }

  figureCount() {
    return this.units.reduce((s, u) => s + u.figures.filter((f) => f.alive).length, 0);
  }

  /** Figures drawn this frame: rigged instances (crews and officers included) and standing baked sprites. */
  figuresDrawn() {
    const rigged = this.pools.US.pushed + this.pools.CS.pushed;
    const baked = this.impostors.US.standing + this.impostors.CS.standing;
    return { rigged, baked, sprites: this.impostors.US.drawn + this.impostors.CS.drawn, calls: this.impostors.US.drawCalls() + this.impostors.CS.drawCalls() };
  }
}

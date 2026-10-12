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
// (look.menPerFigure: 10 or 5, live, but never denser than the phase's scenario.menPerFigure; setMenPerFigure +
// rebuildFigures) and 4 for a battery crew, so each gun
// has a crew of 4-5 figures.
//
// Drawing (FIGURE_VIEW in soldier-mesh.js, written by the game each frame): infantrymen go to the rigged
// SoldierPool, to the baked ImpostorPool (src/units/impostor.js), or to both with a clip side while
// look.figureStyle is compared split-screen. Officers, drivers and gun crews always stay rigged.
//
// Directions: yaw/facing f means forward = (sin f, cos f) in (x, z); lateral = (cos f, -sin f).
//
// Regiments (DESIGN.md §4b): an infantry brigade with 2-8 named regiments (def.regiments; optional def.regimentMen
// weights) stands as that many contiguous blocks, files split by men in proportion (equal without regimentMen), with
// REGIMENT_GAP metres of extra space between neighbouring blocks (a column: the blocks in sequence, the same gap
// between them). look.regimentGaps off restores the gapless layout exactly. Each block (one named regiment too) has
// a colour party: the two front-rank men nearest its centre carry the side's national colour and a plain regimental
// colour (soldier-mesh.js FlagPool). Hover names the regiment (regimentAt); regiments are never orderable.
//
// Command (game.js commandStep): a brigade commander can be hit (commandDown = { kind: 'wounded'|'killed', at });
// a wounded officer rides to the rear and leaves the field, a killed one falls beside his standing horse.
//
// Feat statistics (src/sim/combat.js featsOf; DESIGN.md §3 Badges): move() adds the metres marched under orders.
//
// Orders (set by game.js): move (march to the mark; may halt on the way to fight, see pauseMarch), attack
// (close on a target to effective range and fire; the game steers it), charge, fallback, hold. holdFire is a
// standing flag on the unit, not an order: it survives new orders until toggled off.
//
// Cavalry (DESIGN.md §2 "Cavalry", type 'cavalry', weapon 'carbine' or 'pistol'; game values in combat.js CAVALRY, not sourced):
// mounted, a regiment of horsemen moves CAVALRY.speed times the infantry pace (CAVALRY.woods of that in woods), in a
// two-rank line, or a column of fours on a long march with no enemy near (the infantry column rule). Each figure is a
// rider on an instanced horse (the officers' horse, mounts.js MountPool). toggleMount() dismounts (CAVALRY.dismountS)
// or remounts (CAVALRY.remountS): the regiment halts, does not fire and has no cover until it is done (combat.js). On
// foot every fourth figure is a horse-holder: mounted CAVALRY.holdersBack behind the line with three led horses, out
// of the firing line and spared while any trooper stands in it; the rest form a single-rank skirmish line drawn and
// animated like infantry. The fire, charge, pursuit and screening rules are in combat.js, the AI's in ai.js.

import { Vehicle, FollowPathBehavior, Path, Vector3 as YV } from 'yuka';
import { FIGURE_SCALE, FIGURE_VIEW } from './soldier-mesh.js';
import { framePos } from './figure.js';
import { BAKE_CLIP } from './impostor.js';
import { mulberry32 } from '../world/landscape.js';
import { RULES } from '../sim/rules.js';
import { CAVALRY, SCREENED, defaultWeapon, featsOf } from '../sim/combat.js';
import { LOOK } from '../ui/look.js';
import { equipmentProfile } from '../sim/equipment.js';
import { define, on as onSetting } from '../settings.js';

// look.regimentGaps: registered here (the formation owns it); mirrored for the layout's hot path.
export const REGIMENT_GAP = 4; // m of extra space between neighbouring regiment blocks (scaled by formation spacing)
export const REGIMENT_MAX = 8;
let regimentGaps = define('look.regimentGaps', {
  tab: 'Look', type: 'toggle', default: true, label: 'Regiment gaps',
  note: 'Shows each named regiment of a brigade as its own block with a small gap (about 4 m) between blocks; off closes the gaps (the brigade\'s front is that much narrower). Picking, combat contact and order ghosts use the line as drawn.',
});
onSetting('look.regimentGaps', (v) => { regimentGaps = v; });
export const regimentGapsOn = () => regimentGaps;

/** Split n figures among weights by largest remainder; every regiment gets one when n allows. */
export function apportion(n, weights) {
  const W = weights.reduce((a, b) => a + b, 0);
  const quota = weights.map((w) => (n * w) / W);
  const counts = quota.map(Math.floor);
  let left = n - counts.reduce((a, b) => a + b, 0);
  const order = quota.map((q, i) => [q - Math.floor(q), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k][1]]++;
  if (n >= weights.length) {
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > 0) continue;
      let j = 0;
      for (let m = 1; m < counts.length; m++) if (counts[m] > counts[j]) j = m;
      counts[j]--; counts[i]++;
    }
  }
  return counts;
}

export let MEN_PER_FIGURE = 10; // live binding: max(look.menPerFigure, the phase minimum) (the game calls setMenPerFigure)
export const MEN_PER_FIGURE_OPTIONS = [10, 5];
export const MEN_PER_CREW_FIGURE = 4;
let lookMenPerFigure = MEN_PER_FIGURE, phaseMinimum = 5; // phaseMinimum: scenario.menPerFigure (5..40, sim/phase.js)
/**
 * Infantry density for figures made from now on (existing units: rebuildFigures): the look choice `n`, never
 * denser than the phase's `minimum` men per figure (omitted: keep the last one). Battery crews stay at 4.
 */
export function setMenPerFigure(n, minimum = phaseMinimum) {
  if (MEN_PER_FIGURE_OPTIONS.includes(n)) lookMenPerFigure = n;
  if (Number.isInteger(minimum) && minimum >= 5 && minimum <= 40) phaseMinimum = minimum;
  MEN_PER_FIGURE = Math.max(lookMenPerFigure, phaseMinimum);
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
const OFFICER_LEAVE_S = 25; // s a wounded commander takes riding to the rear before he leaves the field

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
    // Refuse explicit/inherited invalid gear before assigning fields, Vehicle or figure allocation.
    if ('equipment' in def) {
      if (!Object.prototype.hasOwnProperty.call(def, 'equipment')) throw new Error('Equipment: inherited equipment is unsupported.');
      if ('type' in def && (!Object.prototype.hasOwnProperty.call(def, 'type') || !['infantry', 'artillery'].includes(def.type))) {
        throw new Error('Equipment: unsupported supplied unit type.');
      }
      const profile = equipmentProfile(def.equipment, Object.prototype.hasOwnProperty.call(def, 'type') ? def.type : 'infantry');
      Object.defineProperties(this, {
        equipment: { value: profile.item, enumerable: true },
        equipmentProfile: { value: profile, enumerable: true },
      });
    }
    Object.assign(this, {
      id: def.id,
      side: def.side,
      type: def.type || 'infantry',
      name: def.name,
      short: def.short || def.name,
      commander: def.commander || null,
      parent: def.parent || '',
      regiments: def.regiments || [],
      weapon: def.weapon || defaultWeapon(def.type),
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
    this.masked = false; // every enemy it could fire on is behind a friendly brigade (combat.js masks)
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
    if (this.type === 'cavalry') {
      this.mounted = true;
      this.switching = null; // { to: 'mounted'|'dismounted', t, dur } while dismounting or remounting
      this.mounts = null; // set by the game (MountPool)
    }

    this.vehicle = new Vehicle();
    this.vehicle.position.set(def.x, 0, def.z);
    this.vehicle.maxSpeed = SPEED.walk;
    this.vehicle.maxForce = 9;
    this.vehicle.mass = 1;
    this.vehicle.updateOrientation = false;
    this.follow = new FollowPathBehavior(new Path(), 18);
    this.follow.active = false;
    this.vehicle.steering.add(this.follow);

    // regiments: blocks for an infantry brigade with 1..REGIMENT_MAX named regiments (one block: no gap, colours only)
    const nReg = this.type === 'infantry' && Array.isArray(this.regiments) ? this.regiments.length : 0;
    if (nReg >= 1 && nReg <= REGIMENT_MAX) {
      const men = def.regimentMen;
      this.regCount = nReg;
      this.regWeights = Array.isArray(men) && men.length === nReg && men.every((m) => Number.isFinite(m) && m > 0) ? men.slice() : this.regiments.map(() => 1);
      this.bearers = [];
    }
    // figures
    this.menPerFigure = this.type === 'artillery' ? MEN_PER_CREW_FIGURE : MEN_PER_FIGURE;
    this.figures = this.makeFigures(Math.max(1, Math.round(this.men / this.menPerFigure)), def.x, def.z, def.facing);
    // the brigade commander rides behind the centre of the line (only infantry and cavalry with a sourced commander)
    this.officer = (this.type === 'infantry' || this.type === 'cavalry') && this.commander && this.commander.name
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
    if (this.type === 'cavalry') for (const f of figures) f.holder = f.i % CAVALRY.holderEvery === CAVALRY.holderEvery - 1;
    if (this.regCount) {
      // contiguous runs of figures per regiment, in proportion to its men (no random draws)
      const counts = apportion(n, this.regWeights);
      let i = 0;
      for (let r = 0; r < counts.length; r++) for (let c = 0; c < counts[r]; c++) figures[i++].reg = r;
    }
    return figures;
  }

  /**
   * Re-form an infantry brigade at the current MEN_PER_FIGURE (look.menPerFigure): new standing figures for
   * the men left, in their formation slots; men still falling finish their fall. Batteries keep their crews.
   */
  rebuildFigures() {
    if (this.type === 'artillery' || this.menPerFigure === MEN_PER_FIGURE) return false;
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
  get spacing() { return this.type === 'infantry' ? LOOK.formationSpacing : 1; }
  /** On foot or getting there: a dismounted regiment, or one dismounting or remounting (cavalry only). */
  get afoot() { return this.type === 'cavalry' && (!this.mounted || !!this.switching); }

  /** Assign line slots (two dense ranks plus the skirmish screen) to living figures, keeping neighbours. */
  layout() {
    if (this.type === 'cavalry') { this.layoutCavalry(); return; }
    if (this.regCount > 1 && regimentGaps) { this.layoutBlocks(); this.pickBearers(); return; }
    const spacing = this.spacing;
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
      f.lx = (file - (files - 1) / 2) * FILE_SPACING * spacing;
      f.lz = ((ranks - 1) / 2 - rank) * RANK_SPACING * spacing;
      f.rank = rank;
    }
    screen.sort((a, b) => a.lx - b.lx);
    for (let k = 0; k < screen.length; k++) {
      const f = screen[k];
      f.lx = (k - (screen.length - 1) / 2) * SKIRMISH_SPACING * spacing;
      f.lz = (SKIRMISH_AHEAD + (k % 2) * 4) * spacing;
      f.rank = -1;
    }
    this.halfFront = Math.max(4, ((files - 1) / 2) * FILE_SPACING * spacing);
    this.depth = (ranks * RANK_SPACING + (screen.length ? SKIRMISH_AHEAD * 0.5 : 0)) * spacing;
    this.files = files;
    if (this.blockGaps) this.blockGaps = 0;
    if (this.regCount) this.pickBearers();
  }

  /**
   * Cavalry slots. Mounted: two ranks of horses. On foot: one skirmish rank of troopers with the horse-holders in a row
   * CAVALRY.holdersBack behind it; remounting, the troopers walk back to the horses.
   */
  layoutCavalry() {
    const live = this.figures.filter((f) => f.alive);
    if (!this.afoot) {
      const ranks = live.length > 8 ? 2 : 1, files = Math.ceil(live.length / ranks);
      live.sort((a, b) => a.lx - b.lx || a.rank - b.rank);
      for (let k = 0; k < live.length; k++) {
        const f = live[k], file = Math.floor(k / ranks), rank = k % ranks;
        f.lx = (file - (files - 1) / 2) * CAVALRY.fileSpacing;
        f.lz = ((ranks - 1) / 2 - rank) * CAVALRY.rankSpacing;
        f.rank = rank;
      }
      this.halfFront = Math.max(4, ((files - 1) / 2) * CAVALRY.fileSpacing);
      this.depth = ranks * CAVALRY.rankSpacing;
      this.files = files;
      return;
    }
    const holders = live.filter((f) => f.holder), line = holders.length < live.length ? live.filter((f) => !f.holder) : [];
    const back = -CAVALRY.holdersBack;
    holders.sort((a, b) => a.lx - b.lx);
    for (let k = 0; k < holders.length; k++) {
      const f = holders[k];
      f.lx = (k - (holders.length - 1) / 2) * CAVALRY.holderSpacing; f.lz = back; f.rank = 1;
    }
    line.sort((a, b) => a.lx - b.lx);
    const remount = this.switching?.to === 'mounted';
    for (let k = 0; k < line.length; k++) {
      const f = line[k];
      if (remount && holders.length) { // to the horses: beside the holder of their four
        const h = holders[Math.min(holders.length - 1, Math.floor((k * holders.length) / line.length))];
        f.lx = h.lx + ((k % CAVALRY.ledHorses) - 1) * CAVALRY.fileSpacing; f.lz = back + 6;
      } else { f.lx = (k - (line.length - 1) / 2) * CAVALRY.skirmishSpacing; f.lz = 0; }
      f.rank = 0;
    }
    this.halfFront = Math.max(4, ((Math.max(1, line.length) - 1) / 2) * CAVALRY.skirmishSpacing);
    this.depth = CAVALRY.holdersBack + 6;
    this.files = line.length;
  }

  /** The line as regiment blocks side by side (regiment order, left to right), REGIMENT_GAP between blocks. */
  layoutBlocks() {
    const spacing = this.spacing;
    const live = this.figures.filter((f) => f.alive);
    const screen = this.formation === 'line' ? live.filter((f) => f.skirmisher) : [];
    const body = screen.length ? live.filter((f) => !f.skirmisher) : live;
    const ranks = body.length > 14 ? RANKS : 1;
    const groups = Array.from({ length: this.regCount }, () => []);
    for (const f of body) groups[f.reg].push(f);
    const filled = groups.filter((g) => g.length);
    const files = filled.reduce((n, g) => n + Math.ceil(g.length / ranks), 0);
    const gaps = Math.max(0, filled.length - 1);
    const width = (files - 1) * FILE_SPACING + gaps * REGIMENT_GAP; // centre of the first file to the last, unscaled
    let x0 = -width / 2;
    for (const g of filled) {
      g.sort((a, b) => a.lx - b.lx || a.rank - b.rank);
      for (let k = 0; k < g.length; k++) {
        const f = g[k], file = Math.floor(k / ranks), rank = k % ranks;
        f.lx = (x0 + file * FILE_SPACING) * spacing;
        f.lz = ((ranks - 1) / 2 - rank) * RANK_SPACING * spacing;
        f.rank = rank;
      }
      x0 += Math.ceil(g.length / ranks) * FILE_SPACING + REGIMENT_GAP;
    }
    screen.sort((a, b) => a.lx - b.lx);
    for (let k = 0; k < screen.length; k++) {
      const f = screen[k];
      f.lx = (k - (screen.length - 1) / 2) * SKIRMISH_SPACING * spacing;
      f.lz = (SKIRMISH_AHEAD + (k % 2) * 4) * spacing;
      f.rank = -1;
    }
    this.halfFront = Math.max(4, (width / 2) * spacing);
    this.depth = (ranks * RANK_SPACING + (screen.length ? SKIRMISH_AHEAD * 0.5 : 0)) * spacing;
    this.files = files;
    this.blockGaps = gaps;
  }

  /**
   * Each regiment's colour party: the two men nearest the centre of its front (line: rank 0, column: its first rank);
   * bearers[r] = [national, regimental] (either may be null for a block of one man or none).
   */
  pickBearers() {
    const column = this.formation === 'column';
    const out = this.bearers;
    out.length = this.regCount;
    for (let r = 0; r < this.regCount; r++) {
      let lo = Infinity, hi = -Infinity, first = Infinity;
      for (const f of this.figures) {
        if (!f.alive || f.reg !== r || f.skirmisher && !column) continue;
        if (column) { if (f.crank < first) first = f.crank; } else if (f.rank === 0) { if (f.lx < lo) lo = f.lx; if (f.lx > hi) hi = f.lx; }
      }
      const mid = (lo + hi) / 2;
      let a = null, b = null, da = Infinity, db = Infinity;
      for (const f of this.figures) {
        if (!f.alive || f.reg !== r || f.skirmisher && !column) continue;
        if (column ? f.crank !== first : f.rank !== 0) continue;
        const d = column ? Math.abs(f.cfile) + f.i * 1e-9 : Math.abs(f.lx - mid);
        if (d < da) { b = a; db = da; a = f; da = d; } else if (d < db) { b = f; db = d; }
      }
      out[r] = a ? [a, b] : null;
    }
  }

  /** The regiment (index) of the living man nearest (x, z) within `reach` metres, or -1. */
  regimentAt(x, z, reach = 9) {
    if (!this.regCount) return -1;
    let best = -1, bd = reach * reach;
    for (const f of this.figures) {
      if (!f.alive) continue;
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d < bd) { bd = d; best = f.reg; }
    }
    return best;
  }

  /** About how many of the brigade's men stand in regiment r now (its share of the living figures). */
  regimentMen(r) {
    if (!this.regCount || !this.alive) return 0;
    let n = 0, all = 0;
    for (const f of this.figures) if (f.alive) { all++; if (f.reg === r) n++; }
    return all ? Math.round((this.men * n) / all) : 0;
  }

  /** Half the width of the brigade's front once it stands in line (also while it marches in column). */
  lineHalfFront() {
    if (this.formation !== 'column' || !this.files) return this.halfFront;
    if (this.type === 'cavalry') return Math.max(4, ((this.files - 1) / 2) * CAVALRY.fileSpacing);
    if (this.blockGaps) return Math.max(4, (((this.files - 1) * FILE_SPACING + this.blockGaps * REGIMENT_GAP) / 2) * this.spacing);
    return Math.max(4, ((this.files - 1) / 2) * FILE_SPACING * this.spacing);
  }

  /** Column of fours along the trail: slot k = rank k/4 at COLUMN_RANK_SPACING back along the trail. */
  layoutColumn() {
    if (this.regCount > 1 && regimentGaps) { this.layoutColumnBlocks(); this.pickBearers(); return; }
    const cav = this.type === 'cavalry';
    const rankSpacing = (cav ? CAVALRY.rankSpacing : COLUMN_RANK_SPACING) * this.spacing;
    const live = this.figures.filter((f) => f.alive).sort((a, b) => a.order - b.order);
    const ranks = Math.ceil(live.length / COLUMN_FILES);
    // resample the trail from the head backwards at COLUMN_RANK_SPACING
    const slots = this.columnSlots;
    slots.length = 0;
    const T = this.trail;
    let hx = this.x, hz = this.z;
    let k = T.length - 1;
    let need = rankSpacing * 0.5;
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
        need = rankSpacing;
      } else {
        need -= seg;
        px = cx; pz = cz;
        k--;
      }
    }
    while (slots.length < ranks) {
      const last = slots[slots.length - 1] || [hx, hz, this.facing];
      slots.push([last[0] - Math.sin(last[2]) * rankSpacing, last[1] - Math.cos(last[2]) * rankSpacing, last[2]]);
    }
    for (let i = 0; i < live.length; i++) {
      const f = live[i];
      f.crank = Math.floor(i / COLUMN_FILES);
      f.cfile = (i % COLUMN_FILES) - (COLUMN_FILES - 1) / 2;
      f.rank = f.crank === 0 ? 0 : 1;
    }
    this.halfFront = COLUMN_FILES * (cav ? CAVALRY.fileSpacing : COLUMN_FILE_SPACING) * this.spacing * 0.5 + 6;
    this.depth = Math.max(10, ranks * rankSpacing);
    if (this.regCount) this.pickBearers();
  }

  /** The column as regiment blocks in sequence: each block starts a new rank, REGIMENT_GAP behind the last. */
  layoutColumnBlocks() {
    const rankSpacing = COLUMN_RANK_SPACING * this.spacing, gap = REGIMENT_GAP * this.spacing;
    const live = this.figures.filter((f) => f.alive).sort((a, b) => a.reg - b.reg || a.order - b.order);
    // distance of each rank's slot behind the head, along the trail
    const dist = [];
    let at = rankSpacing * 0.5;
    for (let i = 0, k = 0; i < live.length; i++, k++) {
      if (i > 0 && live[i].reg !== live[i - 1].reg) {
        k = 0;
        at += rankSpacing + gap;
      } else if (k > 0 && k % COLUMN_FILES === 0) at += rankSpacing;
      if (k % COLUMN_FILES === 0) dist.push(at);
      const f = live[i];
      f.crank = dist.length - 1;
      f.cfile = (k % COLUMN_FILES) - (COLUMN_FILES - 1) / 2;
      f.rank = f.crank === 0 ? 0 : 1;
    }
    // resample the trail from the head backwards at those distances
    const slots = this.columnSlots;
    slots.length = 0;
    const T = this.trail;
    let px = this.x, pz = this.z, walked = 0, k = T.length - 1, tx = 0, tz = 1;
    while (slots.length < dist.length && k >= 0) {
      const [cx, cz] = T[k];
      const dx = cx - px, dz = cz - pz, seg = Math.hypot(dx, dz);
      if (seg > 1e-6) { tx = -dx / seg; tz = -dz / seg; }
      const need = dist[slots.length] - walked;
      if (seg >= need) {
        const t = need / seg;
        px += dx * t; pz += dz * t; walked += need;
        slots.push([px, pz, Math.atan2(tx, tz)]);
      } else {
        walked += seg; px = cx; pz = cz; k--;
      }
    }
    while (slots.length < dist.length) {
      const last = slots[slots.length - 1] || [this.x, this.z, this.facing];
      const step = dist[slots.length] - (slots.length ? dist[slots.length - 1] : 0);
      slots.push([last[0] - Math.sin(last[2]) * step, last[1] - Math.cos(last[2]) * step, last[2]]);
    }
    this.halfFront = COLUMN_FILES * COLUMN_FILE_SPACING * this.spacing * 0.5 + 6;
    this.depth = Math.max(10, (dist.length ? dist[dist.length - 1] : 0) + rankSpacing * 0.5);
  }

  slotWorld(f) {
    if (this.formation === 'column' && f.crank !== undefined && this.columnSlots[f.crank]) {
      const [sx, sz, yaw] = this.columnSlots[f.crank];
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = f.cfile * (this.type === 'cavalry' ? CAVALRY.fileSpacing : COLUMN_FILE_SPACING) * this.spacing + f.jx * 0.6;
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

  /**
   * Cavalry: dismount (or remount). The regiment halts and switches over CAVALRY.dismountS (CAVALRY.remountS); a
   * second toggle while it switches, a routing regiment or a pistol-armed one asked to dismount is refused (false).
   */
  toggleMount() {
    if (this.type !== 'cavalry' || !this.canTakeOrders() || this.switching) return false;
    if (this.mounted && this.weapon === 'pistol') return false;
    this.stop();
    this.run = false;
    this.order = { type: 'hold' };
    this.switching = this.mounted ? { to: 'dismounted', t: 0, dur: CAVALRY.dismountS } : { to: 'mounted', t: 0, dur: CAVALRY.remountS };
    this.layout();
    return true;
  }

  /** Advance a dismount or remount by dt; a routing regiment stays as it was. */
  mountStep(dt) {
    const sw = this.switching;
    if (!sw) return;
    if (this.state === 'routing') { this.switching = null; this.layout(); return; }
    sw.t += dt;
    if (sw.t < sw.dur) return;
    this.mounted = sw.to === 'mounted';
    this.switching = null;
    this.formation = 'line';
    this.layout();
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
  /** homeZ: the friendly map edge a rout runs to; home ([x, z], a scenario retreat point) overrides it. */
  move(dt, homeZ, home = null) {
    if (this.switching) this.mountStep(dt);
    const o = this.order;
    const v = this.vehicle;
    // Hard Marchers (counting only; src/sim/combat.js featsOf): ground covered on a march or attack order since the last
    // step, at the velocity the vehicle just moved with. Reads nothing back into the march.
    if (this.follow.active && this.state !== 'routing' && (o.type === 'move' || o.type === 'attack')) {
      const walked = Math.hypot(v.velocity.x, v.velocity.z) * dt;
      if (walked > 0) featsOf(this).marched += walked;
    }
    const horse = this.type === 'cavalry' && this.mounted && !this.switching;
    let speed = SPEED.walk;
    if (this.state === 'routing') speed = SPEED.rout;
    else if (o.type === 'charge') speed = SPEED.charge;
    else if (o.type === 'fallback') speed = SPEED.fallback;
    else if (this.run) speed = SPEED.run;
    if (horse) speed *= CAVALRY.speed;
    else if (this.switching) speed = 0; // dismounting or remounting: the regiment stands
    if (this.state === 'wavering' && o.type !== 'fallback') speed *= 0.5;
    speed *= 1 - 0.4 * (this.fatigue / 100);
    // ground: woods slow the line, slopes too
    const slope = this.terrain.slopeAt(this.x, this.z);
    speed *= Math.max(0.55, 1 - slope * 0.8);
    if (this.inWoods) speed *= horse ? CAVALRY.woods : 0.7;
    if (this.formation === 'column') speed *= 1.1; // a road column keeps a better pace than a line over fields
    if (SCREENED.has(this)) speed *= CAVALRY.screenSlow; // skirmishing enemy horsemen slow the march
    speed *= RULES.marchSpeed;
    v.maxSpeed = speed;

    if (this.state === 'routing') {
      this.follow.active = false;
      this.setFormation('line');
      if (home) {
        const dx = home[0] - this.x, dz = home[1] - this.z, d = Math.hypot(dx, dz);
        if (d > 1) { v.velocity.set((dx / d) * speed, 0, (dz / d) * speed); this.goalFacing = Math.atan2(dx, dz); }
        else v.velocity.set(0, 0, 0);
      } else {
        const dz = homeZ - this.z;
        const goalYaw = Math.atan2(0, dz);
        v.velocity.set(0, 0, Math.sign(dz) * speed);
        this.goalFacing = goalYaw;
      }
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
      const wantColumn = o.type === 'move' && (this.type === 'infantry' || this.type === 'cavalry' && !this.afoot) && (this.pathLength || 0) > COLUMN_MIN_PATH
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

  /** Leave active figures without creating casualties or changing source roster identity. */
  surrender() {
    if (!this.alive || this.state === 'captured') return 0;
    const men = this.men;
    this.men = 0;
    this.state = 'captured';
    this.stop();
    this.order = { type: 'hold' };
    this.target = null;
    for (const figure of this.figures) if (figure.alive) { figure.alive = false; figure.gone = true; }
    return men;
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
    const spare = this.type === 'cavalry' && this.afoot; // on foot the horse-holders stand out of the firing line
    while (live.length > want && live.length > 0) {
      const from = spare && live.some((f) => !f.holder) ? live.filter((f) => !f.holder) : live;
      // front rank and the middle of the line suffer most
      let pick = Math.floor(this.rnd() * from.length);
      if (this.rnd() < 0.6) {
        const front = from.filter((f) => f.rank === 0);
        if (front.length) pick = from.indexOf(front[Math.floor(this.rnd() * front.length)]);
      }
      const f = from[pick];
      f.alive = false;
      f.dying = now > 0 ? now : 1e-6;
      f.front = this.rnd() < 0.45;
      f.dieYaw = f.yaw + (this.rnd() - 0.5) * 1.6;
      killed++;
      live.splice(from === live ? pick : live.indexOf(f), 1);
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
    const cav = this.type === 'cavalry', afoot = cav && this.afoot;
    const foot = infantry || afoot; // men on foot: the infantry clips and the long arm
    const halos = this.halos;
    const haloKind = this.momentGlow ? 3 : this.selected ? 1 : this.underFire > 0 ? 2 : 0;
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
      if (cav && (!afoot || f.holder)) { this.animateRider(f, dt, s, unitSpeed, maxSp, rc, haloKind, haloStr); continue; }
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
        const clip = charging && foot ? 'charge' : running ? 'run' : 'walk';
        this.setClip(f, clip);
        f.clipT += step / (s * (running ? RUN_CYCLE : WALK_CYCLE)) * f.pace;
        f.stride += step * f.pace;
      } else if (foot && this.firing && !routing) {
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
      } else if (!foot) {
        this.setClip(f, f.crewClip || 'crew');
        f.clipT = 0;
      } else {
        this.setClip(f, 'stand');
        f.clipT += dt * 0.6;
      }
      f.blend = Math.max(0, f.blend - dt * BLEND_RATE);
      f.flash = Math.max(0, f.flash - dt * 9);
      const y = T.heightAt(f.x, f.z);
      if (rigged) pool.push(f.x, y, f.z, f.yaw, s, framePos(f.clip, f.clipT), f.prevPos, f.blend, f.flash, f.coatVar, f.trouserVar, f.prop ?? (foot ? 1 : 0), 0, rc);
      if (baked) imp.push(f.x, y, f.z, f.yaw, s, bakedClip(f), bakedPhase(f, s, walkM), f.coatVar, bc, f.i);
      // one ellipse per man (files are 2.35 m apart); a sprite carries its own baked shadow, so no blob for it
      if (halos && (haloKind || rigged)) halos.push(f.x, y, f.z, f.yaw, (haloKind ? 1.45 : 1.7) * V.scale, (haloKind ? 1.2 : 1.1) * V.scale, haloKind, haloStr, haloKind ? 0 : rc);
    }
    if (this.officer) this.animateOfficer(dt, time);
    if (this.flags && this.bearers && this.alive && this.state !== 'captured') this.pushColours(this.flags, s);
  }

  /**
   * A cavalryman in the saddle (render only): his horse from the MountPool (a horse-holder on foot duty leads three
   * more beside him) and the rider in the side's SoldierPool at saddle height, as the officers ride.
   */
  animateRider(f, dt, s, unitSpeed, maxSp, rc, haloKind, haloStr) {
    const T = this.terrain;
    const [tx, tz, slotYaw] = this.slotWorld(f);
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
    let step = 0;
    if (d > 0.05) {
      step = Math.min(d, Math.min(maxSp * f.pace, d * 2.2 + unitSpeed * 0.3) * dt);
      f.x += (dx / d) * step; f.z += (dz / d) * step;
    }
    const moving = step / Math.max(dt, 1e-6) > 0.35;
    const goal = moving && (d > 3 || this.state === 'routing') ? Math.atan2(dx, dz) : slotYaw;
    f.yaw += wrap((this.order.keepFacing && this.state !== 'routing' ? this.facing : goal) - f.yaw) * Math.min(1, dt * 5);
    this.setClip(f, 'ride');
    f.clipT += moving ? step / (s * RUN_CYCLE) * f.pace : dt * 0.5;
    f.stride += step * f.pace;
    f.blend = Math.max(0, f.blend - dt * BLEND_RATE);
    f.flash = 0;
    const y = T.heightAt(f.x, f.z), hs = s * 0.92;
    const mounts = this.mounts, coat = Math.floor(f.coatVar * 6);
    if (mounts) {
      mounts.push(f.x, y, f.z, f.yaw, hs, coat);
      if (f.holder && this.afoot) {
        const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
        for (let k = 1; k <= CAVALRY.ledHorses; k++) {
          const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * CAVALRY.fileSpacing;
          const lx = f.x + c * off, lz = f.z - sn * off;
          mounts.push(lx, T.heightAt(lx, lz), lz, f.yaw, hs, (coat + k) % 6);
        }
      }
    }
    // cavalry always draws rigged (no baked horsemen yet)
    this.pool.push(f.x, y + (1.52 - 0.98) * hs, f.z, f.yaw, s, framePos('ride', f.clipT), f.prevPos, f.blend, 0, f.coatVar, f.trouserVar, 0, 0, rc);
    if (this.halos) this.halos.push(f.x, y, f.z, f.yaw, 1.6 * FIGURE_VIEW.scale, 2.6 * FIGURE_VIEW.scale, haloKind, haloStr, haloKind ? 0 : rc);
  }

  /** Where the brigade commander rides (sim state only, no render state): [x, z]. Behind the line's centre, ahead of a column. */
  officerSlot() {
    const fs = Math.sin(this.facing), fc = Math.cos(this.facing);
    if (this.formation === 'column' && this.columnSlots.length) return [this.x + fs * 9 + fc * 5, this.z + fc * 9 - fs * 5];
    const back = this.state === 'routing' ? 4 : this.type === 'cavalry' ? this.depth / 2 + 12 : RANK_SPACING * this.spacing + 7;
    return [this.x - fs * back + fc * 3, this.z - fc * back - fs * 3];
  }

  /** The brigade commander on horseback behind the centre of the line (ahead of a column). */
  animateOfficer(dt, time) {
    const o = this.officer;
    const s = FIGURE_SCALE * FIGURE_VIEW.scale;
    const T = this.terrain;
    if (o.horse < 0 && this.horses) o.horse = this.horses.alloc(o.coat || '#5a3a26');
    if (this.commandDown) { this.animateOfficerDown(dt, time); return; }
    if (!this.alive) { if (o.horse >= 0) this.horses.set(o.horse, 0, -500, 0, 0, 0.001); return; }
    const [tx, tz] = this.officerSlot();
    const tyaw = this.facing;
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
   * A fallen brigade commander: killed, he falls from the saddle and lies beside his standing horse; wounded, he
   * rides to the rear (away from the line) and leaves the field after OFFICER_LEAVE_S.
   */
  animateOfficerDown(dt, time) {
    const o = this.officer, down = this.commandDown;
    const s = FIGURE_SCALE * FIGURE_VIEW.scale, hs = s * 0.92;
    const T = this.terrain;
    const hide = () => { if (o.horse >= 0) this.horses.set(o.horse, 0, -500, 0, 0, 0.001); };
    if (down.kind === 'killed') {
      const y = T.heightAt(o.x, o.z);
      if (o.horse >= 0) this.horses.set(o.horse, o.x, y, o.z, o.yaw, hs);
      const p = Math.min(1, Math.max(0, (time - down.at) / FALL_S));
      const lx = o.x + Math.cos(o.yaw) * 1.6 * hs, lz = o.z - Math.sin(o.yaw) * 1.6 * hs; // beside the horse
      const fx = o.x + (lx - o.x) * p, fz = o.z + (lz - o.z) * p;
      const fy = T.heightAt(fx, fz) + (1 - p) * (1.52 - 0.98) * hs;
      this.pool.push(fx, fy, fz, o.yaw, s, framePos('fall-back', p), 0, 0, 0, o.coatVar, o.trouserVar, 0, 1);
      return;
    }
    const t = time - down.at;
    if (t > OFFICER_LEAVE_S) { hide(); return; }
    if (o.leaveYaw === undefined) o.leaveYaw = wrap(this.facing + Math.PI);
    const step = SPEED.run * dt;
    o.x += Math.sin(o.leaveYaw) * step; o.z += Math.cos(o.leaveYaw) * step;
    o.yaw += wrap(o.leaveYaw - o.yaw) * Math.min(1, dt * 4);
    o.phase += dt * 2.6;
    const y = T.heightAt(o.x, o.z);
    if (o.horse >= 0) this.horses.set(o.horse, o.x, y, o.z, o.yaw, hs);
    this.pool.push(o.x, y + (1.52 - 0.98) * hs, o.z, o.yaw, s, framePos('ride', o.phase), 0, 0, 0, o.coatVar, o.trouserVar, 0, 1);
  }

  /** The colour party of every regiment block: national and regimental colour beside their bearers (render only). */
  pushColours(flags, s) {
    const T = this.terrain;
    for (const pair of this.bearers) {
      if (!pair) continue;
      for (let k = 0; k < 2; k++) {
        const f = pair[k];
        if (!f || !f.alive) continue;
        const x = f.x + Math.cos(f.yaw) * 0.42 * s, z = f.z - Math.sin(f.yaw) * 0.42 * s; // in his right hand
        flags.push(x, T.heightAt(x, z), z, this.side, k === 0 ? 'national' : 'regimental', s);
      }
    }
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

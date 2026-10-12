// src/game.js: the battle: units, simulation clock, orders, AI, objective, victory.
//
// Orders the player gives (DESIGN.md 4b, "Move order" / "Attack order"):
//   move    march to the mark; meeting an enemy in effective range on the way the line halts and fires
//           (rules.moveOrder 'fight') and marches on once that enemy is gone, out of range or routing; on
//           arrival it holds, facing endFacing (by default toward the nearest enemy from the mark)
//   attack  close on a target to effective range with line of sight, halt, fire, and follow it if it moves
//           (attackStep); never charges on its own
//   charge  only from the Charge button or key
// Delegate (DESIGN.md 2 "Command"): delegate(units, role, x, z) hands own brigades to the AI (src/sim/ai.js) as
// Attack, Defend or Support of a place (unit.delegate = { role, x, z, since }); any direct order to one of them
// (order, orderGroup, orderSelected: move, attack, hold, charge, run, fall back, halt, hold fire) reclaims it
// first and then runs exactly as for any other brigade; undelegate(units) reclaims and halts (the card's Undo).
// A selection may hold several brigades (box select); a drag order moves them all, keeping their places
// relative to the brigade dragged, turned with it. Brigade initiative (rules.initiative): a unit without
// orders turns to face fire from beyond its arc when nothing is in front of it; it never advances unordered.
// Events: 'select', 'log' (a toast: replies to the player's own actions), 'event' ({ text, time, x, z, side, kind }), 'alert' (an auto-pause:
// { text, x, z }), 'spawn' / 'remove' (a unit added or taken off the field in the sandbox).
// Command (DESIGN.md §2 "Commanders"): scenario.commanders (optional; validated in sim/phase.js) are division,
// corps or army generals, each a mounted figure riding ~160 m (120-200 m) behind the centre of his living brigades
// that are not routing, never into their line. Inside his 300 m rally radius every brigade of his side rallies 50%
// faster and loses morale 20% slower (combat.js setCommand); a brigade's own commander (unit.officer) does the same
// for his brigade alone. Each tick a general or brigade commander within 120 m of a point that took fire may be hit
// (rules.commanderRisk, % per hour of close action): wounded or killed, half each. That roll uses the command
// stream, a second mulberry32 stream seeded from the game seed, and draws only while someone is in danger, so the
// game stream (g.rnd) and every existing oracle are untouched. A hit ends his bonus, gives his brigades a one-time
// -10 morale shock, and is reported in the feed and a toast; a brigade that loses its commander shows "Commander
// down" until the battle ends (its successor stays generic unless the data names a sourced one). Fates in the data
// are after-action text only; nothing is scripted. Command state lives in a WeakMap (no own Game keys).
// Figures (src/ui/look.js): look.figureStyle picks rigged 3D figures or baked sprites (both, split-screen, while
// it is compared); the atlas loads the first time baked is wanted and the rigged figures draw until it is in.
// look.menPerFigure re-forms the infantry at 1:10 or 1:5, never denser than the phase's scenario.menPerFigure
// (sim/phase.js phaseMenPerFigure, default 5); pools are sized at that phase minimum from the start.
// Badges (DESIGN.md §3; src/franchise/badges.js): a definition's badges ([{ id, tier, xfactor? }], from the campaign save)
// set the unit's badge effects in combat.js. featReport() returns every unit's feat statistics for the phase result; the
// game adds the feats only it sees (field stores taken; guns surrendered to a captor). An X-Factor brigade's first fight
// in a battle plays its moment (effects.xFactor: banner, warm glow, sting; look.xFactorStyle) and a feed line, once
// (state in a WeakMap; no own Game keys).
// Cavalry (DESIGN.md §2; rules in sim/combat.js, units/unit.js and sim/ai.js): horses are drawn by one MountPool, made only
// when the roster (or a sandbox spawn) has cavalry and kept in a WeakMap (no own Game keys). Dismount (orderSelected
// 'dismount', the card's button and N) toggles a regiment on and off its horses. A mounted regiment's charge pursues its
// target (pursueStep re-aims it twice a second, a little ahead of a fleeing one); the Attack order on a routing unit is a
// charge for horsemen, and their Charge also takes routing targets. With surrender enabled, a routing unit ridden down
// for RIDE_SURRENDER_S surrenders to the horsemen through the same capture accounting as a blocked rout or an overrun.

import { EntityManager } from 'yuka';
import { Unit, MEN_PER_FIGURE_OPTIONS, MEN_PER_CREW_FIGURE, SPEED, setMenPerFigure } from './units/unit.js';
import { Battery, GunPool } from './units/battery.js';
import { SoldierPool, FallenPool, FlagPool, UNIFORMS, FIGURE_VIEW, FIGURE_SCALE } from './units/soldier-mesh.js';
import { framePos } from './units/figure.js';
import { ImpostorPool, loadBakedAtlas, BAKED_BASES } from './units/impostor.js';
import { LOOK } from './ui/look.js';
import { on as onSetting } from './settings.js';
import { compareState } from './sandbox/compare.js';
import { HaloPool } from './units/halos.js';
import { HorsePool, HORSE_COATS, RallyRings, MountPool } from './units/mounts.js';
import { Combat, CLOCK_RATIO, CAVALRY, CAVALRY_WEAPONS, defaultWeapon, horsed, featsOf, featStats, featGunsTaken, setBadgeEffects, xFactorOf } from './sim/combat.js';
import { BADGE_BY_ID } from './franchise/badges.js';
import { Ai, DELEGATE_ROLES } from './sim/ai.js';
import { RULES } from './sim/rules.js';
import { mulberry32, inWoods, PLAN } from './world/landscape.js';
import { FieldCaptures } from './franchise/captures.js';
import { prepareReinforcementTimeline, reinforcementWindow, captureAccounting, phaseMenPerFigure } from './sim/phase.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MIN_MEN_PER_FIGURE = Math.min(...MEN_PER_FIGURE_OPTIONS); // the densest look choice
const SPAWN_RESERVE = 2100; // figures per side kept free for sandbox spawns (four 2,500-man brigades at 1:5)
// The densest infantry ratio this battle can draw: the phase minimum, never below the densest look choice.
// Read from the scenario, not an own field (pinned Game key lists).
const minMenPerFigureOf = (game) => Math.max(MIN_MEN_PER_FIGURE, phaseMenPerFigure(game.scenario));
// The same four brigades at the phase minimum (exactly SPAWN_RESERVE at 1:5).
const spawnReserve = (ratio) => Math.ceil(SPAWN_RESERVE * MIN_MEN_PER_FIGURE / ratio);
const ARC = (65 * Math.PI) / 180; // the firing arc each side of the facing (combat.js)
// Ephemeral state belongs to a real scheduled Game; borrowed legacy methods have no entry.
const reinforcementState = new WeakMap();
// Read from the scenario, not an own field, so borrowed Game methods (tests) and pinned key lists still work.
const clockRatioOf = (game) => game.scenario.clockRatio ?? CLOCK_RATIO;
const pendingInfantry = (game, side) => {
  const state = reinforcementState.get(game);
  return !!state && (state.plan.events.some(e => e.atSec > state.cursor && e.unit.side === side
    && (e.unit.type || 'infantry') === 'infantry') || !!state.capture && [...captureCorridors(game).keys()].some(u => u.side === side && u.type === 'infantry'));
};

// Capture state remains ephemeral, inside the scheduled Game's existing WeakMap entry.
const captureFail = message => { throw new Error('Surrender: ' + message); };
const freezeCapture = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeCapture(child); Object.freeze(value); }
  return value;
};
const captureState = game => reinforcementState.get(game)?.capture;
// Cavalry horses: { mounts } only once cavalry is on the field (no own Game keys; legacy scenes allocate nothing).
const cavalryState = new WeakMap();
// X-Factor brigades whose moment has played this battle (game -> Set of units); empty on fields without badges.
const xfactorShown = new WeakMap();
const RIDE_SURRENDER_S = 3; // sim s of being ridden down after which a routing unit surrenders (surrender enabled)
/** The game's MountPool, made on first need with room for `figures` horses. */
function ensureMounts(game, figures) {
  let st = cavalryState.get(game);
  if (!st) {
    st = { mounts: new MountPool(Math.max(1, figures)) };
    game.scene.add(st.mounts.mesh);
    cavalryState.set(game, st);
  }
  return st.mounts;
}

function captureSources(plan) {
  return [...plan.scenario.units, ...(plan.scenario.reinforcements || [])].map((def, index) => ({
    def, arrivalAtSec: index < plan.scenario.units.length ? 0 : def.atSec,
    unit: null, actualDef: null,
  }));
}

function bindCaptureUnit(state, unit) {
  const source = state.capture.sources.find(s => s.def.id === unit.id);
  if (!source || source.unit) captureFail('formation identity was already bound or is absent.');
  source.unit = unit; source.actualDef = unit.def;
  source.slots = unit.gunSlots; source.pieces = (unit.gunSlots || []).map(slot => ({ slot, gun: slot.gun, limber: slot.limber }));
}

// Descriptor-safe comparisons of the small, validated identity/equipment fields. Never run a getter.
function captureValue(value, depth = 0, seen = new Set()) {
  if (depth > 32 || seen.has(value)) captureFail('source metadata exceeds its structural bounds.');
  if (value === null || ['string', 'boolean', 'undefined'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) captureFail('source metadata changed.');
  seen.add(value);
  const out = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d || !('value' in d)) captureFail('source metadata descriptor changed.');
    Object.defineProperty(out, key, { value: captureValue(d.value, depth + 1, seen), enumerable: true, configurable: true, writable: true });
  }
  seen.delete(value);
  return out;
}

function captureProperty(value, key) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d) { if (key in value) captureFail('inherited source metadata changed.'); return undefined; }
  if (!('value' in d)) captureFail('source metadata descriptor changed.');
  return captureValue(d.value);
}

function validateCaptureRoster(game, state) {
  const capture = state.capture;
  if (!state.initialized || capture.dispatching) captureFail('initialize the complete source roster before observing captures.');
  const due = capture.sources.filter(s => s.arrivalAtSec <= game.simTime);
  if (game.units.length !== due.length || new Set(game.units).size !== due.length) captureFail('the closed source roster changed.');
  for (const s of capture.sources) {
    if (s.arrivalAtSec > game.simTime) { if (s.unit) captureFail('formation arrived before its source offset.'); continue; }
    const u = s.unit, d = s.def;
    if (!u || !game.units.includes(u) || u.def !== s.actualDef || u.id !== d.id || u.side !== d.side
      || u.type !== (d.type || 'infantry') || u.name !== d.name || u.menMax !== d.men
      || u.guns !== (d.guns || 0) || u.weapon !== (d.weapon || defaultWeapon(d.type))
      || !Number.isFinite(u.men) || u.men < 0 || u.men > d.men) captureFail('source formation identity or strength changed.');
    for (const key of ['id', 'side', 'type', 'name', 'men', 'guns', 'weapon', 'equipment']) {
      if (JSON.stringify(captureProperty(u.def, key)) !== JSON.stringify(d[key])) captureFail('source definition changed.');
    }
    if (JSON.stringify(captureProperty(u, 'equipment')) !== JSON.stringify(d.equipment)) captureFail('issued equipment changed.');
    const n = d.type === 'artillery' ? d.guns : 0;
    if (n ? !Array.isArray(u.gunSlots) || u.gunSlots.length !== n || u.gunSlots !== s.slots || u.gunSlots.some((g, k) => g !== s.pieces[k].slot || g.gun !== s.pieces[k].gun
        || g.limber !== s.pieces[k].limber || typeof g.alive !== 'boolean')
      : u.gunSlots !== undefined) captureFail('physical gun identities or conditions changed.');
    const record = capture.records.get(d.id);
    if (record && (u.men !== 0 || u.state !== 'captured'
      || record.gunConditions.some((alive, k) => u.gunSlots[k].alive !== alive))) captureFail('a surrendered source formation changed.');
    if (!record && u.state === 'captured') captureFail('a formation was surrendered outside its Game owner.');
  }
  return due;
}

// This is an as-of aggregate observation, not a retained chronology of individual casualty hits.
function observeCaptures(game, state, proposed = state.capture.records) {
  const due = validateCaptureRoster(game, state), events = [], through = game.simTime;
  for (const s of due) {
    const u = s.unit, d = s.def, record = proposed.get(d.id);
    const append = (kind, fields, suffix = kind) => events.push({ id: d.id + ':' + suffix,
      atSec: through, unitId: d.id, kind, ...fields });
    if (record) append('capture-men', { men: record.men, captorSide: record.captorSide });
    const lost = record ? record.killedWounded : d.men - u.men;
    if (!Number.isFinite(lost) || lost < 0 || lost > d.men) captureFail('aggregate source loss is invalid.');
    if (lost > 0) append('loss', { men: lost });
    for (let k = 0; k < (d.type === 'artillery' ? d.guns : 0); k++) {
      if (!u.gunSlots[k].alive) append('disable-gun', { gunIndex: k }, 'disabled-' + k);
      if (record) append('capture-gun', { gunIndex: k, captorSide: record.captorSide }, 'gun-' + k);
    }
  }
  const accounting = captureAccounting(state.plan, { through, events });
  for (const s of due) {
    const row = accounting.units.find(r => r.unitId === s.def.id), record = proposed.get(s.def.id);
    const actual = record ? 0 : s.unit.men;
    if (Math.abs(row.presentMen - actual) > 16 * Number.EPSILON * Math.max(1, row.initialMen)
      || row.capturedMen !== (record?.men || 0)) captureFail('aggregate source conservation changed.');
  }
  const captures = state.capture.sources.filter(s => proposed.has(s.def.id)).map(s => {
    const r = proposed.get(s.def.id), row = accounting.units.find(v => v.unitId === s.def.id);
    return { unitId: s.def.id, originSide: s.def.side, captorSide: r.captorSide,
      men: r.men, captureAtSec: r.captureAtSec, guns: row.guns.map(g => ({ ...g })) };
  });
  return freezeCapture({ observedAtSec: through, captures, accounting });
}

function captureCorridors(game) {
  const sourceUnits = captureState(game).sources.map(source => source.unit).filter(Boolean);
  const rows = sourceUnits.map(u => ({ unit: u, side: u.side, state: u.state, alive: u.alive, x: u.x, z: u.z }));
  const blocked = new Map();
  for (const router of rows) {
    if (!router.alive || router.state !== 'routing') continue;
    const home = router.side === 'US' ? -game.terrain.half + 40 : game.terrain.half - 40;
    const forward = home - router.z, between = z => forward < 0 ? z < router.z && z > home : z > router.z && z < home;
    if (forward === 0) continue;
    let captor = null, distance = Infinity;
    for (const enemy of rows) {
      if (!enemy.alive || enemy.state !== 'steady' || enemy.side === router.side || !between(enemy.z)
        || Math.abs(enemy.x - router.x) > 220) continue;
      const d = Math.hypot(enemy.x - router.x, enemy.z - router.z);
      if (d < distance) { distance = d; captor = enemy.unit; }
    }
    if (captor && !rows.some(friend => friend.unit !== router.unit && friend.alive && friend.state === 'steady'
      && friend.side === router.side && Math.hypot(friend.x - router.x, friend.z - router.z) < distance)) blocked.set(router.unit, captor);
  }
  return blocked;
}

function commitSurrenders(game, state, before, h, contacts = null) {
  const capture = state.capture, after = captureCorridors(game), timers = new Map(), proposed = new Map(capture.records), due = [];
  const overruns = new Map(), captors = new Map();
  if (contacts) for (const source of capture.sources) {
    const attacker = source.unit;
    if (!attacker?.alive || attacker.state !== 'steady') continue;
    for (const [contactAttacker, battery] of contacts) {
      if (contactAttacker === attacker && battery.alive && battery.state === 'routing'
        && battery.side !== attacker.side && !overruns.has(battery)) overruns.set(battery, attacker);
    }
  }
  // routing units ridden down by horsemen (combat.js rideDown): long enough, and the horsemen still fit to take them
  const rides = capture.rides;
  for (const [u] of rides) if (!u.alive || u.state !== 'routing' || capture.records.has(u.id)) rides.delete(u);
  for (const s of capture.sources) {
    const u = s.unit;
    if (!u || capture.records.has(s.def.id)) continue;
    const elapsed = before.has(u) && after.has(u) ? (capture.timers.get(u) || 0) + h : 0;
    const ride = rides.get(u);
    const rider = ride && ride.t >= RIDE_SURRENDER_S && ride.captor.alive && ride.captor.state !== 'routing'
      && ride.captor.state !== 'captured' && ride.captor.side !== u.side ? ride.captor : null;
    const overrunCaptor = overruns.get(u) || rider;
    timers.set(u, overrunCaptor ? 0 : elapsed);
    if ((overrunCaptor || elapsed >= 6) && u.alive && u.state === 'routing') {
      const captor = overrunCaptor || after.get(u);
      if (!captor) continue;
      proposed.set(s.def.id, { men: u.men, killedWounded: s.def.men - u.men,
        captorSide: captor.side, captureAtSec: game.simTime, gunConditions: (u.gunSlots || []).map(g => g.alive) });
      due.push(u); captors.set(u, captor);
    }
  }
  // Refusal leaves surrender-owned timers, records, men, selection and callbacks unchanged.
  observeCaptures(game, state, proposed);
  // Gun-takers (counting only): a surrendering battery's serviceable guns go to its captor, once per battery.
  for (const u of due) if (Array.isArray(u.gunSlots)) featGunsTaken(captors.get(u), u);
  for (const u of due) u.surrender();
  capture.records = proposed; capture.timers = timers;
  if (!due.length) return;
  if (game.selection.some(u => due.includes(u))) {
    for (const u of due) u.selected = false;
    game.selection = game.selection.filter(u => !due.includes(u));
    game.selected = game.selection.includes(game.selected) ? game.selected : game.selection[0] || null;
    game.emit('select', game.selected);
  }
  for (const u of due) game.event(`${u.short} surrenders: ${proposed.get(u.id).men} prisoners.`, u, 'surrender');
  game.alert(`${due.map(u => u.short).join(', ')} surrendered.`, due[0].x, due[0].z);
}

function dispatchReinforcements(game, state, through) {
  if (state.capture) state.capture.dispatching = true;
  try {
  const window = reinforcementWindow(state.plan, { after: state.cursor, through });
  state.cursor = through; // Commit ownership before invoking listeners, including a repeated initialization.
  const events = [...window.notices.map(e => ({ e, time: e.noticeAtSec, notice: true })),
    ...window.arrivals.map(e => ({ e, time: e.atSec, notice: false }))];
  events.sort((a, b) => a.time - b.time || Number(b.notice) - Number(a.notice) || a.e.sourceIndex - b.e.sourceIndex);
  const arrived = [];
  for (const { e, notice } of events) {
    if (game.over) break;
    const name = e.unit.short || e.unit.name;
    if (notice) game.event(`${name} is approaching ${e.unit.entry}.`, null, 'reinforcement-notice', e.unit);
    else {
      const unit = game.makeUnit(e.unit, 100 + state.initialCount + e.sourceIndex);
      unit.order = unit.side === game.playerSide ? { type: 'hold' } : { type: 'hold', firm: true }; // an AI role rides on unit.def.ai
      game.units.push(unit);
      if (state.capture) bindCaptureUnit(state, unit);
      game.emit('spawn', unit);
      game.event(`${name} arrives at ${e.unit.entry}.`, unit, 'reinforcement');
      arrived.push(unit);
    }
  }
  if (arrived.length && !game.over) game.alert(`${arrived.map(u => u.short).join(', ')} arrived.`, arrived[0].x, arrived[0].z);
  } finally { if (state.capture) state.capture.dispatching = false; }
}

// ---- command: generals, brigade commanders, rally and risk ---------------------------------------------
export const COMMAND = Object.freeze({
  radius: 300, // m: a general's rally radius
  behind: 160, minBehind: 120, maxBehind: 200, clearRear: 60, // m behind his brigades' centre; clear of the rearmost
  danger: 120, // m from a point that took fire
  loss: 0.8, rally: 1.5, shock: 10,
  ride: 5, gallop: 9, gallopBeyond: 80, // m/s; he gallops when farther than gallopBeyond from his place
  leaveS: 30, // s a wounded general rides to the rear before he leaves the field
});
const RALLIED = Object.freeze({ loss: COMMAND.loss, rally: COMMAND.rally });
const commandState = new WeakMap();
const commandFail = (message) => { throw new Error('Command: ' + message); };
const DOWN_KINDS = ['wounded', 'killed'];

/** A runtime general from a scenario (or sandbox) definition. */
function makeCommander(def, k) {
  if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id || !['US', 'CS'].includes(def.side)
    || typeof def.name !== 'string' || !def.name.trim() || !Array.isArray(def.units) || !def.units.length
    || !Number.isFinite(def.x) || !Number.isFinite(def.z)) commandFail('a commander needs an id, side, name, units and a position.');
  return { id: def.id, side: def.side, name: def.name, rank: typeof def.rank === 'string' ? def.rank : '', units: def.units.slice(),
    sources: Array.isArray(def.sources) ? def.sources.slice() : [], status: def.status ?? '', fate: def.fate ?? null, successor: def.successor ?? null,
    x: def.x, z: def.z, yaw: def.side === 'US' ? -Math.PI / 2 : Math.PI / 2, moving: false,
    down: null, downAt: 0, gone: false, horse: -1, phase: (k * 0.618) % 1, coatVar: (k * 0.37 + 0.2) % 1, trouserVar: (k * 0.71 + 0.4) % 1,
    coat: HORSE_COATS[(k + 3) % HORSE_COATS.length] };
}

/** "Brigadier General Benjamin M. Prentiss" (rank omitted when the data has none). */
const titled = (rank, name) => (rank ? `${rank} ${name}` : name);

/** The morale factor of a unit (combat.js): rallied inside a living general's radius or by its own commander. */
function commandFactor(game, u) {
  const st = commandState.get(game);
  if (!st || !u.alive) return null;
  if (u.officer && !u.commandDown) return RALLIED;
  for (const c of st.commanders) {
    if (c.down || c.side !== u.side) continue;
    const dx = c.x - u.x, dz = c.z - u.z;
    if (dx * dx + dz * dz <= COMMAND.radius * COMMAND.radius) return RALLIED;
  }
  return null;
}

/** Where a general rides: COMMAND.behind (120-200 m) behind his living, steady brigades' centre, clear of the rearmost. */
function commanderPlace(game, c) {
  let n = 0, cx = 0, cz = 0, fx = 0, fz = 0;
  for (const u of game.units) {
    if (!c.units.includes(u.id) || !u.alive || u.state === 'routing' || u.state === 'captured') continue;
    n++; cx += u.x; cz += u.z; fx += Math.sin(u.facing); fz += Math.cos(u.facing);
  }
  if (!n) return null;
  cx /= n; cz /= n;
  let len = Math.hypot(fx, fz);
  if (len < 1e-3) { fx = Math.sin(c.yaw); fz = Math.cos(c.yaw); len = 1; }
  fx /= len; fz /= len;
  let rear = 0;
  for (const u of game.units) {
    if (!c.units.includes(u.id) || !u.alive || u.state === 'routing' || u.state === 'captured') continue;
    rear = Math.max(rear, -((u.x - cx) * fx + (u.z - cz) * fz));
  }
  const back = Math.min(COMMAND.maxBehind, Math.max(COMMAND.behind, rear + COMMAND.clearRear));
  const lim = game.terrain.half - 30;
  return { x: Math.max(-lim, Math.min(lim, cx - fx * back)), z: Math.max(-lim, Math.min(lim, cz - fz * back)), fx, fz, cx, cz, back };
}

function moveCommander(game, c, h) {
  if (c.gone) return;
  if (c.down) {
    if (c.down !== 'wounded') return;
    // a wounded general rides to his side's rear and leaves the field
    const home = game.scenario.retreat?.[c.side];
    const tx = home ? home[0] : c.x, tz = home ? home[1] : c.side === 'US' ? -game.terrain.half + 40 : game.terrain.half - 40;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d > 1) { const step = Math.min(d, COMMAND.gallop * h); c.x += (dx / d) * step; c.z += (dz / d) * step; c.yaw = Math.atan2(dx, dz); }
    c.moving = d > 1;
    if (game.simTime - c.downAt >= COMMAND.leaveS) c.gone = true;
    return;
  }
  const p = commanderPlace(game, c);
  if (!p) { c.moving = false; return; }
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
  if (d > 2) {
    const step = Math.min(d, (d > COMMAND.gallopBeyond ? COMMAND.gallop : COMMAND.ride) * h);
    c.x += (dx / d) * step; c.z += (dz / d) * step;
    c.yaw += wrap(Math.atan2(dx, dz) - c.yaw) * Math.min(1, h * 4);
    c.moving = true;
  } else {
    c.yaw += wrap(Math.atan2(p.fx, p.fz) - c.yaw) * Math.min(1, h * 2);
    c.moving = false;
  }
}

/** A general (or a brigade's commander, `who` a Unit) is hit: report it, end his bonus, shock his brigades. */
function commanderHit(game, who, kind) {
  const st = commandState.get(game);
  if (!st || !DOWN_KINDS.includes(kind)) return false;
  let text;
  if (who instanceof Unit) {
    if (!who.officer || who.commandDown) return false;
    const c = who.commander || {};
    who.commandDown = { kind, at: game.simTime, name: c.name || '', rank: c.rank || '' };
    who.morale = Math.max(0, who.morale - COMMAND.shock);
    text = `${titled(c.rank, c.name)} is ${kind}.`;
    game.event(text, who, 'commander');
  } else {
    if (!st.commanders.includes(who) || who.down) return false;
    who.down = kind; who.downAt = game.simTime; who.moving = false;
    for (const u of game.units) if (who.units.includes(u.id) && u.alive) u.morale = Math.max(0, u.morale - COMMAND.shock);
    text = `${titled(who.rank, who.name)} is ${kind}.`;
    game.event(text, null, 'commander', { x: who.x, z: who.z, side: who.side });
  }
  game.emit('log', text);
  return true;
}

/** Per tick after the fire: generals ride; anyone within COMMAND.danger of a point that took fire may be hit. */
function commandStep(game, h) {
  const st = commandState.get(game);
  if (!st) return;
  const hits = game.combat.takeHits();
  for (const c of st.commanders) moveCommander(game, c, h);
  const risk = RULES.commanderRisk;
  if (!hits.length || !(risk > 0) || h <= 0) return;
  // per-tick chance from the hourly one, in historical time: 1 - (1 - H)^(t / 3600)
  const p = 1 - Math.pow(1 - Math.min(0.99, risk / 100), (h * clockRatioOf(game)) / 3600);
  const R2 = COMMAND.danger * COMMAND.danger;
  const exposed = (x, z) => {
    for (let i = 0; i < hits.length; i += 2) if ((hits[i] - x) ** 2 + (hits[i + 1] - z) ** 2 <= R2) return true;
    return false;
  };
  const roll = (who) => {
    const r = st.rnd(); st.draws++;
    if (r < p / 2) commanderHit(game, who, 'killed');
    else if (r < p) commanderHit(game, who, 'wounded');
  };
  for (const c of st.commanders) if (!c.down && !c.gone && exposed(c.x, c.z)) roll(c);
  for (const u of game.units) {
    if (!u.officer || u.commandDown || !u.alive || u.state === 'captured') continue;
    const [x, z] = u.officerSlot();
    if (exposed(x, z)) roll(u);
  }
}

/** Generals on horseback (render only), the colours and the rally rings of the selection. */
function animateCommand(game, simDt) {
  const st = commandState.get(game);
  if (!st) return;
  const s = FIGURE_SCALE * FIGURE_VIEW.scale, hs = s * 0.92, T = game.terrain;
  const rings = [];
  for (const c of st.commanders) {
    if (c.horse < 0 && !c.gone) c.horse = game.horses.alloc(c.coat);
    if (c.gone) { if (c.horse >= 0) game.horses.set(c.horse, 0, -500, 0, 0, 0.001); continue; }
    const y = T.heightAt(c.x, c.z);
    if (c.horse >= 0) game.horses.set(c.horse, c.x, y, c.z, c.yaw, hs);
    const pool = game.pools[c.side];
    if (c.down === 'killed') {
      const p = Math.min(1, Math.max(0, (game.simTime - c.downAt) / 0.8));
      const lx = c.x + Math.cos(c.yaw) * 1.6 * hs * p, lz = c.z - Math.sin(c.yaw) * 1.6 * hs * p;
      pool.push(lx, T.heightAt(lx, lz) + (1 - p) * (1.52 - 0.98) * hs, lz, c.yaw, s, framePos('fall-back', p), 0, 0, 0, c.coatVar, c.trouserVar, 0, 1);
      continue;
    }
    c.phase += simDt * (c.moving ? 2.4 : 0.5);
    pool.push(c.x, y + (1.52 - 0.98) * hs, c.z, c.yaw, s, framePos('ride', c.phase), 0, 0, 0, c.coatVar, c.trouserVar, 0, 1);
    const shown = st.selected === c || game.selection.some((u) => c.units.includes(u.id));
    if (game.halos) game.halos.push(c.x, y, c.z, c.yaw, 1.8, 2.9, shown ? 1 : 0, 0);
    if (!c.down && shown) rings.push({ x: c.x, z: c.z, r: COMMAND.radius, side: c.side });
  }
  st.rings.show(rings);
}

function scheduledReady(game, state) {
  if (!state.initialized) throw new Error('Reinforcements: attach listeners and initialize before advancing the battle.');
}

/**
 * Battle-pack victory (the scenario names its attacker): a broken side loses; at the end the attacker
 * wins only by holding the objective alone, a contested objective is a draw, anything else is the
 * defender's. Grade is from the player's side. Henry Hill and practice keep their own rules above.
 */
function packResult(game, effective, ended) {
  const A = game.scenario.attacker, D = A === 'US' ? 'CS' : 'US';
  const V = game.scenario.victory || {}, o = game.objective;
  const name = (side) => (side === 'US' ? 'Union' : 'Confederate');
  let result = null;
  if (effective(D) === 0 && !pendingInfantry(game, D)) result = { winner: A, why: V.defenderBroken ?? `The ${name(D)} line has broken.` };
  else if (effective(A) === 0 && !pendingInfantry(game, A)) result = { winner: D, why: V.attackerBroken ?? `The ${name(A)} line has broken.` };
  else if (ended) {
    if (game.holder === A) result = { winner: A, why: V.attackerHolds ?? `${name(A)} troops hold ${o.name} at the end of the day.` };
    else if (game.holder === 'contested') result = { winner: null, draw: true, why: V.draw ?? `${o.name} is still contested at the end of the day.` };
    else result = { winner: D, why: V.defenderHolds ?? `The ${name(A)} attack did not take ${o.name}.` };
  }
  if (!result) return null;
  const ps = game.playerSide, enemy = ps === 'US' ? 'CS' : 'US', lost = { US: 0, CS: 0 };
  for (const u of game.units) lost[u.side] += Math.max(0, (u.menMax || 0) - (u.men || 0));
  result.grade = result.draw ? 'draw' : result.winner !== ps ? 'defeat'
    : lost[enemy] > 0 && lost[enemy] >= 2 * lost[ps] ? 'decisive' : 'victory';
  return result;
}

export class Game {
  constructor({ scene, terrain, scenario, world, effects, playerSide = 'US' }) {
    // This validates structure, not hardware admission: routed definitions pass the field guard upstream.
    const timeline = 'reinforcements' in scenario || 'surrender' in scenario || 'batteryOverrun' in scenario ? prepareReinforcementTimeline({ version: 1,
      id: 'game', title: 'Battle runtime', phases: [{ id: 'battle', scenario }] }, 'battle', scenario) : null;
    const surrender = timeline?.scenario.surrender === true;
    const overrun = timeline?.scenario.batteryOverrun === true;
    if (surrender) captureAccounting(timeline, { through: 0, events: [] });
    if (timeline?.events.length || surrender) reinforcementState.set(this, { plan: timeline, cursor: null,
      initialized: false, initialCount: scenario.units.length, ...(surrender ? { capture: { sources: captureSources(timeline),
        records: new Map(), timers: new Map(), pre: new Map(), dispatching: false,
        overrun, contacts: null, tickActive: false, rides: new Map() } } : {}) });
    this.scene = scene;
    this.terrain = terrain;
    this.scenario = scenario;
    this.effects = effects;
    this.playerSide = playerSide;
    this.rnd = mulberry32(scenario.seed ?? 18610721);
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
    const poolDefs = timeline?.events.length ? [...defs, ...timeline.events.map(e => e.unit)] : defs;
    // figures per side at the densest ratio this phase can draw (the phase minimum, 5 men by default; 4 per crew
    // figure in a battery), plus an officer and slack
    const minRatio = minMenPerFigureOf(this);
    setMenPerFigure(LOOK.menPerFigure, minRatio);
    const figs = (side) => poolDefs.filter((d) => d.side === side).reduce((s, d) => s + Math.round(d.men / (d.type === 'artillery' ? MEN_PER_CREW_FIGURE : minRatio)) + 6, 0);
    const outline = !/\boutline=0\b/.test(globalThis.location ? location.search : '');
    const reserve = spawnReserve(minRatio);
    this.reserve = { US: reserve, CS: reserve };
    const cap = (side) => figs(side) + reserve;
    this.pools = {
      US: new SoldierPool(cap('US'), UNIFORMS.US, { kit: 'US', outline }),
      CS: new SoldierPool(cap('CS'), UNIFORMS.CS, { kit: 'CS', outline }),
    };
    this.fallen = {
      US: new FallenPool(cap('US'), UNIFORMS.US, { kit: 'US' }),
      CS: new FallenPool(cap('CS'), UNIFORMS.CS, { kit: 'CS' }),
    };
    this.halos = new HaloPool(cap('US') + cap('CS'));
    // baked sprites: each side draws from its own bake (BAKED_BASES)
    this.impostors = {
      US: new ImpostorPool(cap('US'), { side: 'US' }),
      CS: new ImpostorPool(cap('CS'), { side: 'CS' }),
    };
    // idle | loading | ready | failed; atlases per side, atlas = the Union one (older readers)
    this.baked = { state: 'idle', atlas: null, atlases: null, error: null };
    scene.add(this.impostors.US.mesh, this.impostors.CS.mesh);
    // cavalry horses (one per trooper figure; a horse-holder leads three) plus room for sandbox spawns
    const cavalryFigs = poolDefs.filter((d) => d.type === 'cavalry').reduce((s, d) => s + Math.round(d.men / minRatio) + 6, 0);
    if (cavalryFigs) ensureMounts(this, cavalryFigs + 2 * reserve);
    const commanders = Array.isArray(scenario.commanders) ? scenario.commanders : [];
    this.horses = new HorsePool(poolDefs.length + 2 + (commanders.length ? commanders.length + 4 : 0));
    // two colours per regiment block (unit.js pushColours)
    const colours = poolDefs.reduce((n, d) => n + ((d.type || 'infantry') === 'infantry' && Array.isArray(d.regiments)
      && d.regiments.length >= 1 && d.regiments.length <= 8 ? 2 * d.regiments.length : 0), 0);
    const flags = new FlagPool(colours, { date: scenario.date });
    scene.add(flags.mesh);
    commandState.set(this, { commanders: commanders.map(makeCommander), selected: null, flags, rings: new RallyRings(scene, terrain),
      rnd: mulberry32(((scenario.seed ?? 18610721) ^ 0x5c0a3d) >>> 0), draws: 0 });
    const gunsOf = (side) => poolDefs.filter((d) => d.side === side).reduce((s, d) => s + (d.guns || 0), 0);
    this.gunPool = new GunPool({ US: gunsOf('US'), CS: gunsOf('CS') });
    for (const p of [this.pools.US, this.pools.CS, this.fallen.US, this.fallen.CS, this.halos, this.horses]) scene.add(p.mesh);
    scene.add(...this.gunPool.meshes);

    this.entities = new EntityManager();
    this.units = defs.map((d, k) => this.makeUnit(d, 100 + k));
    const state = reinforcementState.get(this);
    if (state?.capture) for (const unit of this.units) bindCaptureUnit(state, unit);

    const sites = PLAN.sites;
    const fenceField = world.fenceField;
    this.coverAt = (x, z) => {
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 45)) return { value: 1.58, kind: 'farm buildings' };
      if (inWoods(x, z)) return { value: 1.4, kind: 'woods' };
      if (fenceField && fenceField.dist(x, z) < 14) return { value: 1.25, kind: 'fence line' };
      return { value: 1, kind: 'open' };
    };
    this.combat = new Combat({ units: this.units, terrain, coverAt: this.coverAt, fallen: this.fallen, fx: effects, rnd: this.rnd,
      onBatteryContact: state?.capture?.overrun ? (attacker, battery) => {
        if (state.capture.contacts) state.capture.contacts.push([attacker, battery]);
      } : null,
      onRideDown: state?.capture ? (rider, router, dt) => {
        const r = state.capture.rides.get(router);
        if (r && r.captor === rider) r.t += dt; else state.capture.rides.set(router, { captor: rider, t: dt });
      } : null });
    if (state?.capture) this.combat.rallyBlocked = u => state.capture.pre.has(u);
    this.combat.setCommand((u) => commandFactor(this, u));
    this.ai = new Ai(this, scenario.ai || {});
    // the defenders begin under orders to hold their ground; AI attack and reserve roles (u.def.ai, ai.js) hold
    // the same way until they activate, then the AI replaces this with move orders (a firm hold blocks nothing)
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
    setMenPerFigure(n, minMenPerFigureOf(this));
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

  /** Historical seconds per simulation second: the scenario's clockRatio, else CLOCK_RATIO. */
  get clockRatio() { return clockRatioOf(this); }

  /** Start loading both sides' baked atlases (once); the rigged figures draw until both are ready. */
  ensureBaked() {
    if (this.baked.state !== 'idle') return;
    this.baked.state = 'loading';
    Promise.all([loadBakedAtlas(BAKED_BASES.US), loadBakedAtlas(BAKED_BASES.CS)]).then(([us, cs]) => {
      this.baked.atlas = us;
      this.baked.atlases = { US: us, CS: cs };
      this.impostors.US.attach(us);
      this.impostors.CS.attach(cs);
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
    setMenPerFigure(null, minMenPerFigureOf(this)); // keep the look choice; this battle's minimum, even if another Game was made since
    const u = d.type === 'artillery'
      ? new Battery(d, this.pools[d.side], this.gunPool, this.terrain, seed)
      : new Unit(d, this.pools[d.side], this.terrain, seed);
    u.halos = this.halos;
    u.impostors = this.impostors[d.side];
    u.horses = this.horses;
    u.fallenPool = this.fallen[d.side];
    if (u.officer) u.officer.coat = HORSE_COATS[seed % HORSE_COATS.length];
    if (u.bearers) u.flags = commandState.get(this)?.flags ?? null;
    if (u.type === 'cavalry') u.mounts = cavalryState.get(this)?.mounts ?? null;
    if (Array.isArray(d.badges) && d.badges.length) setBadgeEffects(u, d.badges); // campaign badges (combat.js effects)
    this.entities.add(u.vehicle);
    return u;
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev]) fn(...a); }

  /** Call once after all field listeners are attached. Empty schedules preserve the legacy path. */
  initializeReinforcements() {
    const state = reinforcementState.get(this);
    if (!state || state.initialized || this.over) return;
    state.initialized = true;
    dispatchReinforcements(this, state, 0);
  }

  /** Detached as-of prisoner and physical-gun accounting; legacy battles have no capture state. */
  captureSnapshot() {
    const state = reinforcementState.get(this);
    return state?.capture ? observeCaptures(this, state) : null;
  }

  /** May the player order this unit? (His own side; the other side too with units.controlBothSides.) */
  controls(u) {
    return !!u && u.alive && (u.side === this.playerSide || this.controlBoth);
  }

  // ---------------------------------------------------------------------------------------------------
  // Selection
  select(u, { add = false } = {}) {
    const command = commandState.get(this);
    if (command) command.selected = null;
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
    const command = commandState.get(this);
    if (command) command.selected = null;
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
    this.reclaim(u); // a direct order takes a delegated brigade back
    let ok;
    if (type === 'attack' && horsed(u) && target && target.state === 'routing') {
      ok = u.orderCharge(target); // horsemen pursue a fleeing enemy: ride it down
    } else if (type === 'attack') {
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
    if (kind === 'dismount' && !group.some((u) => u.type === 'cavalry')) { this.emit('log', 'Only cavalry can dismount.'); return false; }
    let ok = false;
    for (const u of group) this.reclaim(u); // a direct order takes delegated brigades back
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
      else if (kind === 'dismount') {
        if (u.type !== 'cavalry') continue;
        const was = u.mounted;
        if (u.toggleMount()) {
          ok = true;
          this.emit('log', was ? `${u.short} dismounts: every fourth man holds the horses; carbines ready in ${CAVALRY.dismountS} s.`
            : `${u.short} remounts: in the saddle in ${CAVALRY.remountS} s.`);
        } else {
          this.emit('log', u.switching ? `${u.short} is already ${u.switching.to === 'mounted' ? 'remounting' : 'dismounting'}.`
            : `${u.short} carries revolvers and sabres: it fights mounted.`);
        }
      }
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

  /**
   * Delegate own brigades (the player's side, able to take orders) to the AI as `role` ('attack', 'defend' or
   * 'support') of the place (x, z), kept inside the ground. Each stops where it is; the AI plans its march on its
   * next step. Returns how many were delegated.
   */
  delegate(units, role, x, z) {
    if (!DELEGATE_ROLES.includes(role) || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const lim = this.terrain.half - 40;
    x = Math.max(-lim, Math.min(lim, x)); z = Math.max(-lim, Math.min(lim, z));
    const list = units.filter((u) => this.controls(u) && u.side === this.playerSide && u.canTakeOrders());
    for (const u of list) {
      u.stop();
      u.order = { type: 'hold' };
      u.delegate = { role, x, z, since: this.simTime };
    }
    if (!list.length) return 0;
    this.orders = (this.orders || 0) + 1;
    const word = role[0].toUpperCase() + role.slice(1);
    this.emit('log', `${list.length === 1 ? list[0].short : `${list.length} brigades`} delegated: ${word}. Any order takes ${list.length === 1 ? 'it' : 'them'} back.`);
    return list.length;
  }

  /** Clear a unit's delegation (a direct order, or Undo). True if it was delegated. */
  reclaim(u) {
    if (!u || !u.delegate) return false;
    delete u.delegate;
    return true;
  }

  /** Undo: reclaim the delegated brigades among `units`; each halts where it stands, under the player's orders again. */
  undelegate(units) {
    const list = units.filter((u) => this.controls(u) && this.reclaim(u));
    for (const u of list) if (u.canTakeOrders()) u.orderHalt();
    if (list.length) this.emit('log', `${list.length === 1 ? list[0].short : `${list.length} brigades`}: back under your orders.`);
    return list.length;
  }

  /** Nearest enemy within 320 m, preferring those ahead of the line (horsemen also take, and prefer, a routing one). */
  chargeTarget(u) {
    let best = null, bestScore = Infinity;
    const rider = horsed(u);
    for (const e of this.units) {
      if (e.side === u.side || !e.alive || e.state === 'captured' || e.state === 'routing' && !rider) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d > 320) continue;
      const off = Math.abs(wrap(Math.atan2(e.x - u.x, e.z - u.z) - u.facing));
      const score = d * (off < 1.2 ? 1 : 2.2) * (rider && e.state === 'routing' ? 0.8 : 1);
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
    return (len / (SPEED.walk * RULES.marchSpeed)) * (this.scenario.practiceIntro ? 1 : clockRatioOf(this)) / 60;
  }

  /** Attack order: close to effective range with line of sight, halt and fire; follow a target that moves. */
  attackStep(u) {
    const o = u.order;
    const t = o.target;
    if (!t || !t.alive || t.state === 'routing' || !this.units.includes(t)) {
      u.stop();
      u.order = { type: 'hold' };
      if (this.controls(u) && !u.delegate) this.emit('log', `${u.short}: the enemy has gone; holding here.`); // AI and delegated attacks (ai.js) tell no one
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

  /**
   * A mounted charge follows its target (twice a second): the path is re-aimed at it, two seconds ahead of a fleeing
   * unit so the horsemen ride through it; a target that is gone or taken ends the charge.
   */
  pursueStep(u) {
    const t = u.order.target;
    if (!t) return;
    if (!t.alive || t.state === 'captured' || !this.units.includes(t)) { u.stop(); u.order = { type: 'hold' }; return; }
    if (!horsed(u) || u.melee || !u.follow.active) return;
    const lead = t.state === 'routing' ? 2 : 0, v = t.vehicle.velocity;
    const gx = t.x + v.x * lead, gz = t.z + v.z * lead;
    const end = u.path && u.path[u.path.length - 1];
    if (!end || Math.hypot(end[0] - gx, end[1] - gz) > 12) { u.setPath([[u.x, u.z], [gx, gz]]); u.order.dest = [gx, gz]; }
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
    const t = this.clockStart + this.simTime * clockRatioOf(this);
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
    const state = reinforcementState.get(this);
    if (state) {
      if (this.over || this.paused) return 0;
      scheduledReady(this, state);
      let remaining = Math.min(0.25, dt) * this.speed * RULES.battleSpeed;
      const before = this.simTime;
      while (remaining > 0 && !this.paused && !this.over) {
        const h = Math.min(0.05, remaining);
        remaining -= h;
        this.tick(h);
      }
      return this.simTime - before;
    }
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
    const state = reinforcementState.get(this);
    const guarded = state?.capture?.overrun === true;
    if (guarded && state.capture.tickActive) captureFail('nested battery-overrun tick is unsupported.');
    if (guarded) state.capture.tickActive = true;
    try {
    if (state) {
      if (this.over) return;
      scheduledReady(this, state);
      if (!Number.isFinite(h) || h < 0) throw new Error('Reinforcements: simulation delta must be finite and nonnegative.');
      h = Math.min(h, Math.max(0, state.plan.horizon - this.simTime));
      this.simTime = Math.min(state.plan.horizon, this.simTime + h);
      dispatchReinforcements(this, state, this.simTime);
      if (h === 0) { this.checkObjective(0, this.simTime === state.plan.horizon); return; }
    } else {
    this.simTime += h;
    }
    this.entities.update(h);
    for (const u of this.units) {
      if (!u.alive) continue;
      u.move(h, u.side === 'US' ? -this.terrain.half + 40 : this.terrain.half - 40, this.scenario.retreat?.[u.side] ?? null);
    }
    const pre = state?.capture ? captureCorridors(this) : null;
    if (pre) state.capture.pre = pre;
    const contacts = guarded && !this.paused ? [] : null;
    if (contacts) state.capture.contacts = contacts;
    try { this.combat.step(h, this.simTime); }
    finally { if (guarded) state.capture.contacts = null; }
    if (pre) commitSurrenders(this, state, pre, h, contacts);
    commandStep(this, h);
    this.ai.step(h);
    this.slowT -= h;
    if (this.slowT <= 0) {
      this.slowT = 0.5;
      for (const u of this.units) {
        if (!u.alive) continue;
        if (u.type === 'cavalry' && u.order.type === 'charge') this.pursueStep(u);
        if (!this.controls(u)) { if (u.order.type === 'attack') this.attackStep(u); continue; } // an AI attacker (ai.js) closing on a foe
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
      this.storesFeat(e);
      this.event(`${e.side === this.playerSide ? 'Your troops' : 'The enemy'} ${e.previous ? 'retake' : 'capture'} ${e.name}.`,
        null, 'capture', e);
    }
    this.xFactorStep();
    this.checkObjective(h, !!state && this.simTime === state.plan.horizon);
    } finally { if (guarded) state.capture.tickActive = false; }
  }

  /** Foragers (counting only): field stores taken go to the nearest unbroken formation of the taking side. */
  storesFeat(e) {
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (u.side !== e.side || !u.alive || u.state === 'routing') continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) featsOf(best).stores++;
  }

  /** An X-Factor brigade's first fight this battle (it fires, is under fire or in melee): its moment and a feed line, once. */
  xFactorStep() {
    for (const u of this.units) {
      const x = xFactorOf(u);
      if (!x || !u.alive || u.state === 'routing' || !(u.fireT > 0 || u.underFire > 0 || u.melee)) continue;
      const shown = xfactorShown.get(this) || new Set();
      if (shown.has(u)) continue;
      shown.add(u);
      xfactorShown.set(this, shown);
      const name = BADGE_BY_ID[x.id]?.name || 'X-Factor', who = u.side === this.playerSide ? '' : 'Enemy ';
      this.event(`${who}X-Factor: ${u.short} (${name}). Friends within 300 m share its edge.`, u, 'xfactor');
      try { this.effects?.xFactor?.(u, { label: `${who}X-Factor: ${name}` }); }
      catch (err) { console.warn('X-Factor moment unavailable:', err?.message ?? err); }
    }
  }

  /** Every unit's feat statistics so far: { [id]: { side, xp, menStart, ...FEAT_STATS } } (src/franchise/badges.js). */
  featReport() {
    const out = {};
    for (const u of this.units) out[u.id] = { side: u.side, xp: u.xp, menStart: u.menMax, ...featStats(u) };
    return out;
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

  /** Who holds the objective? Henry House Hill: Union wins by holding it at the end, or by breaking the defence; packs use packResult. */
  checkObjective(h, force = false) {
    this.objT = (this.objT || 0) - h;
    if (this.objT > 0 && !force) return;
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
    const t = this.clockStart + this.simTime * clockRatioOf(this);
    let result = null;
    if (this.scenario.practiceIntro) {
      if (effective('US') === 0 && !pendingInfantry(this, 'US') || this.holder !== 'US') result = { winner: 'CS' };
      else if (effective('CS') === 0 && !pendingInfantry(this, 'CS') || t >= this.clockEnd) result = { winner: 'US' };
    }
    else if (this.scenario.attacker) result = packResult(this, effective, t >= this.clockEnd || force);
    else if (effective('CS') === 0 && !pendingInfantry(this, 'CS')) result = { winner: 'US', why: 'The Confederate line on Henry House Hill has broken.' };
    else if (effective('US') === 0 && !pendingInfantry(this, 'US')) result = { winner: 'CS', why: 'Every Union brigade is in retreat.' };
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
  spawnUnit({ side, men = 1000, weapon, xp = 1, x, z, facing, type = 'infantry' }) {
    if (captureState(this)) captureFail('the prepared source roster is closed to sandbox spawns.');
    if (!Number.isInteger(xp) || xp < 1 || xp > 4) {
      this.emit('log', 'Choose Green, Trained, Veteran or Elite before placing a brigade.');
      return null;
    }
    if (weapon === undefined) weapon = defaultWeapon(type);
    if (!['infantry', 'cavalry'].includes(type) || (type === 'cavalry' && !CAVALRY_WEAPONS.includes(weapon))) {
      this.emit('log', 'Place infantry, or cavalry with carbines or revolvers.');
      return null;
    }
    const nFig = Math.round(men / minMenPerFigureOf(this)) + 6; // counted at the phase minimum, so look.menPerFigure never overfills the pools
    if (this.reserve[side] < nFig) {
      this.emit('log', `No room for another ${side === 'US' ? 'Union' : 'Confederate'} brigade of ${men} (the figure reserve is used up); remove one first.`);
      return null;
    }
    this.reserve[side] -= nFig;
    const n = ++this.spawned[side];
    const name = `${side === 'US' ? 'Union' : 'Confederate'} ${type === 'cavalry' ? 'cavalry' : 'brigade'} ${n}`;
    const face = Number.isFinite(facing) ? facing : this.ghostFacing(x, z, side, side === 'US' ? Math.PI / 2 : -Math.PI / 2);
    const def = {
      id: `sandbox-${side.toLowerCase()}-${n}`, side, type, name, short: name, commander: null, parent: 'Sandbox',
      regiments: [], men, weapon, xp, x, z, facing: face, sources: [], notes: 'Placed in the sandbox; not a historical unit.',
    };
    if (type === 'cavalry') ensureMounts(this, 2 * spawnReserve(minMenPerFigureOf(this)));
    const u = this.makeUnit(def, 500 + n * 13 + (side === 'CS' ? 7 : 0));
    u.reserveFigs = nFig;
    u.order = side === this.playerSide ? { type: 'hold' } : { type: 'hold', firm: true };
    this.units.push(u);
    this.emit('spawn', u);
    this.emit('log', `${name} placed: ${men} men with ${type === 'cavalry' ? (weapon === 'pistol' ? 'revolvers and sabres' : 'carbines') : `${weapon === 'rifled' ? 'rifled' : 'smoothbore'} muskets`}.`);
    return u;
  }

  removeUnit(u) {
    if (captureState(this)) captureFail('the prepared source roster is retained after surrender.');
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
    const state = reinforcementState.get(this);
    if (state) {
      if (this.over || this.paused) return this.simTime;
      scheduledReady(this, state);
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Reinforcements: fast-forward time must be finite and nonnegative.');
      let remaining = seconds;
      while (remaining > 0 && !this.over && !this.paused) {
        const h = Math.min(0.05, remaining);
        this.tick(h);
        remaining -= h;
      }
      if (this.over || this.paused) return this.simTime;
      for (const u of this.units) u.snapFigures();
      this.animate(0.05);
      return this.simTime;
    }
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
    commandState.get(this)?.flags.setView(camera);
  }

  /** Animate figures with the (speed-scaled) sim delta; refill and upload the instance buffers. */
  animate(simDt) {
    this.updateFigureView();
    this.pools.US.begin();
    this.pools.CS.begin();
    this.impostors.US.begin();
    this.impostors.CS.begin();
    this.halos.begin();
    commandState.get(this)?.flags.begin();
    cavalryState.get(this)?.mounts.begin();
    for (const u of this.units) u.animate(simDt, this.simTime);
    animateCommand(this, simDt);
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
    cavalryState.get(this)?.mounts.flush();
    this.gunPool.flush();
    commandState.get(this)?.flags.flush();
  }

  // ---------------------------------------------------------------------------------------------------
  // Command (see the header): generals, their selection and rings, forced hits for the sandbox and tests.
  /** The generals (runtime objects: id, side, name, rank, units, x, z, down, gone, ...), in data order. */
  get commanders() { return commandState.get(this)?.commanders ?? []; }

  /** The general selected (his ring shows), or null. Selecting a brigade clears it. */
  get selectedCommander() { return commandState.get(this)?.selected ?? null; }

  /** Select a general (by object or id): brigades are deselected and his rally radius shows. */
  selectCommander(c) {
    const st = commandState.get(this);
    const found = st && st.commanders.find((v) => v === c || v.id === c);
    this.select(null);
    if (found && !found.gone) st.selected = found;
    this.emit('select', null);
    return st?.selected ?? null;
  }

  /** Add a general during the battle (sandbox and tests): same fields as scenario.commanders. */
  addCommander(def) {
    const st = commandState.get(this);
    if (st.commanders.some((c) => c.id === def?.id)) commandFail('commander ids must be unique.');
    const c = makeCommander(def, st.commanders.length);
    st.commanders.push(c);
    return c;
  }

  /** The living generals whose rally radius covers u now. */
  generalsOver(u) {
    return this.commanders.filter((c) => !c.down && c.side === u.side && Math.hypot(c.x - u.x, c.z - u.z) <= COMMAND.radius);
  }

  /** Does u rally faster and lose morale slower now (a general's radius or its own commander)? */
  rallied(u) { return commandFactor(this, u) !== null; }

  /** Force a hit (sandbox and tests): `who` a general (object or id) or a Unit with a commander; kind wounded|killed. */
  commanderDown(who, kind = 'killed') {
    const st = commandState.get(this);
    const target = who instanceof Unit ? who : st?.commanders.find((c) => c === who || c.id === who);
    return !!target && commanderHit(this, target, kind);
  }

  /** Test hook: the command stream (rnd, draws), the flag pool and the rings. Not for game code. */
  commandState() { return commandState.get(this) ?? null; }

  /** Figure triangles submitted this frame (both sides, all levels of detail, with outlines). */
  figureTriangles() {
    return this.pools.US.trianglesDrawn() + this.pools.CS.trianglesDrawn();
  }

  /** Cavalry horses drawn this frame (0 with no cavalry on the field). */
  mountsDrawn() { return cavalryState.get(this)?.mounts.drawn ?? 0; }

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

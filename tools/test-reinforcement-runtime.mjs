// Real Game/Unit/Battery CPU observations. Flat diagnostic ground is not native/GPU evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Unit } from '../src/units/unit.js';
import { Battery } from '../src/units/battery.js';
import { prepareFieldScenario, FIELD_LIMITS } from '../src/sim/phase.js';
import { PLAN, setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { itemDef } from '../src/reward/data.js';

const copy = x => structuredClone(x);
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
const definition = (id, side = 'US', extra = {}) => ({ id, name: 'Fictional ' + id, short: id,
  side, type: 'infantry', men: 50, weapon: 'smooth', xp: 1, commander: null, regiments: [],
  x: side === 'US' ? -500 : 500, z: 0, facing: side === 'US' ? Math.PI / 2 : -Math.PI / 2,
  sources: [], notes: 'DIAGNOSTIC ONLY', ...extra });
const arrival = (id = 'arrival-us', side = 'US', extra = {}) => definition(id, side,
  { atSec: 1, entry: 'Fictional ' + side + ' edge', ...extra });
function fixture(rows = [arrival()]) {
  return { id: 'henry-hill', title: 'Fictional current-ground diagnostic', battle: 'DIAGNOSTIC ONLY',
    date: '1861-07-21', start: '14:00', end: '14:01',
    units: [definition('initial-us', 'US', { x: -600 }), definition('initial-cs', 'CS', { x: 600 })],
    sites: [], woods: [], objective: { name: 'Fictional point', x: -600, z: 0, r: 30 }, reinforcements: rows };
}
function real(s = fixture(), Type = Game) {
  setPlan(s);
  const game = new Type({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
  const events = [], spawns = [], alerts = [];
  game.on('event', e => events.push({ kind: e.kind, text: e.text, id: e.unit?.id ?? null, side: e.side }));
  game.on('spawn', u => spawns.push(u.id));
  game.on('alert', e => alerts.push({ ...e, ids: game.units.map(u => u.id) }));
  return { game, events, spawns, alerts, scenario: s };
}
function initialized(s = fixture(), Type = Game) {
  const f = real(s, Type); f.game.initializeReinforcements(); return f;
}
const rejects = fn => { try { fn(); return false; } catch (e) { return /^(Phase|Field|Reinforcements):/.test(e.message); } };
const caps = g => ({ US: g.pools.US.capacity, CS: g.pools.CS.capacity,
  fallenUS: g.fallen.US.capacity, fallenCS: g.fallen.CS.capacity,
  impostorUS: g.impostors.US.capacity, impostorCS: g.impostors.CS.capacity, halo: g.halos.capacity });
const ids = g => g.units.map(u => u.id);
const state = g => ({ time: g.simTime, over: g.over, paused: g.paused, units: g.units.map(u => ({ id: u.id,
  men: u.men, figures: u.figures, order: u.order })), reserve: g.reserve, spawned: g.spawned,
  captured: g.fieldCaptures.crates });

// Fixed actual parent f95ac81c Game oracle, captured BEFORE runtime edits on 2026-10-08.
// Expected values are never recomputed from a candidate.
const LEGACY_PARENT_GAME_SHA = 'f95ac81c905f82bb85bf36c08c7794e21ee11eed0600c98889d5a2f0ec3ca95b';
const LEGACY_FIXTURE_SHA = '8546b96bbdcd79a0be27d67b659bf94e3da9496dfabee946e44ce74230a0c701';
const LEGACY_HASHES = ['9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb',
  'c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e',
  'a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94',
  '2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74'];
function legacy(empty, Type) {
  const s = fixture([]); if (!empty) delete s.reinforcements;
  const absent = copy(s); delete absent.reinforcements;
  assert.equal(digest(absent), LEGACY_FIXTURE_SHA);
  const g = real(s, Type).game;
  const hashes = [digest(g.units.map(u => ({ id: u.id, figures: u.figures, officer: u.officer, order: u.order })))];
  let gameDraws = 0, unitDraws = 0;
  const gr = g.rnd, ur = g.units.map(u => u.rnd);
  g.rnd = () => { gameDraws++; return gr(); }; // Combat retains its original captured function.
  g.units.forEach((u, k) => { u.rnd = () => { unitDraws++; return ur[k](); }; });
  const capture = () => ({ time: g.simTime, over: g.over, paused: g.paused, holder: g.holder,
    objT: g.objT, slowT: g.slowT, aiT: g.ai.t, units: g.units.map(u => ({ id: u.id, x: u.x, z: u.z,
      facing: u.facing, goalFacing: u.goalFacing, men: u.men, morale: u.morale, fatigue: u.fatigue,
      ammo: u.ammo, state: u.state, order: u.order, figures: u.figures,
      vehiclePosition: [u.vehicle.position.x, u.vehicle.position.y, u.vehicle.position.z],
      vehicleVelocity: [u.vehicle.velocity.x, u.vehicle.velocity.y, u.vehicle.velocity.z] })), gameDraws, unitDraws });
  try {
    g.units[0].orderMove([[-600, 0], [-600, 100]], { endFacing: Math.PI / 2 });
    for (let n = 0; n < 8; n++) g.tick(.05);
    hashes.push(digest(capture())); g.paused = true; g.fastForward(.101);
    hashes.push(digest(capture())); g.over = true; g.fastForward(0); hashes.push(digest(capture()));
    return { hashes, time: g.simTime, scenarioExact: g.scenario === s,
      definitionsExact: g.units.every((u, k) => u.def === s.units[k]), gameDraws, unitDraws,
      nextGame: gr(), nextUnits: ur.map(r => r()) };
  } finally { g.rnd = gr; g.units.forEach((u, k) => { u.rnd = ur[k]; }); }
}

function watchRng(g, fn) {
  const game = g.rnd, combat = g.combat.rnd, units = g.units.map(u => ({ u, rnd: u.rnd }));
  const observed = { gameDraws: 0, combatDraws: 0, unitDraws: 0, unitCount: units.length,
    originalGameCombatShared: game === combat, restored: false };
  g.rnd = () => { observed.gameDraws++; return game(); };
  g.combat.rnd = () => { observed.combatDraws++; return combat(); };
  for (const {u, rnd} of units) u.rnd = () => { observed.unitDraws++; return rnd(); };
  try { fn(); } finally {
    g.rnd = game; g.combat.rnd = combat; for (const {u, rnd} of units) u.rnd = rnd;
    observed.restored = g.rnd === game && g.combat.rnd === combat && units.every(({u, rnd}) => u.rnd === rnd);
  }
  return observed;
}
function verifyNoRng(r) {
  assert.deepEqual(r, { gameDraws: 0, combatDraws: 0, unitDraws: 0,
    unitCount: r.unitCount, originalGameCombatShared: true, restored: true });
}
const cases = [
  ['scheduled-validation-before-allocation', Type => {
    let adds = 0, getterCalls = 0;
    const scene = new Scene(); scene.add = () => { adds++; };
    const bad = fixture(); Object.defineProperty(bad, 'reinforcements', { enumerable: true,
      get() { getterCalls++; return []; } });
    const errors = [bad, { ...fixture(), reinforcements: null }, fixture([arrival('initial-us')]),
      fixture([arrival('bad-time', 'US', { atSec: 16 })]), Object.create(fixture())]
      .map(s => rejects(() => new Type({ scene, terrain, scenario: s, world: {}, effects })));
    return { errors, adds, getterCalls };
  }],
  ['combined-field-admission', () => {
    const check = s => prepareFieldScenario(s, 'henry-hill');
    const valid = [fixture(Array.from({ length: 8 }, (_, k) => arrival('extra-' + k, 'US', { men: 1 }))),
      fixture([arrival('men-bound', 'US', { men: FIELD_LIMITS.men - 100 })]),
      fixture([arrival('guns-bound', 'CS', { type: 'artillery', men: 96, guns: 24, weapon: 'parrott' })]),
      fixture([arrival('figures-bound', 'CS', { type: 'artillery', men: 11768, guns: 1, weapon: 'parrott' })])];
    const oversized = valid.map(copy); oversized[0].reinforcements.push(arrival('eleventh'));
    oversized[1].reinforcements[0].men++; oversized[2].reinforcements[0].guns++;
    oversized[3].reinforcements[0].men += 4;
    const opening = fixture(); opening.opening = [{ id: 'arrival-us', points: [[0, 0], [1, 1]] }];
    return { valid: valid.map(s => !!check(s)), rejected: oversized.map(s => rejects(() => check(s))),
      openingRejected: rejects(() => check(opening)), limits: { ...FIELD_LIMITS } };
  }],
  ['future-field-metadata', () => {
    const bound = fixture([arrival('bound', 'US', { x: 10000, z: -10000 })]);
    const changes = [u => { u.x = 10000.01; }, u => { u.xp = 5; }, u => { u.morale = 101; },
      u => { u.commander = { name: '' }; }, u => { u.guns = 1; }];
    return { valid: !!prepareFieldScenario(bound, 'henry-hill'), rejected: changes.map(edit => {
      const s = fixture(); edit(s.reinforcements[0]); return rejects(() => prepareFieldScenario(s, 'henry-hill'));
    }) };
  }],
  ['legacy-empty-and-rng', Type => ({ absent: legacy(false, Type), empty: legacy(true, Type) })],
  ['initial-definition-identity', Type => {
    const s = fixture(), bytes = digest(s), f = initialized(s, Type), g = f.game;
    g.tick(1);
    return { scenarioExact: g.scenario === s, definitionsExact: g.units.slice(0, 2).every((u, k) => u.def === s.units[k]),
      originalUnchanged: digest(s) === bytes, seedsExact: digest(g.units[0].figures) === digest(new Unit(s.units[0], {}, terrain, 100).figures),
      futureDetached: g.units[2].def !== s.reinforcements[0], futureContentExact: digest(g.units[2].def) === digest(s.reinforcements[0]) };
  }],
  ['combined-figure-pools', Type => {
    const s = fixture([arrival('tiny-us', 'US', { men: 2 }), arrival('tiny-cs', 'CS', { men: 3 }),
      arrival('tiny-us-guns', 'US', { type: 'artillery', men: 6, guns: 1, weapon: 'parrott' }),
      arrival('tiny-cs-guns', 'CS', { type: 'artillery', men: 5, guns: 1, weapon: 'parrott' })]);
    return { capacities: caps(real(s, Type).game) };
  }],
  ['combined-mounted-pools', Type => {
    const g = real(fixture([arrival(), arrival('cs-guns', 'CS', { type: 'artillery', men: 16, guns: 2, weapon: 'parrott' })]), Type).game;
    return { horses: g.horses.capacity, USguns: g.gunPool.guns.US.instanceMatrix.count,
      CSguns: g.gunPool.guns.CS.instanceMatrix.count, limbers: g.gunPool.limbers.instanceMatrix.count };
  }],
  ['sandbox-conservation', Type => {
    const f = initialized(fixture([arrival('now', 'US', { atSec: 0 })]), Type), g = f.game;
    const afterArrival = { reserve: { ...g.reserve }, spawned: { ...g.spawned } };
    const sandbox = g.spawnUnit({ side: 'US', men: 100, x: -1000, z: 0 });
    const consumed = g.reserve.US; g.removeUnit(sandbox);
    return { afterArrival, consumed, finalReserve: { ...g.reserve }, finalSpawned: { ...g.spawned }, realSandbox: sandbox.id };
  }],
  ['init-required-before-advance', Type => {
    const f = real(fixture(), Type), g = f.game, before = digest(state(g));
    let rejected; const rng = watchRng(g, () => {
      rejected = [() => g.tick(.05), () => g.step(.05), () => g.fastForward(.05)].map(rejects);
    });
    return { rejected, unchanged: digest(state(g)) === before, spawns: f.spawns, rng };
  }],
  ['zero-listeners-and-idempotency', Type => {
    RULES.autoPause = true;
    const f = real(fixture([arrival('zero-a', 'US', { atSec: 0 }), arrival('zero-b', 'CS', { atSec: 0 })]), Type);
    const constructorCount = f.game.units.length;
    f.game.initializeReinforcements(); const before = digest({ ids: ids(f.game), events: f.events, alerts: f.alerts });
    f.game.initializeReinforcements();
    return { constructorCount, ids: ids(f.game), spawns: f.spawns, kinds: f.events.map(e => e.kind),
      paused: f.game.paused, alerts: f.alerts, repeatedExact: before === digest({ ids: ids(f.game), events: f.events, alerts: f.alerts }) };
  }],
  ['immutable-future-equipment', Type => {
    const equipment = { uid: 'runtime-fixture-issue', itemId: 'm1842', tier: itemDef('m1842').tier,
      conditionId: 'serviceable', from: 'Fictional issue', source: 'capture' };
    const d = arrival('issued', 'US', { equipment, sources: [{ status: 'Inferred', note: 'DIAGNOSTIC ONLY' }] });
    const s = fixture([d]), expected = copy(d), f = initialized(s, Type);
    d.men = 1; d.equipment.from = 'Caller changed'; d.sources[0].status = 'Caller changed'; f.game.tick(1);
    const u = f.game.units.find(x => x.id === 'issued');
    return { exact: digest(u.def) === digest(expected), frozen: Object.isFrozen(u.def) && Object.isFrozen(u.def.equipment)
      && Object.isFrozen(u.def.sources[0]), equipment: u.equipment, profileItem: u.equipmentProfile.item, expectedEquipment: expected.equipment };
  }],
  ['shared-live-array', Type => {
    const f = initialized(fixture([arrival('new-us', 'US', { atSec: 0, x: -100 }),
      arrival('new-cs', 'CS', { atSec: 0, x: 0, z: 100 }),
      arrival('new-guns', 'CS', { atSec: 0, type: 'artillery', men: 16, guns: 2, weapon: 'parrott' })]), Type), g = f.game;
    const enemy = g.units.find(u => u.id === 'new-cs'); g.ai.t = 0; g.ai.step(0);
    const nearest = g.units.filter(u => u.side !== enemy.side).sort((a, b) => Math.hypot(a.x - enemy.x, a.z - enemy.z) - Math.hypot(b.x - enemy.x, b.z - enemy.z))[0];
    return { combatSame: g.combat.units === g.units, aiSame: g.ai.game === g, allReal: g.units.every(u => u instanceof Unit),
      batteryReal: g.units.find(u => u.id === 'new-guns') instanceof Battery,
      entitiesPresent: g.units.every(u => g.entities.entities.includes(u.vehicle)), spawns: f.spawns,
      aiActual: enemy.goalFacing, aiExpected: Math.atan2(nearest.x - enemy.x, nearest.z - enemy.z), aiTimer: g.ai.t };
  }],
  ['chronological-fractional-ties', Type => {
    const f = initialized(fixture([arrival('early', 'US', { atSec: .1 }),
      arrival('tie-a', 'US', { atSec: .3, noticeSec: .1 }), arrival('tie-b', 'CS', { atSec: .3, noticeSec: .1 })]), Type);
    RULES.autoPause = true; f.game.tick(.35);
    return { events: f.events.map(e => e.kind + ':' + (e.id || e.text.split(' ')[0])), spawns: f.spawns,
      alerts: f.alerts, time: f.game.simTime, units: ids(f.game) };
  }],
  ['cursor-reset-and-no-replay', Type => {
    const s = fixture([arrival('first', 'US', { atSec: .1 }), arrival('after-density', 'US', { atSec: .3, men: 100 })]);
    const f = initialized(s, Type), g = f.game, beforeCaps = caps(g);
    g.tick(.1); g.tick(0); g.initializeReinforcements(); g.paused = true; g.step(.2); g.speed = 4;
    settings.set('look.menPerFigure', 5); settings.set('look.formationSpacing', 1.5);
    LOOK.figureStyle = 'baked'; // No animate/load call: rendered style proof belongs to the later native UI slice.
    g.paused = false; g.tick(.2); LOOK.figureStyle = 'rigged';
    const late = g.units.find(u => u.id === 'after-density');
    const fresh = initialized(copy(s), Type); fresh.game.tick(.3);
    return { ids: ids(g), spawns: f.spawns, density: late.menPerFigure, figureCount: late.figures.length,
      lateSpacing: late.figures.map(v => [v.lx, v.lz]), referenceSpacing: new Unit(late.def, {}, terrain, 103).figures.map(v => [v.lx, v.lz]),
      capacitiesExact: digest(caps(g)) === digest(beforeCaps), freshIds: ids(fresh.game), freshSpawns: fresh.spawns };
  }],
  ['pause-speed-and-fastforward', Type => {
    const f = initialized(fixture([arrival('later', 'US', { atSec: 10 })]), Type), g = f.game;
    g.paused = true; const pausedDelta = g.step(.1), pausedTime = g.simTime;
    g.paused = false; g.speed = 4; RULES.battleSpeed = 2; const delta = g.step(.1);
    const before = g.simTime; g.fastForward(.101); const afterRegularFF = g.simTime;
    const tinyBefore = g.simTime; g.fastForward(1e-7); const tinyFFDelta = g.simTime - tinyBefore;
    const tinyStepDelta = g.step(1e-7); // Current speed4 * battleSpeed2, distinct from FF simulation seconds.
    let animations = 0; const animate = g.animate; g.animate = () => { animations++; };
    g.paused = true; g.fastForward(0); g.fastForward(.1); g.animate = animate;
    return { pausedDelta, pausedTime, delta, timeBeforeFF: before, afterFF: afterRegularFF,
      tinyFFDelta, tinyStepDelta, animations, spawns: f.spawns };
  }],
  ['arrival-orders-and-selection', Type => {
    const f = initialized(fixture([arrival('own', 'US', { atSec: 0 }), arrival('enemy', 'CS', { atSec: 0 })]), Type), g = f.game;
    return { ownOrder: g.units[2].order, enemyOrder: g.units[3].order, selected: g.selected,
      selection: g.selection.length, orders: g.orders || 0, reserve: { ...g.reserve } };
  }],
  ['pending-infantry-elimination', Type => {
    const observe = (side, artillery, terminal = null) => {
      const d = arrival('pending', side, artillery ? { type: 'artillery', guns: 1, weapon: 'parrott', men: 16 } : {});
      const f = initialized(fixture([d]), Type), g = f.game;
      g.units.filter(u => u.side === side).forEach(u => { u.men = 0; }); g.objT = 0; g.checkObjective(0);
      const before = g.over; if (!before) { g.tick(1); g.objT = 0; g.checkObjective(0); }
      const after = g.over; let expired = null;
      if (terminal && !g.over) {
        const pending = g.units.find(u => u.id === 'pending');
        if (terminal === 'routing') pending.state = 'routing'; else pending.men = 0;
        g.objT = 0; g.checkObjective(0);
        expired = { over: g.over, winner: g.result?.winner || null, state: pending.state, alive: pending.alive };
      }
      return { before, after, winner: g.result?.winner || null, ids: ids(g), expired };
    };
    return { USinf: observe('US', false), CSinf: observe('CS', false), USart: observe('US', true), CSart: observe('CS', true),
      USrouted: observe('US', false, 'routing'), CSrouted: observe('CS', false, 'routing'),
      USdead: observe('US', false, 'dead'), CSdead: observe('CS', false, 'dead') };
  }],
  ['practice-result-policy', Type => {
    const make = () => { const s = fixture([arrival('later', 'US', { atSec: 10 })]); s.practiceIntro = true; return s; };
    const lost = initialized(make(), Type); lost.game.units[0].vehicle.position.x = -1000; lost.game.objT = 0; lost.game.checkObjective(0);
    const held = initialized(make(), Type); held.game.simTime = 15; held.game.objT = 0; held.game.checkObjective(0);
    return { loss: { over: lost.game.over, winner: lost.game.result?.winner, why: lost.game.result?.why },
      deadline: { over: held.game.over, winner: held.game.result?.winner, why: held.game.result?.why } };
  }],
  ['forced-horizon-deadline', Type => {
    const f = initialized(fixture([arrival('horizon', 'US', { atSec: 15 })]), Type), g = f.game;
    // Reproduce the retained old-Game throttle counterexample exactly, rather than compensating UI time.
    g.simTime = 14.95; g.objT = 1; RULES.autoPause = true; g.tick(.05);
    return { over: g.over, time: g.simTime, paused: g.paused, winner: g.result?.winner,
      kinds: f.events.map(e => e.kind), spawns: f.spawns, alerts: f.alerts.length };
  }],
  ['terminal-clock-and-delta', Type => {
    const f = initialized(fixture([arrival('horizon', 'US', { atSec: 15 })]), Type), g = f.game;
    g.simTime = 14.95; g.objT = 1; const delta = g.step(.2); const before = digest({ state: state(g), events: f.events, spawns: f.spawns });
    let animations = 0; const animate = g.animate; g.animate = () => { animations++; };
    let postDelta; const rng = watchRng(g, () => {
      postDelta = g.step(.2); g.tick(1); g.fastForward(1); g.fastForward(0);
    }); g.animate = animate;
    return { delta, time: g.simTime, over: g.over, postDelta, animations, rng,
      unchanged: before === digest({ state: state(g), events: f.events, spawns: f.spawns }) };
  }],
];

const verify = [
  r => { assert.ok(r.errors.every(Boolean)); assert.equal(r.errors.length, 5); assert.equal(r.adds, 0); assert.equal(r.getterCalls, 0); },
  r => { assert.deepEqual(r.valid, [true, true, true, true]); assert.deepEqual(r.rejected, [true, true, true, true]); assert.equal(r.openingRejected, true); assert.deepEqual(r.limits, FIELD_LIMITS); },
  r => { assert.equal(r.valid, true); assert.deepEqual(r.rejected, [true, true, true, true, true]); },
  r => { for (const x of [r.absent, r.empty]) { assert.deepEqual(x.hashes, LEGACY_HASHES); assert.equal(x.time, .5499999999999999); assert.equal(x.scenarioExact, true); assert.equal(x.definitionsExact, true); assert.equal(x.gameDraws, 0); assert.equal(x.unitDraws, 0); assert.equal(x.nextGame, .08001301996409893); assert.deepEqual(x.nextUnits, [.9849907697644085, .7462286006193608]); } },
  r => { for (const key of ['scenarioExact', 'definitionsExact', 'originalUnchanged', 'seedsExact', 'futureDetached', 'futureContentExact']) assert.equal(r[key], true, key); },
  r => assert.deepEqual(r.capacities, { US: 2130, CS: 2130, fallenUS: 2130, fallenCS: 2130, impostorUS: 2130, impostorCS: 2130, halo: 4260 }),
  r => assert.deepEqual(r, { horses: 6, USguns: 1, CSguns: 2, limbers: 2 }),
  r => { assert.deepEqual(r.afterArrival, { reserve: { US: 2100, CS: 2100 }, spawned: { US: 0, CS: 0 } }); assert.equal(r.consumed, 2074); assert.deepEqual(r.finalReserve, { US: 2100, CS: 2100 }); assert.deepEqual(r.finalSpawned, { US: 1, CS: 0 }); assert.equal(r.realSandbox, 'sandbox-us-1'); },
  r => { assert.deepEqual(r.rejected, [true, true, true]); assert.equal(r.unchanged, true); assert.deepEqual(r.spawns, []); verifyNoRng(r.rng); assert.equal(r.rng.unitCount, 2); },
  r => { assert.equal(r.constructorCount, 2); assert.deepEqual(r.ids, ['initial-us', 'initial-cs', 'zero-a', 'zero-b']); assert.deepEqual(r.spawns, ['zero-a', 'zero-b']); assert.deepEqual(r.kinds, ['reinforcement-notice', 'reinforcement-notice', 'reinforcement', 'reinforcement']); assert.equal(r.paused, true); assert.equal(r.alerts.length, 1); assert.deepEqual(r.alerts[0].ids, r.ids); assert.equal(r.repeatedExact, true); },
  r => { assert.equal(r.exact, true); assert.equal(r.frozen, true); assert.deepEqual(r.equipment, r.expectedEquipment); assert.deepEqual(r.profileItem, r.expectedEquipment); },
  r => { for (const k of ['combatSame', 'aiSame', 'allReal', 'batteryReal', 'entitiesPresent']) assert.equal(r[k], true, k); assert.deepEqual(r.spawns, ['new-us', 'new-cs', 'new-guns']); assert.equal(r.aiActual, r.aiExpected); assert.equal(r.aiTimer, .5); },
  r => { assert.deepEqual(r.events, ['reinforcement-notice:early', 'reinforcement:early', 'reinforcement-notice:tie-a', 'reinforcement-notice:tie-b', 'reinforcement:tie-a', 'reinforcement:tie-b']); assert.deepEqual(r.spawns, ['early', 'tie-a', 'tie-b']); assert.equal(r.alerts.length, 1); assert.deepEqual(r.alerts[0].ids, r.units); assert.equal(r.alerts[0].text, 'early, tie-a, tie-b arrived.'); assert.equal(r.time, .35); },
  r => { assert.deepEqual(r.ids, ['initial-us', 'initial-cs', 'first', 'after-density']); assert.deepEqual(r.spawns, ['first', 'after-density']); assert.equal(r.density, 5); assert.equal(r.figureCount, 20); assert.deepEqual(r.lateSpacing, r.referenceSpacing); assert.equal(r.capacitiesExact, true); assert.deepEqual(r.freshIds, r.ids); assert.deepEqual(r.freshSpawns, r.spawns); },
  r => { assert.equal(r.pausedDelta, 0); assert.equal(r.pausedTime, 0); assert.ok(Math.abs(r.delta - .8) < 1e-12); assert.ok(Math.abs(r.afterFF - r.timeBeforeFF - .101) < 1e-12); assert.ok(Math.abs(r.tinyFFDelta - 1e-7) < 1e-12); assert.ok(Math.abs(r.tinyStepDelta - 8e-7) < 1e-12); assert.equal(r.animations, 0); assert.deepEqual(r.spawns, []); },
  r => { assert.deepEqual(r.ownOrder, { type: 'hold' }); assert.deepEqual(r.enemyOrder, { type: 'hold', firm: true }); assert.equal(r.selected, null); assert.equal(r.selection, 0); assert.equal(r.orders, 0); assert.deepEqual(r.reserve, { US: 2100, CS: 2100 }); },
  r => { for (const x of [r.USinf, r.CSinf]) { assert.equal(x.before, false); assert.equal(x.after, false); assert.equal(x.ids.at(-1), 'pending'); } assert.equal(r.USart.before, true); assert.equal(r.USart.winner, 'CS'); assert.equal(r.CSart.before, true); assert.equal(r.CSart.winner, 'US');
    for (const side of ['US', 'CS']) for (const kind of ['routed', 'dead']) {
      const x = r[side + kind]; assert.equal(x.before, false); assert.equal(x.after, false);
      assert.equal(x.expired.over, true); assert.equal(x.expired.winner, side === 'US' ? 'CS' : 'US');
      if (kind === 'routed') assert.equal(x.expired.state, 'routing'); else assert.equal(x.expired.alive, false);
    } },
  r => { assert.equal(r.loss.over, true); assert.equal(r.loss.winner, 'CS'); assert.equal(r.loss.why, 'Your brigades lost the practice ground. Survivors and any stores still held return for the issue.'); assert.equal(r.deadline.over, true); assert.equal(r.deadline.winner, 'US'); assert.equal(r.deadline.why, 'Your brigades held the practice stores. The quartermaster is ready with your first issue.'); },
  r => { assert.equal(r.over, true); assert.equal(r.time, 15); assert.equal(r.paused, true); assert.equal(r.winner, 'US'); assert.deepEqual(r.kinds, ['reinforcement-notice', 'reinforcement', 'result']); assert.deepEqual(r.spawns, ['horizon']); assert.equal(r.alerts, 1); },
  r => { assert.ok(Math.abs(r.delta - .05) < 1e-12); assert.equal(r.time, 15); assert.equal(r.over, true); assert.equal(r.postDelta, 0); assert.equal(r.animations, 0); assert.equal(r.unchanged, true); verifyNoRng(r.rng); assert.equal(r.rng.unitCount, 3); },
];
export const RUNTIME_CATEGORIES = cases.map(([name]) => name);
function isolated(fn) {
  const rules = { ...RULES }, look = { ...LOOK }, plan = { ...PLAN };
  const density = settings.get('look.menPerFigure'), spacing = settings.get('look.formationSpacing');
  try { RULES.autoPause = false; RULES.battleSpeed = 1; settings.set('look.menPerFigure', 10);
    settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged'; return fn(); }
  finally { settings.set('look.menPerFigure', density); settings.set('look.formationSpacing', spacing);
    Object.assign(RULES, rules); Object.assign(LOOK, look); Object.assign(PLAN, plan);
    assert.deepEqual(RULES, rules); assert.deepEqual(LOOK, look);
    for (const key of Object.keys(plan)) assert.equal(PLAN[key], plan[key]); }
}
export function runtimeUnit(Type = Game) {
  assert.equal(cases.length, 20); assert.equal(verify.length, 20);
  return cases.map(([category, run], k) => { const observed = isolated(() => run(Type));
    verify[k](observed); return { category, observed }; });
}
function intended(category, observed, edit) {
  const k = RUNTIME_CATEGORIES.indexOf(category), changed = copy(observed); edit(changed);
  let error; try { verify[k](changed); } catch (e) { error = e; }
  assert.equal(error?.code, 'ERR_ASSERTION', category + ' must reject via its intended assertion');
  return { category, code: error.code, message: error.message };
}
function controls(actual) {
  const edits = [r => { r.adds = 1; }, r => { r.rejected[0] = false; }, r => { r.rejected[0] = false; },
    r => { r.absent.hashes[0] = 'wrong'; }, r => { r.scenarioExact = false; }, r => { r.capacities.US--; },
    r => { r.CSguns = 1; }, r => { r.afterArrival.reserve.US--; }, r => { r.rng.combatDraws = 1; },
    r => { r.spawns.push('zero-a'); }, r => { r.equipment.uid = 'wrong'; }, r => { r.combatSame = false; },
    r => { r.events.reverse(); }, r => { r.spawns.push('first'); }, r => { r.animations = 1; },
    r => { r.ownOrder.type = 'move'; }, r => { r.USrouted.expired.over = false; }, r => { r.loss.winner = 'US'; },
    r => { r.over = false; }, r => { r.rng.unitDraws = 1; }];
  const rows = actual.map((row, k) => ({ ...intended(row.category, row.observed, edits[k]), control: row.category, kind: 'actual-record-semantic' }));
  for (const [name, category, edit] of [
    ['combined-figure-pools-floor', 'combined-figure-pools', r => { r.capacities.US = 2129; r.capacities.CS = 2129; }],
    ['combined-figure-pools-ceil', 'combined-figure-pools', r => { r.capacities.US = 2131; r.capacities.CS = 2131; }],
    ['combined-field-admission-omit-future-men', 'combined-field-admission', r => { r.rejected[1] = false; }],
    ['combined-field-admission-omit-future-guns', 'combined-field-admission', r => { r.rejected[2] = false; }],
  ]) rows.push({ ...intended(category, actual.find(x => x.category === category).observed, edit), control: name, kind: 'actual-record-semantic' });
  class Duplicate extends Game {
    tick(h) { super.tick(h); if (!this.over && this.units.some(u => u.id === 'first')) {
      const u = this.makeUnit(copy(this.scenario.reinforcements[0]), 777); this.units.push(u); this.emit('spawn', u);
    } }
  }
  class SkipDeadline extends Game { checkObjective(h, force) { if (!force) super.checkObjective(h, force); } }
  for (const [category, Type, suffix] of [['cursor-reset-and-no-replay', Duplicate, 'duplicate'],
    ['forced-horizon-deadline', SkipDeadline, 'skipped']]) {
    const k = RUNTIME_CATEGORIES.indexOf(category); const observed = isolated(() => cases[k][1](Type));
    let error; try { verify[k](observed); } catch (e) { error = e; }
    assert.equal(error?.code, 'ERR_ASSERTION', category + ' actual faulty Game must fail intended assertion');
    rows.push({ category, control: category + '-' + suffix, kind: 'executed-game-subclass', code: error.code,
      message: error.message, observed });
  }
  assert.equal(rows.length, 26); return rows;
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  try {
    const actual = runtimeUnit();
    console.log('RUNTIME ACTUAL ' + JSON.stringify({ categories: actual, scope: 'flat realGame CPU only', legacyOracle: { parentGameSha256: LEGACY_PARENT_GAME_SHA, fixtureSha256: LEGACY_FIXTURE_SHA, capturedBeforeEdit: true }, native: false }));
    console.log('REINFORCEMENT RUNTIME OK (20/20)');
    if (process.argv.includes('--prove-fail')) {
      const rows = controls(actual); for (const row of rows) console.log('CAUGHT ' + row.control);
      console.log('RUNTIME CONTROLS ' + JSON.stringify(rows));
      console.log('REINFORCEMENT RUNTIME CONTROLS OK (26/26; 24 semantic readers, 2 executed Game faults)');
    }
  } catch (e) { console.error('REINFORCEMENT RUNTIME FAILED: ' + e.message); process.exitCode = 1; }
}

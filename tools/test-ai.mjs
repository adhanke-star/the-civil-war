// CPU check: AI roles (src/sim/ai.js attack / reserve / hold, validated in src/sim/phase.js, driven by src/game.js).
// Fixtures are built here from assets/scenarios/henry-hill.json on flat ground; no pack file ships for this test.
// `node tools/test-ai.mjs` prints AI OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Ai } from '../src/sim/ai.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { preparePhase, prepareFieldScenario, prepareReinforcementTimeline } from '../src/sim/phase.js';
import { henryHillRun } from './test-packs.mjs';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
// The Henry Hill oracle is owned by tools/test-packs.mjs (observed on the pre-pack parent); read it, never restate it.
const ORACLE = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
// The same 16 s Henry Hill run, every formation's place, facing and order: observed on the parent 8468af1 (before
// AI roles, and before the friendly-fire mask), never recomputed from the candidate. Compared with the mask off.
const PLACES = [["franklin",-330,330,1.25,"hold",false,false],["willcox",-300,120,1.45,"hold",false,false],["sherman",40,-90,1,"hold",false,false],["ricketts",-250,230,1.3,"hold",false,false],["griffin",-200,60,1.6085,"hold",false,false],["jackson",375,480,-2.6103,"hold",true,false],["bee",370,230,-2.3408,"hold",true,false],["hampton",330,40,-1.9,"hold",true,false],["rockbridge",290,470,-2.7217,"hold",true,false],["staunton",300,350,-2.6079,"hold",true,false]];
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const O = HH.objective, OBJ = [O.x, O.z], FAR = { x: -1500, z: -1500 };
const API = { transform: s => s, patch: {}, preparePhase, prepareFieldScenario };

/** henryHillRun's battle (tools/test-packs.mjs) traced by place: [id, x, z, facing, order, firm, marching]. */
function henryHillPlaces(api) {
  const s = api.transform(copy(HH)); s.end = '14:01';
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
  g.fastForward(16);
  return g.units.map(u => [u.id, +u.x.toFixed(3), +u.z.toFixed(3), +u.facing.toFixed(4), u.order.type, !!u.order.firm, u.follow.active]);
}

/** A fictional phase on the Henry Hill ground: only the listed roster ids, each with its overrides. */
function scenario(api, roster, extra = {}) {
  const s = copy(HH);
  s.id = 'test-ai'; s.title = 'Fictional AI test (test only)';
  s.units = Object.entries(roster).map(([id, over]) => ({ ...copy(HH.units.find(u => u.id === id)), ...over }));
  return api.transform(Object.assign(s, extra));
}
function game(api, roster, extra) {
  const s = api.prepareFieldScenario(scenario(api, roster, extra), 'pack');
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
  Object.assign(g.ai, api.patch);
  g.initializeReinforcements();
  return g;
}
const unit = (g, id) => g.units.find(u => u.id === id);
const dist = (a, b) => Math.hypot(a.x - (b.x ?? b[0]), a.z - (b.z ?? b[1]));
const run = (g, seconds, each) => { for (let k = Math.round(seconds / 0.05); k > 0; k--) { g.tick(0.05); if (each && each()) return true; } return false; };
const settled = (...us) => us.every(u => !u.follow.active && !u.engaged && u.order.type === 'hold');
const ATTACK = { role: 'attack' };

export const AI_CHECKS = [
  ['attack-objective', async api => {
    const g = game(api, { jackson: { x: 900, z: 500, ai: ATTACK }, franklin: FAR });
    const j = unit(g, 'jackson');
    run(g, 400, () => dist(j, OBJ) < O.r && settled(j));
    assert.ok(dist(j, OBJ) < O.r, `attack-objective: ends inside the objective radius (${dist(j, OBJ).toFixed(0)} m from its centre)`);
    run(g, 5);
    assert.ok(settled(j) && j.order.firm === true, 'attack-objective: holds firm once there ' + JSON.stringify(j.order));
    assert.ok(dist(j, OBJ) < O.r, 'attack-objective: stays inside');
  }],
  ['attack-at', async api => {
    const g = game(api, { jackson: { x: 900, z: 500, ai: { role: 'attack', at: '14:02' } }, franklin: FAR });
    const j = unit(g, 'jackson');
    run(g, 29);
    assert.ok(!j.follow.active && dist(j, [900, 500]) < 2, `attack-at: waits until 14:02 (moved ${dist(j, [900, 500]).toFixed(1)} m by ${g.clockText().time})`);
    run(g, 3);
    assert.ok(j.follow.active && j.order.type === 'move', `attack-at: marches after 14:02 (${g.clockText().time}, ${j.order.type})`);
    run(g, 20);
    assert.ok(dist(j, [900, 500]) > 50 && dist(j, OBJ) < 900 - 110 - 40, 'attack-at: advances on the objective');
  }],
  ['reserve-commits', async api => {
    const g = game(api, { bee: { x: 900, z: 800, ai: { role: 'reserve' } }, franklin: FAR });
    const b = unit(g, 'bee'), f = unit(g, 'franklin');
    run(g, 20);
    assert.ok(!b.follow.active && dist(b, [900, 800]) < 2, 'reserve-commits: holds while no enemy is near');
    f.vehicle.position.set(900 - 330, 0, 800); // within 350 m, beyond its rifles' range
    run(g, 1.5);
    assert.ok(b.follow.active && b.order.type === 'move', `reserve-commits: commits when an enemy is within 350 m (${b.order.type})`);
    const h = game(api, { bee: { x: 900, z: 800, ai: { role: 'reserve' } }, franklin: { x: O.x, z: O.z } });
    const hb = unit(h, 'bee');
    run(h, 0.5);
    assert.ok(!hb.follow.active, 'reserve-commits: not before the objective holder is known');
    run(h, 3);
    assert.ok(h.holder === 'US' && hb.follow.active && hb.order.type === 'move', `reserve-commits: commits when the enemy holds the objective (${h.holder})`);
  }],
  ['march-and-fight', async api => {
    const g = game(api, { jackson: { x: 900, z: 500, ai: ATTACK }, willcox: { x: 500, z: 500, men: 400, facing: Math.PI / 2 }, franklin: FAR });
    const j = unit(g, 'jackson'), w = unit(g, 'willcox');
    let halted = false, fired = false;
    run(g, 600, () => {
      const holding = !j.follow.active && !j.engaged && !j.melee && j.order.type === 'hold' && w.state !== 'routing';
      if (holding && j.target === w && dist(j, [900, 500]) > 50 && dist(j, OBJ) > O.r) halted = true;
      if (halted && holding && w.men < 400) fired = true;
      return halted && w.state === 'routing' && dist(j, OBJ) < O.r && settled(j);
    });
    assert.ok(halted, 'march-and-fight: halts short of the objective to fire on the blocking enemy');
    assert.ok(fired, 'march-and-fight: fires on it while halted');
    assert.ok(dist(j, OBJ) < O.r && settled(j), `march-and-fight: continues to the objective once the way is clear (${dist(j, OBJ).toFixed(0)} m, ${j.order.type}, blocker ${w.state})`);
  }],
  ['spread', async api => {
    const g = game(api, { jackson: { x: 900, z: 450, ai: ATTACK }, bee: { x: 900, z: 500, ai: ATTACK }, hampton: { x: 900, z: 550, ai: ATTACK }, franklin: FAR });
    const us = ['jackson', 'bee', 'hampton'].map(id => unit(g, id));
    run(g, 600, () => g.simTime > 20 && settled(...us));
    assert.ok(settled(...us), 'spread: all three attackers arrive and hold');
    const gaps = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => dist(us[a], us[b]));
    assert.ok(gaps.every(d => d >= 40), `spread: final points stand at least 40 m apart (${gaps.map(d => d.toFixed(0)).join(', ')} m)`);
    assert.ok(us.every(u => dist(u, OBJ) < O.r + 150), 'spread: the line stands on the objective');
  }],
  ['artillery-stands', async api => {
    const g = game(api, { rockbridge: { x: 1400, z: 500, ai: ATTACK }, franklin: FAR });
    const r = unit(g, 'rockbridge'), eff = g.effRange(r);
    run(g, 600, () => g.simTime > 5 && settled(r));
    assert.ok(settled(r), 'artillery-stands: the battery stops');
    assert.ok(dist(r, OBJ) > 0.8 * eff && dist(r, OBJ) <= eff + 5, `artillery-stands: stands at effective range from an empty objective (${dist(r, OBJ).toFixed(0)} m, effective ${eff.toFixed(0)} m)`);
    const h = game(api, { rockbridge: { x: 1400, z: 500, ai: ATTACK }, willcox: { x: 300, z: 500, facing: Math.PI / 2 }, franklin: FAR });
    const hr = unit(h, 'rockbridge'), w = unit(h, 'willcox');
    run(h, 600, () => h.simTime > 5 && settled(hr));
    assert.ok(settled(hr) && dist(hr, w) <= eff + 5 && dist(hr, w) > 0.5 * eff, `artillery-stands: stands at effective range from the nearest enemy (${dist(hr, w).toFixed(0)} m)`);
    assert.ok(!hr.melee && dist(hr, OBJ) > O.r, 'artillery-stands: never marched into the enemy or onto the objective');
  }],
  ['objective-intruder', async api => {
    const g = game(api, { jackson: { x: O.x, z: O.z, ai: ATTACK }, willcox: { x: O.x, z: O.z - 170, facing: 0 }, franklin: FAR });
    const j = unit(g, 'jackson'), w = unit(g, 'willcox');
    run(g, 1.5);
    assert.ok(j.order.type === 'attack' && j.order.target === w, `objective-intruder: attacks the enemy inside the radius (${j.order.type})`);
    run(g, 20, () => dist(j, w) <= g.effRange(j) + 10);
    assert.ok(dist(j, w) <= g.effRange(j) + 10, `objective-intruder: closes to effective range (${dist(j, w).toFixed(0)} m)`);
  }],
  ['arrival-role', async api => {
    const late = { ...copy(HH.units.find(u => u.id === 'hampton')), id: 'late-cs', x: 900, z: 500, atSec: 2, entry: 'Fictional road', ai: ATTACK };
    const g = game(api, { staunton: { x: 1500, z: 1500 }, franklin: FAR }, { reinforcements: [late] });
    run(g, 6);
    const u = unit(g, 'late-cs');
    assert.ok(u && u.follow.active && u.order.type === 'move' && dist({ x: u.order.dest[0], z: u.order.dest[1] }, OBJ) < 1,
      `arrival-role: an arrival keeps its attack role and marches on the objective (${u?.order.type})`);
  }],
  ['validation', async api => {
    const packOf = (ai, where = 'units') => {
      const s = scenario(API, { jackson: {}, franklin: {} });
      if (where === 'units') s.units[0].ai = ai;
      else s.reinforcements = [{ ...copy(s.units[0]), id: 'late', atSec: 4, entry: 'Fictional road', ai }];
      return { version: 1, id: 'test-ai', title: 'Fictional', phases: [{ id: 'only', scenario: s }] };
    };
    const ok = api.preparePhase(packOf({ role: 'reserve', at: '16:30', target: [10, -20], via: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]] }), 'only');
    assert.equal(ok.scenario.units[0].ai?.via?.length, 6, 'validation: a full route is kept');
    api.preparePhase(packOf({ role: 'hold', at: '14:00' }), 'only');
    const refuse = (ai, pattern, where) => {
      let error = null;
      try { (where === 'reinforcements' ? prepareReinforcementTimeline : api.preparePhase)(packOf(ai, where), 'only'); } catch (e) { error = e; }
      assert.ok(error, `validation: accepted ${JSON.stringify(ai)}`);
      assert.match(error.message, pattern, `validation: wrong refusal for ${JSON.stringify(ai)}`);
    };
    refuse({ role: 'charge' }, /^Phase: unit AI role must be hold, attack or reserve/);
    refuse({}, /^Phase: unit AI role must be/);
    refuse({ role: 'attack', when: '14:00' }, /^Phase: unit AI has unsupported fields/);
    refuse([], /^Phase: unit AI has unsupported fields/);
    for (const at of ['13:59', '16:31', '25:00', '14:60', 'noon', 1400]) refuse({ role: 'attack', at }, /^Phase: unit AI time must be HH:MM within the battle clock/);
    for (const target of [[0], [0, 'x'], '0,0', [0, 0, 0]]) refuse({ role: 'attack', target }, /^Phase: unit AI target must be a finite \[x, z\]/);
    for (const via of [[[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], [[0]], [0, 0], {}]) refuse({ role: 'attack', via }, /^Phase: unit AI via must be at most 6/);
    refuse({ role: 'tea' }, /^Phase: unit AI role must be/, 'reinforcements');
    let error = null;
    try { api.prepareFieldScenario(scenario(API, { jackson: { ai: { role: 'attack', via: [[0, 20000]] } }, franklin: {} }), 'pack'); } catch (e) { error = e; }
    assert.match(String(error?.message), /^Field: unit AI route is outside current ground bounds/, 'validation: a route off the ground is refused');
  }],
  ['hold-default', async api => {
    // The men-and-result oracle follows tools/test-packs.mjs under the same default rules it runs with.
    assert.deepEqual(henryHillRun(api), ORACLE, 'hold-default: Henry Hill without AI roles matches the test-packs oracle');
    // PLACES was observed before the friendly-fire mask (rules.friendlyMask, a separate contract): compare with it off.
    const mask = RULES.friendlyMask;
    try {
      RULES.friendlyMask = false;
      assert.deepEqual(henryHillPlaces(api), PLACES, 'hold-default: every formation stands, faces and holds as on the parent');
    } finally { RULES.friendlyMask = mask; }
    const withHold = { transform: s => { for (const u of s.units) if (u.side === 'CS') u.ai = { role: 'hold' }; return api.transform(s); } };
    assert.deepEqual([henryHillRun(withHold), henryHillPlaces(withHold)], [henryHillRun(api), henryHillPlaces(api)], 'hold-default: an explicit hold role is the absent role');
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const strip = (s) => { for (const u of [...(s.units || []), ...(s.reinforcements || [])]) delete u.ai; return s; };
const MUTANTS = {
  'attack-objective': { transform: strip }, // no role: the brigade stays where it is
  'attack-at': { patch: { activates: () => true } }, // ignores the clock
  'reserve-commits': { patch: { activates(u, role, nd) { return Ai.prototype.activates.call(this, u, role, Infinity); } } }, // ignores a close enemy
  'march-and-fight': { patch: { advance(u, s, near, nd) { Ai.prototype.advance.call(this, u, s, near, nd); if (s.issued > -Infinity) s.issued = Infinity; } } }, // never resumes
  'spread': { patch: { place(grp, v) { grp.n++; grp.pos.set(v, 0); } } }, // every attacker aims at one point
  'artillery-stands': { patch: { gunReach: () => 0 } }, // guns march all the way in
  'objective-intruder': { patch: { intruder: () => null } }, // ignores the enemy on the objective
  'arrival-role': { transform: s => { for (const u of s.reinforcements || []) delete u.ai; return s; } }, // arrival loses its role
  'validation': { // the role is passed through unvalidated
    preparePhase: (p, id) => ({ ...preparePhase({ ...p, phases: p.phases.map(ph => ({ ...ph, scenario: strip(copy(ph.scenario)) })) }, id), scenario: p.phases.find(ph => ph.id === id).scenario }),
    prepareFieldScenario: (s, route) => ({ ...prepareFieldScenario(strip(copy(s)), route), units: s.units }) },
  'hold-default': { transform: s => { for (const u of s.units) if (u.id === 'jackson') u.ai = { role: 'attack' }; return s; } }, // a role leaks into the default
};

export async function aiUnit(api = API) {
  for (const [, check] of AI_CHECKS) await check(api);
  return AI_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await aiUnit();
  console.log(`AI OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of AI_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`AI CONTROLS OK (${rows.length}/${count})`);
  }
}

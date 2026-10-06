// Ordered terminal/capture bindings; execute the actual Game method without renderer allocation.
import assert from 'node:assert/strict';
import { introScenario } from '../src/franchise/intro.js';
import { practiceOutcome } from '../src/franchise/practice.js';
import { FieldCaptures } from '../src/franchise/captures.js';
import { Game } from '../src/game.js';
const scenario = introScenario({ date: '1861-07-21' });
function fixture() {
  return { scenario, units: scenario.units.map((u) => ({ ...u, menMax: u.men, alive: true, state: 'steady' })),
    playerSide: 'US', simTime: 0, clockStart: 0, clockEnd: 180, objective: scenario.objective,
    fieldCaptures: new FieldCaptures(scenario.crates), result: null, over: false, objT: 0, event() {}, alert() {} };
}
const outcome = (g) => practiceOutcome({ game: g, scenario, mode: 'practice', awardId: 'intro-test', seed: 22 });
const api = { terminal: (g) => Game.prototype.checkObjective.call(g, 0.05), outcome,
  event: (side) => {
    let result = null;
    Game.prototype.event.call({ clockText: () => ({ time: '00:00' }), emit: (kind, event) => { result = event; } }, 'Captured', null, 'capture', { side, x: 0, z: 0 });
    return result;
  } };
const tests = [
  ['intro-zero-defeat', (a) => {
    const g = fixture(); for (const u of g.units) { u.men = 0; u.alive = false; }
    a.terminal(g); assert.equal(g.result?.winner, 'CS'); assert.equal(g.over, true);
  }, { ...api, terminal: (g) => { g.result = { winner: 'US' }; g.over = true; } }],
  ['intro-broken-hold-defeat', (a) => {
    for (const brokenEnemy of [false, true]) {
      const g = fixture(); for (const u of g.units) if (u.side === 'US') u.x = -900;
      if (brokenEnemy) g.units.find((u) => u.side === 'CS').state = 'routing';
      a.terminal(g); assert.equal(g.result?.winner, 'CS'); assert.equal(g.simTime, 0);
    }
  }, { ...api, terminal: () => {} }],
  ['intro-held-clock', (a) => {
    const g = fixture(); g.simTime = 44; a.terminal(g); assert.equal(g.result, null);
    g.objT = 0; g.simTime = 45; a.terminal(g); assert.equal(g.result?.winner, 'US');
  }, { ...api, terminal: (g) => { if (g.simTime >= 44) g.result = { winner: 'US' }; } }],
  ['intro-contested-defeat', (a) => {
    const g = fixture(); const enemy = g.units.find((u) => u.side === 'CS'); enemy.x = g.objective.x; enemy.z = g.objective.z;
    a.terminal(g); assert.equal(g.result?.winner, 'CS'); assert.equal(g.holder, 'contested');
  }, { ...api, terminal: () => {} }],
  ['intro-defeat-held-loot', (a) => {
    const g = fixture(), c = scenario.crates[0]; g.units[0].x = c.x; g.units[0].z = c.z;
    for (let i = 0; i < 40; i++) g.fieldCaptures.step(g.units, 0.05);
    g.over = true; g.result = { winner: 'CS', why: 'Controlled loss fixture' }; g.units[0].men = 955.9;
    const x = a.outcome(g); assert.equal(x.grade, 'Defeat'); assert.equal(x.captures.length, 1);
    assert.equal(x.army[0].men, 955); assert.equal(x.summary.losses + x.summary.surviving, 2000);
    g.fieldCaptures.crates[0].owner = 'CS'; assert.equal(x.captures.length, 1);
  }, { ...api, outcome: (g) => ({ ...outcome(g), captures: [] }) }],
  ['intro-capture-binding', (a) => {
    for (const records of [[{ id: 'unknown', tier: 'rare' }], [{ id: 'near-stores', tier: 'legendary' }],
      [{ id: 'near-stores', tier: 'rare' }, { id: 'near-stores', tier: 'rare' }]]) {
      const g = fixture(); g.over = true; g.result = { winner: 'US' }; g.fieldCaptures = { held: () => records };
      assert.throws(() => a.outcome(g), /invalid field captures/);
    }
  }, { ...api, outcome: () => ({ captures: [] }) }],
  ['capture-event-side', (a) => {
    for (const side of ['US', 'CS']) assert.equal(a.event(side).side, side);
  }, { ...api, event: () => ({ side: null }) }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped the intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
console.log(`INTRO ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

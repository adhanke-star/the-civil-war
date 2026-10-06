// Pure completed-outcome checks and per-invariant rejecting mutants. Never mutates source or disk.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { practiceOutcome, playMode } from '../src/franchise/practice.js';
import { rollLoot } from '../src/reward/model.js';
import { ARMS, PRACTICE_ARMS } from '../src/reward/data.js';

const scenario = JSON.parse(readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url), 'utf8'));
function fixture() {
  const units = scenario.units.map((d) => ({ ...structuredClone(d), menMax: d.men, state: 'steady',
    ...(d.type === 'artillery' ? { gunSlots: Array.from({ length: d.guns }, () => ({ alive: true })) } : {}) }));
  units.find((u) => u.id === 'franklin').men = 1777.9;
  units.find((u) => u.id === 'franklin').state = 'routing';
  units.find((u) => u.id === 'willcox').men = 0.8;
  const r = units.find((u) => u.id === 'ricketts'); r.men = 99.4; r.gunSlots[0].alive = false;
  return { scenario, mode: 'practice', awardId: 'practice-test-a', seed: 72,
    game: { playerSide: 'US', over: true, result: { winner: 'US', why: 'Practice result' }, units } };
}
const copy = (x) => structuredClone(x);
const run = (f) => f(fixture());
const tests = [
  ['outcome-roster', (f) => {
    const x = run(f);
    assert.deepEqual(x.army.map((b) => [b.id, b.label]), scenario.units.filter((d) => d.side === 'US').map((d) => [d.id, d.name]));
    assert.equal(x.army.find((b) => b.id === 'franklin').men, 1777);
    assert.equal(x.army.find((b) => b.id === 'willcox').men, 0);
  }, (o) => { const x = practiceOutcome(o); x.army = x.army.filter((b) => b.id !== 'franklin'); return x; }],
  ['outcome-conservation', (f) => {
    const x = run(f);
    assert.equal(x.summary.starting, 7240); assert.equal(x.summary.surviving, 4996);
    assert.equal(x.summary.losses, 2244); assert.equal(x.summary.starting, x.summary.surviving + x.summary.losses);
  }, (o) => practiceOutcome({ ...o, game: { ...o.game, units: o.game.units.map((u) => ({ ...u, men: Math.round(u.men) })) } })],
  ['outcome-guns', (f) => {
    const x = run(f); assert.equal(x.army.find((b) => b.id === 'ricketts').guns, 5); assert.equal(x.summary.guns, 11);
  }, (o) => { const x = practiceOutcome(o); x.army.find((b) => b.id === 'ricketts').guns = 6; return x; }],
  ['outcome-gear', (f) => {
    const x = run(f);
    assert.deepEqual(x.army.map((b) => b.weapon.itemId), ['practice-rifled', 'practice-smooth', 'practice-smooth', 'practice-parrott', 'practice-parrott']);
    assert.equal(PRACTICE_ARMS.every((a) => a.practice && !ARMS.some((b) => b.id === a.id)), true);
    assert.equal(x.army.every((b) => b.weapon.from.includes('unspecified')), true);
  }, (o) => { const x = practiceOutcome(o); x.army[0].weapon.itemId = 'springfield'; return x; }],
  ['outcome-eligibility', (f) => {
    for (const change of [{ mode: 'historical' }, { mode: 'sandbox' }, { mode: 'unexpected' }, { game: { ...fixture().game, over: false } }]) {
      assert.throws(() => f({ ...fixture(), ...change }), /only a completed/);
    }
    assert.equal(playMode('?practice'), 'practice'); assert.equal(playMode('?battle=henry-hill'), 'historical');
    assert.equal(playMode('?sandbox&practice'), 'sandbox');
  }, (o) => practiceOutcome({ ...o, mode: 'practice', game: { ...o.game, over: true } })],
  ['outcome-captures', (f) => {
    const x = run(f); assert.deepEqual(x.captures, []);
    assert.equal(rollLoot({ seed: x.seed, grade: x.grade, captures: x.captures }).cards.some((c) => c.source === 'capture'), false);
  }, (o) => { const x = practiceOutcome(o); delete x.captures; return x; }],
  ['outcome-identity', (f) => {
    const a = f(fixture()), b = f({ ...fixture(), awardId: 'practice-test-b' });
    assert.deepEqual(a, f(fixture()));
    assert.equal(a.army.every((u, i) => u.weapon.uid !== b.army[i].weapon.uid), true);
  }, (o) => { const x = practiceOutcome(o); for (const b of x.army) b.weapon.uid = `start-${b.id}`; return x; }],
  ['outcome-depleted', (f) => {
    const o = fixture(); o.game.result.winner = 'CS'; for (const u of o.game.units) if (u.side === 'US') u.men = 0.8;
    const x = f(o); assert.equal(x.grade, 'Defeat'); assert.equal(x.army.length, 5);
    assert.equal(x.summary.surviving, 0); assert.equal(x.summary.guns, 0); assert.equal(x.summary.losses, 7240);
  }, (o) => { const x = practiceOutcome(o); x.army[0].men = 1; x.summary.surviving = 1; return x; }],
  ['outcome-invalid', (f) => {
    for (const n of [NaN, Infinity, -1, 9000]) { const o = fixture(); o.game.units[0].men = n; assert.throws(() => f(o), /invalid surviving strength/); }
    const o = fixture(); o.game.units.push(copy(o.game.units[0])); assert.throws(() => f(o), /altered roster/);
    const g = fixture(); g.game.units.find((u) => u.id === 'ricketts').gunSlots.pop(); assert.throws(() => f(g), /invalid surviving gun/);
    const unchanged = fixture(), before = copy(unchanged); f(unchanged); assert.deepEqual(unchanged, before);
  }, (o) => { try { return practiceOutcome(o); } catch { return practiceOutcome(fixture()); } }],
];

let failures = 0;
for (const [name, check, mutant] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      let rejected = false;
      try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) rejected = true; else throw e; }
      assert.equal(rejected, true, `${name}: mutant escaped its named invariant`);
      console.log(`ok ${name}: intended assertion rejected mutant`);
    } else { check(practiceOutcome); console.log(`ok ${name}`); }
  } catch (err) { failures++; console.error(`FAIL ${name}: ${err.message}`); }
}
console.log(`${process.argv.includes('--prove-fail') ? 'PRACTICE CONTROLS' : 'PRACTICE'} ${failures ? 'FAILED' : 'OK'} (${tests.length - failures}/${tests.length})`);
process.exitCode = failures ? 1 : 0;

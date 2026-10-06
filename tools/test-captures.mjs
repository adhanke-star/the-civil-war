// Capture invariants and named rejecting stand-ins. No source or user storage mutation.
import assert from 'node:assert/strict';
import { FieldCaptures } from '../src/franchise/captures.js';
import { rollLoot } from '../src/reward/model.js';
const defs = [{ id: 'stores', name: 'Practice stores', x: 0, z: 0, r: 50, tier: 'rare' }];
const unit = (side, extra = {}) => ({ side, x: 0, z: 0, men: 100, state: 'steady', alive: true, ...extra });
const tick = (c, units, n = 20) => { const out = []; for (let i = 0; i < n; i++) out.push(...c.step(units, 0.1)); return out; };
const create = (d = defs) => new FieldCaptures(d);
const altered = (edit) => (d = defs) => { const c = create(d); edit(c); return c; };
const tests = [
  ['exclusive-time', (make) => {
    const c = make(); assert.equal(tick(c, [unit('US')], 19).length, 0); assert.equal(c.held().length, 0);
    assert.equal(tick(c, [unit('US')], 1).length, 1); assert.equal(c.held().length, 1);
    assert.equal(tick(c, [unit('US')], 50).length, 0);
  }, altered((c) => { const step = c.step.bind(c); c.step = (us, dt) => step(us, dt * 2); })],
  ['contested-no-majority', (make) => {
    const c = make(); tick(c, [unit('US')], 19);
    tick(c, [unit('US'), unit('US'), unit('CS')], 30);
    assert.equal(c.held().length, 0); assert.equal(c.crates[0].status, 'contested');
    assert.equal(tick(c, [unit('US')], 1).length, 0); assert.equal(c.held().length, 0);
    tick(c, [unit('US')], 19); assert.equal(c.held().length, 1);
    tick(c, [unit('US'), unit('CS')]); assert.equal(c.held().length, 0);
  }, altered((c) => { const step = c.step.bind(c); c.step = (us, dt) => step(us.filter((u) => u.side === 'US'), dt); })],
  ['retake-final-once', (make) => {
    const c = make(); tick(c, [unit('US')]); assert.equal(c.held().length, 1);
    const retake = tick(c, [unit('CS')]); assert.equal(retake.length, 1); assert.equal(retake[0].previous, 'US');
    assert.equal(c.held().length, 0); assert.equal(c.held('CS').length, 1);
    tick(c, [unit('US')]); const held = c.held(); assert.equal(held.length, 1);
    assert.equal(rollLoot({ seed: 11, grade: 'Defeat', captures: held }).cards.filter((i) => i.source === 'capture').length, 1);
    const before = c.held(); before[0].tier = 'legendary'; assert.equal(c.held()[0].tier, 'rare');
  }, altered((c) => { const held = c.held.bind(c); c.held = (side) => [...held(side), ...held(side)]; })],
  ['inactive-no-presence', (make) => {
    for (const extra of [{ men: 0 }, { men: 0.9 }, { state: 'routing' }, { alive: false }]) {
      const c = make(); tick(c, [unit('US', extra)], 50); assert.equal(c.held().length, 0);
      tick(c, [unit('CS')]); tick(c, [unit('CS'), unit('US', extra)], 50); assert.equal(c.held('CS').length, 1);
    }
  }, altered((c) => { const step = c.step.bind(c); c.step = (us, dt) => step(us.map((u) => ({ ...u, men: 100, alive: true, state: 'steady' })), dt); })],
  ['empty-boundary-reset', (make) => {
    const c = make(); tick(c, [unit('US')], 19); tick(c, [], 1); tick(c, [unit('US')], 1); assert.equal(c.held().length, 0);
    tick(c, [unit('US')], 19); tick(c, [], 50); assert.equal(c.held().length, 1);
    const far = make(); tick(far, [unit('US', { x: 50.1 })], 30); assert.equal(far.held().length, 0);
  }, altered((c) => { const step = c.step.bind(c); c.step = (us, dt) => step(us.length ? us : [unit('US')], dt); })],
  ['validated-definitions', (make) => {
    for (const bad of [[...defs, ...defs], [{ ...defs[0], x: NaN }], ...['unknown', 'constructor', '__proto__', ['rare']].map((tier) => [{ ...defs[0], tier }]), [{ ...defs[0], r: 0 }]]) {
      assert.throws(() => make(bad), /Invalid field crate/);
    }
    const c = make(); for (const dt of [NaN, -1, Infinity, 2]) assert.throws(() => c.step([], dt), /Invalid capture step/);
  }, () => create()],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped its intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(create); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
console.log(`CAPTURES ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

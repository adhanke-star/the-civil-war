// Exercise actual placement/combat/settings seams without renderer allocation or player storage.
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { Combat } from '../src/sim/combat.js';
import { RULES } from '../src/sim/rules.js';
import * as S from '../src/settings.js';
import { defineSandboxTools } from '../src/ui/sandbox-tools.js';

defineSandboxTools({ game: {}, rts: {}, effects: {}, hud: {} });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);
function spawn(opts = {}) {
  const g = { reserve: { US: 10000, CS: 10000 }, spawned: { US: 0, CS: 0 }, units: [], playerSide: 'US',
    makeCalls: 0, emit() {}, makeUnit(def) { this.makeCalls++; return { ...def, def }; } };
  const u = Game.prototype.spawnUnit.call(g, { side: 'US', men: 1000, weapon: 'rifled', x: 0, z: 0, facing: 0, ...opts });
  return { g, u };
}
function unit(side, extra = {}) {
  return { id: side, side, type: 'infantry', alive: true, state: 'steady', xp: 1, men: 1000, menMax: 1000,
    x: 0, z: side === 'US' ? 0 : 8, facing: side === 'US' ? 0 : Math.PI, halfFront: 50, depth: 10,
    morale: 78, moraleMax: 78, cover: 1, fatigue: 10, follow: { active: true }, order: { type: 'charge' },
    stop() { this.follow.active = false; }, takeLosses(n) { this.men -= n; }, ...extra };
}
function melee({ effect = 1, gain = 1, reverse = false, men = 1000, currentMen = men, chargeB = true, dt = 1, fatigue = 10, finishFatigue = false } = {}) {
  const prev = { effect: RULES.chargeEffect, gain: RULES.fatigueGain };
  try {
    S.set('rules.chargeEffect', effect); S.set('rules.fatigueGain', gain);
    const a = unit('US', { men: currentMen, menMax: men, fatigue });
    const b = unit('CS', { men: currentMen, menMax: men, fatigue, order: { type: chargeB ? 'charge' : 'hold' } });
    let draws = 0;
    const combat = new Combat({ units: reverse ? [b, a] : [a, b], fallen: {}, rnd: () => { draws++; return 0.5; } });
    combat.meleeStep(dt, 10);
    if (finishFatigue) for (const u of combat.units) combat.fatigueStep(u, dt);
    return { a, b, aLoss: currentMen - a.men, bLoss: currentMen - b.men, draws };
  } finally { S.set('rules.chargeEffect', prev.effect); S.set('rules.fatigueGain', prev.gain); }
}
function fatigue({ gain = 1, initial = 10, dt = 10, ...extra } = {}) {
  const prev = RULES.fatigueGain;
  try {
    S.set('rules.fatigueGain', gain);
    const u = unit('US', { fatigue: initial, order: { type: 'move' }, ...extra });
    Combat.prototype.fatigueStep.call({}, u, dt); return u.fatigue;
  } finally { S.set('rules.fatigueGain', prev); }
}
function fire(xp, effect = 1) {
  const prev = RULES.chargeEffect;
  try {
    S.set('rules.chargeEffect', effect);
    const a = unit('US', { xp, weapon: 'rifled', ammo: 100, fatigue: 0 });
    const b = unit('CS', { z: 100 });
    new Combat({ units: [a, b], terrain: { heightAt: () => 0 }, fallen: {}, rnd: () => 0.5 }).volleyAt(a, b, 10);
    return b.casTick;
  } finally { S.set('rules.chargeEffect', prev); }
}
const api = { spawn, melee, fatigue, fire, set: S.set };
const tests = [
  ['placement-default-and-both-sides', (a) => {
    for (const side of ['US', 'CS']) for (const xp of [undefined, 1, 2, 3, 4]) {
      const { g, u } = a.spawn({ side, xp }); assert.equal(u.xp, xp ?? 1); assert.equal(u.def.xp, xp ?? 1);
      assert.equal(u.commander, null); assert.deepEqual(u.regiments, []); assert.deepEqual(u.sources, []);
      assert.match(u.name, /^(Union|Confederate) brigade 1$/); assert.equal(g.makeCalls, 1);
      assert.equal(g.units[0], u); assert.equal(g.spawned[side], 1); assert.equal(g.reserve[side], 9794);
    }
  }, { ...api, spawn: (o) => spawn({ ...o, xp: 1 }) }],
  ['invalid-placement-no-mutation', (a) => {
    for (const side of ['US', 'CS']) for (const xp of [0, 5, -1, 1.5, NaN, Infinity, '4', null]) {
      const { g, u } = a.spawn({ side, xp }); assert.equal(u, null); assert.equal(g.makeCalls, 0);
      assert.deepEqual(g.reserve, { US: 10000, CS: 10000 }); assert.deepEqual(g.spawned, { US: 0, CS: 0 }); assert.equal(g.units.length, 0);
    }
  }, { ...api, spawn: (o) => spawn({ ...o, xp: 1 }) }],
  ['default-melee-and-draws', (a) => {
    const x = a.melee(); near(x.aLoss, 9); near(x.bLoss, 9); near(x.a.fatigue, 12.4); near(x.b.fatigue, 12.4);
    assert.equal(x.draws, 2); assert.equal(x.a.melee, true); assert.equal(x.b.melee, true);
  }, { ...api, melee: (o) => ({ ...melee(o), draws: 4 }) }],
  ['charge-losses-both-sides', (a) => {
    for (const effect of [0.5, 1, 2]) { const x = a.melee({ effect }); near(x.aLoss, 9 * effect); near(x.bLoss, 9 * effect); }
  }, { ...api, melee: (o) => melee({ ...o, effect: 1 }) }],
  ['charge-defender-and-symmetry', (a) => {
    for (const effect of [0.5, 1, 2]) {
      const x = a.melee({ effect, chargeB: false }); near(x.bLoss, 10.35 * effect); near(x.aLoss, (9 / 1.15) * effect);
      const y = a.melee({ effect, reverse: true }); const z = a.melee({ effect }); near(y.aLoss, z.aLoss); near(y.bLoss, z.bLoss);
    }
  }, { ...api, melee: (o) => ({ ...melee(o), bLoss: 0 }) }],
  ['charge-caps-and-survivors', (a) => {
    for (const effect of [0.5, 1, 2]) for (const currentMen of [100, 0.5]) {
      const x = a.melee({ effect, men: 100, currentMen }); near(x.aLoss, Math.min(currentMen, 4)); near(x.bLoss, Math.min(currentMen, 4));
      assert.ok(x.a.men >= 0 && x.b.men >= 0);
    }
  }, { ...api, melee: (o) => ({ ...melee(o), aLoss: 18 }) }],
  ['melee-fatigue-gain', (a) => {
    for (const gain of [0.5, 1, 2]) { const x = a.melee({ gain }); near(x.a.fatigue, 10 + 2.4 * gain); near(x.b.fatigue, 10 + 2.4 * gain); }
    const x = a.melee({ gain: 2, fatigue: 99 }); assert.equal(x.a.fatigue, 100); assert.equal(x.b.fatigue, 100);
  }, { ...api, melee: (o) => melee({ ...o, gain: 1 }) }],
  ['movement-fatigue-gain', (a) => {
    for (const gain of [0.5, 1, 2]) for (const side of ['US', 'CS']) {
      near(a.fatigue({ gain, side }), 10 + 3 * gain);
      for (const extra of [{ run: true }, { state: 'routing', follow: { active: false } }, { order: { type: 'charge' } }]) {
        near(a.fatigue({ gain, side, ...extra }), 10 + 12 * gain);
      }
    }
  }, { ...api, fatigue: (o) => fatigue({ ...o, gain: 1 }) }],
  ['recovery-unchanged-and-bounds', (a) => {
    for (const gain of [0.5, 1, 2]) {
      near(a.fatigue({ gain, follow: { active: false } }), 1);
      near(a.fatigue({ gain, follow: { active: false }, firing: true }), 6.5);
      assert.equal(a.fatigue({ gain, initial: 1, follow: { active: false } }), 0);
      assert.equal(a.fatigue({ gain, initial: 99, run: true }), 100);
    }
  }, { ...api, fatigue: (o) => fatigue(o) * o.gain }],
  ['veterancy-reaches-fire-not-charge', (a) => {
    near(a.fire(4) / a.fire(1), 7 / 6); near(a.fire(1, 0.5), a.fire(1, 2));
  }, { ...api, fire: () => fire(1) }],
  ['registry-live-clamp-lock-reset-transfer', (a) => {
    for (const [key, field] of [['rules.chargeEffect', 'chargeEffect'], ['rules.fatigueGain', 'fatigueGain']]) {
      try {
        assert.equal(S.get(key), 1); a.set(key, 9); assert.equal(RULES[field], 2);
        a.set(key, -1); assert.equal(RULES[field], 0.5); a.set(key, 1.13); assert.equal(RULES[field], 1.15);
        a.set(key, NaN); assert.equal(RULES[field], 1.15); S.lock(key); a.set(key, 2); S.reset(key); assert.equal(RULES[field], 1.15);
        assert.ok(S.exportText().includes(`${key} = 1.15`)); assert.ok(S.exportText().includes(`locked: ${key}`));
        S.unlock(key); S.reset(key); assert.equal(RULES[field], 1);
        S.importText(`${key} = 1.5\nlocked: ${key}`); assert.equal(RULES[field], 1.5); assert.equal(S.isLocked(key), true);
      } finally { S.unlock(key); S.reset(key); }
    }
    assert.equal(S.get('units.spawnVeterancy'), 1);
  }, { ...api, set: () => undefined }],
  ['melee-then-fatigue-preserves-recovery', (a) => {
    for (const gain of [0.5, 1, 2]) {
      const x = a.melee({ gain, finishFatigue: true });
      near(x.a.fatigue, 10 + 2.4 * gain - 0.9); near(x.b.fatigue, 10 + 3.6 * gain);
    }
  }, { ...api, melee: (o) => melee({ ...o, gain: 1 }) }],
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
console.log(`SANDBOX RULES ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

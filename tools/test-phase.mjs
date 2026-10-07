import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { preparePhase, PHASE_LIMITS } from '../src/sim/phase.js';
import { introScenario } from '../src/franchise/intro.js';

const clone = value => JSON.parse(JSON.stringify(value));
const legacy = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const pack = () => ({ version: 1, id: 'diagnostic-pack', title: 'Fictional phase contract fixture', phases: [
  { id: 'first', scenario: { id: 'diagnostic-first', title: 'First fixture', battle: 'Fictional test', date: '1862-04-06', start: '05:00', end: '06:00',
    units: [{ id: 'fixture-formation', name: 'Generic fixture formation', side: 'US', type: 'infantry', weapon: 'smooth', men: 800, x: 0, z: 0, facing: 0,
      commander: null, regiments: [], sources: [{ url: 'https://example.invalid/fixture', status: 'Inferred', text: 'DIAGNOSTIC ONLY' }] }],
    objective: { name: 'Fixture point', x: 100, z: 100, r: 20 }, opening: [{ id: 'fixture-formation', points: [[0, 0], [20, 20]], endFacing: 1 }] } },
  { id: 'next-day', scenario: { id: 'diagnostic-next', title: 'Next fixture', battle: 'Fictional test', date: '1862-04-07', start: '06:00', end: '07:00',
    units: [{ id: 'fixture-formation', name: 'Generic fixture formation', side: 'US', men: 700, x: 0, z: 0, facing: 0 }],
    objective: { name: 'Next fixture point', x: 20, z: 20, r: 15 } } },
] });
const bad = change => { const p = pack(); change(p, p.phases[0].scenario, p.phases[0].scenario.units[0]); return p; };
const reject = (prepare, p, id = 'first') => assert.throws(() => prepare(p, id), /^Error: Phase:/);
const rejectChanges = (prepare, changes) => { for (const change of changes) reject(prepare, bad(change)); };

export const PHASE_CHECKS = [
  ['phase-links', prepare => {
    const p = pack(), a = prepare(p, 'first'), b = prepare(p, 'next-day');
    assert.deepEqual([a.packId, a.phaseId, a.index, a.previousId, a.nextId], [p.id, 'first', 0, null, 'next-day']);
    assert.deepEqual([b.packId, b.phaseId, b.index, b.previousId, b.nextId], [p.id, 'next-day', 1, 'first', null]);
    assert.equal(a.scenario.units[0].id, b.scenario.units[0].id);
    assert.notEqual(a.scenario.date, b.scenario.date);
  }],
  ['phase-detached', prepare => {
    const p = pack(), before = clone(p), a = prepare(p, 'first');
    assert.deepEqual(p, before); assert.notEqual(a.scenario, p.phases[0].scenario);
    p.phases[0].scenario.units[0].sources[0].text = 'Caller changed';
    p.phases[0].scenario.opening[0].points[0][0] = 999;
    assert.equal(a.scenario.units[0].sources[0].text, 'DIAGNOSTIC ONLY'); assert.equal(a.scenario.opening[0].points[0][0], 0);
  }],
  ['phase-frozen', prepare => {
    const a = prepare(pack(), 'first');
    const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const x of Object.values(value)) frozen(x); } };
    frozen(a); assert.throws(() => { a.scenario.units.push({}); }, TypeError);
    assert.throws(() => { a.scenario.units[0].sources[0].status = 'Verified'; }, TypeError);
  }],
  ['phase-metadata', prepare => {
    const p = pack(); p.phases[0].scenario.extraMetadata = { arbitrary: ['Disputed', { quote: 'Full original text' }] };
    Object.defineProperty(p.phases[0].scenario.extraMetadata, '__proto__', { value: { preserved: true }, enumerable: true });
    const a = prepare(p, 'first'); assert.deepEqual(a.scenario, p.phases[0].scenario);
    assert.equal(Object.getPrototypeOf(a.scenario.extraMetadata), Object.prototype);
    assert.equal({}.preserved, undefined);
    assert.ok(!Object.hasOwn(a.scenario.units[0], 'equipment'));
  }],
  ['phase-existing-scenarios', prepare => {
    for (const s of [legacy, introScenario(legacy)]) {
      const p = { version: 1, id: 'existing-fixture', title: 'Existing data adapter test', phases: [{ id: 'first', scenario: s }] };
      assert.deepEqual(prepare(p, 'first').scenario, s);
    }
  }],
  ['phase-whole-pack', prepare => reject(prepare, bad(p => { p.phases[1].scenario.objective.r = 0; }))],
  ['phase-version', prepare => rejectChanges(prepare, [p => { p.version = 2; }, p => { p.version = '1'; }])],
  ['phase-pack-shape', prepare => rejectChanges(prepare, [p => { p.id = ''; }, p => { p.title = ''; }, p => { p.phases = []; }, p => { p.extra = true; }, p => { delete p.version; }])],
  ['phase-identities', prepare => rejectChanges(prepare, [p => { p.phases[1].id = 'first'; }, p => { p.phases[0].id = ''; }, p => { p.phases[0].extra = true; }])],
  ['phase-selection', prepare => { reject(prepare, pack(), 'absent'); reject(prepare, pack(), null); }],
  ['phase-scenario-shape', prepare => rejectChanges(prepare, [(p, s) => { s.id = ''; }, (p, s) => { s.title = ''; }, (p, s) => { s.battle = ''; }, (p, s) => { s.units = []; }])],
  ['phase-clock-date', prepare => rejectChanges(prepare, [
    (p, s) => { s.date = '1862-02-30'; }, (p, s) => { s.date = '1862-2-03'; }, (p, s) => { s.start = '5:00'; },
    (p, s) => { s.start = '24:00'; }, (p, s) => { s.end = '06:60'; }, (p, s) => { s.end = s.start; }, (p, s) => { s.end = '04:00'; },
  ])],
  ['phase-unit-identities', prepare => rejectChanges(prepare, [(p, s, u) => { u.id = ''; }, (p, s, u) => { s.units.push(clone(u)); }, (p, s, u) => { u.name = ''; }])],
  ['phase-unit-types', prepare => rejectChanges(prepare, [(p, s, u) => { u.side = 'UNKNOWN'; }, (p, s, u) => { u.type = 'cavalry'; }, (p, s, u) => { u.weapon = 'unknown'; }, (p, s, u) => { u.weapon = 'parrott'; }])],
  ['phase-unit-numbers', prepare => rejectChanges(prepare, [(p, s, u) => { u.men = 0; }, (p, s, u) => { u.men = '800'; }, (p, s, u) => { u.facing = NaN; }, (p, s, u) => { u.x = Infinity; }, (p, s, u) => { u.z = null; }, (p, s, u) => { u.guns = -1; }, (p, s, u) => { u.guns = 1.5; }])],
  ['phase-equipment', prepare => {
    const p = bad((p, s, u) => { u.equipment = { uid: 'fixture-arm', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional issue', source: 'capture' }; });
    assert.deepEqual(prepare(p, 'first').scenario.units[0].equipment, p.phases[0].scenario.units[0].equipment);
    p.phases[0].scenario.units[0].equipment.itemId = 'not-an-arm'; reject(prepare, p);
    reject(prepare, bad((p, s, u) => { u.equipment = null; }));
  }],
  ['phase-objective', prepare => rejectChanges(prepare, [(p, s) => { s.objective.r = 0; }, (p, s) => { s.objective.x = '0'; }, (p, s) => { s.objective.name = ''; }])],
  ['phase-opening', prepare => rejectChanges(prepare, [(p, s) => { s.opening[0].id = 'missing'; }, (p, s) => { s.opening.push(clone(s.opening[0])); }, (p, s) => { s.opening[0].points = [[0, 0]]; }, (p, s) => { s.opening[0].points[1] = [20]; }, (p, s) => { s.opening[0].points[1] = [20, null]; }, (p, s) => { s.opening[0].endFacing = '1'; }])],
  ['phase-json-data', prepare => {
    rejectChanges(prepare, [(p, s) => { s.extra = undefined; }, (p, s) => { s.extra = () => {}; }, (p, s) => { s.extra = 1n; }, (p, s) => { s.extra = new Date(); }, (p, s) => { s.extra = p; }, (p, s) => { s.extra = [, 1]; }, (p, s) => { s.extra = Object.create({ inherited: true }); }, (p, s) => { s[Symbol('hidden')] = 1; }]);
    let called = 0;
    const p = bad((p, s) => Object.defineProperty(s, 'extra', { enumerable: true, get() { called++; return 1; } }));
    reject(prepare, p); assert.equal(called, 0);
    reject(prepare, bad((p, s) => Object.defineProperty(s, 'extra', { enumerable: false, value: 1 })));
  }],
  ['phase-size-depth', prepare => {
    const p = pack(); p.phases[0].scenario.padding = '';
    const room = PHASE_LIMITS.bytes - Buffer.byteLength(JSON.stringify(p));
    p.phases[0].scenario.padding = 'é'.repeat(Math.floor(room / 2)) + 'x'.repeat(room % 2);
    assert.equal(Buffer.byteLength(JSON.stringify(p)), PHASE_LIMITS.bytes);
    assert.ok(prepare(p, 'first')); p.phases[0].scenario.padding += 'x'; reject(prepare, p);
    const nested = depth => { const p = pack(); let value = 1; for (let i = 0; i < depth - 4; i++) value = { child: value }; p.phases[0].scenario.extra = value; return p; };
    assert.ok(prepare(nested(PHASE_LIMITS.depth), 'first')); reject(prepare, nested(PHASE_LIMITS.depth + 1));
  }],
];

export function phaseUnit(prepare = preparePhase) {
  for (const [, verify] of PHASE_CHECKS) verify(prepare);
  return PHASE_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = phaseUnit();
  console.log(`PHASE OK (${count} categories; no route/store/render authority)`);
  if (process.argv.includes('--prove-fail')) {
    const controls = [
      ['phase-links', (p, id) => ({ ...preparePhase(p, id), nextId: 'wrong' })],
      ['phase-detached', (p, id) => ({ ...preparePhase(p, id), scenario: p.phases.find(x => x.id === id).scenario })],
      ['phase-frozen', (p, id) => clone(preparePhase(p, id))],
      ['phase-metadata', (p, id) => { const x = clone(preparePhase(p, id)); delete x.scenario.extraMetadata; return x; }],
      ['phase-existing-scenarios', (p, id) => { const x = clone(preparePhase(p, id)); delete x.scenario.units[0].sources; return x; }],
      ['phase-whole-pack', (p, id) => preparePhase({ ...p, phases: p.phases.filter(x => x.id === id) }, id)],
      ['phase-version', (p, id) => preparePhase({ ...p, version: 1 }, id)],
      ['phase-pack-shape', (p, id) => preparePhase({ ...p, id: 'repaired' }, id)],
      ['phase-identities', (p, id) => preparePhase({ ...p, phases: p.phases.slice(0, 1) }, id)],
      ['phase-selection', (p, id) => preparePhase(p, p.phases[0].id)],
      ['phase-scenario-shape', (p, id) => { const x = clone(p); x.phases[0].scenario.id = 'repaired'; return preparePhase(x, id); }],
      ['phase-clock-date', (p, id) => { const x = clone(p); x.phases[0].scenario.date = '1862-04-06'; return preparePhase(x, id); }],
      ['phase-unit-identities', (p, id) => { const x = clone(p); x.phases[0].scenario.units[0].id = 'fixture-formation'; return preparePhase(x, id); }],
      ['phase-unit-types', (p, id) => { const x = clone(p); x.phases[0].scenario.units[0].side = 'US'; return preparePhase(x, id); }],
      ['phase-unit-numbers', (p, id) => { const x = clone(p); x.phases[0].scenario.units[0].men = 800; return preparePhase(x, id); }],
      ['phase-equipment', (p, id) => { const x = clone(p); delete x.phases[0].scenario.units[0].equipment; return preparePhase(x, id); }],
      ['phase-objective', (p, id) => { const x = clone(p); x.phases[0].scenario.objective.r = 20; return preparePhase(x, id); }],
      ['phase-opening', (p, id) => { const x = clone(p); x.phases[0].scenario.opening[0].id = 'fixture-formation'; return preparePhase(x, id); }],
      ['phase-json-data', (p, id) => preparePhase(JSON.parse(JSON.stringify(p)), id)],
      ['phase-size-depth', (p, id) => { const x = clone(p); if (typeof x.phases[0].scenario.padding === 'string') x.phases[0].scenario.padding = ''; return preparePhase(x, id); }],
    ];
    let rejected = 0;
    for (const [name, mutant] of controls) {
      let error; try { PHASE_CHECKS.find(x => x[0] === name)[1](mutant); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', 'intended control must fail its own assertion: ' + name);
      rejected++;
    }
    assert.equal(rejected, PHASE_CHECKS.length);
    console.log(`PHASE CONTROLS OK (${rejected} intended rejecting mutants)`);
  }
}

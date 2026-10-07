// P2k2a: real Unit/Battery/Combat/Game with pure launch/result and coordinated save adapters.
// No browser, source mutations, RNG preview, generated fixtures or dependency on .out.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedDeployment, savedOutcome, DEPLOYMENT_LIMITS } from '../src/franchise/practice.js';
import { completedSnapshot, validateSnapshot, exportSnapshot, createProgressStore, exchangeDepot, MAX_SAVE_BYTES } from '../src/franchise/save.js';
import { SAMPLE_ARMY, itemDef } from '../src/reward/data.js';
import { rollLoot, seedOf } from '../src/reward/model.js';
import { Unit, setMenPerFigure, MEN_PER_FIGURE } from '../src/units/unit.js';
import { Battery } from '../src/units/battery.js';
import { Combat } from '../src/sim/combat.js';
import { Game } from '../src/game.js';
import { LOOK } from '../src/ui/look.js';
import { ArrowLayer } from '../src/ui/arrows.js';
import * as THREE from 'three';

const copy = (v) => structuredClone(v), ground = JSON.parse(readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const bindings = ['src/franchise/practice.js', 'tools/test-deployment.mjs', 'src/franchise/save.js', 'src/reward/model.js',
  'src/reward/data.js', 'src/units/unit.js', 'src/units/battery.js', 'src/sim/combat.js', 'src/game.js',
  'src/ui/arrows.js', 'src/ui/input.js', 'src/sim/rules.js', 'src/franchise/intro.js', 'assets/scenarios/henry-hill.json'];
const source = bindings.map((path) => { const b = readFileSync(new URL('../' + path, import.meta.url)); return { path, bytes: b.length, sha256: hash(b) }; });
console.log('DEPLOYMENT SOURCE ' + JSON.stringify(source));
const terrain = { half: 1300, heightAt: () => 0, slopeAt: () => 0, inBounds: (x, z) => Math.abs(x) <= 1300 && Math.abs(z) <= 1300 };
function baseline() {
  const army = [copy(SAMPLE_ARMY[4]), ...copy(SAMPLE_ARMY.slice(0, 2)), { ...copy(SAMPLE_ARMY[2]), men: 0 },
    { ...copy(SAMPLE_ARMY[5]), men: 83, guns: 0 }, { ...copy(SAMPLE_ARMY[3]), id: 'saved-enemy-0', men: 0 }];
  army[0].men = 120;
  return completedSnapshot({ awardId: 'old-award', army, depot: [{ uid: 'old-depot', itemId: 'spencer', tier: 'legendary', conditionId: 'arsenalNew', source: 'capture', from: 'Old fictional capture' }], issued: [], seed: 902, grade: 'Victory' });
}
function args(change = () => {}) {
  const a = { baseline: baseline(), ground: copy(ground), awardId: 'saved-test-new', seed: 'saved-test-new' };
  change(a); return a;
}
function actual(manifest) {
  const oldDensity = MEN_PER_FIGURE, oldSpacing = LOOK.formationSpacing;
  try {
    setMenPerFigure(5); LOOK.formationSpacing = 1.5;
    let allocations = 0;
    const gunPool = { alloc: () => ({ gun: allocations++, limber: allocations }) };
    const units = manifest.scenario.units.map((d, i) => d.type === 'artillery'
      ? new Battery(d, {}, gunPool, terrain, 100 + i) : new Unit(d, {}, terrain, 100 + i));
    const game = Object.assign(Object.create(Game.prototype), { units, terrain, scenario: manifest.scenario,
      playerSide: 'US', simTime: 0, clockStart: 50400, clockEnd: 50580, over: false, holder: null,
      objective: manifest.scenario.objective, event() {}, alert() {}, emit() {}, orders: 0 });
    game.combat = new Combat({ units, terrain, fallen: {}, coverAt: () => ({ value: 1, kind: 'open' }), rnd: () => 0.5,
      fx: { volley() {}, boom() {} } });
    game.fieldCaptures = { held: () => manifest.scenario.crates.map((c) => ({ id: c.id, tier: c.tier })) };
    return game;
  } finally { setMenPerFigure(oldDensity); LOOK.formationSpacing = oldSpacing; }
}
function fixture(a = api, change = () => {}) {
  const input = args(change), manifest = a.launch(input), game = a.actual(manifest);
  game.over = true; game.result = { winner: 'US', why: 'Actual terminal test fixture' };
  return { input, manifest, game };
}
const api = { launch: savedDeployment, outcome: savedOutcome, actual, reserve: (m) => m.reserve,
  complete: (s, result, previous) => s.complete(result, { previous }) };
const broken = (v) => ({ ...api, ...v });
const changedLaunch = (fn) => broken({ launch: (input) => fn(copy(savedDeployment(input)), input) });
const changedOutcome = (fn) => broken({ outcome: (input) => fn(copy(savedOutcome(input)), input) });
const skipRefusal = (change) => broken({ launch: (input) => savedDeployment(change(copy(input))) });
const checks = [];
function test(name, check, mutant) { checks.push({ name, check, mutant }); }
function assertions(name) {
  return { eq: (a, b, why) => assert.deepEqual(a, b, `${name}: ${why}`), ok: (v, why) => assert.ok(v, `${name}: ${why}`),
    refuses: (f, why) => { let error; try { f(); } catch (e) { error = e; }
      if (error && (!/^Practice:|^Progress:/.test(error.message) || !(error instanceof Error))) throw error;
      assert.ok(error instanceof Error, `${name}: ${why}`); },
    refusesAsync: async (f, pattern, why) => { let error; try { await f(); } catch (e) { error = e; }
      if (error && (!(error instanceof Error) || !pattern.test(error.message))) throw error;
      assert.ok(error instanceof Error, `${name}: ${why}`); } };
}

test('whole-army-and-dormant', (a, t) => {
  const f = fixture(a); t.eq(f.manifest.scenario.units.filter((u) => u.side === 'US').map((u) => u.id), ['b1', 'b2', 'bA'], 'every capable formation, infantry first');
  t.eq(f.manifest.dormant, ['b3', 'bB', 'saved-enemy-0'], 'all dormant records retained');
  t.eq(f.manifest.baseline, f.input.baseline, 'canonical exact baseline');
}, changedLaunch((m) => { m.scenario.units.splice(1, 1); return m; }));

test('deep-freeze-and-input-isolation', (a, t) => {
  const input = args(), before = copy(input), m = a.launch(input);
  t.eq(input, before, 'launch never mutates input');
  for (const v of [m, m.baseline, m.baseline.army[0].base, m.baseline.depot[0], m.scenario.sites[0], m.scenario.opening[0].points[0], m.scenario.units[0].equipment, m.footprints[0]]) t.ok(Object.isFrozen(v), 'deeply frozen record');
  input.baseline.army[0].weapon.from = 'changed'; input.ground.sites[0].name = 'changed';
  t.eq(m.baseline, before.baseline, 'no input alias'); t.eq(m.scenario.sites, before.ground.sites, 'nested terrain definitions copied');
}, changedLaunch((m) => m));

test('namespace-and-fictional-source', (a, t) => {
  const { manifest: m } = fixture(a); const enemy = m.scenario.units.find((u) => u.side === 'CS');
  t.eq(enemy.id, 'saved-enemy-1', 'namespace skips dormant player ID'); t.eq(m.scenario.opening[0].id, enemy.id, 'opening uses namespaced ID');
  t.eq(enemy.name, 'Opposing Practice Brigade', 'generic enemy, no commander presence'); t.eq(enemy.commander, null, 'no invented commander');
  t.eq(m.scenario.savedPractice, true, 'explicit saved route'); t.eq(m.scenario.practiceIntro, true, 'unchanged held-ground doctrine');
  t.ok(/Fictional/.test(m.scenario.historyNote), 'explicit fictional history'); t.eq(args().ground, ground, 'original scenario unchanged');
}, changedLaunch((m) => { m.scenario.units.find((u) => u.side === 'CS').id = 'saved-enemy-0'; return m; }));

test('no-infantry-refusal', (a, t) => {
  const input = args((v) => { v.baseline.army = v.baseline.army.filter((b) => b.kind === 'battery'); });
  t.refuses(() => a.launch(input), 'no infantry allocates no field');
}, skipRefusal((v) => { v.baseline.army.push(copy(SAMPLE_ARMY[0])); return v; }));

test('whole-launch-limits-refusal', (a, t) => {
  const changes = [
    (v) => { v.baseline.army[1].men = 3001; }, (v) => { v.baseline.army[0].men = 121; },
    (v) => { v.baseline.army[0].guns = 7; },
    (v) => { v.baseline.army = Array.from({ length: 6 }, (_, i) => ({ ...copy(SAMPLE_ARMY[0]), id: 'small-' + i, men: 100, weapon: { ...copy(SAMPLE_ARMY[0].weapon), uid: 'small-gear-' + i } })); },
    (v) => { v.baseline.army = copy(SAMPLE_ARMY); v.baseline.army[4].men = v.baseline.army[5].men = 120; },
    (v) => { v.baseline.army = copy(SAMPLE_ARMY.slice(0, 3)); v.baseline.army[0].men = 2800; v.baseline.army[1].men = 2500; v.baseline.army[2].men = 2100; },
  ];
  for (const c of changes) t.refuses(() => a.launch(args(c)), 'individual/aggregate/count refusal without cuts');
}, broken({ launch: () => savedDeployment(args()) }));

test('actual-max-footprint-and-allocation', (a, t) => {
  const input = args((v) => { v.baseline.army = copy(SAMPLE_ARMY.slice(0, 3)); v.baseline.army[0].men = 2000; v.baseline.army[1].men = 2000; v.baseline.army[2].men = 3000;
    for (let i = 4; i < 6; i++) v.baseline.army.push({ ...copy(SAMPLE_ARMY[i]), men: 120 }); });
  const m = a.launch(input), g = a.actual(m);
  t.eq(m.allocation, { formations: 5, men: 7240, guns: 12, figures: 1490 }, 'Henry-equivalent maximum allocation');
  t.eq(g.units.filter((u) => u.side === 'US').reduce((n, u) => n + u.figures.length + 6, 0), 1490, 'actual densest construction count');
  for (const u of g.units.filter((u) => u.side === 'US')) {
    const f = m.footprints.find((x) => x.id === u.id);
    t.ok(u.figures.every((v) => Math.abs(v.x) <= 1280 && Math.abs(v.z) <= 1280), 'actual figure world bounds');
    t.ok(u.figures.every((v) => Math.abs(v.x - f.x) <= f.halfDepth && Math.abs(v.z - f.z) <= f.halfWidth), 'admission encloses actual geometry');
    t.ok(u.contains(u.x, u.z), 'pickable footprint');
    for (const gs of u.gunSlots || []) t.ok(Math.abs(gs.lmx) <= 1280 && Math.abs(gs.lmz) <= 1280, 'actual limber bounds');
  }
  for (let i = 1; i < m.footprints.length; i++) t.ok(Math.abs(m.footprints[i].x - m.footprints[i - 1].x) >= 170, 'disjoint footprint and20m gap');
  g.checkObjective(0.1); t.eq(g.holder, 'US', 'first living infantry actually holds objective'); t.eq(g.over, false, 'launch is playable');
}, broken({ actual: (m) => { const g = actual(m); g.units[0].figures[0].x = 1301; return g; } }));

test('headroom-slots-no-rng', (a, t) => {
  const base = baseline(), item = base.depot[0];
  for (const [n, allowed] of [[1993, true], [1994, false], [2000, false]]) {
    const input = args((v) => { v.baseline.depot = Array.from({ length: n }, (_, i) => ({ ...item, uid: 'depot-' + i })); });
    if (allowed) { const m = a.launch(input); t.eq(a.reserve(m).cards, 7, 'source-bound worst loot reserve'); }
    else t.refuses(() => a.launch(input), 'full depot refuses before battle');
  }
  const old = Math.random; let draws = 0;
  try { Math.random = () => { draws++; return 0.2; }; a.launch(args()); } finally { Math.random = old; }
  t.eq(draws, 0, 'preview consumes no global random/IDs');
}, skipRefusal((v) => { v.baseline.depot = []; return v; }));

test('utf8-json-headroom', (a, t) => {
  // Lone surrogates cost6 JSON bytes. This legal save is below1MiB but lacks result headroom.
  let input = args((v) => { v.baseline.depot = Array.from({ length: 970 }, (_, i) => ({ uid: 'd-' + i,
    itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: '\ud800'.repeat(160) })); });
  let n = 970;
  while (true) { const b = validateSnapshot(input.baseline); if (new TextEncoder().encode(exportSnapshot(b)).length > MAX_SAVE_BYTES - 1500) break;
    input.baseline.depot.push({ ...input.baseline.depot[0], uid: 'd-' + n++ }); }
  t.ok(new TextEncoder().encode(exportSnapshot(input.baseline)).length <= MAX_SAVE_BYTES, 'near-limit input valid');
  t.refuses(() => a.launch(input), 'reserve counts JSON escaping and metadata before allocation');
}, skipRefusal((v) => { v.baseline.depot = []; return v; }));

test('fresh-award-and-uid-reservation', (a, t) => {
  t.refuses(() => a.launch(args((v) => { v.awardId = v.baseline.awardId; })), 'old award cannot skip loss save');
  t.refuses(() => a.launch(args((v) => { v.awardId = 'a'.repeat(100); })), 'new UID length cannot overflow');
  t.refuses(() => a.launch(args((v) => { v.baseline.depot[0].uid = `${v.awardId}.L${seedOf(v.seed).toString(36)}-6`; })), 'any reserved ordinal collision refuses, never rerolls');
}, skipRefusal((v) => { v.awardId = 'replacement'; return v; }));

test('manifest-authenticity', (a, t) => {
  const f = fixture(); t.refuses(() => a.outcome({ manifest: copy(f.manifest), game: f.game }), 'clone cannot replace launch baseline');
}, broken({ outcome: () => savedOutcome(fixture()) }));

test('conserve-all-fields-and-ledger', (a, t) => {
  const input = args((v) => { v.baseline = exchangeDepot(v.baseline, { brigadeId: 'b1', itemUid: 'old-depot' }); });
  const m = a.launch(input), game = actual(m); game.over = true; game.result = { winner: 'US', why: 'test' };
  game.units.find((u) => u.id === 'b1').men = 1777.9;
  game.units.find((u) => u.id === 'bA').men = 99.4; game.units.find((u) => u.id === 'bA').gunSlots[0].alive = false;
  const o = a.outcome({ manifest: m, game });
  t.eq(o.snapshot.army.map((b) => b.id), input.baseline.army.map((b) => b.id), 'original saved army order');
  for (const b of o.snapshot.army) { const old = input.baseline.army.find((v) => v.id === b.id);
    t.eq({ ...b, men: old.men, ...(b.kind === 'battery' ? { guns: old.guns } : {}) }, old, 'base/vet/label/equipment/provenance and derivedOVR conserved'); }
  t.eq(o.snapshot.issued, input.baseline.issued, 'old issued prefix retained'); t.eq(o.snapshot.depot.slice(0, input.baseline.depot.length), input.baseline.depot, 'old depot retained');
  t.eq(o.snapshot.army.find((b) => b.id === 'b1').men, 1777, 'floor actual survivors');
  t.eq(o.snapshot.army.find((b) => b.id === 'bA').guns, 5, 'actual live guns');
  t.eq(o.summary.losses, (1840 - 1777) + (120 - 99), 'no loss/invented reinforcements');
}, changedOutcome((o) => { o.snapshot.issued = []; return o; }));

test('dormant-and-zero-crew-conservation', (a, t) => {
  const f = fixture(a, (v) => { v.baseline.army[3] = { ...v.baseline.army[3], kind: 'battery', guns: 6, weapon: { ...v.baseline.army[3].weapon, itemId: 'sixPdr' } }; });
  f.game.units.find((u) => u.id === 'bA').men = 0.8;
  const o = a.outcome(f);
  for (const id of f.manifest.dormant) t.eq(o.snapshot.army.find((b) => b.id === id), f.manifest.baseline.army.find((b) => b.id === id), 'dormant byte-equivalent');
  const live = o.snapshot.army.find((b) => b.id === 'bA'); t.eq([live.men, live.guns], [0, 0], 'deployed gun loss with no surviving crew');
}, changedOutcome((o) => { o.snapshot.army.find((b) => b.id === 'bB').guns = 0; o.snapshot.army.find((b) => b.id === 'b3').guns = 0; return o; }));

test('victory-defeat-and-fresh-loot', (a, t) => {
  for (const winner of ['US', 'CS']) { const f = fixture(a); f.game.result.winner = winner;
    const o = a.outcome(f), expected = rollLoot({ seed: f.manifest.seed, grade: winner === 'US' ? 'Victory' : 'Defeat', captures: o.captures });
    t.eq(o.snapshot.grade, winner === 'US' ? 'Victory' : 'Defeat', 'actual winner grade');
    t.eq(o.cards, expected.cards.map((c) => ({ ...c, uid: `${f.manifest.awardId}.${c.uid}` })), 'actual deterministic roll once');
    t.eq(o.snapshot.depot, [...f.manifest.baseline.depot, ...o.cards], 'all new loot appended, no inherited display copies');
    t.ok(o.cards.length > 0 && o.cards.length <= f.manifest.reserve.cards, 'nonempty bounded loot');
    t.ok(new TextEncoder().encode(exportSnapshot(o.snapshot)).length <= f.manifest.reserve.bytes, 'actual result fits reservation');
  }
}, changedOutcome((o) => { o.snapshot.grade = 'Victory'; return o; }));

test('exact-once-frozen-terminal', (a, t) => {
  const f = fixture(a), first = a.outcome(f), text = JSON.stringify(first);
  t.ok(Object.isFrozen(first) && Object.isFrozen(first.snapshot.army[0].weapon) && Object.isFrozen(first.cards[0]), 'immutable terminal state');
  f.game.units[0].men = 0; f.game.result.winner = 'CS'; f.game.fieldCaptures.held = () => [];
  const second = a.outcome(f); t.eq(second, first, 'later fight-on cannot rebase'); t.eq(JSON.stringify(second), text, 'byte-stable reentry');
}, broken({ outcome: (input) => copy(savedOutcome(input)) }));

test('invalid-terminal-and-roster-refusal', (a, t) => {
  const changes = [(g) => { g.over = false; }, (g) => { g.playerSide = 'CS'; }, (g) => { g.result.winner = 'unknown'; },
    (g) => { g.units.pop(); }, (g) => { g.units[0].xp = 4; }, (g) => { g.units[0].menMax++; },
    (g) => { g.units[0].name = 'changed'; }, (g) => { g.units[0] = { ...g.units[0], equipment: { ...g.units[0].equipment, from: 'changed' } }; },
    (g) => { g.scenario = copy(g.scenario); }, (g) => { g.units[0] = null; }, (g) => { delete g.units[0]; },
    (g) => { g.units.push(g.units[0]); }, (g) => { g.units[0].men = NaN; }, (g) => { g.units[0].men = Infinity; },
    (g) => { g.units[0].men = -1; }, (g) => { g.units[0].men++; },
    (g) => { g.units.find((u) => u.type === 'artillery').gunSlots.pop(); },
    (g) => { g.units.find((u) => u.type === 'artillery').gunSlots[0].alive = 1; },
    (g) => { delete g.units.find((u) => u.type === 'artillery').gunSlots[0]; },
    (g) => { g.units.find((u) => u.type === 'artillery').gunSlots[0] = null; }];
  for (const c of changes) { const f = fixture(); c(f.game); t.refuses(() => a.outcome(f), 'altered runtime cannot update conserved save'); }
}, broken({ outcome: () => { const f = fixture(); return savedOutcome(f); } }));

test('capture-integrity-refusal', (a, t) => {
  for (const held of [[{ id: 'invented', tier: 'rare' }], [{ id: 'near-stores', tier: 'common' }], [{ id: 'near-stores', tier: 'rare' }, { id: 'near-stores', tier: 'rare' }]]) {
    const f = fixture(); f.game.fieldCaptures.held = () => held; t.refuses(() => a.outcome(f), 'real unique held captures only'); }
}, broken({ outcome: ({ manifest, game }) => savedOutcome({ manifest, game: { ...game, fieldCaptures: { held: () => [] } } }) }));

test('actual-combat-and-ghost', (a, t) => {
  const f = fixture(a); const u = f.game.units.find((v) => v.id === 'b1'), enemy = f.game.units.find((v) => v.side === 'CS');
  t.eq(u.equipment, f.manifest.baseline.army.find((b) => b.id === 'b1').weapon, 'actual equipment identity');
  t.eq(f.game.range(u), 300 * 0.9144, 'named range uses accepted adapter');
  const layer = new ArrowLayer(new THREE.Scene(), terrain); layer.setPreview([[u.x, u.z], [u.x + 50, u.z]], u.side, 2, u.halfFront, { facing: u.facing, arc: { range: f.game.range(u) } });
  t.ok(layer.previewGhost.children.length > 0, 'actual ghost built');
  const arc = layer.previewGhost.children.find((v) => v.material === layer.arcMats.US).geometry.attributes.position;
  let radius = 0; for (let i = 0; i < arc.count; i++) radius = Math.max(radius, Math.hypot(arc.getX(i) - u.x - 50, arc.getZ(i) - u.z));
  t.ok(Math.abs(radius - 300 * 0.9144) <= 0.0005, 'actual Float32 ghost range');
  enemy.vehicle.position.x = u.x + 75; enemy.vehicle.position.z = u.z; enemy.facing = -Math.PI / 2;
  const before = enemy.men; u.target = enemy;
  for (let i = 0; i < 40; i++) f.game.combat.fireStep(u, 0.25, i * 0.25);
  t.ok(u.shots > 0 && enemy.men < before, 'normal named stepping inflicts real loss');
  const o = a.outcome(f); t.eq(o.snapshot.army[1].weapon, f.manifest.baseline.army[1].weapon, 'combat cannot replace weapon');
}, broken({ actual: (m) => { const g = actual(m); g.combat.range = () => 100; return g; } }));

test('save-quota-retry-stale-and-duplicate', async (a, t) => {
  const f = fixture(), o = savedOutcome(f), result = o.snapshot, baseline = f.manifest.baseline;
  let raw = exportSnapshot(baseline), puts = 0, quota = true;
  const store = createProgressStore({ getItem: () => raw, setItem: (k, v) => { if (quota) throw new Error('Quota'); puts++; raw = v; } },
    { locks: { request: async (k, opts, fn) => fn() } });
  const text = exportSnapshot(result);
  await t.refusesAsync(() => a.complete(store, result, baseline), /could not save/, 'intended quota refusal');
  t.eq(puts, 0, 'quota no partial write'); t.eq(raw, exportSnapshot(baseline), 'quota preserves saved baseline');
  quota = false; await a.complete(store, result, baseline); t.eq(raw, text, 'retry exact pending bytes'); t.eq(puts, 1, 'commit exactly once');
  const receipt = await a.complete(store, result, baseline); t.eq(receipt.duplicate, true, 'same result idempotent'); t.eq(puts, 1, 'duplicate no write');
  raw = exportSnapshot({ ...baseline, awardId: 'other-tab' });
  await t.refusesAsync(() => a.complete(store, result, baseline), /changed/, 'stale baseline refuses');
  t.eq(raw, exportSnapshot({ ...baseline, awardId: 'other-tab' }), 'no stale-tab overwrite'); t.eq(puts, 1, 'stale0newwrites'); t.eq(exportSnapshot(result), text, 'failed result/export retains exact seed/loot');
}, broken({ complete: async (store, result, previous) => { try { return await store.complete(result, { previous }); } catch { return { saved: true }; } } }));

test('full-issued-prefix-no-new-transfers', (a, t) => {
  const input = args(), first = input.baseline.army.find((b) => b.id === 'b1'), old = first.weapon;
  const next = input.baseline.depot[0]; first.weapon = { ...next }; input.baseline.depot = [{ ...old, depot: true }];
  input.baseline.issued = Array.from({ length: 5000 }, (_, i) => i % 2 === 1 ? { brigade: 'b1', item: next.uid, displaced: old.uid } : { brigade: 'b1', item: old.uid, displaced: next.uid });
  // Even exchange pairs end at next only when reverse record count is odd; use4999 plus one other brigade exchange.
  input.baseline.issued = input.baseline.issued.slice(1); // starts next->old history and reverses consistently at current next
  const second = input.baseline.army.find((b) => b.id === 'b2'), spare = { ...second.weapon, uid: 'spare-b2' };
  input.baseline.depot.push({ ...second.weapon, depot: true }); second.weapon = spare;
  input.baseline.issued.push({ brigade: 'b2', item: spare.uid, displaced: input.baseline.depot[1].uid });
  input.baseline = validateSnapshot(input.baseline);
  const m = a.launch(input), g = actual(m); g.over = true; g.result = { winner: 'US', why: 'test' };
  t.eq(a.outcome({ manifest: m, game: g }).snapshot.issued, input.baseline.issued, 'legal5000 rows conserved without an appended issue');
}, changedOutcome((o) => { o.snapshot.issued = o.snapshot.issued.slice(1); return o; }));

let failures = 0;
for (const { name, check, mutant } of checks) {
  const t = assertions(name);
  try {
    if (process.argv.includes('--prove-fail')) {
      let rejection;
      try { await check(mutant, t); } catch (e) { rejection = e; }
      assert.ok(rejection instanceof assert.AssertionError && rejection.message.startsWith(name + ':'), `${name}: mutant must hit its intended AssertionError, not a harness crash`);
      console.log(`ok ${name}: intended assertion rejected mutant`);
    } else { await check(api, t); console.log('ok ' + name); }
  } catch (e) { failures++; console.error(`FAIL ${name}: ${e.stack}`); }
}
assert.ok(checks.length > 0, 'nonempty deployment coverage');
console.log(`DEPLOYMENT ${process.argv.includes('--prove-fail') ? 'CONTROLS ' : ''}${failures ? 'FAILED' : 'OK'} (${checks.length - failures}/${checks.length})`);
process.exitCode = failures ? 1 : 0;

// CPU check: the campaign model (src/franchise/campaign.js), save v2 + three slots (src/franchise/save.js) and the
// pack-phase reward bridge (phaseOutcome in src/franchise/practice.js). A fixture campaign with two fictional packs
// is built here from assets/scenarios/henry-hill.json; nothing ships for it and nothing is written to disk.
// `node tools/test-campaign.mjs` prints CAMPAIGN OK (n/n); `--prove-fail` also runs one mutant per check and requires
// each to fail that check, with the check's own name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import { phaseOutcome, awardCards } from '../src/franchise/practice.js';
import { SAMPLE_ARMY } from '../src/reward/data.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const SHIPPED = JSON.parse(fs.readFileSync(new URL('../assets/campaign.json', import.meta.url)));
const copy = structuredClone;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const API = { ...campaign, ...save, phaseOutcome, awardCards };

// ---- fixtures: fictional packs on Henry Hill ground and a two-formation franchise ---------------------------------
function phaseScenario(id, extra = {}, drop = []) {
  const s = copy(HH);
  s.id = 'test-' + id; s.title = 'Fictional campaign phase ' + id + ' (test only)'; s.attacker = 'US'; s.end = '14:01';
  s.units = s.units.filter((u) => !drop.includes(u.id));
  return Object.assign(s, extra);
}
const PACKS = {
  alpha: { a1: phaseScenario('a1'),
    a2: phaseScenario('a2', { opening: [{ id: 'bee', points: [[100, 100], [120, 140]] }, { id: 'jackson', points: [[0, 300], [10, 320]] }] }) },
  bravo: { b1: phaseScenario('b1', {}, ['staunton']) },
};
const CAMPAIGN = { version: 1, id: 'test-west', title: 'Fictional test campaign', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'springfield', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'napoleon', vet: 'veteran' }],
phases: [{ packId: 'alpha', phaseId: 'a1', loan: true }, { packId: 'alpha', phaseId: 'a2' }, { packId: 'bravo', phaseId: 'b1' }] };
// End strengths per phase (fictional): a1 is a loan defeat, a2 a victory, b1 a decisive victory.
const PLAYS = {
  a1: { winner: 'CS', grade: 'defeat', men: { sherman: 1000, jackson: 1600, bee: 0, hampton: 300 }, guns: { rockbridge: 2 } },
  a2: { winner: 'US', grade: 'victory', men: { sherman: 2000, ricketts: 40, jackson: 1500 }, guns: { ricketts: 3 } },
  b1: { winner: 'US', grade: 'decisive', men: { sherman: 1900 }, guns: {} },
};

function fakeGame(scenario, { winner, grade, men = {}, guns = {} }) {
  const units = [...scenario.units, ...(scenario.reinforcements || [])].map((d) => ({ id: d.id, side: d.side, type: d.type || 'infantry',
    name: d.name, menMax: d.men, men: Math.min(d.men, men[d.id] ?? d.men), weapon: d.weapon || 'smooth', xp: d.xp || 1, equipment: d.equipment,
    ...(d.type === 'artillery' ? { gunSlots: Array.from({ length: d.guns }, (_, i) => ({ alive: i < (guns[d.id] ?? d.guns) })) } : {}) }));
  return { scenario, over: true, playerSide: 'US', result: { winner, draw: winner === null, grade, why: 'Fictional test result' }, units,
    fieldCaptures: { held: () => [] } };
}
function play(api, before, { replay = false, outcome } = {}) {
  const phase = api.campaignPhase(before, CAMPAIGN, { replay });
  const authored = PACKS[phase.packId][phase.phaseId], authoredBytes = JSON.stringify(authored);
  const scenario = api.applyCampaign(authored, before, phase);
  assert.equal(JSON.stringify(authored), authoredBytes, 'applyCampaign changed its input scenario');
  const game = fakeGame(scenario, outcome || PLAYS[phase.phaseId]);
  const { outcome: result, record } = api.phaseResult({ phase, game, scenario });
  return { phase, scenario, result, record, after: api.recordPhase(before, CAMPAIGN, record) };
}
function ladder(api) {
  const s0 = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
  const p1 = play(api, s0), p2 = play(api, p1.after), p3 = play(api, p2.after);
  return { s0, p1, p2, p3 };
}
const unit = (s, id) => s.units.find((u) => u.id === id);
const brigade = (s, id) => s.army.find((b) => b.id === id);
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  const mem = { data, writes: 0, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem(k, v) { this.writes++; data.set(k, v); } };
  mem.locks = { calls: [], request(name, options, run) {
    this.calls.push(name); const next = tail.then(run); tail = next.catch(() => {}); return next;
  } };
  return mem;
}
const v1Save = () => save.completedSnapshot({ awardId: 'practice-v1', army: copy(SAMPLE_ARMY), depot: [], issued: [], seed: 7, grade: 'Victory' });
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}

export const CAMPAIGN_CHECKS = [
  ['shipped-campaign', (api) => {
    const c = api.validateCampaign(SHIPPED);
    assert.ok(c.id === 'west' && c.version === 1 && c.franchise.length > 0 && c.phases.length > 0, 'shipped-campaign: shipped ladder validates with a roster and phases');
    const started = api.newCampaign({ campaign: SHIPPED, slot: 1, seed: 1 });
    assert.ok(started.campaign.index === 0 && started.army.length === c.franchise.length, 'shipped-campaign: shipped ladder starts at its first phase with the whole roster');
    assert.equal(api.campaignPhase(started, SHIPPED).phaseId, c.phases[0].phaseId, 'shipped-campaign: first phase is the ladder head');
    const bad = [{ ...CAMPAIGN, extra: 1 }, { ...CAMPAIGN, version: 2 },
      { ...CAMPAIGN, phases: [...CAMPAIGN.phases, { packId: 'alpha', phaseId: 'a3' }] },
      { ...CAMPAIGN, phases: [{ packId: 'alpha', phaseId: 'a1', loan: false }] },
      { ...CAMPAIGN, phases: [{ packId: 'alpha', phaseId: 'a1' }, { packId: 'alpha', phaseId: 'a1' }] },
      { ...CAMPAIGN, franchise: [{ ...CAMPAIGN.franchise[0], weapon: 'napoleon' }] },
      { ...CAMPAIGN, franchise: [{ ...CAMPAIGN.franchise[0], guns: 2 }] },
      { ...CAMPAIGN, franchise: [{ ...CAMPAIGN.franchise[0], unitId: 'has.dot' }] },
      { ...CAMPAIGN, franchise: [CAMPAIGN.franchise[0], CAMPAIGN.franchise[0]] },
      { ...CAMPAIGN, phases: [{ packId: 'alpha', phaseId: 'x'.repeat(40) }], id: 'y'.repeat(40) }];
    for (const json of bad) refuses('shipped-campaign', () => api.validateCampaign(json), /^Campaign: /);
  }],
  ['new-campaign', (api) => {
    const s = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
    assert.deepEqual([s.version, s.kind, s.slot, s.grade, s.awardId, s.updated], [2, 'campaign', 1, null, 'test-west.1.start', '2026-10-11T12:00:00Z'], 'new-campaign: save header');
    assert.deepEqual(s.campaign, { id: 'test-west', index: 0, status: 'in-progress', history: [], carry: {} }, 'new-campaign: campaign position');
    assert.deepEqual(s.army.map((b) => [b.id, b.unitId, b.kind, b.men, b.guns, b.vet, b.weapon.itemId]),
      [['sherman', 'sherman', 'infantry', 2500, undefined, 'trained', 'springfield'], ['ricketts', 'ricketts', 'battery', 110, 5, 'veteran', 'napoleon']], 'new-campaign: franchise roster as army');
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(s)), s, 'new-campaign: export does not round-trip');
    const p = api.campaignPhase(s, CAMPAIGN);
    assert.deepEqual({ ...p }, { packId: 'alpha', phaseId: 'a1', loan: true, index: 0, isLast: false, replay: false, attempt: 1,
      awardId: 'test-west.1.alpha.a1.1', seed: '1862:test-west.1.alpha.a1.1' }, 'new-campaign: first phase');
  }],
  ['loan-untouched', (api) => {
    const { s0, p1 } = ladder(api);
    for (const id of ['sherman', 'ricketts']) {
      assert.deepEqual(unit(p1.scenario, id), HH.units.find((u) => u.id === id), `loan-untouched: loan phase fielded franchise state for ${id}`);
    }
    assert.deepEqual(p1.after.army, s0.army, 'loan-untouched: loan phase wrote the franchise army');
    assert.ok(!has(p1.after.campaign.carry, 'sherman') && !has(p1.after.campaign.carry, 'ricketts'), 'loan-untouched: franchise units entered historical carry');
    assert.deepEqual(p1.after.campaign.history, [{ packId: 'alpha', phaseId: 'a1', awardId: 'test-west.1.alpha.a1.1', winner: 'CS', grade: 'Defeat',
      lossesUS: 2000, lossesCS: 3200, replay: false }], 'loan-untouched: history row');
    assert.ok(p1.after.depot.length > 0 && p1.after.depot.every((it) => it.uid.startsWith('test-west.1.alpha.a1.1.')), 'loan-untouched: loan loot missing from the depot');
  }],
  ['defeat-advances', (api) => {
    const { p1 } = ladder(api);
    assert.deepEqual([p1.after.campaign.index, p1.after.campaign.status, p1.after.grade], [1, 'in-progress', 'Defeat'], 'defeat-advances: defeat did not advance');
    const next = api.campaignPhase(p1.after, CAMPAIGN);
    assert.deepEqual([next.packId, next.phaseId, next.loan, next.index], ['alpha', 'a2', false, 1], 'defeat-advances: wrong next phase');
  }],
  ['franchise-applied', (api) => {
    const { p2 } = ladder(api), s = p2.scenario;
    const sherman = unit(s, 'sherman'), ricketts = unit(s, 'ricketts');
    assert.deepEqual([sherman.men, sherman.xp, sherman.weapon, sherman.equipment?.itemId, sherman.equipment?.uid], [2500, 2, 'smooth', 'springfield', 'test-west.1.muster.sherman'], 'franchise-applied: infantry state');
    assert.deepEqual([ricketts.men, ricketts.guns, ricketts.xp, ricketts.weapon, ricketts.equipment?.itemId], [110, 5, 3, 'smbart', 'napoleon'], 'franchise-applied: battery state');
    assert.equal(unit(s, 'jackson').men, 1600, 'franchise-applied: carried enemy strength missing');
    assert.doesNotThrow(() => prepareFieldScenario(s, 'pack'), 'franchise-applied: applied scenario is not an admissible field');
  }],
  ['carry-depletes-only', (api) => {
    const { p1, p2 } = ladder(api);
    assert.equal(unit(p2.scenario, 'bee'), undefined, 'carry-depletes-only: a destroyed unit returned');
    assert.deepEqual(p2.scenario.opening.map((o) => o.id), ['jackson'], 'carry-depletes-only: opening kept a removed unit');
    assert.deepEqual([unit(p2.scenario, 'hampton').men, unit(p2.scenario, 'rockbridge').guns], [300, 2], 'carry-depletes-only: carried men or guns missing');
    const inflated = api.validateSnapshot({ ...p1.after, campaign: { ...p1.after.campaign, carry: { ...p1.after.campaign.carry, jackson: { men: 99999 }, franklin: { men: 5 } } } });
    const s = api.applyCampaign(PACKS.alpha.a2, inflated, api.campaignPhase(inflated, CAMPAIGN));
    assert.deepEqual([unit(s, 'jackson').men, unit(s, 'franklin').men], [2600, 5], 'carry-depletes-only: carry inflated or ignored');
    assert.deepEqual(p2.after.campaign.carry.jackson, { men: 1500 }, 'carry-depletes-only: carry not written after the phase');
    assert.deepEqual(p2.after.campaign.carry.bee, { men: 0 }, 'carry-depletes-only: an absent unit lost its carried state');
  }],
  ['franchise-losses', (api) => {
    const { p1, p2 } = ladder(api);
    const sherman = brigade(p2.after, 'sherman'), ricketts = brigade(p2.after, 'ricketts');
    assert.deepEqual([sherman.men, sherman.vet], [2000, 'veteran'], 'franchise-losses: infantry losses or battle-end promotion');
    assert.deepEqual([ricketts.men, ricketts.guns, ricketts.vet], [40, 3, 'trained'], 'franchise-losses: battery losses or heavy-loss demotion');
    assert.ok(sherman.weapon.uid === brigade(p1.after, 'sherman').weapon.uid, 'franchise-losses: equipment changed');
    const row = p2.after.campaign.history[1];
    assert.deepEqual([row.lossesUS, row.lossesCS, row.winner, row.grade], [570, 100, 'US', 'Victory'], 'franchise-losses: history losses');
  }],
  ['new-battle-clears-carry', (api) => {
    const { p2, p3 } = ladder(api);
    assert.equal(unit(p3.scenario, 'jackson').men, 2600, 'new-battle-clears-carry: enemy carry crossed into a new battle');
    assert.deepEqual([unit(p3.scenario, 'sherman').men, unit(p3.scenario, 'sherman').xp, unit(p3.scenario, 'ricketts').guns], [2000, 3, 3], 'new-battle-clears-carry: franchise state not kept');
    assert.ok(!has(p3.after.campaign.carry, 'staunton') && p3.after.campaign.carry.bee.men === 1900, 'new-battle-clears-carry: stale carry kept after a new battle');
    assert.ok(has(p2.after.campaign.carry, 'staunton'), 'new-battle-clears-carry: fixture lost its prior carry');
  }],
  ['replay-marked', (api) => {
    const { p2 } = ladder(api), r = play(api, p2.after, { replay: true, outcome: { winner: 'US', grade: 'victory', men: { sherman: 1800, jackson: 1400 } } });
    assert.deepEqual([r.phase.phaseId, r.phase.attempt, r.phase.awardId, r.phase.replay], ['a2', 2, 'test-west.1.alpha.a2.2', true], 'replay-marked: replay phase identity');
    const row = r.after.campaign.history.at(-1);
    assert.deepEqual([row.phaseId, row.replay, r.after.campaign.index, r.after.campaign.status], ['a2', true, 2, 'in-progress'], 'replay-marked: replay not marked or it advanced');
    assert.deepEqual([brigade(r.after, 'sherman').men, brigade(r.after, 'sherman').vet, r.after.campaign.carry.jackson.men], [1800, 'veteran', 1400], 'replay-marked: replay state');
  }],
  ['idempotent-award', async (api) => {
    const { s0, p1 } = ladder(api);
    assert.deepEqual(api.recordPhase(p1.after, CAMPAIGN, p1.record), p1.after, 'idempotent-award: same award recorded twice');
    const mem = memory(), store = api.createProgressStore(mem, { locks: mem.locks });
    await store.complete(s0);
    const a = await store.complete(p1.after, { previous: s0 }), b = await store.complete(p1.after, { previous: s0 });
    assert.deepEqual([a.duplicate, b.duplicate, mem.writes], [false, true, 2], 'idempotent-award: store rewrote a completed award');
    assert.deepEqual(await store.load(), p1.after, 'idempotent-award: stored award changed');
  }],
  ['last-phase-complete', (api) => {
    const { p3 } = ladder(api);
    assert.deepEqual([p3.after.campaign.index, p3.after.campaign.status, p3.after.grade], [3, 'complete', 'Decisive'], 'last-phase-complete: campaign not complete');
    assert.equal(api.campaignPhase(p3.after, CAMPAIGN), null, 'last-phase-complete: a phase after the last');
    assert.equal(brigade(p3.after, 'sherman').vet, 'elite', 'last-phase-complete: final battle promotion');
    assert.equal(api.campaignPhase(p3.after, CAMPAIGN, { replay: true }).phaseId, 'b1', 'last-phase-complete: last phase cannot be replayed');
    refuses('last-phase-complete', () => api.recordPhase(p3.after, CAMPAIGN, { ...p3.record, packId: 'alpha', phaseId: 'a1', awardId: undefined }), /^Campaign: /);
  }],
  ['slot-isolation', async (api) => {
    const one = JSON.stringify(v1Save()), mem = memory({ 'cw.progress': one });
    const two = api.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 5 });
    const store2 = api.createProgressStore(mem, { locks: mem.locks, slot: 2 });
    await store2.complete(two);
    assert.equal(mem.data.get('cw.progress'), one, 'slot-isolation: slot 2 write changed slot 1 bytes');
    assert.deepEqual([mem.data.get('cw.progress.2'), mem.locks.calls.at(-1), api.slotKey(1), api.slotKey(3)],
      [JSON.stringify(two), 'cw.progress.2', 'cw.progress', 'cw.progress.3'], 'slot-isolation: slot key or lock');
    assert.deepEqual(await store2.load(), two, 'slot-isolation: slot 2 does not load its own save');
    let error = null;
    try { await api.createProgressStore(mem, { locks: mem.locks }).complete(two, { previous: v1Save() }); } catch (e) { error = e; }
    assert.match(String(error?.message), /belongs to save slot 2/, 'slot-isolation: slot 1 accepted a slot 2 campaign');
    assert.equal(mem.data.get('cw.progress'), one, 'slot-isolation: refused write changed slot 1');
    refuses('slot-isolation', () => api.createProgressStore(mem, { slot: 4 }), /^Progress: unknown save slot/);
  }],
  ['v1-unchanged', async (api) => {
    const v1 = v1Save(), raw = JSON.stringify(v1), mem = memory({ 'cw.progress': raw });
    const loaded = await api.createProgressStore(mem, { locks: mem.locks }).load();
    assert.deepEqual(loaded, v1, 'v1-unchanged: v1 save did not load as slot 1');
    assert.deepEqual([loaded.version, loaded.kind, api.exportSnapshot(loaded)], [1, 'completed-reward', raw], 'v1-unchanged: v1 save changed shape');
    const rows = await api.listSlots(mem);
    assert.deepEqual(rows[0], { slot: 1, empty: false, kind: 'completed-reward', label: 'Practice army', nextPhase: null, updated: null }, 'v1-unchanged: v1 slot row');
    refuses('v1-unchanged', () => api.validateSnapshot({ ...v1, army: v1.army.map((b) => ({ ...b, unitId: b.id })) }), /^Progress: missing or unsupported fields/);
  }],
  ['corrupt-slot-listed', async (api) => {
    const s = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 9, at: '2026-10-11T09:30:00Z' });
    const mem = memory({ 'cw.progress': JSON.stringify(s), 'cw.progress.2': '{corrupt' });
    const rows = await api.listSlots(mem, { campaign: CAMPAIGN });
    assert.deepEqual(rows, [
      { slot: 1, empty: false, kind: 'campaign', label: 'Fictional test campaign', nextPhase: { packId: 'alpha', phaseId: 'a1', index: 0 }, updated: '2026-10-11T09:30:00Z' },
      { slot: 2, empty: false, kind: 'corrupt', label: 'Unreadable save', nextPhase: null, updated: null },
      { slot: 3, empty: true, kind: null, label: 'Empty slot', nextPhase: null, updated: null }], 'corrupt-slot-listed: slot rows');
    const broken = { getItem: (k) => { if (k === 'cw.progress.3') throw new Error('blocked'); return null; }, setItem() {} };
    const third = (await api.listSlots(broken))[2];
    assert.deepEqual([third.kind, third.empty], ['unavailable', false], 'corrupt-slot-listed: unreadable storage not reported');
  }],
  ['strict-validator', (api) => {
    const { p2 } = ladder(api), s = p2.after, c = s.campaign;
    const bad = [[{ ...s, extra: 1 }, /fields/], [{ ...s, campaign: { ...c, extra: 1 } }, /fields/],
      [{ ...s, campaign: { ...c, history: [{ ...c.history[0], extra: 1 }, c.history[1]] } }, /fields/],
      [{ ...s, campaign: { ...c, carry: { ...c.carry, jackson: { men: 1, morale: 3 } } } }, /fields/],
      [{ ...s, army: s.army.map((b, i) => (i ? b : { ...b, extra: 1 })) }, /fields/],
      [{ ...s, campaign: { ...c, index: 1 } }, /position does not match/], [{ ...s, campaign: { ...c, status: 'won' } }, /status/],
      [{ ...s, slot: 4 }, /slot/], [{ ...s, grade: null }, /grade/], [{ ...s, updated: 'yesterday' }, /update time/],
      [{ ...s, army: s.army.map((b) => ({ ...b, unitId: 'same' })) }, /duplicate field unit/],
      [{ ...s, campaign: { ...c, history: [c.history[0], { ...c.history[1], awardId: c.history[0].awardId }] } }, /duplicate phase award/]];
    for (const [v, pattern] of bad) refuses('strict-validator', () => api.validateSnapshot(v), pattern);
    const depot = Array.from({ length: 2000 }, (_, i) => ({ ...s.army[0].weapon, uid: `pad-${i}`, from: 'é'.repeat(159), depot: true }));
    const history = [...c.history, ...Array.from({ length: 1500 }, (_, i) => ({ ...c.history[1], awardId: `pad-award-${i}-${'x'.repeat(80)}`, replay: true }))];
    const big = { ...s, depot, campaign: { ...c, history } }, text = JSON.stringify(big);
    assert.ok(new TextEncoder().encode(text).length > save.MAX_SAVE_BYTES && text.length < save.MAX_SAVE_BYTES, 'strict-validator: oversize fixture is not between the char and byte limits');
    refuses('strict-validator', () => api.validateSnapshot(big), /1 MB limit/);
    refuses('strict-validator', () => api.parseSnapshot(text), /1 MB limit/);
  }],
  ['phase-bridge', (api) => {
    const { p1 } = ladder(api), phase = api.campaignPhase(p1.after, CAMPAIGN), scenario = api.applyCampaign(PACKS.alpha.a2, p1.after, phase);
    const game = fakeGame(scenario, { winner: null, grade: 'draw', men: { sherman: 2400 } });
    const out = api.phaseOutcome({ game, scenario, awardId: phase.awardId, seed: phase.seed });
    assert.deepEqual([out.winner, out.grade], [null, 'Draw'], 'phase-bridge: draw grade');
    assert.deepEqual(out.cards, awardCards({ awardId: phase.awardId, seed: phase.seed, grade: 'Draw', captures: [] }), 'phase-bridge: loot is not the shared deterministic roll');
    assert.deepEqual(unit(out, 'sherman'), { id: 'sherman', side: 'US', menStart: 2500, men: 2400 }, 'phase-bridge: survivor row');
    assert.deepEqual(unit(out, 'ricketts'), { id: 'ricketts', side: 'US', menStart: 110, men: 110, gunsStart: 5, guns: 5 }, 'phase-bridge: battery row');
    const altered = fakeGame(scenario, { winner: 'US', grade: 'victory' }); altered.units[0].menMax += 1;
    refuses('phase-bridge', () => api.phaseOutcome({ game: altered, scenario, awardId: phase.awardId, seed: phase.seed }), /altered roster/);
    refuses('phase-bridge', () => api.phaseOutcome({ game: { ...game, over: false }, scenario, awardId: phase.awardId, seed: phase.seed }), /completed, unaltered battle phase/);
  }],
  ['real-game-bridge', (api) => {
    const { p1 } = ladder(api), phase = api.campaignPhase(p1.after, CAMPAIGN);
    const scenario = prepareFieldScenario(api.applyCampaign(PACKS.alpha.a2, p1.after, phase), 'pack');
    setPlan(scenario);
    const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
    const g = new Game({ scene: new Scene(), terrain, scenario, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
    assert.equal(g.units.find((u) => u.id === 'sherman').equipment.itemId, 'springfield', 'real-game-bridge: franchise equipment not on the field');
    g.fastForward(16);
    assert.ok(g.over, 'real-game-bridge: fixture battle did not finish');
    const { record } = api.phaseResult({ phase, game: g, scenario }), next = api.recordPhase(p1.after, CAMPAIGN, record);
    assert.ok(next.campaign.index === 2 && brigade(next, 'sherman').men <= 2500 && next.depot.length > p1.after.depot.length, 'real-game-bridge: real result not recorded');
  }],
];

const MUTANTS = {
  'shipped-campaign': { validateCampaign: (json) => ({ ...json }) },
  'new-campaign': { newCampaign: (o) => { const s = campaign.newCampaign(o); return { ...s, army: s.army.map(({ unitId, ...b }) => b) }; } },
  'loan-untouched': { applyCampaign: (s, v, p) => campaign.applyCampaign(s, v, { ...p, loan: false }) },
  'defeat-advances': { recordPhase: (s, c, r) => (r.grade === 'Defeat' ? s : campaign.recordPhase(s, c, r)) },
  'franchise-applied': { applyCampaign: (s, v, p) => campaign.applyCampaign(s, v, { ...p, loan: true }) },
  'carry-depletes-only': { applyCampaign: (s, v, p) => {
    const out = campaign.applyCampaign(s, v, p), carry = v.campaign.carry;
    for (const u of out.units) if (has(carry, u.id) && carry[u.id].men) u.men = carry[u.id].men;
    return out;
  } },
  'franchise-losses': { recordPhase: (s, c, r) => save.validateSnapshot({ ...campaign.recordPhase(s, c, r), army: s.army }) },
  'new-battle-clears-carry': { applyCampaign: (s, v, p) => campaign.applyCampaign(s, v, { ...p, packId: v.campaign.history.at(-1)?.packId ?? p.packId }) },
  'replay-marked': { campaignPhase: (s, c) => campaign.campaignPhase(s, c) },
  'idempotent-award': { recordPhase: (s, c, { awardId, ...r }) => campaign.recordPhase(s, c, r) },
  'last-phase-complete': { recordPhase: (s, c, r) => { const n = campaign.recordPhase(s, c, r); return save.validateSnapshot({ ...n, campaign: { ...n.campaign, status: 'in-progress' } }); } },
  'slot-isolation': { createProgressStore: (mem, o = {}) => save.createProgressStore(mem, { ...o, slot: 1 }) },
  'v1-unchanged': { validateSnapshot: (v) => (v.version === 1 ? copy(v) : save.validateSnapshot(v)) },
  'corrupt-slot-listed': { listSlots: async (storage, o) => {
    for (const k of [1, 2, 3]) { const raw = storage.getItem(save.slotKey(k)); if (raw !== null) save.parseSnapshot(raw); }
    return save.listSlots(storage, o);
  } },
  'strict-validator': { validateSnapshot: (v) => v, parseSnapshot: (t) => JSON.parse(t) },
  'phase-bridge': { phaseOutcome: (o) => phaseOutcome({ ...o, seed: `${o.seed}x` }) },
  'real-game-bridge': { applyCampaign: (s, v, p) => {
    const out = campaign.applyCampaign(s, v, p);
    out.units.find((u) => u.id === 'ricketts').equipment = { ...v.army.find((b) => b.id === 'sherman').weapon };
    return out;
  } },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function campaignUnit(api = API) {
  for (const [name, check] of CAMPAIGN_CHECKS) await runCheck(name, check, api);
  return CAMPAIGN_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of CAMPAIGN_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = CAMPAIGN_CHECKS.length;
  if (failed) { console.log(`CAMPAIGN FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`CAMPAIGN OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of CAMPAIGN_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`CAMPAIGN CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`CAMPAIGN CONTROLS OK (${caught}/${n})`);
  }
}

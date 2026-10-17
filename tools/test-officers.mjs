// CPU check: officers' records and Merit (v4 OFFICERS; src/franchise/officers.js, its save field in src/franchise/save.js, the
// campaign hooks in src/franchise/campaign.js and the field effects in src/game.js). Fictional fixture packs on Henry Hill
// ground (as tools/test-campaign.mjs builds them; nothing ships for them) carry the Merit rules; the sourced ranks are read
// from the three real battle packs and the shipped ladder, two names checked by hand against assets/packs:
//   William B. Hazen: Colonel (Shiloh, Buell attacks; Stones River, the Round Forest), Brigadier General (Chattanooga,
//   Orchard Knob and Missionary Ridge). William P. Carlin: Colonel (Stones River, Dawn on the right), Brigadier General
//   (Chattanooga, Missionary Ridge).
// Repairs bound here (verifier findings): no "took command" inferred from a new name on a brigade (took-command), the pack's
// own successor still marked (successor-named), killed and the camp's Merit line survive trimming (killed-survives-trim,
// merit-line-after-trim), one Merit change per name per phase (one-merit-per-name), 128 names (save-bounds), and the card's
// effect line saying exactly what the field does with Merit for HIS formation (effect-text: an infantry brigade, rallied by its
// own commander, gains steadiness only; the wider rally radius reaches a battery, which has no commander figure; the
// numbers are read back from src/game.js, so the old "+10 % rally radius for his brigade" promise fails it), and the card's
// view model never yielding "null" or "undefined" as text for any commander the shipped packs or the fixture name, fed as both
// callers feed it and with every optional field null (view-no-null; the CI card showed a stray "null").
// `node tools/test-officers.mjs` prints OFFICERS OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail that check, with the check's own name in the failure text. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario, preparePhase } from '../src/sim/phase.js';
import * as officers from '../src/franchise/officers.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url)));
const HH = read('assets/scenarios/henry-hill.json');
const SHIPPED = read('assets/campaign.json');
const REAL = ['shiloh', 'stones-river', 'chattanooga'].map((id) => read(`assets/packs/${id}.json`));
const copy = structuredClone;
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const API = { ...officers, ...campaign, ...save };
const SHERMAN = 'William T. Sherman', RICKETTS = 'James B. Ricketts'; // Henry Hill's own commanders (assets/scenarios/henry-hill.json)
const FICTIONAL = { name: 'Fictional colonel (test only)', rank: 'Colonel' };

// ---- fixtures: fictional packs on Henry Hill ground and a two-formation franchise (as tools/test-campaign.mjs) ----------
function phaseScenario(id, extra = {}) {
  const s = copy(HH);
  s.id = 'test-' + id; s.title = 'Fictional officers phase ' + id + ' (test only)'; s.attacker = 'US'; s.end = '14:01';
  return Object.assign(s, extra);
}
const withCommander = (s, id, commander) => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, commander } : u)) });
const PACKS = { alpha: { a1: phaseScenario('a1'), a2: phaseScenario('a2') }, bravo: { b1: phaseScenario('b1') },
  charlie: { c1: withCommander(phaseScenario('c1'), 'sherman', FICTIONAL) } };
const FRANCHISE = [{ unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'springfield', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'napoleon', vet: 'veteran' }];
// LOAN: a1 is on loan. OWN: a1 is the franchise's own, so alpha a1 is not a battle's last phase and a2 is.
const LOAN = { version: 1, id: 'test-officers', title: 'Fictional officers campaign (test only)', franchise: FRANCHISE,
  phases: [{ packId: 'alpha', phaseId: 'a1', loan: true }, { packId: 'alpha', phaseId: 'a2' }, { packId: 'bravo', phaseId: 'b1' }, { packId: 'charlie', phaseId: 'c1' }] };
const OWN = { ...LOAN, phases: [{ packId: 'alpha', phaseId: 'a1' }, ...LOAN.phases.slice(1)] };
const WIN = { winner: 'US', grade: 'victory' };

function fakeGame(scenario, { winner, grade, men = {}, states = {}, down = [] }) {
  const units = [...scenario.units, ...(scenario.reinforcements || [])].map((d) => ({ id: d.id, side: d.side, type: d.type || 'infantry',
    name: d.name, menMax: d.men, men: Math.min(d.men, men[d.id] ?? d.men), weapon: d.weapon || 'smooth', xp: d.xp || 1, equipment: d.equipment,
    state: states[d.id] ?? 'steady', ...(d.type === 'artillery' ? { gunSlots: Array.from({ length: d.guns }, () => ({ alive: true })) } : {}) }));
  return { scenario, over: true, playerSide: 'US', units, fieldCaptures: { held: () => [] },
    result: { winner, draw: winner === null, grade, why: 'Fictional test result', officers: down } };
}
/** One phase through the real campaign bridge: applyCampaign -> a fictional result -> phaseResult -> recordPhase. */
function play(api, def, before, outcome = WIN, { replay = false } = {}) {
  const phase = api.campaignPhase(before, def, { replay });
  const scenario = api.applyCampaign(PACKS[phase.packId][phase.phaseId], before, phase);
  const { record } = api.phaseResult({ phase, game: fakeGame(scenario, outcome), scenario });
  return { phase, scenario, record, after: api.recordPhase(before, def, record) };
}
const start = (api, def) => api.newCampaign({ campaign: def, slot: 1, seed: 1862, at: '2026-10-17T12:00:00Z' });
const merit = (api, s, name = SHERMAN) => api.officerRecord(s, name).merit;
/** A validated save with these Merits (one fictional record row each, on its last recorded phase). */
function withMerits(api, s, merits) {
  const h = s.campaign.history.at(-1);
  const book = Object.fromEntries(Object.entries(merits).map(([name, m]) => [name, { merit: m, record: [{ pack: h.packId, phase: h.phaseId, unit: name === SHERMAN ? 'sherman' : 'ricketts', grade: 'Victory', lost: 10 }] }]));
  return api.validateSnapshot({ ...s, officers: book });
}
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
const def = (s, id) => [...s.units, ...(s.reinforcements || [])].find((d) => d.id === id);
function fieldGame(scenario, general = null) {
  const p = prepareFieldScenario({ ...scenario, ...(general ? { commanders: [general] } : {}) }, 'pack');
  setPlan(p);
  const g = new Game({ scene: new Scene(), terrain, scenario: p, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  g.initializeReinforcements();
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);

export const OFFICER_CHECKS = [
  ['merit-up', (api) => {
    const base = play(api, OWN, start(api, OWN)).after;
    const up = (ctx) => api.recordOfficers(base, { awardId: 't', packId: 'alpha', phaseId: 'a2', grade: 'Victory', battleEnd: true, replay: false,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2000 }], officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady' }], ...ctx }).summary.changes.map((c) => [c.from, c.to]);
    assert.deepEqual(up({}), [[0, 1]], 'merit-up: a battle-end victory with half the men did not raise Merit');
    assert.deepEqual([up({ battleEnd: false }), up({ replay: true }), up({ grade: 'Draw' }), up({ units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 1250 }] })], [[], [], [], []],
      'merit-up: Merit rose off a battle\'s last phase, on a replay, on a draw or after losing half the men');
    assert.deepEqual(up({ grade: 'Decisive' }), [[0, 1]], 'merit-up: a decisive victory did not raise Merit');
    // the same rule through the real campaign bridge: a1 is not the battle's last phase, a2 is
    assert.deepEqual([merit(api, base), api.officerRecord(base, SHERMAN).record.length], [0, 1], 'merit-up: a1 raised Merit or left no record');
    const p2 = play(api, OWN, base);
    assert.deepEqual([merit(api, p2.after), merit(api, p2.after, RICKETTS)], [1, 1], 'merit-up: the campaign bridge did not raise Merit at the battle\'s end');
    assert.equal(merit(api, play(api, OWN, p2.after, WIN, { replay: true }).after), 1, 'merit-up: a replay raised Merit through the bridge');
  }],
  ['merit-down', (api) => {
    const base = withMerits(api, play(api, OWN, start(api, OWN)).after, { [SHERMAN]: 1 });
    const down = (end, s = base) => api.recordOfficers(s, { awardId: 't', packId: 'alpha', phaseId: 'a2', grade: 'Victory', battleEnd: true,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2000 }], officers: [{ unitId: 'sherman', name: SHERMAN, end }] }).summary.changes.map((c) => [c.from, c.to]);
    assert.deepEqual([down('broken'), down('surrendered')], [[[1, 0]], [[1, 0]]], 'merit-down: a broken or surrendered brigade kept its Merit');
    assert.deepEqual(down('broken', withMerits(api, base, { [SHERMAN]: 0 })), [], 'merit-down: Merit went below 0');
    const p2 = play(api, OWN, base, { ...WIN, states: { sherman: 'routing', ricketts: 'captured' } });
    assert.deepEqual([merit(api, p2.after), merit(api, p2.after, RICKETTS)], [0, 0], 'merit-down: the bridge did not read routing and captured as broken and surrendered');
    assert.equal(merit(api, play(api, OWN, base, { ...WIN, men: { sherman: 0 } }).after), 0, 'merit-down: a destroyed brigade kept its Merit');
  }],
  ['merit-clamp', (api) => {
    let s = play(api, OWN, start(api, OWN)).after, ups = 0, downs = 0;
    const u = [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }];
    for (let i = 0; i < 5; i++) {
      const r = api.recordOfficers(s, { awardId: `x${i}`, packId: 'alpha', phaseId: 'a1', grade: 'Decisive', units: u, officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady' }], battleEnd: true });
      ups += r.summary.changes.length; s = r.save;
    }
    assert.ok(ups === 3 && merit(api, s) === 3, `merit-clamp: Merit is not held at 3 (${ups} rises, Merit ${merit(api, s)})`);
    for (let i = 0; i < 5; i++) {
      const r = api.recordOfficers(s, { awardId: `y${i}`, packId: 'alpha', phaseId: 'a1', grade: 'Defeat', units: u, officers: [{ unitId: 'sherman', name: SHERMAN, end: 'broken' }] });
      downs += r.summary.changes.length; s = r.save;
    }
    assert.ok(downs === 3 && merit(api, s) === 0, `merit-clamp: Merit is not held at 0 (${downs} falls, Merit ${merit(api, s)})`);
    assert.equal(api.validateSnapshot(s).officers[SHERMAN].record.length, 11, 'merit-clamp: the clamped records do not validate');
  }],
  ['loan-excluded', (api) => {
    const s0 = start(api, LOAN), p1 = play(api, LOAN, s0);
    assert.ok(!('officers' in p1.after) && !('officers' in p1.record), 'loan-excluded: the loaned army recorded officers');
    const direct = api.recordOfficers(s0, { awardId: 'l', packId: 'alpha', phaseId: 'a1', grade: 'Victory', loan: true, battleEnd: true,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }], officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady' }] });
    assert.ok(direct.save === s0 && !direct.summary.changes.length, 'loan-excluded: a loan phase earned Merit');
    const rec = api.recordPhase(s0, LOAN, { ...p1.record, officers: [{ unitId: 'sherman', name: SHERMAN, end: 'broken' }] });
    assert.ok(!('officers' in rec), 'loan-excluded: officer rows on a loan phase were kept');
    const merited = withMerits(api, p1.after, { [SHERMAN]: 2 });
    const scn = PACKS.alpha.a1;
    assert.equal(api.applyMerit(scn, merited, { loan: true }), scn, 'loan-excluded: Merit applied on a loan phase');
    const loanField = api.applyCampaign(scn, merited, { packId: 'alpha', phaseId: 'a1', loan: true, awardId: 'x' });
    assert.ok(!('officer' in def(loanField, 'sherman')) && !('meritRadius' in def(loanField, 'sherman')), 'loan-excluded: a loan phase fielded Merit');
  }],
  ['effects-campaign-only', (api) => {
    const p1 = play(api, LOAN, start(api, LOAN)), s = withMerits(api, p1.after, { [SHERMAN]: 2 });
    const field = api.applyMerit(PACKS.alpha.a2, s);
    const sh = def(field, 'sherman'), rk = def(field, 'ricketts');
    assert.deepEqual([sh.meritRadius, sh.meritSteady, sh.officer?.merit, sh.officer?.active], [1.2, 1.04, 2, true], 'effects-campaign-only: Merit 2 is not +20 % radius and +4 % steadiness');
    assert.ok(rk.officer?.merit === 0 && !('meritRadius' in rk) && !('meritSteady' in rk), 'effects-campaign-only: Merit 0 changed the field');
    assert.ok(!('meritRadius' in def(field, 'franklin')) && !('officer' in def(field, 'jackson')), 'effects-campaign-only: Merit reached a formation outside the franchise');
    const viaCampaign = def(api.applyCampaign(PACKS.alpha.a2, s, api.campaignPhase(s, LOAN)), 'sherman');
    assert.deepEqual([viaCampaign.meritRadius, viaCampaign.meritSteady], [1.2, 1.04], 'effects-campaign-only: applyCampaign does not apply Merit');
    for (const pack of REAL) for (const ph of pack.phases) {
      const battles = prepareFieldScenario(preparePhase(pack, ph.id).scenario, 'pack');
      assert.ok([...battles.units, ...(battles.reinforcements || [])].every((d) => !('meritRadius' in d) && !('meritSteady' in d) && !('officer' in d)),
        `effects-campaign-only: the Battles route of ${pack.id}/${ph.id} carries Merit`);
    }
  }],
  ['game-effects', (api) => {
    const p1 = play(api, LOAN, start(api, LOAN)), s = withMerits(api, p1.after, { [SHERMAN]: 2, [RICKETTS]: 1 });
    const field = api.applyCampaign(PACKS.alpha.a2, s, api.campaignPhase(s, LOAN));
    const rk = def(field, 'ricketts');
    const general = { id: 'test-general', side: 'US', name: 'Fictional general (test only)', rank: 'Brigadier General', units: ['sherman', 'ricketts'],
      x: rk.x + 320, z: rk.z, sources: ['Test fixture, no source'], status: 'Fictional (test only)' };
    const g = fieldGame(field, general), plain = fieldGame(PACKS.alpha.a2, general);
    const sh = unit(g, 'sherman');
    assert.ok(Math.abs(g.rallyRadius(sh) - 360) < 1e-9 && Math.abs(g.commandFactor(sh).loss - 0.8 / 1.04) < 1e-12, 'game-effects: Merit 2 does not widen the radius to 360 m and steady the morale loss');
    assert.ok(g.commandFactor(unit(g, 'ricketts')) !== null && plain.commandFactor(unit(plain, 'ricketts')) === null,
      'game-effects: Merit 1 does not bring a general 320 m off within the battery\'s rally radius');
    assert.ok(plain.rallyRadius(unit(plain, 'sherman')) === 300 && plain.commandFactor(unit(plain, 'sherman')).loss === 0.8, 'game-effects: a field without Merit changed');
    g.commanderDown(sh, 'killed');
    assert.equal(g.rallyRadius(sh), 300, 'game-effects: Merit still applies after its commander fell');
  }],
  ['effect-text', (api) => {
    const p1 = play(api, LOAN, start(api, LOAN)), s = withMerits(api, p1.after, { [SHERMAN]: 2, [RICKETTS]: 1 });
    const field = api.applyCampaign(PACKS.alpha.a2, s, api.campaignPhase(s, LOAN));
    const g = fieldGame(field), sh = unit(g, 'sherman');
    const steadyPct = (u) => Math.round((0.8 / g.commandFactor(u).loss - 1) * 100); // the field's own steadiness, from commandFactor
    const inf = api.officerView({ name: SHERMAN, rank: 'Colonel', kind: sh.type, record: api.officerRecord(s, SHERMAN) }).effect;
    assert.ok(sh.type === 'infantry' && !!sh.officer && steadyPct(sh) === 4, 'effect-text: the fixture is not an infantry brigade with its own commander at +4 % steadiness');
    assert.ok(!/rally radius \+|reaches (?:it|his brigade) from|farther for his brigade/i.test(inf) && /batteries only, which have no commander figure/.test(inf),
      `effect-text: the infantry card promises his brigade a wider rally radius it never gets, or does not say where it applies: "${inf}"`);
    assert.ok(/^Game rule/.test(inf) && inf.includes(`steadiness +${steadyPct(sh)} % (2 % per Merit) for his brigade while he leads it`),
      `effect-text: the infantry card does not state his brigade's steadiness from the field: "${inf}"`);
    // the battery: no commander figure, so a general's rally is what reaches it; 320 m off is inside 330 m (Merit 1)
    const general = { id: 'test-general', side: 'US', name: 'Fictional general (test only)', rank: 'Brigadier General', units: ['sherman', 'ricketts'],
      x: def(field, 'ricketts').x + 320, z: def(field, 'ricketts').z, sources: ['Test fixture, no source'], status: 'Fictional (test only)' };
    const gg = fieldGame(field, general), rr = unit(gg, 'ricketts');
    const bat = api.officerView({ name: RICKETTS, rank: def(HH, 'ricketts').commander.rank, kind: rr.type, record: api.officerRecord(s, RICKETTS) }).effect;
    const batSteady = Math.round((0.8 / gg.commandFactor(rr).loss - 1) * 100);
    assert.ok(!rr.officer && /^Game rule/.test(bat) && bat.includes(`reaches it from ${Math.round(gg.rallyRadius(rr))} m instead of 300 m`) && bat.includes(`${batSteady} % steadier`),
      `effect-text: the battery card does not state the field's rally radius and steadiness for it: "${bat}"`);
  }],
  ['killed-keeps', (api) => {
    const base = play(api, LOAN, play(api, LOAN, start(api, LOAN)).after).after; // Sherman: Merit 1
    const win = (s, row) => api.recordOfficers(s, { awardId: 'k', packId: 'alpha', phaseId: 'a2', grade: 'Decisive', battleEnd: true,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }], officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady', ...row }] }).save;
    const fell = win(base, { event: 'killed' }), r = api.officerRecord(fell, SHERMAN);
    assert.ok(r.killed && r.record.at(-1).event === 'killed' && r.merit === 2, 'killed-keeps: the killed event or his Merit is not on his record');
    const after = api.officerRecord(win(fell, {}), SHERMAN);
    assert.ok(after.merit === 2 && after.record.length === 3, 'killed-keeps: a fallen commander\'s Merit changed or his record was lost');
    const sh = def(api.applyMerit(PACKS.bravo.b1, api.validateSnapshot(fell)), 'sherman');
    assert.ok(sh.officer?.merit === 2 && sh.officer.active === false && !('meritRadius' in sh), 'killed-keeps: a fallen commander\'s Merit still applies');
    const viaField = play(api, LOAN, base, { ...WIN, down: [{ unitId: 'sherman', name: SHERMAN, rank: 'Colonel', kind: 'killed' }] }).after;
    assert.ok(api.officerRecord(viaField, SHERMAN).killed, 'killed-keeps: the field\'s killed event did not reach the record');
  }],
  ['took-command', (api) => {
    // Law: a new name on a brigade in a later phase says who led it then, not when he took over; no event may be invented.
    let s = start(api, LOAN);
    for (let i = 0; i < 3; i++) s = play(api, LOAN, s).after;
    const direct = api.recordOfficers(s, { awardId: 't', packId: 'charlie', phaseId: 'c1', grade: 'Victory', units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }],
      officers: [{ unitId: 'sherman', name: FICTIONAL.name, end: 'steady' }] });
    assert.deepEqual(direct.summary.events, [], 'took-command: a new name on the brigade was shown as taking command (inferred, not in the pack)');
    const p = play(api, LOAN, s), r = api.officerRecord(p.after, FICTIONAL.name);
    assert.ok(r.record.length === 1 && !('event' in r.record[0]) && r.record[0].unit === 'sherman', 'took-command: the bridge invented a change-of-command event for a new name on the brigade');
    const view = api.officerView({ name: FICTIONAL.name, rank: FICTIONAL.rank, record: r });
    assert.ok(view.record.every((x) => x.event === ''), 'took-command: the card shows a change-of-command event the pack does not give');
  }],
  ['successor-named', (api) => {
    // The one source of "took command": a successor the pack itself names for a commander who falls (commander.successor).
    let s = start(api, LOAN);
    for (let i = 0; i < 3; i++) s = play(api, LOAN, s).after;
    const scn = withCommander(phaseScenario('s1'), 'sherman', { name: SHERMAN, rank: 'Colonel', successor: { name: FICTIONAL.name, rank: FICTIONAL.rank } });
    const rows = api.officerRows({ game: fakeGame(scn, { ...WIN, down: [{ unitId: 'sherman', name: SHERMAN, rank: 'Colonel', kind: 'killed' }] }), scenario: scn });
    assert.deepEqual(rows.find((x) => x.unitId === 'sherman'), { unitId: 'sherman', name: SHERMAN, end: 'steady', event: 'killed', successor: FICTIONAL.name }, 'successor-named: the officer row lost the pack\'s named successor');
    const out = api.recordOfficers(s, { awardId: 'sx', packId: 'charlie', phaseId: 'c1', grade: 'Victory', units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }],
      officers: api.validateOfficerRows(rows.filter((x) => x.unitId === 'sherman'), new Set(['sherman'])) });
    assert.deepEqual(out.summary.events.map((e) => [e.name, e.event]), [[SHERMAN, 'killed'], [FICTIONAL.name, 'took-command']], 'successor-named: the pack\'s named successor was not marked as taking command');
    const r = api.officerRecord(out.save, FICTIONAL.name);
    assert.ok(r.record.length === 1 && r.record[0].event === 'took-command', 'successor-named: the successor\'s record lacks the change of command');
    const noSucc = api.officerRows({ game: fakeGame(scn, WIN), scenario: scn }).find((x) => x.unitId === 'sherman');
    assert.ok(!('successor' in noSucc), 'successor-named: a successor took command though his commander never fell');
  }],
  ['killed-survives-trim', (api) => {
    // His killed row can be trimmed away (24 newest rows kept); the entry's own flag keeps his Merit frozen and inactive.
    const base = play(api, LOAN, play(api, LOAN, start(api, LOAN)).after).after; // Sherman: Merit 1
    const win = (s, i, row = {}) => api.recordOfficers(s, { awardId: `kt${i}`, packId: 'alpha', phaseId: 'a2', grade: 'Decisive', battleEnd: true,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }], officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady', ...row }] }).save;
    let s = win(base, 0, { event: 'killed' });
    for (let i = 1; i <= api.OFFICER_LIMITS.records + 2; i++) s = win(s, i);
    const r = api.officerRecord(s, SHERMAN);
    assert.ok(!r.record.some((x) => x.event === 'killed') && r.record.length === api.OFFICER_LIMITS.records, 'killed-survives-trim: the fixture did not trim the killed row away');
    assert.ok(r.killed && r.merit === 2, `killed-survives-trim: a fallen commander's Merit revived after his killed row was trimmed (killed ${r.killed}, Merit ${r.merit})`);
    const v = api.validateSnapshot(s);
    assert.ok(v.officers[SHERMAN].killed === true && !('meritRadius' in def(api.applyMerit(PACKS.bravo.b1, v), 'sherman')), 'killed-survives-trim: the saved killed flag was lost or his Merit applies again');
  }],
  ['merit-line-after-trim', (api) => {
    // The camp's "Merit a → b" reads the row's own from, so trimming the earlier Merit row cannot turn 1 → 2 into 0 → 2.
    const base = play(api, LOAN, play(api, LOAN, start(api, LOAN)).after).after; // Sherman: Merit 0 → 1 at alpha a2
    const step = (s, i, grade, battleEnd) => api.recordOfficers(s, { awardId: `ml${i}`, packId: 'alpha', phaseId: 'a2', grade, battleEnd,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }], officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady' }] }).save;
    let s = base;
    for (let i = 0; i < api.OFFICER_LIMITS.records; i++) s = step(s, i, 'Draw', true);
    s = step(s, 99, 'Decisive', true);
    assert.ok(!s.officers[SHERMAN].record.slice(0, -1).some((x) => 'merit' in x), 'merit-line-after-trim: the fixture kept the earlier Merit row');
    const lines = api.officerLines(s, { packs: [], ladder: api.validateCampaign(LOAN) });
    assert.ok(lines.includes(`${SHERMAN}: Merit 1 → 2 (game value)`), `merit-line-after-trim: the camp misreports the Merit change after trimming (${lines.join(' | ')})`);
    assert.deepEqual(api.validateSnapshot(s).officers, s.officers, 'merit-line-after-trim: the trimmed record does not validate unchanged');
  }],
  ['one-merit-per-name', (api) => {
    // One name the pack gives two franchise formations in one phase changes Merit once.
    const base = play(api, OWN, start(api, OWN)).after;
    const run = (ends) => api.recordOfficers(base, { awardId: 'om', packId: 'alpha', phaseId: 'a1', grade: 'Decisive', battleEnd: true,
      units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }, { id: 'ricketts', side: 'US', menStart: 110, men: 105 }],
      officers: [{ unitId: 'sherman', name: SHERMAN, end: ends[0] }, { unitId: 'ricketts', name: SHERMAN, end: ends[1] }] });
    const up = run(['steady', 'steady']);
    assert.ok(up.summary.changes.length === 1 && merit(api, up.save) === 1 && up.save.officers[SHERMAN].record.filter((x) => 'merit' in x).length === 1,
      `one-merit-per-name: two formations under one name changed his Merit ${up.summary.changes.length} times (Merit ${merit(api, up.save)})`);
    const mixed = run(['steady', 'broken']);
    assert.ok(mixed.summary.changes.length === 0 && merit(api, mixed.save) === 0, 'one-merit-per-name: a broken formation under the same name did not cancel the rise');
    assert.equal(api.validateSnapshot(up.save).officers[SHERMAN].record.length, 3, 'one-merit-per-name: both formations\' rows were not kept');
  }],
  ['field-events', (api) => {
    const scn = api.applyCampaign(PACKS.alpha.a2, play(api, LOAN, start(api, LOAN)).after, { packId: 'alpha', phaseId: 'a2', loan: false, awardId: 'x' });
    const g = fieldGame(scn);
    g.commanderDown(unit(g, 'sherman'), 'wounded');
    g.fastForward(16);
    assert.ok(g.over && g.result.officers?.some((r) => r.unitId === 'sherman' && r.kind === 'wounded' && r.name === SHERMAN), 'field-events: the game result does not name the wounded commander');
    const rows = api.officerRows({ game: g, scenario: g.scenario });
    assert.ok(rows.find((r) => r.unitId === 'sherman')?.event === 'wounded' && rows.every((r) => r.unitId !== 'jackson'), 'field-events: officer rows lost the wound or named the enemy');
  }],
  ['save-roundtrip', (api) => {
    const p1 = play(api, LOAN, start(api, LOAN)), p2 = play(api, LOAN, p1.after);
    assert.ok(p2.after.officers && p2.after.officers[SHERMAN].record.length === 1, 'save-roundtrip: the recorded phase wrote no officers');
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(p2.after)), p2.after, 'save-roundtrip: officers do not survive export and import');
    const older = api.validateSnapshot(p1.after);
    assert.ok(!('officers' in older) && api.officerRecord(older, SHERMAN).merit === 0 && !api.officerRecord(older, SHERMAN).record.length, 'save-roundtrip: an older save does not load with an empty map');
  }],
  ['save-bounds', (api) => {
    const p2 = play(api, LOAN, play(api, LOAN, start(api, LOAN)).after).after, row = p2.officers[SHERMAN].record[0];
    const book = (o) => ({ ...p2, officers: o });
    const L = api.OFFICER_LIMITS.names;
    const names = Object.fromEntries(Array.from({ length: L + 1 }, (_, i) => [`Fictional name ${i} (test only)`, { merit: 0, record: [row] }]));
    for (const [v, pattern] of [[book(names), /oversized officers/], [book({ [SHERMAN]: { merit: 0, record: Array(25).fill(row) } }), /officer record/],
      [book({ [SHERMAN]: { merit: 4, record: [row] } }), /officer merit/], [book({ [SHERMAN]: { merit: 0, record: [{ ...row, event: 'promoted' }] } }), /officer event/],
      [book({ [SHERMAN]: { merit: 0, record: [{ ...row, phase: 'b1', pack: 'bravo' }] } }), /recorded phase/],
      [book({ [SHERMAN]: { merit: 0, record: [{ ...row, rank: 'Brigadier General' }] } }), /fields/], [book({}), /officers/],
      [book({ [SHERMAN]: { merit: 1, record: [{ pack: row.pack, phase: row.phase, unit: row.unit, grade: row.grade, lost: row.lost, merit: 1 }] } }), /both from and merit/], [book({ [SHERMAN]: { merit: 2, record: [{ ...row, from: 0, merit: 2 }] } }), /one step/],
      [book({ [SHERMAN]: { merit: 0, record: [row], killed: false } }), /killed must be true/]]) refuses('save-bounds', () => api.validateSnapshot(v), pattern);
    assert.ok(L >= 128, `save-bounds: the name bound (${L}) leaves no room past the shipped ladder's 63 names`);
    const full = api.validateSnapshot(book(Object.fromEntries(Object.entries(names).slice(0, L))));
    const next = api.recordOfficers(full, { awardId: 'z', packId: 'alpha', phaseId: 'a2', grade: 'Victory', units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2400 }],
      officers: [{ unitId: 'sherman', name: SHERMAN, end: 'steady' }], battleEnd: true });
    const kept = api.validateSnapshot(next.save).officers;
    assert.ok(Object.keys(kept).length === L && kept[SHERMAN]?.merit === 1 && next.summary.dropped === 1, `save-bounds: the name past the ${L}-name bound was not admitted with one untouched name dropped and counted`);
  }],
  ['rank-history', (api) => {
    const rows = (name, packs = REAL) => api.rankHistory(name, packs, SHIPPED).map((r) => [r.packId, r.phaseId, r.rank]);
    assert.deepEqual(rows('William B. Hazen'), [['shiloh', 'buell-attacks', 'Colonel'], ['stones-river', 'round-forest', 'Colonel'],
      ['chattanooga', 'orchard-knob', 'Brigadier General'], ['chattanooga', 'missionary-ridge', 'Brigadier General']], 'rank-history: Hazen\'s sourced ranks');
    assert.deepEqual(rows('William P. Carlin'), [['stones-river', 'dawn-on-the-right', 'Colonel'], ['chattanooga', 'missionary-ridge', 'Brigadier General']], 'rank-history: Carlin\'s sourced ranks');
    const summaries = REAL.map((p) => ({ packId: p.id, title: p.title, phases: p.phases.map((ph) => ({ id: ph.id, title: ph.scenario.title,
      commanders: Object.fromEntries([...ph.scenario.units, ...(ph.scenario.reinforcements || [])].filter((u) => u.commander?.name).map((u) => [u.id, { name: u.commander.name, rank: u.commander.rank || '' }])) })) }));
    assert.deepEqual(rows('William B. Hazen', summaries), rows('William B. Hazen'), 'rank-history: pack summaries read differently from the packs');
    const change = api.rankChanges(api.rankHistory('William B. Hazen', REAL, SHIPPED));
    assert.deepEqual(change.map(api.rankChangeText), ['Promoted Brigadier General per the Chattanooga pack (Orchard Knob)'], 'rank-history: Hazen\'s sourced promotion line');
  }],
  ['no-rank-from-events', (api) => {
    let s = play(api, LOAN, start(api, LOAN)).after;
    for (let i = 0; i < 2; i++) s = play(api, LOAN, s, { winner: 'US', grade: 'decisive', down: i ? [{ unitId: 'sherman', name: SHERMAN, rank: 'Colonel', kind: 'wounded' }] : [] }).after;
    s = withMerits(api, s, { [SHERMAN]: 3 });
    assert.ok(!JSON.stringify(s.officers).includes('rank'), 'no-rank-from-events: the save keeps a rank for an officer');
    const authored = PACKS.bravo.b1, field = api.applyMerit(authored, s); // a phase whose pack names Sherman for the brigade
    assert.equal(def(field, 'sherman').officer?.merit, 3, 'no-rank-from-events: the fixture did not put Merit 3 on the field');
    for (const d of [...field.units, ...(field.reinforcements || [])]) {
      assert.deepEqual(d.commander ?? null, def(authored, d.id).commander ?? null, `no-rank-from-events: ${d.id}'s commander changed on the field`);
    }
    const view = api.officerView({ name: SHERMAN, rank: 'Colonel', record: api.officerRecord(s, SHERMAN) });
    assert.ok(view.heading === `Colonel ${SHERMAN}` && view.merit === 3, 'no-rank-from-events: the card does not show the pack\'s rank with Merit 3');
  }],
  ['view-no-null', (api) => {
    const leaks = [];
    const walk = (v, path, who) => {
      if (typeof v === 'string') { if (/\b(?:null|undefined)\b/.test(v)) leaks.push(`${who} ${path}: "${v.slice(0, 60)}"`); }
      else if (v === undefined || (v === null && path !== '.portrait')) leaks.push(`${who} ${path}: ${v}`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, who);
    };
    const s = withMerits(api, play(api, LOAN, play(api, LOAN, start(api, LOAN)).after).after, { [SHERMAN]: 2 });
    const titles = [() => null, () => undefined, (p, ph) => `${p}: ${ph}`];
    const inputs = [];
    for (const [scope, scn] of [['henry-hill', HH], ...Object.entries(PACKS).flatMap(([p, phs]) => Object.entries(phs).map(([id, x]) => [`fixture ${p}/${id}`, x])),
      ...REAL.flatMap((pack) => pack.phases.map((ph) => [`${pack.id}/${ph.id}`, preparePhase(pack, ph.id).scenario]))]) {
      for (const d of [...scn.units, ...(scn.reinforcements || [])]) {
        if (!d?.commander?.name) continue;
        const c = d.commander, who = `${scope} ${d.id}`;
        // the battle's unit card (src/ui/hud.js: raw definition fields) and the camp (src/ui/entry.js: pack-summary words)
        inputs.push([who, { name: c.name, rank: c.rank, formation: d.name, kind: d.type, parent: d.parent, regiments: d.regiments, portrait: c.portrait, portraitNote: c.portraitNote,
          sources: d.sources, record: d.side === 'US' ? api.officerRecord(s, c.name) : null, campaign: d.side === 'US', ranks: api.rankHistory(c.name, REAL, SHIPPED), titleOf: titles[inputs.length % 3] }]);
        inputs.push([`${who} (camp)`, { name: c.name, rank: c.rank || '', formation: d.name || '', kind: d.type, parent: d.parent || '', regiments: d.regiments || [], portrait: c.portrait || '',
          portraitNote: c.portraitNote || '', sources: d.sources || [], sourcesFrom: `The battle pack's sources for this formation in ${scope}.`, record: api.officerRecord(s, c.name), campaign: true }]);
      }
    }
    // every optional field null, as a definition without them hands it on
    inputs.push(['fixture all-null', { name: SHERMAN, rank: null, formation: null, kind: null, parent: null, regiments: [null, 'Test regiment (fictional)'], sources: [null], sourcesFrom: null,
      record: api.officerRecord(s, SHERMAN), campaign: true, ranks: [], titleOf: () => null, portrait: null, portraitNote: null }]);
    assert.ok(inputs.length > 100, `view-no-null: only ${inputs.length} commanders read from the packs and the fixture`);
    for (const [who, input] of inputs) walk(api.officerView(input), '', who);
    assert.deepEqual(leaks.slice(0, 6), [], `view-no-null: the officer card's view model yields null or undefined text (${leaks.length}): ${leaks.slice(0, 3).join('; ')}`);
  }],
  ['officer-lines', (api) => {
    const p2 = play(api, LOAN, play(api, LOAN, start(api, LOAN)).after);
    assert.ok(api.officerLines(p2.after, { packs: [], ladder: api.validateCampaign(LOAN) }).includes(`${SHERMAN}: Merit 0 → 1 (game value)`), 'officer-lines: the camp does not name the Merit change');
    const at = SHIPPED.phases.findIndex((p) => p.phaseId === 'orchard-knob');
    const army = [{ id: 'us-hazen-brigade', unitId: 'us-hazen-brigade' }];
    const lines = api.officerLines({ version: 2, army, campaign: { index: at, history: [] } }, { packs: REAL, ladder: SHIPPED });
    assert.deepEqual(lines, ['William B. Hazen: Promoted Brigadier General per the Chattanooga pack (Orchard Knob)'], 'officer-lines: the camp does not name the sourced rank change');
    const view = api.officerView({ name: SHERMAN, rank: 'Colonel', record: api.officerRecord(p2.after, SHERMAN), ranks: [] });
    assert.ok(view.meritNote === 'Merit is a game value earned by this brigade\'s results' && view.meritLabel === 'Merit 1 of 3' && /^Game rule/.test(view.effect)
      && api.officerView({ name: SHERMAN, campaign: false }).meritLabel === 'Merit: not used outside the campaign', 'officer-lines: the card does not label Merit a game value');
  }],
];

const MUTANTS = {
  // a +1 on every victory, battle end or not
  'merit-up': { recordOfficers: (s, c) => officers.recordOfficers(s, { ...c, battleEnd: true }) },
  // a brigade that broke or surrendered counted as steady
  'merit-down': { recordOfficers: (s, c) => officers.recordOfficers(s, { ...c, officers: c.officers.map((r) => ({ ...r, end: 'steady' })) }) },
  // no ceiling or floor kept
  'merit-clamp': { recordOfficers: (s, c) => {
    const r = officers.recordOfficers(s, c), before = officers.officerRecord(s, SHERMAN).merit;
    if (!(c.grade === 'Decisive' && before === 3)) return r;
    return { save: { ...r.save, officers: { ...r.save.officers, [SHERMAN]: { ...r.save.officers[SHERMAN], merit: 4 } } },
      summary: { ...r.summary, changes: [...r.summary.changes, { name: SHERMAN, unitId: 'sherman', from: 3, to: 4 }] } };
  } },
  // the loaned army earns like the franchise
  'loan-excluded': { recordOfficers: (s, c) => officers.recordOfficers(s, { ...c, loan: false }), applyMerit: (scn, s) => officers.applyMerit(scn, s),
    phaseResult: (o) => campaign.phaseResult({ ...o, phase: { ...o.phase, loan: false } }) },
  // the effect stamped on every Union formation
  'effects-campaign-only': { applyMerit: (scn, s, o) => { const out = officers.applyMerit(scn, s, o); return { ...out, units: out.units.map((d) => (d.side === 'US' && !d.meritRadius ? { ...d, meritRadius: 1.1 } : d)) }; } },
  // Merit recorded but never put on the field
  'game-effects': { applyCampaign: (scn, s, p) => { const out = campaign.applyCampaign(scn, s, p); return { ...out, units: out.units.map(({ meritRadius, meritSteady, ...d }) => d) }; } },
  // the card's old effect line: a rally-radius bonus promised to every brigade
  'effect-text': { officerView: (i) => ({ ...officers.officerView(i), effect: `Game rule, campaign battles only: rally radius +${10 * (i.record?.merit ?? 0)} % and steadiness +${2 * (i.record?.merit ?? 0)} % for his brigade.` }) },
  // the killed event dropped (and his Merit going on as if he lived)
  'killed-keeps': { recordOfficers: (s, c) => officers.recordOfficers(s, { ...c, officers: c.officers.map(({ event, ...r }) => r) }) },
  // the old inference: a new name on a brigade the save saw under another name marked as taking command
  'took-command': { recordOfficers: (s, c) => {
    const r = officers.recordOfficers(s, c), seen = new Map();
    for (const [n, e] of Object.entries(s.officers || {})) for (const x of e.record) seen.set(x.unit, n);
    const fresh = c.officers.filter((o) => seen.has(o.unitId) && seen.get(o.unitId) !== o.name);
    if (!fresh.length) return r;
    const book = structuredClone(r.save.officers);
    for (const o of fresh) book[o.name].record.at(-1).event = 'took-command';
    return { save: { ...r.save, officers: book }, summary: { ...r.summary, events: [...r.summary.events, ...fresh.map((o) => ({ name: o.name, unitId: o.unitId, event: 'took-command' }))] } };
  } },
  // the pack's named successor's change of command not marked
  'successor-named': { recordOfficers: (s, c) => {
    const r = officers.recordOfficers(s, c), book = structuredClone(r.save.officers || {});
    for (const e of Object.values(book)) for (const x of e.record) if (x.event === 'took-command') delete x.event;
    return { save: { ...r.save, ...(r.save.officers ? { officers: book } : {}) }, summary: { ...r.summary, events: r.summary.events.filter((e) => e.event !== 'took-command') } };
  } },
  // killed read only from the rows (the entry's own flag dropped), as before the fix
  'killed-survives-trim': { recordOfficers: (s, c) => {
    const r = officers.recordOfficers(s, c);
    if (!r.save.officers) return r;
    return { ...r, save: { ...r.save, officers: Object.fromEntries(Object.entries(r.save.officers).map(([k, { killed, ...e }]) => [k, e])) } };
  } },
  // the change's from dropped: the camp line would have to guess the prior Merit from older rows
  'merit-line-after-trim': { recordOfficers: (s, c) => {
    const r = officers.recordOfficers(s, c);
    if (!r.save.officers) return r;
    const book = structuredClone(r.save.officers);
    for (const e of Object.values(book)) for (const x of e.record) if ('from' in x) { const prior = e.record.slice(0, e.record.indexOf(x)).findLast((y) => 'merit' in y); x.from = prior ? prior.merit : 0; }
    return { ...r, save: { ...r.save, officers: book } };
  } },
  // one Merit change per formation row, as before the fix
  'one-merit-per-name': { recordOfficers: (s, c) => c.officers.reduce((acc, o) => {
    const r = officers.recordOfficers(acc.save, { ...c, officers: [o] });
    return { save: r.save, summary: { ...r.summary, changes: [...acc.summary.changes, ...r.summary.changes], events: [...acc.summary.events, ...r.summary.events] } };
  }, { save: s, summary: { awardId: c.awardId, loan: false, changes: [], events: [], dropped: 0 } }) },
  // the field's commander events ignored
  'field-events': { officerRows: ({ game, scenario }) => officers.officerRows({ game: { ...game, result: { ...game.result, officers: [] } }, scenario }) },
  // officers dropped by the validator
  'save-roundtrip': { validateSnapshot: (v) => { const { officers: o, ...rest } = v; return save.validateSnapshot(rest); }, parseSnapshot: (t) => { const { officers: o, ...rest } = JSON.parse(t); return save.validateSnapshot(rest); } },
  // oversized officers silently trimmed instead of refused
  'save-bounds': { validateSnapshot: (v) => {
    if (!v.officers) return save.validateSnapshot(v);
    const o = Object.fromEntries(Object.entries(v.officers).slice(0, officers.OFFICER_LIMITS.names).map(([k, e]) => [k, { merit: Math.min(3, e.merit), record: e.record.slice(0, 24).map(({ rank, ...r }) => ({ ...r, ...(r.event === 'promoted' ? { event: 'wounded' } : {}) })) }]));
    try { return save.validateSnapshot({ ...v, officers: o }); } catch { return v; }
  } },
  // every phase read with the first rank found for the name
  'rank-history': { rankHistory: (name, packs, ladder) => { const rows = officers.rankHistory(name, packs, ladder); return rows.map((r) => ({ ...r, rank: rows[0].rank })); } },
  // a game event that promotes the commander
  'no-rank-from-events': { applyMerit: (scn, s, o) => { const out = officers.applyMerit(scn, s, o); return { ...out, units: out.units.map((d) => (d.officer?.merit === 3 ? { ...d, commander: { ...d.commander, rank: 'Brigadier General' } } : d)) }; } },
  // the camp says nothing
  'officer-lines': { officerLines: () => [] },
  // a missing parent line passed through as text, as the card's stray "null"
  'view-no-null': { officerView: (i) => { const v = officers.officerView(i); return { ...v, command: { ...v.command, parent: `${i.parent}` } }; } },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function officersUnit(api = API) {
  for (const [name, check] of OFFICER_CHECKS) await runCheck(name, check, api);
  return OFFICER_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of OFFICER_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = OFFICER_CHECKS.length;
  if (failed) { console.log(`OFFICERS FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`OFFICERS OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of OFFICER_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`OFFICERS CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`OFFICERS CONTROLS OK (${caught}/${n})`);
  }
}

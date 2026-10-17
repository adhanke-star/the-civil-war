// CPU state/contract checks on the real authored rosters; terminal games below are explicit fixtures, not playthroughs.
// No browser/GPU/storage writes. --prove-fail requires each named control to fail its own check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import { phaseOutcome } from '../src/franchise/practice.js';
import { phasePoints, phaseSummary } from '../src/franchise/economy.js';
import { awardBadges, FEAT_STATS } from '../src/franchise/badges.js';
import { applyMerit, officerRows, recordOfficers } from '../src/franchise/officers.js';
import { preparePhase, prepareFieldScenario } from '../src/sim/phase.js';
import { VETERANCY } from '../src/reward/data.js';
// Weapon card profiles of the authored field classes (PLAN v6 data boundary); Gage's is the one documented exception.
const PROFILE = { smooth: 'm1842', rifled: 'enfield', smbart: 'sixPdr', napoleon: 'napoleon', parrott: 'parrott10' }, EXCEPT = { 'cs-gage-alabama-battery': 'howitzer12' };

const read = p => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const CS = read('assets/campaign-cs.json'), US = read('assets/campaign.json'), copy = structuredClone;
const PACKS = Object.fromEntries(['shiloh', 'stones-river', 'chattanooga'].map(id => [id, read(`assets/packs/${id}.json`)]));
const defs = s => [...s.units, ...(s.reinforcements || [])];
const authored = p => prepareFieldScenario(preparePhase(PACKS[p.packId], p.phaseId).scenario, 'pack');
const API = { ...campaign, ...save, phaseOutcome, phasePoints, phaseSummary, awardBadges, applyMerit, officerRows, recordOfficers, definition: () => copy(CS) };
const start = api => api.newCampaign({ campaign: api.definition(), slot: 3, seed: 'cs-contract' });
function terminal(scenario, { winner = 'CS', grade, arrived = true, loss = 0 } = {}) {
  return { scenario, playerSide: 'CS', over: true, holder: winner, simTime: 1,
    result: { winner, draw: winner === null, grade, why: 'Explicit CPU terminal fixture' },
    units: (arrived ? defs(scenario) : scenario.units).map(d => ({ id: d.id, side: d.side, name: d.name,
      type: d.type || 'infantry', menMax: d.men, men: Math.max(1, d.men - (d.side === 'CS' ? loss : loss * 4)),
      weapon: d.weapon || 'smooth', xp: d.xp || 1, equipment: d.equipment, state: 'steady',
      ...(d.type === 'artillery' ? { gunSlots: Array.from({ length: d.guns }, () => ({ alive: true })) } : {}) })),
    fieldCaptures: { held: () => [] } };
}
function play(api, before, options = {}) {
  const p = api.campaignPhase(before, api.definition(), { replay: options.replay === true });
  const s = api.applyCampaign(authored(p), before, p), game = terminal(s, options);
  const r = api.phaseResult({ phase: p, game, scenario: s });
  return { phase: p, scenario: s, game, outcome: r.outcome, record: r.record,
    after: api.recordPhase(before, api.definition(), r.record) };
}
const feat = (d, heldVolley = 10) => ({ side: d.side, xp: d.xp || 1, menStart: d.men,
  ...Object.fromEntries(FEAT_STATS.map(k => [k, k === 'heldVolley' ? heldVolley : 0])) });

const CHECKS = [
  ['roster', api => {
    const c = api.validateCampaign(api.definition());
    assert.equal(c.franchise.length, 6); assert.equal(c.phases.length, 11);
    assert.deepEqual(c.phases.map(p => p.joins?.length || 0), [5, 5, 1, 4, 7, 6, 4, 4, 2, 4, 8]);
    assert.deepEqual(c.phases.map(p => [p.packId, p.phaseId]), US.phases.map(p => [p.packId, p.phaseId]));
    assert.ok(c.phases.every(p => !p.loan));
    const rows = [...c.franchise, ...c.phases.flatMap(p => p.joins || [])];
    assert.equal(rows.length, 56); assert.equal(new Set(rows.map(r => r.unitId)).size, 56);
    assert.equal(rows.filter(r => r.kind === 'battery').length, 13);
    const seen = new Set(c.franchise.map(r => r.unitId));
    for (const p of c.phases) {
      const own = defs(authored(p)).filter(d => d.side === 'CS');
      assert.deepEqual(new Set((p.joins || []).map(r => r.unitId)), new Set(own.filter(d => !seen.has(d.id)).map(d => d.id)));
      for (const r of p.joins || []) seen.add(r.unitId);
      for (const d of own) { const r = rows.find(r => r.unitId === d.id); assert.ok(r); }
    }
    const first = new Map(); for (const p of c.phases) for (const d of defs(authored(p))) if (d.side === 'CS' && !first.has(d.id)) first.set(d.id, d);
    for (const r of rows) {
      const d = first.get(r.unitId); assert.equal(r.label, d.name); assert.equal(r.men, d.men); if (r.kind === 'battery') assert.equal(r.guns, d.guns);
      assert.equal(r.vet, VETERANCY[(d.xp || 1) - 1].id); assert.equal(r.weapon, EXCEPT[r.unitId] || PROFILE[d.weapon]);
    }
    assert.equal(rows.find(r => r.unitId === 'cs-gage-alabama-battery').weapon, 'howitzer12');
    const dawn = authored(c.phases[0]); assert.equal(dawn.reinforcements.find(d => d.id === 'cs-chalmers-brigade').atSec, 840);
    assert.equal(dawn.reinforcements.find(d => d.id === 'cs-russell-brigade').atSec, 900);
    assert.equal(start(api).army.length, 11);
  }],
  ['identity', api => {
    for (const d of [{ ...CS, side: 'CSA' }, { ...CS, side: 'US' }, { ...CS, side: undefined }, { ...US, side: 'CS' }]) assert.throws(() => api.validateCampaign(d));
    const s = start(api); assert.equal(s.campaign.side, 'CS'); assert.equal(api.campaignPhase(s, CS).side, 'CS');
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(s)), s);
    for (const side of [undefined, 'US', 'CSA']) assert.throws(() => api.validateSnapshot({ ...s, campaign: { ...s.campaign, side } }));
    const p = api.campaignPhase(s, CS); assert.throws(() => api.applyCampaign(authored(p), s, { ...p, side: 'US' }));
    const us = api.newCampaign({ campaign: US, slot: 1, seed: 1 });
    assert.throws(() => api.validateSnapshot({ ...us, campaign: { ...us.campaign, side: 'CS' } }));
    // Same ladder id, other side: the definition is refused for the save (campaign.js campaignSave), both ways round.
    const x = api.newCampaign({ campaign: { ...copy(CS), id: 'x-ladder' }, slot: 3, seed: 1 });
    assert.throws(() => api.campaignPhase(x, { ...copy(US), id: 'x-ladder' }), /another side/);
    const y = api.newCampaign({ campaign: { ...copy(US), id: 'x-ladder' }, slot: 3, seed: 1 });
    assert.throws(() => api.campaignPhase(y, { ...copy(CS), id: 'x-ladder' }), /another side/);
  }],
  ['duplicate-join', api => {
    const across = copy(CS); across.phases[1].joins.push(copy(across.phases[0].joins[0]));
    assert.throws(() => api.validateCampaign(across), /unique/);
    const core = copy(CS); core.phases[0].joins.push(copy(core.franchise[0]));
    assert.throws(() => api.validateCampaign(core), /unique/);
    assert.throws(() => api.newCampaign({ campaign: across, slot: 3, seed: 1 }));
  }],
  ['legacy-union', api => {
    const s = api.newCampaign({ campaign: US, slot: 1, seed: 1 });
    assert.ok(!Object.hasOwn(s.campaign, 'side'));
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(s)), s);
    assert.ok(!Object.hasOwn(api.campaignPhase(s, US), 'side'));
    assert.deepEqual(api.validateCampaign(US), US);
  }],
  ['field-side', api => {
    const s = start(api), p = api.campaignPhase(s, CS), source = authored(p), before = JSON.stringify(source);
    const id = 'cs-wood-brigade', b = s.army.find(b => b.id === id); b.men -= 70; b.vet = 'veteran';
    const out = api.applyCampaign(source, s, p), own = out.units.find(d => d.id === id);
    assert.equal(own.men, b.men); assert.equal(own.xp, 3); assert.equal(own.equipment.uid, b.weapon.uid);
    assert.deepEqual(out.units.filter(d => d.side === 'US'), source.units.filter(d => d.side === 'US'));
    assert.equal(JSON.stringify(source), before);
    assert.ok(!defs(out).some(d => d.id === 'cs-stephens-brigade'));
    b.men = 0; assert.ok(!defs(api.applyCampaign(source, s, p)).some(d => d.id === id));
  }],
  ['all-phases', api => {
    let s = start(api);
    for (let i = 0; i < 11; i++) {
      const prior = s, r = play(api, s, { loss: 3, winner: i === 4 ? 'US' : 'CS' }); s = r.after;
      // Same-ID carry: a fielded brigade takes the field at min(authored, carried) strength and loses exactly the fixture's 3 men.
      const was = prior.army.find(b => b.id === 'cs-wood-brigade').men, fielded = r.record.units.some(u => u.id === 'cs-wood-brigade');
      if (fielded) assert.equal(defs(r.scenario).find(d => d.id === 'cs-wood-brigade').men, Math.min(was, defs(authored(r.phase)).find(d => d.id === 'cs-wood-brigade').men));
      assert.equal(s.army.find(b => b.id === 'cs-wood-brigade').men, was - (fielded ? 3 : 0));
      assert.equal(s.campaign.side, 'CS'); assert.equal(s.campaign.index, i + 1);
      assert.equal(s.campaign.history.length, i + 1);
      assert.ok(s.army.length >= prior.army.length);
      assert.equal(s.campaign.history.at(-1).lossesCS, r.record.units.filter(u => u.side === 'CS').length * 3);
      assert.equal(s.campaign.history.at(-1).grade, i === 4 ? 'Defeat' : 'Victory');
      assert.deepEqual(api.validateSnapshot(s), s);
    }
    assert.equal(s.army.length, 56); assert.equal(s.campaign.status, 'complete'); assert.equal(api.campaignPhase(s, CS), null);
  }],
  ['result-side', api => {
    const s = start(api), p = api.campaignPhase(s, CS), scenario = api.applyCampaign(authored(p), s, p);
    scenario.crates = [{ id: 'cpu-crate', name: 'Fictional CPU crate', tier: 'rare' }];
    const game = terminal(scenario, { arrived: false });
    const enemy = scenario.units.find(d => d.side === 'US');
    game.fieldCaptures.held = side => side === 'CS' ? scenario.crates : [];
    game.colourReport = side => side === 'CS' ? [{ unitId: enemy.id, regiment: 'Fictional CPU colour', side: 'US', by: 'CPU fixture' }] : [];
    const r = api.phaseOutcome({ game, scenario, awardId: p.awardId, seed: p.seed });
    assert.equal(r.grade, 'Victory'); assert.equal(r.held, true); assert.equal(r.captures.length, 1); assert.equal(r.colours[0].side, 'US');
    const arriving = scenario.reinforcements.find(d => d.id === 'cs-chalmers-brigade'); assert.equal(r.units.find(u => u.id === arriving.id).men, arriving.men);
    game.result.winner = 'US'; game.holder = 'US';
    assert.equal(api.phaseOutcome({ game, scenario, awardId: p.awardId, seed: p.seed }).grade, 'Defeat');
    assert.throws(() => api.phaseResult({ phase: p, game: { ...game, playerSide: 'US' }, scenario }));
  }],
  ['low-loss', api => {
    const args = { grade: 'Victory', held: true, lossesUS: 100, lossesCS: 10 };
    assert.ok(api.phasePoints({ ...args, side: 'CS' }).lines.some(l => l.id === 'lowLoss'));
    assert.ok(!api.phasePoints({ ...args, side: 'US' }).lines.some(l => l.id === 'lowLoss'));
    const s = start(api), r = play(api, s, { loss: 3 }), summary = api.phaseSummary(s, r.after);
    assert.ok(summary.lines.some(l => l.id === 'lowLoss'));
    // The paid points (ledger row and rp) must equal the after-action's lines: the saved score is not recomputed for the Union.
    const row = r.after.ledger.find(l => l.kind === 'phase' && l.awardId === r.phase.awardId);
    assert.equal(row.score, summary.lines.filter(l => l.id !== 'replay').reduce((n, l) => n + l.points, 0));
    assert.equal(r.after.rp - s.rp, summary.points);
  }],
  ['badges', api => {
    const s = start(api), p = api.campaignPhase(s, CS), scenario = api.applyCampaign(authored(p), s, p);
    const own = scenario.units.find(d => d.id === 'cs-wood-brigade'), enemy = scenario.units.find(d => d.side === 'US');
    const feats = { [own.id]: feat(own), [enemy.id]: feat(enemy) };
    const r = api.awardBadges(s, { awardId: p.awardId, feats });
    assert.ok(r.save.army.find(b => b.id === own.id).badges.some(b => b.id === 'firstVolley'));
    assert.ok(r.save.enemy[enemy.id].badges.some(b => b.id === 'firstVolley'));
    assert.ok(!r.save.enemy[own.id]);
    const game = terminal(scenario); game.featReport = () => feats;
    const recorded = api.phaseResult({ phase: p, game, scenario });
    const next = api.recordPhase(s, CS, recorded.record), replay = api.campaignPhase(next, CS, { replay: true });
    const field = api.applyCampaign(authored(replay), next, replay);
    assert.ok(field.units.find(d => d.id === own.id).badges.some(b => b.id === 'firstVolley'));
    assert.ok(field.units.find(d => d.id === enemy.id).badges.some(b => b.id === 'firstVolley'));
    // Officer records written by the phase belong to CS commanders only (recordOfficers via recordPhase).
    const led = side => new Set(defs(scenario).filter(d => d.side === side && d.commander?.name).map(d => d.commander.name));
    const cs = led('CS'), us = led('US'), names = Object.keys(next.officers || {});
    assert.ok(names.length); for (const n of names) { assert.ok(cs.has(n)); assert.ok(!us.has(n)); }
  }],
  ['officers', api => {
    const s = start(api), p = api.campaignPhase(s, CS), scenario = api.applyCampaign(authored(p), s, p), game = terminal(scenario);
    const rows = api.officerRows({ game, scenario });
    assert.ok(rows.length); assert.ok(rows.every(r => defs(scenario).find(d => d.id === r.unitId).side === 'CS'));
    const own = scenario.units.find(d => d.id === 'cs-wood-brigade'), arriving = scenario.reinforcements.find(d => d.id === 'cs-chalmers-brigade');
    s.officers = Object.fromEntries([own, arriving].map(d => [d.commander.name, { merit: 1, record: [] }]));
    const out = api.applyMerit(scenario, s);
    assert.equal(out.units.find(d => d.id === own.id).officer.merit, 1);
    assert.equal(out.reinforcements.find(d => d.id === arriving.id).officer.merit, 1);
    assert.ok(out.units.filter(d => d.side === 'US').every(d => !d.officer));
  }],
  ['replay', api => {
    const first = play(api, start(api)), once = first.after;
    assert.deepEqual(api.recordPhase(once, CS, first.record), once);
    const retry = play(api, once, { replay: true, winner: 'US' }).after;
    assert.equal(retry.campaign.index, 1); assert.equal(retry.campaign.history.at(-1).replay, true);
    assert.deepEqual(retry.army.map(b => b.id), once.army.map(b => b.id));
    assert.equal(new Set(retry.depot.map(c => c.uid)).size, retry.depot.length);
  }],
];
const MUTANTS = {
  roster: { definition: () => { const d = copy(CS); d.franchise[0].vet = 'veteran'; return d; } },
  'duplicate-join': { validateCampaign: d => { const seen = new Set(d.franchise.map(r => r.unitId));
    return campaign.validateCampaign({ ...d, phases: d.phases.map(p => ({ ...p, joins: p.joins?.filter(j => !seen.has(j.unitId) && seen.add(j.unitId)) })) }); } },
  identity: { validateCampaign: d => d },
  'legacy-union': { newCampaign: o => { const s = campaign.newCampaign(o); s.campaign.side = 'US'; return s; } },
  'field-side': { applyCampaign: scenario => copy(scenario) },
  'all-phases': { recordPhase: (...args) => { const s = campaign.recordPhase(...args); delete s.campaign.side; return s; } },
  'result-side': { phaseOutcome: o => { const r = phaseOutcome(o); return { ...r, grade: r.grade === 'Victory' ? 'Defeat' : r.grade === 'Defeat' ? 'Victory' : r.grade }; } },
  'low-loss': { recordPhase: (...a) => { const n = copy(campaign.recordPhase(...a)); const row = n.ledger.find(l => l.kind === 'phase'); row.score -= 10; row.points -= 10; n.rp -= 10; n.reputation -= 10; return n; } },
  badges: { awardBadges: (s, ctx) => awardBadges({ ...s, campaign: { ...s.campaign, side: 'US' } }, ctx) },
  officers: { officerRows: o => officerRows({ ...o, game: { ...o.game, playerSide: 'US' } }) },
  replay: { recordPhase: (s, c, r) => { const n = campaign.recordPhase(s, c, r); if (n.campaign.history.at(-1).replay) n.campaign.index++; return n; } },
};
function run(name, check, api) {
  try { check(api); } catch (e) { throw new Error(`${name}: ${String(e.message).split('\n')[0]}`); }
}
export function confederateUnit(api = API) { for (const [name, check] of CHECKS) run(name, check, api); return CHECKS.length; }
if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of CHECKS) { try { run(name, check, API); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${e.message}`); } }
  console.log(`CONFEDERATE ${failed ? 'FAILED' : 'OK'} (${CHECKS.length - failed}/${CHECKS.length})`);
  if (failed) process.exit(1);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of CHECKS) { try { run(name, check, { ...API, ...MUTANTS[name] }); console.log(`NOT-CAUGHT ${name}`); }
      catch (e) { caught++; console.log(`CAUGHT ${e.message}`); } }
    console.log(`CONFEDERATE CONTROLS ${caught === CHECKS.length ? 'OK' : 'FAILED'} (${caught}/${CHECKS.length})`);
    if (caught !== CHECKS.length) process.exit(1);
  }
}

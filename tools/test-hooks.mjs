// CPU check (contract P5d): camp effects reach the battle, difficulty levels, captured colours. Fictional fields on flat ground
// and a fictional campaign are built here (nothing ships for them; nothing is written to disk). Every number checked is a game
// rule in src/franchise/tuning.js (CAMP.battle, CAMP.upgrades.pioneers, DIFFICULTY, COLOURS), never history.
//   - each camp effect changes the fight in its stated direction and is inert without its field (training: Fire, Drill, Melee,
//     Morale; shoes -> starting fatigue; ammunition -> fewer rounds, out of rounds stops firing until resupplied out of
//     contact; horses -> slow limbering and unlimbering; pioneers -> faster through woods), Henry Hill's oracle unchanged;
//   - the camp writes them (breakCamp records shortages, applyCampaign fields them, phase.js validates them);
//   - difficulty changes only AI timing and decisions and the auto-pause: the same fight with AI orders frozen gives identical
//     casualties at every level; General never auto-pauses, Recruit always does;
//   - colours are taken once and deterministically (overrun, destroyed, surrender), with zero random draws, saved in
//     trophies.colours, round-tripped, never twice; older saves load (Veteran, no trophies);
//   - the card and after-action lines name what applied.
// `node tools/test-hooks.mjs` prints HOOKS OK (n/n); `--prove-fail` also runs one mutant per check and requires each to fail
// its own check, with the check's name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game, difficultyOf } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import * as orders from '../src/franchise/camp-orders.js';
import { phaseOutcome, historyComparison } from '../src/franchise/practice.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { ColourCaptures } from '../src/franchise/captures.js';
import { CAMP, DIFFICULTY, COLOURS } from '../src/franchise/tuning.js';
import { campEffectLines } from '../src/franchise/badges.js';
import { henryHillRun } from './test-packs.mjs';

RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';
const copy = structuredClone;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// The Henry Hill oracle is owned by tools/test-packs.mjs; read it, never restate it.
const ORACLE = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));

// ---- fictional fields ----------------------------------------------------------------------------------------------------
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 1500, weapon: 'rifled', xp: 2,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });
const far = (id, side) => def(id, side, side === 'US' ? -1700 : 1700, side === 'US' ? -1700 : 1700); // keeps a side in the field
const CAMP_KEYS = ['training', 'fatigue', 'ammo', 'limber', 'pioneers'];
/** A fictional field (Henry Hill rules); with `manual` (default) the AI orders nobody. */
function makeField(defs, extra = {}, { manual = true } = {}) {
  const s = { id: 'henry-hill', title: 'Fictional hooks CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '18:00',
    units: defs, sites: [], woods: [], objective: { name: 'Fictional remote point', x: 1900, z: -1900, r: 30 }, ...extra };
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  if (manual) for (const u of g.units) u.manual = true;
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);
const run = (g, s) => { for (let k = 0; k < Math.round(s / 0.05); k++) g.tick(0.05); };
const WOOD = (x0, z0, x1, z1) => ({ polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
const stripped = (defs) => defs.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !CAMP_KEYS.includes(k))));
const REGS = ['1st Fictional Infantry', '2nd Fictional Infantry', '3rd Fictional Infantry'];

// ---- a fictional campaign ----------------------------------------------------------------------------------------------
const CAMPAIGN = { version: 1, id: 'test-hooks', title: 'Fictional hooks test campaign', franchise: [
  { unitId: 'alpha', label: 'Test brigade (fictional)', kind: 'infantry', men: 2000, weapon: 'm1842', vet: 'trained' },
  { unitId: 'bravo', label: 'Test battery (fictional)', kind: 'battery', men: 100, guns: 4, weapon: 'sixPdr', vet: 'green' }],
phases: [{ packId: 'pa', phaseId: 'a1', loan: true }, { packId: 'pa', phaseId: 'a2' }, { packId: 'pb', phaseId: 'b1' }] };
/** Ten more brigades and three batteries (fictional) so the quartermaster's issue cannot cover every one. */
const BIG = { ...CAMPAIGN, id: 'test-hooks-big', phases: [{ packId: 'pa', phaseId: 'a2' }], franchise: [...CAMPAIGN.franchise,
  ...Array.from({ length: 10 }, (_, i) => ({ unitId: `inf${i}`, label: `Test brigade ${i} (fictional)`, kind: 'infantry', men: 1000, weapon: 'm1842', vet: 'green' })),
  ...Array.from({ length: 2 }, (_, i) => ({ unitId: `bat${i}`, label: `Test battery ${i} (fictional)`, kind: 'battery', men: 80, guns: 4, weapon: 'sixPdr', vet: 'green' }))] };
const SCENARIO = { ...copy(HH), id: 'test-hooks', title: 'Fictional hooks phase (test only)', attacker: 'US',
  units: [def('alpha', 'US', -400, 0, { regiments: ['1st Test Regiment'] }), def('bravo', 'US', -500, -100, { type: 'artillery', men: 100, guns: 4, weapon: 'napoleon' }),
    def('reb', 'CS', 400, 0, { regiments: REGS })] };
delete SCENARIO.opening;
const AT = '2026-10-11T12:00:00Z';
function fakeGame(scenario, colours = []) {
  const units = [...scenario.units, ...(scenario.reinforcements || [])].map((d) => ({ id: d.id, side: d.side, type: d.type || 'infantry', name: d.name,
    menMax: d.men, men: d.men, weapon: d.weapon || 'smooth', xp: d.xp || 1, equipment: d.equipment,
    ...(d.type === 'artillery' ? { gunSlots: Array.from({ length: d.guns }, () => ({ alive: true })) } : {}) }));
  return { scenario, over: true, playerSide: 'US', result: { winner: 'US', draw: false, grade: 'victory', why: 'Fictional test result' }, units,
    fieldCaptures: { held: () => [] }, simTime: 60, clockRatio: 4, holder: 'US',
    colourReport: (side) => colours.filter((r) => !side || r.bySide === side).map((r) => ({ ...r })) };
}
const colourRow = (regiment, by = 'alpha') => ({ unitId: 'reb', regiment, formation: 'reb', side: 'CS', byId: by, by: `Fictional ${by}`, bySide: 'US', atSec: 10, how: 'overrun' });
function play(api, before, colours = [], { replay = false } = {}) {
  const phase = api.campaignPhase(before, CAMPAIGN, { replay });
  const scenario = api.applyCampaign(SCENARIO, before, phase);
  const { record } = api.phaseResult({ phase, game: fakeGame(scenario, colours), scenario });
  return { phase, scenario, record, after: api.recordPhase(before, CAMPAIGN, { ...record, at: AT }) };
}
const refuses = (name, fn, pattern) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
};

const API = { field: makeField, ...campaign, ...save, ...orders, phaseOutcome, historyComparison, prepareFieldScenario,
  henryHill: (transform = (s) => s) => henryHillRun({ transform }) };

// ---- checks -------------------------------------------------------------------------------------------------------------
const HOOK_CHECKS = [
  ['fire-training', async (api) => {
    const fight = (extra) => { const g = api.field([def('us', 'US', 0, -150, extra), def('cs', 'CS', 0, 0, { men: 2500 })]); unit(g, 'cs').holdFire = true; run(g, 30); return unit(g, 'cs').casualties; };
    const base = fight({}), trained = fight({ training: { fire: 6 } }), zero = fight({ training: { fire: 0 } });
    const want = 1 + (6 * CAMP.battle.perPoint) / 100;
    assert.ok(trained > base * (want - 0.02) && trained < base * (want + 0.02), `fire-training: 6 Fire points gave ${trained.toFixed(1)} casualties against ${base.toFixed(1)} (want about x${want})`);
    assert.equal(zero, base, 'fire-training: zero Fire points changed the fight');
  }],
  ['drill-training', async (api) => {
    const fight = (extra) => { const g = api.field([def('us', 'US', 0, -150, extra), def('cs', 'CS', 0, 0, { men: 2500 })]); unit(g, 'cs').holdFire = true; run(g, 120);
      return [unit(g, 'us').shots, unit(g, 'cs').casualties]; };
    const [s0, c0] = fight({}), [s1, c1] = fight({ training: { drill: 6 } });
    assert.ok(s1 > s0 && c1 > c0, `drill-training: 6 Drill points fired ${s1} volleys for ${c1.toFixed(1)} casualties against ${s0} for ${c0.toFixed(1)}`);
    const wheel = (extra) => { const g = api.field([def('us', 'US', 0, 0, extra), far('cs', 'CS')]); const u = unit(g, 'us'); u.goalFacing = Math.PI / 2; run(g, 1); return u.facing; };
    const w0 = wheel({}), w1 = wheel({ training: { drill: 6 } });
    assert.ok(Math.abs(w1 / w0 - 1.06) < 0.005, `drill-training: the drilled line wheeled ${w1.toFixed(3)} rad in 1 s against ${w0.toFixed(3)}`);
  }],
  ['melee-training', async (api) => {
    const charge = (extra) => {
      const g = api.field([def('us', 'US', 0, -60, { xp: 3, ...extra }), def('cs', 'CS', 0, 0), far('csr', 'CS')]); unit(g, 'cs').holdFire = true;
      const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 10);
      return [u.casualties, unit(g, 'cs').casualties];
    };
    const [a0, b0] = charge({}), [a1, b1] = charge({ training: { melee: 6 } });
    assert.ok(a1 < a0 && b1 > b0, `melee-training: 6 Melee points lost ${a1.toFixed(1)} and inflicted ${b1.toFixed(1)} against ${a0.toFixed(1)} and ${b0.toFixed(1)}`);
  }],
  ['morale-training', async (api) => {
    const shaken = (extra) => { const g = api.field([def('us', 'US', 0, -150), def('cs', 'CS', 0, 0, { men: 2500, ...extra })]); unit(g, 'cs').holdFire = true; run(g, 20); return unit(g, 'cs').morale; };
    const m0 = shaken({}), m1 = shaken({ training: { morale: 6 } });
    assert.ok(m1 > m0, `morale-training: 6 Morale points kept ${m1.toFixed(3)} morale against ${m0.toFixed(3)} under the same fire`);
  }],
  ['shoes-fatigue', async (api) => {
    const march = (extra) => {
      const g = api.field([def('us', 'US', 0, -900, extra), far('cs', 'CS')]); const u = unit(g, 'us'), start = u.fatigue;
      g.order(u, { type: 'move', points: [[0, -900], [0, 0]] }); run(g, 30); const walked = u.z + 900;
      g.select(u); g.orderSelected('halt'); const tired = u.fatigue; run(g, 10);
      return { start, walked, tired, rested: u.fatigue };
    };
    const shod = march({}), bare = march({ fatigue: CAMP.battle.fatigue });
    assert.equal(shod.start, 0, 'shoes-fatigue: a brigade with shoes started tired');
    assert.equal(bare.start, CAMP.battle.fatigue, 'shoes-fatigue: the barefoot brigade did not start tired');
    assert.ok(bare.walked < shod.walked * 0.92, `shoes-fatigue: barefoot marched ${bare.walked.toFixed(1)} m against ${shod.walked.toFixed(1)} m`);
    assert.ok(bare.rested < bare.tired, `shoes-fatigue: resting did not recover fatigue (${bare.tired.toFixed(1)} -> ${bare.rested.toFixed(1)})`);
  }],
  ['ammo-short', async (api) => {
    const g = api.field([def('us', 'US', 0, -150, { ammo: 3 }), def('full', 'US', 600, -150), def('cs', 'CS', 0, 0, { men: 2500 }), def('cs2', 'CS', 600, 0, { men: 2500 })]);
    unit(g, 'cs').holdFire = true; unit(g, 'cs2').holdFire = true;
    const u = unit(g, 'us'), full = unit(g, 'full');
    assert.equal(u.ammo, 3, 'ammo-short: the short brigade did not start with its rounds');
    assert.equal(full.ammo, 100, 'ammo-short: a full brigade started short');
    run(g, 40);
    assert.ok(u.ammo === 0 && u.shots === 3 && !u.target && full.shots > 3, `ammo-short: out of rounds it must stop firing (ammo ${u.ammo}, ${u.shots} volleys, full brigade ${full.shots})`);
    const shots = u.shots; run(g, 10);
    assert.equal(u.shots, shots, 'ammo-short: it fired again in contact with no rounds');
    unit(g, 'cs').vehicle.position.set(0, 0, 1800); run(g, 10); // out of contact: the trains refill it slowly
    assert.ok(u.ammo > 10 && u.ammo < 40, `ammo-short: resupply out of contact gave ${u.ammo.toFixed(1)} rounds in 10 s (slowly, about 2 a second)`);
    unit(g, 'cs').vehicle.position.set(0, 0, 0); run(g, 6);
    assert.ok(u.shots > shots, 'ammo-short: resupplied, it did not fire again');
  }],
  ['horses-limber', async (api) => {
    const battery = (extra) => {
      const g = api.field([def('us', 'US', 0, -300, { type: 'artillery', men: 100, guns: 4, weapon: 'napoleon', ...extra }), far('usr', 'US'), def('cs', 'CS', 1500, 1900, { men: 2500 })]);
      const u = unit(g, 'us'), cs = unit(g, 'cs'); cs.holdFire = true;
      g.order(u, { type: 'move', points: [[0, -300], [0, -280]] }); const z0 = u.z; run(g, 4); const moved = u.z - z0;
      let t = 0; while (u.follow.active && t < 40) { g.tick(0.05); t += 0.05; }
      cs.vehicle.position.set(0, 0, 300); const s0 = u.shots || 0;
      let wait = 0; while ((u.shots || 0) === s0 && wait < 30) { g.tick(0.05); wait += 0.05; }
      return { moved, wait };
    };
    const teams = battery({}), short = battery({ limber: CAMP.battle.limber });
    assert.ok(teams.moved > 5 && short.moved < 0.5, `horses-limber: in 4 s the battery short of horses moved ${short.moved.toFixed(2)} m (a full team ${teams.moved.toFixed(2)} m)`);
    assert.ok(teams.wait < 1.5, `horses-limber: a full team fired ${teams.wait.toFixed(2)} s after halting`);
    const need = 6 + CAMP.battle.limber;
    assert.ok(short.wait >= need - 0.1 && short.wait < need + 1.5, `horses-limber: short of horses it fired ${short.wait.toFixed(2)} s after halting (want about ${need} s)`);
  }],
  ['pioneers-woods', async (api) => {
    const march = (extra) => {
      const g = api.field([def('us', 'US', 0, -900, extra), far('cs', 'CS')], { woods: [WOOD(-300, -1000, 300, 0)] }); const u = unit(g, 'us');
      g.order(u, { type: 'move', points: [[0, -900], [0, 0]] }); run(g, 30); return u.z + 900;
    };
    const base = march({}), pio = march({ pioneers: true }), want = CAMP.upgrades.pioneers.woods / 0.7;
    assert.ok(pio > base * (want - 0.05) && pio < base * (want + 0.05), `pioneers-woods: pioneers marched ${pio.toFixed(1)} m through woods against ${base.toFixed(1)} m (want about x${want.toFixed(2)})`);
  }],
  ['inert-oracle', async (api) => {
    assert.deepEqual(api.henryHill(), ORACLE, 'inert-oracle: Henry Hill without camp fields differs from the test-packs oracle');
    assert.deepEqual(api.henryHill((s) => ({ ...s, difficulty: 'veteran' })), ORACLE, 'inert-oracle: Henry Hill at Veteran differs from the oracle');
  }],
  ['apply-campaign', async (api) => {
    let s = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: AT, difficulty: 'general' });
    const loanPhase = api.campaignPhase(s, CAMPAIGN), loan = api.applyCampaign(SCENARIO, s, loanPhase);
    assert.ok(loan.difficulty === 'general' && loan.units.every((d) => !CAMP_KEYS.some((k) => has(d, k))), 'apply-campaign: a loan phase fielded camp effects or lost the difficulty');
    s = play(api, s).after; // the loan phase is recorded; a2 is the franchise's
    const phase = api.campaignPhase(s, CAMPAIGN);
    const bare = api.applyCampaign(SCENARIO, s, phase);
    assert.ok(bare.units.every((d) => !CAMP_KEYS.some((k) => has(d, k))), 'apply-campaign: camp effects appeared without camp, training or pioneers');
    const camped = save.validateSnapshot({ ...s, army: s.army.map((b) => (b.id === 'alpha' ? { ...b, bonus: { fire: 2, melee: 0, morale: 0, drill: 3 }, base: { ...b.base, fire: b.base.fire + 2, drill: b.base.drill + 3 } } : b)),
      ready: { awardId: phase.awardId, morale: { alpha: -6 }, short: { alpha: ['ammunition', 'shoes'], bravo: ['horses'] } },
      rp: 0, reputation: 90, level: 2, ledger: [{ kind: 'level', level: 2, uid: 'test-hooks.1.fixture.level.2' }, { kind: 'turnIn', item: { uid: 'test-hooks.1.fixture.t', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional' }, points: 90, at: 0 },
        { kind: 'upgrade', id: 'pioneers', price: 90 }], upgrades: ['pioneers'] });
    const out = api.applyCampaign(SCENARIO, camped, phase), a = out.units.find((d) => d.id === 'alpha'), b = out.units.find((d) => d.id === 'bravo'), r = out.units.find((d) => d.id === 'reb');
    assert.deepEqual([a.training, a.ammo, a.fatigue, a.pioneers, has(a, 'limber')], [{ fire: 2, drill: 3 }, CAMP.battle.ammo, CAMP.battle.fatigue, true, false], 'apply-campaign: the brigade\'s camp effects');
    assert.deepEqual([b.limber, b.pioneers, has(b, 'ammo'), has(b, 'fatigue')], [CAMP.battle.limber, true, false, false], 'apply-campaign: the battery\'s camp effects');
    assert.ok(!CAMP_KEYS.some((k) => has(r, k)) && out.difficulty === 'general', 'apply-campaign: the enemy got camp effects or the difficulty was lost');
    const other = api.applyCampaign(SCENARIO, camped, { ...phase, awardId: `${phase.awardId}x` }).units.find((d) => d.id === 'alpha');
    assert.ok(!has(other, 'ammo') && !has(other, 'fatigue') && has(other, 'training'), 'apply-campaign: another attempt\'s shortages leaked (training stays)');
    const field = prepareFieldScenario(out, 'pack');
    const g = makeField(field.units.map((d) => ({ ...d })), { attacker: 'US', difficulty: field.difficulty });
    assert.deepEqual([unit(g, 'alpha').ammo, unit(g, 'alpha').fatigue, difficultyOf(g)], [CAMP.battle.ammo, CAMP.battle.fatigue, 'general'], 'apply-campaign: the field did not start with the camp\'s state');
  }],
  ['break-camp-short', async (api) => {
    let s = api.newCampaign({ campaign: BIG, slot: 1, seed: 5, at: AT });
    s = save.validateSnapshot({ ...s, stores: { ...CAMP.start, ammunition: 0, shoes: 0, horses: 0 } });
    const phase = api.campaignPhase(s, BIG), m = api.breakCamp(s, { campaign: BIG });
    const short = m.ready.short || {};
    const lacking = (k) => Object.keys(short).filter((id) => short[id].includes(k)).sort();
    const fielded = m.army.filter((b) => b.unitId).length, batteries = m.army.filter((b) => b.kind === 'battery').length;
    assert.equal(m.ready.awardId, phase.awardId, 'break-camp-short: the march is for this phase attempt');
    assert.equal(lacking('shoes').length, fielded - CAMP.issue.shoes, 'break-camp-short: the brigades without shoes');
    assert.equal(lacking('ammunition').length, fielded - Math.floor(CAMP.issue.ammunition / CAMP.use.ammunition), 'break-camp-short: the brigades without ammunition');
    assert.equal(lacking('horses').length, batteries - Math.floor(CAMP.issue.horses / CAMP.use.horses), 'break-camp-short: the batteries without horses');
    assert.ok(Object.keys(short).every((id) => (m.ready.morale[id] ?? 0) < CAMP.rest.morale), 'break-camp-short: a short brigade kept its rested morale');
    assert.deepEqual(save.parseSnapshot(save.exportSnapshot(m)), m, 'break-camp-short: the shortages did not round-trip');
    assert.ok((orders.campReport(s, m) || []).some((l) => /start tired/.test(l) && /fewer rounds/.test(l) && /limber slowly/.test(l)), 'break-camp-short: the camp report does not name the battle effects');
    refuses('break-camp-short', () => save.validateSnapshot({ ...m, ready: { ...m.ready, short: { nobody: ['shoes'] } } }), /shortages name a brigade/);
    refuses('break-camp-short', () => save.validateSnapshot({ ...m, ready: { ...m.ready, short: { alpha: ['wagons'] } } }), /invalid camp shortages/);
  }],
  ['phase-validation', async (api) => {
    const base = { ...copy(HH), units: [def('us', 'US', -400, 0, { training: { fire: 2, drill: 1 }, fatigue: 30, ammo: 50, pioneers: true }),
      def('gun', 'US', -500, 0, { type: 'artillery', men: 100, guns: 4, weapon: 'napoleon', limber: 6 }), def('cs', 'CS', 400, 0)], difficulty: 'recruit' };
    delete base.opening;
    const ok = api.prepareFieldScenario(base, 'pack');
    assert.deepEqual([ok.units[0].fatigue, ok.units[1].limber, ok.difficulty], [30, 6, 'recruit'], 'phase-validation: valid camp effects were changed');
    const bad = (patch) => { const s = copy(base); patch(s); return () => api.prepareFieldScenario(s, 'pack'); };
    refuses('phase-validation', bad((s) => { s.units[0].fatigue = 101; }), /fatigue and rounds/);
    refuses('phase-validation', bad((s) => { s.units[0].ammo = -1; }), /fatigue and rounds/);
    refuses('phase-validation', bad((s) => { s.units[0].limber = 6; }), /only a battery limbers slowly/);
    refuses('phase-validation', bad((s) => { s.units[1].limber = 61; }), /only a battery limbers slowly/);
    refuses('phase-validation', bad((s) => { s.units[0].pioneers = 'yes'; }), /pioneers must be true/);
    refuses('phase-validation', bad((s) => { s.units[0].training = {}; }), /unit training/);
    refuses('phase-validation', bad((s) => { s.units[0].training = { speed: 1 }; }), /unit training/);
    refuses('phase-validation', bad((s) => { s.units[0].training = { fire: 1.5 }; }), /unit training/);
    refuses('phase-validation', bad((s) => { s.difficulty = 'easy'; }), /difficulty must be/);
  }],
  ['difficulty-identity', async (api) => {
    // AI orders frozen (every formation manual): identical casualties, morale, rounds and random stream at every level.
    const fight = (level) => {
      const g = api.field([def('us', 'US', 0, -150), def('us2', 'US', 300, -400), def('cs', 'CS', 0, 0, { men: 2500, ai: { role: 'reserve' } }), def('cs2', 'CS', 300, 0, { ai: { role: 'attack' } })], { difficulty: level });
      run(g, 40);
      return { level: difficultyOf(g), units: g.units.map((u) => [u.id, u.men, u.morale, u.ammo, u.state]), next: g.rnd() };
    };
    const [r, v, gl] = DIFFICULTY.levels.map(fight);
    assert.deepEqual([r.level, v.level, gl.level], DIFFICULTY.levels, 'difficulty-identity: the field did not take its scenario\'s level');
    assert.ok(v.units[2][1] < 2500, 'difficulty-identity: the fixture fought nobody');
    assert.deepEqual([r.units, r.next], [v.units, v.next], 'difficulty-identity: Recruit changed a combat number');
    assert.deepEqual([gl.units, gl.next], [v.units, v.next], 'difficulty-identity: General changed a combat number');
  }],
  ['difficulty-ai', async (api) => {
    const first = (level) => { const g = api.field([def('us', 'US', 0, -600), def('cs', 'CS', 0, 600)], { difficulty: level }, { manual: false }); g.tick(0.05); return g.ai.t; };
    assert.deepEqual(DIFFICULTY.levels.map(first).map((t) => Math.round(t * 100) / 100), DIFFICULTY.levels.map((l) => DIFFICULTY[l].interval),
      'difficulty-ai: the AI pass interval does not follow the level');
    const reserve = (level, extra = {}) => {
      const g = api.field([def('us', 'US', 0, -300), def('cs', 'CS', 0, 0, { ai: { role: 'reserve', target: [800, 800] } }), far('cs2', 'CS')],
        { difficulty: level, attacker: 'US', objective: { name: 'Fictional point', x: 0, z: -300, r: 100 }, ...extra }, { manual: false });
      unit(g, 'us').manual = true; unit(g, 'us').holdFire = true; unit(g, 'cs').holdFire = true;
      run(g, 3);
      return { memo: g.ai.memo.get(unit(g, 'cs')) || {}, g };
    };
    const rec = reserve('recruit'), vet = reserve('veteran'), gen = reserve('general');
    assert.ok(!rec.memo.active && vet.memo.active && gen.memo.active, 'difficulty-ai: only Recruit reserves may wait with an enemy 300 m away');
    assert.ok(gen.memo.toObjective === true && !vet.memo.toObjective, 'difficulty-ai: only a General reserve goes to the threatened objective');
    const aim = gen.g.ai.route(unit(gen.g, 'cs')), veteranAim = vet.g.ai.route(unit(vet.g, 'cs'));
    assert.ok(Math.hypot(aim.aim[0], aim.aim[1] + 300) < 60 && Math.hypot(veteranAim.aim[0] - 800, veteranAim.aim[1] - 800) < 60, 'difficulty-ai: the General reserve\'s march does not aim at the objective');
    const late = reserve('recruit', { end: '14:04' }); run(late.g, 30); // half of a 4-minute day at the 4x clock is 30 sim s
    assert.ok(late.g.ai.memo.get(unit(late.g, 'cs'))?.active, 'difficulty-ai: a Recruit reserve did not commit at its set time');
    const counter = (level) => {
      const g = api.field([def('us', 'US', 0, 0), def('cs', 'CS', 300, 200)], { difficulty: level, attacker: 'US', objective: { name: 'Fictional point', x: 0, z: 0, r: 100 } }, { manual: false });
      unit(g, 'us').manual = true; unit(g, 'us').holdFire = true; unit(g, 'cs').holdFire = true;
      run(g, 1);
      return [unit(g, 'cs').order.type, unit(g, 'cs').order.target?.id ?? null];
    };
    assert.deepEqual([counter('veteran'), counter('general')], [['hold', null], ['attack', 'us']], 'difficulty-ai: only General counter-attacks the brigade on the objective');
  }],
  ['auto-pause', async (api) => {
    const pauses = (level, setting) => {
      const before = RULES.autoPause;
      RULES.autoPause = setting;
      try {
        const g = api.field([def('us', 'US', 0, -600), far('us2', 'US'), def('cs', 'CS', 0, 600)], { difficulty: level });
        const alerts = []; g.on('alert', (a) => alerts.push(a.text));
        g.combat.rout(unit(g, 'us')); g.tick(0.05);
        return g.paused && alerts.length === 1;
      } finally { RULES.autoPause = before; }
    };
    assert.deepEqual(DIFFICULTY.levels.map((l) => pauses(l, true)), [true, true, false], 'auto-pause: with Auto-pause on, General must not pause on a rout');
    assert.deepEqual(DIFFICULTY.levels.map((l) => pauses(l, false)), [true, false, false], 'auto-pause: with Auto-pause off, Recruit must still pause');
  }],
  ['colours-overrun', async (api) => {
    const charge = () => {
      const g = api.field([def('us', 'US', 100, -60, { xp: 4 }), def('cs', 'CS', 0, 0, { men: 900, xp: 1, morale: 22, regiments: REGS }), far('csr', 'CS')]);
      const lines = []; g.on('event', (e) => { if (e.kind === 'colours') lines.push(e.text); });
      unit(g, 'cs').holdFire = true; const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 40);
      return { report: g.colourReport('US'), lines, enemy: g.colourReport('CS') };
    };
    const a = charge(), b = charge();
    assert.equal(a.report.length, 1, `colours-overrun: a charge that broke the brigade took ${a.report.length} colours (one: the block it overran)`);
    const r = a.report[0];
    assert.ok(REGS.includes(r.regiment) && r.side === 'CS' && r.by === 'us' && r.how === 'overrun' && a.lines.length === 1 && !a.enemy.length,
      `colours-overrun: ${JSON.stringify(r)}; ${a.lines.length} feed lines`);
    assert.deepEqual(b.report, a.report, 'colours-overrun: the same charge took a different colour');
  }],
  ['colours-destroyed', async (api) => {
    const destroy = (gap) => {
      const g = api.field([def('us', 'US', 0, -gap), def('cs', 'CS', 0, 0, { regiments: REGS.slice(0, 2) }), far('csr', 'CS')]);
      unit(g, 'cs').takeLosses(1500, g.fallen.CS, 0); run(g, 1);
      return g.colourReport('US');
    };
    const near = destroy(100), away = destroy(COLOURS.radius + 100);
    assert.deepEqual(near.map((r) => [r.regiment, r.by, r.how]), [[REGS[0], 'us', 'destroyed'], [REGS[1], 'us', 'destroyed']], 'colours-destroyed: the nearest brigade must take every colour of a destroyed brigade');
    assert.equal(away.length, 0, 'colours-destroyed: a brigade beyond the radius took colours');
  }],
  ['colours-surrender', async (api) => {
    const g = api.field([def('us', 'US', 0, 300), far('usr', 'US'), def('cs', 'CS', 0, 0, { regiments: REGS }), far('csr', 'CS'), def('gun', 'CS', 600, 0, { type: 'artillery', men: 80, guns: 4, weapon: 'napoleon' })],
      { surrender: true });
    g.initializeReinforcements();
    for (const u of g.units) u.holdFire = true;
    g.combat.rout(unit(g, 'cs'), true);
    run(g, 10);
    const rows = g.colourReport('US');
    assert.ok(unit(g, 'cs').state === 'captured' && rows.length === REGS.length && rows.every((r) => r.how === 'surrender' && r.by === 'us'),
      `colours-surrender: a surrendered brigade must give its captor every colour (${unit(g, 'cs').state}, ${JSON.stringify(rows.map((r) => r.regiment))})`);
    const c = new ColourCaptures();
    assert.equal(c.takeAll(unit(g, 'gun'), unit(g, 'us'), 0, 'surrender').length, 0, 'colours-surrender: a battery carried a colour');
  }],
  ['colours-zero-draws', async (api) => {
    // Twin charges with regiment gaps off (same geometry): named regiments (colours) and none. The accounting draws nothing.
    const gaps = settings.get('look.regimentGaps');
    settings.set('look.regimentGaps', false);
    try {
      const charge = (regiments) => {
        const g = api.field([def('us', 'US', 100, -60, { xp: 4 }), def('cs', 'CS', 0, 0, { men: 900, xp: 1, morale: 22, regiments }), far('csr', 'CS')]);
        unit(g, 'cs').holdFire = true; const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 40);
        return { colours: g.colourReport().length, units: g.units.map((x) => [x.id, x.men, x.morale, x.state]), next: g.rnd() };
      };
      const named = charge(REGS), plain = charge([]);
      assert.ok(named.colours === 1 && plain.colours === 0, `colours-zero-draws: the twins took ${named.colours} and ${plain.colours} colours`);
      assert.deepEqual([named.units, named.next], [plain.units, plain.next], 'colours-zero-draws: taking a colour changed the battle or drew from its random stream');
    } finally { settings.set('look.regimentGaps', gaps); }
  }],
  ['colours-saved', async (api) => {
    const s0 = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: AT });
    const p1 = play(api, s0, [colourRow(REGS[0], 'franklin')]);
    assert.deepEqual(p1.record.colours, [{ unitId: 'reb', regiment: REGS[0], side: 'CS', by: 'Fictional franklin' }], 'colours-saved: the phase result did not carry the colour');
    const kept = p1.after.trophies?.colours ?? [];
    assert.deepEqual(kept, [{ regiment: REGS[0], side: 'CS', unitId: 'reb', packId: 'pa', phaseId: 'a1', awardId: p1.phase.awardId, by: 'Fictional franklin' }], 'colours-saved: the colour is not in the trophies');
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(p1.after)), p1.after, 'colours-saved: the trophies did not round-trip');
    assert.deepEqual(api.recordPhase(p1.after, CAMPAIGN, { ...p1.record, at: AT }), p1.after, 'colours-saved: recording the award again changed the save');
    const p2 = play(api, p1.after, [colourRow(REGS[0]), colourRow(REGS[1])]);
    assert.deepEqual(p2.after.trophies.colours.map((r) => [r.phaseId, r.regiment]), [['a1', REGS[0]], ['a2', REGS[0]], ['a2', REGS[1]]], 'colours-saved: a new phase\'s colours were not added');
    const again = play(api, p2.after, [colourRow(REGS[1])], { replay: true });
    assert.equal(again.after.trophies.colours.length, 3, 'colours-saved: a replay recorded the same colour twice');
    refuses('colours-saved', () => api.validateSnapshot({ ...p1.after, trophies: { colours: [{ ...kept[0], awardId: 'test-hooks.1.pa.zz.1' }] } }), /must belong to a recorded phase/);
    refuses('colours-saved', () => api.validateSnapshot({ ...p1.after, trophies: { colours: [kept[0], kept[0]] } }), /recorded twice/);
  }],
  ['old-saves', async (api) => {
    const fresh = api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 3, at: AT });
    const old = JSON.parse(api.exportSnapshot(fresh));
    assert.ok(!save.HOOK_FIELDS.some((k) => has(old, k)) && api.campaignDifficulty(api.parseSnapshot(JSON.stringify(old))) === 'veteran', 'old-saves: a save without a difficulty is not Veteran');
    assert.equal(api.applyCampaign(SCENARIO, fresh, api.campaignPhase(fresh, CAMPAIGN)).difficulty, 'veteran', 'old-saves: an old save\'s phase is not Veteran');
    const general = api.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 3, at: AT, difficulty: 'general' });
    assert.equal(general.difficulty, 'general', 'old-saves: New campaign did not keep its difficulty');
    assert.deepEqual(api.parseSnapshot(api.exportSnapshot(general)), general, 'old-saves: the difficulty did not round-trip');
    assert.ok(!has(api.validateSnapshot({ ...fresh, difficulty: 'veteran' }), 'difficulty'), 'old-saves: Veteran was stored');
    const marched = api.breakCamp(fresh, { campaign: CAMPAIGN, fielded: [] });
    const legacy = { ...marched, ready: { awardId: marched.ready.awardId, morale: marched.ready.morale } };
    assert.deepEqual(api.validateSnapshot(legacy).ready, legacy.ready, 'old-saves: a march without shortages did not load');
    refuses('old-saves', () => api.validateSnapshot({ ...fresh, difficulty: 'easy' }), /unknown difficulty/);
    refuses('old-saves', () => api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 3, difficulty: 'easy' }), /Recruit, Veteran or General/);
  }],
  ['after-action-lines', async (api) => {
    const all = def('us', 'US', 0, 0, { training: { fire: 2, drill: 1 }, fatigue: 30, ammo: 50, pioneers: true });
    const lines = campEffectLines(all), gun = campEffectLines({ ...def('gun', 'US', 0, 0, { type: 'artillery' }), limber: 6 });
    assert.deepEqual(lines.map((l) => l.split(':')[0]), ['Camp training', 'Short of shoes', 'Short of ammunition', 'Pioneers'], 'after-action-lines: the card lines for a camped brigade');
    assert.ok(/\+2% fire effect/.test(lines[0]) && /\+1% faster reload/.test(lines[0]) && /6 s more slowly/.test(gun[0]) && !campEffectLines(def('x', 'US', 0, 0)).length,
      `after-action-lines: ${JSON.stringify([lines[0], gun[0]])}`);
    const scenario = { ...SCENARIO, units: [all, def('reb', 'CS', 400, 0, { regiments: REGS })] };
    const c = api.historyComparison({ game: fakeGame(scenario, [colourRow(REGS[2], 'us')]), scenario });
    assert.deepEqual([c.colours?.map((r) => [r.regiment, r.by]), c.camp?.map((x) => [x.effect, x.formations])],
      [[[REGS[2], 'Fictional us']], [['Camp training', ['us']], ['Short of shoes', ['us']], ['Short of ammunition', ['us']], ['Pioneers', ['us']]]], 'after-action-lines: the after-action rows');
    const none = api.historyComparison({ game: fakeGame(SCENARIO), scenario: SCENARIO });
    assert.ok(!has(none, 'colours') && !has(none, 'camp'), 'after-action-lines: rows appeared with nothing to show');
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const strip = { field: (defs, extra, o) => makeField(stripped(defs), extra, o) };
const veteranOnly = { field: (defs, extra, o) => makeField(defs, { ...extra, difficulty: 'veteran' }, o) };
const patch = (proto, key, fn) => () => { const old = proto[key]; proto[key] = fn(old); return () => { proto[key] = old; }; };
const MUTANTS = {
  'fire-training': strip, 'drill-training': strip, 'melee-training': strip, 'morale-training': strip, 'shoes-fatigue': strip, 'ammo-short': strip,
  'horses-limber': strip, 'pioneers-woods': strip,
  'inert-oracle': { henryHill: (t = (s) => s) => henryHillRun({ transform: (s) => { const x = t(s); return { ...x, units: x.units.map((u) => ({ ...u, fatigue: 1 })) }; } }) },
  'apply-campaign': { applyCampaign: (sc, s, p) => { const out = campaign.applyCampaign(sc, s, p); out.units = stripped(out.units); return out; } },
  'break-camp-short': { breakCamp: (s, o) => { const m = orders.breakCamp(s, o); const ready = { ...m.ready }; delete ready.short; return save.validateSnapshot({ ...m, ready }); } },
  'phase-validation': { prepareFieldScenario: (s, r) => { const v = copy(s); delete v.difficulty; v.units = stripped(v.units); return { ...prepareFieldScenario(v, r), units: s.units, difficulty: s.difficulty }; } },
  'difficulty-identity': { field: (defs, extra, o) => makeField(extra.difficulty === 'general' ? defs.map((d) => (d.side === 'CS' ? { ...d, training: { fire: 6 } } : d)) : defs, extra, o) },
  'difficulty-ai': veteranOnly,
  'auto-pause': veteranOnly,
  'colours-overrun': { proto: patch(ColourCaptures.prototype, 'takeNear', () => function (u, by, t, how) { return this.takeAll(u, by, t, how); }) },
  'colours-destroyed': { proto: patch(ColourCaptures.prototype, 'takeAll', (old) => function (u, by, t, how) { return how === 'destroyed' ? [] : old.call(this, u, by, t, how); }) },
  'colours-surrender': { proto: patch(ColourCaptures.prototype, 'takeAll', (old) => function (u, by, t, how) {
    if (how !== 'surrender') return old.call(this, u, by, t, how);
    const first = this.take(u, 0, by, t, how); return first ? [first] : []; // a surrender gives up only its first colour
  }) },
  'colours-zero-draws': { proto: patch(ColourCaptures.prototype, 'takeNear', (old) => function (u, by, t, how) { by.morale = Math.min(by.moraleMax, by.morale + 10); return old.call(this, u, by, t, how); }) },
  'colours-saved': { recordPhase: (s, c, r) => { const { colours, ...rest } = r; return campaign.recordPhase(s, c, rest); } },
  'old-saves': { newCampaign: (o) => { const { difficulty, ...rest } = o; return campaign.newCampaign(rest); } },
  'after-action-lines': { historyComparison: (o) => { const c = historyComparison(o); delete c.camp; delete c.colours; return c; } },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.stack ?? e}` });
  }
}
export async function hooksUnit(api = API) {
  for (const [name, check] of HOOK_CHECKS) await runCheck(name, check, api);
  return HOOK_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of HOOK_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
  }
  const n = HOOK_CHECKS.length;
  if (failed) { console.log(`HOOKS FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`HOOKS OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of HOOK_CHECKS) {
      const m = MUTANTS[name], restore = m.proto ? m.proto() : null, api = { ...API, ...m };
      delete api.proto;
      let error = null;
      try { await runCheck(name, check, api); } catch (e) { error = e; } finally { restore?.(); }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`HOOKS CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`HOOKS CONTROLS OK (${caught}/${n})`);
  }
}

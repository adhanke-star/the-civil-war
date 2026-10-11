// CPU check: commanders and visible regiments (DESIGN.md §2 "Commanders", §4b "Regiments"; src/game.js "Command",
// src/units/unit.js regiment blocks, src/sim/combat.js setCommand, src/sim/phase.js commanders validation).
// Fictional fixtures on the Henry Hill ground (flat): every general and every fallen commander here is labelled
// "test only"; no real person's fate is scripted. `node tools/test-command.mjs` prints COMMAND OK (n/n);
// `--prove-fail` also runs one semantic mutant per check and requires each to fail its own assertion with that
// check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game, COMMAND } from '../src/game.js';
import { Unit, REGIMENT_GAP } from '../src/units/unit.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { henryHillRun } from './test-packs.mjs';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
// The Henry Hill oracle is owned by tools/test-packs.mjs; read it, never restate it.
const ORACLE = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); settings.set('look.regimentGaps', true);
LOOK.figureStyle = 'rigged';
const FS = 2.35, RS = 2.9; // unit.js FILE_SPACING and COLUMN_RANK_SPACING
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const GENERAL = { id: 'test-general', side: 'US', name: 'Fictional general (test only)', rank: 'Brigadier General', units: ['franklin', 'willcox'],
  x: -1500, z: 1500, sources: ['Test fixture, no source'], status: 'Fictional (test only)' };
const FICTIONAL_COLONEL = { name: 'Fictional colonel (test only)', rank: 'Colonel' };

/** A fictional pack phase on Henry Hill ground: the listed roster ids with overrides, plus scenario extras. */
function scenario(roster, extra = {}) {
  const s = copy(HH);
  s.id = 'test-command'; s.title = 'Fictional command test (test only)';
  s.units = Object.entries(roster).map(([id, over]) => ({ ...copy(HH.units.find(u => u.id === id)), ...over }));
  return Object.assign(s, extra);
}
function build(api, roster, extra) {
  const p = api.prepare(scenario(roster, extra), 'pack');
  setPlan(p);
  const g = new Game({ scene: new Scene(), terrain, scenario: p, world: { fenceField: null }, effects });
  g.initializeReinforcements();
  api.configure(g);
  return g;
}
const unit = (g, id) => g.units.find(u => u.id === id);
const run = (api, g, seconds) => { for (let k = Math.round(seconds / 0.05); k > 0; k--) api.tick(g); };
const place = (u, x, z, facing) => { u.vehicle.position.set(x, 0, z); if (facing !== undefined) { u.facing = facing; u.goalFacing = facing; } u.snapFigures(); };
const plainUnit = (def, seed = 72) => new Unit(def, {}, { half: 3000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true }, seed);
const BRIGADE = { id: 'a', side: 'US', type: 'infantry', name: 'Test brigade (test only)', men: 1000, x: 0, z: 0, facing: 0, weapon: 'rifled', xp: 1 };
/** One tick's per-tick hit chance at the default clock (combat.js CLOCK_RATIO 4), as game.js commandStep computes it. */
const tickChance = (risk) => 1 - Math.pow(1 - risk / 100, (0.05 * 4) / 3600);
const layout = (u) => u.figures.map(f => [f.lx, f.lz, f.rank, f.skirmisher]);

export const COMMAND_CHECKS = [
  ['commander-follows', async api => {
    const g = build(api, { franklin: { x: -300, z: 300, facing: Math.PI / 2 }, willcox: { x: -300, z: 0, facing: Math.PI / 2 }, jackson: { x: 1500, z: -1500 } },
      { commanders: [{ ...GENERAL, x: -700, z: 150 }] });
    const c = g.commanders[0];
    for (const id of ['franklin', 'willcox']) { const u = unit(g, id); g.order(u, { type: 'move', points: [[u.x, u.z], [u.x + 400, u.z]], endFacing: Math.PI / 2 }); }
    let worst = Infinity;
    for (let t = 0; t < 240; t++) { // 12 s of march, then the rest
      run(api, g, 0.05);
      if (t > 160) { const us = ['franklin', 'willcox'].map(id => unit(g, id)); worst = Math.min(worst, ...us.map(u => (u.x - c.x) * Math.sin(u.facing) + (u.z - c.z) * Math.cos(u.facing))); }
    }
    run(api, g, 150);
    const us = ['franklin', 'willcox'].map(id => unit(g, id));
    const cx = (us[0].x + us[1].x) / 2, cz = (us[0].z + us[1].z) / 2, f = us[0].facing;
    const behind = (cx - c.x) * Math.sin(f) + (cz - c.z) * Math.cos(f), across = Math.abs((c.x - cx) * Math.cos(f) - (c.z - cz) * Math.sin(f));
    const clear = Math.min(...us.map(u => (u.x - c.x) * Math.sin(u.facing) + (u.z - c.z) * Math.cos(u.facing)));
    assert.ok(behind >= COMMAND.minBehind && behind <= COMMAND.maxBehind && across < 30 && clear >= COMMAND.clearRear,
      `commander-follows: rides 120-200 m behind his brigades' centre, clear of their line (${behind.toFixed(1)} m behind, ${across.toFixed(1)} m across, ${clear.toFixed(1)} m behind the nearest)`);
    assert.ok(worst > 40, `commander-follows: never rides into the line while it marches (closest ${worst.toFixed(1)} m behind a brigade)`);
  }],
  ['rally-radius-only', async api => {
    // Brigades without their own commander, one inside the general's radius and one outside; Franklin keeps his own.
    const g = build(api, { willcox: { commander: null, x: -300, z: 0 }, sherman: { commander: null, x: -300, z: 900 }, franklin: { commander: FICTIONAL_COLONEL, x: 600, z: 900 },
      jackson: { x: 1500, z: -1500 } }, { commanders: [{ ...GENERAL, units: ['willcox'], x: -300, z: -200 }] });
    const c = g.commanders[0];
    const w = unit(g, 'willcox'), s = unit(g, 'sherman'), f = unit(g, 'franklin');
    c.x = -300; c.z = -200; // in place (no tick: the factor reads positions as they stand)
    const loss = (u) => { u.morale = 70; u.casTick = 0.1 * u.menMax; u.underFire = 0.01; u.flanked = 0; g.combat.moraleStep(u, 0.05); return 70 - u.morale; };
    const [lw, ls, lf] = [w, s, f].map(loss);
    assert.ok(near(lw / ls, COMMAND.loss) && near(lf / ls, COMMAND.loss) && lw > 0,
      `rally-radius-only: inside the radius or under his own commander morale falls 20% slower (${lw}, ${lf} against ${ls})`);
    const rally = (u) => { u.state = 'routing'; u.rallyT = 0; for (let k = 0; k < 20; k++) g.combat.moraleStep(u, 0.05); return u.rallyT; };
    const [rw, rs] = [w, s].map(rally);
    assert.ok(near(rw / rs, COMMAND.rally, 1e-9) && rs > 0, `rally-radius-only: inside the radius a broken brigade rallies 50% faster (${rw} against ${rs})`);
    assert.deepEqual([g.rallied(w), g.rallied(s), g.rallied(f)], [true, false, true], 'rally-radius-only: rallied inside the radius or by its own commander only');
    g.commanderDown(c, 'wounded'); g.commanderDown(f, 'killed');
    assert.deepEqual([g.rallied(w), g.rallied(f), near(loss(w), ls), near(loss(f), ls)], [false, false, true, true], 'rally-radius-only: a fallen commander\'s bonus ends');
  }],
  ['hit-wounded-killed', async api => {
    // The general commands Willcox; Franklin stands where the general rides, Jackson fires on Franklin.
    const make = (draw) => {
      const g = build(api, { willcox: { commander: null, x: -300, z: 0, facing: Math.PI / 2 }, franklin: { commander: FICTIONAL_COLONEL, x: -460, z: 0, facing: Math.PI / 2 },
        jackson: { x: 1500, z: -1500 } }, { commanders: [{ ...GENERAL, units: ['willcox'], x: -460, z: 0 }] });
      const st = g.commandState(); st.rnd = draw;
      const events = [], toasts = [];
      g.on('event', e => events.push(e)); g.on('log', t => toasts.push(t));
      return { g, st, events, toasts, c: g.commanders[0], w: unit(g, 'willcox'), f: unit(g, 'franklin'), j: unit(g, 'jackson') };
    };
    const fire = (x) => { x.g.combat.volleyAt(x.j, x.f, x.g.simTime); api.tick(x.g); };
    const p = tickChance(RULES.commanderRisk);
    const calm = make(() => 0.999), killed = make(() => 0), wounded = make(() => p * 0.75);
    for (const x of [calm, killed, wounded]) fire(x);
    assert.ok(!calm.c.down && !calm.f.commandDown, 'hit-wounded-killed: a draw above the chance hits no one');
    assert.ok(killed.c.down === 'killed' && killed.f.commandDown?.kind === 'killed', `hit-wounded-killed: a draw under half the chance kills (${killed.c.down}, ${killed.f.commandDown?.kind})`);
    assert.ok(wounded.c.down === 'wounded' && wounded.f.commandDown?.kind === 'wounded', `hit-wounded-killed: a draw between half and the whole chance wounds (${wounded.c.down})`);
    const texts = killed.events.filter(e => e.kind === 'commander').map(e => e.text);
    assert.deepEqual(texts, ['Brigadier General Fictional general (test only) is killed.', 'Colonel Fictional colonel (test only) is killed.'], 'hit-wounded-killed: feed lines name rank and name');
    assert.deepEqual(killed.toasts, texts, 'hit-wounded-killed: each is also a toast');
    assert.ok(near(calm.w.morale - killed.w.morale, COMMAND.shock, 1e-9) && near(calm.f.morale - killed.f.morale, COMMAND.shock, 1e-9),
      `hit-wounded-killed: his brigades take a one-time -10 shock (${calm.w.morale - killed.w.morale}, ${calm.f.morale - killed.f.morale})`);
    const z0 = wounded.c.z;
    run(api, wounded.g, COMMAND.leaveS + 1);
    assert.ok(wounded.c.gone && wounded.c.z < z0 - 100, `hit-wounded-killed: the wounded general rides to the rear and leaves (${wounded.c.gone}, ${(z0 - wounded.c.z).toFixed(0)} m)`);
    const x = killed.c.x;
    run(api, killed.g, 5);
    assert.ok(!killed.c.gone && killed.c.x === x && killed.f.commandDown.kind === 'killed', 'hit-wounded-killed: the killed general stays where he fell; Commander down lasts');
  }],
  ['zero-draws-no-danger', async api => {
    // A real fight between Sherman and Hampton, the general 1,400 m from it (no danger, no radius over anyone).
    const roster = { sherman: { commander: null, x: 40, z: -90 }, hampton: { commander: null, x: 330, z: 40 }, willcox: { commander: null, x: -1600, z: 1600 } };
    const fight = (extra) => {
      const g = build(api, roster, extra);
      let draws = 0; const r = g.combat.rnd; g.combat.rnd = () => { draws++; return r(); };
      const st = g.commandState(); let commandDraws = 0; const cr = st.rnd; st.rnd = () => { commandDraws++; return cr(); };
      run(api, g, 16);
      return { g, draws, commandDraws, st, units: g.units.map(u => [u.id, u.men, u.morale, u.state]) };
    };
    const without = fight({}), withGeneral = fight({ commanders: [{ ...GENERAL, units: ['willcox'], x: -1500, z: 1500 }] });
    assert.ok(without.draws > 0 && without.units.some(([, men]) => men < 3000), 'zero-draws-no-danger: the fixture fights');
    assert.equal(withGeneral.commandDraws + withGeneral.st.draws, 0, 'zero-draws-no-danger: no command draw with no one in danger');
    assert.deepEqual([withGeneral.draws, withGeneral.units], [without.draws, without.units], 'zero-draws-no-danger: the game stream and every brigade are unchanged');
    assert.deepEqual(api.henry(), ORACLE, 'zero-draws-no-danger: the Henry Hill oracle (tools/test-packs.mjs) is unchanged');
  }],
  ['regiment-blocks', async api => {
    const regiments = ['First (test only)', 'Second (test only)', 'Third (test only)', 'Fourth (test only)'];
    const u = api.unit({ ...BRIGADE, regiments, regimentMen: [400, 300, 200, 100] });
    const counts = regiments.map((_, r) => u.figures.filter(f => f.reg === r).length);
    assert.deepEqual(counts, [40, 30, 20, 10], 'regiment-blocks: figures split by men in proportion');
    const equal = api.unit({ ...BRIGADE, regiments: regiments.slice(0, 3) });
    assert.deepEqual([0, 1, 2].map(r => equal.figures.filter(f => f.reg === r).length), [34, 33, 33], 'regiment-blocks: equal split without regiment men');
    // the front rank, left to right: regiments in order, files FS apart inside a block, FS + REGIMENT_GAP between blocks
    const front = u.figures.filter(f => f.alive && f.rank === 0).sort((a, b) => a.lx - b.lx);
    const steps = [], order = [];
    for (let k = 1; k < front.length; k++) steps.push([front[k - 1].reg !== front[k].reg, +(front[k].lx - front[k - 1].lx).toFixed(9)]);
    for (const f of front) if (order[order.length - 1] !== f.reg) order.push(f.reg);
    assert.deepEqual(order, [0, 1, 2, 3], 'regiment-blocks: four contiguous blocks in regiment order');
    assert.ok(steps.every(([edge, d]) => near(d, edge ? FS + REGIMENT_GAP : FS, 1e-9)) && steps.filter(([edge]) => edge).length === 3,
      `regiment-blocks: ${FS} m files, ${REGIMENT_GAP} m gaps (${JSON.stringify(steps.filter(([e]) => e))})`);
    assert.ok(u.bearers.length === 4 && u.bearers.every((pair, r) => pair && pair.every(f => f && f.reg === r && f.rank === 0)), 'regiment-blocks: a colour party in each block\'s front rank');
    const b = u.bearers[2][0]; u.snapFigures();
    assert.equal(u.regimentAt(b.x + 0.5, b.z), 2, 'regiment-blocks: hovering a block names its regiment');
    u.setFormation('column');
    const ranks = [...new Set(u.figures.filter(f => f.alive).map(f => f.crank))].sort((a, c) => a - c);
    const regOf = (k) => u.figures.find(f => f.alive && f.crank === k).reg;
    const gapsAlong = [];
    for (let k = 1; k < ranks.length; k++) gapsAlong.push([regOf(k) !== regOf(k - 1), +Math.hypot(u.columnSlots[k][0] - u.columnSlots[k - 1][0], u.columnSlots[k][1] - u.columnSlots[k - 1][1]).toFixed(9)]);
    assert.ok(gapsAlong.every(([edge, d]) => near(d, edge ? RS + REGIMENT_GAP : RS, 1e-6)) && gapsAlong.filter(([e]) => e).length === 3
      && u.figures.filter(f => f.alive).every(f => u.figures.filter(v => v.alive && v.crank === f.crank).every(v => v.reg === f.reg)),
    'regiment-blocks: a column marches its blocks in sequence, one regiment per rank, the gap between blocks');
    // in a game: two colours per block, one draw call
    const g = build(api, { sherman: {}, jackson: { x: 1500, z: -1500 } }, {});
    g.animate(0.05);
    const flags = g.commandState().flags;
    assert.deepEqual([flags.used, flags.mesh.count, flags.capacity >= 2 * 9], [2 * (4 + 5), 2 * (4 + 5), true], 'regiment-blocks: two colours per regiment block in one instanced mesh');
  }],
  ['gaps-off-exact', async api => {
    const regiments = ['First (test only)', 'Second (test only)', 'Third (test only)'];
    const exact = (gaps) => {
      api.gaps(gaps);
      const a = plainUnit({ ...BRIGADE, regiments }), b = plainUnit(BRIGADE);
      const row = (u) => [layout(u), u.halfFront, u.depth, u.files, u.lineHalfFront()];
      const line = [row(a), row(b)];
      a.setFormation('column'); b.setFormation('column');
      const col = [[a.figures.map(f => [f.crank, f.cfile]), a.columnSlots, a.depth, a.lineHalfFront()], [b.figures.map(f => [f.crank, f.cfile]), b.columnSlots, b.depth, b.lineHalfFront()]];
      api.gaps(true);
      return { line, col };
    };
    const off = exact(false);
    assert.deepEqual(off.line[0], off.line[1], 'gaps-off-exact: with look.regimentGaps off a regiment line is the old line exactly');
    assert.deepEqual(off.col[0], off.col[1], 'gaps-off-exact: with look.regimentGaps off a regiment column is the old column exactly');
    // Henry Hill, recorded: [half front with gaps, without]; the change is the gaps plus each block's own last half-file
    const HH_LAYOUT = { franklin: [113.275, 108.1], willcox: [113.275, 108.1], sherman: [174.025, 166.85], jackson: [152.525, 143.35], bee: [109.4, 103.4], hampton: [31.725, 31.725] };
    const halves = (gaps) => {
      api.gaps(gaps);
      const s = copy(HH); setPlan(s);
      const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
      const out = Object.fromEntries(Object.keys(HH_LAYOUT).map(id => { const u = unit(g, id); return [id, { half: +u.halfFront.toFixed(6), u }]; }));
      api.gaps(true);
      return out;
    };
    const on = halves(true), offHH = halves(false);
    for (const [id, [want, old]] of Object.entries(HH_LAYOUT)) {
      const u = on[id].u, ranks = 2, body = u.figures.filter(f => f.alive && !f.skirmisher);
      const blocks = u.regCount > 1 ? u.regiments.map((_, r) => Math.ceil(body.filter(f => f.reg === r).length / ranks)) : [Math.ceil(body.length / ranks)];
      const extra = blocks.reduce((a, b) => a + b, 0) - Math.ceil(body.length / ranks);
      assert.ok(near(on[id].half, want, 1e-6) && near(offHH[id].half, old, 1e-6)
        && near(want - old, ((blocks.length - 1) * REGIMENT_GAP + extra * FS) / 2, 1e-6),
      `gaps-off-exact: Henry Hill ${id} half front ${on[id].half} (gaps on) / ${offHH[id].half} (off) = ${blocks.length - 1} gaps + ${extra} block half-files`);
    }
  }],
  ['validation', async api => {
    const ok = api.prepare(scenario({ franklin: {}, willcox: {}, jackson: {} }, { commanders: [GENERAL, { id: 'test-cs', side: 'CS', name: 'Fictional (test only)', rank: 'Major General',
      units: ['jackson'], x: 0, z: 0, sources: ['Test fixture'], status: 'Fictional', fate: 'After-action text only (test).', successor: { name: 'Fictional (test only)', sources: ['Test fixture'] } }] }), 'pack');
    assert.ok(Object.isFrozen(ok.commanders) && ok.commanders?.length === 2 && ok.commanders?.[1]?.fate === 'After-action text only (test).', 'validation: valid commanders are kept, frozen');
    const bad = [
      { commanders: {} }, { commanders: Array.from({ length: 25 }, (_, k) => ({ ...GENERAL, id: 'g' + k })) }, { commanders: [{ ...GENERAL, extra: 1 }] },
      { commanders: [GENERAL, GENERAL] }, { commanders: [{ ...GENERAL, id: 'franklin' }] }, { commanders: [{ ...GENERAL, side: 'XX' }] },
      { commanders: [{ ...GENERAL, name: '' }] }, { commanders: [{ ...GENERAL, rank: 3 }] }, { commanders: [{ ...GENERAL, status: '' }] },
      { commanders: [{ ...GENERAL, units: [] }] }, { commanders: [{ ...GENERAL, units: ['jackson'] }] }, { commanders: [{ ...GENERAL, units: ['nobody'] }] },
      { commanders: [{ ...GENERAL, units: ['franklin', 'franklin'] }] }, { commanders: [{ ...GENERAL, sources: [] }] }, { commanders: [{ ...GENERAL, sources: undefined }] },
      { commanders: [{ ...GENERAL, x: Infinity }] }, { commanders: [{ ...GENERAL, z: 1e6 }] }, { commanders: [{ ...GENERAL, fate: 5 }] },
      { commanders: [{ ...GENERAL, successor: { name: 'Fictional (test only)' } }] },
    ];
    for (const extra of bad) {
      let error = null;
      try { api.prepare(scenario({ franklin: {}, willcox: {}, jackson: {} }, JSON.parse(JSON.stringify(extra))), 'pack'); } catch (e) { error = e; }
      assert.ok(error && /^Phase: /.test(error.message), `validation: refuses ${JSON.stringify(extra).slice(0, 90)} (${error?.message ?? 'accepted'})`);
    }
    for (const over of [{ regiments: ['A (test)', 'B (test)'], regimentMen: [1] }, { regiments: ['A (test)', 'B (test)'], regimentMen: [1, 0] },
      { commander: { name: 'Fictional (test only)', successor: { name: 'Fictional (test only)', sources: [] } } }]) {
      let error = null;
      try { api.prepare(scenario({ franklin: over, jackson: {} }), 'pack'); } catch (e) { error = e; }
      assert.ok(error && /^Phase: /.test(error.message), `validation: refuses unit ${JSON.stringify(over).slice(0, 90)} (${error?.message ?? 'accepted'})`);
    }
  }],
];

const API = {
  prepare: prepareFieldScenario,
  configure: () => {},
  tick: (g) => g.tick(0.05),
  unit: (def) => plainUnit(def),
  gaps: (on) => settings.set('look.regimentGaps', on),
  henry: () => henryHillRun(),
};

// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  // the general rides onto his brigades' centre (into the line)
  'commander-follows': { tick: (g) => { g.tick(0.05); const c = g.commanders[0]; const us = g.units.filter(u => c.units.includes(u.id)); c.x = us.reduce((s, u) => s + u.x, 0) / us.length; c.z = us.reduce((s, u) => s + u.z, 0) / us.length; } },
  // everyone is rallied, wherever he stands
  'rally-radius-only': { configure: (g) => g.combat.setCommand(() => ({ loss: COMMAND.loss, rally: COMMAND.rally })) },
  // commanders are never hit
  'hit-wounded-killed': { configure: (g) => { const st = g.commandState(); Object.defineProperty(st, 'rnd', { get: () => () => 0.999, set() {} }); } },
  // a point under fire is always reported beside the general (he draws every tick)
  'zero-draws-no-danger': { configure: (g) => { const take = g.combat.takeHits.bind(g.combat); g.combat.takeHits = () => { const c = g.commanders[0]; return c ? [...take(), c.x, c.z] : take(); }; } },
  // regiment blocks without their gaps
  'regiment-blocks': { unit: (def) => { settings.set('look.regimentGaps', false); try { return plainUnit(def); } finally { settings.set('look.regimentGaps', true); } } },
  // the setting is ignored: gaps stay on
  'gaps-off-exact': { gaps: () => settings.set('look.regimentGaps', true) },
  // the commanders field is dropped before validation
  'validation': { prepare: (s, route) => { const t = JSON.parse(JSON.stringify(s)); delete t.commanders; for (const u of t.units) { delete u.regimentMen; if (u.commander) delete u.commander.successor; } return prepareFieldScenario(t, route); } },
};

export async function commandUnit(api = API) {
  for (const [, check] of COMMAND_CHECKS) await check(api);
  return COMMAND_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const list = only ? COMMAND_CHECKS.filter(([n]) => n === only) : COMMAND_CHECKS;
  for (const [name, check] of list) { await check(API); if (only) console.log(`ok ${name}`); }
  const count = list.length;
  console.log(`COMMAND OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of list) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      settings.set('look.regimentGaps', true);
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`COMMAND CONTROLS OK (${rows.length}/${count})`);
  }
}

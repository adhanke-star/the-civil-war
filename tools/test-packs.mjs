// CPU check: battle-pack loader (src/sim/phase.js loadBattlePack) and generic pack victory (src/game.js packResult).
// Fixture packs are built here from assets/scenarios/henry-hill.json; no pack file ships for this test.
// `node tools/test-packs.mjs` prints PACKS OK (n/n); `--prove-fail` also runs one mutant per check and requires
// each to fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { loadBattlePack, preparePhase, prepareReinforcementTimeline, PHASE_LIMITS } from '../src/sim/phase.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

// Henry Hill, real roster, end moved to 14:01 (15 simulation seconds), run 16 s on flat ground. Values observed
// on the pre-pack parent 1e34040 with this same run; never recomputed from the candidate. 2026-10-11 friendly-fire masking
// (rules.friendlyMask): re-observed with masking on; the 1e34040 values (sherman 2989.5206983638323, bee 1900, hampton
// 596.5554956267405) reproduced exactly with rules.friendlyMask=false before this update.
const HENRY_ORACLE = {"over":true,"winner":"CS","why":"The Confederates still hold Henry House Hill. (In 1861 they held it, and the Union army fell back to Washington.)","resultKeys":["why","winner"],"clock":{"date":"21st July 1861","time":"14:01","frac":1},"simTime":16.000000000000092,"holder":"CS","men":[["franklin",2000,"steady"],["willcox",2000,"steady"],["sherman",2989.490286766961,"steady"],["ricketts",120,"steady"],["griffin",120,"steady"],["jackson",2600,"steady"],["bee",1897.648148912486,"steady"],["hampton",600,"steady"],["rockbridge",100,"steady"],["staunton",96.89210993752894,"steady"]],"next":0.008045169059187174};

const API = { loadBattlePack, preparePhase, prepareReinforcementTimeline, transform: s => s };

/** One fictional phase on the Henry Hill ground: only the listed roster ids, at the given positions. */
function phase(id, extra = {}, roster = null) {
  const s = copy(HH);
  s.id = 'test-' + id; s.title = 'Fictional pack phase ' + id + ' (test only)';
  if (roster) s.units = Object.entries(roster).map(([uid, [x, z]]) => ({ ...s.units.find(u => u.id === uid), x, z }));
  return Object.assign(s, extra);
}
function pack(api, ids = ['first', 'second', 'third'], extra = {}, roster = null) {
  return { version: 1, id: 'test-pack', title: 'Fictional test pack',
    phases: ids.map(id => ({ id, scenario: api.transform(phase(id, extra, roster)) })) };
}
const serve = body => {
  const calls = [];
  return { calls, fetcher: async (url) => { calls.push(url); return new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)); } };
};
async function refuses(name, run, pattern) {
  let error = null;
  try { await run(); } catch (e) { error = e; }
  if (!error) assert.fail(`${name}: accepted what it must refuse`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}

function game(api, extra, roster) {
  const s = pack(api, ['only'], { end: '14:01', ...extra }, roster).phases[0].scenario;
  setPlan(s);
  return new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
}
const unit = (g, id) => g.units.find(u => u.id === id);
const runUntilOver = (g, limit = 40) => { let n = 0; while (!g.over && n++ < limit / 0.05) g.tick(0.05); return g.simTime; };
const outcome = g => ({ over: g.over, winner: g.result?.winner, draw: g.result?.draw ?? false, why: g.result?.why, grade: g.result?.grade });
const OBJ = [HH.objective.x, HH.objective.z], FAR = [-1500, -1500];

export function henryHillRun(api = API) {
  const s = api.transform(copy(HH)); s.end = '14:01';
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
  g.fastForward(16);
  return { over: g.over, winner: g.result?.winner ?? null, why: g.result?.why ?? null, resultKeys: Object.keys(g.result || {}).sort(),
    clock: g.clockText(), simTime: g.simTime, holder: g.holder, men: g.units.map(u => [u.id, u.men, u.state]), next: g.rnd() };
}

export const PACK_CHECKS = [
  ['load-happy', async api => {
    const p = pack(api), s = serve(p);
    const a = await api.loadBattlePack({ packId: 'test-pack', fetcher: s.fetcher });
    assert.deepEqual(s.calls, ['./assets/packs/test-pack.json'], 'load-happy: fetch url');
    assert.deepEqual([a.packId, a.phaseId, a.index, a.previousId, a.nextId], ['test-pack', 'first', 0, null, 'second'], 'load-happy: default phase');
    assert.deepEqual(a.scenario, p.phases[0].scenario, 'load-happy: scenario content');
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.scenario), 'load-happy: frozen result');
    const b = await api.loadBattlePack({ packId: 'test-pack', phaseId: 'third', fetcher: serve(p).fetcher });
    assert.deepEqual([b.phaseId, b.index, b.previousId, b.nextId, b.scenario.id], ['third', 2, 'second', null, 'test-third'], 'load-happy: named phase');
    const fields = pack(api, ['only'], { terrain: 'henry-hill', camera: { target: [0, 0], yaw: 0.5, dist: 900 }, subtitle: 'Fictional', statusText: 'Ready.',
      seed: 42, clockRatio: 12, attacker: 'CS', victory: { draw: 'Even.' }, retreat: { US: [0, -1900] }, season: 'spring' });
    const c = await api.loadBattlePack({ packId: 'test-pack', fetcher: serve(fields).fetcher });
    assert.deepEqual([c.scenario.attacker, c.scenario.clockRatio, c.scenario.camera.dist], ['CS', 12, 900], 'load-happy: optional fields kept');
  }],
  ['load-refusals', async api => {
    let fetched = 0; const fetcher = async () => { fetched++; return new Response(JSON.stringify(pack(api))); };
    for (const packId of ['Bad', '../x', 'a'.repeat(41), '', 'x/y', undefined]) {
      await refuses('load-refusals', () => api.loadBattlePack({ packId, fetcher }), /^Phase: battle pack id is invalid/);
    }
    assert.equal(fetched, 0, 'load-refusals: a bad id must not fetch');
    await refuses('load-refusals', () => api.loadBattlePack({ packId: 'test-pack', phaseId: 'missing', fetcher }), /^Phase: requested phase is absent/);
    await refuses('load-refusals', () => api.loadBattlePack({ packId: 'other-pack', fetcher }), /^Phase: battle pack identity/);
    const big = new Uint8Array(PHASE_LIMITS.bytes + 1).fill(32);
    await refuses('load-refusals', () => api.loadBattlePack({ packId: 'test-pack', fetcher: serve(big).fetcher }), /^Field: the ground description exceeds its download bound/);
    await refuses('load-refusals', () => api.loadBattlePack({ packId: 'test-pack', fetcher: serve(pack(api, ['only'], { practiceIntro: true })).fetcher }), /^Field: the definition does not match/);
    await refuses('load-refusals', () => api.loadBattlePack({ packId: 'test-pack', isCurrent: () => false, fetcher }), /^Field: the field launch was cancelled/);
  }],
  ['field-refusals', async api => {
    const bad = [{ terrain: 'Bad Name' }, { terrain: 7 }, { camera: { target: [0, 0], yaw: 0, dist: 50 } }, { camera: { target: [0], yaw: 0, dist: 900 } },
      { subtitle: 5 }, { statusText: null }, { seed: 1.5 }, { clockRatio: 0.5 }, { clockRatio: 61 }, { attacker: 'XX' },
      { victory: { draw: 1 } }, { victory: { other: 'x' } }, { victory: 'x' }, { retreat: { US: [0] } }, { retreat: { XX: [0, 0] } },
      { season: 'monsoon' }, { objective: { ...HH.objective, mode: 'take' } }];
    for (const extra of bad) {
      await refuses('field-refusals ' + JSON.stringify(extra), () => api.loadBattlePack({ packId: 'test-pack', fetcher: serve(pack(api, ['only'], extra)).fetcher }), /^Phase: /);
    }
  }],
  ['phase-links', async api => {
    const p = pack(api, ['a', 'b', 'c', 'd']);
    const rows = ['a', 'b', 'c', 'd'].map(id => { const x = api.preparePhase(p, id); return [x.index, x.previousId, x.nextId]; });
    assert.deepEqual(rows, [[0, null, 'b'], [1, 'a', 'c'], [2, 'b', 'd'], [3, 'c', null]], 'phase-links: previous and next ids');
  }],
  ['game-attacker-us-holds', async api => {
    const g = game(api, { attacker: 'US', victory: { attackerHolds: 'Fictional: the attack holds.' } }, { franklin: OBJ, jackson: FAR });
    runUntilOver(g);
    assert.deepEqual(outcome(g), { over: true, winner: 'US', draw: false, why: 'Fictional: the attack holds.', grade: 'victory' }, 'game-attacker-us-holds: US wins');
  }],
  ['game-attacker-cs-holds', async api => {
    const g = game(api, { attacker: 'CS' }, { jackson: OBJ, franklin: FAR });
    runUntilOver(g);
    assert.deepEqual(outcome(g), { over: true, winner: 'CS', draw: false, why: `Confederate troops hold ${HH.objective.name} at the end of the day.`, grade: 'defeat' }, 'game-attacker-cs-holds: CS wins');
  }],
  ['game-draw', async api => {
    const g = game(api, { attacker: 'US' }, { franklin: [OBJ[0] - 150, OBJ[1]], jackson: [OBJ[0] + 150, OBJ[1]] });
    for (const u of g.units) u.holdFire = true;
    runUntilOver(g);
    assert.deepEqual(outcome(g), { over: true, winner: null, draw: true, why: `${HH.objective.name} is still contested at the end of the day.`, grade: 'draw' }, 'game-draw: contested is a draw');
  }],
  ['game-dominance', async api => {
    // game rule (DECISIONS 0112): a contested objective goes to a side with 3x the other's formed men on it at the day's end
    const r = HH.objective.r, near = [OBJ[0] + r * 0.4, OBJ[1]];
    const g = game(api, { attacker: 'US' }, { franklin: OBJ, jackson: near });
    for (const u of g.units) u.holdFire = true;
    unit(g, 'jackson').men = Math.floor(unit(g, 'franklin').men / 4);
    runUntilOver(g);
    assert.deepEqual(outcome(g), { over: true, winner: 'US', draw: false, why: `Union troops hold ${HH.objective.name} at the end of the day.`, grade: 'decisive' },
      'game-dominance: 4:1 on a contested objective holds it');
    const h = game(api, { attacker: 'US' }, { franklin: OBJ, jackson: near });
    for (const u of h.units) u.holdFire = true;
    unit(h, 'jackson').men = Math.floor(unit(h, 'franklin').men / 2);
    runUntilOver(h);
    assert.equal(outcome(h).draw, true, 'game-dominance: 2:1 is still a draw');
  }],
  ['game-defender-broken', async api => {
    const g = game(api, { attacker: 'US', victory: { defenderBroken: 'Fictional: the defence broke.' } }, { franklin: FAR, jackson: [0, 0] });
    unit(g, 'jackson').takeLosses(500, g.fallen.CS, 0); g.combat.rout(unit(g, 'jackson'), true); g.tick(0.05);
    assert.deepEqual(outcome(g), { over: true, winner: 'US', draw: false, why: 'Fictional: the defence broke.', grade: 'decisive' }, 'game-defender-broken: attacker wins');
    const h = game(api, { attacker: 'US' }, { franklin: FAR, jackson: [0, 0] });
    unit(h, 'franklin').takeLosses(300, h.fallen.US, 0); unit(h, 'jackson').takeLosses(500, h.fallen.CS, 0); h.combat.rout(unit(h, 'jackson'), true); h.tick(0.05);
    assert.deepEqual(outcome(h), { over: true, winner: 'US', draw: false, why: 'The Confederate line has broken.', grade: 'victory' }, 'game-defender-broken: generic text, plain victory');
  }],
  ['game-clock-ratio', async api => {
    const times = [undefined, 12].map(clockRatio => {
      const g = game(api, { attacker: 'US', ...(clockRatio ? { clockRatio } : {}) }, { franklin: OBJ, jackson: FAR });
      const t = runUntilOver(g); return [Math.round(t), g.clockText().time];
    });
    assert.deepEqual(times, [[15, '14:01'], [5, '14:01']], 'game-clock-ratio: end time follows the ratio');
    const reinforced = extra => { const p = pack(api, ['only'], { end: '14:01', ...extra }); p.phases[0].scenario.reinforcements = [{ ...copy(HH.units.find(u => u.id === 'hampton')), id: 'late', atSec: 4, entry: 'Fictional edge' }]; return p; };
    assert.equal(api.prepareReinforcementTimeline(reinforced({ clockRatio: 12 }), 'only').horizon, 5, 'game-clock-ratio: reinforcement horizon');
    assert.equal(api.prepareReinforcementTimeline(reinforced({}), 'only').horizon, 15, 'game-clock-ratio: default horizon');
  }],
  ['game-seed', async api => {
    const draws = seed => { const g = game(api, { attacker: 'US', ...(seed === undefined ? {} : { seed }) }, { franklin: OBJ, jackson: FAR }); return [g.rnd(), g.rnd(), g.rnd()]; };
    const absent = draws(undefined);
    assert.deepEqual(draws(18610721), absent, 'game-seed: default seed is 18610721');
    assert.notDeepEqual(draws(1862), absent, 'game-seed: a pack seed changes the stream');
  }],
  ['game-retreat', async api => {
    const run = retreat => {
      const g = game(api, { attacker: 'US', ...(retreat ? { retreat } : {}) }, { franklin: FAR, jackson: [0, 0], hampton: [1500, 1500] });
      const u = unit(g, 'jackson'), x0 = u.x, z0 = u.z;
      g.combat.rout(u, true);
      for (let k = 0; k < 60; k++) g.tick(0.05);
      return { state: u.state, dx: u.x - x0, dz: u.z - z0 };
    };
    const west = run({ CS: [-1900, 0] }), south = run(null);
    assert.ok(west.state === 'routing' && west.dx < -5 && Math.abs(west.dz) < Math.abs(west.dx) / 4, 'game-retreat: rout runs to the retreat point ' + JSON.stringify(west));
    assert.ok(south.state === 'routing' && south.dz > 5 && Math.abs(south.dx) < south.dz / 4, 'game-retreat: default rout runs to the south edge ' + JSON.stringify(south));
  }],
  ['henry-hill-default', async api => {
    const r = henryHillRun(api);
    assert.ok(HENRY_ORACLE, 'henry-hill-default: oracle missing');
    assert.deepEqual(r, HENRY_ORACLE, 'henry-hill-default: Henry Hill result unchanged');
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'load-happy': { loadBattlePack: opts => loadBattlePack({ ...opts, phaseId: undefined }) },
  'load-refusals': { loadBattlePack: async opts => loadBattlePack({ ...opts, packId: 'test-pack', phaseId: undefined, isCurrent: () => true, fetcher: serve(pack(API)).fetcher }) },
  'field-refusals': { loadBattlePack: opts => loadBattlePack({ ...opts, fetcher: async (url, init) => {
    const body = await (await opts.fetcher(url, init)).json();
    for (const p of body.phases) { for (const k of ['terrain', 'camera', 'subtitle', 'statusText', 'seed', 'clockRatio', 'attacker', 'victory', 'retreat', 'season']) delete p.scenario[k]; delete p.scenario.objective.mode; }
    return new Response(JSON.stringify(body));
  } }) },
  'phase-links': { preparePhase: (p, id) => { const x = preparePhase(p, id); return { ...x, previousId: x.nextId, nextId: x.previousId }; } },
  'game-attacker-us-holds': { transform: s => { delete s.attacker; return s; } },
  'game-attacker-cs-holds': { transform: s => { delete s.attacker; return s; } },
  'game-draw': { transform: s => { delete s.attacker; return s; } },
  'game-dominance': { transform: s => { delete s.attacker; return s; } },
  'game-defender-broken': { transform: s => { delete s.victory; return s; } },
  'game-clock-ratio': { transform: s => { delete s.clockRatio; return s; } },
  'game-seed': { transform: s => { delete s.seed; return s; } },
  'game-retreat': { transform: s => { delete s.retreat; return s; } },
  'henry-hill-default': { transform: s => ({ ...s, attacker: 'US' }) },
};

export async function packsUnit(api = API) {
  for (const [, check] of PACK_CHECKS) await check(api);
  return PACK_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  if (process.argv.includes('--oracle')) { console.log(JSON.stringify(henryHillRun())); process.exit(0); }
  const count = await packsUnit();
  console.log(`PACKS OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of PACK_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`PACKS CONTROLS OK (${rows.length}/${count})`);
  }
}

// CPU check: large battle-pack phases (src/sim/phase.js PACK_FIELD_LIMITS, phaseMenPerFigure; src/game.js pools;
// src/units/unit.js setMenPerFigure). A Shiloh-size fixture (40 formations, 60,000 men) is built here from
// assets/scenarios/henry-hill.json units spread over the ground; every name in it is a fictional test copy and no
// pack file ships for this test. `node tools/test-large.mjs` prints LARGE OK (n/n) and the CPU time of 30 s of
// simulation; `--prove-fail` also runs one mutant per check and requires each to fail its own assertion with that
// check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { setMenPerFigure } from '../src/units/unit.js';
import { loadBattlePack, prepareFieldScenario, prepareReinforcementTimeline, captureAccounting,
  phaseMenPerFigure, FIELD_LIMITS, PACK_FIELD_LIMITS } from '../src/sim/phase.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const CPU_LIMIT_S = 30; // sane bound for 30 s of simulation on one CI core (measured about 4 s on the 8 GB Mac)
const RESERVE_AT_5 = 2100; // game.js SPAWN_RESERVE: four 2,500-man brigades at 1:5

/**
 * `count` formations cycled from the Henry Hill roster (four of each, renamed as test copies). Infantry share the
 * men so the whole field holds exactly `men`; batteries keep their men and guns. US west of x = 0 facing east,
 * CS east facing west, in lines 160 m apart along z, front lines 300 m apart.
 */
function largeRoster(count = 40, men = 60000) {
  const units = Array.from({ length: count }, (_, k) => {
    const src = HH.units[k % HH.units.length], copyNo = Math.floor(k / HH.units.length) + 1;
    return { ...copy(src), id: `${src.id}-${copyNo}`, name: `${src.name} (test copy ${copyNo})`, commander: null };
  });
  const infantry = units.filter(u => (u.type || 'infantry') === 'infantry');
  const left = men - units.filter(u => u.type === 'artillery').reduce((s, u) => s + u.men, 0);
  infantry.forEach((u, i) => { u.men = Math.floor(left / infantry.length) + (i < left % infantry.length ? 1 : 0); });
  for (const side of ['US', 'CS']) {
    const mine = units.filter(u => u.side === side), sign = side === 'US' ? -1 : 1, perLine = Math.ceil(mine.length / 2);
    mine.forEach((u, i) => {
      const line = Math.floor(i / perLine), slot = i % perLine;
      u.x = sign * (150 + line * 220); u.z = -1500 + slot * 160; u.facing = side === 'US' ? Math.PI / 2 : -Math.PI / 2;
    });
  }
  return units;
}
function largeScenario(extra = {}, units = largeRoster()) {
  const s = copy(HH);
  s.id = 'test-large'; s.title = 'Fictional large pack phase (test only)'; s.end = '18:00';
  s.units = units;
  return Object.assign(s, extra);
}
const packOf = (...scenarios) => ({ version: 1, id: 'test-large', title: 'Fictional large test pack',
  phases: scenarios.map((scenario, i) => ({ id: 'phase-' + (i + 1), scenario })) });
const serve = body => async () => new Response(JSON.stringify(body));
const totals = roster => ({ formations: roster.length, men: roster.reduce((s, u) => s + u.men, 0), guns: roster.reduce((s, u) => s + (u.guns || 0), 0) });
const figuresAt = (defs, ratio) => defs.reduce((s, d) => s + Math.round(d.men / (d.type === 'artillery' ? 4 : ratio)) + 6, 0);

async function refuses(name, run, pattern) {
  let error = null;
  try { await run(); } catch (e) { error = e; }
  if (!error) assert.fail(`${name}: accepted what it must refuse`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
async function accepts(name, run) {
  try { return await run(); } catch (e) { assert.fail(`${name}: refused what it must accept: ${e.message}`); }
}
const load = (api, scenario) => api.loadBattlePack({ packId: 'test-large', fetcher: serve(packOf(scenario)) });
function realGame(scenario) {
  setPlan(scenario);
  return new Game({ scene: new Scene(), terrain, scenario, world: { fenceField: null }, effects });
}
const infantryOf = g => g.units.filter(u => u.type === 'infantry');
const BOUND = /^Field: the whole current field exceeds its input bounds/;

const API = { loadBattlePack, prepareFieldScenario, makeGame: realGame };

export const LARGE_CHECKS = [
  ['large-loads', async api => {
    const want = largeScenario({ menPerFigure: 20 });
    assert.deepEqual(totals(want.units), { formations: 40, men: 60000, guns: 80 }, 'large-loads: fixture is 40 formations, 60,000 men');
    assert.ok(figuresAt(want.units, 20) <= PACK_FIELD_LIMITS.figures && figuresAt(want.units, 5) > PACK_FIELD_LIMITS.figures, 'large-loads: fixture straddles the figure bound');
    const a = await accepts('large-loads', () => load(api, want));
    assert.deepEqual([a.scenario.units.length, totals(a.scenario.units).men, a.scenario.menPerFigure, phaseMenPerFigure(a.scenario)], [40, 60000, 20, 20], 'large-loads: the 1:20 phase loads whole');
  }],
  ['large-refuses-dense', async api => {
    for (const menPerFigure of [5, 10]) await refuses(`large-refuses-dense 1:${menPerFigure}`, () => load(api, largeScenario({ menPerFigure })), BOUND);
    await refuses('large-refuses-dense absent', () => load(api, largeScenario()), BOUND);
    for (const menPerFigure of [4, 41, 20.5, '20', null]) {
      await refuses(`large-refuses-dense ${JSON.stringify(menPerFigure)}`, () => load(api, largeScenario({ menPerFigure })), /^Phase: men per figure must be an integer from 5 to 40/);
    }
  }],
  ['pack-limits', async api => {
    assert.deepEqual([PACK_FIELD_LIMITS.formations, PACK_FIELD_LIMITS.men, PACK_FIELD_LIMITS.guns, PACK_FIELD_LIMITS.figures], [48, 80000, 160, 4000], 'pack-limits: pack bounds');
    // 1:40 keeps the figure bound out of the way, so each count is tested at its own edge.
    await accepts('pack-limits 48 formations', () => load(api, largeScenario({ menPerFigure: 40 }, largeRoster(48, 79000))));
    await refuses('pack-limits 49 formations', () => load(api, largeScenario({ menPerFigure: 40 }, largeRoster(49, 79000))), BOUND);
    await accepts('pack-limits 80,000 men', () => load(api, largeScenario({ menPerFigure: 40 }, largeRoster(40, 80000))));
    await refuses('pack-limits 80,001 men', () => load(api, largeScenario({ menPerFigure: 40 }, largeRoster(40, 80001))), BOUND);
    const guns = n => { const r = largeRoster(40, 60000); r.filter(u => u.type === 'artillery').forEach((u, i) => { u.guns = 10 + (i < n - 160 ? 1 : 0); }); return r; };
    await accepts('pack-limits 160 guns', () => load(api, largeScenario({ menPerFigure: 40 }, guns(160))));
    await refuses('pack-limits 161 guns', () => load(api, largeScenario({ menPerFigure: 40 }, guns(161))), BOUND);
  }],
  ['figure-ratio', async api => {
    const s = (await accepts('figure-ratio', () => load(api, largeScenario({ menPerFigure: 20 })))).scenario;
    settings.set('look.menPerFigure', 10);
    const g = api.makeGame(s);
    const rows = g.units.map(u => [u.id, u.menPerFigure, u.figures.length]);
    const want = g.units.map(u => [u.id, u.type === 'artillery' ? 4 : 20, Math.max(1, Math.round(u.men / (u.type === 'artillery' ? 4 : 20)))]);
    assert.deepEqual(rows, want, 'figure-ratio: infantry at the phase 1:20, crews at 1:4');
    settings.set('look.menPerFigure', 5);
    assert.deepEqual(infantryOf(g).map(u => u.menPerFigure), infantryOf(g).map(() => 20), 'figure-ratio: look 1:5 never draws denser than the phase');
    settings.set('look.menPerFigure', 10);
    // A phase minimum between the look choices: the slider still makes figures sparser, never denser.
    const small = (await accepts('figure-ratio', () => load(api, largeScenario({ menPerFigure: 8 }, largeRoster(10, 12000))))).scenario;
    const h = api.makeGame(small);
    const at10 = infantryOf(h).map(u => u.menPerFigure);
    settings.set('look.menPerFigure', 5);
    const at5 = infantryOf(h).map(u => u.menPerFigure);
    settings.set('look.menPerFigure', 10);
    assert.deepEqual([at10, at5], [at10.map(() => 10), at5.map(() => 8)], 'figure-ratio: 1:8 phase draws 1:10 or 1:8');
    const plain = (await accepts('figure-ratio', () => load(api, largeScenario({}, largeRoster(10, 12000))))).scenario;
    const k = api.makeGame(plain);
    settings.set('look.menPerFigure', 5);
    const plain5 = infantryOf(k).map(u => [u.menPerFigure, u.figures.length]);
    settings.set('look.menPerFigure', 10);
    assert.deepEqual(plain5, infantryOf(k).map(u => [5, Math.max(1, Math.round(u.men / 5))]), 'figure-ratio: no phase minimum keeps 1:5');
  }],
  ['pool-sizing', async api => {
    const s = (await accepts('pool-sizing', () => load(api, largeScenario({ menPerFigure: 20 })))).scenario;
    const g = api.makeGame(s), reserve = Math.ceil(RESERVE_AT_5 * 5 / 20);
    const want = side => figuresAt(s.units.filter(u => u.side === side), 20) + reserve;
    const caps = side => [g.pools[side].capacity, g.fallen[side].capacity, g.impostors[side].capacity];
    assert.deepEqual({ US: caps('US'), CS: caps('CS'), reserve: g.reserve },
      { US: [want('US'), want('US'), want('US')], CS: [want('CS'), want('CS'), want('CS')], reserve: { US: reserve, CS: reserve } }, 'pool-sizing: pools sized at the phase 1:20');
    const dense = side => figuresAt(s.units.filter(u => u.side === side), 5) + RESERVE_AT_5;
    assert.ok(g.pools.US.capacity + g.pools.CS.capacity < (dense('US') + dense('CS')) / 3, 'pool-sizing: well under the 1:5 sizing');
    const hh = copy(HH); hh.end = '14:01';
    const h = api.makeGame(hh);
    const hhCap = side => figuresAt(HH.units.filter(u => u.side === side), 5) + RESERVE_AT_5;
    assert.deepEqual([h.pools.US.capacity, h.pools.CS.capacity, h.reserve], [hhCap('US'), hhCap('CS'), { US: RESERVE_AT_5, CS: RESERVE_AT_5 }], 'pool-sizing: Henry Hill keeps the 1:5 sizing');
  }],
  ['large-run', async api => {
    const s = (await accepts('large-run', () => load(api, largeScenario({ menPerFigure: 20 })))).scenario;
    settings.set('look.menPerFigure', 10);
    const g = api.makeGame(s);
    g.initializeReinforcements();
    // the first US line advances on the CS front line so the run includes fire, losses and figure falls
    for (const u of g.units.filter(v => v.side === 'US' && v.x > -200)) u.orderMove([[u.x, u.z], [80, u.z]]);
    const cpu0 = process.cpuUsage(), wall0 = performance.now();
    let error = null, dropped = 0;
    try {
      for (let i = 0; i < 600; i++) {
        g.tick(0.05); g.animate(0.05);
        for (const side of ['US', 'CS']) {
          const alive = g.units.filter(u => u.side === side).reduce((n, u) => n + u.figures.filter(f => f.alive).length, 0);
          if (g.pools[side].pushed + g.impostors[side].standing < alive) dropped++;
        }
      }
    } catch (e) { error = e; }
    const cpu = process.cpuUsage(cpu0), cpuS = (cpu.user + cpu.system) / 1e6, wallS = (performance.now() - wall0) / 1000;
    LARGE_RUN.cpuS = cpuS; LARGE_RUN.wallS = wallS; LARGE_RUN.figures = g.figureCount();
    LARGE_RUN.lost = g.units.reduce((n, u) => n + (u.menMax - u.men), 0);
    assert.equal(error, null, 'large-run: 30 s of simulation without error ' + (error?.stack ?? ''));
    assert.ok(Math.abs(g.simTime - 30) < 1e-6, 'large-run: 30 s of simulation advanced ' + g.simTime);
    assert.ok(g.units.every(u => Number.isFinite(u.men) && u.men >= 0 && Number.isFinite(u.x) && Number.isFinite(u.z)), 'large-run: every formation stays finite');
    assert.equal(dropped, 0, 'large-run: no living figure dropped for want of pool room');
    assert.ok(cpuS < CPU_LIMIT_S, `large-run: CPU ${cpuS.toFixed(1)} s under ${CPU_LIMIT_S} s`);
  }],
  ['route-limits-unchanged', async api => {
    assert.deepEqual([FIELD_LIMITS.formations, FIELD_LIMITS.men, FIELD_LIMITS.guns, FIELD_LIMITS.figures], [10, 14480, 24, 2980], 'route-limits-unchanged: current-field bounds');
    await accepts('route-limits-unchanged', () => api.prepareFieldScenario(copy(HH), 'henry-hill'));
    const eleven = copy(HH); eleven.units.push({ ...copy(HH.units[0]), id: 'franklin-test-copy', men: 100 });
    await refuses('route-limits-unchanged 11 formations', () => api.prepareFieldScenario(eleven, 'henry-hill'), BOUND);
    await refuses('route-limits-unchanged 11 formations at 1:40', () => api.prepareFieldScenario({ ...eleven, menPerFigure: 40 }, 'henry-hill'), BOUND);
    // 1,900 extra men (1,200 gunners, 700 infantry) cross 2,980 figures at 1:5 but not 14,480 men; counted at
    // the phase 1:40 they would fit, so this proves a phase ratio does not relax this route.
    const crowd = copy(HH); crowd.units.find(u => u.id === 'ricketts').men += 1200; crowd.units.find(u => u.id === 'franklin').men += 700;
    await refuses('route-limits-unchanged figures at 1:40', () => api.prepareFieldScenario({ ...crowd, menPerFigure: 40 }, 'henry-hill'), BOUND);
  }],
  ['capture-route', async api => {
    const s = (await accepts('capture-route', () => load(api, largeScenario({ menPerFigure: 20, surrender: true })))).scenario;
    const g = await accepts('capture-route', () => api.makeGame(s));
    assert.equal(g.units.length, 40, 'capture-route: the large surrender phase builds');
    const wrap = scenario => ({ version: 1, id: 'game', title: 'Battle runtime', phases: [{ id: 'battle', scenario }] });
    const ok = await accepts('capture-route', () => captureAccounting(prepareReinforcementTimeline(wrap(s), 'battle', s), { through: 0, events: [] }));
    assert.equal(ok.units.length, 40, 'capture-route: pack-route accounting');
    await refuses('capture-route default bounds', () => captureAccounting(prepareReinforcementTimeline(wrap(s), 'battle'), { through: 0, events: [] }), /^Phase: capture accounting exceeds current software applicability bounds/);
    await refuses('capture-route unvalidated copy', () => captureAccounting(prepareReinforcementTimeline(wrap(s), 'battle', copy(s)), { through: 0, events: [] }), /^Phase: capture accounting exceeds/);
  }],
];
const LARGE_RUN = { cpuS: NaN, wallS: NaN, figures: 0, lost: 0 };

const strip = s => { const t = copy(s); delete t.menPerFigure; return t; };
const rewrite = (fn) => opts => loadBattlePack({ ...opts, fetcher: async (url, init) => {
  const body = await (await opts.fetcher(url, init)).json();
  for (const p of body.phases) fn(p.scenario);
  return new Response(JSON.stringify(body));
} });
// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  // the figure bound counted at 1:5 whatever the phase says
  'large-loads': { loadBattlePack: rewrite(s => { delete s.menPerFigure; }) },
  // the figure bound counted at a fixed sparse ratio, ignoring the requested density
  'large-refuses-dense': { loadBattlePack: rewrite(s => { s.menPerFigure = 20; }) },
  // a formation bound that silently drops formations past 48 instead of refusing
  'pack-limits': { loadBattlePack: rewrite(s => { s.units = s.units.slice(0, 48); }) },
  // the Game ignores the phase minimum
  'figure-ratio': { makeGame: s => realGame(strip(s)) },
  'pool-sizing': { makeGame: s => realGame(strip(s)) },
  // pools sized as if the phase drew 1:40 when it draws 1:20
  'large-run': { makeGame: s => { const g = realGame(s); for (const side of ['US', 'CS']) g.pools[side].capacity = Math.floor(g.pools[side].capacity / 2); return g; } },
  // the pack bounds leak into the Henry Hill route
  'route-limits-unchanged': { prepareFieldScenario: (s, route) => prepareFieldScenario(s, route === 'henry-hill' ? 'pack' : route) },
  // the Game loses the validated route (a detached copy) before capture accounting
  'capture-route': { makeGame: s => realGame(copy(s)) },
};

export async function largeUnit(api = API) {
  try { for (const [, check] of LARGE_CHECKS) await check(api); }
  finally { settings.set('look.menPerFigure', 10); setMenPerFigure(10, 5); }
  return LARGE_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await largeUnit();
  console.log(`LARGE RUN 30 s sim: CPU ${LARGE_RUN.cpuS.toFixed(2)} s, wall ${LARGE_RUN.wallS.toFixed(2)} s, ${LARGE_RUN.figures} living figures, ${Math.round(LARGE_RUN.lost)} men lost`);
  console.log(`LARGE OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of LARGE_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; } finally { settings.set('look.menPerFigure', 10); setMenPerFigure(10, 5); }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`LARGE CONTROLS OK (${rows.length}/${count})`);
  }
}

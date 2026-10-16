// CPU check: play either side in the Battles menu (src/sim/sides.js, DECISIONS 0273). Every shipped phase of the three
// battle packs is loaded through the pack route for both sides and run headless on its real terrain: the Union side is
// the unchanged scenario; the Confederate side hands the player the Confederates, the computer the Union, and in the four
// Union-attack phases the computer's Union actually advances on the objective.
// `node tools/test-sides.mjs` prints SIDES OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail with that check's own name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { TerrainData, EXAGGERATION } from '../src/world/terrain.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { preparePhase, prepareFieldScenario } from '../src/sim/phase.js';
import * as sides from '../src/sim/sides.js';
import { historyComparison } from '../src/franchise/practice.js';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PACKS = ['shiloh', 'stones-river', 'chattanooga'];
const UNION_ATTACKS = ['buell-attacks', 'orchard-knob', 'lookout-mountain', 'missionary-ridge'];
const RUN_S = 180; // simulated seconds each Confederate-side phase runs
const ADVANCE_M = 40; // metres the computer's Union must close on the objective, on average, in that time

const readText = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const terrains = new Map();
function terrainOf(name) {
  if (terrains.has(name)) return terrains.get(name);
  const meta = JSON.parse(readText(`assets/terrain/${name}.json`));
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), G = meta.grid;
  const heights = new Float32Array(G * G), k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  const t = new TerrainData(meta, heights);
  terrains.set(name, t);
  return t;
}
/** Every shipped phase as the pack route prepares it (loadBattlePack without the fetch). */
const PHASES = PACKS.flatMap((packId) => {
  const pack = JSON.parse(readText(`assets/packs/${packId}.json`));
  return pack.phases.map((p) => ({ packId, phaseId: p.id, scenario: prepareFieldScenario(preparePhase(pack, p.id).scenario, 'pack') }));
});
const effects = { volley() {}, boom() {} };
function makeGame(scenario, playerSide) {
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain: terrainOf(scenario.terrain), scenario, world: { fenceField: null }, effects, playerSide });
  game.initializeReinforcements();
  return game;
}
const meanDistance = (units, o) => units.reduce((n, u) => n + Math.hypot(u.x - o.x, u.z - o.z), 0) / units.length;

const CHECKS = [
  ['address', (api) => {
    assert.equal(api.battleSide('?battle=shiloh&phase=camps-at-dawn&side=CS'), 'CS', 'address: side=CS is not the Confederates');
    for (const q of ['', '?battle=shiloh', '?side=US', '?side=cs', '?side=CSA']) assert.equal(api.battleSide(q), 'US', `address: ${q || '(none)'} is not the Union`);
  }],
  ['union-unchanged', (api) => {
    assert.equal(PHASES.length, 11, 'union-unchanged: the three packs no longer ship 11 phases');
    for (const p of PHASES) assert.equal(api.sideScenario(p.scenario, 'US'), p.scenario, `union-unchanged: ${p.phaseId} is not the shipped scenario`);
  }],
  ['confederate-command', (api) => {
    for (const p of PHASES) {
      const s = api.sideScenario(p.scenario, 'CS'), g = api.newGame(s, 'CS');
      const cs = g.units.find((u) => u.side === 'CS'), us = g.units.find((u) => u.side === 'US');
      assert.ok(cs && us, `confederate-command: ${p.phaseId} lacks a side`);
      assert.equal(g.ai.side, 'US', `confederate-command: ${p.phaseId} computer does not fight the Union`);
      assert.ok(g.controls(cs) && !g.controls(us), `confederate-command: ${p.phaseId} player commands the wrong side`);
      assert.ok(g.combat.autoHalt.has('US') && !g.combat.autoHalt.has('CS'), `confederate-command: ${p.phaseId} halts the player's march for good`);
      assert.ok(g.orderable().every((u) => u.side === 'CS'), `confederate-command: ${p.phaseId} offers Union orders`);
    }
  }],
  ['union-roles', (api) => {
    for (const p of PHASES) {
      const s = api.sideScenario(p.scenario, 'CS'), defs = [...s.units, ...(s.reinforcements || [])];
      const us = defs.filter((d) => d.side === 'US'), cs = defs.filter((d) => d.side === 'CS');
      if (UNION_ATTACKS.includes(p.phaseId)) {
        assert.equal(s.attacker, 'US', `union-roles: ${p.phaseId} is not a Union attack`);
        assert.ok(us.every((d) => d.ai?.role === 'attack'), `union-roles: ${p.phaseId} has a Union formation without the attack role`);
      } else assert.ok(us.every((d) => !d.ai), `union-roles: ${p.phaseId} gave the defending Union a role`);
      const shipped = [...p.scenario.units, ...(p.scenario.reinforcements || [])].filter((d) => d.side === 'CS');
      assert.deepEqual(cs.map((d) => d.ai ?? null), shipped.map((d) => d.ai ?? null), `union-roles: ${p.phaseId} changed Confederate data`);
    }
  }],
  ['union-advances', (api) => {
    for (const p of PHASES.filter((q) => UNION_ATTACKS.includes(q.phaseId))) {
      const g = api.newGame(api.sideScenario(p.scenario, 'CS'), 'CS');
      const start = g.units.filter((u) => u.side === 'US'), before = meanDistance(start, g.objective);
      g.fastForward(RUN_S);
      const after = meanDistance(start, g.objective);
      assert.ok(before - after >= ADVANCE_M, `union-advances: ${p.phaseId} Union closed ${(before - after).toFixed(1)} m on the objective, under ${ADVANCE_M}`);
    }
  }],
  ['opening-view', (api) => {
    for (const p of PHASES) {
      const c = api.sideScenario(p.scenario, 'CS').camera, own = p.scenario.units.filter((d) => d.side === 'CS');
      const x = own.reduce((n, d) => n + d.x, 0) / own.length, z = own.reduce((n, d) => n + d.z, 0) / own.length;
      assert.ok(Math.hypot(c.target[0] - x, c.target[1] - z) < 1, `opening-view: ${p.phaseId} is not centred on the Confederates`);
      const turn = Math.abs(Math.atan2(Math.sin(c.yaw - p.scenario.camera.yaw), Math.cos(c.yaw - p.scenario.camera.yaw)));
      assert.ok(Math.abs(turn - Math.PI) < 0.01, `opening-view: ${p.phaseId} does not look from the Confederate side`);
      assert.equal(c.dist, p.scenario.camera.dist, `opening-view: ${p.phaseId} changed the zoom`);
      const half = terrainOf(p.scenario.terrain).half, yaw = api.fitSideCamera(c, half), [tx, tz] = c.target;
      const cx = tx + Math.sin(yaw) * c.dist, cz = tz + Math.cos(yaw) * c.dist;
      assert.ok(Math.abs(cx) <= half - 60 && Math.abs(cz) <= half - 60, `opening-view: ${p.phaseId} camera stands off the map at [${cx.toFixed(0)}, ${cz.toFixed(0)}]`);
    }
  }],
  ['side-texts', (api) => {
    const doc = () => {
      const els = { '#tip': { innerHTML: 'Tap or click a <b>blue flag</b>, then <b>drag from it</b>' }, '#uc-empty': { innerHTML: 'Tap or click a blue flag to select a brigade.' },
        '#battlefield': { label: 'Battlefield. Select a blue brigade with its flag or Army list.', getAttribute() { return this.label; }, setAttribute(_, v) { this.label = v; } } };
      return { els, querySelector: (s) => els[s] };
    };
    const us = doc(), cs = doc();
    api.sideTexts(us, 'US'); api.sideTexts(cs, 'CS');
    assert.ok(us.els['#tip'].innerHTML.includes('blue flag') && us.els['#battlefield'].label.includes('blue brigade'), 'side-texts: the Union tips changed');
    const all = [cs.els['#tip'].innerHTML, cs.els['#uc-empty'].innerHTML, cs.els['#battlefield'].label];
    assert.ok(all.every((t) => !/blue/.test(t) && /Confederate/.test(t)), `side-texts: a Confederate tip still names the blue flags: ${all.join(' | ')}`);
    const html = readText('index.html');
    for (const t of ['a <b>blue flag</b>', 'a blue flag to select', 'Select a blue brigade']) assert.ok(html.includes(t), `side-texts: index.html no longer says "${t}"`);
  }],
  ['history-cs', (api) => {
    const p = PHASES.find((q) => q.phaseId === 'orchard-knob'), s = api.sideScenario(p.scenario, 'CS'), g = api.newGame(s, 'CS');
    g.fastForward(60);
    const c = historyComparison({ game: g, scenario: s });
    assert.equal(c.result.side, 'CS', 'history-cs: the comparison is not from the Confederate side');
    assert.equal(c.result.held, g.holder === 'CS', 'history-cs: held is not the Confederate hold');
    const start = g.units.filter((u) => u.side === 'CS').reduce((n, u) => n + u.menMax, 0);
    assert.equal(c.you.startCS, start, 'history-cs: Confederate starting men are wrong');
  }],
];

const MUTANTS = {
  address: { battleSide: () => 'US' },
  'union-unchanged': { sideScenario: (s, side) => (side === 'US' ? structuredClone(s) : sides.sideScenario(s, side)) },
  'confederate-command': { newGame: (s) => makeGame(s, 'US') }, // the pre-v2 wiring: every Game is the Union's
  'union-roles': { sideScenario: (s, side) => (side === 'CS' ? prepareFieldScenario({ ...structuredClone(s), camera: sides.sideCamera(s, side) }, 'pack') : s) },
  'union-advances': { sideScenario: (s, side) => (side === 'CS' ? prepareFieldScenario({ ...structuredClone(s), camera: sides.sideCamera(s, side) }, 'pack') : s) },
  'side-texts': { sideTexts: () => {} },
  'history-cs': { newGame: (s) => makeGame(s, 'US') },
  'opening-view': { sideScenario: (s, side) => { const o = sides.sideScenario(s, side); return prepareFieldScenario({ ...structuredClone(o), camera: s.camera }, 'pack'); } },
};

async function run(api, only = null) {
  let n = 0;
  for (const [name, fn] of CHECKS) {
    if (only && name !== only) continue;
    await fn(api);
    n++;
    if (!only) console.log(`ok   ${name}`);
  }
  return n;
}

const API = { ...sides, newGame: makeGame };
const n = await run(API);
if (process.argv.includes('--prove-fail')) {
  for (const [name] of CHECKS) {
    assert.ok(MUTANTS[name], `no mutant for ${name}`);
    await assert.rejects(() => run({ ...API, ...MUTANTS[name] }, name), (e) => e.code === 'ERR_ASSERTION' && e.message.startsWith(`${name}:`), `${name}: its mutant was not caught`);
    console.log(`fail ${name} (mutant caught)`);
  }
}
console.log(`SIDES OK (${n}/${CHECKS.length})`);

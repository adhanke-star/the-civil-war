// Fictional launch activation: fixed pre-edit builder oracles plus real CPU terminal ownership.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { introScenario, fictionalSurrenderRoute } from '../src/franchise/intro.js';
import { savedDeployment, assertSavedLaunch } from '../src/franchise/practice.js';
import { validateSnapshot, exportSnapshot } from '../src/franchise/save.js';
import { deploymentFixture } from './test-deployment-ui.mjs';

export const ACTIVATION_NAMES = Object.freeze(['activation-route-positive', 'activation-route-isolation',
  'activation-default-builder', 'activation-intro-definition', 'activation-saved-manifest',
  'activation-invalid-option', 'activation-real-owner', 'activation-default-owner']);
const copy = x => structuredClone(x), hash = x => createHash('sha256').update(x).digest('hex');
const DEFAULT_HASHES = ['27001a721078adad849d72b3058eb82b3218a03090d39a3440e9fabc2d7cdbd4',
  '25733d16ba10a1c5caf22b43c7072e6cfa4eb01358faea5e83d05725f70d3066',
  '8c6e39f8eb49f419e5584157398dfa5767e8c6d8add8d4068205f90daebbe7db'];
const MANIFEST_HASHES = ['bd60ceaa651c0366783d2d86d575c89a5d66309846d98ca4f47a9770d628655c',
  '1867519a512de2af7d2c7bfa99148a571a771312faea242406c0b1e4a4ef6edd'];
const BASELINE_HASHES = ['1a68026ff05a4a56d3c1fae6db3fc074351b9cf7c996797b539be77330e8d3d6',
  '58a2a9f9047a1e6147fe6659d5113a3c39b7d71401f25e62dacd80bd8bcf9e87'];
const deeplyFrozen = x => !x || typeof x !== 'object' || Object.isFrozen(x) && Object.values(x).every(deeplyFrozen);
const self = fileURLToPath(import.meta.url);

export function verifyActivation(index, data) {
  const prefix = ACTIVATION_NAMES[index];
  const ok = value => assert.ok(value, prefix);
  if (index < 2) {
    ok(data.rows.length === (index === 0 ? 4 : 13));
    ok(data.rows.every(r => r.active === (index === 0) && r.active === fictionalSurrenderRoute(r.search)));
  } else if (index === 2) {
    ok(data.defaultOnlyChange === false && data.rows.length === 3);
    data.rows.forEach((r, i) => {
      ok(hash(r.output) === DEFAULT_HASHES[i] && r.inputBefore === r.inputAfter);
      ok(r.defaultCalls.length === 4 && r.defaultCalls.every(s => s === r.output));
      ok(JSON.stringify(Object.keys(JSON.parse(r.output))) === JSON.stringify(r.keys));
      const s = JSON.parse(r.output);
      ok(i === 0 ? !Object.hasOwn(s, 'surrender') : s.surrender === (i === 2));
    });
  } else if (index === 3) {
    ok(data.rows.length === 3 && data.scenario.surrender === true);
    data.rows.forEach((r, i) => {
      const active = JSON.parse(r.active), base = JSON.parse(r.base);
      ok(active.surrender === true && r.ownDataTrue && r.inputBefore === r.inputAfter);
      if (i === 0) delete active.surrender; else active.surrender = base.surrender;
      ok(JSON.stringify(active) === r.base && hash(r.base) === DEFAULT_HASHES[i]);
      ok(JSON.stringify(r.activeKeys.filter(k => k !== 'surrender')) === JSON.stringify(r.baseKeys.filter(k => k !== 'surrender')));
      if (i > 0) ok(JSON.stringify(r.activeKeys) === JSON.stringify(r.baseKeys));
    });
  } else if (index === 4) {
    ok(data.exactScenarioIdentity === true && data.rows.length === 2);
    data.rows.forEach((r, i) => {
      ok(hash(r.baseline) === BASELINE_HASHES[i] && hash(r.defaultManifest) === MANIFEST_HASHES[i]);
      ok(r.baselineBefore === BASELINE_HASHES[i] && r.baselineAfter === BASELINE_HASHES[i] && r.falseManifestHash === MANIFEST_HASHES[i] && r.groundBefore === r.groundAfter && r.deepFrozen && r.originalManifestAccepted);
      const active = JSON.parse(r.activeManifest), base = JSON.parse(r.defaultManifest);
      ok(active.scenario.surrender === true && active.scenario.units.length === active.allocation.formations + 1);
      delete active.scenario.surrender; ok(JSON.stringify(active) === r.defaultManifest);
      ok(JSON.stringify(base.baseline) === r.baseline && JSON.stringify(active.baseline) === r.baseline);
    });
  } else if (index === 5) {
    ok(data.rows.length >= 10 && data.rows.every(r => r.refused && r.groundReads === 0 && r.baselineReads === 0 && r.flagReads === 0));
    ok(data.rows.every(r => r.beforeKeys.join(',') === r.afterKeys.join(',') && /^Practice:/.test(r.error)));
  } else if (index === 6) {
    ok(data.initialized && data.scenarioOwnTrue && data.scenarioReferenceExact && data.sourceDefinitionsExact);
    ok(data.over && ['US', 'CS'].includes(data.result.winner) && data.terminalEvents.length === 1 && data.ticks > 0);
    ok(data.terminalEvents[0].time === data.time && data.terminalEvents[0].winner === data.result.winner);
    ok(data.methodRestored && data.captureCalls === 1 && data.observation && data.report && data.observation.observedAtSec === data.time);
    ok(data.formations <= 4 && data.men <= 2600 && data.guns <= 2 && data.figures <= 556 && data.actualFigures <= 556);
    ok(data.observation.accounting.units.length === data.sourceUnits.length && data.sourceUnits.every(d => data.observation.accounting.units.some(r => r.unitId === d.id)));
  } else if (index === 7) {
    ok(data.absentObservedSnapshot === null && data.rows.length === 2);
    ok(data.rows.every(r => r.snapshot === null && r.over && r.terminalEvents.length === 1 && r.ticks > 0 && r.scenarioReferenceExact && r.sourceDefinitionsExact));
    ok(data.scope === 'Diagnostic post-terminal default query; not production query or private allocation count');
  } else throw new Error('Unknown activation reader case');
}

export function activationMutation(index, data) {
  const x = copy(data);
  if (index === 0) x.rows[0].active = false;
  if (index === 1) x.rows.find(r => r.search === '?tune').active = true;
  if (index === 2) x.defaultOnlyChange = true;
  if (index === 3) x.scenario.surrender = false;
  if (index === 4) x.exactScenarioIdentity = false;
  if (index === 5) x.rows[0].refused = false;
  if (index === 6) x.initialized = false;
  if (index === 7) x.absentObservedSnapshot = {};
  return x;
}

async function cpuOwner(active, falseFlag = false) {
  const [{ Scene }, { Game }, { setPlan }, { RULES }, { LOOK }, settings, practice] = await Promise.all([
    import('three'), import('../src/game.js'), import('../src/world/landscape.js'), import('../src/sim/rules.js'),
    import('../src/ui/look.js'), import('../src/settings.js'), import('../src/franchise/practice.js')]);
  RULES.autoPause = false; RULES.battleSpeed = 1; LOOK.figureStyle = 'rigged';
  settings.set('look.menPerFigure', 5); settings.set('look.formationSpacing', 1);
  const ground = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
  if (falseFlag) ground.surrender = false;
  const scenario = introScenario(ground, active ? { surrender: true } : undefined);
  const men = scenario.units.reduce((n, u) => n + u.men, 0), guns = scenario.units.reduce((n, u) => n + (u.guns || 0), 0);
  const figures = scenario.units.reduce((n, u) => n + Math.max(1, Math.round(u.men / (u.type === 'artillery' ? 4 : 5))) + 6, 0);
  assert(scenario.units.length <= 4 && men <= 2600 && guns <= 2 && figures <= 556);
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain: { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true },
    scenario, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  game.initializeReinforcements();
  const terminalEvents = [];
  game.on('event', e => { if (e.kind === 'result') terminalEvents.push({ kind: e.kind, time: game.simTime, winner: game.result.winner, why: game.result.why }); });
  game.paused = false;
  let ticks = 0; while (!game.over && ticks < 2400) { game.tick(.05); ticks++; }
  assert(game.over, 'CPU ordinary ticks must reach a genuine result');
  const base = { initialized: true, scenarioOwnTrue: Object.getOwnPropertyDescriptor(scenario, 'surrender')?.value === true,
    scenarioReferenceExact: game.scenario === scenario, sourceDefinitionsExact: game.units.every(u => u.def === scenario.units.find(d => d.id === u.id)),
    sourceUnits: copy(scenario.units), scenario: JSON.stringify(scenario), formations: scenario.units.length, men, guns, figures,
    actualFigures: game.units.reduce((n, u) => n + u.figures.length, 0), over: game.over, result: copy(game.result), time: game.simTime, ticks, terminalEvents,
    units: game.units.map(u => ({ id: u.id, name: u.name, side: u.side, men: u.men, shots: u.shots, state: u.state })),
    scope: 'Real CPU Game / flat diagnostic terrain / ordinary ticks; no WebGL/native or forced terminal' };
  if (!active) return { ...base, snapshot: game.captureSnapshot() };
  const original = game.captureSnapshot, descriptor = Object.getOwnPropertyDescriptor(game, 'captureSnapshot');
  let calls = 0, observed;
  try {
    game.captureSnapshot = function (...args) { calls++; const value = original.apply(this, args); assert.equal(this, game); observed = value; return value; };
    const report = practice.surrenderOutcome({ game, scenario });
    return { ...base, captureCalls: calls, observation: copy(observed), report: copy(report), methodRestored: true };
  } finally {
    if (descriptor) Object.defineProperty(game, 'captureSnapshot', descriptor); else delete game.captureSnapshot;
    assert.equal(game.captureSnapshot, original); assert.deepEqual(Object.getOwnPropertyDescriptor(game, 'captureSnapshot'), descriptor);
  }
}

export function runActivation() {
  const ground = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
  const positives = ['?intro', '?intro&quality=low', '?quality=low&intro', '?intro=0'];
  const isolated = ['', '?practice', '?battle=henry-hill', '?sandbox', '?tune', '?tune&intro', '?intro&practice',
    '?intro&battle', '?intro&sandbox', '?intro&tune', '?intro&practice=', '?practice&battle&intro', '?sandbox&battle=henry-hill&intro'];
  const defaults = [], definitions = [];
  for (const [i, flag] of ['absent', 'false', 'authoredtrue'].entries()) {
    const g = copy(ground); if (i > 0) g.surrender = i === 2;
    const inputBefore = JSON.stringify(g), output = JSON.stringify(introScenario(g));
    const defaultCalls = [output, JSON.stringify(introScenario(g, undefined)), JSON.stringify(introScenario(g, {})), JSON.stringify(introScenario(g, { surrender: false }))];
    const active = introScenario(g, { surrender: true });
    defaults.push({ flag, inputBefore, inputAfter: JSON.stringify(g), output, keys: Object.keys(JSON.parse(output)), defaultCalls });
    definitions.push({ flag, inputBefore, inputAfter: JSON.stringify(g), base: output, active: JSON.stringify(active), baseKeys: Object.keys(JSON.parse(output)), activeKeys: Object.keys(active),
      ownDataTrue: Object.getOwnPropertyDescriptor(active, 'surrender')?.value === true });
  }
  const full = deploymentFixture(), small = validateSnapshot({ ...full, awardId: 'activation-small-baseline', seed: 'activation-small-baseline',
    army: copy(full.army.slice(0, 2)).map((b, i) => ({ ...b, men: 1000, weapon: { ...b.weapon, uid: 'small-arm-' + i } })), depot: [], issued: [] });
  const manifests = [];
  for (const [name, baseline] of [['full', full], ['small', small]]) {
    const baselineBefore = exportSnapshot(baseline), groundBefore = JSON.stringify(ground), input = { baseline, ground, awardId: 'activation-' + name + '-before', seed: 'activation-' + name + '-before' };
    const normal = savedDeployment(input), active = savedDeployment({ ...input, surrender: true });
    assert.equal(exportSnapshot(baseline), baselineBefore);
    manifests.push({ name, baseline: baselineBefore, baselineBefore: hash(baselineBefore), baselineAfter: hash(exportSnapshot(baseline)), falseManifestHash: hash(JSON.stringify(savedDeployment({ ...input, surrender: false }))), groundBefore, groundAfter: JSON.stringify(ground),
      defaultManifest: JSON.stringify(normal), activeManifest: JSON.stringify(active), deepFrozen: deeplyFrozen(normal) && deeplyFrozen(active),
      originalManifestAccepted: assertSavedLaunch(active, baseline) === active, identityScope: 'Authentic builder manifest, not Game allocation' });
  }
  const invalid = [];
  for (const kind of ['undefined', 'null', 'string', 'number', 'object', 'array', 'getter', 'inherited', 'options-null', 'options-array']) {
    let groundReads = 0, baselineReads = 0, flagReads = 0;
    const g = {}; Object.defineProperty(g, 'materialized', { enumerable: true, get() { groundReads++; return true; } });
    const input = { ground: g, awardId: 'invalid-activation', seed: 'invalid-activation' };
    Object.defineProperty(input, 'baseline', { enumerable: true, get() { baselineReads++; return small; } });
    let options = {}, value = { undefined: undefined, null: null, string: 'true', number: 1, object: {}, array: [] }[kind];
    if (kind === 'getter') { for (const x of [input, options]) Object.defineProperty(x, 'surrender', { enumerable: true, get() { flagReads++; return true; } }); }
    else if (kind === 'inherited') { Object.setPrototypeOf(input, { surrender: true }); Object.setPrototypeOf(options, { surrender: true }); }
    else if (kind === 'options-null') options = null;
    else if (kind === 'options-array') options = [];
    else { input.surrender = value; options.surrender = value; }
    const beforeKeys = Reflect.ownKeys(input), errors = [];
    for (const fn of [() => introScenario(g, options), () => savedDeployment(kind === 'options-null' ? null : kind === 'options-array' ? [] : input)]) {
      try { fn(); } catch (e) { errors.push(e.message); }
    }
    invalid.push({ kind, refused: errors.length === 2, error: errors.join(' / '), groundReads, baselineReads, flagReads, beforeKeys, afterKeys: Reflect.ownKeys(input) });
  }
  const child = flag => JSON.parse(execFileSync(process.execPath, [self, '--cpu-child', flag], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 }));
  const active = child('true'), absent = child('absent'), disabled = child('false');
  const data = [{ rows: positives.map(search => ({ search, active: fictionalSurrenderRoute(search) })) },
    { rows: isolated.map(search => ({ search, active: fictionalSurrenderRoute(search) })) },
    { defaultOnlyChange: false, rows: defaults }, { scenario: { surrender: definitions[0].ownDataTrue }, rows: definitions },
    { exactScenarioIdentity: manifests.every(r => r.originalManifestAccepted), rows: manifests }, { rows: invalid }, active,
    { absentObservedSnapshot: absent.snapshot, rows: [absent, disabled], scope: 'Diagnostic post-terminal default query; not production query or private allocation count' }];
  const categories = data.map((data, i) => { verifyActivation(i, data); return { name: ACTIVATION_NAMES[i], data }; });
  const controls = categories.map((c, i) => {
    try { verifyActivation(i, activationMutation(i, c.data)); throw new Error('Activation mutation escaped'); }
    catch (e) { assert.equal(e.code, 'ERR_ASSERTION'); assert.ok(e.message.startsWith(ACTIVATION_NAMES[i])); return { name: c.name, code: e.code, message: e.message }; }
  });
  const sourcePaths = [...JSON.parse(fs.readFileSync(new URL('./test-surrender-result-ui.mjs', import.meta.url), 'utf8').match(/^const SOURCE_PATHS = (\[[^\n]+\]);/m)[1]),
    'tools/test-keyboard-ui.mjs', 'tools/test-surrender-activation.mjs', 'tools/test-surrender-activation-ui.mjs'];
  assert.equal(sourcePaths.length, 65); assert.equal(new Set(sourcePaths).size, 65);
  const sources = sourcePaths.map(path => { const b = fs.readFileSync(new URL('../' + path, import.meta.url)); return { path, bytes: b.length, sha256: hash(b) }; });
  return { categories, controls, sources, native: false, scope: 'Explicit fictional builder activation and real bounded CPU ownership; no renderer/grade/captured-arms/history change' };
}

const direct = process.argv[1] && fs.existsSync(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (direct) {
  if (process.argv[2] === '--cpu-child') console.log(JSON.stringify(await cpuOwner(process.argv[3] === 'true', process.argv[3] === 'false')));
  else {
    const actual = runActivation(); console.log('ACTIVATION ACTUAL ' + JSON.stringify(actual)); console.log('ACTIVATION OK (8/8)');
    if (process.argv.includes('--prove-fail')) { for (const c of actual.controls) console.log('CAUGHT ' + c.name + ' ' + c.code + ' ' + c.message);
      console.log('ACTIVATION CONTROLS ' + JSON.stringify(actual.controls)); console.log('ACTIVATION MUTANTS CAUGHT (8/8; semantic readers)'); }
  }
}

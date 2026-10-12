// Remote command membership and temperament, never a physical general. CPU only, no GPU or files written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Ai, composeTraits, chainCommanders } from '../src/sim/ai.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { formationTraits, formationTraitEntries } from '../src/ui/briefing.js';
import { henryHillRun } from './test-packs.mjs';

const read = p => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url)));
const HH = read('assets/scenarios/henry-hill.json'), pack = read('assets/packs/stones-river.json'), data = read('assets/traits.json');
const oracle = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
const name = 'Fictional corps commander (test only)', own = 'Fictional brigade commander (test only)';
const row = { name, rank: 'Lieutenant General', role: 'test corps command', side: 'CS', units: ['jackson'], sources: ['https://example.org/test-only'], status: 'Fictional, test only.' };
const terrain = { half: 3500, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
RULES.autoPause = false; RULES.battleSpeed = 1; LOOK.figureStyle = 'rigged';
settings.set('look.menPerFigure', 10);
function fixture(chain = true) {
  const s = structuredClone(HH);
  s.units = s.units.filter(u => ['jackson', 'bee', 'franklin'].includes(u.id));
  s.units.find(u => u.id === 'jackson').commander = { name: own, rank: 'Colonel' };
  if (chain) { s.commandChain = [structuredClone(row)]; s.commanderTraits = { [name]: ['aggressive', 'reckless'], [own]: ['stubborn'] }; }
  return s;
}
function game(s, manual = false) {
  s = prepareFieldScenario(s, 'pack'); setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  g.initializeReinforcements();
  if (manual) g.units.forEach(u => { u.manual = true; });
  return g;
}
const member = g => g.units.find(u => u.id === 'jackson');
const tick = (g, sec) => { for (let i = 0; i < sec / 0.05; i++) g.tick(0.05); };
const trace = g => ({ units: g.units.map(u => [u.id, u.men, u.morale, u.ammo, u.fatigue, u.state, u.x, u.z, u.order.type]),
  next: g.rnd(), commandDraws: g.commandState().draws, commandNext: g.commandState().rnd(), generals: g.commanders.length });
const api = { prepare: prepareFieldScenario, game, traits: (g, u) => g.ai.traitsOf(u),
  packs: () => structuredClone(pack), chain: chainCommanders, ui: formationTraits, henry: henryHillRun };
const checks = [
  ['phase-membership', a => {
    const p = a.packs(), expected = [
      ['dawn-on-the-right', 'William J. Hardee', ['cs-rains-brigade','cs-ector-brigade','cs-mcnair-brigade','cs-humphreys-battery','cs-liddell-brigade','cs-swett-battery','cs-bjohnson-brigade','cs-lpolk-brigade','cs-wood-brigade']],
      ['round-forest', 'Leonidas Polk', ['cs-chalmers-brigade','cs-donelson-brigade']]];
    assert.equal(p.phases.filter(p => p.scenario.commandChain).length, 2, 'phase-membership: only admitted phases have chains');
    for (const [id, n, ids] of expected) {
      const s = p.phases.find(p => p.id === id).scenario, c = s.commandChain[0];
      assert.deepEqual([c.name, c.rank, c.side, c.units], [n, 'Lieutenant General', 'CS', ids], 'phase-membership: exact source-admitted formations and rank');
      assert.ok(c.status.startsWith('Inferred:') && c.sources.length === 3 && c.sources.every(s => /^https:\/\//.test(s)), 'phase-membership: relationship provenance retained');
      assert.deepEqual(s.commanderTraits[n], data.commanders[n].traits, 'phase-membership: sourced traits carried');
    }
  }],
  ['isolation', a => {
    const s = fixture(), g = a.game(s);
    assert.equal(a.chain(s, member(g)).length, 1, 'isolation: member receives exactly one row');
    assert.equal(a.chain(s, g.units.find(u => u.id === 'bee')).length, 0, 'isolation: nonmember receives no row');
    assert.equal(a.chain(s, { id: 'jackson', side: 'US' }).length, 0, 'isolation: opposite side receives no row');
    assert.deepEqual(a.traits(g, member(g)).keys, ['stubborn','aggressive'], 'isolation: no inherited personal exposure');
  }],
  ['compose-down', a => {
    const s = fixture(); s.enemyCommander = { side: 'CS', name: name + ' army' }; s.commanderTraits[name + ' army'] = ['aggressive'];
    const g = a.game(s), u = member(g);
    assert.deepEqual(a.traits(g, u), composeTraits(['stubborn','aggressive']), 'compose-down: duplicate trait is applied once');
    u.commandDown = 'wounded';
    assert.deepEqual(a.traits(g, u), composeTraits(['aggressive']), 'compose-down: brigade down leaves chain and army influence');
  }],
  ['chain-timing', a => {
    const starts = on => {
      const s = fixture(on);
      s.units.forEach(u => { u.x = u.side === 'US' ? -1700 : 1700; u.z = u.id === 'jackson' ? 1700 : -1700; });
      s.units.find(u => u.id === 'jackson').ai = { role: 'attack', at: '14:02', target: [0,0] };
      const g = a.game(s), u = member(g);
      for (let i = 1; i <= 800; i++) { g.tick(0.05); if (g.ai.memo.get(u)?.active) return i * 0.05; }
      return null;
    };
    const plain = starts(false), chain = starts(true);
    assert.ok(plain > 0 && chain > 0 && chain < plain, 'chain-timing: admitted corps trait actually advances the attack');
  }],
  ['reinforcement', a => {
    const s = fixture(); const u = s.units.find(u => u.id === 'jackson'); s.units = s.units.filter(u => u.id !== 'jackson');
    s.reinforcements = [{ ...u, x: 1200, z: 1200, atSec: 1, noticeSec: 0, entry: 'Fictional test edge' }];
    const g = a.game(s); assert.ok(!member(g), 'reinforcement: absent before arrival');
    tick(g, 1.1);
    assert.ok(member(g) && a.traits(g, member(g)).keys.includes('aggressive'), 'reinforcement: arrives with explicit corps influence');
    assert.equal(g.commanders.length, 0, 'reinforcement: chain creates no mounted general');
  }],
  ['validation', a => {
    const bad = [null, {}, Array(25).fill(row), [row,row], [{ ...row, at: '14:01' }], [{ ...row, x: 0 }], [{ ...row, role: '' }], [{ ...row, rank: '' }],
      [{ ...row, name: '' }], [{ ...row, status: '' }], [{ ...row, units: [] }], [{ ...row, units: ['jackson','jackson'] }], [{ ...row, units: ['franklin'] }],
      [{ ...row, units: ['absent'] }], [{ ...row, sources: [] }], [{ ...row, sources: ['javascript:alert(1)'] }]];
    for (const commandChain of bad) {
      const s = fixture(); s.commandChain = commandChain;
      let error; try { a.prepare(s, 'pack'); } catch (e) { error = e; }
      assert.ok(error && /^Phase: /.test(error.message), 'validation: refuses unsupported or unsourced relationship');
    }
    assert.ok(a.prepare(fixture(), 'pack').commandChain.length === 1, 'validation: accepts sourced membership');
  }],
  ['ui-identity', a => {
    const s = fixture(), d = { vocabulary: data.vocabulary, commanders: {} }, u = { id: 'jackson', side: 'CS', commander: { name: own } };
    const t = a.ui(d, s, u), e = t.chain?.[0];
    assert.ok(e && e.name === name && e.phaseSources[0] === row.sources[0] && /not a plotted location/.test(e.phaseNote), 'ui-identity: relation, sources and scope visible');
    assert.deepEqual(e.traits.map(t => t.key), ['aggressive'], 'ui-identity: inherited exposure not shown');
    u.commandDown = 'killed';
    assert.deepEqual(formationTraitEntries(a.ui(d, s, u)).map(e => e.name), [name], 'ui-identity: corps remains after brigade commander down');
    delete s.commandChain;
    assert.deepEqual(Object.keys(a.ui(d, s, u)), ['own','army'], 'ui-identity: absent-chain UI shape unchanged');
  }],
  ['frozen-combat', a => {
    const s = fixture();
    s.units.forEach(u => { u.x = u.side === 'US' ? 0 : (u.id === 'bee' ? 400 : 0); u.z = u.side === 'US' ? -150 : 0; u.facing = u.side === 'US' ? 0 : Math.PI; });
    const plain = structuredClone(s); delete plain.commandChain;
    const x = a.game(s, true), y = a.game(plain, true);
    tick(x, 20); tick(y, 20);
    assert.ok(x.units.some(u => u.men < u.def.men), 'frozen-combat: fixture actually fought');
    assert.deepEqual(trace(x), trace(y), 'frozen-combat: identical combat, rally and both random streams with frozen orders');
  }],
  ['no-chain', a => {
    const s = fixture(false), empty = structuredClone(s); empty.commandChain = [];
    const x = a.game(s), y = a.game(empty); tick(x, 5); tick(y, 5);
    assert.deepEqual(trace(x), trace(y), 'no-chain: absent and empty remain identical');
    assert.deepEqual(new Ai(x, {}).traitsOf(member(x)), composeTraits([]), 'no-chain: traitless default unchanged');
  }],
  ['henry-hill', a => { assert.deepEqual(a.henry(), oracle, 'henry-hill: existing golden unchanged'); }],
];
const mutants = {
  'phase-membership': { packs: () => { const p = structuredClone(pack); p.phases[0].scenario.commandChain[0].units.pop(); return p; } },
  isolation: { chain: s => s.commandChain },
  'compose-down': { traits: (g,u) => composeTraits(['stubborn', ...g.ai.traitsOf(u).keys]) },
  'chain-timing': { game: (s,m) => { const t = structuredClone(s); delete t.commandChain; return game(t,m); } },
  reinforcement: { traits: () => composeTraits([]) },
  validation: { prepare: s => s },
  'ui-identity': { ui: (d,s,u) => { const t = formationTraits(d,s,u); delete t.chain; return t; } },
  'frozen-combat': { game: (s,m) => { const g = game(s,m); if (s.commandChain) g.rnd(); return g; } },
  'no-chain': { game: (s,m) => { const g = game(s,m); if (s.commandChain) g.rnd(); return g; } },
  'henry-hill': { henry: () => ({ broken: true }) },
};
for (const [, check] of checks) await check(api);
console.log(`COMMAND-CHAIN OK (${checks.length}/${checks.length})`);
if (process.argv.includes('--prove-fail')) {
  for (const [name, check] of checks) {
    let error; try { await check({ ...api, ...mutants[name] }); } catch (e) { error = e; }
    assert.ok(error?.code === 'ERR_ASSERTION' && error.message.startsWith(name), `${name}: mutant must fail its own assertion (${error?.message || 'accepted'})`);
    console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
  }
  console.log(`COMMAND-CHAIN CONTROLS OK (${checks.length}/${checks.length})`);
}

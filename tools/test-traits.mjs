// CPU check (contract P3t): enemy commanders' sourced temperament traits shape the AI (DESIGN §4b "AI character").
// Fictional fields on flat ground are built here (nothing ships for them; nothing is written to disk). Every number checked is a
// game rule in src/franchise/tuning.js TRAITS / DIFFICULTY, never history.
//   - assets/traits.json is a fresh build of tools/data/cs-traits-verified.json and keeps exactly the research's traits, claims,
//     sources and provenance: no dropped trait, every kept trait with opened sources (a Verified man's from two independent
//     organisations); the words describe conduct ("led from the front"), Polk's delay is a delay, Chalmers's card names Fort Pillow;
//   - every shipped pack phase names its army commander (sourced) and carries exactly the traits of the men present;
//   - each trait moves its AI decision in the stated direction on a fixture (aggressive, impetuous, cautious, stubborn,
//     methodical, skilled-defender, slow; reckless through the existing commander-risk roll only), the army commander's traits
//     reach every formation, a fallen commander's leave his brigade, and traits compose with the difficulty level;
//   - frozen orders (every formation manual): identical casualties, morale, rounds, state, place and random streams with and
//     without traits; without trait data the AI is unchanged; Henry Hill's oracle is unchanged.
// `node tools/test-traits.mjs` prints TRAITS OK (n/n); `--prove-fail` also runs one mutant per check and requires each to fail
// its own check, with the check's name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Ai, composeTraits, commanderTraits } from '../src/sim/ai.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { TRAITS, DIFFICULTY } from '../src/franchise/tuning.js';
import { buildTraits, serializeTraits, readResearch, organisation, PROVENANCE } from './build-traits.mjs';
import { buildPack, serialize } from './build-packs.mjs';
import { henryHillRun } from './test-packs.mjs';

RULES.autoPause = false; RULES.battleSpeed = 1;
const RISK = RULES.commanderRisk;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';
const copy = structuredClone;
const ROOT = new URL('../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
// The Henry Hill oracle is owned by tools/test-packs.mjs; read it, never restate it.
const ORACLE = JSON.parse(read('tools/test-packs.mjs').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
const PACK_IDS = ['shiloh', 'stones-river', 'chattanooga'];

// ---- fictional fields ----------------------------------------------------------------------------------------------------
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 1500, weapon: 'rifled', xp: 2,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });
const far = (id, side) => def(id, side, side === 'US' ? -1700 : 1700, side === 'US' ? -1700 : 1700);
const COL = { name: 'Fictional Colonel Able (test only)', rank: 'Colonel' }; // a brigade's own commander
const GEN = 'Fictional General Zed (test only)'; // the army commander
const army = (side = 'CS') => ({ side, name: GEN, rank: 'General', role: 'commanding the fictional test army', sources: ['test fixture only'], status: 'Fictional.' });
/** Scenario keys giving the brigade commander `own` traits and the army commander `gen` traits (none: no keys at all). */
const traited = (own = [], gen = []) => ({ ...(gen.length ? { enemyCommander: army() } : {}),
  ...(own.length || gen.length ? { commanderTraits: { ...(own.length ? { [COL.name]: own } : {}), ...(gen.length ? { [GEN]: gen } : {}) } } : {}) });
/** A fictional field (Henry Hill rules); the AI drives the Confederates unless `manual`. */
function makeField(defs, extra = {}, { manual = false } = {}) {
  const s = { id: 'henry-hill', title: 'Fictional traits CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '18:00',
    units: defs, sites: [], woods: [], objective: { name: 'Fictional remote point', x: 1900, z: -1900, r: 30 }, ...extra };
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  if (manual) for (const u of g.units) u.manual = true;
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);
const run = (g, s, until) => { for (let k = Math.round(s / 0.05); k > 0; k--) { g.tick(0.05); if (until && until()) return g.simTime; } return null; };
/** Sim second at which the AI first marks u's role begun (null: not within `s`). */
const begins = (g, u, s) => run(g, s, () => !!g.ai.memo.get(u)?.active);
/** Sim second at which u first marches (null: not within `s`). */
const marches = (g, u, s) => run(g, s, () => u.follow.active);
const quiet = (g, ...ids) => { for (const id of ids) { const u = unit(g, id); u.holdFire = true; } };
const near = (a, b, tol = 0.6) => a !== null && Math.abs(a - b) <= tol;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const API = {
  field: makeField,
  traitsText: () => read('assets/traits.json'),
  traits: () => JSON.parse(read('assets/traits.json')),
  research: readResearch,
  fresh: () => serializeTraits(buildTraits()),
  shipped: (id) => JSON.parse(read(`assets/packs/${id}.json`)),
  shippedText: (id) => read(`assets/packs/${id}.json`),
  build: (id) => buildPack(id),
  henryHill: (transform = (s) => s) => henryHillRun({ transform }),
};

// ---- checks -------------------------------------------------------------------------------------------------------------
const TRAIT_CHECKS = [
  ['research-match', async (api) => {
    assert.equal(api.traitsText(), api.fresh(), 'research-match: assets/traits.json is not a fresh build of tools/data/cs-traits-verified.json (run node tools/build-traits.mjs)');
    const t = api.traits(), r = api.research();
    assert.deepEqual(Object.keys(t.commanders), r.commanders.map((c) => c.name), 'research-match: the commanders differ from the research');
    for (const c of r.commanders) {
      const mine = t.commanders[c.name];
      assert.deepEqual([mine.traits, mine.provenance], [c.traits, c.provenance], `research-match: ${c.name}'s traits or provenance differ from the research`);
      for (const e of c.evidence) {
        const ev = mine.evidence.find((x) => x.trait === e.trait);
        assert.ok(ev, `research-match: ${c.name} lost the evidence for ${e.trait}`);
        assert.deepEqual(ev.sources, e.sources.map((s) => ({ title: s.title, author: s.author, url: s.url, page: s.page, quote: s.quote })), `research-match: ${c.name}/${e.trait} sources differ from the research`);
        const shown = `${ev.claim} ${ev.researchNote || ''}`;
        for (const sentence of e.claim.split(/(?<=\.)\s+(?=[A-Z])/)) assert.ok(shown.includes(sentence.trim()), `research-match: ${c.name}/${e.trait} lost a sentence of its claim: "${sentence.slice(0, 60)}"`);
      }
    }
  }],
  ['no-dropped', async (api) => {
    const t = api.traits(), r = api.research();
    for (const c of r.commanders) {
      const mine = t.commanders[c.name];
      for (const d of c.dropped || []) assert.ok(!mine.traits.includes(d.trait), `no-dropped: ${c.name} keeps "${d.trait}", which the research dropped`);
      assert.ok(mine.traits.every((k) => c.traits.includes(k)), `no-dropped: ${c.name} has a trait the research did not keep`);
    }
    assert.deepEqual([t.commanders['P. G. T. Beauregard'].traits, t.commanders['Gideon J. Pillow'].traits], [['cautious'], ['aggressive']], 'no-dropped: Beauregard and Pillow keep one trait each (methodical and impetuous were dropped)');
  }],
  ['evidence', async (api) => {
    const t = api.traits();
    for (const [name, c] of Object.entries(t.commanders)) {
      assert.ok(PROVENANCE.includes(c.provenance), `evidence: ${name} has no provenance word`);
      assert.deepEqual(c.evidence.map((e) => e.trait), c.traits, `evidence: ${name} needs one evidence entry per trait`);
      for (const e of c.evidence) {
        assert.ok(e.claim.trim() && e.sources.length >= 1, `evidence: ${name}/${e.trait} has no opened source`);
        for (const s of e.sources) assert.ok(/^https?:\/\//.test(s.url) && s.page && s.quote && s.title && s.author, `evidence: ${name}/${e.trait} has a source without its url, page, quote, title or author`);
        if (c.provenance === 'Verified') assert.ok(new Set(e.sources.map(organisation)).size >= 2, `evidence: ${name}/${e.trait} is Verified on fewer than two independent organisations`);
      }
    }
  }],
  ['wording', async (api) => {
    const t = api.traits(), v = t.vocabulary;
    assert.deepEqual(Object.keys(v), [...TRAITS.keys], 'wording: the vocabulary does not cover exactly the game\'s traits');
    for (const k of TRAITS.keys) {
      assert.ok(v[k].label && v[k].brief && v[k].effect.startsWith('Game rule: '), `wording: ${k} needs a label, a brief and a "Game rule:" effect`);
      assert.ok(v[k].label.toLowerCase().replace(/\W/g, '') !== k.replace(/\W/g, ''), `wording: ${k}'s label is the bare label, not conduct ("${v[k].label}")`);
    }
    assert.equal(v.reckless.label, 'Led from the front', 'wording: Johnston\'s reckless must read "Led from the front"');
    assert.ok(!/reckless/i.test(JSON.stringify(Object.values(v))), 'wording: the shown words say "reckless"');
    const polk = t.commanders['Leonidas Polk'];
    assert.ok(/delay/.test(polk.evidence.find((e) => e.trait === 'slow').claim) && /delay, not disobedience/.test(polk.note?.text || '') && !/disobe/i.test(`${v.slow.label} ${v.slow.brief} ${v.slow.effect}`),
      'wording: Polk\'s Chickamauga delay must be stated as a delay, not disobedience');
    const ch = t.commanders['James R. Chalmers'].note;
    assert.ok(ch && ch.kind === 'record' && /Fort Pillow/.test(ch.text) && /12 April 1864/.test(ch.text) && /massacre of surrendered Black/.test(ch.text)
      && ch.sources?.some((s) => s.url === 'https://www.nps.gov/people/james-ronald-chalmers.htm'), 'wording: Chalmers\'s record note must name Fort Pillow (12 April 1864) and the massacre, with the NPS source');
  }],
  ['packs-carry', async (api) => {
    const table = api.traits().commanders;
    for (const id of PACK_IDS) {
      const { pack } = await api.build(id);
      assert.equal(serialize(pack), api.shippedText(id), `packs-carry: assets/packs/${id}.json is not a fresh build (run node tools/build-packs.mjs ${id})`);
      for (const { id: ph, scenario: s } of api.shipped(id).phases) {
        const c = s.enemyCommander;
        assert.ok(c && c.side === 'CS' && c.name && c.rank && c.role && c.status && c.sources?.length >= 1 && c.sources.every((x) => /https?:\/\//.test(x)),
          `packs-carry: ${id}/${ph} does not name its army commander with sources`);
        const present = [c.name, ...(s.commandChain || []).map(c => c.name), ...[...s.units, ...(s.reinforcements || [])].map((u) => u.commander?.name).filter(Boolean)];
        const want = Object.fromEntries([...new Set(present)].filter((n) => has(table, n)).map((n) => [n, table[n].traits]));
        assert.deepEqual(s.commanderTraits || {}, want, `packs-carry: ${id}/${ph} carries the wrong traits for the men present`);
      }
    }
  }],
  ['aggressive', async (api) => {
    const start = (gen) => { const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', at: '14:02', target: [0, 0] } }), far('us', 'US')], traited([], gen)); return begins(g, unit(g, 'cs'), 40); };
    const plain = start([]), quick = start(['aggressive']);
    assert.ok(near(plain, 30) && near(quick, 30 + TRAITS.aggressive.start), `aggressive: an attack due at 14:02 (30 s) began at ${plain} s, under an aggressive army commander at ${quick} s`);
    const reserve = (gen) => { const g = api.field([def('cs', 'CS', 0, 400, { ai: { role: 'reserve' } }), def('us', 'US', 0, 0)], traited([], gen), { manual: false }); unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); return begins(g, unit(g, 'cs'), 2); };
    assert.ok(reserve([]) === null && reserve(['aggressive']) !== null, 'aggressive: with an enemy 400 m off, only the aggressive reserve committed');
    const again = (own) => {
      const g = api.field([def('cs', 'CS', 0, 1500, { ai: { role: 'attack', target: [0, -1500] }, commander: COL }), far('us', 'US')], traited(own));
      const u = unit(g, 'cs');
      run(g, 1); u.orderHalt(); u.lastFallback = g.simTime;
      const from = g.simTime; return marches(g, u, 40) - from;
    };
    const a0 = again([]), a1 = again(['aggressive']);
    assert.ok(a0 >= 30 && a1 >= 30 * TRAITS.aggressive.cool && a1 < a0, `aggressive: after falling back the attacker went forward again after ${a0.toFixed(2)} s, aggressive after ${a1.toFixed(2)} s`);
  }],
  ['impetuous', async (api) => {
    const start = (own) => { const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', at: '14:02', target: [0, 0] }, commander: COL }), far('us', 'US')], traited(own)); return begins(g, unit(g, 'cs'), 40); };
    const s0 = start([]), s1 = start(['impetuous']);
    assert.ok(near(s0, 30) && near(s1, 30 + TRAITS.impetuous.start), `impetuous: the attack due at 30 s began at ${s0} s, impetuous at ${s1} s`);
    // under a methodical army commander, A (at once) waits for B (due at 14:04, 60 s) sharing its target
    const wait = (own) => {
      const g = api.field([def('a', 'CS', 300, 800, { ai: { role: 'attack', target: [0, 0] }, commander: COL }), def('b', 'CS', -300, 800, { ai: { role: 'attack', at: '14:04', target: [0, 0] } }), far('us', 'US')], traited(own, ['methodical']));
      return marches(g, unit(g, 'a'), 60);
    };
    const w0 = wait([]), w1 = wait(['impetuous']);
    const full = TRAITS.methodical.wait, short = full * TRAITS.impetuous.window;
    assert.ok(near(w0, full, 0.7) && near(w1, short, 0.7), `impetuous: beside a later neighbour under a methodical army, A marched at ${w0} s (want about ${full}), impetuous at ${w1} s (want about ${short})`);
  }],
  ['cautious', async (api) => {
    const start = (own, at) => { const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', ...(at ? { at } : {}), target: [0, 0] }, commander: COL }), far('us', 'US')], traited(own)); return begins(g, unit(g, 'cs'), 60); };
    const t0 = start([], '14:02'), t1 = start(['cautious'], '14:02'), n0 = start([]), n1 = start(['cautious']);
    assert.ok(near(t0, 30) && near(t1, 30 + TRAITS.cautious.start) && near(n0, 0.05, 0.1) && near(n1, TRAITS.cautious.start, 0.7),
      `cautious: the attack due at 30 s began at ${t0} s, cautious at ${t1} s; without a time at ${n0} s, cautious at ${n1} s`);
    const reserve = (own) => { const g = api.field([def('cs', 'CS', 0, 300, { ai: { role: 'reserve' }, commander: COL }), def('us', 'US', 0, 0)], traited(own)); unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); return begins(g, unit(g, 'cs'), 2); };
    assert.ok(reserve([]) !== null && reserve(['cautious']) === null, 'cautious: with an enemy 300 m off, the cautious reserve should still hold');
    const shaken = (own) => {
      const g = api.field([def('cs', 'CS', 0, 150, { men: 1000, morale: 45, commander: COL }), def('us', 'US', 0, 0, { men: 1300 })], traited(own));
      unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); run(g, 1.5);
      const u = unit(g, 'cs'); return [u.state, u.order.type];
    };
    assert.deepEqual([shaken([]), shaken(['cautious'])], [['shaken', 'hold'], ['shaken', 'fallback']], 'cautious: a shaken brigade outnumbered 1.3 to 1 should fall back only when cautious');
  }],
  ['stubborn', async (api) => {
    const holds = (own, men) => {
      const g = api.field([def('cs', 'CS', 0, 150, { men: 1000, morale: 30, commander: COL }), def('us', 'US', 0, 0, { men })], traited(own));
      unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); run(g, 1.5);
      const u = unit(g, 'cs'); return `${u.state}/${u.order.type}`;
    };
    assert.deepEqual([holds([], 1300), holds(['stubborn'], 1300), holds([], 2000), holds(['stubborn'], 2000)], ['wavering/fallback', 'wavering/hold', 'wavering/fallback', 'wavering/fallback'],
      'stubborn: a wavering brigade under a hold order should stand against 1.3 to 1 only when stubborn, and every brigade fall back against 2 to 1');
  }],
  ['methodical', async (api) => {
    const go = (gen, at) => {
      const g = api.field([def('a', 'CS', 300, 800, { ai: { role: 'attack', target: [0, 0] } }), def('b', 'CS', -300, 800, { ai: { role: 'attack', at, target: [0, 0] } }), far('us', 'US')], traited([], gen));
      return marches(g, unit(g, 'a'), 70);
    };
    const p = go([], '14:01'), m1 = go(['methodical'], '14:01'), m2 = go(['methodical'], '14:04');
    // AI passes come about every 0.55 s at Veteran (0.5 s counted down in 0.05 s ticks): A follows B by at most two passes
    assert.ok(near(p, 0.05, 0.1) && m1 > 15 && m1 < 15 + 1.2 && near(m2, TRAITS.methodical.wait, 0.7), `methodical: A marched at ${p} s alone, at ${m1} s waiting for B due at 15 s, at ${m2} s when B is due at 60 s (waits at most ${TRAITS.methodical.wait} s)`);
    assert.deepEqual([composeTraits(['aggressive']).reissue, composeTraits(['aggressive', 'methodical']).reissue], [TRAITS.aggressive.reissue, 1], 'methodical: steady timing must keep the re-issue from shortening');
  }],
  ['skilled-defender', async (api) => {
    const counter = (own) => {
      const g = api.field([def('us', 'US', 0, 0), def('cs', 'CS', 250, 200, { commander: COL })], { attacker: 'US', objective: { name: 'Fictional point', x: 0, z: 0, r: 100 }, ...traited(own) });
      unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); run(g, 1);
      const u = unit(g, 'cs'); return [u.order.type, u.order.target?.id ?? null];
    };
    assert.deepEqual([counter([]), counter(['skilled-defender'])], [['hold', null], ['attack', 'us']], 'skilled-defender: at Veteran only the skilled defender counter-attacks the brigade on the objective');
    const cover = (own) => {
      const g = api.field([def('cs', 'CS', 0, 600, { commander: COL }), def('us', 'US', 0, -400)], { woods: [{ polygon: [[-80, 630], [80, 630], [80, 760], [-80, 760]] }], ...traited(own) });
      unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); run(g, 30);
      const u = unit(g, 'cs'); return g.coverAt(u.x, u.z).kind;
    };
    assert.deepEqual([cover([]), cover(['skilled-defender'])], ['open', 'woods'], 'skilled-defender: only the skilled defender moves into the woods behind it before the enemy is near');
  }],
  ['slow', async (api) => {
    const react = (own) => {
      const g = api.field([def('cs', 'CS', 0, 300, { ai: { role: 'reserve' }, commander: COL }), def('us', 'US', -1700, -1700)], traited(own));
      const us = unit(g, 'us'); us.manual = true; quiet(g, 'us', 'cs');
      run(g, 0.3); us.vehicle.position.x = 0; us.vehicle.position.z = 0; // an enemy appears 300 m off between two AI passes
      return begins(g, unit(g, 'cs'), 3);
    };
    const r0 = react([]), r1 = react(['slow']);
    // the first pass after the enemy appears (about 0.6 s) commits the reserve; a slow one waits for its next pass of its own
    const lag = r1 - r0, pass = DIFFICULTY.veteran.interval;
    assert.ok(r0 !== null && r0 > 0.3 && r0 < 0.3 + pass + 0.11 && lag >= pass * (TRAITS.slow.pass - 1) - 1e-6 && lag <= (pass + 0.11) * (TRAITS.slow.pass - 1),
      `slow: the reserve committed at ${r0} s, the slow one at ${r1} s (one decision every ${TRAITS.slow.pass} passes)`);
  }],
  ['reckless', async (api) => {
    const before = RULES.commanderRisk;
    RULES.commanderRisk = 60;
    try {
      // a brigade commander 10 m behind his line while it fires on a line 150 m off: the hit points are 160 m from him
      const officer = (own) => {
        const g = api.field([def('cs', 'CS', 0, 0, { commander: COL }), def('us', 'US', 0, -150, { men: 3000 })], traited(own), { manual: true });
        unit(g, 'us').holdFire = true; run(g, 20);
        return g.commandState().draws;
      };
      // a general riding 160 m behind his brigade while it is fired on
      const general = (gen) => {
        const g = api.field([def('cs', 'CS', 0, 0, { men: 3000 }), def('us', 'US', 0, -150)], traited([], gen), { manual: true });
        g.addCommander({ id: 'gen', side: 'CS', name: GEN, rank: 'General', units: ['cs'], x: 0, z: 160, sources: ['test'], status: 'Fictional.' });
        unit(g, 'cs').holdFire = true; run(g, 20);
        return g.commandState().draws;
      };
      const [o0, o1, g0, g1] = [officer([]), officer(['reckless']), general([]), general(['reckless'])];
      assert.ok(o0 === 0 && o1 > 0 && g0 === 0 && g1 > 0, `reckless: commander-risk rolls: officer ${o0} plain, ${o1} leading from the front; general ${g0} plain, ${g1} leading from the front`);
      const g = api.field([def('cs', 'CS', 0, 0), far('us', 'US')], traited([], ['reckless', 'aggressive']));
      assert.deepEqual(g.ai.armyTraits, ['aggressive'], 'reckless: the army commander\'s own reckless must stay his, not his army\'s');
    } finally { RULES.commanderRisk = before; }
  }],
  ['army-and-down', async (api) => {
    // the army commander's traits reach a brigade with no commander of its own (aggressive above); a fallen commander's leave his brigade
    const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', at: '14:02', target: [0, 0] }, commander: COL }), far('us', 'US')], traited(['cautious'], ['stubborn']));
    const u = unit(g, 'cs');
    assert.deepEqual(g.ai.traitsOf(u).keys, ['cautious', 'stubborn'], 'army-and-down: the brigade should take its own and its army commander\'s traits');
    run(g, 1); g.commanderDown(u, 'killed');
    assert.deepEqual(g.ai.traitsOf(u).keys, ['stubborn'], 'army-and-down: a fallen commander\'s traits should leave his brigade');
    const at = begins(g, u, 60);
    assert.ok(near(at, 30), `army-and-down: with its cautious commander down, the attack due at 30 s began at ${at} s`);
  }],
  ['compose-difficulty', async (api) => {
    const reserve = (level, gen, d) => { const g = api.field([def('cs', 'CS', 0, d, { ai: { role: 'reserve' } }), def('us', 'US', 0, 0)], { difficulty: level, ...traited([], gen) });
      unit(g, 'us').manual = true; quiet(g, 'us', 'cs'); return begins(g, unit(g, 'cs'), 2) !== null; };
    assert.deepEqual([reserve('general', [], 600), reserve('general', ['aggressive'], 600), reserve('general', ['cautious'], 400)], [false, true, false],
      'compose-difficulty: a General reserve 600 m off should commit only when aggressive (525 x 1.3), and a cautious one not at 400 m (525 x 0.7)');
    const recruit = (gen) => { const g = api.field([def('cs', 'CS', 0, 900, { ai: { role: 'reserve' } }), far('us', 'US')], { difficulty: 'recruit', end: '14:04', ...traited([], gen) }); return begins(g, unit(g, 'cs'), 40); };
    const r0 = recruit([]), r1 = recruit(['aggressive']);
    assert.ok(near(r0, 30) && near(r1, 30 + TRAITS.aggressive.start), `compose-difficulty: a Recruit reserve's set time (30 s) came at ${r0} s, aggressive at ${r1} s`);
  }],
  ['frozen-identity', async (api) => {
    const all = [...TRAITS.keys], before = RULES.commanderRisk;
    const fight = (own, gen, risk) => {
      RULES.commanderRisk = risk;
      try {
        const g = api.field([def('us', 'US', 0, -150, { commander: { name: 'Fictional Union colonel (test only)', rank: 'Colonel' } }), def('us2', 'US', 300, -400),
          def('cs', 'CS', 0, 0, { men: 2500, ai: { role: 'reserve' }, commander: COL }), def('cs2', 'CS', 300, 0, { ai: { role: 'attack' }, commander: COL })], traited(own, gen), { manual: true });
        g.addCommander({ id: 'gen', side: 'CS', name: GEN, rank: 'General', units: ['cs', 'cs2'], x: 150, z: 160, sources: ['test'], status: 'Fictional.' });
        run(g, 40);
        return { units: g.units.map((u) => [u.id, u.men, u.morale, u.ammo, u.state, u.fatigue, +u.x.toFixed(6), +u.z.toFixed(6), u.order.type]), next: g.rnd(), draws: g.commandState().draws, command: g.commandState().rnd() };
      } finally { RULES.commanderRisk = before; }
    };
    const plain = fight([], [], 0), traits = fight(all, all, 0);
    assert.ok(plain.units[2][1] < 2500, 'frozen-identity: the fixture fought nobody');
    assert.deepEqual(traits, plain, 'frozen-identity: with orders frozen, traits changed a combat number or a random stream');
    const noLead = all.filter((k) => k !== 'reckless');
    assert.deepEqual(fight(noLead, noLead, RISK), fight([], [], RISK), 'frozen-identity: with commander risk on, a trait other than reckless changed the commander stream or a combat number');
  }],
  ['inert', async (api) => {
    const trace = (extra) => {
      const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', at: '14:02', target: [0, 0] }, commander: COL }), def('cs2', 'CS', -200, 900, { ai: { role: 'reserve' }, commander: COL }),
        def('cs3', 'CS', 200, 300, { commander: COL }), def('us', 'US', 0, -200)], extra);
      unit(g, 'us').manual = true;
      const out = [];
      for (let k = 0; k < 6; k++) { run(g, 10); out.push(g.units.map((u) => [u.id, +u.x.toFixed(4), +u.z.toFixed(4), u.order.type, !!g.ai.memo.get(u)?.active])); }
      return out;
    };
    const base = trace({});
    for (const extra of [{ commanderTraits: {} }, { commanderTraits: { 'Nobody on this field (test only)': ['aggressive', 'slow'] } },
      { enemyCommander: army('US'), commanderTraits: { [GEN]: ['cautious', 'slow'] } }]) {
      assert.deepEqual(trace(extra), base, `inert: trait data for nobody on this side changed the AI (${Object.keys(extra).join(', ')})`);
    }
    const g = api.field([def('cs', 'CS', 600, 600, { ai: { role: 'attack', at: '14:02', target: [0, 0] }, commander: COL }), far('us', 'US')]);
    const at = begins(g, unit(g, 'cs'), 40);
    assert.ok(near(at, 30) && g.ai.traitsOf(unit(g, 'cs')) === composeTraits([]) && commanderTraits(g.scenario, COL.name).length === 0,
      `inert: without trait data the attack due at 30 s began at ${at} s`);
  }],
  ['henry-hill', async (api) => {
    assert.deepEqual(api.henryHill(), ORACLE, 'henry-hill: Henry Hill differs from the oracle');
    assert.deepEqual(api.henryHill((s) => ({ ...s, commanderTraits: {} })), ORACLE, 'henry-hill: empty trait data changed Henry Hill');
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const editTraits = (fn) => () => { const t = API.traits(); fn(t); return t; };
const textOf = (fn) => () => JSON.stringify(editTraits(fn)(), null, 1) + '\n';
/** A field whose trait data never reaches the AI (the trait checks then see the usual rules). */
const strip = { field: (defs, extra = {}, o) => { const { commanderTraits: _c, enemyCommander: _e, ...rest } = extra; return makeField(defs, rest, o); } };
const patch = (key, fn) => () => { const old = Ai.prototype[key]; Ai.prototype[key] = fn(old); return () => { Ai.prototype[key] = old; }; };
const MUTANTS = {
  'research-match': { traitsText: textOf((t) => { t.commanders['Braxton Bragg'].evidence[1].sources.pop(); }), traits: editTraits((t) => { t.commanders['Braxton Bragg'].evidence[1].sources.pop(); }) },
  'no-dropped': { traits: editTraits((t) => { t.commanders['P. G. T. Beauregard'].traits.push('methodical'); }) },
  'evidence': { traits: editTraits((t) => { const e = t.commanders['Braxton Bragg'].evidence[0]; e.sources = e.sources.filter((s) => organisation(s) === 'American Battlefield Trust'); }) },
  'wording': { traits: editTraits((t) => { t.vocabulary.reckless.label = 'Reckless'; }) },
  'packs-carry': { shipped: (id) => { const p = API.shipped(id); if (id === 'shiloh') delete p.phases[2].scenario.commanderTraits['James R. Chalmers']; return p; } },
  aggressive: strip, impetuous: strip, cautious: strip, stubborn: strip, methodical: strip, 'skilled-defender': strip, slow: strip, reckless: strip,
  'army-and-down': { proto: patch('traitsOf', (old) => function (u) { const T = old.call(this, u); return composeTraits([...T.keys, ...commanderTraits(this.game.scenario, u.commander?.name)]); }) },
  'compose-difficulty': { field: (defs, extra = {}, o) => { const { difficulty: _d, ...rest } = extra; return makeField(defs, rest, o); } },
  'frozen-identity': { field: (defs, extra = {}, o) => makeField(extra.commanderTraits ? defs.map((d) => (d.side === 'CS' ? { ...d, training: { fire: 6 } } : d)) : defs, extra, o) },
  inert: { proto: patch('traitsOf', (old) => function (u) { const T = old.call(this, u); return T.keys.length ? T : composeTraits(['aggressive']); }) },
  // a temperament made into a stat: the AI's trait lookup raises a formation's veterancy (a combat number)
  'henry-hill': { proto: patch('traitsOf', (old) => function (u) { u.xp = 4; return old.call(this, u); }) },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.stack ?? e}` });
  }
}
export async function traitsUnit(api = API) {
  for (const [name, check] of TRAIT_CHECKS) await runCheck(name, check, api);
  return TRAIT_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of TRAIT_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
  }
  const n = TRAIT_CHECKS.length;
  if (failed) { console.log(`TRAITS FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`TRAITS OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of TRAIT_CHECKS) {
      const m = MUTANTS[name], restore = m.proto ? m.proto() : null, api = { ...API, ...m };
      delete api.proto;
      let error = null;
      try { await runCheck(name, check, api); } catch (e) { error = e; } finally { restore?.(); }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`TRAITS CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`TRAITS CONTROLS OK (${caught}/${n})`);
  }
}

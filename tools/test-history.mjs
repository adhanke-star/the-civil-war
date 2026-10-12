// CPU check: the after-action history (P4x). Every campaign phase's sourced history block (assets/packs/*.json, built by
// tools/build-packs.mjs from tools/packs/*.mjs and validated by src/sim/phase.js), the map-replay recorder
// (src/sim/recorder.js: bounded, deterministic, draw-free, no change to the simulation), the replay track and "you vs
// history" carried through phaseOutcome (src/franchise/practice.js), the campaign grade rule and the record book's data
// (src/ui/records.js), and the sourced campaign epilogue. Fictional fields for the recorder are built here; the real
// pack phase runs use the real Shiloh terrain. Nothing is written to disk. No browser, no GPU.
// `node tools/test-history.mjs` prints HISTORY OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail that check, with the check's own name at the start of the failure text.
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
import { preparePhase, prepareFieldScenario, HISTORY_PROVENANCE } from '../src/sim/phase.js';
import * as recorder from '../src/sim/recorder.js';
import { phaseOutcome, historyComparison } from '../src/franchise/practice.js';
import * as campaign from '../src/franchise/campaign.js';
import { campaignGrade, buildRecordBook, summarizePack, EPILOGUE, CAMPAIGN_RULE } from '../src/ui/records.js';
import { buildPack, serialize } from './build-packs.mjs';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';
const readText = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const PACK_IDS = ['shiloh', 'stones-river', 'chattanooga'];
// Campaign phases deliberately shipped without a history block (none today: every phase has its research).
const WITHOUT_HISTORY = [];
const effects = { volley() {}, boom() {} };

// ---- harness --------------------------------------------------------------------------------------------------------
function loadTerrain(name) {
  const meta = JSON.parse(readText(`assets/terrain/${name}.json`));
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), G = meta.grid;
  const heights = new Float32Array(G * G), k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  return new TerrainData(meta, heights);
}
const terrains = new Map();
const terrainOf = (name) => { if (!terrains.has(name)) terrains.set(name, loadTerrain(name)); return terrains.get(name); };
function packGame(packId, phaseId) {
  const scenario = prepareFieldScenario(preparePhase(JSON.parse(readText(`assets/packs/${packId}.json`)), phaseId).scenario, 'pack');
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain: terrainOf(scenario.terrain), scenario, world: { fenceField: null }, effects });
  game.initializeReinforcements();
  return { game, scenario };
}
const flat = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 1500, weapon: 'rifled', xp: 2,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });
/** A fictional Henry Hill-rules field (no pack identity): two brigades a side close enough to fight. */
function fictionalGame() {
  const s = { id: 'henry-hill', title: 'Fictional history CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '18:00',
    units: [def('us-a', 'US', -80, -120), def('us-b', 'US', 80, -120), def('cs-a', 'CS', -80, 40), def('cs-b', 'CS', 80, 40)],
    sites: [], woods: [], objective: { name: 'Fictional point', x: 0, z: -40, r: 150 } };
  setPlan(s);
  return new Game({ scene: new Scene(), terrain: flat, scenario: s, world: { fenceField: null }, effects });
}
/** Everything the simulation decides, to compare two runs: positions, strength, state, morale, clock and the next draw. */
const fingerprint = (g) => JSON.stringify({ t: g.simTime, over: g.over, holder: g.holder, result: g.result ?? null,
  units: g.units.map((u) => [u.id, u.x, u.z, u.facing, u.men, u.state, u.morale]), next: g.rnd() });
const run = (g, seconds) => { for (let k = 0; k < Math.round(seconds / 0.05) && !g.over; k++) g.tick(0.05); };
/** A tiny stand-in game for the recorder alone (moving units, a reinforcement, a rout); no simulation. */
function fakeGame(n = 4) {
  const units = Array.from({ length: n }, (_, i) => ({ id: `f${i}`, side: i % 2 ? 'CS' : 'US', type: 'infantry', name: `Fictional ${i}`, short: `F${i}`,
    x: i * 100, z: 0, facing: 0, men: 1000, menMax: 1000, state: 'steady' }));
  return { units, simTime: 0, over: false, holder: 'none', clockRatio: 10, scenario: { start: '10:00' }, objective: { name: 'Fictional', x: 0, z: 0, r: 200 } };
}
const API = { ...recorder, phaseOutcome, historyComparison, preparePhase, campaignGrade, buildRecordBook, summarizePack, EPILOGUE,
  shipped: (id) => JSON.parse(readText(`assets/packs/${id}.json`)), shippedText: (id) => readText(`assets/packs/${id}.json`), build: buildPack,
  ladder: () => JSON.parse(readText('assets/campaign.json')) };
const fmt = (n) => Number(n).toLocaleString('en-US');

export const HISTORY_CHECKS = [
  ['history-blocks', async (api) => {
    const ladder = api.ladder(), packs = Object.fromEntries(PACK_IDS.map((id) => [id, api.shipped(id)]));
    let n = 0;
    for (const p of ladder.phases) {
      const pack = packs[p.packId];
      assert.ok(pack, `history-blocks: pack ${p.packId} is not shipped`);
      const s = api.preparePhase(pack, p.phaseId).scenario, h = s.history;
      if (WITHOUT_HISTORY.includes(`${p.packId}/${p.phaseId}`)) { assert.equal(h, undefined, `history-blocks: ${p.phaseId} is listed as without history but has one`); continue; }
      assert.ok(h, `history-blocks: campaign phase ${p.packId}/${p.phaseId} has no history block and is not listed as intentionally without`);
      assert.ok(h.outcome.length >= 1 && h.outcome.length <= 3 && h.outcome.every((x) => x.length >= 80), `history-blocks: ${p.phaseId} outcome needs 1-3 real paragraphs`);
      assert.ok(h.closingQuote.text && h.closingQuote.who && h.closingQuote.source, `history-blocks: ${p.phaseId} closing quote needs text, speaker and source`);
      assert.ok(h.sources.length >= 2 && h.sources.some((x) => /^https:\/\//.test(x.url ?? '')), `history-blocks: ${p.phaseId} needs at least two sources with a link`);
      n++;
    }
    assert.equal(n + WITHOUT_HISTORY.length, ladder.phases.length, `history-blocks: ${n} of ${ladder.phases.length} campaign phases carry history`);
    // the closing quotation differs from the Briefing's opening one wherever the research gave a second quotation
    const distinct = ladder.phases.filter((p) => { const s = api.preparePhase(packs[p.packId], p.phaseId).scenario; return s.history.closingQuote.text !== s.briefing.quote?.text; });
    assert.ok(distinct.length >= 6, `history-blocks: only ${distinct.length} closing quotations differ from the Briefing's`);
  }],
  ['history-validation', async (api) => {
    const pack = api.shipped('stones-river'), good = pack.phases[0].scenario.history;
    api.preparePhase(pack, pack.phases[0].id); // the shipped block passes
    const bad = [
      ['an unknown field', { ...good, extra: 1 }],
      ['a provenance word outside the list', { ...good, casualties: { ...good.casualties, provenance: 'Probably' } }],
      ['a negative figure', { ...good, casualties: { ...good.casualties, US: -5 } }],
      ['a reversed range', { ...good, casualties: { ...good.casualties, CS: [900, 300] } }],
      ['four paragraphs', { ...good, outcome: [...good.outcome, 'x', 'y', 'z'] }],
      ['a quote without a source', { ...good, closingQuote: { text: 'x', who: 'y' } }],
      ['a javascript: link', { ...good, sources: [{ label: 'x', url: 'javascript:alert(1)' }] }],
      ['no sources', { ...good, sources: [] }],
    ];
    for (const [what, history] of bad) {
      const copy = structuredClone(pack); copy.phases[0].scenario.history = history;
      let error = null;
      try { api.preparePhase(copy, copy.phases[0].id); } catch (e) { error = e; }
      assert.ok(error && /^Phase: history/.test(error.message), `history-validation: a history block with ${what} was accepted${error ? ` (${error.message})` : ''}`);
    }
  }],
  ['casualty-provenance', async (api) => {
    for (const id of PACK_IDS) for (const p of api.shipped(id).phases) {
      const c = p.scenario.history?.casualties;
      if (!c) continue;
      assert.ok(HISTORY_PROVENANCE.includes(c.provenance), `casualty-provenance: ${p.id} provenance "${c.provenance}"`);
      assert.ok(c.basis.length >= 60, `casualty-provenance: ${p.id} needs its basis stated`);
      // every figure shown is one the basis states (the basis carries the sourced numbers and their method)
      for (const side of ['US', 'CS']) for (const n of [c[side]].flat().filter((x) => x !== null)) {
        assert.ok(c.basis.includes(fmt(n)), `casualty-provenance: ${p.id} ${side} figure ${fmt(n)} is not in its basis`);
      }
      if (Array.isArray(c.US) || Array.isArray(c.CS)) assert.equal(c.provenance, 'Disputed', `casualty-provenance: ${p.id} shows a range, so its provenance must be Disputed`);
    }
  }],
  ['packs-built', async (api) => {
    for (const id of PACK_IDS) {
      const { pack } = await api.build(id);
      assert.equal(serialize(pack), api.shippedText(id), `packs-built: assets/packs/${id}.json differs from a fresh build (run node tools/build-packs.mjs ${id})`);
      assert.ok(pack.phases.every((p) => p.scenario.history), `packs-built: a ${id} phase lost its history block in the build`);
    }
  }],
  ['recorder-bounded', async (api) => {
    const g = fakeGame(6), r = api.attachRecorder(g);
    assert.equal(api.attachRecorder(g), r, 'recorder-bounded: a second attach made a second recorder');
    // a 20-minute phase at 1x: 1200 sim seconds in 0.05 s ticks
    for (let k = 1; k <= 24000; k++) {
      g.simTime = k * 0.05;
      for (const u of g.units) { u.x += u.side === 'US' ? 0.05 : -0.05; u.men = Math.max(0, u.men - 0.01); }
      if (k === 8000) g.units.push({ id: 'late', side: 'US', type: 'artillery', name: 'Fictional late battery', x: 0, z: 0, facing: 1, men: 100, menMax: 100, state: 'steady' });
      if (k === 12000) g.units[1].state = 'routing';
      r.observe(g);
    }
    const t20 = api.validateReplay(r.track(g));
    assert.ok(t20.samples.length <= 301 && t20.interval === api.REPLAY_LIMITS.interval, `recorder-bounded: a 20-minute phase kept ${t20.samples.length} samples at ${t20.interval} s (want <= 301 at 4 s)`);
    assert.ok(t20.samples[0].u.length === 30 && t20.samples.at(-1).u.length === 35, 'recorder-bounded: the late formation must appear only after it arrived');
    // a long fight-on stays inside the cap with a coarser step
    for (let k = 24001; k <= 120000; k++) { g.simTime = k * 0.05; r.observe(g); }
    const long = api.validateReplay(r.track(g));
    assert.ok(long.samples.length <= api.REPLAY_LIMITS.samples && long.interval > api.REPLAY_LIMITS.interval,
      `recorder-bounded: 6,000 sim seconds kept ${long.samples.length} samples (cap ${api.REPLAY_LIMITS.samples}) at ${long.interval} s`);
    assert.ok(Buffer.byteLength(JSON.stringify(long)) < api.REPLAY_LIMITS.bytes, 'recorder-bounded: the track exceeds its byte bound');
    const f = api.replayFrame(t20, 600), routed = f.units.find((u) => u.id === 'f1');
    assert.equal(routed.state, 'routed', 'recorder-bounded: a routing formation must replay as routed');
    assert.equal(api.replayClock(t20, 600), '11:40', 'recorder-bounded: 600 sim s at a 10x clock from 10:00 is 11:40');
  }],
  ['recorder-deterministic', async (api) => {
    const once = () => { const g = fictionalGame(); api.attachRecorder(g); run(g, 30); return JSON.stringify(g.recorder.track(g)); };
    const a = once(), b = once();
    assert.equal(a, b, 'recorder-deterministic: two identical runs recorded different tracks');
    const t = api.validateReplay(JSON.parse(a));
    assert.ok(t.samples.length >= 8 && t.samples.some((s) => s.u.some((v, i) => i % 5 === 3 && v < 1500)), 'recorder-deterministic: the fictional fight recorded no losses');
  }],
  ['recorder-draw-free', async (api) => {
    // Math.random calls during a run, counted the same way with and without the recorder (the recorder must add none)
    const counted = (g) => { const random = Math.random; let n = 0; Math.random = () => { n++; return random(); }; try { run(g, 30); } finally { Math.random = random; } return n; };
    const plain = fictionalGame(), plainCalls = counted(plain);
    const watched = fictionalGame(); api.attachRecorder(watched);
    const watchedCalls = counted(watched);
    assert.equal(fingerprint(watched), fingerprint(plain), 'recorder-draw-free: attaching the recorder changed the fictional battle');
    assert.equal(watchedCalls, plainCalls, `recorder-draw-free: the recorder added ${watchedCalls - plainCalls} Math.random draws`);
    // a real pack phase (Shiloh, Grant's last line) past its reinforcement's arrival at 300 s, with and without the recorder
    const a = packGame('shiloh', 'grants-last-line').game; run(a, 310);
    const b = packGame('shiloh', 'grants-last-line').game; api.attachRecorder(b); run(b, 310);
    assert.ok(a.simTime >= 309.9 && a.units.length > 9, `recorder-draw-free: the Shiloh run reached only ${a.simTime.toFixed(1)} s with ${a.units.length} formations (Ammen's brigade arrives at 300 s)`);
    assert.equal(fingerprint(b), fingerprint(a), 'recorder-draw-free: attaching the recorder changed the Shiloh phase');
    const shiloh = api.validateReplay(b.recorder.track(b));
    assert.ok(shiloh.samples.length >= 70 && shiloh.units.length === b.units.length && shiloh.samples[0].u.length < shiloh.samples.at(-1).u.length,
      'recorder-draw-free: the Shiloh track must grow when the reinforcement arrives');
  }],
  ['replay-round-trip', async (api) => {
    const { game, scenario } = packGame('chattanooga', 'orchard-knob');
    api.attachRecorder(game);
    run(game, 20);
    game.paused = true;
    for (const u of game.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing'; // the documented UI-test hook
    game.checkObjective(0, true);
    assert.ok(game.over, 'replay-round-trip: the forced result did not end the phase');
    const outcome = api.phaseOutcome({ game, scenario, awardId: 'west.1.chattanooga.orchard-knob.1', seed: 'history-test' });
    assert.ok(outcome.replay, 'replay-round-trip: the phase outcome carries no replay track');
    const back = api.validateReplay(JSON.parse(JSON.stringify(outcome.replay)));
    assert.deepEqual(back, outcome.replay, 'replay-round-trip: the track did not survive a JSON round trip');
    const first = api.replayFrame(back, 0), last = api.replayFrame(back, Infinity);
    const start = new Map(scenario.units.map((d) => [d.id, d]));
    assert.ok(first.units.every((u) => Math.abs(u.x - start.get(u.id).x) <= 1 && Math.abs(u.z - start.get(u.id).z) <= 1), 'replay-round-trip: the first frame is not the opening positions');
    assert.ok(last.units.filter((u) => u.side === 'CS' && u.type === 'infantry').every((u) => u.state === 'routed' || u.state === 'gone'), 'replay-round-trip: the last frame lost the rout');
    const h = outcome.history;
    const lost = (side) => outcome.units.filter((u) => u.side === side).reduce((n, u) => n + u.menStart - u.men, 0);
    assert.equal(h.you.lossesUS, lost('US'), 'replay-round-trip: Union losses in "you vs history" differ from the outcome');
    assert.equal(h.you.lossesCS, lost('CS'), 'replay-round-trip: Confederate losses in "you vs history" differ from the outcome');
    assert.deepEqual(h.history.casualties, { ...scenario.history.casualties }, 'replay-round-trip: the historical casualties were not carried');
    assert.equal(h.story.closingQuote.text, scenario.history.closingQuote.text, 'replay-round-trip: the story was not carried');
    assert.equal(h.result.grade, outcome.grade, 'replay-round-trip: the comparison grade differs from the outcome');
    // without a recorder there is no replay and the result is unchanged
    const plain = packGame('chattanooga', 'orchard-knob'); run(plain.game, 20); plain.game.paused = true;
    for (const u of plain.game.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing';
    plain.game.checkObjective(0, true);
    const o2 = api.phaseOutcome({ game: plain.game, scenario: plain.scenario, awardId: 'west.1.chattanooga.orchard-knob.1', seed: 'history-test' });
    assert.equal(o2.replay, null, 'replay-round-trip: a game without a recorder produced a replay');
    assert.deepEqual([o2.grade, o2.units, o2.cards], [outcome.grade, outcome.units, outcome.cards], 'replay-round-trip: the recorder changed the phase result or its loot');
  }],
  ['history-comparison', async (api) => {
    const scenario = api.preparePhase(api.shipped('stones-river'), 'mcfaddens-ford').scenario;
    const game = { units: [], simTime: 600, clockRatio: 3.5, holder: 'US', result: { winner: 'US', grade: 'victory', why: 'Fictional test result.' } };
    const units = [{ side: 'US', menStart: 1000, men: 900 }, { side: 'US', menStart: 500, men: 500 }, { side: 'CS', menStart: 2000, men: 1200 }];
    const c = api.historyComparison({ game, scenario, units, grade: 'Victory' });
    assert.deepEqual([c.you.startUS, c.you.lossesUS, c.you.startCS, c.you.lossesCS], [1500, 100, 2000, 800], 'history-comparison: losses are not the outcome rows');
    assert.equal(c.you.finishedAt, '16:35', 'history-comparison: 600 sim s at a 3.5x clock from 16:00 ends at 16:35');
    assert.equal(c.you.ended, false, 'history-comparison: 16:35 is before the window end 17:00');
    assert.deepEqual([c.history.end, c.history.casualties.CS, c.history.casualties.US], ['17:00', [1338, 1800], null], 'history-comparison: the historical side is wrong');
    assert.deepEqual([c.scale.menPerFigure, c.scale.clockRatio], [scenario.menPerFigure, 3.5], 'history-comparison: the scale is wrong');
    assert.equal(c.result.held, true, 'history-comparison: the held objective was lost');
  }],
  ['campaign-grade', async (api) => {
    const row = (packId, phaseId, grade, replay = false) => ({ packId, phaseId, grade, replay });
    assert.equal(api.campaignGrade([]).grade, null, 'campaign-grade: an empty history has a grade');
    const best = api.campaignGrade([row('a', 'p1', 'Decisive'), row('a', 'p2', 'Decisive'), row('b', 'p1', 'Victory')]);
    assert.deepEqual([best.grade, best.score, best.battles.map((b) => b.medal.id)], ['Decisive', 2.67, ['gold', 'silver']], 'campaign-grade: the means or medals are wrong');
    // a defeat replayed into a victory scores 1.5 (best grade, less half a point), not 2
    const replayed = api.campaignGrade([row('a', 'p1', 'Defeat'), row('a', 'p1', 'Victory', true)]);
    assert.deepEqual([replayed.score, replayed.grade, replayed.battles[0].medal.id, replayed.battles[0].phases[0].replayed], [1.5, 'Draw', 'bronze', true],
      'campaign-grade: a replayed phase must score its best grade less half a point');
    const poor = api.campaignGrade([row('a', 'p1', 'Defeat'), row('a', 'p2', 'Draw')]);
    assert.deepEqual([poor.grade, poor.battles[0].medal.id], ['Defeat', 'none'], 'campaign-grade: a poor battle earned a medal');
    const ordered = api.campaignGrade([row('b', 'p1', 'Victory'), row('a', 'p1', 'Victory')], [{ packId: 'a', phaseId: 'p1' }, { packId: 'b', phaseId: 'p1' }]);
    assert.deepEqual(ordered.battles.map((b) => b.packId), ['a', 'b'], 'campaign-grade: battles must follow the ladder');
    assert.ok(/^Game rule:/.test(CAMPAIGN_RULE), 'campaign-grade: the rule must be labelled a game rule');
  }],
  ['record-book', async (api) => {
    const ladder = api.ladder(), def = campaign.validateCampaign(ladder);
    let s = campaign.newCampaign({ campaign: ladder, slot: 1, seed: 7 });
    const play = (grade, units = []) => { const p = campaign.campaignPhase(s, ladder); s = campaign.recordPhase(s, ladder, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: grade === 'Defeat' ? 'CS' : 'US', grade, units, loot: [] }); };
    play('Victory'); play('Defeat'); play('Victory');
    play('Decisive', [{ id: 'us-ammen-brigade', side: 'US', menStart: 1563, men: 1400 }, { id: 'cs-wood-brigade', side: 'CS', menStart: 1500, men: 900 }]);
    // replay the fourth phase (marked), then give one brigade badges and a captured arm, and the depot two captures
    { const p = campaign.campaignPhase(s, ladder, { replay: true }); s = campaign.recordPhase(s, ladder, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade: 'Victory', units: [], loot: [] }); }
    const save = structuredClone(s);
    const ammen = save.army.find((b) => b.unitId === 'us-ammen-brigade');
    ammen.badges = [{ id: 'hardMarchers', tier: 'silver', awardId: 'x', feat: 1 }];
    ammen.weapon = { ...ammen.weapon, itemId: 'enfield', tier: 'rare', source: 'capture', from: 'Captured: fictional test crate' };
    save.depot = [{ uid: 'd1', itemId: 'lorenz', tier: 'uncommon', conditionId: 'worn', source: 'capture', from: 'Captured: fictional test crate' },
      { uid: 'd2', itemId: 'henry', tier: 'legendary', conditionId: 'serviceable', source: 'issue', from: 'Quartermaster issue' }];
    const packs = Object.fromEntries(PACK_IDS.map((id) => [id, api.summarizePack(api.shipped(id))]));
    const book = api.buildRecordBook(save, { campaign: def, packs });
    assert.deepEqual(book.battles.map((x) => [x.packId, x.title]), [['shiloh', packs.shiloh.title]], 'record-book: the recorded battle or its pack title is wrong');
    assert.deepEqual(book.battles[0].phases.map((p) => p.phaseId), def.phases.slice(0, 4).map((p) => p.phaseId), 'record-book: phases are not in ladder order');
    const buell = book.battles[0].phases.find((p) => p.phaseId === 'buell-attacks');
    assert.ok(buell && buell.attempts.length === 2 && buell.attempts[1].replay === true && buell.replayed, 'record-book: the replay is not marked on its phase');
    assert.deepEqual(buell.attempts[0].lossesUS, 163, 'record-book: the phase losses are not the recorded ones');
    assert.deepEqual(buell.history, { ...packs.shiloh.phases['buell-attacks'].casualties }, 'record-book: the historical casualties were not attached');
    assert.ok(book.battles[0].phases[0].loan, 'record-book: the loan phase is not marked');
    const b = book.brigades.find((x) => x.id === ammen.id);
    assert.deepEqual(b.phases.map((p) => p.phaseId), ['buell-attacks'], 'record-book: phases fought must be the non-loan recorded phases on its roster');
    assert.ok(b.badges.length === 1 && b.badges[0].tierName === 'Silver' && b.bestCapture?.tier === 'rare', 'record-book: the brigade history lost its badges or capture');
    assert.deepEqual(book.captures.map((x) => x.tier), ['rare', 'uncommon'], 'record-book: best captures must be captured arms only, rarest first');
    assert.equal(book.replays, 1, 'record-book: the replay count is wrong');
    assert.equal(book.grade.phases, 4, 'record-book: the campaign grade must count each phase once');
  }],
  ['epilogue-sourced', async (api) => {
    const e = api.EPILOGUE;
    assert.ok(e.paragraphs.length >= 1 && e.paragraphs.every((p) => p.text.length > 40 && p.provenance.length > 10), 'epilogue-sourced: every paragraph needs its provenance');
    assert.ok(e.paragraphs.some((p) => /^Inferred/.test(p.provenance)) && e.paragraphs.some((p) => /research/.test(p.provenance)), 'epilogue-sourced: research and Inferred parts must be labelled');
    assert.ok(e.sources.filter((x) => /^https:\/\//.test(x.url ?? '')).length >= 2, 'epilogue-sourced: the epilogue needs linked sources');
  }],
];

// One mutant per check: each must make that check fail with its own name.
const MUTANTS = {
  'history-blocks': { shipped: (id) => { const p = JSON.parse(readText(`assets/packs/${id}.json`)); if (id === 'stones-river') delete p.phases[3].scenario.history; return p; } },
  'history-validation': { preparePhase: (pack, id) => { const c = structuredClone(pack); for (const p of c.phases) delete p.scenario.history; return preparePhase(c, id); } },
  'casualty-provenance': { shipped: (id) => { const p = JSON.parse(readText(`assets/packs/${id}.json`)); if (id === 'chattanooga') p.phases[1].scenario.history.casualties.CS = 1500; return p; } },
  'packs-built': { build: async (id) => { const out = await buildPack(id); if (id === 'shiloh') delete out.pack.phases[0].scenario.history; return out; } },
  'recorder-bounded': { attachRecorder: (g) => recorder.attachRecorder(g, { maxSamples: 100000 }), validateReplay: (t) => t },
  'recorder-deterministic': { attachRecorder: (g) => { const r = recorder.attachRecorder(g); const s = r.sample.bind(r); r.sample = (game) => { s(game); r.samples.at(-1).t += Math.random() * 1e-3; }; return r; } },
  'recorder-draw-free': { attachRecorder: (g) => { const r = recorder.attachRecorder(g); const o = r.observe.bind(r); r.observe = (game) => { game.rnd(); o(game); }; return r; } },
  'replay-round-trip': { phaseOutcome: (o) => ({ ...phaseOutcome(o), replay: null }) },
  'history-comparison': { historyComparison: (o) => { const c = historyComparison(o); return { ...c, you: { ...c.you, lossesUS: c.you.lossesCS, lossesCS: c.you.lossesUS } }; } },
  'campaign-grade': { campaignGrade: (h, l) => { const g = campaignGrade(h, l); return { ...g, score: g.score === null ? null : g.score + 0.5 }; } },
  'record-book': { buildRecordBook: (s, o) => { const b = buildRecordBook(s, o); for (const x of b.battles) for (const p of x.phases) for (const a of p.attempts) a.replay = false; return b; } },
  'epilogue-sourced': { EPILOGUE: { ...EPILOGUE, paragraphs: EPILOGUE.paragraphs.map((p) => ({ ...p, provenance: '' })) } },
};

async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.stack ?? e}` });
  }
}
export async function historyUnit(api = API) {
  for (const [name, check] of HISTORY_CHECKS) await runCheck(name, check, api);
  return HISTORY_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of HISTORY_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
  }
  const n = HISTORY_CHECKS.length;
  if (failed) { console.log(`HISTORY FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`HISTORY OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of HISTORY_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`HISTORY CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`HISTORY CONTROLS OK (${caught}/${n})`);
  }
}

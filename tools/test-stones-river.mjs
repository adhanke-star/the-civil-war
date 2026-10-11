// CPU check: the Stones River battle pack (assets/packs/stones-river.json, built by tools/build-packs.mjs from
// tools/packs/stones-river.mjs) and its place on the Western campaign ladder (assets/campaign.json, with the `joins`
// that bring Army of the Cumberland formations into the franchise army). `node tools/test-stones-river.mjs` prints
// STONES RIVER OK (n/n); `--prove-fail` also runs one mutant per check and requires each to fail that check's own
// assertion, with the check's name at the start of the failure text. No browser, no GPU, writes nothing.
//
// The headless runs use the real Stones River terrain (assets/terrain/stones-river.json + .bin, decoded as
// loadTerrainData does) and the real Game: every phase runs 120 s of simulation, and each phase runs again until 60 s
// after its first Confederate attack order (src/sim/ai.js roles).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { TerrainData, EXAGGERATION } from '../src/world/terrain.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { setMenPerFigure } from '../src/units/unit.js';
import { preparePhase, prepareFieldScenario, prepareReinforcementTimeline, loadBattlePack, PACK_FIELD_LIMITS } from '../src/sim/phase.js';
import { validateCampaign, newCampaign, campaignPhase, applyCampaign, recordPhase } from '../src/franchise/campaign.js';
import { itemDef, VETERANCY } from '../src/reward/data.js';
import { briefingSources } from '../src/ui/briefing.js';
import { buildPack, serialize, terrainFrame, facingOf, figuresAt, menPerFigureFor, FIGURE_BUDGET } from './build-packs.mjs';
import { PACK as SOURCE } from './packs/stones-river.mjs';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PACK_ID = 'stones-river';
const PHASE_IDS = ['dawn-on-the-right', 'slaughter-pen', 'round-forest', 'mcfaddens-ford'];
const SHILOH_LADDER = [['shiloh', 'camps-at-dawn', true], ['shiloh', 'hornets-nest', true], ['shiloh', 'grants-last-line', true], ['shiloh', 'buell-attacks', false]];
// Shiloh franchise formations (assets/campaign.json) and the Stones River phases the same unit fights in. The ids
// follow the unit (brigade number and core regiments, or battery), not the commander; us-wsmith-brigade has no
// Stones River lineage in the research (its regiments were split between brigades) and stays off the field.
const FRANCHISE_REUSE = [['us-kirk-brigade', ['dawn-on-the-right']], ['us-gibson-brigade', ['dawn-on-the-right']], ['us-rousseau-brigade', ['dawn-on-the-right']],
  ['us-terrill-battery', ['slaughter-pen']], ['us-bartlett-battery', ['slaughter-pen', 'mcfaddens-ford']], ['us-hazen-brigade', ['round-forest']],
  ['us-ammen-brigade', ['round-forest', 'mcfaddens-ford']], ['us-bruce-brigade', ['round-forest', 'mcfaddens-ford']],
  ['us-mendenhall-batteries', ['round-forest', 'mcfaddens-ford']], ['us-boyle-brigade', ['mcfaddens-ford']], ['us-wsmith-brigade', []]];
// Formations that fight in more than one phase must keep one id: [id, phases it appears in].
const RECURRING = [['cs-lpolk-brigade', PHASE_IDS.slice(0, 2)], ['cs-bjohnson-brigade', PHASE_IDS.slice(0, 2)], ['cs-wood-brigade', PHASE_IDS.slice(0, 2)],
  ['cs-preston-brigade', PHASE_IDS.slice(2)], ['cs-palmer-brigade', PHASE_IDS.slice(2)], ['cs-adams-brigade', PHASE_IDS.slice(2)],
  ['us-miller-brigade', ['slaughter-pen', 'mcfaddens-ford']], ['us-stanley-brigade', ['slaughter-pen', 'mcfaddens-ford']],
  ['us-cockerill-battery', PHASE_IDS.slice(2)], ['us-estep-battery', PHASE_IDS.slice(2)]];
// The campaign weapon item for a formation's generic field weapon (sourced exceptions use another rifle-musket).
const GUN_ITEM = { parrott: 'parrott10', napoleon: 'napoleon', smbart: 'sixPdr' };
const RIFLES = ['springfield', 'enfield', 'lorenz', 'belgian'];
const RUN_MIN_S = 120; // simulated seconds every phase runs headless
const AFTER_ATTACK_S = 60; // simulated seconds after a phase's first Confederate attack order
const MOVED_M = 40; // metres an attacking Confederate formation must have moved by then
const RIVER_MARGIN = 60, EDGE_MARGIN = 60; // metres from the Stones River line and the map edge

// ---- harness ------------------------------------------------------------------------------------------------------
const readText = (url) => fs.readFileSync(new URL(url, ROOT), 'utf8');
function loadTerrain(name) {
  const meta = JSON.parse(readText(`assets/terrain/${name}.json`));
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), G = meta.grid;
  assert.equal(q.length, G * G, `${name} heightmap sample count`);
  const heights = new Float32Array(G * G), k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  return new TerrainData(meta, heights);
}
const terrains = new Map();
const terrainOf = (name) => { if (!terrains.has(name)) terrains.set(name, loadTerrain(name)); return terrains.get(name); };
const effects = { volley() {}, boom() {} };
function makeGame(scenario) {
  const terrain = terrainOf(scenario.terrain);
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain, scenario, world: { fenceField: null }, effects });
  game.initializeReinforcements();
  return game;
}
const API = {
  shippedText: () => readText(`assets/packs/${PACK_ID}.json`),
  shipped: () => JSON.parse(readText(`assets/packs/${PACK_ID}.json`)),
  build: () => buildPack(PACK_ID),
  campaign: () => JSON.parse(readText('assets/campaign.json')),
  source: () => SOURCE,
  terrainFrame, facingOf, makeGame,
};
const clockMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const roster = (s) => [...s.units, ...(s.reinforcements || [])];
const phaseOf = (pack, id) => pack.phases.find((p) => p.id === id);
const segDist = ([px, pz], [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const lineDist = (p, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i])); return d; };
const run = async (name, fn) => {
  try { return await fn(); } catch (e) { if (e?.code === 'ERR_ASSERTION') throw e; assert.fail(`${name}: ${e?.message ?? e}`); }
};
/** Run one phase headless for `seconds`; returns the Game and the starting points of its initial formations. */
function runPhase(api, scenario, seconds) {
  const game = api.makeGame(scenario);
  const start = new Map(game.units.map((u) => [u.id, [u.x, u.z]]));
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps && !game.over; i++) { game.tick(0.05); game.animate(0.05); }
  return { game, start };
}
/** The sim second of a phase's first Confederate attack order among its opening formations (null: none). */
function firstAttackSec(s) {
  const at = s.units.filter((u) => u.side === 'CS' && u.ai?.role === 'attack').map((u) => u.ai.at ? (clockMin(u.ai.at) - clockMin(s.start)) * 60 / s.clockRatio : 0);
  return at.length ? Math.min(...at) : null;
}
/** Ladder entries of the campaign with their index, and the index of each Stones River phase. */
const ladderIndex = (def, phaseId) => def.phases.findIndex((p) => p.packId === PACK_ID && p.phaseId === phaseId);
const RUN_STATS = [];

export const STONES_RIVER_CHECKS = [
  ['projection', async (api) => {
    const f = api.terrainFrame(PACK_ID), b = f.meta.bbox;
    // tools/fetch-terrain.mjs wrote the bbox from its own constants: the same constants must reproduce it
    const near = (a, e, what) => assert.ok(Math.abs(a - e) < 1e-9, `projection: ${what} ${a} vs the terrain asset's ${e}`);
    near(f.center.lon - f.half / f.mLon, b.west, 'west edge'); near(f.center.lon + f.half / f.mLon, b.east, 'east edge');
    near(f.center.lat - f.half / f.mLat, b.south, 'south edge'); near(f.center.lat + f.half / f.mLat, b.north, 'north edge');
    const rows = [[0, Math.PI], [90, Math.PI / 2], [180, 0], [270, -Math.PI / 2], [45, 3 * Math.PI / 4]];
    for (const [bearing, want] of rows) {
      const got = api.facingOf(bearing);
      assert.ok(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want))) < 1e-9, `projection: bearing ${bearing} gives facing ${got}, want ${want} (0 = south, pi/2 = east)`);
    }
    // landmark round trips: the Round Forest and McFadden's Ford objectives sit on the projected monument points
    const lm = api.source().landmarks;
    for (const [phase, key] of [['round-forest', 'hazen'], ['mcfaddens-ford', 'artilleryMonument']]) {
      const o = phaseOf(api.shipped(), phase).scenario.objective, [x, z] = f.project(lm[key].lat, lm[key].lon);
      assert.ok(Math.hypot(o.x - x, o.z - z) <= 1, `projection: ${phase} objective at ${o.x},${o.z}, the projected ${key} is ${x.toFixed(1)},${z.toFixed(1)}`);
    }
    // a unit offset: Hazen's brigade 30 m north-west of the monument
    const u = roster(phaseOf(api.shipped(), 'round-forest').scenario).find((v) => v.id === 'us-hazen-brigade'), [hx, hz] = f.project(lm.hazen.lat, lm.hazen.lon);
    const want = [hx + 30 * Math.sin(315 * Math.PI / 180), hz - 30 * Math.cos(315 * Math.PI / 180)];
    assert.ok(Math.hypot(u.x - want[0], u.z - want[1]) <= 1, `projection: Hazen at ${u.x},${u.z}, want 30 m north-west of the monument ${want.map(Math.round)}`);
  }],
  ['pack-fresh', async (api) => {
    const { pack } = await run('pack-fresh', () => api.build());
    const fresh = serialize(pack), shipped = api.shippedText();
    if (fresh !== shipped) {
      const a = fresh.split('\n'), b = shipped.split('\n'), i = a.findIndex((line, k) => line !== b[k]);
      assert.fail(`pack-fresh: assets/packs/${PACK_ID}.json differs from a fresh build at line ${i + 1}: shipped ${JSON.stringify(b[i])}, built ${JSON.stringify(a[i])} (run node tools/build-packs.mjs ${PACK_ID})`);
    }
  }],
  ['phases-validate', async (api) => {
    const pack = api.shipped();
    assert.deepEqual([pack.version, pack.id, pack.phases.map((p) => p.id)], [1, PACK_ID, PHASE_IDS], 'phases-validate: pack identity and phase ladder');
    for (const id of PHASE_IDS) {
      const prepared = await run(`phases-validate ${id}`, () => preparePhase(pack, id));
      await run(`phases-validate ${id}`, () => prepareFieldScenario(prepared.scenario, 'pack'));
      const loaded = await run(`phases-validate ${id}`, () => loadBattlePack({ packId: PACK_ID, phaseId: id, fetcher: async () => new Response(JSON.stringify(pack)) }));
      assert.equal(loaded.scenario.id, `${PACK_ID}-${id}`, `phases-validate: ${id} loads through loadBattlePack`);
      assert.deepEqual([loaded.scenario.terrain, loaded.scenario.season, loaded.scenario.ground?.base], [PACK_ID, 'winter', 'fields'], `phases-validate: ${id} names the Stones River terrain, winter and open ground`);
      assert.ok(loaded.scenario.woods.length >= 5 && loaded.scenario.woods.every((w) => typeof w.name === 'string' && w.polygon.length >= 8), `phases-validate: ${id} draws its named cedar brakes and woods`);
      const plan = await run(`phases-validate ${id}`, () => prepareReinforcementTimeline(pack, id, loaded.scenario));
      assert.ok(plan.events.every((e) => e.atSec >= 0 && e.atSec <= plan.horizon), `phases-validate: ${id} reinforcements inside the phase`);
    }
  }],
  ['on-map', async (api) => {
    const pack = api.shipped(), meta = terrainOf(PACK_ID).meta, lim = meta.halfSize - EDGE_MARGIN;
    const river = meta.streams.find((s) => s.name === 'Stones River').points;
    const inMap = (p, what) => assert.ok(Math.abs(p[0]) <= lim && Math.abs(p[1]) <= lim, `on-map: ${what} at ${p} is outside the map (|x|, |z| <= ${lim})`);
    const dry = (p, what) => {
      const d = lineDist(p, river);
      assert.ok(d >= RIVER_MARGIN, `on-map: ${what} at ${p} is in Stones River (${d.toFixed(0)} m from its line, want ${RIVER_MARGIN})`);
    };
    for (const { id, scenario: s } of pack.phases) {
      for (const u of roster(s)) {
        inMap([u.x, u.z], `${id}/${u.id}`); dry([u.x, u.z], `${id}/${u.id}`);
        for (const p of [...(u.ai?.target ? [u.ai.target] : []), ...(u.ai?.via || [])]) { inMap(p, `${id}/${u.id} AI route`); dry(p, `${id}/${u.id} AI route`); }
      }
      const o = s.objective;
      inMap([o.x - o.r, o.z - o.r], `${id} objective`); inMap([o.x + o.r, o.z + o.r], `${id} objective`); dry([o.x, o.z], `${id} objective centre`);
      for (const [side, p] of Object.entries(s.retreat)) { inMap(p, `${id} ${side} retreat`); dry(p, `${id} ${side} retreat`); }
      inMap(s.camera.target, `${id} camera`);
      for (const w of s.woods) for (const p of w.polygon) inMap(p, `${id} wood ${w.name}`);
    }
  }],
  ['clock-offsets', async (api) => {
    const pack = api.shipped(), src = api.source();
    for (const sp of src.phases) {
      const s = phaseOf(pack, sp.id).scenario, horizon = (clockMin(s.end) - clockMin(s.start)) * 60 / s.clockRatio;
      assert.deepEqual([s.start, s.end, s.clockRatio], [sp.start, sp.end, sp.clockRatio], `clock-offsets: ${sp.id} clock`);
      assert.ok(horizon >= 15 * 60 && horizon <= 21 * 60, `clock-offsets: ${sp.id} plays ${horizon.toFixed(0)} s, want about 15-20 minutes`);
      const arrivals = sp.units.filter((u) => u.arrive);
      assert.equal((s.reinforcements || []).length, arrivals.length, `clock-offsets: ${sp.id} reinforcement count`);
      for (const u of arrivals) {
        const row = s.reinforcements.find((r) => r.id === u.id), want = Math.round((clockMin(u.arrive) - clockMin(sp.start)) * 600 / sp.clockRatio) / 10;
        assert.ok(row && row.atSec === want && row.atSec <= horizon, `clock-offsets: ${sp.id}/${u.id} arrives at ${row?.atSec} s, want ${want} s for ${u.arrive} at 1:${sp.clockRatio}`);
      }
      for (const u of roster(s)) if (u.ai?.at) assert.ok(clockMin(u.ai.at) >= clockMin(s.start) && clockMin(u.ai.at) <= clockMin(s.end), `clock-offsets: ${sp.id}/${u.id} AI time ${u.ai.at}`);
    }
    assert.deepEqual(pack.phases.map((p) => p.scenario.date), ['1862-12-31', '1862-12-31', '1862-12-31', '1863-01-02'], 'clock-offsets: the 31 December phases and 2 January (1 January was a lull and is not a phase)');
  }],
  ['figure-budget', async (api) => {
    for (const { id, scenario: s } of api.shipped().phases) {
      const r = roster(s), figures = figuresAt(r, s.menPerFigure);
      assert.ok(figures <= FIGURE_BUDGET, `figure-budget: ${id} draws ${figures} figures at 1:${s.menPerFigure}, over ${FIGURE_BUDGET}`);
      assert.equal(s.menPerFigure, menPerFigureFor(r), `figure-budget: ${id} 1:${s.menPerFigure} is not the densest ratio within the budget`);
      const men = r.reduce((n, u) => n + u.men, 0), guns = r.reduce((n, u) => n + (u.guns || 0), 0);
      assert.ok(r.length <= PACK_FIELD_LIMITS.formations && men <= PACK_FIELD_LIMITS.men && guns <= PACK_FIELD_LIMITS.guns, `figure-budget: ${id} within the pack route's bounds`);
    }
  }],
  ['unit-metadata', async (api) => {
    for (const { id, scenario: s } of api.shipped().phases) for (const u of roster(s)) {
      const where = `${id}/${u.id}`;
      assert.ok(Array.isArray(u.sources) && u.sources.length > 0 && u.sources.every((x) => typeof x === 'string' && x.trim().length > 10), `unit-metadata: ${where} has no sources`);
      assert.ok(typeof u.status === 'string' && /Verified|Inferred|Disputed|Estimated/.test(u.status), `unit-metadata: ${where} has no provenance status`);
      if (u.commander) assert.ok(typeof u.commander.name === 'string' && u.commander.name.trim() && typeof u.commander.rank === 'string' && u.commander.rank.trim(), `unit-metadata: ${where} has a commander without a rank`);
      assert.ok(Number.isInteger(u.xp) && u.xp >= 1 && u.xp <= VETERANCY.length, `unit-metadata: ${where} xp ${u.xp}`);
      assert.ok(typeof u.name === 'string' && u.name.trim() && typeof u.short === 'string' && u.short.trim() && typeof u.parent === 'string' && Array.isArray(u.regiments), `unit-metadata: ${where} identity fields`);
      assert.ok(u.type === 'artillery' ? Number.isInteger(u.guns) && u.guns > 0 && ['parrott', 'napoleon', 'smbart'].includes(u.weapon) : !('guns' in u) && ['smooth', 'rifled'].includes(u.weapon), `unit-metadata: ${where} guns and weapon`);
      if (u.side === 'US') assert.ok(!u.ai, `unit-metadata: ${where} is a Union formation with an AI role (the player commands every Union formation)`);
    }
  }],
  ['stable-ids', async (api) => {
    const pack = api.shipped(), seen = new Map();
    for (const { id, scenario: s } of pack.phases) {
      const ids = roster(s).map((u) => u.id);
      assert.equal(new Set(ids).size, ids.length, `stable-ids: ${id} repeats a formation id`);
      for (const u of roster(s)) {
        const ident = JSON.stringify([u.side, u.type, u.name, u.short]);
        if (seen.has(u.id)) assert.equal(ident, seen.get(u.id).ident, `stable-ids: ${u.id} changes identity between ${seen.get(u.id).phase} and ${id}`);
        else seen.set(u.id, { ident, phase: id });
      }
    }
    const has = (uid) => PHASE_IDS.filter((p) => roster(phaseOf(pack, p).scenario).some((u) => u.id === uid));
    for (const [uid, phases] of RECURRING) assert.deepEqual(has(uid), phases, `stable-ids: ${uid} must keep its id in ${phases.join(', ')}`);
    for (const [uid, phases] of FRANCHISE_REUSE) assert.deepEqual(has(uid), phases, `stable-ids: the Shiloh franchise unit ${uid} must fight under its own id in ${phases.join(', ') || 'no phase'}`);
  }],
  ['franchise-joins', async (api) => {
    const pack = api.shipped(), def = await run('franchise-joins', () => validateCampaign(api.campaign()));
    const known = new Set(def.franchise.map((r) => r.unitId));
    for (const id of PHASE_IDS) {
      const at = ladderIndex(def, id), entry = def.phases[at], s = phaseOf(pack, id).scenario, us = roster(s).filter((u) => u.side === 'US');
      assert.ok(at >= 0, `franchise-joins: ${id} is not on the campaign ladder`);
      for (const r of entry.joins || []) {
        const u = us.find((v) => v.id === r.unitId);
        assert.ok(u, `franchise-joins: ${r.unitId} joins at ${id} but is not a Union formation there`);
        assert.ok(!known.has(r.unitId), `franchise-joins: ${r.unitId} joins at ${id} but is already in the army`);
        assert.equal(r.kind, u.type === 'artillery' ? 'battery' : 'infantry', `franchise-joins: ${r.unitId} kind`);
        assert.deepEqual([r.men, r.guns ?? 0], [u.men, u.guns ?? 0], `franchise-joins: ${r.unitId} men and guns equal its strength at ${id}`);
        assert.ok(u.type === 'artillery' ? r.weapon === GUN_ITEM[u.weapon] : u.weapon === 'smooth' ? r.weapon === 'm1842' : RIFLES.includes(r.weapon), `franchise-joins: ${r.unitId} weapon item ${r.weapon} does not match its ${u.weapon} arm`);
        assert.equal(itemDef(r.weapon).arm, r.kind === 'battery' ? 'artillery' : 'infantry', `franchise-joins: ${r.unitId} weapon arm`);
        assert.equal(VETERANCY.findIndex((v) => v.id === r.vet) + 1, u.xp, `franchise-joins: ${r.unitId} veterancy matches its xp at ${id}`);
        known.add(r.unitId);
      }
      // every Union formation of the phase is in the franchise or joined at this phase or an earlier one
      for (const u of us) assert.ok(known.has(u.id), `franchise-joins: ${id}/${u.id} is not in the franchise or an earlier join`);
    }
  }],
  ['briefings', async (api) => {
    for (const { id, scenario: s } of api.shipped().phases) {
      const b = s.briefing;
      assert.ok(Array.isArray(b?.text) && b.text.length >= 3 && b.text.length <= 5 && b.text.every((t) => typeof t === 'string' && t.trim().length > 20), `briefings: ${id} needs 3-5 briefing sentences`);
      assert.ok(Array.isArray(b.sources) && b.sources.length > 0 && briefingSources(b.sources).length === b.sources.length, `briefings: ${id} sources must all be http(s) links`);
      if (b.quote) assert.ok(b.quote.text && b.quote.who && b.quote.source, `briefings: ${id} quote needs text, who and source`);
      assert.ok(typeof s.historyNote === 'string' && s.historyNote.trim().length > 40, `briefings: ${id} needs a history note`);
      assert.ok(!/\b(gallant|glorious|noble cause|lost cause|war of northern aggression|states'? rights)\b/i.test(JSON.stringify([b, s.historyNote, s.victory])), `briefings: ${id} uses romanticising or Lost Cause wording`);
    }
    const first = api.shipped().phases[0].scenario.briefing.text.join(' ');
    assert.match(first, /slavery|enslaved/, 'briefings: the first phase must say plainly what the Confederacy fought for (slavery)');
  }],
  ['campaign', async (api) => {
    const raw = api.campaign(), pack = api.shipped();
    const def = await run('campaign', () => validateCampaign(raw));
    assert.deepEqual(def.phases.slice(0, SHILOH_LADDER.length + PHASE_IDS.length).map((p) => [p.packId, p.phaseId, p.loan === true]), [...SHILOH_LADDER, ...PHASE_IDS.map((id) => [PACK_ID, id, false])],
      'campaign: the ladder is Shiloh then the four Stones River phases, none on loan');
    assert.equal(def.franchise.length, 11, 'campaign: the Shiloh franchise roster is unchanged');
    // play the ladder with empty results: each first arrival at a Stones River phase enlists its joins, and every
    // Union formation then takes the field with franchise equipment
    let save = newCampaign({ campaign: raw, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
    const record = (s) => { const p = campaignPhase(s, raw); return recordPhase(s, raw, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade: 'Victory', units: [], loot: [] }); };
    for (let i = 0; i < SHILOH_LADDER.length; i++) save = record(save);
    for (const id of PHASE_IDS) {
      const phase = campaignPhase(save, raw);
      assert.deepEqual([phase.packId, phase.phaseId, phase.loan], [PACK_ID, id, false], `campaign: the ladder reaches ${id}`);
      const joins = def.phases[ladderIndex(def, id)].joins || [];
      for (const r of joins) assert.equal(save.army.filter((b) => b.unitId === r.unitId).length, 1, `campaign: ${r.unitId} is not enlisted once on reaching ${id}`);
      const field = await run('campaign', () => prepareFieldScenario(applyCampaign(phaseOf(pack, id).scenario, save, phase), 'pack'));
      for (const u of roster(field).filter((v) => v.side === 'US')) assert.ok(u.equipment, `campaign: ${id}/${u.id} takes the field without franchise equipment`);
      save = record(save);
    }
    // Recording the last Stones River phase also enlists the next phase's joins (a later battle's first phase).
    assert.equal(save.army.length, def.franchise.length + def.phases.slice(0, SHILOH_LADDER.length + PHASE_IDS.length + 1).reduce((n, p) => n + (p.joins?.length || 0), 0), 'campaign: the army after Stones River is the franchise plus every join reached, once');
  }],
  ['headless-run', async (api) => {
    for (const { id, scenario } of api.shipped().phases) {
      const s = await run(`headless-run ${id}`, () => prepareFieldScenario(scenario, 'pack'));
      const cpu0 = process.cpuUsage();
      const { game } = await run(`headless-run ${id}`, () => runPhase(api, s, RUN_MIN_S));
      const cpu = process.cpuUsage(cpu0);
      assert.ok(game.simTime >= Math.min(RUN_MIN_S, (clockMin(s.end) - clockMin(s.start)) * 60 / s.clockRatio) - 1e-6 || game.over, `headless-run: ${id} advanced only ${game.simTime} s`);
      assert.ok(game.units.every((u) => Number.isFinite(u.x) && Number.isFinite(u.z) && Number.isFinite(u.men) && u.men >= 0), `headless-run: ${id} a formation went non-finite`);
      RUN_STATS.push({ phase: id, simS: Math.round(game.simTime), cpuS: Number(((cpu.user + cpu.system) / 1e6).toFixed(1)), units: game.units.length, figures: game.figureCount(), clock: game.clockText().time });
    }
  }],
  ['ai-active', async (api) => {
    const phases = api.shipped().phases.filter((p) => p.scenario.attacker === 'CS');
    assert.deepEqual(phases.map((p) => p.id), PHASE_IDS, 'ai-active: the Confederates attack in every Stones River phase');
    const order = phases.map((p) => ({ p, first: firstAttackSec(p.scenario) })).sort((a, b) => (a.first ?? 0) - (b.first ?? 0));
    for (const { p, first } of order) {
      assert.ok(first !== null, `ai-active: ${p.id} has no Confederate attack role among its opening formations`);
      const s = prepareFieldScenario(p.scenario, 'pack');
      const { game, start } = runPhase(api, s, first + AFTER_ATTACK_S);
      const attackers = game.units.filter((u) => u.side === 'CS' && u.def.ai?.role === 'attack' && start.has(u.id));
      const moved = attackers.map((u) => [u.id, Math.hypot(u.x - start.get(u.id)[0], u.z - start.get(u.id)[1])]);
      assert.ok(moved.some(([, d]) => d >= MOVED_M), `ai-active: ${p.id} no Confederate attacker moved ${MOVED_M} m by ${AFTER_ATTACK_S} s after its order (${JSON.stringify(moved.map(([u, d]) => [u, Math.round(d)]))})`);
    }
  }],
];

// ---- one semantic mutant per check -----------------------------------------------------------------------------
const edit = (fn) => () => { const p = API.shipped(); fn(p); return p; };
const unit = (p, phase, id) => roster(phaseOf(p, phase).scenario).find((u) => u.id === id);
const MUTANTS = {
  // the build reads compass bearings as engine facings
  projection: { facingOf: (b) => b * Math.PI / 180 },
  // a hand edit to the generated file: Kirk's strength changed without a rebuild
  'pack-fresh': { shippedText: () => API.shippedText().replace('"men": 2079,', '"men": 2080,') },
  // a tree spacing outside the ground contract (13-30 m)
  'phases-validate': { shipped: edit((p) => { p.phases[1].scenario.ground.treeSpacing = 31; }) },
  // the single gun of the Kentucky battery drawn in the river at the ford
  'on-map': { shipped: edit((p) => { const u = unit(p, 'mcfaddens-ford', 'us-ellsworth-battery'); u.x = 1098; u.z = -1811; }) },
  // reinforcement times computed at the default 1:4 clock instead of the phase's own ratio
  'clock-offsets': { shipped: edit((p) => { for (const ph of p.phases) for (const r of ph.scenario.reinforcements || []) r.atSec = Math.round(r.atSec * ph.scenario.clockRatio / 4 * 10) / 10; }) },
  // the densest ratio, ignoring the figure budget
  'figure-budget': { shipped: edit((p) => { for (const ph of p.phases) ph.scenario.menPerFigure = 5; }) },
  // a commander shown without his rank
  'unit-metadata': { shipped: edit((p) => { delete unit(p, 'round-forest', 'us-hazen-brigade').commander.rank; }) },
  // a commander-named id for Hazen's brigade (the franchise follows the unit, so this breaks the Shiloh lineage)
  'stable-ids': { shipped: edit((p) => { unit(p, 'round-forest', 'us-hazen-brigade').id = 'us-hazen-19th-brigade'; }) },
  // Post's brigade dropped from the dawn phase's joins: it would fight outside the franchise
  'franchise-joins': { campaign: () => { const c = API.campaign(); const e = c.phases.find((p) => p.phaseId === 'dawn-on-the-right'); e.joins = e.joins.filter((r) => r.unitId !== 'us-post-brigade'); return c; } },
  // the first briefing without the sentence on what the Confederacy fought for
  briefings: { shipped: edit((p) => { const b = p.phases[0].scenario.briefing; b.text = b.text.filter((t) => !/slavery/.test(t)); }) },
  // the Round Forest put before the Slaughter Pen on the ladder
  campaign: { campaign: () => { const c = API.campaign(); const i = c.phases.findIndex((p) => p.phaseId === 'slaughter-pen'); [c.phases[i], c.phases[i + 1]] = [c.phases[i + 1], c.phases[i]]; return c; } },
  // a pack that names terrain the game does not ship
  'headless-run': { shipped: edit((p) => { p.phases[0].scenario.terrain = 'stones-rver'; }) },
  // a pack built without AI roles: the Confederates never move
  'ai-active': { shipped: edit((p) => { for (const ph of p.phases) for (const u of roster(ph.scenario)) delete u.ai; }) },
};

const reset = () => { settings.set('look.menPerFigure', 10); setMenPerFigure(10, 5); };
export async function stonesRiverUnit(api = API) {
  try { for (const [, check] of STONES_RIVER_CHECKS) await check(api); } finally { reset(); }
  return STONES_RIVER_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await stonesRiverUnit();
  for (const r of RUN_STATS) console.log(`STONES RIVER RUN ${r.phase}: ${r.simS} s sim to ${r.clock}, CPU ${r.cpuS} s, ${r.units} formations, ${r.figures} living figures`);
  console.log(`STONES RIVER OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of STONES_RIVER_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; } finally { reset(); }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`STONES RIVER CONTROLS OK (${rows.length}/${count})`);
  }
}

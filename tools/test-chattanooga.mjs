// CPU check: the Chattanooga battle pack (assets/packs/chattanooga.json, built by tools/build-packs.mjs from
// tools/packs/chattanooga.mjs) and its place on the Western campaign ladder (assets/campaign.json, with the `joins`
// that bring new brigades and batteries into the franchise army). `node tools/test-chattanooga.mjs` prints
// CHATTANOOGA OK (n/n); `--prove-fail` also runs one mutant per check and requires each to fail that check's own
// assertion, with the check's name at the start of the failure text. No browser, no GPU, writes nothing.
//
// The pack fights on two terrain assets: Orchard Knob and Missionary Ridge on assets/terrain/chattanooga.json, Lookout
// Mountain on assets/terrain/lookout-mountain.json. The headless runs decode each phase's own terrain (as
// loadTerrainData does) and use the real Game: every phase runs 120 s of simulation, and Lookout Mountain runs again
// until 60 s after Moore's brigade (the one Confederate reserve) is due to counterattack.
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
import { PACK as SOURCE } from './packs/chattanooga.mjs';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PACK_ID = 'chattanooga';
const PHASE_IDS = ['orchard-knob', 'lookout-mountain', 'missionary-ridge'];
// Each phase fights on its own terrain asset.
const TERRAINS = { 'orchard-knob': 'chattanooga', 'lookout-mountain': 'lookout-mountain', 'missionary-ridge': 'chattanooga' };
// Franchise formations (the Shiloh franchise or a Stones River join, assets/campaign.json) and the Chattanooga phases the
// same unit fights in. Ids follow the unit (brigade number and core regiments, or battery), not the commander; the
// brigades merged into another in the October 1863 reorganisation (Baldwin's into Hazen's, Fyffe's into Beatty's,
// Hascall's into Wagner's, Schaefer's into F. T. Sherman's) and those with no Chattanooga lineage stay off the field.
const FRANCHISE_REUSE = [['us-hazen-brigade', ['orchard-knob', 'missionary-ridge']], ['us-gibson-brigade', ['orchard-knob', 'missionary-ridge']],
  ['us-boyle-brigade', ['orchard-knob', 'missionary-ridge']], ['us-wagner-brigade', ['orchard-knob', 'missionary-ridge']],
  ['us-roberts-brigade', ['orchard-knob', 'missionary-ridge']], ['us-greusel-brigade', ['missionary-ridge']],
  ['us-price-brigade', ['lookout-mountain']], ['us-ammen-brigade', ['lookout-mountain']],
  ['us-rousseau-brigade', []], ['us-fyffe-brigade', []], ['us-hascall-brigade', []], ['us-schaefer-brigade', []], ['us-bruce-brigade', []], ['us-carlin-brigade', []]];
// The campaign weapon items a formation's generic field weapon may map to (sourced exceptions use another rifle-musket).
const GUN_ITEMS = { parrott: ['parrott10', 'ordnance3'], napoleon: ['napoleon'], smbart: ['sixPdr'] };
const RIFLES = ['springfield', 'enfield', 'lorenz', 'belgian'];
const RUN_MIN_S = 120; // simulated seconds every phase runs headless
const AFTER_RESERVE_S = 60; // simulated seconds after Moore's reserve is due
const MOVED_M = 40; // metres the reserve must have moved by then
const STREAM_MARGIN = 60, EDGE_MARGIN = 60; // metres from any terrain stream line and from the map edge
const BENCH_BELOW_SUMMIT_M = 100; // real metres the Lookout objective sits below the summit, at least
const BENCH_ABOVE_CREEK_M = 150; // ... and above Lookout Creek's valley floor (the terrain minimum), at least

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
/** Real ground height in metres above sea level (the drawn terrain is exaggerated). */
const elevation = (t, x, z) => t.heightAt(x, z) / EXAGGERATION + t.meta.heights.minM;
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
  terrainAsset: (name) => JSON.parse(readText(`assets/terrain/${name}.json`)),
  terrainFrame, facingOf, makeGame, terrainOf,
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
const ladderIndex = (def, phaseId) => def.phases.findIndex((p) => p.packId === PACK_ID && p.phaseId === phaseId);
const RUN_STATS = [];

export const CHATTANOOGA_CHECKS = [
  ['projection', async (api) => {
    // each terrain's frame must be that asset's own, and reproduce the bbox fetch-terrain wrote from the same constants
    for (const name of new Set(Object.values(TERRAINS))) {
      const f = api.terrainFrame(name), asset = api.terrainAsset(name), b = asset.bbox;
      assert.deepEqual([f.center.lat, f.center.lon, f.half], [asset.center.lat, asset.center.lon, asset.halfSize], `projection: the ${name} frame is not centred on the ${name} terrain asset`);
      const near = (a, e, what) => assert.ok(Math.abs(a - e) < 1e-9, `projection: ${name} ${what} ${a} vs the terrain asset's ${e}`);
      near(f.center.lon - f.half / f.mLon, b.west, 'west edge'); near(f.center.lon + f.half / f.mLon, b.east, 'east edge');
      near(f.center.lat - f.half / f.mLat, b.south, 'south edge'); near(f.center.lat + f.half / f.mLat, b.north, 'north edge');
    }
    const rows = [[0, Math.PI], [90, Math.PI / 2], [180, 0], [270, -Math.PI / 2], [45, 3 * Math.PI / 4]];
    for (const [bearing, want] of rows) {
      const got = api.facingOf(bearing);
      assert.ok(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want))) < 1e-9, `projection: bearing ${bearing} gives facing ${got}, want ${want} (0 = south, pi/2 = east)`);
    }
    // landmark round trips, each in its own phase's frame: the Lookout objective 60 m north-east of the Cravens house,
    // the Howell section 25 m west of it, Tucker 40 m from the Bird's Mill Road crest point
    const lm = api.source().landmarks, pack = api.shipped();
    const L = api.terrainFrame(TERRAINS['lookout-mountain']), C = api.terrainFrame(TERRAINS['missionary-ridge']);
    const offset = (u, [bx, bz], bearing, m, what) => {
      const want = [bx + m * Math.sin(bearing * Math.PI / 180), bz - m * Math.cos(bearing * Math.PI / 180)];
      assert.ok(Math.hypot(u.x - want[0], u.z - want[1]) <= 1, `projection: ${what} at ${u.x},${u.z}, want ${want.map(Math.round)}`);
    };
    const o = phaseOf(pack, 'lookout-mountain').scenario.objective, [cx, cz] = L.project(lm.cravens.lat, lm.cravens.lon);
    offset(o, [cx, cz], 45, 60, 'the lookout-mountain objective 60 m north-east of the Cravens house (Lookout frame)');
    const [ox, oz] = C.project(lm.cravens.lat, lm.cravens.lon);
    assert.ok(Math.hypot(o.x - ox, o.z - oz) > 1000, 'projection: the Lookout phase must not be projected about the Chattanooga terrain centre');
    offset(roster(phaseOf(pack, 'lookout-mountain').scenario).find((u) => u.id === 'cs-howell-section'), [cx, cz], 270, 25, 'the Howell section 25 m west of the Cravens house');
    offset(roster(phaseOf(pack, 'missionary-ridge').scenario).find((u) => u.id === 'cs-tucker-brigade'), C.project(lm.birdsMillCrest.lat, lm.birdsMillCrest.lon), 339, 40, 'Tucker 40 m from the Bird\'s Mill Road crest');
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
      const s = loaded.scenario, lookout = TERRAINS[id] === 'lookout-mountain';
      assert.equal(s.id, `${PACK_ID}-${id}`, `phases-validate: ${id} loads through loadBattlePack`);
      assert.deepEqual([s.season, s.ground?.base], ['autumn', lookout ? 'woods' : 'fields'], `phases-validate: ${id} is autumn on ${lookout ? 'a wooded mountainside' : 'open valley ground'}`);
      if (lookout) {
        assert.ok(s.ground.clearings.length >= 2 && s.woods.length === 0 && s.sites.some((x) => x.id === 'cravens-house'), `phases-validate: ${id} clears the Cravens farm and draws the house`);
      } else {
        assert.ok(s.woods.length >= 3 && s.woods.every((w) => typeof w.name === 'string' && w.polygon.length >= 8) && s.sites.length === 0, `phases-validate: ${id} draws its named woods and no Lookout site`);
      }
      const plan = await run(`phases-validate ${id}`, () => prepareReinforcementTimeline(pack, id, s));
      assert.ok(plan.events.every((e) => e.atSec >= 0 && e.atSec <= plan.horizon), `phases-validate: ${id} reinforcements inside the phase`);
    }
  }],
  ['own-terrain', async (api) => {
    // every phase names its own terrain asset, which loads, and everything the phase draws lies on that terrain
    const pack = api.shipped(), src = api.source();
    for (const { id, scenario: s } of pack.phases) {
      assert.equal(s.terrain, TERRAINS[id], `own-terrain: ${id} names terrain ${s.terrain}, want ${TERRAINS[id]}`);
      const t = await run(`own-terrain ${id}`, () => terrainOf(s.terrain)), meta = t.meta;
      assert.equal(s.terrain, src.phases.find((p) => p.id === id).terrain, `own-terrain: ${id} terrain differs from its curated source`);
      // the landmarks a phase is placed from lie inside that terrain's bbox (the Cravens house is not on the Chattanooga map)
      const keys = new Set(JSON.stringify(src.phases.find((p) => p.id === id)).match(/"near":"[A-Za-z]+"/g).map((k) => k.slice(8, -1)));
      for (const k of keys) {
        const { lat, lon } = src.landmarks[k], b = meta.bbox;
        assert.ok(lat > b.south && lat < b.north && lon > b.west && lon < b.east, `own-terrain: ${id} places units from ${k}, which is off the ${s.terrain} terrain`);
      }
    }
  }],
  ['on-map', async (api) => {
    for (const { id, scenario: s } of api.shipped().phases) {
      const meta = terrainOf(s.terrain).meta, lim = meta.halfSize - EDGE_MARGIN;
      const inMap = (p, what) => assert.ok(Math.abs(p[0]) <= lim && Math.abs(p[1]) <= lim, `on-map: ${what} at ${p} is outside the ${s.terrain} map (|x|, |z| <= ${lim})`);
      const dry = (p, what) => {
        for (const st of meta.streams) {
          const d = lineDist(p, st.points);
          assert.ok(d >= STREAM_MARGIN, `on-map: ${what} at ${p} is in ${st.name} (${d.toFixed(0)} m from its line, want ${STREAM_MARGIN})`);
        }
      };
      for (const u of roster(s)) {
        inMap([u.x, u.z], `${id}/${u.id}`); dry([u.x, u.z], `${id}/${u.id}`);
        for (const p of [...(u.ai?.target ? [u.ai.target] : []), ...(u.ai?.via || [])]) { inMap(p, `${id}/${u.id} AI route`); dry(p, `${id}/${u.id} AI route`); }
      }
      const o = s.objective;
      inMap([o.x - o.r, o.z - o.r], `${id} objective`); inMap([o.x + o.r, o.z + o.r], `${id} objective`); dry([o.x, o.z], `${id} objective centre`);
      for (const [side, p] of Object.entries(s.retreat)) { inMap(p, `${id} ${side} retreat`); dry(p, `${id} ${side} retreat`); }
      inMap(s.camera.target, `${id} camera`);
      for (const w of [...s.woods, ...(s.ground.clearings || [])]) for (const p of w.polygon) inMap(p, `${id} ground ${w.name}`);
      for (const x of [...s.sites, ...s.labels]) inMap([x.x, x.z], `${id} ${x.name ?? x.text}`);
    }
  }],
  ['objectives', async (api) => {
    const pack = api.shipped(), lm = api.source().landmarks;
    // Lookout: the Cravens House bench, below the summit (Hooker's men never stormed it) and well above the creek
    {
      const s = phaseOf(pack, 'lookout-mountain').scenario, t = terrainOf(s.terrain), o = s.objective;
      const summit = t.meta.heights.maxM, floor = t.meta.heights.minM, h = elevation(t, o.x, o.z);
      assert.ok(h <= summit - BENCH_BELOW_SUMMIT_M, `objectives: the Lookout objective stands at ${h.toFixed(0)} m, not ${BENCH_BELOW_SUMMIT_M} m below the ${summit.toFixed(0)} m summit (the bench, not the summit)`);
      assert.ok(h >= floor + BENCH_ABOVE_CREEK_M, `objectives: the Lookout objective stands at ${h.toFixed(0)} m, not on the bench ${BENCH_ABOVE_CREEK_M} m above the creek`);
      let top = -Infinity;
      for (let k = 0; k < 64; k++) for (const f of [0.5, 1]) top = Math.max(top, elevation(t, o.x + o.r * f * Math.cos(k / 10), o.z + o.r * f * Math.sin(k / 10)));
      assert.ok(top <= summit - 50, `objectives: the Lookout objective circle climbs to ${top.toFixed(0)} m, onto the summit`);
    }
    // Missionary Ridge: on the crest (well above the rifle pits at the foot), reaching the Bird's Mill Road break
    {
      const s = phaseOf(pack, 'missionary-ridge').scenario, t = terrainOf(s.terrain), o = s.objective, F = api.terrainFrame(s.terrain);
      const h = elevation(t, o.x, o.z), [bx, bz] = F.project(lm.birdsMillCrest.lat, lm.birdsMillCrest.lon);
      assert.ok(h >= t.meta.heights.minM + 90, `objectives: the Missionary Ridge objective stands at ${h.toFixed(0)} m, not on the crest`);
      assert.ok(Math.hypot(o.x - bx, o.z - bz) <= o.r, 'objectives: the Missionary Ridge objective must hold the Bird\'s Mill Road break');
    }
    // Orchard Knob: the circle holds the knob's summit
    {
      const s = phaseOf(pack, 'orchard-knob').scenario, o = s.objective, F = api.terrainFrame(s.terrain), [kx, kz] = F.project(lm.orchardKnob.lat, lm.orchardKnob.lon);
      assert.ok(Math.hypot(o.x - kx, o.z - kz) <= o.r / 2, 'objectives: the Orchard Knob objective must hold the knob');
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
    assert.deepEqual(pack.phases.map((p) => p.scenario.date), ['1863-11-23', '1863-11-24', '1863-11-25'], 'clock-offsets: 23, 24 and 25 November 1863');
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
    // the frozen old repo's fabrications stay out: no Maney at Orchard Knob, no abstraction units, no gun pools
    const all = JSON.stringify(api.shipped().phases.map((p) => roster(p.scenario).map((u) => [u.id, u.name, u.commander?.name])));
    assert.ok(!/maney|reserve line|supports|gun pool|rifle-pit line/i.test(all), 'unit-metadata: a flagged old-repo unit or leader (Maney at Orchard Knob, an abstraction unit, a gun pool) is in the pack');
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
    for (const [uid, phases] of FRANCHISE_REUSE) assert.deepEqual(has(uid), phases, `stable-ids: the franchise unit ${uid} must fight under its own id in ${phases.join(', ') || 'no phase'}`);
  }],
  ['franchise-joins', async (api) => {
    const pack = api.shipped(), def = await run('franchise-joins', () => validateCampaign(api.campaign()));
    const first = ladderIndex(def, PHASE_IDS[0]);
    assert.ok(first > 0, 'franchise-joins: Chattanooga is not on the campaign ladder');
    const known = new Set([...def.franchise.map((r) => r.unitId), ...def.phases.slice(0, first).flatMap((p) => (p.joins || []).map((r) => r.unitId))]);
    for (const id of PHASE_IDS) {
      const at = ladderIndex(def, id), entry = def.phases[at], s = phaseOf(pack, id).scenario, us = roster(s).filter((u) => u.side === 'US');
      assert.ok(at >= 0, `franchise-joins: ${id} is not on the campaign ladder`);
      for (const r of entry.joins || []) {
        const u = us.find((v) => v.id === r.unitId);
        assert.ok(u, `franchise-joins: ${r.unitId} joins at ${id} but is not a Union formation there`);
        assert.ok(!known.has(r.unitId), `franchise-joins: ${r.unitId} joins at ${id} but is already in the army`);
        assert.equal(r.kind, u.type === 'artillery' ? 'battery' : 'infantry', `franchise-joins: ${r.unitId} kind`);
        assert.deepEqual([r.men, r.guns ?? 0], [u.men, u.guns ?? 0], `franchise-joins: ${r.unitId} men and guns equal its strength at ${id}`);
        assert.ok(u.type === 'artillery' ? GUN_ITEMS[u.weapon].includes(r.weapon) : u.weapon === 'smooth' ? r.weapon === 'm1842' : RIFLES.includes(r.weapon), `franchise-joins: ${r.unitId} weapon item ${r.weapon} does not match its ${u.weapon} arm`);
        assert.equal(itemDef(r.weapon).arm, r.kind === 'battery' ? 'artillery' : 'infantry', `franchise-joins: ${r.unitId} weapon arm`);
        assert.equal(VETERANCY.findIndex((v) => v.id === r.vet) + 1, u.xp, `franchise-joins: ${r.unitId} veterancy matches its xp at ${id}`);
        known.add(r.unitId);
      }
      // every Union formation of the phase is in the franchise or joined at this phase or an earlier one
      for (const u of us) assert.ok(known.has(u.id), `franchise-joins: ${id}/${u.id} is not in the franchise or an earlier join`);
    }
  }],
  ['briefings', async (api) => {
    const pack = api.shipped();
    for (const { id, scenario: s } of pack.phases) {
      const b = s.briefing;
      assert.ok(Array.isArray(b?.text) && b.text.length >= 3 && b.text.length <= 5 && b.text.every((t) => typeof t === 'string' && t.trim().length > 20), `briefings: ${id} needs 3-5 briefing sentences`);
      assert.ok(Array.isArray(b.sources) && b.sources.length > 0 && briefingSources(b.sources).length === b.sources.length, `briefings: ${id} sources must all be http(s) links`);
      if (b.quote) assert.ok(b.quote.text && b.quote.who && b.quote.source, `briefings: ${id} quote needs text, who and source`);
      assert.ok(typeof s.historyNote === 'string' && s.historyNote.trim().length > 40, `briefings: ${id} needs a history note`);
      assert.ok(!/\b(gallant|glorious|noble cause|lost cause|war of northern aggression|states'? rights)\b/i.test(JSON.stringify([b, s.historyNote, s.victory])), `briefings: ${id} uses romanticising or Lost Cause wording`);
    }
    const text = (id) => phaseOf(pack, id).scenario.briefing.text.join(' ');
    assert.match(text('orchard-knob'), /slavery|enslaved/, 'briefings: the first phase must say plainly what the Confederacy fought for (slavery)');
    assert.match(text('orchard-knob'), /Cracker Line/, 'briefings: the first phase must name Grant\'s Cracker Line');
    assert.match(text('orchard-knob'), /starv/, 'briefings: the first phase must say the besieged army had been starving');
    assert.match(text('lookout-mountain'), /summit/, 'briefings: Lookout Mountain must say the fight was not for the summit');
    assert.match(text('missionary-ridge'), /rifle pits/, 'briefings: Missionary Ridge must say the order was the rifle pits');
  }],
  ['campaign', async (api) => {
    const raw = api.campaign(), pack = api.shipped();
    const def = await run('campaign', () => validateCampaign(raw));
    const at = ladderIndex(def, PHASE_IDS[0]);
    assert.deepEqual(def.phases.slice(at - 1).map((p) => [p.packId, p.phaseId, p.loan === true]),
      [['stones-river', 'mcfaddens-ford', false], ...PHASE_IDS.map((id) => [PACK_ID, id, false])], 'campaign: the three Chattanooga phases follow Stones River in order, none on loan');
    assert.equal(at + PHASE_IDS.length, def.phases.length, 'campaign: Chattanooga ends the ladder');
    // play the ladder with empty results: each first arrival at a Chattanooga phase enlists its joins, and every
    // Union formation then takes the field with franchise equipment
    let save = newCampaign({ campaign: raw, slot: 1, seed: 1863, at: '2026-10-11T12:00:00Z' });
    const record = (s) => { const p = campaignPhase(s, raw); return recordPhase(s, raw, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade: 'Victory', units: [], loot: [] }); };
    for (let i = 0; i < at; i++) save = record(save);
    for (const id of PHASE_IDS) {
      const phase = campaignPhase(save, raw);
      assert.deepEqual([phase.packId, phase.phaseId, phase.loan], [PACK_ID, id, false], `campaign: the ladder reaches ${id}`);
      for (const r of def.phases[ladderIndex(def, id)].joins || []) assert.equal(save.army.filter((b) => b.unitId === r.unitId).length, 1, `campaign: ${r.unitId} is not enlisted once on reaching ${id}`);
      const field = await run('campaign', () => prepareFieldScenario(applyCampaign(phaseOf(pack, id).scenario, save, phase), 'pack'));
      for (const u of roster(field).filter((v) => v.side === 'US')) assert.ok(u.equipment, `campaign: ${id}/${u.id} takes the field without franchise equipment`);
      save = record(save);
    }
    assert.equal(save.campaign.status, 'complete', 'campaign: the ladder completes after Missionary Ridge');
    assert.equal(save.army.length, def.franchise.length + def.phases.reduce((n, p) => n + (p.joins?.length || 0), 0), 'campaign: the finished ladder\'s army is the franchise plus every join, once');
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
    const pack = api.shipped();
    for (const { id, scenario: s } of pack.phases) {
      assert.equal(s.attacker, 'US', `ai-active: the Union attacks in ${id}`);
      assert.ok(roster(s).filter((u) => u.side === 'CS').every((u) => !u.ai || u.ai.role !== 'attack'), `ai-active: ${id} has a Confederate attack role (the Confederates defend)`);
    }
    // Moore's counterattack on Lookout (about 13:00): the one Confederate reserve, which must move once it is due
    const p = phaseOf(pack, 'lookout-mountain'), reserves = p.scenario.units.filter((u) => u.side === 'CS' && u.ai?.role === 'reserve' && u.ai.at);
    assert.deepEqual(reserves.map((u) => u.id), ['cs-moore-brigade'], 'ai-active: lookout-mountain has no Confederate reserve (Moore\'s counterattack)');
    const s = prepareFieldScenario(p.scenario, 'pack'), due = (clockMin(reserves[0].ai.at) - clockMin(s.start)) * 60 / s.clockRatio;
    const { game, start } = runPhase(api, s, due + AFTER_RESERVE_S);
    const moore = game.units.find((u) => u.id === 'cs-moore-brigade'), moved = Math.hypot(moore.x - start.get(moore.id)[0], moore.z - start.get(moore.id)[1]);
    assert.ok(moved >= MOVED_M, `ai-active: Moore's reserve moved only ${Math.round(moved)} m by ${AFTER_RESERVE_S} s after ${reserves[0].ai.at}`);
  }],
];

// ---- one semantic mutant per check -----------------------------------------------------------------------------
const edit = (fn) => () => { const p = API.shipped(); fn(p); return p; };
const unit = (p, phase, id) => roster(phaseOf(p, phase).scenario).find((u) => u.id === id);
const MUTANTS = {
  // a build that projects every phase about the Chattanooga terrain centre (the Lookout phase lands 6 km away)
  projection: { terrainFrame: () => terrainFrame('chattanooga') },
  // a hand edit to the generated file: Hazen's Orchard Knob strength changed without a rebuild
  'pack-fresh': { shippedText: () => API.shippedText().replace('"men": 2256,', '"men": 2257,') },
  // a tree spacing outside the ground contract (13-30 m)
  'phases-validate': { shipped: edit((p) => { p.phases[1].scenario.ground.treeSpacing = 31; }) },
  // the Lookout phase drawn on the Chattanooga terrain
  'own-terrain': { shipped: edit((p) => { p.phases[1].scenario.terrain = 'chattanooga'; }) },
  // Sahm's battery drawn in Lookout Creek at the railroad bridge
  'on-map': { shipped: edit((p) => { const u = unit(p, 'lookout-mountain', 'us-sahm-battery'); u.x = -509; u.z = -1112; }) },
  // the Lookout objective moved up to Point Park on the summit
  objectives: { shipped: edit((p) => { const o = p.phases[1].scenario.objective; o.x = -374; o.z = 510; }) },
  // reinforcement times computed at the default 1:4 clock instead of the phase's own ratio
  'clock-offsets': { shipped: edit((p) => { for (const ph of p.phases) for (const r of ph.scenario.reinforcements || []) r.atSec = Math.round(r.atSec * ph.scenario.clockRatio / 4 * 10) / 10; }) },
  // the densest ratio, ignoring the figure budget
  'figure-budget': { shipped: edit((p) => { for (const ph of p.phases) ph.scenario.menPerFigure = 5; }) },
  // a commander shown without his rank
  'unit-metadata': { shipped: edit((p) => { delete unit(p, 'missionary-ridge', 'us-hazen-brigade').commander.rank; }) },
  // a commander-named id for Willich's brigade (the franchise follows the unit, so this breaks the Shiloh lineage)
  'stable-ids': { shipped: edit((p) => { unit(p, 'missionary-ridge', 'us-gibson-brigade').id = 'us-willich-brigade'; }) },
  // the Fort Wood guns dropped from Orchard Knob's joins: they would fight outside the franchise
  'franchise-joins': { campaign: () => { const c = API.campaign(); const e = c.phases.find((p) => p.phaseId === 'orchard-knob'); delete e.joins; return c; } },
  // the first briefing without the sentence on what the Confederacy fought for
  briefings: { shipped: edit((p) => { const b = p.phases[0].scenario.briefing; b.text = b.text.filter((t) => !/slavery/.test(t)); }) },
  // Missionary Ridge put before Lookout Mountain on the ladder
  campaign: { campaign: () => { const c = API.campaign(); const i = c.phases.findIndex((p) => p.phaseId === 'lookout-mountain'); [c.phases[i], c.phases[i + 1]] = [c.phases[i + 1], c.phases[i]]; return c; } },
  // a pack that names terrain the game does not ship
  'headless-run': { shipped: edit((p) => { p.phases[1].scenario.terrain = 'lookout-mountian'; }) },
  // a pack built without AI roles: Moore never counterattacks
  'ai-active': { shipped: edit((p) => { for (const ph of p.phases) for (const u of roster(ph.scenario)) delete u.ai; }) },
};

const reset = () => { settings.set('look.menPerFigure', 10); setMenPerFigure(10, 5); };
export async function chattanoogaUnit(api = API) {
  try { for (const [, check] of CHATTANOOGA_CHECKS) await check(api); } finally { reset(); }
  return CHATTANOOGA_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await chattanoogaUnit();
  for (const r of RUN_STATS) console.log(`CHATTANOOGA RUN ${r.phase}: ${r.simS} s sim to ${r.clock}, CPU ${r.cpuS} s, ${r.units} formations, ${r.figures} living figures`);
  console.log(`CHATTANOOGA OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of CHATTANOOGA_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; } finally { reset(); }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`CHATTANOOGA CONTROLS OK (${rows.length}/${count})`);
  }
}

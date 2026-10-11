// CPU check: the Shiloh battle pack (assets/packs/shiloh.json, built by tools/build-packs.mjs from tools/packs/shiloh.mjs)
// and the shipped Western campaign ladder (assets/campaign.json). `node tools/test-shiloh.mjs` prints SHILOH OK (n/n);
// `--prove-fail` also runs one mutant per check and requires each to fail that check's own assertion, with the check's
// name at the start of the failure text. No browser, no GPU, writes nothing.
//
// The headless runs use the real Shiloh terrain (assets/terrain/shiloh.json + .bin, decoded as loadTerrainData does)
// and the real Game: every phase runs 120 s of simulation, and each phase the Confederates attack runs again until
// 60 s after its first Confederate attack order (src/sim/ai.js roles).
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
import { validateCampaign, newCampaign, campaignPhase, applyCampaign } from '../src/franchise/campaign.js';
import { itemDef, VETERANCY } from '../src/reward/data.js';
import { briefingSources } from '../src/ui/briefing.js';
import { buildPack, serialize, terrainFrame, facingOf, figuresAt, menPerFigureFor, packFile, FIGURE_BUDGET } from './build-packs.mjs';
import { PACK as SOURCE } from './packs/shiloh.mjs';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PHASE_IDS = ['camps-at-dawn', 'hornets-nest', 'grants-last-line', 'buell-attacks'];
// The Army of the Ohio formations whose ids later packs reuse (the campaign franchise).
const FRANCHISE_IDS = ['us-hazen-brigade', 'us-ammen-brigade', 'us-bruce-brigade', 'us-wsmith-brigade', 'us-boyle-brigade', 'us-rousseau-brigade',
  'us-kirk-brigade', 'us-gibson-brigade', 'us-terrill-battery', 'us-mendenhall-batteries', 'us-bartlett-battery'];
// Formations that fight in more than one phase must keep one id: [id, phases it appears in].
const RECURRING = [['cs-chalmers-brigade', PHASE_IDS], ['cs-jackson-brigade', PHASE_IDS.slice(1)], ['us-ammen-brigade', PHASE_IDS.slice(2)],
  ['us-hickenlooper-5th-ohio-battery', PHASE_IDS.slice(0, 2)], ['us-munch-1st-minnesota-battery', PHASE_IDS.slice(0, 2)],
  ['cs-wood-brigade', ['camps-at-dawn', 'hornets-nest', 'buell-attacks']], ['cs-shaver-brigade', PHASE_IDS.slice(0, 2)],
  ['cs-anderson-brigade', PHASE_IDS.slice(0, 2)], ['cs-cleburne-brigade', ['camps-at-dawn', 'buell-attacks']],
  ['cs-russell-brigade', ['camps-at-dawn', 'buell-attacks']], ['cs-gibson-brigade', ['hornets-nest', 'buell-attacks']],
  ['cs-bowen-brigade', ['hornets-nest', 'buell-attacks']]];
const RUN_MIN_S = 120; // simulated seconds every phase runs headless
const AFTER_ATTACK_S = 60; // simulated seconds after a phase's first Confederate attack order
const MOVED_M = 40; // metres an attacking Confederate formation must have moved by then
const RIVER_MARGIN = 60, EDGE_MARGIN = 60; // metres from the Tennessee River line and the map edge

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
  shippedText: () => readText('assets/packs/shiloh.json'),
  shipped: () => JSON.parse(readText('assets/packs/shiloh.json')),
  build: () => buildPack('shiloh'),
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
/** The river's x at depth z (the Tennessee runs north-south along the east of the map), linear between vertices. */
function riverX(pts, z) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    if ((z - az) * (z - bz) <= 0 && az !== bz) { const x = ax + (bx - ax) * (z - az) / (bz - az); best = best === null ? x : Math.min(best, x); }
  }
  return best;
}
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
const RUN_STATS = [];

export const SHILOH_CHECKS = [
  ['projection', async (api) => {
    const f = api.terrainFrame('shiloh'), b = f.meta.bbox;
    // tools/fetch-terrain.mjs wrote the bbox from its own constants: the same constants must reproduce it
    const near = (a, e, what) => assert.ok(Math.abs(a - e) < 1e-9, `projection: ${what} ${a} vs the terrain asset's ${e}`);
    near(f.center.lon - f.half / f.mLon, b.west, 'west edge'); near(f.center.lon + f.half / f.mLon, b.east, 'east edge');
    near(f.center.lat - f.half / f.mLat, b.south, 'south edge'); near(f.center.lat + f.half / f.mLat, b.north, 'north edge');
    const [ex, ez] = f.project(f.center.lat, f.center.lon + 1 / f.mLon), [nx, nz] = f.project(f.center.lat + 1 / f.mLat, f.center.lon);
    assert.ok(Math.abs(ex - 1) < 1e-6 && Math.abs(ez) < 1e-6 && Math.abs(nx) < 1e-6 && Math.abs(nz + 1) < 1e-6, 'projection: one metre east is +x, one metre north is -z');
    const rows = [[0, Math.PI], [90, Math.PI / 2], [180, 0], [270, -Math.PI / 2], [45, 3 * Math.PI / 4]];
    for (const [bearing, want] of rows) {
      const got = api.facingOf(bearing);
      assert.ok(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want))) < 1e-9, `projection: bearing ${bearing} gives facing ${got}, want ${want} (0 = south, pi/2 = east)`);
    }
    // a landmark round trip: the Pittsburg Landing site sits on the projected OSM point in every phase
    const lm = api.source().landmarks.landingTown, [lx, lz] = f.project(lm.lat, lm.lon);
    for (const p of api.shipped().phases) {
      const site = p.scenario.sites.find((s) => s.id === 'pittsburg-landing');
      assert.ok(site && Math.hypot(site.x - lx, site.z - lz) <= 1, `projection: ${p.id} Pittsburg Landing site at ${site?.x},${site?.z}, projected ${lx.toFixed(1)},${lz.toFixed(1)}`);
    }
  }],
  ['pack-fresh', async (api) => {
    const { pack } = await run('pack-fresh', () => api.build());
    const fresh = serialize(pack), shipped = api.shippedText();
    if (fresh !== shipped) {
      const a = fresh.split('\n'), b = shipped.split('\n'), i = a.findIndex((line, k) => line !== b[k]);
      assert.fail(`pack-fresh: assets/packs/shiloh.json differs from a fresh build at line ${i + 1}: shipped ${JSON.stringify(b[i])}, built ${JSON.stringify(a[i])} (run node tools/build-packs.mjs shiloh)`);
    }
  }],
  ['phases-validate', async (api) => {
    const pack = api.shipped();
    assert.deepEqual([pack.version, pack.id, pack.phases.map((p) => p.id)], [1, 'shiloh', PHASE_IDS], 'phases-validate: pack identity and phase ladder');
    for (const id of PHASE_IDS) {
      const prepared = await run(`phases-validate ${id}`, () => preparePhase(pack, id));
      await run(`phases-validate ${id}`, () => prepareFieldScenario(prepared.scenario, 'pack'));
      const loaded = await run(`phases-validate ${id}`, () => loadBattlePack({ packId: 'shiloh', phaseId: id, fetcher: async () => new Response(JSON.stringify(pack)) }));
      assert.equal(loaded.scenario.id, `shiloh-${id}`, `phases-validate: ${id} loads through loadBattlePack`);
      assert.equal(loaded.scenario.terrain, 'shiloh', `phases-validate: ${id} names the Shiloh terrain`);
      const plan = await run(`phases-validate ${id}`, () => prepareReinforcementTimeline(pack, id, loaded.scenario));
      assert.ok(plan.events.every((e) => e.atSec >= 0 && e.atSec <= plan.horizon), `phases-validate: ${id} reinforcements inside the phase`);
    }
  }],
  ['on-map', async (api) => {
    const pack = api.shipped(), meta = terrainOf('shiloh').meta, lim = meta.halfSize - EDGE_MARGIN;
    const river = meta.streams.find((s) => s.name === 'Tennessee River').points;
    const inMap = (p, what) => assert.ok(Math.abs(p[0]) <= lim && Math.abs(p[1]) <= lim, `on-map: ${what} at ${p} is outside the map (|x|, |z| <= ${lim})`);
    const dry = (p, what) => {
      const d = lineDist(p, river), rx = riverX(river, p[1]);
      assert.ok(d >= RIVER_MARGIN && (rx === null || p[0] < rx), `on-map: ${what} at ${p} is in or beyond the Tennessee River (${d.toFixed(0)} m from its line)`);
    };
    for (const { id, scenario: s } of pack.phases) {
      for (const u of roster(s)) {
        inMap([u.x, u.z], `${id}/${u.id}`); dry([u.x, u.z], `${id}/${u.id}`);
        for (const p of [...(u.ai?.target ? [u.ai.target] : []), ...(u.ai?.via || [])]) { inMap(p, `${id}/${u.id} AI route`); dry(p, `${id}/${u.id} AI route`); }
      }
      const o = s.objective;
      inMap([o.x - o.r, o.z - o.r], `${id} objective`); inMap([o.x + o.r, o.z + o.r], `${id} objective`);
      dry([o.x + o.r, o.z], `${id} objective edge`);
      for (const [side, p] of Object.entries(s.retreat)) { inMap(p, `${id} ${side} retreat`); dry(p, `${id} ${side} retreat`); }
      inMap(s.camera.target, `${id} camera`);
      for (const site of s.sites) { inMap([site.x, site.z], `${id} site ${site.id}`); dry([site.x, site.z], `${id} site ${site.id}`); }
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
    for (const [uid, phases] of RECURRING) {
      const has = PHASE_IDS.filter((p) => roster(phaseOf(pack, p).scenario).some((u) => u.id === uid));
      assert.deepEqual(has, phases, `stable-ids: ${uid} must keep its id in ${phases.join(', ')}`);
    }
    const p4 = roster(phaseOf(pack, 'buell-attacks').scenario);
    for (const uid of FRANCHISE_IDS) assert.ok(p4.some((u) => u.id === uid && u.side === 'US'), `stable-ids: ${uid} is missing from buell-attacks`);
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
    assert.deepEqual([def.id, def.title], ['west', 'The Western Campaign 1862–63'], 'campaign: identity');
    assert.deepEqual(def.phases.map((p) => [p.packId, p.phaseId, p.loan === true]),
      [['shiloh', 'camps-at-dawn', true], ['shiloh', 'hornets-nest', true], ['shiloh', 'grants-last-line', true], ['shiloh', 'buell-attacks', false]], 'campaign: the Shiloh ladder, first three phases on loan');
    assert.deepEqual(def.franchise.map((r) => r.unitId).sort(), [...FRANCHISE_IDS].sort(), 'campaign: the franchise is the Army of the Ohio fielded in buell-attacks');
    const p4 = roster(phaseOf(pack, 'buell-attacks').scenario);
    for (const r of def.franchise) {
      const u = p4.find((v) => v.id === r.unitId);
      assert.ok(u && u.side === 'US', `campaign: franchise ${r.unitId} does not exist in buell-attacks`);
      assert.equal(r.kind, u.type === 'artillery' ? 'battery' : 'infantry', `campaign: ${r.unitId} kind`);
      assert.deepEqual([r.men, r.guns ?? 0], [u.men, u.guns ?? 0], `campaign: ${r.unitId} men and guns equal the phase strength`);
      assert.equal(itemDef(r.weapon).arm, r.kind === 'battery' ? 'artillery' : 'infantry', `campaign: ${r.unitId} weapon arm`);
      if (r.kind === 'infantry') assert.equal(r.weapon, u.weapon === 'smooth' ? 'm1842' : r.weapon, `campaign: ${r.unitId} smoothbore brigades carry the M1842`);
      assert.equal(VETERANCY.findIndex((v) => v.id === r.vet) + 1, u.xp, `campaign: ${r.unitId} veterancy matches its xp in buell-attacks`);
    }
    // a fresh campaign launches its first (loan) phase and its franchise phase as valid pack fields
    const save = newCampaign({ campaign: raw, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
    const first = campaignPhase(save, raw);
    assert.deepEqual([first.packId, first.phaseId, first.loan], ['shiloh', 'camps-at-dawn', true], 'campaign: a new campaign starts at the camps');
    const loanField = applyCampaign(phaseOf(pack, 'camps-at-dawn').scenario, save, first);
    await run('campaign', () => prepareFieldScenario(loanField, 'pack'));
    const last = { ...first, phaseId: 'buell-attacks', loan: false };
    const field = applyCampaign(phaseOf(pack, 'buell-attacks').scenario, save, last);
    await run('campaign', () => prepareFieldScenario(field, 'pack'));
    for (const uid of FRANCHISE_IDS) assert.ok(roster(field).some((u) => u.id === uid && u.equipment), `campaign: ${uid} takes the field with its franchise equipment`);
  }],
  ['headless-run', async (api) => {
    for (const { id, scenario } of api.shipped().phases) {
      const s = await run(`headless-run ${id}`, () => prepareFieldScenario(scenario, 'pack'));
      const seconds = RUN_MIN_S;
      const cpu0 = process.cpuUsage();
      const { game } = await run(`headless-run ${id}`, () => runPhase(api, s, seconds));
      const cpu = process.cpuUsage(cpu0);
      assert.ok(game.simTime >= Math.min(seconds, (clockMin(s.end) - clockMin(s.start)) * 60 / s.clockRatio) - 1e-6 || game.over, `headless-run: ${id} advanced only ${game.simTime} s`);
      assert.ok(game.units.every((u) => Number.isFinite(u.x) && Number.isFinite(u.z) && Number.isFinite(u.men) && u.men >= 0), `headless-run: ${id} a formation went non-finite`);
      RUN_STATS.push({ phase: id, simS: Math.round(game.simTime), cpuS: Number(((cpu.user + cpu.system) / 1e6).toFixed(1)), units: game.units.length, figures: game.figureCount(), clock: game.clockText().time });
    }
  }],
  ['ai-active', async (api) => {
    const phases = api.shipped().phases.filter((p) => p.scenario.attacker === 'CS');
    assert.deepEqual(phases.map((p) => p.id), PHASE_IDS.slice(0, 3), 'ai-active: the Confederates attack in the first three phases');
    // cheapest first, so a missing role fails fast
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
  // a hand edit to the generated file: one brigade's strength changed without a rebuild
  'pack-fresh': { shippedText: () => API.shippedText().replace('"men": 2790,', '"men": 2791,') },
  // a tree spacing outside the ground contract (13-30 m)
  'phases-validate': { shipped: edit((p) => { p.phases[1].scenario.ground.treeSpacing = 31; }) },
  // Webster's guns drawn onto the Tennessee River
  'on-map': { shipped: edit((p) => { const u = unit(p, 'grants-last-line', 'us-markgraf-8th-ohio-battery'); u.x = 2110; }) },
  // reinforcement times computed at the default 1:4 clock instead of the phase's own ratio
  'clock-offsets': { shipped: edit((p) => { for (const ph of p.phases) for (const r of ph.scenario.reinforcements || []) r.atSec = Math.round(r.atSec * ph.scenario.clockRatio / 4 * 10) / 10; }) },
  // the densest ratio, ignoring the figure budget
  'figure-budget': { shipped: edit((p) => { for (const ph of p.phases) ph.scenario.menPerFigure = 5; }) },
  // a commander shown without his rank
  'unit-metadata': { shipped: edit((p) => { delete unit(p, 'hornets-nest', 'us-tuttle-brigade').commander.rank; }) },
  // the research packet's own id for Chalmers in phase 3 (cs-chalmers-2nd-brigade) instead of the stable one
  'stable-ids': { shipped: edit((p) => { unit(p, 'grants-last-line', 'cs-chalmers-brigade').id = 'cs-chalmers-2nd-brigade'; }) },
  // the first briefing without the sentence on what the Confederacy fought for
  briefings: { shipped: edit((p) => { const b = p.phases[0].scenario.briefing; b.text = b.text.filter((t) => !/slavery/.test(t)); }) },
  // a franchise row whose id no longer matches the phase (a typo in a later pack's id)
  campaign: { campaign: () => { const c = API.campaign(); c.franchise[0].unitId = 'us-hazen-brigade-19th'; return c; } },
  // a pack that names terrain the game does not ship
  'headless-run': { shipped: edit((p) => { p.phases[0].scenario.terrain = 'shilo'; }) },
  // a pack built without AI roles: the Confederates never move
  'ai-active': { shipped: edit((p) => { for (const ph of p.phases) for (const u of roster(ph.scenario)) delete u.ai; }) },
};

const reset = () => { settings.set('look.menPerFigure', 10); setMenPerFigure(10, 5); };
export async function shilohUnit(api = API) {
  try { for (const [, check] of SHILOH_CHECKS) await check(api); } finally { reset(); }
  return SHILOH_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await shilohUnit();
  for (const r of RUN_STATS) console.log(`SHILOH RUN ${r.phase}: ${r.simS} s sim to ${r.clock}, CPU ${r.cpuS} s, ${r.units} formations, ${r.figures} living figures`);
  console.log(`SHILOH OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of SHILOH_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; } finally { reset(); }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`SHILOH CONTROLS OK (${rows.length}/${count})`);
  }
}

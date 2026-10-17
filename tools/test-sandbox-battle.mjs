// CPU check: the Battles menu's Sandbox battle (src/sim/sandbox-battle.js). The 22 rosters of the three battle packs, the 5
// fields and their dressing, and every (field, Union roster, Confederate roster, attacker) combination (1,210) built as the
// page builds it: all units inside |x|,|z| <= H - 250, none within 120 m of another, the attacker wholly west of the defender,
// facing the enemy; the Confederate roster's own date (it picks their national colour); a valid 'pack' scenario with no
// history and the rosters' own sources; the attack role on every attacker
// formation (also through sideScenario for a Confederate player); two headless battles in which the computer's attacker
// closes on the centre ground, and the same two in which, by 07:00 (60 battle minutes), the lines have met (closest
// attacker-defender pair under 300 m) and both sides have lost men; bad addresses refused with the parameter named; and the
// opening view (v5 LEG A): on Shiloh and Henry Hill, for each side the player commands and each attacker, the camera target
// lies between the player's front and the objective, the front, the objective's centre and its far edge all project inside
// the frame of a real RtsCamera (1280 x 720) at the chosen distance (the smallest from 900 m that does, see OPENING_VIEW),
// and the camera looks at the enemy (opening-view); and the front and the objective's centre project between the top strip
// and the bottom dock (hud.css sizes; opening-hud), which the first v5 fit (halfway, 95% of the full frame) did not.
// `node tools/test-sandbox-battle.mjs` prints SANDBOX BATTLE OK (n/n); `--prove-fail` also runs one mutant per check and
// requires each to fail with that check's own name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { RtsCamera, pitchForDist } from '../src/render/rts-camera.js';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { TerrainData, EXAGGERATION } from '../src/world/terrain.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { sideScenario } from '../src/sim/sides.js';
import * as S from '../src/sim/sandbox-battle.js';
import { nationalTile } from '../src/units/soldier-mesh.js';

const ROOT = new URL('../', import.meta.url);
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const readJson = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT), 'utf8'));
const PACKS = S.SANDBOX_PACKS.map((id) => readJson(`assets/packs/${id}.json`));
const HENRY = readJson('assets/scenarios/henry-hill.json');
const META = Object.fromEntries(S.FIELDS.map((f) => [f.id, readJson(`assets/terrain/${f.id}.json`)]));
const SOURCES = { packs: PACKS, henryHill: HENRY, view: { pitchFor: pitchForDist, fov: 32 } }; // src/main.js FIELD_FOV
const ROSTERS = S.rosterList(PACKS);
const ids = (side) => ROSTERS.filter((r) => r.side === side).map((r) => r.id);
const COMBOS = S.FIELDS.flatMap((f) => ids('US').flatMap((us) => ids('CS').flatMap((cs) => ['US', 'CS'].map((attacker) => ({ field: f.id, us, cs, attacker })))));
const phaseOf = (id) => { const [p, ph] = id.split('.'); return PACKS.find((x) => x.id === p).phases.find((x) => x.id === ph).scenario; };
const rosterDefs = (id, side) => { const s = phaseOf(id); return [...s.units, ...(s.reinforcements || [])].filter((u) => u.side === side); };
const key = (c) => `${c.field}|${c.us}|${c.cs}|${c.attacker}`;
const built = new Map();
const build = (c) => { if (!built.has(key(c))) built.set(key(c), S.sandboxBattleScenario(c, { ...SOURCES, terrainMeta: META[c.field] })); return built.get(key(c)); };

const terrains = new Map();
function terrainOf(name) {
  if (terrains.has(name)) return terrains.get(name);
  const meta = META[name];
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), G = meta.grid;
  const heights = new Float32Array(G * G), k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  const t = new TerrainData(meta, heights);
  terrains.set(name, t);
  return t;
}
function makeGame(scenario, playerSide) {
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain: terrainOf(scenario.terrain), scenario, world: { fenceField: null }, effects: { volley() {}, boom() {} }, playerSide });
  game.initializeReinforcements();
  return game;
}
// A real RtsCamera (flat ground, the page's 32 degree lens at 1280 x 720) at the goal it opens on: frame coordinates of x points on z = 0.
const frames = new Map();
function frameOf(cam, dist, half, xs) {
  const k = `${cam.target}|${cam.yaw}|${dist}|${half}`;
  if (!frames.has(k)) {
    const r = new RtsCamera(new PerspectiveCamera(32, 1280 / 720, 2, 6000), { half, heightAt: () => 0, inBounds: () => true }, { target: [...cam.target], yaw: cam.yaw, dist });
    frames.set(k, r.goalCamera().clone());
  }
  const c3 = frames.get(k);
  return xs.map((x) => new Vector3(x, 0, 0).project(c3));
}
/** Every opening view on Shiloh and Henry Hill: each roster pair, attacker and player side, with its front and the objective. */
function openingCases(api) {
  const out = [];
  for (const c of COMBOS.filter((x) => x.field === 'shiloh' || x.field === 'henry-hill')) for (const side of ['US', 'CS']) {
    const s = sideScenario(api.scenarioFor(c), side), o = s.objective, dir = side === c.attacker ? 1 : -1;
    const own = s.units.filter((d) => d.side === side), enemy = s.units.filter((d) => d.side !== side);
    out.push({ k: `${key(c)} ${side} player`, kind: `${c.field}|${side}|${c.attacker}`, cam: s.camera, half: META[c.field].halfSize, dir,
      front: dir > 0 ? Math.max(...own.map((d) => d.x)) : Math.min(...own.map((d) => d.x)), obj: o.x, edge: o.x + dir * o.r,
      enemyX: enemy.reduce((n, d) => n + d.x, 0) / enemy.length });
  }
  return out;
}
const throwsNaming = (fn, param, label) => {
  let message = null;
  try { fn(); } catch (e) { message = String(e?.message); }
  assert.ok(message !== null, `${label}: nothing was refused`);
  assert.ok(message.includes(`"${param}"`), `${label}: the refusal does not name "${param}" (${message})`);
};

const CHECKS = [
  ['rosters', (api) => {
    const rows = api.rosterList(PACKS);
    assert.equal(rows.length, 22, `rosters: ${rows.length} rosters, not 22`);
    for (const side of ['US', 'CS']) {
      const list = rows.filter((r) => r.side === side);
      assert.equal(list.length, 11, `rosters: ${list.length} ${side} rosters, not 11`);
      assert.equal(new Set(list.map((r) => r.id)).size, 11, `rosters: duplicate ${side} roster ids`);
    }
    // Two rows counted by hand from assets/packs/*.json (units + reinforcements of that side).
    const row = (id, side) => rows.find((r) => r.id === id && r.side === side);
    assert.deepEqual({ ...row('shiloh.camps-at-dawn', 'US').counts }, { brigades: 5, batteries: 4, cavalry: 0 }, 'rosters: shiloh.camps-at-dawn Union counts');
    assert.equal(row('shiloh.camps-at-dawn', 'US').men, 11672, 'rosters: shiloh.camps-at-dawn Union men');
    assert.equal(row('shiloh.camps-at-dawn', 'US').label, 'Shiloh · The camps at dawn · 5 brigades, 4 batteries · 11,672 men', 'rosters: shiloh.camps-at-dawn Union label');
    assert.deepEqual({ ...row('stones-river.mcfaddens-ford', 'US').counts }, { brigades: 7, batteries: 12, cavalry: 0 }, 'rosters: stones-river.mcfaddens-ford Union counts');
    assert.equal(row('stones-river.mcfaddens-ford', 'US').men, 9808, 'rosters: stones-river.mcfaddens-ford Union men');
    for (const r of rows) {
      const defs = rosterDefs(r.id, r.side);
      assert.equal(r.counts.brigades + r.counts.batteries + r.counts.cavalry, defs.length, `rosters: ${r.id} ${r.side} counts miss formations`);
      assert.equal(r.men, defs.reduce((n, d) => n + d.men, 0), `rosters: ${r.id} ${r.side} men are not the roster's`);
    }
  }],
  ['fields', (api) => {
    assert.deepEqual(api.FIELDS.map((f) => f.id), ['shiloh', 'stones-river', 'chattanooga', 'lookout-mountain', 'henry-hill'], 'fields: not the five built terrains');
    for (const f of api.FIELDS) assert.equal(f.name, META[f.id].name, `fields: ${f.id} label is not its terrain file's name`);
    const scenarios = [HENRY, ...PACKS.flatMap((p) => p.phases.map((ph) => ph.scenario))];
    const four = (s) => Object.fromEntries(['ground', 'woods', 'sites', 'labels'].filter((k) => k in s).map((k) => [k, s[k]]));
    for (const f of api.FIELDS) {
      const on = scenarios.filter((s) => (s.terrain ?? 'henry-hill') === f.id);
      const best = on.reduce((a, s) => (JSON.stringify(four(s)).length > JSON.stringify(four(a)).length ? s : a));
      assert.deepEqual(api.fieldDressing(f.id, scenarios), four(best), `fields: ${f.id} is not dressed as its largest built scenario`);
    }
    assert.deepEqual(api.fieldDressing('henry-hill', scenarios), four(HENRY), 'fields: henry-hill is not dressed as assets/scenarios/henry-hill.json');
  }],
  ['bounds', (api) => {
    for (const c of COMBOS) {
      const s = api.scenarioFor(c), lim = META[c.field].halfSize - 250;
      const out = s.units.filter((u) => Math.abs(u.x) > lim || Math.abs(u.z) > lim);
      assert.equal(out.length, 0, `bounds: ${key(c)} has ${out.length} formations beyond ${lim} m (${out.slice(0, 2).map((u) => `${u.id} ${u.x},${u.z}`).join('; ')})`);
    }
  }],
  ['spacing', (api) => {
    for (const c of COMBOS) {
      const u = api.scenarioFor(c).units;
      let min = Infinity;
      for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) min = Math.min(min, Math.hypot(u[i].x - u[j].x, u[i].z - u[j].z));
      assert.ok(min >= 120, `spacing: ${key(c)} has two formations ${min.toFixed(1)} m apart`);
    }
  }],
  ['apart', (api) => {
    for (const c of COMBOS) {
      const u = api.scenarioFor(c).units, att = u.filter((d) => d.side === c.attacker), def = u.filter((d) => d.side !== c.attacker);
      const east = Math.max(...att.map((d) => d.x)), west = Math.min(...def.map((d) => d.x));
      assert.ok(east < west, `apart: ${key(c)} attacker reaches x ${east}, defender from x ${west}`);
    }
  }],
  ['facing', (api) => {
    for (const c of COMBOS) for (const d of api.scenarioFor(c).units) {
      const fx = Math.sin(d.facing), want = d.side === c.attacker ? 1 : -1;
      assert.ok(Math.abs(fx - want) < 1e-6 && Math.abs(Math.cos(d.facing)) < 1e-6, `facing: ${key(c)} ${d.id} faces ${d.facing.toFixed(3)}, not ${want > 0 ? '+x' : '-x'}`);
    }
  }],
  ['deploy-pure', (api) => {
    const defs = [...rosterDefs('shiloh.buell-attacks', 'US'), ...rosterDefs('shiloh.hornets-nest', 'CS')].map((d) => structuredClone(d));
    const before = JSON.stringify(defs), a = api.deploy(defs, 'US', 1300), b = api.deploy(defs, 'US', 1300);
    assert.equal(JSON.stringify(defs), before, 'deploy-pure: deploy changed its input');
    assert.deepEqual(a, b, 'deploy-pure: deploy is not deterministic');
    assert.deepEqual(a.map((d) => d.id), defs.map((d) => d.id), 'deploy-pure: deploy does not keep the input order');
    assert.ok(a.every((d, i) => d.men === defs[i].men && d.name === defs[i].name), 'deploy-pure: deploy changed a formation');
  }],
  // The scenario date picks the Confederate national colour drawn on the field (soldier-mesh.js nationalTile); it must be the
  // Confederate roster's own phase date, so no brigade flies a flag from another period (a Chattanooga brigade under the First
  // National, a Shiloh brigade under the Second). Every combination, with the cross-period ones counted so the sample is real.
  ['flag-date', (api) => {
    let crossed = 0;
    for (const c of COMBOS) {
      const s = api.scenarioFor(c), own = phaseOf(c.cs).date, k = key(c);
      if (nationalTile('CS', phaseOf(c.us).date) !== nationalTile('CS', own)) crossed++;
      assert.equal(s.date, own, `flag-date: ${k} date ${s.date} is not the Confederate roster's own (${own})`);
      assert.equal(nationalTile('CS', s.date), nationalTile('CS', own), `flag-date: ${k} the Confederates fly another period's national colour`);
    }
    assert.ok(crossed > 0, 'flag-date: no combination crosses 1 May 1863, so the check proves nothing');
  }],
  ['scenario', (api) => {
    for (const c of COMBOS) {
      const s = api.scenarioFor(c), k = key(c);
      assert.ok(!('history' in s) && !('commanders' in s) && !('commandChain' in s) && !('opening' in s) && !('crates' in s), `scenario: ${k} carries history, officers, an opening or loot`);
      try { prepareFieldScenario(structuredClone(s), 'pack'); } catch (e) { assert.fail(`scenario: ${k} fails pack validation: ${e.message}`); }
      const us = S.rosterList(PACKS).find((r) => r.id === c.us && r.side === 'US'), cs = S.rosterList(PACKS).find((r) => r.id === c.cs && r.side === 'CS');
      assert.equal(s.id, 'sandbox-battle', `scenario: ${k} id`);
      assert.equal(s.title, `Sandbox battle · ${META[c.field].name}`, `scenario: ${k} title`);
      assert.equal(s.subtitle, `${us.label} against ${cs.label}`, `scenario: ${k} subtitle`);
      assert.ok(s.start === '06:00' && s.end === '08:00' && s.clockRatio === 15 && s.attacker === c.attacker && s.terrain === c.field, `scenario: ${k} clock, attacker or terrain`);
      assert.deepEqual({ ...s.objective }, { name: 'the centre ground', x: 0, z: 0, r: 600 }, `scenario: ${k} objective`);
      assert.ok(Object.values(s.victory).every((t) => /sandbox rule/.test(t)) && Object.keys(s.victory).length === 5, `scenario: ${k} victory texts are not game rules`);
      assert.equal(s.briefing.text.length, 3, `scenario: ${k} briefing is not three captions`);
      const defs = [...rosterDefs(c.us, 'US'), ...rosterDefs(c.cs, 'CS')];
      assert.equal(s.units.length, us.counts.brigades + us.counts.batteries + us.counts.cavalry + cs.counts.brigades + cs.counts.batteries + cs.counts.cavalry, `scenario: ${k} unit count is not the rosters'`);
      assert.ok(!s.reinforcements || !s.reinforcements.length, `scenario: ${k} keeps a timetable`);
      for (const d of defs) {
        const u = s.units.find((x) => x.id === d.id);
        assert.ok(u, `scenario: ${k} lost ${d.id}`);
        for (const f of ['side', 'type', 'name', 'men', 'weapon', 'xp', 'guns', 'commander', 'regiments', 'sources', 'status', 'parent', 'short']) {
          assert.deepEqual(u[f], d[f], `scenario: ${k} ${d.id} ${f} is not the roster's`);
        }
        assert.ok(!('atSec' in u) && !('entry' in u) && !('noticeSec' in u), `scenario: ${k} ${d.id} keeps its arrival time`);
      }
    }
  }],
  ['attack-roles', (api) => {
    for (const c of COMBOS.filter((x) => x.field === 'shiloh' || x.field === 'henry-hill')) {
      const s = api.scenarioFor(c), k = key(c);
      const fought = c.attacker === 'US' ? sideScenario(s, 'CS') : s; // the computer commands the attacker
      const att = fought.units.filter((d) => d.side === c.attacker), def = fought.units.filter((d) => d.side !== c.attacker);
      assert.ok(att.every((d) => d.ai?.role === 'attack' && !d.ai.target && !d.ai.via && !d.ai.at), `attack-roles: ${k} an attacker formation lacks the plain attack role`);
      assert.ok(def.every((d) => !d.ai), `attack-roles: ${k} a defender formation carries an AI role`);
    }
  }],
  ['advance', (api) => {
    const runs = [[{ field: 'shiloh', us: 'shiloh.buell-attacks', cs: 'shiloh.camps-at-dawn', attacker: 'CS' }, 'US'],
      [{ field: 'henry-hill', us: 'shiloh.hornets-nest', cs: 'shiloh.buell-attacks', attacker: 'US' }, 'CS']];
    for (const [c, player] of runs) {
      const g = makeGame(sideScenario(api.scenarioFor(c), player), player), o = g.objective;
      const att = g.units.filter((u) => u.side === c.attacker), mean = () => att.reduce((n, u) => n + Math.hypot(u.x - o.x, u.z - o.z), 0) / att.length;
      assert.equal(g.units.length, api.scenarioFor(c).units.length, `advance: ${key(c)} the game lost formations`);
      const before = mean();
      for (let guard = 0; guard < 50 && g.simTime < 40 && !g.over; guard++) { if (g.paused) g.togglePause(); g.fastForward(Math.min(5, 40 - g.simTime)); }
      const closed = before - mean();
      assert.ok(closed > 10, `advance: ${key(c)} the computer's attacker closed ${closed.toFixed(1)} m on the centre ground in 40 s`);
    }
  }],
  // The lines must meet (CI 38998598887: a defender front at x = +400 left a Shiloh sandbox a 0-lost Draw at 08:00). Battle
  // clock minutes are simulation seconds x clockRatio / 60, so 07:00 is 240 sim s at 15x.
  ['contact', (api) => {
    for (const [c, player] of CONTACT_RUNS) {
      const g = makeGame(sideScenario(api.scenarioFor(c), player), player), until = (60 * 60) / g.clockRatio, k = key(c);
      for (let guard = 0; guard < 200 && g.simTime < until - 1e-6 && !g.over; guard++) { if (g.paused) g.togglePause(); g.fastForward(Math.min(5, until - g.simTime)); }
      const def = c.attacker === 'US' ? 'CS' : 'US', alive = (side) => g.units.filter((u) => u.side === side && u.alive);
      const lost = (side) => g.units.filter((u) => u.side === side).reduce((n, u) => n + Math.max(0, (u.menMax || 0) - (u.men || 0)), 0);
      let closest = Infinity;
      for (const a of alive(c.attacker)) for (const d of alive(def)) closest = Math.min(closest, Math.hypot(a.x - d.x, a.z - d.z));
      assert.ok(closest < 300, `contact: ${k} the closest attacker and defender stand ${closest.toFixed(0)} m apart at 07:00 (must be under 300 m)`);
      const la = Math.round(lost(c.attacker)), ld = Math.round(lost(def));
      assert.ok(la > 0 && ld > 0, `contact: ${k} by 07:00 the attacker (${c.attacker}) lost ${la} and the defender (${def}) ${ld} men (both must be above 0)`);
    }
  }],
  ['refusals', (api) => {
    const good = 'field=shiloh&us=shiloh.buell-attacks&cs=shiloh.camps-at-dawn&attacker=CS';
    const p = api.sandboxBattleSearch('?sandbox-battle&' + good, ROSTERS);
    assert.deepEqual({ ...p }, { field: 'shiloh', us: 'shiloh.buell-attacks', cs: 'shiloh.camps-at-dawn', attacker: 'CS', side: 'US', difficulty: null }, 'refusals: a good address does not parse');
    const swap = (k, v) => { const q = new URLSearchParams(good); if (v === null) q.delete(k); else q.set(k, v); return '?sandbox-battle&' + q; };
    for (const [k, v] of [['field', 'gettysburg'], ['field', null], ['us', 'shiloh.nope'], ['us', 'nope'], ['us', null], ['cs', 'henry-hill.field'],
      ['cs', 'shiloh.camps-at-dawn.x'], ['attacker', 'XX'], ['attacker', null], ['side', 'cs'], ['difficulty', 'easy']]) {
      throwsNaming(() => api.sandboxBattleSearch(swap(k, v), ROSTERS), k, `refusals: ${k}=${v}`);
    }
    const base = { field: 'shiloh', us: 'shiloh.buell-attacks', cs: 'shiloh.camps-at-dawn', attacker: 'CS' };
    throwsNaming(() => S.sandboxBattleScenario({ ...base, field: 'antietam' }, { ...SOURCES, terrainMeta: META.shiloh }), 'field', 'refusals: scenario field');
    throwsNaming(() => S.sandboxBattleScenario({ ...base, us: 'shiloh.nope' }, { ...SOURCES, terrainMeta: META.shiloh }), 'us', 'refusals: scenario us');
    throwsNaming(() => S.sandboxBattleScenario({ ...base, cs: 'stones-river.nope' }, { ...SOURCES, terrainMeta: META.shiloh }), 'cs', 'refusals: scenario cs');
    throwsNaming(() => S.sandboxBattleScenario({ ...base, attacker: 'both' }, { ...SOURCES, terrainMeta: META.shiloh }), 'attacker', 'refusals: scenario attacker');
  }],
  // v5 LEG A: the first frame shows the player's own front and the centre ground, whichever side he commands and whichever attacks.
  ['opening-view', (api) => {
    const seen = new Set(), V = S.OPENING_VIEW, [lo, hi] = S.clearBand(V.frame, V.margin);
    for (const o of openingCases(api)) {
      const { k, cam, front, dir, enemyX, obj, edge } = o, [tx, tz] = cam.target;
      assert.ok(tz === 0 && tx >= Math.min(front, obj) && tx <= Math.max(front, obj),
        `opening-view: ${k} camera target ${tx},${tz} is not between the front (x ${front}) and the objective (x ${obj})`);
      const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
      assert.ok(Math.sign(enemyX - front) === dir && fx * dir > 0.999 && Math.abs(fz) < 1e-3,
        `opening-view: ${k} camera looks along ${fx.toFixed(3)},${fz.toFixed(3)}, not at the enemy (x ${enemyX.toFixed(0)} from the front at ${front})`);
      assert.ok(cam.dist >= V.minDist && cam.dist <= V.maxDist, `opening-view: ${k} camera distance ${cam.dist} is outside ${V.minDist}-${V.maxDist} m`);
      const at = (dist) => frameOf(cam, dist, o.half, [front, obj, edge]);
      const p = at(cam.dist);
      assert.ok(p.every((q) => Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z > -1 && q.z < 1),
        `opening-view: ${k} at ${cam.dist} m the front (x ${front}), the objective (x ${obj}) or its far edge (x ${edge}) projects outside the frame (${p.map((q) => q.y.toFixed(2)).join(', ')})`);
      const rule = ([f, c, e]) => f.y >= lo && f.y <= hi && c.y >= lo && c.y <= hi && Math.abs(e.y) <= 1;
      assert.ok(cam.dist === V.minDist || !rule(at(cam.dist - V.step)), `opening-view: ${k} ${cam.dist} m is not the smallest distance that frames them (${cam.dist - V.step} m does)`);
      seen.add(o.kind);
    }
    assert.equal(seen.size, 8, `opening-view: ${seen.size} of the 8 (field, side, attacker) cases were checked`);
  }],
  ['opening-hud', (api) => {
    // The HUD's own edges at 1280 x 720 (no margin): the top strip ends at frame.top px, the dock starts frame.bottom px up.
    const F = S.OPENING_VIEW.frame, row = (q) => ((1 - q.y) / 2) * F.height, worst = { front: 0, obj: F.height };
    for (const o of openingCases(api)) {
      const [f, c] = frameOf(o.cam, o.cam.dist, o.half, [o.front, o.obj]).map(row);
      assert.ok(f >= F.top && f <= F.height - F.bottom, `opening-hud: ${o.k} the player's front (x ${o.front}) projects at y ${f.toFixed(0)} px, outside the band between the top strip (${F.top} px) and the dock (${F.height - F.bottom} px)`);
      assert.ok(c >= F.top && c <= F.height - F.bottom, `opening-hud: ${o.k} the objective (x ${o.obj}) projects at y ${c.toFixed(0)} px, outside the band between the top strip (${F.top} px) and the dock (${F.height - F.bottom} px)`);
      worst.front = Math.max(worst.front, f); worst.obj = Math.min(worst.obj, c);
    }
    assert.ok(worst.front > 0, 'opening-hud: no case was checked');
  }],
  ['href', (api) => {
    const p = { field: 'henry-hill', us: 'shiloh.hornets-nest', cs: 'shiloh.buell-attacks', attacker: 'US' };
    assert.equal(api.sandboxBattleHref({ ...p, side: 'US', difficulty: 'veteran' }), './?sandbox-battle&field=henry-hill&us=shiloh.hornets-nest&cs=shiloh.buell-attacks&attacker=US', 'href: Veteran and the Union add to the address');
    const href = api.sandboxBattleHref({ ...p, side: 'CS', difficulty: 'general' });
    assert.ok(href.endsWith('&difficulty=general&side=CS'), `href: Command and Difficulty are not carried (${href})`);
    assert.deepEqual({ ...S.sandboxBattleSearch(new URL(href, 'https://x.invalid/').search, ROSTERS) }, { ...p, side: 'CS', difficulty: 'general' }, 'href: the link does not parse back to its choice');
  }],
];

const CONTACT_RUNS = [[{ field: 'shiloh', us: 'shiloh.buell-attacks', cs: 'shiloh.camps-at-dawn', attacker: 'CS' }, 'US'],
  [{ field: 'henry-hill', us: 'shiloh.hornets-nest', cs: 'shiloh.buell-attacks', attacker: 'US' }, 'CS']];
// The built scenario re-placed by deploy() under another rule set (the contact mutant: the old +400 defender front).
const redeploy = (c, rules) => {
  const s = build(c), at = new Map(S.deploy(s.units, c.attacker, META[c.field].halfSize, rules).map((d) => [d.id, d]));
  return prepareFieldScenario(strip(s, (u) => ({ ...u, x: at.get(u.id).x, z: at.get(u.id).z, facing: at.get(u.id).facing })), 'pack');
};
const strip = (s, fn) => ({ ...s, units: s.units.map((u) => fn({ ...u })) });
// The opening-view mutant: the camera before v5 (1,200 m behind the Union front, pulled in so it stood on the map; a
// Confederate player got sides.js's centroid view).
const oldCamera = (s, c) => {
  const dist = 1200, dirUS = c.attacker === 'US' ? 1 : -1, usX = s.units.filter((d) => d.side === 'US').map((d) => d.x);
  const front = dirUS > 0 ? Math.max(...usX) : Math.min(...usX), reach = META[c.field].halfSize - 100 - dist;
  return { target: [Math.round(dirUS > 0 ? Math.max(front, -reach) : Math.min(front, reach)), 0], yaw: dirUS > 0 ? -Math.PI / 2 : Math.PI / 2, dist };
};
// The opening-hud mutant: the first v5 fit (target halfway; from 900 m out until the front and the far edge lie inside 95%
// of the full frame's height), which put an attacker's front under the dock.
const firstFit = (s, c, side) => {
  const dir = side === c.attacker ? 1 : -1, xs = s.units.filter((d) => d.side === side).map((d) => d.x), front = dir > 0 ? Math.max(...xs) : Math.min(...xs);
  const tx = front / 2, near = (front - tx) * dir, far = (dir * s.objective.r - tx) * dir;
  let dist = 900;
  while (dist < 2000 && !(Math.abs(S.viewHeight(near, dist, pitchForDist(dist), 32)) <= 0.95 && Math.abs(S.viewHeight(far, dist, pitchForDist(dist), 32)) <= 0.95)) dist += 10;
  return { target: [Math.round(tx), 0], yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2, dist };
};
const MUTANTS = {
  rosters: { rosterList: (packs) => S.rosterList(packs.map((p) => ({ ...p, phases: p.phases.map((ph) => ({ ...ph, scenario: { ...ph.scenario, reinforcements: [] } })) }))) },
  fields: { fieldDressing: (field, scenarios) => structuredClone(Object.fromEntries(['ground', 'woods', 'sites', 'labels'].map((k) => [k, scenarios.find((s) => (s.terrain ?? 'henry-hill') === field)[k]]).filter(([, v]) => v !== undefined))) },
  bounds: { scenarioFor: (c) => strip(build(c), (u) => ({ ...u, z: u.z * 1.6 })) }, // the line drawn to the full half-size
  spacing: { scenarioFor: (c) => strip(build(c), (u) => ({ ...u, z: u.z * 0.4 })) },
  apart: { scenarioFor: (c) => strip(build(c), (u) => (u.side === c.attacker ? { ...u, x: u.x + 1200 } : u)) },
  facing: { scenarioFor: (c) => strip(build(c), (u) => ({ ...u, facing: u.side === c.attacker ? u.facing : -u.facing })) },
  'deploy-pure': { deploy: (defs, attacker, half) => { const out = S.deploy(defs, attacker, half); defs.forEach((d, i) => { d.x = out[i].x; }); return out; } },
  'flag-date': { scenarioFor: (c) => ({ ...build(c), date: phaseOf(c.attacker === 'US' ? c.us : c.cs).date }) }, // the old rule: the attacker's date
  scenario: { scenarioFor: (c) => ({ ...build(c), history: PACKS[0].phases[0].scenario.history }) },
  'attack-roles': { scenarioFor: (c) => prepareFieldScenario(strip(build(c), ({ ai, ...u }) => u), 'pack') },
  advance: { scenarioFor: (c) => prepareFieldScenario(strip(build(c), ({ ai, ...u }) => u), 'pack') },
  contact: { scenarioFor: (c) => redeploy(c, { ...S.DEPLOYMENT, defenderFront: 400 }) },
  refusals: { sandboxBattleSearch: (search, rosters) => { try { return S.sandboxBattleSearch(search, rosters); } catch { return Object.freeze({}); } } },
  href: { sandboxBattleHref: (p) => S.sandboxBattleHref({ ...p, side: 'US' }) },
  'opening-view': { scenarioFor: (c) => ({ ...build(c), camera: oldCamera(build(c), c) }) },
  'opening-hud': { scenarioFor: (c) => { const s = build(c); return { ...s, camera: { ...firstFit(s, c, 'US'), bySide: { US: firstFit(s, c, 'US'), CS: firstFit(s, c, 'CS') } } }; } },
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

const API = { ...S, scenarioFor: build };
const n = await run(API);
if (process.argv.includes('--prove-fail')) {
  for (const [name] of CHECKS) {
    assert.ok(MUTANTS[name], `no mutant for ${name}`);
    let said = '';
    await assert.rejects(() => run({ ...API, ...MUTANTS[name] }, name), (e) => { said = String(e.message).split('\n')[0]; return e.code === 'ERR_ASSERTION' && e.message.startsWith(`${name}:`); }, `${name}: its mutant was not caught`);
    console.log(`fail ${name} (mutant caught): ${said.slice(0, 220)}`);
  }
}
console.log(`SANDBOX BATTLE OK (${n}/${CHECKS.length})`);

// tools/build-packs.mjs: build one battle pack (assets/packs/<id>.json) from its curated source tools/packs/<id>.mjs.
//
//   node tools/build-packs.mjs shiloh            write assets/packs/shiloh.json and print the phase table
//   node tools/build-packs.mjs shiloh --check    write nothing; exit 1 when the shipped file differs from a fresh build
//
// The curated source holds the history (landmarks as WGS84 lat/lon with provenance; formations with sources and
// status; per-phase strengths, positions as lat/lon or landmark-relative offsets in metres along compass bearings,
// clock times and AI roles). This tool only does arithmetic on it:
//   - projects lat/lon to the terrain frame (origin at the terrain centre, +x east, +z south, metres) with the SAME
//     equirectangular constants as tools/fetch-terrain.mjs (M_PER_DEG_LAT / M_PER_DEG_LON about the centre latitude);
//   - turns compass bearings (0 = north, 90 = east) into engine facings (0 = +z south, pi/2 = +x east, pi = north);
//   - turns reinforcement clock times into phase offsets: atSec = (clock - start) * 60 / clockRatio;
//   - picks each phase's men per figure: the smallest whole ratio (5..40) that keeps the phase's drawn figures
//     (src/sim/phase.js unitFigures: infantry men / ratio, crews men / 4, plus 6 per formation) within FIGURE_BUDGET;
//   - draws each 1862 field clearing (a woods-based pack) or wood (a fields-based pack, src.groundBase 'fields') as a
//     deterministic irregular oval around its landmark;
//   - lays every label to read left to right from the phase's opening camera (label angle = -camera yaw);
//   - lets a phase fight on its own terrain asset (phase.terrain, default the pack's src.terrain): every position in
//     that phase is projected with THAT terrain's centre, and a clearing, wood, site or label that names a `terrain`
//     is drawn only in phases on that terrain (absent: every phase); phase.groundBase overrides src.groundBase;
//   - validates every phase with preparePhase and prepareFieldScenario(..., 'pack') before writing.
// Output is deterministic (no clock, no randomness) with a fixed key order, so tools/test-shiloh.mjs can rebuild
// it in memory and compare byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparePhase, prepareFieldScenario, PACK_ID } from '../src/sim/phase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIGURE_BUDGET = 3000; // drawn figures per phase (the pack route admits 4,000)
const DEG = Math.PI / 180;

/** The terrain asset's frame and the fetch-terrain projection constants for it. */
export function terrainFrame(name) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'terrain', `${name}.json`), 'utf8'));
  const phi = meta.center.lat * DEG;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return { meta, center: meta.center, half: meta.halfSize, mLat, mLon,
    project: (lat, lon) => [(lon - meta.center.lon) * mLon, -(lat - meta.center.lat) * mLat] };
}

/** Compass bearing in degrees (0 = north, clockwise) -> engine facing in radians (0 = south, pi/2 = east). */
export function facingOf(bearing) {
  const a = Math.PI - bearing * DEG;
  return Math.atan2(Math.sin(a), Math.cos(a));
}
const round = v => Math.round(v) + 0; // + 0 turns -0 into 0
const round3 = v => Math.round(v * 1000) / 1000 + 0;
const round1 = v => Math.round(v * 10) / 10 + 0;
const clockMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/**
 * Resolve a position descriptor to [x, z] metres: { lat, lon } | { near, bearing?, m? } | { mid: [a, b], bearing?, m? }
 * | { onStream, frac } | { onRoad, frac } (a terrain stream or road by name, the first with that name; frac of its
 * length inside the map), each optionally offset by { bearing, m }.
 */
export function resolver(frame, landmarks) {
  const at = {};
  for (const [key, l] of Object.entries(landmarks)) at[key] = frame.project(l.lat, l.lon);
  const linePoint = (kind, name, frac) => {
    const s = frame.meta[kind].find(v => v.name === name);
    if (!s) throw new Error(`build-packs: no terrain ${kind === 'roads' ? 'road' : 'stream'} "${name}"`);
    const lim = frame.half - 150, pts = s.points.filter(([x, z]) => Math.abs(x) <= lim && Math.abs(z) <= lim);
    const seg = []; let len = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); len += d; }
    let want = frac * len;
    for (let i = 1; i < pts.length; i++) {
      if (want <= seg[i - 1]) { const t = want / seg[i - 1]; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
      want -= seg[i - 1];
    }
    return pts[pts.length - 1];
  };
  return function resolve(p, label) {
    let base;
    if (p && 'lat' in p) base = frame.project(p.lat, p.lon);
    else if (p && p.near) base = at[p.near];
    else if (p && p.mid) base = p.mid.every(k => at[k]) ? [(at[p.mid[0]][0] + at[p.mid[1]][0]) / 2, (at[p.mid[0]][1] + at[p.mid[1]][1]) / 2] : undefined;
    else if (p && p.onStream) base = linePoint('streams', p.onStream, p.frac ?? 0.5);
    else if (p && p.onRoad) base = linePoint('roads', p.onRoad, p.frac ?? 0.5);
    if (!base) throw new Error(`build-packs: ${label}: unresolvable position ${JSON.stringify(p)}`);
    const m = p.m || 0, b = (p.bearing || 0) * DEG;
    return [round(base[0] + m * Math.sin(b)), round(base[1] - m * Math.cos(b))];
  };
}

/** A deterministic irregular oval: n points, semi-axes rx (along `axis`, a compass bearing) and rz, +/- jitter. */
export function oval([cx, cz], { rx, rz, axis = 90, points = 12, jitter = 0.14, seed = 1 }) {
  const out = [], a0 = axis * DEG, ux = Math.sin(a0), uz = -Math.cos(a0); // the long axis as an (x, z) unit vector
  for (let k = 0; k < points; k++) {
    const t = (k / points) * Math.PI * 2;
    // integer hash in [0, 1): no Math.random, so the polygon never changes between builds
    let h = (seed * 374761393 + k * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
    const j = 1 + jitter * (2 * (h / 4294967296) - 1);
    const a = Math.cos(t) * rx * j, b = Math.sin(t) * rz * j; // a along the axis, b across it
    out.push([round(cx + a * ux - b * uz), round(cz + a * uz + b * ux)]);
  }
  return out;
}

/** Figures the pack route counts for a roster at `ratio` (src/sim/phase.js unitFigures). */
export const figuresAt = (roster, ratio) => roster.reduce((s, u) => s + Math.max(1, Math.round(u.men / (u.type === 'artillery' ? 4 : ratio))) + 6, 0);
export function menPerFigureFor(roster, budget = FIGURE_BUDGET) {
  for (let r = 5; r <= 40; r++) if (figuresAt(roster, r) <= budget) return r;
  throw new Error('build-packs: no men-per-figure ratio from 5 to 40 fits the figure budget');
}

/** One unit row in the engine's key order. */
function unitRow(src, f, phase, resolve, extra) {
  const id = f.id, [x, z] = resolve(f.at, `${phase.id}/${id}`);
  const row = { id, side: src.side, type: src.type, name: src.name, short: src.short };
  const commander = f.commander === null ? null : f.commander ?? src.commander;
  if (commander) row.commander = { name: commander.name, rank: commander.rank };
  row.parent = f.parent ?? src.parent;
  row.regiments = [...(f.regiments ?? src.regiments)];
  row.men = f.men;
  if (src.type === 'artillery') row.guns = f.guns;
  row.weapon = f.weapon;
  row.xp = f.xp;
  row.x = x; row.z = z; row.facing = round3(facingOf(f.bearing));
  if (f.ai) {
    const ai = { role: f.ai.role };
    if (f.ai.at) ai.at = f.ai.at;
    if (f.ai.target) ai.target = resolve(f.ai.target, `${phase.id}/${id} target`);
    if (f.ai.via) ai.via = f.ai.via.map((p, i) => resolve(p, `${phase.id}/${id} via ${i}`));
    row.ai = ai;
  }
  Object.assign(row, extra);
  row.sources = [...new Set(f.sources)];
  row.status = f.status;
  return row;
}

/** Build one pack from its curated module (an object with id, title, terrain, landmarks, formations, phases). */
export function buildPackFrom(src) {
  if (!PACK_ID.test(src.id)) throw new Error(`build-packs: invalid pack id "${src.id}"`);
  // One projection per terrain asset: a phase on another terrain resolves every position about that terrain's centre.
  const resolvers = new Map();
  const resolverFor = name => {
    if (!PACK_ID.test(name)) throw new Error(`build-packs: invalid terrain name "${name}"`);
    if (!resolvers.has(name)) resolvers.set(name, resolver(terrainFrame(name), src.landmarks));
    return resolvers.get(name);
  };
  resolverFor(src.terrain);
  // [item, index in its source list] for the items drawn on `terrain` (an item without `terrain` is drawn everywhere);
  // the index seeds the oval, so a polygon never changes with the terrain filter.
  const on = (list, terrain) => (list || []).map((item, i) => [item, i]).filter(([item]) => !item.terrain || item.terrain === terrain);
  const formations = new Map(src.formations.map(f => [f.id, f]));
  const report = [];
  const phases = src.phases.map((phase, index) => {
    const terrain = phase.terrain ?? src.terrain, resolve = resolverFor(terrain);
    const groundBase = phase.groundBase ?? src.groundBase;
    const ident = id => { const f = formations.get(id); if (!f) throw new Error(`build-packs: ${phase.id}: unknown formation ${id}`); return f; };
    const camera = { target: resolve(phase.camera.target, `${phase.id} camera`), yaw: round3(facingOf(phase.camera.lookBearing) + Math.PI), dist: phase.camera.dist };
    camera.yaw = round3(Math.atan2(Math.sin(camera.yaw), Math.cos(camera.yaw)));
    const units = phase.units.filter(u => !u.arrive).map(u => unitRow(ident(u.id), u, phase, resolve));
    const reinforcements = phase.units.filter(u => u.arrive).map(u => {
      const atSec = round1((clockMin(u.arrive) - clockMin(phase.start)) * 60 / phase.clockRatio);
      return unitRow(ident(u.id), u, phase, resolve, { atSec, noticeSec: Math.min(atSec, 30), entry: u.entry });
    });
    const roster = [...units, ...reinforcements];
    const menPerFigure = menPerFigureFor(roster);
    const [ox, oz] = resolve(phase.objective.at, `${phase.id} objective`);
    const labelAngle = round3(-camera.yaw);
    const scenario = {
      id: `${src.id}-${phase.id}`, title: phase.title, battle: src.battle, subtitle: phase.subtitle, date: phase.date,
      start: phase.start, end: phase.end, terrain, season: src.season, seed: phase.seed,
      clockRatio: phase.clockRatio, menPerFigure, attacker: phase.attacker,
      objective: { name: phase.objective.name, x: ox, z: oz, r: phase.objective.r },
      retreat: Object.fromEntries(Object.entries(phase.retreat).map(([side, p]) => [side, resolve(p, `${phase.id} retreat ${side}`)])),
      camera,
      victory: { ...phase.victory },
      briefing: { text: [...phase.briefing.text], ...(phase.briefing.quote ? { quote: { ...phase.briefing.quote } } : {}), sources: [...phase.briefing.sources] },
      // A woods-based pack clears its named fields; a fields-based pack plants its named woods (src.woods).
      ground: groundBase === 'fields' ? { base: 'fields', treeSpacing: src.treeSpacing }
        : { base: 'woods', clearings: on(src.clearings, terrain).map(([c, i]) => ({ name: c.name, polygon: oval(resolve(c.at, c.name), { ...c.shape, seed: i + 1 }) })), treeSpacing: src.treeSpacing },
      woods: on(src.woods, terrain).map(([w, i]) => ({ name: w.name, polygon: oval(resolve(w.at, w.name), { ...w.shape, seed: i + 1 }) })),
      woodsNote: src.woodsNote,
      sites: on(src.sites, terrain).map(([s]) => { const [x, z] = resolve(s.at, s.name); return { id: s.id, name: s.name, x, z, rot: s.rot, yard: s.yard,
        ...(s.fenceRadius ? { fenceRadius: s.fenceRadius } : {}), source: s.source, buildings: s.buildings.map(b => [...b]), ...(s.orchard ? { orchard: [...s.orchard] } : {}) }; }),
      labels: on(src.labels, terrain).map(([l]) => { const [x, z] = resolve(l.at, l.text); return { text: l.text, x, z, height: l.height, angle: labelAngle, ...(l.italic ? { italic: true } : {}) }; }),
      labelsNote: src.labelsNote,
      units,
      ...(reinforcements.length ? { reinforcements } : {}),
      positionsNote: phase.positionsNote,
      strengthNote: phase.strengthNote,
      historyNote: phase.historyNote,
    };
    const sum = (rows, side, key) => rows.filter(u => !side || u.side === side).reduce((s, u) => s + (u[key] || 0), 0);
    report.push({ phase: phase.id, terrain, formations: roster.length, US: sum(roster, 'US', 'men'), CS: sum(roster, 'CS', 'men'), men: sum(roster, null, 'men'),
      guns: sum(roster, null, 'guns'), ratio: menPerFigure, figures: figuresAt(roster, menPerFigure), clockRatio: phase.clockRatio,
      playSec: (clockMin(phase.end) - clockMin(phase.start)) * 60 / phase.clockRatio, reinforcements: reinforcements.length });
    return { id: phase.id, scenario };
  });
  const pack = { version: 1, id: src.id, title: src.title, phases };
  for (const p of phases) { preparePhase(pack, p.id); prepareFieldScenario(p.scenario, 'pack'); }
  return { pack, report };
}

export async function buildPack(id) {
  if (!PACK_ID.test(id)) throw new Error(`build-packs: invalid pack id "${id}"`);
  const mod = await import(pathToFileURL(path.join(ROOT, 'tools', 'packs', `${id}.mjs`)).href);
  return buildPackFrom(mod.PACK);
}

/**
 * Pretty JSON with a stable layout: objects one key per line; arrays of numbers (and arrays of number pairs, such as
 * polygons and AI routes) on one line, so the file stays small and readable.
 */
export function serialize(value) {
  const flat = v => Array.isArray(v) && v.every(x => typeof x === 'number' || (Array.isArray(x) && x.every(y => typeof y === 'number')));
  const out = (v, pad) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (flat(v)) return JSON.stringify(v);
    const inner = pad + '  ';
    if (Array.isArray(v)) return v.length ? `[\n${v.map(x => inner + out(x, inner)).join(',\n')}\n${pad}]` : '[]';
    const keys = Object.keys(v);
    return keys.length ? `{\n${keys.map(k => `${inner}${JSON.stringify(k)}: ${out(v[k], inner)}`).join(',\n')}\n${pad}}` : '{}';
  };
  return out(value, '') + '\n';
}

export const packFile = id => path.join(ROOT, 'assets', 'packs', `${id}.json`);

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const id = process.argv[2];
  if (!id || id.startsWith('--')) { console.error('usage: node tools/build-packs.mjs <packId> [--check]'); process.exit(2); }
  const { pack, report } = await buildPack(id);
  const text = serialize(pack), file = packFile(id);
  console.table(report);
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
    console.log(same ? `PACK ${id} UP TO DATE (${Buffer.byteLength(text)} bytes)` : `PACK ${id} DIFFERS from a fresh build`);
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`PACK ${id} WRITTEN ${path.relative(ROOT, file)} (${Buffer.byteLength(text)} bytes, ${pack.phases.length} phases)`);
}

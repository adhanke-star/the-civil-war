// CPU check: wooded battlefields (scenario.ground: { base: 'fields' | 'woods', clearings?, treeSpacing? }).
// src/world/landscape.js (setPlan, inForest, placeTreesWithin and the TREE_BUDGET cap), src/world/ground-paint.js
// (the forest-floor mask), src/world/props.js (tree chunk far culling beside the hi/lo swap), src/world/world.js
// (planGround) and src/sim/phase.js (validation of the ground field).
// Henry Hill (and the first-command practice ground, which reuses it) must place exactly the trees, fences and
// paint of the parent commit 32a7b38: the counts and hashes below were recorded there with this file's own
// harness. The Shiloh case uses the real terrain (assets/terrain/shiloh.json + .bin) with a FICTIONAL fixture of
// 12 clearings, two fixture farms and one fixture wood: test geometry only, not a historical claim.
// `node tools/test-ground.mjs` prints GROUND OK (n/n) with the Shiloh tree count and effective spacing;
// `--prove-fail` also runs one mutant per check and requires each to fail its own check's assertion text.
// No browser, no GPU, writes nothing. The 2D canvas is a recording stub that rasterises the mask's polygon fills.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { setPlan, placeTrees, placeTreesWithin, pointInPolygon, PLAN, TREE_BUDGET, TREE_SPACING } from '../src/world/landscape.js';
import { paintGround } from '../src/world/ground-paint.js';
import { buildTrees } from '../src/world/props.js';
import { planGround, FOG_FAR } from '../src/world/world.js';
import { TerrainData, EXAGGERATION } from '../src/world/terrain.js';
import { prepareFieldScenario, GROUND_LIMITS } from '../src/sim/phase.js';
import { introScenario } from '../src/franchise/intro.js';

// Recorded at the parent commit 32a7b38 (unmodified world code) with fnv()/listHash()/paintHash() below.
const BASELINE = Object.freeze({ trees: 14805, treeHash: '9025e7b1', fences: 2093, fenceHash: '21237872', paintHash: '399dd9e8' });
const SUN = Object.freeze({ x: -0.8, y: 0.5, z: 0.34 });
const ROOT = new URL('../', import.meta.url);
const HH = JSON.parse(fs.readFileSync(new URL('assets/scenarios/henry-hill.json', ROOT)));
const copy = structuredClone;

// ---------------------------------------------------------------------------------------------------
// Harness: hashing, terrain decode (the same as loadTerrainData, read from disk) and a recording canvas.
function fnv(values) {
  let h = 0x811c9dc5;
  for (const v of values) {
    const n = typeof v === 'number' ? Math.round(v * 1e4) : v;
    const s = String(n);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 0x2c; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const listHash = (rows) => fnv(rows.flat());

function loadTerrain(name) {
  const meta = JSON.parse(fs.readFileSync(new URL(`assets/terrain/${name}.json`, ROOT)));
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const G = meta.grid;
  assert.equal(q.length, G * G, `${name} heightmap sample count`);
  const heights = new Float32Array(G * G);
  const k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  return new TerrainData(meta, heights);
}

// A recording 2D canvas: logs every call and set; fills with '#fff'/'#000' rasterise (scanline, even-odd) so
// the woods mask's getImageData returns real coverage.
function installCanvasStub() {
  let ids = 0;
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1e3) / 1e3 : v && v.__id !== undefined ? `canvas#${v.__id}` : v);
  class Ctx {
    constructor(canvas) { this.canvas = canvas; this.log = []; this.path = []; this.state = { fillStyle: '#000' }; this.pixels = null; this.lastPut = null; }
    rec(name, args) { this.log.push(name + '(' + args.map(round).join(',') + ')'); }
    set fillStyle(v) { this.state.fillStyle = v; this.rec('fillStyle=', [typeof v === 'string' ? v : 'gradient']); }
    get fillStyle() { return this.state.fillStyle; }
    buf() { if (!this.pixels) this.pixels = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4); return this.pixels; }
    lum() { const s = this.state.fillStyle; return s === '#fff' ? 255 : s === '#000' ? 0 : null; }
    fillRect(x, y, w, h) {
      this.rec('fillRect', [x, y, w, h]);
      const v = this.lum(); if (v === null) return;
      const W = this.canvas.width, H = this.canvas.height, b = this.buf();
      for (let py = Math.max(0, Math.round(y)); py < Math.min(H, Math.round(y + h)); py++)
        for (let px = Math.max(0, Math.round(x)); px < Math.min(W, Math.round(x + w)); px++) { const k = (py * W + px) * 4; b[k] = b[k + 1] = b[k + 2] = v; b[k + 3] = 255; }
    }
    beginPath() { this.rec('beginPath', []); this.path = []; }
    moveTo(x, y) { this.rec('moveTo', [x, y]); this.path.push([[x, y]]); }
    lineTo(x, y) { this.rec('lineTo', [x, y]); if (!this.path.length) this.path.push([]); this.path[this.path.length - 1].push([x, y]); }
    closePath() { this.rec('closePath', []); }
    fill() {
      this.rec('fill', []);
      const v = this.lum(); if (v === null) return;
      const W = this.canvas.width, H = this.canvas.height, b = this.buf();
      const edges = [];
      for (const sub of this.path) for (let i = 0; i < sub.length; i++) edges.push([sub[i], sub[(i + 1) % sub.length]]);
      for (let py = 0; py < H; py++) {
        const y = py + 0.5, xs = [];
        for (const [[x0, y0], [x1, y1]] of edges) if ((y0 > y) !== (y1 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        xs.sort((a, c) => a - c);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          for (let px = Math.max(0, Math.ceil(xs[i] - 0.5)); px < Math.min(W, Math.ceil(xs[i + 1] - 0.5)); px++) { const k = (py * W + px) * 4; b[k] = b[k + 1] = b[k + 2] = v; b[k + 3] = 255; }
        }
      }
    }
    getImageData(x, y, w, h) { this.rec('getImageData', [x, y, w, h]); return { data: this.buf().slice() }; }
    createImageData(w, h) { this.rec('createImageData', [w, h]); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
    putImageData(img, x, y) { this.lastPut = img; this.rec('putImageData', [fnv(img.data), x, y]); }
    createRadialGradient(...a) { this.rec('createRadialGradient', a); const self = this; return { addColorStop(...s) { self.rec('addColorStop', s); } }; }
  }
  for (const m of ['drawImage', 'stroke', 'arc', 'ellipse', 'save', 'restore', 'translate', 'rotate']) Ctx.prototype[m] = function (...a) { this.rec(m, a); };
  for (const p of ['strokeStyle', 'lineWidth', 'lineJoin', 'lineCap', 'imageSmoothingEnabled', 'imageSmoothingQuality']) {
    Object.defineProperty(Ctx.prototype, p, { set(v) { this.state[p] = v; this.rec(p + '=', [v]); }, get() { return this.state[p]; } });
  }
  const canvases = [];
  globalThis.document = { createElement(tag) {
    if (tag !== 'canvas') throw new Error('the stub only makes canvases');
    const c = { __id: ids++, width: 300, height: 150, ctx: null, getContext() { if (!c.ctx) c.ctx = new Ctx(c); return c.ctx; } };
    canvases.push(c);
    return c;
  } };
  return canvases;
}
const paintHash = (canvases) => fnv(canvases.flatMap((c) => (c.ctx ? c.ctx.log : [])));
function paint(api, terrain, plan) {
  const canvases = installCanvasStub();
  try { api.paintGround(terrain, plan.parcels, terrain.meta.roads, terrain.meta.streams, plan.trees, SUN); }
  finally { delete globalThis.document; }
  return canvases;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures. The Shiloh ground: a woods base with 12 fictional clearings (irregular octagons), a fictional wood
// inside clearing 0, two fictional farms inside clearings 1 and 2 and one in the forest (the site margin).
function octagon(cx, cz, r, seed) {
  return Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2, rr = r * (0.8 + 0.4 * (((seed * 7 + k * 13) % 10) / 10));
    return [Math.round(cx + Math.cos(a) * rr), Math.round(cz + Math.sin(a) * rr)];
  });
}
const CLEARING_AT = [[-1800, -1700, 380], [-600, -1900, 300], [700, -1600, 420], [1800, -1800, 320], [-1900, -300, 350], [-500, -500, 400],
  [900, -200, 300], [1900, 100, 380], [-1600, 1300, 420], [-200, 1100, 300], [1000, 1500, 360], [2000, 1900, 300]];
const FOREST_SITE = { x: 300, z: 600 }; // inside no clearing
function shilohScenario() {
  const s = copy(HH);
  s.terrain = 'shiloh';
  s.ground = { base: 'woods', clearings: CLEARING_AT.map(([x, z, r], i) => ({ name: `fixture clearing ${i + 1}`, polygon: octagon(x, z, r, i + 1) })) };
  s.woods = [{ polygon: octagon(-1800, -1700, 110, 3) }];
  s.sites = [{ x: -600, z: -1900, fenceRadius: 200 }, { x: 700, z: -1600, fenceRadius: 200, orchard: [60, 0, 5, 4, 0.2] },
    { x: FOREST_SITE.x, z: FOREST_SITE.z }];
  s.labels = [];
  return s;
}
const CLEARINGS = shilohScenario().ground.clearings.map((c) => c.polygon);
const FIXTURE_WOOD = shilohScenario().woods[0].polygon;
const inAnyClearing = (x, z) => CLEARINGS.some((p) => pointInPolygon(x, z, p));

let HH_TERRAIN, SHILOH;
const terrains = () => { HH_TERRAIN ??= loadTerrain('henry-hill'); SHILOH ??= loadTerrain('shiloh'); };
// Plans memoised per planGround function (each mutant gets its own).
const memo = new Map();
function shilohPlan(api) {
  terrains();
  if (!memo.has(api.planGround)) memo.set(api.planGround, api.planGround(SHILOH, shilohScenario()));
  setPlan(shilohScenario());
  return memo.get(api.planGround);
}

// ---------------------------------------------------------------------------------------------------
const FIELD_ERR = /^Error: Field: /;
function refuses(name, fn, pattern) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error && pattern.test(String(error)), `${name}: refused with ${pattern} (got ${error ? String(error) : 'acceptance'})`);
}
function accepts(name, fn) {
  try { return fn(); } catch (e) { assert.fail(`${name}: accepted (got ${e.message})`); }
}

const GROUND_CHECKS = [
  ['henry-hill-identity', (api) => {
    terrains();
    for (const [label, scenario] of [['henry-hill', HH], ['first-command', introScenario(HH)]]) {
      const g = api.planGround(HH_TERRAIN, scenario);
      assert.equal(g.trees.length, BASELINE.trees, `henry-hill-identity: ${label} tree count`);
      assert.equal(listHash(g.trees), BASELINE.treeHash, `henry-hill-identity: ${label} tree list hash`);
      assert.equal(g.fences.length, BASELINE.fences, `henry-hill-identity: ${label} fence count`);
      assert.equal(listHash(g.fences), BASELINE.fenceHash, `henry-hill-identity: ${label} fence list hash`);
      assert.equal(g.treeSpacing, TREE_SPACING.default, `henry-hill-identity: ${label} effective spacing`);
    }
    const group = api.buildTrees(HH_TERRAIN, api.planGround(HH_TERRAIN, HH).trees);
    assert.equal(group.userData.count, BASELINE.trees, 'henry-hill-identity: instanced tree count');
  }],
  ['henry-hill-paint', (api) => {
    terrains();
    const g = planGround(HH_TERRAIN, HH);
    assert.equal(paintHash(paint(api, HH_TERRAIN, g)), BASELINE.paintHash, 'henry-hill-paint: ground paint command and pixel hash');
  }],
  ['woods-forest', (api) => {
    const g = shilohPlan(api);
    const forest = g.trees.slice(0, g.forest).filter(([x, z, , kind]) => kind !== 2 && !inAnyClearing(x, z));
    const half = SHILOH.half - 8;
    const expected = ((2 * half) ** 2 * 0.8) / g.treeSpacing ** 2; // most of the square is forest
    assert.ok(forest.length > expected * 0.6, `woods-forest: forest trees outside the clearings (${forest.length}, expected about ${Math.round(expected)})`);
    // spread: every 1 km block of the forest square holds trees
    const blocks = new Set(forest.map(([x, z]) => `${Math.floor((x + half) / 1000)},${Math.floor((z + half) / 1000)}`));
    assert.ok(blocks.size >= 25, `woods-forest: trees spread over the forest (${blocks.size} km blocks)`);
  }],
  ['woods-clearings', (api) => {
    const g = shilohPlan(api);
    const forest = g.trees.slice(0, g.forest);
    const stray = forest.filter(([x, z]) => inAnyClearing(x, z) && !pointInPolygon(x, z, FIXTURE_WOOD));
    assert.equal(stray.length, 0, `woods-clearings: no woods-grid tree inside a clearing outside its woods (${stray.length})`);
    const farm = g.trees.slice(g.forest).filter(([x, z]) => inAnyClearing(x, z));
    assert.ok(farm.length > 50, `woods-clearings: clearings keep their field and farm trees (${farm.length})`);
  }],
  ['woods-in-clearing', (api) => {
    const g = shilohPlan(api);
    const inWood = g.trees.slice(0, g.forest).filter(([x, z]) => pointInPolygon(x, z, FIXTURE_WOOD));
    assert.ok(inWood.length >= 10, `woods-in-clearing: a woods polygon inside a clearing still grows forest (${inWood.length})`);
  }],
  ['woods-fences', (api) => {
    const g = shilohPlan(api);
    const inForest = g.fences.filter(([x, z]) => !inAnyClearing(x, z));
    assert.equal(inForest.length, 0, `woods-fences: no fence in the forest (${inForest.length})`);
    assert.ok(g.fences.length > 50, `woods-fences: clearings keep their road and farm fences (${g.fences.length})`);
  }],
  ['road-margin', (api) => marginCheck(api, 'road-margin', (g, x, z) => g.roadField.dist(x, z) < 9)],
  ['stream-margin', (api) => marginCheck(api, 'stream-margin', (g, x, z) => g.streamField.dist(x, z) < 3)],
  ['site-margin', (api) => marginCheck(api, 'site-margin', (g, x, z) => Math.hypot(x - FOREST_SITE.x, z - FOREST_SITE.z) < 45 * 1.8 * 0.8)],
  ['budget', (api) => {
    const g = shilohPlan({ planGround });
    const budget = 20000;
    const run = () => { setPlan(shilohScenario()); return api.placeTreesWithin(SHILOH, SHILOH.meta.streams, g.roadField, g.streamField, g.parcels, { budget }); };
    const a = run(), b = run();
    assert.ok(a.trees.length <= budget, `budget: ${a.trees.length} trees within a budget of ${budget}`);
    assert.ok(a.trees.length >= budget * 0.8, `budget: the raised spacing still fills most of the budget (${a.trees.length})`);
    assert.ok(a.spacing > a.requested && Number.isInteger(a.spacing * 2), `budget: spacing raised in 0.5 m steps (${a.requested} -> ${a.spacing})`);
    assert.equal(listHash(a.trees), listHash(b.trees), 'budget: deterministic placement');
  }],
  ['validation', (api) => {
    const field = (ground, mutate) => { const s = copy(HH); s.ground = ground; mutate?.(s); return () => api.prepareFieldScenario(s, 'henry-hill'); };
    const ok = shilohScenario().ground;
    accepts('validation woods', field({ ...ok, treeSpacing: 20 }));
    accepts('validation fields', field({ base: 'fields', treeSpacing: 13 }));
    accepts('validation absent', () => api.prepareFieldScenario(copy(HH), 'henry-hill'));
    const bad = [
      ['base', field({ base: 'jungle' }), /ground base must be fields or woods/],
      ['no base', field({ clearings: [] }), /ground base must be fields or woods/],
      ['extra key', field({ base: 'woods', trees: 3 }), /ground has unsupported fields/],
      ['not a record', field([]), /ground has unsupported fields/],
      ['spacing low', field({ base: 'woods', treeSpacing: 12 }), /tree spacing must be from 13 to 30/],
      ['spacing high', field({ base: 'woods', treeSpacing: 31 }), /tree spacing must be from 13 to 30/],
      ['spacing text', field({ base: 'woods', treeSpacing: '20' }), /tree spacing must be from 13 to 30/],
      ['clearings on fields', field({ base: 'fields', clearings: [] }), /clearings need a woods ground base/],
      ['too many', field({ base: 'woods', clearings: Array.from({ length: GROUND_LIMITS.clearings + 1 }, (_, i) => ({ name: `c${i}`, polygon: octagon(0, 0, 50, i) })) }), /clearing count is invalid/],
      ['two vertices', field({ base: 'woods', clearings: [{ name: 'c', polygon: [[0, 0], [10, 0]] }] }), /clearing polygon is invalid/],
      ['far vertex', field({ base: 'woods', clearings: [{ name: 'c', polygon: [[0, 0], [10, 0], [0, 1e6]] }] }), /clearing polygon is invalid/],
      ['no name', field({ base: 'woods', clearings: [{ polygon: octagon(0, 0, 50, 1) }] }), /clearing polygon is invalid/],
      ['clearing extra', field({ base: 'woods', clearings: [{ name: 'c', polygon: octagon(0, 0, 50, 1), crop: 'corn' }] }), /clearing polygon is invalid/],
      // the woods and clearings share the 4096-vertex ground budget
      ['vertex budget', field({ base: 'woods', clearings: Array.from({ length: 4 }, (_, i) => ({ name: `c${i}`, polygon: Array.from({ length: 1024 }, (_, k) => [Math.cos(k / 163) * 300, Math.sin(k / 163) * 300 + i]) })) }), /clearing polygon is invalid/],
    ];
    for (const [label, fn, pattern] of bad) refuses(`validation ${label}`, fn, new RegExp(FIELD_ERR.source + '.*' + pattern.source));
  }],
  ['shiloh-budget', (api) => {
    const g = shilohPlan(api);
    SHILOH_RUN.trees = g.trees.length; SHILOH_RUN.spacing = g.treeSpacing; SHILOH_RUN.requested = g.treeSpacingRequested;
    assert.ok(g.trees.length <= TREE_BUDGET, `shiloh-budget: ${g.trees.length} trees within ${TREE_BUDGET}`);
    assert.ok(g.treeSpacing >= TREE_SPACING.min && g.treeSpacing >= g.treeSpacingRequested, `shiloh-budget: effective spacing ${g.treeSpacing} m reported`);
    const group = buildTrees(SHILOH, g.trees);
    assert.equal(group.userData.count, g.trees.length, 'shiloh-budget: every placed tree is instanced');
  }],
  ['woods-paint', (api) => {
    const g = shilohPlan({ planGround });
    const canvases = paint(api, SHILOH, g);
    const P = 1024, size = SHILOH.size, half = SHILOH.half;
    const at = (x, z) => (Math.floor(((z + half) / size) * P) * P + Math.floor(((x + half) / size) * P)) * 4;
    const mask = canvases[0].ctx.pixels, field = canvases[1].ctx.lastPut.data, info = canvases[2].ctx.lastPut.data;
    const forestPt = at(-2400, 2400), clearingPt = at(-500, -500), woodPt = at(-1800, -1700);
    assert.equal(mask[forestPt], 255, 'woods-paint: forest floor outside the clearings');
    assert.equal(mask[clearingPt], 0, 'woods-paint: open farmland inside a clearing');
    assert.equal(mask[woodPt], 255, 'woods-paint: a woods polygon inside a clearing is forest floor');
    // the woods floor tone [40, 54, 24] x noise 0.85-1.15, and no brush stroke on it
    assert.ok(field[forestPt] >= 33 && field[forestPt] <= 47 && field[forestPt + 1] >= 45 && field[forestPt + 1] <= 63, `woods-paint: woods floor tone (${field[forestPt]}, ${field[forestPt + 1]})`);
    assert.equal(info[forestPt + 1], 0, 'woods-paint: no field brush stroke in the forest');
  }],
  ['chunk-cull', (api) => {
    // trees every 40 m along +x from -1000 to 9000 m (z = 0, flat ground), camera at the origin looking along +x
    const flat = { heightAt: () => 0 };
    const trees = []; for (let x = -1000; x <= 9000; x += 40) trees.push([x, 0, 6, 0]);
    const group = api.buildTrees(flat, trees, { far: FOG_FAR });
    const camera = new THREE.PerspectiveCamera(32, 16 / 9, 2, 20000);
    camera.position.set(0, 50, 0); camera.lookAt(1000, 50, 0); camera.updateMatrixWorld();
    group.userData.updateLod(camera, 500);
    const meshes = group.children.map((m) => ({ m, x: m.boundingSphere.center.x, r: m.boundingSphere.radius }));
    const hidden = meshes.filter((c) => !c.m.visible);
    assert.ok(hidden.length > 0 && hidden.every((c) => c.x - c.r > FOG_FAR), `chunk-cull: chunks wholly beyond the fog depth hidden (${hidden.length})`);
    assert.ok(meshes.filter((c) => c.x + c.r < FOG_FAR).every((c) => c.m.visible), 'chunk-cull: chunks inside the fog depth stay drawn');
    assert.ok(meshes.filter((c) => c.x < 0).every((c) => c.m.visible), 'chunk-cull: chunks behind the camera are left to the frustum');
    const near = meshes.find((c) => Math.abs(c.x) < 200), mid = meshes.find((c) => c.x > 1500 && c.x < 2500);
    assert.ok(near.m.geometry.attributes.position.count > mid.m.geometry.attributes.position.count, 'chunk-cull: hi/lo swap kept (near chunk detailed, mid chunk low)');
    camera.position.set(8000, 50, 0); camera.lookAt(9000, 50, 0); camera.updateMatrixWorld();
    group.userData.updateLod(camera, 500);
    assert.ok(meshes.filter((c) => c.x > 8000).every((c) => c.m.visible), 'chunk-cull: hidden chunks return when the camera comes near');
  }],
  ['cull-no-alloc', (api) => {
    const group = api.buildTrees({ heightAt: () => 0 }, [[0, 0, 6, 0], [400, 0, 6, 1]]);
    const src = String(group.userData.updateLod);
    assert.ok(!/\bnew\s|\.clone\(|\[\s*\]|\{\s*\}|=>\s*\(\{|\.map\(|\.filter\(/.test(src), 'cull-no-alloc: the per-frame LOD and cull path allocates nothing');
  }],
];
const SHILOH_RUN = { trees: 0, spacing: NaN, requested: NaN };

function marginCheck(api, name, near) {
  const g = shilohPlan({ planGround });
  setPlan(shilohScenario());
  const r = api.placeTreesWithin(SHILOH, SHILOH.meta.streams, g.roadField, g.streamField, g.parcels);
  setPlan(shilohScenario());
  const close = r.trees.slice(0, r.forest).filter(([x, z]) => near(g, x, z));
  assert.equal(close.length, 0, `${name}: woods-grid trees keep the tree-free margin (${close.length} inside it)`);
}

const API = { planGround, placeTreesWithin, paintGround, buildTrees, prepareFieldScenario };
const FAR_FIELD = { dist: () => 1e9 };
const withGround = (mutate) => (terrain, scenario, opts) => { const s = copy(scenario); mutate(s); return planGround(terrain, s, opts); };
const forcingBase = (base) => (...args) => { const was = PLAN.ground.base; PLAN.ground.base = base; try { return paintGround(...args); } finally { PLAN.ground.base = was; } };
// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  // a fields-base ground whose woods grid is not today's (spacing drifts)
  'henry-hill-identity': { planGround: withGround((s) => { s.ground = { base: 'fields', treeSpacing: 13.5 }; }) },
  // the paint treats an absent ground as woods
  'henry-hill-paint': { paintGround: forcingBase('woods') },
  // the woods base ignored: forest only inside woods polygons
  'woods-forest': { planGround: withGround((s) => { s.ground.base = 'fields'; delete s.ground.clearings; }) },
  // the clearings ignored: forest everywhere
  'woods-clearings': { planGround: withGround((s) => { s.ground.clearings = []; }) },
  // a woods polygon inside a clearing ignored
  'woods-in-clearing': { planGround: withGround((s) => { s.woods = []; }) },
  // fences use the woods polygons only, not the forest cover
  'woods-fences': { planGround: withGround((s) => { s.ground.base = 'fields'; delete s.ground.clearings; }) },
  // the woods grid ignores roads, streams or sites
  'road-margin': { placeTreesWithin: (t, st, rf, sf, p, o) => placeTreesWithin(t, st, FAR_FIELD, sf, p, o) },
  'stream-margin': { placeTreesWithin: (t, st, rf, sf, p, o) => placeTreesWithin(t, st, rf, FAR_FIELD, p, o) },
  'site-margin': { placeTreesWithin: (...a) => { const sites = PLAN.sites; PLAN.sites = []; try { return placeTreesWithin(...a); } finally { PLAN.sites = sites; } } },
  // the budget not enforced
  'budget': { placeTreesWithin: (t, st, rf, sf, p) => placeTreesWithin(t, st, rf, sf, p, { budget: Infinity }) },
  // the ground field never validated
  'validation': { prepareFieldScenario: (s, route) => { const t = copy(s); delete t.ground; return prepareFieldScenario(t, route); } },
  // the Shiloh plan placed without the cap
  'shiloh-budget': { planGround: (terrain, s, o) => { const g = planGround(terrain, s, o); return { ...g, trees: placeTrees(terrain, terrain.meta.streams, g.roadField, g.streamField, g.parcels, { spacing: g.treeSpacingRequested }) }; } },
  // the paint ignores the woods base
  'woods-paint': { paintGround: forcingBase('fields') },
  // the far radius ignored (every chunk always drawn, as before)
  'chunk-cull': { buildTrees: (t, list, o) => { const g = buildTrees(t, list, o); const lod = g.userData.updateLod; g.userData.updateLod = (c, n) => lod(c, n, Infinity); return g; } },
  // a per-frame allocation in the LOD path
  'cull-no-alloc': { buildTrees: (t, list, o) => { const g = buildTrees(t, list, o); const lod = g.userData.updateLod; g.userData.updateLod = (c, n) => { const v = new THREE.Vector3(); return lod(c, n, v.x + FOG_FAR); }; return g; } },
};

export function groundUnit(api = API) {
  for (const [, check] of GROUND_CHECKS) check(api);
  return GROUND_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const t0 = performance.now();
  const count = groundUnit();
  console.log(`GROUND Shiloh fixture (12 clearings): ${SHILOH_RUN.trees} trees, spacing ${SHILOH_RUN.requested} -> ${SHILOH_RUN.spacing} m (budget ${TREE_BUDGET}); ${Math.round(performance.now() - t0)} ms`);
  console.log(`GROUND OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of GROUND_CHECKS) {
      assert.ok(MUTANTS[name], `${name} has a mutant`);
      let error; try { check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      rows.push(`${name}: ${error.message.split('\n')[0]}`);
    }
    for (const row of rows) console.log('  mutant ' + row);
    console.log(`GROUND PROVE-FAIL OK (${rows.length}/${rows.length})`);
  }
}

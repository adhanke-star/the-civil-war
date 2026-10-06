// Report only. Original approved PNGs stay on Actions; no codec, runtime or source mutation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { Post } from '../../src/render/post.js';
import { SOURCE, groupsOf, validateApproved, mipBytes, sha256 } from './compress.mjs';

export const HISTORICAL = { run: 37360904656, sha: '3f439b0d326d0a27d7a46a599751890a63ed2afc', artifact: 'compression-review' };
export const LIMITS = { downloadBytes: 200000000, sceneBytes: 250000000 };
const fail = (message) => { throw new Error(`figure residency: ${message}`); };
const sum = (pages, field) => pages.reduce((n, p) => n + p[field], 0);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Independently bind all original PNGs against the historical full-pack report, not its KTX manifest. */
export function bindApproved(manifestBytes, historicalBytes, readPage) {
  const manifestHash = sha256(manifestBytes), historicalHash = sha256(historicalBytes);
  const manifest = JSON.parse(manifestBytes), historical = JSON.parse(historicalBytes);
  const counts = validateApproved(manifest);
  if (!equal(Object.keys(groupsOf(manifest.tiers.close)), Object.keys(groupsOf(manifest.tiers.field)))) fail('cross-tier ordered look identity');
  if (!equal(historical.source, SOURCE) || historical.toolSha !== HISTORICAL.sha
    || !equal(historical.counts, counts) || historical.diagnosticOnly || historical.mode
    || historical.pages?.length !== 45) fail('historical source/tool/full-pack binding');
  const byFile = new Map();
  for (const row of historical.pages) {
    if (byFile.has(row.source)) fail('duplicate historical original page');
    byFile.set(row.source, row);
  }
  const pages = [];
  for (const tier of ['close', 'field']) for (const [look, group] of Object.entries(groupsOf(manifest.tiers[tier]))) {
    for (const [index, p] of group.pages.entries()) {
      const row = byFile.get(p.file), bytes = readPage(p.file);
      if (!row || row.tier !== tier || row.look !== look || row.width !== p.w || row.height !== p.h
        || row.pngBytes !== bytes.length || row.pngSha256 !== sha256(bytes)) fail(`${p.file}: original PNG binding`);
      const png = PNG.sync.read(bytes), allocation = mipBytes(p.w, p.h);
      if (png.width !== p.w || png.height !== p.h || !equal(row.allocation, allocation)) fail(`${p.file}: dimensions/mip allocation`);
      if (!Number.isSafeInteger(row.bytes) || row.bytes <= 0 || !/^[a-f0-9]{64}$/.test(row.ktxSha256)) fail(`${p.file}: incomplete historical row`);
      pages.push({ file: p.file, tier, look, index, width: p.w, height: p.h, pngBytes: bytes.length,
        pngSha256: row.pngSha256, baseRgbaBytes: p.w * p.h * 4, gpuRgbaMipBytes: allocation.rgba8,
        block16MipBytes: allocation.block16, mipLevels: allocation.levels });
    }
  }
  if (pages.length !== 45 || pages.some((p) => !byFile.delete(p.file)) || byFile.size) fail('missing/extra original pages');
  if (historical.rgba8Bytes !== sum(pages, 'gpuRgbaMipBytes') || historical.block16Bytes !== sum(pages, 'block16MipBytes')
    || historical.ktxBytes !== sum(historical.pages, 'bytes')) fail('historical totals disagree');
  if (sha256(manifestBytes) !== manifestHash || sha256(historicalBytes) !== historicalHash) fail('input bytes changed');
  return { manifest, counts, pages, manifestHash, historicalHash };
}

/** All directions/frames of the named clips; no eight-counter telemetry or numerical look aliasing. */
export function pageDemand(manifest, tier, looks, clips = Object.keys(manifest.clips)) {
  const groups = groupsOf(manifest.tiers[tier]), files = new Set(); let frames = 0;
  if (!looks.length || !clips.length || new Set(looks).size !== looks.length || new Set(clips).size !== clips.length) fail('empty/duplicate demand');
  for (const look of looks) {
    const group = groups[look]; if (!group) fail('unknown demanded look');
    for (const clip of clips) {
      const spec = manifest.clips[clip], dirs = manifest.tiers[tier].directionsByClip[clip];
      if (!spec || !dirs?.length) fail('unknown/empty demanded clip');
      for (let k = 0; k < spec.frames.length; k++) for (const d of dirs) {
        const frame = group.frames[`${clip}_${k}_d${String(d).padStart(2, '0')}`];
        const p = group.pages[frame?.page]; if (!p) fail('missing demanded frame/page');
        files.add(p.file); frames++;
      }
    }
  }
  return { tier, looks, clips, frames, files: [...files].sort() };
}

/** Reservations include outstanding allocations, including work that may complete after a view change. */
export function account(pages, { loaded = [], pending = [], decodeConcurrency = 1, retryCopies = 0, poolCapacities = [] } = {}) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const select = (files) => {
    if (new Set(files).size !== files.length) fail('duplicate resident/reserved page');
    return files.map((f) => { const p = byFile.get(f); if (!p) fail('unknown resident/reserved page'); return p; });
  };
  const resident = select(loaded), outstanding = select(pending);
  if (pending.some((f) => loaded.includes(f))) fail('pending reservation duplicates a resident page');
  if (!Number.isInteger(decodeConcurrency) || decodeConcurrency < 1 || !Number.isInteger(retryCopies) || retryCopies < 0
    || poolCapacities.some((c) => !Number.isSafeInteger(c) || c < 0)) fail('invalid accounting assumption');
  const reserved = [...resident, ...outstanding], copies = outstanding.map((p) => p.baseRgbaBytes).sort((a, b) => b - a).slice(0, decodeConcurrency);
  const result = { loadedPages: loaded.length, pendingPages: pending.length,
    loadedGpuBytes: sum(resident, 'gpuRgbaMipBytes'), pendingGpuReservationBytes: sum(outstanding, 'gpuRgbaMipBytes'),
    totalGpuReservationBytes: sum(reserved, 'gpuRgbaMipBytes'),
    retainedDecodedImageAssumptionBytes: sum(reserved, 'baseRgbaBytes'),
    extraDecodeAndUploadCopiesAssumptionBytes: copies.reduce((s, b) => s + b * 2, 0),
    encodedInFlightAssumptionBytes: sum(outstanding, 'pngBytes'),
    uniquePngDownloadBytes: sum(reserved, 'pngBytes'),
    transmittedPngBytesWithRetries: sum(reserved, 'pngBytes') + sum(outstanding, 'pngBytes') * retryCopies,
    // Each page has one shared body/soft interleaved buffer per side pool, 12 Float32s per slot.
    instanceGpuBytes: reserved.length * poolCapacities.reduce((s, c) => s + c, 0) * 12 * 4,
    instanceCpuBytes: reserved.length * poolCapacities.reduce((s, c) => s + c, 0) * 12 * 4,
    decodeConcurrency, retryCopies, poolCapacities };
  result.figuresGpuAndBufferMinimumBytes = result.totalGpuReservationBytes + result.instanceGpuBytes;
  result.modelledGpuAndCpuBytes = result.figuresGpuAndBufferMinimumBytes + result.instanceCpuBytes
    + result.retainedDecodedImageAssumptionBytes + result.extraDecodeAndUploadCopiesAssumptionBytes + result.encodedInFlightAssumptionBytes;
  result.sceneGpuRemainderBytes = LIMITS.sceneBytes - result.figuresGpuAndBufferMinimumBytes;
  result.modelledGpuCpuRemainderBytes = LIMITS.sceneBytes - result.modelledGpuAndCpuBytes;
  result.pngDownloadWithinLimit = result.transmittedPngBytesWithRetries <= LIMITS.downloadBytes;
  result.totalSceneWithinLimit = null; // the rest of the scene and browser/driver memory are unmeasured
  return result;
}

export function estimate(bound, poolCapacities = []) {
  const { manifest, pages } = bound;
  const allLooks = Object.keys(groupsOf(manifest.tiers.field));
  const eligible = allLooks.filter((look) => {
    const t = manifest.tiers.field, composition = look === 'base' ? t.baseComposition : t.variants[look].composition;
    return composition.use !== 'usct';
  });
  if (allLooks.length !== 9 || eligible.length !== 8) fail('look eligibility inventory');
  const field = pageDemand(manifest, 'field', allLooks), close = pageDemand(manifest, 'close', allLooks);
  const eligibleField = pageDemand(manifest, 'field', eligible), eligibleClose = pageDemand(manifest, 'close', eligible);
  const demands = [field, close, eligibleField, eligibleClose,
    ...Object.keys(manifest.clips).map((clip) => pageDemand(manifest, 'close', eligible, [clip]))];
  const scenario = (label, policy, assumptions) => ({ label, policy, ...account(pages, { poolCapacities, ...assumptions }) });
  // A single page per look is only a bound; it never certifies coverage of all poses or directions.
  const closeGroups = groupsOf(manifest.tiers.close);
  const extremes = (descending) => eligible.map((look) => [...closeGroups[look].pages]
    .sort((a, b) => (a.w * a.h - b.w * b.h) * (descending ? -1 : 1))[0].file);
  const scenarios = [
    scenario('Current loader: field complete', 'CURRENT ALL-TIER', { loaded: field.files }),
    scenario('Current loader: close outstanding, field retained', 'CURRENT ALL-TIER', { loaded: field.files, pending: close.files, decodeConcurrency: close.files.length }),
    scenario('Current loader: both tiers complete', 'CURRENT ALL-TIER', { loaded: [...field.files, ...close.files] }),
    scenario('Current loader: superseded close load still outstanding', 'CURRENT ALL-TIER; no cancellation/eviction', { loaded: field.files, pending: close.files, decodeConcurrency: close.files.length }),
    scenario('Proposed eligible-eight field', 'HYPOTHETICAL; filtering/name binding not implemented', { loaded: eligibleField.files }),
    scenario('Proposed one close page/look minimum; serial decode', 'HYPOTHETICAL; incomplete pose coverage', { loaded: eligibleField.files, pending: extremes(false) }),
    scenario('Proposed one close page/look maximum; serial decode', 'HYPOTHETICAL; incomplete pose coverage', { loaded: eligibleField.files, pending: extremes(true) }),
    scenario('Proposed all eligible close poses; one retry', 'HYPOTHETICAL; page demand/retry not implemented', { loaded: eligibleField.files, pending: eligibleClose.files, retryCopies: 1 }),
  ];
  const failedFile = close.files[0], failed = pages.find((p) => p.file === failedFile);
  const failure = scenario('Current loader: one close page fails, all siblings complete',
    'UPPER BOUND; unpublished sibling textures/decoded images lack explicit cleanup, GPU upload unmeasured',
    { loaded: field.files, pending: close.files.slice(1), decodeConcurrency: close.files.length - 1 });
  Object.assign(failure, { failedFile, failedAttemptPngBytes: failed.pngBytes, automaticRetryRequests: 0,
    pendingMeaning: 'Conservative retained/unpublished sibling reservations after rejection, not active requests or measured GPU allocation.' });
  failure.uniquePngDownloadBytes += failed.pngBytes; failure.transmittedPngBytesWithRetries += failed.pngBytes;
  failure.pngDownloadWithinLimit = failure.transmittedPngBytesWithRetries <= LIMITS.downloadBytes;
  scenarios.push(failure);
  return { schema: 1, reportOnly: true, fieldable: false, source: SOURCE, historical: HISTORICAL,
    counts: bound.counts, newlyObservedApprovedManifestSha256: bound.manifestHash, historicalReportSha256: bound.historicalHash,
    manifestHashLimitation: 'First observed hash of the retrieved approved artifact; no historical approval hash exists here. Structural checks cannot independently bind exact numeric anchors to an older manifest hash.',
    sourceMutation: false, limits: LIMITS, pages, demands, scenarios,
    currentLoaderFailure: 'A rejected tier promise remains cached; retries are suppressed. Sibling successful loads have no explicit cleanup. Their decoded resources remain an unmeasured leak risk; completed-only memoryBytes does not count them.',
    assumptions: ['Full RGBA8 mip chains allocated even though shader samples field LOD<=2 and close LOD<=1.',
      'GPU reservations precede completion in this model; current loader has no admission reservation.',
      'One retained width*height*4 decoded image per reserved page, plus two extra base-level copies per concurrently decoding page. These are explicit assumptions, not measured browser allocations.',
      'All encoded pending PNGs are assumed in flight; sequential loading is only hypothetical.',
      'Two GPU/CPU sides share textures, but each allocates its own instance buffer per page. Body/soft passes share the buffer.',
      'PNG transfer excludes manifest, HTTP headers/compression, other assets and service-worker/browser-cache duplication.',
      'Scene ceiling comparisons expose remaining capacity; null totalSceneWithinLimit means no admission verdict.'],
    unaccounted: ['terrain/ground textures and mesh', 'post colour/depth targets and framebuffer', 'rigged/fallen/halo/tree/gun/smoke buffers and textures',
      'atlas metadata/fallen arrays/materials/JS objects', 'browser caches and driver copies', 'decode scheduling and failure cleanup'],
    gates: { quality: 'UNRUN', nativeMemory: 'UNRUN', iPad: 'UNRUN', disposalRetryPolicy: 'UNIMPLEMENTED' } };
}

/** Existing scene geometry: shared body/soft geometry and interleaved attributes count once. */
export function geometryInventory(scene) {
  const backing = new Set(), uploads = new Set(); let cpuBytes = 0, gpuReservationBytes = 0;
  const add = (attribute) => {
    if (!attribute) return;
    const data = attribute.isInterleavedBufferAttribute ? attribute.data : attribute, array = data.array;
    if (!array) fail('geometry attribute has no array');
    if (!backing.has(array.buffer)) { backing.add(array.buffer); cpuBytes += array.buffer.byteLength; }
    if (!uploads.has(data)) { uploads.add(data); gpuReservationBytes += array.byteLength; }
  };
  scene.traverse((o) => { if (o.geometry) { for (const a of Object.values(o.geometry.attributes)) add(a); add(o.geometry.index); }
    add(o.instanceMatrix); add(o.instanceColor); });
  return { cpuBytes, gpuReservationBytes, cpuBackingBuffers: backing.size, gpuAttributeBuffers: uploads.size };
}

/** Actual Post target dimensions/types, with explicitly assumed four-byte depth/default colour. */
export function postInventory(post, framebufferWidth, framebufferHeight) {
  const targets = [post.rtScene, post.rtSmall, post.rtBlur];
  if (targets.some((t) => t.texture.type !== THREE.HalfFloatType || t.texture.format !== THREE.RGBAFormat || t.samples !== 0)) fail('post allocation model requires RGBA half-float, no MSAA');
  const colorBytes = targets.reduce((n, t) => n + t.width * t.height * 8, 0);
  const depthAssumptionBytes = targets.reduce((n, t) => n + (t.depthBuffer ? t.width * t.height * 4 : 0), 0);
  const defaultFramebufferColorAssumptionBytes = framebufferWidth * framebufferHeight * 4;
  return { targets: targets.map((t) => ({ width: t.width, height: t.height, depthBuffer: t.depthBuffer, samples: t.samples })),
    colorBytes, depthAssumptionBytes, defaultFramebufferColorAssumptionBytes,
    gpuReservationBytes: colorBytes + depthAssumptionBytes + defaultFramebufferColorAssumptionBytes };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024) fail('not a safe small regular file');
  return fs.readFileSync(file);
}
function freshReport(file) {
  const base = path.join(ROOT, '.out');
  if (file.includes('\\') || !file.startsWith(base + path.sep)) fail('report must stay under .out');
  let component = path.parse(file).root;
  for (const part of file.slice(component.length).split(path.sep)) {
    component = path.join(component, part);
    try { const s = fs.lstatSync(component); if (s.isSymbolicLink() || component === file || !s.isDirectory()) fail('unsafe/existing report path'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.realpathSync(base) !== base || !fs.realpathSync(path.dirname(file)).startsWith(base + path.sep)) fail('report parent escaped');
}
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') fail('approved source assessment runs on Actions only');
  if (process.argv.length !== 5) fail('usage: estimate-residency.mjs approved-atlas historical-compression.json .out/fresh/report.json');
  const source = fs.realpathSync(process.argv[2]);
  if (fs.lstatSync(process.argv[2]).isSymbolicLink() || source.includes('\\')) fail('unsafe source');
  const reportFile = path.resolve(process.argv[4]); freshReport(reportFile);
  const manifestBytes = regular(path.join(source, 'soldier.json'));
  const bound = bindApproved(manifestBytes, regular(process.argv[3]), (file) => {
    const input = path.join(source, file);
    if (!fs.realpathSync(input).startsWith(source + path.sep)) fail('original page escapes approved atlas');
    return regular(input);
  });
  // Actual current Henry pool capacities. This is not a projected historical battle roster.
  const { Game } = await import('../../src/game.js');
  const scenario = JSON.parse(regular(path.join(ROOT, 'assets/scenarios/henry-hill.json')));
  const terrain = { half: 3000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
  const game = new Game({ scene: new THREE.Scene(), terrain, scenario, world: {}, effects: {} });
  const report = estimate(bound, [game.impostors.US.capacity, game.impostors.CS.capacity]);
  const geometry = geometryInventory(game.scene), views = [];
  const previousWindow = globalThis.window;
  try {
    for (const view of [{ label: '1280x800 at DPR1 High', width: 1280, height: 800, dpr: 1 },
      { label: '1024x768 at DPR2 High; illustrative, not native iPad proof', width: 1024, height: 768, dpr: 2 }]) {
      globalThis.window = { devicePixelRatio: view.dpr };
      const post = new Post({ setPixelRatio() {}, setSize() {} }, { mode: 'high' }); post.setSize(view.width, view.height);
      views.push({ ...view, ...postInventory(post, view.width * post.scale, view.height * post.scale) });
    }
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
  report.sourceSceneBaseline = { geometry, postViews: views,
    basis: 'Actual Game constructor geometry and Post targets in Node; GPU bytes are reservations, no renderer/native measurement. Terrain/world/effects are absent.' };
  report.unaccounted = ['terrain/ground textures and mesh', 'world/tree/building/label geometry and textures',
    'remaining rigged/fallen/halo/horse/gun textures and non-geometry arrays', 'smoke/effects buffers and textures',
    'atlas metadata/fallen arrays/materials/JS objects', 'browser caches, driver copies and post/default-framebuffer implementation differences',
    'decode scheduling and failure cleanup'];
  for (const s of report.scenarios) s.sceneBaselineViews = views.map((v) => ({ label: v.label,
    sourceGpuReservationBytes: s.figuresGpuAndBufferMinimumBytes + geometry.gpuReservationBytes + v.gpuReservationBytes,
    sourceGpuCpuModelBytes: s.modelledGpuAndCpuBytes + geometry.gpuReservationBytes + geometry.cpuBytes + v.gpuReservationBytes,
    remainderToSceneLimitBytes: LIMITS.sceneBytes - (s.modelledGpuAndCpuBytes + geometry.gpuReservationBytes + geometry.cpuBytes + v.gpuReservationBytes),
    totalSceneWithinLimit: null }));
  report.toolSha = process.env.GITHUB_SHA;
  report.poolBasis = 'Actual current Henry scenario Game constructor at toolSha; future historical packs must supply their own full roster capacity.';
  report.runtimeSourceSha256 = Object.fromEntries(['src/units/impostor.js', 'src/game.js', 'src/render/post.js', 'assets/scenarios/henry-hill.json'].map((f) => [f, sha256(regular(path.join(ROOT, f)))]));
  if (sha256(regular(path.join(source, 'soldier.json'))) !== bound.manifestHash) fail('approved manifest changed during study');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ report: path.relative(ROOT, reportFile), counts: report.counts, fieldable: false,
    fullGpuBytes: sum(bound.pages, 'gpuRgbaMipBytes'), fullPngBytes: sum(bound.pages, 'pngBytes'), scenarios: report.scenarios.map((s) => ({ label: s.label, gpu: s.totalGpuReservationBytes, modelledGpuCpu: s.modelledGpuAndCpuBytes })) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });

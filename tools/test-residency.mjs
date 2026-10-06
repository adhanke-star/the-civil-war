// Synthetic PNG bytes exercise the actual validator and accounting; no approved assets on the Mac.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { Post } from '../src/render/post.js';
import { bindApproved, pageDemand, frameDemand, summarizeFrames, serialAccount, cohortStudy, account, estimate, geometryInventory, postInventory, HISTORICAL, LIMITS } from './bake/estimate-residency.mjs';
import { BAKE_CLIP } from '../src/units/impostor.js';
import { SOURCE, groupsOf, mipBytes, sha256 } from './bake/compress.mjs';

function fixture() {
  const names = ['base', 'h1_slouch_noroll', 'h2_cap_roll', 'h3_slouch_roll', 'h4_cap_noroll', 'h4_slouch_roll', 'h5_slouch_noroll', 'h6_cap_roll', 'h7_cap_roll'];
  const counts = { stand: 1, walk: 8, fire: 3, fallen: 1, load: 5 };
  const m = { camera: { directions: 16 }, heads: { h1: { use: 'union' }, h7: { use: 'usct' } }, clips: {}, tiers: {} }, bytes = new Map(), rows = [];
  for (const [clip, count] of Object.entries(counts)) m.clips[clip] = { frames: [...Array(count).keys()] };
  for (const tier of ['close', 'field']) {
    const t = { variants: {}, directionsByClip: {} }; m.tiers[tier] = t;
    for (const clip of Object.keys(counts)) t.directionsByClip[clip] = [...Array(16).keys()];
    for (const look of names) {
      const g = look === 'base' ? t : (t.variants[look] = {}), c = { head: look === 'h7_cap_roll' ? 'h7' : 'h1', use: look === 'h7_cap_roll' ? 'usct' : 'union' };
      if (look === 'base') t.baseComposition = c; else g.composition = c;
      g.pages = [...Array(tier === 'close' ? 4 : 1).keys()].map((i) => ({ file: `soldier_${tier}${look === 'base' ? '' : '_' + look}_${i}.png`, w: i === 3 ? 12 : 8, h: 8 }));
      g.frames = {}; g.count = 288;
      for (const [clip, count] of Object.entries(counts)) for (let k = 0; k < count; k++) for (let d = 0; d < 16; d++) {
        const page = tier === 'field' || clip === 'stand' ? 0 : clip === 'fallen' ? 2 : k % 4;
        g.frames[`${clip}_${k}_d${String(d).padStart(2, '0')}`] = { page, x: 0, y: 0, w: 1, h: 1, ox: 0, oy: 0, ax: 0.5, ay: 1, ppm: 8 };
      }
      for (const p of g.pages) {
        const png = new PNG({ width: p.w, height: p.h }); png.data.fill(rows.length + 1);
        for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
        const b = PNG.sync.write(png); bytes.set(p.file, b);
        rows.push({ tier, look, source: p.file, width: p.w, height: p.h, pngBytes: b.length, pngSha256: sha256(b), bytes: 31 + rows.length,
          ktxSha256: 'b'.repeat(64), allocation: mipBytes(p.w, p.h) });
      }
    }
  }
  const h = { source: SOURCE, toolSha: HISTORICAL.sha, counts: { frames: 5184, pages: 45, looksPerTier: 9 }, pages: rows,
    rgba8Bytes: rows.reduce((s, p) => s + p.allocation.rgba8, 0), block16Bytes: rows.reduce((s, p) => s + p.allocation.block16, 0), ktxBytes: rows.reduce((s, p) => s + p.bytes, 0) };
  return { m, h, bytes, bind: (fn = bindApproved) => fn(Buffer.from(JSON.stringify(m)), Buffer.from(JSON.stringify(h)), (f) => bytes.get(f)) };
}
const f = fixture(), bound = f.bind();
const smallStudy = cohortStudy(bound, [100, 200], { headingCounts: [1, 16], phaseCounts: [1, 'all'], clipSets: ['walk', 'mixed'] });
const clampStudy = cohortStudy(bound, [], { headingCounts: [1], phaseCounts: [4], clipSets: ['load', 'fire'] });
const api = { bind: bindApproved, demand: pageDemand, account, estimate, geometry: geometryInventory, post: postInventory,
  frames: frameDemand, summary: summarizeFrames, serial: serialAccount, study: () => structuredClone(smallStudy), clampStudy: () => structuredClone(clampStudy) };
const bypass = { ...api, bind: () => bound };
const reject = (a, mutate, pattern) => {
  const x = fixture(); mutate(x); assert.throws(() => x.bind(a.bind), pattern);
};
const alterAccount = (change) => ({ ...api, account: (...args) => { const r = account(...args); change(r); return r; } });
const alterSerial = (change) => ({ ...api, serial: (...args) => { const r = serialAccount(...args); change(r); return r; } });
const alterStudy = (change) => ({ ...api, study: () => { const r = structuredClone(smallStudy); change(r); return r; } });
const tests = [
  ['all-originals-mips-metadata-unchanged', (a) => {
    const x = fixture(), before = JSON.stringify([x.m, x.h]), mb = Buffer.from(JSON.stringify(x.m)), hb = Buffer.from(JSON.stringify(x.h));
    const savedMb = Buffer.from(mb), savedHb = Buffer.from(hb), savedPages = new Map([...x.bytes].map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const r = a.bind(mb, hb, (name) => x.bytes.get(name));
    assert.deepEqual(mb, savedMb); assert.deepEqual(hb, savedHb); for (const [name, bytes] of x.bytes) assert.deepEqual(bytes, savedPages.get(name));
    assert.equal(r.pages.length, 45); assert.deepEqual(r.counts, { frames: 5184, pages: 45, looksPerTier: 9 });
    assert.equal(r.manifestHash, sha256(Buffer.from(JSON.stringify(x.m)))); assert.equal(JSON.stringify([x.m, x.h]), before);
    assert.equal(r.pages.filter((p) => p.tier === 'close').length, 36); assert.equal(r.pages[3].gpuRgbaMipBytes, 508);
    assert.equal(r.pages[0].gpuRgbaMipBytes, 340); assert.equal(r.pages[0].mipLevels, 4);
  }, { ...api, bind: (...args) => { const r = bindApproved(...args); r.pages[0].gpuRgbaMipBytes = 256 * 4 / 3; return r; } }],
  ['wrong-approved-source-refused', (a) => reject(a, (x) => { x.h.source = { ...SOURCE, sha: 'c'.repeat(40) }; }, /source\/tool/), bypass],
  ['wrong-historical-tool-refused', (a) => reject(a, (x) => { x.h.toolSha = 'd'.repeat(40); }, /source\/tool/), bypass],
  ['missing-full-page-refused', (a) => reject(a, (x) => { x.h.pages.pop(); }, /full-pack/), bypass],
  ['duplicate-original-refused', (a) => reject(a, (x) => { x.h.pages[1].source = x.h.pages[0].source; }, /duplicate/), bypass],
  ['cross-tier-order-refused', (a) => reject(a, (x) => {
    const v = Object.entries(x.m.tiers.close.variants); x.m.tiers.close.variants = Object.fromEntries(v.reverse());
  }, /ordered look identity/), bypass],
  ['historical-tier-look-width-refused', (a) => {
    for (const [key, value] of [['tier', 'field'], ['look', 'h7_cap_roll'], ['width', 12]]) reject(a, (x) => { x.h.pages[0][key] = value; }, /original PNG/);
  }, bypass],
  ['unknown-original-row-refused', (a) => reject(a, (x) => { x.h.pages[0].source = 'soldier_close_unknown_0.png'; }, /original PNG/), bypass],
  ['png-hash-refused', (a) => reject(a, (x) => { x.h.pages[0].pngSha256 = '0'.repeat(64); }, /original PNG/), bypass],
  ['png-byte-count-refused', (a) => reject(a, (x) => { x.h.pages[0].pngBytes++; }, /original PNG/), bypass],
  ['png-actual-dimensions-refused', (a) => reject(a, (x) => {
    const row = x.h.pages[0], png = new PNG({ width: 4, height: 8 }); png.data.fill(255);
    const b = PNG.sync.write(png); x.bytes.set(row.source, b); row.pngBytes = b.length; row.pngSha256 = sha256(b);
  }, /dimensions\/mip/), bypass],
  ['mip-tail-refused', (a) => reject(a, (x) => { x.h.pages[0].allocation.rgba8--; }, /dimensions\/mip/), bypass],
  ['look-eligibility-refused', (a) => reject(a, (x) => { x.m.tiers.close.variants.h7_cap_roll.composition.use = 'union'; }, /eligibility/), bypass],
  ['direction-anchor-frame-refused', (a) => {
    reject(a, (x) => { x.m.tiers.close.directionsByClip.walk[15] = 14; }, /directions/);
    reject(a, (x) => { x.m.tiers.field.frames.stand_0_d00.ppm = 0; }, /rect\/anchor/);
    reject(a, (x) => { delete x.m.tiers.field.frames.stand_0_d00; }, /frame count/);
  }, bypass],
  ['historical-complete-totals-refused', (a) => reject(a, (x) => { x.h.rgba8Bytes++; }, /totals/), bypass],
  ['clip-direction-page-demand', (a) => {
    const m = fixture().m, names = Object.keys(groupsOf(m.tiers.close)), stand = a.demand(m, 'close', names, ['stand']), walk = a.demand(m, 'close', names, ['walk']);
    assert.equal(stand.frames, 144); assert.equal(stand.files.length, 9); assert.equal(walk.frames, 1152); assert.equal(walk.files.length, 36);
    assert.ok(walk.files.some((p) => p.includes('h7_cap_roll'))); assert.throws(() => a.demand(m, 'close', ['missing']), /unknown/);
  }, { ...api, demand: (m, t, looks) => pageDemand(m, t, looks.filter((l) => l !== 'h7_cap_roll'), ['stand']) }],
  ['loaded-pending-superseded-reservations', (a) => {
    const loaded = bound.pages.filter((p) => p.tier === 'field').map((p) => p.file), pending = bound.pages.filter((p) => p.tier === 'close').map((p) => p.file);
    const r = a.account(bound.pages, { loaded, pending, decodeConcurrency: 36 });
    assert.equal(r.loadedGpuBytes, 9 * 340); assert.equal(r.pendingGpuReservationBytes, 9 * (340 * 3 + 508));
    assert.equal(r.totalGpuReservationBytes, r.loadedGpuBytes + r.pendingGpuReservationBytes);
    assert.equal(r.extraDecodeAndUploadCopiesAssumptionBytes, (8 * 8 * 4 * 27 + 12 * 8 * 4 * 9) * 2);
  }, alterAccount((r) => { r.pendingGpuReservationBytes = 0; r.totalGpuReservationBytes = r.loadedGpuBytes; })],
  ['serial-decode-does-not-erase-pending-images', (a) => {
    const pending = bound.pages.filter((p) => p.tier === 'close').map((p) => p.file), r = a.account(bound.pages, { pending, decodeConcurrency: 1 });
    assert.equal(r.extraDecodeAndUploadCopiesAssumptionBytes, 12 * 8 * 4 * 2);
    assert.equal(r.retainedDecodedImageAssumptionBytes, (8 * 8 * 4 * 27 + 12 * 8 * 4 * 9));
  }, alterAccount((r) => { r.retainedDecodedImageAssumptionBytes = 384; })],
  ['shared-textures-separate-pool-buffers', (a) => {
    const r = a.account(bound.pages, { loaded: [bound.pages[0].file], poolCapacities: [100, 200] });
    assert.equal(r.loadedGpuBytes, 340); assert.equal(r.instanceGpuBytes, 300 * 12 * 4); assert.equal(r.instanceCpuBytes, r.instanceGpuBytes);
  }, alterAccount((r) => { r.instanceGpuBytes *= 2; })],
  ['retry-transfer-and-invalid-policy', (a) => {
    const loaded = [bound.pages[0].file], pending = [bound.pages[1].file], r = a.account(bound.pages, { loaded, pending, retryCopies: 1 });
    assert.equal(r.transmittedPngBytesWithRetries, bound.pages[0].pngBytes + 2 * bound.pages[1].pngBytes);
    assert.throws(() => a.account(bound.pages, { loaded, pending: loaded }), /duplicates a resident/);
    assert.throws(() => a.account(bound.pages, { pending, decodeConcurrency: 0 }), /invalid/);
  }, alterAccount((r) => { r.transmittedPngBytesWithRetries = r.uniquePngDownloadBytes; })],
  ['no-figures-only-scene-admission', (a) => {
    const r = a.account(bound.pages, { loaded: [bound.pages[0].file] });
    assert.equal(LIMITS.sceneBytes, 250000000); assert.equal(LIMITS.downloadBytes, 200000000);
    assert.equal(r.totalSceneWithinLimit, null); assert.equal(r.sceneGpuRemainderBytes, 250000000 - 340);
  }, alterAccount((r) => { r.totalSceneWithinLimit = true; })],
  ['truthful-current-vs-hypothetical-gates', (a) => {
    const r = a.estimate(bound, [100, 200]); assert.equal(r.fieldable, false); assert.equal(r.gates.iPad, 'UNRUN');
    assert.equal(r.scenarios[1].pendingPages, 36); assert.equal(r.scenarios[3].pendingPages, 36);
    assert.equal(r.scenarios[4].loadedPages, 8); assert.equal(r.scenarios[5].pendingPages, 8); assert.equal(r.scenarios[7].pendingPages, 32);
    assert.ok(r.manifestHashLimitation.includes('no historical approval hash')); assert.ok(r.currentLoaderFailure.includes('retries are suppressed'));
    assert.ok(r.scenarios.every((s) => s.totalSceneWithinLimit === null)); assert.ok(r.unaccounted.length >= 6);
  }, { ...api, estimate: (...args) => { const r = estimate(...args); r.fieldable = true; return r; } }],
  ['failed-sibling-bound-and-stuck-retry', (a) => {
    const r = a.estimate(bound), normal = r.scenarios[1], failed = r.scenarios.at(-1), row = bound.pages.find((p) => p.file === failed.failedFile);
    assert.equal(failed.pendingPages, 35); assert.equal(failed.automaticRetryRequests, 0);
    assert.equal(failed.pendingGpuReservationBytes, normal.pendingGpuReservationBytes - row.gpuRgbaMipBytes);
    assert.equal(failed.transmittedPngBytesWithRetries, normal.transmittedPngBytesWithRetries);
    assert.ok(failed.pendingMeaning.includes('not active requests')); assert.equal(failed.totalSceneWithinLimit, null);
  }, { ...api, estimate: (...args) => { const r = estimate(...args); r.scenarios.at(-1).pendingGpuReservationBytes = 0; return r; } }],
  ['actual-shared-geometry-inventory', (a) => {
    const scene = new THREE.Scene(), geo = new THREE.BufferGeometry(), data = new THREE.InstancedInterleavedBuffer(new Float32Array(24), 12);
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(data, 4, 0)); geo.setAttribute('iRect', new THREE.InterleavedBufferAttribute(data, 4, 4));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1)); scene.add(new THREE.Mesh(geo), new THREE.Mesh(geo));
    const r = a.geometry(scene); assert.equal(r.cpuBytes, 102); assert.equal(r.gpuReservationBytes, 102); assert.equal(r.gpuAttributeBuffers, 2);
  }, { ...api, geometry: (scene) => { const r = geometryInventory(scene); r.gpuReservationBytes *= 2; return r; } }],
  ['actual-post-target-inventory', (a) => {
    const prior = globalThis.window; globalThis.window = { devicePixelRatio: 2 };
    try {
      const post = new Post({ setPixelRatio() {}, setSize() {} }, { mode: 'high' }); post.setSize(1024, 768);
      const r = a.post(post, 2048, 1536); assert.equal(r.targets[0].width, 2048); assert.equal(r.targets[1].width, 512);
      assert.equal(r.colorBytes, (2048 * 1536 + 2 * 512 * 384) * 8); assert.equal(r.depthAssumptionBytes, 2048 * 1536 * 4);
      assert.equal(r.defaultFramebufferColorAssumptionBytes, 2048 * 1536 * 4);
    } finally { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; }
  }, { ...api, post: (...args) => { const r = postInventory(...args); r.depthAssumptionBytes = 0; return r; } }],
  ['runtime-frame-metadata-and-input-preservation', (a) => {
    const before = JSON.stringify(bound.manifest), request = [{ pose: BAKE_CLIP.WALK, phase: 0.3, heading: 0 }];
    const r = a.frames(bound.manifest, 'close', ['base', 'h7_cap_roll'], request);
    assert.equal(r.frames.length, 2); assert.equal(r.frames[0].key, 'walk_2_d00');
    for (const frame of r.frames) assert.deepEqual(frame.original, groupsOf(bound.manifest.tiers.close)[frame.look].frames[frame.key]);
    assert.equal(JSON.stringify(bound.manifest), before); assert.deepEqual(request, [{ pose: BAKE_CLIP.WALK, phase: 0.3, heading: 0 }]);
  }, { ...api, frames: (...args) => { const r = frameDemand(...args); r.frames[0].original.ppm++; return r; } }],
  ['next-walk-wrap-load-clamp-and-fire-pose', (a) => {
    const req = (pose, phase) => [{ pose, phase, heading: 0 }];
    const walk = a.frames(bound.manifest, 'close', ['base'], req(BAKE_CLIP.WALK, 0.999), { neighbors: true });
    assert.equal(walk.frames.length, 6); assert.ok(walk.frames.some((f) => f.key === 'walk_0_d15')); assert.ok(walk.frames.some((f) => f.key === 'walk_7_d01'));
    const load = a.frames(bound.manifest, 'close', ['base'], req(BAKE_CLIP.LOAD, 1.2), { neighbors: true });
    assert.equal(load.frames.length, 3); assert.ok(load.frames.every((f) => f.key.startsWith('load_4_')));
    assert.equal(a.frames(bound.manifest, 'close', ['base'], req(BAKE_CLIP.FIRE, 0))["frames"][0].key, 'fire_1_d00');
  }, { ...api, frames: (m, t, l, r, opts) => frameDemand(m, t, l, r, { ...opts, neighbors: false }) }],
  ['nearest-available-clip-direction', (a) => {
    const m = structuredClone(bound.manifest); m.tiers.close.directionsByClip.walk = [0, 2, 4, 6, 8, 10, 12, 14];
    const r = a.frames(m, 'close', ['base'], [{ pose: BAKE_CLIP.WALK, phase: 0, heading: 3.2 * Math.PI * 2 / 16 }]);
    assert.equal(r.frames[0].key, 'walk_0_d04');
  }, { ...api, frames: (m, ...args) => { const copy = structuredClone(m); copy.tiers.close.directionsByClip.walk = [...Array(16).keys()]; return frameDemand(copy, ...args); } }],
  ['persistent-fallen-demand', (a) => {
    const r = a.frames(bound.manifest, 'close', ['base'], [{ pose: BAKE_CLIP.STAND, phase: 0, heading: 0 }, { pose: BAKE_CLIP.FALLEN, phase: 0, heading: 0 }]);
    assert.equal(r.frames.length, 2); assert.equal(r.files.length, 2); assert.ok(r.frames.some((f) => f.key === 'fallen_0_d00'));
  }, { ...api, frames: (m, t, l, r) => frameDemand(m, t, l, r.filter((q) => q.pose !== BAKE_CLIP.FALLEN)) }],
  ['source-page-dedup-not-rectangle-allocation', (a) => {
    const r = frameDemand(bound.manifest, 'close', ['base'], [0, 1].map((d) => ({ pose: BAKE_CLIP.STAND, phase: 0, heading: d * Math.PI * 2 / 16 })));
    const s = a.summary(bound.pages, r); assert.equal(s.frames, 2); assert.equal(s.sourcePages, 1); assert.equal(s.sourcePageGpuMipBytes, 340);
    assert.equal(s.summedDistinctFrameAreaPixels, 2); assert.equal(s.isolatedRectangleMipByteMetric, 8); assert.equal(s.totalSceneWithinLimit, null);
    assert.ok(s.allocationMeaning.includes('not an implemented')); assert.equal(s.fieldable, false);
  }, { ...api, summary: (...args) => { const r = summarizeFrames(...args); r.sourcePageGpuMipBytes = r.isolatedRectangleMipByteMetric; return r; } }],
  ['serial-one-active-page-not-all-queued', (a) => {
    const next = bound.pages.filter((p) => p.tier === 'close').map((p) => p.file), r = a.serial(bound.pages, { next });
    assert.equal(r.activeDecodedSourcePeakBytes, 384); assert.equal(r.extraDecodeUploadCopiesPeakBytes, 768);
    assert.equal(r.activeEncodedPngPeakBytes, Math.max(...bound.pages.filter((p) => p.tier === 'close').map((p) => p.pngBytes)));
    assert.equal(r.uniqueLifetimePngDownloadBytes, bound.pages.filter((p) => p.tier === 'close').reduce((n, p) => n + p.pngBytes, 0));
    assert.ok(r.uniqueLifetimePngDownloadBytes > r.activeEncodedPngPeakBytes);
  }, alterSerial((r) => { r.activeEncodedPngPeakBytes = r.uniqueLifetimePngDownloadBytes; })],
  ['serial-old-plus-next-and-retained-versus-release', (a) => {
    const retained = [bound.pages[36].file], previous = [bound.pages[0].file], next = [bound.pages[0].file, bound.pages[3].file];
    const r = a.serial(bound.pages, { retained, previous, next, poolCapacities: [100, 200] });
    assert.equal(r.loadedPages, 2); assert.equal(r.pendingPages, 1); assert.equal(r.sourcePageGpuReservationBytes, 340 * 2 + 508);
    assert.equal(r.instanceGpuBytes, 3 * 300 * 48); assert.equal(r.retainedDecodedSourcesAssumptionBytes, 256 * 2 + 384);
    const instances = 3 * 300 * 48, encoded = bound.pages[3].pngBytes;
    assert.equal(r.retainedPolicyCpuEnvelopeBytes, 896 + 768 + encoded + instances);
    assert.equal(r.releasedPolicyCpuEnvelopeBytes, 1152 + encoded + instances);
    assert.equal(r.gpuCpuRetainedEnvelopeBytes, 1188 + instances + 896 + 768 + encoded + instances);
    assert.equal(r.gpuCpuReleasedEnvelopeBytes, 1188 + instances + 1152 + encoded + instances);
    assert.ok(r.releaseMeaning.includes('ALL')); assert.ok(r.releaseMeaning.includes('field'));
    assert.equal(r.disposalRetryPolicy, 'UNIMPLEMENTED');
  }, alterSerial((r) => { r.sourcePageGpuReservationBytes -= 340; })],
  ['serial-exact-cpu-copies-and-combined-envelope', (a) => {
    const r = a.serial(bound.pages, { retained: [bound.pages[0].file], next: [bound.pages[3].file], extraCopies: 3, poolCapacities: [10, 20] });
    const instances = 2 * 30 * 48, encoded = bound.pages[3].pngBytes;
    assert.equal(r.retainedPolicyCpuEnvelopeBytes, 640 + 1152 + encoded + instances);
    assert.equal(r.releasedPolicyCpuEnvelopeBytes, 1536 + encoded + instances);
    assert.equal(r.gpuCpuRetainedEnvelopeBytes, 848 + instances + 640 + 1152 + encoded + instances);
    assert.equal(r.gpuCpuReleasedEnvelopeBytes, 848 + instances + 1536 + encoded + instances);
  }, alterSerial((r) => { r.releasedPolicyCpuEnvelopeBytes -= r.instanceCpuBytes; })],
  ['lifetime-downloads-survive-hypothetical-retirement', (a) => {
    const old = bound.pages[0], current = bound.pages[3], r = a.serial(bound.pages, { next: [current.file], downloaded: [old.file] });
    assert.equal(r.sourcePageGpuReservationBytes, current.gpuRgbaMipBytes); assert.equal(r.uniqueLifetimePngDownloadBytes, old.pngBytes + current.pngBytes);
    assert.ok(r.lifetimeDownloadedFiles.includes(old.file)); assert.equal(r.totalSceneWithinLimit, null);
  }, alterSerial((r) => { r.uniqueLifetimePngDownloadBytes = r.activeEncodedPngPeakBytes; })],
  ['revisit-transfers-count-each-refetch-attempt', (a) => {
    const old = bound.pages[0], other = bound.pages[3], refetchFiles = [old.file, old.file];
    const r = a.serial(bound.pages, { next: [old.file], downloaded: [old.file, other.file], refetchFiles });
    assert.equal(r.uniqueLifetimePngDownloadBytes, old.pngBytes + other.pngBytes);
    assert.equal(r.refetchPngBytes, old.pngBytes * 2); assert.deepEqual(r.refetchFiles, refetchFiles);
    assert.equal(r.transmittedPngBytesWithRetries, old.pngBytes * 3 + other.pngBytes);
    assert.equal(r.sourcePageGpuReservationBytes, old.gpuRgbaMipBytes);
    assert.ok(r.transferMeaning.includes('lower bound')); assert.ok(r.transferMeaning.includes('unverified'));
  }, alterSerial((r) => { r.transmittedPngBytesWithRetries = r.uniqueLifetimePngDownloadBytes; })],
  ['failed-siblings-reserved-no-current-retry', (a) => {
    const next = [bound.pages[0].file, bound.pages[3].file], failedFile = next[1], r = a.serial(bound.pages, { next, failedFile });
    assert.equal(r.sourcePageGpuReservationBytes, 848); assert.equal(r.failedGpuReservationBytes, 508); assert.equal(r.automaticRetryRequests, 0);
    const retry = a.serial(bound.pages, { next, failedFile, retryFailed: true });
    assert.equal(retry.proposedRetryRequests, 1); assert.equal(retry.transmittedPngBytesWithRetries, r.transmittedPngBytesWithRetries + bound.pages[3].pngBytes);
    assert.equal(retry.automaticRetryRequests, 0); assert.equal(retry.disposalRetryPolicy, 'UNIMPLEMENTED');
  }, alterSerial((r) => { r.automaticRetryRequests = 1; })],
  ['cohort-nine-names-eligibility-and-original-catalog', (a) => {
    const r = a.study(), names = Object.keys(groupsOf(bound.manifest.tiers.close));
    assert.deepEqual(Object.keys(r.stableRuntimeLookAssignments512), names); assert.equal(Object.values(r.stableRuntimeLookAssignments512).reduce((n, v) => n + v, 0), 512);
    assert.ok(Object.values(r.stableRuntimeLookAssignments512).every((v) => v > 0)); assert.equal(r.originalCloseFrameCatalog.length, 2592);
    assert.ok(r.originalCloseFrameCatalog.some((f) => f.look === 'h7_cap_roll')); assert.equal(new Set(r.originalCloseFrameCatalog.map((f) => f.id)).size, 2592);
    for (const row of r.rows) assert.deepEqual(row.looks, row.lookSet === 'all-nine' ? names : names.slice(0, 8));
  }, alterStudy((r) => { delete r.stableRuntimeLookAssignments512.h7_cap_roll; })],
  ['cohort-all-phases-and-declared-ranges', (a) => {
    const r = a.study(), row = r.rows.find((v) => v.lookSet === 'all-nine' && v.clipSet === 'walk' && v.headingCohorts === 16 && v.phaseCohorts === 'all');
    assert.equal(row.samples, 1); assert.equal(row.ranges.current.frames.min, 9 * 16 * 9); assert.equal(row.ranges.current.sourcePages.max, 36);
    assert.equal(row.ranges.current.sourcePageGpuMipBytes.max, bound.pages.filter((p) => p.tier === 'close').reduce((n, p) => n + p.gpuRgbaMipBytes, 0));
    assert.deepEqual(row.ranges.activeResolution.frameSlots, { min: 8, max: 8 });
    assert.deepEqual(row.ranges.activeResolution.frameDirectionPairs, { min: 128, max: 128 });
    assert.ok(r.rows.every((v) => v.ranges.prefetched.sourcePageGpuMipBytes.min >= v.ranges.current.sourcePageGpuMipBytes.min));
    assert.ok(r.basis.includes('coupled')); assert.ok(r.limitations.some((l) => l.includes('not exhaustive')));
  }, alterStudy((r) => { r.rows.find((v) => v.lookSet === 'all-nine' && v.clipSet === 'walk' && v.headingCohorts === 16 && v.phaseCohorts === 'all').ranges.current.frames.min--; })],
  ['requested-phase-cohorts-report-resolved-clamp-collapse', (a) => {
    for (const row of a.clampStudy().rows) {
      assert.equal(row.phaseCohorts, 4); assert.equal(row.ranges.activeResolution.frameSlots.min, 1);
      assert.equal(row.ranges.activeResolution.frameSlots.max, row.clipSet === 'load' ? 4 : 3);
      assert.ok(row.cohortMeaning.includes('requested')); assert.ok(row.cohortMeaning.includes('collapse'));
    }
  }, { ...api, clampStudy: () => { const r = structuredClone(clampStudy); r.rows[0].ranges.activeResolution.frameSlots.min = 4; return r; } }],
  ['cohort-does-not-admit-scene-or-policy', (a) => {
    const r = a.study(); assert.equal(r.fieldable, false); assert.equal(r.totalSceneWithinLimit, null); assert.equal(r.gates.iPad, 'UNRUN');
    assert.equal(r.gates.quality, 'UNRUN'); assert.equal(r.gates.disposalRetryPolicy, 'UNIMPLEMENTED'); assert.equal(r.transitions.length, 10);
    const revisits = r.transitions.filter((s) => s.phase.startsWith('revisit'));
    assert.equal(revisits.length, 2); assert.ok(revisits.every((s) => s.refetchPngBytes > 0 && s.transmittedPngBytesWithRetries > s.uniqueLifetimePngDownloadBytes));
    assert.ok(r.transitions.every((s) => !s.fieldable && s.totalSceneWithinLimit === null && s.disposalRetryPolicy === 'UNIMPLEMENTED'));
  }, alterStudy((r) => { r.fieldable = true; })],
  ['serial-invalid-and-duplicate-assumptions-refused', (a) => {
    assert.throws(() => a.serial(bound.pages, { next: [bound.pages[0].file, bound.pages[0].file] }), /invalid serial page/);
    assert.throws(() => a.serial(bound.pages, { next: ['unknown'] }), /invalid serial page/);
    assert.throws(() => a.serial(bound.pages, { retryFailed: true }), /invalid serial assumption/);
    assert.throws(() => a.serial(bound.pages, { refetchFiles: [bound.pages[0].file] }), /prior download evidence/);
    assert.throws(() => a.serial(bound.pages, { retained: [bound.pages[0].file], next: [bound.pages[0].file], failedFile: bound.pages[0].file }), /outstanding/);
  }, { ...api, serial: () => ({}) }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`RESIDENCY ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

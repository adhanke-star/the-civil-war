// Report only. Original approved PNGs stay on Actions; no codec, runtime or source mutation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { Post } from '../../src/render/post.js';
import { AtlasLayout, BAKE_CLIP } from '../../src/units/impostor.js';
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

/** Exact original frame locality through the runtime resolver. No cropping, packing or allocation. */
export function frameDemand(manifest, tier, looks, requests, { neighbors = false, layout = new AtlasLayout(manifest) } = {}) {
  const groups = groupsOf(manifest.tiers[tier] || {}), T = layout.tiers[tier], records = new Map();
  if (!T || !looks.length || new Set(looks).size !== looks.length || looks.some((l) => !groups[l]) || !requests.length) fail('invalid frame demand');
  for (const r of requests) {
    if (!Object.values(BAKE_CLIP).includes(r.pose) || !Number.isFinite(r.phase) || !Number.isFinite(r.heading)) fail('invalid frame request');
    const slot = layout.slotFor(r.pose, r.phase), clip = layout.clipNames[layout.slotClip[slot]], C = layout.clips[clip];
    const k = slot - C.start, d = layout.direction(tier, slot, r.heading, 0, 0, 0, 1), available = T.avail[clip];
    const di = available.indexOf(d); if (di < 0) fail('runtime picked unavailable direction');
    const frames = [k], directions = [d];
    if (neighbors) {
      const next = clip === 'walk' ? (k + 1) % C.count : Math.min(k + 1, C.count - 1);
      if (!frames.includes(next)) frames.push(next);
      for (const offset of [-1, 1]) { const dd = available[(di + offset + available.length) % available.length]; if (!directions.includes(dd)) directions.push(dd); }
    }
    for (const look of looks) for (const frame of frames) for (const direction of directions) {
      const key = `${clip}_${frame}_d${String(direction).padStart(2, '0')}`, id = `${look}/${key}`;
      if (records.has(id)) continue;
      const original = groups[look].frames[key], page = groups[look].pages[original?.page];
      if (!page) fail('missing original demanded frame');
      const li = T.looks.indexOf(look), o = layout.entry(C.start + frame, direction, li), R = T.rects;
      if (li < 0 || T.pages[R[o]]?.file !== page.file || R[o + 1] !== Math.fround(original.x) || R[o + 2] !== Math.fround(original.y)
        || R[o + 3] !== Math.fround(original.w) || R[o + 4] !== Math.fround(original.h)
        || R[o + 5] !== Math.fround(original.ox - original.ax) || R[o + 6] !== Math.fround(original.oy - original.ay)
        || R[o + 7] !== Math.fround(original.ppm)) fail('runtime/original rectangle anchor scale disagree');
      records.set(id, { id, look, key, file: page.file, original: { ...original } });
    }
  }
  const frames = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { tier, looks: [...looks], neighbors, frames, files: [...new Set(frames.map((f) => f.file))].sort() };
}

/** Full source pages are real reservations; rectangle arithmetic is explicitly only a locality metric. */
export function summarizeFrames(pages, demand) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const selected = demand.files.map((f) => { const p = byFile.get(f); if (!p) fail('unbound frame page'); return p; });
  return { frames: demand.frames.length, sourcePages: selected.length,
    sourcePageGpuMipBytes: sum(selected, 'gpuRgbaMipBytes'), originalPngDownloadBytes: sum(selected, 'pngBytes'),
    summedDistinctFrameAreaPixels: demand.frames.reduce((n, f) => n + f.original.w * f.original.h, 0),
    isolatedRectangleMipByteMetric: demand.frames.reduce((n, f) => n + mipBytes(f.original.w, f.original.h).rgba8, 0),
    files: demand.files, frameKeysSha256: sha256(Buffer.from(JSON.stringify(demand.frames.map((f) => f.id)))),
    originalFrameMetadataSha256: sha256(Buffer.from(JSON.stringify(demand.frames))),
    allocationMeaning: 'Original source-page mip reservations. Rectangle area/mips omit packing, gutters and mip isolation; they are not an implemented atlas allocation.',
    fieldable: false, totalSceneWithinLimit: null };
}

/** Hypothetical serial decode envelope; old reservations and lifetime downloads survive transitions. */
export function serialAccount(pages, { retained = [], previous = [], next = [], downloaded = [], refetchFiles = [], failedFile = null, retryFailed = false,
  extraCopies = 2, poolCapacities = [] } = {}) {
  const byFile = new Map(pages.map((p) => [p.file, p]));
  for (const list of [retained, previous, next, downloaded]) if (new Set(list).size !== list.length || list.some((f) => !byFile.has(f))) fail('invalid serial page set');
  // Attempts deliberately preserve duplicates: evicted A can be requested twice again.
  if (!Array.isArray(refetchFiles) || refetchFiles.some((f) => !byFile.has(f) || !downloaded.includes(f))) fail('refetch requires prior download evidence');
  if (!Number.isInteger(extraCopies) || extraCopies < 0 || poolCapacities.some((c) => !Number.isSafeInteger(c) || c < 0)
    || typeof retryFailed !== 'boolean' || (retryFailed && !failedFile)) fail('invalid serial assumption');
  const loaded = [...new Set([...retained, ...previous])], pending = next.filter((f) => !loaded.includes(f));
  if (failedFile && !pending.includes(failedFile)) fail('failed page must be outstanding');
  const reserved = [...loaded, ...pending], fetched = [...new Set([...downloaded, ...reserved])];
  const active = pending.map((f) => byFile.get(f)), all = reserved.map((f) => byFile.get(f));
  const basePeak = Math.max(0, ...active.map((p) => p.baseRgbaBytes)), encodedPeak = Math.max(0, ...active.map((p) => p.pngBytes));
  const instanceBytes = reserved.length * poolCapacities.reduce((s, c) => s + c, 0) * 12 * 4;
  const gpu = sum(all, 'gpuRgbaMipBytes'), retainedDecoded = sum(all, 'baseRgbaBytes');
  const refetchPngBytes = sum(refetchFiles.map((f) => byFile.get(f)), 'pngBytes');
  const transfer = sum(fetched.map((f) => byFile.get(f)), 'pngBytes') + refetchPngBytes + (retryFailed ? byFile.get(failedFile).pngBytes : 0);
  const cpuRetained = retainedDecoded + basePeak * extraCopies + encodedPeak + instanceBytes;
  const cpuReleased = basePeak * (1 + extraCopies) + encodedPeak + instanceBytes;
  return { policy: 'HYPOTHETICAL serial source decode/release; current loader unchanged', loadedFiles: loaded, pendingFiles: pending,
    lifetimeDownloadedFiles: fetched, refetchFiles: [...refetchFiles], refetchPngBytes,
    loadedPages: loaded.length, pendingPages: pending.length, sourcePageGpuReservationBytes: gpu,
    instanceGpuBytes: instanceBytes, instanceCpuBytes: instanceBytes, extraCopies, decodeConcurrency: 1,
    activeDecodedSourcePeakBytes: basePeak, activeEncodedPngPeakBytes: encodedPeak, extraDecodeUploadCopiesPeakBytes: basePeak * extraCopies,
    retainedDecodedSourcesAssumptionBytes: retainedDecoded, retainedPolicyCpuEnvelopeBytes: cpuRetained,
    releasedPolicyCpuEnvelopeBytes: cpuReleased, figuresGpuAndBufferMinimumBytes: gpu + instanceBytes,
    gpuCpuRetainedEnvelopeBytes: gpu + instanceBytes + cpuRetained, gpuCpuReleasedEnvelopeBytes: gpu + instanceBytes + cpuReleased,
    uniqueLifetimePngDownloadBytes: sum(fetched.map((f) => byFile.get(f)), 'pngBytes'), transmittedPngBytesWithRetries: transfer,
    pngDownloadWithinLimit: transfer <= LIMITS.downloadBytes, failedFile, automaticRetryRequests: 0, proposedRetryRequests: retryFailed ? 1 : 0,
    failedGpuReservationBytes: failedFile ? byFile.get(failedFile).gpuRgbaMipBytes : 0,
    failurePolicy: 'Failed/partially uploaded page and successful siblings retain conservative reservations until explicit retirement; not measured allocation.',
    transferMeaning: 'Unique lifetime PNG payload is a lower bound. Zero refetch attempts assumes perfect lifetime encoded/browser-cache reuse, which is unverified; explicit refetch attempts and one proposed failed-page retry add payload. Headers and other assets are excluded.',
    releaseMeaning: 'Released CPU envelope hypothetically releases ALL decoded sources, including retained field-page images; the current field loader retains its images and is unchanged.',
    peakMeaning: 'Independent largest-page decode and PNG peaks give a conservative envelope, not an observed simultaneous peak.',
    fieldable: false, totalSceneWithinLimit: null, disposalRetryPolicy: 'UNIMPLEMENTED' };
}

/** Synthetic cohorts only; ranges enumerate the stated bases, not every possible battlefield distribution. */
export function cohortStudy(bound, poolCapacities = [], { headingCounts = [1, 2, 4, 16], phaseCounts = [1, 2, 4, 'all'],
  clipSets = [...Object.keys(bound.manifest.clips), 'mixed'] } = {}) {
  const { manifest, pages } = bound, before = JSON.stringify(manifest), layout = new AtlasLayout(manifest), groups = groupsOf(manifest.tiers.close);
  if (layout.missing.length || layout.problems().length || !headingCounts.length || !phaseCounts.length || !clipSets.length
    || [headingCounts, phaseCounts, clipSets].some((v) => new Set(v).size !== v.length) || headingCounts.some((n) => ![1, 2, 4, 16].includes(n))
    || phaseCounts.some((n) => ![1, 2, 4, 'all'].includes(n)) || clipSets.some((c) => c !== 'mixed' && !manifest.clips[c])) fail('invalid cohort study');
  const all = Object.keys(groups), eligible = all.filter((l) => (l === 'base' ? manifest.tiers.close.baseComposition : groups[l].composition).use !== 'usct');
  if (all.length !== 9 || eligible.length !== 8 || !equal(layout.tiers.close.looks, layout.tiers.field.looks)) fail('cohort look identity');
  const pose = { stand: BAKE_CLIP.STAND, walk: BAKE_CLIP.WALK, fallen: BAKE_CLIP.FALLEN, load: BAKE_CLIP.LOAD };
  const makeRequest = (clip, phase, heading) => ({ pose: clip === 'fire' ? [BAKE_CLIP.AIM, BAKE_CLIP.FIRE, BAKE_CLIP.RECOVER][Math.min(2, Math.max(0, Math.floor(phase * 3)))] : pose[clip], phase, heading });
  const rows = [], transitions = [], assignments = Object.fromEntries(all.map((l) => [l, 0]));
  for (let man = 0; man < 512; man++) assignments[layout.tiers.close.looks[layout.lookFor('close', man)]]++;
  for (const [lookSet, looks] of [['all-nine', all], ['eligible-eight', eligible]]) for (const clipSet of clipSets)
    for (const headings of headingCounts) for (const phases of phaseCounts) {
      const clips = clipSet === 'mixed' ? Object.keys(manifest.clips) : [clipSet];
      const bases = phases === 'all' ? [0] : [...new Set([0, 1, ...clips.flatMap((c) => manifest.clips[c].frames.map((_, i, a) => (i + 0.5) / a.length))])];
      const ranges = { current: {}, prefetched: {}, activeResolution: {} }; let samples = 0, lowest = null, highest = null;
      for (let baseHeading = 0; baseHeading < (headings === 16 ? 1 : 16); baseHeading++) for (const basePhase of bases) {
        const requests = [], activeRequests = [];
        for (let h = 0; h < headings; h++) {
          const heading = Math.PI * 2 * (baseHeading / 16 + h / headings);
          for (const clip of clips) {
            const count = manifest.clips[clip].frames.length, n = phases === 'all' ? count : Math.min(phases, count);
            for (let p = 0; p < n; p++) activeRequests.push(makeRequest(clip, phases === 'all' ? (p + 0.5) / count : basePhase + p / n, heading));
          }
          // Persistent fallen coexist with the active clip; no corpse retirement is assumed.
          requests.push(makeRequest('fallen', 0, heading));
        }
        requests.push(...activeRequests);
        const activeFrames = frameDemand(manifest, 'close', [looks[0]], activeRequests, { layout }).frames;
        const activeResolution = { frameSlots: new Set(activeFrames.map((f) => f.key.replace(/_d\d+$/, ''))).size,
          frameDirectionPairs: activeFrames.length };
        const demand = (neighbors) => summarizeFrames(pages, frameDemand(manifest, 'close', looks, requests, { neighbors, layout }));
        const current = demand(false), prefetched = demand(true), sample = { baseHeading, basePhase, requests, activeResolution, current, prefetched };
        for (const [kind, metrics] of [['current', current], ['prefetched', prefetched], ['activeResolution', activeResolution]]) for (const [key, v] of Object.entries(metrics)) if (typeof v === 'number') {
          const r = ranges[kind][key] ||= { min: v, max: v }; r.min = Math.min(r.min, v); r.max = Math.max(r.max, v);
        }
        if (!lowest || prefetched.sourcePageGpuMipBytes < lowest.prefetched.sourcePageGpuMipBytes) lowest = sample;
        if (!highest || prefetched.sourcePageGpuMipBytes > highest.prefetched.sourcePageGpuMipBytes) highest = sample;
        samples++;
      }
      rows.push({ lookSet, looks, clipSet, headingCohorts: headings, phaseCohorts: phases,
        cohortMeaning: 'Heading/phase counts are requested coupled cohorts; activeResolution reports distinct runtime-resolved active slots/direction pairs, excluding the separately retained fallen unless fallen is an active clip. Nonwrapping phases can collapse.', samples, ranges,
        lowestSourcePageSample: lowest, highestSourcePageSample: highest });
      if (clipSet === 'walk' && headings === 1 && phases === 1) {
        const field = pageDemand(manifest, 'field', looks).files, previous = lowest.current.files, next = highest.prefetched.files;
        const failedFile = next.find((f) => !previous.includes(f));
        transitions.push({ lookSet, phase: 'old close demand retained while next demand decodes', ...serialAccount(pages, { retained: field, previous, next, poolCapacities }) },
          { lookSet, phase: 'hypothetical retirement; lifetime downloads remain', ...serialAccount(pages, { retained: field, next, downloaded: previous, poolCapacities }) },
          { lookSet, phase: 'revisit retired original demand without encoded-cache reuse', ...serialAccount(pages,
            { retained: field, next: previous, downloaded: [...new Set([...previous, ...next])], refetchFiles: previous, poolCapacities }) });
        if (failedFile) for (const retryFailed of [false, true]) transitions.push({ lookSet, phase: 'failed page and sibling reservations',
          ...serialAccount(pages, { retained: field, previous, next, failedFile, retryFailed, poolCapacities }) });
      }
    }
  const catalogRequests = [];
  for (const [clip, spec] of Object.entries(manifest.clips)) for (let k = 0; k < spec.frames.length; k++) for (let d = 0; d < 16; d++)
    catalogRequests.push(makeRequest(clip, (k + 0.5) / spec.frames.length, d * Math.PI * 2 / 16));
  const catalog = frameDemand(manifest, 'close', all, catalogRequests, { layout });
  if (catalog.frames.length !== 2592 || JSON.stringify(manifest) !== before) fail('cohort metadata changed or incomplete');
  return { schema: 1, synthetic: true, fieldable: false, totalSceneWithinLimit: null, stableRuntimeLookAssignments512: assignments, rows, transitions,
    originalCloseFrameCatalog: catalog.frames,
    manifestCohortBasis: { camera: { ...manifest.camera }, clips: structuredClone(manifest.clips),
      directionsByClip: structuredClone(manifest.tiers.close.directionsByClip),
      looks: all.map((name) => ({ name, composition: { ...(name === 'base' ? manifest.tiers.close.baseComposition : groups[name].composition) } })) },
    limits: LIMITS, gates: { quality: 'UNRUN', nativeMemory: 'UNRUN', iPad: 'UNRUN', disposalRetryPolicy: 'UNIMPLEMENTED' },
    basis: 'Runtime-resolved relative headings at 16 direction bases; coupled phase bases at declared frame centres and endpoints. All-phase/all-heading cases have invariant coverage and one base. Every case retains fallen at its declared heading cohorts.',
    limitations: ['Synthetic coupled cohorts are not exhaustive arbitrary phase/heading combinations or actual camera populations.',
      'Summed distinct-frame rectangle areas can overlap; no pixel extraction, new gutters, packing, sampling or quality assessment occurs.',
      'Serial CPU release of ALL sources, including field images, is hypothetical; source-page GPU residency is unchanged. Unique PNG payload is a lower bound; explicit retired-page refetch attempts and proposed retries add transfers.',
      'Instance capacity comes from current Henry pools, not a validated historical battle roster; terrain/world/effects and browser/driver residency remain unmeasured.'] };
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
  report.frameLocality = cohortStudy(bound, [game.impostors.US.capacity, game.impostors.CS.capacity]);
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
  for (const s of report.frameLocality.transitions) s.sceneBaselineViews = views.map((v) => ({ label: v.label,
    sourceGpuReservationBytes: s.figuresGpuAndBufferMinimumBytes + geometry.gpuReservationBytes + v.gpuReservationBytes,
    retainedSourceGpuCpuEnvelopeBytes: s.gpuCpuRetainedEnvelopeBytes + geometry.gpuReservationBytes + geometry.cpuBytes + v.gpuReservationBytes,
    releasedSourceGpuCpuEnvelopeBytes: s.gpuCpuReleasedEnvelopeBytes + geometry.gpuReservationBytes + geometry.cpuBytes + v.gpuReservationBytes,
    totalSceneWithinLimit: null }));
  report.toolSha = process.env.GITHUB_SHA;
  report.poolBasis = 'Actual current Henry scenario Game constructor at toolSha; future historical packs must supply their own full roster capacity.';
  report.runtimeSourceSha256 = Object.fromEntries(['src/units/impostor.js', 'src/game.js', 'src/render/post.js', 'assets/scenarios/henry-hill.json'].map((f) => [f, sha256(regular(path.join(ROOT, f)))]));
  if (sha256(regular(path.join(source, 'soldier.json'))) !== bound.manifestHash) fail('approved manifest changed during study');
  const json = JSON.stringify(report), reportBytes = Buffer.byteLength(json, 'utf8');
  if (reportBytes > 5000000) fail('report exceeds 5 MB small-report ceiling');
  fs.writeFileSync(reportFile, json, { flag: 'wx' });
  console.log(JSON.stringify({ report: path.relative(ROOT, reportFile), counts: report.counts, fieldable: false,
    reportBytes, cohortRows: report.frameLocality.rows.length, closeCatalogFrames: report.frameLocality.originalCloseFrameCatalog.length,
    fullGpuBytes: sum(bound.pages, 'gpuRgbaMipBytes'), fullPngBytes: sum(bound.pages, 'pngBytes'), scenarios: report.scenarios.map((s) => ({ label: s.label, gpu: s.totalGpuReservationBytes, modelledGpuCpu: s.modelledGpuAndCpuBytes })) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });

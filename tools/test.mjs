// tools/test.mjs: M1 browser test. Serves the repo on a free port, loads index.html?practice&quality=low in headless
// Chromium (SwiftShader WebGL, so CI and the Mac both render), and checks:
//   1. ready: window.__ready within 180 s (fails fast on the first page/console error during load)
//   2. no-console-errors: zero pageerror / console error / failed request / HTTP >= 400
//   3. canvas-not-blank: sampled pixels have many distinct colours
//   4. figures: >= 1000 soldier figures and one marker button per unit; facing: every unit starts within
//      75 degrees of its nearest enemy (catches a brigade set up facing away from the battle)
//   5. select-drag-order: a real mouse press on Franklin's flag, a curved drag across the field and a
//      release issue a march order (the same path a player uses)
//   6. hold-button: the Hold button stops the brigade
//   7. fight: after re-ordering and fast-forwarding 300 sim seconds, both sides have casualties and
//      there was musket or cannon smoke
//   f. zoom-to-pointer: a trackpad pinch (ctrl+wheel) keeps the ground under the pointer within 3% of the view
//   g. touch-tap-select / touch-drag-order: synthetic pointerType 'touch' events select a brigade and order it
//   order-obedience (generic sandbox brigades in the quiet north-west corner, see orderObedience):
//      order-move-arrives, order-move-fights-on-the-way (rules.moveOrder fight vs march), order-attack-engages,
//      order-hold-fire, order-while-paused
//   h. dock-fit: unit card, orders, minimap and top strip do not overlap and every target is >= 44 px, at
//      1024x768 (iPad) and 1440x788
//   baked figures (look.figureStyle 'baked', src/units/impostor.js): baked-draws (sprites + the crews and officers
//      still rigged >= the rigged count, canvas not blank and different from the rigged picture), baked-rects
//      (every instance's atlas rect inside its page), baked-direction (the camera turned 180 degrees moves a
//      man's baked direction by 8 of 16), baked-load (a reloading brigade draws the load frames, a loaded one
//      none), baked-compare (both styles drawn, rigged left / baked right),
//      men-per-figure (look.menPerFigure 5 gives 1.7-2.3x the figures; back to 10 restores the count)
//   8. axe: no serious or critical accessibility violations
// Then, with the first page closed (one page at a time on an 8 GB Mac):
//   settings (Node, before the browser): src/settings.js define/get/set/reset/on/lock/exportText/importText
//      round-trip, range clamping and snapping, unknown keys and bad values ignored
//   baked-maths (Node): the bake's direction rule (0 faces the camera, 4 screen-right, 180-degree camera turn
//      = +8), pose, walk- and load-frame selection, every manifest rect inside its page; baked-direction-per-clip
//      (a clip baked in fewer directions never gets one it lacks), baked-height (stand, walk and load drawn the
//      same height, feet on the anchor), baked-variants (a man's look is fixed by his index; looks are mixed);
//      each with a deliberately broken control that must fail with the expected text
//   sandbox-*: index.html?sandbox&quality=low: the panel has 5 tabs; the Interface size slider moves
//      --ui-scale; "Lock this" disables it and set() is refused; Copy/Paste settings; the round button hides
//      the panel; Units/Moments tools spawn, shell, rout and remove a generic brigade; the order line compares
//      split-screen (both styles, each clipped); axe has no serious/critical violations with the panel open; no console errors
//   device-*: device.html prints a GPU tier line and finishes the ratio-1 benchmark without console errors
// `node tools/test.mjs --unit` runs only the Node checks (settings, baked-maths; no browser, writes nothing).
// `node tools/test.mjs --s1` runs the settings, sandbox and device checks only (skips the battle page).
// `node tools/test.mjs --field` runs the settings and battle-page checks only (skips the sandbox and device pages).
// `node tools/test.mjs --reward` runs Node foundations and completed reward persistence UI only.
// Full smoke includes real equip/reload/export/import, duplicate/conflict/quota/read failure recovery,
// keyboard/focus, scoped compare/resume/import/launcher axe and 1024/320px target/layout checks.
// SETTINGS_MODULE=<path> points the settings checks at another copy (used to prove the checks fail).
// Saves screenshots and .out/last-result.json, then prunes .out/. Exit 0 only if every check passes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { PNG } from 'pngjs';
import { startServer, ROOT } from './serve.mjs';
import { prune, OUT_DIR } from './prune.mjs';
import { practiceProgress } from './test-practice-ui.mjs';
import { introPlay } from './test-intro-ui.mjs';
import { entryProgress } from './test-entry-ui.mjs';
import { campEquipment } from './test-camp-ui.mjs';
import { saveCoordination } from './test-save-ui.mjs';
import { probeProgress, progressRaw, seedProgress, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';
import { lookControls } from './test-look-ui.mjs';
import { viewControls } from './test-view-ui.mjs';
import { spacingControls } from './test-spacing-ui.mjs';
import { momentControls } from './test-moments-ui.mjs';
import { keyboardControls } from './test-keyboard-ui.mjs';
import { dockControls } from './test-dock-ui.mjs';
import { headerControls, headerAfterAction, headerStores, headerIntro, finishHeader } from './test-header-ui.mjs';
import { deploymentProgress } from './test-deployment-ui.mjs';
import { soldierViewControls } from './test-soldier-view-ui.mjs';

const READY_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1280, height: 720 };
const MIN_FIGURES = 1000;

const started = Date.now();
const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
const checks = [];
const consoleErrors = [];
const consoleWarnings = [];
const result = { ok: false, timestamp: new Date(started).toISOString(), url: null, browser: null, checks, stats: null, consoleErrors, consoleWarnings, axe: null, screenshots: [], durationMs: 0 };

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console[ok ? 'log' : 'error'](`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `m1-${name}-${stamp}.png`);
  const buf = await page.screenshot({ path: file, type: 'png' });
  result.screenshots.push(path.relative(ROOT, file));
  return PNG.sync.read(buf);
}

/** Screen position (CSS px) of a world point on the ground. */
const project = (page, x, z) => page.evaluate(([x, z]) => {
  const { camera, terrain } = window.__game;
  const v = camera.position.clone().set(x, terrain.heightAt(x, z), z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}, [x, z]);

/** src/settings.js in Node (no window, no storage): the registry contract the sandbox and other modules rely on. */
async function settingsUnit() {
  const file = process.env.SETTINGS_MODULE ? path.resolve(process.env.SETTINGS_MODULE) : path.join(ROOT, 'src', 'settings.js');
  const S = await import(pathToFileURL(file).href);
  const bad = [];
  const expect = (ok, text) => { if (!ok) bad.push(text); };
  const v0 = S.define('t.flag', { tab: 'Look', type: 'toggle', default: true, label: 'Flag', note: 'A test toggle.' });
  expect(v0 === true, `define returned ${v0}, expected the default true`);
  expect(S.define('t.flag', { tab: 'Look', type: 'toggle', default: false, label: 'Again' }) === true, 'a second define of the same key replaced the first');
  S.define('t.side', { tab: 'Look', type: 'choice', default: 'right', label: 'Side', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] });
  S.define('t.scale', { tab: 'Screens', type: 'range', default: 1, min: 0.8, max: 1.4, step: 0.05, label: 'Scale' });
  let ran = 0;
  S.define('t.go', { tab: 'Moments', type: 'action', label: 'Go', run: () => { ran++; } });
  const heard = [];
  const off = S.on('t.scale', (v, k) => heard.push(`${k}=${v}`));
  let any = 0;
  S.on('*', () => { any++; });
  let r = S.set('t.scale', 5);
  expect(r === 1.4, `set 5 on a 0.8..1.4 range gave ${r}, expected the clamp 1.4`);
  r = S.set('t.scale', -3);
  expect(r === 0.8, `set -3 on a 0.8..1.4 range gave ${r}, expected the clamp 0.8`);
  r = S.set('t.scale', 1.13);
  expect(r === 1.15, `set 1.13 with step 0.05 gave ${r}, expected 1.15`);
  expect(heard.join(' ') === 't.scale=1.4 t.scale=0.8 t.scale=1.15', `on() heard "${heard.join(' ')}"`);
  off();
  S.set('t.scale', 1.2);
  expect(heard.length === 3, 'the unsubscribe function returned by on() did not unsubscribe');
  r = S.set('t.side', 'up');
  expect(r === 'right' && S.get('t.side') === 'right', `an invalid choice "up" was accepted (value now ${S.get('t.side')})`);
  S.set('t.side', 'left');
  S.set('t.flag', false);
  expect(S.set('no.such', 1) === undefined && S.get('no.such') === undefined, 'set() on an unknown key stored a value');
  S.lock('t.side');
  expect(S.isLocked('t.side'), 'lock() did not lock');
  r = S.set('t.side', 'right');
  expect(r === 'left', `a locked setting changed on set() (now ${r})`);
  r = S.reset('t.side');
  expect(r === 'left', `a locked setting changed on reset() (now ${r})`);
  const rows = S.all();
  expect(rows.map((x) => x.key).join(',') === 't.flag,t.side,t.scale,t.go' && rows[1].locked === true, `all() gave ${rows.map((x) => `${x.key}${x.locked ? '(locked)' : ''}`).join(',')}`);
  const text = S.exportText();
  const lines = text.split('\n');
  expect(/^# .*\d{4}-\d\d-\d\d.*Node/.test(lines[0]), `exportText header "${lines[0]}" lacks the date and device`);
  expect(lines.includes('t.scale = 1.2') && lines.includes('t.side = left') && lines.includes('t.flag = false') && lines.includes('locked: t.side'),
    `exportText is missing a changed value or the locked line: ${JSON.stringify(text)}`);
  expect(!text.includes('t.go'), 'exportText listed an action');
  S.unlock('t.side');
  for (const k of ['t.flag', 't.side', 't.scale']) S.reset(k);
  expect(S.get('t.flag') === true && S.get('t.side') === 'right' && S.get('t.scale') === 1 && !S.isLocked('t.side'), 'reset()/unlock() did not restore the defaults');
  const n = S.importText(`${text}\nbogus.key = 7\nt.scale = banana\nnot a setting line`);
  expect(n === 3, `importText applied ${n}, expected 3 (the unknown key and the bad value must be ignored)`);
  expect(S.get('t.flag') === false && S.get('t.side') === 'left' && S.get('t.scale') === 1.2 && S.isLocked('t.side'),
    `importText did not restore the exported state: flag=${S.get('t.flag')} side=${S.get('t.side')} scale=${S.get('t.scale')} locked=${S.isLocked('t.side')}`);
  expect(S.get('bogus.key') === undefined, 'importText stored an unknown key');
  let threw = false;
  try { S.define('t.badtab', { tab: 'Nope', type: 'toggle', default: true, label: 'Bad' }); } catch { threw = true; }
  expect(threw, 'define() accepted the tab "Nope"');
  expect(any >= 7, `on('*') heard only ${any} changes`);
  expect(ran === 0, 'an action ran without being pressed');
  check('settings', bad.length === 0, bad.length === 0
    ? 'define/get/set/reset/on/all/lock/exportText/importText round-trip; ranges clamp and snap; unknown keys, bad values and bad specs refused'
    : bad.join(' | '));
}

/**
 * Baked-figure maths in Node (src/units/impostor.js): the direction rule, pose/frame selection and the
 * manifest's rects. Each part also runs against a deliberately broken control, which must fail with the
 * text the real check would print, so a wrong sign or an off-by-one cannot pass unnoticed.
 */
function bakedFigureCountsOkay(rig, baked) {
  return baked.baked + baked.rigged >= rig.rigged - rig.fallingInfantry
    && baked.sprites >= baked.baked + rig.fallingInfantry;
}

async function approvedPackUnit() {
  const P = await import('./bake/compress.mjs');
  const Q = await import('./bake/review-compression.mjs');
  const names = ['base', 'h1_slouch_noroll', 'h2_cap_roll', 'h3_slouch_roll', 'h4_cap_noroll',
    'h4_slouch_roll', 'h5_slouch_noroll', 'h6_cap_roll', 'h7_cap_roll'];
  const counts = { stand: 1, walk: 8, fire: 3, fallen: 1, load: 5 };
  const m = { camera: { directions: 16 }, clips: {}, heads: { h1: { use: 'union' }, h7: { use: 'usct' } }, tiers: {} };
  for (const [clip, n] of Object.entries(counts)) m.clips[clip] = { frames: [...Array(n).keys()] };
  for (const tier of ['close', 'field']) {
    const T = { variants: {}, directionsByClip: {} }; m.tiers[tier] = T;
    for (const clip of Object.keys(counts)) T.directionsByClip[clip] = [...Array(16).keys()];
    for (const name of names) {
      const G = name === 'base' ? T : (T.variants[name] = {});
      const c = { head: name === 'h7_cap_roll' ? 'h7' : 'h1', use: name === 'h7_cap_roll' ? 'usct' : 'union' };
      if (name === 'base') T.baseComposition = c; else G.composition = c;
      G.pages = [...Array(tier === 'close' ? 4 : 1).keys()].map((i) => ({ file: `soldier_${tier}${name === 'base' ? '' : '_' + name}_${i}.png`, w: 2048, h: 2048 }));
      G.count = 288; G.frames = {};
      for (const [clip, n] of Object.entries(counts)) for (let k = 0; k < n; k++) for (let d = 0; d < 16; d++)
        G.frames[`${clip}_${k}_d${String(d).padStart(2, '0')}`] = { page: 0, x: 2, y: 2, w: 8, h: 8, ox: 0, oy: 0, ax: 4, ay: 7, ppm: 8 };
    }
  }
  const rejects = (mutate) => { const copy = structuredClone(m); mutate(copy); try { P.validateApproved(copy); return false; } catch { return true; } };
  const real = P.validateApproved(m);
  const controls = {
    missingFrame: rejects((x) => { delete x.tiers.close.variants.h2_cap_roll.frames.walk_0_d15; }),
    missingLook: rejects((x) => { delete x.tiers.field.variants.h7_cap_roll; }),
    missingScale: rejects((x) => { delete x.tiers.field.frames.load_4_d00.ppm; }),
    offPage: rejects((x) => { x.tiers.close.frames.fire_0_d00.x = 2048; }),
    eligibility: rejects((x) => { x.tiers.field.variants.h7_cap_roll.composition.use = 'union'; }),
    duplicateDirection: rejects((x) => { x.tiers.field.directionsByClip.walk[15] = 14; }),
  };
  check('approved-pack-contract', real.frames === 5184 && real.pages === 45 && Object.values(controls).every(Boolean),
    `full pack ${JSON.stringify(real)}; broken missing-frame/look/scale, rect, eligibility and direction controls ${JSON.stringify(controls)}`);
  const mip = P.mipBytes(4, 4), colour = Buffer.from([20, 100, 200, 255, 10, 20, 30, 128]);
  const quality = Q.comparePixels(colour, colour).ok && !Q.comparePixels(colour, Buffer.alloc(8)).ok
    && !Q.comparePixels(Buffer.alloc(8), Buffer.alloc(8)).ok
    && !Q.comparePixels(colour, Buffer.from([200, 100, 20, 255, 30, 20, 10, 128])).ok;
  check('compression-controls', mip.block16 === 48 && mip.rgba8 === 84 && mip.levels === 3 && quality,
    `4x4 + 2x2 + 1x1 allocation ${JSON.stringify(mip)}; identical passes, missing pixels and changed colours fail`);
  const diag = { diagnosticOnly: true, fieldable: false, controls: {}, pages: P.DIAGNOSTIC_PAGES.map((source) => ({ source, integrity: true,
    comparisons: ['png->premul', 'png->raw', 'raw->rgba', 'rgba->bc7', 'png->bc7', 'raw->raw'].flatMap((route) => [0, 1, 2].map((lod) => ({ route, lod, metrics: Q.comparePixels(colour, colour) }))) })) };
  for (const tier of ['close', 'field']) for (const key of ['Upload', 'RawBase', 'Identity', 'Missing', 'Colour']) diag.controls[tier + key] = true;
  const rejectsDiag = (mutate) => { const x = structuredClone(diag); mutate(x); return !Q.diagnosticEvidenceOkay(x); };
  check('compression-diagnostic-contract', Q.diagnosticEvidenceOkay(diag)
    && rejectsDiag((x) => { x.fieldable = true; }) && rejectsDiag((x) => { x.pages.pop(); })
    && rejectsDiag((x) => { x.pages[1].source = x.pages[0].source; })
    && rejectsDiag((x) => { x.pages[0].comparisons[1] = x.pages[0].comparisons[0]; })
    && rejectsDiag((x) => { x.controls.fieldRawBase = false; }) && rejectsDiag((x) => { x.pages[0].integrity = false; })
    && rejectsDiag((x) => { x.pages[0].comparisons[0].metrics.samples = 0; }),
    'two fixed pages, all six routes/mips, real upload controls and allocation required; never fieldable');
  const ktxControl = (raw) => {
    const b = Buffer.alloc(112); Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32LE(raw ? 37 : 0, 12); b.writeUInt32LE(4, 20); b.writeUInt32LE(4, 24); b.writeUInt32LE(3, 40);
    b.writeUInt32LE(raw ? 0 : 2, 44); b.writeUInt32LE(80, 48); b.writeUInt32LE(28, 52); b[92] = raw ? 1 : 166; b[94] = 1;
    return b;
  };
  const badKtx = ktxControl(true); badKtx[94] = 2;
  let rejectsSrgb = false; try { P.markPremultiplied(badKtx, 4, 4, true); } catch { rejectsSrgb = true; }
  check('compression-dfd-controls', P.markPremultiplied(ktxControl(true), 4, 4, true)[95] === 1
    && P.markPremultiplied(ktxControl(false), 4, 4)[95] === 1 && rejectsSrgb,
    'raw RGBA8 and UASTC metadata mark premultiplied bytes; automatic sRGB control rejects');

  const K = await import('../node_modules/three/examples/jsm/libs/ktx-parse.module.js');
  const candidateFixture = (format) => {
    const k = K.createDefaultContainer(); Object.assign(k, { vkFormat: format === 'bc7' ? 145 : 157, pixelWidth: 4, pixelHeight: 4, levelCount: 3 });
    Object.assign(k.dataFormatDescriptor[0], { colorModel: format === 'bc7' ? 134 : 162, colorPrimaries: 0, transferFunction: 1, flags: 1, texelBlockDimension: [3, 3, 0, 0], bytesPlane: [16, 0, 0, 0, 0, 0, 0, 0] });
    k.levels = [0, 1, 2].map(() => ({ levelData: new Uint8Array(16), uncompressedByteLength: 16 })); return k;
  };
  const candidateBytes = (k) => Buffer.from(K.write(k));
  const rejectKtx = (mutate) => { const k = candidateFixture('bc7'); mutate(k); try { P.candidateKtx(candidateBytes(k), 4, 4, 'bc7'); return false; } catch { return true; } };
  check('direct-candidate-ktx-controls', ['bc7', 'astc'].every((f) => P.candidateKtx(candidateBytes(candidateFixture(f)), 4, 4, f).allocation === 48)
    && rejectKtx((k) => { k.levels.pop(); }) && rejectKtx((k) => { k.dataFormatDescriptor[0].flags = 0; })
    && rejectKtx((k) => { k.dataFormatDescriptor[0].transferFunction = 2; })
    && rejectKtx((k) => { k.vkFormat = 146; }) && rejectKtx((k) => { k.levels[2].levelData = new Uint8Array(0); }),
    'actual serialized BC7/ASTC containers require UNORM linear premultiplied complete chains; missing tail/alpha/sRGB/format/payload reject');

  const dds = Buffer.alloc(164); dds.write('DDS '); dds.writeUInt32LE(124, 4); dds.writeUInt32LE(4, 12); dds.writeUInt32LE(4, 16);
  dds.writeUInt32LE(32, 76); dds.write('DX10', 84); dds.writeUInt32LE(98, 128); dds.writeUInt32LE(3, 132); dds.writeUInt32LE(1, 140);
  const rejectsDds = (mutate) => { const b = Buffer.from(dds); mutate(b); try { P.bc7DdsPayload(b, 4, 4); return false; } catch { return true; } };
  const marked = candidateBytes(candidateFixture('astc')), initial = P.candidateKtx(marked, 4, 4, 'astc').levels.map((l) => l.sha256);
  marked[marked.readUInt32LE(48) + 13] = 1; marked[marked.readUInt32LE(48) + 15] = 0;
  check('direct-candidate-dds-metadata-controls', P.bc7DdsPayload(dds, 4, 4).length === 16
    && rejectsDds((b) => b.writeUInt32LE(99, 128)) && rejectsDds((b) => b.writeUInt32LE(8, 16))
    && P.markCandidate(marked, 4, 4, 'astc').levels.every((l, i) => l.sha256 === initial[i]),
    'DDS original dimensions and UNORM payload required; ASTC re-marking preserves every payload hash');

  const caps = { maxTextureSize: 2048, formats: [0x8e8c, 0x93b0], bptc: true, astc: true, profiles: ['ldr'] };
  check('direct-candidate-capability-controls', Q.candidateSupported(caps, 'bc7', 2048, 1808) && Q.candidateSupported(caps, 'astc', 1024, 1912)
    && !Q.candidateSupported({ ...caps, bptc: false }, 'bc7', 4, 4) && !Q.candidateSupported({ ...caps, profiles: [] }, 'astc', 4, 4)
    && !Q.candidateSupported({ ...caps, formats: [] }, 'bc7', 4, 4) && !Q.candidateSupported(caps, 'astc', 4096, 4),
    'extension, linear format enum, ASTC LDR and size required before hardware-format upload');
  const cd = { mode: 'candidate', diagnosticOnly: true, fieldable: false, ok: false, sheets: ['close.png', 'field.png'], controls: {},
    pages: P.DIAGNOSTIC_PAGES.map((source) => ({ source, integrity: true, bc7Gpu: 'RUN', astcGpu: 'UNRUN', allocation: mip,
      metadata: Object.fromEntries(['raw', 'bc7', 'astc'].map((f) => [f, { allocation: f === 'raw' ? 84 : 48,
        levels: [0, 1, 2].map((i) => ({ bytes: f === 'raw' ? [64, 16, 4][i] : 16, sha256: 'a'.repeat(64) })) }])),
      comparisons: ['png->premul', 'png->raw', 'raw->raw', 'raw->bc7-gpu', 'png->bc7-gpu', 'raw->astc-software', 'png->astc-software']
        .flatMap((route) => [0, 1, 2].map((lod) => ({ route, lod, status: 'RUN', metrics: Q.comparePixels(colour, colour) }))) })) };
  for (const tier of ['close', 'field']) for (const key of ['Upload', 'RawBase', 'Identity', 'Missing', 'Colour', 'WrongAlpha', 'DoublePremul', 'AutomaticSrgb', 'Unsupported']) cd.controls[tier + key] = true;
  const rejectsCandidate = (mutate) => { const x = structuredClone(cd); mutate(x); return !Q.candidateEvidenceOkay(x); };
  check('direct-candidate-completion-controls', Q.candidateEvidenceOkay(cd)
    && rejectsCandidate((x) => { x.pages.pop(); }) && rejectsCandidate((x) => { x.pages[1].source = x.pages[0].source; })
    && rejectsCandidate((x) => { x.pages[0].comparisons[1] = x.pages[0].comparisons[0]; })
    && rejectsCandidate((x) => { x.pages[0].comparisons[0].metrics.meanRgb = NaN; })
    && rejectsCandidate((x) => { x.pages[0].comparisons[0].metrics.clipped = 1; })
    && rejectsCandidate((x) => { x.pages[0].metadata.bc7.levels.pop(); })
    && ['WrongAlpha', 'DoublePremul', 'AutomaticSrgb', 'Unsupported'].every((k) => rejectsCandidate((x) => { x.controls['field' + k] = false; }))
    && rejectsCandidate((x) => { x.pages[0].bc7Gpu = 'UNRUN'; }) && rejectsCandidate((x) => { x.fieldable = true; }),
    'candidate schema stays distinct: two pages, all routes/mips, actual BC7 GPU, separate ASTC status, complete bytes and rejecting broken controls');

  const rig = { rigged: 101, fallingInfantry: 1 }, baked = { baked: 90, rigged: 10, sprites: 91 };
  check('baked-standing-count-control', bakedFigureCountsOkay(rig, baked)
    && !bakedFigureCountsOkay(rig, { ...baked, baked: 89 })
    && !bakedFigureCountsOkay(rig, { ...baked, sprites: 90 }),
    'one falling infantry excluded from standing count, included in sprite count; missing living/fallen controls fail');
}

async function bakedUnit() {
  const I = await import(pathToFileURL(path.join(ROOT, 'src', 'units', 'impostor.js')).href);
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'assets', 'figures', 'union-infantry', 'soldier.json'), 'utf8'));
  const TAU = Math.PI * 2;
  const dirChecks = (dir) => {
    const bad = [];
    const d = (yaw, cx, cz) => dir(yaw, 0, 0, cx, cz, 16);
    if (d(0, 0, 100) !== 0) bad.push(`facing the camera gave direction ${d(0, 0, 100)} (want 0)`);
    if (d(Math.PI / 2, 0, 100) !== 4) bad.push(`facing screen-right gave direction ${d(Math.PI / 2, 0, 100)} (want 4)`);
    if (d(Math.PI, 0, 100) !== 8) bad.push(`facing away gave direction ${d(Math.PI, 0, 100)} (want 8)`);
    let turns = 0;
    for (let k = 0; k < 40; k++) {
      const yaw = -3 + k * 0.157, a = d(yaw, 70, 40), b = d(yaw, -70, -40);
      if ((b - a + 16) % 16 !== 8) turns++;
    }
    if (turns) bad.push(`a 180-degree camera turn did not move the direction by 8 for ${turns} of 40 headings`);
    return bad;
  };
  const mirrored = (yaw, x, z, cx, cz, n) => { const k = Math.round(((Math.atan2(cx - x, cz - z) - yaw) / TAU) * n); return ((k % n) + n) % n; };
  const L = new I.AtlasLayout(manifest);
  const C = I.BAKE_CLIP;
  const frameChecks = (slotFor) => {
    const bad = [];
    const walk = L.clips.walk;
    const seen = [];
    for (let i = 0; i < walk.count; i++) seen.push(slotFor(C.WALK, (i + 0.5) / walk.count) - walk.start);
    if (seen.join() !== [...Array(walk.count).keys()].join()) bad.push(`walk phases gave frames ${seen.join(',')} (want 0..${walk.count - 1} in order)`);
    if (slotFor(C.WALK, 1.0) !== walk.start || slotFor(C.WALK, 2.999) !== walk.start + walk.count - 1) bad.push('the walk cycle does not wrap at whole cycles');
    // the walk advances one cycle per metres_per_cycle of life-size ground (scaled like the figure)
    const s = 4.4, metres = L.walkMetres * s * 0.25;
    if (slotFor(C.WALK, metres / (s * L.walkMetres)) !== walk.start + Math.floor(walk.count * 0.25)) bad.push('a quarter of metres_per_cycle walked is not a quarter of the cycle');
    const want = { [C.STAND]: 'stand_0', [C.AIM]: 'fire_0', [C.FIRE]: 'fire_1', [C.RECOVER]: 'fire_2', [C.FALLEN]: 'fallen_0', [C.LOAD]: 'load_0' };
    for (const [code, key] of Object.entries(want)) {
      const [name, k] = [key.slice(0, key.lastIndexOf('_')), Number(key.slice(key.lastIndexOf('_') + 1))];
      if (slotFor(Number(code), 0) !== L.clips[name].start + k) bad.push(`pose ${code} gave slot ${slotFor(Number(code), 0)} (want ${key})`);
    }
    // loading steps through every load frame in order as his loading goes from 0 to 1
    const load = L.clips.load;
    const lseen = [];
    for (let i = 0; i < load.count; i++) lseen.push(slotFor(C.LOAD, (i + 0.5) / load.count) - load.start);
    if (lseen.join() !== [...Array(load.count).keys()].join() || slotFor(C.LOAD, 1) !== load.start + load.count - 1) bad.push(`loading 0..1 gave load frames ${lseen.join(',')} (want 0..${load.count - 1} in order)`);
    return bad;
  };
  const offByOne = (clip, phase) => { const v = L.slotFor(clip, phase); return clip === C.WALK ? L.clips.walk.start + ((v - L.clips.walk.start + 1) % L.clips.walk.count) : v; };
  const dReal = dirChecks(I.directionIndex), dCtl = dirChecks(mirrored);
  const fReal = frameChecks((c, p) => L.slotFor(c, p)), fCtl = frameChecks(offByOne);
  // rects: the shipped manifest is inside its pages; a copy with one frame pushed off its page is caught
  const rReal = L.problems();
  const broken = JSON.parse(JSON.stringify(manifest));
  const key = Object.keys(broken.tiers.field.frames)[0];
  broken.tiers.field.frames[key].x = broken.tiers.field.pages[0].w - 3;
  const rCtl = new I.AtlasLayout(broken).problems();
  const ok = dReal.length === 0 && dCtl.some((t) => /screen-right/.test(t)) && fReal.length === 0 && fCtl.some((t) => /walk phases/.test(t))
    && L.missing.length === 0 && rReal.length === 0 && rCtl.length === 1;
  check('baked-maths', ok, ok
    ? `direction rule (0 toward the camera, 4 screen-right, 8 away, +8 on a 180-degree camera turn), walk frames by ground walked, load frames by loading done, aim/fire/recover/fallen/load poses, ${L.slots * L.n} records per tier and look inside their pages; controls fail as they must: mirrored rule "${dCtl[0]}", off-by-one walk "${fCtl[0]}", rect off the page caught (${rCtl.length})`
    : [...dReal, ...fReal, ...L.missing.map((m) => `missing frame ${m}`), ...rReal.map((r) => `rect off its page: ${r}`),
      dCtl.length ? '' : 'CONTROL: the mirrored direction rule passed', fCtl.length ? '' : 'CONTROL: the off-by-one walk passed', rCtl.length === 1 ? '' : `CONTROL: the off-page rect gave ${rCtl.length} problems (want 1)`].filter(Boolean).join(' | '));

  // directions per clip: every direction chosen exists for that clip in that tier and is the nearest it has
  const dirSel = (Lx, pick) => {
    const bad = [];
    for (const tier of Object.keys(Lx.tiers)) {
      const T = Lx.tiers[tier], frames = manifest.tiers[tier].frames;
      for (const [name, c] of Object.entries(Lx.clips)) {
        const av = T.avail[name];
        let lacks = 0, notNearest = 0, first = '';
        for (let k = 0; k < 720; k++) {
          const yaw = -Math.PI + (k + 0.37) * (TAU / 720), cx = 130 * Math.sin(k * 0.7), cz = 130 * Math.cos(k * 0.7);
          const d = pick(tier, c.start, yaw, 0, 0, cx, cz);
          if (!av.includes(d) || !frames[`${name}_0_d${String(d).padStart(2, '0')}`]) { lacks++; if (!first) first = `${tier}:${name} returned direction ${d}, which ${tier}:${name} lacks (has ${av.join(',')})`; continue; }
          let u = (yaw - Math.atan2(cx, cz)) / TAU; u = (u - Math.floor(u)) * Lx.n;
          const dist = (e) => Math.abs((((u - e) % Lx.n) + Lx.n * 1.5) % Lx.n - Lx.n / 2);
          if (dist(d) > Math.min(...av.map(dist)) + 1e-6) notNearest++;
        }
        if (lacks) bad.push(`${first} (${lacks} of 720 headings)`);
        if (notNearest) bad.push(`${tier}:${name} picked a direction that is not the nearest available for ${notNearest} of 720 headings`);
      }
    }
    return bad;
  };
  const counts = Object.entries(L.tiers).map(([t, T]) => `${t} ${Object.entries(T.avail).map(([c, a]) => `${c} ${a.length}`).join('/')}`).join('; ');
  const sReal = dirSel(L, (t, slot, ...a) => L.direction(t, slot, ...a));
  const sCtl = dirSel(L, (t, slot, yaw, x, z, cx, cz) => I.directionIndex(yaw, x, z, cx, cz, L.n)); // assumes 16 for every clip
  const reduced = Object.values(L.tiers).some((T) => Object.values(T.avail).some((a) => a.length < L.n));
  const sOk = sReal.length === 0 && (!reduced || sCtl.some((t) => /lacks/.test(t)));
  check('baked-direction-per-clip', sOk, sOk
    ? `directions per clip read from the manifest (${counts}); 720 headings per clip and tier never pick a missing direction and always the nearest available; control "assume ${L.n} for every clip" fails as it must: "${sCtl[0] || '(no reduced clip in this manifest)'}"`
    : [...sReal, reduced && !sCtl.some((t) => /lacks/.test(t)) ? 'CONTROL: the assume-16 picker passed on a manifest with reduced clips' : ''].filter(Boolean).join(' | '));

  // drawn height: one man pushed through ImpostorPool in stand, walk and load is the same height on the ground
  const pngs = {};
  const pageOf = async (Lx, tier, page) => {
    const file = Lx.tiers[tier].pages[page].file;
    if (!pngs[file]) pngs[file] = PNG.sync.read(await fs.readFile(path.join(ROOT, 'assets', 'figures', 'union-infantry', file)));
    return pngs[file];
  };
  const S = 4.4;
  const measure = async (Lx, tier, clip, phase, yaw = 0, man = 0) => {
    const pool = new I.ImpostorPool(4, { side: 'US' });
    pool.attach({ layout: Lx, textures: { [tier]: Lx.tiers[tier].pages.map(() => null), field: Lx.tiers.field.pages.map(() => null) }, pools: [], state: { close: true } });
    pool.allowClose = tier === 'close';
    pool.cam.set(0, 70, 100); // 122 m away, in front: yaw 0 is direction 0 (facing the viewer), pi/2 direction 4
    pool.begin();
    if (!pool.push(0, 0, 0, yaw, S, clip, phase, 0.5, 0, man)) return null;
    const b = pool.batches[tier].find((x) => x.n > 0);
    const a = b.data, mpp = a[3], [rx, ry, rw, rh] = [a[4], a[5], a[6], a[7]], dy = a[9];
    const png = await pageOf(Lx, tier, b.page);
    const minRun = (0.1 * S) / mpp; // a row at least 10 cm (life) of solid figure wide is the head, not the musket
    let top = -1, bottom = -1;
    for (let r = 0; r < rh; r++) {
      let run = 0, best = 0;
      for (let c = 0; c < rw; c++) {
        run = png.data[((ry + r) * png.width + rx + c) * 4 + 3] >= 225 ? run + 1 : 0;
        if (run > best) best = run;
      }
      if (best >= minRun) { if (top < 0) top = r; bottom = r; }
    }
    return { head: (-(dy + top) * mpp) / S, feet: ((dy + bottom) * mpp) / S };
  };
  // Measured side-on (direction 4, facing screen-right; also 12): seen from the front, a striding man's head
  // and leading foot are nearer the camera than his feet anchor and project lower, which is not a scale error.
  // A clip's height is its tallest frame (the walk's passing position, legs together; load 0): the walk's
  // stride frames dip a few per cent below it by pose (the bob), which the cycle mean also bounds.
  const heights = async (Lx, yaw) => {
    const bad = [], seen = [];
    const dn = `d${(Math.round(yaw / (Math.PI / 8)) + 16) % 16}`;
    for (const tier of ['close', 'field']) {
      const st = await measure(Lx, tier, C.STAND, 0, yaw);
      const walk = [];
      for (let k = 0; k < Lx.clips.walk.count; k++) walk.push(await measure(Lx, tier, C.WALK, (k + 0.5) / Lx.clips.walk.count, yaw));
      const load0 = await measure(Lx, tier, C.LOAD, 0.05, yaw);
      const wMax = Math.max(...walk.map((m) => m.head)), wMean = walk.reduce((a, m) => a + m.head, 0) / walk.length;
      for (const [label, h] of [['walk (passing frame)', wMax], ['walk (cycle mean)', wMean], ['load 0', load0.head]]) {
        const ratio = h / st.head;
        if (Math.abs(ratio - 1) > 0.05) bad.push(`${tier} ${dn} ${label} drawn ${(ratio * 100 - 100).toFixed(0)}% from stand (${h.toFixed(2)} vs ${st.head.toFixed(2)} life m: ${ratio > 1 ? 'taller' : 'shorter'})`);
      }
      for (const [label, m] of [['stand', st], ...walk.map((m, k) => [`walk ${k}`, m]), ['load 0', load0]]) {
        if (Math.abs(m.feet) > 0.15) bad.push(`${tier} ${dn} ${label} feet ${m.feet.toFixed(2)} m off the ground anchor`);
      }
      seen.push(`${tier} ${dn}: stand ${st.head.toFixed(2)}, walk ${walk.map((m) => m.head.toFixed(2)).join('/')} (max ${wMax.toFixed(2)}, mean ${wMean.toFixed(2)}), load 0 ${load0.head.toFixed(2)}`);
    }
    return { bad, seen };
  };
  const side4 = await heights(L, Math.PI / 2), side12 = await heights(L, -Math.PI / 2), front = await heights(L, 0);
  const hReal = { bad: [...side4.bad, ...side12.bad], seen: [...side4.seen, ...side12.seen] };
  const old = JSON.parse(JSON.stringify(manifest)); // an old reader: one anchor and px per metre (stand's) for every clip
  for (const T of Object.values(old.tiers)) { delete T.clips; for (const f of Object.values(T.frames)) { delete f.ax; delete f.ay; delete f.ppm; } for (const V of Object.values(T.variants || {})) for (const f of Object.values(V.frames)) { delete f.ax; delete f.ay; delete f.ppm; } }
  const hCtl = await heights(new I.AtlasLayout(old), Math.PI / 2);
  const hOk = hReal.bad.length === 0 && hCtl.bad.some((t) => /walk \(passing frame\) drawn -?\d+% from stand/.test(t));
  check('baked-height', hOk, hOk
    ? `head-top height in life metres seen side-on, drawn through ImpostorPool.push with each frame's own anchor and scale: ${hReal.seen.join(' | ')} (all within 5% of stand, feet within 15 cm of the anchor; seen from the front, for reference: ${front.seen.join(' | ')}); control "stand's scale for every clip" fails as it must: "${hCtl.bad[0]}"`
    : [...hReal.bad, ...hReal.seen, hCtl.bad.some((t) => /walk \(passing frame\) drawn -?\d+% from stand/.test(t)) ? '' : `CONTROL: one scale for every clip did not fail as expected (${hCtl.bad.slice(0, 2).join('; ') || 'passed'})`].filter(Boolean).join(' | '));

  // looks: each man keeps one look from his index; more than one look in use when the tier has more than one
  const looksCheck = (pick) => {
    const bad = [];
    for (const count of [1, 2, 3]) {
      const a = [...Array(400).keys()].map((i) => pick(i, count)), b = [...Array(400).keys()].map((i) => pick(i, count));
      if (a.some((v, i) => v !== b[i])) bad.push(`with ${count} looks a man's look changed between two calls`);
      if (a.some((v) => !(v >= 0 && v < count))) bad.push(`with ${count} looks a look out of range was returned`);
      const used = new Set(a);
      if (count > 1 && used.size < count) bad.push(`with ${count} looks only ${used.size} were used by 400 men`);
      if (count > 1 && Math.min(...[...Array(count).keys()].map((v) => a.filter((x) => x === v).length)) < 400 / count * 0.6) bad.push(`with ${count} looks the shares are lopsided`);
      if (count > 1 && a.slice(0, 40).every((v, i) => v === i % count)) bad.push(`with ${count} looks the ranks just alternate (i mod ${count})`);
    }
    return bad;
  };
  const vReal = looksCheck(I.variantIndex), vRand = looksCheck((i, n) => Math.floor(Math.random() * n)), vOne = looksCheck(() => 0);
  const nLooks = L.tiers.field.looks.length;
  // through the pool: the same 200 men twice land in the same batches; with more than one look, both are used
  const perLook = async () => {
    const pool = new I.ImpostorPool(400, { side: 'US' });
    pool.attach({ layout: L, textures: { field: L.tiers.field.pages.map(() => null) }, pools: [], state: { close: true } });
    pool.allowClose = false;
    pool.cam.set(0, 300, 500);
    pool.begin();
    for (let i = 0; i < 200; i++) pool.push(i * 2, 0, 0, 0.3, S, C.STAND, 0, 0.5, 0, i);
    return pool.batches.field.map((b) => `${b.look}:${b.n}`).join(' ');
  };
  const p1 = await perLook(), p2 = await perLook();
  const usedLooks = p1.split(' ').filter((x) => !x.endsWith(':0')).length;
  const vOk = vReal.length === 0 && vRand.some((t) => /changed/.test(t)) && vOne.some((t) => /only 1 were used/.test(t)) && p1 === p2 && (nLooks < 2 || usedLooks >= 2);
  check('baked-variants', vOk, vOk
    ? `field looks ${L.tiers.field.looks.join(', ')}; 200 men by index -> ${p1} (same again: ${p1 === p2}); 1-3 looks: stable, all used, shares within 40%; controls fail as they must: random "${vRand[0]}", constant "${vOne[0]}"`
    : [...vReal, p1 === p2 ? '' : `pushing the same men twice gave ${p1} then ${p2}`, nLooks >= 2 && usedLooks < 2 ? `only one look used: ${p1}` : '',
      vRand.length ? '' : 'CONTROL: a random look passed', vOne.length ? '' : 'CONTROL: a single look passed'].filter(Boolean).join(' | '));
}

/**
 * Baked figures on the battle page (look.figureStyle): the sprites draw at least as many men as the rigged
 * figures did, every instance's atlas rect lies inside its page, the direction follows the camera, the
 * split-screen compare draws both styles clipped to their sides, and look.menPerFigure 5 doubles the figures.
 */
async function bakedFigures(page) {
  const setup = await page.evaluate(async () => {
    const S = await import('./src/settings.js');
    const G = window.__game, g = G.game;
    if (!g.paused) g.togglePause();
    window.__game.hud.toggleArmy(false);
    document.getElementById('result').close();
    const u = g.units.filter((v) => v.alive && v.type === 'infantry').sort((a, b) => b.figures.length - a.figures.length)[0];
    const r = G.rts;
    r.goal.x = u.x; r.goal.z = u.z; r.goal.dist = 320; r.goal.pitch = r._pitch(320); r.goal.yaw = u.facing + 0.6;
    r.snap();
    window.__bk = { id: u.id };
    return { unit: u.id, style: S.get('look.figureStyle') };
  });
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  await frames(3);
  const rigPng = await shot(page, 'rigged-view');
  const rig = await page.evaluate(async () => {
    const g = window.__game.game;
    // Rigged counts include infantry still falling; baked.standing deliberately excludes FALLEN poses.
    // The simulation is paused, so this same set remains falling through both style captures.
    const fallingInfantry = g.units.filter((u) => u.type === 'infantry')
      .reduce((n, u) => n + u.figures.filter((f) => !f.alive && !f.gone).length, 0);
    return { ...g.figuresDrawn(), fallingInfantry };
  });
  await page.evaluate(async () => { (await import('./src/settings.js')).set('look.figureStyle', 'baked'); });
  await page.waitForFunction(() => { const g = window.__game.game; return g.baked.state === 'failed' || (g.baked.state === 'ready' && g.figuresDrawn().sprites > 0); }, null, { timeout: 90_000, polling: 250 }).catch(() => {});
  await frames(3);
  const bakedPng = await shot(page, 'baked');
  const bk = await page.evaluate(async () => { const g = window.__game.game; return { state: g.baked.state, error: g.baked.error, drawn: g.figuresDrawn(), problems: [...g.impostors.US.rectProblems(), ...g.impostors.CS.rectProblems()] }; });
  const colours = new Set();
  let differ = 0, sampled = 0;
  for (let y = 40; y < bakedPng.height; y += 12) for (let x = 40; x < bakedPng.width; x += 12) {
    const i = (y * bakedPng.width + x) * 4;
    colours.add((bakedPng.data[i] << 16) | (bakedPng.data[i + 1] << 8) | bakedPng.data[i + 2]);
    sampled++;
    if (Math.abs(bakedPng.data[i] - rigPng.data[i]) + Math.abs(bakedPng.data[i + 1] - rigPng.data[i + 1]) + Math.abs(bakedPng.data[i + 2] - rigPng.data[i + 2]) > 30) differ++;
  }
  const total = bk.drawn.baked + bk.drawn.rigged;
  const expectedStanding = rig.rigged - rig.fallingInfantry;
  check('baked-draws', bk.state === 'ready' && bakedFigureCountsOkay(rig, bk.drawn) && bk.drawn.baked > 0
    && colours.size > 50 && differ > sampled * 0.002,
    `atlas ${bk.state}${bk.error ? ` (${bk.error})` : ''}; rigged style drew ${rig.rigged} figures (${rig.fallingInfantry} falling infantry), baked style ${bk.drawn.baked} standing sprites + ${bk.drawn.rigged} rigged (crews, officers) = ${total} (want >= ${expectedStanding} standing); ${bk.drawn.sprites} sprite instances including fallen in ${bk.drawn.calls} draw calls; ${colours.size} colours; ${differ} of ${sampled} sampled pixels changed from the rigged picture (want > 0.2%)`);
  check('baked-rects', bk.drawn.sprites > 0 && bk.problems.length === 0, bk.problems.length === 0 ? `all ${bk.drawn.sprites} instances' atlas rects lie inside their pages` : `${bk.problems.length} outside: ${bk.problems.slice(0, 4).join('; ')}`);

  // direction: turn the camera 180 degrees about the brigade; the same man's baked direction moves by 8 of 16
  const dir = await page.evaluate(async () => {
    const I = await import('./src/units/impostor.js');
    const G = window.__game, g = G.game;
    const u = g.units.find((v) => v.id === window.__bk.id);
    const f = u.figures.find((v) => v.alive);
    const imp = g.impostors[u.side];
    G.rts.goal.x = f.x; G.rts.goal.z = f.z; // turn about this man, so his bearing to the camera turns by exactly 180 degrees
    const at = () => { G.rts.snap(); G.rts.update(0.016); G.camera.updateMatrixWorld(); g.setView(G.camera, innerHeight); return I.directionIndex(f.yaw, f.x, f.z, imp.cam.x, imp.cam.z); };
    const a = at();
    const before = Array.from(imp.batches.field[0].data.subarray(0, 120));
    G.rts.goal.yaw += Math.PI;
    const b = at();
    return { a, b, before };
  });
  await frames(2);
  const after = await page.evaluate(async () => { const g = window.__game.game; const u = g.units.find((v) => v.id === window.__bk.id); return Array.from(g.impostors[u.side].batches.field[0].data.subarray(0, 120)); });
  const changed = after.some((v, i) => v !== dir.before[i]);
  check('baked-direction', (dir.b - dir.a + 16) % 16 === 8 && changed, `a man's baked direction ${dir.a} -> ${dir.b} after the camera turned 180 degrees (want +8 mod 16); sprite buffer changed=${changed}`);

  // loading: a firing brigade that has fired and is reloading draws its men in the load frames, stepping through
  // them as the reload fills; the same brigade loaded (reload 1) draws none (it aims)
  const ld = await page.evaluate(async () => {
    const I = await import('./src/units/impostor.js');
    const g = window.__game.game;
    const u = g.units.find((v) => v.id === window.__bk.id);
    const imp = g.impostors[u.side];
    const keep = { firing: u.firing, reload: u.reload };
    const frames = (reload) => {
      u.firing = true;
      u.reload = reload;
      for (const f of u.figures) { f.fireAt = -1; f.fireT = -1; }
      imp.begin();
      u.animate(0.016, g.simTime);
      const slots = new Set();
      const L = imp.layout, C = L.clips.load;
      for (const tier of ['field', 'close']) for (const b of imp.batches[tier]) {
        for (let i = 0; i < b.n; i++) {
          const k = i * 12, x = b.data[k + 4], y = b.data[k + 5];
          for (let s = C.start; s < C.start + C.count; s++) for (let d = 0; d < L.n; d++) for (let look = 0; look < L.tiers[tier].looks.length; look++) {
            const o = L.entry(s, d, look), R = L.tiers[tier].rects;
            if (R[o + 1] === x && R[o + 2] === y && R[o] === b.page) slots.add(s - C.start);
          }
        }
      }
      return { load: imp.poses[I.BAKE_CLIP.LOAD], aim: imp.poses[I.BAKE_CLIP.AIM], stand: imp.poses[I.BAKE_CLIP.STAND], loadFrames: [...slots].sort().join(',') };
    };
    const early = frames(0.05), late = frames(0.3), loaded = frames(1);
    u.firing = keep.firing; u.reload = keep.reload;
    return { early, late, loaded, men: u.figures.filter((f) => f.alive).length };
  });
  check('baked-load', ld.early.load >= ld.men * 0.9 && ld.loaded.load === 0 && ld.loaded.aim >= ld.men * 0.9 && ld.early.loadFrames !== ld.late.loadFrames,
    `reloading (reload 0.05): ${ld.early.load} of ${ld.men} men in load frames ${ld.early.loadFrames}; later (0.3): ${ld.late.load} in frames ${ld.late.loadFrames}; loaded (reload 1): ${ld.loaded.load} loading, ${ld.loaded.aim} aiming (want 0 and all)`);

  // split-screen compare: both styles drawn, each with its clip side
  const cmp = await page.evaluate(async () => {
    const S = await import('./src/settings.js');
    const C = await import('./src/sandbox/compare.js');
    const M = await import('./src/units/soldier-mesh.js');
    const spec = S.all().find((e) => e.key === 'look.figureStyle').spec;
    C.startCompare('look.figureStyle', spec, 'rigged');
    await new Promise((r) => { let k = 0; const f = () => (++k >= 2 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const g = window.__game.game;
    const V = { ...M.FIGURE_VIEW };
    const drawn = g.figuresDrawn();
    const clips = [...new Set(g.pools.US.buckets.flatMap((b) => Array.from(b.clip.array.subarray(0, b.n))))].sort();
    C.stopCompare();
    return { V, drawn, clips };
  });
  check('baked-compare', cmp.V.rigged && cmp.V.baked && cmp.V.clipRigged === -1 && cmp.V.clipBaked === 1 && cmp.drawn.baked > 0 && cmp.drawn.rigged > cmp.drawn.baked * 0.5 && cmp.clips.includes(-1),
    `comparing rigged | baked: view ${JSON.stringify(cmp.V)}; rigged instances ${cmp.drawn.rigged}, sprites ${cmp.drawn.baked}; rigged clip sides in use ${cmp.clips.join(',')}`);

  // men per figure: 5 roughly doubles the figures, 10 restores the count
  const mpf = await page.evaluate(async () => {
    const S = await import('./src/settings.js');
    const g = window.__game.game;
    const n10 = g.figureCount();
    S.set('look.menPerFigure', 5);
    const n5 = g.figureCount();
    await new Promise((r) => { let k = 0; const f = () => (++k >= 2 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const drawn5 = g.figuresDrawn();
    S.set('look.menPerFigure', 10);
    const back = g.figureCount();
    S.set('look.figureStyle', 'rigged');
    if (g.paused) g.togglePause();
    delete window.__bk;
    return { n10, n5, back, drawn5 };
  });
  const ratio = mpf.n5 / mpf.n10;
  check('men-per-figure', ratio >= 1.7 && ratio <= 2.3 && Math.abs(mpf.back - mpf.n10) <= mpf.n10 * 0.05 && mpf.drawn5.baked >= mpf.n5 * 0.8,
    `${mpf.n10} figures at 1:10 -> ${mpf.n5} at 1:5 (x${ratio.toFixed(2)}, want 1.7-2.3) -> ${mpf.back} back at 1:10; ${mpf.drawn5.baked} sprites drawn at 1:5`);
}

/**
 * Order obedience (DESIGN.md 4b "Quality gates"), on generic sandbox brigades placed in the quiet north-west
 * corner (about (-1000, -850): out of every scenario unit's range and arc, open ground, line of sight checked):
 *   a. a move order ends within 15 m of its ghost, facing within 20 degrees of endFacing
 *   b. rules.moveOrder 'fight': a brigade ordered past an enemy halts and fires before its mark; 'march': it
 *      never halts (the same scene, so each half is the other's control)
 *   c. an attack order halts between 50% and 100% of weapon range from the target and fires (never charges)
 *   d. Hold fire (the dock button): zero volleys while set at an enemy in range; volleys again once cleared
 *   e. an order given while paused is stored and only runs after Play
 */
async function orderObedience(page) {
  await page.evaluate(async () => {
    const S = await import('./src/settings.js');
    S.set('rules.autoPause', false); // a rout elsewhere must not pause these runs
    S.set('rules.moveOrder', 'fight');
    const g = window.__game.game;
    if (g.paused) g.togglePause();
    window.__game.hud.toggleArmy(false);
    document.getElementById('result').close();
  });

  // a. move: ends at the ghost, facing as set
  const a = await page.evaluate(async () => {
    const g = window.__game.game;
    const u = g.spawnUnit({ side: 'US', men: 1500, weapon: 'rifled', x: -1100, z: -700, facing: Math.PI / 2 });
    const face = 0.4;
    g.order(u, { type: 'move', points: [[u.x, u.z], [-1030, -760], [-960, -800]], endFacing: face });
    const ghost = u.order.dest.slice();
    g.fastForward(90);
    const off = Math.abs(Math.atan2(Math.sin(u.facing - face), Math.cos(u.facing - face)));
    const res = { d: Math.hypot(u.x - ghost[0], u.z - ghost[1]), offDeg: (off * 180) / Math.PI, moving: u.follow.active, order: u.order.type, at: [Math.round(u.x), Math.round(u.z)], ghost: ghost.map(Math.round) };
    g.removeUnit(u);
    return res;
  });
  check('order-move-arrives', a.d <= 15 && a.offDeg <= 20 && !a.moving,
    `after 90 sim s the brigade stands at (${a.at}) ${a.d.toFixed(1)} m from its ghost (${a.ghost}) (limit 15), facing ${a.offDeg.toFixed(1)} deg off endFacing (limit 20), still moving=${a.moving}, order=${a.order}`);

  // b. move past an enemy: 'fight' halts and fires on the way; 'march' marches on
  const pass = (mode) => page.evaluate(async (mode) => {
    const S = await import('./src/settings.js');
    S.set('rules.moveOrder', mode);
    const g = window.__game.game;
    const e = g.spawnUnit({ side: 'CS', men: 500, weapon: 'smooth', x: -900, z: -990, facing: 0 });
    const u = g.spawnUnit({ side: 'US', men: 1500, weapon: 'rifled', x: -1150, z: -850, facing: Math.PI / 2 });
    g.order(u, { type: 'move', points: [[u.x, u.z], [-650, -850]], endFacing: Math.PI / 2 });
    let haltAt = null, firedHalted = false;
    for (let t = 0; t < 60; t++) {
      g.fastForward(1);
      if (u.engaged && !haltAt) haltAt = [Math.round(u.x), Math.round(u.z)];
      if (u.engaged && (u.shots || 0) > 0) firedHalted = true;
    }
    const res = { mode, halts: u.haltCount, haltAt, firedHalted, shots: u.shots || 0, x: Math.round(u.x), toGo: Math.round(Math.hypot(u.x + 650, u.z + 850)), state: u.state };
    g.removeUnit(u);
    g.removeUnit(e);
    S.set('rules.moveOrder', 'fight');
    return res;
  }, mode);
  const bf = await pass('fight');
  const bm = await pass('march');
  check('order-move-fights-on-the-way', bf.halts >= 1 && bf.haltAt && bf.haltAt[0] < -800 && bf.firedHalted && bm.halts === 0 && bm.x > -1040,
    `fight: halted ${bf.halts}x, first at (${bf.haltAt}) with ${bf.toGo} m still to go, fired while halted=${bf.firedHalted} (${bf.shots} volleys); march: halted ${bm.halts}x, reached x=${bm.x} (past the halt point, want > -1040), ${bm.shots} volleys on the move`);

  // c. attack: closes to effective range, halts, fires
  const c = await page.evaluate(async () => {
    const g = window.__game.game;
    const e = g.spawnUnit({ side: 'CS', men: 500, weapon: 'smooth', x: -900, z: -990, facing: 0 });
    const u = g.spawnUnit({ side: 'US', men: 1500, weapon: 'rifled', x: -1150, z: -700, facing: Math.PI / 2 });
    const d0 = Math.hypot(u.x - e.x, u.z - e.z);
    g.order(u, { type: 'attack', target: e });
    const rng = g.range(u);
    let haltD = null, fired = false, charged = false;
    for (let t = 0; t < 120 && !fired; t++) {
      g.fastForward(1);
      if (u.order.type === 'charge' || u.melee) charged = true;
      if (haltD === null && !u.follow.active && u.order.type === 'attack') haltD = Math.hypot(u.x - e.x, u.z - e.z);
      if (haltD !== null && !u.follow.active && (u.shots || 0) > 0) fired = true;
    }
    const res = { d0: Math.round(d0), rng: Math.round(rng), haltD: haltD === null ? null : Math.round(haltD), fired, charged, order: u.order.type };
    g.removeUnit(u);
    g.removeUnit(e);
    return res;
  });
  check('order-attack-engages', c.haltD !== null && c.haltD >= c.rng * 0.5 && c.haltD <= c.rng && c.fired && !c.charged,
    `from ${c.d0} m: halted at ${c.haltD} m from the target (weapon range ${c.rng} m, want ${Math.round(c.rng * 0.5)}-${c.rng}), fired=${c.fired}, charged=${c.charged}, order now ${c.order}`);

  // d. Hold fire through the dock button
  await page.evaluate(async () => {
    const g = window.__game.game;
    const e = g.spawnUnit({ side: 'CS', men: 500, weapon: 'smooth', x: -900, z: -990, facing: 0 });
    const u = g.spawnUnit({ side: 'US', men: 1500, weapon: 'rifled', x: -900, z: -840, facing: Math.PI });
    window.__t = { e, u };
    g.select(u);
  });
  const hfBtn = page.getByRole('button', { name: 'Hold fire', exact: true });
  await hfBtn.click();
  const d1 = await page.evaluate(async () => {
    const { u } = window.__t;
    const s0 = u.shots || 0;
    window.__game.game.fastForward(30);
    return { set: u.holdFire, shots: (u.shots || 0) - s0, target: u.target ? u.target.short : null, pressed: document.querySelector('#orders [data-order=holdfire]').getAttribute('aria-pressed') };
  });
  await hfBtn.click();
  const d2 = await page.evaluate(async () => {
    const { u } = window.__t;
    const s0 = u.shots || 0;
    window.__game.game.fastForward(15);
    return { set: u.holdFire, shots: (u.shots || 0) - s0 };
  });
  check('order-hold-fire', d1.set && d1.pressed === 'true' && d1.shots === 0 && d1.target && !d2.set && d2.shots > 0,
    `Hold fire on (button pressed=${d1.pressed}): ${d1.shots} volleys in 30 sim s with ${d1.target || 'no target'} in range; off again: ${d2.shots} volleys in 15 s (want 0, then > 0)`);

  // e. orders given while paused are stored and run on Play
  const e0 = await page.evaluate(async () => {
    const g = window.__game.game;
    const { e, u } = window.__t;
    g.removeUnit(e); // nothing to halt for
    if (!g.paused) g.togglePause();
    g.order(u, { type: 'move', points: [[u.x, u.z], [u.x - 120, u.z + 60]] });
    return { x: u.x, z: u.z, paused: g.paused, order: u.order.type, active: u.follow.active };
  });
  await page.waitForTimeout(800);
  const e1 = await page.evaluate(async () => { const { u } = window.__t; return { x: u.x, z: u.z, order: u.order.type }; });
  const simAtPlay = await page.evaluate(async () => window.__game.game.simTime);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // the real loop runs the sim (SwiftShader manages about 1-5 fps): wait for 3 sim seconds, not wall time
  await page.waitForFunction((t0) => window.__game.game.simTime >= t0 + 3, simAtPlay, { timeout: 60_000, polling: 200 }).catch(() => {});
  const e2 = await page.evaluate(async () => { const { u } = window.__t; const g = window.__game.game; const r = { x: u.x, z: u.z, paused: g.paused }; g.removeUnit(u); delete window.__t; return r; });
  const still = Math.hypot(e1.x - e0.x, e1.z - e0.z), moved = Math.hypot(e2.x - e1.x, e2.z - e1.z);
  check('order-while-paused', e0.paused && e0.order === 'move' && e0.active && still < 0.01 && e1.order === 'move' && !e2.paused && moved > 1,
    `paused=${e0.paused}, order stored=${e0.order} (marching flag ${e0.active}); moved ${still.toFixed(3)} m in 0.8 s paused, then ${moved.toFixed(1)} m in the first 3 sim s after Play (want 0, then > 1)`);
}

/** h. The bottom dock fits without overlap at the iPad's 1024x768 points and a 1440x788 Mac window. */
async function dockFit(page) {
  const bad = [];
  const seen = [];
  for (const vp of [{ width: 1024, height: 768 }, { width: 1440, height: 788 }]) {
    await page.setViewportSize(vp);
    await page.evaluate(async () => { const g = window.__game.game; const u = g.units.find((v) => v.alive && g.controls(v)); g.select(u || null); });
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const q = (s) => box(document.querySelector(s));
      return {
        card: q('#unitcard'), orders: q('#orders'), map: q('#minimap-box'), top: q('#topbar'),
        targets: [...document.querySelectorAll('#dock button, #topbar button, #minimap')].filter((b) => b.offsetParent !== null).map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim() || b.id, ...box(b) })),
      };
    });
    const over = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
    const inside = (a) => a.x >= 0 && a.y >= 0 && a.x + a.w <= vp.width + 0.5 && a.y + a.h <= vp.height + 0.5;
    const tag = `${vp.width}x${vp.height}`;
    const parts = { card: r.card, orders: r.orders, map: r.map, top: r.top };
    const names = Object.keys(parts);
    for (let i = 0; i < names.length; i++) {
      if (!inside(parts[names[i]])) bad.push(`${tag}: ${names[i]} leaves the window (${JSON.stringify(parts[names[i]])})`);
      for (let j = i + 1; j < names.length; j++) if (over(parts[names[i]], parts[names[j]])) bad.push(`${tag}: ${names[i]} overlaps ${names[j]}`);
    }
    for (const t of r.targets) if (t.w < 44 || t.h < 44) bad.push(`${tag}: "${t.name}" is ${Math.round(t.w)}x${Math.round(t.h)} px (min 44)`);
    seen.push(`${tag} card ${Math.round(r.card.w)}x${Math.round(r.card.h)}, orders ${Math.round(r.orders.w)}x${Math.round(r.orders.h)}, map ${Math.round(r.map.w)}x${Math.round(r.map.h)}, ${r.targets.length} targets`);
  }
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(300);
  check('dock-fit', bad.length === 0, bad.length === 0 ? seen.join('; ') : bad.slice(0, 6).join(' | '));
}

/** Collects page errors for a secondary page into `into` (no early abort: those checks run after load). */
function watchErrors(page, url, into) {
  page.on('pageerror', (err) => into.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    into.push(`console.error: ${msg.text()}${loc && loc.url ? ` (${loc.url.replace(url, '')}:${loc.lineNumber})` : ''}`);
  });
  page.on('requestfailed', (req) => into.push(`request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? 'unknown'})`));
  page.on('response', (res) => { if (res.status() >= 400) into.push(`HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });
}

/** The sandbox panel on ?sandbox&quality=low, then device.html. */
async function sandboxAndDevice(browser, url, { spacingOnly = false, momentsOnly = false, keyboardOnly = false, dockOnly = false, headerOnly = false } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  await probeProgress(ctx, { prefix: '__sandbox', readFlag: '__sandboxReadBlocked', quotaFlag: '__sandboxQuota' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, url, errors);
    let mounted = false;
    try {
      await page.goto(`${url}?sandbox&quality=low`, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      await page.waitForFunction(() => window.__ready === true && !!document.getElementById('sb-panel'), null, { timeout: READY_TIMEOUT_MS, polling: 200 });
      mounted = true;
    } catch (err) {
      check('sandbox-panel', false, `the sandbox panel did not mount: ${err.message.split('\n')[0]}`);
    }
    if (mounted) {
      if (spacingOnly || momentsOnly || keyboardOnly || dockOnly || headerOnly) {
        await page.evaluate(async () => {
          const { completedSnapshot } = await import('./src/franchise/save.js'), { SAMPLE_ARMY } = await import('./src/reward/data.js');
          await window.__progressFixture.seed(JSON.stringify(completedSnapshot({ awardId: 'spacing-preservation', army: structuredClone(SAMPLE_ARMY), depot: [], issued: [], seed: 19, grade: 'Victory' })));
          window.__sandboxWrites = 0;
        });
        if (process.argv.includes('--native')) {
          const renderer = await page.evaluate(async () => { const gl = document.getElementById('battlefield').getContext('webgl2'), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
          check(headerOnly ? 'header-native-renderer' : dockOnly ? 'dock-native-renderer' : 'spacing-native-renderer', !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
        }
        if (dockOnly) { await dockControls({ page, check, shot, result, errors }); await page.close(); return; }
        if (headerOnly) { await headerControls({ page, check, shot, result, errors }); await page.close(); return; }
        if (keyboardOnly) await keyboardControls({ page, check, shot, result });
        else if (momentsOnly) await momentControls({ page, check, shot, result }); else await spacingControls({ page, check, shot, result });
        check(`${keyboardOnly ? 'keyboard' : momentsOnly ? 'moments' : 'spacing'}-no-console-errors`, errors.length === 0, JSON.stringify(errors)); await page.close(); return;
      }
      const tabs = await page.locator('#sb-panel [role=tab]').allTextContents();
      const want = ['Units', 'Rules', 'Look', 'Moments', 'Screens'];
      check('sandbox-panel', tabs.join(',') === want.join(','), `tabs: ${tabs.join(', ') || 'none'} (want ${want.join(', ')})`);

      // a range setting drives a CSS variable, through the real slider and keyboard
      await page.getByRole('tab', { name: 'Screens' }).click();
      const selected = await page.getByRole('tab', { name: 'Screens' }).getAttribute('aria-selected');
      const slider = page.getByRole('slider', { name: 'Interface size' });
      const cssVar = () => page.evaluate(async () => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());
      const before = await cssVar();
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      const after = await cssVar();
      check('sandbox-setting', selected === 'true' && before === '1' && after === '1.05', `Screens tab aria-selected=${selected}; --ui-scale ${before || '(unset)'} -> ${after || '(unset)'} after one ArrowRight (want 1 -> 1.05)`);

      // Lock this: the control is disabled, the lock mark shows and set() is refused
      await page.getByRole('checkbox', { name: 'Lock this: Interface size' }).check();
      const lockState = await page.evaluate(async () => {
        const S = await import('./src/settings.js');
        const row = document.querySelector('[data-key="screens.uiScale"]');
        const kept = S.set('screens.uiScale', 1.3);
        return { disabled: row.querySelector('input[type=range]').disabled, mark: !row.querySelector('.sb-lockmark').hidden, locked: S.isLocked('screens.uiScale'), kept };
      });
      check('sandbox-lock', lockState.disabled && lockState.mark && lockState.locked && lockState.kept === 1.05,
        `slider disabled=${lockState.disabled}, lock mark shown=${lockState.mark}, isLocked=${lockState.locked}, set(1.3) while locked kept ${lockState.kept} (want 1.05)`);

      // Copy settings (clipboard, or the hand-copy box) and Paste settings
      await page.getByRole('button', { name: 'Copy settings' }).click();
      await page.waitForFunction(() => /copied|by hand/i.test(document.querySelector('.sb-status')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const copied = await page.evaluate(async () => {
        const box = document.getElementById('sb-copybox');
        if (box && !box.hidden) return { via: 'hand-copy box', text: document.getElementById('sb-copy-text').value };
        try { return { via: 'clipboard', text: await navigator.clipboard.readText() }; } catch (e) { return { via: 'nothing', text: String(e) }; }
      });
      await page.getByRole('button', { name: 'Paste settings' }).click();
      await page.getByLabel('Paste a settings block, then Apply.').fill('look.panelSide = left\nnot.a.setting = 3');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      const pasted = await page.evaluate(async () => ({ left: document.getElementById('sb-panel').classList.contains('sb-left'), status: document.querySelector('.sb-status').textContent }));
      const copyOk = copied.text.includes('screens.uiScale = 1.05') && copied.text.includes('locked: screens.uiScale');
      check('sandbox-copy-paste', copyOk && pasted.left && /Applied 1 setting/.test(pasted.status),
        `copy via ${copied.via}: ${JSON.stringify(copied.text.slice(0, 160))}; paste moved the panel left=${pasted.left}, said "${pasted.status}"`);

      // a setting defined after the panel opened appears at once; its Compare button drives the divider state
      await page.getByRole('tab', { name: 'Look' }).click();
      const lateShown = await page.evaluate(async () => {
        const S = await import('./src/settings.js');
        S.define('look.testGrade', { tab: 'Look', type: 'choice', default: 'a', compare: true, label: 'Test grade', note: 'A test choice defined after the panel opened.',
          options: [{ value: 'a', label: 'Warm' }, { value: 'b', label: 'Cool' }, { value: 'c', label: 'Plain' }] });
        return !!document.querySelector('#sb-panel [data-key="look.testGrade"]');
      });
      const cmpState = () => page.evaluate(async () => (await import('./src/sandbox/compare.js')).compareState());
      let cmp = { started: null, moved: null, picked: null, ended: 'not reached' };
      if (lateShown) {
        await page.getByRole('button', { name: 'Compare Test grade side by side' }).click();
        cmp.started = await cmpState();
        await page.getByRole('slider', { name: 'Compare divider for Test grade' }).focus();
        await page.keyboard.press('ArrowRight');
        cmp.moved = await cmpState();
        await page.getByRole('group', { name: 'Right of the divider' }).getByRole('button', { name: 'C: Plain' }).click();
        cmp.picked = await cmpState();
        await page.getByRole('button', { name: 'End compare' }).first().click();
        cmp.ended = { state: await cmpState(), overlay: await page.locator('.sb-compare').count() };
      }
      const s0 = cmp.started, s1 = cmp.moved, s2 = cmp.picked;
      check('sandbox-late-define-compare', lateShown && s0 && s0.key === 'look.testGrade' && s0.a === 'a' && s0.b === 'b' && s0.split === 0.5
        && s1 && Math.abs(s1.split - 0.52) < 1e-9 && s2 && s2.b === 'c' && s2.a === 'a' && cmp.ended.state === null && cmp.ended.overlay === 0,
      `late define shown=${lateShown}; started ${JSON.stringify(s0)}; after ArrowRight ${JSON.stringify(s1)}; after Right C ${JSON.stringify(s2)}; ended ${JSON.stringify(cmp.ended)}`);

      // Units and Moments tools: spawn a generic brigade, shell it, rout it, remove it (through the panel)
      {
        await page.getByRole('tab', { name: 'Units' }).click();
        const n0 = await page.locator('#markers .marker').count();
        await page.getByRole('button', { name: 'Spawn Union brigade at view centre' }).click();
        const spawned = await page.evaluate(async () => {
          const u = window.__game.game.selected;
          return { markers: document.querySelectorAll('#markers .marker').length, name: u ? u.name : null, commander: u ? u.commander : 'none', men: u ? u.men : 0, figs: u ? u.figures.length : 0 };
        });
        await page.getByRole('tab', { name: 'Moments' }).click();
        await page.getByRole('button', { name: 'Shell burst at view centre' }).click();
        await page.getByRole('button', { name: 'Selected: rout' }).click();
        const routed = await page.evaluate(async () => (window.__game.game.selected ? window.__game.game.selected.state : null));
        await page.getByRole('tab', { name: 'Units' }).click();
        await page.getByRole('button', { name: 'Remove selected' }).click();
        const n2 = await page.locator('#markers .marker').count();
        check('sandbox-units-moments', spawned.markers === n0 + 1 && /^Union brigade \d+$/.test(spawned.name || '') && spawned.commander === null && spawned.men === 500 && spawned.figs === 50 && routed === 'routing' && n2 === n0,
          `markers ${n0} -> ${spawned.markers} after spawn -> ${n2} after remove; spawned "${spawned.name}" (commander ${JSON.stringify(spawned.commander)}, ${spawned.men} men, ${spawned.figs} figures); after "Selected: rout" its state was ${routed}`);
      }
      await sandboxRuleTools(page);
      await lookControls({ page, check, shot, result });
      await viewControls({ page, check, shot, result });
      await spacingControls({ page, check, shot, result });
      await momentControls({ page, check, shot, result });
      await keyboardControls({ page, check, shot, result });
      await dockControls({ page, check, shot, result, errors });
      await headerControls({ page, check, shot, result, errors });
      // Keyboard ordering deliberately closes the panel. The retained comparison resumes inside it.
      if (await page.locator('#sb-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sb-toggle').click();
      // look.orderLine compares split-screen: both styles are built, each clipped to its side of the divider
      {
        await page.getByRole('tab', { name: 'Look' }).click();
        await page.getByRole('button', { name: 'Compare Order line side by side' }).click();
        const during = await page.evaluate(async () => {
          const a = window.__game.arrows;
          a.setPreview([[-200, 100], [-100, 160], [0, 140]], 'US', 14, 30);
          const r = { styles: a.styles(), meshes: a.preview ? a.preview.children.length : 0, clips: a.preview ? a.preview.children.map((m) => m.material.uniforms.uClip.value) : [] };
          a.clearPreview();
          return r;
        });
        await page.getByRole('button', { name: 'End compare' }).first().click();
        const after = await page.evaluate(async () => window.__game.arrows.styles());
        check('sandbox-orderline-compare', JSON.stringify(during.styles) === '[["pencil",-1],["arrow",1]]' && during.meshes === 2 && during.clips.join() === '-1,1' && JSON.stringify(after) === '[["pencil",0]]',
          `comparing: styles ${JSON.stringify(during.styles)}, preview meshes ${during.meshes} with clips ${during.clips.join(',')}; after End compare ${JSON.stringify(after)}`);
      }

      // fps meter shows a number
      await page.waitForTimeout(1200);
      const fpsText = (await page.locator('#sb-panel .sb-fps').textContent() || '').trim();
      const tone = await page.locator('#sb-panel .sb-fps').getAttribute('data-tone');
      check('sandbox-fps', /^\d+ fps (smooth|uneven|slow)$/.test(fpsText) && /^(good|fair|poor)$/.test(tone || ''), `meter reads "${fpsText}" with tone ${tone} (want a number, a word and a tone)`);

      // the round button hides the panel and shows it again
      const toggle = page.getByRole('button', { name: 'Sandbox panel' });
      await toggle.click();
      const hidden = await page.locator('#sb-panel').isHidden();
      const expanded = await toggle.getAttribute('aria-expanded');
      const box = await toggle.boundingBox();
      await toggle.click();
      const shownAgain = await page.locator('#sb-panel').isVisible();
      check('sandbox-hide', hidden && expanded === 'false' && shownAgain && box && box.width >= 44 && box.height >= 44,
        `hidden after one tap=${hidden} (aria-expanded=${expanded}), shown after another=${shownAgain}, button ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'missing'} px`);
      await page.evaluate(async () => { (await import('./src/settings.js')).reset('look.panelSide'); });
      await page.waitForTimeout(1500); // the slide-in animation, at SwiftShader frame rates
      await page.screenshot({ path: path.join(OUT_DIR, `s1-sandbox-${stamp}.png`), type: 'png' });
      result.screenshots.push(path.relative(ROOT, path.join(OUT_DIR, `s1-sandbox-${stamp}.png`)));

      try {
        const axe = await new AxeBuilder({ page }).analyze();
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        result.sandboxAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
        check('sandbox-axe', serious.length === 0, serious.length === 0 ? `0 serious/critical violations with the panel open (${axe.violations.length} minor/moderate${axe.violations.length ? `: ${axe.violations.map((v) => v.id).join(', ')}` : ''})` : serious.map((v) => `${v.impact} ${v.id} on ${v.nodes.length} node(s): ${v.help} [${v.nodes.slice(0, 2).map((x) => x.target.join(' ')).join('; ')}]`).join(' | '));
      } catch (err) {
        check('sandbox-axe', false, `axe-core could not run: ${err.message.split('\n')[0]}`);
      }
    }
    check('sandbox-no-console-errors', errors.length === 0, errors.length === 0 ? '0 errors' : `${errors.length} error(s): ${errors.slice(0, 5).join(' | ')}`);
    await page.close();

    // device.html
    const dev = await ctx.newPage();
    const devErrors = [];
    watchErrors(dev, url, devErrors);
    let tier = '', bench = '';
    try {
      await dev.goto(`${url}device.html`, { waitUntil: 'load', timeout: 60_000 });
      await dev.waitForFunction(() => /^Tier /.test(document.getElementById('r-tier').textContent), null, { timeout: 60_000, polling: 200 });
      tier = await dev.locator('#r-tier').textContent();
      await dev.waitForFunction(() => /fps average|not run|not enough/.test(document.getElementById('r-bench1').textContent), null, { timeout: 60_000, polling: 250 });
      bench = await dev.locator('#r-bench1').textContent();
    } catch (err) {
      tier = tier || `(no tier line: ${err.message.split('\n')[0]})`;
      bench = bench || `(benchmark did not finish: ${err.message.split('\n')[0]})`;
    }
    const renderer = await dev.locator('#r-renderer').textContent().catch(() => '?');
    check('device-page', /^Tier \d/.test(tier) && /fps average/.test(bench), `${tier}; ratio 1: ${bench}; chip: ${renderer}`);
    check('device-no-console-errors', devErrors.length === 0, devErrors.length === 0 ? '0 errors' : `${devErrors.length} error(s): ${devErrors.slice(0, 5).join(' | ')}`);
    await dev.close();
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Real controls for placement experience and shared charge/fatigue multipliers, in an owned context. */
async function sandboxRuleTools(page) {
  if (!(await page.evaluate(async () => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const before = await page.evaluate(async () => {
    const { completedSnapshot } = await import('./src/franchise/save.js');
    const { SAMPLE_ARMY } = await import('./src/reward/data.js');
    const raw = JSON.stringify(completedSnapshot({ awardId: 'sandbox-preservation', army: structuredClone(SAMPLE_ARMY), depot: [], issued: [], seed: 19, grade: 'Victory' }));
    await window.__progressFixture.seed(raw); window.__sandboxWrites = 0;
    return { raw, xp: window.__game.game.units.filter((u) => !u.id.startsWith('sandbox-')).map((u) => [u.id, u.xp]) };
  });
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  const veterancy = page.getByRole('group', { name: "Next brigade's veterancy", exact: true });
  await veterancy.getByRole('radio', { name: 'Green', exact: true }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('switch', { name: 'Command both sides', exact: true }).check();
  const seen = [];
  for (const side of ['Union', 'Confederate']) {
    await page.getByRole('button', { name: `Spawn ${side} brigade at view centre`, exact: true }).click();
    const u = await page.evaluate(async () => { const g = window.__game.game, u = g.selected; return { id: u.id, side: u.side, xp: u.xp, defXp: u.def.xp, commander: u.commander, controlled: g.controls(u) }; });
    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    u.held = await page.evaluate(async () => window.__game.game.selected.order.firm === true);
    seen.push(u); await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  }
  check('sandbox-veterancy-both-sides', seen.every((u) => u.xp === 4 && u.defXp === 4 && u.commander === null && u.controlled && u.held) && seen.map((u) => u.side).join() === 'US,CS',
    `real Elite placement and Hold: ${JSON.stringify(seen)}`);
  await page.getByRole('button', { name: "Reset Next brigade's veterancy", exact: true }).click();
  await page.getByRole('button', { name: 'Spawn Union brigade at view centre', exact: true }).click();
  const green = await page.evaluate(async () => window.__game.game.selected.xp);
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  check('sandbox-veterancy-reset', green === 1 && await veterancy.getByRole('radio', { name: 'Green', exact: true }).isChecked(), 'Reset restores Green for the next placed brigade');
  await shot(page, 'sandbox-veterancy');
  await page.getByRole('switch', { name: 'Command both sides', exact: true }).uncheck();

  const live = () => page.evaluate(async () => ({ ...(await import('./src/sim/rules.js')).RULES }));
  await page.getByRole('tab', { name: 'Rules', exact: true }).click();
  for (const [name, field, want] of [['Charge effect', 'chargeEffect', 1.5], ['Fatigue gain', 'fatigueGain', 2]]) {
    const slider = page.getByRole('slider', { name, exact: true }); await slider.focus(); await page.keyboard.press('End');
    if (want === 1.5) for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    check(`sandbox-live-${field}`, (await live())[field] === want && await page.evaluate(async () => window.__game.game.paused), `keyboard slider sets live ${field}=${want} while battle stays paused`);
    await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).check();
    const kept = await page.evaluate(async ({ field }) => (await import('./src/settings.js')).set(`rules.${field}`, 0.5), { field });
    check(`sandbox-lock-${field}`, kept === want && await slider.isDisabled() && await page.getByRole('button', { name: `Reset ${name}`, exact: true }).isDisabled(), 'Lock keeps the live rule and disables editing/reset');
  }
  await shot(page, 'sandbox-rules');
  await page.getByRole('button', { name: 'Copy settings', exact: true }).click();
  const copied = await page.evaluate(async () => {
    const box = document.getElementById('sb-copybox');
    return box && !box.hidden ? document.getElementById('sb-copy-text').value : navigator.clipboard.readText();
  });
  for (const name of ['Charge effect', 'Fatigue gain']) {
    await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck();
    await page.getByRole('button', { name: `Reset ${name}`, exact: true }).click();
  }
  const reset = await live();
  await page.getByRole('button', { name: 'Paste settings', exact: true }).click();
  await page.getByLabel('Paste a settings block, then Apply.').fill(copied);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const restored = await live();
  check('sandbox-rule-transfer-reset', reset.chargeEffect === 1 && reset.fatigueGain === 1 && restored.chargeEffect === 1.5 && restored.fatigueGain === 2
    && copied.includes('rules.chargeEffect = 1.5') && copied.includes('rules.fatigueGain = 2')
    && await page.getByRole('checkbox', { name: 'Lock this: Charge effect', exact: true }).isChecked()
    && await page.getByRole('checkbox', { name: 'Lock this: Fatigue gain', exact: true }).isChecked(), 'real Copy/Paste restores both values and locks after Reset');
  const preserved = await page.evaluate(async () => ({ raw: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites,
    xp: window.__game.game.units.filter((u) => !u.id.startsWith('sandbox-')).map((u) => [u.id, u.xp]) }));
  check('sandbox-tuning-preserves-progress-roster', preserved.raw === before.raw && preserved.writes === 0 && JSON.stringify(preserved.xp) === JSON.stringify(before.xp),
    'controls/placement leave exact completed progress and original roster xp unchanged');
  const terminal = await page.evaluate(async () => {
    const { game, practice } = window.__game;
    game.over = true; game.result = { winner: 'US', why: 'Sandbox terminal isolation fixture' }; practice.finishResult();
    return { empty: practice.outcome === null && practice.pending === null && practice.saved === null && practice.reward === null,
      text: document.getElementById('result-text').textContent, actionHidden: document.getElementById('result-action').hidden,
      raw: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites };
  });
  check('sandbox-terminal-no-award', terminal.empty && terminal.actionHidden && /no progress rewards/.test(terminal.text) && terminal.raw === before.raw && terminal.writes === 0,
    'actual terminal controller shows no-loot result and keeps progress unchanged (accelerated terminal fixture)');
  await page.getByRole('button', { name: 'Inspect the field', exact: true }).click();
  await page.reload(); await page.waitForFunction(() => window.__ready && document.getElementById('sb-panel'), null, { timeout: READY_TIMEOUT_MS });
  const loaded = await live();
  check('sandbox-rule-reload', loaded.chargeEffect === 1.5 && loaded.fatigueGain === 2 && await page.getByRole('slider', { name: 'Charge effect', exact: true }).isDisabled()
    && await page.evaluate(async (raw) => await window.__progressFixture.raw() === raw && window.__progressPuts === 0 && window.__progressLegacyWrites === 0, before.raw), 'reload retains rule values/locks without a progress write');
  if (!(await page.evaluate(async () => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const name of ['Charge effect', 'Fatigue gain']) {
    await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck(); await page.getByRole('button', { name: `Reset ${name}`, exact: true }).click();
  }
  await page.setViewportSize({ width: 320, height: 720 });
  for (const [tab, key] of [['Units', 'units.spawnVeterancy'], ['Rules', 'rules.fatigueGain']]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const row = page.locator(`[data-key="${key}"]`); await row.scrollIntoViewIfNeeded();
    const targets = await row.locator('.sb-opt, input[type=range], .sb-btn, .sb-lock').evaluateAll((nodes) => nodes.map((n) => { const b = n.getBoundingClientRect(); return { w: b.width, h: b.height }; }));
    const fits = await page.locator('#sb-panel').evaluate((n) => n.scrollWidth <= n.clientWidth && n.querySelector('.sb-body').scrollWidth <= n.querySelector('.sb-body').clientWidth);
    const axe = await new AxeBuilder({ page }).include('#sb-panel').analyze();
    check(`sandbox-new-${tab.toLowerCase()}-narrow`, fits && targets.length > 0 && targets.every((b) => b.w >= 44 && b.h >= 44) && axe.violations.length === 0,
      `320px: ${targets.length} controls >=44px, no panel clipping, axe ${JSON.stringify(axe.violations.map((v) => v.id))}`);
    await shot(page, `sandbox-${tab.toLowerCase()}-320`);
  }
  await page.setViewportSize(VIEWPORT);
}

/** P1: actual controls, stable save readbacks, atomic imports and recoverable quota failure. */
async function rewardProgress(browser, url) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce', acceptDownloads: true });
  await probeProgress(ctx, { prefix: '__p1', readFlag: '__p1ReadBlocked', quotaFlag: '__p1Quota', readSessionKey: 'p1.block' });
  const page = await ctx.newPage(), errors = [];
  watchErrors(page, url, errors);
  const raw = () => progressRaw(page);
  const state = () => page.evaluate(async () => window.__rewardResult);
  async function finish({ settle = true } = {}) {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.rw'));
    if (settle) await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
  }
  async function reveal() {
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
  }
  async function importFile(text) {
    await page.locator('#import-file').setInputFiles({ name: 'army.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  }
  try {
    await page.goto(`${url}reward.html?seed=72`, { waitUntil: 'load' });
    await page.waitForSelector('.rw[data-step="a"]');
    await page.evaluate(async () => {
      localStorage.setItem('cw.settings', '{"screens.sound":false}'); localStorage.setItem('cw.locks', '["screens.sound"]');

    });
    await reveal();
    const pair = await page.evaluate(async () => {
      const { compare } = await import('./src/reward/model.js');
      const s = window.__reward.state;
      for (let t = 0; t < s.tray.length; t++) for (let b = 0; b < s.army.length; b++) {
        const c = compare(s.army[b], s.tray[t]);
        if (c.ok && c.delta.ovr > 0) return { t, b, label: s.army[b].label, before: c.before.ovr, after: c.after.ovr };
      }
      throw new Error('seeded haul has no upgrade');
    });
    const tile = () => page.locator(`.rw-tile[data-t="${pair.t}"]`);
    const brigade = () => page.locator(`.rw-brig[data-b="${pair.b}"]`);
    await tile().focus(); await page.keyboard.press('Enter');
    await brigade().focus(); await page.keyboard.press('Enter');
    const compareDialog = page.getByRole('dialog', { name: `${pair.label}: issue this card?` });
    const compareAxe = await new AxeBuilder({ page }).include('.rw-cmp').analyze();
    result.rewardCompareAxe = compareAxe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    check('reward-compare-axe', compareAxe.violations.length === 0, JSON.stringify(result.rewardCompareAxe));
    await shot(page, 'reward-compare');
    await page.keyboard.press('Tab');
    const tab1 = await page.evaluate(async () => document.activeElement.textContent);
    await page.keyboard.press('Tab');
    const tab2 = await page.evaluate(async () => document.activeElement.textContent);
    await page.keyboard.press('Escape');
    check('reward-keyboard-compare', tab1.includes('Cancel') && tab2.includes('Issue to') && await tile().evaluate((n) => n === document.activeElement), 'keyboard compare wraps within dialog; Escape returns to loot tile');
    await tile().press('Enter'); await brigade().press('Enter');
    await compareDialog.getByRole('button', { name: new RegExp(`^Issue to ${pair.label}`) }).click();
    const equipped = await page.evaluate(async () => {
      const s = window.__reward.state;
      return { army: s.army, depot: s.tray, issued: s.log, seed: s.seed, grade: s.grade, awardId: s.awardId };
    });
    await holdProgressTransaction(page); await finish({ settle: false });
    await page.waitForFunction(() => window.__progressTransactions > window.__saveQueueBase);
    check('reward-queued-save-owner', await page.evaluate(async () => window.__p1Writes === 0
      && document.getElementById('launch').getAttribute('aria-busy') === 'true' && document.getElementById('play').disabled
      && document.getElementById('import').disabled && document.getElementById('retry').disabled
      && !document.getElementById('export').disabled && document.activeElement.id === 'last'), 'queued actual reward completion guards mutators, focuses Saving status and retains export');
    await page.evaluate(async () => { const settings = await import('./src/settings.js'); settings.all().find((e) => e.key === 'moments.rewardPlay').spec.run(); });
    check('reward-queued-replay-guard', await page.locator('.rw').count() === 0 && await page.evaluate(async () => window.__p1Writes === 0), 'sandbox replay cannot replace a waiting completed result');
    await releaseProgressTransaction(page); await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    const original = await state(), originalRaw = await raw();
    const matches = await page.evaluate(async (before) => {
      const { completedSnapshot } = await import('./src/franchise/save.js');
      return JSON.stringify(completedSnapshot(before)) === JSON.stringify(window.__rewardResult);
    }, equipped);
    check('reward-equip-save', matches && /Saved army/.test(await page.locator('#last').textContent()) && original.issued.length === 1 && original.army[pair.b].ovr === pair.after,
      `real keyboard/click equip ${pair.before}->${pair.after}; completed army, identities, depot, issued records, seed, grade and award saved exactly`);
    // Repeated completion callback with the identical completed result must do no further writes.
    await page.evaluate((r) => { window.__reward.state.onDone(r); window.__reward.state.onDone(r); }, equipped);
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-callback-idempotent', await raw() === originalRaw && await page.evaluate(async () => window.__p1Writes === 1), 'repeated callbacks keep the exact save and do not write another award');
    await page.reload();
    await page.waitForFunction(() => window.__rewardResult);
    check('reward-reload', JSON.stringify(await state()) === JSON.stringify(original) && await page.locator('.rw').count() === 0,
      'reload returns to completed army launcher; no new roll or overlay');
    await page.getByRole('button', { name: 'Resume saved army', exact: true }).press('Enter');
    await page.waitForSelector('.rw[data-step="d"]');
    const resumed = await page.evaluate(async () => ({ cards: window.__reward.state.cards.length, issued: window.__reward.state.log.length, title: document.getElementById('rw-counts-title').textContent }));
    const resumeAxe = await new AxeBuilder({ page }).include('.rw-counts').analyze();
    result.rewardResumeAxe = resumeAxe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    check('reward-resume-axe', resumeAxe.violations.length === 0, JSON.stringify(result.rewardResumeAxe));
    await shot(page, 'reward-resume');
    await page.waitForFunction(() => !window.__reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-resume-no-roll', resumed.cards === 0 && resumed.issued === 1 && resumed.title === 'Saved army' && await raw() === originalRaw,
      'resume shows existing equipment and depot, zero rolled cards, unchanged award/item counts');
    const downloadWait = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export army', exact: true }).click();
    const download = await downloadWait, exportPath = path.join(OUT_DIR, `p1-export-${stamp}.json`);
    await download.saveAs(exportPath);
    const exported = await fs.readFile(exportPath, 'utf8');
    check('reward-export', JSON.stringify(JSON.parse(exported)) === JSON.stringify(original), 'actual downloaded file matches completed state');
    for (const invalid of ['{', JSON.stringify({ ...original, version: 99 }), JSON.stringify({ ...original, depot: [...original.depot, original.army[0].weapon] })]) {
      await importFile(invalid);
      await page.waitForFunction(() => document.getElementById('last').textContent.includes('unchanged'));
      check('reward-invalid-import', await raw() === originalRaw && JSON.stringify(await state()) === JSON.stringify(original), 'rejected UI import preserves exact prior storage and visible state');
    }
    await importFile(exported);
    await page.waitForSelector('#replace[open]');
    const dialog = page.getByRole('dialog', { name: 'Replace saved army?' });
    const focusCancel = await page.locator('#replace-cancel').evaluate((n) => n === document.activeElement);
    const importAxe = await new AxeBuilder({ page }).include('#replace').analyze();
    result.rewardImportAxe = importAxe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    check('reward-import-axe', importAxe.violations.length === 0, JSON.stringify(result.rewardImportAxe));
    await shot(page, 'reward-import-confirm');
    await page.keyboard.press('Shift+Tab');
    const focusWrapped = await page.locator('#replace-confirm').evaluate((n) => n === document.activeElement);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('replace').open);
    await page.waitForFunction(() => document.activeElement.id === 'import');
    check('reward-import-cancel-focus', focusCancel && focusWrapped && await page.locator('#import').evaluate((n) => n === document.activeElement) && await raw() === originalRaw,
      `native confirmation Cancel=${focusCancel}, Tab wrap=${focusWrapped}; Escape preserves save and returns focus`);
    await page.setViewportSize({ width: 320, height: 480 });
    await importFile(exported); await page.waitForSelector('#replace[open]'); await holdProgressTransaction(page); await page.locator('#replace-confirm').click();
    await page.waitForFunction(() => window.__progressTransactions > window.__saveQueueBase);
    check('reward-queued-import-owner', await page.evaluate(async () => document.getElementById('launch').getAttribute('aria-busy') === 'true'
      && document.getElementById('import').disabled && document.getElementById('retry').disabled && document.getElementById('play').disabled
      && !document.getElementById('export').disabled && document.activeElement.id === 'last'
      && document.getElementById('last').textContent.includes('Saving the imported')
      && (() => { const r = document.activeElement.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; })()), 'actual320px import retains one owner with visible focused status and pending export');
    await shot(page, 'reward-import-waiting-320');
    await importFile(JSON.stringify({ ...original, awardId: 'ignored-overlap' }));
    const queuedExport = page.waitForEvent('download'); await page.locator('#export').click();
    const queuedText = await fs.readFile(await (await queuedExport).path(), 'utf8');
    check('reward-queued-import-export', JSON.stringify(JSON.parse(queuedText)) === JSON.stringify(original) && await page.evaluate((raw) => window.__saveHeldRaw === raw, originalRaw),
      'overlapping file selection is ignored and the actual pending file remains exportable without a write');
    check('reward-queued-export-waiting-copy', await page.locator('#last').textContent().then((t) => t.includes('Saving is still waiting') && !t.includes('retry')), 'export while queued reports waiting without falsely claiming failure');
    await releaseProgressTransaction(page); await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    await page.setViewportSize(VIEWPORT);
    await page.locator('#demos summary').click();
    await page.locator('#play-legendary').click(); await page.waitForSelector('#replace[open]'); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'play-legendary' && !document.getElementById('play-legendary').disabled);
    check('reward-fresh-cancel-trigger', await raw() === originalRaw && await page.locator('#play-legendary').evaluate((n) => document.activeElement === n), 'cancelled fresh demo restores its exact Legendary trigger after operation cleanup');
    await page.getByRole('button', { name: 'Play the reward sequence', exact: true }).click();
    await page.getByRole('button', { name: 'Start fresh demo', exact: true }).click();
    await reveal(); await finish();
    const newAward = (await state()).awardId;
    await importFile(exported);
    await page.getByRole('button', { name: 'Import and replace', exact: true }).click();
    await page.waitForFunction((award) => window.__rewardResult.awardId === award, original.awardId);
    check('reward-import-replace', newAward !== original.awardId && await raw() === originalRaw && JSON.stringify(await state()) === JSON.stringify(original),
      'older exported army atomically replaces a different completed award; no merge or reissue');
    // Inject a real quota exception into browser storage, while using real completion controls.
    await page.getByRole('button', { name: 'Play the reward sequence', exact: true }).click();
    await page.getByRole('button', { name: 'Start fresh demo', exact: true }).click();
    await reveal();
    await page.evaluate(async () => {
      window.__p1Quota = true;
    });
    await finish();
    const pending = await state();
    check('reward-quota-retains', await raw() === originalRaw && /could not save/.test(await page.locator('#last').textContent()) && await page.locator('#retry').isVisible() && await page.locator('#export').isEnabled(),
      'quota failure retains old stored army and completed result, reports failure, offers retry/export');
    const recoveryWait = page.waitForEvent('download');
    await page.locator('#export').click();
    const recovery = await recoveryWait, recoveryPath = path.join(OUT_DIR, `p1-unsaved-export-${stamp}.json`);
    await recovery.saveAs(recoveryPath);
    check('reward-quota-export', JSON.stringify(JSON.parse(await fs.readFile(recoveryPath, 'utf8'))) === JSON.stringify(pending), 'unsaved completed army exports exactly');
    await page.evaluate(async () => { window.__p1Quota = false; });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-quota-retry', JSON.stringify(await state()) === JSON.stringify(pending) && JSON.stringify(JSON.parse(await raw())) === JSON.stringify(pending) && /Saved army/.test(await page.locator('#last').textContent()),
      'retry saves the same pending award without reroll');
    // A new external save must not become authorized merely by opening a preview.
    await page.locator('#play').click(); await page.getByRole('button', { name: 'Start fresh demo', exact: true }).click();
    await reveal();
    await seedProgress(page, originalRaw);
    await finish();
    const conflicted = await state();
    await page.locator('#deal-one').click();
    await page.waitForSelector('.rw[data-step="b"]'); await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Close/ }).click();
    await page.locator('#retry').click();
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-preview-keeps-conflict', await raw() === originalRaw && JSON.stringify(await state()) === JSON.stringify(conflicted) && /changed/.test(await page.locator('#last').textContent()),
      'conflicting external save survives one-card preview and Retry; pending result keeps its original baseline');
    await importFile(exported); await page.getByRole('button', { name: 'Import and replace', exact: true }).click();
    await page.waitForFunction((award) => window.__rewardResult.awardId === award, original.awardId);
    const prefs = await page.evaluate(async () => [localStorage.getItem('cw.settings'), localStorage.getItem('cw.locks')]);
    check('reward-preferences-preserved', prefs[0] === '{"screens.sound":false}' && prefs[1] === '["screens.sound"]', 'save/import/retry leave preferences and locks byte-for-byte unchanged');
    const axe = await new AxeBuilder({ page }).analyze();
    result.rewardAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    check('reward-launcher-axe', axe.violations.length === 0, JSON.stringify(result.rewardAxe));
    result.rewardColors = await page.locator('#launch button:visible').evaluateAll((nodes) => nodes.map((n) => { const s = getComputedStyle(n); return { text: n.textContent, color: s.color, background: s.backgroundColor, border: s.borderColor, outline: s.outlineColor }; }));
    await shot(page, 'reward-saved');
    for (const viewport of [{ width: 1024, height: 768 }, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator('#launch button:visible, #launch a.btn:visible, #launch summary').evaluateAll((nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return { name: n.textContent, w: r.width, h: r.height }; }));
      const scroll = await page.locator('#launch').evaluate((n) => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, top: n.querySelector('section').getBoundingClientRect().top }));
      check(`reward-targets-${viewport.width}`, bounds.every((b) => b.w >= 44 && b.h >= 44) && scroll.scrollWidth <= scroll.clientWidth && scroll.top >= 0, `${bounds.length} controls >=44px; no horizontal clipping or unreachable top`);
      await shot(page, `reward-launcher-${viewport.width}`);
    }
    const beforeReadFailure = await raw();
    await page.evaluate(async () => sessionStorage.setItem('p1.block', '1'));
    await page.reload();
    await page.getByRole('button', { name: 'Retry loading', exact: true }).waitFor();
    check('reward-read-failure-no-roll', await page.locator('.rw').count() === 0 && await raw() === beforeReadFailure,
      'blocked startup read retains stored bytes, displays recovery controls, never rolls fresh loot');
    await page.evaluate(async () => sessionStorage.removeItem('p1.block'));
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click(); await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-read-retry', await raw() === beforeReadFailure && (await state()).awardId === original.awardId && await page.locator('.rw').count() === 0, 'retry loads the original completed army without rolling');
    // Unknown storage is distinct from an observed empty baseline, captured per reward callback.
    await page.setViewportSize(VIEWPORT);
    await page.evaluate(async () => {
      window.__p1Writes = 0;
      sessionStorage.setItem('p1.block', '1');
    });
    if (!await page.locator('#demos').evaluate((n) => n.open)) await page.locator('#demos summary').click();
    await page.locator('#play').click(); await page.getByRole('button', { name: 'Start fresh demo', exact: true }).click();
    await reveal(); await finish();
    const unknown = await state();
    check('reward-unknown-baseline-no-write', await page.evaluate(async () => window.__p1Writes === 0
      && document.getElementById('last').textContent.includes('Progress was unavailable') && !document.getElementById('export').disabled), 'blocked start retains/exportable completed result and never treats unknown storage as empty');
    await page.evaluate(async () => sessionStorage.removeItem('p1.block'));
    await page.setViewportSize({ width: 320, height: 480 }); await holdProgressTransaction(page);
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('last').textContent.includes('Loading saved progress'));
    const readFeedback = await page.evaluate(() => { const r = document.getElementById('last').getBoundingClientRect();
      return { focus: document.activeElement.id, top: r.y, bottom: r.bottom, viewport: innerHeight,
        text: document.getElementById('last').textContent, scroll: document.getElementById('launch').scrollTop }; });
    check('reward-delayed-read-feedback', readFeedback.focus === 'last' && readFeedback.top >= 0 && readFeedback.bottom <= readFeedback.viewport,
      JSON.stringify(readFeedback));
    await shot(page, 'reward-reading-320');
    const readingExport = page.waitForEvent('download'); await page.locator('#export').click();
    check('reward-export-reading-copy', JSON.stringify(JSON.parse(await fs.readFile(await (await readingExport).path(), 'utf8'))) === JSON.stringify(unknown)
      && await page.locator('#last').textContent().then((text) => text.includes('Review is still in progress') && !text.includes('Saving')),
      'actual pending export while reading reports review and never claims an unconfirmed save');
    await releaseProgressTransaction(page);
    await page.waitForSelector('#replace[open]'); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-unknown-recovered-cancel', await raw() === beforeReadFailure && await page.evaluate(async () => window.__p1Writes === 0)
      && JSON.stringify(await state()) === JSON.stringify(unknown), 'recovered existing army still requires consent; Cancel preserves both stored and pending armies');
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.getByRole('button', { name: 'Replace and save', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-unknown-recovered-confirm', await raw() === JSON.stringify(unknown) && await page.evaluate(async () => window.__p1Writes === 1), 'confirmed recovered baseline saves the original pending award once');
    await page.setViewportSize(VIEWPORT);
    await page.evaluate(async () => { sessionStorage.setItem('p1.block', '1'); });
    await page.locator('#play').click(); await page.getByRole('button', { name: 'Start fresh demo', exact: true }).click();
    await reveal(); await page.evaluate(async () => { await window.__progressFixture.clear(); localStorage.removeItem('cw.progress'); sessionStorage.removeItem('p1.block'); }); await finish();
    const unknownEmpty = await state();
    await page.evaluate(async () => sessionStorage.removeItem('p1.block'));
    check('reward-unknown-empty-still-pending', await raw() === null && await page.evaluate(async () => window.__p1Writes === 1), 'recovery to empty storage itself grants no write; explicit Retry is still needed');
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('launch').getAttribute('aria-busy') === 'false');
    check('reward-unknown-empty-retry', await raw() === JSON.stringify(unknownEmpty) && await page.evaluate(async () => window.__p1Writes === 2), 'explicit Retry observes empty storage and saves the same completed result once');
    check('reward-no-console-errors', errors.length === 0, errors.join(' | ') || '0 errors');
  } finally { await ctx.close(); }
}

async function phaseModelUnit() {
  try { const { phaseUnit } = await import('./test-phase.mjs'); const count = phaseUnit(); check('phase-model', count === 20, `${count} immutable phase categories; no launch/store/history authority`); }
  catch (error) { check('phase-model', false, error.message); }
}

async function main() {
  await settingsUnit();
  await bakedUnit();
  await approvedPackUnit();
  await phaseModelUnit();
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { server, url } = await startServer({ port: 0 });
  result.url = url;
  let browser;
  try {
    const native = process.argv.includes('--native');
    browser = await chromium.launch(native ? { channel: 'chrome', headless: false }
      : { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    result.browser = `chromium ${browser.version()}`;
    if (process.argv.includes('--soldier-view')) { result.mode = 'held soldier-eye view'; await soldierViewControls({ browser, url, check, shot, result, watchErrors, native, focused: true }); return; }
    if (process.argv.includes('--save-coordination')) { result.mode = 'two-tab save coordination only';
      await saveCoordination({ browser, url, check, shot, result, watchErrors, trace: process.argv.includes('--save-trace') }); return;
    }
    if (process.argv.includes('--dock')) { result.mode = 'responsive dock only'; await sandboxAndDevice(browser, url, { dockOnly: true }); return; }
    if (process.argv.includes('--header')) { result.mode = 'readable header and native panels'; await sandboxAndDevice(browser, url, { headerOnly: true }); await headerIntro({ browser, url, check, shot, result, watchErrors }); return; }
    if (process.argv.includes('--keyboard')) { result.mode = 'keyboard orders only'; await sandboxAndDevice(browser, url, { keyboardOnly: true }); return; }
    if (process.argv.includes('--spacing')) { result.mode = 'formation spacing only'; await sandboxAndDevice(browser, url, { spacingOnly: true }); return; }
    if (process.argv.includes('--moments')) { result.mode = 'field moments only'; await sandboxAndDevice(browser, url, { momentsOnly: true }); return; }
    if (process.argv.includes('--sandbox')) { result.mode = 'sandbox controls only'; await sandboxAndDevice(browser, url); return; }
    if (process.argv.includes('--deployment')) { result.mode = 'saved deployment route'; await deploymentProgress({ browser, url, check, shot, result, watchErrors, native }); return; }
    if (process.argv.includes('--entry')) { result.mode = 'title and camp only'; await entryProgress({ browser, url, check, shot, result, watchErrors }); return; }
    if (process.argv.includes('--camp')) { result.mode = 'camp equipment only'; await campEquipment({ browser, url, check, shot, result, watchErrors }); return; }
    if (process.argv.includes('--intro')) { result.mode = 'unforced introductory play'; await introPlay({ browser, url, check, shot, result, watchErrors, native }); return; }
    if (process.argv.includes('--practice')) { result.mode = 'practice result bridge only'; await practiceProgress({ browser, url, check, shot, result, watchErrors }); return; }
    if (process.argv.includes('--reward')) { result.mode = 'reward progress only'; await rewardProgress(browser, url); return; }
    if (process.argv.includes('--save')) { result.mode = 'coordinated save and retained writer flows';
      await saveCoordination({ browser, url, check, shot, result, watchErrors });
      await rewardProgress(browser, url);
      await practiceProgress({ browser, url, check, shot, result, watchErrors });
      await entryProgress({ browser, url, check, shot, result, watchErrors }); return;
    }
    if (process.argv.includes('--s1')) {
      result.mode = 's1 only (battle page skipped)';
      await sandboxAndDevice(browser, url);
      return;
    }
    const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })).newPage();

    let rejectEarly;
    const earlyError = new Promise((_, reject) => { rejectEarly = reject; });
    earlyError.catch(() => {});
    const fail = (text) => { consoleErrors.push(text); rejectEarly(new Error(text)); };
    page.on('pageerror', (err) => fail(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      const loc = msg.location();
      const where = loc && loc.url ? ` (${loc.url.replace(url, '')}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') fail(`console.error: ${msg.text()}${where}`);
      else if (msg.type() === 'warning' && !/GL Driver Message|GPU stall|already non-indexed/.test(msg.text())) consoleWarnings.push(`${msg.text()}${where}`);
    });
    page.on('requestfailed', (req) => fail(`request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? 'unknown'})`));
    page.on('response', (res) => { if (res.status() >= 400) fail(`HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });

    // 1. ready
    let readyOk = false, readyDetail;
    const t0 = Date.now();
    try {
      await page.goto(`${url}?practice&quality=low`, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      await Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: READY_TIMEOUT_MS, polling: 200 }), earlyError]);
      readyOk = true;
      readyDetail = `window.__ready after ${Date.now() - t0} ms`;
    } catch (err) {
      readyDetail = /Timeout/i.test(err.message) ? `window.__ready was not set within ${READY_TIMEOUT_MS / 1000} s` : `page failed while loading: ${err.message.split('\n')[0]}`;
    }
    check('ready', readyOk, readyDetail);
    if (readyOk) {
      await page.waitForTimeout(2500);
      const png = await shot(page, 'start');

      // 3. canvas not blank
      const colours = new Set();
      for (let y = 40; y < png.height; y += 24) for (let x = 40; x < png.width; x += 24) {
        const i = (y * png.width + x) * 4;
        colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
      }
      check('canvas-not-blank', colours.size > 50, `${colours.size} distinct colours in the sample grid`);

      // 4. figures and markers
      const info = await page.evaluate(async () => ({ figures: window.__game.game.figureCount(), units: window.__game.game.units.length, markers: document.querySelectorAll('#markers .marker').length }));
      check('figures', info.figures >= MIN_FIGURES && info.markers === info.units, `${info.figures} figures (need >= ${MIN_FIGURES}); ${info.markers} markers for ${info.units} units`);

      // 4b. every brigade and battery starts facing its nearest enemy (within 75 degrees)
      const facing = await page.evaluate(async () => {
        const us = window.__game.game.units;
        return us.map((u) => {
          let best = null, bd = Infinity;
          for (const e of us) if (e.side !== u.side) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd) { bd = d; best = e; } }
          const bear = Math.atan2(best.x - u.x, best.z - u.z);
          return { id: u.id, off: Math.abs(Math.atan2(Math.sin(bear - u.facing), Math.cos(bear - u.facing))) };
        });
      });
      const wrong = facing.filter((f) => f.off > (75 * Math.PI) / 180);
      check('facing', wrong.length === 0, wrong.length === 0 ? `all ${facing.length} units face within 75 deg of their nearest enemy (worst ${Math.max(...facing.map((f) => f.off)).toFixed(2)} rad)` : wrong.map((f) => `${f.id} ${f.off.toFixed(2)} rad off`).join(', '));

      // 5. select + drag-order with a real mouse: press on Franklin's flag, drag a curve, release.
      const marker = page.getByRole('button', { name: /^Franklin.s Brigade/ });
      const box = await marker.boundingBox();
      let orderOk = false, orderDetail = 'Franklin marker not found or off screen';
      if (box) {
        const sx = box.x + box.width / 2, sy = box.y + box.height * 0.45;
        const via = await project(page, -60, 470);
        const end = await project(page, 120, 520);
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          // quadratic curve start -> via -> end
          const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * via.x + t * t * end.x;
          const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * via.y + t * t * end.y;
          await page.mouse.move(x, y);
          await page.waitForTimeout(30);
        }
        const previewShown = await page.evaluate(async () => !!window.__game.arrows.preview);
        await page.mouse.up();
        const st = await page.evaluate(async () => {
          const g = window.__game.game;
          const u = g.units.find((v) => v.id === 'franklin');
          return { selected: g.selected && g.selected.id, orders: g.orders || 0, type: u.order.type, active: u.follow.active, pathPts: u.path ? u.path.length : 0 };
        });
        orderOk = st.selected === 'franklin' && st.orders >= 1 && st.type === 'move' && st.active && previewShown;
        orderDetail = `selected=${st.selected} orders=${st.orders} order=${st.type} moving=${st.active} pathPoints=${st.pathPts} previewArrow=${previewShown}`;
        await page.waitForTimeout(1500);
        await shot(page, 'ordered');
      }
      check('select-drag-order', orderOk, orderDetail);

      // 6. Hold button
      await page.getByRole('button', { name: 'Hold', exact: true }).click();
      const held = await page.evaluate(async () => { const u = window.__game.game.units.find((v) => v.id === 'franklin'); return { type: u.order.type, active: u.follow.active }; });
      check('hold-button', held.type === 'hold' && !held.active, `after Hold: order=${held.type} moving=${held.active}`);

      // f. zoom: a trackpad pinch (ctrl + wheel) toward a point keeps the ground under it within 3% of the view
      {
        const px = { x: Math.round(VIEWPORT.width * 0.32), y: Math.round(VIEWPORT.height * 0.58) };
        const before = await page.evaluate(([x, y]) => {
          const { rts } = window.__game;
          rts.update(1); // settle any easing first
          const p = rts.pick(x, y, document.getElementById('battlefield'));
          return p ? { x: p.x, y: p.y, z: p.z, dist: rts.goal.dist, goal: { ...rts.goal } } : null;
        }, [px.x, px.y]);
        let zoomOk = false, zoomDetail = 'no ground under the test point';
        if (before) {
          await page.mouse.move(px.x, px.y);
          await page.keyboard.down('Control');
          await page.mouse.wheel(0, -240);
          await page.keyboard.up('Control');
          const after = await page.evaluate(([x, y, z, goal]) => {
            const { rts, camera } = window.__game;
            const settle = () => {
              for (let i = 0; i < 4; i++) rts.update(1); // let the eased camera reach its goal
              camera.updateMatrixWorld();
              const v = camera.position.clone().set(x, y, z).project(camera);
              return { sx: (v.x * 0.5 + 0.5) * innerWidth, sy: (-v.y * 0.5 + 0.5) * innerHeight, dist: rts.goal.dist };
            };
            const r = settle();
            // controls: the same zoom about the view centre (no anchoring) must miss by more than the limit, or
            // this check could not fail; the pre-S1 method (target moved a share of the way toward the point) is
            // reported for comparison
            const factor = r.dist / goal.dist;
            Object.assign(rts.goal, goal);
            rts.snap();
            rts.zoomBy(factor);
            r.centre = settle();
            Object.assign(rts.goal, goal);
            rts.snap();
            rts.zoomBy(factor, { x, z });
            r.old = settle();
            return r;
          }, [before.x, before.y, before.z, before.goal]);
          const ex = Math.abs(after.sx - px.x) / VIEWPORT.width, ey = Math.abs(after.sy - px.y) / VIEWPORT.height;
          const err = (o) => Math.max(Math.abs(o.sx - px.x) / VIEWPORT.width, Math.abs(o.sy - px.y) / VIEWPORT.height);
          const ce = err(after.centre), oe = err(after.old);
          zoomOk = after.dist < before.dist * 0.8 && ex < 0.03 && ey < 0.03 && ce >= 0.03;
          zoomDetail = `zoomed ${Math.round(before.dist)} -> ${Math.round(after.dist)} m; the ground point under (${px.x}, ${px.y}) is now at (${after.sx.toFixed(1)}, ${after.sy.toFixed(1)}): off by ${(ex * 100).toFixed(2)}% x, ${(ey * 100).toFixed(2)}% y of the view (limit 3%); controls: zoom about the centre off by ${(ce * 100).toFixed(1)}% (must exceed 3%), pre-S1 zoom-toward off by ${(oe * 100).toFixed(1)}%`;
        }
        check('zoom-to-pointer', zoomOk, zoomDetail);
      }

      // g. touch: synthetic pointerType 'touch' events: a tap selects Willcox, a drag from him orders a march
      {
        const touch = await page.evaluate(async () => {
          const { game, rts, camera, terrain } = window.__game;
          const cv = document.getElementById('battlefield');
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const u = game.units.find((v) => v.id === 'willcox');
          rts.goal.x = u.x + 60; rts.goal.z = u.z; rts.goal.dist = 700; rts.goal.pitch = rts._pitch(700);
          rts.snap(); rts.update(1); camera.updateMatrixWorld();
          const proj = (x, z) => { const v = camera.position.clone().set(x, terrain.heightAt(x, z), z).project(camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; };
          const fire = (type, x, y) => {
            const el = document.elementFromPoint(x, y) || cv;
            el.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }));
          };
          game.select(null);
          const s = proj(u.x, u.z);
          const hit = (document.elementFromPoint(s.x, s.y) || {}).id || (document.elementFromPoint(s.x, s.y) || {}).className || '?';
          fire('pointerdown', s.x, s.y); await sleep(50); fire('pointerup', s.x, s.y);
          const tapped = game.selected ? game.selected.id : null;
          await sleep(450); // not a double tap
          const dest = proj(u.x + 150, u.z + 20);
          fire('pointerdown', s.x, s.y);
          for (let i = 1; i <= 8; i++) { fire('pointermove', s.x + (dest.x - s.x) * (i / 8), s.y + (dest.y - s.y) * (i / 8)); await sleep(16); }
          const preview = !!window.__game.arrows.preview;
          fire('pointerup', dest.x, dest.y);
          const want = rts.pick(dest.x, dest.y, cv);
          const end = u.order.dest;
          return { hit, tapped, preview, order: u.order.type, moving: u.follow.active, gap: end && want ? Math.hypot(end[0] - want.x, end[1] - want.z) : null };
        });
        check('touch-tap-select', touch.tapped === 'willcox', `a touch tap on Willcox's men (element "${touch.hit}") selected ${touch.tapped}`);
        check('touch-drag-order', touch.order === 'move' && touch.moving && touch.preview && touch.gap !== null && touch.gap < 20,
          `touch drag: preview shown=${touch.preview}, order=${touch.order}, moving=${touch.moving}, order end ${touch.gap === null ? 'missing' : `${touch.gap.toFixed(1)} m`} from the ground under the lifted finger (limit 20 m)`);
      }

      // 7. fight: march three brigades up the hill, fast-forward, look for casualties and smoke on both sides
      const fight = await page.evaluate(async () => {
        const g = window.__game.game;
        const by = (id) => g.units.find((u) => u.id === id);
        g.order(by('franklin'), { type: 'move', points: [[by('franklin').x, by('franklin').z], [80, 470], [230, 500]] });
        g.order(by('willcox'), { type: 'move', points: [[by('willcox').x, by('willcox').z], [60, 300], [220, 360]] });
        g.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [150, 120], [240, 260]] });
        g.fastForward(300);
        const cas = { US: 0, CS: 0 };
        for (const u of g.units) cas[u.side] += u.casualties;
        const fr = by('franklin');
        return { cas, puffs: window.__game.effects.puffs, smoke: window.__game.effects.ok, franklin: [Math.round(fr.x), Math.round(fr.z), fr.state], simTime: Math.round(g.simTime),
          states: g.units.map((u) => `${u.id}:${Math.round(u.men)}:${u.state}`).join(' ') };
      });
      await page.evaluate(async () => { const r = window.__game.rts; r.goal.x = 150; r.goal.z = 420; r.goal.dist = 520; });
      await page.waitForTimeout(3000);
      await shot(page, 'fight');
      check('fight', fight.cas.US > 0 && fight.cas.CS > 0 && (fight.puffs > 0 || !fight.smoke),
        `after ${fight.simTime} sim s: Union casualties ${Math.round(fight.cas.US)}, Confederate ${Math.round(fight.cas.CS)}, smoke puffs ${fight.puffs} (smoke ${fight.smoke ? 'on' : 'unavailable'}); ${fight.states}`);
      result.fight = fight;

      await orderObedience(page);
      await dockFit(page);
      await bakedFigures(page);
    }

    // 2. errors
    check('no-console-errors', consoleErrors.length === 0, consoleErrors.length === 0 ? '0 errors' : `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 5).join(' | ')}`);

    // 8. accessibility
    try {
      const axe = await new AxeBuilder({ page }).analyze();
      const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      result.axe = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), passes: axe.passes.length };
      check('axe', bad.length === 0, bad.length === 0 ? `0 serious/critical violations (${axe.violations.length} minor/moderate, ${axe.passes.length} rules passed)` : bad.map((v) => `${v.impact} ${v.id} on ${v.nodes.length} node(s): ${v.help}`).join(' | '));
    } catch (err) {
      check('axe', false, `axe-core could not run: ${err.message.split('\n')[0]}`);
    }
    result.stats = await page.evaluate(async () => window.__stats ?? null).catch(() => null);
    if (result.stats) console.log(`stats: ${JSON.stringify(result.stats)}`);
    await page.context().close().catch(() => {}); // one game page at a time
    if (process.argv.includes('--field')) { result.mode = 'field only (sandbox and device pages skipped)'; return; }
    await sandboxAndDevice(browser, url);
    await rewardProgress(browser, url);
    await practiceProgress({ browser, url, check, shot, result, watchErrors });
    await introPlay({ browser, url, check, shot, result, watchErrors, native, afterIdle: headerAfterAction, afterStores: headerStores });
    finishHeader({ check, result });
    await entryProgress({ browser, url, check, shot, result, watchErrors });
    await campEquipment({ browser, url, check, shot, result, watchErrors });
    await saveCoordination({ browser, url, check, shot, result, watchErrors });
    await deploymentProgress({ browser, url, check, shot, result, watchErrors, native });
    await soldierViewControls({ browser, url, check, shot, result, watchErrors, native });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--unit')) {
  try {
    await settingsUnit();
  } catch (err) {
    check('settings', false, `the settings module failed to load or threw: ${err.message}`);
  }
  await phaseModelUnit();
  try {
    await bakedUnit();
    await approvedPackUnit();
  } catch (err) {
    check('baked-maths', false, `src/units/impostor.js or the manifest failed to load or threw: ${err.message}`);
  }
  const ok = checks.every((c) => c.ok);
  console.log(ok ? 'UNIT OK' : `UNIT FAILED (${checks.filter((c) => !c.ok).length} check(s))`);
  process.exit(ok ? 0 : 1);
}

let exitCode = 1;
try {
  await main();
  exitCode = checks.length > 0 && checks.every((c) => c.ok) ? 0 : 1;
} catch (err) {
  check('harness', false, err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err));
}
result.ok = exitCode === 0;
result.durationMs = Date.now() - started;
try {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'last-result.json'), JSON.stringify(result, null, 2) + '\n');
} catch (err) {
  console.error(`FAIL write-result: ${err.message}`);
  exitCode = 1;
}
try {
  await prune();
} catch (err) {
  console.error(`FAIL prune: ${err.message}`);
  exitCode = 1;
}
console.log(exitCode === 0 ? `TEST OK (${result.durationMs} ms)` : `TEST FAILED (${checks.filter((c) => !c.ok).length} check(s))`);
process.exit(exitCode);

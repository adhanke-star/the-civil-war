import assert from 'node:assert/strict';
import { loaderFixture } from './atlas-loader-fixture.mjs';

const checks = [
  ['success', {}, async f => { const ts = await f.atlas.load('close'); assert.equal(ts.length, 10); assert.equal(ts.filter(t => t.isCompressedTexture).length, 8);
    assert.equal(f.atlas.layout.tiers.close.looks.length, 2); assert.equal(f.atlas.memoryBytes(), 8 * 112 + 6 * 340);
    for (const t of ts) { assert.equal(t.premultiplyAlpha, !t.isCompressedTexture); assert.equal(t.generateMipmaps, !t.isCompressedTexture); assert.equal(t.flipY, false); } },
    f => { f.atlas.memoryBytes = () => 0; }],
  ['unsupported', { unsupported: true }, async f => { await f.atlas.load('close'); assert.equal(f.events.filter(e => e.startsWith('fetch:')).length, 0); assert.equal(f.textures.length, 5);
    assert.equal(f.atlas.layout.tiers.close, f.before.close); }, f => { f.renderer.getContext().getExtension = () => ({ getSupportedProfiles: () => ['ldr'] }); }],
  ...['malformed', 'httpFailure', 'uploadFailure'].map(key => [key, { [key]: true }, async f => {
    await f.atlas.load('close'); assert.equal(f.atlas.layout.tiers.close, f.before.close); assert.equal(f.atlas.textures.close.length, 5);
    assert.ok(f.atlas.closeDiagnosticFailure); const first = f.events.findIndex(e => e.startsWith('png:baseline/'));
    assert.ok(first > f.events.lastIndexOf('dispose')); assert.ok(f.disposed.size >= (key === 'uploadFailure' ? 10 : 9));
  }, f => { if (key === 'uploadFailure') f.renderer.getContext().getError = () => 0; else { const fetch = f.io.fetch; f.io.fetch = url => fetch(url.replace('base-0.ktx2', 'base-1.ktx2')); } }]),
  ['delayed-cleanup', { httpFailure: true, delay: true }, async f => {
    const task = f.atlas.load('close'); for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.ok(f.events.includes('late-wait')); assert.equal(f.atlas.loaded('close'), false); assert.equal(f.pools[0].batches.close.length, 0);
    assert.ok(!f.events.some(e => e.startsWith('png:baseline/'))); f.releaseLate(); await task;
    assert.ok(f.events.indexOf('late-done') < f.events.lastIndexOf('dispose')); assert.ok(f.events.lastIndexOf('dispose') < f.events.findIndex(e => e.startsWith('png:baseline/')));
  }, f => { const load = f.io.loadPNG; f.io.loadPNG = url => load(url.replace('extra-4.png', 'base-4.png')); }],
  ['concurrent', {}, async f => { const a = f.atlas.load('close'), b = f.atlas.load('close'); assert.equal(a, b); await Promise.all([a, b]);
    assert.equal(f.textures.length, 10); assert.equal(f.pools[0].batches.close.length, 10); assert.equal(f.pools[0].group.children.length, 28);
  }, f => { const load = f.atlas.load; f.atlas.load = function(t) { this.state[t] = null; return load.call(this, t); }; }],
  ['field-identity', { uploadFailure: true }, async f => { await f.atlas.load('close'); assert.equal(f.atlas.layout, f.before.layout);
    assert.equal(f.atlas.layout.tiers.field, f.before.field); assert.equal(f.atlas.textures.field, f.before.fieldTextures);
    f.pools.forEach((p, i) => { assert.equal(p.layout, f.atlas.layout); assert.equal(p.batches.field, f.before.batches[i]); assert.equal(p.fallen, f.before.records[i]); assert.equal(p.batches.close.length, 5); });
  }, f => { const load = f.atlas.loadDiagnosticClose; f.atlas.loadDiagnosticClose = async function() { const r = await load.call(this); this.layout.tiers.field = { ...this.layout.tiers.field }; return r; }; }],
  ['prepare-failure', {}, async f => { const pool = f.pools[1], prepare = pool.prepareTier; let first = true;
    pool.prepareTier = function(...args) { if (first) { first = false; throw new Error('controlled pool allocation failure'); } return prepare.apply(this, args); };
    await f.atlas.load('close'); assert.equal(f.atlas.layout.tiers.close, f.before.close); assert.equal(f.disposed.size, 10);
    for (const p of f.pools) { assert.equal(p.batches.close.length, 5); assert.equal(p.group.children.length, 18); }
  }, f => { f.disposed.add = () => f.disposed; }],
  ['source-bind', {}, async f => { f.atlas.diagnosticClose.manifest.camera.elevation_deg++; await f.atlas.load('close');
    assert.equal(f.atlas.layout.tiers.close, f.before.close); assert.equal(f.events.filter(e => e.startsWith('fetch:')).length, 0); assert.ok(f.atlas.closeDiagnosticFailure);
  }, f => { f.atlas.diagnosticClose.manifest.camera = f.atlas.layout.manifest.camera;
    f.atlas.diagnosticClose.sourceManifest.camera = f.atlas.layout.manifest.camera; }],
  ['variant-bind', {}, async f => { f.atlas.diagnosticClose.manifest.tiers.close.variants.extra.frames.stand_0_d00.ax++;
    await f.atlas.load('close'); assert.equal(f.atlas.layout.tiers.close, f.before.close); assert.ok(f.atlas.closeDiagnosticFailure.includes('source'));
    assert.equal(f.events.filter(e => e.startsWith('fetch:')).length, 0);
  }, f => { f.atlas.diagnosticClose.sourceManifest.tiers.close.variants.extra.frames = f.atlas.diagnosticClose.manifest.tiers.close.variants.extra.frames; }],
  ['mount-failure', {}, async f => {
    let fail = true; f.pools[1].group.addEventListener('childadded', () => { if (fail) { fail = false; throw new Error('controlled native mount failure'); } });
    let removed = true; f.pools[1].group.addEventListener('childremoved', () => { if (removed) { removed = false; throw new Error('controlled remove observer failure'); } });
    await f.atlas.load('close'); assert.equal(f.atlas.layout.tiers.close, f.before.close); assert.equal(f.disposed.size, 10);
    for (const p of f.pools) { assert.equal(p.batches.close.length, 5); assert.equal(p.group.children.length, 18); }
  }, f => { f.disposed.add = () => f.disposed; }],
  ['reentrant-pool', {}, async f => { let once = true;
    f.pools[0].group.addEventListener('childadded', () => { if (once) { once = false; f.addPool(); } });
    await f.atlas.load('close'); assert.equal(f.pools.length, 3);
    for (const p of f.pools) { assert.equal(p.layout, f.atlas.layout); assert.equal(p.batches.close.length, 10); assert.equal(p.group.children.length, 28); }
  }, f => { const add = f.addPool; f.addPool = () => { const pool = add(); pool.mountTier = () => {}; return pool; }; }],
  ['dispose-pending', { delay: true }, async f => {
    const task = f.atlas.load('close'); for (let i = 0; i < 20; i++) await Promise.resolve();
    f.atlas.dispose(); f.releaseLate(); await assert.rejects(task, /disposed/);
    assert.equal(f.atlas.loaded('close'), false); assert.equal(f.disposed.size, 10);
    assert.ok(!f.events.some(e => e.startsWith('png:baseline/'))); for (const p of f.pools) assert.equal(p.group.children.length, 0);
  }, f => { f.atlas.dispose = () => {}; }],
  ['png-ownership', {}, async f => { const load = f.atlas.io.loadPNG;
    f.atlas.io.loadPNG = async url => { const t = await load(url); if (url.startsWith('candidate/')) t.image = null; return t; };
    await f.atlas.load('close'); assert.equal(f.disposed.size, 10); assert.equal(f.atlas.layout.tiers.close, f.before.close);
  }, f => { f.disposed.add = () => f.disposed; }],
  ...['field', 'close'].map(tier => [`ordinary-${tier}-dispose`, {}, async f => {
    f.atlas.diagnosticClose = null; delete f.atlas.state[tier]; delete f.atlas.textures[tier];
    const load = f.atlas.io.loadPNG; let release;
    const held = new Promise(resolve => { release = resolve; });
    f.atlas.io.loadPNG = async url => { await held; return load(url); };
    const task = f.atlas.load(tier); f.atlas.dispose(); release(); await assert.rejects(task, /disposed/);
    assert.equal(f.atlas.loaded(tier), false); assert.equal(f.disposed.size, tier === 'field' ? 4 : 5);
    assert.ok(f.pools.every(p => p.group.children.length === 0));
  }, f => { f.atlas.dispose = () => {}; }]),
  ['ordinary-sync-failure', {}, async f => {
    f.atlas.diagnosticClose = null; const load = f.atlas.io.loadPNG;
    f.atlas.io.loadPNG = url => { if (url.endsWith('close-1.png')) throw new Error('controlled synchronous provider failure'); return load(url); };
    const task = f.atlas.load('close'); assert.equal(task, f.atlas.state.close);
    await assert.rejects(task, /synchronous provider/); assert.equal(f.disposed.size, 4); assert.equal(f.atlas.loaded('close'), false);
  }, f => { f.disposed.add = () => f.disposed; }],
];
for (const [name, options, check] of checks) { const f = loaderFixture(options); try { await check(f); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } finally { f.cleanup(); } }
console.log(`ATLAS-LOADER OK (${checks.length}/${checks.length})`);
if (process.argv.includes('--prove-fail')) {
  for (const [name, options, check, mutate] of checks) { const f = loaderFixture(options, mutate); let error;
    try { await check(f); } catch (e) { error = e; } finally { f.releaseLate(); await f.atlas.state.close?.catch(() => {}); f.cleanup(); }
    assert.equal(error?.code, 'ERR_ASSERTION', `${name}: own implementation fault must reject its assertion`); console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
  }
  console.log(`ATLAS-LOADER CONTROLS OK (${checks.length}/${checks.length})`);
}

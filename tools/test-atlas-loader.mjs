import assert from 'node:assert/strict';
import { loaderFixture } from './atlas-loader-fixture.mjs';

const checks = [
  ['completion-before-fallback', {httpFailure:true}, async f=>{
    const records=[];f.io.observeClose=e=>records.push(e);f.atlas.diagnosticClose.completionBeforeFallback=true;
    await f.atlas.load('close');const finish=f.events.indexOf('finish'),baseline=f.events.findIndex(e=>e.startsWith('png:baseline/'));
    assert.equal(f.events.filter(e=>e==='finish').length,1,'completion-before-fallback: exactly one native completion');
    assert.ok(finish>f.events.lastIndexOf('dispose')&&finish<baseline,'completion-before-fallback: all disposals precede completion before fallback IO');
    const start=records.findIndex(e=>e.operation==='completion-start'),done=records.findIndex(e=>e.operation==='completion-result');
    assert.ok(records.filter(e=>e.operation==='dispose-result').every(e=>records.indexOf(e)<start),'completion-before-fallback: observed disposal order');
    assert.ok(start<done&&done<records.findIndex(e=>e.attempt==='baseline'),'completion-before-fallback: explicit observed boundary');
    assert.ok(records[done].ok&&records[done].method==='finish'&&Number.isFinite(records[done].elapsedMs)&&records[done].elapsedMs>=0,'completion-before-fallback: native method and bounded duration receipt');
  },f=>{f.renderer.getContext().finish=()=>{};}],
  ['completion-delayed', {httpFailure:true,delay:true},async f=>{
    f.atlas.diagnosticClose.completionBeforeFallback=true;const task=f.atlas.load('close');for(let i=0;i<20;i++)await Promise.resolve();
    assert.ok(!f.events.includes('finish'),'completion-delayed: no completion before the late sibling settles');
    f.releaseLate();await task;assert.ok(f.events.indexOf('finish')>f.events.indexOf('late-done'),'completion-delayed: late upload precedes completion');
  },f=>{f.renderer.getContext().finish=()=>f.events.unshift('finish');}],
  ...['finishFailure','finishGlFailure'].map(key=>['completion-'+key,{httpFailure:true,[key]:true},async f=>{
    const records=[];f.io.observeClose=e=>records.push(e);f.atlas.diagnosticClose.completionBeforeFallback=true;let failure;try{await f.atlas.load('close');}catch(e){failure=e;}
    assert.equal(failure?.closeCompletionFailure,true,'completion-'+key+': original completion failure refuses fallback');
    assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')),'completion-'+key+': no baseline request');assert.equal(f.disposed.size,9,'completion-'+key+': all failed candidate siblings disposed');
    assert.ok(records.some(e=>e.operation==='completion-result'&&e.ok===false),'completion-'+key+': failed result retained');
  },f=>{f.renderer.getContext().finish=()=>f.events.push('finish');}]),
  ['completion-default', {httpFailure:true},async f=>{await f.atlas.load('close');assert.ok(!f.events.includes('finish'),'completion-default: historical overlap remains default');},f=>{f.atlas.diagnosticClose.completionBeforeFallback=true;}],
  ['completion-context-loss', {httpFailure:true},async f=>{
    f.atlas.diagnosticClose.completionBeforeFallback=true;const gl=f.renderer.getContext();gl.isContextLost=()=>f.disposed.size>0;
    let failure;try{await f.atlas.load('close');}catch(e){failure=e;}assert.equal(failure?.closeCompletionFailure,true,'completion-context-loss: lost native context refuses');assert.equal(failure?.candidateFailure,'baked close: HTTP 404','completion-context-loss: original candidate failure retained');assert.ok(!f.events.includes('finish')&&!f.events.some(e=>e.startsWith('png:baseline/')),'completion-context-loss: no native completion or fallback');
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){this.diagnosticClose.completionBeforeFallback=false;return load.call(this);};}],
  ['completion-context-read', {httpFailure:true},async f=>{
    f.atlas.diagnosticClose.completionBeforeFallback=true;const get=f.renderer.getContext;let once=true;f.renderer.getContext=()=>{if(once&&f.disposed.size===9){once=false;throw Error('controlled context read');}return get();};
    let failure;try{await f.atlas.load('close');}catch(e){failure=e;}assert.equal(failure?.closeCompletionFailure,true,'completion-context-read: context setup failure refuses fallback');assert.equal(failure?.candidateFailure,'baked close: HTTP 404','completion-context-read: candidate failure retained');assert.ok(!f.events.includes('finish')&&!f.events.some(e=>e.startsWith('png:baseline/')),'completion-context-read: no completion or baseline request');
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){this.diagnosticClose.completionBeforeFallback=false;return load.call(this);};}],
  ...['completion-start','completion-result'].map(operation=>['completion-observer-'+operation,{httpFailure:true},async f=>{
    f.atlas.diagnosticClose.completionBeforeFallback=true;f.io.observeClose=e=>{if(e.operation===operation)throw Error('controlled completion observer failure');};
    let failure;try{await f.atlas.load('close');}catch(e){failure=e;}assert.equal(failure?.closeObservationFailure,true,'completion-observer-'+operation+': observation failure refuses fallback');assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')),'completion-observer-'+operation+': no baseline request');
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){const io=f.io;delete io.observeClose;return load.call(this);};}]),
  ['completion-unsupported', {unsupported:true},async f=>{f.atlas.diagnosticClose.completionBeforeFallback=true;await f.atlas.load('close');assert.ok(!f.events.includes('finish'),'completion-unsupported: zero candidate IO, no added finish');},f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=async function(){const out=await load.call(this);f.events.push('finish');return out;};}],
  ['completion-success', {},async f=>{f.atlas.diagnosticClose.completionBeforeFallback=true;await f.atlas.load('close');assert.ok(!f.events.includes('finish'),'completion-success: successful candidate needs no fallback boundary');},f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=async function(){const out=await load.call(this);f.events.push('finish');return out;};}],
  ['completion-disposal-failure', {httpFailure:true},async f=>{
    f.atlas.diagnosticClose.completionBeforeFallback=true;const load=f.io.loadPNG;f.io.loadPNG=async url=>{const t=await load(url);if(url.startsWith('candidate/'))t.addEventListener('dispose',()=>{throw Error('controlled disposal failure');});return t;};
    let failure;try{await f.atlas.load('close');}catch(e){failure=e;}assert.equal(failure?.closeCompletionFailure,true,'completion-disposal-failure: incomplete disposal refuses fallback');assert.ok(!f.events.includes('finish')&&!f.events.some(e=>e.startsWith('png:baseline/')),'completion-disposal-failure: no completion or fallback');
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){this.diagnosticClose.completionBeforeFallback=false;return load.call(this);};}],
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
  ['observe-success', {}, async f => {
    const records=[];f.io.observeClose=e=>records.push(e);await f.atlas.load('close');
    for(const op of ['created','uploaded','settled'])assert.equal(records.filter(e=>e.operation===op).length,10);
    assert.equal(records.filter(e=>e.operation==='all-settled').length,1);assert.equal(records.at(-1).operation,'publish-start');
    assert(records.every(e=>Object.isFrozen(e)&&e.attempt==='candidate'&&Object.values(e).every(v=>v===null||['string','number','boolean'].includes(typeof v))));
    for(const e of records.filter(e=>e.operation==='settled')){const created=records.find(r=>r.operation==='created'&&r.index===e.index),uploaded=records.find(r=>r.operation==='uploaded'&&r.index===e.index);
      assert.equal(e.outcome,'fulfilled');assert.equal(e.textureUUID,created.textureUUID);assert(records.indexOf(created)<records.indexOf(uploaded)&&records.indexOf(uploaded)<records.indexOf(e));}
  }, f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){delete f.io.observeClose;return load.call(this);};}],
  ...['malformed','httpFailure'].map(key=>['observe-'+key,{[key]:true},async f=>{
    const records=[];f.io.observeClose=e=>records.push(e);await f.atlas.load('close');const candidate=records.filter(e=>e.attempt==='candidate');
    assert.equal(candidate.filter(e=>e.operation==='created').length,9);assert.equal(candidate.filter(e=>e.operation==='uploaded').length,9);
    assert.equal(candidate.filter(e=>e.operation==='settled'&&e.outcome==='rejected').length,1);
    const barrier=records.findIndex(e=>e.operation==='all-settled'&&e.attempt==='candidate'),firstBaseline=records.findIndex(e=>e.attempt==='baseline');
    assert.equal(candidate.filter(e=>e.operation==='dispose-result'&&e.ok).length,9);
    assert(candidate.filter(e=>e.operation==='settled').every(e=>records.indexOf(e)<barrier));
    assert(candidate.filter(e=>e.operation==='dispose-result').every(e=>records.indexOf(e)>barrier&&records.indexOf(e)<firstBaseline));
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){const observer=f.io.observeClose;f.io.observeClose=e=>{if(e.operation!=='dispose-result')return observer(e);};return load.call(this);};}]),
  ['observe-delayed', {httpFailure:true,delay:true},async f=>{
    const records=[];f.io.observeClose=e=>records.push(e);const task=f.atlas.load('close');for(let i=0;i<20;i++)await Promise.resolve();
    assert(records.some(e=>e.operation==='settled'&&e.outcome==='rejected'));assert(!records.some(e=>e.operation==='all-settled'||e.attempt==='baseline'||e.operation==='dispose-start'));
    f.releaseLate();await task;const late=records.findIndex(e=>e.operation==='settled'&&e.page==='extra-4.png'),barrier=records.findIndex(e=>e.operation==='all-settled');assert(late>=0&&late<barrier);
  },f=>{const load=f.io.loadPNG;f.io.loadPNG=url=>load(url.replace('extra-4.png','base-4.png'));}],
  ...['created','publish-start','dispose-result'].map(operation=>['observe-fatal-'+operation,operation==='dispose-result'?{httpFailure:true}:{},async f=>{
    const records=[];f.io.observeClose=e=>{records.push(e);if(e.operation===operation)throw Error('controlled observation failure');};
    const task=f.atlas.load('close');let failure;try{await task;}catch(e){failure=e;}
    assert.equal(failure?.closeObservationFailure,true);assert(failure.observationErrors.every(e=>e==='controlled observation failure'));
    assert.equal(f.atlas.state.close,task);assert.equal(f.atlas.loaded('close'),false);assert(!records.some(e=>e.attempt==='baseline'));
    assert.equal(records.filter(e=>e.operation==='settled').length,10);assert.equal(records.filter(e=>e.operation==='dispose-result').length,operation==='dispose-result'?9:10);
    assert.equal(f.disposed.size,operation==='dispose-result'?9:10);assert.equal(f.atlas.closeDiagnosticFailure,undefined);
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){delete f.io.observeClose;return load.call(this);};}]),
  ['observe-async', {},async f=>{
    f.io.observeClose=()=>Promise.reject(Error('controlled asynchronous observation'));let failure;try{await f.atlas.load('close');}catch(e){failure=e;}
    assert.equal(failure?.closeObservationFailure,true);assert(failure.observationErrors.every(e=>e==='synchronous observer required'));assert.equal(f.disposed.size,10);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){f.io.observeClose=()=>{};return load.call(this);};}],
  ['observe-png-owned-rejection', {},async f=>{
    const records=[],load=f.io.loadPNG;f.io.observeClose=e=>records.push(e);f.io.loadPNG=async url=>{const t=await load(url);if(url.startsWith('candidate/'))t.image=null;return t;};
    await f.atlas.load('close');const rejected=records.filter(e=>e.attempt==='candidate'&&e.operation==='settled'&&e.outcome==='rejected');assert.equal(rejected.length,2);
    for(const e of rejected){const created=records.find(c=>c.operation==='created'&&c.attempt==='candidate'&&c.page===e.page),disposed=records.find(d=>d.operation==='dispose-result'&&d.attempt==='candidate'&&d.page===e.page);
      assert.equal(typeof e.textureUUID,'string');assert.equal(e.textureUUID,created.textureUUID);assert.equal(e.textureUUID,disposed.textureUUID);assert.equal(disposed.ok,true);}
  },f=>{const load=f.atlas.loadDiagnosticClose;f.atlas.loadDiagnosticClose=function(){const observe=f.io.observeClose;f.io.observeClose=e=>observe(e.operation==='settled'&&e.outcome==='rejected'?{...e,textureUUID:null}:e);return load.call(this);};}],
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

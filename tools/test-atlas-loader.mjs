import assert from 'node:assert/strict';
import { loaderFixture } from './atlas-loader-fixture.mjs';
import {BakedAtlas,loadBakedAtlas} from '../src/units/impostor.js';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const serialTurn=async()=>{for(let i=0;i<96;i++)await Promise.resolve();};
async function serialFailure(task){let rejected=false,error;try{await task;}catch(value){rejected=true;error=value;}assert(rejected,'serial promise must reject');return error;}
async function serialOrder(f){
  const fetch=f.io.fetch,png=f.io.loadPNG,upload=f.renderer.initTexture,starts=[],backs=new Map(),indices=new Map();let complete=0,a,reentered;
  const start=url=>{assert.equal(starts.length,complete,'next provider waits for preceding native upload return');starts.push(url);};
  f.io.fetch=async function(url){assert.equal(this,undefined,'fetch keeps original unbound receiver');start(url);reentered=f.atlas.load('close');
    const response=await fetch(url);return{...response,arrayBuffer:async()=>{const b=await response.arrayBuffer();backs.set(url,b);return b;}};};
  f.io.loadPNG=async function(url){assert.equal(this,f.io,'PNG keeps original receiver');start(url);return png.call(this,url);};
  f.io.observeClose=e=>{if(e.operation==='created')indices.set(e.textureUUID,e.index);if(e.operation==='settled'&&e.outcome==='fulfilled')complete++;
    if(['created','uploaded'].includes(e.operation)){assert.equal(f.atlas.loaded('close'),false);assert.equal(f.atlas.textures.field,f.before.fieldTextures);}};
  f.renderer.initTexture=function(t){assert.equal(starts.length,indices.get(t.uuid)+1);const out=upload.call(this,t);assert.equal(complete,starts.length-1);return out;};
  a=f.atlas.load('close');assert.equal(a,f.atlas.load('close'));f.atlas.serialClose=false;const ts=await a;assert.equal(reentered,a);
  const expected=['base','extra'].flatMap(look=>Array.from({length:5},(_,i)=>`candidate/${look}-${i}.${i===4?'png':'ktx2'}`));
  assert.deepEqual(starts,expected);assert.equal(complete,10);assert.equal(ts.length,10);assert.equal(ts.filter(t=>t.isCompressedTexture).length,8);
  for(const [i,t]of ts.entries())if(t.isCompressedTexture){assert.equal(t.mipmaps.length,4,'serial scheduling never clears payloads');assert(t.mipmaps.every(m=>m.data.buffer===backs.get(expected[i])),'every mip retains its whole input backing');}
  assert.equal(new Set([...backs.values()]).size,8);assert.equal(f.events.filter(e=>e==='finish').length,0);
  assert(f.pools.every(p=>p.batches.close.length===10));
}
async function serialContext(f){
  const fetch=f.io.fetch,initial=f.renderer.getContext();let context=initial,release,starts=0;const held=new Promise(r=>{release=r;});
  f.renderer.getContext=()=>context;f.io.fetch=async url=>{starts++;await held;return fetch(url);};
  const oldRelease=f.releaseLate;f.releaseLate=()=>{oldRelease();release();};
  const task=f.atlas.load('close');await serialTurn();assert.equal(starts,1);context={...initial};release();
  await serialFailure(task);assert.equal(starts,1,'context identity drift must stop scheduling');assert.equal(f.atlas.loaded('close'),false);
  assert(!f.events.some(e=>e.startsWith('png:baseline/')));
}
async function serialRawFailure(f){
  f.io.loadPNG=async()=>{throw 0;};const error=await serialFailure(f.atlas.load('close'));assert.equal(error,0,'first raw falsy failure is preserved');
}
async function serialBorrowed(f){
  const png=f.io.loadPNG;f.io.loadPNG=async url=>url==='candidate/base-4.png'?f.before.fieldTextures[0]:png.call(f.io,url);
  await serialFailure(f.atlas.load('close'));assert.equal(f.disposed.size,4);assert.equal(f.atlas.textures.field,f.before.fieldTextures);
  assert(!f.events.some(e=>e.startsWith('png:baseline/')));assert.equal(f.atlas.loaded('close'),false);
}

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
const serialChecks=[
  ['serial-order',{},serialOrder],
  ['serial-context',{},serialContext],
  ['serial-falsy-baseline',{unsupported:true},serialRawFailure],
  ['serial-borrowed',{},serialBorrowed],
  ['serial-boolean',{},async f=>{
    for(const serialClose of [null,0,1,'true',{},()=>true])assert.throws(()=>new BakedAtlas(f.atlas.layout.manifest,'baseline/',{serialClose,diagnosticClose:f.atlas.diagnosticClose,renderer:f.renderer,io:f.io}),/boolean/);
    assert.throws(()=>new BakedAtlas(f.atlas.layout.manifest,'baseline/',{serialClose:true}),/configured/);
    await assert.rejects(loadBakedAtlas('unused/',{serialClose:true}),/configured/);assert.equal(f.events.length,0);
  }],
  ...['fetch','body','png'].map(phase=>['serial-deferred-'+phase,{},async f=>{
    const fetch=f.io.fetch,png=f.io.loadPNG,starts=[];let release;const held=new Promise(r=>{release=r;});
    const oldRelease=f.releaseLate;f.releaseLate=()=>{oldRelease();release();};
    f.io.fetch=async url=>{starts.push(url);if(phase==='fetch'&&starts.length===1)await held;const response=await fetch(url);
      return{...response,arrayBuffer:async()=>{if(phase==='body'&&starts.length===1)await held;return response.arrayBuffer();}};};
    f.io.loadPNG=async url=>{starts.push(url);if(phase==='png'&&starts.length===5)await held;return png.call(f.io,url);};
    const task=f.atlas.load('close');await serialTurn();assert.equal(starts.length,phase==='png'?5:1);assert.equal(f.atlas.loaded('close'),false);
    assert(f.pools.every(p=>!p.batches.close.length));release();assert.equal((await task).length,10);
  }]),
  ...Array.from({length:10},(_,index)=>['serial-failure-'+index,{},async f=>{
    const fetch=f.io.fetch,png=f.io.loadPNG,requests=[];let candidate=0;
    f.atlas.diagnosticClose.completionBeforeFallback=true;
    const begin=url=>{requests.push(url);if(url.startsWith('candidate/')&&candidate++===index)throw Error('serial-page-'+index);
      if(url.startsWith('baseline/'))assert.equal(f.events.filter(e=>e==='finish').length,index?1:0);};
    f.io.fetch=async url=>{begin(url);return fetch(url);};f.io.loadPNG=async url=>{begin(url);return png.call(f.io,url);};
    const ts=await f.atlas.load('close');assert.equal(ts.length,5);assert.equal(candidate,index+1);
    assert.equal(requests.filter(u=>u.startsWith('candidate/')).length,index+1);assert.equal(requests.filter(u=>u.startsWith('baseline/')).length,5);
    assert.equal(f.disposed.size,index);assert.equal(f.atlas.textures.field,f.before.fieldTextures);assert.equal(f.atlas.layout.tiers.close,f.before.close);
    if(index){const done=f.events.indexOf('finish');assert(done>f.events.lastIndexOf('dispose'));assert(done<f.events.findIndex(e=>e.startsWith('png:baseline/')));}
  }]),
  ...['undefined','null','zero','false','empty','symbol','hostile'].flatMap(kind=>['candidate','baseline'].map(attempt=>['serial-thrown-'+attempt+'-'+kind,{unsupported:attempt==='baseline'},async f=>{
    let getterCalls=0;const hostile=Object.create(null);Object.defineProperty(hostile,'message',{get(){getterCalls++;throw Error('foreign message');}});
    Object.defineProperty(hostile,Symbol.toPrimitive,{value(){getterCalls++;throw Error('foreign coercion');}});
    const value={undefined:undefined,null:null,zero:0,false:false,empty:'',symbol:Symbol('raw'),hostile}[kind],fetch=f.io.fetch;
    if(attempt==='candidate'){f.io.fetch=async url=>{if(url==='candidate/base-0.ktx2')throw value;return fetch(url);};assert.equal((await f.atlas.load('close')).length,5);assert.equal(typeof f.atlas.closeDiagnosticFailure,'string');}
    else{f.io.loadPNG=async()=>{throw value;};assert.equal(await serialFailure(f.atlas.load('close')),value);}
    assert.equal(getterCalls,0);
  }])),
  ['serial-upload-cleanup-falsy',{},async f=>{
    const upload=f.renderer.initTexture,cleanup=Error('later cleanup');f.renderer.initTexture=function(t){upload.call(this,t);t.addEventListener('dispose',()=>{throw cleanup;});throw 0;};
    assert.equal(await serialFailure(f.atlas.load('close')),0);assert.equal(f.disposed.size,1);assert.equal(f.atlas.cleanupFailure.error,cleanup);
    assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ...['undefined','null','zero','false','empty'].map(kind=>['serial-all-owned-cleanup-'+kind,{},async f=>{
    const value={undefined:undefined,null:null,zero:0,false:false,empty:''}[kind],primary={primary:true},fetch=f.io.fetch,upload=f.renderer.initTexture;let first=true;
    f.io.fetch=async url=>{if(url==='candidate/extra-0.ktx2')throw primary;return fetch(url);};
    f.renderer.initTexture=function(t){upload.call(this,t);if(first){first=false;t.addEventListener('dispose',()=>{throw value;});}};
    assert.equal(await serialFailure(f.atlas.load('close')),primary);assert.equal(f.disposed.size,5,'all five owned cleanup operations attempted');
    assert.equal(f.atlas.cleanupFailure.failed,true);assert.equal(f.atlas.cleanupFailure.error,value);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }]),
  ['serial-dispose-observer',{},async f=>{
    const primary=Error('original provider'),fetch=f.io.fetch;f.io.fetch=async url=>{if(url==='candidate/base-1.ktx2')throw primary;return fetch(url);};
    f.io.observeClose=e=>{if(e.operation==='dispose-result')throw 0;};assert.equal(await serialFailure(f.atlas.load('close')),primary);
    assert.equal(f.disposed.size,1);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ['serial-baseline-order',{unsupported:true},async f=>{
    const png=f.io.loadPNG,upload=f.renderer.initTexture;let started=0,uploaded=0;
    f.io.loadPNG=async function(url){assert.equal(this,f.io);assert.equal(started,uploaded);assert(url.startsWith('baseline/'));started++;return png.call(this,url);};
    f.renderer.initTexture=function(t){const out=upload.call(this,t);uploaded++;return out;};
    const ts=await f.atlas.load('close');assert.equal(started,5);assert.equal(uploaded,5);assert.equal(ts.length,5);
    assert(ts.every(t=>t.generateMipmaps&&t.image?.width===8&&t.image?.height===8));
  }],
  ['serial-explicit-false',{serialClose:false,httpFailure:true,delay:true},async f=>{
    const task=f.atlas.load('close');await serialTurn();assert(f.events.includes('late-wait'));
    assert.equal(f.events.filter(e=>e.startsWith('fetch:candidate/')||e.startsWith('png:candidate/')).length,10);
    assert.equal(f.atlas.loaded('close'),false);assert.equal(f.disposed.size,0);f.releaseLate();assert.equal((await task).length,5);assert.equal(f.disposed.size,9);
  }],
  ['serial-pending-close',{},async f=>{
    const png=f.io.loadPNG;let release;const held=new Promise(r=>{release=r;}),oldRelease=f.releaseLate;f.releaseLate=()=>{oldRelease();release();};
    f.io.loadPNG=async url=>{const t=await png.call(f.io,url);if(url==='candidate/base-4.png')await held;return t;};
    const task=f.atlas.load('close');await serialTurn();assert.equal(f.textures.length,5);let closed=false;const closing=f.atlas.close().then(()=>{closed=true;});
    await serialTurn();assert.equal(closed,false);release();await serialFailure(task);await closing;assert.equal(f.disposed.size,5);assert.equal(f.atlas.loadsSettled,true);assert.equal(f.atlas.loaded('close'),false);
    assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ...['created','uploaded','publish-start'].map(operation=>['serial-observer-'+operation,{},async f=>{
    const records=[];f.io.observeClose=e=>{records.push(e);if(e.operation===operation)throw 0;};assert.equal(await serialFailure(f.atlas.load('close')),0);
    assert.equal(f.disposed.size,operation==='created'?0:operation==='publish-start'?10:1);
    assert.equal(records.filter(e=>e.operation==='dispose-result'&&e.ok).length,operation==='publish-start'?10:1);
    assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }]),
  ...['dispose','context','replacement'].map(which=>['serial-upload-stop-'+which,{},async f=>{
    const upload=f.renderer.initTexture,gl=f.renderer.getContext();let uploads=0;
    f.renderer.initTexture=function(t){upload.call(this,t);uploads++;if(which==='dispose')f.atlas.dispose();else if(which==='context')gl.isContextLost=()=>true;else f.renderer.getContext=()=>({...gl});};
    await serialFailure(f.atlas.load('close'));assert.equal(uploads,1);assert.equal(f.disposed.size,1);assert.equal(f.atlas.loaded('close'),false);
    assert.equal(f.events.filter(e=>e.startsWith('fetch:candidate/')).length,1);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }]),
  ['serial-pending-context-loss',{},async f=>{
    const png=f.io.loadPNG,gl=f.renderer.getContext();let release;const held=new Promise(r=>{release=r;}),oldRelease=f.releaseLate;f.releaseLate=()=>{oldRelease();release();};
    f.io.loadPNG=async url=>{const t=await png.call(f.io,url);if(url==='candidate/base-4.png')await held;return t;};
    const task=f.atlas.load('close');await serialTurn();assert.equal(f.textures.length,5);gl.isContextLost=()=>true;release();
    await serialFailure(task);assert.equal(f.disposed.size,5);assert.equal(f.atlas.loaded('close'),false);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ['serial-async-upload',{},async f=>{
    const upload=f.renderer.initTexture;f.renderer.initTexture=function(t){upload.call(this,t);return Promise.resolve();};
    await assert.rejects(f.atlas.load('close'),/synchronous native upload/);assert.equal(f.disposed.size,1);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ['serial-async-observer',{},async f=>{
    const records=[];f.io.observeClose=e=>{records.push(e);return Promise.reject(Error('controlled observer promise'));};await assert.rejects(f.atlas.load('close'),/synchronous primitive observation/);
    assert.equal(f.disposed.size,0);assert.equal(records.filter(e=>e.operation==='dispose-result'&&e.ok).length,1);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ...['textures','batches','provider'].map(which=>['serial-owned-drift-'+which,{},async f=>{
    const fetch=f.io.fetch,field=f.atlas.textures.field[0],batch=f.pools[0].batches.field[0];let once=true;
    f.io.fetch=async url=>{if(once){once=false;if(which==='textures')f.atlas.textures.field[0]={};if(which==='batches')f.pools[0].batches.field[0]={};if(which==='provider')f.io.fetch=()=>{throw Error('foreign provider must not run');};}return fetch(url);};
    try{await serialFailure(f.atlas.load('close'));assert.equal(f.textures.length,0);assert(!f.events.some(e=>e.startsWith('png:baseline/')));}
    finally{f.atlas.textures.field[0]=field;f.pools[0].batches.field[0]=batch;}
  }]),
  ...['uuid','dispose'].map(which=>['serial-texture-drift-'+which,{},async f=>{
    const upload=f.renderer.initTexture;let getterCalls=0;
    f.renderer.initTexture=function(t){upload.call(this,t);if(which==='uuid')Object.defineProperty(t,'uuid',{configurable:true,get(){getterCalls++;throw 0;}});else t.dispose=()=>{};throw 0;};
    assert.equal(await serialFailure(f.atlas.load('close')),0);assert.equal(getterCalls,0);assert.equal(f.disposed.size,1);
    assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }]),
  ['serial-dispatch-drift',{},async f=>{
    const upload=f.renderer.initTexture,fetch=f.io.fetch,records=[];let first,listenerCalls=0;
    f.io.observeClose=e=>records.push(e.operation==='dispose-result'?e:null);
    f.renderer.initTexture=function(t){upload.call(this,t);if(!first){first=t;t.addEventListener('dispose',()=>{listenerCalls++;});}};
    f.io.fetch=async url=>{if(url==='candidate/extra-0.ktx2'){first.dispatchEvent=()=>{};throw 0;}return fetch(url);};
    assert.equal(await serialFailure(f.atlas.load('close')),0);assert.equal(listenerCalls,0,'foreign dispatch suppresses original native-owner witness');
    assert.equal(f.disposed.size,4,'later owned resources still attempted');assert.equal(f.atlas.cleanupFailure.failed,true);
    assert.match(f.atlas.cleanupFailure.error.message,/texture ownership changed/);
    const results=records.filter(Boolean);assert.equal(results.length,5);assert.equal(results[0].ok,false);assert(results.slice(1).every(e=>e.ok));
    assert(!f.events.some(e=>e.startsWith('png:baseline/')));
    await assert.rejects(f.atlas.close(),/texture ownership changed/);
  }],
  ['serial-duplicate',{},async f=>{
    const png=f.io.loadPNG;let first;f.io.loadPNG=async url=>{if(url==='candidate/extra-4.png')return first;const t=await png.call(f.io,url);if(url==='candidate/base-4.png')first=t;return t;};
    await serialFailure(f.atlas.load('close'));assert.equal(f.disposed.size,9);assert(!f.events.some(e=>e.startsWith('png:baseline/')));
  }],
  ...['prepare','mount','late'].map(mode=>['serial-publication-'+mode,{},async f=>{
    let once=true;if(mode==='prepare'){const p=f.pools[1],prepare=p.prepareTier;p.prepareTier=function(...args){if(once){once=false;throw Error('controlled prepare');}return prepare.apply(this,args);};}
    else f.pools[0].group.addEventListener('childadded',()=>{if(once){once=false;if(mode==='late')f.addPool();else throw Error('controlled mount');}});
    const ts=await f.atlas.load('close');assert.equal(ts.length,mode==='late'?10:5);assert.equal(f.pools.length,mode==='late'?3:2);
    assert(f.pools.every(p=>p.batches.close.length===ts.length));assert.equal(f.atlas.textures.field,f.before.fieldTextures);
    assert.equal(f.disposed.size,mode==='late'?0:10);
  }]),
];
const source=fs.readFileSync(new URL('../src/units/impostor.js',import.meta.url),'utf8'),legacyBody=source.slice(source.indexOf('  async #loadClose('),source.indexOf('  // Scheduling only.')).replace('    if (this.#serialClose) return this.#loadSerialClose(configuration, renderer, runtime);\n','').trimEnd();
assert.equal(createHash('sha256').update(legacyBody).digest('hex'),'112e2de293f3636bfefe73fac0ca37d923146d32d18255e8dc5154beddbdd490','historical concurrent body is byte-exact');
for (const [name, options, check] of checks) { const f = loaderFixture(options); try { await check(f); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } finally { f.cleanup(); } }
console.log(`ATLAS-LOADER OK (${checks.length}/${checks.length})`);
for(const[name,options,check]of serialChecks){const f=loaderFixture({serialClose:true,...options});try{await check(f);}catch(e){console.error('SERIAL-LOADER FAILED',name);throw e;}finally{f.releaseLate();await f.atlas.state.close?.catch(()=>{});f.cleanup();}}
console.log(`SERIAL-LOADER CPU OK (${serialChecks.length}; default body exact; completed backings retained)`);
if (process.argv.includes('--prove-fail')) {
  for (const [name, options, check, mutate] of checks) { const f = loaderFixture(options, mutate); let error;
    try { await check(f); } catch (e) { error = e; } finally { f.releaseLate(); await f.atlas.state.close?.catch(() => {}); f.cleanup(); }
    assert.equal(error?.code, 'ERR_ASSERTION', `${name}: own implementation fault must reject its assertion`); console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
  }
  console.log(`ATLAS-LOADER CONTROLS OK (${checks.length}/${checks.length})`);
  const mutants=[
    ['scheduling','this.#serialClose = serialClose;','this.#serialClose = false;','serial-order'],
    ['context','getContext.call(renderer) !== context','false','serial-context'],
    ['raw-primary','throw primary;',"throw new Error('replaced primary');",'serial-falsy-baseline'],
    ['payload',"this.publishTier('close', T, result, healthy);\n        return result;","this.publishTier('close', T, result, healthy);\n        for(const t of result)if(t.isCompressedTexture)t.mipmaps=[];\n        return result;",'serial-order'],
    ['borrowed','!value || borrowed.has(value) || seen.has(value)','!value || seen.has(value)','serial-borrowed'],
    ['cleanup-receipt','catch (error) { failed = true; failure = error; }','catch (error) { fatal = true; }','serial-dispatch-drift'],
  ];
  for(const[name,from,to,caseName]of mutants){const[,options,check]=serialChecks.find(c=>c[0]===caseName);
    const script=`import fs from'node:fs';import assert from'node:assert/strict';import{loaderFixture}from'./tools/atlas-loader-fixture.mjs';
      const[from,to]=JSON.parse(process.argv[1]);let text=fs.readFileSync('src/units/impostor.js','utf8');assert.equal(text.split(from).length,2);text=text.replace(from,to);
      const base=new URL('./src/units/impostor.js','file://'+process.cwd()+'/');text=text.replace(/from '([^']+)'/g,(all,spec)=>'from '+JSON.stringify(spec.startsWith('.')?new URL(spec,base).href:import.meta.resolve(spec)));
      const{BakedAtlas}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
      const serialTurn=${serialTurn.toString()},serialFailure=${serialFailure.toString()},check=${check.toString()},f=loaderFixture(${JSON.stringify({serialClose:true,...options})},()=>{},BakedAtlas);
      try{await check(f);}finally{f.releaseLate();await f.atlas.state.close?.catch(()=>{});f.cleanup();}`;
    let failure;try{execFileSync('node',['--input-type=module','-e',script,JSON.stringify([from,to])],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:1000000,timeout:10000,stdio:['ignore','pipe','pipe']});}catch(e){failure=String(e.stderr);}
    assert(failure?.includes('AssertionError'),name+' actual serial source mutant must reach semantic assertion');
  }
  console.log(`SERIAL-LOADER SOURCE MUTANTS OK (${mutants.length}/${mutants.length} intended semantic failures)`);
}

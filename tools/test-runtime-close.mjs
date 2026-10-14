// CPU contract only: tiny legal containers, no network, native allocation or shipped asset changes.
import assert from 'node:assert/strict';
import {BakedAtlas,ImpostorPool,pinRuntimeClose,BAKED_BASES,loadBakedAtlas} from '../src/units/impostor.js';
import {loaderFixture} from './atlas-loader-fixture.mjs';
import {pageMipBytes} from '../src/units/atlas-compression.js';
import {Texture,TextureLoader,Scene} from 'three';
import fs from 'node:fs';
import {Game} from '../src/game.js';
import {prepareFieldScenario} from '../src/sim/phase.js';
import {setPlan} from '../src/world/landscape.js';
import {LOOK} from '../src/ui/look.js';

function fixture(options={}, pin=pinRuntimeClose) {
  const original=loaderFixture(options),baseline=structuredClone(original.atlas.layout.manifest),
    manifest=structuredClone(original.hybrid),sourceManifest=structuredClone(original.atlas.diagnosticClose.sourceManifest);
  for(const m of [manifest,sourceManifest]){
    m.tiers.close.variants.h2_slouch_roll_butternut=m.tiers.close.variants.extra;
    delete m.tiers.close.variants.extra;
  }
  for(const [look,tier]of Object.entries({base:manifest.tiers.close,...manifest.tiers.close.variants}))
    tier.pages.forEach((p,i)=>Object.assign(p,{file:`cs-close-${look}-${i}-${i===4?'original.png':'astc.ktx2'}`,
      mipLevels:pageMipBytes(p.w,p.h,i!==4).levels.length,bytes:1}));
  const input={baseline,manifest,sourceManifest,base:BAKED_BASES.CS},descriptor=pin(input),requests=[];
  const translate=url=>{
    requests.push(url);
    const name=url.slice(BAKED_BASES.CS.length),match=/^cs-close-(base|h2_slouch_roll_butternut)-([0-4])-(astc\.ktx2|original\.png)$/.exec(name);
    return match?`candidate/${match[1]==='base'?'base':'extra'}-${match[2]}.${match[3]==='astc.ktx2'?'ktx2':'png'}`:`baseline/${name}`;
  };
  const io={fetch:url=>original.io.fetch(translate(url)),loadPNG:url=>original.io.loadPNG(translate(url))};
  const atlas=new BakedAtlas(baseline,BAKED_BASES.CS,{runtimeClose:descriptor,renderer:original.renderer,io});
  const pools=[new ImpostorPool(2),new ImpostorPool(2)];for(const p of pools)p.attach(atlas);
  return {...original,input,descriptor,atlas,pools,requests,io,async cleanup(){original.releaseLate();try{await atlas.close();}catch{}original.cleanup();}};
}
async function withFixture(check,options={},pin){const f=fixture(options,pin);try{await check(f);}finally{await f.cleanup();}}
const checks=[
  ['registered-before-field',()=>withFixture(async f=>{
    const fetch=globalThis.fetch,load=TextureLoader.prototype.loadAsync;let registered=false,atlas;
    try{
      globalThis.fetch=async url=>String(url).endsWith('soldier.json')
        ? {ok:true,json:async()=>structuredClone(f.input.baseline)} : f.io.fetch(url);
      TextureLoader.prototype.loadAsync=function(url){assert.equal(registered,true);return f.io.loadPNG(url);};
      atlas=await loadBakedAtlas(BAKED_BASES.CS,{runtimeClose:f.descriptor,renderer:f.renderer,onCreated(a){
        assert.equal(a.loadsSettled,true);assert.equal(a.loaded('field'),false);registered=true;
        a.diagnosticClose={};a.renderer=null;
      }});
      await atlas.load('close');assert.equal(atlas.textures.close.length,10);
    }finally{try{await atlas?.close();}finally{globalThis.fetch=fetch;TextureLoader.prototype.loadAsync=load;}}
  })],
  ...['load','close-pending'].map(mode=>['game-constructor-'+mode,()=>withFixture(async f=>{
    const fetch=globalThis.fetch,load=TextureLoader.prototype.loadAsync,style=LOOK.figureStyle;let game,requests=0,release;
    const pending=new Promise(resolve=>{release=resolve;});
    const turn=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
    try{
      globalThis.fetch=async url=>{if(!String(url).endsWith('soldier.json'))return f.io.fetch(url);
        requests++;return {ok:true,json:async()=>structuredClone(f.input.baseline)};};
      TextureLoader.prototype.loadAsync=async url=>{if(mode==='close-pending')await pending;return f.io.loadPNG(url);};
      const scenario=JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json',import.meta.url)));
      scenario.units=scenario.units.slice(0,2);prepareFieldScenario(scenario,'henry-hill');setPlan(scenario);LOOK.figureStyle='baked';
      game=new Game({scene:new Scene(),terrain:{half:3500,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},scenario,
        world:{fenceField:null},effects:{volley(){},boom(){}},renderer:f.renderer,csRuntimeClose:f.input});
      assert.equal(requests,2);f.input.manifest.camera.elevation_deg++;
      if(mode==='close-pending'){
        await turn();assert.equal(game.baked.state,'loading');
        let done=false;const close=game.closeFigureResources().then(r=>{done=true;return r;});
        await turn();assert.equal(done,false);release();assert.equal((await close).loadsSettled,true);
        assert.equal(game.baked.state,'closed');assert.ok(Object.values(game.impostors).every(p=>!p.atlas));
      }else{
        await turn();assert.equal(game.baked.state,'ready');assert.equal(requests,2);
        const cs=game.baked.atlases.CS;cs.diagnosticClose={};cs.renderer=null;await cs.load('close');
        assert.equal(cs.textures.close.length,10);assert.equal(game.baked.atlases.US.loaded('close'),false);
      }
    }finally{release();try{await game?.closeFigureResources();}finally{globalThis.fetch=fetch;TextureLoader.prototype.loadAsync=load;LOOK.figureStyle=style;}}
  })]),
  ['immutable',a=>withFixture(async f=>{
    const captured=a.pin(f.input),elevation=captured.manifest.camera.elevation_deg;
    f.input.manifest.camera.elevation_deg++;f.input.manifest.tiers.close.pages[0].file='../foreign.ktx2';
    assert.equal(captured.manifest.camera.elevation_deg,elevation);
    assert.ok(Object.isFrozen(f.descriptor.manifest.tiers.close.pages[0]));
    assert.throws(()=>{f.descriptor.manifest.camera.elevation_deg++;},TypeError);
    f.atlas.diagnosticClose={};f.atlas.renderer={getContext(){throw Error('foreign renderer');}};
    f.atlas.base='foreign/';await f.atlas.load('close');
    assert.equal(f.atlas.textures.close.length,10);assert.ok(f.requests.every(u=>u.startsWith(BAKED_BASES.CS)));
  })],
  ['descriptor-refusals',a=>withFixture(async f=>{
    const bad=[];for(const edit of [x=>x.base='../escape/',x=>x.extra=true,x=>x.manifest.camera.elevation_deg++,
      x=>x.manifest.tiers.close.pages[0].file='../escape.ktx2',x=>x.manifest.tiers.close.pages[0].alpha='straight-gamma-bytes',
      x=>x.manifest.tiers.close.pages[0].mipLevels--,x=>x.sourceManifest.tiers.close.pages[0].file='other.png']){
      const x=structuredClone(f.input);edit(x);bad.push(x);
    }
    for(const x of bad)assert.throws(()=>a.pin(x));
    let getterCalls=0;const x={...f.input};Object.defineProperty(x,'manifest',{enumerable:true,get(){getterCalls++;return f.input.manifest;}});
    assert.throws(()=>a.pin(x));assert.equal(getterCalls,0);assert.equal(f.requests.length,0);
  })],
  ['constructor-refusals',()=>withFixture(async f=>{
    assert.throws(()=>new BakedAtlas(f.input.baseline,BAKED_BASES.CS,{runtimeClose:{...f.descriptor},renderer:f.renderer}),/runtime binding/);
    assert.throws(()=>new BakedAtlas(f.input.baseline,BAKED_BASES.CS,{runtimeClose:f.descriptor,diagnosticClose:{},renderer:f.renderer}),/runtime binding/);
    const changed=structuredClone(f.input.baseline);changed.camera.elevation_deg++;
    assert.throws(()=>new BakedAtlas(changed,BAKED_BASES.CS,{runtimeClose:f.descriptor,renderer:f.renderer}),/runtime binding/);
    assert.equal(f.requests.length,0);
  })],
  ['unsupported',()=>withFixture(async f=>{await f.atlas.load('close');assert.equal(f.atlas.textures.close.length,5);
    assert.ok(f.requests.every(u=>!u.includes('cs-close-')));assert.ok(!f.events.includes('finish'));},{unsupported:true})],
  ['fallback-completion',()=>withFixture(async f=>{await f.atlas.load('close');assert.equal(f.atlas.textures.close.length,5);
    const finish=f.events.indexOf('finish'),baseline=f.events.findIndex(e=>e.startsWith('png:baseline/'));
    assert.ok(finish>f.events.lastIndexOf('dispose')&&finish<baseline);},{httpFailure:true})],
  ['delayed',()=>withFixture(async f=>{const task=f.atlas.load('close');for(let i=0;i<30;i++)await Promise.resolve();
    assert.equal(f.atlas.loaded('close'),false);assert.ok(!f.events.includes('finish'));
    f.releaseLate();await task;assert.ok(f.events.indexOf('finish')>f.events.indexOf('late-done'));},{httpFailure:true,delay:true})],
  ['live-drift-delayed',()=>withFixture(async f=>{
    const task=f.atlas.load('close');for(let i=0;i<30;i++)await Promise.resolve();
    f.atlas.layout.tiers.close.pages[0].file='../foreign.png';f.releaseLate();
    await assert.rejects(task,/metadata drift/);assert.equal(f.disposed.size,9);
    assert.ok(!f.requests.some(u=>u.includes('foreign')||!u.includes('cs-close-')));
  },{httpFailure:true,delay:true})],
  ['failed-finish',()=>withFixture(async f=>{await assert.rejects(f.atlas.load('close'),/completion/);
    assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')));},{httpFailure:true,finishFailure:true})],
  ['historical-falsy',()=>withFixture(async f=>{
    const p=f.pools[0],texture=new Texture(),batches=p.prepareTier('close',f.atlas.layout,[texture]);
    batches[0].body.material.addEventListener('dispose',()=>{throw 0;});
    let failed=false;try{p.disposeTier(batches);}catch(error){failed=true;assert.equal(error,0);}
    assert.equal(failed,true);assert.equal(p.cleanupFailure.failed,true);assert.equal(p.cleanupFailure.error,0);texture.dispose();
    p.disposeTier([]);await assert.rejects(f.atlas.load('close'),/cleanup incomplete/);assert.equal(f.requests.length,0);
  })],
  ['rollback-falsy',()=>withFixture(async f=>{
    const p=f.pools[0],prepare=p.prepareTier;let first=true;
    p.prepareTier=function(...args){const bs=prepare.apply(this,args);if(first){first=false;bs[0].body.material.addEventListener('dispose',()=>{throw 0;});}return bs;};
    p.mountTier=()=>{throw Error('controlled publication failure');};
    await assert.rejects(f.atlas.load('close'),/cleanup incomplete/);
    assert.ok(p.cleanupFailure.failed);assert.equal(p.cleanupFailure.error,0);
    assert.equal(f.disposed.size,10);assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')));
  })],
  ['first-falsy-before-textures',()=>withFixture(async f=>{
    const p=f.pools[0],prepare=p.prepareTier;
    p.prepareTier=function(...args){const batches=prepare.apply(this,args);
      batches[0].body.material.addEventListener('dispose',()=>{throw 0;});
      this.disposeTier(batches);throw Error('unreachable');};
    const png=f.io.loadPNG;f.io.loadPNG=async url=>{const t=await png(url);t.addEventListener('dispose',()=>{throw Error('later texture cleanup');});return t;};
    await assert.rejects(f.atlas.load('close'),/cleanup incomplete/);
    assert.equal(f.atlas.cleanupFailure.failed,true);assert.equal(f.atlas.cleanupFailure.error,0);
    assert.equal(f.disposed.size,10);assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')));
  })],
  ['close-during-load',()=>withFixture(async f=>{const task=f.atlas.load('close');for(let i=0;i<30;i++)await Promise.resolve();
    let done=false;const close=f.atlas.close().then(()=>{done=true;});for(let i=0;i<10;i++)await Promise.resolve();
    assert.equal(done,false);f.releaseLate();await assert.rejects(task);await close;
    assert.equal(f.atlas.loadsSettled,true);assert.equal(Object.keys(f.atlas.textures).length,0);
    assert.ok(!f.events.some(e=>e.startsWith('png:baseline/')));},{delay:true})],
];
for(const [name,check]of checks)try{await check({pin:pinRuntimeClose});}catch(error){console.error('RUNTIME-CLOSE FAILED',name);throw error;}
console.log(`RUNTIME-CLOSE OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,pin]of [['immutable',x=>x],['descriptor-refusals',x=>x]]){
    let failed=false;try{await checks.find(c=>c[0]===name)[1]({pin});}catch(error){assert.equal(error.code,'ERR_ASSERTION','control must reach its own assertion');failed=true;}
    assert.equal(failed,true,'ineffective runtime close control '+name);
  }
  console.log('RUNTIME-CLOSE CONTROLS OK (2/2)');
}

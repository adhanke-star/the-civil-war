// CPU/source contracts only. No browser, native graphics, sound output or generated files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Scene,Vector2,TextureLoader,DataTexture} from 'three';
import {fieldResourceProfile,prepareFieldResources,createFieldGraphicsStop,detectFieldGPUTier} from '../src/main.js';
import {Post} from '../src/render/post.js';
import {Input} from '../src/ui/input.js';
import {Mixer,BUSES} from '../src/audio/mixer.js';
import {Effects} from '../src/fx/effects.js';
import {Game} from '../src/game.js';
import {LOOK} from '../src/ui/look.js';
import {prepareFieldScenario,loadBattlePack} from '../src/sim/phase.js';
import {setPlan,PLAN} from '../src/world/landscape.js';
import {showGraphicsReload} from '../src/ui/briefing.js';
import {QUALIFIED_RUNTIME_MEMBERS,QUALIFIED_HYBRID} from './bake/review-current-compression.mjs';
import {AtlasLayout} from '../src/units/impostor.js';
import {parseAtlasAstc,pageMipBytes} from '../src/units/atlas-compression.js';
import {ordinaryLookoutFixture,ordinaryCapacityContract} from './resource-profile-fixture.mjs';
import {applyCampaign} from '../src/franchise/campaign.js';
import {validateSnapshot} from '../src/franchise/save.js';
import {installFieldContextObserver,installAllocationObserver,AllocationLedger,mipSizes,ReservationPeak,defaultSurfaceHistoryErrors,fieldEpochObservationErrors,sampleSceneAllocations} from './bake/scene-allocation.mjs';

const base='assets/figures/confederate-infantry/';
const turn=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const rejectsFalsy=async(p,value)=>{let failed=false;try{await p;}catch(error){failed=true;assert.equal(error,value);}assert.equal(failed,true);};

class Canvas {
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
  async emit(type){for(const fn of [...this.listeners.get(type)||[]]){fn(new Event(type,{cancelable:true}));await Promise.resolve();}}
}
function dom(){
  const nodes=new Map(),document={activeElement:null};
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.children=[];this.attrs={};this.hidden=false;this.inert=false;this.style={};}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='id'){this.id=v;nodes.set(v,this);}}
    getAttribute(k){return this.attrs[k]??null;}
    append(...kids){for(const child of kids){this.children.push(child);if(typeof child==='object')child.parent=this;}}
    querySelector(selector){for(const child of this.children){if(typeof child!=='object')continue;if(child.tagName===selector)return child;const found=child.querySelector(selector);if(found)return found;}return null;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);if(this.id)nodes.delete(this.id);this.parent=null;}
    showModal(){this.open=true;}
    focus(){document.activeElement=this;}
  }
  document.createElement=tag=>new Element(tag);document.getElementById=id=>nodes.get(id)||null;
  document.body=new Element('body');for(const id of ['battle','status']){const n=new Element('div');n.setAttribute('id',id);document.body.append(n);}
  return document;
}
async function globals(values,run){const before=Object.fromEntries(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [k,value]of Object.entries(values))Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
  try{return await run();}finally{for(const [k,d]of Object.entries(before)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}}

function renderer(){
  const events=[],canvas=new Canvas(),size=new Vector2(300,150);let ratio=1;
  const gl={NO_ERROR:0,lost:false,isContextLost(){return this.lost;},getError:()=>0,finish(){events.push('finish');}};
  const driver={domElement:canvas,properties:{},getContext:()=>gl,getSize:v=>v.copy(size),
    setPixelRatio(value){ratio=value;this.setSize(size.x,size.y,false);},
    setSize(w,h){size.set(w,h);events.push(['size',Math.floor(w*ratio),Math.floor(h*ratio)]);},
    dispose(){events.push('renderer-dispose');canvas.removeEventListener('webglcontextrestored',restore);}};
  const restore=()=>events.push('three-reinitialize');canvas.addEventListener('webglcontextrestored',restore);
  return {driver,gl,canvas,events};
}

async function ordering(Class=Game,{early=false,startup=false}={}){
  const document=dom(),f=renderer(),style=LOOK.figureStyle,load=TextureLoader.prototype.loadAsync;
  let game,release,owners,stop,closeFinished=false;
  const pending=new Promise(resolve=>{release=resolve;});
  await globals({document,window:{devicePixelRatio:1},fetch:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(String(url).replace(/^\.\//,'')))}),
    cancelAnimationFrame:id=>f.events.push('cancel:'+id)},async()=>{
    try{
      const post=new Post(f.driver,{resourceLifetime:true,diagnosticPixelBytes:3639218});
      post.rtScene.addEventListener('dispose',()=>f.events.push('post-retire'));
      f.canvas.addEventListener('webglcontextlost',()=>f.events.push('terrain-owner-loss'));
      const effects=new Effects(new Scene(),{},{});
      owners={renderer:f.driver,post,effects,game:null,input:null,briefing:null,raf:7};stop=createFieldGraphicsStop(owners);stop.listenLast();
      if(!startup){
        TextureLoader.prototype.loadAsync=async()=>{await pending;return new DataTexture(new Uint8Array(4),1,1);};
        const scenario=JSON.parse(fs.readFileSync('assets/scenarios/henry-hill.json'));scenario.units=scenario.units.slice(0,2);
        prepareFieldScenario(scenario,'henry-hill');setPlan(scenario);LOOK.figureStyle='baked';
        game=new Class({scene:new Scene(),terrain:{half:3500,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},scenario,
          world:{fenceField:null},effects:{volley(){},boom(){}},renderer:f.driver,figureResourceLifetime:true});
        owners.game=game;
        game.pools.US.buckets[0].mesh.geometry.addEventListener('dispose',()=>f.events.push('pool-retire'));
        game.pools.US.buckets[0].mesh.material.addEventListener('dispose',()=>f.events.push('game-material'));
        owners.input={stopForReload(){f.events.push('input-stop');}};
        await turn();assert.equal(game.baked.state,'loading');
        stop.listenLast();
      }
      f.gl.lost=true;
      if(early){assert.equal(stop.check(),false);await turn();assert.ok(!f.events.includes('renderer-dispose'));assert.equal(stop.snapshot.eventProcessed,false);}
      await f.canvas.emit('webglcontextlost');await turn();
      const disposal=f.events.indexOf('renderer-dispose');
      assert.ok(disposal>f.events.indexOf('terrain-owner-loss'),'loss-order: source terrain listener before renderer disposal');
      assert.ok(disposal>f.events.indexOf('post-retire'),'loss-order: actual Post retirement before renderer disposal');
      assert.ok(stop.snapshot.stopped&&stop.snapshot.eventProcessed&&stop.snapshot.rendererDisposed&&!stop.snapshot.failed,JSON.stringify(stop.snapshot));
      if(game){assert.ok(disposal>f.events.indexOf('game-material'),'loss-order: actual Game material retirement before renderer disposal');
        assert.equal(game.figureResourceSnapshot().loadsSettled,false);assert.equal(game.figureResourceSnapshot().closed,true);
        const close=game.closeFigureResources().then(()=>{closeFinished=true;});await turn();assert.equal(closeFinished,false);release();await close;
      }
      f.gl.lost=false;const count=f.events.length;
      await f.canvas.emit('webglcontextrestored');post.setSize(600,400);post.setMode('high');post.startFromTier(3);post.render({},{});
      assert.equal(f.events.length,count,'terminal owners never resize/render/reinitialize on restoration');assert.equal(stop.check(),false);
      assert.ok(document.getElementById('graphics-reload').open);assert.equal(document.activeElement.tagName,'button');
    }finally{release();if(game)try{await game.closeFigureResources();}catch{}TextureLoader.prototype.loadAsync=load;LOOK.figureStyle=style;}
  });
}

const pendingImportScript=String.raw`
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {Scene} from 'three';
import {Effects} from './src/fx/effects.js';
let release,resolveClose,closed=0;globalThis.__importStarted=false;
globalThis.__lateZzfx=new Promise(r=>{release=r;});
const closeGate=new Promise(r=>{resolveClose=r;});
globalThis.__lateContext={state:'running',close(){closed++;return process.argv[2]==='reject'?Promise.reject(0):closeGate;}};
const source='globalThis.__importStarted=true;await globalThis.__lateZzfx;export const ZZFX={audioContext:globalThis.__lateContext};export const zzfx=()=>{};';
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='zzfx'?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);}});
const e=new Effects(new Scene(),{},{});const ready=e.unlock();ready.catch(()=>{});
for(let i=0;i<50&&!globalThis.__importStarted;i++)await new Promise(r=>setImmediate(r));assert.equal(globalThis.__importStarted,true);
let done=false;const stop=e.stopForReload();stop.then(()=>{done=true;},()=>{done=true;});
await new Promise(r=>setImmediate(r));assert.equal(done,false);release();
for(let i=0;i<50&&closed===0;i++)await new Promise(r=>setImmediate(r));assert.equal(closed,1);
if(process.argv[2]==='reject'){
 for(const p of [stop,e.stopForReload()]){let failed=false;try{await p;}catch(error){failed=true;assert.equal(error,0);}assert.equal(failed,true);}
}else{assert.equal(done,false);resolveClose();await stop;await e.stopForReload();}
assert.equal(e.sound.zzfx,null);assert.equal(await e.unlock(),false);hooks.deregister();console.log('PENDING-ZZFX-CLEAR');
`;

const streamScript=String.raw`
import assert from 'node:assert/strict';import {mixer} from './src/audio/mixer.js';
import {playMusic,stopMusicForReload} from './src/audio/music.js';
const streams=[],timers=[];globalThis.setTimeout=fn=>{timers.push(fn);return timers.length;};
globalThis.Audio=class {constructor(){this.index=streams.length;this.events=[];streams.push(this);}play(){return Promise.resolve();}
 pause(){this.events.push('pause');if(this.index===1)throw 0;}removeAttribute(){this.events.push('remove');}load(){this.events.push('load');}};
let routed=0;mixer.ctx={state:'running',currentTime:0,createMediaElementSource(){if(routed++)throw Error('controlled direct-volume fallback');
 return {connect(){return this;},disconnect(){streams[0].events.push('source-disconnect');}};},
 createGain(){return {gain:{value:0,setTargetAtTime(){}},connect(){},disconnect(){streams[0].events.push('gain-disconnect');}};}};
playMusic('title');playMusic('camp');assert.equal(streams.length,2);assert.equal(streams[0].events.length,0);
for(let i=0;i<2;i++){let failed=false;try{stopMusicForReload();}catch(error){failed=true;assert.equal(error,0);}assert.equal(failed,true);}
for(const s of streams)assert.ok(s.events.includes('pause')&&s.events.includes('remove')&&s.events.includes('load'));
assert.ok(streams[0].events.includes('source-disconnect')&&streams[0].events.includes('gain-disconnect'));
assert.equal(playMusic('results'),false);for(const fn of timers)fn();console.log('STREAM-TERMINAL-CLEAR');
`;

const pendingEffectsScript=String.raw`
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {Scene} from 'three';import {Effects} from './src/fx/effects.js';
let release;globalThis.__started=false;globalThis.__pendingQuarks=new Promise(r=>{release=r;});
const source='globalThis.__started=true;await globalThis.__pendingQuarks;export class ParticleSystem{constructor(){throw Error("allocated after stop");}}';
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='three.quarks'?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);}});
const scene=new Scene(),e=new Effects(scene,{},{}),init=e.init();
for(let i=0;i<50&&!globalThis.__started;i++)await new Promise(r=>setImmediate(r));assert.equal(globalThis.__started,true);
await e.stopForReload();release();assert.equal(await init,false);assert.equal(scene.children.length,0);assert.equal(e.systems.length,0);hooks.deregister();console.log('PENDING-EFFECTS-CLEAR');
`;

const pendingMusicScript=String.raw`
import assert from 'node:assert/strict';import {mixer} from './src/audio/mixer.js';
import {playMusic,stopMusicForReload} from './src/audio/music.js';
let reject;const warnings=[];console.warn=(...args)=>warnings.push(args);
globalThis.Audio=class {play(){return new Promise((_,r)=>{reject=r;});}pause(){}removeAttribute(){}load(){}};
mixer.ctx={state:'running',currentTime:0,createMediaElementSource(){throw Error('direct fallback');}};
playMusic('title');if(process.argv[2]!=='ordinary')stopMusicForReload();
const error=new Error('controlled playback rejection');error.name=process.argv[2]==='genuine'?'NotSupportedError':'AbortError';
reject(error);await Promise.resolve();await Promise.resolve();
assert.equal(warnings.length,process.argv[2]==='terminal'?0:1);console.log('PENDING-MUSIC-CLEAR');
`;

const api={profile:fieldResourceProfile,prepare:prepareFieldResources,ordering,Mixer,Effects,Post,Input,detect:detectFieldGPUTier};
async function ordinaryInputControls() {
  const campaign=JSON.parse(fs.readFileSync('assets/campaign.json')),
    pack=JSON.parse(fs.readFileSync('assets/packs/chattanooga.json')),
    original=JSON.stringify({campaign,pack}),fixture=ordinaryLookoutFixture(campaign,pack);
  assert.match(fixture.kind,/NOT PLAYED/);
  assert.equal(fixture.records.length,9);
  assert.equal(fixture.save.campaign.index,9);
  assert.equal(fixture.save.campaign.history.length,9);
  assert.equal(fixture.phase.awardId,'west.3.chattanooga.lookout-mountain.1');
  assert.ok(fixture.records.every(r=>r.winner===null&&r.grade==='Draw'&&r.units.length===0&&r.loot.length===0));
  assert.deepEqual(validateSnapshot(fixture.save),fixture.save);
  assert.deepEqual(ordinaryLookoutFixture(campaign,pack),fixture);
  assert.equal(JSON.stringify({campaign,pack}),original);
  const loaded=await loadBattlePack({packId:'chattanooga',phaseId:fixture.phase.phaseId,
    fetcher:async()=>new Response(JSON.stringify(pack))});
  assert.deepEqual(loaded.scenario,fixture.authored);
  assert.deepEqual(prepareFieldScenario(applyCampaign(loaded.scenario,fixture.save,fixture.phase),'pack'),fixture.applied);
  const manifest=dir=>JSON.parse(fs.readFileSync('assets/figures/'+dir+'/soldier.json')),
    US=new AtlasLayout(manifest('union-infantry')),CS=new AtlasLayout(manifest('confederate-infantry')),
    hybrid=new AtlasLayout(JSON.parse(fs.readFileSync(base+'soldier-hybrid.json')));
  const routes=Object.fromEntries(['capable','unsupported'].map(route=>[route,{US:{field:US.tiers.field.pages.length,close:US.tiers.close.pages.length},
    CS:{field:CS.tiers.field.pages.length,close:(route==='capable'?hybrid:CS).tiers.close.pages.length}}]));
  for(const [route,pages]of Object.entries(routes)) {
    const c=ordinaryCapacityContract(fixture.authored,fixture.applied,pages);
    assert.deepEqual([c.authored.US,c.applied.US,c.authored.CS,c.applied.CS],[3744,3732,2905,2905]);
    for(const side of ['authored','applied'])assert.deepEqual(
      [c[side].ratio,c[side].reserve,c[side].definitions,c[side].scheduled,c[side].horses,c[side].mounts,c[side].flags,c[side].guns],
      [5,2100,13,4,15,4200,90,{US:8,CS:2,limbers:10}]);
    assert.equal(pages.CS.close,route==='capable'?10:5);
  }
  // Real Game constructor, CPU arrays on labelled flat ground; no WebGL or ordinary-entry claim.
  const beforeStyle=LOOK.figureStyle,beforePlan=Object.getOwnPropertyDescriptors(PLAN);let game;
  try {
    LOOK.figureStyle='rigged';setPlan(fixture.applied);
    game=new Game({scene:new Scene(),terrain:{half:3500,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},
      scenario:fixture.applied,world:{fenceField:null},effects:{volley(){},boom(){}}});
    assert.equal(game.pools.US.capacity,3732);assert.equal(game.pools.CS.capacity,2905);
    assert.equal(game.scenario,fixture.applied);
  }finally{try{await game?.closeFigureResources();}finally{LOOK.figureStyle=beforeStyle;Object.defineProperties(PLAN,beforePlan);}}
  const mutations=[
    s=>s.units.pop(),s=>s.units.push(structuredClone(s.units[0])),
    s=>s.reinforcements.pop(),s=>s.reinforcements.reverse(),
    s=>{s.units.find(d=>d.type==='artillery').guns++;},
    s=>{s.reinforcements[0].atSec++;},s=>{s.reinforcements[0].entry+=' changed';},
    s=>{s.reinforcements[0].noticeSec=(s.reinforcements[0].noticeSec??60)+1;},
    s=>{s.reinforcements[0].x++;},s=>{s.units[0].side='CS';},
    s=>{s.units[0].name='Changed historical label';},
    s=>{s.units[0].sources=['changed source'];},s=>{s.menPerFigure=10;},
    s=>{const us=s.units.filter(d=>d.side==='US');us[0].men++;us[1].men-=20;},
    s=>{s.units[0].men+=100000;},s=>{s.terrain='henry-hill';},s=>{s.id='different';},
  ];
  for(const mutate of mutations){const bad=structuredClone(fixture.applied);mutate(bad);
    assert.throws(()=>ordinaryCapacityContract(fixture.authored,bad,routes.capable),/^Error: ordinary resource inputs: /);}
  const changed=structuredClone(campaign);changed.phases.splice(0,1);
  assert.throws(()=>ordinaryLookoutFixture(changed,pack),/^Error: ordinary resource inputs: /);
  assert.throws(()=>ordinaryLookoutFixture(campaign,{...pack,id:'different'}),/^Error: ordinary resource inputs: /);
  const oversized=structuredClone(pack);
  oversized.phases.find(p=>p.id==='lookout-mountain').scenario.units[0].men=100000;
  assert.throws(()=>ordinaryLookoutFixture(campaign,oversized),/^Error: Field: /);
  console.log(`ORDINARY-INPUTS OK (constructor/prefix/determinism/shipping-composition/two-route-capacity); CONTROLS OK (${mutations.length+3}/${mutations.length+3}); native entry/250MB UNRUN`);
}
await ordinaryInputControls();
async function contextObserverControls() {
  let checks=0;
  for(const inherited of [false,true])await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    const calls=[],peekCalls=[],gl={},otherGL={};let target,throwValue;
    const native=function(...args){calls.push({receiver:this,args});if(throwValue!==undefined)throw throwValue;
      return args[0]==='null'?null:this===target?gl:otherGL;};
    class Base{}Object.defineProperty(Base.prototype,'getContext',{value:native,writable:true,configurable:true});
    class Canvas extends Base{}if(!inherited)Object.defineProperty(Canvas.prototype,'getContext',{value:native,writable:true,configurable:true});
    HTMLCanvasElement=Canvas;target=new Canvas();document.getElementById=()=>target;
    Object.defineProperty(window,'__allocation',{value:{peek(context){peekCalls.push(context);return{observed:false};}},configurable:true});
    const before=Object.getOwnPropertyDescriptor(Canvas.prototype,'getContext');
    const disabled=installFieldContextObserver();assert.equal(disabled.read().enabled,false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Canvas.prototype,'getContext'),before);disabled.restore();checks+=2;
    const observer=installFieldContextObserver({enabled:true}),options={alpha:false};
    assert.equal(target.getContext('webgl2',options),gl);assert.equal(calls.length,1);
    assert.equal(calls[0].receiver,target);assert.equal(calls[0].args[1],options);assert.equal(peekCalls.length,0);checks+=5;
    target.getContext('webgl2',options);new Canvas().getContext('webgl2');target.getContext('2d');target.getContext('null');
    const r=observer.read();assert.deepEqual(r.receipts.map(e=>e.context),[1,1,null,null,null]);
    assert.equal(r.receipts.at(-1).outcome,'null');assert.equal(r.states.length,1);assert.equal(peekCalls[0],gl);checks+=4;
    const error=new Error('native context failure');throwValue=error;
    assert.throws(()=>target.getContext('webgl2'),e=>e===error);assert.equal(observer.read().receipts.at(-1).outcome,'throw');checks+=2;
    throwValue={get message(){throw Error('observation getter failed');}};
    assert.throws(()=>target.getContext('webgl2'),e=>e===throwValue);assert.equal(observer.read().observerFailureCount,1);checks+=2;
    for(const unavailable of [()=>{},Symbol('metadata')]){
      throwValue={name:unavailable,message:'native original failure'};
      assert.throws(()=>target.getContext('webgl2'),e=>e===throwValue);
      const r=observer.read();assert(r.receipts.at(-1).error.metadataUnavailable);
      assert.equal(r.receipts.at(-1).error.name,null);assert.doesNotThrow(()=>structuredClone(r));checks+=4;
    }
    observer.restore();observer.restore();assert.equal(target.getContext,native);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Canvas.prototype,'getContext'),before);
    assert.equal(Object.hasOwn(window,'__fieldContextObservation'),false);checks+=3;
  });
  await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    const contexts=Array.from({length:10},()=>({}));let index=0,calls=0;class Canvas{getContext(){calls++;return contexts[index];}}
    HTMLCanvasElement=Canvas;const target=new Canvas();document.getElementById=()=>target;
    window.__allocation={peek:()=>({observed:false})};
    const o=installFieldContextObserver({enabled:true});
    target.getContext('webgl2');index=1;target.getContext('webgl2');
    assert.deepEqual(o.read().receipts.map(r=>r.context),[1,2]);checks++;
    for(let i=0;i<130;i++)target.getContext('webgl2');assert(o.read().overflow);assert.equal(o.read().receipts.length,128);assert.equal(calls,132);checks+=3;o.restore();
    const p=installFieldContextObserver({enabled:true}),foreign=()=>null;Canvas.prototype.getContext=foreign;
    assert.throws(()=>p.restore(),/foreign canvas descriptor/);assert.equal(Canvas.prototype.getContext,foreign);checks+=2;
  });
  await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    class Canvas{getContext(){return{};}}HTMLCanvasElement=Canvas;const target=new Canvas();document.getElementById=()=>target;
    window.__allocation={peek:()=>({observed:false})};const o=installFieldContextObserver({enabled:true}),foreign={foreign:true};
    Object.defineProperty(window,'__fieldContextObservation',{value:foreign,configurable:true});
    assert.throws(()=>o.restore(),/foreign observation owner/);assert.equal(window.__fieldContextObservation,foreign);checks+=2;
  });
  await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    let current=0;const values=Array.from({length:9},()=>({})),prior={prior:true};
    class Canvas{getContext(){return values[current];}}HTMLCanvasElement=Canvas;const target=new Canvas();document.getElementById=()=>target;
    window.__allocation={peek:()=>({observed:false})};
    Object.defineProperty(window,'__fieldContextObservation',{value:prior,writable:true,enumerable:true,configurable:true});
    const before=Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),o=installFieldContextObserver({enabled:true});
    for(current=0;current<9;current++)assert.equal(target.getContext('webgl2'),values[current]);
    assert.equal(o.read().states.length,8);assert(o.read().overflow);checks+=2;
    o.restore();assert.deepEqual(Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),before);checks++;
    const p=installFieldContextObserver({enabled:true});document.getElementById=()=>{throw Error('DOM observation failure');};
    current=0;assert.equal(target.getContext('webgl2'),values[0]);assert.equal(p.read().observerFailureCount,1);checks+=2;p.restore();
  });
  await globals({window:{},WebGLRenderingContext:undefined,WebGL2RenderingContext:undefined},()=>{
    let queries=0;const original=new Error('native allocation failure');let failure=original;
    class GL {
      bufferData(){throw failure;}
      getContextAttributes(){queries++;throw Error('unexpected GL query');}
      isContextLost(){queries++;throw Error('unexpected GL loss query');}
      getError(){queries++;throw Error('unexpected GL error query');}
    }
    WebGL2RenderingContext=GL;const native=GL.prototype.bufferData;
    installAllocationObserver({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true,captureNativeFailures:true});
    const gl=new GL(),o=window.__allocation;assert.equal(o.peek(gl).observed,false);assert.equal(queries,0);checks+=2;
    assert.throws(()=>gl.bufferData(1,2,3),e=>e===original);const r=o.peek(gl);
    assert.equal(r.observed,true);assert.equal(r.sampled,false);assert.equal(r.bytes,0);assert.equal(r.gpuPeak,0);
    assert.equal(r.nativeFailures.length,1);assert.equal(r.nativeFailures[0].call,'bufferData');assert.equal(r.nativeFailures[0].error.message,original.message);
    assert.equal(Object.keys(r.calls).length,0);assert.equal(r.nativeEvents.length,0);assert.equal(queries,0);checks+=11;
    failure={get message(){throw Error('metadata failure');}};assert.throws(()=>gl.bufferData(),e=>e===failure);
    assert.equal(o.peek(gl).observerFailureCount,1);assert(o.peek(gl).unknown.includes('native failure observer failed'));checks+=3;
    for(const unavailable of [()=>{},Symbol('metadata')]){
      failure={name:unavailable,message:'native original failure'};
      assert.throws(()=>gl.bufferData(),e=>e===failure);const r=o.peek(gl);
      assert(r.nativeFailures.at(-1).error.metadataUnavailable);assert.equal(r.nativeFailures.at(-1).error.name,null);
      assert.doesNotThrow(()=>structuredClone(r));checks+=4;
    }
    failure=original;for(let i=0;i<130;i++)try{gl.bufferData();}catch(e){assert.equal(e,original);}
    assert(o.peek(gl).unknown.includes('native failure receipt limit'));assert.equal(o.peek(gl).nativeFailures.length,128);assert.equal(queries,0);checks+=3;
    o.restore();assert.equal(GL.prototype.bufferData,native);checks++;
  });
  await globals({window:{},WebGLRenderingContext:undefined,WebGL2RenderingContext:undefined},()=>{
    let queries=0;const nativeCalls=[],returned={},error=new Error('lost native failure');
    class GL {
      constructor(){this.drawingBufferWidth=10;this.drawingBufferHeight=10;this.buffer={};this.lost=false;}
      bufferData(...args){nativeCalls.push({receiver:this,args});if(this.fail)throw error;return returned;}
      getParameter(){queries++;if(this.lost)throw Error('query during loss');return this.buffer;}
      getContextAttributes(){queries++;if(this.lost)throw Error('attributes during loss');return{depth:true,stencil:false};}
    }
    GL.prototype.ARRAY_BUFFER=34962;GL.prototype.ARRAY_BUFFER_BINDING=34964;WebGL2RenderingContext=GL;
    installAllocationObserver({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true,captureNativeFailures:true});
    const gl=new GL(),o=window.__allocation,data=new Float32Array(8);
    assert.equal(gl.bufferData(34962,data,35044),returned);assert.equal(nativeCalls.length,1);
    assert.equal(nativeCalls[0].receiver,gl);assert.equal(nativeCalls[0].args[1],data);checks+=4;
    const first=o.peek(gl);assert(first.sampled);assert.equal(first.bytes,32);assert.equal(first.defaultFramebuffer,1200);assert.equal(first.gpuPeak,1232);checks+=4;
    gl.drawingBufferWidth=20;gl.bufferData(34962,data,35044);const resized=o.peek(gl);
    assert.equal(resized.defaultFramebuffer,2400);assert.equal(resized.pendingDefaultFramebuffer,1200);assert.equal(resized.gpuPeak,3664);checks+=3;
    gl.drawingBufferWidth=30;gl.lost=true;const queryCount=queries,retained=o.peek(gl);
    assert.equal(retained.sampledDimensions,'20:10');assert.equal(retained.gpuPeak,3664);assert.equal(queries,queryCount);checks+=3;
    retained.nativeEvents[0].bytes=999999;retained.bufferSlots[0].bytes=999999;
    assert.equal(o.peek(gl).nativeEvents[0].bytes,32);assert.equal(o.peek(gl).bufferSlots[0].bytes,32);checks+=2;
    gl.fail=true;assert.throws(()=>gl.bufferData(34962,data,35044),e=>e===error);
    assert.equal(o.peek(gl).nativeFailures.length,1);assert.equal(o.peek(gl).bytes,32);assert.equal(o.peek(gl).gpuPeak,3664);assert.equal(queries,queryCount);checks+=5;o.restore();
  });
  console.log(`CONTEXT-OBSERVER CPU OK (${checks} assertions); default-only startup/unsampled resize/native coverage UNRUN`);
}
await contextObserverControls();
async function defaultSurfaceControls(){
  let checks=0,epochChecks=0,handleChecks=0;
  async function fixture(run,{inherited=false,epochs=false,handles=false,ordinary=false}={}){
    await globals({window:{},document:{},HTMLCanvasElement:undefined,WebGLRenderingContext:undefined,WebGL2RenderingContext:undefined},async()=>{
      let queries=0,conversions=0;const calls=[],registrations=[],removals=[],nativeError=new Error('native setter/finish'),returned={native:true};
      window.addEventListener=function(type,fn,options){assert.equal(this,window);registrations.push({type,fn,options,removed:false});};
      window.removeEventListener=function(type,fn,options){assert.equal(this,window);removals.push({type,fn,options});
        const r=registrations.find(r=>r.type===type&&r.fn===fn);if(r)r.removed=true;};
      document.defaultView=window;
      class GL{
        constructor(){this.drawingBufferWidth=10;this.drawingBufferHeight=10;this.buffer={};}
        getContextAttributes(){queries++;if(this.queryError)throw nativeError;return this.nullAttrs?null:{depth:true,stencil:false};}
        isContextLost(){return !!this.lost;}
        getParameter(){queries++;return this.buffer;}
        bufferData(...args){calls.push(['bufferData',this,args]);return returned;}
        drawArrays(...args){calls.push(['drawArrays',this,args]);return returned;}
        deleteBuffer(...args){calls.push(['deleteBuffer',this,args]);return returned;}
        finish(){calls.push(['finish',this]);if(this.finishError)throw nativeError;return returned;}
      }
      for(const name of ['bufferSubData','texSubImage2D','texSubImage3D'])GL.prototype[name]=function(...args){
        calls.push([name,this,args]);if(this.uploadError)throw nativeError;return returned;};
      GL.prototype.ARRAY_BUFFER=34962;GL.prototype.ARRAY_BUFFER_BINDING=34964;
      class Base extends EventTarget{
        constructor(){super();this.w=10;this.h=10;this.gl=new GL();this.ownerDocument=document;this.isConnected=true;}
        getContext(...args){calls.push(['getContext',this,args]);return this.gl;}
      }
      for(const name of ['width','height'])Object.defineProperty(Base.prototype,name,{
        configurable:true,enumerable:true,get(){return name==='width'?this.w:this.h;},
        set(value){calls.push([name,this,value]);if(this.setterError)throw nativeError;
          const applied=Number(value);if(name==='width')this.w=applied;else this.h=applied;
          if(!this.deferred){this.gl.drawingBufferWidth=this.w;this.gl.drawingBufferHeight=this.h;}return returned;},
      });
      class FieldCanvas extends Base{}
      if(!inherited)for(const name of ['width','height'])Object.defineProperty(FieldCanvas.prototype,name,Object.getOwnPropertyDescriptor(Base.prototype,name));
      HTMLCanvasElement=FieldCanvas;WebGL2RenderingContext=GL;
      const target=new FieldCanvas();document.getElementById=()=>target;
      const descriptors=Object.fromEntries(['width','height','getContext'].map(k=>[k,Object.getOwnPropertyDescriptor(FieldCanvas.prototype,k)]));
      installAllocationObserver({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),
        nativeJournal:true,captureNativeFailures:true,captureDefaultSurfaces:true});
      const allocation=window.__allocation,observer=installFieldContextObserver({enabled:true,observeSurfaces:true,observeEpochs:epochs,enableContextHandles:handles}),gl=target.gl;
      const emitEpoch=(type,overrides={})=>{const event={type,target,isTrusted:true,eventPhase:1,currentTarget:window,...overrides};
        for(const r of registrations.filter(r=>!r.removed&&r.type===type))r.fn(event);return event;};
      try{await run({target,gl,FieldCanvas,allocation,observer,calls,nativeError,returned,descriptors,
        registrations,removals,emitEpoch,
        queries:()=>queries,conversions:()=>conversions,value:{valueOf(){conversions++;return 20;}}});}
      finally{observer.restore();allocation.restore();}
      for(const name of Object.keys(descriptors))assert.deepEqual(Object.getOwnPropertyDescriptor(FieldCanvas.prototype,name),descriptors[name]);
      if(handles||ordinary)handleChecks+=3;else if(epochs)epochChecks+=3;else checks+=3;
    });
  }
  for(const inherited of [false,true])await fixture(f=>{
    const {target,gl,allocation,observer,calls,value}=f;
    target.width=10;assert.equal(f.queries(),0);checks++;
    const other=new f.FieldCanvas();other.width=42;assert.equal(f.queries(),0);checks++;
    assert.equal(target.getContext('webgl2'),gl);const first=allocation.peek(gl);
    assert.equal(first.bytes,0);assert.equal(first.defaultFramebuffer,1200);assert.equal(first.gpuPeak,1200);checks+=4;
    target.getContext('webgl2');assert.equal(allocation.peek(gl).defaultEvents.length,1);checks++;
    const get=Object.getOwnPropertyDescriptor(f.FieldCanvas.prototype,'width').get;
    assert.equal(Reflect.apply(get,target,[]),10);checks++;
    target.width=value;assert.equal(f.conversions(),1);assert.equal(calls.filter(c=>c[0]==='width'&&c[1]===target).length,2);checks+=2;
    target.height=30;target.width=20;
    const grown=allocation.peek(gl);assert.equal(grown.pendingDefaultFramebuffer,10800);assert.equal(grown.gpuPeak,18000);checks+=2;
    assert.equal(gl.bufferData(34962,new Float32Array(8),35044),f.returned);
    const allocated=allocation.peek(gl);assert.equal(allocated.bytes,32);assert.equal(allocated.gpuPeak,18032);checks+=3;
    assert.deepEqual(defaultSurfaceHistoryErrors(allocated),[]);checks++;
    assert.equal(gl.finish(),f.returned);const completed=allocation.peek(gl);
    assert.equal(completed.pendingDefaultFramebuffer,0);assert.equal(completed.gpuCurrent,7232);assert.equal(completed.gpuPeak,18032);
    assert.deepEqual(defaultSurfaceHistoryErrors(completed),[]);checks+=5;
    const mutations=[r=>r.defaultEvents.shift(),r=>r.defaultEvents[1].sequence++,r=>r.defaultEvents[2].generation=false,
      r=>r.defaultEvents[2].pending=0,r=>r.defaultEvents[2].current--,r=>r.defaultEvents[2].peak--,
      r=>r.defaultEvents[2].framebuffer++,r=>r.defaultEvents[2].applied[0]++,r=>r.defaultEvents[2].attributes.depth=false,
      r=>r.defaultEvents.find(e=>e.kind==='finish').nativeEventsEnd=0,r=>r.nativeEvents.find(e=>e.operation==='finish').call='forged',
      r=>r.unknown.push('lost'),r=>r.observerFailureCount=1,r=>r.defaultEvents[1].boundary='height-after',
      r=>r.gpuPeak--,r=>r.gpuCurrent++,r=>r.pendingDefaultFramebuffer++,r=>r.defaultSurfaceCapture=false,
      r=>{const at=r.defaultEvents.findIndex(e=>e.kind==='finish');r.defaultEvents=r.defaultEvents.slice(at);r.defaultEvents.forEach((e,i)=>e.sequence=i+1);},
      r=>r.nativeFailureCapture=false,r=>r.nativeFailureCount=1,r=>r.nativeFailures.push({call:'finish'}),
      r=>r.nativeEvents.push({...r.nativeEvents.at(-1),sequence:r.nativeEvents.length+1,callOrdinal:99}),
      r=>{r.nativeEvents.push({...r.nativeEvents.at(-1),sequence:r.nativeEvents.length+1,callOrdinal:99});r.defaultEvents.at(-1).nativeEventsEnd=r.nativeEvents.length;},
      r=>{let peak=0;for(const row of r.defaultEvents)if(row.kind==='sample'){
        if(row.apiBytes)row.apiBytes+=64;row.current=row.apiBytes+row.framebuffer+row.pending;row.peak=peak=Math.max(peak,row.current);
      }r.gpuCurrent=r.defaultEvents.at(-1).current;r.gpuPeak=peak;},
      r=>{const index=r.nativeEvents.findIndex(e=>e.operation==='reserve');
        r.defaultEvents=r.defaultEvents.filter(e=>!(e.kind==='sample'&&e.nativeEventsEnd===index&&e.apiBytes===r.nativeEvents[index].transient));
        r.defaultEvents.forEach((e,i)=>e.sequence=i+1);},
      r=>r.nativeEvents[0].bytes++,r=>r.defaultEvents.at(-1).nativeCallOrdinal=999999];
    for(const mutate of mutations){const bad=structuredClone(completed);mutate(bad);assert(defaultSurfaceHistoryErrors(bad).length);}checks+=mutations.length;
    completed.defaultEvents[0].apiBytes=999;assert.equal(allocation.peek(gl).defaultEvents[0].apiBytes,0);checks++;
    assert.equal(observer.read().observerFailureCount,0);assert.equal(observer.read().overflow,false);checks+=2;
  },{inherited});
  await fixture(f=>{
    f.target.getContext('webgl2');f.target.width=20;const before=f.allocation.peek(f.gl);
    f.target.setterError=true;assert.throws(()=>{f.target.height=20;},e=>e===f.nativeError);
    assert.equal(f.allocation.peek(f.gl).pendingDefaultFramebuffer,before.pendingDefaultFramebuffer);
    assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);checks+=3;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');const data=new Float32Array(8);
    f.gl.bufferData(34962,data,35044);f.gl.bufferData(34962,data,35044);
    const r=f.allocation.peek(f.gl);assert.equal(r.bytes,32);assert.equal(r.peak,64);assert.equal(r.gpuPeak,1264);
    assert.deepEqual(defaultSurfaceHistoryErrors(r),[]);checks+=4;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');f.target.width=20;f.gl.finishError=true;
    assert.throws(()=>f.gl.finish(),e=>e===f.nativeError);const r=f.allocation.peek(f.gl);
    assert.equal(r.pendingDefaultFramebuffer,1200);assert.equal(r.defaultEvents.filter(e=>e.kind==='finish').length,0);
    assert.equal(r.nativeFailures.length,1);assert(defaultSurfaceHistoryErrors(r).length);checks+=5;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');f.target.deferred=true;f.target.width=20;
    assert(f.allocation.peek(f.gl).unknown.includes('default surface boundary failed'));assert.equal(f.observer.read().observerFailureCount,1);
    assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);checks+=3;
  });
  for(const mode of ['queryError','nullAttrs'])await fixture(f=>{
    f.gl[mode]=true;f.gl.lost=mode==='nullAttrs';assert.equal(f.target.getContext('webgl2'),f.gl);
    assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);checks+=2;
    if(mode==='nullAttrs'){
      const before=f.queries();f.target.width=20;f.target.height=20;f.gl.nullAttrs=false;f.gl.lost=false;f.target.width=30;
      assert.equal(f.queries(),before);assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);checks+=2;
    }
  });
  await fixture(f=>{
    f.target.getContext('webgl2');const before=f.queries();f.target.dispatchEvent(new Event('webglcontextlost'));
    f.target.width=20;f.target.height=20;f.target.dispatchEvent(new Event('webglcontextrestored'));f.target.width=30;
    assert.equal(f.queries(),before);assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);
    assert(f.allocation.peek(f.gl).unknown.includes('default surface loss/restoration epoch unproved'));checks+=3;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');f.target.width=20;f.gl.nullAttrs=true;f.gl.lost=true;
    f.gl.finish();const r=f.allocation.peek(f.gl);
    assert.equal(r.pendingDefaultFramebuffer,1200);assert.equal(r.defaultEvents.filter(e=>e.kind==='finish').length,0);
    assert(defaultSurfaceHistoryErrors(r).length);checks+=3;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');f.gl.drawingBufferWidth=99;
    f.gl.bufferData(34962,new Float32Array(8),35044);
    assert(f.allocation.peek(f.gl).unknown.includes('unobserved default surface dimension change'));
    assert(defaultSurfaceHistoryErrors(f.allocation.peek(f.gl)).length);checks+=2;
  });
  await fixture(f=>{
    f.target.getContext('webgl2');
    const descriptor=Object.getOwnPropertyDescriptor(f.FieldCanvas.prototype,'width');
    assert.equal(Reflect.apply(descriptor.set,f.target,[10]),f.returned);checks++;
    const foreign={...descriptor,enumerable:!descriptor.enumerable};
    Object.defineProperty(f.FieldCanvas.prototype,'width',foreign);
    assert.throws(()=>f.observer.restore(),/foreign canvas width descriptor/);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.FieldCanvas.prototype,'width'),foreign);checks+=2;
    Object.defineProperty(f.FieldCanvas.prototype,'width',descriptor);
  });
  await fixture(f=>{
    f.target.getContext('webgl2');for(let i=0;i<8200;i++)f.target.width=10;
    const r=f.allocation.peek(f.gl);assert.equal(r.defaultEvents.length,16384);
    assert(r.unknown.includes('default surface journal limit'));assert(defaultSurfaceHistoryErrors(r).length);checks+=3;
  });
  await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    class FieldCanvas{getContext(){return{};}}
    for(const name of ['width','height'])Object.defineProperty(FieldCanvas.prototype,name,{get(){return 10;},set(){},configurable:true});
    HTMLCanvasElement=FieldCanvas;
    const original=Object.getOwnPropertyDescriptors(FieldCanvas.prototype);
    window.__allocation={peek(){},surfaceBoundary(){},surfaceFailure(){},defaultSurfaceCapture:true};
    Object.preventExtensions(window);
    assert.throws(()=>installFieldContextObserver({enabled:true,observeSurfaces:true}),TypeError);
    assert.deepEqual(Object.getOwnPropertyDescriptors(FieldCanvas.prototype),original);checks+=2;
  });
  await globals({window:{addEventListener(){throw Error('unexpected registration');}},HTMLCanvasElement:undefined},()=>{
    const o=installFieldContextObserver({observeEpochs:true});assert.equal(o.read().enabled,false);o.restore();epochChecks++;
    assert.throws(()=>installFieldContextObserver({enabled:true,observeEpochs:true}),/epochs require surface capture/);epochChecks++;
  });
  for(const inherited of [false,true])await fixture(f=>{
    assert.deepEqual(f.registrations.map(r=>r.type),['webglcontextlost','webglcontextrestored']);
    assert(f.registrations.every(r=>r.options.capture===true&&r.options.passive===true));epochChecks+=2;
    f.target.getContext('webgl2');const before=f.queries();
    const event=f.emitEpoch('webglcontextlost');event.currentTarget=f.target;
    f.emitEpoch('webglcontextrestored');const r=f.observer.read();
    assert.equal(f.queries(),before);assert.equal(r.epochs[0].windowTarget,true);
    assert.equal(r.epochs[0].retained.nativeEvents,undefined);assert.deepEqual(fieldEpochObservationErrors(r),[]);epochChecks+=4;
    const mutations=[r=>r.epochs[0].trusted=false,r=>r.epochs[0].phase=2,r=>r.epochs[0].targetBound=false,
      r=>r.epochs[0].connected=false,r=>r.epochs[0].documentOwned=false,r=>r.epochs[0].windowTarget=false,
      r=>r.epochs[1].context=99,r=>r.epochs[1].event='webglcontextlost',r=>r.epochs[1].sequence=9,
      r=>r.epochs[1].retained.calls.drawArrays=1,r=>r.epochs[1].retained.nativeFailureCount++,
      r=>r.epochs[0].retained.nativeEventsEnd=100,r=>r.setterAttempts++,r=>r.epochs[1].retained.unknown.push('foreign'),
      r=>r.overflow=true,r=>r.observerFailureCount=1,r=>r.epochCapture=false,r=>r.epochs.push(r.epochs[1]),
      r=>r.states.push(r.states[0]),r=>r.states[0].retained.gpuPeak++,r=>r.epochs[0].retained.context=999,
      r=>{for(const s of [r.epochs[0].retained,r.epochs[1].retained,r.states[0].retained])for(const k of ['gpuCurrent','gpuPeak','defaultFramebuffer','pendingDefaultFramebuffer'])s[k]=0;},
      r=>{r.states[0].retained.defaultEvents=[];for(const s of [r.epochs[0].retained,r.epochs[1].retained])s.surfaceEventsEnd=0;},
      r=>r.restored=true,r=>r.states[0].retained.epochUploadMethods.pop(),
      r=>r.states[0].retained.nativeFailures.push({sequence:1,call:'drawArrays',completedCallOrdinal:0,error:{type:'string',value:'failed'}})];
    for(const mutate of mutations){const bad=structuredClone(r);mutate(bad);assert(fieldEpochObservationErrors(bad).length);}epochChecks+=mutations.length;
    r.epochs[0].retained.calls.forged=1;assert.equal(f.observer.read().epochs[0].retained.calls.forged,undefined);epochChecks++;
    f.observer.restore();f.observer.restore();assert.equal(f.removals.length,2);
    assert(f.removals.every((x,i)=>x.fn===f.registrations[i].fn&&x.options===f.registrations[i].options));
    assert.equal(f.observer.read().restored,true);epochChecks+=3;
  },{inherited,epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');
    f.gl.drawArrays(4,0,3);f.emitEpoch('webglcontextrestored');const r=f.observer.read();
    assert.equal(r.epochs[0].retained.calls.drawArrays,undefined);assert.equal(r.epochs[1].retained.calls.drawArrays,1);
    assert(fieldEpochObservationErrors(r).length);epochChecks+=3;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');f.emitEpoch('webglcontextrestored');
    const before=f.queries();f.target.width=20;assert.equal(f.queries(),before);
    assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks+=2;
  },{epochs:true});
  await fixture(f=>{
    f.emitEpoch('webglcontextlost');assert.equal(f.calls.length,0);assert.equal(f.queries(),0);
    f.target.getContext('webgl2');f.emitEpoch('webglcontextrestored');assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks+=3;
  },{epochs:true});
  for(const overrides of [{isTrusted:false},{target:{}},{eventPhase:2}])await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost',overrides);f.emitEpoch('webglcontextrestored');
    assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks++;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.target.isConnected=false;f.emitEpoch('webglcontextlost');f.emitEpoch('webglcontextrestored');
    assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks++;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.gl.bufferData(34962,new Float32Array(8),35044);f.emitEpoch('webglcontextlost');
    const before=f.queries();f.gl.deleteBuffer(f.gl.buffer);f.emitEpoch('webglcontextrestored');const r=f.observer.read();
    assert.equal(f.queries(),before);assert.equal(r.states[0].retained.pendingDeleteBytes,32);
    assert.deepEqual(fieldEpochObservationErrors(r),[]);epochChecks+=3;
  },{epochs:true});
  for(const name of ['bufferSubData','texSubImage2D','texSubImage3D'])await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');const args=[1,2,new Uint8Array(4)],before=f.queries();
    assert.equal(Reflect.apply(f.gl[name],f.gl,args),f.returned);assert.equal(f.queries(),before);
    const actual=f.calls.find(c=>c[0]===name);assert.equal(actual[1],f.gl);assert.equal(actual[2][2],args[2]);
    f.emitEpoch('webglcontextrestored');assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks+=5;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');f.gl.uploadError=true;
    assert.throws(()=>f.gl.bufferSubData(1,2,3),e=>e===f.nativeError);f.emitEpoch('webglcontextrestored');
    assert(fieldEpochObservationErrors(f.observer.read()).length);epochChecks+=2;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');f.emitEpoch('webglcontextrestored');
    const descriptor=Object.getOwnPropertyDescriptor(f.FieldCanvas.prototype,'width');
    Object.defineProperty(f.FieldCanvas.prototype,'width',{...descriptor,set(value){this.w=value;}});f.target.width=99;
    assert(fieldEpochObservationErrors(f.observer.read()).length);assert.equal(f.target.width,99);epochChecks+=2;
    Object.defineProperty(f.FieldCanvas.prototype,'width',descriptor);
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');const proto=Object.getPrototypeOf(f.gl),descriptor=Object.getOwnPropertyDescriptor(proto,'drawArrays');
    let foreign=0;Object.defineProperty(proto,'drawArrays',{...descriptor,value(){foreign++;}});f.gl.drawArrays();
    f.emitEpoch('webglcontextrestored');assert(fieldEpochObservationErrors(f.observer.read()).length);assert.equal(foreign,1);epochChecks+=2;
    Object.defineProperty(proto,'drawArrays',descriptor);
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');let foreign=0;
    Object.defineProperty(f.gl,'drawArrays',{value(){foreign++;},configurable:true});f.gl.drawArrays();f.emitEpoch('webglcontextrestored');
    assert(fieldEpochObservationErrors(f.observer.read()).length);assert.equal(foreign,1);epochChecks+=2;
    delete f.gl.drawArrays;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');let getters=0;
    Object.defineProperty(f.gl,'drawArrays',{get(){getters++;throw Error('foreign getter invoked');},configurable:true});
    f.emitEpoch('webglcontextrestored');assert(fieldEpochObservationErrors(f.observer.read()).length);assert.equal(getters,0);epochChecks+=2;
    delete f.gl.drawArrays;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');f.emitEpoch('webglcontextrestored');
    Object.defineProperty(f.target,'width',{get(){return 99;},set(){},configurable:true});
    assert(fieldEpochObservationErrors(f.observer.read()).length);assert.equal(f.target.width,99);epochChecks+=2;delete f.target.width;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');f.emitEpoch('webglcontextlost');f.emitEpoch('webglcontextrestored');f.observer.restore();f.target.width=99;
    const r=f.observer.read();assert.equal(r.restored,true);assert.equal(f.target.width,99);assert(fieldEpochObservationErrors(r).length);epochChecks+=3;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');document.getElementById=()=>{throw Error('event observation getter failed');};
    assert.doesNotThrow(()=>f.emitEpoch('webglcontextlost'));assert(f.observer.read().observerFailureCount>0);epochChecks+=2;
  },{epochs:true});
  await fixture(f=>{
    f.target.getContext('webgl2');for(let i=0;i<9;i++)f.emitEpoch('webglcontextlost');const r=f.observer.read();
    assert.equal(r.epochs.length,8);assert(r.overflow);assert(fieldEpochObservationErrors(r).length);epochChecks+=3;
  },{epochs:true});
  for(const fault of ['webglcontextlost','webglcontextrestored'])await globals({window:{},document:{},HTMLCanvasElement:undefined},()=>{
    class FieldCanvas{getContext(){return{};}}
    for(const name of ['width','height'])Object.defineProperty(FieldCanvas.prototype,name,{get(){return 10;},set(){},configurable:true});
    HTMLCanvasElement=FieldCanvas;const before=Object.getOwnPropertyDescriptors(FieldCanvas.prototype),listeners=new Map(),error=new Error('registration failure');
    window.__allocation={peek(){},surfaceBoundary(){},surfaceFailure(){},assertOwned(){return true;},defaultSurfaceCapture:true};
    Object.defineProperty(window,'__fieldContextObservation',{value:{prior:true},writable:true,enumerable:true,configurable:true});
    const prior=Object.getOwnPropertyDescriptor(window,'__fieldContextObservation');
    window.addEventListener=(type,fn,options)=>{listeners.set(type,{fn,options});if(type===fault)throw error;};
    window.removeEventListener=(type,fn,options)=>{const r=listeners.get(type);assert.equal(r?.fn,fn);assert.equal(r.options,options);listeners.delete(type);};
    assert.throws(()=>installFieldContextObserver({enabled:true,observeSurfaces:true,observeEpochs:true}),e=>e===error);
    assert.equal(listeners.size,0);assert.deepEqual(Object.getOwnPropertyDescriptors(FieldCanvas.prototype),before);
    assert.deepEqual(Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),prior);epochChecks+=4;
  });
  for(const inherited of [false,true])await fixture(f=>{
    assert.throws(()=>f.observer.context(1),/registered context/);handleChecks++;
    f.target.getContext('webgl2');const before=f.queries(),calls=f.calls.length;
    assert.equal(f.observer.context(1),f.gl);assert.equal(f.queries(),before);assert.equal(f.calls.length,calls);handleChecks+=3;
    for(const id of [undefined,null,0,-1,2,1.5,'1',NaN]){assert.throws(()=>f.observer.context(id),/registered context/);handleChecks++;}
    const array=new Float32Array(12),oracle=array.slice(),scene={traverse(fn){fn({type:'Mesh',visible:true,
      geometry:{attributes:{position:{array}},index:null,morphAttributes:{}},material:null});}};
    const scope={__game:{scene,post:{renderer:{getContext(){throw Error('unexpected context discovery');}}},game:{}},__allocation:f.allocation,
      __sceneTerrainPartition:{retainedArrays:[{array,owner:'same'},{array:oracle,owner:'oracle'}]},innerWidth:10,innerHeight:10,devicePixelRatio:1};
    f.gl.getError=()=>{throw Error('unexpected native health query');};
    const s=sampleSceneAllocations(scope,{retainedContext:f.observer.context(1)});
    assert.equal(s.declaredArrayBytes,96);assert.equal(s.retainedTerrainArrayBytes,48);assert.equal(s.glError,null);
    assert.equal(s.conservativeReservation,null);assert.equal(s.gpuReservation,1200);assert.equal(f.queries(),before);handleChecks+=6;
    assert.throws(()=>sampleSceneAllocations(scope,{retainedContext:new WebGL2RenderingContext()}),/registered retained context/);handleChecks++;
    f.gl.lost=true;assert.equal(f.observer.context(1),f.gl);assert.equal(f.queries(),before);handleChecks+=2;
    const descriptor=Object.getOwnPropertyDescriptor(f.FieldCanvas.prototype,'getContext');
    Object.defineProperty(f.FieldCanvas.prototype,'getContext',{...descriptor,value(){return f.gl;}});
    assert.throws(()=>f.observer.context(1),/ownership changed/);handleChecks++;
    Object.defineProperty(f.FieldCanvas.prototype,'getContext',descriptor);
    f.observer.restore();assert.throws(()=>f.observer.context(1),/inactive/);handleChecks++;
  },{inherited,epochs:true,handles:true});
  await fixture(f=>{f.target.getContext('webgl2');assert.throws(()=>f.observer.context(1),/inactive/);handleChecks++;},{ordinary:true});
  console.log(`ORDINARY-OBSERVATION CPU OK (${handleChecks} assertions); retained context/CPU inventory only; native entry UNRUN`);
  console.log(`DEFAULT-SURFACE CPU OK (${checks} assertions); native synchronous setter coverage/restoration epochs UNRUN`);
  console.log(`FIELD-EPOCH CPU OK (${epochChecks} assertions); modeled capture dispatch only; native propagation/trust/restoration behavior UNRUN`);
}
await defaultSurfaceControls();
const checks=[
  ['pending-gpu-import',async a=>{
    let release,calls=0;const stats={},stop={stopped:false,check(){return !this.stopped;}},renderer={getContext(){calls++;return {};}};
    const post={startFromTier(){calls++;}},loading=new Promise(r=>{release=r;});
    const task=a.detect(renderer,post,stats,stop,()=>loading);stop.stopped=true;
    release({getGPUTier(){calls++;return {tier:2};}});assert.equal(await task,null);assert.equal(calls,0);assert.deepEqual(stats,{});
    stop.stopped=false;assert.equal((await a.detect(renderer,post,stats,stop,async()=>({getGPUTier:()=>({tier:2,gpu:'controlled'})}))).tier,2);
    assert.equal(calls,2);assert.deepEqual(stats,{gpuTier:2,gpu:'controlled'});
    let done;const pending=a.detect(renderer,post,stats,stop,async()=>({getGPUTier:()=>new Promise(r=>{done=r;})}));
    await Promise.resolve();stop.stopped=true;done({tier:1});assert.equal(await pending,null);assert.equal(calls,3);assert.equal(stats.gpuTier,2);
  }],
  ['qualified-members',()=>{
    assert.equal(Object.keys(QUALIFIED_RUNTIME_MEMBERS).length,12);
    for(const [name,digest]of Object.entries(QUALIFIED_RUNTIME_MEMBERS))assert.equal(createHash('sha256').update(fs.readFileSync(base+name)).digest('hex'),digest,name);
    const manifest=JSON.parse(fs.readFileSync(base+'soldier-hybrid.json')),layout=new AtlasLayout(manifest);let bytes=0;
    for(const page of layout.tiers.close.pages){const b=fs.readFileSync(base+page.file);assert.equal(b.length,page.bytes);
      if(page.encoding==='astc4x4')bytes+=parseAtlasAstc(b,page).bytes;else{assert.equal(b.readUInt32BE(16),page.w);assert.equal(b.readUInt32BE(20),page.h);bytes+=pageMipBytes(page.w,page.h).bytes;}}
    assert.equal(bytes,QUALIFIED_HYBRID.closeGpuBytes);
  }],
  ['profile-shape',a=>{assert.equal(a.profile('?battle=shiloh'),null);const p=a.profile('?resources=compact-v1');assert.ok(p);assert.equal(p.pixelBytes,3639218);
    for(const search of ['?resources=','?resources=other','?resources=compact-v1&resources=compact-v1','?resources=compact-v1&tune','?resources=compact-v1&sandbox'])assert.throws(()=>a.profile(search));}],
  ['metadata-only',async a=>{const urls=[];const p=await a.prepare('?resources=compact-v1',{fetcher:async url=>{urls.push(url);return new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));}});
    assert.ok(p);assert.equal(p.name,'compact-v1');assert.equal(urls.length,3);assert.ok(urls.every(u=>u.endsWith('.json')));assert.ok(Object.isFrozen(p.csRuntimeClose.manifest));
    assert.equal(await a.prepare('',{fetcher:()=>{throw Error('default unexpectedly fetched');}}),null);
  }],
  ['metadata-bound',async a=>{for(const response of [()=>new Response('{}',{status:404}),()=>new Response('{}',{headers:{'content-length':String(2**21)}}),
    ()=>new Response(' '.repeat(2**20+1)),()=>new Response('{')])await assert.rejects(a.prepare('?resources=compact-v1',{fetcher:async()=>response()}));}],
  ['reload-dialog',async()=>globals({document:dom()},()=>{
    let reload=0;const dialog=showGraphicsReload({reload:()=>reload++});assert.equal(dialog.getAttribute('role'),'alertdialog');assert.equal(dialog.getAttribute('aria-modal'),'true');
    assert.equal(dialog.children[0].getAttribute('tabindex'),'0');assert.equal(dialog.children[0].getAttribute('role'),'region');
    assert.equal(document.getElementById('battle').inert,true);assert.equal(document.activeElement.tagName,'button');
    const event=new Event('cancel',{cancelable:true});dialog.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(dialog.open,true);
    document.activeElement.dispatchEvent(new Event('click'));assert.equal(reload,1);assert.equal(showGraphicsReload(),dialog);
  })],
  ['post-stop',async a=>globals({window:{devicePixelRatio:1}},()=>{
    const f=renderer(),p=new a.Post(f.driver,{resourceLifetime:true,diagnosticPixelBytes:3639218});p.stopForReload();assert.equal(p.stoppedForReload,true);const n=f.events.length;
    p.setMode('low');p.setSize(100,100);p.startFromTier(3);p._apply();p._alloc();p._pass({},{});p.render({},{});p.beginSoldierView({},1);p.updateSoldierView({},1);p.govern(.1,10);
    assert.equal(f.events.length,n);assert.equal(p.stoppedForReload,true);
  })],
  ['post-falsy',()=>{const p=Object.create(Post.prototype);p.endSoldierView=()=>{throw 0;};for(let i=0;i<2;i++){let failed=false;try{p.stopForReload();}catch(e){failed=true;assert.equal(e,0);}assert.equal(failed,true);}}],
  ['input-stop',a=>{const calls=[],p=Object.create(a.Input.prototype);Object.assign(p,{longPress:0,drag:{},targeting:{},pointers:new Map([[1,{}]]),panSamples:[1],box:{hidden:false},
    rts:{keys:new Set(['w']),inertia:{}},arrows:{clearPreview(){calls.push('preview');}},hud:{setGhostLabel(){},setTargeting(){}},soldierView:{end(){calls.push('lens');}}});
    p.stopForReload();assert.equal(p.pointers.size,0);assert.equal(p.rts.keys.size,0);assert.equal(p.box.hidden,true);assert.equal(p.rts.inertia,null);
    for(const method of ['down','touchDown','move','pinchMove','up','key','beginTargeting','chooseDelegate','targetingKey','orderPreviewAt'])p[method]();
    assert.ok(calls.includes('lens'));assert.equal(p.stoppedForReload,true);
  }],
  ['input-falsy-reentry',()=>{for(const mode of ['cancel','reenter','keys']){const reenter=mode==='reenter',p=Object.create(Input.prototype);let lens=false;
    Object.assign(p,{longPress:0,pointers:new Map([[1,{}]]),panSamples:[1],box:{hidden:false},rts:{keys:new Set(['w']),inertia:{}},
      arrows:{clearPreview(){}},hud:{setGhostLabel(){}},soldierView:{end(){lens=true;}},cancel(){if(reenter)p.stopForReload();else if(mode==='cancel')throw 0;}});
    if(mode==='keys')p.rts.keys.clear=()=>{throw 0;};
    let first;try{p.stopForReload();assert.fail('input must retain cleanup failure');}catch(error){first=error;if(reenter)assert.match(error.message,/reentrant/);else assert.equal(error,0);}
    assert.equal(lens,true);assert.equal(p.pointers.size,0);assert.equal(p.box.hidden,true);
    let again=false;try{p.stopForReload();}catch(error){again=true;assert.equal(error,first);}assert.equal(again,true);
  }}],
  ['mixer-locked',async()=>{const m=new Mixer(),pending=m.load('cannon');assert.equal(m.waitingLoads.size,1);await m.stopForReload();assert.equal(await pending,null);
    assert.equal(m.unlock(),null);let called=false;m.onUnlock(()=>{called=true;});assert.equal(called,false);assert.equal(m.waiting.size,0);assert.equal(m.pending.size,0);assert.equal(await m.load('cannon'),null);
  }],
  ['mixer-voices',async()=>{const m=new Mixer(),events=[];m.ctx={currentTime:0,close(){events.push('close');return Promise.resolve();}};
    for(const bus of BUSES)m.buses[bus]={gain:{value:1,cancelScheduledValues(){events.push('cancel:'+bus);},setValueAtTime(v){events.push('zero:'+v);},setTargetAtTime(){throw Error('raised stopped bus');}}};
    m.voices.add({loop:true,stop(){events.push('loop');}});m.voices.add({stop(){events.push('shot');}});await m.stopForReload();
    for(const bus of Object.values(m.buses))assert.equal(bus.gain.value,0);assert.ok(events.includes('loop')&&events.includes('shot'));
    m.applyLevels();m.duck('ambient',1);assert.equal(m.play('cannon'),null);assert.equal(m.level('music'),0);assert.equal(m.unlocked,false);
  }],
  ['mixer-falsy',async a=>{const m=new a.Mixer();m.voices.add({stop(){throw 0;}});let closed=false;m.ctx={close(){closed=true;return Promise.resolve();}};
    let failed=false;try{m.stopForReload();}catch(error){failed=true;assert.equal(error,0);}assert.equal(failed,true);assert.equal(closed,true);await rejectsFalsy(m.stopForReload(),0);
  }],
  ['mixer-reentry',async()=>{const m=new Mixer();let inner,release,done=false;const gate=new Promise(r=>{release=r;});
    m.ctx={close:()=>gate};m.voices.add({stop(){inner=m.stopForReload();}});const outer=m.stopForReload();assert.equal(inner,outer);
    outer.then(()=>{done=true;});await turn();assert.equal(done,false);release();await outer;assert.equal(done,true);
  }],
  ['mixer-late-fetch',async()=>{let release,reads=0;const gate=new Promise(r=>{release=r;});await globals({fetch:()=>gate},async()=>{
    const m=new Mixer();m.ctx={close:()=>Promise.resolve()};const pending=m.load('cannon');await turn();await m.stopForReload();
    release({ok:true,arrayBuffer(){reads++;return new ArrayBuffer(1);}});assert.equal(await pending,null);assert.equal(reads,0);assert.equal(m.buffers.size,0);
  });}],
  ['mixer-late-decode',async()=>{let release,started=false;await globals({fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})},async()=>{
    const m=new Mixer();m.ctx={close:()=>Promise.resolve(),decodeAudioData(bytes,ok){started=true;release=()=>ok({duration:1});}};
    const pending=m.load('cannon');await turn();assert.equal(started,true);await m.stopForReload();release();assert.equal(await pending,null);assert.equal(m.buffers.size,0);
  });}],
  ['effects-falsy',async a=>{const e=new a.Effects(new Scene(),{},{});e.clearMoments=()=>{throw 0;};let closed=false;e.sound.ctx={close(){closed=true;return Promise.resolve();}};
    let failed=false;try{e.stopForReload();}catch(error){failed=true;assert.equal(error,0);}assert.equal(failed,true);assert.equal(closed,true);await rejectsFalsy(e.stopForReload(),0);
  }],
  ['effects-queued',async()=>{const timers=[];await globals({setTimeout:fn=>{timers.push(fn);return timers.length;}},async()=>{
    let played=0,burst=0;const e=new Effects(new Scene(),{}, {target:{x:0,z:0},dist:10});e.sound.zzfx=()=>{played++;};
    e.playVolley({x:0,z:0});e.director={mixer:{has:()=>true},cannon(){},burst(){burst++;},stop(){}};
    e.boom({x:0,z:0,facing:0},{x:20,z:20,halfFront:10},false);const before=played;
    await e.stopForReload();for(const fn of timers)fn();e.setSound(true);e.playBoom();e.volley();e.boom();e.shellBurst();
    assert.equal(played,before);assert.equal(burst,0);assert.equal(e.sound.enabled,false);assert.equal(e.xFactor({alive:true}),false);
  });}],
  ['streamed-cleanup',()=>{const text=execFileSync(process.execPath,['--input-type=module','-'],{input:streamScript,encoding:'utf8',maxBuffer:100000,timeout:30000});assert.ok(text.includes('STREAM-TERMINAL-CLEAR'));}],
  ...['resolve','reject'].map(mode=>['pending-zzfx-'+mode,()=>{const text=execFileSync(process.execPath,['--input-type=module','-',mode],{input:pendingImportScript,encoding:'utf8',maxBuffer:100000,timeout:30000});assert.ok(text.includes('PENDING-ZZFX-CLEAR'));}]),
  ['pending-effects-init',()=>{const text=execFileSync(process.execPath,['--input-type=module','-'],{input:pendingEffectsScript,encoding:'utf8',maxBuffer:100000,timeout:30000});assert.ok(text.includes('PENDING-EFFECTS-CLEAR'));}],
  ...['terminal','ordinary','genuine'].map(mode=>['pending-music-'+mode,()=>{const text=execFileSync(process.execPath,['--input-type=module','-',mode],{input:pendingMusicScript,encoding:'utf8',maxBuffer:100000,timeout:30000});assert.ok(text.includes('PENDING-MUSIC-CLEAR'));}]),
  ['loss-order',a=>a.ordering()],['early-loss-order',a=>a.ordering(Game,{early:true})],['startup-loss',a=>a.ordering(Game,{startup:true})],
];
for(const [name,check]of checks)try{await check(api);}catch(error){console.error('RESOURCE-PROFILE FAILED',name);throw error;}
console.log(`RESOURCE-PROFILE OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  const controls=[['pending-gpu-import',{...api,detect:(renderer,post,stats,stop,load)=>load().then(m=>m.getGPUTier({glContext:renderer.getContext()}))}],
    ['profile-shape',{...api,profile:()=>null}],['metadata-only',{...api,prepare:async()=>null}],
    ['post-stop',{...api,Post:class extends Post{stopForReload(){}}}],
    ['input-stop',{...api,Input:class extends Input{stopForReload(){}}}],
    ['mixer-falsy',{...api,Mixer:class extends Mixer{stopForReload(){if(this.once)return Promise.resolve();this.once=true;return super.stopForReload();}}}],
    ['effects-falsy',{...api,Effects:class extends Effects{stopForReload(){if(this.once)return Promise.resolve();this.once=true;return super.stopForReload();}}}],
    ['loss-order',{...api,ordering:()=>ordering(class extends Game{closeFigureResources(){return Promise.resolve().then(()=>super.closeFigureResources());}})}]];
  for(const [name,mutant]of controls){let failed=false;try{await checks.find(c=>c[0]===name)[1](mutant);}catch(error){
    assert.equal(error.code,'ERR_ASSERTION','control must reach its own assertion');failed=true;}assert.equal(failed,true,'ineffective profile control '+name);}
  console.log(`RESOURCE-PROFILE CONTROLS OK (${controls.length}/${controls.length})`);
}

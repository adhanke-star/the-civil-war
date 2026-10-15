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

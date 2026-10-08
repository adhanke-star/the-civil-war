import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {AxeBuilder} from '@axe-core/playwright';
const PARENT='aaf10145531130f3ec201d6332f6759599bc46a4';
const FIXTURE="{\"id\":\"henry-hill\",\"title\":\"Fictional reinforcement UI diagnostic\",\"battle\":\"DIAGNOSTIC ONLY\",\"date\":\"1861-07-21\",\"start\":\"14:00\",\"end\":\"14:01\",\"sites\":[{\"id\":\"henry\",\"name\":\"Henry House\",\"x\":-7,\"z\":375,\"rot\":0.1,\"yard\":30,\"fenceRadius\":260,\"source\":\"38.81487,-77.52258 Verified (geo research 2026-10-02 (NPS Public POIs MANA + OSM/Wikidata/Wikipedia agree within 60 m)); house rebuilt 1870s on the 1861 site (NRHP nomination p.8)\",\"buildings\":[[0,0,10,7,6.2,0,\"frame-house\"],[-14,12,6,5,3.2,0.1,\"shed\"],[16,16,9,7,5,0,\"barn\"]]},{\"id\":\"robinson\",\"name\":\"Robinson House\",\"x\":300,\"z\":-50,\"rot\":-0.2,\"yard\":28,\"fenceRadius\":220,\"embowered\":true,\"source\":\"38.81870,-77.51904 Verified (geo research 2026-10-02 (NPS Public POIs MANA + OSM/Wikidata/Wikipedia agree within 60 m)); “densely embowered in trees and environed by a double row of fences on two sides” (Beauregard, OR I/2 no. 84)\",\"buildings\":[[0,0,9,6.5,5,0,\"frame-house\"],[18,-10,10,8,5.5,0.05,\"barn\"],[-14,12,5,4,3,0,\"shed\"]]},{\"id\":\"stone\",\"name\":\"Stone House\",\"x\":-312,\"z\":-64,\"rot\":0.28,\"yard\":22,\"fenceRadius\":160,\"source\":\"38.81883,-77.52609 Verified (geo research 2026-10-02 (NPS Public POIs MANA + OSM/Wikidata/Wikipedia agree within 60 m)); still standing\",\"buildings\":[[0,0,12,8.5,7,0,\"stone-house\"],[18,14,6,5,3,0,\"shed\"]]},{\"id\":\"matthews\",\"name\":\"Matthew farm\",\"x\":-641,\"z\":-830,\"rot\":0.25,\"yard\":28,\"fenceRadius\":240,\"orchard\":[40,-40,5,4,0.25],\"source\":\"about 38.82573,-77.52988 Inferred (one NPS wayside, error 100-200 m); NPS spells it Matthew\",\"buildings\":[[0,0,9,6.5,5.2,0,\"frame-house\"],[-18,10,9,7,5,0,\"barn\"]]}],\"woodsNote\":\"Woods edges are drawn from period descriptions, not surveyed: “Around the eastern and southern brow of the plateau an almost unbroken fringe of second-growth pines”; “a broad belt of oaks ... across the crest on both sides of the Sudley road”; slopes “studded with clumps and patches of young pines and oaks” (Beauregard, OR Series I vol. 2, report no. 84); “Oak woods east of Robinson” (Atkinson 1862 map, LoC 2006626052, as read). Status: Inferred.\",\"woods\":[{\"name\":\"pine fringe on the east brow of Henry Hill\",\"polygon\":[[350,170],[420,120],[560,140],[640,260],[660,520],[620,760],[520,820],[420,780],[355,640],[340,450]]},{\"name\":\"pine fringe on the south brow\",\"polygon\":[[-120,860],[100,800],[300,800],[520,820],[700,900],[760,1300],[-160,1300]]},{\"name\":\"oak belt astride the Sudley Road\",\"polygon\":[[-560,470],[-420,430],[-250,470],[-160,560],[-150,900],[-200,1300],[-620,1300],[-640,800]]},{\"name\":\"oak woods east of the Robinson house\",\"polygon\":[[470,-260],[700,-300],[980,-240],[1050,40],[900,160],[700,120],[520,40]]},{\"name\":\"woods toward Bull Run\",\"polygon\":[[700,-1300],[1300,-1300],[1300,-500],[1050,-420],[820,-560]]},{\"name\":\"woods north-west of Matthews Hill\",\"polygon\":[[-1300,-1300],[-900,-1300],[-1000,-1050],[-1300,-950]]},{\"name\":\"woods south-east toward Holkums Branch\",\"polygon\":[[760,300],[1300,250],[1300,1300],[780,1300],[700,900],[680,560]]}],\"labels\":[{\"text\":\"Henry House Hill\",\"x\":110,\"z\":560,\"height\":48,\"angle\":1.6207963267948966},{\"text\":\"Henry\",\"x\":-7,\"z\":410,\"height\":20,\"angle\":1.5707963267948966},{\"text\":\"Robinson\",\"x\":300,\"z\":-15,\"height\":20,\"angle\":1.5707963267948966},{\"text\":\"Stone House\",\"x\":-312,\"z\":-28,\"height\":20,\"angle\":1.6707963267948966},{\"text\":\"Matthews Hill\",\"x\":-834,\"z\":-740,\"height\":44,\"angle\":1.5707963267948966},{\"text\":\"Buck Hill\",\"x\":-277,\"z\":-690,\"height\":30,\"angle\":1.5707963267948966},{\"text\":\"Young’s Branch\",\"x\":150,\"z\":-330,\"height\":24,\"angle\":1.9707963267948965,\"italic\":true},{\"text\":\"Sudley Road\",\"x\":-420,\"z\":300,\"height\":20,\"angle\":1.2207963267948965,\"italic\":true},{\"text\":\"Warrenton Turnpike\",\"x\":520,\"z\":-200,\"height\":20,\"angle\":1.8707963267948966,\"italic\":true}],\"units\":[{\"id\":\"initial-us\",\"name\":\"Fictional US initial-us\",\"short\":\"Fictional US initial-us\",\"side\":\"US\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":-650,\"z\":-300,\"facing\":1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\"},{\"id\":\"initial-cs\",\"name\":\"Fictional CS initial-cs\",\"short\":\"Fictional CS initial-cs\",\"side\":\"CS\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":650,\"z\":300,\"facing\":-1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\"}],\"objective\":{\"name\":\"Fictional point\",\"x\":-650,\"z\":-300,\"r\":40},\"positionsNote\":\"Union start positions are schematic (Inferred), below the plateau on the Sudley Road and Young’s Branch side about 2 p.m. Confederate positions follow Beauregard’s report and the NPS wayside sites (see each unit).\",\"strengthNote\":\"Strengths are the old repo values (data/bullrun.json), which it marks Inferred (medium): brigade-scale approximations from after-action reports. Bee: strength at the start of the day; his afternoon strength was lower and is not in the old repo.\",\"historyNote\":\"Fictional units and schedule on existing Henry terrain. No historical claim.\",\"labelsNote\":\"Place positions: Henry, Robinson, Stone House Verified; Matthews Hill summit 38.82515,-77.53210 Verified (GNIS point is 330 m off and not used); Buck Hill Inferred (GNIS and OSM 427 m apart).\",\"crates\":[],\"reinforcements\":[{\"id\":\"zero-own\",\"name\":\"Fictional US zero-own\",\"short\":\"Fictional US zero-own\",\"side\":\"US\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":-625,\"z\":-300,\"facing\":1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\",\"atSec\":0,\"entry\":\"FictionalUS west edge\"},{\"id\":\"zero-enemy\",\"name\":\"Fictional CS zero-enemy\",\"short\":\"Fictional CS zero-enemy\",\"side\":\"CS\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":625,\"z\":300,\"facing\":-1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\",\"atSec\":0,\"entry\":\"FictionalCS east edge\"},{\"id\":\"later-own\",\"name\":\"Fictional US later-own\",\"short\":\"Fictional US later-own\",\"side\":\"US\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":-600,\"z\":-280,\"facing\":1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\",\"atSec\":5.25,\"noticeSec\":3,\"entry\":\"FictionalUS west road\"},{\"id\":\"later-guns\",\"name\":\"Fictional CS later-guns\",\"short\":\"Fictional CS later-guns\",\"side\":\"CS\",\"type\":\"artillery\",\"men\":8,\"weapon\":\"parrott\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":600,\"z\":280,\"facing\":-1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\",\"guns\":1,\"atSec\":5.25,\"noticeSec\":3,\"entry\":\"FictionalCS east road\"},{\"id\":\"horizon-own\",\"name\":\"Fictional US horizon-own\",\"short\":\"Fictional US horizon-own\",\"side\":\"US\",\"type\":\"infantry\",\"men\":50,\"weapon\":\"smooth\",\"xp\":1,\"commander\":null,\"regiments\":[],\"x\":-575,\"z\":-280,\"facing\":1.5707963267948966,\"sources\":[],\"notes\":\"DIAGNOSTIC ONLY\",\"atSec\":15,\"entry\":\"FictionalUS west edge\"}]}";
const FIXTURE_SHA='c4971d2aac9cd52a37a2e76e27b12476c05788e28e85406286652efe037792a5';
const hash=b=>createHash('sha256').update(b).digest('hex');

// Test observers append to exact original module bytes. No product algorithm, listener or RNG replacement.
function observeGame(Game) {
  const o=window.__e2;
  for(const name of ['initializeReinforcements','emit','step']) {
    const descriptor=Object.getOwnPropertyDescriptor(Game.prototype,name),original=descriptor.value;
    o.bindings.push({owner:Game.prototype,name,descriptor});
    Object.defineProperty(Game.prototype,name,{...descriptor,value:function(...args){
      o.game=this;
      if(name==='initializeReinforcements') {
        if(!o.listenerRefs)o.listenerRefs=Object.fromEntries(Object.entries(this.listeners).map(([k,v])=>[k,v.slice()]));
        o.initBefore.push(o.state());
      }
      if(name==='emit') {
        const [kind,value]=args;
        if(kind==='spawn')o.spawns.push({id:value.id,time:this.simTime});
        if(kind==='event')o.events.push({...value,timeSec:this.simTime});
        if(kind==='alert')o.alerts.push({...value,timeSec:this.simTime});
      }
      if(name==='step'&&!o.firstStep)o.firstStep={before:o.state(),ready:!!window.__ready};
      try {
        const value=Reflect.apply(original,this,args);
        if(name==='initializeReinforcements')o.initAfter.push(o.state());
        if(name==='step'){o.steps++;if(!o.firstStep.after)o.firstStep.after=o.state();}
        return value;
      } catch(error) {if(name==='step')o.firstStep.error={message:error.message,stack:error.stack};throw error;}
    }});
  }
}
function observeHud(Hud) {
  const o=window.__e2;
  for(const name of ['addUnit','feed','showAlert']) {
    const descriptor=Object.getOwnPropertyDescriptor(Hud.prototype,name),original=descriptor.value;
    o.bindings.push({owner:Hud.prototype,name,descriptor});
    Object.defineProperty(Hud.prototype,name,{...descriptor,value:function(...args){
      o.hud=this;
      const value=Reflect.apply(original,this,args);
      if(name==='addUnit')o.added.push(args[0].id);
      if(name==='feed')o.feeds.push({...args[0]});
      if(name==='showAlert')o.shown.push({...args[0]});
      return value;
    }});
  }
  window.__overlayTrace?.bindObjective(Hud.prototype);
}
async function observedPage({browser,url,baseline=false,width=1280,height=720,autoPause=true}) {
  assert.equal(Buffer.byteLength(FIXTURE),6792);assert.equal(hash(FIXTURE),FIXTURE_SHA);
  const {prepareFieldScenario}=await import('../src/sim/phase.js'); prepareFieldScenario(JSON.parse(FIXTURE),'henry-hill');
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  // Passive bounded diagnostic only: native callbacks and original objective setter still forward exactly.
  await context.addInitScript(() => {
    const resizeDescriptor=Object.getOwnPropertyDescriptor(window,'ResizeObserver'),NativeResizeObserver=resizeDescriptor.value;
    const rows=[],bindings=[];let overflow=false,mutation=null,started=false,callbackCalls=0,forwardCalls=0;
    const same=(a,b)=>Reflect.ownKeys(a).length===Reflect.ownKeys(b).length&&Reflect.ownKeys(a).every(k=>a[k]===b[k]);
    function mark(phase,extra={}) {
      if(rows.length>=1024){overflow=true;return;}
      const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,hidden:n.hidden,text:n.textContent}};
      const root=document.documentElement,css=root?getComputedStyle(root):null;
      rows.push({seq:rows.length,phase,at:performance.timeOrigin+performance.now(),query:location.search,width:innerWidth,height:innerHeight,ready:!!window.__ready,simTime:window.__game?.game.simTime??null,paused:window.__game?.game.paused??null,topH:css?.getPropertyValue('--top-h')??null,dockH:css?.getPropertyValue('--dock-h')??null,objectiveH:css?.getPropertyValue('--objective-h')??null,objective:rect(document.getElementById('objective')),banner:rect(document.getElementById('banner')),...extra});
    }
    const proxy=new Proxy(NativeResizeObserver,{construct(target,args,newTarget){
      if(typeof args[0]!=='function')return Reflect.construct(target,args,newTarget);
      const callback=args[0];return Reflect.construct(target,[function(...values){callbackCalls++;mark('native-resize-before',{targets:values[0].map(e=>e.target.id)});let output;try{output=Reflect.apply(callback,this,values);forwardCalls++;return output;}finally{mark('native-resize-after',{callbackReturnUndefined:output===undefined});}},...args.slice(1)],newTarget);
    }});
    Object.defineProperty(window,'ResizeObserver',{...resizeDescriptor,value:proxy});
    function start(){if(started)return;started=true;mutation=new MutationObserver(entries=>mark('root-style-publication',{mutations:entries.length}));mutation.observe(document.documentElement,{attributes:true,attributeFilter:['style']});mark('document-ready');}
    document.addEventListener('DOMContentLoaded',start,{once:true});
    window.__overlayTrace={mark,bindObjective(owner){const key='objective',descriptor=Object.getOwnPropertyDescriptor(owner,key),original=descriptor.value;bindings.push({owner,key,descriptor});Object.defineProperty(owner,key,{...descriptor,value:function(...args){mark('objective-before',{incoming:args[0]});let value;try{value=Reflect.apply(original,this,args);return value;}finally{mark('objective-after',{returnUndefined:value===undefined});}}});},finish(){
      mark('finally-before');for(const b of bindings)Object.defineProperty(b.owner,b.key,b.descriptor);Object.defineProperty(window,'ResizeObserver',resizeDescriptor);mutation?.disconnect();document.removeEventListener('DOMContentLoaded',start,{once:true});
      const cleanup={resizeDescriptorExact:same(Object.getOwnPropertyDescriptor(window,'ResizeObserver'),resizeDescriptor),resizeOriginalRef:window.ResizeObserver===NativeResizeObserver,objectiveDescriptorsExact:bindings.every(b=>same(Object.getOwnPropertyDescriptor(b.owner,b.key),b.descriptor)),objectiveBindings:bindings.length,mutationDisconnected:!!mutation,DOMContentLoadedRemovalCalls:1,callbackCalls,forwardCalls};mark('finally-after');delete window.__overlayTrace;cleanup.globalAbsent=!Object.prototype.hasOwnProperty.call(window,'__overlayTrace');return{rows,overflow,cleanup,scope:'Passive observation only; layout reads can perturb timing; no cause/cure/native/full acceptance'};
    }};
  });
  const errors=[],warnings=[],routes=[];let page;
  const close=async()=>{let restore;try{restore=page?await page.evaluate(()=>{const overlayDiagnostic=window.__overlayTrace?.finish();return{...window.__e2?.restore(),overlayDiagnostic};}).catch(e=>({error:e.message})):null;await context.unrouteAll({behavior:'wait'});}finally{await context.close()}return restore||{notInstalled:true,refsExact:true,descriptorsExact:true,count:0}};
  try {page=await context.newPage();
  page.on('pageerror',e=>errors.push({type:'pageerror',message:e.message,stack:e.stack}));
  page.on('console',m=>{if(m.type()==='error')errors.push({type:'console',message:m.text()});if(m.type()==='warning')warnings.push(m.text())});
  page.on('requestfailed',r=>errors.push({type:'requestfailed',url:r.url(),message:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)errors.push({type:'http',url:r.url(),status:r.status()})});
  await context.addInitScript(({autoPause})=>{
    const o=window.__e2={bindings:[],added:[],spawns:[],events:[],alerts:[],feeds:[],shown:[],initBefore:[],initAfter:[],steps:0,trusted:[],gpu:0,resultDialogs:0,puts:0,progressTransactions:0,legacyWrites:0};
    const bind=(owner,name,value)=>{const descriptor=Object.getOwnPropertyDescriptor(owner,name);o.bindings.push({owner,name,descriptor});Object.defineProperty(owner,name,{...descriptor,value});return descriptor.value};
    const canvas=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
    bind(HTMLCanvasElement.prototype,'getContext',function(...args){const v=Reflect.apply(canvas,this,args);if(/^webgl/.test(args[0])&&v&&!seen.has(this)){seen.add(this);o.gpu++}return v});
    const modal=HTMLDialogElement.prototype.showModal;
    bind(HTMLDialogElement.prototype,'showModal',function(...args){if(this.id==='result')o.resultDialogs++;return Reflect.apply(modal,this,args)});
    const put=IDBObjectStore.prototype.put,transact=IDBDatabase.prototype.transaction,setItem=Storage.prototype.setItem;
    bind(IDBObjectStore.prototype,'put',function(...args){if(this.name==='progress'&&this.transaction.db.name==='cw.progress')o.puts++;return Reflect.apply(put,this,args)});
    bind(IDBDatabase.prototype,'transaction',function(...args){if(this.name==='cw.progress'&&args[1]==='readwrite')o.progressTransactions++;return Reflect.apply(transact,this,args)});
    bind(Storage.prototype,'setItem',function(...args){if(args[0]==='cw.progress')o.legacyWrites++;return Reflect.apply(setItem,this,args)});
    const listener=e=>{if(e.isTrusted&&['click','keydown','keyup'].includes(e.type))o.trusted.push({type:e.type,key:e.key,id:e.target.id,army:e.target.closest('[data-army-unit]')?.dataset.armyUnit,trusted:e.isTrusted,detail:e.detail})};
    for(const kind of ['click','keydown','keyup'])document.addEventListener(kind,listener,true);
    o.advanceTo=target=>{const g=o.game;if(!Number.isFinite(target)||target<g.simTime)throw new Error("diagnostic advance target already passed");let steps=0;while(g.simTime<target&&!g.over){if(++steps>400)throw new Error("diagnostic advance did not finish");g.tick(Math.min(.05,target-g.simTime))}return steps};
    o.state=()=>{const g=o.game,h=o.hud;return {time:g?.simTime,paused:g?.paused,over:g?.over,ids:g?.units.map(u=>u.id),selection:g?.selection.map(u=>u.id),orders:g?.orders,reserve:g?{...g.reserve}:null,markers:h?[...h.markers.keys()]:[],connected:h?[...h.markers.values()].filter(m=>m.el.isConnected).length:0,dom:document.querySelectorAll('#markers .marker').length,shared:!!g&&h?.units===g.units&&g.combat.units===g.units,listeners:g?Object.fromEntries(Object.entries(g.listeners).map(([k,v])=>[k,v.length])):null,spawns:o.spawns.map(x=>x.id),events:o.events.map(x=>x.kind),shown:o.shown.length,initCalls:o.initBefore.length,ready:!!window.__ready,gpu:o.gpu,puts:o.puts,transactions:o.progressTransactions,legacyWrites:o.legacyWrites}}
    o.restore=()=>{
      const g=o.game,refsExact=!o.listenerRefs||Object.entries(o.listenerRefs).every(([k,refs])=>g.listeners[k].length===refs.length&&refs.every((f,i)=>g.listeners[k][i]===f));
      for(const b of o.bindings)Object.defineProperty(b.owner,b.name,b.descriptor);
      const descriptorsExact=o.bindings.every(b=>{const d=Object.getOwnPropertyDescriptor(b.owner,b.name);return d.value===b.descriptor.value&&d.writable===b.descriptor.writable&&d.enumerable===b.descriptor.enumerable&&d.configurable===b.descriptor.configurable});
      for(const kind of ['click','keydown','keyup'])document.removeEventListener(kind,listener,true);
      const witness={refsExact,descriptorsExact,count:o.bindings.length};delete window.__e2;witness.globalRemoved=!Object.prototype.hasOwnProperty.call(window,'__e2');return witness;
    };
    o.autoPause=autoPause;
  },{autoPause});
  const bodies={};
  for(const [path,append]of [['src/game.js',observeGame],['src/ui/hud.js',observeHud]]) {
    const original=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');bodies[path]={bytes:Buffer.byteLength(original),sha256:hash(original)};
    const handler=async route=>{routes.push(path);await route.fulfill({status:200,contentType:'text/javascript',body:original+'\n;('+append.toString()+')('+ (path.endsWith('game.js')?'Game':'Hud')+');\n'})};
    await context.route('**/'+path,handler);
  }
  // Settings are test-owned setup before Game construction, not a substituted simulation owner.
  const settingsSuffix="\n;import {set as e2Set} from './settings.js'; e2Set('rules.autoPause',window.__e2.autoPause);\n";
  const main=baseline?execFileSync('git',['show',PARENT+':src/main.js']).toString():fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  await context.route('**/src/main.js',async route=>{routes.push('src/main.js');await route.fulfill({status:200,contentType:'text/javascript',body:main+settingsSuffix})});
  await context.route('**/assets/scenarios/henry-hill.json',async route=>{routes.push('fixture');await route.fulfill({status:200,contentType:'application/json',body:FIXTURE})});
  if(baseline){const css=execFileSync('git',['show',PARENT+':src/ui/hud.css']).toString();bodies['src/ui/hud.css']={bytes:Buffer.byteLength(css),sha256:hash(css)};await context.route('**/src/ui/hud.css',async route=>{routes.push('src/ui/hud.css');await route.fulfill({status:200,contentType:'text/css',body:css})});}
  await page.goto(url+'?battle=henry-hill&quality=low&nosw',{waitUntil:'domcontentloaded'});
  return {context,page,errors,warnings,routes,bodies,mainSha256:hash(main),close};
  }catch(error){await close();throw error;}
}
export async function reinforcementBaseline({browser,url,shot,result}) {
  const p=await observedPage({browser,url,baseline:true});
  try {
    await p.page.waitForFunction(()=>window.__e2?.firstStep?.error,{timeout:180000});
    const actual=await p.page.evaluate(()=>({firstStep:window.__e2.firstStep,state:window.__e2.state(),initCalls:window.__e2.initBefore.length}));
    assert.match(actual.firstStep.error.message,/attach listeners and initialize before advancing/);assert.equal(actual.state.ready,false);assert.equal(actual.state.gpu,1);assert.equal(actual.initCalls,0);assert.deepEqual(actual.state.ids,['initial-us','initial-cs']);
    await p.page.setViewportSize({width:320,height:768});
    await p.page.evaluate(()=>{const h=window.__e2.hud;h.showAlert({text:'Fictional US zero-own, Fictional CS zero-enemy arrived.',x:-625,z:-300});h.feed({text:'Fictional US zero-own arrives at FictionalUS west edge.',time:'14:00',side:'US',x:-625,z:-300});h.feed({text:'Fictional CS zero-enemy arrives at FictionalCS east edge.',time:'14:00',side:'CS',x:625,z:300})});
    await shot(p.page,'reinforcement-base-missing-init-narrow');
    const layout=await readLayout(p.page);
    assert.ok(layout.actions.some(x=>x.height<44||x.font<14)||!layout.contained,'parent CSS must exhibit the admitted readability defect');
    const record={diagnostic:true,fixtureSha256:FIXTURE_SHA,parent:PARENT,mainSha256:p.mainSha256,actual,layout,errors:p.errors,warnings:p.warnings,bodies:p.bodies,routes:p.routes};
    result.reinforcementBaseline=record;return record;
  }finally {const restore=await p.close();result.reinforcementBaselineRestore=restore;assert.ok(restore.refsExact&&restore.descriptorsExact&&restore.globalRemoved);assert.equal(restore.count,11)}
}
async function readLayout(page) {
  return page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},panel=document.getElementById('banner'),feed=document.getElementById('feed');
    const actions=[...document.querySelectorAll('#banner button:not([hidden]),#feed button')].filter(e=>e.getClientRects().length).map(el=>{
      const r=rect(el),font=parseFloat(getComputedStyle(el).fontSize),parent=el.closest('#banner,#feed'),pr=rect(parent);
      const visible=r.bottom>pr.y&&r.y<pr.bottom;const pts=[[.15,.15],[.85,.15],[.5,.5],[.15,.85],[.85,.85]].map(([x,y])=>{const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return !!hit&&(hit===el||el.contains(hit))});
      return {...r,id:el.id||el.textContent,text:el.textContent,font,visible,hits:pts,withinParent:r.x>=pr.x&&r.right<=pr.right,overflow:el.scrollWidth>el.clientWidth};
    });
    const panels=[panel,feed].filter(el=>!el.hidden&&el.getClientRects().length).map(el=>({id:el.id,...rect(el),overflow:el.scrollWidth>el.clientWidth}));
    const obstacles=['objective','tip'].map(id=>document.getElementById(id)).filter(e=>!e.hidden&&e.getClientRects().length).map(e=>({id:e.id,...rect(e)}));const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;const overlaps=panels.flatMap(a=>obstacles.filter(b=>overlap(a,b)).map(b=>[a.id,b.id]));if(panels.length===2&&overlap(panels[0],panels[1]))overlaps.push(['banner','feed']);
    const actual = {width:innerWidth,height:innerHeight,actions,panels,obstacles,overlaps,bannerOpaque:getComputedStyle(panel).backgroundColor==='rgb(24, 22, 29)'&&getComputedStyle(panel).opacity==='1',contained:panels.every(r=>r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&!r.overflow),documentOverflow:document.documentElement.scrollWidth>innerWidth};
    window.__overlayTrace?.mark('original-readLayout',{original:actual});return actual;
  });
}

export const REINFORCEMENT_UI_CHECKS = Object.freeze([
  'zero-before-first-field-step','zero-idempotency','visible-advance-notice','future-spawn-once',
  'one-coincident-alert','trusted-resume-and-fly','arrival-keyboard-order','paused-no-replay',
  'density-and-restart','horizon-result-path','narrow-readable-keyboard','wide-readable-keyboard',
]);
const listenerCounts={select:4,log:1,event:1,alert:1,spawn:1,remove:3};
const expectedZero=['initial-us','initial-cs','zero-own','zero-enemy'];
export function verifyReinforcementUI(name,r) {
  assert.equal(r.category,name,'actual category identity');
  switch(name) {
    case 'zero-before-first-field-step': {
      assert.equal(r.before.initCalls,1);assert.equal(r.before.time,0);assert.equal(r.before.ready,false);
      assert.deepEqual(r.before.ids,expectedZero);assert.deepEqual(r.before.markers,expectedZero);
      assert.equal(r.before.connected,4);assert.equal(r.before.dom,4);assert.equal(r.before.shared,true);
      assert.deepEqual(r.before.listeners,listenerCounts);assert.deepEqual(r.before.spawns,['zero-own','zero-enemy']);
      assert.deepEqual(r.before.events,['reinforcement-notice','reinforcement-notice','reinforcement','reinforcement']);assert.equal(r.before.shown,1);assert.equal(r.ready,true);assert.equal(r.originalInitAfter.time,0);break;
    }
    case 'zero-idempotency': {const before={...r.before},after={...r.after};assert.equal(before.initCalls,1);assert.equal(after.initCalls,3);delete before.initCalls;delete after.initCalls;assert.deepEqual(after,before);assert.equal(r.calls,3);break;}
    case 'visible-advance-notice':
      assert.deepEqual(r.newEvents.map(e=>[e.kind,e.side]),[['reinforcement-notice','US'],['reinforcement-notice','CS']]);
      assert.ok(r.newEvents.every(e=>e.timeSec===2.25&&e.text.includes('is approaching')&&e.text.includes('Fictional')));
      assert.deepEqual(r.ids,expectedZero);assert.deepEqual(r.feedSides,['us','cs']);assert.ok(r.feedTexts.every(t=>t.includes('14:00')&&t.includes('Fictional')));break;
    case 'future-spawn-once':
      assert.equal(r.shared,true);assert.equal(r.connected,6);assert.equal(r.dom,6);assert.equal(new Set(r.markers).size,6);
      assert.deepEqual(r.ids,[...expectedZero,'later-own','later-guns']);assert.deepEqual(r.spawns,['zero-own','zero-enemy','later-own','later-guns']);assert.deepEqual(r.repeatAfter,r.repeatBefore);
      assert.deepEqual(r.arrivals,['later-own','later-guns']);assert.equal(r.gun.type,'artillery');assert.equal(r.gun.guns,1);assert.equal(r.gun.gunSlots,1);assert.ok(r.gun.figures>0&&r.infantryFigures>0);assert.ok(r.gunDrawn>=1);assert.deepEqual(r.reserve,{US:2100,CS:2100});break;
    case 'one-coincident-alert':
      assert.equal(r.unpausedBefore,true);assert.equal(r.alertDelta,1);assert.equal(r.showDelta,1);assert.equal(r.paused,true);assert.equal(r.aria,'true');
      assert.equal(r.text,'Fictional US later-own, Fictional CS later-guns arrived.');assert.deepEqual(r.at,{x:-600,z:-280});break;
    case 'trusted-resume-and-fly':
      assert.ok(r.actions.some(e=>e.trusted&&e.id==='banner-fly'));assert.ok(r.actions.some(e=>e.trusted&&e.id==='banner-resume'));
      assert.deepEqual(r.goal,{x:-625,z:-300});assert.equal(r.unpaused,true);assert.ok(r.afterTime>r.beforeTime);assert.equal(r.bannerHidden,true);break;
    case 'arrival-keyboard-order':
      assert.equal(r.selected,'later-own');assert.equal(r.ownControlled,true);assert.equal(r.order,'move');assert.ok(r.ordersAfter>r.ordersBefore);
      assert.ok(r.trustedKeys.some(e=>e.trusted&&e.type==='keydown'&&e.key==='Enter'));assert.equal(r.enemyControlled,false);assert.equal(r.enemyOrderAccepted,false);assert.equal(r.enemyOrdersDisabled,true);assert.equal(r.armySize,3);assert.equal(r.armyDom,3);break;
    case 'paused-no-replay':assert.deepEqual(r.after,r.before);assert.ok(r.frames>=3);assert.equal(r.stepDelta,0);assert.equal(r.forwardDelta,0);break;
    case 'density-and-restart':
      assert.equal(r.zeroFigures5,10);assert.equal(r.laterFigures5,10);assert.equal(r.laterFigures10,5);assert.deepEqual(r.capAfter,r.capBefore);assert.deepEqual(r.reserve,{US:2100,CS:2100});
      assert.deepEqual(r.freshZeroIds,expectedZero);assert.deepEqual(r.freshSpawns,['zero-own','zero-enemy']);assert.equal(r.autoPauseFalse,true);assert.equal(r.actualAutoPause,false);assert.equal(r.unpausedArrival,true);assert.equal(r.pausedAfterArrival,false);assert.equal(r.alerts,0);assert.equal(r.bannerHidden,true);break;
    case 'horizon-result-path':
      assert.ok(r.objTBefore>0);assert.ok(r.initialInfantry.every(u=>u.alive&&u.state!=='routing'&&u.men===50));assert.equal(r.time,15);assert.equal(r.over,true);assert.deepEqual(r.finalKinds,['reinforcement','result']);
      assert.equal(r.horizonMarker,true);assert.equal(r.dialogs,1);assert.equal(r.dialogOpen,true);assert.equal(r.outcome,null);assert.equal(r.reward,null);assert.equal(r.mode,'Historical battle · no franchise rewards');assert.equal(r.puts,0);assert.equal(r.transactions,0);assert.equal(r.legacyWrites,0);assert.deepEqual(r.terminalAfter,r.terminalBefore);assert.equal(r.stepDelta,0);assert.equal(r.forwardDelta,0);break;
    case 'narrow-readable-keyboard':case 'wide-readable-keyboard': {
      assert.deepEqual(r.overlaps,[],'actual arrival panels reserve objective/instructions and each other');assert.equal(r.bannerOpaque,true,'arrival text must not mix with underlying marker labels');assert.equal(r.width,name.startsWith('narrow')?320:1280);assert.equal(r.contained,true);assert.equal(r.documentOverflow,false);assert.ok(r.actions.length>=4);
      for(const a of r.actions){assert.ok(a.width>=44&&a.height>=44&&a.font>=14,'readable44px native action/14px text');assert.equal(a.withinParent,true);assert.equal(a.overflow,false);assert.ok(a.hits.every(Boolean),'all actual action hit points reachable');}
      assert.equal(r.focusVisible,true);assert.ok(r.keyboardEvents.some(e=>e.trusted&&e.type==='keydown'&&e.key==='Enter'));assert.ok(r.keyboardEvents.some(e=>e.trusted&&e.type==='keyup'&&e.key===' '));assert.equal(r.enterClicked,true);assert.equal(r.spaceClicked,true);assert.equal(r.flyGoalExact,true);assert.equal(r.violations.length,0);assert.equal(r.cssRestore,true);assert.equal(r.cssControlRejected,true);break;
    }
    default:assert.fail('unknown UI category');
  }
  return true;
}
// Every intended mutant changes a measured value used by that category's assertion.
export function readerControls(records) {
  const change=[r=>r.before.initCalls=0,r=>r.after.time++,r=>r.newEvents[0].side='CS',r=>r.dom++,r=>r.alertDelta++,r=>r.goal.x++,r=>r.enemyControlled=true,r=>r.after.time++,r=>r.zeroFigures5=5,r=>r.dialogs=2,r=>r.actions[0].font=13,r=>r.actions[0].height=32];
  return REINFORCEMENT_UI_CHECKS.map((name,i)=>{const broken=structuredClone(records[name]);change[i](broken);let error;try{verifyReinforcementUI(name,broken)}catch(e){error=e}assert.equal(error?.code,'ERR_ASSERTION',name+' intended assertion rejects actual-record mutant');return {category:name,kind:'semantic-reader',code:error.code,message:error.message}});
}
const state=page=>page.evaluate(()=>window.__e2.state());
const settle=page=>page.evaluate(()=>new Promise(resolve=>{let n=0;function frame(){if(++n===3)resolve(n);else requestAnimationFrame(frame)}requestAnimationFrame(frame)}));
const pause=async page=>{if(!await page.evaluate(()=>window.__game.game.paused))await page.locator('#pause').click();await settle(page)};
async function readable(page,width) {
  await settle(page);
  const panels=await readLayout(page),actions=[];
  const buttons=page.locator('#banner button:not([hidden]),#feed button'),n=await buttons.count();
  // Native focus scroll brings each retained full-message button into its original scroll parent.
  for(let i=0;i<n;i++){
    await buttons.nth(i).focus();await page.keyboard.press('Shift');await settle(page);
    const sample=await page.evaluate(()=>{
      const el=document.activeElement,r=el.getBoundingClientRect(),parent=el.closest('#banner,#feed'),pr=parent.getBoundingClientRect(),pts=[[.15,.15],[.85,.15],[.5,.5],[.15,.85],[.85,.85]];
      return {id:el.id||el.textContent,width:r.width,height:r.height,font:parseFloat(getComputedStyle(el).fontSize),withinParent:r.x>=pr.x&&r.right<=pr.right&&r.y>=pr.y&&r.bottom<=pr.bottom,overflow:el.scrollWidth>el.clientWidth,hits:pts.map(([x,y])=>{const at=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return !!at&&(at===el||el.contains(at))}),focusVisible:el.matches(':focus-visible')};
    });actions.push(sample);
  }
  const actionStart=await page.evaluate(()=>window.__e2.trusted.length);const target=page.locator('#feed button').last();await target.focus();await page.keyboard.press('Enter');const enterClicked=await page.evaluate(n=>window.__e2.trusted.slice(n).some(e=>e.type==='click'&&e.trusted),actionStart);const spaceStart=await page.evaluate(()=>window.__e2.trusted.length);await page.keyboard.press('Space');const spaceClicked=await page.evaluate(n=>window.__e2.trusted.slice(n).some(e=>e.type==='click'&&e.trusted),spaceStart);const keyboard=await page.evaluate(n=>({keyboardEvents:window.__e2.trusted.slice(n),flyGoalExact:window.__game.rts.goal.x===window.__e2.feeds.at(-1).x&&window.__game.rts.goal.z===window.__e2.feeds.at(-1).z}),actionStart);
  const axes=(await new AxeBuilder({page}).include('#banner').include('#feed').include('#army').analyze()).violations;
  const before=await page.evaluate(()=>({styleCount:document.querySelectorAll('style').length,focus:document.activeElement,scroll:document.getElementById('feed').scrollTop})).then(x=>({styleCount:x.styleCount,scroll:x.scroll}));
  const originalFont=await page.locator('#feed button').first().evaluate(el=>getComputedStyle(el).fontSize);
  const legacy=execFileSync('git',['show',PARENT+':src/ui/hud.css']).toString();const rule=legacy.match(/#feed button \{[^}]+\}/)?.[0];assert.ok(rule?.includes('font-size: 13px'));
  await page.evaluate(rule=>{const style=document.createElement('style');style.id='e2-owned-legacy-feed-control';style.textContent=rule;document.head.append(style)},rule);
  let caught;try{const font=await page.locator('#feed button').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>=14,'legacy CSS13px must reject actual readability assertion')}catch(e){caught=e}
  assert.equal(caught?.code,'ERR_ASSERTION');
  await page.evaluate(scroll=>{document.getElementById('e2-owned-legacy-feed-control').remove();document.getElementById('feed').scrollTop=scroll},before.scroll);await settle(page);
  const restored=await page.evaluate(()=>({styleCount:document.querySelectorAll('style').length,scroll:document.getElementById('feed').scrollTop}));
  const cssRestore=await page.locator('#feed button').first().evaluate(el=>getComputedStyle(el).fontSize)===originalFont&&before.styleCount===restored.styleCount&&before.scroll===restored.scroll;
  return {width,actions,...keyboard,enterClicked,spaceClicked,panels:panels.panels,obstacles:panels.obstacles,overlaps:panels.overlaps,bannerOpaque:panels.bannerOpaque,contained:panels.contained,documentOverflow:panels.documentOverflow,focusVisible:actions.every(x=>x.focusVisible),violations:axes,cssRestore,cssControlRejected:caught.code==='ERR_ASSERTION',cssControl:{parentRule:rule,parentCssSha256:hash(legacy),rejection:caught.message,restored}};
}
export async function reinforcementUIControls({browser,url,check,shot,result,native=false}) {
  const record=result.reinforcementUI={native,fixtureSha256:FIXTURE_SHA,records:{},controls:[],restores:[],pages:[],errors:[],warnings:[]};
  const save=(name,row)=>{row.category=name;record.records[name]=row;verifyReinforcementUI(name,row);check('reinforcement-ui-'+name,true,'actual field/HUD observation; exact lifecycle and original controls')};
  await reinforcementBaseline({browser,url,shot,result});
  async function use(options,body) {
    const p=await observedPage({browser,url,...options});
    try{await p.page.waitForFunction(()=>window.__ready,{timeout:180000});await body(p.page);}
    catch(error){record.failure={message:error.message,stack:error.stack};throw error;}
    finally{const beforeClose={errors:p.errors.length,warnings:p.warnings.length};const restore=await p.close();record.errors.push(...p.errors);record.warnings.push(...p.warnings);record.restores.push(restore);record.pages.push({options,bodies:p.bodies,mainSha256:p.mainSha256,routes:p.routes,cleanupDiagnostics:{beforeClose,afterClose:{errors:p.errors.length,warnings:p.warnings.length},errors:p.errors.slice(beforeClose.errors),warnings:p.warnings.slice(beforeClose.warnings)}});assert.ok(restore.refsExact&&restore.descriptorsExact&&restore.globalRemoved);assert.equal(restore.count,11);}
  }
  await use({},async page=>{
    record.renderer=await page.evaluate(()=>{const gl=document.getElementById('battlefield').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});
    if(native)assert.ok(!/swiftshader|llvmpipe|software/i.test(record.renderer));
    const initial=await page.evaluate(()=>({first:window.__e2.firstStep,after:window.__e2.initAfter[0],ready:window.__ready}));
    save('zero-before-first-field-step',{before:initial.first.before,originalInitAfter:initial.after,ready:initial.ready});
    const before=await state(page);await page.evaluate(()=>{window.__game.game.initializeReinforcements();window.__game.game.initializeReinforcements()});const after=await state(page);const calls=after.initCalls;save('zero-idempotency',{before,after,calls});
    const startEvents=await page.evaluate(()=>window.__e2.trusted.length);await page.locator('#banner-fly').click();const goal=await page.evaluate(()=>({x:window.__game.rts.goal.x,z:window.__game.rts.goal.z}));const beforeTime=await page.evaluate(()=>window.__game.game.simTime);await page.locator('#banner-resume').click();await page.waitForFunction(()=>window.__game.game.simTime>0);const resumed=await page.evaluate(start=>({actions:window.__e2.trusted.slice(start),unpaused:!window.__game.game.paused,afterTime:window.__game.game.simTime,bannerHidden:document.getElementById('banner').hidden}),startEvents);save('trusted-resume-and-fly',{...resumed,goal,beforeTime});await pause(page);
    assert.ok(await page.evaluate(()=>window.__game.game.simTime<2.25));
    const notice=await page.evaluate(()=>{const g=window.__game.game,o=window.__e2,n=o.events.length;window.__e2.advanceTo(2.25);return {newEvents:o.events.slice(n),ids:g.units.map(u=>u.id),feedSides:[...document.querySelectorAll('#feed li')].slice(-2).map(e=>e.querySelector('span').className),feedTexts:[...document.querySelectorAll('#feed li')].slice(-2).map(e=>e.textContent)}});save('visible-advance-notice',notice);
    await page.locator('#pause').click(); // Real unpause; direct tick below is the explicitly labeled deterministic hook.
    const arrivals=await page.evaluate(()=>{const {game:g,hud:h}=window.__game,o=window.__e2,unpausedBefore=!g.paused,a=o.alerts.length,s=o.shown.length;window.__e2.advanceTo(5.25);const gun=g.units.find(u=>u.id==='later-guns'),inf=g.units.find(u=>u.id==='later-own');return {alert:{unpausedBefore,alertDelta:o.alerts.length-a,showDelta:o.shown.length-s,paused:g.paused,aria:document.getElementById('pause').getAttribute('aria-pressed'),text:document.getElementById('banner-text').textContent,at:h.alertAt},spawn:{...o.state(),arrivals:o.spawns.slice(-2).map(x=>x.id),gun:{type:gun.type,guns:gun.guns,gunSlots:gun.gunSlots.length,figures:gun.figures.length},infantryFigures:inf.figures.length}}});save('one-coincident-alert',arrivals.alert);
    arrivals.spawn.repeatBefore=await state(page);await page.evaluate(()=>window.__game.game.tick(0));arrivals.spawn.repeatAfter=await state(page);
    await settle(page);arrivals.spawn.gunDrawn=await page.evaluate(()=>window.__game.game.gunPool.guns.CS.count);save('future-spawn-once',arrivals.spawn);
    await shot(page,'reinforcement-coincident-wide');
    const pausedBefore=await state(page);const frames=await settle(page);const pausedAfter=await state(page);const deltas=await page.evaluate(()=>{const g=window.__game.game,t=g.simTime;return {stepDelta:g.step(.2),forwardDelta:g.fastForward(.3)-t}});save('paused-no-replay',{before:pausedBefore,after:pausedAfter,frames,...deltas});
    await page.locator('#army-btn').click();await page.locator('[data-army-unit="later-own"]').focus();await page.keyboard.press('Enter');await page.locator('#army-close').click();await page.locator('#battlefield').focus();const ordersBefore=await page.evaluate(()=>window.__game.game.orders||0);await page.keyboard.press('b');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    const order=await page.evaluate(before=>{const {game:g,hud:h}=window.__game,u=g.units.find(x=>x.id==='later-own'),enemy=g.units.find(x=>x.id==='later-guns');const selected=g.selected.id;const order=u.order.type,ordersAfter=g.orders;g.select(enemy);const enemyOrderAccepted=g.orderGroup(enemy,{type:'hold'}),enemyOrdersDisabled=[...document.querySelectorAll('#orders button')].every(b=>b.disabled);const row={selected,ownControlled:g.controls(u),order,ordersBefore:before,ordersAfter,trustedKeys:window.__e2.trusted.filter(e=>e.type==='keydown'),enemyControlled:g.controls(enemy),enemyOrderAccepted,enemyOrdersDisabled,armySize:h.armyRows.size,armyDom:document.querySelectorAll('#army-list button').length};g.select(u);return row},ordersBefore);save('arrival-keyboard-order',order);
    await page.locator('#army-btn').click();await page.locator('#army-close').click();
    const wide=await readable(page,1280);record.wideAxe=wide.violations;save('wide-readable-keyboard',wide);await shot(page,'reinforcement-readable-wide');
    const horizon=await page.evaluate(()=>{const {game:g,hud:h,practice:p}=window.__game,o=window.__e2;g.objT=1000;const objTBefore=g.objT,initialInfantry=g.units.filter(u=>u.id.startsWith('initial-')).map(u=>({id:u.id,alive:u.alive,state:u.state,men:u.men}));window.__e2.advanceTo(15);return {objTBefore,initialInfantry,time:g.simTime,over:g.over,finalKinds:o.events.slice(-2).map(e=>e.kind),horizonMarker:h.markers.get('horizon-own')?.el.isConnected,dialogs:o.resultDialogs,dialogOpen:document.getElementById('result').open,outcome:p.outcome,reward:p.reward,mode:document.getElementById('play-mode').textContent,puts:o.puts,transactions:o.progressTransactions,legacyWrites:o.legacyWrites}});
    await settle(page);horizon.terminalBefore=await state(page);const terminal=await page.evaluate(()=>{const g=window.__game.game,t=g.simTime;g.tick(1);return {stepDelta:g.step(.2),forwardDelta:g.fastForward(.1)-t}});horizon.terminalAfter=await state(page);Object.assign(horizon,terminal);horizon.dialogs=await page.evaluate(()=>window.__e2.resultDialogs);save('horizon-result-path',horizon);await shot(page,'reinforcement-horizon-result');
  });
  await use({autoPause:false},async page=>{
    await pause(page);const before=await page.evaluate(async()=>{const S=await import('/src/settings.js'),{game:g}=window.__game;const capBefore={US:g.pools.US.capacity,CS:g.pools.CS.capacity,horse:g.horses.capacity};S.set('look.menPerFigure',5);return {capBefore,zeroFigures5:g.units.find(u=>u.id==='zero-own').figures.length}});
    await page.locator('#pause').click();
    const d=await page.evaluate(async()=>{const S=await import('/src/settings.js'),{RULES}=await import('/src/sim/rules.js'),{game:g}=window.__game;const actualAutoPause=RULES.autoPause,unpausedArrival=!g.paused;window.__e2.advanceTo(5.25);const pausedAfterArrival=g.paused,laterFigures5=g.units.find(u=>u.id==='later-own').figures.length;S.set('look.menPerFigure',10);const laterFigures10=g.units.find(u=>u.id==='later-own').figures.length;return {laterFigures5,laterFigures10,capAfter:{US:g.pools.US.capacity,CS:g.pools.CS.capacity,horse:g.horses.capacity},reserve:{...g.reserve},actualAutoPause,unpausedArrival,pausedAfterArrival,autoPauseFalse:actualAutoPause===false,alerts:window.__e2.alerts.length,bannerHidden:document.getElementById('banner').hidden}});record.density={...before,...d};await pause(page);
  });
  await use({width:320,height:768},async page=>{
    const fresh=await state(page);save('density-and-restart',{...record.density,freshZeroIds:fresh.ids,freshSpawns:fresh.spawns});
    await page.locator('#banner-fly').focus();await page.keyboard.press('Enter');await settle(page);
    const narrow=await readable(page,320);record.narrowAxe=narrow.violations;save('narrow-readable-keyboard',narrow);await shot(page,'reinforcement-readable-narrow');
  });
  assert.deepEqual(record.errors,[],'ordinary candidate errors');assert.deepEqual(record.warnings,[],'ordinary candidate warnings, including driver warnings');assert.equal(record.restores.length,3);
  record.controls=readerControls(record.records);assert.equal(record.controls.length,12);record.ok=true;
}

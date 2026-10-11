// Fixed behaviour oracle: Game state digests for the surrender-off path (no source-byte checks).
const LEGACY_EXPECTED=[{"variant":"absent","observed":{"constructorOwnKeys":["scene","terrain","scenario","effects","playerSide","rnd","paused","speed","simTime","selected","selection","listeners","over","controlBoth","spawned","reserve","pools","fallen","halos","impostors","baked","horses","gunPool","entities","units","coverAt","combat","ai","clockStart","clockEnd","objective","fieldCaptures","logSeen","slowT"],"scenarioHash":"8546b96bbdcd79a0be27d67b659bf94e3da9496dfabee946e44ce74230a0c701","hashes":["9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb","c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e","a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94","2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74"],"time":0.5499999999999999,"scenarioExact":true,"definitionsExact":true,"gameDraws":0,"unitDraws":0,"nextGame":0.08001301996409893,"nextUnits":[0.9849907697644085,0.7462286006193608]},"scope":"Actual pre-edit realGame CPU; child exit releases settings listeners; no GPU/native/surrender claim"},{"variant":"false","observed":{"constructorOwnKeys":["scene","terrain","scenario","effects","playerSide","rnd","paused","speed","simTime","selected","selection","listeners","over","controlBoth","spawned","reserve","pools","fallen","halos","impostors","baked","horses","gunPool","entities","units","coverAt","combat","ai","clockStart","clockEnd","objective","fieldCaptures","logSeen","slowT"],"scenarioHash":"0a5c0e5bc5b26949a960355bb79bc9ad8e5298a8d9cf890dafcd67272abee5da","hashes":["9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb","c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e","a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94","2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74"],"time":0.5499999999999999,"scenarioExact":true,"definitionsExact":true,"gameDraws":0,"unitDraws":0,"nextGame":0.08001301996409893,"nextUnits":[0.9849907697644085,0.7462286006193608]},"scope":"Actual pre-edit realGame CPU; child exit releases settings listeners; no GPU/native/surrender claim"},{"variant":"empty","observed":{"constructorOwnKeys":["scene","terrain","scenario","effects","playerSide","rnd","paused","speed","simTime","selected","selection","listeners","over","controlBoth","spawned","reserve","pools","fallen","halos","impostors","baked","horses","gunPool","entities","units","coverAt","combat","ai","clockStart","clockEnd","objective","fieldCaptures","logSeen","slowT"],"scenarioHash":"b005c953255030320a1712e08ecd69af0179ddf8de72d34196f62407802eae88","hashes":["9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb","c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e","a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94","2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74"],"time":0.5499999999999999,"scenarioExact":true,"definitionsExact":true,"gameDraws":0,"unitDraws":0,"nextGame":0.08001301996409893,"nextUnits":[0.9849907697644085,0.7462286006193608]},"scope":"Actual pre-edit realGame CPU; child exit releases settings listeners; no GPU/native/surrender claim"},{"variant":"empty-false","observed":{"constructorOwnKeys":["scene","terrain","scenario","effects","playerSide","rnd","paused","speed","simTime","selected","selection","listeners","over","controlBoth","spawned","reserve","pools","fallen","halos","impostors","baked","horses","gunPool","entities","units","coverAt","combat","ai","clockStart","clockEnd","objective","fieldCaptures","logSeen","slowT"],"scenarioHash":"07d3338c27e4d3de3e3a0f7537cd1184ab484b0a15210ff51a8ee51034348c4d","hashes":["9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb","c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e","a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94","2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74"],"time":0.5499999999999999,"scenarioExact":true,"definitionsExact":true,"gameDraws":0,"unitDraws":0,"nextGame":0.08001301996409893,"nextUnits":[0.9849907697644085,0.7462286006193608]},"scope":"Actual pre-edit realGame CPU; child exit releases settings listeners; no GPU/native/surrender claim"}];
// Node-builtins only until child execution. Each real simulation lives in its own exiting process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync as run} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=x=>hash(JSON.stringify(x)), copy=x=>structuredClone(x);
const self=fileURLToPath(import.meta.url);

const CASES=[
 ['opt-in-before-allocation','refused','opt-in-before-allocation: refusal before allocation'],
 ['default-legacy-fixed-hashes','exact','default-legacy-fixed-hashes: exact parent oracle'],
 ['prepared-initial-future','identity','prepared-initial-future: real source identity'],
 ['symmetric-home-corridor','symmetric','symmetric-home-corridor: symmetric losing origin'],
 ['behind-outside-rescue','clear','behind-outside-rescue: clear corridor no capture'],
 ['current-band-and-grace','six','current-band-and-grace: at least six simulation seconds'],
 ['uninterrupted-time','reset','uninterrupted-time: reset restarts full grace'],
 ['blocked-rally','blocked','blocked-rally: blocked router does not rally'],
 ['post-combat-symmetry','committed','post-combat-symmetry: all candidates before callbacks'],
 ['once-per-source-formation','once','once-per-source-formation: source once'],
 ['fractional-prisoners','exact','fractional-prisoners: exact actual remaining'],
 ['casualty-rng-separate','unchanged','casualty-rng-separate: surrender is no casualty loss'],
 ['physical-gun-identity-condition','conditions','physical-gun-identity-condition: condition conserved'],
 ['prisoner-gun-possession','possession','prisoner-gun-possession: opposite possession'],
 ['original-roster-save','retained','original-roster-save: original roster retained'],
 ['detached-frozen-accounting','prior','detached-frozen-accounting: prior snapshot unchanged'],
 ['paused-terminal-restart','paused','paused-terminal-restart: paused adds zero'],
 ['closed-roster-spawn-remove','closed','closed-roster-spawn-remove: closed roster no refund'],
 ['future-phase-horizon','horizon','future-phase-horizon: horizon exact'],
 ['aggregate-observation-order','common','aggregate-observation-order: common observation time'],
 ['no-additional-rng','zero','no-additional-rng: capture adds zero draws'],
 ['atomic-invalid-accounting','atomic','atomic-invalid-accounting: no surrender mutation on refusal'],
 ['events-selection','pruned','events-selection: captured selection pruned'],
 ['captured-animation-no-deaths','gone','captured-animation-no-deaths: no captured death animation'],
];

// Verifiers bind actual measured values; each mutation alters its own measured field.
function verify(index, data) {
 const [name,,prefix]=CASES[index];
 const equal=(a,b)=>assert.deepEqual(a,b,prefix);
 switch(index){
 case 0:equal(data.rows.map(r=>[r.refused,r.allocations,r.getters]),data.rows.map(()=>[true,0,0]));equal(data.supported,true);break;
 case 1:equal(data.rows,LEGACY_EXPECTED);break;
 case 2:equal(data.ids,['router','enemy','later']);equal(data.bindings,[true,true,true]);equal(data.beforeRefused,true);equal(data.dispatchRefused,true);equal(data.shared,true);break;
 case 3:equal(data.rows.map(r=>[r.origin,r.captor,r.men,r.time,r.roster]),[['US','CS',100,6,2],['CS','US',100,6,2]]);equal(data.tie.sourceOrder,['router','support','first','second']);equal(data.tie.arrivalOrder,['router','support','second','first']);equal(data.tie.captorSide,'CS');equal(data.tie.men,100);equal(data.tie.enemyDistances[0],data.tie.enemyDistances[1]);break;
 case 4:equal(data.clearRows.map(r=>r.count),data.clearRows.map(()=>0));equal(data.equalTieCount,1);break;
 case 5:equal(data.boundary.count,1);equal(data.outside.count,0);assert.ok(data.boundary.at>=6&&data.fixedStep.at>=6,prefix);equal(data.before,0);break;
 case 6:equal(data.beforeRestartGrace,0);assert.ok(data.capturedAt-data.restartAt>=6,prefix);equal(data.resetCounts,[0,0]);break;
 case 7:equal(data.blockedState,'routing');equal(data.blockedRallyT,0);equal(data.clearState,'wavering');break;
 case 8:equal(data.firstSnapshots,[2,2]);equal(data.deadCaptorCount,0);equal(data.routedCaptorCount,0);break;
 case 9:equal(data.counts,[1,1,1]);equal(data.events,1);break;
 case 10:equal(data.rows.map(r=>[r.remaining,r.captured,r.after]),[[10.1,10.1,0],[1.1,1.1,0]]);break;
 case 11:equal(data.after,data.before);equal(data.newDying,0);break;
 case 12:equal(data.conditions,['disabled','serviceable']);equal(data.actualConditions,[false,true]);equal(data.tuples,data.beforeTuples);equal(data.nominal,[2,2]);break;
 case 13:equal(data.rows.map(r=>[r.origin,r.owner,r.captured,r.guns,r.initial]),[['US','CS',100,2,2],['CS','US',100,2,2]]);break;
 case 14:equal(data.afterIds,data.beforeIds);equal(data.men,0);equal(data.guns,0);equal(data.originalCount,data.actualCount);equal(data.equipmentExact,true);equal(data.authentic,true);break;
 case 15:equal(data.beforeHash,data.afterHash);equal(data.frozen,true);equal(data.detached,true);equal(data.writeRefused,true);break;
 case 16:equal(data.pausedElapsed,0);equal(data.pausedCaptures,0);equal(data.terminalRows.map(r=>r.preOver),[false,false]);equal(data.terminalRows.map(r=>r.over),[true,true]);equal(data.terminalRows.map(r=>[r.winner,r.captures]),[['CS',1],['US',1]]);equal(data.freshCaptures,0);equal(data.unblockedOver,true);break;
 case 17:equal(data.after,data.before);equal(data.refusals,[true,true]);equal(data.legacySpawnRemoved,[true,true]);break;
 case 18:equal(data.at,data.expectedHorizon);equal(data.after,data.expectedHorizon);equal(data.over,true);equal(data.arrivalCount,1);equal(data.captureCount,0);break;
 case 19:assert.ok(data.captureTimes[0]>data.captureTimes[1],prefix);equal(data.normalizedTimes,new Array(data.normalizedTimes.length).fill(data.observedAtSec));equal(data.reconstructedHash,data.accountingHash);break;
 case 20:equal(data.draws,{game:0,combat:0,units:[0,0]});equal(data.next,data.expectedNext);equal(data.refusedDraws,0);break;
 case 21:equal(data.after,data.before);equal(data.refused,true);equal(data.recoveryCounts,[0,1]);equal(data.recoveryCaptured,1);equal(data.recoveryAt,6.125);equal(data.cases.map(r=>r.kind),['definition-name','duplicate-roster','missing-roster','NaN-strength','infinite-strength','overspend-strength','gun-condition','gun-tuple']);for(const row of data.cases){equal(row.refused,true);assert.ok(row.message.startsWith('Surrender:'),prefix);equal(row.after,row.before);}break;
 case 22:equal(data.selectedIds,[]);equal(data.snapshotCounts,[2,2]);equal(data.surrenderNames,data.sourceNames);equal(data.rawMen,[100,100]);equal(data.alerts,1);equal(data.untouchedEnemy,true);equal(data.incidentalSelects,0);break;
 case 23:equal(data.newFalls,0);equal(data.liveAfter,0);equal(data.priorDying,data.priorDyingAfter);equal(data.rebuiltLiving,0);equal(data.goneCount,data.formerLiving);break;
 default:throw new Error(name);
 }
}
function semanticMutation(index,data){const x=copy(data);switch(index){
 case 0:x.rows[0].allocations=1;break;case 1:x.rows[0].observed.hashes[0]='bad';break;case 2:x.ids[2]='bad';break;case 3:x.rows[0].origin='CS';break;case 4:x.clearRows[0].count=1;break;case 5:x.boundary.at=5.9;break;case 6:x.capturedAt=x.restartAt+5;break;case 7:x.blockedState='wavering';break;case 8:x.firstSnapshots[0]=1;break;case 9:x.counts.push(2);break;case 10:x.rows[0].captured=Math.floor(x.rows[0].captured);break;case 11:x.after.casualties++;break;case 12:x.conditions[0]='serviceable';break;case 13:x.rows[0].owner='US';break;case 14:x.originalCount++;break;case 15:x.afterHash='bad';break;case 16:x.pausedElapsed=1;break;case 17:x.after.reserve.US++;break;case 18:x.at++;break;case 19:x.normalizedTimes[0]=x.observedAtSec-1;break;case 20:x.draws.units[0]++;break;case 21:x.after.events++;break;case 22:x.selectedIds.push('router');break;case 23:x.newFalls++;break;}return x;}

async function childCase(index){
 const [{Scene},{Game},{Unit},{Battery},phase,{PLAN,setPlan},{RULES},{LOOK},settings,practice,save,reward,{CLOCK_RATIO}]=await Promise.all([
  import('three'),import('../src/game.js'),import('../src/units/unit.js'),import('../src/units/battery.js'),import('../src/sim/phase.js'),import('../src/world/landscape.js'),import('../src/sim/rules.js'),import('../src/ui/look.js'),import('../src/settings.js'),import('../src/franchise/practice.js'),import('../src/franchise/save.js'),import('../src/reward/data.js'),import('../src/sim/combat.js')]);
 RULES.autoPause=false;RULES.battleSpeed=1;settings.set('look.menPerFigure',10);settings.set('look.formationSpacing',1);LOOK.figureStyle='rigged';
 const terrain={half:2000,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},effects={volley(){},boom(){}};
 const def=(id,side='US',extra={})=>({id,name:'Fictional '+id,short:id,side,type:'infantry',men:100,weapon:'smooth',xp:1,commander:null,regiments:[],x:0,z:side==='US'?0:-400,facing:Math.PI/2,sources:[],notes:'DIAGNOSTIC ONLY',...extra});
 const scenario=(units=[def('router'),def('enemy','CS')],extra={})=>({id:'henry-hill',title:'Fictional surrender diagnostic',battle:'DIAGNOSTIC ONLY',date:'1861-07-21',start:'14:00',end:'14:10',units,sites:[],woods:[],objective:{name:'Fictional point',x:1800,z:1800,r:30},surrender:true,...extra});
 function real(s=scenario(),initialize=true){setPlan(s);const g=new Game({scene:new Scene(),terrain,scenario:s,world:{fenceField:null},effects});const events=[],snapshots=[],alerts=[],spawns=[];g.on('event',e=>{events.push({kind:e.kind,name:e.unit?.name,text:e.text});if(e.kind==='surrender')snapshots.push(g.captureSnapshot());});g.on('alert',e=>alerts.push(e));g.on('spawn',u=>{u.holdFire=true;u.manual=true;spawns.push(u);});for(const u of g.units){u.holdFire=true;u.manual=true;}if(initialize)g.initializeReinforcements();return {g,events,snapshots,alerts,spawns};}
 function pair(side='US',extra={},support=false){const other=side==='US'?'CS':'US';const f=real(scenario([def('router',side,{z:0,...extra}),def('enemy',other,{z:side==='US'?-400:400}),...(support||extra.type==='artillery'?[def('support',side,{x:1000,z:0})]:[])]));f.g.combat.rout(f.g.units[0],{forced:true});return f;}
 const advance=(g,n,h=.125)=>{for(let k=0;k<n;k++)g.tick(h);};
 const snapshot=g=>g.captureSnapshot(), captures=g=>snapshot(g).captures;
 const move=(u,x,z)=>{u.vehicle.position.set(x,0,z);};
 const original=g=>({ids:g.units.map(u=>u.id),reserve:{...g.reserve},selected:g.selection.map(u=>u.id),events:0});
 const errors=fn=>{try{fn();return {refused:false,message:null};}catch(e){return {refused:true,message:e.message};}};
 const casualty=u=>({casualties:u.casualties,tickAcc:u.tickAcc,casTick:u.casTick??null,rngNext:null});
 if(index===0){
  const rows=[];for(const kind of ['string','number','null','initial-id','future-id','inherited','getter','caps']){let s=scenario();let getters=0,allocations=0;if(kind==='string')s.surrender='yes';if(kind==='number')s.surrender=1;if(kind==='null')s.surrender=null;if(kind==='initial-id')s.units[0].id='x'.repeat(161);if(kind==='future-id')s.reinforcements=[{...def('x'.repeat(161)),atSec:1,entry:'Fictional edge'}];if(kind==='inherited'){delete s.surrender;Object.setPrototypeOf(s,{surrender:true});}if(kind==='getter')Object.defineProperty(s,'surrender',{get(){getters++;return true;},enumerable:true});if(kind==='caps')s.units[0].men=14481;const scene={add(){allocations++;}};const field=errors(()=>phase.prepareFieldScenario(s,'henry-hill'));const constructor=errors(()=>new Game({scene,terrain,scenario:s,world:{fenceField:null},effects}));rows.push({kind,refused:field.refused&&constructor.refused,allocations,getters,field:field.message,constructor:constructor.message});}
  const f=pair();return {rows,supported:snapshot(f.g).accounting.units.length===2};
 }
 if(index===1){return {rows:runLegacyChild(Game,Scene,setPlan,terrain,effects,RULES,LOOK,settings,PLAN)};}
 if(index===2){const s=scenario(undefined,{reinforcements:[{...def('later','US',{x:700}),atSec:1,entry:'Fictional edge'}]}),f=real(s,false),shared=f.g.units;const beforeRefused=errors(()=>snapshot(f.g)).refused;let dispatchRefused=false;f.g.on('spawn',()=>{dispatchRefused=errors(()=>snapshot(f.g)).refused;});f.g.initializeReinforcements();advance(f.g,8);const r=snapshot(f.g);return {ids:r.accounting.units.map(u=>u.unitId),bindings:f.g.units.map(u=>r.accounting.units.some(r=>r.unitId===u.id)),beforeRefused,dispatchRefused,shared:f.g.units===shared,pools:{US:f.g.pools.US.capacity,CS:f.g.pools.CS.capacity}};}
 if(index===3){const rows=[];for(const side of ['US','CS']){const f=pair(side);advance(f.g,48);const r=captures(f.g)[0];rows.push({origin:r.originSide,captor:r.captorSide,men:r.men,time:r.captureAtSec,roster:f.g.units.length});}const f=real(scenario([def('router'),def('support','US',{x:1500})],{reinforcements:[{...def('first','CS',{x:-100,z:-400}),atSec:2,entry:'Fictional first edge'},{...def('second','CS',{x:100,z:-400}),atSec:.5,entry:'Fictional second edge'}]}));f.g.on('spawn',u=>{u.holdFire=true;u.manual=true;});f.g.combat.rout(f.g.units[0],{forced:true});advance(f.g,56);const x=snapshot(f.g),u=f.g.units[0],enemyDistances=f.g.units.filter(u=>u.side==='CS').map(e=>Math.hypot(e.x-u.x,e.z-u.z));return {rows,tie:{sourceOrder:x.accounting.units.map(r=>r.unitId),arrivalOrder:f.g.units.map(u=>u.id),captorSide:x.captures[0].captorSide,men:x.captures[0].men,enemyDistances,proofLimit:'Actual source-order/chronological-arrival tie outcome; chosen captor id is not exposed. Reviewed source traversal binds tie determinism.'}};}
 if(index===4){const clearRows=[];for(const kind of ['behind','abreast','outside','homeedge','noenemy','nearerfriend']){const f=pair(),[u,e]=f.g.units;if(kind==='behind')move(e,0,400);if(kind==='abreast')move(e,0,0);if(kind==='outside')move(e,221,-400);if(kind==='homeedge')move(e,0,-1960);if(kind==='noenemy')e.men=0;if(kind==='nearerfriend'){const s=scenario([def('router'),def('enemy','CS'),def('friend','US',{x:100,z:0})]);const v=real(s);v.g.combat.rout(v.g.units[0],{forced:true});advance(v.g,48);clearRows.push({kind,count:captures(v.g).length});continue;}advance(f.g,48);clearRows.push({kind,count:captures(f.g).length});}const equal=real(scenario([def('router'),def('enemy','CS',{z:-400}),def('friend','US',{z:-400})]));equal.g.combat.rout(equal.g.units[0],{forced:true});advance(equal.g,48);return {clearRows,equalTieCount:captures(equal.g).length};}
 if(index===5){const b=pair();move(b.g.units[1],220,-400);advance(b.g,47);const before=captures(b.g).length;advance(b.g,1);const boundary={count:captures(b.g).length,at:captures(b.g)[0]?.captureAtSec};const o=pair();move(o.g.units[1],220.0001,-400);advance(o.g,48);const fixed=pair();let n=0;while(!captures(fixed.g).length&&n++<130)fixed.g.tick(.05);return {boundary,outside:{count:captures(o.g).length},before,fixedStep:{at:captures(fixed.g)[0]?.captureAtSec,steps:n}};}
 if(index===6){const f=pair('US',{},true);advance(f.g,24);move(f.g.units[1],500,-400);advance(f.g,1);move(f.g.units[1],0,-400);const restartAt=f.g.simTime;advance(f.g,47);const beforeRestartGrace=captures(f.g).length;advance(f.g,1);const resetCounts=[];for(const kind of ['nonrouting','dead']){const v=pair('US',{},true);advance(v.g,24);if(kind==='nonrouting')v.g.units[0].state='steady';else v.g.units[0].men=0;advance(v.g,1);resetCounts.push(captures(v.g).length);}return {restartAt,beforeRestartGrace,capturedAt:captures(f.g)[0]?.captureAtSec,resetCounts};}
 if(index===7){const b=pair();advance(b.g,47);const blockedState=b.g.units[0].state,blockedRallyT=b.g.units[0].rallyT;const c=pair('US',{},true);move(c.g.units[1],500,-400);advance(c.g,49);return {blockedState,blockedRallyT,clearState:c.g.units[0].state};}
 if(index===8||index===22){
  const firstSnapshots=[],f=real(scenario([def('a','US',{x:-50}),def('b','US',{x:50}),def('enemy','CS')]));for(const u of f.g.units.slice(0,2))f.g.combat.rout(u,{forced:true});f.g.selectMany(f.g.units.slice(0,2));const sourceNames=f.g.units.slice(0,2).map(u=>u.name);if(index===22)RULES.autoPause=true;advance(f.g,48);firstSnapshots.push(f.snapshots[0]?.captures.length);
  const v=real(scenario([def('b','CS',{x:50,z:0}),def('a','CS',{x:-50,z:0}),def('enemy','US',{z:400})]));for(const u of v.g.units.slice(0,2))v.g.combat.rout(u,{forced:true});advance(v.g,48);firstSnapshots.push(v.snapshots[0]?.captures.length);
  if(index===22){const w=pair();w.g.select(w.g.units[1]);const selected=w.g.selected;let selects=0;w.g.on('select',()=>selects++);advance(w.g,48);return {selectedIds:f.g.selection.map(u=>u.id),snapshotCounts:f.snapshots.map(s=>s.captures.length),surrenderNames:f.events.filter(e=>e.kind==='surrender').map(e=>e.name),sourceNames,rawMen:f.snapshots[0].captures.map(r=>r.men),alerts:f.alerts.length,untouchedEnemy:w.g.selected===selected,incidentalSelects:selects};}
  const counts=[];for(const kind of ['dead','routing']){const w=pair();advance(w.g,47);const step=w.g.combat.step.bind(w.g.combat);w.g.combat.step=(h,t)=>{step(h,t);if(kind==='dead')w.g.units[1].takeLosses(100,w.g.fallen.CS,t);else w.g.combat.rout(w.g.units[1],{forced:true});};advance(w.g,1);counts.push(captures(w.g).length);}return {firstSnapshots,deadCaptorCount:counts[0],routedCaptorCount:counts[1]};
 }
 if(index===9){const f=pair();advance(f.g,48);const counts=[captures(f.g).length];advance(f.g,8);counts.push(captures(f.g).length);counts.push(captures(f.g).length);return {counts,events:f.events.filter(e=>e.kind==='surrender').length};}
 if(index===10){const rows=[];for(const losses of [[89,.9],[98,.9]]){const f=pair(),u=f.g.units[0];for(const loss of losses)u.takeLosses(loss,f.g.fallen.US,.01);const remaining=u.men;advance(f.g,48);rows.push({remaining,captured:captures(f.g)[0]?.men,after:u.men,losses:u.casualties});}return {rows};}
 if(index===11){const f=pair(),u=f.g.units[0];u.takeLosses(9.7,f.g.fallen.US,.01);advance(f.g,47);const before=casualty(u),original=u.rnd;let draws=0;u.rnd=()=>{draws++;return original();};before.rngNext=0;advance(f.g,1);const after=casualty(u);after.rngNext=draws;return {before,after,newDying:u.figures.filter(x=>x.dying> .01).length};}
 if(index===12||index===13){const rows=[];let details;for(const side of (index===12?['US']:['US','CS'])){const f=pair(side,{type:'artillery',weapon:'parrott',guns:2}),u=f.g.units[0];u.gunSlots[0].alive=false;const beforeTuples=u.gunSlots.map((g,k)=>({index:k,gun:g.gun,limber:g.limber}));advance(f.g,48);const r=captures(f.g)[0],a=snapshot(f.g).accounting;rows.push({origin:r.originSide,owner:r.guns[0].ownerSide,captured:r.men,guns:r.guns.length,initial:a.totals[side].initialGuns});details={conditions:r.guns.map(g=>g.condition),actualConditions:u.gunSlots.map(g=>g.alive),tuples:u.gunSlots.map((g,k)=>({index:k,gun:g.gun,limber:g.limber})),beforeTuples,nominal:[u.guns,u.gunSlots.length]};}return index===12?details:{rows};}
 if(index===14){const ground=JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json',import.meta.url)));ground.surrender=true;const army=[copy(reward.SAMPLE_ARMY[4]),...copy(reward.SAMPLE_ARMY.slice(0,2))];army[0].men=120;const baseline=save.completedSnapshot({awardId:'old-surrender',army,depot:[],issued:[],seed:902,grade:'Victory'});const manifest=practice.savedDeployment({baseline,ground,awardId:'surrender-new',seed:'surrender-new'});practice.assertSavedLaunch(manifest,baseline);const f=real(manifest.scenario),g=f.g,u=g.units.find(u=>u.type==='artillery'&&u.side==='US'),e=g.units.find(u=>u.side==='CS');for(const v of g.units){v.manual=true;v.holdFire=true;}move(u,0,0);move(e,0,-400);g.combat.rout(u,{forced:true});const infantry=g.units.find(u=>u.type==='infantry'&&u.side==='US');move(infantry,g.objective.x,g.objective.z);const beforeIds=g.units.map(u=>u.id);advance(g,48);move(e,1500,1500);g.fastForward((g.clockEnd-g.clockStart)/CLOCK_RATIO);assert.equal(g.over,true);const outcome=practice.savedOutcome({manifest,game:g}),b=outcome.snapshot.army.find(b=>b.id===u.id);return {beforeIds,afterIds:g.units.map(u=>u.id),men:b.men,guns:b.guns,originalCount:manifest.scenario.units.length,actualCount:g.units.length,equipmentExact:JSON.stringify(u.equipment)===JSON.stringify(u.def.equipment),authentic:practice.assertSavedLaunch(manifest,baseline)===manifest};}
 if(index===15){const f=pair(),prior=snapshot(f.g),beforeHash=digest(prior);advance(f.g,48);const now=snapshot(f.g);const writeRefused=errors(()=>{prior.accounting.units[0].presentMen=0;}).refused;const deep=v=>!v||typeof v!=='object'||Object.isFrozen(v)&&Object.values(v).every(deep);return {beforeHash,afterHash:digest(prior),frozen:deep(now),detached:prior!==now&&prior.accounting.units[0]!==now.accounting.units[0],writeRefused};}
 if(index===16){const f=pair();f.g.paused=true;const t=f.g.simTime;f.g.step(.25);f.g.fastForward(10);const pausedElapsed=f.g.simTime-t,pausedCaptures=captures(f.g).length;f.g.paused=false;const terminalRows=[];for(const side of ['US','CS']){const w=pair(side);advance(w.g,1);const preOver=w.g.over;advance(w.g,64);terminalRows.push({preOver,over:w.g.over,winner:w.g.result?.winner,captures:captures(w.g).length});}const clear=pair();move(clear.g.units[1],500,-400);advance(clear.g,1);return {pausedElapsed,pausedCaptures,terminalRows,freshCaptures:captures(pair().g).length,unblockedOver:clear.g.over};}
 if(index===17){const f=pair(),before=original(f.g);const refusals=[errors(()=>f.g.spawnUnit({side:'US',x:0,z:0})).refused,errors(()=>f.g.removeUnit(f.g.units[0])).refused];const after=original(f.g);const s=scenario();delete s.surrender;const g=real(s).g;const u=g.spawnUnit({side:'US',men:50,x:0,z:0}),removed=g.removeUnit(u);return {before,after,refusals,legacySpawnRemoved:[!!u,removed]};}
 if(index===18){const s=scenario(undefined,{end:'14:01',reinforcements:[{...def('later','US',{x:1000}),atSec:15,entry:'Fictional edge'}]}),f=real(s);advance(f.g,112);f.g.combat.rout(f.g.units[0],{forced:true});advance(f.g,8);const at=f.g.simTime;f.g.tick(1);return {at,after:f.g.simTime,expectedHorizon:15,over:f.g.over,arrivalCount:f.spawns.length,captureCount:captures(f.g).length};}
 if(index===19){const f=real(scenario([def('a','US',{x:1000}),def('enemy-a','CS',{x:1000}),def('enemy-b','CS')],{reinforcements:[{...def('b'),atSec:0,entry:'Fictional edge'}]}));f.g.combat.rout(f.g.units.find(u=>u.id==='b'),{forced:true});advance(f.g,8);f.g.combat.rout(f.g.units.find(u=>u.id==='a'),{forced:true});advance(f.g,48);const x=snapshot(f.g),plan=phase.prepareReinforcementTimeline({version:1,id:'game',title:'Battle runtime',phases:[{id:'battle',scenario:f.g.scenario}]},'battle'),events=[];for(const row of x.accounting.units){const cap=x.captures.find(c=>c.unitId===row.unitId);if(cap)events.push({id:row.unitId+':cap',atSec:x.observedAtSec,unitId:row.unitId,kind:'capture-men',men:cap.men,captorSide:cap.captorSide});if(row.killedWounded)events.push({id:row.unitId+':loss',atSec:x.observedAtSec,unitId:row.unitId,kind:'loss',men:row.killedWounded});}const reconstructed=phase.captureAccounting(plan,{through:x.observedAtSec,events});return {captureTimes:x.captures.map(r=>r.captureAtSec),normalizedTimes:events.map(e=>e.atSec),observedAtSec:x.observedAtSec,reconstructedHash:digest(reconstructed),accountingHash:digest(x.accounting),proofLimit:'Reconstructed equivalent aggregate request, not observed private trace'};}
 if(index===20){const f=pair(),control=pair(),expectedNext=[control.g.rnd(),...control.g.units.map(u=>u.rnd())],g=f.g,gameRnd=g.rnd,combatRnd=g.combat.rnd,unitRnd=g.units.map(u=>u.rnd),draws={game:0,combat:0,units:[0,0]};g.rnd=()=>{draws.game++;return gameRnd();};g.combat.rnd=()=>{draws.combat++;return combatRnd();};g.units.forEach((u,k)=>u.rnd=()=>{draws.units[k]++;return unitRnd[k]();});advance(g,48);const before=digest(draws);errors(()=>g.spawnUnit({side:'US',x:0,z:0}));snapshot(g);const refusedDraws=before===digest(draws)?0:1;return {draws,next:[gameRnd(),...unitRnd.map(r=>r())],expectedNext,refusedDraws};}
 if(index===21){const f=pair(),u=f.g.units[0];advance(f.g,46);const observe=()=>({men:u.men,state:u.state,selection:f.g.selection.map(u=>u.id),events:f.events.length,captures:f.snapshots.length});u.menMax=101;const before=observe();const refused=errors(()=>f.g.tick(.125)).refused;const after=observe();u.menMax=100;advance(f.g,1);const recoveryCounts=[captures(f.g).length];advance(f.g,1);recoveryCounts.push(captures(f.g).length);const cases=[];for(const kind of ['definition-name','duplicate-roster','missing-roster','NaN-strength','infinite-strength','overspend-strength','gun-condition','gun-tuple']){const v=kind.startsWith('gun-')?pair('US',{type:'artillery',weapon:'parrott',guns:2}):pair(),g=v.g,u=g.units[0];advance(g,46);if(kind==='definition-name')u.def.name='Changed source name';if(kind==='duplicate-roster')g.units.push(u);if(kind==='missing-roster')g.units.pop();if(kind==='NaN-strength')u.men=NaN;if(kind==='infinite-strength')u.men=Infinity;if(kind==='overspend-strength')u.men=101;if(kind==='gun-condition')u.gunSlots[0].alive='invalid';if(kind==='gun-tuple')u.gunSlots[0]={...u.gunSlots[0]};const observe=()=>({strength:String(u.men),state:u.state,casualties:u.casualties,selection:g.selection.map(u=>u.id),roster:g.units.map(u=>u.id),events:v.events.length,captures:v.snapshots.length});const before=observe(),error=errors(()=>g.tick(.125)),after=observe();cases.push({kind,before,after,refused:error.refused,message:error.message});}return {before,after,refused,recoveryCounts,recoveryCaptured:captures(f.g).length,recoveryAt:captures(f.g)[0]?.captureAtSec,cases};}
 if(index===23){const f=pair(),u=f.g.units[0];u.takeLosses(20,f.g.fallen.US,.01);const dead=u.figures.find(f=>!f.alive&&!f.gone),priorDying=dead.dying,formerLiving=u.figures.filter(f=>f.alive).length;advance(f.g,48);const goneCount=u.figures.filter(f=>f.gone&&f.dying===0).length;u.animate(.01,f.g.simTime);const priorDyingAfter=dead.dying,newFalls=u.figures.filter(f=>f.dying>.01).length,liveAfter=u.figures.filter(f=>f.alive).length;u.rebuildFigures();return {formerLiving,goneCount,priorDying,priorDyingAfter,newFalls,liveAfter,rebuiltLiving:u.figures.filter(f=>f.alive).length};}
 if(index>=24){const f=pair(),u=f.g.units[0],originalSurrender=Unit.prototype.surrender;let record;const prefixes=['executed-take-losses: surrender adds no casualties','executed-remove-unit: source roster and reserve retained','executed-rounded-return: exact surrendered men returned'];try{const before={casualties:u.casualties,ids:f.g.units.map(u=>u.id),reserve:{...f.g.reserve}};u.reserveFigs=17;if(index===24)Unit.prototype.surrender=function(){this.takeLosses(this.men,f.g.fallen[this.side],.01);return 0;};if(index===25)Unit.prototype.surrender=function(){const k=f.g.units.indexOf(this);if(k>=0)f.g.units.splice(k,1);f.g.reserve[this.side]+=this.reserveFigs||0;return 0;};if(index===26){u.takeLosses(89,f.g.fallen.US,.01);u.takeLosses(.9,f.g.fallen.US,.01);Unit.prototype.surrender=function(){return Math.floor(originalSurrender.call(this));};}const remaining=u.men,returned=u.surrender();try{if(index===24)assert.equal(u.casualties,before.casualties,prefixes[0]);if(index===25)assert.deepEqual({ids:f.g.units.map(u=>u.id),reserve:{...f.g.reserve}},{ids:before.ids,reserve:before.reserve},prefixes[1]);if(index===26)assert.equal(returned,remaining,prefixes[2]);throw new Error('executed fault escaped');}catch(e){assert.equal(e.code,'ERR_ASSERTION');assert.ok(e.message.startsWith(prefixes[index-24]));record={name:['executed-take-losses','executed-remove-unit','executed-rounded-return'][index-24],kind:'executed',code:e.code,message:e.message,remaining,returned,casualties:u.casualties,roster:f.g.units.map(u=>u.id),reserve:f.g.reserve};}}finally{Unit.prototype.surrender=originalSurrender;delete u.reserveFigs;}return record;}
 throw new Error('Unknown child case '+index);
}

export function runSurrenderRuntime(){
 const categories=[];for(let index=0;index<24;index++){const text=run(process.execPath,[self,'--child',String(index)],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});const data=JSON.parse(text);verify(index,data);categories.push({name:CASES[index][0],data});}
 const controls=[];for(let index=0;index<24;index++){try{verify(index,semanticMutation(index,categories[index].data));throw new Error('semantic mutation escaped');}catch(e){assert.equal(e.code,'ERR_ASSERTION');assert.ok(e.message.startsWith(CASES[index][2]));controls.push({name:CASES[index][0],kind:'semantic',code:e.code,message:e.message});}}
 for(let index=24;index<27;index++)controls.push(JSON.parse(run(process.execPath,[self,'--child',String(index)],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000})));
 assert.equal(controls.length,27);assert.equal(new Set(controls.map(c=>c.name)).size,27);
 return {categories,controls,native:false,scope:'Opt-in real Game CPU surrender; no GPU/native/reward capture or history authority'};
}

const direct=process.argv[1]&&fs.existsSync(process.argv[1])&&pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url;
if(direct){
 if(process.argv[2]==='--child')console.log(JSON.stringify(await childCase(Number(process.argv[3]))));
 else {const actual=runSurrenderRuntime();console.log('SURRENDER RUNTIME ACTUAL '+JSON.stringify(actual));console.log('SURRENDER RUNTIME OK (24/24)');if(process.argv.includes('--prove-fail')){for(const c of actual.controls)console.log('CAUGHT '+c.name+' '+c.code+' '+c.message);console.log('SURRENDER RUNTIME CONTROLS '+JSON.stringify(actual.controls));console.log('SURRENDER RUNTIME MUTANTS CAUGHT (27/27; 24 semantic readers, 3 executed Unit API faults)');}}
}

function runLegacyChild(Game,Scene,setPlan,_terrain,_effects,RULES,LOOK,settings,PLAN){
const copy = x => structuredClone(x);
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
const definition = (id, side = 'US', extra = {}) => ({ id, name: 'Fictional ' + id, short: id,
  side, type: 'infantry', men: 50, weapon: 'smooth', xp: 1, commander: null, regiments: [],
  x: side === 'US' ? -500 : 500, z: 0, facing: side === 'US' ? Math.PI / 2 : -Math.PI / 2,
  sources: [], notes: 'DIAGNOSTIC ONLY', ...extra });
const arrival = (id = 'arrival-us', side = 'US', extra = {}) => definition(id, side,
  { atSec: 1, entry: 'Fictional ' + side + ' edge', ...extra });
function fixture(rows = [arrival()]) {
  return { id: 'henry-hill', title: 'Fictional current-ground diagnostic', battle: 'DIAGNOSTIC ONLY',
    date: '1861-07-21', start: '14:00', end: '14:01',
    units: [definition('initial-us', 'US', { x: -600 }), definition('initial-cs', 'CS', { x: 600 })],
    sites: [], woods: [], objective: { name: 'Fictional point', x: -600, z: 0, r: 30 }, reinforcements: rows };
}
function real(s = fixture(), Type = Game) {
  setPlan(s);
  const game = new Type({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
  const events = [], spawns = [], alerts = [];
  game.on('event', e => events.push({ kind: e.kind, text: e.text, id: e.unit?.id ?? null, side: e.side }));
  game.on('spawn', u => spawns.push(u.id));
  game.on('alert', e => alerts.push({ ...e, ids: game.units.map(u => u.id) }));
  return { game, events, spawns, alerts, scenario: s };
}
function initialized(s = fixture(), Type = Game) {
  const f = real(s, Type); f.game.initializeReinforcements(); return f;
}
const rejects = fn => { try { fn(); return false; } catch (e) { return /^(Phase|Field|Reinforcements):/.test(e.message); } };
const caps = g => ({ US: g.pools.US.capacity, CS: g.pools.CS.capacity,
  fallenUS: g.fallen.US.capacity, fallenCS: g.fallen.CS.capacity,
  impostorUS: g.impostors.US.capacity, impostorCS: g.impostors.CS.capacity, halo: g.halos.capacity });
const ids = g => g.units.map(u => u.id);
const state = g => ({ time: g.simTime, over: g.over, paused: g.paused, units: g.units.map(u => ({ id: u.id,
  men: u.men, figures: u.figures, order: u.order })), reserve: g.reserve, spawned: g.spawned,
  captured: g.fieldCaptures.crates });

// Fixed actual parent f95ac81c Game oracle, captured BEFORE runtime edits on 2026-10-08.
// Expected values are never recomputed from a candidate.
const LEGACY_FIXTURE_SHA = '8546b96bbdcd79a0be27d67b659bf94e3da9496dfabee946e44ce74230a0c701';
const LEGACY_HASHES = ['9ab38cd555d5cdded561ce470de082e0f90434c02d6c649e9139cb8cbdd1f6bb',
  'c2755fca68297fae4df45c95779f4ff400db4ac1eb95f5bb93fbe30bbfd79a8e',
  'a311ba82b43b894c018314f0bd90f93df20f02703b0923499d5ad36b09dcef94',
  '2699974aafe9fff00d5d60f496cddddc189109048bdfa87c250d1e6ea45a5b74'];
function legacy(empty, Type, flag) {
  const s = fixture([]); if (!empty) delete s.reinforcements;
  if (flag === false) s.surrender = false;
  const absent = copy(s); delete absent.reinforcements; delete absent.surrender;
  assert.equal(digest(absent), LEGACY_FIXTURE_SHA);
  const g = real(s, Type).game;
  const constructorOwnKeys = Object.keys(g); const scenarioHash = digest(s);
  const hashes = [digest(g.units.map(u => ({ id: u.id, figures: u.figures, officer: u.officer, order: u.order })))];
  let gameDraws = 0, unitDraws = 0;
  const gr = g.rnd, ur = g.units.map(u => u.rnd);
  g.rnd = () => { gameDraws++; return gr(); }; // Combat retains its original captured function.
  g.units.forEach((u, k) => { u.rnd = () => { unitDraws++; return ur[k](); }; });
  const capture = () => ({ time: g.simTime, over: g.over, paused: g.paused, holder: g.holder,
    objT: g.objT, slowT: g.slowT, aiT: g.ai.t, units: g.units.map(u => ({ id: u.id, x: u.x, z: u.z,
      facing: u.facing, goalFacing: u.goalFacing, men: u.men, morale: u.morale, fatigue: u.fatigue,
      ammo: u.ammo, state: u.state, order: u.order, figures: u.figures,
      vehiclePosition: [u.vehicle.position.x, u.vehicle.position.y, u.vehicle.position.z],
      vehicleVelocity: [u.vehicle.velocity.x, u.vehicle.velocity.y, u.vehicle.velocity.z] })), gameDraws, unitDraws });
  try {
    g.units[0].orderMove([[-600, 0], [-600, 100]], { endFacing: Math.PI / 2 });
    for (let n = 0; n < 8; n++) g.tick(.05);
    hashes.push(digest(capture())); g.paused = true; g.fastForward(.101);
    hashes.push(digest(capture())); g.over = true; g.fastForward(0); hashes.push(digest(capture()));
    return { constructorOwnKeys, scenarioHash, hashes, time: g.simTime, scenarioExact: g.scenario === s,
      definitionsExact: g.units.every((u, k) => u.def === s.units[k]), gameDraws, unitDraws,
      nextGame: gr(), nextUnits: ur.map(r => r()) };
  } finally { g.rnd = gr; g.units.forEach((u, k) => { u.rnd = ur[k]; }); }
}

function isolated(fn) {
  const rules = { ...RULES }, look = { ...LOOK }, plan = { ...PLAN };
  const density = settings.get('look.menPerFigure'), spacing = settings.get('look.formationSpacing');
  try { RULES.autoPause = false; RULES.battleSpeed = 1; settings.set('look.menPerFigure', 10);
    settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged'; return fn(); }
  finally { settings.set('look.menPerFigure', density); settings.set('look.formationSpacing', spacing);
    Object.assign(RULES, rules); Object.assign(LOOK, look); Object.assign(PLAN, plan);
    assert.deepEqual(RULES, rules); assert.deepEqual(LOOK, look);
    for (const key of Object.keys(plan)) assert.equal(PLAN[key], plan[key]); }
}

return ["absent","false","empty","empty-false"].map(variant=>({variant,observed:isolated(()=>legacy(variant.startsWith("empty"),Game,variant.includes("false")?false:undefined)),scope:"Actual pre-edit realGame CPU; child exit releases settings listeners; no GPU/native/surrender claim"}));
}

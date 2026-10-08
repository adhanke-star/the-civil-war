// Each actual Game runs in a serial exiting CPU child. No browser or native claims.
const SOURCE_PATHS=["tools/test.mjs",".github/workflows/ci.yml","src/sim/phase.js","tools/test-reinforcements.mjs","src/main.js","sw.js","src/entry.js","src/ui/entry.js","tools/test-field-admission.mjs","tools/test-field-admission-ui.mjs","tools/test-deployment-ui.mjs","tools/test-phase.mjs","index.html","src/ui/hud.js","src/ui/hud.css","src/ui/input.js","tools/test-soldier-view-ui.mjs","tools/test-view-ui.mjs","tools/test-keyboard.mjs","src/render/rts-camera.js","tools/test-view.mjs","src/ui/readout.js","src/render/post.js","src/render/soldier-view.js","tools/test-soldier-view.mjs","tools/test-header-ui.mjs","tools/test-intro-ui.mjs","src/ui/entry.css","src/franchise/practice.js","src/franchise/practice-ui.js","src/ui/practice-field.js","src/reward/sequence.js","src/reward/reward.css","tools/test-deployment.mjs","src/franchise/save.js","src/reward/model.js","src/reward/data.js","src/units/unit.js","src/units/battery.js","src/sim/combat.js","src/game.js","src/ui/arrows.js","src/sim/rules.js","src/franchise/intro.js","assets/scenarios/henry-hill.json","src/world/terrain.js","src/world/landscape.js","src/world/props.js","src/world/labels.js","src/sim/equipment.js","tools/test-equipment.mjs","src/units/impostor.js","tools/test-dock-ui.mjs","src/world/world.js","src/sim/ai.js","src/franchise/captures.js","tools/test-reinforcement-runtime.mjs","tools/test-reinforcement-ui.mjs","tools/test-capture-accounting.mjs","tools/test-surrender-runtime.mjs","tools/test-surrender-result.mjs"];
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync as run } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const self = fileURLToPath(import.meta.url), copy = x => structuredClone(x);
const hash = b => createHash('sha256').update(b).digest('hex'), digest = x => hash(JSON.stringify(x));
const CASES = [
 ['inactive-result','null legacy projection'], ['terminal-binding','exact terminal encounter'],
 ['symmetric-prisoners','correct origin and captor'], ['fractional-counts','exact raw prisoners'],
 ['casualty-separation','disjoint losses'], ['physical-guns','possession distinct from condition'],
 ['pending-original-sources','pending is no capture'], ['readonly-runtime','no model mutation'],
 ['detached-frozen','immutable detached result'], ['invalid-source-refusal','original provenance retained'],
 ['saved-reward-lock','no new award'], ['original-label-and-order','authored records exact']
];
export function verifySurrenderResult(index, data) {
 const prefix = CASES[index].join(': '), equal = (a,b) => assert.deepEqual(a,b,prefix);
 switch(index) {
 case 0: equal(data.rows.map(r=>[r.value,r.same,r.draws]),[[null,true,0],[null,true,0]]);equal(data.snapshotGetterReads,0);equal(data.inactiveGuard,null);break;
 case 1: equal(data.refusals.map(r=>[r.refused,r.message]),[
  [true,'Practice: surrender result needs a completed encounter.'],[true,'Practice: surrender result needs the exact encounter.'],
  [true,'Practice: surrender result needs a completed encounter.'],[true,'Surrender: initialize the complete source roster before observing captures.'],
  [true,'Practice: invalid surrender activation descriptor.'],[true,'Practice: invalid surrender activation descriptor.'],
  [true,'Practice: invalid surrender activation value.'],[true,'Practice: invalid surrender activation value.']]);
  equal(data.flagGetterReads,0);equal([data.over,data.winner,data.observedAtSec,data.captureAtSec,data.snapshotCalls],[true,'CS',6.125,6,1]);break;
 case 2: equal(data.rows.map(r=>[r.origin,r.winner,r.captured,r.taken,r.ownTaken,r.time,r.captureAtSec]),[['US','CS',100,100,0,6.125,6],['CS','US',100,100,0,6.125,6]]);break;
 case 3: equal(data.rows.map(r=>[r.before,r.captured,r.taken,r.present]),[[10.1,10.1,10.1,0],[1.1,1.1,1.1,0]]);break;
 case 4: equal([data.killed,data.captured,data.present,data.beforeCasualties,data.afterCasualties],[30,70,0,30,30]);break;
 case 5: equal([data.taken,data.disabled,data.lost,data.nominal,data.conditions,data.sameSlots],[2,1,2,2,['disabled','serviceable'],true]);equal(data.guns,data.expectedGuns);break;
 case 6: equal([data.over,data.time,data.captureAtSec,data.pendingMen,data.taken,data.formations,data.futureOwner,data.futureArrived],[true,6.125,6,100,0,['router'],'US',false]);break;
 case 7: equal(data.afterDigest,data.beforeDigest);equal(data.draws,{game:0,combat:0,units:[0,0]});equal(data.next,data.expectedNext);equal(data.calls,2);break;
 case 8: equal([data.frozen,data.detached,data.writeRefused,data.aliases],[true,true,true,false]);equal(data.afterHash,data.beforeHash);break;
 case 9: equal(data.rows.map(r=>r.kind),['definition-name','unit-name','duplicate-roster','missing-roster','NaN-strength','infinite-strength','overspend-strength','gun-condition','gun-piece']);for(const r of data.rows){equal(r.refused,true);assert.ok(r.message.startsWith('Surrender:'),prefix);equal(r.after,r.before);equal(r.priorAfter,r.priorBefore);}break;
 case 10: equal([data.authentic,data.sameToken,data.sameInventory,data.sameExport,data.sameCards,data.men,data.guns],[true,true,true,true,true,0,0]);equal(data.cardCount,data.beforeCardCount);break;
 case 11: equal(data.ids,['a','b']);equal(data.labels,['Fictional a','Fictional b']);equal(data.times,[7,6]);equal(data.observedAtSec,7.125);equal(data.afterReplaceHash,data.beforeReplaceHash);equal(data.labels,data.originalLiveLabels);break;
 default: throw new Error('Unknown result verifier');
 }
}
export function surrenderResultMutation(index, data) {
 const x=copy(data);
 switch(index){case 0:x.rows[0].value={};break;case 1:x.refusals[0].refused=false;break;
 case 2:x.rows[0].taken=0;break;case 3:x.rows[0].captured=Math.floor(x.rows[0].captured);break;
 case 4:x.killed+=x.captured;break;case 5:x.disabled=0;break;case 6:x.formations.push('future');break;
 case 7:x.afterDigest='mutated';break;case 8:x.frozen=false;break;case 9:x.rows[0].refused=false;break;
 case 10:x.cardCount++;break;case 11:x.labels[0]='Fabricated';break;}return x;
}

async function childCase(index) {
 const [{Scene},{Game},{setPlan},{RULES},{LOOK},settings,practice,save,reward,{CLOCK_RATIO}]=await Promise.all([
  import('three'),import('../src/game.js'),import('../src/world/landscape.js'),import('../src/sim/rules.js'),
  import('../src/ui/look.js'),import('../src/settings.js'),import('../src/franchise/practice.js'),
  import('../src/franchise/save.js'),import('../src/reward/data.js'),import('../src/sim/combat.js')]);
 RULES.autoPause=false;RULES.battleSpeed=1;settings.set('look.menPerFigure',10);settings.set('look.formationSpacing',1);LOOK.figureStyle='rigged';
 const terrain={half:2000,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},effects={volley(){},boom(){}};
 const def=(id,side='US',extra={})=>({id,name:'Fictional '+id,short:id,side,type:'infantry',men:100,weapon:'smooth',xp:1,
  commander:null,regiments:[],x:0,z:side==='US'?0:-400,facing:Math.PI/2,sources:[],notes:'DIAGNOSTIC ONLY',...extra});
 const scenario=(units=[def('router'),def('enemy','CS')],extra={})=>({id:'henry-hill',title:'Fictional result diagnostic',battle:'DIAGNOSTIC ONLY',
  date:'1861-07-21',start:'14:00',end:'14:10',units,sites:[],woods:[],objective:{name:'Fictional point',x:1800,z:1800,r:30},surrender:true,...extra});
 function real(s=scenario(),initialize=true){setPlan(s);const g=new Game({scene:new Scene(),terrain,scenario:s,world:{fenceField:null},effects}),events=[];
  g.on('event',e=>events.push({kind:e.kind,name:e.unit?.name,text:e.text}));g.on('spawn',u=>{u.manual=true;u.holdFire=true;});
  for(const u of g.units){u.manual=true;u.holdFire=true;}if(initialize)g.initializeReinforcements();return{g,events};}
 const advance=(g,n)=>{for(let k=0;k<n;k++)g.tick(.125);};
 const move=(u,x,z)=>u.vehicle.position.set(x,0,z);
 const errors=fn=>{try{fn();return{refused:false,message:null};}catch(e){return{refused:true,message:e.message};}};
 function pair(side='US',extra={},support=false){const f=real(scenario([def('router',side,{z:0,...extra}),
  def('enemy',side==='US'?'CS':'US',{z:side==='US'?-400:400}),...(support?[def('support',side,{x:1000})]:[])],extra.type==='artillery'?{end:'14:01'}:{}));
  f.g.combat.rout(f.g.units[0],{forced:true});return f;}
 const model=g=>practice.surrenderOutcome({game:g,scenario:g.scenario});
 function outcome(g){const v=model(g);assert.deepEqual(Object.keys(v),['observedAtSec','sides','formations']);
  assert.deepEqual(Object.keys(v.sides),['US','CS']);for(const side of Object.values(v.sides))assert.deepEqual(Object.keys(side),[
   'initialMen','presentMen','pendingMen','killedWounded','missingMen','capturedMen','prisonersTaken','gunsLost','gunsTaken','disabledGunsTaken']);
  for(const f of v.formations){assert.deepEqual(Object.keys(f),['unitId','label','originSide','captorSide','men','captureAtSec','guns']);
   for(const gun of f.guns)assert.deepEqual(Object.keys(gun),['unitId','gunIndex','originSide','originWeapon','ownerSide','condition','arrived']);}return v;}
 const state=f=>({clock:[f.g.simTime,f.g.clockStart,f.g.clockEnd,f.g.over,f.g.result],selection:f.g.selection.map(u=>u.id),selected:f.g.selected?.id,
  events:f.events,reserve:f.g.reserve,units:f.g.units.map(u=>({id:u.id,name:u.name,side:u.side,men:u.men,menMax:u.menMax,state:u.state,casualties:u.casualties,
   def:u.def,equipment:u.equipment,order:u.order,holdFire:u.holdFire,target:u.target?.id,x:u.x,z:u.z,guns:u.guns,
   slots:u.gunSlots?.map(s=>({alive:s.alive,gun:s.gun?.uuid,limber:s.limber?.uuid}))})),capture:f.g.captureSnapshot()});
 const finished=f=>{advance(f.g,49);assert.equal(f.g.over,true);return f;};
 if(index===0){const rows=[];for(const flag of ['absent','false']){const s=scenario();if(flag==='absent')delete s.surrender;else s.surrender=false;
   const f=real(s),before=digest(state(f));const original=f.g.rnd;let draws=0;f.g.rnd=()=>{draws++;return original();};
   const value=model(f.g);rows.push({flag,value,same:digest(state(f))===before,draws});f.g.rnd=original;}
  let snapshotGetterReads=0;const s={surrender:false},mock={scenario:s};Object.defineProperty(mock,'captureSnapshot',{get(){snapshotGetterReads++;throw new Error('inactive guard');}});
  return{rows,snapshotGetterReads,inactiveGuard:practice.surrenderOutcome({game:mock,scenario:s}),guardScope:'Labelled query accessor diagnostic; actual legacy Games measured separately'};}
 if(index===1){const f=pair(),refusals=[errors(()=>model(f.g))];finished(f);const s=f.g.scenario;
  refusals.push(errors(()=>practice.surrenderOutcome({game:f.g,scenario:{...s,surrender:false}})));
  const result=f.g.result;try{f.g.result={...result,winner:'invalid'};refusals.push(errors(()=>model(f.g)));}finally{f.g.result=result;}
  const uninitialized=real(scenario(),false);refusals.push(errors(()=>practice.surrenderOutcome({game:{scenario:uninitialized.g.scenario,over:true,result:{winner:'US'},
   captureSnapshot:()=>uninitialized.g.captureSnapshot()},scenario:uninitialized.g.scenario})));
  let flagGetterReads=0;for(const kind of ['inherited','getter','string','null']){const q={};if(kind==='inherited')Object.setPrototypeOf(q,{surrender:true});
   else if(kind==='getter')Object.defineProperty(q,'surrender',{get(){flagGetterReads++;return true;}});else q.surrender=kind==='string'?'yes':null;
   refusals.push(errors(()=>practice.surrenderOutcome({game:{scenario:q},scenario:q})));}
  const method=f.g.captureSnapshot;let snapshotCalls=0;let v;try{f.g.captureSnapshot=function(){assert.equal(this,f.g);snapshotCalls++;return method.call(this);};v=outcome(f.g);}finally{f.g.captureSnapshot=method;}
  return{refusals,flagGetterReads,over:f.g.over,winner:f.g.result.winner,observedAtSec:v.observedAtSec,captureAtSec:v.formations[0].captureAtSec,snapshotCalls,
   uninitializedScope:'Labelled terminal query diagnostic bound to actual uninitialized Game owner; no forced runtime terminal state'};}
 if(index===2){const rows=[];for(const side of ['US','CS']){const f=finished(pair(side)),v=outcome(f.g),other=side==='US'?'CS':'US';rows.push({origin:side,winner:f.g.result.winner,
  captured:v.sides[side].capturedMen,taken:v.sides[other].prisonersTaken,ownTaken:v.sides[side].prisonersTaken,time:v.observedAtSec,captureAtSec:v.formations[0].captureAtSec});}return{rows};}
 if(index===3){const rows=[];for(const losses of [[89,.9],[98,.9]]){const f=pair(),u=f.g.units[0];for(const n of losses)u.takeLosses(n,f.g.fallen.US,.01);
  const before=u.men;finished(f);const v=outcome(f.g);rows.push({before,captured:v.sides.US.capturedMen,taken:v.sides.CS.prisonersTaken,present:v.sides.US.presentMen});}return{rows};}
 if(index===4){const f=pair(),u=f.g.units[0];u.takeLosses(30,f.g.fallen.US,.01);finished(f);const beforeCasualties=u.casualties,v=outcome(f.g);
  return{killed:v.sides.US.killedWounded,captured:v.sides.US.capturedMen,present:v.sides.US.presentMen,beforeCasualties,afterCasualties:u.casualties};}
 if(index===5){const f=pair('US',{type:'artillery',weapon:'parrott',guns:2},true),u=f.g.units[0],slots=u.gunSlots.slice();u.gunSlots[0].alive=false;
  advance(f.g,120);assert.equal(f.g.over,true);const v=outcome(f.g),snap=f.g.captureSnapshot();return{taken:v.sides.CS.gunsTaken,disabled:v.sides.CS.disabledGunsTaken,
   lost:v.sides.US.gunsLost,nominal:u.guns,conditions:v.formations[0].guns.map(g=>g.condition),sameSlots:u.gunSlots.every((s,k)=>s===slots[k]),
   guns:v.formations[0].guns,expectedGuns:snap.captures[0].guns};}
 if(index===6){const f=real(scenario(undefined,{end:'14:01',reinforcements:[{...def('future','US',{type:'artillery',guns:2,weapon:'smbart',x:1000}),atSec:12,entry:'Fictional edge'}]}));
  f.g.combat.rout(f.g.units[0],{forced:true});finished(f);const v=outcome(f.g),future=f.g.captureSnapshot().accounting.units.find(r=>r.unitId==='future');
  return{over:f.g.over,time:v.observedAtSec,captureAtSec:v.formations[0].captureAtSec,pendingMen:v.sides.US.pendingMen,taken:v.sides.CS.gunsTaken,formations:v.formations.map(r=>r.unitId),
   futureOwner:future.guns[0].ownerSide,futureArrived:future.guns[0].arrived};}
 if(index===7){const f=finished(pair()),control=finished(pair()),g=f.g,expectedNext=[control.g.rnd(),...control.g.units.map(u=>u.rnd())];
  const gameRnd=g.rnd,combatRnd=g.combat.rnd,unitRnd=g.units.map(u=>u.rnd),method=g.captureSnapshot,draws={game:0,combat:0,units:[0,0]};let calls=0;
  const beforeDigest=digest(state(f));g.rnd=()=>{draws.game++;return gameRnd();};g.combat.rnd=()=>{draws.combat++;return combatRnd();};
  g.units.forEach((u,k)=>u.rnd=()=>{draws.units[k]++;return unitRnd[k]();});let afterDigest;
  try{g.captureSnapshot=function(){calls++;return method.call(this);};outcome(g);outcome(g);g.captureSnapshot=method;afterDigest=digest(state(f));}
  finally{g.rnd=gameRnd;g.combat.rnd=combatRnd;g.units.forEach((u,k)=>u.rnd=unitRnd[k]);g.captureSnapshot=method;}
  return{beforeDigest,afterDigest,draws,next:[gameRnd(),...unitRnd.map(r=>r())],expectedNext,calls};}
 if(index===8){const f=pair('US',{type:'artillery',weapon:'parrott',guns:2},true);advance(f.g,120);const snap=f.g.captureSnapshot(),a=outcome(f.g),b=outcome(f.g),beforeHash=digest(a);
  const deep=x=>!x||typeof x!=='object'||Object.isFrozen(x)&&Object.values(x).every(deep);
  const refs=x=>!x||typeof x!=='object'?[]:[x,...Object.values(x).flatMap(refs)];const oldRefs=new Set(refs(snap)),aRefs=new Set(refs(a));
  const writeRefused=errors(()=>{a.formations[0].guns[0].ownerSide='US';}).refused;
  return{frozen:deep(a)&&deep(b),detached:!refs(b).some(x=>aRefs.has(x)),aliases:refs(a).some(x=>oldRefs.has(x)),writeRefused,beforeHash,afterHash:digest(a)};}
 if(index===9){const rows=[];for(const kind of ['definition-name','unit-name','duplicate-roster','missing-roster','NaN-strength','infinite-strength','overspend-strength','gun-condition','gun-piece']){
   const f=pair('US',{type:'artillery',weapon:'parrott',guns:2},true);advance(f.g,120);const g=f.g,u=g.units[0],prior=outcome(g),priorBefore=digest(prior),roster=g.units.slice(),name=u.name,
    defName=u.def.name,men=u.men,slot=u.gunSlots[0],alive=slot.alive;
   const observe=()=>digest({time:g.simTime,ids:g.units.map(u=>u.id),men:String(u.men),state:u.state,casualties:u.casualties,events:f.events,prior});
   try{if(kind==='definition-name')u.def.name='Changed';if(kind==='unit-name')u.name='Changed';if(kind==='duplicate-roster')g.units.push(u);
    if(kind==='missing-roster')g.units.pop();if(kind==='NaN-strength')u.men=NaN;if(kind==='infinite-strength')u.men=Infinity;
    if(kind==='overspend-strength')u.men=101;if(kind==='gun-condition')slot.alive='invalid';if(kind==='gun-piece')u.gunSlots[0]={...slot};
    const before=observe(),error=errors(()=>model(g));rows.push({kind,...error,before,after:observe(),priorBefore,priorAfter:digest(prior)});
   }finally{u.name=name;u.def.name=defName;u.men=men;slot.alive=alive;u.gunSlots[0]=slot;g.units.splice(0,g.units.length,...roster);}
  }return{rows};}
 if(index===10){const ground=JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json',import.meta.url)));ground.surrender=true;
  const army=[copy(reward.SAMPLE_ARMY[4]),...copy(reward.SAMPLE_ARMY.slice(0,2))];army[0].men=120;
  const baseline=save.completedSnapshot({awardId:'old-surrender-result',army,depot:[],issued:[],seed:902,grade:'Victory'});
  const manifest=practice.savedDeployment({baseline,ground,awardId:'surrender-result-new',seed:'surrender-result-new'}),f=real(manifest.scenario),g=f.g,
   u=g.units.find(u=>u.type==='artillery'&&u.side==='US'),enemy=g.units.find(u=>u.side==='CS');
  move(u,0,0);move(enemy,0,-400);g.combat.rout(u,{forced:true});const infantry=g.units.find(u=>u.type==='infantry'&&u.side==='US');move(infantry,g.objective.x,g.objective.z);
  advance(g,48);move(enemy,1500,1500);g.fastForward((g.clockEnd-g.clockStart)/CLOCK_RATIO);assert.equal(g.over,true);
  const before=practice.savedOutcome({manifest,game:g}),beforeExport=save.exportSnapshot(before.snapshot),beforeInventory=digest(before.snapshot),beforeCards=digest(before.cards);
  outcome(g);const after=practice.savedOutcome({manifest,game:g}),b=after.snapshot.army.find(b=>b.id===u.id);
  return{authentic:practice.assertSavedLaunch(manifest,baseline)===manifest,sameToken:before===after,sameInventory:beforeInventory===digest(after.snapshot),
   sameExport:beforeExport===save.exportSnapshot(save.parseSnapshot(save.exportSnapshot(after.snapshot))),sameCards:beforeCards===digest(after.cards),
   men:b.men,guns:b.guns,cardCount:after.cards.length,beforeCardCount:before.cards.length};}
 if(index===11){const f=real(scenario([def('a','US',{x:1000}),def('enemy-a','CS',{x:1000}),def('enemy-b','CS')],
   {reinforcements:[{...def('b'),atSec:0,entry:'Fictional edge'}]}));f.g.combat.rout(f.g.units.find(u=>u.id==='b'),{forced:true});advance(f.g,8);
  f.g.combat.rout(f.g.units.find(u=>u.id==='a'),{forced:true});advance(f.g,49);assert.equal(f.g.over,true);
  const v=outcome(f.g),s=f.g.scenario,units=s.units,future=s.reinforcements,beforeReplaceHash=digest(v);let afterReplaceHash;
  try{s.units=units.map(d=>({...d,name:'Caller fabricated name',weapon:'rifled',equipment:{changed:true}}));
   s.reinforcements=future.map(d=>({...d,name:'Caller fabricated arrival',weapon:'rifled',equipment:{changed:true}}));afterReplaceHash=digest(outcome(f.g));}
  finally{s.units=units;s.reinforcements=future;}
  return{ids:v.formations.map(r=>r.unitId),labels:v.formations.map(r=>r.label),times:v.formations.map(r=>r.captureAtSec),observedAtSec:v.observedAtSec,beforeReplaceHash,afterReplaceHash,
   originalLiveLabels:v.formations.map(r=>f.g.units.find(u=>u.id===r.unitId).name)};}
 throw new Error('Unknown child case');
}
export function runSurrenderResult() {
 const categories=[];for(let index=0;index<12;index++){
  const data=JSON.parse(run(process.execPath,[self,'--child',String(index)],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000}));
  verifySurrenderResult(index,data);categories.push({name:CASES[index][0],data});}
 const controls=[];for(let index=0;index<12;index++){try{verifySurrenderResult(index,surrenderResultMutation(index,categories[index].data));throw new Error('Semantic mutation escaped');}
  catch(e){assert.equal(e.code,'ERR_ASSERTION');assert.ok(e.message.startsWith(CASES[index].join(': ')));controls.push({name:CASES[index][0],kind:'semantic',code:e.code,message:e.message});}}
 assert.equal(new Set(controls.map(c=>c.name)).size,12);
 const sources=SOURCE_PATHS.map(path=>{const b=fs.readFileSync(new URL('../'+path,import.meta.url));return{path,bytes:b.length,sha256:hash(b)};});
 return{categories,controls,sources,native:false,scope:'Terminal read-only result of actual opt-in Game CPU captures; no new reward, UI, history or native authority'};
}
const direct=process.argv[1]&&fs.existsSync(process.argv[1])&&pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url;
if(direct){if(process.argv[2]==='--child')console.log(JSON.stringify(await childCase(Number(process.argv[3]))));else{
 const actual=runSurrenderResult();console.log('SURRENDER RESULT ACTUAL '+JSON.stringify(actual));console.log('SURRENDER RESULT OK (12/12)');
 if(process.argv.includes('--prove-fail')){for(const c of actual.controls)console.log('CAUGHT '+c.name+' '+c.code+' '+c.message);
  console.log('SURRENDER RESULT CONTROLS '+JSON.stringify(actual.controls));console.log('SURRENDER RESULT MUTANTS CAUGHT (12/12; semantic readers)');}
}}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {captureAccounting, prepareReinforcementTimeline, FIELD_LIMITS, PHASE_LIMITS} from '../src/sim/phase.js';

const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Test evidence fingerprints inspect descriptors without invoking rejected getters/toJSON.
const fingerprint = value => {
  const seen=new Map();
  const inspect=value=>{
    if(value===null||typeof value!=='object')return typeof value==='number'&&!Number.isFinite(value)?String(value):typeof value==='function'?'[function]':typeof value==='symbol'?'[symbol]':value;
    if(seen.has(value))return ['reference',seen.get(value)];seen.set(value,seen.size);
    return Reflect.ownKeys(value).map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return [typeof key==='symbol'?'[symbol]':key,d.enumerable,d.configurable,Object.hasOwn(d,'value')?inspect(d.value):'[accessor]'];});
  };
  return hash(inspect(value));
};
const unit = (id, side, men, extra = {}) => ({id, name:'Fictional '+id, side, men, x:0, z:0, facing:0, ...extra});
const pack = () => ({version:1,id:'capture-fixture',title:'Fictional accounting diagnostics',phases:[
  {id:'first',scenario:{id:'fictional-first',title:'Fictional first phase',battle:'DIAGNOSTIC ONLY',date:'1862-04-06',start:'05:00',end:'06:00',
    objective:{name:'Fictional point',x:0,z:0,r:20},units:[unit('us','US',100),unit('cs','CS',80),
      unit('us-guns','US',16,{type:'artillery',guns:2,weapon:'parrott'}),unit('cs-guns','CS',12,{type:'artillery',guns:1})],
    reinforcements:[unit('late-us','US',30,{atSec:30,noticeSec:10,entry:'Fictional edge'}),
      unit('early-cs','CS',8,{type:'artillery',guns:1,weapon:'napoleon',atSec:10,noticeSec:5,entry:'Fictional edge'})]}},
  {id:'second',scenario:{id:'fictional-second',title:'Fictional second phase',battle:'DIAGNOSTIC ONLY',date:'1862-04-07',start:'06:00',end:'07:00',
    objective:{name:'Fictional point',x:0,z:0,r:20},units:[unit('us','US',50)]}},
]});
const prepare = (value=pack(), id='first') => prepareReinforcementTimeline(value,id);
const trace = (events=[],through=900) => ({through,events});
const men = (id,kind='loss',amount=10,unitId='us',atSec=1,extra={}) => ({id,atSec,unitId,kind,men:amount,...extra});
const gun = (id,kind='capture-gun',unitId='us-guns',gunIndex=0,captorSide='CS',atSec=1) =>
  ({id,atSec,unitId,kind,gunIndex,...(kind==='capture-gun'?{captorSide}:{})});
const row = (result,id) => result.units.find(unit=>unit.unitId===id);
const schema = result => {
  const keys=(value,expected)=>assert.deepEqual(Object.keys(value),expected);
  for(const unit of result.units){keys(unit,['unitId','originSide','arrivalAtSec','arrived','initialMen','presentMen','pendingMen','killedWounded','missingMen','capturedMen','capturedBy','guns']);keys(unit.capturedBy,['US','CS']);for(const gun of unit.guns)keys(gun,['unitId','gunIndex','originSide','originWeapon','ownerSide','condition','arrived']);}
  keys(result.totals,['US','CS']);keys(result.possession,['US','CS']);
  for(const side of ['US','CS']){keys(result.totals[side],['initialMen','presentMen','pendingMen','killedWounded','missingMen','capturedMen','capturedBy','initialGuns','pendingGuns','retainedGuns','netCapturedGuns','disabledGuns']);keys(result.totals[side].capturedBy,['US','CS']);keys(result.possession[side],['totalGuns','fieldGuns','pendingGuns']);}
};
const conservation = (result,label) => {
  for(const value of [...result.units,result.totals.US,result.totals.CS]) {
    const sum=value.presentMen+value.pendingMen+value.killedWounded+value.missingMen+value.capturedMen;
    assert.ok(Math.abs(value.initialMen-sum)<=16*Number.EPSILON*Math.max(1,value.initialMen),label+': men conservation');
  }
  assert.equal(result.possession.US.totalGuns+result.possession.CS.totalGuns,result.totals.US.initialGuns+result.totals.CS.initialGuns,label+': physical guns');
};
const frozen = (value,label) => {if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value),label+': deep freeze');for(const child of Object.values(value))frozen(child,label);}};

// Each category asserts actual query results and/or exact Phase refusals. Controls run only their paired category.
export const CAPTURE_ACCOUNTING_CHECKS = [
  ['empty-trace',a=>{const r=a.query(prepare(),trace());assert.deepEqual(Object.keys(r),['packId','phaseId','through','applied','replayed','units','totals','possession']);schema(r);assert.equal(r.applied,0);assert.equal(r.replayed,0);for(const u of r.units){assert.equal(u.capturedMen,0,'empty-trace: captured zero');assert.equal(u.killedWounded,0);assert.equal(u.missingMen,0);assert.equal(u.presentMen,u.initialMen);}conservation(r,'empty-trace');}],
  ['phase-identity',a=>{const p=pack(),r=a.query(prepare(p),trace()),s=a.query(prepare(p,'second'),trace());assert.equal(r.packId,p.id);assert.equal(r.phaseId,'first','phase-identity: first phase');assert.equal(s.phaseId,'second');assert.deepEqual(r.units.map(u=>u.unitId),['us','cs','us-guns','cs-guns','late-us','early-cs']);assert.deepEqual(s.units.map(u=>[u.unitId,u.initialMen]),[['us',50]]);}],
  ['future-roster-pending',a=>{const r=a.query(prepare(),trace([],0));assert.equal(row(r,'late-us').pendingMen,30,'future-roster-pending: pending men');assert.equal(row(r,'early-cs').pendingMen,8);assert.equal(r.totals.CS.pendingGuns,1);assert.deepEqual(r.possession.CS,{totalGuns:2,fieldGuns:1,pendingGuns:1});assert.equal(r.totals.CS.retainedGuns,2);assert.equal(r.units.filter(u=>!u.arrived).length,2);conservation(r,'future-roster-pending');}],
  ['arrival-boundaries',a=>{const p=prepare();for(const through of [0,5,9.999,10,29.999,30,900]){const r=a.query(p,trace([],through));assert.equal(row(r,'early-cs').arrived,through>=10);assert.equal(row(r,'late-us').arrived,through>=30);conservation(r,'arrival-boundaries');}a.refuse(p,trace([men('prearrival','loss',1,'late-us',20)],30),'prearrival','not yet arrived');const r=a.query(p,trace([men('inclusive','loss',1,'late-us',30)],30));assert.equal(row(r,'late-us').presentMen,29);}],
  ['current-query-budgets',a=>{
    const bounded=(guns)=>{const p=pack();p.phases[0].scenario.units=[unit('us','US',50),unit('b','CS',8,{type:'artillery',guns})];delete p.phases[0].scenario.reinforcements;return prepare(p);};
    assert.equal(a.query(bounded(24),trace()).totals.CS.initialGuns,24);
    for(const guns of [25,1000000])a.refuse(bounded(guns),trace(),'oversize-guns-'+guns,'applicability bounds');
    const p=pack();delete p.phases[0].scenario.reinforcements;p.phases[0].scenario.units=Array.from({length:10},(_,i)=>unit('tiny-'+i,i%2?'US':'CS',1));assert.equal(a.query(prepare(p),trace()).units.length,10);
    p.phases[0].scenario.units.push(unit('eleven','US',1));a.refuse(prepare(p),trace(),'oversize-formations','applicability bounds');
    p.phases[0].scenario.units=[unit('big','US',14480)];assert.equal(a.query(prepare(p),trace()).totals.US.initialMen,14480);
    p.phases[0].scenario.units[0].men=14481;a.refuse(prepare(p),trace(),'oversize-men','applicability bounds');
    p.phases[0].scenario.units=[...Array.from({length:9},(_,i)=>unit('tiny-'+i,'US',1)),unit('b','CS',11681,{type:'artillery',guns:1})];const t=prepare(p);assert.equal(t.budget.total.figures,2980);a.refuse(t,trace(),'oversize-conservative-figures','figure bounds');
    p.phases[0].scenario.units=[unit('b','CS',11896,{type:'artillery',guns:1})];assert.equal(Math.max(1,Math.round(11896/4))+6,FIELD_LIMITS.figures);assert.equal(a.query(prepare(p),trace()).units.length,1);
    p.phases[0].scenario.units[0].men=11900;a.refuse(prepare(p),trace(),'oversize-figures','figure bounds');
  }],
  ['men-loss-conservation',a=>{const p=prepare(),r=a.query(p,trace([men('l','loss',20),men('c','loss',7,'cs',2)]));assert.equal(row(r,'us').presentMen,80,'men-loss-conservation: remaining men');assert.equal(r.totals.US.killedWounded,20);assert.equal(r.totals.CS.killedWounded,7);conservation(r,'men-loss-conservation');for(const amount of [101,0,-1,Infinity,NaN])a.refuse(p,trace([men('invalid','loss',amount)]),'invalid-loss-'+amount,'');}],
  ['prisoner-subset-captor',a=>{const r=a.query(prepare(),trace([men('p','capture-men',13,'us',1,{captorSide:'CS'}),men('q','capture-men',9,'cs',2,{captorSide:'US'})]));conservation(r,'prisoner-subset-captor');assert.equal(row(r,'us').presentMen,87);assert.deepEqual(row(r,'us').capturedBy,{US:0,CS:13});assert.deepEqual(r.totals.CS.capturedBy,{US:9,CS:0});assert.equal(r.totals.US.capturedMen,13);assert.equal(r.totals.US.killedWounded,0);a.refuse(prepare(),trace([men('self','capture-men',1,'us',1,{captorSide:'US'})]),'self-prisoners','opposite origin');}],
  ['missing-conservation',a=>{const r=a.query(prepare(),trace([men('m','missing',12),men('n','missing',4,'cs',2)],2));assert.equal(row(r,'us').missingMen,12,'missing-conservation: missing distinct');assert.equal(row(r,'us').capturedMen,0);assert.equal(r.totals.US.missingMen,12);assert.equal(r.totals.CS.missingMen,4);assert.equal(row(r,'late-us').pendingMen,30);conservation(r,'missing-conservation');}],
  ['fractional-loss-progress',a=>{const p=prepare(),r=a.query(p,trace([men('decimal','loss',.1),men('fraction','capture-men',.2,'us',2,{captorSide:'CS'})]));assert.equal(row(r,'us').killedWounded,.1,'fractional-loss-progress: exact fractional loss');assert.equal(row(r,'us').capturedMen,.2);assert.equal(row(r,'us').presentMen,100-(.1+.2));conservation(r,'fractional-loss-progress');a.refuse(p,trace([men('tiny','loss',Number.MIN_VALUE)]),'sub-ulp','representable progress');a.refuse(p,trace([men('a','loss',99.9),men('b','missing',.10000000000001,'us',2)]),'fractional-overspend','overspends');}],
  ['physical-gun-identity',a=>{const r=a.query(prepare(),trace());const g=r.units.flatMap(u=>u.guns);assert.equal(g.length,4);assert.equal(new Set(g.map(x=>JSON.stringify([x.unitId,x.gunIndex]))).size,4,'physical-gun-identity: unique tuples');assert.deepEqual(g.map(x=>[x.unitId,x.gunIndex,x.originSide,x.originWeapon]),[['us-guns',0,'US','parrott'],['us-guns',1,'US','parrott'],['cs-guns',0,'CS',null],['early-cs',0,'CS','napoleon']]);a.refuse(prepare(),trace([gun('inf','capture-gun','us',0)]),'infantry-gun','gun identity');}],
  ['disabled-ownership-distinct',a=>{const p=prepare(),e=gun('disable','disable-gun'),r=a.query(p,trace([e,e]));assert.equal(row(r,'us-guns').guns[0].condition,'disabled');assert.equal(row(r,'us-guns').guns[0].ownerSide,'US','disabled-ownership-distinct: retained ownership');assert.equal(r.totals.US.disabledGuns,1);assert.equal(r.totals.US.netCapturedGuns,0);assert.equal(r.totals.US.killedWounded,0);assert.deepEqual([r.applied,r.replayed],[1,1]);a.refuse(p,trace([e,{...e,id:'new-disable'}]),'fresh-duplicate-disable','makes no change');}],
  ['symmetric-gun-transfer',a=>{const p=prepare(),r=a.query(p,trace([gun('u'),gun('c','capture-gun','cs-guns',0,'US',2)]));assert.equal(row(r,'us-guns').guns[0].ownerSide,'CS');assert.equal(row(r,'cs-guns').guns[0].ownerSide,'US','symmetric-gun-transfer: opposite transfer');assert.equal(r.totals.US.netCapturedGuns,1);assert.equal(r.totals.CS.netCapturedGuns,1);conservation(r,'symmetric-gun-transfer');for(const e of [gun('self','capture-gun','us-guns',0,'US'),gun('wrong','capture-gun','us-guns',0,'XX'),gun('index','capture-gun','us-guns',2),gun('unknown','capture-gun','absent',0)])a.refuse(p,trace([e]),'invalid-transfer-'+e.id,'');}],
  ['retake-net-conservation',a=>{const r=a.query(prepare(),trace([gun('d','disable-gun'),gun('take','capture-gun','us-guns',0,'CS',2),gun('retake','capture-gun','us-guns',0,'US',3)]));assert.equal(r.applied,3);assert.equal(r.totals.US.netCapturedGuns,0,'retake-net-conservation: net capture zero');assert.equal(r.totals.US.retainedGuns,2);assert.equal(r.totals.US.disabledGuns,1);assert.equal(row(r,'us-guns').guns[0].condition,'disabled');assert.equal(row(r,'us-guns').guns[0].ownerSide,'US');conservation(r,'retake-net-conservation');}],
  ['canonical-exact-replay',a=>{const e=men('first'),reordered={men:10,kind:'loss',unitId:'us',atSec:1,id:'first'},r=a.query(prepare(),trace([e,men('later','missing',5,'us',2),reordered]));assert.equal(r.applied,2,'canonical-exact-replay: applied once');assert.equal(r.replayed,1);assert.equal(row(r,'us').presentMen,85);const g=gun('take');const q=a.query(prepare(),trace([g,gun('return','capture-gun','us-guns',0,'US',2),g]));assert.deepEqual([q.applied,q.replayed],[2,1]);assert.equal(row(q,'us-guns').guns[0].ownerSide,'US');}],
  ['changed-id-refusal',a=>{const p=prepare(),e=men('reused');assert.equal(a.query(p,trace([e,{...e}])).applied,1);for(const [key,value] of [['men',11],['atSec',2],['unitId','cs'],['kind','missing']])a.refuse(p,trace([e,{...e,[key]:value}]),'changed-id-'+key,'changed payload');const g=gun('reused-gun');a.refuse(p,trace([g,{...g,gunIndex:1}]),'changed-gun-slot','changed payload');a.refuse(p,trace([men('captor','capture-men',1,'us',1,{captorSide:'CS'}),men('captor','capture-men',1,'us',1,{captorSide:'US'})]),'changed-captor','changed payload');}],
  ['time-and-event-shapes',a=>{const p=prepare();assert.equal(a.query(p,trace([men('tie-a'),men('tie-b','missing',2,'cs')])).applied,2);const bad=[null,{}, {...men('x'),kind:'unsupported'}, {...men('x'),extra:1}, {...men('x'),men:undefined}, {...men('x'),atSec:-1}, {...men('x'),atSec:901}, {...gun('x'),gunIndex:.5}, {...men('x'),id:''}];for(let i=0;i<bad.length;i++)a.refuse(p,trace([bad[i]]),'bad-shape-'+i,'');a.refuse(p,trace([men('later','loss',1,'us',2),men('earlier','loss',1,'us',1)]),'decreasing-time','chronological');for(const through of [-1,901,NaN])a.refuse(p,trace([],through),'bad-through-'+through,'');}],
  ['atomic-rejection',a=>{const p=prepare(),good=a.query(p,trace([men('good')])),t=trace([men('prefix'),{...men('suffix'),kind:'unsupported'}]),before=[hash(p),hash(t),hash(good)];a.refuse(p,t,'atomic-suffix','kind is unsupported');assert.equal(hash(t),before[1],'atomic-rejection: input unchanged');assert.equal(hash(p),before[0]);assert.equal(hash(good),before[2]);a.note({kind:'atomic-hashes',before,after:[hash(p),hash(t),hash(good)]});assert.equal(a.query(p,trace([men('again')])).units[0].presentMen,90);}],
  ['caller-detachment',a=>{const p=prepare(),t=trace([men('mutable')]),r=a.query(p,t);assert.equal(r.units[0].presentMen,90);const before=hash(r);t.events[0].men=20;t.events.push(men('new','missing',1,'us',2));assert.equal(r.units[0].presentMen,90,'caller-detachment: prior primitive independent');assert.equal(hash(r),before);assert.equal(r.applied,1);assert.equal(Object.hasOwn(r,'events'),false);a.note({kind:'detachment-hashes',before,after:hash(r),callerAfter:hash(t)});}],
  ['deep-freeze',a=>{const p=prepare(),r=a.query(p,trace([gun('d','disable-gun')]));frozen(r,'deep-freeze');const before=hash(r),planHash=hash(p);assert.throws(()=>{r.units[0].presentMen=0;},TypeError);assert.throws(()=>{r.units[2].guns[0].ownerSide='CS';},TypeError);assert.throws(()=>{r.totals.US.capturedBy.CS=10;},TypeError);assert.equal(hash(r),before);assert.equal(hash(p),planHash);}],
  ['prepared-token-and-json',a=>{const p=prepare();assert.equal(a.query(p,trace()).phaseId,'first');for(const candidate of [clone(p),Object.freeze(clone(p)),{},null])a.refuse(candidate,trace(),'cloned-plan','prepared reinforcement');let calls=0;const accessor={through:900,events:[]};Object.defineProperty(accessor,'events',{enumerable:true,get(){calls++;return [];}});const bad=[null,{through:900,events:new Array(1)},accessor,{through:900,events:[],toJSON(){calls++;return {}; }},{through:900,events:[],[Symbol('x')]:1},Object.assign(Object.create({}),trace()),{through:900,events:[],extra:'x'.repeat(PHASE_LIMITS.bytes)}];let deep=0;for(let i=0;i<40;i++)deep={child:deep};bad.push({through:900,events:[],deep});const cyc=trace();cyc.events.push(cyc);bad.push(cyc);const hidden=trace();Object.defineProperty(hidden,'hidden',{value:1});bad.push(hidden);for(let i=0;i<bad.length;i++)a.refuse(p,bad[i],'unsafe-json-'+i,'');assert.equal(calls,0);const large=pack();large.phases[0].scenario.units=[unit('x'.repeat(60000),'US',8,{type:'artillery',guns:24})];delete large.phases[0].scenario.reinforcements;a.refuse(prepare(large),trace(),'oversize-output','structural byte limit');}],
];

function runCategory(index, query=captureAccounting) {
  const [category, test]=CAPTURE_ACCOUNTING_CHECKS[index], observed=[];
  const a={note:value=>observed.push(value),query(plan,input){const output=query(plan,input);observed.push({kind:'query',plan:{packId:plan.packId,phaseId:plan.phaseId,budget:plan.budget,sourceIds:[...plan.scenario.units,...(plan.scenario.reinforcements||[])].map(u=>u.id),sha256:hash(plan)},input:clone(input),output:clone(output)});return output;},
    refuse(plan,input,label,message){const before={plan:fingerprint(plan),input:fingerprint(input)};let error;try{query(plan,input);}catch(e){error=e;}assert.ok(error instanceof Error&&error.message.startsWith('Phase:')&&error.message.includes(message),category+': expected Phase refusal '+label);const after={plan:fingerprint(plan),input:fingerprint(input)};observed.push({kind:'refusal',label,message:error.message,budget:plan?.budget??null,before,after,unchanged:before.plan===after.plan&&before.input===after.input});}};
  test(a);return {category,observed};
}

const alter = (query, change) => (plan,input) => {const out=clone(query(plan,input));change(out,input);return out;};
const good = () => captureAccounting(prepare(),trace());
const controls = [
  alter(captureAccounting,r=>{r.units[0].capturedMen=1;}),
  alter(captureAccounting,r=>{r.phaseId='wrong';}),
  alter(captureAccounting,r=>{row(r,'late-us').pendingMen=0;r.totals.CS.pendingGuns=0;}),
  (p,t)=>t?.events?.[0]?.id==='prearrival'?good():captureAccounting(p,t),
  (p,t)=>p.budget.total.guns>24?good():captureAccounting(p,t),
  alter(captureAccounting,r=>{r.units[0].presentMen--; }),
  alter(captureAccounting,r=>{r.totals.US.presentMen-=r.totals.US.capturedMen;}),
  alter(captureAccounting,r=>{r.units[0].capturedMen+=r.units[0].missingMen;r.units[0].missingMen=0;}),
  alter(captureAccounting,r=>{r.units[0].killedWounded=Math.round(r.units[0].killedWounded);r.units[0].capturedMen=Math.round(r.units[0].capturedMen);}),
  alter(captureAccounting,r=>{r.units[2].guns[1]={...r.units[2].guns[0]};}),
  alter(captureAccounting,r=>{r.units[2].guns[0].ownerSide='CS';}),
  alter(captureAccounting,r=>{r.units[3].guns[0].ownerSide='CS';}),
  alter(captureAccounting,r=>{r.totals.US.netCapturedGuns=1;}),
  alter(captureAccounting,r=>{r.applied+=r.replayed;}),
  (p,t)=>t?.events?.length===2&&t.events[0].id===t.events[1].id&&t.events[0].men!==t.events[1].men?captureAccounting(p,trace([t.events[0],t.events[0]],t.through)):captureAccounting(p,t),
  (p,t)=>t?.events?.[0]===null?good():captureAccounting(p,t),
  (p,t)=>{try{return captureAccounting(p,t);}catch(error){if(t?.events?.[1]?.id==='suffix'&&error.message.startsWith('Phase:'))t.events[0].men++;throw error;}},
  (p,t)=>{const r=clone(captureAccounting(p,t)),initial=t.events[0]?.men;if(t.events[0]?.id==='mutable')Object.defineProperty(r.units[0],'presentMen',{enumerable:true,get:()=>90-(t.events[0].men-initial)});return r;},
  (p,t)=>clone(captureAccounting(p,t)),
  (p,t)=>{try{return captureAccounting(p,t);}catch(error){if(error.message==='Phase: capture accounting needs a prepared reinforcement timeline.'&&p&&p.phaseId==='first'&&t&&Array.isArray(t.events))return good();throw error;}},
];
const intendedMessages=['empty-trace: captured zero','phase-identity: first phase','future-roster-pending: pending men','arrival-boundaries: expected Phase refusal prearrival','current-query-budgets: expected Phase refusal oversize-guns-25','men-loss-conservation: remaining men','prisoner-subset-captor: men conservation','missing-conservation: missing distinct','fractional-loss-progress: exact fractional loss','physical-gun-identity: unique tuples','disabled-ownership-distinct: retained ownership','symmetric-gun-transfer: opposite transfer','retake-net-conservation: net capture zero','canonical-exact-replay: applied once','changed-id-refusal: expected Phase refusal changed-id-men','time-and-event-shapes: expected Phase refusal bad-shape-0','atomic-rejection: input unchanged','caller-detachment: prior primitive independent','deep-freeze: deep freeze','prepared-token-and-json: expected Phase refusal cloned-plan'];

export function captureAccountingActual() {return {scope:'Pure immutable query diagnostics; no runtime eligibility/Game/GPU/storage/history authority',native:false,categories:CAPTURE_ACCOUNTING_CHECKS.map((_,i)=>runCategory(i))};}
export function captureAccountingControls() {return controls.map((control,i)=>{let caught;try{runCategory(i,control);}catch(error){caught=error;}assert.ok(caught?.code==='ERR_ASSERTION'&&caught.message.includes(intendedMessages[i]),'Control '+CAPTURE_ACCOUNTING_CHECKS[i][0]+' missed its intended assertion: '+caught?.message);return {category:CAPTURE_ACCOUNTING_CHECKS[i][0],code:caught.code,intended:intendedMessages[i],message:caught.message,semantic:true};});}
export function captureAccountingEvidence() {return {...captureAccountingActual(),controls:captureAccountingControls()};}
export function captureAccountingUnit() {const actual=captureAccountingActual();captureAccountingControls();return actual.categories.length;}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){const actual=captureAccountingActual();console.log('CAPTURE ACCOUNTING ACTUAL '+JSON.stringify(actual));console.log('CAPTURE ACCOUNTING OK (20/20)');if(process.argv.includes('--prove-fail')){const controls=captureAccountingControls();for(const row of controls)console.log('CAUGHT '+row.category+' '+row.code+' '+row.intended);console.log('CAPTURE ACCOUNTING CONTROLS '+JSON.stringify(controls));console.log('CAPTURE ACCOUNTING MUTANTS CAUGHT (20/20)');}}

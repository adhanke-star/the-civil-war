import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {prepareReinforcementTimeline, reinforcementWindow} from '../src/sim/phase.js';
import {introScenario} from '../src/franchise/intro.js';

const clone = x => structuredClone(x);
const unit = (id, side, men, extra = {}) => ({id, name: 'Generic fictional ' + id, side, men, x: 0, z: 0, facing: 0, ...extra});
const pack = () => ({version: 1, id: 'timeline-fixture', title: 'Fictional reinforcement diagnostics', phases: [
  {id: 'first', scenario: {id: 'fictional-first', title: 'Fictional first phase', battle: 'DIAGNOSTIC ONLY', date: '1862-04-06', start: '05:00', end: '06:00',
    units: [unit('initial-us', 'US', 1000), unit('initial-cs', 'CS', 600)], objective: {name: 'Fixture point', x: 0, z: 0, r: 20},
    opening: [{id: 'initial-cs', points: [[0, 0], [10, 10]]}],
    reinforcements: [
      unit('us-later', 'US', 500, {atSec: 30, noticeSec: 10, entry: 'Fictional western edge', notes: 'DIAGNOSTIC ONLY', sources: [{status: 'Inferred', quote: 'Fixture text'}]}),
      unit('cs-guns', 'CS', 80, {type: 'artillery', weapon: 'parrott', guns: 2, atSec: 10, noticeSec: 5, entry: 'Fictional northern edge'}),
      unit('us-first', 'US', 400, {atSec: 10, noticeSec: 5, entry: 'Fictional eastern edge'}),
      unit('us-tie', 'US', 200, {atSec: 10, noticeSec: 1, entry: 'Fictional southern edge'}),
    ]}},
  {id: 'second', scenario: {id: 'fictional-second', title: 'Fictional second phase', battle: 'DIAGNOSTIC ONLY', date: '1862-04-07', start: '06:00', end: '07:00',
    units: [unit('initial-us', 'US', 800)], objective: {name: 'Next fixture point', x: 0, z: 0, r: 20}}},
]});
const ids = rows => rows.map(row => row.unit.id);
const reject = fn => assert.throws(fn, /^Error: Phase:/);
const bad = change => {const p = pack(); change(p, p.phases[0].scenario, p.phases[0].scenario.reinforcements[0]); return p;};
const freeze = value => {if (value && typeof value === 'object') {assert.ok(Object.isFrozen(value)); for (const row of Object.values(value)) freeze(row);}};
const api = {prepare: prepareReinforcementTimeline, window: reinforcementWindow};
export const REINFORCEMENT_CHECKS = [
  ['empty-schedule', a => {const p = bad((p,s) => {delete s.reinforcements;}); const t = a.prepare(p,'first'); assert.deepEqual(t.events,[]);assert.deepEqual(t.notices,[]);assert.deepEqual(a.window(t,{after:null,through:0}).pending,{US:0,CS:0});}],
  ['existing-scenarios', a => {const old=JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json',import.meta.url)));for(const s of [old,introScenario(old)]){const p={version:1,id:'existing',title:'Existing data',phases:[{id:'first',scenario:s}]};const t=a.prepare(p,'first');assert.deepEqual(t.scenario,s);assert.deepEqual(t.events,[]);assert.equal(t.budget.total.formations,s.units.length);}}],
  ['phase-identity', a => {const p=pack(),t=a.prepare(p,'first'),z=a.prepare(p,'second');assert.deepEqual([t.packId,t.phaseId,t.index,t.previousId,t.nextId,t.horizon],[p.id,'first',0,null,'second',900]);assert.deepEqual([z.phaseId,z.previousId,z.nextId],['second','first',null]);reject(()=>a.prepare(p,'absent'));}],
  ['stable-order', a => {const t=a.prepare(pack(),'first');assert.deepEqual(ids(t.events),['cs-guns','us-first','us-tie','us-later']);assert.deepEqual(t.events.map(e=>e.sourceIndex),[1,2,3,0]);assert.deepEqual(ids(t.notices),['cs-guns','us-first','us-tie','us-later']);assert.deepEqual(t.notices.map(e=>e.noticeAtSec),[5,5,9,20]);}],
  ['arrival-boundaries', a => {const t=a.prepare(pack(),'first');assert.deepEqual(ids(a.window(t,{after:null,through:9.999}).arrivals),[]);assert.deepEqual(ids(a.window(t,{after:9.999,through:10}).arrivals),['cs-guns','us-first','us-tie']);const p=bad((p,s,u)=>{u.atSec=0;u.noticeSec=0;});const z=a.prepare(p,'first');assert.deepEqual(ids(a.window(z,{after:null,through:0}).arrivals),['us-later']);assert.deepEqual(a.window(z,{after:0,through:0}).arrivals,[]);}],
  ['contiguous-windows', a => {const t=a.prepare(pack(),'first');const seen=[];let after=null;for(const through of [0,5,10,10,29,30,900]){const w=a.window(t,{after,through});seen.push(...ids(w.arrivals));after=through;}assert.deepEqual(seen,['cs-guns','us-first','us-tie','us-later']);assert.equal(new Set(seen).size,4);assert.deepEqual(ids(a.window(t,{after:null,through:10}).arrivals),['cs-guns','us-first','us-tie']);}],
  ['overshoot-window', a => {const t=a.prepare(pack(),'first');assert.deepEqual(ids(a.window(t,{after:0,through:40}).arrivals),ids(t.events));assert.deepEqual(a.window(t,{after:40,through:900}).arrivals,[]);}],
  ['advance-notice', a => {const t=a.prepare(pack(),'first');assert.deepEqual(ids(a.window(t,{after:0,through:5}).notices),['cs-guns','us-first']);assert.deepEqual(a.window(t,{after:0,through:5}).arrivals,[]);assert.deepEqual(ids(a.window(t,{after:5,through:9}).notices),['us-tie']);const p=bad((p,s,u)=>{delete u.noticeSec;});const z=a.prepare(p,'first');const w=a.window(z,{after:29,through:30});assert.deepEqual(ids(w.notices),['us-later']);assert.deepEqual(ids(w.arrivals),['us-later']);assert.equal(w.notices[0],w.arrivals[0]);}],
  ['pending-sides', a => {const t=a.prepare(pack(),'first');assert.deepEqual(a.window(t,{after:null,through:9}).pending,{US:3,CS:1});assert.deepEqual(a.window(t,{after:9,through:10}).pending,{US:1,CS:0});assert.deepEqual(a.window(t,{after:10,through:30}).pending,{US:0,CS:0});}],
  ['combined-budgets', a => {const t=a.prepare(pack(),'first');assert.deepEqual(t.budget,{US:{formations:4,men:2100,guns:0,figures:444},CS:{formations:2,men:680,guns:2,figures:152},total:{formations:6,men:2780,guns:2,figures:596}});const p=bad((p,s)=>{s.units=[unit('small-us','US',2),unit('small-cs','CS',3),unit('small-us-guns','US',6,{type:'artillery',guns:1}),unit('small-cs-guns','CS',5,{type:'artillery',guns:1})];s.opening=[];s.reinforcements=[];});assert.deepEqual(a.prepare(p,'first').budget,{US:{formations:2,men:8,guns:1,figures:14},CS:{formations:2,men:8,guns:1,figures:14},total:{formations:4,men:16,guns:2,figures:28}});}],
  ['detached-metadata', a => {const p=pack(),before=clone(p),t=a.prepare(p,'first');assert.deepEqual(p,before);assert.deepEqual(t.scenario,p.phases[0].scenario);assert.notEqual(t.scenario,p.phases[0].scenario);p.phases[0].scenario.reinforcements[0].sources[0].quote='Caller changed';assert.equal(t.events[3].unit.sources[0].quote,'Fixture text');assert.equal(t.events[3].unit.sources[0].status,'Inferred');}],
  ['deep-freeze', a => {const t=a.prepare(pack(),'first');freeze(t);const w=a.window(t,{after:null,through:40});freeze(w);assert.throws(()=>{t.events[0].unit.men=1;},TypeError);assert.throws(()=>{w.pending.US=99;},TypeError);}],
  ['whole-pack-schedules', a => {reject(()=>a.prepare(bad(p=>{p.phases[1].scenario.reinforcements=[unit('other','US',1,{atSec:901,entry:'Fixture edge'})];}),'first'));reject(()=>a.prepare(bad((p,s)=>{s.opening[0].id='us-later';}),'first'));}],
  ['unique-unit-ids', a => {for(const change of [(p,s,u)=>{u.id='initial-us';},(p,s,u)=>{u.id=s.reinforcements[1].id;},(p,s,u)=>{u.id='';}])reject(()=>a.prepare(bad(change),'first'));const p=pack();p.phases[1].scenario.units[0].id='us-later';assert.ok(a.prepare(p,'first'));}],
  ['schedule-shape', a => {for(const change of [(p,s)=>{s.reinforcements=1;},(p,s,u)=>{u.entry='';},(p,s,u)=>{u.entry=1;},(p,s)=>{s.reinforcements=[null];}])reject(()=>a.prepare(bad(change),'first'));}],
  ['schedule-times', a => {for(const change of [(p,s,u)=>{u.atSec=-1;},(p,s,u)=>{u.atSec=900.001;},(p,s,u)=>{u.atSec='30';},(p,s,u)=>{u.noticeSec=-1;},(p,s,u)=>{u.noticeSec=31;},(p,s,u)=>{u.noticeSec='1';}])reject(()=>a.prepare(bad(change),'first'));const p=bad((p,s,u)=>{u.atSec=900;u.noticeSec=900;});assert.equal(a.prepare(p,'first').events.at(-1).atSec,900);const t=a.prepare(p,'first');assert.deepEqual(ids(a.window(t,{after:null,through:0}).notices),['us-later']);assert.deepEqual(ids(a.window(t,{after:899,through:900}).arrivals),['us-later']);const q=bad((p,s,u)=>{u.atSec=30.5;});assert.equal(a.prepare(q,'first').events.at(-1).atSec,30.5);}],
  ['formation-numbers', a => {for(const change of [(p,s,u)=>{u.men=.5;},(p,s,u)=>{u.men=Number.MAX_SAFE_INTEGER+1;},(p,s,u)=>{u.guns=1;},(p,s)=>{delete s.reinforcements[1].guns;},(p,s,u)=>{u.xp=5;},(p,s,u)=>{u.morale=101;},(p,s,u)=>{u.commander={name:''};},(p,s,u)=>{u.commander={name:'Generic fixture',rank:1};},(p,s,u)=>{u.regiments=[1];},(p,s,u)=>{u.short=1;}])reject(()=>a.prepare(bad(change),'first'));const p=bad((p,s,u)=>{u.men=Number.MAX_SAFE_INTEGER;});reject(()=>a.prepare(p,'first'));}],
  ['safe-json', a => {let calls=0;const p=pack();Object.defineProperty(p.phases[0].scenario.reinforcements[0],'atSec',{enumerable:true,get(){calls++;return 30;}});reject(()=>a.prepare(p,'first'));assert.equal(calls,0);for(const change of [(p,s,u)=>{u.extra=undefined;},(p,s,u)=>{u.extra=p;},(p,s)=>{s.reinforcements=[,];},(p,s,u)=>{u.extra=Infinity;}])reject(()=>a.prepare(bad(change),'first'));}],
  ['window-ranges', a => {const t=a.prepare(pack(),'first');for(const w of [{after:11,through:10},{after:-1,through:10},{after:null,through:901},{after:null,through:Infinity},{after:'0',through:1},{after:null,through:0,extra:1}])reject(()=>a.window(t,w));let calls=0;const w={after:null};Object.defineProperty(w,'through',{enumerable:true,get(){calls++;return 1;}});reject(()=>a.window(t,w));assert.equal(calls,0);}],
  ['prepared-provenance', a => {const t=a.prepare(pack(),'first');reject(()=>a.window(clone(t),{after:null,through:0}));reject(()=>a.window(Object.freeze({...t}),{after:null,through:0}));assert.ok(a.window(t,{after:null,through:0}));}],
];
export function reinforcementUnit(candidate = api) {for(const [,verify] of REINFORCEMENT_CHECKS)verify(candidate);return REINFORCEMENT_CHECKS.length;}
const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  try {
    const count=reinforcementUnit();console.log(`REINFORCEMENTS OK (${count}/${count})`);
    if(process.argv.includes('--prove-fail')){
      const output = (edit) => ({...api,prepare:(p,id)=>{const t=clone(api.prepare(p,id));edit(t,p);return t;}});
      const query = edit => ({...api,window:(t,w)=>{const r=clone(api.window(t,w));edit(r,t,w);return r;}});
      const repair = edit => ({...api,prepare:(p,id)=>{const q=clone(p);edit(q,q.phases[0].scenario,q.phases[0].scenario.reinforcements?.[0]);return api.prepare(q,id);}});
      const controls = [
        ['empty-schedule',output(t=>{t.events=[{unit:{id:'invented'}}];})],
        ['existing-scenarios',output(t=>{t.scenario.units[0].men++;})],
        ['phase-identity',output(t=>{t.packId='wrong';})],
        ['stable-order',output(t=>{t.events.reverse();})],
        ['arrival-boundaries',query((r,t)=>{r.arrivals=clone(t.events);})],
        ['contiguous-windows',query((r,t)=>{r.arrivals=clone(t.events);})],
        ['overshoot-window',query(r=>{r.arrivals=[];})],
        ['advance-notice',query(r=>{r.notices=[];})],
        ['pending-sides',query(r=>{r.pending={US:0,CS:0};})],
        ['combined-budgets',output(t=>{t.budget.total.guns=0;})],
        ['detached-metadata',{...api,prepare:(p,id)=>({...api.prepare(p,id),scenario:p.phases.find(x=>x.id===id).scenario})}],
        ['deep-freeze',output(()=>{})],
        ['whole-pack-schedules',{...api,prepare:(p,id)=>api.prepare({...p,phases:p.phases.filter(x=>x.id===id)},id)}],
        ['unique-unit-ids',repair((p,s,u)=>{u.id='repaired';})],
        ['schedule-shape',repair((p,s)=>{delete s.reinforcements;})],
        ['schedule-times',repair((p,s,u)=>{u.atSec=30;})],
        ['formation-numbers',repair((p,s,u)=>{u.men=500;})],
        ['safe-json',{...api,prepare:()=>api.prepare(pack(),'first')}],
        ['window-ranges',{...api,window:()=>({})}],
        ['prepared-provenance',{...api,window:()=>({})}],
        ...[['floor',Math.floor],['ceil',Math.ceil]].map(([name,round])=>['combined-budgets-'+name,output(t=>{for(const side of ['US','CS','total'])t.budget[side].figures=[...t.scenario.units,...(t.scenario.reinforcements||[])].filter(u=>side==='total'||u.side===side).reduce((n,u)=>n+round(u.men/(u.type==='artillery'?4:5))+6,0);}), 'combined-budgets']),
      ];
      assert.equal(controls.length,count+2);const rows=[];
      for(const [control,mutant,category=control] of controls){let error;try{REINFORCEMENT_CHECKS.find(x=>x[0]===category)[1](mutant);}catch(e){error=e;}assert.equal(error?.code,'ERR_ASSERTION',category+' must reject via its intended assertion');rows.push({category,control,code:error.code,message:error.message});console.log('CAUGHT '+category);}
      console.log('REINFORCEMENTS CONTROLS '+JSON.stringify(rows));console.log(`REINFORCEMENTS CONTROLS OK (${controls.length}/${controls.length})`);
    }
  }catch(error){console.error('REINFORCEMENTS FAILED: '+error.message);process.exitCode=1;}
}

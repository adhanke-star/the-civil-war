// CPU counting/award controls; the actual Buell movement/fight route is tested only on Actions.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {Game} from '../src/game.js';
import {FieldCaptures,GAME_SUPPLY_NOTE} from '../src/franchise/captures.js';
import {featStats,featsOf} from '../src/sim/combat.js';
import {BADGE_BY_ID,tierFor} from '../src/franchise/badges.js';
import * as C from '../src/franchise/campaign.js';import * as S from '../src/franchise/save.js';
import {heldCaptures,awardCards} from '../src/franchise/practice.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const pack=read('assets/packs/shiloh.json'),pilot=pack.phases.find(p=>p.id==='buell-attacks').scenario,campaign=read('assets/campaign.json');
function field(api){
  const u={id:'us-rousseau-brigade',side:'US',xp:3,men:2517,menMax:2517,x:0,z:0,alive:true,state:'idle'},enemy={...u,id:'cs',side:'CS',x:5000};
  const g={units:[u,enemy],fieldCaptures:new FieldCaptures(pilot.crates)};
  const step=()=>{for(const e of g.fieldCaptures.step(g.units,1))api.credit.call(g,e);};
  const take=(index,who=u)=>{const c=g.fieldCaptures.crates[index];who.x=c.x;who.z=c.z;step();step();};
  return {g,u,enemy,step,take};
}
const api={pilot,note:GAME_SUPPLY_NOTE,credit:Game.prototype.storesFeat,tier:tierFor,record:C.recordPhase,parse:S.parseSnapshot,captures:heldCaptures};
const checks=[
  ['pilot-placement',a=>{assert.equal(a.pilot.crates.length,4,'pilot-placement: four optional objectives');assert.deepEqual(a.pilot.crates.map(c=>[c.x,c.z,c.r,c.tier]),[[-170,-650,60,'common'],[-100,-390,60,'common'],[-100,-150,60,'common'],[-180,170,60,'common']],'pilot-placement: approved route');assert.ok(pack.phases.slice(0,3).every(p=>!p.scenario.crates),'pilot-placement: loan phases unchanged');}],
  ['provenance',a=>{assert.ok(pilot.briefing.text.includes(a.note)&&pilot.crates.every(c=>c.provenance===a.note),'provenance: briefing and every optional objective labelled');const c=new FieldCaptures(pilot.crates);c.crates[0].owner='US';assert.ok(c.held()[0].from.includes(GAME_SUPPLY_NOTE),'provenance: captured loot carries game-rule provenance');assert.throws(()=>new FieldCaptures([{...pilot.crates[0],provenance:'Verified'}]),/Invalid field crate/,'provenance: false historical assertion refused');}],
  ['distinct-retake',a=>{const f=field(a);f.take(0);f.u.x=5000;f.take(0,f.enemy);f.enemy.x=5000;f.take(0);assert.equal(featStats(f.u).stores,1,'distinct-retake: same formation retake cannot farm');f.u.x=5000;f.take(0,f.enemy);const other={...f.u,id:'us-other',x:5000};f.g.units.push(other);f.enemy.x=5000;f.take(0,other);assert.equal(featStats(other).stores,1,'distinct-retake: another formation may earn its own capture');}],
  ['contested-shortfall',a=>{const f=field(a);const c=f.g.fieldCaptures.crates[0];Object.assign(f.u,{x:c.x,z:c.z});Object.assign(f.enemy,{x:c.x,z:c.z});f.step();f.step();assert.equal(featStats(f.u).stores,0,'contested-shortfall: contested cache gives no feat');f.enemy.x=5000;f.step();assert.equal(featStats(f.u).stores,0,'contested-shortfall: one second is insufficient');a.credit.call(f.g,{id:'absent',side:'US',x:c.x,z:c.z});assert.equal(featStats(f.u).stores,0,'contested-shortfall: absent store cannot count');}],
  ['tier-crossings',a=>{const f=field(a),tiers=[];for(let i=0;i<4;i++){f.take(i);tiers.push(a.tier(BADGE_BY_ID.foragers,featStats(f.u).stores));}assert.deepEqual(tiers,['bronze','silver','silver','gold'],'tier-crossings: four distinct stores cross all tiers');}],
  ['loot-provenance',a=>{const f=field(a);for(let i=0;i<4;i++)f.take(i);const captures=a.captures(f.g,'US',pilot.crates,c=>`Captured: ${c.name} (${c.provenance})`),cards=awardCards({awardId:'foragers-test',seed:1862,grade:'Victory',captures}).filter(c=>c.source==='capture');assert.equal(cards.length,4,'loot-provenance: each actually held cache deals one card');assert.ok(cards.every(c=>c.from.includes(GAME_SUPPLY_NOTE)),'loot-provenance: actual roll carries explicit fiction label');}],
  ['saved-award',a=>{const f=field(a);for(let i=0;i<4;i++)f.take(i);let s=C.newCampaign({campaign,slot:1,seed:1862});for(const p of campaign.phases.slice(0,3))s=a.record(s,campaign,{packId:p.packId,phaseId:p.phaseId,winner:null,grade:'Draw',units:[],loot:[]});const phase=C.campaignPhase(s,campaign),record={packId:phase.packId,phaseId:phase.phaseId,awardId:phase.awardId,winner:'US',grade:'Victory',units:[{id:f.u.id,side:'US',menStart:2517,men:2517}],loot:[],feats:{[f.u.id]:{side:'US',xp:3,menStart:2517,...featStats(f.u)}}};const next=a.record(s,campaign,record),b=next.army.find(b=>b.unitId===f.u.id);assert.equal(b.badges?.find(b=>b.id==='foragers')?.tier,'gold','saved-award: real campaign award keeps Gold');assert.deepEqual(a.parse(S.exportSnapshot(next)),next,'saved-award: validated export/import round trip');assert.deepEqual(a.record(next,campaign,record),next,'saved-award: repeated award is idempotent');}],
];
const mutants={
  'pilot-placement':{pilot:{crates:pilot.crates.slice(0,3)}},'provenance':{note:'Verified historical supplies'},
  'distinct-retake':{credit(){const u=this.units.find(u=>u.side==='US'&&u.x<5000);if(u)featsOf(u).stores++;}},
  'contested-shortfall':{credit(){featsOf(this.units[0]).stores++;}},
  'tier-crossings':{tier:()=>null},'saved-award':{record:(s,c,r)=>{const x={...r};delete x.feats;return C.recordPhase(s,c,x);}},
  'loot-provenance':{captures:(g,side,list)=>heldCaptures(g,side,list,c=>`Captured: ${c.name}`)},
};
for(const [,check]of checks)check(api);console.log(`FORAGERS OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){for(const [name,check]of checks){let error;try{check({...api,...mutants[name]});}catch(e){error=e;}assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail own assertion`);console.log(`CAUGHT ${name}`);}console.log(`FORAGERS CONTROLS OK (${checks.length}/${checks.length})`);}

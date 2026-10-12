// Actual economy APIs on a labelled mastery model. This is not a played campaign or an adoption of new thresholds.
import assert from 'node:assert/strict';import fs from 'node:fs';
import * as C from '../src/franchise/campaign.js';import * as E from '../src/franchise/economy.js';import * as S from '../src/franchise/save.js';
import {validateDeck,cardsFor,optionOpen,chooseDecision} from '../src/franchise/decisions.js';
import {breakCamp} from '../src/franchise/camp-orders.js';import {awardCards} from '../src/franchise/practice.js';import {canCarry} from '../src/reward/model.js';
import {candidateLevel,reconcileCandidate,progressionReceipt} from './balance-progression.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url))),campaign=read('assets/campaign.json'),deck=validateDeck(read('assets/decisions.json'));
function mastery(sales=false) {
  let save=C.newCampaign({campaign,slot:1,seed:1862});const trace=[];
  for(const entry of campaign.phases){
    const before=save,phase=C.campaignPhase(save,campaign);
    for(const card of cardsFor(deck,phase)) {
      const points=o=>o.effects.filter(e=>e.kind==='rp').reduce((n,e)=>n+e.amount,0);
      const options=card.options.filter(o=>optionOpen(save,o).ok).sort((a,b)=>points(b)-points(a));
      save=chooseDecision(save,{campaign,deck,cardId:card.id,optionId:options[0].id});
    }
    const base=read(`assets/packs/${entry.packId}.json`).phases.find(p=>p.id===entry.phaseId).scenario;
    save=breakCamp(save,{campaign,fielded:[...base.units,...(base.reinforcements||[])].filter(u=>u.side==='US').map(u=>u.id)});
    const marched=save,scenario=C.applyCampaign(base,save,phase);
    const loot=awardCards({awardId:phase.awardId,seed:phase.seed,grade:'Decisive',captures:[]});
    // Model assumptions: every phase Decisive/held; zero US losses, 20% enemy losses; ZERO assumed field captures.
    const record={packId:entry.packId,phaseId:entry.phaseId,awardId:phase.awardId,grade:'Decisive',winner:'US',held:true,loot,
      units:[...scenario.units,...(scenario.reinforcements||[])].map(u=>({id:u.id,side:u.side,menStart:u.men,men:u.side==='CS'?Math.floor(u.men*.8):u.men}))};
    save=C.recordPhase(save,campaign,record);
    let issued=null;
    for(const card of loot){const brigade=save.army.find(b=>b.men>0&&canCarry(b,card));if(brigade){save=S.exchangeDepot(save,{brigadeId:brigade.id,itemUid:card.uid});issued=card.uid;break;}}
    if(sales)for(const card of loot)if(card.uid!==issued&&save.depot.some(c=>c.uid===card.uid))save=E.turnInCard(save,{itemUid:card.uid});
    trace.push(progressionReceipt(before,marched,save));
  }
  return {save,trace,assumptions:'Legal API mastery model, greedy currently affordable RP options (not a global optimum), Decisive/held each phase, zero US losses/20% enemy losses, captures=[], one compatible phase card issued; sales only the remaining actual deterministic phase cards. No combat-play claim.'};
}
const model=mastery(),sold=mastery(true),api={candidate:candidateLevel,reconcile:reconcileCandidate,receipt:progressionReceipt,record:C.recordPhase};
const checks=[
  ['threshold-comparison',a=>{assert.deepEqual([0,570,806,1620].map(rep=>a.candidate(rep)),[1,8,10,10],'threshold-comparison: proposed arithmetic separated from current levels');assert.equal(E.levelFor(570),5,'threshold-comparison: current live thresholds unchanged');}],
  ['legal-income',()=>{assert.equal(model.save.campaign.index,11,'legal-income: all actual ladder phases recorded');assert.equal(model.trace.reduce((n,r)=>n+r.earnedSeparately.phase,0),806,'legal-income: separate phase-only maximum');assert.ok(model.trace.reduce((n,r)=>n+r.earnedSeparately.positiveDecisions,0)>0,'legal-income: actual affordable decisions add separately');assert.equal(model.trace.reduce((n,r)=>n+r.earnedSeparately.turnIns,0),0,'legal-income: no assumed sales');}],
  ['actual-surplus',a=>{const earned=sold.trace.reduce((n,r)=>n+r.earnedSeparately.turnIns,0);assert.ok(earned>0,'actual-surplus: actual deterministic unissued cards sold');assert.ok(sold.save.reputation>model.save.reputation,'actual-surplus: actual sale income separated');assert.ok(sold.save.ledger.filter(r=>r.kind==='turnIn').every(r=>r.points===E.ECONOMY.turnIn[r.item.tier]),'actual-surplus: rarity receipts exact');assert.ok(!sold.save.ledger.some(r=>r.kind==='turnIn'&&sold.save.issued.some(i=>i.item===r.item.uid)),'actual-surplus: issued cards never sold');}],
  ['candidate-migration',a=>{const before=model.save,raw=S.exportSnapshot(before),after=a.reconcile(before);assert.equal(after.level,a.candidate(after.reputation),'candidate-migration: candidate crossings reconciled');assert.equal(after.ledger.filter(r=>r.kind==='level').length,after.level-1,'candidate-migration: exactly one card receipt per crossed level');assert.deepEqual([after.rp,after.reputation,after.shopSeen],[before.rp,before.reputation,before.shopSeen],'candidate-migration: money and shop seen preserved');assert.equal(S.exportSnapshot(before),raw,'candidate-migration: no input mutation');assert.deepEqual(S.parseSnapshot(S.exportSnapshot(after)),after,'candidate-migration: validated round trip');assert.deepEqual(a.reconcile(after),after,'candidate-migration: repeated reconciliation idempotent');}],
  ['capacity-refusal',a=>{const s=model.save,sample=s.depot[0],full=S.validateSnapshot({...s,depot:[...s.depot,...Array.from({length:2000-s.depot.length},(_,i)=>({...sample,uid:`capacity-card-${i}`}))]}),raw=S.exportSnapshot(full);let failure;try{a.reconcile(full);}catch(e){failure=e;}assert.ok(failure?.message.includes('exceed save depot limit'),'capacity-refusal: no silent omitted reward cards');assert.equal(S.exportSnapshot(full),raw,'capacity-refusal: full depot preserved');}],
  ['replay-idempotence',a=>{const s=model.save,p=C.campaignPhase(s,campaign,{replay:true}),units=read('assets/packs/chattanooga.json').phases.at(-1).scenario.units.map(u=>({id:u.id,side:u.side,menStart:u.men,men:u.men})),record={packId:p.packId,phaseId:p.phaseId,awardId:p.awardId,winner:'US',grade:'Decisive',held:true,units,loot:[]},next=a.record(s,campaign,record);assert.equal(next.reputation,s.reputation,'replay-idempotence: same best score pays no extra');assert.deepEqual(a.record(next,campaign,record),next,'replay-idempotence: same award exact');}],
];
const mutants={
  'threshold-comparison':{candidate:()=>1},
  'candidate-migration':{reconcile:s=>s},'capacity-refusal':{reconcile:s=>s},
  'replay-idempotence':{record:(...args)=>{const s=C.recordPhase(...args);return {...s,reputation:s.reputation+1};}},
};
for(const [,check]of checks)check(api);
console.log('PROGRESSION MODEL',JSON.stringify({noSale:{reputation:model.save.reputation,rp:model.save.rp,level:model.save.level,candidate:candidateLevel(model.save.reputation)},actualSurplus:{reputation:sold.save.reputation,rp:sold.save.rp,level:sold.save.level,candidate:candidateLevel(sold.save.reputation)},assumptions:model.assumptions}));
console.log(`PROGRESSION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  // Every mutant changes the quantity the corresponding control assesses, without touching shipped tuning.
  const originals={modelRep:model.save.reputation,soldRep:sold.save.reputation,phase:model.trace[0].earnedSeparately.phase};
  for(const [name,check]of checks){let error;
    try{if(name==='legal-income')model.trace[0].earnedSeparately.phase=0;if(name==='actual-surplus')sold.save.reputation=model.save.reputation;
      check({...api,...mutants[name]});
    }catch(e){error=e;}finally{model.save.reputation=originals.modelRep;sold.save.reputation=originals.soldRep;model.trace[0].earnedSeparately.phase=originals.phase;}
    assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail own assertion`);console.log(`CAUGHT ${name}`);
  }console.log(`PROGRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

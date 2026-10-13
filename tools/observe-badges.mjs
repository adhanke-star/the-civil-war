// Private diagnostic bookkeeping. No product import, combat mutation, or natural-play proof.
import {newCampaign,recordPhase,campaignPhase,validateCampaign,campaignDifficulty} from '../src/franchise/campaign.js';
import {validateSnapshot} from '../src/franchise/save.js';
import {BADGES,FEAT_STATS,TIERS,measure,threshold} from '../src/franchise/badges.js';

export const BADGE_OBSERVATIONS=Object.freeze([
  ['slaughter-fire','stones-river','slaughter-pen',['farKills','heldVolley','disciplineKills','screenKills','worksKills','woodsKills']],
  ['slaughter-defence','stones-river','slaughter-pen',['holdingLoss','repulses','steadySeconds','canisterKills']],
  ['slaughter-recovery','stones-river','slaughter-pen',['rearGuardKills','quickRallies','recharges']],
  ['mcfadden-assault','stones-river','mcfaddens-ford',['shockBreaks','chargeBreaks','flankKills']],
  ['missionary-assault','chattanooga','missionary-ridge',['stormed','chargeBreaks','flankKills']],
  ['buell-capture','shiloh','buell-attacks',['gunsTaken','marched','stores']],
].map(([id,packId,phaseId,stats])=>Object.freeze({id,packId,phaseId,stats:Object.freeze(stats)})));
const fail=message=>{throw Error('badge observation: '+message);};

/** Exact authorized Draw/null/empty prefix. All income/joins/cards are kept, never spent or equipped. */
export function badgePrefix(campaign,observation,{slot=1,seed=1861,at='2026-10-12T12:00:00Z'}={}){
  const def=validateCampaign(campaign),recipe=BADGE_OBSERVATIONS.find(r=>r.id===observation);
  if(!recipe)fail('unknown observation');
  const index=def.phases.findIndex(p=>p.packId===recipe.packId&&p.phaseId===recipe.phaseId);
  if(index<0)fail('target absent from live campaign');
  let save=newCampaign({campaign:def,slot,seed,at,difficulty:'veteran'});const start=structuredClone(save),records=[];
  for(let i=0;i<index;i++){
    const phase=campaignPhase(save,def),record={packId:phase.packId,phaseId:phase.phaseId,awardId:phase.awardId,winner:null,grade:'Draw',units:[],loot:[]};
    const before=save;save=recordPhase(save,def,record);
    records.push({record,addedLedger:structuredClone(save.ledger.slice(before.ledger.length)),addedDepot:structuredClone(save.depot.slice(before.depot.length))});
  }
  const phase=campaignPhase(save,def);
  if(phase.packId!==recipe.packId||phase.phaseId!==recipe.phaseId||campaignDifficulty(save)!=='veteran')fail('prefix target/difficulty drift');
  return {kind:'constructed campaign prefix; earlier phases not played; no spending/equipment changes',recipe,phase,start,save,records};
}

/** Observer consumes copies of real featReport snapshots; CPU fixtures establish bookkeeping only. */
export function createBadgeCrossings(){
  const units=new Map();let lastTime=-1,samples=0;
  const sample=(at,feats)=>{
    if(!Number.isFinite(at)||at<0||at<lastTime||!feats||typeof feats!=='object'||Array.isArray(feats))fail('invalid snapshot/time');
    const validated=[];
    for(const[id,f]of Object.entries(feats)){
      if(!id||!f||!['US','CS'].includes(f.side)||!Number.isFinite(f.menStart)||f.menStart<=0||!Number.isFinite(f.xp)||f.xp<0
        ||FEAT_STATS.some(k=>!Number.isFinite(f[k])||f[k]<0))fail('incomplete native feat record');
      const prior=units.get(id);
      if(prior&&(prior.side!==f.side||prior.menStart!==f.menStart||FEAT_STATS.some(k=>f[k]<prior.raw[k])))fail('formation identity/counter drift');
      validated.push([id,structuredClone(f),prior]);
    }
    // Validate all inputs before changing the observer, so a refused sample cannot partly award crossings.
    for(const[id,raw,prior]of validated){
      const row=prior||{id,side:raw.side,menStart:raw.menStart,firstSeen:at,crossings:{},raw:null};
      for(const badge of BADGES){const value=measure(badge,raw);for(const tier of TIERS){const key=badge.id+'/'+tier;
        if(value>=threshold(badge,tier)&&!row.crossings[key])row.crossings[key]={at,value,threshold:threshold(badge,tier)};
      }}row.raw=raw;units.set(id,row);
    }
    lastTime=at;samples++;
  };
  const receipt=()=>({kind:'observed numeric crossings; separate saved tier upgrades/kept/offered/X-Factor proof required',samples,lastTime,
    units:[...units.values()].map(row=>({...structuredClone(row),measures:BADGES.map(b=>({badge:b.id,stat:b.stat,value:measure(b,row.raw),
      tiers:TIERS.map(tier=>({tier,threshold:threshold(b,tier),crossing:structuredClone(row.crossings[b.id+'/'+tier]||null),shortfall:Math.max(0,threshold(b,tier)-measure(b,row.raw))}))}))}))});
  return {sample,receipt};
}

/** Refuse diagnostic counter/army/result mutation commands before a native control is called. */
export function validateBadgeCommand(command){
  if(!command||typeof command!=='object'||Array.isArray(command)||![Object.prototype,null].includes(Object.getPrototypeOf(command))
    ||Object.values(Object.getOwnPropertyDescriptors(command)).some(d=>!d.enumerable||!Object.hasOwn(d,'value'))
    ||!Object.hasOwn(command,'type')||!Object.hasOwn(command,'unitId')||!['move','hold','holdfire','attack','charge','fallback','run'].includes(command.type))fail('forbidden command');
  const permitted={move:['points','endFacing'],hold:[],holdfire:['enabled'],attack:['targetId'],charge:['targetId','points'],fallback:[],run:['enabled']}[command.type];
  if(Object.keys(command).some(k=>!['type','unitId',...permitted].includes(k))||typeof command.unitId!=='string'||!command.unitId)fail('command ownership/extra mutation');
  if(['move','charge'].includes(command.type)&&(!Array.isArray(command.points)||command.points.length<2||Array.from(command.points).some(p=>!Array.isArray(p)||p.length!==2||!Array.from(p).every(Number.isFinite))))fail('finite legal path required');
  if(['attack','charge'].includes(command.type)&&(typeof command.targetId!=='string'||!command.targetId))fail('actual target identity required');
  if(['holdfire','run'].includes(command.type)&&typeof command.enabled!=='boolean')fail('explicit toggle required');
  if(command.endFacing!==undefined&&!Number.isFinite(command.endFacing))fail('finite facing required');
  return structuredClone(command);
}

export function badgePrefixReceipt(prefix){
  const before=validateSnapshot(prefix.start),after=validateSnapshot(prefix.save);
  return {kind:prefix.kind,recipe:prefix.recipe.id,index:after.campaign.index,difficulty:campaignDifficulty(after),
    reputation:after.reputation,rp:after.rp,level:after.level,stores:after.stores,army:structuredClone(after.army),
    generatedDepot:structuredClone(after.depot),addedLedger:structuredClone(after.ledger.slice(before.ledger.length)),records:structuredClone(prefix.records)};
}

/** Commands forward through actual player controls; refused actors never reach native methods. */
export function executeBadgeCommand(game,input){
  const command=validateBadgeCommand(input),unit=game.units.find(u=>u.id===command.unitId),target=game.units.find(u=>u.id===command.targetId);
  if(!Number.isFinite(game.simTime)||game.simTime<0)fail('invalid command time');
  const receipt={at:game.simTime,command,invoked:false,accepted:false,reason:null};
  if(game.over){receipt.reason='battle ended';return receipt;}
  if(!unit||unit.side!==game.playerSide||!game.controls(unit)){receipt.reason='unknown or uncontrolled actor';return receipt;}
  if(['attack','charge'].includes(command.type)&&(!target||target.side===unit.side||!target.alive)){receipt.reason='unknown or unavailable enemy target';return receipt;}
  if(['holdfire','run'].includes(command.type)&&unit[command.type==='holdfire'?'holdFire':'run']===command.enabled){
    receipt.accepted=null;receipt.reason='already in requested state';return receipt;
  }
  receipt.invoked=true;
  if(['move','attack','charge'].includes(command.type))receipt.accepted=game.order(unit,{...command,target,points:command.points})===true;
  else{game.select(unit);receipt.accepted=game.orderSelected(command.type)===true;}
  receipt.result={type:unit.order.type,targetId:unit.order.target?.id||null,destination:unit.order.dest?Array.from(unit.order.dest):null,holdFire:unit.holdFire,run:unit.run};
  if(!receipt.accepted)receipt.reason='native control refused';
  return receipt;
}

/** Owned forwarding tick hook; reads immutable reports after each successful native tick. */
export function installBadgeTickObserver(game,observer){
  const descriptor=Object.getOwnPropertyDescriptor(game,'tick'),native=game.tick;
  if(typeof native!=='function'||typeof game.featReport!=='function'||typeof observer?.sample!=='function')fail('tick observer prerequisites');
  observer.sample(game.simTime,game.featReport());let restored=false;
  function wrapped(...args){const result=native.apply(this,args);if(this===game)observer.sample(game.simTime,game.featReport());return result;}
  Object.defineProperty(game,'tick',{value:wrapped,writable:true,configurable:true,enumerable:descriptor?.enumerable??false});
  const installed=Object.getOwnPropertyDescriptor(game,'tick');
  return {restore(){
    if(restored)return {ok:true};
    const current=Object.getOwnPropertyDescriptor(game,'tick');
    if(!current||!['value','writable','enumerable','configurable','get','set'].every(k=>current[k]===installed[k]))fail('foreign tick owner');
    if(descriptor)Object.defineProperty(game,'tick',descriptor);else delete game.tick;
    if(game.tick!==native)fail('inherited tick changed');restored=true;return {ok:true};
  }};
}

/** A declared finite chronological command list. Each action gets exactly one attempt at its due cadence. */
export function createBadgePolicy(plan,cadence){
  if(!Array.isArray(plan)||!plan.length||plan.length>128||!Number.isFinite(cadence)||cadence<=0||cadence>20)fail('finite policy bound/cadence');
  let prior=-1;
  const commands=Array.from(plan,row=>{if(!row||Object.keys(row).some(k=>!['at','command'].includes(k))||!Number.isFinite(row.at)||row.at<0||row.at<prior)fail('chronological finite policy');prior=row.at;return {at:row.at,command:validateBadgeCommand(row.command)};});
  let next=0,last=-1,lastObserved=-1,failure=null;const trace=[];
  const refuse=(message,at)=>{failure={message,at:Number.isFinite(at)?at:null};fail(message);};
  return {advance(game){
    if(failure)fail('policy already failed');
    if(!Number.isFinite(game.simTime)||game.simTime<lastObserved)refuse('policy time drift',game.simTime);
    lastObserved=game.simTime;
    if(last<0&&game.simTime!==0)refuse('policy must begin at native time zero',game.simTime);
    if(last>=0&&game.simTime>last+cadence+1e-8)refuse('missed declared policy cadence',game.simTime);
    if(last>=0&&game.simTime<last+cadence-1e-8)return;
    last=game.simTime;
    while(next<commands.length&&commands[next].at<=game.simTime){const planned=commands[next++];
      try{trace.push({...executeBadgeCommand(game,planned.command),plannedAt:planned.at});}
      catch(error){const message=String(error?.message??error);trace.push({at:game.simTime,plannedAt:planned.at,command:structuredClone(planned.command),accepted:null,invoked:null,stage:'command bridge threw; native acceptance unknown',error:message});failure={message,at:game.simTime};throw error;}
    }
  },receipt:()=>({kind:'finite native command attempts; no counter farming',cadence,attempted:next,remaining:commands.length-next,trace:structuredClone(trace),failure:structuredClone(failure)})};
}

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
  if(Reflect.ownKeys(command).some(k=>typeof k!=='string'||!['type','unitId',...permitted].includes(k))||typeof command.unitId!=='string'||!command.unitId)fail('command ownership/extra mutation');
  if(['move','charge'].includes(command.type)&&(!dense(command.points)||command.points.length<2||command.points.some(p=>!finitePoint(p))))fail('finite legal path required');
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

const plain=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Reflect.ownKeys(value).every(k=>typeof k==='string'&&keys.includes(k))
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const dense=value=>Array.isArray(value)&&Reflect.ownKeys(value).length===value.length+1
  &&Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));return !!d&&d.enumerable&&Object.hasOwn(d,'value');}).every(Boolean);
const finitePoint=p=>dense(p)&&p.length===2&&p.every(Number.isFinite);
const terminal=s=>s!=='pending';
const success=s=>['accepted','already-satisfied'].includes(s);

/** Finite data-only conditional stages. Facts are read from native units, never badge counters. */
export function createBadgeStages(plan,cadence,roster){
  if(!dense(plan)||!plan.length||plan.length>128||!Number.isFinite(cadence)||cadence<=0||cadence>20
    ||!dense(roster)||!roster.length||roster.some(id=>typeof id!=='string'||!id)||new Set(roster).size!==roster.length)fail('stage bounds/cadence/roster');
  const known=new Set(roster),seen=new Set(),ids=new Set(),history=new Map();
  const atomKeys={
    'actor-orderable':[],'target-unbroken':['targetId'],distance:['targetId','max'],'target-larger':['targetId'],
    'target-cover':['targetId'],support:['radius','min','types'],'fire-ready':['maxDistance'],pressure:['moraleMax'],
    recovery:['moraleMin','requirePriorRouting'],'engagement-ended':['targetId','quietSeconds'],separated:['minDistance'],arrived:['point','radius'],'crate-owned':['crateId','side'],
  };
  const positive=n=>Number.isFinite(n)&&n>0;
  const rows=plan.map(row=>{
    if(!plain(row,['id','after','notBefore','expires','condition','command'])||typeof row.id!=='string'||!row.id||ids.has(row.id)
      ||!Number.isFinite(row.notBefore)||row.notBefore<0||!Number.isFinite(row.expires)||row.expires<row.notBefore
      ||!dense(row.after)||!dense(row.condition)||row.condition.length>12)fail('stage schema/window');
    for(const dep of row.after)if(!plain(dep,['id','require'])||!ids.has(dep.id)||!['success','terminal'].includes(dep.require))fail('earlier stage dependency required');
    if(new Set(row.after.map(d=>d.id)).size!==row.after.length)fail('duplicate stage dependency');
    for(const c of row.condition){
      if(!plain(c,['kind','targetId','max','radius','min','types','maxDistance','moraleMax','moraleMin','requirePriorRouting','quietSeconds','minDistance','point','crateId','side'])
        ||!Object.hasOwn(atomKeys,c.kind)||!plain(c,['kind',...atomKeys[c.kind]])
        ||atomKeys[c.kind].some(k=>!Object.hasOwn(c,k))||c.targetId!==undefined&&!known.has(c.targetId))fail('stage condition schema/identity');
      if(c.kind==='distance'&&!positive(c.max)||c.kind==='support'&&(!positive(c.radius)||!Number.isSafeInteger(c.min)||c.min<1
        ||!dense(c.types)||!c.types.length||new Set(c.types).size!==c.types.length||c.types.some(t=>!['infantry','artillery','cavalry'].includes(t)))
        ||c.kind==='fire-ready'&&(!positive(c.maxDistance)||c.maxDistance>55)
        ||c.kind==='pressure'&&(!Number.isFinite(c.moraleMax)||c.moraleMax<0||c.moraleMax>100)
        ||c.kind==='recovery'&&(!Number.isFinite(c.moraleMin)||c.moraleMin<0||c.moraleMin>100||typeof c.requirePriorRouting!=='boolean')
        ||c.kind==='engagement-ended'&&!positive(c.quietSeconds)
        ||c.kind==='separated'&&!positive(c.minDistance)
        ||c.kind==='arrived'&&(!finitePoint(c.point)||!positive(c.radius))
        ||c.kind==='crate-owned'&&(typeof c.crateId!=='string'||!c.crateId||c.side!=='US'))fail('stage condition bounds');
    }
    let command=row.command;
    if(!plain(command,['type','unitId','targetId','path','points','endFacing','enabled']))fail('stage command data required');
    if(command.path!==undefined){
      if(!plain(command,['type','unitId','targetId','path','endFacing'])||!['move','charge'].includes(command.type)
        ||!plain(command.path,['kind','standOff'])||command.path.kind!=='actor-to-target'||!Number.isFinite(command.path.standOff)
        ||command.path.standOff<0||command.path.standOff>10000||!known.has(command.targetId))fail('stage path resolver');
      const {path,targetId,...base}=command;validateBadgeCommand({...base,...(command.type==='charge'?{targetId}:{}),points:[[0,0],[1,1]]});
    }else validateBadgeCommand(command);
    if(!known.has(command.unitId)||command.targetId!==undefined&&!known.has(command.targetId))fail('stage command identity');
    ids.add(row.id);return {...structuredClone(row),state:'pending',evaluations:0,lastFacts:[],unmet:[],trace:null,at:null};
  });
  const byId=new Map(rows.map(r=>[r.id,r]));let last=-1,lastObserved=-1,failure=null,activeRow=null;
  const refuse=(message,at)=>{failure={message,at:Number.isFinite(at)?at:null};fail(message);};
  const record=(g)=>{
    if(!Number.isFinite(g.simTime)||g.simTime<0||g.simTime<lastObserved)refuse('stage native time drift',g.simTime);
    lastObserved=g.simTime;
    if(!Array.isArray(g.units)||new Set(g.units.map(u=>u.id)).size!==g.units.length)refuse('stage native roster drift',g.simTime);
    for(const u of g.units){
      if(!known.has(u.id)||!['US','CS'].includes(u.side)||![u.x,u.z,u.men,u.morale,u.underFire,u.flanked,u.reload].every(Number.isFinite)
        ||['alive','melee','firing','engaged'].some(k=>typeof u[k]!=='boolean')||typeof u.follow?.active!=='boolean'
        ||typeof u.state!=='string'||!u.order||typeof u.canTakeOrders!=='function')refuse('malformed native stage unit',g.simTime);
      seen.add(u.id);let h=history.get(u.id);if(!h){h={id:u.id,firstSeen:g.simTime,markers:{},pairs:Object.create(null)};history.set(u.id,h);}
      for(const [key,on]of Object.entries({melee:!!u.melee,firing:!!u.firing,underFire:u.underFire>0,routing:u.state==='routing'}))if(on){
        const marker=h.markers[key]||{first:g.simTime};marker.last=g.simTime;h.markers[key]=marker;
      }
      // Incoming fire has no attacker identity. A melee flag does not identify which touching foe fought.
      // Retain those actor markers, but attribute a pair only to the actual observed firing target.
      if(u.firing&&u.target){const id=u.target.id;if(!known.has(id)||!g.units.includes(u.target))refuse('native engagement target outside roster',g.simTime);
        const p=Object.hasOwn(h.pairs,id)?h.pairs[id]:{first:g.simTime,kind:'observed firing at actual target; not private charge episode'};
        p.last=g.simTime;h.pairs[id]=p;}
    }
  };
  const orderable=(g,u)=>!!u&&u.side===g.playerSide&&u.alive&&g.controls(u)&&u.canTakeOrders();
  const point=u=>{if(!u||![u.x,u.z].every(Number.isFinite))fail('malformed native position');return [u.x,u.z];};
  const distance=(u,t)=>{const a=point(u),b=point(t);return Math.hypot(a[0]-b[0],a[1]-b[1]);};
  const fact=(g,u,c)=>{
    const t=g.units.find(v=>v.id===c.targetId),h=history.get(u?.id),base={kind:c.kind,targetId:c.targetId||null,ok:false};
    if(c.kind==='crate-owned'){const crate=g.fieldCaptures?.crates?.find(v=>v.id===c.crateId);return {...base,crateId:c.crateId,owner:crate?.owner??null,ok:crate?.owner===c.side};}
    if(!u)return {...base,reason:'actor not present'};
    switch(c.kind){
      case 'actor-orderable':return {...base,state:u.state,ok:!!orderable(g,u)};
      case 'target-unbroken':return {...base,state:t?.state||null,alive:t?.alive??null,ok:!!t&&t.side!==u.side&&t.alive&&!['routing','captured'].includes(t.state)};
      case 'distance':return {...base,distance:t?distance(u,t):null,max:c.max,ok:!!t&&distance(u,t)<=c.max};
      case 'target-larger':return {...base,actorMen:u.men,targetMen:t?.men??null,ok:!!t&&t.men>u.men};
      case 'target-cover':if(t&&!Number.isFinite(t.cover))fail('malformed native target cover');return {...base,cover:t?.cover??null,coverKind:t?.coverKind||null,ok:!!t&&t.cover>1};
      case 'support':{const support=g.units.filter(v=>v!==u&&v.side===u.side&&c.types.includes(v.type)&&orderable(g,v)&&distance(u,v)<=c.radius).map(v=>v.id);
        return {...base,support,radius:c.radius,min:c.min,ok:support.length>=c.min};}
      case 'fire-ready':{const target=u.target;if(!Number.isFinite(u.reload)||typeof g.combat?.masks!=='function')fail('malformed native fire readiness');
        if(target&&(!known.has(target.id)||!g.units.includes(target)))fail('foreign native firing target');
        const d=target?distance(u,target):null,masked=target?g.combat.masks(u,target):null;
        if(masked!==null&&typeof masked!=='boolean')fail('malformed native mask result');
        return {...base,targetId:target?.id||null,distance:d,reload:u.reload,masked,melee:!!u.melee,switching:!!u.switching,
          ok:!!target&&target.alive&&target.side!==u.side&&!['routing','captured'].includes(target.state)&&d<=c.maxDistance&&u.reload>=1&&!u.melee&&!u.switching&&!masked};}
      case 'pressure':return {...base,morale:u.morale,underFire:u.underFire,melee:!!u.melee,flanked:u.flanked??null,
        ok:u.morale<=c.moraleMax&&(u.underFire>0||!!u.melee||u.flanked>0)};
      case 'recovery':{const priorContact=!!h&&['melee','firing','underFire','routing'].some(k=>!!h.markers[k]);
        return {...base,morale:u.morale,priorContact,priorRouting:structuredClone(h?.markers.routing||null),melee:!!u.melee,underFire:u.underFire,
          ok:priorContact&&!!orderable(g,u)&&!u.melee&&u.underFire<=0&&u.morale>=c.moraleMin&&(!c.requirePriorRouting||!!h?.markers.routing)};}
      case 'engagement-ended':{const pair=h&&Object.hasOwn(h.pairs,c.targetId)?h.pairs[c.targetId]:null,active=!!u.firing&&u.target?.id===c.targetId;
        return {...base,observedEngagement:structuredClone(pair||null),active,quietSeconds:c.quietSeconds,
          melee:!!u.melee,underFire:u.underFire,
          ok:!!pair&&!u.melee&&u.underFire<=0&&(!t||!t.alive||['routing','captured'].includes(t.state)||!active&&g.simTime-pair.last>c.quietSeconds)};}
      case 'separated':{const enemies=g.units.filter(v=>v.side!==u.side&&v.alive&&!['routing','captured'].includes(v.state)),nearest=enemies.length?Math.min(...enemies.map(v=>distance(u,v))):null;
        return {...base,nearest,minDistance:c.minDistance,ok:nearest===null||nearest>=c.minDistance};}
      case 'arrived':{if(typeof u.follow?.active!=='boolean')fail('malformed native following state');const d=Math.hypot(u.x-c.point[0],u.z-c.point[1]);
        return {...base,distance:d,following:u.follow.active,engaged:!!u.engaged,ok:d<=c.radius&&!u.follow.active&&!u.engaged};}
    }
    fail('unhandled stage condition');
  };
  const resolve=(g,row)=>{
    if(!row.command.path)return {command:validateBadgeCommand(row.command),inputs:null};
    const u=g.units.find(v=>v.id===row.command.unitId),t=g.units.find(v=>v.id===row.command.targetId);
    if(!u||!t)return {command:null,inputs:{actorPresent:!!u,targetPresent:!!t}};
    const a=point(u),b=point(t),d=distance(u,t),offset=Math.min(d,row.command.path.standOff),scale=d?(d-offset)/d:0;
    const {path,targetId,...base}=row.command,command=validateBadgeCommand({...base,...(base.type==='charge'?{targetId}:{}),points:[a,[a[0]+(b[0]-a[0])*scale,a[1]+(b[1]-a[1])*scale]]});
    return {command,inputs:{actor:a,target:b,targetId,standOff:path.standOff,distance:d}};
  };
  return {advance(g){
    if(failure)fail('stage policy already failed');
    try{
      activeRow=null;
      record(g);
      if(g.over){for(const row of rows)if(row.state==='pending'){row.state='ended';row.at=g.simTime;}return;}
      if(last<0&&g.simTime!==0)refuse('stage policy must begin at native time zero',g.simTime);
      if(last>=0&&g.simTime>last+cadence+1e-8)refuse('missed declared stage cadence',g.simTime);
      if(last>=0&&g.simTime<last+cadence-1e-8)return;last=g.simTime;
      for(const row of rows){
        if(row.state!=='pending')continue;
        activeRow=row;
        if(g.over){row.state='ended';row.at=g.simTime;continue;}
        row.evaluations++;
        const u=g.units.find(v=>v.id===row.command.unitId);
        row.lastFacts=row.condition.map(c=>fact(g,u,c));row.unmet=row.lastFacts.filter(f=>!f.ok).map(f=>f.kind);
        if(g.simTime>row.expires){row.state='expired';row.at=g.simTime;continue;}
        const failed=row.after.find(d=>d.require==='success'&&terminal(byId.get(d.id).state)&&!success(byId.get(d.id).state));
        const targetId=row.command.targetId,t=g.units.find(v=>v.id===targetId);
        const permanent=!u&&seen.has(row.command.unitId)||u&&(!u.alive||u.state==='captured')
          ||targetId&&(!t&&seen.has(targetId)||t&&(!t.alive||t.state==='captured'));
        if(failed||permanent){row.state='skipped';row.at=g.simTime;row.reason=failed?'unsuccessful dependency '+failed.id:'actor/target permanently unavailable';continue;}
        if(g.simTime<row.notBefore||row.after.some(d=>!terminal(byId.get(d.id).state))||row.unmet.length)continue;
        const resolved=resolve(g,row);if(!resolved.command){row.unmet.push('path target not present');continue;}
        try{row.trace={...executeBadgeCommand(g,resolved.command),resolvedInputs:resolved.inputs};}
        catch(error){row.state='error';row.at=g.simTime;row.trace={command:resolved.command,resolvedInputs:resolved.inputs,accepted:null,invoked:null,error:String(error?.message??error)};throw error;}
        row.state=row.trace.accepted===true?'accepted':row.trace.accepted===null&&row.trace.reason==='already in requested state'?'already-satisfied':'refused';row.at=g.simTime;
      }
    }catch(error){if(activeRow&&activeRow.state==='pending'){activeRow.state='error';activeRow.at=g.simTime;activeRow.error=String(error?.message??error);}
      if(!failure)failure={message:String(error?.message??error),at:Number.isFinite(g.simTime)?g.simTime:null};throw error;}
  },receipt:()=>({kind:'finite native conditional attempts; observed engagement is not a private charge episode',cadence,
    stages:structuredClone(rows),history:[...history.values()].map(h=>structuredClone(h)),failure:structuredClone(failure)})};
}

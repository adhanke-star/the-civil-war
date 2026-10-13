// Private diagnostic bookkeeping. No product import, combat mutation, or natural-play proof.
import {newCampaign,recordPhase,campaignPhase,validateCampaign,campaignDifficulty} from '../src/franchise/campaign.js';
import {validateSnapshot} from '../src/franchise/save.js';
import {BADGES,FEAT_STATS,TIERS,measure,threshold} from '../src/franchise/badges.js';
import {CANISTER} from '../src/sim/combat.js';

export const BADGE_OBSERVATIONS=Object.freeze([
  ['slaughter-fire','stones-river','slaughter-pen',['farKills','heldVolley','disciplineKills','screenKills','worksKills','woodsKills']],
  ['slaughter-defence','stones-river','slaughter-pen',['holdingLoss','repulses','steadySeconds','canisterKills']],
  ['slaughter-recovery','stones-river','slaughter-pen',['rearGuardKills','quickRallies','recharges']],
  ['mcfadden-assault','stones-river','mcfaddens-ford',['shockBreaks','chargeBreaks','flankKills']],
  ['missionary-assault','chattanooga','missionary-ridge',['stormed','chargeBreaks','flankKills']],
  ['buell-capture','shiloh','buell-attacks',['gunsTaken','marched','stores']],
].map(([id,packId,phaseId,stats])=>Object.freeze({id,packId,phaseId,stats:Object.freeze(stats)})));
const fail=message=>{throw Error('badge observation: '+message);};

// This is an actual, completed Actions playthrough export, not a constructed Veteran prefix.
export const LEVEL10_ORIGIN=Object.freeze({run:38350032246,sha:'0c8e791cdd77980df0a4cc4c0d5936742266bf4e',artifact:11790274623,name:'playthrough',
  zipBytes:48447932,zipSha:'96ef5f7c0c08c4986fcb27f36f08578ab63c68d40a63d2db02c69d4648bad0ec',
  member:'final-save.json',saveBytes:75245,saveSha:'bb7727636bb660735494785f4e3052659983d35ea86787cd0035ab7d694f7aa3'});
export const LEVEL10_TURN_INS=Object.freeze([
  ['west.1.chattanooga.missionary-ridge.1.Ly88c1s-3',40],['west.1.chattanooga.orchard-knob.1.L1c0hs20-3',40],
  ['west.1.level.6',40],['west.1.level.7',40],['west.1.level.8',40],
  ['west.1.chattanooga.lookout-mountain.1.L1yuui9p-0',20],['west.1.level.4',20],['west.1.level.5',20],
].map(([uid,points])=>Object.freeze({uid,points})));
/** Bind acquisition to the immutable producer before using its bytes. Hashes are computed by the Node reader. */
export function admitLevel10Origin(observed){
  if(!observed||Reflect.ownKeys(observed).length!==Object.keys(LEVEL10_ORIGIN).length
    ||Object.entries(LEVEL10_ORIGIN).some(([k,v])=>observed[k]!==v))fail('level10 original producer/bytes');
  return {...LEVEL10_ORIGIN};
}
/** The legacy no-reinforcement fastForward hook does not stop within a multi-step call. */
export function advanceBadgeChunk(game){
  if(typeof game?.fastForward!=='function'||typeof game.over!=='boolean'||typeof game.paused!=='boolean')fail('native chunk prerequisites');
  for(let step=0;step<400&&!game.over&&!game.paused;step++)game.fastForward(.05);
}

export const BADGE_PROMOTION_PHASES=Object.freeze([
  ['dawn-on-the-right',4,[['sr1-refuse','stand'],['sr1-rally','pike']]],
  ['slaughter-pen',5,[['sr2-guns','forward'],['sr2-ammunition','withdraw']]],
  ['round-forest',6,[['sr3-embankment','embankment'],['sr3-batteries','cycle']]],
  ['mcfaddens-ford',7,[]],
].map(([phaseId,index,choices])=>Object.freeze({phaseId,index,choices:Object.freeze(choices.map(c=>Object.freeze(c)))})));

/** Ordinary defence of the existing line. Survival triggers read native morale/contact, never badge counters. */
export function badgePromotionTactic(game,phaseId){
  const spec=BADGE_PROMOTION_PHASES.find(p=>p.phaseId===phaseId),s=game.scenario;
  if(!spec||game.simTime!==0||game.playerSide!=='US'||s?.id!=='stones-river-'+phaseId)fail('promotion initial phase/time/side');
  const roster=[...new Set([...s.units,...(s.reinforcements||[])].map(u=>u.id))],plan=[],actor='us-ammen-brigade';
  const success=id=>({id,require:'success'}),add=(id,type,unitId,{end,start=0,after=[],condition=[],...extra})=>plan.push({id,notBefore:start,expires:end,after,condition:[{kind:'actor-orderable'},...condition],command:{type,unitId,...extra}});
  for(const u of s.units.filter(u=>u.side==='US'&&(phaseId==='dawn-on-the-right'||u.id!==actor)))add('hold-'+u.id,'hold',u.id,{end:1});
  if(phaseId==='slaughter-pen'){
    for(const id of ['us-shepherd-brigade','us-j-beatty-brigade','us-terrill-battery'])if(roster.includes(id))add('arrival-'+id,'hold',id,{start:450,end:480});
  }else if(phaseId!=='dawn-on-the-right'){
    if(!roster.includes(actor))fail('promotion candidate unavailable');
    const point=phaseId==='round-forest'?[910,-330]:[2180,-1200];
    add('ammen-position','move',actor,{end:180,path:{kind:'actor-to-point',point}});
    add('ammen-hold','hold',actor,{end:240,after:[success('ammen-position')],condition:[{kind:'arrived',point,radius:20}]});
    add('ammen-withdraw','fallback',actor,{end:950,after:[success('ammen-hold')],condition:[{kind:'pressure',moraleMax:35}]});
    add('ammen-recover','hold',actor,{end:phaseId==='round-forest'?1050:1000,after:[success('ammen-withdraw')],condition:[{kind:'recovery',moraleMin:55,requirePriorRouting:false},{kind:'separated',minDistance:220}]});
    const arrivals=phaseId==='round-forest'?[['us-bruce-brigade',328,358]]:[['us-estep-battery',258,288],['us-board-of-trade-battery',258,288],['us-standart-battery',258,288],['us-miller-brigade',515,545],['us-stanley-brigade',515,545]];
    for(const[id,start,end]of arrivals)if(roster.includes(id))add('arrival-'+id,'hold',id,{start,end});
  }
  createBadgeStages(plan,1,roster);
  return {kind:'ordinary defensive continuation; genuine Silver/Gold unproved',recipe:{id:'promotion-'+phaseId,packId:'stones-river',phaseId},revision:0,plan,cadence:1,roster};
}



export const BADGE_RELIEF_ORIGIN=Object.freeze({run:38365651410,sha:'499ffbdd8b7bd2f8c7141b1daf23c04cefb13d5f',artifact:11796878538,name:'badge-observations-1',zipBytes:698428,zipSha:'a03291a24fbd7e5aa0845db5828b2d60ae3a5aeaf9c111e936da25f1e9916b81',saveBytes:36056,saveSha:'50b0750a1ec48d45d01c9561e2f012dc1bf322f7371ece7cfc7673f77f587438'});
export function validateBadgeReliefOrigin(o){
  if(!plain(o,Object.keys(BADGE_RELIEF_ORIGIN))||Object.keys(o).length!==Object.keys(BADGE_RELIEF_ORIGIN).length||Object.keys(BADGE_RELIEF_ORIGIN).some(k=>o[k]!==BADGE_RELIEF_ORIGIN[k]))fail('relief exact completed source/checkpoint origin');
  return true;
}

// Actual clock-relief Round Forest save, before its retained unsuccessful McFadden branch.
export const BADGE_SILVER_ORIGIN=Object.freeze({run:38402398738,sha:'f4f1d8020f7043cab3c7b1f7ceebfd4f4c248443',artifact:11816247710,name:'badge-observations-1',zipBytes:537868,zipSha:'134f7bd2f678ee02dd06e14e98230142b7cae83dd32d96a173c2897cbb7121ef',saveBytes:44066,saveSha:'aa45821a556f8371b0facfae9fd3e9585412a52cd21ef808f668d8dbb753f60b'});
export function validateBadgeSilverOrigin(o){
  if(!plain(o,Object.keys(BADGE_SILVER_ORIGIN))||Object.keys(o).length!==Object.keys(BADGE_SILVER_ORIGIN).length||Object.keys(BADGE_SILVER_ORIGIN).some(k=>o[k]!==BADGE_SILVER_ORIGIN[k]))fail('silver exact completed source/checkpoint origin');
  return true;
}

// Continue the actual surviving forward-defence save; never reset the earned Silver brigade.
export const BADGE_LOOKOUT_ORIGIN=Object.freeze({run:38411184483,sha:'2d8874d29ad8efc216a2ca6fe386bc08658e5d02',artifact:11822470702,name:'badge-observations-1',zipBytes:271555,zipSha:'ec4f0e753af378f0088bf40051c017b561a65988b2048b188a4f1a8bfe512c40',saveBytes:49051,saveSha:'2e8ed947a1fe196c04baa3f6b8505c9eddaf0466a2c09b0e01606c5669c6fd8c'});
export function validateBadgeLookoutOrigin(o){
  if(!plain(o,Object.keys(BADGE_LOOKOUT_ORIGIN))||Object.keys(o).length!==Object.keys(BADGE_LOOKOUT_ORIGIN).length||Object.keys(BADGE_LOOKOUT_ORIGIN).some(k=>o[k]!==BADGE_LOOKOUT_ORIGIN[k]))fail('lookout exact completed source/checkpoint origin');
  return true;
}

export const BADGE_LOOKOUT_PHASES=Object.freeze([
  ['orchard-knob',8,[['ch1-recon','attack'],['ch1-hold','hold']]],
  ['lookout-mountain',9,[['ch2-crossing','upstream'],['ch2-relief','rotate']]],
].map(([phaseId,index,choices])=>Object.freeze({phaseId,packId:'chattanooga',index,choices:Object.freeze(choices.map(c=>Object.freeze(c)))})));

/** One finite ordinary campaign continuation; no feat value participates in order conditions. */
export function badgeLookoutTactic(game,phaseId){
  const spec=BADGE_LOOKOUT_PHASES.find(p=>p.phaseId===phaseId),s=game?.scenario,orchard=phaseId==='orchard-knob';
  if(!spec||game.simTime!==0||game.playerSide!=='US'||s?.id!=='chattanooga-'+phaseId||s.seed!==(orchard?18631123:18631124)||s.start!==(orchard?'13:30':'08:30')||s.end!==(orchard?'15:30':'15:00')||s.clockRatio!==(orchard?7:22))fail('lookout authored initial phase/time/side/clock');
  const roster=[...new Set([...s.units,...(s.reinforcements||[])].map(u=>u.id))],plan=[],success=id=>({id,require:'success'}),terminal=id=>({id,require:'terminal'}),
    add=(id,type,unitId,{end,start=0,after=[],condition=[],...extra})=>plan.push({id,notBefore:start,expires:end,after,condition:[{kind:'actor-orderable'},...condition],command:{type,unitId,...extra}}),
    points=orchard?[['us-hazen-brigade',[-1200,800]],['us-gibson-brigade',[-1160,470]],['us-boyle-brigade',[-1260,220]],['us-wagner-brigade',[-1430,800]],['us-roberts-brigade',[-1430,1030]]]:[['us-cobham-brigade',[-700,550]],['us-ireland-brigade',[-650,300]],['us-candy-brigade',[-650,50]],['us-price-brigade',[-700,800]]],
    guns=orchard?['us-fort-wood-guns']:['us-sahm-battery','us-wiedrich-battery'];
  if(points.some(([id])=>!s.units.some(u=>u.id===id&&u.side==='US'))||guns.some(id=>!s.units.some(u=>u.id===id&&u.side==='US')))fail('lookout required initial actor');
  for(const[id,point]of points){add('position-'+id,'move',id,{end:1,path:{kind:'actor-to-point',point}});add('hold-'+id,'hold',id,{start:1,end:orchard?1000:400,after:[success('position-'+id)],condition:[{kind:'arrived',point,radius:25}]});}
  for(const id of guns)add('hold-'+id,'hold',id,{end:1});
  if(!orchard){
    const reinforcements=[['us-ammen-brigade',409.1],['us-woods-brigade',409.1],['us-williamson-brigade',654.5],['cs-pettus-brigade',777.3]];
    if(reinforcements.some(([id,at])=>!s.reinforcements?.some(u=>u.id===id&&u.atSec===at)))fail('lookout required native reinforcement schedule');
    for(const [id,anchors]of [['us-ammen-brigade',[[-418.8,18.7],[-197.1,44.2],[-134.8,181.1],[-100,470]]],['us-woods-brigade',[[-418.8,18.7],[-197.1,44.2],[-150,260]]]]){
      add('run-'+id,'run',id,{start:410,end:440,enabled:true});add('position-'+id,'move',id,{start:410,end:440,after:[success('run-'+id)],path:{kind:'actor-through-points',points:anchors}});
      add('run-cleanup-'+id,'run',id,{start:600,end:601,after:[terminal('position-'+id)],enabled:false});
    }
    const id='us-williamson-brigade',point=[-100,250];add('position-'+id,'move',id,{start:655,end:685,path:{kind:'actor-through-points',points:[[-418.8,18.7],[-197.1,44.2],point]}});
    add('hold-'+id,'hold',id,{start:656,end:1000,after:[success('position-'+id)],condition:[{kind:'arrived',point,radius:25}]});
    add('ammen-withdraw','fallback','us-ammen-brigade',{start:410,end:1000,after:[success('position-us-ammen-brigade')],condition:[{kind:'pressure',moraleMax:45}]});
    add('ammen-recover','hold','us-ammen-brigade',{end:1050,after:[success('ammen-withdraw')],condition:[{kind:'recovery',moraleMin:55,requirePriorRouting:false},{kind:'separated',minDistance:220}]});
  }
  if(plan.length!==(orchard?11:20))fail('lookout finite stage count');createBadgeStages(plan,1,roster);
  return {kind:'authorized ordinary Orchard then road-anchor Lookout witness; actual position/contact/Gold unproved',recipe:{id:'lookout-continuation-'+phaseId,packId:'chattanooga',phaseId},revision:0,plan,cadence:1,roster};
}

/** Read-only bounded post-tick observations. These values never enter an order condition. */
export function createBadgeLookoutReadiness(){
  const rows=[['us-ammen-brigade',[-100,470]],['us-woods-brigade',[-150,260]]].map(([id,endpoint])=>({id,endpoint,firstSeen:null,samples:0,minEndpointDistance:null,firstArrival:null,lastArrival:null,firstReturnFire:null,lastReturnFire:null,initialHoldingLoss:0,finalHoldingLoss:0,positiveHoldingLoss:0,firstIncrease:null,lastIncrease:null}));
  let lastTime=-1,failure=null;
  return {sample(game,at,feats){
    if(failure)fail('lookout readiness already failed');
    try{if(!Number.isFinite(at)||at!==game.simTime||at<lastTime||!Array.isArray(game.units)||typeof game.combat?.los!=='function'||typeof game.combat?.masks!=='function')fail('lookout readiness native clock/API');if(at===lastTime)return;lastTime=at;
      for(const r of rows){const u=game.units.find(u=>u.id===r.id);if(!u){if(feats[r.id]!==undefined||r.firstSeen!==null)fail('lookout readiness missing native actor');continue;}
        const holding=feats[r.id]?.holdingLoss;if(![u.x,u.z,u.men,u.morale,holding].every(Number.isFinite)||u.fireT!==undefined&&!Number.isFinite(u.fireT)||holding<r.finalHoldingLoss||typeof u.follow?.active!=='boolean'||typeof u.firing!=='boolean'||typeof u.engaged!=='boolean'||typeof u.order?.type!=='string')fail('lookout readiness malformed native actor/counter');
        if(r.firstSeen===null)r.firstSeen=at;r.samples++;const distance=Math.hypot(u.x-r.endpoint[0],u.z-r.endpoint[1]);r.minEndpointDistance=r.minEndpointDistance===null?distance:Math.min(r.minEndpointDistance,distance);
        const delta=holding-r.finalHoldingLoss,arrived=distance<=25,stationaryFire=u.alive&&u.men>0&&u.state!=='routing'&&!u.follow.active&&u.firing;
        if(delta>0||arrived||stationaryFire){
          const target=game.units.includes(u.target)?u.target:null,support=game.units.filter(v=>v!==u&&v.side===u.side&&v.type==='infantry'&&v.alive&&v.canTakeOrders()).map(v=>({id:v.id,side:v.side,type:v.type,alive:v.alive,orderable:true,position:[v.x,v.z],distance:Math.hypot(v.x-u.x,v.z-u.z)})).filter(v=>v.distance<=250).sort((a,b)=>a.id.localeCompare(b.id));
          const snapshot={at,position:[u.x,u.z],endpointDistance:distance,men:u.men,alive:u.alive,state:u.state,morale:u.morale,order:u.order.type,following:u.follow.active,engaged:u.engaged,firing:u.firing,fireT:u.fireT??null,holdingLoss:holding,delta,support,target:target?{id:target.id,position:[target.x,target.z],distance:Math.hypot(target.x-u.x,target.z-u.z),los:game.combat.los(u,target),masked:game.combat.masks(u,target)}:null};
          if(arrived){r.firstArrival??=snapshot;r.lastArrival=snapshot;}if(stationaryFire){r.firstReturnFire??=snapshot;r.lastReturnFire=snapshot;}if(delta>0){r.positiveHoldingLoss+=delta;r.firstIncrease??=snapshot;r.lastIncrease=snapshot;}
        }
        r.finalHoldingLoss=holding;
      }
    }catch(error){failure={at,message:String(error?.message??error)};throw error;}
  },receipt:()=>({kind:'read-only post-tick observations; no exact casualty-call state or command authority',lastTime,rows:structuredClone(rows),failure:structuredClone(failure)})};
}

/** Accepted paths are distinct from observed endpoint arrival or contact. */
export function badgeLookoutOrders(tactic,receipt,endAt){
  const orchard=tactic?.recipe?.phaseId==='orchard-knob',expected=orchard?11:20;
  if(!BADGE_LOOKOUT_PHASES.some(p=>p.phaseId===tactic?.recipe?.phaseId)||tactic.recipe.id!=='lookout-continuation-'+tactic.recipe.phaseId||!dense(tactic?.plan)||tactic.plan.length!==expected||!dense(receipt?.stages)||receipt.stages.length!==expected||receipt.failure||receipt.cadence!==1||!Number.isFinite(endAt))return false;
  if(JSON.stringify(receipt.stages.map(r=>r.id))!==JSON.stringify(tactic.plan.map(p=>p.id)))return false;
  const byId=new Map(receipt.stages.map(r=>[r.id,r]));
  if(receipt.stages.some((r,i)=>['command','after','condition','notBefore','expires'].some(k=>JSON.stringify(r[k])!==JSON.stringify(tactic.plan[i][k]))||r.trace&&r.after.some(d=>{const dep=byId.get(d.id);return !dep||!Number.isFinite(dep.at)||dep.at>r.at||(d.require==='success'?!['accepted','already-satisfied'].includes(dep.state):['pending'].includes(dep.state));})))return false;
  if(receipt.stages.some(r=>r.state==='refused'||r.state==='error'))return false;
  const required=tactic.plan.filter(p=>p.command.type==='move'||p.command.type==='run'||p.command.type==='hold'&&p.notBefore===0&&p.expires===1);
  return required.every(p=>{const matches=receipt.stages.filter(r=>r.id===p.id);if(matches.length!==1)return false;const r=matches[0],t=r.trace;
    if(p.command.type==='run'&&p.command.enabled===false&&endAt<p.notBefore)return r.state==='ended'&&t===null;
    if(!['accepted','already-satisfied'].includes(r.state)||!t||['command','after','condition','notBefore','expires'].some(k=>JSON.stringify(r[k])!==JSON.stringify(p[k])))return false;
    if(!Number.isFinite(r.at)||r.at<p.notBefore||r.at>p.expires||r.at>endAt||t.at!==r.at)return false;
    if(p.command.type==='hold')return r.state==='accepted'&&t.accepted===true&&t.invoked===true&&JSON.stringify(t.command)===JSON.stringify(p.command);
    if(p.command.type==='run')return t.result?.run===p.command.enabled&&JSON.stringify(t.command)===JSON.stringify(p.command)&&(r.state==='accepted'?t.accepted===true&&t.invoked===true:t.accepted===null&&t.invoked===false&&t.reason==='already in requested state');
    const anchors=p.command.path.kind==='actor-through-points'?p.command.path.points:[p.command.path.point],actor=t.resolvedInputs?.actor;
    return r.state==='accepted'&&t.accepted===true&&t.invoked===true&&finitePoint(actor)&&JSON.stringify(t.command)===JSON.stringify({type:'move',unitId:p.command.unitId,points:[actor,...anchors]})
      &&JSON.stringify(t.resolvedInputs)===JSON.stringify(p.command.path.kind==='actor-through-points'?{actor,points:anchors}:{actor,point:anchors[0]});
  });
}
export function validateBadgeLookoutReadiness(receipt,native){
  if(receipt?.failure||receipt?.lastTime!==native?.simTime||!dense(receipt?.rows)||JSON.stringify(receipt.rows.map(r=>r.id))!==JSON.stringify(['us-ammen-brigade','us-woods-brigade']))fail('lookout readiness final native bind');
  const deployment=[...(native.deployment?.units||[]),...(native.deployment?.reinforcements||[])];
  if(!deployment.length||new Set(deployment.map(d=>d.id)).size!==deployment.length)fail('lookout readiness actual deployment required');
  const defs=new Map(deployment.map(d=>[d.id,d]));
  for(const [i,r]of receipt.rows.entries()){if(JSON.stringify(r.endpoint)!==JSON.stringify(i?[-150,260]:[-100,470]))fail('lookout readiness endpoint bind');const f=native.feats?.[r.id];if(r.firstSeen===null){if(f!==undefined||r.samples!==0||r.finalHoldingLoss!==0||r.positiveHoldingLoss!==0)fail('lookout readiness absent actor');continue;}
    if(!f||defs.get(r.id)?.side!=='US'||r.initialHoldingLoss!==0||!Number.isSafeInteger(r.samples)||r.samples<1||!Number.isFinite(r.firstSeen)||r.firstSeen<0||r.firstSeen+1e-6<(defs.get(r.id).atSec||0)||r.firstSeen>native.simTime||!Number.isFinite(r.minEndpointDistance)||r.minEndpointDistance<0||r.finalHoldingLoss!==f.holdingLoss||!Number.isFinite(r.positiveHoldingLoss)||Math.abs(r.positiveHoldingLoss-f.holdingLoss)>1e-8)fail('lookout readiness qualifying loss bind');
    for(const [key,predicate]of [['firstArrival',s=>s.endpointDistance<=25],['lastArrival',s=>s.endpointDistance<=25],['firstReturnFire',s=>s.alive&&s.men>0&&!s.following&&s.firing],['lastReturnFire',s=>s.alive&&s.men>0&&!s.following&&s.firing],['firstIncrease',s=>s.delta>0],['lastIncrease',s=>s.delta>0]]){
      const s=r[key];if(s===null)continue;if(!Number.isFinite(s.at)||s.at<r.firstSeen||s.at>native.simTime||!finitePoint(s.position)||!Number.isFinite(s.endpointDistance)||Math.abs(s.endpointDistance-Math.hypot(s.position[0]-r.endpoint[0],s.position[1]-r.endpoint[1]))>1e-8||!predicate(s)||!dense(s.support)||s.support.some(v=>!finitePoint(v.position)||!Number.isFinite(v.distance)||v.distance>250||Math.abs(v.distance-Math.hypot(v.position[0]-s.position[0],v.position[1]-s.position[1]))>1e-8))fail('lookout readiness observed snapshot');
      if(!Number.isFinite(s.holdingLoss)||s.holdingLoss<0||s.holdingLoss>r.finalHoldingLoss||!Number.isFinite(s.delta)||s.delta<0||s.delta>s.holdingLoss||!Number.isFinite(s.men)||s.men<0||!Number.isFinite(s.morale)||typeof s.state!=='string'||typeof s.order!=='string'||['alive','following','engaged','firing'].some(k=>typeof s[k]!=='boolean')||s.fireT!==null&&!Number.isFinite(s.fireT)||s.endpointDistance+1e-8<r.minEndpointDistance)fail('lookout readiness snapshot native state');
      if(new Set(s.support.map(v=>v.id)).size!==s.support.length||s.support.some(v=>v.id===r.id||defs.get(v.id)?.side!=='US'||(defs.get(v.id)?.type||'infantry')!=='infantry'||v.side!=='US'||v.type!=='infantry'||v.alive!==true||v.orderable!==true||s.at+1e-6<(defs.get(v.id)?.atSec||0)))fail('lookout readiness actual eligible support identity');
      if(s.target!==null){const t=s.target;if(defs.get(t.id)?.side!=='CS'||s.at+1e-6<(defs.get(t.id)?.atSec||0)||!finitePoint(t.position)||!Number.isFinite(t.distance)||t.distance<0||Math.abs(t.distance-Math.hypot(t.position[0]-s.position[0],t.position[1]-s.position[1]))>1e-8||typeof t.los!=='boolean'||typeof t.masked!=='boolean')fail('lookout readiness actual enemy target geometry');}
    }
    if(r.positiveHoldingLoss>0&&(!r.firstIncrease||!r.lastIncrease))fail('lookout readiness missing increase snapshots');
  }
  return true;
}
export function badgeLookoutComplete(rows,promotion){
  if(!dense(rows)||![1,2].includes(rows.length)||JSON.stringify(rows.map(r=>r.id))!==JSON.stringify(BADGE_LOOKOUT_PHASES.slice(0,rows.length).map(p=>p.phaseId))||rows.some(r=>r.complete!==true))return false;
  return rows.length===2&&promotion?.achieved===true&&promotion.stopReason===null||promotion?.achieved===false&&(rows.length===1?promotion.stopReason==='actual Orchard orders refused or expired':['actual Lookout orders refused or expired','actual Lookout ended before required reinforcement orders','actual Lookout did not persist Silver-to-Gold'].includes(promotion?.stopReason));
}

/** One distinct McFadden defence from the genuinely saved Silver brigade. */
export function badgeForwardDefenceTactic(game,phaseId){
  const s=game?.scenario;
  if(phaseId!=='mcfaddens-ford'||game.simTime!==0||game.playerSide!=='US'||s?.id!=='stones-river-mcfaddens-ford'||s.start!=='16:00'||s.clockRatio!==3.5)fail('forward defence authored initial phase/time/side/clock');
  const actor='us-ammen-brigade',points=[[actor,[2100,-1080]],['us-fyffe-brigade',[2300,-1210]],['us-boyle-brigade',[1900,-1210]]],
    arrivals=[['us-estep-battery',258,288],['us-board-of-trade-battery',258,288],['us-standart-battery',258,288],['us-miller-brigade',515,545],['us-stanley-brigade',515,545]],
    roster=[...new Set([...s.units,...(s.reinforcements||[])].map(u=>u.id))];
  if(points.some(([id])=>!s.units.some(u=>u.id===id&&u.side==='US'))||arrivals.some(([id])=>!roster.includes(id)))fail('forward defence required initial/reinforcement actor unavailable');
  const plan=[],success=id=>({id,require:'success'}),add=(id,type,unitId,{end,start=0,after=[],condition=[],...extra})=>plan.push({id,notBefore:start,expires:end,after,condition:[{kind:'actor-orderable'},...condition],command:{type,unitId,...extra}});
  for(const [id,point]of points){
    const move=id===actor?'ammen-position':'support-position-'+id,hold=id===actor?'ammen-hold':'support-hold-'+id;
    add(move,'move',id,{end:1,path:{kind:'actor-to-point',point}});
    add(hold,'hold',id,{start:1,end:240,after:[success(move)],condition:[{kind:'arrived',point,radius:25}]});
  }
  for(const u of s.units.filter(u=>u.side==='US'&&!points.some(([id])=>id===u.id)))add('hold-'+u.id,'hold',u.id,{end:1});
  for(const [id,start,end]of arrivals)add('arrival-'+id,'hold',id,{start,end});
  add('ammen-withdraw','fallback',actor,{end:950,after:[success('ammen-position')],condition:[{kind:'pressure',moraleMax:45}]});
  add('ammen-recover','hold',actor,{end:1000,after:[success('ammen-withdraw')],condition:[{kind:'recovery',moraleMin:55,requirePriorRouting:false},{kind:'separated',minDistance:220}]});
  if(plan.length!==24)fail('forward defence stage count');createBadgeStages(plan,1,roster);
  return {kind:'authorized supported forward McFadden defence; genuine saved Gold unproved',recipe:{id:'forward-defence-mcfaddens-ford',packId:'stones-river',phaseId},revision:0,plan,cadence:1,roster};
}
export function badgeForwardDefencePositions(tactic,receipt){
  if(tactic?.recipe?.id!=='forward-defence-mcfaddens-ford'||!dense(tactic.plan)||tactic.plan.length!==24||!dense(receipt?.stages)||receipt.failure||receipt.cadence!==1)return false;
  const points=[['ammen-position','ammen-hold',[2100,-1080]],['support-position-us-fyffe-brigade','support-hold-us-fyffe-brigade',[2300,-1210]],['support-position-us-boyle-brigade','support-hold-us-boyle-brigade',[1900,-1210]]];
  return points.every(([move,hold,point])=>JSON.stringify(tactic.plan.find(r=>r.id===move)?.command.path?.point)===JSON.stringify(point)
    &&acceptedBadgeStages(tactic,receipt,[move,hold]));
}
export function badgeForwardDefenceComplete(rows,promotion){
  if(!dense(rows)||rows.length!==1||rows[0]?.id!=='mcfaddens-ford'||rows[0].complete!==true)return false;
  return promotion?.achieved===true&&promotion.stopReason===null||promotion?.achieved===false&&['actual relief positioning refused or expired','actual McFadden did not persist Silver-to-Gold'].includes(promotion?.stopReason);
}

/** One separately authorized relief witness; no replay, repeated assault or counter-triggered action. */
export function badgeReliefTactic(game,phaseId){
  if(!['round-forest','mcfaddens-ford'].includes(phaseId)||game.simTime!==0||game.playerSide!=='US'||game.scenario?.id!=='stones-river-'+phaseId)fail('relief initial phase/time/side');
  const s=game.scenario,roster=[...new Set([...s.units,...(s.reinforcements||[])].map(u=>u.id))],actor='us-ammen-brigade';
  const points=phaseId==='round-forest'?[['us-hazen-brigade',[750,-450]],[actor,[935,-300]]]:
    [['us-price-brigade',[1730,-1500]],['us-fyffe-brigade',[2120,-1470]],[actor,[1910,-1360]]];
  if(points.some(([id])=>!s.units.some(u=>u.id===id&&u.side==='US')))fail('relief required initial actor unavailable');
  const plan=[],success=id=>({id,require:'success'}),add=(id,type,unitId,{end,start=0,after=[],condition=[],...extra})=>plan.push({id,notBefore:start,expires:end,after,condition:[{kind:'actor-orderable'},...condition],command:{type,unitId,...extra}});
  for(const u of s.units.filter(u=>u.side==='US'&&!points.some(([id])=>id===u.id)))add('hold-'+u.id,'hold',u.id,{end:1});
  for(const[id,point]of points){
    const move=id===actor?'ammen-position':'relief-position-'+id,hold=id===actor?'ammen-hold':'relief-hold-'+id;
    add(move,'move',id,{end:1,path:{kind:'actor-to-point',point}});
    add(hold,'hold',id,{start:120,end:240,after:[success(move)],condition:[{kind:'arrived',point,radius:25}]});
  }
  add('ammen-withdraw','fallback',actor,{end:950,after:[success('ammen-hold')],condition:[{kind:'pressure',moraleMax:35}]});
  add('ammen-recover','hold',actor,{end:phaseId==='round-forest'?1050:1000,after:[success('ammen-withdraw')],condition:[{kind:'recovery',moraleMin:55,requirePriorRouting:false},{kind:'separated',minDistance:220}]});
  const arrivals=phaseId==='round-forest'?[['us-bruce-brigade',328,358]]:[['us-estep-battery',258,288],['us-board-of-trade-battery',258,288],['us-standart-battery',258,288],['us-miller-brigade',515,545],['us-stanley-brigade',515,545]];
  for(const[id,start,end]of arrivals)if(roster.includes(id))add('arrival-'+id,'hold',id,{start,end});
  createBadgeStages(plan,1,roster);
  return {kind:'one authorized front-line relief witness; genuine saved upgrades unproved',recipe:{id:'relief-'+phaseId,packId:'stones-river',phaseId},revision:0,plan,cadence:1,roster};
}

/** Separately authorized, distinct open-ground defence; original relief recipe stays intact. */
export function badgeOpenLineTactic(game,phaseId){
  const tactic=badgeReliefTactic(game,phaseId),point=[940,-230];
  const plan=tactic.plan.map(stage=>{
    const next=structuredClone(stage);
    if(phaseId==='round-forest'){
      if(next.id==='ammen-position')next.command.path.point=point.slice();
      if(['ammen-hold','relief-hold-us-hazen-brigade'].includes(next.id)){
        next.notBefore=1;if(next.id==='ammen-hold')next.condition.at(-1).point=point.slice();
      }
    }
    return next;
  });
  createBadgeStages(plan,1,tactic.roster);
  return {...tactic,kind:'authorized forward open-ground defensive witness; genuine saved upgrades unproved',recipe:{...tactic.recipe,id:'open-line-'+phaseId},plan};
}

/** Planned 12:15 relief after Bruce's noon arrival; clocks never inspect badge counters. */
export function badgeClockReliefTactic(game,phaseId){
  const tactic=badgeOpenLineTactic(game,phaseId),s=game.scenario;
  let plan=tactic.plan.map(r=>structuredClone(r));
  if(phaseId==='round-forest'){
    if(s.start!=='10:00'||s.clockRatio!==22||JSON.stringify(s.retreat?.US)!=='[-18,-1323]')fail('clock relief authored clock/retreat drift');
    plan=plan.filter(r=>!['ammen-hold','ammen-withdraw','ammen-recover'].includes(r.id));
    const actor='us-ammen-brigade',success=id=>({id,require:'success'}),terminal=id=>({id,require:'terminal'}),
      add=(id,type,options)=>plan.push({id,notBefore:369,expires:370,after:[],condition:[{kind:'actor-orderable'}],command:{type,unitId:actor},...options});
    add('ammen-relief-run','run',{after:['ammen-position','relief-hold-us-hazen-brigade','arrival-us-bruce-brigade'].map(success),command:{type:'run',unitId:actor,enabled:true}});
    add('ammen-relief-move','move',{after:[success('ammen-relief-run')],command:{type:'move',unitId:actor,path:{kind:'actor-to-point',point:s.retreat.US.slice()}}});
    add('ammen-reserve-hold','hold',{expires:1040,after:[success('ammen-relief-move')],condition:[{kind:'actor-orderable'},{kind:'arrived',point:s.retreat.US.slice(),radius:25},{kind:'recovery',moraleMin:55,requirePriorRouting:false},{kind:'separated',minDistance:220}]});
    add('ammen-relief-cleanup','run',{notBefore:1050,expires:1051,after:['ammen-relief-run','ammen-relief-move','ammen-reserve-hold'].map(terminal),command:{type:'run',unitId:actor,enabled:false}});
    if(plan.length!==14)fail('clock relief stage count');
  }
  createBadgeStages(plan,1,tactic.roster);
  return {...tactic,kind:'authorized battle-clock relief witness; genuine saved upgrades unproved',recipe:{...tactic.recipe,id:'clock-relief-'+phaseId},plan};
}


/** Positioning is a prerequisite for the next witness phase, never a badge-counter trigger. */
export function badgeReliefPositions(tactic,receipt){
  const phase=tactic?.recipe?.phaseId,ids=phase==='round-forest'?['us-hazen-brigade']:phase==='mcfaddens-ford'?['us-price-brigade','us-fyffe-brigade']:null;
  if(!ids||!dense(tactic?.plan)||!dense(receipt?.stages)||receipt.failure||receipt.cadence!==1)return false;
  const wanted=['ammen-position','ammen-hold',...ids.flatMap(id=>['relief-position-'+id,'relief-hold-'+id])];
  return acceptedBadgeStages(tactic,receipt,wanted);
}
function acceptedBadgeStages(tactic,receipt,wanted){
  return wanted.every(id=>{
    const rows=receipt.stages.filter(r=>r?.id===id),plans=tactic.plan.filter(r=>r?.id===id);
    if(rows.length!==1||plans.length!==1)return false;
    const row=rows[0],plan=plans[0],trace=row.trace;
    return row.state==='accepted'&&trace?.accepted===true&&trace.invoked===true
      &&['command','after','condition','notBefore','expires'].every(k=>JSON.stringify(row[k])===JSON.stringify(plan[k]))
      &&trace.command?.type===plan.command.type&&trace.command.unitId===plan.command.unitId
      &&(plan.command.type!=='move'||dense(trace.command.points)&&JSON.stringify(trace.command.points.at(-1))===JSON.stringify(plan.command.path.point));
  });
}
export function badgeClockReliefPositions(tactic,receipt){
  if(tactic?.recipe?.phaseId==='mcfaddens-ford')return badgeReliefPositions(tactic,receipt);
  if(tactic?.recipe?.id!=='clock-relief-round-forest'||!dense(tactic.plan)||!dense(receipt?.stages)||receipt.failure||receipt.cadence!==1)return false;
  const wanted=['ammen-position','relief-position-us-hazen-brigade','relief-hold-us-hazen-brigade','arrival-us-bruce-brigade','ammen-relief-run','ammen-relief-move','ammen-reserve-hold'];
  if(!acceptedBadgeStages(tactic,receipt,wanted))return false;
  const cleanupRows=receipt.stages.filter(r=>r.id==='ammen-relief-cleanup'),cleanupPlans=tactic.plan.filter(r=>r.id==='ammen-relief-cleanup');
  if(cleanupRows.length!==1||cleanupPlans.length!==1)return false;
  const cleanup=cleanupRows[0],cleanupPlan=cleanupPlans[0],trace=cleanup.trace;
  if(!['command','after','condition','notBefore','expires'].every(k=>JSON.stringify(cleanup[k])===JSON.stringify(cleanupPlan[k]))
    ||JSON.stringify(trace?.command)!==JSON.stringify(cleanupPlan.command)||trace?.result?.run!==false
    ||!(cleanup.state==='accepted'&&trace.accepted===true&&trace.invoked===true
      ||cleanup.state==='already-satisfied'&&trace.accepted===null&&trace.invoked===false&&trace.reason==='already in requested state'))return false;
  const move=receipt.stages.find(r=>r.id==='ammen-relief-move'),point=move.trace?.resolvedInputs?.actor;
  return finitePoint(point)&&Math.hypot(point[0]-940,point[1]+230)<=25
    &&JSON.stringify(move.trace.command.points[0])===JSON.stringify(point)
    &&JSON.stringify(move.trace.command.points.at(-1))==='[-18,-1323]'
    &&receipt.stages.find(r=>r.id==='ammen-relief-run').trace.command.enabled===true
    &&receipt.stages.find(r=>r.id==='ammen-relief-run').trace.result?.run===true&&trace.command.enabled===false;
}
/** A natural shortfall completes an observation; a missing or failed native case cannot. */
export function badgeReliefComplete(rows,promotion){
  if(!dense(rows)||!rows.length||rows.length>2||rows.some(r=>r?.complete!==true)||rows[0].id!=='round-forest'||rows.length===2&&rows[1].id!=='mcfaddens-ford')return false;
  const positioning='actual relief positioning refused or expired';
  if(rows.length===1)return promotion?.achieved===false&&[positioning,'actual Round Forest did not persist a living Bronze-to-Silver candidate'].includes(promotion?.stopReason);
  return promotion?.achieved===true&&promotion.stopReason===null||promotion?.achieved===false&&[positioning,'actual McFadden did not persist Silver-to-Gold'].includes(promotion?.stopReason);
}

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
    receipt.result={type:unit.order.type,targetId:unit.order.target?.id||null,destination:unit.order.dest?Array.from(unit.order.dest):null,holdFire:unit.holdFire,run:unit.run};
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

/** Private modes are explicit and mutually exclusive with ordinary suite flags. */
export function badgeObservationSelection(args){
  if(!dense(args)||args.some(a=>typeof a!=='string'))fail('mode arguments');
  if(!args.some(a=>a.startsWith('--badge-')))return null;
  if(args.length===1&&args[0]==='--badge-observer')return {mode:'prerequisite',shard:null};
  if(args.length===1&&args[0]==='--badge-level10')return {mode:'level10',shard:null};
  if(args.length===1&&args[0]==='--badge-missionary')return {mode:'missionary',shard:1};
  if(args.length===1&&args[0]==='--badge-missionary-revision')return {mode:'missionary-revision',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion')return {mode:'promotion',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion-relief')return {mode:'promotion-relief',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion-open-line')return {mode:'promotion-open-line',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion-clock-relief')return {mode:'promotion-clock-relief',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion-forward-defence')return {mode:'promotion-forward-defence',shard:1};
  if(args.length===1&&args[0]==='--badge-promotion-lookout')return {mode:'promotion-lookout',shard:1};
  const shards=args.filter(a=>/^--badge-shard=[123]$/.test(a));
  if(args.length===2&&args.includes('--badge-observations')&&shards.length===1)return {mode:'observations',shard:Number(shards[0].slice(-1))};
  if(args.length===2&&args.includes('--badge-revisions')&&shards.length===1)return {mode:'revisions',shard:Number(shards[0].slice(-1))};
  fail('explicit badge mode/shard required; conflicting or unknown selector');
}

/** Completeness follows the declared exact selection, including the two legitimate singleton modes. */
export function badgeObservationComplete(selected,rows){
  const allowed=[['slaughter-fire','missionary-assault'],['slaughter-defence','mcfadden-assault'],['slaughter-recovery','buell-capture'],['slaughter-fire'],['missionary-assault']];
  if(!dense(selected)||!allowed.some(ids=>JSON.stringify(ids)===JSON.stringify(selected))||!dense(rows))fail('observation completion scope');
  return rows.length===selected.length&&rows.every((row,i)=>row?.id===selected[i]&&row.complete===true);
}

/** First finite tactics approved by Astra. These are hypotheses, never promised badge outcomes. */
export function badgeTactic(game,observation,revision=0){
  const recipe=BADGE_OBSERVATIONS.find(r=>r.id===observation),s=game.scenario;
  if(!recipe||game.simTime!==0||game.playerSide!=='US'||s?.id!==recipe.packId+'-'+recipe.phaseId)fail('tactic initial phase/time/side');
  if(![0,1].includes(revision))fail('one approved revision; no second tactic revision');
  const roster=[...new Set([...s.units,...(s.reinforcements||[])].map(u=>u.id))],plan=[];
  const unit=(name,side='US',type='brigade')=>side.toLowerCase()+'-'+name+'-'+type;
  const us=name=>unit(name),cs=name=>unit(name,'CS'),battery=name=>unit(name,'US','battery');
  const orderable={kind:'actor-orderable'},successDep=id=>({id,require:'success'}),terminalDep=id=>({id,require:'terminal'});
  const add=(id,type,unitId,{start=0,end,after=[],condition=[],...extra}={})=>{
    plan.push({id,notBefore:start,expires:end,after,condition:[orderable,...condition],command:{type,unitId,...extra}});return id;
  };
  const move=(id,actor,point,options)=>add(id,'move',actor,{...options,path:{kind:'actor-to-point',point}});
  const toward=(id,actor,targetId,standOff,options)=>add(id,'move',actor,{...options,targetId,path:{kind:'actor-to-target',standOff}});
  const charge=(id,actor,targetId,options={})=>add(id,'charge',actor,{...options,targetId,path:{kind:'actor-to-target',standOff:0},condition:[
    ...(options.condition||[]),{kind:'target-unbroken',targetId},{kind:'distance',targetId,max:180},{kind:'support',radius:250,min:1,types:['infantry']}]});
  const ended=(actorId,targetId,afterStage)=>({kind:'native-engagement-ended',actorId,targetId,afterStage,quietSeconds:10});
  const r=us('roberts'),g=us('greusel'),m=cs('manigault');
  if(observation==='slaughter-fire'){
    move('roberts-cedars',r,[310,800],{end:120});
    add('roberts-hold','hold',r,{end:120,after:[successDep('roberts-cedars')],condition:[{kind:'arrived',point:[310,800],radius:20}]});
    add('stanley-hold','hold',us('stanley'),{end:1});
    const near=[{kind:'target-unbroken',targetId:m},{kind:'distance',targetId:m,max:220}];
    add('greusel-holdfire','holdfire',g,{end:400,condition:near,enabled:true});
    add('greusel-run','run',g,{end:400,after:[successDep('greusel-holdfire')],enabled:true});
    toward('greusel-approach',g,m,45,{end:400,after:[successDep('greusel-run')]});
    add('greusel-fire-hold','hold',g,{end:599,after:[successDep('greusel-approach')],condition:[{kind:'fire-ready',maxDistance:55}]});
    add('greusel-stop-run','run',g,{end:599,after:[successDep('greusel-fire-hold')],enabled:false});
    add('greusel-release','holdfire',g,{end:599,after:[successDep('greusel-stop-run')],enabled:false});
    add('cleanup-run','run',g,{start:600,end:601,after:[terminalDep('greusel-release')],enabled:false});
    add('cleanup-fire','holdfire',g,{start:600,end:601,after:[terminalDep('greusel-release')],enabled:false});
  }else if(observation==='slaughter-defence'){
    for(const actor of [r,g,us('schaefer'),us('stanley'),us('miller'),...['houghtaling','bush','hescock','bartlett'].map(battery)])add('hold-'+actor,'hold',actor,{end:1});
    for(const actor of [us('shepherd'),us('j-beatty'),battery('terrill')])add('arrival-'+actor,'hold',actor,{start:450,end:480});
  }else if(observation==='slaughter-recovery'){
    add('roberts-hold','hold',r,{end:1});add('greusel-hold','hold',g,{end:1});
    add('greusel-fallback','fallback',g,{end:450,condition:[{kind:'pressure',moraleMax:60}]});
    add('greusel-recovered','hold',g,{end:700,after:[successDep('greusel-fallback')],condition:[{kind:'recovery',moraleMin:60,requirePriorRouting:false}]});
    charge('roberts-charge',r,m,{end:350});
    add('roberts-fallback','fallback',r,{end:650,after:[successDep('roberts-charge')],condition:[{kind:'native-contact',targetId:m,afterStage:'roberts-charge'},{kind:'pressure',moraleMax:45}]});
    add('roberts-recovered','hold',r,{end:850,after:[successDep('roberts-fallback')],condition:[{kind:'recovery',moraleMin:60,requirePriorRouting:false},{kind:'separated',minDistance:80}]});
    charge('roberts-renewed',r,m,{end:950,after:[successDep('roberts-recovered')]});
    add('cleanup','hold',r,{start:1000,end:1001,after:[terminalDep('roberts-renewed')]});
  }else if(observation==='mcfadden-assault'){
    const b=us('bruce');move('bruce-position',b,[1540,-1490],{end:300});
    add('bruce-hold','hold',b,{end:300,after:[successDep('bruce-position')],condition:[{kind:'arrived',point:[1540,-1490],radius:25}]});
    for(const name of ['price','fyffe','boyle','ammen'])add(name+'-hold','hold',us(name),{end:1});
    let previous=null,previousTarget=null;
    for(const [name,end]of [['hanson',400],['palmer',600],['adams',800],['preston',975]]){
      const target=cs(name),approach=name+'-approach',attack=name+'-charge';
      toward(approach,b,target,160,{end,after:[successDep(previous||'bruce-hold')],condition:previous?[ended(b,previousTarget,previous)]:[]});
      charge(attack,b,target,{end,after:[successDep(approach)],condition:[{kind:'target-larger',targetId:target}]});previous=attack;previousTarget=target;
    }
    add('cleanup','hold',b,{start:1000,end:1001,after:[terminalDep(previous)]});
  }else if(observation==='missionary-assault'){
    move('carlin-support',us('carlin-1st'),[-700,2780],{end:1});let previous=null,previousTarget=null;
    for(const [name,end]of [['finley',350],['bate',600],['strahl',850],['stovall',1040]]){
      const target=cs(name),support=name+'-support',approach=name+'-approach',attack=name+'-charge';
      toward(support,g,target,180,{end,after:previous?[successDep(previous)]:[],condition:previous?[ended(r,previousTarget,previous)]:[]});
      toward(approach,r,target,160,{end,after:[successDep(support)]});
      charge(attack,r,target,{end,after:[successDep(approach)],condition:[{kind:'target-cover',targetId:target}]});previous=attack;previousTarget=target;
    }
    add('cleanup','hold',r,{start:1050,end:1051,after:[terminalDep(previous)]});
  }else if(observation==='buell-capture'){
    const actor=us('rousseau'),owned=n=>({kind:'crate-owned',crateId:'buell-game-supply-'+n,side:'US'});
    move('cache-1',actor,[-170,-650],{end:300});
    move('cache-2',actor,[-100,-390],{end:550,after:[successDep('cache-1')],condition:[owned(1)]});
    move('cache-3',actor,[-100,-150],{end:800,after:[successDep('cache-2')],condition:[owned(2)]});
    add('cache-run','run',actor,{end:1100,after:[successDep('cache-3')],condition:[owned(3)],enabled:true});
    move('cache-4',actor,[-180,170],{end:1100,after:[successDep('cache-run')]});
    add('cache-stop','run',actor,{end:1180,after:[successDep('cache-4')],condition:[owned(4)],enabled:false});
    add('cache-hold','hold',actor,{end:1180,after:[successDep('cache-stop')]});
    move('bruce-support',us('bruce'),[450,-100],{end:1});move('ammen-support',us('ammen'),[700,-100],{end:1});
    let previous=null,previousTarget=null;const hazen=us('hazen');
    for(const [name,end]of [['hodgson',650],['mcclung',1100]]){
      const target=unit(name,'CS','battery'),approach=name+'-approach',attack=name+'-charge';
      toward(approach,hazen,target,160,{end,after:previous?[successDep(previous)]:[],condition:previous?[ended(hazen,previousTarget,previous)]:[]});
      charge(attack,hazen,target,{end,after:[successDep(approach)]});previous=attack;previousTarget=target;
    }
    for(const actor of [us('wsmith'),us('boyle'),us('kirk'),unit('wallace','US','division')])move('objective-'+actor,actor,[-292,122],{end:1});
    move('gibson-arrival',us('gibson'),[-292,122],{start:836,end:866});
    add('hazen-cleanup','hold',hazen,{start:1180,end:1181,after:[terminalDep(previous)]});
  }
  const expected={'slaughter-fire':11,'slaughter-defence':12,'slaughter-recovery':9,'mcfadden-assault':15,'missionary-assault':14,'buell-capture':19};
  if(plan.length!==expected[observation])fail('tactic count drift');
  if(revision===1){
    if(observation==='slaughter-fire'){
      plan.splice(3);const actor=us('miller'),target=cs('anderson');
      add('miller-holdfire','holdfire',actor,{end:1,enabled:true});
      add('miller-run','run',actor,{end:1,after:[successDep('miller-holdfire')],enabled:true});
      move('miller-flank',actor,[950,1300],{end:200,after:[successDep('miller-run')]});
      toward('miller-approach',actor,target,45,{end:400,after:[successDep('miller-flank')],condition:[{kind:'arrived',point:[950,1300],radius:20}]});
      add('miller-fire-hold','hold',actor,{end:599,after:[successDep('miller-approach')],condition:[{kind:'fire-ready',maxDistance:55}]});
      add('miller-stop-run','run',actor,{end:599,after:[successDep('miller-fire-hold')],enabled:false});
      add('miller-release','holdfire',actor,{end:599,after:[successDep('miller-stop-run')],enabled:false});
      add('cleanup-run','run',actor,{start:600,end:601,after:[terminalDep('miller-release')],enabled:false});
      add('cleanup-fire','holdfire',actor,{start:600,end:601,after:[terminalDep('miller-release')],enabled:false});
    }else if(observation==='slaughter-defence'){
      const kept=plan.filter(row=>!['hold-'+r,'hold-'+battery('houghtaling')].includes(row.id));plan.splice(0);
      for(const [actor,point]of [[r,[310,900]],[battery('houghtaling'),[367,914]]]){
        move('forward-'+actor,actor,point,{end:120});
        add('forward-hold-'+actor,'hold',actor,{end:120,after:[successDep('forward-'+actor)],condition:[{kind:'arrived',point,radius:20}]});
      }plan.push(...kept);
    }else if(observation==='slaughter-recovery'){
      const kept=plan.splice(0);move('schaefer-support',us('schaefer'),[180,900],{end:120});
      add('schaefer-support-hold','hold',us('schaefer'),{end:120,after:[successDep('schaefer-support')],condition:[{kind:'arrived',point:[180,900],radius:20}]});plan.push(...kept);
      const ends={'greusel-fallback':900,'greusel-recovered':1000,'roberts-charge':650,'roberts-fallback':850,'roberts-recovered':950,'roberts-renewed':1000,'cleanup':1041};
      for(const row of plan)if(Object.hasOwn(ends,row.id))row.expires=ends[row.id];plan.find(row=>row.id==='cleanup').notBefore=1040;
    }else if(observation==='mcfadden-assault'){
      const kept=plan.splice(0).filter(row=>row.id!=='price-hold');let previous=null,previousTarget=null;
      for(const row of kept){
        if(row.id.endsWith('-approach')){
          const name=row.id.slice(0,-9),target=cs(name),support=name+'-price-support';
          toward(support,us('price'),target,180,{end:row.expires,after:[successDep(previous||'bruce-hold')],condition:previous?[ended(us('bruce'),previousTarget,previous)]:[]});
          row.after=[successDep(support)];previous=name+'-charge';previousTarget=target;
        }plan.push(row);
      }
    }else if(observation==='missionary-assault'){
      plan.splice(0);move('carlin-support',us('carlin-1st'),[-700,2780],{end:1});
      move('roberts-flank',r,[-1150,2600],{end:250});
      let previous=null,previousTarget=null,previousStop=null;
      for(const [name,end]of [['finley',350],['bate',600],['tucker',850],['manigault',1040]]){
        const target=cs(name),support=name+'-support',walk=name+'-walk',run=name+'-run',approach=name+'-approach',attack=name+'-charge',stop=name+'-stop-run';
        toward(support,g,target,180,{end,after:previous?[successDep(previous),successDep(previousStop)]:[],condition:previous?[ended(r,previousTarget,previous)]:[]});
        toward(walk,r,target,230,{end,after:[successDep(support),successDep(previousStop||'roberts-flank')],condition:previous?[]:[{kind:'arrived',point:[-1150,2600],radius:20}]});
        add(run,'run',r,{end,after:[successDep(walk)],condition:[{kind:'target-unbroken',targetId:target},{kind:'distance',targetId:target,max:250}],enabled:true});
        toward(approach,r,target,120,{end,after:[successDep(run)]});
        charge(attack,r,target,{end,after:[successDep(approach)],condition:name==='tucker'?[{kind:'target-cover',targetId:target}]:[]});
        add(stop,'run',r,{end,after:[successDep(attack)],enabled:false});previous=attack;previousTarget=target;previousStop=stop;
      }
      add('cleanup-run','run',r,{start:1050,end:1052,enabled:false});
      add('cleanup-roberts','hold',r,{start:1050,end:1052,after:[terminalDep(previous)]});
      add('cleanup-greusel','hold',g,{start:1050,end:1052,after:[terminalDep(previous)]});
    }else if(observation==='buell-capture'){
      const kept=plan.splice(0),hazen=us('hazen'),bruce=us('bruce');
      for(const row of kept){
        if(row.id==='mcclung-approach'){
          add('bruce-second-run','run',bruce,{end:600,after:[successDep('hodgson-charge')],condition:[ended(hazen,unit('hodgson','CS','battery'),'hodgson-charge')],enabled:true});
          move('bruce-second-support',bruce,[400,220],{end:600,after:[successDep('bruce-second-run')]});
          add('bruce-second-stop','run',bruce,{end:600,after:[successDep('bruce-second-support')],condition:[{kind:'arrived',point:[400,220],radius:20}],enabled:false});
        }else if(row.id==='mcclung-charge'){row.after=[successDep('bruce-second-stop')];row.expires=800;plan.push(row);}
        else plan.push(row);
      }
      add('bruce-second-cleanup','run',bruce,{start:601,end:602,after:[terminalDep('bruce-second-stop')],enabled:false});
    }
    const counts={'slaughter-fire':12,'slaughter-defence':14,'slaughter-recovery':11,'mcfadden-assault':18,'missionary-assault':29,'buell-capture':22};
    if(plan.length!==counts[observation])fail('revised tactic count drift');
  }
  // Validate all identities and atoms before any native order can be attempted.
  createBadgeStages(plan,1,roster);
  return {kind:revision===1?'Astra-approved single legal revision; no natural result guaranteed':'Astra-approved first finite tactic; natural results unproved',revision,recipe,plan,cadence:1,roster};
}

/** Finite data-only conditional stages. Facts are read from native units, never badge counters. */
export function createBadgeStages(plan,cadence,roster){
  if(!dense(plan)||!plan.length||plan.length>128||!Number.isFinite(cadence)||cadence<=0||cadence>20
    ||!dense(roster)||!roster.length||roster.some(id=>typeof id!=='string'||!id)||new Set(roster).size!==roster.length)fail('stage bounds/cadence/roster');
  const known=new Set(roster),seen=new Set(),ids=new Set(),history=new Map();
  const atomKeys={
    'actor-orderable':[],'target-unbroken':['targetId'],distance:['targetId','max'],'target-larger':['targetId'],
    'target-cover':['targetId'],'native-contact':['targetId','afterStage'],
    'native-engagement-ended':['actorId','targetId','afterStage','quietSeconds'],support:['radius','min','types'],'fire-ready':['maxDistance'],pressure:['moraleMax'],
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
      if(!plain(c,['kind','actorId','targetId','afterStage','max','radius','min','types','maxDistance','moraleMax','moraleMin','requirePriorRouting','quietSeconds','minDistance','point','crateId','side'])
        ||!Object.hasOwn(atomKeys,c.kind)||!plain(c,['kind',...atomKeys[c.kind]])
        ||atomKeys[c.kind].some(k=>!Object.hasOwn(c,k))||c.targetId!==undefined&&!known.has(c.targetId))fail('stage condition schema/identity');
      if(c.kind==='distance'&&!positive(c.max)||c.kind==='support'&&(!positive(c.radius)||!Number.isSafeInteger(c.min)||c.min<1
        ||!dense(c.types)||!c.types.length||new Set(c.types).size!==c.types.length||c.types.some(t=>!['infantry','artillery','cavalry'].includes(t)))
        ||c.kind==='fire-ready'&&(!positive(c.maxDistance)||c.maxDistance>55)
        ||c.kind==='pressure'&&(!Number.isFinite(c.moraleMax)||c.moraleMax<0||c.moraleMax>100)
        ||c.kind==='recovery'&&(!Number.isFinite(c.moraleMin)||c.moraleMin<0||c.moraleMin>100||typeof c.requirePriorRouting!=='boolean')
        ||c.kind==='engagement-ended'&&!positive(c.quietSeconds)
        ||c.kind==='separated'&&!positive(c.minDistance)
        ||['native-contact','native-engagement-ended'].includes(c.kind)&&!ids.has(c.afterStage)
        ||c.kind==='native-engagement-ended'&&(!known.has(c.actorId)||!positive(c.quietSeconds))
        ||c.kind==='arrived'&&(!finitePoint(c.point)||!positive(c.radius))
        ||c.kind==='crate-owned'&&(typeof c.crateId!=='string'||!c.crateId||c.side!=='US'))fail('stage condition bounds');
    }
    let command=row.command;
    if(!plain(command,['type','unitId','targetId','path','points','endFacing','enabled']))fail('stage command data required');
    if(command.path!==undefined){
      if(!plain(command,['type','unitId','targetId','path','endFacing'])||!['move','charge'].includes(command.type)
        ||!plain(command.path,['kind','standOff','point','points'])
        ||!(command.path.kind==='actor-to-target'&&plain(command.path,['kind','standOff'])&&Number.isFinite(command.path.standOff)
          &&command.path.standOff>=0&&command.path.standOff<=10000&&known.has(command.targetId)
          ||command.path.kind==='actor-to-point'&&plain(command.path,['kind','point'])&&finitePoint(command.path.point)
          &&command.type==='move'&&command.targetId===undefined
          ||command.path.kind==='actor-through-points'&&plain(command.path,['kind','points'])&&dense(command.path.points)&&command.path.points.length>=1&&command.path.points.length<=16&&command.path.points.every(finitePoint)
          &&command.type==='move'&&command.targetId===undefined))fail('stage path resolver');
      const {path,targetId,...base}=command;validateBadgeCommand({...base,...(command.type==='charge'?{targetId}:{}),points:[[0,0],[1,1]]});
    }else validateBadgeCommand(command);
    if(!known.has(command.unitId)||command.targetId!==undefined&&!known.has(command.targetId))fail('stage command identity');
    ids.add(row.id);return {...structuredClone(row),state:'pending',evaluations:0,lastFacts:[],unmet:[],trace:null,at:null};
  });
  const byId=new Map(rows.map(r=>[r.id,r]));let last=-1,lastObserved=-1,failure=null,activeRow=null,contactSequence=0;
  for(const row of rows)for(const c of row.condition)if(['native-contact','native-engagement-ended'].includes(c.kind)){
    const prior=byId.get(c.afterStage).command;
    if(prior.type!=='charge'||prior.unitId!==(c.kind==='native-contact'?row.command.unitId:c.actorId)||prior.targetId!==c.targetId)fail('native contact must bind preceding same-actor charge');
  }
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
      case 'native-contact':{const prior=byId.get(c.afterStage),pair=h&&Object.hasOwn(h.pairs,c.targetId)?h.pairs[c.targetId]:null,native=pair?.nativeEvents?.chargeFeat;
        return {...base,afterStage:c.afterStage,chargeAcceptedAt:prior.state==='accepted'?prior.at:null,nativePair:structuredClone(native||null),
          contactSequenceAfterCharge:prior.contactSequenceAfterAttempt??null,
          ok:prior.state==='accepted'&&!!native&&native.last>=prior.at&&native.lastSequence>prior.contactSequenceAfterAttempt};}
      case 'native-engagement-ended':{const actor=g.units.find(v=>v.id===c.actorId);if(!actor)return {...base,actorId:c.actorId,reason:'named actor absent'};
        const contact=fact(g,actor,{kind:'native-contact',targetId:c.targetId,afterStage:c.afterStage}),ending=fact(g,actor,{kind:'engagement-ended',targetId:c.targetId,quietSeconds:c.quietSeconds});
        return {...base,actorId:c.actorId,contact,ending,ok:contact.ok&&ending.ok};}
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
    if(row.command.path.kind==='actor-through-points'){
      if(!u)return {command:null,inputs:{actorPresent:false}};
      const a=point(u),anchors=structuredClone(row.command.path.points),{path,...base}=row.command;
      return {command:validateBadgeCommand({...base,points:[a,...anchors]}),inputs:{actor:a,points:anchors}};
    }
    if(row.command.path.kind==='actor-to-point'){
      if(!u)return {command:null,inputs:{actorPresent:false}};
      const a=point(u),b=row.command.path.point,{path,...base}=row.command;
      return {command:validateBadgeCommand({...base,points:[a,b]}),inputs:{actor:a,point:structuredClone(b)}};
    }
    if(!u||!t)return {command:null,inputs:{actorPresent:!!u,targetPresent:!!t}};
    const a=point(u),b=point(t),d=distance(u,t),offset=Math.min(d,row.command.path.standOff),scale=d?(d-offset)/d:0;
    const {path,targetId,...base}=row.command,command=validateBadgeCommand({...base,...(base.type==='charge'?{targetId}:{}),points:[a,[a[0]+(b[0]-a[0])*scale,a[1]+(b[1]-a[1])*scale]]});
    return {command,inputs:{actor:a,target:b,targetId,standOff:path.standOff,distance:d}};
  };
  return {contact(g,actor,target,at,method){
    if(failure)fail('stage policy already failed');
    if(!['volleyAt','chargeFeat'].includes(method)||!Number.isFinite(at)||Math.abs(at-g.simTime)>1e-8||at<lastObserved
      ||!g.units.includes(actor)||!g.units.includes(target)||!known.has(actor.id)||!known.has(target.id)||actor.side===target.side)refuse('malformed actual native contact',at);
    let h=history.get(actor.id);if(!h){h={id:actor.id,firstSeen:at,markers:{},pairs:Object.create(null)};history.set(actor.id,h);}
    seen.add(actor.id);seen.add(target.id);
    const p=Object.hasOwn(h.pairs,target.id)?h.pairs[target.id]:{first:at,kind:'actual native opponent pair; not private charge episode'};
    p.last=at;p.nativeCalls=(p.nativeCalls||0)+1;p.methods=[...new Set([...(p.methods||[]),method])];
    p.nativeEvents??={};const event=p.nativeEvents[method]||{first:at,calls:0};event.last=at;event.lastSequence=++contactSequence;event.calls++;p.nativeEvents[method]=event;h.pairs[target.id]=p;
  },advance(g){
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
        try{row.trace={...executeBadgeCommand(g,resolved.command),resolvedInputs:resolved.inputs};row.contactSequenceAfterAttempt=contactSequence;}
        catch(error){row.state='error';row.at=g.simTime;row.trace={command:resolved.command,resolvedInputs:resolved.inputs,accepted:null,invoked:null,error:String(error?.message??error)};throw error;}
        row.state=row.trace.accepted===true?'accepted':row.trace.accepted===null&&row.trace.reason==='already in requested state'?'already-satisfied':'refused';row.at=g.simTime;
      }
    }catch(error){if(activeRow&&activeRow.state==='pending'){activeRow.state='error';activeRow.at=g.simTime;activeRow.error=String(error?.message??error);}
      if(!failure)failure={message:String(error?.message??error),at:Number.isFinite(g.simTime)?g.simTime:null};throw error;}
  },receipt:()=>({kind:'finite native conditional attempts; observed engagement is not a private charge episode',cadence,
    stages:structuredClone(rows),history:[...history.values()].map(h=>structuredClone(h)),failure:structuredClone(failure)})};
}

/** Private native-call observer. Aggregates opportunities without changing RNG, counters or arguments. */
export function installBadgeCombatObserver(game,stages){
  const combat=game.combat,names=['volleyAt','chargeFeat','routFeat','moraleStep'];
  if(!combat||typeof stages?.contact!=='function')fail('native combat observer prerequisites');
  const saved=names.map(name=>{const descriptor=Object.getOwnPropertyDescriptor(combat,name),native=combat[name];
    if(typeof native!=='function'||descriptor&&(!Object.hasOwn(descriptor,'value')||!descriptor.configurable))fail('reversible native combat method required');
    return {name,descriptor,native,installed:null,restored:false};});
  if(!Object.isExtensible(combat)&&saved.some(o=>!o.descriptor))fail('extensible native combat owner required');
  const aggregate=new Map(),errors=[],equipmentCopies=new WeakMap();let failure=null,lastAt=-1;
  const snapshot=u=>{
    if(!game.units.includes(u)||!['US','CS'].includes(u.side)||![u.x,u.z,u.men,u.morale,u.cover,u.underFire,u.flanked].every(Number.isFinite)
      ||typeof u.follow?.active!=='boolean'||typeof u.melee!=='boolean'||typeof u.firing!=='boolean'||!u.order)fail('malformed native combat actor');
    let equipment=equipmentCopies.get(u);if(!equipment||equipment.source!==u.equipment){equipment={source:u.equipment,copy:structuredClone(u.equipment||null)};equipmentCopies.set(u,equipment);}
    return {id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,morale:u.morale,cover:u.cover,coverKind:u.coverKind||null,
      underFire:u.underFire,flanked:u.flanked,state:u.state,following:u.follow.active,melee:u.melee,firing:u.firing,
      order:u.order.type,targetId:u.target?.id||null,intendedTargetId:u.order.target?.id||null,equipment:equipment.copy};
  };
  const capture=(name,args)=>{
    const at=name==='volleyAt'?args[2]:name==='chargeFeat'?args[3]:game.simTime;
    if(!Number.isFinite(at)||Math.abs(at-game.simTime)>1e-8||at<lastAt)fail('native combat observation time drift');lastAt=at;
    const actor=snapshot(args[0]),target=['volleyAt','chargeFeat'].includes(name)?snapshot(args[1]):null;
    if(target&&target.side===actor.side)fail('native combat opponent ownership');
    const d=target?Math.hypot(actor.x-target.x,actor.z-target.z):null;
    const nearbyRouting=name==='moraleStep'?game.units.filter(u=>u!==args[0]&&u.side===actor.side&&u.state==='routing'&&Math.hypot(u.x-actor.x,u.z-actor.z)<300).map(u=>u.id):[];
    if(name==='moraleStep'&&(!Number.isFinite(args[1])||args[1]<0))fail('native morale delta required');
    if(name==='chargeFeat'&&(!Number.isFinite(args[2])||args[2]<0))fail('native melee casualty measure required');
    const opportunities=name==='volleyAt'?{far:d>200,largerLong:d>150&&target.men>actor.men,closeRange:d<=60,
      works:['fence line','farm buildings'].includes(actor.coverKind),woods:args[0].inWoods===true,canister:actor.type==='artillery'&&d<=CANISTER,
      fallback:actor.order==='fallback'}:name==='chargeFeat'?{smaller:actor.men<target.men,coveredTarget:target.cover>1}:
      name==='moraleStep'?{holdingPressure:actor.underFire>0&&actor.state!=='routing'&&!actor.following&&(actor.flanked>0||nearbyRouting.length>0)}:{};
    return {method:name,at,actor,target,distance:d,nearbyRouting,opportunities,dt:name==='moraleStep'?args[1]:null,
      nativeCasualties:name==='chargeFeat'?args[2]:null,kind:'conditions at actual native call; hidden feat latches and award attribution not inferred'};
  };
  const store=(event,failed,error)=>{
    const key=JSON.stringify([event.method,event.actor.id,event.target?.id||null]);let row=aggregate.get(key);
    if(!row){if(aggregate.size>=10000)fail('native combat aggregation bound');row={method:event.method,actorId:event.actor.id,targetId:event.target?.id||null,
      calls:0,succeeded:0,failed:0,first:event.at,last:event.at,opportunities:{},firstInputs:event,lastInputs:event};aggregate.set(key,row);}
    row.calls++;row.last=event.at;row.lastInputs=event;
    if(failed){row.failed++;if(errors.length>=20)fail('native combat error bound');errors.push({method:event.method,at:event.at,actorId:event.actor.id,error:String(error?.message??error)});return;}
    row.succeeded++;
    for(const[k,eligible]of Object.entries(event.opportunities))if(eligible){const o=row.opportunities[k]||{calls:0,seconds:0,first:event.at,last:event.at};o.calls++;o.seconds+=event.dt||0;o.last=event.at;row.opportunities[k]=o;}
  };
  for(const owner of saved){
    const wrapped=function(...args){
      if(this!==combat)return owner.native.apply(this,args);
      if(failure)fail('native combat observer already failed');
      let event;try{event=capture(owner.name,args);}catch(error){failure={message:String(error?.message??error),at:game.simTime};throw error;}
      let value;
      try{value=owner.native.apply(this,args);}catch(error){
        failure={message:String(error?.message??error),at:game.simTime,kind:'native exception'};
        try{store(event,true,error);}catch(secondary){failure={message:String(secondary?.message??secondary),at:game.simTime,primary:String(error?.message??error)};}
        throw error;
      }
      try{store(event,false,null);if(['volleyAt','chargeFeat'].includes(owner.name))stages.contact(game,args[0],args[1],event.at,owner.name);}
      catch(error){failure={message:String(error?.message??error),at:game.simTime};throw error;}return value;
    };
    Object.defineProperty(combat,owner.name,{value:wrapped,writable:true,configurable:true,enumerable:owner.descriptor?.enumerable??false});
    owner.installed=Object.getOwnPropertyDescriptor(combat,owner.name);
  }
  return {receipt:()=>({kind:'actual native call opportunities; nearby support/cover and numeric tiers require separate outcomes',rows:structuredClone([...aggregate.values()]),errors:structuredClone(errors),failure:structuredClone(failure)}),
    restore(){const cleanup=[];for(const owner of saved){if(owner.restored)continue;try{
      const current=Object.getOwnPropertyDescriptor(combat,owner.name);
      if(!current||!['value','writable','enumerable','configurable','get','set'].every(k=>current[k]===owner.installed[k]))fail('foreign native combat method owner '+owner.name);
      if(owner.descriptor)Object.defineProperty(combat,owner.name,owner.descriptor);else delete combat[owner.name];
      if(combat[owner.name]!==owner.native)fail('inherited native combat method drift '+owner.name);owner.restored=true;
    }catch(error){cleanup.push(String(error?.message??error));}}
    return {ok:cleanup.length===0,errors:cleanup};},
  };
}

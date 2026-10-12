// Pure reputation/reward generation shared by the economy and coordinated save transactions.
// Callers validate snapshots first. Pending rewards are derived; no additional saved schema.
import { ECONOMY } from './tuning.js';
import { ARMS } from '../reward/data.js';
import { makeRng, rollCondition } from '../reward/model.js';

export function levelFor(reputation) {
  let level=1;
  ECONOMY.levels.forEach((at,i)=>{if(reputation>=at)level=i+1;});
  return level;
}
export function levelCard({seed,campaignId,slot,level}) {
  const tier=ECONOMY.levelCardTier[level];
  if(!tier)throw new Error('Economy: this level deals no reward card.');
  const rng=makeRng(`${seed}:level:${level}`),pool=ARMS.filter(a=>a.tier===tier&&a.capturedOnly!==true);
  if(!pool.length)throw new Error(`Economy: no ${tier} arm can be dealt.`);
  const def=rng.pick(pool);
  return {uid:`${campaignId}.${slot}.level.${level}`,itemId:def.id,tier:def.tier,conditionId:rollCondition(rng),
    source:'reward',from:`Reputation level ${level} reward card`};
}
export const pendingLevelRewards=s=>s?.version===2?Math.max(s.level,levelFor(s.reputation))-s.level:0;
const deliver=(s,level)=>{
  const card=levelCard({seed:s.seed,campaignId:s.campaign.id,slot:s.slot,level});
  return {...s,level,depot:[...s.depot,card],ledger:[...s.ledger,{kind:'level',level,uid:card.uid}]};
};
export function pendingLevelRewardReason(s,maxBytes){
  if(!pendingLevelRewards(s))return null;
  if(s.depot.length>=2000)return 'depot';
  return new TextEncoder().encode(JSON.stringify(deliver(s,s.level+1))).length>maxBytes?'size':'available';
}
/** Deliver the ascending prefix fitting both storage limits; preserve money and all existing records. */
export function reconcileLevelRewards(s,maxBytes) {
  if(!pendingLevelRewards(s))return s;
  let next=s;
  const target=Math.max(s.level,levelFor(s.reputation)),encoder=new TextEncoder();
  for(let level=s.level+1;level<=target&&next.depot.length<2000;level++){
    const draft=deliver(next,level);
    if(encoder.encode(JSON.stringify(draft)).length>maxBytes)break;
    next=draft;
  }
  return next;
}

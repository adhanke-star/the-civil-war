// Diagnostic-only progression comparison. No product imports this module or adopts its candidate thresholds.
import {validateSnapshot} from '../src/franchise/save.js';
import {levelCard,shopTierFor} from '../src/franchise/economy.js';
export const CANDIDATE_LEVELS=Object.freeze([0,30,75,135,210,300,405,525,660,800]);
export function candidateLevel(reputation,thresholds=CANDIDATE_LEVELS) {
  if(!Number.isSafeInteger(reputation)||reputation<0||!Array.isArray(thresholds)||thresholds.length!==10||thresholds[0]!==0
    ||thresholds.some((n,i)=>!Number.isSafeInteger(n)||n<0||(i&&n<=thresholds[i-1])))throw new Error('progression diagnostic: invalid reputation/thresholds');
  return thresholds.reduce((level,n,i)=>reputation>=n?i+1:level,1);
}
/** Hypothetical migration using real reward cards/validator; never writes or changes live thresholds. */
export function reconcileCandidate(save,thresholds=CANDIDATE_LEVELS) {
  const s=validateSnapshot(save);if(s.version!==2)throw new Error('progression diagnostic: campaign save required');
  const level=Math.max(s.level,candidateLevel(s.reputation,thresholds)),cards=[];
  for(let l=s.level+1;l<=level;l++)cards.push(levelCard({seed:s.seed,campaignId:s.campaign.id,slot:s.slot,level:l}));
  if(s.depot.length+cards.length>2000)throw new Error('progression diagnostic: missing reward cards exceed save depot limit; no partial migration');
  return validateSnapshot({...s,level,depot:[...s.depot,...cards],ledger:[...s.ledger,...cards.map((card,i)=>({kind:'level',level:s.level+i+1,uid:card.uid}))]});
}
export function progressionReceipt(before,marched,after) {
  const b=validateSnapshot(before),m=validateSnapshot(marched),a=validateSnapshot(after);
  const summary=s=>({reputation:s.reputation,rp:s.rp,level:s.level,shopTier:shopTierFor(s.level),stores:s.stores,
    candidateLevel:candidateLevel(s.reputation),candidateShopTier:shopTierFor(candidateLevel(s.reputation))});
  const ledger=a.ledger.slice(b.ledger.length),last=a.campaign.history.at(-1),record=ledger.find(r=>r.kind==='phase'&&r.awardId===last.awardId);
  const owned=new Map([...a.depot,...a.army.map(u=>u.weapon)].map(c=>[c.uid,c]));
  return {before:summary(b),marched:summary(m),after:summary(a),result:last,phase:record||null,newLedger:ledger,
    levelCards:ledger.filter(r=>r.kind==='level').map(r=>({receipt:r,card:owned.get(r.uid)||null})),
    earnedSeparately:{phase:ledger.filter(r=>r.kind==='phase').reduce((n,r)=>n+r.points,0),
      positiveDecisions:ledger.filter(r=>r.kind==='decision'&&r.points>0).reduce((n,r)=>n+r.points,0),
      decisionCosts:ledger.filter(r=>r.kind==='decision'&&r.points<0).reduce((n,r)=>n-r.points,0),
      turnIns:ledger.filter(r=>r.kind==='turnIn').reduce((n,r)=>n+r.points,0)},
    candidate:'threshold arithmetic only; current level cards are actual, candidate cards are not awarded',
    purchases:ledger.filter(r=>['buy','store','upgrade','training','slot','reroll'].includes(r.kind))};
}

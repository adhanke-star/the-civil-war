// Browser checks for badges and the X-Factor (P5a), registered in tools/test.mjs shard 2 and `node tools/test.mjs --badges`.
// `badgesControls({ browser, url, check, shot, result, watchErrors })`. Two parts:
// 1. The real flow (reduced motion), on a fictional one-phase campaign served by Playwright route interception of
//    assets/campaign.json and assets/packs/test-badges.json (Henry Hill ground, 21 July 1861; nothing ships for it). Camp ->
//    Next -> Briefing -> forced Union win, with the game's featReport giving the franchise brigade a Gold-level long-range
//    feat through the documented hook window.__game.game (as tools/test-economy-ui.mjs forces the result). The after-action
//    stamps the badge with its feat and plays the X-Factor moment once (static under reduced motion, non-blocking); the
//    saved slot carries the badge and the X-Factor; back in camp nothing replays, the card shows the emblem, its detail
//    dialog shows the real example (unit, event, text, provenance, https source links) apart from the game rule, Escape
//    returns focus; a brigade with too many badges chooses by keyboard; axe, 320 px, screenshots.
// 2. Full motion: the reward sequence mounted with a badges summary built here (src/franchise/campaign.js) stamps every
//    row and plays the full X-Factor moment once, without taking focus or blocking a click.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import * as badges from '../src/franchise/badges.js';
import { validateSnapshot,parseSnapshot,exportSnapshot } from '../src/franchise/save.js';
import {installSceneStartGate} from './bake/inactive-figures.mjs';

/** Actual native prerequisite only; this short context does not substantiate badge attainability. */
export async function nativeBadgeObserverControls({browser,url,check,result,watchErrors}){
  const ctx=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'}),errors=[];
  let page=null,primary=null,receipt=null,outerCleanup=null;
  try{
    page=await ctx.newPage();watchErrors(page,url,errors);
    await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    const prefix=await page.evaluate(async()=>{
      const B=await import('./tools/observe-badges.mjs'),S=await import('./src/franchise/save.js'),campaign=await(await fetch('./assets/campaign.json')).json();
      const p=B.badgePrefix(campaign,'slaughter-fire');await S.createProgressStore(undefined,{slot:1}).complete(p.save);return {...B.badgePrefixReceipt(p),phase:p.phase};
    });
    await ctx.addInitScript(source=>{
      window.__badgeNativeRAF={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};
      window.__badgeStartGate=(0,eval)('('+source+')')();
    },installSceneStartGate.toString());
    await page.goto(url+'?campaign=1&quality=low&nosw');
    await page.waitForFunction(()=>window.__ready&&window.__game?.game&&document.getElementById('briefing')?.open,null,{timeout:180000,polling:250});
    await page.locator('#briefing-begin').click();
    await page.waitForFunction(()=>window.__badgeStartGate?.first?.simTime===0&&window.__game.game.paused);
    const data=await page.evaluate(async()=>{
      const B=await import('./tools/observe-badges.mjs'),G=await import('./src/game.js'),g=window.__game.game;
      if(g.simTime!==0||!g.paused)throw Error('badge native prerequisite lost time-zero gate');
      const tactic=B.badgeTactic(g,'slaughter-fire'),crossings=B.createBadgeCrossings(),policy=B.createBadgeStages([
        {id:'hold-roberts',notBefore:0,expires:1,after:[],condition:[{kind:'actor-orderable'}],command:{type:'hold',unitId:'us-roberts-brigade'}}
      ],1,tactic.roster),beforeTick=Object.getOwnPropertyDescriptor(g,'tick');
      const methods=['volleyAt','chargeFeat','routFeat','moraleStep'],nativeMethods=methods.map(n=>({name:n,native:g.combat[n],descriptor:Object.getOwnPropertyDescriptor(g.combat,n)}));
      let combat=null,tick=null,primary=null;const cleanup=[],samples=[];
      try{
        combat=B.installBadgeCombatObserver(g,policy);
        tick=B.installBadgeTickObserver(g,{sample(at,feats){
          const ids=g.units.map(u=>u.id).sort(),keys=Object.keys(feats).sort();
          if(JSON.stringify(ids)!==JSON.stringify(keys))throw Error('badge native prerequisite partial feat report');
          samples.push({at,ids});crossings.sample(at,feats);policy.advance(g);
        }});
        g.togglePause();try{for(let i=0;i<40;i++)g.fastForward(.05);}finally{if(!g.paused)g.togglePause();}
      }catch(error){primary=String(error?.message??error);}
      finally{
        for(const [name,restore]of [['tick',()=>tick?.restore()],['combat',()=>combat?.restore()],['startup',()=>window.__badgeStartGate.restore()]]){
          try{const r=restore();cleanup.push({name,ok:r?.ok!==false,receipt:r??null});}catch(error){cleanup.push({name,ok:false,error:String(error?.message??error)});}
        }
      }
      const same=(a,b)=>['value','writable','enumerable','configurable','get','set'].every(k=>a?.[k]===b?.[k]);
      return {kind:'actual short native observer prerequisite; natural result/storage/attainability UNRUN',source:tactic.recipe,simTime:g.simTime,over:g.over,
        difficulty:G.difficultyOf(g),samples,crossings:crossings.receipt(),stages:policy.receipt(),combat:combat?.receipt()??null,primary,cleanup,
        restoration:{tick:same(beforeTick,Object.getOwnPropertyDescriptor(g,'tick')),combat:nativeMethods.every(o=>g.combat[o.name]===o.native&&same(o.descriptor,Object.getOwnPropertyDescriptor(g.combat,o.name))),
          RAF:window.requestAnimationFrame===window.__badgeNativeRAF.native&&same(window.__badgeNativeRAF.descriptor,Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'))}};
    });
    receipt={prefix,...data};result.badgeNativePrerequisite=receipt;
    check('badge-native-prefix',prefix.difficulty==='veteran'&&data.difficulty==='veteran'&&prefix.phase.phaseId==='slaughter-pen','constructed prefix retained separately; actual Game Veteran confirmed');
    check('badge-native-time',Math.abs(data.simTime-2)<1e-8&&!data.over,'actual native ticks advanced two seconds; no result forced');
    check('badge-native-order',data.stages.stages[0]?.state==='accepted','real player Hold control accepted on actual owned brigade');
    check('badge-native-full-feats',data.crossings.samples===41&&data.samples.length===41&&data.samples.every((s,i)=>Math.abs(s.at-i*.05)<1e-8&&s.ids.length===19),'initial0 plus40 native .05 ticks, exact whole live roster every report');
    check('badge-native-combat',!data.primary&&!data.combat?.failure&&data.combat.rows.some(r=>r.method==='moraleStep'&&r.succeeded>0),'actual native morale calls forwarded and copied');
    check('badge-native-restoration',data.cleanup.every(r=>r.ok)&&Object.values(data.restoration).every(Boolean),'exact tick/combat/RAF owners restored independently');
  }catch(error){primary=String(error?.message??error);check('badge-native-prerequisite',false,primary);}
  finally{
    // Covers navigation/readiness/import/setup failures as well as the normal inner restore path.
    if(page)try{outerCleanup=await page.evaluate(()=>{
      if(!window.__badgeStartGate)return {ok:true,installed:false};window.__badgeStartGate.restore();
      const prior=window.__badgeNativeRAF,current=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');
      const ok=window.requestAnimationFrame===prior.native&&['value','writable','enumerable','configurable','get','set'].every(k=>current?.[k]===prior.descriptor?.[k]);
      return {ok,installed:true};
    });}catch(error){outerCleanup={ok:false,error:String(error?.message??error)};}
    receipt??={kind:'failed actual native prerequisite; no natural-play proof',primary};receipt.outerCleanup=outerCleanup;result.badgeNativePrerequisite=receipt;
    try{await ctx.close();receipt.contextClosed=true;}catch(error){receipt.contextClosed=false;check('badge-native-context-close',false,String(error?.message??error));}
  }
  check('badge-native-errors',!primary&&outerCleanup?.ok===true&&receipt.contextClosed&&errors.length===0,JSON.stringify({errors,outerCleanup}));
}

function restoreNativeBadgeContext(){
  const o=window.__badgeObservation,g=window.__game?.game,entries=[];
  const same=(a,b)=>['value','writable','enumerable','configurable','get','set'].every(k=>a?.[k]===b?.[k]);
  for(const[name,owner]of [['tick',o?.tick],['combat',o?.combat],['startup',window.__badgeStartGate]]){
    try{const receipt=owner?.restore();entries.push({name,installed:!!owner,ok:receipt?.ok!==false,receipt:receipt??null});}
    catch(error){entries.push({name,installed:!!owner,ok:false,error:String(error?.message??error)});}
  }
  const p=window.__badgeNativeRAF;
  const exact={tick:!o||!!g&&g.tick===o.beforeTick.native&&same(o.beforeTick.descriptor,Object.getOwnPropertyDescriptor(g,'tick')),
    combat:!o||!!g&&o.methods.every(m=>g.combat[m.name]===m.native&&same(m.descriptor,Object.getOwnPropertyDescriptor(g.combat,m.name))),
    RAF:!p||window.requestAnimationFrame===p.native&&same(p.descriptor,Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'))};
  const partial=o?{samples:o.samples,initialTime:o.initialTime,lastTime:o.lastTime,fullReports:o.fullReports,
    crossings:o.crossings.receipt(),stages:o.policy.receipt(),combat:o.combat?.receipt()??null}:null;
  return {entries,exact,partial,ok:entries.every(e=>e.ok)&&Object.values(exact).every(Boolean)};
}

/** Six first-tactic observations, two fresh native contexts per explicitly selected Actions shard. */
export async function nativeBadgeObservations({browser,url,check,result,watchErrors,shard,persist,missionaryOnly=false}){
  if(missionaryOnly&&shard!==1)throw Error('badge observations: missionary repair is exactly shard1');
  const cases=missionaryOnly?['missionary-assault']:[['slaughter-fire','missionary-assault'],['slaughter-defence','mcfadden-assault'],['slaughter-recovery','buell-capture']][shard-1];
  if(!cases)throw Error('badge observations: shard must be 1, 2 or 3');
  const output={kind:'actual first native tactics; constructed earlier Draw prefixes; numeric tiers are not separate saved upgrades',
    sourceSha:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,shard,cases:[],complete:false};result.badgeObservations=output;
  for(const id of cases){
    const row={id,complete:false,errors:[],primary:null,cleanup:[],contextClosed:false};output.cases.push(row);
    await persist(); // retain a pending second case without losing the already completed first case
    let ctx=null,page=null,imported=null;
    try{
      ctx=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'});page=await ctx.newPage();watchErrors(page,url,row.errors);
      await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
      row.prefix=await page.evaluate(async id=>{
        const B=await import('./tools/observe-badges.mjs'),S=await import('./src/franchise/save.js'),campaign=await(await fetch('./assets/campaign.json')).json();
        const p=B.badgePrefix(campaign,id),store=S.createProgressStore(undefined,{slot:1});await store.complete(p.save);
        return {...B.badgePrefixReceipt(p),phase:p.phase,raw:await store.readRawBaseline()};
      },id);
      await ctx.addInitScript(source=>{window.__badgeNativeRAF={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};window.__badgeStartGate=(0,eval)('('+source+')')();},installSceneStartGate.toString());
      await page.goto(url+'?campaign=1&quality=low&nosw');
      await page.waitForFunction(()=>window.__ready&&window.__game?.game&&document.getElementById('briefing')?.open,null,{timeout:180000,polling:250});
      await page.locator('#briefing-begin').click();await page.waitForFunction(()=>window.__badgeStartGate?.first?.simTime===0&&window.__game.game.paused);
      row.initial=await page.evaluate(async id=>{
        const B=await import('./tools/observe-badges.mjs'),G=await import('./src/game.js'),g=window.__game.game,tactic=B.badgeTactic(g,id),crossings=B.createBadgeCrossings(),policy=B.createBadgeStages(tactic.plan,tactic.cadence,tactic.roster);
        if(G.difficultyOf(g)!=='veteran')throw Error('badge observations: actual difficulty drift');
        const beforeTick={native:g.tick,descriptor:Object.getOwnPropertyDescriptor(g,'tick')},methods=['volleyAt','chargeFeat','routFeat','moraleStep'].map(name=>({name,native:g.combat[name],descriptor:Object.getOwnPropertyDescriptor(g.combat,name)}));
        const owner={tactic,crossings,policy,beforeTick,methods,combat:null,tick:null,samples:0,lastTime:null,initialTime:null,largestDelta:0,fullReports:true};window.__badgeObservation=owner;
        owner.combat=B.installBadgeCombatObserver(g,policy);
        owner.tick=B.installBadgeTickObserver(g,{sample(at,feats){
          const ids=g.units.map(u=>u.id).sort(),keys=Object.keys(feats).sort();
          if(JSON.stringify(ids)!==JSON.stringify(keys)){owner.fullReports=false;throw Error('badge observations: incomplete native feat report');}
          if(owner.samples===0)owner.initialTime=at;else owner.largestDelta=Math.max(owner.largestDelta,at-owner.lastTime);
          owner.samples++;owner.lastTime=at;crossings.sample(at,feats);policy.advance(g);
        }});
        return {tactic,seed:g.scenario.seed,horizon:(g.clockEnd-g.clockStart)/g.clockRatio,difficulty:G.difficultyOf(g),
          units:g.units.map(u=>({id:u.id,side:u.side,men:u.men,menStart:u.menMax,equipment:u.equipment,position:[u.x,u.z]}))};
      },id);
      const seeds={'slaughter-fire':18621232,'slaughter-defence':18621232,'slaughter-recovery':18621232,'mcfadden-assault':18630102,'missionary-assault':18631125,'buell-capture':18620409};
      if(row.initial.seed!==seeds[id]||!Number.isFinite(row.initial.horizon)||row.initial.horizon<=0)throw Error('badge observations: authored seed/horizon drift');
      const began=Date.now();row.progress=[];
      for(let chunk=0;chunk<Math.ceil(row.initial.horizon/20)+120;chunk++){
        if(Date.now()-began>15*60*1000)throw Error('badge observations: natural completion wall budget exhausted; no result forced');
        const state=await page.evaluate(async()=>{
          const B=await import('./tools/observe-badges.mjs');
          const g=window.__game.game;if(!g.over){if(g.paused)g.togglePause();try{
            // Phases without reinforcements use the legacy fastForward loop, which does not stop on over.
            // Bound every genuine native step by the natural ending before requesting the next step.
            B.advanceBadgeChunk(g);
          }finally{if(!g.paused)g.togglePause();}}
          const o=window.__badgeObservation;
          return {at:g.simTime,over:g.over,winner:g.result?.winner??null,alive:g.units.filter(u=>u.alive).length,
            observed:{samples:o.samples,initialTime:o.initialTime,lastTime:o.lastTime,largestDelta:o.largestDelta,fullReports:o.fullReports,
              crossings:o.crossings.receipt(),stages:o.policy.receipt(),combat:o.combat.receipt()}};
        });row.partialNative=state.observed;delete state.observed;row.progress.push(state);await persist();if(state.over)break;
      }
      await page.waitForFunction(()=>document.getElementById('result').open&&!document.getElementById('result-action').hidden,null,{timeout:30000});
      row.native=await page.evaluate(async()=>{
        const S=await import('./src/franchise/save.js'),D=await import('./src/franchise/badges.js'),g=window.__game.game,o=window.__badgeObservation;
        const native={simTime:g.simTime,over:g.over,result:g.result,fullReports:o.fullReports,samples:o.samples,initialTime:o.initialTime,lastTime:o.lastTime,largestDelta:o.largestDelta,
          crossings:o.crossings.receipt(),stages:o.policy.receipt(),combat:o.combat.receipt(),feats:g.featReport(),captures:g.captureReport?.()??null,
          units:[...g.scenario.units,...(g.scenario.reinforcements||[])].map(d=>{const u=g.units.find(u=>u.id===d.id),men=u?Math.floor(u.men):d.men;
            return {id:d.id,side:d.side,menStart:d.men,men,...(d.type==='artillery'?{gunsStart:d.guns,guns:!u?d.guns:men?u.gunSlots.filter(s=>s.alive).length:0}:{})};})};
        if(!g.over)return native;
        const phase=window.__game.practice.phase;if(!phase)throw Error('badge observations: native phase bridge unavailable: '+window.__game.practice.phaseFailure);
        const {outcome,record,next:after}=phase;
        window.__badgePhaseRecord=record;
        return {...native,outcome,record,afterPhase:S.exportSnapshot(after),award:D.badgeAward(after.awardId),
          nativeArmy:after.army.map(b=>({id:b.id,unitId:b.unitId,men:b.men,badges:b.badges||[],offer:b.offer||[],xfactor:b.xfactor||null})),
          economy:{rp:after.rp,reputation:after.reputation,level:after.level,stores:after.stores,ledger:after.ledger,depot:after.depot}};
      });
      if(!row.native.over||!row.native.record||!row.native.fullReports||row.native.initialTime!==0||row.native.largestDelta>.05+1e-8||row.native.lastTime!==row.native.simTime
        ||row.native.stages.failure||row.native.combat.failure)throw Error('badge observations: actual native completion/observation failure');
      assert.deepStrictEqual(row.native.record.feats,row.native.feats,'native phase must retain every final observed feat');
      assert.strictEqual(row.native.record.winner,row.native.result.winner,'native phase winner must match actual game result');
      assert.deepStrictEqual(row.native.record.units,row.native.units,'native phase must retain actual final strengths and guns');
      // The independent oracle runs in Node; it must never replace the browser's native award cache.
      const definition=JSON.parse(fs.readFileSync(new URL('../assets/campaign.json',import.meta.url))),nativeNext=parseSnapshot(row.native.afterPhase);
      const expected=campaign.recordPhase(parseSnapshot(row.prefix.raw),definition,{...row.native.record,at:nativeNext.updated});
      row.expected={afterPhase:exportSnapshot(expected),award:badges.badgeAward(expected.awardId)};
      if(row.expected.afterPhase!==row.native.afterPhase||JSON.stringify(row.expected.award)!==JSON.stringify(row.native.award))throw Error('badge observations: native phase/award differs from independent result');
      // Restore and verify the actual native owners before any navigation can discard that document.
      row.nativeCleanup=await page.evaluate(restoreNativeBadgeContext);
      if(!row.nativeCleanup.ok)throw Error('badge observations: original native owner restoration failed');
      await page.waitForFunction(()=>document.getElementById('result').open&&!document.getElementById('result-action').hidden,null,{timeout:30000});
      await page.locator('#result-action').click();
      const firstX=(row.native.award?.brigades||[]).find(b=>b.xfactor),xStyle=await page.evaluate(async()=>{const S=await import('./src/settings.js');return S.get('look.xFactorStyle')??'full';});
      const expectedX=firstX&&xStyle!=='off'?[firstX.label+'|'+firstX.xfactor]:[];
      if(expectedX.length)await page.waitForFunction(()=>window.__xfactors?.length===1,null,{timeout:30000});
      row.afterAction=await page.evaluate(()=>({rows:[...document.querySelectorAll('.rw-badge-row')].map(r=>({brigade:r.dataset.brigade,badge:r.dataset.badge,tier:r.dataset.tier,text:r.textContent})),xfactors:window.__xfactors||[]}));
      row.afterAction.style=xStyle;
      const expectedRows=(row.expected.award?.brigades||[]).flatMap(br=>br.earned.map(e=>({brigade:br.id,badge:e.id,tier:e.tier})));
      if(JSON.stringify(row.afterAction.rows.map(({brigade,badge,tier})=>({brigade,badge,tier})))!==JSON.stringify(expectedRows))throw Error('badge observations: actual after-action badge rows differ from native award');
      if(JSON.stringify(row.afterAction.xfactors)!==JSON.stringify(expectedX))throw Error('badge observations: actual single first-Gold moment/award drift');
      await page.getByRole('button',{name:/^Open the loot/}).click();await page.keyboard.press('s');
      await page.getByRole('button',{name:/^Issue to brigades/}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.waitForFunction(()=>!window.__game.practice.reward.state.counting);
      row.reward=await page.evaluate(()=>{const s=window.__game.practice.reward.state;return {awardId:s.awardId,army:s.army,depot:s.tray,issued:s.log,seed:s.seed,grade:s.grade};});
      const {applyRewardIssues}=await import('../src/ui/briefing.js');row.expected.saved=exportSnapshot(applyRewardIssues(expected,row.native.record.loot,row.reward).save);
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('result').open&&document.getElementById('result-title').textContent==='Campaign saved',null,{timeout:30000});
      row.saved=await page.evaluate(async()=>{
        const C=await import('./src/franchise/campaign.js'),S=await import('./src/franchise/save.js'),campaign=await(await fetch('./assets/campaign.json')).json(),store=S.createProgressStore(undefined,{slot:1}),raw=await store.readRawBaseline(),save=S.parseSnapshot(raw);
        const duplicate=C.recordPhase(save,campaign,window.__badgePhaseRecord);await store.complete(duplicate,{previous:save});const afterRaw=await store.readRawBaseline();
        return {raw,exported:S.exportSnapshot(save),duplicateRaw:afterRaw,duplicateStable:raw===afterRaw,index:save.campaign.index,
          army:save.army,enemy:save.enemy,ledger:save.ledger,depot:save.depot,level:save.level,reputation:save.reputation,rp:save.rp,xfactors:window.__xfactors||[]};
      });
      if(row.saved.raw!==row.expected.saved||!row.saved.duplicateStable||row.saved.index!==row.prefix.index+1||JSON.stringify(row.saved.xfactors)!==JSON.stringify(expectedX))throw Error('badge observations: real UI whole save/duplicate award/moment drift');
      await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing);
      row.reload=await page.evaluate(async()=>{const S=await import('./src/franchise/save.js');return {raw:await S.createProgressStore(undefined,{slot:1}).readRawBaseline(),xfactors:window.__xfactors||[]};});
      if(row.reload.raw!==row.saved.raw||row.reload.xfactors.length)throw Error('badge observations: reload byte/moment drift');
      imported=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'});const ip=await imported.newPage();watchErrors(ip,url,row.errors);
      await ip.goto(url+'?nosw');await ip.waitForFunction(()=>window.__entry&&!window.__entry.importing);
      row.imported=await ip.evaluate(async raw=>{const S=await import('./src/franchise/save.js'),store=S.createProgressStore(undefined,{slot:1}),previousRaw=await store.readRawBaseline();if(previousRaw!==null)throw Error('badge observations: fresh import context not empty');await store.import(raw,{previousRaw});return {raw:await store.readRawBaseline()};},row.saved.exported);
      if(row.imported.raw!==row.saved.raw)throw Error('badge observations: fresh import byte drift');
      row.complete=true;
    }catch(error){row.primary=String(error?.message??error);}
    finally{
      if(page)try{const cleanup=await page.evaluate(restoreNativeBadgeContext);row.outerCleanup=cleanup;row.cleanup=cleanup.entries;row.partialNative=cleanup.partial;
        if(!cleanup.ok)row.cleanup.push({name:'exact-descriptors',ok:false,exact:cleanup.exact});
      }catch(error){row.cleanup.push({name:'page',ok:false,error:String(error?.message??error)});}
      for(const[name,c]of [['import',imported],['native',ctx]])if(c)try{await c.close();if(name==='native')row.contextClosed=true;else row.importContextClosed=true;}catch(error){row.cleanup.push({name:name+'-context',ok:false,error:String(error?.message??error)});}
      row.complete=row.complete&&!row.primary&&!row.errors.length&&row.nativeCleanup?.ok===true&&row.cleanup.every(r=>r.ok)&&row.contextClosed&&row.importContextClosed===true;
      check('badge-observation-'+id,row.complete,JSON.stringify({primary:row.primary,naturalOver:row.native?.over,at:row.native?.simTime,errors:row.errors,cleanup:row.cleanup,contextClosed:row.contextClosed}));
      await persist();
    }
  }
  output.complete=output.cases.length===2&&output.cases.every(r=>r.complete);await persist();
}

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-badges';
const PACK = { version: 1, id: PACK_ID, title: 'Fictional badges test battle (test only)', phases: [
  { id: 'p1', scenario: { ...structuredClone(HH), id: 'test-badges-p1', title: 'Fictional badges phase (test only)', attacker: 'US',
    subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the badge checks; nothing here is history.' } } }] };
const CAMPAIGN = { version: 1, id: 'test-badge', title: 'Fictional badges campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'green' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }] };
const GOLD = 4 * badges.BADGE_RULES.bronze.sharpshooters;

/** A recorded phase whose summary stamps three badges, one of them a first Gold (the X-Factor), for the full-motion mount. */
function stampSummary() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 7 }), p = campaign.campaignPhase(s0, CAMPAIGN);
  const zero = Object.fromEntries(badges.FEAT_STATS.map((k) => [k, 0]));
  const feats = { sherman: { side: 'US', xp: 1, menStart: 3000, ...zero, farKills: GOLD, marched: 900 },
    jackson: { side: 'CS', xp: 2, menStart: 2600, ...zero, repulses: 2 } };
  const after = campaign.recordPhase(s0, CAMPAIGN, { packId: PACK_ID, phaseId: 'p1', awardId: p.awardId, winner: 'US', grade: 'Draw', held: false,
    units: [{ id: 'sherman', side: 'US', menStart: 3000, men: 2950 }, { id: 'jackson', side: 'CS', menStart: 2600, men: 2400 }], loot: [], feats });
  return { summary: badges.badgeAward(after.awardId), army: after.army };
}

/** Capture the real transient DOM in its insertion microtask, before native removal can race a later protocol call. */
function observeMoment(){
  window.__badgeMomentObserver?.disconnect();window.__badgeMomentObservation=null;
  let seen=null;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const added of record.addedNodes){
      const m=added.nodeType===1&&(added.matches('.rw-xfactor-moment')?added:added.querySelector('.rw-xfactor-moment'));
      if(!m||!m.isConnected||seen)continue;
      seen=m;const button=document.querySelector('.rw-aar .rw-primary');button.scrollIntoView({block:'center'});
      const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
      window.__badgeMomentObservation={connected:m.isConnected,badge:m.dataset.badge,style:m.dataset.style,events:getComputedStyle(m).pointerEvents,
        hidden:m.getAttribute('aria-hidden'),log:[...(window.__xfactors??[])],focus:document.activeElement?.id,clickable:!!hit?.closest('.rw-primary'),insertedAt:performance.now(),
        rows:[...document.querySelectorAll('.rw-badge-row')].map(r=>[r.dataset.badge,r.dataset.tier,r.querySelector('.rw-badge-text')?.textContent]),
        stamped:document.querySelectorAll('.rw-badge-row.is-stamped').length,enemy:document.querySelector('.rw-badge-enemy')?.textContent??'',tag:document.querySelector('.rw-badges .rw-rule-tag')?.textContent,
        removedAt:null,removalLog:null};
    }
    if(seen&&!seen.isConnected&&window.__badgeMomentObservation.removedAt===null){
      window.__badgeMomentObservation.removedAt=performance.now();window.__badgeMomentObservation.removalLog=[...(window.__xfactors??[])];
    }
  });observer.observe(document.body,{childList:true,subtree:true});window.__badgeMomentObserver=observer;
}
const disconnectMoment=()=>{window.__badgeMomentObserver?.disconnect();};

export async function badgesControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. the real campaign flow and camp (reduced motion) ----
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__badges', readFlag: '__badgesReadBlocked', quotaFlag: '__badgesQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const camp = async () => { await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 }); };
  const stored = () => page.evaluate(async () => JSON.parse(await (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline()));
  const raw = () => page.evaluate(async () => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline());
  try {
    const start = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-11T12:00:00Z' });
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(start));
    await camp();
    check('badges-camp-empty', await page.evaluate(() => document.querySelectorAll('#camp-army .cw-badge').length === 0 && !(window.__xfactors ?? []).length),
      'a fresh campaign camp shows no badges and plays no moment');
    await page.locator('#camp-next').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    await page.keyboard.press('Enter');
    await page.evaluate((gold) => {
      const g = window.__game.game; g.paused = true;
      const real = g.featReport.bind(g);
      g.featReport = () => { const r = real(); r.sherman.farKills = gold; r.sherman.marched = 900; r.sherman.woodsKills = 60; return r; }; // the documented test hook
      for (const u of g.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing';
      g.checkObjective(0, true);
    }, GOLD);
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    await page.evaluate(observeMoment);
    await page.locator('#result-action').click();
    await page.waitForFunction(() => window.__badgeMomentObservation, null, { timeout: 15000 });
    const aar = await page.evaluate(() => window.__badgeMomentObservation);
    const sharp = aar.rows.find((r) => r[0] === 'sharpshooters');
    check('badges-aar-stamped', sharp && sharp[1] === 'gold' && sharp[2].includes(`${GOLD} casualties inflicted by fire from beyond 200 m`) && sharp[2].includes('game rule')
      && aar.rows.some((r) => r[0] === 'hardMarchers') && aar.tag === 'Game rule',
    `after-action stamps ${aar.rows.map((r) => `${r[0]} ${r[1]}`).join(', ')} with the feat ("${sharp?.[2]?.slice(0, 80)}…")`);
    check('badges-aar-xfactor', aar.connected && aar.badge==='sharpshooters' && JSON.stringify(aar.log) === '["Test brigade (fictional)|sharpshooters"]' && aar.style === 'subtle' && aar.events === 'none'
      && aar.hidden === 'true' && aar.clickable && aar.focus === 'rw-aar-grade',
    `X-Factor moment ${JSON.stringify(aar.log)}, ${aar.style} under reduced motion, pointer-events ${aar.events}, focus ${aar.focus}`);
    await page.waitForFunction(()=>window.__badgeMomentObservation&&window.__badgeMomentObservation.removedAt!==null,null,{timeout:15000});
    result.badgesReducedMoment=await page.evaluate(()=>window.__badgeMomentObservation);
    check('badges-reduced-moment-once',result.badgesReducedMoment.removedAt>=result.badgesReducedMoment.insertedAt&&JSON.stringify(result.badgesReducedMoment.removalLog)==='["Test brigade (fictional)|sharpshooters"]','connected reduced-motion banner leaves through native removal exactly once');
    await shot(page, 'badges-aar-campaign');
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    const issueBadges = await page.locator('.rw-brig .cw-badge').count();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('result').open && document.getElementById('result-title').textContent === 'Campaign saved', null, { timeout: 30000 });
    const after = await stored(), sherman = after.army.find((b) => b.id === 'sherman');
    check('badges-saved', sherman.xfactor === 'sharpshooters' && sherman.badges.some((b) => b.id === 'sharpshooters' && b.tier === 'gold' && b.feat === GOLD)
      && issueBadges > 0 && JSON.stringify(await page.evaluate(() => window.__xfactors)) === '["Test brigade (fictional)|sharpshooters"]',
    `saved: ${sherman.badges.map((b) => `${b.id} ${b.tier}`).join(', ')}; X-Factor ${sherman.xfactor}${sherman.offer ? `; ${sherman.offer.length} on offer` : ''}; ${issueBadges} emblems on the issue cards; moment shown once`);
    // ---- back in camp: nothing replays; the card's emblem opens the real example ----
    await camp();
    const card = await page.evaluate(() => ({ log: window.__xfactors ?? [], moments: document.querySelectorAll('.rw-xfactor-moment').length,
      chips: [...document.querySelectorAll('#camp-army [data-brigade-id="sherman"] button.cw-badge')].map((n) => n.getAttribute('aria-label')),
      glow: document.querySelector('#camp-army [data-brigade-id="sherman"]')?.classList.contains('has-xfactor'),
      choose: !!document.querySelector('#camp-army [data-brigade-id="sherman"] .camp-choose-button') }));
    check('badges-camp-card', card.log.length === 0 && card.moments === 0 && card.chips.some((l) => /^Sharpshooters, Gold badge, X-Factor: details$/.test(l)) && card.glow,
      `camp card emblems ${card.chips.join(' / ')}; X-Factor glow ${card.glow}; no moment replayed`);
    const chip = page.locator('#camp-army [data-brigade-id="sherman"] button.cw-badge[data-badge="sharpshooters"]');
    await chip.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('camp-badge').open);
    const detail = await page.evaluate(() => ({ heading: document.getElementById('camp-badge-heading').textContent, focus: document.activeElement?.id,
      unit: document.getElementById('camp-badge-unit').textContent, text: document.getElementById('camp-badge-text').textContent,
      provenance: document.getElementById('camp-badge-provenance').textContent, effect: document.getElementById('camp-badge-effect').textContent,
      rule: document.querySelector('#camp-badge-rule-heading .rw-rule-tag')?.textContent,
      links: [...document.querySelectorAll('#camp-badge-sources a')].map((a) => a.href) }));
    check('badges-detail-example', detail.heading === 'Sharpshooters: Gold · X-Factor' && detail.focus === 'camp-badge-heading' && /Birge/.test(detail.unit)
      && detail.text.length > 40 && ['Verified', 'Inferred', 'Disputed'].includes(detail.provenance) && detail.rule === 'Game rule' && /^\+8 Fire/.test(detail.effect)
      && detail.links.length >= 2 && detail.links.every((h) => h.startsWith('https://')),
    `detail "${detail.heading}": ${detail.unit.slice(0, 60)}…; ${detail.provenance}; ${detail.links.length} https sources; effect "${detail.effect.slice(0, 50)}…" under Game rule`);
    await shot(page, 'badges-camp-detail');
    let axe = await new AxeBuilder({ page }).include('#camp-badge').analyze();
    let bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('badges-detail-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('camp-badge').open);
    check('badges-detail-escape', await page.evaluate(() => document.activeElement?.dataset.badge === 'sharpshooters'), 'Escape closes the detail and returns focus to the emblem');
    // ---- the brigade (Trained after the win: 2 slots) has a third badge on offer: choose by keyboard; Escape changes nothing ----
    const chooseBtn = page.locator('#camp-army [data-brigade-id="sherman"] .camp-choose-button');
    if (card.choose) {
      const before = await raw();
      await chooseBtn.click(); await page.waitForFunction(() => document.getElementById('camp-choose').open);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('camp-choose').open);
      const untouched = await raw() === before;
      await chooseBtn.focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.getElementById('camp-choose').open);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('#camp-choose .camp-choose-box')].map((b) => [b.value, b.checked, b.disabled]));
      await page.locator('#camp-choose .camp-choose-box[value="hardMarchers"]').focus(); await page.keyboard.press('Space');
      await page.locator('#camp-choose .camp-choose-box[value="woodsmen"]').focus(); await page.keyboard.press('Space');
      await page.locator('#camp-choose-save').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !window.__entry.importing && !document.getElementById('camp-choose').open, null, { timeout: 15000 });
      const chosen = (await stored()).army.find((b) => b.id === 'sherman');
      check('badges-choose-keyboard', untouched && boxes.some(([v, c, d]) => v === 'sharpshooters' && c && d) && !chosen.offer && chosen.badges.map((b) => b.id).join() === 'sharpshooters,woodsmen',
        `Escape left storage byte-identical (${untouched}); boxes ${boxes.map((b) => b.join(':')).join(', ')}; kept ${chosen.badges.map((b) => b.id).join(', ')}`);
    } else check('badges-choose-keyboard', false, 'expected the brigade to have a third badge waiting on offer');
    axe = await new AxeBuilder({ page }).include('#front').analyze();
    bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result.badgesCampAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    check('badges-camp-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.setViewportSize({ width: 320, height: 568 });
    check('badges-camp-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: badge emblems do not overflow the camp');
    await page.locator('#camp-army').scrollIntoViewIfNeeded(); await shot(page, 'badges-camp-320');
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('badges-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await page.evaluate(disconnectMoment).catch(()=>{});await ctx.close().catch(() => {}); }

  // ---- 2. the stamping and the full X-Factor moment at full motion ----
  const full = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'no-preference' });
  const fullPage=await full.newPage();
  try {
    const page = fullPage, errors = []; watchErrors(page, url, errors);
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    const { summary } = stampSummary();
    await page.evaluate(observeMoment);
    await page.evaluate(async (summary) => {
      const { mountReward } = await import('./src/reward/sequence.js');
      window.__xfactors = [];
      mountReward(document.body, { seed: 11, grade: 'Victory', rememberReplay: false, afterAction: { title: 'Fictional', why: 'Fictional test result.', surviving: 10, losses: 1, guns: 0,
        eyebrow: 'Campaign · Fictional', note: 'Test only.', badges: summary } });
    }, summary);
    await page.waitForFunction(() => window.__badgeMomentObservation, null, { timeout: 15000 });
    const moment = await page.evaluate(() => ({...window.__badgeMomentObservation,rows:window.__badgeMomentObservation.rows.length}));
    check('badges-full-moment', moment.connected && moment.badge==='sharpshooters' && moment.style === 'full' && moment.events === 'none' && moment.focus === 'rw-aar-grade' && moment.rows >= 2 && moment.stamped === moment.rows
      && JSON.stringify(moment.log) === '["Test brigade (fictional)|sharpshooters"]' && /Rock Bronze/.test(moment.enemy),
    `${moment.stamped}/${moment.rows} rows stamped; full moment ${JSON.stringify(moment.log)}; enemy line "${moment.enemy.slice(0, 60)}"`);
    await shot(page, 'badges-aar-after-moment-observation');
    await page.waitForFunction(() => window.__badgeMomentObservation&&window.__badgeMomentObservation.removedAt!==null, null, { timeout: 15000 });
    result.badgesFullMoment=await page.evaluate(()=>window.__badgeMomentObservation);
    check('badges-moment-once', result.badgesFullMoment.removedAt>=result.badgesFullMoment.insertedAt&&JSON.stringify(result.badgesFullMoment.removalLog)==='["Test brigade (fictional)|sharpshooters"]'&&await page.evaluate(() => (window.__xfactors ?? []).length === 1), 'the observed connected X-Factor moment leaves on its own and was shown once');
    const axe = await new AxeBuilder({ page }).include('.rw').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('badges-aar-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.setViewportSize({ width: 320, height: 568 });
    check('badges-aar-320', await page.locator('.rw-aar').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: the badges panel does not overflow the after-action');
    await shot(page, 'badges-aar-320');
    check('badges-full-console', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await fullPage.evaluate(disconnectMoment).catch(()=>{});await full.close().catch(() => {}); }
}

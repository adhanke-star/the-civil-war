// Six unchanged authored battles with fixed player commands; outcomes are observations, not balance targets.
import fs from 'node:fs';
import {fixedPlayerOrders,pairwiseOrderTraces,installDifficultyTrace,installDifficultyStartGate,authoredDuration,reserveActivationCause} from './balance-difficulty.mjs';
const CASES=[['shiloh','buell-attacks'],['stones-river','dawn-on-the-right'],['chattanooga','lookout-mountain']];
export async function difficultyControls({browser,url,check,shot,result,watchErrors}) {
  const started=Date.now();result.difficultyMatrix=[];
  try{for(const [packId,phaseId]of CASES){
    const authored=JSON.parse(fs.readFileSync(new URL(`../assets/packs/${packId}.json`,import.meta.url))).phases.find(p=>p.id===phaseId).scenario;
    const orders=fixedPlayerOrders(authored),rows=[];result.difficultyMatrix.push({packId,phaseId,rows});
    const duration=authoredDuration(authored);
    for(const difficulty of ['recruit','veteran','general']){
      const ctx=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[],row={difficulty,errors};rows.push(row);
      watchErrors(page,url,errors);const began=Date.now();
      try{
        await ctx.addInitScript(installDifficultyStartGate);
        await page.goto(`${url}?battle=${packId}&phase=${phaseId}&difficulty=${difficulty}&quality=low&nosw`);
        await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
        row.start=await page.evaluate(({orders,source})=>{
          const g=window.__game.game;g.paused=true;
          if(g.simTime!==0)throw new Error('difficulty matrix: start gate missed time zero');
          const start={at:g.simTime,seed:g.scenario.seed,interval:g.ai.level.interval,roster:g.scenario.units.map(u=>({id:u.id,side:u.side,men:u.men,x:u.x,z:u.z}))};
          g.__difficultyTrace=(0,eval)('('+source+')')(g);
          start.orders=orders.map(o=>{const u=g.units.find(u=>u.id===o.unitId);return {...o,accepted:!!g.order(u,o)};});return start;
        },{orders,source:installDifficultyTrace.toString()});
        check(`difficulty-${phaseId}-${difficulty}-start`,row.start.at===0&&row.start.seed===authored.seed&&row.start.orders.every(o=>o.accepted),JSON.stringify(row.start));
        if(row.start.at!==0||row.start.seed!==authored.seed||!row.start.orders.every(o=>o.accepted))throw new Error('difficulty matrix: starting commands/seed/time not comparable');
        const expectedRoster=authored.units.map(u=>({id:u.id,side:u.side,men:u.men,x:u.x,z:u.z}));
        if(JSON.stringify(row.start.roster)!==JSON.stringify(expectedRoster))throw new Error('difficulty matrix: authored starting roster changed');
        await page.evaluate(()=>{const g=window.__game.game;if(g.simTime!==0||!g.paused)throw new Error('difficulty matrix: start gate drift');window.__difficultyStartGate.release();});
        row.autoPauseResumes=0;
        let over=false;for(let chunk=0;chunk<Math.ceil((duration+5)/20)&&!over;chunk++){
          const advanced=await page.evaluate(()=>{const g=window.__game.game,target=g.simTime+20;let resumes=0,iterations=0;
            // Resume genuine auto-pauses without adding orders or advancing after natural termination.
            while(!g.over&&g.simTime<target-1e-6){if(iterations++>=1000)throw new Error('difficulty matrix: bounded resume loop exhausted');g.paused=false;const before=g.simTime;g.fastForward(target-before);if(g.paused&&!g.over)resumes++;if(g.simTime<=before&&!g.over)throw new Error('difficulty matrix: simulation stalled');}
            g.paused=true;return {over:g.over,resumes};});over=advanced.over;row.autoPauseResumes+=advanced.resumes;
        }
        Object.assign(row,await page.evaluate(()=>{const g=window.__game.game;return {over:g.over,simTime:g.simTime,result:g.result,holder:g.holder,trace:g.__difficultyTrace,
          units:g.units.map(u=>({id:u.id,side:u.side,menStart:u.menMax,men:u.men,state:u.state,x:u.x,z:u.z})),feats:g.featReport()};}));
        row.wallSeconds=(Date.now()-began)/1000;
        check(`difficulty-${phaseId}-${difficulty}-complete`,row.over&&!row.trace.overflow&&errors.length===0,JSON.stringify({over:row.over,sim:row.simTime,passes:row.trace.passes,orders:row.trace.orders.length,errors}));
        if(phaseId==='lookout-mountain'){
          const activation=row.trace.activations.find(a=>a.id==='cs-moore-brigade'),transitions=row.trace.reserves.filter(a=>a.id==='cs-moore-brigade');
          row.reserveObservation={activation,cause:activation?reserveActivationCause(activation):null,transitions,
            orders:row.trace.orders.filter(o=>o.id==='cs-moore-brigade'),earlyThreat:activation&&activation.clock<activation.at+activation.temperament.start?'observed':'unobserved'};
          check(`difficulty-lookout-${difficulty}-reserve`,!!row.reserveObservation.cause&&transitions.some(t=>t.active)&&row.reserveObservation.orders.length>0,
            JSON.stringify(row.reserveObservation));
          if(!row.reserveObservation.cause||!transitions.some(t=>t.active)||!row.reserveObservation.orders.length)throw new Error('difficulty matrix: actual Moore reserve activation/order not proved');
        }
        await shot(page,`difficulty-${phaseId}-${difficulty}-result`);
        if(!row.over||row.trace.overflow||errors.length)throw new Error('difficulty matrix: incomplete observation retained');
      }finally{await ctx.close();}
    }
    check(`difficulty-${phaseId}-same-commands`,rows.every(r=>JSON.stringify(r.start.orders)===JSON.stringify(rows[0].start.orders)&&JSON.stringify(r.start.roster)===JSON.stringify(rows[0].start.roster)),'identical accepted time-zero player tuples and authored roster at every level');
    const comparisons=pairwiseOrderTraces(rows);result.difficultyMatrix.at(-1).comparisons=comparisons;
    check(`difficulty-${phaseId}-semantic-difference`,comparisons.some(p=>p.different),JSON.stringify(comparisons));
    console.log('DIFFICULTY OBSERVATION',phaseId,JSON.stringify(rows.map(r=>({difficulty:r.difficulty,result:r.result,sim:r.simTime,passes:r.trace.passes,orders:r.trace.orders.length,reserves:r.trace.reserves.length,wall:r.wallSeconds}))),JSON.stringify(comparisons));
  }}finally{result.difficultyMatrixSeconds=(Date.now()-started)/1000;}
}

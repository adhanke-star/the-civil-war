// Actual Buell campaign route with normal player orders, real terrain/AI/combat and actual saved awards. Actions only.
import {AxeBuilder} from '@axe-core/playwright';
export async function foragersControls({browser,url,check,shot,result,watchErrors}) {
  const ctx=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];
  watchErrors(page,url,errors);
  try {
    await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    await page.evaluate(async()=>{
      const C=await import('./src/franchise/campaign.js'),S=await import('./src/franchise/save.js');
      const campaign=await(await fetch('./assets/campaign.json')).json();let save=C.newCampaign({campaign,slot:1,seed:1862});
      for(const p of campaign.phases.slice(0,3))save=C.recordPhase(save,campaign,{packId:p.packId,phaseId:p.phaseId,winner:null,grade:'Draw',units:[],loot:[]});
      await S.createProgressStore(undefined,{slot:1}).complete(save);
    });
    await page.goto(url+'?campaign=1&quality=low&nosw');
    await page.waitForFunction(()=>window.__ready&&window.__game?.game&&document.getElementById('briefing')?.open,null,{timeout:180000,polling:250});
    const note='Fictional supply objectives added for gameplay; these locations are not historical claims.';
    check('foragers-briefing',await page.locator('#briefing-text').innerText().then(t=>t.includes(note)),'fictional objectives labelled separately in actual campaign briefing');
    await page.locator('#briefing-begin').click();
    await page.evaluate(()=>{
      const {game}=window.__game;game.paused=true;
      // Supporting brigades attack the historical objective; Rousseau takes the optional supply route.
      for(const u of game.units)if(u.side==='US'&&u.type==='infantry'&&u.id!=='us-rousseau-brigade')
        game.order(u,{type:'move',points:[[u.x,u.z],[game.scenario.objective.x,game.scenario.objective.z]]});
      game.select(game.units.find(u=>u.id==='us-rousseau-brigade'));
    });
    await page.locator('#capture-count').focus();await page.keyboard.press('Enter');
    check('foragers-field-note',(await page.locator('#field-stores').innerText()).includes(note),'field controls explain game-rule supply locations');
    check('foragers-keyboard',await page.evaluate(()=>document.activeElement?.dataset.crateOrder==='buell-game-supply-1'),'Stores opens with keyboard focus on a march command');
    const axe=await new AxeBuilder({page}).include('#field-stores').analyze();
    check('foragers-axe',!axe.violations.some(v=>v.impact==='serious'||v.impact==='critical'),JSON.stringify(axe.violations.map(v=>v.id)));
    await page.setViewportSize({width:320,height:568});
    check('foragers-320',await page.locator('#field-stores').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'note and march commands fit 320px');
    await shot(page,'foragers-stores-320');await page.keyboard.press('Escape');
    check('foragers-escape',await page.evaluate(()=>document.getElementById('field-stores').hidden&&document.activeElement?.id==='capture-count'),'Escape closes Stores and returns focus');
    await page.setViewportSize({width:1024,height:768});
    const route=[];
    for(let index=1;index<=4;index++) {
      if(index===4){await page.locator('[data-order="run"]').click();check('foragers-run-final-leg',await page.locator('[data-order="run"]').getAttribute('aria-pressed')==='true','one deliberate native Run order bypasses march-to-fight halt');}
      await page.locator('#capture-count').click();
      await page.locator(`[data-crate-order="buell-game-supply-${index}"]`).click();
      let state;
      for(let chunk=0;chunk<24;chunk++) {
        state=await page.evaluate(({index})=>{
          const g=window.__game.game;g.paused=false;g.fastForward(25);g.paused=true;
          const u=g.units.find(u=>u.id==='us-rousseau-brigade'),c=g.fieldCaptures.crates[index-1];
          return {index,simTime:g.simTime,over:g.over,owner:c.owner,status:c.status,stores:g.featReport()[u.id].stores,men:u.men,state:u.state,x:u.x,z:u.z,
            run:u.run,engaged:u.engaged,followActive:u.follow.active,target:u.target?.id||null,morale:u.morale,fatigue:u.fatigue};
        },{index});
        if(state.stores>=index||state.over||state.men===0)break;
      }
      route.push(state);check(`foragers-route-${index}`,state.owner==='US'&&state.stores>=index&&state.men>0,JSON.stringify(state));
      if(state.stores<index)break;
    }
    if(route.length===4&&route[3].stores===4){await page.locator('[data-order="run"]').click();await page.locator('[data-order="hold"]').click();check('foragers-hold-after-capture',await page.evaluate(()=>!window.__game.game.selected.run&&window.__game.game.selected.order.firm),'native Hold ends the deliberate running leg');}
    result.foragersRoute=route;
    check('foragers-four-distinct',route.length===4&&route[3].stores===4&&route[3].men>0,'one surviving franchise brigade captured all four through native march controls');
    await shot(page,'foragers-four-stores');
    for(let chunk=0;chunk<55;chunk++) {
      const over=await page.evaluate(()=>{const g=window.__game.game;g.paused=false;g.fastForward(30);g.paused=true;return g.over;});if(over)break;
    }
    await page.waitForFunction(()=>document.getElementById('result').open&&!document.getElementById('result-action').hidden,null,{timeout:30000});
    const outcome=await page.evaluate(async()=>{
      const C=await import('./src/franchise/campaign.js'),S=await import('./src/franchise/save.js');
      const before=S.parseSnapshot(await S.createProgressStore(undefined,{slot:1}).readRawBaseline());
      const campaign=await(await fetch('./assets/campaign.json')).json(),g=window.__game.game;
      const {outcome,record}=C.phaseResult({phase:window.__game.campaign.phase,game:g,scenario:g.scenario}),after=C.recordPhase(before,campaign,record);
      const b=after.army.find(b=>b.unitId==='us-rousseau-brigade');
      return {badge:[...(b.badges||[]),...(b.offer||[])].find(b=>b.id==='foragers'),captures:outcome.captures,cards:outcome.cards,
        stable:JSON.stringify(S.parseSnapshot(S.exportSnapshot(after)))===JSON.stringify(after),duplicate:JSON.stringify(C.recordPhase(after,campaign,record))===JSON.stringify(after)};
    });
    result.foragersOutcome=outcome;
    check('foragers-real-award',outcome.badge?.tier==='gold'&&outcome.badge?.feat===4&&outcome.stable&&outcome.duplicate,'actual completed-phase Gold award, export/import and repeat idempotence');
    check('foragers-loot-provenance',outcome.cards.filter(c=>c.source==='capture').every(c=>c.from.includes(note)),'captured supply cards preserve fictional-location provenance');
    await page.locator('#result-action').click();
    await page.getByRole('button',{name:/^Open the loot/}).click();await page.keyboard.press('s');
    await page.getByRole('button',{name:/^Issue to brigades/}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.waitForFunction(()=>!window.__game.practice.reward.state.counting);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('result').open&&document.getElementById('result-title').textContent==='Campaign saved',null,{timeout:30000});
    const saved=await page.evaluate(async()=>{const S=await import('./src/franchise/save.js'),s=S.parseSnapshot(await S.createProgressStore(undefined,{slot:1}).readRawBaseline()),b=s.army.find(b=>b.unitId==='us-rousseau-brigade');return {badge:[...(b.badges||[]),...(b.offer||[])].find(b=>b.id==='foragers'),index:s.campaign.index};});
    check('foragers-ui-saved',saved.badge?.tier==='gold'&&saved.index===4,'real after-action/loot/Continue writes Gold and advances campaign');
    check('foragers-errors',errors.length===0,JSON.stringify(errors));
  } finally {await ctx.close();}
}

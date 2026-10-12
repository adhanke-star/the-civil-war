// Actual shipped Stones River command chains, existing cards, Records and briefing. Actions only.
import { AxeBuilder } from '@axe-core/playwright';

export async function commandChainControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const axe = async selector => {
    const a = await new AxeBuilder({ page }).include(selector).analyze();
    return a.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id);
  };
  try {
    for (const [phase, id, name] of [['dawn-on-the-right','cs-rains-brigade','William J. Hardee'], ['slaughter-pen','cs-wood-brigade','William J. Hardee'],
      ['slaughter-pen','cs-maney-brigade','Benjamin F. Cheatham'], ['round-forest','cs-chalmers-brigade','Leonidas Polk']]) {
      const tag = `${phase}-${id}`;
      await page.goto(`${url}?battle=stones-river&phase=${phase}&quality=low&nosw`);
      await page.waitForFunction(() => window.__ready && window.__game?.game, null, { timeout: 180000, polling: 250 });
      if (await page.evaluate(() => document.getElementById('briefing')?.open)) await page.locator('#briefing-begin').click();
      await page.evaluate(id => { const { game } = window.__game; if (!game.paused) game.togglePause(); game.select(game.units.find(u => u.id === id)); }, id);
      await page.waitForFunction(name => document.querySelector('#uc-traits [data-who="chain"]')?.textContent.includes(name), name, { timeout: 30000 });
      const card = await page.evaluate(id => ({ rows: [...document.querySelectorAll('#uc-traits .uct-row')].map(r => [r.dataset.who, r.textContent]),
        generals: window.__game.game.commanders.length, keys: window.__game.game.ai.traitsOf(window.__game.game.units.find(u => u.id === id)).keys }), id);
      result[`commandChain-${tag}`] = card;
      check(`command-chain-card-${tag}`, card.rows.some(([who,text]) => who === 'chain' && text.includes(name)) && card.generals === 0,
        `${name} command influence on the card; ${card.generals} physical generals`);
      check(`command-chain-axe-${tag}`, (await axe('#unitcard')).length === 0, 'no serious/critical card violations');
      await shot(page, `command-chain-${tag}-card`);
      await page.locator('#uc-traits-more').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('traits-dialog')?.open);
      const record = page.locator(`#traits-dialog .traits-man[data-commander="${name}"]`);
      const text = await record.innerText();
      const links = await record.locator('.traits-command-sources a').evaluateAll(a => a.map(n => ({ href: n.href, rel: n.rel })));
      const expectedSources = name === 'Benjamin F. Cheatham' ? 4 : phase === 'slaughter-pen' ? 5 : 3;
      check(`command-chain-sources-${tag}`, text.includes('Command influence: Inferred:') && text.includes('not a plotted location')
        && links.length === expectedSources && links.every(a => /^https:\/\//.test(a.href) && a.rel.includes('noopener')), `relationship provenance and ${links.length} opened source links`);
      await record.locator('.traits-command-sources a').first().focus();
      check(`command-chain-keyboard-${tag}`, await page.evaluate(() => document.activeElement?.tagName === 'A' && !!document.activeElement.closest('#traits-dialog')),
        'source links take keyboard focus within Records');
      check(`command-chain-record-axe-${tag}`, (await axe('#traits-dialog')).length === 0, 'no serious/critical Records violations');
      await page.setViewportSize({ width: 320, height: 568 });
      check(`command-chain-320-${tag}`, await page.locator('#traits-dialog').evaluate(d => d.scrollWidth <= d.clientWidth + 1), 'Records and relationship sources fit 320px');
      await shot(page, `command-chain-${tag}-records-320`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('traits-dialog')?.open && !window.__game.hud.traitsPaused);
      check(`command-chain-close-${tag}`, await page.evaluate(() => document.activeElement?.id === 'uc-traits-more' && window.__game.game.paused), 'Escape restores focus and preserves an already-paused battle');
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.evaluate(id => { const { game } = window.__game; const u = game.units.find(u => u.id === id); game.commanderDown(u, 'wounded'); game.select(u); }, id);
      await page.waitForFunction(() => !document.querySelector('#uc-traits [data-who="own"]'));
      check(`command-chain-down-${tag}`, (await page.locator('#uc-traits [data-who="chain"]').innerText()).includes(name), 'higher command influence remains after brigade commander falls');
    }
    // Seed a completed dawn with Wood eliminated, then use the real campaign loader for Slaughter Pen.
    await page.goto(url+'?nosw');
    await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    await page.evaluate(async()=>{
      const C=await import('./src/franchise/campaign.js'),S=await import('./src/franchise/save.js');
      const campaign=await(await fetch('./assets/campaign.json')).json();let save=C.newCampaign({campaign,slot:1,seed:1862});
      const packs={};
      for(const entry of campaign.phases.slice(0,5)){
        packs[entry.packId]??=await(await fetch(`./assets/packs/${entry.packId}.json`)).json();
        const s=packs[entry.packId].phases.find(p=>p.id===entry.phaseId).scenario;
        save=C.recordPhase(save,campaign,{packId:entry.packId,phaseId:entry.phaseId,winner:null,grade:'Draw',loot:[],
          units:[...s.units,...(s.reinforcements||[])].map(u=>({id:u.id,side:u.side,menStart:u.men,men:entry.phaseId==='dawn-on-the-right'&&u.id==='cs-wood-brigade'?0:u.men}))});
      }
      await S.createProgressStore(undefined,{slot:1}).complete(save);
    });
    await page.goto(url+'?campaign=1&quality=low&nosw');
    await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
    const carry=await page.evaluate(()=>{
      const g=window.__game.game;return {wood:g.units.some(u=>u.id==='cs-wood-brigade'),chain:g.scenario.commandChain,
        commanders:g.commanders.length,hardee:g.ai.traitsOf(g.units.find(u=>u.id==='cs-lpolk-brigade')).keys};
    });
    result.commandChainCarry=carry;
    check('command-chain-campaign-carry',!carry.wood&&carry.chain.find(c=>c.name==='William J. Hardee').units.join(',')==='cs-lpolk-brigade,cs-bjohnson-brigade'
      &&carry.hardee.length>0&&carry.commanders===0,'Slaughter Pen loads after a dawn elimination; surviving chain authority acts');
    await shot(page,'command-chain-campaign-carry');
    // Briefing of the actual dawn scenario; no interception or forged source/trait data.
    await page.goto(url + '?nosw');
    await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await page.evaluate(async () => {
      const { mountBriefing } = await import('./src/ui/briefing.js');
      const pack = await (await fetch('./assets/packs/stones-river.json')).json();
      const battle = document.getElementById('battle'); if (battle) battle.id = 'battle-hold';
      mountBriefing({ scenario: pack.phases[0].scenario, phase: { loan: true }, game: { paused: false, playerSide: 'US' },
        hud: { setPaused() {}, playerSide: 'US' }, effects: null, onBegin() {} });
    });
    const item = page.locator('#briefing .briefing-opponent[data-commander="William J. Hardee"]');
    await item.waitFor({ timeout: 30000 }); await item.locator('summary').focus(); await page.keyboard.press('Enter');
    check('command-chain-briefing', await item.locator('details').evaluate(d => d.open) && await item.locator('.traits-command-sources a').count() === 3,
      'Hardee command relationship and sources accessible in briefing');
    check('command-chain-briefing-axe', (await axe('#briefing')).length === 0, 'no serious/critical briefing violations');
    await shot(page, 'command-chain-briefing');
    const real = errors.filter(e => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('command-chain-console', !real.length, real.length ? real.slice(0,4).join(' | ') : 'no page errors or failed requests');
  } finally { await ctx.close().catch(() => {}); }
}

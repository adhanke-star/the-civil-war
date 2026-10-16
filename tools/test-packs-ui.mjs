// tools/test-packs-ui.mjs: every phase of every shipped battle pack loads in the real page.
//
// For each phase in assets/campaign.json: ?battle=<pack>&phase=<id>&quality=low reaches window.__ready with no page,
// console or request errors, draws soldiers on its own terrain, runs 40 s of battle without errors, and leaves an
// opening and an in-battle screenshot in .out/ for visual review. Registered in tools/test.mjs (CI shard 3, --packs-ui).
// Play either side (src/sim/sides.js, DECISIONS 0273): the Battles menu's Command choice adds &side=CS to every phase link,
// and the four Union-attack phases plus Stones River's dawn load with the player commanding the Confederates while the
// computer's Union moves; screenshots pack-<id>-cs-opening/-battle.

import fs from 'node:fs';

const CS_PHASES = [['shiloh', 'buell-attacks'], ['stones-river', 'dawn-on-the-right'], ['chattanooga', 'orchard-knob'],
  ['chattanooga', 'lookout-mountain'], ['chattanooga', 'missionary-ridge']];

export async function packsUIControls({ browser, url, check, shot, result, watchErrors }) {
  const campaign = JSON.parse(fs.readFileSync(new URL('../assets/campaign.json', import.meta.url), 'utf8'));
  const rows = result.packsUI = [];
  for (const { packId, phaseId } of campaign.phases) {
    const name = `pack-${packId}-${phaseId}`, errors = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    watchErrors(page, url, errors);
    try {
      await page.goto(`${url}?battle=${packId}&phase=${phaseId}&quality=low`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000, polling: 250 });
      await page.waitForTimeout(2000);
      const opening = await page.evaluate(() => {
        const { game, pack, terrain, world } = window.__game;
        return { pack, terrain: terrain.meta.name, units: game.units.length, figures: game.figureCount(),
          sides: [...new Set(game.units.map((u) => u.side))].sort(), title: document.getElementById('menu-title').textContent,
          objective: document.getElementById('objective').textContent, trees: world.stats?.trees ?? null,
          treeSpacing: world.stats?.treeSpacing ?? null };
      });
      if (packId === 'stones-river' && phaseId === 'dawn-on-the-right') {
        const ground = await page.evaluate(() => {
          const { game, terrain } = window.__game;
          const post = game.units.find((u) => u.id === 'us-post-brigade');
          const carlin = game.units.find((u) => u.id === 'us-carlin-brigade');
          return { half: terrain.half, grid: terrain.meta.grid, south: terrain.meta.bbox.south,
            postZ: post.z, gap: Math.hypot(post.x - carlin.x, post.z - carlin.z),
            outside: game.units.flatMap((u) => u.figures).filter((f) => Math.abs(f.x) >= terrain.half - 60 || Math.abs(f.z) >= terrain.half - 60).length };
        });
        check(`${name}-true-ground`, ground.south < 35.843 && ground.grid === 1025 && ground.postZ > 2300 && ground.postZ < 2500
          && ground.gap < 450 && ground.outside === 0, JSON.stringify(ground));
      }
      await shot(page, `${name}-opening`);
      const run = await page.evaluate(() => {
        const { game } = window.__game, t0 = game.simTime;
        // Arrival alerts auto-pause the battle; resume through them, as a player pressing Resume would.
        for (let guard = 0; guard < 200 && game.simTime - t0 < 40 && !game.over; guard++) {
          if (game.paused) game.togglePause();
          game.fastForward(Math.min(5, 40 - (game.simTime - t0)));
        }
        return { advanced: game.simTime - t0, over: game.over, alive: game.units.filter((u) => u.alive).length,
          moving: game.units.filter((u) => u.follow?.active).length };
      });
      await page.waitForTimeout(1500);
      await shot(page, `${name}-battle`);
      const row = { packId, phaseId, opening, run, errors: errors.slice() };
      rows.push(row);
      check(`${name}-loads`, opening.pack?.packId === packId && opening.pack?.phaseId === phaseId && opening.units > 0
        && opening.figures > 0 && opening.sides.join() === 'CS,US', JSON.stringify(opening));
      check(`${name}-runs`, (run.advanced >= 39 || run.over) && errors.length === 0, JSON.stringify({ run, errors: errors.slice(0, 5) }));
    } catch (error) {
      rows.push({ packId, phaseId, failure: error.message, errors: errors.slice() });
      check(`${name}-loads`, false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
    } finally {
      await ctx.close();
    }
  }
  await sideMenu({ browser, url, check, watchErrors });
  for (const [packId, phaseId] of CS_PHASES) await confederatePhase({ browser, url, check, shot, rows, watchErrors }, packId, phaseId);
}

/** The title's Battles list: Command = Confederate puts &side=CS on every phase link; Union takes it off again. */
async function sideMenu({ browser, url, check, watchErrors }) {
  const errors = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watchErrors(page, url, errors);
  try {
    await page.goto(url);
    await page.click('#entry-battles');
    await page.waitForFunction(() => document.querySelectorAll('#entry-battle-rows a[data-pack]').length >= 11, null, { timeout: 60_000 });
    const hrefs = () => page.$$eval('#entry-battle-rows a[data-pack]', (as) => as.map((a) => a.getAttribute('href')));
    const union = await hrefs();
    await page.selectOption('#entry-battles-side', 'CS');
    const confederate = await hrefs(), note = await page.textContent('#entry-battles-difficulty-note');
    await page.selectOption('#entry-battles-difficulty', 'general');
    const general = await hrefs();
    await page.selectOption('#entry-battles-side', 'US');
    const back = await hrefs();
    check('pack-side-menu', union.length >= 11 && union.every((h) => !h.includes('side='))
      && confederate.every((h) => h.endsWith('&side=CS')) && /command the Confederates/.test(note)
      && general.every((h) => h.includes('&difficulty=general&side=CS')) && back.every((h) => !h.includes('side=') && h.includes('difficulty=general'))
      && errors.length === 0, JSON.stringify({ union: union.slice(0, 2), confederate: confederate.slice(0, 2), general: general.slice(0, 1), back: back.slice(0, 1), errors: errors.slice(0, 5) }));
  } catch (error) {
    check('pack-side-menu', false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
  } finally { await ctx.close(); }
}

/** One phase with the player commanding the Confederates: the player's side, the computer's, and 40 s of battle. */
async function confederatePhase({ browser, url, check, shot, rows, watchErrors }, packId, phaseId) {
  const name = `pack-${packId}-${phaseId}-cs`, errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watchErrors(page, url, errors);
  try {
    await page.goto(`${url}?battle=${packId}&phase=${phaseId}&quality=low&side=CS`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000, polling: 250 });
    await page.waitForTimeout(2000);
    const opening = await page.evaluate(() => {
      const { game, hud, input } = window.__game;
      const cs = game.units.find((u) => u.side === 'CS'), us = game.units.find((u) => u.side === 'US');
      return { player: game.playerSide, ai: game.ai.side, hud: hud.playerSide, input: input.playerSide,
        controlsCS: game.controls(cs), controlsUS: game.controls(us), controlled: [...new Set(game.units.filter((u) => game.controls(u)).map((u) => u.side))],
        objective: document.getElementById('objective').textContent, tip: document.getElementById('tip').textContent,
        mode: document.getElementById('play-mode').textContent };
    });
    await shot(page, `${name}-opening`);
    const run = await page.evaluate(() => {
      const { game } = window.__game, t0 = game.simTime, o = game.objective;
      const us = game.units.filter((u) => u.side === 'US'), dist = () => us.reduce((n, u) => n + Math.hypot(u.x - o.x, u.z - o.z), 0) / us.length;
      const before = dist();
      for (let guard = 0; guard < 200 && game.simTime - t0 < 40 && !game.over; guard++) {
        if (game.paused) game.togglePause();
        game.fastForward(Math.min(5, 40 - (game.simTime - t0)));
      }
      return { advanced: game.simTime - t0, over: game.over, closed: before - dist(), attacker: game.scenario.attacker };
    });
    await page.waitForTimeout(1500);
    await shot(page, `${name}-battle`);
    rows.push({ packId, phaseId, side: 'CS', opening, run, errors: errors.slice() });
    check(`${name}-command`, opening.player === 'CS' && opening.ai === 'US' && opening.hud === 'CS' && opening.input === 'CS'
      && opening.controlsCS && !opening.controlsUS && opening.controlled.join() === 'CS'
      && opening.objective.startsWith(phaseId === 'dawn-on-the-right' ? 'Objective: take' : 'Objective: hold')
      && /Confederate flag/.test(opening.tip) && !/blue/.test(opening.tip) && /you command the Confederates/.test(opening.mode), JSON.stringify(opening));
    check(`${name}-runs`, (run.advanced >= 39 || run.over) && (run.attacker !== 'US' || run.closed > 10) && errors.length === 0,
      JSON.stringify({ run, errors: errors.slice(0, 5) }));
  } catch (error) {
    rows.push({ packId, phaseId, side: 'CS', failure: error.message, errors: errors.slice() });
    check(`${name}-command`, false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
  } finally { await ctx.close(); }
}

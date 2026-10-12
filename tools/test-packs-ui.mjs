// tools/test-packs-ui.mjs: every phase of every shipped battle pack loads in the real page.
//
// For each phase in assets/campaign.json: ?battle=<pack>&phase=<id>&quality=low reaches window.__ready with no page,
// console or request errors, draws soldiers on its own terrain, runs 40 s of battle without errors, and leaves an
// opening and an in-battle screenshot in .out/ for visual review. Registered in tools/test.mjs (CI shard 3, --packs-ui).

import fs from 'node:fs';

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
}

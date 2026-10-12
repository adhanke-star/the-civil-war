// tools/test-offline.mjs: the installed app plays offline (DESIGN §4b "loaded battles work offline").
//
//   node tools/test-offline.mjs
//
// Chromium on a local server with ?sw (src/entry.js and src/main.js register sw.js on https, or with ?sw for tests):
// 1. the title registers the service worker and it takes control; 2. the title and a battle are visited online so
// the worker caches what they load; 3. the browser goes offline; the title reloads from the cache and the same battle
// loads on its own terrain and runs 10 s; 4. back online, the worker still answers. Fails on any page error.
// Runs on CI (job "browsers" matrix entry "offline"); the Mac never launches a browser.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from './serve.mjs';

const OUT = path.join(ROOT, '.out', 'offline');
await fs.mkdir(OUT, { recursive: true });
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${detail}`); };
const BATTLE = '?battle=shiloh&phase=camps-at-dawn&quality=low&sw';

const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
const battleReady = () => page.waitForFunction(() => window.__ready === true, null, { timeout: 240_000, polling: 500 });
try {
  // 1. registration and control
  await page.goto(`${url}?sw`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || null, null, { timeout: 60_000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 }); }
  const sw = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, scope: (await navigator.serviceWorker.getRegistration())?.scope }));
  check('sw-controls', sw.controlled, JSON.stringify(sw));
  // 2. visit the title and one battle online, through the worker
  await page.reload(); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  await page.goto(url + BATTLE); await battleReady(); await page.waitForTimeout(3000);
  const cached = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
  check('cache-filled', cached > 50, `${cached} cached responses after the title and one battle`);
  // 3. offline
  await ctx.setOffline(true);
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  await page.screenshot({ path: path.join(OUT, 'offline-title.png') });
  check('offline-title', await page.evaluate(() => window.__entry.mode === 'title'), 'the title opens with no network');
  await page.goto(url + BATTLE); await battleReady();
  const run = await page.evaluate(() => {
    const { game, pack, terrain } = window.__game, t0 = game.simTime;
    if (game.paused) game.togglePause();
    game.fastForward(10);
    return { pack: pack?.phaseId, terrain: terrain.meta.name, units: game.units.length, advanced: Math.round(game.simTime - t0) };
  });
  await page.screenshot({ path: path.join(OUT, 'offline-battle.png') });
  check('offline-battle', run.pack === 'camps-at-dawn' && run.units > 0 && run.advanced >= 9, JSON.stringify(run));
  // 4. back online
  await ctx.setOffline(false);
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  check('online-again', await page.evaluate(() => !!navigator.serviceWorker.controller), 'the worker still controls the page online');
  check('no-errors', errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'no page or console errors');
} catch (e) {
  check('harness', false, `${e.message.split('\n')[0]} | ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({ results }, null, 1));
console.log(failed.length ? `OFFLINE FAILED (${results.length - failed.length}/${results.length})` : `OFFLINE OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);

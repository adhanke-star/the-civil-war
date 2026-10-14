// tools/test-browsers.mjs: the game in Firefox and WebKit (Safari's engine), not only Chromium.
//
//   node tools/test-browsers.mjs --browser=firefox|webkit|chromium
//
// A smoke run of the paths a player takes: the title loads with one focused Continue; Continue reaches the practice
// briefing; the first and last campaign phases load on their own terrain, draw baked figures for both sides and run
// 20 s of battle; no page error, console error or failed request anywhere. Screenshots go to .out/ for review.
// Runs on CI (job "browsers"); the Mac never launches a browser.

import fs from 'node:fs/promises';
import path from 'node:path';
import playwright from 'playwright';
import { startServer, ROOT } from './serve.mjs';

const name = (process.argv.find((a) => a.startsWith('--browser=')) || '--browser=firefox').split('=')[1];
if (!['firefox', 'webkit', 'chromium'].includes(name)) throw new Error(`unknown browser ${name}`);
const OUT = path.join(ROOT, '.out', `browsers-${name}`);
await fs.mkdir(OUT, { recursive: true });
// Passive diagnosis of CI38506692812. No injected page code, routing, waits, retries or error filtering.
const traceNavigation = process.argv.includes('--trace-navigation');
const navigation = [], traceStart = performance.now();
const record = (event, detail = {}) => {
  if (traceNavigation) navigation.push({ sequence: navigation.length, ms: performance.now() - traceStart, event, ...detail });
};

function watchNavigation(page) {
  if (!traceNavigation) return;
  const requests = new Map();
  const requestId = (req) => { if (!requests.has(req)) requests.set(req, requests.size + 1); return requests.get(req); };
  const describe = (req) => ({ request: requestId(req), url: req.url(), method: req.method(), type: req.resourceType(),
    navigation: req.isNavigationRequest(), redirectedFrom: req.redirectedFrom() ? requestId(req.redirectedFrom()) : null });
  page.on('request', (req) => record('request', describe(req)));
  page.on('response', (res) => record('response', { ...describe(res.request()), status: res.status(), headers: res.headers() }));
  page.on('requestfinished', (req) => record('requestfinished', { ...describe(req), timing: req.timing() }));
  page.on('requestfailed', (req) => record('requestfailed', { ...describe(req), failure: req.failure(), timing: req.timing() }));
  page.on('framenavigated', (frame) => record('framenavigated', { url: frame.url(), main: frame === page.mainFrame() }));
  page.on('domcontentloaded', () => record('domcontentloaded', { url: page.url() }));
  page.on('load', () => record('load', { url: page.url() }));
  page.on('pageerror', (err) => record('pageerror', { url: page.url(), name: err.name, message: err.message, stack: err.stack }));
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) record('console', { type: msg.type(), text: msg.text(), location: msg.location() });
  });
  page.on('close', () => record('pageclose'));
  page.on('crash', () => record('pagecrash'));
}

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${detail}`); };
const IGNORED = /GL Driver Message|GPU stall|WebGL warning|texImage|Failed to create WebGL context.*fallback|AudioContext/i;

function watch(page, url, into) {
  page.on('pageerror', (err) => into.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED.test(msg.text())) into.push(`console.error: ${msg.text()}`); });
  // a request the page's own navigation cancels (title music streaming when Continue leaves the page) is not a failure
  page.on('requestfailed', (req) => { const why = req.failure()?.errorText ?? '?';
    if (req.url().startsWith(url) && !/cancel|abort/i.test(why)) into.push(`request failed: ${req.url().replace(url, '/')} (${why})`); });
  page.on('response', (res) => { if (res.status() >= 400) into.push(`HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });
}

const { server, url } = await startServer({ port: 0 });
let serverRequestId = 0;
if (traceNavigation) server.on('request', (req, res) => {
  // Observe the relevant server response without changing the existing handler or its headers.
  if (req.url !== '/' && req.url !== '/?intro' && req.url !== '/assets/art/manifest.json') return;
  const serverRequest = ++serverRequestId;
  record('server-request', { serverRequest, url: req.url, method: req.method, headers: req.headers });
  // writeHead's direct headers are absent from getHeaders(); retain Node's actual serialized header when available.
  res.on('finish', () => record('server-finish', { serverRequest, url: req.url, status: res.statusCode,
    rawHeader: typeof res._header === 'string' ? res._header : null }));
  res.on('close', () => record('server-close', { serverRequest, url: req.url, finished: res.writableFinished }));
});
// headless Firefox on CI has only a software GPU and blocklists WebGL 2 there; a real Firefox does not
const headed = process.argv.includes('--headed'); // CI runs Firefox headed under xvfb for Mesa's software GL
const browser = await playwright[name].launch({ headless: !headed, ...(name === 'firefox' ? { firefoxUserPrefs: {
  'webgl.force-enabled': true, 'webgl.disable-fail-if-major-performance-caveat': true, 'webgl.enable-webgl2': true } } : {}) });
console.log(`${name} ${browser.version()} at ${url}`);
try {
  // 1. title and Continue
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(), errors = [];
    watch(page, url, errors);
    watchNavigation(page);
    record('title-goto', { url });
    await page.goto(url);
    await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
    const title = await page.evaluate(() => ({ mode: window.__entry.mode, focus: document.activeElement?.id }));
    await page.screenshot({ path: path.join(OUT, 'title.png') });
    check('title', title.mode === 'title' && title.focus === 'entry-continue' && errors.length === 0, JSON.stringify({ title, errors }));
    record('continue-click-start', { title, errors: [...errors] });
    await page.locator('#entry-continue').click();
    record('continue-click-end', { url: page.url() });
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180_000, polling: 250 }).catch(() => {});
    const intro = await page.evaluate(() => ({ ready: !!window.__ready, intro: !!document.getElementById('intro')?.open }));
    await page.screenshot({ path: path.join(OUT, 'practice-intro.png') });
    check('continue-to-practice', intro.ready && intro.intro && errors.length === 0, JSON.stringify({ intro, errors: errors.slice(0, 5) }));
    record('practice-check', { intro, errors: [...errors] });
    record('context-close-start');
    await ctx.close();
    record('context-close-end');
  }
  // 2. first and last campaign phases, baked figures, 20 s of battle
  for (const [pack, phase] of [['shiloh', 'camps-at-dawn'], ['chattanooga', 'missionary-ridge']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(), errors = [], id = `${pack}-${phase}`;
    watch(page, url, errors);
    try {
      await page.goto(`${url}?battle=${pack}&phase=${phase}&quality=low&figures=baked`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 240_000, polling: 500 });
      await page.waitForFunction(() => { const g = window.__game.game; return g.baked.state === 'ready' || g.baked.state === 'failed'; },
        null, { timeout: 120_000, polling: 500 }).catch(() => {});
      const open = await page.evaluate(() => {
        const { game, pack: p } = window.__game;
        return { pack: p?.packId, phase: p?.phaseId, units: game.units.length, baked: game.baked.state, error: game.baked.error,
          atlases: game.baked.atlases ? Object.keys(game.baked.atlases).sort().join() : '' };
      });
      await page.screenshot({ path: path.join(OUT, `${id}-opening.png`) });
      check(`${id}-loads`, open.pack === pack && open.phase === phase && open.units > 0 && open.baked === 'ready' && open.atlases === 'CS,US',
        JSON.stringify(open));
      const run = await page.evaluate(() => {
        const { game } = window.__game, t0 = game.simTime;
        for (let guard = 0; guard < 100 && game.simTime - t0 < 20 && !game.over; guard++) {
          if (game.paused) game.togglePause();
          game.fastForward(Math.min(5, 20 - (game.simTime - t0)));
        }
        return { advanced: Math.round((game.simTime - t0) * 10) / 10, drawn: game.figuresDrawn() };
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `${id}-battle.png`) });
      check(`${id}-runs`, run.advanced >= 19 && run.drawn.sprites > 0 && errors.length === 0, JSON.stringify({ run, errors: errors.slice(0, 5) }));
      // close views of a Confederate and a Union infantry line, for looking at each side's baked figures
      for (const side of ['CS', 'US']) {
        const at = await page.evaluate((s) => {
          const { game, rts } = window.__game, u = game.units.find((x) => x.alive && x.side === s && x.type === 'infantry');
          if (u) { rts.flyTo(u.x, u.z, 90); rts.snap(); }
          return u ? u.short || u.id : null;
        }, side);
        await page.waitForTimeout(2500);
        if (at) await page.screenshot({ path: path.join(OUT, `${id}-close-${side}.png`) });
      }
    } catch (error) {
      check(`${id}-loads`, false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  try { await browser.close(); }
  finally {
    server.close();
    if (traceNavigation) {
      try {
        await fs.writeFile(path.join(OUT, 'navigation.json'), JSON.stringify({
          browser: name, sha: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null, url, events: navigation,
        }, null, 1));
      } catch (error) {
        // Missing trace blocks diagnosis; an observer write must not replace the original test exception.
        console.error('navigation trace unavailable:', error);
      }
    }
  }
}
const failed = results.filter((r) => !r.ok);
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({ browser: name, results }, null, 1));
console.log(failed.length ? `BROWSERS ${name} FAILED (${failed.length}/${results.length})` : `BROWSERS ${name} OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);

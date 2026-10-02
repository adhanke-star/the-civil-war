// tools/test.mjs: M1 browser test. Serves the repo on a free port, loads index.html?quality=low in headless
// Chromium (SwiftShader WebGL, so CI and the Mac both render), and checks:
//   1. ready: window.__ready within 180 s (fails fast on the first page/console error during load)
//   2. no-console-errors: zero pageerror / console error / failed request / HTTP >= 400
//   3. canvas-not-blank: sampled pixels have many distinct colours
//   4. figures: >= 1000 soldier figures and one marker button per unit; facing: every unit starts within
//      75 degrees of its nearest enemy (catches a brigade set up facing away from the battle)
//   5. select-drag-order: a real mouse press on Franklin's flag, a curved drag across the field and a
//      release issue a march order (the same path a player uses)
//   6. hold-button: the Hold button stops the brigade
//   7. fight: after re-ordering and fast-forwarding 300 sim seconds, both sides have casualties and
//      there was musket or cannon smoke
//   8. axe: no serious or critical accessibility violations
// Saves screenshots and .out/last-result.json, then prunes .out/. Exit 0 only if every check passes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { PNG } from 'pngjs';
import { startServer, ROOT } from './serve.mjs';
import { prune, OUT_DIR } from './prune.mjs';

const READY_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1280, height: 720 };
const MIN_FIGURES = 1000;

const started = Date.now();
const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
const checks = [];
const consoleErrors = [];
const consoleWarnings = [];
const result = { ok: false, timestamp: new Date(started).toISOString(), url: null, browser: null, checks, stats: null, consoleErrors, consoleWarnings, axe: null, screenshots: [], durationMs: 0 };

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console[ok ? 'log' : 'error'](`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `m1-${name}-${stamp}.png`);
  const buf = await page.screenshot({ path: file, type: 'png' });
  result.screenshots.push(path.relative(ROOT, file));
  return PNG.sync.read(buf);
}

/** Screen position (CSS px) of a world point on the ground. */
const project = (page, x, z) => page.evaluate(([x, z]) => {
  const { camera, terrain } = window.__game;
  const v = camera.position.clone().set(x, terrain.heightAt(x, z), z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}, [x, z]);

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { server, url } = await startServer({ port: 0 });
  result.url = url;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    result.browser = `chromium ${browser.version()}`;
    const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })).newPage();

    let rejectEarly;
    const earlyError = new Promise((_, reject) => { rejectEarly = reject; });
    earlyError.catch(() => {});
    const fail = (text) => { consoleErrors.push(text); rejectEarly(new Error(text)); };
    page.on('pageerror', (err) => fail(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      const loc = msg.location();
      const where = loc && loc.url ? ` (${loc.url.replace(url, '')}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') fail(`console.error: ${msg.text()}${where}`);
      else if (msg.type() === 'warning' && !/GL Driver Message|GPU stall|already non-indexed/.test(msg.text())) consoleWarnings.push(`${msg.text()}${where}`);
    });
    page.on('requestfailed', (req) => fail(`request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? 'unknown'})`));
    page.on('response', (res) => { if (res.status() >= 400) fail(`HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });

    // 1. ready
    let readyOk = false, readyDetail;
    const t0 = Date.now();
    try {
      await page.goto(`${url}?quality=low`, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      await Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: READY_TIMEOUT_MS, polling: 200 }), earlyError]);
      readyOk = true;
      readyDetail = `window.__ready after ${Date.now() - t0} ms`;
    } catch (err) {
      readyDetail = /Timeout/i.test(err.message) ? `window.__ready was not set within ${READY_TIMEOUT_MS / 1000} s` : `page failed while loading: ${err.message.split('\n')[0]}`;
    }
    check('ready', readyOk, readyDetail);
    if (readyOk) {
      await page.waitForTimeout(2500);
      const png = await shot(page, 'start');

      // 3. canvas not blank
      const colours = new Set();
      for (let y = 40; y < png.height; y += 24) for (let x = 40; x < png.width; x += 24) {
        const i = (y * png.width + x) * 4;
        colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
      }
      check('canvas-not-blank', colours.size > 50, `${colours.size} distinct colours in the sample grid`);

      // 4. figures and markers
      const info = await page.evaluate(() => ({ figures: window.__game.game.figureCount(), units: window.__game.game.units.length, markers: document.querySelectorAll('#markers .marker').length }));
      check('figures', info.figures >= MIN_FIGURES && info.markers === info.units, `${info.figures} figures (need >= ${MIN_FIGURES}); ${info.markers} markers for ${info.units} units`);

      // 4b. every brigade and battery starts facing its nearest enemy (within 75 degrees)
      const facing = await page.evaluate(() => {
        const us = window.__game.game.units;
        return us.map((u) => {
          let best = null, bd = Infinity;
          for (const e of us) if (e.side !== u.side) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd) { bd = d; best = e; } }
          const bear = Math.atan2(best.x - u.x, best.z - u.z);
          return { id: u.id, off: Math.abs(Math.atan2(Math.sin(bear - u.facing), Math.cos(bear - u.facing))) };
        });
      });
      const wrong = facing.filter((f) => f.off > (75 * Math.PI) / 180);
      check('facing', wrong.length === 0, wrong.length === 0 ? `all ${facing.length} units face within 75 deg of their nearest enemy (worst ${Math.max(...facing.map((f) => f.off)).toFixed(2)} rad)` : wrong.map((f) => `${f.id} ${f.off.toFixed(2)} rad off`).join(', '));

      // 5. select + drag-order with a real mouse: press on Franklin's flag, drag a curve, release.
      const marker = page.getByRole('button', { name: /^Franklin.s Brigade/ });
      const box = await marker.boundingBox();
      let orderOk = false, orderDetail = 'Franklin marker not found or off screen';
      if (box) {
        const sx = box.x + box.width / 2, sy = box.y + box.height * 0.45;
        const via = await project(page, -60, 470);
        const end = await project(page, 120, 520);
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          // quadratic curve start -> via -> end
          const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * via.x + t * t * end.x;
          const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * via.y + t * t * end.y;
          await page.mouse.move(x, y);
          await page.waitForTimeout(30);
        }
        const previewShown = await page.evaluate(() => !!window.__game.arrows.preview);
        await page.mouse.up();
        const st = await page.evaluate(() => {
          const g = window.__game.game;
          const u = g.units.find((v) => v.id === 'franklin');
          return { selected: g.selected && g.selected.id, orders: g.orders || 0, type: u.order.type, active: u.follow.active, pathPts: u.path ? u.path.length : 0 };
        });
        orderOk = st.selected === 'franklin' && st.orders >= 1 && st.type === 'move' && st.active && previewShown;
        orderDetail = `selected=${st.selected} orders=${st.orders} order=${st.type} moving=${st.active} pathPoints=${st.pathPts} previewArrow=${previewShown}`;
        await page.waitForTimeout(1500);
        await shot(page, 'ordered');
      }
      check('select-drag-order', orderOk, orderDetail);

      // 6. Hold button
      await page.getByRole('button', { name: 'Hold', exact: true }).click();
      const held = await page.evaluate(() => { const u = window.__game.game.units.find((v) => v.id === 'franklin'); return { type: u.order.type, active: u.follow.active }; });
      check('hold-button', held.type === 'hold' && !held.active, `after Hold: order=${held.type} moving=${held.active}`);

      // 7. fight: march three brigades up the hill, fast-forward, look for casualties and smoke on both sides
      const fight = await page.evaluate(() => {
        const g = window.__game.game;
        const by = (id) => g.units.find((u) => u.id === id);
        g.order(by('franklin'), { type: 'move', points: [[by('franklin').x, by('franklin').z], [80, 470], [230, 500]] });
        g.order(by('willcox'), { type: 'move', points: [[by('willcox').x, by('willcox').z], [60, 300], [220, 360]] });
        g.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [150, 120], [240, 260]] });
        g.fastForward(300);
        const cas = { US: 0, CS: 0 };
        for (const u of g.units) cas[u.side] += u.casualties;
        const fr = by('franklin');
        return { cas, puffs: window.__game.effects.puffs, smoke: window.__game.effects.ok, franklin: [Math.round(fr.x), Math.round(fr.z), fr.state], simTime: Math.round(g.simTime),
          states: g.units.map((u) => `${u.id}:${Math.round(u.men)}:${u.state}`).join(' ') };
      });
      await page.evaluate(() => { const r = window.__game.rts; r.goal.x = 150; r.goal.z = 420; r.goal.dist = 520; });
      await page.waitForTimeout(3000);
      await shot(page, 'fight');
      check('fight', fight.cas.US > 0 && fight.cas.CS > 0 && (fight.puffs > 0 || !fight.smoke),
        `after ${fight.simTime} sim s: Union casualties ${Math.round(fight.cas.US)}, Confederate ${Math.round(fight.cas.CS)}, smoke puffs ${fight.puffs} (smoke ${fight.smoke ? 'on' : 'unavailable'}); ${fight.states}`);
      result.fight = fight;
    }

    // 2. errors
    check('no-console-errors', consoleErrors.length === 0, consoleErrors.length === 0 ? '0 errors' : `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 5).join(' | ')}`);

    // 8. accessibility
    try {
      const axe = await new AxeBuilder({ page }).analyze();
      const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      result.axe = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), passes: axe.passes.length };
      check('axe', bad.length === 0, bad.length === 0 ? `0 serious/critical violations (${axe.violations.length} minor/moderate, ${axe.passes.length} rules passed)` : bad.map((v) => `${v.impact} ${v.id} on ${v.nodes.length} node(s): ${v.help}`).join(' | '));
    } catch (err) {
      check('axe', false, `axe-core could not run: ${err.message.split('\n')[0]}`);
    }
    result.stats = await page.evaluate(() => window.__stats ?? null).catch(() => null);
    if (result.stats) console.log(`stats: ${JSON.stringify(result.stats)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = checks.length > 0 && checks.every((c) => c.ok) ? 0 : 1;
} catch (err) {
  check('harness', false, err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err));
}
result.ok = exitCode === 0;
result.durationMs = Date.now() - started;
try {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'last-result.json'), JSON.stringify(result, null, 2) + '\n');
} catch (err) {
  console.error(`FAIL write-result: ${err.message}`);
  exitCode = 1;
}
try {
  await prune();
} catch (err) {
  console.error(`FAIL prune: ${err.message}`);
  exitCode = 1;
}
console.log(exitCode === 0 ? `TEST OK (${result.durationMs} ms)` : `TEST FAILED (${checks.filter((c) => !c.ok).length} check(s))`);
process.exit(exitCode);

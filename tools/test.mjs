// tools/test.mjs: M0 browser test. Serves the repo on a free port, loads index.html in headless Chromium
// (SwiftShader WebGL so CI and the Mac both render), and checks:
//   1. window.__ready within 120 s (fails fast on the first page/console error during load)
//   2. zero pageerror / console error messages
//   3. the canvas is not blank (sampled pixels outside the HUD have more than one distinct colour)
//   4. window.__stats.figures >= 200
//   5. axe-core: no serious or critical violations
// Saves one timestamped screenshot and .out/last-result.json, then prunes .out/.
// Exit code 0 only if every check passes; each failed check prints one "FAIL <check>: <reason>" line.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { PNG } from 'pngjs';
import { startServer, ROOT } from './serve.mjs';
import { prune, OUT_DIR } from './prune.mjs';

const READY_TIMEOUT_MS = 120_000;
const SETTLE_MS = 4_000; // let the regiment march before measuring
const VOLLEY_WAIT_MS = 30_000; // then wait (not a check) for the first volley so the screenshot shows smoke
const SMOKE_SETTLE_MS = 1_500;
const VIEWPORT = { width: 1280, height: 720 };
const MIN_FIGURES = 200;

const started = Date.now();
const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
const checks = [];
const consoleErrors = [];
const consoleWarnings = [];
const result = {
  ok: false,
  timestamp: new Date(started).toISOString(),
  url: null,
  browser: null,
  playwright: null,
  checks,
  stats: null,
  smoke: null,
  consoleErrors,
  consoleWarnings,
  axe: null,
  screenshot: null,
  durationMs: 0,
};

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) console.error(`FAIL ${name}: ${detail}`);
  else console.log(`ok   ${name}: ${detail}`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { createRequire } = await import('node:module');
  result.playwright = createRequire(import.meta.url)('playwright/package.json').version;

  const { server, url } = await startServer({ port: 0 });
  result.url = url;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    result.browser = `chromium ${browser.version()}`;
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();

    let rejectEarly;
    const earlyError = new Promise((_, reject) => {
      rejectEarly = reject;
    });
    earlyError.catch(() => {}); // only observed through Promise.race below
    page.on('pageerror', (err) => {
      const msg = `pageerror: ${err.message}`;
      consoleErrors.push(msg);
      rejectEarly(new Error(msg));
    });
    page.on('console', (msg) => {
      const loc = msg.location();
      const where = loc && loc.url ? ` (${loc.url.replace(url, '')}:${loc.lineNumber})` : '';
      if (msg.type() === 'error') {
        const text = `console.error: ${msg.text()}${where}`;
        consoleErrors.push(text);
        rejectEarly(new Error(text));
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(`${msg.text()}${where}`);
      }
    });
    page.on('requestfailed', (req) => {
      const text = `request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? 'unknown'})`;
      consoleErrors.push(text);
      rejectEarly(new Error(text));
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        const text = `HTTP ${res.status()} for ${res.url().replace(url, '/')}`;
        consoleErrors.push(text);
        rejectEarly(new Error(text));
      }
    });

    // 1. ready
    let readyOk = false;
    let readyDetail;
    const t0 = Date.now();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      await Promise.race([
        page.waitForFunction(() => window.__ready === true, null, { timeout: READY_TIMEOUT_MS, polling: 100 }),
        earlyError,
      ]);
      readyOk = true;
      readyDetail = `window.__ready after ${Date.now() - t0} ms`;
    } catch (err) {
      readyDetail = /Timeout/i.test(err.message)
        ? `window.__ready was not set within ${READY_TIMEOUT_MS / 1000} s`
        : `page failed while loading: ${err.message.split('\n')[0]}`;
    }
    check('ready', readyOk, readyDetail);

    if (readyOk) {
      await page.waitForTimeout(SETTLE_MS);
      const volleyed = await page
        .waitForFunction(() => (window.__stats?.volleys ?? 0) >= 1, null, { timeout: VOLLEY_WAIT_MS, polling: 200 })
        .then(() => true, () => false);
      if (volleyed) await page.waitForTimeout(SMOKE_SETTLE_MS);
      else console.warn(`note: no volley within ${VOLLEY_WAIT_MS / 1000} s; screenshot taken without smoke`);
    }

    // Stats (read even on failure, for the record).
    const stats = await page.evaluate(() => window.__stats ?? null).catch(() => null);
    result.stats = stats;
    result.smoke = stats ? stats.smoke : null;

    // Screenshot (always attempted).
    const shotPath = path.join(OUT_DIR, `m0-${stamp}.png`);
    let png = null;
    try {
      const buf = await page.screenshot({ path: shotPath, type: 'png' });
      png = PNG.sync.read(buf);
      result.screenshot = path.relative(ROOT, shotPath);
    } catch (err) {
      result.screenshot = `screenshot failed: ${err.message.split('\n')[0]}`;
    }

    // 2. console / page errors
    check(
      'no-console-errors',
      consoleErrors.length === 0,
      consoleErrors.length === 0 ? '0 errors' : `${consoleErrors.length} error(s): ${consoleErrors.slice(0, 5).join(' | ')}`,
    );

    // 3. canvas not blank: sample a grid over the canvas, skipping the HUD box.
    if (png) {
      const hud = await page.evaluate(() => {
        const r = document.querySelector('.hud')?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      });
      const colours = new Set();
      let samples = 0;
      const step = 16;
      for (let y = step / 2; y < png.height; y += step) {
        for (let x = step / 2; x < png.width; x += step) {
          if (hud && x >= hud.x - 4 && x <= hud.x + hud.w + 4 && y >= hud.y - 4 && y <= hud.y + hud.h + 4) continue;
          const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
          colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
          samples++;
        }
      }
      check('canvas-not-blank', colours.size > 1, `${colours.size} distinct colour(s) in ${samples} samples outside the HUD`);
    } else {
      check('canvas-not-blank', false, `no screenshot to sample (${result.screenshot})`);
    }

    // 4. figures
    const figures = stats && Number.isFinite(stats.figures) ? stats.figures : null;
    check(
      'figures',
      figures !== null && figures >= MIN_FIGURES,
      figures === null ? 'window.__stats.figures is missing' : `window.__stats.figures = ${figures} (need >= ${MIN_FIGURES})`,
    );

    // 5. accessibility
    try {
      const axe = await new AxeBuilder({ page }).analyze();
      const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      result.axe = {
        violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
        incomplete: axe.incomplete.length,
        passes: axe.passes.length,
      };
      check(
        'axe',
        bad.length === 0,
        bad.length === 0
          ? `0 serious/critical violations (${axe.violations.length} minor/moderate, ${axe.passes.length} rules passed)`
          : bad.map((v) => `${v.impact} ${v.id} on ${v.nodes.length} node(s): ${v.help}`).join(' | '),
      );
    } catch (err) {
      check('axe', false, `axe-core could not run: ${err.message.split('\n')[0]}`);
    }

    if (stats) {
      console.log(`stats: fps=${stats.fps} figures=${stats.figures} drawCalls=${stats.drawCalls} smoke=${stats.smoke}`);
    }
    if (stats && stats.smoke === false) console.warn('note: three.quarks smoke did not initialise (the game continued without it)');
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
  exitCode = 1;
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

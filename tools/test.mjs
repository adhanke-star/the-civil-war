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
// Then, with the first page closed (one page at a time on an 8 GB Mac):
//   settings (Node, before the browser): src/settings.js define/get/set/reset/on/lock/exportText/importText
//      round-trip, range clamping and snapping, unknown keys and bad values ignored
//   sandbox-*: index.html?sandbox&quality=low: the panel has 5 tabs; the Interface size slider moves
//      --ui-scale; "Lock this" disables it and set() is refused; Copy/Paste settings; the round button hides
//      the panel; axe has no serious/critical violations with the panel open; no console errors
//   device-*: device.html prints a GPU tier line and finishes the ratio-1 benchmark without console errors
// `node tools/test.mjs --unit` runs only the Node settings checks (no browser, writes nothing).
// `node tools/test.mjs --s1` runs the settings, sandbox and device checks only (skips the battle page).
// SETTINGS_MODULE=<path> points the settings checks at another copy (used to prove the checks fail).
// Saves screenshots and .out/last-result.json, then prunes .out/. Exit 0 only if every check passes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

/** src/settings.js in Node (no window, no storage): the registry contract the sandbox and other modules rely on. */
async function settingsUnit() {
  const file = process.env.SETTINGS_MODULE ? path.resolve(process.env.SETTINGS_MODULE) : path.join(ROOT, 'src', 'settings.js');
  const S = await import(pathToFileURL(file).href);
  const bad = [];
  const expect = (ok, text) => { if (!ok) bad.push(text); };
  const v0 = S.define('t.flag', { tab: 'Look', type: 'toggle', default: true, label: 'Flag', note: 'A test toggle.' });
  expect(v0 === true, `define returned ${v0}, expected the default true`);
  expect(S.define('t.flag', { tab: 'Look', type: 'toggle', default: false, label: 'Again' }) === true, 'a second define of the same key replaced the first');
  S.define('t.side', { tab: 'Look', type: 'choice', default: 'right', label: 'Side', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] });
  S.define('t.scale', { tab: 'Screens', type: 'range', default: 1, min: 0.8, max: 1.4, step: 0.05, label: 'Scale' });
  let ran = 0;
  S.define('t.go', { tab: 'Moments', type: 'action', label: 'Go', run: () => { ran++; } });
  const heard = [];
  const off = S.on('t.scale', (v, k) => heard.push(`${k}=${v}`));
  let any = 0;
  S.on('*', () => { any++; });
  let r = S.set('t.scale', 5);
  expect(r === 1.4, `set 5 on a 0.8..1.4 range gave ${r}, expected the clamp 1.4`);
  r = S.set('t.scale', -3);
  expect(r === 0.8, `set -3 on a 0.8..1.4 range gave ${r}, expected the clamp 0.8`);
  r = S.set('t.scale', 1.13);
  expect(r === 1.15, `set 1.13 with step 0.05 gave ${r}, expected 1.15`);
  expect(heard.join(' ') === 't.scale=1.4 t.scale=0.8 t.scale=1.15', `on() heard "${heard.join(' ')}"`);
  off();
  S.set('t.scale', 1.2);
  expect(heard.length === 3, 'the unsubscribe function returned by on() did not unsubscribe');
  r = S.set('t.side', 'up');
  expect(r === 'right' && S.get('t.side') === 'right', `an invalid choice "up" was accepted (value now ${S.get('t.side')})`);
  S.set('t.side', 'left');
  S.set('t.flag', false);
  expect(S.set('no.such', 1) === undefined && S.get('no.such') === undefined, 'set() on an unknown key stored a value');
  S.lock('t.side');
  expect(S.isLocked('t.side'), 'lock() did not lock');
  r = S.set('t.side', 'right');
  expect(r === 'left', `a locked setting changed on set() (now ${r})`);
  r = S.reset('t.side');
  expect(r === 'left', `a locked setting changed on reset() (now ${r})`);
  const rows = S.all();
  expect(rows.map((x) => x.key).join(',') === 't.flag,t.side,t.scale,t.go' && rows[1].locked === true, `all() gave ${rows.map((x) => `${x.key}${x.locked ? '(locked)' : ''}`).join(',')}`);
  const text = S.exportText();
  const lines = text.split('\n');
  expect(/^# .*\d{4}-\d\d-\d\d.*Node/.test(lines[0]), `exportText header "${lines[0]}" lacks the date and device`);
  expect(lines.includes('t.scale = 1.2') && lines.includes('t.side = left') && lines.includes('t.flag = false') && lines.includes('locked: t.side'),
    `exportText is missing a changed value or the locked line: ${JSON.stringify(text)}`);
  expect(!text.includes('t.go'), 'exportText listed an action');
  S.unlock('t.side');
  for (const k of ['t.flag', 't.side', 't.scale']) S.reset(k);
  expect(S.get('t.flag') === true && S.get('t.side') === 'right' && S.get('t.scale') === 1 && !S.isLocked('t.side'), 'reset()/unlock() did not restore the defaults');
  const n = S.importText(`${text}\nbogus.key = 7\nt.scale = banana\nnot a setting line`);
  expect(n === 3, `importText applied ${n}, expected 3 (the unknown key and the bad value must be ignored)`);
  expect(S.get('t.flag') === false && S.get('t.side') === 'left' && S.get('t.scale') === 1.2 && S.isLocked('t.side'),
    `importText did not restore the exported state: flag=${S.get('t.flag')} side=${S.get('t.side')} scale=${S.get('t.scale')} locked=${S.isLocked('t.side')}`);
  expect(S.get('bogus.key') === undefined, 'importText stored an unknown key');
  let threw = false;
  try { S.define('t.badtab', { tab: 'Nope', type: 'toggle', default: true, label: 'Bad' }); } catch { threw = true; }
  expect(threw, 'define() accepted the tab "Nope"');
  expect(any >= 7, `on('*') heard only ${any} changes`);
  expect(ran === 0, 'an action ran without being pressed');
  check('settings', bad.length === 0, bad.length === 0
    ? 'define/get/set/reset/on/all/lock/exportText/importText round-trip; ranges clamp and snap; unknown keys, bad values and bad specs refused'
    : bad.join(' | '));
}

/** Collects page errors for a secondary page into `into` (no early abort: those checks run after load). */
function watchErrors(page, url, into) {
  page.on('pageerror', (err) => into.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    into.push(`console.error: ${msg.text()}${loc && loc.url ? ` (${loc.url.replace(url, '')}:${loc.lineNumber})` : ''}`);
  });
  page.on('requestfailed', (req) => into.push(`request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? 'unknown'})`));
  page.on('response', (res) => { if (res.status() >= 400) into.push(`HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });
}

/** The sandbox panel on ?sandbox&quality=low, then device.html. */
async function sandboxAndDevice(browser, url) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, url, errors);
    let mounted = false;
    try {
      await page.goto(`${url}?sandbox&quality=low`, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      await page.waitForFunction(() => window.__ready === true && !!document.getElementById('sb-panel'), null, { timeout: READY_TIMEOUT_MS, polling: 200 });
      mounted = true;
    } catch (err) {
      check('sandbox-panel', false, `the sandbox panel did not mount: ${err.message.split('\n')[0]}`);
    }
    if (mounted) {
      const tabs = await page.locator('#sb-panel [role=tab]').allTextContents();
      const want = ['Units', 'Rules', 'Look', 'Moments', 'Screens'];
      check('sandbox-panel', tabs.join(',') === want.join(','), `tabs: ${tabs.join(', ') || 'none'} (want ${want.join(', ')})`);

      // a range setting drives a CSS variable, through the real slider and keyboard
      await page.getByRole('tab', { name: 'Screens' }).click();
      const selected = await page.getByRole('tab', { name: 'Screens' }).getAttribute('aria-selected');
      const slider = page.getByRole('slider', { name: 'Interface size' });
      const cssVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());
      const before = await cssVar();
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      const after = await cssVar();
      check('sandbox-setting', selected === 'true' && before === '1' && after === '1.05', `Screens tab aria-selected=${selected}; --ui-scale ${before || '(unset)'} -> ${after || '(unset)'} after one ArrowRight (want 1 -> 1.05)`);

      // Lock this: the control is disabled, the lock mark shows and set() is refused
      await page.getByRole('checkbox', { name: 'Lock this: Interface size' }).check();
      const lockState = await page.evaluate(async () => {
        const S = await import('./src/settings.js');
        const row = document.querySelector('[data-key="screens.uiScale"]');
        const kept = S.set('screens.uiScale', 1.3);
        return { disabled: row.querySelector('input[type=range]').disabled, mark: !row.querySelector('.sb-lockmark').hidden, locked: S.isLocked('screens.uiScale'), kept };
      });
      check('sandbox-lock', lockState.disabled && lockState.mark && lockState.locked && lockState.kept === 1.05,
        `slider disabled=${lockState.disabled}, lock mark shown=${lockState.mark}, isLocked=${lockState.locked}, set(1.3) while locked kept ${lockState.kept} (want 1.05)`);

      // Copy settings (clipboard, or the hand-copy box) and Paste settings
      await page.getByRole('button', { name: 'Copy settings' }).click();
      await page.waitForFunction(() => /copied|by hand/i.test(document.querySelector('.sb-status')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const copied = await page.evaluate(async () => {
        const box = document.getElementById('sb-copybox');
        if (box && !box.hidden) return { via: 'hand-copy box', text: document.getElementById('sb-copy-text').value };
        try { return { via: 'clipboard', text: await navigator.clipboard.readText() }; } catch (e) { return { via: 'nothing', text: String(e) }; }
      });
      await page.getByRole('button', { name: 'Paste settings' }).click();
      await page.getByLabel('Paste a settings block, then Apply.').fill('look.panelSide = left\nnot.a.setting = 3');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      const pasted = await page.evaluate(() => ({ left: document.getElementById('sb-panel').classList.contains('sb-left'), status: document.querySelector('.sb-status').textContent }));
      const copyOk = copied.text.includes('screens.uiScale = 1.05') && copied.text.includes('locked: screens.uiScale');
      check('sandbox-copy-paste', copyOk && pasted.left && /Applied 1 setting/.test(pasted.status),
        `copy via ${copied.via}: ${JSON.stringify(copied.text.slice(0, 160))}; paste moved the panel left=${pasted.left}, said "${pasted.status}"`);

      // a setting defined after the panel opened appears at once; its Compare button drives the divider state
      await page.getByRole('tab', { name: 'Look' }).click();
      const lateShown = await page.evaluate(async () => {
        const S = await import('./src/settings.js');
        S.define('look.testGrade', { tab: 'Look', type: 'choice', default: 'a', compare: true, label: 'Test grade', note: 'A test choice defined after the panel opened.',
          options: [{ value: 'a', label: 'Warm' }, { value: 'b', label: 'Cool' }, { value: 'c', label: 'Plain' }] });
        return !!document.querySelector('#sb-panel [data-key="look.testGrade"]');
      });
      const cmpState = () => page.evaluate(async () => (await import('./src/sandbox/compare.js')).compareState());
      let cmp = { started: null, moved: null, picked: null, ended: 'not reached' };
      if (lateShown) {
        await page.getByRole('button', { name: 'Compare Test grade side by side' }).click();
        cmp.started = await cmpState();
        await page.getByRole('slider', { name: 'Compare divider for Test grade' }).focus();
        await page.keyboard.press('ArrowRight');
        cmp.moved = await cmpState();
        await page.getByRole('group', { name: 'Right of the divider' }).getByRole('button', { name: 'C: Plain' }).click();
        cmp.picked = await cmpState();
        await page.getByRole('button', { name: 'End compare' }).first().click();
        cmp.ended = { state: await cmpState(), overlay: await page.locator('.sb-compare').count() };
      }
      const s0 = cmp.started, s1 = cmp.moved, s2 = cmp.picked;
      check('sandbox-late-define-compare', lateShown && s0 && s0.key === 'look.testGrade' && s0.a === 'a' && s0.b === 'b' && s0.split === 0.5
        && s1 && Math.abs(s1.split - 0.52) < 1e-9 && s2 && s2.b === 'c' && s2.a === 'a' && cmp.ended.state === null && cmp.ended.overlay === 0,
      `late define shown=${lateShown}; started ${JSON.stringify(s0)}; after ArrowRight ${JSON.stringify(s1)}; after Right C ${JSON.stringify(s2)}; ended ${JSON.stringify(cmp.ended)}`);

      // fps meter shows a number
      await page.waitForTimeout(1200);
      const fpsText = (await page.locator('#sb-panel .sb-fps').textContent() || '').trim();
      const tone = await page.locator('#sb-panel .sb-fps').getAttribute('data-tone');
      check('sandbox-fps', /^\d+ fps (smooth|uneven|slow)$/.test(fpsText) && /^(good|fair|poor)$/.test(tone || ''), `meter reads "${fpsText}" with tone ${tone} (want a number, a word and a tone)`);

      // the round button hides the panel and shows it again
      const toggle = page.getByRole('button', { name: 'Sandbox panel' });
      await toggle.click();
      const hidden = await page.locator('#sb-panel').isHidden();
      const expanded = await toggle.getAttribute('aria-expanded');
      const box = await toggle.boundingBox();
      await toggle.click();
      const shownAgain = await page.locator('#sb-panel').isVisible();
      check('sandbox-hide', hidden && expanded === 'false' && shownAgain && box && box.width >= 44 && box.height >= 44,
        `hidden after one tap=${hidden} (aria-expanded=${expanded}), shown after another=${shownAgain}, button ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'missing'} px`);
      await page.evaluate(async () => { (await import('./src/settings.js')).reset('look.panelSide'); });
      await page.waitForTimeout(1500); // the slide-in animation, at SwiftShader frame rates
      await page.screenshot({ path: path.join(OUT_DIR, `s1-sandbox-${stamp}.png`), type: 'png' });
      result.screenshots.push(path.relative(ROOT, path.join(OUT_DIR, `s1-sandbox-${stamp}.png`)));

      try {
        const axe = await new AxeBuilder({ page }).analyze();
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        result.sandboxAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
        check('sandbox-axe', serious.length === 0, serious.length === 0 ? `0 serious/critical violations with the panel open (${axe.violations.length} minor/moderate${axe.violations.length ? `: ${axe.violations.map((v) => v.id).join(', ')}` : ''})` : serious.map((v) => `${v.impact} ${v.id} on ${v.nodes.length} node(s): ${v.help} [${v.nodes.slice(0, 2).map((x) => x.target.join(' ')).join('; ')}]`).join(' | '));
      } catch (err) {
        check('sandbox-axe', false, `axe-core could not run: ${err.message.split('\n')[0]}`);
      }
    }
    check('sandbox-no-console-errors', errors.length === 0, errors.length === 0 ? '0 errors' : `${errors.length} error(s): ${errors.slice(0, 5).join(' | ')}`);
    await page.close();

    // device.html
    const dev = await ctx.newPage();
    const devErrors = [];
    watchErrors(dev, url, devErrors);
    let tier = '', bench = '';
    try {
      await dev.goto(`${url}device.html`, { waitUntil: 'load', timeout: 60_000 });
      await dev.waitForFunction(() => /^Tier /.test(document.getElementById('r-tier').textContent), null, { timeout: 60_000, polling: 200 });
      tier = await dev.locator('#r-tier').textContent();
      await dev.waitForFunction(() => /fps average|not run|not enough/.test(document.getElementById('r-bench1').textContent), null, { timeout: 60_000, polling: 250 });
      bench = await dev.locator('#r-bench1').textContent();
    } catch (err) {
      tier = tier || `(no tier line: ${err.message.split('\n')[0]})`;
      bench = bench || `(benchmark did not finish: ${err.message.split('\n')[0]})`;
    }
    const renderer = await dev.locator('#r-renderer').textContent().catch(() => '?');
    check('device-page', /^Tier \d/.test(tier) && /fps average/.test(bench), `${tier}; ratio 1: ${bench}; chip: ${renderer}`);
    check('device-no-console-errors', devErrors.length === 0, devErrors.length === 0 ? '0 errors' : `${devErrors.length} error(s): ${devErrors.slice(0, 5).join(' | ')}`);
    await dev.close();
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  await settingsUnit();
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { server, url } = await startServer({ port: 0 });
  result.url = url;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    result.browser = `chromium ${browser.version()}`;
    if (process.argv.includes('--s1')) {
      result.mode = 's1 only (battle page skipped)';
      await sandboxAndDevice(browser, url);
      return;
    }
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
    await page.context().close().catch(() => {}); // one game page at a time
    await sandboxAndDevice(browser, url);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--unit')) {
  try {
    await settingsUnit();
  } catch (err) {
    check('settings', false, `the settings module failed to load or threw: ${err.message}`);
  }
  const ok = checks.every((c) => c.ok);
  console.log(ok ? 'UNIT OK' : `UNIT FAILED (${checks.filter((c) => !c.ok).length} check(s))`);
  process.exit(ok ? 0 : 1);
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

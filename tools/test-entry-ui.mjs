// Actual title/camp navigation and file transfer; storage failures are injected only in an owned context.
import { AxeBuilder } from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { completedSnapshot } from '../src/franchise/save.js';
import { probeProgress, progressRaw, seedProgress, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';
import { SAMPLE_ARMY, ARMS } from '../src/reward/data.js';

function fixture(awardId, armyCount = 2, depotCount = 13) {
  const army = Array.from({ length: armyCount }, (_, i) => ({ ...structuredClone(SAMPLE_ARMY[0]), id: `test-brigade-${i}`,
    label: `Practice Formation ${i + 1}`, men: i === 0 ? 0 : 1000, weapon: { ...structuredClone(SAMPLE_ARMY[0].weapon), uid: `equipped-${i}` } }));
  const depot = Array.from({ length: depotCount }, (_, i) => ({ uid: `depot-${i}`, itemId: ARMS[i % ARMS.length].id,
    tier: ARMS[i % ARMS.length].tier, conditionId: i % 2 ? 'worn' : 'serviceable', from: `Stored lot ${i + 1}: fictional practice capture` }));
  return completedSnapshot({ awardId, army, depot, issued: [], seed: 23, grade: 'Victory' });
}
export async function entryProgress({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', hasTouch: true });
  await probeProgress(ctx, { prefix: '__entry', readFlag: '__entryReadBlocked', quotaFlag: '__entryQuota' });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  let requests = [], reads = [], measuring = true;
  page.on('request', (r) => { if (measuring) requests.push(new URL(r.url()).pathname); });
  page.on('response', (r) => { if (measuring && r.url().startsWith(url)) reads.push(r.body().then((b) => b.length).catch(() => 0)); });
  const raw = () => progressRaw(page);
  const load = async (query = '') => { await page.goto(url + query); await page.waitForFunction(() => window.__entry && !window.__entry.importing); };
  const upload = (text, name = 'army.json') => page.locator('#entry-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  const exported = async () => {
    const event = page.waitForEvent('download'); await page.locator('#entry-export').click();
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };
  const original = fixture('entry-original'), replacement = fixture('entry-replacement', 2, 1);
  try {
    const started = Date.now(); await load();
    const bytes = (await Promise.all(reads)).reduce((a, b) => a + b, 0), elapsed = Date.now() - started;
    result.entryLoad = { bytes, elapsedMs: elapsed, requests: [...requests] };
    check('entry-lightweight-title', bytes > 0 && bytes < 5 * 1024 * 1024 && elapsed <= 10000
      && !requests.some((p) => /terrain|vendor\/three|src\/fx\/|assets\/figures/.test(p)), `${bytes} bytes / ${elapsed} ms; no terrain/renderer/effects/atlas request`);
    check('entry-fresh-no-write', await page.evaluate(() => window.__entry.mode === 'title' && !window.__entry.saved
      && window.__entryWrites === 0 && !window.__game && !window.__reward && document.activeElement.id === 'entry-continue'), 'fresh title has one focused Continue; no progress write, renderer or reward mount');
    const titleAxe = await new AxeBuilder({ page }).include('#front').analyze(); result.entryTitleAxe = titleAxe.violations;
    check('entry-title-axe', titleAxe.violations.length === 0, JSON.stringify(titleAxe.violations.map((v) => v.id))); await shot(page, 'entry-title');
    await page.setViewportSize({ width: 320, height: 480 }); await shot(page, 'entry-title-320');
    check('entry-title-narrow', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth
      && [...n.querySelectorAll('button:not([hidden]):not(:disabled),a')].filter((b) => b.getClientRects().length).every((b) => b.getBoundingClientRect().height >= 48)), '320px title wraps and visible controls remain >=48px');
    measuring = false;
    await page.locator('#entry-continue').click(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    check('entry-fresh-continue-intro', await page.evaluate(() => document.getElementById('intro').open && !window.__entry
      && window.__game.game.scenario.practiceIntro && window.__entryWrites === 0), 'fresh Continue reaches the paused real introductory briefing without a save');
    await page.setViewportSize({ width: 1024, height: 768 }); await load();
    await page.evaluate(async (snapshot) => { await window.__progressFixture.seed(JSON.stringify(snapshot)); localStorage.setItem('cw.settings', '{"screens.cardStyle":"clean modern"}'); localStorage.setItem('cw.locks', '["screens.cardStyle"]'); }, original);
    await page.reload(); await page.waitForFunction(() => window.__entry?.saved);
    const before = await raw(), prefs = await page.evaluate(() => [localStorage.getItem('cw.settings'), localStorage.getItem('cw.locks')]);
    await page.setViewportSize({ width: 320, height: 480 }); await holdProgressTransaction(page);
    await page.locator('#entry-continue').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__entry.importing);
    check('entry-delayed-read-feedback', await page.evaluate(() => document.getElementById('entry-status').textContent.includes('Loading saved progress')
      && document.activeElement.id === 'entry-status' && document.getElementById('entry-continue').disabled
      && (() => { const r = document.activeElement.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; })()),
      'native delayed Continue read focuses a visible Loading status at320px and prevents repeated navigation');
    await shot(page, 'entry-loading-320');
    await releaseProgressTransaction(page); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    check('entry-read-settlement-visible', await page.evaluate(() => document.activeElement.id === 'camp-practice'
      && (() => { const r = document.activeElement.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; })()),
      'completed read/navigation scrolls the focused Practice action into view at320px');
    await shot(page, 'entry-loaded-focus-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    check('entry-saved-continue-camp', await raw() === before && await page.evaluate(() => window.__entryWrites === 0
      && window.__entry.saved.awardId === 'entry-original' && !window.__game && !window.__reward && document.activeElement.id === 'camp-practice'), 'saved Continue opens camp without writes/rolls and focuses a visible next action');
    check('entry-real-army-depot', await page.locator('#camp-army [data-brigade-id]').count() === 2
      && await page.locator('#camp-army').textContent().then((s) => s.includes('Depleted'))
      && await page.locator('#camp-depot [data-item-uid]').count() === 12
      && await page.locator('#camp-depot').textContent().then((s) => s.includes('Stored lot 1') && s.includes('Serviceable') && s.includes('Worn')), 'actual equipment, depleted identity, full conditions/provenance and 12 of 13 depot cards');
    const accessibleItem = await page.locator('#camp-depot [data-item-uid]').first().ariaSnapshot();
    check('entry-depot-accessible-details', accessibleItem.includes('Stored lot 1') && accessibleItem.includes('yd range') && accessibleItem.includes('Arms'),
      'accessible depot tree includes visible provenance, range and arms statistics; card is not atomic image text');
    await page.getByRole('button', { name: 'Next depot cards', exact: true }).click();
    check('entry-depot-paging', await page.locator('#camp-depot [data-item-uid]').count() === 1
      && await page.locator('#camp-depot [data-item-uid]').getAttribute('data-item-uid') === 'depot-12'
      && await page.getByRole('button', { name: 'Previous depot cards', exact: true }).evaluate((n) => n === document.activeElement), 'final depot page contains the thirteenth unique item and retains paging focus');
    await page.getByRole('button', { name: 'Previous depot cards', exact: true }).click();
    const campAxe = await new AxeBuilder({ page }).include('#front').analyze(); result.entryCampAxe = campAxe.violations;
    check('entry-camp-axe', campAxe.violations.length === 0, JSON.stringify(campAxe.violations.map((v) => v.id)));
    await page.locator('#camp-practice').scrollIntoViewIfNeeded(); await shot(page, 'entry-camp');
    await page.locator('#camp-depot [data-item-uid]').first().scrollIntoViewIfNeeded(); await shot(page, 'entry-depot');
    await page.setViewportSize({ width: 320, height: 480 }); await page.locator('#camp-practice').scrollIntoViewIfNeeded(); await shot(page, 'entry-camp-320');
    check('entry-camp-narrow', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth)
      && await page.locator('#camp-army .rw-bweap-name, #camp-army .rw-bname').evaluateAll((ns) => ns.every((n) => n.scrollWidth <= n.clientWidth + 1)), '320px camp, distinguishable formation names and full equipped names have no horizontal clipping');
    await page.locator('#camp-depot [data-item-uid]').first().scrollIntoViewIfNeeded(); await shot(page, 'entry-depot-320');
    check('entry-export-exact', JSON.stringify(await exported()) === JSON.stringify(original), 'actual downloaded camp export preserves the completed snapshot');
    await upload('{broken');
    await page.waitForFunction(() => document.getElementById('entry-status').textContent.includes('file is not valid JSON'));
    check('entry-invalid-import', await raw() === before && !await page.locator('#entry-replace').evaluate((n) => n.open), 'invalid file leaves exact progress unchanged before confirmation');
    await upload(JSON.stringify(replacement)); await page.waitForFunction(() => document.getElementById('entry-replace').open);
    const cancel = await page.locator('#entry-cancel').evaluate((n) => n === document.activeElement);
    await page.keyboard.press('Shift+Tab'); const wrap = await page.locator('#entry-confirm').evaluate((n) => n === document.activeElement);
    const importAxe = await new AxeBuilder({ page }).include('#entry-replace').analyze(); result.entryImportAxe = importAxe.violations;
    check('entry-import-axe', importAxe.violations.length === 0, JSON.stringify(importAxe.violations.map((v) => v.id))); await shot(page, 'entry-import-320');
    // Native close is queued. Delay only its notification in this owned context to exercise the
    // busy interval deterministically; a file selection before cleanup is intentionally ignored.
    await page.evaluate(() => {
      const dialog = document.getElementById('entry-replace');
      const delay = (e) => {
        dialog.removeEventListener('close', delay, true); e.stopImmediatePropagation();
        setTimeout(() => dialog.dispatchEvent(new Event('close')), 150);
      };
      dialog.addEventListener('close', delay, true);
    });
    await page.keyboard.press('Escape');
    result.entryCancelState = await page.evaluate(() => ({ open: document.getElementById('entry-replace').open,
      busy: document.getElementById('entry-import').disabled, focus: document.activeElement.id, writes: window.__entryWrites }));
    await page.waitForFunction(() => !document.getElementById('entry-replace').open && !document.getElementById('entry-import').disabled
      && document.activeElement.id === 'entry-import');
    check('entry-import-cancel-focus', cancel && wrap && await raw() === before && await page.locator('#entry-import').evaluate((n) => n === document.activeElement), 'Cancel focused, Tab trapped, Escape preserves bytes and returns focus');
    await upload(JSON.stringify(replacement)); await page.locator('#entry-confirm').click();
    await page.waitForFunction(() => window.__entry.saved.awardId === 'entry-replacement');
    check('entry-import-replaces-once', JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(replacement)
      && await page.evaluate(() => window.__entryWrites === 1), 'confirmed file import replaces the complete army/depot once; no merge');
    const valid = await raw();
    await page.evaluate(() => { window.__entryQuota = true; }); await upload(JSON.stringify(original)); await page.locator('#entry-confirm').click();
    await page.waitForFunction(() => !!window.__entry.pending && !window.__entry.importing
      && document.getElementById('entry-status').textContent.includes('could not save'));
    check('entry-quota-retains-export', await raw() === valid && JSON.stringify(await exported()) === JSON.stringify(original), 'quota failure retains old bytes and exports the exact pending import');
    await upload(JSON.stringify(replacement), 'other-army.json'); await page.locator('#entry-cancel').click();
    await page.waitForFunction(() => !document.getElementById('entry-import').disabled);
    await page.evaluate(() => { window.__entryQuota = false; }); await page.locator('#entry-retry').click(); await page.waitForFunction(() => document.getElementById('entry-replace').open);
    check('entry-quota-retry-confirms', await page.locator('#entry-cancel').evaluate((n) => n === document.activeElement), 'retry imports request current explicit replacement authority again');
    check('entry-retry-consent-pending-file', await page.locator('#entry-replace-note').textContent().then((s) => s.includes('Import army.json:') && s.includes('13 depot cards') && !s.includes('other-army.json')),
      'failed A / cancelled B / Retry describes the pending A file and inventory, not cancelled B');
    await page.locator('#entry-confirm').click(); await page.waitForFunction(() => window.__entry.saved.awardId === 'entry-original' && !window.__entry.pending);
    check('entry-quota-retry-exact', JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(original), 'retry saves the same validated import without changing identities');
    await load();
    await page.evaluate(() => { window.__entryReadBlocked = true; }); await page.locator('#entry-continue').click(); await page.waitForFunction(() => !window.__entry.importing);
    check('entry-blocked-read-no-fresh', await page.evaluate(() => window.__entry.failed && !window.__game && !window.__reward)
      && await page.locator('#entry-continue').isDisabled(), 'visible title Continue re-read prevents silent fresh navigation/roll and exposes recovery');
    await page.evaluate(() => { window.__entryReadBlocked = false; }); await page.locator('#entry-retry').click(); await page.waitForFunction(() => !window.__entry.importing);
    check('entry-read-retry', await raw() === before && await page.evaluate(() => !window.__entry.failed && window.__entry.saved.awardId === 'entry-original'), 'retry reloads existing army without changing progress');
    await seedProgress(page, '{corrupt'); await load();
    check('entry-corrupt-read-no-fresh', await page.evaluate(() => window.__entry.failed && !window.__reward && !window.__game)
      && await page.locator('#entry-continue').isDisabled(), 'corrupt initial progress never falls through to a fresh army');
    await upload(JSON.stringify(replacement)); await page.locator('#entry-confirm').click();
    await page.waitForFunction(() => window.__entry.saved?.awardId === 'entry-replacement' && !window.__entry.failed);
    check('entry-corrupt-import-recovery', JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(replacement), 'explicit valid import repairs corrupt progress atomically');
    const large = fixture('entry-large', 200, 2000); await seedProgress(page, JSON.stringify(large));
    requests = []; reads = []; measuring = true; await load('?camp'); measuring = false;
    check('entry-legal-large-bound', await page.locator('#camp-army [data-brigade-id]').count() === 12 && await page.locator('#camp-depot [data-item-uid]').count() === 12
      && await page.evaluate(() => window.__entry.saved.army.length === 200 && window.__entry.saved.depot.length === 2000 && window.__entryWrites === 0), 'legal maximum inventory renders only 12 brigade + 12 depot cards without a write');
    await page.getByRole('button', { name: 'Next brigades', exact: true }).click(); await page.keyboard.press('Enter');
    check('entry-pagination-repeat-key', await page.locator('#camp-army [data-brigade-id]').first().getAttribute('data-brigade-id') === 'test-brigade-24'
      && await page.getByRole('button', { name: 'Next brigades', exact: true }).evaluate((n) => n === document.activeElement), 'repeated Enter continues forward with stable paging controls instead of bouncing backward');
    check('entry-lightweight-camp', !requests.some((p) => /terrain|vendor\/three|src\/fx\/|assets\/figures/.test(p))
      && (await Promise.all(reads)).reduce((a, b) => a + b, 0) < 5 * 1024 * 1024, 'camp requests stay below 5 MB with no battlefield resources');
    check('entry-preferences-intact', JSON.stringify(await page.evaluate(() => [localStorage.getItem('cw.settings'), localStorage.getItem('cw.locks')])) === JSON.stringify(prefs), 'navigation/import/recovery preserve preferences and locks exactly');
    // Deferred File.text makes overlapping requests deterministic; no source or user storage mutation.
    await page.evaluate(() => {
      const text = File.prototype.text; window.__entryFileText = text; window.__entryReadQueue = [];
      File.prototype.text = function () { return this.name.startsWith('race-')
        ? new Promise((resolve) => window.__entryReadQueue.push({ file: this, resolve })) : text.call(this); };
    });
    const largeRaw = await raw();
    await page.locator('#entry-file').setInputFiles({ name: 'race-first.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
    await page.waitForFunction(() => window.__entryReadQueue.length === 1);
    await page.locator('#entry-file').setInputFiles({ name: 'race-second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
    check('entry-import-serialized-read', await raw() === largeRaw && await page.evaluate(() => window.__entryReadQueue.length === 1 && window.__entryWrites === 0)
      && await page.locator('#entry-import').isDisabled(), 'one deferred file read owns import until consent/write; overlapping file selection cannot join it');
    await page.evaluate(async () => { const q = window.__entryReadQueue[0]; q.resolve(await window.__entryFileText.call(q.file)); });
    await page.waitForFunction(() => document.getElementById('entry-replace').open);
    check('entry-import-exact-consent', await page.locator('#entry-replace-note').textContent().then((s) => s.includes('race-first.json') && !s.includes('race-second.json')),
      'confirmation identifies the sole selected file rather than sharing authority across requests');
    await page.locator('#entry-confirm').click();
    await page.waitForFunction(() => window.__entry.saved.awardId === 'entry-original' && !document.getElementById('entry-import').disabled);
    check('entry-import-single-write', await page.evaluate(() => window.__entryWrites === 1) && JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(original),
      'one consent performs exactly one complete write; ignored later file cannot overwrite it');
    check('entry-no-console-errors', errors.length === 0, errors.join('\n') || '0 errors');
  } finally { await ctx.close(); }
}

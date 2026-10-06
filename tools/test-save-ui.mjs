// Real same-origin two-tab IndexedDB transactions; owned contexts only.
import { AxeBuilder } from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { SAMPLE_ARMY } from '../src/reward/data.js';
import { completedSnapshot, exchangeDepot } from '../src/franchise/save.js';

import { probeProgress, progressRaw, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';
const fixture = (awardId) => completedSnapshot({ awardId, army: structuredClone(SAMPLE_ARMY),
  depot: [{ ...structuredClone(SAMPLE_ARMY[1].weapon), uid: 'save-ui-spare', from: 'Fictional test crate', source: 'capture' }],
  issued: [], seed: 19, grade: 'Victory' });
const command = (s) => ({ brigadeId: s.army[0].id, itemUid: s.depot[0].uid });

async function migrationProof(page, check, before, newer) {
  const checks = await page.evaluate(async ({ before, newer }) => {
    const { createProgressStore } = await import('./src/franchise/save.js');
    const store = createProgressStore(), fixture = window.__progressFixture, results = [];
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const bind = (name, ok, note) => results.push({ name, ok, note });
    const rejected = async (run) => { try { await run(); return false; } catch (e) { return e.message.startsWith('Progress:'); } };
    const absent = async () => await fixture.record() === undefined;
    bind('save-db-empty-read', await store.load() === null && await store.readRawBaseline() === null
      && await absent() && window.__progressPuts === 0, 'empty reads create no progress record or put');
    fixture.legacy(JSON.stringify(before));
    const duplicate = await store.complete(before);
    bind('save-db-legacy-read-duplicate', equal(await store.load(), before) && duplicate.duplicate
      && await absent() && window.__progressPuts === 0, 'legacy valid read and repeated award do not seal or rewrite authority');
    window.__saveQuota = true;
    const failed = await rejected(() => store.complete(newer, { previous: before })); window.__saveQuota = false;
    bind('save-db-failed-adoption', failed && await absent() && fixture.legacyRaw() === JSON.stringify(before)
      && window.__saveWrites === 0, 'failed first write preserves untouched legacy and absent database record');
    fixture.legacy(JSON.stringify(newer));
    bind('save-db-unsealed-reread', equal(await store.load(), newer) && await absent(), 'failed adoption leaves later legacy bytes observable');
    await store.import(JSON.stringify(before), { previousRaw: await store.readRawBaseline() });
    const sealed = await fixture.record(), count = window.__saveWrites;
    fixture.legacy('{changed-legacy'); window.__progressLegacyBlocked = true;
    bind('save-db-sealed-authority', equal(await store.load(), before) && await store.readRawBaseline() === sealed
      && window.__saveWrites === count, 'committed record ignores later legacy changes and denied legacy access');
    window.__progressLegacyBlocked = false;
    await fixture.seed('{database-corrupt'); fixture.legacy(JSON.stringify(newer));
    bind('save-db-corrupt-no-fallback', await rejected(() => store.load()) && await store.readRawBaseline() === '{database-corrupt'
      && window.__saveWrites === count, 'existing corrupt database record never falls back to valid legacy');
    let malformed = true; const malformedPuts = window.__progressPuts;
    for (const value of [null, undefined, 3, { unexpected: true }]) {
      await fixture.seed(value);
      malformed &&= await rejected(() => store.load()) && await rejected(() => store.complete(before))
        && equal(await fixture.record(), value) && await fixture.present() === 1 && window.__saveWrites === count && window.__progressPuts === malformedPuts;
    }
    bind('save-db-malformed-record', malformed, 'existing null/undefined/number/object records reject without treating corruption as an empty baseline');
    await fixture.seed('{database-corrupt');
    await store.import(JSON.stringify(before), { previousRaw: '{database-corrupt' });
    bind('save-db-corrupt-repair', equal(await store.load(), before), 'explicit unchanged raw baseline repairs corrupt database record');
    await fixture.clear(); fixture.legacy('{legacy-corrupt');
    const puts = window.__progressPuts;
    bind('save-db-corrupt-legacy-read', await rejected(() => store.load()) && await store.readRawBaseline() === '{legacy-corrupt'
      && await absent() && window.__progressPuts === puts, 'corrupt legacy remains untouched and unadopted on reads');
    window.__progressLegacyBlocked = true;
    bind('save-db-blocked-legacy-read', await rejected(() => store.load()) && await rejected(() => store.complete(newer))
      && await absent() && window.__progressPuts === puts, 'denied legacy bootstrap grants no empty baseline or write');
    window.__progressLegacyBlocked = false; fixture.legacy(null);
    window.__progressAbortPut = true;
    const abortWrites = window.__saveWrites, abortPuts = window.__progressPuts;
    const aborted = await rejected(() => store.complete(before)); window.__progressAbortPut = false;
    bind('save-db-first-put-abort', aborted && await absent() && window.__saveWrites === abortWrites
      && window.__progressPuts === abortPuts + 1, 'successful put request followed by abort rolls back and never reports saving');
    await store.complete(before); const raw = await fixture.record();
    window.__progressAbortPut = true; const commits = window.__saveWrites;
    const rollback = await rejected(() => store.complete(newer, { previous: before })); window.__progressAbortPut = false;
    bind('save-db-existing-put-abort', rollback && await fixture.record() === raw && window.__saveWrites === commits,
      'aborted update preserves exact committed bytes and no successful-write receipt');
    window.__progressRequestFailure = true; const failurePuts = window.__progressPuts;
    const requestFailure = await rejected(() => store.complete(newer, { previous: before })); window.__progressRequestFailure = false;
    bind('save-db-async-request-failure', requestFailure && await fixture.record() === raw && window.__saveWrites === commits
      && window.__progressPuts === failurePuts + 1 && window.__progressFailureName === 'ConstraintError',
      'real asynchronous ConstraintError request aborts the transaction without replacing committed bytes');
    window.__progressOpenBlocked = true;
    bind('save-db-open-denied', await rejected(() => store.load()) && await rejected(() => store.complete(newer, { previous: before }))
      && await fixture.record() === raw, 'denied database open has no fallback writer or erased record');
    window.__progressOpenBlocked = false;
    await store.complete(newer, { previous: before });
    bind('save-db-open-retry', equal(await store.load(), newer), 'failed open does not poison later explicit retry');
    await fixture.blockUpgrade(); window.__progressBlockedUpgrade = true;
    bind('save-db-open-blocked-event', await rejected(() => store.load()), 'real blocked upgrade event rejects the pending open');
    window.__progressBlockedUpgrade = false; fixture.releaseUpgrade();
    // The test requested v2 only to deliver a real blocked event; restore this owned database.
    await fixture.resetDatabase(); fixture.legacy(JSON.stringify(newer)); window.__progressUpgradeFailure = true;
    bind('save-db-upgrade-abort', await rejected(() => store.load()) && fixture.legacyRaw() === JSON.stringify(newer),
      'failed object-store creation aborts upgrade without erasing legacy progress');
    window.__progressUpgradeFailure = false;
    bind('save-db-upgrade-retry', equal(await store.load(), newer) && await absent(), 'failed upgrade remains retryable and read never adopts a record');
    fixture.legacy(null);
    bind('save-db-legacy-zero-writes', window.__progressLegacyWrites === 0 && fixture.legacyRaw() === null,
      'all product reads/writes leave legacy storage untouched');
    await fixture.clear(); fixture.legacy(JSON.stringify(before));
    window.__saveWrites = 0; window.__progressPuts = 0;
    return results;
  }, { before, newer });
  for (const row of checks) check(row.name, row.ok, row.note);
}

export async function saveCoordination({ browser, url, check, shot, result, watchErrors, trace = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', acceptDownloads: true });
  await probeProgress(ctx, { prefix: '__save', readFlag: '__saveReadBlocked', quotaFlag: '__saveQuota' });
  const a = await ctx.newPage(), b = await ctx.newPage(), errors = [];
  watchErrors(a, url, errors); watchErrors(b, url, errors);
  const queued = async (page, id, kind, input, options) => {
    await page.evaluate(async ({ id, kind, input, options }) => {
      const { createProgressStore } = await import('./src/franchise/save.js');
      const store = createProgressStore(); window.__saveOps ||= {}; window.__saveOps[id] = { settled: false };
      store[kind](input, options).then((value) => { window.__saveOps[id] = { settled: true, ok: true, value }; },
        (error) => { window.__saveOps[id] = { settled: true, ok: false, message: error.message }; });
    }, { id, kind, input, options });
  };
  let queueBase = 0;
  const transactions = async () => await a.evaluate(() => window.__progressTransactions) + await b.evaluate(() => window.__progressTransactions);
  const hold = async () => { await holdProgressTransaction(a); queueBase = await transactions(); };
  // Wait only for observed native transaction creation; never wait for cache propagation after commit.
  const pending = async (count) => {
    const deadline = Date.now() + 10000;
    while (await transactions() < queueBase + count && Date.now() < deadline) await a.waitForTimeout(10);
    if (await transactions() !== queueBase + count) throw new Error('Unexpected progress transaction queue');
  };
  const receipt = async (page, id) => { await page.waitForFunction((key) => window.__saveOps[key].settled, id); return page.evaluate((key) => window.__saveOps[key], id); };
  const raw = () => progressRaw(a);
  const writes = async () => await a.evaluate(() => window.__saveWrites) + await b.evaluate(() => window.__saveWrites);
  const upload = (text, name = 'queued-army.json') => b.locator('#entry-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  const exported = async () => { const download = b.waitForEvent('download'); await b.locator('#entry-export').click(); return readFile(await (await download).path(), 'utf8'); };
  const before = fixture('save-ui-original'), newer = fixture('save-ui-newer');
  try {
    await a.goto(url); await a.waitForFunction(() => window.__entry);
    await migrationProof(a, check, before, newer);
    await a.reload(); await a.waitForFunction(() => window.__entry?.saved);
    await b.goto(url); await b.waitForFunction(() => window.__entry?.saved);
    const originalRaw = await raw();
    await hold();
    await queued(a, 'issue', 'issue', command(before), { previous: before }); await pending(1);
    await queued(b, 'import', 'import', JSON.stringify(newer), { previousRaw: originalRaw }); await pending(2);
    check('save-real-tabs-blocked', await writes() === 0 && await a.evaluate((raw) => window.__saveHeldRaw === undefined || window.__saveHeldRaw === raw, originalRaw)
      && await a.evaluate(() => !window.__saveOps.issue.settled) && await b.evaluate(() => !window.__saveOps.import.settled), 'two real tabs wait behind one real cw.progress readwrite transaction');
    await releaseProgressTransaction(a);
    const issue = await receipt(a, 'issue'), imported = await receipt(b, 'import'), edited = exchangeDepot(before, command(before));
    check('save-real-tabs-one-winner', issue.ok && !imported.ok && imported.message.includes('changed') && await writes() === 1
      && await raw() === JSON.stringify(edited), 'queued issue commits once; other-tab stale import rejects without overwriting it');
    await queued(b, 'duplicate', 'complete', before, { previous: null }); const duplicate = await receipt(b, 'duplicate');
    check('save-real-tabs-same-award', duplicate.ok && duplicate.value.duplicate && JSON.stringify(duplicate.value.snapshot) === JSON.stringify(edited)
      && await writes() === 1, 'same-award completion returns actual equipment edits and writes nothing');
    const editedRaw = await raw();
    await hold();
    await queued(a, 'first-import', 'import', JSON.stringify(newer), { previousRaw: editedRaw }); await pending(1);
    await queued(b, 'stale-complete', 'complete', fixture('save-ui-third'), { previous: edited }); await pending(2);
    await queued(b, 'stale-issue', 'issue', { brigadeId: edited.army[0].id, itemUid: before.army[0].weapon.uid }, { previous: edited }); await pending(3);
    await releaseProgressTransaction(a);
    const firstImport = await receipt(a, 'first-import'), staleComplete = await receipt(b, 'stale-complete'), staleIssue = await receipt(b, 'stale-issue');
    check('save-real-tabs-import-wins', firstImport.ok && !staleComplete.ok && !staleIssue.ok && staleComplete.message.includes('changed')
      && staleIssue.message.includes('changed') && await writes() === 2 && await raw() === JSON.stringify(newer), 'confirmed import wins; stale other-tab completion and exchange both reject');

    // Actual import consent and visible waiting state. Its baseline predates the other tab's exchange.
    await b.reload(); await b.waitForFunction((awardId) => window.__entry?.saved?.awardId === awardId, newer.awardId);
    await b.setViewportSize({ width: 320, height: 480 });
    await upload(JSON.stringify(before)); await b.waitForFunction(() => document.getElementById('entry-replace').open);
    await hold();
    await queued(a, 'ui-exchange', 'issue', command(newer), { previous: newer }); await pending(1);
    await b.locator('#entry-confirm').click(); await pending(2);
    await b.waitForFunction(() => document.getElementById('entry-status').textContent.includes('Saving the imported'));
    const countBefore = await writes();
    check('save-ui-queued-owner', await b.evaluate(() => document.getElementById('front').getAttribute('aria-busy') === 'true'
      && document.getElementById('entry-import').disabled && document.getElementById('entry-retry').disabled
      && document.getElementById('entry-continue').disabled && !document.getElementById('entry-export').disabled
      && document.activeElement.id === 'entry-status' && (() => { const r = document.activeElement.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; })()), 'visible waiting status owns focus at320px; mutators disabled and pending export enabled');
    await shot(b, 'save-import-waiting-320');
    check('save-ui-queued-export', JSON.stringify(JSON.parse(await exported())) === JSON.stringify(before) && await writes() === countBefore,
      'actual pending import download remains available without acquiring the write transaction');
    await upload(JSON.stringify(newer), 'ignored-overlap.json');
    check('save-ui-queued-overlap', await b.evaluate(() => JSON.parse(window.__entry.pending).awardId === 'save-ui-original')
      && await transactions() === queueBase + 2, 'overlapping file selection cannot replace the pending command or queue another writer');
    const axe = await new AxeBuilder({ page: b }).include('#front').analyze(); result.saveWaitingAxe = axe.violations;
    check('save-ui-waiting-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id)));
    check('save-ui-export-waiting-copy', await b.locator('#entry-status').textContent().then((t) => t.includes('Saving is still waiting') && !t.includes('retry')), 'export during a queued write continues to report waiting rather than a failed save');
    await releaseProgressTransaction(a); const uiExchange = await receipt(a, 'ui-exchange');
    await b.waitForFunction(() => !window.__entry.importing);
    const current = exchangeDepot(newer, command(newer)), currentRaw = JSON.stringify(current);
    result.saveUIStaleState = { exchange: uiExchange, actualRaw: await raw(), expectedRaw: currentRaw,
      ui: await b.evaluate(() => ({ saved: window.__entry.saved?.awardId, pending: window.__entry.pending,
        busy: window.__entry.importing, status: document.getElementById('entry-status').textContent, focus: document.activeElement.id })) };
    if (trace) result.saveTrace = { a: await a.evaluate(() => ({ events: window.__progressTrace, controller: !!navigator.serviceWorker.controller })),
      b: await b.evaluate(() => ({ events: window.__progressTrace, controller: !!navigator.serviceWorker.controller })) };
    const staleOk = uiExchange.ok && result.saveUIStaleState.actualRaw === currentRaw
      && result.saveUIStaleState.ui.status.includes('changed') && result.saveUIStaleState.ui.focus === 'entry-import';
    check('save-ui-consent-stale', staleOk, JSON.stringify(result.saveUIStaleState));
    if (!staleOk) return; // Preserve the failing gate; don't mask it with a missing Retry timeout.
    const retryWrites = await writes();
    await b.locator('#entry-retry').click(); await b.locator('#entry-confirm').click(); await b.waitForFunction(() => !window.__entry.importing);
    check('save-ui-retry-no-rebase', await raw() === currentRaw && await writes() === retryWrites
      && await b.locator('#entry-status').textContent().then((t) => t.includes('changed')), 'Retry retains the original raw baseline and rejects again without silent replacement');
    await upload(JSON.stringify(before)); await b.locator('#entry-confirm').click(); await b.waitForFunction(() => !window.__entry.importing && !window.__entry.pending);
    check('save-ui-fresh-consent', await raw() === JSON.stringify(before) && await writes() === retryWrites + 1, 'choosing the file afresh and confirming observes the new baseline and replaces once');

    await b.evaluate(() => { window.__saveReadBlocked = true; }); await upload(JSON.stringify(newer), 'blocked-read.json');
    await b.waitForFunction(() => !window.__entry.importing && !!window.__entry.pending);
    check('save-ui-blocked-baseline-export', JSON.stringify(JSON.parse(await exported())) === JSON.stringify(newer)
      && !await b.locator('#entry-replace').evaluate((n) => n.open) && await raw() === JSON.stringify(before), 'failed baseline read retains validated file for export but grants no consent or write');
    await b.evaluate(() => { window.__saveReadBlocked = false; }); await hold(); await b.locator('#entry-retry').click();
    await b.waitForFunction(() => window.__entry.importing && document.getElementById('entry-status').textContent.includes('Loading saved progress'));
    check('save-ui-delayed-read-feedback', await b.evaluate(() => document.activeElement.id === 'entry-status'
      && (() => { const r = document.activeElement.getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; })()),
      'pending import baseline read focuses a visible Loading status at320px');
    await shot(b, 'save-import-reading-320');
    await exported();
    check('save-ui-export-reading-copy', await b.locator('#entry-status').textContent().then((text) => text.includes('Review is still in progress') && !text.includes('Saving')),
      'pending file export during a baseline read describes review before any saving or consent');
    await releaseProgressTransaction(a); await b.waitForFunction(() => document.getElementById('entry-replace').open);
    check('save-ui-baseline-recovery-consent', await b.locator('#entry-replace').evaluate((n) => n.open)
      && await b.locator('#entry-replace-note').textContent().then((t) => t.includes('blocked-read.json')), 'first successful baseline read still requires explicit consent for the retained file');
    await b.locator('#entry-confirm').click(); await b.waitForFunction(() => !window.__entry.importing && !window.__entry.pending);
    check('save-ui-baseline-recovery-write', await raw() === JSON.stringify(newer), 'confirmed recovered baseline saves the original validated file');
    check('save-no-console-errors', errors.length === 0, errors.join(' | ') || '0 errors');
  } finally {
    await a.evaluate(() => { window.__saveReleaseRequested = true; }).catch(() => {});
    await ctx.close();
  }
}

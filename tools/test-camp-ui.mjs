// P2j2: real camp controls, database readbacks and recoveries in an owned browser context.
import { AxeBuilder } from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { completedSnapshot, validateSnapshot, exchangeDepot, exportSnapshot, MAX_SAVE_BYTES } from '../src/franchise/save.js';
import { SAMPLE_ARMY } from '../src/reward/data.js';
import { compare, bestFit } from '../src/reward/model.js';
import { probeProgress, progressRaw, seedProgress, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';

function fixture({ large = false, unavailable = false } = {}) {
  const army = structuredClone(SAMPLE_ARMY);
  army[0].label = 'Fictional practice formation '.padEnd(160, 'Long name ');
  army[1].men = 0;
  army.find((b) => b.id === 'bB').guns = 0;
  const depot = Array.from({ length: large ? 2000 : 13 }, (_, i) => ({
    uid: `camp-depot-${i}`, itemId: i % 2 ? 'napoleon' : 'henry', tier: i % 2 ? 'rare' : 'legendary',
    conditionId: 'serviceable', source: 'capture', from: 'Fictional practice stores '.padEnd(160, 'Long source '),
  }));
  if (large) for (let i = army.length; i < 200; i++) army.push({ ...structuredClone(army[0]), id: `camp-formation-${i}`, weapon: { ...army[0].weapon, uid: `camp-equipped-${i}` } });
  if (unavailable) army.forEach((b) => { b.men = 0; });
  return completedSnapshot({ awardId: 'camp-original', army, depot, issued: [], seed: 29, grade: 'Victory' });
}
function limitFixture(bytes = false) {
  const before = fixture({ large: bytes }), old = before.army[0].weapon.uid, selected = before.depot[0].uid;
  before.issued = Array.from({ length: bytes ? 3000 : 5000 }, (_, i) => ({ brigade: 'b1', item: i % 2 ? old : selected, displaced: i % 2 ? selected : old }));
  if (bytes) {
    for (const it of [...before.army.map((b) => b.weapon), ...before.depot]) it.from = 'x';
    let remaining = MAX_SAVE_BYTES - 16 - new TextEncoder().encode(exportSnapshot(before)).length;
    if (remaining <= 0) throw new Error('camp limit fixture already too large');
    for (const it of before.depot) {
      const unicode = Math.min(159, Math.floor(remaining / 3)); it.from += '界'.repeat(unicode); remaining -= unicode * 3;
      const ascii = Math.min(160 - it.from.length, remaining); it.from += 'x'.repeat(ascii); remaining -= ascii;
    }
    if (remaining !== 0) throw new Error('camp near-limit fixture did not reach its bound');
  }
  return validateSnapshot(before);
}
export async function campEquipment({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 480 }, reducedMotion: 'reduce', hasTouch: true });
  await probeProgress(ctx, { prefix: '__camp', readFlag: '__campReadBlocked', quotaFlag: '__campQuota' });
  const page = await ctx.newPage(), errors = [], requests = [];
  watchErrors(page, url, errors); page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  const raw = () => progressRaw(page);
  const idle = () => page.waitForFunction(() => window.__entry && !window.__entry.importing);
  const open = async (uid = 'camp-depot-0') => {
    await page.locator(`[data-item-uid="${uid}"] .camp-compare-button`).press('Enter');
    await page.waitForFunction(() => document.getElementById('camp-compare').open);
  };
  const download = async (selector = '#entry-export') => {
    const event = page.waitForEvent('download'); await page.locator(selector).click();
    return await readFile(await (await event).path(), 'utf8');
  };
  const upload = (target, text) => target.locator('#entry-file').setInputFiles({ name: 'camp-army.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  const importReviewed = async (target, snapshot) => {
    const text = exportSnapshot(snapshot);
    await upload(target, text);
    // File.text and the baseline transaction settle before native consent exists. press() alone
    // can target a hidden button and send Enter to Cancel; bind the actual dialog first.
    await target.waitForFunction(({ army, depot }) => document.getElementById('entry-replace').open && window.__entry.importing
      && document.getElementById('entry-replace-note').textContent.includes(`Import camp-army.json: ${army} formations and ${depot} depot cards.`),
    { army: snapshot.army.length, depot: snapshot.depot.length });
    await target.locator('#entry-confirm').focus();
    if (!await target.locator('#entry-confirm').evaluate((n) => n === document.activeElement)) throw new Error('camp confirmation did not acquire actual focus');
    await target.locator('#entry-confirm').press('Enter');
    await target.waitForFunction((expected) => !window.__entry.importing && JSON.stringify(window.__entry.saved) === expected
      && document.getElementById('entry-status').textContent === 'Imported and saved army.', text);
  };
  const seed = async (snapshot) => { await seedProgress(page, exportSnapshot(snapshot)); await page.goto(url + '?camp'); await idle(); };
  const visibleFocus = () => page.evaluate(() => {
    const n = document.activeElement, r = n.getBoundingClientRect();
    return n.isConnected && r.height > 0 && r.y >= 0 && r.bottom <= innerHeight;
  });
  const original = fixture(), originalRaw = exportSnapshot(original), command = { brigadeId: 'b1', itemUid: 'camp-depot-0' }, expected = exchangeDepot(original, command);
  try {
    await page.goto(url + '?camp'); await idle(); await seed(original);
    await page.evaluate(() => { localStorage.setItem('cw.settings', '{"screens.cardStyle":"clean modern"}'); localStorage.setItem('cw.locks', '["screens.cardStyle"]'); });
    check('camp-read-only-start', await raw() === originalRaw && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0 && !window.__game && !window.__reward), 'camp readback mounts no renderer/reward and makes no database put');
    await open();
    const recommended = bestFit(original.army, original.depot[0]);
    check('camp-best-fit-eligibility', await page.locator('#camp-recipient').inputValue() === recommended.id
      && JSON.stringify(await page.locator('#camp-recipient option').evaluateAll((ns) => ns.map((n) => n.value))) === JSON.stringify(original.army.filter((b) => compare(b, original.depot[0]).ok).map((b) => b.id)), 'default recommends greatest OVR change; depleted/wrong-kind formations excluded');
    await page.locator('#camp-recipient').selectOption('b1');
    const comparison = compare(original.army[0], original.depot[0]);
    check('camp-actual-comparison', JSON.stringify(await page.locator('#camp-ratings tbody tr').evaluateAll((ns) => ns.map((n) => [...n.querySelectorAll('td')].map((c) => Number(c.textContent)))))
      === JSON.stringify(['ovr', 'arms', 'fire', 'melee', 'morale', 'drill'].map((k) => [comparison.before[k], comparison.after[k], comparison.delta[k]])), 'actual table displays all six before/after/delta ratings for selected identity');
    check('camp-full-labels', await page.locator('#camp-recipient-name').textContent().then((s) => s.includes(original.army[0].label))
      && await page.locator('#camp-compare').evaluate((n) => n.scrollWidth <= n.clientWidth && [...n.querySelectorAll('p,h2')].every((p) => p.scrollWidth <= p.clientWidth + 1)), 'legal160-character brigade name wraps fully in320px modal');
    await page.locator('#camp-compare-heading').focus(); await shot(page, 'camp-compare-top-320');
    await page.keyboard.press('Shift+Tab');
    check('camp-reverse-focus', await page.locator('#camp-issue').evaluate((n) => n === document.activeElement) && await visibleFocus(), 'Shift+Tab from modal heading reaches a visible Issue action');
    await shot(page, 'camp-compare-actions-320');
    let trapped = true, visible = true;
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); trapped &&= await page.evaluate(() => document.getElementById('camp-compare').contains(document.activeElement)); visible &&= await visibleFocus(); }
    check('camp-keyboard-loop', trapped && visible, '12 actual Tab steps stay within modal and scroll each focus into view');
    const axe = await new AxeBuilder({ page }).include('#camp-compare').analyze(); result.campCompareAxe = axe.violations;
    check('camp-comparison-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id)));
    await page.keyboard.press('Escape'); await idle();
    check('camp-escape-zero-write-focus', await raw() === originalRaw && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0 && document.activeElement.classList.contains('camp-compare-button')) && await visibleFocus(), 'Escape preserves exact inventory,0puts/commits and connected visible trigger focus');
    await open(); await page.locator('#camp-compare-cancel').press('Enter'); await idle();
    check('camp-cancel-zero-write', await raw() === originalRaw && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0), 'explicit Cancel leaves exact inventory and no database put/commit');
    await open(); await page.locator('#camp-recipient').selectOption('b1');
    await page.evaluate(() => {
      const dialog = document.getElementById('camp-compare');
      const holdClose = (e) => { dialog.removeEventListener('close', holdClose, true); e.stopImmediatePropagation();
        window.__campCloseReady = true; window.__campCloseRelease = () => dialog.dispatchEvent(new Event('close')); };
      dialog.addEventListener('close', holdClose, true);
    });
    await page.locator('#camp-issue').press('Enter'); await page.waitForFunction(() => window.__campCloseReady);
    await upload(page, exportSnapshot({ ...original, awardId: 'ignored-overlap' }));
    await page.locator('.entry-modes a').evaluateAll((ns) => ns.forEach((n) => n.click()));
    check('camp-queued-close-owner', page.url() === url + '?camp' && await page.evaluate(() => window.__entry.importing && window.__campWrites === 0
      && document.getElementById('entry-import').disabled && [...document.querySelectorAll('#front a[href]')].every((n) => n.getAttribute('aria-disabled') === 'true') && !document.getElementById('entry-replace').open), 'owner survives native queued-close; overlapping import/navigation cannot acquire it');
    await holdProgressTransaction(page); await page.evaluate(() => window.__campCloseRelease());
    await page.waitForFunction(() => window.__progressTransactions > window.__saveQueueBase);
    check('camp-saving-owner-feedback', await page.evaluate(() => window.__campWrites === 0 && window.__entry.importing && window.__saveHeldRaw !== undefined
      && document.getElementById('entry-status').textContent.includes('Saving the reviewed exchange') && document.activeElement.id === 'entry-status'
      && document.getElementById('entry-import').disabled && document.getElementById('entry-retry').disabled) && await visibleFocus(), 'actual queued transaction keeps camp/saved army and visible Saving feedback, blocking overlapping writers');
    await shot(page, 'camp-saving-320');
    check('camp-pending-export-while-queued', await download() === exportSnapshot(expected)
      && await download('#entry-export-saved') === originalRaw && await page.evaluate((before) => window.__saveHeldRaw === before, originalRaw), 'queued exchange exports immutable pending draft and separately exact displayed saved army');
    await releaseProgressTransaction(page); await idle();
    check('camp-issue-one-exchange', await raw() === exportSnapshot(expected) && JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(expected)
      && await page.evaluate(() => window.__campWrites === 1 && window.__progressPuts === 1 && window.__progressLegacyWrites === 0 && !window.__entry.exchange), 'one confirm saves exactly one exchange/audit record with preserved award/identities/seed/grade');
    check('camp-issue-focus-connected', await page.evaluate(() => document.activeElement.classList.contains('camp-compare-button') && document.activeElement.closest('[data-item-uid]').dataset.itemUid === 'camp-depot-1') && await visibleFocus(), 'removed issued item returns focus to connected next item, visible at320px');
    await shot(page, 'camp-issued-focus-320');
    await page.reload(); await idle();
    check('camp-reload-export-no-reissue', await raw() === exportSnapshot(expected) && await download() === exportSnapshot(expected)
      && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0), 'reload/read/export preserve exact one-record army with0new writes');
    await importReviewed(page, expected);
    check('camp-import-roundtrip', await raw() === exportSnapshot(expected) && await page.evaluate(() => window.__campWrites === 1 && window.__progressLegacyWrites === 0), 'native explicit import roundtrip preserves exact exchanged inventory');

    await seed(original); await page.evaluate(() => { window.__campQuota = true; });
    await open(); await page.locator('#camp-recipient').selectOption('b1'); await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-quota-old-state-pending', await raw() === originalRaw && await page.evaluate((before) => JSON.stringify(window.__entry.saved) === before
      && window.__campWrites === 0 && window.__entry.exchange && document.activeElement.id === 'entry-retry', originalRaw) && await visibleFocus(), 'failed quota leaves stored/displayed saved army exact, retains original draft and visible recovery focus');
    await shot(page, 'camp-quota-retry-focus-320');
    await page.locator('#entry-status').focus(); await shot(page, 'camp-quota-status-320');
    check('camp-recovery-two-exports', await download() === exportSnapshot(expected) && await download('#entry-export-saved') === originalRaw, 'failure exports distinguish pending versus displayed saved army');
    await shot(page, 'camp-quota-recovery-320');
    await page.evaluate(() => { window.__campQuota = false; }); await page.locator('#entry-retry').press('Enter');
    check('camp-retry-original-review', await page.locator('#camp-recipient').isDisabled() && await page.locator('#camp-recipient').inputValue() === 'b1'
      && await page.locator('#camp-compare-heading').textContent() === 'Retry reviewed exchange', 'Retry retains original brigade/item/baseline and cannot switch recipient');
    await page.keyboard.press('Escape'); await idle();
    check('camp-retry-cancel-keeps-pending', await raw() === originalRaw && await page.evaluate(() => !!window.__entry.exchange && window.__campWrites === 0), 'cancelling Retry preserves pending draft and old saved army');
    await page.locator('#entry-retry').press('Enter'); await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-retry-one-record', await raw() === exportSnapshot(expected) && await page.evaluate(() => window.__campWrites === 1 && window.__entry.saved.issued.length === 1 && !window.__entry.exchange), 'recovered original exchange commits once without reroll or repeated record');

    await seed(original); await open(); await page.locator('#camp-recipient').selectOption('b1');
    const other = await ctx.newPage(); watchErrors(other, url, errors);
    const concurrent = exchangeDepot(original, { brigadeId: 'b3', itemUid: 'camp-depot-2' });
    await other.goto(url + '?camp'); await other.waitForFunction(() => window.__entry && !window.__entry.importing);
    await importReviewed(other, concurrent);
    result.campConcurrency = { second: await other.evaluate(() => ({ saved: window.__entry.saved, writes: window.__campWrites,
      puts: window.__progressPuts, legacyWrites: window.__progressLegacyWrites, busy: window.__entry.importing })),
    first: await page.evaluate(() => ({ displayed: window.__entry.saved, busy: window.__entry.importing, reviewOpen: document.getElementById('camp-compare').open })) };
    check('camp-other-tab-real-write', await progressRaw(other) === exportSnapshot(concurrent) && await other.evaluate(() => window.__campWrites === 1), 'second actual UI tab imports a distinct army while first camp consent remains open');
    await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-stale-review-refuses', await raw() === exportSnapshot(concurrent) && await page.evaluate((before) => window.__campWrites === 0 && window.__progressPuts === 0
      && JSON.stringify(window.__entry.saved) === before && !!window.__entry.exchange, originalRaw), 'stale native review cannot overwrite second-tab state; displayed baseline/draft remain exact');
    await page.locator('#entry-retry').press('Enter'); await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-stale-retry-no-rebase', await raw() === exportSnapshot(concurrent) && await download() === exportSnapshot(expected)
      && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0), 'Retry rechecks original baseline and refuses without adopting newer progress or appending twice');
    const failureAxe = await new AxeBuilder({ page }).include('#front').analyze(); result.campRecoveryAxe = failureAxe.violations;
    check('camp-recovery-axe', failureAxe.violations.length === 0, JSON.stringify(failureAxe.violations.map((v) => v.id)));
    await page.locator('#entry-discard-exchange').press('Enter'); await idle();
    check('camp-discard-reload', await raw() === exportSnapshot(concurrent) && JSON.stringify(await page.evaluate(() => window.__entry.saved)) === JSON.stringify(concurrent)
      && await page.evaluate(() => !window.__entry.exchange && window.__campWrites === 0), 'explicit discard reloads authoritative army without mutation'); await other.close();

    await seed(original); await page.evaluate(() => { window.__campReadBlocked = true; });
    await open(); await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-blocked-read-retains', await raw() === originalRaw && await page.evaluate(() => !!window.__entry.exchange && window.__campWrites === 0 && window.__progressPuts === 0), 'blocked database read preserves old saved army and pending reviewed draft');
    await page.evaluate(() => { window.__campReadBlocked = false; }); await page.locator('#entry-discard-exchange').press('Enter'); await idle();
    const unavailable = fixture({ unavailable: true }); await seed(unavailable); await open();
    check('camp-no-recipient-refusal', await page.locator('#camp-recipient option').count() === 0 && await page.locator('#camp-issue').isDisabled()
      && await page.locator('#camp-exchange-note').textContent().then((s) => s.includes('No available brigade')), 'all depleted formations produce useful no-recipient feedback and no confirm');
    await page.keyboard.press('Escape'); await idle();
    check('camp-no-recipient-zero-write', await raw() === exportSnapshot(unavailable) && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0), 'unavailable comparison cannot change inventory');
    const large = fixture({ large: true }); await seed(large);
    check('camp-largest-inventory-bounded', await page.locator('#camp-army [data-brigade-id]').count() === 12 && await page.locator('#camp-depot [data-item-uid]').count() === 12
      && await page.locator('#depot-pages').textContent().then((s) => s.includes('1–12 of 2000')) && await page.locator('#army-pages').textContent().then((s) => s.includes('1–12 of 200')), 'legal200brigades/2000depot mount12+12 cards with exact totals');
    await page.getByRole('button', { name: 'Next depot cards', exact: true }).press('Enter'); await open('camp-depot-12');
    await page.locator('#camp-recipient').selectOption('b1'); await page.locator('#camp-issue').press('Enter'); await idle();
    check('camp-page-identity-preserved', await page.locator('#depot-pages').textContent().then((s) => s.includes('13–24 of 2000'))
      && await page.locator('#camp-depot [data-item-uid]').count() === 12 && await page.evaluate(() => document.activeElement.closest('[data-item-uid]')?.dataset.itemUid === 'camp-depot-13' && window.__entry.saved.army[0].weapon.uid === 'camp-depot-12'), 'page stays bounded after issue; identity-based save and connected next-card focus survive rerender');
    for (const bytes of [false, true]) {
      const limited = limitFixture(bytes); await seed(limited); await open(); await page.locator('#camp-recipient').selectOption('b1');
      check(bytes ? 'camp-byte-growth-refusal' : 'camp-issued-limit-refusal', await page.locator('#camp-issue').isDisabled()
        && await page.locator('#camp-exchange-note').textContent().then((s) => s.includes(bytes ? '1 MB limit' : 'issued'))
        && await raw() === exportSnapshot(limited) && await page.evaluate(() => window.__campWrites === 0 && window.__progressPuts === 0), 'actual modal disables oversized next snapshot before any put/commit and keeps legal baseline exact');
      await page.keyboard.press('Escape'); await idle();
    }
    check('camp-preferences-preserved', await page.evaluate(() => localStorage.getItem('cw.settings') === '{"screens.cardStyle":"clean modern"}' && localStorage.getItem('cw.locks') === '["screens.cardStyle"]'
      && window.__progressLegacyWrites === 0), 'exchanges/exports/retry/import preserve preferences/locks and never write legacy progress, checked before any theme fixture replacement');
    result.campThemes = [];
    for (const style of ['period desk', 'hybrid', 'clean modern']) {
      await page.evaluate((value) => localStorage.setItem('cw.settings', JSON.stringify({ 'screens.cardStyle': value })), style);
      await seed(original);
      const theme = await page.locator('.camp-compare-button').first().evaluate((n) => ({ border: getComputedStyle(n).borderTopColor,
        background: getComputedStyle(n).backgroundColor, focus: getComputedStyle(n).getPropertyValue('--rw-focus').trim(), table: getComputedStyle(document.getElementById('front')).backgroundImage }));
      result.campThemes.push({ style, ...theme });
      await page.locator('.camp-compare-button').first().focus();
      check(`camp-theme-${style.replaceAll(' ', '-')}`, await visibleFocus() && await page.locator('.camp-compare-button').first().evaluate((n) => n.getBoundingClientRect().height >= 44), 'actual themed comparison control is visible and touch-sized');
      if (style === 'period desk') await shot(page, 'camp-desk-button-320');
      await open();
      const themedAxe = await new AxeBuilder({ page }).include('#camp-compare').analyze(); result.campThemes.at(-1).axe = themedAxe.violations;
      check(`camp-theme-modal-${style.replaceAll(' ', '-')}`, themedAxe.violations.length === 0, JSON.stringify(themedAxe.violations.map((v) => v.id)));
      await page.keyboard.press('Escape'); await idle();
    }
    check('camp-narrow-touch-targets', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth && [...n.querySelectorAll('button,a,select')]
      .filter((b) => b.getClientRects().length && !b.disabled).every((b) => b.getBoundingClientRect().height >= 44)), '320px camp has no horizontal overflow; all visible enabled controls >=44px');
    check('camp-no-field-assets', !requests.some((p) => /terrain|vendor\/three|src\/fx\/|assets\/figures/.test(p)), 'all camp comparisons and transfers load no field assets or renderer');
    check('camp-no-console-errors', errors.length === 0, errors.join('\n') || '0 errors');
  } finally { await ctx.close(); }
}

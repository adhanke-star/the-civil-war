// Focused UI proof with accelerated terminal fixtures, not a full human-duration playthrough.
import { promises as fs } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, progressRaw, seedProgress, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';

export async function practiceProgress({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', acceptDownloads: true });
  await probeProgress(ctx, { prefix: '__practice', readFlag: '__practiceBlocked', quotaFlag: '__practiceQuota' });
  const page = await ctx.newPage(), errors = [];
  watchErrors(page, url, errors);
  const raw = () => progressRaw(page);
  async function load(query = '?practice&quality=low') {
    await page.goto(url + query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });

  }
  async function terminal() {
    // Exercise Game's real clock/objective/result event path, with controlled fractional losses and
    // disabled pieces. Orders/combat are covered by the existing field smoke; this fixture accelerates time.
    return page.evaluate(async () => {
      const { CLOCK_RATIO } = await import('./src/sim/combat.js');
      const g = window.__game.game;
      g.paused = true;
      g.units.find((u) => u.id === 'franklin').men = 1777.9;
      g.units.find((u) => u.id === 'franklin').state = 'routing';
      g.units.find((u) => u.id === 'willcox').men = 0.8;
      const r = g.units.find((u) => u.id === 'ricketts'); r.men = 99.4; r.gunSlots[0].alive = false;
      g.simTime = (g.clockEnd - g.clockStart) / CLOCK_RATIO + 1;
      g.objT = 0; g.checkObjective(0.05);
      return { paused: g.paused, time: g.simTime, men: g.units.filter((u) => u.side === 'US').map((u) => [u.id, Math.floor(u.men)]),
        outcome: window.__game.practice.outcome };
    });
  }
  async function reveal() {
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
  }
  async function counts() {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
  }
  async function finish() {
    await counts(); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  async function exported() {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export army', exact: true }).click();
    const d = await waiting;
    return JSON.parse(await fs.readFile(await d.path(), 'utf8'));
  }
  async function axe(scope, key) {
    const a = await new AxeBuilder({ page }).include(scope).analyze();
    result[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    check(key, a.violations.length === 0, JSON.stringify(result[key]));
  }
  try {
    await load();
    await page.getByRole('button', { name: /^Franklin.s Brigade/ }).click();
    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    const end = await terminal();
    check('practice-terminal-survivors', end.paused && end.outcome.army.length === 5
      && JSON.stringify(end.men) === JSON.stringify(end.outcome.army.map((b) => [b.id, b.men]))
      && end.outcome.army[0].men === 1777 && end.outcome.army[1].men === 0
      && end.outcome.army[3].guns === 5, 'real result event freezes actual routed/depleted roster and live pieces; accelerated fixture');
    await axe('#result', 'practiceResultAxe'); await shot(page, 'practice-result');
    const orderBefore = await page.evaluate(() => ({ orders: window.__game.game.orders, quality: window.__game.post.mode }));
    await page.keyboard.press('c'); await page.keyboard.press('g');
    await page.locator('#result').dispatchEvent('keydown', { key: ' ', bubbles: true });
    check('practice-result-input', await page.evaluate((n) => window.__game.game.paused && window.__game.game.orders === n.orders && window.__game.post.mode === n.quality, orderBefore), 'dialog keys do not charge, change quality or resume combat');
    await page.getByRole('button', { name: 'Inspect the field', exact: true }).click();
    await page.locator('#battlefield').focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.__game.game.paused);
    await page.getByRole('button', { name: 'After action', exact: true }).click();
    const pausedTime = await page.evaluate(() => window.__game.game.simTime);
    await page.waitForTimeout(150);
    check('practice-result-reopen-freeze', await page.evaluate((t) => window.__game.game.paused && window.__game.game.simTime === t, pausedTime)
      && JSON.stringify(await page.evaluate(() => window.__game.practice.outcome)) === JSON.stringify(end.outcome), 'Inspect -> resume -> After action re-pauses; original result identities and survivors remain frozen');
    await page.getByRole('button', { name: 'Open the loot', exact: true }).click();
    await page.waitForSelector('.rw[data-step="a"]');
    await page.waitForTimeout(50);
    const opened = await page.evaluate(() => {
      const s = window.__game.practice.reward.state;
      return { focus: !!document.activeElement.closest('.rw'), inert: document.querySelector('main').inert,
        captured: s.captures.length, sources: s.cards.map((c) => c.source), army: s.army, time: window.__game.game.simTime };
    });
    check('practice-reward-real-army', opened.focus && opened.inert && opened.captured === 0 && opened.sources.every((s) => s === 'issue')
      && opened.army.length === 5 && opened.army.every((b) => b.weapon.itemId.startsWith('practice-')), 'reward uses real five-unit roster, explicit practice gear and zero invented field captures; focus inside loot');
    await page.keyboard.press('c'); await page.keyboard.press('g');
    check('practice-loot-input', await page.evaluate((t) => window.__game.game.paused && window.__game.game.simTime === t, opened.time), 'loot keeps simulation stopped and battlefield input inert');
    for (const viewport of [{ width: 320, height: 480 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      const top = await page.locator('.rw-aar').evaluate((n) => { n.scrollTop = 0; const r = n.firstElementChild.getBoundingClientRect(); return r.y >= 0 && n.scrollWidth <= n.clientWidth; });
      await page.locator('.rw-primary').scrollIntoViewIfNeeded();
      const fit = await page.locator('.rw-primary').evaluate((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight; });
      check(`practice-after-action-fit-${viewport.width}`, top && fit, 'after-action top is reachable, content has no horizontal clipping, scroll reaches >=44px primary action');
      await shot(page, `practice-loot-${viewport.width}`);
    }
    await reveal();
    const pair = await page.evaluate(async () => {
      const { compare } = await import('./src/reward/model.js'); const s = window.__game.practice.reward.state;
      const pairs = [];
      for (let t = 0; t < s.tray.length; t++) for (let b = 0; b < s.army.length; b++) { const c = compare(s.army[b], s.tray[t]); if (c.ok) pairs.push({ t, b, label: s.army[b].label }); }
      if (!pairs.length) throw new Error('practice haul has no compatible live formation');
      return pairs[0];
    });
    await page.locator(`.rw-tile[data-t="${pair.t}"]`).click();
    await page.locator('.rw-brig[data-b="1"]').click();
    check('practice-depleted-no-issue', await page.locator('.rw-cmp').count() === 0 && await page.locator('.rw-brig[data-b="1"]').getAttribute('aria-label').then((s) => s.includes('Depleted')), 'zero-man Willcox record is labelled depleted and cannot receive new gear');
    await page.locator(`.rw-brig[data-b="${pair.b}"]`).click();
    await page.getByRole('button', { name: new RegExp(`^Issue to ${pair.label}`) }).click();
    await counts();
    const readable = await page.locator('.rw-counts .rw-bweap-name').evaluateAll((nodes) => nodes.length === 5 && nodes.every((n) => n.clientWidth > 0 && n.scrollWidth <= n.clientWidth));
    check('practice-counts-current-gear-readable', readable, 'previous-weapon history gets its own row; equipped weapon names remain visible');
    await axe('.rw', 'practiceCountsAxe'); await shot(page, 'practice-counts');
    const expected = await page.evaluate(() => { const s = window.__game.practice.reward.state; return { army: s.army, depot: s.tray, issued: s.log, awardId: s.awardId }; });
    await holdProgressTransaction(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => window.__game.practice.saving && window.__progressTransactions > window.__saveQueueBase);
    const waitingArmy = await page.evaluate(() => window.__game.practice.pending);
    check('practice-queued-export', JSON.stringify(await exported()) === JSON.stringify(waitingArmy)
      && await page.evaluate(() => window.__practiceWrites === 0 && document.getElementById('result').getAttribute('aria-busy') === 'true'),
      'actual completed army remains exportable while waiting behind the readwrite transaction');
    await page.evaluate(() => { const p = window.__game.practice; p.reward.state.onDone({ ...p.pending, awardId: 'ignored-late-callback' }); });
    check('practice-queued-result-owner', JSON.stringify(await page.evaluate(() => window.__game.practice.pending)) === JSON.stringify(waitingArmy),
      'late duplicate callback cannot replace the immutable pending result while its write waits');
    await page.setViewportSize({ width: 320, height: 480 });
    await axe('#result', 'practiceWaitingAxe'); await shot(page, 'practice-saving-320');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('result').open && document.activeElement.id === 'after-action');
    await releaseProgressTransaction(page); await page.waitForFunction(() => !window.__game.practice.saving);
    check('practice-queued-dismissal', await page.evaluate(() => !document.getElementById('result').open && window.__practiceWrites === 1
      && document.activeElement.id === 'after-action'), 'Escape dismisses safely; settlement writes once and never forces the modal or focus back');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole('button', { name: 'After action', exact: true }).click();
    await page.getByRole('dialog', { name: 'Army saved', exact: true }).waitFor();
    const firstRaw = await raw(), first = JSON.parse(firstRaw);
    check('practice-save-equipped', first.awardId === expected.awardId && first.army.length === 5 && first.issued.length === 1
      && JSON.stringify(first.army.map((b) => [b.id, b.men, b.weapon.uid])) === JSON.stringify(expected.army.map((b) => [b.id, b.men, b.weapon.uid])), 'equip -> completed save preserves actual survivor/equipment identities');
    await page.evaluate(() => { const p = window.__game.practice; const { awardId, army, depot, issued, seed, grade } = p.pending;
      p.reward.state.onDone({ awardId, army, depot, issued, seed, grade }); p.openResult(); });
    await page.waitForFunction(() => !window.__game.practice.saving);
    check('practice-duplicate-completion', await raw() === firstRaw && await page.evaluate(() => window.__practiceWrites === 1)
      && await page.locator('.rw').count() === 0, 'repeat callbacks/result clicks do not write or roll a second award');
    await page.evaluate(async () => { const settings = await import('./src/settings.js');
      settings.all().find((e) => e.key === 'moments.rewardPlay').spec.run(); });
    check('practice-replay-isolated', await raw() === firstRaw && await page.locator('.rw').count() === 0,
      'sandbox reward action cannot inherit the practice save callback or mount a sample army');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => window.__entry?.mode === 'camp');
    const resumed = await page.evaluate(() => window.__entry.saved);
    check('practice-continue-reload', await raw() === firstRaw && resumed.awardId === first.awardId
      && resumed.army.length === 5 && resumed.army[1].men === 0, 'Continue reaches camp with depleted identity and unchanged progress bytes');
    await shot(page, 'practice-resumed');

    await load(); await terminal();
    await page.getByRole('button', { name: 'Open the loot', exact: true }).click();
    const consent = page.getByRole('dialog', { name: 'Replace saved army?', exact: true });
    await consent.waitFor(); // The click starts an awaited database read before consent exists.
    const consentState = await page.evaluate(() => ({ reading: window.__game.practice.reading,
      open: document.getElementById('result').open, heading: document.getElementById('result-title').textContent,
      focus: document.activeElement.id, puts: window.__progressPuts, writes: window.__practiceWrites,
      legacyWrites: window.__progressLegacyWrites }));
    check('practice-replace-confirm', await consent.isVisible() && !consentState.reading
      && consentState.focus === 'result-close' && consentState.puts === 0 && consentState.writes === 0
      && consentState.legacyWrites === 0 && await raw() === firstRaw,
      `existing progress requires settled native consent with Cancel focused and exact saved bytes: ${JSON.stringify(consentState)}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('result').open && document.activeElement.id === 'after-action');
    check('practice-replace-cancel-focus', await raw() === firstRaw
      && await page.evaluate(() => window.__progressPuts === 0 && window.__practiceWrites === 0 && window.__progressLegacyWrites === 0),
      'Escape closes replacement consent, restores After action focus and preserves exact saved progress before another activation');
    await page.getByRole('button', { name: 'After action', exact: true }).click();
    await page.getByRole('button', { name: 'Open the loot', exact: true }).click();
    await page.getByRole('button', { name: 'Replace and open loot', exact: true }).click();
    await reveal();
    await page.evaluate(() => { window.__practiceQuota = true; });
    await finish();
    await page.getByRole('dialog', { name: 'Army not saved', exact: true }).waitFor();
    const pending = await page.evaluate(() => window.__game.practice.pending);
    const backup = await exported();
    check('practice-quota-export', await raw() === firstRaw && backup.awardId === pending.awardId
      && JSON.stringify(backup) === JSON.stringify(pending), 'failed save retains old bytes; actual download preserves pending army and unique award');
    await axe('#result', 'practiceRecoveryAxe'); await shot(page, 'practice-recovery');
    const external = { ...first, awardId: 'practice-external-test' }, externalRaw = JSON.stringify(external);
    await page.evaluate(() => { window.__practiceQuota = false; }); await seedProgress(page, externalRaw);
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.saving);
    check('practice-conflict-retained', await raw() === externalRaw && (await page.locator('#result-text').textContent()).includes('progress changed')
      && (await page.evaluate(() => window.__game.practice.pending.awardId)) === pending.awardId, 'external progress change rejects retry without replacing either result');
    // Restore only this context-owned test fixture byte-for-byte, then prove retry does not roll again.
    await seedProgress(page, firstRaw);
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.saving);
    check('practice-retry-same-award', JSON.parse(await raw()).awardId === pending.awardId && await page.locator('.rw').count() === 0,
      'quota/conflict recovery commits the same pending result without reopening loot');
    const secondRaw = await raw();

    await load(); await terminal();
    await page.evaluate(() => { window.__practiceBlocked = true; });
    await page.getByRole('button', { name: 'Open the loot', exact: true }).click();
    await page.getByRole('button', { name: 'Open without saving', exact: true }).click();
    await reveal(); await finish();
    const unsaved = await exported();
    check('practice-blocked-read-export', await raw() === secondRaw && unsaved.awardId === await page.evaluate(() => window.__game.practice.pending.awardId),
      'blocked reads still allow loot completion/export and never grant replacement authority');
    await page.evaluate(() => { window.__practiceBlocked = false; });
    const cancelledRaw = await raw();
    const cancelState = () => page.evaluate(async () => {
      const { exportSnapshot } = await import('./src/franchise/save.js');
      return { open: document.getElementById('result').open, activeId: document.activeElement.id,
        reading: window.__game.practice.reading, rwCount: document.querySelectorAll('.rw').length,
        pending: exportSnapshot(window.__game.practice.pending), puts: window.__progressPuts,
        commits: window.__practiceWrites, legacy: window.__progressLegacyWrites };
    });
    const cancelBefore = await cancelState();
    await holdProgressTransaction(page);
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.waitForFunction(() => window.__game.practice.reading);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('result').open && document.activeElement.id === 'after-action');
    const cancelledHeld = await cancelState();
    check('practice-cancelled-read-held', !cancelledHeld.open && cancelledHeld.reading && cancelledHeld.rwCount === 0
      && cancelledHeld.pending === cancelBefore.pending && cancelledHeld.puts === cancelBefore.puts
      && cancelledHeld.commits === cancelBefore.commits && cancelledHeld.legacy === cancelBefore.legacy,
      `native Escape closes/restores focus while read remains held; exact pending/zero new writes: ${JSON.stringify(cancelledHeld)}`);
    await releaseProgressTransaction(page);
    await page.waitForFunction(() => !window.__game.practice.reading && !document.getElementById('result').open
      && document.activeElement.id === 'after-action');
    const cancelledSettled = await cancelState(); result.practiceCancelledRead = { before: cancelBefore, held: cancelledHeld, settled: cancelledSettled };
    check('practice-cancelled-read-no-mount', !cancelledSettled.open && !cancelledSettled.reading && cancelledSettled.rwCount === 0
      && cancelledSettled.pending === cancelBefore.pending && cancelledSettled.puts === cancelBefore.puts
      && cancelledSettled.commits === cancelBefore.commits && cancelledSettled.legacy === cancelBefore.legacy && await raw() === cancelledRaw,
      `both read and native close/focus settle; exact saved/pending and zero new writes: ${JSON.stringify(cancelledSettled)}`);
    await page.getByRole('button', { name: 'After action', exact: true }).click();
    check('practice-cancelled-read-retains-pending', JSON.stringify(await exported()) === JSON.stringify(unsaved)
      && await page.getByRole('button', { name: 'Retry loading', exact: true }).isVisible()
      && await page.getByRole('button', { name: 'Open the loot', exact: true }).count() === 0,
      'cancelled read keeps completed equipment/issued choices exportable and offers recovery rather than another roll');
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.getByRole('dialog', { name: 'Replace saved army?', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => document.activeElement.id === 'after-action');
    check('practice-recovered-read-confirm', await raw() === secondRaw && await page.evaluate(() => document.activeElement.id === 'after-action'),
      'restored access still requires explicit replacement; Cancel preserves stored bytes and returns focus');
    await page.getByRole('button', { name: 'After action', exact: true }).click();
    check('practice-cancelled-consent-retains-pending', JSON.stringify(await exported()) === JSON.stringify(unsaved)
      && await page.getByRole('button', { name: 'Retry loading', exact: true }).isVisible() && await page.locator('.rw').count() === 0,
      'cancelled replacement consent preserves the same pending export and cannot return to a new loot mount');
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await page.getByRole('button', { name: 'Replace and save', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.saving);
    check('practice-recovered-read-save', JSON.parse(await raw()).awardId === unsaved.awardId, 'confirmed recovered baseline saves the original unsaved loot');

    const beforeHistorical = await raw();
    await load('?battle=henry-hill&quality=low'); await terminal();
    check('practice-historical-no-rewards', await raw() === beforeHistorical && await page.locator('#result-action').isHidden()
      && await page.evaluate(() => window.__game.practice.outcome === null && window.__practiceWrites === 0), 'historical result grants no loot or franchise writes');
    check('practice-no-console-errors', errors.length === 0, errors.join(' | ') || '0 errors');
  } finally { await ctx.close(); }
}

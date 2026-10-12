// Browser checks for the after-action history pages, the 30-second map replay, the campaign ending and the record book
// (P4x). To be registered by the top loop in tools/test.mjs shard 4 as `--history`: `historyControls({ browser, url, check,
// shot, result, watchErrors })`, the same shape as tools/test-economy-ui.mjs. Fictional data only: a one-phase campaign and
// a one-phase battle pack on the Henry Hill ground (21 July 1861), served by Playwright route interception of
// assets/campaign.json and assets/packs/test-history.json; its history block is labelled fictional and nothing ships for it.
// 1. Campaign flow (reduced motion): Camp -> Next -> Briefing -> forced Union win -> After-action & loot. The pages come in
//    order a (grade, then "You vs history" before the points and badges) -> h (what really happened: outcome, closing
//    quotation with its source, linked sources) -> r (replay: starts paused under reduced motion; Space on Play plays and
//    pauses, Step moves one sample, the slider scrubs with End and the arrow keys) -> b (loot). After the save, the
//    ladder's last phase offers "Campaign ending": grade, medals, sourced epilogue, Record book / Title; the record book
//    opens over it and Esc closes each in turn. axe on every page, 320 px, screenshots.
// 2. The record book from the camp page, opened with the exact call src/ui/entry.js makes; Esc closes it; axe; 320 px.
// 3. Full motion on the Battles menu route (?battle=test-history&phase=p1): the result offers "After-action"; the replay
//    plays by itself and advances, Space pauses it; "Open the loot" is absent (no loot); Done returns to the result.
// The battle result is forced through the documented hook window.__game.game (as tools/test-campaign-ui.mjs does).
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-history';
const HISTORY = { outcome: ['Fictional outcome paragraph for the after-action history checks. Nothing on this page is history; it exists only so the test can read the page.'],
  casualties: { US: null, CS: 1234, basis: 'Fictional basis for the test: 1,234 is a test number, not a historical figure.', provenance: 'Estimated' },
  closingQuote: { text: 'Fictional closing words for the test.', who: 'Fictional speaker (test only)', source: 'Fictional source (test only)' },
  sources: [{ label: 'Fictional source one (test only)', url: 'https://example.org/fictional-one' }, { label: 'Fictional source two (test only)' }] };
const PACK = { version: 1, id: PACK_ID, title: 'Fictional history test battle (test only)', phases: [
  { id: 'p1', scenario: { ...structuredClone(HH), id: 'test-history-p1', title: 'Fictional history phase (test only)', attacker: 'US', clockRatio: 10,
    subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the history checks; nothing here is history.' }, history: HISTORY } }] };
const CAMPAIGN = { version: 1, id: 'test-hist', title: 'Fictional history campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }] };

const axeOk = async (page, scope, key, check, result) => {
  const axe = await new AxeBuilder({ page }).include(scope).analyze();
  const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  result[`history${key}Axe`] = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  check(`history-${key}-axe`, bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
};
const narrowOk = async (page, scope, key, check, shot) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const ok = await page.locator(scope).first().evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
  check(`history-${key}-320`, ok, '320px wide: no horizontal overflow');
  await shot(page, `history-${key}-320`);
  await page.setViewportSize({ width: 1024, height: 768 });
};
const stepOf = (page) => page.evaluate(() => document.querySelector('.rw')?.dataset.step ?? null);
const forceWin = (page) => page.evaluate(() => {
  const g = window.__game.game; g.paused = true;
  for (const u of g.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing';
  g.checkObjective(0, true);
});

export async function historyControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. the campaign flow (reduced motion) ----
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__history', readFlag: '__historyReadBlocked', quotaFlag: '__historyQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const camp = async () => { await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 }); };
  try {
    const start = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-11T12:00:00Z' });
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(start));
    await camp();
    await page.locator('#camp-next').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    await page.keyboard.press('Enter');
    // run the field 10 sim seconds (ticks, no rendering) so the replay has more than its opening sample
    await page.evaluate(() => { const g = window.__game.game; for (let i = 0; i < 200 && !g.over; i++) g.tick(0.05); });
    await forceWin(page);
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    await page.locator('#result-action').click();
    await page.waitForFunction(() => document.querySelector('.rw[data-step="a"]'), null, { timeout: 15000 });
    const steps = [await stepOf(page)];
    // ---- a: grade, then you vs history before the points and badges ----
    const a = await page.evaluate(() => {
      const kids = [...document.querySelector('.rw-aar').children].map((n) => n.className.split(' ')[0]);
      const rows = [...document.querySelectorAll('.rw-vs-table tbody tr')].map((tr) => [tr.dataset.row, ...[...tr.cells].map((c) => c.textContent)]);
      return { kids, rows, primary: document.querySelector('.rw-aar .rw-primary .rw-primary-label')?.textContent, skip: document.querySelector('.rw-aar .rw-skip')?.textContent,
        scale: document.querySelector('.rw-vs-scale')?.textContent, basis: document.querySelector('.rw-vs-basis')?.textContent, focus: document.activeElement?.id };
    });
    const at = (cls) => a.kids.indexOf(cls);
    check('history-aar-order', at('rw-grade') < at('rw-vs') && at('rw-vs') < at('rw-points') && (at('rw-badges') === -1 || at('rw-vs') < at('rw-badges'))
      && a.primary === 'What really happened' && a.skip?.startsWith('Open the loot') && a.focus === 'rw-aar-grade', `${a.kids.join(' > ')}; primary "${a.primary}", skip "${a.skip}"`);
    const cs = a.rows.find((r) => r[0] === 'cs'), us = a.rows.find((r) => r[0] === 'us');
    check('history-vs-columns', a.rows.length === 4 && cs?.[3].startsWith('1,234') && us?.[3] === 'No sourced figure' && /of/.test(us?.[2] ?? '')
      && /one figure stands for \d+ men/.test(a.scale) && /10 times faster/.test(a.scale) && a.basis.includes('(Estimated)'),
    `rows ${JSON.stringify(a.rows.map((r) => r.slice(0, 1).concat(r.slice(2))))}; scale stated`);
    await shot(page, 'history-aar');
    await axeOk(page, '.rw', 'aar', check, result);
    await narrowOk(page, '.rw-aar', 'aar', check, shot);
    // ---- h: what really happened (Enter on the focused heading goes on) ----
    await page.locator('#rw-aar-grade').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.rw[data-step="h"]'));
    steps.push(await stepOf(page));
    const h = await page.evaluate(() => ({ focus: document.activeElement?.id, quote: document.querySelector('.rw-quote blockquote')?.textContent,
      who: document.querySelector('.rw-quote-who')?.textContent, cite: document.querySelector('.rw-quote cite')?.textContent,
      links: [...document.querySelectorAll('.rw-story-sources a')].map((x) => [x.href, x.rel, x.target]), items: document.querySelectorAll('.rw-story-sources li').length,
      text: document.querySelector('.rw-story-text')?.textContent }));
    check('history-story', h.focus === 'rw-story-title' && h.quote === 'Fictional closing words for the test.' && h.who === 'Fictional speaker (test only)'
      && h.cite === 'Fictional source (test only)' && h.items === 2 && h.links.length === 1 && h.links[0][0] === 'https://example.org/fictional-one'
      && h.links[0][1] === 'noopener noreferrer' && h.links[0][2] === '_blank' && h.text.startsWith('Fictional outcome'), JSON.stringify(h).slice(0, 300));
    await shot(page, 'history-story');
    await axeOk(page, '.rw', 'story', check, result);
    await narrowOk(page, '.rw-story', 'story', check, shot);
    // ---- r: the replay, paused under reduced motion, driven by keyboard ----
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.rw[data-step="r"] .rp'));
    steps.push(await stepOf(page));
    const r0 = await page.evaluate(() => ({ playing: document.querySelector('.rp').dataset.playing, sample: Number(document.querySelector('.rp').dataset.sample),
      samples: window.__game.practice.phase.outcome.replay?.samples.length, status: document.querySelector('.rp-status').textContent, focus: document.activeElement?.id,
      clock: document.querySelector('.rp-time').textContent }));
    await page.locator('.rp-play').focus();
    await page.keyboard.press('Space');
    const r1 = await page.evaluate(() => document.querySelector('.rp').dataset.playing);
    await page.keyboard.press('Space');
    const r2 = await page.evaluate(() => document.querySelector('.rp').dataset.playing);
    await page.locator('.rp-fwd').focus();
    const before = await page.evaluate(() => Number(document.querySelector('.rp').dataset.sample));
    await page.keyboard.press('Enter');
    const stepped = await page.evaluate(() => Number(document.querySelector('.rp').dataset.sample));
    await page.locator('.rp-scrub').focus();
    await page.keyboard.press('End');
    const end = await page.evaluate(() => ({ sample: Number(document.querySelector('.rp').dataset.sample), value: document.querySelector('.rp-scrub').value }));
    await page.keyboard.press('Home');
    const home = await page.evaluate(() => Number(document.querySelector('.rp').dataset.sample));
    check('history-replay-keyboard', r0.playing === 'false' && r0.focus === 'rw-replay-title' && r0.samples >= 3 && /^\d{2}:\d{2}$/.test(r0.clock) && r0.status.length > 20
      && r1 === 'true' && r2 === 'false' && stepped === before + 1 && end.value === '1000' && end.sample === r0.samples - 1 && home === 0,
    `reduced motion starts paused (${r0.playing}); Space play ${r1} / pause ${r2}; Step ${before} -> ${stepped}; End -> sample ${end.sample} of ${r0.samples}; Home -> ${home}`);
    await page.locator('.rp-fwd').focus(); await page.keyboard.press('Enter');
    await shot(page, 'history-replay');
    await axeOk(page, '.rw', 'replay', check, result);
    await narrowOk(page, '.rw-replay', 'replay', check, shot);
    // ---- b: the loot is still reached, then the save and the campaign ending ----
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.waitForFunction(() => document.querySelector('.rw[data-step="b"]'));
    steps.push(await stepOf(page));
    check('history-pages-order', JSON.stringify(steps) === '["a","h","r","b"]', `pages ${steps.join(' -> ')}`);
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('result').open && document.getElementById('result-title').textContent === 'Campaign saved', null, { timeout: 30000 });
    const saved = await page.evaluate(() => ({ action: document.getElementById('result-action').textContent, focus: document.activeElement?.id }));
    await page.locator('#result-action').click();
    await page.waitForFunction(() => document.getElementById('campaign-ending')?.open, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#campaign-ending .rb-medal'), null, { timeout: 15000 });
    const ending = await page.evaluate(() => ({ focus: document.activeElement?.id, grade: document.querySelector('#campaign-ending .rb-grade-v')?.dataset.grade,
      medals: [...document.querySelectorAll('#campaign-ending .rb-medal')].map((m) => m.dataset.medal), epilogue: document.querySelectorAll('#campaign-ending .rb-epilogue p').length,
      inferred: /Inferred/.test(document.querySelector('#campaign-ending .rb-epilogue')?.textContent ?? ''),
      buttons: [...document.querySelectorAll('#campaign-ending .rb-actions button')].map((b) => b.textContent), rule: document.querySelector('#campaign-ending .rb-rule')?.textContent }));
    check('history-ending', saved.action === 'Campaign ending' && ending.focus === 'campaign-ending-title' && /^(Victory|Decisive)$/.test(ending.grade) && ending.medals.length === 1
      && ending.epilogue >= 2 && ending.inferred && JSON.stringify(ending.buttons) === '["Record book","Title"]' && /Game rule/.test(ending.rule),
    `saved panel "${saved.action}"; ending grade ${ending.grade}, medals ${ending.medals.join(',')}, ${ending.epilogue} epilogue paragraphs; buttons ${ending.buttons.join(' / ')}`);
    await shot(page, 'history-ending');
    await axeOk(page, '#campaign-ending', 'ending', check, result);
    await narrowOk(page, '#campaign-ending .rb-body', 'ending', check, shot);
    await page.locator('#campaign-ending-book').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('record-book')?.open && document.querySelector('#record-book .rb-table'), null, { timeout: 15000 });
    const book = await page.evaluate(() => ({ focus: document.activeElement?.id, rows: document.querySelectorAll('#record-book .rb-table tbody tr').length,
      text: document.querySelector('#record-book .rb-body').textContent }));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('record-book'));
    const backFocus = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('campaign-ending') && document.getElementById('result').open, null, { timeout: 15000 });
    check('history-ending-book', book.focus === 'record-book-title' && book.rows === 1 && book.text.includes('Fictional history phase (test only)') && book.text.includes('1,234')
      && backFocus === 'campaign-ending-book', `record book over the ending (${book.rows} row); Esc returns focus to ${backFocus}; Esc again back to the saved panel`);
    // ---- 2. the record book from the camp page, as src/ui/entry.js opens it ----
    await camp();
    // opened from a real click, as the camp button does: Chrome ignores Esc on a modal opened without a user gesture
    await page.evaluate(async () => {
      const { createProgressStore } = await import('./src/franchise/save.js');
      const save = await createProgressStore(undefined, { slot: 1 }).load();
      const m = await import('./src/ui/records.js');
      const b = document.createElement('button');
      b.id = 'test-open-book'; b.type = 'button'; b.textContent = 'Open the record book (test)';
      b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;min-height:44px';
      b.addEventListener('click', () => { b.remove(); window.__rb = m.openRecordBook(document.body, save); }, { once: true });
      document.body.append(b);
    });
    // a modal the camp opened itself (a level-up moment) makes the rest of the page inert: dismiss it first, as a player would
    for (let i = 0; i < 4 && await page.evaluate(() => !!document.querySelector('dialog[open]')); i++) await page.keyboard.press('Escape');
    result.historyBookOpenDialogs = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className));
    await page.locator('#test-open-book').click();
    await page.evaluate(() => window.__rb.ready);
    const camped = await page.evaluate(() => ({ open: document.getElementById('record-book')?.open, focus: document.activeElement?.id,
      grade: document.querySelector('#record-book .rb-grade-v')?.dataset.grade, brigades: document.querySelectorAll('#record-book .rb-brigade').length,
      label: document.getElementById('record-book')?.getAttribute('aria-labelledby') }));
    check('history-record-book', camped.open && camped.focus === 'record-book-title' && /^(Victory|Decisive)$/.test(camped.grade) && camped.brigades === 2 && camped.label === 'record-book-title',
      `open ${camped.open}; focus ${camped.focus}; grade ${camped.grade}; ${camped.brigades} brigades`);
    await shot(page, 'history-record-book');
    await axeOk(page, '#record-book', 'book', check, result);
    await narrowOk(page, '#record-book .rb-body', 'book', check, shot);
    await page.keyboard.press('Escape');
    check('history-record-book-esc', await page.evaluate(() => !document.getElementById('record-book')), 'Esc closes the record book and removes it');
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('history-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }

  // ---- 3. the Battles menu route at full motion: the replay plays by itself; no loot ----
  const full = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'no-preference' });
  await full.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const p2 = await full.newPage(), errors2 = []; watchErrors(p2, url, errors2);
  try {
    await p2.goto(url + `?battle=${PACK_ID}&phase=p1&nosw`);
    await p2.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    // 30 s of battle (8 samples at 4 s): sample 1 arrives about 4 s into the 30 s replay, well inside the wait below
    await p2.evaluate(() => { const g = window.__game.game; for (let i = 0; i < 600 && !g.over; i++) g.tick(0.05); });
    await forceWin(p2);
    await p2.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    const panel = await p2.evaluate(() => document.getElementById('result-action').textContent);
    await p2.locator('#result-action').click();
    await p2.waitForFunction(() => document.querySelector('.rw[data-step="a"]'));
    const noLoot = await p2.evaluate(() => ({ skip: !!document.querySelector('.rw-skip'), stats: !!document.querySelector('.rw-aar-stats'), primary: document.querySelector('.rw-primary-label')?.textContent }));
    await p2.keyboard.press('Enter'); await p2.waitForFunction(() => document.querySelector('.rw[data-step="h"]'));
    await p2.keyboard.press('Enter'); await p2.waitForFunction(() => document.querySelector('.rw[data-step="r"] .rp'));
    const playing = await p2.evaluate(() => document.querySelector('.rp').dataset.playing);
    await p2.waitForFunction(() => Number(document.querySelector('.rp').dataset.sample) > 0, null, { timeout: 25000 });
    await p2.keyboard.press('Space'); // focus is on the page heading (not a button): Space pauses the replay
    const paused = await p2.evaluate(() => document.querySelector('.rp').dataset.playing);
    await shot(p2, 'history-battles-replay');
    const last = await p2.evaluate(() => document.querySelector('.rw-primary-label')?.textContent);
    await p2.keyboard.press('Enter');
    await p2.waitForFunction(() => !document.querySelector('.rw') && document.getElementById('result').open, null, { timeout: 15000 });
    check('history-battles', panel === 'After-action' && !noLoot.skip && !noLoot.stats && noLoot.primary === 'What really happened' && playing === 'true' && paused === 'false' && last === 'Done',
      `result "${panel}"; no loot skip or stats; replay played by itself (${playing}) and Space paused it (${paused}); "${last}" returned to the result`);
    const real = errors2.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('history-battles-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await full.close().catch(() => {}); }
}

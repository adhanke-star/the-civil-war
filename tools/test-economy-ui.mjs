// Browser checks for requisition points, the level-up moment and the camp Requisition drawer (P5b), registered in
// tools/test.mjs shard 2 and `node tools/test.mjs --economy`. `economyControls({ browser, url, check, shot, result,
// watchErrors })`. Two parts:
// 1. Count-up (full motion): the reward sequence is mounted on the title page with a recorded phase's points summary
//    (built here with src/franchise/economy.js). The total counts up from 0 to its final value, the inline level-up
//    panel shows its reward card, and the full-screen moment plays once without taking focus or blocking a click.
// 2. The real flow (reduced motion), on a fictional one-phase campaign served by Playwright route interception of
//    assets/campaign.json and assets/packs/test-economy.json (Henry Hill ground, 21 July 1861; nothing ships for it).
//    Slot 1 is seeded at 50 reputation (level2). Camp -> Next -> Briefing -> forced Union win -> After-action & loot: the points
//    breakdown matches the saved ledger and the highest crossed level plays once; back in camp nothing replays; the drawer opens by
//    keyboard, stocks historically eligible arms up to the opened rarity in service by July 1861, a buy and a turn-in each go through a confirm (Escape
//    cancels with storage untouched); the turn-in crosses further levels and its moment plays once; axe, 320 px, screenshots.
//    The battle result is forced through the documented hook window.__game.game (as tools/test-campaign-ui.mjs does).
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import * as economy from '../src/franchise/economy.js';
import {ARMS,TIER_BY_ID} from '../src/reward/data.js';
import { validateSnapshot } from '../src/franchise/save.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-economy';
const PACK = { version: 1, id: PACK_ID, title: 'Fictional economy test battle (test only)', phases: [
  { id: 'p1', scenario: { ...structuredClone(HH), id: 'test-economy-p1', title: 'Fictional economy phase (test only)', attacker: 'US',
    subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the economy checks; nothing here is history.' } } }] };
const CAMPAIGN = { version: 1, id: 'test-econ', title: 'Fictional economy campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }] };
const LEGENDARY = 'test-econ.1.fixture.legend';

/** Slot 1 at 50 reputation: five Uncommon cards already turned in; a Legendary (80) waits in the depot for the UI. */
function seededSave() {
  let s = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-11T12:00:00Z' });
  const spare = Array.from({ length: 5 }, (_, i) => ({ uid: `test-econ.1.fixture.${i}`, itemId: 'lorenz', tier: 'uncommon', conditionId: 'worn', source: 'capture', from: 'Fictional test stores' }));
  s = validateSnapshot({ ...s, depot: [...spare, { uid: LEGENDARY, itemId: 'henry', tier: 'legendary', conditionId: 'serviceable', source: 'capture', from: 'Fictional test stores' }] });
  for (const it of spare) s = economy.turnInCard(s, { itemUid: it.uid });
  return s;
}
/** A recorded phase that reaches level 3, for the count-up mount. */
function countSummary() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 7 }), p = campaign.campaignPhase(s0, CAMPAIGN);
  const after = campaign.recordPhase(s0, CAMPAIGN, { packId: PACK_ID, phaseId: 'p1', awardId: p.awardId, winner: 'US', grade: 'Decisive', held: true,
    units: [{ id: 'friend', side: 'US', menStart: 3000, men: 2950 }, { id: 'foe', side: 'CS', menStart: 3000, men: 2400 }], loot: [] });
  return economy.phaseSummary(s0, after);
}

export async function economyControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. the count-up and the level-up moment at full motion ----
  const full = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'no-preference' });
  try {
    const page = await full.newPage(), errors = []; watchErrors(page, url, errors);
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    const points = countSummary();
    await page.evaluate(async (points) => {
      const { mountReward } = await import('./src/reward/sequence.js');
      window.__countSamples = [];
      mountReward(document.body, { seed: 11, grade: 'Decisive', rememberReplay: false, afterAction: { title: 'Fictional', why: 'Fictional test result.', surviving: 10, losses: 1, guns: 0,
        eyebrow: 'Campaign · Fictional', note: 'Test only.', points } });
      const v = document.querySelector('.rw-points-v');
      const sample = () => { window.__countSamples.push(v.textContent); if (!document.querySelector('.rw-points[data-counted="true"]')) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    }, points);
    await page.waitForFunction(() => document.querySelector('.rw-points[data-counted="true"]'), null, { timeout: 15000 });
    const count = await page.evaluate(() => ({ samples: window.__countSamples, final: document.querySelector('.rw-points-v').textContent,
      lines: [...document.querySelectorAll('.rw-points-line')].map((li) => li.dataset.line), panel: document.querySelector('.rw-levelup')?.dataset.level,
      cards: document.querySelectorAll('.rw-levelup-cards .rw-card').length, rep: document.querySelector('.rw-points-rep')?.textContent }));
    const values = count.samples.map((t) => Number(t.replace(/[^0-9]/g, '')));
    check('economy-count-up', count.final === `+${points.points}` && values.some((n) => n > 0 && n < points.points) && values.every((n, i) => i === 0 || n >= values[i - 1])
      && JSON.stringify(count.lines) === JSON.stringify(points.lines.map((l) => l.id)) && count.rep.includes(`Reputation 0 → ${points.reputation.to}`),
    `total counts 0 → ${count.final} through ${values.length} frames (${[...new Set(values)].slice(0, 6).join(', ')}…); lines ${count.lines.join(', ')}`);
    const moment = await page.evaluate(() => {
      const m = document.querySelector('.rw-levelup-moment'), button = document.querySelector('.rw-aar .rw-primary');
      button.scrollIntoView({ block: 'center' });
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { level: m?.dataset.level, events: m && getComputedStyle(m).pointerEvents, hidden: m?.getAttribute('aria-hidden'), log: window.__levelUps,
        clickable: !!hit?.closest('.rw-primary'), focus: document.activeElement?.id };
    });
    check('economy-count-levelup', count.panel === '3' && count.cards === 2 && moment.level === '3' && moment.events === 'none' && moment.hidden === 'true'
      && JSON.stringify(moment.log) === '[3]' && moment.clickable && moment.focus === 'rw-aar-grade',
    `inline level-up panel ${count.panel} with ${count.cards} card; full-screen moment level ${moment.level}, pointer-events ${moment.events}, focus ${moment.focus}, Open the loot clickable ${moment.clickable}`);
    await shot(page, 'economy-aar-levelup');
    await page.waitForFunction(() => !document.querySelector('.rw-levelup-moment'), null, { timeout: 10000 });
    check('economy-moment-leaves', await page.evaluate(() => JSON.stringify(window.__levelUps)) === '[3]', 'the moment leaves on its own and was shown once');
    const axe = await new AxeBuilder({ page }).include('.rw').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('economy-aar-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.setViewportSize({ width: 320, height: 568 });
    check('economy-aar-320', await page.locator('.rw-aar').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: the points panel does not overflow the after-action');
    await shot(page, 'economy-aar-320');
    check('economy-count-console', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await full.close().catch(() => {}); }

  // ---- 2. the real campaign flow and the camp drawer (reduced motion) ----
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__economy', readFlag: '__economyReadBlocked', quotaFlag: '__economyQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const camp = async () => { await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 }); };
  const stored = () => page.evaluate(async () => JSON.parse(await (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline()));
  const raw = () => page.evaluate(async () => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline());
  try {
    const start = seededSave();
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(start));
    await camp();
    const open = await page.evaluate(() => ({ shop: !document.getElementById('camp-shop').hidden, rep: document.getElementById('camp-reputation').textContent,
      drawer: document.getElementById('camp-shop-drawer').hidden, turnIns: document.querySelectorAll('.camp-turnin-button').length, log: window.__levelUps ?? [] }));
    check('economy-camp-start', open.shop && open.drawer && open.rep.startsWith('Reputation 50 · Level 2 of 10') && open.turnIns === 2 && open.log.length === 0,
      `${open.rep}; drawer closed; ${open.turnIns} turn-in button; no moment on load`);
    // ---- the phase: Briefing, forced Union win, after-action points ----
    await page.locator('#camp-next').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const g = window.__game.game; g.paused = true;
      for (const u of g.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing';
      g.checkObjective(0, true);
    });
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    const resultText = await page.locator('#result-text').textContent();
    await page.locator('#result-action').click();
    await page.waitForFunction(() => document.querySelector('.rw-points[data-counted="true"]'), null, { timeout: 15000 });
    const aar = await page.evaluate(() => ({ points: Number(document.querySelector('.rw-points').dataset.points), shown: document.querySelector('.rw-points-v').textContent,
      lines: [...document.querySelectorAll('.rw-points-line')].map((li) => [li.dataset.line, li.querySelector('b').textContent]),
      level: document.querySelector('.rw-levelup')?.dataset.level, log: window.__levelUps, tag: document.querySelector('.rw-rule-tag')?.textContent }));
    await shot(page, 'economy-aar-campaign');
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('result').open && document.getElementById('result-title').textContent === 'Campaign saved', null, { timeout: 30000 });
    const after = await stored(), paid = after.ledger.find((r) => r.kind === 'phase');
    check('economy-aar-points', paid && aar.points === paid.points && aar.shown === `+${paid.points}` && after.reputation === 50 + paid.points && aar.tag === 'Game rule'
      && aar.lines[0][0] === 'grade' && resultText.includes(`Requisition points: +${paid.points}`),
    `after-action +${aar.points} (${aar.lines.map((l) => l.join(' ')).join(', ')}) = saved ledger ${paid?.points}; reputation ${after.reputation}`);
    check('economy-aar-levelup-once', after.level === economy.levelFor(50+paid.points) && aar.level === String(after.level) && JSON.stringify(aar.log) === JSON.stringify([after.level])
      && Array.from({length:after.level-start.level},(_,i)=>start.level+i+1).every(l=>after.ledger.some(r=>r.kind==='level'&&r.level===l)&&after.depot.some(it=>it.uid===`test-econ.1.level.${l}`&&it.source==='reward')) && after.shopSeen === 1,
    `level ${after.level}; moment log ${JSON.stringify(aar.log)}; reward card in the depot; shop still marked new`);
    // ---- back in camp: nothing replays; the drawer opens by keyboard ----
    await camp();
    const back = await page.evaluate(() => ({ log: window.__levelUps ?? [], moments: document.querySelectorAll('.rw-levelup-moment').length,
      fresh: !document.getElementById('camp-shop-new').hidden, focus: document.activeElement?.id }));
    check('economy-camp-no-replay', back.log.length === 0 && back.moments === 0 && back.fresh, `no level-up moment on camp load; "new" marker shown (${back.fresh})`);
    await page.locator('#camp-shop-toggle').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__entry.importing && document.getElementById('camp-shop-toggle').getAttribute('aria-expanded') === 'true'
      && document.querySelectorAll('#camp-shop-stock .camp-lot').length > 0, null, { timeout: 15000 });
    for (let i = 0; i < 60 && (await stored()).shopSeen !== after.level; i++) await page.waitForTimeout(250);
    const drawer = await page.evaluate(() => ({ lots: [...document.querySelectorAll('#camp-shop-stock .camp-lot')].map((n) => n.dataset.lot), focus: document.activeElement?.id,
      fresh: !document.getElementById('camp-shop-new').hidden, note: document.getElementById('camp-shop-note').textContent, cites: document.querySelectorAll('#camp-shop-stock .camp-lot-cite a').length }));
    const allowed = ARMS.filter(a=>!a.capturedOnly&&a.from<='1861-07'&&TIER_BY_ID[a.tier].rank<=TIER_BY_ID[economy.shopTierFor(after.level)].rank).map(a=>a.id);
    check('economy-drawer-keyboard', drawer.focus === 'camp-shop-toggle' && drawer.lots.length > 0 && drawer.lots.every((id) => allowed.includes(id)) && !drawer.fresh
      && drawer.note.includes('July 1861') && drawer.cites >= drawer.lots.length,
    `Enter opened the drawer (focus ${drawer.focus}); lots ${drawer.lots.join(', ')} (Common, in service by July 1861); marker cleared; ${drawer.cites} cited sources`);
    const axe = await new AxeBuilder({ page }).include('#front').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result.economyCampAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    check('economy-camp-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.locator('#camp-shop').scrollIntoViewIfNeeded(); await shot(page, 'economy-camp-drawer');
    // ---- buy: Escape cancels with storage untouched, then confirm ----
    const lot = drawer.lots.find(id=>['m1842','sixPdr'].includes(id)), buy = page.locator(`#camp-shop-stock [data-lot="${lot}"] .camp-buy-button`), before = await raw();
    await buy.click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    const dialog = await page.evaluate(() => ({ focus: document.activeElement.id, role: document.getElementById('camp-confirm').getAttribute('role'), ok: document.getElementById('camp-confirm-ok').textContent }));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('camp-confirm').open);
    check('economy-buy-cancel', dialog.focus === 'camp-confirm-cancel' && dialog.role === 'alertdialog' && dialog.ok === 'Buy for 30 points' && await raw() === before,
      `confirm ${dialog.role} with Cancel focused ("${dialog.ok}"); Escape leaves storage byte-identical`);
    await buy.click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    await page.locator('#camp-confirm-ok').click();
    await page.waitForFunction(() => !window.__entry.importing && /^Bought /.test(document.getElementById('camp-shop-status').textContent), null, { timeout: 15000 });
    const boughtSave = await stored(), boughtUi = await page.evaluate((lot) => ({ label: document.querySelector(`#camp-shop-stock [data-lot="${lot}"] .camp-buy-button`)?.textContent, focus: document.activeElement?.id }), lot);
    check('economy-buy', boughtSave.rp === after.rp - 30 && boughtSave.reputation === after.reputation && boughtSave.depot.some((it) => it.source === 'requisition' && it.itemId === lot)
      && boughtUi.label === 'Bought' && boughtUi.focus === 'camp-shop-status', `bought ${lot}: ${after.rp} → ${boughtSave.rp} points, reputation unchanged; lot marked Bought; focus ${boughtUi.focus}`);
    // ---- turn in the Legendary: confirm, level 3 moment once ----
    await page.locator(`#camp-depot [data-item-uid="${LEGENDARY}"] .camp-turnin-button`).click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    const turnOk = await page.locator('#camp-confirm-ok').textContent();
    await page.locator('#camp-confirm-ok').click();
    await page.waitForFunction(() => !window.__entry.importing && /^Turned in /.test(document.getElementById('camp-shop-status').textContent), null, { timeout: 15000 });
    const turned = await stored(), ui = await page.evaluate(() => ({ log: window.__levelUps, moment: document.querySelector('.rw-levelup-moment')?.dataset.level,
      status: document.getElementById('camp-shop-status').textContent, gone: !document.querySelector('[data-item-uid="test-econ.1.fixture.legend"]') }));
    check('economy-turn-in', turnOk === 'Turn in for 80 points' && turned.reputation === boughtSave.reputation + 80 && turned.rp === boughtSave.rp + 80 && ui.gone
      && !turned.depot.some((it) => it.uid === LEGENDARY), `confirmed "${turnOk}": reputation ${boughtSave.reputation} → ${turned.reputation}; card left the depot`);
    check('economy-camp-levelup-once', turned.level === economy.levelFor(boughtSave.reputation+80) && ui.moment === String(turned.level) && JSON.stringify(ui.log) === JSON.stringify([turned.level]) && ui.status.includes(`Reputation level ${turned.level} reached`)
      && Array.from({length:turned.level-boughtSave.level},(_,i)=>boughtSave.level+i+1).every(l=>turned.depot.some(it=>it.uid===`test-econ.1.level.${l}`)), `level ${turned.level}; moment ${ui.moment}; log ${JSON.stringify(ui.log)}; reward card dealt`);
    await shot(page, 'economy-camp-levelup');
    await page.setViewportSize({ width: 320, height: 568 });
    check('economy-camp-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide with the drawer open: no horizontal overflow');
    await page.locator('#camp-shop').scrollIntoViewIfNeeded(); await shot(page, 'economy-camp-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await camp();
    check('economy-camp-reload', await page.evaluate(() => (window.__levelUps ?? []).length === 0 && !document.querySelector('.rw-levelup-moment')), 'reloading the camp replays no level-up moment');
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('economy-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
}

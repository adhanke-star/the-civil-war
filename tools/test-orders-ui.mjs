// Browser checks for decision cards, camp orders, stores, army upgrades and affix re-rolls (P5c). To be registered in
// tools/test.mjs (shard 3, `node tools/test.mjs --orders`). `ordersControls({ browser, url, check, shot, result, watchErrors })`.
// A fictional one-phase campaign on the Henry Hill ground (assets/campaign.json, a test pack and assets/decisions.json are
// served by Playwright route interception; nothing ships for them). Slot 1 is seeded at reputation level 3 with points to
// spend. In camp: the orders section, stores and the Record book / Settings buttons are present; one brigade's order is set
// to Drill by keyboard; the Requisition drawer sells a store lot and an army upgrade and re-rolls an affix, each behind a
// confirm (Escape cancels with storage untouched; the re-roll's confirm shows the before and after affix). Next deals the
// phase's two decision cards before the field loads: each is chosen by keyboard and reveals what really happened with its
// sources; then the army marches out (once) and the Briefing opens with the decision's and the camp's morale on the field.
// Re-entering the camp and pressing Next again shows the recorded choices and writes nothing. Axe, 320 px, screenshots.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import * as economy from '../src/franchise/economy.js';
import { validateSnapshot } from '../src/franchise/save.js';
import { CAMP } from '../src/franchise/tuning.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-orders';
const PACK = { version: 1, id: PACK_ID, title: 'Fictional camp test battle (test only)', phases: [
  { id: 'p1', scenario: { ...structuredClone(HH), id: 'test-orders-p1', title: 'Fictional camp phase (test only)', attacker: 'US',
    subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the camp checks; nothing here is history.' } } }] };
const CAMPAIGN = { version: 1, id: 'test-orders', title: 'Fictional camp campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }] };
const option = (id, label, gain, cost, effects) => ({ id, label, gain, cost, effects });
const DECK = { version: 1, cards: [
  { id: 'test-first', pack: PACK_ID, phase: 'p1', title: 'Fictional first dilemma (test only)', dilemma: 'A fictional dilemma: nothing here is history.',
    sources: [{ label: 'Fictional source A', url: 'https://example.org/fictional-a' }, { label: 'Fictional source B' }], provenance: 'Verified', historicalOption: 'steady',
    historicalChoice: 'Fictional: the steady choice was the one made in this test story.', options: [
      option('steady', 'Fictional steady option', '+4 morale for every Union formation in this phase.', '10 rations.', [{ kind: 'morale', amount: 4 }, { kind: 'store', store: 'rations', amount: -10 }]),
      option('careful', 'Fictional careful option', '+10 requisition points.', '−3 morale.', [{ kind: 'rp', amount: 10 }, { kind: 'morale', amount: -3 }])] },
  { id: 'test-second', pack: PACK_ID, phase: 'p1', title: 'Fictional second dilemma (test only)', dilemma: 'A second fictional dilemma.',
    sources: [{ label: 'Fictional source C' }], provenance: 'Inferred', historicalOption: 'gain', historicalChoice: 'Fictional: the gain choice was made.', options: [
      option('gain', 'Fictional points option', '+10 requisition points.', '−2 morale.', [{ kind: 'rp', amount: 10 }, { kind: 'morale', amount: -2 }]),
      option('stores', 'Fictional stores option', '+20 ammunition.', '−2 morale.', [{ kind: 'store', store: 'ammunition', amount: 20 }, { kind: 'morale', amount: -2 }]),
      option('dear', 'Fictional dear option', '+6 morale.', '5000 requisition points.', [{ kind: 'morale', amount: 6 }, { kind: 'rp', amount: -5000 }])] }] };
const SPARE = 'test-orders.1.fixture.spare';

/** Slot 1 at reputation 300 (level 4) with 300 points; one worn Lorenz waits in the depot for the re-roll. */
function seededSave() {
  let s = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
  const turn = { uid: 'test-orders.1.fixture.turned', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional test stores' };
  const rep = 300, level = economy.levelFor(rep);
  s = validateSnapshot({ ...s, depot: [{ uid: SPARE, itemId: 'lorenz', tier: 'uncommon', conditionId: 'worn', source: 'capture', from: 'Fictional test stores' }],
    rp: rep, reputation: rep, level, ledger: [...Array.from({ length: level - 1 }, (_, i) => ({ kind: 'level', level: i + 2, uid: `test-orders.1.fixture.level.${i + 2}` })),
      { kind: 'turnIn', item: turn, points: rep, at: 0 }] });
  return s;
}

export async function ordersControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__orders', readFlag: '__ordersReadBlocked', quotaFlag: '__ordersQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  await ctx.route('**/assets/decisions.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DECK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const camp = async () => { await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing && window.__entry.decks, null, { timeout: 60000 }); };
  const stored = () => page.evaluate(async () => JSON.parse(await (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline()));
  const raw = () => page.evaluate(async () => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline());
  const idle = () => page.waitForFunction(() => !window.__entry.importing, null, { timeout: 15000 });
  const axe = async (include, key) => {
    const a = await new AxeBuilder({ page }).include(include).analyze();
    const bad = a.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    return bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : '';
  };
  const tabTo = async (id, max = 12) => {
    for (let i = 0; i < max && await page.evaluate(() => document.activeElement?.id) !== id; i++) await page.keyboard.press('Tab');
    return page.evaluate(() => document.activeElement?.id);
  };
  try {
    const start = seededSave();
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(start));
    await camp();
    // ---- the camp: orders, stores, Record book and Settings ----
    const open = await page.evaluate(() => ({ orders: !document.getElementById('camp-orders').hidden, stores: document.querySelectorAll('#camp-stores .camp-store').length,
      selects: document.querySelectorAll('.camp-order-select').length, values: [...document.querySelectorAll('.camp-order-select')].map((n) => n.value),
      book: !document.getElementById('camp-record-book').hidden && document.getElementById('camp-record-book').textContent, settings: document.getElementById('entry-settings')?.textContent,
      supply: document.getElementById('camp-supply').textContent, capacity: document.getElementById('camp-capacity').textContent,
      decisions: [...document.querySelectorAll('#camp-decisions-list li')].map((li) => li.textContent) }));
    check('orders-camp', open.orders && open.stores === 7 && open.selects === 2 && open.values.every((v) => v === 'rest') && open.book === 'Record book' && open.settings === 'Settings'
      && /2 of your brigades take the field/.test(open.supply) && open.capacity.startsWith(`Depot: 1 of ${CAMP.start.wagons * CAMP.cardsPerWagon} cards`) && open.decisions.length === 2,
    `orders shown (${open.selects} brigades on Rest), ${open.stores} stores, "${open.supply.slice(0, 70)}…", ${open.capacity.slice(0, 40)}…; Record book and Settings present; ${open.decisions.length} decisions waiting`);
    await page.locator('#camp-order-0').focus();
    await page.keyboard.press('ArrowDown');
    await idle();
    await page.waitForFunction(() => /Drill/.test(document.getElementById('camp-orders-status').textContent), null, { timeout: 15000 });
    const order = await stored(), orderUi = await page.evaluate(() => ({ focus: document.activeElement?.id, value: document.getElementById('camp-order-0').value }));
    check('orders-keyboard', order.army.find((b) => b.id === 'sherman').order === 'drill' && orderUi.focus === 'camp-order-0' && orderUi.value === 'drill',
      `ArrowDown on the first order set Drill and saved it (focus stays on ${orderUi.focus})`);
    // ---- the drawer: a store lot, an upgrade, a re-roll ----
    await page.locator('#camp-shop-toggle').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#camp-shop-more [data-store]').length === 7, null, { timeout: 15000 }); await idle();
    const beforeBuy = await stored();
    await page.locator('#camp-shop-more [data-store="ammunition"] button').click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    await page.locator('#camp-confirm-ok').click(); await idle();
    const lot = CAMP.storeLots.ammunition, afterStores = await stored();
    check('orders-buy-stores', afterStores.stores?.ammunition === CAMP.start.ammunition + lot.qty && afterStores.rp === beforeBuy.rp - lot.price && afterStores.reputation === beforeBuy.reputation,
      `bought ${lot.qty} ammunition for ${lot.price}: ${CAMP.start.ammunition} → ${afterStores.stores?.ammunition}; points ${beforeBuy.rp} → ${afterStores.rp}; reputation kept`);
    await page.locator('#camp-shop-more [data-upgrade="wagons"] button').click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    await page.locator('#camp-confirm-ok').click(); await idle();
    const upgraded = await stored(), ownedText = await page.locator('#camp-shop-more [data-upgrade="wagons"] button').textContent();
    check('orders-buy-upgrade', JSON.stringify(upgraded.upgrades) === '["wagons"]' && upgraded.rp === afterStores.rp - CAMP.upgrades.wagons.price && ownedText === 'Owned',
      `Wagons upgrade bought once (${ownedText}); points ${afterStores.rp} → ${upgraded.rp}`);
    await page.locator('#camp-reroll-item').selectOption(SPARE); await idle();
    const preview = await page.evaluate(async (uid) => {
      const { rerollPreview } = await import('./src/franchise/economy.js');
      const p = rerollPreview(window.__entry.saved, { uid }); return { to: p.to, after: p.after.name, before: p.before.name, price: p.price };
    }, SPARE);
    const beforeRoll = await raw();
    await page.locator('#camp-reroll-heading').locator('xpath=..').locator('.camp-buy-button').click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    const note = await page.locator('#camp-confirm-note').textContent();
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('camp-confirm').open);
    const untouched = await raw() === beforeRoll;
    await page.locator('#camp-reroll-heading').locator('xpath=..').locator('.camp-buy-button').click();
    await page.waitForFunction(() => document.getElementById('camp-confirm').open);
    await page.locator('#camp-confirm-ok').click(); await idle();
    const rolled = await stored(), card = rolled.depot.find((it) => it.uid === SPARE);
    check('orders-reroll', untouched && note.includes(`Before: ${preview.before}`) && note.includes(`After: ${preview.after}`) && card?.conditionId === preview.to
      && rolled.ledger.at(-1).kind === 'reroll' && rolled.rp === upgraded.rp - preview.price,
    `confirm shows ${preview.before} → ${preview.after}; Escape left storage byte-identical; confirmed re-roll saved (${card?.conditionId}) for ${preview.price}`);
    const campAxe = await axe('#front', 'ordersCampAxe');
    check('orders-camp-axe', !campAxe, campAxe || '0 serious/critical in the camp with the drawer open');
    await page.locator('#camp-orders').scrollIntoViewIfNeeded(); await shot(page, 'orders-camp');
    await page.locator('#camp-shop-more').scrollIntoViewIfNeeded(); await shot(page, 'orders-drawer');
    await page.setViewportSize({ width: 320, height: 568 });
    check('orders-camp-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide with orders and the drawer: no horizontal overflow');
    await page.locator('#camp-orders').scrollIntoViewIfNeeded(); await shot(page, 'orders-camp-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    // ---- Next: two decision cards by keyboard, before the field ----
    await camp();
    await page.locator('#camp-next').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('camp-decision')?.open, null, { timeout: 15000 });
    const first = await page.evaluate(() => ({ heading: document.getElementById('camp-decision-heading').textContent, focus: document.activeElement?.id, field: !!window.__game,
      count: document.getElementById('camp-decision-count').textContent, options: document.querySelectorAll('#camp-decision-options input').length }));
    check('orders-decision-shown', first.heading === DECK.cards[0].title && first.focus === 'camp-decision-heading' && !first.field && first.options === 2 && first.count.startsWith('Decision 1 of 2'),
      `before the field loads: "${first.heading}" (${first.count}), focus on the heading, ${first.options} options`);
    const radio = await tabTo('camp-decision-option-0');
    await page.keyboard.press('Space');
    const choose = await tabTo('camp-decision-choose');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('camp-decision-reveal').hidden && !window.__entry.importing, null, { timeout: 15000 });
    const reveal = await page.evaluate(() => ({ focus: document.activeElement?.id, text: document.getElementById('camp-decision-history').textContent, provenance: document.getElementById('camp-decision-provenance').textContent,
      sources: document.querySelectorAll('#camp-decision-sources li').length, links: document.querySelectorAll('#camp-decision-sources a').length, match: document.getElementById('camp-decision-match').textContent }));
    const chosen = await stored();
    check('orders-decision-keyboard', radio === 'camp-decision-option-0' && choose === 'camp-decision-choose' && chosen.decisions?.[0]?.optionId === 'steady' && chosen.stores.rations === CAMP.start.rations - 10,
      `Tab to the first option, Space, Tab to Choose, Enter: saved "${chosen.decisions?.[0]?.optionId}" and its rations cost`);
    check('orders-decision-reveal', reveal.focus === 'camp-decision-reveal-heading' && reveal.text === DECK.cards[0].historicalChoice && reveal.provenance === 'Verified' && reveal.sources === 2 && reveal.links === 1
      && reveal.match.includes('as it happened'), `revealed what really happened (${reveal.provenance}, ${reveal.sources} sources), focus on its heading`);
    const decisionAxe = await axe('#camp-decision', 'ordersDecisionAxe');
    check('orders-decision-axe', !decisionAxe, decisionAxe || '0 serious/critical in the decision dialog');
    await shot(page, 'orders-decision-reveal');
    await page.setViewportSize({ width: 320, height: 568 });
    check('orders-decision-320', await page.locator('#camp-decision').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: the decision dialog does not overflow');
    await shot(page, 'orders-decision-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await tabTo('camp-decision-continue'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('camp-decision-heading').textContent.includes('second') && document.getElementById('camp-decision').open, null, { timeout: 15000 });
    const dear = await page.evaluate(() => document.getElementById('camp-decision-option-2').disabled);
    await tabTo('camp-decision-option-0'); await page.keyboard.press('Space');
    await tabTo('camp-decision-choose'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('camp-decision-reveal').hidden && !window.__entry.importing, null, { timeout: 15000 });
    await tabTo('camp-decision-continue');
    // ---- the march and the field ----
    await Promise.all([page.waitForURL(/\?campaign=1$/, { timeout: 60000 }), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    const marched = await stored(), award = marched.decisions?.[0]?.awardId;
    const field = await page.evaluate(() => Object.fromEntries(window.__game.game.units.filter((u) => ['sherman', 'ricketts', 'franklin', 'jackson'].includes(u.id)).map((u) => [u.id, u.morale])));
    const decided = 4 - 2, rest = CAMP.rest.morale;
    check('orders-march', dear && marched.decisions.length === 2 && marched.ready?.awardId === award && marched.army.find((b) => b.id === 'sherman').drilled === 1
      && marched.ready.morale.ricketts === rest && !('sherman' in marched.ready.morale),
    `the unaffordable option was closed; two choices and one march saved for ${award}; Drill carried out; Rest morale for the battery`);
    check('orders-field-morale', field.sherman === CAMP.defaultMorale + decided && field.ricketts === CAMP.defaultMorale + decided + rest && field.franklin === CAMP.defaultMorale + decided && field.jackson === 84,
      `field morale: drilled brigade ${field.sherman}, rested battery ${field.ricketts}, other Union ${field.franklin}, enemy ${field.jackson} (unchanged)`);
    await shot(page, 'orders-briefing');
    // ---- re-entering: the recorded choices stand, nothing is written ----
    await camp();
    const again = await page.evaluate(() => [...document.querySelectorAll('#camp-decisions-list li')].map((li) => li.textContent));
    const before = await raw();
    await Promise.all([page.waitForURL(/\?campaign=1$/, { timeout: 60000 }), page.locator('#camp-next').click()]);
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    check('orders-reenter', again.length === 2 && again.every((t) => t.includes('you chose')) && await raw() === before,
      `camp shows the recorded choices (${again.map((t) => t.split(':')[0]).join('; ')}); Next went straight to the field and wrote nothing`);
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('orders-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
}

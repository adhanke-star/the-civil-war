// Browser checks for difficulty, the camp's effects in battle and captured colours (contract P5d). To be registered in
// tools/test.mjs (shard 3, `node tools/test.mjs --hooks`). `hooksControls({ browser, url, check, shot, result, watchErrors })`.
// A fictional two-phase campaign on the Henry Hill ground (assets/campaign.json and a test pack served by Playwright route
// interception; nothing ships for them):
// 1. Title: New campaign offers Recruit / Veteran / General above the slots (Veteran checked, described, axe clean, 320 px);
//    choosing General and an empty slot starts the campaign at General, saved, and the camp names it.
// 2. The Battles list has its own difficulty: General adds &difficulty=general to every phase link, Veteran adds nothing.
// 3. A seeded slot-1 save (phase one recorded with a captured colour, the army marched out short of shoes and ammunition):
//    the camp's trophy shelf lists the colour (axe, 320 px); the field of phase two starts at General with the brigade's
//    unit card naming its shortages (game rules) and the rounds it has now.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import { CAMP } from '../src/franchise/tuning.js';
import { validateSnapshot } from '../src/franchise/save.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-hooks';
const REGIMENT = '33rd Fictional Infantry (test only)';
const phaseOf = (id, title) => ({ id, scenario: { ...structuredClone(HH), id: `test-hooks-${id}`, title, attacker: 'US',
  subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the P5d checks; nothing here is history.' } } });
const PACK = { version: 1, id: PACK_ID, title: 'Fictional hooks test battle (test only)', phases: [phaseOf('p1', 'Fictional phase one (test only)'), phaseOf('p2', 'Fictional phase two (test only)')] };
for (const p of PACK.phases) { const j = p.scenario.units.find((u) => u.id === 'jackson'); j.regiments = [REGIMENT, ...(j.regiments || []).slice(1)]; }
const CAMPAIGN = { version: 1, id: 'test-hooks', title: 'Fictional hooks campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }, { packId: PACK_ID, phaseId: 'p2' }] };

/** Slot 1 at General: phase one recorded with one captured colour, then marched out for phase two short of shoes and ammunition. */
function seededSave() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z', difficulty: 'general' });
  const p1 = campaign.campaignPhase(s0, CAMPAIGN);
  const units = [...PACK.phases[0].scenario.units].map((d) => ({ id: d.id, side: d.side, menStart: d.men, men: d.men, ...(d.type === 'artillery' ? { gunsStart: d.guns, guns: d.guns } : {}) }));
  const s1 = campaign.recordPhase(s0, CAMPAIGN, { packId: PACK_ID, phaseId: 'p1', awardId: p1.awardId, winner: 'US', grade: 'Victory', units, loot: [],
    colours: [{ unitId: 'jackson', regiment: REGIMENT, side: 'CS', by: 'Sherman' }], at: '2026-10-11T12:30:00Z' });
  const p2 = campaign.campaignPhase(s1, CAMPAIGN);
  return validateSnapshot({ ...s1, ready: { awardId: p2.awardId, morale: { sherman: -8 }, short: { sherman: ['ammunition', 'shoes'] } } });
}

export async function hooksControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__hooks', readFlag: '__hooksReadBlocked', quotaFlag: '__hooksQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const title = async () => { await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing && !document.getElementById('entry-new-campaign').hidden, null, { timeout: 60000 }); };
  const stored = (slot) => page.evaluate(async (n) => JSON.parse(await (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: n }).readRawBaseline()), slot);
  const axe = async (include, key) => {
    const a = await new AxeBuilder({ page }).include(include).analyze();
    const bad = a.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    return bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : '';
  };
  const fits = (sel) => page.locator(sel).evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
  try {
    // ---- 1. New campaign offers the difficulty ----
    await title();
    await page.locator('#entry-new-campaign').click();
    await page.waitForFunction(() => document.querySelectorAll('#slot-rows .slot-choice').length === 3, null, { timeout: 30000 });
    const offer = await page.evaluate(() => ({ radios: [...document.querySelectorAll('#slot-difficulty input[type="radio"]')].map((r) => [r.value, r.checked]),
      legend: document.querySelector('#slot-difficulty legend')?.textContent, words: document.getElementById('slot-difficulty').textContent, focus: document.activeElement?.id }));
    check('hooks-new-campaign-offer', JSON.stringify(offer.radios) === JSON.stringify([['recruit', false], ['veteran', true], ['general', false]]) && offer.legend === 'Difficulty'
      && /never pauses/.test(offer.words) && /same at every level/.test(offer.words) && offer.focus === 'slot-choice-1',
    `New campaign offers ${offer.radios.map(([v, c]) => `${v}${c ? ' (checked)' : ''}`).join(', ')}; focus ${offer.focus}`);
    const pickerAxe = await axe('#slot-picker', 'hooksPickerAxe');
    check('hooks-new-campaign-axe', !pickerAxe, pickerAxe || '0 serious/critical in the New campaign dialog');
    await shot(page, 'hooks-new-campaign');
    await page.setViewportSize({ width: 320, height: 568 });
    check('hooks-new-campaign-320', await fits('#slot-picker'), '320px wide: the New campaign dialog with its difficulty does not overflow');
    await shot(page, 'hooks-new-campaign-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#slot-difficulty-general').check();
    await Promise.all([page.waitForURL(/\?camp=1$/, { timeout: 60000 }), page.locator('#slot-choice-1').click()]);
    await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 });
    const started = await stored(1), campLine = await page.evaluate(() => ({ text: document.getElementById('camp-difficulty').textContent, level: document.getElementById('camp-difficulty').dataset.difficulty }));
    check('hooks-camp-difficulty', started.difficulty === 'general' && campLine.level === 'general' && campLine.text.startsWith('Difficulty: General.'),
      `saved difficulty ${started.difficulty}; camp: "${campLine.text.slice(0, 70)}…"`);

    // ---- 2. the Battles list's own difficulty ----
    await title();
    await page.locator('#entry-battles').click();
    await page.waitForFunction(() => document.querySelectorAll('#entry-battle-rows a').length === 2, null, { timeout: 30000 });
    const links = () => page.evaluate(() => [...document.querySelectorAll('#entry-battle-rows a')].map((a) => new URL(a.href).search));
    const veteran = await links();
    await page.locator('#entry-battles-difficulty').selectOption('general');
    const general = await links(), note = await page.locator('#entry-battles-difficulty-note').textContent();
    await page.locator('#entry-battles-difficulty').selectOption('veteran');
    const back = await links();
    check('hooks-battles-difficulty', JSON.stringify(veteran) === JSON.stringify([`?battle=${PACK_ID}&phase=p1`, `?battle=${PACK_ID}&phase=p2`])
      && general.every((q) => q.endsWith('&difficulty=general')) && JSON.stringify(back) === JSON.stringify(veteran) && note.startsWith('General:'),
    `Veteran links ${JSON.stringify(veteran)}; General ${JSON.stringify(general)}`);

    // ---- 3. the seeded save: trophy shelf, then the field's card ----
    await seedProgress(page, JSON.stringify(seededSave()));
    await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 });
    const shelf = await page.evaluate(() => { const row = document.querySelector('#camp-shelf [data-trophy="colours"]');
      return { count: row?.dataset.count, items: [...(row?.querySelectorAll('.camp-colours li') || [])].map((li) => li.textContent), icons: row?.querySelectorAll('svg').length }; });
    check('hooks-trophy-shelf', shelf.count === '1' && shelf.icons === 1 && shelf.items.length === 1 && shelf.items[0].startsWith(`${REGIMENT}, taken by Sherman at`),
      `trophy shelf: ${shelf.count} colour (${JSON.stringify(shelf.items)})`);
    const shelfAxe = await axe('#camp-trophies', 'hooksShelfAxe');
    check('hooks-trophy-axe', !shelfAxe, shelfAxe || '0 serious/critical on the trophy shelf');
    await page.locator('#camp-trophies').scrollIntoViewIfNeeded(); await shot(page, 'hooks-trophy-shelf');
    await page.setViewportSize({ width: 320, height: 568 });
    check('hooks-camp-320', await fits('#front'), '320px wide: the camp with its colours and difficulty does not overflow');
    await page.locator('#camp-trophies').scrollIntoViewIfNeeded(); await shot(page, 'hooks-trophy-shelf-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(url + '?campaign=1');
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    const field = await page.evaluate(async () => {
      const { difficultyOf } = await import('./src/game.js');
      const g = window.__game.game, u = g.units.find((x) => x.id === 'sherman');
      g.select(u);
      await new Promise((r) => setTimeout(r, 400));
      const line = document.getElementById('uc-camp');
      return { level: difficultyOf(g), defAmmo: u.def.ammo, defFatigue: u.def.fatigue, ammo: u.ammo, fatigue: u.fatigue, text: line?.textContent ?? '', hidden: line ? line.hidden : true };
    });
    result.hooksCard = field;
    check('hooks-field-shortage', field.level === 'general' && field.defAmmo === CAMP.battle.ammo && field.defFatigue === CAMP.battle.fatigue && field.ammo < 100 && field.fatigue > 0,
      `phase two at ${field.level}: the short brigade started with ${field.defAmmo}% of its rounds (now ${Math.round(field.ammo)}%) and fatigue ${field.defFatigue} (now ${Math.round(field.fatigue)})`);
    check('hooks-card-shortage', !field.hidden && /Short of shoes: started tired/.test(field.text) && /Short of ammunition: started with 50% of its rounds/.test(field.text)
      && /rounds now \d+%/.test(field.text) && /\(game rules\)$/.test(field.text), `unit card: "${field.text}"`);
    await shot(page, 'hooks-card-shortage');
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('hooks-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
}

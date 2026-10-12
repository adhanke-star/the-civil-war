// Browser checks for card art, period portraits and the living title and camp backdrop (P6b), for tools/test.mjs shard 2 and
// `node tools/test.mjs --art`. `artControls({ browser, url, check, shot, result, watchErrors })`. Three parts:
// 1. Title (full motion): the Homer backdrop loads with its slow pan and the drifting smoke layer, both pause while the tab
//    is hidden; the title type sits on its own panel (axe clean); the whole title stays under 5 MB with no renderer,
//    terrain or atlas request; 320 px fits. Under reduced motion the pan and smoke are static.
// 2. Loot and briefing (reduced motion, on the title page): a dealt loot card shows the arm's picture and its "Pictured:"
//    line; the Briefing of Shiloh's first phase lists Col. Everett Peabody (named in its text) first, with his portrait.
// 3. Camp (reduced motion): a seeded campaign save (slot 1, the shipped campaign) shows the Shiloh camp view with its
//    caption, the trophy shelf from the save (2 captured guns, 1 captured arm, 15 wagons = 12 icons and "×15", level 1),
//    brigade cards with Hazen's portrait and the generic silhouette for W. H. Gibson (no sourced portrait), depot cards
//    with their pictures; axe clean; 320 px; screenshots.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import { CAMP } from '../src/franchise/economy.js';
import { validateSnapshot } from '../src/franchise/save.js';

const CAMPAIGN = JSON.parse(fs.readFileSync(new URL('../assets/campaign.json', import.meta.url)));
const MB = 1024 * 1024;

/** Slot 1 at the start of the shipped campaign with fictional captures and a larger wagon train (test fixture only). */
function seededSave() {
  const s = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-11T12:00:00Z' });
  const lot = (uid, itemId, tier, source) => ({ uid, itemId, tier, conditionId: 'serviceable', source, from: 'Fictional test stores' });
  return validateSnapshot({ ...s, stores: { ...CAMP.start, wagons: 15 },
    depot: [lot('test-art.1.gun.1', 'napoleon', 'rare', 'capture'), lot('test-art.1.gun.2', 'napoleon', 'rare', 'capture'),
      lot('test-art.1.arm.1', 'enfield', 'rare', 'capture'), lot('test-art.1.req.1', 'springfield', 'rare', 'requisition')] });
}
const imagesLoaded = (sel) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every((i) => i.complete && i.naturalWidth > 0);

export async function artControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. the living title ----
  const full = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  try {
    const page = await full.newPage(), errors = []; watchErrors(page, url, errors);
    const requests = [], reads = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('response', (r) => { if (r.url().startsWith(url)) reads.push(r.body().then((b) => b.length).catch(() => 0)); });
    const started = Date.now();
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('title-home-sweet-home.webp') && e.responseEnd > 0)
      && !document.getElementById('entry-backdrop').hidden, null, { timeout: 30000 });
    const bytes = (await Promise.all(reads)).reduce((a, b) => a + b, 0), elapsed = Date.now() - started;
    result.artTitleLoad = { bytes, elapsedMs: elapsed, requests: requests.length };
    check('art-title-bytes', bytes > 0 && bytes < 5 * MB && elapsed <= 10000 && !requests.some((p) => /terrain|vendor\/three|src\/fx\/|assets\/figures/.test(p)),
      `${(bytes / MB).toFixed(2)} MB in ${elapsed} ms with the backdrop; no terrain/renderer/effects/atlas request`);
    const title = await page.evaluate(() => {
      const box = document.getElementById('entry-backdrop'), img = box.querySelector('.entry-backdrop-img'), smoke = [...box.querySelectorAll('.entry-smoke i')];
      return { mode: box.dataset.mode, key: box.dataset.key, motion: box.dataset.motion, bg: getComputedStyle(img).backgroundImage, pan: getComputedStyle(img).animationName,
        smoke: smoke.map((i) => getComputedStyle(i).animationName), caption: document.getElementById('entry-backdrop-caption').textContent,
        panel: getComputedStyle(document.getElementById('entry-title')).backgroundColor, focus: document.activeElement?.id };
    });
    check('art-title-backdrop', title.mode === 'title' && title.key === 'title' && title.motion === 'full' && title.bg.includes('title-home-sweet-home.webp')
      && title.pan === 'entry-pan' && title.smoke.length === 5 && title.smoke.every((n) => n === 'entry-smoke') && title.caption.includes('Winslow Homer')
      && /rgba\(12, 13, 16, 0\.8/.test(title.panel) && title.focus === 'entry-continue',
    `${title.key} backdrop panning (${title.pan}), ${title.smoke.length} smoke puffs, caption "${title.caption.slice(0, 60)}…", title panel ${title.panel}, focus ${title.focus}`);
    const paused = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      const box = document.getElementById('entry-backdrop');
      const state = { cls: box.classList.contains('is-paused'), pan: getComputedStyle(box.querySelector('.entry-backdrop-img')).animationPlayState,
        smoke: getComputedStyle(box.querySelector('.entry-smoke i')).animationPlayState };
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      return { ...state, resumed: !box.classList.contains('is-paused') };
    });
    check('art-title-hidden-pause', paused.cls && paused.pan === 'paused' && paused.smoke === 'paused' && paused.resumed, `hidden tab: ${JSON.stringify(paused)}`);
    const axe = await new AxeBuilder({ page }).include('#front').analyze(); result.artTitleAxe = axe.violations;
    check('art-title-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id)));
    await shot(page, 'art-title');
    await page.setViewportSize({ width: 320, height: 568 });
    check('art-title-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth
      && [...n.querySelectorAll('#entry-title button:not([hidden]),#entry-title a')].filter((b) => b.getClientRects().length).every((b) => b.getBoundingClientRect().right <= innerWidth)),
    '320px: the title and its buttons fit over the backdrop');
    await shot(page, 'art-title-320');
    check('art-title-console', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await full.close().catch(() => {}); }

  // ---- 2 and 3: reduced motion, the loot card, the briefing and the camp ----
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__art', readFlag: '__artReadBlocked', quotaFlag: '__artQuota' });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  try {
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('entry-backdrop').hidden, null, { timeout: 30000 });
    const still = await page.evaluate(() => { const box = document.getElementById('entry-backdrop');
      return { motion: box.dataset.motion, pan: getComputedStyle(box.querySelector('.entry-backdrop-img')).animationName,
        smoke: [...box.querySelectorAll('.entry-smoke i')].map((i) => getComputedStyle(i).animationName) }; });
    check('art-title-reduced', still.motion === 'reduced' && still.pan === 'none' && still.smoke.every((n) => n === 'none'), `reduced motion: ${JSON.stringify(still)}`);

    // the loot reveal: one dealt card, turned
    await page.evaluate(async () => { const { mountReward } = await import('./src/reward/sequence.js');
      mountReward(document.body, { seed: 7, grade: 'Decisive', mode: 'one', rememberReplay: false }); });
    await page.waitForSelector('.rw-deal .rw-card'); await page.keyboard.press('s');
    await page.waitForFunction(() => document.querySelector('.rw-card.is-up'), null, { timeout: 10000 });
    await page.waitForFunction(imagesLoaded, '.rw-card.is-up .rw-art-img', { timeout: 15000 });
    const loot = await page.evaluate(() => { const c = document.querySelector('.rw-card.is-up'), a = c.querySelector('.rw-art');
      return { arm: a?.dataset.arm, kind: a?.dataset.kind, line: c.querySelector('.rw-pictured')?.textContent ?? '', band: !!c.querySelector('.rw-band .rw-shape'),
        glow: getComputedStyle(a, '::before').backgroundImage, alt: c.querySelector('.rw-art-img')?.alt ?? '' }; });
    check('art-loot-card', /^(Pictured|Generic)/.test(loot.line) && loot.band && /radial-gradient/.test(loot.glow) && loot.alt.length > 0,
      `${loot.arm} (${loot.kind}): "${loot.line.slice(0, 80)}…"; rarity band and shape kept; rarity light ${loot.glow.slice(0, 40)}`);
    await shot(page, 'art-loot-card');
    const lootAxe = await new AxeBuilder({ page }).include('.rw').analyze();
    const lootBad = lootAxe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('art-loot-axe', lootBad.length === 0, lootBad.length ? lootBad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${lootAxe.violations.length} minor)`);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('.rw-deal'), null, { timeout: 10000 }).catch(() => {});

    // the briefing's commanders (the real Shiloh phase one; mounted directly, no battlefield)
    await page.evaluate(async () => {
      const { mountBriefing } = await import('./src/ui/briefing.js');
      const pack = await (await fetch('./assets/packs/shiloh.json')).json();
      const battle = document.getElementById('battle'); if (battle) battle.id = 'battle-hold';
      window.__artBriefing = mountBriefing({ scenario: pack.phases[0].scenario, phase: { loan: true }, game: { paused: false, playerSide: 'US' },
        hud: { setPaused() {}, playerSide: 'US' }, effects: null, onBegin() {} });
      if (battle) battle.id = 'battle';
    });
    await page.waitForFunction(imagesLoaded, '#briefing .briefing-commanders img', { timeout: 15000 }).catch(async (e) => {
      // say what the briefing holds when its portraits never finish (CI diagnosis)
      const why = await page.evaluate(() => ({ briefings: document.querySelectorAll('#briefing').length,
        section: !!document.querySelector('#briefing .briefing-commanders'), hidden: document.querySelector('#briefing .briefing-commanders')?.hidden ?? null,
        imgs: [...document.querySelectorAll('#briefing .briefing-commanders img')].map((i) => [i.getAttribute('src'), i.complete, i.naturalWidth]) }));
      throw new Error(`briefing portraits never loaded: ${JSON.stringify(why)} (${e.message.split('\n')[0]})`);
    });
    const brief = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#briefing .briefing-commander')].map((li) => [li.dataset.commander, li.className]),
      first: document.querySelector('#briefing .briefing-commander-name')?.textContent, focus: document.activeElement?.id }));
    check('art-briefing-commanders', brief.rows[0]?.[0] === 'Everett Peabody' && brief.rows[0][1].includes('is-sourced') && brief.first === 'Col. Everett Peabody'
      && brief.rows.length <= 6 && brief.focus === 'briefing-begin',
    `${brief.rows.length} commanders: ${brief.rows.map(([n, c]) => `${n}${c.includes('is-sourced') ? '' : ' (silhouette)'}`).join(', ')}; focus ${brief.focus}`);
    const briefAxe = await new AxeBuilder({ page }).include('#briefing').analyze();
    check('art-briefing-axe', briefAxe.violations.length === 0, JSON.stringify(briefAxe.violations.map((v) => v.id)));
    await shot(page, 'art-briefing');
    await page.setViewportSize({ width: 320, height: 568 });
    check('art-briefing-320', await page.locator('#briefing').evaluate((d) => d.scrollWidth <= d.clientWidth + 1
      && [...d.querySelectorAll('.briefing-commander-name')].every((n) => parseFloat(getComputedStyle(n).fontSize) >= 12)), '320px: the commanders wrap inside the Briefing');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#briefing-begin').click();

    // the camp
    await seedProgress(page, JSON.stringify(seededSave()));
    await page.goto(url + '?camp&nosw'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('entry-backdrop').hidden && document.querySelectorAll('#camp-army .rw-bwho[data-portrait]').length
      === document.querySelectorAll('#camp-army [data-brigade-id]').length, null, { timeout: 30000 });
    await page.waitForFunction(imagesLoaded, '#camp-army .rw-bportrait img', { timeout: 15000 });
    await page.waitForFunction(imagesLoaded, '#camp-depot .rw-art-img', { timeout: 15000 });
    const camp = await page.evaluate(() => {
      const box = document.getElementById('entry-backdrop'), shelf = (k) => document.querySelector(`#camp-shelf [data-trophy="${k}"]`);
      const card = (name) => document.querySelector(`#camp-army .rw-bwho[data-commander="${name}"]`);
      return { mode: box.dataset.mode, key: box.dataset.key, bg: getComputedStyle(box.querySelector('.entry-backdrop-img')).backgroundImage,
        caption: document.getElementById('entry-backdrop-caption').textContent,
        wagons: { count: shelf('wagons')?.dataset.count, icons: shelf('wagons')?.querySelectorAll('svg').length, more: shelf('wagons')?.querySelector('.camp-trophy-more')?.textContent, label: shelf('wagons')?.textContent },
        guns: shelf('guns')?.dataset.count, arms: shelf('arms')?.dataset.count, level: shelf('reputation')?.querySelector('.camp-trophy-level')?.textContent,
        hazen: card('William B. Hazen')?.dataset.portrait, gibson: card('William H. Gibson')?.dataset.portrait,
        hazenAlt: card('William B. Hazen')?.querySelector('img')?.alt, depotArt: document.querySelectorAll('#camp-depot .rw-art-img').length,
        depotLine: document.querySelector('#camp-depot .rw-pictured')?.textContent ?? '', focus: document.activeElement?.id };
    });
    result.artCamp = camp;
    check('art-camp-backdrop', camp.mode === 'camp' && camp.key === 'shiloh' && camp.bg.includes('camp-shiloh.webp') && camp.caption.includes('Metzner'),
      `${camp.key} camp view; caption "${camp.caption.slice(0, 70)}…"`);
    check('art-camp-shelf', camp.wagons.count === '15' && camp.wagons.icons === 12 && camp.wagons.more === '×15' && camp.guns === '2' && camp.arms === '1' && camp.level === '1',
      `wagons ${camp.wagons.count} (${camp.wagons.icons} icons, ${camp.wagons.more}); captured guns ${camp.guns}, arms ${camp.arms}; reputation level ${camp.level}`);
    check('art-camp-portraits', camp.hazen === 'sourced' && camp.hazenAlt === 'Portrait of William B. Hazen' && camp.gibson === 'generic' && camp.focus === 'camp-next',
      `Hazen ${camp.hazen}, W. H. Gibson ${camp.gibson} (no sourced portrait: never another Gibson's); focus ${camp.focus}`);
    check('art-camp-depot', camp.depotArt >= 4 && /^Pictured: /.test(camp.depotLine), `${camp.depotArt} depot pictures; "${camp.depotLine.slice(0, 70)}…"`);
    const campAxe = await new AxeBuilder({ page }).include('#front').analyze(); result.artCampAxe = campAxe.violations;
    check('art-camp-axe', campAxe.violations.length === 0, JSON.stringify(campAxe.violations.map((v) => v.id)));
    await page.locator('#camp-trophies').scrollIntoViewIfNeeded(); await shot(page, 'art-camp-shelf');
    await page.locator('#camp-army').scrollIntoViewIfNeeded(); await shot(page, 'art-camp-brigades');
    await page.setViewportSize({ width: 320, height: 568 });
    check('art-camp-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth
      && [...n.querySelectorAll('.camp-trophy-label, .rw-bwho-name')].every((t) => t.getBoundingClientRect().right <= innerWidth && parseFloat(getComputedStyle(t).fontSize) >= 12)),
    '320px: shelf and commander rows wrap inside the camp');
    await page.locator('#camp-trophies').scrollIntoViewIfNeeded(); await shot(page, 'art-camp-320');
    check('art-console', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await ctx.close().catch(() => {}); }
}

// Officers UI (v4 OFFICERS): the officer card from the camp and from a battle unit card. Browser only:
// `officersControls({ browser, url, check, shot, result, watchErrors })`, registered in tools/test.mjs shard 2 (with the camp
// tests) and `node tools/test.mjs --officers`. A fixture campaign of two fictional phases on Henry Hill ground, in two packs so
// the first is a battle's last phase, is served by Playwright route interception of assets/campaign.json and the two pack
// files (nothing ships for them). The save is built here through the real campaign bridge (recordPhase with officer rows: a
// victory with most men kept gives Henry Hill's own Col. William T. Sherman Merit 1) and seeded into slot 1. Checked: the camp
// card's commander row opens the card ("Colonel William T. Sherman" as the pack gives him, Merit 1 of 3 with its game-value
// label, his record, the pack's sources, his effect line naming his brigade's steadiness, the scenario's own portrait first),
// Escape closes it and focus returns; the camp's Officers line; in battle the unit card's existing name line is the one opener
// (#uc-officer wraps #uc-name in the .ucname row: no second commander line, aria-label "Officer card: Col. <name>", a 44 px
// target) and opens the same card read-only, leaving the pause as it was; Escape closes it; axe on both; screenshots
// officer-card-camp and officer-card-battle. Repairs bound here (CI screenshot findings): the camp row shows the scenario's own
// portrait as the card does (camp-row-portrait); no text node of the card reads "null" or "undefined" (no-null-text); the
// card fits the viewport with Back on screen, inside the dialog and hit-testable at 1024x768 and 360x640 (fit-WxH).
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const phase = (pack, id, title) => ({ version: 1, id: pack, title: `Fictional officers battle ${id} (test only)`, phases: [{ id, scenario: { ...structuredClone(HH),
  id: `${pack}-${id}`, title, attacker: 'US', subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the officer checks; nothing here is history.' } } }] });
export const PACKS = [phase('test-officers-a', 'p1', 'Fictional officers phase one (test only)'), phase('test-officers-b', 'p2', 'Fictional officers phase two (test only)')];
export const CAMPAIGN = { version: 1, id: 'test-officers', title: 'Fictional officers campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'springfield', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'napoleon', vet: 'veteran' }],
phases: [{ packId: 'test-officers-a', phaseId: 'p1' }, { packId: 'test-officers-b', phaseId: 'p2' }] };
const NAME = 'William T. Sherman', HEADING = `Colonel ${NAME}`, NOTE = 'Merit is a game value earned by this brigade\'s results';
// his own portrait as Henry Hill's data gives it (commander.portrait and portraitNote): the card shows it before the name mapping
const OWN = HH.units.find((u) => u.id === 'sherman').commander, ALT = `Portrait of ${NAME}${OWN.portraitNote ? `, ${OWN.portraitNote}` : ''}`;
const STEADY = 'steadiness +2 % (2 % per Merit) for his brigade while he leads it'; // Merit 1, infantry: steadiness only

/** Phase one recorded through the real bridge: a victory at the battle's end with most men kept (Sherman: Merit 1). */
export function officerSave() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-17T12:00:00Z' }), p = campaign.campaignPhase(s0, CAMPAIGN);
  return campaign.recordPhase(s0, CAMPAIGN, { packId: 'test-officers-a', phaseId: 'p1', awardId: p.awardId, winner: 'US', grade: 'Victory', held: true, loot: [],
    units: [{ id: 'sherman', side: 'US', menStart: 2500, men: 2380 }, { id: 'jackson', side: 'CS', menStart: 2600, men: 2100 }],
    officers: [{ unitId: 'sherman', name: NAME, end: 'steady' }] });
}

export async function officersControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__officers', readFlag: '__officersReadBlocked', quotaFlag: '__officersQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  for (const p of PACKS) await ctx.route(`**/assets/packs/${p.id}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const evidence = result.officers = {};
  const record = (name, ok, data) => { evidence[name] = data; check(`officers-${name}`, ok, JSON.stringify(data).slice(0, 1200)); };
  const axe = async (key) => {
    const a = await new AxeBuilder({ page }).include('#officer-card').analyze();
    const bad = a.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    record(key, bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`) : `0 serious/critical (${a.violations.length} minor)`);
  };
  /** The card's fit: Back inside the viewport and inside the dialog's box, the topmost element at its centre; no text node
   *  reading "null" or "undefined"; the dialog no taller than 90 % of the viewport. */
  const fit = () => page.evaluate(() => {
    const d = document.getElementById('officer-card'), b = document.getElementById('officer-card-back');
    if (!d || !b) return null;
    const r = b.getBoundingClientRect(), dr = d.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT), bad = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (/^(?:null|undefined)$/.test(n.nodeValue.trim())) bad.push(n.parentElement?.className || n.parentElement?.tagName);
    const px = (v) => Math.round(v);
    return { viewport: [innerWidth, innerHeight], back: [px(r.left), px(r.top), px(r.right), px(r.bottom)], dialog: [px(dr.left), px(dr.top), px(dr.right), px(dr.bottom)],
      inViewport: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      inDialog: r.left >= dr.left - 0.5 && r.top >= dr.top - 0.5 && r.right <= dr.right + 0.5 && r.bottom <= dr.bottom + 0.5,
      hit: document.elementFromPoint(x, y) === b, tall: dr.height <= innerHeight * 0.9 + 1, scrolls: d.scrollHeight > d.clientHeight, nullText: bad };
  });
  const fits = (key, f) => record(key, !!f && f.inViewport && f.inDialog && f.hit && f.tall, f);
  const card = () => page.evaluate(() => {
    const d = document.getElementById('officer-card');
    return d ? { open: d.open, heading: d.querySelector('#officer-card-title')?.textContent, focus: document.activeElement?.id,
      stars: d.querySelector('.rw-officer-stars')?.getAttribute('aria-label'), note: d.querySelector('.rw-officer-meritnote')?.textContent,
      tag: d.querySelector('#officer-card-merit .rw-rule-tag')?.textContent, effect: d.querySelector('.rw-officer-effect')?.textContent,
      record: [...d.querySelectorAll('.rw-officer-record li')].map((li) => li.textContent), sources: d.querySelectorAll('.rw-officer-sources li').length,
      formation: d.querySelector('.rw-officer-formation')?.textContent, back: !!d.querySelector('#officer-card-back'),
      portrait: d.dataset.portrait ?? null, alt: d.querySelector('.rw-officer-portrait img')?.getAttribute('alt') ?? null } : null;
  });
  try {
    const saved = officerSave();
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(saved));
    await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 });
    // ---- camp: the commander row is a button; the card; Escape closes and focus returns ----
    const row = page.locator('#camp-army [data-brigade-id="sherman"] button.rw-bwho');
    await row.waitFor({ timeout: 30000 });
    // the camp row's portrait, picked as the card picks it: the scenario's own commander.portrait first, the card's alt text
    const rowArt = await page.evaluate(() => { const r = document.querySelector('#camp-army [data-brigade-id="sherman"] button.rw-bwho');
      return { portrait: r?.dataset.portrait ?? null, alt: r?.querySelector('.rw-bportrait img')?.getAttribute('alt') ?? null, src: r?.querySelector('.rw-bportrait img')?.getAttribute('src') ?? null,
        note: r?.querySelector('.rw-bwho-note')?.textContent ?? null }; });
    record('camp-row-portrait', rowArt.portrait === 'scenario' && rowArt.alt === ALT && rowArt.src === OWN.portrait && !/No sourced portrait/.test(rowArt.note), rowArt);
    const line = await page.evaluate(() => { const n = document.getElementById('camp-officers'); return n && !n.hidden ? n.textContent : ''; });
    record('camp-line', line.includes(`${NAME}: Merit 0 → 1 (game value)`), { line });
    await row.click();
    await page.waitForFunction(() => document.getElementById('officer-card')?.open);
    const camp = await card();
    record('camp-card', camp.open && camp.heading === HEADING && camp.focus === 'officer-card-title' && camp.stars === 'Merit 1 of 3' && camp.note === `${NOTE}.`
      && camp.tag === 'Game value' && /^Game rule/.test(camp.effect) && camp.effect.includes(STEADY) && camp.record.length === 1 && camp.record[0].includes('Victory') && camp.sources > 0 && camp.back
      && camp.portrait === 'scenario' && camp.alt === ALT, camp);
    await axe('camp-axe');
    const campFit = await fit();
    record('no-null-text', !!campFit && campFit.nullText.length === 0, campFit && { nullText: campFit.nullText });
    fits('fit-1024x768', campFit);
    await shot(page, 'officer-card-camp');
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    fits('fit-360x640', await fit());
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ open: document.getElementById('officer-card').open, back: document.activeElement?.classList.contains('rw-bwho') }));
    record('camp-escape', !closed.open && closed.back, closed);
    // ---- battle: the unit card's commander line opens the same card, read-only, while the battle runs ----
    await page.locator('#camp-next').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    await page.keyboard.press('Enter');
    const fielded = await page.evaluate(() => {
      const g = window.__game.game, u = g.units.find((x) => x.id === 'sherman');
      g.select(u);
      return { radius: u.def.meritRadius, steady: u.def.meritSteady, merit: u.def.officer?.merit, rank: u.commander?.rank };
    });
    record('battle-merit', fielded.radius === 1.1 && fielded.steady === 1.02 && fielded.merit === 1 && fielded.rank === 'Colonel', fielded);
    const button = page.locator('#uc-officer');
    await button.waitFor({ state: 'visible', timeout: 15000 });
    const text = await button.textContent(), before = await page.evaluate(() => window.__game.game.paused);
    // one line: the existing name line is the button (no second commander line), named for the officer card, a 44 px target
    const opener = await page.evaluate((name) => {
      const ob = document.getElementById('uc-officer'), body = document.getElementById('uc-body'), r = ob.getBoundingClientRect();
      const x = r.x + r.width / 2, cy = r.y + r.height / 2, hit = (y) => !!document.elementFromPoint(x, y)?.closest('#uc-officer');
      return { label: ob.getAttribute('aria-label'), inRow: ob.parentElement?.classList.contains('ucname') && body.firstElementChild === ob.parentElement,
        wrapsName: ob.contains(document.getElementById('uc-name')), names: body.textContent.split(name).length - 1, rows: body.querySelectorAll('.ucofficer').length,
        height: Math.round(r.height), target: hit(cy - 21) && hit(cy + 21) };
    }, NAME);
    record('battle-opener', opener.label === `Officer card: Col. ${NAME}` && opener.inRow && opener.wrapsName && opener.names === 1 && opener.rows === 0 && opener.target, opener);
    await button.click();
    await page.waitForFunction(() => document.getElementById('officer-card')?.open, null, { timeout: 15000 });
    const battle = await card(), paused = await page.evaluate(() => window.__game.game.paused);
    record('battle-card', battle.heading === HEADING && battle.stars === 'Merit 1 of 3' && battle.note === `${NOTE}.` && battle.record.length === 1
      && battle.formation === HH.units.find((u) => u.id === 'sherman').name && battle.sources > 0 && text.includes(`Col. ${NAME}`) && paused === before
      && battle.effect.includes(STEADY) && battle.portrait === 'scenario' && battle.alt === ALT, { ...battle, text, paused, before });
    await axe('battle-axe');
    const battleFit = await fit();
    record('battle-fit', !!battleFit && battleFit.nullText.length === 0 && battleFit.inViewport && battleFit.inDialog && battleFit.hit && battleFit.tall, battleFit);
    await shot(page, 'officer-card-battle');
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({ open: document.getElementById('officer-card').open, focus: document.activeElement?.id, selected: window.__game.game.selected?.id ?? null }));
    record('battle-escape', !after.open && after.focus === 'uc-officer' && after.selected === 'sherman', after);
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    record('console', real.length === 0, real.length ? real.slice(0, 4) : `no page errors (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
}

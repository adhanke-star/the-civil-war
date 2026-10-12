// Browser checks for badges and the X-Factor (P5a), registered in tools/test.mjs shard 2 and `node tools/test.mjs --badges`.
// `badgesControls({ browser, url, check, shot, result, watchErrors })`. Two parts:
// 1. The real flow (reduced motion), on a fictional one-phase campaign served by Playwright route interception of
//    assets/campaign.json and assets/packs/test-badges.json (Henry Hill ground, 21 July 1861; nothing ships for it). Camp ->
//    Next -> Briefing -> forced Union win, with the game's featReport giving the franchise brigade a Gold-level long-range
//    feat through the documented hook window.__game.game (as tools/test-economy-ui.mjs forces the result). The after-action
//    stamps the badge with its feat and plays the X-Factor moment once (static under reduced motion, non-blocking); the
//    saved slot carries the badge and the X-Factor; back in camp nothing replays, the card shows the emblem, its detail
//    dialog shows the real example (unit, event, text, provenance, https source links) apart from the game rule, Escape
//    returns focus; a brigade with too many badges chooses by keyboard; axe, 320 px, screenshots.
// 2. Full motion: the reward sequence mounted with a badges summary built here (src/franchise/campaign.js) stamps every
//    row and plays the full X-Factor moment once, without taking focus or blocking a click.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, seedProgress } from './test-progress-browser.mjs';
import * as campaign from '../src/franchise/campaign.js';
import * as badges from '../src/franchise/badges.js';
import { validateSnapshot } from '../src/franchise/save.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-badges';
const PACK = { version: 1, id: PACK_ID, title: 'Fictional badges test battle (test only)', phases: [
  { id: 'p1', scenario: { ...structuredClone(HH), id: 'test-badges-p1', title: 'Fictional badges phase (test only)', attacker: 'US',
    subtitle: 'Fictional campaign phase · test only', briefing: { text: 'Fictional test briefing for the badge checks; nothing here is history.' } } }] };
const CAMPAIGN = { version: 1, id: 'test-badge', title: 'Fictional badges campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'm1842', vet: 'green' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'sixPdr', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1' }] };
const GOLD = 4 * badges.BADGE_RULES.bronze.sharpshooters;

/** A recorded phase whose summary stamps three badges, one of them a first Gold (the X-Factor), for the full-motion mount. */
function stampSummary() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 7 }), p = campaign.campaignPhase(s0, CAMPAIGN);
  const zero = Object.fromEntries(badges.FEAT_STATS.map((k) => [k, 0]));
  const feats = { sherman: { side: 'US', xp: 1, menStart: 3000, ...zero, farKills: GOLD, marched: 900 },
    jackson: { side: 'CS', xp: 2, menStart: 2600, ...zero, repulses: 2 } };
  const after = campaign.recordPhase(s0, CAMPAIGN, { packId: PACK_ID, phaseId: 'p1', awardId: p.awardId, winner: 'US', grade: 'Draw', held: false,
    units: [{ id: 'sherman', side: 'US', menStart: 3000, men: 2950 }, { id: 'jackson', side: 'CS', menStart: 2600, men: 2400 }], loot: [], feats });
  return { summary: badges.badgeAward(after.awardId), army: after.army };
}

/** Capture the real transient DOM in its insertion microtask, before native removal can race a later protocol call. */
function observeMoment(){
  window.__badgeMomentObserver?.disconnect();window.__badgeMomentObservation=null;
  let seen=null;
  const observer=new MutationObserver(records=>{
    for(const record of records)for(const added of record.addedNodes){
      const m=added.nodeType===1&&(added.matches('.rw-xfactor-moment')?added:added.querySelector('.rw-xfactor-moment'));
      if(!m||!m.isConnected||seen)continue;
      seen=m;const button=document.querySelector('.rw-aar .rw-primary');button.scrollIntoView({block:'center'});
      const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
      window.__badgeMomentObservation={connected:m.isConnected,badge:m.dataset.badge,style:m.dataset.style,events:getComputedStyle(m).pointerEvents,
        hidden:m.getAttribute('aria-hidden'),log:[...(window.__xfactors??[])],focus:document.activeElement?.id,clickable:!!hit?.closest('.rw-primary'),insertedAt:performance.now(),
        rows:[...document.querySelectorAll('.rw-badge-row')].map(r=>[r.dataset.badge,r.dataset.tier,r.querySelector('.rw-badge-text')?.textContent]),
        stamped:document.querySelectorAll('.rw-badge-row.is-stamped').length,enemy:document.querySelector('.rw-badge-enemy')?.textContent??'',tag:document.querySelector('.rw-badges .rw-rule-tag')?.textContent,
        removedAt:null,removalLog:null};
    }
    if(seen&&!seen.isConnected&&window.__badgeMomentObservation.removedAt===null){
      window.__badgeMomentObservation.removedAt=performance.now();window.__badgeMomentObservation.removalLog=[...(window.__xfactors??[])];
    }
  });observer.observe(document.body,{childList:true,subtree:true});window.__badgeMomentObserver=observer;
}
const disconnectMoment=()=>{window.__badgeMomentObserver?.disconnect();};

export async function badgesControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. the real campaign flow and camp (reduced motion) ----
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__badges', readFlag: '__badgesReadBlocked', quotaFlag: '__badgesQuota' });
  await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
  await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const camp = async () => { await page.goto(url + '?camp'); await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing, null, { timeout: 60000 }); };
  const stored = () => page.evaluate(async () => JSON.parse(await (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline()));
  const raw = () => page.evaluate(async () => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline());
  try {
    const start = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1861, at: '2026-10-11T12:00:00Z' });
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await seedProgress(page, JSON.stringify(start));
    await camp();
    check('badges-camp-empty', await page.evaluate(() => document.querySelectorAll('#camp-army .cw-badge').length === 0 && !(window.__xfactors ?? []).length),
      'a fresh campaign camp shows no badges and plays no moment');
    await page.locator('#camp-next').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('briefing')?.open, null, { timeout: 180000 });
    await page.keyboard.press('Enter');
    await page.evaluate((gold) => {
      const g = window.__game.game; g.paused = true;
      const real = g.featReport.bind(g);
      g.featReport = () => { const r = real(); r.sherman.farKills = gold; r.sherman.marched = 900; r.sherman.woodsKills = 60; return r; }; // the documented test hook
      for (const u of g.units) if (u.side === 'CS' && u.type === 'infantry') u.state = 'routing';
      g.checkObjective(0, true);
    }, GOLD);
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    await page.evaluate(observeMoment);
    await page.locator('#result-action').click();
    await page.waitForFunction(() => window.__badgeMomentObservation, null, { timeout: 15000 });
    const aar = await page.evaluate(() => window.__badgeMomentObservation);
    const sharp = aar.rows.find((r) => r[0] === 'sharpshooters');
    check('badges-aar-stamped', sharp && sharp[1] === 'gold' && sharp[2].includes(`${GOLD} casualties inflicted by fire from beyond 200 m`) && sharp[2].includes('game rule')
      && aar.rows.some((r) => r[0] === 'hardMarchers') && aar.tag === 'Game rule',
    `after-action stamps ${aar.rows.map((r) => `${r[0]} ${r[1]}`).join(', ')} with the feat ("${sharp?.[2]?.slice(0, 80)}…")`);
    check('badges-aar-xfactor', aar.connected && aar.badge==='sharpshooters' && JSON.stringify(aar.log) === '["Test brigade (fictional)|sharpshooters"]' && aar.style === 'subtle' && aar.events === 'none'
      && aar.hidden === 'true' && aar.clickable && aar.focus === 'rw-aar-grade',
    `X-Factor moment ${JSON.stringify(aar.log)}, ${aar.style} under reduced motion, pointer-events ${aar.events}, focus ${aar.focus}`);
    await page.waitForFunction(()=>window.__badgeMomentObservation&&window.__badgeMomentObservation.removedAt!==null,null,{timeout:15000});
    result.badgesReducedMoment=await page.evaluate(()=>window.__badgeMomentObservation);
    check('badges-reduced-moment-once',result.badgesReducedMoment.removedAt>=result.badgesReducedMoment.insertedAt&&JSON.stringify(result.badgesReducedMoment.removalLog)==='["Test brigade (fictional)|sharpshooters"]','connected reduced-motion banner leaves through native removal exactly once');
    await shot(page, 'badges-aar-campaign');
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    const issueBadges = await page.locator('.rw-brig .cw-badge').count();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('result').open && document.getElementById('result-title').textContent === 'Campaign saved', null, { timeout: 30000 });
    const after = await stored(), sherman = after.army.find((b) => b.id === 'sherman');
    check('badges-saved', sherman.xfactor === 'sharpshooters' && sherman.badges.some((b) => b.id === 'sharpshooters' && b.tier === 'gold' && b.feat === GOLD)
      && issueBadges > 0 && JSON.stringify(await page.evaluate(() => window.__xfactors)) === '["Test brigade (fictional)|sharpshooters"]',
    `saved: ${sherman.badges.map((b) => `${b.id} ${b.tier}`).join(', ')}; X-Factor ${sherman.xfactor}${sherman.offer ? `; ${sherman.offer.length} on offer` : ''}; ${issueBadges} emblems on the issue cards; moment shown once`);
    // ---- back in camp: nothing replays; the card's emblem opens the real example ----
    await camp();
    const card = await page.evaluate(() => ({ log: window.__xfactors ?? [], moments: document.querySelectorAll('.rw-xfactor-moment').length,
      chips: [...document.querySelectorAll('#camp-army [data-brigade-id="sherman"] button.cw-badge')].map((n) => n.getAttribute('aria-label')),
      glow: document.querySelector('#camp-army [data-brigade-id="sherman"]')?.classList.contains('has-xfactor'),
      choose: !!document.querySelector('#camp-army [data-brigade-id="sherman"] .camp-choose-button') }));
    check('badges-camp-card', card.log.length === 0 && card.moments === 0 && card.chips.some((l) => /^Sharpshooters, Gold badge, X-Factor: details$/.test(l)) && card.glow,
      `camp card emblems ${card.chips.join(' / ')}; X-Factor glow ${card.glow}; no moment replayed`);
    const chip = page.locator('#camp-army [data-brigade-id="sherman"] button.cw-badge[data-badge="sharpshooters"]');
    await chip.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('camp-badge').open);
    const detail = await page.evaluate(() => ({ heading: document.getElementById('camp-badge-heading').textContent, focus: document.activeElement?.id,
      unit: document.getElementById('camp-badge-unit').textContent, text: document.getElementById('camp-badge-text').textContent,
      provenance: document.getElementById('camp-badge-provenance').textContent, effect: document.getElementById('camp-badge-effect').textContent,
      rule: document.querySelector('#camp-badge-rule-heading .rw-rule-tag')?.textContent,
      links: [...document.querySelectorAll('#camp-badge-sources a')].map((a) => a.href) }));
    check('badges-detail-example', detail.heading === 'Sharpshooters: Gold · X-Factor' && detail.focus === 'camp-badge-heading' && /Birge/.test(detail.unit)
      && detail.text.length > 40 && ['Verified', 'Inferred', 'Disputed'].includes(detail.provenance) && detail.rule === 'Game rule' && /^\+8 Fire/.test(detail.effect)
      && detail.links.length >= 2 && detail.links.every((h) => h.startsWith('https://')),
    `detail "${detail.heading}": ${detail.unit.slice(0, 60)}…; ${detail.provenance}; ${detail.links.length} https sources; effect "${detail.effect.slice(0, 50)}…" under Game rule`);
    await shot(page, 'badges-camp-detail');
    let axe = await new AxeBuilder({ page }).include('#camp-badge').analyze();
    let bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('badges-detail-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('camp-badge').open);
    check('badges-detail-escape', await page.evaluate(() => document.activeElement?.dataset.badge === 'sharpshooters'), 'Escape closes the detail and returns focus to the emblem');
    // ---- the brigade (Trained after the win: 2 slots) has a third badge on offer: choose by keyboard; Escape changes nothing ----
    const chooseBtn = page.locator('#camp-army [data-brigade-id="sherman"] .camp-choose-button');
    if (card.choose) {
      const before = await raw();
      await chooseBtn.click(); await page.waitForFunction(() => document.getElementById('camp-choose').open);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('camp-choose').open);
      const untouched = await raw() === before;
      await chooseBtn.focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.getElementById('camp-choose').open);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('#camp-choose .camp-choose-box')].map((b) => [b.value, b.checked, b.disabled]));
      await page.locator('#camp-choose .camp-choose-box[value="hardMarchers"]').focus(); await page.keyboard.press('Space');
      await page.locator('#camp-choose .camp-choose-box[value="woodsmen"]').focus(); await page.keyboard.press('Space');
      await page.locator('#camp-choose-save').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !window.__entry.importing && !document.getElementById('camp-choose').open, null, { timeout: 15000 });
      const chosen = (await stored()).army.find((b) => b.id === 'sherman');
      check('badges-choose-keyboard', untouched && boxes.some(([v, c, d]) => v === 'sharpshooters' && c && d) && !chosen.offer && chosen.badges.map((b) => b.id).join() === 'sharpshooters,woodsmen',
        `Escape left storage byte-identical (${untouched}); boxes ${boxes.map((b) => b.join(':')).join(', ')}; kept ${chosen.badges.map((b) => b.id).join(', ')}`);
    } else check('badges-choose-keyboard', false, 'expected the brigade to have a third badge waiting on offer');
    axe = await new AxeBuilder({ page }).include('#front').analyze();
    bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result.badgesCampAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    check('badges-camp-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.setViewportSize({ width: 320, height: 568 });
    check('badges-camp-320', await page.locator('#front').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: badge emblems do not overflow the camp');
    await page.locator('#camp-army').scrollIntoViewIfNeeded(); await shot(page, 'badges-camp-320');
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('badges-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await page.evaluate(disconnectMoment).catch(()=>{});await ctx.close().catch(() => {}); }

  // ---- 2. the stamping and the full X-Factor moment at full motion ----
  const full = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'no-preference' });
  const fullPage=await full.newPage();
  try {
    const page = fullPage, errors = []; watchErrors(page, url, errors);
    await page.goto(url + '?nosw'); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    const { summary } = stampSummary();
    await page.evaluate(observeMoment);
    await page.evaluate(async (summary) => {
      const { mountReward } = await import('./src/reward/sequence.js');
      window.__xfactors = [];
      mountReward(document.body, { seed: 11, grade: 'Victory', rememberReplay: false, afterAction: { title: 'Fictional', why: 'Fictional test result.', surviving: 10, losses: 1, guns: 0,
        eyebrow: 'Campaign · Fictional', note: 'Test only.', badges: summary } });
    }, summary);
    await page.waitForFunction(() => window.__badgeMomentObservation, null, { timeout: 15000 });
    const moment = await page.evaluate(() => ({...window.__badgeMomentObservation,rows:window.__badgeMomentObservation.rows.length}));
    check('badges-full-moment', moment.connected && moment.badge==='sharpshooters' && moment.style === 'full' && moment.events === 'none' && moment.focus === 'rw-aar-grade' && moment.rows >= 2 && moment.stamped === moment.rows
      && JSON.stringify(moment.log) === '["Test brigade (fictional)|sharpshooters"]' && /Rock Bronze/.test(moment.enemy),
    `${moment.stamped}/${moment.rows} rows stamped; full moment ${JSON.stringify(moment.log)}; enemy line "${moment.enemy.slice(0, 60)}"`);
    await shot(page, 'badges-aar-after-moment-observation');
    await page.waitForFunction(() => window.__badgeMomentObservation&&window.__badgeMomentObservation.removedAt!==null, null, { timeout: 15000 });
    result.badgesFullMoment=await page.evaluate(()=>window.__badgeMomentObservation);
    check('badges-moment-once', result.badgesFullMoment.removedAt>=result.badgesFullMoment.insertedAt&&JSON.stringify(result.badgesFullMoment.removalLog)==='["Test brigade (fictional)|sharpshooters"]'&&await page.evaluate(() => (window.__xfactors ?? []).length === 1), 'the observed connected X-Factor moment leaves on its own and was shown once');
    const axe = await new AxeBuilder({ page }).include('.rw').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('badges-aar-axe', bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor)`);
    await page.setViewportSize({ width: 320, height: 568 });
    check('badges-aar-320', await page.locator('.rw-aar').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '320px wide: the badges panel does not overflow the after-action');
    await shot(page, 'badges-aar-320');
    check('badges-full-console', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : 'no page errors');
  } finally { await fullPage.evaluate(disconnectMoment).catch(()=>{});await full.close().catch(() => {}); }
}

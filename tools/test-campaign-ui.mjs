// Campaign screens and flow (DESIGN §1 Flow/Saves/Losing/Other modes, §4b few screens). Two parts:
//
// 1. CPU (`node tools/test-campaign-ui.mjs`, `--prove-fail` also runs one mutant per check and requires each to fail
//    that check with the check's own name in the failure text): the campaign route guard (playMode, savedDeployment
//    refuses a v2 save), ladder position text, the reward-issue bridge (and its mismatch refusal) and briefing links.
// 2. Browser, `campaignControls({ browser, url, check, shot, result, watchErrors })`, registered in tools/test.mjs
//    shard 2 and `node tools/test.mjs --campaign`. A fixture campaign (two fictional phases on Henry Hill terrain built
//    from assets/scenarios/henry-hill.json, the first a loan phase) is served by Playwright route interception of
//    assets/campaign.json and assets/packs/test-campaign.json; nothing ships for it. The real UI is driven: title ->
//    New campaign -> slot 2 -> camp -> Next -> Briefing -> Begin -> result -> After-action & loot -> camp, reload and
//    Continue, a phase-2 defeat, its marked replay, campaign complete, the Battles menu and the empty shipped title.
//    Battle results are forced through the documented hook window.__game.game: pause, mark one side's infantry
//    routing, then game.checkObjective(0, true) ends the pack phase through Game's own result path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, progressRaw, seedProgress } from './test-progress-browser.mjs';
import * as practice from '../src/franchise/practice.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import * as briefing from '../src/ui/briefing.js';
import { compare, equip } from '../src/reward/model.js';
import { SAMPLE_ARMY } from '../src/reward/data.js';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const PACK_ID = 'test-campaign';
const phaseScenario = (id, title, extra) => ({ ...structuredClone(HH), id: `test-${id}`, title, attacker: 'US',
  subtitle: `Fictional campaign phase ${id} · test only`, ...extra });
export const PACK = { version: 1, id: PACK_ID, title: 'Fictional test battle (test only)', phases: [
  { id: 'p1', scenario: phaseScenario('p1', 'Fictional phase one (test only)', { briefing: {
    text: 'Fictional test briefing for phase one. Grant\'s army holds this ground in the fixture; nothing here is history.',
    quote: { text: 'A fictional line written for this test only.', who: 'Test fixture author', source: 'tools/test-campaign-ui.mjs' },
    sources: [{ title: 'Fixture source (test only)', url: 'https://example.com/fixture-source' }, 'javascript:alert(1)', { title: 'Relative', url: '/local' }] } }) },
  { id: 'p2', scenario: phaseScenario('p2', 'Fictional phase two (test only)', { briefing: { text: 'Fictional test briefing for phase two. Your franchise brigades take the field.' } }) }] };
export const CAMPAIGN = { version: 1, id: 'test-west', title: 'Fictional test campaign (test only)', franchise: [
  { unitId: 'sherman', label: 'Test brigade (fictional)', kind: 'infantry', men: 2500, weapon: 'springfield', vet: 'trained' },
  { unitId: 'ricketts', label: 'Test battery (fictional)', kind: 'battery', men: 110, guns: 5, weapon: 'napoleon', vet: 'veteran' }],
phases: [{ packId: PACK_ID, phaseId: 'p1', loan: true }, { packId: PACK_ID, phaseId: 'p2' }] };

// ---- CPU checks ------------------------------------------------------------------------------------------------------
const API = { playMode: practice.playMode, savedDeployment: practice.savedDeployment, ...briefing };
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
function recorded() {
  const s0 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 2, seed: 7, at: '2026-10-11T12:00:00Z' });
  const phase = campaign.campaignPhase(s0, CAMPAIGN);
  const loot = practice.awardCards({ awardId: phase.awardId, seed: phase.seed, grade: 'Victory', captures: [] });
  const next = campaign.recordPhase(s0, CAMPAIGN, { packId: PACK_ID, phaseId: 'p1', awardId: phase.awardId, winner: 'US', grade: 'Victory', units: [], loot });
  return { s0, phase, loot, next };
}
function rewardResult(api, next, loot) {
  const army = api.rewardArmy(next.army);
  let pair = null;
  for (const [i, b] of army.entries()) for (const card of loot) if (!pair && compare(b, card).ok) pair = { i, card };
  assert.ok(pair, 'reward-issues: fixture loot has no card any brigade can carry');
  const { brigade, displaced } = equip(army[pair.i], pair.card);
  return { pair, displaced, result: { army: army.map((b, i) => (i === pair.i ? brigade : b)),
    depot: [...loot.filter((c) => c.uid !== pair.card.uid), displaced], issued: [{ brigade: brigade.id, item: pair.card.uid, displaced: displaced.uid }] } };
}
export const CAMPAIGN_UI_CHECKS = [
  ['route-guard', (api) => {
    assert.deepEqual(['?campaign=2', '?campaign=1&replay', '?practice', '?battle=x', '?sandbox&campaign=2'].map(api.playMode),
      ['campaign', 'campaign', 'practice', 'historical', 'sandbox'], 'route-guard: playMode does not route ?campaign to its own mode');
    const v2 = campaign.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 3 });
    refuses('route-guard', () => api.savedDeployment({ baseline: v2, ground: {}, awardId: 'route-guard-new', seed: 1 }),
      /^Practice: campaign armies fight only in their campaign phases/);
    const v1 = save.completedSnapshot({ awardId: 'practice-v1', army: structuredClone(SAMPLE_ARMY), depot: [], issued: [], seed: 7, grade: 'Victory' });
    let v1Error = null;
    try { api.savedDeployment({ baseline: v1, ground: {}, awardId: 'route-guard-new', seed: 1 }); } catch (e) { v1Error = e; }
    assert.doesNotMatch(String(v1Error?.message ?? ''), /campaign armies/, 'route-guard: a practice (v1) army was refused as a campaign army');
  }],
  ['ladder-position', (api) => {
    const def = campaign.validateCampaign({ version: 1, id: 'ladder', title: 'Ladder', franchise: [], phases: [
      { packId: 'a', phaseId: 'a1' }, { packId: 'a', phaseId: 'a2' }, { packId: 'b', phaseId: 'b1' },
      { packId: 'c', phaseId: 'c1' }, { packId: 'c', phaseId: 'c2' }, { packId: 'c', phaseId: 'c3' }] });
    assert.deepEqual([0, 1, 2, 4, 6].map((i) => Object.values(api.ladderPosition(def, i)).join('/')),
      ['1/3/1/2', '1/3/2/2', '2/3/1/1', '3/3/2/3', '3/3/3/3'], 'ladder-position: wrong "Battle N of B · Phase k of n" numbers');
    assert.equal(api.formatDate('1862-04-06'), '6 April 1862', 'ladder-position: briefing date format');
  }],
  ['reward-issues', (api) => {
    const { loot, next } = recorded(), { pair, displaced, result } = rewardResult(api, next, loot);
    const out = api.applyRewardIssues(next, loot, result);
    assert.equal(out.issued, true, 'reward-issues: a consistent reward issue was not kept');
    const b = out.save.army[pair.i];
    assert.ok(b.weapon.uid === pair.card.uid && out.save.depot.some((it) => it.uid === displaced.uid) && !out.save.depot.some((it) => it.uid === pair.card.uid),
      'reward-issues: the issued card is not equipped with the displaced weapon in the depot');
    assert.deepEqual(save.validateSnapshot(out.save), out.save, 'reward-issues: the replayed save is not canonical');
    assert.deepEqual([out.save.campaign, out.save.awardId, out.save.depot.length], [next.campaign, next.awardId, next.depot.length], 'reward-issues: the replay changed the campaign record or depot size');
  }],
  ['reward-mismatch', (api) => {
    const { loot, next } = recorded(), { result } = rewardResult(api, next, loot);
    const short = { ...result, depot: result.depot.slice(1) };
    const out = api.applyRewardIssues(next, loot, short);
    assert.ok(out.issued === false && JSON.stringify(out.save) === JSON.stringify(save.validateSnapshot(next)),
      'reward-mismatch: a reward whose items differ from the recorded award changed the save');
    const foreign = api.applyRewardIssues(next, [...loot, { ...loot[0], uid: 'not-in-depot' }], result);
    assert.equal(foreign.issued, false, 'reward-mismatch: loot missing from the recorded depot was accepted');
  }],
  ['briefing-sources', (api) => {
    const rows = api.briefingSources(PACK.phases[0].scenario.briefing.sources);
    assert.deepEqual(rows, [{ label: 'Fixture source (test only)', href: 'https://example.com/fixture-source' }],
      'briefing-sources: only absolute http(s) sources may become links');
    assert.deepEqual(api.briefingSources(['https://loc.gov/item/1']), [{ label: 'loc.gov', href: 'https://loc.gov/item/1' }], 'briefing-sources: a bare URL needs its host as label');
  }],
];
const MUTANTS = {
  'route-guard': { savedDeployment: () => ({}) },
  'ladder-position': { ladderPosition: (d, i) => briefing.ladderPosition(d, i + 1) },
  'reward-issues': { applyRewardIssues: (next) => ({ save: save.validateSnapshot(next), issued: true }) },
  'reward-mismatch': { applyRewardIssues: (next, loot, result) => {
    let s = save.validateSnapshot(next);
    for (const r of result.issued) s = save.exchangeDepot(s, { brigadeId: r.brigade, itemUid: r.item });
    return { save: s, issued: true };
  } },
  'briefing-sources': { briefingSources: (list) => list.map((x) => ({ label: typeof x === 'string' ? x : x.title, href: typeof x === 'string' ? x : x.url })) },
};
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}

// ---- browser flow ----------------------------------------------------------------------------------------------------
const FIELD_MS = 180000;
export async function campaignControls({ browser, url, check, shot, result, watchErrors }) {
  const routed = async (ctx) => {
    await ctx.route('**/assets/campaign.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAMPAIGN) }));
    await ctx.route(`**/assets/packs/${PACK_ID}.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACK) }));
  };
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__campaign', readFlag: '__campaignReadBlocked', quotaFlag: '__campaignQuota' });
  await routed(ctx);
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const entry = async (query = '') => { await page.goto(url + query); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 }); };
  const slotRaw = (slot) => page.evaluate(async (slot) => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot }).readRawBaseline(), slot);
  const slotSave = async (slot) => { const raw = await slotRaw(slot); return raw === null ? null : JSON.parse(raw); };
  const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const axe = async (scope, key) => {
    const a = await new AxeBuilder({ page }).include(scope).analyze();
    const bad = a.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    check(`campaign-${key}`, bad.length === 0, bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${a.violations.length} minor)`);
  };
  const narrow = async (key, scope = '#front') => {
    await page.setViewportSize({ width: 320, height: 568 });
    const ok = await page.locator(scope).evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
    check(`campaign-${key}-320`, ok, '320px wide: no horizontal overflow');
    return ok;
  };
  const wide = () => page.setViewportSize({ width: 1024, height: 768 });
  const fieldReady = () => page.waitForFunction(() => window.__ready && window.__game, null, { timeout: FIELD_MS });
  // The documented hook: end the pack phase through Game's own objective/result path.
  const force = (loser) => page.evaluate((loser) => {
    const g = window.__game.game; g.paused = true;
    for (const u of g.units) if (u.side === loser && u.type === 'infantry') u.state = 'routing';
    g.checkObjective(0, true);
    return { over: g.over, winner: g.result?.winner, grade: g.result?.grade };
  }, loser);
  async function playPhase(loser, label) {
    await page.waitForFunction(() => document.getElementById('briefing')?.open, null, { timeout: 30000 });
    await page.keyboard.press('Enter');
    const begun = await page.evaluate(() => !document.getElementById('briefing') && !window.__game.game.paused && document.activeElement?.id === 'battlefield');
    check(`campaign-${label}-begin`, begun, 'Begin (Enter on the focused button) closes the Briefing, unpauses and focuses the battlefield');
    const end = await force(loser);
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30000 });
    const panel = await page.evaluate(() => ({ title: document.getElementById('result-title').textContent, action: document.getElementById('result-action').textContent,
      focus: document.activeElement?.id, grade: window.__game.practice.phase?.record.grade, failure: window.__game.practice.phaseFailure }));
    check(`campaign-${label}-result`, end.over && panel.action === 'After-action & loot' && panel.focus === 'result-action' && !panel.failure,
      `${panel.title}: ${panel.grade}; primary After-action & loot focused ${panel.failure ? `(failure: ${panel.failure})` : ''}`);
    await page.locator('#result-action').click();
    await page.waitForFunction(() => document.querySelector('.rw[aria-label="After action and loot"]'));
    const eyebrow = await page.locator('.rw .rw-aar .rw-eyebrow').textContent();
    check(`campaign-${label}-aar-wording`, eyebrow.startsWith('Campaign · '), `after-action eyebrow "${eyebrow}"`);
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.keyboard.press('s');
    await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('result').open && document.getElementById('result-title').textContent === 'Campaign saved', null, { timeout: 30000 });
    return { end, grade: panel.grade };
  }
  const practiceSave = save.completedSnapshot({ awardId: 'campaign-ui-practice', army: structuredClone(SAMPLE_ARMY), depot: [], issued: [], seed: 31, grade: 'Victory' });
  try {
    // ---- title with a campaign ----
    await entry('?nosw'); await seedProgress(page, JSON.stringify(practiceSave)); const slot1 = await progressRaw(page);
    await entry('');
    const title = await page.evaluate(() => ({ campaign: window.__entry.campaign, focus: document.activeElement.id,
      newVisible: !document.getElementById('entry-new-campaign').hidden, continueHidden: document.getElementById('entry-campaign-continue').hidden,
      battles: !document.getElementById('entry-battles').hidden, practice: document.getElementById('entry-continue').textContent,
      sandbox: [...document.querySelectorAll('.entry-modes a')].some((a) => a.textContent === 'Sandbox' && a.getClientRects().length) }));
    check('campaign-title', title.campaign?.id === 'test-west' && title.newVisible && title.continueHidden && title.battles && title.focus === 'entry-new-campaign'
      && title.practice === 'Practice: Henry House Hill' && title.sandbox, `focus ${title.focus}; New campaign primary, Battles, Practice: Henry House Hill and Sandbox kept`);
    await axe('#front', 'titleAxe'); await shot(page, 'campaign-title');
    await narrow('title'); await shot(page, 'campaign-title-320'); await wide();
    // ---- Battles menu lists every phase ----
    await page.locator('#entry-battles').click();
    await page.waitForFunction(() => document.querySelectorAll('#entry-battle-rows a').length === 2);
    const battles = await page.evaluate(() => ({ links: [...document.querySelectorAll('#entry-battle-rows a')].map((a) => [a.textContent, new URL(a.href).search]),
      text: document.getElementById('entry-battle-rows').textContent, focus: document.activeElement.textContent, expanded: document.getElementById('entry-battles').getAttribute('aria-expanded') }));
    check('campaign-battles-list', JSON.stringify(battles.links) === JSON.stringify([['Fictional phase one (test only)', `?battle=${PACK_ID}&phase=p1`], ['Fictional phase two (test only)', `?battle=${PACK_ID}&phase=p2`]])
      && battles.text.includes('21 July 1861') && battles.focus === 'Fictional phase one (test only)' && battles.expanded === 'true', JSON.stringify(battles.links));
    // ---- New campaign: slot picker, overwrite warning (Cancel focused) ----
    await page.locator('#entry-new-campaign').click();
    await page.waitForFunction(() => document.querySelectorAll('#slot-rows .slot-choice').length === 3);
    const picker = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#slot-rows .slot-choice')].map((b) => b.textContent), focus: document.activeElement.id }));
    check('campaign-slot-picker', picker.rows[0].includes('Practice army') && picker.rows[1].includes('Empty slot') && picker.focus === 'slot-choice-2', `${JSON.stringify(picker.rows)}; focus ${picker.focus}`);
    await axe('#slot-picker', 'slotPickerAxe');
    await page.locator('#slot-choice-1').click();
    await page.waitForFunction(() => document.getElementById('slot-overwrite').open);
    const warn = await page.evaluate(() => ({ focus: document.activeElement.id, role: document.getElementById('slot-overwrite').getAttribute('role'), text: document.getElementById('slot-overwrite-note').textContent }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('slot-overwrite').open);
    check('campaign-overwrite-warning', warn.focus === 'slot-overwrite-cancel' && warn.role === 'alertdialog' && warn.text.includes('Practice army')
      && await progressRaw(page) === slot1 && await focused() === 'slot-choice-1', `Cancel focused (${warn.focus}); Enter on it keeps slot 1 byte-identical`);
    await Promise.all([page.waitForURL(/\?camp=2$/), page.locator('#slot-choice-2').click()]);
    await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    // ---- camp strip ----
    const campStart = await page.evaluate(() => ({ position: document.getElementById('camp-campaign-position').textContent, next: document.getElementById('camp-next').textContent,
      href: new URL(document.getElementById('camp-next').href).search, focus: document.activeElement.id, deploy: document.getElementById('camp-deploy').disabled,
      note: !document.getElementById('camp-deploy-note').hidden, practice: document.getElementById('camp-practice').hidden, cards: document.querySelectorAll('#camp-army [data-brigade-id]').length }));
    const s0 = await slotSave(2);
    check('campaign-new-slot2', s0?.version === 2 && s0.slot === 2 && s0.campaign.index === 0 && await progressRaw(page) === slot1, 'slot 2 holds a fresh v2 campaign; slot 1 practice save untouched');
    check('campaign-camp-start', campStart.position === 'Battle 1 of 1 · Phase 1 of 2' && campStart.next === 'Next: Fictional phase one (test only)' && campStart.href === '?campaign=2'
      && campStart.focus === 'camp-next' && campStart.deploy && campStart.note && campStart.practice && campStart.cards === 2, JSON.stringify(campStart));
    await axe('#front', 'campAxe');
    // ---- phase 1 (loan): Briefing, Begin, victory, loot, save ----
    await page.locator('#camp-next').click(); await fieldReady();
    await page.waitForFunction(() => document.getElementById('briefing')?.open);
    const brief = await page.evaluate(() => ({ focus: document.activeElement.id, paused: window.__game.game.paused, title: document.getElementById('briefing-title').textContent,
      when: document.getElementById('briefing-when').textContent, loan: document.getElementById('briefing-loan')?.textContent ?? '',
      quote: document.querySelector('#briefing .briefing-quote')?.textContent ?? '', links: [...document.querySelectorAll('#briefing .briefing-sources a')].map((a) => a.href),
      phase: window.__game.campaign?.phase.phaseId, mode: document.getElementById('play-mode').textContent }));
    check('campaign-briefing', brief.focus === 'briefing-begin' && brief.paused && brief.title === 'Fictional phase one (test only)' && brief.when.startsWith('21 July 1861 · 14:00')
      && brief.loan.includes('on loan') && brief.quote.includes('Test fixture author') && JSON.stringify(brief.links) === '["https://example.com/fixture-source"]' && brief.phase === 'p1'
      && brief.mode.startsWith('Campaign'), JSON.stringify(brief));
    await axe('#briefing', 'briefingAxe'); await shot(page, 'campaign-briefing');
    await page.setViewportSize({ width: 320, height: 568 });
    const briefNarrow = await page.evaluate(() => { const d = document.getElementById('briefing'), b = document.getElementById('briefing-begin').getBoundingClientRect();
      return d.scrollWidth <= d.clientWidth + 1 && b.bottom <= innerHeight && b.top >= 0 && b.height >= 44; });
    check('campaign-briefing-320', briefNarrow, '320px: Briefing fits and Begin stays in view (>=44px)'); await shot(page, 'campaign-briefing-320'); await wide();
    const p1 = await playPhase('CS', 'phase1');
    const after1 = await slotSave(2), saved1 = await page.evaluate(() => ({ replay: !document.getElementById('result-replay').hidden, focus: document.activeElement.id }));
    check('campaign-phase1-saved', p1.grade === 'Victory' && after1.campaign.index === 1 && after1.campaign.history.length === 1 && after1.campaign.history[0].grade === 'Victory'
      && after1.depot.length > 0 && JSON.stringify(after1.army.map((b) => b.men)) === JSON.stringify(s0.army.map((b) => b.men)) && !saved1.replay && saved1.focus === 'result-action'
      && await progressRaw(page) === slot1, `loan phase recorded; franchise men unchanged; ${after1.depot.length} depot cards; Return to camp focused`);
    await Promise.all([page.waitForURL(/\?camp=2$/), page.locator('#result-action').click()]);
    await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    const strip = await page.evaluate(() => ({ position: document.getElementById('camp-campaign-position').textContent, next: document.getElementById('camp-next').textContent,
      record: [...document.querySelectorAll('#camp-record li')].map((li) => li.textContent), depot: document.querySelectorAll('#camp-depot [data-item-uid]').length }));
    check('campaign-camp-after-phase1', strip.position === 'Battle 1 of 1 · Phase 2 of 2' && strip.next === 'Next: Fictional phase two (test only)'
      && strip.record.length === 1 && strip.record[0].startsWith('Fictional phase one (test only): Victory') && strip.depot > 0, JSON.stringify(strip));
    await page.locator('#camp-campaign').scrollIntoViewIfNeeded(); await shot(page, 'campaign-camp-strip');
    await narrow('camp'); await wide();
    // ---- reload: title Continue returns to the same camp ----
    const rawBefore = await slotRaw(2);
    await entry('');
    const cont = await page.evaluate(() => ({ focus: document.activeElement.id, slotText: document.getElementById('entry-campaign-slot').textContent, slot: window.__entry.campaign.continueSlot }));
    check('campaign-continue-title', cont.focus === 'entry-campaign-continue' && cont.slot === 2 && cont.slotText.includes('Slot 2') && cont.slotText.includes('Fictional phase two'), JSON.stringify(cont));
    await Promise.all([page.waitForURL(/\?camp=2$/), page.locator('#entry-campaign-continue').click()]);
    await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    check('campaign-continue-same', await slotRaw(2) === rawBefore && await page.evaluate(() => document.getElementById('camp-next').textContent === 'Next: Fictional phase two (test only)'
      && document.querySelectorAll('#camp-record li').length === 1), 'Continue reopens slot 2 camp unchanged');
    // ---- phase 2: defeat, then the marked replay ----
    await page.locator('#camp-next').click(); await fieldReady();
    const brief2 = await page.evaluate(() => ({ loan: !!document.getElementById('briefing-loan'), franchise: window.__game.game.units.find((u) => u.id === 'sherman')?.menMax }));
    check('campaign-phase2-franchise', !brief2.loan && brief2.franchise === 2500, `no loan line; franchise brigade fields its own 2500 men (${brief2.franchise})`);
    const p2 = await playPhase('US', 'phase2');
    const after2 = await slotSave(2), replayShown = await page.evaluate(() => !document.getElementById('result-replay').hidden);
    check('campaign-defeat-continues', p2.grade === 'Defeat' && after2.campaign.index === 2 && after2.campaign.status === 'complete' && after2.campaign.history[1].grade === 'Defeat' && replayShown,
      'defeat is recorded, the ladder still advances, and Replay this phase is offered');
    await Promise.all([page.waitForURL(/campaign=2&replay$/), page.locator('#result-replay').click()]); await fieldReady();
    const brief3 = await page.evaluate(() => ({ eyebrow: document.querySelector('#briefing .briefing-eyebrow')?.textContent, replay: window.__game.campaign?.phase.replay }));
    check('campaign-replay-briefing', brief3.replay === true && /replay/.test(brief3.eyebrow), JSON.stringify(brief3));
    await playPhase('CS', 'replay');
    const after3 = await slotSave(2);
    check('campaign-replay-marked', after3.campaign.history.length === 3 && after3.campaign.history[2].replay === true && after3.campaign.history[2].grade === 'Victory'
      && after3.campaign.index === 2 && after3.campaign.status === 'complete', JSON.stringify(after3.campaign.history.map((r) => [r.phaseId, r.grade, r.replay])));
    // ---- Continue -> campaign complete ----
    await entry('');
    await Promise.all([page.waitForURL(/\?camp=2$/), page.locator('#entry-campaign-continue').click()]);
    await page.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    const done = await page.evaluate(() => ({ complete: !document.getElementById('camp-complete').hidden && document.getElementById('camp-complete').textContent,
      next: document.getElementById('camp-next').hidden, replays: document.querySelectorAll('#camp-record li[data-replay="true"]').length,
      rows: document.querySelectorAll('#camp-record li').length, focus: document.activeElement.id }));
    check('campaign-complete-panel', typeof done.complete === 'string' && done.complete.startsWith('Campaign complete') && done.next && done.rows === 3 && done.replays === 1
      && done.focus === 'camp-campaign-heading', JSON.stringify(done));
    await axe('#front', 'completeAxe'); await page.locator('#camp-campaign').scrollIntoViewIfNeeded(); await shot(page, 'campaign-complete');
    // ---- Battles menu opens a pack phase (historical, no campaign write) ----
    const rawDone = await slotRaw(2);
    await entry(''); await page.locator('#entry-battles').click();
    await page.waitForFunction(() => document.querySelectorAll('#entry-battle-rows a').length === 2);
    await page.locator('#entry-battle-rows a').nth(1).click(); await fieldReady();
    const hist = await page.evaluate(() => ({ pack: window.__game.pack, campaign: window.__game.campaign, briefing: !!document.getElementById('briefing'), mode: document.getElementById('play-mode').textContent }));
    check('campaign-battles-open', hist.pack?.packId === PACK_ID && hist.pack.phaseId === 'p2' && hist.campaign === null && !hist.briefing && hist.mode.startsWith('Historical')
      && await slotRaw(2) === rawDone, JSON.stringify(hist));
    check('campaign-slot1-untouched', await progressRaw(page) === slot1, 'slot 1 practice save byte-identical after all slot 2 play');
    // Requests cut off by this flow's own navigations (Next, Return to camp, Replay) are expected aborts.
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('campaign-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
  // ---- the empty shipped campaign keeps today's title ----
  const plain = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  try {
    const p = await plain.newPage();
    await p.goto(url); await p.waitForFunction(() => window.__entry && !window.__entry.importing);
    const t = await p.evaluate(() => ({ campaign: window.__entry.campaign, focus: document.activeElement.id, text: document.getElementById('entry-continue').textContent,
      cls: document.getElementById('entry-continue').className, hidden: ['entry-new-campaign', 'entry-campaign-continue', 'entry-battles'].every((id) => document.getElementById(id).hidden),
      heading: document.getElementById('entry-title-heading').textContent }));
    check('campaign-empty-title', t.campaign === null && t.focus === 'entry-continue' && t.text === 'Continue' && t.cls === 'entry-primary' && t.hidden && t.heading === 'Your first command', JSON.stringify(t));
  } finally { await plain.close().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of CAMPAIGN_UI_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = CAMPAIGN_UI_CHECKS.length;
  if (failed) { console.log(`CAMPAIGN UI FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`CAMPAIGN UI OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of CAMPAIGN_UI_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`CAMPAIGN UI CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`CAMPAIGN UI CONTROLS OK (${caught}/${n})`);
  }
}

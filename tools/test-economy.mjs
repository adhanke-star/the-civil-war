// CPU check: requisition points, reputation, reward cards and the camp shop (src/franchise/economy.js and tuning.js),
// their v2 save fields and ledger audit (src/franchise/save.js), the phase-points bridge (campaign.js recordPhase,
// practice.js phaseOutcome `held`) and the arms' first-issue months (src/reward/data.js ARM_DATES).
// A fictional two-battle campaign is built here; nothing ships for it and nothing is written to disk.
// `node tools/test-economy.mjs` prints ECONOMY OK (n/n); `--prove-fail` also runs one mutant per check and requires each
// to fail that check, with the check's own name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as economy from '../src/franchise/economy.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import { phaseOutcome } from '../src/franchise/practice.js';
import { ARMS, SAMPLE_ARMY, TIER_BY_ID } from '../src/reward/data.js';
import { ECONOMY } from '../src/franchise/tuning.js';

const API = { ...economy, ...campaign, ...save, phaseOutcome, ARMS };
const copy = structuredClone;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- fixtures: a fictional ladder (a1 on loan, a2, b1) and phase results written directly ----------------------------
const CAMPAIGN = { version: 1, id: 'test-econ', title: 'Fictional economy test campaign', franchise: [
  { unitId: 'alpha', label: 'Test brigade (fictional)', kind: 'infantry', men: 2000, weapon: 'm1842', vet: 'trained' },
  { unitId: 'bravo', label: 'Test battery (fictional)', kind: 'battery', men: 100, guns: 4, weapon: 'sixPdr', vet: 'green' }],
phases: [{ packId: 'pa', phaseId: 'a1', loan: true }, { packId: 'pa', phaseId: 'a2' }, { packId: 'pb', phaseId: 'b1' }] };
const units = (lossUS, lossCS) => [{ id: 'enemy', side: 'CS', menStart: 3000, men: 3000 - lossCS }, { id: 'friend', side: 'US', menStart: 3000, men: 3000 - lossUS }];
function play(api, s, { grade = 'Victory', held = false, lossUS = 100, lossCS = 400, replay = false } = {}) {
  const p = api.campaignPhase(s, CAMPAIGN, { replay });
  const record = { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: grade === 'Defeat' ? 'CS' : 'US', grade, held, units: units(lossUS, lossCS), loot: [] };
  return { phase: p, record, after: api.recordPhase(s, CAMPAIGN, record) };
}
const fresh = (api, seed = 1862, slot = 1) => api.newCampaign({ campaign: CAMPAIGN, slot, seed, at: '2026-10-11T12:00:00Z' });
/** A v2 save written before the economy existed: same campaign record, no economy fields. */
function oldV2(s) {
  const o = copy(s);
  for (const k of ['rp', 'reputation', 'level', 'shopSeen', 'ledger']) delete o[k];
  o.depot = o.depot.filter((it) => it.source !== 'reward'); // reward cards did not exist before the economy
  return o;
}
/** A fresh campaign with depot cards of the given tiers (fictional stores). */
function stocked(api, tiers, seed = 1862) {
  const s = fresh(api, seed), byTier = (t) => ARMS.find((a) => a.tier === t && !a.capturedOnly);
  return save.validateSnapshot({ ...s, depot: tiers.map((t, i) => ({ uid: `test-econ.1.fixture.${i}`, itemId: byTier(t).id, tier: t, conditionId: 'serviceable', source: 'capture', from: 'Fictional test stores' })) });
}
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  const mem = { data, writes: 0, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem(k, v) { this.writes++; data.set(k, v); } };
  mem.locks = { request(name, options, run) { const next = tail.then(run); tail = next.catch(() => {}); return next; } };
  return mem;
}
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
async function refusesAsync(name, run, pattern) {
  let error = null;
  try { await run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
const shopSeeds = Array.from({ length: 120 }, (_, i) => 1000 + i * 7919);

export const ECONOMY_CHECKS = [
  ['arm-dates', (api) => {
    for (const a of api.ARMS) {
      assert.ok(/^18(6[0-5])-(0[1-9]|1[0-2])$/.test(a.from ?? ''), `arm-dates: ${a.id} has no first-issue month`);
      assert.equal(typeof a.capturedOnly, 'boolean', `arm-dates: ${a.id} has no captured-only flag`);
      assert.ok(Array.isArray(a.sources) && a.sources.length > 0 && a.sources.every((u) => /^https:\/\//.test(u)), `arm-dates: ${a.id} has no cited sources`);
      assert.ok(['Verified', 'Inferred', 'Disputed'].includes(a.fromProvenance) && (a.fromProvenance !== 'Verified' || a.sources.length >= 2),
        `arm-dates: ${a.id} is marked ${a.fromProvenance} with ${a.sources.length} source(s)`);
    }
    const by = Object.fromEntries(api.ARMS.map((a) => [a.id, a]));
    assert.deepEqual([by.spencer?.from, by.henry?.from, by.whitworth?.capturedOnly, by.m1842?.from], ['1863-05', '1863-05', true, '1861-04'], 'arm-dates: Spencer/Henry months or the Whitworth captured-only flag');
  }],
  ['phase-points', (api) => {
    const score = (o) => api.phasePoints({ lossesUS: 100, lossesCS: 100, ...o }).score;
    assert.deepEqual(['Decisive', 'Victory', 'Draw', 'Defeat'].map((grade) => score({ grade })), [60, 40, 20, 10], 'phase-points: grade table');
    assert.equal(score({ grade: 'Victory', held: true }), 55, 'phase-points: held objective bonus');
    assert.deepEqual([score({ grade: 'Victory', lossesUS: 200, lossesCS: 400 }), score({ grade: 'Victory', lossesUS: 201, lossesCS: 400 })], [50, 40], 'phase-points: low-loss bonus at exactly half and not above');
    assert.deepEqual([score({ grade: 'Decisive', held: true, lossesUS: 1, lossesCS: 9, loan: true }), score({ grade: 'Defeat', loan: true })], [42, 5], 'phase-points: loan pays half, rounded down');
    const lines = api.phasePoints({ grade: 'Decisive', held: true, lossesUS: 1, lossesCS: 9, loan: true }).lines;
    assert.deepEqual(lines.map((l) => [l.id, l.points]), [['grade', 60], ['held', 15], ['lowLoss', 10], ['loan', -43]], 'phase-points: breakdown lines');
    refuses('phase-points', () => api.phasePoints({ grade: 'Rout' }), /^Economy: unknown grade/);
  }],
  ['award-once', async (api) => {
    const s0 = fresh(api), p1 = play(api, s0, { grade: 'Victory', held: true, lossUS: 100, lossCS: 400 });
    assert.deepEqual([p1.after.rp, p1.after.reputation, p1.after.ledger.filter((r) => r.kind === 'phase').length], [32, 32, 1], 'award-once: loan victory (held, light losses) pays 65 / 2 = 32');
    assert.deepEqual(api.recordPhase(p1.after, CAMPAIGN, p1.record), p1.after, 'award-once: re-recording the same award changed the save or paid twice');
    assert.equal(api.awardPhase(p1.after, { awardId: p1.phase.awardId, grade: 'Decisive', held: true }).rp, 32, 'award-once: awardPhase paid an award twice');
    const mem = memory(), store = api.createProgressStore(mem, { locks: mem.locks });
    await store.complete(s0);
    const a = await store.complete(p1.after, { previous: s0 }), b = await store.complete(p1.after, { previous: s0 });
    assert.deepEqual([a.duplicate, b.duplicate, (await store.load()).rp], [false, true, 32], 'award-once: the store rewrote a completed award');
  }],
  ['replay-improvement', (api) => {
    let s = fresh(api);
    s = play(api, s, { grade: 'Victory' }).after; // a1 loan: (40 + 10) / 2 = 25
    s = play(api, s, { grade: 'Defeat', lossUS: 900, lossCS: 100 }).after; // a2: 10
    const lost = play(api, s, { grade: 'Defeat', lossUS: 900, lossCS: 100, replay: true }).after; // replay, no better: 0
    const won = play(api, lost, { grade: 'Victory', held: true, lossUS: 50, lossCS: 400, replay: true }).after; // 65 - 10 = 55
    // Paid again on a pre-economy save: the same history pays the same amounts through awardPhase.
    let old = save.validateSnapshot(oldV2(won));
    for (const r of old.campaign.history) {
      const held = won.ledger.find((x) => x.kind === 'phase' && x.awardId === r.awardId).held;
      old = api.awardPhase(old, { awardId: r.awardId, grade: r.grade, held, lossesUS: r.lossesUS, lossesCS: r.lossesCS, loan: r.packId === 'pa' && r.phaseId === 'a1' });
    }
    const paid = old.ledger.filter((x) => x.kind === 'phase').map((x) => [x.score, x.points]);
    assert.deepEqual(paid, [[25, 25], [10, 10], [10, 0], [65, 55]], 'replay-improvement: a replay must pay only the improvement on the phase\'s best');
    assert.deepEqual([old.reputation, old.rp, won.reputation], [90, 90, 90], 'replay-improvement: totals');
  }],
  ['levels', (api) => {
    const at = [0, 59, 60, 149, 150, 269, 270, 420, 600, 810, 1050, 1319, 1320, 1620, 99999];
    assert.deepEqual(at.map(api.levelFor), [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 8, 9, 10, 10], 'levels: thresholds 0/60/150/270/420/600/810/1050/1320/1620');
    assert.deepEqual([1, 2, 9, 10].map(api.nextLevelAt), [60, 150, 1620, null], 'levels: next threshold');
    assert.deepEqual(Array.from({ length: 10 }, (_, i) => api.shopTierFor(i + 1)),
      ['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'veryRare', 'veryRare', 'legendary', 'legendary'], 'levels: shop tier by level');
  }],
  ['level-card', (api) => {
    const want = { 2: 'uncommon', 3: 'uncommon', 4: 'rare', 5: 'rare', 6: 'veryRare', 7: 'veryRare', 8: 'veryRare', 9: 'legendary', 10: 'legendary' };
    for (const seed of shopSeeds.slice(0, 40)) for (const [level, tier] of Object.entries(want)) {
      const card = api.levelCard({ seed, campaignId: 'test-econ', slot: 1, level: Number(level) });
      assert.deepEqual(api.levelCard({ seed, campaignId: 'test-econ', slot: 1, level: Number(level) }), card, 'level-card: not deterministic from seed and level');
      assert.ok(card.tier === tier && API.ARMS.find((a) => a.id === card.itemId)?.tier === tier, `level-card: level ${level} dealt ${card.tier}, not ${tier}`);
      assert.ok(!API.ARMS.find((a) => a.id === card.itemId).capturedOnly, 'level-card: a captured-only arm was dealt');
      assert.equal(card.uid, `test-econ.1.level.${level}`, 'level-card: card identity');
    }
    // A jump over several levels deals one card per level, into the depot, recorded once each.
    const s = api.turnInCard(stocked(api, ['legendary', 'legendary']), { itemUid: 'test-econ.1.fixture.0' });
    const t = api.turnInCard(s, { itemUid: 'test-econ.1.fixture.1' });
    assert.deepEqual([s.level, t.level, t.reputation], [2, 3, 160], 'level-card: levels reached by two 80-point turn-ins');
    assert.deepEqual(t.ledger.filter((r) => r.kind === 'level').map((r) => r.level), [2, 3], 'level-card: one ledger record per level');
    assert.deepEqual(t.depot.map((it) => it.uid), ['test-econ.1.level.2', 'test-econ.1.level.3'], 'level-card: reward cards not in the depot');
    assert.deepEqual(api.levelUps(s, t)?.cards.map((c) => c.uid), ['test-econ.1.level.3'], 'level-card: levelUps names the newly dealt card');
  }],
  ['shop-gating', (api) => {
    const atLevel = (seed, level) => {
      const s = fresh(api, seed), rep = ECONOMY.levels[level - 1];
      return { ...s, level, reputation: rep, rp: rep, ledger: [...Array.from({ length: level - 1 }, (_, i) => ({ kind: 'level', level: i + 2, uid: `x.${i}` })),
        ...(rep ? [{ kind: 'turnIn', item: { uid: 'test-econ.gate', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional' }, points: rep, at: 0 }] : [])] };
    };
    let spencerLate = 0;
    for (const seed of shopSeeds) {
      const top = save.validateSnapshot(atLevel(seed, 10));
      const early = api.shopStock(top, { date: '1863-04-30' }), late = api.shopStock(top, { date: '1863-11-24' }), war = api.shopStock(top, { date: '1865-04' });
      assert.ok(!early.some((o) => ['spencer', 'henry'].includes(o.itemId)), `shop-gating: a repeater was stocked before May 1863 (seed ${seed})`);
      assert.ok(![...early, ...late, ...war].some((o) => o.itemId === 'whitworth'), 'shop-gating: the captured-only Whitworth was stocked');
      if (late.some((o) => o.itemId === 'spencer')) spencerLate++;
      for (const list of [early, late, war]) {
        assert.ok(list.length <= 6 && new Set(list.map((o) => o.itemId)).size === list.length, 'shop-gating: more than six lots or a repeated arm');
        assert.ok(list.every((o) => o.price === ECONOMY.price[o.tier]), 'shop-gating: price is not by rarity');
      }
      const low = save.validateSnapshot(atLevel(seed, 1)), mid = save.validateSnapshot(atLevel(seed, 3));
      assert.ok(api.shopStock(low, { date: '1863-11' }).every((o) => o.tier === 'common'), 'shop-gating: level 1 stocked above Common');
      assert.ok(api.shopStock(mid, { date: '1863-11' }).every((o) => TIER_BY_ID[o.tier].rank <= 1), 'shop-gating: level 3 stocked above Uncommon');
      assert.ok(api.shopStock(mid, { date: '1861-07-21' }).every((o) => API.ARMS.find((a) => a.id === o.itemId).from <= '1861-07'), 'shop-gating: an arm stocked before its first-issue month');
      assert.deepEqual(api.shopStock(top, { date: '1863-11-24' }), late, 'shop-gating: stock is not deterministic');
    }
    assert.ok(spencerLate > 0, 'shop-gating: the Spencer is never stocked even after its first-issue month');
    refuses('shop-gating', () => api.shopStock(fresh(api), { date: 'soon' }), /^Economy: the shop needs the next phase's date/);
  }],
  ['buy-exchange', async (api) => {
    let s = api.turnInCard(stocked(api, ['legendary']), { itemUid: 'test-econ.1.fixture.0' }); // 80 points, level 2 (Common shop)
    const date = '1862-04-06', lot = api.shopStock(s, { date })[0];
    assert.ok(lot && lot.price === 30 && !lot.sold, 'buy-exchange: fixture shop has no Common lot');
    const mem = memory({ 'cw.progress': JSON.stringify(s) }), store = api.createProgressStore(mem, { locks: mem.locks });
    const bought = await store.exchange(api.buyLot, { itemId: lot.itemId, date }, { previous: s });
    const card = bought.depot.find((it) => it.uid === lot.uid);
    assert.deepEqual([bought.rp, bought.reputation, card?.source, card?.conditionId, bought.ledger.at(-1).kind], [s.rp - 30, s.reputation, 'requisition', lot.conditionId, 'buy'],
      'buy-exchange: a purchase must cost its price, keep reputation and put the lot in the depot');
    assert.equal(mem.data.get('cw.progress'), JSON.stringify(bought), 'buy-exchange: the purchase was not written');
    assert.ok(api.shopStock(bought, { date }).find((o) => o.itemId === lot.itemId).sold, 'buy-exchange: a bought lot is not marked sold');
    refuses('buy-exchange', () => api.buyLot(bought, { itemId: lot.itemId, date }), /^Economy: that lot has already been bought/);
    refuses('buy-exchange', () => api.buyLot(bought, { itemId: 'whitworth', date }), /^Economy: that lot is not in stock/);
    const poor = api.buyLot(bought, { itemId: api.shopStock(bought, { date }).find((o) => !o.sold).itemId, date });
    const rest = api.shopStock(poor, { date }).find((o) => !o.sold);
    if (rest) refuses('buy-exchange', () => api.buyLot(poor, { itemId: rest.itemId, date }), /^Economy: it costs 30 requisition points and you have 20/);
    await refusesAsync('buy-exchange', () => store.exchange(api.buyLot, { itemId: lot.itemId, date }, { previous: s }), /^Progress: progress changed since this exchange was reviewed/);
    assert.equal(mem.data.get('cw.progress'), JSON.stringify(bought), 'buy-exchange: a stale-baseline exchange changed storage');
    refuses('buy-exchange', () => api.buyLot(save.completedSnapshot({ awardId: 'v1', army: copy(SAMPLE_ARMY), depot: [], issued: [], seed: 1, grade: 'Victory' }), { itemId: 'm1842', date }), /^Economy: requisition is for campaign saves/);
  }],
  ['turn-in-exchange', async (api) => {
    const s = stocked(api, ['common', 'rare', 'veryRare']);
    const t = api.turnInCard(s, { itemUid: 'test-econ.1.fixture.1' });
    assert.deepEqual([t.rp, t.reputation, t.depot.map((it) => it.uid)], [20, 20, ['test-econ.1.fixture.0', 'test-econ.1.fixture.2']], 'turn-in-exchange: a Rare must pay 20 and leave the depot');
    assert.deepEqual(t.ledger.at(-1), { kind: 'turnIn', item: s.depot[1], points: 20, at: 0 }, 'turn-in-exchange: ledger record');
    refuses('turn-in-exchange', () => api.turnInCard(t, { itemUid: 'test-econ.1.fixture.1' }), /^Economy: that card is no longer in the depot/);
    refuses('turn-in-exchange', () => api.turnInCard(t, { itemUid: t.army[0].weapon.uid }), /^Economy: that card is no longer in the depot/);
    // Issue a depot card, turn in the displaced weapon, issue again: the audit still walks every transfer.
    const issued = save.exchangeDepot(t, { brigadeId: 'alpha', itemUid: 'test-econ.1.fixture.2' });
    const displaced = issued.depot.at(-1).uid, gone = api.turnInCard(issued, { itemUid: displaced });
    const back = save.exchangeDepot(gone, { brigadeId: 'alpha', itemUid: 'test-econ.1.fixture.0' });
    assert.deepEqual([back.issued.length, back.ledger.filter((r) => r.kind === 'turnIn').map((r) => r.at), back.reputation], [2, [0, 1], 25], 'turn-in-exchange: issue / turn-in / issue history');
    assert.deepEqual(save.parseSnapshot(save.exportSnapshot(back)), back, 'turn-in-exchange: the save does not round-trip');
    const mem = memory({ 'cw.progress': JSON.stringify(t) }), store = api.createProgressStore(mem, { locks: mem.locks });
    const written = await store.exchange(api.turnInCard, { itemUid: 'test-econ.1.fixture.0' }, { previous: t });
    assert.equal(written.rp, 25, 'turn-in-exchange: the store did not write the turn-in');
  }],
  ['ledger-audit', (api) => {
    const s = play(api, fresh(api), { grade: 'Victory', held: true }).after, t = api.turnInCard(save.validateSnapshot({ ...s, depot: [...s.depot, { uid: 'test-econ.1.extra', itemId: 'lorenz', tier: 'uncommon', conditionId: 'worn', from: 'Fictional' }] }), { itemUid: 'test-econ.1.extra' });
    const phase = t.ledger.find((r) => r.kind === 'phase'), turn = t.ledger.find((r) => r.kind === 'turnIn');
    const { rp, reputation, level, shopSeen, ledger, ...bare } = t;
    const bad = [[{ ...t, rp: t.rp + 1 }, /do not match the ledger/], [{ ...t, reputation: t.reputation + 5, rp: t.rp + 5 }, /do not match the ledger/],
      [{ ...t, ledger: [...t.ledger, phase] }, /one recorded phase/], [{ ...t, ledger: [{ ...phase, awardId: 'test-econ.1.pz.z.1' }, turn] }, /one recorded phase/],
      [{ ...t, depot: [...t.depot, turn.item] }, /still in the inventory/], [{ ...t, level: 2 }, /reward cards/], [{ ...t, shopSeen: 2 }, /shop level seen/],
      [{ ...bare, rp }, /missing or unsupported fields/], [{ ...t, ledger: [...t.ledger, { kind: 'gift', points: 5 }] }, /invalid requisition ledger entry/],
      [{ ...t, ledger: [phase, { ...turn, at: 3 }] }, /turn-in position/], [{ ...t, rp: -5, reputation: t.reputation, ledger: [...t.ledger, { kind: 'buy', uid: 'test-econ.1.shop.0.m1842', itemId: 'm1842', tier: 'common', price: t.reputation + 5, phase: 0 }] }, /requisition points/]];
    for (const [v, pattern] of bad) refuses('ledger-audit', () => api.validateSnapshot(v), pattern);
  }],
  ['old-saves', async (api) => {
    const v1 = save.completedSnapshot({ awardId: 'practice-v1', army: copy(SAMPLE_ARMY), depot: [], issued: [], seed: 7, grade: 'Victory' }), raw = JSON.stringify(v1);
    const mem = memory({ 'cw.progress': raw }), loaded = await api.createProgressStore(mem, { locks: mem.locks }).load();
    assert.ok(api.exportSnapshot(loaded) === raw && !ECONOMY_FIELDS.some((k) => has(loaded, k)), 'old-saves: a v1 save changed shape or gained economy fields');
    const p1 = play(api, fresh(api), { grade: 'Victory' }), before = oldV2(p1.after);
    let old = null;
    try { old = api.parseSnapshot(JSON.stringify(before)); } catch (e) { assert.fail(`old-saves: a pre-economy v2 save did not load (${e.message})`); }
    assert.deepEqual([old.rp, old.reputation, old.level, old.shopSeen, old.ledger], [0, 0, 1, 1, []], 'old-saves: a pre-economy v2 save must load as 0/0/1');
    const next = play(api, old, { grade: 'Decisive', held: true, lossUS: 10, lossCS: 400 }).after;
    assert.deepEqual([next.rp, next.reputation, next.level], [85, 85, 2], 'old-saves: a pre-economy save does not earn from zero');
  }],
  ['shop-seen', (api) => {
    const s = fresh(api);
    assert.deepEqual([s.level, s.shopSeen, api.markShopSeen(s)], [1, 1, s], 'shop-seen: a fresh campaign starts at level 1 with nothing new');
    const up = api.turnInCard(stocked(api, ['legendary']), { itemUid: 'test-econ.1.fixture.0' });
    assert.deepEqual([up.level, up.shopSeen], [2, 1], 'shop-seen: a level-up must leave the shop marked new');
    const seen = api.markShopSeen(up);
    assert.deepEqual([seen.shopSeen, seen.rp, seen.depot.length, api.markShopSeen(seen)], [2, up.rp, up.depot.length, seen], 'shop-seen: opening the shop clears the marker and nothing else');
  }],
  ['phase-summary', (api) => {
    let s = fresh(api);
    s = play(api, s, { grade: 'Decisive', held: true, lossUS: 10, lossCS: 400 }).after; // loan: 42
    const before = s, p2 = play(api, s, { grade: 'Decisive', held: true, lossUS: 10, lossCS: 400 }); // 85 -> 127, level 2
    const sum = api.phaseSummary(before, p2.after);
    assert.deepEqual([sum.points, sum.lines.reduce((n, l) => n + l.points, 0), sum.reputation, sum.level, sum.nextAt], [85, 85, { from: 42, to: 127 }, 2, 150], 'phase-summary: breakdown and totals');
    assert.deepEqual([sum.levelUp?.from, sum.levelUp?.to, sum.levelUp?.cards.map((c) => c.uid)], [1, 2, ['test-econ.1.level.2']], 'phase-summary: level reached and its reward card');
    const loan = api.phaseSummary(fresh(api), before);
    assert.deepEqual(loan.lines.map((l) => l.id), ['grade', 'held', 'lowLoss', 'loan'], 'phase-summary: loan line missing');
    assert.equal(api.phaseSummary(p2.after, api.recordPhase(p2.after, CAMPAIGN, p2.record)), null, 'phase-summary: a re-recorded award shows points again');
  }],
  ['phase-held', (api) => {
    const scenario = { units: [{ id: 'u1', side: 'US', type: 'infantry', name: 'Fictional', men: 500 }, { id: 'e1', side: 'CS', type: 'infantry', name: 'Fictional foe', men: 500 }], crates: [] };
    const game = (holder) => ({ scenario, over: true, playerSide: 'US', holder, result: { winner: 'US', grade: 'victory' }, fieldCaptures: { held: () => [] },
      units: scenario.units.map((d) => ({ id: d.id, side: d.side, type: 'infantry', name: d.name, menMax: d.men, men: d.men - 50, weapon: 'smooth', xp: 1 })) });
    const out = (holder) => api.phaseOutcome({ game: game(holder), scenario, awardId: 'test-econ.1.pa.a2.1', seed: 1 });
    assert.deepEqual([out('US').held, out('CS').held, out('contested').held], [true, false, false], 'phase-held: held must be the Union holding the objective at the end');
    const s = play(api, fresh(api), {}).after, p = api.campaignPhase(s, CAMPAIGN);
    const { record } = api.phaseResult({ phase: p, game: game('US'), scenario });
    assert.equal(record.held, true, 'phase-held: phaseResult drops held');
    const next = api.recordPhase(s, CAMPAIGN, { ...record, units: units(0, 0) });
    assert.equal(next.ledger.find((r) => r.kind === 'phase' && r.awardId === p.awardId)?.score, 65, 'phase-held: a held objective did not pay its bonus');
  }],
];
const ECONOMY_FIELDS = save.ECONOMY_FIELDS;

const MUTANTS = {
  'arm-dates': { ARMS: ARMS.map((a) => (a.id === 'spencer' ? { ...a, from: '1862-01', fromProvenance: 'Verified', sources: [a.sources[0]] } : a)) },
  'phase-points': { phasePoints: (o) => economy.phasePoints({ ...o, loan: false }) },
  'award-once': { recordPhase: (s, c, { awardId, ...r }) => campaign.recordPhase(s, c, r) },
  'replay-improvement': { awardPhase: (s, o) => {
    const v = save.validateSnapshot(s), row = v.campaign.history.find((r) => r.awardId === o.awardId);
    const same = v.campaign.history.filter((r) => r.packId === row.packId && r.phaseId === row.phaseId).map((r) => r.awardId);
    const hidden = v.ledger.filter((r) => r.kind === 'phase' && same.includes(r.awardId) && r.awardId !== o.awardId);
    const paid = economy.awardPhase(save.validateSnapshot({ ...v, ledger: v.ledger.map((r) => (hidden.includes(r) ? { ...r, score: 0 } : r)) }), o);
    return save.validateSnapshot({ ...paid, ledger: paid.ledger.map((r, i) => (i < v.ledger.length ? v.ledger[i] : r)) });
  } },
  'levels': { levelFor: (rep) => economy.levelFor(rep - 1) },
  'level-card': { levelCard: (o) => economy.levelCard({ ...o, level: 2 }) },
  'shop-gating': { shopStock: (s, o) => economy.shopStock(s, { ...o, date: '1865-04' }) },
  'buy-exchange': { buyLot: (s, c) => { try { return economy.buyLot(s, c); } catch { return save.validateSnapshot(s); } } },
  'turn-in-exchange': { turnInCard: (s, c) => economy.turnInCard(s, { itemUid: save.validateSnapshot(s).depot[0]?.uid ?? c.itemUid }) },
  'ledger-audit': { validateSnapshot: (v) => v },
  'old-saves': { parseSnapshot: (t) => { const v = JSON.parse(t); if (v.version === 2 && !has(v, 'rp')) throw new Error('Progress: missing or unsupported fields.'); return save.validateSnapshot(v); } },
  'shop-seen': { markShopSeen: (s) => save.validateSnapshot(s) },
  'phase-summary': { phaseSummary: (b, a) => { const p = economy.phaseSummary(b, a); return p && { ...p, lines: p.lines.filter((l) => l.id !== 'loan') }; } },
  'phase-held': { phaseOutcome: (o) => ({ ...phaseOutcome(o), held: false }) },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function economyUnit(api = API) {
  for (const [name, check] of ECONOMY_CHECKS) await runCheck(name, check, api);
  return ECONOMY_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of ECONOMY_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = ECONOMY_CHECKS.length;
  if (failed) { console.log(`ECONOMY FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`ECONOMY OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of ECONOMY_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`ECONOMY CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`ECONOMY CONTROLS OK (${caught}/${n})`);
  }
}

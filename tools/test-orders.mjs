// CPU check: decision cards (assets/decisions.json, src/franchise/decisions.js), camp orders and the march out of camp
// (src/franchise/camp-orders.js), stores, army upgrades, training, extra badge slots and affix re-rolls (economy.js), their v2
// save fields and ledger audit (save.js), and what reaches the battle through applyCampaign (campaign.js: morale, equipment).
// A fictional two-battle campaign and a fictional deck are built here; the shipped deck is checked against the shipped ladder
// and its battle packs. Nothing is written to disk.
// `node tools/test-orders.mjs` prints ORDERS OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail that check, with the check's own name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as decisions from '../src/franchise/decisions.js';
import * as orders from '../src/franchise/camp-orders.js';
import * as economy from '../src/franchise/economy.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import * as badges from '../src/franchise/badges.js';
import { equipmentProfile } from '../src/sim/equipment.js';
import { CAMP } from '../src/franchise/tuning.js';
import { SAMPLE_ARMY, CONDITIONS } from '../src/reward/data.js';

const API = { ...decisions, ...orders, ...economy, ...campaign, ...save, slotsOf: badges.slotsOf };
const copy = structuredClone;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const DECK_RAW = read('assets/decisions.json'), LADDER = read('assets/campaign.json');
const PACKS = Object.fromEntries([...new Set(LADDER.phases.map((p) => p.packId))].map((id) => [id, read(`assets/packs/${id}.json`)]));

// ---- fixtures: a fictional ladder (a1 on loan, a2, b1) and a fictional deck ------------------------------------------------
const CAMPAIGN = { version: 1, id: 'test-orders', title: 'Fictional camp test campaign', franchise: [
  { unitId: 'alpha', label: 'Test brigade (fictional)', kind: 'infantry', men: 2000, weapon: 'm1842', vet: 'green' },
  { unitId: 'bravo', label: 'Test battery (fictional)', kind: 'battery', men: 100, guns: 4, weapon: 'sixPdr', vet: 'trained' },
  { unitId: 'charlie', label: 'Test reserve (fictional)', kind: 'infantry', men: 1500, weapon: 'm1842', vet: 'green' }],
phases: [{ packId: 'pa', phaseId: 'a1', loan: true }, { packId: 'pa', phaseId: 'a2' }, { packId: 'pb', phaseId: 'b1' }] };
const opt = (id, gain, cost, effects) => ({ id, label: `Fictional option ${id}`, gain, cost, effects });
const DECK = { version: 1, cards: [
  { id: 'a1-card', pack: 'pa', phase: 'a1', title: 'Fictional loan dilemma', dilemma: 'A fictional dilemma for the tests.', sources: [{ label: 'Fictional source one' }, { label: 'Fictional source two' }],
    provenance: 'Verified', historicalOption: 'bold', historicalChoice: 'Fictional: the bold choice was made.', options: [
      opt('bold', '+4 morale', '20 ammunition', [{ kind: 'morale', amount: 4 }, { kind: 'store', store: 'ammunition', amount: -20 }]),
      opt('safe', '+15 points', '-4 morale', [{ kind: 'rp', amount: 15 }, { kind: 'morale', amount: -4 }]),
      opt('dear', '+6 morale', '30 points', [{ kind: 'morale', amount: 6 }, { kind: 'rp', amount: -30 }])] },
  { id: 'a2-card', pack: 'pa', phase: 'a2', title: 'Fictional franchise dilemma', dilemma: 'Another fictional dilemma.', sources: [{ label: 'Fictional source', url: 'https://example.org/fictional' }],
    provenance: 'Inferred', historicalOption: 'up', historicalChoice: 'Fictional.', options: [
      opt('up', '+5 morale', '10 rations', [{ kind: 'morale', amount: 5 }, { kind: 'store', store: 'rations', amount: -10 }]),
      opt('down', '+10 points', '-3 morale', [{ kind: 'rp', amount: 10 }, { kind: 'morale', amount: -3 }])] }] };
const SCENARIO = { units: [
  { id: 'alpha', side: 'US', type: 'infantry', name: 'Fictional alpha', men: 2000 }, { id: 'bravo', side: 'US', type: 'artillery', name: 'Fictional bravo', men: 100, guns: 4 },
  { id: 'friend', side: 'US', type: 'infantry', name: 'Fictional friend', men: 900, morale: 70 }, { id: 'enemy', side: 'CS', type: 'infantry', name: 'Fictional foe', men: 3000 }] };
const fresh = (api, seed = 1863, slot = 1) => api.newCampaign({ campaign: CAMPAIGN, slot, seed, at: '2026-10-11T12:00:00Z' });
const deck = (api) => api.validateDeck(copy(DECK));
const units = (lossUS = 100) => [{ id: 'alpha', side: 'US', menStart: 2000, men: 2000 - lossUS }, { id: 'enemy', side: 'CS', menStart: 3000, men: 2600 }];
function play(api, s, { grade = 'Victory', replay = false, lossUS = 100 } = {}) {
  const p = api.campaignPhase(s, CAMPAIGN, { replay });
  return api.recordPhase(s, CAMPAIGN, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade, units: units(lossUS), loot: [] });
}
/** A fresh campaign at level `level` with `rp` points (fictional turn-ins), optionally past the loan phase. */
function rich(api, { level = 5, rp = 1000, past = false } = {}) {
  let s = fresh(api);
  if (past) s = play(api, s);
  const turn = { uid: 'test-orders.1.fixture.rich', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional' };
  const reputation = s.reputation + rp, lv = Math.max(level, economy.levelFor(reputation));
  return save.validateSnapshot({ ...s, rp: s.rp + rp, reputation, level: lv, ledger: [...s.ledger, ...Array.from({ length: lv - s.level }, (_, i) => ({ kind: 'level', level: s.level + i + 1, uid: `x.${i}` })),
    { kind: 'turnIn', item: turn, points: rp, at: 0 }] });
}
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  const mem = { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem(k, v) { data.set(k, v); } };
  mem.locks = { request(name, options, run) { const next = tail.then(run); tail = next.catch(() => {}); return next; } };
  return mem;
}
const moraleOf = (scenario, id) => scenario.units.find((u) => u.id === id)?.morale;

export const ORDERS_CHECKS = [
  ['deck-valid', (api) => {
    const d = api.validateDeck(copy(DECK_RAW)), ladder = new Set(LADDER.phases.map((p) => `${p.packId}/${p.phaseId}`));
    const none = ['shiloh/grants-last-line', 'stones-river/mcfaddens-ford'];
    for (const key of ladder) {
      const n = d.cards.filter((c) => `${c.pack}/${c.phase}` === key).length;
      assert.ok(none.includes(key) ? n === 0 : n >= 1 && n <= 2, `deck-valid: ${key} has ${n} cards (1-2 where the research has candidates; none for ${none.join(', ')})`);
    }
    for (const c of d.cards) {
      assert.ok(ladder.has(`${c.pack}/${c.phase}`), `deck-valid: ${c.id} is for a phase that is not on the ladder`);
      assert.ok(PACKS[c.pack].phases.some((p) => p.id === c.phase), `deck-valid: ${c.id} names a phase its battle pack lacks`);
      assert.ok(c.options.length >= 2 && c.options.length <= 3 && c.options.every((o) => o.gain.trim() && o.cost.trim()), `deck-valid: ${c.id} needs 2-3 options with a gain and a cost`);
      assert.ok(c.sources.length >= 1 && (c.provenance !== 'Verified' || c.sources.length >= 2), `deck-valid: ${c.id} is not sourced for its provenance`);
      assert.ok(c.options.some((o) => o.id === c.historicalOption) && c.historicalChoice.length > 20, `deck-valid: ${c.id} has no revealed historical choice`);
    }
    const bad = (mutate) => { const x = copy(DECK); mutate(x.cards[0]); return x; };
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.options = c.options.slice(0, 1); })), /^Decisions: a1-card: a card has 2 or 3 options/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.options[0].effects = [{ kind: 'morale', amount: 4 }]; })), /every option needs a real gain and a real cost/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.sources = c.sources.slice(0, 1); })), /Verified needs two independent sources/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.options = c.options.filter((o) => o.id !== 'safe'); })), /one option must cost no points or stores/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.options[1].gain = ''; })), /invalid a1-card\/safe gain/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.historicalOption = 'nobody'; })), /historical option is not one of the card's options/);
    refuses('deck-valid', () => api.validateDeck(bad((c) => { c.options[0].effects[0] = { kind: 'dice', amount: 4 }; })), /unknown decision effect/);
  }],
  ['decision-once', async (api) => {
    const s0 = fresh(api), d = deck(api), p = api.campaignPhase(s0, CAMPAIGN);
    const s1 = api.chooseDecision(s0, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'safe' });
    assert.deepEqual([s1.rp, s1.reputation, s1.ledger.at(-1)], [15, 15, { kind: 'decision', awardId: p.awardId, cardId: 'a1-card', points: 15 }], 'decision-once: a +15 point choice must be earned once');
    assert.deepEqual(s1.decisions, [{ awardId: p.awardId, packId: 'pa', phaseId: 'a1', cardId: 'a1-card', optionId: 'safe', replay: false, effects: [{ kind: 'rp', amount: 15 }, { kind: 'morale', amount: -4 }] }], 'decision-once: the record');
    const again = api.chooseDecision(s1, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'bold' });
    assert.deepEqual(again, s1, 'decision-once: choosing again for the same phase attempt changed the save (it must show the recorded choice)');
    assert.equal(api.recorded(again, p, 'a1-card')?.optionId, 'safe', 'decision-once: the recorded choice is not the first one');
    const mem = memory({ 'cw.progress': JSON.stringify(s0) }), store = api.createProgressStore(mem, { locks: mem.locks });
    const w = await store.exchange(api.chooseDecision, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'safe' }, { previous: s0 });
    assert.equal(w.rp, 15, 'decision-once: the exchange did not write the choice');
    let stale = null; try { await store.exchange(api.chooseDecision, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'bold' }, { previous: s0 }); } catch (e) { stale = e; }
    assert.match(String(stale?.message), /progress changed since this exchange was reviewed/, 'decision-once: a stale second choice was written');
    refuses('decision-once', () => api.chooseDecision(s0, { campaign: CAMPAIGN, deck: d, cardId: 'a2-card', optionId: 'up' }), /^Decisions: that card is not one of this phase's decisions/);
    refuses('decision-once', () => api.chooseDecision(s0, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'dear' }), /needs 30 requisition points; you have 0/);
  }],
  ['decision-replay', (api) => {
    const d = deck(api);
    let s = api.chooseDecision(fresh(api), { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'safe' });
    s = play(api, s);
    const r = api.campaignPhase(s, CAMPAIGN, { replay: true }), first = s.decisions[0];
    const t = api.chooseDecision(s, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'bold', replay: true });
    assert.ok(r.awardId !== first.awardId && t.decisions.length === 2, 'decision-replay: a replayed phase must be able to choose again');
    assert.deepEqual([t.decisions[1].awardId, t.decisions[1].replay, t.decisions[1].optionId, first.replay], [r.awardId, true, 'bold', false], 'decision-replay: the replay\'s record must note it');
    const next = api.campaignPhase(s, CAMPAIGN), u = api.chooseDecision(s, { campaign: CAMPAIGN, deck: d, cardId: 'a2-card', optionId: 'down' });
    assert.equal(u.decisions.at(-1).awardId, next.awardId, 'decision-replay: the next phase\'s card is recorded against the replay');
  }],
  ['decision-effects', (api) => {
    const d = deck(api), s0 = fresh(api), p = api.campaignPhase(s0, CAMPAIGN);
    const s1 = api.chooseDecision(s0, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'bold' });
    assert.deepEqual([api.storesOf(s1).ammunition, s1.rp], [CAMP.start.ammunition - 20, 0], 'decision-effects: a store cost must be taken now');
    const field = api.applyCampaign(SCENARIO, s1, p);
    assert.deepEqual(['alpha', 'bravo', 'friend', 'enemy'].map((id) => moraleOf(field, id)), [82, 82, 74, undefined],
      'decision-effects: +4 morale must reach every Union formation of the phase (78 by default, the pack\'s own value otherwise) and no enemy');
    assert.equal(moraleOf(api.applyCampaign(SCENARIO, s1, api.campaignPhase(play(api, s1), CAMPAIGN)), 'alpha'), undefined, 'decision-effects: a decision leaked into another phase');
    const poor = save.validateSnapshot({ ...fresh(api), stores: { ...CAMP.start, ammunition: 10 } });
    assert.equal(api.optionOpen(poor, d.cards[0].options[0]).ok, false, 'decision-effects: an option the stores cannot pay is open');
    refuses('decision-effects', () => api.chooseDecision(poor, { campaign: CAMPAIGN, deck: d, cardId: 'a1-card', optionId: 'bold' }), /needs 20 ammunition; you have 10/);
  }],
  ['orders-once', (api) => {
    let s = fresh(api);
    s = api.setOrder(s, { brigadeId: 'alpha', order: 'drill' });
    s = api.setOrder(s, { brigadeId: 'bravo', order: 'target' });
    assert.deepEqual(s.army.map((b) => b.order ?? 'rest'), ['drill', 'target', 'rest'], 'orders-once: standing orders (Rest by default)');
    const alpha0 = s.army[0], bravo0 = s.army[1];
    const m1 = api.breakCamp(s, { campaign: CAMPAIGN }); // a1 is on loan: orders and the issue only
    const a = m1.army[0], b = m1.army[1], st = api.storesOf(m1);
    assert.deepEqual([a.drilled, a.base.drill - alpha0.base.drill, a.bonus?.drill, b.base.fire - bravo0.base.fire, b.bonus?.fire],
      [1, CAMP.drill.bar, CAMP.drill.bar, CAMP.target.bar, CAMP.target.bar], 'orders-once: Drill and Target practice raise their bars once');
    assert.deepEqual([st.ammunition, st.rations, m1.ready.morale], [CAMP.start.ammunition + CAMP.issue.ammunition - CAMP.target.ammunition, CAMP.start.rations + CAMP.issue.rations,
      { charlie: CAMP.rest.morale }], 'orders-once: issue, target ammunition and Rest morale (a loan phase draws nothing)');
    assert.deepEqual(api.breakCamp(m1, { campaign: CAMPAIGN }), m1, 'orders-once: marching out twice for one phase attempt applied the orders twice');
    // Three drills raise veterancy one tier.
    let t = m1;
    for (let i = 0; i < 2; i++) t = api.breakCamp(play(api, t, { grade: 'Draw' }), { campaign: CAMPAIGN }); // Draw: no veterancy from the battle
    assert.deepEqual([t.army[0].drilled, t.army[0].vet], [3, 'trained'], 'orders-once: the third drill must raise Green to Trained');
    refuses('orders-once', () => api.setOrder(s, { brigadeId: 'alpha', order: 'parade' }), /^Camp: choose Rest, Drill or Target practice/);
  }],
  ['stores-shortage', (api) => {
    let s = play(api, fresh(api)); // a2 next: a franchise phase
    const before = api.storesOf(s);
    const m = api.breakCamp(s, { campaign: CAMPAIGN, fielded: ['alpha', 'bravo', 'friend'] }), st = api.storesOf(m);
    assert.deepEqual([before.ammunition + CAMP.issue.ammunition - st.ammunition, before.horses + CAMP.issue.horses - st.horses, before.shoes + CAMP.issue.shoes - st.shoes],
      [2 * CAMP.use.ammunition, CAMP.use.horses, 2 * CAMP.use.shoes], 'stores-shortage: two fielded brigades (one battery) draw; charlie stays in camp and draws nothing');
    assert.deepEqual(m.ready.morale, { alpha: CAMP.rest.morale, bravo: CAMP.rest.morale, charlie: CAMP.rest.morale }, 'stores-shortage: supplied brigades lose nothing');
    // A large fictional army with no ammunition or rations left: the issue covers the first brigades; the rest are short.
    const n = Math.max(Math.floor(CAMP.issue.ammunition / CAMP.use.ammunition), Math.floor(CAMP.issue.rations / CAMP.use.rations)) + 2;
    const BIG = { version: 1, id: 'test-orders-big', title: 'Fictional large army', phases: [{ packId: 'pz', phaseId: 'z1' }],
      franchise: Array.from({ length: n }, (_, i) => ({ unitId: `b${i}`, label: `Fictional brigade ${i}`, kind: 'infantry', men: 1000, weapon: 'm1842', vet: 'green' })) };
    const big = api.newCampaign({ campaign: BIG, slot: 1, seed: 5 }), empty = save.validateSnapshot({ ...big, stores: { ...CAMP.start, ammunition: 0, rations: 0 } });
    const short = api.breakCamp(empty, { campaign: BIG }), p = api.campaignPhase(empty, BIG), last = `b${n - 1}`;
    const pen = Math.min(CAMP.shortCap, CAMP.shortMorale.ammunition + CAMP.shortMorale.rations);
    assert.deepEqual([short.ready.morale.b0, short.ready.morale[last]], [CAMP.rest.morale, CAMP.rest.morale - pen],
      `stores-shortage: the first brigade is supplied and the last, short of ammunition and rations, loses ${pen} morale (capped at ${CAMP.shortCap})`);
    assert.deepEqual([api.storesOf(short).ammunition, api.storesOf(short).rations], [0, 0], 'stores-shortage: the stores were not drawn down to nothing');
    assert.equal(moraleOf(api.applyCampaign({ units: [{ id: last, side: 'US', type: 'infantry', name: 'Fictional last', men: 1000 }] }, short, p), last),
      CAMP.defaultMorale + CAMP.rest.morale - pen, 'stores-shortage: the shortage did not reach the field definition\'s morale');
  }],
  ['upgrades', (api) => {
    refuses('upgrades', () => api.buyUpgrade(rich(api, { level: 1, rp: 50 }), { id: 'wagons' }), /^Economy: that upgrade opens at reputation level 2; the army is at level 1/);
    const s = rich(api, { level: 5, rp: 1000, past: true });
    const w = api.buyUpgrade(s, { id: 'wagons' });
    assert.deepEqual([w.rp, w.reputation, w.upgrades, api.depotCapacity(w) - api.depotCapacity(s)], [s.rp - CAMP.upgrades.wagons.price, s.reputation, ['wagons'], CAMP.upgrades.wagons.cards], 'upgrades: Wagons price, reputation kept, capacity');
    refuses('upgrades', () => api.buyUpgrade(w, { id: 'wagons' }), /^Economy: the army already has that upgrade/);
    const o = api.buyUpgrade(w, { id: 'ordnance' }), plain = api.breakCamp(w, { campaign: CAMPAIGN, fielded: ['alpha'] }), cheap = api.breakCamp(o, { campaign: CAMPAIGN, fielded: ['alpha'] });
    assert.equal(api.storesOf(cheap).ammunition - api.storesOf(plain).ammunition, CAMP.use.ammunition - Math.ceil(CAMP.use.ammunition * CAMP.upgrades.ordnance.factor), 'upgrades: the Ordnance train must make ammunition use cheaper');
    assert.deepEqual(o.upgrades, ['wagons', 'ordnance'], 'upgrades: catalogue order');
    const amb = api.buyUpgrade(s, { id: 'ambulances' }), lost = 400;
    const withA = play(api, amb, { lossUS: lost }), without = play(api, s, { lossUS: lost });
    assert.equal(withA.army[0].men - without.army[0].men, Math.floor(lost * CAMP.upgrades.ambulances.returned), 'upgrades: Ambulances must return a tenth of the losses');
    const full = save.validateSnapshot({ ...s, depot: Array.from({ length: api.depotCapacity(s) }, (_, i) => ({ uid: `test-orders.1.fill.${i}`, itemId: 'm1842', tier: 'common', conditionId: 'worn', from: 'Fictional' })) });
    const lot = api.shopStock(full, { date: '1862-04' })[0];
    refuses('upgrades', () => api.buyLot(full, { itemId: lot.itemId, date: '1862-04' }), /^Economy: the depot wagons are full \(\d+ of \d+ cards\)/);
    const more = api.buyStores(full, { store: 'wagons' });
    assert.ok(api.buyLot(more, { itemId: lot.itemId, date: '1862-04' }).depot.length === full.depot.length + 1, 'upgrades: bought wagons must make room in the depot');
  }],
  ['training-slot', (api) => {
    refuses('training-slot', () => api.buyTraining(rich(api, { level: 1, rp: 50 }), { brigadeId: 'alpha', bar: 'fire' }), /^Economy: training opens at reputation level 2/);
    let s = rich(api);
    const base = s.army[0].base.fire;
    for (let i = 0; i < 3; i++) s = api.buyTraining(s, { brigadeId: 'alpha', bar: 'fire' });
    assert.deepEqual([s.army[0].base.fire - base, s.army[0].bonus.fire, s.ledger.filter((r) => r.kind === 'training').length], [CAMP.barCap, CAMP.barCap, 3], 'training-slot: three trainings reach the camp cap');
    refuses('training-slot', () => api.buyTraining(s, { brigadeId: 'alpha', bar: 'fire' }), /fire bar has reached its camp limit/);
    const slot = api.buySlot(s, { brigadeId: 'alpha' });
    assert.deepEqual([api.slotsOf(slot.army[0]), slot.army[0].extraSlot, slot.rp], [badges.slotsFor('green') + 1, true, s.rp - CAMP.extraSlot.price], 'training-slot: one bought slot');
    refuses('training-slot', () => api.buySlot(slot, { brigadeId: 'alpha' }), /already has its extra badge slot/);
    const two = [{ id: 'sharpshooters', tier: 'bronze', awardId: 'test-orders.1.pa.a2.1', feat: 60 }, { id: 'rock', tier: 'bronze', awardId: 'test-orders.1.pa.a2.1', feat: 2 }];
    assert.equal(save.validateSnapshot({ ...slot, army: slot.army.map((b, i) => (i ? b : { ...b, badges: two })) }).army[0].badges.length, 2, 'training-slot: a green brigade with an extra slot must keep two badges');
    refuses('training-slot', () => save.validateSnapshot({ ...s, army: s.army.map((b, i) => (i ? b : { ...b, badges: two })) }), /keeps more badges than its slots/);
  }],
  ['reroll', (api) => {
    const s0 = rich(api), dep = { uid: 'test-orders.1.fixture.r', itemId: 'lorenz', tier: 'uncommon', conditionId: 'worn', source: 'capture', from: 'Fictional' };
    const s = save.validateSnapshot({ ...s0, depot: [dep] });
    const p1 = api.rerollPreview(s, { uid: dep.uid });
    assert.deepEqual(api.rerollPreview(s, { uid: dep.uid }), p1, 'reroll: the preview is not deterministic');
    assert.ok(p1.to !== 'worn' && p1.price === CAMP.reroll.uncommon && p1.n === 1, 'reroll: the re-roll must change the affix and cost by rarity');
    refuses('reroll', () => api.rerollAffix(s, { uid: dep.uid, to: CONDITIONS.find((c) => c.id !== p1.to && c.id !== 'worn').id }), /^Economy: the re-roll you confirmed is no longer the next one/);
    const t = api.rerollAffix(s, { uid: dep.uid, to: p1.to });
    assert.deepEqual([t.depot[0].conditionId, t.rp, t.ledger.at(-1)], [p1.to, s.rp - p1.price, { kind: 'reroll', uid: dep.uid, n: 1, from: 'worn', to: p1.to, price: p1.price }], 'reroll: the confirmed result');
    assert.equal(api.rerollPreview(t, { uid: dep.uid }).n, 2, 'reroll: the count does not advance');
    const other = save.validateSnapshot({ ...s, seed: 99 });
    const seeds = Array.from({ length: 12 }, (_, i) => api.rerollPreview(save.validateSnapshot({ ...s, seed: 100 + i }), { uid: dep.uid }).to);
    assert.ok(new Set(seeds).size > 1 && api.rerollPreview(other, { uid: dep.uid }).from === 'worn', 'reroll: the campaign seed does not change the result');
    const w = s.army[0].weapon, q = api.rerollPreview(s, { uid: w.uid }), e = api.rerollAffix(s, { uid: w.uid, to: q.to });
    assert.ok(e.army[0].weapon.conditionId === q.to && e.army[0].weapon.uid === w.uid, 'reroll: an issued weapon must re-roll in place');
    refuses('reroll', () => save.validateSnapshot({ ...t, rp: t.rp, ledger: t.ledger.map((r) => (r.kind === 'reroll' ? { ...r, n: 2 } : r)) }), /affix re-rolls are out of order/);
  }],
  ['old-saves', async (api) => {
    const v1 = save.completedSnapshot({ awardId: 'practice-v1', army: copy(SAMPLE_ARMY), depot: [], issued: [], seed: 7, grade: 'Victory' }), raw = JSON.stringify(v1);
    const mem = memory({ 'cw.progress': raw }), loaded = await api.createProgressStore(mem, { locks: mem.locks }).load();
    assert.ok(api.exportSnapshot(loaded) === raw && !save.CAMP_FIELDS.some((k) => has(loaded, k)), 'old-saves: a v1 save changed shape or gained camp fields');
    const older = play(api, fresh(api));
    const before = copy(older);
    for (const k of ['rp', 'reputation', 'level', 'shopSeen', 'ledger']) delete before[k];
    let old = null;
    try { old = api.parseSnapshot(JSON.stringify(before)); } catch (e) { assert.fail(`old-saves: a pre-economy, pre-camp v2 save did not load (${e.message})`); }
    assert.deepEqual([api.storesOf(old), api.upgradesOf(old), api.depotCapacity(old), CAMP_FIELDS_OF(old)], [{ ...CAMP.start }, [], CAMP.start.wagons * CAMP.cardsPerWagon, []],
      'old-saves: a pre-camp save must load with the starting stores and nothing else');
    const p = api.campaignPhase(old, CAMPAIGN), field = api.applyCampaign(SCENARIO, old, p);
    assert.ok(field.units.every((u) => u.morale === SCENARIO.units.find((x) => x.id === u.id).morale), 'old-saves: a phase launched without marching out of camp must not change any morale');
    const marched = api.breakCamp(old, { campaign: CAMPAIGN });
    assert.ok(api.parseSnapshot(api.exportSnapshot(marched)).ready.awardId === p.awardId, 'old-saves: an old save could not march out of camp');
  }],
  ['ledger-audit', (api) => {
    const s = api.buySlot(api.buyUpgrade(rich(api), { id: 'wagons' }), { brigadeId: 'alpha' });
    const d = api.chooseDecision(s, { campaign: CAMPAIGN, deck: deck(api), cardId: 'a1-card', optionId: 'safe' });
    const bad = [[{ ...s, upgrades: ['wagons', 'ambulances'] }, /army upgrades do not match the ledger/], [{ ...s, army: s.army.map((b, i) => (i === 1 ? { ...b, extraSlot: true } : b)) }, /extra badge slots do not match the ledger/],
      [{ ...d, ledger: d.ledger.filter((r) => r.kind !== 'decision'), rp: d.rp - 15, reputation: d.reputation - 15 }, /decision points do not match the ledger/],
      [{ ...s, ready: { awardId: 'test-orders.1.pa.a1.1', morale: { nobody: 4 } } }, /camp morale names a brigade that is not in the army/],
      [{ ...s, stores: { ...CAMP.start, ammunition: -1 } }, /invalid ammunition store/], [{ ...s, stores: { ammunition: 5 } }, /missing or unsupported fields/],
      [{ ...s, army: s.army.map((b, i) => (i ? b : { ...b, order: 'parade' })) }, /unknown camp order/],
      [{ ...s, rp: s.rp + 1 }, /do not match the ledger/], [{ ...d, decisions: [...d.decisions, d.decisions[0]] }, /chosen twice for one phase/]];
    for (const [v, pattern] of bad) refuses('ledger-audit', () => api.validateSnapshot(v), pattern);
  }],
  ['campaign-unchanged', (api) => {
    // Without a march out of camp or a decision, applyCampaign adds no morale on the shipped ladder's phases.
    const s = api.newCampaign({ campaign: LADDER, slot: 1, seed: 1862 });
    for (const entry of LADDER.phases.slice(0, 1)) {
      const p = api.campaignPhase(s, LADDER), scenario = PACKS[entry.packId].phases.find((x) => x.id === entry.phaseId).scenario;
      const out = api.applyCampaign(scenario, s, p);
      assert.ok([...out.units, ...(out.reinforcements || [])].every((u) => !has(u, 'morale')), 'campaign-unchanged: a phase launched without camp changed a formation\'s morale');
    }
    const fourth = { ...api.campaignPhase(s, LADDER), packId: 'shiloh', phaseId: 'buell-attacks', loan: false, awardId: 'west.1.shiloh.buell-attacks.1' };
    const out = api.applyCampaign(PACKS.shiloh.phases.find((x) => x.id === 'buell-attacks').scenario, s, fourth);
    assert.ok([...out.units, ...(out.reinforcements || [])].every((u) => !has(u, 'morale')), 'campaign-unchanged: a franchise phase without camp changed morale');
  }],
  ['equipment-source', (api) => {
    const s = rich(api), bought = { uid: 'test-orders.1.shop.0.lorenz', itemId: 'lorenz', tier: 'uncommon', conditionId: 'serviceable', source: 'requisition', from: 'Requisitioned for 60 points' };
    const issued = save.exchangeDepot(save.validateSnapshot({ ...s, depot: [bought] }), { brigadeId: 'alpha', itemUid: bought.uid });
    const field = api.applyCampaign(SCENARIO, issued, api.campaignPhase(play(api, issued), CAMPAIGN));
    const def = field.units.find((u) => u.id === 'alpha');
    let profile = null;
    try { profile = equipmentProfile(def.equipment, 'infantry'); } catch (e) { assert.fail(`equipment-source: a requisitioned weapon cannot take the field (${e.message})`); }
    assert.ok(profile.item.uid === bought.uid && !has(def.equipment, 'source'), 'equipment-source: the fielded item identity');
  }],
];
const CAMP_FIELDS_OF = (s) => save.CAMP_FIELDS.filter((k) => has(s, k));

const MUTANTS = {
  'deck-valid': { validateDeck: (j) => Object.freeze(j) },
  // Re-choosing overwrites the recorded option instead of showing it.
  'decision-once': { chooseDecision: (s, c) => {
    const v = save.validateSnapshot(s), p = campaign.campaignPhase(v, c.campaign, { replay: c.replay === true });
    if (!decisions.recorded(v, p, c.cardId)) return decisions.chooseDecision(v, c);
    return save.validateSnapshot({ ...v, decisions: v.decisions.map((r) => (r.cardId === c.cardId && r.awardId === p.awardId ? { ...r, optionId: c.optionId } : r)) });
  } },
  'decision-replay': { chooseDecision: (s, c) => { const out = decisions.chooseDecision(s, c); return save.validateSnapshot({ ...out, decisions: out.decisions.map((r) => ({ ...r, replay: false })) }); } },
  'decision-effects': { applyCampaign: (sc, s, p) => { const v = { ...save.validateSnapshot(s) }; delete v.decisions; return campaign.applyCampaign(sc, v, p); } },
  'orders-once': { breakCamp: (s, o) => { const v = { ...save.validateSnapshot(s) }; delete v.ready; return orders.breakCamp(v, o); } },
  'stores-shortage': { breakCamp: (s, o) => orders.breakCamp(save.validateSnapshot({ ...save.validateSnapshot(s), stores: Object.fromEntries(CAMP.stores.map((k) => [k, 100000])) }), o) },
  'upgrades': { buyUpgrade: (s, c) => { try { return economy.buyUpgrade(s, c); } catch (e) { if (/opens at reputation level/.test(e.message)) return save.validateSnapshot(s); throw e; } } },
  'training-slot': { buySlot: (s, c) => { try { return economy.buySlot(s, c); } catch (e) { if (/already has its extra badge slot/.test(e.message)) return save.validateSnapshot(s); throw e; } } },
  'reroll': { rerollAffix: (s, c) => economy.rerollAffix(s, { ...c, to: economy.rerollPreview(s, c).to }) },
  'old-saves': { parseSnapshot: (t) => { const v = JSON.parse(t); if (v.version === 2 && !has(v, 'stores')) throw new Error('Progress: missing or unsupported fields.'); return save.validateSnapshot(v); } },
  'ledger-audit': { validateSnapshot: (v) => v },
  'campaign-unchanged': { applyCampaign: (sc, s, p) => { const out = campaign.applyCampaign(sc, s, p); return { ...out, units: out.units.map((u) => (u.side === 'US' ? { ...u, morale: CAMP.defaultMorale + CAMP.rest.morale } : u)) }; } },
  'equipment-source': { applyCampaign: (sc, s, p) => {
    const v = save.validateSnapshot(s), out = campaign.applyCampaign(sc, v, p), arms = new Map(v.army.map((b) => [b.unitId, b.weapon]));
    return { ...out, units: out.units.map((u) => (arms.has(u.id) && u.equipment ? { ...u, equipment: { ...arms.get(u.id) } } : u)) };
  } },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function ordersUnit(api = API) {
  for (const [name, check] of ORDERS_CHECKS) await runCheck(name, check, api);
  return ORDERS_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of ORDERS_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = ORDERS_CHECKS.length;
  if (failed) { console.log(`ORDERS FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`ORDERS OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of ORDERS_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`ORDERS CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`ORDERS CONTROLS OK (${caught}/${n})`);
  }
}

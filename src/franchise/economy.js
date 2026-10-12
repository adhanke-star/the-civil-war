// src/franchise/economy.js: requisition points, reputation and the camp shop (DESIGN §3 Shop, Reward tiers, Earning,
// Depot, Staging: "shop selling arms only"). Pure logic over v2 campaign saves; no DOM, no storage. Every amount is a
// GAME RULE from src/franchise/tuning.js; only the arms' first-issue months (src/reward/data.js ARM_DATES) are history.
//
//   phasePoints({ grade, held, lossesUS, lossesCS, loan }) -> { lines: [{ id, label, points }], score }
//   awardPhase(save, { awardId, grade, held, lossesUS, lossesCS, loan }) -> save with the phase's points paid once
//   phaseSummary(before, after) -> the after-action's points breakdown and any level reached (null if nothing was paid)
//   levelFor(reputation) / nextLevelAt(level) / shopTierFor(level) / levelCard({ seed, campaignId, slot, level })
//   shopStock(save, { date }) -> this phase's offers [{ uid, itemId, tier, conditionId, price, sold }]
//   buyLot(save, { itemId, date }) / turnInCard(save, { itemUid }) / markShopSeen(save) -> the next validated save
//   levelUps(before, after) -> { from, to, cards } for any level reached between two saves (null when none)
//
// Rules (game rules, labelled as such in the UI):
// - A phase pays by grade (Decisive 60 / Victory 40 / Draw 20 / Defeat 10), +15 if the player held the objective at the
//   end, +10 if player losses were at most half the enemy's; a loan phase pays half (rounded down). A replay pays only
//   the improvement on the best score already paid for that phase, so replaying cannot farm points. An award is paid
//   once: re-recording it changes nothing.
// - Turning in a depot card pays by rarity. Reputation is every point earned (phases and turn-ins); spending never
//   lowers it. Each level reached deals one reward card (its rarity rises with the level) into the depot and opens
//   the shop's next rarity.
// - The shop stocks up to six distinct catalogue arms per ladder position: a deterministic order from the campaign seed
//   and position, filtered to rarities the reputation has opened and to arms in service by the next phase's month.
//   Captured-only arms are never stocked. Condition is rolled like loot; price is by rarity. Purchases go to the depot,
//   whose limits (2,000 cards, 1 MB save) still apply.
import { ECONOMY } from './tuning.js';
import { validateSnapshot } from './save.js';
import { ARMS, TIER_BY_ID, itemDef } from '../reward/data.js';
import { makeRng, rollCondition } from '../reward/model.js';

export { ECONOMY };
export const RULES_NOTE = 'Requisition points, reputation, reward cards and prices are game rules, not history.';
const fail = (message) => { throw new Error(`Economy: ${message}`); };
const DEPOT_LIMIT = 2000;
const rank = (tier) => TIER_BY_ID[tier].rank;

/** The reputation level (1-10) a cumulative total reaches. */
export function levelFor(reputation) {
  let level = 1;
  ECONOMY.levels.forEach((at, i) => { if (reputation >= at) level = i + 1; });
  return level;
}
/** Reputation needed for the level after `level`, or null at the top. */
export const nextLevelAt = (level) => (level < ECONOMY.levels.length ? ECONOMY.levels[level] : null);
/** The highest rarity the shop stocks at a level. */
export const shopTierFor = (level) => ECONOMY.shopTier[Math.max(1, Math.min(ECONOMY.shopTier.length - 1, level))];

/** One phase's points, line by line. */
export function phasePoints({ grade, held = false, lossesUS = 0, lossesCS = 0, loan = false }) {
  if (!Object.prototype.hasOwnProperty.call(ECONOMY.phasePoints, grade)) fail('unknown grade.');
  const lines = [{ id: 'grade', label: `Grade: ${grade}`, points: ECONOMY.phasePoints[grade] }];
  if (held === true) lines.push({ id: 'held', label: 'Held the objective at the end', points: ECONOMY.heldBonus });
  if (lossesUS <= lossesCS * ECONOMY.lowLossRatio) lines.push({ id: 'lowLoss', label: 'Losses at most half the enemy\'s', points: ECONOMY.lowLossBonus });
  const sum = lines.reduce((n, l) => n + l.points, 0);
  if (loan === true) lines.push({ id: 'loan', label: 'Army on loan: half', points: Math.floor(sum * ECONOMY.loanFactor) - sum });
  return { lines, score: lines.reduce((n, l) => n + l.points, 0) };
}

function campaignSave(save) {
  const s = validateSnapshot(save);
  if (s.version !== 2) fail('requisition is for campaign saves.');
  return s;
}

/** The reward card for reaching `level`: deterministic from the campaign seed and level; never a captured-only arm. */
export function levelCard({ seed, campaignId, slot, level }) {
  const tier = ECONOMY.levelCardTier[level];
  if (!tier) fail('this level deals no reward card.');
  const rng = makeRng(`${seed}:level:${level}`);
  const pool = ARMS.filter((a) => a.tier === tier && a.capturedOnly !== true);
  if (!pool.length) fail(`no ${tier} arm can be dealt.`);
  const def = rng.pick(pool);
  return { uid: `${campaignId}.${slot}.level.${level}`, itemId: def.id, tier: def.tier, conditionId: rollCondition(rng),
    source: 'reward', from: `Reputation level ${level} reward card` };
}

/** Add earned points (reputation and spendable) and deal a card for every level reached. Not validated. */
function earn(s, points) {
  const reputation = s.reputation + points, level = Math.max(s.level, levelFor(reputation));
  const depot = [...s.depot], ledger = [...s.ledger];
  for (let l = s.level + 1; l <= level; l++) {
    const card = levelCard({ seed: s.seed, campaignId: s.campaign.id, slot: s.slot, level: l });
    if (depot.length >= DEPOT_LIMIT) fail('the depot wagons are full; turn in or issue a card before the reward card can be dealt.');
    depot.push(card);
    ledger.push({ kind: 'level', level: l, uid: card.uid });
  }
  return { ...s, rp: s.rp + points, reputation, level, depot, ledger };
}

/**
 * Pay one recorded phase (the save's last history row must be `awardId`). Idempotent per award; a replay pays only
 * the improvement on the best score already paid for the same pack phase.
 */
export function awardPhase(save, { awardId, grade, held = false, lossesUS = 0, lossesCS = 0, loan = false }) {
  const s = campaignSave(save);
  if (s.ledger.some((r) => r.kind === 'phase' && r.awardId === awardId)) return s;
  const row = s.campaign.history.find((r) => r.awardId === awardId);
  if (!row) fail('points need a recorded phase.');
  const { score } = phasePoints({ grade, held, lossesUS, lossesCS, loan });
  const same = new Set(s.campaign.history.filter((r) => r.packId === row.packId && r.phaseId === row.phaseId).map((r) => r.awardId));
  const best = s.ledger.filter((r) => r.kind === 'phase' && same.has(r.awardId)).reduce((n, r) => Math.max(n, r.score), 0);
  const points = Math.max(0, score - best);
  const paid = { ...s, ledger: [...s.ledger, { kind: 'phase', awardId, score, points, held: held === true, loan: loan === true }] };
  return validateSnapshot(earn(paid, points));
}

/** Levels reached between two saves of one campaign, with the reward cards dealt (null when none). */
export function levelUps(before, after) {
  const a = campaignSave(after), from = before && before.version === 2 ? validateSnapshot(before).level : 1;
  if (a.level <= from) return null;
  const uids = a.ledger.filter((r) => r.kind === 'level' && r.level > from).map((r) => r.uid);
  const owned = new Map([...a.depot, ...a.army.map((b) => b.weapon)].map((it) => [it.uid, it]));
  return { from, to: a.level, shopTier: shopTierFor(a.level), opened: shopTierFor(a.level) !== shopTierFor(from),
    cards: uids.map((uid) => owned.get(uid)).filter(Boolean) };
}

/** The after-action breakdown of the phase `after` recorded (null when no points were recorded for it). */
export function phaseSummary(before, after) {
  const a = campaignSave(after), rec = a.ledger.find((r) => r.kind === 'phase' && r.awardId === a.awardId);
  const b = before && before.version === 2 ? validateSnapshot(before) : null;
  if (!rec || (b && b.ledger.some((r) => r.kind === 'phase' && r.awardId === rec.awardId))) return null;
  const row = a.campaign.history.find((r) => r.awardId === rec.awardId);
  const { lines } = phasePoints({ grade: row.grade, held: rec.held, lossesUS: row.lossesUS, lossesCS: row.lossesCS, loan: rec.loan });
  if (rec.points < rec.score) lines.push({ id: 'replay', label: 'Replay: only the improvement on this phase\'s best is paid', points: rec.points - rec.score });
  return { lines, points: rec.points, score: rec.score, replay: row.replay, rp: a.rp,
    reputation: { from: b ? b.reputation : 0, to: a.reputation }, level: a.level, levelAt: ECONOMY.levels[a.level - 1], nextAt: nextLevelAt(a.level),
    levelUp: levelUps(b, a), note: RULES_NOTE };
}

const month = (date) => {
  if (typeof date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(date)) fail('the shop needs the next phase\'s date.');
  return date.slice(0, 7);
};

/** This ladder position's offers: up to six distinct arms the reputation has opened and in service by `date`. */
export function shopStock(save, { date } = {}) {
  const s = campaignSave(save), by = month(date), top = rank(shopTierFor(s.level)), at = s.campaign.index;
  const rng = makeRng(`${s.seed}:shop:${at}`), order = ARMS.filter((a) => a.capturedOnly !== true);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const sold = new Set(s.ledger.filter((r) => r.kind === 'buy').map((r) => r.uid));
  return order.filter((a) => rank(a.tier) <= top && typeof a.from === 'string' && a.from <= by).slice(0, ECONOMY.shopSize).map((a) => {
    const uid = `${s.campaign.id}.${s.slot}.shop.${at}.${a.id}`;
    return { uid, itemId: a.id, tier: a.tier, conditionId: rollCondition(makeRng(`${s.seed}:shop:${at}:${a.id}`)), price: ECONOMY.price[a.tier], sold: sold.has(uid) };
  });
}

/** Buy one lot of this position's stock into the depot. */
export function buyLot(save, { itemId, date } = {}) {
  const s = campaignSave(save), lot = shopStock(s, { date }).find((o) => o.itemId === itemId);
  if (!lot) fail('that lot is not in stock.');
  if (lot.sold) fail('that lot has already been bought.');
  if (s.rp < lot.price) fail(`it costs ${lot.price} requisition points and you have ${s.rp}.`);
  if (s.depot.length >= DEPOT_LIMIT) fail('the depot wagons are full; turn in or issue a card first.');
  const card = { uid: lot.uid, itemId: lot.itemId, tier: lot.tier, conditionId: lot.conditionId, source: 'requisition',
    from: `Requisitioned for ${lot.price} points` };
  return validateSnapshot({ ...s, rp: s.rp - lot.price, depot: [...s.depot, card],
    ledger: [...s.ledger, { kind: 'buy', uid: lot.uid, itemId: lot.itemId, tier: lot.tier, price: lot.price, phase: s.campaign.index }] });
}

/** Turn one depot card in for points by rarity. Equipped arms cannot be turned in. */
export function turnInCard(save, { itemUid } = {}) {
  const s = campaignSave(save), card = s.depot.find((it) => it.uid === itemUid);
  if (!card) fail('that card is no longer in the depot.');
  const points = ECONOMY.turnIn[card.tier];
  const out = { ...s, depot: s.depot.filter((it) => it.uid !== itemUid),
    ledger: [...s.ledger, { kind: 'turnIn', item: card, points, at: s.issued.length }] };
  return validateSnapshot(earn(out, points));
}

/** The player has opened the shop at this level (clears the "new" marker). */
export function markShopSeen(save) {
  const s = campaignSave(save);
  return s.shopSeen === s.level ? s : validateSnapshot({ ...s, shopSeen: s.level });
}

/** Points a depot card turns in for, and a lot's price (UI wording). */
export const turnInPoints = (item) => ECONOMY.turnIn[item.tier ?? itemDef(item.itemId).tier];

// One progress-store seam. Stores a completed reward (v1) or a campaign position between phases (v2),
// never a live battle. Three slots: slot 1 keeps the original key, so existing saves become slot 1.
import { ARMS, PRACTICE_ARMS, UNIQUES, VETERANCY, GRADES, CONDITIONS, itemDef } from '../reward/data.js';
import { ratings, canCarry, equip } from '../reward/model.js';
import { BADGE_BY_ID, TIERS, slotsFor, BARS } from './badges.js';
import { CAMP, DIFFICULTY } from './tuning.js';
import { reconcileLevelRewards } from './level-rewards.js';

export const SAVE_KEY = 'cw.progress';
export const PROGRESS_DB = 'cw.progress';
export const PROGRESS_OBJECT_STORE = 'progress';
export const MAX_SAVE_BYTES = 1024 * 1024;
export const SAVE_SLOTS = Object.freeze([1, 2, 3]);
/** Storage key of a slot: slot 1 is the original `cw.progress`; slots 2 and 3 are `cw.progress.N`. */
export function slotKey(slot) {
  if (!SAVE_SLOTS.includes(slot)) bad('unknown save slot.');
  return slot === 1 ? SAVE_KEY : `${SAVE_KEY}.${slot}`;
}
const CAMPAIGN_LIMITS = Object.freeze({ phases: 500, carry: 2000 });
const winners = new Set(['US', 'CS', null]);
const knownGear = new Set([...ARMS, ...PRACTICE_ARMS, ...UNIQUES].map((x) => x.id));
const vets = new Set(VETERANCY.map((x) => x.id));
const conditions = new Set(CONDITIONS.map((x) => x.id));
const bad = (message) => { throw new Error(`Progress: ${message}`); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function shape(o, required, optional = []) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) bad('expected a complete object.');
  if (required.some((k) => !has(o, k)) || Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))) {
    bad('missing or unsupported fields.');
  }
}
function word(v, label, max = 160) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) bad(`invalid ${label}.`);
  return v;
}
function id(v, label) {
  word(v, label, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v)) bad(`invalid ${label}.`);
  return v;
}
function number(v, label, lo, hi) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) bad(`invalid ${label}.`);
  return v;
}
function list(v, label, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max) bad(`incomplete or oversized ${label}.`);
  return v;
}
function item(v) {
  shape(v, ['uid', 'itemId', 'tier', 'conditionId', 'from'], ['source', 'depot']);
  const uid = id(v.uid, 'item identity');
  if (!knownGear.has(v.itemId)) bad('unknown gear.');
  if (v.tier !== itemDef(v.itemId).tier || !conditions.has(v.conditionId)) bad('unknown rarity or condition.');
  const out = { uid, itemId: v.itemId, tier: v.tier, conditionId: v.conditionId, from: word(v.from, 'item origin') };
  if (has(v, 'source')) {
    if (!['issue', 'capture', 'reward', 'requisition'].includes(v.source)) bad('invalid item source.');
    out.source = v.source;
  }
  if (has(v, 'depot')) {
    if (v.depot !== true) bad('invalid depot flag.');
    out.depot = true;
  }
  return out;
}

/** The v2 campaign position: next ladder index, append-only history and per-unit carried strength. */
function campaignRecord(c) {
  shape(c, ['id', 'index', 'status', 'history', 'carry']);
  const cid = id(c.id, 'campaign identity');
  const index = number(c.index, 'campaign position', 0, CAMPAIGN_LIMITS.phases);
  if (!['in-progress', 'complete'].includes(c.status)) bad('unknown campaign status.');
  const awards = new Set();
  const history = list(c.history, 'campaign history', 0, CAMPAIGN_LIMITS.phases * 4).map((r) => {
    shape(r, ['packId', 'phaseId', 'awardId', 'winner', 'grade', 'lossesUS', 'lossesCS', 'replay']);
    const row = { packId: id(r.packId, 'pack identity'), phaseId: id(r.phaseId, 'phase identity'), awardId: id(r.awardId, 'phase award identity') };
    if (awards.has(row.awardId)) bad('duplicate phase award identity.');
    awards.add(row.awardId);
    if (!winners.has(r.winner) || !GRADES.includes(r.grade) || typeof r.replay !== 'boolean') bad('invalid campaign history row.');
    return { ...row, winner: r.winner, grade: r.grade, lossesUS: number(r.lossesUS, 'losses', 0, 10000000),
      lossesCS: number(r.lossesCS, 'losses', 0, 10000000), replay: r.replay };
  });
  // Every first play advances the ladder by one; replays never do.
  if (history.filter((r) => !r.replay).length !== index) bad('campaign position does not match its history.');
  if (!c.carry || typeof c.carry !== 'object' || Array.isArray(c.carry) || ![Object.prototype, null].includes(Object.getPrototypeOf(c.carry))) bad('invalid carried strengths.');
  const keys = Object.keys(c.carry);
  if (keys.length > CAMPAIGN_LIMITS.carry) bad('incomplete or oversized carried strengths.');
  const carry = {};
  for (const key of keys.sort()) {
    const e = c.carry[key];
    shape(e, ['men'], ['guns']);
    carry[id(key, 'carried unit identity')] = { men: number(e.men, 'carried men', 0, 100000), ...(has(e, 'guns') ? { guns: number(e.guns, 'carried guns', 0, 200) } : {}) };
  }
  return { id: cid, index, status: c.status, history, carry };
}

/**
 * The v2 requisition economy (src/franchise/economy.js writes it): rp (spendable requisition points), reputation
 * (cumulative points earned, never reduced by spending), level (1-10), shopSeen (the highest level whose shop the player
 * has opened) and an append-only ledger. A save written before the economy has none of these fields and loads as
 * 0/0/1/1/[]; partial fields are refused. The sums are checked here; the tunable amounts are not (tuning may change).
 *   { kind: 'phase', awardId, score, points, held, loan }  points paid for one recorded phase (once per award)
 *   { kind: 'level', level, uid }                          the reward card dealt on reaching a level (2-10, once each)
 *   { kind: 'turnIn', item, points, at }                   a depot card exchanged for points after `at` issue records
 *   { kind: 'buy', uid, itemId, tier, price, phase }       one shop lot bought at ladder position `phase`
 * Camp (P5c; src/franchise/economy.js and decisions.js):
 *   { kind: 'decision', awardId, cardId, points }          a decision card's requisition points (signed; once per card and phase attempt)
 *   { kind: 'upgrade', id, price }                         one army upgrade (once each; matches the save's `upgrades`)
 *   { kind: 'store', store, qty, price }                   one lot of stores bought
 *   { kind: 'training', brigadeId, bar, points, price }    bought training for one brigade's card bar
 *   { kind: 'slot', brigadeId, price }                     one extra badge slot (once per brigade; matches its `extraSlot`)
 *   { kind: 'reroll', uid, n, from, to, price }            the n-th affix re-roll of one item (from one condition to another)
 */
export const ECONOMY_FIELDS = Object.freeze(['rp', 'reputation', 'level', 'shopSeen', 'ledger']);
export const ECONOMY_LIMITS = Object.freeze({ ledger: 5000, points: 100000, levels: 10 });
function economyRecord(v, campaign, issuedCount) {
  const present = ECONOMY_FIELDS.filter((k) => has(v, k));
  if (!present.length) return { rp: 0, reputation: 0, level: 1, shopSeen: 1, ledger: [], decided: new Map(), upgrades: new Set(), slotted: new Set(), rerolls: new Map() };
  if (present.length !== ECONOMY_FIELDS.length) bad('missing or unsupported fields.');
  const awards = new Set(campaign.history.map((r) => r.awardId)), paid = new Set(), levels = new Set(), bought = new Set(), returned = new Set();
  const decided = new Map(), upgrades = new Set(), slotted = new Set(), rerolls = new Map();
  let earned = 0, spent = 0, lastAt = 0;
  const ledger = list(v.ledger, 'requisition ledger', 0, ECONOMY_LIMITS.ledger).map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) bad('invalid requisition ledger entry.');
    if (r.kind === 'phase') {
      shape(r, ['kind', 'awardId', 'score', 'points', 'held', 'loan']);
      if (!awards.has(r.awardId) || paid.has(r.awardId)) bad('requisition points must belong to one recorded phase.');
      paid.add(r.awardId);
      if (typeof r.held !== 'boolean' || typeof r.loan !== 'boolean') bad('invalid requisition ledger entry.');
      const out = { kind: 'phase', awardId: r.awardId, score: number(r.score, 'phase score', 0, ECONOMY_LIMITS.points),
        points: number(r.points, 'phase points', 0, ECONOMY_LIMITS.points), held: r.held, loan: r.loan };
      earned += out.points;
      return out;
    }
    if (r.kind === 'level') {
      shape(r, ['kind', 'level', 'uid']);
      const level = number(r.level, 'reputation level', 2, ECONOMY_LIMITS.levels);
      if (levels.has(level)) bad('a reputation level was rewarded twice.');
      levels.add(level);
      return { kind: 'level', level, uid: id(r.uid, 'reward card identity') };
    }
    if (r.kind === 'turnIn') {
      shape(r, ['kind', 'item', 'points', 'at']);
      const it = item(r.item);
      if (returned.has(it.uid)) bad('a card was turned in twice.');
      returned.add(it.uid);
      const at = number(r.at, 'turn-in position', 0, issuedCount);
      if (at < lastAt) bad('turn-ins are out of order.');
      lastAt = at;
      const out = { kind: 'turnIn', item: it, points: number(r.points, 'turn-in points', 0, ECONOMY_LIMITS.points), at };
      earned += out.points;
      return out;
    }
    // Camp purchases and decision points (src/franchise/economy.js, decisions.js; P5c). Spending never lowers reputation.
    if (r.kind === 'decision') {
      shape(r, ['kind', 'awardId', 'cardId', 'points']);
      const key = `${id(r.awardId, 'decision phase identity')}|${id(r.cardId, 'decision card identity')}`;
      if (decided.has(key)) bad('a decision paid twice.');
      decided.set(key, r);
      const points = number(r.points, 'decision points', -ECONOMY_LIMITS.points, ECONOMY_LIMITS.points);
      if (points === 0) bad('invalid requisition ledger entry.');
      if (points > 0) earned += points; else spent -= points;
      return { kind: 'decision', awardId: r.awardId, cardId: r.cardId, points };
    }
    if (r.kind === 'upgrade') {
      shape(r, ['kind', 'id', 'price']);
      if (!has(CAMP.upgrades, r.id) || upgrades.has(r.id)) bad('an army upgrade is unknown or was bought twice.');
      upgrades.add(r.id);
      const out = { kind: 'upgrade', id: r.id, price: number(r.price, 'price', 0, ECONOMY_LIMITS.points) };
      spent += out.price;
      return out;
    }
    if (r.kind === 'store') {
      shape(r, ['kind', 'store', 'qty', 'price']);
      if (!CAMP.stores.includes(r.store)) bad('unknown store.');
      const out = { kind: 'store', store: r.store, qty: number(r.qty, 'store quantity', 1, CAMP_LIMITS.store), price: number(r.price, 'price', 0, ECONOMY_LIMITS.points) };
      spent += out.price;
      return out;
    }
    if (r.kind === 'training') {
      shape(r, ['kind', 'brigadeId', 'bar', 'points', 'price']);
      if (!BARS.includes(r.bar)) bad('unknown training bar.');
      const out = { kind: 'training', brigadeId: id(r.brigadeId, 'brigade identity'), bar: r.bar, points: number(r.points, 'training points', 1, CAMP_LIMITS.bonus),
        price: number(r.price, 'price', 0, ECONOMY_LIMITS.points) };
      spent += out.price;
      return out;
    }
    if (r.kind === 'slot') {
      shape(r, ['kind', 'brigadeId', 'price']);
      const brigadeId = id(r.brigadeId, 'brigade identity');
      if (slotted.has(brigadeId)) bad('a brigade bought two extra badge slots.');
      slotted.add(brigadeId);
      const out = { kind: 'slot', brigadeId, price: number(r.price, 'price', 0, ECONOMY_LIMITS.points) };
      spent += out.price;
      return out;
    }
    if (r.kind === 'reroll') {
      shape(r, ['kind', 'uid', 'n', 'from', 'to', 'price']);
      const uid = id(r.uid, 'item identity'), n = number(r.n, 're-roll count', 1, ECONOMY_LIMITS.ledger);
      if (n !== (rerolls.get(uid) || 0) + 1) bad('affix re-rolls are out of order.');
      rerolls.set(uid, n);
      if (!conditions.has(r.from) || !conditions.has(r.to) || r.from === r.to) bad('invalid affix re-roll.');
      const out = { kind: 'reroll', uid, n, from: r.from, to: r.to, price: number(r.price, 'price', 0, ECONOMY_LIMITS.points) };
      spent += out.price;
      return out;
    }
    if (r.kind === 'buy') {
      shape(r, ['kind', 'uid', 'itemId', 'tier', 'price', 'phase']);
      const uid = id(r.uid, 'requisition identity');
      if (bought.has(uid)) bad('a shop lot was bought twice.');
      bought.add(uid);
      if (!knownGear.has(r.itemId) || r.tier !== itemDef(r.itemId).tier) bad('unknown requisitioned gear.');
      const out = { kind: 'buy', uid, itemId: r.itemId, tier: r.tier, price: number(r.price, 'price', 0, ECONOMY_LIMITS.points),
        phase: number(r.phase, 'shop position', 0, CAMPAIGN_LIMITS.phases) };
      spent += out.price;
      return out;
    }
    bad('invalid requisition ledger entry.');
  });
  const reputation = number(v.reputation, 'reputation', 0, 10000000), rp = number(v.rp, 'requisition points', 0, 10000000);
  if (reputation !== earned || rp !== earned - spent) bad('requisition points do not match the ledger.');
  const level = number(v.level, 'reputation level', 1, ECONOMY_LIMITS.levels);
  if (levels.size !== level - 1 || [...levels].some((n) => n > level)) bad('reputation level does not match its reward cards.');
  return { rp, reputation, level, shopSeen: number(v.shopSeen, 'shop level seen', 1, level), ledger, decided, upgrades, slotted, rerolls };
}

/**
 * v2 badges (src/franchise/badges.js writes them). A franchise brigade may carry `badges` (kept, at most its slots by
 * veterancy), `offer` (earned while the slots were full, waiting for the player's choice in camp) and `xfactor` (the id of
 * its first Gold, always kept). The campaign may carry `enemy`: { [CS formation id]: { badges, xfactor? } }. Every entry
 * is { id, tier, awardId, feat }: the badge, its tier, the recorded phase award that earned it and the feat amount. A
 * badge id appears once per brigade (kept or offered). Saves written before badges have none of these fields.
 */
export const BADGE_LIMITS = Object.freeze({ list: 20, enemy: 2000, feat: 10000000 });
function badgeList(v, label, max, seen) {
  const rows = list(v, label, 1, max);
  return rows.map((r) => {
    shape(r, ['id', 'tier', 'awardId', 'feat']);
    if (!has(BADGE_BY_ID, r.id) || !TIERS.includes(r.tier)) bad(`unknown badge or tier in ${label}.`);
    if (seen.has(r.id)) bad('a badge appears twice on one formation.');
    seen.add(r.id);
    return { id: r.id, tier: r.tier, awardId: id(r.awardId, 'badge award identity'), feat: number(r.feat, 'badge feat', 0, BADGE_LIMITS.feat) };
  });
}
function xfactorOf(v, kept, label) {
  if (typeof v !== 'string' || !kept.some((b) => b.id === v && b.tier === 'gold')) bad(`${label} X-Factor must be a kept Gold badge.`);
  return v;
}
/** A brigade's badge fields (v2), in canonical order; {} when it has none. */
function brigadeBadges(b, vet, extra = false) {
  const seen = new Set(), out = {};
  if (has(b, 'badges')) {
    out.badges = badgeList(b.badges, 'brigade badges', BADGE_LIMITS.list, seen);
    if (out.badges.length > slotsFor(vet) + (extra ? 1 : 0)) bad('a brigade keeps more badges than its slots.');
  }
  if (has(b, 'offer')) out.offer = badgeList(b.offer, 'badges on offer', BADGE_LIMITS.list, seen);
  if (has(b, 'xfactor')) out.xfactor = xfactorOf(b.xfactor, out.badges || [], 'the brigade\'s');
  return out;
}
function enemyRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) bad('invalid enemy badges.');
  const keys = Object.keys(v);
  if (!keys.length || keys.length > BADGE_LIMITS.enemy) bad('incomplete or oversized enemy badges.');
  const out = {};
  for (const key of keys.sort()) {
    const e = v[key];
    shape(e, ['badges'], ['xfactor']);
    const badges = badgeList(e.badges, 'enemy badges', 4, new Set());
    out[id(key, 'enemy formation identity')] = { badges, ...(has(e, 'xfactor') ? { xfactor: xfactorOf(e.xfactor, badges, 'an enemy formation\'s') } : {}) };
  }
  return out;
}

/**
 * v2 camp fields (P5c; src/franchise/camp-orders.js, economy.js and decisions.js write them). Each is optional, so saves
 * written before the camp load with their defaults (start stores, no upgrades, no decisions, nothing ready):
 *   stores     { ammunition, rations, shoes, blankets, tents, horses, wagons }   whole units (CAMP.stores, all present)
 *   upgrades   [id]                     army upgrades owned, in catalogue order (the ledger's upgrade entries, exactly)
 *   decisions  [{ awardId, packId, phaseId, cardId, optionId, replay, effects }]  decision cards chosen, once per card and
 *              phase attempt (awardId is the attempt's award identity); effects copy the chosen option's game rules:
 *              { kind: 'rp', amount } | { kind: 'morale', amount } | { kind: 'store', store, amount }
 *   ready      { awardId, morale: { [brigadeId]: delta }, short?: { [brigadeId]: [store] } }   the camp the army marched out
 *              of for that phase attempt; `short` (P5d) lists the stores each brigade lacked (they follow it into battle)
 * Brigades may carry `order` ('rest' | 'drill' | 'target'), `drilled` (drills carried out), `bonus` ({ fire, melee, morale,
 * drill }: card-bar points gained in camp, already added to `base`) and `extraSlot` (true: one bought badge slot).
 */
export const CAMP_FIELDS = Object.freeze(['stores', 'upgrades', 'decisions', 'ready']);
export const CAMP_LIMITS = Object.freeze({ store: 1000000, bonus: 50, drilled: 1000, decisions: 2000, effects: 6, amount: 100000, morale: 100 });
function plain(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) bad(`invalid ${label}.`);
  return v;
}
function storesRecord(v) {
  shape(plain(v, 'stores'), [...CAMP.stores]);
  return Object.fromEntries(CAMP.stores.map((k) => [k, number(v[k], `${k} store`, 0, CAMP_LIMITS.store)]));
}
const signed = (v, label) => {
  const n = number(v, label, -CAMP_LIMITS.amount, CAMP_LIMITS.amount);
  if (n === 0) bad(`invalid ${label}.`);
  return n;
};
export function effectRecord(e) {
  plain(e, 'decision effect');
  if (e.kind === 'rp' || e.kind === 'morale') { shape(e, ['kind', 'amount']); return { kind: e.kind, amount: signed(e.amount, 'decision effect amount') }; }
  if (e.kind === 'store') {
    shape(e, ['kind', 'store', 'amount']);
    if (!CAMP.stores.includes(e.store)) bad('unknown store in a decision effect.');
    return { kind: 'store', store: e.store, amount: signed(e.amount, 'decision effect amount') };
  }
  bad('unknown decision effect.');
}
function decisionsRecord(v) {
  const seen = new Set();
  return list(v, 'decisions', 1, CAMP_LIMITS.decisions).map((r) => {
    shape(r, ['awardId', 'packId', 'phaseId', 'cardId', 'optionId', 'replay', 'effects']);
    const out = { awardId: id(r.awardId, 'decision phase identity'), packId: id(r.packId, 'pack identity'), phaseId: id(r.phaseId, 'phase identity'),
      cardId: id(r.cardId, 'decision card identity'), optionId: id(r.optionId, 'decision option identity') };
    if (typeof r.replay !== 'boolean') bad('invalid decision record.');
    if (seen.has(`${out.awardId}|${out.cardId}`)) bad('a decision card was chosen twice for one phase.');
    seen.add(`${out.awardId}|${out.cardId}`);
    return { ...out, replay: r.replay, effects: list(r.effects, 'decision effects', 1, CAMP_LIMITS.effects).map(effectRecord) };
  });
}
function readyRecord(v, brigadeIds) {
  shape(plain(v, 'camp readiness'), ['awardId', 'morale'], ['short']);
  const morale = {};
  for (const key of Object.keys(plain(v.morale, 'camp morale')).sort()) {
    if (!brigadeIds.has(key)) bad('camp morale names a brigade that is not in the army.');
    morale[key] = signed(v.morale[key], 'camp morale');
    if (Math.abs(morale[key]) > CAMP_LIMITS.morale) bad('invalid camp morale.');
  }
  const out = { awardId: id(v.awardId, 'camp phase identity'), morale };
  if (has(v, 'short')) {
    const keys = Object.keys(plain(v.short, 'camp shortages')).sort(), short = {};
    if (!keys.length) bad('invalid camp shortages.');
    for (const key of keys) {
      if (!brigadeIds.has(key)) bad('camp shortages name a brigade that is not in the army.');
      const lacks = list(v.short[key], 'camp shortages', 1, CAMP.stores.length);
      if (lacks.some((k) => !CAMP.stores.includes(k) || k === 'wagons') || new Set(lacks).size !== lacks.length) bad('invalid camp shortages.');
      short[key] = CAMP.stores.filter((k) => lacks.includes(k));
    }
    out.short = short;
  }
  return out;
}

/**
 * v2 difficulty and trophies (P5d). `difficulty` is the campaign's level (src/franchise/tuning.js DIFFICULTY), chosen when it
 * starts: 'recruit' or 'general' are stored; Veteran is the default and is never stored, so older saves load as Veteran.
 * `trophies` { colours: [{ regiment, side, unitId, packId, phaseId, awardId, by }] }: regiment colours the army took (the
 * regiment's side, its formation's field id, the phase and recorded award, and the brigade that took it), at most once per
 * formation, regiment and pack phase (src/franchise/campaign.js recordPhase appends them).
 */
export const HOOK_FIELDS = Object.freeze(['difficulty', 'trophies']);
export const TROPHY_LIMITS = Object.freeze({ colours: 1000 });
export const colourKey = (r) => `${r.packId}|${r.phaseId}|${r.unitId}|${r.regiment}`;
function trophiesRecord(v, awards) {
  shape(plain(v, 'trophies'), ['colours']);
  const seen = new Set();
  const colours = list(v.colours, 'captured colours', 1, TROPHY_LIMITS.colours).map((r) => {
    shape(plain(r, 'captured colour'), ['regiment', 'side', 'unitId', 'packId', 'phaseId', 'awardId', 'by']);
    if (!['US', 'CS'].includes(r.side)) bad('invalid captured colour side.');
    const row = { regiment: word(r.regiment, 'colour regiment'), side: r.side, unitId: id(r.unitId, 'colour formation identity'),
      packId: id(r.packId, 'pack identity'), phaseId: id(r.phaseId, 'phase identity'), awardId: id(r.awardId, 'colour award identity'), by: word(r.by, 'colour captor') };
    if (!awards.has(row.awardId)) bad('a captured colour must belong to a recorded phase.');
    if (seen.has(colourKey(row))) bad('a captured colour was recorded twice.');
    seen.add(colourKey(row));
    return row;
  });
  return { colours };
}
/** A brigade's camp fields (v2), in canonical order; {} when it has none. */
function brigadeCamp(b) {
  const out = {};
  if (has(b, 'order')) { if (!CAMP.orders.includes(b.order)) bad('unknown camp order.'); out.order = b.order; }
  if (has(b, 'drilled')) out.drilled = number(b.drilled, 'drills', 1, CAMP_LIMITS.drilled);
  if (has(b, 'bonus')) {
    shape(plain(b.bonus, 'camp bonus'), [...BARS]);
    out.bonus = Object.fromEntries(BARS.map((k) => [k, number(b.bonus[k], `${k} camp bonus`, 0, CAMP_LIMITS.bonus)]));
  }
  if (has(b, 'extraSlot')) { if (b.extraSlot !== true) bad('invalid extra badge slot.'); out.extraSlot = true; }
  return out;
}

/** Strict canonical copy. Imported derived OVR is never trusted; it is recomputed. */
export function validateSnapshot(v) {
  // Version 2 is only the campaign kind; any other version-2 record is an unsupported version.
  const v2 = !!v && typeof v === 'object' && v.version === 2 && v.kind === 'campaign';
  if (v2) shape(v, ['format', 'version', 'kind', 'awardId', 'army', 'depot', 'issued', 'seed', 'grade', 'slot', 'campaign'], ['updated', 'enemy', ...ECONOMY_FIELDS, ...CAMP_FIELDS, ...HOOK_FIELDS]);
  else shape(v, ['format', 'version', 'kind', 'awardId', 'army', 'depot', 'issued', 'seed', 'grade']);
  if (v.format !== 'the-civil-war' || (!v2 && (v.version !== 1 || v.kind !== 'completed-reward'))) bad('unsupported save format or version.');
  const awardId = id(v.awardId, 'completed award identity');
  const seed = typeof v.seed === 'string' ? word(v.seed, 'seed', 100) : number(v.seed, 'seed', 0, 0xffffffff);
  const campaign = v2 ? campaignRecord(v.campaign) : null;
  // A fresh campaign has no grade yet; afterwards the grade is the last recorded phase's.
  const fresh = v2 && campaign.history.length === 0;
  if (fresh ? v.grade !== null : !GRADES.includes(v.grade)) bad('unknown grade.');
  const unitIds = new Set();
  const brigadeIds = new Set();
  const owners = new Map();
  const add = (it, owner) => {
    if (owners.has(it.uid)) bad('duplicate item identity or ownership.');
    owners.set(it.uid, owner);
    return it;
  };
  const army = list(v.army, 'army', 1, 200).map((b) => {
    shape(b, ['id', 'label', 'kind', 'men', 'vet', 'weapon', 'base'], v2 ? ['guns', 'ovr', 'unitId', 'badges', 'offer', 'xfactor', 'order', 'drilled', 'bonus', 'extraSlot'] : ['guns', 'ovr']);
    const bid = id(b.id, 'brigade identity');
    if (has(b, 'unitId')) {
      if (unitIds.has(id(b.unitId, 'field unit identity'))) bad('duplicate field unit identity.');
      unitIds.add(b.unitId);
    }
    if (brigadeIds.has(bid)) bad('duplicate brigade identity.');
    brigadeIds.add(bid);
    if (!['infantry', 'battery'].includes(b.kind) || !vets.has(b.vet)) bad('unknown brigade kind or veterancy.');
    shape(b.base, ['fire', 'melee', 'morale', 'drill']);
    const base = Object.fromEntries(Object.entries(b.base).map(([k, n]) => [k, number(n, `${k} rating`, 1, 99)]));
    const out = { id: bid, label: word(b.label, 'brigade label'), kind: b.kind, men: number(b.men, 'men', 0, 100000), vet: b.vet,
      weapon: add(item(b.weapon), bid), base };
    if (has(b, 'ovr')) number(b.ovr, 'derived OVR', 1, 99);
    if (b.kind === 'battery') out.guns = number(b.guns, 'guns', 0, 200);
    else if (has(b, 'guns')) bad('infantry cannot own guns.');
    if (out.weapon.depot || !canCarry(out, out.weapon)) bad('incompatible equipped gear.');
    const camp = v2 ? brigadeCamp(b) : {};
    const badges = v2 ? brigadeBadges(b, out.vet, camp.extraSlot === true) : {};
    out.ovr = ratings({ ...out, ...badges }).ovr; // kept badges add their card points (a game rule)
    if (has(b, 'unitId')) out.unitId = b.unitId;
    return Object.assign(out, badges, camp);
  });
  const depot = list(v.depot, 'depot', 0, 2000).map((it) => add(item(it), null));
  const issuedRaw = list(v.issued, 'issued records', 0, 5000);
  const economy = v2 ? economyRecord(v, campaign, issuedRaw.length) : null;
  // Turned-in cards left the inventory; the issue audit below still sees them where they were.
  const gone = economy ? economy.ledger.filter((r) => r.kind === 'turnIn') : [];
  for (const r of gone) if (owners.has(r.item.uid)) bad('a turned-in card is still in the inventory.');
  const items = new Map([...army.map((b) => b.weapon), ...depot, ...gone.map((r) => r.item)].map((it) => [it.uid, it]));
  const issued = issuedRaw.map((r) => {
    shape(r, ['brigade', 'item', 'displaced']);
    if (!brigadeIds.has(r.brigade) || !items.has(r.item) || !items.has(r.displaced) || r.item === r.displaced) bad('invalid issued reference.');
    const brigade = army.find((b) => b.id === r.brigade);
    if (!canCarry(brigade, items.get(r.item)) || !canCarry(brigade, items.get(r.displaced))) bad('incompatible issued gear.');
    return { brigade: r.brigade, item: r.item, displaced: r.displaced };
  });
  // Walk the transfers backwards: records must describe this inventory, not reissue it. A card turned in after
  // issue record i (its ledger `at` > i) returns to the depot before record i is checked.
  let back = gone.length - 1;
  for (let i = issued.length - 1; i >= 0; i--) {
    const r = issued[i];
    for (; back >= 0 && gone[back].at > i; back--) owners.set(gone[back].item.uid, null);
    if (owners.get(r.item) !== r.brigade || owners.get(r.displaced) !== null) bad('inconsistent issued records.');
    owners.set(r.item, null);
    owners.set(r.displaced, r.brigade);
  }
  const out = v2
    ? { format: 'the-civil-war', version: 2, kind: 'campaign', awardId, army, depot, issued, seed, grade: v.grade,
      slot: number(v.slot, 'save slot', 1, SAVE_SLOTS.length), campaign,
      rp: economy.rp, reputation: economy.reputation, level: economy.level, shopSeen: economy.shopSeen, ledger: economy.ledger }
    : { format: 'the-civil-war', version: 1, kind: 'completed-reward', awardId, army, depot, issued, seed, grade: v.grade };
  if (v2 && has(v, 'enemy')) out.enemy = enemyRecord(v.enemy);
  if (v2) campRecord(v, out, economy, brigadeIds);
  if (v2 && has(v, 'difficulty')) {
    if (!DIFFICULTY.levels.includes(v.difficulty)) bad('unknown difficulty.');
    if (v.difficulty !== 'veteran') out.difficulty = v.difficulty;
  }
  if (v2 && has(v, 'trophies')) out.trophies = trophiesRecord(v.trophies, new Set(campaign.history.map((r) => r.awardId)));
  if (v2 && has(v, 'updated')) {
    if (typeof v.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v.updated)) bad('invalid update time.');
    out.updated = v.updated;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_SAVE_BYTES) bad('save exceeds the 1 MB limit.');
  return out;
}

/** The camp fields onto a v2 output, with the ledger cross-checks (upgrades, extra slots, decision points). */
function campRecord(v, out, economy, brigadeIds) {
  if (has(v, 'stores')) out.stores = storesRecord(v.stores);
  const owned = has(v, 'upgrades') ? list(v.upgrades, 'army upgrades', 1, Object.keys(CAMP.upgrades).length) : [];
  if (owned.some((u) => !has(CAMP.upgrades, u)) || new Set(owned).size !== owned.length) bad('unknown or repeated army upgrade.');
  const ordered = Object.keys(CAMP.upgrades).filter((u) => owned.includes(u));
  if (JSON.stringify(ordered) !== JSON.stringify(owned) || ordered.length !== economy.upgrades.size || ordered.some((u) => !economy.upgrades.has(u))) bad('army upgrades do not match the ledger.');
  if (ordered.length) out.upgrades = ordered;
  const slots = new Set(out.army.filter((b) => b.extraSlot).map((b) => b.id));
  if (slots.size !== economy.slotted.size || [...slots].some((b) => !economy.slotted.has(b))) bad('extra badge slots do not match the ledger.');
  for (const r of out.ledger) if (r.kind === 'training' && !brigadeIds.has(r.brigadeId)) bad('training names a brigade that is not in the army.');
  const decisions = has(v, 'decisions') ? decisionsRecord(v.decisions) : [];
  const owed = new Map(decisions.map((d) => [`${d.awardId}|${d.cardId}`, d.effects.filter((e) => e.kind === 'rp').reduce((n, e) => n + e.amount, 0)]).filter(([, n]) => n !== 0));
  if (owed.size !== economy.decided.size || [...owed].some(([k, n]) => economy.decided.get(k)?.points !== n)) bad('decision points do not match the ledger.');
  if (decisions.length) out.decisions = decisions;
  if (has(v, 'ready')) out.ready = readyRecord(v.ready, brigadeIds);
}

export function completedSnapshot(result) {
  shape(result, ['awardId', 'army', 'depot', 'issued', 'seed', 'grade']);
  return validateSnapshot({ format: 'the-civil-war', version: 1, kind: 'completed-reward', ...result });
}
export function parseSnapshot(text) {
  if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES || new TextEncoder().encode(text).length > MAX_SAVE_BYTES) bad('save exceeds the 1 MB limit.');
  let v;
  try { v = JSON.parse(text); } catch { bad('file is not valid JSON.'); }
  return validateSnapshot(v);
}
export const exportSnapshot = (snapshot) => JSON.stringify(validateSnapshot(snapshot));

/** One pure exchange. Identities, inventory cardinality and reverse transfer audit remain intact. */
export function exchangeDepot(snapshot, command) {
  const before = validateSnapshot(snapshot);
  shape(command, ['brigadeId', 'itemUid']);
  const brigadeId = id(command.brigadeId, 'brigade identity'), itemUid = id(command.itemUid, 'item identity');
  const brigade = before.army.find((b) => b.id === brigadeId), selected = before.depot.find((it) => it.uid === itemUid);
  if (!brigade || !selected) bad('selected brigade or depot item is no longer available.');
  if (brigade.men === 0 || (brigade.kind === 'battery' && brigade.guns === 0)) bad('depleted formations cannot receive new gear.');
  if (!canCarry(brigade, selected)) bad('selected gear is incompatible with this formation.');
  const next = equip(brigade, selected);
  return validateSnapshot({ ...before,
    army: before.army.map((b) => b.id === brigadeId ? next.brigade : b),
    depot: [...before.depot.filter((it) => it.uid !== itemUid), next.displaced],
    issued: [...before.issued, { brigade: brigadeId, item: itemUid, displaced: next.displaced.uid }],
  });
}

// IndexedDB owns both serialization and visibility. Web Locks cannot refresh another tab's
// localStorage cache; the retained native lost-update trace is DECISIONS0036.
function openProgressDatabase() {
  return new Promise((resolve, reject) => {
    let request, settled = false;
    const unavailable = () => {
      if (settled) return;
      settled = true; reject(new Error('Progress: browser progress database is unavailable. Retry or export your army.'));
    };
    try { request = globalThis.indexedDB.open(PROGRESS_DB, 1); }
    catch { unavailable(); return; }
    request.onupgradeneeded = () => {
      try { if (!request.result.objectStoreNames.contains(PROGRESS_OBJECT_STORE)) request.result.createObjectStore(PROGRESS_OBJECT_STORE); }
      catch { request.transaction.abort(); unavailable(); }
    };
    request.onerror = unavailable;
    request.onblocked = unavailable;
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true; db.onversionchange = () => db.close(); resolve(db);
    };
  });
}
async function databaseTransaction(operation, mode, key = SAVE_KEY) {
  const db = await openProgressDatabase();
  return new Promise((resolve, reject) => {
    let transaction, answer, failure;
    const fail = (message) => new Error(`Progress: ${message} Retry or export your army.`);
    try {
      transaction = db.transaction(PROGRESS_OBJECT_STORE, mode);
      transaction.oncomplete = () => { db.close(); resolve(answer); };
      transaction.onabort = () => { db.close(); reject(failure || fail('could not save; the progress transaction was aborted.')); };
      const table = transaction.objectStore(PROGRESS_OBJECT_STORE), request = table.get(key), presence = table.count(key);
      request.onerror = () => { failure = fail('cannot read browser progress.'); };
      presence.onerror = () => { failure = fail('cannot read browser progress.'); };
      presence.onsuccess = () => {
        try {
          // Legacy bytes are a bootstrap source only. Never overwrite/delete them or consult them
          // after a committed database record exists. Failed first writes leave bootstrap intact.
          let raw = request.result;
          if (presence.result === 0) {
            try { raw = globalThis.localStorage.getItem(key); }
            catch { bad('cannot read browser storage. Retry; existing progress has not been replaced.'); }
          } else if (typeof raw !== 'string') bad('unsupported browser progress record.');
          if (raw !== null && typeof raw !== 'string') bad('unsupported browser progress record.');
          answer = operation({
            getItem() { return raw; },
            setItem(key, value) {
              const write = table.put(value, key);
              write.onerror = () => { failure = fail('could not save.'); };
              raw = value;
            },
          });
        } catch (err) { failure = err; transaction.abort(); }
      };
    } catch {
      if (transaction) { failure = fail('cannot read browser progress.'); transaction.abort(); }
      else { db.close(); reject(fail('cannot open a progress transaction.')); }
    }
  });
}

/** One authority. Explicit memory storage + serial locks are a Node-only test adapter. */
export function createProgressStore(storage, { locks, slot = 1 } = {}) {
  const key = slotKey(slot);
  // A campaign save names its slot (award identities include it); it is never written into another slot.
  const owned = (snapshot) => {
    if (snapshot.version === 2 && snapshot.slot !== slot) bad(`this campaign belongs to save slot ${snapshot.slot}, not slot ${slot}.`);
    return snapshot;
  };
  function access() {
    try {
      const s = typeof storage === 'function' ? storage() : storage;
      if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') throw new Error();
      return s;
    } catch { bad('browser storage is unavailable. Retry or export your completed army.'); }
  }
  function read(s) {
    try { return s.getItem(key); }
    catch { bad('cannot read browser storage. Retry; existing progress has not been replaced.'); }
  }
  function write(s, snapshot) {
    const text=JSON.stringify(snapshot);
    if(new TextEncoder().encode(text).length>MAX_SAVE_BYTES)bad('save exceeds the 1 MB limit.');
    try { s.setItem(key, text); }
    catch { bad('could not save. Keep this page open, retry, or export your completed army.'); }
    return snapshot;
  }
  const reconciled=snapshot=>owned(validateSnapshot(reconcileLevelRewards(snapshot,MAX_SAVE_BYTES)));
  const persistRewards=(s,current)=>{
    const next=reconciled(current);
    return JSON.stringify(next)===JSON.stringify(current)?current:write(s,next);
  };
  async function locked(operation) {
    if (storage === undefined) return databaseTransaction(operation, 'readwrite', key);
    let manager;
    try { manager = typeof locks === 'function' ? locks() : locks; }
    catch { bad('coordinated saving is unavailable. Retry or export your army.'); }
    if (!manager || typeof manager.request !== 'function') bad('coordinated saving is unavailable. Retry or export your army.');
    try { return await manager.request(key, { mode: 'exclusive' }, () => operation(access())); }
    catch (err) {
      if (err?.message?.startsWith('Progress:')) throw err;
      bad('could not coordinate saving. Retry or export your army.');
    }
  }
  const reading = (operation) => storage === undefined ? databaseTransaction(operation, 'readonly', key) : Promise.resolve().then(() => operation(access()));
  return {
    slot,
    key,
    async readRawBaseline() { return reading((s) => read(s)); },
    async load() {
      return locked((s) => { const raw = read(s); return raw === null ? null : persistRewards(s,owned(parseSnapshot(raw))); });
    },
    async complete(result, { previous = null } = {}) {
      // Canonical copies are made before waiting; caller mutation cannot change a queued command.
      const snapshot = owned(result && has(result, 'format') ? validateSnapshot(result) : completedSnapshot(result));
      const baseline = previous === null ? null : validateSnapshot(previous);
      return locked((s) => {
        const raw = read(s), current = raw === null ? null : parseSnapshot(raw);
        if (current?.awardId === snapshot.awardId) return { snapshot: persistRewards(s,owned(current)), saved: true, duplicate: true };
        if (JSON.stringify(current) !== JSON.stringify(baseline)) bad('progress changed since this demo started. Export this result before replacing the saved army.');
        return { snapshot: write(s, reconciled(snapshot)), saved: true, duplicate: false };
      });
    },
    async import(text, { previousRaw } = {}) {
      const snapshot = owned(parseSnapshot(text));
      if (previousRaw !== null && typeof previousRaw !== 'string') bad('import requires an observed storage baseline.');
      return locked((s) => {
        // No parsing of old bytes: explicit imports can repair unchanged corrupt progress.
        if (read(s) !== previousRaw) bad('progress changed since this import was reviewed. Export the pending file or choose it again.');
        return write(s, reconciled(snapshot));
      });
    },
    /**
     * One reviewed exchange computed by a pure `transform(baseline, command)` (buy, turn in, shop seen; see economy.js),
     * written only if stored progress still equals the reviewed baseline (the depot exchange's compare-and-set).
     */
    async exchange(transform, command, { previous } = {}) {
      if (typeof transform !== 'function') bad('an exchange needs its rule.');
      const baseline = owned(validateSnapshot(previous)), draft = owned(validateSnapshot(transform(baseline, command)));
      return locked((s) => {
        const raw = read(s), current = raw === null ? null : parseSnapshot(raw);
        if (JSON.stringify(current) !== JSON.stringify(baseline)) bad('progress changed since this exchange was reviewed. Export the pending army or reload saved progress.');
        return write(s, reconciled(draft));
      });
    },
    async issue(command, { previous } = {}) {
      const baseline = owned(validateSnapshot(previous)), draft = exchangeDepot(baseline, command);
      return locked((s) => {
        const raw = read(s), current = raw === null ? null : parseSnapshot(raw);
        if (JSON.stringify(current) !== JSON.stringify(baseline)) bad('progress changed since this equipment was reviewed. Export the pending army or reload saved progress.');
        return write(s, reconciled(draft));
      });
    },
  };
}

/**
 * One row per slot for a slot picker. Never throws for one bad slot: unreadable bytes are 'corrupt', a
 * storage failure is 'unavailable'. A matching campaign definition names the campaign and its next phase.
 */
export async function listSlots(storage, { campaign = null } = {}) {
  const rows = [];
  for (const slot of SAVE_SLOTS) {
    const row = { slot, empty: true, kind: null, label: 'Empty slot', nextPhase: null, updated: null };
    let raw;
    try { raw = await createProgressStore(storage, { slot }).readRawBaseline(); }
    catch { rows.push({ ...row, empty: false, kind: 'unavailable', label: 'Slot cannot be read' }); continue; }
    if (raw === null) { rows.push(row); continue; }
    let save;
    try { save = parseSnapshot(raw); }
    catch { rows.push({ ...row, empty: false, kind: 'corrupt', label: 'Unreadable save' }); continue; }
    if (save.version === 1) { rows.push({ ...row, empty: false, kind: save.kind, label: 'Practice army' }); continue; }
    const known = campaign && campaign.id === save.campaign.id && Array.isArray(campaign.phases);
    const next = known && save.campaign.status !== 'complete' ? campaign.phases[save.campaign.index] : null;
    rows.push({ ...row, empty: false, kind: save.kind, label: known && typeof campaign.title === 'string' ? campaign.title : save.campaign.id,
      nextPhase: next ? { packId: next.packId, phaseId: next.phaseId, index: save.campaign.index } : null, updated: save.updated ?? null });
  }
  return rows;
}

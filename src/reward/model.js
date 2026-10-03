// src/reward/model.js: the reward sequence's pure logic (no DOM; Node imports it for tools/test-reward.mjs).
//
//   rollLoot({ seed, grade, captures, forceLegendary }) -> { seed, grade, captures, cards }
//       cards are item instances sorted commons first, rarest last:
//       { uid, itemId, tier, conditionId, source: 'issue'|'capture', from }
//   ratings(brigade) -> { arms, fire, melee, morale, drill, ovr }   (the four card bars + OVR)
//   ovr(brigade)     -> number, gear-led (arms dominate); every weight lives in TUNING
//   compare(brigade, item) -> { ok, reason?, before, after, delta }   (before/after are ratings())
//   bestFit(brigades, item) -> the brigade with the largest OVR gain (null if none can carry it)
//   equip(brigade, item) -> { brigade: newBrigade, displaced }   (pure: the input is not changed)
//
// All numbers are placeholders for feel (see DESIGN.md flag (a): gear-led OVR lets a green brigade
// with repeaters outrate veterans; it is this one TUNING object to change after Aaron plays).

import { TIERS, TIER_BY_ID, ARMS, UNIQUES, CONDITIONS, CONDITION_BY_ID, GRADES, CAPTURE_PLACES, ISSUE_PLACE, itemDef } from './data.js';

export const TUNING = {
  // OVR = floor + scale * (weighted sum). Arms enter directly (0.5) and again through Fire.
  ovr: { floor: 40, scale: 0.6, weights: { arms: 0.5, fire: 0.2, melee: 0.1, morale: 0.1, drill: 0.1 } },
  // Fire bar = troops' own skill blended with their arms rating (gear-led).
  fire: { skill: 0.4, arms: 0.6 },
  // Good arms lift confidence: morale += moraleFromArms * (arms - 50).
  moraleFromArms: 0.12,
  // Flat OVR bonus by veterancy tier.
  vetBonus: { green: 0, trained: 1, veteran: 3, elite: 5 },
  loot: {
    // commons: quartermaster commons [min, max]; better: chance of the "usually one better card";
    // extra: chance of a second better card; lift: tier weight multiplier per rank (odds rise with grade);
    // captures: field crates [min, max] when the caller passes none.
    grades: {
      Decisive: { commons: [2, 3], better: 1.0, extra: 0.35, lift: 1.55, captures: [2, 4] },
      Victory: { commons: [2, 3], better: 0.85, extra: 0.15, lift: 1.25, captures: [1, 3] },
      Draw: { commons: [2, 3], better: 0.65, extra: 0.05, lift: 1.0, captures: [0, 2] },
      Defeat: { commons: [2, 3], better: 0.45, extra: 0.0, lift: 0.8, captures: [0, 1] },
    },
    uniqueChance: 0.3, // a Very Rare or Legendary roll becomes a named unique of that tier when one exists
    guaranteeRank: 2, // at least one card of this rank (Rare) or better per battle
  },
};

// ---- seeded RNG --------------------------------------------------------------------------------------
/** A uint32 from a number or string seed (FNV-1a for strings). */
export function seedOf(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: a small, fast, seeded generator returning [0, 1). */
export function makeRng(seed) {
  let a = seedOf(seed) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.weighted = (list, w) => {
    let total = 0;
    for (const x of list) total += w(x);
    let r = next() * total;
    for (const x of list) { r -= w(x); if (r < 0) return x; }
    return list[list.length - 1];
  };
  return next;
}

// ---- loot --------------------------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function gradeSpec(grade) {
  return TUNING.loot.grades[grade] || TUNING.loot.grades.Victory;
}

/** A tier id rolled from TIERS weights shifted by lift^rank; minRank excludes lower tiers. */
function rollTier(rng, lift, minRank = 0) {
  const pool = TIERS.filter((t) => t.rank >= minRank);
  return rng.weighted(pool, (t) => t.weight * Math.pow(lift, t.rank)).id;
}

/** An item id of a tier: an arm of that tier, or (Very Rare and up) sometimes a unique of that tier. */
function pickItem(rng, tierId) {
  const uniques = UNIQUES.filter((u) => u.tier === tierId);
  if (uniques.length && rng() < TUNING.loot.uniqueChance) return rng.pick(uniques).id;
  const arms = ARMS.filter((a) => a.tier === tierId);
  return rng.pick(arms).id;
}

function rollCondition(rng) {
  return rng.weighted(CONDITIONS, (c) => c.weight).id;
}

/** Normalise captures: an array of tier ids (or { tier, from }), a count, or undefined (rolled by grade). */
function captureTiers(rng, captures, spec) {
  if (Array.isArray(captures)) {
    return captures.map((c) => (typeof c === 'string' ? { tier: c } : { tier: c && c.tier, from: c && c.from }))
      .filter((c) => TIER_BY_ID[c.tier]);
  }
  const n = typeof captures === 'number' && captures >= 0 ? Math.floor(captures) : rng.int(spec.captures[0], spec.captures[1]);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ tier: rollTier(rng, spec.lift) });
  return out;
}

/** Roll one phase's loot. Deterministic for a seed. Cards sorted commons first, rarest last. */
export function rollLoot({ seed = 1, grade = 'Victory', captures, forceLegendary = false } = {}) {
  const rng = makeRng(seed);
  const g = GRADES.includes(grade) ? grade : 'Victory';
  const spec = gradeSpec(g);
  const drafts = []; // { tier, source, from? }

  // field captures (crates opened at the after-action)
  const crates = captureTiers(rng, captures, spec);
  for (const c of crates) drafts.push({ tier: c.tier, source: 'capture', from: c.from || `Captured: ${rng.pick(CAPTURE_PLACES)}` });

  // quartermaster issue: several commons ...
  const nCommons = rng.int(spec.commons[0], spec.commons[1]);
  for (let i = 0; i < nCommons; i++) drafts.push({ tier: 'common', source: 'issue', from: ISSUE_PLACE });
  // ... and usually one better card (sometimes two at a good grade)
  if (rng() < spec.better) drafts.push({ tier: rollTier(rng, spec.lift, 1), source: 'issue', from: ISSUE_PLACE });
  if (rng() < spec.extra) drafts.push({ tier: rollTier(rng, spec.lift, 1), source: 'issue', from: ISSUE_PLACE });

  // guarantee: at least one Rare-or-better (raise the best issue card, else add one)
  const rankOf = (d) => TIER_BY_ID[d.tier].rank;
  const want = TUNING.loot.guaranteeRank;
  if (!drafts.some((d) => rankOf(d) >= want)) {
    const issue = drafts.filter((d) => d.source === 'issue').sort((a, b) => rankOf(b) - rankOf(a))[0];
    if (issue) issue.tier = TIERS[want].id;
    else drafts.push({ tier: TIERS[want].id, source: 'issue', from: ISSUE_PLACE });
  }
  // sandbox "Play with a Legendary": raise the best card to Legendary
  if (forceLegendary && !drafts.some((d) => d.tier === 'legendary')) {
    const best = [...drafts].sort((a, b) => rankOf(b) - rankOf(a))[0];
    best.tier = 'legendary';
  }

  const cards = drafts.map((d, i) => ({
    uid: `L${seedOf(seed).toString(36)}-${i}`,
    itemId: pickItem(rng, d.tier),
    tier: d.tier,
    conditionId: rollCondition(rng),
    source: d.source,
    from: d.from,
  }));
  // commons first, rarest last; stable within a tier (issue cards before captures of the same tier)
  const order = cards.map((c, i) => [c, i]);
  order.sort((a, b) => TIER_BY_ID[a[0].tier].rank - TIER_BY_ID[b[0].tier].rank || a[1] - b[1]);
  return { seed, grade: g, captures: crates.map((c) => c.tier), cards: order.map(([c]) => c) };
}

// ---- ratings -----------------------------------------------------------------------------------------
/** The arms rating of an item instance: its power times its condition, 1-99. */
export function armsRating(item) {
  const def = itemDef(item.itemId);
  const cond = CONDITION_BY_ID[item.conditionId] || CONDITION_BY_ID.serviceable;
  return clamp(Math.round(def.power.v * cond.mult), 1, 99);
}

/** Can this brigade carry this item? Guns go to batteries, small arms to infantry. */
export function canCarry(brigade, item) {
  const def = itemDef(item.itemId);
  return brigade.kind === 'battery' ? def.arm === 'artillery' : def.arm === 'infantry';
}

/** The card bars and OVR of a brigade with its current weapon. */
export function ratings(brigade) {
  const arms = armsRating(brigade.weapon);
  const def = itemDef(brigade.weapon.itemId);
  const b = brigade.base;
  const fire = clamp(Math.round(TUNING.fire.skill * b.fire + TUNING.fire.arms * arms), 1, 99);
  const melee = clamp(Math.round(b.melee + (def.mods?.melee || 0)), 1, 99);
  const morale = clamp(Math.round(b.morale + TUNING.moraleFromArms * (arms - 50)), 1, 99);
  const drill = clamp(Math.round(b.drill + (def.mods?.drill || 0)), 1, 99);
  const w = TUNING.ovr.weights;
  const raw = w.arms * arms + w.fire * fire + w.melee * melee + w.morale * morale + w.drill * drill;
  const ovrV = clamp(Math.round(TUNING.ovr.floor + TUNING.ovr.scale * raw + (TUNING.vetBonus[brigade.vet] || 0)), 1, 99);
  return { arms, fire, melee, morale, drill, ovr: ovrV };
}

/** Overall rating, gear-led. */
export function ovr(brigade) {
  return ratings(brigade).ovr;
}

/** Equip an item: returns a new brigade and the displaced weapon (which goes to the depot). Pure. */
export function equip(brigade, item) {
  if (!canCarry(brigade, item)) throw new Error(`equip: ${brigade.label} cannot carry ${itemDef(item.itemId).name}`);
  const displaced = { ...brigade.weapon, from: `Depot: from ${brigade.label}`, depot: true };
  const weapon = { ...item };
  delete weapon.depot;
  return { brigade: { ...brigade, base: { ...brigade.base }, weapon }, displaced };
}

const STATS = ['ovr', 'arms', 'fire', 'melee', 'morale', 'drill'];

/** Side-by-side numbers for the compare view. */
export function compare(brigade, item) {
  const before = ratings(brigade);
  if (!canCarry(brigade, item)) {
    const reason = brigade.kind === 'battery' ? 'Batteries carry guns only' : 'Infantry carry small arms only';
    return { ok: false, reason, before, after: before, delta: Object.fromEntries(STATS.map((k) => [k, 0])) };
  }
  const after = ratings(equip(brigade, item).brigade);
  const delta = Object.fromEntries(STATS.map((k) => [k, after[k] - before[k]]));
  return { ok: true, before, after, delta };
}

/** The brigade that gains most OVR from the item (first in order on a tie); null if none can carry it. */
export function bestFit(brigades, item) {
  let best = null;
  let gain = -Infinity;
  for (const b of brigades) {
    const c = compare(b, item);
    if (!c.ok) continue;
    if (c.delta.ovr > gain) { gain = c.delta.ovr; best = b; }
  }
  return best;
}

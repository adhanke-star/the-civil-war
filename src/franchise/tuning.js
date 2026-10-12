// src/franchise/tuning.js: the franchise economy's tunable weights in one place (DESIGN §4 Defaults: "all tunable
// weights live in src/franchise/tuning.js"). Every number here is a GAME RULE, not history; the UI labels it so.
// Read by src/franchise/economy.js. Changing a number changes future awards only: saved ledgers keep what they paid.

export const ECONOMY = Object.freeze({
  // Requisition points (RP) for one campaign phase, by grade.
  phasePoints: Object.freeze({ Decisive: 60, Victory: 40, Draw: 20, Defeat: 10 }),
  heldBonus: 15, // the player held the objective at the end of the phase
  lowLossBonus: 10, // player losses at most lowLossRatio of the enemy's
  lowLossRatio: 0.5,
  loanFactor: 0.5, // a phase fought with an army on loan earns this share (rounded down)
  // Turning in a depot card pays by rarity.
  turnIn: Object.freeze({ common: 5, uncommon: 10, rare: 20, veryRare: 40, legendary: 80 }),
  // Shop prices by rarity (condition is rolled like loot and does not change the price).
  price: Object.freeze({ common: 30, uncommon: 60, rare: 120, veryRare: 240, legendary: 480 }),
  // Reputation (cumulative RP earned, never reduced by spending) needed for levels 1-10.
  levels: Object.freeze([0, 60, 150, 270, 420, 600, 810, 1050, 1320, 1620]),
  // The reward card dealt on reaching a level (index = level; levels 0 and 1 deal none).
  levelCardTier: Object.freeze([null, null, 'uncommon', 'uncommon', 'rare', 'rare', 'veryRare', 'veryRare', 'veryRare', 'legendary', 'legendary']),
  // The highest rarity the shop stocks at each level (index = level).
  shopTier: Object.freeze([null, 'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'veryRare', 'veryRare', 'legendary', 'legendary']),
  shopSize: 6, // distinct catalogue arms on offer per phase (fewer when fewer are eligible)
});

// Badges (DESIGN §3 Badges, Badge tiers; read by src/franchise/badges.js, src/reward/model.js and src/sim/combat.js).
// Each badge is earned by ONE measurable feat in one campaign phase (src/sim/combat.js feat statistics). One rule for every
// badge: Silver needs 2x the Bronze amount and Gold 4x, in the same phase. Effects are small and labelled game rules:
// `points` add to one card bar (Bronze/Silver/Gold); `combat` is the matching battle multiplier in percent by tier (a
// conditional bonus, e.g. Sharpshooters' fire beyond 200 m). The first Gold on a brigade is its X-Factor: friendly
// formations within `xfactor.radius` metres of that brigade (itself included) gain `xfactor.share` of its badge's combat
// effect on top. Changing a number changes future awards and battles only; saved tiers stay as earned.
export const BADGE_RULES = Object.freeze({
  tierFactor: Object.freeze({ bronze: 1, silver: 2, gold: 4 }),
  slots: Object.freeze({ green: 1, trained: 2, veteran: 3, elite: 4 }),
  points: Object.freeze([3, 5, 8]), // card bar points at Bronze, Silver, Gold (every badge)
  combat: Object.freeze([3, 5, 8]), // battle effect in percent at Bronze, Silver, Gold (every badge)
  xfactor: Object.freeze({ radius: 300, share: 0.1 }),
  // Bronze amount of each badge's feat in one phase (units in src/franchise/badges.js FEATS).
  bronze: Object.freeze({
    sharpshooters: 60, // casualties inflicted by fire from beyond 200 m
    firstVolley: 10, // casualties of the first volley after Hold Fire, target within 60 m
    coolUnderFire: 10, // % of starting men lost while holding ground and returning fire
    fireDiscipline: 25, // casualties inflicted in the 15 s after opening from Hold Fire within 60 m
    skirmishers: 40, // casualties inflicted from beyond 150 m on a larger formation
    stormers: 1, // foes in cover broken by the brigade's charge
    coldSteel: 1, // foes broken within 30 s of the brigade's charge reaching them
    shock: 1, // larger foes broken by the brigade's charge
    flankers: 40, // casualties inflicted from a foe's flank or rear
    relentless: 1, // charges that reached the enemy again after a charge that failed
    gunTakers: 2, // enemy guns taken (a battery broken by the brigade's charge or surrendered to it)
    rock: 2, // enemy formations that broke within 150 m while the brigade held its ground
    unshaken: 30, // seconds holding under fire while flanked or beside a routing friend
    quickRally: 1, // rallies within 30 s of breaking
    rearGuard: 15, // casualties inflicted while falling back
    diggers: 50, // casualties inflicted from a fence line or farm buildings
    hardMarchers: 800, // metres marched under orders
    woodsmen: 50, // casualties inflicted from woods
    foragers: 1, // enemy or neutral field stores taken
    canister: 50, // casualties inflicted with canister (150 yd or less)
  }),
});

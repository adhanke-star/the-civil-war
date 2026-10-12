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

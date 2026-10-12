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
  levels: Object.freeze([0, 30, 75, 135, 210, 300, 405, 525, 660, 800]),
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

// Camp orders, stores, army upgrades, training, extra badge slots and affix re-rolls (DESIGN §3 Camp, Stores, Shop; read by
// src/franchise/camp-orders.js, economy.js, decisions.js, campaign.js and save.js). Every number is a GAME RULE. Stores are
// whole units: one "ammunition" or "rations" is what one brigade draws for one phase at `use`; shoes, blankets and tents wear
// out at `use` per fielded brigade per phase; batteries also wear out `use.horses` horses. Morale effects reach the battle
// through the field definition's `morale` (src/units/unit.js reads it; 78 when a definition has none); the other camp
// effects through `battle` below.
export const CAMP = Object.freeze({
  defaultMorale: 78, // src/units/unit.js: a formation's morale when its definition sets none
  stores: Object.freeze(['ammunition', 'rations', 'shoes', 'blankets', 'tents', 'horses', 'wagons']),
  start: Object.freeze({ ammunition: 120, rations: 60, shoes: 30, blankets: 30, tents: 30, horses: 40, wagons: 12 }),
  // The quartermaster's issue, received each time the army marches out of camp to a phase.
  issue: Object.freeze({ ammunition: 40, rations: 20, shoes: 8, blankets: 6, tents: 6, horses: 4, wagons: 0 }),
  // Drawn per fielded franchise brigade per phase (horses: per fielded battery).
  use: Object.freeze({ ammunition: 4, rations: 2, shoes: 1, blankets: 1, tents: 1, horses: 2 }),
  // Morale lost for the phase by a fielded brigade its stores could not cover (all shortages together at most shortCap).
  shortMorale: Object.freeze({ ammunition: 6, rations: 4, shoes: 2, blankets: 2, tents: 2, horses: 3 }),
  shortCap: 10,
  orders: Object.freeze(['rest', 'drill', 'target']), // one per brigade; Rest is the default
  rest: Object.freeze({ morale: 4 }), // morale for the next phase
  drill: Object.freeze({ bar: 1, perTier: 3, maxVet: 'veteran' }), // +1 Drill bar; every third drill raises veterancy (to Veteran at most)
  target: Object.freeze({ bar: 1, ammunition: 4 }), // +1 Fire bar for 4 ammunition (no ammunition to spare: the brigade rests)
  barCap: 6, // card-bar points a brigade can gain in camp, per bar (orders and bought training together)
  training: Object.freeze({ points: 2, price: 40, level: 2 }), // bought training: +2 to one bar for 40 RP, from level 2
  extraSlot: Object.freeze({ price: 100, level: 3 }), // one extra badge slot per brigade above its veterancy's slots
  // Re-rolling an item's condition affix costs by rarity; the new condition is never the old one.
  reroll: Object.freeze({ common: 10, uncommon: 20, rare: 40, veryRare: 80, legendary: 160 }),
  // Requisition drawer store lots: quantity and price (any number of lots may be bought).
  storeLots: Object.freeze({
    ammunition: Object.freeze({ qty: 40, price: 20 }), rations: Object.freeze({ qty: 20, price: 10 }), shoes: Object.freeze({ qty: 10, price: 10 }),
    blankets: Object.freeze({ qty: 10, price: 10 }), tents: Object.freeze({ qty: 10, price: 15 }), horses: Object.freeze({ qty: 10, price: 20 }),
    wagons: Object.freeze({ qty: 2, price: 30 }) }),
  cardsPerWagon: 5, // depot capacity: wagons x 5 cards (+ the Wagons upgrade); only shop purchases are refused when full
  // The army upgrade tree: one-time purchases, each opened at a reputation level.
  upgrades: Object.freeze({
    wagons: Object.freeze({ price: 60, level: 2, cards: 30 }), // +30 depot cards
    ambulances: Object.freeze({ price: 120, level: 3, returned: 0.1 }), // a tenth of each phase's franchise losses return to the ranks
    ordnance: Object.freeze({ price: 120, level: 4, factor: 0.75 }), // ammunition drawn and spent on target practice x 0.75 (rounded up)
    pioneers: Object.freeze({ price: 90, level: 3, woods: 0.8 }), // fielded franchise brigades and batteries march through woods at x0.8 (x0.7 without)
  }),
  // Camp effects in battle (P5d): src/franchise/campaign.js applyCampaign writes them on the field definition (`training`,
  // `fatigue`, `ammo`, `limber`, `pioneers`; src/sim/phase.js validates them); src/units/unit.js and src/sim/combat.js apply
  // them. A definition without them fights exactly as before.
  battle: Object.freeze({
    perPoint: 1, // % per camp card-bar point (camp orders and bought training): Fire -> fire effect, Drill -> reload and wheeling
    //              speed, Melee -> melee strength, Morale -> morale lost under fire (a bar's camp points are capped by barCap)
    fatigue: 30, // starting fatigue (of 100) for a brigade short of shoes (fatigue slows the march and the fire; rest recovers it)
    ammo: 50, // starting rounds (% of a full box) for a brigade short of ammunition (resupply out of contact refills it slowly)
    limber: 6, // extra sim seconds a battery short of horses takes to limber up before it moves and to unlimber after it halts
  }),
});

// Difficulty (DESIGN §1 Difficulty: "smarter, faster AI and no auto-pause; never hidden stat bonuses"). Read by src/sim/ai.js and
// src/game.js; chosen for a campaign when it starts (saved; absent = Veteran) and on the Battles list. Every level fights with
// identical combat numbers: only the AI's timing and decisions and the auto-pause change. Game rules, not history.
//   pause     'always': pause on a rout, an arrival or a threatened objective whatever the Auto-pause setting; 'setting': the
//             Auto-pause setting (rules.autoPause) decides; 'never': no auto-pause
//   interval  sim seconds between AI passes (reaction time); reissue: sim s before a march stopped short is ordered again
//   reserve   'set': a reserve commits only at its set time (`at`, else `reserveShare` of the day's window), never earlier on a
//             threat; 'threat': today's triggers (its time, an enemy within reserveReach, the objective lost)
//   threat    a committed reserve marches to the threatened objective (contested or lost) instead of its own target
//   counter   { reach, range }: a breakthrough is an enemy formation inside the objective or within `reach` m of a routing
//             friend; a steady holding infantry brigade within `range` m of it attacks it (fire, never a charge); null: none
export const DIFFICULTY = Object.freeze({
  levels: Object.freeze(['recruit', 'veteran', 'general']),
  names: Object.freeze({ recruit: 'Recruit', veteran: 'Veteran', general: 'General' }),
  recruit: Object.freeze({ pause: 'always', interval: 1, reissue: 12, reserve: 'set', reserveShare: 0.5, reserveReach: 350, threat: false, counter: null }),
  veteran: Object.freeze({ pause: 'setting', interval: 0.5, reissue: 8, reserve: 'threat', reserveShare: 0, reserveReach: 350, threat: false, counter: null }),
  general: Object.freeze({ pause: 'never', interval: 0.25, reissue: 4, reserve: 'threat', reserveShare: 0, reserveReach: 525, threat: true,
    counter: Object.freeze({ reach: 200, range: 400 }) }),
});

// Commanders' temperament (DESIGN §4b "AI character"; P3t). assets/traits.json (tools/build-traits.mjs) holds each enemy
// commander's 2-3 sourced traits; tools/build-packs.mjs writes a phase's `commanderTraits` (name -> keys, for the men in that
// phase) and its `enemyCommander` (the army commander). src/sim/ai.js gives an AI formation the traits of its own commander
// (while he is up) and of its army commander; src/game.js uses `reckless` for the man himself. Game rules, not history: a
// trait changes only the AI's decisions and timing (and, for reckless, where the commander exposes himself), never a combat
// number. A formation with no traits plays exactly as before. Several traits compose: starts add, factors multiply.
//   start   sim s added to when a role begins (negative = earlier): an attack's or reserve's `at`, a Recruit reserve's set time,
//           and (a delay only) an attack without `at`, counted from its first moment on the field
//   reach   x the enemy distance that commits a reserve (the difficulty level's reserveReach)
//   reissue x the sim s before a march stopped short is ordered again (the level's reissue); cool: x the 30 s before an
//           attacker marches again after falling back
//   shaken  it also retires when only shaken (not just wavering) with the nearest enemy outnumbering it
//   hold    under a hold order it retires only when the nearest enemy has this many times its men (1 = the usual rule)
//   wait    sim s an attacker or reserve, once begun, waits for the other AI formations sharing its target to begin too;
//           window: x that wait (the largest wait of its traits, times every window)
//   steady  its re-issue time is never shorter than its level's
//   counter { reach, range }: a holding infantry brigade counter-attacks a breakthrough (fire, never a charge) at any level,
//           like a General's (DIFFICULTY.general.counter)
//   cover   { search, clear, gain }: a holding infantry brigade with no enemy within `clear` m moves once to the best cover
//           (Game.coverAt) within `search` m that is at least `gain` better and no nearer the enemy
//   pass    its AI pass runs every `pass`-th time (a longer reaction and re-plan interval)
//   danger  reckless only: x the 120 m within which fire puts the commander himself at risk (src/game.js commandStep, the
//           existing commander stream); he rides where the fighting is, so he is hit more often
export const TRAITS = Object.freeze({
  keys: Object.freeze(['aggressive', 'impetuous', 'cautious', 'stubborn', 'methodical', 'skilled-defender', 'slow', 'reckless']),
  aggressive: Object.freeze({ start: -20, reach: 1.3, reissue: 0.5, cool: 0.5 }),
  impetuous: Object.freeze({ start: -10, window: 0.25 }),
  cautious: Object.freeze({ start: 20, reach: 0.7, reissue: 1.5, shaken: true }),
  stubborn: Object.freeze({ hold: 1.6 }),
  methodical: Object.freeze({ wait: 45, steady: true }),
  'skilled-defender': Object.freeze({ counter: Object.freeze({ reach: 200, range: 350 }), cover: Object.freeze({ search: 100, clear: 250, gain: 0.15 }) }),
  slow: Object.freeze({ pass: 2, reissue: 1.5 }),
  reckless: Object.freeze({ danger: 1.5 }),
});

// Captured colours (DESIGN §3 Stores "colours and trophies (trophy shelf)"; src/franchise/captures.js ColourCaptures, src/game.js).
// Each named regiment of an infantry or cavalry formation carries one colour. It is taken (once, no dice) when its formation
// surrenders (by the captor), is destroyed (by the nearest unbroken enemy formation within `radius` m) or is broken while an
// enemy charge is on it (by the charger: the colour of the regiment block nearest the charger). Game rules, not history.
export const COLOURS = Object.freeze({ radius: 150 });

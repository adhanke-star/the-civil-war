// src/reward/data.js: PLACEHOLDER data for the reward-sequence prototype (S1). Not history of record.
//
// What is real and what is not:
// - Weapon TYPES are real Civil War arms. Their range / rate / accuracy numbers carry `src`:
//     'old-data'    copied from the frozen old project (data/weapons.json, data/artillery.json, tag
//                   reference-freeze-2026-10-02), whose own sources are listed in OLD_DATA_SOURCES below;
//     'placeholder' a plausible number chosen for this prototype, NOT sourced. Replace before shipping.
// - Rarity placement follows DESIGN.md section 3 "Rarity" (Aaron's choice); DESIGN says placements are
//   "sourced before shipping", so every tier assignment here is a game choice, not a historical claim.
// - `power` (the arms rating that drives OVR) is a game number, always 'placeholder'.
// - Condition affixes are GAME MODIFIERS (gameModifier: true), not history (DESIGN "Affixes").
// - Uniques are GAME ITEMS (gameItem: true): a real weapon type with an invented name, effect and
//   flavour line. They never name a real person or unit and must always show a "Game item" tag.
// - The sample army is invented: generic labels only ("1st Brigade", "Battery A"), no commanders.
// No DOM, no dependencies: Node imports this for tools/test-reward.mjs.

export const PLACEHOLDER = true;

export const OLD_DATA_SOURCES = {
  smallArms: 'old data/weapons.json: Hess, The Rifle Musket in Civil War Combat; American Rifleman; NPS weapons references (per that file)',
  artillery: 'old data/artillery.json: Hazlett, Olmstead & Parks, Field Artillery Weapons of the Civil War; Hess 2022; Naisawald, Grape and Canister (per that file)',
};

/** Five rarity tiers (Borderlands colours). Colour is never the only cue: each has a shape and a name.
 *  `ink` is the text colour that reads on `color` (contrast 4.5:1 or better). `weight` is the base roll
 *  weight (model.js shifts it by grade). */
export const TIERS = [
  { id: 'common', name: 'Common', rank: 0, color: '#e4e4e4', ink: '#17171a', shape: 'circle', weight: 100 },
  { id: 'uncommon', name: 'Uncommon', rank: 1, color: '#4cc94c', ink: '#07260a', shape: 'square', weight: 40 },
  { id: 'rare', name: 'Rare', rank: 2, color: '#2f6ee0', ink: '#ffffff', shape: 'diamond', weight: 16 },
  { id: 'veryRare', name: 'Very Rare', rank: 3, color: '#9b3fd6', ink: '#ffffff', shape: 'hexagon', weight: 5 },
  { id: 'legendary', name: 'Legendary', rank: 4, color: '#ff8a1c', ink: '#2a1200', shape: 'star', weight: 2 },
];
export const TIER_BY_ID = Object.fromEntries(TIERS.map((t) => [t.id, t]));

const old = (v) => ({ v, src: 'old-data' });
const ph = (v) => ({ v, src: 'placeholder' });

/** Weapon and gun types. arm: 'infantry' (small arms, for brigades) or 'artillery' (guns, for batteries).
 *  range in yards, rate in rounds per minute, accuracy 0-100 (old project's scale), power 0-99 (game).
 *  mods: small game adjustments to Melee and Drill (placeholder). */
export const ARMS = [
  // Common
  { id: 'm1842', tier: 'common', arm: 'infantry', name: 'M1842 musket', kind: 'smoothbore musket', caliber: '.69',
    range: old(100), rate: old(3), accuracy: old(25), power: ph(28), mods: { melee: 0, drill: 0 },
    effect: { text: 'Buck-and-ball: deadly at 50 yards, little use past 100', src: 'old-data' } },
  { id: 'sixPdr', tier: 'common', arm: 'artillery', name: '6-pdr field gun', kind: 'smoothbore gun', caliber: '3.67 in',
    range: ph(1500), rate: ph(2), accuracy: ph(50), power: ph(30), mods: { melee: 0, drill: 2 },
    effect: { text: 'Light and quick to move; outranged by heavier guns', src: 'placeholder' } },
  // Uncommon
  { id: 'lorenz', tier: 'uncommon', arm: 'infantry', name: 'Lorenz rifle', kind: 'rifle-musket', caliber: '.54',
    range: old(250), rate: old(3), accuracy: old(55), power: ph(44), mods: { melee: 0, drill: 0 },
    effect: { text: 'Cheap import: serviceable if inconsistent', src: 'old-data' } },
  { id: 'belgian', tier: 'uncommon', arm: 'infantry', name: 'Belgian rifle-musket', kind: 'rifle-musket', caliber: '.70',
    range: ph(200), rate: ph(3), accuracy: ph(42), power: ph(40), mods: { melee: 1, drill: -1 },
    effect: { text: 'Heavy bore, uneven workmanship', src: 'placeholder' } },
  { id: 'howitzer12', tier: 'uncommon', arm: 'artillery', name: '12-pdr howitzer', kind: 'field howitzer', caliber: '4.62 in',
    range: old(1070), rate: old(2), accuracy: old(50), power: ph(42), mods: { melee: 0, drill: 1 },
    effect: { text: 'Shell and canister thrower; short-armed', src: 'old-data' } },
  // Rare
  { id: 'springfield', tier: 'rare', arm: 'infantry', name: 'Springfield M1861', kind: 'rifle-musket', caliber: '.58',
    range: old(300), rate: old(3), accuracy: old(72), power: ph(60), mods: { melee: 0, drill: 1 },
    effect: { text: 'Accurate, reliable, single-shot', src: 'old-data' } },
  { id: 'enfield', tier: 'rare', arm: 'infantry', name: 'Enfield P53', kind: 'rifle-musket', caliber: '.577',
    range: old(300), rate: old(3), accuracy: old(70), power: ph(59), mods: { melee: 0, drill: 1 },
    effect: { text: 'The most-imported rifle-musket of the war', src: 'old-data' } },
  { id: 'napoleon', tier: 'rare', arm: 'artillery', name: '12-pdr Napoleon', kind: 'smoothbore gun-howitzer', caliber: '4.62 in',
    range: old(1600), rate: old(2), accuracy: old(60), power: ph(62), mods: { melee: 0, drill: 0 },
    effect: { text: 'Ordinary far off; with canister at 300 yards, deadly', src: 'old-data' } },
  // Very Rare
  { id: 'sharps', tier: 'veryRare', arm: 'infantry', name: 'Sharps rifle', kind: 'breech-loading rifle', caliber: '.52',
    range: old(350), rate: old(8), accuracy: old(80), power: ph(74), mods: { melee: 0, drill: 3 },
    effect: { text: 'Breech-loader: load lying down, fire far faster', src: 'old-data' } },
  { id: 'colt', tier: 'veryRare', arm: 'infantry', name: 'Colt revolving rifle', kind: 'revolving rifle', caliber: '.56',
    range: old(300), rate: old(7), accuracy: old(68), power: ph(70), mods: { melee: -1, drill: 2 },
    effect: { text: 'Five fast shots; a chain-fire risk', src: 'old-data' } },
  { id: 'ordnance3', tier: 'veryRare', arm: 'artillery', name: '3-inch Ordnance rifle', kind: 'rifled gun', caliber: '3.0 in',
    range: old(1830), rate: old(2), accuracy: old(90), power: ph(75), mods: { melee: 0, drill: 2 },
    effect: { text: 'Wrought iron: accurate and almost never bursts', src: 'old-data' } },
  { id: 'parrott10', tier: 'veryRare', arm: 'artillery', name: '10-pdr Parrott rifle', kind: 'rifled gun', caliber: '2.9 in',
    range: old(1900), rate: old(2), accuracy: old(82), power: ph(72), mods: { melee: 0, drill: 0 },
    effect: { text: 'Long-armed and plentiful; can burst at the muzzle', src: 'old-data' } },
  // Legendary
  { id: 'spencer', tier: 'legendary', arm: 'infantry', name: 'Spencer rifle', kind: 'repeating rifle', caliber: '.56-56',
    range: old(300), rate: old(14), accuracy: old(78), power: ph(90), mods: { melee: 0, drill: 4 },
    effect: { text: 'Seven shots without reloading', src: 'old-data' } },
  { id: 'henry', tier: 'legendary', arm: 'infantry', name: 'Henry rifle', kind: 'repeating rifle', caliber: '.44',
    range: old(250), rate: old(16), accuracy: old(74), power: ph(88), mods: { melee: -2, drill: 4 },
    effect: { text: 'Sixteen rounds in the tube', src: 'old-data' } },
  { id: 'whitworth', tier: 'legendary', arm: 'artillery', name: 'Whitworth 12-pdr', kind: 'rifled breech-loader', caliber: '2.75 in hex',
    range: old(2800), rate: old(1), accuracy: old(98), power: ph(86), mods: { melee: 0, drill: -1 },
    effect: { text: 'Pinpoint past a mile; slow, special ammunition', src: 'old-data' } },
];

/** Named uniques: real weapon types, invented game names. gameItem: true always. Never history. */
export const UNIQUES = [
  { id: 'u-lucky-seven', base: 'spencer', tier: 'legendary', name: 'Lucky Seven', gameItem: true, powerBonus: 4,
    special: { id: 'firstVolley', value: 0.25, text: 'First volley of each fight hits 25% harder' },
    flavour: 'Seven in the tube and one for luck, says whoever is carrying it this week.' },
  { id: 'u-quiet-argument', base: 'sharps', tier: 'legendary', name: 'The Quiet Argument', gameItem: true, powerBonus: 4,
    special: { id: 'longAim', value: 10, text: '+10 accuracy beyond 200 yards' },
    flavour: 'It settles disputes at four hundred yards and never raises its voice.' },
  { id: 'u-rainmaker', base: 'ordnance3', tier: 'legendary', name: 'Rainmaker', gameItem: true, powerBonus: 4,
    special: { id: 'wideBurst', value: 0.2, text: 'Shells burst 20% wider' },
    flavour: 'The crew swear it has never once fired on a dry day.' },
  { id: 'u-brass-grandmother', base: 'napoleon', tier: 'veryRare', name: 'Brass Grandmother', gameItem: true, powerBonus: 4,
    special: { id: 'longCanister', value: 0.25, text: 'Canister reaches 25% farther' },
    flavour: 'Older than half the battery and louder than all of it.' },
];

/** Condition affixes: rolled per lot, about +/-15% on the arms rating. Game modifiers, not history. */
export const CONDITIONS = [
  { id: 'arsenalNew', name: 'Arsenal-new', mult: 1.15, weight: 14, gameModifier: true, words: 'fresh from the arsenal' },
  { id: 'serviceable', name: 'Serviceable', mult: 1.0, weight: 40, gameModifier: true, words: 'sound, no change' },
  { id: 'fieldRepaired', name: 'Field-repaired', mult: 0.93, weight: 16, gameModifier: true, words: 'patched in the field' },
  { id: 'worn', name: 'Worn', mult: 0.88, weight: 20, gameModifier: true, words: 'fouled and loose' },
  { id: 'mixedCalibres', name: 'Mixed calibres', mult: 0.85, weight: 10, gameModifier: true, words: 'ammunition will not always fit' },
];
export const CONDITION_BY_ID = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));

/** The plain-words effect of a condition, e.g. "+15% firepower" or "No change". */
export function conditionEffect(c) {
  const pct = Math.round((c.mult - 1) * 100);
  if (pct === 0) return 'No change to firepower';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% firepower`;
}

export const VETERANCY = [
  { id: 'green', name: 'Green' },
  { id: 'trained', name: 'Trained' },
  { id: 'veteran', name: 'Veteran' },
  { id: 'elite', name: 'Elite' },
];

export const GRADES = ['Decisive', 'Victory', 'Draw', 'Defeat'];
export const GRADE_NOTES = {
  Decisive: 'Every objective taken, and losses light.',
  Victory: 'The objectives are yours.',
  Draw: 'Neither side holds the field.',
  Defeat: 'The objectives are lost. The army fights on.',
};

/** Where a card came from (placeholder places, no real battlefield named). */
export const CAPTURE_PLACES = [
  'an overrun battery by the orchard',
  'abandoned at the creek ford',
  'a wagon cut off on the ridge road',
  'surrendered at the wood line',
  'left on the field by the farm lane',
  'a caisson at the crossroads',
];
export const ISSUE_PLACE = 'Quartermaster issue';

/** Sample army: 4 infantry brigades and 2 batteries (DESIGN: brigades and batteries are both commanded
 *  directly; guns can only go to batteries). Generic labels, invented numbers. */
export const SAMPLE_ARMY = [
  { id: 'b1', label: '1st Brigade', kind: 'infantry', men: 1840, vet: 'veteran',
    weapon: { uid: 'start-b1', itemId: 'springfield', tier: 'rare', conditionId: 'serviceable', from: 'In service' },
    base: { fire: 64, melee: 58, morale: 70, drill: 66 } },
  { id: 'b2', label: '2nd Brigade', kind: 'infantry', men: 2110, vet: 'trained',
    weapon: { uid: 'start-b2', itemId: 'enfield', tier: 'rare', conditionId: 'worn', from: 'In service' },
    base: { fire: 58, melee: 55, morale: 62, drill: 60 } },
  { id: 'b3', label: '3rd Brigade', kind: 'infantry', men: 2360, vet: 'green',
    weapon: { uid: 'start-b3', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'In service' },
    base: { fire: 44, melee: 50, morale: 48, drill: 42 } },
  { id: 'b4', label: '4th Brigade', kind: 'infantry', men: 1420, vet: 'elite',
    weapon: { uid: 'start-b4', itemId: 'lorenz', tier: 'uncommon', conditionId: 'mixedCalibres', from: 'In service' },
    base: { fire: 72, melee: 66, morale: 78, drill: 74 } },
  { id: 'bA', label: 'Battery A', kind: 'battery', men: 140, guns: 6, vet: 'trained',
    weapon: { uid: 'start-bA', itemId: 'sixPdr', tier: 'common', conditionId: 'serviceable', from: 'In service' },
    base: { fire: 60, melee: 30, morale: 62, drill: 64 } },
  { id: 'bB', label: 'Battery B', kind: 'battery', men: 132, guns: 6, vet: 'veteran',
    weapon: { uid: 'start-bB', itemId: 'howitzer12', tier: 'uncommon', conditionId: 'worn', from: 'In service' },
    base: { fire: 66, melee: 32, morale: 68, drill: 70 } },
];

// Abstract practice equipment, excluded from loot pools. The battlefield's weapon class does not
// establish an exact historical model, calibre or rarity. Every number here is a game representation.
export const PRACTICE_ARMS = [
  ['practice-smooth', 'infantry', 'Practice smoothbore', 'smoothbore musket', 28, 100],
  ['practice-rifled', 'infantry', 'Practice rifle-musket', 'rifle-musket', 50, 300],
  ['practice-smbart', 'artillery', 'Practice smoothbore gun', 'smoothbore gun', 30, 1500],
  ['practice-parrott', 'artillery', 'Practice rifled gun', 'rifled gun', 60, 1900],
].map(([id, arm, name, kind, power, range]) => ({ id, arm, name, kind, tier: 'common',
  caliber: 'model unspecified', practice: true, power: ph(power), range: ph(range),
  rate: ph(arm === 'infantry' ? 3 : 2), accuracy: ph(50), mods: { melee: 0, drill: 0 },
  effect: { text: 'Practice representation; exact historical model is not established.', src: 'placeholder' } }));

const ARM_BY_ID = Object.fromEntries([...ARMS, ...PRACTICE_ARMS].map((a) => [a.id, a]));
const UNIQUE_BY_ID = Object.fromEntries(UNIQUES.map((u) => [u.id, u]));

/** The full definition of an item id (an arm, or a unique merged over its base arm). */
export function itemDef(itemId) {
  if (ARM_BY_ID[itemId]) return ARM_BY_ID[itemId];
  const u = UNIQUE_BY_ID[itemId];
  if (!u) throw new Error(`reward data: unknown item '${itemId}'`);
  const b = ARM_BY_ID[u.base];
  return {
    ...b,
    id: u.id,
    tier: u.tier,
    name: u.name,
    baseName: b.name,
    kind: b.kind,
    gameItem: true,
    power: { v: b.power.v + u.powerBonus, src: 'placeholder' },
    special: u.special,
    flavour: u.flavour,
    effect: { text: u.special.text, src: 'placeholder' },
  };
}

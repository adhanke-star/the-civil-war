// src/franchise/badges.js: the 20 badges, their tiers, slots, effects and the X-Factor (DESIGN §3 Badges, Badge tiers;
// §4b X-Factor look, Reward feel). Pure logic over plain objects: no DOM, no storage, no field allocation.
//
//   BADGES / BADGE_BY_ID / BADGE_IDS        the catalogue: name, category, feat, effect and a sourced real example
//   FEAT_STATS                              the per-unit battle statistics the field keeps (src/sim/combat.js featsOf)
//   measure(badge, stats) / tierFor(badge, value) / featText(badge, value) / effectText(badge, tier)
//   slotsFor(vet) / slotsOf(brigade)        badge slots by veterancy (Green 1, Trained 2, Veteran 3, Elite 4), +1 bought slot
//   ratingBonus(badges)                     { fire, melee, morale, drill } card-bar points (src/reward/model.js ratings)
//   fieldBadges(list, xfactor) / badgeEffects(defBadges)  the field definition's badges and their combat fractions
//   trainingEffects(training) / trainingText(training)    camp card-bar points on the field (P5d) as combat fractions
//   campEffectLines(def)                    every camp effect on a field definition (P5d), as plain labelled lines
//   validateFeats(feats, units)             a phase's canonical feat statistics (recordPhase input)
//   awardBadges(save, { awardId, feats, loan }) -> { save, summary }   (campaign.js validates the save)
//   keepBadges(brigade, keep)               the player's choice when a brigade has more badges than slots
//   noteAward(summary) / badgeAward(awardId) the after-action's view of what one recorded award earned
//
// Rules (GAME RULES, labelled so in the UI; numbers in src/franchise/tuning.js BADGE_RULES):
// - A badge is earned by one measurable feat in one campaign phase. Bronze is the badge's amount; Silver 2x and Gold 4x
//   of it, in the same phase. A tier is never lost to a weaker phase; a better phase (a replay too) raises it.
// - Franchise brigades earn after a phase that is not on loan. Kept badges fill the brigade's slots (by veterancy). A new
//   badge that finds the slots full waits in the brigade's `offer` until the player chooses which to keep in camp; a
//   veterancy drop that leaves too few slots moves the newest lower badges to the offer the same way.
// - The first Gold on a brigade becomes its X-Factor, once, for good; the X-Factor badge is always kept.
// - The enemy earns too: CS formations' feats are recorded per formation id in the campaign save (`enemy`), every phase,
//   keeping the best tiers that fit the formation's slots by its field experience; they apply when it fights again.
// The real examples are history (provenance and sources on each); their numbers never feed the game rules.
import { BADGE_RULES, CAMP } from './tuning.js';

export { BADGE_RULES };
export const TIERS = Object.freeze(['bronze', 'silver', 'gold']);
export const TIER_NAMES = Object.freeze({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold' });
export const CATEGORIES = Object.freeze([['fire', 'Fire'], ['assault', 'Assault'], ['defence', 'Defence'], ['support', 'Support'], ['batteries', 'Batteries']]);
export const BADGE_RULES_NOTE = 'Badge feats, tiers, slots and effects are game rules; the real examples are history.';
const VETS = Object.freeze(['green', 'trained', 'veteran', 'elite']);
const BARS = Object.freeze(['fire', 'melee', 'morale', 'drill']);
const fail = (message) => { throw new Error(`Badges: ${message}`); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Per-unit battle statistics the field keeps (zero-draw counters; src/sim/combat.js). */
export const FEAT_STATS = Object.freeze(['farKills', 'heldVolley', 'holdingLoss', 'disciplineKills', 'screenKills', 'stormed', 'chargeBreaks',
  'shockBreaks', 'flankKills', 'recharges', 'gunsTaken', 'repulses', 'steadySeconds', 'quickRallies', 'rearGuardKills', 'worksKills',
  'marched', 'woodsKills', 'stores', 'canisterKills']);
/** Battle effect kinds (src/sim/combat.js applies each where it maps). */
export const EFFECT_KINDS = Object.freeze(['fireFar', 'fireClose', 'moraleHold', 'ammo', 'fireLong', 'meleeCover', 'melee', 'meleeShock',
  'fireFlank', 'chargeMorale', 'meleeGuns', 'meleeDefend', 'panic', 'rally', 'fireFallback', 'fireCover', 'fatigue', 'fireWoods',
  'resupply', 'canister']);

const link = (url) => ({ label: new URL(url).hostname.replace(/^www\./, ''), url });
// id, name, category, mark (2-letter emblem), stat (FEAT_STATS), feat wording, bar, combat kind + wording, real example.
const DEFS = [
  ['sharpshooters', 'Sharpshooters', 'fire', 'Ss', 'farKills', 'casualties inflicted by fire from beyond 200 m', 'fire', 'fireFar', 'casualties inflicted beyond 200 m', {
    unit: "Birge's Western Sharpshooters (14th Missouri, later 66th Illinois Infantry), Union",
    event: 'Raised 1861; Fort Donelson, February 1862',
    text: 'Recruits had to hit a target at 200 yards with no three shots more than 10 inches apart, and the regiment carried Dimick target rifles. At Fort Donelson three of its companies reportedly silenced a Confederate battery on the Dover road.',
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://en.wikipedia.org/wiki/66th_Illinois_Infantry_Regiment', 'https://civilwar.whalen-family.org/history/066.html', 'https://www.americanrifleman.org/articles/guns-1864'] }],
  ['firstVolley', 'First Volley', 'fire', 'Fv', 'heldVolley', 'casualties of a first volley fired after Hold Fire with the target within 60 m', 'fire', 'fireClose', 'casualties inflicted within 60 m', {
    unit: "14th Iowa Infantry with the left wing of the 12th Iowa, Tuttle's brigade, Army of the Tennessee (Union)",
    event: "Shiloh, the Hornets' Nest, 6 April 1862",
    text: "Col. William T. Shaw wrote in 1887 that his men lay down and held their fire until the Confederate line was within thirty paces, then the 12th and 14th Iowa fired together into its front. A Confederate account of an attack on the same position says the Union troops reserved their fire until the attackers were about twenty yards away.",
    provenance: 'Inferred', theatre: 'Western',
    sources: ['https://ironbrigader.com/?p=6597', 'https://npshistory.com/publications/civil_war_series/22/sec7.htm', 'https://publications.iowa.gov/37370/7/Report_Shiloh_Battefielf_Commision_1895_OCR_.pdf', 'https://pubs.lib.uiowa.edu/ijh/article/33522/galley/142003/download'] }],
  ['coolUnderFire', 'Cool Under Fire', 'fire', 'Cf', 'holdingLoss', '% of its starting men lost while holding its ground and returning fire', 'morale', 'moraleHold', 'less morale lost to fire while holding its ground', {
    unit: "Col. William B. Hazen's brigade (9th Indiana, 41st Ohio, 6th Kentucky, 110th Illinois), Army of the Cumberland (Union)",
    event: 'Stones River, the Round Forest ("Hell\'s Half-Acre"), 31 December 1862',
    text: "Hazen's brigade held the Round Forest salient while the rest of the Union line was driven back, and repulsed four Confederate assaults supported by massed artillery. It lost 409 men, about 29 percent of those engaged.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://www.battlefields.org/learn/articles/secret-life-hazen-brigade-monument', 'https://www.nps.gov/places/places_hellshalfacre.htm', 'https://en.wikipedia.org/wiki/Hazen_Brigade_Monument'] }],
  ['fireDiscipline', 'Fire Discipline', 'fire', 'Fd', 'disciplineKills', 'casualties inflicted in the 15 s after opening fire from Hold Fire within 60 m', 'drill', 'ammo', 'less ammunition used per volley', {
    unit: "36th Illinois Infantry (Col. Nicholas Greusel), Sill's brigade, Sheridan's division, Army of the Cumberland (Union)",
    event: 'Stones River, morning of 31 December 1862',
    text: "Greusel had his men fix bayonets and hold their fire until ordered, then gave the order to fire when the Confederates were about 50 yards away; the regiment's own report puts the lines not over 10 rods apart.",
    provenance: 'Inferred', theatre: 'Western',
    sources: ['https://historynet.com/battle-of-stones-river-philip-sheridans-rise-to-millitary-fame/', 'https://ironbrigader.com/2013/04/03/36th-illinois-infantry-battle-stones-river/'] }],
  ['skirmishers', 'Skirmishers', 'fire', 'Sk', 'screenKills', 'casualties inflicted from beyond 150 m on a larger formation', 'fire', 'fireLong', 'casualties inflicted beyond 150 m', {
    unit: "1st U.S. Sharpshooters (Berdan's), about 100 men, with the 3rd Maine Infantry, Army of the Potomac (Union)",
    event: "Pitzer's Woods, Gettysburg, 2 July 1863 (an Eastern example)",
    text: "About 100 sharpshooters, backed by the 3rd Maine, advanced into the woods west of the Union line, fought Wilcox's Alabama brigade for roughly forty minutes and withdrew to report Confederate troops massing on Seminary Ridge. How much the fight delayed Wilcox is disputed.",
    provenance: 'Verified', theatre: 'Eastern',
    sources: ['https://www.hmdb.org/m.asp?m=12043', 'https://www.thegettysburgexperience.com/there-goes-berdans-men', 'https://en.wikipedia.org/wiki/Hiram_Berdan', 'https://gettysburgcompiler.org/tag/sharpshooting'] }],
  ['stormers', 'Stormers', 'assault', 'St', 'stormed', 'enemy formations in cover broken by its charge', 'melee', 'meleeCover', 'melee strength against a foe in cover', {
    unit: "Brig. Gen. August Willich's brigade, Wood's division, IV Corps, Army of the Cumberland (Union)",
    event: 'Missionary Ridge, 25 November 1863',
    text: "Ordered only to take the rifle pits at the foot of the ridge, Willich's brigade overran them and kept climbing; a small party crossed the crest breastworks around 5 p.m. and the rest of the brigade followed, breaking the Confederate centre.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://npshistory.com/publications/civil_war_series/9/sec7.htm', 'https://en.wikipedia.org/wiki/Battle_of_Missionary_Ridge', 'https://www.nps.gov/chch/learn/historyculture/missionary-ridge.htm'] }],
  ['coldSteel', 'Cold Steel', 'assault', 'Cs', 'chargeBreaks', 'enemy formations broken within 30 s of its charge reaching them', 'melee', 'melee', 'melee strength when charging', {
    unit: "9th Ohio Infantry, McCook's brigade, Thomas's division, Army of the Ohio (Union)",
    event: 'Mill Springs (Logan\'s Cross Roads), Kentucky, 19 January 1862',
    text: 'With the Confederate attack stalled at close range, Col. Robert L. McCook ordered the 9th Ohio to charge with the bayonet, alongside the 2nd Minnesota and 10th Indiana. McCook and Thomas both report that the Confederate line gave way in disorder and was driven from the field.',
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://ironbrigader.com/2023/01/16/colonel-robert-l-mccooks-report-on-his-brigade-at-the-battle-of-mill-springs-or-logans-crossroads/', 'https://www.worldhistory.org/article/2989/g-h-thomass-account-of-the-battle-of-mill-springs/', 'https://ironbrigader.com/2016/01/18/colonel-mahlon-d-mansons-report-battle-mill-springs-logans-crossroads-january-1862/', 'https://battlefields.org/learn/articles/battle-mill-springs'] }],
  ['shock', 'Shock', 'assault', 'Sh', 'shockBreaks', 'larger enemy formations broken by its charge', 'melee', 'meleeShock', 'morale damage dealt in melee', {
    unit: "9th Ohio Infantry with the 2nd Minnesota, Thomas's division, Army of the Ohio (Union)",
    event: 'Mill Springs (Logan\'s Cross Roads), Kentucky, 19 January 1862',
    text: "The 9th Ohio charged with bayonets into the Confederate flank while the 2nd Minnesota pressed the centre, and the Confederate line broke and fell back to its camp at Beech Grove. The 16th Alabama's counterattack covered the retreat, so the charge was decisive but not a total rout.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://www.nps.gov/misp/turning-tide.htm', 'https://www.battlefields.org/learn/articles/battle-mill-springs', 'https://en.wikipedia.org/wiki/Battle_of_Mill_Springs'] }],
  ['flankers', 'Flankers', 'assault', 'Fl', 'flankKills', "casualties inflicted from an enemy formation's flank or rear", 'melee', 'fireFlank', 'casualties inflicted from a flank or the rear', {
    unit: "Brig. Gen. John McArthur's 1st Division, Detachment Army of the Tennessee, at Nashville (Union)",
    event: "Shy's Hill, Nashville, 16 December 1864",
    text: "After a diversion at Peach Orchard Hill drew Confederate reinforcements away, McArthur's division attacked Shy's Hill on its own initiative at about 3:30 p.m. while Wilson's cavalry worked on the Confederate left and rear. The Confederate left broke and was rolled up, and Hood's army retreated.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://www.battlefields.org/learn/civil-war/battles/nashville', 'https://en.wikipedia.org/wiki/Battle_of_Nashville'] }],
  ['relentless', 'Relentless', 'assault', 'Re', 'recharges', 'charges that reached the enemy again after a charge that failed', 'morale', 'chargeMorale', 'less morale lost in a charge', {
    unit: "Maj. Gen. Francis P. Blair Jr.'s division, XV Corps, Army of the Tennessee (Union)",
    event: 'Stockade Redan, Vicksburg, 19 and 22 May 1863',
    text: "Blair's division assaulted Stockade Redan on 19 May and was repulsed with heavy loss, then attacked the same redan again with Tuttle's division on 22 May and failed again. On 19 May the 1st Battalion, 13th U.S. Infantry reached the ditch and planted its colours on the redan's north face.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://npshistory.com/publications/civil_war_series/24/sec8.htm', 'https://home.nps.gov/vick/learn/historyculture/13th-united-state-infantry-1st-battalion.htm', 'https://www.nps.gov/vick/learn/historyculture/firstassault.htm', 'https://www.hmdb.org/m.asp?m=115799'] }],
  ['gunTakers', 'Gun-takers', 'assault', 'Gt', 'gunsTaken', 'enemy guns taken (a battery broken by its charge or surrendered to it)', 'melee', 'meleeGuns', 'melee strength against a battery', {
    unit: "Col. Charles G. Harker's brigade, Sheridan's division, IV Corps, Army of the Cumberland (Union)",
    event: 'Missionary Ridge, 25 November 1863',
    text: "After the assault carried the ridge, Harker's brigade overran a Confederate battery near Bragg's headquarters on the crest. The sources disagree on the count: four Napoleons (NPS) or five guns (Col. Bullitt's report).",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://npshistory.com/publications/civil_war_series/9/sec7.htm', 'https://ldsgenealogy.com/OH/books/The-story-of-the-Sherman-brigade-The-camp-the-march-the-bivouac-the-battle-and-how-the-boys-lived-and-died-during-four-years-of-active-field-service-part-37.htm', 'https://en.wikipedia.org/wiki/Battle_of_Missionary_Ridge'] }],
  ['rock', 'Rock', 'defence', 'Rk', 'repulses', 'enemy formations that broke within 150 m while it held its ground', 'morale', 'meleeDefend', 'melee strength when standing to receive a charge', {
    unit: "Col. William B. Hazen's brigade, Army of the Cumberland (Union)",
    event: 'Stones River, the Round Forest, 31 December 1862',
    text: "Hazen's brigade held the Round Forest, a small cedar grove by the railroad on the Union left, against repeated Confederate attacks while the rest of the original Union line collapsed. It lost 409 men, about 29 percent of those engaged.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://en.wikipedia.org/wiki/Battle_of_Stones_River', 'https://battlefields.org/learn/articles/secret-life-hazen-brigade-monument'] }],
  ['unshaken', 'Unshaken', 'defence', 'Un', 'steadySeconds', 'seconds holding under fire while flanked or beside a routing friend', 'morale', 'panic', 'less morale lost to flank fire and routing friends', {
    unit: "Col. William B. Hazen's brigade, Palmer's division, Army of the Cumberland (Union)",
    event: 'Stones River, 31 December 1862',
    text: "While the Union right was overrun, Hazen's brigade held the Round Forest under fire from its front and from the neighbouring sector, and was the only part of the original line that did not retreat that day. The sources do not say its own flank was turned; it held while the line beside it collapsed.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://www.nps.gov/stri/learn/historyculture/hellshalfacre.htm', 'https://en.wikipedia.org/wiki/Battle_of_Stones_River', 'https://www.battlefields.org/learn/articles/secret-life-hazen-brigade-monument', 'https://npshistory.com/publications/civil_war_series/23/sec7.htm'] }],
  ['quickRally', 'Quick Rally', 'defence', 'Qr', 'quickRallies', 'rallies within 30 s of breaking', 'morale', 'rally', 'faster rally', {
    unit: "The Right Wing, Army of the Cumberland: Johnson's and Davis's divisions (Union)",
    event: 'Stones River, 31 December 1862',
    text: "Hardee's morning assault drove Johnson's and Davis's divisions back about three miles to the Nashville Pike, where the troops were rallied and Rosecrans re-formed the line backed by massed artillery. The re-formed line held the pike that day.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://en.wikipedia.org/wiki/Battle_of_Stones_River', 'https://home.nps.gov/stri/learn/photosmultimedia/battle_stop3.htm'] }],
  ['rearGuard', 'Rear Guard', 'defence', 'Rg', 'rearGuardKills', 'casualties inflicted while falling back', 'drill', 'fireFallback', 'casualties inflicted while falling back', {
    unit: "Maj. Gen. George H. Thomas's wing, Army of the Cumberland (Union)",
    event: 'Chickamauga, Horseshoe Ridge, 20 September 1863',
    text: "After Rosecrans and much of the army left the field, Thomas's wing held the Horseshoe Ridge line against repeated assaults and withdrew toward Rossville Gap by night, so the army could reach Chattanooga. The withdrawal was not clean: the 21st Ohio, 22nd Michigan and 89th Ohio, left in place short of ammunition, were surrounded and captured.",
    provenance: 'Inferred', theatre: 'Western',
    sources: ['https://npshistory.com/publications/civil_war_series/10/sec7.htm', 'https://en.wikipedia.org/wiki/Battle_of_Chickamauga', 'https://www.nps.gov/chch/learn/historyculture/battle-of-chickamauga.htm'] }],
  ['diggers', 'Diggers', 'defence', 'Dg', 'worksKills', 'casualties inflicted from a fence line or farm buildings', 'drill', 'fireCover', 'casualties inflicted from a fence line or farm buildings', {
    unit: "XIV Corps (Maj. Gen. George H. Thomas), Army of the Cumberland (Union)",
    event: 'Chickamauga, Kelly Field, night of 19-20 September 1863',
    text: "After the first day's fighting, Thomas's corps spent the night felling trees and piling logs into a breastwork east of the LaFayette Road at Kelly Field. On the morning of 20 September these works helped halt Cleburne's division.",
    provenance: 'Inferred', theatre: 'Western', // both sources are NPS publications: one publisher, so not two independent sources
    sources: ['https://www.npshistory.com/handbooks/historical/25/hh25g2.htm', 'https://npshistory.com/publications/civil_war_series/10/sec6.htm'] }],
  ['hardMarchers', 'Hard Marchers', 'support', 'Hm', 'marched', 'metres marched under orders', 'drill', 'fatigue', 'less fatigue gained', {
    unit: "Brig. Gen. William Nelson's 4th Division, Army of the Ohio (Union)",
    event: 'Savannah to Pittsburg Landing, Shiloh, 6 April 1862',
    text: "Ordered from Savannah at 7:15 a.m., Nelson's division started marching about 1:30 p.m., was opposite Pittsburg Landing about 5:30 p.m. and had Ammen's brigade across by 7:30 p.m. It helped hold the Union left that evening and led the counterattack on 7 April.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://jfepperson.org/shiloh.htm', 'https://en.wikipedia.org/wiki/Bull_Nelson', 'https://home.nps.gov/cane/highest-praise-the-army-of-the-ohio-at-shiloh.htm'] }],
  ['woodsmen', 'Woodsmen', 'support', 'Wd', 'woodsKills', 'casualties inflicted from woods', 'fire', 'fireWoods', 'casualties inflicted from woods', {
    unit: "King's brigade of U.S. Regulars, XIV Corps, Army of the Cumberland (Union)",
    event: 'Chickamauga, morning of 19 September 1863',
    text: "The army's only all-regular brigade advanced about three-quarters of a mile through dense forest where sight lines were under about 50 paces and, by Brig. Gen. John King's report, broke the 9th Texas and took about 200 prisoners. Confederate counterattacks later overran part of the brigade and its battery.",
    provenance: 'Inferred', theatre: 'Western',
    sources: ['https://historynet.com/battle-of-chickamauga-union-regulars-desperate-stand/', 'https://npshistory.com/publications/civil_war_series/10/sec4.htm', 'https://www.hmdb.org/m.asp?m=137961'] }],
  ['foragers', 'Foragers', 'support', 'Fo', 'stores', 'field stores taken', 'morale', 'resupply', 'faster ammunition resupply', {
    unit: "Brigade foraging parties of Maj. Gen. W. T. Sherman's armies (Union)",
    event: 'The March to the Sea, Georgia, November-December 1864',
    text: "Special Field Orders No. 120 told each brigade commander to organise a foraging party so the army could feed itself from the country on its march through Georgia. Sherman admitted these parties committed many acts of pillage and violence; the system harmed civilians, including enslaved people, and was deliberate economic warfare.",
    provenance: 'Verified', theatre: 'Western',
    sources: ['https://en.wikipedia.org/wiki/Sherman%27s_March_to_the_Sea', 'https://ironbrigader.com/2025/10/23/general-william-t-sherman-recalls-how-his-army-foraged-for-food-on-the-march-to-the-sea/', 'https://www.gutenberg.org/ebooks/5853'] }],
  ['canister', 'Canister', 'batteries', 'Ca', 'canisterKills', 'casualties inflicted with canister (150 yd or less)', 'fire', 'canister', 'canister casualties', {
    unit: 'Massed Union artillery under Capt. John Mendenhall, Left Wing, Army of the Cumberland (the 3rd Wisconsin Battery among them)',
    event: "Stones River, McFadden's Ford, 2 January 1863",
    text: "Mendenhall massed 45 to 58 guns (the sources disagree) hub to hub on high ground east of the river and opened fire when Breckinridge's attackers were about 90 yards from the Union front line. The Confederate division lost roughly 1,800 men in about an hour; the NPS describes the fire as shot, shell and canister.",
    provenance: 'Inferred', theatre: 'Western',
    sources: ['https://npshistory.com/publications/civil_war_series/23/sec9.htm', 'https://home.nps.gov/stri/learn/photosmultimedia/battle_stop6.htm', 'https://ironbrigader.com/?p=10891', 'https://www.battlefields.org/learn/battles/stones-river'] }],
];

function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}
export const BADGES = frozen(DEFS.map(([id, name, category, mark, stat, feat, bar, combat, combatText, ex]) => ({
  id, name, category, mark, stat, feat, bronze: BADGE_RULES.bronze[id], effect: { bar, combat, text: combatText },
  example: { ...ex, sources: ex.sources.map(link) } })));
export const BADGE_IDS = Object.freeze(BADGES.map((b) => b.id));
export const BADGE_BY_ID = Object.freeze(Object.fromEntries(BADGES.map((b) => [b.id, b])));
export const categoryName = (id) => (CATEGORIES.find(([c]) => c === id) || [id, id])[1];
const rank = (tier) => TIERS.indexOf(tier);

/** The phase amount of one badge's feat from a unit's statistics (Cool Under Fire is a share of starting men). */
export function measure(badge, stats) {
  const v = Number(stats?.[badge.stat]) || 0;
  if (badge.stat === 'holdingLoss') return stats.menStart > 0 ? Math.floor((100 * v) / stats.menStart) : 0;
  return Math.floor(v);
}
/** The tier one phase's amount reaches (null below Bronze). */
export function tierFor(badge, value) {
  let out = null;
  for (const t of TIERS) if (value >= badge.bronze * BADGE_RULES.tierFactor[t]) out = t;
  return out;
}
/** Amount needed for a tier. */
export const threshold = (badge, tier) => badge.bronze * BADGE_RULES.tierFactor[tier];
/** "74 casualties inflicted by fire from beyond 200 m" (the feat stamped on the card). */
export function featText(badge, value) {
  if (badge.stat === 'holdingLoss') return `${value}${badge.feat}`;
  return `${Number(value).toLocaleString('en-US')} ${badge.feat}`;
}
/** The game rule a badge gives at a tier: "+3 Fire; in battle +3% casualties inflicted beyond 200 m". */
export function effectText(badge, tier) {
  const i = Math.max(0, rank(tier)), bar = badge.effect.bar;
  return `+${BADGE_RULES.points[i]} ${bar[0].toUpperCase()}${bar.slice(1)} on the card; in battle +${BADGE_RULES.combat[i]}% ${badge.effect.text}`;
}
/** Badge slots by veterancy. */
export function slotsFor(vet) {
  if (!has(BADGE_RULES.slots, vet)) fail('unknown veterancy.');
  return BADGE_RULES.slots[vet];
}
/** A brigade's badge slots: by veterancy, +1 for a bought extra slot (`extraSlot`, src/franchise/economy.js buySlot). */
export const slotsOf = (brigade) => slotsFor(brigade.vet) + (brigade.extraSlot === true ? 1 : 0);
/** Card-bar points from kept badges (src/reward/model.js ratings). */
export function ratingBonus(badges) {
  const out = { fire: 0, melee: 0, morale: 0, drill: 0 };
  if (!Array.isArray(badges)) return out;
  for (const b of badges) {
    const def = BADGE_BY_ID[b?.id], i = rank(b?.tier);
    if (def && i >= 0) out[def.effect.bar] += BADGE_RULES.points[i];
  }
  return out;
}
/** A field definition's badges: [{ id, tier, xfactor? }] from kept badges and the X-Factor id (src/franchise/campaign.js). */
export const fieldBadges = (list, xfactor) => list.map((b) => ({ id: b.id, tier: b.tier, ...(b.id === xfactor ? { xfactor: true } : {}) }));
/**
 * Combat fractions for a field definition's badges ({ kind: fraction } plus `xfactor: { kind, fraction }`), or null when
 * there are none or the list is not a valid field badge list (an unknown list never changes a battle).
 */
export function badgeEffects(list) {
  if (!Array.isArray(list) || !list.length || list.length > 5) return null; // Elite 4 slots + one bought extra slot
  const out = {};
  let xf = null;
  for (const b of list) {
    const def = b && BADGE_BY_ID[b.id], i = rank(b?.tier);
    if (!def || i < 0) return null;
    const f = BADGE_RULES.combat[i] / 100;
    out[def.effect.combat] = (out[def.effect.combat] || 0) + f;
    if (b.xfactor === true && !xf) xf = { kind: def.effect.combat, fraction: f * BADGE_RULES.xfactor.share, id: def.id };
  }
  if (xf) out.xfactor = xf;
  return out;
}

/**
 * Camp training on the card (P5d: camp orders and bought training, a brigade's `bonus` points; the field definition's
 * `training`) as combat fractions through the same path as badge effects: { fire, reload, melee, morale } at
 * CAMP.battle.perPoint % per point (src/sim/combat.js applies each: fire effect, reload and wheeling speed, melee strength,
 * morale lost under fire), or null for no training (an unknown list never changes a battle). Game rules, labelled so.
 */
export function trainingEffects(training) {
  if (!training || typeof training !== 'object' || Array.isArray(training)) return null;
  const f = CAMP.battle.perPoint / 100, out = {};
  const keys = { fire: 'fire', drill: 'reload', melee: 'melee', morale: 'morale' };
  for (const k of Object.keys(training)) {
    const n = training[k];
    if (!has(keys, k) || !Number.isSafeInteger(n) || n < 0 || n > 50) return null;
    if (n > 0) out[keys[k]] = n * f;
  }
  return Object.keys(out).length ? out : null;
}
/** "+3% fire effect, +2% faster reload and wheeling" for a definition's training (empty for none). */
export function trainingText(training) {
  const fx = trainingEffects(training);
  if (!fx) return '';
  const pct = (v) => `+${Math.round(v * 100)}%`;
  return [fx.fire ? `${pct(fx.fire)} fire effect` : '', fx.reload ? `${pct(fx.reload)} faster reload and wheeling` : '',
    fx.melee ? `${pct(fx.melee)} melee` : '', fx.morale ? `${pct(fx.morale).replace('+', '−')} morale lost under fire` : ''].filter(Boolean).join(', ');
}

/**
 * What reached the battle from camp for one field definition (P5d game rules; src/franchise/campaign.js applyCampaign writes
 * the fields): "Effect: detail" lines for the unit card and the after-action; [] for a definition without any.
 */
export function campEffectLines(def) {
  if (!def || typeof def !== 'object') return [];
  const out = [], training = trainingText(def.training);
  if (training) out.push(`Camp training: ${training}`);
  if (Number.isFinite(def.fatigue) && def.fatigue > 0) out.push(`Short of shoes: started tired (fatigue ${Math.round(def.fatigue)} of 100)`);
  if (Number.isFinite(def.ammo) && def.ammo < 100) out.push(`Short of ammunition: started with ${Math.round(def.ammo)}% of its rounds (refilled slowly out of contact)`);
  if (Number.isFinite(def.limber) && def.limber > 0) out.push(`Short of horses: limbers and unlimbers ${Math.round(def.limber)} s more slowly`);
  if (def.pioneers === true) out.push(`Pioneers: through woods at ${Math.round(CAMP.upgrades.pioneers.woods * 100)}% pace (70% without)`);
  return out;
}

// ---- phase feats --------------------------------------------------------------------------------------------------------
const FEAT_LIMIT = 10000000;
/** Canonical feat statistics of one phase: { [unitId]: { side, xp, menStart, ...FEAT_STATS } } for units of the result. */
export function validateFeats(feats, units) {
  if (!feats || typeof feats !== 'object' || Array.isArray(feats) || ![Object.prototype, null].includes(Object.getPrototypeOf(feats))) fail('feats must be an object.');
  const known = new Map(units.map((u) => [u.id, u]));
  const out = {};
  for (const id of Object.keys(feats).sort()) {
    const f = feats[id], u = known.get(id);
    if (!u) fail('feats name a formation that is not in the result.');
    if (!f || typeof f !== 'object' || Array.isArray(f)) fail('invalid feat statistics.');
    const keys = ['side', 'xp', 'menStart', ...FEAT_STATS];
    if (Object.keys(f).some((k) => !keys.includes(k)) || keys.some((k) => !has(f, k))) fail('feat statistics have missing or unsupported fields.');
    if (f.side !== u.side || !Number.isSafeInteger(f.xp) || f.xp < 1 || f.xp > 4 || f.menStart !== u.menStart) fail('feat statistics do not match their formation.');
    const row = { side: f.side, xp: f.xp, menStart: f.menStart };
    for (const k of FEAT_STATS) {
      if (!Number.isSafeInteger(f[k]) || f[k] < 0 || f[k] > FEAT_LIMIT) fail(`invalid feat statistic ${k}.`);
      row[k] = f[k];
    }
    out[id] = row;
  }
  return out;
}

// ---- awards -----------------------------------------------------------------------------------------------------------
const entry = (id, tier, awardId, feat) => ({ id, tier, awardId, feat });
/** Better first, then the badge earned earlier (catalogue order breaks ties). */
const order = (a, b) => rank(b.tier) - rank(a.tier) || BADGE_IDS.indexOf(a.id) - BADGE_IDS.indexOf(b.id);
/** Tiers one formation's statistics reach this phase: [{ id, tier, feat }] in catalogue order. */
export function earnedTiers(stats) {
  const out = [];
  for (const b of BADGES) { const v = measure(b, stats), t = tierFor(b, v); if (t) out.push({ id: b.id, tier: t, feat: v }); }
  return out;
}

/** Keep `slots` badges: the X-Factor always; then the badges already kept (best first); the rest go to the offer. */
function fit(kept, offer, slots, xfactor) {
  if (kept.length <= slots) return { kept, offer };
  const pinned = kept.filter((b) => b.id === xfactor), rest = kept.filter((b) => b.id !== xfactor).sort(order);
  const keep = [...pinned, ...rest].slice(0, slots), moved = kept.filter((b) => !keep.includes(b));
  return { kept: kept.filter((b) => keep.includes(b)), offer: [...offer, ...moved] };
}

/**
 * One franchise brigade after a phase: tiers raised in place (kept or waiting), new badges kept while slots allow, then
 * offered; the first Gold becomes the X-Factor (moved into the kept badges if it waited). Returns { brigade, earned, xfactor }.
 */
function awardBrigade(b, stats, awardId) {
  let kept = [...(b.badges || [])], offer = [...(b.offer || [])];
  const earned = [];
  let xfactor = b.xfactor ?? null, newX = null;
  for (const e of stats ? earnedTiers(stats) : []) {
    const inKept = kept.find((x) => x.id === e.id), inOffer = offer.find((x) => x.id === e.id), old = inKept || inOffer;
    if (old && rank(old.tier) >= rank(e.tier)) continue;
    const next = entry(e.id, e.tier, awardId, e.feat);
    if (inKept) kept = kept.map((x) => (x === inKept ? next : x));
    else if (inOffer) offer = offer.map((x) => (x === inOffer ? next : x));
    else if (kept.length < slotsOf(b)) kept.push(next);
    else offer.push(next);
    earned.push({ id: e.id, tier: e.tier, from: old ? old.tier : null, feat: e.feat });
    if (!xfactor && e.tier === 'gold') { xfactor = e.id; newX = e.id; }
  }
  if (newX && offer.some((x) => x.id === newX)) { kept = [...kept, offer.find((x) => x.id === newX)]; offer = offer.filter((x) => x.id !== newX); }
  ({ kept, offer } = fit(kept, offer, slotsOf(b), xfactor));
  const out = { ...b };
  delete out.badges; delete out.offer; delete out.xfactor; delete out.ovr;
  if (kept.length) out.badges = kept;
  if (offer.length) out.offer = offer;
  if (xfactor) out.xfactor = xfactor;
  return { brigade: out, earned: earned.map((e) => ({ ...e, kept: kept.some((x) => x.id === e.id) })), xfactor: newX };
}

/** Enemy formations keep their best tiers up to their slots (by field experience); the X-Factor is always kept. */
function awardEnemy(prior, stats, awardId) {
  const slots = slotsFor(VETS[stats.xp - 1]);
  let list = [...(prior?.badges || [])], xfactor = prior?.xfactor ?? null, newX = null;
  const earned = [];
  for (const e of earnedTiers(stats)) {
    const old = list.find((x) => x.id === e.id);
    if (old && rank(old.tier) >= rank(e.tier)) continue;
    list = old ? list.map((x) => (x === old ? entry(e.id, e.tier, awardId, e.feat) : x)) : [...list, entry(e.id, e.tier, awardId, e.feat)];
    earned.push({ id: e.id, tier: e.tier, from: old ? old.tier : null, feat: e.feat });
    if (!xfactor && e.tier === 'gold') { xfactor = e.id; newX = e.id; }
  }
  const pinned = list.filter((x) => x.id === xfactor), rest = list.filter((x) => x.id !== xfactor).sort(order);
  const keep = new Set([...pinned, ...rest].slice(0, Math.max(slots, pinned.length)));
  list = list.filter((x) => keep.has(x));
  return { record: list.length ? { badges: list, ...(xfactor ? { xfactor } : {}) } : null,
    earned: earned.filter((e) => list.some((x) => x.id === e.id)), xfactor: newX };
}

/**
 * Badges for one recorded phase (save is the validated save recordPhase built, before requisition points). Franchise
 * brigades earn when the phase was not on loan; enemy formations always. Returns the next save (not validated) and the
 * after-action summary (also kept for badgeAward). A brigade or formation without feats is unchanged.
 */
export function awardBadges(save, { awardId, feats, loan = false }) {
  const brigades = [], enemyRows = [];
  const army = save.army.map((b) => {
    const found = !loan && b.unitId && feats[b.unitId], stats = found && found.side === 'US' ? found : null;
    // A brigade without feats still re-fits its badges to its slots (a veterancy drop this phase).
    if (!stats && !(b.badges || []).length) return b;
    const r = awardBrigade(b, stats, awardId);
    if (r.earned.length || r.xfactor) brigades.push({ id: b.id, label: b.label, earned: r.earned, xfactor: r.xfactor, offer: (r.brigade.offer || []).length,
      slots: slotsOf(b) });
    return r.brigade;
  });
  // Formations of the franchise army are never enemy formations (a loan phase's Union units are not recorded either).
  const franchise = new Set(save.army.map((b) => b.unitId).filter(Boolean));
  const enemy = { ...(save.enemy || {}) };
  for (const id of Object.keys(feats).sort()) {
    const stats = feats[id];
    if (stats.side !== 'CS' || franchise.has(id)) continue;
    const r = awardEnemy(enemy[id], stats, awardId);
    if (r.record) enemy[id] = r.record; else delete enemy[id];
    if (r.earned.length) enemyRows.push({ id, earned: r.earned, xfactor: r.xfactor });
  }
  const next = { ...save, army };
  delete next.enemy;
  if (Object.keys(enemy).length) next.enemy = Object.fromEntries(Object.keys(enemy).sort().map((k) => [k, enemy[k]]));
  // Each brigade's badges after this award, for its cards in the after-action (display only).
  const cards = Object.fromEntries(army.filter((b) => b.badges || b.offer).map((b) => [b.id,
    { badges: b.badges || [], ...(b.offer ? { offer: b.offer } : {}), ...(b.xfactor ? { xfactor: b.xfactor } : {}) }]));
  const summary = frozen({ awardId, loan: loan === true, brigades, enemy: enemyRows, cards, note: BADGE_RULES_NOTE });
  return { save: next, summary };
}

/** The player's choice: keep exactly these badge ids (at most the slots; the X-Factor must stay); the rest are let go. */
export function keepBadges(brigade, keep) {
  if (!Array.isArray(keep) || keep.some((id) => typeof id !== 'string') || new Set(keep).size !== keep.length) fail('choose badges by id, once each.');
  const all = [...(brigade.badges || []), ...(brigade.offer || [])];
  if (!all.length) fail('this brigade has no badges to choose from.');
  if (keep.some((id) => !all.some((b) => b.id === id))) fail('that badge is not this brigade\'s to keep.');
  const slots = slotsOf(brigade);
  if (keep.length > slots) fail(`${brigade.label} has ${slots} badge slot${slots === 1 ? '' : 's'}.`);
  if (brigade.xfactor && !keep.includes(brigade.xfactor)) fail('the X-Factor badge is always kept.');
  const out = { ...brigade };
  delete out.badges; delete out.offer; delete out.ovr;
  const kept = all.filter((b) => keep.includes(b.id));
  if (kept.length) out.badges = kept;
  return out;
}

// ---- the after-action's view of a recorded award (bounded; same page only) -------------------------------------------
const AWARDS = new Map();
/** Remember what one recorded award earned (campaign.js recordPhase); the reward sequence reads it by award id. */
export function noteAward(summary) {
  if (!summary || typeof summary.awardId !== 'string') return;
  AWARDS.delete(summary.awardId);
  AWARDS.set(summary.awardId, summary);
  while (AWARDS.size > 8) AWARDS.delete(AWARDS.keys().next().value);
}
/** What a recorded award earned on this page, with every brigade's badges after it (null when unknown or empty). */
export function badgeAward(awardId) {
  const s = AWARDS.get(awardId);
  return s && (s.brigades.length || s.enemy.length || Object.keys(s.cards).length) ? s : null;
}
export { VETS, BARS };

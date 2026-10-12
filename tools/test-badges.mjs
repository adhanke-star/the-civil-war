// CPU check: badges, tiers, slots and the X-Factor (src/franchise/badges.js, tuning.js BADGE_RULES), the per-unit feat
// statistics the field keeps (src/sim/combat.js featsOf, src/units/unit.js march, src/game.js featReport), badge effects
// in the ratings (src/reward/model.js) and in combat, the v2 save fields (src/franchise/save.js) and the campaign bridge
// (practice.js phaseOutcome feats, campaign.js recordPhase / applyCampaign / chooseBadges). Fictional fields on flat
// ground and a fictional campaign are built here; nothing ships for them and nothing is written to disk.
// `node tools/test-badges.mjs` prints BADGES OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail that check, with the check's own name in the failure text. No browser, no GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import * as badges from '../src/franchise/badges.js';
import * as campaign from '../src/franchise/campaign.js';
import * as save from '../src/franchise/save.js';
import { phaseOutcome } from '../src/franchise/practice.js';
import { ratings } from '../src/reward/model.js';
import { featStats } from '../src/sim/combat.js';

RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';
const copy = structuredClone;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const API = { ...badges, ...campaign, ...save, phaseOutcome, ratings, report: (g) => g.featReport(), featStats };

// ---- fictional fields ----------------------------------------------------------------------------------------------------
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 1500, weapon: 'rifled', xp: 2,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });
const far = (id, side) => def(id, side, side === 'US' ? -1700 : 1700, side === 'US' ? -1700 : 1700); // keeps a side in the field
/** A fictional field (Henry Hill rules: neither side breaks while it has an unbroken brigade); the AI orders nobody. */
function field(defs, extra = {}) {
  const s = { id: 'henry-hill', title: 'Fictional badges CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '18:00',
    units: defs, sites: [], woods: [], objective: { name: 'Fictional remote point', x: 1900, z: -1900, r: 30 }, ...extra };
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  for (const u of g.units) u.manual = true;
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);
const run = (g, s) => { for (let k = 0; k < Math.round(s / 0.05); k++) g.tick(0.05); };
const quiet = (g, ...ids) => { for (const id of ids) unit(g, id).holdFire = true; };
const WOOD = (x0, z0, x1, z1) => ({ polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });

/** Each fixture returns the statistics of its formation of interest, after a short fictional fight. */
const FIXTURES = {
  long(api) { const g = field([def('us', 'US', 0, -250), def('cs', 'CS', 0, 0, { men: 2500 })]); quiet(g, 'cs'); run(g, 30); return api.report(g).us; },
  close(api) { const g = field([def('us', 'US', 0, -100), def('cs', 'CS', 0, 0, { men: 2500 })]); quiet(g, 'cs'); run(g, 30); return { ...api.report(g).us, hit: unit(g, 'cs').casualties }; },
  held(api) {
    const g = field([def('us', 'US', 0, -50), def('cs', 'CS', 0, 0)]); quiet(g, 'us', 'cs'); run(g, 2);
    unit(g, 'us').holdFire = false; run(g, 20); return api.report(g).us;
  },
  cool(api) { const g = field([def('us', 'US', 0, -100), def('cs', 'CS', 0, 0)]); run(g, 20); return api.report(g).us; },
  flank(api) { const g = field([def('us', 'US', -250, 0, { facing: Math.PI / 2 }), def('cs', 'CS', 0, 0)]); quiet(g, 'cs'); run(g, 20); return api.report(g).us; },
  fallback(api) {
    const g = field([def('us', 'US', 0, -150), def('cs', 'CS', 0, 0)]); run(g, 1);
    g.select(unit(g, 'us')); g.orderSelected('fallback'); run(g, 25); return api.report(g).us;
  },
  woods(api) { const g = field([def('us', 'US', 0, -120), def('cs', 'CS', 0, 0)], { woods: [WOOD(-300, -200, 300, -60)] }); quiet(g, 'cs'); run(g, 20); return api.report(g).us; },
  works(api) { const g = field([def('us', 'US', 0, -120), def('cs', 'CS', 0, 0)], { sites: [{ x: 0, z: -120 }] }); quiet(g, 'cs'); run(g, 20); return api.report(g).us; },
  canister(api) {
    const g = field([def('us', 'US', 0, -100, { type: 'artillery', men: 100, guns: 6, weapon: 'napoleon' }), far('usr', 'US'), def('cs', 'CS', 0, 0)]);
    quiet(g, 'cs'); run(g, 40); return api.report(g).us;
  },
  stormed(api) {
    const g = field([def('us', 'US', 0, -60, { xp: 4 }), def('cs', 'CS', 0, 0, { men: 500, xp: 1, morale: 30 }), far('csr', 'CS')], { woods: [WOOD(-300, -30, 300, 120)] });
    quiet(g, 'cs'); const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 40);
    return api.report(g).us;
  },
  shock(api) {
    const g = field([def('us', 'US', 0, -60, { men: 700, xp: 4 }), def('cs', 'CS', 0, 0, { men: 900, xp: 1, morale: 22 }), far('csr', 'CS')]);
    quiet(g, 'cs'); const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 40);
    return api.report(g).us;
  },
  guns(api) {
    const g = field([def('us', 'US', 0, -60, { xp: 4 }), def('cs', 'CS', 0, 0, { type: 'artillery', men: 60, guns: 4, weapon: 'napoleon', morale: 25 }), far('csr', 'CS')]);
    quiet(g, 'cs'); const u = unit(g, 'us'); g.order(u, { type: 'charge', points: [[u.x, u.z], [0, 0]], target: unit(g, 'cs') }); run(g, 40);
    return api.report(g).us;
  },
  repulse(api) {
    const g = field([def('us', 'US', 0, -100), def('cs', 'CS', 0, 0), far('csr', 'CS')]); quiet(g, 'us', 'cs'); run(g, 1);
    g.combat.rout(unit(g, 'cs'), true); run(g, 1); return api.report(g).us;
  },
  unshaken(api) {
    const g = field([def('us', 'US', 0, -150), def('usb', 'US', 120, -150), def('cs', 'CS', 0, 0)]); quiet(g, 'us', 'usb'); run(g, 1);
    g.combat.rout(unit(g, 'usb'), true); run(g, 10); return api.report(g).us;
  },
  rally(api) {
    const g = field([def('us', 'US', 0, -600), far('usr', 'US'), def('cs', 'CS', 0, 600)]);
    g.combat.rout(unit(g, 'us'), true); run(g, 15); return api.report(g).us;
  },
  march(api) {
    const g = field([def('us', 'US', 0, -900), def('cs', 'CS', 1500, 1500)]); const u = unit(g, 'us');
    g.order(u, { type: 'move', points: [[0, -900], [0, 0]] }); run(g, 260); return api.report(g).us;
  },
  stores(api) {
    const g = field([def('us', 'US', 0, -600), def('cs', 'CS', 1500, 1500)], { crates: [{ id: 'stores', name: 'Fictional stores', tier: 'common', x: 0, z: -600, r: 60 }] });
    run(g, 4); return api.report(g).us;
  },
  relentless(api) {
    // The charge bookkeeping on real units: contact, a charge that ends with its foe unbroken, then contact again.
    const g = field([def('us', 'US', 0, -60), def('cs', 'CS', 0, 0)]); const a = unit(g, 'us'), b = unit(g, 'cs');
    g.combat.chargeFeat(a, b, 0, 1); g.combat.chargeEpisodes(3); g.combat.chargeFeat(a, b, 0, 5); return api.report(g).us;
  },
};
// Which fixture shows each badge's feat (the 20 badges, once each).
const SHOWN = { sharpshooters: 'long', firstVolley: 'held', coolUnderFire: 'cool', fireDiscipline: 'held', skirmishers: 'long', stormers: 'stormed',
  coldSteel: 'stormed', shock: 'shock', flankers: 'flank', relentless: 'relentless', gunTakers: 'guns', rock: 'repulse', unshaken: 'unshaken',
  quickRally: 'rally', rearGuard: 'fallback', diggers: 'works', hardMarchers: 'march', woodsmen: 'woods', foragers: 'stores', canister: 'canister' };

// ---- a fictional campaign ----------------------------------------------------------------------------------------------
const CAMPAIGN = { version: 1, id: 'test-badges', title: 'Fictional badges test campaign', franchise: [
  { unitId: 'alpha', label: 'Test brigade (fictional)', kind: 'infantry', men: 2000, weapon: 'm1842', vet: 'trained' },
  { unitId: 'bravo', label: 'Test battery (fictional)', kind: 'battery', men: 100, guns: 4, weapon: 'sixPdr', vet: 'green' }],
phases: [{ packId: 'pa', phaseId: 'a1', loan: true }, { packId: 'pa', phaseId: 'a2' }, { packId: 'pb', phaseId: 'b1' }] };
const zero = () => Object.fromEntries(badges.FEAT_STATS.map((k) => [k, 0]));
const stats = (side, menStart, o = {}, xp = 2) => ({ side, xp, menStart, ...zero(), ...o });
const UNITS = [{ id: 'alpha', side: 'US', menStart: 2000, men: 1900 }, { id: 'bravo', side: 'US', menStart: 100, men: 100, gunsStart: 4, guns: 4 },
  { id: 'reb', side: 'CS', menStart: 2500, men: 2300 }];
const fresh = (api) => api.newCampaign({ campaign: CAMPAIGN, slot: 1, seed: 1862, at: '2026-10-11T12:00:00Z' });
/** Record the next phase (or a replay) with the given feats. */
function play(api, s, feats, { replay = false, units = UNITS, grade = 'Draw' } = {}) {
  const p = api.campaignPhase(s, CAMPAIGN, { replay });
  return api.recordPhase(s, CAMPAIGN, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade, held: false,
    units, loot: [], feats });
}
const B = badges.BADGE_RULES.bronze;
const brigade = (s, id) => s.army.find((b) => b.id === id);
function refuses(name, run, pattern) {
  let error = null;
  try { run(); } catch (e) { error = e; }
  assert.ok(error, `${name}: accepted what it must refuse (${pattern})`);
  assert.match(String(error.message), pattern, `${name}: wrong refusal "${error.message}"`);
}
const DESIGN = { fire: ['Sharpshooters', 'First Volley', 'Cool Under Fire', 'Fire Discipline', 'Skirmishers'],
  assault: ['Stormers', 'Cold Steel', 'Shock', 'Flankers', 'Relentless', 'Gun-takers'], defence: ['Rock', 'Unshaken', 'Quick Rally', 'Rear Guard', 'Diggers'],
  support: ['Hard Marchers', 'Woodsmen', 'Foragers'], batteries: ['Canister'] };
const ABBREV = /\b(?:Col|Gen|Brig|Maj|Capt|Lt|Pvt|No|U\.S|a\.m|p\.m|Jr|Sr|St|Mt|vs|e\.g|i\.e|[A-Z])\./g;
/** The first casualties a shooter's first volley does (fictional 250 m fight), with the shooter's field badges. */
function firstVolley(api, shooterBadges, { friendBadges = null, gap = 150 } = {}) {
  const defs = [def('us', 'US', 0, -250, shooterBadges ? { badges: shooterBadges } : {}), def('cs', 'CS', 0, 0, { men: 2500 })];
  if (friendBadges) defs.push(def('xf', 'US', gap, -260, { badges: friendBadges }));
  const g = field(defs); quiet(g, 'cs', ...(friendBadges ? ['xf'] : []));
  const u = unit(g, 'us'), t = unit(g, 'cs');
  for (let k = 0; k < 400 && !u.shots; k++) g.tick(0.05);
  return t.casualties;
}

export const BADGE_CHECKS = [
  ['catalogue', (api) => {
    assert.equal(api.BADGES.length, 20, 'catalogue: there must be exactly 20 badges');
    for (const [cat, names] of Object.entries(DESIGN)) {
      assert.deepEqual(api.BADGES.filter((b) => b.category === cat).map((b) => b.name), names, `catalogue: ${cat} badges differ from DESIGN §3`);
    }
    assert.equal(new Set(api.BADGES.map((b) => b.stat)).size, 20, 'catalogue: every badge needs its own feat statistic');
    for (const b of api.BADGES) {
      assert.ok(api.FEAT_STATS.includes(b.stat) && api.EFFECT_KINDS.includes(b.effect.combat) && ['fire', 'melee', 'morale', 'drill'].includes(b.effect.bar),
        `catalogue: ${b.id} has an unknown statistic, effect or bar`);
      assert.ok(Number.isSafeInteger(b.bronze) && b.bronze > 0 && /^[A-Z][a-z]$/.test(b.mark), `catalogue: ${b.id} needs a positive Bronze amount and a 2-letter mark`);
    }
  }],
  ['examples', (api) => {
    for (const b of api.BADGES) {
      const ex = b.example;
      assert.ok([ex.unit, ex.event, ex.text].every((t) => typeof t === 'string' && t.trim().length > 10), `examples: ${b.id} needs a unit, an event and its text`);
      const sentences = ex.text.replace(ABBREV, 'X').split(/[.!?](?=\s|$)/).filter((x) => x.trim()).length;
      assert.ok(sentences >= 1 && sentences <= 2 && ex.text.length <= 480, `examples: ${b.id} text must be 1-2 sentences (${sentences}, ${ex.text.length} chars)`);
      assert.ok(['Verified', 'Inferred', 'Disputed'].includes(ex.provenance), `examples: ${b.id} provenance ${ex.provenance}`);
      assert.ok(ex.sources.length >= 1 && ex.sources.every((s) => /^https:\/\/[^\s]+$/.test(s.url) && s.label), `examples: ${b.id} sources must be https links`);
      const hosts = new Set(ex.sources.map((s) => new URL(s.url).hostname.replace(/^(www|home)\./, '')));
      assert.ok(ex.provenance !== 'Verified' || hosts.size >= 2, `examples: ${b.id} is Verified with ${hosts.size} independent source(s)`);
    }
  }],
  ['tiers', (api) => {
    for (const b of api.BADGES) {
      const n = b.bronze;
      assert.deepEqual([n - 1, n, 2 * n - 1, 2 * n, 4 * n - 1, 4 * n].map((v) => api.tierFor(b, v)), [null, 'bronze', 'bronze', 'silver', 'silver', 'gold'],
        `tiers: ${b.id} must be Bronze at ${n}, Silver at 2x and Gold at 4x`);
    }
    assert.equal(api.measure(api.BADGE_BY_ID.coolUnderFire, stats('US', 2000, { holdingLoss: 250 })), 12, 'tiers: Cool Under Fire is measured as a share of starting men');
    assert.deepEqual([1, 2, 3, 4].map((x) => api.slotsFor(['green', 'trained', 'veteran', 'elite'][x - 1])), [1, 2, 3, 4], 'tiers: slots by veterancy');
  }],
  ['feat-detection', (api) => {
    const seen = {};
    for (const [badge, fixture] of Object.entries(SHOWN)) {
      seen[fixture] ||= FIXTURES[fixture](api);
      const b = api.BADGE_BY_ID[badge], v = api.measure(b, seen[fixture]);
      assert.ok(v > 0, `feat-detection: ${b.name} (${b.stat}) was not detected in the "${fixture}" fixture`);
    }
    assert.equal(Object.keys(SHOWN).length, 20, 'feat-detection: every badge needs a fixture');
    const close = FIXTURES.close(api);
    assert.ok(close.hit > 0 && close.farKills === 0 && close.screenKills === 0 && close.canisterKills === 0 && close.marched === 0,
      `feat-detection: a 100 m fire fight must not count long-range, canister or march feats (${JSON.stringify(close)})`);
    assert.ok(seen.long.heldVolley === 0 && seen.long.flankKills === 0, 'feat-detection: open fire at 250 m from the front is not a held volley or flank fire');
  }],
  ['zero-rng', (api) => {
    const go = (read) => {
      const g = field([def('us', 'US', 0, -150), def('cs', 'CS', 0, 0, { men: 2500 })]);
      let draws = 0;
      const gr = g.rnd; g.rnd = () => { draws++; return gr(); };
      const urs = g.units.map((u) => u.rnd); g.units.forEach((u, k) => { u.rnd = () => { draws++; return urs[k](); }; });
      // Combat keeps the game stream it was built with: count through it too.
      const cr = g.combat.rnd; g.combat.rnd = () => { draws++; return cr(); };
      for (let k = 0; k < 400; k++) { g.tick(0.05); if (read) { api.report(g); for (const u of g.units) api.featStats(u); } }
      return { draws, state: g.units.map((u) => [u.men, u.morale, u.x, u.z, u.ammo, u.fatigue, u.state]), cs: unit(g, 'cs').casualties };
    };
    const a = go(false), b = go(true);
    assert.ok(a.cs > 0, 'zero-rng: the fixture must fight');
    assert.deepEqual(b, a, 'zero-rng: reading feat statistics changed draws or the battle');
    const c = field([def('us', 'US', 0, -150, { badges: [] }), def('cs', 'CS', 0, 0, { men: 2500, badges: [] })]);
    const d = field([def('us', 'US', 0, -150), def('cs', 'CS', 0, 0, { men: 2500 })]);
    for (let k = 0; k < 300; k++) { c.tick(0.05); d.tick(0.05); }
    assert.deepEqual(c.units.map((u) => [u.men, u.morale, u.ammo]), d.units.map((u) => [u.men, u.morale, u.ammo]), 'zero-rng: an empty badge list changed the battle');
  }],
  ['award-phase', (api) => {
    let s = fresh(api);
    const loanFeats = { alpha: stats('US', 2000, { farKills: B.sharpshooters }), reb: stats('CS', 2500, { repulses: B.rock }) };
    s = play(api, s, loanFeats); // a1 is on loan: the franchise earns nothing, the enemy does
    assert.ok(!brigade(s, 'alpha').badges && s.enemy?.reb?.badges[0].id === 'rock', 'award-phase: a loan phase must award enemy badges only');
    s = play(api, s, { alpha: stats('US', 2000, { farKills: 2 * B.sharpshooters, marched: B.hardMarchers }), reb: stats('CS', 2500) });
    const a = brigade(s, 'alpha');
    assert.deepEqual(a.badges.map((x) => [x.id, x.tier, x.feat]), [['sharpshooters', 'silver', 2 * B.sharpshooters], ['hardMarchers', 'bronze', B.hardMarchers]],
      'award-phase: a phase off loan awards each feat met at its tier');
    const replayed = play(api, s, { alpha: stats('US', 2000, { farKills: B.sharpshooters }) }, { replay: true });
    assert.equal(brigade(replayed, 'alpha').badges[0].tier, 'silver', 'award-phase: a weaker replay must not lower a tier');
    assert.equal(api.badgeAward(replayed.awardId)?.brigades.length, 0, 'award-phase: a replay that earns nothing has nothing to stamp');
    const summary = api.badgeAward(s.awardId);
    assert.ok(summary && summary.brigades[0].earned.length === 2 && summary.cards.alpha.badges.length === 2, 'award-phase: the after-action summary is noted by award');
  }],
  ['slots-choice', (api) => {
    let s = play(api, fresh(api), {});
    s = play(api, s, { alpha: stats('US', 2000, { farKills: B.sharpshooters, marched: B.hardMarchers, woodsKills: B.woodsmen }) });
    let a = brigade(s, 'alpha');
    assert.deepEqual([a.badges.map((x) => x.id), a.offer.map((x) => x.id)], [['sharpshooters', 'hardMarchers'], ['woodsmen']],
      'slots-choice: a Trained brigade keeps 2 badges and offers the third');
    refuses('slots-choice', () => api.chooseBadges(s, { brigadeId: 'alpha', keep: ['sharpshooters', 'woodsmen', 'hardMarchers'] }), /2 badge slots/);
    s = api.chooseBadges(s, { brigadeId: 'alpha', keep: ['hardMarchers', 'woodsmen'] });
    a = brigade(s, 'alpha');
    assert.ok(!a.offer && a.badges.map((x) => x.id).join() === 'hardMarchers,woodsmen', 'slots-choice: the choice keeps exactly the chosen badges');
    // A veterancy drop (half the men lost) leaves one slot: the extra badge waits on offer.
    const lost = play(api, s, { alpha: stats('US', 2000) }, { units: [{ id: 'alpha', side: 'US', menStart: 2000, men: 900 }] });
    a = brigade(lost, 'alpha');
    assert.ok(a.vet === 'green' && a.badges.length === 1 && a.offer.length === 1, 'slots-choice: a veterancy drop moves the badge beyond the slots to the offer');
    assert.doesNotThrow(() => save.parseSnapshot(save.exportSnapshot(lost)), 'slots-choice: the re-fitted save must validate');
  }],
  ['xfactor-first-gold', (api) => {
    let s = play(api, fresh(api), {});
    s = play(api, s, { alpha: stats('US', 2000, { woodsKills: 4 * B.woodsmen, canisterKills: 0 }) });
    const a = brigade(s, 'alpha');
    assert.ok(a.xfactor === 'woodsmen' && api.badgeAward(s.awardId).brigades[0].xfactor === 'woodsmen', 'xfactor-first-gold: the first Gold becomes the X-Factor');
    const later = play(api, s, { alpha: stats('US', 2000, { farKills: 4 * B.sharpshooters }) });
    assert.equal(brigade(later, 'alpha').xfactor, 'woodsmen', 'xfactor-first-gold: a later Gold must not replace the X-Factor');
    assert.equal(api.badgeAward(later.awardId).brigades[0].xfactor, null, 'xfactor-first-gold: the X-Factor moment is for the first Gold only');
    refuses('xfactor-first-gold', () => api.chooseBadges(later, { brigadeId: 'alpha', keep: ['sharpshooters'] }), /X-Factor badge is always kept/);
  }],
  ['effects-ratings', (api) => {
    const base = { id: 'x', label: 'Fictional', kind: 'infantry', men: 1000, vet: 'trained', base: { fire: 45, melee: 46, morale: 56, drill: 50 },
      weapon: { uid: 'w', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional' } };
    const plain = api.ratings(base), withB = api.ratings({ ...base, badges: [{ id: 'sharpshooters', tier: 'silver' }, { id: 'rock', tier: 'gold' }] });
    assert.deepEqual([withB.fire - plain.fire, withB.morale - plain.morale, withB.melee - plain.melee], [5, 8, 0], 'effects-ratings: badge points go to their bars');
    assert.ok(withB.ovr > plain.ovr, 'effects-ratings: badges raise OVR through the bars');
    let s = play(api, fresh(api), {});
    s = play(api, s, { alpha: stats('US', 2000, { farKills: B.sharpshooters }) });
    const a = brigade(s, 'alpha'), bare = { ...a }; delete bare.badges;
    assert.equal(a.ovr, api.ratings(a).ovr, 'effects-ratings: the saved OVR includes the badges');
    assert.equal(a.ovr - api.ratings(bare).ovr >= 0 && api.ratings(a).fire - api.ratings(bare).fire, 3, 'effects-ratings: Bronze adds 3 to its bar');
  }],
  ['combat-effects', (api) => {
    const plain = firstVolley(api, null), gold = firstVolley(api, api.fieldBadges([{ id: 'sharpshooters', tier: 'gold' }], null));
    assert.ok(plain > 0 && Math.abs(gold / plain - 1.08) < 1e-9, `combat-effects: Gold Sharpshooters must add 8% beyond 200 m (${gold} / ${plain})`);
    const wrong = firstVolley(api, api.fieldBadges([{ id: 'canister', tier: 'gold' }], null));
    assert.equal(wrong, plain, 'combat-effects: an effect that does not apply changes nothing');
  }],
  ['xfactor-aura', (api) => {
    const plain = firstVolley(api, null), xf = api.fieldBadges([{ id: 'sharpshooters', tier: 'gold' }], 'sharpshooters');
    const near = firstVolley(api, null, { friendBadges: xf, gap: 150 }), away = firstVolley(api, null, { friendBadges: xf, gap: 700 });
    assert.ok(Math.abs(near / plain - 1.008) < 1e-9, `xfactor-aura: a friend within 300 m of an X-Factor gains 10% of its effect (${near / plain})`);
    assert.equal(away, plain, 'xfactor-aura: a friend beyond 300 m gains nothing');
  }],
  ['enemy-carried', (api) => {
    let s = play(api, fresh(api), { reb: stats('CS', 2500, { farKills: 4 * B.sharpshooters }, 3) });
    assert.ok(s.enemy.reb.xfactor === 'sharpshooters' && s.enemy.reb.badges[0].tier === 'gold', 'enemy-carried: the enemy records its badges and first Gold');
    const scenario = { units: [def('alpha', 'US', 0, -250, { weapon: 'smooth' }), def('reb', 'CS', 0, 0, { men: 2500 })] };
    const applied = api.applyCampaign(scenario, s, { packId: 'pa', phaseId: 'a2', loan: false });
    const reb = applied.units.find((d) => d.id === 'reb');
    assert.deepEqual(reb.badges, [{ id: 'sharpshooters', tier: 'gold', xfactor: true }], 'enemy-carried: a later phase fields the formation with its badges');
    const g = field(applied.units.map((d) => ({ ...d, facing: d.side === 'US' ? 0 : Math.PI })));
    quiet(g, 'alpha'); const t = unit(g, 'alpha'), shooter = unit(g, 'reb');
    for (let k = 0; k < 400 && !shooter.shots; k++) g.tick(0.05);
    const h = field(scenario.units); quiet(h, 'alpha'); const t2 = unit(h, 'alpha'), s2 = unit(h, 'reb');
    for (let k = 0; k < 400 && !s2.shots; k++) h.tick(0.05);
    assert.ok(t2.casualties > 0 && t.casualties > t2.casualties, `enemy-carried: the enemy's badges must apply in battle (${t.casualties} vs ${t2.casualties})`);
  }],
  ['field-badges', (api) => {
    let s = play(api, fresh(api), {});
    s = play(api, s, { alpha: stats('US', 2000, { farKills: B.sharpshooters }) });
    const scenario = { units: [def('alpha', 'US', 0, -250), def('reb', 'CS', 0, 0)] };
    const own = api.applyCampaign(scenario, s, { packId: 'pb', phaseId: 'b1', loan: false }).units.find((d) => d.id === 'alpha');
    assert.deepEqual(own.badges, [{ id: 'sharpshooters', tier: 'bronze' }], 'field-badges: franchise brigades take their kept badges to the field');
    const loan = api.applyCampaign(scenario, s, { packId: 'pa', phaseId: 'a1', loan: true }).units.find((d) => d.id === 'alpha');
    assert.ok(!has(loan, 'badges'), 'field-badges: a loan phase fields no franchise badges');
    assert.ok(!has(scenario.units[0], 'badges'), 'field-badges: the input scenario is never changed');
  }],
  ['save-round-trip', (api) => {
    let s = play(api, fresh(api), { reb: stats('CS', 2500, { repulses: B.rock }) });
    s = play(api, s, { alpha: stats('US', 2000, { farKills: B.sharpshooters, marched: B.hardMarchers, woodsKills: 4 * B.woodsmen }) });
    const text = api.exportSnapshot(s), back = api.parseSnapshot(text);
    assert.equal(JSON.stringify(back), text, 'save-round-trip: export and import must be identical');
    assert.ok(back.enemy?.reb && brigade(back, 'alpha').xfactor === 'woodsmen' && brigade(back, 'alpha').offer?.length === 1, 'save-round-trip: badges, offer, X-Factor and enemy survive');
    const old = copy(s); delete old.enemy; for (const b of old.army) { delete b.badges; delete b.offer; delete b.xfactor; }
    const loaded = api.parseSnapshot(JSON.stringify(old));
    assert.ok(loaded.army.every((b) => !has(b, 'badges')) && !has(loaded, 'enemy'), 'save-round-trip: a save from before badges loads without them');
    const bad = (mutate) => { const v = copy(s); mutate(v); return () => api.validateSnapshot(v); };
    refuses('save-round-trip', bad((v) => { v.army[0].badges[0].id = 'invented'; }), /unknown badge/);
    refuses('save-round-trip', bad((v) => { v.army[0].offer = [{ ...v.army[0].badges[0] }]; }), /appears twice/);
    refuses('save-round-trip', bad((v) => { v.army[0].badges.push({ id: 'rock', tier: 'bronze', awardId: v.awardId, feat: 2 }); }), /more badges than its slots/);
    refuses('save-round-trip', bad((v) => { v.army[0].xfactor = 'sharpshooters'; }), /X-Factor must be a kept Gold/);
    refuses('save-round-trip', bad((v) => { v.enemy = {}; }), /enemy badges/);
    refuses('save-round-trip', bad((v) => { v.version = 1; v.kind = 'completed-reward'; delete v.slot; delete v.campaign; for (const k of save.ECONOMY_FIELDS) delete v[k]; delete v.updated; delete v.enemy; }), /missing or unsupported/);
  }],
  ['phase-bridge', (api) => {
    const g = field([def('alpha', 'US', 0, -250), def('reb', 'CS', 0, 0, { men: 2500 })]); quiet(g, 'reb'); run(g, 30);
    g.over = true; g.result = { winner: 'US', grade: 'victory', why: 'Fictional test result' };
    const s0 = play(api, fresh(api), {}), p = api.campaignPhase(s0, CAMPAIGN);
    const outcome = api.phaseOutcome({ game: g, scenario: g.scenario, awardId: p.awardId, seed: p.seed });
    assert.ok(outcome.feats?.alpha?.farKills > 0 && outcome.feats.reb?.side === 'CS', 'phase-bridge: the phase outcome carries every fielded formation\'s feats');
    const units = outcome.units.map((u) => ({ ...u }));
    const feats = copy(outcome.feats); feats.alpha.farKills = Math.max(feats.alpha.farKills, B.sharpshooters);
    const s1 = api.recordPhase(s0, CAMPAIGN, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade: 'Victory', units, loot: [], feats });
    assert.equal(brigade(s1, 'alpha').badges?.[0]?.id, 'sharpshooters', 'phase-bridge: recorded feats award the badge');
    refuses('phase-bridge', () => api.recordPhase(s0, CAMPAIGN, { packId: p.packId, phaseId: p.phaseId, awardId: p.awardId, winner: 'US', grade: 'Victory', units, loot: [],
      feats: { ...feats, ghost: feats.alpha } }), /not in the result/);
  }],
];

const MUTANTS = {
  catalogue: { BADGES: badges.BADGES.map((b, i) => (i === 3 ? { ...b, name: 'Fire Control' } : b)) },
  examples: { BADGES: badges.BADGES.map((b, i) => (i === 0 ? { ...b, example: { ...b.example, sources: b.example.sources.slice(0, 1) } } : b)) },
  tiers: { tierFor: (b, v) => (v >= 4 * b.bronze ? 'gold' : v >= 3 * b.bronze ? 'silver' : v >= b.bronze ? 'bronze' : null) },
  'feat-detection': { report: (g) => { const r = g.featReport(); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, steadySeconds: 0 }])); } },
  'zero-rng': { report: (g) => { g.rnd(); return g.featReport(); } },
  'award-phase': { recordPhase: (s, c, r) => campaign.recordPhase(s, c, { ...r, feats: Object.fromEntries(Object.entries(r.feats || {}).filter(([, f]) => f.side === 'US')) }) },
  'slots-choice': { chooseBadges: (s, { brigadeId }) => save.validateSnapshot(s) },
  'xfactor-first-gold': { recordPhase: (s, c, r) => { const next = campaign.recordPhase(s, c, r); return save.validateSnapshot({ ...next, army: next.army.map((b) => {
    const gold = (b.badges || []).filter((x) => x.tier === 'gold').pop(); return gold ? { ...b, xfactor: gold.id } : b; }) }); } },
  'effects-ratings': { ratings: (b) => ratings({ ...b, badges: undefined }) },
  'combat-effects': { fieldBadges: (list, x) => badges.fieldBadges(list.map((b) => ({ ...b, tier: 'bronze' })), x) },
  'xfactor-aura': { fieldBadges: (list) => badges.fieldBadges(list, null) },
  'enemy-carried': { applyCampaign: (sc, s, p) => { const v = save.validateSnapshot(s); delete v.enemy; return campaign.applyCampaign(sc, v, p); } },
  'field-badges': { applyCampaign: (sc, s, p) => { const out = campaign.applyCampaign(sc, s, p); out.units = out.units.map((d) => ({ ...d, badges: [{ id: 'sharpshooters', tier: 'bronze' }] })); return out; } },
  'save-round-trip': { parseSnapshot: (t) => { const v = save.parseSnapshot(t); delete v.enemy; return v; } },
  'phase-bridge': { phaseOutcome: (o) => ({ ...phaseOutcome(o), feats: {} }) },
};

// Unexpected (non-assertion) errors count as that check's failure, named.
async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.stack ?? e}` });
  }
}
export async function badgesUnit(api = API) {
  for (const [name, check] of BADGE_CHECKS) await runCheck(name, check, api);
  return BADGE_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of BADGE_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
  }
  const n = BADGE_CHECKS.length;
  if (failed) { console.log(`BADGES FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`BADGES OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of BADGE_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`BADGES CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`BADGES CONTROLS OK (${caught}/${n})`);
  }
}

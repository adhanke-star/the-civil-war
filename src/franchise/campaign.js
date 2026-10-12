// The v1 campaign: one fixed ladder of battle-pack phases (Shiloh -> Stones River -> Chattanooga) fought
// by one franchise army. Pure logic only: no storage, DOM or field allocation. createProgressStore (save.js)
// persists the v2 saves these functions return; phaseOutcome (practice.js) turns a finished field into a result.
//
//   validateCampaign(json)                      -> frozen canonical campaign definition
//   newCampaign({ campaign, slot, seed, at? })  -> v2 save at index 0 with the franchise roster as its army
//                                                  (plus any formations that join at the first phase)
//   campaignPhase(save, campaign, { replay? })  -> the next phase (or the last one again) with its award identity
//   applyCampaign(scenario, save, phase)        -> a NEW scenario with carried strength and franchise state applied
//   recordPhase(save, campaign, result)         -> the next validated save (history, carry, losses, veterancy, loot)
//   phaseResult({ phase, game, scenario })      -> { outcome, record } where record is recordPhase's input
//
// Game rules here (game choices, not history): a franchise formation that loses half its men in a phase drops one
// veterancy tier; one that ends a battle's last phase in Victory or better, with at least half its men, rises one.
// Every recorded phase also pays requisition points once (src/franchise/economy.js awardPhase; amounts in tuning.js).
// Badges (src/franchise/badges.js; game rules in tuning.js BADGE_RULES): a result may carry the phase's feat statistics
// (`feats`, from phaseOutcome); recording it awards badges and tier-ups to franchise brigades (not on a loan phase) and to
// the enemy's formations (always), re-fits every brigade's kept badges to its slots after a veterancy change, and notes the
// award for the after-action (badgeAward). applyCampaign gives each fielded formation its kept badges (`badges` on the
// field definition; src/game.js applies their effects); chooseBadges(save, { brigadeId, keep }) is the camp's choice when a
// brigade has earned more badges than it has slots.
//
// Camp (P5c): applyCampaign also sets a fielded formation's `morale` from the camp the army marched out of for this phase
// attempt (src/franchise/camp-orders.js breakCamp: Rest, shortages) and the decision cards chosen for it (decisions.js);
// nothing changes when the save has neither (a phase launched without marching out of camp). With the Ambulances upgrade,
// recordPhase returns a share of each franchise brigade's losses to the ranks. Reward and requisition cards field without
// their `source` (the field's equipment profile knows issue and capture only).
//
// Joins: a ladder phase may carry `joins` (rows in the franchise schema): formations that enter the franchise army
// when a save first reaches that phase (a new campaign reaching its first phase, or recordPhase advancing to it; never
// a replay). Appending is idempotent by unitId, so a formation already in the army (alive or destroyed) is never added
// twice. unitIds are unique across the franchise and every phase's joins; a loan phase cannot carry joins.
import { validateSnapshot } from './save.js';
import { phaseOutcome, vetBase } from './practice.js';
import { ARMS, UNIQUES, VETERANCY, GRADES, itemDef } from '../reward/data.js';
import { awardPhase, upgradesOf } from './economy.js';
import { CAMP } from './tuning.js';
import { validateFeats, awardBadges, noteAward, fieldBadges, keepBadges } from './badges.js';

const fail = (message) => { throw new Error(`Campaign: ${message}`); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const PACK = /^[a-z0-9-]{1,40}$/;
const UNIT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/; // no dots: muster and loot item identities stay disjoint
export const CAMPAIGN_LIMITS = Object.freeze({ franchise: 200, phases: 100, attempts: 999, awardId: 80, units: 1000 });
const catalogue = new Set([...ARMS, ...UNIQUES].map((x) => x.id));
const vetIds = VETERANCY.map((v) => v.id);
const MUSTER = 'In service at the start of the campaign';
const JOINED = 'Joined the army during the campaign';

function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}
function shape(o, required, optional, label) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))
    || required.some((k) => !has(o, k)) || Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))) fail(`${label} has missing or unsupported fields.`);
}
function words(v, label) {
  if (typeof v !== 'string' || !v.trim() || v.length > 160 || /[\u0000-\u001f\u007f]/.test(v)) fail(`invalid ${label}.`);
  return v;
}
function count(v, label, lo, hi) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) fail(`invalid ${label}.`);
  return v;
}
const awardFor = (campaignId, slot, packId, phaseId, attempt) => `${campaignId}.${slot}.${packId}.${phaseId}.${attempt}`;
const same = (entry, packId, phaseId) => entry.packId === packId && entry.phaseId === phaseId;

/** Strict campaign definition. Each battle's phases are contiguous, so a pack change means a new battle. */
export function validateCampaign(json) {
  shape(json, ['version', 'id', 'title', 'franchise', 'phases'], [], 'campaign');
  if (json.version !== 1 || typeof json.id !== 'string' || !PACK.test(json.id)) fail('unsupported campaign version or identity.');
  const title = words(json.title, 'campaign title');
  if (!Array.isArray(json.franchise) || json.franchise.length > CAMPAIGN_LIMITS.franchise) fail('incomplete or oversized franchise roster.');
  // One row schema for the franchise and for every phase's joins; unitIds are unique across all of them.
  const unitIds = new Set();
  const formation = (r, what) => {
    shape(r, ['unitId', 'label', 'kind', 'men', 'weapon', 'vet'], ['guns'], what);
    if (typeof r.unitId !== 'string' || !UNIT.test(r.unitId) || unitIds.has(r.unitId)) fail('franchise unit identities must be unique simple ids.');
    unitIds.add(r.unitId);
    if (!['infantry', 'battery'].includes(r.kind) || !vetIds.includes(r.vet)) fail('unknown franchise kind or veterancy.');
    if (typeof r.weapon !== 'string' || !catalogue.has(r.weapon)
      || itemDef(r.weapon).arm !== (r.kind === 'battery' ? 'artillery' : 'infantry')) fail('franchise weapon is unknown or incompatible.');
    const row = { unitId: r.unitId, label: words(r.label, 'franchise label'), kind: r.kind, men: count(r.men, 'franchise men', 1, 100000) };
    if (r.kind === 'battery') row.guns = count(r.guns, 'franchise guns', 1, 200);
    else if (has(r, 'guns')) fail('infantry cannot own guns.');
    if (`${json.id}.3.muster.${r.unitId}`.length > 100) fail('franchise unit identity is too long.');
    return { ...row, weapon: r.weapon, vet: r.vet };
  };
  const franchise = json.franchise.map((r) => formation(r, 'franchise formation'));
  if (!Array.isArray(json.phases) || json.phases.length > CAMPAIGN_LIMITS.phases) fail('incomplete or oversized phase ladder.');
  const finished = new Set(), seen = new Set();
  const phases = json.phases.map((p, i) => {
    shape(p, ['packId', 'phaseId'], ['loan', 'joins'], 'campaign phase');
    if (typeof p.packId !== 'string' || !PACK.test(p.packId) || typeof p.phaseId !== 'string' || !PACK.test(p.phaseId)) fail('invalid pack or phase identity.');
    if (has(p, 'loan') && p.loan !== true) fail('loan must be true when present.');
    if (has(p, 'joins') && p.loan === true) fail('a loan phase cannot add formations to the franchise army.');
    if (has(p, 'joins') && (!Array.isArray(p.joins) || !p.joins.length || p.joins.length > CAMPAIGN_LIMITS.franchise)) fail('joins must be a nonempty list of formations.');
    const joins = has(p, 'joins') ? p.joins.map((r) => formation(r, 'joining formation')) : null;
    if (seen.has(`${p.packId}/${p.phaseId}`)) fail('a phase appears twice on the ladder.');
    seen.add(`${p.packId}/${p.phaseId}`);
    const previous = json.phases[i - 1];
    if (previous && previous.packId !== p.packId) finished.add(previous.packId);
    if (finished.has(p.packId)) fail('a battle\'s phases must be contiguous on the ladder.');
    if (awardFor(json.id, 3, p.packId, p.phaseId, CAMPAIGN_LIMITS.attempts).length > CAMPAIGN_LIMITS.awardId) fail('phase award identity would be too long.');
    return { packId: p.packId, phaseId: p.phaseId, ...(p.loan ? { loan: true } : {}), ...(joins ? { joins } : {}) };
  });
  if (unitIds.size > CAMPAIGN_LIMITS.franchise) fail('the franchise and its joining formations exceed the army limit.');
  return frozen({ version: 1, id: json.id, title, franchise, phases });
}

function campaignSave(save, campaign) {
  const s = validateSnapshot(save);
  if (s.version !== 2 || s.kind !== 'campaign') fail('expected a campaign save.');
  if (campaign) {
    if (s.campaign.id !== campaign.id) fail('the save belongs to another campaign.');
    if (s.campaign.status === 'complete' && s.campaign.index < campaign.phases.length) {
      // The ladder grew after this campaign finished (a new battle shipped): reopen it at the first new phase,
      // with every formation that joins up to that phase.
      return validateSnapshot({ ...s, campaign: { ...s.campaign, status: 'in-progress' }, army: withJoins(s.army, campaign, s.slot, s.campaign.index) });
    }
    const end = s.campaign.index >= campaign.phases.length;
    if (s.campaign.index > campaign.phases.length || end !== (s.campaign.status === 'complete')) fail('the save does not match this campaign ladder.');
  }
  return s;
}

/** One army brigade for a franchise or joining row; its equipped item identity is `<campaign>.<slot>.<tag>.<unitId>`. */
const enlist = (c, slot, r, tag, from) => ({ id: r.unitId, unitId: r.unitId, label: r.label, kind: r.kind, men: r.men, vet: r.vet,
  weapon: { uid: `${c.id}.${slot}.${tag}.${r.unitId}`, itemId: r.weapon, tier: itemDef(r.weapon).tier, conditionId: 'serviceable', from },
  base: vetBase(vetIds.indexOf(r.vet) + 1), ...(r.kind === 'battery' ? { guns: r.guns } : {}) });
/** The army plus every formation that joins at a ladder phase up to `through` and is not in it yet (idempotent). */
function withJoins(army, c, slot, through) {
  const present = new Set(army.flatMap((b) => [b.id, ...(has(b, 'unitId') ? [b.unitId] : [])]));
  const added = [];
  for (const p of c.phases.slice(0, Math.max(0, through + 1))) for (const r of p.joins || []) {
    if (present.has(r.unitId)) continue;
    present.add(r.unitId);
    added.push(enlist(c, slot, r, 'join', JOINED));
  }
  return added.length ? [...army, ...added] : army;
}

/** A fresh v2 save: index 0, the franchise roster (and the first phase's joins) as its army, nothing in the depot. */
export function newCampaign({ campaign, slot, seed, at } = {}) {
  const c = validateCampaign(campaign);
  if (!c.franchise.length || !c.phases.length) fail('this campaign has no franchise roster or phases yet.');
  const army = withJoins(c.franchise.map((r) => enlist(c, slot, r, 'muster', MUSTER)), c, slot, 0);
  return validateSnapshot({ format: 'the-civil-war', version: 2, kind: 'campaign', awardId: `${c.id}.${slot}.start`, army, depot: [], issued: [],
    seed, grade: null, slot, campaign: { id: c.id, index: 0, status: 'in-progress', history: [], carry: {} }, ...(at === undefined ? {} : { updated: at }) });
}

/** The phase to play next (null when complete), or with { replay: true } the last finished phase again. */
export function campaignPhase(save, campaign, { replay = false } = {}) {
  const c = validateCampaign(campaign), s = campaignSave(save, c), at = s.campaign.index - (replay ? 1 : 0);
  if (replay && at < 0) fail('there is no finished phase to replay.');
  if (at >= c.phases.length) return null;
  const entry = c.phases[at], attempt = 1 + s.campaign.history.filter((r) => same(r, entry.packId, entry.phaseId)).length;
  if (attempt > CAMPAIGN_LIMITS.attempts) fail('this phase has been replayed too often.');
  const awardId = awardFor(c.id, s.slot, entry.packId, entry.phaseId, attempt);
  return frozen({ packId: entry.packId, phaseId: entry.phaseId, loan: entry.loan === true, index: at, isLast: at === c.phases.length - 1,
    replay: !!replay, attempt, awardId, seed: `${s.seed}:${awardId}` });
}

/**
 * A new scenario for one phase; the input is never changed. Carried strength applies only inside the same battle;
 * non-loan phases also field franchise formations with the army's men, veterancy and equipped item (mapped to the
 * field the way the saved-practice deployment does). Strength only ever goes down. Formations with no men or guns
 * left stay off the field, along with their opening orders.
 */
export function applyCampaign(scenario, save, phase) {
  const s = campaignSave(save);
  if (!phase || typeof phase !== 'object' || typeof phase.packId !== 'string' || typeof phase.phaseId !== 'string') fail('applying a campaign needs its phase.');
  if (!scenario || typeof scenario !== 'object' || !Array.isArray(scenario.units)) fail('applying a campaign needs a scenario roster.');
  const out = JSON.parse(JSON.stringify(scenario)), loan = phase.loan === true;
  const last = s.campaign.history[s.campaign.history.length - 1];
  const carry = last && last.packId === phase.packId ? s.campaign.carry : {};
  const army = new Map(s.army.filter((b) => has(b, 'unitId')).map((b) => [b.unitId, b]));
  const enemy = s.enemy || {};
  // Kept badges go onto the field definition: franchise brigades off loan; enemy formations by id, every phase.
  const badged = (d) => {
    if (!d) return d;
    const b = army.get(d.id);
    if (b) return !loan && (b.badges || []).length ? { ...d, badges: fieldBadges(b.badges, b.xfactor) } : d;
    if (d.side === 'CS' && has(enemy, d.id)) return { ...d, badges: fieldBadges(enemy[d.id].badges, enemy[d.id].xfactor) };
    return d;
  };
  // Camp (P5c): the morale the march out of camp set for this phase attempt (franchise brigades off loan) and the decision
  // cards chosen for it (every Union formation on the field). Only the definition's `morale` carries it (src/units/unit.js).
  const ready = !loan && s.ready && s.ready.awardId === phase.awardId ? s.ready.morale : {};
  const decided = (s.decisions || []).filter((r) => r.awardId === phase.awardId)
    .reduce((n, r) => n + r.effects.filter((e) => e.kind === 'morale').reduce((m, e) => m + e.amount, 0), 0);
  const steadied = (d) => {
    if (!d) return d;
    const b = army.get(d.id), delta = (d.side === 'US' ? decided : 0) + (b && has(ready, b.id) ? ready[b.id] : 0);
    return delta ? { ...d, morale: Math.max(1, Math.min(100, Math.round((Number.isFinite(d.morale) ? d.morale : CAMP.defaultMorale) + delta))) } : d;
  };
  const field = (d) => steadied(badged(place(d)));
  const place = (d) => {
    const artillery = d.type === 'artillery';
    if (army.has(d.id)) {
      if (loan) return d; // Grant's army is on loan: the franchise army is neither read nor written
      const b = army.get(d.id);
      if (d.side !== 'US' || (b.kind === 'battery') !== artillery) fail(`franchise formation ${b.id} does not match its field unit.`);
      const men = Math.min(d.men, b.men), guns = artillery ? Math.min(Number.isSafeInteger(d.guns) ? d.guns : b.guns, b.guns) : 0;
      if (men <= 0 || (artillery && guns <= 0)) return null;
      // The field's equipment profile knows issue and capture origins only; reward and requisition cards field without one.
      const equipment = { ...b.weapon };
      if (!['issue', 'capture'].includes(equipment.source)) delete equipment.source;
      return { ...d, men, ...(artillery ? { guns } : {}), xp: vetIds.indexOf(b.vet) + 1, weapon: artillery ? 'smbart' : 'smooth', equipment };
    }
    if (!has(carry, d.id)) return d;
    const c = carry[d.id], men = Math.min(d.men, c.men);
    const guns = artillery && has(c, 'guns') && Number.isSafeInteger(d.guns) ? Math.min(d.guns, c.guns) : d.guns;
    if (men <= 0 || (artillery && guns <= 0)) return null;
    return { ...d, men, ...(artillery && guns !== undefined ? { guns } : {}) };
  };
  out.units = out.units.map(field).filter(Boolean);
  if (Array.isArray(out.reinforcements)) out.reinforcements = out.reinforcements.map(field).filter(Boolean);
  if (!out.units.length) fail('no formation of this phase is left to take the field.');
  const present = new Set([...out.units, ...(out.reinforcements || [])].map((d) => d.id));
  if (Array.isArray(out.opening)) out.opening = out.opening.filter((o) => present.has(o.id));
  return out;
}

/**
 * Record one finished phase. Defeat still advances; a replay of the last phase is marked and does not advance.
 * Re-recording the award already saved returns the save unchanged (no duplicate loot or advance).
 */
export function recordPhase(save, campaign, result) {
  const c = validateCampaign(campaign), s = campaignSave(save, c);
  shape(result, ['packId', 'phaseId', 'winner', 'grade', 'units', 'loot'], ['awardId', 'at', 'held', 'feats'], 'phase result');
  if (has(result, 'held') && typeof result.held !== 'boolean') fail('held must be true or false when present.');
  const history = s.campaign.history, last = history[history.length - 1];
  if (has(result, 'awardId') && last && result.awardId === s.awardId && last.awardId === s.awardId && same(last, result.packId, result.phaseId)) return s;
  const index = s.campaign.index;
  let at = index, replay = false;
  if (!(at < c.phases.length && same(c.phases[at], result.packId, result.phaseId))) {
    at = index - 1; replay = true;
    if (at < 0 || !same(c.phases[at], result.packId, result.phaseId)) fail('this result is not for the next phase or a replay of the last one.');
  }
  const entry = c.phases[at], loan = entry.loan === true;
  const awardId = awardFor(c.id, s.slot, entry.packId, entry.phaseId, 1 + history.filter((r) => same(r, entry.packId, entry.phaseId)).length);
  if (has(result, 'awardId') && result.awardId !== awardId) fail('the result award identity does not match this campaign position.');
  if (!['US', 'CS', null].includes(result.winner) || !GRADES.includes(result.grade)) fail('unknown winner or grade.');
  if (!Array.isArray(result.units) || result.units.length > CAMPAIGN_LIMITS.units) fail('incomplete or oversized phase units.');
  const ids = new Set(), losses = { US: 0, CS: 0 };
  const units = result.units.map((u) => {
    shape(u, ['id', 'side', 'menStart', 'men'], ['guns', 'gunsStart'], 'phase unit');
    if (typeof u.id !== 'string' || !u.id || ids.has(u.id) || !['US', 'CS'].includes(u.side) || has(u, 'guns') !== has(u, 'gunsStart')) fail('invalid phase unit.');
    ids.add(u.id);
    const menStart = count(u.menStart, 'starting men', 0, 100000), men = count(u.men, 'surviving men', 0, menStart);
    losses[u.side] += menStart - men;
    const row = { id: u.id, side: u.side, menStart, men };
    if (has(u, 'guns')) { row.gunsStart = count(u.gunsStart, 'starting guns', 0, 200); row.guns = count(u.guns, 'surviving guns', 0, row.gunsStart); }
    return row;
  });
  let feats = {};
  try { if (has(result, 'feats')) feats = validateFeats(result.feats, units); }
  catch (err) { fail(String(err.message).replace(/^Badges: /, '')); }
  if (!Array.isArray(result.loot) || result.loot.some((it) => !it || typeof it.uid !== 'string' || !it.uid.startsWith(`${awardId}.`))) fail('loot does not belong to this award.');
  const army = new Map(s.army.filter((b) => has(b, 'unitId')).map((b) => [b.unitId, b]));
  // Historical carry lives inside one battle; a new pack starts from the authored roster.
  const carry = last && last.packId === entry.packId ? { ...s.campaign.carry } : {};
  const changed = new Map(), ambulances = upgradesOf(s).includes('ambulances');
  const battleEnd = at === c.phases.length - 1 || c.phases[at + 1].packId !== entry.packId;
  for (const u of units) {
    if (army.has(u.id)) {
      if (loan) continue;
      const b = army.get(u.id);
      if (u.side !== 'US') fail(`franchise formation ${b.id} fought for the wrong side.`);
      // Ambulances (an army upgrade, P5c): a share of the phase's losses returns to the ranks (a game rule).
      const lost = u.menStart - u.men, men = Math.max(0, b.men - lost + (ambulances ? Math.floor(lost * CAMP.upgrades.ambulances.returned) : 0));
      const next = { ...b, men };
      if (b.kind === 'battery') next.guns = men ? Math.max(0, b.guns - (has(u, 'guns') ? u.gunsStart - u.guns : 0)) : 0;
      const tier = vetIds.indexOf(b.vet), lostHalf = u.menStart > 0 && (u.menStart - u.men) * 2 >= u.menStart;
      if (lostHalf) next.vet = vetIds[Math.max(0, tier - 1)];
      else if (!replay && battleEnd && u.men > 0 && ['Decisive', 'Victory'].includes(result.grade)) next.vet = vetIds[Math.min(vetIds.length - 1, tier + 1)];
      delete next.ovr;
      changed.set(b.id, next);
      continue;
    }
    const prior = has(carry, u.id) ? carry[u.id] : null;
    const kept = { men: prior ? Math.min(prior.men, u.men) : u.men };
    if (has(u, 'guns')) kept.guns = prior && has(prior, 'guns') ? Math.min(prior.guns, u.guns) : u.guns;
    carry[u.id] = kept;
  }
  const nextIndex = replay ? index : index + 1;
  // A first play that reaches a new phase enlists that phase's joins (and any earlier ones the save lacks); a replay never does.
  const fought = s.army.map((b) => changed.get(b.id) || b);
  const draft = { ...s, awardId, grade: result.grade,
    army: replay ? fought : withJoins(fought, c, s.slot, Math.min(nextIndex, c.phases.length - 1)), depot: [...s.depot, ...result.loot],
    campaign: { id: c.id, index: nextIndex, status: nextIndex >= c.phases.length ? 'complete' : 'in-progress',
      history: [...history, { packId: entry.packId, phaseId: entry.phaseId, awardId, winner: result.winner, grade: result.grade,
        lossesUS: losses.US, lossesCS: losses.CS, replay }], carry },
    ...(has(result, 'at') ? { updated: result.at } : {}) };
  // Badges for this award (every brigade re-fitted to its slots too); then the whole save is validated.
  const badges = awardBadges(draft, { awardId, feats, loan });
  const next = validateSnapshot(badges.save);
  noteAward(badges.summary);
  // Requisition points for this award (paid once; a loan phase pays half; a replay pays only its improvement).
  return awardPhase(next, { awardId, grade: result.grade, held: result.held === true, lossesUS: losses.US, lossesCS: losses.CS, loan });
}

/** The reward bridge for one campaign phase: phaseOutcome's survivors, grade and loot as recordPhase input. */
export function phaseResult({ phase, game, scenario }) {
  if (!phase || typeof phase.awardId !== 'string') fail('a phase result needs the launched phase.');
  const outcome = phaseOutcome({ game, scenario, awardId: phase.awardId, seed: phase.seed });
  return { outcome, record: { packId: phase.packId, phaseId: phase.phaseId, awardId: phase.awardId, winner: outcome.winner,
    grade: outcome.grade, held: outcome.held === true, units: outcome.units.map((u) => ({ ...u })), loot: outcome.cards.map((c) => ({ ...c })),
    ...(outcome.feats ? { feats: Object.fromEntries(Object.entries(outcome.feats).map(([id, f]) => [id, { ...f }])) } : {}) } };
}

/**
 * The camp's badge choice for one brigade with more badges than slots: keep exactly `keep` (badge ids, at most its slots,
 * the X-Factor always among them); the others are let go. Returns the next validated save (store.exchange writes it).
 */
export function chooseBadges(save, { brigadeId, keep } = {}) {
  const s = campaignSave(save);
  const b = s.army.find((x) => x.id === brigadeId);
  if (!b) fail('that brigade is no longer in the army.');
  let next;
  try { next = keepBadges(b, keep); } catch (err) { fail(String(err.message).replace(/^Badges: /, '')); }
  return validateSnapshot({ ...s, army: s.army.map((x) => (x === b ? next : x)) });
}

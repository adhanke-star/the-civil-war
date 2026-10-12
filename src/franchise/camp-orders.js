// src/franchise/camp-orders.js: camp orders and the march out of camp (DESIGN §3 Camp "one order per brigade (Drill / Target
// practice / Rest)", Stores). Pure logic over v2 campaign saves; no DOM, no storage. Every number is a GAME RULE in
// src/franchise/tuning.js CAMP; the UI labels them so.
//
//   ORDERS / orderName(id) / orderText(id)          the three orders and their game rules in plain words
//   setOrder(save, { brigadeId, order })            one brigade's standing order (an exchange; Rest is the default)
//   breakCamp(save, { campaign, replay, fielded })  the army marches out to the next phase (or the replayed one), once per
//                                                   phase attempt: the quartermaster's issue arrives, every order is carried
//                                                   out, fielded brigades draw their stores, and the phase's morale is set
//   campReport(before, after)                       what one breakCamp did, in plain lines for the camp's status
//   supplyNeed(save, count, batteries)              the stores `count` fielded brigades draw for one phase
//   shortText(store) / BATTLE_NOTE                  what a shortage does (P5d), and where the camp's effects reach the battle
//
// Rules (game rules):
// - Orders stand until changed. Rest: +CAMP.rest.morale morale in the next phase. Drill: +1 Drill bar and one drill toward
//   veterancy (every CAMP.drill.perTier drills raise it one tier, to Veteran at most). Target practice: +1 Fire bar for
//   CAMP.target.ammunition ammunition (x the Ordnance train factor); with too little ammunition, or the Fire bar at its camp
//   limit, the brigade rests instead.
//   Bar points from camp are capped per bar by CAMP.barCap (orders and bought training together). In battle (P5d) each camp
//   point is CAMP.battle.perPoint %: Fire on the fire effect, Drill on reload and wheeling speed, Melee on melee strength,
//   Morale off morale lost under fire (src/franchise/campaign.js applyCampaign -> the definition's `training`).
// - Marching out of camp is the moment the phase starts for the save: it happens once per phase attempt (`ready.awardId`),
//   so re-entering the camp and marching again changes nothing; a replay is a new attempt and marches again.
// - Loan phases field none of the franchise army: orders and the issue still happen, nothing is drawn.
// - Each fielded franchise brigade (in army order) draws CAMP.use of ammunition and rations and wears out shoes, blankets
//   and tents; a battery also wears out horses. A brigade a store cannot cover loses CAMP.shortMorale for each short store,
//   CAMP.shortCap at most, for that phase, and the march records which stores it lacked (`ready.short`). In battle (P5d,
//   CAMP.battle): short of shoes it starts tired (`fatigue`), short of ammunition with fewer rounds (`ammo`; resupply out
//   of contact refills them slowly), a battery short of horses limbers and unlimbers more slowly (`limber`).
import { CAMP } from './tuning.js';
import { validateSnapshot } from './save.js';
import { campaignPhase } from './campaign.js';
import { storesOf, upgradesOf, barRoom, raiseBar } from './economy.js';
import { VETERANCY, STORE_BY_ID } from '../reward/data.js';

const fail = (message) => { throw new Error(`Camp: ${message}`); };
const vetIds = VETERANCY.map((v) => v.id);
export const ORDERS = CAMP.orders;
const NAMES = Object.freeze({ rest: 'Rest', drill: 'Drill', target: 'Target practice' });
export const orderName = (id) => NAMES[id] || id;
/** One order's game rule in plain words. */
export function orderText(id) {
  if (id === 'rest') return `+${CAMP.rest.morale} morale in the next phase`;
  if (id === 'drill') return `+${CAMP.drill.bar} Drill on the card (in battle +${CAMP.battle.perPoint}% faster reload and wheeling per camp Drill point); every ${CAMP.drill.perTier} drills raise veterancy one tier (to Veteran at most)`;
  if (id === 'target') return `+${CAMP.target.bar} Fire on the card for ${CAMP.target.ammunition} ammunition (in battle +${CAMP.battle.perPoint}% fire effect per camp Fire point)`;
  return '';
}
export const CAMP_RULES_NOTE = 'Camp orders, stores, shortages and their effects are game rules, not history.';
/** Where the camp reaches the battle (P5d), in one plain sentence for the camp's notes. */
export const BATTLE_NOTE = `In battle, camp card points (orders and training) give +${CAMP.battle.perPoint}% per point (Fire: fire effect; Drill: reload and wheeling; Melee: melee; Morale: less morale lost under fire), and a shortage follows its brigade into the next phase.`;
const SHORT = Object.freeze({
  ammunition: `A brigade short of ammunition starts the phase with less morale and ${CAMP.battle.ammo}% of its rounds (resupply out of contact refills them slowly).`,
  rations: 'A hungry brigade starts the phase with less morale.',
  shoes: `Barefoot men start the phase with less morale and tired (fatigue ${CAMP.battle.fatigue} of 100: a slower march and weaker fire until they rest).`,
  blankets: 'Cold nights cost a brigade some morale.',
  tents: 'Men without shelter start with less morale.',
  horses: `A battery short of teams starts with less morale and limbers and unlimbers ${CAMP.battle.limber} s more slowly.`,
  wagons: 'A full depot refuses new purchases until a card is issued or turned in.',
});
/** What a shortage of one store does (a game rule, never a historical claim). */
export const shortText = (store) => SHORT[store] || '';
const fieldable = (b) => b.men > 0 && (b.kind !== 'battery' || b.guns > 0);
const ammoUse = (n, save) => Math.ceil(n * (upgradesOf(save).includes('ordnance') ? CAMP.upgrades.ordnance.factor : 1));

function campaignSave(save) {
  const s = validateSnapshot(save);
  if (s.version !== 2) fail('camp orders are for campaign saves.');
  return s;
}

/** Set one brigade's standing order. */
export function setOrder(save, { brigadeId, order } = {}) {
  const s = campaignSave(save);
  if (!ORDERS.includes(order)) fail('choose Rest, Drill or Target practice.');
  const b = s.army.find((x) => x.id === brigadeId);
  if (!b) fail('that brigade is no longer in the army.');
  if (!fieldable(b)) fail(`${b.label} has no men left to give orders to.`);
  if ((b.order || 'rest') === order) return s;
  const next = { ...b };
  if (order === 'rest') delete next.order; else next.order = order;
  return validateSnapshot({ ...s, army: s.army.map((x) => (x === b ? next : x)) });
}

/** The stores `count` fielded brigades (of them `batteries` batteries) draw for one phase. */
export function supplyNeed(save, count, batteries = 0) {
  return { ammunition: count * ammoUse(CAMP.use.ammunition, save), rations: count * CAMP.use.rations, shoes: count * CAMP.use.shoes,
    blankets: count * CAMP.use.blankets, tents: count * CAMP.use.tents, horses: batteries * CAMP.use.horses };
}

/**
 * March out of camp to the next phase (or, with replay, the last one again). `fielded` lists the field unit ids of the
 * phase (its Union formations; the camp reads them from the battle pack); without it every living franchise brigade is
 * taken to fight. Idempotent per phase attempt. Returns the next validated save.
 */
export function breakCamp(save, { campaign, replay = false, fielded } = {}) {
  const s = campaignSave(save), phase = campaignPhase(s, campaign, { replay });
  if (!phase) fail('the campaign is complete; there is no phase to march to.');
  if (s.ready && s.ready.awardId === phase.awardId) return s;
  const stores = storesOf(s), morale = {}, short = {};
  for (const k of CAMP.stores) stores[k] += CAMP.issue[k];
  const add = (id, n) => { morale[id] = (morale[id] || 0) + n; };
  // Orders, in army order (Target practice draws ammunition first come, first served).
  const army = s.army.map((b) => {
    if (!b.unitId || !fieldable(b)) return b;
    const order = b.order || 'rest';
    if (order === 'drill') {
      let next = { ...b, drilled: (b.drilled || 0) + 1 };
      if (barRoom(next, 'drill') >= CAMP.drill.bar) next = raiseBar(next, 'drill', CAMP.drill.bar);
      const tier = vetIds.indexOf(next.vet), cap = vetIds.indexOf(CAMP.drill.maxVet);
      if (next.drilled % CAMP.drill.perTier === 0 && tier < cap) next.vet = vetIds[tier + 1];
      delete next.ovr;
      return next;
    }
    if (order === 'target') {
      const cost = ammoUse(CAMP.target.ammunition, s);
      if (stores.ammunition >= cost && barRoom(b, 'fire') >= CAMP.target.bar) {
        stores.ammunition -= cost;
        return raiseBar(b, 'fire', CAMP.target.bar);
      }
      add(b.id, CAMP.rest.morale); // no ammunition to spare (or the Fire bar is at its camp limit): the brigade rests
      return b;
    }
    add(b.id, CAMP.rest.morale);
    return b;
  });
  // Supplies for the brigades that fight (none on a loan phase), in army order.
  if (!phase.loan) {
    const ids = Array.isArray(fielded) ? new Set(fielded) : null;
    for (const b of army) {
      if (!b.unitId || !fieldable(b) || (ids && !ids.has(b.unitId))) continue;
      const need = supplyNeed(s, 1, b.kind === 'battery' ? 1 : 0);
      let penalty = 0;
      const lacks = [];
      for (const k of Object.keys(need)) {
        if (!need[k]) continue;
        if (stores[k] < need[k]) { penalty += CAMP.shortMorale[k]; lacks.push(k); }
        stores[k] = Math.max(0, stores[k] - need[k]);
      }
      if (penalty) add(b.id, -Math.min(CAMP.shortCap, penalty));
      if (lacks.length) short[b.id] = lacks; // the battle reads these (P5d: fatigue, rounds, limbering)
    }
  }
  const ready = { awardId: phase.awardId, morale: Object.fromEntries(Object.entries(morale).filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : 1))),
    ...(Object.keys(short).length ? { short: Object.fromEntries(Object.keys(short).sort().map((k) => [k, short[k]])) } : {}) };
  return validateSnapshot({ ...s, army, stores, ready });
}

/** Plain lines for what one march out of camp did (null when nothing happened). */
export function campReport(before, after) {
  const a = campaignSave(after), b = before ? campaignSave(before) : null;
  if (!a.ready || (b && b.ready && b.ready.awardId === a.ready.awardId)) return null;
  const lines = [], prior = new Map((b ? b.army : []).map((x) => [x.id, x]));
  const drilled = a.army.filter((x) => (x.drilled || 0) > (prior.get(x.id)?.drilled || 0));
  const promoted = a.army.filter((x) => prior.has(x.id) && prior.get(x.id).vet !== x.vet);
  const fired = a.army.filter((x) => (x.bonus?.fire || 0) > (prior.get(x.id)?.bonus?.fire || 0));
  if (drilled.length) lines.push(`${drilled.length} brigade${drilled.length === 1 ? '' : 's'} drilled${promoted.length ? `; ${promoted.map((x) => x.label).join(', ')} rose to ${promoted.map((x) => VETERANCY.find((v) => v.id === x.vet).name).join(', ')}` : ''}.`);
  if (fired.length) lines.push(`${fired.length} brigade${fired.length === 1 ? '' : 's'} held target practice.`);
  const morale = Object.values(a.ready.morale), up = morale.filter((n) => n > 0).length, down = morale.filter((n) => n < 0).length;
  if (up) lines.push(`${up} brigade${up === 1 ? '' : 's'} rested: more morale for this phase.`);
  if (down) lines.push(`${down} brigade${down === 1 ? '' : 's'} short of stores: less morale for this phase.`);
  const lacking = Object.values(a.ready.short || {}), count = (k) => lacking.filter((l) => l.includes(k)).length;
  const effects = [[count('shoes'), 'start tired (no shoes)'], [count('ammunition'), 'start with fewer rounds'], [count('horses'), 'limber slowly (short of horses)']].filter(([n]) => n);
  if (effects.length) lines.push(`In battle: ${effects.map(([n, t]) => `${n} ${t}`).join('; ')} (game rules).`);
  const st = storesOf(a);
  lines.push(`Stores now: ${CAMP.stores.map((k) => `${STORE_BY_ID[k].name.toLowerCase()} ${st[k]}`).join(', ')}.`);
  return lines;
}

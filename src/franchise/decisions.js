// src/franchise/decisions.js: sourced decision cards before a campaign phase (DESIGN §1 Strategy layer "1-2 sourced decision
// cards before each battle that change its setup or your points"; §4b Decision cards "sourced dilemmas, 2-3 cards with stated
// gain and cost, no dice; the real choice revealed afterwards"). Pure logic; no DOM, no storage. The deck is
// assets/decisions.json (src/ui/briefing.js loadDecisions fetches it; Node reads the file).
//
//   EFFECT_KINDS / effectText(effect)            the small vocabulary of game-rule effects, in plain words
//   validateDeck(json)                           -> frozen canonical deck, or throws "Decisions: ..."
//   cardsFor(deck, { packId, phaseId })          -> the phase's cards (0-2), in deck order
//   recorded(save, phase, cardId)                -> the save's record of that card for the phase attempt, or null
//   optionOpen(save, option)                     -> { ok, reason } (an option costing points or stores the army lacks is closed)
//   chooseDecision(save, { campaign, deck, cardId, optionId, replay }) -> the next validated save (an exchange)
//   historyOf(card)                              -> { text, option, provenance, sources } for the reveal
//
// Rules (GAME RULES; the history is the card's dilemma, historical choice and sources, with their provenance):
// - Effects: { kind: 'rp', amount } requisition points (a gain is earned: it raises reputation and may reach a level; a cost
//   is spent: reputation is never reduced); { kind: 'morale', amount } every Union formation on the field in this phase
//   starts with that much more or less morale (src/franchise/campaign.js applyCampaign); { kind: 'store', store, amount } a
//   store gained or consumed now. No dice: an option does exactly what it says.
// - A card is chosen once per phase attempt (the attempt's award identity): choosing again returns the save unchanged, so
//   re-entering the camp shows the recorded choice. A replay is a new attempt and may choose again; its record says replay.
// - Every card has at least one option that costs no points or stores, so a card can always be answered.
import { CAMP } from './tuning.js';
import { validateSnapshot, effectRecord } from './save.js';
import { campaignPhase } from './campaign.js';
import { earn, storesOf } from './economy.js';
import { STORE_BY_ID } from '../reward/data.js';

const fail = (message) => { throw new Error(`Decisions: ${message}`); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const EFFECT_KINDS = Object.freeze(['rp', 'morale', 'store']);
export const DECISIONS_NOTE = 'Gains and costs are game rules; the dilemma, what really happened and the sources are history.';
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/, PACK = /^[a-z0-9-]{1,40}$/;
const PROVENANCE = ['Verified', 'Inferred', 'Disputed'];

function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}
function shape(o, required, optional, label) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || required.some((k) => !has(o, k))
    || Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))) fail(`${label} has missing or unsupported fields.`);
}
function words(v, label, max = 900) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) fail(`invalid ${label}.`);
  return v;
}

/** One effect in plain words: "+4 morale for every Union formation in this phase". */
export function effectText(e) {
  const sign = e.amount > 0 ? '+' : '−', n = Math.abs(e.amount);
  if (e.kind === 'rp') return `${sign}${n} requisition points${e.amount > 0 ? '' : ' (spent; reputation is kept)'}`;
  if (e.kind === 'morale') return `${sign}${n} morale for every Union formation in this phase`;
  if (e.kind === 'store') return `${sign}${n} ${STORE_BY_ID[e.store].name.toLowerCase()}`;
  return '';
}
const costs = (o) => o.effects.filter((e) => (e.kind === 'rp' || e.kind === 'store') && e.amount < 0);

/** Strict deck: every card sourced, 2-3 options, each option with a stated gain and cost and real effects both ways. */
export function validateDeck(json) {
  shape(json, ['version', 'cards'], ['note'], 'decision deck');
  if (json.version !== 1 || !Array.isArray(json.cards) || json.cards.length > 200) fail('unsupported deck version or size.');
  const ids = new Set(), perPhase = new Map();
  const cards = json.cards.map((c) => {
    shape(c, ['id', 'pack', 'phase', 'title', 'dilemma', 'sources', 'provenance', 'options', 'historicalChoice', 'historicalOption'], ['research'], 'decision card');
    if (typeof c.id !== 'string' || !ID.test(c.id) || ids.has(c.id)) fail('card identities must be unique simple ids.');
    ids.add(c.id);
    if (typeof c.pack !== 'string' || !PACK.test(c.pack) || typeof c.phase !== 'string' || !PACK.test(c.phase)) fail(`${c.id}: invalid pack or phase.`);
    const key = `${c.pack}/${c.phase}`;
    perPhase.set(key, (perPhase.get(key) || 0) + 1);
    if (perPhase.get(key) > 2) fail(`${c.id}: a phase has more than two decision cards.`);
    if (!Array.isArray(c.sources) || !c.sources.length || c.sources.length > 8) fail(`${c.id}: a card needs its sources.`);
    const sources = c.sources.map((src) => {
      shape(src, ['label'], ['url'], `${c.id} source`);
      const out = { label: words(src.label, `${c.id} source label`, 300) };
      if (has(src, 'url')) { if (typeof src.url !== 'string' || !/^https:\/\/[^\s]+$/.test(src.url)) fail(`${c.id}: source links must be https.`); out.url = src.url; }
      return out;
    });
    if (!PROVENANCE.includes(c.provenance)) fail(`${c.id}: unknown provenance.`);
    if (c.provenance === 'Verified' && sources.length < 2) fail(`${c.id}: Verified needs two independent sources.`);
    if (!Array.isArray(c.options) || c.options.length < 2 || c.options.length > 3) fail(`${c.id}: a card has 2 or 3 options.`);
    const optionIds = new Set();
    const options = c.options.map((o) => {
      shape(o, ['id', 'label', 'gain', 'cost', 'effects'], [], `${c.id} option`);
      if (typeof o.id !== 'string' || !ID.test(o.id) || optionIds.has(o.id)) fail(`${c.id}: option identities must be unique simple ids.`);
      optionIds.add(o.id);
      if (!Array.isArray(o.effects) || !o.effects.length || o.effects.length > 4) fail(`${c.id}/${o.id}: an option needs 1-4 effects.`);
      let effects;
      try { effects = o.effects.map(effectRecord); } catch (err) { fail(`${c.id}/${o.id}: ${String(err.message).replace(/^Progress: /, '')}`); }
      if (!effects.some((e) => e.amount > 0) || !effects.some((e) => e.amount < 0)) fail(`${c.id}/${o.id}: every option needs a real gain and a real cost.`);
      return { id: o.id, label: words(o.label, `${c.id} option label`, 160), gain: words(o.gain, `${c.id}/${o.id} gain`, 300),
        cost: words(o.cost, `${c.id}/${o.id} cost`, 300), effects };
    });
    if (!options.some((o) => !costs(o).length)) fail(`${c.id}: one option must cost no points or stores, so the card can always be answered.`);
    if (!optionIds.has(c.historicalOption)) fail(`${c.id}: the historical option is not one of the card's options.`);
    return { id: c.id, pack: c.pack, phase: c.phase, title: words(c.title, `${c.id} title`, 160), dilemma: words(c.dilemma, `${c.id} dilemma`),
      sources, provenance: c.provenance, options, historicalChoice: words(c.historicalChoice, `${c.id} historical choice`),
      historicalOption: c.historicalOption, ...(has(c, 'research') ? { research: words(c.research, `${c.id} research note`, 300) } : {}) };
  });
  return frozen({ version: 1, cards });
}

/** The phase's cards in deck order (none for a phase without sourced candidates). */
export const cardsFor = (deck, { packId, phaseId }) => deck.cards.filter((c) => c.pack === packId && c.phase === phaseId);
/** The save's record of one card for this phase attempt, or null. */
export const recorded = (save, phase, cardId) => (save.decisions || []).find((r) => r.awardId === phase.awardId && r.cardId === cardId) || null;

/** Whether the army can pay an option's costs now. */
export function optionOpen(save, option) {
  const stores = storesOf(save);
  for (const e of option.effects) {
    if (e.kind === 'rp' && e.amount < 0 && save.rp < -e.amount) return { ok: false, reason: `needs ${-e.amount} requisition points; you have ${save.rp}` };
    if (e.kind === 'store' && e.amount < 0 && stores[e.store] < -e.amount) return { ok: false, reason: `needs ${-e.amount} ${STORE_BY_ID[e.store].name.toLowerCase()}; you have ${stores[e.store]}` };
  }
  return { ok: true, reason: '' };
}

/** Record one card's choice for the next phase (or the replayed one) and apply its points and stores now. */
export function chooseDecision(save, { campaign, deck, cardId, optionId, replay = false } = {}) {
  const s = validateSnapshot(save);
  if (s.version !== 2) fail('decision cards are for campaign saves.');
  const phase = campaignPhase(s, campaign, { replay });
  if (!phase) fail('the campaign is complete; there is no phase to decide for.');
  const card = cardsFor(deck, phase).find((c) => c.id === cardId);
  if (!card) fail('that card is not one of this phase\'s decisions.');
  if (recorded(s, phase, cardId)) return s; // idempotent: the recorded choice stands for this attempt
  const option = card.options.find((o) => o.id === optionId);
  if (!option) fail('that is not one of the card\'s options.');
  const open = optionOpen(s, option);
  if (!open.ok) fail(`that choice ${open.reason}.`);
  const stores = storesOf(s);
  let rp = 0;
  for (const e of option.effects) {
    if (e.kind === 'store') stores[e.store] = Math.max(0, stores[e.store] + e.amount);
    if (e.kind === 'rp') rp += e.amount;
  }
  const record = { awardId: phase.awardId, packId: phase.packId, phaseId: phase.phaseId, cardId, optionId, replay: phase.replay, effects: option.effects.map((e) => ({ ...e })) };
  let next = { ...s, stores, decisions: [...(s.decisions || []), record] };
  if (rp) next = { ...next, ledger: [...next.ledger, { kind: 'decision', awardId: phase.awardId, cardId, points: rp }] };
  if (rp > 0) next = earn(next, rp);
  else if (rp < 0) next = { ...next, rp: next.rp + rp };
  return validateSnapshot(next);
}

/** The reveal: what really happened, which option matches it, its provenance and sources. */
export function historyOf(card) {
  const option = card.options.find((o) => o.id === card.historicalOption);
  return { text: card.historicalChoice, option, provenance: card.provenance, sources: card.sources };
}
export { CAMP };

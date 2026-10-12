// Campaign screens' shared pieces: the campaign definition and pack-phase summaries (title, camp, Battles menu),
// the ladder position text, the reward-issue bridge, and the field Briefing overlay shown before a campaign phase.
//
//   loadCampaign()                        -> { raw, def } (def validated by validateCampaign) or null when it ships empty
//   loadPackSummary(packId)               -> { packId, title, phases: [{ id, title, date, start, line, us }] } (cached per page;
//                                            `us` lists the phase's Union field unit ids, reinforcements included)
//   loadDecisions()                       -> the validated decision deck (assets/decisions.json; src/franchise/decisions.js)
//   decisionLines(save, phase, deck?)     -> plain lines for the decisions and camp morale recorded for this phase attempt
//   ladderPosition(def, index)            -> { battle, battles, phase, phases } for "Battle N of B · Phase k of n"
//   rewardArmy(army)                      -> the campaign army as the reward sequence's v1 brigade rows (no unitId)
//   applyRewardIssues(next, loot, result) -> next with the reward's issue log replayed through exchangeDepot, or next
//                                            unchanged (issued: false) when the reward's items differ from the award
//   briefingSources(list)                 -> [{ label, href }] with only http(s) links kept
//   mountBriefing({ scenario, phase, game, hud, effects, onBegin, save?, deck? }) -> the paused, focused Briefing dialog
//                                            (with `save`, it also lists the decision cards chosen for this attempt)
// Decision cards are chosen in camp before the field and this briefing load (src/ui/entry.js, the camp's Next and Replay).
// Pure helpers do no DOM work at import time, so tools/test-campaign-ui.mjs can import this file in Node.
import { validateCampaign } from '../franchise/campaign.js';
import { exchangeDepot, validateSnapshot } from '../franchise/save.js';
import { preparePhase } from '../sim/phase.js';
import { validateDeck, effectText } from '../franchise/decisions.js';

const MAX_BYTES = 1024 * 1024;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const words = (v) => typeof v === 'string' && v.trim() ? v.trim() : '';

async function boundedJson(url, fetcher = globalThis.fetch) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Campaign: ${url} could not be loaded.`);
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_BYTES) throw new Error(`Campaign: ${url} exceeds its download bound.`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`Campaign: ${url} exceeds its download bound.`);
  return JSON.parse(text);
}

/** The shipped campaign, or null while it has no franchise roster or phases (today's title stays). */
export async function loadCampaign({ fetcher } = {}) {
  const raw = await boundedJson('./assets/campaign.json', fetcher);
  const def = validateCampaign(raw);
  if (!def.franchise.length || !def.phases.length) return null;
  return { raw, def };
}

const summaries = new Map();
/** Titles, dates and a short line for every phase of one battle pack (validated as a pack first). */
export function loadPackSummary(packId, { fetcher } = {}) {
  if (typeof packId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(packId)) return Promise.reject(new Error('Campaign: invalid pack id.'));
  if (!summaries.has(packId)) {
    const pending = boundedJson(`./assets/packs/${packId}.json`, fetcher).then((pack) => {
      const first = Array.isArray(pack?.phases) ? pack.phases[0]?.id : undefined;
      preparePhase(pack, first); // every phase validates, or the whole pack is refused
      if (pack.id !== packId) throw new Error('Campaign: battle pack identity does not match its file.');
      return Object.freeze({ packId, title: pack.title, phases: Object.freeze(pack.phases.map((p) => Object.freeze({
        id: p.id, title: p.scenario.title, date: p.scenario.date, start: p.scenario.start,
        line: shortLine(p.scenario), us: Object.freeze([...p.scenario.units, ...(Array.isArray(p.scenario.reinforcements) ? p.scenario.reinforcements : [])]
          .filter((u) => u && u.side === 'US' && typeof u.id === 'string').map((u) => u.id)) }))) });
    });
    pending.catch(() => summaries.delete(packId));
    summaries.set(packId, pending);
  }
  return summaries.get(packId);
}
let deckPending = null;
/** The decision deck (validated once per page; a failed load may be retried). */
export function loadDecisions({ fetcher } = {}) {
  if (!deckPending) {
    deckPending = boundedJson('./assets/decisions.json', fetcher).then(validateDeck);
    deckPending.catch(() => { deckPending = null; });
  }
  return deckPending;
}
/** Plain lines for the decisions recorded for this phase attempt and the camp's morale (empty when there are none). */
export function decisionLines(save, phase, deck = null) {
  if (!save || save.version !== 2 || !phase || typeof phase.awardId !== 'string') return [];
  const lines = [];
  for (const r of (save.decisions || []).filter((x) => x.awardId === phase.awardId)) {
    const card = deck?.cards.find((c) => c.id === r.cardId), option = card?.options.find((o) => o.id === r.optionId);
    lines.push(`${card ? `${card.title}: ${option ? option.label : r.optionId}` : 'Decision'} (game rule: ${r.effects.map(effectText).join('; ')}).`);
  }
  if (save.ready && save.ready.awardId === phase.awardId && !phase.loan) {
    const m = Object.values(save.ready.morale), up = m.filter((n) => n > 0).length, down = m.filter((n) => n < 0).length;
    if (up || down) lines.push(`Camp (game rule): ${[up ? `${up} brigade${up === 1 ? '' : 's'} rested` : '', down ? `${down} short of stores` : ''].filter(Boolean).join(', ')}; their morale is set for this phase.`);
  }
  return lines;
}
function shortLine(s) {
  if (words(s.subtitle)) return words(s.subtitle);
  const text = Array.isArray(s.briefing?.text) ? s.briefing.text.find(words) : s.briefing?.text;
  if (!words(text)) return '';
  const first = words(text).split(/(?<=[.!?])\s/)[0];
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
}

/** "21 July 1861" from YYYY-MM-DD (no locale guessing). */
export function formatDate(iso) {
  const m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Battle and phase numbers of ladder position `index` (the last phase when the campaign is complete). */
export function ladderPosition(def, index) {
  const at = Math.max(0, Math.min(index, def.phases.length - 1)), entry = def.phases[at];
  const packs = [...new Set(def.phases.map((p) => p.packId))], inPack = def.phases.filter((p) => p.packId === entry.packId);
  return { battle: packs.indexOf(entry.packId) + 1, battles: packs.length,
    phase: inPack.findIndex((p) => p.phaseId === entry.phaseId) + 1, phases: inPack.length };
}

/** The reward sequence fields one brigade row per formation; it validates them as v1 rows (no unitId). */
export function rewardArmy(army) {
  return army.map((b) => ({ id: b.id, label: b.label, kind: b.kind, men: b.men, vet: b.vet, base: { ...b.base },
    weapon: { ...b.weapon }, ...(b.kind === 'battery' ? { guns: b.guns } : {}) }));
}

/**
 * Replay the reward's issue log on the recorded save. The reward re-rolls this award's loot from the same seed; if its
 * items are not exactly the recorded loot plus the army's weapons, nothing is replayed and the loot stays in the depot.
 */
export function applyRewardIssues(next, loot, result) {
  const base = validateSnapshot(next);
  if (!Array.isArray(loot) || loot.some((l) => !base.depot.some((it) => it.uid === l?.uid))) return { save: base, issued: false };
  const expected = [...base.army.map((b) => b.weapon.uid), ...loot.map((l) => l.uid)].sort();
  const seen = Array.isArray(result?.army) && Array.isArray(result?.depot)
    ? [...result.army.map((b) => b?.weapon?.uid), ...result.depot.map((it) => it?.uid)].sort() : null;
  const issued = Array.isArray(result?.issued) ? result.issued : null;
  if (!issued || !seen || JSON.stringify(seen) !== JSON.stringify(expected)) return { save: base, issued: false };
  if (!issued.length) return { save: base, issued: true };
  try {
    let s = base;
    for (const r of issued) s = exchangeDepot(s, { brigadeId: r.brigade, itemUid: r.item });
    return { save: s, issued: true };
  } catch { return { save: base, issued: false }; }
}

/** Source rows as links: a string URL or { title|label|text, url|href }; only http(s) URLs become links. */
export function briefingSources(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, 20)) {
    const href = typeof item === 'string' ? item : words(item?.url) || words(item?.href);
    let url;
    try { url = new URL(href, 'https://example.invalid/'); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname === 'example.invalid') continue;
    const label = typeof item === 'string' ? url.hostname : words(item.title) || words(item.label) || words(item.text) || url.hostname;
    out.push({ label: label.slice(0, 200), href: url.href });
  }
  return out;
}

const DEFAULT_LOAN = "Grant's Army of the Tennessee is on loan for this phase. Its results do not change your franchise brigades; losses here carry only inside this battle.";

/** The paused Briefing overlay. Begin (or Escape) closes it, unpauses and focuses the battlefield. */
export function mountBriefing({ scenario, phase, game, hud, effects, onBegin = () => {}, save = null, deck = null }) {
  const b = has(scenario, 'briefing') && scenario.briefing && typeof scenario.briefing === 'object' ? scenario.briefing : {};
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null) k === 'text' ? (n.textContent = v) : n.setAttribute(k, v);
    n.append(...kids.filter(Boolean));
    return n;
  };
  const dialog = el('dialog', { id: 'briefing', 'aria-labelledby': 'briefing-title', 'aria-describedby': 'briefing-text' });
  const body = el('div', { class: 'briefing-body' });
  const when = [formatDate(scenario.date), words(scenario.start)].filter(Boolean).join(' · ');
  body.append(el('p', { class: 'sub briefing-eyebrow', text: phase.replay ? 'Campaign briefing · replay (marked on your record)' : 'Campaign briefing' }),
    el('h2', { id: 'briefing-title', text: scenario.title }),
    el('p', { class: 'sub', id: 'briefing-when', text: [when, words(scenario.subtitle)].filter(Boolean).join(' · ') }));
  if (phase.loan) body.append(el('p', { id: 'briefing-loan', class: 'briefing-loan', text: words(b.loan) || DEFAULT_LOAN }));
  const paragraphs = (Array.isArray(b.text) ? b.text : [b.text]).map(words).filter(Boolean);
  const text = el('div', { id: 'briefing-text' });
  for (const p of paragraphs.length ? paragraphs : [words(scenario.historyNote) || 'Take the field and hold the objective.']) text.append(el('p', { text: p }));
  body.append(text);
  if (b.quote && words(b.quote.text)) {
    const cite = [words(b.quote.who), words(b.quote.source)].filter(Boolean);
    body.append(el('figure', { class: 'briefing-quote' }, el('blockquote', {}, el('p', { text: words(b.quote.text) })),
      cite.length ? el('figcaption', { text: `— ${cite.join(', ')}` }) : null));
  }
  const decided = decisionLines(save, phase, deck);
  if (decided.length) {
    const list = el('ul', { class: 'briefing-decisions', 'aria-labelledby': 'briefing-decisions-heading' });
    for (const line of decided) list.append(el('li', { text: line }));
    body.append(el('h3', { id: 'briefing-decisions-heading', text: 'Your decisions before this phase' }), list);
  }
  const sources = briefingSources(b.sources);
  if (sources.length) {
    const list = el('ul', { class: 'briefing-sources', 'aria-labelledby': 'briefing-sources-heading' });
    for (const s of sources) list.append(el('li', {}, el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer', text: s.label })));
    body.append(el('h3', { id: 'briefing-sources-heading', text: 'Sources' }), list);
  }
  const begin = el('button', { type: 'button', id: 'briefing-begin', class: 'briefing-begin', text: 'Begin' });
  dialog.append(body, el('div', { class: 'briefing-foot' }, begin));
  (document.getElementById('battle') || document.body).append(dialog);
  game.paused = true; hud.setPaused(true);
  let started = false;
  function start() {
    if (started) return;
    started = true; dialog.close(); dialog.remove();
    effects?.unlock?.();
    game.paused = false; hud.setPaused(false);
    document.getElementById('battlefield')?.focus({ preventScroll: true });
    onBegin();
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); start(); });
  begin.addEventListener('click', start);
  dialog.showModal(); begin.focus({ preventScroll: true });
  return { dialog, begin: start, get open() { return !started; } };
}

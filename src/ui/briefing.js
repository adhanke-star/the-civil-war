// Campaign screens' shared pieces: the campaign definition and pack-phase summaries (title, camp, Battles menu),
// the ladder position text, the reward-issue bridge, and the field Briefing overlay shown before a campaign phase.
//
//   loadCampaign()                        -> { raw, def } (def validated by validateCampaign) or null when it ships empty
//   loadPackSummary(packId)               -> { packId, title, phases: [{ id, title, date, start, line, us, commanders }] } (cached per
//                                            page; `us` lists the phase's Union field unit ids, reinforcements included;
//                                            `commanders` maps each unit id to its sourced { name, rank } for the camp's cards);
//                                            `rosters` are the pack's sandbox-battle roster rows (src/sim/sandbox-battle.js rosterList)
//   loadDecisions()                       -> the validated decision deck (assets/decisions.json; src/franchise/decisions.js)
//   decisionLines(save, phase, deck?)     -> plain lines for the decisions and camp morale recorded for this phase attempt
//   ladderPosition(def, index)            -> { battle, battles, phase, phases } for "Battle N of B · Phase k of n"
//   rewardArmy(army)                      -> the campaign army as the reward sequence's v1 brigade rows (no unitId)
//   applyRewardIssues(next, loot, result) -> next with the reward's issue log replayed through exchangeDepot, or next
//                                            unchanged (issued: false) when the reward's items differ from the award
//   briefingSources(list)                 -> [{ label, href }] with only http(s) links kept
//   mountBriefing({ scenario, phase, game, hud, effects, onBegin, save?, deck? }) -> the paused, focused Briefing dialog
//                                            (with `save`, it also lists the decision cards chosen for this attempt)
//   briefingCommanders(scenario, side?, max?) -> [{ name, rank, side, named }]: the phase's commanders named in the briefing
//                                            first, then the player's side; the dialog shows each with his period portrait
//                                            (src/ui/art.js; exact name only) or the generic silhouette (P6b)
//   loadTraits(), traitEntry, formationTraits, traitedCommanders, traitRuleLine, traitDetails -> enemy commanders' sourced
//                                            temperament (P3t, assets/traits.json): the Briefing's "Opposing commanders" (labels,
//                                            game rule, provenance; claims and sources in a disclosure) and the enemy unit card
// Decision cards are chosen in camp before the field and this briefing load (src/ui/entry.js, the camp's Next and Replay).
// Pure helpers do no DOM work at import time, so tools/test-campaign-ui.mjs can import this file in Node.
import { validateCampaign } from '../franchise/campaign.js';
import { exchangeDepot, validateSnapshot } from '../franchise/save.js';
import { preparePhase } from '../sim/phase.js';
import { rosterList } from '../sim/sandbox-battle.js';
import { chainCommanders } from '../sim/ai.js';
import { validateDeck, effectText } from '../franchise/decisions.js';
import { whenArt, loadArt, portraitArt, genericPortrait, portraitLine } from './art.js';

const MAX_BYTES = 1024 * 1024;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const words = (v) => typeof v === 'string' && v.trim() ? v.trim() : '';
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null) k === 'text' ? (n.textContent = v) : n.setAttribute(k, v);
  n.append(...kids.filter(Boolean));
  return n;
};

/** Terminal graphics interruption; only an explicit reload can start another field. */
export function showGraphicsReload({reload=()=>location.reload()}={}) {
  const existing=document.getElementById('graphics-reload');
  if(existing){existing.querySelector('button').focus({preventScroll:true});return existing;}
  const dialog=el('dialog',{id:'graphics-reload',role:'alertdialog','aria-modal':'true','aria-labelledby':'graphics-reload-title',
    'aria-describedby':'graphics-reload-text'});
  const body=el('div',{class:'briefing-body',tabindex:'0',role:'region','aria-labelledby':'graphics-reload-title'},
    el('h2',{id:'graphics-reload-title',text:'Battle stopped'}),
    el('p',{id:'graphics-reload-text',text:'The graphics connection was lost. Reload to restart this battle.'}));
  const button=el('button',{type:'button',class:'briefing-begin',text:'Reload battle'});
  button.addEventListener('click',reload);
  dialog.addEventListener('cancel',event=>event.preventDefault());
  dialog.append(body,el('div',{class:'briefing-foot'},button));
  const battle=document.getElementById('battle');if(battle)battle.inert=true;
  document.body.append(dialog);dialog.showModal();button.focus({preventScroll:true});
  return dialog;
}

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
      return Object.freeze({ packId, title: pack.title, rosters: rosterList([pack]), phases: Object.freeze(pack.phases.map((p) => Object.freeze({
        id: p.id, title: p.scenario.title, date: p.scenario.date, start: p.scenario.start,
        line: shortLine(p.scenario), us: Object.freeze([...p.scenario.units, ...(Array.isArray(p.scenario.reinforcements) ? p.scenario.reinforcements : [])]
          .filter((u) => u && u.side === 'US' && typeof u.id === 'string').map((u) => u.id)),
        commanders: Object.freeze(Object.fromEntries([...p.scenario.units, ...(Array.isArray(p.scenario.reinforcements) ? p.scenario.reinforcements : [])]
          .filter((u) => u && typeof u.id === 'string' && words(u.commander?.name))
          .map((u) => [u.id, Object.freeze({ name: words(u.commander.name), rank: words(u.commander.rank) })]))),
        // the formation's own lines and sources for the camp's officer card (v4, src/franchise/officers.js officerView), and the
        // scenario's own commander portrait with its note where the pack gives one (the card shows it before the name mapping)
        officers: Object.freeze(Object.fromEntries([...p.scenario.units, ...(Array.isArray(p.scenario.reinforcements) ? p.scenario.reinforcements : [])]
          .filter((u) => u && typeof u.id === 'string' && words(u.commander?.name))
          .map((u) => [u.id, Object.freeze({ formation: words(u.name), parent: words(u.parent), regiments: Object.freeze((Array.isArray(u.regiments) ? u.regiments : []).filter(words)),
            sources: Object.freeze((Array.isArray(u.sources) ? u.sources : []).filter(words).slice(0, 16)),
            portrait: words(u.commander.portrait), portraitNote: words(u.commander.portraitNote) })]))) }))) });
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

const RANK_SHORT = { General: 'Gen.', 'Major General': 'Maj. Gen.', 'Brigadier General': 'Brig. Gen.', Colonel: 'Col.', 'Lieutenant Colonel': 'Lt. Col.', Major: 'Maj.', Captain: 'Capt.',
  Lieutenant: 'Lt.', 'First Lieutenant': '1st Lt.', 'Second Lieutenant': '2nd Lt.' };
/** "Col." from "Colonel" (unknown ranks pass through). */
export const rankShort = (rank) => RANK_SHORT[rank] || rank || '';
/** "Col. Everett Peabody" from a { name, rank } commander. */
export const commanderTitle = (c) => `${rankShort(c.rank)} ${c.name}`.trim();
/** The phase's commanders for the briefing: those its text names first (exact full name), then the player's side, de-duplicated. */
export function briefingCommanders(scenario, side = 'US', max = 6) {
  const b = scenario && typeof scenario.briefing === 'object' && scenario.briefing ? scenario.briefing : {};
  const prose = [...(Array.isArray(b.text) ? b.text : [b.text]), b.quote?.text].map(words).join(' ');
  const units = [...(Array.isArray(scenario?.units) ? scenario.units : []), ...(Array.isArray(scenario?.reinforcements) ? scenario.reinforcements : [])];
  const seen = new Set(), named = [], own = [];
  for (const u of units) {
    const name = words(u?.commander?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const c = { name, rank: words(u.commander.rank), side: u.side, named: prose.includes(name) };
    if (c.named) named.push(c); else if (u.side === side) own.push(c);
  }
  return [...named, ...own].slice(0, max);
}

// ---- commanders' temperament (P3t; DESIGN §4b "AI character") ---------------------------------------------------------
// assets/traits.json (tools/build-traits.mjs) holds each enemy commander's sourced traits: words (label, brief, game-rule
// effect), the claim behind each trait with its opened sources, provenance and notes. The phase's own data says which men
// carry which traits (scenario.commanderTraits, what src/sim/ai.js acts on) and names the army commander
// (scenario.enemyCommander). Shown on the enemy unit card (src/ui/hud.js) and in the Briefing's "Opposing commanders".
let traitsPending = null;
/** assets/traits.json, validated once per page (a failed load may be retried). */
export function loadTraits({ fetcher } = {}) {
  if (!traitsPending) {
    traitsPending = boundedJson('./assets/traits.json', fetcher).then(validTraits);
    traitsPending.catch(() => { traitsPending = null; });
  }
  return traitsPending;
}
/** The traits file's shape (version 1, vocabulary, commanders), or a refusal. */
export function validTraits(t) {
  if (!t || t.version !== 1 || !t.vocabulary || typeof t.vocabulary !== 'object' || !t.commanders || typeof t.commanders !== 'object') throw new Error('Traits: assets/traits.json is invalid.');
  return t;
}
/** The trait keys the phase gives this man (scenario.commanderTraits[name]); [] without. */
export function phaseTraitKeys(scenario, name) {
  const map = scenario && typeof scenario.commanderTraits === 'object' ? scenario.commanderTraits : null;
  return map && words(name) && has(map, name) && Array.isArray(map[name]) ? map[name].filter((k) => typeof k === 'string') : [];
}
/**
 * One man's traits as shown: { name, rank, role, army, traits: [{ key, label, brief, effect }], provenance, provenanceNote, note,
 * evidence: [{ trait, claim, sources }] }, or null when the phase gives him none. Keys from the phase; words from `data`.
 */
export function traitEntry(data, scenario, name, extra = {}) {
  const keys = phaseTraitKeys(scenario, name);
  if (!keys.length) return null;
  const rec = data && data.commanders && has(data.commanders, name) ? data.commanders[name] : null, vocab = (data && data.vocabulary) || {};
  return { name, rank: '', role: '', army: false, ...extra,
    traits: keys.map((k) => ({ key: k, label: words(vocab[k]?.label) || k, brief: words(vocab[k]?.brief), effect: words(vocab[k]?.effect) })),
    provenance: words(rec?.provenance), provenanceNote: words(rec?.provenanceNote), note: rec?.note && words(rec.note.text) ? rec.note : null,
    evidence: keys.map((k) => (Array.isArray(rec?.evidence) ? rec.evidence.find((e) => e && e.trait === k) : null)).filter(Boolean) };
}
/** The army commander of `side` this phase names (scenario.enemyCommander), or null. */
export function phaseArmyCommander(scenario, side) {
  const c = scenario && scenario.enemyCommander;
  return c && typeof c === 'object' && c.side === side && words(c.name) ? c : null;
}
function chainEntry(data, scenario, c) {
  const entry = traitEntry(data, scenario, c.name, { rank: c.rank, role: c.role, chain: true,
    phaseNote: `Command influence: ${c.status} This is a command relationship, not a plotted location or rally radius.`, phaseSources: c.sources });
  if (!entry) return null;
  entry.traits = entry.traits.filter(t => t.key !== 'reckless');
  return entry.traits.length ? entry : null;
}
/** Every entry affecting this card, preserving own/army order for phases without a chain. */
export const formationTraitEntries = t => t ? [t.own, ...(t.chain || []), t.army].filter(Boolean) : [];
/** The traits that apply to formation u: its own commander's (null once he is down) and its army commander's. */
export function formationTraits(data, scenario, u) {
  const c = u && u.commander, general = phaseArmyCommander(scenario, u?.side);
  const chain = chainCommanders(scenario, u).map(c => chainEntry(data, scenario, c)).filter(Boolean);
  return { own: c && words(c.name) && !u.commandDown ? traitEntry(data, scenario, c.name, { rank: words(c.rank), role: 'this formation\'s commander' }) : null,
    ...(chain.length ? { chain } : {}),
    army: general ? traitEntry(data, scenario, general.name, { rank: words(general.rank), role: words(general.role), army: true, status: words(general.status), phaseNote: words(general.note) }) : null };
}
/** Every man on `side` this phase gives traits: the army commander first, then the roster's commanders in order (once each). */
export function traitedCommanders(data, scenario, side) {
  const out = [], seen = new Set(), general = phaseArmyCommander(scenario, side);
  if (general) {
    seen.add(general.name);
    const e = traitEntry(data, scenario, general.name, { rank: words(general.rank), role: words(general.role), army: true, status: words(general.status), phaseNote: words(general.note) });
    if (e) out.push(e);
  }
  for (const c of scenario?.commandChain || []) {
    if (c.side !== side || seen.has(c.name)) continue;
    seen.add(c.name);
    const e = chainEntry(data, scenario, c);
    if (e) out.push(e);
  }
  for (const u of [...(Array.isArray(scenario?.units) ? scenario.units : []), ...(Array.isArray(scenario?.reinforcements) ? scenario.reinforcements : [])]) {
    const name = words(u?.commander?.name);
    if (!name || u.side !== side || seen.has(name)) continue;
    seen.add(name);
    const e = traitEntry(data, scenario, name, { rank: words(u.commander.rank), role: `commanding ${words(u.name) || 'a formation'}` });
    if (e) out.push(e);
  }
  return out;
}
/** "Game rule: a; b." from entries' brief phrases (an army commander's own `reckless` is his alone and left out). */
export function traitRuleLine(entries) {
  const seen = new Set(), parts = [];
  for (const e of entries) for (const t of e ? e.traits : []) {
    if (seen.has(t.key) || (e.army && t.key === 'reckless') || !t.brief) continue;
    seen.add(t.key); parts.push(t.brief);
  }
  return parts.length ? `Game rule: ${parts.join('; ')}.` : '';
}
/**
 * The details of one man's traits (DOM; the card's Records dialog and the Briefing): provenance, notes, and for each trait its
 * game rule, the claim from his record and every opened source as a link with its page and quotation.
 */
export function traitDetails(entry, doc = document, level = 'h3') {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const box = make('section', 'traits-man');
  box.dataset.commander = entry.name;
  box.append(make(level, 'traits-name', `${commanderTitle(entry)}${entry.role ? `, ${entry.role}` : ''}`));
  box.append(make('p', 'traits-prov', `Provenance: ${entry.provenance || 'not given'} (Verified: two independent sources agree; Inferred: one source; Disputed: sources differ).`));
  if (entry.phaseNote) box.append(make('p', 'traits-note', entry.phaseNote));
  if (entry.phaseSources?.length) {
    const p = make('p', 'traits-command-sources', 'Command relationship sources: ');
    for (const [i, source] of entry.phaseSources.entries()) {
      const parsed = briefingSources([source])[0];
      if (!parsed?.href) continue;
      const a = make('a', '', parsed.label || source); a.href = parsed.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      p.append(i ? '; ' : '', a);
    }
    box.append(p);
  }
  if (entry.note) {
    const p = make('p', `traits-note${entry.note.kind === 'record' ? ' is-record' : ''}`, entry.note.text);
    for (const s of Array.isArray(entry.note.sources) ? entry.note.sources : []) {
      const href = briefingSources([s.url])[0]?.href;
      if (!href) continue;
      const a = make('a', '', s.title); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      p.append(' (', a, ')');
    }
    box.append(p);
  }
  const list = make('ul', 'traits-list');
  for (const t of entry.traits) {
    const li = make('li', 'traits-trait');
    li.dataset.trait = t.key;
    li.append(make('p', 'traits-label', t.label));
    if (t.effect) li.append(make('p', 'traits-rule', t.effect));
    const ev = entry.evidence.find((e) => e.trait === t.key);
    if (ev) {
      li.append(make('p', 'traits-claim', `His record: ${ev.claim}`));
      const sources = make('ul', 'traits-sources');
      for (const s of ev.sources || []) {
        const href = briefingSources([s.url])[0]?.href, row = make('li');
        if (href) { const a = make('a', '', s.title); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
        else row.append(make('span', '', s.title));
        row.append(make('span', 'traits-cite', ` — ${s.author}${s.page ? `, ${s.page}` : ''}`));
        if (s.quote) row.append(make('q', 'traits-quote', s.quote));
        sources.append(row);
      }
      li.append(sources);
    }
    list.append(li);
  }
  box.append(list);
  return box;
}

const DEFAULT_LOAN = "Grant's Army of the Tennessee is on loan for this phase. Its results do not change your franchise brigades; losses here carry only inside this battle.";

/** The paused Briefing overlay. Begin (or Escape) closes it, unpauses and focuses the battlefield. */
export function mountBriefing({ scenario, phase, game, hud, effects, onBegin = () => {}, save = null, deck = null }) {
  const b = has(scenario, 'briefing') && scenario.briefing && typeof scenario.briefing === 'object' ? scenario.briefing : {};
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
  const commanders = briefingCommanders(scenario, game?.playerSide || hud?.playerSide || 'US');
  // Opposing commanders (P3t, below): the side the player faces, and assets/traits.json once loaded
  const enemySide = (game?.playerSide || hud?.playerSide || 'US') === 'US' ? 'CS' : 'US';
  let traitData = null;
  if (commanders.length) {
    const slot = el('section', { class: 'briefing-commanders', 'aria-labelledby': 'briefing-commanders-heading', hidden: '' });
    body.append(slot);
    loadArt(); // usually loaded already by the battle HUD
    // whenArt answers at once when the manifest is already in, which is before this dialog is in the page: build the list a
    // microtask later, once mountBriefing has attached the dialog (otherwise the strip stayed hidden with no portraits)
    whenArt((m) => queueMicrotask(() => {
      if (!m || !slot.isConnected) return;
      const list = el('ul', { class: 'briefing-commander-list' });
      for (const c of commanders) {
        const p = portraitArt(c.name, m), g = p ? null : genericPortrait(m);
        const img = el('img', { src: (p || g).src, alt: p ? `Portrait of ${c.name}` : '', decoding: 'async', title: p ? portraitLine(p) : g.caption });
        list.append(el('li', { class: `briefing-commander ${p ? 'is-sourced' : 'is-generic'}`, 'data-commander': c.name },
          el('span', { class: 'briefing-portrait' }, img),
          el('span', { class: 'briefing-commander-name', text: commanderTitle(c) }),
          el('span', { class: 'briefing-commander-note', text: p ? (p.note || (c.side === 'CS' ? 'Confederate' : 'Union')) : 'No sourced portrait' })));
      }
      slot.append(el('h3', { id: 'briefing-commanders-heading', text: 'Commanders' }), list);
      slot.hidden = false;
      stripTraits();
    }));
  }
  // Opposing commanders (P3t): the enemy's army commander and the enemy commanders this phase gives traits, with plain labels,
  // the game rule, the provenance and (in a disclosure) each trait's claim and sources. Nothing shows for a phase without traits.
  function stripTraits() { // trait labels on the portrait strip for a named enemy commander who has them
    if (!traitData) return;
    for (const li of body.querySelectorAll('.briefing-commander[data-commander]')) {
      const e = commanders.find((c) => c.name === li.dataset.commander && c.side === enemySide) ? traitEntry(traitData, scenario, li.dataset.commander) : null;
      if (!e || li.querySelector('.briefing-commander-traits')) continue;
      li.append(el('span', { class: 'briefing-commander-traits', text: e.traits.map((t) => t.label).join(' · ') }));
    }
  }
  if (scenario && scenario.commanderTraits && typeof scenario.commanderTraits === 'object' && Object.keys(scenario.commanderTraits).length) {
    const slot = el('section', { class: 'briefing-opponents', 'aria-labelledby': 'briefing-opponents-heading', hidden: '' });
    body.append(slot);
    loadTraits().then((data) => {
      traitData = data;
      if (!slot.isConnected) return;
      const men = traitedCommanders(data, scenario, enemySide);
      if (!men.length) return;
      const list = el('ul', { class: 'briefing-opponent-list' });
      for (const e of men) {
        const head = el('p', { class: 'briefing-opponent-name' }, el('strong', { text: commanderTitle(e) }), e.role ? `, ${e.role}` : '');
        const chips = el('p', { class: 'briefing-opponent-traits' }, ...e.traits.map((t) => el('span', { class: 'briefing-trait', 'data-trait': t.key, title: t.effect, text: t.label })),
          el('span', { class: 'briefing-trait-prov', text: `Provenance: ${e.provenance || 'not given'}` }));
        const rule = traitRuleLine([{ ...e, army: false }]);
        const more = el('details', { class: 'briefing-opponent-more' }, el('summary', { text: `${e.name}'s record and sources` }));
        more.append(traitDetails(e, document, 'h4'));
        list.append(el('li', { class: 'briefing-opponent', 'data-commander': e.name }, head, chips, rule ? el('p', { class: 'briefing-opponent-rule', text: rule }) : null,
          e.note && e.note.kind === 'record' ? el('p', { class: 'briefing-opponent-note', text: e.note.text }) : null, more));
      }
      slot.append(el('h3', { id: 'briefing-opponents-heading', text: 'Opposing commanders' }),
        el('p', { class: 'sub briefing-opponents-sub', text: 'Each man\'s traits come from his documented record; what they make the enemy do is a game rule.' }), list);
      slot.hidden = false;
      stripTraits();
    }).catch(() => {});
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
  let started = false, stoppedForReload = false;
  function start() {
    if (started || stoppedForReload) return;
    started = true; dialog.close(); dialog.remove();
    effects?.unlock?.();
    game.paused = false; hud.setPaused(false);
    document.getElementById('battlefield')?.focus({ preventScroll: true });
    onBegin();
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); start(); });
  begin.addEventListener('click', start);
  dialog.showModal(); begin.focus({ preventScroll: true });
  return { dialog, begin: start,
    stopForReload() { stoppedForReload=true;dialog.remove(); },
    get open() { return !started && !stoppedForReload; } };
}

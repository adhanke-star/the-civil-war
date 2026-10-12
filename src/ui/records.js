// src/ui/records.js: the franchise record book and the campaign ending (DESIGN §3 Record, §4b Endgame).
//
//   openRecordBook(host, save, { campaign?, fetcher? }) -> { dialog, ready, close() }: a modal dialog over `host` (Esc or
//     Close shuts it and focus returns to the opener). Per battle and phase: the grade of every attempt (replays marked),
//     your losses against the sourced historical losses; per franchise brigade: phases fought, badges, the X-Factor and its
//     best capture; the army's best captures; the campaign grade and a medal per battle. The camp opens it with
//     import('./records.js').then((m) => m.openRecordBook(document.body, save)).
//   openCampaignEnding(host, save, { campHref?, onClose?, campaign?, fetcher? }) -> { dialog, ready, close() }: after the
//     ladder's last phase: the campaign grade, the medals, a short sourced epilogue and the buttons Record book / Title.
//   Pure (Node-safe, tools/test-history.mjs): campaignGrade(history, ladder?), buildRecordBook(save, { campaign?, packs? }),
//     summarizePack(pack), EPILOGUE, CAMPAIGN_RULE, GRADE_POINTS, MEDALS.
//
// The campaign grade is a GAME RULE (CAMPAIGN_RULE, said on screen): each phase scores its best recorded grade (Decisive 3,
// Victory 2, Draw 1, Defeat 0), less half a point when it was replayed; a battle's medal is the mean of its phases (Gold from
// 2.5, Silver from 1.75, Bronze from 1, none below); the campaign grade is the mean over every phase fought (Decisive from
// 2.5, Victory from 1.75, Draw from 1, else Defeat). Historical losses come from each pack phase's sourced history block
// (assets/packs/<id>.json, scenario.history.casualties), with "no sourced figure" where the research found none.
// No DOM work at import time.
import { loadCampaign } from './briefing.js';
import { itemDef, TIER_BY_ID, VETERANCY } from '../reward/data.js';
import { BADGE_BY_ID, TIER_NAMES } from '../franchise/badges.js';

export const GRADE_POINTS = Object.freeze({ Decisive: 3, Victory: 2, Draw: 1, Defeat: 0 });
export const MEDALS = Object.freeze([
  Object.freeze({ id: 'gold', name: 'Gold medal', mark: '★', from: 2.5 }),
  Object.freeze({ id: 'silver', name: 'Silver medal', mark: '◆', from: 1.75 }),
  Object.freeze({ id: 'bronze', name: 'Bronze medal', mark: '●', from: 1 }),
]);
const NO_MEDAL = Object.freeze({ id: 'none', name: 'No medal', mark: '○', from: 0 });
export const CAMPAIGN_RULE = 'Game rule: each phase scores its best recorded grade (Decisive 3, Victory 2, Draw 1, Defeat 0), less half a point if it was replayed. '
  + 'A battle\'s medal is the mean of its phases: Gold from 2.5, Silver from 1.75, Bronze from 1. The campaign grade is the mean of every phase fought: '
  + 'Decisive from 2.5, Victory from 1.75, Draw from 1, otherwise Defeat.';

/**
 * What the Army of the Cumberland did next. The first paragraph is from the Chattanooga research (CH3); the second is
 * Inferred: it rests on the frozen old build's Peachtree Creek file and was not re-read this session.
 */
export const EPILOGUE = Object.freeze({
  paragraphs: Object.freeze([
    Object.freeze({ text: 'After Missionary Ridge, Bragg\'s army retreated toward Dalton, Georgia; Cleburne\'s stands at Tunnel Hill and Ringgold Gap kept it from complete ruin. The siege of Chattanooga, which had held the Army of the Cumberland since Chickamauga, was over.',
      provenance: 'From the Chattanooga research: NPS Civil War Series 9 and the American Battlefield Trust' }),
    Object.freeze({ text: 'In 1864 Thomas\'s Army of the Cumberland marched with Sherman\'s armies toward Atlanta. On 20 July 1864 Hood attacked it at Peachtree Creek, with the creek at its back, and the attack failed.',
      provenance: 'Inferred: from the frozen old build\'s Peachtree Creek file, which cites the Official Records Ser. I Vol. XXXVIII (Sherman\'s and Thomas\'s reports); not re-checked for this game' }),
  ]),
  sources: Object.freeze([
    Object.freeze({ label: 'Cozzens, The Battles for Chattanooga (NPS Civil War Series 9), sec7', url: 'https://npshistory.com/publications/civil_war_series/9/sec7.htm' }),
    Object.freeze({ label: 'American Battlefield Trust, Chattanooga', url: 'https://www.battlefields.org/learn/civil-war/battles/chattanooga' }),
    Object.freeze({ label: 'Official Records Ser. I Vol. XXXVIII Pt. 1 (Sherman\'s and Thomas\'s reports), as cited by the old build (not re-read)' }),
  ]),
});

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const round2 = (n) => Math.round(n * 100) / 100;
const medalFor = (score) => MEDALS.find((m) => score >= m.from) || NO_MEDAL;
const gradeFor = (score) => (score >= 2.5 ? 'Decisive' : score >= 1.75 ? 'Victory' : score >= 1 ? 'Draw' : 'Defeat');
const fmt = (n) => Number(n).toLocaleString('en-US');
const tierRank = (tier) => TIER_BY_ID[tier]?.rank ?? -1;
const titleCase = (id) => String(id).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * The campaign grade (game rule above) from a campaign history ([{ packId, phaseId, grade, replay }]). `ladder` (the
 * campaign's phases, [{ packId, phaseId }]) orders the battles; a battle or phase not on it follows in history order.
 */
export function campaignGrade(history, ladder = null) {
  const rows = Array.isArray(history) ? history.filter((r) => r && has(GRADE_POINTS, r.grade)) : [];
  const phases = new Map();
  for (const r of rows) {
    const key = `${r.packId}/${r.phaseId}`;
    if (!phases.has(key)) phases.set(key, { packId: r.packId, phaseId: r.phaseId, attempts: 0, best: -1, replayed: false });
    const p = phases.get(key);
    p.attempts++; p.best = Math.max(p.best, GRADE_POINTS[r.grade]); p.replayed = p.replayed || r.replay === true || p.attempts > 1;
  }
  const order = [...(Array.isArray(ladder) ? ladder.map((p) => `${p.packId}/${p.phaseId}`) : []), ...phases.keys()];
  const scored = [...new Set(order)].filter((k) => phases.has(k)).map((k) => {
    const p = phases.get(k);
    return { ...p, score: Math.max(0, p.best - (p.replayed ? 0.5 : 0)) };
  });
  const battles = [];
  for (const p of scored) {
    let b = battles.find((x) => x.packId === p.packId);
    if (!b) battles.push(b = { packId: p.packId, phases: [] });
    b.phases.push(p);
  }
  for (const b of battles) { b.score = round2(b.phases.reduce((n, p) => n + p.score, 0) / b.phases.length); b.medal = medalFor(b.score); }
  const score = scored.length ? round2(scored.reduce((n, p) => n + p.score, 0) / scored.length) : null;
  return { grade: score === null ? null : gradeFor(score), score, phases: scored.length, battles, rule: CAMPAIGN_RULE };
}

/** A pack's titles, historical casualties and rosters by phase (for the record book), from the pack's JSON. */
export function summarizePack(pack) {
  if (!pack || typeof pack !== 'object' || !Array.isArray(pack.phases)) throw new Error('Records: a pack summary needs a battle pack.');
  return { packId: String(pack.id), title: String(pack.title || titleCase(pack.id)), phases: Object.fromEntries(pack.phases.map((p) => {
    const s = p.scenario || {};
    return [p.id, { title: String(s.title || p.id), date: s.date || null, casualties: s.history?.casualties ? { ...s.history.casualties } : null,
      units: [...(s.units || []), ...(s.reinforcements || [])].map((u) => u.id) }];
  })) };
}

function captureOf(item) {
  if (!item || typeof item !== 'object' || typeof item.itemId !== 'string') return null;
  if (item.source !== 'capture' && !/^Captured\b/.test(String(item.from || ''))) return null;
  let name = item.itemId;
  try { name = itemDef(item.itemId).name; } catch { /* an unknown item keeps its id */ }
  return { uid: item.uid, itemId: item.itemId, name, tier: item.tier, tierName: TIER_BY_ID[item.tier]?.name ?? item.tier, from: String(item.from || '') };
}
const byTier = (a, b) => tierRank(b.tier) - tierRank(a.tier) || String(a.uid).localeCompare(String(b.uid));

/**
 * The record book's data (pure). `campaign` is the ladder definition ({ id, title, phases: [{ packId, phaseId, loan? }] })
 * and `packs` maps packId to summarizePack(pack); both are optional (titles fall back to ids, history to "no sourced figure").
 */
export function buildRecordBook(save, { campaign = null, packs = {} } = {}) {
  const v2 = !!save && save.version === 2 && save.kind === 'campaign' && has(save, 'campaign');
  const c = v2 ? save.campaign : null;
  const history = c && Array.isArray(c.history) ? c.history : [];
  const ladder = campaign && Array.isArray(campaign.phases) ? campaign.phases : null;
  const grade = campaignGrade(history, ladder);
  const phaseTitle = (packId, phaseId) => packs[packId]?.phases?.[phaseId]?.title ?? `${titleCase(packId)} · ${titleCase(phaseId)}`;
  const battles = grade.battles.map((b) => ({ packId: b.packId, title: packs[b.packId]?.title ?? titleCase(b.packId), score: b.score, medal: b.medal,
    phases: b.phases.map((p) => {
      const attempts = history.filter((r) => r.packId === p.packId && r.phaseId === p.phaseId).map((r) => ({ awardId: r.awardId, grade: r.grade, winner: r.winner,
        lossesUS: r.lossesUS, lossesCS: r.lossesCS, replay: r.replay === true }));
      const loan = !!ladder?.find((x) => x.packId === p.packId && x.phaseId === p.phaseId)?.loan;
      return { phaseId: p.phaseId, title: phaseTitle(p.packId, p.phaseId), loan, score: p.score, replayed: p.replayed, attempts,
        history: packs[p.packId]?.phases?.[p.phaseId]?.casualties ?? null };
    }) }));
  // phases each franchise brigade fought: its unit id on the phase's roster, off loan, among the phases recorded
  const fought = (unitId) => {
    if (!unitId) return null;
    const out = [], seen = new Set();
    for (const r of history) {
      const key = `${r.packId}/${r.phaseId}`, roster = packs[r.packId]?.phases?.[r.phaseId]?.units;
      if (seen.has(key) || !Array.isArray(roster)) continue;
      const loan = !!ladder?.find((x) => x.packId === r.packId && x.phaseId === r.phaseId)?.loan;
      if (!loan && roster.includes(unitId)) { seen.add(key); out.push({ packId: r.packId, phaseId: r.phaseId, title: phaseTitle(r.packId, r.phaseId) }); }
    }
    return out;
  };
  const known = Object.keys(packs).length > 0;
  const army = Array.isArray(save?.army) ? save.army : [];
  const brigades = army.map((b) => {
    const badges = (Array.isArray(b.badges) ? b.badges : []).filter((x) => BADGE_BY_ID[x.id]).map((x) => ({ id: x.id, name: BADGE_BY_ID[x.id].name, tier: x.tier,
      tierName: TIER_NAMES[x.tier] ?? x.tier, xfactor: b.xfactor === x.id }));
    const capture = captureOf(b.weapon);
    return { id: b.id, label: b.label, kind: b.kind, men: b.men, vet: VETERANCY.find((v) => v.id === b.vet)?.name ?? b.vet,
      phases: known ? fought(b.unitId) : null, badges, xfactor: b.xfactor ? BADGE_BY_ID[b.xfactor]?.name ?? b.xfactor : null, bestCapture: capture };
  });
  const captures = [...army.map((b) => captureOf(b.weapon)), ...(Array.isArray(save?.depot) ? save.depot : []).map(captureOf)].filter(Boolean).sort(byTier);
  return { campaignId: c?.id ?? null, title: campaign?.title ?? (c ? titleCase(c.id) : 'Practice army'), status: c?.status ?? null,
    complete: c?.status === 'complete', grade, battles, brigades, captures: captures.slice(0, 5), replays: history.filter((r) => r.replay).length };
}

// ---- DOM ------------------------------------------------------------------------------------------------------------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}
function ensureCss() {
  if (!document.querySelector('link[data-records-css]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./records.css', import.meta.url).href, 'data-records-css': true }));
  }
}
async function packJson(packId, fetcher) {
  if (!/^[a-z0-9-]{1,40}$/.test(packId)) throw new Error('Records: invalid pack id.');
  const r = await fetcher(`./assets/packs/${packId}.json`);
  if (!r.ok) throw new Error(`Records: ${packId} could not be loaded.`);
  const text = await r.text();
  if (text.length > 1024 * 1024) throw new Error(`Records: ${packId} exceeds its download bound.`);
  return JSON.parse(text);
}
/** The ladder and every pack the save or ladder names; anything that fails to load is left out (the book still opens). */
async function loadContext(save, { campaign = null, fetcher = globalThis.fetch } = {}) {
  let ladder = campaign;
  if (!ladder) { try { ladder = (await loadCampaign({ fetcher }))?.def ?? null; } catch { ladder = null; } }
  if (ladder && save?.campaign?.id && ladder.id !== save.campaign.id) ladder = null;
  const ids = new Set([...(ladder?.phases ?? []).map((p) => p.packId), ...(save?.campaign?.history ?? []).map((r) => r.packId)]);
  const packs = {};
  await Promise.all([...ids].map(async (id) => { try { packs[id] = summarizePack(await packJson(id, fetcher)); } catch { /* left out */ } }));
  return { campaign: ladder, packs };
}
const medalNode = (m) => el('span', { class: `rb-medal rb-medal-${m.id}`, 'data-medal': m.id },
  el('span', { class: 'rb-medal-mark', 'aria-hidden': 'true', text: m.mark }), el('span', { text: m.name }));
const lossCell = (v) => (v === null || v === undefined ? 'no sourced figure' : Array.isArray(v) ? `${fmt(v[0])}–${fmt(v[1])}` : fmt(v));

/** One modal dialog shell: heading, close button, body; Esc and Close remove it and give focus back to the opener. */
function shell(host, { id, eyebrow, title, extraClass = '' }) {
  ensureCss();
  const opener = document.activeElement;
  const heading = el('h2', { class: 'rb-title', id: `${id}-title`, tabindex: '-1', text: title });
  const close = el('button', { type: 'button', class: 'rb-close', 'aria-label': 'Close' }, el('span', { 'aria-hidden': 'true', text: '×' }), el('span', { class: 'rb-close-text', text: 'Close' }));
  // the body scrolls: focusable so keyboard users can scroll it (axe scrollable-region-focusable)
  const body = el('div', { class: 'rb-body', 'aria-busy': 'true', tabindex: '0', role: 'region', 'aria-label': title },
    el('p', { class: 'rb-dim', text: 'Loading the record…' }));
  const dialog = el('dialog', { class: `rb ${extraClass}`.trim(), id, 'aria-labelledby': `${id}-title` },
    el('header', { class: 'rb-head' }, el('div', {}, el('p', { class: 'rb-eyebrow', text: eyebrow }), heading), close), body);
  host.append(dialog);
  let closed = false;
  const done = () => {
    if (closed) return; closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  };
  close.addEventListener('click', done);
  dialog.addEventListener('close', done);
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  heading.focus({ preventScroll: true });
  return { dialog, body, heading, close: done, isClosed: () => closed };
}

function gradeSection(book, prefix = 'rb') {
  const g = book.grade;
  return el('section', { class: 'rb-section rb-grade', 'aria-labelledby': `${prefix}-grade-h` },
    el('h3', { id: `${prefix}-grade-h`, text: 'Campaign grade' }),
    el('p', { class: 'rb-grade-v', 'data-grade': g.grade ?? 'none' }, g.grade ? `${g.grade}` : 'No phase fought yet',
      g.score === null ? null : el('span', { class: 'rb-dim', text: ` · ${g.score.toFixed(2)} of 3 over ${g.phases} phase${g.phases === 1 ? '' : 's'}` })),
    book.battles.length ? el('ul', { class: 'rb-medals', 'aria-label': 'Medals by battle' }, ...book.battles.map((b) => el('li', {}, el('b', { text: b.title }), medalNode(b.medal)))) : null,
    el('p', { class: 'rb-rule' }, el('span', { class: 'rb-tag', text: 'Game rule' }), ` ${CAMPAIGN_RULE.replace(/^Game rule: /, '')}`));
}

function renderBook(body, book) {
  body.replaceChildren();
  body.removeAttribute('aria-busy');
  body.append(gradeSection(book));
  const battles = el('section', { class: 'rb-section', 'aria-labelledby': 'rb-battles-h' }, el('h3', { id: 'rb-battles-h', text: 'Battles and phases' }));
  if (!book.battles.length) battles.append(el('p', { class: 'rb-dim', text: 'No phase fought yet.' }));
  for (const b of book.battles) {
    const table = el('table', { class: 'rb-table' },
      el('caption', {}, el('span', { text: b.title }), ' ', medalNode(b.medal)),
      el('thead', {}, el('tr', {}, ...['Phase', 'Grade', 'Your losses (Union / Confederate)', 'History (Union / Confederate)'].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ...b.phases.flatMap((p) => p.attempts.map((a, i) => el('tr', { 'data-replay': String(a.replay) },
        el('th', { scope: 'row' }, i === 0 ? p.title : '', i === 0 && p.loan ? el('span', { class: 'rb-dim', text: ' (Grant\'s army on loan)' }) : null),
        el('td', {}, el('span', { text: a.grade }), a.replay ? el('span', { class: 'rb-tag rb-replay', text: 'Replay' }) : null),
        el('td', { text: `${fmt(a.lossesUS)} / ${fmt(a.lossesCS)}` }),
        el('td', { text: p.history ? `${lossCell(p.history.US)} / ${lossCell(p.history.CS)} (${p.history.provenance})` : 'no sourced figure' }))))));
    battles.append(el('div', { class: 'rb-scroll' }, table));
  }
  battles.append(el('p', { class: 'rb-dim', text: 'Your losses are whole men in a scaled, compressed fight; historical losses are as sourced, often for a longer span than the phase (the after-action gives the basis).' }));
  body.append(battles);

  const army = el('section', { class: 'rb-section', 'aria-labelledby': 'rb-army-h' }, el('h3', { id: 'rb-army-h', text: 'Brigades' }));
  const list = el('ul', { class: 'rb-brigades' });
  for (const b of book.brigades) {
    list.append(el('li', { class: 'rb-brigade', 'data-brigade': b.id },
      el('b', { class: 'rb-brigade-name', text: b.label }),
      el('span', { class: 'rb-dim', text: ` · ${b.vet} · ${fmt(b.men)} men` }),
      el('p', { text: b.phases === null ? 'Phases fought: not known (the battle packs did not load).' : b.phases.length ? `Phases fought (${b.phases.length}): ${b.phases.map((p) => p.title).join(', ')}.` : 'Phases fought: none yet.' }),
      el('p', { text: b.badges.length ? `Badges: ${b.badges.map((x) => `${x.name} (${x.tierName})${x.xfactor ? ', X-Factor' : ''}`).join('; ')}.` : 'Badges: none yet.' }),
      el('p', { text: b.bestCapture ? `Best capture: ${b.bestCapture.name} (${b.bestCapture.tierName}).` : 'Best capture: none carried.' })));
  }
  army.append(book.brigades.length ? list : el('p', { class: 'rb-dim', text: 'No brigades in this army.' }));
  body.append(army);

  const caps = el('section', { class: 'rb-section', 'aria-labelledby': 'rb-caps-h' }, el('h3', { id: 'rb-caps-h', text: 'Best captures' }));
  caps.append(book.captures.length ? el('ol', { class: 'rb-captures' }, ...book.captures.map((x) => el('li', { 'data-tier': x.tier },
    el('b', { text: x.name }), el('span', { class: 'rb-dim', text: ` · ${x.tierName} · ${x.from}` }))))
    : el('p', { class: 'rb-dim', text: 'No captured arms yet. Overrun batteries, held ground and surrenders bring them in.' }));
  body.append(caps);
}

export function openRecordBook(host, save, opts = {}) {
  const s = shell(host || document.body, { id: 'record-book', eyebrow: 'Record book', title: 'The record' });
  const ready = loadContext(save, opts).then((ctx) => {
    if (s.isClosed()) return null;
    const book = buildRecordBook(save, ctx);
    s.heading.textContent = book.title;
    renderBook(s.body, book);
    return book;
  }).catch((err) => {
    if (!s.isClosed()) { s.body.removeAttribute('aria-busy'); s.body.replaceChildren(el('p', { class: 'rb-dim', text: `The record could not be read (${err.message}).` })); }
    return null;
  });
  return { dialog: s.dialog, ready, close: s.close };
}

export function openCampaignEnding(host, save, { campHref = './?camp', onClose = null, ...opts } = {}) {
  const s = shell(host || document.body, { id: 'campaign-ending', eyebrow: 'Campaign complete', title: 'The campaign is over', extraClass: 'rb-ending' });
  s.dialog.addEventListener('close', () => { if (typeof onClose === 'function') onClose(); }, { once: true });
  const epilogue = el('section', { class: 'rb-section rb-epilogue', 'aria-labelledby': 'ce-epilogue-h' }, el('h3', { id: 'ce-epilogue-h', text: 'What came next' }),
    ...EPILOGUE.paragraphs.map((p) => el('p', {}, p.text, el('span', { class: 'rb-prov', text: ` (${p.provenance})` }))),
    el('ul', { class: 'rb-sources', 'aria-label': 'Sources' }, ...EPILOGUE.sources.map((x) => el('li', {}, x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: x.label }) : el('span', { text: x.label })))));
  const book = el('button', { type: 'button', class: 'rb-primary', id: 'campaign-ending-book', text: 'Record book' });
  const title = el('button', { type: 'button', class: 'rb-secondary', id: 'campaign-ending-home', text: 'Title' });
  const camp = el('a', { class: 'rb-link', href: campHref, text: 'Back to camp' });
  book.addEventListener('click', () => openRecordBook(document.body, save, opts));
  title.addEventListener('click', () => { location.assign('./'); });
  // First drawn at once from the save alone; when the ladder and packs load only the grade section is swapped (focus stays).
  let grade = null;
  const render = (ctx) => {
    const b = buildRecordBook(save, ctx), next = gradeSection(b, 'ce');
    s.heading.textContent = `${b.title}: the campaign is over`;
    if (grade) grade.replaceWith(next);
    else s.body.replaceChildren(next, epilogue, el('div', { class: 'rb-actions' }, book, title, camp));
    grade = next;
    s.body.removeAttribute('aria-busy');
    return b;
  };
  render({ campaign: opts.campaign ?? null, packs: {} });
  const ready = loadContext(save, opts).then((ctx) => (s.isClosed() ? null : render(ctx))).catch(() => null);
  return { dialog: s.dialog, ready, close: s.close };
}

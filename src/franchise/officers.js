// src/franchise/officers.js: officers' campaign records and Merit (v4 OFFICERS contract). Pure functions over plain objects:
// no DOM, storage or field allocation (save.js validates what recordOfficers writes; campaign.js calls it).
//
// LAW: never invent a person, unit, rank or presence. A commander's name and rank come from the pack phase being played
// (the field definition's `commander`); the game never changes rank text. A rank change is read from pack data only: a later
// ladder phase that gives the same name a different rank (rankHistory / rankChanges).
//
//   MERIT, OFFICER_LIMITS, OFFICER_EVENTS, MERIT_NOTE   the game rule's numbers, bounds and the label shown with every Merit
//   officerRecord(save, name) -> { name, merit, record, killed }   (empty record and Merit 0 for an unknown name or older save;
//                                          `killed` is the entry's own flag, so trimming old rows never revives his Merit)
//   meritOf(save, name) -> 0..3          meritEffects(merit) -> { radius, steady } multipliers
//   meritEffectText(merit, { campaign, killed, kind })   the card's one effect line ('infantry'/'cavalry' vs 'battery'/'artillery')
//   applyMerit(scenario, save, { loan }) -> a NEW scenario: franchise brigades carry `officer` (their commander's Merit and
//                                          record, for the battle card) and, while the Merit applies, meritRadius/meritSteady
//   officerRows({ game, scenario })      -> the phase result's officer rows (who led each Union formation and how it ended)
//   validateOfficerRows(rows, unitIds)   -> canonical rows (recordPhase input)
//   recordOfficers(save, ctx)            -> { save, summary }: Merit changes, records, wounded/killed events, and took-command
//                                          only for a successor the pack names (never inferred from a new name on a brigade)
//   noteOfficers(summary) / officerAward(awardId)   the after-action's view of one recorded award (same page only)
//   rankHistory(name, packs, ladder?)    -> [{ packId, phaseId, packTitle, title, rank, unitId }] in ladder order
//   rankChanges(rows)                    -> [{ from, to, packId, phaseId, packTitle, title }] where the sourced rank differs
//   officerLines(save, { packs, ladder, titleOf })   -> the camp's "Officers" lines (Merit changes, sourced rank changes)
//   officerView(input)                   -> the officer card's plain view model (src/reward/sequence.js draws it)
//   officerPortrait(portrait, note)      -> { src, note } | null: the scenario's own commander portrait (card and camp row)
//
// GAME RULES (named so in code and on the card; Merit is a game value, never history):
// - Merit is kept per commander name per franchise save, 0-3. +1 when his brigade ends a battle's last phase at Victory or
//   better with at least half its men (the veterancy tier-up gate in campaign.js recordPhase, so never on a replay); -1 when
//   it ends a phase broken (routing or destroyed) or surrendered. A loan phase (Grant's Shiloh army) earns and records nothing.
// - Effects, campaign play only (applyCampaign is the one caller of applyMerit), read from the field definition:
//   steadiness +2 % per Merit (the morale-loss factor of src/game.js commandFactor) for his own formation while he leads it,
//   and the rally radius +10 % per Merit. The radius bonus acts only where a general's rally is what reaches the formation:
//   a battery, which has no commander figure (src/units/unit.js unit.officer is infantry and cavalry only). An infantry or
//   cavalry brigade is rallied by its own commander while he is up and loses the bonus with him (src/game.js meritOf), so
//   for it Merit is steadiness only. The card says exactly this (meritEffectText's kind).
// - A commander killed in play keeps his record; his Merit stays with the name, never changes again and no longer applies.
// - One Merit change per name per recorded phase, however many franchise formations the pack gives him there: -1 if any of
//   them ended broken or surrendered, else +1 if any met the gate.
// - "Took command" is shown only for a successor the pack itself names for a fallen commander. A different name on the same
//   brigade in a later phase is NOT an event: the pack says who led it then, not when he took over (that would be invented).

export const MERIT = Object.freeze({ max: 3, radius: 0.10, steady: 0.02 });
const COMMAND_RADIUS = 300; // m: src/game.js COMMAND.radius, a general's rally radius (named here for the card's words; checked in tools/test-officers.mjs)
export const OFFICER_LIMITS = Object.freeze({ names: 128, records: 24, name: 100 }); // the shipped ladder names 63 (D-v4 officers)
export const OFFICER_EVENTS = Object.freeze(['wounded', 'killed', 'took-command']);
export const OFFICER_ENDS = Object.freeze(['steady', 'broken', 'surrendered']);
export const MERIT_NOTE = 'Merit is a game value earned by this brigade\'s results';
const WINS = ['Decisive', 'Victory'];
const fail = (message) => { throw new Error(`Officers: ${message}`); };
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const text = (v) => typeof v === 'string' && !!v.trim();
const clampMerit = (n) => Math.max(0, Math.min(MERIT.max, n));

function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}

/** One name's record in a save: { name, merit, record, killed } (Merit 0, no rows for a name the save has never seen). */
export function officerRecord(save, name) {
  const e = save && save.officers && typeof name === 'string' && has(save.officers, name) ? save.officers[name] : null;
  const record = e && Array.isArray(e.record) ? e.record.map((r) => ({ ...r })) : [];
  return { name, merit: e && Number.isSafeInteger(e.merit) ? clampMerit(e.merit) : 0, record, killed: !!e && (e.killed === true || record.some((r) => r.event === 'killed')) };
}
export const meritOf = (save, name) => officerRecord(save, name).merit;
/** The field multipliers for a Merit (1 and 1 at Merit 0). */
export const meritEffects = (merit) => ({ radius: 1 + MERIT.radius * clampMerit(merit | 0), steady: 1 + MERIT.steady * clampMerit(merit | 0) });
/** Formation kinds with a commander figure (src/units/unit.js unit.officer): his own rally, so no general's radius bonus. */
const FIGURE_KINDS = ['infantry', 'cavalry'], GUN_KINDS = ['battery', 'artillery'];
/**
 * The effect in one line, labelled a game rule: exactly what Merit does for HIS formation (src/game.js). `kind` is the
 * formation's ('infantry', 'cavalry', 'battery' or 'artillery'); unknown, the line names both cases.
 */
export function meritEffectText(merit, { campaign = true, killed = null, kind = null } = {}) {
  if (!campaign) return 'Game rule: Merit applies only to your campaign army; it adds nothing in Battles, the sandbox or practice.';
  if (killed) return `Game rule: killed at ${killed}, his Merit stays on his record and no longer applies.`;
  const m = clampMerit(merit | 0), pc = (x) => Math.round(x * 100), r1 = pc(MERIT.radius), s1 = pc(MERIT.steady);
  const radius = Math.round(COMMAND_RADIUS * (1 + MERIT.radius * m));
  if (!m) return `Game rule, campaign battles only: each Merit makes his brigade ${s1} % steadier while he leads it (for a battery, which has no commander figure, a general's rally also reaches it ${r1} % farther); Merit 0 adds nothing.`;
  if (FIGURE_KINDS.includes(kind)) return `Game rule, campaign battles only: steadiness +${s1 * m} % (${s1} % per Merit) for his brigade while he leads it. The wider rally radius of Merit is for batteries only, which have no commander figure.`;
  if (GUN_KINDS.includes(kind)) return `Game rule, campaign battles only: a battery has no commander figure, so a general's rally reaches it from ${radius} m instead of ${COMMAND_RADIUS} m (${r1} % per Merit), and it is ${s1 * m} % steadier (${s1} % per Merit) while rallied.`;
  return `Game rule, campaign battles only: steadiness +${s1 * m} % (${s1} % per Merit) for his brigade while he leads it; for a battery, which has no commander figure, a general's rally also reaches it ${r1 * m} % farther (${radius} m).`;
}

/**
 * A NEW scenario with the commanders' Merit on the franchise brigades' field definitions (the input is never changed).
 * `officer` { merit, active, record } is display data for the battle card; `meritRadius` and `meritSteady` (src/game.js reads
 * them, default 1) appear only while the Merit applies (above 0, commander not killed). A loan phase is returned unchanged.
 */
export function applyMerit(scenario, save, { loan = false } = {}) {
  if (loan || !save || save.version !== 2 || !scenario || !Array.isArray(scenario.units)) return scenario;
  const side = save.campaign?.side || 'US';
  const army = new Set(save.army.filter((b) => typeof b.unitId === 'string').map((b) => b.unitId));
  const stamp = (d) => {
    if (!d || d.side !== side || !army.has(d.id) || !d.commander || !text(d.commander.name)) return d;
    const r = officerRecord(save, d.commander.name), active = r.merit > 0 && !r.killed, fx = meritEffects(r.merit);
    return { ...d, officer: { merit: r.merit, active, record: r.record }, ...(active ? { meritRadius: fx.radius, meritSteady: fx.steady } : {}) };
  };
  return { ...scenario, units: scenario.units.map(stamp), ...(Array.isArray(scenario.reinforcements) ? { reinforcements: scenario.reinforcements.map(stamp) } : {}) };
}

/**
 * Who led each Union formation that took the field and how it ended: [{ unitId, name, end, event?, successor? }]. The name is
 * the pack's (the definition's commander); `event` comes from the field's commander events (game.result.officers, src/game.js);
 * `successor` only where the pack names one for him. Formations that never arrived are left out.
 */
export function officerRows({ game, scenario }) {
  const side = game?.playerSide === 'CS' ? 'CS' : 'US';
  const live = new Map((Array.isArray(game?.units) ? game.units : []).map((u) => [u.id, u]));
  const down = new Map((Array.isArray(game?.result?.officers) ? game.result.officers : []).filter((r) => r && OFFICER_EVENTS.includes(r.kind)).map((r) => [r.unitId, r]));
  const rows = [];
  for (const d of [...(scenario?.units || []), ...(scenario?.reinforcements || [])]) {
    const u = live.get(d?.id);
    if (!u || d.side !== side || !d.commander || !text(d.commander.name)) continue;
    const end = u.state === 'captured' ? 'surrendered' : u.state === 'routing' || !(u.men >= 1) ? 'broken' : 'steady';
    const hit = down.get(d.id), event = hit && hit.name === d.commander.name ? hit.kind : null;
    const next = event && d.commander.successor && text(d.commander.successor.name) ? d.commander.successor.name : null;
    rows.push({ unitId: d.id, name: d.commander.name, end, ...(event ? { event } : {}), ...(next ? { successor: next } : {}) });
  }
  return rows;
}

/** Canonical officer rows for recordPhase: each names a formation of the result once. */
export function validateOfficerRows(rows, unitIds) {
  if (!Array.isArray(rows) || rows.length > Math.max(0, unitIds.size)) fail('invalid officer rows.');
  const seen = new Set();
  const name = (v) => {
    if (!text(v) || v.length > OFFICER_LIMITS.name || /[\u0000-\u001f\u007f]/.test(v)) fail('invalid officer name.');
    return v;
  };
  return rows.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => !['unitId', 'name', 'end', 'event', 'successor'].includes(k))) fail('an officer row has unsupported fields.');
    if (!unitIds.has(r.unitId) || seen.has(r.unitId)) fail('an officer row does not name one formation of this result.');
    seen.add(r.unitId);
    if (!OFFICER_ENDS.includes(r.end) || (has(r, 'event') && !['wounded', 'killed'].includes(r.event))) fail('unknown officer end or event.');
    if (has(r, 'successor') && !has(r, 'event')) fail('a successor takes command only when his commander falls.');
    return { unitId: r.unitId, name: name(r.name), end: r.end, ...(has(r, 'event') ? { event: r.event } : {}), ...(has(r, 'successor') ? { successor: name(r.successor) } : {}) };
  });
}

/**
 * Officers for one recorded phase (save is recordPhase's draft, history already holding this phase). ctx: { awardId, packId,
 * phaseId, grade, units (validated result rows), officers (validated officer rows), loan, battleEnd, replay }. Returns the
 * next save (not validated) and the after-action summary { awardId, loan, changes: [{ name, from, to }], events: [...], dropped }.
 * A record row is { pack, phase, unit, grade, lost, from?, merit?, event? }: `from` and `merit` (his Merit before and after)
 * only on the one row per name and phase where it changed, so the camp's "Merit a → b" survives the oldest rows being trimmed.
 */
export function recordOfficers(save, { awardId, packId, phaseId, grade, units = [], officers = [], loan = false, battleEnd = false, replay = false } = {}) {
  const summary = { awardId, loan: loan === true, changes: [], events: [], dropped: 0 };
  if (loan || !officers.length) return { save, summary: frozen(summary) };
  const army = new Set(save.army.filter((b) => typeof b.unitId === 'string').map((b) => b.unitId));
  const byUnit = new Map(units.map((u) => [u.id, u]));
  const book = Object.fromEntries(Object.entries(save.officers || {}).map(([k, e]) => [k, { merit: e.merit, record: e.record.map((r) => ({ ...r })), ...(e.killed === true ? { killed: true } : {}) }]));
  const touched = new Set();
  const write = (name, row, merit) => {
    const e = book[name] || { merit: 0, record: [] }, killed = e.killed === true || row.event === 'killed';
    book[name] = { merit, record: [...e.record, row].slice(-OFFICER_LIMITS.records), ...(killed ? { killed: true } : {}) }; // the newest rows are kept
    touched.add(name);
  };
  // Pass 1: each franchise formation's row and Merit vote, gathered by name (one Merit change per name per phase).
  const rows = [], votes = new Map();
  for (const r of officers) {
    const u = byUnit.get(r.unitId);
    if (!u || !army.has(r.unitId)) continue; // only franchise brigades keep officers' records
    const lost = u.menStart - u.men, lostHalf = u.menStart > 0 && lost * 2 >= u.menStart;
    const vote = r.end !== 'steady' ? -1 : !replay && battleEnd && u.men > 0 && !lostHalf && WINS.includes(grade) ? 1 : 0;
    const v = votes.get(r.name) ?? 0;
    votes.set(r.name, v < 0 || vote < 0 ? -1 : Math.max(v, vote));
    rows.push({ r, lost });
  }
  // Pass 2: write each row; the name's Merit change goes on his last row of this phase.
  const lastRow = new Map(rows.map(({ r }, i) => [r.name, i]));
  rows.forEach(({ r, lost }, i) => {
    const before = officerRecord({ officers: book }, r.name);
    const delta = lastRow.get(r.name) !== i || before.killed ? 0 : votes.get(r.name); // a fallen commander's Merit stays as it was
    const merit = clampMerit(before.merit + delta), changed = merit !== before.merit;
    const event = r.event || null; // field events only (wounded, killed); a new name on the brigade is not an event
    write(r.name, { pack: packId, phase: phaseId, unit: r.unitId, grade, lost, ...(changed ? { from: before.merit, merit } : {}), ...(event ? { event } : {}) }, merit);
    if (changed) summary.changes.push({ name: r.name, unitId: r.unitId, from: before.merit, to: merit });
    if (event) summary.events.push({ name: r.name, unitId: r.unitId, event });
    if (r.successor && r.successor !== r.name) { // a successor the pack names for a fallen commander
      write(r.successor, { pack: packId, phase: phaseId, unit: r.unitId, grade, lost, event: 'took-command' }, officerRecord({ officers: book }, r.successor).merit);
      summary.events.push({ name: r.successor, unitId: r.unitId, event: 'took-command' });
    }
  });
  // Bounded: past the name limit the least notable names untouched by this award go first (lowest Merit, fewest rows);
  // the summary counts them (the shipped ladder names 63 of the 128 allowed).
  const names = Object.keys(book);
  if (names.length > OFFICER_LIMITS.names) {
    const spare = names.filter((n) => !touched.has(n)).sort((a, b) => book[a].merit - book[b].merit || book[a].record.length - book[b].record.length || (a < b ? -1 : 1));
    const drop = spare.slice(0, names.length - OFFICER_LIMITS.names);
    for (const n of drop) delete book[n];
    summary.dropped = drop.length;
  }
  const next = { ...save };
  delete next.officers;
  if (Object.keys(book).length) next.officers = Object.fromEntries(Object.keys(book).sort().map((k) => [k, book[k]]));
  return { save: next, summary: frozen(summary) };
}

// ---- the after-action's view of a recorded award (bounded; same page only) -------------------------------------------
const AWARDS = new Map();
/** Remember what one recorded award changed for the officers (campaign.js recordPhase). */
export function noteOfficers(summary) {
  if (!summary || typeof summary.awardId !== 'string') return;
  AWARDS.delete(summary.awardId);
  AWARDS.set(summary.awardId, summary);
  while (AWARDS.size > 8) AWARDS.delete(AWARDS.keys().next().value);
}
/** What a recorded award changed for the officers on this page (null when unknown or nothing changed). */
export function officerAward(awardId) {
  const s = AWARDS.get(awardId);
  return s && (s.changes.length || s.events.length) ? s : null;
}

// ---- sourced ranks (pack data only) ------------------------------------------------------------------------------------
/** The commanders of one pack phase as [unitId, { name, rank }]: a full pack phase or a pack summary's (briefing.js). */
function phaseCommanders(ph) {
  if (ph && ph.scenario) return [...(ph.scenario.units || []), ...(ph.scenario.reinforcements || [])].filter((u) => u && u.commander).map((u) => [u.id, u.commander]);
  return ph && ph.commanders ? Object.entries(ph.commanders) : [];
}
/**
 * Every ladder phase (or, without a ladder, every phase of the packs in order) whose pack names this commander, with the rank
 * it gives him there. `packs` are full battle packs ({ id, title, phases: [{ id, scenario }] }) or pack summaries
 * ({ packId, title, phases: [{ id, title, commanders }] }).
 */
export function rankHistory(name, packs, ladder = null) {
  const list = (Array.isArray(packs) ? packs : []).filter(Boolean);
  const byId = new Map(list.map((p) => [p.id ?? p.packId, p]));
  const order = ladder && Array.isArray(ladder.phases) ? ladder.phases.map((p) => [p.packId, p.phaseId])
    : list.flatMap((p) => (p.phases || []).map((ph) => [p.id ?? p.packId, ph.id]));
  const rows = [], seen = new Set();
  for (const [packId, phaseId] of order) {
    const pack = byId.get(packId), ph = pack?.phases?.find((x) => x.id === phaseId);
    if (!ph || seen.has(`${packId}|${phaseId}`)) continue;
    seen.add(`${packId}|${phaseId}`);
    const hit = phaseCommanders(ph).find(([, c]) => c && c.name === name && text(c.rank));
    if (hit) rows.push({ packId, phaseId, packTitle: pack.title ?? packId, title: ph.scenario?.title ?? ph.title ?? phaseId, rank: hit[1].rank, unitId: hit[0] });
  }
  return rows;
}
/** Where the sourced rank differs from the phase before it: [{ from, to, packId, phaseId, packTitle, title }]. */
export function rankChanges(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].rank !== rows[i - 1].rank) out.push({ from: rows[i - 1].rank, ...rows[i], to: rows[i].rank });
  return out;
}
const RANK_ORDER = ['Lieutenant', 'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major', 'Lieutenant Colonel', 'Colonel', 'Brigadier General', 'Major General', 'Lieutenant General', 'General'];
/** "Promoted Brigadier General per the Chattanooga pack (Orchard Knob)", or "Rank given as …" when it is not a step up. */
export function rankChangeText(c) {
  const up = RANK_ORDER.indexOf(c.to) > RANK_ORDER.indexOf(c.from) && RANK_ORDER.indexOf(c.from) >= 0;
  return `${up ? 'Promoted' : 'Rank given as'} ${c.to} per the ${c.packTitle} pack (${c.title})`;
}

/**
 * The camp's "Officers" lines after a phase: the Merit changes the last recorded phase made ("William B. Hazen: Merit 2 → 3")
 * and, for each franchise commander the next ladder phase's pack names, a sourced rank that differs from the one the ladder
 * last gave him. `packs` as for rankHistory; `ladder` the validated campaign. [] when there is nothing to say.
 */
export function officerLines(save, { packs = [], ladder = null } = {}) {
  if (!save || save.version !== 2) return [];
  const lines = [], c = save.campaign, last = c.history[c.history.length - 1];
  if (last) for (const [name, e] of Object.entries(save.officers || {})) {
    const row = e.record.findLast((r) => r.pack === last.packId && r.phase === last.phaseId && has(r, 'merit'));
    if (row) lines.push(`${name}: Merit ${row.from} → ${row.merit} (game value)`);
  }
  const next = ladder && c.index < ladder.phases.length ? ladder.phases[c.index] : null;
  if (next) {
    const pack = packs.find((p) => (p?.id ?? p?.packId) === next.packId), ph = pack?.phases?.find((x) => x.id === next.phaseId);
    const army = new Set(save.army.filter((b) => typeof b.unitId === 'string').map((b) => b.unitId));
    const done = new Set();
    for (const [unitId, cmd] of phaseCommanders(ph)) {
      if (!army.has(unitId) || !cmd || !text(cmd.name) || done.has(cmd.name)) continue;
      done.add(cmd.name);
      const rows = rankHistory(cmd.name, packs, { phases: ladder.phases.slice(0, c.index + 1) });
      const change = rankChanges(rows).find((x) => x.packId === next.packId && x.phaseId === next.phaseId);
      if (change) lines.push(`${cmd.name}: ${rankChangeText(change)}`);
    }
  }
  return lines;
}

const EVENT_WORDS = { wounded: 'Wounded at', killed: 'Killed at', 'took-command': 'Took command (the successor the battle pack names) at' };
/** A data portrait path the card may load: a relative file under ./assets/ (the scenario's commander.portrait), else ''. */
const portraitPath = (v) => (typeof v === 'string' && /^\.\/assets\/[\w./-]+\.(?:jpe?g|png|webp)$/i.test(v) && !v.includes('..') ? v : '');
/**
 * The scenario's own portrait for a commander as the card and the camp's commander row show it: { src, note } from
 * commander.portrait and commander.portraitNote, or null when the data gives none (then the period-portrait mapping, then
 * the generic silhouette). One rule for both places, so the camp row and the card never disagree.
 */
export const officerPortrait = (portrait, note = '') => (portraitPath(portrait) ? { src: portraitPath(portrait), note: text(note) ? note.trim() : '' } : null);
/** A display string: the value when it is non-empty text, else '' (never "null" or "undefined" on the card). */
const shown = (v) => (text(v) ? v : '');
/**
 * The officer card's view model. input: { name, rank (as sourced for the current battle), formation, kind (the formation's:
 * 'infantry', 'cavalry', 'battery' or 'artillery'; the effect line depends on it), parent, regiments, sources, sourcesFrom
 * (where the sources come from), record (officerRecord or a definition's `officer`), campaign (false in Battles and the
 * sandbox), ranks (rankHistory rows), titleOf(packId, phaseId), portrait and portraitNote (the scenario's own
 * commander.portrait and its note, shown before the period-portrait mapping; '' when the data has none) }.
 */
export function officerView({ name, rank = '', formation = '', kind = null, parent = '', regiments = [], sources = [], sourcesFrom = '', record = null, campaign = true,
  ranks = [], titleOf = null, portrait = '', portraitNote = '' } = {}) {
  if (!text(name)) fail('an officer card needs the sourced name.');
  const title = (p, ph) => { const t = typeof titleOf === 'function' ? titleOf(p, ph) : null; return text(t) ? t : `${p} · ${ph}`; };
  const rows = campaign && record && Array.isArray(record.record) ? record.record : [];
  const merit = campaign && record ? clampMerit(record.merit | 0) : 0;
  const fell = rows.find((r) => r.event === 'killed');
  const distinct = [...new Set(ranks.map((r) => r.rank))];
  return frozen({
    name, rank: text(rank) ? rank : '', heading: text(rank) ? `${rank} ${name}` : name,
    command: { formation: shown(formation), parent: shown(parent), regiments: Array.isArray(regiments) ? regiments.filter(text) : [] },
    record: rows.map((r) => ({ text: `${title(r.pack, r.phase)}: ${r.grade}, ${Number(r.lost).toLocaleString('en-US')} men lost${has(r, 'merit') ? ` · Merit now ${r.merit}` : ''}`,
      event: r.event ? `${EVENT_WORDS[r.event]} ${title(r.pack, r.phase)}` : '' })),
    campaign: campaign === true, merit, meritNote: MERIT_NOTE,
    meritLabel: campaign ? `Merit ${merit} of ${MERIT.max}` : 'Merit: not used outside the campaign',
    effect: meritEffectText(merit, { campaign, killed: fell ? title(fell.pack, fell.phase) : null, kind }),
    portrait: officerPortrait(portrait, portraitNote),
    ranks: distinct.length > 1 ? distinct.map((rk) => ({ rank: rk, phases: ranks.filter((r) => r.rank === rk).map((r) => `${r.packTitle}: ${r.title}`) })) : [],
    sources: (Array.isArray(sources) ? sources : []).filter(text).slice(0, 16), sourcesFrom: shown(sourcesFrom),
  });
}

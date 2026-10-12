// Completed practice outcomes, and the shared result->reward bridge a campaign pack phase also uses
// (phaseOutcome). No save authority here and no invented captures.
import { completedSnapshot, validateSnapshot, MAX_SAVE_BYTES } from './save.js';
import { introScenario, surrenderOption } from './intro.js';
import { ARMS, UNIQUES, CONDITIONS, VETERANCY, ISSUE_PLACE } from '../reward/data.js';
import { gradeSpec, rollLoot, seedOf } from '../reward/model.js';
import { validateReplay } from '../sim/recorder.js';
import { campEffectLines } from './badges.js';

const fail = (message) => { throw new Error(`Practice: ${message}`); };
const WEAPONS = { infantry: new Set(['smooth', 'rifled']), artillery: new Set(['smbart', 'parrott']) };

// Input limits, not a measured hardware promise. No field imports or allocations in this seam.
export const DEPLOYMENT_LIMITS = Object.freeze({ formations: 5, men: 7240, guns: 12, figures: 1490,
  infantryMen: 3000, batteryMen: 120, batteryGuns: 6, halfMap: 1300, margin: 20 });
const manifests = new WeakSet(), outcomes = new WeakMap(), prepared = new WeakSet();
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
function frozen(v) {
  if (v === null || typeof v !== 'object') return v;
  return Object.freeze(Array.isArray(v) ? v.map(frozen) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozen(x)])));
}
const capable = (b) => b.men > 0 && (b.kind === 'infantry' || b.guns > 0);
const lootUid = (awardId, seed, i) => `${awardId}.L${seedOf(seed).toString(36)}-${i}`;
const captureOrigin = (c) => `Captured: ${c.name} (fictional practice stores)`;

/** Card ratings for a veterancy level 1-4 (game values shared by practice and the campaign roster). */
export const vetBase = (xp) => ({ fire: 25 + xp * 10, melee: 30 + xp * 8, morale: 40 + xp * 8, drill: 30 + xp * 10 });

/** Crates one side holds at the end, checked against the encounter's own crate list. */
export function heldCaptures(game, side, crateList, origin) {
  const held = game.fieldCaptures?.held(side) || [], crates = new Map((crateList || []).map((c) => [c.id, c])), ids = new Set();
  if (!Array.isArray(held) || held.length > crates.size) fail('invalid field captures.');
  for (const c of held) {
    if (!c || !crates.has(c.id) || ids.has(c.id) || c.tier !== crates.get(c.id).tier) fail('invalid field captures.');
    ids.add(c.id);
  }
  return held.map((c) => ({ id: c.id, tier: c.tier, from: origin(crates.get(c.id)) }));
}

/** The deterministic loot roll of one award: same award identity and seed, same cards. */
export function awardCards({ awardId, seed, grade, captures }) {
  return rollLoot({ seed, grade, captures }).cards.map((c) => ({ ...c, uid: `${awardId}.${c.uid}` }));
}

/** Definitions may be imported without field allocation; only an admitted manifest can boot. */
export function assertSavedLaunch(manifest, current) {
  if (!manifest || !manifests.has(manifest)) fail('deployment manifest is not the admitted launch baseline.');
  if (arguments.length > 1 && (current === null || JSON.stringify(validateSnapshot(current)) !== JSON.stringify(manifest.baseline))) {
    fail('saved progress changed after deployment was reviewed. Return to camp for a fresh review.');
  }
  return manifest;
}

/** The reward UI consumes the real terminal roll; forged/copied previews cannot replace it. */
export function assertSavedReward(outcome) {
  if (!outcome || !prepared.has(outcome)) fail('loot must use the frozen completed saved encounter.');
  return outcome;
}

function lootReserve(baseline, scenario, awardId, seed) {
  // Explicit captures bypass the model's random capture count. Guarantee promotes an issue card.
  let count = 0;
  for (const grade of ['Victory', 'Defeat']) {
    const spec = gradeSpec(grade);
    if (!Array.isArray(spec.commons) || spec.commons.length !== 2 || spec.commons.some((n) => !Number.isSafeInteger(n) || n < 1)
      || spec.commons[0] > spec.commons[1] || ![spec.better, spec.extra].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
      fail('loot rules cannot reserve a bounded result.');
    }
    count = Math.max(count, spec.commons[1] + +(spec.better > 0) + +(spec.extra > 0) + scenario.crates.length);
  }
  if (baseline.depot.length + count > 2000) fail(`the depot needs ${count} free slots before deployment. Return to camp or export this army.`);
  const ids = new Set([...baseline.army.map((b) => b.weapon.uid), ...baseline.depot.map((it) => it.uid)]);
  // Reserve every possible unsorted draft index without consuming RNG or hiding a collision.
  let growth = 0;
  for (let i = 0; i < count; i++) {
    const uid = lootUid(awardId, seed, i);
    if (uid.length > 100 || ids.has(uid)) fail('new loot identity collides with saved gear. Keep this army and choose a fresh encounter.');
    let largest = 0;
    for (const d of [...ARMS, ...UNIQUES]) for (const c of CONDITIONS) {
      for (const [source, from] of [['issue', ISSUE_PLACE], ...scenario.crates.map((crate) => ['capture', captureOrigin(crate)])]) {
        largest = Math.max(largest, bytes({ uid, itemId: d.id, tier: d.tier, conditionId: c.id, source, from }));
      }
    }
    growth += largest + 1; // comma even when depot was empty: conservatively one byte extra
  }
  const metadata = validateSnapshot({ ...baseline, awardId, seed, grade: 'Victory' });
  const reservedBytes = bytes(metadata) + growth;
  if (reservedBytes > MAX_SAVE_BYTES) fail('this army needs more save-file headroom before deployment. Return to camp or export it.');
  return { cards: count, bytes: reservedBytes };
}

/** Read/validate/admit before importing the field. All capable formations or no deployment. */
export function savedDeployment(input) {
  const surrender = surrenderOption(input);
  const { baseline, ground, awardId, seed } = input;
  const before = validateSnapshot(baseline);
  // Campaign route guard: a campaign army fights only in its own ladder phases (save v2 keeps its slot and award ids).
  if (before.version !== 1) fail('campaign armies fight only in their campaign phases. Deploy saved army is for practice armies.');
  // Validate new metadata through the existing schema, without replacing any inventory identity.
  validateSnapshot({ ...before, awardId, seed });
  if (awardId === before.awardId || awardId.length > 80) fail('deployment needs a fresh bounded award identity.');
  const active = before.army.filter(capable);
  if (!active.some((b) => b.kind === 'infantry')) fail('this held-ground exercise needs living infantry. Dormant formations remain in camp.');
  const limits = DEPLOYMENT_LIMITS;
  const figures = active.reduce((n, b) => n + Math.max(1, Math.round(b.men / (b.kind === 'battery' ? 4 : 5))) + 6, 0);
  const men = active.reduce((n, b) => n + b.men, 0), guns = active.reduce((n, b) => n + (b.guns || 0), 0);
  if (active.length > limits.formations || men > limits.men || guns > limits.guns || figures > limits.figures
    || active.some((b) => b.kind === 'infantry' ? b.men > limits.infantryMen : b.men > limits.batteryMen || b.guns > limits.batteryGuns)) {
    fail('the whole active army exceeds this practice field. No troops were cut; return to camp or export the army.');
  }
  const scenario = JSON.parse(JSON.stringify(introScenario(ground, surrender ? { surrender: true } : undefined)));
  scenario.id = 'saved-practice'; scenario.title = 'Your army on practice ground'; scenario.savedPractice = true;
  scenario.historyNote = 'Fictional saved-army exercise on reused Henry Hill terrain. Equipment and strengths are game values; this is not a historical engagement.';
  const used = new Set(before.army.map((b) => b.id));
  const enemies = new Map();
  for (const d of scenario.units.filter((u) => u.side !== 'US')) {
    let n = 0, id;
    do { id = `saved-enemy-${n++}`; } while (used.has(id));
    used.add(id); enemies.set(d.id, id); d.id = id;
  }
  scenario.opening = scenario.opening.map((o) => ({ ...o, id: enemies.get(o.id) }));
  // Infantry first so the held-ground rule is viable even when a battery leads saved army order.
  const ordered = [...active.filter((b) => b.kind === 'infantry'), ...active.filter((b) => b.kind === 'battery')];
  const footprints = ordered.map((b, row) => {
    const n = Math.max(1, Math.round(b.men / 5)), ranks = n > 14 ? 2 : 1;
    const halfWidth = b.kind === 'battery' ? Math.max(8, (b.guns - 1) * 8 + 6) + 11
      : Math.max(4, (Math.ceil(n / ranks) - 1) * 2.35 * 1.5 / 2) + 11;
    return { id: b.id, x: -480 - 180 * row, z: -610, halfWidth, halfDepth: 75 };
  });
  const edge = limits.halfMap - limits.margin;
  if (footprints.some((f) => Math.abs(f.x) + f.halfDepth > edge || Math.abs(f.z) + f.halfWidth > edge)
    || footprints.some((a, i) => footprints.slice(i + 1).some((b) => Math.abs(a.x - b.x) < a.halfDepth + b.halfDepth + 20))) {
    fail('the complete formation layout does not fit this practice ground.');
  }
  const player = ordered.map((b, i) => ({ id: b.id, side: 'US', type: b.kind === 'battery' ? 'artillery' : 'infantry',
    name: b.label, short: b.label, men: b.men, ...(b.kind === 'battery' ? { guns: b.guns } : {}),
    xp: VETERANCY.findIndex((v) => v.id === b.vet) + 1, weapon: b.kind === 'battery' ? 'smbart' : 'smooth',
    equipment: b.weapon, x: footprints[i].x, z: footprints[i].z, facing: Math.PI / 2,
    commander: null, regiments: [], sources: [], notes: 'Fictional saved-army practice formation' }));
  scenario.units = [...player, ...scenario.units.filter((d) => d.side !== 'US')];
  const reserve = lootReserve(before, scenario, awardId, seed);
  const manifest = frozen({ baseline: before, awardId, seed, scenario, footprints, reserve,
    allocation: { formations: active.length, men, guns, figures }, dormant: before.army.filter((b) => !capable(b)).map((b) => b.id) });
  manifests.add(manifest);
  return manifest;
}

/** Freeze the first real terminal army and roll once. Re-entry/export/retry cannot reroll. */
export function savedOutcome({ manifest, game }) {
  if (!manifest || !manifests.has(manifest)) fail('deployment manifest is not the admitted launch baseline.');
  if (outcomes.has(manifest)) return outcomes.get(manifest);
  const { baseline, scenario, awardId, seed } = manifest;
  if (game.scenario !== scenario || !game.over || game.playerSide !== 'US' || !['US', 'CS'].includes(game.result?.winner)) fail('only a completed saved practice battle grants rewards.');
  const defs = new Map(scenario.units.map((d) => [d.id, d])), seen = new Set();
  if (!Array.isArray(game.units) || game.units.length !== defs.size) fail('an altered deployment cannot grant rewards.');
  for (const u of game.units) {
    if (!u || typeof u !== 'object') fail('an altered deployment cannot grant rewards.');
    const d = defs.get(u.id);
    if (!d || seen.has(u.id) || u.side !== d.side || u.type !== d.type || u.name !== d.name
      || u.menMax !== d.men || u.weapon !== d.weapon || u.xp !== d.xp
      || JSON.stringify(u.equipment) !== JSON.stringify(d.equipment)) fail('an altered deployment cannot grant rewards.');
    seen.add(u.id);
    if (!Number.isFinite(u.men) || u.men < 0 || u.men > d.men) fail('invalid surviving strength.');
    if (d.type === 'artillery' && (u.guns !== d.guns || !Array.isArray(u.gunSlots) || u.gunSlots.length !== d.guns
      || Array.from(u.gunSlots).some((g) => !g || typeof g.alive !== 'boolean'))) fail('invalid surviving gun state.');
  }
  const units = new Map(game.units.filter((u) => u.side === 'US').map((u) => [u.id, u]));
  const army = baseline.army.map((b) => {
    if (!capable(b)) return b;
    const u = units.get(b.id), men = Math.floor(u.men);
    return { ...b, men, ...(b.kind === 'battery' ? { guns: men ? u.gunSlots.filter((g) => g.alive).length : 0 } : {}) };
  });
  const captures = heldCaptures(game, 'US', scenario.crates, captureOrigin);
  const grade = game.result.winner === 'US' ? 'Victory' : 'Defeat';
  const cards = awardCards({ awardId, seed, grade, captures });
  // Existing strict validator catches every identity collision before returning a pending result.
  const snapshot = validateSnapshot({ ...baseline, awardId, seed, grade, army, depot: [...baseline.depot, ...cards] });
  if (cards.length > manifest.reserve.cards || bytes(snapshot) > manifest.reserve.bytes) fail('loot exceeded the admitted result reservation.');
  const starting = baseline.army.reduce((n, b) => n + b.men, 0), surviving = snapshot.army.reduce((n, b) => n + b.men, 0);
  const outcome = frozen({ snapshot, cards, captures, summary: { starting, surviving, losses: starting - surviving,
    guns: snapshot.army.reduce((n, b) => n + (b.guns || 0), 0), title: scenario.title, why: game.result.why } });
  outcomes.set(manifest, outcome);
  prepared.add(outcome);
  return outcome;
}

export function playMode(search) {
  const q = new URLSearchParams(search);
  return q.has('sandbox') ? 'sandbox' : q.has('battle') ? 'historical' : q.has('campaign') ? 'campaign' : 'practice';
}

export function practiceOutcome({ game, scenario, mode, awardId, seed }) {
  if (mode !== 'practice' || !['henry-hill', 'first-command'].includes(scenario.id)
    || (scenario.id === 'first-command' && scenario.practiceIntro !== true) || game.playerSide !== 'US' || !game.over
    || !['US', 'CS'].includes(game.result?.winner)) fail('only a completed, unaltered practice battle grants rewards.');
  const defs = new Map(scenario.units.map((d) => [d.id, d]));
  const seen = new Set();
  if (game.units.length !== defs.size) fail('an altered roster cannot grant practice rewards.');
  for (const u of game.units) {
    const d = defs.get(u.id);
    if (!d || seen.has(u.id) || u.side !== d.side || u.type !== d.type || u.name !== d.name
      || u.menMax !== d.men || u.weapon !== d.weapon || u.xp !== d.xp) fail('an altered roster cannot grant practice rewards.');
    seen.add(u.id);
    if (!Number.isFinite(u.men) || u.men < 0 || u.men > u.menMax) fail('invalid surviving strength.');
  }
  let starting = 0;
  const army = game.units.filter((u) => u.side === game.playerSide).map((u) => {
    if (!WEAPONS[u.type]?.has(u.weapon)) fail('unsupported practice equipment.');
    const men = Math.floor(u.men); // never turn an inactive fraction (<1 man) into a survivor
    const xp = u.xp;
    if (!Number.isInteger(xp) || xp < 1 || xp > 4) fail('unsupported practice experience.');
    starting += u.menMax;
    const brigade = { id: u.id, label: u.name, kind: u.type === 'artillery' ? 'battery' : 'infantry', men,
      vet: ['green', 'trained', 'veteran', 'elite'][xp - 1],
      base: vetBase(xp),
      weapon: { uid: `${awardId}.${u.id}`, itemId: `practice-${u.weapon}`, tier: 'common', conditionId: 'serviceable',
        from: 'Practice equipment; exact historical model unspecified' } };
    if (brigade.kind === 'battery') {
      if (!Array.isArray(u.gunSlots) || u.gunSlots.length !== defs.get(u.id).guns
        || u.gunSlots.some((g) => typeof g.alive !== 'boolean')) fail('invalid surviving gun state.');
      brigade.guns = men > 0 ? u.gunSlots.filter((g) => g.alive).length : 0;
    }
    return brigade; // routed and zero-strength formations retain their identities and equipment records
  });
  const grade = game.result.winner === game.playerSide ? 'Victory' : 'Defeat';
  const before = completedSnapshot({ awardId, army, depot: [], issued: [], seed, grade });
  const surviving = before.army.reduce((n, b) => n + b.men, 0);
  const captures = heldCaptures(game, game.playerSide, scenario.crates, captureOrigin);
  return { ...before, captures, summary: { starting, surviving, losses: starting - surviving,
    guns: before.army.reduce((n, b) => n + (b.guns || 0), 0), title: scenario.title, why: game.result.why } };
}

const GAME_GRADES = { decisive: 'Decisive', victory: 'Victory', draw: 'Draw', defeat: 'Defeat' };

/**
 * One finished battle-pack phase: end strength of every formation (both sides, unarrived reinforcements at
 * their authored strength), the grade, held captures, whether the Union held the objective at the end (`held`, for
 * requisition points), the deterministic loot of `awardId` and each fielded formation's feat statistics (`feats`, for
 * badges), the map replay track when a recorder was attached (`replay`, src/sim/recorder.js; null otherwise) and "you vs
 * history" (`history`, historyComparison below). Rejects an altered roster exactly like practiceOutcome. Grants nothing by
 * itself; the campaign records it. Colours the Union took (P5d; src/game.js colourReport) ride along as `colours`
 * ([{ unitId, regiment, side, by }], only when there are any) for recordPhase's trophy shelf.
 */
export function phaseOutcome({ game, scenario, awardId, seed }) {
  if (!game || !scenario || game.scenario !== scenario || game.playerSide !== 'US' || game.over !== true
    || !(['US', 'CS'].includes(game.result?.winner) || (game.result?.winner === null && game.result.draw === true))) fail('only a completed, unaltered battle phase grants rewards.');
  if (typeof awardId !== 'string' || !awardId || awardId.length > 80) fail('a battle phase needs a bounded award identity.');
  const defs = new Map([...scenario.units, ...(scenario.reinforcements || [])].map((d) => [d.id, d])), live = new Map();
  if (!Array.isArray(game.units) || game.units.length > defs.size) fail('an altered roster cannot grant rewards.');
  for (const u of game.units) {
    const d = u && defs.get(u.id);
    if (!d || live.has(u.id) || u.side !== d.side || u.type !== (d.type || 'infantry') || u.name !== d.name || u.menMax !== d.men
      || u.weapon !== (d.weapon || 'smooth') || u.xp !== (d.xp || 1) || JSON.stringify(u.equipment) !== JSON.stringify(d.equipment)) fail('an altered roster cannot grant rewards.');
    if (!Number.isFinite(u.men) || u.men < 0 || u.men > u.menMax) fail('invalid surviving strength.');
    if (d.type === 'artillery' && (!Array.isArray(u.gunSlots) || u.gunSlots.length !== d.guns
      || u.gunSlots.some((g) => !g || typeof g.alive !== 'boolean'))) fail('invalid surviving gun state.');
    live.set(u.id, u);
  }
  if (scenario.units.some((d) => !live.has(d.id))) fail('an altered roster cannot grant rewards.');
  const units = [...defs.values()].map((d) => {
    const u = live.get(d.id), men = u ? Math.floor(u.men) : d.men;
    const row = { id: d.id, side: d.side, menStart: d.men, men };
    if (d.type === 'artillery') Object.assign(row, { gunsStart: d.guns, guns: !u ? d.guns : men ? u.gunSlots.filter((g) => g.alive).length : 0 });
    return row;
  });
  const grade = GAME_GRADES[game.result.grade] || (game.result.winner === 'US' ? 'Victory' : game.result.winner === null ? 'Draw' : 'Defeat');
  const captures = heldCaptures(game, 'US', scenario.crates, (c) => `Captured: ${c.name}`);
  const cards = awardCards({ awardId, seed, grade, captures });
  // The after-action's map replay (src/sim/recorder.js; only when a recorder was attached) and "you vs history".
  // a replay that cannot be recorded never blocks the phase result: the after-action then simply has no replay page
  let replay = null;
  try { replay = game.recorder ? validateReplay(game.recorder.track(game)) : null; } catch { replay = null; }
  const colours = colourRows(game, 'US').filter((r) => defs.has(r.unitId)).map((r) => ({ unitId: r.unitId, regiment: r.regiment, side: r.side, by: r.by }));
  return frozen({ winner: game.result.winner, grade, held: game.holder === 'US', units, captures, cards, feats: phaseFeats(game, live),
    replay, history: historyComparison({ game, scenario, units, grade }), ...(colours.length ? { colours } : {}) });
}

const clockMinutes = (t) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
/** The colours one side took in a game (src/game.js colourReport; [] for a game that keeps none). */
function colourRows(game, side) {
  if (typeof game?.colourReport !== 'function') return [];
  const rows = game.colourReport(side);
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.unitId === 'string' && typeof r.regiment === 'string' && r.regiment.trim()
    && ['US', 'CS'].includes(r.side) && typeof r.by === 'string' && r.by.trim()).map((r) => ({ ...r })) : [];
}
/** What reached this phase's battle from camp (P5d game rules): one line per effect with the Union formations it touched. */
function campRows(scenario) {
  const out = new Map();
  for (const d of [...(scenario.units || []), ...(scenario.reinforcements || [])]) {
    if (d.side !== 'US') continue;
    for (const line of campEffectLines(d)) {
      const key = line.split(':')[0];
      if (!out.has(key)) out.set(key, { effect: key, text: line.slice(key.length + 1).trim(), formations: [] });
      out.get(key).formations.push(d.short || d.name);
    }
  }
  return [...out.values()];
}

/**
 * "You vs history" for one finished battle-pack phase (campaign or Battles menu): the player's objective result, Union
 * and Confederate losses against the phase's sourced historical casualties (scenario.history, or null where none), the
 * clock the phase ended at against the historical window's end, and the game's scale (men per figure, clock ratio).
 * `units` are phaseOutcome rows ({ side, menStart, men }); without them the live roster is read (unarrived formations
 * lose nothing). Display data only: it grants and records nothing. With anything to show it also carries `colours` (those the
 * Union took this phase) and `camp` (P5d: each camp effect that reached the battle and the Union formations it touched).
 */
export function historyComparison({ game, scenario, units = null, grade = null }) {
  if (!game || !scenario) fail('a history comparison needs the finished phase.');
  const rows = units || [...game.units.map((u) => ({ side: u.side, menStart: u.menMax, men: Math.floor(u.men) })),
    ...(scenario.reinforcements || []).filter((d) => !game.units.some((u) => u.id === d.id)).map((d) => ({ side: d.side, menStart: d.men, men: d.men }))];
  const sum = (side, key) => rows.filter((u) => u.side === side).reduce((n, u) => n + (u[key] || 0), 0);
  const ratio = Number.isFinite(game.clockRatio) ? game.clockRatio : Number.isFinite(scenario.clockRatio) ? scenario.clockRatio : 1;
  const startMin = clockMinutes(scenario.start), endMin = clockMinutes(scenario.end);
  const finishedAt = startMin === null ? null : hhmm(startMin + (game.simTime || 0) * ratio / 60);
  const h = scenario.history || null;
  const colours = colourRows(game, 'US').map((r) => ({ regiment: r.regiment, formation: r.formation ?? '', by: r.by, how: r.how ?? '' }));
  const camp = campRows(scenario), extras = { ...(colours.length ? { colours } : {}), ...(camp.length ? { camp } : {}) };
  return {
    title: scenario.title ?? '', objective: scenario.objective?.name ?? '',
    result: { winner: game.result?.winner ?? null, grade: grade ?? GAME_GRADES[game.result?.grade] ?? null, why: game.result?.why ?? '', held: game.holder === 'US' },
    you: { startUS: sum('US', 'menStart'), startCS: sum('CS', 'menStart'), lossesUS: sum('US', 'menStart') - sum('US', 'men'),
      lossesCS: sum('CS', 'menStart') - sum('CS', 'men'), finishedAt,
      ended: startMin !== null && endMin !== null && startMin + (game.simTime || 0) * ratio / 60 >= endMin - 0.5 },
    history: { note: scenario.historyNote || '', start: scenario.start ?? null, end: scenario.end ?? null, casualties: h ? { ...h.casualties } : null },
    scale: { menPerFigure: Number.isInteger(scenario.menPerFigure) ? scenario.menPerFigure : 5, clockRatio: ratio },
    story: h,
    ...extras,
  };
}

/**
 * The phase's feat statistics (badges; src/franchise/badges.js) for every formation that took the field, read from the
 * game's featReport (src/game.js); {} for a game that keeps none. Counts only: nothing here changes the result.
 */
function phaseFeats(game, live) {
  if (typeof game.featReport !== 'function') return {};
  const report = game.featReport(), out = {};
  if (!report || typeof report !== 'object') fail('invalid feat statistics.');
  for (const id of [...live.keys()].sort()) if (Object.prototype.hasOwnProperty.call(report, id)) out[id] = { ...report[id] };
  return out;
}

/** Terminal, as-of prisoners and physical possession. This grants no loot or save authority. */
export function surrenderOutcome({ game, scenario }) {
  if (!game || !scenario || scenario !== game.scenario) fail('surrender result needs the exact encounter.');
  const flag = Object.getOwnPropertyDescriptor(scenario, 'surrender');
  if ((!flag && 'surrender' in scenario) || (flag && !('value' in flag))) fail('invalid surrender activation descriptor.');
  if (!flag || flag.value === false) return null;
  if (flag.value !== true) fail('invalid surrender activation value.');
  if (game.over !== true || !(['US', 'CS'].includes(game.result?.winner) || game.result?.winner === null && game.result.draw === true)) fail('surrender result needs a completed encounter.');
  // The existing Game owner validates its original source definitions, roster and gun identities.
  const observation = game.captureSnapshot();
  const finite = n => Number.isFinite(n) && n >= 0;
  const accounting = observation?.accounting;
  if (!observation || !finite(observation.observedAtSec) || observation.observedAtSec !== game.simTime
    || accounting?.through !== observation.observedAtSec || accounting.packId !== 'game' || accounting.phaseId !== 'battle'
    || !Array.isArray(accounting.units) || accounting.units.length > 10
    || !Array.isArray(observation.captures) || observation.captures.length > accounting.units.length) fail('invalid surrender observation.');
  const fields = ['initialMen', 'presentMen', 'pendingMen', 'killedWounded', 'missingMen', 'capturedMen'];
  const sides = {};
  for (const side of ['US', 'CS']) {
    const total = accounting.totals?.[side], opposite = side === 'US' ? 'CS' : 'US';
    if (!total || fields.some(key => !finite(total[key]))
      || !finite(accounting.totals?.[opposite]?.capturedBy?.[side])) fail('invalid surrender totals.');
    sides[side] = { ...Object.fromEntries(fields.map(key => [key, total[key]])),
      prisonersTaken: accounting.totals[opposite].capturedBy[side], gunsLost: 0, gunsTaken: 0, disabledGunsTaken: 0 };
  }
  if (sides.US.initialMen + sides.CS.initialMen > 14480) fail('surrender result exceeds the admitted men bound.');
  const rows = new Map(), captures = new Map(), pieces = [];
  for (const row of accounting.units) {
    if (!row || typeof row.unitId !== 'string' || !row.unitId || [...row.unitId].length > 160
      || rows.has(row.unitId) || !['US', 'CS'].includes(row.originSide) || !Array.isArray(row.guns)) fail('invalid surrender source row.');
    rows.set(row.unitId, row);
    for (const [index, gun] of row.guns.entries()) {
      if (gun.unitId !== row.unitId || gun.gunIndex !== index || gun.originSide !== row.originSide
        || !['US', 'CS'].includes(gun.ownerSide) || !['disabled', 'serviceable'].includes(gun.condition)
        || typeof gun.arrived !== 'boolean' || !(gun.originWeapon === null || typeof gun.originWeapon === 'string')
        || (!gun.arrived && gun.ownerSide !== gun.originSide)) fail('invalid surrender physical piece.');
      pieces.push(gun);
      if (gun.ownerSide !== gun.originSide) {
        sides[gun.originSide].gunsLost++;
        if (gun.arrived) {
          sides[gun.ownerSide].gunsTaken++;
          if (gun.condition === 'disabled') sides[gun.ownerSide].disabledGunsTaken++;
        }
      }
    }
  }
  if (pieces.length > 24) fail('surrender result exceeds the admitted gun bound.');
  for (const capture of observation.captures) {
    const row = rows.get(capture.unitId);
    if (!row || captures.has(capture.unitId) || !row.arrived || capture.originSide !== row.originSide
      || capture.captorSide !== (row.originSide === 'US' ? 'CS' : 'US')
      || !finite(capture.men) || capture.men === 0 || capture.men !== row.capturedMen
      || !finite(capture.captureAtSec) || capture.captureAtSec > observation.observedAtSec
      || JSON.stringify(capture.guns) !== JSON.stringify(row.guns)) fail('invalid committed surrender record.');
    captures.set(capture.unitId, capture);
  }
  const formations = accounting.units.filter(row => captures.has(row.unitId)).map(row => {
    const capture = captures.get(row.unitId), unit = game.units.find(u => u.id === row.unitId && u.side === row.originSide);
    if (!unit || typeof unit.name !== 'string' || !unit.name || unit.name !== unit.def?.name) fail('surrender label needs its original live formation.');
    return { unitId: row.unitId, label: unit.name, originSide: row.originSide, captorSide: capture.captorSide,
      men: capture.men, captureAtSec: capture.captureAtSec,
      guns: capture.guns.map(gun => ({ unitId: gun.unitId, gunIndex: gun.gunIndex, originSide: gun.originSide,
        originWeapon: gun.originWeapon, ownerSide: gun.ownerSide, condition: gun.condition, arrived: gun.arrived })) };
  });
  const result = { observedAtSec: observation.observedAtSec, sides, formations };
  if (bytes(result) > MAX_SAVE_BYTES) fail('surrender result exceeds the admitted byte bound.');
  return frozen(result);
}

/** Original saved loadout descriptors and physical possession only; no item/loot/save award. */
export function capturedLoadouts({ manifest, game }) {
  assertSavedLaunch(manifest);
  const report = surrenderOutcome({ game, scenario: manifest.scenario });
  if (report === null) return null;
  const live = new Map(game.units.map(unit => [unit.id, unit]));
  const baseline = new Map(manifest.baseline.army.map(brigade => [brigade.id, brigade]));
  const formations = report.formations.map(formation => {
    const unit = live.get(formation.unitId);
    if (!unit || !['infantry', 'artillery'].includes(unit.type)) fail('captured loadout needs its original formation type.');
    const kind = unit.type === 'artillery' ? 'battery' : 'infantry', brigade = baseline.get(formation.unitId);
    let loadout = null;
    if (brigade) {
      if (formation.originSide !== 'US' || brigade.kind !== kind
        || JSON.stringify(unit.equipment) !== JSON.stringify(brigade.weapon)
        || JSON.stringify(unit.def.equipment) !== JSON.stringify(brigade.weapon)) fail('captured loadout differs from the admitted saved baseline.');
      loadout = brigade.weapon;
    }
    return { ...formation, kind, loadout };
  });
  return frozen({ observedAtSec: report.observedAtSec, formations });
}

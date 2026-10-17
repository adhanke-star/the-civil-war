// src/sim/sandbox-battle.js: the Battles menu's "Sandbox battle" (DESIGN §1): any built field, any two built rosters.
//
// Not a historical engagement. Every formation (brigade, battery, commander, strength, weapon, veterancy, regiments and
// sources) is carried unchanged from a built battle-pack phase, and the field is a built terrain dressed as its built
// scenario is. Everything else is a game rule, written here and named as one:
//   Roster      all formations of one side in one phase (`units` + `reinforcements`), all present from the first minute:
//               no timetable, no historical AI routes (`ai`, `atSec`, `noticeSec` and `entry` are dropped). 11 phases x 2
//               sides = 22 rosters; id `<packId>.<phaseId>` (the side is the menu's choice).
//   Field       one of the 5 terrains; its dressing (ground, woods, sites, labels) is that of the built scenario on the same
//               terrain with the largest JSON of those four keys (Henry Hill: assets/scenarios/henry-hill.json); its season
//               and seed come from that scenario too, so the ground looks as it does in its own battle.
//   Deployment  deploy() below: facing lines, the attacker west facing +x (front x = -900), the defender east facing -x
//               with its front line on the objective (x = +100, inside its radius), so the attack meets it there. The
//               computer attacker marches about 1,000 m per clock hour, so the 1,000 m gap brings the lines into musket
//               range about 40 clock minutes in (under three real minutes at 1x) and leaves most of 06:00-08:00 to fight.
//   Battle      06:00-08:00 at 15x; the objective is "the centre ground" (0, 0), r 600 m; the attacker's formations take
//               the attack role on it (the computer's march at once, as DECISIONS 0273 gives a computer attacker), the
//               defender's hold. Result and grade are the battle-pack rule (src/game.js packResult: objective at the
//               end, a broken side, and the casualty ratio for Decisive).
//   Scale       the coarser of the two phases' men per figure, coarsened further until the whole field fits the
//               battle-pack figure budget (src/sim/phase.js PACK_FIELD_LIMITS).
// Date: src/sim/phase.js scenario() requires an ISO `date`, and the field draws the Confederate national colour of that
// date (src/units/soldier-mesh.js nationalTile: First National before 1 May 1863, Second National after). The sandbox
// carries the CONFEDERATE roster's own phase date, so its brigades fly the flag of their own period (the Union national
// colour does not depend on the date). The date is shown nowhere as text (src/main.js replaces the clock's date line):
// a sandbox has no date.
// No `history`, `commanders`, `commandChain`, `opening`, crates or commander temperament: a sandbox has no history to
// compare, no loot and no officers of its own.

import { preparePhase, prepareFieldScenario, phaseMenPerFigure, PACK_FIELD_LIMITS, PHASE_MEN_PER_FIGURE } from './phase.js';
import { DIFFICULTY } from '../franchise/tuning.js';

export const SANDBOX_PACKS = Object.freeze(['shiloh', 'stones-river', 'chattanooga']);
/** The five built terrains; `name` is each terrain file's own `name` (tools/test-sandbox-battle.mjs holds them equal). */
export const FIELDS = Object.freeze([
  Object.freeze({ id: 'shiloh', name: 'Shiloh: Pittsburg Landing to Fraley Field (6-7 April 1862)' }),
  Object.freeze({ id: 'stones-river', name: 'Stones River: the Nashville Pike to McFadden Ford (31 December 1862 - 2 January 1863)' }),
  Object.freeze({ id: 'chattanooga', name: 'Chattanooga: Orchard Knob to Missionary Ridge and Tunnel Hill (23-25 November 1863)' }),
  Object.freeze({ id: 'lookout-mountain', name: 'Lookout Mountain: the Cravens House bench and Lookout Creek (24 November 1863)' }),
  Object.freeze({ id: 'henry-hill', name: 'Henry House Hill to Matthews Hill (First Bull Run, 21 July 1861)' }),
]);
const FIELD_IDS = FIELDS.map((f) => f.id);
const SIDES = ['US', 'CS'];
const sideName = (side) => (side === 'CS' ? 'Confederate' : 'Union');
export const SANDBOX_NOTE = 'Not a historical engagement: two real rosters on a real field, placed by a game rule. No loot.';
export const NO_HISTORY_NOTE = 'A sandbox battle has no history to compare.';
const OBJECTIVE = Object.freeze({ name: 'the centre ground', x: 0, z: 0, r: 600 });
const ROSTER_ID = /^([a-z0-9-]{1,40})\.([a-z0-9-]{1,40})$/;
const DROPPED = ['ai', 'atSec', 'noticeSec', 'entry']; // timetable and historical routes: meaningless on another field

const kindOf = (f) => f.type || 'infantry';
const rosterUnits = (scenario, side) => [...(scenario.units || []), ...(scenario.reinforcements || [])].filter((u) => u.side === side);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The 22 roster rows of `packs` (raw battle packs): { id, side, packId, phaseId, label, counts, men }, US before CS per phase. */
export function rosterList(packs) {
  const rows = [];
  for (const pack of packs) for (const phase of pack.phases) for (const side of SIDES) {
    const units = rosterUnits(phase.scenario, side), n = (kind) => units.filter((u) => kindOf(u) === kind).length;
    const counts = Object.freeze({ brigades: n('infantry'), batteries: n('artillery'), cavalry: n('cavalry') });
    const men = units.reduce((sum, u) => sum + u.men, 0);
    const arms = `${plural(counts.brigades, 'brigade', 'brigades')}, ${plural(counts.batteries, 'battery', 'batteries')}${counts.cavalry ? `, ${counts.cavalry} cavalry` : ''}`;
    rows.push(Object.freeze({ id: `${pack.id}.${phase.id}`, side, packId: pack.id, phaseId: phase.id, counts, men,
      label: `${pack.title} · ${phase.scenario.title} · ${arms} · ${men.toLocaleString('en-US')} men` }));
  }
  return Object.freeze(rows);
}

const DRESSING = ['ground', 'woods', 'sites', 'labels'];
const dressingOf = (s) => Object.fromEntries(DRESSING.filter((k) => Object.prototype.hasOwnProperty.call(s, k)).map((k) => [k, s[k]]));
/** The built scenario on `field` whose dressing is largest (Henry Hill's own scenario names no terrain). */
function dressingSource(field, scenarios) {
  let best = null, size = -1;
  for (const s of scenarios) {
    if ((s.terrain ?? 'henry-hill') !== field) continue;
    const n = JSON.stringify(dressingOf(s)).length;
    if (n > size) { best = s; size = n; }
  }
  if (!best) throw new Error(`Sandbox battle: no built scenario dresses the ${field} field.`);
  return best;
}
/** The field's ground, woods, sites and labels (game rule: the largest built dressing on that terrain; see the header). */
export function fieldDressing(field, scenarios) {
  return structuredClone(dressingOf(dressingSource(field, scenarios)));
}

// Deployment game rule (metres). See deploy().
export const DEPLOYMENT = Object.freeze({ attackerFront: -900, defenderFront: 100, edge: 300, bound: 250, spacing: 260,
  lineGap: 320, battery: 160, batteryStep: 130, cavalry: 350, minGap: 120 });
/**
 * Pure and deterministic: `formations` (both sides' defs) as new defs with x, z and facing, in input order. Game rule:
 * the attacker on the west facing +x, the defender on the east facing -x; front lines at x = -900 and +100 (the
 * defender's stands on the objective, inside its radius, so the attack meets it there; the computer attacker marches
 * about 1,000 m per clock hour, so the 1,000 m gap closes to musket range about 40 clock minutes in, under three real
 * minutes at 1x, leaving most of 06:00-08:00 for the fight), clamped to +-(half - 300).
 * Infantry 260 m apart along z, centred on z = 0; a line longer than 2(half - 300) (less 350 m a side when the side has
 * cavalry, so the horse stays on the field) overflows into further lines 320 m behind. Batteries 160 m behind the front
 * line, spread evenly across it (at least 130 m apart); cavalry 350 m outboard of the front line's flanks, alternating
 * right and left, later pairs 320 m further back. When the rearmost rank would stand beyond half - 250, the whole side
 * steps toward the centre. Throws when the two sides would not stay apart. `D` is DEPLOYMENT unless a test passes
 * another rule set (tools/test-sandbox-battle.mjs: the old +400 defender front as its mutant).
 */
export function deploy(formations, attackerSide, half, D = DEPLOYMENT) {
  if (!SIDES.includes(attackerSide) || !Number.isFinite(half) || half <= D.edge + D.cavalry) throw new Error('Sandbox battle: deployment needs an attacker and a field half-size.');
  if (!Array.isArray(formations) || formations.some((f) => !SIDES.includes(f?.side))) throw new Error('Sandbox battle: every formation needs a side.');
  const lim = half - D.edge, bound = half - D.bound, placed = new Map(), extent = {};
  for (const side of SIDES) {
    const attack = side === attackerSide, dir = attack ? 1 : -1; // dir: the side faces +x (1) or -x (-1)
    const own = formations.filter((f) => f.side === side), of = (kind) => own.filter((f) => kindOf(f) === kind);
    const inf = of('infantry'), bat = of('artillery'), cav = of('cavalry');
    const halfWidth = lim - (cav.length ? D.cavalry : 0);
    const perLine = Math.floor((2 * halfWidth) / D.spacing) + 1, lines = Math.max(1, Math.ceil(inf.length / perLine));
    const depth = Math.max((lines - 1) * D.lineGap, bat.length && inf.length ? D.battery : 0, (Math.ceil(cav.length / 2) - 1) * D.lineGap);
    let front = Math.max(-lim, Math.min(lim, attack ? D.attackerFront : D.defenderFront));
    front = attack ? Math.max(front, depth - bound) : Math.min(front, bound - depth);
    const facing = attack ? Math.PI / 2 : -Math.PI / 2;
    const at = (f, x, z) => placed.set(f, { ...f, x: Math.round(x), z: Math.round(z), facing });
    inf.forEach((f, i) => {
      const line = Math.floor(i / perLine), n = Math.min(perLine, inf.length - line * perLine), k = i - line * perLine;
      at(f, front - dir * line * D.lineGap, (k - (n - 1) / 2) * D.spacing);
    });
    const span = Math.max(0, Math.min(perLine, inf.length) - 1) * D.spacing;
    if (bat.length) {
      let step = Math.max(D.batteryStep, span / bat.length);
      if (bat.length > 1 && (bat.length - 1) * step > 2 * halfWidth) step = (2 * halfWidth) / (bat.length - 1);
      const x = inf.length ? front - dir * D.battery : front;
      bat.forEach((f, j) => at(f, x, (j - (bat.length - 1) / 2) * step));
    }
    cav.forEach((f, j) => at(f, front - dir * Math.floor(j / 2) * D.lineGap, (j % 2 ? -1 : 1) * (span / 2 + D.cavalry)));
    const xs = own.map((f) => placed.get(f).x);
    extent[side] = { min: Math.min(...xs), max: Math.max(...xs) };
  }
  const A = extent[attackerSide], Dn = extent[attackerSide === 'US' ? 'CS' : 'US'];
  if (A && Dn && Number.isFinite(A.max) && Number.isFinite(Dn.min) && A.max > Dn.min - D.minGap) throw new Error('Sandbox battle: the two armies do not fit this field apart.');
  return formations.map((f) => placed.get(f));
}

// Game rule (see the header): the figure budget the pack route enforces, counted as src/sim/phase.js unitFigures counts it.
function figureScale(units, base) {
  for (let ratio = base; ratio <= PHASE_MEN_PER_FIGURE.max; ratio++) {
    const figures = units.reduce((n, u) => n + Math.max(1, Math.round(u.men / (u.type === 'artillery' ? 4 : ratio))) + 6, 0);
    if (figures <= PACK_FIELD_LIMITS.figures) return ratio;
  }
  return PHASE_MEN_PER_FIGURE.max; // prepareFieldScenario then refuses the field
}

function rosterSource(packs, id, side, key) {
  const m = typeof id === 'string' ? ROSTER_ID.exec(id) : null;
  const pack = m && packs.find((p) => p.id === m[1]), phase = pack?.phases.find((p) => p.id === m[2]);
  if (!phase || !rosterUnits(phase.scenario, side).length) throw new Error(`Sandbox battle: the "${key}" parameter names no built roster.`);
  return { pack, phase, row: rosterList([{ ...pack, phases: [phase] }]).find((r) => r.side === side) };
}

/**
 * The prepared ('pack' route) scenario of one sandbox battle. `packs` are the raw battle packs, `henryHill` the raw
 * assets/scenarios/henry-hill.json and `terrainMeta` the field's assets/terrain/<field>.json (its halfSize and name).
 */
export function sandboxBattleScenario({ field, us, cs, attacker }, { packs, henryHill, terrainMeta }) {
  if (!FIELD_IDS.includes(field)) throw new Error('Sandbox battle: the "field" parameter names no built field.');
  if (!SIDES.includes(attacker)) throw new Error('Sandbox battle: the "attacker" parameter must be US or CS.');
  const half = terrainMeta?.halfSize;
  if (!Number.isFinite(half) || typeof terrainMeta.name !== 'string') throw new Error('Sandbox battle: the field terrain description is invalid.');
  const U = rosterSource(packs, us, 'US', 'us'), C = rosterSource(packs, cs, 'CS', 'cs');
  const scenarios = [henryHill, ...packs.flatMap((p) => p.phases.map((ph) => ph.scenario))];
  const source = dressingSource(field, scenarios), defender = attacker === 'US' ? 'CS' : 'US';
  const strip = (u) => { const d = structuredClone(u); for (const k of DROPPED) delete d[k]; return d; };
  const formations = [...rosterUnits(U.phase.scenario, 'US'), ...rosterUnits(C.phase.scenario, 'CS')].map(strip);
  // Game rule: the attacker's formations march on the objective at once (ignored for the player's own); the defender's hold.
  const units = deploy(formations, attacker, half).map((d) => (d.side === attacker ? { ...d, ai: { role: 'attack' } } : d));
  const base = Math.max(phaseMenPerFigure(U.phase.scenario), phaseMenPerFigure(C.phase.scenario));
  // Opening view (game rule): from behind the Union front, looking at the enemy, pulled toward the centre so the camera
  // itself stands on the map (src/sim/sides.js turns it for a Confederate player).
  const dist = 1200, dirUS = attacker === 'US' ? 1 : -1, usX = units.filter((d) => d.side === 'US').map((d) => d.x);
  const front = dirUS > 0 ? Math.max(...usX) : Math.min(...usX), reach = half - 100 - dist;
  const target = [Math.round(dirUS > 0 ? Math.max(front, -reach) : Math.min(front, reach)), 0];
  const A = sideName(attacker), Dn = sideName(defender), fieldName = terrainMeta.name;
  const out = {
    id: 'sandbox-battle', title: `Sandbox battle · ${fieldName}`, battle: 'Sandbox battle',
    subtitle: `${U.row.label} against ${C.row.label}`,
    date: C.phase.scenario.date, // the Confederate roster's own date: it picks their national colour (see the header)
    start: '06:00', end: '08:00', terrain: field,
    ...(source.season ? { season: source.season } : {}), ...(Number.isSafeInteger(source.seed) ? { seed: source.seed } : {}),
    clockRatio: 15, menPerFigure: figureScale(units, base), attacker, objective: { ...OBJECTIVE },
    retreat: { [attacker]: [-(half - DEPLOYMENT.edge), 0], [defender]: [half - DEPLOYMENT.edge, 0] },
    camera: { target, yaw: dirUS > 0 ? -Math.PI / 2 : Math.PI / 2, dist },
    victory: {
      attackerHolds: `${A} troops hold the centre ground at 08:00 (sandbox rule: the objective decides).`,
      defenderHolds: `${Dn} troops still hold the centre ground at 08:00 (sandbox rule: the objective decides).`,
      attackerBroken: `The ${A} attack has broken (sandbox rule: a broken side loses).`,
      defenderBroken: `The ${Dn} line has broken (sandbox rule: a broken side loses).`,
      draw: 'The centre ground is still contested at 08:00 (sandbox rule: a draw).',
    },
    briefing: { text: [`Field: ${fieldName}.`, `Union: ${U.row.label}. Confederates: ${C.row.label}.`,
      `Objective: the centre ground. The ${A} side attacks; the ${Dn} side holds it. Placement is a game rule.`] },
    historyNote: SANDBOX_NOTE,
    statusText: `Sandbox battle is ready. ${SANDBOX_NOTE} Select a brigade, then drag to give it orders.`,
    ...fieldDressing(field, [source]),
    units,
  };
  return prepareFieldScenario(out, 'pack');
}

/**
 * The address of a sandbox battle: field, us, cs, attacker, side (US unless CS) and difficulty (null for Veteran's
 * default). Throws an Error naming the first bad parameter. With `rosters` (rosterList rows) the two roster ids must
 * name built rosters of their sides; without, they need only the id shape and a sandbox pack.
 */
export function sandboxBattleSearch(params, rosters = null) {
  const q = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const bad = (key) => { throw new Error(`Sandbox battle: the "${key}" parameter is missing or unknown.`); };
  const field = q.get('field');
  if (!FIELD_IDS.includes(field)) bad('field');
  const roster = (key, side) => {
    const id = q.get(key), m = typeof id === 'string' ? ROSTER_ID.exec(id) : null;
    if (!m || !SANDBOX_PACKS.includes(m[1]) || (rosters && !rosters.some((r) => r.id === id && r.side === side))) bad(key);
    return id;
  };
  const us = roster('us', 'US'), cs = roster('cs', 'CS'), attacker = q.get('attacker');
  if (!SIDES.includes(attacker)) bad('attacker');
  const side = q.has('side') ? q.get('side') : 'US';
  if (!SIDES.includes(side)) bad('side');
  const difficulty = q.has('difficulty') ? q.get('difficulty') : null;
  if (difficulty !== null && !DIFFICULTY.levels.includes(difficulty)) bad('difficulty');
  return Object.freeze({ field, us, cs, attacker, side, difficulty });
}

/** The menu's link to one sandbox battle (Veteran and the Union add nothing to the address). */
export function sandboxBattleHref({ field, us, cs, attacker, side, difficulty }) {
  const e = encodeURIComponent;
  return `./?sandbox-battle&field=${e(field)}&us=${e(us)}&cs=${e(cs)}&attacker=${e(attacker)}${difficulty && difficulty !== 'veteran' ? `&difficulty=${e(difficulty)}` : ''}${side === 'CS' ? '&side=CS' : ''}`;
}

const MAX_BYTES = 1024 * 1024;
async function readJson(url, fetcher, current) {
  const response = await fetcher(url); current();
  if (!response.ok) throw new Error(`Sandbox battle: ${url} could not be loaded.`);
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_BYTES) throw new Error(`Sandbox battle: ${url} exceeds its download bound.`);
  const text = await response.text(); current();
  if (text.length > MAX_BYTES) throw new Error(`Sandbox battle: ${url} exceeds its download bound.`);
  return JSON.parse(text);
}

/** Read the address, fetch the three packs (each validated whole), Henry Hill and the field's terrain description, and build the scenario. */
export async function loadSandboxBattle(search, { fetcher = globalThis.fetch, isCurrent = () => true } = {}) {
  const current = () => { if (!isCurrent()) throw new Error('Field: the field launch was cancelled.'); };
  const asked = sandboxBattleSearch(search);
  const [packs, henryHill, terrainMeta] = await Promise.all([
    Promise.all(SANDBOX_PACKS.map((id) => readJson(`./assets/packs/${id}.json`, fetcher, current))),
    readJson('./assets/scenarios/henry-hill.json', fetcher, current),
    readJson(`./assets/terrain/${asked.field}.json`, fetcher, current)]);
  packs.forEach((pack, i) => {
    preparePhase(pack, pack?.phases?.[0]?.id); // every phase validates, or the whole pack is refused
    if (pack.id !== SANDBOX_PACKS[i]) throw new Error('Sandbox battle: a battle pack identity does not match its file.');
  });
  const params = sandboxBattleSearch(search, rosterList(packs));
  return Object.freeze({ params, scenario: sandboxBattleScenario(params, { packs, henryHill, terrainMeta }) });
}

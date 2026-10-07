// Completed practice outcomes only. No campaign/battle save, historical loot, or invented captures.
import { completedSnapshot, validateSnapshot, MAX_SAVE_BYTES } from './save.js';
import { introScenario } from './intro.js';
import { ARMS, UNIQUES, CONDITIONS, VETERANCY, ISSUE_PLACE } from '../reward/data.js';
import { gradeSpec, rollLoot, seedOf } from '../reward/model.js';

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
export function savedDeployment({ baseline, ground, awardId, seed }) {
  const before = validateSnapshot(baseline);
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
  const scenario = JSON.parse(JSON.stringify(introScenario(ground)));
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
  const held = game.fieldCaptures?.held('US') || [], crateIds = new Set(), crates = new Map(scenario.crates.map((c) => [c.id, c]));
  if (!Array.isArray(held) || held.length > crates.size) fail('invalid field captures.');
  for (const c of held) {
    if (!c || !crates.has(c.id) || crateIds.has(c.id) || c.tier !== crates.get(c.id).tier) fail('invalid field captures.');
    crateIds.add(c.id);
  }
  const captures = held.map((c) => ({ id: c.id, tier: c.tier, from: captureOrigin(crates.get(c.id)) }));
  const grade = game.result.winner === 'US' ? 'Victory' : 'Defeat';
  const loot = rollLoot({ seed, grade, captures });
  const cards = loot.cards.map((c) => ({ ...c, uid: `${awardId}.${c.uid}` }));
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
  return q.has('sandbox') ? 'sandbox' : q.has('battle') ? 'historical' : 'practice';
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
      base: { fire: 25 + xp * 10, melee: 30 + xp * 8, morale: 40 + xp * 8, drill: 30 + xp * 10 },
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
  const held = game.fieldCaptures?.held(game.playerSide) || [];
  const crateDefs = new Map((scenario.crates || []).map((c) => [c.id, c]));
  const crateIds = new Set();
  if (!Array.isArray(held) || held.length > crateDefs.size) fail('invalid field captures.');
  for (const c of held) {
    if (!c || !crateDefs.has(c.id) || crateIds.has(c.id) || c.tier !== crateDefs.get(c.id).tier) fail('invalid field captures.');
    crateIds.add(c.id);
  }
  const captures = held.map((c) => ({ id: c.id, tier: c.tier, from: `Captured: ${crateDefs.get(c.id).name} (fictional practice stores)` }));
  return { ...before, captures, summary: { starting, surviving, losses: starting - surviving,
    guns: before.army.reduce((n, b) => n + (b.guns || 0), 0), title: scenario.title, why: game.result.why } };
}

// Completed practice outcomes only. No campaign/battle save, historical loot, or invented captures.
import { completedSnapshot } from './save.js';

const fail = (message) => { throw new Error(`Practice: ${message}`); };
const WEAPONS = { infantry: new Set(['smooth', 'rifled']), artillery: new Set(['smbart', 'parrott']) };

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

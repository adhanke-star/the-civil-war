// CPU check: the Outranged rule and its words (v5 LEG B; src/sim/combat.js OUTRANGED, src/units/unit.js outranged,
// src/ui/hud.js activity / intention / outrangedHint / createHints). A formation is Outranged while it has been under fire for the last
// 10 s of battle time and in that window never had an enemy inside its own effective range with line of sight. Fictional
// fields on flat ground (one with a fictional wall), built here; nothing here is historical. Only the player's own
// formations read Outranged (marker word, tooltip, card, army list and hint); a computer formation says what it is doing.
// The hint keeps the contract's sentence for infantry; a battery's says "guns" and leaves out Charge (guns cannot charge),
// a cavalry line's says "carbines" or "revolvers" (src/ui/hud.js outrangedText).
// `node tools/test-outranged.mjs` prints OUTRANGED OK (n/n); `--prove-fail` also runs one mutant per check and requires each
// to fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { OUTRANGED } from '../src/sim/combat.js';
import { LOOK } from '../src/ui/look.js';
import { activity, intention, outrangedHint, createHints } from '../src/ui/hud.js';
import * as settings from '../src/settings.js';

RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const DT = 0.05, GAP = 219; // the contract's distance: a rifled line's effective range (DECISIONS 0283)
const FLAT = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
// a fictional wall 20 m thick and 40 m high east of the origin (blocks sight from (0, 0) to (60, 0), not to the north)
const WALLED = { ...FLAT, heightAt: (x, z) => (x >= 20 && x <= 40 && z > -60 && z < 60 ? 40 : 0) };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 1500, weapon: 'smooth', xp: 1,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });
const TEXT = 'smooth is outranged: its muskets cannot reach the line firing on it. Charge (C), fall back (F) or hold.';

/** A fictional field: every unit holds its ground under the player's hand (the AI orders nobody); `quiet` units hold fire. */
function field(api, defs, { terrain = FLAT, quiet = [], playerSide = 'US' } = {}) {
  const s = { id: 'henry-hill', title: 'Fictional Outranged CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '15:00',
    units: defs, sites: [], woods: [], objective: { name: 'Fictional remote point', x: 1800, z: 1800, r: 45 } };
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} }, playerSide });
  for (const u of g.units) { u.manual = true; u.holdFire = quiet.includes(u.id); }
  api.patch(g);
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);
const moveTo = (u, x, z) => { u.vehicle.position.x = x; u.vehicle.position.z = z; };
/** Run `seconds`, calling `each(g)` after every tick. */
const run = (g, seconds, each = () => {}) => { for (let k = 0; k < Math.round(seconds / DT); k++) { g.tick(DT); each(g); } };
/** The contract's pair: a smoothbore line (US) and a rifled line (CS) halted 219 m apart, facing each other. */
const pair = (api, opts) => field(api, [def('smooth', 'US', 0, 0), def('rifled', 'CS', 0, GAP, { weapon: 'rifled' })], opts);
/** Watch `id`: the battle time of its first loss and of its first Outranged step, and whether it ever was. */
function watch(g, id) {
  const u = unit(g, id), w = { hitT: null, onT: null, ever: false };
  return [w, () => {
    if (w.hitT === null && u.men < u.menMax) w.hitT = g.simTime;
    if (u.outranged) { w.ever = true; if (w.onT === null) w.onT = g.simTime; }
  }];
}
/** A memory sessionStorage (one per fictional browser tab). */
const tab = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
/** Every hint the HUD would show over `seconds` (it asks 4 times a second). */
function hintsOver(api, g, seconds, playerSide, hints) {
  const out = [];
  let next = 0;
  run(g, seconds, () => { if (g.simTime >= next) { next += 0.25; const h = api.outrangedHint(g.units, playerSide, hints); if (h) out.push(h); } });
  return out;
}

export const OUTRANGED_CHECKS = [
  ['outranged-window', async (api) => {
    const g = pair(api), [w, tick] = watch(g, 'smooth'), [r, tickR] = watch(g, 'rifled');
    run(g, 30, () => { tick(); tickR(); });
    assert.ok(w.onT !== null && w.onT <= 12, `outranged-window: the smoothbore line 219 m from a rifled line must be Outranged within 12 s (first at ${w.onT})`);
    assert.ok(w.hitT !== null && w.onT - w.hitT >= OUTRANGED.window,
      `outranged-window: Outranged only after ${OUTRANGED.window} s under fire (first hit ${w.hitT?.toFixed(2)} s, Outranged at ${w.onT?.toFixed(2)} s)`);
    assert.equal(unit(g, 'smooth').outranged, true, 'outranged-window: still Outranged at 30 s while the fire goes on');
    assert.equal(r.ever, false, 'outranged-window: the rifled line (its target in reach) is never Outranged');
  }],
  ['needs-fire', async (api) => {
    // 400 m apart nobody reaches anybody and nobody is hit: no one is Outranged; then the rifled line closes to 219 m.
    const g = field(api, [def('smooth', 'US', 0, 0), def('rifled', 'CS', 0, 400, { weapon: 'rifled' })]);
    const [s, tickS] = watch(g, 'smooth'), [r, tickR] = watch(g, 'rifled');
    run(g, 15, () => { tickS(); tickR(); });
    assert.deepEqual([s.ever, r.ever, s.hitT], [false, false, null], 'needs-fire: out of every range and unhit, neither line is Outranged');
    moveTo(unit(g, 'rifled'), 0, GAP);
    run(g, 20, tickR);
    assert.equal(r.ever, false, 'needs-fire: the rifled line, never under fire, is never Outranged');
  }],
  ['in-range-never', async (api) => {
    for (const [weapon, gap] of [['smooth', 80], ['rifled', 80], ['rifled', 200]]) {
      const g = field(api, [def('a', 'US', 0, 0, { weapon }), def('b', 'CS', 0, gap, { weapon })]);
      const [a, tickA] = watch(g, 'a'), [b, tickB] = watch(g, 'b');
      run(g, 30, () => { tickA(); tickB(); });
      assert.ok(a.hitT !== null && b.hitT !== null, `in-range-never: both ${weapon} lines at ${gap} m must take fire (${a.hitT}, ${b.hitT})`);
      assert.deepEqual([a.ever, b.ever], [false, false], `in-range-never: ${weapon} lines ${gap} m apart, each with a target in reach, are never Outranged`);
    }
  }],
  ['reach-needs-sight', async (api) => {
    // A quiet enemy 60 m east is inside the smoothbore line's effective range (no firing arc in the rule): in sight it counts
    // as reach; behind the wall it does not, and the rifled line's fire makes the smoothbore line Outranged.
    const defs = () => [def('smooth', 'US', 0, 0), def('rifled', 'CS', 0, GAP, { weapon: 'rifled' }), def('hidden', 'CS', 60, 0, { facing: -Math.PI / 2 })];
    const open = field(api, defs(), { quiet: ['hidden'] }), [o, tickO] = watch(open, 'smooth');
    run(open, 20, tickO);
    assert.ok(o.hitT !== null && !o.ever, `reach-needs-sight: with the quiet enemy in sight the smoothbore line is not Outranged (hit ${o.hitT}, ever ${o.ever})`);
    const walled = field(api, defs(), { quiet: ['hidden'], terrain: WALLED }), [b, tickB] = watch(walled, 'smooth');
    assert.equal(walled.combat.los(unit(walled, 'smooth'), unit(walled, 'hidden')), false, 'reach-needs-sight: the wall blocks sight to the quiet enemy');
    run(walled, 20, tickB);
    assert.ok(b.onT !== null && b.onT <= 12, `reach-needs-sight: behind the wall the quiet enemy is no reach; Outranged within 12 s (at ${b.onT})`);
  }],
  ['marker-word', async (api) => {
    const g = pair(api);
    run(g, 15);
    const s = unit(g, 'smooth');
    assert.deepEqual(api.activity(s, 'US'), ['Outranged', 'warn'], 'marker-word: the outranged halted line reads Outranged on its marker');
    assert.notEqual(api.activity(unit(g, 'rifled'), 'US')[0], 'Outranged', 'marker-word: the line firing on it does not');
    g.orderGroup(s, { type: 'move', points: [[s.x, s.z], [s.x - 300, s.z]] });
    run(g, 0.5);
    assert.ok(s.follow.active && api.activity(s, 'US')[0] !== 'Outranged', `marker-word: a line on the march says where it goes instead (${api.activity(s, 'US')[0]})`);
  }],
  ['marker-player-only', async (api) => {
    // The computer's (CS) smoothbore line outranged by the player's (US) rifled line: its marker word and tooltip (also the
    // card's line) say what it is doing, never Outranged; a Confederate player reading the same line sees Outranged.
    const g = field(api, [def('smooth', 'CS', 0, GAP), def('rifled', 'US', 0, 0, { weapon: 'rifled' })]);
    run(g, 15);
    const s = unit(g, 'smooth');
    assert.equal(s.outranged, true, "marker-player-only: the computer's smoothbore line is Outranged by the rule (the field works)");
    const word = api.activity(s, 'US')[0], tip = api.intention(s, 'US');
    assert.ok(word !== 'Outranged' && !/Outranged/.test(tip), `marker-player-only: the computer's marker reads ${word} and its tooltip "${tip}"; Outranged is never shown for the computer's side`);
    assert.equal(api.activity(s, 'CS')[0], 'Outranged', 'marker-player-only: a Confederate player sees his own line read Outranged');
  }],
  ['hint-once', async (api) => {
    const session = tab();
    const first = hintsOver(api, pair(api), 30, 'US', api.createHints(session));
    assert.deepEqual(first, [TEXT], `hint-once: one hint, in the contract's words, the first time (${first.length} shown: ${JSON.stringify(first.slice(0, 2))})`);
    const again = hintsOver(api, pair(api), 30, 'US', api.createHints(session));
    assert.deepEqual(again, [], 'hint-once: a second battle in the same session (a new page in the same tab) shows no hint');
    const fresh = hintsOver(api, pair(api), 30, 'US', api.createHints(tab()));
    assert.deepEqual(fresh, [TEXT], 'hint-once: a new session shows it once again');
    const bare = api.createHints(null); // no sessionStorage (private mode): this page still shows it once
    assert.deepEqual([bare.once('outranged'), bare.once('outranged')], [true, false], 'hint-once: without storage the page shows it once');
  }],
  ['hint-player-only', async (api) => {
    // Mirror the pair: the computer's (CS) smoothbore line is outranged by the player's (US) rifled line.
    const mirror = () => field(api, [def('smooth', 'CS', 0, GAP), def('rifled', 'US', 0, 0, { weapon: 'rifled' })]);
    const g = mirror(), [w, tick] = watch(g, 'smooth'), hints = [];
    let next = 0;
    const h = api.createHints(tab());
    run(g, 30, () => { tick(); if (g.simTime >= next) { next += 0.25; const t = api.outrangedHint(g.units, 'US', h); if (t) hints.push(t); } });
    assert.ok(w.ever, 'hint-player-only: the computer\'s smoothbore line is Outranged (the field works)');
    assert.deepEqual(hints, [], `hint-player-only: never shown for the computer's side (${JSON.stringify(hints)})`);
    const cs = hintsOver(api, mirror(), 30, 'CS', api.createHints(tab()));
    assert.deepEqual(cs, [TEXT], 'hint-player-only: the Confederate player takes it for his own line');
  }],
  ['read-only', async (api) => {
    // The rule only reads: a field with its bookkeeping switched off fights exactly the same battle.
    const trace = (off) => {
      const g = field(api, [def('smooth', 'US', 0, 0), def('rifled', 'CS', 0, GAP, { weapon: 'rifled' }), def('near', 'US', 300, 0), def('far', 'CS', 300, 100, { weapon: 'rifled' })]);
      if (off) { g.combat.outrangedStep = () => {}; g.combat.tookFire = () => {}; }
      const rows = [];
      let next = 0;
      run(g, 40, () => { if (g.simTime >= next) { next += 1; rows.push(g.units.map((u) => [u.men, u.morale, u.x, u.z, u.state].join())); } });
      return { rows, rnd: g.rnd() };
    };
    assert.deepEqual(trace(false), trace(true), 'read-only: the Outranged bookkeeping changed the battle (men, morale, places or the random stream)');
  }],
];

const API = { patch() {}, activity, intention, outrangedHint, createHints };
// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'outranged-window': { patch: (g) => { const o = g.combat.outrangedStep.bind(g.combat); g.combat.outrangedStep = (t) => o(t, 0); } }, // window 0 s
  'needs-fire': { patch: (g) => { const o = g.combat.outrangedStep.bind(g.combat); g.combat.outrangedStep = (t) => { for (const u of g.units) g.combat.tookFire(u, t); o(t); }; } },
  'in-range-never': { patch: (g) => { g.combat.inReach = () => false; } },
  'reach-needs-sight': { patch: (g) => { const c = g.combat; c.inReach = (u) => c.units.some((e) => e.side !== u.side && e.alive && Math.hypot(e.x - u.x, e.z - u.z) - e.halfFront * 0.4 <= c.effRange(u)); } },
  'marker-word': { activity: (u) => activity(Object.create(u, { outranged: { value: false } })) },
  'marker-player-only': { activity: (u) => activity(u, u.side), intention: (u) => intention(u, u.side) }, // the word for every side
  'hint-once': { createHints: () => ({ once: () => true, seen: () => false }) },
  'hint-player-only': { outrangedHint: (units, side, hints) => outrangedHint(units, units.find((u) => u.outranged)?.side ?? side, hints) },
  'read-only': { patch: (g) => { const o = g.combat.outrangedStep.bind(g.combat); g.combat.outrangedStep = (t, w) => { g.combat.rnd(); o(t, w); }; } },
};

export async function outrangedUnit(api = API) {
  for (const [, check] of OUTRANGED_CHECKS) await check(api);
  return OUTRANGED_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await outrangedUnit();
  console.log(`OUTRANGED OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of OUTRANGED_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`OUTRANGED CONTROLS OK (${rows.length}/${count})`);
  }
}

// CPU check: delegation (DESIGN.md 2 "Command"; Game.delegate / reclaim / undelegate in src/game.js, the delegated
// pass of src/sim/ai.js). Fictional fixtures are built here from assets/scenarios/henry-hill.json on flat ground.
// `node tools/test-delegation.mjs` prints DELEGATION OK (n/n); `--prove-fail` also runs one semantic mutant per check
// and requires each to fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Ai } from '../src/sim/ai.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { henryHillRun } from './test-packs.mjs';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
// The Henry Hill oracle is owned by tools/test-packs.mjs (observed on the pre-pack parent); read it, never restate it.
const ORACLE = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
// Every formation's place, facing and order after the same 16 s run (friendly mask off): owned by tools/test-ai.mjs.
const PLACES = JSON.parse(fs.readFileSync(new URL('./test-ai.mjs', import.meta.url), 'utf8').match(/^const PLACES = (\[.*\]);$/m)[1]);
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const FAR_CS = { x: 1500, z: 1500 };
const API = { patch: {}, game: {}, proto: null };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A fictional phase on the Henry Hill ground: only the listed roster ids, each with its overrides. */
function game(api, roster) {
  const s = copy(HH);
  s.id = 'test-delegation'; s.title = 'Fictional delegation test (test only)';
  s.units = Object.entries(roster).map(([id, over]) => ({ ...copy(HH.units.find(u => u.id === id)), ...over }));
  const p = prepareFieldScenario(s, 'pack');
  setPlan(p);
  const g = new Game({ scene: new Scene(), terrain, scenario: p, world: { fenceField: null }, effects });
  Object.assign(g.ai, api.patch);
  Object.assign(g, api.game);
  g.initializeReinforcements();
  return g;
}
const unit = (g, id) => g.units.find(u => u.id === id);
const dist = (a, b) => Math.hypot(a.x - (b.x ?? b[0]), a.z - (b.z ?? b[1]));
const run = (g, seconds, each) => { for (let k = Math.round(seconds / 0.05); k > 0; k--) { g.tick(0.05); if (each && each()) return true; } return false; };
const settled = (...us) => us.every(u => !u.follow.active && !u.engaged && u.order.type === 'hold');
const place = (u, x, z, facing) => { u.vehicle.position.set(x, 0, z); if (facing !== undefined) { u.facing = facing; u.goalFacing = facing; } u.snapFigures(); };
const state = (u) => ({ x: +u.x.toFixed(6), z: +u.z.toFixed(6), facing: +u.facing.toFixed(6), order: u.order.type, firm: !!u.order.firm,
  dest: u.order.dest ? u.order.dest.map(v => +v.toFixed(6)) : null, target: u.order.target?.id ?? null, run: !!u.run, holdFire: !!u.holdFire,
  follow: u.follow.active, delegate: u.delegate ?? null });

const P = [0, 330]; // the delegated place in most checks: 330 m east of Franklin's start, facing east

export const DELEGATION_CHECKS = [
  ['attack-reaches-holds', async api => {
    const g = game(api, { franklin: {}, jackson: FAR_CS });
    const f = unit(g, 'franklin');
    assert.equal(g.delegate([f], 'attack', ...P), 1, 'attack-reaches-holds: Franklin is delegated');
    run(g, 300, () => g.simTime > 5 && dist(f, P) < 25 && settled(f));
    assert.ok(dist(f, P) < 25 && settled(f), `attack-reaches-holds: marches to the place and halts there (${dist(f, P).toFixed(0)} m, ${f.order.type})`);
    run(g, 30);
    assert.ok(dist(f, P) < 25 && settled(f) && f.order.firm === true && f.delegate?.role === 'attack',
      `attack-reaches-holds: holds the place firm and stays delegated (${dist(f, P).toFixed(0)} m, ${JSON.stringify(f.order)})`);
  }],
  ['attack-line', async api => {
    const g = game(api, { franklin: {}, willcox: {}, jackson: FAR_CS });
    const us = ['franklin', 'willcox'].map(id => unit(g, id));
    g.delegate(us, 'attack', ...P);
    run(g, 400, () => g.simTime > 20 && settled(...us));
    assert.ok(settled(...us), 'attack-line: both brigades arrive and hold');
    // side by side across the approach: fronts apart, on one line through the place, the nearer one on it
    const gap = dist(us[0], us[1]), fronts = us[0].lineHalfFront() + us[1].lineHalfFront();
    const across = Math.abs((us[1].x - us[0].x) * Math.cos(us[0].facing) - (us[1].z - us[0].z) * Math.sin(us[0].facing));
    assert.ok(gap >= fronts && gap <= fronts + 80 && across >= gap - 10 && Math.min(...us.map(u => dist(u, P))) < 25,
      `attack-line: they form one line side by side at the place (${gap.toFixed(0)} m apart, ${across.toFixed(0)} m across, fronts ${fronts.toFixed(0)} m)`);
  }],
  ['attack-engages', async api => {
    const g = game(api, { franklin: {}, bee: FAR_CS });
    const f = unit(g, 'franklin'), b = unit(g, 'bee');
    g.delegate([f], 'attack', ...P);
    run(g, 300, () => g.simTime > 5 && dist(f, P) < 25 && settled(f));
    place(b, P[0] + 130, P[1], -Math.PI / 2); // an enemy 130 m in front of the held place
    let engaged = false;
    run(g, 4, () => (engaged = f.order.type === 'attack' && f.order.target === b));
    assert.ok(engaged, `attack-engages: attacks the enemy inside 150 m of its place (${f.order.type})`);
    place(b, P[0] + 700, P[1], -Math.PI / 2); // drawn far away: the attack is called off and it returns
    run(g, 120, () => f.order.type !== 'attack' && dist(f, P) < 25 && settled(f));
    assert.ok(f.order.type !== 'attack' && dist(f, P) < 60, `attack-engages: an attack drawn far from the place is called off (${f.order.type}, ${dist(f, P).toFixed(0)} m)`);
  }],
  ['defend-holds-faces', async api => {
    const g = game(api, { franklin: {}, jackson: { x: P[0] + 1000, z: P[1] - 300 } });
    const f = unit(g, 'franklin'), j = unit(g, 'jackson');
    g.delegate([f], 'defend', ...P);
    run(g, 300, () => g.simTime > 5 && dist(f, P) < 25 && settled(f) && Math.abs(wrap(f.facing - f.goalFacing)) < 0.02);
    const want = Math.atan2(j.x - P[0], j.z - P[1]);
    assert.ok(dist(f, P) < 25 && settled(f), `defend-holds-faces: goes to the place and holds (${dist(f, P).toFixed(0)} m)`);
    assert.ok(Math.abs(wrap(f.facing - want)) < 0.2, `defend-holds-faces: forms facing the enemy's approach (${f.facing.toFixed(2)} vs ${want.toFixed(2)})`);
    run(g, 40);
    assert.ok(dist(f, P) < 25 && f.order.firm === true, `defend-holds-faces: stays firm on the place (${JSON.stringify(f.order)})`);
  }],
  ['support-trails', async api => {
    const g = game(api, { franklin: {}, willcox: {}, bee: { x: P[0] + 300, z: P[1], facing: -Math.PI / 2 } });
    const f = unit(g, 'franklin'), w = unit(g, 'willcox');
    g.delegate([f], 'attack', ...P);
    g.delegate([w], 'support', ...P);
    const behind = () => {
      const fx = Math.sin(f.facing), fz = Math.cos(f.facing), d = dist(w, f), along = (w.x - f.x) * fx + (w.z - f.z) * fz;
      return { d, along, ok: d >= 120 && d <= 180 && along < -100 };
    };
    run(g, 300, () => g.simTime > 30 && settled(f, w) && behind().ok);
    assert.ok(behind().ok && settled(w), `support-trails: stands 120-180 m behind the friend at the place (${JSON.stringify(behind())})`);
    assert.ok(g.order(f, { type: 'move', points: [[f.x, f.z], [P[0], P[1] - 200]], endFacing: Math.PI / 2 }), 'support-trails: the friend takes a direct march');
    run(g, 300, () => g.simTime > 5 && settled(f, w) && dist(f, [P[0], P[1] - 200]) < 25 && behind().ok);
    assert.ok(dist(f, [P[0], P[1] - 200]) < 25 && behind().ok, `support-trails: moves up behind the friend when it moves (${JSON.stringify(behind())})`);
  }],
  ['support-unmasked-fire', async api => {
    const g = game(api, { franklin: {}, ricketts: {}, bee: { x: P[0] + 300, z: P[1], facing: -Math.PI / 2 } });
    const f = unit(g, 'franklin'), r = unit(g, 'ricketts'), b = unit(g, 'bee');
    g.delegate([f], 'attack', ...P);
    g.delegate([r], 'support', ...P);
    run(g, 300, () => g.simTime > 30 && settled(f, r) && r.unlimbered && dist(r, f) < 180);
    assert.ok(settled(r) && r.unlimbered && dist(r, b) < g.range(r), `support-unmasked-fire: the battery stands behind its friend with the enemy in range (${dist(r, b).toFixed(0)} m)`);
    const shots = r.shots || 0;
    let masked = false;
    run(g, 40, () => { masked = masked || r.masked; return false; });
    assert.ok((r.shots || 0) === shots && masked, `support-unmasked-fire: holds its fire while the friend masks it (${(r.shots || 0) - shots} shots, masked ${masked})`);
    g.combat.rout(f, true); g.reclaim(f); // the friend breaks: the battery takes its place and its line is clear
    run(g, 200, () => (r.shots || 0) > shots);
    assert.ok((r.shots || 0) > shots, `support-unmasked-fire: fires once nothing masks it (${(r.shots || 0) - shots} shots)`);
  }],
  ['support-replaces', async api => {
    const g = game(api, { franklin: {}, willcox: {}, bee: { x: P[0] + 300, z: P[1], facing: -Math.PI / 2 } });
    const f = unit(g, 'franklin'), w = unit(g, 'willcox');
    g.delegate([f], 'attack', ...P);
    g.delegate([w], 'support', ...P);
    run(g, 300, () => g.simTime > 30 && settled(f, w) && dist(w, f) > 120);
    const spot = { x: f.x, z: f.z };
    g.combat.rout(f, true); g.reclaim(f);
    run(g, 300, () => dist(w, spot) < 25 && settled(w));
    assert.ok(dist(w, spot) < 25 && settled(w), `support-replaces: takes the routed friend's place (${dist(w, spot).toFixed(0)} m from it)`);
    run(g, 20);
    assert.ok(dist(w, spot) < 25 && w.order.firm === true, 'support-replaces: holds it firm');
  }],
  ['reclaim', async api => {
    const KINDS = ['move', 'attack', 'charge', 'hold', 'halt', 'run', 'fallback', 'holdfire'];
    const issue = (g, f, b, kind) => {
      if (kind === 'move') return g.order(f, { type: 'move', points: [[f.x, f.z], [f.x, f.z - 120]], endFacing: 0 });
      if (kind === 'attack') return g.order(f, { type: 'attack', target: b });
      if (kind === 'charge') return g.order(f, { type: 'charge', points: [[f.x, f.z], [b.x, b.z]], target: b });
      g.select(f);
      return g.orderSelected(kind);
    };
    const fixture = () => { const g = game(api, { franklin: {}, bee: { x: 400, z: 900, facing: Math.PI } }); return [g, unit(g, 'franklin'), unit(g, 'bee')]; };
    for (const kind of KINDS) {
      // delegated and taken back at once: the order runs exactly as for a brigade never delegated
      const [a, fa, ba] = fixture(), [d, fd, bd] = fixture();
      d.delegate([fd], 'attack', ...P);
      assert.ok(issue(d, fd, bd, kind) && issue(a, fa, ba, kind), `reclaim: ${kind} accepted`);
      assert.equal(fd.delegate, undefined, `reclaim: ${kind} clears the delegation`);
      run(a, 10); run(d, 10);
      assert.deepEqual(state(fd), state(fa), `reclaim: ${kind} then runs exactly as for a brigade never delegated`);
      // delegated and already marching under the AI: the direct order takes it back for good
      const [g, f, b] = fixture();
      g.delegate([f], 'attack', ...P);
      run(g, 4);
      assert.ok(f.follow.active && f.order.type === 'move', `reclaim: ${kind}: the AI marches the delegated brigade first`);
      issue(g, f, b, kind);
      assert.equal(f.delegate, undefined, `reclaim: ${kind} takes a marching delegated brigade back`);
      const after = state(f);
      run(g, 10);
      if (kind === 'hold' || kind === 'halt') assert.ok(dist(f, after) < 1 && f.order.type === 'hold', `reclaim: ${kind}: the AI no longer marches it`);
      if (kind === 'move') assert.deepEqual(state(f).dest ?? after.dest, after.dest, 'reclaim: move: the AI no longer re-routes it');
      if (kind === 'attack') assert.ok(f.order.type === 'attack' && f.order.target === b, 'reclaim: attack: the AI no longer calls the attack off');
    }
  }],
  ['undo', async api => {
    const g = game(api, { franklin: {}, willcox: {}, jackson: FAR_CS });
    const f = unit(g, 'franklin'), w = unit(g, 'willcox');
    g.delegate([f, w], 'defend', ...P);
    run(g, 4);
    assert.ok(f.follow.active && w.follow.active, 'undo: the delegated brigades march first');
    assert.equal(g.undelegate([f, w]), 2, 'undo: both are taken back');
    assert.ok(!f.delegate && !w.delegate && settled(f, w) && !f.order.firm, `undo: each halts where it stands (${JSON.stringify(f.order)})`);
    const at = [{ x: f.x, z: f.z }, { x: w.x, z: w.z }];
    run(g, 20);
    assert.ok(dist(f, at[0]) < 1 && dist(w, at[1]) < 1 && !f.delegate && !w.delegate, 'undo: and stays under the player\'s orders');
  }],
  ['undelegated-identical', async api => {
    const restore = api.proto ? api.proto() : null, mask = RULES.friendlyMask;
    try {
      assert.deepEqual(henryHillRun(), ORACLE, 'undelegated-identical: Henry Hill without delegation matches the test-packs oracle');
      RULES.friendlyMask = false; // the places were observed before the friendly-fire mask (as tools/test-ai.mjs compares them)
      const s = copy(HH); s.end = '14:01';
      setPlan(s);
      const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
      g.fastForward(16);
      const places = g.units.map(u => [u.id, +u.x.toFixed(3), +u.z.toFixed(3), +u.facing.toFixed(4), u.order.type, !!u.order.firm, u.follow.active]);
      assert.deepEqual(places, PLACES, 'undelegated-identical: every formation stands, faces and holds as on the parent');
    } finally { restore?.(); RULES.friendlyMask = mask; }
  }],
  ['enemy-ai-unchanged', async api => {
    const trace = (delegated) => {
      const g = game(api, { jackson: { x: 900, z: 500, ai: { role: 'attack' } }, franklin: { x: -1500, z: -1500 } });
      const j = unit(g, 'jackson'), f = unit(g, 'franklin');
      if (delegated) g.delegate([f], 'defend', -1600, -1650);
      const rows = [];
      for (let k = 0; k < 120; k++) { run(g, 1); rows.push([+j.x.toFixed(6), +j.z.toFixed(6), +j.facing.toFixed(6), j.order.type]); }
      return { rows, moved: delegated ? dist(f, [-1500, -1500]) : 0 };
    };
    const plain = trace(false), withDelegation = trace(true);
    assert.ok(withDelegation.moved > 50, `enemy-ai-unchanged: the far delegated brigade did move (${withDelegation.moved.toFixed(0)} m)`);
    assert.ok(plain.rows.at(-1)[0] < 700, 'enemy-ai-unchanged: the enemy attacker advances');
    assert.deepEqual(withDelegation.rows, plain.rows, 'enemy-ai-unchanged: an enemy attacker marches exactly as without a delegated brigade');
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'attack-reaches-holds': { patch: { plan(u) { const m = Ai.prototype.plan.call(this, u); m.aim = [u.def.x, u.def.z]; return m; } } }, // never leaves
  'attack-line': { patch: { place(grp, v) { grp.n++; grp.pos.set(v, 0); } } }, // every brigade aims at one point
  'attack-engages': { patch: { foeNear: () => null } }, // ignores the enemy at its place
  'defend-holds-faces': { patch: { defendFacing(u, x, z) { return Ai.prototype.defendFacing.call(this, u, x, z) + Math.PI; } } }, // faces away
  'support-trails': { patch: { supported: () => null } }, // finds no friend: waits on the place
  'support-unmasked-fire': { patch: { support(u, m, near, nd) { // trails in front of the friend instead of behind it
    const f = this.supported(u); if (!f) return Ai.prototype.support.call(this, u, m, near, nd);
    const was = f.facing; f.facing = was + Math.PI;
    try { Ai.prototype.support.call(this, u, m, near, nd); } finally { f.facing = was; }
  } } },
  'support-replaces': { patch: { support(u, m, near, nd) { m.spot = null; return Ai.prototype.support.call(this, u, m, near, nd); } } }, // forgets the friend's place
  'reclaim': { game: { reclaim: () => false } }, // a direct order leaves the delegation in place
  'undo': { game: { undelegate(units) { for (const u of units) u.orderHalt(); return units.length; } } }, // halts but keeps the delegation
  'undelegated-identical': { proto: () => { // the delegated pass leaks into every own brigade (defend where it stands)
    const step = Ai.prototype.step;
    Ai.prototype.step = function (dt) {
      for (const u of this.game.units) if (u.side === this.game.playerSide && !u.delegate) u.delegate = { role: 'defend', x: u.x, z: u.z, since: 0 };
      return step.call(this, dt);
    };
    return () => { Ai.prototype.step = step; };
  } },
  'enemy-ai-unchanged': { patch: { step(dt) { // with any delegation, the enemy pass is skipped
    if (!this.game.units.some(u => u.delegate)) return Ai.prototype.step.call(this, dt);
    this.t -= dt; if (this.t > 0) return; this.t = 0.5;
    for (const u of this.game.units) if (u.delegate && u.alive && u.state !== 'routing' && !u.melee) this.delegated(u, ...this.nearestFoe(u));
  } } },
};

export async function delegationUnit(api = API) {
  for (const [, check] of DELEGATION_CHECKS) await check(api);
  return DELEGATION_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const list = only ? DELEGATION_CHECKS.filter(([n]) => n === only) : DELEGATION_CHECKS;
  for (const [name, check] of list) { await check(API); if (only) console.log(`ok ${name}`); }
  const count = list.length;
  console.log(`DELEGATION OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of list) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`DELEGATION CONTROLS OK (${rows.length}/${count})`);
  }
}

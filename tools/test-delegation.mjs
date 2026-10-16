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
import { installDelegationPointerObserver } from './test-delegation-ui.mjs';

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
const API = { patch: {}, game: {}, proto: null, pointerObserver: installDelegationPointerObserver };
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

function pointerFixture() {
  const target = () => {
    const listeners = [];
    return { listeners,
      addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
      removeEventListener(type, fn, capture) { const i = listeners.findIndex(r => r.type === type && r.fn === fn && r.capture === capture); if (i >= 0) listeners.splice(i, 1); },
      dispatch(event) { for (const capture of [true, false]) for (const r of [...listeners]) if (r.type === event.type && !!r.capture === capture) r.fn(event); },
    };
  };
  const canvas = target(), host = target(), chooser = { hidden: true }, key = '__delegationPointerObservation0257';
  const vector = a => ({ toArray: () => [...a] });
  canvas.getBoundingClientRect = () => ({ left: 7, top: 9, width: 1000, height: 600 });
  const input = { drag: null, targeting: { mode: 'delegate' } }, franklin = { id: 'franklin', delegate: null };
  const rts = { target: vector([10, 20, 30]), goal: { x: 10, z: 30, dist: 520 }, groundY: 20, yaw: 1, pitch: 0.8, dist: 520,
    pick: (x, y) => ({ x: x + rts.groundY, z: y - rts.groundY }) };
  host.__game = { input, rts, camera: { position: vector([1, 2, 3]), matrixWorld: { elements: Array.from({ length: 16 }, (_, i) => i) },
    projectionMatrix: { elements: Array.from({ length: 16 }, (_, i) => i + 20) } }, game: { units: [franklin] } };
  Object.assign(host, { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 });
  const doc = { getElementById: id => id === 'battlefield' ? canvas : id === 'delegate-chooser' ? chooser : null };
  canvas.addEventListener('pointerdown', e => { input.drag = { ground: rts.pick(e.clientX, e.clientY), id: e.pointerId, type: e.pointerType, moved: false, delegatePick: true }; }, false);
  host.addEventListener('pointerup', () => { input.drag = null; input.targeting = null; chooser.hidden = false; }, false);
  const event = type => ({ type, target: canvas, clientX: 100.125, clientY: 200.875, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, isTrusted: true, timeStamp: 123.5 });
  return { canvas, host, doc, rts, input, franklin, chooser, key, event };
}

export const DELEGATION_CHECKS = [
  ['pointer-observer', async api => {
    const f = pointerFixture(), { host, canvas, key } = f;
    api.pointerObserver({ host, doc: f.doc });
    const o = host[key];
    o.mark('pre-click', { x: 100.125, y: 200.875 });
    f.rts.groundY = 24; // camera moves between the harness evaluation and the native event
    canvas.dispatch(f.event('pointerdown'));
    host.dispatch(f.event('pointerup'));
    f.franklin.delegate = { role: 'attack', x: 124.125, z: 176.875 };
    o.mark('post-attack', { x: 100.125, y: 200.875 });
    const before = o.read(), closed = o.close();
    assert.deepEqual(closed.rows.map(r => r.kind), ['pre-click', 'down-capture', 'down-after-input', 'up-after-input', 'post-attack'], 'pointer-observer: event phases retained in actual listener order');
    assert.deepEqual(closed.rows[0].pick, { x: 120.125, z: 180.875 }, 'pointer-observer: old pre-click pick retained');
    assert.deepEqual(closed.rows[1].pick, { x: 124.125, z: 176.875 }, 'pointer-observer: fractional event coordinates and current camera pick retained');
    assert.equal(closed.rows[1].drag, null, 'pointer-observer: capture precedes Input.down');
    assert.deepEqual(closed.rows[2].drag.ground, closed.rows[1].pick, 'pointer-observer: later bubble sees actual copied drag ground');
    assert.ok(closed.rows[3].chooser && closed.rows[3].drag === null && closed.rows[3].targeting === null, 'pointer-observer: window bubble sees Input.up chooser');
    assert.deepEqual(closed.rows[4].delegate, f.franklin.delegate, 'pointer-observer: post Attack destination retained');
    assert.ok(closed.closed && !closed.overflow && closed.errors.length === 0 && !Object.hasOwn(host, key), 'pointer-observer: clean removal');
    assert.equal(canvas.listeners.length + host.listeners.length, 2, 'pointer-observer: original listeners remain alone');
    before.rows[0].camera.world[0] = -999; f.rts.goal.x = -999; f.franklin.delegate.x = -999;
    assert.equal(closed.rows[0].camera.world[0], 0, 'pointer-observer: returned snapshots cannot mutate retained matrices');
    assert.equal(closed.rows[0].rts.goal.x, 10, 'pointer-observer: no live camera alias');
    assert.equal(closed.rows[4].delegate.x, 124.125, 'pointer-observer: no live delegate alias');
    for (const mode of ['overflow', 'read-error', 'duplicate', 'registration-error']) {
      const q = pointerFixture();
      if (mode === 'registration-error') q.host.addEventListener = () => { throw new Error('injected registration refusal'); };
      if (mode === 'registration-error') {
        assert.throws(() => api.pointerObserver({ host: q.host, doc: q.doc }), /registration refusal/, 'pointer-observer: registration error surfaces');
        assert.ok(!Object.hasOwn(q.host, q.key) && q.canvas.listeners.length === 1, 'pointer-observer: partial installation restored');
        continue;
      }
      api.pointerObserver({ host: q.host, doc: q.doc });
      if (mode === 'duplicate') assert.throws(() => api.pointerObserver({ host: q.host, doc: q.doc }), /already installed/, 'pointer-observer: duplicate refuses');
      if (mode === 'overflow') for (let i = 0; i < 10; i++) q.host[q.key].mark('extra', { x: 1, y: 2 });
      if (mode === 'read-error') { q.rts.pick = () => { throw new Error('injected pick refusal'); };
        q.host[q.key].mark('first', { x: 1, y: 2 }); q.host[q.key].mark('second', { x: 1, y: 2 }); }
      const report = q.host[q.key].close();
      if (mode === 'overflow') assert.ok(report.overflow && report.rows.length === 8, 'pointer-observer: bounded overflow refuses clean evidence');
      if (mode === 'read-error') assert.ok(report.errors.length === 2 && report.errors.every(e => e.message === 'injected pick refusal'), 'pointer-observer: observer errors retained');
      assert.equal(q.canvas.listeners.length + q.host.listeners.length, 2, 'pointer-observer: refusal cleanup preserves owned input listeners');
    }
    const late = pointerFixture(), lateAdd = late.host.addEventListener;
    late.host.addEventListener = function (...args) { lateAdd.apply(this, args); throw 0; };
    let primary = 'missing'; try { api.pointerObserver({ host: late.host, doc: late.doc }); } catch (e) { primary = e; }
    assert.equal(primary, 0, 'pointer-observer: preserve falsy primary registration error');
    assert.equal(late.canvas.listeners.length + late.host.listeners.length, 2, 'pointer-observer: stored-then-thrown registration rolls back');
    const hostile = pointerFixture(); api.pointerObserver({ host: hostile.host, doc: hostile.doc });
    let foreign = 0;
    hostile.rts.pick = () => { throw Object.defineProperty({}, 'message', { get() { foreign++; throw 0; } }); };
    hostile.host[hostile.key].mark('hostile', { x: 1, y: 2 });
    const hostileReport = hostile.host[hostile.key].close();
    assert.ok(foreign === 0 && hostileReport.errors.length === 1, 'pointer-observer: foreign error getters never execute');
    const removal = pointerFixture(); api.pointerObserver({ host: removal.host, doc: removal.doc });
    const remove = removal.canvas.removeEventListener; let attempts = 0;
    removal.canvas.removeEventListener = function (...args) { attempts++; remove.apply(this, args); if (attempts === 1) throw 0; };
    const removalReport = removal.host[removal.key].close();
    assert.ok(removalReport.closed && removalReport.errors.length === 1 && attempts === 2, 'pointer-observer: attempt all cleanup after falsy removal throw');
    assert.equal(removal.canvas.listeners.length + removal.host.listeners.length, 2, 'pointer-observer: later canvas and window cleanup attempted');
    const replaced = pointerFixture(); api.pointerObserver({ host: replaced.host, doc: replaced.doc });
    const owned = replaced.host[replaced.key];
    Object.defineProperty(replaced.host, replaced.key, { get() { foreign++; throw 0; }, configurable: true });
    const replacementReport = owned.close();
    assert.ok(replacementReport.errors.length === 1 && foreign === 0 && Object.hasOwn(replaced.host, replaced.key), 'pointer-observer: foreign replacement preserved without getter invocation');
  }],
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
  'pointer-observer': { pointerObserver(args) { const add = args.doc.getElementById('battlefield').addEventListener;
    const canvas = args.doc.getElementById('battlefield');
    canvas.addEventListener = function (type, fn, capture) { if (capture) return; return add.call(this, type, fn, capture); };
    try { return installDelegationPointerObserver(args); } finally { canvas.addEventListener = add; }
  } },
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

// Actual formation, movement, combat, picking and ghost seams; no browser, source mutation or storage.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntityManager } from 'yuka';
import { Unit, setMenPerFigure } from '../src/units/unit.js';
import { Battery } from '../src/units/battery.js';
import { Game } from '../src/game.js';
import { Combat } from '../src/sim/combat.js';
import { ArrowLayer } from '../src/ui/arrows.js';
import * as S from '../src/settings.js';

const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const terrain = { half: 3000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = { id: 'a', side: 'US', type: 'infantry', name: 'Test brigade', men: 1000, x: 0, z: 0, facing: 0, weapon: 'rifled', xp: 1 };
const unit = (extra = {}) => new Unit({ ...def, ...extra }, {}, terrain, 72);
const refresh = (units) => Game.prototype.applyFormationSpacing.call({ units });
function ghostWidth(u) {
  const layer = new ArrowLayer(new THREE.Scene(), terrain), g = layer.ghost(0, 0, 0, u.lineHalfFront(), u.side);
  const geometry = g.children[0].geometry; geometry.computeBoundingBox();
  const width = geometry.boundingBox.max.x - geometry.boundingBox.min.x; layer.dropGhost(g); return width;
}
function contact(scale) {
  S.set('look.formationSpacing', scale);
  const a = unit(), b = unit({ id: 'b', side: 'CS', x: 130, z: 8, facing: Math.PI });
  const c = new Combat({ units: [a, b], terrain, fallen: {}, rnd: () => 0.5 });
  c.pickTargets(); const target = a.target?.id; a.order = { type: 'charge' }; c.meleeStep(1, 10);
  return { target, melee: a.melee, loss: 1000 - a.men };
}
function walk(scale) {
  S.set('look.formationSpacing', scale); const u = unit(), entities = new EntityManager(); entities.add(u.vehicle);
  u.orderMove([[0, 0], [0, 400]], { endFacing: 0 }); let column = false, redeployed = false;
  for (let i = 0; i < 2400; i++) {
    entities.update(0.05); u.move(0.05, -2960);
    column ||= u.formation === 'column'; redeployed ||= column && u.formation === 'line';
  }
  return { u, column, redeployed };
}
const api = { unit, refresh, ghostWidth, contact, walk, offset: Game.prototype.groupOffset, set: S.set,
  updateGhost: (layer, u) => layer.updateGhost(u, true) };
const tests = [
  ['default-line-screen-column-geometry', (a) => {
    const u = a.unit(); assert.equal(u.figures.length, 100); assert.equal(u.files, 47);
    near(u.halfFront, 54.05); near(u.depth, 24.2);
    const screen = u.figures.filter((f) => f.skirmisher).sort((x, y) => x.lx - y.lx);
    assert.equal(screen.length, 7); screen.forEach((f, k) => { near(f.lx, (k - 3) * 7.5); near(f.lz, 36 + k % 2 * 4); });
    u.setFormation('column'); near(u.halfFront, 10.8); near(u.depth, 72.5);
    near(u.columnSlots[0][1], -1.45); near(u.columnSlots[1][1], -4.35); near(u.lineHalfFront(), 54.05);
  }, { ...api, unit: (o) => { const u = unit(o); u.halfFront += 1; return u; } }],
  ['live-line-and-skirmisher-offsets', (a) => {
    const u = a.unit(), original = u.figures.map((f) => ({ f, lx: f.lx, lz: f.lz }));
    for (const scale of [0.75, 1.5, 1]) {
      S.set('look.formationSpacing', scale); a.refresh([u]); near(u.halfFront, 54.05 * scale); near(u.depth, 24.2 * scale);
      for (const p of original) { near(p.f.lx, p.lx * scale); near(p.f.lz, p.lz * scale); }
    }
  }, { ...api, refresh: () => 0 }],
  ['column-trail-and-lateral-offsets', (a) => {
    const u = a.unit(); u.setFormation('column'); const f = u.figures.find((p) => p.crank === 0 && p.cfile === -1.5);
    for (const scale of [0.75, 1.5]) {
      S.set('look.formationSpacing', scale); a.refresh([u]); near(u.halfFront, 4.8 * scale + 6); near(u.depth, 72.5 * scale);
      near(u.columnSlots[0][1], -1.45 * scale); near(u.columnSlots[1][1] - u.columnSlots[0][1], -2.9 * scale);
      near(u.slotWorld(f)[0] - f.jx * 0.6, -3.6 * scale); near(u.lineHalfFront(), 54.05 * scale);
    }
  }, { ...api, unit: (o) => { const u = unit(o); Object.defineProperty(u, 'spacing', { value: 1 }); return u; } }],
  ['refresh-preserves-identities-fallen-rng-orders', (a) => {
    const u = a.unit(), control = unit(); u.takeLosses(20, null, 10); control.takeLosses(20, null, 10);
    u.orderMove([[0, 0], [0, 400]], { endFacing: 0.2 });
    const refs = [...u.figures], fallen = u.figures.filter((f) => !f.alive).map((f) => ({ f, x: f.x, z: f.z, yaw: f.yaw }));
    const invariant = () => JSON.stringify([u.x, u.z, u.men, u.menMax, u.morale, u.fatigue, u.ammo, u.xp, u.weapon, u.order, u.path, u.facing, u.goalFacing]);
    const before = invariant(); S.set('look.formationSpacing', 1.5); assert.equal(a.refresh([u]), 1);
    assert.equal(invariant(), before); assert.equal(u.figures.length, refs.length); refs.forEach((f, i) => assert.equal(u.figures[i], f));
    fallen.forEach((p) => assert.deepEqual([p.f.x, p.f.z, p.f.yaw], [p.x, p.z, p.yaw])); near(u.rnd(), control.rnd());
    assert.ok(u.figures.filter((f) => f.alive).every((f) => { const p = u.slotWorld(f); return f.x === p[0] && f.z === p[1]; }));
  }, { ...api, refresh: (units) => { const n = refresh(units); for (const u of units) u.figures = u.figures.map((f) => ({ ...f })); return n; } }],
  ['selection-boundary-follows-footprint', (a) => {
    const u = a.unit(); assert.equal(u.contains(70, 0), false); S.set('look.formationSpacing', 1.5); a.refresh([u]);
    assert.equal(u.contains(70, 0), true); assert.equal(u.contains(u.halfFront + 10.01, 0), false);
    u.setFormation('column'); assert.equal(u.contains(0, -100), true); S.set('look.formationSpacing', 0.75); a.refresh([u]); assert.equal(u.contains(0, -100), false);
  }, { ...api, unit: (o) => { const u = unit(o); u.contains = () => false; return u; } }],
  ['actual-line-and-column-destination-ghost', (a) => {
    for (const scale of [0.75, 1, 1.5]) {
      S.set('look.formationSpacing', scale); const u = a.unit(); near(a.ghostWidth(u), 108.1 * scale, 1e-4);
      u.setFormation('column'); near(a.ghostWidth(u), 108.1 * scale, 1e-4);
    }
  }, { ...api, ghostWidth: () => 108.1 }],
  ['batteries-and-crews-stay-exact', (a) => {
    let next = 0; const b = new Battery({ ...def, type: 'artillery', men: 120, guns: 6 }, {}, { alloc: () => ({ gun: next++, limber: next++ }) }, terrain, 72);
    const snapshot = () => JSON.stringify([b.halfFront, b.depth, b.gunSlots, b.figures.map((f) => b.slotWorld(f))]); const before = snapshot();
    for (const scale of [0.75, 1.5]) { S.set('look.formationSpacing', scale); assert.equal(a.refresh([b]), 0); assert.equal(snapshot(), before); }
  }, { ...api, refresh: (units) => { const n = refresh(units); for (const u of units) u.halfFront *= 1.5; return n; } }],
  ['live-cached-ghost-invalidates-within-rounded-width', (a) => {
    S.set('look.formationSpacing', 0.8); const u = a.unit({ men: 150 }); u.orderMove([[0, 0], [0, 100]], { endFacing: 0 });
    const layer = new ArrowLayer(new THREE.Scene(), terrain); layer.updateGhost(u, true);
    const read = () => { const geometry = layer.ghosts.get(u.id).g.children[0].geometry; geometry.computeBoundingBox(); return geometry.boundingBox.max.x - geometry.boundingBox.min.x; };
    const rounded = Math.round(u.lineHalfFront()); near(read(), 13.16, 1e-4);
    S.set('look.formationSpacing', 0.85); a.refresh([u]); assert.equal(Math.round(u.lineHalfFront()), rounded, 'fixture must keep the old rounded cache key');
    a.updateGhost(layer, u); near(read(), 13.9825, 1e-4); layer.dropGhost(layer.ghosts.get(u.id).g);
  }, { ...api, updateGhost: () => {} }],
  ['fire-and-melee-read-changed-geometry', (a) => {
    for (const scale of [0.75, 1]) { const c = a.contact(scale); assert.equal(c.target, undefined); assert.equal(c.melee, false); assert.equal(c.loss, 0); }
    const c = a.contact(1.5); assert.equal(c.target, 'b'); assert.equal(c.melee, true); assert.ok(c.loss > 0);
  }, { ...api, contact: () => contact(1) }],
  ['group-order-preserves-rotated-centres', (a) => {
    S.set('look.formationSpacing', 1.5); const leader = a.unit(), other = a.unit({ id: 'b', x: 100 });
    const g = Object.assign(Object.create(Game.prototype), { units: [leader, other], selection: [leader, other], selected: leader, playerSide: 'US', emit() {}, groupOffset: a.offset });
    assert.equal(g.orderGroup(leader, { type: 'move', points: [[0, 0], [500, 700]], endFacing: Math.PI / 2 }), true);
    near(leader.order.dest[0], 500); near(leader.order.dest[1], 700); near(other.order.dest[0], 500); near(other.order.dest[1], 600);
    near(other.order.endFacing, Math.PI / 2); near(other.lineHalfFront(), 81.075);
  }, { ...api, offset: (l, u) => [u.x - l.x, u.z - l.z] }],
  ['actual-march-column-then-redeploy', (a) => {
    for (const scale of [0.75, 1.5]) {
      const { u, column, redeployed } = a.walk(scale); assert.ok(column && redeployed); assert.equal(u.formation, 'line');
      assert.equal(u.order.type, 'hold'); assert.ok(Math.hypot(u.x, u.z - 400) < 3); near(u.halfFront, 54.05 * scale);
    }
  }, { ...api, walk: (s) => ({ ...walk(s), column: false }) }],
  ['new-units-and-density-use-stored-spacing', (a) => {
    S.set('look.formationSpacing', 1.5); const u = a.unit(); near(u.halfFront, 81.075); assert.equal(u.figures.length, 100);
    setMenPerFigure(5); const dense = a.unit(); assert.equal(dense.figures.length, 200); near(dense.halfFront, 108.1 * 1.5);
  }, { ...api, unit: (o) => { const u = unit(o); u.halfFront = 54.05; return u; } }],
  ['registry-clamp-snap-lock-reset-transfer', (a) => {
    a.set('look.formationSpacing', 99); assert.equal(S.get('look.formationSpacing'), 1.5); a.set('look.formationSpacing', -99); assert.equal(S.get('look.formationSpacing'), 0.75);
    a.set('look.formationSpacing', 1.28); assert.equal(S.get('look.formationSpacing'), 1.3); S.lock('look.formationSpacing'); a.set('look.formationSpacing', 1.5); S.reset('look.formationSpacing');
    assert.equal(S.get('look.formationSpacing'), 1.3); const text = S.exportText(); S.unlock('look.formationSpacing'); S.reset('look.formationSpacing'); S.importText(text);
    assert.equal(S.get('look.formationSpacing'), 1.3); assert.equal(S.isLocked('look.formationSpacing'), true);
  }, { ...api, set: () => {} }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  S.unlock('look.formationSpacing'); S.reset('look.formationSpacing'); setMenPerFigure(10);
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`SPACING ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

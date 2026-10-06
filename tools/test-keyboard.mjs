// Actual Input, Game, Unit and ArrowLayer; DOM adapters only, no browser or source mutation.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/ui/input.js';
import { Game } from '../src/game.js';
import { Unit } from '../src/units/unit.js';
import { Combat } from '../src/sim/combat.js';
import { ArrowLayer } from '../src/ui/arrows.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `expected ${b}, got ${a}`);
const target = (kind = 'field') => ({ kind, closest: (selector) => selector.includes(kind) && kind !== 'field' ? {} : null });
function fixture(change = () => {}) {
  const dom = { inert: false, dialog: false };
  globalThis.document = { querySelector: (s) => s === 'main' ? { inert: dom.inert } : dom.dialog ? {} : null };
  const terrain = { half: 3000, heightAt: () => 0, slopeAt: () => 0, inBounds: (x, z) => Math.abs(x) <= 3000 && Math.abs(z) <= 3000 };
  const unit = (id, side, x, z) => new Unit({ id, side, type: 'infantry', name: id, short: id, men: 1000, weapon: 'rifled', xp: 1, x, z, facing: 0 }, {}, terrain, 72);
  const leader = unit('a', 'US', 0, 0), other = unit('b', 'US', 100, 0), enemy = unit('c', 'CS', 0, 600), second = unit('d', 'CS', 500, 700);
  const units = [leader, other, second, enemy], game = Object.assign(Object.create(Game.prototype), {
    units, terrain, selected: leader, selection: [leader], playerSide: 'US', paused: true, scenario: {}, orders: 0,
    emit() {}, coverAt: () => ({ value: 1, kind: 'open' }) });
  game.combat = new Combat({ units, terrain, fallen: {}, rnd: () => 0.5 });
  const arrows = new ArrowLayer(new THREE.Scene(), terrain), messages = [], hud = {
    setGhostLabel(v) { this.label = v; }, setTargeting(v) { this.targeting = v; }, toast(v) { messages.push(v); },
    openMenu(trigger) { this.trigger = trigger; input.rts.keys.clear(); input.cancel(); dom.dialog = true; },
  };
  const rts = { yaw: 0, keys: new Set(['arrowup']), inertia: { vx: 1 }, onKey(e, down) { if (down) this.keys.add(e.key.toLowerCase()); } };
  const canvas = { focused: false, focus() { this.focused = true; } };
  const input = Object.assign(Object.create(Input.prototype), { game, arrows, hud, rts, canvas, targeting: null, drag: null,
    pointers: new Map(), box: { hidden: true }, longPress: 0, onQualityKey() {} });
  const f = { input, game, arrows, hud, rts, leader, other, enemy, second, dom, messages, canvas };
  change(f); return f;
}
const api = { make: () => fixture() };
const mutant = (change) => ({ make: () => fixture(change) });
function press(f, key, extra = {}) {
  const e = { key, target: target(), shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
  f.input.key(e); return e;
}
const tests = [
  ['begin-and-cancel-never-order', (a) => {
    const f = a.make(); press(f, 'b'); assert.equal(f.game.orders, 0); assert.equal(f.canvas.focused, true);
    assert.equal(f.rts.keys.size, 0); assert.equal(f.rts.inertia, null); assert.ok(f.hud.targeting.includes('25'));
    press(f, 'ArrowUp'); press(f, 'Escape'); assert.equal(f.input.targeting, null); assert.equal(f.game.selected, f.leader); assert.equal(f.game.orders, 0);
  }, mutant((f) => { const begin = f.input.beginTargeting; f.input.beginTargeting = function (...args) { begin.apply(this, args); this.game.orders++; }; })],
  ['rotated-camera-normal-and-fine-destination', (a) => {
    const f = a.make(); f.rts.yaw = Math.PI / 2; press(f, 'b'); press(f, 'ArrowUp'); press(f, 'ArrowRight', { shiftKey: true });
    near(f.input.targeting.point.x, -25); near(f.input.targeting.point.z, -5); assert.equal(f.rts.keys.size, 0);
    near(f.arrows.previewEnd.x, -25); near(f.arrows.previewEnd.z, -5);
  }, mutant((f) => { const key = f.input.targetingKey; f.input.targetingKey = function (e, k) { this.rts.yaw = 0; return key.call(this, e, k); }; })],
  ['accessible-destination-updates-only-on-adjustment', (a) => {
    const f = a.make(); press(f, 'b'); const start = f.hud.targeting; press(f, 'ArrowUp');
    assert.notEqual(f.hud.targeting, start); assert.ok(f.hud.targeting.includes('25 m north')); assert.ok(f.hud.targeting.includes('facing'));
    const announced = f.hud.targeting; f.leader.vehicle.position.x += 2; f.input.refreshTargeting(); assert.equal(f.hud.targeting, announced);
  }, mutant((f) => { const refresh = f.input.refreshTargeting; f.input.refreshTargeting = function () { return refresh.call(this, false); }; })],
  ['fine-facing-announces-every-five-degree-step', (a) => {
    const f = a.make(); f.game.units = [f.leader]; press(f, 'b'); const start = f.hud.targeting;
    press(f, 'e', { shiftKey: true }); const first = f.hud.targeting; press(f, 'e', { shiftKey: true });
    assert.notEqual(first, start); assert.notEqual(f.hud.targeting, first); assert.ok(first.includes('175°')); assert.ok(f.hud.targeting.includes('170°'));
  }, mutant((f) => { const set = f.hud.setTargeting; f.hud.setTargeting = function (v) { set.call(this, v?.replace(/\d+°/g, '')); }; })],
  ['manual-facing-and-group-preview-match-committed-order', (a) => {
    const f = a.make(); f.game.selection = [f.leader, f.other]; press(f, 'b'); press(f, 'ArrowUp'); press(f, 'e'); press(f, 'e', { shiftKey: true });
    const end = { ...f.arrows.previewEnd }, face = 20 * Math.PI / 180, dx = 100 * Math.cos(face), dz = -100 * Math.sin(face);
    near(end.facing, face); assert.equal(f.arrows.previewGhost.children.filter((v) => v.material === f.arrows.ghostMats.US).length, 2);
    press(f, 'Enter'); assert.equal(f.game.orders, 2); assert.equal(f.game.paused, true);
    for (const [u, x, z] of [[f.leader, end.x, end.z], [f.other, end.x + dx, end.z + dz]]) {
      assert.equal(u.order.type, 'move'); near(u.order.dest[0], x); near(u.order.dest[1], z); near(u.order.endFacing, face);
    }
  }, mutant((f) => { f.game.groupOffset = (l, u) => [u.x - l.x, u.z - l.z]; })],
  ['no-enemy-uses-one-finite-preview-and-commit-facing', (a) => {
    const f = a.make(); f.game.units = [f.leader]; f.leader.facing = 0.7; press(f, 'b'); press(f, 'ArrowUp');
    const face = f.arrows.previewEnd.facing; press(f, 'Enter'); near(face, 0.7); near(f.leader.order.endFacing, face);
  }, mutant((f) => { f.game.ghostFacing = () => undefined; })],
  ['short-destination-cannot-order-and-label-clears', (a) => {
    const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); assert.ok(f.hud.label); press(f, 'ArrowDown');
    assert.equal(f.arrows.preview, null); assert.equal(f.hud.label, null); press(f, 'Enter'); assert.equal(f.game.orders, 0); assert.ok(f.input.targeting);
    press(f, 'ArrowUp', { shiftKey: true }); press(f, 'Enter'); assert.equal(f.game.orders, 0); assert.ok(f.messages.some((s) => s.includes('22')));
  }, mutant((f) => { const set = f.hud.setGhostLabel; f.hud.setGhostLabel = function (v) { if (v) set.call(this, v); }; })],
  ['terrain-bounds-destination', (a) => {
    const f = a.make(); f.leader.vehicle.position.x = 2999; press(f, 'b'); press(f, 'ArrowRight'); near(f.input.targeting.point.x, 3000);
  }, mutant((f) => { f.game.terrain.half = Infinity; })],
  ['deterministic-target-cycling-and-reverse', (a) => {
    const f = a.make(); press(f, 't'); assert.equal(f.input.targeting.enemy, f.enemy);
    press(f, 't'); assert.equal(f.input.targeting.enemy, f.second); press(f, 't', { shiftKey: true }); assert.equal(f.input.targeting.enemy, f.enemy);
    press(f, 'Escape'); press(f, 't', { shiftKey: true }); assert.equal(f.input.targeting.enemy, f.second); assert.equal(f.game.orders, 0);
  }, mutant((f) => { f.input.eligibleTargets = (u) => f.game.units.filter((v) => v.side !== u.side); })],
  ['ranged-attack-preview-and-actual-effective-halt', (a) => {
    const f = a.make(); press(f, 't'); const halt = f.game.attackHalt(f.leader, f.enemy);
    near(f.arrows.previewEnd.x, halt.x); near(f.arrows.previewEnd.z, halt.z); near(f.arrows.previewEnd.facing, halt.facing);
    press(f, 'Enter'); assert.equal(f.leader.order.type, 'attack'); assert.equal(f.leader.order.target, f.enemy);
    near(f.leader.order.goal[0], halt.x); near(f.leader.order.goal[1], halt.z); assert.equal(f.game.orders, 1);
  }, mutant((f) => { const order = f.game.orderGroup; f.game.orderGroup = function (u, spec) { return order.call(this, u, { type: 'move', points: [[u.x, u.z], [spec.target.x, spec.target.z]] }); }; })],
  ['attack-faces-target-and-does-not-rotate-camera', (a) => {
    const f = a.make(); press(f, 't'); const end = { ...f.arrows.previewEnd }; press(f, 'q'); press(f, 'ArrowUp');
    near(f.arrows.previewEnd.facing, end.facing); near(f.arrows.previewEnd.z, end.z); assert.equal(f.rts.keys.size, 0); assert.equal(f.game.orders, 0);
    assert.ok(f.messages.some((s) => s.includes('face their target')));
  }, mutant((f) => { const key = f.input.targetingKey; f.input.targetingKey = function (e, k) { if (k === 'q') return false; return key.call(this, e, k); }; })],
  ['march-stays-march-over-an-enemy', (a) => {
    const f = a.make(); press(f, 'b'); f.input.targeting.point = { x: f.enemy.x, z: f.enemy.z }; f.input.refreshTargeting(); press(f, 'Enter');
    assert.equal(f.leader.order.type, 'move'); assert.equal(f.leader.order.target, undefined);
    near(f.leader.order.dest[0], f.enemy.x); near(f.leader.order.dest[1], f.enemy.z);
  }, mutant((f) => { const preview = f.input.orderPreviewAt; f.input.orderPreviewAt = function (d, p, s) { return preview.call(this, d, p, s, this.unitAt(p)); }; })],
  ['routing-dead-and-no-enemy-refused', (a) => {
    const f = a.make(); f.enemy.state = 'routing'; f.second.men = 0; press(f, 't'); assert.equal(f.input.targeting, null); assert.equal(f.game.orders, 0);
    f.leader.state = 'routing'; press(f, 'b'); assert.equal(f.input.targeting, null); assert.ok(f.messages.length >= 2);
  }, mutant((f) => { f.input.eligibleTargets = (u) => f.game.units.filter((v) => v.side !== u.side); })],
  ['moving-target-refresh-before-commit', (a) => {
    const f = a.make(); press(f, 't'); f.enemy.vehicle.position.x += 80; f.enemy.vehicle.position.z += 90; const halt = f.game.attackHalt(f.leader, f.enemy);
    f.input.refreshTargeting(); near(f.arrows.previewEnd.x, halt.x); near(f.arrows.previewEnd.z, halt.z); press(f, 'Enter');
    near(f.leader.order.goal[0], halt.x); near(f.leader.order.goal[1], halt.z);
  }, mutant((f) => { const refresh = f.input.refreshTargeting; f.input.refreshTargeting = function () { return this.targeting?.preview ? true : refresh.call(this); }; })],
  ['stale-target-escape-keeps-selection-and-orders-zero', (a) => {
    const f = a.make(); press(f, 't'); f.enemy.state = 'routing'; const e = press(f, 'Escape');
    assert.equal(f.input.targeting, null); assert.equal(f.game.selected, f.leader); assert.equal(f.game.orders, 0); assert.equal(e.prevented, true);
  }, mutant((f) => { const key = f.input.key; f.input.key = function (e) { key.call(this, e); if (e.key === 'Escape') this.game.select(null); }; })],
  ['selection-leader-and-removal-invalidate', (a) => {
    for (const change of [(f) => { f.game.selection.push(f.other); }, (f) => { f.game.selected = f.other; }, (f) => { f.game.units.splice(f.game.units.indexOf(f.leader), 1); }]) {
      const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); change(f); press(f, 'Enter'); assert.equal(f.game.orders, 0); assert.equal(f.input.targeting, null);
    }
  }, mutant((f) => { f.input.refreshTargeting = () => true; })],
  ['paused-stable-preview-reuses-geometry', (a) => {
    const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); const ghost = f.arrows.previewGhost, bar = ghost.children[1];
    for (let i = 0; i < 20; i++) f.input.refreshTargeting(); assert.equal(f.arrows.previewGhost, ghost); assert.equal(f.arrows.previewGhost.children[1], bar);
    f.leader.vehicle.position.x += 2; f.input.refreshTargeting(); assert.notEqual(f.arrows.previewGhost, ghost);
  }, mutant((f) => { const refresh = f.input.refreshTargeting; f.input.refreshTargeting = function () { if (this.targeting) this.targeting.previewKey = null; return refresh.call(this); }; })],
  ['zoom-scale-invalidates-cached-pencil-geometry', (a) => {
    const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); const old = f.arrows.preview;
    f.arrows.setScale(2); f.input.refreshTargeting(); assert.notEqual(f.arrows.preview, old); assert.equal(f.game.orders, 0);
  }, mutant((f) => { const refresh = f.input.refreshTargeting; f.input.refreshTargeting = function () { const mpp = this.arrows.mpp; this.arrows.mpp = 1; const out = refresh.call(this); this.arrows.mpp = mpp; return out; }; })],
  ['dialog-inert-and-cancel-clear-targeting', (a) => {
    for (const kind of ['dialog', 'inert', 'cancel']) { const f = a.make(); press(f, 'b'); press(f, 'ArrowUp');
      if (kind === 'cancel') f.input.cancel(); else { f.dom[kind] = true; press(f, 'Enter'); }
      assert.equal(f.input.targeting, null); assert.equal(f.arrows.preview, null); assert.equal(f.game.orders, 0); }
  }, mutant((f) => { f.input.cancelTargeting = () => {}; })],
  ['help-cancels-ghost-and-preserves-trigger', (a) => {
    const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); const e = press(f, '?');
    assert.equal(f.input.targeting, null); assert.equal(f.rts.keys.size, 0); assert.equal(f.hud.trigger, e.target); assert.equal(f.dom.dialog, true); assert.equal(f.game.orders, 0);
  }, mutant((f) => { f.hud.openMenu = () => {}; })],
  ['forms-sandbox-and-native-activation-isolated', (a) => {
    const f = a.make(); for (const kind of ['input', 'textarea', 'select', 'contenteditable', '#sb-panel']) {
      const e = press(f, 'b', { target: target(kind) }); assert.equal(f.input.targeting, null); assert.equal(e.prevented, false);
    }
    press(f, 'b'); press(f, 'ArrowUp'); const e = press(f, 'Enter', { target: target('button') }); assert.equal(e.prevented, false); assert.equal(f.game.orders, 0);
  }, mutant((f) => { const key = f.input.key; f.input.key = function (e) { e.target = target(); key.call(this, e); }; })],
  ['repeated-begin-or-confirm-cannot-duplicate-orders', (a) => {
    const f = a.make(); press(f, 'b'); press(f, 'ArrowUp'); press(f, 'Enter', { repeat: true }); assert.equal(f.game.orders, 0);
    press(f, 'Enter'); press(f, 'Enter', { repeat: true }); assert.equal(f.game.orders, 1);
  }, mutant((f) => { const key = f.input.key; f.input.key = function (e) { e.repeat = false; key.call(this, e); }; })],
];
let failed = 0;
for (const [name, check, broken] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(broken); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
delete globalThis.document;
console.log(`KEYBOARD ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

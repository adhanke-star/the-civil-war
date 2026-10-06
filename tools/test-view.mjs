// Actual camera and marker-cache seams; browser gates separately exercise real CSS/hit geometry.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RtsCamera, pitchForDist } from '../src/render/rts-camera.js';
import { Hud, markerPosition } from '../src/ui/hud.js';
import * as S from '../src/settings.js';

const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const rad = (degrees) => degrees * Math.PI / 180;
const clamp = (p) => Math.min(1.35, Math.max(0.3, p));
function camera({ terrain = { half: 3000, heightAt: () => 0, inBounds: () => true }, ...opts } = {}) {
  const cam = new THREE.PerspectiveCamera(32, 1280 / 720, 2, 6000);
  return new RtsCamera(cam, terrain, { target: [10, -30], yaw: -1.7, dist: 1150, ...opts });
}
function settle(r) { for (let i = 0; i < 70; i++) { r.update(0.1); r.camera.updateMatrixWorld(true); } }
const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
const api = { camera, marker: Hud.prototype.applyMarkerScale, position: markerPosition };
const tests = [
  ['default-angle-and-pose', (a) => {
    for (const dist of [150, 1150, 2000]) {
      const r = a.camera({ dist }); near(r.pitch, pitchForDist(dist)); near(r.goal.pitch, pitchForDist(dist));
      assert.deepEqual(r.target.toArray(), [10, 0, -30]); assert.equal(r.dist, dist); assert.equal(r.tilt, 0);
    }
  }, { ...api, camera: (o) => { const r = camera(o); r.pitch += 0.1; return r; } }],
  ['stored-initial-angle', (a) => {
    for (const elevation of [-15, 15, 30]) {
      S.set('look.cameraElevation', elevation); const r = a.camera();
      near(r.pitch, clamp(pitchForDist(1150) + rad(elevation))); near(r.goal.pitch, r.pitch);
    }
  }, { ...api, camera: (o) => { const r = camera(o); r.pitch = pitchForDist(r.dist); return r; } }],
  ['live-angle-keeps-centre-distance-yaw', (a) => {
    const r = a.camera(), before = { ...r.goal }, target = r.target.toArray(); S.set('look.cameraElevation', 15);
    near(r.goal.pitch, pitchForDist(1150) + rad(15)); near(r.pitch, pitchForDist(1150));
    for (const key of ['x', 'z', 'yaw', 'dist']) assert.equal(r.goal[key], before[key]); assert.deepEqual(r.target.toArray(), target);
    S.reset('look.cameraElevation'); near(r.goal.pitch, pitchForDist(1150));
  }, { ...api, camera: (o) => { const r = camera(o); S.on('look.cameraElevation', () => { r.goal.dist = 900; }); return r; } }],
  ['zoom-and-manual-tilt-compose', (a) => {
    const r = a.camera(); S.set('look.cameraElevation', 10); r.zoomBy(0.5); r.rotateBy(0.2, 0.1);
    near(r.goal.pitch, clamp(pitchForDist(575) + 0.1 + rad(10))); near(r.goal.yaw, -1.5);
    S.reset('look.cameraElevation'); near(r.goal.pitch, pitchForDist(575) + 0.1);
  }, { ...api, camera: (o) => { const r = camera(o); r._pitch = (d) => pitchForDist(d) + r.tilt; return r; } }],
  ['pitch-distance-clamps-and-planes', (a) => {
    const r = a.camera(); S.set('look.cameraElevation', 30); r.rotateBy(0, 9); r.zoomBy(999);
    assert.equal(r.tilt, 0.6); assert.equal(r.goal.dist, 2000); assert.equal(r.goal.pitch, 1.35);
    S.set('look.cameraElevation', -15); r.rotateBy(0, -9); r.zoomBy(0.0001);
    assert.equal(r.tilt, -0.25); assert.equal(r.goal.dist, 100); assert.equal(r.goal.pitch, 0.3);
    settle(r); assert.ok(r.camera.position.y >= 25); near(r.camera.near, 2); near(r.camera.far, 2400);
  }, { ...api, camera: (o) => { const r = camera(o); r._pitch = () => 0; return r; } }],
  ['ridge-forces-camera-height-correction', (a) => {
    const terrain = { half: 3000, inBounds: () => true, heightAt: (x, z) => Math.hypot(x - 10, z + 30) < 1 ? 0 : 300 };
    const r = a.camera({ terrain, dist: 100, pitch: 0.3 }); settle(r);
    const uncorrected = r.target.y + Math.sin(r.pitch) * r.dist;
    assert.ok(uncorrected < 30, 'fixture must actually require ridge clearance');
    assert.equal(terrain.heightAt(r.camera.position.x, r.camera.position.z), 300);
    assert.equal(r.camera.position.y, 325);
  }, { ...api, camera: (o) => { const r = camera(o), update = r.update; r.update = (dt) => { update.call(r, dt); r.camera.position.y = r.target.y + Math.sin(r.pitch) * r.dist; }; return r; } }],
  ['easing-rate-unchanged', (a) => {
    const r = a.camera(), old = r.pitch; S.set('look.cameraElevation', 15); r.update(0.1);
    near(r.pitch, old + (rad(15)) * (1 - Math.exp(-0.9))); assert.equal(r.dist, 1150);
  }, { ...api, camera: (o) => { const r = camera(o), update = r.update; r.update = (dt) => update.call(r, dt * 2); return r; } }],
  ['anchor-under-changed-angle', (a) => {
    for (const elevation of [-15, 15, 30]) {
      S.set('look.cameraElevation', elevation); const r = a.camera(); settle(r);
      const p = r.pick(550, 350, dom); assert.ok(p); r.zoomAt(0.8, 550, 350, dom); settle(r);
      const after = r.pick(550, 350, dom); assert.ok(after); assert.ok(Math.hypot(after.x - p.x, after.z - p.z) < 0.2);
    }
  }, { ...api, camera: (o) => { const r = camera(o); r.anchor = () => {}; return r; } }],
  ['fly-to-and-minimap-footprint', (a) => {
    const r = a.camera(); settle(r); const before = r.footprint().map((p) => [...p]); S.set('look.cameraElevation', 15); settle(r);
    const after = r.footprint(); assert.equal(after.length, 4); assert.ok(after.flat().every(Number.isFinite)); assert.notDeepEqual(after, before);
    r.inertia = { vx: 100, vz: 100 }; r.flyTo(40, 60); assert.equal(r.inertia, null); assert.equal(r.goal.dist, 650);
    assert.equal(r.goal.x, 40); assert.equal(r.goal.z, 60); near(r.goal.pitch, pitchForDist(650) + rad(15));
  }, { ...api, camera: (o) => { const r = camera(o); r.footprint = () => [[0, 0], [0, 0], [0, 0], [0, 0]]; return r; } }],
  ['marker-size-invalidates-all-caches', (a) => {
    const props = {}; globalThis.document = { getElementById: (id) => { assert.equal(id, 'markers'); return { style: { setProperty: (k, v) => { props[k] = v; } } }; } };
    const hud = { markers: new Map([['a', { w: 70, h: 60 }], ['b', { w: 60, h: 55 }]]), sizeTimer: 1 };
    a.marker.call(hud, 1.5); assert.equal(props['--marker-scale'], '1.5'); assert.equal(hud.sizeTimer, 0);
    assert.ok([...hud.markers.values()].every((m) => m.w === 0 && m.h === 0));
  }, { ...api, marker(v) { globalThis.document.getElementById('markers').style.setProperty('--marker-scale', String(v)); } }],
  ['marker-edge-and-collision-placement', (a) => {
    const bounds = { left: 4, right: 1276, top: 64, bottom: 716 }, placed = [];
    for (const [x, y] of [[800, 110], [815, 80], [830, 75], [710, 20], [15, 120], [1270, 690]]) {
      const s = { x, y, w: 90, h: 85 }, p = a.position(s, placed, bounds);
      assert.ok(p.x - 45 >= bounds.left && p.x + 45 <= bounds.right && p.y - 85 >= bounds.top && p.y <= bounds.bottom);
      assert.ok(placed.every((b) => Math.abs(b.x - p.x) >= 92 || p.y <= b.y - b.h - 2 || p.y - 85 >= b.y + 2));
      placed.push({ ...p, w: 90, h: 85 });
    }
  }, { ...api, position: (s) => ({ x: s.x, y: s.y }) }],
  ['marker-dense-cluster-finds-diagonal-space', (a) => {
    const bounds = { left: 4, right: 1276, top: 64, bottom: 716 }, placed = [];
    for (let i = 0; i < 25; i++) {
      const p = a.position({ x: 800, y: 20, w: 90, h: 85 }, placed, bounds);
      assert.ok(p.x >= 49 && p.x <= 1231 && p.y >= 149 && p.y <= 716);
      assert.ok(placed.every((b) => Math.abs(b.x - p.x) >= 92 || p.y <= b.y - 87 || p.y - 85 >= b.y + 2));
      placed.push({ ...p, w: 90, h: 85 });
    }
  }, { ...api, position: (s) => ({ x: s.x, y: 149 }) }],
  ['marker-avoids-visible-dock-and-hints', (a) => {
    const bounds = { left: 4, right: 1276, top: 64, bottom: 716 };
    const obstacles = [{ x: 730, y: 712, w: 280, h: 120 }, { x: 254, y: 550, w: 490, h: 72 }];
    for (const [x, y] of [[829, 635], [480, 490]]) {
      const p = a.position({ x, y, w: 90, h: 85 }, [], bounds, obstacles);
      assert.ok(p.y - 85 >= bounds.top && p.y <= bounds.bottom);
      assert.ok(obstacles.every((b) => Math.abs(b.x - p.x) >= (b.w + 90) / 2 + 2 || p.y <= b.y - b.h - 2 || p.y - 85 >= b.y + 2));
    }
  }, { ...api, position: (s, p, b) => markerPosition(s, p, b) }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  S.unlock('look.cameraElevation'); S.reset('look.cameraElevation');
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped intended assertion'); console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`VIEW ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

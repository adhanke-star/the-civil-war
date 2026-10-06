// Actual Post/Effects/settings methods. Canvas drawing is stubbed in Node; particles are real quarks.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Post } from '../src/render/post.js';
import { Effects } from '../src/fx/effects.js';
import { LOOK } from '../src/ui/look.js';
import * as S from '../src/settings.js';

globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => ({ getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
}) }) };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);
function post() {
  const renderer = { changes: 0, setPixelRatio() { this.changes++; }, setSize() { this.changes++; } };
  return new Post(renderer, { mode: 'low' });
}
async function effects() {
  const scene = new THREE.Scene();
  const e = new Effects(scene, { heightAt: () => 12 }, { target: { x: 0, z: 0 }, dist: 100 });
  await e.init(); assert.equal(e.ok, true, 'actual quarks init must succeed'); return e;
}
function advance(e, dt = 0.1) { e.scene.updateMatrixWorld(true); e.update(dt); }
const count = (e) => e.systems.reduce((n, { system }) => n + system.particleNum, 0);
async function queued(fn) {
  const original = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (cb) => { callbacks.push(cb); return callbacks.length; };
  try { await fn(() => { for (const cb of callbacks.splice(0)) cb(); }); }
  finally { globalThis.setTimeout = original; }
}
const api = { post, effects, advance, set: S.set };
const tests = [
  ['defaults-and-fixed-grade', async (a) => {
    const p = a.post(), u = p.finalMat.uniforms;
    near(u.uSaturation.value, 0.86); near(u.uTilt.value, 0.9); near(u.uExposure.value, 0.66);
    near(u.uTiltCenter.value, 0.46); near(u.uTiltBand.value, 0.24); assert.equal(LOOK.smoke, true);
  }, { ...api, post: () => { const p = post(); p.finalMat.uniforms.uExposure.value = 1; return p; } }],
  ['initial-and-live-uniforms-no-resize', async (a) => {
    S.set('look.saturation', 0.35); S.set('look.tiltShift', 0.2);
    const p = a.post(), ids = [p.rtScene, p.rtSmall, p.rtBlur], changes = p.renderer.changes;
    near(p.finalMat.uniforms.uSaturation.value, 0.35); near(p.finalMat.uniforms.uTilt.value, 0.2);
    a.set('look.saturation', 1.2); a.set('look.tiltShift', 0);
    near(p.finalMat.uniforms.uSaturation.value, 1.2); near(p.finalMat.uniforms.uTilt.value, 0);
    assert.deepEqual([p.rtScene, p.rtSmall, p.rtBlur], ids); assert.equal(p.renderer.changes, changes);
    near(p.finalMat.uniforms.uExposure.value, 0.66);
  }, { ...api, set: () => undefined }],
  ['render-target-identities-and-dimensions', async (a) => {
    const p = a.post();
    const targets = () => [p.rtScene, p.rtSmall, p.rtBlur].map((t) => [t.uuid, t.width, t.height]);
    const before = targets(), calls = p.renderer.changes;
    S.set('look.saturation', 0); S.set('look.tiltShift', 0);
    assert.deepEqual(targets(), before); assert.equal(p.renderer.changes, calls);
  }, { ...api, post: () => { const p = post(); S.on('look.saturation', () => p.rtScene.setSize(2, 2)); return p; } }],
  ['range-lock-reset-transfer', async (a) => {
    for (const [key, field, max, def] of [['look.saturation', 'saturation', 1.5, 0.86], ['look.tiltShift', 'tiltShift', 1, 0.9]]) {
      a.set(key, 99); assert.equal(LOOK[field], max); a.set(key, -9); assert.equal(LOOK[field], 0);
      a.set(key, NaN); assert.equal(LOOK[field], 0); S.lock(key); a.set(key, def); S.reset(key); assert.equal(LOOK[field], 0);
      assert.ok(S.exportText().includes(`locked: ${key}`)); S.unlock(key); S.reset(key); assert.equal(LOOK[field], def);
      S.importText(`${key} = ${max}\nlocked: ${key}`); assert.equal(LOOK[field], max); assert.equal(S.isLocked(key), true);
      S.unlock(key); S.reset(key);
    }
  }, { ...api, set: () => undefined }],
  ['actual-pool-muzzle-and-on-particles', async (a) => {
    const e = await a.effects(); assert.equal(e.systems.length, 200); assert.equal(e.systems.filter((s) => s.big).length, 40);
    e.puff(20, 30); a.advance(e); assert.ok(count(e) > 0); assert.equal(e.puffs, 1); assert.equal(e.batch.visible, true);
    assert.deepEqual(e.systems[1].system.emitter.position.toArray(), [20, 15.5, 30]);
    e.puff(40, 50, true); a.advance(e); assert.equal(e.puffs, 2);
    assert.deepEqual(e.systems[5].system.emitter.position.toArray(), [40, 15, 50]);
  }, { ...api, advance: () => undefined }],
  ['off-clears-existing-and-suppresses', async (a) => {
    const e = await a.effects(); e.puff(0, 0); advance(e); assert.ok(count(e) > 0);
    S.set('look.smoke', false); assert.equal(e.batch.visible, false); assert.equal(count(e), 0);
    assert.ok(e.systems.every(({ system }) => system.paused)); const n = e.puffs;
    e.puff(1, 1); advance(e); assert.equal(e.puffs, n); assert.equal(count(e), 0); assert.equal(e.systems.length, 200);
  }, { ...api, effects: async () => { const e = await effects(); for (const s of e.systems) s.system.stop = () => {}; return e; } }],
  ['delayed-disable-reenable-no-resurrection', async (a) => {
    const e = await a.effects(); await queued(async (flush) => {
      e.puff(1, 1, false, 1); e.puff(2, 2, true, 2); S.set('look.smoke', false); S.set('look.smoke', true);
      flush(); advance(e); assert.equal(e.puffs, 0); assert.equal(count(e), 0); assert.equal(e.batch.visible, true);
      e.puff(3, 3); advance(e); assert.equal(e.puffs, 1); assert.ok(count(e) > 0);
    });
  }, { ...api, effects: async () => { const e = await effects(); const set = e.setSmoke; e.setSmoke = function (v) { const n = this.smokeEpoch; set.call(this, v); this.smokeEpoch = n; }; return e; } }],
  ['reduced-motion-clears-queued-and-restores-new', async (a) => {
    const e = await a.effects(); await queued(async (flush) => {
      e.puff(0, 0); advance(e); e.puff(2, 2, false, 1); e.reducedMotion = true;
      assert.equal(e.batch.visible, false); assert.equal(count(e), 0); const n = e.puffs;
      e.puff(1, 1); assert.equal(e.puffs, n); e.reducedMotion = false; flush(); advance(e);
      assert.equal(e.puffs, n); assert.equal(count(e), 0); assert.equal(e.batch.visible, true);
      e.puff(3, 3); advance(e); assert.equal(e.puffs, n + 1); assert.ok(count(e) > 0);
    });
  }, { ...api, effects: async () => { const e = await effects(); Object.defineProperty(e, 'reducedMotion', { value: false, writable: true }); return e; } }],
  ['disabled-before-init-and-preference-motion-conjunction', async (a) => {
    S.set('look.smoke', false); const e = await a.effects(); assert.equal(e.batch.visible, false);
    S.set('look.smoke', true); e.reducedMotion = true; S.set('look.smoke', false); e.reducedMotion = false;
    assert.equal(e.batch.visible, false); e.puff(0, 0); assert.equal(e.puffs, 0);
    S.set('look.smoke', true); assert.equal(e.batch.visible, true); e.puff(0, 0); advance(e); assert.ok(count(e) > 0);
  }, { ...api, effects: async () => { const e = await effects(); e.batch.visible = true; return e; } }],
  ['sound-independent-of-smoke', async (a) => {
    const e = await a.effects(), calls = []; e.playVolley = (u) => calls.push(['volley', u]); e.playBoom = (u) => calls.push(['boom', u]);
    S.set('look.smoke', false); const u = { x: 0, z: 0, facing: 0 };
    e.volley(u, [[0, 0, 0]]); e.boom(u, null, true); e.shellBurst(0, 0);
    assert.equal(e.puffs, 0); assert.deepEqual(calls.map((x) => x[0]), ['volley', 'boom', 'boom']); assert.equal(calls[0][1], u);
  }, { ...api, effects: async () => { const e = await effects(); e.volley = () => {}; return e; } }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  for (const key of ['look.saturation', 'look.tiltShift', 'look.smoke']) { S.unlock(key); S.reset(key); }
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { await check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped the intended assertion'); console.log(`CAUGHT ${name}`);
    } else { await check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`LOOK ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

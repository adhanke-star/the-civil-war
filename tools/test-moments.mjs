// Actual Effects/Unit/HaloPool presentation seams; no browser, progress store or source mutation.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Effects } from '../src/fx/effects.js';
import { Unit } from '../src/units/unit.js';
import { HaloPool } from '../src/units/halos.js';
import { SoldierPool, UNIFORMS } from '../src/units/soldier-mesh.js';
import * as S from '../src/settings.js';

const terrain = { heightAt: () => 0, slopeAt: () => 0, half: 3000, inBounds: () => true };
const def = { id: 'a', name: 'Test brigade', side: 'US', type: 'infantry', men: 1000, x: 0, z: 0, facing: 0, weapon: 'rifled', xp: 1 };
const unit = (extra = {}) => new Unit({ ...def, ...extra }, {}, terrain, 72);
function effects() {
  const e = new Effects(new THREE.Scene(), terrain, { target: { x: 0, z: 0 }, dist: 100 });
  const notices = [], voices = [];
  e.onMoment = (v) => notices.push(v);
  e.sound.zzfx = () => { const voice = { stops: 0, stop() { this.stops++; } }; voices.push(voice); return voice; };
  return { e, notices, voices };
}
const snapshot = (u) => JSON.stringify([u.x, u.z, u.men, u.menMax, u.weapon, u.xp, u.morale, u.fatigue, u.ammo, u.order, u.path, u.facing, u.goalFacing, u.figures.map((f) => [f.x, f.z, f.yaw, f.alive])]);
const api = { effects, trigger: (e, u) => e.xFactor(u, { preview: true, label: 'X-Factor preview' }), advance: (e, dt) => e.updateMoments(dt), setSound: (e, v) => e.setSound(v) };
const tests = [
  ['preview-preserves-actual-unit-and-rng', (a) => {
    const { e, notices, voices } = a.effects(), u = unit(), control = unit(), before = snapshot(u);
    assert.equal(a.trigger(e, u), true); assert.equal(snapshot(u), before); assert.equal(u.rnd(), control.rnd());
    assert.equal(u.momentGlow, true); assert.equal(e.moments.size, 1); assert.equal(voices.length, 1);
    assert.equal(notices.at(-1).preview, true); assert.equal(notices.at(-1).label, 'X-Factor preview');
    assert.equal(notices.at(-1).unit, u); assert.equal(notices.at(-1).style, 'full'); e.clearMoments();
  }, { ...api, trigger: (e, u) => { u.morale += 1; return api.trigger(e, u); } }],
  ['actual-unit-warm-halo-and-off', (a) => {
    const { e } = a.effects(), u = unit(); u.pool = new SoldierPool(200, UNIFORMS.US, { kit: 'US' }); u.halos = new HaloPool(210);
    const geometry = u.halos.mesh.geometry, attribute = u.halos.color, matrix = u.halos.mesh.instanceMatrix;
    a.trigger(e, u); u.pool.begin(); u.halos.begin(); u.animate(0, 0); u.halos.flush();
    assert.ok(u.halos.n >= u.aliveFigures.length); const warm = Array.from(attribute.array.slice(0, 4));
    assert.ok(warm[0] > 0.9 && warm[1] > 0.4 && warm[1] < 0.8 && warm[2] < 0.3 && warm[3] > 2);
    S.set('look.xFactorStyle', 'off'); u.pool.begin(); u.halos.begin(); u.animate(0, 0); u.halos.flush();
    assert.ok(attribute.array[0] < 0.1 && attribute.array[3] < 1); assert.equal(u.halos.mesh.geometry, geometry);
    assert.equal(u.halos.color, attribute); assert.equal(u.halos.mesh.instanceMatrix, matrix); e.clearMoments();
  }, { ...api, trigger: (e, u) => { const ret = api.trigger(e, u); u.momentGlow = false; return ret; } }],
  ['repeat-replaces-voice-and-refreshes-bounded-cue', (a) => {
    const { e, voices } = a.effects(), u = unit();
    for (let i = 0; i < 4; i++) { a.trigger(e, u); a.advance(e, 1); assert.equal(e.moments.size, 1); }
    assert.equal(voices.length, 4); assert.ok(voices.slice(0, -1).every((v) => v.stops === 1));
    assert.equal(voices.at(-1).stops, 0); assert.equal(u.momentGlow, true); a.advance(e, 5);
    assert.equal(e.moments.size, 0); assert.equal(u.momentGlow, false); assert.equal(voices.at(-1).stops, 1);
  }, { ...api, advance: () => {} }],
  ['presentation-expires-while-simulation-paused', (a) => {
    const { e, notices } = a.effects(), u = unit(), before = snapshot(u); a.trigger(e, u);
    e.update(0); a.advance(e, 5); assert.equal(snapshot(u), before); assert.equal(e.moments.size, 0);
    assert.equal(u.momentGlow, false); assert.equal(notices.at(-1), null);
  }, { ...api, advance: () => {} }],
  ['subtle-off-live-reset-lock-transfer', (a) => {
    const { e, notices, voices } = a.effects(), u = unit();
    S.set('look.xFactorStyle', 'subtle'); a.trigger(e, u); assert.equal(u.momentGlow, false); assert.equal(voices.length, 0);
    assert.equal(notices.at(-1).style, 'subtle'); S.set('look.xFactorStyle', 'off');
    assert.equal(e.moments.size, 0); assert.equal(notices.at(-1), null); assert.equal(a.trigger(e, u), false);
    S.lock('look.xFactorStyle'); S.reset('look.xFactorStyle'); assert.equal(S.get('look.xFactorStyle'), 'off');
    const text = S.exportText(); S.unlock('look.xFactorStyle'); S.reset('look.xFactorStyle');
    assert.equal(S.get('look.xFactorStyle'), 'full'); S.importText(text); assert.equal(S.get('look.xFactorStyle'), 'off');
    assert.equal(S.isLocked('look.xFactorStyle'), true); e.clearMoments();
  }, { ...api, trigger: (e, u) => { const ret = api.trigger(e, u); u.momentGlow = true; return ret; } }],
  ['reduced-motion-tones-active-cue-and-cancels-sound', (a) => {
    const { e, notices, voices } = a.effects(), u = unit(); a.trigger(e, u); e.reducedMotion = true;
    assert.equal(u.momentGlow, false); assert.equal(voices[0].stops, 1); assert.equal(notices.at(-1).style, 'subtle');
    a.trigger(e, u); assert.equal(voices.length, 1); assert.equal(u.momentGlow, false);
    S.set('look.xFactorStyle', 'off'); e.reducedMotion = false; S.set('look.xFactorStyle', 'full');
    assert.equal(e.moments.size, 0); assert.equal(u.momentGlow, false); assert.equal(notices.at(-1), null); e.clearMoments();
  }, { ...api, effects: () => { const v = effects(); Object.defineProperty(v.e, 'reducedMotion', { value: false, writable: true }); return v; } }],
  ['battle-mute-stops-and-suppresses-sting', (a) => {
    const { e, voices } = a.effects(), u = unit(); a.trigger(e, u); a.setSound(e, false);
    assert.equal(e.sound.enabled, false); assert.equal(voices[0].stops, 1); a.trigger(e, u); assert.equal(voices.length, 1);
    a.setSound(e, true); a.trigger(e, u); assert.equal(voices.length, 2); e.clearMoments();
  }, { ...api, setSound: (e, v) => { e.sound.enabled = v; } }],
  ['dead-null-removed-and-multiple-expiry', (a) => {
    const { e, notices, voices } = a.effects(), u = unit(), other = unit({ id: 'b', x: 10 });
    assert.equal(a.trigger(e, null), false); const dead = unit({ men: 0 }); assert.equal(a.trigger(e, dead), false);
    a.trigger(e, u); a.advance(e, 1); a.trigger(e, other); a.advance(e, 3.1);
    assert.equal(u.momentGlow, false); assert.equal(other.momentGlow, true); assert.equal(notices.at(-1).unit, other); assert.equal(voices.at(-1).stops, 0);
    other.men = 0; a.advance(e, 0); assert.equal(other.momentGlow, false); assert.equal(e.moments.size, 0); assert.equal(notices.at(-1), null);
  }, { ...api, advance: () => {} }],
  ['delayed-first-unlock-cannot-resurrect-disabled-cue', async (a) => {
    const { e, voices } = a.effects(), u = unit(), zzfx = e.sound.zzfx; let finish;
    const ready = new Promise((resolve) => { finish = resolve; }); e.sound.zzfx = null; e.unlock = () => ready;
    a.trigger(e, u); S.set('look.xFactorStyle', 'off'); S.set('look.xFactorStyle', 'full');
    e.sound.zzfx = zzfx; finish(); await ready; await Promise.resolve();
    assert.equal(voices.length, 0); assert.equal(e.moments.size, 0); assert.equal(u.momentGlow, false);
    a.trigger(e, u); assert.equal(voices.length, 1); e.clearMoments();
  }, { ...api, trigger: (e, u) => { const ret = api.trigger(e, u); if (!e.sound.zzfx) e.unlock().then(() => e.sound.zzfx()); return ret; } }],
  ['eight-cue-bound-evicts-old-unit-and-voice', (a) => {
    const { e, voices } = a.effects(), units = [...Array(10).keys()].map((i) => unit({ id: `bounded-${i}` }));
    for (const u of units) a.trigger(e, u);
    assert.equal(e.moments.size, 8); assert.equal(units[0].momentGlow, false); assert.equal(units[1].momentGlow, false);
    assert.ok(units.slice(2).every((u) => u.momentGlow)); assert.equal(e.activeMoment.unit, units[9]);
    assert.ok(voices.slice(0, -1).every((v) => v.stops === 1)); e.clearMoments(); assert.ok(units.every((u) => !u.momentGlow));
  }, { ...api, trigger: (e, u) => { const ret = api.trigger(e, u); const extra = { alive: true, momentGlow: true };
    e.moments.set(extra, { unit: extra, until: 1e9 }); return ret; } }],
  ['delayed-mute-motion-style-expiry-and-replacement', async (a) => {
    for (const kind of ['mute', 'motion', 'style', 'expiry', 'replacement']) {
      const { e, voices } = a.effects(), u = unit(), other = unit({ id: 'b' }), zzfx = e.sound.zzfx; let finish;
      const ready = new Promise((resolve) => { finish = resolve; }); e.sound.zzfx = null; e.unlock = () => ready;
      a.trigger(e, u);
      if (kind === 'mute') { a.setSound(e, false); a.setSound(e, true); }
      if (kind === 'motion') { e.reducedMotion = true; e.reducedMotion = false; }
      if (kind === 'style') { S.set('look.xFactorStyle', 'subtle'); S.set('look.xFactorStyle', 'full'); }
      if (kind === 'expiry') a.advance(e, 5);
      if (kind === 'replacement') a.trigger(e, other);
      e.sound.zzfx = zzfx; finish(); await ready; await Promise.resolve();
      assert.equal(voices.length, kind === 'replacement' ? 1 : 0, kind); e.clearMoments();
    }
  }, { ...api, trigger: (e, u) => { const ret = api.trigger(e, u); if (!e.sound.zzfx) e.unlock().then(() => e.sound.zzfx()); return ret; } }],
];
let failed = 0;
for (const [name, check, mutant] of tests) {
  S.unlock('look.xFactorStyle'); S.reset('look.xFactorStyle');
  try {
    if (process.argv.includes('--prove-fail')) {
      let caught = false; try { await check(mutant); } catch (e) { if (e instanceof assert.AssertionError) caught = true; else throw e; }
      assert.equal(caught, true, 'mutant escaped the intended assertion'); console.log(`CAUGHT ${name}`);
    } else { await check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`MOMENTS ${failed ? 'FAILED' : 'OK'} (${tests.length - failed}/${tests.length})`); process.exitCode = failed ? 1 : 0;

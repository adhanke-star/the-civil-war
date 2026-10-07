// Independent lens geometry and ownership controls; real GPU depth discrimination is a browser gate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { SoldierView } from '../src/render/soldier-view.js';
import { RtsCamera } from '../src/render/rts-camera.js';
import { Post, DEPTH_DISTANCE, DEPTH_BLEND } from '../src/render/post.js';
import { Readout } from '../src/ui/readout.js';

globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
const hash = s => createHash('sha256').update(s).digest('hex');
// Actual pre-edit Post fragment, captured before P2n. Never derive this expectation from the candidate.
const MAP_FRAGMENT_SHA = 'f477d9947ccc261cdd568fbacdd4cb66a8c6121ab1ea8320807b9649fa3ec8c4';
const near = (a, b, message = 'independent lens value') => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);
const fields = ['position', 'quaternion', 'up', 'scale', 'matrix', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix', 'projectionMatrixInverse'];
const cameraState = c => JSON.stringify([c.fov, c.near, c.far, c.zoom, c.aspect, ...fields.map(k => c[k].toArray())]);
const mapState = r => JSON.stringify([r.goal, r.target.toArray(), r.yaw, r.pitch, r.dist, r.tilt, r.groundY]);
const event = (key, extra = {}) => ({ key, repeat: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });
const makeFigure = (i, rank, lx, other = {}) => ({ i, rank, lx, cfile: lx, x: 20, z: 30, yaw: 0.4, alive: true, gone: false, skirmisher: false, ...other });

function fixture({ scale = 1, yaw = 0.4, height = () => 0 } = {}) {
  const terrain = { half: 3000, heightAt: height, inBounds: () => true };
  const camera = new THREE.PerspectiveCamera(32, 1280 / 720, 2, 6000);
  const rts = new RtsCamera(camera, terrain, { target: [100, 150], yaw: -1.5, dist: 740 });
  rts.update(0.037); camera.updateMatrixWorld(true);
  const passes = [];
  const renderer = { domElement: new EventTarget(), contextLost: false, getContext() { return { isContextLost: () => this.contextLost }; }, setPixelRatio() {}, setSize() {}, setRenderTarget() {}, clear() {},
    render(scene) { passes.push(scene.children[0]?.material); } };
  const post = new Post(renderer, { mode: 'low' }); post.setSize(1280, 720);
  const figures = [makeFigure(0, -1, -50, { skirmisher: true }), makeFigure(3, 0, -3),
    makeFigure(2, 0, 0), makeFigure(1, 1, -8)].map(f => ({ ...f, yaw }));
  const unit = { id: 'generic', type: 'infantry', side: 'US', men: 100, alive: true, state: 'steady',
    x: 100, z: 100, facing: -0.8, formation: 'line', figures, canTakeOrders() { return this.alive && this.state !== 'routing'; } };
  const game = { units: [unit], selected: unit, selection: [unit], playerSide: 'US',
    controls: u => !!u && u.alive && u.side === 'US' };
  const view = new SoldierView({ camera, rts, game, terrain, post, scale: () => scale });
  return { view, unit, game, figures, camera, rts, post, terrain, passes, scale, renderer };
}
function use(a, options, check) {
  const f = a.make(options);
  try { check(f); }
  finally { f.view.end('release'); f.post.endSoldierView(); }
}
function geometry(f) {
  // Figure-slot convention and mesh head centre were independently source-bound before implementation.
  const body = f.view.figure, s = 4.4 * f.scale, c = Math.cos(body.yaw), n = Math.sin(body.yaw);
  const x = body.x - 1.8 * s * c + 0.7 * s * n, z = body.z + 1.8 * s * n + 0.7 * s * c;
  const target = new THREE.Vector3(body.x + 6 * s * c, f.terrain.heightAt(body.x + 6 * s * c, body.z - 6 * s * n) + 1.64 * s, body.z - 6 * s * n);
  near(f.camera.position.x, x); near(f.camera.position.z, z);
  near(f.camera.position.y, f.terrain.heightAt(x, z) + 1.64 * s);
  near(f.view.focus, target.clone().applyMatrix4(f.camera.matrixWorldInverse).z * -1);
  near(target.clone().project(f.camera).x, 0, 'target horizontal projection');
  near(target.clone().project(f.camera).y, 0, 'target vertical projection');
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const api = { make: fixture,
  decode: Function('depth', 'nearPlane', 'farPlane', `return ${DEPTH_DISTANCE}`),
  blend: Function('zDistance', 'focusDistance', 'nearPlane', 'smoothstep', 'abs', 'max', `return ${DEPTH_BLEND}`) };
const alter = change => ({ ...api, make: opts => { const f = fixture(opts); change(f); return f; } });
const beginWrapper = (f, change) => { const begin = f.view.begin; f.view.begin = function(e) { const ok = begin.call(this, e); if (ok) change(f); return ok; }; };
const endWrapper = (f, change) => { const end = f.view.end; f.view.end = function(reason) { const saved = this.snapshot; const ok = end.call(this, reason); if (ok) change(f, saved); return ok; }; };

const tests = [
  ['begin-current-front-figure', a => use(a, {}, f => {
    assert.equal(f.view.begin(), true); assert.equal(f.view.figure, f.figures[1]); f.view.end();
    f.unit.formation = 'column'; f.figures[1].cfile = 1.5; f.figures[2].cfile = -1.5;
    assert.equal(f.view.begin(), true); assert.equal(f.view.figure, f.figures[2]);
  }), alter(f => beginWrapper(f, v => { v.view.figure = v.figures[0]; }))],
  ['scaled-model-head', a => { for (const scale of [0.5, 1, 1.75]) use(a, { scale }, f => {
    assert.equal(f.view.begin(), true); geometry(f); near(f.view.focus, Math.hypot(7.8, 0.7) * 4.4 * scale);
  }); }, alter(f => { f.view.scale = () => 1; })],
  ['yaw-flank-four-headings', a => { for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) use(a, { yaw }, f => {
    assert.equal(f.view.begin(), true); geometry(f); assert.equal(f.camera.fov, 55); assert.equal(f.camera.near, 0.3); assert.equal(f.camera.far, 6000);
  }); }, alter(f => { const pose = f.view.pose; f.view.pose = function() { const old = this.figure.yaw; this.figure.yaw = f.unit.facing; try { return pose.call(this); } finally { this.figure.yaw = old; } }; })],
  ['local-terrain-clearance', a => use(a, { height: (x, z) => x * 0.3 + z * 0.15 }, f => {
    assert.equal(f.view.begin(), true); geometry(f); assert.ok(f.camera.position.y >= f.terrain.heightAt(f.camera.position.x, f.camera.position.z) + 0.4 * 4.4);
  }), alter(f => { f.view.terrain = { heightAt: () => f.terrain.heightAt(f.unit.x, f.unit.z) }; })],
  ['actual-figure-follow', a => use(a, {}, f => {
    assert.equal(f.view.begin(), true); const figure = f.view.figure;
    figure.x += 13; figure.z -= 7; figure.yaw += 0.25; f.unit.order = { type: 'hold' };
    assert.equal(f.view.updatePose(), true); assert.equal(f.view.figure, figure); geometry(f);
  }), alter(f => beginWrapper(f, v => { v.view.pose = () => true; }))],
  ['ordinary-map-suspension', a => use(a, {}, f => {
    const map = mapState(f.rts), update = f.rts.update; let calls = 0;
    f.rts.update = function(dt) { calls++; return update.call(this, dt); };
    assert.equal(f.view.begin(), true); f.view.updateMap(0.042); assert.equal(calls, 0); assert.equal(mapState(f.rts), map);
    f.view.end(); f.view.updateMap(0.019); assert.equal(calls, 1);
  }), alter(f => { f.view.updateMap = dt => f.rts.update(dt); })],
  ['exact-camera-return', a => use(a, {}, f => {
    const before = cameraState(f.camera), map = mapState(f.rts);
    assert.equal(f.view.begin(), true); f.view.updatePose(); f.view.end();
    assert.equal(cameraState(f.camera), before); assert.equal(mapState(f.rts), map); assert.equal(f.post.soldierView, null);
    // Projection refresh uses the actual Readout seam without aging or consuming accumulated losses.
    const tick = { age: 0.6, x: 10, z: 20, y: 5, dx: 3, el: { hidden: false, style: {} } };
    const readout = Object.assign(Object.create(Readout.prototype), { camera: f.camera, ticks: [tick], next: 3, tickT: 0, game: { units: [{ tickAcc: 7 }] } });
    const old = JSON.stringify([tick.age, readout.next, readout.tickT, readout.game.units]);
    readout.projectTicks(); assert.equal(JSON.stringify([tick.age, readout.next, readout.tickT, readout.game.units]), old);
    assert.ok(tick.el.style.transform && tick.el.style.opacity !== undefined); assert.equal(tick.el.hidden, false);
  }), alter(f => endWrapper(f, v => { v.camera.fov = 55; v.camera.updateProjectionMatrix(); }))],
  ['resized-current-aspect', a => use(a, {}, f => {
    const pose = f.camera.position.toArray(), q = f.camera.quaternion.toArray(); assert.equal(f.view.begin(), true);
    f.camera.aspect = 320 / 480; f.camera.updateProjectionMatrix(); f.view.onResize(); f.view.end();
    assert.equal(f.camera.aspect, 320 / 480); assert.equal(f.camera.fov, 32); assert.deepEqual(f.camera.position.toArray(), pose); assert.deepEqual(f.camera.quaternion.toArray(), q);
    const expected = f.camera.clone(); expected.updateProjectionMatrix(); assert.deepEqual(f.camera.projectionMatrix.toArray(), expected.projectionMatrix.toArray());
  }), alter(f => endWrapper(f, (v, saved) => { v.camera.aspect = saved.camera.aspect; v.camera.updateProjectionMatrix(); }))],
  ['repeat-no-allocation', a => use(a, {}, f => {
    assert.equal(f.view.keyDown(event('i')), true); const snapshot = f.view.snapshot, figure = f.view.figure, owner = f.post.soldierView;
    f.view.keyDown(event('i', { repeat: true })); assert.equal(f.view.begin(), false);
    assert.equal(f.view.snapshot, snapshot); assert.equal(f.view.figure, figure); assert.equal(f.post.soldierView, owner);
    f.view.end('pointer'); assert.equal(f.view.keyDown(event('i', { repeat: true })), false); assert.equal(f.view.active, false);
    f.view.keyUp(event('i')); assert.equal(f.view.keyDown(event('i')), true);
    assert.equal(f.view.keyDown(event('Escape')), true); assert.equal(f.view.keyDown(event('Escape', { repeat: true })), true);
    f.view.blur(); assert.equal(f.view.escapeHeld, false); assert.equal(f.view.keyDown(event('Escape')), false);
  }), alter(f => { const begin = f.view.begin; f.view.begin = function(e) { if (this.active) this.end('release'); return begin.call(this, e); }; })],
  ['no-selection-refusal', a => use(a, {}, f => {
    f.game.selected = null; f.game.selection = []; const cam = cameraState(f.camera), map = mapState(f.rts);
    assert.equal(f.view.begin(), false); assert.equal(f.game.selected, null); assert.deepEqual(f.game.selection, []); assert.equal(cameraState(f.camera), cam); assert.equal(mapState(f.rts), map); assert.equal(f.post.soldierView, null);
  }), alter(f => { const begin = f.view.begin; f.view.begin = function(e) { if (!f.game.selected) { f.game.selected = f.unit; f.game.selection = [f.unit]; } return begin.call(this, e); }; })],
  ['unsupported-control-refusal', a => { for (const kind of ['gun', 'enemy', 'uncontrolled']) use(a, {}, f => {
    if (kind === 'gun') f.unit.type = 'artillery'; if (kind === 'enemy') f.unit.side = 'CS'; if (kind === 'uncontrolled') f.game.controls = () => false;
    const cam = cameraState(f.camera); assert.equal(f.view.begin(), false); assert.equal(cameraState(f.camera), cam); assert.equal(f.post.soldierView, null);
  }); }, alter(f => { f.view.eligible = () => true; })],
  ['rout-depleted-refusal', a => { for (const kind of ['routing', 'dead', 'empty']) use(a, {}, f => {
    if (kind === 'routing') f.unit.state = 'routing'; if (kind === 'dead') f.unit.alive = false; if (kind === 'empty') f.unit.men = 0;
    assert.equal(f.view.begin(), false); assert.equal(f.post.soldierView, null);
  }); }, alter(f => { f.view.eligible = () => true; })],
  ['dead-gone-refusal', a => { for (const kind of ['dead', 'gone', 'screen']) use(a, {}, f => {
    for (const body of f.figures) { if (kind === 'dead') body.alive = false; if (kind === 'gone') body.gone = true; if (kind === 'screen') body.skirmisher = true; }
    assert.equal(f.view.begin(), false); assert.equal(f.post.soldierView, null);
  }); }, alter(f => { const begin = f.view.begin; f.view.begin = function(e) { Object.assign(f.figures[1], { alive: true, gone: false, skirmisher: false }); return begin.call(this, e); }; })],
  ['object-membership-rebuild', a => use(a, {}, f => {
    assert.equal(f.view.begin(), true); const old = f.view.figure; f.unit.figures[f.unit.figures.indexOf(old)] = { ...old };
    assert.equal(f.view.updatePose(), false); assert.equal(f.view.active, false); assert.equal(f.post.soldierView, null);
  }), alter(f => { f.view.valid = () => true; })],
  ['selection-changed-exit', a => { for (const kind of ['primary', 'group', 'order']) use(a, {}, f => {
    const other = { ...f.unit, id: 'other' }; f.game.units.push(other);
    if (kind === 'order') f.game.selection.push(other);
    assert.equal(f.view.begin(), true);
    if (kind === 'primary') f.game.selected = other; if (kind === 'group') f.game.selection.push(other); if (kind === 'order') f.game.selection.reverse();
    const selected = f.game.selected, members = [...f.game.selection]; assert.equal(f.view.updatePose(), false);
    assert.equal(f.game.selected, selected); assert.deepEqual(f.game.selection, members);
  }); }, alter(f => { f.view.valid = () => true; })],
  ['external-goal-retained', a => use(a, {}, f => {
    assert.equal(f.view.begin(), true); f.rts.goal.x += 17; f.rts.goal.yaw += 0.6; const goal = { ...f.rts.goal };
    assert.equal(f.view.updatePose(), false); assert.deepEqual(f.rts.goal, goal); assert.equal(f.view.active, false);
  }), alter(f => endWrapper(f, (v, saved) => { Object.assign(v.rts.goal, saved.goal); }))],
  ['idempotent-failed-cleanup', a => use(a, {}, f => {
    const before = cameraState(f.camera), begin = f.post.beginSoldierView; let disposedDepth = 0, disposedMat = 0;
    f.post.beginSoldierView = function(c, focus) { begin.call(this, c, focus); this.soldierView.depth.addEventListener('dispose', () => disposedDepth++); this.soldierView.material.addEventListener('dispose', () => disposedMat++); throw Error('injected allocation follow-up failure'); };
    assert.equal(f.view.begin(), false); assert.equal(f.view.active, false); assert.equal(f.post.soldierView, null); assert.equal(f.post.rtScene.depthTexture, null); assert.equal(cameraState(f.camera), before);
    f.view.end('pagehide'); f.post.endSoldierView(); assert.equal(disposedDepth, 1); assert.equal(disposedMat, 1);
  }), alter(f => { f.post.endSoldierView = () => {}; })],
  ['perspective-depth-linearization', a => {
    for (const [nearPlane, farPlane] of [[1, 128], [0.3, 6000], [14.8, 4960]]) for (const z of [nearPlane, nearPlane * 2, (nearPlane + farPlane) / 2, farPlane]) {
      // Independent projection coefficients of a perspective camera, including far/near endpoints.
      const cam = new THREE.PerspectiveCamera(55, 1.6, nearPlane, farPlane);
      const projected = new THREE.Vector3(0, 0, -z).project(cam).z * 0.5 + 0.5;
      const decoded = a.decode(projected, nearPlane, farPlane); assert.ok(Math.abs(decoded - z) < Math.max(1e-9, z * 1e-10));
    }
  }, { ...api, decode: depth => depth }],
  ['near-focus-far-coc', a => {
    for (const screenY of [0.1, 0.5, 0.9]) for (const [z, expected] of [[8, 1], [16, 0], [32, 1]]) near(a.blend(z, 16, 1, smoothstep, Math.abs, Math.max, screenY), expected);
    near(a.blend(16.5, 16, 1, smoothstep, Math.abs, Math.max, 0), 0);
  }, { ...api, blend: (_z, _f, _n, _s, _a, _m, y) => smoothstep(0.24, 0.56, Math.abs(y - 0.46)) }],
  ['post-lazy-map-integrity', a => use(a, {}, f => {
    const p = f.post, normal = p.finalMat, source = normal.fragmentShader, targets = [p.rtScene, p.rtSmall, p.rtBlur];
    assert.equal(hash(source), MAP_FRAGMENT_SHA); assert.equal(normal.uniforms.tDepth, undefined); assert.equal(p.soldierView, null); assert.equal(p.rtScene.depthTexture, null);
    for (let i = 0; i < 5; i++) {
      assert.equal(f.view.begin(), true); const owner = p.soldierView;
      assert.equal(p.rtScene.depthTexture, owner.depth); assert.equal(owner.depth.type, THREE.UnsignedIntType); assert.equal(owner.depth.format, THREE.DepthFormat);
      assert.equal(owner.depth.minFilter, THREE.NearestFilter); assert.equal(owner.depth.magFilter, THREE.NearestFilter); assert.equal(owner.depth.generateMipmaps, false);
      assert.equal(owner.depth.wrapS, THREE.ClampToEdgeWrapping); assert.equal(owner.depth.wrapT, THREE.ClampToEdgeWrapping);
      for (const key of Object.keys(normal.uniforms)) assert.equal(owner.material.uniforms[key], normal.uniforms[key]);
      assert.ok(owner.material.fragmentShader.includes(DEPTH_DISTANCE) && owner.material.fragmentShader.includes(DEPTH_BLEND));
      p.setSize(1280, 800); assert.equal(p.rtScene.width, 896); assert.equal(p.rtScene.height, 560); assert.equal(p.soldierView, owner);
      p.enabled = false; p.render(new THREE.Scene(), f.camera); assert.equal(p.quad.material, normal); p.enabled = true;
      f.view.end(); assert.equal(p.rtScene.depthTexture, null); assert.equal(p.soldierView, null); assert.equal(p.quad.material, normal);
      assert.deepEqual([p.rtScene, p.rtSmall, p.rtBlur], targets); assert.equal(normal.fragmentShader, source); assert.equal(normal.uniforms.tDepth, undefined);
    }
    const disposed = [0, 0, 0]; targets.forEach((t, i) => t.addEventListener('dispose', () => disposed[i]++));
    assert.equal(f.view.begin(), true); f.renderer.contextLost = true; f.renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    assert.equal(p.soldierView, null); assert.equal(p.rtScene.depthTexture, null); assert.deepEqual(disposed, [1, 1, 1]);
    f.view.blur('context'); assert.equal(f.view.active, false); assert.deepEqual([p.rtScene, p.rtSmall, p.rtBlur], targets);
    assert.equal(p.quad.material, normal); assert.equal(hash(normal.fragmentShader), MAP_FRAGMENT_SHA);
    let targetCalls = 0; f.renderer.setRenderTarget = () => targetCalls++;
    p.render(new THREE.Scene(), f.camera); assert.equal(targetCalls, 0, 'lost context must never set up targets');
    f.renderer.contextLost = false; p.render(new THREE.Scene(), f.camera); assert.equal(targetCalls, 5, 'one scene pass plus original four compositor passes');
  }), alter(f => { f.post.finalMat.uniforms.tDepth = { value: null }; })],
];

let failed = 0;
for (const [name, check, mutant] of tests) {
  try {
    if (process.argv.includes('--prove-fail')) {
      check(api); let caught = false;
      try { check(mutant); } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; caught = true; }
      assert.equal(caught, true, `${name}: intended mutant escaped`); check(api);
      console.log(`CAUGHT ${name}`);
    } else { check(api); console.log(`PASS ${name}`); }
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
}
console.log(`SOLDIER VIEW ${failed ? 'FAILED' : 'OK'} ${tests.length - failed}/${tests.length}${process.argv.includes('--prove-fail') ? ' intended controls; A/B/A2' : ''}`);
process.exitCode = failed ? 1 : 0;

// A held inspection lens. The ordinary RTS state and simulation remain their owners' responsibility.
import * as THREE from 'three';
import { FIGURE_SCALE } from '../units/soldier-mesh.js';
import { LOOK } from '../ui/look.js';

const CAMERA_FIELDS = ['fov', 'near', 'far', 'zoom', 'aspect'];
const CAMERA_VECTORS = ['position', 'quaternion', 'up', 'scale'];
const CAMERA_MATRICES = ['matrix', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix', 'projectionMatrixInverse'];

export function frontFigure(unit) {
  const lateral = f => unit.formation === 'column' ? f.cfile : f.lx;
  return unit.figures.filter(f => f.alive && !f.gone && !f.skirmisher && !f.mount
    && [f.x, f.z, f.yaw, f.rank, lateral(f), f.i].every(Number.isFinite))
    .sort((a, b) => a.rank - b.rank || lateral(a) - lateral(b) || a.i - b.i)[0] || null;
}

function saveCamera(camera) {
  camera.updateMatrix();
  camera.updateMatrixWorld(true);
  return Object.fromEntries([...CAMERA_FIELDS.map(k => [k, camera[k]]),
    ...CAMERA_VECTORS.map(k => [k, camera[k].clone()]), ...CAMERA_MATRICES.map(k => [k, camera[k].clone()])]);
}

function restoreCamera(camera, saved, resized) {
  const currentAspect = camera.aspect;
  for (const k of CAMERA_FIELDS) camera[k] = saved[k];
  for (const k of CAMERA_VECTORS) camera[k].copy(saved[k]);
  for (const k of CAMERA_MATRICES) camera[k].copy(saved[k]);
  if (resized) { camera.aspect = currentAspect; camera.updateProjectionMatrix(); }
  camera.updateMatrix();
  camera.updateMatrixWorld(true);
}

export class SoldierView {
  constructor({ camera, rts, game, terrain, post, scale = () => LOOK.figureScale,
    canBegin = () => true, canContinue = () => true, isFieldFocus = () => true, onEnter = () => {}, onExit = () => {} }) {
    Object.assign(this, { camera, rts, game, terrain, post, scale, canBegin, canContinue, isFieldFocus, onEnter, onExit });
    this.active = false;
    this.snapshot = null;
    this.figure = null;
    this.unit = null;
    this.held = false;
    this.latched = false;
    this.escapeHeld = false;
    this.resized = false;
    this.focus = 0;
    this.target = new THREE.Vector3();
    this.viewTarget = new THREE.Vector3();
  }

  eligible(unit) {
    return !!unit && this.game.units.includes(unit) && unit === this.game.selected
      && unit.side === this.game.playerSide && this.game.controls(unit) && unit.type === 'infantry'
      && unit.canTakeOrders() && Number.isFinite(unit.men) && unit.men > 0;
  }

  begin(event) {
    if (this.active || this.latched || !this.canBegin(event)) return false;
    const unit = this.game.selected;
    if (!this.eligible(unit)) return false;
    const figure = frontFigure(unit);
    if (!figure) return false;
    this.snapshot = { camera: saveCamera(this.camera), goal: { ...this.rts.goal }, goalObject: this.rts.goal,
      selection: [...this.game.selection] };
    this.unit = unit;
    this.figure = figure;
    this.active = true;
    this.resized = false;
    this.rts.keys.clear();
    this.rts.inertia = null;
    try {
      if (!this.pose()) { this.end('failed'); return false; }
      this.post.beginSoldierView(this.camera, this.focus);
      this.onEnter(event);
      return true;
    } catch {
      this.end('failed');
      return false;
    }
  }

  valid() {
    const s = this.snapshot, f = this.figure;
    return this.active && this.canContinue() && this.eligible(this.unit) && this.unit.figures.includes(f) && f.alive && !f.gone
      && !f.skirmisher && !f.mount && [f.x, f.z, f.yaw].every(Number.isFinite)
      && this.game.selection.length === s.selection.length && this.game.selection.every((u, i) => u === s.selection[i])
      && this.rts.goal === s.goalObject && Object.keys(s.goal).every(k => this.rts.goal[k] === s.goal[k]);
  }

  pose() {
    const f = this.figure, s = FIGURE_SCALE * this.scale();
    if (!(s > 0) || !Number.isFinite(s)) return false;
    const rightX = Math.cos(f.yaw), rightZ = -Math.sin(f.yaw);
    const forwardX = Math.sin(f.yaw), forwardZ = Math.cos(f.yaw);
    const x = f.x - rightX * 1.8 * s + forwardX * 0.7 * s;
    const z = f.z - rightZ * 1.8 * s + forwardZ * 0.7 * s;
    const tx = f.x + rightX * 6 * s, tz = f.z + rightZ * 6 * s;
    const ground = this.terrain.heightAt(x, z), targetGround = this.terrain.heightAt(tx, tz);
    if (![ground, targetGround].every(Number.isFinite)) return false;
    const c = this.camera;
    c.position.set(x, ground + Math.max(1.64 * s, 0.4 * s), z);
    this.target.set(tx, targetGround + 1.64 * s, tz);
    c.up.set(0, 1, 0);
    c.fov = 55; c.near = 0.3; c.far = 6000; c.zoom = 1;
    c.updateProjectionMatrix();
    c.lookAt(this.target);
    c.updateMatrix();
    c.updateMatrixWorld(true);
    this.viewTarget.copy(this.target).applyMatrix4(c.matrixWorldInverse);
    this.focus = -this.viewTarget.z;
    return Number.isFinite(this.focus) && this.focus > c.near && this.focus < c.far;
  }

  updatePose() {
    if (!this.active) return false;
    if (!this.valid() || !this.pose()) { this.end('invalid'); return false; }
    this.post.updateSoldierView(this.camera, this.focus);
    return true;
  }

  onResize() {
    if (!this.active) return;
    this.resized = true;
    this.updatePose();
  }

  updateMap(dt) {
    if (!this.active) this.rts.update(dt);
  }

  end(reason = 'release') {
    if (!this.active) return false;
    const snapshot = this.snapshot;
    // Callbacks can synchronously focus a rebuilt HUD row: release ownership before any callback.
    this.active = false;
    this.snapshot = null;
    if (reason !== 'release') this.latched = true;
    this.rts.keys.clear();
    this.rts.inertia = null;
    try { this.post.endSoldierView(); }
    finally {
      restoreCamera(this.camera, snapshot.camera, this.resized);
      this.figure = null; this.unit = null;
      this.onExit(reason);
    }
    return true;
  }

  keyDown(event) {
    const k = event.key.toLowerCase();
    if (k === 'escape' && !event.repeat && !this.active) this.escapeHeld = false;
    if (k === 'i') {
      if (event.repeat || this.held || this.latched) return this.active;
      this.held = true;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
      return this.begin(event);
    }
    if (k === 'escape' && (this.active || this.escapeHeld)) {
      this.escapeHeld = true;
      this.end('escape');
      return true;
    }
    if (this.active && !([' ', '1', '2', '3'].includes(k) && this.isFieldFocus(event)
      && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)) this.end('key');
    return false;
  }

  keyUp(event) {
    const k = event.key.toLowerCase();
    if (k === 'escape') this.escapeHeld = false;
    if (k !== 'i') return false;
    this.held = false;
    const ended = this.end('release');
    this.latched = false;
    return ended;
  }

  blur(reason = 'blur') {
    if (this.active || this.held) this.latched = true;
    this.held = false;
    this.escapeHeld = false;
    this.end(reason);
  }
}

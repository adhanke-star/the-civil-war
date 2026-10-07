// src/render/rts-camera.js: a high oblique battle camera (UG:G style).
//
// State is a ground target point, an azimuth (yaw), a pitch above the horizon and a distance. Inputs set
// goals; update() eases toward them. Pan keeps the grabbed ground point under the pointer.
// The tilt follows the zoom (Aaron: the old fixed 54 degrees looked "too angled down"): close in the camera
// looks across the field at about 24 degrees, at the default distance about 38, fully out about 45; a
// vertical right-drag adds the player's own offset on top.
// Keys: WASD / arrows pan, Q/E turn, +/- (and PageUp/PageDown) zoom. Mouse and trackpad: see ui/input.js.
// anchor() is the map-style core: it moves the goal so a ground point sits exactly under a screen point once
// the camera has settled, so zoom-to-cursor, drag-pan and pinch keep the grabbed ground under the fingers.
// A released pan may glide on (inertia, rules.panInertia in ui/input.js).

import * as THREE from 'three';
import { LOOK } from '../ui/look.js';
import { on } from '../settings.js';

const _v = new THREE.Vector3();
const _cam = new THREE.PerspectiveCamera();
const NEAR_DIST = 150, FAR_DIST = 2000, NEAR_PITCH = 0.42, FAR_PITCH = 0.78;

/** Default camera pitch for a distance: low and oblique close in, more map-like far out. */
export function pitchForDist(dist) {
  const t = THREE.MathUtils.clamp(Math.log(dist / NEAR_DIST) / Math.log(FAR_DIST / NEAR_DIST), 0, 1);
  return NEAR_PITCH + (FAR_PITCH - NEAR_PITCH) * t;
}
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

export class RtsCamera {
  constructor(camera, terrain, { target = [0, 0], yaw = Math.PI, pitch, dist = 900 } = {}) {
    this.camera = camera;
    this.terrain = terrain;
    this.tilt = 0; // the player's own tilt on top of pitchForDist (right-drag up/down)
    pitch = THREE.MathUtils.clamp((pitch ?? pitchForDist(dist)) + LOOK.cameraElevation * Math.PI / 180, 0.3, 1.35);
    this.target = new THREE.Vector3(target[0], 0, target[1]);
    this.goal = { x: target[0], z: target[1], yaw, pitch, dist };
    this.yaw = yaw;
    this.pitch = pitch;
    this.dist = dist;
    this.minDist = 100;
    this.maxDist = 2000;
    this.keys = new Set();
    this.bound = terrain.half - 120;
    this.groundY = 0;
    on('look.cameraElevation', () => { this.goal.pitch = this._pitch(this.goal.dist); });
    this.inertia = null; // { vx, vz } m/s of goal drift after a released pan
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '=', '-', '_', 'pageup', 'pagedown'].includes(k)) {
      if (down) this.keys.add(k); else this.keys.delete(k);
      return true;
    }
    return false;
  }

  /** Pan by a world-space delta (x, z). */
  panBy(dx, dz) {
    this.goal.x += dx;
    this.goal.z += dz;
    this._clamp();
  }

  /** Pan by screen-relative amounts (right, forward) in metres. */
  panScreen(right, forward) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // camera sits at target + (sin yaw, cos yaw) * horizontal distance, so "forward" is -(sin, cos)
    this.panBy(right * c - forward * s, -right * s - forward * c);
  }

  rotateBy(dyaw, dpitch) {
    this.goal.yaw += dyaw;
    this.tilt = THREE.MathUtils.clamp(this.tilt + dpitch, -0.25, 0.6);
    this.goal.pitch = this._pitch(this.goal.dist);
  }

  _pitch(dist) {
    return THREE.MathUtils.clamp(pitchForDist(dist) + this.tilt + LOOK.cameraElevation * Math.PI / 180, 0.3, 1.35);
  }

  /** Pan by a screen-space drag in CSS pixels (two-finger trackpad scroll): the ground follows the fingers. */
  panPixels(dxPx, dyPx, viewHeightPx) {
    const mpp = (2 * this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, viewHeightPx);
    this.panScreen(dxPx * mpp, (-dyPx * mpp) / Math.max(0.35, Math.sin(this.pitch)));
  }

  /** Glide to centre a ground point (double-click on a brigade's flag). */
  focus(x, z) {
    this.inertia = null;
    this.goal.x = x;
    this.goal.z = z;
    this._clamp();
  }

  /** Fly to a ground point and come in close enough to read the brigades there (flags, minimap, feed). */
  flyTo(x, z, maxDist = 650) {
    this.focus(x, z);
    if (this.goal.dist > maxDist) {
      this.goal.dist = maxDist;
      this.goal.pitch = this._pitch(maxDist);
    }
  }

  /** A camera at the goal state (where update() will settle), for solving anchor(). */
  goalCamera() {
    const g = this.goal;
    const ty = this.terrain.heightAt(g.x, g.z);
    const h = Math.cos(g.pitch) * g.dist;
    _cam.fov = this.camera.fov;
    _cam.aspect = this.camera.aspect;
    _cam.near = Math.max(2, g.dist * 0.02);
    _cam.far = g.dist * 4 + 2000;
    _cam.updateProjectionMatrix();
    _cam.position.set(g.x + Math.sin(g.yaw) * h, ty + Math.sin(g.pitch) * g.dist, g.z + Math.cos(g.yaw) * h);
    _cam.lookAt(g.x, ty, g.z);
    _cam.updateMatrixWorld();
    return _cam;
  }

  /** Move the goal so ground point p ({x, y, z}) sits under client point (cx, cy) once the camera settles. */
  anchor(p, cx, cy, dom) {
    if (!p) return;
    const rect = dom.getBoundingClientRect();
    _ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    for (let i = 0; i < 3; i++) {
      _ray.setFromCamera(_ndc, this.goalCamera());
      const o = _ray.ray.origin, d = _ray.ray.direction;
      if (d.y > -1e-4) return; // at or above the horizon: no ground there
      const t = (p.y - o.y) / d.y;
      const dx = p.x - (o.x + d.x * t), dz = p.z - (o.z + d.z * t);
      this.goal.x += dx;
      this.goal.z += dz;
      if (Math.abs(dx) + Math.abs(dz) < 0.05) break;
    }
    this._clamp();
  }

  /** Zoom by a factor toward the ground under a client point (wheel, trackpad pinch). */
  zoomAt(factor, cx, cy, dom) {
    const p = this.pick(cx, cy, dom);
    this.zoomBy(factor);
    if (p) this.anchor(p, cx, cy, dom);
  }

  /** Jump the eased state to the goal (direct manipulation: the ground stays glued to the fingers). */
  snap() {
    this.target.x = this.goal.x;
    this.target.z = this.goal.z;
    this.dist = this.goal.dist;
    this.pitch = this.goal.pitch;
    this.yaw = this.goal.yaw;
  }

  /** Ground footprint of the view: four [x, z] corners on the plane at the target's height (for the minimap). */
  footprint(out = []) {
    const cam = this.camera;
    const y = this.target.y;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    out.length = 0;
    for (const [nx, ny] of corners) {
      _ndc.set(nx, ny);
      _ray.setFromCamera(_ndc, cam);
      const o = _ray.ray.origin, d = _ray.ray.direction;
      let t = d.y < -1e-4 ? (y - o.y) / d.y : 6000;
      t = Math.min(t, 6000);
      out.push([o.x + d.x * t, o.z + d.z * t]);
    }
    return out;
  }

  /** Zoom by a factor; if a ground point is given, zoom toward it. */
  zoomBy(factor, toward) {
    const old = this.goal.dist;
    const next = THREE.MathUtils.clamp(old * factor, this.minDist, this.maxDist);
    if (toward) {
      const t = 1 - next / old;
      this.goal.x += (toward.x - this.goal.x) * t;
      this.goal.z += (toward.z - this.goal.z) * t;
    }
    this.goal.dist = next;
    this.goal.pitch = this._pitch(next);
    this._clamp();
  }

  _clamp() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -this.bound, this.bound);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -this.bound, this.bound);
  }

  update(dt) {
    // a released pan glides on and slows (rules.panInertia)
    const iv = this.inertia;
    if (iv) {
      this.panBy(iv.vx * dt, iv.vz * dt);
      const k = Math.exp(-dt * 4.5);
      iv.vx *= k;
      iv.vz *= k;
      if (Math.hypot(iv.vx, iv.vz) < 2) this.inertia = null;
    }
    // keyboard
    const speed = this.goal.dist * 0.9 * dt;
    const k = this.keys;
    if (k.size) {
      let r = 0, f = 0;
      if (k.has('a') || k.has('arrowleft')) r -= speed;
      if (k.has('d') || k.has('arrowright')) r += speed;
      if (k.has('w') || k.has('arrowup')) f += speed;
      if (k.has('s') || k.has('arrowdown')) f -= speed;
      if (r || f) this.panScreen(r, f);
      if (k.has('q')) this.rotateBy(-1.4 * dt, 0);
      if (k.has('e')) this.rotateBy(1.4 * dt, 0);
      if (k.has('+') || k.has('=') || k.has('pageup')) this.zoomBy(1 - 1.5 * dt);
      if (k.has('-') || k.has('_') || k.has('pagedown')) this.zoomBy(1 + 1.5 * dt);
    }
    const a = 1 - Math.exp(-dt * 9);
    this.target.x += (this.goal.x - this.target.x) * a;
    this.target.z += (this.goal.z - this.target.z) * a;
    this.yaw += (this.goal.yaw - this.yaw) * a;
    this.pitch += (this.goal.pitch - this.pitch) * a;
    this.dist += (this.goal.dist - this.dist) * a;
    const gy = this.terrain.heightAt(this.target.x, this.target.z);
    this.groundY += (gy - this.groundY) * Math.min(1, dt * 4);
    this.target.y = this.groundY;
    const h = Math.cos(this.pitch) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * h,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * h,
    );
    // never dip under a ridge between camera and target
    const under = this.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 25;
    if (this.camera.position.y < under) this.camera.position.y = under;
    this.camera.lookAt(this.target);
    this.camera.far = this.dist * 4 + 2000;
    this.camera.near = Math.max(2, this.dist * 0.02);
    this.camera.updateProjectionMatrix();
    // HUD projection runs before rendering; publish the pose lookAt just assigned.
    this.camera.updateMatrixWorld(true);
  }

  /** World point on the terrain under a client (CSS px) position, or null. Ray-marched heightfield. */
  pick(clientX, clientY, dom) {
    const rect = dom.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    const maxT = this.camera.far;
    let step = Math.max(2, this.dist * 0.01);
    let prevT = 0;
    for (let t = step; t < maxT; t += step) {
      _v.copy(d).multiplyScalar(t).add(o);
      if (!this.terrain.inBounds(_v.x, _v.z, -400)) {
        if (_v.y < -50) return null;
        continue;
      }
      if (_v.y <= this.terrain.heightAt(_v.x, _v.z)) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          _v.copy(d).multiplyScalar(mid).add(o);
          if (_v.y <= this.terrain.heightAt(_v.x, _v.z)) hi = mid; else lo = mid;
        }
        _v.copy(d).multiplyScalar(hi).add(o);
        _v.y = this.terrain.heightAt(_v.x, _v.z);
        return _v.clone();
      }
      prevT = t;
      step *= 1.01;
    }
    return null;
  }
}

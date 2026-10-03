// src/render/rts-camera.js: a high oblique battle camera (UG:G style).
//
// State is a ground target point, an azimuth (yaw), a pitch above the horizon and a distance. Inputs set
// goals; update() eases toward them. Pan keeps the grabbed ground point under the pointer.
// The tilt follows the zoom (Aaron: the old fixed 54 degrees looked "too angled down"): close in the camera
// looks across the field at about 24 degrees, at the default distance about 38, fully out about 45; a
// vertical right-drag adds the player's own offset on top.
// Keys: WASD / arrows pan, Q/E turn, +/- (and PageUp/PageDown) zoom. Mouse and trackpad: see ui/input.js.

import * as THREE from 'three';

const _v = new THREE.Vector3();
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
    if (pitch === undefined) pitch = pitchForDist(dist);
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
    return THREE.MathUtils.clamp(pitchForDist(dist) + this.tilt, 0.3, 1.35);
  }

  /** Pan by a screen-space drag in CSS pixels (two-finger trackpad scroll): the ground follows the fingers. */
  panPixels(dxPx, dyPx, viewHeightPx) {
    const mpp = (2 * this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, viewHeightPx);
    this.panScreen(dxPx * mpp, (-dyPx * mpp) / Math.max(0.35, Math.sin(this.pitch)));
  }

  /** Glide to centre a ground point (double-click on a brigade's flag). */
  focus(x, z) {
    this.goal.x = x;
    this.goal.z = z;
    this._clamp();
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

// src/units/battery.js: an artillery battery: guns, crews and limbers.
//
// Guns stand ~16 m apart in line with their crews around them; limbers wait behind. On the march the guns
// hook up (limbered): each limber leads its gun. A battery must halt UNLIMBER_S seconds before firing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Unit } from './unit.js';
import { FIGURE_SCALE } from './soldier-mesh.js';

const GUN_SPACING = 16;
const UNLIMBER_S = 6;
const CREW_SLOTS = [[-1.6, -1.2], [1.6, -1.2], [-1.2, -3.6], [1.3, -3.4], [0, -4.6]];

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function gunGeometry() {
  const wheel = () => new THREE.CylinderGeometry(0.62, 0.62, 0.1, 10).rotateZ(Math.PI / 2);
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.11, 0.16, 2.0, 8).rotateX(Math.PI / 2).translate(0, 0.95, 0.5), '#2b2b2b'),
    colored(new THREE.BoxGeometry(0.34, 0.26, 2.6).rotateX(-0.22).translate(0, 0.5, -1.0), '#4f5b3a'),
    colored(wheel().translate(-0.6, 0.62, 0.1), '#3c3226'),
    colored(wheel().translate(0.6, 0.62, 0.1), '#3c3226'),
  ], false);
}

function limberGeometry() {
  const wheel = () => new THREE.CylinderGeometry(0.62, 0.62, 0.1, 10).rotateZ(Math.PI / 2);
  const horse = (x, z) => [
    colored(new THREE.BoxGeometry(0.5, 0.7, 1.7).translate(x, 1.3, z), '#4a3426'),
    colored(new THREE.BoxGeometry(0.28, 0.5, 0.6).rotateX(-0.6).translate(x, 1.75, z + 1.0), '#4a3426'),
    colored(new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(x - 0.15, 0.45, z + 0.6), '#3a281c'),
    colored(new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(x + 0.15, 0.45, z - 0.6), '#3a281c'),
  ];
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.1, 0.6, 0.8).translate(0, 1.15, 0), '#4f5b3a'),
    colored(wheel().translate(-0.65, 0.62, 0), '#3c3226'),
    colored(wheel().translate(0.65, 0.62, 0), '#3c3226'),
    colored(new THREE.BoxGeometry(0.08, 0.08, 2.4).translate(0, 0.9, 1.6), '#3c3226'),
    ...horse(-0.45, 3.2), ...horse(0.45, 3.2), ...horse(-0.45, 5.4), ...horse(0.45, 5.4),
  ], false);
}

/** One instanced mesh each for guns and limbers, shared by every battery. */
export class GunPool {
  constructor(capacity) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.guns = new THREE.InstancedMesh(gunGeometry(), mat, capacity);
    this.limbers = new THREE.InstancedMesh(limberGeometry(), mat, capacity);
    for (const m of [this.guns, this.limbers]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    this.used = 0;
    this.capacity = capacity;
    this.dummy = new THREE.Object3D();
  }

  alloc() { return this.used++; }

  set(mesh, i, x, y, z, yaw, s) {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(0, yaw, 0);
    d.scale.setScalar(s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  hide(mesh, i) {
    this.set(mesh, i, 0, -500, 0, 0, 0.001);
  }

  flush() {
    this.guns.count = this.limbers.count = this.used;
    this.guns.instanceMatrix.needsUpdate = true;
    this.limbers.instanceMatrix.needsUpdate = true;
  }
}

export class Battery extends Unit {
  constructor(def, pool, gunPool, terrain, seed) {
    super(def, pool, terrain, seed);
    this.gunPool = gunPool;
    this.stoppedT = UNLIMBER_S;
    this.unlimbered = true;
    this.gunSlots = [];
    for (let g = 0; g < this.guns; g++) {
      this.gunSlots.push({ i: gunPool.alloc(), alive: true, x: def.x, z: def.z, yaw: def.facing });
    }
    this.layout();
    for (const gs of this.gunSlots) {
      const [x, z] = this.gunWorld(gs);
      gs.x = x; gs.z = z;
    }
    for (const f of this.figures) {
      const p = this.slotWorld(f);
      f.x = p[0]; f.z = p[1];
    }
  }

  layout() {
    const live = this.figures.filter((f) => f.alive);
    const G = this.gunSlots ? this.gunSlots.filter((g) => g.alive).length : this.guns || 1;
    const n = Math.max(1, G);
    let gi = 0;
    if (this.gunSlots) {
      for (const g of this.gunSlots) {
        if (!g.alive) continue;
        g.lx = (gi - (n - 1) / 2) * GUN_SPACING;
        gi++;
      }
    }
    live.forEach((f, k) => {
      const gun = k % n;
      const slot = CREW_SLOTS[Math.floor(k / n) % CREW_SLOTS.length];
      f.lx = (gun - (n - 1) / 2) * GUN_SPACING + slot[0] * FIGURE_SCALE * 0.8;
      f.lz = slot[1] * FIGURE_SCALE * 0.8;
      f.rank = 1;
    });
    this.halfFront = Math.max(8, ((n - 1) / 2) * GUN_SPACING + 6);
    this.depth = 14;
  }

  gunWorld(g) {
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    const lz = this.unlimbered ? 0 : -3;
    return [this.x + c * g.lx + s * lz, this.z - s * g.lx + c * lz];
  }

  gunPositions() {
    return this.gunSlots.filter((g) => g.alive).map((g) => [g.x, g.z]);
  }

  takeLosses(menLost, fallenPool, now) {
    super.takeLosses(menLost, fallenPool, now);
    const want = Math.ceil(this.guns * Math.max(0, this.men) / this.menMax - 0.2);
    let live = this.gunSlots.filter((g) => g.alive);
    while (live.length > want && live.length) {
      const g = live.pop();
      g.alive = false;
      // a disabled gun stays on the field
    }
    if (live.length !== this.gunSlots.filter((g) => g.alive).length) this.layout();
  }

  animate(dt, time) {
    const moving = this.follow.active || this.state === 'routing';
    if (moving) {
      this.stoppedT = 0;
      this.unlimbered = false;
    } else {
      this.stoppedT += dt;
      if (this.stoppedT >= UNLIMBER_S) this.unlimbered = true;
    }
    super.animate(dt, time);
    const T = this.terrain;
    const s = FIGURE_SCALE;
    const fs = Math.sin(this.facing), fc = Math.cos(this.facing);
    for (const g of this.gunSlots) {
      const [tx, tz] = this.gunWorld(g);
      const dx = tx - g.x, dz = tz - g.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, (moving ? 9 : 4) * dt);
      if (d > 0.01) { g.x += (dx / d) * step; g.z += (dz / d) * step; }
      if (moving && d > 1) g.yaw = Math.atan2(dx, dz);
      else g.yaw += Math.atan2(Math.sin(this.facing - g.yaw), Math.cos(this.facing - g.yaw)) * Math.min(1, dt * 2);
      const gy = T.heightAt(g.x, g.z);
      if (!g.alive && this.unlimbered) {
        this.gunPool.set(this.gunPool.guns, g.i, g.x, gy, g.z, g.yaw + 0.5, s);
        this.gunPool.hide(this.gunPool.limbers, g.i);
        continue;
      }
      if (!g.alive) { this.gunPool.hide(this.gunPool.guns, g.i); this.gunPool.hide(this.gunPool.limbers, g.i); continue; }
      // limbered: the limber leads, gun trails, both facing the march; unlimbered: limber 20 m behind
      const gyaw = moving ? g.yaw : this.facing;
      const gfs = Math.sin(gyaw), gfc = Math.cos(gyaw);
      if (moving) {
        this.gunPool.set(this.gunPool.guns, g.i, g.x, gy, g.z, gyaw + Math.PI, s);
        const lx = g.x + gfs * 5.5 * s * 0.5, lz = g.z + gfc * 5.5 * s * 0.5;
        this.gunPool.set(this.gunPool.limbers, g.i, lx, T.heightAt(lx, lz), lz, gyaw, s);
      } else {
        this.gunPool.set(this.gunPool.guns, g.i, g.x, gy, g.z, gyaw, s);
        const lx = g.x - fs * 22, lz = g.z - fc * 22;
        this.gunPool.set(this.gunPool.limbers, g.i, lx, T.heightAt(lx, lz), lz, this.facing + Math.PI, s);
      }
    }
  }

  volley() {
    return [];
  }
}

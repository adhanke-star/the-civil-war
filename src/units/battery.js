// src/units/battery.js: an artillery battery: guns, crews, limbers with horse teams and drivers.
//
// Guns stand GUN_SPACING apart in line, each served by a crew of three figures in poses (rammer at the
// muzzle, loader beside the breech, gunner at the trail) with two drivers mounted on the limber team
// 22 m behind. On the march the battery hooks up (limbered): limber teams lead, guns trail, one behind
// the other along the battery's own trail, drivers riding and the rest of the crew walking alongside.
// A battery must halt UNLIMBER_S seconds before firing; each gun recoils when it fires.
//
// Pieces: US batteries carry 10-pounder Parrott rifles (long iron tube with a breech band); CS batteries
// bronze smoothbores (6-pounders and 12-pounder howitzers at Manassas), drawn as a shorter bronze tube with
// a muzzle swell. Carriages are the field pattern: two large spoked wheels, cheeks and a trail.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Unit } from './unit.js';
import { FIGURE_SCALE } from './soldier-mesh.js';
import { horseGeometry, HORSE_COATS } from './mounts.js';
import { weldFlat } from '../render/weld.js';

const GUN_SPACING = 16;
const GUN_COLUMN_SPACING = 48;
const UNLIMBER_S = 6;
const LIMBER_AHEAD = 2.75; // life metres from the gun's axle to the limber's axle when hooked up
const LIMBER_BACK = 22; // world metres behind an unlimbered gun
// crew slots in gun space (life metres: x right, z forward), with the clip and prop each man takes
const CREW = [
  { x: 0.95, z: 1.35, clip: 'crew-ram', prop: 2, yaw: -Math.PI / 2 },
  { x: -1.0, z: 0.55, clip: 'crew', prop: 0, yaw: Math.PI / 2 },
  { x: 0.15, z: -2.3, clip: 'crew-gunner', prop: 0, yaw: 0 },
  { x: -1.1, z: -1.6, clip: 'crew', prop: 0, yaw: 0.6 },
];
const DRIVERS = [[-0.55, 2.6], [-0.55, 4.8]]; // limber space: the near-side horse of each pair
const WALKERS = [[2.4, -0.4], [-2.4, 0.2], [2.2, -3.2], [-2.3, -3.0]]; // walking beside the gun on the march

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

const IRON = '#2b2c30';
const WOOD = '#5c6a3b'; // the "artillery green" olive of US and CS field carriages
const SPOKE = '#6a7445';

/** A 57-inch field wheel: tyre, two felloe rings, twelve spokes and a hub; axis along X. */
function wheelGeometry() {
  const P = [];
  const r = 0.72;
  P.push(colored(new THREE.CylinderGeometry(r, r, 0.09, 14, 1, true).rotateZ(Math.PI / 2), IRON));
  for (const side of [-1, 1]) {
    const ring = new THREE.RingGeometry(r - 0.11, r, 14).rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2).translate(side * 0.045, 0, 0);
    P.push(colored(ring, WOOD));
  }
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.BoxGeometry(0.05, r - 0.1, 0.045).translate(0, (r - 0.1) / 2, 0).rotateX((i / 12) * Math.PI * 2);
    P.push(colored(sp, SPOKE));
  }
  P.push(colored(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 7).rotateZ(Math.PI / 2), IRON));
  return mergeGeometries(P, false);
}

/** Carriage: axle, two wheels, cheeks and the trail resting on the ground behind. */
function carriageParts() {
  const P = [];
  const wheel = wheelGeometry();
  P.push(wheel.clone().translate(-0.75, 0.72, 0));
  P.push(wheel.clone().translate(0.75, 0.72, 0));
  P.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateZ(Math.PI / 2).translate(0, 0.72, 0), IRON));
  for (const s of [-1, 1]) P.push(colored(new THREE.BoxGeometry(0.1, 0.42, 0.9).translate(s * 0.17, 0.95, -0.15), WOOD));
  // the stock: from the axle down to the trail on the ground 2 m back
  P.push(colored(new THREE.BoxGeometry(0.22, 0.2, 2.1).rotateX(-0.3).translate(0, 0.5, -1.05), WOOD));
  P.push(colored(new THREE.BoxGeometry(0.3, 0.14, 0.25).translate(0, 0.1, -2.1), IRON)); // lunette/trail plate
  P.push(colored(new THREE.BoxGeometry(0.06, 0.06, 1.1).rotateX(0.5).translate(0.2, 0.6, -1.5), '#8a7352')); // handspike
  return P;
}

function gunGeometry(kind) {
  const P = carriageParts();
  if (kind === 'parrott') {
    P.push(colored(new THREE.CylinderGeometry(0.08, 0.1, 1.85, 8).rotateX(Math.PI / 2).translate(0, 1.02, 0.45), IRON));
    P.push(colored(new THREE.CylinderGeometry(0.125, 0.125, 0.42, 8).rotateX(Math.PI / 2).translate(0, 1.02, -0.3), '#1e1f22')); // breech band
    P.push(colored(new THREE.SphereGeometry(0.06, 5, 4).translate(0, 1.02, -0.55), IRON)); // cascabel
  } else {
    const bronze = '#8a7538';
    P.push(colored(new THREE.CylinderGeometry(0.078, 0.1, 1.55, 8).rotateX(Math.PI / 2).translate(0, 1.02, 0.35), bronze));
    P.push(colored(new THREE.CylinderGeometry(0.095, 0.085, 0.14, 8).rotateX(Math.PI / 2).translate(0, 1.02, 1.08), bronze)); // muzzle swell
    P.push(colored(new THREE.SphereGeometry(0.07, 5, 4).translate(0, 1.02, -0.48), bronze)); // cascabel knob
  }
  P.push(colored(new THREE.BoxGeometry(0.5, 0.08, 0.18).translate(0, 1.02, 0.02), IRON)); // trunnions
  return weldFlat(mergeGeometries(P, false));
}

/** Limber: ammunition chest on two wheels, a pole, and a four-horse team in two pairs. */
function limberGeometry() {
  const P = [];
  const wheel = wheelGeometry();
  P.push(wheel.clone().translate(-0.75, 0.72, 0));
  P.push(wheel.clone().translate(0.75, 0.72, 0));
  P.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateZ(Math.PI / 2).translate(0, 0.72, 0), IRON));
  P.push(colored(new THREE.BoxGeometry(1.05, 0.5, 0.62).translate(0, 1.2, 0.05), WOOD)); // chest
  P.push(colored(new THREE.BoxGeometry(1.08, 0.06, 0.66).translate(0, 1.46, 0.05), '#3a3f2a')); // lid
  P.push(colored(new THREE.BoxGeometry(0.4, 0.3, 0.5).translate(0, 0.85, 0.1), WOOD));
  P.push(colored(new THREE.BoxGeometry(0.08, 0.08, 3.4).translate(0, 0.9, 2.1), WOOD)); // pole
  P.push(colored(new THREE.BoxGeometry(0.1, 0.1, 0.3).translate(0, 0.8, -0.5), IRON)); // pintle hook
  let k = 0;
  for (const [x, z] of [[-0.55, 2.6], [0.55, 2.6], [-0.55, 4.8], [0.55, 4.8]]) {
    const h = horseGeometry({ coat: HORSE_COATS[k % HORSE_COATS.length], saddle: false, stride: k % 2 ? 0.8 : -0.8 });
    h.translate(x, 0, z);
    P.push(h);
    k++;
  }
  // traces: two long thin straps from the chest to the lead pair
  for (const x of [-0.75, 0.75]) P.push(colored(new THREE.BoxGeometry(0.03, 0.03, 4.0).translate(x, 1.0, 2.6), '#2a1f16'));
  return weldFlat(mergeGeometries(P, false));
}

/** Instanced meshes for guns (one geometry per side's pieces) and limbers, shared by every battery. */
export class GunPool {
  constructor({ US = 0, CS = 0 } = {}) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.guns = {
      US: new THREE.InstancedMesh(gunGeometry('parrott'), mat, Math.max(1, US)),
      CS: new THREE.InstancedMesh(gunGeometry('bronze'), mat, Math.max(1, CS)),
    };
    this.limbers = new THREE.InstancedMesh(limberGeometry(), mat, Math.max(1, US + CS));
    for (const m of [this.guns.US, this.guns.CS, this.limbers]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    this.guns.US.name = 'guns-US';
    this.guns.CS.name = 'guns-CS';
    this.limbers.name = 'limbers';
    this.used = { US: 0, CS: 0, limbers: 0 };
    this.dummy = new THREE.Object3D();
  }

  get meshes() { return [this.guns.US, this.guns.CS, this.limbers]; }

  alloc(side) {
    return { gun: this.used[side]++, limber: this.used.limbers++ };
  }

  set(mesh, i, x, y, z, yaw, s, pitch = 0) {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(pitch, yaw, 0);
    d.scale.setScalar(s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  hide(mesh, i) {
    this.set(mesh, i, 0, -500, 0, 0, 0.001);
  }

  flush() {
    this.guns.US.count = this.used.US;
    this.guns.CS.count = this.used.CS;
    this.limbers.count = this.used.limbers;
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
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
      const ids = gunPool.alloc(this.side);
      this.gunSlots.push({ ...ids, alive: true, x: def.x, z: def.z, yaw: def.facing, lx: 0, fireT: -9, recoil: 0, lmx: def.x, lmz: def.z, lmyaw: def.facing });
    }
    this.layout();
    for (const gs of this.gunSlots) {
      const [x, z] = this.gunWorld(gs);
      gs.x = x; gs.z = z;
      gs.lmx = x - Math.sin(this.facing) * LIMBER_BACK; gs.lmz = z - Math.cos(this.facing) * LIMBER_BACK; gs.lmyaw = this.facing + Math.PI;
    }
    this.placeCrew();
    for (const f of this.figures) {
      if (f.mount) continue;
      const p = this.slotWorld(f);
      f.x = p[0]; f.z = p[1];
    }
  }

  /** Crew slots in unit space from the gun slots: three at each gun, two drivers mounted per limber. */
  layout() {
    if (!this.gunSlots) { this.halfFront = 20; this.depth = 14; return; }
    const live = this.figures.filter((f) => f.alive);
    const guns = this.gunSlots.filter((g) => g.alive);
    const n = Math.max(1, guns.length);
    guns.forEach((g, gi) => { g.lx = (gi - (n - 1) / 2) * GUN_SPACING; });
    const perGun = Math.max(1, Math.floor(live.length / n));
    live.forEach((f, k) => {
      const gi = Math.min(n - 1, Math.floor(k / perGun));
      const j = k - gi * perGun;
      f.gun = guns[gi] || guns[0];
      f.crewIndex = j;
      f.mount = j >= CREW.length && j < CREW.length + DRIVERS.length ? DRIVERS[j - CREW.length] : null;
      const slot = CREW[j % CREW.length];
      f.crewClip = slot.clip;
      f.prop = slot.prop;
      f.rank = 1;
    });
    this.halfFront = Math.max(8, ((n - 1) / 2) * GUN_SPACING + 6);
    this.depth = 14;
  }

  layoutColumn() { this.layout(); }

  placeCrew() {
    for (const f of this.figures) f.lx = 0;
  }

  /** A crew figure's slot: beside his gun (unlimbered) or walking beside it on the march. */
  slotWorld(f) {
    const g = f.gun || (this.gunSlots && this.gunSlots[0]);
    if (!g) return [this.x, this.z, this.facing];
    const s = FIGURE_SCALE * 0.9;
    const yaw = this.unlimbered && !this.follow.active ? this.facing : g.yaw;
    const gs = Math.sin(yaw), gc = Math.cos(yaw);
    let lx, lz, fyaw;
    if (this.unlimbered) {
      const slot = CREW[f.crewIndex % CREW.length];
      lx = slot.x * s + f.jx * 0.5; lz = slot.z * s + f.jz * 0.5; fyaw = yaw + slot.yaw;
    } else {
      const w = WALKERS[f.crewIndex % WALKERS.length];
      lx = w[0] * s; lz = w[1] * s; fyaw = yaw;
    }
    return [g.x + gc * lx + gs * lz, g.z - gs * lx + gc * lz, fyaw];
  }

  gunWorld(g) {
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    return [this.x + c * g.lx, this.z - s * g.lx];
  }

  gunPositions() {
    return this.gunSlots.filter((g) => g.alive).map((g) => [g.x, g.z]);
  }

  contains(x, z, pad = 10) {
    for (const g of this.gunSlots) if (Math.hypot(g.x - x, g.z - z) < 12 + pad) return true;
    return super.contains(x, z, pad);
  }

  takeLosses(menLost, fallenPool, now) {
    super.takeLosses(menLost, fallenPool, now);
    const want = Math.ceil(this.guns * Math.max(0, this.men) / this.menMax - 0.2);
    let live = this.gunSlots.filter((g) => g.alive);
    let changed = false;
    while (live.length > want && live.length) {
      const g = live.pop();
      g.alive = false; // a disabled gun stays on the field
      changed = true;
    }
    if (changed) this.layout();
  }

  /** Column slots for the guns along the trail: gun k at k * GUN_COLUMN_SPACING behind the head. */
  columnGunSlots() {
    const out = [];
    const T = this.trail;
    let px = this.x, pz = this.z, k = T.length - 1;
    let need = 0.01, tx = Math.sin(this.facing), tz = Math.cos(this.facing);
    const n = this.gunSlots.length;
    while (out.length < n && k >= 0) {
      const [cx, cz] = T[k];
      const dx = cx - px, dz = cz - pz;
      const seg = Math.hypot(dx, dz);
      if (seg > 1e-6) { tx = -dx / seg; tz = -dz / seg; }
      if (seg >= need) {
        const t = need / seg;
        px += dx * t; pz += dz * t;
        out.push([px, pz, Math.atan2(tx, tz)]);
        need = GUN_COLUMN_SPACING;
      } else { need -= seg; px = cx; pz = cz; k--; }
    }
    while (out.length < n) {
      const last = out[out.length - 1] || [this.x, this.z, this.facing];
      out.push([last[0] - Math.sin(last[2]) * GUN_COLUMN_SPACING, last[1] - Math.cos(last[2]) * GUN_COLUMN_SPACING, last[2]]);
    }
    return out;
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
    const T = this.terrain;
    const s = FIGURE_SCALE;
    const fs = Math.sin(this.facing), fc = Math.cos(this.facing);
    const col = moving ? this.columnGunSlots() : null;
    const GP = this.gunPool;
    const gunMesh = GP.guns[this.side];
    this.gunSlots.forEach((g, gi) => {
      let tx, tz;
      if (col) [tx, tz] = col[gi]; else [tx, tz] = this.gunWorld(g);
      const dx = tx - g.x, dz = tz - g.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, (moving ? 9 : 4) * dt);
      if (d > 0.01) { g.x += (dx / d) * step; g.z += (dz / d) * step; }
      if (moving && d > 1) g.yaw += Math.atan2(Math.sin(Math.atan2(dx, dz) - g.yaw), Math.cos(Math.atan2(dx, dz) - g.yaw)) * Math.min(1, dt * 3);
      else if (!moving) g.yaw += Math.atan2(Math.sin(this.facing - g.yaw), Math.cos(this.facing - g.yaw)) * Math.min(1, dt * 2);
      const gy = T.heightAt(g.x, g.z);
      if (!g.alive) {
        GP.set(gunMesh, g.gun, g.x, gy, g.z, g.yaw + 0.5, s, 0.12);
        GP.hide(GP.limbers, g.limber);
        return;
      }
      // recoil: the piece jumps back and is run up again
      if (this.fireT !== undefined && this.fireT > g.fireT && this.fireT + gi * 0.11 <= time) g.fireT = this.fireT + gi * 0.11;
      const p = (time - g.fireT) / 1.1;
      g.recoil = p >= 0 && p < 1 ? (p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88) : 0;
      const gyaw = g.yaw;
      const gfs = Math.sin(gyaw), gfc = Math.cos(gyaw);
      const terrainPitch = Math.atan2(T.heightAt(g.x + gfs * 4, g.z + gfc * 4) - T.heightAt(g.x - gfs * 4, g.z - gfc * 4), 8);
      if (moving) {
        // hooked up: the limber ahead, horses leading; the gun trails with its muzzle to the rear
        GP.set(gunMesh, g.gun, g.x, gy, g.z, gyaw + Math.PI, s, -terrainPitch);
        const lx = g.x + gfs * LIMBER_AHEAD * s, lz = g.z + gfc * LIMBER_AHEAD * s;
        g.lmx = lx; g.lmz = lz; g.lmyaw = gyaw;
        GP.set(GP.limbers, g.limber, lx, T.heightAt(lx, lz), lz, gyaw, s, terrainPitch);
      } else {
        const rx = g.x - gfs * g.recoil * 1.3, rz = g.z - gfc * g.recoil * 1.3;
        GP.set(gunMesh, g.gun, rx, T.heightAt(rx, rz), rz, gyaw, s, terrainPitch);
        // the limber waits behind, facing the rear, and drifts back into place after a move
        const wx = g.x - fs * LIMBER_BACK, wz = g.z - fc * LIMBER_BACK;
        const ldx = wx - g.lmx, ldz = wz - g.lmz, ld = Math.hypot(ldx, ldz);
        const lstep = Math.min(ld, 6 * dt);
        if (ld > 0.01) { g.lmx += (ldx / ld) * lstep; g.lmz += (ldz / ld) * lstep; }
        const wantYaw = ld > 2 ? Math.atan2(ldx, ldz) : this.facing + Math.PI;
        g.lmyaw += Math.atan2(Math.sin(wantYaw - g.lmyaw), Math.cos(wantYaw - g.lmyaw)) * Math.min(1, dt * 2);
        GP.set(GP.limbers, g.limber, g.lmx, T.heightAt(g.lmx, g.lmz), g.lmz, g.lmyaw, s, 0);
      }
    });
    // drivers sit on the near-side horses of their limber
    for (const f of this.figures) {
      if (!f.mount || !f.alive) continue;
      const g = f.gun;
      const ms = Math.sin(g.lmyaw), mc = Math.cos(g.lmyaw);
      const lx = f.mount[0] * s, lz = f.mount[1] * s;
      f.x = g.lmx + mc * lx + ms * lz;
      f.z = g.lmz - ms * lx + mc * lz;
      f.yaw = g.lmyaw;
      f.mountY = (1.52 - 0.98) * s;
    }
    super.animate(dt, time);
  }

  volley() {
    return [];
  }
}

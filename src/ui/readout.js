// src/ui/readout.js: combat feedback on the field (DESIGN.md 4b "Combat feedback").
//
// Engagement lines (look.engagementLines): a faint ribbon from each unit that fired in the last few seconds
//   to its target, wider where its recent fire was heavier (unit.fireLoad, combat.js). One mesh, one draw
//   call, rebuilt each frame from the unit list (O(units)).
// Casualty numbers (look.casualtyTicks): once a second each unit that lost men shows a small number rising
//   from it (unit.tickAcc, gathered by Unit.takeLosses); a fixed pool of DOM spans, placed each frame.

import * as THREE from 'three';
import { LOOK } from './look.js';

const MAX_LINES = 64;
const TICK_POOL = 32;
const TICK_S = 1.6;
const SIDE_RGB = { US: [0.45, 0.65, 1.0], CS: [1.0, 0.42, 0.45] };
const _v = new THREE.Vector3();

export class Readout {
  constructor({ scene, terrain, camera, game, layer }) {
    Object.assign(this, { scene, terrain, camera, game });
    const pos = new Float32Array(MAX_LINES * 4 * 3);
    const col = new Float32Array(MAX_LINES * 4 * 4);
    const idx = [];
    for (let i = 0; i < MAX_LINES; i++) { const k = i * 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.name = 'engagement-lines';
    scene.add(this.mesh);

    this.layer = layer;
    this.ticks = [];
    for (let i = 0; i < TICK_POOL; i++) {
      const el = document.createElement('span');
      el.hidden = true;
      layer.appendChild(el);
      this.ticks.push({ el, age: TICK_S, x: 0, z: 0, y: 0 });
    }
    this.next = 0;
    this.tickT = 0;
  }

  /** dt real seconds; mpp metres per CSS pixel near the view centre. */
  update(dt, mpp) {
    this.lines(mpp);
    this.casualties(dt);
  }

  lines(mpp) {
    let n = 0;
    if (LOOK.engagementLines) {
      const P = this.pos.array, C = this.col.array, T = this.terrain;
      const now = this.game.simTime;
      for (const u of this.game.units) {
        if (n >= MAX_LINES) break;
        const t = u.target;
        if (!u.alive || !t || !t.alive || u.state === 'routing' || !(now - (u.fireT ?? -99) < 3.5)) continue;
        const ax = u.x, az = u.z, bx = t.x, bz = t.z;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 5) continue;
        const wpx = 1.5 + Math.min(6, (u.fireLoad || 0) / 6);
        const hw = (wpx * mpp) / 2;
        const nx = (-(bz - az) / len) * hw, nz = ((bx - ax) / len) * hw;
        const ya = T.heightAt(ax, az) + 4, yb = T.heightAt(bx, bz) + 4;
        const k = n * 12;
        P[k] = ax - nx; P[k + 1] = ya; P[k + 2] = az - nz;
        P[k + 3] = ax + nx; P[k + 4] = ya; P[k + 5] = az + nz;
        P[k + 6] = bx - nx; P[k + 7] = yb; P[k + 8] = bz - nz;
        P[k + 9] = bx + nx; P[k + 10] = yb; P[k + 11] = bz + nz;
        const [r, g, b] = SIDE_RGB[u.side] || SIDE_RGB.US;
        const a = 0.22 + Math.min(0.25, (u.fireLoad || 0) / 120);
        for (let v = 0; v < 4; v++) {
          const c = n * 16 + v * 4;
          C[c] = r; C[c + 1] = g; C[c + 2] = b; C[c + 3] = v < 2 ? a : a * 0.55; // fainter at the target end
        }
        n++;
      }
      if (n) { this.pos.needsUpdate = true; this.col.needsUpdate = true; }
    }
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }

  casualties(dt) {
    const on = LOOK.casualtyTicks;
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 1;
      for (const u of this.game.units) {
        const lost = Math.round(u.tickAcc || 0);
        if (lost >= 1 && on) this.spawn(u, lost);
        if (lost >= 1 || !on) u.tickAcc = 0;
      }
    }
    const w = window.innerWidth, h = window.innerHeight;
    for (const t of this.ticks) {
      if (t.age >= TICK_S) continue;
      t.age += dt;
      if (t.age >= TICK_S || !on) { t.el.hidden = true; t.age = TICK_S; continue; }
      _v.set(t.x, t.y, t.z).project(this.camera);
      if (_v.z > 1) { t.el.style.opacity = '0'; continue; }
      const x = (_v.x * 0.5 + 0.5) * w + t.dx, y = (-_v.y * 0.5 + 0.5) * h - 10 - t.age * 26;
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      t.el.style.opacity = String(Math.min(1, 2.2 * (1 - t.age / TICK_S)).toFixed(2));
    }
  }

  spawn(u, lost) {
    const t = this.ticks[this.next];
    this.next = (this.next + 1) % this.ticks.length;
    t.age = 0;
    t.x = u.x; t.z = u.z; t.y = this.terrain.heightAt(u.x, u.z) + 6;
    t.dx = ((u.id.length * 7 + lost) % 9) * 3 - 12; // a little sideways spread so neighbours do not stack
    t.el.textContent = `−${lost}`;
    t.el.className = u.side.toLowerCase();
    t.el.hidden = false;
    t.el.style.opacity = '0';
  }
}

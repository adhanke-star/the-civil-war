// src/units/halos.js: the state at each man's feet: a soft shadow blob under every figure, green when
// his brigade is selected, red while it is under fire (UG:G shows state on the ground, not on the bodies).
//
// One InstancedMesh of flat ellipses refilled every frame (push), drawn after the terrain with depth
// test but no depth write, slightly above the ground so the terrain mesh (0.5 m error) never clips it.

import * as THREE from 'three';

const SHADOW = [0.05, 0.04, 0.03, 0.34];
const SELECTED = [0.45, 1.0, 0.25, 0.8];
const UNDER_FIRE = [1.0, 0.2, 0.1, 0.75];

export class HaloPool {
  constructor(capacity) {
    const geo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.color.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHalo', this.color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 aHalo;
        varying vec4 vCol;
        varying vec2 vUv;
        void main() {
          vCol = aHalo;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vCol;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          // alpha above 1 marks a state halo (selected, under fire): a crisp rim and a lighter centre, so
          // neighbouring men's halos read as separate ellipses; the plain shadow blob stays soft
          float hard = step(1.5, vCol.a);
          float a0 = vCol.a - hard * 2.0;
          float soft = smoothstep(1.0, 0.45, r);
          float ring = smoothstep(1.0, 0.9, r) * (0.55 + 0.45 * smoothstep(0.55, 0.9, r));
          gl_FragColor = vec4(vCol.rgb, a0 * mix(soft, ring, hard));
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'halos';
    this.mesh.count = 0;
    this.capacity = capacity;
    this.n = 0;
  }

  begin() { this.n = 0; }

  /** kind: 0 shadow, 1 selected, 2 under fire (strength scales the red). */
  push(x, y, z, yaw, rx, rz, kind, strength = 1) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    const te = this.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    te[o] = c * rx; te[o + 1] = 0; te[o + 2] = -s * rx; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = 1; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = s * rz; te[o + 9] = 0; te[o + 10] = c * rz; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y + 0.7; te[o + 14] = z; te[o + 15] = 1;
    const col = kind === 1 ? SELECTED : kind === 2 ? UNDER_FIRE : SHADOW;
    const a = this.color.array;
    a[i * 4] = col[0]; a[i * 4 + 1] = col[1]; a[i * 4 + 2] = col[2]; a[i * 4 + 3] = col[3] * (kind === 2 ? strength : 1) + (kind ? 2 : 0);
  }

  flush() {
    this.mesh.count = this.n;
    if (!this.n) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}

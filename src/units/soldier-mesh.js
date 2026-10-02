// src/units/soldier-mesh.js: instanced soldiers with GPU-side walk, aim and muzzle-flash animation.
//
// One low-poly figure (~90 triangles) faces +Z. Per-vertex aPart picks the animated group (legs swing at
// the hip; arms and musket swing at the shoulder from "slope arms" to "aim"); aMat picks the colour slot
// (coat, trousers, fixed, musket tip). Per-instance attributes:
//   aAnim = (walk phase, walk amount, aim 0..1, muzzle flash 0..1)
//   aTint = (coat variation, trouser variation, selected 0..1, under fire 0..1)
// A side's uniforms give its coat and trouser colours (two of each, mixed per man).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FIGURE_SCALE = 3.0; // figures are enlarged so they read from the battle camera

const PART = { BODY: 0, LEG_L: 1, LEG_R: 2, ARMS: 3, MUSKET: 4 };
const MAT = { FIXED: 0, COAT: 1, TROUSER: 2, TIP: 3, HAT: 4 };

function piece(geo, part, mat, color, x, y, z) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  return g;
}

function buildFigureGeometry() {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const parts = [
    // legs (pivot at hip y=0.92)
    piece(B(0.16, 0.9, 0.18), PART.LEG_L, MAT.TROUSER, '#fff', -0.1, 0.46, 0),
    piece(B(0.16, 0.9, 0.18), PART.LEG_R, MAT.TROUSER, '#fff', 0.1, 0.46, 0),
    piece(B(0.17, 0.08, 0.26), PART.LEG_L, MAT.FIXED, '#2a2018', -0.1, 0.04, 0.04),
    piece(B(0.17, 0.08, 0.26), PART.LEG_R, MAT.FIXED, '#2a2018', 0.1, 0.04, 0.04),
    // torso, belt, head, hat, pack and blanket roll
    piece(B(0.46, 0.6, 0.27), PART.BODY, MAT.COAT, '#fff', 0, 1.2, 0),
    piece(B(0.48, 0.07, 0.29), PART.BODY, MAT.FIXED, '#2b2117', 0, 0.94, 0),
    piece(B(0.21, 0.24, 0.22), PART.BODY, MAT.FIXED, '#d2a07a', 0, 1.64, 0.01),
    piece(new THREE.CylinderGeometry(0.11, 0.125, 0.15, 7), PART.BODY, MAT.HAT, '#fff', 0, 1.82, -0.01),
    piece(B(0.22, 0.03, 0.12), PART.BODY, MAT.FIXED, '#1e1a16', 0, 1.75, 0.14),
    piece(B(0.36, 0.34, 0.14), PART.BODY, MAT.FIXED, '#2c241c', 0, 1.22, -0.2),
    piece(B(0.44, 0.1, 0.12), PART.BODY, MAT.FIXED, '#6b5a48', 0, 1.44, -0.22),
    // arms hang from the shoulder (pivot y=1.44) in the rest pose
    piece(B(0.12, 0.6, 0.13), PART.ARMS, MAT.COAT, '#fff', -0.29, 1.15, 0.02),
    piece(B(0.12, 0.6, 0.13), PART.ARMS, MAT.COAT, '#fff', 0.29, 1.15, 0.02),
    // musket modelled in the aim pose: along +Z at shoulder height, rotated to slope arms when marching
    piece(B(0.05, 0.07, 1.45), PART.MUSKET, MAT.FIXED, '#5b3b22', 0.14, 1.46, 0.42),
    piece(B(0.035, 0.035, 0.25), PART.MUSKET, MAT.TIP, '#9a9a9a', 0.14, 1.48, 1.2),
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

let sharedGeometry = null;
export function figureGeometry() {
  if (!sharedGeometry) sharedGeometry = buildFigureGeometry();
  return sharedGeometry;
}

const VERT_HEAD = /* glsl */ `
  attribute float aPart;
  attribute float aMat;
  attribute vec4 aAnim;
  attribute vec4 aTint;
  uniform vec3 uCoatA; uniform vec3 uCoatB; uniform vec3 uTrouserA; uniform vec3 uTrouserB; uniform vec3 uHat;
  varying float vEmit;
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 partRot(out vec3 pivot) {
    float walk = sin(aAnim.x) * 0.55 * aAnim.y;
    pivot = vec3(0.0);
    if (aPart > 0.5 && aPart < 1.5) { pivot = vec3(0.0, 0.92, 0.0); return rotX(walk); }
    if (aPart > 1.5 && aPart < 2.5) { pivot = vec3(0.0, 0.92, 0.0); return rotX(-walk); }
    if (aPart > 2.5 && aPart < 3.5) { pivot = vec3(0.0, 1.44, 0.0); return rotX(mix(-0.25 + walk * 0.3, -1.45, aAnim.z)); }
    if (aPart > 3.5) { pivot = vec3(0.0, 1.44, 0.0); return rotX(mix(-1.95, 0.0, aAnim.z)); }
    return mat3(1.0);
  }
`;

/** A Lambert material patched for the soldier animation and side colours. */
export function soldierMaterial({ coatA, coatB, trouserA, trouserB, hat }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.uniforms = {
    uCoatA: { value: new THREE.Color(coatA) },
    uCoatB: { value: new THREE.Color(coatB) },
    uTrouserA: { value: new THREE.Color(trouserA) },
    uTrouserB: { value: new THREE.Color(trouserB) },
    uHat: { value: new THREE.Color(hat) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 pivotN; mat3 prN = partRot(pivotN); objectNormal = prN * objectNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 pivotP; mat3 prP = partRot(pivotP);
        transformed = pivotP + prP * (transformed - pivotP);
        transformed.y += abs(sin(aAnim.x)) * 0.05 * aAnim.y;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        if (aMat > 0.5 && aMat < 1.5) vColor.rgb = mix(uCoatA, uCoatB, aTint.x);
        else if (aMat > 1.5 && aMat < 2.5) vColor.rgb = mix(uTrouserA, uTrouserB, aTint.y);
        else if (aMat > 3.5) vColor.rgb = mix(uHat, uCoatB, aTint.x * 0.5);
        vColor.rgb = mix(vColor.rgb, vColor.rgb * vec3(1.15, 1.45, 1.0) + vec3(0.02, 0.06, 0.0), aTint.z * 0.6);
        vColor.rgb = mix(vColor.rgb, vec3(0.9, 0.2, 0.12), aTint.w * 0.3);
        vEmit = (aMat > 2.5 && aMat < 3.5) ? aAnim.w : 0.0;`);
    shader.fragmentShader = 'varying float vEmit;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(9.0, 6.5, 2.5) * vEmit;',
    );
  };
  mat.customProgramCacheKey = () => 'soldier-v1';
  return mat;
}

/**
 * A pool of instanced figures for one side. Callers write per-figure state through set(); flush() uploads.
 */
export class SoldierPool {
  constructor(capacity, colors) {
    const geo = figureGeometry().clone();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', this.anim);
    geo.setAttribute('aTint', this.tint);
    this.mesh = new THREE.InstancedMesh(geo, soldierMaterial(colors), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.capacity = capacity;
    this.used = 0;
  }

  alloc() {
    if (this.used >= this.capacity) throw new Error('soldier pool full');
    return this.used++;
  }

  /** Write one figure: position, yaw (forward = (sin yaw, cos yaw)), scale, and animation state. */
  set(i, x, y, z, yaw, s, phase, walk, aim, flash) {
    const te = this.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    te[o] = c; te[o + 1] = 0; te[o + 2] = -sn; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = s; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    const a = this.anim.array;
    a[i * 4] = phase; a[i * 4 + 1] = walk; a[i * 4 + 2] = aim; a[i * 4 + 3] = flash;
  }

  /** Lying figure (casualty): on its back or side, feet toward `yaw`. */
  setFallen(i, x, y, z, yaw, s, roll) {
    const m = _m.makeRotationY(yaw);
    _m2.makeRotationX(-Math.PI / 2 + 0.08);
    m.multiply(_m2);
    _m2.makeRotationY(roll);
    m.multiply(_m2);
    m.scale(_s.set(s, s, s));
    m.setPosition(x, y + 0.25 * s, z);
    m.toArray(this.mesh.instanceMatrix.array, i * 16);
    const a = this.anim.array;
    a[i * 4] = 0; a[i * 4 + 1] = 0; a[i * 4 + 2] = roll > 0 ? 0.6 : 0; a[i * 4 + 3] = 0;
  }

  setTint(i, coatVar, trouserVar, selected, hurt) {
    const t = this.tint.array;
    t[i * 4] = coatVar; t[i * 4 + 1] = trouserVar; t[i * 4 + 2] = selected; t[i * 4 + 3] = hurt;
  }

  flush() {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.tint.needsUpdate = true;
  }
}
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();

export const UNIFORMS = {
  US: { coatA: '#26335a', coatB: '#2e3d6b', trouserA: '#6f86ad', trouserB: '#5a6f96', hat: '#222b48' },
  CS: { coatA: '#8d8a80', coatB: '#9a7a4e', trouserA: '#7d776a', trouserB: '#8a7050', hat: '#6e6658' },
};

// src/units/soldier-mesh.js: instanced soldiers animated on the GPU from the baked bone texture.
//
// A SoldierPool is one side's standing men: three InstancedMeshes (full, medium and far detail) that are
// refilled every frame by push(); each man goes to the bucket for his distance from the camera. A fourth
// and fifth mesh draw a 1-px dark outline around the near two levels (inverted hull along the smooth
// normals), which is what makes a 14-px figure read as a painted miniature against the grass. The
// FallenPool holds casualties at fixed indices in the lying poses.
//
// Per-instance attributes:
//   aAnim = (frame position A, frame position B, blend A->B, muzzle flash 0..1)
//   aTint = (coat variation, trouser variation, prop 0 none / 1 musket / 2 rammer, officer 0..1)
// Side uniforms give the coat, trouser, hat and officer colours (two coats and two trousers, mixed per man).

import * as THREE from 'three';
import { buildFigureGeometry, boneTexture, BONE_COUNT, CLIP_ROWS, fallenFrame } from './figure.js';

export const FIGURE_SCALE = 4.4; // UG:G-style: figures are enlarged so they read as individuals from the battle camera
export const LOD_NEAR = 300; // m from the camera: full detail inside, medium to LOD_FAR, far beyond
export const LOD_FAR = 700;
const OUTLINE_PX = { 2: 1.0, 1: 0.75, 0: 0.6 }; // outline width per level, in render pixels

const BONE_GLSL = /* glsl */ `
  attribute float aBone;
  attribute float aMat;
  attribute float aProp;
  attribute float aAo;
  attribute vec3 aSmoothN;
  attribute vec4 aAnim;
  attribute vec4 aTint;
  uniform sampler2D uBones;
  mat4 boneRow(int col, int row) {
    vec4 r0 = texelFetch(uBones, ivec2(col, row), 0);
    vec4 r1 = texelFetch(uBones, ivec2(col + 1, row), 0);
    vec4 r2 = texelFetch(uBones, ivec2(col + 2, row), 0);
    return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0), vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));
  }
  mat4 boneAt(int col, float p) {
    int i0 = int(floor(p));
    float t = p - float(i0);
    mat4 a = boneRow(col, i0);
    if (t < 0.001) return a;
    mat4 b = boneRow(col, i0 + 1);
    return a + (b - a) * t;
  }
  mat4 boneMatrix() {
    int col = int(aBone + 0.5) * 3;
    mat4 m = boneAt(col, aAnim.x);
    if (aAnim.z > 0.001) m = m + (boneAt(col, aAnim.y) - m) * aAnim.z;
    return m;
  }
  bool propHidden() { return aProp > 0.5 && abs(aProp - aTint.z) > 0.5; }
`;

function patchVertex(shader, outline) {
  shader.vertexShader = BONE_GLSL + (outline ? 'uniform float uPx;\n' : '') + shader.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      mat4 bm = boneMatrix();
      objectNormal = mat3(bm) * objectNormal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${outline ? 'mat4 bm = boneMatrix();' : ''}
      if (propHidden()) transformed = vec3(0.0, 0.3, 0.0);
      transformed = (bm * vec4(transformed, 1.0)).xyz;
      ${outline ? `
      vec3 nS = normalize(mat3(bm) * aSmoothN);
      float isc = length(instanceMatrix[0].xyz);
      float depthI = -(modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).z;
      transformed += nS * (depthI * uPx / max(isc, 0.0001));` : ''}`);
}

/** A Lambert material patched for bone animation, side colours, the baked shade and a rim darkening. */
export function soldierMaterial({ coatA, coatB, trouserA, trouserB, hat, officerCoat = '#1c2136', officerTrouser = '#2a3350' }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.uniforms = {
    uBones: { value: boneTexture() },
    uCoatA: { value: new THREE.Color(coatA) },
    uCoatB: { value: new THREE.Color(coatB) },
    uTrouserA: { value: new THREE.Color(trouserA) },
    uTrouserB: { value: new THREE.Color(trouserB) },
    uHat: { value: new THREE.Color(hat) },
    uOfficerCoat: { value: new THREE.Color(officerCoat) },
    uOfficerTrouser: { value: new THREE.Color(officerTrouser) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = 'uniform vec3 uCoatA; uniform vec3 uCoatB; uniform vec3 uTrouserA; uniform vec3 uTrouserB; uniform vec3 uHat; uniform vec3 uOfficerCoat; uniform vec3 uOfficerTrouser;\nvarying float vEmit;\n' + shader.vertexShader;
    patchVertex(shader, false);
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        if (aMat > 0.5 && aMat < 1.5) vColor.rgb = mix(mix(uCoatA, uCoatB, aTint.x), uOfficerCoat, aTint.w);
        else if (aMat > 1.5 && aMat < 2.5) vColor.rgb = mix(mix(uTrouserA, uTrouserB, aTint.y), uOfficerTrouser, aTint.w);
        else if (aMat > 3.5 && aMat < 4.5) vColor.rgb = mix(uHat, uCoatB, aTint.x * 0.35);
        vColor.rgb *= aAo;
        vEmit = (aMat > 2.5 && aMat < 3.5) ? aAnim.w : 0.0;`);
    shader.fragmentShader = 'varying float vEmit;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
        diffuseColor.rgb *= 1.0 - 0.2 * rim;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(9.0, 6.5, 2.5) * vEmit;');
  };
  mat.customProgramCacheKey = () => 'soldier-v2';
  return mat;
}

/** The outline hull: back faces pushed out ~1 px along the posed smooth normals, drawn dark. */
export function outlineMaterial(px = 1) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1c1711'), side: THREE.BackSide });
  mat.userData.uniforms = { uBones: { value: boneTexture() }, uPx: { value: 0.001 } };
  mat.userData.px = px;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    patchVertex(shader, true);
  };
  mat.customProgramCacheKey = () => 'soldier-outline-v2';
  return mat;
}

function instancedGeometry(base, anim, tint) {
  const geo = base.clone();
  geo.setAttribute('aAnim', anim);
  geo.setAttribute('aTint', tint);
  return geo;
}

function makeBuffers(capacity) {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  tint.setUsage(THREE.DynamicDrawUsage);
  return { anim, tint };
}

const geoCache = new Map();
export function figureGeometry(lod, kit) {
  const k = `${lod}:${kit}`;
  if (!geoCache.has(k)) geoCache.set(k, buildFigureGeometry(lod, kit));
  return geoCache.get(k);
}

/**
 * One side's standing figures. Each frame: begin(), push() every man, flush(). Men are bucketed by
 * their distance from the camera into three levels of detail; the near two also get an outline pass.
 */
export class SoldierPool {
  constructor(capacity, colors, { kit = 'US', outline = true } = {}) {
    this.capacity = capacity;
    this.kit = kit;
    this.material = soldierMaterial(colors);
    this.outline = outline;
    this.buckets = [];
    this.group = new THREE.Group();
    this.group.name = `soldiers-${kit}`;
    for (let lod = 2; lod >= 0; lod--) {
      const { anim, tint } = makeBuffers(capacity);
      const geo = instancedGeometry(figureGeometry(lod, kit), anim, tint);
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `soldiers-${kit}-lod${lod}`;
      this.group.add(mesh);
      const b = { lod, mesh, anim, tint, n: 0, outline: null };
      if (outline) {
        const o = new THREE.InstancedMesh(geo, outlineMaterial(OUTLINE_PX[lod]), capacity);
        o.instanceMatrix = mesh.instanceMatrix; // share the per-instance buffers
        o.frustumCulled = false;
        o.count = 0;
        o.name = `${mesh.name}-outline`;
        this.group.add(o);
        b.outline = o;
      }
      this.buckets.push(b);
    }
    this.cam = new THREE.Vector3(0, 800, 0);
    this.pushed = 0;
    this.triangles = { 2: figureGeometry(2, kit).userData.triangles, 1: figureGeometry(1, kit).userData.triangles, 0: figureGeometry(0, kit).userData.triangles };
  }

  get mesh() { return this.group; }

  /** Camera position (for the level of detail) and the world size of one render pixel (for the outline). */
  setView(camera, renderHeightPx) {
    this.cam.copy(camera.position);
    const px = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, renderHeightPx);
    for (const b of this.buckets) if (b.outline) b.outline.material.userData.uniforms.uPx.value = px * b.outline.material.userData.px;
  }

  begin() {
    for (const b of this.buckets) b.n = 0;
    this.pushed = 0;
  }

  /** One figure: position, yaw (forward = (sin yaw, cos yaw)), scale, frames A/B + blend, flash, tint. */
  push(x, y, z, yaw, s, posA, posB, blend, flash, coatVar, trouserVar, prop, officer) {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const b = d2 < LOD_NEAR * LOD_NEAR ? this.buckets[0] : d2 < LOD_FAR * LOD_FAR ? this.buckets[1] : this.buckets[2];
    if (b.n >= this.capacity) return;
    const i = b.n++;
    const te = b.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    te[o] = c; te[o + 1] = 0; te[o + 2] = -sn; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = s; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    const a = b.anim.array;
    a[i * 4] = posA; a[i * 4 + 1] = posB; a[i * 4 + 2] = blend; a[i * 4 + 3] = flash;
    const t = b.tint.array;
    t[i * 4] = coatVar; t[i * 4 + 1] = trouserVar; t[i * 4 + 2] = prop; t[i * 4 + 3] = officer;
    this.pushed++;
  }

  flush() {
    for (const b of this.buckets) {
      b.mesh.count = b.n;
      if (b.outline) b.outline.count = b.n;
      if (!b.n) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.anim.needsUpdate = true;
      b.tint.needsUpdate = true;
    }
  }

  /** Triangles submitted this frame (for the stats line). */
  trianglesDrawn() {
    let t = 0;
    for (const b of this.buckets) t += b.n * this.triangles[b.lod] * (b.outline ? 2 : 1);
    return t;
  }

  setOutline(on) {
    for (const b of this.buckets) if (b.outline) b.outline.visible = on;
  }
}

/** Casualties: fixed-index instances in a lying pose (medium detail, no outline). */
export class FallenPool {
  constructor(capacity, colors, { kit = 'US' } = {}) {
    const { anim, tint } = makeBuffers(capacity);
    this.anim = anim;
    this.tint = tint;
    const geo = instancedGeometry(figureGeometry(1, kit), anim, tint);
    this.material = soldierMaterial(colors);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = `fallen-${kit}`;
    this.capacity = capacity;
    this.used = 0;
    this.dirty = false;
  }

  alloc() {
    if (this.used >= this.capacity) return -1;
    return this.used++;
  }

  /** A lying man: feet toward `yaw`, on his back (front=false) or face down. */
  set(i, x, y, z, yaw, s, front, coatVar, trouserVar) {
    const te = this.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    te[o] = c; te[o + 1] = 0; te[o + 2] = -sn; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = s; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    const a = this.anim.array;
    const p = fallenFrame(front);
    a[i * 4] = p; a[i * 4 + 1] = p; a[i * 4 + 2] = 0; a[i * 4 + 3] = 0;
    const t = this.tint.array;
    t[i * 4] = coatVar; t[i * 4 + 1] = trouserVar; t[i * 4 + 2] = 1; t[i * 4 + 3] = 0;
    this.dirty = true;
  }

  flush() {
    this.mesh.count = this.used;
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.dirty = false;
  }
}

export const UNIFORMS = {
  US: { coatA: '#253a78', coatB: '#2d4488', trouserA: '#8ea6d2', trouserB: '#7892bd', hat: '#1f2f62', officerCoat: '#1a2650', officerTrouser: '#3a4a78' },
  CS: { coatA: '#a09c90', coatB: '#b08f5e', trouserA: '#9a9280', trouserB: '#8a7050', hat: '#7a7266', officerCoat: '#7a7a74', officerTrouser: '#8a90a0' },
};

export { BONE_COUNT, CLIP_ROWS };

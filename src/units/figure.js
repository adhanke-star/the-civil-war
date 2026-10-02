// src/units/figure.js: the soldier figure: a 12-bone rig, three levels of detail, and the animation clips
// baked into a bone texture.
//
// The figure is hand-built from boxes and low-segment cylinders (about 420 triangles at the top detail)
// and faces +Z at life size in metres; the pool scales it by FIGURE_SCALE. Every vertex carries the index
// of the bone that moves it (aBone), its colour slot (aMat: coat, trousers, hat, fixed...), which prop it
// belongs to (aProp: 0 body, 1 musket, 2 rammer), a baked shade (aAo: feet dark, head light) and a smooth
// normal for the outline pass (aSmoothN).
//
// Clips (walk, run, charge, aim, fire, load, stand, ride, crew poses, two falls) are keyframed here as
// per-bone Euler rotations, composed through the hierarchy and written as 3x4 object-space matrices
// into one float texture: column = bone * 3 + row, row = frame. The vertex shader fetches two rows and
// interpolates, so one draw call per pool animates every man from a per-instance frame position
// (see soldier-mesh.js). Each clip is followed by one duplicate row so the fetch of frame+1 never
// leaves the clip.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAT = { FIXED: 0, COAT: 1, TROUSER: 2, TIP: 3, HAT: 4, FACE: 5 };
export const PROP = { BODY: 0, MUSKET: 1, RAMMER: 2 };

// Bone pivots in the rest pose (metres, life size). Children are listed after their parents.
export const BONES = [
  { name: 'root', parent: -1, pivot: [0, 0.98, 0] },
  { name: 'torso', parent: 0, pivot: [0, 1.0, 0] },
  { name: 'head', parent: 1, pivot: [0, 1.5, 0] },
  { name: 'armUL', parent: 1, pivot: [-0.25, 1.42, 0] },
  { name: 'armLL', parent: 3, pivot: [-0.25, 1.14, 0] },
  { name: 'armUR', parent: 1, pivot: [0.25, 1.42, 0] },
  { name: 'armLR', parent: 5, pivot: [0.25, 1.14, 0] },
  { name: 'legUL', parent: 0, pivot: [-0.1, 0.95, 0] },
  { name: 'legLL', parent: 7, pivot: [-0.1, 0.5, 0] },
  { name: 'legUR', parent: 0, pivot: [0.1, 0.95, 0] },
  { name: 'legLR', parent: 9, pivot: [0.1, 0.5, 0] },
  { name: 'prop', parent: 1, pivot: [0, 0, 0] }, // musket or rammer: posed by position + rotation in body space
];
const B = Object.fromEntries(BONES.map((b, i) => [b.name, i]));
export const BONE_COUNT = BONES.length;

// ---------------------------------------------------------------------------------------------------
// Geometry
function tag(geo, { bone, mat = MAT.FIXED, prop = PROP.BODY, color = '#888' }) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(n).fill(bone), 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  g.setAttribute('aProp', new THREE.BufferAttribute(new Float32Array(n).fill(prop), 1));
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** Open-ended cylinder (the caps hide inside joints and cost a triangle per segment each). */
const cyl = (rt, rb, h, seg = 5, open = true) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
/** A limb segment hanging from pivot (px, py, pz) down its length. */
function limb(r1, r2, len, px, py, pz, opts, seg = 5) {
  const g = cyl(r1, r2, len, seg);
  g.translate(px, py - len / 2, pz);
  return tag(g, opts);
}
/** A box limb for the medium level of detail. */
function limbBox(w, len, d, px, py, pz, opts) {
  return tag(box(w, len, d).translate(px, py - len / 2, pz), opts);
}

const COL = {
  skin: '#d9a784', hair: '#2a1e14', shoe: '#1f1a16', leather: '#2b2117', wood: '#5b3b22', steel: '#9a9a9a',
  canvas: '#cdc3a8', tin: '#8e9398', blanket: '#8a7f6a', pack: '#2c241c',
};

/**
 * Build the figure at a level of detail: 2 = full (~350 tris), 1 = medium (~200), 0 = far (~100).
 * `kit`: 'US' (knapsack and blanket roll, kepi) or 'CS' (blanket roll across the chest, slouch hat).
 */
export function buildFigureGeometry(lod = 2, kit = 'US') {
  const P = [];
  const push = (g) => P.push(g);
  const L = { UL: B.legUL, LL: B.legLL, UR: B.legUR, LR: B.legLR };
  const A = { UL: B.armUL, LL: B.armLL, UR: B.armUR, LR: B.armLR };

  if (lod === 2) {
    for (const s of [-1, 1]) {
      const x = s * 0.1, u = s < 0 ? L.UL : L.UR, l = s < 0 ? L.LL : L.LR;
      push(limb(0.085, 0.07, 0.47, x, 0.95, 0, { bone: u, mat: MAT.TROUSER }));
      push(limb(0.068, 0.055, 0.46, x, 0.5, 0, { bone: l, mat: MAT.TROUSER }));
      push(tag(box(0.12, 0.08, 0.28).translate(x, 0.04, 0.05), { bone: l, color: COL.shoe }));
    }
    push(tag(box(0.44, 0.52, 0.26).translate(0, 1.19, 0), { bone: B.torso, mat: MAT.COAT }));
    push(tag(box(0.46, 0.08, 0.28).translate(0, 0.96, 0), { bone: B.torso, color: COL.leather }));
    push(tag(box(0.14, 0.1, 0.06).translate(0.2, 0.98, -0.16), { bone: B.torso, color: COL.leather }));
    push(tag(box(0.18, 0.16, 0.07).translate(-0.26, 0.98, 0.03), { bone: B.torso, color: COL.canvas }));
    push(tag(box(0.12, 0.12, 0.05).translate(-0.27, 1.02, -0.1), { bone: B.torso, color: COL.tin }));
    push(tag(box(0.05, 0.5, 0.02).rotateZ(-0.45).translate(0.06, 1.2, 0.14), { bone: B.torso, color: COL.leather }));
    if (kit === 'US') {
      push(tag(box(0.34, 0.3, 0.13).translate(0, 1.22, -0.2), { bone: B.torso, color: COL.pack }));
      push(tag(cyl(0.06, 0.06, 0.4, 5).rotateZ(Math.PI / 2).translate(0, 1.42, -0.2), { bone: B.torso, color: COL.blanket }));
    } else {
      push(tag(cyl(0.065, 0.065, 0.62, 5).rotateZ(0.95).translate(0.0, 1.2, 0.12), { bone: B.torso, color: COL.blanket }));
      push(tag(cyl(0.065, 0.065, 0.62, 5).rotateZ(-0.95).translate(0.0, 1.2, -0.14), { bone: B.torso, color: COL.blanket }));
    }
    for (const s of [-1, 1]) {
      const x = s * 0.25, u = s < 0 ? A.UL : A.UR, l = s < 0 ? A.LL : A.LR;
      push(limb(0.062, 0.055, 0.3, x, 1.42, 0, { bone: u, mat: MAT.COAT }));
      push(limb(0.052, 0.045, 0.27, x, 1.14, 0, { bone: l, mat: MAT.COAT }));
      push(tag(box(0.08, 0.1, 0.09).translate(x, 0.84, 0), { bone: l, mat: MAT.FACE, color: COL.skin }));
    }
    push(tag(box(0.19, 0.22, 0.2).translate(0, 1.64, 0.01), { bone: B.head, mat: MAT.FACE, color: COL.skin }));
    push(tag(box(0.2, 0.2, 0.08).translate(0, 1.63, -0.1), { bone: B.head, color: COL.hair }));
    push(tag(cyl(0.06, 0.07, 0.08, 4), { bone: B.head, mat: MAT.FACE, color: COL.skin }).translate(0, 1.5, 0));
    if (kit === 'US') {
      push(tag(cyl(0.115, 0.105, 0.11, 6, false).translate(0, 1.8, -0.005), { bone: B.head, mat: MAT.HAT }));
      push(tag(box(0.2, 0.025, 0.11).translate(0, 1.75, 0.13), { bone: B.head, color: COL.shoe }));
    } else {
      push(tag(cyl(0.2, 0.21, 0.025, 6, false).translate(0, 1.75, 0), { bone: B.head, mat: MAT.HAT }));
      push(tag(cyl(0.1, 0.115, 0.14, 6, false).translate(0, 1.82, 0), { bone: B.head, mat: MAT.HAT }));
    }
    // musket: stock, butt, barrel, muzzle
    push(tag(box(0.04, 0.07, 0.75).translate(0, -0.01, -0.12), { bone: B.prop, prop: PROP.MUSKET, color: COL.wood }));
    push(tag(box(0.045, 0.1, 0.3).translate(0, -0.04, -0.4), { bone: B.prop, prop: PROP.MUSKET, color: COL.wood }));
    push(tag(cyl(0.016, 0.02, 0.95, 4).rotateX(Math.PI / 2).translate(0, 0.02, 0.42), { bone: B.prop, prop: PROP.MUSKET, color: COL.steel }));
    push(tag(box(0.04, 0.04, 0.1).translate(0, 0.02, 0.9), { bone: B.prop, prop: PROP.MUSKET, mat: MAT.TIP, color: COL.steel }));
    push(tag(cyl(0.02, 0.02, 2.0, 4).rotateX(Math.PI / 2).translate(0, 0, 0.1), { bone: B.prop, prop: PROP.RAMMER, color: COL.wood }));
    push(tag(cyl(0.06, 0.06, 0.2, 4).rotateX(Math.PI / 2).translate(0, 0, 1.05), { bone: B.prop, prop: PROP.RAMMER, color: COL.canvas }));
  } else if (lod === 1) {
    for (const s of [-1, 1]) {
      const x = s * 0.1, u = s < 0 ? L.UL : L.UR, l = s < 0 ? L.LL : L.LR;
      push(limbBox(0.16, 0.47, 0.17, x, 0.95, 0, { bone: u, mat: MAT.TROUSER }));
      push(limbBox(0.13, 0.5, 0.15, x, 0.5, 0.01, { bone: l, mat: MAT.TROUSER }));
    }
    push(tag(box(0.44, 0.52, 0.26).translate(0, 1.19, 0), { bone: B.torso, mat: MAT.COAT }));
    push(tag(box(0.46, 0.08, 0.28).translate(0, 0.96, 0), { bone: B.torso, color: COL.leather }));
    if (kit === 'US') {
      push(tag(box(0.34, 0.3, 0.13).translate(0, 1.22, -0.2), { bone: B.torso, color: COL.pack }));
      push(tag(box(0.4, 0.11, 0.11).translate(0, 1.42, -0.2), { bone: B.torso, color: COL.blanket }));
    } else {
      push(tag(box(0.12, 0.6, 0.12).rotateZ(0.95).translate(0.0, 1.2, 0.12), { bone: B.torso, color: COL.blanket }));
    }
    for (const s of [-1, 1]) {
      const x = s * 0.25, u = s < 0 ? A.UL : A.UR, l = s < 0 ? A.LL : A.LR;
      push(limbBox(0.12, 0.3, 0.12, x, 1.42, 0, { bone: u, mat: MAT.COAT }));
      push(limbBox(0.1, 0.36, 0.1, x, 1.14, 0, { bone: l, mat: MAT.COAT }));
    }
    push(tag(box(0.19, 0.22, 0.2).translate(0, 1.64, 0.01), { bone: B.head, mat: MAT.FACE, color: COL.skin }));
    push(tag(box(0.2, 0.2, 0.08).translate(0, 1.63, -0.1), { bone: B.head, color: COL.hair }));
    if (kit === 'US') {
      push(tag(box(0.22, 0.11, 0.21).translate(0, 1.8, 0), { bone: B.head, mat: MAT.HAT }));
      push(tag(box(0.2, 0.025, 0.11).translate(0, 1.75, 0.13), { bone: B.head, color: COL.shoe }));
    } else {
      push(tag(box(0.4, 0.03, 0.4).translate(0, 1.75, 0), { bone: B.head, mat: MAT.HAT }));
      push(tag(box(0.21, 0.14, 0.21).translate(0, 1.82, 0), { bone: B.head, mat: MAT.HAT }));
    }
    push(tag(box(0.04, 0.08, 1.05).translate(0, -0.02, -0.1), { bone: B.prop, prop: PROP.MUSKET, color: COL.wood }));
    push(tag(box(0.035, 0.035, 0.6).translate(0, 0.02, 0.6), { bone: B.prop, prop: PROP.MUSKET, mat: MAT.TIP, color: COL.steel }));
    push(tag(box(0.04, 0.04, 2.0).translate(0, 0, 0.1), { bone: B.prop, prop: PROP.RAMMER, color: COL.wood }));
  } else {
    // far: a box per limb (thigh and upper arm bones only), torso, head, hat, a one-box musket
    for (const s of [-1, 1]) {
      push(tag(box(0.15, 0.95, 0.16).translate(s * 0.1, 0.48, 0), { bone: s < 0 ? L.UL : L.UR, mat: MAT.TROUSER }));
      push(tag(box(0.11, 0.6, 0.12).translate(s * 0.27, 1.12, 0), { bone: s < 0 ? A.UL : A.UR, mat: MAT.COAT }));
    }
    push(tag(box(0.46, 0.56, 0.3).translate(0, 1.2, -0.02), { bone: B.torso, mat: MAT.COAT }));
    push(tag(box(0.2, 0.24, 0.22).translate(0, 1.64, 0), { bone: B.head, mat: MAT.FACE, color: COL.skin }));
    if (kit === 'US') push(tag(box(0.22, 0.11, 0.22).translate(0, 1.8, 0), { bone: B.head, mat: MAT.HAT }));
    else push(tag(box(0.4, 0.05, 0.4).translate(0, 1.76, 0), { bone: B.head, mat: MAT.HAT }));
    push(tag(box(0.05, 0.07, 1.4).translate(0, 0, 0.1), { bone: B.prop, prop: PROP.MUSKET, color: '#4a3220' }));
  }

  const g = mergeGeometries(P, false);
  g.computeVertexNormals(); // non-indexed: face normals (the painted-miniature facets)
  // baked shade: feet dark, head bright
  const pos = g.attributes.position;
  const n = pos.count;
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = 0.62 + 0.38 * THREE.MathUtils.clamp(pos.getY(i) / 1.6, 0, 1);
  g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  // smooth normals for the outline hull (merge coincident positions, average their face normals)
  const smooth = new Float32Array(n * 3);
  const idxGeo = mergeVertices(g.clone(), 1e-4);
  idxGeo.computeVertexNormals();
  const sn = idxGeo.attributes.normal;
  const ip = idxGeo.attributes.position;
  const key = new Map();
  for (let i = 0; i < ip.count; i++) key.set(`${ip.getX(i).toFixed(4)},${ip.getY(i).toFixed(4)},${ip.getZ(i).toFixed(4)}`, i);
  for (let i = 0; i < n; i++) {
    const j = key.get(`${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`);
    if (j === undefined) { smooth[i * 3] = g.attributes.normal.getX(i); smooth[i * 3 + 1] = g.attributes.normal.getY(i); smooth[i * 3 + 2] = g.attributes.normal.getZ(i); continue; }
    smooth[i * 3] = sn.getX(j); smooth[i * 3 + 1] = sn.getY(j); smooth[i * 3 + 2] = sn.getZ(j);
  }
  g.setAttribute('aSmoothN', new THREE.BufferAttribute(smooth, 3));
  g.computeBoundingSphere();
  g.userData.triangles = n / 3;
  return g;
}

// ---------------------------------------------------------------------------------------------------
// Clips. A pose is { boneName: [rx, ry, rz] } with 'root' also taking a y offset ([rx, ry, rz, dy]) and
// 'prop' taking [rx, ry, rz, px, py, pz] (position in body space). Angles in radians.
// Signs: for a hanging limb, a negative x swings the foot/hand forward (+Z); for the torso and head,
// a positive x leans forward; for the prop (+Z axis), a negative x lifts the muzzle.
const TAU = Math.PI * 2;

const SLOPE = { prop: [-2.0, 0, 0.08, 0.26, 1.46, -0.04], armUR: [-0.35, 0, 0.1], armLR: [-0.75, 0, 0] };
const AIM = {
  torso: [0.06, -0.35, 0], head: [0.15, 0.3, -0.1],
  prop: [0, 0, 0, 0.17, 1.4, 0.3],
  armUR: [-0.4, 0, 1.15], armLR: [-1.55, 0, 0.1],
  armUL: [-1.25, 0, 0.55], armLL: [-0.35, 0, 0],
  legUL: [-0.15, 0, -0.1], legUR: [0.25, 0, 0.12], legLR: [0.1, 0, 0],
};
const walkFrame = (t, { stride = 0.55, knee = 0.9, bob = 0.03, lean = 0, armSwing = 0.45, arms = SLOPE, extra = {} }) => {
  const s = Math.sin(t * TAU);
  const kneeL = knee * Math.max(0, Math.sin(t * TAU + 2.2));
  const kneeR = knee * Math.max(0, Math.sin(t * TAU + 2.2 + Math.PI));
  return {
    root: [0, 0, 0, bob * Math.abs(Math.sin(t * TAU * 2 + 0.3))],
    torso: [lean, 0.06 * s, 0],
    head: [-lean * 0.6, 0, 0],
    legUL: [-stride * s, 0, 0], legLL: [kneeL, 0, 0],
    legUR: [stride * s, 0, 0], legLR: [kneeR, 0, 0],
    armUL: [armSwing * s * 0.8, 0, 0.1], armLL: [-0.25 - 0.15 * s, 0, 0],
    ...arms,
    ...extra,
  };
};
const PORT = { prop: [-0.95, 0.15, 0.55, 0.0, 1.22, 0.3], armUL: [-1.35, 0, 0.5], armLL: [-0.5, 0, 0], armUR: [-0.85, 0, 0.1], armLR: [-1.05, 0, 0] };
const CHARGE = { prop: [0.22, -0.1, 0, 0.17, 1.02, 0.52], armUL: [-1.2, 0, 0.6], armLL: [-0.2, 0, 0], armUR: [-0.5, 0, 0.2], armLR: [-0.9, 0, 0] };
const loop = (n, fn) => { const f = []; for (let i = 0; i < n; i++) f.push(fn(i / n)); return f; };
const ease = (t) => t * t * (3 - 2 * t);
const lerpPose = (a, b, t) => {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k] || [0, 0, 0], vb = b[k] || [0, 0, 0];
    const m = Math.max(va.length, vb.length);
    out[k] = [];
    for (let i = 0; i < m; i++) out[k].push((va[i] ?? 0) + ((vb[i] ?? 0) - (va[i] ?? 0)) * t);
  }
  return out;
};
const FALL_BACK = {
  root: [-1.5, 0, 0.15, -0.86], torso: [-0.1, 0, 0], head: [-0.3, 0.2, 0],
  armUL: [-0.4, 0, -1.4], armLL: [-0.6, 0, 0], armUR: [-1.2, 0, 1.0], armLR: [-0.8, 0, 0],
  legUL: [0.1, 0, -0.3], legLL: [0.7, 0, 0], legUR: [-0.2, 0, 0.35], legLR: [0.2, 0, 0],
  prop: [-1.6, 0.4, 0.3, 0.45, 0.95, 0.1],
};
const FALL_FRONT = {
  root: [1.55, 0, -0.1, -0.86], torso: [0.1, 0, 0], head: [0.4, -0.3, 0],
  armUL: [-2.6, 0, -0.5], armLL: [-0.3, 0, 0], armUR: [-2.4, 0, 0.9], armLR: [-0.5, 0, 0],
  legUL: [0, 0, -0.2], legLL: [0.1, 0, 0], legUR: [-0.15, 0, 0.3], legLR: [0.5, 0, 0],
  prop: [0.1, 0.7, 0, -0.5, 0.95, 0.4],
};
const STAND = { ...SLOPE, legUL: [0, 0, -0.06], legUR: [0, 0, 0.06], armUL: [0, 0, 0.08] };

const CLIP_DEFS = [
  { name: 'stand', loop: true, frames: [STAND, { ...STAND, root: [0, 0, 0, 0.01], torso: [0.02, 0, 0] }] },
  { name: 'walk', loop: true, frames: loop(8, (t) => walkFrame(t, {})) },
  { name: 'run', loop: true, frames: loop(8, (t) => walkFrame(t, { stride: 0.85, knee: 1.5, bob: 0.06, lean: 0.28, arms: PORT })) },
  { name: 'charge', loop: true, frames: loop(8, (t) => walkFrame(t, { stride: 0.85, knee: 1.5, bob: 0.06, lean: 0.35, arms: CHARGE })) },
  { name: 'aim', loop: false, frames: [AIM] },
  { name: 'fire', loop: false, frames: [AIM, { ...AIM, torso: [-0.06, -0.35, 0], head: [0.05, 0.3, -0.1], prop: [-0.03, 0, 0, 0.17, 1.41, 0.2] }, AIM] },
  { name: 'load', loop: false, frames: [{
    torso: [0.08, 0.1, 0], head: [0.3, 0, 0],
    prop: [-1.57, 0, 0, -0.12, 1.1, 0.34],
    armUL: [-0.95, 0, 0.35], armLL: [-0.55, 0, 0],
    armUR: [-2.7, 0, 0.1], armLR: [0.4, 0, 0],
    legUL: [0, 0, -0.1], legUR: [0, 0, 0.1],
  }] },
  { name: 'ride', loop: true, frames: [
    { torso: [0.05, 0, 0], legUL: [-1.1, 0, -0.42], legLL: [1.35, 0, 0], legUR: [-1.1, 0, 0.42], legLR: [1.35, 0, 0], armUL: [-0.75, 0, 0.1], armLL: [-0.6, 0, 0], armUR: [-0.75, 0, -0.1], armLR: [-0.6, 0, 0] },
    { root: [0, 0, 0, 0.02], torso: [0.08, 0, 0], legUL: [-1.1, 0, -0.42], legLL: [1.35, 0, 0], legUR: [-1.1, 0, 0.42], legLR: [1.35, 0, 0], armUL: [-0.7, 0, 0.1], armLL: [-0.65, 0, 0], armUR: [-0.7, 0, -0.1], armLR: [-0.65, 0, 0] },
  ] },
  { name: 'crew', loop: false, frames: [{ legUL: [0, 0, -0.12], legUR: [0, 0, 0.12], armUL: [0.1, 0, 0.1], armUR: [0.1, 0, -0.1], armLL: [-0.3, 0, 0], armLR: [-0.3, 0, 0], torso: [0.04, 0.2, 0] }] },
  { name: 'crew-ram', loop: false, frames: [{ prop: [0, 0, 0, 0.0, 1.05, 0.55], armUL: [-1.05, 0, 0.3], armLL: [-0.35, 0, 0], armUR: [-1.05, 0, -0.3], armLR: [-0.35, 0, 0], torso: [0.12, 0, 0], legUL: [-0.35, 0, -0.1], legUR: [0.3, 0, 0.1], legLR: [0.2, 0, 0] }] },
  { name: 'crew-gunner', loop: false, frames: [{ torso: [0.3, 0, 0], head: [0.25, 0, 0], armUL: [-0.9, 0, 0.2], armLL: [-0.9, 0, 0], armUR: [-0.3, 0, -0.2], armLR: [-0.4, 0, 0], legUL: [-0.2, 0, -0.15], legUR: [0.25, 0, 0.15], legLR: [0.3, 0, 0] }] },
  { name: 'fall-back', loop: false, frames: [0, 0.2, 0.45, 0.7, 0.88, 1].map((t) => lerpPose(STAND, FALL_BACK, ease(t))) },
  { name: 'fall-front', loop: false, frames: [0, 0.2, 0.45, 0.7, 0.88, 1].map((t) => lerpPose(STAND, FALL_FRONT, ease(t))) },
];

/** Clip table: name -> { start, frames, loop }. Frame positions are rows of the bone texture. */
export const CLIPS = {};
let rows = 0;
for (const c of CLIP_DEFS) {
  CLIPS[c.name] = { start: rows, frames: c.frames.length, loop: c.loop };
  rows += c.frames.length + 1; // plus one duplicate row for the interpolation fetch
}
export const CLIP_ROWS = rows;

/** Continuous frame position for a clip at phase 0..1 (looping clips wrap; others clamp). */
export function framePos(name, phase) {
  const c = CLIPS[name];
  if (c.loop) return c.start + (phase - Math.floor(phase)) * c.frames;
  return c.start + Math.min(1, Math.max(0, phase)) * (c.frames - 1);
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();

/** Object-space 4x4 for every bone of one pose, composed through the hierarchy about each pivot. */
function poseMatrices(pose) {
  const out = [];
  for (let i = 0; i < BONES.length; i++) {
    const b = BONES[i];
    const r = pose[b.name] || [0, 0, 0];
    const local = new THREE.Matrix4();
    if (b.name === 'prop') {
      _e.set(r[0], r[1], r[2], 'YXZ');
      local.makeRotationFromEuler(_e);
      local.setPosition(r[3] || 0, r[4] || 0, r[5] || 0);
    } else {
      _e.set(r[0], r[1], r[2], 'XYZ');
      _q.setFromEuler(_e);
      _m.makeRotationFromQuaternion(_q);
      _t.makeTranslation(b.pivot[0], b.pivot[1] + (b.name === 'root' ? r[3] || 0 : 0), b.pivot[2]);
      local.copy(_t).multiply(_m);
      _t.makeTranslation(-b.pivot[0], -b.pivot[1], -b.pivot[2]);
      local.multiply(_t);
    }
    out.push(b.parent >= 0 ? out[b.parent].clone().multiply(local) : local);
  }
  return out;
}

let sharedTexture = null;
/** The bone texture: width BONE_COUNT*3 (matrix rows), height CLIP_ROWS. RGBA float, nearest. */
export function boneTexture() {
  if (sharedTexture) return sharedTexture;
  const W = BONE_COUNT * 3;
  const data = new Float32Array(W * CLIP_ROWS * 4);
  let row = 0;
  for (const c of CLIP_DEFS) {
    const frames = c.frames.map(poseMatrices);
    const seq = c.loop ? [...frames, frames[0]] : [...frames, frames[frames.length - 1]];
    for (const mats of seq) {
      for (let b = 0; b < BONE_COUNT; b++) {
        const e = mats[b].elements; // column-major
        for (let r = 0; r < 3; r++) {
          const o = (row * W + b * 3 + r) * 4;
          data[o] = e[r]; data[o + 1] = e[4 + r]; data[o + 2] = e[8 + r]; data[o + 3] = e[12 + r];
        }
      }
      row++;
    }
  }
  const tex = new THREE.DataTexture(data, W, CLIP_ROWS, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedTexture = tex;
  return tex;
}

/** The lying pose's frame position (end of a fall clip) for the casualty pool. */
export function fallenFrame(front) {
  return framePos(front ? 'fall-front' : 'fall-back', 1);
}


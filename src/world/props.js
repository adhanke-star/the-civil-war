// src/world/props.js: trees, farm buildings and rail fences.
//
// Trees are instanced round canopies in spatial chunks (so the camera frustum culls whole chunks).
// Buildings are generic period farm forms (gabled frame houses, a stone house, barns) merged into one mesh.
// Fences are instanced split rails (zig-zag "worm" fences).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './landscape.js';

function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ---------------------------------------------------------------------------------------------------
// Trees
function canopyGeometry(seed, flat = 1) {
  const g = new THREE.SphereGeometry(1, 7, 5);
  const pos = g.attributes.position;
  const rnd = mulberry32(seed);
  const bumps = [];
  for (let i = 0; i < 5; i++) bumps.push([rnd() * 2 - 1, rnd() * 0.8, rnd() * 2 - 1, 0.18 + rnd() * 0.12]);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let s = 1;
    for (const [bx, by, bz, a] of bumps) {
      const d = (x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2;
      s += a * Math.exp(-d * 2.5);
    }
    y = y < -0.2 ? -0.2 - (y + 0.2) * 0.25 : y; // flatten the underside
    pos.setXYZ(i, x * s, y * s * flat, z * s);
  }
  g.computeVertexNormals();
  // vertex colours: dark underside to sunlit top
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + 0.4) / 1.4, 0, 1);
    const k = 0.45 + t * 0.65;
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function pineGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(0.9 - i * 0.22, 1.1, 7, 1);
    c.translate(0, 0.2 + i * 0.6, 0);
    parts.push(c.toNonIndexed());
  }
  const g = mergeGeometries(parts, false);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.5 + THREE.MathUtils.clamp(pos.getY(i) / 1.8, 0, 1) * 0.55;
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildTrees(terrain, trees) {
  const group = new THREE.Group();
  group.name = 'trees';
  const CH = 420; // chunk size (m)
  const chunks = new Map();
  for (const t of trees) {
    const key = `${Math.floor(t[0] / CH)},${Math.floor(t[1] / CH)},${t[3] === 1 ? 1 : 0}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(t);
  }
  const canopy = canopyGeometry(5);
  const pine = pineGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const rnd = mulberry32(99);
  let count = 0;
  for (const [key, list] of chunks) {
    const isPine = key.endsWith(',1');
    const mesh = new THREE.InstancedMesh(isPine ? pine : canopy, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, z, r, kind] = list[i];
      const y = terrain.heightAt(x, z);
      // canopies only (no trunks: unseen from the battle camera, and they doubled the draw calls)
      dummy.position.set(x, y + (isPine ? r * 0.2 : r * (kind === 2 ? 0.9 : 1.15)), z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      if (isPine) dummy.scale.set(r * 0.9, r * 2.2, r * 0.9);
      else dummy.scale.set(r, r * (0.85 + rnd() * 0.25), r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // greens: woods darker and bluer, field trees brighter, orchards yellow-green
      const v = rnd();
      if (kind === 2) color.setRGB(0.25 + v * 0.05, 0.34 + v * 0.04, 0.12);
      else if (isPine) color.setRGB(0.12 + v * 0.03, 0.22 + v * 0.04, 0.11);
      else color.setRGB(0.15 + v * 0.07, 0.26 + v * 0.07, 0.08 + v * 0.03);
      mesh.setColorAt(i, color);
    }
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    count += list.length;
  }
  group.userData.count = count;
  return group;
}

// ---------------------------------------------------------------------------------------------------
// Buildings
function gableHouse({ w, d, h, roof = 0.55, wall, roofCol, trim = '#3b2f25', chimneys = 2, porch = false }) {
  const parts = [];
  parts.push(colorize(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).toNonIndexed(), wall));
  // gabled roof as a triangular prism with eaves overhang
  const rh = (w / 2) * roof * 1.6;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0);
  shape.lineTo(0, rh);
  shape.lineTo(w / 2 + 0.5, 0);
  shape.lineTo(-w / 2 - 0.5, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
  roofGeo.translate(0, h, -(d + 1) / 2);
  parts.push(colorize(roofGeo, roofCol));
  // gable-end wall triangles in wall colour
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0); tri.lineTo(0, rh * 0.92); tri.lineTo(w / 2, 0); tri.lineTo(-w / 2, 0);
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: d - 0.1, bevelEnabled: false });
  triGeo.translate(0, h, -(d - 0.1) / 2);
  parts.push(colorize(triGeo, wall));
  // windows and door (dark insets) on the long sides
  const win = (x, y, z, ww, hh) => parts.push(colorize(new THREE.BoxGeometry(ww, hh, 0.2).translate(x, y, z).toNonIndexed(), trim));
  const floors = h > 5 ? 2 : 1;
  for (let f = 0; f < floors; f++) {
    for (let i = -1; i <= 1; i++) {
      if (f === 0 && i === 0) continue;
      win(i * w * 0.3, 1.6 + f * 2.8, d / 2 + 0.05, 1.0, 1.3);
      win(i * w * 0.3, 1.6 + f * 2.8, -d / 2 - 0.05, 1.0, 1.3);
    }
  }
  win(0, 1.1, d / 2 + 0.05, 1.1, 2.2);
  for (let c = 0; c < chimneys; c++) {
    const x = chimneys === 1 ? 0 : (c ? 1 : -1) * (w / 2 - 0.6);
    parts.push(colorize(new THREE.BoxGeometry(0.9, rh + 1.6, 0.9).translate(x, h + (rh + 1.6) / 2, 0).toNonIndexed(), '#7a4a34'));
  }
  if (porch) {
    parts.push(colorize(new THREE.BoxGeometry(w * 0.7, 0.25, 2.2).translate(0, 2.7, d / 2 + 1.1).toNonIndexed(), roofCol));
  }
  return mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }), false);
}

const BUILDING_STYLES = {
  'frame-house': (w, d, h) => gableHouse({ w, d, h, wall: '#ece6d6', roofCol: '#77736a', porch: true }),
  'stone-house': (w, d, h) => gableHouse({ w, d, h, wall: '#b09c7e', roofCol: '#6c665e', trim: '#2e2620' }),
  'log-house': (w, d, h) => gableHouse({ w, d, h, wall: '#8a6a4a', roofCol: '#4f4337', chimneys: 1 }),
  barn: (w, d, h) => gableHouse({ w, d, h, roof: 0.7, wall: '#a8402c', roofCol: '#8a3a2a', trim: '#5a2216', chimneys: 0 }),
  shed: (w, d, h) => gableHouse({ w, d, h, roof: 0.45, wall: '#7d6247', roofCol: '#4a4038', trim: '#3a2c20', chimneys: 0 }),
};

export function buildBuildings(terrain, sites) {
  const geos = [];
  for (const s of sites) {
    for (const b of s.buildings || []) {
      const [bx, bz, w, d, h, rot, style] = b;
      const make = BUILDING_STYLES[style] || BUILDING_STYLES['frame-house'];
      const g = make(w, d, h);
      const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
      const wx = s.x + bx * c - bz * sn;
      const wz = s.z + bx * sn + bz * c;
      // sit on the lowest corner so no wall floats
      let y = Infinity;
      for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
        y = Math.min(y, terrain.heightAt(wx + cx, wz + cz));
      }
      g.rotateY(-((s.rot || 0) + (rot || 0)));
      g.translate(wx, y - 0.3, wz);
      geos.push(g);
    }
  }
  if (!geos.length) return new THREE.Group();
  const merged = mergeGeometries(geos, false);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'buildings';
  return mesh;
}

// ---------------------------------------------------------------------------------------------------
// Fences
export function buildFences(terrain, segs) {
  const rail = new THREE.BoxGeometry(1, 0.12, 0.12);
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push(rail.clone().translate(0, 0.35 + i * 0.32, 0));
  const post = new THREE.BoxGeometry(0.16, 1.5, 0.16).translate(0.5, 0.75, 0);
  parts.push(post);
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  colorize(geo, '#8c7a5e');
  geo.deleteAttribute('uv');
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), segs.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < segs.length; i++) {
    const [x, z, ang, len] = segs[i];
    dummy.position.set(x, terrain.heightAt(x, z), z);
    dummy.rotation.set(0, -ang, 0);
    dummy.scale.set(len, 1.25, 1.25); // fences slightly oversized so they read at battle zoom
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.computeBoundingSphere();
  mesh.name = 'fences';
  return mesh;
}

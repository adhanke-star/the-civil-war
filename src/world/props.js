// src/world/props.js: trees, farm buildings and fences.
//
// Trees are instanced canopies (with a short trunk) in spatial chunks (so the camera frustum culls whole
// chunks); deciduous crowns are lumpy multi-lobe spheres, conifers stacked cones, with a lit top and a
// shadowed underside baked into the vertex colours.
// Buildings are generic period farm forms (gabled frame houses, a stone house, barns, sheds) merged into
// one mesh and "painted" by a patched Lambert shader: clapboard or vertical-board walls, shingle rows on
// the roofs, stone courses, window frames, doors, corner boards, porches and brick chimneys.
// Fences are instanced: straight three-rail post-and-rail along the roads, zig-zag worm fences in the fields.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, BUILDING_SCALE } from './landscape.js';

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
function canopyGeometry(seed, flat = 1, segW = 7, segH = 5, lobes = 7) {
  const g = new THREE.SphereGeometry(1, segW, segH);
  const pos = g.attributes.position;
  const rnd = mulberry32(seed);
  const bumps = [];
  for (let i = 0; i < lobes; i++) bumps.push([rnd() * 2 - 1, rnd() * 0.9 - 0.1, rnd() * 2 - 1, 0.2 + rnd() * 0.16]);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let s = 1;
    for (const [bx, by, bz, a] of bumps) {
      const d = (x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2;
      s += a * Math.exp(-d * 2.2);
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
    const k = 0.3 + t * 0.7;
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // a short trunk below the crown (the crown's origin sits 1.15 radii above the ground)
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 1.0, 5, 1, true).translate(0, -0.85, 0);
  const tc = new Float32Array(trunk.attributes.position.count * 3).fill(0.22);
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  trunk.deleteAttribute('uv');
  g.deleteAttribute('uv');
  return mergeGeometries([g.toNonIndexed(), trunk.toNonIndexed()], false);
}

function pineGeometry(tiers = 4, seg = 7) {
  const parts = [];
  for (let i = 0; i < tiers; i++) {
    const r = tiers === 1 ? 0.9 : 0.95 - i * 0.2;
    const c = new THREE.ConeGeometry(r, tiers === 1 ? 2.4 : 1.0, seg, 1, true);
    c.translate(0, 0.35 + i * 0.5, 0);
    parts.push(c.toNonIndexed());
  }
  const trunk = new THREE.CylinderGeometry(0.08, 0.12, 0.6, 5, 1, true).translate(0, 0.05, 0);
  parts.push(trunk.toNonIndexed());
  const g = mergeGeometries(parts, false);
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y < 0.3 ? 0.2 : 0.42 + THREE.MathUtils.clamp(y / 2.2, 0, 1) * 0.6;
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildTrees(terrain, trees) {
  const group = new THREE.Group();
  group.name = 'trees';
  const CH = 320; // chunk size (m): the camera frustum culls whole chunks, and each picks a level of detail
  const chunks = new Map();
  for (const t of trees) {
    const key = `${Math.floor(t[0] / CH)},${Math.floor(t[1] / CH)},${t[3] === 1 ? 1 : 0}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(t);
  }
  // Two levels of detail: ~80-triangle crowns near the camera, ~24 far away.
  const canopy = canopyGeometry(5, 1, 8, 6);
  const canopyLo = canopyGeometry(5, 1, 5, 3, 5);
  const pine = pineGeometry();
  const pineLo = pineGeometry(1, 6);
  const lods = [];
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
      dummy.position.set(x, y + (isPine ? r * 0.2 : r * (kind === 2 ? 0.9 : 1.15)), z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      if (isPine) dummy.scale.set(r * 0.9, r * (2.0 + rnd() * 0.6), r * 0.9);
      else dummy.scale.set(r * (0.85 + rnd() * 0.3), r * (0.8 + rnd() * 0.35), r * (0.85 + rnd() * 0.3));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // greens: woods darker and bluer, field trees brighter, orchards yellow-green, conifers blue-green
      const v = rnd();
      if (kind === 2) color.setRGB(0.27 + v * 0.06, 0.38 + v * 0.05, 0.13);
      else if (isPine) color.setRGB(0.1 + v * 0.03, 0.2 + v * 0.05, 0.14 + v * 0.03);
      else color.setRGB(0.13 + v * 0.08, 0.24 + v * 0.08, 0.07 + v * 0.04);
      mesh.setColorAt(i, color);
    }
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    lods.push({ mesh, hi: isPine ? pine : canopy, lo: isPine ? pineLo : canopyLo, center: mesh.boundingSphere.center.clone() });
    count += list.length;
  }
  group.userData.count = count;
  /** Pick each chunk's detail from its distance to the camera (call once per frame). */
  group.userData.updateLod = (camera, near) => {
    for (const l of lods) {
      const g = camera.position.distanceTo(l.center) < near ? l.hi : l.lo;
      if (l.mesh.geometry !== g) l.mesh.geometry = g;
    }
  };
  return group;
}

// ---------------------------------------------------------------------------------------------------
// Buildings
const PAT = { NONE: 0, CLAPBOARD: 1, BOARDS: 2, SHINGLE: 3, STONE: 4, BRICK: 5 };

function part(geo, color, pat = PAT.NONE) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  colorize(g, color);
  g.setAttribute('aPat', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(pat), 1));
  return g;
}

/** Pattern coordinates (metres on the surface) from local position and face normal. */
function patternUv(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, pat = geo.attributes.aPat;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (pat.getX(i) === PAT.SHINGLE) { uv[i * 2] = z; uv[i * 2 + 1] = y * 1.4; }
    else if (ny > 0.7) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (nx > 0.5) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('aPuv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function gableHouse({ w, d, h, roof = 0.55, wall, roofCol, trim = '#3b2f25', chimneys = 2, porch = false, pat = PAT.CLAPBOARD, door = '#4a3526', barn = false }) {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), wall, pat));
  // gabled roof as a triangular prism with eaves overhang
  const rh = (w / 2) * roof * 1.6;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0);
  shape.lineTo(0, rh);
  shape.lineTo(w / 2 + 0.5, 0);
  shape.lineTo(-w / 2 - 0.5, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
  roofGeo.translate(0, h, -(d + 1) / 2);
  parts.push(part(roofGeo, roofCol, PAT.SHINGLE));
  parts.push(part(new THREE.BoxGeometry(0.3, 0.25, d + 1.1).translate(0, h + rh, 0), trim)); // ridge cap
  // gable-end wall triangles in wall colour
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0); tri.lineTo(0, rh * 0.92); tri.lineTo(w / 2, 0); tri.lineTo(-w / 2, 0);
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: d - 0.1, bevelEnabled: false });
  triGeo.translate(0, h, -(d - 0.1) / 2);
  parts.push(part(triGeo, wall, pat));
  // corner boards and a sill line
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new THREE.BoxGeometry(0.22, h, 0.22).translate(sx * w / 2, h / 2, sz * d / 2), trim));
  parts.push(part(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2).translate(0, 0.15, 0), '#5a4a3a'));
  // windows (frame, then dark glass) on the long sides; door on the front
  const win = (x, y, z, ww, hh, front) => {
    const dir = front ? 1 : -1;
    parts.push(part(new THREE.BoxGeometry(ww + 0.3, hh + 0.3, 0.12).translate(x, y, z + dir * 0.02), trim));
    parts.push(part(new THREE.BoxGeometry(ww, hh, 0.12).translate(x, y, z + dir * 0.06), '#1d2430'));
    parts.push(part(new THREE.BoxGeometry(0.08, hh, 0.14).translate(x, y, z + dir * 0.07), trim)); // mullion
  };
  const floors = h > 5 ? 2 : 1;
  if (!barn) {
    for (let f = 0; f < floors; f++) {
      for (let i = -1; i <= 1; i++) {
        if (f === 0 && i === 0) continue;
        win(i * w * 0.3, 1.7 + f * 2.8, d / 2, 1.0, 1.4, true);
        win(i * w * 0.3, 1.7 + f * 2.8, -d / 2, 1.0, 1.4, false);
      }
    }
    parts.push(part(new THREE.BoxGeometry(1.4, 2.4, 0.12).translate(0, 1.2, d / 2 + 0.02), trim));
    parts.push(part(new THREE.BoxGeometry(1.1, 2.2, 0.12).translate(0, 1.1, d / 2 + 0.06), door));
  } else {
    // big double door with cross braces, a hay door in the gable, a small side door
    parts.push(part(new THREE.BoxGeometry(w * 0.42, h * 0.72, 0.14).translate(0, h * 0.36, d / 2 + 0.02), trim));
    parts.push(part(new THREE.BoxGeometry(w * 0.38, h * 0.68, 0.14).translate(0, h * 0.34, d / 2 + 0.06), door));
    for (const s of [-1, 1]) parts.push(part(new THREE.BoxGeometry(0.16, h * 0.7, 0.1).rotateZ(s * 0.5).translate(0, h * 0.34, d / 2 + 0.14), trim));
    parts.push(part(new THREE.BoxGeometry(0.1, h * 0.68, 0.1).translate(0, h * 0.34, d / 2 + 0.14), trim));
    parts.push(part(new THREE.BoxGeometry(1.4, 1.4, 0.14).translate(0, h + rh * 0.3, d / 2 - 0.3), door));
    parts.push(part(new THREE.BoxGeometry(1.0, 1.9, 0.12).translate(-w * 0.3, 0.95, -d / 2 - 0.02), door));
    for (let i = -1; i <= 1; i += 2) win(i * w * 0.32, h * 0.62, -d / 2, 0.8, 0.8, false);
  }
  for (let c = 0; c < chimneys; c++) {
    const x = chimneys === 1 ? 0 : (c ? 1 : -1) * (w / 2 - 0.7);
    parts.push(part(new THREE.BoxGeometry(0.9, rh + 1.8, 0.9).translate(x, h + (rh + 1.8) / 2, 0), '#7a4a34', PAT.BRICK));
    parts.push(part(new THREE.BoxGeometry(1.1, 0.25, 1.1).translate(x, h + rh + 1.7, 0), '#5a3a28'));
  }
  if (porch) {
    const pz = d / 2 + 1.2;
    parts.push(part(new THREE.BoxGeometry(w * 0.75, 0.22, 2.4).rotateX(0.12).translate(0, 3.0, pz), roofCol, PAT.SHINGLE));
    parts.push(part(new THREE.BoxGeometry(w * 0.75, 0.2, 2.4).translate(0, 0.35, pz), '#8a7a62'));
    for (const x of [-w * 0.35, 0, w * 0.35]) parts.push(part(new THREE.BoxGeometry(0.18, 2.7, 0.18).translate(x, 1.65, d / 2 + 2.2), trim));
    parts.push(part(new THREE.BoxGeometry(w * 0.75, 0.08, 0.08).translate(0, 1.0, d / 2 + 2.2), trim)); // rail
  }
  return patternUv(mergeGeometries(parts, false));
}

const BUILDING_STYLES = {
  'frame-house': (w, d, h) => gableHouse({ w, d, h, wall: '#eee8d8', roofCol: '#6f6a60', trim: '#3f4f42', porch: true, pat: PAT.CLAPBOARD }),
  'stone-house': (w, d, h) => gableHouse({ w, d, h, wall: '#a89a84', roofCol: '#5d5850', trim: '#e8e2d4', pat: PAT.STONE, door: '#3a2a1c' }),
  'log-house': (w, d, h) => gableHouse({ w, d, h, wall: '#8a6a4a', roofCol: '#4f4337', chimneys: 1, pat: PAT.BOARDS, trim: '#5a4432' }),
  barn: (w, d, h) => gableHouse({ w, d, h, roof: 0.7, wall: '#a8402c', roofCol: '#7d3a2c', trim: '#f0e8dc', chimneys: 0, pat: PAT.BOARDS, barn: true, door: '#4a2418' }),
  shed: (w, d, h) => gableHouse({ w, d, h, roof: 0.45, wall: '#7d6247', roofCol: '#4a4038', trim: '#5a4a3a', chimneys: 0, pat: PAT.BOARDS, barn: true, door: '#3a2a20' }),
};

/** Lambert patched with the painted surface patterns (boards, shingles, stone, brick) and grime. */
function buildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aPat; attribute vec2 aPuv; varying float vPat; varying vec2 vPuv;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPat = aPat; vPuv = aPuv;');
    shader.fragmentShader = 'varying float vPat; varying vec2 vPuv;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lines = 0.0;
        int pat = int(vPat + 0.5);
        if (pat == 1) lines = smoothstep(0.78, 0.9, fract(vPuv.y / 0.28)) * 0.5;
        else if (pat == 2) lines = smoothstep(0.84, 0.93, fract(vPuv.x / 0.32)) * 0.55;
        else if (pat == 3) {
          float row = floor(vPuv.y / 0.45);
          lines = smoothstep(0.8, 0.9, fract(vPuv.y / 0.45)) * 0.5 + smoothstep(0.9, 0.96, fract((vPuv.x + mod(row, 2.0) * 0.4) / 0.8)) * 0.35;
        } else if (pat == 4) {
          float row = floor(vPuv.y / 0.5);
          lines = smoothstep(0.82, 0.92, fract(vPuv.y / 0.5)) * 0.45 + smoothstep(0.88, 0.95, fract((vPuv.x + mod(row, 2.0) * 0.55) / 1.1)) * 0.45;
          lines += (fract(sin(dot(vec2(floor(vPuv.x / 1.1), row), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.18;
        } else if (pat == 5) {
          float row = floor(vPuv.y / 0.09);
          lines = smoothstep(0.7, 0.85, fract(vPuv.y / 0.09)) * 0.35 + smoothstep(0.85, 0.95, fract((vPuv.x + mod(row, 2.0) * 0.12) / 0.24)) * 0.3;
        }
        diffuseColor.rgb *= 1.0 - clamp(lines, 0.0, 0.6);
        if (pat > 0) diffuseColor.rgb *= 0.82 + 0.18 * clamp(vPuv.y / 2.5, 0.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'building-v2';
  return mat;
}

export function buildBuildings(terrain, sites) {
  const geos = [];
  for (const s of sites) {
    for (const b0 of s.buildings || []) {
      const k = BUILDING_SCALE;
      const b = [b0[0] * k, b0[1] * k, b0[2] * k, b0[3] * k, b0[4] * k, b0[5], b0[6]];
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
  const mesh = new THREE.Mesh(merged, buildingMaterial());
  mesh.name = 'buildings';
  return mesh;
}

// ---------------------------------------------------------------------------------------------------
// Fences
function railFence(rails, zig) {
  const rail = new THREE.BoxGeometry(1, 0.12, 0.12);
  const parts = [];
  for (let i = 0; i < rails; i++) parts.push(rail.clone().translate(0, 0.4 + i * (zig ? 0.3 : 0.42), 0));
  if (zig) {
    // a worm fence: the rail ends overlap the next panel; a short stake leans at the joint
    parts.push(new THREE.BoxGeometry(0.14, 1.5, 0.14).rotateX(0.35).translate(0.5, 0.75, 0.1));
  } else {
    parts.push(new THREE.BoxGeometry(0.16, 1.55, 0.16).translate(0.5, 0.75, 0));
    parts.push(new THREE.BoxGeometry(0.16, 1.55, 0.16).translate(-0.5, 0.75, 0));
  }
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  colorize(geo, zig ? '#8c7a5e' : '#9a8a6c');
  geo.deleteAttribute('uv');
  return geo;
}

export function buildFences(terrain, segs) {
  const group = new THREE.Group();
  group.name = 'fences';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dummy = new THREE.Object3D();
  for (const kind of [0, 1]) {
    const list = segs.filter((s) => (s[4] || 0) === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(railFence(kind ? 4 : 3, kind === 1), mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, z, ang, len] = list[i];
      dummy.position.set(x, terrain.heightAt(x, z), z);
      dummy.rotation.set(0, -ang, 0);
      dummy.scale.set(len, 1.25, 1.25); // fences slightly oversized so they read at battle zoom
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.computeBoundingSphere();
    mesh.name = kind ? 'fences-worm' : 'fences-rail';
    group.add(mesh);
  }
  return group;
}

// src/world/labels.js: big serif place names standing up off the ground as extruded 3D letters, UG:G style.
//
// No font file ships (the project's asset rule is public domain, CC0 or CC-BY, and the free typeface JSONs
// that come with three.js are under the MgOpen licence). Instead each word is drawn with the system serif
// on a canvas, its bitmap is traced into outline polygons (pixel-edge following, then Douglas-Peucker
// simplification, holes assigned to their letters), and the polygons are extruded. The letter tops follow
// the terrain, the sides reach down into it, so the words sit on the hills with a lit face and dark sides.
// If tracing fails for a label (an empty bitmap), it falls back to a flat painted label.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FONT = '"Georgia", "Times New Roman", "DejaVu Serif", serif';
const PX = 96; // canvas font size; letters are traced at this resolution

/** Render text white on transparent; return the alpha bitmap. */
function textBitmap(text, italic) {
  const font = `${italic ? 'italic ' : ''}bold ${PX}px ${FONT}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width + PX * 0.4);
  const h = Math.ceil(PX * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bits[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { bits, w, h };
}

/**
 * Trace the filled pixels into closed loops. Each boundary edge between a filled and an empty cell is a
 * directed edge keeping the filled cell on its left; chaining edges head to tail gives counter-clockwise
 * outer loops and clockwise holes (in image coordinates, y down).
 */
function traceLoops({ bits, w, h }) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bits[y * w + x]);
  const next = new Map(); // "x,y" -> list of [x2,y2]
  const add = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x2, y2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      // edges around a filled cell, filled side on the left of each directed edge (y down: clockwise screen = ccw math)
      if (!at(x, y - 1)) add(x, y, x + 1, y); // top edge, left to right
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right edge, downward
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom edge, right to left
      if (!at(x - 1, y)) add(x, y + 1, x, y); // left edge, upward
    }
  }
  const loops = [];
  for (const [k, outs] of next) {
    while (outs.length) {
      const start = k.split(',').map(Number);
      const loop = [start];
      let cur = outs.pop();
      let guard = 0;
      const seen = new Map([[k, 0]]);
      while (cur && (cur[0] !== start[0] || cur[1] !== start[1]) && guard++ < 200000) {
        const ck = `${cur[0]},${cur[1]}`;
        const prevIdx = seen.get(ck);
        if (prevIdx !== undefined) {
          // the walk came back to a vertex of this loop (a one-pixel pinch): cut the sub-loop out as its own
          const sub = loop.splice(prevIdx);
          for (const q of sub) seen.delete(`${q[0]},${q[1]}`);
          if (sub.length > 6) loops.push(sub);
        }
        seen.set(ck, loop.length);
        loop.push(cur);
        const lst = next.get(`${cur[0]},${cur[1]}`);
        if (!lst || !lst.length) break;
        // prefer the turn that keeps the filled side on the left (first available is fine for a pixel grid)
        let pick = 0;
        if (lst.length > 1) {
          const prev = loop[loop.length - 2];
          const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
          for (let i = 0; i < lst.length; i++) {
            const ex = lst[i][0] - cur[0], ey = lst[i][1] - cur[1];
            if (dx * ey - dy * ex > 0) { pick = i; break; } // turn left first
          }
        }
        cur = lst.splice(pick, 1)[0];
      }
      if (loop.length > 6) loops.push(loop);
    }
  }
  return loops;
}

function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return a / 2; };
const inside = (x, y, poly) => {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
};

/** Shapes (with holes) for a word, in canvas pixels centred on the word, y up. Each glyph is traced alone
 * (so touching letters such as "ry" in bold serif never merge into one self-touching polygon) and placed
 * at its measured advance. */
function textShapes(text, italic) {
  const font = `${italic ? 'italic ' : ''}bold ${PX}px ${FONT}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const total = probe.measureText(text).width;
  const shapes = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') continue;
    const advance = probe.measureText(text.slice(0, i)).width;
    const bm = textBitmap(ch, italic);
    const loops = traceLoops(bm).map((l) => simplify(l, 1.1)).filter((l) => l.length >= 3);
    const outers = [], holes = [];
    for (const l of loops) {
      const a = area(l);
      if (Math.abs(a) < 12) continue;
      (a < 0 ? outers : holes).push(l); // y-down image: outer loops come out negative
    }
    const glyph = outers.map((o) => ({ outer: o, holes: [], area: Math.abs(area(o)) }));
    for (const hl of holes) {
      let best = null;
      for (const g of glyph) if (inside(hl[0][0], hl[0][1], g.outer) && (!best || g.area < best.area)) best = g;
      if (best) best.holes.push(hl);
    }
    // the glyph was drawn centred in its own canvas; move it to its place in the word, centred on the word
    const glyphW = probe.measureText(ch).width;
    const dx = advance + glyphW / 2 - total / 2 - bm.w / 2;
    const cy = bm.h / 2;
    const toShape = (pts) => pts.map(([x, y]) => new THREE.Vector2(x + dx, cy - y));
    for (const g of glyph) {
      const shape = new THREE.Shape(toShape(g.outer));
      for (const hl of g.holes) shape.holes.push(new THREE.Path(toShape(hl)));
      shapes.push(shape);
    }
  }
  return shapes;
}

/**
 * labels: [{ text, x, z, height (m of letter box), angle (radians, 0 = reads west to east), italic }]
 * angle is measured like Math.atan2(dz, dx) in the ground plane.
 */
export function buildLabels(terrain, labels) {
  const group = new THREE.Group();
  group.name = 'labels';
  const geos = [];
  const face = new THREE.Color('#cfc08c'), faceHi = new THREE.Color('#e9dcae'), side = new THREE.Color('#4a3618');
  for (const L of labels) {
    let shapes;
    try { shapes = textShapes(L.text, !!L.italic); } catch (err) { console.warn(`label trace failed for "${L.text}":`, err.message); shapes = []; }
    if (!shapes.length) continue;
    const hgt = L.height || 40;
    const scale = (hgt * 0.72) / PX; // metres per canvas pixel: cap height about 0.72 of the box
    const depth = Math.max(1.5, hgt * 0.07);
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: depth / scale, bevelEnabled: false, curveSegments: 3 });
    geo.scale(scale, scale, scale);
    // lay flat: shape x -> east (along the label), shape y -> north (-z), extrusion -> up
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const c = Math.cos(L.angle || 0), s = Math.sin(L.angle || 0);
    const minX = geo.boundingBox ? geo.boundingBox.min.x : 0;
    geo.computeBoundingBox();
    const span = Math.max(1, geo.boundingBox.max.x - geo.boundingBox.min.x);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
      const x = L.x + lx * c - lz * s;
      const z = L.z + lx * s + lz * c;
      const top = nor.getY(i) > 0.5;
      const ground = terrain.heightAt(x, z);
      // the top face rides on the terrain; everything else reaches down into it
      pos.setXYZ(i, x, ground + (ly > depth * 0.5 ? depth + 0.3 : -2.0), z);
      const t = (lx - geo.boundingBox.min.x) / span;
      const cc = top ? faceHi.clone().lerp(face, 0.3 + 0.5 * t) : side;
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      void minX;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    geo.computeVertexNormals();
    geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  if (!geos.length) return group;
  const merged = mergeGeometries(geos, false);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'labels-3d';
  mesh.userData.triangles = merged.attributes.position.count / 3;
  group.add(mesh);
  return group;
}

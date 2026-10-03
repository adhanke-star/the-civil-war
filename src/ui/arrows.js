// src/ui/arrows.js: order lines, destination ghosts and range arcs on the ground.
//
// Order line (look.orderLine, src/ui/look.js):
//   pencil (default)  a thin dashed staff-map line with a small arrowhead, about 3 screen pixels wide at any
//                     zoom, blue for the Union and red for the Confederacy;
//   arrow             the big curved translucent UG:G arrow (centripetal Catmull-Rom ribbon with a head).
// While the setting is being compared split-screen (src/sandbox/compare.js) each line is drawn in both styles
// and each style's fragments are discarded on the other side of the divider.
// Ghost: where the line will stand at the end of the march: a rimmed bar as wide as the brigade's front, a
// short arrow for the way it will face and, for the dragged order and the selected brigade, a translucent
// sector of its firing arc at weapon range (batteries: rings at canister and full range).
// Everything here draws on top of the battlefield (no depth test) so it stays readable over hills and smoke.

import * as THREE from 'three';
import { LOOK } from './look.js';
import { on as onSetting } from '../settings.js';
import { compareState, onCompare } from '../sandbox/compare.js';

const COLORS = { US: new THREE.Color('#3f7fd8'), CS: new THREE.Color('#c8384a') };
const INK = { US: new THREE.Color('#1d4fb8'), CS: new THREE.Color('#b02a36') };
const ARC = (65 * Math.PI) / 180;
const _vp = new THREE.Vector4();

// Shared split-screen clip: uClip 0 = draw everywhere, -1 = only left of uSplit, +1 = only right of it.
const CLIP_GLSL = /* glsl */ `
  uniform float uClip; uniform float uSplit;
  bool clipped() { return (uClip < -0.5 && gl_FragCoord.x > uSplit) || (uClip > 0.5 && gl_FragCoord.x < uSplit); }
`;
function clipUniforms(clip) {
  return { uClip: { value: clip }, uSplit: { value: 0 } };
}
/** Before each draw: the divider position in the current render target's pixels. */
function setSplit(renderer, material) {
  const u = material.uniforms;
  if (!u || !u.uClip || u.uClip.value === 0) return;
  const s = compareState();
  renderer.getCurrentViewport(_vp);
  u.uSplit.value = _vp.x + (s ? s.split : 0.5) * _vp.z;
}

const arrowMaterial = (side, opacity, clip = 0) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: COLORS[side].clone() }, uOpacity: { value: opacity }, ...clipUniforms(clip) },
  vertexShader: /* glsl */ `
    attribute vec2 aRib; // x: 0..1 along, y: -1..1 across
    varying vec2 vRib;
    void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uOpacity; varying vec2 vRib;
    ${CLIP_GLSL}
    void main() {
      if (clipped()) discard;
      float edge = smoothstep(0.7, 0.86, abs(vRib.y));
      vec3 col = mix(uColor * 1.15, vec3(1.0, 0.98, 0.94), edge);
      float a = uOpacity * mix(0.62, 0.95, edge) * smoothstep(0.0, 0.08, vRib.x);
      gl_FragColor = vec4(col, a);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

const pencilMaterial = (side, clip = 0) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: INK[side].clone() }, uDash: { value: 14 }, ...clipUniforms(clip) },
  vertexShader: /* glsl */ `
    attribute vec2 aRib; attribute vec2 aLine; // aLine.x: metres along, aLine.y: 1 in the arrowhead
    varying vec2 vRib; varying vec2 vLine;
    void main() { vRib = aRib; vLine = aLine; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uDash; varying vec2 vRib; varying vec2 vLine;
    ${CLIP_GLSL}
    void main() {
      if (clipped()) discard;
      float dash = vLine.y > 0.5 ? 1.0 : step(fract(vLine.x / uDash), 0.64);
      if (dash < 0.5) discard;
      float edge = smoothstep(0.55, 0.95, abs(vRib.y));
      vec3 col = mix(uColor, vec3(0.98, 0.97, 0.92), edge * 0.55);
      gl_FragColor = vec4(col, 0.95 * smoothstep(0.0, 0.03, vRib.x));
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

const ghostMaterial = (side) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: COLORS[side].clone() } },
  vertexShader: /* glsl */ `
    attribute vec2 aRib;
    varying vec2 vRib;
    void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying vec2 vRib;
    void main() {
      float e = max(smoothstep(0.5, 0.8, abs(vRib.y)), max(1.0 - smoothstep(0.0, 0.04, vRib.x), smoothstep(0.96, 1.0, vRib.x)));
      gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.98, 0.94), e), mix(0.3, 0.92, e));
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

// Firing-arc sector: aRib.x radial 0..1, aRib.y angular -1..1. A soft fill and a rim at the outer edge.
const arcMaterial = (side, fill) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: COLORS[side].clone() }, uFill: { value: fill } },
  vertexShader: /* glsl */ `
    attribute vec2 aRib;
    varying vec2 vRib;
    void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uFill; varying vec2 vRib;
    void main() {
      float rim = max(smoothstep(0.975, 0.995, vRib.x), smoothstep(0.975, 0.995, abs(vRib.y)) * step(0.06, vRib.x));
      float a = mix(uFill * (0.55 + 0.45 * vRib.x), 0.55, rim);
      gl_FragColor = vec4(mix(uColor * 1.1, vec3(1.0, 0.98, 0.94), rim * 0.6), a);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

/** A straight bar from a to b, draped on the ground every few metres; width in metres. */
function barGeometry(a, b, width, terrain) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
  const nx = -tz * width * 0.5, nz = tx * width * 0.5;
  const n = Math.max(2, Math.ceil(len / 6) + 1);
  const pos = [], rib = [], idx = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
    for (const s of [-1, 1]) {
      const px = x + nx * s, pz = z + nz * s;
      pos.push(px, terrain.heightAt(px, pz) + 2.5, pz);
      rib.push(u, s);
    }
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setIndex(idx);
  return g;
}

/** Annular sector around (x, z) facing `facing`, radii r0..r1, draped on the ground. */
export function arcGeometry(x, z, facing, r0, r1, half, terrain) {
  const nA = 28;
  const nR = Math.max(2, Math.min(24, Math.ceil((r1 - r0) / 30) + 1));
  const pos = [], rib = [], idx = [];
  for (let j = 0; j < nR; j++) {
    const fr = j / (nR - 1);
    const r = r0 + (r1 - r0) * fr;
    for (let i = 0; i <= nA; i++) {
      const fa = (i / nA) * 2 - 1;
      const a = facing + fa * half;
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      pos.push(px, terrain.heightAt(px, pz) + 2.2, pz);
      rib.push(r1 > 0 ? r / r1 : 0, fa);
    }
  }
  const row = nA + 1;
  for (let j = 0; j < nR - 1; j++) {
    for (let i = 0; i < nA; i++) {
      const k = j * row + i;
      idx.push(k, k + row, k + 1, k + 1, k + row, k + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setIndex(idx);
  return g;
}

function smooth(points, step) {
  if (points.length < 2) return points;
  const v = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
}

/** Wide ribbon geometry along points [[x,z]...] with an arrowhead; width in metres (the 'arrow' style). */
export function arrowGeometry(points, width, terrain) {
  const pts = smooth(points, 4);
  const n = pts.length;
  let total = 0;
  const dist = [0];
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    dist.push(total);
  }
  const head = Math.min(total * 0.45, width * 2.2);
  const pos = [];
  const rib = [];
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const fromEnd = total - dist[i];
    let w = width * 0.5 * Math.min(1, 0.55 + dist[i] / (width * 3)); // taper in at the tail
    if (fromEnd < head) w = width * 1.05 * (fromEnd / head); // arrowhead
    else if (fromEnd < head + 2) w = width * 0.5 + (width * 0.55) * (1 - (fromEnd - head) / 2);
    const [x, z] = pts[i];
    for (const side of [-1, 1]) {
      const px = x + nx * w * side, pz = z + nz * w * side;
      pos.push(px, terrain.heightAt(px, pz) + 2.5, pz);
      rib.push(dist[i] / total, side);
    }
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, length: total, smoothed: pts };
}

/** Thin pencil line with a small arrowhead; w = line width in metres (about 3 screen pixels). */
export function pencilGeometry(points, w, terrain) {
  const pts = smooth(points, 4);
  const n = pts.length;
  let total = 0;
  const dist = [0];
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    dist.push(total);
  }
  const head = Math.min(total * 0.4, w * 6);
  const pos = [], rib = [], line = [], idx = [];
  // the head needs a sharp shoulder: emit an extra pair of vertices where the head starts
  const rows = [];
  for (let i = 0; i < n; i++) {
    const fromEnd = total - dist[i];
    if (i > 0 && total - dist[i - 1] > head && fromEnd <= head) {
      const t = (total - head - dist[i - 1]) / Math.max(1e-6, dist[i] - dist[i - 1]);
      const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      rows.push({ p, d: total - head, a: pts[i - 1], b: pts[i], kind: 'body' });
      rows.push({ p, d: total - head, a: pts[i - 1], b: pts[i], kind: 'shoulder' });
    }
    rows.push({ p: pts[i], d: dist[i], a: pts[Math.max(0, i - 1)], b: pts[Math.min(n - 1, i + 1)], kind: fromEnd <= head ? 'head' : 'body' });
  }
  rows.forEach((r, k) => {
    let tx = r.b[0] - r.a[0], tz = r.b[1] - r.a[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const fromEnd = total - r.d;
    const half = r.kind === 'body' ? w * 0.5 : w * 1.7 * Math.max(0, fromEnd / head);
    for (const side of [-1, 1]) {
      const px = r.p[0] + nx * half * side, pz = r.p[1] + nz * half * side;
      pos.push(px, terrain.heightAt(px, pz) + 2.6, pz);
      rib.push(total > 0 ? r.d / total : 0, side);
      line.push(r.d, r.kind === 'body' ? 0 : 1);
    }
    if (k < rows.length - 1 && !(r.kind === 'body' && rows[k + 1].kind === 'shoulder')) {
      const q = k * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setAttribute('aLine', new THREE.Float32BufferAttribute(line, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, length: total, smoothed: pts };
}

export class ArrowLayer {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'arrows';
    this.group.renderOrder = 20;
    scene.add(this.group);
    this.preview = null; // the line being dragged (a Group of one mesh per style shown)
    this.previewGhost = null;
    this.previewEnd = null; // { x, z, facing } of the dragged order's ghost
    this.unitArrows = new Map(); // unit id -> Group
    this.ghosts = new Map();
    this.mats = new Map(); // `${style}:${side}:${clip}:${preview}` -> material
    this.ghostMats = { US: ghostMaterial('US'), CS: ghostMaterial('CS') };
    this.arcMats = { US: arcMaterial('US', 0.09), CS: arcMaterial('CS', 0.09), USc: arcMaterial('US', 0.16), CSc: arcMaterial('CS', 0.16) };
    this.headMats = { US: arrowMaterial('US', 0.85), CS: arrowMaterial('CS', 0.85) };
    this.mpp = 1; // metres per CSS pixel at the view centre (setScale)
    this.dirty = true;
    onCompare(() => { this.dirty = true; });
    onSetting('look.orderLine', () => { this.dirty = true; }); // halted lines keep their mesh until restyled
  }

  /** Metres per screen pixel near the view centre: the pencil keeps about 3 px at any zoom. */
  setScale(mpp) {
    if (Math.abs(mpp - this.mpp) / this.mpp > 0.04) { this.mpp = mpp; this.dirty = true; }
  }

  /** The styles to draw now: [[style, clip]] (two when look.orderLine is being compared split-screen). */
  styles() {
    const s = compareState();
    if (s && s.key === 'look.orderLine') return [[s.a, -1], [s.b, 1]];
    return [[LOOK.orderLine, 0]];
  }

  material(style, side, clip, preview) {
    const key = `${style}:${side}:${clip}:${preview ? 1 : 0}`;
    let m = this.mats.get(key);
    if (!m) {
      m = style === 'arrow' ? arrowMaterial(side, preview ? 0.95 : 0.85, clip) : pencilMaterial(side, clip);
      this.mats.set(key, m);
    }
    return m;
  }

  /** A Group with the line in each style shown; returns { group, length, smoothed }. */
  lineGroup(points, side, arrowWidth, preview) {
    const g = new THREE.Group();
    let length = 0, smoothed = points;
    for (const [style, clip] of this.styles()) {
      const r = style === 'arrow' ? arrowGeometry(points, arrowWidth, this.terrain) : pencilGeometry(points, Math.max(1.1, this.mpp * 3), this.terrain);
      length = r.length;
      smoothed = r.smoothed;
      const mat = this.material(style, side, clip, preview);
      if (mat.uniforms.uDash) mat.uniforms.uDash.value = Math.max(8, this.mpp * 14);
      const m = new THREE.Mesh(r.geometry, mat);
      m.renderOrder = preview ? 21 : 20;
      m.frustumCulled = false;
      if (clip) m.onBeforeRender = (renderer, _s, _c, _g, material) => setSplit(renderer, material);
      g.add(m);
    }
    return { group: g, length, smoothed };
  }

  disposeGroup(g) {
    if (!g) return;
    this.group.remove(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  /**
   * The line's footprint at (x, z) facing `facing` with a facing arrow; with `arc` ({ range, canister }) also
   * the firing-arc sector at weapon range (and the canister ring for a battery).
   */
  ghost(x, z, facing, halfFront, side, arc = null) {
    const lx = Math.cos(facing), lz = -Math.sin(facing), fx = Math.sin(facing), fz = Math.cos(facing);
    const g = new THREE.Group();
    const bar = new THREE.Mesh(barGeometry([x - lx * halfFront, z - lz * halfFront], [x + lx * halfFront, z + lz * halfFront], 7, this.terrain), this.ghostMats[side]);
    const head = new THREE.Mesh(arrowGeometry([[x + fx * 5, z + fz * 5], [x + fx * 26, z + fz * 26]], 9, this.terrain).geometry, this.headMats[side]);
    const parts = [bar, head];
    if (arc && arc.range > 0) {
      parts.unshift(new THREE.Mesh(arcGeometry(x, z, facing, 0, arc.range, ARC, this.terrain), this.arcMats[side]));
      if (arc.canister) parts.unshift(new THREE.Mesh(arcGeometry(x, z, facing, 0, arc.canister, ARC, this.terrain), this.arcMats[`${side}c`]));
    }
    for (const m of parts) { m.frustumCulled = false; m.renderOrder = m === bar || m === head ? 22 : 19; g.add(m); }
    this.group.add(g);
    return g;
  }

  dropGhost(g) {
    if (!g) return;
    this.group.remove(g);
    for (const m of g.children) m.geometry.dispose();
  }

  /**
   * The order being dragged: line along `points`, ghost at the end facing `facing` (or along the line), the
   * firing arc (`arc`), and footprints for the other brigades of a group order (`extras`: [{ x, z, facing,
   * halfFront }]). Returns the smoothed points the order should follow, or null if too short.
   */
  setPreview(points, side, width, halfFront = 0, { facing, arc = null, extras = null } = {}) {
    this.clearPreview();
    if (points.length < 2) return null;
    const { group, length, smoothed } = this.lineGroup(points, side, width, true);
    if (length < 6) { this.disposeGroup(group); return null; }
    this.preview = group;
    this.group.add(group);
    if (halfFront > 0 && smoothed.length >= 2) {
      const b = smoothed[smoothed.length - 1], a = smoothed[Math.max(0, smoothed.length - 4)];
      const face = Number.isFinite(facing) ? facing : Math.atan2(b[0] - a[0], b[1] - a[1]);
      this.previewGhost = this.ghost(b[0], b[1], face, halfFront, side, arc);
      this.previewEnd = { x: b[0], z: b[1], facing: face, length };
      if (extras) {
        for (const e of extras) {
          const eg = this.ghost(e.x, e.z, e.facing, e.halfFront, side);
          this.group.remove(eg);
          this.previewGhost.add(...eg.children);
        }
      }
    }
    return smoothed;
  }

  clearPreview() {
    this.dropGhost(this.previewGhost);
    this.previewGhost = null;
    this.previewEnd = null;
    if (!this.preview) return;
    this.disposeGroup(this.preview);
    this.preview = null;
  }

  /** Keep each marching brigade's destination ghost in step with its order (with its arc when selected). */
  updateGhost(u, show, arc = null) {
    const old = this.ghosts.get(u.id);
    if (!show || u.order.type === 'charge') {
      if (old) { this.dropGhost(old.g); this.ghosts.delete(u.id); }
      return;
    }
    const end = u.path[u.path.length - 1];
    const facing = u.order.keepFacing ? u.facing : u.order.endFacing ?? u.facing;
    const hf = u.lineHalfFront();
    const key = `${Math.round(end[0])},${Math.round(end[1])},${facing.toFixed(2)},${Math.round(hf)},${arc ? Math.round(arc.range) : 0}`;
    if (old && old.key === key) return;
    if (old) this.dropGhost(old.g);
    this.ghosts.set(u.id, { key, g: this.ghost(end[0], end[1], facing, hf, u.side, arc) });
  }

  /**
   * Show the remaining path of each moving unit the player commands (plus visible enemy charges).
   * `mine(u)` says whether the player commands u; `arcOf(u)` gives the selected brigade's arc (or null).
   */
  update(units, mine, arcOf = () => null) {
    const isMine = typeof mine === 'function' ? mine : (u) => u.side === mine;
    const rebuild = this.dirty;
    this.dirty = false;
    const seen = new Set();
    for (const u of units) {
      seen.add(u.id);
      const own = isMine(u);
      const show = u.path && u.path.length >= 2 && u.alive && u.state !== 'routing' && (own || u.order.type === 'charge');
      let m = this.unitArrows.get(u.id);
      if (!show) {
        if (m) { this.disposeGroup(m); this.unitArrows.delete(u.id); }
        this.updateGhost(u, false);
        continue;
      }
      const remain = Math.hypot(u.path[u.path.length - 1][0] - u.x, u.path[u.path.length - 1][1] - u.z);
      this.updateGhost(u, own && remain >= 8, own ? arcOf(u) : null);
      if (remain < 15) {
        if (m) { this.disposeGroup(m); this.unitArrows.delete(u.id); }
        continue;
      }
      // a halted line's path does not change: keep its mesh unless the style or scale changed
      if (m && !u.follow.active && !rebuild) continue;
      if (m) this.disposeGroup(m);
      const { group } = this.lineGroup(u.path, u.side, Math.min(26, Math.max(12, u.halfFront * 0.22)), false);
      this.group.add(group);
      this.unitArrows.set(u.id, group);
    }
    // units removed from the field (sandbox)
    for (const [id, m] of this.unitArrows) if (!seen.has(id)) { this.disposeGroup(m); this.unitArrows.delete(id); }
    for (const [id, gh] of this.ghosts) if (!seen.has(id)) { this.dropGhost(gh.g); this.ghosts.delete(id); }
  }
}

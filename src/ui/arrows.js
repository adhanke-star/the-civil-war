// src/ui/arrows.js: big curved order arrows (red Confederate, blue Union), UG:G style.
//
// A path of ground points is smoothed (centripetal Catmull-Rom), resampled, and extruded into a ribbon
// that widens into an arrowhead. The shader draws a white rim and a soft translucent body; arrows draw on
// top of the battlefield (no depth test) so they stay readable over hills and smoke.

import * as THREE from 'three';

const COLORS = { US: new THREE.Color('#3f7fd8'), CS: new THREE.Color('#c8384a') };

const material = (side, opacity) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: COLORS[side].clone() }, uOpacity: { value: opacity } },
  vertexShader: /* glsl */ `
    attribute vec2 aRib; // x: 0..1 along, y: -1..1 across
    varying vec2 vRib;
    void main() { vRib = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uOpacity; varying vec2 vRib;
    void main() {
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

function smooth(points, step) {
  if (points.length < 2) return points;
  const v = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
}

/** Ribbon geometry along points [[x,z]...]; width in metres. */
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

export class ArrowLayer {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'arrows';
    this.group.renderOrder = 20;
    scene.add(this.group);
    this.preview = null;
    this.unitArrows = new Map();
    this.mats = { US: material('US', 0.85), CS: material('CS', 0.85), USp: material('US', 0.95), CSp: material('CS', 0.95) };
  }

  setPreview(points, side, width) {
    this.clearPreview();
    if (points.length < 2) return null;
    const { geometry, length, smoothed } = arrowGeometry(points, width, this.terrain);
    if (length < 6) { geometry.dispose(); return null; }
    this.preview = new THREE.Mesh(geometry, this.mats[`${side}p`]);
    this.preview.renderOrder = 21;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
    return smoothed;
  }

  clearPreview() {
    if (!this.preview) return;
    this.group.remove(this.preview);
    this.preview.geometry.dispose();
    this.preview = null;
  }

  /** Show the remaining path of each moving unit (player side, plus visible enemy charges). */
  update(units, showSide) {
    for (const u of units) {
      const show = u.path && u.path.length >= 2 && u.alive && u.state !== 'routing' && (u.side === showSide || u.order.type === 'charge');
      let m = this.unitArrows.get(u.id);
      if (!show) {
        if (m) { this.group.remove(m); m.geometry.dispose(); this.unitArrows.delete(u.id); }
        continue;
      }
      const remain = Math.hypot(u.path[u.path.length - 1][0] - u.x, u.path[u.path.length - 1][1] - u.z);
      if (remain < 15) {
        if (m) { this.group.remove(m); m.geometry.dispose(); this.unitArrows.delete(u.id); }
        continue;
      }
      const { geometry } = arrowGeometry(u.path, Math.min(26, Math.max(12, u.halfFront * 0.22)), this.terrain);
      if (!m) {
        m = new THREE.Mesh(geometry, this.mats[u.side]);
        m.renderOrder = 20;
        m.frustumCulled = false;
        this.group.add(m);
        this.unitArrows.set(u.id, m);
      } else {
        m.geometry.dispose();
        m.geometry = geometry;
      }
    }
  }
}

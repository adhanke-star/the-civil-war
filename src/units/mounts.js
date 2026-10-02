// src/units/mounts.js: horses: a low-poly saddle horse (about 110 triangles) for officers and limber
// teams. One InstancedMesh (HorsePool) holds the officers' mounts; limber teams are merged into the
// limber geometry in battery.js with horseGeometry().

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * A standing horse facing +Z at life size (1.55 m at the withers): barrel body, neck and head, four
 * legs in a walking stance, tail, saddle and blanket. `coat` and `mane` are colours; `stride` (0..1)
 * sets how far the legs are apart (teams on the move look like they are stepping).
 */
export function horseGeometry({ coat = '#5a3a26', mane = '#2a1a10', saddle = true, stride = 0.4 } = {}) {
  const P = [];
  const body = new THREE.CylinderGeometry(0.33, 0.36, 1.35, 7).rotateX(Math.PI / 2).translate(0, 1.12, 0);
  P.push(colored(body, coat));
  P.push(colored(new THREE.SphereGeometry(0.34, 6, 5).translate(0, 1.14, -0.6), coat)); // rump
  P.push(colored(new THREE.CylinderGeometry(0.3, 0.33, 0.3, 6).rotateX(Math.PI / 2).translate(0, 1.16, 0.72), coat)); // chest
  // neck rising forward, head angled down
  P.push(colored(new THREE.CylinderGeometry(0.14, 0.22, 0.78, 6).rotateX(-0.75).translate(0, 1.5, 0.95), coat));
  P.push(colored(new THREE.BoxGeometry(0.2, 0.26, 0.55).rotateX(0.5).translate(0, 1.7, 1.3), coat));
  P.push(colored(new THREE.BoxGeometry(0.16, 0.14, 0.16).translate(0, 1.58, 1.52), '#1e1410')); // muzzle
  P.push(colored(new THREE.BoxGeometry(0.06, 0.14, 0.06).translate(-0.08, 1.95, 1.2), mane)); // ears
  P.push(colored(new THREE.BoxGeometry(0.06, 0.14, 0.06).translate(0.08, 1.95, 1.2), mane));
  P.push(colored(new THREE.BoxGeometry(0.08, 0.5, 0.42).rotateX(-0.75).translate(0, 1.72, 0.85), mane)); // mane
  // legs: front pair forward, back pair back, offset by stride for a walking stance
  const leg = (x, z, lean) => {
    const g = new THREE.CylinderGeometry(0.07, 0.055, 1.0, 5).rotateX(lean).translate(x, 0.5, z);
    P.push(colored(g, coat));
    P.push(colored(new THREE.BoxGeometry(0.12, 0.08, 0.14).translate(x, 0.04, z + Math.sin(lean) * -0.95), '#1e1410'));
  };
  leg(-0.18, 0.55, stride * 0.35); leg(0.18, 0.55, -stride * 0.35);
  leg(-0.18, -0.55, -stride * 0.35); leg(0.18, -0.55, stride * 0.35);
  P.push(colored(new THREE.CylinderGeometry(0.03, 0.08, 0.6, 5).rotateX(0.45).translate(0, 1.0, -1.05), mane)); // tail
  if (saddle) {
    P.push(colored(new THREE.BoxGeometry(0.62, 0.08, 0.9).translate(0, 1.47, 0.05), '#3a2a52')); // blanket
    P.push(colored(new THREE.BoxGeometry(0.42, 0.12, 0.6).translate(0, 1.54, 0.08), '#3b2a1c')); // saddle
    P.push(colored(new THREE.BoxGeometry(0.5, 0.05, 0.18).translate(0, 1.6, -0.2), '#3b2a1c')); // cantle
  }
  const g = mergeGeometries(P, false);
  g.computeVertexNormals();
  return g;
}

export const HORSE_COATS = ['#5a3a26', '#3a2518', '#7a4a2a', '#8a7a6a', '#2a2522', '#6a4a30'];

/** Officers' mounts: fixed-index instances, moved every frame. */
export class HorsePool {
  constructor(capacity) {
    this.mesh = new THREE.InstancedMesh(horseGeometry({ coat: '#ffffff', mane: '#2a1a10' }), new THREE.MeshLambertMaterial({ vertexColors: true }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'horses';
    this.capacity = capacity;
    this.used = 0;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  alloc(coat) {
    if (this.used >= this.capacity) return -1;
    const i = this.used++;
    this.mesh.setColorAt(i, this.color.set(coat));
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.used;
    return i;
  }

  set(i, x, y, z, yaw, s) {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(0, yaw, 0);
    d.scale.setScalar(s);
    d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix);
  }

  flush() {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

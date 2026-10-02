// src/world/labels.js: big serif place names painted onto the ground, UG:G style.
//
// Each label is a canvas-rendered word with a cast "extrusion" (stacked dark offsets) and a lit face,
// draped over the terrain on a fine grid so it follows the hills. No font file ships: the canvas uses the
// system serif (Georgia, else Times/DejaVu Serif).

import * as THREE from 'three';

const FONT = '"Georgia", "Times New Roman", "DejaVu Serif", serif';

function labelTexture(text, { italic = false, color = '#e9d9a6', depth = 9 } = {}) {
  const px = 140;
  const font = `${italic ? 'italic ' : ''}bold ${px}px ${FONT}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width + px * 0.6 + depth * 2);
  const h = Math.ceil(px * 1.5 + depth * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = w / 2 - depth * 0.4;
  const cy = h / 2 - depth * 0.5;
  // soft ground shadow
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = depth * 0.8;
  ctx.shadowOffsetY = depth * 1.1;
  ctx.fillStyle = '#2a2010';
  ctx.fillText(text, cx + depth * 0.6, cy + depth * 0.9);
  ctx.shadowColor = 'transparent';
  // extrusion
  for (let i = depth; i > 0; i--) {
    const k = i / depth;
    ctx.fillStyle = `rgb(${Math.round(70 + 30 * (1 - k))},${Math.round(52 + 22 * (1 - k))},${Math.round(24 + 10 * (1 - k))})`;
    ctx.fillText(text, cx + i * 0.55, cy + i * 0.85);
  }
  // face with a vertical light gradient
  const grd = ctx.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
  grd.addColorStop(0, '#fff3c8');
  grd.addColorStop(0.5, color);
  grd.addColorStop(1, '#b89a58');
  ctx.fillStyle = grd;
  ctx.fillText(text, cx, cy);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(80,60,25,0.6)';
  ctx.strokeText(text, cx, cy);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

/**
 * labels: [{ text, x, z, height (m of letter box), angle (radians, 0 = reads west to east), italic }]
 * angle is measured like Math.atan2(dz, dx) in the ground plane.
 */
export function buildLabels(terrain, labels) {
  const group = new THREE.Group();
  group.name = 'labels';
  for (const L of labels) {
    const { tex, aspect } = labelTexture(L.text, { italic: !!L.italic });
    const hgt = L.height || 40;
    const wid = hgt * aspect;
    const segX = Math.max(8, Math.round(wid / 8));
    const segZ = Math.max(3, Math.round(hgt / 8));
    const geo = new THREE.PlaneGeometry(wid, hgt, segX, segZ);
    geo.rotateX(-Math.PI / 2); // lie flat; texture top points to -z (north) before rotation
    const pos = geo.attributes.position;
    const c = Math.cos(L.angle || 0), s = Math.sin(L.angle || 0);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const x = L.x + lx * c - lz * s;
      const z = L.z + lx * s + lz * c;
      pos.setXYZ(i, x, terrain.heightAt(x, z) + 1.2, z);
    }
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.name = `label:${L.text}`;
    group.add(mesh);
  }
  return group;
}

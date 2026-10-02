// src/world/ground-paint.js: paint the ground texture (a period-map look) and its info texture.
//
// ground (2048^2, sRGB): field parcels with soft edges and dark hedge/fence lines, woods floor, farmyards,
// stream banks and water, dirt roads, and baked tree and building shadows.
// info (1024^2, linear): r = brush-stroke angle, g = stroke strength, b = per-parcel tint (read by the
// terrain shader for the painted brush texture).
//
// Canvas row 0 is the north edge (z = -half); textures use flipY = false to match the terrain UVs.

import * as THREE from 'three';
import { fieldTypeFor, PLAN, hash2, valueNoise } from './landscape.js';

const P_RES = 1024; // parcel/info resolution

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const G_RES = 2048; // final ground texture resolution

export function paintGround(terrain, parcels, roads, streams, trees, sunDir) {
  const half = terrain.half;
  const size = terrain.size;

  // Woods mask via native polygon fill.
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskCanvas.height = P_RES;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const toP = (x, z) => [((x + half) / size) * P_RES, ((z + half) / size) * P_RES];
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, P_RES, P_RES);
  mctx.fillStyle = '#fff';
  for (const poly of PLAN.woods) {
    mctx.beginPath();
    poly.forEach(([x, z], i) => { const [px, pz] = toP(x, z); if (i) mctx.lineTo(px, pz); else mctx.moveTo(px, pz); });
    mctx.closePath();
    mctx.fill();
  }
  const mask = mctx.getImageData(0, 0, P_RES, P_RES).data;

  // Parcels, per pixel.
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pCanvas.height = P_RES;
  const pctx = pCanvas.getContext('2d', { willReadFrequently: true });
  const pImg = pctx.createImageData(P_RES, P_RES);
  const iCanvas = document.createElement('canvas');
  iCanvas.width = iCanvas.height = P_RES;
  const ictx = iCanvas.getContext('2d', { willReadFrequently: true });
  const iImg = ictx.createImageData(P_RES, P_RES);
  const woodsFloor = [40, 54, 24];
  const angleByte = Math.round(((((parcels.angle % Math.PI) + Math.PI) % Math.PI) / Math.PI) * 255);
  for (let py = 0; py < P_RES; py++) {
    const z = ((py + 0.5) / P_RES) * size - half;
    for (let px = 0; px < P_RES; px++) {
      const x = ((px + 0.5) / P_RES) * size - half;
      const k = (py * P_RES + px) * 4;
      const woods = mask[k] / 255;
      const p = parcels.lookup(x, z, 0);
      const e = 1 - smoothstep(0.8, 3.4, p.dist); // anti-aliased hedge/fence line along parcel edges
      const t = fieldTypeFor(p.id);
      const tint = hash2(p.id, 1.7);
      let r = t.color[0], g = t.color[1], b = t.color[2];
      // per-parcel hue drift so neighbouring pastures differ
      const drift = (tint - 0.5) * 18;
      r += drift; g += drift * 0.8; b += drift * 0.3;
      r *= 1 - 0.36 * e; g *= 1 - 0.3 * e; b *= 1 - 0.38 * e;
      if (woods > 0) {
        const n = 0.85 + valueNoise(x * 0.05, z * 0.05) * 0.3;
        r = r * (1 - woods) + woodsFloor[0] * n * woods;
        g = g * (1 - woods) + woodsFloor[1] * n * woods;
        b = b * (1 - woods) + woodsFloor[2] * n * woods;
      }
      pImg.data[k] = r; pImg.data[k + 1] = g; pImg.data[k + 2] = b; pImg.data[k + 3] = 255;
      // Stroke direction: the patchwork axis, turned 90 degrees in alternate parcels.
      iImg.data[k] = hash2(p.id, 5.1) < 0.5 ? angleByte : (angleByte + 128) & 255;
      iImg.data[k + 1] = Math.round(t.stroke * (1 - woods) * (1 - 0.7 * e) * 255);
      iImg.data[k + 2] = Math.round(tint * 255);
      iImg.data[k + 3] = 255;
    }
  }
  pctx.putImageData(pImg, 0, 0);
  ictx.putImageData(iImg, 0, 0);

  // Final ground canvas.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = G_RES;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pCanvas, 0, 0, G_RES, G_RES);
  const S = G_RES / size; // px per metre
  const toG = (x, z) => [(x + half) * S, (z + half) * S];
  const path = (c, pts) => {
    c.beginPath();
    pts.forEach(([x, z], i) => { const [gx, gz] = toG(x, z); if (i) c.lineTo(gx, gz); else c.moveTo(gx, gz); });
  };
  const ipath = (pts) => {
    ictx.beginPath();
    pts.forEach(([x, z], i) => { const [gx, gz] = toP(x, z); if (i) ictx.lineTo(gx, gz); else ictx.moveTo(gx, gz); });
  };
  ctx.lineJoin = ctx.lineCap = 'round';
  ictx.lineJoin = ictx.lineCap = 'round';

  // Farmyards: trodden earth around each site.
  for (const s of PLAN.sites) {
    const [gx, gz] = toG(s.x, s.z);
    const rad = (s.yard || 30) * S;
    const grd = ctx.createRadialGradient(gx, gz, rad * 0.2, gx, gz, rad);
    grd.addColorStop(0, 'rgba(150,118,72,0.85)');
    grd.addColorStop(0.7, 'rgba(120,104,58,0.45)');
    grd.addColorStop(1, 'rgba(110,100,50,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(gx, gz, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Streams: wide muddy banks, then water, then a light ripple line.
  for (const s of streams) {
    const big = s.name === 'Bull Run';
    ctx.strokeStyle = 'rgba(122,98,52,0.9)';
    ctx.lineWidth = (big ? 26 : 13) * S;
    path(ctx, s.points); ctx.stroke();
    ctx.strokeStyle = 'rgba(92,78,42,1)';
    ctx.lineWidth = (big ? 18 : 7.5) * S;
    path(ctx, s.points); ctx.stroke();
    ctx.strokeStyle = '#3d6a80';
    ctx.lineWidth = (big ? 13 : 4.6) * S;
    path(ctx, s.points); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,190,205,0.55)';
    ctx.lineWidth = (big ? 3 : 1.4) * S;
    path(ctx, s.points); ctx.stroke();
    ictx.strokeStyle = 'rgb(0,0,128)';
    ictx.lineWidth = (big ? 26 : 13) * (P_RES / size);
    ipath(s.points); ictx.stroke();
  }

  // Roads: dark verge, orange-tan bed, lighter crown; the turnpike is wider and paler.
  for (const r of roads) {
    const pike = r.name === 'Warrenton Turnpike';
    const w = pike ? 10 : 8;
    ctx.strokeStyle = 'rgba(70,56,30,0.55)';
    ctx.lineWidth = (w + 5) * S;
    path(ctx, r.points); ctx.stroke();
    ctx.strokeStyle = pike ? '#c9965a' : '#c4844a';
    ctx.lineWidth = w * S;
    path(ctx, r.points); ctx.stroke();
    ctx.strokeStyle = pike ? 'rgba(232,196,140,0.55)' : 'rgba(224,170,110,0.5)';
    ctx.lineWidth = w * 0.35 * S;
    path(ctx, r.points); ctx.stroke();
    ictx.strokeStyle = 'rgb(0,0,128)';
    ictx.lineWidth = (w + 4) * (P_RES / size);
    ipath(r.points); ictx.stroke();
  }

  // Baked shadows: trees (soft ellipses cast away from the sun) and buildings.
  const sx = -sunDir.x / Math.max(0.3, sunDir.y);
  const sz = -sunDir.z / Math.max(0.3, sunDir.y);
  ctx.fillStyle = 'rgba(14,22,6,0.34)';
  for (const [x, z, rad, kind] of trees) {
    const h = kind === 2 ? rad * 1.2 : rad * 1.7;
    const [gx, gz] = toG(x + sx * h * 0.6, z + sz * h * 0.6);
    ctx.beginPath();
    ctx.ellipse(gx, gz, rad * 1.05 * S, rad * 1.05 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of PLAN.sites) {
    for (const b of s.buildings || []) {
      const [bx, bz, w, d, h, rot] = b;
      const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
      const wx = s.x + bx * c - bz * sn;
      const wz = s.z + bx * sn + bz * c;
      const [gx, gz] = toG(wx + sx * h * 0.5, wz + sz * h * 0.5);
      ctx.save();
      ctx.translate(gx, gz);
      ctx.rotate((s.rot || 0) + (rot || 0));
      ctx.fillStyle = 'rgba(10,14,4,0.4)';
      ctx.fillRect((-w / 2 - 1.5) * S, (-d / 2 - 1.5) * S, (w + 3) * S, (d + 3) * S);
      ctx.restore();
    }
  }

  const ground = new THREE.CanvasTexture(canvas);
  ground.colorSpace = THREE.SRGBColorSpace;
  ground.flipY = false;
  ground.anisotropy = 4;
  ground.wrapS = ground.wrapT = THREE.ClampToEdgeWrapping;
  ground.generateMipmaps = true;
  ground.minFilter = THREE.LinearMipmapLinearFilter;

  const info = new THREE.CanvasTexture(iCanvas);
  info.colorSpace = THREE.NoColorSpace;
  info.flipY = false;
  info.wrapS = info.wrapT = THREE.ClampToEdgeWrapping;
  return { ground, info, canvas };
}


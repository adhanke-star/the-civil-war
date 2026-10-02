// src/world/terrain.js: the battlefield ground.
//
// Loads the USGS 3DEP heightmap built by tools/fetch-terrain.mjs, exaggerates relief (UG:G-style readable
// hills), meshes it with mapbox/martini (adaptive triangles), and shades it with a painted ground texture
// (see ground-paint.js), a full-resolution normal map from the DEM, and procedural brush-stroke detail.
//
// Frame: +x east, +z south, y up, metres. Heights are metres above the area minimum times EXAGGERATION.

import * as THREE from 'three';
import Martini from '@mapbox/martini';

export const EXAGGERATION = 2.0;

export async function loadTerrainData(base) {
  const meta = await (await fetch(`${base}/henry-hill.json`)).json();
  const res = await fetch(`${base}/${meta.heights.file}`);
  if (!res.ok) throw new Error(`heightmap HTTP ${res.status}`);
  // Read the whole download first: piping res.body straight into the decompressor let the gzip end
  // before the network read finished, which Chrome reports as an aborted request.
  const packed = await res.arrayBuffer();
  const raw = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const q = new Int16Array(raw);
  const G = meta.grid;
  if (q.length !== G * G) throw new Error(`heightmap has ${q.length} samples, expected ${G * G}`);
  const heights = new Float32Array(G * G);
  const k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) {
    let acc = 0;
    for (let x = 0; x < G; x++) {
      acc += q[y * G + x];
      heights[y * G + x] = acc * k;
    }
  }
  return new TerrainData(meta, heights);
}

export class TerrainData {
  constructor(meta, heights) {
    this.meta = meta;
    this.heights = heights;
    this.grid = meta.grid;
    this.half = meta.halfSize;
    this.size = meta.halfSize * 2;
    this.cell = meta.cellSize;
  }

  /** Bilinear height (world y) at world x,z; clamped to the map edge. */
  heightAt(x, z) {
    const G = this.grid;
    let gx = (x + this.half) / this.cell;
    let gz = (z + this.half) / this.cell;
    gx = gx < 0 ? 0 : gx > G - 1.001 ? G - 1.001 : gx;
    gz = gz < 0 ? 0 : gz > G - 1.001 ? G - 1.001 : gz;
    const x0 = gx | 0;
    const z0 = gz | 0;
    const fx = gx - x0;
    const fz = gz - z0;
    const h = this.heights;
    const i = z0 * G + x0;
    const a = h[i] + (h[i + 1] - h[i]) * fx;
    const b = h[i + G] + (h[i + G + 1] - h[i + G]) * fx;
    return a + (b - a) * fz;
  }

  /** Unit normal at x,z (finite differences over one grid cell). */
  normalAt(x, z, out = new THREE.Vector3()) {
    const d = this.cell;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return out.set(-hx, 2 * d, -hz).normalize();
  }

  /** Slope as rise/run at x,z. */
  slopeAt(x, z) {
    const n = this.normalAt(x, z, _n);
    return Math.sqrt(1 - n.y * n.y) / Math.max(0.05, n.y);
  }

  inBounds(x, z, margin = 0) {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }
}
const _n = new THREE.Vector3();

/** Tileable value noise, 256^2: r 16 cells per tile, g 32, b 64, a 8. Replaces per-pixel sin() hashes. */
function buildNoiseTexture() {
  const N = 256;
  const px = new Uint8Array(N * N * 4);
  const hash = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const chan = [16, 32, 64, 8];
  for (let c = 0; c < 4; c++) {
    const cells = chan[c];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells, fy = (y / N) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const u = fx - x0, v = fy - y0;
        const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
        const h = (i, j) => hash((x0 + i) % cells, (y0 + j) % cells, c);
        const a = h(0, 0) + (h(1, 0) - h(0, 0)) * su;
        const b = h(0, 1) + (h(1, 1) - h(0, 1)) * su;
        px[(y * N + x) * 4 + c] = Math.round((a + (b - a) * sv) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Normal map (RGBA8, grid resolution) so lighting keeps full DEM detail on the simplified mesh. Alpha holds
 * a cavity term (height minus a 60 m blur): valleys paint darker and crests lighter, like a hand-shaded map.
 */
function buildNormalTexture(data) {
  const G = data.grid;
  const px = new Uint8Array(G * G * 4);
  const h = data.heights;
  const R = 12;
  const tmp = new Float32Array(G * G);
  const blur = new Float32Array(G * G);
  for (let y = 0; y < G; y++) {
    let acc = 0;
    for (let x = -R; x <= R; x++) acc += h[y * G + Math.min(G - 1, Math.max(0, x))];
    for (let x = 0; x < G; x++) {
      tmp[y * G + x] = acc / (2 * R + 1);
      acc += h[y * G + Math.min(G - 1, x + R + 1)] - h[y * G + Math.max(0, x - R)];
    }
  }
  for (let x = 0; x < G; x++) {
    let acc = 0;
    for (let y = -R; y <= R; y++) acc += tmp[Math.min(G - 1, Math.max(0, y)) * G + x];
    for (let y = 0; y < G; y++) {
      blur[y * G + x] = acc / (2 * R + 1);
      acc += tmp[Math.min(G - 1, y + R + 1) * G + x] - tmp[Math.max(0, y - R) * G + x];
    }
  }
  const d2 = 2 * data.cell;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(G - 1, x + 1);
      const yu = Math.max(0, y - 1), yd = Math.min(G - 1, y + 1);
      const dx = (h[y * G + xr] - h[y * G + xl]) / d2;
      const dz = (h[yd * G + x] - h[yu * G + x]) / d2;
      let nx = -dx, ny = 1, nz = -dz;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * G + x) * 4;
      px[i] = Math.round((nx * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      px[i + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + (h[y * G + x] - blur[y * G + x]) * 0.09)) * 255);
    }
  }
  const tex = new THREE.DataTexture(px, G, G, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildTerrainMesh(data, groundTexture, infoTexture, sun) {
  const G = data.grid;
  const martini = new Martini(G);
  const tile = martini.createTile(data.heights);
  const { vertices, triangles } = tile.getMesh(0.5);
  const n = vertices.length / 2;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const gx = vertices[i * 2];
    const gz = vertices[i * 2 + 1];
    pos[i * 3] = gx * data.cell - data.half;
    pos[i * 3 + 1] = data.heights[gz * G + gx];
    pos[i * 3 + 2] = gz * data.cell - data.half;
    uv[i * 2] = gx / (G - 1);
    uv[i * 2 + 1] = gz / (G - 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(triangles), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uGround: { value: groundTexture },
      uInfo: { value: infoTexture },
      uNormal: { value: buildNormalTexture(data) },
      uNoise: { value: buildNoiseTexture() },
      uSunDir: { value: sun.direction },
      uSunColor: { value: sun.color },
      uSky: { value: sun.sky },
      uEarth: { value: sun.earth },
      uFogColor: { value: sun.fog },
      uFogRange: { value: new THREE.Vector2(1400, 3600) },
      uHalf: { value: data.half },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGround;
      uniform sampler2D uInfo;
      uniform sampler2D uNormal;
      uniform sampler2D uNoise;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSky;
      uniform vec3 uEarth;
      uniform vec3 uFogColor;
      uniform vec2 uFogRange;
      uniform float uHalf;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDepth;

      // value noise from the tileable texture (16 cells per tile in the red channel)
      float noise(vec2 p) { return texture2D(uNoise, p / 16.0).r; }

      void main() {
        vec3 base = texture2D(uGround, vUv).rgb;
        vec4 info = texture2D(uInfo, vUv); // r: stroke angle, g: stroke strength, b: parcel tint
        vec4 nt = texture2D(uNormal, vUv);
        vec3 n = normalize(nt.xyz * 2.0 - 1.0);
        float cavity = nt.a;

        // Brush strokes: long thin streaks along each field's furrow/mowing direction.
        float ang = info.r * 3.14159;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 p = vec2(dot(vWorld.xz, dir), dot(vWorld.xz, vec2(-dir.y, dir.x)));
        float streak = noise(vec2(p.x * 0.05, p.y * 0.9)) * 0.6 + noise(vec2(p.x * 0.11, p.y * 2.3)) * 0.4;
        float grain = noise(vWorld.xz * 0.35) * 0.5 + noise(vWorld.xz * 1.3) * 0.5;
        float big = noise(vWorld.xz * 0.004) * 0.6 + noise(vWorld.xz * 0.013) * 0.4;
        float detail = mix(1.0, 0.86 + streak * 0.28, info.g) * (0.95 + grain * 0.1) * (0.9 + big * 0.2);
        base *= detail;
        base *= 0.92 + info.b * 0.16;

        // Strong relief light (the painted maps read hills by light and shade).
        float ndl = dot(n, normalize(uSunDir));
        float lit = smoothstep(0.05, 0.85, ndl);
        vec3 hemi = mix(uEarth, uSky, n.y * 0.5 + 0.5);
        vec3 col = base * (hemi * 0.8 + uSunColor * lit * 1.15);
        col *= 0.72 + cavity * 0.56;

        // Edge of the mapped area falls off into dark haze.
        float edge = max(abs(vWorld.x), abs(vWorld.z));
        col *= 1.0 - smoothstep(uHalf - 260.0, uHalf + 40.0, edge) * 0.55;

        float fog = smoothstep(uFogRange.x, uFogRange.y, vDepth);
        col = mix(col, uFogColor, fog * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain';
  mesh.userData.triangles = triangles.length / 3;
  return mesh;
}

/** A wide dark apron under and around the mapped square so the edge never shows the void. */
export function buildApron(data, sun) {
  const geo = new THREE.PlaneGeometry(data.size * 5, data.size * 5, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#262a17').lerp(sun.fog, 0.35), fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -2;
  mesh.name = 'apron';
  return mesh;
}

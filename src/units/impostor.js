// src/units/impostor.js: baked soldiers drawn as camera-facing sprites ("impostors") from the bake atlas.
//
// The bake (branch `bake`, tools/bake/README.md) renders one Union infantryman in Blender, lighting and ground
// shadow included, and packs the frames into atlas pages with a manifest (assets/figures/union-infantry/
// soldier.json). Two tiers: 'field' (96 px frames) for everyone, 'close' (256 px frames) for men inside
// LOD_NEAR of the camera; the close pages load only when first needed.
//
// Manifest, second pass: framing is per clip. Each frame record carries its own feet anchor (ax, ay, px in the
// untrimmed frame) and px per metre (ppm): stand is framed at 1.93 m, walk at 2.71 m, fire 2.51, load 2.52,
// fallen 2.26. tiers.<tier>.pxPerMetre / anchor describe only the stand clip at direction 0, so they are a
// fallback here, never the rule: a man drawn with one scale for every clip would grow 40% when he walked.
// Directions per clip come from tiers.<tier>.directionsByClip (the close tier has 16 for stand and 8 for the
// rest); each man gets the nearest direction his clip HAS, never an assumed 16. tiers.field.variants holds
// extra field-tier figures (same keys; e.g. 'mixed' = slouch hat, second face, no blanket roll): each man gets one look
// from his index (variantIndex), so ranks are mixed and a man keeps his look across frames and re-forms. The
// close tier has no variants: a man inside LOD_NEAR is the base figure.
//
// Drawing: per side and per atlas page one instanced quad (InstancedBufferGeometry, one interleaved buffer
// of 12 floats a man, uploaded once a frame). The quad is a view-space billboard standing on the frame's feet
// anchor: one atlas pixel = FIGURE_SCALE * look.figureScale / ppm(frame) world metres, so every clip is the
// same height as the rigged figure (life 1.73 m x 4.4). Its height is corrected by cos(view elevation) /
// cos(bake elevation, 35 deg) so a man seen from higher up is foreshortened as the rigged ones are (clamped
// 0.8-1.15). Each vertex is pulled toward the eye along its own ray (the picture on screen is unchanged) far
// enough that the part of the frame below the feet, where the baked shadow lies, is not buried in the ground.
//
// Two passes per page, neither needs sorting: an opaque alpha-tested pass (alpha >= 0.88: the body) that
// writes depth, then a soft pass (premultiplied blend, no depth write) for the antialiased edges and the
// baked shadow (short and soft since the second pass; black: blending black over black is order-independent).
// The soft pass can be limited to men within softFar metres of the camera (?bakesoftfar=<m>, main.js; off by
// default, so the shadow stays at field distance). The atlas is premultiplied on upload and un-premultiplied
// after filtering, so edges have no dark fringe; the mip level is capped (field 2, close 1: the pages have
// 2-pixel gaps) and the sample point is clamped inside the frame rect, so atlas neighbours do not bleed in.
// The sprite's colours are display colours (the bake's Standard view transform, no look): the shader inverts
// the post chain's ACES curve and exposure (src/render/post.js) so the sprite reaches the screen as baked,
// before the shared warm grade.
//
// The baked shadow falls to the screen's lower right whatever the camera yaw: the bake's light is fixed
// relative to its camera, so the shadow turns with the view, not with the sun.
//
// Only a Union infantryman is baked. Confederate infantry reuse it with a shader tint that moves the blue coat
// and trousers to grey/butternut: a PLACEHOLDER until a Confederate bake exists.

import * as THREE from 'three';
import { FIGURE_VIEW, LOD_NEAR, splitHook, CLIP_FRAG } from './soldier-mesh.js';

export const BAKED_BASE = './assets/figures/union-infantry/';
/** Pose codes the units push (see unit.js animate). */
export const BAKE_CLIP = { STAND: 0, WALK: 1, AIM: 2, FIRE: 3, RECOVER: 4, FALLEN: 5, LOAD: 6 };
const TAU = Math.PI * 2;
const ALPHA_CUT = 0.88; // body pixels are opaque; the baked shadow and the edges are softer
const MAX_LOD = { field: 2, close: 1 };
const BAKE_EXPOSURE = 0.66; // post.js finalMat uExposure: the sprite undoes it so it lands on screen as baked
const STRIDE = 12; // floats per instance: x y z s | rect x y w h | dx dy variation clip
export const REC = 8; // floats per frame record: page u v w h dx dy ppm
const DIR_RES = 8; // direction lookup bins per baked direction step (nearest available direction per clip)
const FALLEN_REC = 7; // x y z yaw s variation man

/**
 * Baked direction for a man facing `yaw` (forward = (sin yaw, cos yaw)) at (x, z), seen from a camera at
 * (cx, cz), when all n directions exist. The bake's rule: direction d faces d * 360/n degrees counter-
 * clockwise, seen from above, from "toward the camera" (0 faces the viewer, n/4 faces screen-right). In this
 * world a growing yaw turns counter-clockwise seen from above, so d = round((yaw - bearing of the camera) /
 * (360/n)), wrapped. A clip with fewer directions goes through AtlasLayout.direction instead.
 */
export function directionIndex(yaw, x, z, cx, cz, n = 16) {
  const toCam = Math.atan2(cx - x, cz - z);
  const k = Math.round(((yaw - toCam) / TAU) * n);
  return ((k % n) + n) % n;
}

/** The available direction (of `avail`, sorted indices of n) nearest to the continuous direction u (0..n). */
export function nearestDirection(u, avail, n) {
  let best = avail[0], bd = Infinity;
  for (const d of avail) {
    const e = Math.abs(((u - d) % n + n * 1.5) % n - n * 0.5);
    if (e < bd - 1e-9) { bd = e; best = d; }
  }
  return best;
}

/** Which of `count` looks (0 = the base figure) man number i wears: a fixed hash of i, so it never changes. */
export function variantIndex(i, count) {
  if (!(count > 1)) return 0;
  let h = Math.imul((i | 0) ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % count;
}

const pad2 = (d) => String(d).padStart(2, '0');

/**
 * The manifest as flat lookup tables (no DOM: Node tests build it too). slotFor(clip, phase) gives a frame
 * slot (clips in manifest order, frames in order); direction(tier, slot, ...) the nearest direction that
 * slot's clip has in that tier; entry(slot, d, look) the offset of its record in tiers[tier].rects: page (an
 * index into tiers[tier].pages, which lists the base pages then each variant's), atlas x, y, w, h, the rect's
 * top-left relative to the frame's own feet anchor (dx, dy, px) and the frame's own px per metre.
 */
export class AtlasLayout {
  constructor(manifest) {
    this.manifest = manifest;
    this.n = manifest.camera.directions;
    this.elevation = (manifest.camera.elevation_deg * Math.PI) / 180;
    this.clips = {};
    this.clipNames = Object.keys(manifest.clips);
    let slots = 0;
    for (const [name, c] of Object.entries(manifest.clips)) {
      this.clips[name] = { start: slots, count: c.frames.length, metresPerCycle: c.metres_per_cycle || 0 };
      slots += c.frames.length;
    }
    this.slots = slots;
    this.slotClip = new Uint8Array(slots);
    this.clipNames.forEach((name, ci) => { const c = this.clips[name]; this.slotClip.fill(ci, c.start, c.start + c.count); });
    this.walkMetres = (this.clips.walk && this.clips.walk.metresPerCycle) || 1.2;
    this.missing = [];
    this.tiers = {};
    const n = this.n;
    const all = [...Array(n).keys()];
    for (const [tier, T] of Object.entries(manifest.tiers)) {
      // looks: the base figure, then each field-tier variant (its pages follow the base pages)
      const looks = [{ name: 'base', src: T, base: 0 }];
      const pages = T.pages.map((p) => ({ ...p, look: 'base' }));
      for (const [name, V] of Object.entries(T.variants || {})) {
        if (!V || !V.pages || !V.frames) continue;
        looks.push({ name, src: V, base: pages.length });
        for (const p of V.pages) pages.push({ ...p, look: name });
      }
      // directions each clip has (listed AND present for every frame of the clip in the base look)
      const avail = {};
      for (const [name, c] of Object.entries(this.clips)) {
        const listed = (T.directionsByClip && T.directionsByClip[name]) || T.directionsRendered || all;
        const have = listed.filter((d) => d >= 0 && d < n && [...Array(c.count).keys()].every((k) => T.frames[`${name}_${k}_d${pad2(d)}`]));
        for (const d of listed) for (let k = 0; k < c.count; k++) if (!T.frames[`${name}_${k}_d${pad2(d)}`]) this.missing.push(`${tier}:${name}_${k}_d${pad2(d)}`);
        avail[name] = have.sort((a, b) => a - b);
      }
      const dirTable = new Uint8Array(this.clipNames.length * n * DIR_RES);
      this.clipNames.forEach((name, ci) => {
        const av = avail[name].length ? avail[name] : avail.stand && avail.stand.length ? avail.stand : all;
        for (let b = 0; b < n * DIR_RES; b++) dirTable[ci * n * DIR_RES + b] = nearestDirection((b + 0.5) / DIR_RES, av, n);
      });
      const rects = new Float32Array(looks.length * slots * n * REC);
      looks.forEach((look, li) => {
        for (const [name, c] of Object.entries(this.clips)) {
          const own = avail[name].length ? avail[name] : null;
          const tc = T.clips && T.clips[name];
          for (let k = 0; k < c.count; k++) {
            for (let d = 0; d < n; d++) {
              // a direction the clip lacks holds the nearest one it has (direction() never asks for it)
              const dd = own ? nearestDirection(d, own, n) : d;
              const key = own ? `${name}_${k}_d${pad2(dd)}` : `stand_0_d${pad2(nearestDirection(d, avail.stand && avail.stand.length ? avail.stand : all, n))}`;
              let f = look.src.frames[key], pageBase = look.base;
              if (!f && li) { f = T.frames[key]; pageBase = 0; } // a variant without this frame: the base figure's
              if (!f) continue; // w stays 0: push() skips it
              const ac = tc && tc.anchors && tc.anchors[dd];
              const ax = f.ax ?? (ac ? ac[0] : T.anchor[0]);
              const ay = f.ay ?? (ac ? ac[1] : T.anchor[1]);
              const ppm = f.ppm ?? (tc && tc.pxPerMetre) ?? T.pxPerMetre;
              const o = (((li * slots) + c.start + k) * n + d) * REC;
              rects[o] = pageBase + f.page; rects[o + 1] = f.x; rects[o + 2] = f.y; rects[o + 3] = f.w; rects[o + 4] = f.h;
              rects[o + 5] = f.ox - ax; rects[o + 6] = f.oy - ay; rects[o + 7] = ppm;
            }
          }
        }
      });
      this.tiers[tier] = {
        ppm: T.pxPerMetre, anchor: T.anchor, frameSize: T.frameSize, pages, rects, avail, dirTable,
        looks: looks.map((l) => l.name),
        bytes: pages.reduce((s, p) => s + p.w * p.h * 4, 0), // RGBA8, before mipmaps
      };
    }
  }

  /** Frame slot for a pose code (BAKE_CLIP) and its phase: WALK cycles walked (wraps), LOAD 0..1 of the loading. */
  slotFor(clip, phase = 0) {
    const C = this.clips;
    const pick = (name, k) => { const c = C[name]; return c ? c.start + Math.min(c.count - 1, k) : C.stand ? C.stand.start : 0; };
    switch (clip) {
      case BAKE_CLIP.WALK: {
        const c = C.walk;
        if (!c) return pick('stand', 0);
        const f = phase - Math.floor(phase);
        return c.start + (Math.floor(f * c.count) % c.count);
      }
      case BAKE_CLIP.LOAD: {
        const c = C.load;
        if (!c) return pick('stand', 0);
        const p = Math.min(1, Math.max(0, phase || 0));
        return c.start + Math.min(c.count - 1, Math.floor(p * c.count));
      }
      case BAKE_CLIP.AIM: return pick('fire', 0);
      case BAKE_CLIP.FIRE: return pick('fire', 1);
      case BAKE_CLIP.RECOVER: return pick('fire', 2);
      case BAKE_CLIP.FALLEN: return pick('fallen', 0);
      default: return pick('stand', 0);
    }
  }

  /** The direction to draw a frame slot in, in a tier: the nearest one its clip has there. */
  direction(tier, slot, yaw, x, z, cx, cz) {
    const n = this.n;
    let u = (yaw - Math.atan2(cx - x, cz - z)) / TAU;
    u -= Math.floor(u);
    const bin = Math.min(n * DIR_RES - 1, Math.floor(u * n * DIR_RES));
    return this.tiers[tier].dirTable[this.slotClip[slot] * n * DIR_RES + bin];
  }

  /** Which look (0 base, then the tier's variants) man number `man` wears in a tier. */
  lookFor(tier, man) { return variantIndex(man, this.tiers[tier].looks.length); }

  entry(slot, d, look = 0) { return ((look * this.slots + slot) * this.n + d) * REC; }

  /** Frame records whose rect leaves its page (empty when the manifest is sound). */
  problems() {
    const out = [];
    for (const [tier, T] of Object.entries(this.tiers)) {
      const R = T.rects;
      for (let o = 0; o < R.length; o += REC) {
        const p = T.pages[R[o]];
        if (!p || R[o + 3] <= 0 || R[o + 1] < 0 || R[o + 2] < 0 || R[o + 1] + R[o + 3] > p.w || R[o + 2] + R[o + 4] > p.h || !(R[o + 7] > 0)) out.push(`${tier} record ${o / REC}`);
      }
    }
    return out;
  }
}

/** The atlas in the browser: the manifest, then each tier's pages (base and variants) as textures on request. */
export class BakedAtlas {
  constructor(manifest, base = BAKED_BASE) {
    this.layout = new AtlasLayout(manifest);
    this.base = base;
    this.textures = {};
    this.state = {};
    this.pools = [];
  }

  /** Load a tier's pages (premultiplied, mipmapped); attached pools then build its batches. */
  load(tier) {
    if (this.state[tier]) return this.state[tier];
    const T = this.layout.tiers[tier];
    const loader = new THREE.TextureLoader();
    this.state[tier] = Promise.all(T.pages.map((p) => loader.loadAsync(this.base + p.file))).then((texs) => {
      for (const t of texs) {
        t.flipY = false; // atlas y runs down, as the manifest's rects do
        t.premultiplyAlpha = true;
        t.colorSpace = THREE.NoColorSpace; // decoded in the shader, after un-premultiplying
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.needsUpdate = true;
      }
      this.textures[tier] = texs;
      for (const pool of this.pools) pool.addTier(tier);
      return texs;
    });
    return this.state[tier];
  }

  loaded(tier) { return !!this.textures[tier]; }

  /** Graphics memory of the loaded pages, RGBA8 with mipmaps (x 4/3), in bytes. */
  memoryBytes() {
    let b = 0;
    for (const tier of Object.keys(this.textures)) b += this.layout.tiers[tier].bytes * (4 / 3);
    return Math.round(b);
  }
}

/** Fetch the manifest and the field pages; resolves once sprites can draw. */
export async function loadBakedAtlas(base = BAKED_BASE) {
  const res = await fetch(`${base}soldier.json`);
  if (!res.ok) throw new Error(`baked figures: HTTP ${res.status} for ${base}soldier.json`);
  const atlas = new BakedAtlas(await res.json(), base);
  await atlas.load('field');
  return atlas;
}

const VERT = /* glsl */ `
  attribute vec4 iPos;   // feet x, y, z; world metres per atlas pixel (this frame's own scale)
  attribute vec4 iRect;  // atlas rect x, y, w, h (px, y down)
  attribute vec4 iOff;   // rect top-left from this frame's feet anchor (px, y down); variation 0..1; compare clip
  uniform float uCosBake;
  uniform float uSoftFar; // soft pass only: men farther than this (view metres) draw no edges or shadow
  varying vec2 vPx;
  varying vec4 vRect;
  varying float vVar;
  varying float vClip;
  #include <fog_pars_vertex>
  void main() {
    vRect = iRect;
    vVar = iOff.z;
    vClip = iOff.w;
    vec2 corner = position.xy; // 0..1 across and down the rect
    vPx = iRect.xy + corner * iRect.zw;
    vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float se = clamp(dot(normalize(-mvPosition.xyz), upV), 0.05, 0.99); // sine of the view elevation
    float ce = sqrt(1.0 - se * se);
    float vs = clamp(ce / uCosBake, 0.8, 1.15);
    vec2 px = iOff.xy + corner * iRect.zw;
    #if SOFT
      bool softOff = length(mvPosition.xyz) > uSoftFar;
    #endif
    mvPosition.xyz += vec3(px.x * iPos.w, -px.y * iPos.w * vs, 0.0);
    // pull toward the eye along this vertex's own ray (screen position unchanged): ground in front of the feet
    // lies about below / tan(elevation) nearer than the feet, and the shadow is drawn there. "below" is how far
    // this frame's trimmed rect reaches under the feet.
    float below = max(iOff.y + iRect.w, 0.0) * iPos.w * vs;
    float pull = below / max(se / ce, 0.3) + below * 0.5;
    mvPosition.xyz *= max(0.05, 1.0 - pull / length(mvPosition.xyz));
    gl_Position = projectionMatrix * mvPosition;
    #if SOFT
      if (softOff) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume: no fragments
    #endif
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uPage;
  uniform float uMaxLod;
  uniform float uTint;
  uniform float uExposure;
  varying vec2 vPx;
  varying vec4 vRect;
  varying float vVar;
  ${CLIP_FRAG}
  #include <fog_pars_fragment>
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  // inverse of post.js's ACES fit: the scene value that the post chain maps back to display value y
  vec3 acesInv(vec3 y) {
    y = min(y, vec3(0.97));
    vec3 a = 2.51 - 2.43 * y, b = 0.03 - 0.59 * y, c = -0.14 * y;
    return (-b + sqrt(b * b - 4.0 * a * c)) / (2.0 * a);
  }
  void main() {
    vec2 dx = dFdx(vPx), dy = dFdy(vPx);
    float lod = clamp(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0, uMaxLod);
    if (clipped()) discard;
    float inset = 0.5 * exp2(lod);
    vec2 p = clamp(vPx, vRect.xy + inset, vRect.xy + vRect.zw - inset);
    vec4 t = textureLod(uMap, p / uPage, lod);
    #if SOFT
      if (t.a >= ${ALPHA_CUT.toFixed(2)} || t.a < 0.02) discard;
    #else
      if (t.a < ${ALPHA_CUT.toFixed(2)}) discard;
    #endif
    vec3 c = toLinear(t.rgb / max(t.a, 0.001)); // un-premultiply, then decode sRGB
    if (uTint > 0.5) {
      // PLACEHOLDER Confederate: blue cloth (coat, trousers, kepi) becomes grey to butternut, per man
      float blue = clamp((c.b - max(c.r, c.g)) / max(c.b, 0.001) * 2.5, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 cloth = mix(vec3(0.30, 0.29, 0.26), vec3(0.36, 0.25, 0.12), vVar);
      c = mix(c, cloth * (0.45 + 2.2 * l), blue);
    } else {
      c *= 0.92 + 0.16 * vVar; // a little difference between men
    }
    c = acesInv(c) / uExposure;
    #ifdef USE_FOG
      c = mix(c, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
    #endif
    #if SOFT
      gl_FragColor = vec4(c * t.a, t.a);
    #else
      gl_FragColor = vec4(c, 1.0);
    #endif
  }
`;

let quadGeo = null;
function quad() {
  if (quadGeo) return quadGeo;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  quadGeo = g;
  return g;
}

/**
 * One side's baked infantry. Each frame: begin(), push() every man drawn as a sprite, flush() (which also
 * re-pushes the casualties: their baked direction follows the camera). Draws nothing until attach(atlas).
 */
export class ImpostorPool {
  constructor(capacity, { side = 'US', tint = 0 } = {}) {
    this.capacity = capacity;
    this.side = side;
    this.tint = tint;
    this.group = new THREE.Group();
    this.group.name = `baked-${side}`;
    this.group.visible = false;
    this.atlas = null;
    this.layout = null;
    this.batches = { field: [], close: [] };
    this.cam = new THREE.Vector3(0, 800, 0);
    this.fallen = new Float32Array(capacity * FALLEN_REC);
    this.nFallen = 0;
    this.standing = 0; // men pushed this frame (not counting casualties)
    this.drawn = 0;
    this.poses = new Uint32Array(8); // men pushed this frame per pose code (BAKE_CLIP), casualties included
    this.looks = new Uint32Array(8); // men pushed this frame per look (0 base, then variants)
    this.softPass = true; // profiling switches (main.js ?bakesoft=0 / ?bakeclose=0 / ?bakesoftfar=m)
    this.allowClose = true;
    this.softFar = 1e9; // view metres: men farther draw no soft pass (edges and shadow); default everywhere
  }

  get mesh() { return this.group; }
  get ready() { return !!(this.layout && this.batches.field.length); }

  attach(atlas) {
    this.atlas = atlas;
    this.layout = atlas.layout;
    atlas.pools.push(this);
    for (const tier of Object.keys(atlas.textures)) this.addTier(tier);
  }

  /** Build the instanced batches (one per page, two passes each) for a loaded tier. */
  addTier(tier) {
    if (this.batches[tier].length || !this.atlas.textures[tier]) return;
    const T = this.layout.tiers[tier];
    this.atlas.textures[tier].forEach((tex, page) => {
      const data = new Float32Array(this.capacity * STRIDE);
      const buf = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
      buf.setUsage(THREE.DynamicDrawUsage);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad().index;
      geo.setAttribute('position', quad().attributes.position);
      geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
      geo.setAttribute('iRect', new THREE.InterleavedBufferAttribute(buf, 4, 4));
      geo.setAttribute('iOff', new THREE.InterleavedBufferAttribute(buf, 4, 8));
      geo.instanceCount = 0;
      const uniforms = {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uMap: { value: tex },
        uPage: { value: new THREE.Vector2(T.pages[page].w, T.pages[page].h) },
        uMaxLod: { value: MAX_LOD[tier] ?? 1 },
        uTint: { value: this.tint },
        uExposure: { value: BAKE_EXPOSURE },
        uCosBake: { value: Math.cos(this.layout.elevation) },
        uSoftFar: { value: this.softFar },
        uSplit: { value: 0 },
      };
      const mat = (soft) => new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, defines: { SOFT: soft ? 1 : 0 },
        side: THREE.DoubleSide,
        transparent: soft, depthWrite: !soft,
        ...(soft ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } : {}),
      });
      const split = splitHook(uniforms);
      const hook = (renderer) => { uniforms.uSoftFar.value = this.softFar; split(renderer); };
      const body = new THREE.Mesh(geo, mat(false));
      const soft = new THREE.Mesh(geo, mat(true));
      // before the musket smoke (three.quarks batch, 0) and the state halos (1): drawn after the smoke, the edge and
      // shadow pass painted over it and left the men in a puff as white cut-outs; a halo stays readable over the shadow
      soft.renderOrder = -1;
      for (const [m, kind] of [[body, 'body'], [soft, 'soft']]) {
        m.frustumCulled = false;
        m.visible = false;
        m.onBeforeRender = hook;
        m.name = `baked-${this.side}-${tier}${page}-${kind}`;
        this.group.add(m);
      }
      this.batches[tier].push({ tier, page, look: T.pages[page].look, data, buf, geo, body, soft, n: 0 });
    });
  }

  setView(camera) { this.cam.copy(camera.position); }

  begin() {
    for (const tier of ['field', 'close']) for (const b of this.batches[tier]) b.n = 0;
    this.standing = 0;
    this.poses.fill(0);
    this.looks.fill(0);
  }

  /**
   * One man as a sprite: feet position, yaw, world scale per life metre, pose (BAKE_CLIP), phase (WALK: cycles
   * walked; LOAD: 0..1 of his loading), variation 0..1, compare clip, man number (picks his look).
   */
  push(x, y, z, yaw, s, clip, phase, variation, side, man = 0) {
    if (!this.ready) return false;
    const L = this.layout;
    const cx = this.cam.x, cy = this.cam.y, cz = this.cam.z;
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
    let tier = 'field';
    if (this.allowClose && d2 < LOD_NEAR * LOD_NEAR) {
      if (this.batches.close.length) tier = 'close';
      else if (this.atlas && L.tiers.close && !this.atlas.state.close) this.atlas.load('close').catch((e) => console.warn('baked figures: close tier not loaded:', e && e.message ? e.message : e));
    }
    const T = L.tiers[tier];
    const slot = L.slotFor(clip, phase);
    const look = L.lookFor(tier, man);
    const o = L.entry(slot, L.direction(tier, slot, yaw, x, z, cx, cz), look);
    const R = T.rects;
    if (!(R[o + 3] > 0)) return false;
    const b = this.batches[tier][R[o]];
    if (!b || b.n >= this.capacity) return false;
    const a = b.data;
    const i = b.n++ * STRIDE;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = s / R[o + 7];
    a[i + 4] = R[o + 1]; a[i + 5] = R[o + 2]; a[i + 6] = R[o + 3]; a[i + 7] = R[o + 4];
    a[i + 8] = R[o + 5]; a[i + 9] = R[o + 6]; a[i + 10] = variation; a[i + 11] = side;
    if (clip !== BAKE_CLIP.FALLEN) this.standing++;
    this.poses[clip & 7]++;
    this.looks[look & 7]++;
    return true;
  }

  /** A casualty lying where he fell (kept for the rest of the battle). */
  addFallen(x, y, z, yaw, s, variation, man = 0) {
    if (this.nFallen >= this.capacity) return;
    const f = this.fallen, o = this.nFallen++ * FALLEN_REC;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = yaw; f[o + 4] = s; f[o + 5] = variation; f[o + 6] = man;
  }

  flush() {
    const visible = this.group.visible = FIGURE_VIEW.baked && this.ready;
    if (visible) {
      const f = this.fallen, clip = FIGURE_VIEW.clipBaked;
      for (let j = 0; j < this.nFallen; j++) {
        const o = j * FALLEN_REC;
        this.push(f[o], f[o + 1], f[o + 2], f[o + 3], f[o + 4], BAKE_CLIP.FALLEN, 0, f[o + 5], clip, f[o + 6]);
      }
    }
    let drawn = 0;
    for (const tier of ['field', 'close']) {
      for (const b of this.batches[tier]) {
        const n = visible ? b.n : 0;
        b.geo.instanceCount = n;
        b.body.visible = n > 0;
        b.soft.visible = n > 0 && this.softPass;
        drawn += n;
        if (!n) continue;
        b.buf.clearUpdateRanges();
        b.buf.addUpdateRange(0, n * STRIDE);
        b.buf.needsUpdate = true;
      }
    }
    this.drawn = drawn;
  }

  /** Every instance drawn this frame whose atlas rect leaves its page (for the tests; empty when sound). */
  rectProblems() {
    const out = [];
    for (const tier of ['field', 'close']) {
      for (const b of this.batches[tier]) {
        const p = this.layout.tiers[tier].pages[b.page];
        for (let i = 0; i < b.n; i++) {
          const k = i * STRIDE;
          const [x, y, w, h] = [b.data[k + 4], b.data[k + 5], b.data[k + 6], b.data[k + 7]];
          if (!(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= p.w && y + h <= p.h)) out.push(`${tier}${b.page}#${i} (${x},${y},${w},${h}) on ${p.w}x${p.h}`);
        }
      }
    }
    return out;
  }

  /** Draw calls this pool issues this frame (two passes per batch in use). */
  drawCalls() {
    let c = 0;
    for (const tier of ['field', 'close']) for (const b of this.batches[tier]) c += (b.body.visible ? 1 : 0) + (b.soft.visible ? 1 : 0);
    return c;
  }
}

// src/units/impostor.js: baked soldiers drawn as camera-facing sprites ("impostors") from the bake atlas.
//
// The bake (branch `bake`, tools/bake/README.md) renders one Union infantryman in Blender from 16 directions,
// lighting and ground shadow included, and packs the frames into atlas pages with a manifest
// (assets/figures/union-infantry/soldier.json): per frame its page rect and its offset inside the untrimmed
// frame, per tier the feet anchor and pixels per metre, the clips and the direction rule. Two tiers: 'field'
// (96 px frames, one 1024x1224 page) for everyone, 'close' (256 px frames, four 2048-wide pages) for men
// inside LOD_NEAR of the camera; the close pages load only when first needed.
//
// Drawing: per side and per atlas page one instanced quad (InstancedBufferGeometry, one interleaved buffer
// of 12 floats a man, uploaded once a frame). The quad is a view-space billboard standing on the feet anchor:
// one atlas pixel = FIGURE_SCALE * look.figureScale / pxPerMetre world metres, so the man is the same height
// as the rigged figure (life 1.73 m x 4.4). Its height is corrected by cos(view elevation) / cos(bake
// elevation, 35 deg) so a man seen from higher up is foreshortened as the rigged ones are (clamped 0.8-1.15).
// Each vertex is pulled toward the eye along its own ray (the picture on screen is unchanged) far enough that
// the part of the frame below the feet, where the baked shadow lies, is not buried in the ground.
//
// Two passes per page, neither needs sorting: an opaque alpha-tested pass (alpha >= 0.88: the body) that
// writes depth, then a soft pass (premultiplied blend, no depth write) for the antialiased edges and the
// baked shadow (alpha about 0.8, black: blending black over black is order-independent). The atlas is
// premultiplied on upload and un-premultiplied after filtering, so edges have no dark fringe; the mip level
// is capped (field 2, close 1: the pages have 2-pixel gaps) and the sample point is clamped inside the frame
// rect, so atlas neighbours do not bleed in. The sprite's colours are display colours (the bake's AgX view):
// the shader inverts the post chain's ACES curve and exposure (src/render/post.js) so the sprite reaches the
// screen as baked, before the shared warm grade.
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
export const BAKE_CLIP = { STAND: 0, WALK: 1, AIM: 2, FIRE: 3, RECOVER: 4, FALLEN: 5 };
const TAU = Math.PI * 2;
const ALPHA_CUT = 0.88; // body pixels are opaque; the baked shadow peaks near alpha 0.8
const MAX_LOD = { field: 2, close: 1 };
const BAKE_EXPOSURE = 0.66; // post.js finalMat uExposure: the sprite undoes it so it lands on screen as baked
const STRIDE = 12; // floats per instance: x y z s | rect x y w h | dx dy variation clip
const REC = 7; // floats per frame record: page u v w h dx dy

/**
 * Baked direction for a man facing `yaw` (forward = (sin yaw, cos yaw)) at (x, z), seen from a camera at
 * (cx, cz). The bake's rule: direction d faces d * 360/n degrees counter-clockwise, seen from above, from
 * "toward the camera" (0 faces the viewer, n/4 faces screen-right). In this world a growing yaw turns
 * counter-clockwise seen from above, so d = round((yaw - bearing of the camera) / (360/n)), wrapped.
 */
export function directionIndex(yaw, x, z, cx, cz, n = 16) {
  const toCam = Math.atan2(cx - x, cz - z);
  const k = Math.round(((yaw - toCam) / TAU) * n);
  return ((k % n) + n) % n;
}

/**
 * The manifest as flat lookup tables (no DOM: Node tests build it too). slotFor(clip, phase) gives a frame
 * slot (clips in manifest order, frames in order); entry(tier, slot, d) the offset of its record in
 * tiers[tier].rects: page, atlas x, y, w, h, and the rect's top-left relative to the feet anchor (dx, dy).
 */
export class AtlasLayout {
  constructor(manifest) {
    this.manifest = manifest;
    this.n = manifest.camera.directions;
    this.elevation = (manifest.camera.elevation_deg * Math.PI) / 180;
    this.clips = {};
    let slots = 0;
    for (const [name, c] of Object.entries(manifest.clips)) {
      this.clips[name] = { start: slots, count: c.frames.length, metresPerCycle: c.metres_per_cycle || 0 };
      slots += c.frames.length;
    }
    this.slots = slots;
    this.walkMetres = (this.clips.walk && this.clips.walk.metresPerCycle) || 1.2;
    this.missing = [];
    this.tiers = {};
    for (const [tier, T] of Object.entries(manifest.tiers)) {
      const rects = new Float32Array(slots * this.n * REC);
      for (const [name, c] of Object.entries(this.clips)) {
        for (let k = 0; k < c.count; k++) {
          for (let d = 0; d < this.n; d++) {
            const key = `${name}_${k}_d${String(d).padStart(2, '0')}`;
            let f = T.frames[key];
            if (!f) { this.missing.push(`${tier}:${key}`); f = T.frames[`stand_0_d${String(d).padStart(2, '0')}`]; }
            if (!f) continue; // w stays 0: push() skips it
            const o = ((c.start + k) * this.n + d) * REC;
            rects[o] = f.page; rects[o + 1] = f.x; rects[o + 2] = f.y; rects[o + 3] = f.w; rects[o + 4] = f.h;
            rects[o + 5] = f.ox - T.anchor[0]; rects[o + 6] = f.oy - T.anchor[1];
          }
        }
      }
      this.tiers[tier] = {
        ppm: T.pxPerMetre, anchor: T.anchor, frameSize: T.frameSize, pages: T.pages, rects,
        below: T.frameSize - T.anchor[1], // px from the feet to the frame's bottom edge (the shadow side)
        bytes: T.pages.reduce((s, p) => s + p.w * p.h * 4, 0), // RGBA8, before mipmaps
      };
    }
  }

  /** Frame slot for a pose code (BAKE_CLIP) and, for WALK, the cycle phase (cycles walked; wraps). */
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
      case BAKE_CLIP.AIM: return pick('fire', 0);
      case BAKE_CLIP.FIRE: return pick('fire', 1);
      case BAKE_CLIP.RECOVER: return pick('fire', 2);
      case BAKE_CLIP.FALLEN: return pick('fallen', 0);
      default: return pick('stand', 0);
    }
  }

  entry(slot, d) { return (slot * this.n + d) * REC; }

  /** Frame records whose rect leaves its page (empty when the manifest is sound). */
  problems() {
    const out = [];
    for (const [tier, T] of Object.entries(this.tiers)) {
      const R = T.rects;
      for (let o = 0; o < R.length; o += REC) {
        const p = T.pages[R[o]];
        if (!p || R[o + 3] <= 0 || R[o + 1] < 0 || R[o + 2] < 0 || R[o + 1] + R[o + 3] > p.w || R[o + 2] + R[o + 4] > p.h) out.push(`${tier} record ${o / REC}`);
      }
    }
    return out;
  }
}

/** The atlas in the browser: the manifest, then each tier's pages as textures on request. */
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
  attribute vec4 iPos;   // feet x, y, z; world metres per atlas pixel
  attribute vec4 iRect;  // atlas rect x, y, w, h (px, y down)
  attribute vec4 iOff;   // rect top-left from the feet anchor (px, y down); variation 0..1; compare clip
  uniform float uBelow;  // atlas px from the feet down to the frame's bottom edge
  uniform float uCosBake;
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
    mvPosition.xyz += vec3(px.x * iPos.w, -px.y * iPos.w * vs, 0.0);
    // pull toward the eye along this vertex's own ray (screen position unchanged): ground in front of the feet
    // lies about below / tan(elevation) nearer than the feet, and the shadow is drawn there
    float below = uBelow * iPos.w * vs;
    float pull = below / max(se / ce, 0.3) + below * 0.5;
    mvPosition.xyz *= max(0.05, 1.0 - pull / length(mvPosition.xyz));
    gl_Position = projectionMatrix * mvPosition;
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
    this.fallen = new Float32Array(capacity * 6); // x y z yaw s variation
    this.nFallen = 0;
    this.standing = 0; // men pushed this frame (not counting casualties)
    this.drawn = 0;
    this.softPass = true; // profiling switches (main.js ?bakesoft=0 / ?bakeclose=0): edges + shadow pass, close tier
    this.allowClose = true;
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
        uBelow: { value: T.below },
        uCosBake: { value: Math.cos(this.layout.elevation) },
        uSplit: { value: 0 },
      };
      const mat = (soft) => new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, defines: { SOFT: soft ? 1 : 0 },
        side: THREE.DoubleSide,
        transparent: soft, depthWrite: !soft,
        ...(soft ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } : {}),
      });
      const hook = splitHook(uniforms);
      const body = new THREE.Mesh(geo, mat(false));
      const soft = new THREE.Mesh(geo, mat(true));
      soft.renderOrder = 0; // before the state halos (1): a halo at the feet stays readable over the shadow
      for (const [m, kind] of [[body, 'body'], [soft, 'soft']]) {
        m.frustumCulled = false;
        m.visible = false;
        m.onBeforeRender = hook;
        m.name = `baked-${this.side}-${tier}${page}-${kind}`;
        this.group.add(m);
      }
      this.batches[tier].push({ tier, page, data, buf, geo, body, soft, n: 0 });
    });
  }

  setView(camera) { this.cam.copy(camera.position); }

  begin() {
    for (const tier of ['field', 'close']) for (const b of this.batches[tier]) b.n = 0;
    this.standing = 0;
  }

  /** One man as a sprite: feet position, yaw, world scale per life metre, pose (BAKE_CLIP), walk phase in cycles, variation 0..1, compare clip. */
  push(x, y, z, yaw, s, clip, phase, variation, side) {
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
    const o = L.entry(L.slotFor(clip, phase), directionIndex(yaw, x, z, cx, cz, L.n));
    const R = T.rects;
    if (!(R[o + 3] > 0)) return false;
    const b = this.batches[tier][R[o]];
    if (!b || b.n >= this.capacity) return false;
    const a = b.data;
    const i = b.n++ * STRIDE;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = s / T.ppm;
    a[i + 4] = R[o + 1]; a[i + 5] = R[o + 2]; a[i + 6] = R[o + 3]; a[i + 7] = R[o + 4];
    a[i + 8] = R[o + 5]; a[i + 9] = R[o + 6]; a[i + 10] = variation; a[i + 11] = side;
    if (clip !== BAKE_CLIP.FALLEN) this.standing++;
    return true;
  }

  /** A casualty lying where he fell (kept for the rest of the battle). */
  addFallen(x, y, z, yaw, s, variation) {
    if (this.nFallen >= this.capacity) return;
    const f = this.fallen, o = this.nFallen++ * 6;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = yaw; f[o + 4] = s; f[o + 5] = variation;
  }

  flush() {
    const visible = this.group.visible = FIGURE_VIEW.baked && this.ready;
    if (visible) {
      const f = this.fallen, clip = FIGURE_VIEW.clipBaked;
      for (let j = 0; j < this.nFallen; j++) {
        const o = j * 6;
        this.push(f[o], f[o + 1], f[o + 2], f[o + 3], f[o + 4], BAKE_CLIP.FALLEN, 0, f[o + 5], clip);
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

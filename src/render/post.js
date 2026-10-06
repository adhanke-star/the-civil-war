// src/render/post.js: the UG:G look in one cheap post chain (tuned for an Intel UHD 617).
//
//   scene -> rtScene (HalfFloat, optional MSAA, at renderScale)
//   rtScene -> rtSmall (quarter size, 4-tap box) -> blur H -> blur V
//   final (to screen): a contrast-limited sharpen (stronger when the canvas is upscaled), tilt-shift mix by
//   screen height, filmic tone map, warm grade with cool shadows, saturation, purple-dark vignette, sRGB
//   encode, dither.
//
// Quality (render scale = render pixels per CSS pixel):
//   High: full device pixel ratio capped at 2.   Low: 0.7.   No level uses MSAA (see _samplesFor).
//   Auto (default): starts at High, or at the level for the GPU's detect-gpu tier once known; after 3 s
//   averaging under 30 fps it steps one level down (two under 18 fps); after 3 s over 50 fps it steps back
//   up. A level that failed is not retried for 20 s. A step down that does not raise the frame rate by 8%
//   is undone and Auto holds that level for 60 s: the frame is then bound by vertex or script work, and a
//   lower resolution would only blur the picture (DECISIONS 0012).

import * as THREE from 'three';
import { LOOK } from '../ui/look.js';
import { on } from '../settings.js';

export const QUALITY_MODES = ['auto', 'high', 'low'];
const LOW_SCALE = 0.7;
const AUTO_LEVELS = [2, 1.6, 1.3, 1, 0.85, 0.7, 0.6];

const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function fsMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: fullscreenVert, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

export class Post {
  constructor(renderer, { mode = 'auto' } = {}) {
    this.renderer = renderer;
    this.maxScale = Math.min(window.devicePixelRatio || 1, 2);
    this.levels = AUTO_LEVELS.filter((l) => l <= this.maxScale + 1e-6);
    if (this.levels[0] !== this.maxScale) this.levels.unshift(this.maxScale);
    this.mode = mode;
    this.level = 0;
    this.scale = this.maxScale;
    this.samples = this._samplesFor(this.scale);
    this.width = 1;
    this.height = 1;
    this.enabled = true;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.rtSmall = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtBlur = new THREE.WebGLRenderTarget(1, 1, rtOpts);

    this.downMat = fsMaterial(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
               + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.blurMat = fsMaterial(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
        c += (texture2D(tSrc, vUv + uDir * 1.384615).rgb + texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
        c += (texture2D(tSrc, vUv + uDir * 3.230769).rgb + texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });

    this.finalMat = fsMaterial(/* glsl */ `
      uniform sampler2D tSharp; uniform sampler2D tBlur;
      uniform vec2 uTexel; uniform float uSharp;
      uniform float uAspect; uniform float uTiltCenter; uniform float uTiltBand; uniform float uTilt;
      uniform float uExposure; uniform float uSaturation; uniform float uVignette;
      varying vec2 vUv;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 c = texture2D(tSharp, vUv).rgb;
        vec3 cn = texture2D(tSharp, vUv + vec2(0.0, uTexel.y)).rgb;
        vec3 cs = texture2D(tSharp, vUv - vec2(0.0, uTexel.y)).rgb;
        vec3 ce = texture2D(tSharp, vUv + vec2(uTexel.x, 0.0)).rgb;
        vec3 cw = texture2D(tSharp, vUv - vec2(uTexel.x, 0.0)).rgb;
        // unsharp mask clamped to the local min/max: crisper figure edges without bright or dark halos
        vec3 lo = min(c, min(min(cn, cs), min(ce, cw)));
        vec3 hi = max(c, max(max(cn, cs), max(ce, cw)));
        vec3 sharp = clamp(c + (c - (cn + cs + ce + cw) * 0.25) * uSharp, lo, hi);
        vec3 blur = texture2D(tBlur, vUv).rgb;
        // tilt-shift: stronger toward the top (far) edge, lighter toward the bottom (near) edge
        float dy = vUv.y - uTiltCenter;
        float d = dy > 0.0 ? dy * 1.25 : -dy * 0.9;
        float t = smoothstep(uTiltBand, uTiltBand + 0.32, d) * uTilt;
        float dx = abs(vUv.x - 0.5);
        t = max(t, smoothstep(0.44, 0.54, dx) * uTilt * 0.4);
        vec3 col = mix(sharp, blur, t);

        col = aces(col * uExposure);
        // grade: cool violet shadows, warm golden highlights
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadowTint = vec3(0.78, 0.84, 1.16);
        vec3 highTint = vec3(1.05, 1.0, 0.88);
        col *= mix(shadowTint, highTint, smoothstep(0.05, 0.75, l));
        col = mix(vec3(l), col, uSaturation);
        // vignette toward deep violet
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        float v = smoothstep(0.32, 1.0, length(q * vec2(0.8, 1.1)));
        col = mix(col, col * vec3(0.3, 0.25, 0.46) + vec3(0.012, 0.008, 0.03), min(1.0, v * uVignette));
        col = clamp(col, 0.0, 1.0);
        // sRGB encode
        col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
        col += (rand(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`, {
      tSharp: { value: null },
      tBlur: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uSharp: { value: 0.4 },
      uAspect: { value: 1 },
      // the sharp band runs from 19% to 69% of the screen height, where the fighting line sits
      uTiltCenter: { value: 0.46 },
      uTiltBand: { value: 0.24 },
      uTilt: { value: LOOK.tiltShift },
      uExposure: { value: 0.66 },
      uSaturation: { value: LOOK.saturation },
      uVignette: { value: 1.55 },
    });

    on('look.saturation', (v) => { this.finalMat.uniforms.uSaturation.value = v; });
    on('look.tiltShift', (v) => { this.finalMat.uniforms.uTilt.value = v; });

    // governor
    this.samplesLog = []; // [time ms, dt s]
    this.blockedUntil = new Map(); // level index -> time ms before which Auto will not step up to it
    this.probe = null; // { level, fps } after a step down: undone if the frame rate did not rise
    this.holdUntil = 0; // time ms before which Auto will not step below holdLevel
    this.holdLevel = 0;
    this.setMode(mode);
  }

  // MSAA is the costliest pass on the UHD 617: 2x at scale 0.6 ran 30 fps in a fight where scale 0.7
  // without it ran 54, so no level uses it (the figures carry their own outline pass for crisp edges).
  _samplesFor() {
    return 0;
  }

  /**
   * Auto's starting level from a pmndrs/detect-gpu tier (0-3), applied only before Auto has adjusted
   * anything; Auto then governs by measured frame rate as usual (DECISIONS 0003, 0007).
   */
  startFromTier(tier) {
    if (this.mode !== 'auto' || this.adjusted) return false;
    const want = { 3: 2, 2: 1.6, 1: 1.3, 0: 1 }[tier] ?? this.maxScale;
    let best = 0;
    this.levels.forEach((l, i) => { if (Math.abs(l - want) < Math.abs(this.levels[best] - want)) best = i; });
    this.level = best;
    this.scale = this.levels[best];
    this.samplesLog.length = 0;
    this._apply();
    return true;
  }

  setMode(mode) {
    this.mode = QUALITY_MODES.includes(mode) ? mode : 'auto';
    this.level = 0;
    this.scale = this.mode === 'low' ? LOW_SCALE : this.maxScale;
    this.samplesLog.length = 0;
    this.blockedUntil.clear();
    this.probe = null;
    this.holdUntil = 0;
    this._apply();
  }

  _apply() {
    this.renderer.setPixelRatio(this.scale);
    this.renderer.setSize(this.width, this.height, false);
    const n = this._samplesFor(this.scale);
    if (n !== this.samples) {
      this.samples = n;
      this.rtScene.dispose();
      this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: n, depthBuffer: true });
    }
    this._alloc();
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this._apply();
  }

  _alloc() {
    const w = Math.max(1, Math.round(this.width * this.scale));
    const h = Math.max(1, Math.round(this.height * this.scale));
    this.rtScene.setSize(w, h);
    const sw = Math.max(1, w >> 2), sh = Math.max(1, h >> 2);
    this.rtSmall.setSize(sw, sh);
    this.rtBlur.setSize(sw, sh);
    this.finalMat.uniforms.uAspect.value = this.width / this.height;
    this.finalMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    // sharpen more when the browser stretches the canvas (render pixels per device pixel below 1)
    const upscale = (window.devicePixelRatio || 1) / this.scale;
    this.finalMat.uniforms.uSharp.value = Math.min(1, Math.max(0.35, 0.35 + (upscale - 1) * 0.5));
    this.pixels = w * h;
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    if (!this.enabled) {
      // still tone map and grade, but skip the blur
      this.finalMat.uniforms.tSharp.value = this.rtScene.texture;
      this.finalMat.uniforms.tBlur.value = this.rtScene.texture;
      this._pass(this.finalMat, null);
      return;
    }
    const sw = this.rtSmall.width, sh = this.rtSmall.height;
    this.downMat.uniforms.tSrc.value = this.rtScene.texture;
    this.downMat.uniforms.uTexel.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
    this._pass(this.downMat, this.rtSmall);
    this.blurMat.uniforms.tSrc.value = this.rtSmall.texture;
    this.blurMat.uniforms.uDir.value.set(1 / sw, 0);
    this._pass(this.blurMat, this.rtBlur);
    this.blurMat.uniforms.tSrc.value = this.rtBlur.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / sh);
    this._pass(this.blurMat, this.rtSmall);
    this.finalMat.uniforms.tSharp.value = this.rtScene.texture;
    this.finalMat.uniforms.tBlur.value = this.rtSmall.texture;
    this._pass(this.finalMat, null);
  }

  /** Call once per frame (Auto mode only adjusts). */
  govern(dt, now) {
    if (this.mode !== 'auto') return;
    const log = this.samplesLog;
    log.push([now, dt]);
    while (log.length && now - log[0][0] > 3000) log.shift();
    if (log.length < 20 || now - log[0][0] < 2900) return;
    const fps = log.length / log.reduce((a, b) => a + b[1], 0);
    if (this.probe) {
      const p = this.probe;
      this.probe = null;
      if (fps < p.fps * 1.08) {
        // fewer pixels did not help: go back to the sharper level and stay there a while
        this.holdLevel = p.level;
        this.holdUntil = now + 60000;
        this.level = p.level;
        this.scale = this.levels[p.level];
        log.length = 0;
        this._apply();
        return;
      }
    }
    let next = this.level;
    if (fps < 30) next = Math.min(this.levels.length - 1, this.level + (fps < 18 ? 2 : 1));
    else if (fps > 50 && this.level > 0 && !((this.blockedUntil.get(this.level - 1) || 0) > now)) next = this.level - 1;
    if (next > this.level && this.holdUntil > now) next = Math.min(next, Math.max(this.level, this.holdLevel));
    if (next === this.level) return;
    if (next > this.level) {
      this.blockedUntil.set(this.level, now + 20000); // the level we are leaving failed
      this.probe = { level: this.level, fps };
    }
    this.level = next;
    this.scale = this.levels[next];
    this.adjusted = true;
    log.length = 0;
    this._apply();
  }
}

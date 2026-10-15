// src/units/soldier-mesh.js: instanced soldiers animated on the GPU from the baked bone texture.
//
// A SoldierPool is one side's standing men: three InstancedMeshes (full, medium and far detail) that are
// refilled every frame by push(); each man goes to the bucket for his distance from the camera. A fourth
// and fifth mesh draw a 1-px dark outline around the near two levels (inverted hull along the smooth
// normals), which is what makes a 14-px figure read as a painted miniature against the grass. The
// FallenPool holds casualties at fixed indices in the lying poses.
//
// Per-instance attributes:
//   aAnim = (frame position A, frame position B, blend A->B, muzzle flash 0..1)
//   aTint = (coat variation, trouser variation, prop 0 none / 1 musket / 2 rammer, officer 0..1)
//   aClip = split-screen side: 0 everywhere, -1 left of the divider only, +1 right only, 2 hidden
// Side uniforms give the coat, trouser, hat and officer colours (two coats and two trousers, mixed per man).
//
// FIGURE_VIEW is the per-frame figure drawing state the game writes (src/game.js updateFigureView) and the
// units read: which styles draw (rigged 3D figures, baked sprites from src/units/impostor.js, or both while
// look.figureStyle is compared split-screen), each style's clip side, the divider and the figure size.
//
// Gore (look.gore, the Settings panel): FALLEN mirrors it. Off: each casualty lies GORE_FADE.delay seconds, sinks into the
// ground over GORE_FADE.fade seconds and is then hidden (FallenPool here, ImpostorPool in impostor.js). Looks only: the
// pools are drawing state; nothing in the simulation reads them. FALLEN.clock is the fade's clock (main.js: the game's
// simulation time; tests set their own).

import * as THREE from 'three';
import { buildFigureGeometry, boneTexture, BONE_COUNT, CLIP_ROWS, fallenFrame } from './figure.js';
import { define, on, GORE_KEY, GORE_SPEC, GORE_FADE } from '../settings.js';

export const FALLEN = { gore: true, clock: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 };
FALLEN.gore = define(GORE_KEY, GORE_SPEC);
on(GORE_KEY, (v) => { FALLEN.gore = v; });
/** How far a fading casualty has gone: 0 lying, 0..1 sinking, 1 hidden (gore off only). */
export function fadeOf(age, gore = FALLEN.gore) {
  if (gore || !(age > GORE_FADE.delay)) return 0;
  return Math.min(1, (age - GORE_FADE.delay) / GORE_FADE.fade);
}
export const SINK = 0.4; // of the figure scale: how deep a faded casualty sinks before it is hidden

export const FIGURE_SCALE = 4.4; // UG:G-style: figures are enlarged so they read as individuals from the battle camera
export const LOD_NEAR = 300; // m from the camera: full detail inside, medium to LOD_FAR, far beyond
export const LOD_FAR = 700;
export const FIGURE_VIEW = { rigged: true, baked: false, clipRigged: 0, clipBaked: 0, split: 0.5, scale: 1 };

const _vp = new THREE.Vector4();
/** An onBeforeRender hook that puts the compare divider into uSplit, in the current target's pixels. */
export function splitHook(uniforms) {
  return (renderer) => {
    renderer.getCurrentViewport(_vp);
    uniforms.uSplit.value = _vp.x + FIGURE_VIEW.split * _vp.z;
  };
}
/** Fragment prelude: drop the fragment on the other side of the compare divider (vClip from the vertex). */
export const CLIP_FRAG = /* glsl */ `
  uniform float uSplit; varying float vClip;
  bool clipped() { return (vClip < -0.5 && gl_FragCoord.x > uSplit) || (vClip > 0.5 && gl_FragCoord.x < uSplit); }
`;
const OUTLINE_PX = { 2: 1.0, 1: 0.7, 0: 0 }; // outline width per level, in render pixels (0: no outline pass)

const BONE_GLSL = /* glsl */ `
  attribute float aBone;
  attribute float aMat;
  attribute float aProp;
  attribute float aAo;
  attribute vec3 aSmoothN;
  attribute vec4 aAnim;
  attribute vec4 aTint;
  attribute float aClip;
  varying float vClip;
  uniform sampler2D uBones;
  mat4 boneRow(int col, int row) {
    vec4 r0 = texelFetch(uBones, ivec2(col, row), 0);
    vec4 r1 = texelFetch(uBones, ivec2(col + 1, row), 0);
    vec4 r2 = texelFetch(uBones, ivec2(col + 2, row), 0);
    return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0), vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));
  }
  mat4 boneAt(int col, float p) {
    int i0 = int(floor(p));
    float t = p - float(i0);
    mat4 a = boneRow(col, i0);
    if (t < 0.001) return a;
    mat4 b = boneRow(col, i0 + 1);
    return a + (b - a) * t;
  }
  mat4 boneMatrix() {
    int col = int(aBone + 0.5) * 3;
    mat4 m = boneAt(col, aAnim.x);
    if (aAnim.z > 0.001) m = m + (boneAt(col, aAnim.y) - m) * aAnim.z;
    return m;
  }
  bool propHidden() { return aProp > 0.5 && abs(aProp - aTint.z) > 0.5; }
`;

function patchVertex(shader, outline) {
  shader.vertexShader = BONE_GLSL + (outline ? 'uniform float uPx;\n' : '') + shader.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      mat4 bm = boneMatrix();
      objectNormal = mat3(bm) * objectNormal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${outline ? 'mat4 bm = boneMatrix();' : ''}
      vClip = aClip;
      if (propHidden()) transformed = vec3(0.0, 0.3, 0.0);
      transformed = (bm * vec4(transformed, 1.0)).xyz;
      if (aClip > 1.5) transformed = vec3(0.0); // hidden: every vertex at the feet, no area
      ${outline ? `
      vec3 nS = normalize(mat3(bm) * aSmoothN);
      float isc = length(instanceMatrix[0].xyz);
      float depthI = -(modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).z;
      transformed += nS * (depthI * uPx / max(isc, 0.0001));` : ''}`);
}

/** A Lambert material patched for bone animation, side colours, the baked shade and a rim darkening. */
export function soldierMaterial({ coatA, coatB, trouserA, trouserB, hat, officerCoat = '#1c2136', officerTrouser = '#2a3350' }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.userData.uniforms = {
    uBones: { value: boneTexture() },
    uCoatA: { value: new THREE.Color(coatA) },
    uCoatB: { value: new THREE.Color(coatB) },
    uTrouserA: { value: new THREE.Color(trouserA) },
    uTrouserB: { value: new THREE.Color(trouserB) },
    uHat: { value: new THREE.Color(hat) },
    uOfficerCoat: { value: new THREE.Color(officerCoat) },
    uOfficerTrouser: { value: new THREE.Color(officerTrouser) },
    uSplit: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = 'uniform vec3 uCoatA; uniform vec3 uCoatB; uniform vec3 uTrouserA; uniform vec3 uTrouserB; uniform vec3 uHat; uniform vec3 uOfficerCoat; uniform vec3 uOfficerTrouser;\nvarying float vEmit;\n' + shader.vertexShader;
    patchVertex(shader, false);
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        if (aMat > 0.5 && aMat < 1.5) vColor.rgb = mix(mix(uCoatA, uCoatB, aTint.x), uOfficerCoat, aTint.w);
        else if (aMat > 1.5 && aMat < 2.5) vColor.rgb = mix(mix(uTrouserA, uTrouserB, aTint.y), uOfficerTrouser, aTint.w);
        else if (aMat > 3.5 && aMat < 4.5) vColor.rgb = mix(uHat, uCoatB, aTint.x * 0.35);
        vColor.rgb *= aAo;
        vEmit = (aMat > 2.5 && aMat < 3.5) ? aAnim.w : 0.0;`);
    shader.fragmentShader = 'varying float vEmit;\n' + CLIP_FRAG + shader.fragmentShader
      .replace('void main() {', 'void main() {\n  if (clipped()) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 faceN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        float rim = pow(1.0 - clamp(dot(faceN, normalize(vViewPosition)), 0.0, 1.0), 2.5);
        diffuseColor.rgb *= 1.0 - 0.2 * rim;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(9.0, 6.5, 2.5) * vEmit;');
  };
  mat.customProgramCacheKey = () => 'soldier-v4';
  return mat;
}

/** The outline hull: back faces pushed out ~1 px along the posed smooth normals, drawn dark. */
export function outlineMaterial(px = 1) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1c1711'), side: THREE.BackSide });
  mat.userData.uniforms = { uBones: { value: boneTexture() }, uPx: { value: 0.001 }, uSplit: { value: 0 } };
  mat.userData.px = px;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    patchVertex(shader, true);
    shader.fragmentShader = CLIP_FRAG + shader.fragmentShader.replace('void main() {', 'void main() {\n  if (clipped()) discard;');
  };
  mat.customProgramCacheKey = () => 'soldier-outline-v3';
  return mat;
}

function instancedGeometry(base, anim, tint, clip) {
  const geo = base.clone();
  geo.setAttribute('aAnim', anim);
  geo.setAttribute('aTint', tint);
  geo.setAttribute('aClip', clip);
  return geo;
}

function makeBuffers(capacity) {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const clip = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  anim.setUsage(THREE.DynamicDrawUsage);
  tint.setUsage(THREE.DynamicDrawUsage);
  clip.setUsage(THREE.DynamicDrawUsage);
  return { anim, tint, clip };
}

const geoCache = new Map();
/** Existing retained templates only. No cache population, copy, upload or owner mutation. */
export function retainedFigureGeometryArrays() {
  const rows=[],own=(o,k,optional=false)=>{const d=Object.getOwnPropertyDescriptor(o,k);
    if(!d&&optional)return undefined;
    if(!d||!Object.hasOwn(d,'value'))throw Error('figure templates: missing or accessor owner');return d.value;},
    entries=o=>Object.keys(Object.getOwnPropertyDescriptors(o)).map(k=>[k,own(o,k)]),
    add=(a,owner)=>{const array=own(a,'isInterleavedBufferAttribute',true)===true?own(own(a,'data'),'array'):own(a,'array');
      if(!ArrayBuffer.isView(array)||rows.length>=256)throw Error('figure templates: invalid array or bound');
      rows.push(Object.freeze({owner,array}));};
  for(const [key,g]of geoCache){
    for(const [name,a]of [...entries(own(g,'attributes')),['index',own(g,'index')]].filter(([,a])=>a))add(a,`figure-template/${key}/${name}`);
    for(const [name,list]of entries(own(g,'morphAttributes'))){
      if(!Array.isArray(list))throw Error('figure templates: invalid morph list');const n=own(list,'length');
      if(n>256)throw Error('figure templates: morph bound');
      for(let i=0;i<n;i++)add(own(list,String(i)),`figure-template/${key}/morph/${name}/${i}`);
    }
  }
  return Object.freeze(rows);
}
export function figureGeometry(lod, kit) {
  const k = `${lod}:${kit}`;
  if (!geoCache.has(k)) geoCache.set(k, buildFigureGeometry(lod, kit));
  return geoCache.get(k);
}

// Actual pool-owned retirement. Defaults never select it; arrays and animation remain CPU-live.
function poolResourceLifetime(renderer,entries,verifyPool) {
  if(typeof renderer?.getContext!=='function')throw Error('figure resource: renderer required');
  let busy=false,failed=false,failure,properties=renderer.properties,outlineOn=true,lostObserved=false,staleEpoch=false,closed=false,closeComplete=false;
  const canvas=renderer.domElement;
  const records=entries.map(({body,outline=null})=>{
    const geometry=body.geometry,meshes=[body,...(outline?[outline]:[])],attributes=[...Object.entries(geometry.attributes),['index',geometry.index]].filter(([,a])=>a),
      instances=meshes.flatMap(m=>[['instanceMatrix',m.instanceMatrix],['instanceColor',m.instanceColor]].map(([key,a])=>({mesh:m,key,a}))),
      owners=[...attributes.map(([,a])=>a),...instances.map(r=>r.a).filter(Boolean)],arrays=owners.map(a=>a.array),arrayShapes=arrays.map(a=>[a.constructor,a.length,a.byteLength,a.buffer]),shapes=owners.map(a=>[a.itemSize,a.count,a.normalized,a.gpuType,a.usage,a.meshPerAttribute]);
    if(outline&&(outline.geometry!==geometry||outline.instanceMatrix!==body.instanceMatrix))throw Error('figure resource: shared outline owners required');
    const callbacks=meshes.map(m=>m.onBeforeRender),materials=meshes.map(m=>m.material),guards=meshes.map((m,i)=>function(...args){
      idle();busy=true;try{verify();if(!record.active||record.pending)throw Error('figure resource: inactive draw');
        const counts=record.meshes.map(m=>({m,count:m.count,parent:m.parent})),poolState=verifyPool(),result=callbacks[i].apply(this,args);
        verify();if(counts.some(s=>s.m.count!==s.count||s.m.parent!==s.parent)||!sameState(poolState,verifyPool()))throw Error('figure resource: render callback changed draw state');
        return result;
      }catch(e){fail(e);}finally{busy=false;}
    });
    const record={body,outline,geometry,index:geometry.index,meshes,attributes,instances,owners,arrays,arrayShapes,shapes,materials,guards,active:false,requested:false,pending:false,retired:new Set()};
    for(const [i,m]of meshes.entries()){m.visible=false;m.onBeforeRender=guards[i];}
    return record;
  });
  const hide=()=>{for(const r of records)for(const m of r.meshes)m.visible=false;};
  function fail(error){if(!failed){failed=true;failure=error;}hide();throw failure;}
  function idle(){if(failed)throw failure;if(closed)throw Error('figure resource: closed owner');if(busy)fail(Error('figure resource: reentrant update'));}
  function sameState(a,b){return a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));}
  function verify(){verifyPool();for(const r of records){
    if(r.geometry.index!==r.index||r.meshes.some((m,i)=>m.geometry!==r.geometry||m.material!==r.materials[i]||m.onBeforeRender!==r.guards[i])
      ||Object.keys(r.geometry.attributes).sort().join(',')!==r.attributes.filter(([k])=>k!=='index').map(([k])=>k).sort().join(',')
      ||r.attributes.some(([k,a])=>(k==='index'?r.geometry.index:r.geometry.attributes[k])!==a)
      ||r.instances.some(x=>x.mesh[x.key]!==x.a)||r.owners.some((a,i)=>a.array!==r.arrays[i]||[a.array.constructor,a.array.length,a.array.byteLength,a.array.buffer].some((v,j)=>v!==r.arrayShapes[i][j])||[a.itemSize,a.count,a.normalized,a.gpuType,a.usage,a.meshPerAttribute].some((v,j)=>v!==r.shapes[i][j])))throw Error('figure resource: owner changed');
  }}
  function finish(){const gl=renderer.getContext();if(gl.isContextLost())return false;if(gl.getError()!==gl.NO_ERROR)throw Error('figure resource: completion refused');gl.finish();if(gl.isContextLost())return false;if(gl.getError()!==gl.NO_ERROR)throw Error('figure resource: completion failed');return true;}
  function retire(records){
    for(const r of records)for(const owner of [r.geometry,...r.meshes]){if(r.retired.has(owner))continue;r.retired.add(owner);try{owner.dispose();}catch(e){if(!failed){failed=true;failure=e;}}}
    let complete=false;try{complete=finish();}catch(e){if(!failed){failed=true;failure=e;}}
    if(failed)fail(failure);return complete;
  }
  function update(requests){
    if(!busy)throw Error('figure resource: update outside flush');
    verify();if(requests.length!==records.length)throw Error('figure resource: bucket count changed');
    const gl=renderer.getContext(),newEpoch=renderer.properties!==properties;
    if(gl.isContextLost())lostObserved=true;
    if(newEpoch&&!lostObserved){staleEpoch=true;throw Error('figure resource: unobserved context epoch');}
    for(const [i,r]of records.entries()){
      r.requested=!!requests[i];
      if(r.active&&!r.pending&&(!r.requested||newEpoch||gl.isContextLost())){r.pending=true;r.retired.clear();}
    }
    const pending=records.filter(r=>r.pending);
    if(pending.length){
      hide();const counts=records.flatMap(r=>r.meshes.map(m=>({m,count:m.count,parent:m.parent}))),poolState=verifyPool(),complete=retire(pending);
      verify();if(counts.some(s=>s.m.count!==s.count||s.m.parent!==s.parent)||!sameState(poolState,verifyPool()))throw Error('figure resource: callback changed draw state');
      if(!complete)return false;
      for(const r of pending){r.pending=false;r.active=false;}
    }
    if(gl.isContextLost()){hide();return false;}
    properties=renderer.properties;lostObserved=false;
    for(const r of records){if(r.requested&&!r.active)r.retired.clear();r.active=r.requested;r.body.visible=r.active;if(r.outline)r.outline.visible=r.active&&outlineOn;}
    return true;
  }
  function run(action){idle();busy=true;try{verify();return action();}catch(e){
    if(!failed){failed=true;failure=e;}hide();for(const r of records)r.pending=true;
    if(!staleEpoch)try{retire(records);}catch{}fail(failure);
  }finally{busy=false;}}
  function onLoss(){if(closed||failed||!renderer.getContext().isContextLost())return;try{run(()=>update(records.map(r=>r.requested)));}catch{ /* sticky receipt retains failure */ }}
  canvas?.addEventListener?.('webglcontextlost',onLoss);
  return Object.freeze({assertIdle:idle,run,update,
  close(){
    if(closed&&closeComplete){if(failed)throw failure;return true;}
    if(busy)fail(Error('figure resource: reentrant close'));
    canvas?.removeEventListener?.('webglcontextlost',onLoss);closed=true;hide();if(failed)throw failure;
    try{verify();}catch(error){fail(error);}
    busy=true;try{const completed=retire(records);closeComplete=completed;for(const r of records){r.active=false;r.requested=false;r.pending=!completed;}return completed;}finally{busy=false;}
  },
  setOutline(on){outlineOn=!!on;for(const r of records)if(r.outline)r.outline.visible=r.active&&!r.pending&&outlineOn&&!renderer.getContext().isContextLost();},
  snapshot(){return Object.freeze({failed,busy,closed,buckets:records.map(r=>Object.freeze({active:r.active,requested:r.requested,pending:r.pending,visible:r.body.visible,outlineVisible:r.outline?.visible??null}))});}});
}

function validatePoolResourceOption(resourceLifetime,renderer){
  if(typeof resourceLifetime!=='boolean'||resourceLifetime&&typeof renderer?.getContext!=='function')throw Error('figure resource: explicit boolean and renderer required');
}

/**
 * One side's standing figures. Each frame: begin(), push() every man, flush(). Men are bucketed by
 * their distance from the camera into three levels of detail; the near two also get an outline pass.
 */
export class SoldierPool {
  #resource = null;
  constructor(capacity, colors, { kit = 'US', outline = true, resourceLifetime = false, renderer = null } = {}) {
    validatePoolResourceOption(resourceLifetime,renderer);
    Object.defineProperty(this,'resourceLifetime',{value:resourceLifetime});
    this.capacity = capacity;
    this.kit = kit;
    this.material = soldierMaterial(colors);
    this.outline = outline;
    this.buckets = [];
    this.group = new THREE.Group();
    this.group.name = `soldiers-${kit}`;
    for (let lod = 2; lod >= 0; lod--) {
      const { anim, tint, clip } = makeBuffers(capacity);
      const geo = instancedGeometry(figureGeometry(lod, kit), anim, tint, clip);
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `soldiers-${kit}-lod${lod}`;
      mesh.onBeforeRender = splitHook(this.material.userData.uniforms);
      this.group.add(mesh);
      const b = { lod, mesh, anim, tint, clip, n: 0, outline: null };
      if (outline && OUTLINE_PX[lod] > 0) {
        const om = outlineMaterial(OUTLINE_PX[lod]);
        const o = new THREE.InstancedMesh(geo, om, capacity);
        o.instanceMatrix = mesh.instanceMatrix; // share the per-instance buffers
        o.onBeforeRender = splitHook(om.userData.uniforms);
        o.frustumCulled = false;
        o.count = 0;
        o.name = `${mesh.name}-outline`;
        this.group.add(o);
        b.outline = o;
      }
      this.buckets.push(b);
    }
    this.cam = new THREE.Vector3(0, 800, 0);
    this.pushed = 0;
    this.triangles = { 2: figureGeometry(2, kit).userData.triangles, 1: figureGeometry(1, kit).userData.triangles, 0: figureGeometry(0, kit).userData.triangles };
    if(resourceLifetime){const buckets=this.buckets,material=this.material,refs=buckets.map(b=>({b,body:b.mesh,outline:b.outline,anim:b.anim,tint:b.tint,clip:b.clip}));
      this.#resource=poolResourceLifetime(renderer,refs,()=>{if(this.capacity!==capacity||this.material!==material||this.buckets!==buckets||this.buckets.length!==refs.length||refs.some((r,i)=>buckets[i]!==r.b||r.b.mesh!==r.body||r.b.outline!==r.outline||r.b.anim!==r.anim||r.b.tint!==r.tint||r.b.clip!==r.clip))throw Error('figure resource: bucket owner changed');return [this.pushed,...refs.map(r=>r.b.n)];});}
  }

  get mesh() { return this.group; }

  /** Camera position (for the level of detail) and the world size of one render pixel (for the outline). */
  setView(camera, renderHeightPx) {
    this.#resource?.assertIdle();
    this.cam.copy(camera.position);
    const px = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, renderHeightPx);
    for (const b of this.buckets) if (b.outline) b.outline.material.userData.uniforms.uPx.value = px * b.outline.material.userData.px;
  }

  begin() {
    this.#resource?.assertIdle();
    for (const b of this.buckets) b.n = 0;
    this.pushed = 0;
  }

  /** One figure: position, yaw (forward = (sin yaw, cos yaw)), scale, frames A/B + blend, flash, tint, clip side. */
  push(x, y, z, yaw, s, posA, posB, blend, flash, coatVar, trouserVar, prop, officer, clip = 0) {
    this.#resource?.assertIdle();
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const b = d2 < LOD_NEAR * LOD_NEAR ? this.buckets[0] : d2 < LOD_FAR * LOD_FAR ? this.buckets[1] : this.buckets[2];
    if (b.n >= this.capacity) return;
    const i = b.n++;
    const te = b.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    te[o] = c; te[o + 1] = 0; te[o + 2] = -sn; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = s; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    const a = b.anim.array;
    a[i * 4] = posA; a[i * 4 + 1] = posB; a[i * 4 + 2] = blend; a[i * 4 + 3] = flash;
    const t = b.tint.array;
    t[i * 4] = coatVar; t[i * 4 + 1] = trouserVar; t[i * 4 + 2] = prop; t[i * 4 + 3] = officer;
    b.clip.array[i] = clip;
    this.pushed++;
  }

  flush() {
    if(this.#resource)return this.#resource.run(()=>{this.#flush();return this.#resource.update(this.buckets.map(b=>b.n>0));});
    this.#flush();
  }

  #flush() {
    for (const b of this.buckets) {
      b.mesh.count = b.n;
      if (b.outline) b.outline.count = b.n;
      if (!b.n) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.anim.needsUpdate = true;
      b.tint.needsUpdate = true;
      b.clip.needsUpdate = true;
    }
  }

  /** Triangles submitted this frame (for the stats line). */
  trianglesDrawn() {
    let t = 0;
    for (const b of this.buckets) t += b.n * this.triangles[b.lod] * (b.outline ? 2 : 1);
    return t;
  }

  setOutline(on) {
    if(this.#resource)return this.#resource.run(()=>this.#resource.setOutline(on));
    for (const b of this.buckets) if (b.outline) b.outline.visible = on;
  }

  resourceSnapshot(){return this.#resource?.snapshot()??null;}
  disposeResourceLifetime(){return this.#resource?.close()??true;}
}

/**
 * Casualties: fixed-index instances in a lying pose (medium detail, no outline). An infantryman's casualty
 * is "bakeable": while baked sprites draw the infantry, setBakedClip() hides (2) or clips (-1/+1) those.
 */
export class FallenPool {
  #resource = null;
  constructor(capacity, colors, { kit = 'US', resourceLifetime = false, renderer = null } = {}) {
    validatePoolResourceOption(resourceLifetime,renderer);
    Object.defineProperty(this,'resourceLifetime',{value:resourceLifetime});
    const { anim, tint, clip } = makeBuffers(capacity);
    this.anim = anim;
    this.tint = tint;
    this.clip = clip;
    this.bakeable = new Uint8Array(capacity);
    this.bakedClip = 0;
    this.born = new Float32Array(capacity); // FALLEN.clock() when each man was laid down
    this.baseY = new Float32Array(capacity);
    this.hiddenTo = 0; // gore off: casualties [0, hiddenTo) have faded out (clip 2)
    this.sunk = false; // some casualty is drawn below its ground height or hidden by the gore fade
    const geo = instancedGeometry(figureGeometry(1, kit), anim, tint, clip);
    this.material = soldierMaterial(colors);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.onBeforeRender = splitHook(this.material.userData.uniforms);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = `fallen-${kit}`;
    this.capacity = capacity;
    this.used = 0;
    this.dirty = false;
    if(resourceLifetime){const refs={capacity:this.capacity,mesh:this.mesh,material:this.material,anim:this.anim,tint:this.tint,clip:this.clip};
      this.#resource=poolResourceLifetime(renderer,[{body:this.mesh}],()=>{if(Object.entries(refs).some(([k,v])=>this[k]!==v))throw Error('figure resource: fallen owner changed');return [this.used,this.hiddenTo,this.sunk,this.dirty,this.bakedClip];});}
  }

  alloc() {
    this.#resource?.assertIdle();
    if (this.used >= this.capacity) return -1;
    return this.used++;
  }

  /** A lying man: feet toward `yaw`, on his back (front=false) or face down; bakeable = an infantryman. */
  set(i, x, y, z, yaw, s, front, coatVar, trouserVar, bakeable = false) {
    this.#resource?.assertIdle();
    const te = this.mesh.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    te[o] = c; te[o + 1] = 0; te[o + 2] = -sn; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = s; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    this.born[i] = FALLEN.clock(); this.baseY[i] = y;
    const a = this.anim.array;
    const p = fallenFrame(front);
    a[i * 4] = p; a[i * 4 + 1] = p; a[i * 4 + 2] = 0; a[i * 4 + 3] = 0;
    const t = this.tint.array;
    t[i * 4] = coatVar; t[i * 4 + 1] = trouserVar; t[i * 4 + 2] = 1; t[i * 4 + 3] = 0;
    this.bakeable[i] = bakeable ? 1 : 0;
    this.clip.array[i] = i < this.hiddenTo ? 2 : bakeable ? this.bakedClip : 0;
    this.dirty = true;
  }

  /** Clip side for the infantry casualties: 0 drawn, -1/+1 one side of the compare divider, 2 hidden. */
  setBakedClip(c) {
    this.#resource?.assertIdle();
    if (c === this.bakedClip) return;
    this.bakedClip = c;
    const a = this.clip.array;
    for (let i = this.hiddenTo; i < this.used; i++) if (this.bakeable[i]) a[i] = c;
    this.dirty = true;
  }

  /** Gore off: sink the casualties older than GORE_FADE.delay and hide the faded; gore on: put every one back. */
  fade() {
    this.#resource?.assertIdle();return this.#fade();
  }

  #fade() {
    const te = this.mesh.instanceMatrix.array, clip = this.clip.array;
    if (FALLEN.gore) {
      if (!this.sunk) return null;
      for (let i = 0; i < this.used; i++) { te[i * 16 + 13] = this.baseY[i]; clip[i] = this.bakeable[i] ? this.bakedClip : 0; }
      this.hiddenTo = 0; this.sunk = false; this.dirty = true;
      return null;
    }
    const now = FALLEN.clock();
    let lo = -1, hi = -1;
    for (let i = this.hiddenTo; i < this.used; i++) {
      const k = fadeOf(now - this.born[i], false);
      if (k <= 0) break; // laid down in order, so the rest are younger
      const o = i * 16, y = k >= 1 ? this.baseY[i] : this.baseY[i] - k * SINK * te[o + 5];
      // Already baked-clipped casualties still advance the CPU fade cursor and gore restore flag.
      if (te[o + 13] === y && k < 1) continue;
      te[o + 13] = y;
      if (k >= 1) { clip[i] = 2; this.hiddenTo = i + 1; }
      if (lo < 0) lo = i;
      hi = i; this.sunk = true;
    }
    return lo < 0 ? null : [lo, hi];
  }

  flush() {
    if(this.#resource)return this.#resource.run(()=>{this.#flush();let active=false;for(let i=0;i<this.used;i++)if(this.clip.array[i]!==2){active=true;break;}return this.#resource.update([active]);});
    this.#flush();
  }

  #flush() {
    this.mesh.count = this.used;
    const range = this.#resource ? this.#fade() : this.fade();
    if (!this.dirty && range) {
      // only the fading casualties changed: upload just their rows
      const [lo, n] = [range[0], range[1] - range[0] + 1];
      this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(lo * 16, n * 16); this.mesh.instanceMatrix.needsUpdate = true;
      this.clip.clearUpdateRanges(); this.clip.addUpdateRange(lo, n); this.clip.needsUpdate = true;
      return;
    }
    if (!this.dirty) return;
    this.mesh.instanceMatrix.clearUpdateRanges(); this.clip.clearUpdateRanges();
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.clip.needsUpdate = true;
    this.dirty = false;
  }

  resourceSnapshot(){return this.#resource?.snapshot()??null;}
  disposeResourceLifetime(){return this.#resource?.close()??true;}
}

export const UNIFORMS = {
  US: { coatA: '#253a78', coatB: '#2d4488', trouserA: '#8ea6d2', trouserB: '#7892bd', hat: '#1f2f62', officerCoat: '#1a2650', officerTrouser: '#3a4a78' },
  CS: { coatA: '#a09c90', coatB: '#b08f5e', trouserA: '#9a9280', trouserB: '#8a7050', hat: '#7a7266', officerCoat: '#7a7a74', officerTrouser: '#8a90a0' },
};

export { BONE_COUNT, CLIP_ROWS };

// ---------------------------------------------------------------------------------------------------------
// Regimental colours (unit.js pushColours): one textured quad per flag (staff, finial and flag in one atlas tile),
// all flags in one InstancedMesh (one draw call), each turned to face the camera about its staff. Tiles: the US
// national colour (stars and stripes), the Confederate national colour of the battle's date (First National
// "Stars and Bars" before 1 May 1863, Second National after), and a PLAIN regimental colour in each side's tone:
// no regiment's specific design is drawn, because none is sourced here (DESIGN.md §4b).
export const FLAG_TILE = { US_NATIONAL: 0, CS_FIRST_NATIONAL: 1, CS_SECOND_NATIONAL: 2, US_REGIMENTAL: 3, CS_REGIMENTAL: 4 };
const FLAG_TILES = 5, TILE_W = 32, TILE_H = 64; // px per tile; the quad is 1.5 m x 3 m at life size
const FLAG_W = 1.5, FLAG_H = 3.0, STAFF_PX = 2, FLAG_ROWS = 20; // flag: 30 x 20 px at the top of the tile

/** Which national colour a side carried on an ISO date (YYYY-MM-DD). */
export function nationalTile(side, date = '') {
  if (side === 'US') return FLAG_TILE.US_NATIONAL;
  return typeof date === 'string' && date >= '1863-05-01' ? FLAG_TILE.CS_SECOND_NATIONAL : FLAG_TILE.CS_FIRST_NATIONAL;
}

/** The atlas as RGBA bytes, row 0 at the bottom (v = 0): drawn procedurally, so it needs no canvas or download. */
export function flagAtlasData() {
  const W = FLAG_TILES * TILE_W, data = new Uint8Array(W * TILE_H * 4);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RED = hex('#b02a2e'), WHITE = hex('#efe9da'), BLUE = hex('#26387a'), STAFF = hex('#5a4630'), GOLD = hex('#c9a646');
  const set = (tile, x, row, c) => { const o = ((row * W) + tile * TILE_W + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; };
  const fw = TILE_W - STAFF_PX; // flag width in px
  const dots = (cx, cy, x, y, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const design = {
    [FLAG_TILE.US_NATIONAL]: (x, y) => {
      if (x < 13 && y < 11) return x % 3 === 1 && y % 3 === 1 ? WHITE : BLUE; // canton with rows of stars
      return Math.floor(y / (FLAG_ROWS / 13)) % 2 ? WHITE : RED;
    },
    [FLAG_TILE.CS_FIRST_NATIONAL]: (x, y) => {
      if (x < 13 && y < 13) {
        for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; if (dots(6.5 + Math.cos(a) * 4.2, 6.5 + Math.sin(a) * 4.2, x + 0.5, y + 0.5, 0.75)) return WHITE; }
        return BLUE;
      }
      return y < FLAG_ROWS / 3 || y >= (2 * FLAG_ROWS) / 3 ? RED : WHITE;
    },
    [FLAG_TILE.CS_SECOND_NATIONAL]: (x, y) => {
      if (x < 13 && y < 12) { // red canton with a blue saltire
        const u = x / 12, v = y / 11;
        return Math.abs(u - v) < 0.14 || Math.abs(u + v - 1) < 0.14 ? ((x + y) % 3 === 0 ? WHITE : BLUE) : RED;
      }
      return WHITE;
    },
    [FLAG_TILE.US_REGIMENTAL]: () => BLUE,
    [FLAG_TILE.CS_REGIMENTAL]: () => RED,
  };
  for (let tile = 0; tile < FLAG_TILES; tile++) {
    for (let row = 0; row < TILE_H - 2; row++) for (let x = 0; x < STAFF_PX; x++) set(tile, x, row, STAFF);
    for (let row = TILE_H - 3; row < TILE_H; row++) for (let x = 0; x < STAFF_PX + 1; x++) set(tile, x, row, GOLD);
    for (let y = 0; y < FLAG_ROWS; y++) { // y from the top of the flag
      const row = TILE_H - 4 - y;
      for (let x = 0; x < fw; x++) set(tile, STAFF_PX + x, row, design[tile](x, y));
    }
  }
  return { data, width: W, height: TILE_H };
}

/** Every regiment's colours: push() per flag each frame between begin() and flush(). */
export class FlagPool {
  constructor(capacity, { date = '' } = {}) {
    this.capacity = Math.max(1, capacity);
    this.date = date;
    const { data, width, height } = flagAtlasData();
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5 - (STAFF_PX / 2) / TILE_W, 0.5, 0); // the staff's foot at the origin
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.tile.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', this.tile);
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xe6e6e6 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aTile;\n' + shader.vertexShader.replace('#include <uv_vertex>',
        `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv.x = (vMapUv.x + aTile) / ${FLAG_TILES}.0;\n#endif`);
    };
    mat.customProgramCacheKey = () => 'flag-atlas';
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'colours';
    this.used = 0;
    this.cam = new THREE.Vector3(0, 1e4, 0);
  }

  setView(camera) { this.cam.copy(camera.position); }

  begin() { this.used = 0; }

  /** A flag at the staff's foot (x, y, z): kind 'national' or 'regimental', s the figure scale. */
  push(x, y, z, side, kind, s) {
    if (this.used >= this.capacity) return;
    const i = this.used++;
    const yaw = Math.atan2(this.cam.x - x, this.cam.z - z); // face the camera about the staff
    const c = Math.cos(yaw), sn = Math.sin(yaw), w = FLAG_W * s, h = FLAG_H * s;
    const te = this.mesh.instanceMatrix.array, o = i * 16;
    te[o] = c * w; te[o + 1] = 0; te[o + 2] = -sn * w; te[o + 3] = 0;
    te[o + 4] = 0; te[o + 5] = h; te[o + 6] = 0; te[o + 7] = 0;
    te[o + 8] = sn; te[o + 9] = 0; te[o + 10] = c; te[o + 11] = 0;
    te[o + 12] = x; te[o + 13] = y; te[o + 14] = z; te[o + 15] = 1;
    this.tile.array[i] = kind === 'national' ? nationalTile(side, this.date) : side === 'US' ? FLAG_TILE.US_REGIMENTAL : FLAG_TILE.CS_REGIMENTAL;
  }

  flush() {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tile.needsUpdate = true;
  }
}

// src/world/terrain.js: the battlefield ground.
//
// Loads the USGS 3DEP heightmap built by tools/fetch-terrain.mjs, exaggerates relief (UG:G-style readable
// hills), meshes it with mapbox/martini (adaptive triangles), and shades it with a painted ground texture
// (see ground-paint.js), a full-resolution normal map from the DEM, and procedural brush-stroke detail.
//
// Frame: +x east, +z south, y up, metres. Heights are metres above the area minimum times EXAGGERATION.

import * as THREE from 'three';
import Martini from '@mapbox/martini';

// Lossless Float32 partitions; index 65535 remains reserved for primitive restart.
export function partitionTerrain({position,uv,index},limit=65535) {
  const vertices=position.length/3;
  if(!(position instanceof Float32Array)||!(uv instanceof Float32Array)||!(index instanceof Uint32Array||index instanceof Uint16Array)
    ||!Number.isSafeInteger(vertices)||uv.length!==vertices*2||index.length%3||!Number.isSafeInteger(limit)||limit<3||limit>65535
    ||index.some(i=>i>=vertices))throw new Error('terrain partition: invalid indexed attributes/limit');
  const chunks=[];let ids=[],map=new Map(),indices=[];
  const flush=()=>{if(!indices.length)return;const p=new Float32Array(ids.length*3),u=new Float32Array(ids.length*2);
    ids.forEach((source,local)=>{p.set(position.subarray(source*3,source*3+3),local*3);u.set(uv.subarray(source*2,source*2+2),local*2);});
    chunks.push({position:p,uv:u,index:new Uint16Array(indices),sourceVertices:new Uint32Array(ids)});ids=[];map=new Map();indices=[];
  };
  for(let i=0;i<index.length;i+=3){const triangle=[index[i],index[i+1],index[i+2]],fresh=new Set(triangle.filter(v=>!map.has(v)));
    if(map.size+fresh.size>limit)flush();
    for(const source of triangle){if(!map.has(source)){map.set(source,ids.length);ids.push(source);}indices.push(map.get(source));}
  }flush();
  const bytes=chunks.reduce((n,c)=>n+c.position.byteLength+c.uv.byteLength+c.index.byteLength,0);
  return {chunks,triangles:index.length/3,sourceBytes:position.byteLength+uv.byteLength+index.byteLength,bytes};
}

/** Exact storage prerequisite for the terminal profile; never selects a renderer
 * or retires an original. Axis/height texels retain the original Float32 bits;
 * UV division is exact because the admitted grid span is a power of two.
 */
export function prepareTerminalTerrain(data, vertices, triangles, limit = 65535) {
  const refuse = () => { throw new Error('terminal terrain: invalid or nonexact input'); };
  const grid = data?.grid, cell = data?.cell, half = data?.half, heights = data?.heights;
  const authoredStep = data?.meta?.heights?.stepM;
  const step = typeof authoredStep === 'number' ? authoredStep * EXAGGERATION : NaN;
  if (!Number.isSafeInteger(grid) || grid < 3 || grid > 1025 || !Number.isInteger(Math.log2(grid - 1))
    || !Number.isFinite(cell) || cell <= 0 || !Number.isFinite(half) || half <= 0 || cell * (grid - 1) !== half * 2
    || !Number.isFinite(step) || step <= 0 || !(heights instanceof Float32Array) || heights.length !== grid * grid
    || !(vertices instanceof Uint16Array || vertices instanceof Uint32Array) || !vertices.length || vertices.length % 2
    || vertices.some(value => value >= grid)
    || !(triangles instanceof Uint16Array || triangles instanceof Uint32Array) || !triangles.length || triangles.length % 3
    || triangles.some(value => value >= vertices.length / 2)
    || !Number.isSafeInteger(limit) || limit < 3 || limit > 65535) refuse();
  // Whole DEM storage also serves future heightAt consumers. This function does
  // not change TerrainData or claim that its original backing has been retired.
  const heightCodes = new Uint16Array(heights.length);
  let maximum = 0;
  for (let i = 0; i < heights.length; i++) {
    const code = Math.round(heights[i] / step);
    if (!Number.isSafeInteger(code) || Object.is(code, -0) || code < 0 || code > 65535
      || !Object.is(Math.fround(code * step), heights[i])) refuse();
    heightCodes[i] = code; maximum = Math.max(maximum, code);
  }
  const width = 256, height = Math.ceil((grid + maximum + 1) / width), lookup = new Float32Array(width * height);
  for (let g = 0; g < grid; g++) {
    lookup[g] = g * cell - half;
    if (!Number.isFinite(lookup[g])) refuse();
  }
  for (let code = 0; code <= maximum; code++) lookup[grid + code] = code * step;
  const point = id => {
    const x = vertices[id * 2], z = vertices[id * 2 + 1];
    return [lookup[x], lookup[grid + heightCodes[z * grid + x]], lookup[z]];
  };
  const bounds = ids => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const p = point(id);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
    const center = min.map((value, k) => (value + max[k]) / 2);
    let radius2 = 0;
    for (const id of ids) {
      const p = point(id);
      radius2 = Math.max(radius2, p.reduce((sum, value, k) => sum + (value - center[k]) ** 2, 0));
    }
    const radius = Math.sqrt(radius2);
    if (![...min, ...max, ...center, radius].every(Number.isFinite)) refuse();
    return { min, max, center, radius };
  };
  const rootBounds = bounds({ *[Symbol.iterator]() { for (let i = 0; i < vertices.length / 2; i++) yield i; } });
  const chunks = [];
  let ids = [], local = new Map(), index = [];
  const flush = () => {
    if (!index.length) return;
    const packed = new Uint16Array(ids.length * 3);
    ids.forEach((id, i) => {
      const x = vertices[id * 2], z = vertices[id * 2 + 1];
      packed.set([x, z, heightCodes[z * grid + x]], i * 3);
    });
    chunks.push({ packed, index: new Uint16Array(index), bounds: bounds(ids) });
    ids = []; local = new Map(); index = [];
  };
  for (let i = 0; i < triangles.length; i += 3) {
    const face = [triangles[i], triangles[i + 1], triangles[i + 2]], fresh = new Set(face.filter(id => !local.has(id)));
    if (local.size + fresh.size > limit) flush();
    for (const id of face) {
      if (!local.has(id)) { local.set(id, ids.length); ids.push(id); }
      index.push(local.get(id));
    }
  }
  flush();
  return { grid, cell, half, step, width, height, lookup, heightCodes, chunks, bounds: rootBounds,
    triangles: triangles.length / 3,
    geometryBytes: chunks.reduce((n, chunk) => n + chunk.packed.byteLength + chunk.index.byteLength, 0),
    bytes: heightCodes.byteLength + lookup.byteLength + chunks.reduce((n, chunk) => n + chunk.packed.byteLength + chunk.index.byteLength, 0) };
}

/** Opt-in preparation only. No production caller selects this geometry lifetime yet.
 * CPU construction precedes publication, so its receipt survives a failed install.
 * Shared material/texture lifetime remains with the world (including repaint).
 */
export function prepareTerrainPartition(root,renderer,{limit=65535}={}) {
  const source=root?.geometry,material=root?.material,attributes=[source?.attributes.position,source?.attributes.uv,source?.index];
  if(!root?.isMesh||root.children.length||!material||Object.keys(source?.attributes||{}).sort().join(',')!=='position,uv'
    ||attributes.some(a=>!a)||!source.boundingBox||!source.boundingSphere
    ||attributes[0].itemSize!==3||attributes[1].itemSize!==2||attributes[2].itemSize!==1||!attributes[2].count
    ||source.groups.length||source.drawRange.start!==0||source.drawRange.count!==Infinity
    ||attributes.some(a=>a.normalized||a.gpuType!==THREE.FloatType)
    ||typeof renderer?.getContext!=='function')throw Error('terrain owner: exact original geometry and renderer required');
  const arrays=attributes.map(a=>a.array),oracles=arrays.map(a=>a.slice()),
    shapes=attributes.map(a=>[a.itemSize,a.count,a.normalized,a.gpuType,a.usage]),
    box=source.boundingBox,sphere=source.boundingSphere,bounds=[...box.min.toArray(),...box.max.toArray(),...sphere.center.toArray(),sphere.radius],
    uniforms=material.uniforms,records=Object.entries(uniforms||{}),shader=[material.vertexShader,material.fragmentShader],
    visible=root.visible,before=root.onBeforeRender,range=source.drawRange,groups=source.groups,
    rootFlags=[root.frustumCulled,root.renderOrder,root.layers.mask],empty=new THREE.BufferGeometry(),children=[],geometries=[],chunks=[],chunkOwners=[];
  let state='prepared',active=false,drawing=false,failed=false,failure,retired=new Set(),pending=null,cleanupCompletion=null;
  const canvas=renderer.domElement;
  const disconnect=()=>canvas?.removeEventListener?.('webglcontextlost',onLoss);
  const fail=error=>{if(!failed){failed=true;failure=error;}state='failed';throw failure;};
  const guard=()=>{if(failed)throw failure;if(active||drawing)fail(Error('terrain owner: reentrant transition'));};
  const bytesEqual=(a,b)=>{const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);return x.length===y.length&&x.every((v,i)=>v===y[i]);};
  const verifySource=()=>{
    if(root.material!==material||source.attributes.position!==attributes[0]||source.attributes.uv!==attributes[1]||source.index!==attributes[2]
      ||Object.keys(source.attributes).sort().join(',')!=='position,uv'||source.boundingBox!==box||source.boundingSphere!==sphere
      ||source.drawRange!==range||range.start!==0||range.count!==Infinity||source.groups!==groups||groups.length
      ||root.frustumCulled!==rootFlags[0]||root.renderOrder!==rootFlags[1]||root.layers.mask!==rootFlags[2]
      ||[...box.min.toArray(),...box.max.toArray(),...sphere.center.toArray(),sphere.radius].some((v,i)=>!Object.is(v,bounds[i]))
      ||attributes.some((a,i)=>a.array!==arrays[i]||[a.itemSize,a.count,a.normalized,a.gpuType,a.usage].some((v,j)=>v!==shapes[i][j])||!bytesEqual(a.array,oracles[i]))
      ||material.uniforms!==uniforms||Object.keys(uniforms||{}).length!==records.length||records.some(([k,r])=>uniforms[k]!==r)
      ||material.vertexShader!==shader[0]||material.fragmentShader!==shader[1])throw Error('terrain owner: original owner changed');
  };
  const checkChunks=()=>{for(let i=0;i<children.length;i++){
    const c=children[i],g=geometries[i],o=chunkOwners[i],attrs=[g.attributes.position,g.attributes.uv,g.index];
    if(c.geometry!==g||c.material!==material||c.onBeforeRender!==drawGuard||c.frustumCulled!==rootFlags[0]||c.renderOrder!==rootFlags[1]||c.layers.mask!==rootFlags[2]||!c.visible
      ||c.position!==o.position||c.quaternion!==o.quaternion||c.scale!==o.scale||c.matrix!==o.matrix||!c.matrixAutoUpdate||!c.matrixWorldAutoUpdate
      ||c.position.x!==0||c.position.y!==0||c.position.z!==0||c.quaternion.x!==0||c.quaternion.y!==0||c.quaternion.z!==0||c.quaternion.w!==1
      ||c.scale.x!==1||c.scale.y!==1||c.scale.z!==1||c.matrix.elements.some((v,j)=>v!==(j%5===0?1:0))
      ||Object.keys(g.attributes).sort().join(',')!=='position,uv'||g.drawRange!==o.range||g.drawRange.start!==0||g.drawRange.count!==Infinity||g.groups!==o.groups||g.groups.length
      ||g.boundingBox!==o.box||g.boundingSphere!==o.sphere||[...o.box.min.toArray(),...o.box.max.toArray(),...o.sphere.center.toArray(),o.sphere.radius].some((v,j)=>!Object.is(v,o.bounds[j]))
      ||attrs.some((a,j)=>a!==o.attrs[j]||a.array!==o.arrays[j]||[a.itemSize,a.count,a.normalized,a.gpuType,a.usage].some((v,k)=>v!==o.shapes[j][k])))throw Error('terrain owner: partition layout changed');
  }};
  const checkGraph=()=>{
    verifySource();const installed=state==='partitioned'||pending==='restore';
    if(root.geometry!==(installed?empty:source)||root.children.length!==(installed?children.length:0)
      ||installed&&children.some((c,i)=>root.children[i]!==c||c.parent!==root||c.geometry!==geometries[i]||c.material!==material)
      ||root.onBeforeRender!==(state==='prepared'&&!pending?before:drawGuard))throw Error('terrain owner: published owner changed');
    let corner=0;
    if(installed)checkChunks();
    if(installed)for(let i=0;i<children.length;i++){
      const g=geometries[i],c=chunks[i];
      if(g.attributes.position?.array!==c.position||g.attributes.uv?.array!==c.uv||g.index?.array!==c.index||children[i].onBeforeRender!==drawGuard)
        throw Error('terrain owner: partition owner changed');
      for(let j=0;j<c.sourceVertices.length;j++)for(const [key,stride,original]of [['position',3,arrays[0]],['uv',2,arrays[1]]])
        for(let k=0;k<stride;k++)if(!Object.is(c[key][j*stride+k],original[c.sourceVertices[j]*stride+k]))throw Error('terrain owner: partition bytes changed');
      for(const local of c.index)if(c.sourceVertices[local]!==arrays[2][corner++])throw Error('terrain owner: partition triangle changed');
    }
  };
  function drawGuard(...args){
    guard();if(pending)fail(Error('terrain owner: draw before completion'));
    // Full byte reconstruction belongs at transitions, never in the frame loop.
    try{if(root.material!==material||root.geometry!==empty||root.children.length!==children.length
      ||children.some((c,i)=>root.children[i]!==c||c.geometry!==geometries[i]||c.material!==material))throw Error('terrain owner: draw owner changed');
      if(this===root){drawing=true;try{before.apply(this,args);}finally{drawing=false;}}
      guard();checkChunks();if(root.geometry!==empty||root.material!==material)throw Error('terrain owner: callback changed owner');
    }catch(e){fail(e);}
  }
  const finish=()=>{
    const gl=renderer.getContext();if(gl.isContextLost())return false;
    if(gl.getError()!==gl.NO_ERROR)throw Error('terrain owner: native completion refused');
    gl.finish();if(gl.isContextLost())return false;
    if(gl.getError()!==gl.NO_ERROR)throw Error('terrain owner: native completion failed');return true;
  };
  const retire=owners=>{
    for(const g of owners){if(retired.has(g))continue;retired.add(g);try{g.dispose();}catch(e){if(!failed){failed=true;failure=e;}}}
    let completed=false;try{completed=finish();}catch(e){if(!failed){failed=true;failure=e;}}
    if(failed)fail(failure);return completed;
  };
  const result=partitionTerrain({position:arrays[0],uv:arrays[1],index:arrays[2]},limit);
  try {
    empty.boundingBox=box.clone();empty.boundingSphere=sphere.clone();
    for(const c of result.chunks){
      const g=new THREE.BufferGeometry();geometries.push(g);chunks.push(c);
      g.setAttribute('position',new THREE.BufferAttribute(c.position,3));g.setAttribute('uv',new THREE.BufferAttribute(c.uv,2));g.setIndex(new THREE.BufferAttribute(c.index,1));
      [g.attributes.position,g.attributes.uv,g.index].forEach((a,i)=>a.setUsage(attributes[i].usage));
      g.computeBoundingBox();g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,material);children.push(mesh);mesh.name=`terrain-chunk-${children.length}`;mesh.onBeforeRender=drawGuard;
      mesh.frustumCulled=rootFlags[0];mesh.renderOrder=rootFlags[1];mesh.layers.mask=rootFlags[2];
      const attrs=[g.attributes.position,g.attributes.uv,g.index];
      chunkOwners.push({position:mesh.position,quaternion:mesh.quaternion,scale:mesh.scale,matrix:mesh.matrix,attrs,arrays:attrs.map(a=>a.array),shapes:attrs.map(a=>[a.itemSize,a.count,a.normalized,a.gpuType,a.usage]),range:g.drawRange,groups:g.groups,
        box:g.boundingBox,sphere:g.boundingSphere,bounds:[...g.boundingBox.min.toArray(),...g.boundingBox.max.toArray(),...g.boundingSphere.center.toArray(),g.boundingSphere.radius]});
    }
  }catch(e){const errors=[e];for(const g of [...geometries,empty])try{g.dispose();}catch(error){errors.push(error);}throw new AggregateError(errors,'terrain owner: preparation failed');}
  const transition=target=>{
    guard();if(target==='install'&&state==='partitioned'&&!pending||target==='restore'&&state==='restored')return true;
    if(target==='install'&&pending==='refresh')target='refresh';
    if(target==='restore'&&state==='prepared')throw Error('terrain owner: install before restore');
    if(state==='restored')throw Error('terrain owner: released owner');
    if(pending&&pending!==target){if(pending==='refresh'&&target==='restore'||pending==='original'&&target==='install')pending=target;else throw Error('terrain owner: pending transition must finish');}
    try{checkGraph();}catch(e){fail(e);}active=true;
    try{
      if(!pending){retired=new Set();pending=target;root.onBeforeRender=drawGuard;root.visible=false;}
      // Dispose old Three listeners while lost. Their old GL handles must never be deleted
      // in the restored epoch; all known bytes stay pending until a healthy finish.
      const completed=retire(target==='install'||target==='original'?[source]:[...geometries,empty]);
      if(!completed)return false;
      checkGraph();
      if(target==='install'){
        root.geometry=empty;for(const child of children)root.add(child);
        state='partitioned';pending=null;checkGraph();
      }else if(target==='refresh'){
        for(const g of geometries)for(const a of [...Object.values(g.attributes),g.index])a.needsUpdate=true;
        state='partitioned';pending=null;retired.clear();checkGraph();
      }else if(target==='original'){
        for(const a of attributes)a.needsUpdate=true;
        state='prepared';pending=null;root.onBeforeRender=before;retired.clear();checkGraph();
      }else{
        for(const child of children)root.remove(child);
        // Originals become drawable only after every outgoing native buffer has retired.
        root.geometry=source;for(const a of attributes)a.needsUpdate=true;
        state='restored';pending=null;root.onBeforeRender=before;
        verifySource();if(root.children.length)throw Error('terrain owner: restoration left children');
        children.length=0;geometries.length=0;chunks.length=0;chunkOwners.length=0;result.chunks.length=0;oracles.length=0;retired.clear();
        disconnect();
      }
      root.visible=visible;return true;
    }catch(e){
      if(!failed){failed=true;failure=e;}root.visible=false;
      // Keep exact failed owners for diagnosis; continue independent retirement.
      for(const g of [...geometries,empty])if(!retired.has(g)){retired.add(g);try{g.dispose();}catch{}}
      try{cleanupCompletion=finish();}catch{cleanupCompletion=false;}
      fail(failure);
    }finally{active=false;}
  };
  function onLoss(){
    if(!renderer.getContext().isContextLost()||state==='restored'||failed)return;
    try{transition(pending??(state==='partitioned'?'refresh':'original'));}catch{ /* sticky failure remains on the receipt */ }
  }
  canvas?.addEventListener?.('webglcontextlost',onLoss);
  return Object.freeze({install:()=>transition('install'),restore:()=>transition('restore'),resume:()=>{guard();return pending?transition(pending):true;},
    // Explicitly release the loss notification when abandoning a failed/prepared receipt.
    // This does not claim native cleanup or publish another representation.
    disconnect(){
      if(active||drawing)fail(Error('terrain owner: reentrant disconnect'));
      if(!failed&&state!=='restored'&&(state!=='prepared'||pending))throw Error('terrain owner: restore before disconnect');
      disconnect();if(!failed&&state==='prepared'){failed=true;failure=Error('terrain owner: preparation abandoned');state='failed';}
    },
    get state(){return state;},get pending(){return pending;},get failed(){return failed;},
    get retainedArrays(){return state==='restored'?[]:[...arrays.map((array,i)=>({array,owner:`terrain-source/${i}`})),...oracles.map((array,i)=>({array,owner:`terrain-oracle/${i}`})),...chunks.flatMap((c,i)=>Object.entries(c).map(([k,array])=>({array,owner:`terrain-chunk-${i}/${k}`})))];},
    get receipt(){return Object.freeze({state,pending,failed,cleanupCompletion,triangles:result.triangles,chunks:children.length,sourceBytes:result.sourceBytes,bytes:result.bytes});}});
}

export const EXAGGERATION = 2.0;

export async function loadTerrainData(base, name = 'henry-hill') {
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error(`terrain name "${name}" is invalid`);
  const meta = await (await fetch(`${base}/${name}.json`)).json();
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

export function buildTerrainMesh(data, groundTexture, infoTexture, sun, { meshFactory = null } = {}) {
  if (meshFactory !== null && (typeof meshFactory !== 'function'
    || Object.prototype.toString.call(meshFactory) === '[object AsyncFunction]')) throw new Error('terrain: synchronous diagnostic mesh factory required');
  const G = data.grid;
  const martini = new Martini(G);
  const tile = martini.createTile(data.heights);
  const { vertices, triangles } = tile.getMesh(0.5);
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
      uLit: { value: 1.15 },
      uAmbient: { value: 0.8 },
      uCavity: { value: 0.56 },
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
      uniform float uLit;
      uniform float uAmbient;
      uniform float uCavity;
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
        vec3 col = base * (hemi * uAmbient + uSunColor * lit * uLit);
        col *= 1.0 - uCavity * 0.5 + cavity * uCavity;

        // Edge of the mapped area falls off into dark haze.
        float edge = max(abs(vWorld.x), abs(vWorld.z));
        col *= 1.0 - smoothstep(uHalf - 260.0, uHalf + 40.0, edge) * 0.55;

        float fog = smoothstep(uFogRange.x, uFogRange.y, vDepth);
        col = mix(col, uFogColor, fog * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  if (meshFactory) {
    const uniforms = material.uniforms;
    const records = Object.entries(uniforms).map(([key, record]) => [key, record, record.value]);
    const ownedNormal = uniforms.uNormal.value, ownedNoise = uniforms.uNoise.value;
    const vertexShader = material.vertexShader, fragmentShader = material.fragmentShader;
    const disposed = new Set();
    const meshResources = value => {
      const resources = new Set();
      if (value?.isMesh && value.parent === null) value.traverse(o => {
        if (o.geometry) resources.add(o.geometry);
        for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) resources.add(m);
      });
      return resources;
    };
    const cleanupResources = (resources, errors) => {
      for (const resource of resources) {
        if (disposed.has(resource)) continue;
        disposed.add(resource);
        try { resource.dispose(); } catch (error) { errors.push(error); }
      }
    };
    let mesh;
    let transferred = new Set();
    const validPublication = () => mesh?.isMesh && mesh.name === 'terrain' && mesh.userData.triangles === triangles.length / 3
      && mesh.material?.isShaderMaterial && mesh.material !== material && mesh.parent === null
      && material.uniforms === uniforms && Object.keys(uniforms).length === records.length
      && records.every(([key, record, value]) => uniforms[key] === record && record.value === value)
      && material.vertexShader === vertexShader && material.fragmentShader === fragmentShader
      && ['uGround', 'uInfo', 'uNormal', 'uNoise'].every(k => mesh.material.uniforms[k] === uniforms[k]);
    try {
      // Diagnostic factory runs before any monolithic position/UV/index render backing is allocated.
      mesh = meshFactory({ THREE, data, vertices, triangles, material });
      if (mesh && typeof mesh.then === 'function') {
        const error = new Error('terrain: synchronous diagnostic mesh factory required');
        // Refuse asynchronous publication, consume its rejection, and retain late cleanup results.
        error.cleanupPromise = Promise.resolve(mesh).then(value => {
          const errors = []; cleanupResources(meshResources(value), errors); return errors;
        }, failure => [failure]).catch(failure => [failure]);
        throw error;
      }
      transferred = meshResources(mesh);
      if (!validPublication()) {
        throw new Error('terrain: diagnostic factory must publish its own mesh/material with shared texture records');
      }
      disposed.add(material);
      material.dispose(); // Original shader shell was never published; the factory owns its cloned material.
      const published = meshResources(mesh);
      if (!validPublication() || published.size !== transferred.size || [...transferred].some(r => !published.has(r))) {
        throw new Error('terrain: diagnostic factory publication changed during shell disposal');
      }
      return mesh;
    } catch (error) {
      const cleanup = [];
      const resources = new Set([ownedNormal, ownedNoise, material]);
      // Returning an unattached mesh transfers its geometry/material ownership to this construction.
      // A factory that throws before returning remains responsible for its own partial publication.
      for (const resource of resources) {
        if (disposed.has(resource)) continue;
        disposed.add(resource);
        try { resource.dispose(); } catch (e) { cleanup.push(e); }
      }
      cleanupResources(transferred, cleanup);
      if (cleanup.length) {
        const aggregate = new AggregateError([error, ...cleanup], 'terrain: diagnostic factory and cleanup failed');
        if (error?.cleanupPromise) aggregate.cleanupPromise = error.cleanupPromise;
        throw aggregate;
      }
      throw error;
    }
  }
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

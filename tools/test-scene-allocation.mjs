// Pure CPU controls: fake native GL records unchanged calls; no browser or renderer is launched.
import assert from 'node:assert/strict';
import {AllocationLedger,mipSizes,installAllocationObserver,ReservationPeak,rejectionObservation} from './bake/scene-allocation.mjs';

function observed() {
  const saved={window:globalThis.window,WebGLRenderingContext:globalThis.WebGLRenderingContext,WebGL2RenderingContext:globalThis.WebGL2RenderingContext};
  class GL {
    constructor(){this.bindings=new Map();this.native=[];this.drawingBufferWidth=100;this.drawingBufferHeight=50;}
    getParameter(x){return this.bindings.get(x);}
    getContextAttributes(){return {depth:true,stencil:false,antialias:false};}
  }
  const constants=['TEXTURE_2D','TEXTURE_CUBE_MAP','TEXTURE_3D','TEXTURE_2D_ARRAY','TEXTURE_BINDING_2D','TEXTURE_BINDING_CUBE_MAP','TEXTURE_BINDING_3D','TEXTURE_BINDING_2D_ARRAY',
    'RGBA','RGB','FLOAT','HALF_FLOAT','RGBA8','RGBA16F','DEPTH_COMPONENT16','RENDERBUFFER_BINDING','ARRAY_BUFFER','ARRAY_BUFFER_BINDING'];
  constants.forEach((name,i)=>GL.prototype[name]=i+100);
  GL.prototype.TEXTURE_CUBE_MAP_POSITIVE_X=1000;GL.prototype.TEXTURE_CUBE_MAP_NEGATIVE_Z=1005;
  for(const name of ['texImage2D','compressedTexImage2D','texImage3D','compressedTexImage3D','texStorage2D','texStorage3D','generateMipmap','bufferData','renderbufferStorage','renderbufferStorageMultisample','deleteTexture','deleteBuffer','deleteRenderbuffer','finish'])
    GL.prototype[name]=function(...args){this.native.push({name,args});return 'native-result';};
  try {
    globalThis.window={};globalThis.WebGLRenderingContext=undefined;globalThis.WebGL2RenderingContext=GL;
    installAllocationObserver({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()});
    const gl=new GL(),snap=()=>window.__allocation.snapshot(gl),bind=(kind)=>{const o={};gl.bindings.set(gl[kind],o);return o;};
    const t=bind('TEXTURE_BINDING_2D');
    assert.equal(gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,0,{width:8,height:4}),'native-result');
    gl.generateMipmap(gl.TEXTURE_2D);const rgba=snap();
    gl.deleteTexture(t);const beforeFinish=snap();gl.finish();const afterFinish=snap();
    bind('TEXTURE_BINDING_2D');gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,8,4,0,gl.RGBA,gl.HALF_FLOAT,null);
    bind('RENDERBUFFER_BINDING');gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,8,4);
    bind('ARRAY_BUFFER_BINDING');const bufferArray=new Float32Array(10);gl.bufferData(gl.ARRAY_BUFFER,bufferArray,gl.STATIC_DRAW,2,3);const floating=snap(),bufferReservation=window.__allocation.bufferReservation(gl,bufferArray);
    const cube=bind('TEXTURE_BINDING_CUBE_MAP');
    for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,gl.RGBA8,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);const cubeAdded=snap().bytes-floating.bytes;
    gl.deleteTexture(cube);gl.finish();
    const prior=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,4,gl.RGBA8,8,8);gl.generateMipmap(gl.TEXTURE_2D);const immutableAdded=snap().bytes-prior;
    const priorNpot=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,Math.log2(7)+1,gl.RGBA8,7,5);gl.generateMipmap(gl.TEXTURE_2D);const npotAdded=snap().bytes-priorNpot;
    const priorCompressed=snap().bytes;bind('TEXTURE_BINDING_2D');gl.compressedTexImage2D(gl.TEXTURE_2D,0,0x93B0,7,5,0,new Uint8Array(64));const compressedAdded=snap().bytes-priorCompressed;
    const small=snap();gl.drawingBufferWidth=200;gl.drawingBufferHeight=100;const resized=snap();
    bind('TEXTURE_BINDING_2D');gl.compressedTexImage2D(gl.TEXTURE_2D,0,99999,4,4,0,new Uint8Array(16));const unknown=snap();
    return {rgba,beforeFinish,afterFinish,floating,bufferReservation,cubeAdded,immutableAdded,npotAdded,compressedAdded,small,resized,unknown,native:gl.native};
  } finally {for(const [key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
const api={Ledger:AllocationLedger,mips:mipSizes,observe:observed,Peak:ReservationPeak,rejection:rejectionObservation};
const checks=[
  ['npot-mips',a=>assert.deepEqual(a.mips(7,5,4).map(m=>m.bytes),[140,24,4],'npot-mips: complete NPOT tail')],
  ['replacement-peak',a=>{const l=new a.Ledger(),id={};l.reserve(id,'texture',0,100);l.reserve(id,'texture',0,60);assert.equal(l.bytes,60,'replacement-peak: current bytes');assert.equal(l.peak,160,'replacement-peak: old and new storage overlap');}],
  ['deferred-delete',a=>{const o=a.observe();assert.equal(o.beforeFinish.bytes,172,'deferred-delete: native delete still charged');assert.equal(o.beforeFinish.pendingDeleteBytes,172,'deferred-delete: pending bytes');assert.equal(o.afterFinish.bytes,0,'deferred-delete: finish retires API objects');}],
  ['native-uncompressed',a=>{const o=a.observe();assert.equal(o.rgba.byKind.texture,172,'native-uncompressed: actual image overload plus mips');assert.equal(o.floating.byKind.texture,256,'native-uncompressed: half-float colour');assert.equal(o.floating.byKind.renderbuffer,128,'native-uncompressed: conservative depth');assert.equal(o.floating.byKind.buffer,12,'native-uncompressed: typed-array offset and length');assert.equal(o.native[0].args.length,6,'native-uncompressed: GL call left intact');}],
  ['cube-storage',a=>{const o=a.observe();assert.equal(o.cubeAdded,2040,'cube-storage: all six complete cube faces');assert.equal(o.immutableAdded,340,'cube-storage: immutable generation never doubles storage');}],
  ['compressed-blocks',a=>assert.equal(a.observe().compressedAdded,64,'compressed-blocks: padded ASTC blocks')],
  ['native-npot-storage',a=>{const o=a.observe();assert.equal(o.npotAdded,168,'native-npot-storage: fractional GLsizei level conversion charges full NPOT tail');assert.ok(!o.unknown.unknown.some(x=>x.startsWith('observer:')),'native-npot-storage: observer never hides native allocation');assert.equal(o.native.find(c=>c.name==='texStorage2D'&&c.args[3]===7).args[1],Math.log2(7)+1,'native-npot-storage: native arguments unchanged');}],
  ['resize-overlap',a=>{const o=a.observe();assert.equal(o.small.defaultFramebuffer,60000,'resize-overlap: two colours and depth');assert.equal(o.resized.defaultPeak,300000,'resize-overlap: old plus new default surfaces');}],
  ['unknown-refuses-verdict',a=>assert.ok(a.observe().unknown.unknown.includes('compressed format:99999'),'unknown-refuses-verdict: unsupported formats prevent verdict')],
  ['event-rejection',async a=>{assert.deepEqual(await a.rejection(()=>Promise.reject({type:'error'})),{rejected:true,message:'error'},'event-rejection: DOM image error need not have a message');assert.deepEqual(await a.rejection(()=>Promise.resolve()),{rejected:false,message:''},'event-rejection: fulfilled loads stay distinct');}],
  ['synchronized-peak',a=>{const p=new a.Peak(),attrs={depth:true};p.sample(1000000,100,50,attrs);p.sample(0,200,100,attrs);assert.equal(p.peak,1060000,'synchronized-peak: independent maxima never added');const o=a.observe();assert.ok(o.resized.gpuPeak>=300000,'synchronized-peak: resize overlap retained');}],
  ['buffer-ownership',a=>assert.deepEqual(a.observe().bufferReservation,{id:1,bytes:12,pendingDelete:false},'buffer-ownership: native upload array resolves one actual buffer')],
];
const changed=(key,value)=>({observe:()=>({...observed(),[key]:value})});
class NoOverlap extends AllocationLedger {reserve(id,k,s,n){super.reserve(id,k,s,n,false);}}
const mutants={
  'npot-mips':{mips:()=>[{bytes:140}]},'replacement-peak':{Ledger:NoOverlap},
  'deferred-delete':changed('beforeFinish',{bytes:0,pendingDeleteBytes:0}),
  'native-uncompressed':changed('rgba',{byKind:{texture:128}}),
  'cube-storage':changed('cubeAdded',340),'compressed-blocks':changed('compressedAdded',35),
  'native-npot-storage':changed('npotAdded',0),
  'resize-overlap':changed('resized',{defaultPeak:240000}),'unknown-refuses-verdict':changed('unknown',{unknown:[]}),
  'event-rejection':{rejection:async()=>({rejected:false,message:''})},
  'synchronized-peak':{Peak:class extends ReservationPeak {sample(...args){super.sample(...args);this.peak=1240000;}}},
  'buffer-ownership':changed('bufferReservation',null),
};
for(const [,check]of checks)await check(api);
console.log(`SCENE-ALLOCATION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let error;try{await check({...api,...mutants[name]});}catch(e){error=e;}assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail its own assertion`);console.log(`CAUGHT ${name}`);}
  console.log(`SCENE-ALLOCATION CONTROLS OK (${checks.length}/${checks.length})`);
}

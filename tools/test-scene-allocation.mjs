// Pure CPU controls: fake native GL records unchanged calls; no browser or renderer is launched.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {float32TerrainRetirementErrors,float32OriginalReceiptValid,reduceFocusedFloat32LookoutObservations,failPaintedComparison,collectPaintedIsolation,AllocationLedger,mipSizes,installAllocationObserver,ReservationPeak,rejectionObservation,reduceSceneObservations,reduceFocusedLookoutObservations,focusedSceneResourceErrors,sampleSceneAllocations,initializeSceneTextures,sceneMatrixContract,createSceneHistory,compactSceneSample,expandSceneContext,sceneReportEnvelope,scenePartHeader,createSceneMatrixMerger} from './bake/scene-allocation.mjs';
import {deriveSceneStressContract} from './bake/inactive-figures.mjs';
import {QUALIFIED_HYBRID} from './bake/review-current-compression.mjs';
import {settleSceneCapture} from './bake/scene-allocation.mjs';
import * as THREE from 'three';
import {buildTrees} from '../src/world/props.js';
import {RtsCamera} from '../src/render/rts-camera.js';
import {scenePostAdmissionSnapshot,scenePostAdmissionValid,sceneTerrainContractValid,sceneFullFloat32HeaderValid,reduceFullFloat32SceneObservations} from './bake/scene-allocation.mjs';
import {Post} from '../src/render/post.js';
import {readSceneTerrainContracts} from './bake/scene-terrain-contract.mjs';

function observed(skipRestore=false,dropSamplePeak=false,forgetOldBuffer=false,sampler=sampleSceneAllocations,forgetOwners=false,nativeJournal=false) {
  const saved={window:globalThis.window,WebGLRenderingContext:globalThis.WebGLRenderingContext,WebGL2RenderingContext:globalThis.WebGL2RenderingContext};
  class GL {
    constructor(){this.bindings=new Map();this.native=[];this.drawingBufferWidth=100;this.drawingBufferHeight=50;}
    getParameter(x){return this.bindings.get(x);}
    getContextAttributes(){return {depth:true,stencil:false,antialias:false};}
    getError(){return 0;}
  }
  const constants=['TEXTURE_2D','TEXTURE_CUBE_MAP','TEXTURE_3D','TEXTURE_2D_ARRAY','TEXTURE_BINDING_2D','TEXTURE_BINDING_CUBE_MAP','TEXTURE_BINDING_3D','TEXTURE_BINDING_2D_ARRAY',
    'RGBA','RGB','FLOAT','HALF_FLOAT','RGBA8','RGBA16F','DEPTH_COMPONENT16','RENDERBUFFER_BINDING','ARRAY_BUFFER','ARRAY_BUFFER_BINDING'];
  const enums=[3553,34067,32879,35866,32873,34068,32874,35869,6408,6407,5126,5131,32856,34842,33189,36007,34962,34964];
  constants.forEach((name,i)=>GL.prototype[name]=enums[i]);
  GL.prototype.TEXTURE_CUBE_MAP_POSITIVE_X=34069;GL.prototype.TEXTURE_CUBE_MAP_NEGATIVE_Z=34074;
  for(const name of ['texImage2D','compressedTexImage2D','compressedTexSubImage2D','compressedTexSubImage3D','texImage3D','compressedTexImage3D','texStorage2D','texStorage3D','generateMipmap','bufferData','renderbufferStorage','renderbufferStorageMultisample','deleteTexture','deleteBuffer','deleteRenderbuffer','finish'])
    GL.prototype[name]=function(...args){this.native.push({name,args});return 'native-result';};
  const inherited=Object.create(Object.getPrototypeOf(GL.prototype));
  Object.defineProperty(inherited,'compressedTexSubImage3D',Object.getOwnPropertyDescriptor(GL.prototype,'compressedTexSubImage3D'));
  delete GL.prototype.compressedTexSubImage3D;Object.setPrototypeOf(GL.prototype,inherited);
  const descriptors=Object.getOwnPropertyDescriptors(GL.prototype),nativeInherited=GL.prototype.compressedTexSubImage3D;
  try {
    globalThis.window={};globalThis.WebGLRenderingContext=undefined;globalThis.WebGL2RenderingContext=GL;
    Object.defineProperty(window,'__allocation',{value:{prior:true},writable:false,enumerable:false,configurable:true});
    const priorObserver=Object.getOwnPropertyDescriptor(window,'__allocation');
    const historyInstall=forgetOldBuffer?(0,eval)('('+installAllocationObserver.toString().replace('ids.add(id);','ids.clear();ids.add(id);')+')'):installAllocationObserver;
    const ownerInstall=forgetOwners?(0,eval)('('+installAllocationObserver.toString().replace('for(const label of labels)owners.add(label);','void labels;')+')'):historyInstall;
    const install=dropSamplePeak?(0,eval)('('+installAllocationObserver.toString().replace(
      's.defaultPeak=Math.max(s.defaultPeak,s.gpu.framebuffer+s.gpu.pendingFramebuffer);return current;','return current;')+')'):ownerInstall;
    install({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal});
    const gl=new GL(),snap=()=>window.__allocation.snapshot(gl),bind=(kind)=>{const o={};gl.bindings.set(gl[kind],o);return o;};
    const t=bind('TEXTURE_BINDING_2D');
    assert.equal(gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,0,{width:8,height:4}),'native-result');
    gl.generateMipmap(gl.TEXTURE_2D);const rgba=snap(),textureIdentity=window.__allocation.textureReservation(gl,t),foreignTextureIdentity=window.__allocation.textureReservation(gl,{});
    gl.deleteTexture(t);const beforeFinish=snap(),pendingTextureIdentity=window.__allocation.textureReservation(gl,t);gl.finish();const afterFinish=snap(),retiredTextureIdentity=window.__allocation.textureReservation(gl,t);
    bind('TEXTURE_BINDING_2D');gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,8,4,0,gl.RGBA,gl.HALF_FLOAT,null);
    const depthBuffer=bind('RENDERBUFFER_BINDING');gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,8,4);
    const renderbufferIdentity=window.__allocation.renderbufferReservation(gl,depthBuffer),foreignRenderbufferIdentity=window.__allocation.renderbufferReservation(gl,{});
    bind('ARRAY_BUFFER_BINDING');const bufferArray=new Float32Array(10);gl.bufferData(gl.ARRAY_BUFFER,bufferArray,gl.STATIC_DRAW,2,3);const floating=snap(),bufferReservation=window.__allocation.bufferReservation(gl,bufferArray);
    const cube=bind('TEXTURE_BINDING_CUBE_MAP');
    for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,gl.RGBA8,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);const cubeAdded=snap().bytes-floating.bytes;
    gl.deleteTexture(cube);gl.finish();
    const prior=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,4,gl.RGBA8,8,8);gl.generateMipmap(gl.TEXTURE_2D);const immutableAdded=snap().bytes-prior;
    const priorNpot=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,Math.log2(7)+1,gl.RGBA8,7,5);gl.generateMipmap(gl.TEXTURE_2D);const npotAdded=snap().bytes-priorNpot;
    const priorCompressed=snap().bytes;bind('TEXTURE_BINDING_2D');gl.compressedTexImage2D(gl.TEXTURE_2D,0,0x93B0,7,5,0,new Uint8Array(64));const compressedAdded=snap().bytes-priorCompressed;
    const priorAstc=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,4,0x93B0,8,8);const astcAdded=snap().bytes-priorAstc;
    gl.compressedTexSubImage2D(gl.TEXTURE_2D,0,0,0,8,8,0x93B0,new Uint8Array(64));const afterAstcSubimage=snap().bytes-priorAstc;
    const priorBc7=snap().bytes;bind('TEXTURE_BINDING_2D');gl.texStorage2D(gl.TEXTURE_2D,3,0x8E8C,7,5);const bc7Added=snap().bytes-priorBc7;
    const compressedImmutableUnknown=snap().unknown.slice();
    const small=snap();gl.drawingBufferWidth=200;gl.drawingBufferHeight=100;const resized=snap();
    gl.finish();
    const fresh=new GL();window.__allocation.snapshot(fresh);fresh.drawingBufferWidth=200;fresh.drawingBufferHeight=100;
    fresh.finish();const resizedAfterFinish=window.__allocation.snapshot(fresh); // No resize snapshot before native finish.
    bind('TEXTURE_BINDING_2D');gl.compressedTexImage2D(gl.TEXTURE_2D,0,99999,4,4,0,new Uint8Array(16));const unknown=snap();
    const old=bind('ARRAY_BUFFER_BINDING');gl.bufferData(gl.ARRAY_BUFFER,bufferArray,gl.STATIC_DRAW);gl.deleteBuffer(old);
    const replacement=bind('ARRAY_BUFFER_BINDING');gl.bufferData(gl.ARRAY_BUFFER,bufferArray,gl.STATIC_DRAW);
    const node={name:'known-native-array',type:'Mesh',visible:true,material:{map:{isTexture:true}},geometry:{attributes:{position:{array:bufferArray}},index:null,morphAttributes:{}}};
    const scene={traverse(fn){fn(node);}},post={renderer:{getContext:()=>gl,initTexture(t){gl.native.push({name:'initTexture',args:[t]});}}};
    window.__game={scene,post,game:{baked:{atlases:{}}}};
    const beforeSample=gl.native.length,firstSample=sampler(window),samplingCalls=gl.native.slice(beforeSample).map(r=>r.name);
    const knownId=window.__allocation.bufferReservation(gl,bufferArray).id;
    gl.deleteBuffer(replacement);scene.traverse=()=>{};const detachedSample=sampler(window);
    bind('ARRAY_BUFFER_BINDING');gl.bufferData(gl.ARRAY_BUFFER,32,gl.STATIC_DRAW);const unassociatedSample=sampler(window);
    const pendingBuffers=window.__allocation.bufferReservations(gl,bufferArray);gl.finish();
    const settledBuffers=window.__allocation.bufferReservations(gl,bufferArray);
    const retiredSample=sampler(window);
    bind('ARRAY_BUFFER_BINDING');gl.bufferData(gl.ARRAY_BUFFER,bufferArray,gl.STATIC_DRAW);
    window.__allocation.labelBufferOwners(gl,bufferArray,['demonstrated']);gl.bufferData(gl.ARRAY_BUFFER,16,gl.STATIC_DRAW);
    const reallocatedSample=sampler(window);
    gl.deleteRenderbuffer(depthBuffer);const pendingRenderbufferIdentity=window.__allocation.renderbufferReservation(gl,depthBuffer);gl.finish();const retiredRenderbufferIdentity=window.__allocation.renderbufferReservation(gl,depthBuffer);
    const lossGL=new GL(),lossTexture={};lossGL.bindings.set(lossGL.TEXTURE_BINDING_2D,lossTexture);lossGL.texImage2D(lossGL.TEXTURE_2D,0,lossGL.RGBA,lossGL.RGBA,0,{width:8,height:4});
    const lossBefore=window.__allocation.snapshot(lossGL);lossGL.getContextAttributes=()=>null;lossGL.isContextLost=()=>true;lossGL.deleteTexture(lossTexture);lossGL.finish();
    const lostCalls=window.__allocation.nativeCalls(lossGL),lostPrimary=window.__allocation.textureReservation(lossGL,lossTexture);lostCalls.deleteTexture=999;
    const lostCallsFresh=window.__allocation.nativeCalls(lossGL);lossGL.getContextAttributes=()=>({depth:true,stencil:false,antialias:false});lossGL.isContextLost=()=>false;
    const lossPending=window.__allocation.snapshot(lossGL);lossGL.finish();const lossRestored=window.__allocation.snapshot(lossGL);
    const lossObservation={before:lossBefore,pending:lossPending,restored:lossRestored,lostPrimary,lostCallsFresh};
    const observer=window.__allocation;if(!skipRestore){observer.restore();observer.restore();}
    const after=Object.getOwnPropertyDescriptors(GL.prototype);
    const exactRestore=Object.keys(after).length===Object.keys(descriptors).length&&Object.entries(descriptors).every(([key,d])=>
      after[key]?.value===d.value&&after[key]?.get===d.get&&after[key]?.set===d.set&&after[key]?.writable===d.writable&&after[key]?.enumerable===d.enumerable&&after[key]?.configurable===d.configurable);
    const windowRestore=Object.entries(priorObserver).every(([key,value])=>Object.getOwnPropertyDescriptor(window,'__allocation')?.[key]===value);
    const inheritedRestore=!Object.hasOwn(GL.prototype,'compressedTexSubImage3D')&&GL.prototype.compressedTexSubImage3D===nativeInherited;
    return {lossObservation,renderbufferIdentity,foreignRenderbufferIdentity,pendingRenderbufferIdentity,retiredRenderbufferIdentity,textureIdentity,foreignTextureIdentity,pendingTextureIdentity,retiredTextureIdentity,pendingBuffers,settledBuffers,firstSample,samplingCalls,detachedSample,unassociatedSample,retiredSample,reallocatedSample,knownId,rgba,beforeFinish,afterFinish,floating,bufferReservation,cubeAdded,immutableAdded,npotAdded,compressedAdded,astcAdded,afterAstcSubimage,bc7Added,compressedImmutableUnknown,exactRestore,windowRestore,inheritedRestore,small,resized,resizedAfterFinish,unknown,native:gl.native};
  } finally {for(const [key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
const api={Ledger:AllocationLedger,mips:mipSizes,observe:observed,Peak:ReservationPeak,rejection:rejectionObservation,reduce:reduceSceneObservations,focused:reduceFocusedLookoutObservations,resource:focusedSceneResourceErrors,matrix:sceneMatrixContract,history:createSceneHistory,compact:compactSceneSample,expand:expandSceneContext,envelope:sceneReportEnvelope,merge:createSceneMatrixMerger,header:scenePartHeader};
const phases=Array.from({length:11},(_,i)=>({packId:'pack',phaseId:String(i),scenario:{units:[{id:'us',side:'US',type:'infantry',men:100},{id:'cs',side:'CS',type:'infantry',men:100}]}}));
function observations(){
 const sample=(label,gpuReservation=100)=>({label,gpuReservation,conservativeReservation:gpuReservation+10,glError:0,allocation:{unknown:[]},unmappedBufferBytes:0});
 return {cases:phases.map(p=>({...p,complete:true,restoration:{ok:true},errors:[],states:['field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize'].map(l=>sample(l))})),
  failure:{...sample('failure',260000000),rejected:true,published:false,restoration:{ok:true}}};
}
// Constructed report bookkeeping only. No native GPU/context/route execution is claimed here.
function qualifiedObservations(modelPhases=phases,completion=false){
 const contract=sceneMatrixContract(modelPhases),candidateNames=Array.from({length:2},(_,look)=>Array.from({length:5},(_,i)=>`cs-close-${look?'h2_slouch_roll_butternut':'base'}-${i}-${i===4?'original.png':'astc.ktx2'}`)).flat(),
   report={sceneRoutes:'qualified-both',toolSha:'b'.repeat(40),diagnosticOnly:true,fieldable:false,normalMotion:true,limits:{gpuBytes:250000000},inactivePrototype:true,terrainPartitionPrototype:true,terrainRestorationObserved:true,
     qualification:{...QUALIFIED_HYBRID,members:[...candidateNames,'soldier-hybrid.json','soldier-source.json','compression.json','quality.json'].map(name=>({name,bytes:100,sha256:'a'.repeat(64)}))},cases:[],faults:[]};
 const scenario={units:[{id:'us',side:'US',type:'infantry',men:100},{id:'cs',side:'CS',type:'infantry',men:100}]};
 const make=tuple=>{
   let sequence=0,finish=0;const row={...tuple,contextId:[tuple.packId,tuple.phaseId,tuple.route,tuple.fault||'ordinary'].join('/'),complete:true,contextClosed:true,errors:[],states:[],
     preclose:{US:{fieldReady:true,closePromise:false,closeTextures:false,closeBatches:0,closeRequests:0},CS:{fieldReady:true,closePromise:false,closeTextures:false,closeBatches:0,closeRequests:0},currentSingleBaseBound:true},
     configuration:{fieldUnchanged:true,baseUnchanged:true,nativeUSLoading:true,genuineCapability:tuple.route==='capable',maskedOnlyAstc:tuple.route==='unsupported'}};
   const sample=(label,seq=++sequence)=>({label,sequence:seq,declaredArrayBytes:1000,cpuDeclaredArrayBytes:1000,gpuReservation:100000000,conservativeReservation:100001000,glError:0,unmappedBufferBytes:0,
     allocation:{bytes:99998800,peak:99998800,defaultFramebuffer:1200,defaultPeak:1200,gpuCurrent:100000000,gpuPeak:100000000,pendingDeleteBytes:0,
       byKind:{texture:99998800,buffer:0,renderbuffer:0},dimensions:[10,10],attributes:{depth:true,stencil:false,antialias:false},framebufferAssumption:'constructed two RGBA8 +32bit depth assumption',calls:{finish},unknown:[],bufferSlots:[],textureSlots:[{texture:1,slots:{0:99998800}}]}});
   const restore=()=>{const pending=sample('restored-native-pending');finish++;return {ok:true,configuration:{ok:true},hooks:{ok:true},routes:{ok:true},settings:{ok:true},calls:['terrain','capture','render','allocation'],samples:[pending,sample('restored-native-settled')]};};
   return {row,sample,restore,event:(operation,data={})=>({sequence:++sequence,operation,...data}),sync:()=>finish++};
 };
 for(const tuple of contract.cases){
   const {row,sample,restore}=make(tuple),e=deriveSceneStressContract(scenario,{US:{field:2,close:3},CS:{field:4,close:tuple.route==='capable'?10:5}}),owners=[];let id=0;
   const owner=(label,capacity,strides,drawables=1)=>owners.push({label,capacity,bytes:capacity*strides.reduce((a,b)=>a+b,0),instances:Array(drawables).fill(label.startsWith('rings.')?null:capacity),
     arrays:strides.map(n=>({bytes:capacity*n,reservations:[{id:++id,bytes:capacity*n,pendingDelete:false}]}))});
   for(const side of ['US','CS']){for(const lod of [0,1,2])owner(`procedural.${side}.lod${lod}`,e[side],[64,16,16,4],lod===0?1:2);owner('fallen.'+side,e[side],[64,16,16,4]);
     for(const tier of ['field','close'])for(let i=0;i<e.pages[side][tier];i++)owner(`baked.${side}.${tier}.${i}`,e[side],[48],2);}
   owner('halos',e.US+e.CS,[64,16,4]);owner('horses',e.horses,[64,12]);owner('mounts',e.mounts,[64,12]);
   for(const k of ['US','CS','limbers'])owner('guns.'+k,e.guns[k],[64]);owner('flags',e.flags,[64,4]);owner('smoke',1000,[12,16,4,12,4]);
   row.states=['field','partition-field','inactive-field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize',
     'rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored'].map(l=>sample(l));
   for(const [label,viewport,lens]of [['field',[1024,768],false],['lens-depth',[1024,768],true],['lens-resize',[1366,1024],true],['lens-retired',[1366,1024],false],['narrow-resize',[320,568],false]]){
     const s=row.states.find(s=>s.label===label);Object.assign(s,{viewport,lens,dpr:2});s.allocation.dimensions=viewport;s.allocation.defaultFramebuffer=s.allocation.defaultPeak=viewport[0]*viewport[1]*12;
     s.allocation.bytes=s.allocation.peak=s.allocation.byKind.texture=100000000-s.allocation.defaultPeak;s.allocation.textureSlots[0].slots[0]=s.allocation.bytes;
   }
   row.publication={fieldUnchanged:true,closePages:tuple.route==='capable'?10:5,encodings:tuple.route==='capable'?[...Array(4).fill('astc4x4'),'png',...Array(4).fill('astc4x4'),'png']:Array(5).fill('png'),candidateRequests:tuple.route==='capable'?10:0,failure:null};
   row.ordinaryRoster=[{id:'us',side:'US',type:'infantry',men:100,x:0,z:0,order:{type:'hold'}},{id:'cs',side:'CS',type:'infantry',men:100,x:100,z:0,order:{type:'hold'}}];row.warm={baseline:'explicitly warmed supported lazy resources, retained stress roster and native smoke; pristine state not claimed',afterOrdinary:true,retainedRoster:[...row.ordinaryRoster,{id:'sandbox-us-1',side:'US',type:'cavalry',men:25,x:0,z:0,order:{type:'hold'}}],spawned:{id:'sandbox-us-1',retained:true},combatUnchanged:true};
   if(tuple.phaseId==='lookout-mountain'){
     for(const label of ['partition-native-zoom','framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored'])row.states.push(sample(label));
     const goal={x:0,z:0,yaw:0,pitch:.5,dist:200},camera={position:[0,100,200],quaternion:[0,0,0,1],fov:45,near:.1,far:5000,goal},
       world={terrain:{root:'constructed-terrain',owners:[{mesh:'constructed-terrain',geometry:'constructed-geometry',arrays:[{key:'position',bytes:12,sha256:'a'.repeat(64)}]}]},trees:{root:'constructed-trees',count:1,owners:[{mesh:'constructed-tree',geometry:'constructed-tree-geometry',arrays:[{key:'instanceMatrix',bytes:64,sha256:'a'.repeat(64)}]}]}};
     row.framedComparison={unitId:'us',position:[0,0],simTime:0,goal};
     const labels=['terrain-partition-01-before.png','terrain-partition-02-after.png','terrain-partition-03-zoom.png','rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored','framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored'];
     row.canvasCaptures=labels.map((label,i)=>({label,filename:`${tuple.packId}-${tuple.phaseId}-${tuple.route}-${i+1}-constructed.png`,phase:tuple.phaseId,toolSha:report.toolSha,bytes:100,sha256:'a'.repeat(64),
       width:10,height:10,drawingWidth:10,drawingHeight:10,nativeRenders:1,glError:0,opaque:true,nonuniform:true,kind:'battlefield-canvas capture; DOM HUD excluded',simTime:0,
       style:i===9?'rigged':'baked',comparison:i===9||i===10?{key:'look.figureStyle',a:i===9?'rigged':'baked',b:i===9?'baked':'rigged',split:.5}:null,camera:structuredClone(camera),world:structuredClone(world),roster:structuredClone(row.ordinaryRoster)}));
   }
   row.lodReactivation={before:{id:1},after:{id:2},fullArray:true};row.transitions=[['rigged-reactivation','rigged',false],['near-lod-reupload','rigged',false],['baked-reclamation','baked',false],['compare-rigged-left','rigged',true],['compare-baked-left','baked',true],['baked-restored','baked',false]].map(([label,style,compare])=>({label,style,compare,combatUnchanged:true,combatBefore:'constructed combat snapshot',combatAfter:'constructed combat snapshot'}));row.scenario=structuredClone(scenario);row.capacityContract=e;
   row.stress={mode:'full',loadedTiers:{US:['field','close'],CS:['field','close']},ok:true,native:['stress','restore-upload','restored-scene'].map(label=>({label,ok:true,owners:structuredClone(owners)})),uniqueDynamicBytes:owners.reduce((n,o)=>n+o.bytes,0),smoke:{systems:200,particles:800,capacity:1000},
     transaction:{ok:true,errors:[],restoration:{restored:true,arrays:id},samples:['stress','restore-upload','restored-scene'].map(label=>({label,observation:sample(label)}))}};
   for(const {observation:s} of row.stress.transaction.samples){
     s.declaredArrayBytes=s.cpuDeclaredArrayBytes=row.stress.uniqueDynamicBytes;s.conservativeReservation=s.gpuReservation+s.declaredArrayBytes;
     s.allocation.bufferSlots=owners.flatMap(o=>o.arrays.flatMap(a=>a.reservations.map(r=>({...r,owners:[o.label]}))));
     s.allocation.byKind.buffer=row.stress.uniqueDynamicBytes;s.allocation.byKind.texture=99998800-row.stress.uniqueDynamicBytes;
     s.allocation.textureSlots[0].slots[0]=s.allocation.byKind.texture;
   }
   row.restoration=restore();report.cases.push(row);
 }
 for(const tuple of contract.faults){
   const {row,sample,restore,event,sync}=make(tuple),terminal=tuple.fault.endsWith('terminal');row.events=[];
   const add=(op,data)=>{const e=event(op,data);row.events.push(e);return e;};
   const ordinary=report.cases.find(c=>c.packId===tuple.packId&&c.phaseId===tuple.phaseId&&c.route==='unsupported');
   row.scenario=structuredClone(scenario);row.capacityContract=structuredClone(ordinary.capacityContract);
   const stressFor=(mode,pending=0)=>{
     const stress=structuredClone(ordinary.stress);stress.mode=mode;stress.loadedTiers={US:mode==='preclose'?['field']:['field','close'],CS:mode==='full'?['field','close']:['field']};
     for(const receipt of stress.native)receipt.owners=receipt.owners.filter(o=>!o.label.includes('.close.')||mode==='full'||mode==='terminal'&&o.label.startsWith('baked.US.close.'));
     const owners=stress.native[0].owners;stress.uniqueDynamicBytes=owners.reduce((n,o)=>n+o.bytes,0);stress.transaction.restoration.arrays=owners.reduce((n,o)=>n+o.arrays.length,0);
     stress.transaction.samples=['stress','restore-upload','restored-scene'].map(label=>{
       const s=sample(mode==='preclose'?'preclose-'+label:label);s.declaredArrayBytes=s.cpuDeclaredArrayBytes=stress.uniqueDynamicBytes;s.conservativeReservation=s.gpuReservation+s.declaredArrayBytes;
       s.allocation.bufferSlots=owners.flatMap(o=>o.arrays.flatMap(a=>a.reservations.map(r=>({...r,owners:[o.label]}))));
       s.allocation.byKind.buffer=stress.uniqueDynamicBytes;s.allocation.byKind.texture=s.allocation.bytes-stress.uniqueDynamicBytes;
       s.allocation.textureSlots[0].slots[0]=s.allocation.byKind.texture;s.allocation.pendingDeleteBytes=pending;
       return {label,observation:s};
     });return stress;
   };
   const preload=stressFor('preclose'),preSamples=preload.transaction.samples;row.states.push(...preSamples.map(s=>s.observation));
   row.preload={...preload,transaction:{...preload.transaction},sampleSequences:preSamples.map(s=>s.observation.sequence),before:structuredClone(row.preclose),after:structuredClone(row.preclose),
     baseline:ordinary.warm.baseline,retainedRoster:structuredClone(ordinary.warm.retainedRoster),combatUnchanged:true};delete row.preload.transaction.samples;
   row.states.push(sample('fault-start'));
   if(tuple.route==='capable'){
     const prepare=['first-pool-prepare','candidate-then-baseline-terminal'].includes(tuple.fault);
     candidateNames.forEach(page=>add('candidate-request',{page}));candidateNames.forEach((page,i)=>{if(prepare||tuple.fault==='native-upload'||i)add('candidate-created',{page,textureId:i+1});});
     const heldPage=tuple.fault.startsWith('rejection-delayed-')?candidateNames[tuple.fault.endsWith('astc')?1:4]:null;
     if(heldPage)add('sibling-held',{page:heldPage,encoding:tuple.fault.endsWith('astc')?'astc4x4':'png'});
     candidateNames.forEach((page,i)=>{if(page!==heldPage&&(prepare||i))add('candidate-upload',{page});});
     if(!prepare)add('fault-fired',{fault:tuple.fault,page:candidateNames[0],native:true,glError:0x0501,actualHTTP:true,status:404});
     candidateNames.forEach((page,i)=>{if(page!==heldPage)add('candidate-settled',{page,outcome:prepare||i?'fulfilled':'rejected'});});
     if(heldPage){add('held-check',{published:false,baselineRequests:0,nonHeldSettled:9,rejectionCount:1});add('sibling-released',{page:heldPage});add('candidate-upload',{page:heldPage});add('candidate-settled',{page:heldPage,outcome:'fulfilled'});}
     add('candidate-all-settled');
     if(['first-pool-prepare','candidate-then-baseline-terminal'].includes(tuple.fault))add('first-pool-prepare-rejected');
     if(prepare)add('fault-fired',{fault:tuple.fault,page:candidateNames[0],native:true,glError:0x0501,actualHTTP:true,status:404});
     candidateNames.forEach((page,i)=>{if(prepare||tuple.fault==='native-upload'||i)add('candidate-dispose',{page,textureId:i+1,ok:true});});
     if(completion){
       const start=add('candidate-completion-start',{method:'finish'}),before=sample('candidate-completion-before',start.sequence);
       before.allocation.renderbufferSlots=[];before.allocation.pendingDeleteBytes=1000;before.allocation.textureSlots[0].slots[0]-=1000;before.allocation.textureSlots.push({texture:999,slots:{0:1000},pendingDelete:true});row.states.push(before);
       sync();const done=add('candidate-completion-result',{method:'finish',ok:true,elapsedMs:1}),after=sample('candidate-completion-after',done.sequence);
       after.allocation.renderbufferSlots=[];after.allocation.bytes-=1000;after.allocation.gpuCurrent-=1000;after.allocation.byKind.texture-=1000;after.allocation.textureSlots[0].slots[0]-=1000;row.states.push(after);
     }
   }else add('fault-fired',{fault:tuple.fault});
   const first=add('first-baseline-request',{beforeNativeLoader:true}),firstSample=sample('first-baseline-request',first.sequence);if(tuple.route==='capable'&&!completion)firstSample.allocation.pendingDeleteBytes=1000;row.states.push(firstSample);
   for(let i=0;i<5;i++){const page=`soldier_close_${i}.png`;if(!terminal||i){const e=add('baseline-upload',{page,beforeSample:true}),s=sample('baseline-upload',e.sequence);s.page=page;if(tuple.route==='capable'&&!completion)s.allocation.pendingDeleteBytes=1000;row.states.push(s);}add('baseline-settled',{page,outcome:terminal&&!i?'rejected':'fulfilled'});}
   const pending=sample(terminal?'terminal-rejected-pending':'fallback-published-pending');if(tuple.route==='capable'&&!completion)pending.allocation.pendingDeleteBytes=1000;row.states.push(pending);
   row.stress=stressFor(terminal?'terminal':'full',tuple.route==='capable'&&!completion?1000:0);sync();row.states.push(sample(terminal?'terminal-settled':'fallback-settled'));
   row.candidateRequests=tuple.route==='capable'?10:0;row.poolCount=1;row.outcome={rejected:terminal,published:!terminal,cachedClosePromise:true,fieldUnchanged:true,baselinePages:terminal?0:5,poolPages:[terminal?0:5],exactCurrentSingleBase:true,baselineSiblingsDisposed:true};
   row.restoration=restore();report.faults.push(row);
 }
 if(completion)report.fallbackCompletion='native-finish-after-candidate-disposal';
 return report;
}
function transportObservations(a=api){
 const o=a.observe(false,false,false,sampleSceneAllocations,false,true),history=a.history(),raw=[];
 for(const [i,key]of ['rgba','beforeFinish','afterFinish','floating','small','resized','unknown','firstSample','detachedSample','unassociatedSample','retiredSample','reallocatedSample'].entries()){
   const allocation=o[key].allocation||o[key];raw.push({label:key,sequence:i+1,allocation, gpuReservation:allocation.gpuPeak,conservativeReservation:allocation.peak+allocation.defaultPeak,
     declaredArrayBytes:0,cpuDeclaredArrayBytes:0,glError:0,unmappedBufferBytes:0});
 }
 return {raw,context:{history,states:raw.map(s=>a.compact(history,s))}};
}
// CPU transport profile: retained SOURCE353879 native fixture maxima326 buffers/28 textures/
// 1 renderbuffer/52 signatures/41-character labels. Extra candidate/baseline pages and replacements
// model transport growth; this is not a proven native whole-matrix worst case or a resource budget.
function transportProfile(route,fault=null){
 const ledger=new AllocationLedger(),events=[],signatures=[],calls={},ids=new Map(),history=createSceneHistory(),raw=[],compact=[];let ordinal=0,call='',sequence=0;
 const native=name=>{call=name;ordinal++;calls[name]=(calls[name]||0)+1;};
 ledger.onEvent=(operation,e)=>events.push({sequence:events.length+1,operation,kind:e.kind,id:ids.get(e.id),slot:e.slot??null,bytes:e.bytes??null,previous:e.previous??null,transient:e.transient??null,
   overlap:e.overlap??null,detail:e.detail||null,call,callOrdinal:ordinal,current:ledger.bytes,peak:ledger.peak});
 const reserve=(kind,id,bytes)=>{const key=kind+'/'+id;ids.set(key,id);native(kind==='buffer'?'bufferData':kind==='texture'?'texImage2D':'renderbufferStorage');ledger.reserve(key,kind,kind==='texture'?'3553:0':0,bytes,true,kind==='renderbuffer'?{format:33189,width:4,height:4,samples:1}:null);if(kind==='texture'){const w=Math.sqrt(bytes/4);signatures.push({texture:id,call:'image',nativeCall:call,callOrdinal:ordinal,raw:{target:3553,level:0,format:32856,w,h:w,d:1,type:5121},canonical:{target:3553,level:0,w,h:w,d:1,bytes}});}};
 const retire=(kind,id)=>{native(kind==='buffer'?'deleteBuffer':'deleteTexture');ledger.retire(kind+'/'+id);};
 const finish=()=>{native('finish');events.push({sequence:events.length+1,operation:'finish',kind:null,id:null,slot:null,bytes:null,previous:null,transient:null,overlap:null,detail:null,call,callOrdinal:ordinal,current:ledger.bytes,peak:ledger.peak});ledger.sync();};
 const capture=label=>{
   const allocation={...ledger.snapshot(),defaultFramebuffer:9437184,defaultPeak:9437184,gpuCurrent:ledger.bytes+9437184,gpuPeak:ledger.peak+9437184,dimensions:[1024,768],attributes:{depth:true,stencil:false,antialias:false},calls:{...calls},unknown:[],framebufferAssumption:'constructed transport profile',signatures:structuredClone(signatures),nativeEvents:structuredClone(events),bufferSlots:[],textureSlots:[],renderbufferSlots:[]};
   for(const[key,r]of ledger.objects){const id=ids.get(key),bytes=[...r.slots.values()].reduce((n,b)=>n+b,0),pendingDelete=ledger.retired.has(key);
     allocation[r.kind==='buffer'?'bufferSlots':r.kind==='texture'?'textureSlots':'renderbufferSlots'].push(r.kind==='texture'?{texture:id,slots:Object.fromEntries(r.slots),pendingDelete}:{id,bytes,pendingDelete,...(r.kind==='buffer'?{owners:['constructed/'+String(id).padStart(3,'0')+'x'.repeat(41)]}:{})});}
   const s={label,sequence:++sequence,allocation,gpuReservation:allocation.gpuPeak,conservativeReservation:allocation.peak+allocation.defaultPeak+326*4096,declaredArrayBytes:326*4096,cpuDeclaredArrayBytes:326*4096,glError:0,unmappedBufferBytes:0};
   raw.push(s);compact.push(compactSceneSample(history,s));
 };
 for(let i=1;i<=326;i++)reserve('buffer',i,4096);for(let i=1;i<=28;i++)reserve('texture',i,1048576);reserve('renderbuffer',1,64);
 for(let i=0;i<24;i++)reserve('texture',i%28+1,1048576);
 finish();
 if(!fault){
   const labels=['field','partition-field','inactive-field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize','rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored','stress','restore-upload','restored-scene'];
   for(const[i,label]of labels.entries()){if(i%3===0)for(let j=1;j<=68;j++)reserve('buffer',j,4096+i*16);capture(label);}
 }else{
   for(const label of ['preclose-stress','preclose-restore-upload','preclose-restored-scene'])capture(label);
   capture('fault-start');const candidates=route==='capable'?fault==='native-upload'||fault.includes('prepare')||fault==='candidate-then-baseline-terminal'?10:9:0;
   for(let i=1;i<=candidates;i++)reserve('texture',28+i,65536);
   if(fault.startsWith('rejection-delayed-'))capture('held-check');for(let i=1;i<=candidates;i++)retire('texture',28+i);
   capture('first-baseline-request');for(let i=1;i<=5;i++){reserve('texture',50+i,1048576);capture('baseline-upload');}
   capture('fallback-or-terminal-pending');for(const label of ['stress','restore-upload','restored-scene'])capture(label);finish();capture('fallback-or-terminal-settled');
 }
 capture('restored-native-pending');finish();capture('restored-native-settled');
 return {raw,context:{history,states:compact,kind:'constructed CPU transport profile; native whole-scene matrix UNRUN'}};
}
function retainedArrayFixture(sampler){
 const visible=new Float32Array(4),detached=new Uint32Array(3),node={type:'Mesh',name:'visible',visible:true,geometry:{attributes:{position:{array:visible}},morphAttributes:{}},material:{}},
  gl={getError:()=>0},scope={__game:{scene:{traverse(fn){fn(node);}},post:{renderer:{getContext:()=>gl}},game:{}},
   __allocation:{labelBufferOwners:()=>[],snapshot:()=>({peak:0,defaultPeak:0,gpuPeak:0,bufferSlots:[],byKind:{buffer:0}})},
   __sceneTerrainPartition:{retainedArrays:[{array:visible,owner:'source/visible'},{array:detached,owner:'source/detached'},{array:detached,owner:'source/alias'}]}};
 return sampler(scope);
}
api.sampler=sampleSceneAllocations;
// Constructed resource bookkeeping only; the complete painted native context is Actions-only.
function focusedResourceFixture(){
 const events=[{kind:'texture',id:1,operation:'reserve'},{kind:'renderbuffer',id:1,operation:'reserve',detail:{samples:1,format:33189}}],
  signatures=[{texture:1,raw:{type:5131,format:6408}}],post={texture:1,slots:{0:8},pendingDelete:false},depth={id:1,bytes:4,pendingDelete:false},
  sample=(sequence,label,pending,live=true)=>({sequence,captureId:sequence,label,glError:0,unmappedBufferBytes:0,
    focusedPixel:{canvas:[1,1],admission:{lensBytes:44,resizeBytes:24,pixelBytes:3639218,scale:1}},
    allocation:{gpuPeak:100,gpuCurrent:100,bytes:88,unknown:[],defaultFramebuffer:12,dimensions:[1,1],textureSlots:[post],renderbufferSlots:[depth],signatures,nativeEvents:events,
      bufferSlots:live?[{id:1,bytes:72,owners:['terrain-canonical-1/aGrid'],pendingDelete:pending}]:[]}}),states=[sample(1,'before',false),sample(2,'retired',true),sample(3,'settled',false,false)],
  cycle=(index,kind,labels)=>({index,kind,complete:true,errors:[],checks:[{lost:false,error:0}],sampleLabels:labels,sampleIds:labels.map(l=>states.find(s=>s.label===l).captureId)});
 return {states,resource:{ok:true,exactOriginal:true,bootstrapDraws:0,preparedReleased:true,pixelBytes:3639218,terrain:{kind:'canonical with retained exact original',bytes:5827098,sourceBytes:12750024},
  postTextures:[{id:1,key:'rtScene',kind:'color',uuid:'actual-fixture-pointer',bytes:8,pendingDelete:false}],postRenderbuffers:[{id:1,key:'rtScene',bytes:4,pendingDelete:false}],cycles:[cycle(1,'resize',['before']),cycle(2,'terrain',['before','retired','settled'])]},
  bootstrap:[{method:'GET',url:'http://localhost/?battle=chattanooga&phase=lookout-mountain&quality=high&figures=rigged&nosw',removedEntryModules:1,originalSha256:'a'.repeat(64),servedSha256:'b'.repeat(64)}]};
}
const focusedResourceMutations={
 'focused-resource-original':r=>r.resource.exactOriginal=false,
 'focused-resource-prepared-release':r=>r.resource.preparedReleased=false,
 'focused-resource-startup-draw':r=>r.resource.bootstrapDraws=1,
 'focused-resource-policy':r=>r.resource.pixelBytes=10562144,
 'focused-resource-original-bytes':r=>r.resource.terrain.sourceBytes=5827098,
 'focused-resource-entry-count':r=>r.bootstrap[0].removedEntryModules=2,
 'focused-resource-entry-hash':r=>r.bootstrap[0].servedSha256=r.bootstrap[0].originalSha256,
 'focused-resource-entry-phase':r=>r.bootstrap[0].url=r.bootstrap[0].url.replace('lookout-mountain','orchard-knob'),
 'focused-resource-foreign-depth':r=>r.resource.postRenderbuffers[0].id=2,
 'focused-resource-foreign-texture':r=>r.resource.postTextures[0].id=2,
 'focused-resource-cap':r=>r.states[2].allocation.gpuPeak=250000001,
 'focused-resource-pixels':r=>r.states[2].allocation.textureSlots[0].slots[0]=3639218,
 'focused-resource-pending-default':r=>r.states[2].allocation.gpuCurrent+=3639218,
 'focused-resource-rounding':r=>r.states[2].focusedPixel.admission.lensBytes=3639219,
 'focused-resource-canvas':r=>r.states[2].focusedPixel.canvas=[0,1],
 'focused-resource-half-float':r=>r.states[2].allocation.signatures.push({texture:2,raw:{type:5131,format:6408}}),
 'focused-resource-unowned-rb':r=>r.states[2].allocation.nativeEvents.push({kind:'renderbuffer',id:2,operation:'reserve'}),
 'focused-resource-finish':r=>r.resource.cycles[1].checks[0].error=1280,
 'focused-resource-pending':r=>r.states[1].allocation.bufferSlots[0].pendingDelete=false,
 'focused-resource-retirement':r=>r.states[2].allocation.bufferSlots=[{id:1,bytes:72,owners:['terrain-canonical-1/aGrid'],pendingDelete:true}],
 'focused-resource-null-samples':r=>r.states=[null,null],
 'focused-resource-restore-shape':r=>r.restoration={samples:{}},
 'focused-resource-null-cycle':r=>r.resource.cycles.push(null),
 'focused-resource-null-check':r=>r.resource.cycles[0].checks.push(null),
 'focused-resource-allocation-shape':r=>delete r.states[2].allocation,
 'focused-resource-signature-shape':r=>r.states[2].allocation.signatures={},
 'focused-resource-event-shape':r=>r.states[2].allocation.nativeEvents={},
 'focused-resource-buffer-shape':r=>r.states[0].allocation.bufferSlots={},
};
const checks=[
 ['native-renderbuffer-identity',a=>{const r=a.observe();assert.deepEqual(r.renderbufferIdentity,{id:1,bytes:128,pendingDelete:false},'native-renderbuffer-identity: source native pointer binds owned depth storage');assert.equal(r.foreignRenderbufferIdentity,null,'native-renderbuffer-identity: foreign pointer has no binding');}],
 ['native-renderbuffer-retirement',a=>{const r=a.observe();assert.deepEqual(r.pendingRenderbufferIdentity,{id:1,bytes:128,pendingDelete:true},'native-renderbuffer-retirement: pending native depth ownership survives deletion');assert.equal(r.retiredRenderbufferIdentity,null,'native-renderbuffer-retirement: only native finish removes storage');}],
 ['focused-resource-valid',a=>assert.deepEqual(a.resource(focusedResourceFixture()),[],'focused-resource-valid: exact constructed owner/complete retirement/resource bookkeeping passes')],
 ...Object.entries(focusedResourceMutations).map(([name,mutate])=>[name,a=>{const r=focusedResourceFixture();mutate(r);assert.ok(a.resource(r).length,name+': own changed resource evidence rejected');}]),
 ['focused-full-reject',a=>{const r=qualifiedObservations();r.resourceFocus='canonical-lookout';assert.equal(a.reduce(r,phases).complete,false,'focused-full-reject: focused marker cannot complete original eleven-phase gate');}],
 ['focused-merger-reject',a=>{const r=qualifiedObservations();r.resourceFocus='canonical-lookout';let rejected=false;try{a.merge(phases,r);}catch(e){rejected=/full qualified header/.test(e.message);}assert.equal(rejected,true,'focused-merger-reject: focused header cannot enter complete matrix merger');}],
 ['focused-header-binding',a=>{const r={resourceFocus:'canonical-lookout',canonicalTerrainRepresentation:'canonical with retained exact original',postPixelBytes:3639218,mipPolicy:'full-original'};assert.deepEqual(a.header(r),r,'focused-header-binding: representation/pixel/mip semantics survive bounded transport');}],
 ['focused-never-full',a=>{const r=a.focused({cases:[{states:[{gpuReservation:270000000,conservativeReservation:270000001}]}],resourceFocus:'canonical-lookout'},{packId:'chattanooga',phaseId:'lookout-mountain'});assert.deepEqual([r.complete,r.fullMatrixComplete,r.fieldable,r.maxGpuReservation],[false,false,false,270000000],'focused-never-full: even failed prerequisite retains full peak and cannot claim complete matrix/fielding');}],
 ['retained-cpu-accounting',a=>{const r=retainedArrayFixture(a.sampler);assert.equal(r.declaredArrayBytes,28,'retained-cpu-accounting: detached backing bytes included exactly once');assert.equal(r.retainedTerrainArrayBytes,12,'retained-cpu-accounting: visible aliases are not additional storage');assert.equal(r.conservativeReservation,28,'retained-cpu-accounting: actual retained arrays reach conservative total');}],
 ['retained-cpu-observation',a=>{const r=retainedArrayFixture(a.sampler);assert.ok(r.unuploadedArrays.some(x=>x.bytes===12&&x.owners.includes('source/detached')&&x.owners.includes('source/alias')),'retained-cpu-observation: detached aliases retained without inventing native upload');assert.equal(r.unmappedBufferBytes,0,'retained-cpu-observation: no fabricated native bytes');}],
 ['native-texture-identity',a=>{const o=a.observe();assert(o.textureIdentity?.id===o.rgba.textureSlots[0]?.texture&&o.textureIdentity.bytes===o.rgba.bytes&&!o.textureIdentity.pendingDelete&&o.foreignTextureIdentity===null,'native-texture-identity: actual pointer binds exact observer ID/bytes, no foreign inference');}],
 ['native-texture-retirement',a=>{const o=a.observe();assert(o.pendingTextureIdentity?.id===o.textureIdentity.id&&o.pendingTextureIdentity.pendingDelete&&o.retiredTextureIdentity===null,'native-texture-retirement: owned pending pointer remains until actual completion');}],

 ['completion-qualified',a=>{const r=a.reduce(qualifiedObservations(phases,true),phases);assert.equal(r.complete,true,'completion-qualified: exact declared completion matrix schema '+JSON.stringify(r.errors?.slice(0,8)));assert.equal(r.maxGpuReservation,100000000,'completion-qualified: prior peak retained');}],
 ...Object.entries({
   'completion-missing':r=>r.faults[0].states=r.faults[0].states.filter(s=>s.label!=='candidate-completion-after'),
   'completion-extra':r=>r.faults[0].states.find(s=>s.label==='candidate-completion-after').allocation.calls.finish++,
   'completion-early':r=>r.faults[0].events.find(e=>e.operation==='candidate-completion-start').sequence=1,
   'completion-result':r=>r.faults[0].events.find(e=>e.operation==='candidate-completion-result').ok=false,
   'completion-duration':r=>r.faults[0].events.find(e=>e.operation==='candidate-completion-result').elapsedMs=-1,
   'completion-pending-id':r=>r.faults[0].states.find(s=>s.label==='candidate-completion-after').allocation.textureSlots.push({texture:999,slots:{0:1000},pendingDelete:true}),
   'completion-lost-peak':r=>r.faults[0].states.find(s=>s.label==='candidate-completion-after').allocation.gpuPeak--,
   'completion-unmarked':r=>delete r.fallbackCompletion,
 }).map(([name,mutate])=>[name,a=>{const r=qualifiedObservations(phases,true);mutate(r);assert.equal(a.reduce(r,phases).complete,false,name+': broken completion boundary rejects');}]),
 ['parts-complete',a=>{const report=qualifiedObservations(),m=a.merge(phases,report);for(const p of phases){const key=p.packId+'/'+p.phaseId,match=r=>r.packId===p.packId&&r.phaseId===p.phaseId;m.add({...scenePartHeader(report),phaseKey:key,complete:true,cases:report.cases.filter(match),faults:report.faults.filter(match)});}const r=m.finalize();assert.deepEqual([r.complete,r.withinLimit,r.parts.length,r.maxGpuReservation],[true,true,11,100000000],'parts-complete: whole independently reduced 22+88 union');}],
 ...Object.entries({
   'parts-missing':parts=>parts.pop(),
   'parts-duplicate':parts=>parts[1]=parts[0],
   'parts-reordered':parts=>[parts[0],parts[1]]=[parts[1],parts[0]],
   'parts-source':parts=>parts[1].toolSha='c'.repeat(40),
   'parts-qualification':parts=>parts[1].qualification.members[0].sha256='c'.repeat(64),
   'parts-completion':parts=>parts[1].fallbackCompletion='native-finish-after-candidate-disposal',
   'parts-context':parts=>parts[1].cases[0].contextId=parts[0].cases[0].contextId,
   'parts-roster':parts=>parts[1].faults[0].preload.retainedRoster.pop(),
   'parts-history':parts=>parts[1].nativeHistoryRequired=true,
 }).map(([name,mutate])=>[name,a=>{const report=qualifiedObservations(),parts=phases.map(p=>{const match=r=>r.packId===p.packId&&r.phaseId===p.phaseId;return structuredClone({...scenePartHeader(report),phaseKey:p.packId+'/'+p.phaseId,complete:true,cases:report.cases.filter(match),faults:report.faults.filter(match)});}),m=a.merge(phases,report);mutate(parts);for(const p of parts)m.add(p);assert.equal(m.finalize().complete,false,name+': whole union cannot accept altered part');}]),
 ['parts-failed-peak',a=>{const report=qualifiedObservations(),m=a.merge(phases,report);for(const p of phases){const match=r=>r.packId===p.packId&&r.phaseId===p.phaseId,part=structuredClone({...scenePartHeader(report),phaseKey:p.packId+'/'+p.phaseId,complete:true,cases:report.cases.filter(match),faults:report.faults.filter(match)});if(p===phases[0]){part.complete=false;part.faults[0].states[0].gpuReservation=300000000;part.faults[0].states[0].conservativeReservation=310000000;}m.add(part);}const r=m.finalize();assert.deepEqual([r.complete,r.maxGpuReservation,r.maxReservation],[false,300000000,310000000],'parts-failed-peak: independently retain failed part maximum');}],
 ['scene-history-matrix-envelope',a=>{
   const contract=sceneMatrixContract(phases),templates=new Map(),model={cases:[],faults:[],kind:'CPU transport sized from one retained native fixture; not proven native worst case'};
   for(const[collection,tuples]of [['cases',contract.cases],['faults',contract.faults]])for(const tuple of tuples){const key=tuple.route+'/'+(tuple.fault||'ordinary');let t=templates.get(key);if(!t){const profile=transportProfile(tuple.route,tuple.fault);assert(isDeepStrictEqual(a.expand(profile.context).states,profile.raw),'scene-history-matrix-envelope: profiles round-trip all samples losslessly');t=profile.context;templates.set(key,t);}model[collection].push({...tuple,...t});}
   const envelope=a.envelope(model);assert.equal(model.cases.length,22,'scene-history-matrix-envelope:22 ordinary contexts');assert.equal(model.faults.length,88,'scene-history-matrix-envelope:88 fault contexts');assert.equal(envelope.withinLimit,true,'scene-history-matrix-envelope: complete constructed transport fits90M reader margin');assert.equal(envelope.limit,90000000,'scene-history-matrix-envelope: reader margin is explicit');assert(envelope.bytes>1000000,'scene-history-matrix-envelope: real full-profile serialization measured');
   console.log(`SCENE-HISTORY CPU MODEL22+88 ${envelope.bytes} bytes; native whole-matrix worst case UNRUN`);
 }],
 ['scene-history-envelope-overflow',a=>{const result=a.envelope({constructed:'x'.repeat(90000000)});assert.equal(result.withinLimit,false,'scene-history-envelope-overflow: complete oversized evidence refused, never truncated');assert(result.bytes>=90000000,'scene-history-envelope-overflow: actual serialized byte length counted');}],
 ['scene-history-reducer-equivalence',a=>{
   const {raw}=transportObservations(),report=observations(),labels=['field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize'];
   report.cases=phases.map(p=>({...p,complete:true,errors:[],restoration:{ok:true},states:raw.slice(0,6).map((s,i)=>({...structuredClone(s),label:labels[i]}))}));
   const compact=structuredClone(report);for(const row of compact.cases){row.history=a.history();row.states=row.states.map(s=>a.compact(row.history,s));}
   assert.deepEqual(a.reduce(compact,phases),a.reduce(report,phases),'scene-history-reducer-equivalence: one reducer preserves complete schema and oversize failure peak');assert.equal(a.reduce(compact,phases).complete,true,'scene-history-reducer-equivalence: compact complete model admitted');
 }],
 ['native-journal-kinds',a=>{const o=a.observe(false,false,false,sampleSceneAllocations,false,true),events=o.reallocatedSample.allocation.nativeEvents;
   assert.deepEqual([...new Set(events.filter(e=>e.operation==='reserve').map(e=>e.kind))].sort(),['buffer','renderbuffer','texture'],'native-journal-kinds: ordered records cover all three allocation kinds');
   assert(events.some(e=>e.operation==='retire')&&events.some(e=>e.operation==='release')&&events.some(e=>e.operation==='finish'),'native-journal-kinds: native fence retains retirement and actual removal');
   assert(events.every((e,i)=>e.sequence===i+1&&e.callOrdinal>0),'native-journal-kinds: one complete chronological sequence');}],
 ['native-journal-replacement',a=>{const o=a.observe(false,false,false,sampleSceneAllocations,false,true),events=o.reallocatedSample.allocation.nativeEvents,e=events.filter(e=>e.kind==='buffer'&&e.operation==='reserve'&&e.previous>0).at(-1);
   assert.equal(e.previous,40,'native-journal-replacement: original native reservation retained');assert.equal(e.bytes,16,'native-journal-replacement: replacement byte length retained');assert.equal(e.transient-e.current,40,'native-journal-replacement: transient old/new overlap retained');assert(e.peak>=e.transient,'native-journal-replacement: cumulative peak covers transient');}],
 ['native-journal-copy',a=>{const o=a.observe(false,false,false,sampleSceneAllocations,false,true);o.rgba.nativeEvents[0].bytes=1;assert.notEqual(o.beforeFinish.nativeEvents[0].bytes,1,'native-journal-copy: earlier returned history cannot mutate later snapshots');}],
 ['native-journal-off',a=>assert.equal(a.observe().rgba.nativeEvents,undefined,'native-journal-off: legacy snapshot shape remains unchanged')],
 ['scene-history-roundtrip',a=>{const {raw,context}=transportObservations(a),expanded=a.expand(context);assert.deepEqual(expanded.states,raw,'scene-history-roundtrip: every scalar, signature, native event and native slot restored exactly');assert(context.states.every(s=>!s.allocation.bufferSlots&&!s.allocation.nativeEvents),'scene-history-roundtrip: repeated native records stored once');}],
 ...Object.entries({
   'scene-history-backward':c=>c.states[1].allocation.history.nativeEventsEnd=0,
   'scene-history-missing-revision':c=>c.history.slotRevisions.pop(),
   'scene-history-lost-transient':c=>c.history.nativeEvents.find(e=>e.operation==='reserve').transient++,
   'scene-history-native-order':c=>c.history.nativeEvents[0].sequence++,
   'scene-history-signature-loss':c=>{c.history.signatures=[];for(const s of c.states)s.allocation.history.signaturesEnd=0;},
   'scene-history-signature-format':c=>c.history.signatures[0].raw.format=0,
   'scene-history-signature-bytes':c=>c.history.signatures[0].canonical.bytes=1,
   'scene-history-signature-payload':c=>{delete c.history.signatures[0].raw;delete c.history.signatures[0].canonical;},
   'scene-history-native-call':c=>{for(const e of c.history.nativeEvents)if(e.operation==='reserve')e.call='deleteTexture';},
   'scene-history-call-ordinal':c=>{for(const e of c.history.nativeEvents)e.callOrdinal=1;},
   'scene-history-same-call-ordinal':c=>{const e=c.history.nativeEvents.filter(e=>e.call==='bufferData');e[1].callOrdinal=e[0].callOrdinal;},
   'scene-history-renderbuffer-size':c=>{c.history.nativeEvents.find(e=>e.kind==='renderbuffer'&&e.operation==='reserve').detail.width=100000;},
   'scene-history-slot-bytes':c=>c.history.slotRevisions.find(r=>r.operation==='upsert'&&r.kind==='buffer').record.bytes++,
   'scene-history-native-fence':c=>c.history.nativeEvents.find(e=>e.operation==='finish').operation='reserve',
   'scene-history-mixed-records':c=>c.states[0].allocation.bufferSlots=[],
 }).map(([name,change])=>[name,a=>{const {context}=transportObservations(a);change(context);let failure;try{a.expand(context);}catch(e){failure=e;}assert(failure?.message.startsWith('scene history:'),`${name}: misbound native history fails closed`);}]),
 ['scene-history-altered-prefix',a=>{const {raw}=transportObservations(),h=a.history();a.compact(h,raw[0]);h.nativeEvents[0].bytes++;let failure;try{a.compact(h,raw[1]);}catch(e){failure=e;}assert(failure?.message==='scene history: altered owned prefix','scene-history-altered-prefix: public mutation cannot rewrite owned history');}],
 ['matrix-contract',a=>{const c=a.matrix(phases);assert.equal(c.cases.length,22,'matrix-contract: two native routes for every phase');assert.equal(c.faults.length,88,'matrix-contract: seven capable and one unsupported faults per phase');assert.equal(new Set(c.faults.map(f=>`${f.packId}/${f.phaseId}/${f.route}/${f.fault}`)).size,88,'matrix-contract: exact unique fault tuples');}],
 ['matrix-contract-refusal',a=>{let e;try{a.matrix(phases.slice(1));}catch(x){e=x;}assert.ok(e?.message.startsWith('scene matrix:'),'matrix-contract-refusal: omitted phase cannot shrink declaration');}],
 ['qualified-complete',a=>{const r=a.reduce(qualifiedObservations(),phases);assert.equal(r.complete,true,'qualified-complete: constructed complete22+88 schema');assert.equal(r.withinLimit,true,'qualified-complete: complete under budget');assert.equal(r.maxGpuReservation,100000000,'qualified-complete: all native sample maxima read');}],
 ['qualified-lookout-complete',a=>{const p=phases.map((x,i)=>i===10?{...x,phaseId:'lookout-mountain'}:x);assert.equal(a.reduce(qualifiedObservations(p),p).complete,true,'qualified-lookout-complete: constructed numbered capture/camera/world/roster schema; actual PNG/native review UNRUN');}],
 ...Object.entries({
   'qualified-lookout-missing':r=>r.canvasCaptures.pop(),'qualified-lookout-bytes':r=>r.canvasCaptures[0].sha256='invalid',
   'qualified-lookout-blank':r=>r.canvasCaptures[0].nonuniform=false,'qualified-lookout-native-render':r=>r.canvasCaptures[0].nativeRenders=2,
   'qualified-lookout-camera':r=>r.canvasCaptures[10].camera.position[0]++,
   'qualified-lookout-trees':r=>r.canvasCaptures[10].world.trees.owners[0].arrays[0].sha256='c'.repeat(64),
   'qualified-lookout-roster':r=>r.canvasCaptures[10].roster[0].men--,
   'qualified-lookout-distance':r=>r.framedComparison.goal.dist=150,
   'qualified-lookout-comparison':r=>r.canvasCaptures[9].comparison.a='baked',
   'qualified-lookout-same-style':r=>{for(const c of r.canvasCaptures.filter(c=>c.comparison)){c.comparison.b=c.comparison.a;c.comparison.split=0;}},
   'qualified-lookout-empty-arrays':r=>{for(const c of r.canvasCaptures)for(const kind of ['terrain','trees'])for(const o of c.world[kind].owners)o.arrays=[];},
   'qualified-lookout-malformed':r=>r.canvasCaptures[10].roster={},
 }).map(([name,change])=>[name,a=>{const p=phases.map((x,i)=>i===10?{...x,phaseId:'lookout-mountain'}:x),r=qualifiedObservations(p);change(r.cases.find(c=>c.phaseId==='lookout-mountain'));assert.equal(a.reduce(r,p).complete,false,`${name}: constructed misbound capture refused`);}]),
 ...Object.entries({
   'qualified-missing-case':r=>r.cases.pop(),'qualified-duplicate-case':r=>r.cases[21]=structuredClone(r.cases[0]),
   'qualified-missing-fault':r=>r.faults.pop(),'qualified-duplicate-fault':r=>r.faults[87]=structuredClone(r.faults[0]),
   'qualified-reused-context':r=>r.faults[0].contextId=r.cases[0].contextId,
   'qualified-mode':r=>r.sceneRoutes='other','qualified-legacy-mix':r=>r.failure=observations().failure,
   'qualified-encoding':r=>r.cases[0].publication.encodings[0]='png','qualified-unsupported-io':r=>r.cases[1].publication.candidateRequests=1,
   'qualified-field':r=>r.cases[0].configuration.fieldUnchanged=false,'qualified-state':r=>r.cases[0].states.pop(),
   'qualified-stress-sample':r=>r.cases[0].stress.transaction.samples.pop(),'qualified-restore-sample':r=>r.faults[0].restoration.samples.pop(),
   'qualified-owner':r=>r.cases[0].stress.native[0].owners.pop(),'qualified-capacity':r=>r.cases[0].capacityContract.US++,
   'qualified-array':r=>r.cases[0].stress.native[0].owners[0].arrays.pop(),
   'qualified-array-shape':r=>{const a=r.cases[0].stress.native[0].owners[0].arrays[0];a.bytes--;a.reservations[0].bytes--;},
   'qualified-native-id':r=>r.cases[0].stress.native[0].owners[0].arrays[1].reservations[0].id=r.cases[0].stress.native[0].owners[0].arrays[0].reservations[0].id,
   'qualified-native-size':r=>r.cases[0].stress.native[0].owners[0].arrays[0].reservations[0].bytes--,
   'qualified-draw-count':r=>r.cases[0].stress.native[0].owners[0].instances[0]=0,
   'qualified-smoke':r=>r.cases[0].stress.smoke.particles=799,
   'qualified-transaction-restore':r=>r.cases[0].stress.transaction.restoration.restored=false,
   'qualified-delayed-order':r=>r.faults.find(f=>f.fault==='rejection-delayed-astc').events.find(e=>e.operation==='held-check').baselineRequests=1,
   'qualified-delayed-settlement-count':r=>r.faults.find(f=>f.fault==='rejection-delayed-astc').events.find(e=>e.operation==='held-check').nonHeldSettled=8,
   'qualified-delayed-early-release':r=>{const f=r.faults.find(f=>f.fault==='rejection-delayed-astc'),check=f.events.find(e=>e.operation==='held-check');f.events.find(e=>e.operation==='candidate-settled'&&e.outcome==='rejected').sequence=check.sequence+0.5;},
   'qualified-baseline-page-name':r=>{const f=r.faults[0];for(const e of [...f.events,...f.states])if(e.page==='soldier_close_4.png')e.page='foreign-close.png';},
   'qualified-prepare-order':r=>r.faults.find(f=>f.fault==='first-pool-prepare').events.filter(e=>e.operation==='candidate-upload').pop().sequence=9999,
   'qualified-dispose-order':r=>r.faults[0].events.find(e=>e.operation==='candidate-dispose').sequence=9999,
   'qualified-early-finish':r=>r.faults[0].states.find(s=>s.label==='fallback-published-pending').allocation.calls.finish++,
   'qualified-terminal-publish':r=>r.faults.find(f=>f.fault==='baseline-terminal').outcome.published=true,
   'qualified-cleanup':r=>r.cases[0].restoration.configuration.ok=false,
   'qualified-finite':r=>r.faults[0].states[0].gpuReservation=NaN,
   'qualified-accounting':r=>r.faults[0].states[0].allocation.gpuPeak++,
   'qualified-unknown':r=>r.faults[0].states[0].allocation.unknown=['unknown'],
   'qualified-unmapped':r=>r.faults[0].states[0].unmappedBufferBytes=1,
   'qualified-paired-roster':r=>r.cases[1].warm.retainedRoster.pop(),
   'qualified-malformed':r=>r.cases[0].restoration.samples={},
   'qualified-buffer-binding':r=>r.cases[0].stress.transaction.samples[0].observation.allocation.bufferSlots[0].owners=['foreign'],
   'qualified-slot-total':r=>r.cases[0].states[0].allocation.textureSlots[0].slots[0]--,
   'qualified-declared-arrays':r=>{const s=r.cases[0].stress.transaction.samples[0].observation;s.declaredArrayBytes=s.cpuDeclaredArrayBytes=1000;s.conservativeReservation=s.gpuReservation+1000;},
   'qualified-malformed-event':r=>r.faults[0].events[0]=null,
   'qualified-malformed-owner':r=>r.cases[0].stress.native[0].owners[0].label=1,
   'qualified-native-siblings':r=>r.faults[0].events=r.faults[0].events.filter(e=>e.operation!=='candidate-upload'),
   'qualified-owned-siblings':r=>r.faults[0].events=r.faults[0].events.filter(e=>!['candidate-created','candidate-dispose'].includes(e.operation)),
   'qualified-page-rejection':r=>r.faults[0].events.find(e=>e.operation==='candidate-settled'&&e.outcome==='rejected').outcome='fulfilled',
   'qualified-baseline-overlap':r=>r.faults[0].states=r.faults[0].states.filter(s=>s.label!=='baseline-upload'),
   'qualified-pending-deletes':r=>r.faults[0].states.find(s=>s.label==='first-baseline-request').allocation.pendingDeleteBytes=0,
   'qualified-malformed-slot-owners':r=>r.cases[0].stress.transaction.samples[0].observation.allocation.bufferSlots[0].owners={},
   'qualified-malformed-native-owners':r=>r.cases[0].stress.native[0].owners={},
   'qualified-hidden-slot':r=>{const a=r.cases[0].stress.transaction.samples[0].observation.allocation,b=structuredClone(a.bufferSlots[0]);b.id=10000;a.bufferSlots.push(b);a.byKind.buffer+=b.bytes;a.byKind.texture-=b.bytes;a.textureSlots[0].slots[0]-=b.bytes;},
   'qualified-empty-pools':r=>r.faults[0].outcome.poolPages=[],
   'qualified-all-settled':r=>r.faults[0].events=r.faults[0].events.filter(e=>e.operation!=='candidate-all-settled'),
   'qualified-fault-order':r=>r.faults[0].events.find(e=>e.operation==='fault-fired').sequence=10000,
   'qualified-delayed-upload':r=>{const f=r.faults.find(f=>f.fault==='rejection-delayed-astc'),held=f.events.find(e=>e.operation==='sibling-held');f.events.find(e=>e.operation==='candidate-upload'&&e.page===held.page).sequence=held.sequence-1;},
   'qualified-implicit-finish':r=>r.faults[0].states.find(s=>s.label==='first-baseline-request').allocation.calls.finish++,
   'qualified-lens-state':r=>r.cases[0].states.find(s=>s.label==='lens-depth').lens=false,
   'qualified-resize-state':r=>r.cases[0].states.find(s=>s.label==='lens-resize').viewport=[10,10],
   'qualified-transition-semantics':r=>r.cases[0].transitions[0].style='baked',
   'qualified-transition-combat':r=>r.cases[0].transitions[0].combatAfter='changed',
   'qualified-authored-scenario':r=>r.cases[0].scenario.units[0].men--,
   'qualified-null-reservation':r=>{r.cases[0].stress.native[0].owners[0].arrays[0].reservations=[null];r.cases[0].stress.transaction.samples[0].observation.allocation.bufferSlots=[null];},
   'qualified-baseline-duplicate-page':r=>{for(const e of r.faults[0].events.filter(e=>e.operation==='baseline-upload'))e.page='baseline-4';for(const s of r.faults[0].states.filter(s=>s.label==='baseline-upload'))s.page='baseline-4';},
   'qualified-vanishing-pending':r=>{for(const s of r.faults[0].states.filter(s=>['baseline-upload','fallback-published-pending'].includes(s.label)))s.allocation.pendingDeleteBytes=0;},
   'qualified-preload-missing':r=>delete r.faults[0].preload,
   'qualified-preload-close-IO':r=>r.faults[0].preload.after.CS.closeRequests=1,
   'qualified-preload-owner':r=>r.faults[0].preload.native[0].owners.pop(),
   'qualified-preload-native-binding':r=>r.faults[0].states[0].allocation.bufferSlots[0].owners=['foreign'],
   'qualified-preload-sample':r=>r.faults[0].preload.sampleSequences.pop(),
   'qualified-preload-hidden-sample':r=>r.faults[0].preload.transaction.samples=[{observation:r.faults[0].states[0]}],
   'qualified-preload-after-start':r=>r.faults[0].preload.sampleSequences[0]=r.faults[0].states.find(s=>s.label==='fault-start').sequence,
   'qualified-preload-roster':r=>r.faults[0].preload.retainedRoster.pop(),
   'qualified-postoutcome-owner':r=>r.faults[0].stress.native[0].owners.pop(),
   'qualified-postoutcome-pending':r=>r.faults[0].stress.transaction.samples[0].observation.allocation.pendingDeleteBytes=0,
   'qualified-postoutcome-finish':r=>r.faults[0].stress.transaction.samples[0].observation.allocation.calls.finish++,
   'qualified-postoutcome-order':r=>r.faults[0].stress.transaction.samples[0].observation.sequence=r.faults[0].states.find(s=>s.label==='fallback-settled').sequence+1,
   'qualified-terminal-US-close':r=>{const f=r.faults.find(f=>f.fault==='baseline-terminal');f.stress.native[0].owners=f.stress.native[0].owners.filter(o=>!o.label.startsWith('baked.US.close.'));},
   'qualified-terminal-CS-close':r=>{const f=r.faults.find(f=>f.fault==='baseline-terminal');f.stress.native[0].owners.push(structuredClone(r.cases[1].stress.native[0].owners.find(o=>o.label==='baked.CS.close.0')));},
   'qualified-fault-authored':r=>r.faults[0].scenario.units[0].men--,
   'qualified-fault-capacity':r=>r.faults[0].capacityContract.pages.CS.close++,
   'qualified-tier-mode':r=>r.cases[0].stress.mode='preclose',
   'qualified-native-history-required':r=>r.nativeHistoryRequired=true,
   'qualified-postoutcome-reversed':r=>{const s=r.faults[0].stress.transaction.samples;[s[0].observation.sequence,s[2].observation.sequence]=[s[2].observation.sequence,s[0].observation.sequence];},
   'qualified-preload-reversed':r=>{const f=r.faults[0];[f.states[0].sequence,f.states[2].sequence]=[f.states[2].sequence,f.states[0].sequence];f.preload.sampleSequences=[f.states[0].sequence,f.states[1].sequence,f.states[2].sequence];},
 }).map(([name,change])=>[name,a=>{const r=qualifiedObservations();change(r);assert.equal(a.reduce(r,phases).complete,false,`${name}: incomplete or misbound native matrix rejected`);}]),
 ['qualified-failure-maximum',a=>{const r=qualifiedObservations(),s=r.faults[0].restoration.samples[1];s.allocation.peak=299998800;s.allocation.gpuPeak=s.gpuReservation=300000000;s.conservativeReservation=300001000;const v=a.reduce(r,phases);assert.equal(v.complete,true,'qualified-failure-maximum: complete over-budget remains a measured result');assert.equal(v.maxGpuReservation,300000000,'qualified-failure-maximum: oversized fault restoration participates');assert.equal(v.withinLimit,false,'qualified-failure-maximum: complete failure peak cannot fit');}],
 ['qualified-partial-maximum',a=>{const r=qualifiedObservations();r.faults[0].complete=false;const s=r.faults[0].restoration.samples[1];s.gpuReservation=300000000;s.conservativeReservation=300001000;const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-partial-maximum: malformed or failed context cannot erase oversized observation');assert.equal(v.complete,false,'qualified-partial-maximum: partial remains incomplete');}],
 ['qualified-independent-maximum',a=>{const r=qualifiedObservations(),s=r.faults[0].restoration.samples[1];s.gpuReservation=300000000;s.conservativeReservation=NaN;const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-independent-maximum: invalid conservative scalar cannot erase valid GPU peak');assert.equal(v.complete,false,'qualified-independent-maximum: invalid scalar fails closed');}],
 ['qualified-nested-maximum',a=>{const r=qualifiedObservations(),s=structuredClone(r.faults[0].restoration.samples[1]);s.sequence++;s.gpuReservation=300000000;s.conservativeReservation=300001000;r.faults[0].stress={transaction:{samples:[{observation:s}]}};const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-nested-maximum: failed fault nested stress cannot erase valid GPU peak');assert.equal(v.complete,false,'qualified-nested-maximum: inconsistent nested scalar fails closed');}],
 ['qualified-hidden-preload-maximum',a=>{const r=qualifiedObservations();r.faults[0].preload.transaction.samples=[{observation:{gpuReservation:310000000,conservativeReservation:320000000}}];const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,310000000,'qualified-hidden-preload-maximum: forbidden preload samples retain GPU peak');assert.equal(v.maxReservation,320000000,'qualified-hidden-preload-maximum: forbidden preload samples retain upper peak');assert.equal(v.complete,false,'qualified-hidden-preload-maximum: forbidden container stays rejected');}],
 ['qualified-invalid-mode-maximum',a=>{const r=qualifiedObservations();r.sceneRoutes='typo';r.faults[0].restoration.samples[1].gpuReservation=300000000;const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-invalid-mode-maximum: invalid mode cannot erase fault peak');assert.equal(v.complete,false,'qualified-invalid-mode-maximum: invalid mode remains incomplete');}],
 ['qualified-legacy-maximum',a=>{const r=qualifiedObservations();r.failure={gpuReservation:350000000,conservativeReservation:350001000};const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,350000000,'qualified-legacy-maximum: forbidden legacy scalar evidence still contributes its peak');assert.equal(v.complete,false,'qualified-legacy-maximum: forbidden schema mix stays incomplete');}],
  ['npot-mips',a=>assert.deepEqual(a.mips(7,5,4).map(m=>m.bytes),[140,24,4],'npot-mips: complete NPOT tail')],
  ['replacement-peak',a=>{const l=new a.Ledger(),id={};l.reserve(id,'texture',0,100);l.reserve(id,'texture',0,60);assert.equal(l.bytes,60,'replacement-peak: current bytes');assert.equal(l.peak,160,'replacement-peak: old and new storage overlap');}],
  ['deferred-delete',a=>{const o=a.observe();assert.equal(o.beforeFinish.bytes,172,'deferred-delete: native delete still charged');assert.equal(o.beforeFinish.pendingDeleteBytes,172,'deferred-delete: pending bytes');assert.equal(o.afterFinish.bytes,0,'deferred-delete: finish retires API objects');}],
  ['native-uncompressed',a=>{const o=a.observe();assert.equal(o.rgba.byKind.texture,172,'native-uncompressed: actual image overload plus mips');assert.equal(o.floating.byKind.texture,256,'native-uncompressed: half-float colour');assert.equal(o.floating.byKind.renderbuffer,128,'native-uncompressed: conservative depth');assert.equal(o.floating.byKind.buffer,12,'native-uncompressed: typed-array offset and length');assert.equal(o.native[0].args.length,6,'native-uncompressed: GL call left intact');}],
  ['cube-storage',a=>{const o=a.observe();assert.equal(o.cubeAdded,2040,'cube-storage: all six complete cube faces');assert.equal(o.immutableAdded,340,'cube-storage: immutable generation never doubles storage');}],
  ['compressed-blocks',a=>assert.equal(a.observe().compressedAdded,64,'compressed-blocks: padded ASTC blocks')],
  ['immutable-compressed',a=>{const o=a.observe();assert.equal(o.astcAdded,112,'immutable-compressed: ASTC complete tiny block tails');assert.equal(o.bc7Added,96,'immutable-compressed: BC7 NPOT padded blocks');assert.deepEqual(o.compressedImmutableUnknown,[],'immutable-compressed: supported storage never marked unknown');}],
  ['compressed-subimage',a=>{const o=a.observe();assert.equal(o.afterAstcSubimage,112,'compressed-subimage: upload does not double allocate');const call=o.native.find(c=>c.name==='compressedTexSubImage2D');assert.deepEqual(call.args.slice(1,7),[0,0,0,8,8,0x93B0],'compressed-subimage: native arguments unchanged');}],
  ['native-npot-storage',a=>{const o=a.observe();assert.equal(o.npotAdded,168,'native-npot-storage: fractional GLsizei level conversion charges full NPOT tail');assert.ok(!o.unknown.unknown.some(x=>x.startsWith('observer:')),'native-npot-storage: observer never hides native allocation');assert.equal(o.native.find(c=>c.name==='texStorage2D'&&c.args[3]===7).args[1],Math.log2(7)+1,'native-npot-storage: native arguments unchanged');}],
  ['resize-overlap',a=>{const o=a.observe();assert.equal(o.small.defaultFramebuffer,60000,'resize-overlap: two colours and depth');assert.equal(o.resized.defaultPeak,300000,'resize-overlap: old plus new default surfaces');}],
  ['resize-finish-upper',a=>{const r=a.observe().resizedAfterFinish;assert.equal(r.defaultPeak,300000,'resize-finish-upper: finish cannot erase historical overlap');assert.ok(r.peak+r.defaultPeak>=r.gpuPeak,'resize-finish-upper: conservative upper cannot undercut synchronized peak');}],
  ['unknown-refuses-verdict',a=>assert.ok(a.observe().unknown.unknown.includes('compressed format:99999'),'unknown-refuses-verdict: unsupported formats prevent verdict')],
  ['event-rejection',async a=>{assert.deepEqual(await a.rejection(()=>Promise.reject({type:'error'})),{rejected:true,message:'error'},'event-rejection: DOM image error need not have a message');assert.deepEqual(await a.rejection(()=>Promise.resolve()),{rejected:false,message:''},'event-rejection: fulfilled loads stay distinct');}],
  ['synchronized-peak',a=>{const p=new a.Peak(),attrs={depth:true};p.sample(1000000,100,50,attrs);p.sample(0,200,100,attrs);assert.equal(p.peak,1060000,'synchronized-peak: independent maxima never added');const o=a.observe();assert.ok(o.resized.gpuPeak>=300000,'synchronized-peak: resize overlap retained');}],
  ['resize-pending-fence',a=>{const p=new a.Peak(),attrs={depth:true};p.sample(0,100,50,attrs);p.sample(0,200,100,attrs);p.sample(1000000,200,100,attrs);
    assert.equal(p.peak,1300000,'resize-pending-fence: later uploads retain old surface');p.sample(1000000,300,100,attrs);
    assert.equal(p.current,1660000,'resize-pending-fence: multiple old surfaces accumulate until native finish');p.finish();p.sample(1000000,300,100,attrs);
    assert.equal(p.current,1360000,'resize-pending-fence: finish retires old surfaces');assert.equal(p.peak,1660000,'resize-pending-fence: historical peak remains');}],
  ['buffer-ownership',a=>assert.deepEqual(a.observe().bufferReservation,{id:1,bytes:12,pendingDelete:false},'buffer-ownership: native upload array resolves one actual buffer')],
  ['buffer-history',a=>{const o=a.observe();assert.equal(o.pendingBuffers.length,3,'buffer-history: all live and pending native identities retained');assert.equal(o.pendingBuffers.filter(r=>r.pendingDelete).length,2,'buffer-history: pending old reservation remains mapped');assert.equal(o.settledBuffers.length,1,'buffer-history: only retired native identities removed');}],
  ['observational-sample',a=>assert.deepEqual(a.observe().samplingCalls,[],'observational-sample: observation cannot upload or finish')],
  ['observational-texture',a=>{const o=a.observe();assert.equal(o.firstSample.textureObjects,1,'observational-texture: real texture sentinel observed');assert.deepEqual(o.samplingCalls,[],'observational-texture: sampler cannot initialize texture sentinel');}],
  ['detached-ownership',a=>{const o=a.observe(),r=o.detachedSample.bufferOwnership.find(r=>r.id===o.knownId);assert.ok(r?.pendingDelete&&r.owners.includes('scene/known-native-array'),'detached-ownership: detached pending reservation retains demonstrated native label');assert.equal(o.detachedSample.unmappedBufferBytes,0,'detached-ownership: all known bytes remain mapped');assert.ok(!o.retiredSample.bufferOwnership.some(r=>r.id===o.knownId),'detached-ownership: retired identity removed only after finish');}],
  ['unassociated-buffer',a=>{const o=a.observe();assert.equal(o.unassociatedSample.unmappedBufferBytes,32,'unassociated-buffer: independently enumerated size-only reservation cannot acquire generic owner');assert.ok(o.unassociatedSample.bufferOwnership.some(r=>r.bytes===32&&!r.owners.length),'unassociated-buffer: unassociated ID remains visible');}],
  ['reallocated-owner',a=>{const o=a.observe();assert.equal(o.reallocatedSample.unmappedBufferBytes,48,'reallocated-owner: numeric replacement cannot retain the prior array owner');}],
  ['snapshot-history',a=>{const o=a.observe();assert.ok(!o.rgba.unknown.length,'snapshot-history: later unknowns cannot rewrite earlier samples');assert.ok(!o.rgba.calls.finish,'snapshot-history: later finish cannot rewrite earlier counters');assert.equal(o.rgba.signatures.length,2,'snapshot-history: later uploads cannot rewrite earlier signatures');}],
  ['restoration-maximum',a=>{const r=observations();r.failure.gpuReservation=100;r.failure.conservativeReservation=110;r.cases[0].restoration.samples=[{...r.cases[0].states[0],gpuReservation:270000000,conservativeReservation:270000010}];const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,270000000,'restoration-maximum: native restored peak participates');assert.equal(v.withinLimit,false,'restoration-maximum: restoration cannot fit budget');}],
  ['restoration-shape',a=>{const r=observations();r.cases[0].restoration.samples={};assert.equal(a.reduce(r,phases).complete,false,'restoration-shape: malformed samples reject without throwing');}],
  ['native-restoration-required',a=>{const r=observations();r.terrainRestorationObserved=true;assert.equal(a.reduce(r,phases).complete,false,'native-restoration-required: absent restored samples cannot complete');}],
  ['restoration-calls-shape',a=>{for(const calls of [{},3,'terrain capture']){const r=observations();r.terrainRestorationObserved=true;r.cases[0].restoration={ok:true,calls,samples:[{...r.cases[0].states[0],label:'restored-native-pending'},{...r.cases[0].states[0],label:'restored-native-settled'}]};assert.equal(a.reduce(r,phases).complete,false,'restoration-calls-shape: calls must be an array');}}],
  ['malformed-verdict',a=>{for(const r of [null,{cases:{}},{cases:[null]},{...observations(),cases:[{...observations().cases[0],states:[null]}]}])assert.equal(a.reduce(r,phases).complete,false,'malformed-verdict: malformed containers retained as incomplete');}],
  ['finite-verdict',a=>{const r=observations();r.failure.gpuReservation=Infinity;assert.equal(a.reduce(r,phases).complete,false,'finite-verdict: nonfinite failure rejected');}],
  ['missing-state',a=>{const r=observations();r.cases[0].states.pop();assert.equal(a.reduce(r,phases).complete,false,'missing-state: required state cannot be omitted');}],
  ['prototype-state',a=>{const p=phases.map((p,i)=>({...p,phaseId:i===0?'lookout-mountain':p.phaseId})),r=observations();r.cases[0].phaseId='lookout-mountain';r.inactivePrototype=true;for(const row of r.cases)row.states.push({...row.states[0],label:'inactive-field'});assert.equal(a.reduce(r,p).complete,false,'prototype-state: inactive transition states cannot be omitted');}],
  ['failure-maximum',a=>{const r=a.reduce(observations(),phases);assert.equal(r.complete,true,'failure-maximum: complete observation retained');assert.equal(r.maxGpuReservation,260000000,'failure-maximum: oversized failure participates');assert.equal(r.withinLimit,false,'failure-maximum: failure cannot fit budget');}],
  ['missing-phase',a=>{const r=observations();r.cases.pop();assert.equal(a.reduce(r,phases).complete,false,'missing-phase: omitted phase rejected');}],
  ['duplicate-phase',a=>{const r=observations();r.cases[10]={...r.cases[0]};assert.equal(a.reduce(r,phases).complete,false,'duplicate-phase: duplicate cannot replace omitted phase');}],
  ['unmapped-verdict',a=>{const r=observations();r.failure.unmappedBufferBytes=4;assert.equal(a.reduce(r,phases).complete,false,'unmapped-verdict: failure buffers require actual owner');}],
  ['unknown-verdict',a=>{const r=observations();r.cases[0].states[0].allocation.unknown=['unobserved'];assert.equal(a.reduce(r,phases).complete,false,'unknown-verdict: unknown reservation rejected');}],
  ['restoration-verdict',a=>{const r=observations();r.failure.gpuReservation=100;r.failure.conservativeReservation=110;r.failure.restoration.ok=false;const v=a.reduce(r,phases);assert.equal(v.complete,false,'restoration-verdict: failure restoration required');assert.equal(v.withinLimit,false,'restoration-verdict: incomplete cannot meet limit');}],
  ['descriptor-restoration',a=>{const o=a.observe();assert.ok(o.exactRestore&&o.windowRestore&&o.inheritedRestore,'descriptor-restoration: every native descriptor and prior observer restored; inherited shadow deleted');}],
];
const changed=(key,value)=>({observe:()=>({...observed(),[key]:value})});
class NoOverlap extends AllocationLedger {reserve(id,k,s,n){super.reserve(id,k,s,n,false);}}
const mutants={
  'native-renderbuffer-identity':changed('renderbufferIdentity',null),
  'native-renderbuffer-retirement':changed('retiredRenderbufferIdentity',{id:1,bytes:128,pendingDelete:true}),
  'focused-resource-valid':{resource:()=>['invented failure']},
  ...Object.fromEntries(Object.keys(focusedResourceMutations).map(name=>[name,{resource:()=>[]}])) ,
  'focused-full-reject':{reduce:()=>({complete:true})},
  'focused-merger-reject':{merge:()=>({})},
  'focused-header-binding':{header:()=>({})},
  'focused-never-full':{focused:()=>({complete:true,fullMatrixComplete:true,fieldable:true,maxGpuReservation:0})},
  'completion-qualified':{reduce:()=>({complete:false})},
  ...Object.fromEntries(['completion-missing','completion-extra','completion-early','completion-result','completion-duration','completion-pending-id','completion-lost-peak','completion-unmarked'].map(n=>[n,{reduce:()=>({complete:true})}])),
  'parts-complete':{merge:()=>({add(){},finalize:()=>({complete:false,parts:[],withinLimit:false,maxGpuReservation:null})})},
  ...Object.fromEntries(['parts-missing','parts-duplicate','parts-reordered','parts-source','parts-qualification','parts-completion','parts-context','parts-roster','parts-history'].map(n=>[n,{merge:()=>({add(){},finalize:()=>({complete:true})})}])),
  'parts-failed-peak':{merge:()=>({add(){},finalize:()=>({complete:false,maxGpuReservation:100000000,maxReservation:100001000})})},
  'scene-history-matrix-envelope':{envelope:r=>({...sceneReportEnvelope(r),withinLimit:false})},
  'scene-history-envelope-overflow':{envelope:r=>({...sceneReportEnvelope(r),withinLimit:true})},
  'scene-history-reducer-equivalence':{reduce:(r,p)=>r.cases.some(c=>c.history)?{complete:false}:reduceSceneObservations(r,p)},
  ...Object.fromEntries(['native-journal-kinds','native-journal-replacement','native-journal-copy'].map(name=>[name,{observe:(...args)=>{const o=observed(...args);if(name==='native-journal-kinds')o.reallocatedSample.allocation.nativeEvents=o.reallocatedSample.allocation.nativeEvents.filter(e=>e.kind!=='renderbuffer');if(name==='native-journal-replacement')o.reallocatedSample.allocation.nativeEvents.filter(e=>e.kind==='buffer'&&e.operation==='reserve'&&e.previous>0).at(-1).transient=0;if(name==='native-journal-copy')o.beforeFinish.nativeEvents=o.rgba.nativeEvents;return o;}}])),
  'native-journal-off':{observe:()=>observed(false,false,false,sampleSceneAllocations,false,true)},
  'scene-history-roundtrip':{expand:c=>({...expandSceneContext(c),states:[]})},
  ...Object.fromEntries(checks.filter(([name])=>name.startsWith('scene-history-')&&!['scene-history-roundtrip','scene-history-altered-prefix','scene-history-matrix-envelope','scene-history-envelope-overflow','scene-history-reducer-equivalence'].includes(name)).map(([name])=>[name,{expand:()=>({states:[]})}])),
  'scene-history-altered-prefix':{compact:(h,s)=>{try{return compactSceneSample(h,s);}catch{return s;}}},
  'npot-mips':{mips:()=>[{bytes:140}]},'replacement-peak':{Ledger:NoOverlap},
  'deferred-delete':changed('beforeFinish',{bytes:0,pendingDeleteBytes:0}),
  'native-uncompressed':changed('rgba',{byKind:{texture:128}}),
  'cube-storage':changed('cubeAdded',340),'compressed-blocks':changed('compressedAdded',35),
  'immutable-compressed':changed('astcAdded',340),'compressed-subimage':changed('afterAstcSubimage',176),
  'native-npot-storage':changed('npotAdded',0),
  'resize-overlap':changed('resized',{defaultPeak:240000}),'unknown-refuses-verdict':changed('unknown',{unknown:[]}),
  'resize-finish-upper':{observe:()=>observed(false,true)},
  'event-rejection':{rejection:async()=>({rejected:false,message:''})},
  'synchronized-peak':{Peak:class extends ReservationPeak {sample(...args){super.sample(...args);this.peak=1240000;}}},
  'resize-pending-fence':{Peak:class extends ReservationPeak {sample(...args){super.sample(...args);this.pendingFramebuffer=0;this.peak=this.current-this.framebuffer;}}},
  'buffer-ownership':changed('bufferReservation',null),
  'buffer-history':{observe:()=>observed(false,false,true)},
  'observational-sample':{observe:()=>observed(false,false,false,scope=>{scope.__game.post.renderer.getContext().finish();return sampleSceneAllocations(scope);})},
  'observational-texture':{observe:()=>observed(false,false,false,scope=>{initializeSceneTextures(scope);return sampleSceneAllocations(scope);})},
  'detached-ownership':{observe:()=>observed(false,false,false,sampleSceneAllocations,true)},
  'unassociated-buffer':{observe:()=>({...observed(),unassociatedSample:{unmappedBufferBytes:0,bufferOwnership:[]}})},
  'reallocated-owner':{observe:()=>({...observed(),reallocatedSample:{unmappedBufferBytes:32}})},
  'snapshot-history':{observe:()=>{const o=observed();o.rgba.unknown.push('later');return o;}},
  'restoration-maximum':{reduce:(r,p)=>reduceSceneObservations({...r,cases:r.cases.map(c=>({...c,restoration:{ok:true}}))},p)},
  'restoration-shape':{reduce:()=>({complete:true})},
  'native-restoration-required':{reduce:()=>({complete:true})},
  'restoration-calls-shape':{reduce:()=>({complete:true})},
  'failure-maximum':{reduce:(r,p)=>{const v=reduceSceneObservations(r,p);return {...v,maxGpuReservation:100,withinLimit:true};}},
  ...Object.fromEntries(['missing-phase','duplicate-phase','unmapped-verdict','unknown-verdict','restoration-verdict','malformed-verdict','finite-verdict','missing-state','prototype-state'].map(k=>[k,{reduce:()=>({complete:true,withinLimit:true})}])),
  'descriptor-restoration':{observe:()=>observed(true)},
  'matrix-contract':{matrix:()=>({cases:[],faults:[]})},
  'matrix-contract-refusal':{matrix:()=>({cases:[],faults:[]})},
  'qualified-complete':{reduce:()=>({complete:false})},
  'qualified-lookout-complete':{reduce:()=>({complete:false})},
  ...Object.fromEntries(checks.filter(([name])=>name.startsWith('qualified-')&&!['qualified-complete','qualified-lookout-complete','qualified-failure-maximum','qualified-partial-maximum','qualified-independent-maximum','qualified-nested-maximum','qualified-invalid-mode-maximum','qualified-legacy-maximum'].includes(name)).map(([name])=>[name,{reduce:()=>({complete:true})}])),
  'qualified-failure-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-partial-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-independent-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-nested-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-hidden-preload-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000,maxReservation:100001000})},
  'qualified-invalid-mode-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-legacy-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
};
mutants['retained-cpu-accounting']={sampler:scope=>sampleSceneAllocations({...scope,__sceneTerrainPartition:undefined})};
mutants['retained-cpu-observation']={sampler:scope=>({...sampleSceneAllocations(scope),unuploadedArrays:[]})};
mutants['native-texture-identity']={observe:()=>({...observed(),textureIdentity:{id:-1,bytes:0,pendingDelete:false}})};
mutants['native-texture-retirement']={observe:()=>({...observed(),pendingTextureIdentity:null})};
api.isolate=collectPaintedIsolation;
async function isolationFixture(a,fault){
 const rows=[],calls=[],saves=[];const step=async(name,variant)=>{calls.push(name+'-'+variant);if(fault===name)throw 0;return true;};
 await a.isolate({rows,install:v=>step('install',v),capture:v=>step('capture',v),restore:v=>step('restore',v),verifyRestored:async v=>fault==='verify-false'?false:step('verify',v),save:()=>saves.push(structuredClone(rows))});
 return {rows,calls,saves};
}
checks.push(['isolation-finite-positive',async a=>{const f=await isolationFixture(a);assert.ok(f.rows.length===2&&f.rows.every(r=>r.complete&&r.ownersRestored&&r.restored)&&f.calls.join(',')==='install-clone,capture-clone,restore-clone,verify-clone,install-float32-partition,capture-float32-partition,restore-float32-partition,verify-float32-partition'&&f.saves.length===4&&f.saves[0][0].complete===false,'isolation-finite-positive: explicit variants once and pending/terminal evidence retained');}]);
for(const fault of ['install','capture','restore','verify','verify-false']){
 const name='isolation-stop-'+fault;checks.push([name,async a=>{const f=await isolationFixture(a,fault),r=f.rows[0];assert.ok(f.rows.length===1&&!f.calls.some(c=>c.endsWith('-float32-partition'))&&f.saves.length===2
   &&(['install','capture'].includes(fault)?r?.complete===false&&r?.failure==='0'&&r?.restored===true:r?.complete===true&&r?.restored===false&&typeof r?.restorationFailure==='string'),name+': first failure kept, independent restore attempted, unproved next baseline refused');}]);
}
checks.push(['isolation-callback-refusal',async a=>{let error;try{await a.isolate({rows:[{}]});}catch(e){error=e;}assert.ok(error?.message?.startsWith('painted isolation:'),'isolation-callback-refusal: no reused evidence or missing owned callbacks');}]);
for(const[name]of checks.filter(([name])=>name.startsWith('isolation-')))mutants[name]={isolate:async()=>[]};
api.paintedFailure=failPaintedComparison;
for(const failAt of [1,2]){
 const name='isolation-save-primary-'+failAt;checks.push([name,async a=>{const row={paintedIsolation:[]},calls=[];let saves=0,error;
   try{await a.paintedFailure(row,()=>collectPaintedIsolation({rows:row.paintedIsolation,install:async v=>calls.push('install-'+v),capture:async v=>calls.push('capture-'+v),restore:async v=>{calls.push('restore-'+v);return true;},verifyRestored:async v=>{calls.push('verify-'+v);return true;},save:()=>{if(++saves===failAt)throw 0;}}));}catch(e){error=e;}
   assert.ok(error?.message==='focused scene: original/compact/restored whole painted frames differ'&&row.paintedIsolationFailure==='0'&&row.paintedIsolation.length===1
     &&(failAt===1?calls.length===0:calls.join(',')==='install-clone,capture-clone,restore-clone,verify-clone'),name+': original mismatch remains primary while save failure/independent cleanup retained');}]);mutants[name]={paintedFailure:async()=>{}};
}
function float32RetirementFixture(zero=false){
 const original={kind:'unchanged original Float32 terrain owners',materialId:7,materialUuid:'original-material',vertexShader:'original vertex',fragmentShader:'original fragment',uniformKeys:['uGround'],textureUuids:['original-texture'],sourceBytes:12750024,sourceBytesExact:true,uniformRecordsExact:true,uniformValuesExact:true,sourceLayoutExact:true,sourceBoundsExact:true,drawStateExact:true,children:[]};
 const rows=[],cycles=[],states=[];let next=1,events=[];
 for(const [i,operation]of ['install-original','restore-partition'].entries()){
   const arrays=[],chunks=i?5:1;
   for(let mesh=0;mesh<chunks;mesh++)for(const key of ['position','uv','index']){
     const vertices=i?(mesh===4?58843:58841):290157,triangles=i?(mesh===4?115783:115781):578907,itemSize=key==='position'?3:key==='uv'?2:1,count=key==='index'?triangles*3:vertices,bpp=key==='index'&&i?2:4,bytes=count*itemSize*bpp,id=next++;
     arrays.push({mesh,key,itemSize,count,bytes,arrayType:key==='index'?(i?'Uint16Array':'Uint32Array'):'Float32Array',reservations:zero&&i===0?[]:[{id,bytes,pendingDelete:false}]});
   }
   const slots=arrays.flatMap(a=>a.reservations),base=states.length+1;
   states.push({sequence:base,captureId:base,allocation:{bufferSlots:structuredClone(slots),nativeEvents:structuredClone(events)}});
   events.push(...slots.map(p=>({kind:'buffer',id:p.id,operation:'retire'})));
   states.push({sequence:base+1,captureId:base+1,allocation:{bufferSlots:slots.map(p=>({...p,pendingDelete:true})),nativeEvents:structuredClone(events)}});
   events.push({operation:'finish',kind:null,id:null},...slots.map(p=>({operation:'release',kind:'buffer',id:p.id})));
   states.push({sequence:base+2,captureId:base+2,allocation:{bufferSlots:[],nativeEvents:structuredClone(events)}});
   cycles.push({kind:'terrain',index:i+1,sampleIds:[base,base+1,base+2]});
   rows.push({operation,cycleIndex:i+1,nativeFrame:zero&&!i?0:7,nativeRenders:zero&&!i?0:7,arrays,original:{...original,children:i?Array.from({length:5},()=>({materialId:7,materialUuid:'original-material',originalMaterialShared:true})):[]}});
 }
 return {fault:'candidate-http',states,resource:{cycles,terrainRetirements:rows}};
}
api.float32Retire=float32TerrainRetirementErrors;api.float32Focused=reduceFocusedFloat32LookoutObservations;api.float32Proof=float32OriginalReceiptValid;
function float32ResourceFixture(){
 const r=focusedResourceFixture(),p=float32RetirementFixture(true),base=r.states[0].allocation,original=p.resource.terrainRetirements[0].original;
 r.fault=p.fault;r.states=p.states.map(s=>({...s,glError:0,unmappedBufferBytes:0,float32Original:original,focusedPixel:r.states[0].focusedPixel,allocation:{...base,...s.allocation,nativeEvents:[...base.nativeEvents,...s.allocation.nativeEvents]}}));
 r.resource.cycles=[r.resource.cycles[0],...p.resource.cycles.map(c=>({...c,index:c.index+1,complete:true,errors:[],checks:[{lost:false,error:0}]}))];
 r.resource.terrainRetirements=p.resource.terrainRetirements.map(t=>({...t,cycleIndex:t.cycleIndex+1}));r.resource.originalProof=original;r.resource.originalProofReleased=true;
 r.partition={kind:'Float32 with retained exact original',bytes:9357582,sourceBytes:12750024,triangles:578907,chunks:5,materialShared:true};r.resource.terrain={...r.partition};return r;
}
checks.push(['float32-resource-valid',a=>assert.deepEqual(a.resource(float32ResourceFixture(),{float32:true}),[],'float32-resource-valid: separate source-bound bookkeeping policy')]);
mutants['float32-resource-valid']={resource:()=>['invented failure']};
for(const [name,mutate]of [
 ['float32-resource-canonical-label',r=>r.resource.terrain.kind='canonical with retained exact original'],
 ['float32-resource-wrong-size',r=>r.partition.bytes=5827098],
 ['float32-resource-wrong-triangles',r=>r.partition.triangles--],
 ['float32-resource-cloned-material',r=>r.partition.materialShared=false],
 ['float32-resource-unreleased-proof',r=>r.resource.originalProofReleased=false],
 ['float32-resource-changed-uniform',r=>r.states[0].float32Original={...r.states[0].float32Original,uniformValuesExact:false}],
 ['float32-resource-changed-shader',r=>r.states[0].float32Original={...r.states[0].float32Original,vertexShader:'mutated source'}],
 ]){checks.push([name,a=>{const r=float32ResourceFixture();mutate(r);assert.ok(a.resource(r,{float32:true}).length,name+': isolated actual source/layout/lifetime evidence refused');}]);mutants[name]={resource:()=>[]};}
checks.push(['float32-retirement-valid',a=>{assert.deepEqual(a.float32Retire(float32RetirementFixture()),[],'float32-retirement-valid: full actual array-ID lifecycle');assert.deepEqual(a.float32Retire(float32RetirementFixture(true)),[],'float32-retirement-valid: only fresh unrendered first fault source may lack native IDs');}]);
mutants['float32-retirement-valid']={float32Retire:()=>['invented failure']};
for(const[name,mutate,zero]of [
 ['float32-retirement-zero-rendered',r=>r.resource.terrainRetirements[0].nativeFrame=1,true],
 ['float32-retirement-missing-final-restore',r=>{r.resource.terrainRetirements.pop();r.resource.cycles.pop();}],
 ['float32-retirement-false-zero-inventory',r=>{const t=r.resource.terrainRetirements[0];t.nativeFrame=0;t.nativeRenders=0;for(const a of t.arrays)a.reservations=[];}],
 ['float32-retirement-early-finish',r=>r.states[1].allocation.nativeEvents.push({operation:'finish',kind:null,id:null})],
 ['float32-retirement-zero-ordinary',r=>delete r.fault,true],
 ['float32-retirement-zero-later',r=>{for(const a of r.resource.terrainRetirements[1].arrays)a.reservations=[];}],
 ['float32-retirement-omitted-index',r=>r.resource.terrainRetirements[0].arrays.pop()],
 ['float32-retirement-missing-chunk',r=>r.resource.terrainRetirements[1].arrays[0].reservations=[]],
 ['float32-retirement-wrong-bytes',r=>r.resource.terrainRetirements[0].arrays[0].reservations[0].bytes++],
 ['float32-retirement-missing-pending',r=>r.states[1].allocation.bufferSlots.shift()],
 ['float32-retirement-surviving-id',r=>r.states[2].allocation.bufferSlots.push(r.states[0].allocation.bufferSlots[0])],
 ['float32-retirement-early-upload',r=>r.states[1].allocation.nativeEvents.push({operation:'reserve',kind:'buffer',id:999})],
 ['float32-retirement-no-finish',r=>r.states[2].allocation.nativeEvents=r.states[2].allocation.nativeEvents.filter(e=>e.operation!=='finish')],
 ['float32-retirement-no-release',r=>r.states[2].allocation.nativeEvents=r.states[2].allocation.nativeEvents.filter(e=>e.operation!=='release')],
 ['float32-retirement-child-clone',r=>r.resource.terrainRetirements[1].original.children[0].materialUuid='clone'],
 ['float32-retirement-uniform-proof',r=>r.resource.terrainRetirements[0].original.uniformValuesExact=false],
 ]){checks.push([name,a=>{const r=float32RetirementFixture(zero);mutate(r);assert.ok(a.float32Retire(r).length,name+': source-specific native refusal');}]);mutants[name]={float32Retire:()=>[]};}
checks.push(['float32-never-full',a=>{const r=a.float32Focused({resourceFocus:'float32-lookout',cases:[{states:[{gpuReservation:270000000,conservativeReservation:270000001}]}]},{packId:'chattanooga',phaseId:'lookout-mountain'});assert.deepEqual([r.complete,r.fullMatrixComplete,r.fieldable,r.maxGpuReservation],[false,false,false,270000000],'float32-never-full: prerequisite cannot claim full acceptance');}]);
mutants['float32-never-full']={float32Focused:()=>({complete:true})};
checks.push(['float32-full-header-refusal',a=>{const r=qualifiedObservations();r.float32TerrainRepresentation='Float32 with retained exact original';assert.equal(a.reduce(r,phases).complete,false,'float32-full-header-refusal: full reducer rejects isolated representation');let rejected=false;try{a.merge(phases,r);}catch{rejected=true;}assert.ok(rejected,'float32-full-header-refusal: full merger rejects isolated representation');}]);
mutants['float32-full-header-refusal']={reduce:()=>({complete:true}),merge:()=>({})};
Object.assign(api,{settleCapture:settleSceneCapture});
function captureFixture(){
 const terrain={half:3000,heightAt:()=>0},camera=new THREE.PerspectiveCamera(32,1,1,10000),rts=new RtsCamera(camera,terrain,{dist:100,yaw:0}),trees=buildTrees(terrain,[[0,-1000,5,0]],{far:1}),events=[];
 const game={simTime:0,units:[{id:'us-cpu-framed',side:'US',type:'infantry',alive:true,x:0,z:0}],setView(c,h){events.push(['setView',c===camera,h]);},animate(dt){events.push(['animate',dt]);}};
 rts.snap();rts.update(1);return {scope:{__game:{world:{trees},camera,rts,game,post:{scale:1}},innerHeight:768},events,trees,mesh:trees.children[0],camera,rts};
}
function seededCapture(f,high){
 const center=f.mesh.boundingSphere.center;
 if(high){f.camera.position.copy(center).add(new THREE.Vector3(0,0,1));f.camera.lookAt(center);}else{f.rts.snap();f.rts.update(1);}
 f.trees.userData.updateLod(f.camera,400,Infinity);f.rts.snap();f.rts.update(1);f.trees.userData.updateLod(f.camera,400);
 return {geometry:f.mesh.geometry,visible:f.mesh.visible};
}
const captureChecks=[
 ['capture-framed200',a=>{const f=captureFixture();a.settleCapture(f.scope,{framedUnitId:'us-cpu-framed'});assert.deepEqual([f.rts.dist,f.rts.goal.dist,f.rts.pitch],[200,200,f.rts._pitch(200)],'capture-framed200: actual goal and camera settle from100 to200');assert.deepEqual(f.events,[['setView',true,768],['animate',0]],'capture-framed200: native time-zero game pose');}],
 ['capture-hidden-owner',a=>{const f=captureFixture(),high=seededCapture(f,true),low=seededCapture(f,false);assert.equal(high.visible,false,'capture-hidden-owner: original native far visibility');assert.equal(low.visible,false,'capture-hidden-owner: same native visibility');assert.notEqual(high.geometry,low.geometry,'capture-hidden-owner: actual native stale hidden geometry reproduced');seededCapture(f,true);a.settleCapture(f.scope);const first=f.mesh.geometry;seededCapture(f,false);a.settleCapture(f.scope);assert.equal(first,f.mesh.geometry,'capture-hidden-owner: all-owner geometry independent of earlier view');}],
 ['capture-native-visibility',a=>{const f=captureFixture();seededCapture(f,true);a.settleCapture(f.scope);assert.equal(f.mesh.visible,false,'capture-native-visibility: native far visibility restored before draw');}],
 ['capture-native-order',a=>{const f=captureFixture(),native=f.trees.userData.updateLod,calls=[];f.trees.userData.updateLod=(...args)=>{calls.push(args);return native(...args);};a.settleCapture(f.scope);assert.deepEqual(calls.map(r=>r[2]),[Infinity,undefined],'capture-native-order: synchronous all-owner then ordinary visibility');assert.ok(calls.every(r=>r[0]===f.camera&&r[1]===f.rts.dist+200),'capture-native-order: actual camera/native band');}],
 ['capture-preserves-world',a=>{const f=captureFixture(),matrix=f.mesh.instanceMatrix.array.slice(),colors=f.mesh.instanceColor.array.slice(),material=f.mesh.material,units=structuredClone(f.scope.__game.game.units);a.settleCapture(f.scope);assert.equal(f.trees.userData.count,1,'capture-preserves-world: tree count');assert.equal(f.mesh.material,material,'capture-preserves-world: native material identity');assert.deepEqual(f.mesh.instanceMatrix.array,matrix,'capture-preserves-world: native instance matrices');assert.deepEqual(f.mesh.instanceColor.array,colors,'capture-preserves-world: native colors');assert.deepEqual(f.scope.__game.game.units,units,'capture-preserves-world: gameplay remains time-zero');assert.equal(f.scope.__game.game.simTime,0,'capture-preserves-world: no simulation');}],
 ['capture-owner-refusal',a=>{for(const change of [f=>f.scope.__game.world.trees.userData.updateLod=null,f=>f.rts.dist=NaN]){const f=captureFixture();change(f);let error;try{a.settleCapture(f.scope);}catch(e){error=e;}assert.ok(error?.message.startsWith('scene capture:'),'capture-owner-refusal: unproved owner refused');}}],
 ['capture-framed-refusal',a=>{for(const change of [f=>f.scope.__game.game.units[0].alive=false,f=>f.scope.__game.game.simTime=1,f=>f.scope.innerHeight=0]){const f=captureFixture();change(f);let error;try{a.settleCapture(f.scope,{framedUnitId:'us-cpu-framed'});}catch(e){error=e;}assert.ok(error?.message.startsWith('scene capture:'),'capture-framed-refusal: genuine live time-zero frame required');}}],
];
checks.push(...captureChecks);
mutants['capture-framed200']={settleCapture:scope=>{const g=scope.__game;g.rts.flyTo(0,0,200);g.rts.snap();g.rts.update(1);}};
mutants['capture-hidden-owner']={settleCapture:scope=>{const g=scope.__game;g.world.trees.userData.updateLod(g.camera,g.rts.dist+200);}};
mutants['capture-native-visibility']={settleCapture:scope=>{const g=scope.__game;g.world.trees.userData.updateLod(g.camera,g.rts.dist+200,Infinity);}};
mutants['capture-native-order']={settleCapture:scope=>{const g=scope.__game;g.world.trees.userData.updateLod(g.camera,g.rts.dist+200);g.world.trees.userData.updateLod(g.camera,g.rts.dist+200,Infinity);}};
mutants['capture-preserves-world']={settleCapture:scope=>{settleSceneCapture(scope);scope.__game.world.trees.children[0].instanceMatrix.array[0]++;}};
mutants['capture-owner-refusal']={settleCapture:()=>{}};mutants['capture-framed-refusal']={settleCapture:()=>{}};

// Actual repository sources establish layouts; constructed samples below test admission only.
api.postSnapshot=scenePostAdmissionSnapshot;api.postAdmission=scenePostAdmissionValid;api.terrainContract=sceneTerrainContractValid;api.fullHeader=sceneFullFloat32HeaderValid;api.fullReduce=reduceFullFloat32SceneObservations;
let trustedTerrainFixtures;
function trustedTerrains(){return trustedTerrainFixtures??=readSceneTerrainContracts(['henry-hill','shiloh','stones-river','chattanooga','lookout-mountain'].map(name=>({packId:'cpu-source',phaseId:name,scenario:{terrain:name}})));}
function fullResourceFixture(phase){
 const r=float32ResourceFixture(),contract=phase.terrainContract;Object.assign(r,{packId:phase.packId,phaseId:phase.phaseId});
 r.resource.terrainContract=structuredClone(contract);r.resource.terrainContractSourceExact=true;r.resource.terrainContractProofReleased=true;
 r.resource.terrainPublications=r.resource.terrainRetirements.filter(t=>t.operation==='install-original').map(t=>({cycleIndex:t.cycleIndex,chunks:structuredClone(contract.chunks)}));
 Object.assign(r.partition,{sourceBytes:contract.sourceBytes,bytes:contract.partitionBytes,triangles:contract.triangles,chunks:contract.chunks.length});r.resource.terrain={...r.partition};r.resource.originalProof.sourceBytes=contract.sourceBytes;
 r.bootstrap[0].url='http://localhost/?battle='+phase.packId+'&phase='+phase.phaseId+'&quality=high&figures=rigged&nosw';
 let next=1,events=r.states[0].allocation.nativeEvents.filter(e=>e.kind!=='buffer'&&e.operation!=='finish');
 for(const [i,t]of r.resource.terrainRetirements.entries()){
  t.original.sourceBytes=contract.sourceBytes;t.original.children=i?Array.from({length:contract.chunks.length},()=>({materialId:7,materialUuid:'original-material',originalMaterialShared:true})):[];
  t.arrays=(i?contract.chunks:[contract.sourceArrays]).flatMap((rows,mesh)=>rows.map(layout=>({...layout,mesh,reservations:i?[{id:next++,bytes:layout.bytes,pendingDelete:false}]:[]})));
  const slots=t.arrays.flatMap(a=>a.reservations),ss=r.states.slice(i*3,i*3+3);
  ss[0].allocation.bufferSlots=structuredClone(slots);ss[0].allocation.nativeEvents=structuredClone(events);
  events.push(...slots.map(p=>({kind:'buffer',id:p.id,operation:'retire'})));
  ss[1].allocation.bufferSlots=slots.map(p=>({...p,pendingDelete:true}));ss[1].allocation.nativeEvents=structuredClone(events);
  events.push({operation:'finish',kind:null,id:null},...slots.map(p=>({kind:'buffer',id:p.id,operation:'release'})));
  ss[2].allocation.bufferSlots=[];ss[2].allocation.nativeEvents=structuredClone(events);
 }
 for(const s of r.states){s.focusedPixel={...s.focusedPixel,logical:[1,1],admission:{scale:1,requestedScale:1,pixelBytes:3639218,target:[1,1],canvas:[1,1],intermediate:[1,1],renderPixels:1,quarterPixels:1,defaultPixels:1,intermediatePixels:1,lensBytes:44,resizeBytes:24}};s.sequence+=2;s.captureId+=2;s.float32Original=r.resource.originalProof;}
 for(const cycle of r.resource.cycles)cycle.sampleIds=cycle.sampleIds.map(id=>id+2);
 const proofBytes=contract.partitionBytes+contract.chunks.reduce((n,a)=>n+a[0].count*4,0),base=structuredClone(r.states[0]);
 r.states.unshift({...structuredClone(base),sequence:1,captureId:1,label:'focused-contract-terrain-contract-proof-owned',declaredArrayBytes:10+proofBytes},
  {...structuredClone(base),sequence:2,captureId:2,label:'focused-contract-terrain-contract-proof-released',declaredArrayBytes:10});
 return r;
}
const fullHeader={sceneResourcePolicy:'float32-lifetime-v1',float32TerrainRepresentation:'Float32 with retained exact original',postPixelBytes:3639218,mipPolicy:'full-original',nativeHistoryRequired:true,sceneRoutes:'qualified-both',fallbackCompletion:'native-finish-after-candidate-disposal'};
checks.push(['full-policy-header',a=>assert.equal(a.fullHeader(fullHeader),true,'full-policy-header: explicit full policy remains distinct from focused evidence')]);mutants['full-policy-header']={fullHeader:()=>false};
for(const [suffix,mutate]of [['focused',h=>h.resourceFocus='float32-lookout'],['pixels',h=>h.postPixelBytes++],['mips',h=>h.mipPolicy='limited'],['completion',h=>delete h.fallbackCompletion],['history',h=>h.nativeHistoryRequired=false],['unknown',h=>h.sceneResourcePolicy='other']]){
 const name='full-policy-'+suffix;checks.push([name,a=>{const h=structuredClone(fullHeader);mutate(h);assert.equal(a.fullHeader(h),false,name+': incomplete or mixed policy refused');}]);mutants[name]={fullHeader:()=>true};
}
checks.push(['full-policy-five-sources',a=>{const expected=[[1579116,1149738],[9138428,6696464],[8337940,6103450],[12279268,9004734],[12750024,9357582]];for(const [i,phase]of trustedTerrains().entries()){assert.equal(a.terrainContract(phase.terrainContract),true,'full-policy-five-sources: actual source contract');assert.deepEqual([phase.terrainContract.sourceBytes,phase.terrainContract.partitionBytes],expected[i],'full-policy-five-sources: retained actual source geometry bytes');}}]);mutants['full-policy-five-sources']={terrainContract:()=>false};
checks.push(['full-policy-phase-resource',a=>{for(const phase of trustedTerrains())assert.deepEqual(a.resource(fullResourceFixture(phase),{float32:true,phase}),[],'full-policy-phase-resource: trusted dataset and complete two-cycle fault bookkeeping');}]);mutants['full-policy-phase-resource']={resource:()=>['invented failure']};
for(const [suffix,mutate]of [
 ['source-hash',r=>r.resource.terrainContract.heightSha256='0'.repeat(64)],
 ['terrain-name',r=>r.resource.terrainContract.terrain='other'],
 ['array-layout',r=>r.resource.terrainRetirements[1].arrays[0].count--],
 ['chunk-array',r=>r.resource.terrainRetirements[1].arrays.pop()],
 ['proof-release',r=>r.resource.terrainContractProofReleased=false],
 ['publication-missing',r=>delete r.resource.terrainPublications],
 ['publication-hash',r=>r.resource.terrainPublications[0].chunks[0][0].sha256='0'.repeat(64)],
 ['publication-cycle',r=>r.resource.terrainPublications[0].cycleIndex++],
 ['proof-owned',r=>r.states.shift()],
 ['proof-bytes',r=>r.states[0].declaredArrayBytes--],
 ['wrong-route',r=>r.bootstrap[0].url=r.bootstrap[0].url.replace('cpu-source','foreign')],
 ['restore-last',r=>{r.resource.terrainRetirements.pop();r.resource.cycles.pop();}],
 ['overlap',r=>{const id=r.resource.terrainRetirements[1].arrays[0].reservations[0];r.states.at(-1).allocation.bufferSlots.push(id);}]
]){const name='full-policy-'+suffix;checks.push([name,a=>{const phase=trustedTerrains()[0],r=fullResourceFixture(phase);mutate(r);assert.ok(a.resource(r,{float32:true,phase}).length,name+': changed source/lifetime cannot be admitted');}]);mutants[name]={resource:()=>[]};}
for(const [suffix,mutate]of [['array-sum',c=>c.sourceBytes++],['wrong-stride',c=>c.chunks[0][0].itemSize=2],['wrong-index',c=>c.chunks[0][2].arrayType='Uint32Array'],['missing-array',c=>c.sourceArrays.pop()],['bad-digest',c=>c.sourceArrays[0].sha256='x'],['overflow',c=>c.partitionBytes=Number.MAX_SAFE_INTEGER]]){
 const name='full-policy-contract-'+suffix;checks.push([name,a=>{const c=structuredClone(trustedTerrains()[0].terrainContract);mutate(c);assert.equal(a.terrainContract(c),false,name+': independently derived source layout required');}]);mutants[name]={terrainContract:()=>true};
}
checks.push(['full-policy-never-ten',a=>{const r={...qualifiedObservations(phases,true),...fullHeader,focusedComplete:true};r.cases=r.cases.slice(0,2);r.faults=r.faults.slice(0,8);assert.equal(a.fullReduce(r,trustedTerrains()).complete,false,'full-policy-never-ten: complete110 union remains mandatory');}]);mutants['full-policy-never-ten']={fullReduce:()=>({complete:true})};
checks.push(['full-policy-merger-admission',a=>{const source=trustedTerrains()[0],phases=Array.from({length:11},(_,i)=>({...source,phaseId:String(i)}));let error;try{a.merge(phases,fullHeader);}catch(e){error=e;}assert.equal(error,undefined,'full-policy-merger-admission: trusted eleven-phase full owner can be created');}]);mutants['full-policy-merger-admission']={merge:()=>{throw Error('mutant');}};
checks.push(['full-policy-merger-untrusted',a=>{const phases=Array.from({length:11},(_,i)=>({packId:'cpu-source',phaseId:String(i),scenario:{terrain:'henry-hill'}}));let error;try{a.merge(phases,fullHeader);}catch(e){error=e;}assert.ok(error?.message.includes('trusted phase terrain'),'full-policy-merger-untrusted: report-derived/absent source expectation refused');}]);mutants['full-policy-merger-untrusted']={merge:()=>({})};


checks.push(['full-policy-post-rounding',a=>{const p=fullResourceFixture(trustedTerrains()[0]).states[0].focusedPixel;assert.equal(a.postAdmission(p),true,'full-policy-post-rounding: independent native Post arithmetic');}]);mutants['full-policy-post-rounding']={postAdmission:()=>false};
for(const [suffix,mutate]of [['lens',p=>p.admission.lensBytes--],['resize',p=>p.admission.resizeBytes--],['target',p=>p.admission.target[0]++],['canvas',p=>p.admission.canvas[0]++],['quarter',p=>p.admission.quarterPixels++],['intermediate',p=>p.admission.intermediatePixels++],['requested',p=>p.admission.requestedScale=.5]]){
 const name='full-policy-post-'+suffix;checks.push([name,a=>{const p=structuredClone(fullResourceFixture(trustedTerrains()[0]).states[0].focusedPixel);mutate(p);assert.equal(a.postAdmission(p),false,name+': altered rounded footprint refused');}]);mutants[name]={postAdmission:()=>true};
}

checks.push(['full-policy-resize-admission',a=>{
 const dimensions=new WeakMap(),size=new THREE.Vector2(1024,768),post={width:1024,height:768,requestedScale:1,diagnosticPixelBytes:3639218,samples:0,
  renderer:{getSize:v=>v.copy(size),setPixelRatio(){},setSize:(w,h)=>size.set(w,h)},_samplesFor:()=>0,_alloc(){}};
 Post.prototype._apply.call(post);const before=a.postSnapshot(post,dimensions);assert.equal(scenePostAdmissionValid(before),true,'full-policy-resize-admission: initial actual Post admission');
 let retained,fresh;post._apply=function(){retained=a.postSnapshot(this,dimensions);Post.prototype._apply.call(this);fresh=a.postSnapshot(this,dimensions);};
 Post.prototype.setSize.call(post,1366,1024);
 assert.deepEqual(retained.logical,[1024,768],'full-policy-resize-admission: old admission keeps old dimensions before native delegation');
 assert.equal(scenePostAdmissionValid(retained),true,'full-policy-resize-admission: old resize sample arithmetic');
 assert.deepEqual(fresh.logical,[1366,1024],'full-policy-resize-admission: new native admission binds incoming dimensions');
 assert.equal(scenePostAdmissionValid(fresh),true,'full-policy-resize-admission: new resize sample arithmetic');
}]);mutants['full-policy-resize-admission']={postSnapshot:p=>({admission:structuredClone(p.resourceAdmission),logical:[p.width,p.height]})};

// Real Post/THREE CPU owners with a recorded synchronous GL/renderer boundary; no native renderer.
api.ownerPost=(renderer,options)=>new Post(renderer,options);
function withPostOwner(create,options,run){
 const prior=globalThis.window;globalThis.window={devicePixelRatio:1};
 const events=[],listeners=new Map(),size=new THREE.Vector2(320,240),gl={NO_ERROR:0,lost:false,error:0,
  isContextLost(){return this.lost;},getError(){const error=this.error;this.error=0;return error;},
  finish(){events.push('finish');this.afterFinish?.();}};
 const renderer={properties:{},domElement:{addEventListener:(name,fn)=>listeners.set(name,fn)},
  getContext:()=>gl,getSize:v=>v.copy(size),setPixelRatio(value){events.push('ratio');this.ratio=value;this.setSize(size.x,size.y,false);},
  setSize(w,h){events.push('size');size.set(w,h);},setRenderTarget(){events.push('target');},clear(){},render(){events.push('render');}};
 try{const post=create(renderer,{mode:'high',...options});
  for(const key of ['rtScene','rtSmall','rtBlur'])post[key].addEventListener('dispose',()=>events.push(key));
  events.length=0;return run({post,renderer,gl,events,listeners,size});
 }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
}
const caught=fn=>{let failed=false,error;try{fn();}catch(e){failed=true;error=e;}return {failed,error};};
const ownerChecks=[
 ['chronology',({post,events})=>{post.setSize(64,48);assert.deepEqual(events.slice(0,4),['rtScene','rtSmall','rtBlur','finish'],'post-owner-chronology: all owned targets retire before canvas');
  const ratio=events.indexOf('ratio'),sizes=events.flatMap((e,i)=>e==='size'?[i]:[]);assert.equal(sizes.length,2,'post-owner-chronology: pinned nested and final canvas');
  assert.ok(ratio>3&&events[sizes[0]+1]==='finish'&&events[sizes[1]+1]==='finish','post-owner-chronology: completion separates every native surface');
  assert.equal(events.filter(e=>e==='finish').length,4,'post-owner-chronology: final CPU target sizing completes too');
  assert.deepEqual([post.rtScene.width,post.rtScene.height],[64,48],'post-owner-chronology: actual target dimensions');
  assert.ok(!Object.hasOwn(post,'_apply'),'post-owner-chronology: real Post method without wrapper');}],
 ['default-off',({post,events})=>{post.setSize(64,48);assert.equal(post.resourceLifetime,false,'post-owner-default-off: opt-in default');
  assert.equal(events.includes('finish'),false,'post-owner-default-off: no new native completion');assert.deepEqual([post.scale,post.requestedScale,post.rtScene.width,post.rtScene.height],[1,1,64,48],'post-owner-default-off: original high quality');}],
 ['falsy-first',({post,events})=>{post.rtScene.addEventListener('dispose',()=>{throw undefined;});const failure=caught(()=>post.setSize(64,48));
  assert.equal(failure.failed,true,'post-owner-falsy-first: falsy disposal still fails');assert.equal(failure.error,undefined,'post-owner-falsy-first: exact first exception');
  assert.ok(events.includes('rtSmall')&&events.includes('rtBlur')&&!events.includes('ratio')&&!events.includes('size'),'post-owner-falsy-first: independently retire every owner before refusing replacement');
  assert.ok(post._resourceFailed&&caught(()=>post.render({},{})).failed&&caught(()=>post.beginSoldierView({near:.1,far:10},2)).failed,'post-owner-falsy-first: failed owner cannot render or allocate lens');}],
 ['falsy-first-later-reentry',({post,events})=>{post.rtScene.addEventListener('dispose',()=>{throw 0;});post.rtSmall.addEventListener('dispose',()=>{caught(()=>post.setSize(80,60));});
  const first=caught(()=>post.setSize(64,48)),later=caught(()=>post.render({},{}));assert.ok(first.failed&&first.error===0&&later.failed&&later.error===0&&events.includes('rtBlur')&&events.includes('finish')&&!events.includes('size'),'post-owner-falsy-first-later-reentry: original falsy failure remains sticky through later callback and independent native cleanup');}],
 ...['resize','render','lens'].map(kind=>['reentry-'+kind,({post,events})=>{post.rtScene.addEventListener('dispose',()=>{caught(()=>kind==='resize'?post.setSize(80,60):kind==='render'?post.render({},{}):post.beginSoldierView({near:.1,far:10},2));});
  const failure=caught(()=>post.setSize(64,48));assert.ok(failure.failed&&post._resourceFailed&&!events.includes('ratio')&&!events.includes('size')&&!events.includes('render'),'post-owner-reentry-'+kind+': swallowed callback failure remains sticky before replacement');}]),
 ['owner-change',({post,events})=>{post.rtScene.addEventListener('dispose',()=>{post.rtSmall=new THREE.WebGLRenderTarget(1,1);});const failure=caught(()=>post.setSize(64,48));
  assert.ok(failure.failed&&post._resourceFailed&&!events.includes('ratio')&&events.includes('rtSmall')&&events.includes('rtBlur'),'post-owner-owner-change: captured originals retire and foreign replacement is refused');}],
 ['depth-change',({post,events})=>{post.beginSoldierView({near:.1,far:10},2);events.length=0;post.rtScene.addEventListener('dispose',()=>{post.rtScene.depthTexture=new THREE.DepthTexture(1,1);});const failure=caught(()=>post.setSize(64,48));
  assert.ok(failure.failed&&post._resourceFailed&&!events.includes('ratio'),'post-owner-depth-change: original lens identity must survive callbacks');}],
 ['loss-deferral',({post,renderer,gl,events,listeners})=>{gl.lost=true;post.setSize(64,48);post.setMode('low');post.setSize(80,60);post.setMode('high');
  assert.equal(events.length,0,'post-owner-loss-deferral: no allocation while lost');assert.equal(typeof listeners.get('webglcontextrestored'),'function','post-owner-loss-deferral: owned restoration listener');
  renderer.properties={restored:true};gl.lost=false;listeners.get('webglcontextrestored')();assert.deepEqual([post.width,post.height,post.scale,post.rtScene.width,post.rtScene.height],[80,60,1,80,60],'post-owner-loss-deferral: latest request restored with fresh renderer properties');
  assert.equal(events.filter(e=>e==='size').length,2,'post-owner-loss-deferral: exactly one real apply');}],
 ['loss-mid-retirement',({post,gl,events})=>{post.rtScene.addEventListener('dispose',()=>{gl.lost=true;});post.setSize(64,48);
  assert.ok(events.includes('rtSmall')&&events.includes('rtBlur')&&!events.includes('size')&&!events.includes('ratio')&&!events.includes('finish'),'post-owner-loss-mid-retirement: context loss stops native replacements');
  assert.equal(post._resourceFailed,undefined,'post-owner-loss-mid-retirement: legitimate loss is not failure');}],
 ['gl-refusal',({post,gl,events})=>{gl.error=1280;const failure=caught(()=>post.setSize(64,48));assert.ok(failure.failed&&post._resourceFailed&&!events.includes('ratio')&&!events.includes('finish'),'post-owner-gl-refusal: failed prior GL cannot admit replacement');}],
 ['gl-completion',({post,gl,events})=>{gl.afterFinish=()=>{gl.error=1280;};const failure=caught(()=>post.setSize(64,48));assert.ok(failure.failed&&post._resourceFailed&&events.includes('finish')&&!events.includes('ratio'),'post-owner-gl-completion: actual completion must remain healthy');}],
 ['lens-retirement',({post,events})=>{post.beginSoldierView({near:.1,far:10},2);const owned=post.soldierView;owned.material.addEventListener('dispose',()=>events.push('lens-material'));owned.depth.addEventListener('dispose',()=>events.push('lens-depth'));events.length=0;
  post.endSoldierView();assert.deepEqual(events,['lens-material','lens-depth','finish'],'post-owner-lens-retirement: independent lens owners retire before another allocation');
  assert.ok(post.soldierView===null&&post.rtScene.depthTexture===null&&owned.material.uniforms.tDepth.value===null,'post-owner-lens-retirement: coherent publication');post.endSoldierView();assert.equal(events.length,3,'post-owner-lens-retirement: no-op exit does not finish');}],
 ['lens-falsy-first',({post,events})=>{post.beginSoldierView({near:.1,far:10},2);const owned=post.soldierView;owned.material.addEventListener('dispose',()=>{events.push('lens-material');throw 0;});owned.depth.addEventListener('dispose',()=>events.push('lens-depth'));events.length=0;
  const failure=caught(()=>post.endSoldierView());assert.ok(failure.failed&&failure.error===0&&post._resourceFailed&&events.includes('lens-depth')&&!post.soldierView&&!post.rtScene.depthTexture,'post-owner-lens-falsy-first: exact primary preserved after independent depth cleanup');}],
 ...['resize','render','lens'].map(kind=>['lens-reentry-'+kind,({post,events})=>{post.beginSoldierView({near:.1,far:10},2);const owned=post.soldierView;owned.material.addEventListener('dispose',()=>{caught(()=>kind==='resize'?post.setSize(80,60):kind==='render'?post.render({},{}):post.beginSoldierView({near:.1,far:10},2));});owned.depth.addEventListener('dispose',()=>events.push('old-depth'));events.length=0;
  const failure=caught(()=>post.endSoldierView());assert.ok(failure.failed&&post._resourceFailed&&events.includes('old-depth')&&!events.includes('size')&&!events.includes('render')&&!post.soldierView,'post-owner-lens-reentry-'+kind+': no new allocation before old lens completion');}]),
 ['failure-mutators',({post,gl,events})=>{gl.error=1280;caught(()=>post.setSize(64,48));assert.ok(post._resourceFailed,'post-owner-failure-mutators: initial failure retained');
  const prior=[post.width,post.height,post.mode,post.scale,post.requestedScale,post.level,post.samplesLog.length];events.length=0;
  for(const change of [()=>post.setSize(900,700),()=>post.setMode('low'),()=>post.startFromTier(0),()=>post.govern(1,9999)]){assert.ok(caught(change).failed,'post-owner-failure-mutators: public mutation refused');assert.deepEqual([post.width,post.height,post.mode,post.scale,post.requestedScale,post.level,post.samplesLog.length],prior,'post-owner-failure-mutators: rejection cannot alter pending owner state');}
  assert.equal(events.length,0,'post-owner-failure-mutators: no native operation');}],
 ['loss-during-finish',({post,renderer,gl,events,listeners})=>{gl.afterFinish=()=>{gl.lost=true;};const failure=caught(()=>post.setSize(64,48));assert.ok(!failure.failed&&!post._resourceFailed&&!events.includes('size'),'post-owner-loss-during-finish: legitimate loss defers replacement');
  post.setSize(80,60);post.setMode('low');gl.afterFinish=null;gl.lost=false;renderer.properties={fresh:true};assert.equal(typeof listeners.get('webglcontextrestored'),'function','post-owner-loss-during-finish: genuine restoration callback');listeners.get('webglcontextrestored')();
  assert.deepEqual([post.width,post.height,post.requestedScale,post.rtScene.width,post.rtScene.height],[80,60,.7,56,42],'post-owner-loss-during-finish: latest deferred request restores');}],
 ['sticky-restoration',({post,gl,events,listeners})=>{gl.error=1280;const first=caught(()=>post.setSize(64,48));assert.ok(first.failed&&post._resourceFailed,'post-owner-sticky-restoration: initial owner failure');
  assert.equal(typeof listeners.get('webglcontextrestored'),'function','post-owner-sticky-restoration: restore callback exists');events.length=0;listeners.get('webglcontextrestored')();
  const later=caught(()=>post.beginSoldierView({near:.1,far:10},2));assert.ok(events.length===0&&later.failed&&later.error===first.error,'post-owner-sticky-restoration: restoration cannot re-enable failed owner');}]
];
for(const [suffix,run]of ownerChecks){const name='post-owner-'+suffix;checks.push([name,a=>withPostOwner(a.ownerPost,suffix==='default-off'?{}:{resourceLifetime:true},run)]);
 mutants[name]={ownerPost:(renderer,options)=>new Post(renderer,{...options,resourceLifetime:suffix==='default-off'})};}
for(const kind of ['resize','render','lens'])mutants['post-owner-lens-reentry-'+kind]={ownerPost:(renderer,options)=>{
 const post=new Post(renderer,options);post._retireResourceOwners=function(owners){this._resourceApplying=false;return Post.prototype._retireResourceOwners.call(this,owners);};return post;}};
mutants['post-owner-failure-mutators']={ownerPost:(renderer,options)=>{const post=new Post(renderer,options);post.setSize=function(w,h){this.width=w;this.height=h;return Post.prototype.setSize.call(this,w,h);};return post;}};
mutants['post-owner-loss-during-finish']={ownerPost:(renderer,options)=>{const post=new Post(renderer,options);post._finishResourceLifetime=function(){const complete=Post.prototype._finishResourceLifetime.call(this);if(!complete&&renderer.getContext().isContextLost())throw Error('mutant: context loss is permanent failure');return complete;};return post;}};
checks.push(['post-owner-invalid-option',a=>withPostOwner((renderer)=>{const failure=caught(()=>a.ownerPost(renderer,{resourceLifetime:1}));assert.ok(failure.failed&&failure.error?.message.includes('explicit lifetime boolean'),'post-owner-invalid-option: malformed option fails before setup');return new Post(renderer);},{},()=>{})]);
mutants['post-owner-invalid-option']={ownerPost:(renderer,options)=>new Post(renderer,{...options,resourceLifetime:false})};
checks.push(['native-loss-retirement-observation',a=>{const r=a.observe().lossObservation;assert.ok(r.lostPrimary?.pendingDelete&&r.pending.bytes===r.before.bytes&&r.pending.gpuPeak>=r.before.gpuPeak&&!r.pending.unknown.length&&r.restored.bytes===0&&r.lostCallsFresh.deleteTexture===1&&r.lostCallsFresh.finish===1,'native-loss-retirement-observation: lost deletes remain pending and counted until actual healthy completion; call snapshot immutable');}]);
mutants['native-loss-retirement-observation']={observe:()=>{const o=observed();o.lossObservation.pending.bytes=0;return o;}};

for(const [,check]of checks)await check(api);
console.log(`SCENE-ALLOCATION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let error;try{await check({...api,...mutants[name]});}catch(e){error=e;}assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail its own assertion`);console.log(`CAUGHT ${name}`);}
  console.log(`SCENE-ALLOCATION CONTROLS OK (${checks.length}/${checks.length})`);
}

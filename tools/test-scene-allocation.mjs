// Pure CPU controls: fake native GL records unchanged calls; no browser or renderer is launched.
import assert from 'node:assert/strict';
import {AllocationLedger,mipSizes,installAllocationObserver,ReservationPeak,rejectionObservation,reduceSceneObservations,sampleSceneAllocations,initializeSceneTextures,sceneMatrixContract} from './bake/scene-allocation.mjs';
import {deriveSceneStressContract} from './bake/inactive-figures.mjs';
import {QUALIFIED_HYBRID} from './bake/review-current-compression.mjs';

function observed(skipRestore=false,dropSamplePeak=false,forgetOldBuffer=false,sampler=sampleSceneAllocations,forgetOwners=false) {
  const saved={window:globalThis.window,WebGLRenderingContext:globalThis.WebGLRenderingContext,WebGL2RenderingContext:globalThis.WebGL2RenderingContext};
  class GL {
    constructor(){this.bindings=new Map();this.native=[];this.drawingBufferWidth=100;this.drawingBufferHeight=50;}
    getParameter(x){return this.bindings.get(x);}
    getContextAttributes(){return {depth:true,stencil:false,antialias:false};}
    getError(){return 0;}
  }
  const constants=['TEXTURE_2D','TEXTURE_CUBE_MAP','TEXTURE_3D','TEXTURE_2D_ARRAY','TEXTURE_BINDING_2D','TEXTURE_BINDING_CUBE_MAP','TEXTURE_BINDING_3D','TEXTURE_BINDING_2D_ARRAY',
    'RGBA','RGB','FLOAT','HALF_FLOAT','RGBA8','RGBA16F','DEPTH_COMPONENT16','RENDERBUFFER_BINDING','ARRAY_BUFFER','ARRAY_BUFFER_BINDING'];
  constants.forEach((name,i)=>GL.prototype[name]=i+100);
  GL.prototype.TEXTURE_CUBE_MAP_POSITIVE_X=1000;GL.prototype.TEXTURE_CUBE_MAP_NEGATIVE_Z=1005;
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
    install({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()});
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
    const observer=window.__allocation;if(!skipRestore){observer.restore();observer.restore();}
    const after=Object.getOwnPropertyDescriptors(GL.prototype);
    const exactRestore=Object.keys(after).length===Object.keys(descriptors).length&&Object.entries(descriptors).every(([key,d])=>
      after[key]?.value===d.value&&after[key]?.get===d.get&&after[key]?.set===d.set&&after[key]?.writable===d.writable&&after[key]?.enumerable===d.enumerable&&after[key]?.configurable===d.configurable);
    const windowRestore=Object.entries(priorObserver).every(([key,value])=>Object.getOwnPropertyDescriptor(window,'__allocation')?.[key]===value);
    const inheritedRestore=!Object.hasOwn(GL.prototype,'compressedTexSubImage3D')&&GL.prototype.compressedTexSubImage3D===nativeInherited;
    return {pendingBuffers,settledBuffers,firstSample,samplingCalls,detachedSample,unassociatedSample,retiredSample,reallocatedSample,knownId,rgba,beforeFinish,afterFinish,floating,bufferReservation,cubeAdded,immutableAdded,npotAdded,compressedAdded,astcAdded,afterAstcSubimage,bc7Added,compressedImmutableUnknown,exactRestore,windowRestore,inheritedRestore,small,resized,resizedAfterFinish,unknown,native:gl.native};
  } finally {for(const [key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
const api={Ledger:AllocationLedger,mips:mipSizes,observe:observed,Peak:ReservationPeak,rejection:rejectionObservation,reduce:reduceSceneObservations,matrix:sceneMatrixContract};
const phases=Array.from({length:11},(_,i)=>({packId:'pack',phaseId:String(i),scenario:{units:[{id:'us',side:'US',type:'infantry',men:100},{id:'cs',side:'CS',type:'infantry',men:100}]}}));
function observations(){
 const sample=(label,gpuReservation=100)=>({label,gpuReservation,conservativeReservation:gpuReservation+10,glError:0,allocation:{unknown:[]},unmappedBufferBytes:0});
 return {cases:phases.map(p=>({...p,complete:true,restoration:{ok:true},errors:[],states:['field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize'].map(l=>sample(l))})),
  failure:{...sample('failure',260000000),rejected:true,published:false,restoration:{ok:true}}};
}
// Constructed report bookkeeping only. No native GPU/context/route execution is claimed here.
function qualifiedObservations(){
 const contract=sceneMatrixContract(phases),candidateNames=Array.from({length:2},(_,look)=>Array.from({length:5},(_,i)=>`cs-close-${look?'h2_slouch_roll_butternut':'base'}-${i}-${i===4?'original.png':'astc.ktx2'}`)).flat(),
   report={sceneRoutes:'qualified-both',diagnosticOnly:true,fieldable:false,normalMotion:true,limits:{gpuBytes:250000000},inactivePrototype:true,terrainPartitionPrototype:true,terrainRestorationObserved:true,
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
   for(const side of ['US','CS']){for(const lod of [0,1,2])owner(`procedural.${side}.lod${lod}`,e[side],[64,16,16,4],2);owner('fallen.'+side,e[side],[64,16,16,4]);
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
   row.ordinaryRoster=['us','cs'];row.warm={baseline:'explicitly warmed supported lazy resources, retained stress roster and native smoke; pristine state not claimed',afterOrdinary:true,retainedRoster:['us','cs','sandbox-us-1'],spawned:{id:'sandbox-us-1',retained:true},combatUnchanged:true};
   row.lodReactivation={before:{id:1},after:{id:2},fullArray:true};row.transitions=[['rigged-reactivation','rigged',false],['near-lod-reupload','rigged',false],['baked-reclamation','baked',false],['compare-rigged-left','rigged',true],['compare-baked-left','baked',true],['baked-restored','baked',false]].map(([label,style,compare])=>({label,style,compare,combatUnchanged:true,combatBefore:'constructed combat snapshot',combatAfter:'constructed combat snapshot'}));row.scenario=structuredClone(scenario);row.capacityContract=e;
   row.stress={ok:true,native:['stress','restore-upload','restored-scene'].map(label=>({label,ok:true,owners:structuredClone(owners)})),uniqueDynamicBytes:owners.reduce((n,o)=>n+o.bytes,0),smoke:{systems:200,particles:800,capacity:1000},
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
   row.states.push(sample('fault-start'));
   if(tuple.route==='capable'){
     const prepare=['first-pool-prepare','candidate-then-baseline-terminal'].includes(tuple.fault);
     candidateNames.forEach(page=>add('candidate-request',{page}));candidateNames.forEach((page,i)=>{if(prepare||tuple.fault==='native-upload'||i)add('candidate-created',{page,textureId:i+1});});
     if(tuple.fault.startsWith('rejection-delayed-')){const page=candidateNames[tuple.fault.endsWith('astc')?1:4];add('sibling-held',{page,encoding:tuple.fault.endsWith('astc')?'astc4x4':'png'});add('held-check',{published:false,baselineRequests:0});add('sibling-released',{page});}
     candidateNames.forEach((page,i)=>{if(prepare||i)add('candidate-upload',{page});});
     if(!prepare)add('fault-fired',{fault:tuple.fault,page:candidateNames[0],native:true,glError:0x0501,actualHTTP:true,status:404});
     candidateNames.forEach((page,i)=>add('candidate-settled',{page,outcome:prepare||i?'fulfilled':'rejected'}));
     add('candidate-all-settled');
     if(['first-pool-prepare','candidate-then-baseline-terminal'].includes(tuple.fault))add('first-pool-prepare-rejected');
     if(prepare)add('fault-fired',{fault:tuple.fault,page:candidateNames[0],native:true,glError:0x0501,actualHTTP:true,status:404});
     candidateNames.forEach((page,i)=>{if(prepare||tuple.fault==='native-upload'||i)add('candidate-dispose',{page,textureId:i+1,ok:true});});
   }else add('fault-fired',{fault:tuple.fault});
   const first=add('first-baseline-request',{beforeNativeLoader:true}),firstSample=sample('first-baseline-request',first.sequence);if(tuple.route==='capable')firstSample.allocation.pendingDeleteBytes=1000;row.states.push(firstSample);
   for(let i=0;i<5;i++){const page='baseline-'+i;if(!terminal||i){const e=add('baseline-upload',{page,beforeSample:true}),s=sample('baseline-upload',e.sequence);s.page=page;if(tuple.route==='capable')s.allocation.pendingDeleteBytes=1000;row.states.push(s);}add('baseline-settled',{page,outcome:terminal&&!i?'rejected':'fulfilled'});}
   const pending=sample(terminal?'terminal-rejected-pending':'fallback-published-pending');if(tuple.route==='capable')pending.allocation.pendingDeleteBytes=1000;row.states.push(pending);sync();row.states.push(sample(terminal?'terminal-settled':'fallback-settled'));
   row.candidateRequests=tuple.route==='capable'?10:0;row.poolCount=1;row.outcome={rejected:terminal,published:!terminal,cachedClosePromise:true,fieldUnchanged:true,baselinePages:terminal?0:5,poolPages:[terminal?0:5],exactCurrentSingleBase:true,baselineSiblingsDisposed:true};
   row.restoration=restore();report.faults.push(row);
 }
 return report;
}
const checks=[
 ['matrix-contract',a=>{const c=a.matrix(phases);assert.equal(c.cases.length,22,'matrix-contract: two native routes for every phase');assert.equal(c.faults.length,88,'matrix-contract: seven capable and one unsupported faults per phase');assert.equal(new Set(c.faults.map(f=>`${f.packId}/${f.phaseId}/${f.route}/${f.fault}`)).size,88,'matrix-contract: exact unique fault tuples');}],
 ['matrix-contract-refusal',a=>{let e;try{a.matrix(phases.slice(1));}catch(x){e=x;}assert.ok(e?.message.startsWith('scene matrix:'),'matrix-contract-refusal: omitted phase cannot shrink declaration');}],
 ['qualified-complete',a=>{const r=a.reduce(qualifiedObservations(),phases);assert.equal(r.complete,true,'qualified-complete: constructed complete22+88 schema');assert.equal(r.withinLimit,true,'qualified-complete: complete under budget');assert.equal(r.maxGpuReservation,100000000,'qualified-complete: all native sample maxima read');}],
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
 }).map(([name,change])=>[name,a=>{const r=qualifiedObservations();change(r);assert.equal(a.reduce(r,phases).complete,false,`${name}: incomplete or misbound native matrix rejected`);}]),
 ['qualified-failure-maximum',a=>{const r=qualifiedObservations(),s=r.faults[0].restoration.samples[1];s.allocation.peak=299998800;s.allocation.gpuPeak=s.gpuReservation=300000000;s.conservativeReservation=300001000;const v=a.reduce(r,phases);assert.equal(v.complete,true,'qualified-failure-maximum: complete over-budget remains a measured result');assert.equal(v.maxGpuReservation,300000000,'qualified-failure-maximum: oversized fault restoration participates');assert.equal(v.withinLimit,false,'qualified-failure-maximum: complete failure peak cannot fit');}],
 ['qualified-partial-maximum',a=>{const r=qualifiedObservations();r.faults[0].complete=false;const s=r.faults[0].restoration.samples[1];s.gpuReservation=300000000;s.conservativeReservation=300001000;const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-partial-maximum: malformed or failed context cannot erase oversized observation');assert.equal(v.complete,false,'qualified-partial-maximum: partial remains incomplete');}],
 ['qualified-independent-maximum',a=>{const r=qualifiedObservations(),s=r.faults[0].restoration.samples[1];s.gpuReservation=300000000;s.conservativeReservation=NaN;const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-independent-maximum: invalid conservative scalar cannot erase valid GPU peak');assert.equal(v.complete,false,'qualified-independent-maximum: invalid scalar fails closed');}],
 ['qualified-nested-maximum',a=>{const r=qualifiedObservations(),s=structuredClone(r.faults[0].restoration.samples[1]);s.sequence++;s.gpuReservation=300000000;s.conservativeReservation=300001000;r.faults[0].stress={transaction:{samples:[{observation:s}]}};const v=a.reduce(r,phases);assert.equal(v.maxGpuReservation,300000000,'qualified-nested-maximum: failed fault nested stress cannot erase valid GPU peak');assert.equal(v.complete,false,'qualified-nested-maximum: inconsistent nested scalar fails closed');}],
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
  ...Object.fromEntries(checks.filter(([name])=>name.startsWith('qualified-')&&!['qualified-complete','qualified-failure-maximum','qualified-partial-maximum','qualified-independent-maximum','qualified-nested-maximum','qualified-invalid-mode-maximum','qualified-legacy-maximum'].includes(name)).map(([name])=>[name,{reduce:()=>({complete:true})}])),
  'qualified-failure-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-partial-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-independent-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-nested-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-invalid-mode-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
  'qualified-legacy-maximum':{reduce:(r,p)=>({...reduceSceneObservations(r,p),maxGpuReservation:100000000})},
};
for(const [,check]of checks)await check(api);
console.log(`SCENE-ALLOCATION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let error;try{await check({...api,...mutants[name]});}catch(e){error=e;}assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail its own assertion`);console.log(`CAUGHT ${name}`);}
  console.log(`SCENE-ALLOCATION CONTROLS OK (${checks.length}/${checks.length})`);
}

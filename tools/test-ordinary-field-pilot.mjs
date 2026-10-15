// CPU only. Models native return values without starting a browser or writing output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installOrdinaryAstcMask,readOrdinaryFrame,observeOrdinaryStability,ordinaryVisualSnapshot,ordinaryBaselineErrors,ordinaryPilotExpected} from './bake/ordinary-field-pilot.mjs';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,installFieldContextObserver,defaultSurfaceHistoryErrors} from './bake/scene-allocation.mjs';
let maskChecks=0,frameChecks=0,readerChecks=0,sourceChecks=0,stabilityChecks=0;
// Execute the actual source expression: serializing debug receipts must not materialize typed arrays.
const mainSource=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),resourceStart=mainSource.indexOf('resources:resources?'),
  resourceEnd=mainSource.indexOf('\n  audio:',resourceStart),sourceArray=new Float32Array([1,2]);let retainedReads=0;
assert(resourceStart>=0&&resourceEnd>resourceStart);sourceChecks++;
const exposure=vm.runInNewContext('('+mainSource.slice(resourceStart+'resources:'.length,resourceEnd).trim().replace(/,$/,'')+')',{
  resources:{name:'compact-v1'},terrainOwner:{receipt:{state:'partitioned'},get retainedArrays(){retainedReads++;return[{owner:'source',array:sourceArray}];}},graphicsStop:{snapshot:{stopped:false}}});
assert(Object.isFrozen(exposure));assert.equal(Object.getOwnPropertyDescriptor(exposure,'terrainArrays').enumerable,false);assert.equal(retainedReads,0);sourceChecks+=3;
JSON.stringify(exposure);assert.equal(retainedReads,0);assert.equal(exposure.terrainArrays[0].array,sourceArray);assert.equal(retainedReads,1);sourceChecks+=3;
for(const own of [false,true]){
  const calls=[],answer={},error={native:true},native=function(...args){calls.push({receiver:this,args});if(args[0]==='throw')throw error;return answer;},
    proto={getExtension:native},gl=Object.create(proto);
  if(own)Object.defineProperty(gl,'getExtension',{value:native,writable:false,enumerable:true,configurable:true});
  const before=Object.getOwnPropertyDescriptor(gl,'getExtension'),mask=installOrdinaryAstcMask(gl);
  assert.equal(gl.getExtension('WEBGL_compressed_texture_astc'),null);assert.equal(calls.length,0);maskChecks+=2;
  assert.equal(gl.getExtension('EXT_other',answer),answer);assert.equal(calls.length,1);assert.equal(calls[0].receiver,gl);assert.deepEqual(calls[0].args,['EXT_other',answer]);maskChecks+=4;
  const coercing={toString(){throw Error('unexpected conversion');}};
  assert.equal(gl.getExtension(coercing),answer);assert.equal(calls.at(-1).args[0],coercing);maskChecks+=2;
  const other={};assert.equal(gl.getExtension.call(other,'WEBGL_compressed_texture_astc'),answer);assert.equal(calls.at(-1).receiver,other);maskChecks+=2;
  assert.throws(()=>gl.getExtension('throw'),e=>e===error);assert.equal(mask.read().masked,1);assert.equal(mask.read().delegated,4);maskChecks+=3;
  const installed=Object.getOwnPropertyDescriptor(gl,'getExtension');Object.defineProperty(gl,'getExtension',{...installed,value:native});
  assert.throws(()=>mask.restore(),/ownership/);assert.equal(gl.getExtension,native);maskChecks+=2;
  Object.defineProperty(gl,'getExtension',installed);assert.equal(mask.restore().restored,true);assert.deepEqual(Object.getOwnPropertyDescriptor(gl,'getExtension'),before);
  assert.equal(mask.restore().restored,true);assert.throws(()=>mask.read(),/ownership/);maskChecks+=4;
}
assert.throws(()=>installOrdinaryAstcMask(Object.create({get getExtension(){throw Error('must not invoke');}})),/data method/);maskChecks++;
for(const mutation of ['reparent','intermediate-shadow']){
  const native=()=>1,foreign=()=>2,base={getExtension:native},middle=Object.create(base),gl=Object.create(middle),mask=installOrdinaryAstcMask(gl);
  if(mutation==='reparent')Object.setPrototypeOf(gl,{getExtension:foreign});else Object.defineProperty(middle,'getExtension',{value:foreign,configurable:true});
  assert.throws(()=>mask.read(),/ownership/);assert.throws(()=>mask.restore(),/ownership/);maskChecks+=2;
  // Leave foreign state intact; remove only our known descriptor for this isolated fixture.
  delete gl.getExtension;assert.equal(gl.getExtension,foreign);maskChecks++;
}

async function globals(values,run){const before=Object.fromEntries(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [k,value]of Object.entries(values))Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
  try{return await run();}finally{for(const [k,d]of Object.entries(before)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}}

for(const mode of ['normal','deadline','unpaused','bound-target','wrong-framebuffer'])await globals({window:{},document:{},requestAnimationFrame:undefined,cancelAnimationFrame:undefined,
  setTimeout:undefined,clearTimeout:undefined},async()=>{
  let callback,timer,reads=0,cancels=0,clears=0;
  requestAnimationFrame=fn=>{callback=fn;return 23;};cancelAnimationFrame=id=>{assert.equal(id,23);cancels++;};
  setTimeout=(fn,ms)=>{assert.equal(ms,10000);timer=fn;return 17;};clearTimeout=id=>{assert.equal(id,17);clears++;};
  const gl={drawingBufferWidth:2,drawingBufferHeight:1,FRAMEBUFFER_BINDING:1,RGBA:2,UNSIGNED_BYTE:3,
    getParameter(key){assert.equal(key,1);return mode==='wrong-framebuffer'?{}:null;},
    readPixels(x,y,w,h,format,type,bytes){reads++;assert.deepEqual([x,y,w,h,format,type],[0,0,2,1,2,3]);bytes.set([1,2,3,255,4,5,6,255]);}};
  window.__ready=true;window.__fieldContextObservation={context:id=>{assert.equal(id,1);return mode==='bound-target'?{}:gl;}};
  window.__game={game:{paused:mode!=='unpaused',simTime:0,units:[{def:{id:'fixture'},side:'US',men:1,x:0,z:0,facing:0}]},
    rts:{groundY:0,target:{x:0,y:0,z:0},goal:{x:0,z:0,yaw:0,pitch:1,dist:2000},yaw:0,pitch:1,dist:2000},camera:{matrixWorld:{elements:[1]},projectionMatrix:{elements:[2]}},
    post:{mode:'low',scale:1,rtScene:{width:2,height:1},rtSmall:{width:1,height:1},rtBlur:{width:1,height:1}}};
  document.getElementById=()=>({open:true});
  const read=mode==='normal'?vm.runInNewContext('('+readOrdinaryFrame.toString()+')',{
    window,document,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,btoa}):readOrdinaryFrame;
  const snapshot=mode==='normal'?vm.runInNewContext('('+ordinaryVisualSnapshot.toString()+')',{document}):ordinaryVisualSnapshot;
  const promise=read(gl,{snapshot});
  if(mode==='normal'){callback();const r=await promise;assert.equal(Buffer.from(r.rgba,'base64').length,8);assert.equal(reads,1);assert.equal(clears,1);frameChecks+=3;}
  else if(mode==='deadline'){timer();await assert.rejects(promise,/deadline/);callback();assert.equal(reads,0);assert.equal(cancels,1);frameChecks+=3;}
  else{callback();await assert.rejects(promise,/framebuffer/);assert.equal(reads,0);assert.equal(clears,1);frameChecks+=3;}
});

for(const mode of ['normal','reset','deadline','exception','falsy-exception','cap','schedule-error','time-not-zero'])await globals({window:{},requestAnimationFrame:undefined,cancelAnimationFrame:undefined,
  setTimeout:undefined,clearTimeout:undefined},async()=>{
  let callback,timer,reads=0,scheduled=0,cancelled=0,cleared=0;
  const error=mode==='falsy-exception'?null:{observed:true};
  requestAnimationFrame=fn=>{if(mode==='schedule-error')throw error;callback=fn;return++scheduled;};
  cancelAnimationFrame=id=>{assert.equal(id,scheduled);cancelled++;};
  setTimeout=(fn,ms)=>{assert.equal(ms,30000);timer=fn;return 99;};clearTimeout=id=>{assert.equal(id,99);cleared++;};
  const snapshot=()=>{reads++;if(mode==='exception'||mode==='falsy-exception')throw error;
    return{paused:true,simTime:mode==='time-not-zero'?1:0,briefing:true,position:mode==='reset'&&reads<=2?0:mode==='cap'?reads:1};};
  const observe=mode==='normal'?vm.runInNewContext('('+observeOrdinaryStability.toString()+')',{
    window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout}):observeOrdinaryStability;
  const pending=observe({snapshot});
  if(mode==='normal'||mode==='reset'){
    const total=mode==='normal'?8:10;for(let i=0;i<total;i++)callback();
    const result=await pending;assert.equal(result.frames,total);assert.equal(result.consecutive,8);assert.equal(reads,total);assert.equal(cleared,1);assert.equal(scheduled,total);stabilityChecks+=5;
  }else if(mode==='deadline'){
    timer();await assert.rejects(pending,/measurement deadline/);callback();assert.equal(reads,0);assert.equal(cancelled,1);assert.equal(scheduled,1);assert.equal(cleared,1);stabilityChecks+=5;
  }else if(mode==='cap'){
    for(let i=0;i<4096;i++)callback();await assert.rejects(pending,/frame cap/);assert.equal(reads,4096);assert.equal(scheduled,4096);assert.equal(cleared,1);stabilityChecks+=4;
  }else{
    if(mode!=='schedule-error')callback();
    if(mode==='time-not-zero')await assert.rejects(pending,/time-zero briefing/);
    else{let threw=false;try{await pending;}catch(value){threw=true;assert.equal(value,error);}assert(threw);}
    assert.equal(cleared,1);stabilityChecks+=3;
  }
});

const expected={sha:'a'.repeat(40),run:'123',attempt:'1',inputs:{settings:{viewport:[10,10],dpr:1},save:'canonical save',applied:JSON.stringify({units:[{id:'fixture',side:'US',men:1,x:0,z:0,facing:0}]}),documentSha256:'b'.repeat(64)},
  terrain:[{owner:'terrain-source/0',arrayType:'Float32Array',bytes:8,sha256:'c'.repeat(64)}],textures:{}};
const report={schema:'ordinary-lookout-baselines-v1',sha:expected.sha,run:expected.run,attempt:expected.attempt,inputs:expected.inputs,complete:true,cases:[]};
let lateRetainedObservation;
for(const route of ['capable','unsupported'])await globals({window:{addEventListener(){},removeEventListener(){}},document:{},HTMLCanvasElement:undefined,WebGL2RenderingContext:undefined,WebGLRenderingContext:undefined},async()=>{
  class GL{
    drawingBufferWidth=10;drawingBufferHeight=10;texture=null;buffer={};
    getContextAttributes(){return{depth:true,stencil:false};}isContextLost(){return false;}
    getParameter(key){if(key===this.TEXTURE_BINDING_2D)return this.texture;if(key===this.ACTIVE_TEXTURE)return 33984;if(key===this.ARRAY_BUFFER_BINDING)return this.buffer;throw Error('unexpected query '+key);}
    texStorage2D(){}bufferData(){}bufferSubData(){}texSubImage2D(){}texSubImage3D(){}generateMipmap(){}
  }
  Object.assign(GL.prototype,{TEXTURE_2D:3553,TEXTURE_BINDING_2D:32873,ACTIVE_TEXTURE:34016,RGBA8:32856,ARRAY_BUFFER:34962,ARRAY_BUFFER_BINDING:34964});
  const gl=new GL();class Canvas{constructor(){this.ownerDocument=document;this.isConnected=true;this.w=10;this.h=10;}getContext(){return gl;}addEventListener(){}removeEventListener(){}}
  for(const name of ['width','height'])Object.defineProperty(Canvas.prototype,name,{configurable:true,get(){return this[name==='width'?'w':'h'];},set(value){this[name==='width'?'w':'h']=value;}});
  HTMLCanvasElement=Canvas;WebGL2RenderingContext=GL;const canvas=new Canvas();document.getElementById=()=>canvas;document.defaultView=window;
  installAllocationObserver({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true,captureNativeFailures:true,captureDefaultSurfaces:true});
  const field=installFieldContextObserver({enabled:true,observeSurfaces:true,observeEpochs:true});canvas.getContext('webgl2');
  const descriptors=[],textures=[],hydrationCPU=[];
  const load=(side,tier,count)=>{for(let i=0;i<count;i++){
    const encoding=route==='capable'&&side==='CS'&&tier==='close'&&i<8?'astc4x4':'png',bytes=encoding==='astc4x4'?16:4;
    const page={side,tier,index:i,file:`${side}-${tier}-${i}`,width:1,height:1,encoding,levels:[{width:1,height:1,bytes}]};
    const start=window.__allocation.peek(gl);
    gl.texture={};gl.texStorage2D(3553,1,encoding==='astc4x4'?0x93b0:32856,1,1);
    if(encoding==='png'){gl.texSubImage2D();gl.generateMipmap(3553);}
    const end=window.__allocation.peek(gl);
    const native=window.__allocation.textureReservation(gl,gl.texture).id;
    descriptors.push(page);textures.push({...page,native,uuid:'texture-'+native});
    if(side==='US'&&tier==='close')hydrationCPU.push({before:start.nativeEvents.length,after:end.nativeEvents.length,callsBefore:start.calls,callsAfter:end.calls});
  }};
  const sample=pages=>{const allocation=window.__allocation.peek(gl);return{allocation,declaredArrayBytes:8,cpuDeclaredArrayBytes:8,retainedTerrainArrayBytes:8,
    cpuArrays:[{id:1,arrayType:'Float32Array',bytes:8,owners:['terrain-source/0']}],viewport:[10,10],dpr:1,glError:null,conservativeReservation:null,
    bufferOwnership:allocation.bufferSlots,mappedBufferBytes:0,unmappedBufferBytes:0,gpuReservation:allocation.gpuPeak,atlasPages:pages};};
  load('US','field',2);load('CS','field',4);const first=sample({US:{field:2},CS:{field:4}});
  load('US','close',3);load('CS','close',route==='capable'?10:5);const second=sample({US:{field:2,close:3},CS:{field:4,close:route==='capable'?10:5}});
  // Match actual per-side/tier producer order, independently of upload order.
  const order=(a,b)=>['US','CS'].indexOf(a.side)-['US','CS'].indexOf(b.side)||['field','close'].indexOf(a.tier)-['field','close'].indexOf(b.tier)||a.index-b.index;
  descriptors.sort(order);textures.sort(order);expected.textures[route]=descriptors;
  const frame={width:10,height:10,rgba:Buffer.from(Array.from({length:400},(_,i)=>i%256)).toString('base64'),transportBytes:400,simTime:0,paused:true,
    camera:{world:Array.from({length:16},(_,i)=>i%5===0?1:0),projection:Array.from({length:16},(_,i)=>i%5===0?1:0)},post:{mode:'low',scale:1,targets:[[10,10],[2,2],[2,2]]},
    rts:{groundY:0,target:[0,0,0],goal:[0,0,0,1,2000],yaw:0,pitch:1,dist:2000},roster:[{id:'fixture',side:'US',men:1,x:0,z:0,facing:0}],briefing:true};
  report.cases.push({route,complete:true,captureOverflow:false,errors:[],warnings:[],cleanupErrors:[],rawBefore:expected.inputs.save,rawAfter:expected.inputs.save,applied:expected.inputs.applied,
    genuineAstc:true,documentSha256:expected.inputs.documentSha256,terrain:expected.terrain,maskRestoration:{restored:true,masked:route==='capable'?0:1},
    observation:field.read(),samples:[first,second],frames:[frame,structuredClone(frame)],textures,restoration:{field:true,allocation:true},
    stability:{frames:8,consecutive:8,state:Object.fromEntries(['camera','post','rts','roster','simTime','paused','briefing'].map(k=>[k,structuredClone(frame[k])]))},
    uploadWorkload:{kind:'explicit original published US close hydration; no render/finish',before:first.allocation.nativeEvents.length,
      after:first.allocation.nativeEvents.length+3,pages:textures.filter(t=>t.side==='US'&&t.tier==='close').map((t,i)=>({side:t.side,tier:t.tier,index:t.index,native:t.native,uuid:t.uuid,...hydrationCPU[i]})),
      nativeHealth:{error:0,valid:true,textures:textures.length}}});
  if(route==='capable'){gl.bufferData(gl.ARRAY_BUFFER,260000000,35044);lateRetainedObservation=field.read();}
  field.restore();window.__allocation.restore();
});
assert.deepEqual(ordinaryBaselineErrors(report,expected),[]);readerChecks++;
assert.deepEqual(defaultSurfaceHistoryErrors(lateRetainedObservation.states[0].retained),[]);
const lateBad=structuredClone(report);lateBad.cases[0].observation=lateRetainedObservation;
assert(ordinaryBaselineErrors(lateBad,expected).length);readerChecks+=2;
const mutations=[r=>r.complete=false,r=>r.sha='f'.repeat(40),r=>r.inputs={},r=>r.cases.reverse(),r=>r.cases.pop(),
  r=>r.cases[0].errors.push('native failure'),r=>r.cases[0].warnings.push('warning'),r=>r.cases[0].rawAfter+='changed',r=>r.cases[0].applied+='changed',
  r=>r.cases[0].terrain[0].bytes++,r=>r.cases[0].genuineAstc=false,r=>r.cases[0].maskRestoration.restored=false,
  r=>r.cases[1].maskRestoration.masked=0,r=>r.cases[0].observation.restored=true,r=>r.cases[0].observation.receipts[0].target=false,
  r=>r.cases[0].samples[0].gpuReservation=0,r=>r.cases[0].samples[0].cpuDeclaredArrayBytes=1,
  r=>r.cases[0].samples[0].cpuArrays=[],r=>r.cases[0].samples[0].retainedTerrainArrayBytes=1,
  r=>r.cases[0].samples[0].allocation.defaultEvents[0].peak++,r=>r.cases[0].samples[0].unmappedBufferBytes=1,
  r=>r.cases[0].frames[1].rgba=Buffer.alloc(8).toString('base64'),r=>r.cases[0].frames[1].camera.world[0]++,
  r=>r.cases[0].frames[1].post.scale=.7,r=>r.cases[0].frames[0].transportBytes=1,
  r=>r.cases[0].samples[1].atlasPages.CS.close=5,r=>r.cases[0].textures[0].native=999,
  r=>r.cases[0].textures[0].levels.pop(),r=>r.cases[0].restoration.field=false,r=>r.cases[0].cleanupErrors.push('restore failed'),
  r=>r.run='124',r=>r.attempt='2',
  r=>{for(const f of r.cases[0].frames){delete f.camera;delete f.post;}},
  r=>{for(const f of r.cases[0].frames){f.width=5;f.height=20;}},
  r=>{for(const f of r.cases[0].frames)f.rgba+='!';},
  r=>r.cases[0].uploadWorkload.nativeHealth.error=1282,r=>r.cases[0].uploadWorkload.pages[0].uuid='foreign',
  r=>r.cases[0].uploadWorkload.before=999999,r=>r.cases[0].captureOverflow=true,
  r=>r.cases[0].samples[0].bufferOwnership.push({id:99,bytes:32,owners:[]}),r=>r.cases[0].samples[0].mappedBufferBytes=1,
  r=>r.cases[0].uploadWorkload.pages[0].callsAfter.finish=1,
  r=>r.cases[0].uploadWorkload.pages[0].before=0,
  r=>{for(const p of r.cases[0].uploadWorkload.pages){p.callsBefore={};p.callsAfter={texStorage2D:100000};}},
  r=>r.cases[0].stability.consecutive=7,r=>r.cases[0].stability.state.camera.world[0]++,
  r=>r.cases[0].frames[1].rts.groundY++,r=>r.cases[0].frames[1].roster[0].men++,
  r=>r.cases[0].frames[1].roster[0].x++,r=>r.cases[0].frames[1].briefing=false,
  r=>{for(const f of r.cases[0].frames)f.roster[0].x=999999;r.cases[0].stability.state.roster[0].x=999999;}];
for(const mutate of mutations){const bad=structuredClone(report);mutate(bad);assert(ordinaryBaselineErrors(bad,expected).length,'mutant must reject '+mutate);readerChecks++;}
// The actual independent terrain and committed asset constructor is CPU-only.
const actual=ordinaryPilotExpected('d'.repeat(40));assert.equal(actual.inputs.phase.index,9);assert(actual.terrain.some(a=>a.owner.endsWith('/sourceVertices')));
assert.equal(actual.textures.capable.filter(p=>p.side==='CS'&&p.tier==='close').length,10);
assert.equal(actual.textures.unsupported.filter(p=>p.side==='CS'&&p.tier==='close').length,5);readerChecks+=4;
console.log(`ORDINARY-PILOT CPU OK (source ${sourceChecks}, mask ${maskChecks}, frame ${frameChecks}, stability ${stabilityChecks}, reader ${readerChecks}); native entry/budget UNRUN`);

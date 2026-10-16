// CPU only. Models native return values without starting a browser or writing output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {installOrdinaryAstcMask,readOrdinaryFrame,observeOrdinaryStability,observeOrdinaryStabilityOnPage,ordinaryVisualSnapshot,ordinaryBaselineErrors,ordinaryPilotExpected,constructOrdinaryOwnerShapes} from './bake/ordinary-field-pilot.mjs';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,installFieldContextObserver,defaultSurfaceHistoryErrors,inventoryRetainedBuffers,RETAINED_BUFFER_GROUPS} from './bake/scene-allocation.mjs';
let maskChecks=0,frameChecks=0,readerChecks=0,sourceChecks=0,stabilityChecks=0,progressChecks=0;
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

for(const mode of ['constant','reset','changing','zero','cap','falsy','clock-fault','clock-symbol','clock-object','clock-infinite','clock-nan','overflow']){
  const results=[];
  for(const captureProgress of [false,true]){
    let callback,timer,reads=0,scheduled=0,cancelled=0,cleared=0,now=100;
    const snapshot=()=>{reads++;if(mode==='falsy')throw null;const position=mode==='reset'&&reads<=2?0:['changing','cap'].includes(mode)?reads:1;
      return{paused:true,simTime:0,briefing:true,camera:{world:[position],projection:[1]},rts:{groundY:position},post:{mode:'low'},roster:[{id:'fixture'}],
        ...(mode==='overflow'?{large:'x'.repeat(100000)}:{})};};
    const observe=vm.runInNewContext('('+observeOrdinaryStability.toString()+')',{window:{},performance:{now(){if(mode==='clock-fault')throw Error('clock diagnostic fault');
      if(mode==='clock-symbol')return Symbol('invalid');if(mode==='clock-object')return{};if(mode==='clock-infinite')return Infinity;if(mode==='clock-nan')return NaN;return now;}},
      requestAnimationFrame:fn=>{callback=fn;return++scheduled;},cancelAnimationFrame:id=>{assert.equal(id,scheduled);cancelled++;},
      setTimeout:(fn,ms)=>{assert.equal(ms,30000);timer=fn;return 99;},clearTimeout:id=>{assert.equal(id,99);cleared++;}});
    const pending=observe({snapshot,captureProgress});let result,error,rejected=false;
    const total=mode==='zero'?0:mode==='reset'?10:mode==='changing'?129:mode==='cap'?4096:mode==='falsy'?1:8;
    for(let i=0;i<total;i++){now+=16;callback(now);}
    if(['changing','zero'].includes(mode)){now=30100;timer();}
    try{result=await pending;}catch(value){rejected=true;error=value;}
    const receipt=pending.read();
    if(captureProgress){
      assert.equal(receipt.enabled,true);assert.equal(receipt.frames,reads-(mode==='falsy'?1:0));
      assert.equal(receipt.status,rejected?'rejected':'resolved');assert(receipt.last.length<=16);assert(receipt.retainedByteUpperBound<=262144);progressChecks+=5;
      if(mode==='changing'){
        assert.equal(receipt.periodic.length,1);assert.equal(receipt.periodic[0].sequence,128);assert.equal(receipt.last[0].sequence,114);
        assert.equal(receipt.changes.world,128);assert.equal(receipt.changes.rts,128);assert.equal(receipt.changes.post,0);progressChecks+=6;
      }
      if(mode==='overflow'){assert.equal(receipt.overflow,true);assert.equal(receipt.first,null);progressChecks+=2;}
      if(mode.startsWith('clock-')){assert(receipt.observerErrors>0);assert.equal(receipt.elapsedMs,null);progressChecks+=2;}
      if(mode==='zero'){assert.equal(receipt.first,null);assert.equal(receipt.firstRaf,null);progressChecks+=2;}
      receipt.status='FOREIGN';if(receipt.first)receipt.first.state.rts.groundY=999;
      assert.notEqual(pending.read().status,'FOREIGN');if(pending.read().first)assert.notEqual(pending.read().first.state.rts.groundY,999);progressChecks++;
      const before=JSON.stringify(pending.read());callback(40000);assert.equal(JSON.stringify(pending.read()),before);progressChecks++;
    }else{assert.equal(JSON.stringify(receipt),'{"enabled":false}');progressChecks++;}
    assert.equal(cleared,1);progressChecks++;
    results.push({reads,scheduled,cancelled,rejected,result:result?JSON.stringify(result):null,error:rejected?error===null?'null':error.message:null});
  }
  assert.deepEqual(results[0],results[1],'telemetry preserves scheduling and original result/failure '+mode);progressChecks++;
}
for(const mode of ['resolve','reject-null','read-failure','dispose-failure','primary-plus-cleanup','primary-hostile-read','primary-hostile-dispose']){
  const c={cleanupErrors:[]},primary=mode==='reject-null'?null:{primary:true};let evaluations=0,disposed=0,handled=0,coercions=0;
  const hostile={get message(){coercions++;throw Error('foreign getter');},toString(){coercions++;throw Error('foreign coercion');}};
  const rejects=mode==='reject-null'||mode.startsWith('primary-');
  const promise=rejects?Promise.reject(primary):Promise.resolve({stable:true});
  const originalCatch=promise.catch;promise.catch=function(...args){handled++;return Reflect.apply(originalCatch,this,args);};
  promise.read=()=>{if(mode==='primary-hostile-read')throw hostile;if(['read-failure','primary-plus-cleanup'].includes(mode))throw Error('read fault');return{frames:8};};
  const page={async evaluateHandle(fn,args){assert(args.observe.includes('captureProgress'));assert(args.snapshot.includes('matrixWorld'));
    // Execute the actual serialized holder callback in an isolated browser-like scope.
    const holder=vm.runInNewContext('('+fn.toString()+')',{mockPromise:promise})({observe:'()=>mockPromise',snapshot:'()=>({})'});
    assert.equal(holder.promise,promise);return{async evaluate(read){evaluations++;return read(holder);},async dispose(){disposed++;if(mode==='primary-hostile-dispose')throw hostile;
      if(['dispose-failure','primary-plus-cleanup'].includes(mode))throw Error('dispose fault');}};}};
  let result,rejected=false;
  try{result=await observeOrdinaryStabilityOnPage(page,c);}catch(error){rejected=true;assert.equal(error,primary);progressChecks++;}
  assert.equal(rejected,rejects);assert.equal(handled,1);assert.equal(evaluations,2);assert.equal(disposed,1);assert.equal(coercions,0);progressChecks+=5;
  if(!rejected){assert.deepEqual(result,{stable:true});progressChecks++;}
  assert.equal(c.cleanupErrors.length,mode==='primary-plus-cleanup'?2:['read-failure','dispose-failure','primary-hostile-read','primary-hostile-dispose'].includes(mode)?1:0);progressChecks++;
}

const expected={sha:'a'.repeat(40),run:'123',attempt:'1',inputs:{settings:{viewport:[10,10],dpr:1},save:'canonical save',applied:JSON.stringify({units:[{id:'fixture',side:'US',men:1,x:0,z:0,facing:0}]}),documentSha256:'b'.repeat(64)},
  terrain:[{owner:'terrain-source/0',arrayType:'Float32Array',bytes:8,sha256:'c'.repeat(64)}],textures:{},retainedOwners:Object.fromEntries(['capable','unsupported'].map(route=>[route,Object.fromEntries(['field','close'].map(phase=>[phase,[{owner:'terrain-source/0',type:'Float32Array',byteOffset:0,byteLength:8,backing:'source',backingByteLength:64,role:'oracle'}]]))]))};
const report={schema:'ordinary-lookout-baselines-v2',sha:expected.sha,run:expected.run,attempt:expected.attempt,inputs:expected.inputs,complete:true,cases:[]};
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
  const sample=pages=>{const allocation=window.__allocation.peek(gl),retainedBufferInventory=inventoryRetainedBuffers([{array:new Float32Array(new ArrayBuffer(64),0,2),owner:'terrain-source/0',role:'oracle'}],{requiredGroups:[...RETAINED_BUFFER_GROUPS],observedGroups:[...RETAINED_BUFFER_GROUPS]});
    retainedBufferInventory.phase=pages.US.close?'close':'field';retainedBufferInventory.geometryBindings=[];
    return{allocation,retainedBufferInventory,retainedBackingBytes:64,geometryArrayIds:[],declaredArrayBytes:8,cpuDeclaredArrayBytes:8,retainedTerrainArrayBytes:8,
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
const mutations=[r=>r.schema='ordinary-lookout-baselines-v1',
  r=>delete r.cases[0].samples[0].retainedBufferInventory,
  r=>r.cases[0].samples[0].retainedBackingBytes=8,
  r=>r.cases[0].samples[0].retainedBufferInventory.coverage.complete=false,
  r=>r.cases[0].samples[0].retainedBufferInventory.coverage.observedGroups.pop(),
  r=>r.cases[0].samples[0].retainedBufferInventory.phase='close',
  r=>r.cases[0].samples[0].retainedBufferInventory.views[0].owners=['invented'],
  r=>{const s=r.cases[0].samples[0];s.retainedBufferInventory.backings[0].byteLength=8;s.retainedBufferInventory.retainedBackingBytes=8;s.retainedBackingBytes=8;},
  r=>r.cases[0].samples[0].geometryArrayIds=[1],
  r=>r.complete=false,r=>r.sha='f'.repeat(40),r=>r.inputs={},r=>r.cases.reverse(),r=>r.cases.pop(),
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

// Independent shape oracle and browser collector traverse the same actual constructor owners separately.
// The renderer boundary below is a CPU model; this does not admit native bytes or the resource budget.
async function checkConstructedOwners(field,expectedShapes){
  const assert=(await import('node:assert/strict')).default,
    {sampleSceneAllocations,collectRetainedBufferRows,inventoryRetainedBuffers,retainedBufferInventoryErrors,RETAINED_BUFFER_GROUPS}=await import('./tools/bake/scene-allocation.mjs'),
    {retainedFigureGeometryArrays,figureGeometry}=await import('./src/units/soldier-mesh.js');
  let labels=0,rejectControls=0;const journal={observed:true,bufferSlots:[],byKind:{buffer:0},gpuPeak:0},context={},
    observer={assertOwned(value){assert.equal(value,context);},peek(value){assert.equal(value,context);return journal;},labelBufferOwners(value){assert.equal(value,context);labels++;return[];}},
    scope={__game:field,__allocation:observer,__sceneTerrainPartition:{retainedArrays:field.terrainRows},innerWidth:960,innerHeight:540,devicePixelRatio:1},
    options={retainedContext:context,retainedBuffers:{phase:field.phase,figureTemplates:retainedFigureGeometryArrays()}};
  const sampled=sampleSceneAllocations(scope,options),inventory=sampled.retainedBufferInventory;
  assert.equal(inventory.coverage.complete,true);assert(labels>0);assert.equal(inventory.phase,field.phase);
  assert.deepEqual(retainedBufferInventoryErrors(inventory,{requiredGroups:[...RETAINED_BUFFER_GROUPS],ownerShapes:expectedShapes,
    geometryArrays:sampled.cpuArrays.filter(a=>sampled.geometryArrayIds.includes(a.id)),bufferOwnership:[]}),[]);
  assert(inventory.retainedBackingBytes>sampled.cpuDeclaredArrayBytes);
  assert(expectedShapes.filter(s=>s.owner.startsWith('figure-template/')).length===48);
  for(const prefix of ['terrain.heights','terrain.normalPixels','terrain.noisePixels','texture/bones/','texture/flags/','world/parcels/delaunator/'])assert(expectedShapes.some(s=>s.owner.startsWith(prefix)));
  for(const owner of ['terrain.heights','terrain.normalPixels','texture/bones/source/data','world/parcels/delaunay/points','figure-template/']){
    const bad=structuredClone(inventory),view=bad.views.find(v=>v.owners.some(o=>o.startsWith(owner)));assert(view);
    view.owners=view.owners.filter(o=>!o.startsWith(owner));
    assert(retainedBufferInventoryErrors(bad,{requiredGroups:[...RETAINED_BUFFER_GROUPS],ownerShapes:expectedShapes}).length>0);rejectControls++;
  }
  const inactive=inventory.views.find(v=>v.owners.some(o=>o.startsWith('world/tree-template/'))&&!v.roles.includes('geometry'));assert(inactive);
  const missingInactive=structuredClone(inventory);missingInactive.views.find(v=>v.id===inactive.id).owners=[];
  assert(retainedBufferInventoryErrors(missingInactive,{requiredGroups:[...RETAINED_BUFFER_GROUPS],ownerShapes:expectedShapes}).length>0);rejectControls++;
  const aliased=structuredClone(inventory),tree=aliased.views.find(v=>v.id===inactive.id),height=aliased.views.find(v=>v.owners.includes('terrain.heights')),
    oldBacking=tree.backingId;
  // Coherently collapse every alias of one retained tree backing into terrain storage.
  for(const view of aliased.views)if(view.backingId===oldBacking)view.backingId=height.backingId;
  aliased.backings=aliased.backings.filter(b=>b.id!==oldBacking);const ids=new Map(aliased.backings.map((b,i)=>[b.id,i+1]));
  aliased.backings.forEach(b=>b.id=ids.get(b.id));aliased.views.forEach(v=>v.backingId=ids.get(v.backingId));
  aliased.retainedBackingBytes=aliased.backings.reduce((n,b)=>n+b.byteLength,0);
  assert(retainedBufferInventoryErrors(aliased,{requiredGroups:[...RETAINED_BUFFER_GROUPS],ownerShapes:expectedShapes}).length>0);rejectControls++;
  const missingGroup=structuredClone(inventory);missingGroup.coverage.observedGroups.pop();
  assert(retainedBufferInventoryErrors(missingGroup,{requiredGroups:[...RETAINED_BUFFER_GROUPS],ownerShapes:expectedShapes}).length>0);rejectControls++;
  const rejectMutation=(object,key,value)=>{const descriptor=Object.getOwnPropertyDescriptor(object,key),before=labels;
    try{Object.defineProperty(object,key,{value,writable:true,configurable:true,enumerable:descriptor?.enumerable??true});
      const result=sampleSceneAllocations(scope,options);assert.equal(result.retainedBufferInventory.coverage.complete,false);assert.equal(labels,before);assert.doesNotThrow(()=>structuredClone(result));rejectControls++;
    }finally{if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];}};
  let coercions=0;const hostile={valueOf(){coercions++;throw null;},[Symbol.toPrimitive](){coercions++;throw null;}};
  rejectMutation(field.terrain,'grid',hostile);rejectMutation(field.world.parcels,'rn',hostile);
  const pageCount={get length(){coercions++;throw null;}};rejectMutation(field.game.baked.atlases.US.layout.tiers.field,'pages',pageCount);
  rejectMutation(field.game.baked.atlases.US.textures,'field',pageCount);
  rejectMutation(field.world,'fenceField',null);
  rejectMutation(field.game.impostors.US,'fallen',new Float32Array(field.game.impostors.US.fallen.length-1));
  assert.equal(coercions,0);
  const prototype=Object.getPrototypeOf(field.game.baked.atlases.US),descriptor=Object.getOwnPropertyDescriptor(prototype,'loadsSettled'),before=labels;
  try{Object.defineProperty(prototype,'loadsSettled',{...descriptor,get(){coercions++;throw null;}});
    const rejected=sampleSceneAllocations(scope,options);assert.equal(rejected.retainedBufferInventory.coverage.complete,false);assert.equal(coercions,0);assert.equal(labels,before);rejectControls++;
  }finally{Object.defineProperty(prototype,'loadsSettled',descriptor);}
  const firstTemplate=retainedFigureGeometryArrays()[0].owner.split('/')[1],split=firstTemplate.indexOf(':'),geometry=figureGeometry(Number(firstTemplate.slice(0,split)),firstTemplate.slice(split+1)),
    position=Object.getOwnPropertyDescriptor(geometry.attributes,'position'),supplied=options.retainedBuffers.figureTemplates,labelsBeforeCache=labels;
  try{delete options.retainedBuffers.figureTemplates;Object.defineProperty(geometry.attributes,'position',{configurable:true,get(){coercions++;throw null;}});
    const rejected=sampleSceneAllocations(scope,options);assert.equal(rejected.retainedBufferInventory.coverage.complete,false);assert.equal(coercions,0);assert.equal(labels,labelsBeforeCache);rejectControls++;
  }finally{Object.defineProperty(geometry.attributes,'position',position);options.retainedBuffers.figureTemplates=supplied;}
  console.log(JSON.stringify({checkpoint:field.phase,sourceOwners:expectedShapes.length,views:inventory.views.length,bytes:inventory.retainedBackingBytes,geometry:sampled.geometryArrayIds.length,controls:rejectControls}));
}

async function checkTerminalSprites(field,route,mutant=null){
  const assert=(await import('node:assert/strict')).default,THREE=await import('three'),
    source=await import('./src/units/impostor.js');
  const terminalSpriteWord=mutant==='word'?()=>0:source.terminalSpriteWord,
    prepareTerminalSpriteTable=mutant==='table'?rects=>{const p=source.prepareTerminalSpriteTable(rects);new Uint32Array(p.data.buffer)[0]^=1;return p;}:source.prepareTerminalSpriteTable;
  const bits=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
  for(const side of ['US','CS']){
    if(route==='capable'&&side==='US')continue;
    const pool=field.game.impostors[side],tier=field.phase==='field'?'field':'close',L=pool.layout,T=L.tiers[tier],
      table=prepareTerminalSpriteTable(T.rects),batches=Object.values(pool.batches).flat(),
      saved=batches.map(b=>({b,n:b.n,first:b.data.slice(0,12)})),cam=pool.cam.clone(),standing=pool.standing,
      poses=pool.poses.slice(),looks=pool.looks.slice();
    const decode=(scalars,word,lookup=table.data)=>{
      const entry=Math.floor(word/4),r=lookup.subarray(entry*8,entry*8+8);
      return new Float32Array([...scalars.subarray(0,4),r[1],r[2],r[3],r[4],r[5],r[6],scalars[4],word%4-1]);
    };
    let rows=0,rejects=0;
    try{
      assert.equal(table.entries,T.rects.length/8);assert.equal(table.width,256);
      assert.deepEqual(bits(table.data.subarray(0,T.rects.length)),bits(T.rects));
      assert(table.data.subarray(T.rects.length).every(value=>Object.is(value,0)));
      for(let entry=0;entry<table.entries;entry++)for(const clip of [-1,0,1,2]){
        const packed=new THREE.InstancedBufferAttribute(new Uint16Array([terminalSpriteWord(entry,clip,table.entries)]),1,false);
        assert.equal(packed.normalized,false);assert.equal(packed.array.BYTES_PER_ELEMENT,2);
        assert.equal(Math.floor(packed.array[0]/4),entry);assert.equal(packed.array[0]%4-1,clip);
      }
      for(const clip of [-0,-2,3,.5,NaN,Infinity]){assert.throws(()=>terminalSpriteWord(0,clip,table.entries),/^Error: terminal sprite:/);rejects++;}
      for(const entry of [-1,table.entries,.5,NaN]){assert.throws(()=>terminalSpriteWord(entry,0,table.entries),/^Error: terminal sprite:/);rejects++;}
      pool.setView({position:new THREE.Vector3(0,tier==='field'?5000:100,0)});
      for(const clip of [0,1,2,3,4,5,6])for(const phase of [0,.01,.125,.5,.875,1.25,2.25])for(let direction=0;direction<64;direction++)for(let man=0;man<9;man++){
        const yaw=direction*Math.PI*2/64,compare=[-1,0,1,2][rows%4],variation=[0,-0,.25,.75,1][rows%5];
        pool.begin();assert(pool.push(0,0,0,yaw,4.4,clip,phase,variation,compare,man));
        const used=pool.batches[tier].filter(b=>b.n);assert.equal(used.length,1);const original=used[0].data.slice(0,12),slot=L.slotFor(clip,phase),
          entry=L.entry(slot,L.direction(tier,slot,yaw,0,0,0,0),L.lookFor(tier,man))/8,
          scalars=new Float32Array([original[0],original[1],original[2],original[3],original[10]]),word=terminalSpriteWord(entry,original[11],table.entries);
        assert.deepEqual(bits(decode(scalars,word)),bits(original));rows++;
      }
      pool.begin();assert(pool.push(0,0,0,0,4.4,0,0,.5,1,0));
      const original=pool.batches[tier].find(b=>b.n).data.slice(0,12),slot=L.slotFor(0,0),
        entry=L.entry(slot,L.direction(tier,slot,0,0,0,0,0),L.lookFor(tier,0))/8,
        scalars=new Float32Array([original[0],original[1],original[2],original[3],original[10]]),word=terminalSpriteWord(entry,1,table.entries),
        wrongEntry=Array.from({length:table.entries},(_,i)=>i).find(i=>!bits(T.rects.subarray(i*8+1,i*8+7)).equals(bits(T.rects.subarray(entry*8+1,entry*8+7))));
      assert.notEqual(wrongEntry,undefined);
      const wrongTable=table.data.slice(),wrongScalars=scalars.slice();
      new Uint32Array(wrongTable.buffer)[entry*8+1]^=1;new Uint32Array(wrongScalars.buffer)[3]^=1;
      for(const changed of [decode(scalars,terminalSpriteWord(wrongEntry,1,table.entries)),decode(scalars,word^1),decode(scalars,word,wrongTable),decode(wrongScalars,word)]){
        assert.notDeepEqual(bits(changed),bits(original));rejects++;
      }
      assert.equal(rows,28224);assert.equal(rejects,14);
      console.log(JSON.stringify({terminalSprite:true,route,side,tier,rows,rejects,entries:table.entries,tableBytes:table.data.byteLength}));
    }finally{
      for(const {b,n,first}of saved){b.n=n;b.data.set(first);}pool.cam.copy(cam);pool.standing=standing;pool.poses.set(poses);pool.looks.set(looks);
    }
  }
  for(const bad of [new Float64Array(8),new Float32Array(),new Float32Array(7),new Float32Array(8*16384+8),new Float32Array([NaN,0,0,0,0,0,0,0])])
    assert.throws(()=>prepareTerminalSpriteTable(bad),/^Error: terminal sprite:/);
  assert.equal(terminalSpriteWord(16383,2,16384),65535,'Uint16 attribute maximum remains legal');
}
let terminalRows=0,terminalRejects=0,terminalCases=0;
for(const route of ['capable','unsupported']){
  const script='const owners='+checkConstructedOwners.toString()+',sprites='+checkTerminalSprites.toString()+';('+constructOrdinaryOwnerShapes.toString()+')(async(field,shapes)=>{await owners(field,shapes);await sprites(field,process.argv[1]);const assert=(await import("node:assert/strict")).default;for(const mode of ["word","table"]){let error;try{await sprites(field,process.argv[1],mode);}catch(e){error=e;}assert.equal(error?.code,"ERR_ASSERTION","terminal sprite "+mode+" mutant must reach its own assertion");}console.log(JSON.stringify({terminalSpriteControl:true,checkpoint:field.phase,count:2}));}).catch(error=>{console.error(error);process.exitCode=1;})';
  const output=execFileSync('node',['--input-type=module','-e',script,route],
    {cwd:new URL('..',import.meta.url),input:JSON.stringify({scenario:JSON.parse(actual.inputs.applied),route}),encoding:'utf8',maxBuffer:1000000,timeout:60000});
  const all=output.trim().split('\n').map(line=>JSON.parse(line)),rows=all.filter(r=>r.checkpoint&&!r.terminalSpriteControl),packed=all.filter(r=>r.terminalSprite),controls=all.filter(r=>r.terminalSpriteControl);
  assert.deepEqual(rows.map(r=>r.checkpoint),['field','close']);
  assert(rows.every(row=>row.sourceOwners===actual.retainedOwners[route][row.checkpoint].length&&row.controls===16));
  assert.equal(packed.length,route==='capable'?2:4);
  assert.deepEqual(controls.map(r=>r.checkpoint),['field','close']);assert(controls.every(r=>r.count===2));
  for(const row of packed){terminalCases++;terminalRows+=row.rows;terminalRejects+=row.rejects;}
  console.log('SOURCE-OWNERS '+route+' '+output.trim());
}
assert.equal(terminalCases,6);assert.equal(terminalRows,169344);assert.equal(terminalRejects,84);
console.log('TERMINAL-SPRITE CPU OK (6 cases / 169344 rows / 84 rejects / 8 intended source mutants); no runtime shader/upload/retirement claim');
console.log(`ORDINARY-PILOT CPU OK (source ${sourceChecks}, mask ${maskChecks}, frame ${frameChecks}, stability ${stabilityChecks}, progress ${progressChecks}, reader ${readerChecks}); native entry/budget UNRUN`);

// Actions-only native lifecycle proof; this small fixture is not a whole-battle budget measurement.
import {isDeepStrictEqual} from 'node:util';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,createSceneHistory,compactSceneSample,expandSceneContext} from './bake/scene-allocation.mjs';
import {installSceneStartGate,restoreSceneDiagnostics} from './bake/inactive-figures.mjs';

export async function sceneAllocationControls({browser,url,check,result,watchErrors}) {
  const ctx=await browser.newContext({viewport:{width:320,height:240}});
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  const page=await ctx.newPage(),errors=[];watchErrors(page,url,errors);
  try {
    await page.goto(url+'?nosw');
    await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    const report=await page.evaluate(async()=>{
      const THREE=await import('three'),{partitionTerrain,installTerrainPartition}=await import('./tools/bake/partition-terrain.mjs'),
        {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs'),
        {installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs');
      const renderer=new THREE.WebGLRenderer({antialias:false}),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
      renderer.setSize(32,32);camera.position.z=2;
      const geometry=new THREE.PlaneGeometry(1,1);geometry.deleteAttribute('normal');geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=new THREE.MeshBasicMaterial({color:0x86734c,side:THREE.DoubleSide}),root=new THREE.Mesh(geometry,material);root.name='native-terrain';root.userData.triangles=2;scene.add(root);
      const saved={geometry,material,position:geometry.attributes.position,uv:geometry.attributes.uv,index:geometry.index,box:geometry.boundingBox,sphere:geometry.boundingSphere};
      const bytes=a=>Array.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
      const originalBytes=[saved.position,saved.uv,saved.index].map(a=>bytes(a.array));
      const post={renderer,render(s,c){renderer.render(s,c);}},scope={__game:{scene,post,game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:32,innerHeight:32,devicePixelRatio:1};
      const gate=installRenderGate(post);scope.__sceneRenderGate=gate;
      const gl=renderer.getContext(),rows=[];
      const renderbuffer=gl.createRenderbuffer(),priorRenderbuffer=gl.getParameter(gl.RENDERBUFFER_BINDING);
      gl.bindRenderbuffer(gl.RENDERBUFFER,renderbuffer);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,4,4);
      const nativeRenderbuffer={width:gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_WIDTH),height:gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_HEIGHT),format:gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_INTERNAL_FORMAT)};
      gl.bindRenderbuffer(gl.RENDERBUFFER,priorRenderbuffer);
      const draw=()=>gate.renderOnce(scene,camera),sample=label=>({label,...sampleSceneAllocations(scope)});
      let restoration;
      try {
        draw();const original=sample('original');gl.finish();
        const fullArrays=g=>[...Object.values(g.attributes),g.index].every(a=>scope.__allocation.bufferReservations(gl,a.array).some(r=>!r.pendingDelete&&r.bytes===a.array.byteLength));
        const sourceBytesMatch=fullArrays(geometry);
        scope.__sceneTerrainPartition=installTerrainPartition({terrainMesh:root},THREE,a=>partitionTerrain(a,3),{reversible:true});
        draw();const partitioned=sample('partition-pending');gl.finish();const settled=sample('partition-settled');
        const chunkBytesMatch=root.children.every(c=>fullArrays(c.geometry));
        const sourceIds=original.bufferOwnership.map(r=>r.id),chunkIds=settled.bufferOwnership.map(r=>r.id);
        const clean=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
        rows.push({name:'detached-pending',ok:sourceBytesMatch&&chunkBytesMatch&&sourceIds.length===3&&partitioned.allocation.pendingDeleteBytes>0
          &&sourceIds.every(id=>partitioned.bufferOwnership.some(r=>r.id===id&&r.pendingDelete&&r.owners.length))
          &&sourceIds.every(id=>!settled.bufferOwnership.some(r=>r.id===id))&&clean(original)&&clean(partitioned)&&clean(settled)});
        let restoredBytesMatch=false;
        restoration=restoreSceneDiagnostics(scope,{sampleRestored(){
          draw();const pending=sample('restored-native-pending');gl.finish();restoredBytesMatch=fullArrays(geometry);return [pending,sample('restored-native-settled')];
        }});
        const [pending,final]=restoration.samples,restoredIds=final?.bufferOwnership.map(r=>r.id)||[];
        rows.push({name:'native-restored',ok:restoredBytesMatch&&restoration.ok&&root.geometry===saved.geometry&&root.material===saved.material&&!root.children.length
          &&geometry.attributes.position===saved.position&&geometry.attributes.uv===saved.uv&&geometry.index===saved.index
          &&geometry.boundingBox===saved.box&&geometry.boundingSphere===saved.sphere
          &&JSON.stringify([saved.position,saved.uv,saved.index].map(a=>bytes(a.array)))===JSON.stringify(originalBytes)
          &&restoredIds.length===3&&restoredIds.every(id=>!sourceIds.includes(id)&&!chunkIds.includes(id))
          &&chunkIds.every(id=>pending?.bufferOwnership.some(r=>r.id===id&&r.pendingDelete&&r.owners.length))
          &&chunkIds.every(id=>!restoredIds.includes(id))&&clean(pending)&&clean(final)});
        rows.push({name:'restoration-order',ok:JSON.stringify(restoration.calls)===JSON.stringify(['terrain','capture','render','allocation'])&&gate.count===3});
        return {rows,original,partitioned,settled,restoration,nativeRenderbuffer,kind:'small native terrain lifecycle fixture; whole-battle matrix UNRUN'};
      } finally {
        if(!restoration)restoreSceneDiagnostics(scope);
        gl.deleteRenderbuffer(renderbuffer);geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();
      }
    });
    const raw=[report.original,report.partitioned,report.settled,...report.restoration.samples].map((s,i)=>({...s,sequence:i+1})),history=createSceneHistory(),
      compact={history,states:raw.map(s=>compactSceneSample(history,s))},expanded=expandSceneContext(compact);
    report.nativeHistory=compact;
    report.rows.push({name:'native-history-roundtrip',ok:isDeepStrictEqual(expanded.states,raw)
      &&['buffer','texture','renderbuffer'].every(kind=>history.nativeEvents.some(e=>e.operation==='reserve'&&e.kind===kind))
      &&report.nativeRenderbuffer.width===4&&report.nativeRenderbuffer.height===4&&raw[0].allocation.renderbufferSlots.some(r=>r.bytes===64)});
    result.sceneAllocation=report;
    for(const row of report.rows)check(`scene-allocation-${row.name}`,row.ok,JSON.stringify(report.restoration));
    check('scene-allocation-errors',errors.length===0,errors.join('; '));
  } finally {await ctx.close();}
  await sceneLifetimeControls({browser,url,check,result,watchErrors});
  await sceneTransactionControls({browser,url,check,result,watchErrors});
  await sceneStressOwnerControls({browser,url,check,result,watchErrors});
  await sceneStressOwnerControls({browser,url,check,result,watchErrors,mode:'terminal'});
  await canonicalTerrainControls({browser,url,check,result,watchErrors});
  await postPixelResourceControls({browser,url,check,result,watchErrors});
  await postOwnerResourceControls({browser,url,check,result,watchErrors});
  await terrainOwnerResourceControls({browser,url,check,result,watchErrors});
}

// Exercise the runtime geometry owner directly; observation never supplies its lifecycle.
async function terrainOwnerResourceControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:128,height:96},deviceScaleFactor:1}),errors=[];
 try{
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  const page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');
  await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const proof=await page.evaluate(async()=>{
   const THREE=await import('three'),{prepareTerrainPartition}=await import('./src/world/terrain.js'),{sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
   const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),gl=renderer.getContext(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
   renderer.setSize(32,32);renderer.setClearColor(0x172433);camera.position.z=3;
   const source=new THREE.PlaneGeometry(1.6,1.6,4,4);source.deleteAttribute('normal');
   for(let i=0;i<source.attributes.position.count;i++)source.attributes.position.setZ(i,Math.sin(i)*.05);source.computeBoundingBox();source.computeBoundingSphere();
   const material=new THREE.ShaderMaterial({uniforms:{uTint:{value:new THREE.Vector3(.4,.6,.2)}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv; uniform vec3 uTint; void main(){gl_FragColor=vec4(uTint+vec3(vUv*.2,0.),1.);}'}),root=new THREE.Mesh(source,material);
   root.name='terrain';root.userData.triangles=32;scene.add(root);
   const scope={__game:{scene,world:{terrainMesh:root},post:{renderer},game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:32,innerHeight:32,devicePixelRatio:1};
   const receipt={states:[],frames:[],cleanup:[],errors:[],sourceBytes:[source.attributes.position,source.attributes.uv,source.index].reduce((n,a)=>n+a.array.byteLength,0)},before=root.onBeforeRender;
   let owner;
   const sample=label=>{const s={label,sequence:receipt.states.length+1,...sampleSceneAllocations(scope)};receipt.states.push(s);return s;};
   const frame=(label,view)=>{camera.position.set(view==='boundary'?.06:0,view==='near'?.03:0,3);camera.zoom=view==='near'?1.5:1;camera.updateProjectionMatrix();camera.updateMatrixWorld();renderer.render(scene,camera);const pixels=new Uint8Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const f={label,view,width:32,height:32,pixels:btoa(String.fromCharCode(...pixels)),glError:gl.getError(),drawCalls:renderer.info.render.calls,nonuniform:pixels.some((v,i)=>i%4<3&&v!==pixels[i%4])};receipt.frames.push(f);return f;};
   const capture=label=>{for(const view of ['overview','near','boundary'])frame(label,view);};
   const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{renderer.domElement.removeEventListener(name,done);reject(Error('terrain native '+name+' timeout'));},20000);function done(){clearTimeout(timer);resolve();}renderer.domElement.addEventListener(name,done,{once:true});});
   try{
    capture('original');const warm=sample('warm-original');receipt.defaultOff=root.geometry===source&&root.children.length===0&&root.onBeforeRender===before;
    const callBefore={...warm.allocation.calls};owner=prepareTerrainPartition(root,renderer,{limit:6});scope.__sceneTerrainPartition=owner;
    const prepared=sample('prepared');receipt.cpuOnlyPreparation=JSON.stringify(callBefore)===JSON.stringify(prepared.allocation.calls)&&root.geometry===source&&root.children.length===0;
    receipt.originalIds=warm.bufferOwnership.map(r=>r.id);receipt.installed=owner.install();const retired=sample('source-completed');receipt.installReceipt=owner.receipt;
    capture('partition');const partition=sample('partition-uploaded');receipt.chunkIds=partition.bufferOwnership.map(r=>r.id);
    const originals=[source.attributes.position,source.attributes.uv,source.index],originalArrays=originals.map(a=>a.array);
    receipt.restored=owner.restore();const settled=sample('chunks-completed');receipt.restoreReceipt=owner.receipt;capture('restored');sample('original-reuploaded');
    receipt.exactOriginal=root.geometry===source&&root.material===material&&root.children.length===0&&root.onBeforeRender===before&&originals.every((a,i)=>a.array===originalArrays[i])&&owner.retainedArrays.length===0;
    receipt.retirement={sourceGone:receipt.originalIds.every(id=>!retired.bufferOwnership.some(r=>r.id===id)),chunksGone:receipt.chunkIds.every(id=>!settled.bufferOwnership.some(r=>r.id===id))};
    // A second, separate owner exercises actual DOM loss and Three's fresh properties.
    owner=prepareTerrainPartition(root,renderer,{limit:6});scope.__sceneTerrainPartition=owner;owner.install();capture('before-loss');sample('before-loss');
    const oldProperties=renderer.properties,lost=event('webglcontextlost');renderer.forceContextLoss();await lost;
    const beforeCalls=window.__allocation.nativeCalls(gl);receipt.lostRestore=owner.restore();const afterCalls=window.__allocation.nativeCalls(gl);
    receipt.loss={actualLost:gl.isContextLost(),beforeCalls,afterCalls,pending:owner.pending,hidden:root.visible===false};
    // The loss event must finish dispatching before WEBGL_lose_context accepts restoration.
    // Match the actual Post fixture's next-task boundary, not a retry or longer timeout.
    await new Promise(resolve=>setTimeout(resolve,0));const restored=event('webglcontextrestored');renderer.forceContextRestore();await restored;
    receipt.freshProperties=renderer.properties!==oldProperties;receipt.resumed=owner.resume();sample('context-completed');capture('context-restored');sample('context-reuploaded');
    receipt.lossExactOriginal=root.geometry===source&&root.material===material&&!root.children.length&&root.onBeforeRender===before&&owner.retainedArrays.length===0;
   }catch(e){receipt.errors.push(String(e?.message??e));}
   finally{
    const attempt=(name,fn)=>{try{fn();receipt.cleanup.push({name,ok:true});}catch(e){receipt.cleanup.push({name,ok:false,error:String(e?.message??e)});}};
    if(owner?.pending&&!gl.isContextLost())attempt('pending',()=>{if(!owner.resume())throw Error('owner completion deferred');});
    if(owner?.state==='partitioned')attempt('owner',()=>{if(!owner.restore())throw Error('owner restoration deferred');});
    attempt('detach',()=>scene.remove(root));attempt('source',()=>source.dispose());attempt('material',()=>material.dispose());attempt('renderer',()=>renderer.dispose());
    attempt('finish',()=>{if(gl.isContextLost())throw Error('lost cleanup');gl.finish();});
    if(!gl.isContextLost())attempt('snapshot',()=>sample('cleanup'));else receipt.cleanup.push({name:'snapshot',ok:false,error:'lost context; last live allocation samples retained'});
    attempt('context',()=>renderer.forceContextLoss());
   }
   return receipt;
  });
  result.terrainOwnerResourceProof=proof;
  const healthy=s=>!s.glError&&!s.allocation.unknown.length&&!s.unmappedBufferBytes,
   frameOk=f=>f.width===32&&f.height===32&&f.glError===0&&f.drawCalls>0&&f.nonuniform&&Buffer.from(f.pixels,'base64').length===4096,
   equal=(a,b)=>['overview','near','boundary'].every(view=>{const x=proof.frames.find(f=>f.label===a&&f.view===view),y=proof.frames.find(f=>f.label===b&&f.view===view);return x&&y&&x.pixels===y.pixels;});
  const warm=proof.states.find(s=>s.label==='warm-original'),partition=proof.states.find(s=>s.label==='partition-uploaded'),retired=proof.states.find(s=>s.label==='source-completed'),settled=proof.states.find(s=>s.label==='chunks-completed'),reuploaded=proof.states.find(s=>s.label==='original-reuploaded');
  const retiredBeforeUpload=(ids,events)=>ids.length>0&&ids.every(id=>{const d=events.findIndex(e=>e.operation==='retire'&&e.kind==='buffer'&&e.id===id),r=events.findIndex(e=>e.operation==='release'&&e.kind==='buffer'&&e.id===id);return d>=0&&r>d&&events.slice(d+1,r).some(e=>e.operation==='finish');});
  const noOverlap=(outgoing,incoming,events)=>{
   if(!outgoing?.length||!incoming?.length||incoming.some(id=>outgoing.includes(id)))return false;
   const released=outgoing.map(id=>events.findIndex(e=>e.operation==='release'&&e.kind==='buffer'&&e.id===id)),reserved=incoming.map(id=>events.findIndex(e=>e.operation==='reserve'&&e.kind==='buffer'&&e.id===id));
   return released.every(i=>i>=0)&&reserved.every(i=>i>Math.max(...released));
  };
  const cleanRetirement=s=>s?.allocation.byKind.buffer===0&&s.allocation.pendingDeleteBytes===0&&s.bufferOwnership.length===0,
   incoming=reuploaded?.bufferOwnership.map(r=>r.id)||[],events=partition?.allocation.nativeEvents||[],restoreEvents=reuploaded?.allocation.nativeEvents||[],
   nonoverlap=noOverlap(proof.originalIds,proof.chunkIds,events)&&noOverlap(proof.chunkIds,incoming,restoreEvents);
  check('terrain-owner-default-off',proof.defaultOff&&proof.cpuOnlyPreparation,'ordinary geometry/draw callback unchanged; preparation makes no native calls');
  check('terrain-owner-native-install',proof.installed&&proof.installReceipt?.state==='partitioned'&&proof.originalIds?.length===3&&proof.retirement?.sourceGone&&cleanRetirement(retired)&&retiredBeforeUpload(proof.originalIds,retired?.allocation.nativeEvents||[])&&nonoverlap,'real source IDs retire/finish/release before replacement upload');
  check('terrain-owner-native-restoration',proof.restored&&proof.exactOriginal&&proof.restoreReceipt?.state==='restored'&&proof.chunkIds?.length>3&&proof.retirement?.chunksGone&&cleanRetirement(settled)&&retiredBeforeUpload(proof.chunkIds,settled?.allocation.nativeEvents||[])&&nonoverlap,'all real outgoing IDs retire/finish/release before exact original becomes drawable');
  const early=events.find(e=>e.operation==='reserve'&&e.kind==='buffer'&&proof.chunkIds?.includes(e.id)),mutated=early?[early,...events.filter(e=>e!==early)]:[];
  check('terrain-owner-native-overlap-rejection',nonoverlap&&!!early&&!noOverlap(proof.originalIds,proof.chunkIds,mutated),'a replacement reserved before outgoing releases fails the actual overlap predicate');
  check('terrain-owner-native-source-bytes',warm?.allocation.byKind.buffer===proof.sourceBytes&&partition?.allocation.byKind.buffer===proof.installReceipt?.bytes,'full actual source/partition backing accounted separately');
  check('terrain-owner-native-whole-frames',proof.frames.length===15&&proof.frames.every(frameOk),'all 15 original/partition/restored/loss whole RGBA frames retained');
  check('terrain-owner-native-pixel-equality',equal('original','partition')&&equal('original','restored'),'overview/near/actual interior seam exact whole RGBA');
  check('terrain-owner-native-context-deferral',proof.loss?.actualLost&&proof.lostRestore===false&&proof.loss.pending==='restore'&&proof.loss.hidden&&isDeepStrictEqual(proof.loss.beforeCalls,proof.loss.afterCalls),'actual loss retains CPU owners, hides draw graph, adds no native call');
  check('terrain-owner-native-context-restoration',proof.freshProperties&&proof.resumed&&proof.lossExactOriginal&&equal('original','context-restored'),'actual Three restoration, then owner completion and exact original whole frames');
  let replay=false,reject=false;try{const history=createSceneHistory(),compact={history,states:proof.states.map(s=>compactSceneSample(history,s))};proof.nativeHistory=compact;replay=isDeepStrictEqual(expandSceneContext(compact).states,proof.states);const bad=structuredClone(compact);bad.history.nativeEvents[0].sequence=999999;try{expandSceneContext(bad);}catch{reject=true;}}catch(e){proof.replayError=String(e);}
  check('terrain-owner-native-history',replay&&reject,'all native events/slots replayed; malformed chronology rejected');
  const cleanup=proof.states.at(-1);
  check('terrain-owner-native-cleanup',proof.cleanup.every(r=>r.ok)&&cleanup?.allocation.byKind.buffer===0&&cleanup?.allocation.pendingDeleteBytes===0,'independent cleanup, no surviving native geometry');
  check('terrain-owner-native-health',proof.states.every(healthy)&&proof.errors.length===0&&errors.length===0,JSON.stringify({errors,owner:proof.errors}));
 }finally{await ctx.close();}
}

// Actual opt-in owner, observed only. No diagnostic lifetime wrappers or budget adoption.
async function postOwnerResourceControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:128,height:96},deviceScaleFactor:1}),errors=[];
 try{
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  const page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const proof=await page.evaluate(async()=>{
   const THREE=await import('three'),{Post}=await import('./src/render/post.js'),{sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
   const proof={kind:'actual default-off Post ownership prerequisite; full-art normal-entry budget/adoption UNRUN',cases:[],errors:[]};
   const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
   for(const owned of [true,false]){
    const receipt={owned,states:[],frames:[],cleanup:[],complete:false};proof.cases.push(receipt);let renderer,post,geometry,material,gl,sequence=0;
    const attempt=(label,fn)=>{try{fn();receipt.cleanup.push({label,ok:true});}catch(e){receipt.cleanup.push({label,ok:false,error:String(e?.message??e)});}};
    try{
     renderer=new THREE.WebGLRenderer({antialias:false,stencil:false});renderer.setSize(32,32);gl=renderer.getContext();receipt.defaultsBefore=window.__allocation.snapshot(gl).textureSlots;
     post=new Post(renderer,{mode:'high',...(owned?{resourceLifetime:true}:{})});post.setSize(32,32);
     const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
     geometry=new THREE.PlaneGeometry(1,1);material=new THREE.MeshBasicMaterial({color:0x86734c,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geometry,material));
     const targets=[post.rtScene,post.rtSmall,post.rtBlur],textures=targets.map(t=>t.texture),arrays=[...new Set([geometry,post.quad.geometry].flatMap(g=>[...Object.values(g.attributes).map(a=>a.array),g.index.array]))];
     const sourceBytes=arrays.map(a=>encode(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))),scope={__game:{post,scene,game:{baked:{atlases:{}}}},__allocation:window.__allocation};
     const sample=label=>{const s={label,sequence:++sequence,...sampleSceneAllocations(scope)};receipt.states.push(s);return s;};
     const nativeOwners=()=>targets.map(t=>{const texture=renderer.properties.get(t.texture).__webglTexture;return window.__allocation.textureReservation(gl,texture);});
     const frame=label=>{renderer.info.reset();post.render(scene,camera);gl.finish();const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      const f={label,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,pixels:encode(bytes),glError:gl.getError(),drawCalls:renderer.info.render.calls,nonuniform:bytes.some((v,i)=>v!==bytes[i%4])};receipt.frames.push(f);return f;};
     frame('baseline');sample('baseline');receipt.oldOwners=nativeOwners();receipt.oldDepth=window.__allocation.renderbufferReservation(gl,renderer.properties.get(post.rtScene).__webglDepthbuffer);receipt.resizeStart=receipt.states.at(-1).allocation.nativeEvents.length;
     const beforeFinish=receipt.states.at(-1).allocation.calls.finish||0;post.setSize(64,48);receipt.resized=sample('resize-before-draw');receipt.resizeFinishes=(receipt.resized.allocation.calls.finish||0)-beforeFinish;
     frame('resized');sample('resized-drawn');receipt.newOwners=nativeOwners();receipt.newDepth=window.__allocation.renderbufferReservation(gl,renderer.properties.get(post.rtScene).__webglDepthbuffer);
     post.setSize(32,32);frame('roundtrip');sample('roundtrip');
     receipt.cpuOwnersStable=targets.every((t,i)=>t===[post.rtScene,post.rtSmall,post.rtBlur][i]&&t.texture===textures[i]);
     receipt.methodsUnwrapped=['_apply','render','beginSoldierView','endSoldierView'].every(k=>!Object.hasOwn(post,k))&&renderer===post.renderer;
     receipt.option={actual:post.resourceLifetime,diagnosticPixelBytes:post.diagnosticPixelBytes,requestedScale:post.requestedScale};
     if(owned){
      post.beginSoldierView(camera,2);const lens=post.soldierView;frame('lens');sample('lens');receipt.lensOwner=window.__allocation.textureReservation(gl,renderer.properties.get(lens.depth).__webglTexture);
      const start=receipt.states.at(-1).allocation.nativeEvents.length;post.endSoldierView();const ended=sample('lens-ended');receipt.lensEvents=ended.allocation.nativeEvents.slice(start);
      const finishes=ended.allocation.calls.finish;post.endSoldierView();receipt.noopLensFinishes=(sample('lens-noop').allocation.calls.finish||0)-finishes;
      receipt.lensCoherent=post.soldierView===null&&post.rtScene.depthTexture===null&&lens.material.uniforms.tDepth.value===null;
      frame('after-lens');sample('after-lens');
      post.setSize(48,40);frame('latest-reference');sample('latest-reference');post.setSize(32,32);frame('before-loss');sample('before-loss');
      const properties=renderer.properties;
      const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{renderer.domElement.removeEventListener(name,done);reject(Error('Post owner native '+name+' timeout'));},20000);function done(){clearTimeout(timer);resolve();}renderer.domElement.addEventListener(name,done,{once:true});});
      const lost=event('webglcontextlost');renderer.forceContextLoss();await lost;
      // These separate fixture geometry owners retire their native buffers while lost.
      // Arrays/CPU identities remain unchanged; no observer epoch reset or cost exclusion.
      geometry.dispose();post.quad.geometry.dispose();
      const before=window.__allocation.nativeCalls(gl),sourceWidth=post.rtScene.width;post.setSize(80,60);post.setMode('low');post.setSize(48,40);post.setMode('high');post.render(scene,camera);
      const after=window.__allocation.nativeCalls(gl);receipt.loss={actualLost:gl.isContextLost(),beforeCalls:before,afterCalls:after,sourceWidth,afterWidth:post.rtScene.width,failed:post._resourceFailed===true,latest:[post.width,post.height,post.requestedScale]};
      await new Promise(resolve=>setTimeout(resolve,0));const restored=event('webglcontextrestored');renderer.forceContextRestore();await restored;
      receipt.restoredPropertiesFresh=renderer.properties!==properties;receipt.restoredContextHealthy=!gl.isContextLost()&&!post._resourceFailed;
      receipt.restoredAdmission={logical:[post.width,post.height],target:[post.rtScene.width,post.rtScene.height],canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],requestedScale:post.requestedScale};
      frame('restored');sample('restored');post.setSize(32,32);frame('baseline-restored');sample('baseline-restored');receipt.defaultsAfter=window.__allocation.snapshot(gl).textureSlots.filter(t=>Object.values(t.slots).every(n=>n===4));
     }
     receipt.sourceBytesStable=arrays.every((a,i)=>encode(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))===sourceBytes[i]);receipt.sourceArrayBytes=arrays.reduce((n,a)=>n+a.byteLength,0);receipt.complete=true;
    }catch(e){receipt.primary=String(e?.message??e);proof.errors.push(receipt.primary);}
    finally{
     if(post){attempt('lens',()=>post.endSoldierView());for(const[k,t]of [['scene',post.rtScene],['small',post.rtSmall],['blur',post.rtBlur]])attempt('target-'+k,()=>t.dispose());
      for(const[k,m]of [['down',post.downMat],['blur',post.blurMat],['final',post.finalMat]])attempt('material-'+k,()=>m.dispose());attempt('quad',()=>post.quad.geometry.dispose());}
     if(geometry)attempt('geometry',()=>geometry.dispose());if(material)attempt('material',()=>material.dispose());if(renderer)attempt('renderer',()=>renderer.dispose());
     if(gl&&!gl.isContextLost()){attempt('finish',()=>gl.finish());if(post)attempt('observation',()=>receipt.states.push({label:'cleanup',sequence:++sequence,...sampleSceneAllocations({__game:{post,scene:new THREE.Scene(),game:{baked:{atlases:{}}}},__allocation:window.__allocation})}));}
     if(renderer)attempt('context',()=>renderer.forceContextLoss());receipt.complete=receipt.complete&&!receipt.primary&&receipt.cleanup.every(r=>r.ok);
    }
   }return proof;
  });
  result.postOwnerResourceProof=proof;const c=proof.cases.find(r=>r.owned),d=proof.cases.find(r=>!r.owned);
  const healthy=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
  const frames=r=>r?.frames?.every(f=>f.glError===0&&f.drawCalls>0&&f.nonuniform&&Buffer.from(f.pixels,'base64').length===f.width*f.height*4);
  const equal=(r,a,b)=>{const x=r?.frames?.find(f=>f.label===a),y=r?.frames?.find(f=>f.label===b);return !!x&&!!y&&x.width===y.width&&x.height===y.height&&x.pixels===y.pixels;};
  const completed=(events,kind,id)=>{if(!Array.isArray(events))return false;const retired=events.findIndex(e=>e.operation==='retire'&&e.kind===kind&&e.id===id),released=events.findIndex(e=>e.operation==='release'&&e.kind===kind&&e.id===id);return retired>=0&&released>retired&&events.slice(retired+1,released).some(e=>e.operation==='finish');};
  const resizeEvents=c?.resized?.allocation.nativeEvents.slice(c.resizeStart)||[];
  check('post-owner-native-complete',proof.cases.length===2&&proof.cases.every(r=>r.complete)&&!proof.errors.length,JSON.stringify(proof.errors));
  check('post-owner-native-real-methods',proof.cases.every(r=>r.methodsUnwrapped)&&c?.option?.actual===true&&d?.option?.actual===false&&proof.cases.every(r=>r.option?.diagnosticPixelBytes===null&&r.option?.requestedScale===1),'actual source owner without lifecycle wrappers; original High requested');
  check('post-owner-native-cpu-identities',proof.cases.every(r=>r.cpuOwnersStable&&r.sourceBytesStable&&r.sourceArrayBytes===280),'exact CPU targets/textures/arrays retained');
  check('post-owner-native-resize-retirement',c?.oldOwners?.length===3&&c.oldOwners.every(r=>r&&completed(resizeEvents,'texture',r.id))&&c.newOwners?.every(r=>r&&!c.oldOwners.some(o=>o.id===r.id))&&!!c.oldDepth&&!!c.newDepth&&c.oldDepth.id!==c.newDepth.id&&completed(resizeEvents,'renderbuffer',c.oldDepth.id),'all actual old color/depth IDs retired and released before replacement uploads');
  check('post-owner-native-resize-completion',c?.resizeFinishes===4&&d?.resizeFinishes===0&&c.resized.allocation.pendingDeleteBytes===0,'actual owner retires targets, completes each native canvas replacement, and sizes targets');
  check('post-owner-native-whole-frames',proof.cases.every(frames),'whole RGBA native draws, dimensions, nonblank and GL health');
  check('post-owner-native-resize-roundtrip',proof.cases.every(r=>equal(r,'baseline','roundtrip')),'actual whole baseline pixels after resize roundtrip');
  const x=c?.frames?.find(f=>f.label==='baseline'),y=d?.frames?.find(f=>f.label==='baseline');
  check('post-owner-native-default-pixels',!!x&&!!y&&x.width===y.width&&x.height===y.height&&x.pixels===y.pixels,'default-off and enabled owners have identical full native RGBA at same High resolution');
  check('post-owner-native-lens-retirement',!!c?.lensOwner&&completed(c.lensEvents,'texture',c.lensOwner.id)&&c.lensCoherent&&c.noopLensFinishes===0&&equal(c,'baseline','after-lens'),'real lens depth deletion completes, coherent publication and no-op exit');
  check('post-owner-native-context-loss-deferral',c?.loss?.actualLost&&JSON.stringify(c.loss.beforeCalls)===JSON.stringify(c.loss.afterCalls)&&c.loss.sourceWidth===c.loss.afterWidth&&!c.loss.failed&&JSON.stringify(c.loss.latest)==='[48,40,1]','actual DOM loss; a different latest size/quality deferred without native calls');
  const latestApplied=r=>r?.restoredPropertiesFresh&&r.restoredContextHealthy&&['logical','target','canvas'].every(k=>JSON.stringify(r.restoredAdmission?.[k])==='[48,40]')&&r.restoredAdmission.requestedScale===1&&equal(r,'latest-reference','restored')&&equal(r,'baseline','baseline-restored');
  check('post-owner-native-context-restored',latestApplied(c),'actual Three fresh properties then Post latest different request; independent same-size reference and baseline whole frame equality');
  const stale=structuredClone(c||{});if(stale.restoredAdmission)stale.restoredAdmission.target=[32,32];
  check('post-owner-native-restoration-rejection',latestApplied(c)&&!latestApplied(stale),'stale target admission cannot pass latest-request proof');
  check('post-owner-native-observation-health',proof.cases.every(r=>r.states.every(healthy))&&errors.length===0,errors.join('; '));
  let replay=true,rejects=true;for(const r of proof.cases){try{const history=createSceneHistory(),compact={history,states:r.states.map(s=>compactSceneSample(history,s))};r.nativeHistory=compact;replay&&=isDeepStrictEqual(expandSceneContext(compact).states,r.states);
   const malformed=structuredClone(compact);malformed.history.nativeEvents[0].sequence=999999;let rejected=false;try{expandSceneContext(malformed);}catch{rejected=true;}rejects&&=rejected;
  }catch(e){replay=false;r.replayError=String(e?.message??e);}}
  check('post-owner-native-history-replay',replay,'complete native event/slot history including actual context loss and restoration');
  check('post-owner-native-history-rejection',rejects&&replay,'malformed native event sequences rejected independently');
  const cleaned=r=>{const s=r.states.at(-1),defaults=new Set([...(r.defaultsBefore||[]),...(r.defaultsAfter||[])].map(t=>t.texture));return s?.label==='cleanup'&&s.allocation.byKind.buffer===0&&s.allocation.byKind.renderbuffer===0&&s.allocation.pendingDeleteBytes===0&&s.allocation.textureSlots.every(t=>defaults.has(t.texture)&&Object.values(t.slots).every(n=>n===4));};
  check('post-owner-native-independent-cleanup',proof.cases.every(r=>r.cleanup.every(s=>s.ok)&&cleaned(r)),'all product owners independently disposed; both native default-texture epochs remain counted');
 }finally{await ctx.close();}
}

// Focused native Post prerequisite. No full-art fixed envelope or whole-scene acceptance claim.
async function postPixelResourceControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:1366,height:1024},deviceScaleFactor:2}),errors=[];let page;
 try{await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const proof=await page.evaluate(async()=>{
   const THREE=await import('three'),{Post}=await import('./src/render/post.js'),{sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs'),{installSceneLifetimeGate}=await import('./tools/bake/inactive-figures.mjs');
   const proof={pixelBytes:10562144,fixedHypothesis:239437856,kind:'small native Post/lifetime prerequisite; actual full-art fixed envelope and whole110 acceptance UNRUN',cases:[],errors:[]};
   const attempt=(rows,label,fn)=>{try{fn();rows.push({label,ok:true});}catch(e){rows.push({label,ok:false,error:String(e?.message??e)});}};
   const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
   for(const bounded of [true,false]){let renderer,post,geometry,material,lifetime,gl,sequence=0;const receipt={bounded,states:[],frames:[],cleanup:[],complete:false};proof.cases.push(receipt);
    try{renderer=new THREE.WebGLRenderer({antialias:false,stencil:false});gl=renderer.getContext();receipt.rendererOnly=window.__allocation.snapshot(gl);post=new Post(renderer,{mode:'high',...(bounded?{diagnosticPixelBytes:proof.pixelBytes}:{})});
     const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
     geometry=new THREE.PlaneGeometry(1,1);material=new THREE.MeshBasicMaterial({color:0x86734c,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);mesh.name='post-resource-plane';scene.add(mesh);
     const scope={__game:{post,scene,game:{baked:{atlases:{}}}},__allocation:window.__allocation};
     const fixedArrays=[...new Set([geometry,post.quad.geometry].flatMap(g=>[...Object.values(g.attributes).map(a=>a.array),g.index.array]))];
     receipt.fixedArrayBytes=fixedArrays.reduce((n,a)=>n+a.byteLength,0);receipt.fixedBuffers=[];receipt.postTextures=[];
     const sample=label=>{for(const a of fixedArrays)for(const r of window.__allocation.bufferReservations(gl,a)){
       if(r.bytes!==a.byteLength)throw Error('Post prerequisite: fixed buffer source bytes differ');
       if(!receipt.fixedBuffers.some(b=>b.id===r.id))receipt.fixedBuffers.push({...r,sourceBytes:a.byteLength});}
      for(const target of [post.rtScene,post.rtSmall,post.rtBlur])for(const texture of [target.texture,target.depthTexture].filter(Boolean)){
       const native=renderer.properties.get(texture).__webglTexture,r=native&&window.__allocation.textureReservation(gl,native);
       if(r&&!receipt.postTextures.includes(r.id))receipt.postTextures.push(r.id);}
      const s={label,sequence:++sequence,...sampleSceneAllocations(scope)};receipt.states.push(s);return s;};
     receipt.attributes=gl.getContextAttributes();receipt.constructor=sample('constructor');
     const draw=()=>{renderer.info.reset();post.render(scene,camera);gl.finish();if(gl.getError()!==0)throw Error('Post prerequisite: native draw failed');};
     const frame=label=>{draw();const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      const r={label,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,pixels:encode(bytes),glError:gl.getError(),drawCalls:renderer.info.render.calls,nonuniform:bytes.some((v,i)=>v!==bytes[i%4])};receipt.frames.push(r);return r;};
     if(bounded){lifetime=installSceneLifetimeGate(scope,{sample,finishEachResize:true,finishLensRetirement:true});receipt.cycles=lifetime.cycles;receipt.admissions=[];
      const admit=label=>{const a=structuredClone(post.resourceAdmission);receipt.admissions.push({label,...a,actualCanvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],targets:[[post.rtScene.width,post.rtScene.height],[post.rtSmall.width,post.rtSmall.height],[post.rtBlur.width,post.rtBlur.height]],requested:post.requestedScale});sample(label);};
      post.setSize(1366,1024);admit('wide');draw();sample('wide-drawn');
      for(let i=0;i<3;i++){post.beginSoldierView(camera,2);draw();sample('lens-'+i);post.endSoldierView();draw();sample('lens-retired-'+i);}
      post.setMode('low');admit('low-wide');post.setSize(320,240);admit('narrow-intermediate');post.setMode('high');admit('narrow-high');
      post.setSize(1366,1024);admit('opposed-growth');post.setMode('auto');post.startFromTier(3);admit('tier');
      post.level=3;post.scale=post.requestedScale=post.levels[3];post._apply();for(let i=0;i<201;i++)post.govern(1/60,i*15);admit('governor');
      post.setMode('high');post.setSize(320,240);post.setSize(320,240);admit('requested-high-recovered');frame('same-resolution');sample('same-resolution-drawn');
      lifetime.restore();receipt.descriptorsRestored=!Object.hasOwn(post,'_apply')&&!Object.hasOwn(post,'beginSoldierView')&&!Object.hasOwn(post,'endSoldierView');
     }else{post.setSize(320,240);frame('same-resolution');sample('same-resolution-drawn');post.setSize(1366,1024);draw();sample('unclamped-wide');}
     receipt.complete=true;
    }catch(e){receipt.primary=String(e?.message??e);proof.errors.push(receipt.primary);}
    finally{if(lifetime)attempt(receipt.cleanup,'lifetime',()=>lifetime.restore());if(post){attempt(receipt.cleanup,'lens',()=>post.endSoldierView());for(const[k,t]of [['scene',post.rtScene],['small',post.rtSmall],['blur',post.rtBlur]])attempt(receipt.cleanup,'target-'+k,()=>t.dispose());
      for(const[k,m]of [['down',post.downMat],['blur',post.blurMat],['final',post.finalMat]])attempt(receipt.cleanup,'material-'+k,()=>m.dispose());attempt(receipt.cleanup,'quad',()=>post.quad.geometry.dispose());}
     if(geometry)attempt(receipt.cleanup,'geometry',()=>geometry.dispose());if(material)attempt(receipt.cleanup,'material',()=>material.dispose());if(renderer)attempt(receipt.cleanup,'renderer',()=>renderer.dispose());if(gl){attempt(receipt.cleanup,'finish',()=>gl.finish());if(post)attempt(receipt.cleanup,'cleanup-observation',()=>{
       const scene=new THREE.Scene(),s={label:'cleanup',sequence:++sequence,...sampleSceneAllocations({__game:{post,scene,game:{baked:{atlases:{}}}},__allocation:window.__allocation})};receipt.states.push(s);});}if(renderer)attempt(receipt.cleanup,'context',()=>renderer.forceContextLoss());}
    receipt.complete=receipt.complete&&!receipt.primary&&receipt.cleanup.every(r=>r.ok);
   }return proof;
  });
  result.postPixelResourceProof=proof;const c=proof.cases.find(r=>r.bounded),original=proof.cases.find(r=>!r.bounded),healthy=s=>s.glError===0&&s.allocation.unknown.length===0&&s.unmappedBufferBytes===0;
  const nativeClean=proof.cases.length===2&&proof.cases.every(r=>r.complete&&r.states.every(healthy)&&r.attributes.antialias===false&&r.attributes.stencil===false&&r.attributes.depth===true);
  const admitted=c?.admissions?.length===8&&c.admissions.every(r=>r.canvas.every(n=>n>0)&&r.intermediate.every(n=>n>0)&&r.actualCanvas.every((n,i)=>n===r.canvas[i])&&r.targets[0].every((n,i)=>n===r.target[i])&&r.lensBytes<=proof.pixelBytes&&r.resizeBytes<=proof.pixelBytes);
  // Three WebGLState creates exactly four 1x1 RGBA8 defaults: 2D, six cube faces, array, 3D.
  // Bind their identities before Post exists; never subtract arbitrary texture allocations.
  const boundedNative=receipt=>{const base=receipt?.rendererOnly,defaults=base?.textureSlots??[],ids=new Set(defaults.map(t=>t.texture));
   const defaultShape=defaults.length===4&&defaults.map(t=>Object.values(t.slots).length).sort((a,b)=>a-b).join(',')==='1,1,1,6'
    &&defaults.every(t=>!t.pendingDelete&&Object.values(t.slots).every(n=>n===4))&&base.byKind.texture===36&&base.byKind.buffer===0&&base.byKind.renderbuffer===0
    &&base.signatures.length===9&&base.signatures.every(s=>ids.has(s.texture)&&s.call==='image'&&s.raw.format===6408&&s.raw.type===5121&&s.canonical.w===1&&s.canonical.h===1&&s.canonical.d===1&&s.canonical.level===0&&s.canonical.bytes===4);
   const buffers=new Map((receipt?.fixedBuffers??[]).map(b=>[b.id,b.sourceBytes])),pixelIds=new Set(receipt?.postTextures??[]);
   const fixed=36+(receipt?.fixedArrayBytes??0),ceiling=proof.pixelBytes+fixed;
   const journal=receipt?.states?.at(-1)?.allocation.nativeEvents??[];
   const nativeSources=journal.every(e=>e.operation!=='reserve'||(e.kind==='buffer'?buffers.get(e.id)===e.bytes
    :e.kind==='texture'?ids.has(e.id)||pixelIds.has(e.id)
    :e.kind==='renderbuffer'?e.detail?.samples===1&&[33189,33190,36012].includes(e.detail.format):false));
   const classified=defaultShape&&nativeSources&&receipt?.fixedArrayBytes===280&&buffers.size===8&&[...buffers.values()].reduce((n,b)=>n+b,0)===280
    &&receipt.states.every(s=>s.allocation.bufferSlots.every(b=>buffers.get(b.id)===b.bytes)
     &&s.allocation.textureSlots.every(t=>ids.has(t.texture)||pixelIds.has(t.texture)));
   return {classified,fixed,ceiling,maxNative:Math.max(base?.gpuPeak??Infinity,...(receipt?.states??[]).map(s=>s.allocation.gpuPeak)),within:classified
    &&base.gpuCurrent<=ceiling&&base.gpuPeak<=ceiling&&receipt.states.every(s=>s.allocation.gpuCurrent<=ceiling&&s.allocation.gpuPeak<=ceiling)};};
  const budget=boundedNative(c);if(c)c.nativeBudget=budget;
  check('post-resource-native-admission',nativeClean&&admitted&&budget.within,JSON.stringify({nativeClean,admitted,budget,errors:proof.errors}));
  check('post-resource-native-requested-quality',c?.admissions?.at(-1)?.requested===2&&c.admissions.at(-1).scale===2&&c.admissions.find(a=>a.label==='governor')?.requested===1.3,JSON.stringify(c?.admissions));
  check('post-resource-native-resize-completion',c?.cycles?.filter(r=>r.kind==='resize').length>=8&&c.cycles.filter(r=>r.kind==='resize').every(r=>r.complete&&r.samples.some(s=>s.label==='resize-default-1-settled')&&r.samples.some(s=>s.label==='resize-default-2-settled')),JSON.stringify(c?.cycles?.map(r=>({kind:r.kind,complete:r.complete,labels:r.samples.map(s=>s.label)}))));
  check('post-resource-native-lens-cycles',c?.cycles?.filter(r=>r.kind==='lens').length===3&&c.cycles.filter(r=>r.kind==='lens').every(r=>r.complete&&r.samples.at(-1)?.label==='lens-retired-settled'&&r.samples.at(-1).observation.allocation.pendingDeleteBytes===0),JSON.stringify(c?.cycles?.filter(r=>r.kind==='lens').map(r=>({complete:r.complete,labels:r.samples.map(s=>s.label)}))));
  const f=c?.frames?.[0],g=original?.frames?.[0];check('post-resource-native-original-pixels',f?.glError===0&&g?.glError===0&&f.nonuniform&&g.nonuniform&&f.drawCalls>0&&g.drawCalls>0&&f.width===g.width&&f.height===g.height&&f.pixels===g.pixels,'whole native RGBA equality at original High320x240; small fixture, painted world unproved');
  check('post-resource-native-unclamped-control',original?.states?.find(s=>s.label==='unclamped-wide')?.allocation.gpuPeak>proof.pixelBytes&&c?.descriptorsRestored===true,'actual uncapped native viewport exceeds the hypothesis; owned descriptors restore');
  let replay=true;for(const receipt of proof.cases){try{const history=createSceneHistory(),compact={history,states:receipt.states.map(s=>compactSceneSample(history,s))};replay&&=isDeepStrictEqual(expandSceneContext(compact).states,receipt.states);receipt.nativeHistory=compact;}catch(e){replay=false;receipt.replayError=String(e?.message??e);}}
  const retiredReceipt=receipt=>{const final=receipt?.states?.at(-1)?.allocation,defaults=new Set((receipt?.rendererOnly?.textureSlots??[]).map(t=>t.texture));
   return final&&Array.isArray(receipt.postTextures)&&receipt.states.at(-1).label==='cleanup'&&final.byKind.buffer===0&&final.byKind.renderbuffer===0&&final.pendingDeleteBytes===0
    &&final.textureSlots.every(t=>defaults.has(t.texture)&&!receipt.postTextures.includes(t.texture)&&!t.pendingDelete&&Object.values(t.slots).every(n=>n===4));};
  const retired=proof.cases.every(retiredReceipt);
  let rejected=false;if(c?.states?.at(-1)?.allocation&&c.postTextures?.length){
   const excess=structuredClone(c);excess.states.at(-1).allocation.gpuPeak=budget.ceiling+1;
   const unknown=structuredClone(c);unknown.states.at(-1).allocation.textureSlots.push({texture:999999,slots:{'3553:0':4}});
   const leaked=structuredClone(c);leaked.states.at(-1).allocation.textureSlots.push({texture:c.postTextures[0],slots:{'3553:0':8}});
   const liveBuffer=structuredClone(c);liveBuffer.states.at(-1).allocation.byKind.buffer=4;
   rejected=!boundedNative(excess).within&&!boundedNative(unknown).within&&!retiredReceipt(leaked)&&!retiredReceipt(liveBuffer);}
  check('post-resource-native-history-cleanup',nativeClean&&replay&&retired&&rejected&&errors.length===0,JSON.stringify({replay,retired,rejected,errors}));
 }finally{await ctx.close();}
}

// Geometry/shader prerequisite with synthetic spatial ground inputs; no painted-art or scene-budget claim.
async function canonicalTerrainControls({browser,url,check,result,watchErrors}){
  const ctx=await browser.newContext({viewport:{width:320,height:240}}),errors=[];let page;
  try{await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
    page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    const proof=await page.evaluate(async()=>{
      const THREE=await import('three'),Martini=(await import('@mapbox/martini')).default,
        {loadTerrainData,buildTerrainMesh}=await import('./src/world/terrain.js'),{makeSun}=await import('./src/world/world.js'),
        {prepareCanonicalTerrain,createCanonicalTerrainMesh,installTerrainPartition,partitionTerrain}=await import('./tools/bake/partition-terrain.mjs'),
        {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
      const proof={cases:[],errors:[],cleanup:[],kind:'actual source terrain geometry/shader with synthetic spatial ground/info; painted art and complete scene budget UNRUN',budgetClaim:false},ownedTextures=new Set();let renderer,scene,gl,scope;
      const attempt=(receipts,name,fn)=>{try{fn();receipts.push({name,ok:true});}catch(e){receipts.push({name,ok:false,error:String(e?.message??e)});}};
      const sample=label=>({label,...sampleSceneAllocations(scope)}),encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
      const texture=(size,info=false)=>{const bytes=new Uint8Array(size*size*4);for(let z=0;z<size;z++)for(let x=0;x<size;x++){const i=(z*size+x)*4;bytes.set(info?[x*255/(size-1),120,(x+z)%256,255]:[40+(x*3+z)%120,70+(z*5+x)%110,30+((x>>3)^(z>>3))*5,255],i);}
        const t=new THREE.DataTexture(bytes,size,size);t.flipY=false;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;ownedTextures.add(t);return t;};
      try{renderer=new THREE.WebGLRenderer({antialias:false});scene=new THREE.Scene();gl=renderer.getContext();renderer.setPixelRatio(1);renderer.setSize(320,240);
        scope={__game:{scene,post:{renderer},game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:320,innerHeight:240,devicePixelRatio:1};const ground=texture(128),info=texture(64,true);
        for(const name of ['henry-hill','shiloh','stones-river','chattanooga','lookout-mountain']){
          const receipt={name,views:[],snapshots:[],cleanup:[],primary:null,complete:false};proof.cases.push(receipt);let old,canonical,material,startup;
          try{const data=await loadTerrainData('./assets/terrain',name);old=buildTerrainMesh(data,ground,info,makeSun());material=old.material;
            for(const u of Object.values(material.uniforms))if(u.value?.isTexture)ownedTextures.add(u.value);
            const {vertices,triangles}=new Martini(data.grid).createTile(data.heights).getMesh(.5),prepared=prepareCanonicalTerrain({grid:data.grid,cell:data.cell,half:data.half,heights:data.heights,vertices,triangles});canonical=createCanonicalTerrainMesh(prepared,THREE,material);
            const originalUniforms={...material.uniforms},originalGeometry=old.geometry,originalAttributes={...old.geometry.attributes},originalIndex=old.geometry.index,originalBox=old.geometry.boundingBox,originalSphere=old.geometry.boundingSphere;
            const camera=new THREE.OrthographicCamera(),center=prepared.bounds.center,first=prepared.chunks[0].gridPosition,keys=new Set();for(let i=0;i<first.length;i+=2)keys.add(first[i]+','+first[i+1]);
            let edge=[first[0],first[1]],shared=false;if(prepared.chunks.length>1){const second=prepared.chunks[1].gridPosition;for(let i=0;i<second.length;i+=2)if(keys.has(second[i]+','+second[i+1])){edge=[second[i],second[i+1]];shared=true;break;}}
            const nearX=edge[0]*data.cell-data.half,nearZ=edge[1]*data.cell-data.half,nearY=data.heightAt(nearX,nearZ);receipt.near={point:[nearX,nearY,nearZ],sharedChunkBoundary:shared};
            const setView=label=>{const near=label==='near',span=near?Math.min(500,data.half*.3):data.half*1.3,look=near?[nearX,nearY,nearZ]:center;
              camera.left=-span*4/3;camera.right=span*4/3;camera.top=span;camera.bottom=-span;camera.near=.1;camera.far=data.half*12+10000;
              camera.up.set(0,0,-1);if(label==='overview')camera.position.set(look[0],prepared.bounds.max[1]+data.half*3,look[2]+.001);
              else{camera.up.set(0,1,0);camera.position.set(look[0]+span*.35,look[1]+span*1.9,look[2]+span*1.35);}camera.lookAt(...look);camera.updateProjectionMatrix();camera.updateMatrixWorld();};
            const draw=label=>{setView(label);renderer.render(scene,camera);gl.finish();const bytes=new Uint8Array(320*240*4);gl.readPixels(0,0,320,240,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
              return {pixels:encode(bytes),drawCalls:renderer.info.render.calls,drawTriangles:renderer.info.render.triangles,nonuniform:bytes.some((b,i)=>i%4<3&&b!==bytes[i%4]),glError:gl.getError()};};
            scene.add(old);for(const label of ['overview','oblique','near'])receipt.views.push({label,original:draw(label)});receipt.snapshots.push(sample('monolithic'));
            const partition=installTerrainPartition({terrainMesh:old},THREE,partitionTerrain,{reversible:true});gl.finish();for(const view of receipt.views)view.partition=draw(view.label);receipt.snapshots.push(sample('old-partition'));partition.restore();gl.finish();
            receipt.restored=old.geometry===originalGeometry&&old.geometry.index===originalIndex&&old.geometry.boundingBox===originalBox&&old.geometry.boundingSphere===originalSphere&&!old.children.length
              &&Object.entries(originalAttributes).every(([key,value])=>old.geometry.attributes[key]===value);
            scene.remove(old);old.geometry.dispose();gl.finish();scene.add(canonical);for(const view of receipt.views)view.canonical=draw(view.label);const native=sample('canonical');receipt.snapshots.push(native);
            const arrays=[];canonical.traverse(o=>{if(o.geometry)for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean))arrays.push(a.array);});
            receipt.fullBuffers=arrays.every(a=>scope.__allocation.bufferReservations(gl,a).some(r=>!r.pendingDelete&&r.bytes===a.byteLength));
            receipt.unchangedTextures=Object.entries(originalUniforms).every(([key,u])=>material.uniforms[key]===u&&canonical.material.uniforms[key]===u);const textureSlots=s=>s.allocation.textureSlots.map(t=>({texture:t.texture,slots:t.slots}));
            receipt.texturesStable=JSON.stringify(textureSlots(receipt.snapshots[1]))===JSON.stringify(textureSlots(native));
            receipt.controls={before:receipt.views[2].canonical};for(const child of canonical.children){const a=child.geometry.attributes.aHeight;for(let i=0;i<a.count;i++)a.array[i]+=75;a.needsUpdate=true;child.frustumCulled=false;}
            receipt.controls.changedHeight=draw('near');for(const child of canonical.children){const g=child.geometry.attributes.aGrid,h=child.geometry.attributes.aHeight;for(let i=0;i<h.count;i++)h.array[i]=data.heights[g.array[i*2+1]*data.grid+g.array[i*2]];h.needsUpdate=true;}
            canonical.material.uniforms.uCanonicalInverse.value*=.5;receipt.controls.changedUV=draw('near');canonical.material.uniforms.uCanonicalInverse.value*=2;receipt.controls.repaired=draw('near');receipt.snapshots.push(sample('after-controls'));
            // Separate diagnostic startup baseline: never allocate the original position/UV/index render backing.
            const direct={views:[],snapshots:[],controls:{}};receipt.startup=direct;let shell,sourceVertices,sourceTriangles,shellDisposals=0;
            startup=buildTerrainMesh(data,ground,info,makeSun(),{meshFactory:input=>{
              shell=input.material;sourceVertices=input.vertices;sourceTriangles=input.triangles;shell.addEventListener('dispose',()=>shellDisposals++);
              for(const key of ['uNormal','uNoise'])ownedTextures.add(shell.uniforms[key].value);
              return createCanonicalTerrainMesh(prepareCanonicalTerrain({grid:data.grid,cell:data.cell,half:data.half,heights:data.heights,vertices:input.vertices,triangles:input.triangles}),THREE,shell);
            }});
            const ownGeometry=startup.geometry,ownMaterial=startup.material,ownChildren=[...startup.children],ownCulling=startup.children.map(c=>c.frustumCulled),ownArrays=[];
            startup.traverse(o=>{for(const a of [...Object.values(o.geometry.attributes),o.geometry.index].filter(Boolean))ownArrays.push(a.array);});
            direct.identity={ownMaterial:ownMaterial!==shell,shellDisposals,emptyRoot:Object.keys(ownGeometry.attributes).length===0&&ownGeometry.index===null,
              noSourceBacking:ownArrays.every(a=>a!==sourceVertices&&a!==sourceTriangles&&a!==data.heights),bytes:ownArrays.reduce((n,a)=>n+a.byteLength,0),
              textures:['uGround','uInfo','uNormal','uNoise'].every(k=>ownMaterial.uniforms[k]===shell.uniforms[k])};
            direct.snapshots.push(sample('before-startup'));scene.remove(canonical);
            // Retire the comparison mesh before mapping the independent startup baseline.
            // Otherwise its detached native buffers would be honestly reported as unmapped.
            canonical.traverse(o=>o.geometry.dispose());gl.finish();scene.add(startup);
            for(const view of receipt.views)direct.views.push({label:view.label,original:view.original,startup:draw(view.label)});
            direct.snapshots.push(sample('startup'));direct.fullBuffers=ownArrays.every(a=>scope.__allocation.bufferReservations(gl,a).some(r=>!r.pendingDelete&&r.bytes===a.byteLength));
            direct.controls.before=direct.views[2].startup;
            for(const child of startup.children){const a=child.geometry.attributes.aHeight;for(let i=0;i<a.count;i++)a.array[i]+=75;a.needsUpdate=true;child.frustumCulled=false;}
            direct.controls.changedHeight=draw('near');
            for(const child of startup.children){const g=child.geometry.attributes.aGrid,h=child.geometry.attributes.aHeight;for(let i=0;i<h.count;i++)h.array[i]=data.heights[g.array[i*2+1]*data.grid+g.array[i*2]];h.needsUpdate=true;}
            ownMaterial.uniforms.uCanonicalInverse.value*=.5;direct.controls.changedUV=draw('near');ownMaterial.uniforms.uCanonicalInverse.value*=2;ownChildren.forEach((child,i)=>{child.frustumCulled=ownCulling[i];});direct.controls.repaired=draw('near');
            direct.restored=startup.geometry===ownGeometry&&startup.material===ownMaterial&&startup.children.length===ownChildren.length&&ownChildren.every((child,i)=>startup.children[i]===child&&child.frustumCulled===ownCulling[i])
              &&['uGround','uInfo','uNormal','uNoise'].every(k=>ownMaterial.uniforms[k]===shell.uniforms[k]);
            direct.snapshots.push(sample('startup-repaired'));
            Object.assign(receipt,{grid:data.grid,triangles:prepared.triangles,chunks:prepared.chunks.length,bytes:prepared.bytes,precision:gl.getShaderPrecisionFormat(gl.VERTEX_SHADER,gl.HIGH_FLOAT).precision,complete:true});
          }catch(error){receipt.primary=String(error?.message??error);}
          finally{if(old)attempt(receipt.cleanup,'detach-original',()=>scene.remove(old));if(canonical)attempt(receipt.cleanup,'detach-canonical',()=>scene.remove(canonical));if(startup)attempt(receipt.cleanup,'detach-startup',()=>scene.remove(startup));
            const geometries=new Set();for(const root of [old,canonical,startup].filter(Boolean))root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});for(const [i,g]of [...geometries].entries())attempt(receipt.cleanup,'geometry-'+i,()=>g.dispose());
            for(const [i,m]of [old?.material,canonical?.material,startup?.material].filter(Boolean).entries())attempt(receipt.cleanup,'material-'+i,()=>m.dispose());
            for(const key of ['uNormal','uNoise']){const t=material?.uniforms[key]?.value;if(t)attempt(receipt.cleanup,key,()=>{t.dispose();ownedTextures.delete(t);});}
            for(const key of ['uNormal','uNoise']){const t=startup?.material?.uniforms[key]?.value;if(t)attempt(receipt.cleanup,'startup-'+key,()=>{t.dispose();ownedTextures.delete(t);});}
            attempt(receipt.cleanup,'finish',()=>gl.finish());attempt(receipt.cleanup,'cleanup-observation',()=>receipt.snapshots.push(sample('cleanup')));}
          receipt.complete=receipt.complete&&!receipt.primary&&receipt.cleanup.every(r=>r.ok);if(!receipt.complete)break;
        }
      }catch(error){proof.errors.push(String(error?.message??error));}
      finally{for(const [i,t]of [...ownedTextures].entries())attempt(proof.cleanup,'remaining-texture-'+i,()=>t.dispose());if(renderer)attempt(proof.cleanup,'renderer',()=>renderer.dispose());if(gl)attempt(proof.cleanup,'finish',()=>gl.finish());if(renderer)attempt(proof.cleanup,'context',()=>renderer.forceContextLoss());}
      return proof;
    });
    result.canonicalTerrainProof=proof;
    const healthy=p=>p&&p.drawCalls>0&&p.drawTriangles>0&&p.nonuniform&&p.glError===0;
    for(const c of proof.cases){const equal=c.views.length===3&&c.views.every(v=>v.original&&v.partition&&v.canonical&&v.original.pixels===v.partition.pixels&&v.original.pixels===v.canonical.pixels),pixels=c.views.every(v=>[v.original,v.partition,v.canonical].every(healthy));
      check('canonical-terrain-'+c.name,c.complete&&equal&&pixels&&c.precision>=23&&c.restored&&c.fullBuffers&&c.unchangedTextures&&c.texturesStable&&(c.chunks===1||c.near?.sharedChunkBoundary===true)
        &&c.snapshots.length===5&&c.snapshots.every(s=>s.glError===0&&s.allocation.unknown.length===0&&s.unmappedBufferBytes===0)
        &&[c.controls?.changedHeight,c.controls?.changedUV,c.controls?.repaired].every(healthy)
        &&c.controls.changedHeight.pixels!==c.controls.before.pixels&&c.controls.changedUV.pixels!==c.controls.before.pixels&&c.controls.repaired.pixels===c.controls.before.pixels,
        JSON.stringify({equal,pixels,restored:c.restored,fullBuffers:c.fullBuffers,texturesStable:c.texturesStable,primary:c.primary,cleanup:c.cleanup}));}
    for(const c of proof.cases){const d=c.startup;
      check('canonical-startup-'+c.name,c.complete&&d?.views.length===3&&d.views.every(v=>healthy(v.original)&&healthy(v.startup)&&v.original.pixels===v.startup.pixels)
        &&d.identity?.ownMaterial&&d.identity.shellDisposals===1&&d.identity.emptyRoot&&d.identity.noSourceBacking&&d.identity.textures&&d.identity.bytes===c.bytes&&d.fullBuffers&&d.restored
        &&d.snapshots.length===3&&d.snapshots.every(s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0)
        &&[d.controls?.changedHeight,d.controls?.changedUV,d.controls?.repaired].every(healthy)&&d.controls.changedHeight.pixels!==d.controls.before.pixels
        &&d.controls.changedUV.pixels!==d.controls.before.pixels&&d.controls.repaired.pixels===d.controls.before.pixels,
        JSON.stringify({identity:d?.identity,restored:d?.restored,fullBuffers:d?.fullBuffers,primary:c.primary}));}
    check('canonical-terrain-errors',errors.length===0&&proof.errors.length===0&&proof.cleanup.every(r=>r.ok)&&proof.cases.length===5,errors.concat(proof.errors).join('; '));
  }finally{await ctx.close();}
}


// Actual small native retirement/admission proof; no whole-scene cap or adoption claim.
async function sceneLifetimeControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:64,height:64}});let page;const errors=[];
 try{
 await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
 page=await ctx.newPage();watchErrors(page,url,errors);
  await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const report=await page.evaluate(async()=>{
   const THREE=await import('three'),{Post}=await import('./src/render/post.js'),
    {installSceneLifetimeGate,installRenderGate}=await import('./tools/bake/inactive-figures.mjs'),
    {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs'),
    {partitionTerrain,installTerrainPartition}=await import('./tools/bake/partition-terrain.mjs');
   const renderer=new THREE.WebGLRenderer({antialias:false}),post=new Post(renderer,{mode:'high'}),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
   post.setSize(32,32);camera.position.z=2;post.beginSoldierView(camera,2);
   const geometry=new THREE.PlaneGeometry(1,1);geometry.deleteAttribute('normal');geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const material=new THREE.MeshBasicMaterial({color:0x86734c,side:THREE.DoubleSide}),root=new THREE.Mesh(geometry,material);root.name='lifetime-native-terrain';scene.add(root);
   const scope={__game:{post,scene,game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:32,innerHeight:32,devicePixelRatio:1},gl=renderer.getContext(),samples=[],rows=[];
   const sample=label=>{const r={label,...sampleSceneAllocations(scope)};samples.push(r);return r;},gate=installRenderGate(post),draw=()=>gate.renderOnce(scene,camera);
   const pixels=()=>{const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
   const native=post._apply,descriptor=Object.getOwnPropertyDescriptor(post,'_apply'),size=Object.getOwnPropertyDescriptor(renderer,'setSize'),savedDepth=post.soldierView.depth,sourceArrays=[geometry.attributes.position,geometry.attributes.uv,geometry.index],sourceBytes=sourceArrays.map(a=>Array.from(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength)));
   const receipt={rows,samples,cleanup:[],primary:null,kind:'small native storage lifetime fixture; full110 budget and fielding UNRUN'},same=(a,b)=>['value','get','set','writable','enumerable','configurable'].every(k=>a?.[k]===b?.[k]);
   let lifetime,terrain;
   try{
    draw();gl.finish();const original=sample('lifetime-original');
    const bindings=()=>[post.rtScene.texture,post.rtSmall.texture,post.rtBlur.texture,savedDepth].map(t=>({uuid:t.uuid,...scope.__allocation.textureReservation(gl,renderer.properties.get(t).__webglTexture)})),ownedBefore=bindings();receipt.ownedBefore=ownedBefore;
    if(ownedBefore.some(r=>!Number.isSafeInteger(r.id)||r.bytes<=0)||new Set(ownedBefore.map(r=>r.id)).size!==4)throw Error('lifetime native: exact Post texture pointers unbound');
    lifetime=installSceneLifetimeGate(scope,{sample});receipt.resizeCycles=lifetime.cycles;post.setSize(48,48);scope.innerWidth=scope.innerHeight=48;
    const cycle=lifetime.cycles[0],retired=cycle.samples.find(r=>r.label==='resize-retired')?.observation,settled=cycle.samples.find(r=>r.label==='resize-retired-settled')?.observation;
    const oldTextures=ownedBefore.map(r=>r.id),oldRenderbuffers=original.allocation.renderbufferSlots.map(r=>r.id),unrelated=original.allocation.textureSlots.filter(r=>!oldTextures.includes(r.texture));
    rows.push({name:'native-target-retirement',ok:cycle.complete&&retired?.allocation.pendingDeleteBytes>0&&settled?.allocation.pendingDeleteBytes===0
      &&oldTextures.length>=4&&oldTextures.every(id=>retired.allocation.textureSlots.some(r=>r.texture===id&&r.pendingDelete)&&!settled.allocation.textureSlots.some(r=>r.texture===id))
      &&oldRenderbuffers.every(id=>retired.allocation.renderbufferSlots.some(r=>r.id===id&&r.pendingDelete)&&!settled.allocation.renderbufferSlots.some(r=>r.id===id))});
    draw();gl.finish();const replacement=sample('lifetime-replacement'),candidate=pixels(),ownedAfter=bindings();receipt.ownedAfter=ownedAfter;
    rows.push({name:'native-target-reupload',ok:ownedAfter.length===4&&ownedAfter.every(r=>Number.isSafeInteger(r.id)&&!oldTextures.includes(r.id)&&!r.pendingDelete&&r.bytes>0)&&post.soldierView.depth===savedDepth&&post.rtScene.depthTexture===savedDepth});
    rows.push({name:'native-unrelated-preserved',ok:unrelated.length>0&&unrelated.every(r=>replacement.allocation.textureSlots.some(n=>n.texture===r.texture&&!n.pendingDelete&&JSON.stringify(n.slots)===JSON.stringify(r.slots)))});
    rows.push({name:'native-canvas-calls',ok:cycle.samples.filter(r=>/^resize-default-\d+$/.test(r.label)).length===2&&Object.getOwnPropertyDescriptor(renderer,'setSize').value===size.value
      &&cycle.checks.length===4&&cycle.checks.every(r=>!r.lost&&r.error===0)});
    // Identical final dimensions, camera, shader and source pixels through the original native route.
    lifetime.restore();post.setSize(32,32);draw();gl.finish();post.setSize(48,48);draw();gl.finish();sample('lifetime-native-control');const control=pixels();
    rows.push({name:'native-render-identical',ok:control.length===candidate.length&&control.every((b,i)=>b===candidate[i])&&candidate.some((b,i)=>i%4<3&&b!==candidate[i%4])&&candidate.every((b,i)=>i%4!==3||b===255)&&gl.getError()===0});
    rows.push({name:'native-descriptors',ok:post._apply===native&&same(Object.getOwnPropertyDescriptor(post,'_apply'),descriptor)});
    lifetime=installSceneLifetimeGate(scope,{sample});receipt.terrainCycles=lifetime.cycles;terrain=installTerrainPartition({terrainMesh:root},THREE,a=>partitionTerrain(a,3),{reversible:true});scope.__sceneTerrainPartition=terrain;draw();gl.finish();const partitioned=sample('lifetime-partitioned'),chunkIds=partitioned.bufferOwnership.filter(r=>r.owners.some(o=>o.includes('terrain-chunk-'))).map(r=>r.id);
    lifetime.completeTerrainRetirement(()=>terrain.restore());const terrainCycle=lifetime.cycles[0],pending=terrainCycle.samples.find(r=>r.label==='terrain-retired')?.observation,complete=terrainCycle.samples.find(r=>r.label==='terrain-retired-settled')?.observation;
    rows.push({name:'native-terrain-retirement',ok:terrainCycle.complete&&chunkIds.length===6&&chunkIds.every(id=>pending.bufferOwnership.some(r=>r.id===id&&r.pendingDelete)&&!complete.bufferOwnership.some(r=>r.id===id))});
    draw();gl.finish();const restored=sample('lifetime-original-reupload');
    rows.push({name:'native-retained-cpu',ok:partitioned.retainedTerrainArrayBytes===sourceArrays.reduce((n,a)=>n+a.array.byteLength,0)
      &&partitioned.declaredArrayBytes-original.declaredArrayBytes===terrain.bytes&&restored.retainedTerrainArrayBytes===0&&terrain.retainedArrays.length===3});
    rows.push({name:'native-terrain-exact',ok:root.geometry===geometry&&!root.children.length&&sourceArrays.every(a=>scope.__allocation.bufferReservations(gl,a.array).some(r=>!r.pendingDelete&&r.bytes===a.array.byteLength))
      &&JSON.stringify(sourceArrays.map(a=>Array.from(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength))))===JSON.stringify(sourceBytes)
      &&restored.bufferOwnership.every(r=>!chunkIds.includes(r.id))&&pixels().every((b,i)=>b===control[i])});
    receipt.resizeCycle=cycle;receipt.terrainCycle=terrainCycle;
   }catch(error){receipt.primary=String(error?.message??error);}
   finally{
    const failures=[];for(const cleanup of [()=>lifetime?.restore(),()=>terrain?.restore(),()=>gate.restore(),()=>window.__allocation?.restore(),()=>post.endSoldierView(),()=>geometry.dispose(),()=>material.dispose(),()=>{for(const t of [post.rtScene,post.rtSmall,post.rtBlur])t.dispose();},()=>renderer.dispose(),()=>renderer.forceContextLoss()])try{cleanup();}catch(e){failures.push(e.message);}
    receipt.cleanup=failures;
   }
   receipt.cycles=lifetime?.cycles||[];return receipt;
  });
  result.sceneLifetime=report;
  check('scene-lifetime-complete',!report.primary&&report.cleanup.length===0&&report.rows.length===9,JSON.stringify({primary:report.primary,cleanup:report.cleanup}));
  check('scene-lifetime-accounting',report.samples.length>0&&report.samples.every(s=>s.glError===0&&s.allocation.unknown.length===0&&s.unmappedBufferBytes===0),'all retained samples, including pending lifetimes');for(const row of report.rows)check('scene-lifetime-'+row.name,row.ok,JSON.stringify(report.rows));
  check('scene-lifetime-errors',errors.length===0,errors.join('; '));
 }finally{await ctx.close();}
}

// One actual current-PNG battle is a prerequisite proof, not the qualified 22+88 matrix.
async function sceneStressOwnerControls({browser,url,check,result,watchErrors,mode='full'}){
  const ctx=await browser.newContext({viewport:{width:320,height:240},deviceScaleFactor:1,reducedMotion:'no-preference'});
  await ctx.addInitScript(source=>{window.__sceneStartNative={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};window.__sceneStartGate=(0,eval)('('+source+')')();},installSceneStartGate.toString());
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()});
  const page=await ctx.newPage(),errors=[];let primaryFailure;watchErrors(page,url,errors);
  try{
    await page.goto(url+'?battle=henry-hill&quality=high&figures=rigged&nosw');
    await page.waitForFunction(()=>window.__ready&&window.__game?.game&&window.__game.effects?.ok,null,{timeout:180000});
    if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
    await page.evaluate(()=>{const g=window.__game.game;if(!g.paused)g.togglePause();g.ensureBaked();});
    await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000});
    const preload=await page.evaluate(async()=>{
      const {deriveSceneStressContract,warmSceneStressBaseline,runSceneStressTransaction,installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs'),
        {sampleSceneAllocations,initializeSceneTextures}=await import('./tools/bake/scene-allocation.mjs'),{COMMAND}=await import('./src/game.js');
      const scope=window.__game,{game,post,scene,camera}=scope,expected=deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}});
      const zero=()=>Object.values(game.baked.atlases).every(a=>!a.state.close&&!a.textures.close&&a.pools.every(p=>p.batches.close.length===0));
      if(!zero())throw Error('native preclose stress: premature close load');
      const gate=installRenderGate(post);window.__sceneRenderGate=gate;let restoration;
      const restore=()=>{gate.restore();if(window.__sceneRenderGate!==gate)throw Error('native preclose render gate ownership changed');delete window.__sceneRenderGate;return {ok:true,allocationRetained:!!window.__allocation};};
      try{
        const warm=warmSceneStressBaseline(scope,expected,COMMAND.radius,'preclose'),roster=JSON.stringify(game.units.map(u=>({id:u.id,men:u.men,x:u.x,z:u.z})));initializeSceneTextures();
        const proof=runSceneStressTransaction({discovery:warm.discovery,draw:()=>gate.renderOnce(scene,camera),sample:()=>sampleSceneAllocations(),
          verifyBaseline:()=>zero()&&game.simTime===0&&roster===JSON.stringify(game.units.map(u=>({id:u.id,men:u.men,x:u.x,z:u.z}))),reservations:array=>window.__allocation.bufferReservations(post.renderer.getContext(),array)});
        restoration=restore();
        const clean=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
        return {proof,restoration,zero:zero(),ok:proof.ok&&restoration.ok&&restoration.allocationRetained&&zero()
          &&proof.transaction.samples.every(s=>clean(s.observation))&&proof.native.every(s=>s.owners.every(o=>!o.label.includes('.close.')))&&proof.smoke.particles===800};
      }finally{if(!restoration)restore();}
    });
    if(!preload.ok)throw Error('native preclose maximum or restoration incomplete');
    const loading=await page.evaluate(async mode=>{
      const {US,CS}=window.__game.game.baked.atlases;
      if(mode==='terminal'){
        const pool=CS.pools[0],prior=Object.getOwnPropertyDescriptor(pool,'prepareTier'),native=pool.prepareTier;let fired=0,uploaded=0;
        const wrapped=function(tier,...args){if(tier==='close'&&!fired++){
          const renderer=window.__game.post.renderer,gl=renderer.getContext(),textures=args[1];
          if(textures.length!==5)throw Error('native terminal prepare: expected five baseline textures');
          for(const texture of textures){renderer.initTexture(texture);if(!renderer.properties.get(texture).__webglTexture||gl.getError())throw Error('native terminal prepare: upload not proved');uploaded++;}
          throw Error('diagnostic current-PNG terminal prepare');
        }return native.call(this,tier,...args);};
        Object.defineProperty(pool,'prepareTier',{value:wrapped,writable:true,configurable:true});
        window.__sceneTerminalPrepareRestore=()=>{if(pool.prepareTier!==wrapped)throw Error('native terminal prepare ownership changed');if(prior)Object.defineProperty(pool,'prepareTier',prior);else delete pool.prepareTier;delete window.__sceneTerminalPrepareRestore;};
        const pending=CS.load('close'),cached=pending===CS.state.close,settled=await Promise.allSettled([US.load('close'),pending]);
        if(fired!==1||uploaded!==5||!cached||CS.load('close')!==pending||settled[0].status!=='fulfilled'||settled[1].status!=='rejected'
          ||settled[1].reason?.message!=='diagnostic current-PNG terminal prepare'||CS.textures.close||CS.pools.some(p=>p.batches.close.length))throw Error('native terminal load shape not proved');
        window.__sceneTerminalPrepareRestore();return {fired,uploaded,cached,rejected:true,USLoaded:US.loaded('close'),CSLoaded:CS.loaded('close')};
      }
      await Promise.all([US.load('close'),CS.load('close')]);return {rejected:false,USLoaded:US.loaded('close'),CSLoaded:CS.loaded('close')};
    },mode);
    const report=await page.evaluate(async({mode,preload,loading})=>{
      const {deriveSceneStressContract,warmSceneStressBaseline,runSceneStressTransaction,installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs'),
        {sampleSceneAllocations,initializeSceneTextures}=await import('./tools/bake/scene-allocation.mjs'),{COMMAND}=await import('./src/game.js');
      const scope=window.__game,{game,scene,camera,post,effects}=scope;
      const startup=window.__sceneStartGate.first;if(game.simTime!==0||!game.paused||startup?.simTime!==0)throw Error('native scene startup: time zero required');
      const combat=()=>JSON.stringify({time:game.simTime,orders:game.orders,holder:game.holder,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order,x:u.x,z:u.z}))});
      const expected=deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}}),gate=installRenderGate(post);window.__sceneRenderGate=gate;
      let restoration;
      try{
        const warm=warmSceneStressBaseline(scope,expected,COMMAND.radius,mode),baseline=combat();initializeSceneTextures();
        const proof=runSceneStressTransaction({discovery:warm.discovery,draw:()=>gate.renderOnce(scene,camera),sample:()=>sampleSceneAllocations(),
          verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(post.renderer.getContext(),array)});
        restoration=restoreSceneDiagnostics(window,{sampleRestored(){gate.renderOnce(scene,camera);const pending={label:'restored-native-pending',...sampleSceneAllocations()};post.renderer.getContext().finish();return [pending,{label:'restored-native-settled',...sampleSceneAllocations()}];}});
        window.__sceneStartGate.restore();const prior=window.__sceneStartNative,after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'),startRestored=window.requestAnimationFrame===prior.native
          &&['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]);
        const samples=[...proof.transaction.samples.map(s=>s.observation),...restoration.samples],clean=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
        return {kind:'actual current-PNG Henry Hill warmed maximum prerequisite; full qualified both-route matrix UNRUN',mode,preload,loading,expected,spawned:warm.spawned,baseline:warm.baseline,
          proof,restoration,startup,startRestored,combatUnchanged:combat()===baseline,clean:samples.every(clean),rows:[
            {name:'stress-owner-preclose',ok:preload.ok&&preload.zero&&preload.proof.mode==='preclose'},
            {name:'stress-owner-start-gate',ok:startup.simTime===0&&startRestored&&game.simTime===0&&game.paused},
            {name:'stress-owner-coverage',ok:proof.ok&&proof.native.length===3&&proof.native.every(s=>s.owners.length===warm.discovery.owners.length)
              &&loading.USLoaded&&(mode==='full'?loading.CSLoaded:loading.rejected&&!loading.CSLoaded&&proof.native.every(s=>s.owners.some(o=>o.label.startsWith('baked.US.close.'))&&!s.owners.some(o=>o.label.startsWith('baked.CS.close.'))))},
            {name:'stress-owner-smoke',ok:proof.smoke.systems===200&&proof.smoke.particles===800&&proof.smoke.capacity===1000},
            {name:'stress-owner-restoration',ok:proof.ok&&restoration.ok&&combat()===baseline&&samples.every(clean)},
          ]};
      }finally{try{window.__sceneStartGate.restore();}finally{if(!restoration){const r=restoreSceneDiagnostics(window);if(!r.ok)throw Error('native stress cleanup: '+r.errors.join('; '));}}}
    },{mode,preload,loading});
    result[mode==='full'?'sceneStressOwners':'sceneTerminalStressOwners']=report;for(const row of report.rows)check(`scene-allocation-${mode==='terminal'?'terminal-':''}${row.name}`,row.ok,JSON.stringify(report));
    check(`scene-allocation-${mode==='terminal'?'terminal-':''}stress-owner-errors`,errors.length===0,errors.join('; '));
  }catch(error){primaryFailure=error;throw error;}finally{
    let cleanupError;
    try{
        result[mode==='full'?'sceneStressStartupCleanup':'sceneTerminalStressStartupCleanup']=await page.evaluate(source=>{
        const errors=[];try{window.__sceneTerminalPrepareRestore?.();}catch(e){errors.push(e.message);}
        try{const r=(0,eval)('('+source+')')(window);if(!r.ok)errors.push(...r.errors);}catch(e){errors.push(e.message);}
        const gate=window.__sceneStartGate,prior=window.__sceneStartNative;
        try{if(!gate||!prior)throw Error('native scene startup cleanup: owner missing');gate.restore();}catch(e){errors.push(e.message);}
        const after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'),ok=window.requestAnimationFrame===prior.native
          &&['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]);
        if(!ok)errors.push('native scene startup cleanup: descriptor changed');if(errors.length)throw Error(errors.join('; '));return {ok:true,first:gate.first};
      },restoreSceneDiagnostics.toString());
    }catch(error){cleanupError=error;result[mode==='full'?'sceneStressStartupCleanup':'sceneTerminalStressStartupCleanup']={ok:false,error:error.message,primaryFailure:primaryFailure?.message||null};}
    finally{await ctx.close();}
    if(cleanupError&&!primaryFailure)throw cleanupError;
  }
}

// getBufferSubData intentionally synchronizes this tiny correctness fixture only.
// Never place it in the scene matrix's no-finish failure-overlap observation hooks.
async function sceneTransactionControls({browser,url,check,result,watchErrors}){
  const ctx=await browser.newContext({viewport:{width:320,height:240}});
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()});
  const page=await ctx.newPage(),errors=[];watchErrors(page,url,errors);
  try{
    await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    const report=await page.evaluate(async()=>{
      const THREE=await import('three'),{runSceneAllocationTransaction,installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs'),
        {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
      const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(32,32);
      const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
      const geometry=new THREE.PlaneGeometry(.2,.2);geometry.deleteAttribute('normal');geometry.deleteAttribute('uv');
      const data=new THREE.InstancedInterleavedBuffer(new Float32Array([.2,.3,.4,0,0,0,.4,.3,.2,0,0,0]),6),
        tint=new THREE.InterleavedBufferAttribute(data,3,0),shift=new THREE.InterleavedBufferAttribute(data,3,3);
      geometry.setAttribute('iTint',tint);geometry.setAttribute('iShift',shift);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=new THREE.ShaderMaterial({vertexShader:'attribute vec3 iTint; attribute vec3 iShift; varying vec3 colour; void main(){colour=iTint;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position+iShift*.001,1.0);}',fragmentShader:'varying vec3 colour; void main(){gl_FragColor=vec4(colour,1.0);}'});
      const mesh=new THREE.InstancedMesh(geometry,material,2),parent=new THREE.Group();parent.add(mesh);scene.add(parent);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);data.setUsage(THREE.DynamicDrawUsage);
      const matrix=new THREE.Matrix4();mesh.setMatrixAt(0,matrix.makeTranslation(-.2,0,0));mesh.setMatrixAt(1,matrix.makeTranslation(.2,0,0));
      mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.frustumCulled=false;
      const arrays=[mesh.instanceMatrix.array,data.array],bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength),original=arrays.map(a=>Array.from(bytes(a))),
        gl=renderer.getContext(),buffers=new Map(),descriptor=Object.getOwnPropertyDescriptor(gl,'bufferData'),native=gl.bufferData;
      const wrapped=function(...args){const value=native.apply(this,args);if(arrays.includes(args[1]))buffers.set(args[1],this.getParameter(this.ARRAY_BUFFER_BINDING));return value;};
      Object.defineProperty(gl,'bufferData',{value:wrapped,writable:descriptor?.writable??true,enumerable:descriptor?.enumerable??false,configurable:descriptor?.configurable??true});
      const post={renderer,render(s,c){renderer.render(s,c);}},gate=installRenderGate(post),scope={__game:{scene,post,game:{baked:{atlases:{}}}},__sceneRenderGate:gate,__allocation:window.__allocation,innerWidth:32,innerHeight:32,devicePixelRatio:1};
      const draw=()=>gate.renderOnce(scene,camera),sample=()=>sampleSceneAllocations(scope);
      const read=a=>{
        const buffer=buffers.get(a),prior=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);
        try{
          if(!buffer||!gl.isBuffer(buffer))throw Error('actual native buffer required');gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);
          if(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE)!==a.byteLength)throw Error('native full-array byte length required');
          const out=new Uint8Array(a.byteLength);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,out);return Array.from(out);
        }finally{gl.bindBuffer(gl.COPY_READ_BUFFER,prior);}
      };
      const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),captures=[];let cleanup;
      try{
        draw();const warmed=sample(),nativeOriginal=arrays.map(read);
        parent.visible=mesh.visible=false;mesh.count=0;mesh.frustumCulled=true;
        mesh.instanceMatrix.addUpdateRange(0,1);data.addUpdateRange(0,1);
        const ranges=[mesh.instanceMatrix,data].map(a=>({array:a.updateRanges,entry:a.updateRanges[0]})),refs={geometry,material,matrix:mesh.instanceMatrix,data,tint,shift};
        const transaction=skipUpload=>{
          const observed={stress:false,stressBytes:null,upload:false,fullRange:false};
          const r=runSceneAllocationTransaction({meshes:[mesh],attributes:[mesh.instanceMatrix,tint,shift],records:[],
            mutate(){
              mesh.setMatrixAt(0,matrix.makeScale(.7,.8,.9));mesh.setMatrixAt(1,matrix.makeTranslation(.5,.6,.1));
              data.array.fill(.7);mesh.instanceMatrix.clearUpdateRanges();data.clearUpdateRanges();mesh.instanceMatrix.needsUpdate=true;data.needsUpdate=true;
              parent.visible=mesh.visible=true;mesh.count=2;mesh.frustumCulled=false;
            },render(label){
              if(label==='restore-upload'){
                observed.fullRange=mesh.instanceMatrix.updateRanges.length===0&&data.updateRanges.length===0;
                if(!skipUpload){parent.visible=mesh.visible=true;mesh.count=0;mesh.frustumCulled=false;draw();}
                observed.upload=equal(arrays.map(read),original);
              }else{draw();if(label==='stress'){observed.stressBytes=arrays.map(read);observed.stress=!equal(observed.stressBytes,original)&&equal(observed.stressBytes,arrays.map(a=>Array.from(bytes(a))));}}
            },sample(label){const s=sample();captures.push({label,skipUpload,...s});return s;},
            verifyBaseline(){return !parent.visible&&!mesh.visible&&mesh.count===0&&mesh.frustumCulled;},
          });
          return {result:r,observed,nativeFinal:arrays.map(read),cpuFinal:arrays.map(a=>Array.from(bytes(a)))};
        };
        const positive=transaction(false),negative=transaction(true),negativeRejected=negative.result.ok&&negative.observed.stress&&equal(negative.cpuFinal,original)&&equal(negative.nativeFinal,negative.observed.stressBytes)&&!equal(negative.nativeFinal,original)&&!negative.observed.upload;
        // Repair the deliberately omitted native upload before cleanup; preserve original range objects.
        for(const a of [mesh.instanceMatrix,data]){a.clearUpdateRanges();a.needsUpdate=true;}
        parent.visible=mesh.visible=true;mesh.count=0;mesh.frustumCulled=false;draw();const repaired=arrays.map(read);
        parent.visible=mesh.visible=false;mesh.count=0;mesh.frustumCulled=true;
        [mesh.instanceMatrix,data].forEach((a,i)=>{a.clearUpdateRanges();a.updateRanges.push(ranges[i].entry);});
        captures.push({label:'repaired',...sample()});
        const reservations=arrays.map(a=>scope.__allocation.bufferReservations(gl,a)),clean=s=>!s.glError&&!s.allocation.unknown.length&&!s.unmappedBufferBytes;
        const identities=mesh.geometry===refs.geometry&&mesh.material===refs.material&&mesh.instanceMatrix===refs.matrix&&tint.data===refs.data&&shift.data===refs.data
          &&geometry.attributes.iTint===refs.tint&&geometry.attributes.iShift===refs.shift&&[mesh.instanceMatrix,data].every((a,i)=>a.updateRanges===ranges[i].array&&a.updateRanges[0]===ranges[i].entry);
        cleanup=restoreSceneDiagnostics(scope);
        return {kind:'small actual native hidden-buffer transaction; whole-pool coverage UNRUN',positive,negative,negativeRejected,original,nativeOriginal,repaired,reservations,
          distinctNativeBuffers:buffers.get(arrays[0])!==buffers.get(arrays[1]),identities,clean:warmed&&clean(warmed)&&captures.every(clean),cleanup,
          rows:[
            {name:'transaction-bytes',ok:positive.result.ok&&equal(nativeOriginal,original)&&equal(positive.nativeFinal,original)&&equal(positive.cpuFinal,original)&&equal(repaired,original)},
            {name:'transaction-native-upload',ok:positive.observed.stress&&positive.observed.fullRange&&positive.observed.upload&&negativeRejected&&reservations.every((r,i)=>r.length===1&&r[0].bytes===arrays[i].byteLength)&&buffers.get(arrays[0])!==buffers.get(arrays[1])},
            {name:'transaction-state',ok:identities&&!parent.visible&&!mesh.visible&&mesh.count===0&&mesh.frustumCulled&&cleanup.ok&&clean(warmed)&&captures.every(clean)},
          ],captures};
      }finally{
        const failures=[],attempt=fn=>{try{fn();}catch(e){failures.push(e.message);}};
        attempt(()=>{if(Object.getOwnPropertyDescriptor(gl,'bufferData')?.value!==wrapped)throw Error('native fixture buffer wrapper ownership changed');
          if(descriptor)Object.defineProperty(gl,'bufferData',descriptor);else delete gl.bufferData;});
        if(!cleanup)attempt(()=>{const r=restoreSceneDiagnostics(scope);if(!r.ok)throw Error(r.errors.join('; '));});
        for(const release of [()=>geometry.dispose(),()=>material.dispose(),()=>renderer.dispose(),()=>renderer.forceContextLoss()])attempt(release);
        if(failures.length)throw Error('native transaction cleanup: '+failures.join('; '));
      }
    });
    result.sceneTransaction=report;
    for(const row of report.rows)check(`scene-allocation-${row.name}`,row.ok,JSON.stringify(report));
    check('scene-allocation-transaction-errors',errors.length===0,errors.join('; '));
  }finally{await ctx.close();}
}

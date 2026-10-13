// Actions-only native lifecycle proof; this small fixture is not a whole-battle budget measurement.
import {isDeepStrictEqual} from 'node:util';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,createSceneHistory,compactSceneSample,expandSceneContext} from './bake/scene-allocation.mjs';
import {installSceneStartGate} from './bake/inactive-figures.mjs';

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
  await sceneTransactionControls({browser,url,check,result,watchErrors});
  await sceneStressOwnerControls({browser,url,check,result,watchErrors});
}

// One actual current-PNG battle is a prerequisite proof, not the qualified 22+88 matrix.
async function sceneStressOwnerControls({browser,url,check,result,watchErrors}){
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
    await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
    const report=await page.evaluate(async()=>{
      const {deriveSceneStressContract,warmSceneStressBaseline,runSceneStressTransaction,installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs'),
        {sampleSceneAllocations,initializeSceneTextures}=await import('./tools/bake/scene-allocation.mjs'),{COMMAND}=await import('./src/game.js');
      const scope=window.__game,{game,scene,camera,post,effects}=scope;
      const startup=window.__sceneStartGate.first;if(game.simTime!==0||!game.paused||startup?.simTime!==0)throw Error('native scene startup: time zero required');
      const combat=()=>JSON.stringify({time:game.simTime,orders:game.orders,holder:game.holder,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order,x:u.x,z:u.z}))});
      const expected=deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}}),gate=installRenderGate(post);window.__sceneRenderGate=gate;
      let restoration;
      try{
        const warm=warmSceneStressBaseline(scope,expected,COMMAND.radius),baseline=combat();initializeSceneTextures();
        const proof=runSceneStressTransaction({discovery:warm.discovery,draw:()=>gate.renderOnce(scene,camera),sample:()=>sampleSceneAllocations(),
          verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(post.renderer.getContext(),array)});
        restoration=restoreSceneDiagnostics(window,{sampleRestored(){gate.renderOnce(scene,camera);const pending={label:'restored-native-pending',...sampleSceneAllocations()};post.renderer.getContext().finish();return [pending,{label:'restored-native-settled',...sampleSceneAllocations()}];}});
        window.__sceneStartGate.restore();const prior=window.__sceneStartNative,after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'),startRestored=window.requestAnimationFrame===prior.native
          &&['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]);
        const samples=[...proof.transaction.samples.map(s=>s.observation),...restoration.samples],clean=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
        return {kind:'actual current-PNG Henry Hill warmed maximum prerequisite; full qualified both-route matrix UNRUN',expected,spawned:warm.spawned,baseline:warm.baseline,
          proof,restoration,startup,startRestored,combatUnchanged:combat()===baseline,clean:samples.every(clean),rows:[
            {name:'stress-owner-start-gate',ok:startup.simTime===0&&startRestored&&game.simTime===0&&game.paused},
            {name:'stress-owner-coverage',ok:proof.ok&&proof.native.length===3&&proof.native.every(s=>s.owners.length===warm.discovery.owners.length)},
            {name:'stress-owner-smoke',ok:proof.smoke.systems===200&&proof.smoke.particles===800&&proof.smoke.capacity===1000},
            {name:'stress-owner-restoration',ok:proof.ok&&restoration.ok&&combat()===baseline&&samples.every(clean)},
          ]};
      }finally{try{window.__sceneStartGate.restore();}finally{if(!restoration){const r=restoreSceneDiagnostics(window);if(!r.ok)throw Error('native stress cleanup: '+r.errors.join('; '));}}}
    });
    result.sceneStressOwners=report;for(const row of report.rows)check(`scene-allocation-${row.name}`,row.ok,JSON.stringify(report));
    check('scene-allocation-stress-owner-errors',errors.length===0,errors.join('; '));
  }catch(error){primaryFailure=error;throw error;}finally{
    let cleanupError;
    try{
      result.sceneStressStartupCleanup=await page.evaluate(()=>{
        const gate=window.__sceneStartGate,prior=window.__sceneStartNative;
        if(!gate||!prior)throw Error('native scene startup cleanup: owner missing');gate.restore();
        const after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame'),ok=window.requestAnimationFrame===prior.native
          &&['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]);
        if(!ok)throw Error('native scene startup cleanup: descriptor changed');return {ok:true,first:gate.first};
      });
    }catch(error){cleanupError=error;result.sceneStressStartupCleanup={ok:false,error:error.message,primaryFailure:primaryFailure?.message||null};}
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

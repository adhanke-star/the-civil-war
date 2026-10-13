// Actions-only observation of current whole-scene allocations. No renderer/atlas policy is adopted by this tool.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { failPaintedComparison, collectPaintedIsolation, AllocationLedger, mipSizes, installAllocationObserver, ReservationPeak, rejectionObservation, reduceSceneObservations, reduceFocusedLookoutObservations, reduceFocusedFloat32LookoutObservations, sampleSceneAllocations, initializeSceneTextures,sceneMatrixContract,createSceneHistory,compactSceneSample,sceneReportEnvelope,scenePartHeader,createSceneMatrixMerger } from './scene-allocation.mjs';
import {installInactiveFigures,installRenderGate,renderCanvasPng,restoreSceneDiagnostics,installSceneStartGate} from './inactive-figures.mjs';
import {acquireQualifiedHybrid,materializeQualifiedSceneInput,QUALIFIED_HYBRID,installQualifiedSceneRoutes,sceneMatrixGroups} from './review-current-compression.mjs';
import {preparePhase,prepareFieldScenario} from '../../src/sim/phase.js';
import {PNG} from 'pngjs';
import {partitionTerrain,installTerrainPartition,registerTerrainPartition} from './partition-terrain.mjs';

const inventory=sampleSceneAllocations;
// Explicit runner-only bootstrap. The real document/DOM/import map remain intact;
// only its one entry module is suppressed before the unmodified field caller runs.
async function focusedSceneBootstrap(ctx,page,url,entry){
  const original=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),marker='<script type="module" src="./src/entry.js"></script>';
  if(original.split(marker).length!==2)throw Error('focused scene: unique entry module required');
  const served=original.replace(marker,'<!-- focused diagnostic: field entry invoked explicitly -->'),hash=s=>createHash('sha256').update(s).digest('hex');
  const target=`${url}?battle=${entry.packId}&phase=${entry.phaseId}&quality=high&figures=rigged&nosw`,requests=[];
  const handler=async route=>{const request=route.request();if(request.method()!=='GET'||request.resourceType()!=='document')throw Error('focused scene: document GET required');
    requests.push({url:request.url(),method:request.method(),originalSha256:hash(original),servedSha256:hash(served),removedEntryModules:1});
    await route.fulfill({status:200,contentType:'text/html',body:served,headers:{'Cache-Control':'no-store'}});};
  await ctx.route(target,handler);await page.goto(target);
  await page.evaluate(async()=>{
    const THREE=await import('three'),I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs'),M=await import('./src/main.js');
    const owner={samples:[],postTextures:[],postRenderbuffers:[],serial:0,clock:0,bootstrapDraws:0},textureIds=new Set(),bufferIds=new Set();window.__focusedScene=owner;
    owner.sample=(label,sequence=null)=>{
      const post=window.__game?.post||owner.post,renderer=post.renderer,gl=renderer.getContext(),shell={__game:{post,scene:owner.emptyScene,game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth,innerHeight,devicePixelRatio};
      const live=window.__game&&owner.originalProof?{__game:window.__game,__allocation:window.__allocation,innerWidth,innerHeight,devicePixelRatio,
        __sceneTerrainPartition:{retainedArrays:[...(window.__sceneTerrainPartition?.retainedArrays||[]),...owner.originalProof.retainedArrays,...(owner.controlArrays||[])]}}:window.__game?window:shell;
      const serial=++owner.serial,sample={label:`focused-${serial}-${label}`,captureId:serial,sequence:sequence??++owner.clock,...A.sampleSceneAllocations(live)};
      if(owner.originalProof)sample.float32Original=owner.originalProof.receipt();
      for(const [key,target]of ['rtScene','rtSmall','rtBlur'].map(k=>[k,post[k]])){
        for(const [kind,texture]of [['color',target.texture],['depth',target.depthTexture]]){if(!texture)continue;
          const native=renderer.properties.get(texture).__webglTexture,record=native&&window.__allocation.textureReservation(gl,native);
          if(record&&!textureIds.has(record.id)){textureIds.add(record.id);owner.postTextures.push({key,kind,uuid:texture.uuid,...record});}}
        const depth=renderer.properties.get(target).__webglDepthbuffer;
        for(const native of Array.isArray(depth)?depth:[depth]){if(!native)continue;const record=window.__allocation.renderbufferReservation(gl,native);
          if(record&&!bufferIds.has(record.id)){bufferIds.add(record.id);owner.postRenderbuffers.push({key,...record});}}
      }
      sample.focusedPixel={admission:post.resourceAdmission?structuredClone(post.resourceAdmission):null,
        targets:[post.rtScene,post.rtSmall,post.rtBlur].map(t=>[t.width,t.height]),canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],
        textureIds:[...textureIds],renderbufferIds:[...bufferIds]};
      owner.samples.push(sample);return sample;
    };
    document.getElementById('battle').hidden=false;
    await M.startField({diagnosticPost:{pixelBytes:3639218,prepare({post}){
      owner.post=post;owner.emptyScene=new THREE.Scene();window.__sceneRenderGate=I.installRenderGate(post);
      owner.lifetime=I.installSceneLifetimeGate({post},{sample:owner.sample,finishEachResize:true,finishLensRetirement:true});owner.sample('startup-before-fullsize');
    }}});
    owner.bootstrapDraws=window.__sceneRenderGate.count;if(owner.bootstrapDraws!==0)throw Error('focused scene: native world draw escaped startup gate');
  });
  if(requests.length!==1)throw Error('focused scene: one original document receipt required');
  return {requests,async restore(){await ctx.unroute(target,handler);}};
}

async function focusedCanonicalInstall(page){
  return page.evaluate(async()=>{
    const THREE=await import('three'),Martini=(await import('@mapbox/martini')).default,P=await import('./tools/bake/partition-terrain.mjs'),f=window.__focusedScene,{world,terrain}=window.__game;
    if(!f.prepared){const {vertices,triangles}=new Martini(terrain.grid).createTile(terrain.heights).getMesh(.5);
      f.prepared=P.prepareCanonicalTerrain({grid:terrain.grid,cell:terrain.cell,half:terrain.half,heights:terrain.heights,vertices,triangles});
      const root=world.terrainMesh;if(!f.original)f.original={root,geometry:root.geometry,material:root.material,position:root.geometry.attributes.position,uv:root.geometry.attributes.uv,index:root.geometry.index};}
    const owner=P.installCanonicalTerrain(world,THREE,f.prepared,{completeRetirement:retire=>{f.lifetime.completeTerrainRetirement(retire);}});
    P.registerTerrainPartition(window,owner);f.sample('canonical-source-retired');const gl=window.__game.post.renderer.getContext();if(gl.isContextLost()||gl.getError())throw Error('focused scene: source retirement refused');
    gl.finish();f.sample('canonical-source-settled');f.owner=owner;
    return {kind:owner.kind,triangles:owner.triangles,chunks:owner.chunks,sourceBytes:owner.sourceBytes,bytes:owner.bytes};
  });
}

async function focusedFloat32Install(page){
  return page.evaluate(async()=>{
    const THREE=await import('three'),P=await import('./tools/bake/partition-terrain.mjs'),f=window.__focusedScene,{world,post}=window.__game,root=world.terrainMesh,gl=post.renderer.getContext();
    if(Object.hasOwn(window,'__sceneTerrainPartition'))throw Error('Float32 scene: diagnostic registration already owned');
    if(!f.originalProof){f.originalProof=P.captureFloat32TerrainOriginal(world);f.original={root,geometry:root.geometry,material:root.material,position:root.geometry.attributes.position,uv:root.geometry.attributes.uv,index:root.geometry.index};f.terrainRetirements=[];}
    f.originalProof.verify();
    const retire=(operation,callback)=>{
      const meshes=operation==='install-original'?[root]:[...root.children],arrays=meshes.flatMap((m,i)=>[...Object.entries(m.geometry.attributes),['index',m.geometry.index]].map(([key,a])=>({mesh:i,key,arrayType:a.array.constructor.name,itemSize:a.itemSize,count:a.count,bytes:a.array.byteLength,reservations:window.__allocation.bufferReservations(gl,a.array)})));
      const receipt={operation,nativeFrame:post.renderer.info.render.frame,nativeRenders:window.__sceneRenderGate.count,arrays,original:f.originalProof.receipt(),cycleIndex:f.lifetime.cycles.length+1};f.terrainRetirements.push(receipt);
      return f.lifetime.completeTerrainRetirement(callback);
    };
    let owner;
    retire('install-original',()=>{owner=P.installTerrainPartition(world,THREE,P.partitionTerrain,{reversible:true});f.rawOwner=owner;
      const wrapped={...owner,kind:'Float32 with retained exact original',get retainedArrays(){return owner.retainedArrays;},restore(){
        const errors=[];try{f.originalProof.verify();}catch(e){errors.push(e);}
        try{retire('restore-partition',()=>owner.restore());}catch(e){errors.push(e);try{owner.restore();}catch(cleanup){errors.push(cleanup);}}
        try{f.originalProof.verify();}catch(e){errors.push(e);}
        if(errors.length)throw new AggregateError(errors,'Float32 original: checked restoration failed');
      }};
      try{f.owner=wrapped;P.registerTerrainPartition(window,wrapped);}catch(error){const errors=[error];try{owner.restore();}catch(cleanup){errors.push(cleanup);}throw new AggregateError(errors,'Float32 scene: registration failed with independent rollback');}
    });
    f.originalProof.verify();f.sample('float32-source-settled');
    return {kind:f.owner.kind,triangles:owner.triangles,chunks:owner.chunks,sourceBytes:owner.sourceBytes,bytes:owner.bytes,materialShared:owner.materialShared};
  });
}

async function focusedSceneCleanup(page){
  return page.evaluate(()=>{const f=window.__focusedScene;if(!f)return {ok:false,errors:['focused owner missing'],samples:[]};const errors=[];
    // The common restore has already retired canonical storage, drawn the original,
    // and restored allocation hooks. Descriptor cleanup is independent of that result.
    try{f.lifetime?.restore();}catch(e){errors.push(String(e?.message??e));}
    const o=f.original,root=window.__game?.world?.terrainMesh;
    const exactOriginal=!!o&&root===o.root&&root.geometry===o.geometry&&root.material===o.material&&root.children.length===0&&root.geometry.attributes.position===o.position&&root.geometry.attributes.uv===o.uv&&root.geometry.index===o.index;
    if(!exactOriginal)errors.push('focused original terrain identities not restored');
    if(f.isolationClone)errors.push('painted isolation cloned material cleanup incomplete');
    let originalProof;if(f.originalProof){try{originalProof=f.originalProof.receipt();if(exactOriginal&&!errors.length)f.originalProof.release();}catch(e){errors.push(String(e?.message??e));}}
    return {ok:!errors.length,errors,exactOriginal,bootstrapDraws:f.bootstrapDraws,pixelBytes:f.post?.diagnosticPixelBytes,preparedReleased:f.prepared==null,terrain:f.owner&&{kind:f.owner.kind,bytes:f.owner.bytes,sourceBytes:f.owner.sourceBytes,...(f.originalProof?{triangles:f.owner.triangles,chunks:f.owner.chunks,materialShared:f.owner.materialShared}:{})},
      ...(f.originalProof?{originalProof,originalProofReleased:f.originalProof.released,terrainRetirements:f.terrainRetirements}:{}),
      postTextures:f.postTextures,postRenderbuffers:f.postRenderbuffers,samples:f.samples,cycles:(f.lifetime?.cycles||[]).map(c=>({kind:c.kind,index:c.index,complete:c.complete,errors:c.errors,checks:c.checks,sampleLabels:c.samples.map(s=>s.observation.label),sampleIds:c.samples.map(s=>s.observation.captureId)}))};
  });
}

function compactFocusedContext(row){
  const all=[...row.states,...(row.restoration?.samples||[]),...(row.stress?.transaction?.samples||[]).map(s=>s.observation)],mapped=new Map();
  all.sort((a,b)=>a.sequence-b.sequence);
  for(const raw of all)if(!mapped.has(raw))mapped.set(raw,compactSceneSample(row.history,raw));
  row.states=row.states.map(s=>mapped.get(s));if(row.restoration)row.restoration.samples=row.restoration.samples.map(s=>mapped.get(s));
  if(row.stress)row.stress.transaction.samples=row.stress.transaction.samples.map(s=>({...s,observation:mapped.get(s.observation)}));
}

function appendFocusedSamples(row,resource){
  const bound=new Set([...row.states,...(row.restoration?.samples||[]),...(row.stress?.transaction?.samples||[]).map(s=>s.observation)].map(s=>s.captureId));
  for(const sample of resource.samples)if(!bound.has(sample.captureId)){row.states.push(sample);bound.add(sample.captureId);}delete resource.samples;
}
async function qualifiedFaultContext({browser,url,tuple,input,transport,source,phases,report,save,focused=false,float32=false}){
  const row={...tuple,contextId:`${tuple.packId}/${tuple.phaseId}/${tuple.route}/${tuple.fault}`,states:[],errors:[],history:createSceneHistory(),
    scenario:phases.find(p=>p.packId===tuple.packId&&p.phaseId===tuple.phaseId).scenario,complete:false,contextClosed:false};report.faults.push(row);
  const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,reducedMotion:'no-preference'});let page,routes,primary,faultHTTPHandler,bootstrap;
  const target='cs-close-base-0-astc.ktx2',baselineURL=new URL('assets/figures/confederate-infantry/soldier_close_0.png',url).href,
    candidateURL=new URL('/__scene-qualified/'+target,url).href,expected404=tuple.fault==='candidate-http'?candidateURL:tuple.fault.endsWith('terminal')?baselineURL:null,
    httpReceipts=[],expectedErrors=[];
  const compact=raw=>compactSceneSample(row.history,raw);
  try{
    await ctx.addInitScript(installAllocationObserver,source);
    await ctx.addInitScript(source=>{window.__sceneStartNative={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};window.__sceneStartGate=(0,eval)('('+source+')')();},installSceneStartGate.toString());
    routes=await installQualifiedSceneRoutes(ctx,new URL(url).origin,transport.files);
    if(expected404){faultHTTPHandler=async route=>{httpReceipts.push({url:route.request().url(),method:route.request().method(),status:404});await route.fulfill({status:404,body:'diagnostic missing page',headers:{'Cache-Control':'no-store'}});};await ctx.route(expected404,faultHTTPHandler);}
    page=await ctx.newPage();page.on('pageerror',e=>row.errors.push(e.message));
    page.on('console',m=>{if(m.type()!=='error')return;const receipt={text:m.text(),url:m.location().url};if(receipt.url===expected404&&/Failed to load resource.*404/.test(receipt.text))expectedErrors.push(receipt);else row.errors.push(receipt.text);});
    page.on('response',r=>{if(r.status()>=400&&r.url()!==expected404)row.errors.push(`HTTP ${r.status()} ${r.url()}`);});
    if(focused)bootstrap=await focusedSceneBootstrap(ctx,page,url,tuple);
    else await page.goto(`${url}?battle=${tuple.packId}&phase=${tuple.phaseId}&quality=high&figures=rigged&nosw`);
    await page.waitForFunction(()=>window.__ready&&window.__game?.game&&window.__game.effects?.ok,null,{timeout:180000,polling:250});
    if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
    await page.evaluate(async()=>{const S=await import('./src/settings.js'),{LOOK}=await import('./src/ui/look.js');window.__qualifiedSettings={values:S.all().map(({key,value,locked})=>({key,value,locked})),look:JSON.stringify(LOOK)};window.__game.game.ensureBaked();});
    await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
    if(focused){await page.evaluate(async()=>{const I=await import('./tools/bake/inactive-figures.mjs');const g=window.__game.game;g.__inactiveStats=I.installInactiveFigures(g);g.animate(0);});if(float32)row.partition=await focusedFloat32Install(page);else row.canonical=await focusedCanonicalInstall(page);}
    const admitted=await page.evaluate(async({manifest,sourceManifest,base,tuple,target,completionBeforeFallback,focused})=>{
      const I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs'),P=await import('./tools/bake/partition-terrain.mjs'),THREE=await import('three'),{COMMAND}=await import('./src/game.js'),
        scope=window.__game,{game,post,scene,camera,effects,world}=scope,gl=post.renderer.getContext(),atlas=game.baked.atlases.CS;
      if(game.simTime!==0||!game.paused||window.__sceneStartGate.first?.simTime!==0)throw Error('qualified fault: native time-zero startup required');
      const states=[],events=[],logicalIds=new Map(),hooks=[];let sequence=0,candidateRequests=0,baselineRequests=0,firstBaseline=false,held=false,released=false,resolveHeld,
        candidateRejected=0,candidateSettled=0,targetUUID,nativeFired=false,prepareFired=false;
      const emit=(operation,data={})=>{sequence=focused?++window.__focusedScene.clock:sequence+1;const e={sequence,operation,...data};events.push(e);return e;};
      const take=(label,data={},event)=>{sequence=event?.sequence??(focused?++window.__focusedScene.clock:sequence+1);const s={...(focused?window.__focusedScene.sample(label,sequence):A.sampleSceneAllocations()),label,...data,sequence};states.push(s);return s;};
      const id=uuid=>{if(!logicalIds.has(uuid))logicalIds.set(uuid,logicalIds.size+1);return logicalIds.get(uuid);};
      const heldPage=tuple.fault==='rejection-delayed-astc'?'cs-close-base-1-astc.ktx2':tuple.fault==='rejection-delayed-png'?'cs-close-base-4-original.png':null;
      const heldPromise=heldPage?new Promise(resolve=>{resolveHeld=resolve;}):null;
      const release=emergency=>{if(heldPage&&!released&&(held||emergency)){released=true;if(held)emit('sibling-released',{page:heldPage,emergency:!!emergency});resolveHeld();}};
      const maybeRelease=()=>{if(held&&!released&&candidateSettled===9){emit('held-check',{published:!!atlas.textures.close,baselineRequests,nonHeldSettled:candidateSettled,rejectionCount:candidateRejected});release(false);}};
      const wrap=(object,key,factory)=>{const prior=Object.getOwnPropertyDescriptor(object,key),native=object[key];if(prior&&(!('value'in prior)||!prior.writable))throw Error('qualified fault: unwritable hook '+key);
        const wrapped=factory(native);Object.defineProperty(object,key,{value:wrapped,writable:true,configurable:true,enumerable:prior?.enumerable??false});hooks.push({object,key,prior,wrapped});};
      const closeState=()=>{const p={currentSingleBaseBound:atlas.layout.tiers.close.looks.length===1};for(const[side,a]of Object.entries(game.baked.atlases))p[side]={fieldReady:a.loaded('field'),closePromise:!!a.state.close,closeTextures:!!a.textures.close,closeBatches:a.pools.reduce((n,p)=>n+p.batches.close.length,0),closeRequests:side==='CS'?candidateRequests+baselineRequests:0};return p;};
      const before=closeState(),baselineCloseJSON=JSON.stringify(atlas.layout.tiers.close),configurationOwner=I.configureSceneCloseRoute(scope,{manifest,sourceManifest,base,route:tuple.route,candidateRequests:()=>candidateRequests,completionBeforeFallback});
      const configuration={fieldUnchanged:configurationOwner.fieldUnchanged(),baseUnchanged:configurationOwner.fieldUnchanged(),nativeUSLoading:!game.baked.atlases.US.diagnosticClose,
        genuineCapability:tuple.route==='capable'&&configurationOwner.nativeCapability,maskedOnlyAstc:tuple.route==='unsupported'};
      // Registration precedes every mutation/load that can fail; final cleanup can settle all siblings.
      const owner={states,events,configurationOwner,baselineCloseJSON,release,closeState,get sequence(){return sequence;},take,
        async restore(){release(true);await Promise.allSettled(Object.values(game.baked.atlases).map(a=>a.state.close).filter(Boolean));const errors=[];
          for(const {object,key,prior,wrapped}of hooks.reverse()){try{if(object[key]!==wrapped)throw Error('hook ownership changed '+key);if(prior)Object.defineProperty(object,key,prior);else delete object[key];}catch(e){errors.push(e.message);}}return {ok:errors.length===0,errors};},
        snapshot(){return {states,events,candidateRequests,poolCount:atlas.pools.length,...(this.stress?{stress:this.stress}:{})};}};window.__qualifiedFault=owner;
      const gate=focused?window.__sceneRenderGate:I.installRenderGate(post);window.__sceneRenderGate=gate;
      gate.renderOnce(scene,camera);take(focused?'canonical-native-bind':'prepartition-native-bind'); // Bind actual source arrays and retain every native peak.
      if(!focused){const terrain=P.installTerrainPartition(world,THREE,P.partitionTerrain,{reversible:true});P.registerTerrainPartition(window,terrain);game.__inactiveStats=I.installInactiveFigures(game);}game.animate(0);
      const expected=I.deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}}),combat=()=>JSON.stringify({time:game.simTime,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,order:u.order,x:u.x,z:u.z}))}),
        roster=()=>game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}));
      const runStress=(mode,preload=false)=>{const warm=I.warmSceneStressBaseline(scope,expected,COMMAND.radius,mode),baseline=combat();A.initializeSceneTextures();
        const stress=I.runSceneStressTransaction({discovery:warm.discovery,draw:()=>gate.renderOnce(scene,camera),sample:label=>{
          for(const owner of warm.discovery.owners)for(const array of owner.arrays)window.__allocation.labelBufferOwners(gl,array,[owner.label]);
          return preload?take('preclose-'+label):focused?window.__focusedScene.sample(label):{label,...A.sampleSceneAllocations(),sequence:++sequence};
        },verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(gl,array)});
        return {stress,warm,baseline,combatUnchanged:combat()===baseline};};
      const warmed=runStress('preclose',true),preload={...warmed.stress,transaction:{...warmed.stress.transaction},sampleSequences:warmed.stress.transaction.samples.map(s=>s.observation.sequence),
        baseline:warmed.warm.baseline,retainedRoster:roster(),combatUnchanged:warmed.combatUnchanged,before,after:closeState()};delete preload.transaction.samples;
      if(!warmed.stress.ok||!warmed.combatUnchanged)throw Error('qualified fault: preload native stress failed');
      const observeClose=e=>{
        const operation=e.attempt+'-'+(e.operation==='uploaded'?'upload':e.operation==='dispose-result'?'dispose':e.operation),data={page:e.page,encoding:e.encoding,index:e.index};
        if(e.textureUUID)data.textureId=id(e.textureUUID);if(e.outcome)data.outcome=e.outcome;if(e.ok!==undefined)data.ok=e.ok;if(e.error)data.error=e.error;
        if(e.method)data.method=e.method;if(e.elapsedMs!==undefined)data.elapsedMs=e.elapsedMs;
        if(e.attempt==='candidate'&&e.operation==='created'&&e.page===target)targetUUID=e.textureUUID;
        if(e.attempt==='baseline'&&e.operation==='uploaded'){const event=emit('baseline-upload',{...data,beforeSample:true});take('baseline-upload',{page:e.page},event);}
        else if(e.attempt==='candidate'&&['completion-start','completion-result'].includes(e.operation)){const event=emit(operation,data);take(e.operation==='completion-start'?'candidate-completion-before':'candidate-completion-after',{},event);}
        else emit(operation,data);
        if(e.attempt==='candidate'&&e.operation==='settled'){candidateSettled++;if(e.outcome==='rejected')candidateRejected++;maybeRelease();}
      };
      const nativeFetch=fetch,nativePNG=url=>new THREE.TextureLoader().loadAsync(url);
      wrap(atlas,'io',()=>({
        observeClose,async fetch(input){const page=String(input).slice(base.length);candidateRequests++;emit('candidate-request',{page});const response=await nativeFetch(input);
          if(page===heldPage){held=true;emit('sibling-held',{page,encoding:'astc4x4'});maybeRelease();await heldPromise;}
          if(page===target&&tuple.fault==='candidate-http'){if(response.status!==404)throw Error('qualified fault: actual HTTP404 missing');emit('fault-fired',{fault:tuple.fault,page,actualHTTP:true,status:response.status});}
          if(page===target&&(tuple.fault==='malformed-candidate'||tuple.fault.startsWith('rejection-delayed-'))){const bytes=new Uint8Array(await response.arrayBuffer());bytes[0]^=255;emit('fault-fired',{fault:tuple.fault,page});return new Response(bytes,{status:response.status,headers:response.headers});}
          return response;
        },async loadPNG(input){const candidate=String(input).startsWith(base),page=candidate?String(input).slice(base.length):String(input).split('/').at(-1);
          if(candidate){candidateRequests++;emit('candidate-request',{page});const texture=await nativePNG(input);if(page===heldPage){held=true;emit('sibling-held',{page,encoding:'png'});maybeRelease();await heldPromise;}return texture;}
          baselineRequests++;if(!firstBaseline){firstBaseline=true;const event=emit('first-baseline-request',{beforeNativeLoader:true});take('first-baseline-request',{},event);}
          try{return await nativePNG(input);}catch(error){if(tuple.route==='unsupported'&&page==='soldier_close_0.png')emit('fault-fired',{fault:tuple.fault,page});else if(tuple.fault==='candidate-then-baseline-terminal'&&page==='soldier_close_0.png')emit('baseline-terminal-fired',{page});throw error;}
        }
      }));
      if(['first-pool-prepare','candidate-then-baseline-terminal'].includes(tuple.fault))wrap(atlas.pools[0],'prepareTier',native=>function(tier,...args){
        if(tier==='close'&&!prepareFired){prepareFired=true;emit('first-pool-prepare-rejected');emit('fault-fired',{fault:tuple.fault});throw Error('qualified diagnostic candidate first-pool prepare');}return native.call(this,tier,...args);
      });
      if(tuple.fault==='native-upload'){
        wrap(gl,'getError',native=>function(...args){const error=native.apply(this,args);if(error===0x0501&&nativeFired){if(!events.some(e=>e.operation==='fault-fired'))emit('fault-fired',{fault:tuple.fault,page:target,native:true,glError:error});}return error;});
        wrap(post.renderer,'initTexture',native=>function(texture,...args){const result=native.call(this,texture,...args);if(texture.uuid===targetUUID&&!nativeFired){
          const real=this.properties.get(texture).__webglTexture;if(!gl.isTexture(real))throw Error('qualified fault: real candidate upload missing');
          const active=gl.getParameter(gl.ACTIVE_TEXTURE),binding=gl.getParameter(gl.TEXTURE_BINDING_2D),ext=gl.getExtension('WEBGL_compressed_texture_astc');nativeFired=true;
          try{gl.bindTexture(gl.TEXTURE_2D,real);gl.compressedTexSubImage2D(gl.TEXTURE_2D,0,-4,0,4,4,ext.COMPRESSED_RGBA_ASTC_4x4_KHR,new Uint8Array(16));}
          finally{gl.bindTexture(gl.TEXTURE_2D,binding);gl.activeTexture(active);}
        }return result;});
      }
      take('fault-start');return {preclose:before,configuration,preload,capacityContract:expected,scenario:game.scenario};
    },{manifest:input.manifest,sourceManifest:input.source,base:routes.base,tuple,target,completionBeforeFallback:report.fallbackCompletion==='native-finish-after-candidate-disposal',focused});
    if(JSON.stringify(admitted.scenario)!==JSON.stringify(row.scenario))throw Error('qualified fault: live authored scenario mismatch');Object.assign(row,admitted);
    const outcome=await page.evaluate(async tuple=>{
      const {game,post,scene,camera}=window.__game,owner=window.__qualifiedFault,CS=game.baked.atlases.CS,pending=CS.load('close'),US=game.baked.atlases.US,
        settled=await Promise.allSettled([US.load('close'),pending]),terminal=tuple.fault.endsWith('terminal'),rejected=settled[1].status==='rejected';
      if(settled[0].status!=='fulfilled'||rejected!==terminal||CS.state.close!==pending||CS.load('close')!==pending)throw Error('qualified fault: unexpected loader outcome or cache');
      owner.take(terminal?'terminal-rejected-pending':'fallback-published-pending');
      const I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs'),{COMMAND}=await import('./src/game.js'),scope=window.__game,
        expected=I.deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}}),combat=()=>JSON.stringify({time:game.simTime,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,order:u.order,x:u.x,z:u.z}))});
      const warm=I.warmSceneStressBaseline(scope,expected,COMMAND.radius,terminal?'terminal':'full'),baseline=combat();
      // US ordinary PNG close uploads and all latent buffers overlap the retained candidate deletes.
      A.initializeSceneTextures();const gl=post.renderer.getContext();
      const stress=I.runSceneStressTransaction({discovery:warm.discovery,draw:()=>window.__sceneRenderGate.renderOnce(scene,camera),sample:label=>{
        for(const o of warm.discovery.owners)for(const array of o.arrays)window.__allocation.labelBufferOwners(gl,array,[o.label]);
        return owner.take('postoutcome-'+label);
      },verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(gl,array)});
      // Nested stress samples alone own postoutcome observations in the transport.
      owner.stress=stress; // Cleanup retains them even if the final native finish/sample throws.
      const observations=new Set(stress.transaction.samples.map(s=>s.observation));owner.states.splice(0,owner.states.length,...owner.states.filter(s=>!observations.has(s)));
      gl.finish();owner.take(terminal?'terminal-settled':'fallback-settled');
      const baselineCreated=owner.events.filter(e=>e.operation==='baseline-created'),baselineDisposed=owner.events.filter(e=>e.operation==='baseline-dispose'&&e.ok);
      return {...owner.snapshot(),stress,outcome:{rejected,published:!!CS.textures.close,cachedClosePromise:CS.state.close===pending,fieldUnchanged:owner.configurationOwner.fieldUnchanged(),baselinePages:CS.textures.close?.length||0,
        poolPages:CS.pools.map(p=>p.batches.close.length),exactCurrentSingleBase:JSON.stringify(CS.layout.tiers.close)===owner.baselineCloseJSON&&CS.textures.close?.length===5,
        baselineSiblingsDisposed:baselineCreated.every(c=>baselineDisposed.some(d=>d.textureId===c.textureId))}};
    },tuple);Object.assign(row,outcome);
    if(!row.stress.ok||row.errors.length||expected404&&httpReceipts.length!==1)throw Error('qualified fault: incomplete native stress or HTTP/error receipts');row.complete=true;
  }catch(error){primary=error;row.failure=error.message;throw error;}finally{
    try{
      if(page){
        const cleanup=await page.evaluate(async()=>{
          const owner=window.__qualifiedFault,errors=[],attempt=async(fn,label)=>{try{const r=await fn();if(!r||r.ok!==true)throw Error(r?.errors?.join('; ')||'owner missing');return r;}catch(e){errors.push(label+': '+e.message);return {ok:false,errors:[e.message]};}};
          owner?.release(true);const configuration=await attempt(()=>owner?.configurationOwner.restore(),'configuration'),hooks=await attempt(()=>owner?.restore(),'hooks');
          const settings=await attempt(async()=>{const S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js'),{LOOK}=await import('./src/ui/look.js'),prior=window.__qualifiedSettings;C.stopCompare();for(const {key,value,locked}of prior.values){S.unlock(key);S.set(key,value);if(locked)S.lock(key);}Object.assign(LOOK,JSON.parse(prior.look));window.__game.game.animate(0);
            if(JSON.stringify(S.all().map(({key,value,locked})=>({key,value,locked})))!==JSON.stringify(prior.values)||JSON.stringify(LOOK)!==prior.look)throw Error('fault settings restore mismatch');return {ok:true};},'settings');
          const I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs');let restoration;
          try{restoration=I.restoreSceneDiagnostics(window,{sampleRestored:()=>{const {post,scene,camera}=window.__game;if(window.__focusedScene&&!window.__sceneTerrainPartition)window.__focusedScene.prepared=null;window.__sceneRenderGate.renderOnce(scene,camera);const pending=owner.take('restored-native-pending');post.renderer.getContext().finish();return [pending,owner.take('restored-native-settled')];}});}catch(e){restoration={ok:false,errors:[e.message],samples:[]};}
          try{window.__sceneStartGate.restore();const p=window.__sceneStartNative,d=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');if(window.requestAnimationFrame!==p.native||!['value','writable','enumerable','configurable','get','set'].every(k=>d?.[k]===p.descriptor?.[k]))throw Error('startup descriptor drift');}catch(e){hooks.ok=false;hooks.errors.push(e.message);}
          const snapshot=owner?.snapshot();return {restoration:{...restoration,configuration,hooks,settings,ok:restoration.ok&&configuration.ok&&hooks.ok&&settings.ok},snapshot,errors};
        });
        if(!row.states.length&&cleanup.snapshot){Object.assign(row,cleanup.snapshot);const restored=new Set(cleanup.restoration.samples.map(s=>s.sequence));row.states=row.states.filter(s=>!restored.has(s.sequence));}
        row.restoration=cleanup.restoration;
        // Each sample appears once; preserve actual monotonic event/sample order across collections.
        if(focused){const resource=await focusedSceneCleanup(page);appendFocusedSamples(row,resource);row.resource=resource;row.bootstrap=bootstrap?.requests||[];
          if(!resource.ok)row.restoration.ok=false;compactFocusedContext(row);
        }else{const list=[...row.states,...(row.stress?.transaction.samples||[]).map(s=>s.observation),...row.restoration.samples].sort((a,b)=>a.sequence-b.sequence),mapped=new Map();
          for(const raw of list)if(!mapped.has(raw))mapped.set(raw,compact(raw));
          row.states=row.states.map(s=>mapped.get(s));if(row.stress)row.stress.transaction.samples=row.stress.transaction.samples.map(s=>({...s,observation:mapped.get(s.observation)}));row.restoration.samples=row.restoration.samples.map(s=>mapped.get(s));}
      }
    }catch(error){row.restoration={ok:false,errors:[error.message]};if(!primary)throw error;}
    finally{
      const routeErrors=[];try{await routes?.restore();}catch(e){routeErrors.push(e.message);}try{if(faultHTTPHandler)await ctx.unroute(expected404,faultHTTPHandler);}catch(e){routeErrors.push(e.message);}
      try{await bootstrap?.restore();}catch(e){routeErrors.push(e.message);}
      row.restoration||={ok:false,errors:['browser cleanup unavailable']};row.restoration.routes={ok:routeErrors.length===0,errors:routeErrors};if(routeErrors.length)row.restoration.ok=false;
      try{await ctx.close();row.contextClosed=true;}finally{row.expectedHTTP=httpReceipts;row.expectedConsoleErrors=expectedErrors;row.routeRequests=routes?.requests||[];save();}
    }
    if(!row.restoration?.ok&&!primary)throw Error('qualified fault: independent restoration incomplete');
  }
}
async function main(){
  if(process.env.GITHUB_ACTIONS!=='true')throw new Error('scene allocation: Actions only');
  const outputRoot=path.join(ROOT,'.out');
  if(!fs.existsSync(outputRoot))fs.mkdirSync(outputRoot);
  const out=path.join(ROOT,'.out/scene-allocation');
  if(fs.existsSync(out)||fs.realpathSync(outputRoot)!==outputRoot)throw new Error('scene allocation: needs fresh real .out/scene-allocation');
  fs.mkdirSync(out);
  const campaign=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/campaign.json')));
  const inactive=process.env.SCENE_INACTIVE==='true',partition=process.env.SCENE_PARTITION==='true';
  const sceneRoutes=process.env.SCENE_ROUTES||'current-png',qualified=sceneRoutes==='qualified-both',focus=process.env.SCENE_FOCUS||'full',float32=focus==='float32-lookout',focused=float32||focus==='canonical-lookout';
  const completion=process.env.SCENE_COMPLETION||'no-finish';
  if(!['no-finish','native-finish'].includes(completion)||completion==='native-finish'&&!qualified)throw Error('scene allocation: completion experiment requires explicit qualified routes');
  if(!['current-png','qualified-both'].includes(sceneRoutes)||qualified&&(!inactive||!partition))throw Error('scene allocation: explicit routes require both prototypes');
  if(!['full','canonical-lookout','float32-lookout'].includes(focus)||focused&&(!qualified||completion!=='native-finish'))throw Error('scene allocation: focused policy requires qualified routes and native completion');
  const phases=campaign.phases.map(entry=>{const pack=JSON.parse(fs.readFileSync(path.join(ROOT,`assets/packs/${entry.packId}.json`)));return {...entry,scenario:prepareFieldScenario(preparePhase(pack,entry.phaseId).scenario,'pack')};});
  // Immutable acquisition and fresh runner-only materialization precede browser launch.
  const input=qualified?await acquireQualifiedHybrid(JSON.parse(fs.readFileSync(path.join(ROOT,'assets/figures/confederate-infantry/soldier.json')))):null,
    transport=qualified?materializeQualifiedSceneInput(input):null,matrix=qualified?sceneMatrixContract(phases):null;
  if(focused){matrix.cases=matrix.cases.filter(r=>r.packId==='chattanooga'&&r.phaseId==='lookout-mountain');matrix.faults=matrix.faults.filter(r=>r.packId==='chattanooga'&&r.phaseId==='lookout-mountain');}
  const report={diagnosticOnly:true,fieldable:false,toolSha:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,route:'current PNG, both armies',cases:[],complete:false,
    inactivePrototype:inactive,
    terrainPartitionPrototype:partition,terrainRestorationObserved:partition,
    limits:{gpuBytes:250000000},nativeDriverMemory:'UNRUN',cpuDecodePeak:'UNRUN',
    unverified:['native driver storage/pools and deferred releases after context destruction','whole-fight effect maximum beyond exercised frames','future sandbox spawns beyond declared pools','CPU image decode/upload-copy peaks']};
  if(qualified)Object.assign(report,{sceneRoutes,...(completion==='native-finish'?{fallbackCompletion:'native-finish-after-candidate-disposal'}:{}),normalMotion:true,nativeHistoryRequired:true,qualification:{...QUALIFIED_HYBRID,members:[...transport.files].map(([name,file])=>({name,bytes:file.bytes.length,sha256:file.sha256}))},faults:[]});
  if(focused)Object.assign(report,{resourceFocus:focus,terrainPartitionPrototype:float32,...(float32?{float32TerrainRepresentation:'Float32 with retained exact original'}:{canonicalTerrainRepresentation:'canonical with retained exact original'}),postPixelBytes:3639218,mipPolicy:'full-original',focusedComplete:false,fullMatrixComplete:false});
  let evidenceRoot=out,phaseCursor=0,transportFailure=null;
  const phaseNames=Array.from({length:11},(_,i)=>'phase-'+String(i+1).padStart(2,'0')+'.json'),members=new Map(),partFiles=new Map(),captures=new Map();
  if(qualified){const temp=process.env.RUNNER_TEMP;if(!temp||fs.realpathSync(temp)!==temp||!fs.lstatSync(temp).isDirectory())throw Error('scene parts: real runner temp required');evidenceRoot=fs.mkdtempSync(path.join(temp,'cw-scene-matrix-'));}
  const header=scenePartHeader(report),merger=qualified&&!focused?createSceneMatrixMerger(phases,header):null;
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const writeEvidence=(name,bytes)=>{
    if(!/^[A-Za-z0-9_.-]+$/.test(name)||fs.realpathSync(evidenceRoot)!==evidenceRoot)throw Error('scene parts: owned file containment');
    const file=path.join(evidenceRoot,name);if(fs.existsSync(file)&&(!members.has(name)||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==file))throw Error('scene parts: foreign evidence file');
    fs.writeFileSync(file,bytes,{flag:members.has(name)?'w':'wx'});const member={name,bytes:bytes.length,sha256:digest(bytes)};members.set(name,member);return member;
  };
  const manifest=()=>({...header,kind:'bounded phase parts; original PNG bytes; complete native histories',phaseParts:[...partFiles.values()],
    captures:[...captures.values()],members:[...members.values()],tuples:matrix?{cases:matrix.cases,faults:matrix.faults}:null,
    ...(merger?merger.snapshot():{}),...(focused?{focusedComplete:report.focusedComplete,complete:false,fullMatrixComplete:false,withinLimit:report.withinLimit??false,errors:report.errors||[],maxGpuReservation:report.maxGpuReservation??null,maxReservation:report.maxReservation??null}:{}),...(transportFailure?{transportFailure,complete:false,withinLimit:false}:{}),fieldable:false});
  const source={ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),...(qualified?{nativeJournal:true}:{})};
  const {server,url}=await startServer({port:0});let browser;
  const save=(force=false)=>{if(focused&&!force&&[...report.cases,...report.faults].some(r=>!r.contextClosed))return;const envelope=sceneReportEnvelope(report);if(qualified){
    const name=phaseNames[Math.min(phaseCursor,10)];
    if(!envelope.withinLimit){writeEvidence(name.replace('.json','.json.gz'),gzipSync(envelope.json));transportFailure={phaseKey:report.phaseKey,bytes:envelope.bytes,limit:envelope.limit,sha256:digest(envelope.json)};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(manifest()));throw Error('scene parts: bounded phase overflow retained; no truncation');}
    const member=writeEvidence(name,Buffer.from(envelope.json));partFiles.set(name,{...member,phaseKey:report.phaseKey??null,complete:report.complete===true});
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(manifest()));return;
  }if(!envelope.withinLimit){
    // Retain every observation on the runner; this failed transport cannot be admitted by the bounded reader.
    const archived=gzipSync(envelope.json),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(out,'report-overflow.json.gz'),archived);
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({complete:false,withinLimit:false,fieldable:false,toolSha:report.toolSha,
      transportFailure:{bytes:envelope.bytes,sha256:sha256(envelope.json),limit:envelope.limit,forensicFile:'report-overflow.json.gz',encoding:'gzip',compressedBytes:archived.length,compressedSha256:sha256(archived),policy:'complete forensic evidence; oversized transport rejected; no adoption'}}));
    throw Error(`scene allocation: complete report ${envelope.bytes} bytes exceeds reader margin; complete gzip evidence retained`);
  }fs.writeFileSync(path.join(out,'report.json'),qualified?envelope.json:JSON.stringify(report,null,2));};
  try{
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    for(const [index,entry]of (qualified?matrix.cases:campaign.phases).entries()){
      if(qualified){phaseCursor=Math.floor(index/2);report.phaseKey=entry.packId+'/'+entry.phaseId;}
      const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,reducedMotion:qualified?'no-preference':'reduce'});
      const errors=[],row={...entry,states:[],errors,...(qualified?{contextId:`${entry.packId}/${entry.phaseId}/${entry.route}/ordinary`,history:createSceneHistory(),scenario:phases.find(p=>p.packId===entry.packId&&p.phaseId===entry.phaseId).scenario}:{})};report.cases.push(row);let sequence=0,page,routes,primary,bootstrap;
      const observation=data=>qualified&&!focused?compactSceneSample(row.history,{...data,sequence:++sequence}):data;
      try{
      await ctx.addInitScript(installAllocationObserver,source);
      if(qualified)await ctx.addInitScript(source=>{window.__sceneStartNative={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};window.__sceneStartGate=(0,eval)('('+source+')')();},installSceneStartGate.toString());
      routes=qualified?await installQualifiedSceneRoutes(ctx,new URL(url).origin,transport.files):null;
      page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        if(focused)bootstrap=await focusedSceneBootstrap(ctx,page,url,entry);
        else await page.goto(`${url}?battle=${entry.packId}&phase=${entry.phaseId}&quality=high&nosw${qualified?'&figures=rigged':''}`);
        await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
        if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
        await page.evaluate(async qualified=>{
          const {game}=window.__game;if(!game.paused)game.togglePause();
          const S=await import('./src/settings.js');if(qualified){const {LOOK}=await import('./src/ui/look.js');window.__qualifiedSettings={values:S.all().map(({key,value,locked})=>({key,value,locked})),look:JSON.stringify(LOOK)};}else S.set('look.figureStyle','baked');game.ensureBaked();
        },qualified);
        await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
        if(qualified){
          const configured=await page.evaluate(async({manifest,sourceManifest,base,route,focused})=>{
            const {configureSceneCloseRoute,installRenderGate}=await import('./tools/bake/inactive-figures.mjs'),THREE=await import('three'),{game,post}=window.__game;
            if(game.simTime!==0||!game.paused||window.__sceneStartGate.first?.simTime!==0)throw Error('qualified scene: native time-zero startup required');
            const preclose={currentSingleBaseBound:game.baked.atlases.CS.layout.tiers.close.looks.length===1};
            for(const [side,a]of Object.entries(game.baked.atlases))preclose[side]={fieldReady:a.loaded('field'),closePromise:!!a.state.close,closeTextures:!!a.textures.close,closeBatches:a.pools.reduce((n,p)=>n+p.batches.close.length,0),closeRequests:0};
            window.__qualifiedCandidateRequests=0;
            const owner=configureSceneCloseRoute(window.__game,{manifest,sourceManifest,base,route,candidateRequests:()=>window.__qualifiedCandidateRequests}),atlas=game.baked.atlases.CS;
            window.__qualifiedConfiguration=owner;window.__qualifiedIO=Object.getOwnPropertyDescriptor(atlas,'io');
            const io={...atlas.io,fetch:input=>{if(String(input).startsWith(base))window.__qualifiedCandidateRequests++;return fetch(input);},loadPNG:input=>{if(String(input).startsWith(base))window.__qualifiedCandidateRequests++;return new THREE.TextureLoader().loadAsync(input);}};
            atlas.io=io;window.__qualifiedInstalledIO=io;if(!focused)window.__sceneRenderGate=installRenderGate(post);
            return {preclose,configuration:{fieldUnchanged:owner.fieldUnchanged(),baseUnchanged:owner.fieldUnchanged(),nativeUSLoading:!game.baked.atlases.US.diagnosticClose,
              genuineCapability:route==='capable'&&owner.nativeCapability,maskedOnlyAstc:route==='unsupported'},scenario:game.scenario,ordinaryRoster:game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}))};
          },{manifest:input.manifest,sourceManifest:input.source,base:routes.base,route:entry.route,focused});
          if(JSON.stringify(configured.scenario)!==JSON.stringify(row.scenario))throw Error('qualified scene: live scenario differs from trusted authored preparation');Object.assign(row,configured);
          await page.evaluate(async()=>{const S=await import('./src/settings.js');S.set('look.figureStyle','baked');window.__game.game.animate(0);});
        }
        const capture=async label=>{
          await page.evaluate(initializeSceneTextures);
          const drawing=await page.evaluate(async()=>{const {post,scene,camera}=window.__game,r=post.renderer,prior=r.info.autoReset;
            const {settleSceneCapture}=await import('./tools/bake/scene-allocation.mjs');settleSceneCapture(window);
            r.info.autoReset=false;r.info.reset();try{if(window.__sceneRenderGate)window.__sceneRenderGate.renderOnce(scene,camera);else post.render(scene,camera);r.getContext().finish();return {drawCalls:r.info.render.calls,nativeRenders:window.__sceneRenderGate?.count??null};}finally{r.info.autoReset=prior;}});
          const data=focused?await page.evaluate(label=>window.__focusedScene.sample(label),label):await page.evaluate(inventory);row.states.push(observation({...data,label,...drawing}));save();
          if(data.glError||data.allocation.unknown.length||data.unmappedBufferBytes!==0||errors.length)throw new Error(`scene allocation: ${entry.phaseId}/${label} incomplete: GL${data.glError}, unmapped ${data.unmappedBufferBytes}, ${data.allocation.unknown.join(',')}, ${errors.join(',')}`);
          console.log(entry.phaseId,label,JSON.stringify({reservation:data.conservativeReservation,...data.allocation.byKind,arrays:data.declaredArrayBytes,pages:data.atlasPages}));
        };
        const canvasShot=async (filename,label=filename)=>{
          if(qualified)filename=`${entry.packId}-${entry.phaseId}-${entry.route}-${filename}`;
          const shot=await page.evaluate(async({source,bindWorld})=>{
            const S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js'),{post,scene,camera,rts,game,world}=window.__game;
            const {settleSceneCapture}=await import('./tools/bake/scene-allocation.mjs');settleSceneCapture(window);
            const png=(0,eval)('('+source+')')(post,scene,camera,window.__sceneRenderGate),receipt={...png,style:S.get('look.figureStyle'),comparison:C.compareState(),simTime:game.simTime,
              camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far,goal:{...rts.goal}}};
            if(window.__focusedScene)receipt.figurePublication=Object.fromEntries(Object.entries(game.baked.atlases).map(([side,a])=>[side,Object.fromEntries(Object.entries(a.textures).map(([tier,pages])=>[tier,pages.map(t=>({uuid:t.uuid,width:t.image?.width,height:t.image?.height,
              native:window.__allocation.textureReservation(post.renderer.getContext(),post.renderer.properties.get(t).__webglTexture)}))]))]));
            if(bindWorld){
              const pending=[];
              const fingerprint=(root,kind)=>{const owners=[];root.traverse(mesh=>{if(!mesh.geometry)return;const arrays=[];
                const add=(key,attribute)=>{const a=attribute?.isInterleavedBufferAttribute?attribute.data.array:attribute?.array;if(!a)return;
                  const bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength).slice(),record={key,bytes:bytes.length,arrayType:a.constructor.name,itemSize:attribute.itemSize,count:attribute.count,normalized:attribute.normalized};arrays.push(record);
                  pending.push(crypto.subtle.digest('SHA-256',bytes).then(hash=>{record.sha256=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');}));};
                for(const [key,a]of Object.entries(mesh.geometry.attributes))add(key,a);add('index',mesh.geometry.index);add('instanceMatrix',mesh.instanceMatrix);add('instanceColor',mesh.instanceColor);
                // A reversible terrain partition leaves the real root geometry empty.
                if(arrays.some(a=>a.bytes>0))owners.push({mesh:mesh.uuid,geometry:mesh.geometry.uuid,material:Array.isArray(mesh.material)?mesh.material.map(m=>m.uuid):mesh.material?.uuid,instances:mesh.isInstancedMesh?mesh.count:null,arrays});});
                return {kind,root:root.uuid,count:root.userData.count??null,owners};};
              receipt.world={terrain:fingerprint(world.terrainMesh,'native terrain geometry'),trees:fingerprint(world.trees,'native tree instances')};
              receipt.roster=game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}));await Promise.all(pending);
            }return receipt;
          },{source:renderCanvasPng.toString(),bindWorld:qualified&&entry.phaseId==='lookout-mountain'});
          if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(shot.dataUrl)||shot.nativeRenders!==1||shot.glError||shot.width!==shot.drawingWidth||shot.height!==shot.drawingHeight||!shot.width||!shot.height)throw new Error('scene canvas: invalid actual draw/readback metadata');
          const bytes=Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length),'base64'),png=PNG.sync.read(bytes);
          let opaque=false,nonuniform=false;for(let i=0;i<png.data.length;i+=4){if(png.data[i+3])opaque=true;for(let c=0;c<4;c++)if(png.data[i+c]!==png.data[c])nonuniform=true;}
          if(png.width!==shot.width||png.height!==shot.height||!opaque||!nonuniform)throw new Error('scene canvas: dimensions/visible/nonuniform content not proved');
          if(qualified)writeEvidence(filename,bytes);else fs.writeFileSync(path.join(out,filename),bytes);delete shot.dataUrl;
          row.canvasCaptures||=[];row.canvasCaptures.push({filename,label,phase:entry.phaseId,toolSha:report.toolSha,...shot,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),pixelSha256:createHash('sha256').update(png.data).digest('hex'),opaque,nonuniform,kind:'battlefield-canvas capture; DOM HUD excluded'});if(qualified)captures.set(filename,row.canvasCaptures.at(-1));save();
        };
        if((inactive||partition)&&entry.phaseId==='lookout-mountain')await page.evaluate(source=>{
          const {post,rts,game,camera}=window.__game;if(!window.__sceneRenderGate)window.__sceneRenderGate=(0,eval)('('+source+')')(post);
          for(let i=0;i<12;i++)rts.update(1);game.setView(camera,innerHeight*post.scale);game.animate(0);
        },installRenderGate.toString());
        if(focused)await page.evaluate(async()=>{const I=await import('./tools/bake/inactive-figures.mjs'),g=window.__game.game;g.__inactiveStats=I.installInactiveFigures(g);g.animate(0);});
        await capture('field');
        if(float32){
          await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
          row.float32Views=await page.evaluate(async()=>{
            const P=await import('./tools/bake/partition-terrain.mjs'),{world,terrain,rts}=window.__game,g=world.terrainMesh.geometry,
              p=P.partitionTerrain({position:g.attributes.position.array,uv:g.attributes.uv.array,index:g.index.array}),seen=new Set();let boundary,distance=Infinity;
            for(const c of p.chunks){for(let i=0;i<c.sourceVertices.length;i++){const point=[c.position[i*3],c.position[i*3+2]],d=(point[0]-rts.goal.x)**2+(point[1]-rts.goal.z)**2;
              if(seen.has(c.sourceVertices[i])&&point.every(v=>Math.abs(v)<terrain.half-terrain.cell*8)&&d<distance){boundary=point;distance=d;}}
              for(const id of c.sourceVertices)seen.add(id);}
            if(!boundary)throw Error('Float32 scene: actual shared chunk boundary required');
            return [{label:'overview',goal:{...rts.goal}},{label:'near',goal:{...rts.goal,x:0,z:0,dist:200}},{label:'boundary',goal:{...rts.goal,x:boundary[0],z:boundary[1],dist:100},sharedChunkBoundary:boundary}];
          });
          const viewFrames=async kind=>{for(const view of row.float32Views){await page.evaluate(goal=>{const {rts,game,camera,post}=window.__game;Object.assign(rts.goal,goal);rts.snap();rts.update(1);game.setView(camera,innerHeight*post.scale);game.animate(0);},view.goal);
            await capture(`float32-${kind}-${view.label}`);await canvasShot(`float32-${kind}-${view.label}.png`,`float32-${kind}-${view.label}`);}};
          await viewFrames('original');row.partition=await focusedFloat32Install(page);await capture('float32-field');await viewFrames('partition');
          await page.evaluate(()=>window.__sceneTerrainPartition.restore());await viewFrames('restored');
          for(const view of row.float32Views){const frames=['original','partition','restored'].map(kind=>row.canvasCaptures.find(c=>c.label===`float32-${kind}-${view.label}`));
            if(frames.some(c=>c.pixelSha256!==frames[0].pixelSha256||JSON.stringify(c.camera)!==JSON.stringify(frames[0].camera)||JSON.stringify(c.roster)!==JSON.stringify(frames[0].roster)||JSON.stringify(c.figurePublication)!==JSON.stringify(frames[0].figurePublication)||c.width!==frames[0].width||c.height!==frames[0].height))throw Error('Float32 scene: original/partition/restored whole painted frames differ');}
          row.partition=await focusedFloat32Install(page);await capture('float32-native-zoom');
          await page.evaluate(()=>{const f=window.__focusedScene,root=window.__game.world.terrainMesh;f.controlArrays=root.children.flatMap((c,i)=>['position','uv'].map(k=>({array:c.geometry.attributes[k].array.slice(),owner:`terrain-float32-control-${i}/${k}`,attribute:c.geometry.attributes[k]})));
            for(const c of root.children){const a=c.geometry.attributes.position;for(let i=0;i<a.count;i++)a.array[i*3+1]+=30;a.needsUpdate=true;}});
          await capture('float32-height-control');await canvasShot('float32-height-control.png','float32-height-control');
          await page.evaluate(()=>{const f=window.__focusedScene;for(const r of f.controlArrays){r.attribute.array.set(r.array);r.attribute.needsUpdate=true;}for(const c of window.__game.world.terrainMesh.children){const a=c.geometry.attributes.uv;for(let i=0;i<a.array.length;i++)a.array[i]*=.5;a.needsUpdate=true;}});
          await capture('float32-uv-control');await canvasShot('float32-uv-control.png','float32-uv-control');
          await page.evaluate(()=>{const f=window.__focusedScene;for(const r of f.controlArrays){r.attribute.array.set(r.array);r.attribute.needsUpdate=true;}f.controlArrays=null;});
          await capture('float32-controls-repaired');await canvasShot('float32-controls-repaired.png','float32-controls-repaired');
          const baseline=row.canvasCaptures.find(c=>c.label==='float32-partition-boundary'),height=row.canvasCaptures.find(c=>c.label==='float32-height-control'),uv=row.canvasCaptures.find(c=>c.label==='float32-uv-control'),repair=row.canvasCaptures.find(c=>c.label==='float32-controls-repaired');
          if(height.pixelSha256===baseline.pixelSha256||uv.pixelSha256===baseline.pixelSha256||repair.pixelSha256!==baseline.pixelSha256)throw Error('Float32 scene: healthy height/UV controls and exact repair required');
        }else if(focused){
          // Near cameras can request a close tier. Settle the already configured
          // genuine route once so a terrain comparison cannot change figure art.
          await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
          row.canonicalViews=await page.evaluate(async()=>{
            const P=await import('./tools/bake/partition-terrain.mjs'),Martini=(await import('@mapbox/martini')).default,{terrain,rts}=window.__game,{vertices,triangles}=new Martini(terrain.grid).createTile(terrain.heights).getMesh(.5),
              prepared=P.prepareCanonicalTerrain({grid:terrain.grid,cell:terrain.cell,half:terrain.half,heights:terrain.heights,vertices,triangles}),seen=new Set();let boundary,distance=Infinity;
            for(const c of prepared.chunks){for(let i=0;i<c.height.length;i++){const key=c.gridPosition[i*2]+','+c.gridPosition[i*2+1],point=[c.gridPosition[i*2]*terrain.cell-terrain.half,c.gridPosition[i*2+1]*terrain.cell-terrain.half],d=(point[0]-rts.goal.x)**2+(point[1]-rts.goal.z)**2;
              if(seen.has(key)&&point.every(v=>Math.abs(v)<terrain.half-terrain.cell*8)&&d<distance){boundary=point;distance=d;}}for(let i=0;i<c.height.length;i++)seen.add(c.gridPosition[i*2]+','+c.gridPosition[i*2+1]);}
            if(!boundary)throw Error('focused scene: actual shared chunk boundary required');
            return [{label:'overview',goal:{...rts.goal}},{label:'near',goal:{...rts.goal,x:0,z:0,dist:200}},{label:'boundary',goal:{...rts.goal,x:boundary[0],z:boundary[1],dist:100},sharedChunkBoundary:boundary}];
          });
          const viewFrames=async kind=>{for(const view of row.canonicalViews){await page.evaluate(goal=>{const {rts,game,camera,post}=window.__game;Object.assign(rts.goal,goal);rts.snap();rts.update(1);game.setView(camera,innerHeight*post.scale);game.animate(0);},view.goal);
            await capture(`canonical-${kind}-${view.label}`);await canvasShot(`canonical-${kind}-${view.label}.png`,`canonical-${kind}-${view.label}`);}};
          await viewFrames('original');row.canonical=await focusedCanonicalInstall(page);await capture('canonical-field');await viewFrames('compact');
          await page.evaluate(()=>{window.__sceneTerrainPartition.restore();window.__focusedScene.prepared=null;});await viewFrames('restored');
          for(const view of row.canonicalViews){const frames=['original','compact','restored'].map(kind=>row.canvasCaptures.find(c=>c.label===`canonical-${kind}-${view.label}`));
            if(frames.some(c=>c.pixelSha256!==frames[0].pixelSha256||JSON.stringify(c.camera)!==JSON.stringify(frames[0].camera)||JSON.stringify(c.roster)!==JSON.stringify(frames[0].roster)||JSON.stringify(c.figurePublication)!==JSON.stringify(frames[0].figurePublication)||c.width!==frames[0].width||c.height!==frames[0].height)){
              // A mismatch remains fatal. Collect each distinct causal control once,
              // with a restored-original frame between variants, before retaining it.
              row.paintedIsolation=[];
              await failPaintedComparison(row,()=>collectPaintedIsolation({rows:row.paintedIsolation,save,
                install:variant=>page.evaluate(async variant=>{
                    const f=window.__focusedScene,{world}=window.__game,root=world.terrainMesh,o=f.original;
                    if(root!==o.root||root.geometry!==o.geometry||root.material!==o.material||root.children.length)throw Error('painted isolation: original owners required');
                    if(variant==='clone'){
                      const clone=o.material.clone();clone.uniforms=o.material.uniforms;
                      if(clone.vertexShader!==o.material.vertexShader||clone.fragmentShader!==o.material.fragmentShader||clone.uniforms!==o.material.uniforms)throw Error('painted isolation: unchanged shader/uniform records required');
                      f.isolationClone=clone;root.material=clone;return {kind:'cloned unchanged material',sameUniformRecords:true,sameVertexShader:true,sameFragmentShader:true};
                    }
                    if(variant!=='float32-partition')throw Error('painted isolation: explicit variant required');
                    const THREE=await import('three'),P=await import('./tools/bake/partition-terrain.mjs');let owner;
                    f.lifetime.completeTerrainRetirement(()=>{owner=P.installTerrainPartition(world,THREE,P.partitionTerrain,{reversible:true});P.registerTerrainPartition(window,owner);});
                    if(!owner.materialShared||root.material!==o.material||root.children.some(c=>c.material!==o.material))throw Error('painted isolation: original material required');
                    return {kind:'Float32 position/UV Uint16 partition',bytes:owner.bytes,sourceBytes:owner.sourceBytes,triangles:owner.triangles,chunks:owner.chunks,originalMaterialShared:owner.materialShared};
                  },variant),
                capture:variant=>viewFrames('isolation-'+variant),
                restore:variant=>page.evaluate(variant=>{
                      const f=window.__focusedScene,{world}=window.__game,o=f.original;
                      if(variant==='clone'){
                        if(world.terrainMesh.material!==f.isolationClone)throw Error('painted isolation: cloned owner changed');
                        world.terrainMesh.material=o.material;f.isolationClone.dispose();f.isolationClone=null;
                      }else if(window.__sceneTerrainPartition)f.lifetime.completeTerrainRetirement(()=>window.__sceneTerrainPartition.restore());
                      if(world.terrainMesh!==o.root||world.terrainMesh.geometry!==o.geometry||world.terrainMesh.material!==o.material||world.terrainMesh.children.length)throw Error('painted isolation: original identities not restored');
                      return true;
                    },variant),
                verifyRestored:async variant=>{await viewFrames('isolation-'+variant+'-restored');
                    for(const view of row.canonicalViews){const original=row.canvasCaptures.find(c=>c.label==='canonical-original-'+view.label),restored=row.canvasCaptures.find(c=>c.label==='canonical-isolation-'+variant+'-restored-'+view.label);
                      if(!restored||restored.pixelSha256!==original.pixelSha256||restored.width!==original.width||restored.height!==original.height||JSON.stringify(restored.camera)!==JSON.stringify(original.camera)||JSON.stringify(restored.roster)!==JSON.stringify(original.roster)||JSON.stringify(restored.figurePublication)!==JSON.stringify(original.figurePublication))throw Error('painted isolation: exact restored painted baseline required');}
                    return true;},
              }));
            }}

          row.canonical=await focusedCanonicalInstall(page);await capture('canonical-native-zoom');
          await page.evaluate(()=>{for(const c of window.__game.world.terrainMesh.children){const a=c.geometry.attributes.aHeight;for(let i=0;i<a.count;i++)a.array[i]+=30;a.needsUpdate=true;}});
          await capture('canonical-height-control');await canvasShot('canonical-height-control.png','canonical-height-control');
          await page.evaluate(()=>{const {world,terrain}=window.__game,root=world.terrainMesh;for(const c of root.children){const grid=c.geometry.attributes.aGrid,height=c.geometry.attributes.aHeight;
            for(let i=0;i<height.count;i++)height.array[i]=terrain.heights[grid.array[i*2+1]*terrain.grid+grid.array[i*2]];height.needsUpdate=true;}root.material.uniforms.uCanonicalInverse.value*=.5;});
          await capture('canonical-uv-control');await canvasShot('canonical-uv-control.png','canonical-uv-control');
          await page.evaluate(()=>{const f=window.__focusedScene,root=window.__game.world.terrainMesh;root.material.uniforms.uCanonicalInverse.value=1/(f.prepared.grid-1);});
          await capture('canonical-controls-repaired');await canvasShot('canonical-controls-repaired.png','canonical-controls-repaired');
          const before=row.canvasCaptures.find(c=>c.label==='canonical-compact-boundary'),height=row.canvasCaptures.find(c=>c.label==='canonical-height-control'),uv=row.canvasCaptures.find(c=>c.label==='canonical-uv-control'),repaired=row.canvasCaptures.find(c=>c.label==='canonical-controls-repaired');
          if(height.pixelSha256===before.pixelSha256||uv.pixelSha256===before.pixelSha256||repaired.pixelSha256!==before.pixelSha256)throw Error('focused scene: healthy height/UV sensitivity or exact repair missing');
          await page.evaluate(goal=>{const {rts,game,camera,post}=window.__game;Object.assign(rts.goal,goal);for(let i=0;i<12;i++)rts.update(1);game.setView(camera,innerHeight*post.scale);game.animate(0);},row.canonicalViews[0].goal);
        }else if(partition){
          if(entry.phaseId==='lookout-mountain')await canvasShot('terrain-partition-01-before.png');
          row.partition=await page.evaluate(async source=>{const THREE=await import('three'),P=(0,eval)('('+source.partition+')'),install=(0,eval)('('+source.install+')'),register=(0,eval)('('+source.register+')');
            if(Object.hasOwn(window,'__sceneTerrainPartition'))throw new Error('terrain partition: diagnostic scope already owned');
            const owner=install(window.__game.world,THREE,P,{reversible:true});register(window,owner);return {...owner};
          },{partition:partitionTerrain.toString(),install:installTerrainPartition.toString(),register:registerTerrainPartition.toString()});
          if(!row.partition.materialShared||row.partition.triangles!==row.partition.statTriangles)throw new Error('terrain partition: material/stat seam changed');
          await capture('partition-field');
          if(entry.phaseId==='lookout-mountain'){
            await canvasShot('terrain-partition-02-after.png');
            await page.mouse.move(700,300);await page.mouse.wheel(0,-400);await page.waitForTimeout(1000);await capture('partition-native-zoom');
            await canvasShot('terrain-partition-03-zoom.png');
          }
        }
        if(inactive){if(!focused)await page.evaluate(source=>{const g=window.__game.game;g.__inactiveStats=(0,eval)('('+source+')')(g);g.animate(0);},installInactiveFigures.toString());await capture('inactive-field');}
        await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
        if(qualified)row.publication=await page.evaluate(()=>({...window.__qualifiedConfiguration.assertPublication(),failure:window.__game.game.baked.atlases.CS.closeDiagnosticFailure||null}));
        await capture('both-close-tiers');
        // Every phase exercises native depth ownership and resize, not just an assumed maximum.
        await page.evaluate(()=>{const {post,camera}=window.__game;post.beginSoldierView(camera,Math.max(camera.near+1,Math.min(camera.far-1,100)));});
        await capture('lens-depth');
        const resized=async viewport=>{await page.setViewportSize(viewport);await page.waitForFunction(()=>{
          const p=window.__game.post,gl=p.renderer.getContext();return p.width===innerWidth&&p.height===innerHeight
            &&gl.drawingBufferWidth===Math.floor(innerWidth*p.scale)&&gl.drawingBufferHeight===Math.floor(innerHeight*p.scale);
        },null,{timeout:30000,polling:100});};
        await resized({width:1366,height:1024});await capture('lens-resize');
        await page.evaluate(()=>window.__game.post.endSoldierView());await capture('lens-retired');
        await resized({width:320,height:568});await capture('narrow-resize');
        if(inactive&&(qualified||entry.phaseId==='lookout-mountain')){
          await resized({width:1024,height:768});
          const transition=async(label,style,compare=false,filename=null)=>{
            const state=await page.evaluate(async({style,compare})=>{
              const g=window.__game.game,S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js');
              const combat=()=>JSON.stringify({time:g.simTime,orders:g.orders,holder:g.holder,units:g.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order.type,x:u.x,z:u.z}))});
              const before=combat();C.stopCompare();S.set('look.figureStyle',style);
              if(compare){const spec=S.all().find(s=>s.key==='look.figureStyle').spec;C.startCompare('look.figureStyle',spec,style,()=>{});}
              g.setView(window.__game.camera,innerHeight*window.__game.post.scale);g.animate(0);return {style,compare,combatBefore:before,combatAfter:combat(),combatUnchanged:combat()===before,stats:{...g.__inactiveStats},procedural:g.pools.US.pushed+g.pools.CS.pushed,baked:g.impostors.US.drawn+g.impostors.CS.drawn};
            },{style,compare});
            row.transitions||=[];row.transitions.push({label,...state});if(!state.combatUnchanged)throw new Error('inactive prototype: style changed combat state');
          await capture(label);await canvasShot(filename||`${String(row.transitions.length).padStart(2,'0')}-${label}.png`,label);
          };
          await transition('rigged-reactivation','rigged');
          row.lodReactivation=await page.evaluate(()=>{
            const {game:g,rts,post}=window.__game,b=g.pools.US.buckets.find(b=>b.lod===2&&!b.mesh.visible),u=g.units.find(u=>u.side==='US'&&u.type==='infantry'&&u.men>0);
            if(!b||!u)throw new Error('inactive prototype: no released near bucket/formation for reactivation control');
            const gl=post.renderer.getContext(),before=window.__allocation.bufferReservation(gl,b.mesh.instanceMatrix.array),stats={...g.__inactiveStats},goal={...rts.goal},
              combatBefore=JSON.stringify({time:g.simTime,orders:g.orders,holder:g.holder,units:g.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order.type,x:u.x,z:u.z}))});
            window.__reactivationBucket=b;rts.flyTo(u.x,u.z,100);rts.update(1);rts.update(1);g.setView(window.__game.camera,innerHeight*post.scale);g.animate(0);
            return {before,stats,goal,combatBefore,nearCount:b.n,visible:b.mesh.visible,afterStats:{...g.__inactiveStats},cameraDistance:rts.dist};
          });
          await capture('near-lod-reupload');
          row.lodReactivation.after=await page.evaluate(()=>{const b=window.__reactivationBucket,gl=window.__game.post.renderer.getContext();return window.__allocation.bufferReservation(gl,b.mesh.instanceMatrix.array);});
          if(qualified){
            const state=await page.evaluate(async()=>{const g=window.__game.game,C=await import('./src/sandbox/compare.js'),b=window.__reactivationBucket;return {style:'rigged',compare:!!C.compareState(),combat:JSON.stringify({time:g.simTime,orders:g.orders,holder:g.holder,units:g.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order.type,x:u.x,z:u.z}))}),bytes:b.mesh.instanceMatrix.array.byteLength};});
            row.lodReactivation.fullArray=row.lodReactivation.after?.bytes===state.bytes;row.transitions.push({label:'near-lod-reupload',style:state.style,compare:state.compare,combatBefore:row.lodReactivation.combatBefore,combatAfter:state.combat,combatUnchanged:row.lodReactivation.combatBefore===state.combat});
          }
          if(!row.lodReactivation.visible||!row.lodReactivation.nearCount||row.lodReactivation.afterStats.reactivated<=row.lodReactivation.stats.reactivated||!row.lodReactivation.after||row.lodReactivation.before?.id===row.lodReactivation.after.id)throw new Error('inactive prototype: released bucket GPU reupload not proved');
          await canvasShot('06-near-lod-reupload.png','near-lod-reupload');
          await page.evaluate(goal=>{const {rts,game:g,camera,post}=window.__game;Object.assign(rts.goal,goal);rts.update(1);rts.update(1);g.setView(camera,innerHeight*post.scale);g.animate(0);},row.lodReactivation.goal);
          await transition('baked-reclamation','baked');
          await transition('compare-rigged-left','rigged',true);await transition('compare-baked-left','baked',true);
          await transition('baked-restored','baked');
          if(partition&&entry.phaseId==='lookout-mountain'){
            row.framedComparison=await page.evaluate(async()=>{
              const {game:g,rts,camera,post}=window.__game,u=g.units.find(u=>u.side==='US'&&u.type==='infantry'&&u.alive);
              if(!u)throw new Error('combined prototype: living formation needed for readable comparison');
              const {settleSceneCapture}=await import('./tools/bake/scene-allocation.mjs');settleSceneCapture(window,{framedUnitId:u.id});
              return {unitId:u.id,position:[u.x,u.z],simTime:g.simTime,goal:{...rts.goal}};
            });
            await transition('framed-compare-rigged-left','rigged',true,'07-framed-compare-rigged-left.png');
            await transition('framed-compare-baked-left','baked',true,'08-framed-compare-baked-left.png');
            await transition('framed-baked-restored','baked',false,'09-framed-baked-restored.png');
            const frames=row.canvasCaptures.slice(-3);
            if(!frames.every(s=>s.simTime===frames[0].simTime&&JSON.stringify(s.camera)===JSON.stringify(frames[0].camera)))throw new Error('combined prototype: comparison camera/time changed');
          }
        }
        if(qualified){
          const stressed=await page.evaluate(async()=>{
            const I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs'),{COMMAND}=await import('./src/game.js');
            const scope=window.__game,{game,effects,scene,camera,post}=scope,expected=I.deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:window.__qualifiedConfiguration.route==='capable'?10:5}}),
              combat=()=>JSON.stringify({time:game.simTime,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,order:u.order,x:u.x,z:u.z}))});
            const warm=I.warmSceneStressBaseline(scope,expected,COMMAND.radius),baseline=combat();A.initializeSceneTextures();
            const stress=I.runSceneStressTransaction({discovery:warm.discovery,draw:()=>window.__sceneRenderGate.renderOnce(scene,camera),
              sample:label=>{const gl=post.renderer.getContext();for(const owner of warm.discovery.owners)for(const array of owner.arrays)window.__allocation.labelBufferOwners(gl,array,[owner.label]);return window.__focusedScene?window.__focusedScene.sample(label):A.sampleSceneAllocations();},
              verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(post.renderer.getContext(),array)});
            return {stress,capacityContract:expected,warm:{baseline:warm.baseline,spawned:warm.spawned,retainedRoster:game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order})),afterOrdinary:true,combatUnchanged:combat()===baseline}};
          });
          Object.assign(row,stressed);row.stress.transaction.samples=row.stress.transaction.samples.map(s=>({...s,observation:observation(s.observation)}));
          if(!row.stress.ok||!row.warm.combatUnchanged)throw Error('qualified scene: full native stress or exact restoration incomplete');
        }
        row.complete=true;
      } catch(error){primary=error;row.failure=error.message;throw error;} finally {
        let configuration={ok:true},hooks={ok:true},settings={ok:true},routeRestoration={ok:true};
        if(qualified){
          try{const r=await page.evaluate(async()=>{
            const errors=[],attempt=async(fn,target)=>{try{const r=await fn();if(r?.ok===false)throw Error(r.errors?.join('; ')||'owner refused');return r||{ok:true};}catch(e){errors.push(target+': '+e.message);return {ok:false,errors:[e.message]};}};
            const configuration=await attempt(()=>window.__qualifiedConfiguration?.restore(),'configuration');
            const hooks=await attempt(()=>{const a=window.__game.game.baked.atlases.CS;if(a.io!==window.__qualifiedInstalledIO)throw Error('qualified IO ownership changed');const d=window.__qualifiedIO;if(d)Object.defineProperty(a,'io',d);else delete a.io;return {ok:true};},'hooks');
            const settings=await attempt(async()=>{const S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js'),{LOOK}=await import('./src/ui/look.js'),prior=window.__qualifiedSettings;C.stopCompare();
              for(const {key,value,locked}of prior.values){S.unlock(key);S.set(key,value);if(locked)S.lock(key);}Object.assign(LOOK,JSON.parse(prior.look));window.__game.game.animate(0);
              if(JSON.stringify(S.all().map(({key,value,locked})=>({key,value,locked})))!==JSON.stringify(prior.values)||JSON.stringify(LOOK)!==prior.look||C.compareState())throw Error('qualified settings restore mismatch');return {ok:true};},'settings');return {configuration,hooks,settings,errors};
          });({configuration,hooks,settings}=r);}
          catch(e){configuration=hooks=settings={ok:false,errors:[e.message]};}
        }
        try {row.restoration=await page.evaluate(source=>{
          const restore=(0,eval)('('+source.restore+')'),sample=source.focused?label=>window.__focusedScene.sample(label):()=>((0,eval)('('+source.sample+')'))();
          return restore(window,{sampleRestored:()=>{
            const {post,scene,camera}=window.__game;
            if(source.focused&&!window.__sceneTerrainPartition)window.__focusedScene.prepared=null;
            if(window.__sceneRenderGate)window.__sceneRenderGate.renderOnce(scene,camera);else post.render(scene,camera);
            const pending={...sample('restored-native-pending'),label:'restored-native-pending'};post.renderer.getContext().finish();
            return [pending,{...sample('restored-native-settled'),label:'restored-native-settled'}];
          }});
        },{restore:restoreSceneDiagnostics.toString(),sample:inventory.toString(),focused});}
        catch(error){row.restoration={ok:false,errors:[error.message]};}
        try{if(qualified){
          try{await page.evaluate(()=>{window.__sceneStartGate.restore();const prior=window.__sceneStartNative,after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');if(window.requestAnimationFrame!==prior.native||!['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]))throw Error('qualified startup descriptor restore failed');});}catch(e){hooks={ok:false,errors:[...(hooks.errors||[]),e.message]};}
          try{await routes?.restore();}catch(e){routeRestoration={ok:false,errors:[e.message]};}
          try{await bootstrap?.restore();}catch(e){routeRestoration={ok:false,errors:[...(routeRestoration.errors||[]),e.message]};}
          Object.assign(row.restoration,{configuration,hooks,settings,routes:routeRestoration});
          if(![configuration,hooks,settings,routeRestoration].every(r=>r.ok))row.restoration.ok=false;
          if(focused){const resource=await focusedSceneCleanup(page);appendFocusedSamples(row,resource);row.resource=resource;row.bootstrap=bootstrap?.requests||[];
            if(!resource.ok)row.restoration.ok=false;compactFocusedContext(row);
          }else row.restoration.samples=(row.restoration.samples||[]).map(observation);row.routeRequests=routes?.requests||[];
        }}finally{await ctx.close();if(qualified)row.contextClosed=true;save();}
        if(!row.restoration.ok&&!primary)throw new Error(`scene allocation: restoration failed: ${(row.restoration.errors||[]).join(', ')}`);
      }
      console.log(`SCENE ${index+1}/${campaign.phases.length} complete`);
      if(qualified&&index%2===1){
        const faults=matrix.faults.filter(f=>f.packId===entry.packId&&f.phaseId===entry.phaseId);
        for(const tuple of faults){await qualifiedFaultContext({browser,url,tuple,input,transport,source,phases,report,save,focused,float32});console.log('SCENE FAULT',tuple.packId,tuple.phaseId,tuple.fault,'complete');}
        report.complete=report.cases.every(r=>r.complete)&&report.faults.every(r=>r.complete);
        const part=focused?{...(float32?reduceFocusedFloat32LookoutObservations:reduceFocusedLookoutObservations)(report,phases.find(p=>p.packId==='chattanooga'&&p.phaseId==='lookout-mountain')),partComplete:false}:merger.add(report);
        if(focused){part.partComplete=part.focusedComplete;Object.assign(report,part,{complete:false,fullMatrixComplete:false});}save();console.log('SCENE PHASE',JSON.stringify(part));
        if(!part.partComplete)throw Error('scene parts: phase gate rejected; complete evidence retained');
        if(index<matrix.cases.length-1){report.cases=[];report.faults=[];report.complete=false;}
      }
    }
    if(!qualified){
    // Actual current loader failure: successful siblings must not masquerade as a complete close tier.
    const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2});await ctx.addInitScript(installAllocationObserver,source);
    const page=await ctx.newPage();
    try{
      let missingHits=0;
      await ctx.route('**/assets/figures/confederate-infantry/soldier_close_0.png',r=>{missingHits++;return r.fulfill({status:404,body:'diagnostic missing page'});});
      await page.goto(url+'?battle=stones-river&phase=dawn-on-the-right&quality=high&nosw');
      await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
      await page.evaluate(()=>window.__game.game.ensureBaked());
      await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
      const failure=await page.evaluate(async source=>{const a=window.__game.game.baked.atlases.CS,observe=(0,eval)('('+source+')');return {...await observe(()=>a.load('close')),published:!!a.textures.close,promiseCached:!!a.state.close};},rejectionObservation.toString());
      failure.missingHits=missingHits;
      report.failure={...failure,...await page.evaluate(inventory),policy:'Observed existing PNG failure without implicit upload or finish. No compressed fallback or disposal claim.'};
      if(!failure.rejected||failure.published||!missingHits)throw new Error('scene allocation: missing page control was accepted or not exercised');
    }finally{
      report.failure||={};
      try {report.failure.restoration=await page.evaluate(source=>(0,eval)('('+source+')')(),restoreSceneDiagnostics.toString());}
      catch(error){report.failure.restoration={ok:false,errors:[error.message]};}
      await ctx.close();save();
    }
    }
    const verdict=focused?(float32?reduceFocusedFloat32LookoutObservations:reduceFocusedLookoutObservations)({...report,complete:true},phases.find(p=>p.packId==='chattanooga'&&p.phaseId==='lookout-mountain')):qualified?merger.finalize():reduceSceneObservations(report,campaign.phases);
    if(focused)Object.assign(report,verdict,{complete:false,fullMatrixComplete:false});
    if(!qualified)Object.assign(report,verdict);
    save();console.log('SCENE-ALLOCATION COMPLETE',JSON.stringify({...verdict,fieldable:false}));
    if(!(focused?verdict.focusedComplete&&verdict.withinLimit:verdict.complete))process.exitCode=1; // Budget failures are results, not a reason to discard the observation.
  }finally{try{save(true);}finally{try{if(browser)await browser.close();}finally{await new Promise(resolve=>server.close(resolve));
    if(qualified&&members.size){
      const output=process.env.GITHUB_OUTPUT,temp=process.env.RUNNER_TEMP;if(!output||!output.startsWith(temp+path.sep)||fs.realpathSync(output)!==output||!fs.lstatSync(output).isFile())throw Error('scene parts: runner command file containment');
      try{
      const groups=sceneMatrixGroups([...members.values()]),groupRoot=fs.mkdtempSync(path.join(temp,'cw-scene-groups-'));
      for(const [i,list]of groups.entries()){const dir=path.join(groupRoot,'matrix-'+String(i).padStart(2,'0'));fs.mkdirSync(dir);for(const e of list){const from=path.join(evidenceRoot,e.name);if(fs.realpathSync(from)!==from||fs.lstatSync(from).isSymbolicLink())throw Error('scene parts: evidence source containment');fs.copyFileSync(from,path.join(dir,e.name),fs.constants.COPYFILE_EXCL);}}
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...manifest(),groups:groups.map((g,index)=>({index,names:g.map(e=>e.name),bytes:g.reduce((n,e)=>n+e.bytes,0)}))}));
      fs.appendFileSync(output,`matrix_root=${groupRoot}\nmatrix_groups=${groups.length}\n`);
      }catch(error){transportFailure={...transportFailure,message:String(error?.message??error),policy:'all original produced bytes retained in unaccepted forensic artifact; admission rejected'};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(manifest()));fs.appendFileSync(output,`matrix_transport_failure=true\nmatrix_forensic_root=${evidenceRoot}\n`);throw error;}
    }
  }}}
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});

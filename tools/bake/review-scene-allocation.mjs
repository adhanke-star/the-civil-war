// Actions-only observation of current whole-scene allocations. No renderer/atlas policy is adopted by this tool.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { AllocationLedger, mipSizes, installAllocationObserver, ReservationPeak, rejectionObservation, reduceSceneObservations, sampleSceneAllocations, initializeSceneTextures,sceneMatrixContract,createSceneHistory,compactSceneSample,sceneReportEnvelope } from './scene-allocation.mjs';
import {installInactiveFigures,installRenderGate,renderCanvasPng,restoreSceneDiagnostics,installSceneStartGate} from './inactive-figures.mjs';
import {acquireQualifiedHybrid,materializeQualifiedSceneInput,QUALIFIED_HYBRID,installQualifiedSceneRoutes} from './review-current-compression.mjs';
import {preparePhase,prepareFieldScenario} from '../../src/sim/phase.js';
import {PNG} from 'pngjs';
import {partitionTerrain,installTerrainPartition} from './partition-terrain.mjs';

const inventory=sampleSceneAllocations;
async function qualifiedFaultContext({browser,url,tuple,input,transport,source,phases,report,save}){
  const row={...tuple,contextId:`${tuple.packId}/${tuple.phaseId}/${tuple.route}/${tuple.fault}`,states:[],errors:[],history:createSceneHistory(),
    scenario:phases.find(p=>p.packId===tuple.packId&&p.phaseId===tuple.phaseId).scenario,complete:false,contextClosed:false};report.faults.push(row);
  const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,reducedMotion:'no-preference'});let page,routes,primary,faultHTTPHandler;
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
    await page.goto(`${url}?battle=${tuple.packId}&phase=${tuple.phaseId}&quality=high&figures=rigged&nosw`);
    await page.waitForFunction(()=>window.__ready&&window.__game?.game&&window.__game.effects?.ok,null,{timeout:180000,polling:250});
    if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
    await page.evaluate(async()=>{const S=await import('./src/settings.js'),{LOOK}=await import('./src/ui/look.js');window.__qualifiedSettings={values:S.all().map(({key,value,locked})=>({key,value,locked})),look:JSON.stringify(LOOK)};window.__game.game.ensureBaked();});
    await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
    const admitted=await page.evaluate(async({manifest,sourceManifest,base,tuple,target})=>{
      const I=await import('./tools/bake/inactive-figures.mjs'),A=await import('./tools/bake/scene-allocation.mjs'),P=await import('./tools/bake/partition-terrain.mjs'),THREE=await import('three'),{COMMAND}=await import('./src/game.js'),
        scope=window.__game,{game,post,scene,camera,effects,world}=scope,gl=post.renderer.getContext(),atlas=game.baked.atlases.CS;
      if(game.simTime!==0||!game.paused||window.__sceneStartGate.first?.simTime!==0)throw Error('qualified fault: native time-zero startup required');
      const states=[],events=[],logicalIds=new Map(),hooks=[];let sequence=0,candidateRequests=0,baselineRequests=0,firstBaseline=false,held=false,released=false,resolveHeld,
        candidateRejected=0,candidateSettled=0,targetUUID,nativeFired=false,prepareFired=false;
      const emit=(operation,data={})=>{const e={sequence:++sequence,operation,...data};events.push(e);return e;};
      const take=(label,data={},event)=>{const s={label,...A.sampleSceneAllocations(),...data,sequence:event?.sequence??++sequence};states.push(s);return s;};
      const id=uuid=>{if(!logicalIds.has(uuid))logicalIds.set(uuid,logicalIds.size+1);return logicalIds.get(uuid);};
      const heldPage=tuple.fault==='rejection-delayed-astc'?'cs-close-base-1-astc.ktx2':tuple.fault==='rejection-delayed-png'?'cs-close-base-4-original.png':null;
      const heldPromise=heldPage?new Promise(resolve=>{resolveHeld=resolve;}):null;
      const release=emergency=>{if(heldPage&&!released&&(held||emergency)){released=true;if(held)emit('sibling-released',{page:heldPage,emergency:!!emergency});resolveHeld();}};
      const maybeRelease=()=>{if(held&&!released&&candidateSettled===9){emit('held-check',{published:!!atlas.textures.close,baselineRequests,nonHeldSettled:candidateSettled,rejectionCount:candidateRejected});release(false);}};
      const wrap=(object,key,factory)=>{const prior=Object.getOwnPropertyDescriptor(object,key),native=object[key];if(prior&&(!('value'in prior)||!prior.writable))throw Error('qualified fault: unwritable hook '+key);
        const wrapped=factory(native);Object.defineProperty(object,key,{value:wrapped,writable:true,configurable:true,enumerable:prior?.enumerable??false});hooks.push({object,key,prior,wrapped});};
      const closeState=()=>{const p={currentSingleBaseBound:atlas.layout.tiers.close.looks.length===1};for(const[side,a]of Object.entries(game.baked.atlases))p[side]={fieldReady:a.loaded('field'),closePromise:!!a.state.close,closeTextures:!!a.textures.close,closeBatches:a.pools.reduce((n,p)=>n+p.batches.close.length,0),closeRequests:side==='CS'?candidateRequests+baselineRequests:0};return p;};
      const before=closeState(),baselineCloseJSON=JSON.stringify(atlas.layout.tiers.close),configurationOwner=I.configureSceneCloseRoute(scope,{manifest,sourceManifest,base,route:tuple.route,candidateRequests:()=>candidateRequests});
      const configuration={fieldUnchanged:configurationOwner.fieldUnchanged(),baseUnchanged:configurationOwner.fieldUnchanged(),nativeUSLoading:!game.baked.atlases.US.diagnosticClose,
        genuineCapability:tuple.route==='capable'&&configurationOwner.nativeCapability,maskedOnlyAstc:tuple.route==='unsupported'};
      // Registration precedes every mutation/load that can fail; final cleanup can settle all siblings.
      const owner={states,events,configurationOwner,baselineCloseJSON,release,closeState,get sequence(){return sequence;},take,
        async restore(){release(true);await Promise.allSettled(Object.values(game.baked.atlases).map(a=>a.state.close).filter(Boolean));const errors=[];
          for(const {object,key,prior,wrapped}of hooks.reverse()){try{if(object[key]!==wrapped)throw Error('hook ownership changed '+key);if(prior)Object.defineProperty(object,key,prior);else delete object[key];}catch(e){errors.push(e.message);}}return {ok:errors.length===0,errors};},
        snapshot(){return {states,events,candidateRequests,poolCount:atlas.pools.length};}};window.__qualifiedFault=owner;
      const gate=I.installRenderGate(post);window.__sceneRenderGate=gate;
      const terrain=P.installTerrainPartition(world,THREE,P.partitionTerrain,{reversible:true}),registration={restore(){let error;try{terrain.restore();}catch(e){error=e;}
        if(window.__sceneTerrainPartition!==registration)throw Error('fault terrain scope ownership changed');delete window.__sceneTerrainPartition;if(error)throw error;}};window.__sceneTerrainPartition=registration;
      game.__inactiveStats=I.installInactiveFigures(game);game.animate(0);
      const expected=I.deriveSceneStressContract(game.scenario,{US:{field:2,close:3},CS:{field:4,close:5}}),combat=()=>JSON.stringify({time:game.simTime,units:game.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,order:u.order,x:u.x,z:u.z}))}),
        roster=()=>game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}));
      const runStress=(mode,preload=false)=>{const warm=I.warmSceneStressBaseline(scope,expected,COMMAND.radius,mode),baseline=combat();A.initializeSceneTextures();
        const stress=I.runSceneStressTransaction({discovery:warm.discovery,draw:()=>gate.renderOnce(scene,camera),sample:label=>{
          for(const owner of warm.discovery.owners)for(const array of owner.arrays)window.__allocation.labelBufferOwners(gl,array,[owner.label]);
          return preload?take('preclose-'+label):{label,...A.sampleSceneAllocations(),sequence:++sequence};
        },verifyBaseline:()=>combat()===baseline,reservations:array=>window.__allocation.bufferReservations(gl,array)});
        return {stress,warm,baseline,combatUnchanged:combat()===baseline};};
      const warmed=runStress('preclose',true),preload={...warmed.stress,transaction:{...warmed.stress.transaction},sampleSequences:warmed.stress.transaction.samples.map(s=>s.observation.sequence),
        baseline:warmed.warm.baseline,retainedRoster:roster(),combatUnchanged:warmed.combatUnchanged,before,after:closeState()};delete preload.transaction.samples;
      if(!warmed.stress.ok||!warmed.combatUnchanged)throw Error('qualified fault: preload native stress failed');
      const observeClose=e=>{
        const operation=e.attempt+'-'+(e.operation==='uploaded'?'upload':e.operation==='dispose-result'?'dispose':e.operation),data={page:e.page,encoding:e.encoding,index:e.index};
        if(e.textureUUID)data.textureId=id(e.textureUUID);if(e.outcome)data.outcome=e.outcome;if(e.ok!==undefined)data.ok=e.ok;if(e.error)data.error=e.error;
        if(e.attempt==='candidate'&&e.operation==='created'&&e.page===target)targetUUID=e.textureUUID;
        if(e.attempt==='baseline'&&e.operation==='uploaded'){const event=emit('baseline-upload',{...data,beforeSample:true});take('baseline-upload',{page:e.page},event);}else emit(operation,data);
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
    },{manifest:input.manifest,sourceManifest:input.source,base:routes.base,tuple,target});
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
          try{restoration=I.restoreSceneDiagnostics(window,{sampleRestored:()=>{const {post,scene,camera}=window.__game;window.__sceneRenderGate.renderOnce(scene,camera);const pending=owner.take('restored-native-pending');post.renderer.getContext().finish();return [pending,owner.take('restored-native-settled')];}});}catch(e){restoration={ok:false,errors:[e.message],samples:[]};}
          try{window.__sceneStartGate.restore();const p=window.__sceneStartNative,d=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');if(window.requestAnimationFrame!==p.native||!['value','writable','enumerable','configurable','get','set'].every(k=>d?.[k]===p.descriptor?.[k]))throw Error('startup descriptor drift');}catch(e){hooks.ok=false;hooks.errors.push(e.message);}
          const snapshot=owner?.snapshot();return {restoration:{...restoration,configuration,hooks,settings,ok:restoration.ok&&configuration.ok&&hooks.ok&&settings.ok},snapshot,errors};
        });
        if(!row.states.length&&cleanup.snapshot){Object.assign(row,cleanup.snapshot);const restored=new Set(cleanup.restoration.samples.map(s=>s.sequence));row.states=row.states.filter(s=>!restored.has(s.sequence));}
        row.restoration=cleanup.restoration;
        // Each sample appears once; preserve actual monotonic event/sample order across collections.
        const list=[...row.states,...(row.stress?.transaction.samples||[]).map(s=>s.observation),...row.restoration.samples].sort((a,b)=>a.sequence-b.sequence),mapped=new Map();
        for(const raw of list)if(!mapped.has(raw))mapped.set(raw,compact(raw));
        row.states=row.states.map(s=>mapped.get(s));if(row.stress)row.stress.transaction.samples=row.stress.transaction.samples.map(s=>({...s,observation:mapped.get(s.observation)}));row.restoration.samples=row.restoration.samples.map(s=>mapped.get(s));
      }
    }catch(error){row.restoration={ok:false,errors:[error.message]};if(!primary)throw error;}
    finally{
      const routeErrors=[];try{await routes?.restore();}catch(e){routeErrors.push(e.message);}try{if(faultHTTPHandler)await ctx.unroute(expected404,faultHTTPHandler);}catch(e){routeErrors.push(e.message);}
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
  const sceneRoutes=process.env.SCENE_ROUTES||'current-png',qualified=sceneRoutes==='qualified-both';
  if(!['current-png','qualified-both'].includes(sceneRoutes)||qualified&&(!inactive||!partition))throw Error('scene allocation: explicit routes require both prototypes');
  const phases=campaign.phases.map(entry=>{const pack=JSON.parse(fs.readFileSync(path.join(ROOT,`assets/packs/${entry.packId}.json`)));return {...entry,scenario:prepareFieldScenario(preparePhase(pack,entry.phaseId).scenario,'pack')};});
  // Immutable acquisition and fresh runner-only materialization precede browser launch.
  const input=qualified?await acquireQualifiedHybrid(JSON.parse(fs.readFileSync(path.join(ROOT,'assets/figures/confederate-infantry/soldier.json')))):null,
    transport=qualified?materializeQualifiedSceneInput(input):null,matrix=qualified?sceneMatrixContract(phases):null;
  const report={diagnosticOnly:true,fieldable:false,toolSha:process.env.GITHUB_SHA,route:'current PNG, both armies',cases:[],complete:false,
    inactivePrototype:inactive,
    terrainPartitionPrototype:partition,terrainRestorationObserved:partition,
    limits:{gpuBytes:250000000},nativeDriverMemory:'UNRUN',cpuDecodePeak:'UNRUN',
    unverified:['native driver storage/pools and deferred releases after context destruction','whole-fight effect maximum beyond exercised frames','future sandbox spawns beyond declared pools','CPU image decode/upload-copy peaks']};
  if(qualified)Object.assign(report,{sceneRoutes,normalMotion:true,nativeHistoryRequired:true,qualification:{...QUALIFIED_HYBRID,members:[...transport.files].map(([name,file])=>({name,bytes:file.bytes.length,sha256:file.sha256}))},faults:[]});
  const source={ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),...(qualified?{nativeJournal:true}:{})};
  const {server,url}=await startServer({port:0});let browser;
  const save=()=>{const envelope=sceneReportEnvelope(report);if(!envelope.withinLimit){
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
      const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,reducedMotion:qualified?'no-preference':'reduce'});
      const errors=[],row={...entry,states:[],errors,...(qualified?{contextId:`${entry.packId}/${entry.phaseId}/${entry.route}/ordinary`,history:createSceneHistory(),scenario:phases.find(p=>p.packId===entry.packId&&p.phaseId===entry.phaseId).scenario}:{})};report.cases.push(row);let sequence=0,page,routes,primary;
      const observation=data=>qualified?compactSceneSample(row.history,{...data,sequence:++sequence}):data;
      try{
      await ctx.addInitScript(installAllocationObserver,source);
      if(qualified)await ctx.addInitScript(source=>{window.__sceneStartNative={native:window.requestAnimationFrame,descriptor:Object.getOwnPropertyDescriptor(window,'requestAnimationFrame')};window.__sceneStartGate=(0,eval)('('+source+')')();},installSceneStartGate.toString());
      routes=qualified?await installQualifiedSceneRoutes(ctx,new URL(url).origin,transport.files):null;
      page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.goto(`${url}?battle=${entry.packId}&phase=${entry.phaseId}&quality=high&nosw${qualified?'&figures=rigged':''}`);
        await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
        if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
        await page.evaluate(async qualified=>{
          const {game}=window.__game;if(!game.paused)game.togglePause();
          const S=await import('./src/settings.js');if(qualified){const {LOOK}=await import('./src/ui/look.js');window.__qualifiedSettings={values:S.all().map(({key,value,locked})=>({key,value,locked})),look:JSON.stringify(LOOK)};}else S.set('look.figureStyle','baked');game.ensureBaked();
        },qualified);
        await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
        if(qualified){
          const configured=await page.evaluate(async({manifest,sourceManifest,base,route})=>{
            const {configureSceneCloseRoute,installRenderGate}=await import('./tools/bake/inactive-figures.mjs'),THREE=await import('three'),{game,post}=window.__game;
            if(game.simTime!==0||!game.paused||window.__sceneStartGate.first?.simTime!==0)throw Error('qualified scene: native time-zero startup required');
            const preclose={currentSingleBaseBound:game.baked.atlases.CS.layout.tiers.close.looks.length===1};
            for(const [side,a]of Object.entries(game.baked.atlases))preclose[side]={fieldReady:a.loaded('field'),closePromise:!!a.state.close,closeTextures:!!a.textures.close,closeBatches:a.pools.reduce((n,p)=>n+p.batches.close.length,0),closeRequests:0};
            window.__qualifiedCandidateRequests=0;
            const owner=configureSceneCloseRoute(window.__game,{manifest,sourceManifest,base,route,candidateRequests:()=>window.__qualifiedCandidateRequests}),atlas=game.baked.atlases.CS;
            window.__qualifiedConfiguration=owner;window.__qualifiedIO=Object.getOwnPropertyDescriptor(atlas,'io');
            const io={...atlas.io,fetch:input=>{if(String(input).startsWith(base))window.__qualifiedCandidateRequests++;return fetch(input);},loadPNG:input=>{if(String(input).startsWith(base))window.__qualifiedCandidateRequests++;return new THREE.TextureLoader().loadAsync(input);}};
            atlas.io=io;window.__qualifiedInstalledIO=io;window.__sceneRenderGate=installRenderGate(post);
            return {preclose,configuration:{fieldUnchanged:owner.fieldUnchanged(),baseUnchanged:owner.fieldUnchanged(),nativeUSLoading:!game.baked.atlases.US.diagnosticClose,
              genuineCapability:route==='capable'&&owner.nativeCapability,maskedOnlyAstc:route==='unsupported'},scenario:game.scenario,ordinaryRoster:game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}))};
          },{manifest:input.manifest,sourceManifest:input.source,base:routes.base,route:entry.route});
          if(JSON.stringify(configured.scenario)!==JSON.stringify(row.scenario))throw Error('qualified scene: live scenario differs from trusted authored preparation');Object.assign(row,configured);
          await page.evaluate(async()=>{const S=await import('./src/settings.js');S.set('look.figureStyle','baked');window.__game.game.animate(0);});
        }
        const capture=async label=>{
          await page.evaluate(initializeSceneTextures);
          const drawing=await page.evaluate(()=>{const {post,scene,camera}=window.__game,r=post.renderer,prior=r.info.autoReset;r.info.autoReset=false;r.info.reset();try{if(window.__sceneRenderGate)window.__sceneRenderGate.renderOnce(scene,camera);else post.render(scene,camera);r.getContext().finish();return {drawCalls:r.info.render.calls,nativeRenders:window.__sceneRenderGate?.count??null};}finally{r.info.autoReset=prior;}});
          const data=await page.evaluate(inventory);row.states.push(observation({label,...drawing,...data}));save();
          if(data.glError||data.allocation.unknown.length||data.unmappedBufferBytes!==0||errors.length)throw new Error(`scene allocation: ${entry.phaseId}/${label} incomplete: GL${data.glError}, unmapped ${data.unmappedBufferBytes}, ${data.allocation.unknown.join(',')}, ${errors.join(',')}`);
          console.log(entry.phaseId,label,JSON.stringify({reservation:data.conservativeReservation,...data.allocation.byKind,arrays:data.declaredArrayBytes,pages:data.atlasPages}));
        };
        const canvasShot=async (filename,label=filename)=>{
          if(qualified)filename=`${entry.packId}-${entry.phaseId}-${entry.route}-${filename}`;
          const shot=await page.evaluate(async({source,bindWorld})=>{
            const S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js'),{post,scene,camera,rts,game,world}=window.__game;
            const png=(0,eval)('('+source+')')(post,scene,camera,window.__sceneRenderGate),receipt={...png,style:S.get('look.figureStyle'),comparison:C.compareState(),simTime:game.simTime,
              camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far,goal:{...rts.goal}}};
            if(bindWorld){
              const pending=[];
              const fingerprint=(root,kind)=>{const owners=[];root.traverse(mesh=>{if(!mesh.geometry)return;const arrays=[];
                const add=(key,attribute)=>{const a=attribute?.isInterleavedBufferAttribute?attribute.data.array:attribute?.array;if(!a)return;
                  const bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength).slice(),record={key,bytes:bytes.length};arrays.push(record);
                  pending.push(crypto.subtle.digest('SHA-256',bytes).then(hash=>{record.sha256=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');}));};
                for(const [key,a]of Object.entries(mesh.geometry.attributes))add(key,a);add('index',mesh.geometry.index);add('instanceMatrix',mesh.instanceMatrix);add('instanceColor',mesh.instanceColor);
                owners.push({mesh:mesh.uuid,geometry:mesh.geometry.uuid,material:Array.isArray(mesh.material)?mesh.material.map(m=>m.uuid):mesh.material?.uuid,instances:mesh.isInstancedMesh?mesh.count:null,arrays});});
                return {kind,root:root.uuid,count:root.userData.count??null,owners};};
              receipt.world={terrain:fingerprint(world.terrainMesh,'native terrain geometry'),trees:fingerprint(world.trees,'native tree instances')};
              receipt.roster=game.units.map(u=>({id:u.id,side:u.side,type:u.type,men:u.men,x:u.x,z:u.z,order:u.order}));await Promise.all(pending);
            }return receipt;
          },{source:renderCanvasPng.toString(),bindWorld:qualified&&entry.phaseId==='lookout-mountain'});
          if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(shot.dataUrl)||shot.nativeRenders!==1||shot.glError||shot.width!==shot.drawingWidth||shot.height!==shot.drawingHeight||!shot.width||!shot.height)throw new Error('scene canvas: invalid actual draw/readback metadata');
          const bytes=Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length),'base64'),png=PNG.sync.read(bytes);
          let opaque=false,nonuniform=false;for(let i=0;i<png.data.length;i+=4){if(png.data[i+3])opaque=true;for(let c=0;c<4;c++)if(png.data[i+c]!==png.data[c])nonuniform=true;}
          if(png.width!==shot.width||png.height!==shot.height||!opaque||!nonuniform)throw new Error('scene canvas: dimensions/visible/nonuniform content not proved');
          fs.writeFileSync(path.join(out,filename),bytes);delete shot.dataUrl;
          row.canvasCaptures||=[];row.canvasCaptures.push({filename,label,phase:entry.phaseId,toolSha:report.toolSha,...shot,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),opaque,nonuniform,kind:'battlefield-canvas capture; DOM HUD excluded'});save();
        };
        if((inactive||partition)&&entry.phaseId==='lookout-mountain')await page.evaluate(source=>{
          const {post,rts,game,camera}=window.__game;if(!window.__sceneRenderGate)window.__sceneRenderGate=(0,eval)('('+source+')')(post);
          for(let i=0;i<12;i++)rts.update(1);game.setView(camera,innerHeight*post.scale);game.animate(0);
        },installRenderGate.toString());
        await capture('field');
        if(partition){
          if(entry.phaseId==='lookout-mountain')await canvasShot('terrain-partition-01-before.png');
          row.partition=await page.evaluate(async source=>{const THREE=await import('three'),P=(0,eval)('('+source.partition+')'),install=(0,eval)('('+source.install+')');
            if(Object.hasOwn(window,'__sceneTerrainPartition'))throw new Error('terrain partition: diagnostic scope already owned');
            const owner=install(window.__game.world,THREE,P,{reversible:true}),registration={restore(){
              let error;try{owner.restore();}catch(e){error=e;}
              if(window.__sceneTerrainPartition!==registration)throw new Error('terrain partition: diagnostic registration changed');
              delete window.__sceneTerrainPartition;if(error)throw error;
            }};window.__sceneTerrainPartition=registration;return {...owner};
          },{partition:partitionTerrain.toString(),install:installTerrainPartition.toString()});
          if(!row.partition.materialShared||row.partition.triangles!==row.partition.statTriangles)throw new Error('terrain partition: material/stat seam changed');
          await capture('partition-field');
          if(entry.phaseId==='lookout-mountain'){
            await canvasShot('terrain-partition-02-after.png');
            await page.mouse.move(700,300);await page.mouse.wheel(0,-400);await page.waitForTimeout(1000);await capture('partition-native-zoom');
            await canvasShot('terrain-partition-03-zoom.png');
          }
        }
        if(inactive){await page.evaluate(source=>{const g=window.__game.game;g.__inactiveStats=(0,eval)('('+source+')')(g);g.animate(0);},installInactiveFigures.toString());await capture('inactive-field');}
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
            row.framedComparison=await page.evaluate(()=>{
              const {game:g,rts,camera,post}=window.__game,u=g.units.find(u=>u.side==='US'&&u.type==='infantry'&&u.alive);
              if(!u)throw new Error('combined prototype: living formation needed for readable comparison');
              rts.flyTo(u.x,u.z,200);for(let i=0;i<12;i++)rts.update(1);g.setView(camera,innerHeight*post.scale);g.animate(0);
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
              sample:()=>{const gl=post.renderer.getContext();for(const owner of warm.discovery.owners)for(const array of owner.arrays)window.__allocation.labelBufferOwners(gl,array,[owner.label]);return A.sampleSceneAllocations();},
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
          const restore=(0,eval)('('+source.restore+')'),sample=(0,eval)('('+source.sample+')');
          return restore(window,{sampleRestored:()=>{
            const {post,scene,camera}=window.__game;
            if(window.__sceneRenderGate)window.__sceneRenderGate.renderOnce(scene,camera);else post.render(scene,camera);
            const pending={label:'restored-native-pending',...sample()};post.renderer.getContext().finish();
            return [pending,{label:'restored-native-settled',...sample()}];
          }});
        },{restore:restoreSceneDiagnostics.toString(),sample:inventory.toString()});}
        catch(error){row.restoration={ok:false,errors:[error.message]};}
        try{if(qualified){
          try{await page.evaluate(()=>{window.__sceneStartGate.restore();const prior=window.__sceneStartNative,after=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');if(window.requestAnimationFrame!==prior.native||!['value','writable','enumerable','configurable','get','set'].every(k=>after?.[k]===prior.descriptor?.[k]))throw Error('qualified startup descriptor restore failed');});}catch(e){hooks={ok:false,errors:[...(hooks.errors||[]),e.message]};}
          try{await routes?.restore();}catch(e){routeRestoration={ok:false,errors:[e.message]};}
          Object.assign(row.restoration,{configuration,hooks,settings,routes:routeRestoration});
          if(![configuration,hooks,settings,routeRestoration].every(r=>r.ok))row.restoration.ok=false;
          row.restoration.samples=(row.restoration.samples||[]).map(observation);row.routeRequests=routes?.requests||[];
        }}finally{await ctx.close();if(qualified)row.contextClosed=true;save();}
        if(!row.restoration.ok&&!primary)throw new Error(`scene allocation: restoration failed: ${(row.restoration.errors||[]).join(', ')}`);
      }
      console.log(`SCENE ${index+1}/${campaign.phases.length} complete`);
    }
    if(qualified){
      for(const [index,tuple]of matrix.faults.entries()){await qualifiedFaultContext({browser,url,tuple,input,transport,source,phases,report,save});console.log(`SCENE FAULT ${index+1}/${matrix.faults.length} complete`);}
    }else{
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
    const verdict=reduceSceneObservations(report,qualified?phases:campaign.phases);
    Object.assign(report,verdict);
    save();console.log('SCENE-ALLOCATION COMPLETE',JSON.stringify({complete:report.complete,maxReservation:report.maxReservation,maxGpuReservation:report.maxGpuReservation,withinLimit:report.withinLimit,fieldable:false}));
    if(!report.complete)process.exitCode=1; // Budget failures are results, not a reason to discard the observation.
  }finally{try{save();}finally{try{if(browser)await browser.close();}finally{await new Promise(resolve=>server.close(resolve));}}}
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});

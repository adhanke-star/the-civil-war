// Actions-only actual pool owners. No diagnostic lifecycle or flush wrappers.
import {isDeepStrictEqual} from 'node:util';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,createSceneHistory,compactSceneSample,expandSceneContext,lostRetirementValid} from './bake/scene-allocation.mjs';

export async function poolResourceControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:128,height:96},deviceScaleFactor:1}),errors=[];
 try{
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  const page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const proof=await page.evaluate(async()=>{
   const THREE=await import('three'),{SoldierPool,FallenPool,FALLEN,UNIFORMS}=await import('./src/units/soldier-mesh.js'),{sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
   const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),gl=renderer.getContext(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,100);
   renderer.setSize(64,64);scene.background=new THREE.Color(0x172433);camera.position.set(2.5,2.5,5);camera.lookAt(0,.7,0);camera.updateMatrixWorld();scene.add(new THREE.AmbientLight(0xffffff,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-3,6,4);scene.add(sun);
   const standing=new SoldierPool(4,UNIFORMS.US,{resourceLifetime:true,renderer}),fallen=new FallenPool(4,UNIFORMS.US,{resourceLifetime:true,renderer});scene.add(standing.mesh,fallen.mesh);standing.setView(camera,64);
   const meshes=[...standing.buckets.flatMap(b=>[b.mesh,...(b.outline?[b.outline]:[])]),fallen.mesh],
    refs=meshes.map(m=>({m,g:m.geometry,material:m.material,matrix:m.instanceMatrix,attributes:Object.entries(m.geometry.attributes),index:m.geometry.index})),
    oldFallen={gore:FALLEN.gore,clock:FALLEN.clock};let clock=0;FALLEN.clock=()=>clock;FALLEN.gore=true;
   const scope={__game:{scene,post:{renderer},game:{pools:{US:standing},fallen:{US:fallen},baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:64,innerHeight:64,devicePixelRatio:1},proof={states:[],frames:[],cleanup:[],errors:[]};
   const sample=label=>{const s={label,sequence:proof.states.length+1,...sampleSceneAllocations(scope)};proof.states.push(s);return s;};
   const frame=label=>{renderer.render(scene,camera);const a=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,a);const f={label,width:64,height:64,pixels:btoa(String.fromCharCode(...a)),nonuniform:a.some((v,i)=>i%4<3&&v!==a[i%4]),drawCalls:renderer.info.render.calls,glError:gl.getError()};proof.frames.push(f);return f;};
   const fill=()=>{standing.begin();standing.push(0,0,0,0,1,0,0,0,0,.2,.4,1,0);standing.flush();},empty=()=>{standing.begin();standing.flush();};
   const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{renderer.domElement.removeEventListener(name,done);reject(Error('pool native '+name+' timeout'));},20000);function done(){clearTimeout(timer);resolve();}renderer.domElement.addEventListener(name,done,{once:true});});
   try{
    renderer.render(scene,camera);const cold=sample('cold');proof.coldHidden=meshes.every(m=>!m.visible);proof.coldBuffers=cold.allocation.byKind.buffer;
    fill();frame('standing-original');const warm=sample('standing-warm');proof.standingIds=warm.bufferOwnership.map(r=>r.id);
    empty();sample('standing-retired');const calls=window.__allocation.nativeCalls(gl);empty();empty();proof.continuousInactiveCallsStable=JSON.stringify(calls)===JSON.stringify(window.__allocation.nativeCalls(gl));
    standing.setOutline(false);proof.hiddenOutlinePreference=standing.buckets.every(b=>!b.outline||!b.outline.visible);fill();frame('standing-body');sample('standing-body');
    empty();standing.setOutline(true);proof.outlineStillHidden=standing.buckets.every(b=>!b.outline||!b.outline.visible);fill();frame('standing-restored');sample('standing-reactivated');
    empty();sample('standing-final-retired');
    const casualty=fallen.alloc();fallen.set(casualty,0,0,0,0,1,false,.2,.4,true);fallen.flush();frame('fallen-original');const fw=sample('fallen-warm');proof.fallenIds=fw.bufferOwnership.map(r=>r.id);
    fallen.setBakedClip(2);fallen.flush();sample('fallen-retired');clock=100000;FALLEN.gore=false;fallen.flush();proof.hiddenFade={visible:fallen.mesh.visible,hiddenTo:fallen.hiddenTo,clip:fallen.clip.array[0]};
    FALLEN.gore=true;fallen.setBakedClip(0);fallen.flush();frame('fallen-restored');sample('fallen-reactivated');proof.goreRestored=fallen.hiddenTo===0&&fallen.clip.array[0]===0&&fallen.mesh.instanceMatrix.array[13]===fallen.baseY[0];
    fallen.setBakedClip(2);fallen.flush();sample('fallen-final-retired');
    fill();frame('before-loss');sample('before-loss');const properties=renderer.properties,before=window.__allocation.nativeRetirementState(gl),lost=event('webglcontextlost');renderer.forceContextLoss();await lost;
    empty();standing.setOutline(false);fill();const after=window.__allocation.nativeRetirementState(gl);standing.flush();fallen.flush();const repeated=window.__allocation.nativeRetirementState(gl);
    proof.loss={actualLost:gl.isContextLost(),before,after,repeated,outgoing:before.bufferSlots.filter(b=>!b.pendingDelete).map(b=>b.id),hidden:meshes.every(m=>!m.visible),state:standing.resourceSnapshot()};
    await new Promise(resolve=>setTimeout(resolve,0));const restored=event('webglcontextrestored');renderer.forceContextRestore();await restored;
    proof.freshProperties=renderer.properties!==properties;sample('context-before-completion');standing.flush();fallen.flush();sample('context-completed');frame('standing-context-body');sample('context-reactivated');
    standing.setOutline(true);frame('standing-context-original');sample('context-outlined');proof.contextState=standing.resourceSnapshot();
    proof.identities=refs.every(r=>r.m.geometry===r.g&&r.m.material===r.material&&r.m.instanceMatrix===r.matrix&&r.g.index===r.index&&r.attributes.every(([k,a])=>r.g.attributes[k]===a));
   }catch(e){proof.errors.push(String(e?.message??e));}
   finally{
    Object.assign(FALLEN,oldFallen);const attempt=(name,fn)=>{try{fn();proof.cleanup.push({name,ok:true});}catch(e){proof.cleanup.push({name,ok:false,error:String(e?.message??e)});}};
    if(!gl.isContextLost()){attempt('standing-empty',empty);attempt('fallen-hidden',()=>{fallen.setBakedClip(2);fallen.flush();});}
    attempt('standing-owner-close',()=>{if(!standing.disposeResourceLifetime())throw Error('standing close deferred');});attempt('fallen-owner-close',()=>{if(!fallen.disposeResourceLifetime())throw Error('fallen close deferred');});
    attempt('detach',()=>scene.remove(standing.mesh,fallen.mesh));
    for(const [i,g]of [...new Set(refs.map(r=>r.g))].entries())attempt('geometry-'+i,()=>g.dispose());
    for(const [i,m]of meshes.entries())attempt('instance-'+i,()=>m.dispose());
    for(const [i,m]of [...new Set(refs.map(r=>r.material))].entries())attempt('material-'+i,()=>m.dispose());
    attempt('renderer',()=>renderer.dispose());if(!gl.isContextLost()){attempt('finish',()=>gl.finish());attempt('sample',()=>sample('cleanup'));}else proof.cleanup.push({name:'lost-cleanup',ok:false});
    attempt('context',()=>renderer.forceContextLoss());
   }return proof;
  });
  result.poolResourceProof=proof;
  const state=label=>proof.states.find(s=>s.label===label),frame=label=>proof.frames.find(f=>f.label===label),equal=(a,b)=>!!frame(a)&&!!frame(b)&&frame(a).pixels===frame(b).pixels,
   clean=s=>s&&!s.glError&&!s.unmappedBufferBytes&&!s.allocation.unknown.length,
   retired=s=>clean(s)&&s.allocation.byKind.buffer===0&&s.allocation.pendingDeleteBytes===0&&s.bufferOwnership.length===0;
  const ordered=(outgoing,incoming,events)=>{
   if(!outgoing?.length||!incoming?.length)return false;let last=-1;
   for(const id of outgoing){const d=events.findIndex(e=>e.kind==='buffer'&&e.id===id&&e.operation==='retire'),r=events.findIndex(e=>e.kind==='buffer'&&e.id===id&&e.operation==='release');if(d<0||r<=d||!events.slice(d+1,r).some(e=>e.operation==='finish'))return false;last=Math.max(last,r);}
   return incoming.every(id=>!outgoing.includes(id)&&events.findIndex(e=>e.kind==='buffer'&&e.id===id&&e.operation==='reserve')>last);
  },standingNew=state('standing-reactivated')?.bufferOwnership.map(r=>r.id)||[],fallenNew=state('fallen-reactivated')?.bufferOwnership.map(r=>r.id)||[],
   standingOrder=ordered(proof.standingIds,standingNew,state('standing-reactivated')?.allocation.nativeEvents||[]),fallenOrder=ordered(proof.fallenIds,fallenNew,state('fallen-reactivated')?.allocation.nativeEvents||[]);
  check('pool-resource-cold',proof.coldHidden&&proof.coldBuffers===0,'actual enabled cold pools upload no native geometry');
  check('pool-resource-standing-retirement',retired(state('standing-retired'))&&retired(state('standing-final-retired'))&&standingOrder,'actual shared body/outline storage retire-finish-release before fresh native reserves');
  check('pool-resource-continuous-inactive',proof.continuousInactiveCallsStable,'no repeated disposal/completion while continuously inactive');
  check('pool-resource-outline-preference',proof.hiddenOutlinePreference&&proof.outlineStillHidden&&equal('standing-original','standing-restored')&&!equal('standing-original','standing-body'),'hidden outline changes preserved, full original outlined RGBA restored, body-only distinct');
  check('pool-resource-fallen-retirement',retired(state('fallen-retired'))&&retired(state('fallen-final-retired'))&&fallenOrder,'actual casualty geometry/instance owners retire before reactivation');
  check('pool-resource-hidden-fade',proof.hiddenFade?.visible===false&&proof.hiddenFade.hiddenTo===1&&proof.hiddenFade.clip===2&&proof.goreRestored,'CPU fades/clips/gore restoration remain live while native owners are hidden');
  check('pool-resource-fallen-whole-pixels',equal('fallen-original','fallen-restored'),'whole real casualty RGBA equal after all-clipped/gore cycle');
  const lossValid=proof.loss?.actualLost&&proof.loss.hidden&&lostRetirementValid(proof.loss.before,proof.loss.after,proof.loss.outgoing)&&isDeepStrictEqual(proof.loss.after,proof.loss.repeated),pending=state('context-before-completion');
  check('pool-resource-loss-deferred',lossValid&&proof.loss.state.buckets.some(b=>b.pending&&b.requested)&&proof.loss.outgoing.every(id=>pending?.bufferOwnership.some(b=>b.id===id&&b.pendingDelete)),'genuine loss retires only captured buffers/VAOs once without upload/draw/finish/release; latest state and pending bytes retained');
  check('pool-resource-loss-restored',proof.freshProperties&&proof.contextState?.buckets.every(b=>!b.pending)&&equal('standing-body','standing-context-body')&&equal('standing-original','standing-context-original'),'fresh Three context; normal flush resumes retirement before actual reupload; latest outline preference retained');
  check('pool-resource-identities',proof.identities,'all actual pool/material/geometry/attribute/instance owners retained');
  check('pool-resource-whole-frames',proof.frames.length===8&&proof.frames.every(f=>f.width===64&&f.height===64&&!f.glError&&f.nonuniform&&f.drawCalls>0&&Buffer.from(f.pixels,'base64').length===16384),'all eight complete RGBA frames retained and nonblank');
  const events=state('standing-reactivated')?.allocation.nativeEvents||[],first=events.find(e=>e.kind==='buffer'&&standingNew.includes(e.id)&&e.operation==='reserve'),bad=first?[first,...events.filter(e=>e!==first)]:[];
  check('pool-resource-overlap-refusal',standingOrder&&!!first&&!ordered(proof.standingIds,standingNew,bad),'early incoming native reserve cannot pass the lifetime proof');
  let replay=false,reject=false;try{const history=createSceneHistory(),compact={history,states:proof.states.map(s=>compactSceneSample(history,s))};proof.nativeHistory=compact;replay=isDeepStrictEqual(expandSceneContext(compact).states,proof.states);const bad=structuredClone(compact);bad.history.nativeEvents[0].sequence=999999;try{expandSceneContext(bad);}catch{reject=true;}}catch(e){proof.replayError=String(e);}
  check('pool-resource-native-history',replay&&reject,'complete event/slot native history and rejecting malformed chronology');
  check('pool-resource-native-cleanup',proof.cleanup.every(r=>r.ok)&&retired(proof.states.at(-1)),'independent cleanup leaves zero native geometry or pending deletes');
  check('pool-resource-native-health',proof.states.every(clean)&&proof.errors.length===0&&errors.length===0,JSON.stringify({errors,owner:proof.errors}));
 }finally{await ctx.close();}
}

// Real Game construction/atlas I/O/figure closure, without replacing lifecycle methods.
export async function gameFigureResourceControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:128,height:96},deviceScaleFactor:1}),errors=[];
 try{
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  const page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
  const p=await page.evaluate(async()=>{
   const THREE=await import('three'),{Game}=await import('./src/game.js'),{prepareFieldScenario}=await import('./src/sim/phase.js'),{setPlan}=await import('./src/world/landscape.js'),{LOOK}=await import('./src/ui/look.js'),{sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs');
   const scenario=await(await fetch('./assets/scenarios/henry-hill.json')).json();scenario.units=[scenario.units.find(u=>u.side==='US'),scenario.units.find(u=>u.side==='CS')];prepareFieldScenario(scenario,'henry-hill');setPlan(scenario);LOOK.figureStyle='rigged';
   const scene=new THREE.Scene();scene.background=new THREE.Color(0x172433);const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),gl=renderer.getContext();renderer.setSize(64,64);
   const camera=new THREE.PerspectiveCamera(35,1,.1,1000),u=scenario.units[0];camera.position.set(u.x+8,10,u.z+20);camera.lookAt(u.x,1,u.z);camera.updateMatrixWorld();scene.add(new THREE.AmbientLight(0xffffff,2));
   const game=new Game({scene,terrain:{half:3500,heightAt:()=>0,slopeAt:()=>0,inBounds:()=>true},scenario,world:{fenceField:null},effects:{volley(){},boom(){}},figureResourceLifetime:true,renderer}),pools=[...Object.values(game.pools),...Object.values(game.fallen)],roots=[...pools,...Object.values(game.impostors)].map(p=>p.mesh),meshes=[...Object.values(game.pools).flatMap(p=>p.buckets.flatMap(b=>[b.mesh,...(b.outline?[b.outline]:[])])),...Object.values(game.fallen).map(p=>p.mesh)],refs=meshes.map(m=>({m,g:m.geometry,material:m.material,matrix:m.instanceMatrix,index:m.geometry.index,attrs:Object.entries(m.geometry.attributes)}));
   const scope={__game:{scene,game,post:{renderer}},__allocation:window.__allocation,innerWidth:64,innerHeight:64,devicePixelRatio:1},proof={states:[],frames:[],cleanup:[],errors:[],configured:game.figureResourceLifetime&&pools.every(p=>p.resourceLifetime),coldHidden:pools.every(p=>p.resourceSnapshot().buckets.every(b=>!b.visible))};
   const sample=label=>{const s={label,sequence:proof.states.length+1,...sampleSceneAllocations(scope)};proof.states.push(s);return s;},frame=label=>{renderer.render(scene,camera);const a=new Uint8Array(16384);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,a);proof.frames.push({label,width:64,height:64,pixels:btoa(String.fromCharCode(...a)),calls:renderer.info.render.calls,glError:gl.getError()});};
   try{
    game.setView(camera,64);game.animate(0);frame('original');sample('warm');
    const arrays=new Set(meshes.flatMap(m=>[...Object.values(m.geometry.attributes),m.geometry.index,m.instanceMatrix].filter(Boolean).map(a=>a.array)));proof.ids=[...new Set([...arrays].flatMap(a=>window.__allocation.bufferReservations(gl,a).map(r=>r.id)))];
    proof.loaded=await game.ensureBaked();proof.atlasSides=Object.keys(game.baked.atlases||{});const textures=Object.values(game.baked.atlases||{}).flatMap(a=>Object.values(a.textures).flat());proof.textureCount=textures.length;
    for(const pool of Object.values(game.impostors))pool.allowClose=false;LOOK.figureStyle='baked';game.animate(0);frame('baked');sample('baked-warm');
    const batches=Object.values(game.impostors).flatMap(pool=>pool.batches.field);proof.spriteIds=[...new Set(batches.flatMap(b=>window.__allocation.bufferReservations(gl,b.buf.array).map(r=>r.id)))];
    proof.textureIds=textures.map(t=>window.__allocation.textureReservation(gl,renderer.properties.get(t).__webglTexture)).filter(Boolean).map(r=>r.id);
    const quad=batches[0]?.geo;proof.sharedQuad=quad?[...new Map([quad.attributes.position.array,quad.index.array].flatMap(a=>window.__allocation.bufferReservations(gl,a)).map(r=>[r.id,{id:r.id,bytes:r.bytes}])).values()]:[];
    proof.closed=await game.closeFigureResources();sample('closed');proof.detached=roots.every(m=>!m.visible&&!m.parent);proof.unpublished=game.baked.state==='closed'&&game.baked.atlas===null&&game.baked.atlases===null&&Object.values(game.impostors).every(p=>!p.atlas&&Object.values(p.batches).every(b=>!b.length));
    proof.identities=refs.every(r=>r.m.geometry===r.g&&r.m.material===r.material&&r.m.instanceMatrix===r.matrix&&r.g.index===r.index&&r.attrs.every(([k,a])=>r.g.attributes[k]===a));
    const calls=window.__allocation.nativeCalls(gl);proof.repeat=await game.closeFigureResources();proof.repeatStable=JSON.stringify(calls)===JSON.stringify(window.__allocation.nativeCalls(gl));frame('closed');frame('closed-again');sample('after-frames');
   }catch(e){proof.errors.push(String(e?.message??e));}
   finally{
    const attempt=(name,fn)=>{try{fn();proof.cleanup.push({name,ok:true});}catch(e){proof.cleanup.push({name,ok:false,error:String(e?.message??e)});}};
    try{await game.closeFigureResources();}catch(e){proof.cleanup.push({name:'game-close',ok:false,error:String(e?.message??e)});}
    const geometries=new Set(),materials=new Set(),instances=[];scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.isInstancedMesh)instances.push(o);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
    for(const g of geometries)attempt('remaining-geometry',()=>g.dispose());for(const m of instances)attempt('remaining-instance',()=>m.dispose());for(const m of materials)attempt('remaining-material',()=>m.dispose());attempt('renderer',()=>renderer.dispose());attempt('finish',()=>gl.finish());attempt('sample',()=>sample('cleanup'));attempt('context',()=>renderer.forceContextLoss());
   }return proof;
  });
  result.gameFigureResourceProof=p;
  const state=label=>p.states.find(s=>s.label===label),clean=s=>s&&!s.glError&&!s.unmappedBufferBytes&&!s.allocation.unknown.length;
  check('game-figure-constructor',p.configured&&p.coldHidden,'all four actual Game pools configured before constructor flush');
  const closedEvents=state('closed')?.allocation.nativeEvents.slice(state('baked-warm')?.allocation.nativeEvents.length)||[],retired=(kind,id)=>{const d=closedEvents.findIndex(e=>e.kind===kind&&e.id===id&&e.operation==='retire'),r=closedEvents.findIndex(e=>e.kind===kind&&e.id===id&&e.operation==='release');return d>=0&&r>d&&closedEvents.slice(d+1,r).some(e=>e.operation==='finish');};
  const atlasNative=p.spriteIds?.length>0&&p.textureIds?.length>0&&p.spriteIds.every(id=>retired('buffer',id))&&p.textureIds.every(id=>retired('texture',id));
  check('game-figure-atlas-settlement',atlasNative&&p.loaded&&JSON.stringify(p.atlasSides)===JSON.stringify(['US','CS'])&&p.textureCount>0&&p.unpublished,'actual both-side PNG I/O and native rendered field sprites/textures retire-finish-release at Game closure');
  check('game-figure-native-close',p.closed?.closed&&p.closed.loadsSettled&&p.closed.nativeCompletion===true&&!p.closed.failed&&p.ids?.length>0&&p.ids.every(id=>!state('closed')?.bufferOwnership.some(r=>r.id===id))&&state('closed')?.allocation.pendingDeleteBytes===0,'actual figure native IDs retired and completed before successful Game closure');
  check('game-figure-owned-roots',p.detached&&p.identities,'captured roots hidden/detached; original materials/geometries/attributes/instance arrays retained');
  check('game-figure-idempotence',p.repeatStable&&JSON.stringify(p.repeat)===JSON.stringify(p.closed),'successful repeated closure adds no native work');
  check('game-figure-whole-frames',p.frames.length===4&&p.frames.every(f=>f.width===64&&f.height===64&&!f.glError&&Buffer.from(f.pixels,'base64').length===16384)&&p.frames[1].pixels!==p.frames[2].pixels&&p.frames[2].pixels===p.frames[3].pixels,'complete rigged/baked and two stable closed frames; genuine native sprite removal changes RGBA');
  let replay=false;try{const history=createSceneHistory(),compact={history,states:p.states.map(s=>compactSceneSample(history,s))};p.nativeHistory=compact;replay=isDeepStrictEqual(expandSceneContext(compact).states,p.states);}catch(e){p.replayError=String(e);}
  check('game-figure-native-history',replay&&p.cleanup.every(r=>r.ok)&&p.sharedQuad?.length===2&&state('cleanup')?.bufferOwnership.length===2&&p.sharedQuad.every(q=>state('cleanup').bufferOwnership.some(b=>b.id===q.id&&b.bytes===q.bytes&&!b.pendingDelete))&&state('cleanup').allocation.pendingDeleteBytes===0,'complete event/slot replay; owned buffers gone; exact two shared cached quad buffers preserved outside Game ownership');
  check('game-figure-native-health',p.states.every(clean)&&!p.errors.length&&!errors.length,JSON.stringify({errors,owner:p.errors}));
 }finally{await ctx.close();}
}

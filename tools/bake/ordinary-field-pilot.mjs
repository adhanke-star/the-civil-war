// Actions-only ordinary-entry baselines. Importing this module never starts a browser.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {startServer,ROOT} from '../serve.mjs';
import {ordinaryLookoutFixture,ordinaryCapacityContract} from '../resource-profile-fixture.mjs';
import {readSceneTerrainContracts} from './scene-terrain-contract.mjs';
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver,installFieldContextObserver,defaultSurfaceHistoryErrors} from './scene-allocation.mjs';
import {AtlasLayout} from '../../src/units/impostor.js';
import {pageMipBytes} from '../../src/units/atlas-compression.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const requireTrue=(condition,message)=>{if(!condition)throw Error('ordinary pilot: '+message);};

/** Explicit runner injection; no acquisition callback, renderer facade or capability fabrication. */
export function installOrdinaryAstcMask(gl){
  const own=Object.getOwnPropertyDescriptor(gl,'getExtension');
  let owner=gl,descriptor;const lineage=[];
  while(owner){descriptor=Object.getOwnPropertyDescriptor(owner,'getExtension');
    lineage.push({node:owner,prototype:Object.getPrototypeOf(owner),descriptor});
    if(descriptor)break;owner=Object.getPrototypeOf(owner);}
  if(!descriptor||typeof descriptor.value!=='function'||own?.configurable===false)throw Error('ordinary mask: native data method required');
  const native=descriptor.value;let masked=0,delegated=0,restored=false;
  const matches=(a,b)=>['value','get','set','writable','enumerable','configurable'].every(k=>a?.[k]===b?.[k]);
  const wrapped=function(...args){
    if(this===gl&&args[0]==='WEBGL_compressed_texture_astc'){masked++;return null;}
    delegated++;return Reflect.apply(native,this,args);
  };
  Object.defineProperty(gl,'getExtension',{value:wrapped,writable:own?.writable??true,enumerable:own?.enumerable??false,configurable:true});
  const installed=Object.getOwnPropertyDescriptor(gl,'getExtension');
  const assertOwned=()=>{if(restored||lineage.some(row=>Object.getPrototypeOf(row.node)!==row.prototype
    ||!matches(Object.getOwnPropertyDescriptor(row.node,'getExtension'),row.node===gl?installed:row.descriptor)))throw Error('ordinary mask: ownership changed');};
  return Object.freeze({read(){assertOwned();return{masked,delegated,restored};},
    restore(){if(restored)return{masked,delegated,restored};assertOwned();
      if(own)Object.defineProperty(gl,'getExtension',own);else delete gl.getExtension;
      if(!matches(Object.getOwnPropertyDescriptor(gl,'getExtension'),own))throw Error('ordinary mask: restoration failed');
      restored=true;return{masked,delegated,restored};}});
}

/** Plain copied state only; no GL, camera, simulation or owner mutation. */
export function ordinaryVisualSnapshot(field){
  const r=field.rts;
  return{camera:{world:[...field.camera.matrixWorld.elements],projection:[...field.camera.projectionMatrix.elements]},
    rts:{groundY:r.groundY,target:[r.target.x,r.target.y,r.target.z],goal:[r.goal.x,r.goal.z,r.goal.yaw,r.goal.pitch,r.goal.dist],yaw:r.yaw,pitch:r.pitch,dist:r.dist},
    post:{mode:field.post.mode,scale:field.post.scale,targets:[field.post.rtScene,field.post.rtSmall,field.post.rtBlur].map(t=>[t.width,t.height])},
    roster:field.game.units.map(u=>({id:u.def.id,side:u.side,men:u.men,x:u.x,z:u.z,facing:u.facing})),
    simTime:field.game.simTime,paused:field.game.paused,briefing:document.getElementById('briefing')?.open===true};
}

/** Observe the shipping camera's easing. This is a measurement prerequisite, not application readiness. */
export function observeOrdinaryStability({snapshot=ordinaryVisualSnapshot,captureProgress=false}={}){
  const progress={enabled:captureProgress===true,status:'running',frames:0,consecutive:0,maxConsecutive:0,
    elapsedMs:null,firstRaf:null,lastRaf:null,minGapMs:null,maxGapMs:null,changes:{world:0,projection:0,rts:0,post:0,roster:0},
    first:null,periodic:[],last:[],overflow:false,observerErrors:0,retainedByteUpperBound:8192};
  let read=()=>({enabled:false});
  const promise=new Promise((resolve,reject)=>{
    let settled=false,handle,previous=null,consecutive=0,frames=0;
    let start=null,parts=null;
    const clock=()=>{try{const value=performance.now();if(typeof value==='number'&&Number.isFinite(value))return value;}catch{}
      progress.observerErrors++;return null;};
    if(captureProgress===true){start=clock();read=()=>JSON.parse(JSON.stringify(progress));}
    const record=(value,timestamp)=>{
      if(captureProgress!==true)return;
      try{
        progress.frames=frames;progress.consecutive=consecutive;progress.maxConsecutive=Math.max(progress.maxConsecutive,consecutive);
        const now=clock();progress.elapsedMs=start!==null&&now!==null?now-start:null;
        if(Number.isFinite(timestamp)){
          if(progress.firstRaf===null)progress.firstRaf=timestamp;
          if(progress.lastRaf!==null){const gap=timestamp-progress.lastRaf;progress.minGapMs=progress.minGapMs===null?gap:Math.min(progress.minGapMs,gap);progress.maxGapMs=Math.max(progress.maxGapMs??gap,gap);}
          progress.lastRaf=timestamp;
        }
        // Three bytes per UTF-16 code unit bounds UTF-8; reserve metadata overhead.
        const bytes=value.length*3+512;
        if(bytes+8192>262144){progress.overflow=true;return;}
        const state=JSON.parse(value),next={world:JSON.stringify(state.camera?.world),projection:JSON.stringify(state.camera?.projection),
          rts:JSON.stringify(state.rts),post:JSON.stringify(state.post),roster:JSON.stringify(state.roster)};
        if(parts)for(const key of Object.keys(next))if(next[key]!==parts[key])progress.changes[key]++;
        parts=next;
        const row={sequence:frames,rafTimestamp:Number.isFinite(timestamp)?timestamp:null,consecutive,state,byteUpperBound:bytes};
        let available=262144-progress.retainedByteUpperBound;
        if(progress.last.length===16)available+=progress.last[0].byteUpperBound;
        const copies=(progress.first===null?1:0)+(frames%128===0?1:0)+1;
        if(bytes*copies>available){progress.overflow=true;return;}
        if(progress.first===null){progress.first=row;progress.retainedByteUpperBound+=bytes;}
        if(frames%128===0){progress.periodic.push(row);progress.retainedByteUpperBound+=bytes;}
        if(progress.last.length===16)progress.retainedByteUpperBound-=progress.last.shift().byteUpperBound;
        progress.last.push(row);progress.retainedByteUpperBound+=bytes;
      }catch{progress.observerErrors++;}
    };
    const end=(failed,value)=>{if(settled)return;settled=true;clearTimeout(timer);
      if(captureProgress===true){progress.status=failed?'rejected':'resolved';const now=clock();progress.elapsedMs=start!==null&&now!==null?now-start:null;}
      if(failed)reject(value);else resolve(value);};
    const timer=setTimeout(()=>{if(settled)return;cancelAnimationFrame(handle);end(true,Error('ordinary stability: measurement deadline'));},30000);
    const observe=timestamp=>{
      if(settled)return;
      try{
        const state=snapshot(window.__game);
        if(state.paused!==true||state.simTime!==0||state.briefing!==true)throw Error('ordinary stability: time-zero briefing required');
        const value=JSON.stringify(state);frames++;
        consecutive=value===previous?consecutive+1:1;previous=value;
        record(value,timestamp);
        if(consecutive===8){end(false,{frames,consecutive,state});return;}
        if(frames>=4096)throw Error('ordinary stability: frame cap');
        handle=requestAnimationFrame(observe);
      }catch(error){end(true,error);}
    };
    try{handle=requestAnimationFrame(observe);}catch(error){end(true,error);}
  });
  Object.defineProperty(promise,'read',{value:()=>read()});
  return promise;
}

/** Retain the original browser promise; read and disposal failures never replace it. */
export async function observeOrdinaryStabilityOnPage(page,c){
  const detail=error=>{
    if(error===null)return'null';
    if(typeof error==='string')return error.slice(0,512);
    if(['number','boolean','undefined','bigint'].includes(typeof error))return String(error).slice(0,512);
    try{const descriptor=Object.getOwnPropertyDescriptor(error,'message');if(typeof descriptor?.value==='string')return descriptor.value.slice(0,512);}catch{}
    return typeof error+' error (opaque)';
  };
  const handle=await page.evaluateHandle(({observe,snapshot})=>{
    const promise=(0,eval)('('+observe+')')({snapshot:(0,eval)('('+snapshot+')'),captureProgress:true});
    promise.catch(()=>{});return{promise};
  },{observe:observeOrdinaryStability.toString(),snapshot:ordinaryVisualSnapshot.toString()});
  try{return await handle.evaluate(async holder=>await holder.promise);}
  finally{
    try{c.stabilityProgress=await handle.evaluate(holder=>holder.promise.read());}
    catch(error){c.cleanupErrors.push('stability progress read: '+detail(error));}
    try{await handle.dispose();}catch(error){c.cleanupErrors.push('stability handle dispose: '+detail(error));}
  }
}

/** Read the actual shipping frame; never draw, finish, resize, bind or replace RAF. */
export function readOrdinaryFrame(gl,{snapshot=ordinaryVisualSnapshot}={}){
  return new Promise((resolve,reject)=>{
    let settled=false,handle;
    const timer=setTimeout(()=>{if(settled)return;settled=true;cancelAnimationFrame(handle);reject(Error('ordinary frame: readback deadline'));},10000);
    handle=requestAnimationFrame(()=>{if(settled)return;settled=true;try{
      const field=window.__game,observer=window.__fieldContextObservation;
      if(observer.context(1)!==gl||!window.__ready||field?.game?.paused!==true||field.game.simTime!==0
        ||document.getElementById('briefing')?.open!==true||gl.getParameter(gl.FRAMEBUFFER_BINDING)!==null)
        throw Error('ordinary frame: live time-zero default framebuffer required');
      const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>1048576)
        throw Error('ordinary frame: bounded dimensions required');
      const bytes=new Uint8Array(width*height*4);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      let base64='';for(let i=0;i<bytes.length;i+=32768)base64+=String.fromCharCode(...bytes.subarray(i,i+32768));
      resolve({...snapshot(field),width,height,rgba:btoa(base64),transportBytes:bytes.byteLength,
        kind:'one-shot readPixels after ordinary RAF; no added render/finish'});
    }catch(error){reject(error);}finally{clearTimeout(timer);}});
  });
}

export function ordinaryBaselineErrors(report,expected){
  const errors=[];
  try{
    requireTrue(report?.schema==='ordinary-lookout-baselines-v1'&&report.complete===true,'complete schema');
    requireTrue(report.sha===expected.sha&&same(report.inputs,expected.inputs),'source/input binding');
    requireTrue(typeof expected.run==='string'&&/^[1-9][0-9]*$/.test(expected.run)&&expected.attempt==='1'
      &&report.run===expected.run&&report.attempt===expected.attempt,'exact original run/attempt');
    requireTrue(Array.isArray(report.cases)&&report.cases.length===2,'exactly two normal routes');
    for(const [i,c]of report.cases.entries()){
      requireTrue(c.route===['capable','unsupported'][i]&&c.complete===true,'unique ordered routes');
      requireTrue(c.errors?.length===0&&c.warnings?.length===0&&c.captureOverflow===false,'browser errors/warnings/capture bounds');
      requireTrue(c.cleanupErrors?.length===0&&!c.failure,'case cleanup/primary failure');
      requireTrue(c.rawBefore===expected.inputs.save&&c.rawAfter===c.rawBefore&&c.applied===expected.inputs.applied,'actual store/scenario bytes');
      requireTrue(c.genuineAstc===true&&c.documentSha256===expected.inputs.documentSha256,'native capability/document');
      requireTrue(same(c.terrain,expected.terrain),'source/oracle/chunk/mapping arrays');
      requireTrue(c.maskRestoration?.restored===true&&(i===0?c.maskRestoration.masked===0:c.maskRestoration.masked>0),'mask activity/restoration');
      requireTrue(c.observation?.enabled===true&&c.observation.epochCapture===true&&c.observation.restored===false
        &&c.observation.overflow===false&&c.observation.observerFailureCount===0
        &&c.observation.observerErrors?.length===0&&c.observation.epochs?.length===0&&c.observation.states?.length===1,'complete active observation');
      requireTrue(c.observation.states[0].id===1&&c.observation.receipts?.length>0&&c.observation.receipts.every(r=>r.target===true&&r.supported===true&&r.outcome==='return'&&r.context===1),'exact original context acquisition');
      requireTrue(defaultSurfaceHistoryErrors(c.observation.states[0].retained).length===0,'original complete native/default history');
      requireTrue(c.samples?.length===2&&c.frames?.length===2,'two original settled checkpoints');
      requireTrue(Number.isSafeInteger(c.stability?.frames)&&c.stability.frames>=8&&c.stability.frames<=4096&&c.stability.consecutive===8,'measured stable camera prerequisite');
      for(const [j,s]of c.samples.entries()){
        requireTrue(s.glError===null&&s.conservativeReservation===null,'health status explicitly unread');
        requireTrue(Number.isSafeInteger(s.cpuDeclaredArrayBytes)&&s.cpuDeclaredArrayBytes>0&&s.retainedTerrainArrayBytes>0,'actual retained CPU inventory');
        requireTrue(Array.isArray(s.cpuArrays)&&s.cpuArrays.length>0&&s.cpuArrays.every((a,i)=>a.id===i+1&&Number.isSafeInteger(a.bytes)&&a.bytes>=0
          &&Array.isArray(a.owners)&&a.owners.length>0&&a.owners.every(o=>typeof o==='string'&&o.length>0))
          &&s.cpuArrays.reduce((n,a)=>n+a.bytes,0)===s.cpuDeclaredArrayBytes&&s.declaredArrayBytes===s.cpuDeclaredArrayBytes,'deduplicated CPU array equation');
        const terrainIds=[];
        for(const a of expected.terrain){const matches=s.cpuArrays.filter(r=>r.owners.includes(a.owner)&&r.bytes===a.bytes&&r.arrayType===a.arrayType);
          requireTrue(matches.length===1,'retained terrain owner inventory');terrainIds.push(matches[0].id);}
        requireTrue(new Set(terrainIds).size===terrainIds.length,'distinct retained terrain backings');
        requireTrue(s.retainedTerrainArrayBytes===s.cpuArrays.filter(a=>a.owners.every(o=>o.startsWith('terrain-'))).reduce((n,a)=>n+a.bytes,0),'retained-only CPU equation');
        requireTrue(same(s.bufferOwnership,s.allocation.bufferSlots)&&Array.isArray(s.bufferOwnership),'actual original native buffer inventory');
        let mapped=0,unmapped=0;
        for(const b of s.bufferOwnership){
          requireTrue(Number.isSafeInteger(b.bytes)&&b.bytes>=0&&Array.isArray(b.owners)&&b.owners.every(o=>typeof o==='string'&&o.length>0),'native buffer owner shape');
          if(b.owners.length){mapped+=b.bytes;requireTrue(s.cpuArrays.some(a=>a.bytes===b.bytes&&a.owners.some(o=>b.owners.includes(o))),'native buffer bound to actual CPU owner');}
          else unmapped+=b.bytes;
        }
        requireTrue(mapped+unmapped===s.allocation.byKind.buffer&&s.mappedBufferBytes===mapped&&s.unmappedBufferBytes===unmapped&&unmapped===0,'all native buffer bytes mapped to actual CPU owners');
        requireTrue(defaultSurfaceHistoryErrors(s.allocation).length===0,'checkpoint native/default history');
        requireTrue(s.gpuReservation===s.allocation.gpuPeak,'GPU convenience value bound to raw history');
        const original=c.observation.states[0].retained;
        for(const key of ['nativeEvents','defaultEvents','signatures'])requireTrue(same(s.allocation[key],original[key].slice(0,s.allocation[key].length)),'checkpoint is exact original '+key+' prefix');
        requireTrue(Object.entries(s.allocation.calls).every(([key,n])=>n<=(original.calls[key]??-1)),'checkpoint calls are original prefix');
        requireTrue(s.gpuReservation+s.cpuDeclaredArrayBytes<=250000000,'baseline conservative GPU peak plus actual CPU inventory');
        const f=c.frames[j],bytes=Buffer.from(f.rgba,'base64');
        requireTrue(f.simTime===0&&f.paused===true&&Number.isSafeInteger(f.width)&&Number.isSafeInteger(f.height)
          &&f.width>0&&f.height>0&&f.width*f.height<=1048576&&bytes.length===f.width*f.height*4&&f.transportBytes===bytes.length,'complete original RGBA');
        requireTrue(bytes.toString('base64')===f.rgba,'canonical original RGBA encoding');
        const surface=s.allocation.defaultEvents.at(-1),matrix=a=>Array.isArray(a)&&a.length===16&&a.every(Number.isFinite),v=expected.inputs.settings.viewport;
        requireTrue(matrix(f.camera?.world)&&matrix(f.camera?.projection)&&f.post?.mode==='low'&&Number.isFinite(f.post.scale)&&f.post.scale>0&&f.post.scale<=1,'camera/Post state');
        const source=JSON.parse(expected.inputs.applied),finite=values=>Array.isArray(values)&&values.every(Number.isFinite);
        requireTrue(Number.isFinite(f.rts?.groundY)&&finite(f.rts.target)&&f.rts.target.length===3&&finite(f.rts.goal)&&f.rts.goal.length===5
          &&[f.rts.yaw,f.rts.pitch,f.rts.dist].every(Number.isFinite)&&f.briefing===true,'actual RTS/briefing state');
        requireTrue(Array.isArray(f.roster)&&f.roster.length===source.units.length&&f.roster.every((u,k)=>u.id===source.units[k].id
          &&u.side===source.units[k].side&&u.men===source.units[k].men&&[u.x,u.z,u.facing].every(Number.isFinite)
          &&['x','z','facing'].every(key=>u[key]===source.units[k][key])),'actual initial roster, strength and placement');
        requireTrue(same(s.viewport,v)&&s.dpr===expected.inputs.settings.dpr&&f.width===surface.width&&f.height===surface.height
          &&f.width===Math.floor(v[0]*f.post.scale)&&f.height===Math.floor(v[1]*f.post.scale),'frame dimensions bound to original surface/settings');
        const w=Math.max(1,Math.round(v[0]*f.post.scale)),h=Math.max(1,Math.round(v[1]*f.post.scale));
        requireTrue(same(f.post.targets,[[w,h],[Math.max(1,w>>2),Math.max(1,h>>2)],[Math.max(1,w>>2),Math.max(1,h>>2)]]),'actual Post target dimensions');
        requireTrue(bytes.some((v,k)=>v!==bytes[k%4]),'nonuniform original RGBA');
      }
      const final=c.observation.states[0].retained,last=c.samples[1].allocation;
      requireTrue(final.gpuPeak+Math.max(...c.samples.map(s=>s.cpuDeclaredArrayBytes))<=250000000,'final original peak plus maximum observed CPU inventory');
      for(const key of ['nativeEvents','defaultEvents','signatures','bufferSlots','textureSlots','renderbufferSlots'])
        requireTrue(same(final[key],last[key]),'no unmeasured allocating/retiring tail after final checkpoint: '+key);
      requireTrue(same(c.frames[0].camera,c.frames[1].camera)&&same(c.frames[0].post,c.frames[1].post)
        &&same(c.frames[0].rts,c.frames[1].rts)&&same(c.frames[0].roster,c.frames[1].roster)
        &&c.frames[0].rgba===c.frames[1].rgba,'unchanged actual field view after close workload');
      for(const key of ['camera','post','rts','roster','simTime','paused','briefing'])
        requireTrue(same(c.stability.state?.[key],c.frames[0][key]),'initial frame bound to observed stability: '+key);
      requireTrue(c.samples[0].atlasPages?.US?.field===2&&c.samples[0].atlasPages?.CS?.field===4
        &&c.samples[0].atlasPages?.US?.close===undefined&&c.samples[0].atlasPages?.CS?.close===undefined,'field-only initial publication');
      requireTrue(c.samples[1].atlasPages?.US?.close===3&&c.samples[1].atlasPages?.CS?.close===(i===0?10:5),'actual route publication');
      requireTrue(same(c.textures.map(({native,uuid,...p})=>p),expected.textures[c.route]),'texture/mip/source page binding');
      const retained=c.samples[1].allocation,ids=new Set();
      for(const page of c.textures){
        requireTrue(Number.isSafeInteger(page.native)&&page.native>0&&!ids.has(page.native)&&typeof page.uuid==='string'&&page.uuid.length>0,'distinct native texture owner');ids.add(page.native);
        const slot=retained.textureSlots.find(s=>s.texture===page.native);
        requireTrue(slot?.pendingDelete===false&&same(slot.slots,Object.fromEntries(page.levels.map((l,k)=>['3553:'+k,l.bytes]))),'every native mip reservation');
        requireTrue(retained.signatures.some(s=>s.texture===page.native&&s.canonical?.w===page.width&&s.canonical?.h===page.height
          &&s.raw?.format===(page.encoding==='astc4x4'?0x93b0:32856)),'actual native format and dimensions');
      }
      const workload=c.uploadWorkload;
      requireTrue(workload?.kind==='explicit original published US close hydration; no render/finish'&&workload.pages?.length===3
        &&workload.nativeHealth?.error===0&&workload.nativeHealth.textures===c.textures.length&&workload.nativeHealth.valid===true,'declared hydration and settled native health');
      requireTrue(workload.pages.every((p,i)=>p.side==='US'&&p.tier==='close'&&p.index===i&&typeof p.uuid==='string'
        &&p.native===c.textures.find(t=>t.side==='US'&&t.tier==='close'&&t.index===i)?.native
        &&p.uuid===c.textures.find(t=>t.side==='US'&&t.tier==='close'&&t.index===i)?.uuid),'exact original hydration pages');
      requireTrue(Number.isSafeInteger(workload.before)&&Number.isSafeInteger(workload.after)&&workload.before>=c.samples[0].allocation.nativeEvents.length
        &&workload.after<=retained.nativeEvents.length&&workload.after>workload.before,'hydration original native prefix bounds');
      requireTrue(workload.pages.every(p=>retained.nativeEvents.slice(workload.before,workload.after).some(e=>e.operation==='reserve'&&e.kind==='texture'&&e.id===p.native)),'each hydration has original reservations');
      for(const [i,p]of workload.pages.entries()){
        requireTrue(p.before===(i?workload.pages[i-1].after:workload.before)&&p.after>p.before
          &&(i!==2||p.after===workload.after),'exact per-page hydration event boundaries');
        const events=retained.nativeEvents.slice(p.before,p.after),page=c.textures.find(t=>t.native===p.native);
        requireTrue(events.length===page.levels.length&&events.every((e,k)=>e.operation==='reserve'&&e.kind==='texture'&&e.id===p.native
          &&e.slot==='3553:'+k&&e.bytes===page.levels[k].bytes),'only original page mip reservations in each hydration');
        const keys=new Set([...Object.keys(p.callsBefore??{}),...Object.keys(p.callsAfter??{})]);
        requireTrue(keys.size>0&&[p.callsBefore,p.callsAfter].every(c=>c&&Object.values(c).every(n=>Number.isSafeInteger(n)&&n>=0)),'hydration native call counters');
        const allowed=['texStorage2D','texImage2D','texSubImage2D','generateMipmap'];let uploads=0;
        for(const key of keys){const delta=(p.callsAfter[key]??0)-(p.callsBefore[key]??0);requireTrue(delta>=0&&(delta===0||allowed.includes(key)),'no unrelated native work inside hydration');if(allowed.includes(key))uploads+=delta;}
        requireTrue(uploads>0&&events.every(e=>e.callOrdinal>Object.values(p.callsBefore).reduce((a,n)=>a+n,0)
          &&e.callOrdinal<=Object.values(p.callsAfter).reduce((a,n)=>a+n,0)),'per-page raw ordinal and upload counter binding');
        if(i)requireTrue(same(p.callsBefore,workload.pages[i-1].callsAfter),'synchronous hydration counter continuity');
        requireTrue(Object.entries(c.samples[0].allocation.calls).every(([key,n])=>(p.callsBefore[key]??0)>=n)
          &&Object.entries(p.callsAfter).every(([key,n])=>n<=(retained.calls[key]??-1)),'hydration counters bound to original checkpoints');
        requireTrue(['texStorage2D','texSubImage2D','generateMipmap'].every(key=>(p.callsAfter[key]??0)-(p.callsBefore[key]??0)===1)
          &&(p.callsAfter.texImage2D??0)===(p.callsBefore.texImage2D??0),'original PNG immutable upload semantics');
        const signatures=retained.signatures.filter(s=>s.texture===p.native&&s.callOrdinal>Object.values(p.callsBefore).reduce((a,n)=>a+n,0)
          &&s.callOrdinal<=Object.values(p.callsAfter).reduce((a,n)=>a+n,0));
        requireTrue(signatures.filter(s=>s.nativeCall==='texStorage2D').length===1
          &&signatures.filter(s=>s.nativeCall==='generateMipmap').length===1,'hydration raw native signatures');
      }
      requireTrue(c.restoration?.field===true&&c.restoration.allocation===true,'observer descriptor restoration');
    }
  }catch(error){errors.push(error.message);}
  return errors;
}

export function ordinaryPilotExpected(sha,{run=null,attempt=null}={}){
  requireTrue(/^[a-f0-9]{40}$/.test(sha),'full source SHA');
  const json=file=>JSON.parse(fs.readFileSync(ROOT+'/'+file)),campaign=json('assets/campaign.json'),pack=json('assets/packs/chattanooga.json'),
    fixture=ordinaryLookoutFixture(campaign,pack),base='assets/figures/',
    manifests={US:json(base+'union-infantry/soldier.json'),CS:json(base+'confederate-infantry/soldier.json')},
    hybrid=json(base+'confederate-infantry/soldier-hybrid.json'),textures={},capacities={},files=new Set(['index.html','src/entry.js','src/main.js','assets/campaign.json','assets/packs/chattanooga.json',
      base+'union-infantry/soldier.json',base+'confederate-infantry/soldier.json',base+'confederate-infantry/soldier-source.json',base+'confederate-infantry/soldier-hybrid.json']);
  for(const route of ['capable','unsupported']){
    textures[route]=[];const pages={};
    for(const side of ['US','CS']){
      pages[side]={};
      for(const tier of ['field','close']){
        const layout=new AtlasLayout(side==='CS'&&tier==='close'&&route==='capable'?hybrid:manifests[side]);
        pages[side][tier]=layout.tiers[tier].pages.length;
        for(const [index,page]of layout.tiers[tier].pages.entries()){
          const file=base+(side==='US'?'union-infantry/':'confederate-infantry/')+page.file;
          files.add(file);
          const encoding=page.encoding==='astc4x4'?'astc4x4':'png',mips=pageMipBytes(page.w,page.h,encoding==='astc4x4');
          textures[route].push({side,tier,index,file:page.file,width:page.w,height:page.h,encoding,levels:mips.levels});
        }
      }
    }
    capacities[route]=ordinaryCapacityContract(fixture.authored,fixture.applied,pages);
  }
  const contract=readSceneTerrainContracts([{scenario:fixture.applied}])[0].terrainContract,terrain=[];
  for(const [prefix,list]of [['terrain-source',contract.sourceArrays],['terrain-oracle',contract.sourceArrays]])
    list.forEach((d,i)=>terrain.push({owner:prefix+'/'+i,arrayType:d.arrayType,bytes:d.bytes,sha256:d.sha256}));
  contract.chunks.forEach((chunk,i)=>[...chunk,contract.sourceVertices[i]].forEach(d=>terrain.push({owner:`terrain-chunk-${i}/${d.key}`,arrayType:d.arrayType,bytes:d.bytes,sha256:d.sha256})));
  for(const suffix of ['json','bin'])files.add('assets/terrain/'+contract.terrain+'.'+suffix);
  const inputs={kind:fixture.kind,settings:{viewport:[960,540],dpr:1,profile:'compact-v1',quality:'low',figures:'baked'},save:JSON.stringify(fixture.save),applied:JSON.stringify(fixture.applied),phase:fixture.phase,
    capacities,documentSha256:digest(fs.readFileSync(ROOT+'/index.html')),
    assets:[...files].sort().map(file=>{const bytes=fs.readFileSync(ROOT+'/'+file);requireTrue(bytes.length<99000000,'bounded committed source');return{file,bytes:bytes.length,sha256:digest(bytes)};})};
  return {sha,run,attempt,inputs,textures,terrain};
}

// Producer implementation follows the independently reviewed ordinary route, never the focused bootstrap.
export async function runOrdinaryLookoutBaselines(){
  requireTrue(process.env.CI==='true','Actions only');
  requireTrue(process.env.GITHUB_SHA===execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),'exact checked-out SHA');
  const expected=ordinaryPilotExpected(process.env.GITHUB_SHA,{run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT}),out=ROOT+'/.out/ordinary-lookout';
  fs.mkdirSync(out,{recursive:true});
  const report={schema:'ordinary-lookout-baselines-v1',sha:expected.sha,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    complete:false,inputs:expected.inputs,cases:[],limitations:['two normal routes only; remaining14 pilot cases/full110/stress/default adoption UNRUN',
      'checkpoint CPU inventory plus every-event GPU reservations; transient CPU construction and driver/decode memory unmeasured',
      'field-view readback plus explicit original US published-page hydration; automatic US close upload/close-view quality/zoom not proved']};
  let browser,server,failure;
  const persist=(final=false)=>{const bytes=Buffer.from(JSON.stringify(report)+'\n');requireTrue(bytes.length<99000000,'complete report below99MB');
    fs.writeFileSync(out+'/report.json',bytes);console.log(final?'ORDINARY ORIGINAL PERSISTED':'ORDINARY CHECKPOINT PERSISTED',JSON.stringify({sha:report.sha,run:report.run,attempt:report.attempt,bytes:bytes.length,sha256:digest(bytes),complete:report.complete}));};
  // Armed before launch, cleanup or failure persistence can hang; preserves a finite incomplete report.
  const terminal=setTimeout(()=>{report.complete=false;report.failure='terminal deadline';try{persist(true);}finally{process.exit(1);}},240000);
  try{
    server=await startServer({port:0});
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const bootstrap=`(${installAllocationObserver.toString()})(${JSON.stringify({ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true,captureNativeFailures:true,captureDefaultSurfaces:true})});(${installFieldContextObserver.toString()})({enabled:true,observeSurfaces:true,observeEpochs:true,enableContextHandles:true});`;
    for(const route of ['capable','unsupported']){
      const c={route,complete:false,captureOverflow:false,errors:[],warnings:[],requests:[],samples:[],frames:[],cleanupErrors:[]};report.cases.push(c);
      const ctx=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1,serviceWorkers:'block'});
      let page;
      try{
        await ctx.addInitScript({content:bootstrap});page=await ctx.newPage();
        const message=(list,value)=>{if(list.length>=128||value.length>16384){c.captureOverflow=true;return;}list.push(value);};
        page.on('pageerror',error=>message(c.errors,String(error)));
        page.on('console',msg=>{if(msg.type()==='error')message(c.errors,msg.text());if(msg.type()==='warning')message(c.warnings,msg.text());});
        page.on('request',request=>{if(c.requests.length>=4096||request.url().length>16384){c.captureOverflow=true;return;}c.requests.push({url:request.url(),method:request.method()});});
        await page.goto(server.url+'?nosw',{waitUntil:'networkidle',timeout:30000});
        const frozen=await page.evaluate(async text=>{
          const {createProgressStore}=await import('./src/franchise/save.js'),store=createProgressStore(undefined,{slot:3});
          const baseline=await store.readRawBaseline();if(baseline!==null)throw Error('ordinary pilot: fresh actual slot required');
          await store.import(text,{previousRaw:baseline});const save=await store.load(),raw=await store.readRawBaseline();
          return{baseline,save,raw};
        },expected.inputs.save);
        c.rawBefore=frozen.raw;requireTrue(c.rawBefore===expected.inputs.save,'actual canonical imported save');
        const response=await page.goto(server.url+'?campaign=3&resources=compact-v1&quality=low&figures=baked&nosw',{waitUntil:'domcontentloaded',timeout:30000});
        requireTrue(response?.status()===200,'ordinary document200');c.documentSha256=digest(await response.body());
        await page.waitForFunction(()=>window.__ready&&window.__game?.game?.baked?.state==='ready'&&document.getElementById('briefing')?.open===true,{},{timeout:60000});
        c.stability=await observeOrdinaryStabilityOnPage(page,c);
        const frame=()=>page.evaluate(({read,snapshot})=>(0,eval)('('+read+')')(window.__fieldContextObservation.context(1),{snapshot:(0,eval)('('+snapshot+')')}),
          {read:readOrdinaryFrame.toString(),snapshot:ordinaryVisualSnapshot.toString()});
        c.frames.push(await frame());
        const closeFiles=new Set(expected.textures.capable.filter(p=>p.tier==='close').map(p=>p.file));
        requireTrue(!c.requests.some(r=>closeFiles.has(new URL(r.url).pathname.split('/').pop())),'no premature close requests');
        const setup=await page.evaluate(({route,mask})=>{
          const field=window.__game,atlases=field.game.baked.atlases,gl=window.__fieldContextObservation.context(1);
          for(const a of Object.values(atlases))if(a.state.close||a.textures.close||a.pools.some(p=>!Array.isArray(p.batches.close)||p.batches.close.length))throw Error('ordinary pilot: close already began');
          const ext=gl.getExtension('WEBGL_compressed_texture_astc');
          const genuine=!!ext&&ext.getSupportedProfiles().includes('ldr')&&Array.from(gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS)).includes(0x93b0);
          if(!genuine)throw Error('ordinary pilot: genuine capable baseline required');
          for(const a of Object.values(atlases))for(const t of a.textures.field)
            if(!window.__allocation.textureReservation(gl,field.post.renderer.properties.get(t).__webglTexture))throw Error('ordinary pilot: field page not naturally uploaded');
          if(route==='unsupported')window.__ordinaryMask=(0,eval)('('+mask+')')(gl);
          return{genuine,applied:JSON.stringify(field.game.scenario),terminal:field.resources.terminal};
        },{route,mask:installOrdinaryAstcMask.toString()});
        c.genuineAstc=setup.genuine;c.applied=setup.applied;requireTrue(c.applied===expected.inputs.applied,'actual applied scenario');
        c.terrain=await page.evaluate(async()=>{
          const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a.buffer,a.byteOffset,a.byteLength))),b=>b.toString(16).padStart(2,'0')).join('');
          return Promise.all(window.__game.resources.terrainArrays.map(async({owner,array})=>({owner,arrayType:array.constructor.name,bytes:array.byteLength,sha256:await hash(array)})));
        });
        const checkpoint=()=>page.evaluate(async()=>{
          const {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs'),field=window.__game,gl=window.__fieldContextObservation.context(1);
          return sampleSceneAllocations({__game:field,__allocation:window.__allocation,__sceneTerrainPartition:{retainedArrays:field.resources.terrainArrays},
            innerWidth,innerHeight,devicePixelRatio},{retainedContext:gl});
        });
        c.samples.push(await checkpoint());
        // Original shipping loader and pools; deliberate tier workload, no UI-zoom claim.
        await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
        c.uploadWorkload=await page.evaluate(()=>{
          const field=window.__game,renderer=field.post.renderer,init=renderer.initTexture,gl=window.__fieldContextObservation.context(1),allocation=window.__allocation,
            before=allocation.peek(gl).nativeEvents.length,pages=[],atlas=field.game.baked.atlases.US;
          const textures=[...atlas.textures.close];if(textures.length!==3)throw Error('ordinary pilot: exact original US close pages required');
          for(const [index,t]of textures.entries()){
            if(renderer.initTexture!==init||atlas.textures.close[index]!==t)throw Error('ordinary pilot: hydration owner changed');
            const start=allocation.peek(gl);
            Reflect.apply(init,renderer,[t]);
            const end=allocation.peek(gl);
            pages.push({side:'US',tier:'close',index,uuid:t.uuid,native:allocation.textureReservation(gl,renderer.properties.get(t).__webglTexture)?.id??null,
              before:start.nativeEvents.length,after:end.nativeEvents.length,callsBefore:start.calls,callsAfter:end.calls});
          }
          const all=Object.values(field.game.baked.atlases).flatMap(a=>Object.values(a.textures).flat()),error=gl.getError();
          const valid=all.every(t=>gl.isTexture(renderer.properties.get(t).__webglTexture)&&renderer.properties.get(t).__version===t.version);
          return{kind:'explicit original published US close hydration; no render/finish',before,after:allocation.peek(gl).nativeEvents.length,pages,
            nativeHealth:{error,valid,textures:all.length}};
        });
        c.frames.push(await frame());c.samples.push(await checkpoint());
        c.textures=await page.evaluate(()=>{
          const field=window.__game,gl=window.__fieldContextObservation.context(1),rows=[];
          for(const [side,a]of Object.entries(field.game.baked.atlases))for(const tier of ['field','close'])for(const [index,t]of a.textures[tier].entries()){
            const p=a.layout.tiers[tier].pages[index],encoding=p.encoding==='astc4x4'?'astc4x4':'png',levels=[];
            for(let w=p.w,h=p.h;;w=Math.max(1,w>>1),h=Math.max(1,h>>1)){levels.push({width:w,height:h,bytes:encoding==='astc4x4'?Math.ceil(w/4)*Math.ceil(h/4)*16:w*h*4});if(w===1&&h===1)break;}
            const native=window.__allocation.textureReservation(gl,field.post.renderer.properties.get(t).__webglTexture);
            rows.push({side,tier,index,file:p.file,width:p.w,height:p.h,encoding,levels,uuid:t.uuid,native:native?.id??null});
          }return rows;
        });
        c.rawAfter=await page.evaluate(async()=>{const{createProgressStore}=await import('./src/franchise/save.js');return createProgressStore(undefined,{slot:3}).readRawBaseline();});
        c.observation=await page.evaluate(()=>window.__fieldContextObservation.read());
        const teardown=await page.evaluate(()=>{
          const field=window.__fieldContextObservation,allocation=window.__allocation,mask=window.__ordinaryMask;
          const maskRestoration=mask?mask.restore():{masked:0,delegated:0,restored:true};
          field.restore();allocation.restore();return{maskRestoration,restoration:{field:field.read().restored,allocation:!Object.hasOwn(window,'__allocation')}};
        });Object.assign(c,teardown);c.complete=true;
        for(const [i,f]of c.frames.entries()){
          const png=new PNG({width:f.width,height:f.height}),bytes=Buffer.from(f.rgba,'base64');
          for(let y=0;y<f.height;y++)bytes.copy(png.data,y*f.width*4,(f.height-1-y)*f.width*4,(f.height-y)*f.width*4);
          fs.writeFileSync(out+'/'+route+'-'+i+'.png',PNG.sync.write(png));
        }
      }catch(error){c.failure=String(error?.stack??error);throw error;}
      finally{
        // Retain the failed context before teardown. Never let cleanup replace its primary error.
        if(page&&!c.complete){
          try{c.failureObservation=await page.evaluate(()=>window.__fieldContextObservation?.read()??{unavailable:true});}
          catch(error){c.cleanupErrors.push('retained failure read: '+String(error));}
          try{c.failureVisualState=await page.evaluate(snapshot=>window.__game
            ?{kind:'external state after primary failure; not the last stability observation',state:(0,eval)('('+snapshot+')')(window.__game)}
            :{unavailable:true},ordinaryVisualSnapshot.toString());}
          catch(error){c.cleanupErrors.push('external visual failure read: '+String(error));}
          for(const operation of ['mask','field','allocation'])try{await page.evaluate(operation=>{
            if(operation==='mask')window.__ordinaryMask?.restore();
            if(operation==='field')window.__fieldContextObservation?.restore();
            if(operation==='allocation')window.__allocation?.restore();
          },operation);}catch(error){c.cleanupErrors.push(operation+' restore: '+String(error));}
        }
        try{await ctx.close();}catch(error){c.cleanupErrors.push('context close: '+String(error));}
        if(c.cleanupErrors.length){c.complete=false;if(!c.failure)throw Error('ordinary pilot cleanup: '+c.cleanupErrors.join('; '));}
      }
    }
    report.complete=true;report.readerErrors=ordinaryBaselineErrors(report,expected);
    requireTrue(report.readerErrors.length===0,report.readerErrors.join('; '));
  }catch(error){failure=error;report.complete=false;report.failure=String(error?.stack??error);}
  finally{
    // The terminal timer remains armed through persistence and both cleanup operations.
    try{persist();}catch(error){failure ||= error;report.complete=false;report.persistenceFailure=String(error);}
    try{await browser?.close();}catch(error){failure ||= error;report.complete=false;report.cleanupFailure=String(error);}
    try{if(server)await new Promise((resolve,reject)=>server.server.close(error=>error?reject(error):resolve()));}catch(error){failure ||= error;report.complete=false;report.cleanupFailure=String(error);}
    try{persist(true);}catch(error){failure ||= error;report.complete=false;console.error('ORDINARY PERSISTENCE FAILED',String(error));}
    finally{clearTimeout(terminal);}
  }
  if(failure){console.error('ORDINARY INCOMPLETE',String(failure));process.exitCode=1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runOrdinaryLookoutBaselines();

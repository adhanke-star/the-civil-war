// Diagnostic-only accounting of WebGL reservations. These are API bytes, not native driver measurements.
import {deriveSceneStressContract} from './inactive-figures.mjs';
import {BakedAtlas} from '../../src/units/impostor.js';
import {retainedFigureGeometryArrays} from '../../src/units/soldier-mesh.js';
import {retainedTreeGeometryArrays} from '../../src/world/props.js';

const retainedAtlasPrototype=BakedAtlas.prototype,
  retainedAtlasGetters=Object.fromEntries(['loadsSettled','cleanupFailure'].map(key=>[key,Object.getOwnPropertyDescriptor(retainedAtlasPrototype,key).get]));
function retainedOwn(object,key,optional=false){
  const d=object!=null&&Object.getOwnPropertyDescriptor(object,key);
  if(!d){if(optional)return undefined;throw Error('missing '+key);}
  if(!Object.hasOwn(d,'value'))throw Error('unexpected accessor '+key);return d.value;
}
function retainedSequence(value,limit=16384){
  if(!Array.isArray(value))throw Error('expected owner sequence');
  const length=retainedOwn(value,'length');
  if(!Number.isSafeInteger(length)||length<0||length>limit)throw Error('owner sequence bound');
  const result=[];for(let i=0;i<length;i++)result.push(retainedOwn(value,String(i)));return result;
}
function retainedEntries(object){
  if(!object||typeof object!=='object')throw Error('missing owner object');
  const descriptors=Object.getOwnPropertyDescriptors(object),keys=Object.keys(descriptors).filter(k=>descriptors[k].enumerable);
  if(keys.length>4096)throw Error('owner property bound');
  return keys.map(k=>{if(!Object.hasOwn(descriptors[k],'value'))throw Error('unexpected accessor '+k);return[k,descriptors[k].value];});
}
function retainedMessage(error){
  try{const d=error!=null&&Object.getOwnPropertyDescriptor(error,'message');if(typeof d?.value==='string')return d.value.slice(0,1024);}catch{}
  return 'invalid retained owner';
}
function retainedSceneObjects(root){
  const pending=[root],seen=new Set(),objects=[];
  while(pending.length){const object=pending.pop();if(!object||seen.has(object)||seen.size>=16384)throw Error('scene owner cycle or bound');
    seen.add(object);objects.push(object);pending.push(...retainedSequence(retainedOwn(object,'children'),16384));}
  return objects;
}

// Lost retirement can delete stale owned handles, but cannot complete or allocate.
// Both inputs are read-only retained journals, never synthetic full scene samples.
export function lostRetirementValid(before,after,ids){
  if(before?.kind!=='retained native journal'||after?.kind!==before.kind||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1)
    ||!before.calls||!after.calls||[before,after].some(s=>['bytes','pendingDeleteBytes','defaultFramebuffer','gpuCurrent'].some(k=>!Number.isSafeInteger(s[k])||s[k]<0))
    ||!Array.isArray(before.bufferSlots)||!Array.isArray(after.bufferSlots)||!Array.isArray(before.nativeEvents)||!Array.isArray(after.nativeEvents)
    ||before.bytes!==after.bytes||before.defaultFramebuffer!==after.defaultFramebuffer||after.gpuCurrent<before.gpuCurrent
    ||before.bufferSlots.length!==after.bufferSlots.length||after.nativeEvents.length<before.nativeEvents.length
    ||JSON.stringify(after.nativeEvents.slice(0,before.nativeEvents.length))!==JSON.stringify(before.nativeEvents))return false;
  if([before,after].some(s=>new Set(s.bufferSlots.map(b=>b?.id)).size!==s.bufferSlots.length||s.bufferSlots.some(b=>!Number.isSafeInteger(b?.id)||b.id<1)))return false;
  if([before,after].some(s=>!Array.isArray(s.vertexArrays)||!Array.isArray(s.vertexArrayEvents)||new Set(s.vertexArrays.map(v=>v?.id)).size!==s.vertexArrays.length||s.vertexArrays.some(v=>!Number.isSafeInteger(v?.id)||v.id<1||typeof v.deleted!=='boolean'))
    ||before.vertexArrays.length!==after.vertexArrays.length||JSON.stringify(after.vertexArrayEvents.slice(0,before.vertexArrayEvents.length))!==JSON.stringify(before.vertexArrayEvents))return false;
  const outgoingVaos=before.vertexArrays.filter(v=>!v.deleted).map(v=>v.id),vaoEvents=after.vertexArrayEvents.slice(before.vertexArrayEvents.length);
  if(vaoEvents.length!==outgoingVaos.length||new Set(vaoEvents.map(e=>e.id)).size!==outgoingVaos.length||vaoEvents.some(e=>e.operation!=='delete'||!outgoingVaos.includes(e.id))
    ||before.vertexArrays.some(v=>!after.vertexArrays.some(a=>a.id===v.id&&a.deleted===true)))return false;
  let added=0;
  for(const b of before.bufferSlots){const a=after.bufferSlots.find(a=>a.id===b.id);if(!a||a.bytes!==b.bytes||!Number.isSafeInteger(b.bytes)||b.bytes<1||typeof b.pendingDelete!=='boolean'||typeof a.pendingDelete!=='boolean')return false;
    if(ids.includes(b.id)){if(b.pendingDelete||!a.pendingDelete)return false;added+=b.bytes;}else if(a.pendingDelete!==b.pendingDelete)return false;}
  if(ids.some(id=>!before.bufferSlots.some(b=>b.id===id))||after.pendingDeleteBytes!==before.pendingDeleteBytes+added)return false;
  const events=after.nativeEvents.slice(before.nativeEvents.length);
  if(events.length!==ids.length||new Set(events.map(e=>e.id)).size!==ids.length||events.some(e=>e.operation!=='retire'||e.kind!=='buffer'||!ids.includes(e.id)))return false;
  for(const key of new Set([...Object.keys(before.calls||{}),...Object.keys(after.calls||{})])){
    if(!Number.isSafeInteger(before.calls[key]??0)||(before.calls[key]??0)<0||!Number.isSafeInteger(after.calls[key]??0)||(after.calls[key]??0)<0)return false;
    const delta=(after.calls?.[key]||0)-(before.calls?.[key]||0);
    if(key==='deleteBuffer'){if(delta!==ids.length)return false;}else if(key==='deleteVertexArray'){if(delta!==outgoingVaos.length)return false;}else if(delta!==0)return false;
  }
  return (after.calls?.deleteBuffer||0)-(before.calls?.deleteBuffer||0)===ids.length;
}

// Diagnostic capture only. Hidden tree chunks otherwise keep a previous view's LOD.
// Settle every native geometry, then restore ordinary visibility before any draw.
export function settleSceneCapture(scope,{framedUnitId=null}={}) {
  const {world,rts,camera,game,post}=scope?.__game||{};
  if(typeof world?.trees?.userData?.updateLod!=='function'||!camera||!Number.isFinite(rts?.dist))throw Error('scene capture: native tree and camera owners required');
  if(framedUnitId!==null){
    const unit=game?.units?.find(u=>u.id===framedUnitId&&u.side==='US'&&u.type==='infantry'&&u.alive);
    if(!unit||game.simTime!==0||!Number.isFinite(scope.innerHeight*post?.scale)||scope.innerHeight*post.scale<=0)throw Error('scene capture: living time-zero framed brigade required');
    rts.flyTo(unit.x,unit.z,200);rts.goal.dist=200;rts.goal.pitch=rts._pitch(200);
    rts.snap();rts.update(1);game.setView(camera,scope.innerHeight*post.scale);game.animate(0);
    if(rts.dist!==200||rts.goal.dist!==200)throw Error('scene capture: actual 200m framing required');
  }
  world.trees.userData.updateLod(camera,rts.dist+200,Infinity);
  world.trees.userData.updateLod(camera,rts.dist+200);
  return {framed:framedUnitId!==null,distance:rts.dist,goalDistance:rts.goal?.dist};
}

export async function rejectionObservation(run) {
  try {await run();return {rejected:false,message:''};}
  catch(e){return {rejected:true,message:e?.message||e?.type||String(e)};}
}
// Synchronized GPU estimate, including a resize's old/new default surfaces. CPU arrays are separate.
export class ReservationPeak {
  constructor(){this.peak=0;this.framebuffer=0;this.pendingFramebuffer=0;this.dimensions='';this.current=0;}
  sample(apiBytes,width,height,attributes,generation=false){
    const framebuffer=width*height*(8+(attributes.depth?4:0)+(attributes.stencil?4:0));
    const dimensions=`${width}:${height}`;
    if(generation||dimensions!==this.dimensions)this.pendingFramebuffer+=this.framebuffer;
    this.current=apiBytes+framebuffer+this.pendingFramebuffer;this.peak=Math.max(this.peak,this.current);
    this.framebuffer=framebuffer;this.dimensions=dimensions;return this.current;
  }
  finish(){this.pendingFramebuffer=0;}
}
// Recompute raw ledger/surface equations and finish binds; live accessor identity is a separate producer control.
export function defaultSurfaceHistoryErrors(retained){
  const errors=[],fail=message=>{throw Error('default surface history: '+message);};
  try{
    const rows=retained?.defaultEvents,native=retained?.nativeEvents;
    if(retained?.defaultSurfaceCapture!==true||retained.surfaceRegistered!==true||retained.observerFailureCount!==0
      ||retained.nativeFailureCapture!==true||retained.nativeFailureCount!==0||!Array.isArray(retained.nativeFailures)||retained.nativeFailures.length
      ||!Array.isArray(retained.unknown)||retained.unknown.length||!Array.isArray(rows)||!rows.length||rows.length>16384
      ||!Array.isArray(native)||native.length>16384)fail('incomplete capture');
    if(rows[0].kind!=='sample'||rows[0].boundary!=='creation')fail('first creation missing');
    const natural=n=>Number.isSafeInteger(n)&&n>=0;
    if(!retained.calls||typeof retained.calls!=='object'||Array.isArray(retained.calls)||!Object.values(retained.calls).every(natural)
      ||retained.limits?.defaultEvents!==16384||retained.limits?.nativeEvents!==16384
      ||retained.limits?.signatures!==256||retained.limits?.nativeFailures!==128)fail('calls/limits');
    const callTotal=Object.values(retained.calls).reduce((sum,n)=>sum+n,0);
    if(!natural(callTotal))fail('native call total');
    sceneNativeReplay(native)(native.length,retained);
    const apiAt=[0,...native.map(e=>e.current)];
    const reservationSamples=new Set(rows.filter(row=>row.kind==='sample'&&row.boundary==='native')
      .map(row=>`${row.nativeEventsEnd}/${row.nativeCallOrdinal}/${row.apiBytes}`));
    for(const [index,event]of native.entries())if(event.operation==='reserve'
      &&!reservationSamples.has(`${index}/${event.callOrdinal}/${event.transient}`))
      fail('missing native reservation peak sample');
    let framebuffer=0,pending=0,peak=0,current=0,ordinal=0,end=0,dimensions='',setter=null,finishes=0,attributes=null;
    for(const [i,row]of rows.entries()){
      if(row.sequence!==i+1||!natural(row.nativeCallOrdinal)||row.nativeCallOrdinal<ordinal||row.nativeCallOrdinal>callTotal
        ||!natural(row.nativeEventsEnd)||row.nativeEventsEnd<end||row.nativeEventsEnd>native.length)fail('sequence/native ordering');
      if(row.nativeEventsEnd&&row.nativeCallOrdinal<native[row.nativeEventsEnd-1].callOrdinal)fail('sample precedes consumed native event');
      if(row.kind==='finish'){
        if(setter||native.slice(end,row.nativeEventsEnd).filter(e=>e.operation==='finish'&&e.call==='finish'&&e.callOrdinal===row.nativeCallOrdinal).length!==1)
          fail('unbound native finish');
        pending=0;finishes++;
      }else{
        if(row.kind!=='sample'||![row.width,row.height,row.apiBytes,row.framebuffer,row.pending,row.current,row.peak].every(natural)
          ||typeof row.attributes?.depth!=='boolean'||typeof row.attributes?.stencil!=='boolean'||typeof row.generation!=='boolean')fail('sample shape');
        const boundary=row.boundary,d=`${row.width}:${row.height}`;
        const next=native[row.nativeEventsEnd];
        if(row.apiBytes!==apiAt[row.nativeEventsEnd]&&!(boundary==='native'&&next?.operation==='reserve'
          &&next.callOrdinal===row.nativeCallOrdinal&&row.apiBytes===next.transient))fail('API bytes not bound to raw native ledger');
        if(attributes&&(row.attributes.depth!==attributes.depth||row.attributes.stencil!==attributes.stencil))fail('attributes changed without proved epoch');
        attributes=row.attributes;
        if(i===0){if(boundary!=='creation'||row.generation||row.nativeCallOrdinal!==0||row.nativeEventsEnd!==0)fail('first creation');}
        else if(boundary==='creation')fail('duplicate creation');
        if(['width-before','height-before'].includes(boundary)){
          if(setter||row.generation)fail('setter start');setter={axis:boundary.split('-')[0],width:row.width,height:row.height,ordinal:row.nativeCallOrdinal};
        }else if(['width-after','height-after'].includes(boundary)){
          if(setter?.axis!==boundary.split('-')[0]||!row.generation||setter.ordinal!==row.nativeCallOrdinal
            ||(setter.axis==='width'?setter.height!==row.height:setter.width!==row.width))fail('setter completion');setter=null;
        }else if(!['creation','native'].includes(boundary)||row.generation||setter)fail('unknown/interleaved boundary');
        if(boundary!=='native'){
          if(!Array.isArray(row.applied)||row.applied.length!==2||row.applied[0]!==row.width||row.applied[1]!==row.height)fail('applied dimensions');
        }else if(row.applied!==null)fail('native boundary shape');
        if(dimensions&&d!==dimensions&&!row.generation)fail('unobserved dimensions');
        if(row.generation)pending+=framebuffer;
        framebuffer=row.width*row.height*(8+(row.attributes.depth?4:0)+(row.attributes.stencil?4:0));
        current=row.apiBytes+framebuffer+pending;peak=Math.max(peak,current);dimensions=d;
        if(![framebuffer,pending,current,peak].every(natural)||row.framebuffer!==framebuffer||row.pending!==pending||row.current!==current||row.peak!==peak)
          fail('surface equation');
      }
      ordinal=row.nativeCallOrdinal;end=row.nativeEventsEnd;
    }
    if(end!==native.length||finishes!==native.filter(e=>e.operation==='finish').length)fail('unconsumed native history/finish');
    if(setter||rows.at(-1).kind!=='sample'||retained.gpuPeak!==peak||retained.gpuCurrent!==current
      ||retained.defaultFramebuffer!==framebuffer||retained.pendingDefaultFramebuffer!==pending
      ||retained.sampledDimensions!==dimensions||finishes!==(retained.calls?.finish||0))fail('terminal totals');
  }catch(error){errors.push(error.message);}
  return errors;
}
// This checks retained graphics evidence only. Native event ordering and game/audio/reload proof remain separate.
export function fieldEpochObservationErrors(observation){
  const errors=[],fail=message=>{throw Error('field epoch history: '+message);};
  try{
    const rows=observation?.epochs,natural=n=>Number.isSafeInteger(n)&&n>=0;
    if(observation?.enabled!==true||observation.epochCapture!==true||observation.overflow!==false||observation.restored!==false
      ||observation.observerFailureCount!==0||!Array.isArray(observation.observerErrors)||observation.observerErrors.length
      ||!Array.isArray(rows)||rows.length!==2||!Array.isArray(observation.states))fail('incomplete observation');
    for(const [i,row]of rows.entries())if(row.sequence!==i+1||row.event!==['webglcontextlost','webglcontextrestored'][i]
      ||row.trusted!==true||row.phase!==1||row.windowTarget!==true||row.targetBound!==true||row.connected!==true
      ||row.documentOwned!==true||!Number.isSafeInteger(row.context)||row.context<1||row.context!==rows[0].context
      ||row.retained?.context!==row.context)fail('event identity/order');
    const matches=observation.states.filter(s=>s.id===rows[0].context);
    if(matches.length!==1)fail('missing context state');
    const after=matches[0].retained,native=after?.nativeEvents;
    if(after?.observed!==true||after.nativeFailureCapture!==true||after.defaultSurfaceCapture!==true||after.surfaceRegistered!==true
      ||!Array.isArray(native)||native.length>16384||!Array.isArray(after.defaultEvents)||after.observerFailureCount!==0
      ||!Array.isArray(after.nativeFailures)||after.nativeFailures.length>128||after.nativeFailures.length!==after.nativeFailureCount
      ||JSON.stringify(after.epochUploadMethods)!==JSON.stringify(['bufferSubData','texSubImage2D','texSubImage3D']))fail('missing retained journal/upload coverage');
    sceneNativeReplay(native)(native.length,after);
    const allowedUnknown=new Set(['default surface loss/restoration epoch unproved','default surface unavailable during loss']);
    const scalar=['bytes','peak','pendingDeleteBytes','gpuCurrent','gpuPeak','defaultFramebuffer','pendingDefaultFramebuffer','nativeFailureCount','observerFailureCount'];
    const snapshots=[...rows.map(r=>r.retained),{...after,nativeEventsEnd:native.length,surfaceEventsEnd:after.defaultEvents.length,
      setterAttempts:observation.setterAttempts,setterCompletions:observation.setterCompletions}];
    let previousEnd=0,previousSurfaces=0;
    for(const s of snapshots){
      if(scalar.some(k=>!natural(s[k]))||s.observerFailureCount!==0||!s.calls||typeof s.calls!=='object'||Array.isArray(s.calls)
        ||Object.keys(s.calls).length>64||Object.keys(s.calls).some(k=>k.length>128)||!Object.values(s.calls).every(natural)||!natural(s.nativeEventsEnd)
        ||s.nativeEventsEnd<previousEnd||s.nativeEventsEnd>native.length||!natural(s.surfaceEventsEnd)
        ||s.surfaceEventsEnd<previousSurfaces||s.surfaceEventsEnd>after.defaultEvents.length
        ||!natural(s.setterAttempts)||!natural(s.setterCompletions)||s.setterCompletions>s.setterAttempts
        ||!Array.isArray(s.unknown)||s.unknown.length>128||s.unknown.some(u=>!allowedUnknown.has(u)))fail('projection shape/unknown');
      const last=native[s.nativeEventsEnd-1],total=Object.values(s.calls).reduce((n,c)=>n+c,0);
      if(!natural(total)||(last?.callOrdinal||0)>total||s.bytes!==(last?.current||0)||s.peak!==(last?.peak||0))fail('projection raw prefix');
      previousEnd=s.nativeEventsEnd;previousSurfaces=s.surfaceEventsEnd;
    }
    const baseline=snapshots[0],forbidden=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced',
      'createVertexArray','bufferData','bufferSubData','texSubImage2D','texSubImage3D','texImage2D','texImage3D','compressedTexImage2D','compressedTexImage3D',
      'texStorage2D','texStorage3D','compressedTexSubImage2D','compressedTexSubImage3D','generateMipmap',
      'renderbufferStorage','renderbufferStorageMultisample','finish'];
    for(const s of snapshots.slice(1)){
      if(forbidden.some(k=>(s.calls[k]||0)!==(baseline.calls[k]||0))||s.nativeFailureCount!==baseline.nativeFailureCount
        ||s.setterAttempts!==baseline.setterAttempts||s.setterCompletions!==baseline.setterCompletions
        ||s.surfaceEventsEnd!==baseline.surfaceEventsEnd||s.gpuPeak!==baseline.gpuPeak||s.gpuCurrent!==baseline.gpuCurrent
        ||s.defaultFramebuffer!==baseline.defaultFramebuffer||s.pendingDefaultFramebuffer!==baseline.pendingDefaultFramebuffer)
        fail('post-loss graphics activity');
      for(const key of new Set([...Object.keys(baseline.calls),...Object.keys(s.calls)]))if((s.calls[key]||0)<(baseline.calls[key]||0))fail('counter reset');
    }
    if(native.slice(baseline.nativeEventsEnd).some(e=>e.operation!=='retire'))fail('post-loss native allocation/completion');
    const lastSurface=after.defaultEvents[baseline.surfaceEventsEnd-1],cut=lastSurface?.nativeEventsEnd;
    if(!natural(cut)||cut>baseline.nativeEventsEnd||native.slice(cut).some(e=>e.operation!=='retire'))fail('pre-loss surface prefix missing');
    for(const s of snapshots)if(['gpuCurrent','gpuPeak','defaultFramebuffer','pendingDefaultFramebuffer'].some((k,i)=>
      s[k]!==lastSurface[['current','peak','framebuffer','pending'][i]]))fail('projection not bound to surface prefix');
    const resources=new Map();
    for(const e of native.slice(0,cut)){
      const key=e.kind+'/'+e.id;
      if(e.operation==='reserve'){
        if(!resources.has(key))resources.set(key,{kind:e.kind,id:e.id,slots:new Map(),pending:false});
        resources.get(key).slots.set(String(e.slot),e.bytes);
      }else if(e.operation==='retire')resources.get(key).pending=true;
      else if(e.operation==='release')resources.delete(key);
    }
    const slots={bufferSlots:[],textureSlots:[],renderbufferSlots:[]},byKind={buffer:0,texture:0,renderbuffer:0};let pendingDeleteBytes=0;
    for(const r of resources.values()){
      const bytes=[...r.slots.values()].reduce((n,v)=>n+v,0);byKind[r.kind]+=bytes;if(r.pending)pendingDeleteBytes+=bytes;
      slots[r.kind==='buffer'?'bufferSlots':r.kind==='texture'?'textureSlots':'renderbufferSlots'].push(r.kind==='texture'?
        {texture:r.id,slots:Object.fromEntries(r.slots),pendingDelete:r.pending}:{id:r.id,bytes,pendingDelete:r.pending});
    }
    // Only the two explicit loss-status markers are excluded from this earlier, complete live prefix.
    // The retire-only tail is verified above; no samples or completion fences are invented.
    const prefix={...after,...slots,byKind,pendingDeleteBytes,objects:resources.size,calls:baseline.calls,unknown:[],
      nativeEvents:native.slice(0,cut),defaultEvents:after.defaultEvents.slice(0,baseline.surfaceEventsEnd),
      bytes:native[cut-1]?.current||0,peak:native[cut-1]?.peak||0,
      signatures:after.signatures.filter(s=>s.callOrdinal<=lastSurface.nativeCallOrdinal),
      nativeFailureCount:baseline.nativeFailureCount,nativeFailures:after.nativeFailures.slice(0,baseline.nativeFailureCount),
      gpuCurrent:baseline.gpuCurrent,gpuPeak:baseline.gpuPeak,defaultFramebuffer:baseline.defaultFramebuffer,
      pendingDefaultFramebuffer:baseline.pendingDefaultFramebuffer,sampledDimensions:`${lastSurface.width}:${lastSurface.height}`};
    if(defaultSurfaceHistoryErrors(prefix).length)fail('invalid complete pre-loss surface history');
  }catch(error){errors.push(error.message);}
  return errors;
}
export function mipSizes(w,h,bpp,levels=Math.floor(Math.log2(Math.max(w,h)))+1) {
  if(![w,h,bpp,levels].every(Number.isSafeInteger)||w<1||h<1||bpp<1||levels<1||levels>32)throw new Error('allocation: invalid mip dimensions');
  const out=[];for(let i=0;i<levels;i++){out.push({w,h,bytes:w*h*bpp});w=Math.max(1,w>>1);h=Math.max(1,h>>1);}return out;
}
export class AllocationLedger {
  constructor(){this.objects=new Map();this.retired=new Set();this.bytes=0;this.peak=0;this.calls=0;}
  reserve(id,kind,slot,bytes,overlap=true,detail=null){
    if(!id||!['texture','renderbuffer','buffer'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('allocation: invalid reservation');
    let r=this.objects.get(id);if(r&&r.kind!==kind)throw new Error('allocation: resource kind changed');
    if(!r){r={kind,slots:new Map()};this.objects.set(id,r);}
    const prior=r.slots.get(slot)||0;
    const transient=this.bytes+bytes-(overlap?0:prior);
    this.peak=Math.max(this.peak,transient);
    this.onReservation?.(transient);
    this.bytes+=bytes-prior;r.slots.set(slot,bytes);this.calls++;
    this.onEvent?.('reserve',{id,kind,slot,bytes,previous:prior,transient,overlap,detail});
  }
  retire(id){const r=this.objects.get(id);if(r){this.retired.add(id);this.onEvent?.('retire',{id,kind:r.kind});}}
  sync(){for(const id of this.retired){const r=this.objects.get(id);if(r){this.bytes-=[...r.slots.values()].reduce((a,b)=>a+b,0);this.objects.delete(id);this.onEvent?.('release',{id,kind:r.kind});}}this.retired.clear();}
  snapshot(){
    const byKind={texture:0,renderbuffer:0,buffer:0};let pendingDeleteBytes=0;
    for(const [id,r]of this.objects){const n=[...r.slots.values()].reduce((a,b)=>a+b,0);byKind[r.kind]+=n;if(this.retired.has(id))pendingDeleteBytes+=n;}
    return {bytes:this.bytes,peak:this.peak,byKind,pendingDeleteBytes,objects:this.objects.size,calls:this.calls};
  }
}

/** Whole backing storage; view lengths explain aliases and never form the storage sum. */
export function inventoryRetainedBuffers(rows,{requiredGroups=[],observedGroups=[],errors=[]}={}) {
  const backings=new Map(),views=new Map(),issues=[];
  const sequence=(value,limit,label)=>{try{return retainedSequence(value,limit);}catch(error){if(issues.length<32)issues.push(label+': '+retainedMessage(error));return [];}};
  for(const e of sequence(errors,32,'coverage errors'))issues.push(typeof e==='string'?e.slice(0,1024):'invalid coverage error');
  requiredGroups=sequence(requiredGroups,32,'required groups');observedGroups=sequence(observedGroups,32,'observed groups');
  for(const groups of [requiredGroups,observedGroups])for(let i=0;i<groups.length;i++)if(typeof groups[i]!=='string'||!groups[i]||groups[i].length>128){groups[i]='invalid-group';if(issues.length<32)issues.push('invalid owner group');}
  const issue=message=>{if(issues.length<32)issues.push(message.slice(0,1024));};
  const typed=Object.getPrototypeOf(Uint8Array.prototype),get=(p,k,v)=>Object.getOwnPropertyDescriptor(p,k).get.call(v);
  for(const row of sequence(rows,16384,'retained view row bound')){
    let owner='unknown';
    try{
      const own=key=>{const d=Object.getOwnPropertyDescriptor(row,key);if(!d||!Object.hasOwn(d,'value'))throw Error('view data descriptor');return d.value;},
        v=own('array'),label=own('owner'),role=own('role');owner=typeof label==='string'?label.slice(0,256):'unknown';
      if(!ArrayBuffer.isView(v)||typeof label!=='string'||!label||label.length>512
        ||!['geometry','texture-payload','cpu-state','oracle','template'].includes(role))throw Error('view owner/role');
      const proto=v instanceof DataView?DataView.prototype:typed,
        buffer=get(proto,'buffer',v),offset=get(proto,'byteOffset',v),length=get(proto,'byteLength',v),
        bytes=get(ArrayBuffer.prototype,'byteLength',buffer),resize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable');
      if(resize?.get.call(buffer)||!Number.isSafeInteger(bytes)||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)
        ||offset<0||length<0||offset+length>bytes)throw Error('unsupported backing/range');
      new Uint8Array(buffer,0,0); // Detached buffers reject even when their reported length is zero.
      if(!backings.has(buffer))backings.set(buffer,{id:backings.size+1,byteLength:bytes});
      if(!views.has(v))views.set(v,{id:views.size+1,backingId:backings.get(buffer).id,
        type:v instanceof DataView?'DataView':get(typed,Symbol.toStringTag,v),byteOffset:offset,byteLength:length,owners:new Set(),roles:new Set()});
      const entry=views.get(v);entry.owners.add(label);entry.roles.add(role);
    }catch(error){
      let message='invalid retained view';try{const d=Object.getOwnPropertyDescriptor(error,'message');if(typeof d?.value==='string')message=d.value;}catch{}
      issue('retained '+owner+': '+message);
    }
  }
  if(!Array.isArray(requiredGroups)||!Array.isArray(observedGroups)||new Set(requiredGroups).size!==requiredGroups.length
    ||new Set(observedGroups).size!==observedGroups.length||requiredGroups.some(g=>typeof g!=='string'||!g||!observedGroups.includes(g)))issue('missing required owner group');
  const retainedBackingBytes=[...backings.values()].reduce((n,b)=>n+b.byteLength,0);
  if(!Number.isSafeInteger(retainedBackingBytes))issue('unsafe retained total');
  return {version:2,kind:'explicit retained application buffer owners; not whole heap or transient coverage',
    coverage:{requiredGroups:Array.isArray(requiredGroups)?[...requiredGroups]:[],observedGroups:Array.isArray(observedGroups)?[...observedGroups]:[],complete:issues.length===0,errors:issues},
    backings:[...backings.values()],views:[...views.values()].map(v=>({...v,owners:[...v.owners],roles:[...v.roles]})),retainedBackingBytes};
}

/** Independent serialized arithmetic and geometry-view binding; no application or GL access. */
export function retainedBufferInventoryErrors(r,{requiredGroups,ownerShapes,geometryArrays,bufferOwnership}={}) {
  const errors=[];const must=(ok,message)=>{if(!ok)throw Error(message);};
  try{
    must(r?.version===2&&r.coverage?.complete===true&&r.coverage.errors?.length===0,'complete version2 inventory');
    must(Array.isArray(requiredGroups)&&JSON.stringify(r.coverage.requiredGroups)===JSON.stringify(requiredGroups)
      &&Array.isArray(r.coverage.observedGroups)&&new Set(r.coverage.observedGroups).size===r.coverage.observedGroups.length
      &&requiredGroups.every(g=>r.coverage.observedGroups.includes(g)),'required owner coverage');
    must(Array.isArray(r.backings)&&r.backings.length<=16384&&Array.isArray(r.views)&&r.views.length<=16384,'inventory bounds');
    let bytes=0;const backing=new Map(),owners=new Set(),anchoredViews=new Set();
    for(const [i,b]of r.backings.entries()){
      must(b.id===i+1&&Number.isSafeInteger(b.byteLength)&&b.byteLength>=0,'backing identity/bytes');backing.set(b.id,b.byteLength);bytes+=b.byteLength;
    }
    must(Number.isSafeInteger(bytes)&&bytes===r.retainedBackingBytes,'whole backing equation');
    for(const [i,v]of r.views.entries()){
      must(v.id===i+1&&backing.has(v.backingId)&&Number.isSafeInteger(v.byteOffset)&&v.byteOffset>=0
        &&Number.isSafeInteger(v.byteLength)&&v.byteLength>=0&&v.byteOffset+v.byteLength<=backing.get(v.backingId),'view identity/range');
      must(['Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','DataView'].includes(v.type),'view storage type');
      const elementBytes={Int8Array:1,Uint8Array:1,Uint8ClampedArray:1,Int16Array:2,Uint16Array:2,Int32Array:4,Uint32Array:4,Float32Array:4,Float64Array:8,BigInt64Array:8,BigUint64Array:8,DataView:1}[v.type];
      must(v.byteOffset%elementBytes===0&&v.byteLength%elementBytes===0,'typed view alignment/length');
      must(Array.isArray(v.owners)&&v.owners.length>0&&new Set(v.owners).size===v.owners.length
        &&v.owners.every(o=>typeof o==='string'&&o&&o.length<=512),'view owner labels');
      must(Array.isArray(v.roles)&&v.roles.length>0&&new Set(v.roles).size===v.roles.length
        &&v.roles.every(x=>['geometry','texture-payload','cpu-state','oracle','template'].includes(x)),'view roles');
      v.owners.forEach(o=>owners.add(o));
    }
    must(r.backings.every(b=>r.views.some(v=>v.backingId===b.id)),'no invented unused backing');
    if(ownerShapes!==undefined){
      must(Array.isArray(ownerShapes)&&ownerShapes.length<=16384&&new Set(ownerShapes.map(s=>s.owner)).size===ownerShapes.length,'source owner contract');
      const forward=new Map(),reverse=new Map();
      for(const shape of ownerShapes){
        must(typeof shape.backing==='string'&&shape.backing&&Number.isSafeInteger(shape.backingByteLength)
          &&shape.backingByteLength>=0&&Number.isSafeInteger(shape.byteOffset)&&shape.byteOffset>=0
          &&['geometry','texture-payload','cpu-state','oracle','template'].includes(shape.role),'source backing contract');
        const matches=r.views.filter(v=>v.owners.includes(shape.owner)&&v.type===shape.type&&v.byteLength===shape.byteLength
          &&v.byteOffset===shape.byteOffset&&v.roles.includes(shape.role)&&backing.get(v.backingId)===shape.backingByteLength);
        must(matches.length===1,'mandatory source owner '+shape.owner);const id=matches[0].backingId;
        anchoredViews.add(matches[0].id);
        must(!forward.has(shape.backing)||forward.get(shape.backing)===id,'source aliases share backing');
        must(!reverse.has(id)||reverse.get(id)===shape.backing,'distinct source backings stay distinct');
        forward.set(shape.backing,id);reverse.set(id,shape.backing);
      }
    }
    if(geometryArrays!==undefined){
      must(Array.isArray(geometryArrays)&&Array.isArray(bufferOwnership)&&Array.isArray(r.geometryBindings),'geometry bindings');
      const geometry=r.views.filter(v=>v.roles.includes('geometry'));
      must(r.geometryBindings.length===geometry.length&&geometry.length===geometryArrays.length
        &&new Set(r.geometryBindings.map(g=>g.geometryArrayId)).size===geometryArrays.length
        &&geometryArrays.every(a=>r.geometryBindings.some(g=>g.geometryArrayId===a.id)),'complete geometry bindings');
      for(const [i,v]of geometry.entries()){
        // Generic world/label/Post geometry has no DOM-independent shape oracle. Refuse
        // cross-view storage sharing there rather than accepting an unproved byte discount.
        // Shared storage is accepted only when the source owner contract anchors that view.
        if(!anchoredViews.has(v.id))must(v.byteOffset===0&&v.byteLength===backing.get(v.backingId)
          &&r.views.filter(other=>other.backingId===v.backingId).length===1,'unanchored geometry requires a distinct full backing');
        const binding=r.geometryBindings[i],matching=geometryArrays.find(a=>a.id===binding.geometryArrayId);
        must(binding.viewId===v.id&&matching?.bytes===v.byteLength&&matching.arrayType===v.type
          &&matching.owners.every(o=>v.owners.includes(o)),'geometry view matches original CPU view');
        must(Array.isArray(binding.nativeReservationIds)&&new Set(binding.nativeReservationIds).size===binding.nativeReservationIds.length
          &&binding.nativeReservationIds.every(id=>bufferOwnership.some(b=>b.id===id&&b.bytes===v.byteLength
            &&b.owners.some(o=>v.owners.includes(o)))),'native geometry owner binding');
      }
      must(bufferOwnership.every(b=>r.geometryBindings.some(g=>g.nativeReservationIds.includes(b.id))),'all native buffers have geometry views');
    }
  }catch(error){errors.push(error.message);}
  return errors;
}

export const RETAINED_BUFFER_GROUPS=Object.freeze(['geometry','terrain','textures','atlases','pools','ground','templates']);

/** Named application owners only. No arbitrary getter walk, upload, draw or application mutation. */
export function collectRetainedBufferRows(field,{geometryRows,textures,terrainArrays,figureTemplates,phase}={}) {
  const rows=[],observedGroups=[],errors=[],unmeasuredImages=[];
  const own=retainedOwn,entries=retainedEntries,sequence=retainedSequence;
  const add=(array,owner,role,type=null,length=null)=>{
    if(!ArrayBuffer.isView(array)||type&&! (array instanceof type))throw Error('typed owner '+owner);
    if(length!==null&&Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length').get.call(array)!==length)throw Error('owner capacity '+owner);
    if(rows.length>=16384)throw Error('retained owner row bound');rows.push({array,owner,role});
  };
  const group=(name,fn)=>{try{fn();observedGroups.push(name);}catch(error){
    let message='invalid owner';try{const d=Object.getOwnPropertyDescriptor(error,'message');if(typeof d?.value==='string')message=d.value;}catch{}
    if(errors.length<32)errors.push((name+': '+message).slice(0,1024));
  }};
  const image=(value,owner)=>{
    if(ArrayBuffer.isView(value)){add(value,owner,'texture-payload');return;}
    if(Array.isArray(value)){if(value.length>64)throw Error('texture image bound');sequence(value,64).forEach((v,i)=>image(v,owner+'/'+i));return;}
    if(value&&typeof value==='object'){
      const data=own(value,'data',true);
      if(ArrayBuffer.isView(data)){add(data,owner+'/data','texture-payload');return;}
    }
    if(unmeasuredImages.length>=4096)throw Error('unmeasured image bound');
    unmeasuredImages.push(owner);
  };
  const texture=(t,owner)=>{
    if(own(t,'isTexture')!==true)throw Error('texture owner '+owner);
    const compressed=own(t,'isCompressedTexture',true)===true;
    if(!compressed)image(own(own(t,'source'),'data'),owner+'/source');
    const mips=own(t,'mipmaps');if(!Array.isArray(mips)||mips.length>32)throw Error('texture mip bound');
    for(const [i,mip]of sequence(mips,32).entries()){
      if(compressed)add(own(mip,'data'),owner+'/mip/'+i,'texture-payload');
      else image(mip,owner+'/mip/'+i);
    }
  };
  const uniformTexture=(material,key,owner,userData=false)=>{
    const uniforms=userData?own(own(material,'userData'),'uniforms'):own(material,'uniforms');
    const t=own(own(uniforms,key),'value');texture(t,owner);return t;
  };
  const geometryAttribute=(a,label)=>{
    const data=own(a,'isInterleavedBufferAttribute',true)===true?own(own(a,'data'),'array'):own(a,'array');
    if(!sequence(geometryRows).some(r=>own(r,'array')===data))throw Error('owned mesh absent from scene/Post inventory '+label);
    add(data,label,'geometry');
  };
  const mesh=(m,owner)=>{
    const g=own(m,'geometry'),attributes=entries(own(g,'attributes'));
    if(!attributes.length)throw Error('missing owned geometry '+owner);
    const attribute=geometryAttribute;
    for(const [key,a]of attributes)attribute(a,owner+'/geometry/'+key);
    const index=own(g,'index');if(index)attribute(index,owner+'/geometry/index');
    for(const [key,list]of entries(own(g,'morphAttributes')))for(const [i,a]of sequence(list).entries())attribute(a,owner+'/morph/'+key+'/'+i);
    for(const key of ['instanceMatrix','instanceColor']){const a=own(m,key,true);if(a)attribute(a,owner+'/'+key);}
  };
  let game,world,terrain;
  try{game=own(field,'game');world=own(field,'world');terrain=own(field,'terrain');}
  catch{return {rows,requiredGroups:[...RETAINED_BUFFER_GROUPS],observedGroups,errors:['missing or accessor field roots'],unmeasuredImages,
    unmeasured:['unread field owners','loader-private pending storage','construction/upload intervals','HTML image/canvas backing','third-party private heap','decoder and physical driver memory']};}
  group('geometry',()=>{
    if(!Array.isArray(geometryRows)||!geometryRows.length)throw Error('missing scene/Post geometry');
    for(const r of sequence(geometryRows))add(own(r,'array'),own(r,'owner'),'geometry');
  });
  group('terrain',()=>{
    const grid=own(terrain,'grid');if(!Number.isSafeInteger(grid)||grid<3||grid>2049)throw Error('terrain grid');
    add(own(terrain,'heights'),'terrain.heights','cpu-state',Float32Array,grid*grid);
    if(!Array.isArray(terrainArrays)||terrainArrays.length<6||terrainArrays.length>256)throw Error('missing terrain original/oracle owners');
    for(const r of sequence(terrainArrays,256))add(own(r,'array'),own(r,'owner'),'oracle');
  });
  group('textures',()=>{
    if(!Array.isArray(textures)||!textures.length||textures.length>4096)throw Error('missing referenced textures');
    for(const [i,t]of sequence(textures,4096).entries())texture(t,'referenced-texture/'+i);
    const material=own(own(world,'terrainMesh'),'material');
    const normal=uniformTexture(material,'uNormal','texture/terrain-normal'),noise=uniformTexture(material,'uNoise','texture/terrain-noise');
    const payload=t=>own(own(own(t,'source'),'data'),'data');
    const grid=own(terrain,'grid');if(!Number.isSafeInteger(grid)||grid<3||grid>2049)throw Error('terrain texture grid');
    add(payload(normal),'terrain.normalPixels','texture-payload',Uint8Array,grid*grid*4);
    add(payload(noise),'terrain.noisePixels','texture-payload',Uint8Array,256*256*4);
    uniformTexture(own(own(own(game,'pools'),'US'),'material'),'uBones','texture/bones',true);
    const colours=[];for(const o of retainedSceneObjects(own(field,'scene')))if(own(o,'name',true)==='colours')colours.push(o);
    if(colours.length!==1)throw Error('actual flag texture owner');
    texture(own(own(colours[0],'material'),'map'),'texture/flags');
    mesh(colours[0],'flags');
  });
  group('atlases',()=>{
    if(!['field','close'].includes(phase))throw Error('declared settled checkpoint');
    const baked=own(game,'baked');if(own(baked,'state')!=='ready')throw Error('published baked state');
    const atlases=own(baked,'atlases');
    for(const side of ['US','CS']){
      const atlas=own(atlases,side);
      // Identity-bound reviewed getters only; shadowing or prototype replacement rejects before invocation.
      if(Object.getPrototypeOf(atlas)!==retainedAtlasPrototype
        ||['loadsSettled','cleanupFailure'].some(key=>Object.getOwnPropertyDescriptor(atlas,key)
          ||Object.getOwnPropertyDescriptor(retainedAtlasPrototype,key)?.get!==retainedAtlasGetters[key])
        ||retainedAtlasGetters.loadsSettled.call(atlas)!==true
        ||own(retainedAtlasGetters.cleanupFailure.call(atlas),'failed')!==false
        ||own(atlas,'disposed',true))throw Error('atlas load or cleanup pending');
      const layout=own(atlas,'layout'),slots=own(layout,'slots'),directions=own(layout,'n'),clips=own(layout,'clipNames');
      if(!Number.isSafeInteger(slots)||slots<1||!Number.isSafeInteger(directions)||directions<1||!Array.isArray(clips))throw Error('atlas lookup dimensions');
      add(own(layout,'slotClip'),'atlas/'+side+'/slotClip','cpu-state',Uint8Array,slots);
      for(const [tier,t]of entries(own(layout,'tiers'))){
        if(!['field','close'].includes(tier))throw Error('unknown atlas tier');
        const looks=own(t,'looks');if(!Array.isArray(looks)||!looks.length)throw Error('atlas looks');
        add(own(t,'rects'),'atlas/'+side+'/'+tier+'/rects','cpu-state',Float32Array,looks.length*slots*directions*8);
        add(own(t,'dirTable'),'atlas/'+side+'/'+tier+'/dirTable','cpu-state',Uint8Array,clips.length*directions*8);
      }
      const published=own(atlas,'textures'),tiers=phase==='field'?['field']:['field','close'];
      if(entries(published).length!==tiers.length)throw Error('unexpected published tier');
      for(const tier of tiers){
        const pages=own(published,tier),metadata=own(own(layout,'tiers'),tier);
        if(!Array.isArray(pages)||pages.length!==sequence(own(metadata,'pages'),64).length)throw Error('published page count');
        for(const [i,t]of sequence(pages,64).entries())texture(t,'atlas/'+side+'/'+tier+'/'+i);
      }
      const pool=own(own(game,'impostors'),side);
      if(own(pool,'atlas')!==atlas||own(pool,'layout')!==layout)throw Error('actual pool/atlas lookup identity');
    }
  });
  group('pools',()=>{
    for(const side of ['US','CS']){
      const standing=own(own(game,'pools'),side),fallen=own(own(game,'fallen'),side),sprite=own(own(game,'impostors'),side),capacity=own(standing,'capacity');
      if(!Number.isSafeInteger(capacity)||capacity<1||own(fallen,'capacity')!==capacity||own(sprite,'capacity')!==capacity)throw Error('source pool capacity');
      const buckets=own(standing,'buckets');if(!Array.isArray(buckets)||buckets.length!==3)throw Error('all standing LOD owners');
      for(const [i,b]of sequence(buckets,3).entries()){
        mesh(own(b,'mesh'),'pools/'+side+'/'+i);const outline=own(b,'outline');if(outline)mesh(outline,'pools/'+side+'/'+i+'/outline');
      }
      mesh(own(fallen,'mesh'),'fallen/'+side);
      for(const [key,type,stride]of [['fallen',Float32Array,8],['poses',Uint32Array,0],['looks',Uint32Array,0]])
        add(own(sprite,key),'impostors/'+side+'/'+key,'cpu-state',type,stride?capacity*stride:8);
      for(const [key,type]of [['bakeable',Uint8Array],['born',Float32Array],['baseY',Float32Array]])add(own(fallen,key),'fallen/'+side+'/'+key,'cpu-state',type,capacity);
      for(const [tier,batches]of entries(own(sprite,'batches'))){
        if(!['field','close'].includes(tier)||!Array.isArray(batches))throw Error('sprite batch owners');
        const published=own(own(own(own(game,'baked'),'atlases'),side),'textures'),pages=own(published,tier,true);
        if(batches.length!==(pages===undefined?0:sequence(pages,64).length))throw Error('complete published sprite batches');
        for(const [i,b]of sequence(batches,64).entries()){
          add(own(b,'data'),'impostors/'+side+'/'+tier+'/'+i+'/data','geometry',Float32Array,capacity*12);
          mesh(own(b,'body'),'impostors/'+side+'/'+tier+'/'+i+'/body');
          mesh(own(b,'soft'),'impostors/'+side+'/'+tier+'/'+i+'/soft');
        }
      }
    }
  });
  group('ground',()=>{
    const objects=retainedSceneObjects(own(field,'scene'));
    for(const name of ['apron','buildings','fences']){
      const matches=objects.filter(o=>own(o,'name',true)===name);if(matches.length!==1)throw Error('world geometry owner '+name);
      if(name==='fences')for(const [i,child]of sequence(own(matches[0],'children'),4096).entries())mesh(child,'world/fences/'+i);
      else mesh(matches[0],'world/'+name);
    }
    const trees=own(world,'trees');
    for(const [i,child]of sequence(own(trees,'children'),4096).entries())for(const key of ['instanceMatrix','instanceColor'])
      geometryAttribute(own(child,key),'world/trees/'+i+'/'+key);
    mesh(own(own(field,'post'),'quad'),'post/quad');
    for(const key of ['roadField','streamField','fenceField']){
      const f=own(world,key),n=own(f,'n');if(!Number.isSafeInteger(n)||n<1)throw Error('ground field grid');
      add(own(f,'d'),'world/'+key+'/d','cpu-state',Float32Array,n*n);
    }
    const parcels=own(world,'parcels'),points=own(parcels,'P'),n=own(parcels,'rn'),neighbors=own(parcels,'nbrs');
    if(!Number.isSafeInteger(n)||n<1||n>4096)throw Error('parcel region grid');
    add(points,'world/parcels/P','cpu-state',Float64Array);
    add(own(parcels,'reg'),'world/parcels/reg','cpu-state',Int16Array,n*n);
    const pointCount=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length').get.call(points);
    if(!Array.isArray(neighbors)||neighbors.length!==pointCount/2||neighbors.length>4096)throw Error('parcel neighbor count');
    sequence(neighbors,4096).forEach((v,i)=>add(v,'world/parcels/nbrs/'+i,'cpu-state',Int32Array));
    const d=own(parcels,'delaunay');
    for(const key of ['inedges','_hullIndex','points','halfedges','hull','triangles'])add(own(d,key),'world/parcels/delaunay/'+key,'cpu-state');
    const collinear=own(d,'collinear',true);if(collinear!==undefined)add(collinear,'world/parcels/delaunay/collinear','cpu-state',Int32Array);
    const internal=own(d,'_delaunator');
    for(const key of ['coords','_triangles','_halfedges','_hullPrev','_hullNext','_hullTri','_hullHash','_ids','_dists','hull','triangles','halfedges'])
      add(own(internal,key),'world/parcels/delaunator/'+key,'cpu-state');
  });
  group('templates',()=>{
    if(!Array.isArray(figureTemplates)||!figureTemplates.length||figureTemplates.length>256)throw Error('missing existing figure templates');
    for(const r of sequence(figureTemplates,256))add(own(r,'array'),own(r,'owner'),'template');
    for(const r of retainedTreeGeometryArrays(own(world,'trees')))add(own(r,'array'),own(r,'owner'),'template');
  });
  return {rows,requiredGroups:[...RETAINED_BUFFER_GROUPS],observedGroups,errors,unmeasuredImages,
    unmeasured:['loader-private pending storage','construction/upload intervals','HTML image/canvas backing','third-party private heap','decoder and physical driver memory']};
}

/** Observe existing native reservations only. Never upload, draw, flush or finish here. */
export function sampleSceneAllocations(scope=globalThis.window,{retainedContext=null,retainedBuffers=null}={}) {
  if(retainedBuffers===null)return sampleLegacySceneAllocations(scope,{retainedContext});
  try{return sampleRetainedSceneAllocations(scope,{retainedContext,retainedBuffers});}
  catch(error){const message=retainedMessage(error);return {accountingFailure:message,
    retainedBufferInventory:inventoryRetainedBuffers([],{requiredGroups:[...RETAINED_BUFFER_GROUPS],errors:[message]})};}
}

function sampleRetainedSceneAllocations(scope,{retainedContext,retainedBuffers}) {
  const own=retainedOwn,entries=retainedEntries,sequence=retainedSequence,values=o=>entries(o).map(([,v])=>v),
    field=own(scope,'__game'),scene=own(field,'scene'),post=own(field,'post'),game=own(field,'game'),
    phase=own(retainedBuffers,'phase'),figureTemplates=own(retainedBuffers,'figureTemplates',true)??retainedFigureGeometryArrays(),
    partition=own(scope,'__sceneTerrainPartition'),terrainArrays=sequence(own(partition,'retainedArrays'),256);
  if(!['field','close'].includes(phase)||retainedContext===null)throw Error('allocation: explicit settled checkpoint and retained context required');
  const arrays=new Map(),textures=new Set(),owners=new Map(),typed=Object.getPrototypeOf(Uint8Array.prototype),
    byteLength=a=>Object.getOwnPropertyDescriptor(a instanceof DataView?DataView.prototype:typed,'byteLength').get.call(a),
    arrayType=a=>a instanceof DataView?'DataView':Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get.call(a);
  let declaredArrayBytes=0;
  for(const key of ['pools','fallen','impostors'])for(const [side,pool]of entries(own(game,key)))
    owners.set(own(pool,key==='fallen'?'mesh':'group'),key+'.'+side);
  const array=(a,owner)=>{if(a!=null){if(!ArrayBuffer.isView(a))throw Error('allocation: typed geometry owner');
    if(typeof owner!=='string'||!owner||owner.length>512)throw Error('allocation: bounded owner label');
    if(!arrays.has(a)){if(arrays.size>=16384)throw Error('allocation: geometry view bound');
      arrays.set(a,new Set());declaredArrayBytes+=byteLength(a);if(!Number.isSafeInteger(declaredArrayBytes))throw Error('allocation: unsafe CPU sum');}arrays.get(a).add(owner);}};
  const attribute=(a,owner)=>{if(a!=null)array(own(a,'isInterleavedBufferAttribute',true)===true?own(own(a,'data'),'array'):own(a,'array'),owner);};
  const texture=x=>{if(Array.isArray(x)){sequence(x,4096).forEach(texture);return;}
    if(x&&typeof x==='object'&&own(x,'isTexture',true)===true)textures.add(x);};
  for(const root of [scene,own(post,'qScene',true)].filter(Boolean))for(const o of retainedSceneObjects(root)){
    let ancestor=o,owner;const seen=new Set();
    while(ancestor&&!owner){if(seen.has(ancestor)||seen.size>16384)throw Error('allocation: ancestor cycle');seen.add(ancestor);
      owner=owners.get(ancestor);ancestor=own(ancestor,'parent',true);}
    const name=own(o,'name',true),type=own(o,'type',true);
    if(name!==undefined&&typeof name!=='string'||type!==undefined&&typeof type!=='string')throw Error('allocation: object label');
    owner=(owner||'scene')+'/'+(name||type||'Object')+(own(o,'visible',true)?'':'(hidden)');
    const g=own(o,'geometry',true);if(g){for(const a of values(own(g,'attributes')))attribute(a,owner);
      attribute(own(g,'index'),owner);for(const list of values(own(g,'morphAttributes')))for(const a of sequence(list))attribute(a,owner);}
    attribute(own(o,'instanceMatrix',true),owner);attribute(own(o,'instanceColor',true),owner);
    const material=own(o,'material',true);
    for(const m of (Array.isArray(material)?sequence(material,64):[material]).filter(Boolean)){
      values(m).forEach(texture);const uniforms=own(m,'uniforms',true);
      if(uniforms)for(const u of values(uniforms))texture(own(u,'value'));
    }
  }
  const atlases=own(own(game,'baked'),'atlases');
  for(const atlas of values(atlases))for(const pages of values(own(atlas,'textures')))sequence(pages,64).forEach(texture);
  const sceneArrayBytes=declaredArrayBytes,sceneArrays=new Set(arrays.keys());
  for(const retained of terrainArrays){const a=own(retained,'array'),owner=own(retained,'owner');
    if(!ArrayBuffer.isView(a)||typeof owner!=='string'||!owner)throw Error('allocation: invalid retained terrain array');array(a,owner);}
  // Validate every named owner before calling even the read-only native owner-label boundary.
  const geometryRows=[...sceneArrays].flatMap(array=>[...arrays.get(array)].map(owner=>({array,owner}))),
    graph=collectRetainedBufferRows(field,{geometryRows,textures:[...textures],terrainArrays,figureTemplates,phase}),
    inventory=inventoryRetainedBuffers(graph.rows,graph);
  inventory.phase=phase;inventory.unmeasured=graph.unmeasured;inventory.unmeasuredImages=graph.unmeasuredImages;
  if(!inventory.coverage.complete)return {retainedBufferInventory:inventory,accountingFailure:'incomplete retained owner graph'};
  const observer=own(scope,'__allocation'),gl=retainedContext;
  own(observer,'assertOwned').call(observer,gl);
  if(own(own(observer,'peek').call(observer,gl),'observed')!==true)throw Error('allocation: registered retained context required');
  const nativeGeometry=new Map(),unuploaded=[];
  for(const [a,labels]of arrays){const records=sceneArrays.has(a)?own(observer,'labelBufferOwners').call(observer,gl,a,[...labels]):[];
    if(sceneArrays.has(a))nativeGeometry.set(a,records);
    if(!records.length)unuploaded.push({bytes:byteLength(a),owners:[...labels]});}
  const allocation=own(observer,'peek').call(observer,gl),bufferOwnership=allocation.bufferSlots;
  if(allocation.observed!==true)throw Error('allocation: registered retained context required');
  const mappedBufferBytes=bufferOwnership.filter(r=>r.owners.length).reduce((n,r)=>n+r.bytes,0),
    references=[...new Set(graph.rows.map(r=>r.array))],legacyIds=new Map([...arrays.keys()].map((a,i)=>[a,i+1]));
  inventory.geometryBindings=[];
  for(const v of inventory.views.filter(v=>v.roles.includes('geometry'))){const a=references[v.id-1];
    if(!sceneArrays.has(a))throw Error('geometry owner missing original scene view');
    inventory.geometryBindings.push({viewId:v.id,geometryArrayId:legacyIds.get(a),nativeReservationIds:nativeGeometry.get(a).map(r=>r.id)});}
  const cpuArrays=[...arrays].map(([a,labels],i)=>({id:i+1,arrayType:arrayType(a),bytes:byteLength(a),owners:[...labels]}));
  return {allocation,declaredArrayBytes,retainedTerrainArrayBytes:declaredArrayBytes-sceneArrayBytes,textureObjects:textures.size,glError:null,
    retainedBufferInventory:inventory,retainedBackingBytes:inventory.retainedBackingBytes,cpuArrays,
    geometryArrayIds:[...sceneArrays].map(a=>legacyIds.get(a)),bufferOwnership,mappedBufferBytes,
    unmappedBufferBytes:allocation.byKind.buffer-mappedBufferBytes,unuploadedArrays:unuploaded,conservativeReservation:null,
    gpuReservation:allocation.gpuPeak,cpuDeclaredArrayBytes:declaredArrayBytes,
    accounting:'GPU: synchronized API reservations, pending deletes and same-time default surfaces. Explicit retained application backing storage separate; driver, private heap and transient memory unmeasured.',
    atlasPages:Object.fromEntries(entries(atlases).map(([side,a])=>[side,Object.fromEntries(entries(own(a,'textures')).map(([tier,t])=>[tier,sequence(t,64).length]))])),
    lens:!!own(post,'soldierView',true),viewport:[own(scope,'innerWidth'),own(scope,'innerHeight')],dpr:own(scope,'devicePixelRatio')};
}

function sampleLegacySceneAllocations(scope=globalThis.window,{retainedContext=null}={}) {
  const {scene,post,game}=scope.__game,arrays=new Map(),textures=new Set();let declaredArrayBytes=0;
  const owners=new Map();for(const key of ['pools','fallen','impostors'])for(const [side,pool]of Object.entries(game[key]||{}))owners.set(pool.mesh,`${key}.${side}`);
  const array=(a,owner)=>{if(a){if(!arrays.has(a)){arrays.set(a,new Set());declaredArrayBytes+=a.byteLength;}arrays.get(a).add(owner);}};
  const attribute=(a,owner)=>array(a?.isInterleavedBufferAttribute?a.data.array:a?.array,owner);
  const texture=x=>{if(x?.isTexture)textures.add(x);else if(Array.isArray(x))x.forEach(texture);};
  for(const root of [scene,post.qScene].filter(Boolean))root.traverse(o=>{
    let ancestor=o,owner;while(ancestor&&!owner){owner=owners.get(ancestor);ancestor=ancestor.parent;}owner=`${owner||'scene'}/${o.name||o.type}${o.visible?'':'(hidden)'}`;
    const g=o.geometry;if(g){Object.values(g.attributes).forEach(a=>attribute(a,owner));attribute(g.index,owner);Object.values(g.morphAttributes||{}).flat().forEach(a=>attribute(a,owner));}
    attribute(o.instanceMatrix,owner);attribute(o.instanceColor,owner);
    for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){
      Object.values(m).forEach(texture);Object.values(m.uniforms||{}).forEach(u=>texture(u.value));
    }
  });
  for(const atlas of Object.values(game.baked?.atlases||{}))for(const pages of Object.values(atlas.textures))pages.forEach(texture);
  const sceneArrayBytes=declaredArrayBytes;
  for(const retained of scope.__sceneTerrainPartition?.retainedArrays||[]){
    if(!ArrayBuffer.isView(retained?.array)||typeof retained.owner!=='string'||!retained.owner)throw Error('allocation: invalid retained terrain array');
    array(retained.array,retained.owner);
  }
  const renderer=post.renderer,gl=retainedContext??renderer.getContext(),unuploaded=[];
  if(retainedContext!==null){scope.__allocation.assertOwned(gl);
    if(scope.__allocation.peek(gl)?.observed!==true)throw Error('allocation: registered retained context required');}
  for(const [array,labels]of arrays){
    const records=scope.__allocation.labelBufferOwners(gl,array,[...labels]);
    if(!records.length)unuploaded.push({bytes:array.byteLength,owners:[...labels]});
  }
  const allocation=retainedContext===null?scope.__allocation.snapshot(gl):scope.__allocation.peek(gl),bufferOwnership=allocation.bufferSlots;
  if(retainedContext!==null&&allocation.observed!==true)throw Error('allocation: registered retained context required');
  const mappedBufferBytes=bufferOwnership.filter(r=>r.owners.length).reduce((n,r)=>n+r.bytes,0);
  return {allocation,declaredArrayBytes,retainedTerrainArrayBytes:declaredArrayBytes-sceneArrayBytes,textureObjects:textures.size,glError:retainedContext===null?gl.getError():null,
    ...(retainedContext===null?{}:{cpuArrays:[...arrays].map(([a,labels],i)=>({id:i+1,arrayType:a.constructor.name,bytes:a.byteLength,owners:[...labels]}))}),
    bufferOwnership,mappedBufferBytes,unmappedBufferBytes:allocation.byKind.buffer-mappedBufferBytes,unuploadedArrays:unuploaded,
    conservativeReservation:retainedContext===null?allocation.peak+allocation.defaultPeak+declaredArrayBytes:null,
    gpuReservation:allocation.gpuPeak,cpuDeclaredArrayBytes:declaredArrayBytes,
    accounting:'GPU: synchronized API reservations, pending deletes and same-time default surfaces. CPU arrays separate; conservative upper adds independent maxima. Native driver memory unmeasured.',
    atlasPages:Object.fromEntries(Object.entries(game.baked?.atlases||{}).map(([side,a])=>[side,Object.fromEntries(Object.entries(a.textures).map(([tier,t])=>[tier,t.length]))])),
    lens:!!post.soldierView,viewport:[scope.innerWidth,scope.innerHeight],dpr:scope.devicePixelRatio};
}

/** Explicit caller-side preparation, kept out of failure/overlap observation. */
export function initializeSceneTextures(scope=globalThis.window) {
  const {scene,post,game}=scope.__game,textures=new Set();
  const texture=x=>{if(x?.isTexture)textures.add(x);else if(Array.isArray(x))x.forEach(texture);};
  for(const root of [scene,post.qScene].filter(Boolean))root.traverse(o=>{
    for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){
      Object.values(m).forEach(texture);Object.values(m.uniforms||{}).forEach(u=>texture(u.value));
    }
  });
  for(const atlas of Object.values(game.baked?.atlases||{}))for(const pages of Object.values(atlas.textures))pages.forEach(texture);
  for(const t of textures)if(!t.isRenderTargetTexture&&!t.isDepthTexture)post.renderer.initTexture(t);
}

/** Pure diagnostic verdict. Failure observations contribute to the same lifetime maximum. */
export const SCENE_ROUTES=Object.freeze(['capable','unsupported']);
export const SCENE_FAULTS=Object.freeze([
  ...['malformed-candidate','candidate-http','native-upload','first-pool-prepare','rejection-delayed-astc','rejection-delayed-png','candidate-then-baseline-terminal'].map(fault=>Object.freeze({route:'capable',fault})),
  Object.freeze({route:'unsupported',fault:'baseline-terminal'}),
]);
export function sceneMatrixContract(phases){
  if(!Array.isArray(phases)||phases.length!==11||phases.some(p=>!p||typeof p.packId!=='string'||!p.packId||typeof p.phaseId!=='string'||!p.phaseId)
    ||new Set(phases.map(p=>`${p.packId}/${p.phaseId}`)).size!==11)throw Error('scene matrix: eleven unique authored phases required');
  return {cases:phases.flatMap(p=>SCENE_ROUTES.map(route=>({packId:p.packId,phaseId:p.phaseId,route}))),
    faults:phases.flatMap(p=>SCENE_FAULTS.map(f=>({packId:p.packId,phaseId:p.phaseId,...f})))};
}

const sceneHistories=new WeakMap();
export function sceneReportEnvelope(report){
  const json=JSON.stringify(report),bytes=new TextEncoder().encode(json).byteLength;
  return {json,bytes,withinLimit:bytes<90000000,limit:90000000};
}
/** Lossless per-context transport in the existing report; no samples or scalar peaks are removed. */
export function createSceneHistory(){
  const history={signatures:[],nativeEvents:[],slotRevisions:[]};
  sceneHistories.set(history,{prefixes:['[]','[]','[]'],slots:new Map(),sequence:-1});return history;
}
export function compactSceneSample(history,input){
  const owner=sceneHistories.get(history),keys=['signatures','nativeEvents','slotRevisions'];
  if(!owner||keys.some((k,i)=>JSON.stringify(history[k])!==owner.prefixes[i]))throw Error('scene history: altered owned prefix');
  const sample=structuredClone(input),a=sample?.allocation;
  if(!Number.isSafeInteger(sample?.sequence)||sample.sequence<=owner.sequence||!a||a.history!==undefined)throw Error('scene history: sample sequence/shape');
  for(const key of ['signatures','nativeEvents']){
    const records=a[key];if(!Array.isArray(records)||records.length<history[key].length
      ||history[key].some((r,i)=>JSON.stringify(r)!==JSON.stringify(records[i])))throw Error('scene history: altered observation prefix');
  }
  const next=new Map();
  for(const[kind,key,idKey]of [['buffer','bufferSlots','id'],['texture','textureSlots','texture'],['renderbuffer','renderbufferSlots','id']]){
    if(!Array.isArray(a[key]))throw Error('scene history: complete native slots required');
    for(const record of a[key]){
      const id=record?.[idKey],key=kind+'/'+id;
      if(!Number.isSafeInteger(id)||id<1||next.has(key))throw Error('scene history: duplicate/invalid native ID');
      next.set(key,{kind,id,record});
    }
  }
  const revisions=[];
  for(const[key,value]of owner.slots)if(!next.has(key))revisions.push({operation:'remove',kind:value.kind,id:value.id});
  for(const[key,value]of next)if(JSON.stringify(value)!==JSON.stringify(owner.slots.get(key)))revisions.push({operation:'upsert',...value});
  const bufferOwnership=Object.hasOwn(sample,'bufferOwnership');
  if(bufferOwnership&&JSON.stringify(sample.bufferOwnership)!==JSON.stringify(a.bufferSlots))throw Error('scene history: buffer ownership alias differs');
  // Mutate the admitted history only after all refusal checks; keep private copies of public records.
  for(const key of ['signatures','nativeEvents'])history[key].push(...structuredClone(a[key].slice(history[key].length)));
  history.slotRevisions.push(...structuredClone(revisions));owner.slots=structuredClone(next);owner.sequence=sample.sequence;
  owner.prefixes=keys.map(k=>JSON.stringify(history[k]));
  a.history={signaturesEnd:history.signatures.length,nativeEventsEnd:history.nativeEvents.length,slotsEnd:history.slotRevisions.length,bufferOwnership};
  for(const key of ['signatures','nativeEvents','bufferSlots','textureSlots','renderbufferSlots'])delete a[key];
  if(bufferOwnership)delete sample.bufferOwnership;return sample;
}
function sceneNativeReplay(events){
  const objects=new Map(),released=new Set(),nativeCalls=new Map();let cursor=0,current=0,peak=0,ordinal=0,finishes=0,fence=new Set();
  const safe=n=>Number.isSafeInteger(n)&&n>=0;
  const textureCalls=['texImage2D','texImage3D','compressedTexImage2D','compressedTexImage3D','texStorage2D','texStorage3D','generateMipmap'];
  const renderbufferBpp=new Map([[0x8229,1],[0x822b,2],[0x8051,4],[0x8058,4],[0x8c41,4],[0x8c43,4],[0x822d,2],[0x822f,4],[0x881b,8],[0x881a,8],[0x822e,4],[0x8230,8],[0x8815,16],[0x8814,16],[0x81a5,4],[0x81a6,4],[0x8cac,4],[0x88f0,4],[0x8cad,8],[0x8d48,1]]);
  return (end,a)=>{
    for(;cursor<end;cursor++){
      const e=events[cursor],key=e?.kind+'/'+e?.id;
      if(e?.sequence!==cursor+1||!safe(e?.callOrdinal)||!e.callOrdinal||e.callOrdinal<ordinal||typeof e.call!=='string'||!e.call)throw Error('scene history: native event chronology');
      if(nativeCalls.has(e.callOrdinal)&&nativeCalls.get(e.callOrdinal)!==e.call)throw Error('scene history: native call identity');
      nativeCalls.set(e.callOrdinal,e.call);
      ordinal=e.callOrdinal;
      if(e.operation==='finish'){
        if(e.kind!==null||e.id!==null||e.call!=='finish'||fence.size)throw Error('scene history: native finish fence');
        finishes++;fence=new Set([...objects].filter(([,r])=>r.pending).map(([key])=>key));
      }else{
        if(!['texture','buffer','renderbuffer'].includes(e.kind)||!Number.isSafeInteger(e.id)||e.id<1)throw Error('scene history: native identity');
        let r=objects.get(key);
        if(e.operation==='reserve'){
          if(!(e.kind==='buffer'?e.call==='bufferData':e.kind==='renderbuffer'?['renderbufferStorage','renderbufferStorageMultisample'].includes(e.call):textureCalls.includes(e.call)))throw Error('scene history: native allocation call');
          if(fence.size||released.has(key)||!safe(e.bytes)||!safe(e.previous)||typeof e.overlap!=='boolean'||!['string','number'].includes(typeof e.slot))throw Error('scene history: native reservation');
          if(!r){r={kind:e.kind,slots:new Map(),pending:false};objects.set(key,r);}
          const previous=r.slots.get(String(e.slot))||0,transient=current+e.bytes-(e.overlap?0:previous);
          if(e.previous!==previous||e.transient!==transient)throw Error('scene history: lost native replacement peak');
          if(e.kind==='renderbuffer'&&(!e.detail||!['format','width','height','samples'].every(k=>Number.isSafeInteger(e.detail[k])&&e.detail[k]>0)
            ||!renderbufferBpp.has(e.detail.format)||e.bytes!==e.detail.width*e.detail.height*e.detail.samples*renderbufferBpp.get(e.detail.format)
            ||(e.call==='renderbufferStorage'&&e.detail.samples!==1)))throw Error('scene history: renderbuffer geometry');
          peak=Math.max(peak,transient);current+=e.bytes-previous;r.slots.set(String(e.slot),e.bytes);
        }else if(e.operation==='retire'){
          if(e.call!==({texture:'deleteTexture',buffer:'deleteBuffer',renderbuffer:'deleteRenderbuffer'})[e.kind])throw Error('scene history: native deletion call');
          if(!r||fence.size)throw Error('scene history: missing native retirement');r.pending=true;
        }else if(e.operation==='release'){
          if(e.call!=='finish'||!r?.pending||!fence.delete(key))throw Error('scene history: unfenced native removal');
          current-=[...r.slots.values()].reduce((n,b)=>n+b,0);objects.delete(key);released.add(key);
        }else throw Error('scene history: native event operation');
      }
      if(e.current!==current||e.peak!==peak)throw Error('scene history: native event totals');
    }
    if(fence.size||a.bytes!==current||a.peak!==peak||(a.calls?.finish||0)!==finishes||ordinal>Object.values(a.calls||{}).reduce((n,c)=>n+c,0))throw Error('scene history: native sample totals');
    const signatures=new Map(),counts=new Map(),sampleOrdinal=Object.values(a.calls||{}).reduce((n,c)=>n+c,0),bases=new Map(),expected=new Map();let lastSignature=0;
    for(const s of a.signatures){
      if(!safe(s?.callOrdinal)||!s.callOrdinal||s.callOrdinal<=lastSignature||s.callOrdinal>sampleOrdinal||!textureCalls.includes(s.nativeCall)
        ||!Number.isSafeInteger(s.texture)||s.texture<1||nativeCalls.has(s.callOrdinal)&&nativeCalls.get(s.callOrdinal)!==s.nativeCall)throw Error('scene history: signature chronology');
      const r=s.raw,c=s.canonical,allocations=[],fail=()=>{throw Error('scene history: signature allocation payload');};
      if(!r||!c)fail();
      const compressed=f=>f===0x93b0||f===0x8e8c;
      const bpp=(format,type)=>renderbufferBpp.get(format)??([0x1908,0x1907].includes(format)?type===0x1406?16:type===0x140b?8:4:[0x1902,0x84f9].includes(format)?4:a.unknown?.includes(`format:${format},type:${type}`)?64:null);
      const bytes=(w,h,d,format,type,isCompressed)=>isCompressed?(compressed(format)?Math.ceil(w/4)*Math.ceil(h/4)*16*d:a.unknown?.includes(`compressed format:${format}`)?w*h*d*64:NaN):w*h*d*bpp(format,type);
      const add=(target,level,n,overlap=true)=>allocations.push({slot:`${target}:${level}`,bytes:n,overlap});
      if(s.nativeCall==='generateMipmap'){
        const base=bases.get(s.texture);if(s.call!=='generate mipmaps'||!base||JSON.stringify(c.base)!==JSON.stringify(base)
          ||!(r.target===base.target||r.target===0x8513&&base.target>=0x8515&&base.target<=0x851a))fail();
        if(!base.immutable){if(!base.bpp)fail();for(const target of r.target===0x8513?[0,1,2,3,4,5].map(i=>0x8515+i):[base.target])for(const[i,m]of mipSizes(base.w,base.h,base.bpp).entries())if(i)add(target,i,m.bytes*(base.target===0x806f?Math.max(1,base.d>>i):base.d),false);}
      }else if(s.nativeCall.startsWith('texStorage')){
        const levels=Math.trunc(r.levels),w=Math.trunc(r.w),h=Math.trunc(r.h),d=Math.trunc(r.d),isCompressed=compressed(r.format),n=isCompressed?null:bpp(r.format);
        if(s.call!=='immutable storage'||!Number.isSafeInteger(levels)||levels<1||levels>32||!n&&!isCompressed
          ||c.target!==r.target||c.levels!==levels||c.w!==w||c.h!==h||c.d!==d||c.bpp!==n||c.compressed!==isCompressed)fail();
        for(const[i,m]of mipSizes(w,h,n||1,levels).entries())add(r.target,i,(isCompressed?Math.ceil(m.w/4)*Math.ceil(m.h/4)*16:m.bytes)*(r.target===0x806f?Math.max(1,d>>i):d)*(r.target===0x8513?6:1));
        bases.set(s.texture,{target:r.target,w,h,d,bpp:n,compressed:isCompressed,immutable:true});
      }else{
        const isCompressed=s.nativeCall.startsWith('compressed'),n=bytes(r.w,r.h,r.d,r.format,r.type,isCompressed);
        if(s.call!==(isCompressed?'compressed image':'image')||!['w','h','d'].every(k=>Number.isSafeInteger(r[k])&&r[k]>0)||!safe(r.level)
          ||!Number.isSafeInteger(n)||c.bytes!==n||!['target','level','w','h','d'].every(k=>c[k]===r[k]))fail();
        add(r.target,r.level,n);if(r.level===0)bases.set(s.texture,{target:r.target,w:r.w,h:r.h,d:r.d,bpp:isCompressed?null:bpp(r.format,r.type),immutable:false});
      }
      if(allocations.some(e=>!safe(e.bytes)))fail();expected.set(s.callOrdinal,allocations);
      lastSignature=s.callOrdinal;signatures.set(s.callOrdinal,s);counts.set(s.nativeCall,(counts.get(s.nativeCall)||0)+1);
    }
    for(const name of textureCalls)if((counts.get(name)||0)!==(a.calls?.[name]||0))throw Error('scene history: missing texture signatures');
    const eventGroups=new Map();for(let i=0;i<end;i++){const e=events[i];let group=eventGroups.get(e.callOrdinal);if(!group){group=[];eventGroups.set(e.callOrdinal,group);}group.push(e);}
    for(const[ord,group]of eventGroups){const first=group[0];if(first.kind==='texture'&&first.operation==='reserve'){
      const s=signatures.get(ord),want=expected.get(ord);if(!s||!want||group.length!==want.length||group.some((e,i)=>e.operation!=='reserve'||e.kind!=='texture'||e.id!==s.texture||String(e.slot)!==want[i].slot||e.bytes!==want[i].bytes||e.overlap!==want[i].overlap))throw Error('scene history: native signature binding');
    }else if(first.call==='finish'){if(group[0].operation!=='finish'||group.slice(1).some(e=>e.operation!=='release'))throw Error('scene history: native finish call grammar');}
    else if(group.length!==1)throw Error('scene history: collapsed native call ordinal');}
    for(const[ord,want]of expected)if(want.length&&!eventGroups.has(ord))throw Error('scene history: missing signature reservation');
    const totals={texture:0,buffer:0,renderbuffer:0};let pending=0;
    for(const[key,r]of objects){const bytes=[...r.slots.values()].reduce((n,b)=>n+b,0);totals[r.kind]+=bytes;if(r.pending)pending+=bytes;
      const records=a[r.kind==='buffer'?'bufferSlots':r.kind==='texture'?'textureSlots':'renderbufferSlots'],id=Number(key.slice(key.indexOf('/')+1)),found=records.filter(s=>s?.[r.kind==='texture'?'texture':'id']===id);
      if(found.length!==1||found[0].pendingDelete!==r.pending||(r.kind==='texture'?JSON.stringify(found[0].slots)!==JSON.stringify(Object.fromEntries(r.slots)):found[0].bytes!==bytes))throw Error('scene history: missing native slot revision');
    }
    if(Object.keys(totals).some(k=>totals[k]!==a.byKind?.[k])||pending!==a.pendingDeleteBytes
      ||a.bufferSlots.length+a.textureSlots.length+a.renderbufferSlots.length!==objects.size)throw Error('scene history: native slot totals');
  };
}
/** Replay one context in observation order. Never expand the entire multi-context report at once. */
export function expandSceneContext(input){
  if(input?.history===undefined)return input;
  const h=input.history;
  if(!h||!['signatures','nativeEvents','slotRevisions'].every(k=>Array.isArray(h[k])))throw Error('scene history: history shape');
  const raw=[...(Array.isArray(input.states)?input.states:[]),...(Array.isArray(input.restoration?.samples)?input.restoration.samples:[]),
    ...(Array.isArray(input.stress?.transaction?.samples)?input.stress.transaction.samples.map(s=>s?.observation):[])];
  const ordered=raw.slice().sort((a,b)=>a?.sequence-b?.sequence),decoded=new Map(),slots=new Map(),cursor={signaturesEnd:0,nativeEventsEnd:0,slotsEnd:0};
  let sequence=-1;const replay=sceneNativeReplay(h.nativeEvents);
  for(const s of ordered){
    const a=s?.allocation,c=a?.history;
    if(!Number.isSafeInteger(s?.sequence)||s.sequence<=sequence||!c||typeof c.bufferOwnership!=='boolean'
      ||['signatures','nativeEvents','bufferSlots','textureSlots','renderbufferSlots'].some(k=>a[k]!==undefined))throw Error('scene history: mixed sample or sequence');
    for(const[key,records]of [['signaturesEnd',h.signatures],['nativeEventsEnd',h.nativeEvents],['slotsEnd',h.slotRevisions]]){
      if(!Number.isSafeInteger(c[key])||c[key]<cursor[key]||c[key]>records.length)throw Error('scene history: invalid/backward cursor');
    }
    for(let i=cursor.slotsEnd;i<c.slotsEnd;i++){
      const r=h.slotRevisions[i],key=r?.kind+'/'+r?.id;
      if(!['buffer','texture','renderbuffer'].includes(r?.kind)||!Number.isSafeInteger(r?.id)||r.id<1)throw Error('scene history: revision identity');
      if(r.operation==='remove'){if(!slots.delete(key))throw Error('scene history: missing removed reservation');}
      else if(r.operation==='upsert'){
        if(r.record?.[r.kind==='texture'?'texture':'id']!==r.id||JSON.stringify(slots.get(key))===JSON.stringify(r))throw Error('scene history: invalid/redundant revision');
        slots.set(key,structuredClone(r));
      }else throw Error('scene history: revision operation');
    }
    const allocation={...a,signatures:h.signatures.slice(0,c.signaturesEnd),nativeEvents:h.nativeEvents.slice(0,c.nativeEventsEnd),
      bufferSlots:[],textureSlots:[],renderbufferSlots:[]};delete allocation.history;
    for(const r of slots.values())allocation[r.kind==='buffer'?'bufferSlots':r.kind==='texture'?'textureSlots':'renderbufferSlots'].push(structuredClone(r.record));
    replay(c.nativeEventsEnd,allocation);
    const sample={...s,allocation};if(c.bufferOwnership)sample.bufferOwnership=allocation.bufferSlots;
    decoded.set(s,sample);Object.assign(cursor,c);sequence=s.sequence;
  }
  if(cursor.signaturesEnd!==h.signatures.length||cursor.nativeEventsEnd!==h.nativeEvents.length||cursor.slotsEnd!==h.slotRevisions.length)throw Error('scene history: unreferenced trailing evidence');
  return {...input,states:Array.isArray(input.states)?input.states.map(s=>decoded.get(s)):input.states,
    ...(input.restoration?{restoration:{...input.restoration,samples:Array.isArray(input.restoration.samples)?input.restoration.samples.map(s=>decoded.get(s)):input.restoration.samples}}:{}),
    ...(input.stress?{stress:{...input.stress,...(input.stress.transaction?{transaction:{...input.stress.transaction,samples:Array.isArray(input.stress.transaction.samples)?input.stress.transaction.samples.map(s=>({...s,observation:decoded.get(s.observation)})):input.stress.transaction.samples}}:{})}}:{})};
}
export function reduceSceneObservations(report, phases) {
  return reduceSceneScope(report,phases,11);
}
export function reduceFullFloat32SceneObservations(report,phases){
  return reduceSceneScope(report,phases,11,'float32-full');
}
export function sceneFullFloat32HeaderValid(report){
  return report?.sceneResourcePolicy==='float32-lifetime-v1'&&report.resourceFocus===undefined&&report.canonicalTerrainRepresentation===undefined
    &&report.float32TerrainRepresentation==='Float32 with retained exact original'&&report.postPixelBytes===3639218&&report.mipPolicy==='full-original'
    &&report.sceneRoutes==='qualified-both'&&report.nativeHistoryRequired===true&&report.fallbackCompletion==='native-finish-after-candidate-disposal';
}
export function sceneTerrainContractValid(c){
  const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),positive=n=>Number.isSafeInteger(n)&&n>0;
  const arrays=(rows,indexType)=>Array.isArray(rows)&&rows.length===3&&rows.map(r=>r?.key).join(',')==='position,uv,index'
    &&rows.every(r=>r.arrayType===(r.key==='index'?indexType:'Float32Array')&&r.itemSize===(r.key==='position'?3:r.key==='uv'?2:1)
      &&positive(r.count)&&r.bytes===r.count*r.itemSize*(r.arrayType==='Uint16Array'?2:4)&&hash(r.sha256))&&rows[0].count===rows[1].count;
  return !!c&&['henry-hill','shiloh','stones-river','chattanooga','lookout-mountain'].includes(c.terrain)&&hash(c.metadataSha256)&&hash(c.heightSha256)
    &&positive(c.sourceBytes)&&positive(c.partitionBytes)&&c.partitionBytes<=c.sourceBytes&&positive(c.triangles)&&arrays(c.sourceArrays,'Uint32Array')
    &&c.sourceArrays[2].count===c.triangles*3&&c.sourceArrays.reduce((n,a)=>n+a.bytes,0)===c.sourceBytes
    &&Array.isArray(c.chunks)&&c.chunks.length>0&&c.chunks.every(a=>arrays(a,'Uint16Array')&&a[0].count<=65535&&a[2].count%3===0)
    &&c.chunks.reduce((n,rows)=>n+rows.reduce((n,a)=>n+a.bytes,0),0)===c.partitionBytes&&c.chunks.reduce((n,a)=>n+a[2].count,0)===c.triangles*3;
}
export function scenePostAdmissionSnapshot(post,dimensions){
  const admission=post.resourceAdmission;
  if(admission&&!dimensions.has(admission))dimensions.set(admission,[post.width,post.height]);
  return {admission:admission?structuredClone(admission):null,logical:admission?[...dimensions.get(admission)]:[post.width,post.height]};
}
export function scenePostAdmissionValid(p){
  const a=p?.admission,positivePair=v=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isSafeInteger(n)&&n>0);
  if(!a||!positivePair(p.logical)||!positivePair(a.target)||!positivePair(a.canvas)||!positivePair(a.intermediate)
    ||!Number.isFinite(a.scale)||a.scale<=0||!Number.isFinite(a.requestedScale)||a.scale>a.requestedScale||a.pixelBytes!==3639218)return false;
  const [w,h]=p.logical,target=[Math.max(1,Math.round(w*a.scale)),Math.max(1,Math.round(h*a.scale))],canvas=[Math.floor(w*a.scale),Math.floor(h*a.scale)],
    R=target[0]*target[1],Q=Math.max(1,Math.floor(target[0]/4))*Math.max(1,Math.floor(target[1]/4)),D=canvas[0]*canvas[1],I=a.intermediate[0]*a.intermediate[1];
  return JSON.stringify(a.target)===JSON.stringify(target)&&JSON.stringify(a.canvas)===JSON.stringify(canvas)
    &&a.renderPixels===R&&a.quarterPixels===Q&&a.defaultPixels===D&&a.intermediatePixels===I&&a.lensBytes===16*R+16*Q+12*D&&a.resizeBytes===24*Math.max(D,I)
    &&[a.lensBytes,a.resizeBytes].every(n=>Number.isSafeInteger(n)&&n<=3639218);
}
/** A ten-context prerequisite can never stand in for the complete eleven-phase matrix. */
export function reduceFocusedLookoutObservations(report,phase){
  const result=reduceSceneScope(report,[phase],1,true);
  return {...result,focusedComplete:result.complete,complete:false,fullMatrixComplete:false,fieldable:false};
}
export function reduceFocusedFloat32LookoutObservations(report,phase){
  const result=reduceSceneScope(report,[phase],1,'float32');
  return {...result,focusedComplete:result.complete,complete:false,fullMatrixComplete:false,fieldable:false};
}
export function float32OriginalReceiptValid(p,{sourceBytes=12750024}={}){
  return p?.kind==='unchanged original Float32 terrain owners'&&Number.isSafeInteger(p.materialId)&&p.materialId>=0&&typeof p.materialUuid==='string'&&!!p.materialUuid
    &&typeof p.vertexShader==='string'&&!!p.vertexShader&&typeof p.fragmentShader==='string'&&!!p.fragmentShader
    &&Array.isArray(p.uniformKeys)&&p.uniformKeys.length>0&&new Set(p.uniformKeys).size===p.uniformKeys.length&&p.uniformKeys.every(k=>typeof k==='string')
    &&Array.isArray(p.textureUuids)&&p.textureUuids.every(k=>typeof k==='string'&&!!k)&&p.sourceBytes===sourceBytes
    &&['sourceBytesExact','uniformRecordsExact','uniformValuesExact','sourceLayoutExact','sourceBoundsExact','drawStateExact'].every(k=>p[k]===true)
    &&Array.isArray(p.children)&&p.children.every(c=>c?.materialId===p.materialId&&c.materialUuid===p.materialUuid&&c.originalMaterialShared===true);
}
/** Real backing-array reservations, not owner-prefix guesses, bind each native retirement. */
export function float32TerrainRetirementErrors(row,{terrainContract=null}={}){
  const errors=[],fail=s=>errors.push(s),r=row?.resource,states=Array.isArray(row?.states)?row.states:[],cycles=Array.isArray(r?.cycles)?r.cycles.filter(c=>c?.kind==='terrain'):[],receipts=r?.terrainRetirements;
  const sourceBytes=terrainContract?.sourceBytes??12750024,partitionBytes=terrainContract?.partitionBytes??9357582,chunks=terrainContract?.chunks?.length??5;
  if(!Array.isArray(receipts)||receipts.length!==cycles.length||cycles.length!==(row?.fault===undefined&&(!terrainContract||row.phaseId==='lookout-mountain')?4:2)||receipts.at(-1)?.operation!=='restore-partition')return ['Float32 retirement inventory'];
  let installs=0;
  for(const [i,c]of cycles.entries()){
    const t=receipts[i],ss=(Array.isArray(c.sampleIds)?c.sampleIds:[]).map(id=>states.find(s=>s?.captureId===id)),[before,pending,settled]=ss;
    if(!t||t.cycleIndex!==c.index||!['install-original','restore-partition'].includes(t.operation)||t.operation!==(i%2?'restore-partition':'install-original')
      ||!Number.isSafeInteger(t.nativeFrame)||t.nativeFrame<0||!Number.isSafeInteger(t.nativeRenders)||t.nativeRenders<0
      ||!float32OriginalReceiptValid(t.original,{sourceBytes})||t.original.children.length!==(t.operation==='install-original'?0:chunks)||!Array.isArray(t.arrays)||!t.arrays.length||ss.length!==3||ss.some(s=>!s)
      ||!(before?.sequence<pending?.sequence&&pending?.sequence<settled?.sequence)){fail('Float32 retirement source/capture chronology');continue;}
    if(t.operation==='install-original')installs++;
    const meshCount=t.operation==='install-original'?1:chunks,expectedBytes=t.operation==='install-original'?sourceBytes:partitionBytes,ids=new Map();
    if(t.arrays.length!==meshCount*3||t.arrays.reduce((n,a)=>n+(a?.bytes||0),0)!==expectedBytes)fail('Float32 complete retiring arrays');
    for(let mesh=0;mesh<meshCount;mesh++)for(const key of ['position','uv','index']){
      const a=t.arrays.filter(a=>a?.mesh===mesh&&a.key===key);
      if(a.length!==1){fail('Float32 omitted/duplicate source array');continue;}const x=a[0],stride=key==='position'?3:key==='uv'?2:1,bpp=key==='index'&&t.operation==='restore-partition'?2:4;
      if(terrainContract){const expected=(t.operation==='install-original'?terrainContract.sourceArrays:terrainContract.chunks[mesh])?.find(a=>a.key===key);
        if(!expected||['arrayType','itemSize','count','bytes'].some(k=>x[k]!==expected[k]))fail('Float32 trusted source array layout');}
      if(x.itemSize!==stride||!Number.isSafeInteger(x.count)||x.count<1||x.bytes!==x.count*stride*bpp||x.arrayType!==(key==='index'?(bpp===2?'Uint16Array':'Uint32Array'):'Float32Array')||!Array.isArray(x.reservations))fail('Float32 retiring array layout');
      for(const p of Array.isArray(x.reservations)?x.reservations:[]){if(!Number.isSafeInteger(p?.id)||p.id<1||p.bytes!==x.bytes||p.pendingDelete!==false||ids.has(p.id))fail('Float32 actual array reservation');ids.set(p?.id,p?.bytes);}
    }
    const zero=ids.size===0,firstUnrendered=i===0&&installs===1&&row?.fault!==undefined&&t.operation==='install-original'&&t.nativeFrame===0&&t.nativeRenders===0;
    if(zero&&!firstUnrendered||!zero&&t.arrays.some(a=>!a?.reservations?.length))fail('Float32 missing native backing-array IDs');
    const slots=s=>Array.isArray(s?.allocation?.bufferSlots)?s.allocation.bufferSlots:[];
    for(const [id,bytes]of ids){if(!slots(before).some(p=>p.id===id&&p.bytes===bytes&&p.pendingDelete===false)||!slots(pending).some(p=>p.id===id&&p.bytes===bytes&&p.pendingDelete===true)||slots(settled).some(p=>p.id===id))fail('Float32 native IDs not retired before replacement');}
    const ev=s=>Array.isArray(s?.allocation?.nativeEvents)?s.allocation.nativeEvents:[],retired=ev(pending).slice(ev(before).length),completed=ev(settled).slice(ev(pending).length);
    if(retired.some(e=>e.operation==='finish')||completed.filter(e=>e.operation==='finish').length!==1||[...retired,...completed].some(e=>e.kind==='buffer'&&e.operation==='reserve'))fail('Float32 finish before replacement upload');
    if(zero&&(slots(before).some(b=>!Array.isArray(b?.owners)||b.owners.some(o=>typeof o==='string'&&(/(^scene\/terrain\b)|(^terrain-retained-source\/)/.test(o))))
      ||[...retired,...completed].some(e=>e.kind==='buffer'&&['retire','release'].includes(e.operation))))fail('Float32 zero-ID source contradicts actual native inventory');
    for(const [id]of ids)if(retired.filter(e=>e.kind==='buffer'&&e.id===id&&e.operation==='retire').length!==1||completed.filter(e=>e.kind==='buffer'&&e.id===id&&e.operation==='release').length!==1)fail('Float32 native retire/release journal');
  }
  return errors;
}
/** Source-specific resource prerequisite, called on a fully replayed native context. */
export function focusedSceneResourceErrors(row,{float32=false,phase=null}={}){
  const errors=[],fail=s=>errors.push(s),r=row?.resource,states=Array.isArray(row?.states)?row.states:[],boot=row?.bootstrap;
  const contract=phase?.terrainContract,sourceBytes=contract?.sourceBytes??12750024,partitionBytes=contract?.partitionBytes??9357582,chunks=contract?.chunks?.length??5,triangles=contract?.triangles??578907;
  if(phase&&(!sceneTerrainContractValid(contract)||r?.terrainContractSourceExact!==true||r?.terrainContractProofReleased!==true
    ||JSON.stringify(r?.terrainContract)!==JSON.stringify(contract)))fail('trusted phase terrain source contract');
  if(phase){
    const installs=Array.isArray(r?.terrainRetirements)?r.terrainRetirements.filter(t=>t.operation==='install-original'):[],published=r?.terrainPublications;
    if(!Array.isArray(published)||published.length!==installs.length||!installs.length||published.some((p,i)=>p?.cycleIndex!==installs[i].cycleIndex
      ||JSON.stringify(p?.chunks)!==JSON.stringify(contract?.chunks)))fail('actual published terrain chunk hashes');
  }
  if(r?.ok!==true||r.exactOriginal!==true||r.bootstrapDraws!==0||r.pixelBytes!==3639218||r.preparedReleased!==true
    ||r.terrain?.kind!==(float32?'Float32 with retained exact original':'canonical with retained exact original')||r.terrain.bytes!==(float32?partitionBytes:5827098)||r.terrain.sourceBytes!==sourceBytes)fail('canonical native owner/restoration');
  if(float32){if(!float32OriginalReceiptValid(r?.originalProof,{sourceBytes})||r.originalProof.children.length!==0||r.originalProofReleased!==true)fail('Float32 exact original source proof');
    if(r?.terrain?.triangles!==triangles||r.terrain.chunks!==chunks||r.terrain.materialShared!==true||row?.partition?.kind!=='Float32 with retained exact original'
      ||row.partition.triangles!==triangles||row.partition.chunks!==chunks||row.partition.materialShared!==true||row.partition.bytes!==partitionBytes||row.partition.sourceBytes!==sourceBytes)fail('Float32 actual partition publication');
    for(const s of states.filter(s=>s?.float32Original)){if(!float32OriginalReceiptValid(s.float32Original,{sourceBytes})||JSON.stringify({...s.float32Original,children:[]})!==JSON.stringify({...r.originalProof,children:[]}))fail('Float32 unchanged original material/source');}
    errors.push(...float32TerrainRetirementErrors(row,{terrainContract:contract??null}));}
  if(!Array.isArray(boot)||boot.length!==1||boot[0]?.method!=='GET'||boot[0].removedEntryModules!==1
    ||![boot[0]?.originalSha256,boot[0]?.servedSha256].every(s=>/^[a-f0-9]{64}$/.test(s||''))||boot[0]?.originalSha256===boot[0]?.servedSha256)fail('original document bootstrap');
  try{const u=new URL(boot?.[0]?.url);if(u.searchParams.get('battle')!==(phase?.packId??'chattanooga')||u.searchParams.get('phase')!==(phase?.phaseId??'lookout-mountain')
    ||u.searchParams.get('quality')!=='high'||u.searchParams.get('figures')!=='rigged'||!u.searchParams.has('nosw'))fail('bootstrap field route');}catch{fail('bootstrap URL');}
  const textures=new Set(),renderbuffers=new Set();
  for(const [kind,records,ids]of [['texture',r?.postTextures,textures],['renderbuffer',r?.postRenderbuffers,renderbuffers]]){
    if(!Array.isArray(records)||!records.length){fail('actual Post '+kind+' bindings');continue;}
    for(const p of records){if(!Number.isSafeInteger(p?.id)||p.id<1||ids.has(p.id)||!['rtScene','rtSmall','rtBlur'].includes(p.key)
      ||!Number.isSafeInteger(p.bytes)||p.bytes<1||typeof p.pendingDelete!=='boolean'||kind==='texture'&&(!['color','depth'].includes(p.kind)||typeof p.uuid!=='string'||!p.uuid))fail('Post pointer ownership');ids.add(p?.id);}
  }
  const array=(value,label)=>{if(value===undefined)return [];if(!Array.isArray(value)){fail(label+' container');return [];}return value;};
  const all=[...states,...array(row?.restoration?.samples,'restoration'),...array(row?.stress?.transaction?.samples,'stress').map(s=>s?.observation)];
  if(all.some(s=>!s||!Number.isSafeInteger(s.sequence)))fail('native observation sequence');
  const ordered=all.filter(s=>s&&Number.isSafeInteger(s.sequence)).sort((a,b)=>a.sequence-b.sequence),last=ordered.at(-1);
  if(phase&&sceneTerrainContractValid(contract)){
    const owned=states.filter(s=>s?.label?.endsWith('terrain-contract-proof-owned')),released=states.filter(s=>s?.label?.endsWith('terrain-contract-proof-released')),
      proofBytes=contract.partitionBytes+contract.chunks.reduce((n,a)=>n+a[0].count*4,0);
    if(owned.length!==1||released.length!==1||owned[0].sequence>=released[0].sequence
      ||owned[0].declaredArrayBytes-released[0].declaredArrayBytes!==proofBytes)fail('complete declared terrain contract proof lifetime');
  }
  const signatures=array(last?.allocation?.signatures,'signatures'),events=array(last?.allocation?.nativeEvents,'native events');
  for(const id of textures)if(!signatures.some(s=>s?.texture===id))fail('unbound Post texture');
  for(const id of renderbuffers)if(!events.some(e=>e?.kind==='renderbuffer'&&e.id===id&&e.operation==='reserve'&&e.detail?.samples===1&&[33189,33190,36012].includes(e.detail.format)))fail('unbound Post depth buffer');
  for(const s of ordered){const a=s?.allocation;if(!a||!Number.isSafeInteger(a.gpuPeak)||a.gpuPeak>250000000||a.unknown?.length||s.unmappedBufferBytes!==0||s.glError!==0)fail('complete native GPU envelope');
    if(s?.focusedPixel&&a){const p=s.focusedPixel,ad=p.admission;
      if(!Array.isArray(p.canvas)||p.canvas.length!==2||p.canvas.some(n=>!Number.isSafeInteger(n)||n<1)||JSON.stringify(p.canvas)!==JSON.stringify(a?.dimensions))fail('actual positive Post canvas');
      if(ad&&(!Number.isSafeInteger(ad.lensBytes)||!Number.isSafeInteger(ad.resizeBytes)||ad.pixelBytes!==3639218||ad.lensBytes>3639218||ad.resizeBytes>3639218||ad.scale<=0))fail('rounded Post source envelope');
      if(phase&&ad&&!scenePostAdmissionValid(p))fail('independent rounded Post arithmetic');
      let pixel=a.gpuCurrent-a.bytes;
      for(const t of array(a.textureSlots,'texture slots'))if(textures.has(t?.texture)){
        if(!t.slots||typeof t.slots!=='object'||Array.isArray(t.slots))fail('texture slots shape');else pixel+=Object.values(t.slots).reduce((n,b)=>n+b,0);}
      for(const b of array(a.renderbufferSlots,'renderbuffer slots'))if(renderbuffers.has(b?.id))pixel+=b.bytes;
      if(!Number.isSafeInteger(pixel)||pixel>3639218)fail('native Post attachment/default envelope');
    }
  }
  for(const s of signatures){const raw=s?.raw;if(raw&&(raw.type===5131||[6402,34041].includes(raw.format))&&!textures.has(s.texture))fail('unowned variable texture');}
  for(const e of events)if(e?.kind==='renderbuffer'&&!renderbuffers.has(e.id))fail('unowned renderbuffer');
  const cycles=r?.cycles;
  if(!Array.isArray(cycles)||!cycles.some(c=>c?.kind==='resize')||!cycles.some(c=>c?.kind==='terrain'))fail('complete native lifetime cycles');
  for(const [i,input]of (Array.isArray(cycles)?cycles:[]).entries()){const c=input||{};
    if(c.index!==i+1||c.complete!==true||!Array.isArray(c.errors)||c.errors.length||!Array.isArray(c.checks)||!c.checks.length||c.checks.some(x=>x?.lost!==false||x?.error!==0)
      ||!Array.isArray(c.sampleIds)||!c.sampleIds.length||c.sampleIds.some(id=>!states.some(s=>s?.captureId===id)))fail('checked native retirement cycle');
    if(c.kind==='terrain'&&!float32){const samples=(Array.isArray(c.sampleIds)?c.sampleIds:[]).map(id=>states.find(s=>s?.captureId===id));if(samples.length!==3)fail('terrain retirement chronology');
      const owned=array(samples[0]?.allocation?.bufferSlots,'terrain buffers').filter(b=>Array.isArray(b?.owners)&&b.owners.some(o=>typeof o==='string'&&o.startsWith('terrain-canonical-'))).map(b=>b.id);
      if(!owned.length||owned.some(id=>!array(samples[1]?.allocation?.bufferSlots,'pending terrain buffers').some(b=>b?.id===id&&b.pendingDelete)||array(samples[2]?.allocation?.bufferSlots,'settled terrain buffers').some(b=>b?.id===id)))fail('canonical buffers retired before original upload');}
  }
  return errors;
}
/** Exact semantic header shared by bounded parts. Source/run and native-history admission belong here too. */
export function scenePartHeader(report){
  return Object.fromEntries(['diagnosticOnly','fieldable','toolSha','run','route','sceneRoutes','fallbackCompletion','normalMotion','nativeHistoryRequired',
    'inactivePrototype','terrainPartitionPrototype','terrainRestorationObserved','limits','qualification','nativeDriverMemory','cpuDecodePeak','unverified',
    'resourceFocus','sceneResourcePolicy','canonicalTerrainRepresentation','float32TerrainRepresentation','postPixelBytes','mipPolicy']
    .filter(k=>Object.hasOwn(report||{},k)).map(k=>[k,structuredClone(report[k])]));
}
/** Consume eleven bounded phase parts; never reconstruct the aggregate JSON or retain previous rows. */
export function createSceneMatrixMerger(phases,header){
  const matrix=sceneMatrixContract(phases),expected=phases.map(p=>p.packId+'/'+p.phaseId),common=scenePartHeader(header),errors=[],parts=[],contexts=new Set(),tuples=new Set();
  let maxReservation=null,maxGpuReservation=null,closed=false;
  const fullFloat32=common.sceneResourcePolicy!==undefined;
  if(common.sceneRoutes!=='qualified-both'||common.resourceFocus!==undefined||(fullFloat32?!sceneFullFloat32HeaderValid(common):common.float32TerrainRepresentation!==undefined))throw Error('scene parts: full qualified header required');
  if(fullFloat32&&phases.some(p=>!sceneTerrainContractValid(p.terrainContract)||p.terrainContract.terrain!==(p.scenario?.terrain??'henry-hill')))throw Error('scene parts: trusted phase terrain contracts required');
  const rowKey=(r,fault)=>r?.packId+'/'+r?.phaseId+'/'+r?.route+'/'+(fault?r?.fault:'ordinary');
  const required=new Set([...matrix.cases.map(r=>rowKey(r,false)),...matrix.faults.map(r=>rowKey(r,true))]);
  const mergePeak=(value,current)=>Number.isSafeInteger(value)&&value>=0?current===null?value:Math.max(value,current):current;
  const snapshot=()=>({complete:!errors.length&&parts.length===11&&contexts.size===110&&tuples.size===110,
    errors:errors.slice(),parts:structuredClone(parts),maxReservation,maxGpuReservation,
    withinLimit:!errors.length&&parts.length===11&&contexts.size===110&&tuples.size===110&&maxGpuReservation!==null&&maxGpuReservation<=250000000});
  return {add(part){
    if(closed)throw Error('scene parts: finalized owner');
    const at=parts.length,phase=phases[at],key=expected[at],localErrors=[];
    const fail=message=>localErrors.push(message);let result;
    // Readable maxima survive even a duplicate, foreign, failed or mixed-header part.
    try{result=reduceSceneScope(part,phase?[phase]:[],1,fullFloat32?'float32-full':false);}catch(error){result={complete:false,errors:[String(error?.message??error)],maxReservation:null,maxGpuReservation:null};}
    maxReservation=mergePeak(result.maxReservation,maxReservation);maxGpuReservation=mergePeak(result.maxGpuReservation,maxGpuReservation);
    if(JSON.stringify(scenePartHeader(part))!==JSON.stringify(common))fail('mixed semantic/source header');
    if(!phase||part?.phaseKey!==key||part?.complete!==true)fail('ordered complete phase part');
    for(const [kind,fault]of [['cases',false],['faults',true]])for(const row of Array.isArray(part?.[kind])?part[kind]:[]){
      const tuple=rowKey(row,fault);if(!required.has(tuple)||tuples.has(tuple))fail('foreign/duplicate tuple '+tuple);tuples.add(tuple);
      if(typeof row?.contextId!=='string'||!row.contextId||contexts.has(row.contextId))fail('foreign/duplicate context '+row?.contextId);contexts.add(row?.contextId);
    }
    if(!result.complete)localErrors.push(...result.errors.map(e=>'local: '+e));
    const summary={phaseKey:part?.phaseKey??null,partComplete:localErrors.length===0,ordinary:Array.isArray(part?.cases)?part.cases.length:0,
      faults:Array.isArray(part?.faults)?part.faults.length:0,maxReservation:result.maxReservation,maxGpuReservation:result.maxGpuReservation,errors:localErrors};
    parts.push(summary);errors.push(...localErrors.map(e=>(key||'extra part')+': '+e));return structuredClone(summary);
  },snapshot,finalize(){
    if(closed)throw Error('scene parts: finalized owner');closed=true;
    if(parts.length!==11||contexts.size!==110||tuples.size!==110||[...required].some(k=>!tuples.has(k)))errors.push('missing complete 22 ordinary + 88 fault union');
    return snapshot();
  }};
}
// Private phase scope is reachable only through the exhaustive matrix merger below.
/** Finite causal evidence only: an unproved restored baseline stops the next variant. */
export async function failPaintedComparison(row,collect){
  const primary=Error('focused scene: original/compact/restored whole painted frames differ');
  try{await collect();}catch(error){row.paintedIsolationFailure=String(error?.message??error);}
  throw primary;
}

export async function collectPaintedIsolation({rows,install,capture,restore,verifyRestored,save}){
  if(!Array.isArray(rows)||rows.length||[install,capture,restore,verifyRestored,save].some(f=>typeof f!=='function'))throw Error('painted isolation: fresh evidence and owned callbacks required');
  for(const variant of ['clone','float32-partition']){
    const row={variant,complete:false,ownersRestored:false,restored:false};rows.push(row);await save();
    try{row.install=await install(variant);await capture(variant);row.complete=true;}
    catch(error){row.failure=String(error?.message??error);}
    finally{
      try{row.ownersRestored=await restore(variant);if(row.ownersRestored!==true)throw Error('painted isolation: original owners not restored');
        if(await verifyRestored(variant)!==true)throw Error('painted isolation: restored triplet not proved');row.restored=true;
      }catch(error){row.restorationFailure=String(error?.message??error);}
      await save();
    }
    if(!row.complete||!row.restored)break;
  }
  return rows;
}

function reduceSceneScope(report, phases, requiredPhases,canonicalPolicy=false) {
  const fullFloat32=canonicalPolicy==='float32-full',float32Policy=fullFloat32||canonicalPolicy==='float32',prefix=float32Policy?'float32':'canonical',partitionKind=float32Policy?'partition':'compact';
  const errors=[], expected=(Array.isArray(phases)?phases:[]).map(p=>`${p?.packId}/${p?.phaseId}`), seen=new Set(), samples=[];
  const fail=message=>errors.push(message);
  const keep=s=>samples.push({gpuReservation:s?.gpuReservation,conservativeReservation:s?.conservativeReservation});
  if(!report||typeof report!=='object'||Array.isArray(report)){fail('report shape');report={};}
  // Retain scalar peaks even when a malformed mode or mixed schema rejects the report.
  for(const row of [...(Array.isArray(report.cases)?report.cases:[]),...(Array.isArray(report.faults)?report.faults:[]),report.failure]){
    if(row?.gpuReservation!==undefined||row?.conservativeReservation!==undefined)keep(row);
    for(const s of Array.isArray(row?.states)?row.states:[])keep(s);
    for(const s of Array.isArray(row?.restoration?.samples)?row.restoration.samples:[])keep(s);
    for(const s of Array.isArray(row?.stress?.transaction?.samples)?row.stress.transaction.samples:[])keep(s?.observation);
    for(const s of Array.isArray(row?.preload?.transaction?.samples)?row.preload.transaction.samples:[])keep(s?.observation);
  }
  if(report.sceneRoutes!==undefined&&!['current-png','qualified-both'].includes(report.sceneRoutes))fail('unknown scene route mode');
  if(fullFloat32){if(!sceneFullFloat32HeaderValid(report)||!Array.isArray(phases)||phases.some(p=>!sceneTerrainContractValid(p?.terrainContract)||p.terrainContract.terrain!==(p.scenario?.terrain??'henry-hill')))fail('full Float32 phase/resource contract');
  }else if(canonicalPolicy){if(report.sceneResourcePolicy!==undefined||expected.length!==1||expected[0]!=='chattanooga/lookout-mountain'||report.resourceFocus!==`${prefix}-lookout`
    ||(float32Policy?report.float32TerrainRepresentation!=='Float32 with retained exact original'||report.canonicalTerrainRepresentation!==undefined:report.canonicalTerrainRepresentation!=='canonical with retained exact original'||report.float32TerrainRepresentation!==undefined)||report.postPixelBytes!==3639218||report.mipPolicy!=='full-original'
    ||report.nativeHistoryRequired!==true||report.fallbackCompletion!=='native-finish-after-candidate-disposal')fail('focused canonical Lookout contract');
  }else if(report.sceneResourcePolicy!==undefined||report.resourceFocus!==undefined||report.canonicalTerrainRepresentation!==undefined||report.float32TerrainRepresentation!==undefined||report.postPixelBytes!==undefined||report.mipPolicy!==undefined)fail('focused evidence cannot qualify full matrix');
  if(report.fallbackCompletion!==undefined&&(report.sceneRoutes!=='qualified-both'||report.fallbackCompletion!=='native-finish-after-candidate-disposal'))fail('unknown fallback completion contract');
  if(report.sceneRoutes!=='qualified-both'&&(report.qualification!==undefined||report.faults!==undefined))fail('qualified evidence requires explicit qualified mode');
  if(new Set(expected).size!==expected.length||expected.length!==requiredPhases)fail('phase contract');
  const sample=(s,label)=>{
    keep(s);
    if(!Number.isSafeInteger(s?.gpuReservation)||s.gpuReservation<0
      ||!Number.isSafeInteger(s?.conservativeReservation)||s.conservativeReservation<s.gpuReservation)fail(`${label}: finite bytes`);
    if(s?.glError!==0||!Array.isArray(s?.allocation?.unknown)||s.allocation.unknown.length)fail(`${label}: unknown/GL`);
    if(s?.unmappedBufferBytes!==0)fail(`${label}: unmapped buffers`);
  };
  const restored=(restoration,label)=>{
    if(restoration?.samples!==undefined&&!Array.isArray(restoration.samples))fail(`${label}: restoration samples shape`);
    for(const s of Array.isArray(restoration?.samples)?restoration.samples:[])sample(s,`${label}/restoration`);
  };
  const verdict=()=>{
    const gpu=samples.map(s=>s?.gpuReservation).filter(n=>Number.isSafeInteger(n)&&n>=0),conservative=samples.map(s=>s?.conservativeReservation).filter(n=>Number.isSafeInteger(n)&&n>=0);
    const maxGpuReservation=gpu.length?Math.max(...gpu):null;
    const maxReservation=conservative.length?Math.max(...conservative):null;
    const complete=errors.length===0;
    return {complete,errors,maxReservation,maxGpuReservation,withinLimit:complete&&maxGpuReservation<=250000000};
  };
  if(report.sceneRoutes==='qualified-both'){
    const contexts=new Set(),ordinary=new Map(),faultSeen=new Set(),safe=n=>Number.isSafeInteger(n)&&n>=0;
    const array=(value,label)=>{if(!Array.isArray(value)){fail(label+': array shape');return [];}return value;};
    const key=row=>`${row?.packId}/${row?.phaseId}/${row?.route}`;
    const candidateNames=Array.from({length:2},(_,look)=>Array.from({length:5},(_,i)=>`cs-close-${look?'h2_slouch_roll_butternut':'base'}-${i}-${i===4?'original.png':'astc.ktx2'}`)).flat();
    const q=report.qualification;
    if(report.diagnosticOnly!==true||report.fieldable!==false||report.normalMotion!==true||report.limits?.gpuBytes!==250000000
      ||report.inactivePrototype!==true||report.terrainPartitionPrototype!==(canonicalPolicy&&!float32Policy?false:true)||report.terrainRestorationObserved!==true||report.failure!==undefined)fail('qualified report contract');
    if(q?.run!==38282452947||q.sha!=='9d60c12cfddadac7c74e7126b33ba568071c2066'||q.closeGpuBytes!==48996984
      ||q.optimized?.id!==11762770795||q.optimized.name!=='cs-close-qualified-hybrid'||q.optimized.size!==41324044
      ||q.optimized.digest!=='278f619d48f77a22ce9be20ea3f0461e0e5e933960fa14953a02a9664194b60b'
      ||q.review?.id!==11762905334||q.review.name!=='cs-close-qualification-review'||q.review.size!==79493756
      ||q.review.digest!=='b9b761a24435489cfe272c90cbe04b60f7b9eb62c8ffec5f1b0f1ae37454452b')fail('qualified acquisition identity');
    const memberNames=[...candidateNames,'soldier-hybrid.json','soldier-source.json','compression.json','quality.json'],members=array(q?.members,'qualification members');
    if(members.length!==14||new Set(members.map(m=>m?.name)).size!==14||memberNames.some(n=>!members.some(m=>m?.name===n))
      ||members.some(m=>!safe(m?.bytes)||!m.bytes||!/^\w{64}$/.test(m?.sha256||'')||!/^[a-f0-9]{64}$/.test(m.sha256)))fail('qualified selected member bindings');
    const nativeSample=(s,label)=>{
      sample(s,label);const a=s?.allocation;
      if(!safe(s?.sequence)||!safe(s?.declaredArrayBytes)||s.cpuDeclaredArrayBytes!==s.declaredArrayBytes
        ||!a||!['bytes','peak','defaultFramebuffer','defaultPeak','gpuCurrent','gpuPeak','pendingDeleteBytes'].every(k=>safe(a[k]))
        ||a.gpuPeak<a.gpuCurrent||a.peak<a.bytes||a.pendingDeleteBytes>a.bytes||a.defaultPeak<a.defaultFramebuffer
        ||s.gpuReservation!==a.gpuPeak||s.conservativeReservation!==a.peak+a.defaultPeak+s.declaredArrayBytes
        ||!['texture','buffer','renderbuffer'].every(k=>safe(a.byKind?.[k]))
        ||a.bytes!==a.byKind.texture+a.byKind.buffer+a.byKind.renderbuffer||!Array.isArray(a.dimensions)||a.dimensions.length!==2
        ||!a.dimensions.every(n=>Number.isSafeInteger(n)&&n>0)||typeof a.attributes?.depth!=='boolean'||typeof a.attributes?.stencil!=='boolean'
        ||typeof a.attributes?.antialias!=='boolean'||typeof a.framebufferAssumption!=='string'||!a.framebufferAssumption
        ||!a.calls||typeof a.calls!=='object'||Array.isArray(a.calls)||Object.values(a.calls).some(n=>!safe(n)))fail(label+': native sample accounting');
      const buffers=array(a?.bufferSlots,label+'/buffer slots'),textures=array(a?.textureSlots,label+'/texture slots'),ids=new Set(),textureIds=new Set();
      let bufferBytes=0,textureBytes=0;
      for(const b of buffers){
        if(!safe(b?.id)||!b.id||ids.has(b.id)||!safe(b?.bytes)||typeof b?.pendingDelete!=='boolean'
          ||!Array.isArray(b?.owners)||b.owners.some(o=>typeof o!=='string')||new Set(b?.owners||[]).size!==b?.owners?.length)fail(label+': native buffer slots');
        ids.add(b?.id);if(safe(b?.bytes))bufferBytes+=b.bytes;
      }
      for(const t of textures){
        if(!safe(t?.texture)||!t.texture||textureIds.has(t.texture)||!t?.slots||typeof t.slots!=='object'||Array.isArray(t.slots)
          ||Object.values(t.slots).some(n=>!safe(n)))fail(label+': native texture slots');
        textureIds.add(t?.texture);for(const n of Object.values(t?.slots&&typeof t.slots==='object'?t.slots:{}))if(safe(n))textureBytes+=n;
      }
      if(bufferBytes!==a?.byKind?.buffer||textureBytes!==a?.byKind?.texture)fail(label+': complete native slot totals');
    };
    const nativeRestore=(row,label)=>{
      const r=row?.restoration;
      for(const s of array(r?.samples,label+'/restore samples'))nativeSample(s,label+'/restoration');
      const labels=(Array.isArray(r?.samples)?r.samples:[]).map(s=>s?.label);
      if(r?.ok!==true||!['configuration','hooks','routes','settings'].every(k=>r?.[k]?.ok===true)
        ||labels.length!==2||labels[0]!=='restored-native-pending'||labels[1]!=='restored-native-settled'
        ||!Array.isArray(r.calls)||!['terrain','capture','render','allocation'].every(k=>r.calls.includes(k))
        ||r.calls.indexOf('terrain')>r.calls.indexOf('capture')||r.calls.indexOf('capture')>r.calls.indexOf('render')
        ||r.calls.indexOf('render')>r.calls.indexOf('allocation'))fail(label+': exact independent restoration');
    };
    const admission=(row,label)=>{
      const p=row?.preclose;
      if(!p||!['US','CS'].every(side=>p[side]?.fieldReady===true&&p[side].closePromise===false&&p[side].closeTextures===false
        &&p[side].closeBatches===0&&p[side].closeRequests===0)||p.currentSingleBaseBound!==true)fail(label+': before-close admission');
      if(row?.configuration?.fieldUnchanged!==true||row.configuration.baseUnchanged!==true
        ||row.configuration.nativeUSLoading!==true||row.configuration.genuineCapability!==(row.route==='capable')
        ||row.configuration.maskedOnlyAstc!==(row.route==='unsupported'))fail(label+': route configuration');
    };
    const context=(row,label)=>{
      if(typeof row?.contextId!=='string'||!row.contextId||contexts.has(row.contextId))fail(label+': unique fresh context');
      contexts.add(row?.contextId);
      if(row?.complete!==true||row.contextClosed!==true||!Array.isArray(row.errors)||row.errors.length)fail(label+': completed context');
      admission(row,label);
      if(report.nativeHistoryRequired===true&&!row?.history)fail(label+': mandatory native allocation history');
      if(canonicalPolicy)for(const error of focusedSceneResourceErrors(row,{float32:float32Policy,...(fullFloat32?{phase:phases.find(p=>p.packId===row.packId&&p.phaseId===row.phaseId)??{}}:{})}))fail(label+': '+error);
    };
    const chronology=(list,label)=>{
      const ordered=list.filter(Boolean).slice().sort((a,b)=>a.sequence-b.sequence),seq=new Set();let peak=-1,finish=0;
      for(const s of ordered){const f=s.allocation?.calls?.finish||0;if(!safe(s.sequence)||seq.has(s.sequence)||s.allocation?.gpuPeak<peak||f<finish)fail(label+': sample chronology');seq.add(s.sequence);peak=s.allocation?.gpuPeak;finish=f;}
    };
    const validateNativeStress=(stress,e,label,mode)=>{
      const transaction=stress?.transaction,stressSamples=array(transaction?.samples,label+'/stress samples');
      for(const s of stressSamples)nativeSample(s?.observation,label+'/stress/'+s?.label);
      const tiers={US:mode==='preclose'?['field']:['field','close'],CS:mode==='full'?['field','close']:['field']};
      if(stress?.mode!==mode||JSON.stringify(stress.loadedTiers)!==JSON.stringify(tiers))fail(label+': explicit stress loaded tiers');
      const ownerLabels=e?['halos','horses','mounts','guns.US','guns.CS','guns.limbers','flags','smoke',...Array.from({length:e.commanders},(_,i)=>`rings.${i}`)]:[];
      if(e)for(const side of ['US','CS']){for(const lod of [0,1,2])ownerLabels.push(`procedural.${side}.lod${lod}`);ownerLabels.push(`fallen.${side}`);
        for(const tier of (mode==='preclose'||mode==='terminal'&&side==='CS'?['field']:['field','close']))for(let page=0;page<e.pages[side][tier];page++)ownerLabels.push(`baked.${side}.${tier}.${page}`);}
      const n=array(stress?.native,label+'/native owners'),want=['stress','restore-upload','restored-scene'];
      if(stress?.ok!==true||transaction?.ok!==true||!Array.isArray(transaction.errors)||transaction.errors.length
        ||transaction.restoration?.restored!==true||n.length!==3||stressSamples.length!==3||want.some((l,i)=>n[i]?.label!==l||stressSamples[i]?.label!==l))fail(label+': stress transaction/restoration');
      if(stressSamples.some((s,i)=>!safe(s?.observation?.sequence)||i>0&&s.observation.sequence<=stressSamples[i-1]?.observation?.sequence))fail(label+': native stress transaction order');
      for(const [receiptIndex,receipt] of n.entries()){
        const owners=array(receipt?.owners,label+'/native owner rows'),ids=new Set();
        const observation=stressSamples[receiptIndex]?.observation,slots=Array.isArray(observation?.allocation?.bufferSlots)?observation.allocation.bufferSlots:[];
        let dynamicBytes=0,dynamicArrays=0;
        if(receipt?.ok!==true||owners.length!==ownerLabels.length||new Set(owners.map(o=>o?.label)).size!==owners.length
          ||ownerLabels.some(l=>!owners.some(o=>o?.label===l)))fail(label+': every native owner');
        for(const owner of owners){
          if(typeof owner?.label!=='string'){fail(label+': native owner label');continue;}
          const l=owner?.label,capacity=e?(l?.startsWith('procedural.US')||l==='fallen.US'||l?.startsWith('baked.US')?e.US:
            l?.startsWith('procedural.CS')||l==='fallen.CS'||l?.startsWith('baked.CS')?e.CS:l==='halos'?e.US+e.CS:l==='horses'?e.horses:l==='mounts'?e.mounts:
            l?.startsWith('guns.')?e.guns[l.slice(5)]:l==='flags'?e.flags:l==='smoke'?1000:l?.startsWith('rings.')?96:null):null;
          if(!safe(owner?.capacity)||owner.capacity!==capacity||!safe(owner.bytes))fail(label+': owner capacity');
          const strides=l?.startsWith('procedural.')||l?.startsWith('fallen.')?[64,16,16,4]:l?.startsWith('baked.')?[48]:l==='halos'?[64,16,4]:
            l==='horses'||l==='mounts'?[64,12]:l?.startsWith('guns.')?[64]:l==='flags'?[64,4]:l==='smoke'?[12,16,4,12,4]:l?.startsWith('rings.')?[12]:[];
          const arrays=array(owner?.arrays,label+'/native arrays'),drawables=l?.startsWith('baked.')||l?.startsWith('procedural.')&&!l.endsWith('.lod0')?2:1;
          if(arrays.length!==strides.length||arrays.some((a,i)=>a?.bytes!==strides[i]*capacity))fail(label+': complete native array shapes');
          if(receipt?.label==='stress'&&(!Array.isArray(owner?.instances)||owner.instances.length!==drawables
            ||owner.instances.some(n=>l?.startsWith('rings.')?n!==null:n!==capacity)))fail(label+': maximum instance counts');
          let ownerBytes=0;for(const a of arrays){
            const reservations=array(a?.reservations,label+'/native reservations'),live=reservations.filter(r=>r?.pendingDelete===false);
            if(!safe(a?.bytes)||!a.bytes||live.length!==1||live[0]?.bytes!==a.bytes)fail(label+': full-array live reservation');
            ownerBytes+=a?.bytes||0;
            for(const r of reservations){if(!safe(r?.id)||!r.id||ids.has(r.id)||!safe(r?.bytes)||typeof r?.pendingDelete!=='boolean')fail(label+': unique native reservation');ids.add(r?.id);
              if(!r||!safe(r.id)||!r.id)continue;
              const bound=slots.filter(b=>b&&b.id===r.id);
              if(bound.length!==1||bound[0].bytes!==r?.bytes||bound[0].pendingDelete!==r?.pendingDelete||!Array.isArray(bound[0].owners)||!bound[0].owners.includes(l))fail(label+': same-time native owner binding');
            }
          }
          if(ownerBytes!==owner?.bytes)fail(label+': owner array bytes');
          dynamicBytes+=ownerBytes;dynamicArrays+=arrays.length;
        }
        if(stress?.uniqueDynamicBytes!==dynamicBytes||transaction?.restoration?.arrays!==dynamicArrays)fail(label+': complete latent array restoration');
        if(!safe(observation?.declaredArrayBytes)||observation.declaredArrayBytes<dynamicBytes)fail(label+': complete declared dynamic arrays');
        if(slots.some(b=>Array.isArray(b?.owners)&&b.owners.some(l=>ownerLabels.includes(l))&&!ids.has(b.id)))fail(label+': unreported native owner reservation');
      }
      if(stress?.smoke?.systems!==200||stress.smoke.particles!==800||stress.smoke.capacity!==1000
        ||!n.every(s=>Array.isArray(s?.owners)&&s.owners.some(o=>o?.label==='smoke'&&o.bytes===48000)))fail(label+': full native smoke');
    };
    for(const input of array(report.cases,'qualified cases')){
      let row=input;try{row=expandSceneContext(input);}catch(error){fail(key(input)+': '+error.message);}
      const label=key(row),states=array(row?.states,label+'/states'),transaction=row?.stress?.transaction,
        stressSamples=array(transaction?.samples,label+'/stress samples');
      for(const s of states)nativeSample(s,label+'/'+s?.label);
      for(const s of stressSamples)nativeSample(s?.observation,label+'/stress/'+s?.label);
      nativeRestore(row,label); // Collect every peak before rejecting malformed/duplicate identity.
      if(!expected.includes(`${row?.packId}/${row?.phaseId}`)||!SCENE_ROUTES.includes(row?.route)||ordinary.has(label))fail(label+': ordinary tuple');
      ordinary.set(label,{ordinaryRoster:row?.ordinaryRoster,warm:{retainedRoster:row?.warm?.retainedRoster,spawned:row?.warm?.spawned}});context(row,label);
      const labels=states.map(s=>s?.label),required=['field',canonicalPolicy?`${prefix}-field`:'partition-field','inactive-field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize',
        'rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored',
        ...(row?.phaseId==='lookout-mountain'?[canonicalPolicy?`${prefix}-native-zoom`:'partition-native-zoom','framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored']:[])];
      if(new Set(labels).size!==labels.length||required.some(l=>!labels.includes(l)))fail(label+': required ordinary/transition states');
      if(row?.phaseId==='lookout-mountain'){
        const captures=array(row?.canvasCaptures,label+'/canvas captures'),captureLabels=[...(fullFloat32?['terrain-partition-01-before.png','terrain-partition-02-after.png','terrain-partition-03-zoom.png']:[]),...(canonicalPolicy?
          [...['original',partitionKind,'restored'].flatMap(kind=>['overview','near','boundary'].map(view=>`${prefix}-${kind}-${view}`)),`${prefix}-height-control`,`${prefix}-uv-control`,`${prefix}-controls-repaired`]:
          ['terrain-partition-01-before.png','terrain-partition-02-after.png','terrain-partition-03-zoom.png']),
          'rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored','framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored'];
        if(captures.length!==captureLabels.length||new Set(captures.map(c=>c?.label)).size!==captureLabels.length||captureLabels.some(l=>!captures.some(c=>c?.label===l)))fail(label+': complete numbered Lookout canvas captures');
        for(const c of captures){
          const originalFloat32Frame=/^float32-(original|restored)-/.test(c?.label)||(fullFloat32&&c?.label==='terrain-partition-01-before.png');
          if(c?.phase!==row.phaseId||c.toolSha!==report.toolSha||typeof c.filename!=='string'||!c.filename.startsWith(`${row.packId}-${row.phaseId}-${row.route}-`)
            ||!/^[-a-zA-Z0-9_.]+\.png$/.test(c.filename)||!safe(c.bytes)||!c.bytes||!/^[a-f0-9]{64}$/.test(c.sha256||'')
            ||!Number.isSafeInteger(c.width)||c.width<1||!Number.isSafeInteger(c.height)||c.height<1||c.width!==c.drawingWidth||c.height!==c.drawingHeight
            ||c.nativeRenders!==1||c.glError!==0||c.opaque!==true||c.nonuniform!==true||c.kind!=='battlefield-canvas capture; DOM HUD excluded')fail(label+': actual canvas bytes/draw/readback');
          const camera=c?.camera;
          if(!Array.isArray(camera?.position)||camera.position.length!==3||!camera.position.every(Number.isFinite)
            ||!Array.isArray(camera?.quaternion)||camera.quaternion.length!==4||!camera.quaternion.every(Number.isFinite)
            ||!['fov','near','far'].every(k=>Number.isFinite(camera?.[k]))||camera.near<=0||camera.far<=camera.near
            ||!['x','z','yaw','pitch','dist'].every(k=>Number.isFinite(camera?.goal?.[k])))fail(label+': actual native camera bindings');
          if(canonicalPolicy)for(const [side,counts]of [['US',{field:2,close:3}],['CS',{field:4,close:row.route==='capable'?10:5}]])for(const [tier,count]of Object.entries(counts)){
            const pages=c?.figurePublication?.[side]?.[tier];
            if(!Array.isArray(pages)||pages.length!==count||pages.some(p=>typeof p?.uuid!=='string'||!p.uuid||!Number.isSafeInteger(p.width)||p.width<1||!Number.isSafeInteger(p.height)||p.height<1
              ||!Number.isSafeInteger(p.native?.id)||p.native.id<1||!Number.isSafeInteger(p.native.bytes)||p.native.bytes<1||p.native.pendingDelete!==false)
              ||new Set((Array.isArray(pages)?pages:[]).map(p=>p?.native?.id)).size!==count)fail(label+': actual settled '+side+'/'+tier+' figure publication');
          }
          for(const kind of ['terrain','trees']){
            const world=c?.world?.[kind],owners=Array.isArray(world?.owners)?world.owners:[];
            if(typeof world?.root!=='string'||!world.root||!owners.length||owners.some(o=>typeof o?.mesh!=='string'||!o.mesh||typeof o.geometry!=='string'||!o.geometry
              ||!Array.isArray(o.arrays)||!o.arrays.length||o.arrays.some(a=>typeof a?.key!=='string'||!safe(a.bytes)||a.bytes===0||!/^[a-f0-9]{64}$/.test(a.sha256||''))
              ||kind==='terrain'&&!(float32Policy?
                owners.length===(originalFloat32Frame?1:5)&&o.material===row.resource?.originalProof?.materialUuid&&o.arrays.length===3&&['position','uv','index'].every(k=>o.arrays.some(a=>a.key===k&&a.arrayType===(k==='index'?(originalFloat32Frame?'Uint32Array':'Uint16Array'):'Float32Array')&&a.itemSize===(k==='position'?3:k==='uv'?2:1)&&a.normalized===false&&Number.isSafeInteger(a.count)&&a.count>0&&a.bytes===a.count*a.itemSize*(k==='index'&&!originalFloat32Frame?2:4))):canonicalPolicy&&!float32Policy&&!/^canonical-(original|restored)-/.test(c.label)?
                o.arrays.length===3&&['aGrid','aHeight','index'].every(k=>o.arrays.some(a=>a.key===k&&a.arrayType===(k==='aHeight'?'Float32Array':'Uint16Array')&&a.itemSize===(k==='aGrid'?2:1)&&a.normalized===false&&Number.isSafeInteger(a.count)&&a.count>0&&a.bytes===a.count*a.itemSize*(k==='aHeight'?4:2))):
                o.arrays.some(a=>a.key==='position'&&a.bytes>0)))
              ||kind==='trees'&&!owners.some(o=>Array.isArray(o.arrays)&&o.arrays.some(a=>a.key==='instanceMatrix'&&a.bytes>0)))fail(label+': actual '+kind+' array bindings');
          }
          if(!safe(c?.world?.trees?.count)||!c.world.trees.count||!Array.isArray(c?.roster)||!c.roster.length||JSON.stringify(c.roster)!==JSON.stringify(row.ordinaryRoster))fail(label+': actual trees and ordinary roster');
        }
        if(canonicalPolicy){
          for(const view of ['overview','near','boundary']){const frames=['original',partitionKind,'restored'].map(kind=>captures.find(c=>c.label===`${prefix}-${kind}-${view}`)),first=frames[0];
            if(frames.some(c=>!c||!/^[a-f0-9]{64}$/.test(c.pixelSha256||'')||c.pixelSha256!==first?.pixelSha256||c.width!==first?.width||c.height!==first?.height||c.simTime!==0
              ||JSON.stringify(c.camera)!==JSON.stringify(first?.camera)||JSON.stringify(c.roster)!==JSON.stringify(first?.roster)||JSON.stringify(c.world?.trees)!==JSON.stringify(first?.world?.trees)
              ||!c.figurePublication||JSON.stringify(c.figurePublication)!==JSON.stringify(first?.figurePublication))
              ||JSON.stringify(frames[0]?.world?.terrain)!==JSON.stringify(frames[2]?.world?.terrain))fail(label+': exact whole original/canonical/restored painted frames');}
          const baseline=captures.find(c=>c.label===`${prefix}-${partitionKind}-boundary`),height=captures.find(c=>c.label===`${prefix}-height-control`),uv=captures.find(c=>c.label===`${prefix}-uv-control`),repair=captures.find(c=>c.label===`${prefix}-controls-repaired`);
          if(!baseline||[height,uv,repair].some(c=>!c||!/^[a-f0-9]{64}$/.test(c.pixelSha256||'')||JSON.stringify(c.camera)!==JSON.stringify(baseline.camera)||JSON.stringify(c.roster)!==JSON.stringify(baseline.roster))
            ||height?.pixelSha256===baseline?.pixelSha256||uv?.pixelSha256===baseline?.pixelSha256||repair?.pixelSha256!==baseline?.pixelSha256)fail(label+': healthy height/UV controls and exact repair');
          const views=float32Policy?row.float32Views:row.canonicalViews;
          if(!Array.isArray(views)||views.length!==3||JSON.stringify(views.map(v=>v.label))!==JSON.stringify(['overview','near','boundary'])
            ||!Array.isArray(views[2]?.sharedChunkBoundary)||views[2].sharedChunkBoundary.length!==2||!views[2].sharedChunkBoundary.every(Number.isFinite))fail(label+': actual shared chunk boundary');
        }
        const frames=['framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored'].map(l=>captures.find(c=>c?.label===l)),framed=row?.framedComparison;
        if(!framed||!Array.isArray(framed.position)||framed.position.length!==2||framed.simTime!==0||framed.goal?.dist!==200
          ||frames.some((c,i)=>!c||c.simTime!==framed.simTime||c.style!==['rigged','baked','baked'][i]||c.camera?.goal?.dist!==200
            ||(i<2?c.comparison?.key!=='look.figureStyle'||c.comparison.a!==c.style||c.comparison.b!==['baked','rigged'][i]||c.comparison.split!==0.5:c.comparison!==null)
            ||!Array.isArray(c.roster)||!c.roster.some(u=>u.id===framed.unitId&&u.x===framed.position[0]&&u.z===framed.position[1])
            ||JSON.stringify(c.camera)!==JSON.stringify(frames[0]?.camera)||JSON.stringify(c.world)!==JSON.stringify(frames[0]?.world)||JSON.stringify(c.roster)!==JSON.stringify(frames[0]?.roster)))fail(label+': stable readable 200m framed comparison');
      }
      for(const [name,viewport,lens] of [['field',[1024,768],false],['lens-depth',[1024,768],true],['lens-resize',[1366,1024],true],['lens-retired',[1366,1024],false],['narrow-resize',[320,568],false]]){
        const s=states.find(s=>s?.label===name);
        if(JSON.stringify(s?.viewport)!==JSON.stringify(viewport)||s?.lens!==lens||s?.dpr!==2)fail(label+': actual lens/viewport state '+name);
      }
      const pub=row?.publication,encodings=row?.route==='capable'?[...Array(4).fill('astc4x4'),'png',...Array(4).fill('astc4x4'),'png']:Array(5).fill('png');
      if(pub?.fieldUnchanged!==true||pub.closePages!==encodings.length||JSON.stringify(pub.encodings)!==JSON.stringify(encodings)
        ||pub.candidateRequests!==(row?.route==='capable'?10:0)||pub.failure!==null)fail(label+': exact route publication');
      if(row?.ordinaryRoster===undefined||row?.warm?.baseline!=='explicitly warmed supported lazy resources, retained stress roster and native smoke; pristine state not claimed'
        ||row.warm.afterOrdinary!==true||row.warm.retainedRoster===undefined||row.warm.combatUnchanged!==true)fail(label+': labelled warm baseline');
      const transitions=Array.isArray(row?.transitions)?row.transitions:[],transitionContract=[['rigged-reactivation','rigged',false],['near-lod-reupload','rigged',false],['baked-reclamation','baked',false],['compare-rigged-left','rigged',true],['compare-baked-left','baked',true],['baked-restored','baked',false]];
      if(!row?.lodReactivation?.after||row.lodReactivation.before?.id===row.lodReactivation.after.id||row.lodReactivation.fullArray!==true
        ||new Set(transitions.map(t=>t?.label)).size!==transitions.length||transitionContract.some(([name,style,compare])=>!transitions.some(t=>t?.label===name&&t.style===style&&t.compare===compare))
        ||transitions.some(t=>t?.combatUnchanged!==true||typeof t.combatBefore!=='string'||!t.combatBefore||t.combatBefore!==t.combatAfter))fail(label+': native transitions');
      const authored=(Array.isArray(phases)?phases:[]).find(p=>p?.packId===row?.packId&&p?.phaseId===row?.phaseId)?.scenario;
      let e;try{if(!authored||JSON.stringify(authored)!==JSON.stringify(row.scenario))throw Error('authored scenario binding');
        e=deriveSceneStressContract(authored,{US:{field:2,close:3},CS:{field:4,close:row.route==='capable'?10:5}});
        if(JSON.stringify(e)!==JSON.stringify(row.capacityContract))fail(label+': derived capacities');
      }catch{fail(label+': authored capacity contract');}
      validateNativeStress(row?.stress,e,label,'full');
      chronology([...states,...stressSamples.map(s=>s?.observation),...array(row?.restoration?.samples,label+'/chronology restore')],label);
    }
    for(const input of array(report.faults,'qualified faults')){
      let row=input;try{row=expandSceneContext(input);}catch(error){fail(key(input)+': '+error.message);}
      const label=key(row)+'/'+row?.fault,states=array(row?.states,label+'/states');
      for(const s of states)nativeSample(s,label+'/'+s?.label);
      if(row?.stress?.transaction?.samples!==undefined)for(const s of array(row.stress.transaction.samples,label+'/fault stress samples'))nativeSample(s?.observation,label+'/fault stress');
      nativeRestore(row,label);
      if(!expected.includes(`${row?.packId}/${row?.phaseId}`)||!SCENE_FAULTS.some(f=>f.route===row?.route&&f.fault===row?.fault)||faultSeen.has(label))fail(label+': fault tuple');
      faultSeen.add(label);context(row,label);
      let e;try{
        const authored=(Array.isArray(phases)?phases:[]).find(p=>p?.packId===row?.packId&&p?.phaseId===row?.phaseId)?.scenario;
        if(!authored||JSON.stringify(authored)!==JSON.stringify(row.scenario))throw Error('authored fault scenario');
        e=deriveSceneStressContract(authored,{US:{field:2,close:3},CS:{field:4,close:5}});
        if(JSON.stringify(e)!==JSON.stringify(row.capacityContract))fail(label+': derived fault capacities');
      }catch{fail(label+': authored fault capacity contract');}
      const pre=row?.preload,want=['stress','restore-upload','restored-scene'],sequences=array(pre?.sampleSequences,label+'/preload sequences');
      const preloadSamples=sequences.map((sequence,i)=>({label:want[i],observation:states.find(s=>s?.sequence===sequence)}));
      if(sequences.length!==3||new Set(sequences).size!==3||sequences.some(n=>!safe(n))||pre?.transaction?.samples!==undefined
        ||preloadSamples.some((s,i)=>s.observation?.label!=='preclose-'+want[i]||states.filter(x=>x?.sequence===sequences[i]).length!==1)
        ||pre?.baseline!=='explicitly warmed supported lazy resources, retained stress roster and native smoke; pristine state not claimed'
        ||pre?.retainedRoster===undefined||JSON.stringify(pre.retainedRoster)!==JSON.stringify(ordinary.get(key(row))?.warm?.retainedRoster)
        ||pre?.combatUnchanged!==true)fail(label+': complete labelled preload baseline');
      for(const boundary of ['before','after']){
        const p=pre?.[boundary];
        if(!p||!['US','CS'].every(side=>p[side]?.fieldReady===true&&p[side].closePromise===false&&p[side].closeTextures===false
          &&p[side].closeBatches===0&&p[side].closeRequests===0)||p.currentSingleBaseBound!==true)fail(label+': zero-close preload '+boundary);
      }
      validateNativeStress({...pre,transaction:{...pre?.transaction,samples:preloadSamples}},e,label+'/preload','preclose');
      const events=array(row?.events,label+'/events'),eventSeq=new Set();let prior=-1;
      for(const event of events){if(!safe(event?.sequence)||event.sequence<=prior||eventSeq.has(event.sequence)||typeof event?.operation!=='string')fail(label+': ordered fault events');eventSeq.add(event?.sequence);prior=event?.sequence;}
      const ops=op=>events.filter(e=>e?.operation===op),fired=ops('fault-fired'),terminal=['candidate-then-baseline-terminal','baseline-terminal'].includes(row?.fault),
        first=ops('first-baseline-request'),pendingLabel=terminal?'terminal-rejected-pending':'fallback-published-pending',settledLabel=terminal?'terminal-settled':'fallback-settled';
      if(fired.length!==1||fired[0]?.fault!==row?.fault||first.length!==1)fail(label+': actual fault/first baseline request');
      const firstSample=states.find(s=>s?.label==='first-baseline-request'),pending=states.find(s=>s?.label===pendingLabel),settled=states.find(s=>s?.label===settledLabel);
      const start=states.find(s=>s?.label==='fault-start');
      const completion=report.fallbackCompletion==='native-finish-after-candidate-disposal'&&row?.route==='capable';
      const completionStarts=ops('candidate-completion-start'),completionResults=ops('candidate-completion-result'),
        beforeCompletion=states.filter(s=>s?.label==='candidate-completion-before'),afterCompletion=states.filter(s=>s?.label==='candidate-completion-after');
      const finishCount=s=>s?.allocation?.calls?.finish||0;
      if(completion){
        const before=beforeCompletion[0],after=afterCompletion[0],begin=completionStarts[0],done=completionResults[0];
        if(beforeCompletion.length!==1||afterCompletion.length!==1||completionStarts.length!==1||completionResults.length!==1
          ||begin?.method!=='finish'||done?.method!=='finish'||done?.ok!==true||!Number.isFinite(done?.elapsedMs)||done.elapsedMs<0
          ||before?.sequence!==begin?.sequence||after?.sequence!==done?.sequence||start?.sequence>=before?.sequence||before?.sequence>=after?.sequence
          ||after?.sequence>=firstSample?.sequence||finishCount(before)!==finishCount(start)||finishCount(after)!==finishCount(before)+1
          ||finishCount(firstSample)!==finishCount(after)||after?.allocation?.pendingDeleteBytes!==0
          ||after?.allocation?.bytes!==before?.allocation?.bytes-before?.allocation?.pendingDeleteBytes
          ||after?.allocation?.gpuPeak<before?.allocation?.gpuPeak)fail(label+': confirmed native completion before fallback');
        for(const [kind,idKey]of [['bufferSlots','id'],['textureSlots','texture'],['renderbufferSlots','id']]){
          const previous=array(before?.allocation?.[kind],label+'/before completion '+kind),next=array(after?.allocation?.[kind],label+'/after completion '+kind);
          if(previous.filter(s=>s?.pendingDelete).some(s=>next.some(t=>t?.[idKey]===s[idKey])))fail(label+': native pending identity survived completion '+kind);
        }
        if(ops('candidate-dispose').some(e=>e.sequence>=before?.sequence)||ops('candidate-all-settled')[0]?.sequence>=before?.sequence)fail(label+': completion after settled sibling disposal');
      }else if(completionStarts.length||completionResults.length||beforeCompletion.length||afterCompletion.length)fail(label+': unexpected completion boundary');
      const fallbackFinishes=finishCount(start)+(completion?1:0);
      const postSamples=array(row?.stress?.transaction?.samples,label+'/postoutcome samples');
      validateNativeStress(row?.stress,e,label+'/postoutcome',terminal?'terminal':'full');
      if(preloadSamples.some(s=>!s.observation||s.observation.sequence>=start?.sequence)
        ||postSamples.length!==3||postSamples.some(s=>!s?.observation||s.observation.sequence<=pending?.sequence||s.observation.sequence>=settled?.sequence
          ||(s.observation.allocation?.calls.finish||0)!==fallbackFinishes
          ||row?.route==='capable'&&s.observation.allocation?.pendingDeleteBytes<firstSample?.allocation?.pendingDeleteBytes))fail(label+': preload and pending postoutcome stress chronology');
      if(!start||start.sequence>=firstSample?.sequence||fallbackFinishes!==finishCount(firstSample))fail(label+': exact declared finish through fault and fallback');
      if(!firstSample||firstSample.sequence!==first[0]?.sequence||!pending||!settled||firstSample.sequence>=pending.sequence||pending.sequence>=settled.sequence
        ||first[0]?.beforeNativeLoader!==true||(firstSample.allocation?.calls.finish||0)!==(pending.allocation?.calls.finish||0)
        ||(settled.allocation?.calls.finish||0)<=(pending.allocation?.calls.finish||0))fail(label+': observational overlap and explicit settlement');
      const baselineUploads=ops('baseline-upload'),baselineSettled=ops('baseline-settled'),baselineSamples=states.filter(s=>s?.label==='baseline-upload');
      if(baselineUploads.length!==(terminal?4:5)||baselineSamples.length!==baselineUploads.length||baselineSettled.length!==5
        ||baselineSettled.some(e=>!['soldier_close_0.png','soldier_close_1.png','soldier_close_2.png','soldier_close_3.png','soldier_close_4.png'].includes(e.page))
        ||terminal&&baselineSettled.find(e=>e.outcome==='rejected')?.page!=='soldier_close_0.png'
        ||new Set(baselineUploads.map(e=>e.page)).size!==baselineUploads.length||new Set(baselineSamples.map(e=>e.page)).size!==baselineSamples.length
        ||new Set(baselineSettled.map(e=>e.page)).size!==5||baselineSettled.filter(e=>e.outcome==='rejected').length!==(terminal?1:0)
        ||baselineSettled.some(e=>!['fulfilled','rejected'].includes(e.outcome)||e.sequence<=first[0]?.sequence||e.sequence>=pending?.sequence)
        ||baselineUploads.some(e=>e.beforeSample!==true||e.sequence<=first[0]?.sequence||e.sequence>=pending?.sequence
          ||!baselineSamples.some(s=>s.sequence===e.sequence&&s.page===e.page)||!baselineSettled.some(s=>s.page===e.page&&s.outcome==='fulfilled'&&s.sequence>e.sequence))
        ||baselineSettled.filter(e=>e.outcome==='fulfilled').some(e=>!baselineUploads.some(u=>u.page===e.page&&u.sequence<e.sequence))
        ||(row?.route==='capable'&&(!completion&&!(firstSample?.allocation?.pendingDeleteBytes>0)||completion&&firstSample?.allocation?.pendingDeleteBytes!==0
          ||[...baselineSamples,pending].some(s=>s?.allocation?.pendingDeleteBytes<firstSample.allocation.pendingDeleteBytes)))
        ||settled?.allocation?.pendingDeleteBytes!==0)fail(label+': baseline upload overlap and retained pending deletes');
      if(row?.route==='unsupported'){
        if(events.some(e=>typeof e?.operation==='string'&&(e.operation.startsWith('candidate-')||e.operation.startsWith('sibling-')))||row?.candidateRequests!==0)fail(label+': unsupported candidate IO');
      }else{
        const requests=ops('candidate-request'),settlements=ops('candidate-settled'),created=ops('candidate-created'),disposed=ops('candidate-dispose'),uploaded=ops('candidate-upload');
        for(const [name,list]of [['requests',requests],['settlements',settlements]])if(list.length!==10||new Set(list.map(e=>e.page)).size!==10
          ||candidateNames.some(p=>!list.some(e=>e.page===p)))fail(label+': complete candidate '+name);
        if(row?.candidateRequests!==10||created.some(e=>!safe(e.textureId)||!e.textureId)||new Set(created.map(e=>e.textureId)).size!==created.length
          ||disposed.length!==created.length||created.some(e=>!disposed.some(d=>d.textureId===e.textureId))
          ||settlements.some(e=>!['fulfilled','rejected'].includes(e.outcome)||e.sequence>=first[0]?.sequence)
          ||disposed.some(e=>e.sequence>=first[0]?.sequence)||disposed.some(d=>settlements.some(s=>s.sequence>d.sequence)))fail(label+': settled siblings/disposal before fallback');
        const prepareFault=['first-pool-prepare','candidate-then-baseline-terminal'].includes(row?.fault),rejected=settlements.filter(e=>e.outcome==='rejected');
        if(rejected.length!==(prepareFault?0:1)||uploaded.length!==(prepareFault?10:9)||created.length!==(prepareFault||row?.fault==='native-upload'?10:9)
          ||new Set(created.map(e=>e.page)).size!==created.length||new Set(uploaded.map(e=>e.page)).size!==uploaded.length
          ||uploaded.some(u=>!created.some(c=>c.page===u.page&&c.sequence<u.sequence))
          ||settlements.filter(e=>e.outcome==='fulfilled').some(s=>!uploaded.some(u=>u.page===s.page&&u.sequence<s.sequence))
          ||(!prepareFault&&(fired[0]?.page!==rejected[0]?.page||!candidateNames.includes(fired[0]?.page))))fail(label+': actual page fault and native sibling uploads');
        const barriers=ops('candidate-all-settled');
        if(barriers.length!==1||settlements.some(s=>s.sequence>=barriers[0]?.sequence)||disposed.some(d=>d.sequence<=barriers[0]?.sequence||d.ok!==true)
          ||created.some(c=>!requests.some(r=>r.page===c.page&&r.sequence<c.sequence))
          ||(!prepareFault&&fired[0]?.sequence>=rejected[0]?.sequence)
          ||(row?.fault==='native-upload'&&!created.some(c=>c.page===rejected[0]?.page&&c.sequence<fired[0]?.sequence)))fail(label+': actual native fault chronology');
        if(['first-pool-prepare','candidate-then-baseline-terminal'].includes(row?.fault)){
          const prepare=ops('first-pool-prepare-rejected');
          if(uploaded.length!==10||new Set(uploaded.map(e=>e.page)).size!==10||prepare.length!==1||uploaded.some(e=>e.sequence>=prepare[0]?.sequence)
            ||barriers[0]?.sequence>=prepare[0]?.sequence||prepare[0]?.sequence>=fired[0]?.sequence)fail(label+': prepare after ten native uploads once');
        }
        if(row?.fault==='native-upload'&&(fired[0]?.native!==true||fired[0].glError!==0x0501))fail(label+': genuine native upload error');
        if(row?.fault==='candidate-http'&&(fired[0]?.actualHTTP!==true||fired[0].status!==404))fail(label+': genuine candidate HTTP failure');
        if(typeof row?.fault==='string'&&row.fault.startsWith('rejection-delayed-')){
          const held=ops('sibling-held'),checked=ops('held-check'),released=ops('sibling-released');
          if(held.length!==1||checked.length!==1||released.length!==1||held[0].sequence>=checked[0]?.sequence||checked[0].sequence>=released[0]?.sequence
            ||released[0].sequence>=first[0]?.sequence||checked[0]?.published!==false||checked[0].baselineRequests!==0
            ||checked[0]?.nonHeldSettled!==9||checked[0]?.rejectionCount!==1
            ||settlements.filter(e=>e.page!==held[0]?.page&&e.sequence<checked[0]?.sequence).length!==9
            ||!rejected.some(e=>e.sequence<checked[0]?.sequence)
            ||held[0]?.encoding!==(row.fault.endsWith('astc')?'astc4x4':'png')||!settlements.some(e=>e.page===held[0]?.page&&e.sequence>released[0]?.sequence)
            ||!uploaded.some(e=>e.page===held[0]?.page&&e.sequence>released[0]?.sequence))fail(label+': delayed sibling evidence');
        }
      }
      const outcome=row?.outcome;
      if(outcome?.rejected!==terminal||outcome.published!==!terminal||outcome.cachedClosePromise!==true||outcome.fieldUnchanged!==true
        ||outcome.baselinePages!==(terminal?0:5)||!Number.isSafeInteger(row?.poolCount)||row.poolCount<1||!Array.isArray(outcome.poolPages)||outcome.poolPages.length!==row.poolCount||outcome.poolPages.some(n=>n!==(terminal?0:5))
        ||(!terminal&&outcome.exactCurrentSingleBase!==true)||(terminal&&outcome.baselineSiblingsDisposed!==true))fail(label+': terminal/fallback publication');
      chronology([...states,...(Array.isArray(row?.stress?.transaction?.samples)?row.stress.transaction.samples.map(s=>s?.observation):[]),...array(row?.restoration?.samples,label+'/chronology restore')],label);
    }
    if(ordinary.size!==2*requiredPhases||expected.some(p=>SCENE_ROUTES.some(route=>!ordinary.has(p+'/'+route))))fail('missing qualified ordinary tuple');
    if(faultSeen.size!==8*requiredPhases||expected.some(p=>SCENE_FAULTS.some(f=>!faultSeen.has(p+'/'+f.route+'/'+f.fault))))fail('missing qualified fault tuple');
    for(const p of expected){const a=ordinary.get(p+'/capable'),b=ordinary.get(p+'/unsupported');
      if(!a||!b||JSON.stringify(a.ordinaryRoster)!==JSON.stringify(b.ordinaryRoster)||JSON.stringify(a.warm?.retainedRoster)!==JSON.stringify(b.warm?.retainedRoster)
        ||JSON.stringify(a.warm?.spawned)!==JSON.stringify(b.warm?.spawned))fail(p+': paired native roster');}
    return verdict();
  }
  if(!Array.isArray(report.cases))fail('cases shape');
  for(const input of Array.isArray(report.cases)?report.cases:[]){
    let row=input;try{row=expandSceneContext(input);}catch(error){fail('scene history: '+error.message);}
    if(!row||typeof row!=='object'||Array.isArray(row)){fail('phase shape');continue;}
    const key=`${row.packId}/${row.phaseId}`;
    if(!expected.includes(key)||seen.has(key))fail(`${key}: extra/duplicate phase`);seen.add(key);
    if(row.complete!==true||row.restoration?.ok!==true||!Array.isArray(row.errors)||row.errors.length)fail(`${key}: completeness/restoration`);
    restored(row.restoration,key);
    if(report.terrainRestorationObserved){
      const labels=Array.isArray(row.restoration?.samples)?row.restoration.samples.map(s=>s?.label):null;
      if(!Array.isArray(labels)||labels.length!==2||labels[0]!=='restored-native-pending'||labels[1]!=='restored-native-settled'
        ||!Array.isArray(row.restoration?.calls)||!row.restoration.calls.includes('terrain')||!row.restoration.calls.includes('capture'))fail(`${key}: native terrain restoration`);
    }
    if(!Array.isArray(row.states))fail(`${key}: states shape`);
    const labels=new Set();for(const s of Array.isArray(row.states)?row.states:[]){
      if(!s||typeof s!=='object'||typeof s.label!=='string'){fail(`${key}: state shape`);sample(s,key);continue;}
      if(labels.has(s.label))fail(`${key}: duplicate state`);labels.add(s.label);sample(s,`${key}/${s.label}`);
    }
    for(const label of ['field','both-close-tiers','lens-depth','lens-resize','lens-retired','narrow-resize',
      ...(report.inactivePrototype?['inactive-field']:[]),...(report.terrainPartitionPrototype?['partition-field']:[])])
      if(!labels.has(label))fail(`${key}: missing ${label}`);
    if(row.phaseId==='lookout-mountain'){
      const required=[...(report.terrainPartitionPrototype?['partition-native-zoom']:[]),
        ...(report.inactivePrototype?['rigged-reactivation','near-lod-reupload','baked-reclamation','compare-rigged-left','compare-baked-left','baked-restored']:[]),
        ...(report.inactivePrototype&&report.terrainPartitionPrototype?['framed-compare-rigged-left','framed-compare-baked-left','framed-baked-restored']:[])];
      for(const label of required)if(!labels.has(label))fail(`${key}: missing ${label}`);
      if(report.inactivePrototype&&(!row.lodReactivation?.after||row.lodReactivation.before?.id===row.lodReactivation.after.id
        ||!Array.isArray(row.transitions)||row.transitions.some(t=>t?.combatUnchanged!==true)))fail(`${key}: transition evidence`);
    }
  }
  if(seen.size!==expected.length||expected.some(key=>!seen.has(key)))fail('missing phase');
  if(report.failure?.rejected!==true||report.failure?.published!==false||report.failure?.restoration?.ok!==true)fail('failure completeness/restoration');
  sample(report.failure,'failure');
  restored(report.failure?.restoration,'failure');
  return verdict();
}

/** Installed only in an owned diagnostic context before game boot. No product code or GL arguments changed. */
/** Acquisition is query-free by default; optional surface capture reads live dimensions/attributes. */
export function installFieldContextObserver({enabled=false,observeSurfaces=false,observeEpochs=false,enableContextHandles=false}={}) {
  if([enabled,observeSurfaces,observeEpochs,enableContextHandles].some(v=>typeof v!=='boolean'))throw Error('field context observer: explicit boolean required');
  if(!enabled)return Object.freeze({read:()=>({enabled:false}),restore(){}});
  if(observeEpochs&&!observeSurfaces)throw Error('field context observer: epochs require surface capture');
  if(enableContextHandles&&!observeEpochs)throw Error('field context observer: handles require epoch ownership');
  const proto=globalThis.HTMLCanvasElement?.prototype,native=proto?.getContext;
  if(typeof native!=='function')throw Error('field context observer: canvas API unavailable');
  const original=Object.getOwnPropertyDescriptor(proto,'getContext'),prior=Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),
    allocation=Object.getOwnPropertyDescriptor(window,'__allocation')?.value;
  if(!allocation||typeof allocation.peek!=='function')throw Error('field context observer: retained allocation observer required');
  if(prior&&!prior.configurable)throw Error('field context observer: observation property is not configurable');
  const receipts=[],contexts=new Map(),ids=new WeakMap(),errors=[],peek=allocation.peek,
    surface=allocation.surfaceBoundary,surfaceFailure=allocation.surfaceFailure,canvasContexts=new WeakMap(),accessors=[],lossListeners=[],lostCanvases=new WeakSet(),
    epochs=[],epochListeners=[],canvasRecords=new Map(),epochOptions=Object.freeze({capture:true,passive:true}),
    addEpoch=window.addEventListener,removeEpoch=window.removeEventListener,allocationAssertion=allocation.assertOwned;
  if(observeEpochs&&(typeof addEpoch!=='function'||typeof removeEpoch!=='function'))throw Error('field context observer: window events unavailable');
  if(observeEpochs&&typeof allocationAssertion!=='function')throw Error('field context observer: allocation ownership assertion required');
  if(observeSurfaces){
    if(typeof surface!=='function'||typeof surfaceFailure!=='function'||allocation.defaultSurfaceCapture!==true)
      throw Error('field context observer: default surface capture required');
    for(const name of ['width','height']){
      let owner=proto;while(owner&&!Object.getOwnPropertyDescriptor(owner,name))owner=Object.getPrototypeOf(owner);
      const nativeDescriptor=owner&&Object.getOwnPropertyDescriptor(owner,name),descriptor=Object.getOwnPropertyDescriptor(proto,name);
      if(typeof nativeDescriptor?.get!=='function'||typeof nativeDescriptor?.set!=='function'||descriptor?.configurable===false)
        throw Error('field context observer: configurable native canvas accessors required');
      accessors.push({name,descriptor,nativeDescriptor,restored:false,installed:null});
    }
  }
  let failures=0,overflow=false,ignored=0,methodRestored=false,propertyRestored=false,installedDescriptor,installedProperty,
    setterAttempts=0,setterCompletions=0;
  const metadata=error=>{
    const type=typeof error,primitive=error===null||['string','number','boolean','undefined'].includes(type);
    let unavailable=!primitive&&type!=='object';
    const out={type,value:primitive?error??null:null};
    if(type==='number'&&!Number.isFinite(error)||type==='string'&&error.length>16384){out.value=null;unavailable=true;}
    for(const key of ['name','message','stack']){const value=error?.[key];
      out[key]=typeof value==='string'&&value.length<=16384?value:null;
      if(value!==undefined&&value!==null&&(typeof value!=='string'||value.length>16384))unavailable=true;
    }
    return {...out,metadataUnavailable:unavailable};
  };
  const observed=fn=>{try{fn();}catch(error){failures++;
    if(errors.length>=128){overflow=true;return;}
    try{errors.push({kind:'observation failed',...metadata(error)});}
    catch{errors.push({kind:'observation failed; error metadata unavailable'});}
  }};
  const assertFieldOwned=gl=>{
    if(!matches(Object.getOwnPropertyDescriptor(proto,'getContext'),methodRestored?original:installedDescriptor)
      ||!matches(Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),propertyRestored?prior:installedProperty)
      ||accessors.some(a=>!matches(Object.getOwnPropertyDescriptor(proto,a.name),a.restored?a.descriptor:a.installed)))
      throw Error('field observer descriptor ownership changed');
    for(const [canvas,record]of canvasRecords)if(Object.getPrototypeOf(canvas)!==record.prototype
      ||Object.keys(record.own).some(name=>!matches(Object.getOwnPropertyDescriptor(canvas,name),record.own[name])))
      throw Error('field canvas instance ownership changed');
    if(observeEpochs&&(allocation.assertOwned!==allocationAssertion||Reflect.apply(allocationAssertion,allocation,[gl])!==true))
      throw Error('allocation wrapper ownership changed');
  };
  const epochProjection=gl=>{
    assertFieldOwned(gl);
    if(Object.getOwnPropertyDescriptor(window,'__allocation')?.value!==allocation||allocation.peek!==peek)throw Error('epoch allocation ownership changed');
    const r=Reflect.apply(peek,allocation,[gl]),natural=n=>Number.isSafeInteger(n)&&n>=0;
    const fields=['bytes','peak','pendingDeleteBytes','gpuCurrent','gpuPeak','defaultFramebuffer','pendingDefaultFramebuffer','nativeFailureCount','observerFailureCount'];
    if(r?.observed!==true||fields.some(k=>!natural(r[k]))||!Array.isArray(r.nativeEvents)||!Array.isArray(r.defaultEvents)
      ||!r.calls||typeof r.calls!=='object'||Array.isArray(r.calls)||Object.keys(r.calls).length>64||Object.keys(r.calls).some(k=>k.length>128)||!Object.values(r.calls).every(natural)
      ||!Array.isArray(r.unknown)||r.unknown.length>128||r.unknown.some(v=>typeof v!=='string'||v.length>16384))
      throw Error('epoch retained evidence unavailable');
    return {context:ids.get(gl),...Object.fromEntries(fields.map(k=>[k,r[k]])),calls:{...r.calls},unknown:[...r.unknown],
      nativeEventsEnd:r.nativeEvents.length,surfaceEventsEnd:r.defaultEvents.length,setterAttempts,setterCompletions};
  };
  const onEpoch=event=>observed(()=>{
    const canvas=event.target,gl=canvasContexts.get(canvas);
    try{
      if(epochs.length>=8){overflow=true;return;}
      const context=gl?ids.get(gl):null;
      epochs.push({sequence:epochs.length+1,event:event.type,trusted:event.isTrusted===true,phase:event.eventPhase,
        windowTarget:event.currentTarget===window,context,targetBound:!!context&&canvas===document.getElementById('battlefield'),
        connected:canvas?.isConnected===true,documentOwned:canvas?.ownerDocument===document&&document.defaultView===window,
        retained:gl?epochProjection(gl):null});
    }finally{
      if(event.type==='webglcontextlost'&&gl){lostCanvases.add(canvas);
        Reflect.apply(surfaceFailure,allocation,[gl,'default surface loss/restoration epoch unproved',true]);}
    }
  });
  const observeSurface=(canvas,gl,boundary)=>observed(()=>{
    if(Object.getOwnPropertyDescriptor(window,'__allocation')?.value!==allocation||allocation.surfaceBoundary!==surface
      ||allocation.surfaceFailure!==surfaceFailure||accessors.some(a=>!matches(Object.getOwnPropertyDescriptor(proto,a.name),a.installed)))
      throw Error('default surface observation ownership changed');
    if(lostCanvases.has(canvas))return;
    const width=Reflect.apply(accessors[0].nativeDescriptor.get,canvas,[]),height=Reflect.apply(accessors[1].nativeDescriptor.get,canvas,[]);
    Reflect.apply(surface,allocation,[gl,{boundary,width,height}]);
  });
  const emit=(receiver,args,value,threw,error)=>observed(()=>{
    const target=receiver===document.getElementById('battlefield'),type=typeof args[0]==='string'?args[0]:null,
      supported=['webgl','webgl2','experimental-webgl'].includes(type);
    if(!target&&!supported){ignored++;return;}
    if(receipts.length>=128){overflow=true;return;}
    let context=null;
    if(target&&supported&&!threw&&value!==null){
      if((typeof value!=='object'&&typeof value!=='function')||value===undefined)throw Error('unexpected context result');
      if(!ids.has(value)){
        if(contexts.size>=8){overflow=true;return;}
        const id=contexts.size+1;ids.set(value,id);contexts.set(id,value);
        if(observeSurfaces){
          canvasContexts.set(receiver,value);
          const own=Object.fromEntries(['getContext','width','height'].map(name=>[name,Object.getOwnPropertyDescriptor(receiver,name)]));
          canvasRecords.set(receiver,{prototype:Object.getPrototypeOf(receiver),own});
          if(observeEpochs&&Object.values(own).some(Boolean))throw Error('field canvas has unobserved own methods/accessors');
          const loss=()=>{lostCanvases.add(receiver);observed(()=>Reflect.apply(surfaceFailure,allocation,[value,'default surface loss/restoration epoch unproved',true]));};
          receiver.addEventListener('webglcontextlost',loss);lossListeners.push({canvas:receiver,loss});
          observeSurface(receiver,value,'creation');
        }
      }
      context=ids.get(value);
    }
    const errorInfo=threw?metadata(error):null;
    if(errorInfo?.metadataUnavailable){failures++;if(errors.length<128)errors.push({kind:'native error metadata unavailable'});else overflow=true;}
    receipts.push({sequence:receipts.length+1,target,type,argumentCount:args.length,supported,context,
      outcome:threw?'throw':value===null?'null':'return',
      ...(threw?{error:errorInfo}:{})});
  });
  const wrapped=function(...args){
    let value;
    try{value=Reflect.apply(native,this,args);}catch(error){emit(this,args,null,true,error);throw error;}
    emit(this,args,value,false,null);return value;
  };
  const matches=(a,b)=>['value','get','set','writable','enumerable','configurable'].every(k=>a?.[k]===b?.[k]);
  const observer=Object.freeze({
    context(id){
      if(!enableContextHandles||methodRestored||propertyRestored||accessors.some(a=>a.restored)||epochListeners.some(l=>l.removed))
        throw Error('field context observer: context handles inactive');
      if(!Number.isSafeInteger(id)||id<1||contexts.size!==1||!contexts.has(id))throw Error('field context observer: exact unique registered context required');
      const gl=contexts.get(id);assertFieldOwned(gl);return gl;
    },
    read(){
      const states=[];
      observed(()=>{
        if(observeEpochs)assertFieldOwned();
        if(Object.getOwnPropertyDescriptor(window,'__allocation')?.value!==allocation||allocation.peek!==peek)throw Error('allocation ownership changed');
        for(const[id,gl]of contexts){if(observeEpochs)assertFieldOwned(gl);states.push({id,retained:Reflect.apply(peek,allocation,[gl])});}
      });
      return {enabled:true,receipts:structuredClone(receipts),states,observerFailureCount:failures,
        observerErrors:structuredClone(errors),overflow,ignored,restored:methodRestored&&propertyRestored&&accessors.every(a=>a.restored)&&epochListeners.every(l=>l.removed),
        epochCapture:observeEpochs,epochs:structuredClone(epochs),setterAttempts,setterCompletions,
        coverage:observeSurfaces?'acquisition and synchronous native width/height setter boundaries only; other mutation and restoration paths unproved':
          'acquisition and retained records only; default-only startup and unsampled resize unproved'};
    },
    restore(){
      const failed=[];
      for(const listener of epochListeners)if(!listener.removed){
        try{Reflect.apply(removeEpoch,window,[listener.type,onEpoch,epochOptions]);listener.removed=true;}
        catch{failed.push('epoch listener removal failed');}
      }
      for(const {canvas,loss}of lossListeners)canvas.removeEventListener('webglcontextlost',loss);
      if(!methodRestored){
        if(!matches(Object.getOwnPropertyDescriptor(proto,'getContext'),installedDescriptor))failed.push('foreign canvas descriptor');
        else{if(original)Object.defineProperty(proto,'getContext',original);else delete proto.getContext;methodRestored=true;}
      }
      for(const a of accessors)if(!a.restored){
        if(!matches(Object.getOwnPropertyDescriptor(proto,a.name),a.installed))failed.push('foreign canvas '+a.name+' descriptor');
        else{if(a.descriptor)Object.defineProperty(proto,a.name,a.descriptor);else delete proto[a.name];a.restored=true;}
      }
      if(!propertyRestored){
        if(!matches(Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),installedProperty))failed.push('foreign observation owner');
        else{if(prior)Object.defineProperty(window,'__fieldContextObservation',prior);else delete window.__fieldContextObservation;propertyRestored=true;}
      }
      if(failed.length){failures++;throw Error('field context observer: '+failed.join('; '));}
    },
  });
  Object.defineProperty(proto,'getContext',{value:wrapped,writable:original?.writable??true,
    enumerable:original?.enumerable??true,configurable:original?.configurable??true});
  installedDescriptor=Object.getOwnPropertyDescriptor(proto,'getContext');
  try{
    for(const a of accessors){
      const set=function(value){const gl=canvasContexts.get(this);
        if(gl)setterAttempts++;
        if(gl)observeSurface(this,gl,a.name+'-before');
        let result;
        try{result=Reflect.apply(a.nativeDescriptor.set,this,[value]);}catch(error){
          if(gl)observed(()=>Reflect.apply(surfaceFailure,allocation,[gl,'native canvas '+a.name+' setter threw']));
          throw error;
        }
        if(gl){setterCompletions++;observeSurface(this,gl,a.name+'-after');}return result;
      };
      Object.defineProperty(proto,a.name,{get:a.nativeDescriptor.get,set,enumerable:a.nativeDescriptor.enumerable,configurable:true});
      a.installed=Object.getOwnPropertyDescriptor(proto,a.name);
    }
    Object.defineProperty(window,'__fieldContextObservation',{value:observer,writable:false,configurable:true});
    installedProperty=Object.getOwnPropertyDescriptor(window,'__fieldContextObservation');
    if(observeEpochs)for(const type of ['webglcontextlost','webglcontextrestored']){
      epochListeners.push({type,removed:false});Reflect.apply(addEpoch,window,[type,onEpoch,epochOptions]);
    }
  }
  catch(error){let cleanupError;
    for(const listener of epochListeners)try{Reflect.apply(removeEpoch,window,[listener.type,onEpoch,epochOptions]);}
    catch(e){cleanupError ||= e;}
    if(installedProperty){
      if(matches(Object.getOwnPropertyDescriptor(window,'__fieldContextObservation'),installedProperty)){
        if(prior)Object.defineProperty(window,'__fieldContextObservation',prior);else delete window.__fieldContextObservation;
      }else cleanupError ||= Error('foreign observation owner during installation cleanup');
    }
    if(matches(Object.getOwnPropertyDescriptor(proto,'getContext'),installedDescriptor)){
    if(original)Object.defineProperty(proto,'getContext',original);else delete proto.getContext;
  }
    for(const a of accessors)if(a.installed&&matches(Object.getOwnPropertyDescriptor(proto,a.name),a.installed)){
      if(a.descriptor)Object.defineProperty(proto,a.name,a.descriptor);else delete proto[a.name];
    }
    if(cleanupError)throw new AggregateError([error,cleanupError],'field context observer installation cleanup failed');
    throw error;}
  return observer;
}

export function installAllocationObserver(source) {
  const nativeApply=Reflect.apply;
  if(source.captureDefaultSurfaces===true&&(source.nativeJournal!==true||source.captureNativeFailures!==true))
    throw Error('allocation: default surface capture requires native journal and failed-call capture');
  const Ledger=(0,eval)('('+source.ledger+')'),mips=(0,eval)('('+source.mips+')'),Peak=(0,eval)('('+source.reservationPeak+')');
  const wrappers=[],prior=Object.getOwnPropertyDescriptor(window,'__allocation');let observer,installed=false,restored=false,installedAllocationDescriptor;
  const matches=(a,b)=>['value','get','set','writable','enumerable','configurable'].every(k=>a?.[k]===b?.[k]);
  const restore=()=>{
    if(restored)return;
    let failure;
    for(const {proto,name,descriptor,installedDescriptor}of [...wrappers].reverse()){
      if(!matches(Object.getOwnPropertyDescriptor(proto,name),installedDescriptor)){failure ||= new Error('allocation: wrapper ownership changed');continue;}
      if(descriptor)Object.defineProperty(proto,name,descriptor);else delete proto[name];
    }
    if(installed){
      if(!matches(Object.getOwnPropertyDescriptor(window,'__allocation'),installedAllocationDescriptor))failure ||= new Error('allocation: observer ownership changed');
      else if(prior)Object.defineProperty(window,'__allocation',prior);else delete window.__allocation;
    }
    if(failure)throw failure;restored=true;
  };
  const contexts=new WeakMap();let nativeFailureObserverFailures=0;
  const failureMetadata=error=>{
    const type=typeof error,primitive=error===null||['string','number','boolean','undefined'].includes(type);
    let unavailable=!primitive&&type!=='object';
    const out={type,value:primitive?error??null:null};
    if(type==='number'&&!Number.isFinite(error)||type==='string'&&error.length>16384){out.value=null;unavailable=true;}
    for(const key of ['name','message','stack']){const value=error?.[key];
      out[key]=typeof value==='string'&&value.length<=16384?value:null;
      if(value!==undefined&&value!==null&&(typeof value!=='string'||value.length>16384))unavailable=true;
    }
    return {...out,metadataUnavailable:unavailable};
  };
  const surfaceEvent=(s,event)=>{
    if(s.defaultEvents.length>=16384){unknown(s,'default surface journal limit');return;}
    s.defaultEvents.push({sequence:s.defaultEvents.length+1,nativeCallOrdinal:s.nativeCallOrdinal||0,
      nativeEventsEnd:s.nativeEvents.length,...event});
  };
  const sample=(gl,s,bytes=s.ledger.bytes,options={})=>{
    if(s.surfaceLost)return s.gpu.current;
    const attributes=gl.getContextAttributes();
    // Actual loss returns null attributes. Retain the last conservative surface cost;
    // disposal calls still retire known owners, without inventing a completed fence.
    if(attributes===null&&gl.isContextLost?.()){
      if(s.surfaceRegistered){s.surfaceLost=true;unknown(s,'default surface unavailable during loss');}
      return s.gpu.current;
    }
    const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    if(s.surfaceRegistered){
      if(!attributes||typeof attributes.depth!=='boolean'||typeof attributes.stencil!=='boolean'
        ||![width,height,bytes].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('default surface dimensions/attributes unavailable');
      if(options.width!==undefined&&(width!==options.width||height!==options.height))
        throw Error('default surface drawing dimensions differ from applied canvas');
      if(!options.generation&&s.gpu.dimensions&&s.gpu.dimensions!==`${width}:${height}`)
        unknown(s,'unobserved default surface dimension change');
    }
    const current=s.gpu.sample(bytes,width,height,attributes,options.generation===true);
    if(s.surfaceRegistered)surfaceEvent(s,{kind:'sample',boundary:options.boundary||'native',generation:options.generation===true,
      width,height,attributes:{depth:attributes.depth,stencil:attributes.stencil},apiBytes:bytes,
      framebuffer:s.gpu.framebuffer,pending:s.gpu.pendingFramebuffer,current,peak:s.gpu.peak,
      applied:options.width===undefined?null:[options.width,options.height]});
    s.defaultPeak=Math.max(s.defaultPeak,s.gpu.framebuffer+s.gpu.pendingFramebuffer);return current;
  };
  const state=gl=>{let s=contexts.get(gl);if(!s){s={ledger:new Ledger(),gpu:new Peak(),surfaceRegistered:false,defaultEvents:[],bufferArrays:new WeakMap(),bufferSources:new Map(),bufferIds:new Map(),bufferOwners:new Map(),nextBufferId:1,textures:new Map(),textureIds:new Map(),renderbufferIds:new Map(),nativeEvents:[],nativeFailures:[],nativeFailureCount:0,vertexArrays:new Map(),vertexArrayEvents:[],nextVertexArrayId:1,signatures:[],unknown:[],calls:{},defaultPeak:0,defaultBytes:0,defaultDimensions:''};s.ledger.onReservation=bytes=>sample(gl,s,bytes);
    if(source.nativeJournal===true)s.ledger.onEvent=(operation,event)=>journal(s,operation,event);
    contexts.set(gl,s);}return s;};
  const unknown=(s,value)=>{if(!s.unknown.includes(value))s.unknown.push(value);};
  const journal=(s,operation,event={})=>{
    if(source.nativeJournal!==true)return;
    if(s.nativeEvents.length>=16384){unknown(s,'native journal limit');return;}
    const {kind,id}=event;let nativeId=null;
    if(id){const ids=kind==='buffer'?s.bufferIds:kind==='texture'?s.textureIds:s.renderbufferIds;
      if(!ids.has(id))ids.set(id,kind==='buffer'?s.nextBufferId++:ids.size+1);nativeId=ids.get(id);}
    s.nativeEvents.push({sequence:s.nativeEvents.length+1,operation,kind:kind||null,id:nativeId,slot:event.slot??null,bytes:event.bytes??null,
      previous:event.previous??null,transient:event.transient??null,detail:event.detail?structuredClone(event.detail):null,
      overlap:event.overlap??null,call:s.activeCall||null,callOrdinal:s.nativeCallOrdinal||0,current:s.ledger.bytes,peak:s.ledger.peak});
  };
  const signature=(gl,s,id,call,raw,canonical)=>{
    if(!s.textureIds.has(id))s.textureIds.set(id,s.textureIds.size+1);
    if(s.signatures.length>=256){unknown(s,'texture signature limit');return;}
    s.signatures.push({texture:s.textureIds.get(id),call,activeUnit:gl.ACTIVE_TEXTURE===undefined?null:gl.getParameter(gl.ACTIVE_TEXTURE),raw,canonical,
      ...(source.nativeJournal===true?{nativeCall:s.activeCall,callOrdinal:s.nativeCallOrdinal}: {})});
  };
  const bpp=(gl,s,format,type)=>{
    const entries=[['R8',1],['RG8',2],['RGB8',4],['RGBA8',4],['SRGB8',4],['SRGB8_ALPHA8',4],['R16F',2],['RG16F',4],['RGB16F',8],['RGBA16F',8],
      ['R32F',4],['RG32F',8],['RGB32F',16],['RGBA32F',16],['DEPTH_COMPONENT16',4],['DEPTH_COMPONENT24',4],['DEPTH_COMPONENT32F',4],['DEPTH24_STENCIL8',4],['DEPTH32F_STENCIL8',8],['STENCIL_INDEX8',1]];
    for(const [key,n]of entries)if(gl[key]!==undefined&&format===gl[key])return n;
    if(format===gl.RGBA||format===gl.RGB)return type===gl.FLOAT?16:type===gl.HALF_FLOAT?8:4;
    if(format===gl.DEPTH_COMPONENT||format===gl.DEPTH_STENCIL)return 4;
    unknown(s,`format:${format},type:${type}`);return 64;
  };
  const texture=(gl,target)=>{
    if(target>=gl.TEXTURE_CUBE_MAP_POSITIVE_X&&target<=gl.TEXTURE_CUBE_MAP_NEGATIVE_Z)target=gl.TEXTURE_CUBE_MAP;
    const binding=target===gl.TEXTURE_2D?gl.TEXTURE_BINDING_2D:target===gl.TEXTURE_CUBE_MAP?gl.TEXTURE_BINDING_CUBE_MAP:
      target===gl.TEXTURE_3D?gl.TEXTURE_BINDING_3D:target===gl.TEXTURE_2D_ARRAY?gl.TEXTURE_BINDING_2D_ARRAY:null;
    return binding===null?null:gl.getParameter(binding);
  };
  const recordImage=(gl,args,compressed=false,volume=false)=>{
    const s=state(gl),target=args[0],level=args[1],id=texture(gl,target);
    if(!id){unknown(s,'image without bound texture');return;}
    let w,h,d=1,type,format=args[2],bytes;
    if(volume){w=args[3];h=args[4];d=args[5];type=compressed?null:args[8];}
    else if(args.length===6&&!compressed){const image=args[5];w=image.videoWidth||image.width;h=image.videoHeight||image.height;type=args[4];}
    else {w=args[3];h=args[4];type=compressed?null:args[7];}
    if(compressed){
      // Formats used by the current atlas experiment; reject unknown formats rather than claiming a scene verdict.
      if(format===0x93B0||format===0x8E8C)bytes=Math.ceil(w/4)*Math.ceil(h/4)*16*d;
      else {unknown(s,`compressed format:${format}`);bytes=w*h*d*64;}
    } else bytes=w*h*d*bpp(gl,s,format,type);
    if(![w,h,d,bytes].every(Number.isSafeInteger)){unknown(s,'invalid image dimensions');return;}
    s.ledger.reserve(id,'texture',`${target}:${level}`,bytes);
    signature(gl,s,id,compressed?'compressed image':'image',{target,level,format,w,h,d,type},{target,level,w,h,d,bytes});
    if(level===0)s.textures.set(id,{target,w,h,d,bpp:compressed?null:bpp(gl,s,format,type),immutable:false});
  };
  const wrap=(proto,name,after,observe=true)=>{
    const native=proto[name];if(typeof native!=='function')return;
    const descriptor=Object.getOwnPropertyDescriptor(proto,name);
    const wrapped=function(...args){let value;
      try{value=nativeApply(native,this,args);}catch(error){
        if(source.captureNativeFailures===true){
          let s;
          try{s=state(this);s.nativeFailureCount++;
            if(s.nativeFailures.length>=128)unknown(s,'native failure receipt limit');
            else{const info=failureMetadata(error);
              if(info.metadataUnavailable){nativeFailureObserverFailures++;unknown(s,'native failure metadata unavailable');}
              s.nativeFailures.push({sequence:s.nativeFailures.length+1,call:name,completedCallOrdinal:s.nativeCallOrdinal||0,
                nativeEventsEnd:s.nativeEvents.length,error:info});}
          }catch{nativeFailureObserverFailures++;if(s)unknown(s,'native failure observer failed');}
        }
        throw error;
      }
      const s=state(this);s.calls[name]=(s.calls[name]||0)+1;
      const priorCall=s.activeCall;s.activeCall=name;
      if(source.nativeJournal===true)s.nativeCallOrdinal=(s.nativeCallOrdinal||0)+1;
      try{if(observe)sample(this,s);after(this,args,value);if(observe)sample(this,s);}catch(error){unknown(s,`observer:${name}:${error.message}`);}finally{s.activeCall=priorCall;}return value;};
    Object.defineProperty(proto,name,{value:wrapped,writable:descriptor?.writable??true,enumerable:descriptor?.enumerable??true,configurable:descriptor?.configurable??true});
    wrappers.push({proto,name,descriptor,wrapped,installedDescriptor:Object.getOwnPropertyDescriptor(proto,name)});
  };
  try {for(const proto of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(proto,name,()=>{},false);
    if(source.captureDefaultSurfaces===true)for(const name of ['bufferSubData','texSubImage2D','texSubImage3D'])wrap(proto,name,()=>{},false);
    wrap(proto,'createVertexArray',(gl,args,value)=>{if(!value)return;const s=state(gl);if(s.vertexArrayEvents.length>=16384){unknown(s,'vertex array journal limit');return;}const id=s.nextVertexArrayId++;s.vertexArrays.set(value,{id,deleted:false});s.vertexArrayEvents.push({operation:'create',id});},false);
    wrap(proto,'deleteVertexArray',(gl,[value])=>{if(!value)return;const s=state(gl),record=s.vertexArrays.get(value);if(s.vertexArrayEvents.length>=16384){unknown(s,'vertex array journal limit');return;}s.vertexArrayEvents.push({operation:'delete',id:record?.id??null});if(record)record.deleted=true;},false);
    for(const [name,compressed,volume]of [['texImage2D',false,false],['compressedTexImage2D',true,false],['texImage3D',false,true],['compressedTexImage3D',true,true]])
      wrap(proto,name,(gl,args)=>recordImage(gl,args,compressed,volume));
    for(const volume of [false,true])wrap(proto,volume?'texStorage3D':'texStorage2D',(gl,a)=>{
      // WebIDL GLsizei conversion truncates Three's fractional log2(NPOT)+1 level argument.
      const s=state(gl),[target,rawLevels,format]=a,levels=Math.trunc(rawLevels),w=Math.trunc(a[3]),h=Math.trunc(a[4]),
        d=volume?Math.trunc(a[5]):1,id=texture(gl,target),compressed=format===0x93B0||format===0x8E8C,
        n=compressed?null:bpp(gl,s,format);
      if(!id){unknown(s,'storage without bound texture');return;}
      signature(gl,s,id,'immutable storage',{target,levels:rawLevels,w:a[3],h:a[4],d:volume?a[5]:1,format},{target,levels,w,h,d,bpp:n,compressed});
      for(const [i,m]of mips(w,h,n||1,levels).entries()) {
        const bytes=compressed?Math.ceil(m.w/4)*Math.ceil(m.h/4)*16:m.bytes;
        s.ledger.reserve(id,'texture',`${target}:${i}`,bytes*(target===gl.TEXTURE_3D?Math.max(1,d>>i):d)*(target===gl.TEXTURE_CUBE_MAP?6:1));
      }
      s.textures.set(id,{target,w,h,d,bpp:n,compressed,immutable:true});
    });
    // Subimages populate reserved immutable storage; they never allocate another mip chain.
    for(const name of ['compressedTexSubImage2D','compressedTexSubImage3D'])wrap(proto,name,()=>{});
    wrap(proto,'generateMipmap',(gl,a)=>{
      const s=state(gl),id=texture(gl,a[0]),m=s.textures.get(id);
      signature(gl,s,id,'generate mipmaps',{target:a[0]},{base:m||null});
      if(m?.immutable)return; // texStorage already reserved every level; generation changes pixels only.
      if(!m?.bpp){unknown(s,'mipmap without known base');return;}
      const targets=a[0]===gl.TEXTURE_CUBE_MAP?[0,1,2,3,4,5].map(i=>gl.TEXTURE_CUBE_MAP_POSITIVE_X+i):[m.target];
      for(const target of targets)for(const [i,l]of mips(m.w,m.h,m.bpp).entries())if(i)s.ledger.reserve(id,'texture',`${target}:${i}`,l.bytes*(m.target===gl.TEXTURE_3D?Math.max(1,m.d>>i):m.d),false);
    });
    wrap(proto,'bufferData',(gl,a)=>{
      const s=state(gl),target=a[0],bindings=[[gl.ARRAY_BUFFER,gl.ARRAY_BUFFER_BINDING],[gl.ELEMENT_ARRAY_BUFFER,gl.ELEMENT_ARRAY_BUFFER_BINDING],
        [gl.COPY_READ_BUFFER,gl.COPY_READ_BUFFER_BINDING],[gl.COPY_WRITE_BUFFER,gl.COPY_WRITE_BUFFER_BINDING],[gl.PIXEL_PACK_BUFFER,gl.PIXEL_PACK_BUFFER_BINDING],
        [gl.PIXEL_UNPACK_BUFFER,gl.PIXEL_UNPACK_BUFFER_BINDING],[gl.UNIFORM_BUFFER,gl.UNIFORM_BUFFER_BINDING],[gl.TRANSFORM_FEEDBACK_BUFFER,gl.TRANSFORM_FEEDBACK_BUFFER_BINDING]];
      const binding=bindings.find(([t])=>t!==undefined&&t===target)?.[1],id=binding===undefined?null:gl.getParameter(binding);
      if(!id){unknown(s,`unknown buffer target:${target}`);return;}
      const data=a[1],element=data?.BYTES_PER_ELEMENT||1,bytes=typeof data==='number'?data:a[4]?a[4]*element:(data?.byteLength||0)-(a[3]||0)*element;
      const oldBucket=s.bufferSources.get(id);oldBucket?.delete(id);
      s.bufferSources.delete(id);s.bufferOwners.delete(id);
      s.ledger.reserve(id,'buffer',0,bytes);
      if(!s.bufferIds.has(id))s.bufferIds.set(id,s.nextBufferId++);
      if(ArrayBuffer.isView(data)){let ids=s.bufferArrays.get(data);if(!ids){ids=new Set();s.bufferArrays.set(data,ids);}ids.add(id);s.bufferSources.set(id,ids);}
    });
    for(const multisample of [false,true])wrap(proto,multisample?'renderbufferStorageMultisample':'renderbufferStorage',(gl,a)=>{
      const s=state(gl),offset=multisample?1:0,samples=multisample?Math.max(1,a[1]):1,id=gl.getParameter(gl.RENDERBUFFER_BINDING);
      if(!id){unknown(s,'storage without bound renderbuffer');return;}
      s.ledger.reserve(id,'renderbuffer',0,a[2+offset]*a[3+offset]*bpp(gl,s,a[1+offset])*samples,true,
        {format:a[1+offset],width:a[2+offset],height:a[3+offset],samples});
    });
    for(const [name,kind]of [['deleteTexture','texture'],['deleteBuffer','buffer'],['deleteRenderbuffer','renderbuffer']])
      wrap(proto,name,(gl,a)=>{const s=state(gl);s.ledger.retire(a[0]);if(kind==='texture')s.textures.delete(a[0]);});
    wrap(proto,'finish',gl=>{const s=state(gl);if(gl.isContextLost?.())return;journal(s,'finish');s.ledger.sync();s.gpu.finish();
      if(s.surfaceRegistered)surfaceEvent(s,{kind:'finish'});
      for(const id of s.bufferIds.keys())if(!s.ledger.objects.has(id)){
      s.bufferSources.get(id)?.delete(id);s.bufferSources.delete(id);s.bufferOwners.delete(id);s.bufferIds.delete(id);
    }});
  }
  observer={restore,assertOwned(gl){
    if(restored||!matches(Object.getOwnPropertyDescriptor(window,'__allocation'),installedAllocationDescriptor)
      ||wrappers.some(w=>!matches(Object.getOwnPropertyDescriptor(w.proto,w.name),w.installedDescriptor)))
      throw Error('allocation: observer/wrapper ownership changed');
    if(gl){
      const names=new Set(wrappers.filter(w=>Object.prototype.isPrototypeOf.call(w.proto,gl)).map(w=>w.name));
      for(const name of names){let owner=gl,descriptor;
        while(owner&&!(descriptor=Object.getOwnPropertyDescriptor(owner,name)))owner=Object.getPrototypeOf(owner);
        const expected=wrappers.find(w=>w.proto===owner&&w.name===name);
        if(!expected||!matches(descriptor,expected.installedDescriptor))throw Error('allocation: context wrapper shadowed');
      }
    }
    return true;
  },nativeCalls(gl){return {...state(gl).calls};},defaultSurfaceCapture:source.captureDefaultSurfaces===true,
  surfaceFailure(gl,reason,lost=false){if(source.captureDefaultSurfaces!==true)throw Error('allocation: default surface capture disabled');
    const s=state(gl);if(lost===true)s.surfaceLost=true;unknown(s,typeof reason==='string'?reason:'default surface observer failed');
  },
  surfaceBoundary(gl,{boundary,width,height}){
    if(source.captureDefaultSurfaces!==true)throw Error('allocation: default surface capture disabled');
    const s=state(gl);
    try{
      if(!['creation','width-before','width-after','height-before','height-after'].includes(boundary)
        ||![width,height].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('invalid default surface boundary');
      if(boundary==='creation'){
        if(s.surfaceRegistered||s.gpu.dimensions||Object.keys(s.calls).length)throw Error('default surface registered late/duplicate');
        s.surfaceRegistered=true;
      }else if(!s.surfaceRegistered)throw Error('default surface creation missing');
      sample(gl,s,s.ledger.bytes,{boundary,width,height,generation:boundary.endsWith('-after')});
    }catch(error){unknown(s,'default surface boundary failed');throw error;}
  },
  // Retained data only. Reading an unseen/lost context never creates state or calls GL.
  peek(gl){const s=contexts.get(gl);
    if(!s)return {observed:false,observerFailureCount:nativeFailureObserverFailures};
    return {observed:true,sampled:s.gpu.dimensions!=='',...s.ledger.snapshot(),
      gpuCurrent:s.gpu.current,gpuPeak:s.gpu.peak,defaultFramebuffer:s.gpu.framebuffer,
      pendingDefaultFramebuffer:s.gpu.pendingFramebuffer,sampledDimensions:s.gpu.dimensions,
      unknown:[...s.unknown],calls:{...s.calls},signatures:structuredClone(s.signatures),nativeEvents:structuredClone(s.nativeEvents),
      nativeFailureCapture:source.captureNativeFailures===true,nativeFailureCount:s.nativeFailureCount,
      nativeFailures:structuredClone(s.nativeFailures),observerFailureCount:nativeFailureObserverFailures,
      defaultSurfaceCapture:source.captureDefaultSurfaces===true,surfaceRegistered:s.surfaceRegistered,defaultEvents:structuredClone(s.defaultEvents),
      epochUploadMethods:wrappers.filter(w=>['bufferSubData','texSubImage2D','texSubImage3D'].includes(w.name)
        &&Object.prototype.isPrototypeOf.call(w.proto,gl)).map(w=>w.name).filter((name,i,a)=>a.indexOf(name)===i).sort(),
      limits:{nativeEvents:16384,signatures:256,nativeFailures:128,defaultEvents:16384},
      bufferSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='buffer').map(([id,r])=>({id:s.bufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id),owners:[...s.bufferOwners.get(id)||[]]})),
      textureSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='texture').map(([id,r])=>({texture:s.textureIds.get(id),slots:Object.fromEntries(r.slots),pendingDelete:s.ledger.retired.has(id)})),
      renderbufferSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='renderbuffer').map(([id,r])=>({id:s.renderbufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id)})),
      coverage:s.surfaceRegistered?'retained calls plus synchronous creation/width/height evidence; other mutation and restoration epochs unproved':
        'retained sampled calls only; default-only startup and unsampled resize unproved'};
  },
  // Read retained records only, including while context attributes are unavailable.
  // This does not replace a full allocation sample or reset any pending/default bytes.
  nativeRetirementState(gl){const s=state(gl);return {kind:'retained native journal',...s.ledger.snapshot(),defaultFramebuffer:s.defaultBytes,gpuCurrent:s.gpu.current,
    calls:{...s.calls},nativeEvents:structuredClone(s.nativeEvents),vertexArrays:[...s.vertexArrays.values()].map(v=>({...v})),vertexArrayEvents:structuredClone(s.vertexArrayEvents),bufferSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='buffer').map(([id,r])=>({id:s.bufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id)}))};},
  textureReservation(gl,texture){const s=state(gl),r=s.ledger.objects.get(texture);if(!r||r.kind!=='texture')return null;
    return {id:s.textureIds.get(texture),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(texture)};
  },renderbufferReservation(gl,buffer){const s=state(gl),r=s.ledger.objects.get(buffer);if(!r||r.kind!=='renderbuffer')return null;
    if(!s.renderbufferIds.has(buffer))s.renderbufferIds.set(buffer,s.renderbufferIds.size+1);
    return {id:s.renderbufferIds.get(buffer),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(buffer)};
  },labelBufferOwners(gl,array,labels){
    if(!ArrayBuffer.isView(array)||!Array.isArray(labels)||!labels.length||labels.some(l=>typeof l!=='string'||!l))throw new Error('allocation: invalid buffer owner evidence');
    const s=state(gl),ids=s.bufferArrays.get(array);
    for(const id of ids||[]){if(!s.ledger.objects.has(id))continue;let owners=s.bufferOwners.get(id);if(!owners){owners=new Set();s.bufferOwners.set(id,owners);}for(const label of labels)owners.add(label);}
    return this.bufferReservations(gl,array);
  },bufferReservations(gl,array){const s=state(gl),ids=s.bufferArrays.get(array);if(!ids)return [];const rows=[];for(const id of ids){const r=s.ledger.objects.get(id);if(!r){ids.delete(id);continue;}rows.push({id:s.bufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id)});}return rows;},bufferReservation(gl,array){return this.bufferReservations(gl,array).at(-1)||null;},snapshot(gl){const s=state(gl),attrs=gl.getContextAttributes(),pixels=gl.drawingBufferWidth*gl.drawingBufferHeight;
    // Conservative two RGBA8 colour surfaces plus a 32-bit depth surface; browser/driver storage is unmeasured.
    const defaultFramebuffer=pixels*(8+(attrs.depth?4:0)+(attrs.stencil?4:0));
    const dimensions=`${gl.drawingBufferWidth}:${gl.drawingBufferHeight}`;
    sample(gl,s);
    s.defaultPeak=Math.max(s.defaultPeak,defaultFramebuffer+s.gpu.pendingFramebuffer);
    s.defaultBytes=defaultFramebuffer;s.defaultDimensions=dimensions;
    sample(gl,s);
    return {...s.ledger.snapshot(),defaultFramebuffer,defaultPeak:s.defaultPeak,framebufferAssumption:'two RGBA8 colour surfaces, 32-bit depth/stencil when enabled; no native measurement',
      gpuCurrent:s.gpu.current,gpuPeak:s.gpu.peak,
      dimensions:[gl.drawingBufferWidth,gl.drawingBufferHeight],attributes:attrs,unknown:[...s.unknown],calls:{...s.calls},signatures:structuredClone(s.signatures),
      bufferSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='buffer').map(([id,r])=>({id:s.bufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id),owners:[...s.bufferOwners.get(id)||[]]})),
      textureSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='texture').map(([id,r])=>({texture:s.textureIds.get(id),slots:Object.fromEntries(r.slots),...(source.nativeJournal===true?{pendingDelete:s.ledger.retired.has(id)}:{})})),
      ...(source.nativeJournal===true?{nativeEvents:structuredClone(s.nativeEvents),renderbufferSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='renderbuffer').map(([id,r])=>({id:s.renderbufferIds.get(id),bytes:[...r.slots.values()].reduce((a,b)=>a+b,0),pendingDelete:s.ledger.retired.has(id)}))}: {})};
  }};
  Object.defineProperty(window,'__allocation',{value:observer,writable:true,enumerable:prior?.enumerable??true,configurable:true});installed=true;
  installedAllocationDescriptor=Object.getOwnPropertyDescriptor(window,'__allocation');
  }catch(error){restore();throw error;}
}

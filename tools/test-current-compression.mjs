// CPU admission controls for the current Actions diagnostic. No encoder/browser launch or files written.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { selectPages, EXTRA_LOOK } from './bake/current-compression.mjs';
import { selectClosePages,selectHybridClosePages } from './bake/current-compression.mjs';
import { colourComposite, closeQualified,hybridQualified,validateHybridExport,QUALIFIED_HYBRID,
  validateQualifiedArtifacts,validateQualifiedZip,selectQualifiedMembers,validateQualifiedSceneInput,acquireQualifiedHybrid,
  qualifiedSceneFiles,materializeQualifiedSceneInput,installQualifiedSceneRoutes,
  FAILED_SCENE_ORIGIN,validateFailedSceneOrigin,failedSceneNames,validateSceneTransportInventory,validateSceneTransportMember,
  sceneTransportGroups,inflateFailedSceneReport,sceneTransportCRC,sceneMatrixGroups } from './bake/review-current-compression.mjs';
import {gzipSync} from 'node:zlib';
import {loaderFixture} from './atlas-loader-fixture.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import { mipBytes } from './bake/compress.mjs';
import { comparePixels } from './bake/review-compression.mjs';
function manifest(extra=false) {
  const group=tier=>({pages:[{file:`soldier_${tier}_0.png`,w:8,h:8}],frames:{stand_0_d00:{page:0,x:0,y:0,w:4,h:4}}});
  const m={tiers:{close:group('close'),field:group('field')}};
  if(extra)m.tiers.close.variants={[EXTRA_LOOK]:{...group('close'),pages:[{file:`soldier_close_${EXTRA_LOOK}_0.png`,w:8,h:8}]}};
  return m;
}
function closeManifest(){
  const m=JSON.parse(fs.readFileSync(new URL('../assets/figures/confederate-infantry/soldier.json',import.meta.url)));
  const v=structuredClone(m.tiers.close);delete v.variants;
  v.pages.forEach((p,i)=>p.file=`soldier_close_${EXTRA_LOOK}_${i}.png`);
  m.tiers.close.variants={[EXTRA_LOOK]:v};return m;
}
function qualification(){
  return {mode:'cs-close-qualification',sheets:['numbered.png'],pages:selectClosePages(closeManifest()).map(p=>({id:p.id,look:p.look,frames:p.frames.length,shownFrames:p.frames.length,
    integrity:true,controls:Object.fromEntries(['upload','rawBase','identity','missing','unsupported','WrongAlpha','DoublePremul','AutomaticSrgb'].map(k=>[k,true])),
    astcGpu:'RUN',quality:{astc:true,'astc-software':true}}))};
}
function hybridQualification(){return {...qualification(),mode:'cs-close-hybrid',pages:selectHybridClosePages(closeManifest()).map(p=>{
 const q=qualification().pages.find(q=>q.id===p.id),compressed=p.encoding==='astc4x4';return {...q,encoding:p.encoding,sourceSha256:'a'.repeat(64),sourceBound:true,
 controls:{...q.controls,...(compressed?{parser:true}:{})},quality:compressed?q.quality:{png:true},allocation:{block16:112},metadata:compressed?{astc:{adapterBytes:112}}:{}};
})};}
const fixture=loaderFixture(),astcBytes=new Uint8Array(await (await fixture.io.fetch('candidate/base-0.ktx2')).arrayBuffer());fixture.cleanup();
function exportInput(){
 const current=closeManifest();delete current.tiers.close.variants;
 for(const p of current.tiers.close.pages){p.w=8;p.h=8;}
 for(const f of Object.values(current.tiers.close.frames))Object.assign(f,{x:0,y:0,w:4,h:4,ax:2,ay:4,ox:0,oy:0,ppm:4});
 const source=structuredClone(current),extra=structuredClone(source.tiers.close);
 extra.pages.forEach((p,i)=>p.file=`soldier_close_${EXTRA_LOOK}_${i}.png`);source.tiers.close.variants={[EXTRA_LOOK]:extra};
 const manifest=structuredClone(source),files=new Map(),pages=selectHybridClosePages(source),quality=hybridQualification();
 quality.complete=quality.qualified=true;quality.fieldable=false;
 quality.toolSha='a'.repeat(40);quality.sources={US:'constructed Union source',CS:'constructed Confederate source'};
 quality.sheets=Array.from({length:76},(_,i)=>`cs-close-${String(i+1).padStart(3,'0')}.png`);
 const image=new PNG({width:8,height:8}),pngBytes=PNG.sync.write(image);
 const compression={mode:'cs-close-hybrid',fieldable:false,toolSha:quality.toolSha,sources:structuredClone(quality.sources),pages:pages.map(p=>{
  const file=p.id+(p.encoding==='png'?'-original.png':'-astc.ktx2'),input=p.encoding==='png'?pngBytes:astcBytes;
  const sha=createHash('sha256').update(pngBytes).digest('hex');files.set(file,input);
  const T=p.look==='base'?manifest.tiers.close:manifest.tiers.close.variants[p.look],index=Number(p.id.slice(-1));
  Object.assign(T.pages[index],{file,encoding:p.encoding,alpha:p.encoding==='png'?'straight-gamma-bytes':'premultiplied-gamma-bytes',bytes:input.length,mipLevels:4});
  const q=quality.pages.find(q=>q.id===p.id);Object.assign(q,{frames:p.frames.length,shownFrames:p.frames.length,sourceSha256:sha});
  return {...p,sourceSha256:sha,original:p.id+'-original.png',files:{astc:p.id+'-astc.ktx2'}};
 })};
 files.set('soldier-hybrid.json',new TextEncoder().encode(JSON.stringify(manifest)));
 return {current,source,manifest,compression,quality,files};
}
function retainedMetadata(){
 const Q=QUALIFIED_HYBRID;return {run:{id:Q.run,head_sha:Q.sha,status:'completed',conclusion:'success'},artifacts:[Q.optimized,Q.review].map(s=>({id:s.id,name:s.name,size_in_bytes:s.size,expired:false,workflow_run:{id:Q.run,head_sha:Q.sha}}))};
}
function mustReject(call,pattern,message){let error;try{call();}catch(e){error=e;}assert.ok(error&&pattern.test(error.message),message);}
// Tiny stored ZIPs exercise archive selection without network, output files or retained large assets.
function archive(entries){
 const local=[],central=[];let offset=0;
 for(const {name,body='fixture',mode=0x81a4,crcWrong=false,sizeWrong=false}of entries){
  const n=Buffer.from(name),b=Buffer.from(body);let crc=0xffffffff;
  for(const byte of b){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  if(crcWrong)crc^=1;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt32LE(crc>>>0,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(sizeWrong?99000000:b.length,22);l.writeUInt16LE(n.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc>>>0,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(sizeWrong?99000000:b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);
  local.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,cd,end]);
}
const exportEntries=()=>[{name:'soldier-hybrid.json'},...Array.from({length:10},(_,i)=>({name:`cs-close-base-${i}.ktx2`}))];
function transportInput(){const r=exportInput();r.reviewFiles=new Map(['soldier-source.json','compression.json','quality.json'].map((n,i)=>[n,Buffer.from(JSON.stringify([r.source,r.compression,r.quality][i]))]));return r;}
function routeContext(failFulfill=false){
 const calls=[];let handler;return {calls,async route(pattern,h){calls.push(['route',pattern]);handler=h;},async unroute(pattern,h){assert.equal(h,handler);calls.push(['unroute',pattern]);},
 async request(url,method='GET'){const events=[];await handler({request:()=>({url:()=>url,method:()=>method}),abort:reason=>events.push(['abort',reason]),fulfill:r=>{if(failFulfill)throw Error('controlled fulfill refusal');events.push(['fulfill',r]);}});return events;}};
}
const api={select:selectPages,close:selectClosePages,hybrid:selectHybridClosePages,qualified:closeQualified,hybridQualified,composite:colourComposite,bytes:mipBytes,compare:comparePixels,export:validateHybridExport,
 metadata:validateQualifiedArtifacts,zip:validateQualifiedZip,members:selectQualifiedMembers,sceneInput:validateQualifiedSceneInput,acquire:acquireQualifiedHybrid,
 transport:qualifiedSceneFiles,materialize:materializeQualifiedSceneInput,routes:installQualifiedSceneRoutes,
 failedOrigin:validateFailedSceneOrigin,failedNames:failedSceneNames,inventory:validateSceneTransportInventory,member:validateSceneTransportMember,
 groups:sceneTransportGroups,inflate:inflateFailedSceneReport,crc:sceneTransportCRC,matrixGroups:sceneMatrixGroups};
const failedMetadata=()=>{const o=FAILED_SCENE_ORIGIN;return {run:{id:o.run,head_sha:o.sha,status:'completed',conclusion:'failure',repository:{full_name:o.repo}},artifact:{id:o.artifact,name:o.name,expired:false,size_in_bytes:o.bytes,digest:'sha256:'+o.digest,workflow_run:{id:o.run,head_sha:o.sha}}};};
const transportFixture=()=>{const names=failedSceneNames(JSON.parse(fs.readFileSync(new URL('../assets/campaign.json',import.meta.url)))),bytes=Buffer.from('abc');return {names,bytes,entries:names.map(name=>({name,bytes:3,crc32:0x352441c2,externalFileAttributes:0,generalPurposeBitFlag:0}))};};
const overflowFixture=()=>{const bytes=Buffer.from(JSON.stringify({toolSha:FAILED_SCENE_ORIGIN.sha,complete:false,withinLimit:false,cases:[],faults:[]})),gzip=gzipSync(bytes),digest=b=>createHash('sha256').update(b).digest('hex');return {bytes,gzip,stub:{toolSha:FAILED_SCENE_ORIGIN.sha,complete:false,withinLimit:false,fieldable:false,transportFailure:{bytes:bytes.length,sha256:digest(bytes),encoding:'gzip',forensicFile:'report-overflow.json.gz',compressedBytes:gzip.length,compressedSha256:digest(gzip)}}};};
const checks=[
 ['scene-matrix-groups',a=>{const entries=[{name:'phase-01.json',bytes:35000000,sha256:'a'.repeat(64)},{name:'capture.png',bytes:30000000,sha256:'b'.repeat(64)},{name:'phase-02.json',bytes:20000000,sha256:'c'.repeat(64)}],g=a.matrixGroups(entries);assert.deepEqual(g.map(g=>g.map(e=>e.name)),[['capture.png'],['phase-01.json','phase-02.json']],'scene-matrix-groups: whole original bytes below60M with exact union');}],
 ['scene-matrix-singleton',a=>{const e={name:'phase-01.json',bytes:89999999,sha256:'a'.repeat(64)},g=a.matrixGroups([e]);assert.deepEqual(g,[[e]],'scene-matrix-singleton: bounded90M phase stays whole and alone below99M reader');}],
 ['scene-matrix-group-refusal',a=>{for(const entries of [[{name:'../escape.png',bytes:1,sha256:'a'.repeat(64)}],[{name:'capture.png',bytes:60000000,sha256:'a'.repeat(64)}],[{name:'phase-01.json',bytes:90000000,sha256:'a'.repeat(64)}],[{name:'capture.png',bytes:1,sha256:'broken'}],Array.from({length:17},(_,i)=>({name:'phase-'+i+'.json',bytes:35000000,sha256:'a'.repeat(64)}))])mustReject(()=>a.matrixGroups(entries),/scene transport/,'scene-matrix-group-refusal: traversal, oversized whole file, hash and slots reject');}],
 ['scene-original-identity',a=>{const m=failedMetadata();assert.equal(a.failedOrigin(m.run,m.artifact),true,'scene-original-identity: exact failed source and digest');}],
 ['scene-original-refusal',a=>{for(const change of [m=>m.run.head_sha='b'.repeat(40),m=>m.run.conclusion='success',m=>m.artifact.digest='sha256:'+'b'.repeat(64),m=>m.artifact.size_in_bytes++,m=>m.artifact.expired=true,m=>m.run.repository.full_name='other/repo']){const m=failedMetadata();change(m);mustReject(()=>a.failedOrigin(m.run,m.artifact),/scene transport/,'scene-original-refusal: mismatched source refuses before download');}}],
 ['scene-original-names',a=>{const c=JSON.parse(fs.readFileSync(new URL('../assets/campaign.json',import.meta.url))),names=a.failedNames(c);assert.ok(names.length===146&&names.includes('chattanooga-lookout-mountain-capable-07-framed-compare-rigged-left.png')&&names.includes('shiloh-buell-attacks-unsupported-03-baked-reclamation.png'),'scene-original-names: exact144 images plus both original reports, qualified numbering retained');}],
 ['scene-original-inventory',a=>{const f=transportFixture();assert.equal(a.inventory(f.entries,f.names),true,'scene-original-inventory: complete original member identity');}],
 ['scene-original-malformed',a=>{for(const change of [e=>e[1].name=e[0].name,e=>e[1].name='../escape.png',e=>e[1].externalFileAttributes=0xa000<<16,e=>e[1].generalPurposeBitFlag=1,e=>e[1].bytes=99000000,e=>e.pop()]){const f=transportFixture();change(f.entries);mustReject(()=>a.inventory(f.entries,f.names),/scene transport/,'scene-original-malformed: duplicates/traversal/symlink/encryption/size/missing rejected');}}],
 ['scene-original-member',a=>{const f=transportFixture();assert.equal(a.member(f.bytes,f.entries[0]),createHash('sha256').update(f.bytes).digest('hex'),'scene-original-member: expanded original CRC/size/hash');assert.equal((a.crc(f.bytes.subarray(1),a.crc(f.bytes.subarray(0,1)))^0xffffffff)>>>0,0x352441c2,'scene-original-member: chunk boundaries preserve CRC');}],
 ['scene-original-crc',a=>{const f=transportFixture();f.entries[0].crc32++;mustReject(()=>a.member(f.bytes,f.entries[0]),/scene transport/,'scene-original-crc: mismatched CRC rejected');}],
 ['scene-original-size',a=>{const f=transportFixture();f.entries[0].bytes++;mustReject(()=>a.member(f.bytes,f.entries[0]),/scene transport/,'scene-original-size: mismatched expanded size rejected');}],
 ['scene-original-group-union',a=>{const f=transportFixture();f.entries.filter(e=>e.name.endsWith('.png')).forEach(e=>e.bytes=5000000);const groups=a.groups(f.entries),names=groups.flat().map(e=>e.name);assert.ok(groups.length===15&&new Set(names).size===146&&names.length===146&&groups.every(g=>g.reduce((n,e)=>n+e.bytes,0)<60000000),'scene-original-group-union: every whole original exactly once under bound');}],
 ['scene-original-group-refusal',a=>{const f=transportFixture();f.entries[2].bytes=60000000;mustReject(()=>a.groups(f.entries),/scene transport/,'scene-original-group-refusal: oversized member never altered or omitted');}],
 ['scene-original-overflow',a=>{const f=overflowFixture(),r=a.inflate(Buffer.from(JSON.stringify(f.stub)),f.gzip);assert.ok(r.bytes?.equals(f.bytes)&&r.stub.complete===false&&r.report.complete===false&&r.report.withinLimit===false,'scene-original-overflow: complete bytes and failed/incomplete state unchanged');}],
 ['scene-original-gzip-refusal',a=>{for(const change of [f=>f.stub.transportFailure.bytes=99000000,f=>f.stub.transportFailure.sha256='b'.repeat(64),f=>f.stub.transportFailure.compressedSha256='b'.repeat(64),f=>f.gzip=f.gzip.subarray(1)]){const f=overflowFixture();change(f);mustReject(()=>a.inflate(Buffer.from(JSON.stringify(f.stub)),f.gzip),/scene transport/,'scene-original-gzip-refusal: expansion/hash/compressed corruption refused');}}],
 ['transport-files',a=>{const r=transportInput(),files=a.transport(r);assert.equal(files.size,14,'transport-files: exact optimized plus review set');for(const [name,f]of files)assert.deepEqual(f.bytes,Buffer.from(r.files.get(name)||r.reviewFiles.get(name)),'transport-files: retained byte identity');r.files.get('soldier-hybrid.json')[0]^=1;assert.notEqual(files.get('soldier-hybrid.json').bytes[0],r.files.get('soldier-hybrid.json')[0],'transport-files: independent bytes');}],
 ...Object.entries({'transport-review-missing':r=>r.reviewFiles.delete('quality.json'),'transport-review-extra':r=>r.reviewFiles.set('extra.json',Buffer.from('{}')),'transport-review-bytes':r=>r.reviewFiles.set('quality.json',Buffer.from('{}'))}).map(([name,change])=>[name,a=>{const r=transportInput();change(r);let e;try{a.transport(r);}catch(x){e=x;}assert.ok(e?.message.startsWith('scene transport:'),`${name}: selected review bytes bound to parsed reports`);}]),
 ['transport-actions',a=>{const prior=process.env.GITHUB_ACTIONS;delete process.env.GITHUB_ACTIONS;let e;try{a.materialize(transportInput());}catch(x){e=x;}finally{if(prior!==undefined)process.env.GITHUB_ACTIONS=prior;}assert.ok(e?.message==='scene transport: Actions only','transport-actions: no local materialization');}],
 ['transport-provenance',a=>{const prior=process.env.GITHUB_ACTIONS;process.env.GITHUB_ACTIONS='true';let e;try{a.materialize(transportInput());}catch(x){e=x;}finally{if(prior!==undefined)process.env.GITHUB_ACTIONS=prior;else delete process.env.GITHUB_ACTIONS;}assert.ok(e?.message==='scene transport: acquired byte provenance','transport-provenance: a parser-valid fixture cannot bypass immutable acquisition');}],
 ['transport-route',async a=>{const files=qualifiedSceneFiles(transportInput()),ctx=routeContext(),r=await a.routes(ctx,'http://localhost:1234',files);const events=await ctx.request(r.base+'soldier-hybrid.json');assert.ok(events.length===1&&events[0][0]==='fulfill'&&events[0][1].status===200,'transport-route: exact native request served');assert.ok(Buffer.from(events[0][1].body).equals(files.get('soldier-hybrid.json').bytes),'transport-route: original bytes served');assert.ok(r.requests[0].served&&r.requests[0].sha256===files.get('soldier-hybrid.json').sha256,'transport-route: actual request receipt');await r.restore();await r.restore();assert.equal(ctx.calls.filter(c=>c[0]==='unroute').length,1,'transport-route: exact owned handler restored once');}],
 ...Object.entries({'transport-route-missing':f=>f.delete('quality.json'),'transport-route-extra':f=>f.set('extra.json',f.get('quality.json')),'transport-route-foreign':f=>{f.set('../quality.json',f.get('quality.json'));f.delete('quality.json');},'transport-route-bytes':f=>f.get('quality.json').bytes[0]^=1}).map(([name,change])=>[name,async a=>{const f=qualifiedSceneFiles(transportInput());change(f);let e;try{await a.routes(routeContext(),'http://localhost:1234',f);}catch(x){e=x;}assert.ok(e?.message.startsWith('scene transport:'),`${name}: invalid route table rejected before registration`);}]),
 ['transport-route-refusal',async a=>{const f=qualifiedSceneFiles(transportInput()),ctx=routeContext(),r=await a.routes(ctx,'http://localhost:1234',f);for(const [url,method]of [[r.base+'other.png','GET'],[r.base+'quality.json?alias=1','GET'],[r.base+'quality.json','POST'],['http://foreign/__scene-qualified/quality.json','GET']]){const events=await ctx.request(url,method);assert.equal(events[0]?.[0],'abort','transport-route-refusal: foreign name URL or method cannot serve bytes');}assert.equal(r.requests.length,4,'transport-route-refusal: attempted IO retained');await r.restore();}],
 ['transport-route-late-mutation',async a=>{const f=qualifiedSceneFiles(transportInput()),ctx=routeContext(),r=await a.routes(ctx,'http://localhost:1234',f);f.get('quality.json').bytes[0]^=1;const events=await ctx.request(r.base+'quality.json');assert.equal(events[0]?.[0],'abort','transport-route-late-mutation: changed bytes cannot be served after admission');await r.restore();}],
 ['transport-route-mime',async a=>{const f=qualifiedSceneFiles(transportInput());f.get('quality.json').contentType='image/png';let e;try{await a.routes(routeContext(),'http://localhost:1234',f);}catch(x){e=x;}assert.ok(e?.message==='scene transport: route files','transport-route-mime: MIME binds the admitted extension');}],
 ['transport-route-rehashed-replacement',async a=>{const f=qualifiedSceneFiles(transportInput()),ctx=routeContext(),r=await a.routes(ctx,'http://localhost:1234',f),bytes=Buffer.from('{}');f.set('quality.json',{bytes,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'application/json'});const events=await ctx.request(r.base+'quality.json');assert.equal(events[0]?.[0],'abort','transport-route-rehashed-replacement: a caller cannot replace admitted identity');await r.restore();}],
 ['transport-route-added-name',async a=>{const f=qualifiedSceneFiles(transportInput()),ctx=routeContext(),r=await a.routes(ctx,'http://localhost:1234',f);f.set('not-admitted.png',{...f.get('quality.json'),contentType:'image/png'});const events=await ctx.request(r.base+'not-admitted.png');assert.equal(events[0]?.[0],'abort','transport-route-added-name: registered allowlist cannot grow');await r.restore();}],
 ['transport-route-fulfill-failure',async a=>{const f=qualifiedSceneFiles(transportInput()),ctx=routeContext(true),r=await a.routes(ctx,'http://localhost:1234',f);let e;try{await ctx.request(r.base+'quality.json');}catch(x){e=x;}assert.ok(e?.message==='controlled fulfill refusal'&&r.requests.length===1&&r.requests[0].served===false&&r.requests[0].failure===e.message,'transport-route-fulfill-failure: rejected fulfillment is retained as failure');await r.restore();}],
 ['acquisition-metadata',a=>{const m=retainedMetadata();assert.equal(a.metadata(m.run,m.artifacts),true,'acquisition-metadata: retained successful run and both artifacts');}],
 ...Object.entries({
  'acquisition-run':m=>m.run.id++, 'acquisition-sha':m=>m.run.head_sha='b'.repeat(40),
  'acquisition-status':m=>m.run.status='in_progress','acquisition-conclusion':m=>m.run.conclusion='failure',
  'acquisition-id':m=>m.artifacts[0].id++, 'acquisition-name':m=>m.artifacts[0].name='other',
  'acquisition-expiry':m=>m.artifacts[0].expired=true,'acquisition-size':m=>m.artifacts[0].size_in_bytes++,
  'acquisition-artifact-run':m=>m.artifacts[0].workflow_run.id++, 'acquisition-artifact-sha':m=>m.artifacts[0].workflow_run.head_sha='b'.repeat(40),
  'acquisition-duplicate':m=>m.artifacts[1]=structuredClone(m.artifacts[0]),
 }).map(([name,change])=>[name,a=>{const m=retainedMetadata();change(m);mustReject(()=>a.metadata(m.run,m.artifacts),/hybrid acquisition/,`${name}: mismatched retained identity rejected`);}]),
 ['acquisition-zip',a=>{const b=Buffer.from('downloaded bytes'),spec={size:b.length,digest:createHash('sha256').update(b).digest('hex')};assert.equal(a.zip(b,spec),true,'acquisition-zip: actual downloaded hash passes');b[0]^=1;mustReject(()=>a.zip(b,spec),/ZIP identity/,'acquisition-zip: changed payload rejected despite unchanged metadata');mustReject(()=>a.zip(b,QUALIFIED_HYBRID.review),/ZIP identity/,'acquisition-zip: swapped archive rejected');}],
 ['acquisition-before-download',async a=>{const m=retainedMetadata();m.run.conclusion='failure';let downloads=0;let error;try{await a.acquire({}, {json:async endpoint=>endpoint.startsWith('runs/')?m.run:m.artifacts.find(x=>endpoint===`artifacts/${x.id}`),zip:async()=>{downloads++;throw Error('unexpected download');}});}catch(e){error=e;}assert.ok(error?.message.includes('qualification run')&&downloads===0,'acquisition-before-download: metadata refusal precedes ZIP IO');}],
 ['acquisition-before-extraction',async a=>{const m=retainedMetadata();const downloads=[];let error;try{await a.acquire({}, {json:async endpoint=>endpoint.startsWith('runs/')?m.run:m.artifacts.find(x=>endpoint===`artifacts/${x.id}`),zip:async id=>{downloads.push(id);return Buffer.from('invalid archive');}});}catch(e){error=e;}assert.ok(error?.message.includes('ZIP identity')&&JSON.stringify(downloads)===JSON.stringify([QUALIFIED_HYBRID.optimized.id]),'acquisition-before-extraction: wrapper binds downloaded digest before second IO or extraction');}],
 ['acquisition-members',async a=>{const files=await a.members(archive(exportEntries()),'optimized');assert.equal(files.size,11,'acquisition-members: exact eleven files');const r=await a.members(archive([{name:'soldier-source.json'},{name:'compression.json'},{name:'quality.json'},{name:'cs-close-001.png',crcWrong:true}]),'review');assert.equal(r.size,3,'acquisition-members: review PNG is never inflated or CRC-read');}],
 ...Object.entries({
  'acquisition-missing-member':e=>e.pop(),'acquisition-extra-member':e=>e.push({name:'extra.txt'}),
  'acquisition-duplicate-member':e=>e.push({...e[0]}),'acquisition-traversal':e=>e[0].name='../soldier-hybrid.json',
  'acquisition-absolute':e=>e[0].name='/soldier-hybrid.json','acquisition-backslash':e=>e[0].name='folder\\soldier-hybrid.json',
  'acquisition-symlink':e=>e[0].mode=0xa1ff,'acquisition-crc':e=>e[0].crcWrong=true,'acquisition-expansion':e=>e[0].sizeWrong=true,
 }).map(([name,change])=>[name,async a=>{const e=exportEntries();change(e);let error;try{await a.members(archive(e),'optimized');}catch(x){error=x;}assert.ok(error,`${name}: invalid selected archive refused`);}]),
 ['acquisition-truncated',async a=>{let error;try{await a.members(archive(exportEntries()).subarray(0,50),'optimized');}catch(x){error=x;}assert.ok(error,'acquisition-truncated: short ZIP refused');}],
 ['acquisition-report-source',a=>{const r=exportInput();mustReject(()=>a.sceneInput(r),/report source/,'acquisition-report-source: matching unretained report pair refused');}],
 ['acquisition-fixed-bytes',a=>{const r=exportInput();r.compression.toolSha=r.quality.toolSha=QUALIFIED_HYBRID.sha;mustReject(()=>a.sceneInput(r),/exact close allocation/,'acquisition-fixed-bytes: valid synthetic export is not retained full allocation');}],
 ['export-coverage',a=>{assert.deepEqual(a.export(exportInput()),{files:11,astc:8,png:2,frames:576,closeGpuBytes:1576},'export-coverage: actual containers, original PNGs and every source frame');}],
 ...Object.entries({
  'export-evidence':r=>r.quality.qualified=false,
  'export-frame':r=>Object.values(r.manifest.tiers.close.variants[EXTRA_LOOK].frames)[0].ax++,
  'export-current':r=>r.current.tiers.close.pages[0].w=16,
  'export-hash':r=>{const f=r.manifest.tiers.close.pages[4].file,b=new Uint8Array(r.files.get(f));b[b.length-1]^=1;r.files.set(f,b);},
  'export-container':r=>{const f=r.manifest.tiers.close.pages[0].file;r.files.set(f,new Uint8Array(8));r.manifest.tiers.close.pages[0].bytes=8;},
  'export-extra':r=>r.files.set('unexpected.ktx2',astcBytes),
  'export-look':r=>{r.source.tiers.close.variants.third=structuredClone(r.source.tiers.close.variants[EXTRA_LOOK]);r.manifest.tiers.close.variants.third=structuredClone(r.manifest.tiers.close.variants[EXTRA_LOOK]);},
  'export-reserved-look':r=>{r.source.tiers.close.variants.base=structuredClone(r.source.tiers.close.variants[EXTRA_LOOK]);r.manifest.tiers.close.variants.base=structuredClone(r.manifest.tiers.close.variants[EXTRA_LOOK]);},
  'export-sheets':r=>r.quality.sheets[75]=r.quality.sheets[0],
  'export-provenance':r=>r.quality.toolSha='b'.repeat(40),
 }).map(([name,change])=>[name,a=>{const r=exportInput();change(r);r.files.set('soldier-hybrid.json',new TextEncoder().encode(JSON.stringify(r.manifest)));let error;try{a.export(r);}catch(e){error=e;}assert.ok(error,`${name}: corrupt or unbound export refused`);}]),
 ['hybrid-route',a=>{const pages=a.hybrid(closeManifest());assert.equal(pages.filter(p=>p.encoding==='astc4x4').length,8,'hybrid-route: eight compressed pages');assert.deepEqual(pages.filter(p=>p.encoding==='png').map(p=>p.id),[`cs-close-base-4`,`cs-close-${EXTRA_LOOK}-4`],'hybrid-route: both short originals retained');assert.deepEqual(pages.map(({encoding,...p})=>p),selectClosePages(closeManifest()),'hybrid-route: no metadata or frame changes');}],
 ['hybrid-evidence',a=>{assert.ok(a.hybridQualified(hybridQualification()),'hybrid-evidence: complete mixed qualification');for(const change of [r=>r.pages.pop(),r=>r.pages[0].encoding='png',r=>r.pages[0].sourceBound=false,r=>r.pages[0].sourceSha256='bad',r=>r.pages[0].controls.parser=false,r=>r.pages[0].metadata.astc.adapterBytes=0,r=>r.pages[0].astcGpu='UNRUN',r=>r.pages[0].quality.astc=false,r=>r.pages[4].quality.png=false,r=>r.pages[0].shownFrames--,r=>r.sheets=[]]){const r=hybridQualification();change(r);assert.ok(!a.hybridQualified(r),'hybrid-evidence: missing parser/GPU/hash/quality/frame evidence refused');}}],
  ['all-close-frames',a=>{
    const m=closeManifest(),pages=a.close(m);
    assert.equal(pages.length,10,'all-close-frames: ten full pages');
    for(const look of ['base',EXTRA_LOOK]){
      const frames=pages.filter(p=>p.look===look).flatMap(p=>p.frames);
      const source=look==='base'?m.tiers.close:m.tiers.close.variants[look];
      assert.equal(frames.length,288,'all-close-frames: every frame and direction included');
      assert.deepEqual(Object.fromEntries(frames),source.frames,'all-close-frames: rectangles, anchors and scale preserved');
    }
  }],
  ['close-rejects',a=>{
    for(const change of [m=>delete m.tiers.close.variants[EXTRA_LOOK],m=>m.tiers.close.pages.pop(),
      m=>Object.values(m.tiers.close.frames)[0].page=5,m=>Object.values(m.tiers.close.frames)[0].ax=NaN]){
      const m=closeManifest();change(m);let e;try{a.close(m);}catch(x){e=x;}assert.ok(e,'close-rejects: missing page/look, orphan frame and broken anchor cannot qualify');
    }
  }],
  ['qualification-evidence',a=>{
    assert.ok(a.qualified(qualification()),'qualification-evidence: complete ten-page ASTC evidence qualifies');
    for(const change of [r=>r.pages.pop(),r=>r.pages[0].astcGpu='UNRUN',r=>r.pages[0].quality.astc=false,r=>r.pages[0].quality['astc-software']=false,
      r=>r.pages[0].controls.WrongAlpha=false,r=>r.pages[0].integrity=false,r=>r.pages[0].shownFrames--,r=>r.sheets=[],r=>r.pages[0].frames--]){
      const r=qualification();change(r);assert.ok(!a.qualified(r),'qualification-evidence: no missing, failed or unseen evidence is accepted');
    }
  }],
  ['coverage',a=>assert.deepEqual(a.select(manifest(),manifest(true)).map(p=>[p.side,p.tier,p.look]),
    [['US','close','base'],['US','field','base'],['CS','close','base'],['CS','close',EXTRA_LOOK],['CS','field','base']], 'coverage: both armies and additional Confederate close identity')],
  ['missing-look',a=>{let e;try{a.select(manifest(),manifest());}catch(x){e=x;}assert.ok(e,'missing-look: absence cannot silently omit required comparison');}],
  ['page-bounds',a=>{
    for(const file of ['../page.png','soldier_field_0.png']){const m=manifest();m.tiers.close.pages[0].file=file;let e;try{a.select(m,manifest(true));}catch(x){e=x;}assert.ok(e,'page-bounds: escape and swapped tier rejected');}
    const m=manifest();m.tiers.close.pages[0].w=4096;let e;try{a.select(m,manifest(true));}catch(x){e=x;}assert.ok(e,'page-bounds: oversized page rejected');
  }],
  ['frame-bounds',a=>{const m=manifest();m.tiers.close.frames.stand_0_d00.x=7;let e;try{a.select(m,manifest(true));}catch(x){e=x;}assert.ok(e,'frame-bounds: invalid frame cannot become comparison crop');}],
  ['complete-mips',a=>assert.deepEqual(a.bytes(8,8),{block16:112,rgba8:340,levels:4},'complete-mips: one-block tiny tails counted')],
  ['thresholds',a=>{
    const good=Buffer.from([100,80,40,128,30,50,20,255]),bad=Buffer.from(good);bad[0]=200;
    assert.ok(a.compare(good,good).ok&&!a.compare(good,bad).ok&&!a.compare(good,Buffer.alloc(8)).ok,'thresholds: identity accepted, colour and disappearance rejected');
  }],
  ['once-premultiplied',a=>{
    const f={x:0,y:0,w:1,h:1},pixels=Buffer.from([64,32,16,128]),background=[0,0,0];
    const p=PNG.sync.read(a.composite(pixels,1,1,f,0,background));
    assert.ok(p.data[0]>85&&p.data[0]<95&&p.data[3]===255,'once-premultiplied: unpremultiply before linear blend and display conversion');
  }],
];
const mutants={'scene-matrix-singleton':{matrixGroups:()=>[]},'scene-matrix-groups':{matrixGroups:()=>[]},'scene-matrix-group-refusal':{matrixGroups:()=>[]},'hybrid-route':{hybrid:selectClosePages},'hybrid-evidence':{hybridQualified:()=>true},coverage:{select:(...x)=>selectPages(...x).slice(0,4)},'missing-look':{select:()=>[]},'page-bounds':{select:()=>[]},'frame-bounds':{select:()=>[]},
  'all-close-frames':{close:m=>selectClosePages(m).map(p=>({...p,frames:p.frames.slice(0,3)}))},'close-rejects':{close:()=>[]},'qualification-evidence':{qualified:()=>true},
  'complete-mips':{bytes:()=>({block16:64,rgba8:256,levels:1})},thresholds:{compare:()=>({ok:true})},
  'once-premultiplied':{composite:()=>{const p=new PNG({width:1,height:1});p.data=Buffer.from([64,32,16,255]);return PNG.sync.write(p);}}};
Object.assign(mutants,{'scene-original-identity':{failedOrigin:()=>false},'scene-original-refusal':{failedOrigin:()=>true},
 'scene-original-names':{failedNames:()=>[]},'scene-original-inventory':{inventory:()=>false},'scene-original-malformed':{inventory:()=>true},
 'scene-original-member':{member:()=>''},'scene-original-crc':{member:()=>''},'scene-original-size':{member:()=>''},
 'scene-original-group-union':{groups:()=>[]},'scene-original-group-refusal':{groups:()=>[]},
 'scene-original-overflow':{inflate:()=>({bytes:Buffer.alloc(0)})},'scene-original-gzip-refusal':{inflate:()=>({})}});
for(const [name]of checks.filter(([name])=>name.startsWith('transport-'))){
 if(name==='transport-actions'||name==='transport-provenance')mutants[name]={materialize:()=>({})};
 else if(name.startsWith('transport-route'))mutants[name]={routes:async(context,origin,files)=>{const base=origin+'/__scene-qualified/',requests=[];await context.route(base+'**',route=>route.fulfill({status:200,body:files.get('quality.json')?.bytes}));return {base,requests,restore:async()=>{}};}};
 else mutants[name]={transport:()=>new Map()};
}
for(const [name]of checks.filter(([name])=>name.startsWith('export-')))mutants[name]={export:name==='export-coverage'?()=>({}):()=>({files:11})};
for(const [name]of checks.filter(([name])=>name.startsWith('acquisition-'))){
 if(name==='acquisition-metadata')mutants[name]={metadata:()=>false};
 else if(name==='acquisition-zip')mutants[name]={zip:()=>true};
 else if(name==='acquisition-before-download')mutants[name]={acquire:async(_,io)=>io.zip(1)};
 else if(name==='acquisition-before-extraction')mutants[name]={acquire:async()=>({})};
 else if(name==='acquisition-members')mutants[name]={members:async()=>new Map()};
 else if(name==='acquisition-report-source'||name==='acquisition-fixed-bytes')mutants[name]={sceneInput:()=>({})};
 else if(name.endsWith('member')||['acquisition-traversal','acquisition-absolute','acquisition-backslash','acquisition-symlink','acquisition-crc','acquisition-expansion','acquisition-truncated'].includes(name))mutants[name]={members:async()=>new Map()};
 else mutants[name]={metadata:()=>true};
}
for(const [,check]of checks)await check(api);
console.log(`CURRENT-COMPRESSION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let e;try{await check({...api,...mutants[name]});}catch(x){e=x;}assert.ok(e?.code==='ERR_ASSERTION'&&e.message.startsWith(name),`${name}: mutant must fail own assertion`);console.log(`CAUGHT ${name}: ${e.message.split('\n')[0]}`);}
  console.log(`CURRENT-COMPRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

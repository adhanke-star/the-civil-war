// CPU admission controls for the current Actions diagnostic. No encoder/browser launch or files written.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { selectPages, EXTRA_LOOK } from './bake/current-compression.mjs';
import { selectClosePages,selectHybridClosePages } from './bake/current-compression.mjs';
import { colourComposite, closeQualified,hybridQualified,validateHybridExport,QUALIFIED_HYBRID,
  validateQualifiedArtifacts,validateQualifiedZip,selectQualifiedMembers,validateQualifiedSceneInput,acquireQualifiedHybrid } from './bake/review-current-compression.mjs';
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
const api={select:selectPages,close:selectClosePages,hybrid:selectHybridClosePages,qualified:closeQualified,hybridQualified,composite:colourComposite,bytes:mipBytes,compare:comparePixels,export:validateHybridExport,
 metadata:validateQualifiedArtifacts,zip:validateQualifiedZip,members:selectQualifiedMembers,sceneInput:validateQualifiedSceneInput,acquire:acquireQualifiedHybrid};
const checks=[
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
const mutants={'hybrid-route':{hybrid:selectClosePages},'hybrid-evidence':{hybridQualified:()=>true},coverage:{select:(...x)=>selectPages(...x).slice(0,4)},'missing-look':{select:()=>[]},'page-bounds':{select:()=>[]},'frame-bounds':{select:()=>[]},
  'all-close-frames':{close:m=>selectClosePages(m).map(p=>({...p,frames:p.frames.slice(0,3)}))},'close-rejects':{close:()=>[]},'qualification-evidence':{qualified:()=>true},
  'complete-mips':{bytes:()=>({block16:64,rgba8:256,levels:1})},thresholds:{compare:()=>({ok:true})},
  'once-premultiplied':{composite:()=>{const p=new PNG({width:1,height:1});p.data=Buffer.from([64,32,16,255]);return PNG.sync.write(p);}}};
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

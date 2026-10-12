// CPU admission controls for the current Actions diagnostic. No encoder/browser launch or files written.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { selectPages, EXTRA_LOOK } from './bake/current-compression.mjs';
import { selectClosePages,selectHybridClosePages } from './bake/current-compression.mjs';
import { colourComposite, closeQualified,hybridQualified } from './bake/review-current-compression.mjs';
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
const api={select:selectPages,close:selectClosePages,hybrid:selectHybridClosePages,qualified:closeQualified,hybridQualified,composite:colourComposite,bytes:mipBytes,compare:comparePixels};
const checks=[
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
for(const [,check]of checks)await check(api);
console.log(`CURRENT-COMPRESSION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let e;try{await check({...api,...mutants[name]});}catch(x){e=x;}assert.ok(e?.code==='ERR_ASSERTION'&&e.message.startsWith(name),`${name}: mutant must fail own assertion`);console.log(`CAUGHT ${name}: ${e.message.split('\n')[0]}`);}
  console.log(`CURRENT-COMPRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

// CPU admission controls for the current Actions diagnostic. No encoder/browser launch or files written.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { selectPages, EXTRA_LOOK } from './bake/current-compression.mjs';
import { colourComposite } from './bake/review-current-compression.mjs';
import { mipBytes } from './bake/compress.mjs';
import { comparePixels } from './bake/review-compression.mjs';
function manifest(extra=false) {
  const group=tier=>({pages:[{file:`soldier_${tier}_0.png`,w:8,h:8}],frames:{stand_0_d00:{page:0,x:0,y:0,w:4,h:4}}});
  const m={tiers:{close:group('close'),field:group('field')}};
  if(extra)m.tiers.close.variants={[EXTRA_LOOK]:{...group('close'),pages:[{file:`soldier_close_${EXTRA_LOOK}_0.png`,w:8,h:8}]}};
  return m;
}
const api={select:selectPages,composite:colourComposite,bytes:mipBytes,compare:comparePixels};
const checks=[
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
const mutants={coverage:{select:(...x)=>selectPages(...x).slice(0,4)},'missing-look':{select:()=>[]},'page-bounds':{select:()=>[]},'frame-bounds':{select:()=>[]},
  'complete-mips':{bytes:()=>({block16:64,rgba8:256,levels:1})},thresholds:{compare:()=>({ok:true})},
  'once-premultiplied':{composite:()=>{const p=new PNG({width:1,height:1});p.data=Buffer.from([64,32,16,255]);return PNG.sync.write(p);}}};
for(const [,check]of checks)await check(api);
console.log(`CURRENT-COMPRESSION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
  for(const [name,check]of checks){let e;try{await check({...api,...mutants[name]});}catch(x){e=x;}assert.ok(e?.code==='ERR_ASSERTION'&&e.message.startsWith(name),`${name}: mutant must fail own assertion`);console.log(`CAUGHT ${name}: ${e.message.split('\n')[0]}`);}
  console.log(`CURRENT-COMPRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

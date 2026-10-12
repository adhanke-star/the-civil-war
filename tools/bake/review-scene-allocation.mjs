// Actions-only observation of current whole-scene allocations. No renderer/atlas policy is adopted by this tool.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { AllocationLedger, mipSizes, installAllocationObserver, ReservationPeak, rejectionObservation } from './scene-allocation.mjs';
import {installInactiveFigures} from './inactive-figures.mjs';
import {partitionTerrain,installTerrainPartition} from './partition-terrain.mjs';

function inventory() {
  const {scene,post,game}=window.__game,arrays=new Map(),textures=new Set();let declaredArrayBytes=0;
  const owners=new Map();for(const key of ['pools','fallen','impostors'])for(const [side,pool]of Object.entries(game[key]||{}))owners.set(pool.mesh,`${key}.${side}`);
  const array=(a,owner)=>{if(a){if(!arrays.has(a)){arrays.set(a,new Set());declaredArrayBytes+=a.byteLength;}arrays.get(a).add(owner);}};
  const attribute=(a,owner)=>array(a?.isInterleavedBufferAttribute?a.data.array:a?.array,owner);
  const texture=x=>{if(x?.isTexture)textures.add(x);else if(Array.isArray(x))x.forEach(texture);};
  for(const root of [scene,post.qScene])root.traverse(o=>{
    let ancestor=o,owner;while(ancestor&&!owner){owner=owners.get(ancestor);ancestor=ancestor.parent;}owner=`${owner||'scene'}/${o.name||o.type}${o.visible?'':'(hidden)'}`;
    const g=o.geometry;if(g){Object.values(g.attributes).forEach(a=>attribute(a,owner));attribute(g.index,owner);Object.values(g.morphAttributes).flat().forEach(a=>attribute(a,owner));}
    attribute(o.instanceMatrix,owner);attribute(o.instanceColor,owner);
    for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){
      Object.values(m).forEach(texture);Object.values(m.uniforms||{}).forEach(u=>texture(u.value));
    }
  });
  for(const atlas of Object.values(game.baked.atlases||{}))for(const pages of Object.values(atlas.textures))pages.forEach(texture);
  const renderer=post.renderer;
  for(const t of textures)if(!t.isRenderTargetTexture&&!t.isDepthTexture)renderer.initTexture(t);
  renderer.getContext().finish();
  const gl=renderer.getContext(),allocation=window.__allocation.snapshot(gl),error=gl.getError();
  const buffers=new Map(),unuploaded=[];
  for(const [array,labels]of arrays){const record=window.__allocation.bufferReservation(gl,array);if(record){if(!buffers.has(record.id))buffers.set(record.id,{...record,owners:new Set()});for(const label of labels)buffers.get(record.id).owners.add(label);}else unuploaded.push({bytes:array.byteLength,owners:[...labels]});}
  const bufferOwnership=[...buffers.values()].map(r=>({...r,owners:[...r.owners]}));
  const mappedBufferBytes=bufferOwnership.reduce((n,r)=>n+r.bytes,0);
  return {allocation,declaredArrayBytes,textureObjects:textures.size,glError:error,
    bufferOwnership,mappedBufferBytes,unmappedBufferBytes:allocation.byKind.buffer-mappedBufferBytes,unuploadedArrays:unuploaded,
    conservativeReservation:allocation.peak+allocation.defaultPeak+declaredArrayBytes,
    gpuReservation:allocation.gpuPeak,cpuDeclaredArrayBytes:declaredArrayBytes,
    accounting:'GPU: synchronized API reservations (including pending deletes, replacement overlap) + same-time default-framebuffer assumption. CPU declared arrays separate. Retained conservative upper bound adds independent maxima and deliberately double counts GL buffer arrays. Native driver pools/overhead unmeasured.',
    atlasPages:Object.fromEntries(Object.entries(game.baked.atlases||{}).map(([side,a])=>[side,Object.fromEntries(Object.entries(a.textures).map(([tier,t])=>[tier,t.length]))])),
    lens:!!post.soldierView,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio};
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
  const report={diagnosticOnly:true,fieldable:false,toolSha:process.env.GITHUB_SHA,route:'current PNG, both armies',cases:[],complete:false,
    inactivePrototype:inactive,
    terrainPartitionPrototype:partition,
    limits:{gpuBytes:250000000},nativeDriverMemory:'UNRUN',cpuDecodePeak:'UNRUN',
    unverified:['native driver storage/pools and deferred releases after context destruction','whole-fight effect maximum beyond exercised frames','future sandbox spawns beyond declared pools','CPU image decode/upload-copy peaks']};
  const source={ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()};
  const {server,url}=await startServer({port:0});let browser;
  const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  try{
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    for(const [index,entry]of campaign.phases.entries()){
      const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,reducedMotion:'reduce'});
      await ctx.addInitScript(installAllocationObserver,source);
      const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      const row={...entry,states:[],errors};report.cases.push(row);
      try{
        await page.goto(`${url}?battle=${entry.packId}&phase=${entry.phaseId}&quality=high&nosw`);
        await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
        if(await page.evaluate(()=>document.getElementById('briefing')?.open))await page.locator('#briefing-begin').click();
        await page.evaluate(async()=>{
          const {game}=window.__game;if(!game.paused)game.togglePause();
          const {set}=await import('./src/settings.js');set('look.figureStyle','baked');game.ensureBaked();
        });
        await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
        const capture=async label=>{
          const drawCalls=await page.evaluate(()=>{const {post,scene,camera}=window.__game,r=post.renderer,prior=r.info.autoReset;r.info.autoReset=false;r.info.reset();try{post.render(scene,camera);return r.info.render.calls;}finally{r.info.autoReset=prior;}});
          const data=await page.evaluate(inventory);row.states.push({label,drawCalls,...data});save();
          if(data.glError||data.allocation.unknown.length||errors.length)throw new Error(`scene allocation: ${entry.phaseId}/${label} incomplete: GL${data.glError}, ${data.allocation.unknown.join(',')}, ${errors.join(',')}`);
          console.log(entry.phaseId,label,JSON.stringify({reservation:data.conservativeReservation,...data.allocation.byKind,arrays:data.declaredArrayBytes,pages:data.atlasPages}));
        };
        await capture('field');
        if(partition){
          if(entry.phaseId==='lookout-mountain')await page.screenshot({path:path.join(out,'terrain-partition-01-before.png')});
          row.partition=await page.evaluate(async source=>{const THREE=await import('three'),P=(0,eval)('('+source.partition+')'),install=(0,eval)('('+source.install+')');return install(window.__game.world,THREE,P);},{partition:partitionTerrain.toString(),install:installTerrainPartition.toString()});
          if(!row.partition.materialShared||row.partition.triangles!==row.partition.statTriangles)throw new Error('terrain partition: material/stat seam changed');
          await capture('partition-field');
          if(entry.phaseId==='lookout-mountain'){
            await page.screenshot({path:path.join(out,'terrain-partition-02-after.png')});
            await page.mouse.move(700,300);await page.mouse.wheel(0,-400);await page.waitForTimeout(1000);await capture('partition-native-zoom');
            await page.screenshot({path:path.join(out,'terrain-partition-03-zoom.png')});
          }
        }
        if(inactive){await page.evaluate(source=>{const g=window.__game.game;g.__inactiveStats=(0,eval)('('+source+')')(g);g.animate(0);},installInactiveFigures.toString());await capture('inactive-field');}
        await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
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
        if(inactive&&entry.phaseId==='lookout-mountain'){
          await resized({width:1024,height:768});
          const transition=async(label,style,compare=false)=>{
            const state=await page.evaluate(async({style,compare})=>{
              const g=window.__game.game,S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js');
              const combat=()=>JSON.stringify({time:g.simTime,orders:g.orders,holder:g.holder,units:g.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order.type,x:u.x,z:u.z}))});
              const before=combat();C.stopCompare();S.set('look.figureStyle',style);
              if(compare){const spec=S.all().find(s=>s.key==='look.figureStyle').spec;C.startCompare('look.figureStyle',spec,style,()=>{});}
              g.animate(0);return {combatUnchanged:combat()===before,stats:{...g.__inactiveStats},procedural:g.pools.US.pushed+g.pools.CS.pushed,baked:g.impostors.US.drawn+g.impostors.CS.drawn};
            },{style,compare});
            row.transitions||=[];row.transitions.push({label,...state});if(!state.combatUnchanged)throw new Error('inactive prototype: style changed combat state');
            await capture(label);await page.screenshot({path:path.join(out,`${String(row.transitions.length).padStart(2,'0')}-${label}.png`)});
          };
          await transition('rigged-reactivation','rigged');await transition('baked-reclamation','baked');
          await transition('compare-rigged-left','rigged',true);await transition('compare-baked-left','baked',true);
          await transition('baked-restored','baked');
        }
        row.complete=true;
      } finally {await ctx.close();save();}
      console.log(`SCENE ${index+1}/${campaign.phases.length} complete`);
    }
    // Actual current loader failure: successful siblings must not masquerade as a complete close tier.
    const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2});await ctx.addInitScript(installAllocationObserver,source);
    try{
      let missingHits=0;
      await ctx.route('**/assets/figures/confederate-infantry/soldier_close_0.png',r=>{missingHits++;return r.fulfill({status:404,body:'diagnostic missing page'});});
      const page=await ctx.newPage();await page.goto(url+'?battle=stones-river&phase=dawn-on-the-right&quality=high&nosw');
      await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
      await page.evaluate(()=>window.__game.game.ensureBaked());
      await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
      const failure=await page.evaluate(async source=>{const a=window.__game.game.baked.atlases.CS,observe=(0,eval)('('+source+')');return {...await observe(()=>a.load('close')),published:!!a.textures.close,promiseCached:!!a.state.close};},rejectionObservation.toString());
      failure.missingHits=missingHits;
      report.failure={...failure,...await page.evaluate(inventory),policy:'Observed existing PNG failure only. No compressed fallback or disposal claim.'};
      if(!failure.rejected||failure.published||!missingHits)throw new Error('scene allocation: missing page control was accepted or not exercised');
    }finally{await ctx.close();save();}
    report.complete=report.cases.length===11&&report.cases.every(c=>c.complete)&&report.failure.rejected;
    report.maxReservation=Math.max(...report.cases.flatMap(c=>c.states.map(s=>s.conservativeReservation)));
    report.maxGpuReservation=Math.max(...report.cases.flatMap(c=>c.states.map(s=>s.gpuReservation)));
    report.withinLimit=report.maxGpuReservation<=report.limits.gpuBytes;
    save();console.log('SCENE-ALLOCATION COMPLETE',JSON.stringify({complete:report.complete,maxReservation:report.maxReservation,maxGpuReservation:report.maxGpuReservation,withinLimit:report.withinLimit,fieldable:false}));
    if(!report.complete)process.exitCode=1; // Budget failures are results, not a reason to discard the observation.
  }finally{save();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});

// Actions-only observation of current whole-scene allocations. No renderer/atlas policy is adopted by this tool.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { AllocationLedger, mipSizes, installAllocationObserver, ReservationPeak, rejectionObservation, reduceSceneObservations, sampleSceneAllocations, initializeSceneTextures } from './scene-allocation.mjs';
import {installInactiveFigures,installRenderGate,renderCanvasPng,restoreSceneDiagnostics} from './inactive-figures.mjs';
import {PNG} from 'pngjs';
import {partitionTerrain,installTerrainPartition} from './partition-terrain.mjs';

const inventory=sampleSceneAllocations;
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
    terrainPartitionPrototype:partition,terrainRestorationObserved:partition,
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
          await page.evaluate(initializeSceneTextures);
          const drawing=await page.evaluate(()=>{const {post,scene,camera}=window.__game,r=post.renderer,prior=r.info.autoReset;r.info.autoReset=false;r.info.reset();try{if(window.__sceneRenderGate)window.__sceneRenderGate.renderOnce(scene,camera);else post.render(scene,camera);r.getContext().finish();return {drawCalls:r.info.render.calls,nativeRenders:window.__sceneRenderGate?.count??null};}finally{r.info.autoReset=prior;}});
          const data=await page.evaluate(inventory);row.states.push({label,...drawing,...data});save();
          if(data.glError||data.allocation.unknown.length||data.unmappedBufferBytes!==0||errors.length)throw new Error(`scene allocation: ${entry.phaseId}/${label} incomplete: GL${data.glError}, unmapped ${data.unmappedBufferBytes}, ${data.allocation.unknown.join(',')}, ${errors.join(',')}`);
          console.log(entry.phaseId,label,JSON.stringify({reservation:data.conservativeReservation,...data.allocation.byKind,arrays:data.declaredArrayBytes,pages:data.atlasPages}));
        };
        const canvasShot=async filename=>{
          const shot=await page.evaluate(async source=>{
            const S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js'),{post,scene,camera,rts,game}=window.__game;
            const png=(0,eval)('('+source+')')(post,scene,camera,window.__sceneRenderGate);
            return {...png,style:S.get('look.figureStyle'),comparison:C.compareState(),simTime:game.simTime,
              camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far,goal:{...rts.goal}}};
          },renderCanvasPng.toString());
          if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(shot.dataUrl)||shot.nativeRenders!==1||shot.glError||shot.width!==shot.drawingWidth||shot.height!==shot.drawingHeight||!shot.width||!shot.height)throw new Error('scene canvas: invalid actual draw/readback metadata');
          const bytes=Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length),'base64'),png=PNG.sync.read(bytes);
          let opaque=false,nonuniform=false;for(let i=0;i<png.data.length;i+=4){if(png.data[i+3])opaque=true;for(let c=0;c<4;c++)if(png.data[i+c]!==png.data[c])nonuniform=true;}
          if(png.width!==shot.width||png.height!==shot.height||!opaque||!nonuniform)throw new Error('scene canvas: dimensions/visible/nonuniform content not proved');
          fs.writeFileSync(path.join(out,filename),bytes);delete shot.dataUrl;
          row.canvasCaptures||=[];row.canvasCaptures.push({filename,phase:entry.phaseId,toolSha:report.toolSha,...shot,bytes:bytes.length,kind:'battlefield-canvas capture; DOM HUD excluded'});save();
        };
        if((inactive||partition)&&entry.phaseId==='lookout-mountain')await page.evaluate(source=>{
          const {post,rts,game,camera}=window.__game;window.__sceneRenderGate=(0,eval)('('+source+')')(post);
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
          const transition=async(label,style,compare=false,filename=null)=>{
            const state=await page.evaluate(async({style,compare})=>{
              const g=window.__game.game,S=await import('./src/settings.js'),C=await import('./src/sandbox/compare.js');
              const combat=()=>JSON.stringify({time:g.simTime,orders:g.orders,holder:g.holder,units:g.units.map(u=>({id:u.id,men:u.men,morale:u.morale,ammo:u.ammo,state:u.state,order:u.order.type,x:u.x,z:u.z}))});
              const before=combat();C.stopCompare();S.set('look.figureStyle',style);
              if(compare){const spec=S.all().find(s=>s.key==='look.figureStyle').spec;C.startCompare('look.figureStyle',spec,style,()=>{});}
              g.setView(window.__game.camera,innerHeight*window.__game.post.scale);g.animate(0);return {combatUnchanged:combat()===before,stats:{...g.__inactiveStats},procedural:g.pools.US.pushed+g.pools.CS.pushed,baked:g.impostors.US.drawn+g.impostors.CS.drawn};
            },{style,compare});
            row.transitions||=[];row.transitions.push({label,...state});if(!state.combatUnchanged)throw new Error('inactive prototype: style changed combat state');
            await capture(label);await canvasShot(filename||`${String(row.transitions.length).padStart(2,'0')}-${label}.png`);
          };
          await transition('rigged-reactivation','rigged');
          row.lodReactivation=await page.evaluate(()=>{
            const {game:g,rts,post}=window.__game,b=g.pools.US.buckets.find(b=>b.lod===2&&!b.mesh.visible),u=g.units.find(u=>u.side==='US'&&u.type==='infantry'&&u.men>0);
            if(!b||!u)throw new Error('inactive prototype: no released near bucket/formation for reactivation control');
            const gl=post.renderer.getContext(),before=window.__allocation.bufferReservation(gl,b.mesh.instanceMatrix.array),stats={...g.__inactiveStats},goal={...rts.goal};
            window.__reactivationBucket=b;rts.flyTo(u.x,u.z,100);rts.update(1);rts.update(1);g.setView(window.__game.camera,innerHeight*post.scale);g.animate(0);
            return {before,stats,goal,nearCount:b.n,visible:b.mesh.visible,afterStats:{...g.__inactiveStats},cameraDistance:rts.dist};
          });
          await capture('near-lod-reupload');
          row.lodReactivation.after=await page.evaluate(()=>{const b=window.__reactivationBucket,gl=window.__game.post.renderer.getContext();return window.__allocation.bufferReservation(gl,b.mesh.instanceMatrix.array);});
          if(!row.lodReactivation.visible||!row.lodReactivation.nearCount||row.lodReactivation.afterStats.reactivated<=row.lodReactivation.stats.reactivated||!row.lodReactivation.after||row.lodReactivation.before?.id===row.lodReactivation.after.id)throw new Error('inactive prototype: released bucket GPU reupload not proved');
          await canvasShot('06-near-lod-reupload.png');
          await page.evaluate(goal=>{const {rts,game:g,camera,post}=window.__game;Object.assign(rts.goal,goal);rts.update(1);rts.update(1);g.setView(camera,innerHeight*post.scale);g.animate(0);},row.lodReactivation.goal);
          await transition('baked-reclamation','baked');
          await transition('compare-rigged-left','rigged',true);await transition('compare-baked-left','baked',true);
          await transition('baked-restored','baked');
          if(partition){
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
        row.complete=true;
      } finally {
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
        await ctx.close();save();
        if(!row.restoration.ok)throw new Error(`scene allocation: restoration failed: ${row.restoration.errors.join(', ')}`);
      }
      console.log(`SCENE ${index+1}/${campaign.phases.length} complete`);
    }
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
    const verdict=reduceSceneObservations(report,campaign.phases);
    Object.assign(report,verdict);
    save();console.log('SCENE-ALLOCATION COMPLETE',JSON.stringify({complete:report.complete,maxReservation:report.maxReservation,maxGpuReservation:report.maxGpuReservation,withinLimit:report.withinLimit,fieldable:false}));
    if(!report.complete)process.exitCode=1; // Budget failures are results, not a reason to discard the observation.
  }finally{save();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});

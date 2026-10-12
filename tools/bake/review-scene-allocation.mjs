// Actions-only observation of current whole-scene allocations. No renderer/atlas policy is adopted by this tool.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { AllocationLedger, mipSizes, installAllocationObserver } from './scene-allocation.mjs';

function inventory() {
  const {scene,post,game}=window.__game,arrays=new Set(),textures=new Set();let declaredArrayBytes=0;
  const array=a=>{if(a&&!arrays.has(a)){arrays.add(a);declaredArrayBytes+=a.byteLength;}};
  const attribute=a=>array(a?.isInterleavedBufferAttribute?a.data.array:a?.array);
  const texture=x=>{if(x?.isTexture)textures.add(x);else if(Array.isArray(x))x.forEach(texture);};
  for(const root of [scene,post.qScene])root.traverse(o=>{
    const g=o.geometry;if(g){Object.values(g.attributes).forEach(attribute);attribute(g.index);Object.values(g.morphAttributes).flat().forEach(attribute);}
    attribute(o.instanceMatrix);attribute(o.instanceColor);
    for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){
      Object.values(m).forEach(texture);Object.values(m.uniforms||{}).forEach(u=>texture(u.value));
    }
  });
  for(const atlas of Object.values(game.baked.atlases||{}))for(const pages of Object.values(atlas.textures))pages.forEach(texture);
  const renderer=post.renderer;
  for(const t of textures)if(!t.isRenderTargetTexture&&!t.isDepthTexture)renderer.initTexture(t);
  renderer.getContext().finish();
  const gl=renderer.getContext(),allocation=window.__allocation.snapshot(gl),error=gl.getError();
  return {allocation,declaredArrayBytes,textureObjects:textures.size,glError:error,
    conservativeReservation:allocation.peak+allocation.defaultPeak+declaredArrayBytes,
    accounting:'API reservation peak + independent default-framebuffer peak + all declared scene array bytes (including deliberate buffer double counting). Native driver pools/overhead unmeasured.',
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
  const report={diagnosticOnly:true,fieldable:false,toolSha:process.env.GITHUB_SHA,route:'current PNG, both armies',cases:[],complete:false,
    limits:{gpuBytes:250000000},nativeDriverMemory:'UNRUN',cpuDecodePeak:'UNRUN',
    unverified:['native driver storage/pools and deferred releases after context destruction','whole-fight effect maximum beyond exercised frames','future sandbox spawns beyond declared pools','CPU image decode/upload-copy peaks']};
  const source={ledger:AllocationLedger.toString(),mips:mipSizes.toString()};
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
          await page.evaluate(()=>{const {post,scene,camera}=window.__game;post.render(scene,camera);});
          const data=await page.evaluate(inventory);row.states.push({label,...data});save();
          if(data.glError||data.allocation.unknown.length||errors.length)throw new Error(`scene allocation: ${entry.phaseId}/${label} incomplete: GL${data.glError}, ${data.allocation.unknown.join(',')}, ${errors.join(',')}`);
          console.log(entry.phaseId,label,JSON.stringify({reservation:data.conservativeReservation,...data.allocation.byKind,arrays:data.declaredArrayBytes,pages:data.atlasPages}));
        };
        await capture('field');
        await page.evaluate(async()=>{await Promise.all(Object.values(window.__game.game.baked.atlases).map(a=>a.load('close')));});
        await capture('both-close-tiers');
        // Every phase exercises native depth ownership and resize, not just an assumed maximum.
        await page.evaluate(()=>{const {post,camera}=window.__game;post.beginSoldierView(camera,Math.max(camera.near+1,Math.min(camera.far-1,100)));});
        await capture('lens-depth');
        await page.setViewportSize({width:1366,height:1024});await capture('lens-resize');
        await page.evaluate(()=>window.__game.post.endSoldierView());await capture('lens-retired');
        await page.setViewportSize({width:320,height:568});await capture('narrow-resize');
        row.complete=true;
      } finally {await ctx.close();save();}
      console.log(`SCENE ${index+1}/${campaign.phases.length} complete`);
    }
    // Actual current loader failure: successful siblings must not masquerade as a complete close tier.
    const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2});await ctx.addInitScript(installAllocationObserver,source);
    try{
      await ctx.route('**/assets/figures/confederate-infantry/soldier_close_0.png',r=>r.fulfill({status:404,body:'diagnostic missing page'}));
      const page=await ctx.newPage();await page.goto(url+'?battle=stones-river&phase=dawn-on-the-right&quality=high&nosw');
      await page.waitForFunction(()=>window.__ready&&window.__game?.game,null,{timeout:180000,polling:250});
      await page.evaluate(()=>window.__game.game.ensureBaked());
      await page.waitForFunction(()=>window.__game.game.baked.state==='ready',null,{timeout:120000,polling:250});
      const failure=await page.evaluate(async()=>{const a=window.__game.game.baked.atlases.CS;let message='';try{await a.load('close');}catch(e){message=e.message;}return {rejected:!!message,message,published:!!a.textures.close,promiseCached:!!a.state.close};});
      report.failure={...failure,...await page.evaluate(inventory),policy:'Observed existing PNG failure only. No compressed fallback or disposal claim.'};
      if(!failure.rejected||failure.published)throw new Error('scene allocation: missing page control was accepted');
    }finally{await ctx.close();save();}
    report.complete=report.cases.length===11&&report.cases.every(c=>c.complete)&&report.failure.rejected;
    report.maxReservation=Math.max(...report.cases.flatMap(c=>c.states.map(s=>s.conservativeReservation)));
    report.withinLimit=report.maxReservation<=report.limits.gpuBytes;
    save();console.log('SCENE-ALLOCATION COMPLETE',JSON.stringify({complete:report.complete,maxReservation:report.maxReservation,withinLimit:report.withinLimit,fieldable:false}));
    if(!report.complete)process.exitCode=1; // Budget failures are results, not a reason to discard the observation.
  }finally{save();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});

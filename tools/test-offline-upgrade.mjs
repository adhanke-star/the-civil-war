// Actions-only actual v68 -> current worker admission. No simulated combat or old release reconstruction.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer,ROOT} from './serve.mjs';
import {createOfflineManifest,serializeOfflineManifest} from './build-offline-manifest.mjs';

if(!process.env.CI)throw Error('offline upgrade: Actions only; no local browser runs');
const OLD='9e7207982005ded754657f6cc1b319a982014a2f';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['-c','safe.directory='+realpathSync(ROOT),...args],{cwd:ROOT,encoding:'utf8',maxBuffer:8000000,timeout:60000});
const report={schema:'offline-upgrade-v1',sha:git(['rev-parse','HEAD']).trim(),old:OLD,
  run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,complete:false,checks:[],requests:[],errors:[],console:[],cleanup:[]};
const out=path.join(ROOT,'.out/offline');await fs.mkdir(out,{recursive:true});
const persist=async()=>{const bytes=JSON.stringify(report)+'\n';assert(Buffer.byteLength(bytes)<8000000);await fs.writeFile(path.join(out,'upgrade.json'),bytes);};
const check=(id,condition,detail)=>{report.checks.push({id,ok:!!condition,detail});assert(condition,id+': '+JSON.stringify(detail));};
let current,proxy,context,profile,release='old',blocked=false,origin,phase='startup',cleanupTask;
const failOnce=error=>{report.failure??=String(error?.stack??error);};
const closeServer=server=>server&&new Promise((resolve,reject)=>{
  server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());server.closeAllConnections();
});
const cleanup=()=>cleanupTask??=(async()=>{
  await Promise.all([['browser',()=>context?.close()],['proxy',()=>closeServer(proxy)],['server',()=>closeServer(current?.server)]].map(async([name,close])=>{
    const receipt={name,pending:true};report.cleanup.push(receipt);
    try{await close();receipt.ok=true;}catch(error){receipt.ok=false;receipt.error=String(error);report.complete=false;}finally{receipt.pending=false;}
  }));
})();
const interrupt=setTimeout(()=>{failOnce('execution7min; independent cleanup started');void cleanup();},420000);
const terminal=setTimeout(()=>{failOnce('hardstop8min');report.hardStop=true;persist().finally(()=>process.exit(1));},480000);
const wait=async(read,label,timeout=60000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await read())return;await new Promise(r=>setTimeout(r,100));}throw Error('offline upgrade deadline: '+label);};
const readRaw=page=>page.evaluate(async()=>{const{createProgressStore}=await import('./src/franchise/save.js');return createProgressStore(undefined,{slot:1}).readRawBaseline();});
const ready=page=>page.waitForFunction(()=>window.__ready===true&&window.__game?.game?.baked?.state==='ready'
  &&window.__game.pack?.phaseId==='camps-at-dawn'&&window.__game.game.scenario.id==='shiloh-camps-at-dawn'
  &&document.getElementById('briefing')?.open===true,null,{timeout:60000});
const observeSave=async(page,id,before)=>{
  const raw=await readRaw(page);(report.saves??=[]).push({id,raw,bytes:Buffer.byteLength(raw),sha256:hash(raw)});
  check(id,raw===before,{bytes:Buffer.byteLength(raw),sha256:hash(raw)});
};
const launch=async()=>{
  const ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:960,height:540},
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  ctx.on('page',page=>{
    page.on('pageerror',error=>{if(report.errors.length<128)report.errors.push({phase,error:String(error)});else failOnce('pageerror capture overflow');});
    page.on('console',message=>{if(!['error','warning'].includes(message.type()))return;
      if(report.console.length<256&&message.text().length<16384)report.console.push({phase,type:message.type(),text:message.text()});else failOnce('console capture overflow');});
  });
  return ctx;
};
export function observeWorkerUpdate(registration){
  return new Promise((resolve,reject)=>{
    let worker,settled=false;
    const end=(failed,value)=>{if(settled)return;settled=true;clearTimeout(timer);registration.removeEventListener('updatefound',found);worker?.removeEventListener('statechange',changed);failed?reject(value):resolve(value);};
    const changed=()=>{if(!settled&&worker&&['installed','redundant'].includes(worker.state))end(false,worker.state);};
    const found=()=>{if(settled)return;const candidate=registration.installing;if(!candidate||candidate===worker)return;
      worker?.removeEventListener('statechange',changed);worker=candidate;worker.addEventListener('statechange',changed);changed();};
    const timer=setTimeout(()=>end(true,Error('worker install state deadline')),60000);
    registration.addEventListener('updatefound',found);
    try{found();Promise.resolve(registration.update()).then(found,error=>end(true,error));}catch(error){end(true,error);}
  });
}
const update=page=>page.evaluate(async source=>{
  const registration=await navigator.serviceWorker.getRegistration();return(0,eval)('('+source+')')(registration);
},observeWorkerUpdate.toString());
try{
  check('exact-ci-source',process.env.GITHUB_SHA===report.sha&&/^[1-9][0-9]*$/.test(report.run)&&report.attempt==='1',
    {git:report.sha,workflow:process.env.GITHUB_SHA,run:report.run,attempt:report.attempt});
  git(['diff','--exit-code','HEAD']);
  try{git(['cat-file','-e',OLD+'^{commit}']);}catch{git(['fetch','--depth=1','origin',OLD]);}
  const oldFiles=new Set(git(['ls-tree','-r','--name-only',OLD]).trim().split('\n'));
  const assets=git(['diff','--name-status',OLD,'HEAD','--','assets']).trim().split('\n').filter(Boolean);
  check('old-assets-byte-unchanged',assets.length===12&&assets.every(row=>row.startsWith('A\tassets/figures/confederate-infantry/')),assets);
  const manifest=createOfflineManifest();report.generation=manifest.generation;
  check('generated-source-exact',await fs.readFile(path.join(ROOT,'offline-manifest.js'),'utf8')===serializeOfflineManifest(manifest),'actual disk equals committed byte-admission generation');
  report.oldWorker={bytes:Buffer.byteLength(git(['show',OLD+':sw.js'])),sha256:hash(git(['show',OLD+':sw.js']))};
  const oldBytes=new Map();current=await startServer({port:0});
  proxy=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),p=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
      if(report.requests.length>=4096)throw Error('request capture overflow');
      const row={phase,release,path:p,method:req.method};report.requests.push(row);
      if(blocked&&release==='new'&&p==='src/world/terrain.js'){row.status=503;row.control='declared interrupted-install target';res.writeHead(503);res.end('intentional update interruption');return;}
      if(release==='old'){
        if(!oldFiles.has(p)){row.status=404;res.writeHead(404);res.end();return;}
        if(!p.startsWith('assets/')){
          if(!oldBytes.has(p))oldBytes.set(p,execFileSync('git',['-c','safe.directory='+realpathSync(ROOT),'show',OLD+':'+p],{cwd:ROOT,maxBuffer:8000000,timeout:30000}));
          const bytes=oldBytes.get(p);row.status=200;row.bytes=bytes.length;row.sha256=hash(bytes);
          const type=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.webmanifest')?'application/manifest+json':'text/html';
          res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return;
        }
      }
      const target=new URL(current.url);target.pathname=url.pathname;target.search=url.search;
      const upstream=http.request(target,{method:req.method,headers:req.headers},response=>{
        row.status=response.statusCode;res.writeHead(response.statusCode,response.headers);response.pipe(res);
      });upstream.on('error',()=>res.destroy());req.pipe(upstream);
    }catch(error){failOnce(error);if(!res.headersSent)res.writeHead(500);res.end('test server failed');}
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+proxy.address().port+'/';
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'cw-offline-upgrade-'));context=await launch();
  let page=await context.newPage();phase='old-title';await page.goto(origin+'?sw');
  await wait(()=>page.evaluate(()=>!!navigator.serviceWorker.controller),'v68 control');
  check('actual-predecessor-worker',await context.serviceWorkers()[0].evaluate(()=>VERSION)==='cw-v68',report.oldWorker);
  await page.reload();await page.waitForFunction(()=>window.__entry&&!window.__entry.importing);
  // The shipped player default is rigged. This fixture deliberately covers loaded baked assets.
  const figureChoice=await page.evaluate(async()=>{
    const{LOOK}=await import('./src/ui/look.js'),{get,set}=await import('./src/settings.js');
    const before=get('look.figureStyle');set('look.figureStyle','baked');
    return{before,after:get('look.figureStyle'),live:LOOK.figureStyle};
  });report.figureChoice=figureChoice;
  check('explicit-player-baked-choice',figureChoice.before==='rigged'&&figureChoice.after==='baked'&&figureChoice.live==='baked',figureChoice);
  // A genuinely persisted new campaign, with no invented earlier battles or awards.
  await page.evaluate(async()=>{
    const C=await import('./src/franchise/campaign.js'),{createProgressStore}=await import('./src/franchise/save.js');
    const campaign=await(await fetch('./assets/campaign.json')).json(),store=createProgressStore(undefined,{slot:1});
    const previousRaw=await store.readRawBaseline();if(previousRaw!==null)throw Error('fresh profile required');
    await store.import(JSON.stringify(C.newCampaign({campaign,slot:1,seed:1861,at:'2026-10-15T00:00:00Z',difficulty:'veteran'})),{previousRaw});
  });
  phase='old-campaign';await page.goto(origin+'?camp=1&sw');await page.locator('#camp-next').click();
  for(let n=0;n<12&&!new URL(page.url()).searchParams.has('campaign');n++){
    await page.waitForFunction(()=>new URLSearchParams(location.search).has('campaign')||document.getElementById('camp-decision')?.open===true);
    if(new URL(page.url()).searchParams.has('campaign'))break;
    await page.locator('#camp-decision-options input:not(:disabled)').first().check();
    await page.locator('#camp-decision-choose').click();
    await page.waitForFunction(()=>!window.__entry.importing&&!document.getElementById('camp-decision-reveal').hidden);
    await page.locator('#camp-decision-continue').click();
  }
  await ready(page);const campaignURL=page.url(),before=await readRaw(page);assert(before);
  report.save={kind:'actual new campaign; first phase loaded through ordinary Camp decisions; earlier battles not claimed',bytes:Buffer.byteLength(before),sha256:hash(before)};
  report.rawBefore=before;
  check('old-campaign-loaded',await page.evaluate(()=>window.__game.game.simTime===0&&window.__game.game.paused===true),campaignURL);
  const second=await context.newPage();await second.goto(origin+'?sw');await second.waitForFunction(()=>!!navigator.serviceWorker.controller&&!!window.__entry);
  phase='interrupted-update';release='new';blocked=true;
  check('interrupted-install-rejected',await update(page)==='redundant','503 on changed terrain module; predecessor must remain');
  await context.setOffline(true);await page.reload();await ready(page);
  await observeSave(page,'interruption-offline-save',before);
  check('interruption-old-cache',await page.evaluate(()=>caches.has('cw-v68')),'old generation retained');
  await context.setOffline(false);blocked=false;phase='healthy-update';
  check('healthy-install-waits',await update(page)==='installed','two old controlled clients remain open');
  check('two-client-no-takeover',await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return!!r.waiting&&r.active.state==='activated';}),'waiting successor, active predecessor');
  check('both-old-clients-controlled',await second.evaluate(()=>!!navigator.serviceWorker.controller)&&await page.evaluate(()=>!!navigator.serviceWorker.controller),'two native controlled pages');
  phase='late-cache-write';
  const generationCache='cw-offline-v1:'+encodeURIComponent(origin)+':'+manifest.generation;
  const late=await second.evaluate(async({paths,generationCache})=>{
    const old=await caches.open('cw-v68');
    for(const p of paths){const href=new URL('./'+p,location.href).href;if(await old.match(href))continue;
      if(await(await caches.open(generationCache)).match(href))continue;
      const r=await fetch(href);if(!r.ok)throw Error('late old cache request');await r.arrayBuffer();return p;}
    throw Error('no distinct late cache member');
  },{paths:[...oldFiles].filter(p=>p.startsWith('assets/portraits/')).sort(),generationCache});
  report.lateMember={path:late,oldAbsentBeforeRequest:true,candidateAbsentAfterInstall:true,expected:manifest.files[late]};
  await wait(()=>second.evaluate(async p=>!!await(await caches.open('cw-v68')).match(new URL('./'+p,location.href).href),late),'late native old cache write');
  const readLate=()=>second.evaluate(async p=>{
    const response=await(await caches.open('cw-v68')).match(new URL('./'+p,location.href).href),bytes=await response.arrayBuffer();
    return{bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')};
  },late);
  report.lateMember.old=await readLate();check('late-old-bytes',JSON.stringify(report.lateMember.old)===JSON.stringify(manifest.files[late]),report.lateMember);
  await context.setOffline(true);phase='activation';await page.close();await second.close();
  // Persistent contexts have an initial about:blank page; close every old client.
  for(const p of context.pages())await p.close();
  await wait(async()=>{
    for(const worker of context.serviceWorkers())try{if(await worker.evaluate(g=>self.CW_OFFLINE?.generation===g&&!self.registration.waiting&&self.registration.active?.state==='activated',manifest.generation))return true;}catch{}
    return false;
  },'normal browser activation');
  page=await context.newPage();await page.goto(campaignURL);await ready(page);
  await observeSave(page,'adopted-offline-campaign',before);
  const adopted=await page.evaluate(async({name,p})=>{
    const cache=await caches.open(name),href=new URL('./'+p,location.href).href;
    const record=await(await cache.match(new URL('./__cw_offline_admission__',location.href).href)).json();
    const cached=await cache.match(href);if(!cached)throw Error('late member missing from candidate cache');
    const response=await fetch(href),bytes=await response.arrayBuffer();
    return{metadata:record.members.includes(p),oldCache:await caches.has('cw-v68'),bytes:bytes.byteLength,
      sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')};
  },{name:generationCache,p:late});report.lateMember.adopted=adopted;
  check('late-candidate-offline-bytes',adopted.metadata&&adopted.bytes===manifest.files[late].bytes&&adopted.sha256===manifest.files[late].sha256,adopted);
  check('covered-predecessor-retired',!adopted.oldCache,adopted);
  await context.close();context=null;phase='browser-restart';context=await launch();await context.setOffline(true);
  page=await context.newPage();await page.goto(campaignURL);await ready(page);
  await observeSave(page,'restart-offline-campaign',before);
  await page.locator('#briefing-begin').click();const simulated=await page.evaluate(()=>{const g=window.__game.game,t=g.simTime;g.fastForward(10);return g.simTime-t;});
  check('offline-campaign-plays',simulated>=9,simulated);
  await observeSave(page,'play-keeps-persisted-save',before);
  phase='uncached-route';await page.goto(origin+'?battle=stones-river&phase=dawn-on-the-right&sw');await page.locator('#field-failure-heading').waitFor();
  await observeSave(page,'uncached-route-save',before);
  await page.goto(origin+'?camp=1&sw');await page.waitForFunction(()=>window.__entry?.mode==='camp'&&!window.__entry.importing);
  await observeSave(page,'failure-camp-recovery',before);
  check('no-page-errors',report.errors.length===0,report.errors);
  assert.equal(report.checks.length,22);assert.equal(new Set(report.checks.map(c=>c.id)).size,22);
  assert.equal(report.saves.length,6);
  report.complete=true;
}catch(error){failOnce(error);}
finally{
  await cleanup();if(report.failure||report.cleanup.some(r=>r.ok!==true))report.complete=false;
  await persist();clearTimeout(interrupt);clearTimeout(terminal);
}
console.log('OFFLINE UPGRADE '+(report.complete?'OK':'FAILED')+' '+JSON.stringify({checks:report.checks.length,sha:report.sha,old:OLD,generation:report.generation}));
process.exit(report.complete?0:1);

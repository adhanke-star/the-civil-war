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
import {bankIds,SOUNDS,AUDIO_DIR} from '../src/audio/bank.js';
import {newCampaign} from '../src/franchise/campaign.js';
import {completedSnapshot,exportSnapshot} from '../src/franchise/save.js';
import {SAMPLE_ARMY} from '../src/reward/data.js';
import {savedDeployment} from '../src/franchise/practice.js';
import {validateDeck} from '../src/franchise/decisions.js';
import {observeFallbackCall,recordingProofErrors} from './test-audio-ui.mjs';
import {observeAudioTransport} from './test-field-admission-ui.mjs';
import {probeProgress,seedProgress,progressRaw,holdProgressTransaction,releaseProgressTransaction} from './test-progress-browser.mjs';

if(!process.env.CI)throw Error('offline upgrade: Actions only; no local browser runs');
const OLD='9e7207982005ded754657f6cc1b319a982014a2f';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['-c','safe.directory='+realpathSync(ROOT),...args],{cwd:ROOT,encoding:'utf8',maxBuffer:8000000,timeout:60000});
if(process.argv.includes('--recordings')){const ok=await runCurrentRecordings();process.exit(ok?0:1);}
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
// Browser offline emulation did not block this worker's upstream requests.
// A closed, owned origin listener supplies the actual transport boundary.
export function inspectOrigin(origin){
  return new Promise(resolve=>{
    let settled=false;
    const finish=receipt=>{if(settled)return;settled=true;clearTimeout(timer);resolve(receipt);};
    const request=http.get(origin,{agent:false,method:'HEAD'},response=>{
      response.resume();finish({reachable:true,status:response.statusCode});
    });
    const timer=setTimeout(()=>{request.destroy();finish({reachable:null,error:'probe deadline'});},2000);
    request.on('error',error=>finish({reachable:false,error:error.code??null}));
  });
}
export async function reopenOrigin(server,origin){
  const url=new URL(origin);
  assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
  assert.equal(server.listening,false,'owned origin must already be closed');
  await new Promise((resolve,reject)=>{
    const failed=error=>{server.removeListener('listening',ready);reject(error);};
    const ready=()=>{server.removeListener('error',failed);resolve();};
    server.once('error',failed);server.once('listening',ready);
    try{server.listen(Number(url.port),'127.0.0.1');}
    catch(error){server.removeListener('error',failed);server.removeListener('listening',ready);reject(error);}
  });
}
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
  const online=await inspectOrigin(origin);check('origin-online-before-interruption',online.reachable&&online.status===200,online);
  await closeServer(proxy);const interrupted=await inspectOrigin(origin);
  check('interruption-origin-unavailable',!proxy.listening&&interrupted.reachable===false&&interrupted.error==='ECONNREFUSED',interrupted);
  await context.setOffline(true);await page.reload();await ready(page);
  await observeSave(page,'interruption-offline-save',before);
  check('interruption-old-cache',await page.evaluate(()=>caches.has('cw-v68')),'old generation retained');
  await reopenOrigin(proxy,origin);const reopened=await inspectOrigin(origin);
  check('healthy-origin-reopened',proxy.listening&&reopened.reachable&&reopened.status===200,reopened);
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
  const onlineAdoption=await inspectOrigin(origin);await closeServer(proxy);const unavailable=await inspectOrigin(origin);
  check('adoption-origin-unavailable',onlineAdoption.reachable&&onlineAdoption.status===200&&!proxy.listening
    &&unavailable.reachable===false&&unavailable.error==='ECONNREFUSED',{online:onlineAdoption,closed:unavailable});
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
  assert.equal(report.checks.length,26);assert.equal(new Set(report.checks.map(c=>c.id)).size,26);
  assert.equal(report.saves.length,6);
  report.complete=true;
}catch(error){failOnce(error);}
finally{
  await cleanup();if(report.failure||report.cleanup.some(r=>r.ok!==true))report.complete=false;
  await persist();clearTimeout(interrupt);clearTimeout(terminal);
}
console.log('OFFLINE UPGRADE '+(report.complete?'OK':'FAILED')+' '+JSON.stringify({checks:report.checks.length,sha:report.sha,old:OLD,generation:report.generation}));
process.exit(report.complete?0:1);


async function runCurrentRecordings(){
  const recording={schema:'battle-recordings-v1',sha:git(['rev-parse','HEAD']).trim(),run:process.env.GITHUB_RUN_ID??'',
    attempt:process.env.GITHUB_RUN_ATTEMPT??'',generation:null,complete:false,failure:null,overflow:false,
    errors:[],console:[],requests:[],browserAudio:[],cases:[],guards:null,cleanup:[]};
  const output=path.join(ROOT,'.out/offline');
  let manifest,expected,activeCleanup=null,phase='startup',activeCase='startup',watchdog,hardstop;
  const fail=error=>{if(recording.failure===null)recording.failure=String(error?.stack??error);};
  const bounded=async(task,label,ms=60000)=>{let timer;try{return await Promise.race([task,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('recording deadline: '+label)),ms);})]);}finally{clearTimeout(timer);}};
  const waitFor=async(read,label,ms=60000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await read())return;
    await new Promise(resolve=>setTimeout(resolve,25));}throw Error('recording observation deadline: '+label);};
  const persist=async()=>{await fs.mkdir(output,{recursive:true});const bytes=JSON.stringify(recording)+'\n';
    assert(Buffer.byteLength(bytes)<8000000,'recording raw report bound');await fs.writeFile(path.join(output,'recordings.json'),bytes);};
  const closeOwned=server=>server&&new Promise((resolve,reject)=>{
    server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());server.closeAllConnections();});
  const clean=async(rows,name,operation)=>{const row={name,ok:false};rows.push(row);try{await bounded(Promise.resolve().then(operation),'cleanup '+name,30000);row.ok=true;}
    catch(error){row.error=String(error?.message??error);fail(error);}};
  const beforeBegin=page=>page.evaluate(()=>({simTime:window.__game.game.simTime,paused:window.__game.game.paused,
    briefing:document.getElementById('briefing')?.open===true,decoded:window.__game.audio.mixer.buffers.size}));
  const readyField=page=>page.waitForFunction(()=>window.__ready===true&&window.__game?.pack?.phaseId==='camps-at-dawn'
    &&window.__game.game.scenario.id==='shiloh-camps-at-dawn'&&document.getElementById('briefing')?.open===true,null,{timeout:60000});
  const readSave=page=>page.evaluate(async()=>{const{createProgressStore}=await import('./src/franchise/save.js');return createProgressStore(undefined,{slot:1}).readRawBaseline();});
  const prepareContext=async(context,name,readPhase,origin)=>{
    await context.addInitScript(()=>{
      if(Object.hasOwn(window,'__recordingAudioContext'))throw Error('recording context observer already owned');
      const descriptor=Object.getOwnPropertyDescriptor(window,'AudioContext'),Original=window.AudioContext;
      let calls=0;const Wrapped=typeof Original==='function'?class extends Original{constructor(...args){calls++;super(...args);}}:null;
      const same=(a,b)=>!!a===!!b&&(!a||['value','get','set','writable','enumerable','configurable'].every(k=>a[k]===b[k]));
      if(Wrapped)Object.defineProperty(window,'AudioContext',{configurable:descriptor?.configurable??true,enumerable:descriptor?.enumerable??true,writable:true,value:Wrapped});
      const installed=Object.getOwnPropertyDescriptor(window,'AudioContext');
      Object.defineProperty(window,'__recordingAudioContext',{configurable:true,value:Object.freeze({
        read:()=>({calls,observed:!!Wrapped&&same(Object.getOwnPropertyDescriptor(window,'AudioContext'),installed)}),
        restore:()=>{if(!Wrapped||!same(Object.getOwnPropertyDescriptor(window,'AudioContext'),installed))return false;
          if(descriptor)Object.defineProperty(window,'AudioContext',descriptor);else delete window.AudioContext;
          const restored=same(Object.getOwnPropertyDescriptor(window,'AudioContext'),descriptor);delete window.__recordingAudioContext;return restored;},
      })});
    });
    const seen=new WeakSet();const attach=page=>{if(seen.has(page))return;seen.add(page);
      const raw=observeAudioTransport(page,{phase:readPhase});recording.browserAudio.push({id:recording.browserAudio.length+1,case:name,origin,trace:raw});
      page.on('pageerror',error=>{if(recording.errors.length>=128){recording.overflow=true;return;}
        const text=String(error);if(text.length>16384){recording.overflow=true;return;}recording.errors.push({case:name,phase:readPhase(),text});});
      page.on('console',message=>{if(!['error','warning'].includes(message.type()))return;
        const text=message.text(),url=message.location().url??'';if(recording.console.length>=256||text.length>16384||url.length>2048){recording.overflow=true;return;}
        recording.console.push({case:name,phase:readPhase(),type:message.type(),text,url,at:Date.now()});});
    };context.on('page',attach);for(const page of context.pages())attach(page);
  };
  const initialWorker=async(page,origin)=>{
    const startedAt=Date.now(),deadline=startedAt+60000;let closed=false,snapshot;
    try{
      await bounded(waitFor(async()=>{
        if(closed||Date.now()>=deadline)return false;
        const current=await page.evaluate(async()=>{
          const registration=await navigator.serviceWorker.getRegistration();
          return{url:location.href,scope:registration?.scope??null,scriptURL:registration?.active?.scriptURL??null,
            state:registration?.active?.state??null,entryMode:window.__entry?.mode??null,
            entryReady:!!window.__entry&&!window.__entry.importing,controlled:!!navigator.serviceWorker.controller};
        });
        const at=Date.now();if(closed||at>=deadline)return false;
        if(current.url!==origin+'?sw'||current.scope!==origin||current.scriptURL!==new URL('sw.js',origin).href
          ||current.state!=='activated'||current.entryMode!=='title'||current.entryReady!==true||current.controlled!==false)return false;
        snapshot={...current,startedAt,observedAt:at,deadline};return true;
      },'initial worker activation',60000),'initial worker activation',60000);
      if(!snapshot)throw Error('recordings: initial activation receipt unavailable');return snapshot;
    }finally{closed=true;}
  };
  const closeContext=async context=>{
    if(!context)return;
    let failed=false,first;
    try{for(const page of context.pages())if(!page.isClosed()){
      const restored=await bounded(page.evaluate(()=>window.__recordingAudioContext?.restore()??(location.href==='about:blank')),
        'AudioContext observer restoration',30000);
      assert(restored,'AudioContext observer descriptor restored');
    }}catch(error){failed=true;first=error;}
    finally{try{await bounded(context.close(),'actual browser/context close',30000);}
      catch(error){recording.cleanup.push({name:'actual browser/context close',ok:false,error:String(error?.message??error)});
        if(!failed){failed=true;first=error;}}}
    if(failed)throw first;
  };
  const fixtureSettings=page=>page.evaluate(async()=>{const{get,set}=await import('./src/settings.js');
    const read=()=>Object.fromEntries(['audio.master','audio.effects','audio.voices','audio.mute','audio.music'].map(key=>[key,get(key)]));
    const before=read();set('audio.music',0);return{before,after:read()};});
  const cacheState=(page,origin)=>page.evaluate(async({ids,files,origin,generation})=>{
    const name='cw-offline-v1:'+encodeURIComponent(origin)+':'+generation,cache=await caches.open(name);
    const metadataResponse=await cache.match(new URL('__cw_offline_admission__',origin).href);
    const metadata=metadataResponse?await metadataResponse.json():null,rows=[];
    for(const id of ids){const path=files[id],response=await cache.match(new URL(path,origin).href);
      if(!response){rows.push({id,present:false});continue;}const body=await response.arrayBuffer();
      rows.push({id,present:true,status:response.status,type:response.type,contentRange:response.headers.get('content-range'),
        contentLength:response.headers.get('content-length'),bytes:body.byteLength,
        sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),n=>n.toString(16).padStart(2,'0')).join('')});}
    return{metadata,rows};
  },{ids:expected.expectedIds,files:Object.fromEntries(expected.expectedIds.map(id=>[id,AUDIO_DIR+SOUNDS[id].file])),origin,generation:manifest.generation});
  const launch=async(profile,name,readPhase,origin)=>{const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:960,height:540},
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
    await prepareContext(context,name,readPhase,origin);return context;};
  const proxyFor=async(upstream,name,readPhase,{rejectRecordings=false,hold=null}={})=>{
    const paths=new Set(expected.expectedIds.map(id=>AUDIO_DIR+SOUNDS[id].file));
    const server=http.createServer(async(req,res)=>{let row;
      try{
        const url=new URL(req.url,'http://localhost'),p=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
        if(recording.requests.length>=4096){recording.overflow=true;res.writeHead(500);res.end();return;}
        row={id:recording.requests.length+1,case:name,origin:'http://127.0.0.1:'+server.address().port+'/',phase:readPhase(),path:p,method:req.method,range:req.headers.range??null,status:null,
          at:Date.now(),finished:false};recording.requests.push(row);
        res.once('finish',()=>{row.finished=true;row.finishedAt=Date.now();});
        res.once('close',()=>{if(!res.writableFinished){row.failed='client-aborted';row.failedAt=Date.now();}});
        if(paths.has(p)&&rejectRecordings){row.status=503;res.writeHead(503,{'Content-Type':'text/plain','Content-Length':3,'Cache-Control':'no-store'});res.end('503');return;}
        if(paths.has(p)&&hold?.enabled){const bytes=await fs.readFile(path.join(ROOT,p));
          assert.equal(bytes.length,manifest.files[p].bytes);assert.equal(hash(bytes),manifest.files[p].sha256);
          row.status=200;row.held=true;res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length,'Cache-Control':'no-store'});res.flushHeaders();
          hold.rows.push({row,res,bytes});return;
        }
        const target=new URL(upstream.url);target.pathname=url.pathname;target.search=url.search;
        const request=http.request(target,{method:req.method,headers:req.headers,agent:false},response=>{
          row.status=response.statusCode;res.writeHead(response.statusCode,response.headers);response.pipe(res);
        });request.on('error',error=>{row.failed=String(error.code??error);row.failedAt=Date.now();if(!res.destroyed)res.destroy();});req.pipe(request);
      }catch(error){fail(error);if(row){row.failed=String(error?.message??error);row.failedAt=Date.now();}if(!res.headersSent)res.writeHead(500);res.end();}
    });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    return{server,origin:'http://127.0.0.1:'+server.address().port+'/'};
  };
  watchdog=setTimeout(()=>{fail('recording execution7min; cleanup requested');void activeCleanup?.();},420000);
  hardstop=setTimeout(()=>{fail('recording hardstop8min');recording.complete=false;
    // This independent watchdog is armed BEFORE potentially blocked persistence.
    setTimeout(()=>process.exit(1),5000);void persist().finally(()=>process.exit(1));},480000);
  try{
    assert.deepEqual(process.argv.slice(2),['--recordings']);assert.equal(process.env.GITHUB_SHA,recording.sha);
    assert(/^[1-9][0-9]*$/.test(recording.run));assert.equal(recording.attempt,'1');git(['diff','--exit-code','HEAD']);
    manifest=createOfflineManifest();assert.equal(await fs.readFile(path.join(ROOT,'offline-manifest.js'),'utf8'),serializeOfflineManifest(manifest));recording.generation=manifest.generation;
    const campaign=JSON.parse(await fs.readFile(path.join(ROOT,'assets/campaign.json'),'utf8'));
    const scenario=JSON.parse(await fs.readFile(path.join(ROOT,'assets/packs/shiloh.json'),'utf8')).phases[0].scenario;
    const deck=validateDeck(JSON.parse(await fs.readFile(path.join(ROOT,'assets/decisions.json'),'utf8')));
    const initial=newCampaign({campaign,slot:1,seed:1861,at:'2026-10-15T00:00:00Z',difficulty:'veteran'});
    const guardRaw=exportSnapshot(completedSnapshot({awardId:'recording-guard-fixture',army:structuredClone(SAMPLE_ARMY.filter(b=>b.id==='b1')),depot:[],issued:[],seed:1861,grade:'Victory'}));
    assert.equal(JSON.parse(guardRaw).army.length,1);assert.equal(JSON.parse(guardRaw).army[0].id,'b1');
    const guardGround=JSON.parse(await fs.readFile(path.join(ROOT,'assets/scenarios/henry-hill.json'),'utf8'));
    const guardInput={baseline:JSON.parse(guardRaw),awardId:'recording-guard-admission',seed:1861,surrender:true};
    const guardPreliminary=savedDeployment({...guardInput,ground:{}}),guardComplete=savedDeployment({...guardInput,ground:guardGround});
    assert.deepEqual(guardPreliminary.allocation,guardComplete.allocation);
    expected={sha:recording.sha,run:recording.run,manifest,campaign,deck,initial,guardRaw,guardAllocation:guardComplete.allocation,
      fielded:[...scenario.units,...(scenario.reinforcements??[])].filter(u=>u.side==='US').map(u=>u.id),
      expectedIds:[...bankIds('battle'),...bankIds('ambient',{season:scenario.season})]};
    const sourceScripts=[];await probeProgress({addInitScript:async(fn)=>sourceScripts.push(fn.toString())},
      {prefix:'__recording',readFlag:'__recordingReadBlocked',quotaFlag:'__recordingQuota'});
    assert.equal(sourceScripts.length,1);expected.guardFixtureSource={bytes:Buffer.byteLength(sourceScripts[0]),sha256:hash(sourceScripts[0])};
    for(const name of ['healthy','unavailable'])await runRecordingCase(name);
    if(recording.failure===null){recording.complete=true;const errors=recordingProofErrors(recording,expected);assert.deepEqual(errors,[]);}
  }catch(error){fail(error);recording.complete=false;}
  finally{
    if(activeCleanup)await activeCleanup();
    if(recording.failure!==null||recording.cleanup.some(r=>r.ok!==true))recording.complete=false;
    await persist();clearTimeout(watchdog);clearTimeout(hardstop);
  }
  console.log('BATTLE RECORDINGS '+(recording.complete?'OK':'FAILED')+' '+JSON.stringify({sha:recording.sha,run:recording.run,generation:recording.generation,failure:recording.failure}));
  return recording.complete;

  async function runRecordingCase(name){
    let context,upstream,proxy,cleanupTask,casePhase='title';
    const c={name,origin:null,cleanup:[],saves:{},decisionSaves:[],departures:0,rejectedPaths:[]};recording.cases.push(c);
    const cleanup=()=>cleanupTask??=(async()=>{
      await clean(c.cleanup,'browser',()=>closeContext(context));context=null;
      await clean(c.cleanup,'proxy',()=>closeOwned(proxy?.server));
      await clean(c.cleanup,'server',()=>closeOwned(upstream?.server));
    })();activeCleanup=cleanup;
    try{
      upstream=await startServer({port:0});proxy=await proxyFor(upstream,name,()=>casePhase,{rejectRecordings:name==='unavailable'});c.origin=proxy.origin;
      const profile=await fs.mkdtemp(path.join(os.tmpdir(),'cw-recordings-'+name+'-'));
      context=await launch(profile,name,()=>casePhase,c.origin);
      let page=context.pages()[0]??await context.newPage();await page.goto(c.origin+'?sw');
      // The shipping worker does not claim its installing document. Observe activation, then navigate normally.
      c.initialActivation=await initialWorker(page,c.origin);
      c.installBeforeGesture=await page.evaluate(()=>window.__recordingAudioContext.read());
      assert(c.installBeforeGesture.observed&&c.installBeforeGesture.calls===0);
      c.initialReloadAt=Date.now();await page.reload();c.initialReloaded=true;
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller&&!!window.__entry&&!window.__entry.importing,null,{timeout:60000});
      c.settings=await fixtureSettings(page);
      const first=await page.evaluate(()=>window.__recordingAudioContext.read());
      assert(first.observed);assert.equal(first.calls,0);
      c.initialRaw=await page.evaluate(async()=>{
        const{newCampaign}=await import('./src/franchise/campaign.js'),{createProgressStore}=await import('./src/franchise/save.js');
        const campaign=await(await fetch('./assets/campaign.json')).json(),store=createProgressStore(undefined,{slot:1});
        const previousRaw=await store.readRawBaseline();if(previousRaw!==null)throw Error('recordings: fresh campaign profile required');
        await store.import(JSON.stringify(newCampaign({campaign,slot:1,seed:1861,at:'2026-10-15T00:00:00Z',difficulty:'veteran'})),{previousRaw});
        return store.readRawBaseline();
      });assert.equal(c.initialRaw,exportSnapshot(expected.initial));
      casePhase='camp';await page.goto(c.origin+'?camp=1&sw');
      await page.waitForFunction(()=>window.__entry?.mode==='camp'&&!window.__entry.importing,null,{timeout:60000});
      const second=await page.evaluate(()=>window.__recordingAudioContext.read());
      const audioBefore=recording.browserAudio.filter(r=>r.case===name).reduce((n,r)=>n+r.trace.requests.length,0);
      c.beforeGesture={requests:audioBefore,audioContexts:c.installBeforeGesture.calls+first.calls+second.calls,observed:c.installBeforeGesture.observed&&first.observed&&second.observed};
      assert(c.beforeGesture.observed&&c.beforeGesture.requests===0&&c.beforeGesture.audioContexts===0);
      const cold=await cacheState(page,c.origin);c.coldCache=cold.rows;c.metadata=cold.metadata;
      assert(c.coldCache.every(r=>r.present===false));
      c.controller=await currentController(context,page,c.origin);assert(c.controller);
      casePhase='prepare';await page.locator('#camp-next').click();
      for(let n=0;n<2;n++){
        await page.waitForSelector('#camp-decision[open]');
        await page.locator('#camp-decision-options input:not(:disabled)').first().check();
        await page.locator('#camp-decision-choose').click();
        await page.waitForFunction(()=>!window.__entry.importing&&!document.getElementById('camp-decision-reveal').hidden);
        c.decisionSaves.push(await readSave(page));await page.locator('#camp-decision-continue').click();
      }
      c.saves.before=c.decisionSaves.at(-1);await readyField(page);casePhase='briefing';c.departures++;
      c.beforeBegin=await beforeBegin(page);c.saves.departed=await readSave(page);
      const prepared=await cacheState(page,c.origin);c.cache=prepared.rows;c.metadata=prepared.metadata;
      c.rejectedPaths=[...new Set(recording.requests.filter(r=>r.case===name&&r.phase==='prepare'&&r.status===503).map(r=>r.path))].sort();
      if(name==='healthy')recording.guards=await runNativeGuards(context.browser(),upstream);
      // Observe completion without advancing or changing the paused game.
      await waitFor(()=>recording.requests.filter(r=>r.case===name).every(r=>r.finished&&!r.failed),'pre-close owned HTTP requests');
      c.online=await inspectOrigin(c.origin);assert(c.online.reachable&&c.online.status===200);
      await closeOwned(proxy.server);c.listenerClosed=!proxy.server.listening;c.closed=await inspectOrigin(c.origin);
      assert(c.listenerClosed&&c.closed.reachable===false&&c.closed.error==='ECONNREFUSED');
      c.requestCountAtClose=recording.requests.filter(r=>r.case===name).length;
      const oldBrowser=context.browser();assert(oldBrowser);await closeContext(context);context=null;
      assert.equal(oldBrowser.isConnected(),false,'closing persistent context closes its actual browser');
      casePhase='restart';context=await launch(profile,name,()=>casePhase,c.origin);assert(context.browser()!==oldBrowser&&context.browser().isConnected());
      c.browserRestarted=true;await context.setOffline(true);page=context.pages()[0]??await context.newPage();
      await page.goto(c.origin+'?campaign=1');await readyField(page);
      c.restartBeforeBegin=await beforeBegin(page);c.saves.restart=await readSave(page);
      c.restartController=await currentController(context,page,c.origin);assert(c.restartController);
      c.restartSettings=await page.evaluate(async()=>{const{get}=await import('./src/settings.js');
        return Object.fromEntries(['audio.master','audio.effects','audio.voices','audio.mute','audio.music'].map(key=>[key,get(key)]));});
      c.restartCache=(await cacheState(page,c.origin)).rows;
      casePhase='playback';await page.locator('#briefing-begin').click();
      await page.waitForFunction(()=>window.__game.audio.mixer.running&&window.__game.audio.mixer.pending.size===0,null,{timeout:60000});
      c.resumedForPlayback=await page.evaluate(()=>window.__game.game.paused);
      if(c.resumedForPlayback)await page.locator('#pause').click();
      await page.waitForFunction(()=>!window.__game.game.paused&&!window.__game.audio.director.paused);
      c.playback=await page.evaluate(async({ids,observerSource,healthy})=>{
        const{game,effects,audio}=window.__game,m=audio.mixer;
        const decoded=ids.filter(id=>m.has(id)).map(id=>{const b=m.buffers.get(id);return{id,native:b instanceof AudioBuffer,length:b.length,channels:b.numberOfChannels,sampleRate:b.sampleRate};});
        const u=game.units.find(u=>u.alive&&u.side===game.playerSide&&u.type==='infantry'&&game.controls(u)&&u.canTakeOrders());
        if(!u)throw Error('recordings: no native orderable Union infantry');
        let fallback=null,start=m.log.length;
        if(!healthy){await effects.unlock();await effects.sound.ready;const observe=(0,eval)('('+observerSource+')');const owned=observe(effects.sound);
          try{effects.volley(u,[[u.x,u.z,0]]);}finally{fallback=owned.close();}}
        else effects.volley(u,[[u.x,u.z,0]]);
        const volley=m.log.slice(start);game.select(u);document.getElementById('battlefield').focus();
        return{running:m.running,decoded,volley,fallback,selectedUS:game.selected===u&&game.selection.includes(u),simTime:game.simTime,orderStart:m.log.length};
      },{ids:expected.expectedIds,observerSource:observeFallbackCall.toString(),healthy:name==='healthy'});
      await page.keyboard.press('h');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const tail=await page.evaluate(({start,ambientId})=>{
        const{game,audio}=window.__game,m=audio.mixer,h=audio.director.ambient;
        const notice='Some recorded battle sounds are unavailable. You can still play.',toast=[...document.querySelectorAll('#toasts p')].find(n=>n.textContent===notice);
        const r=toast?.getBoundingClientRect(),css=toast?getComputedStyle(toast):null;
        return{order:m.log.slice(start),ambient:{id:h?.id??null,bus:h?.bus??null,loop:h?.loop===true,stopped:h?.stopped??true,live:!!h&&m.voices.has(h)},
          notice:{status:document.getElementById('status').textContent.includes(notice),visible:!!toast&&r.width>0&&r.height>0&&css.visibility==='visible'&&css.display!=='none',
            role:document.getElementById('status').getAttribute('role'),toastRole:document.getElementById('toasts').getAttribute('role')},simTime:game.simTime};
      },{start:c.playback.orderStart,ambientId:expected.expectedIds.at(-1)});
      Object.assign(c.playback,{order:tail.order,ambient:tail.ambient,simTime:tail.simTime});c.notice=tail.notice;
      c.saves.played=await readSave(page);c.noRequestsAfterClose=recording.requests.filter(r=>r.case===name).length===c.requestCountAtClose;
      assert(c.noRequestsAfterClose);assert.equal(c.saves.played,c.saves.departed);assert.equal(recording.errors.length,0);
      if(name==='unavailable'){
        await fs.mkdir(output,{recursive:true});const png=await page.screenshot({path:path.join(output,'recordings-unavailable.png')});
        c.noticeScreenshot={file:'recordings-unavailable.png',bytes:png.length,sha256:hash(png)};
      }
    }finally{await cleanup();activeCleanup=null;}
  }
  async function currentController(context,page,origin){
    const controlled=await page.evaluate(origin=>!!navigator.serviceWorker.controller&&navigator.serviceWorker.controller.scriptURL===new URL('sw.js',origin).href,origin);
    if(!controlled)return false;
    for(const worker of context.serviceWorkers())try{if(await worker.evaluate(g=>self.CW_OFFLINE?.generation===g,manifest.generation))return true;}catch{}
    return false;
  }
  async function runNativeGuards(browser,upstream){
    assert(browser,'native guards require the actual healthy browser');
    let context,proxy,page,cleanupTask,guardPhase='startup';const hold={enabled:false,rows:[]};
    const g={origin:null,fixtureSource:null,ui:{},cancel:null,healthy:null,probesRestored:false,contextClosed:false};
    recording.guards=g; // Preserve partial native diagnostics when a later guard fails.
    const previousCleanup=activeCleanup;
    const releaseBodies=()=>{hold.enabled=false;let failed=false,failure;
      for(const{row,res,bytes}of hold.rows){if(Object.hasOwn(row,'releasedAt'))continue;row.releasedAt=Date.now();
        try{if(!res.destroyed&&!res.writableEnded)res.end(bytes);}catch(error){if(!failed){failed=true;failure=error;}}}
      if(failed)throw failure;};
    const cleanup=()=>cleanupTask??=(async()=>{
      await clean(recording.cleanup,'guard held bodies',releaseBodies);await clean(recording.cleanup,'guard native descriptors',async()=>{
        if(page&&!page.isClosed())g.probesRestored=await page.evaluate(()=>window.__recordingNativeRestore?.()??false);
        assert(g.probesRestored||!page,'guard native descriptors restored');
      });
      await clean(recording.cleanup,'guard context',async()=>{await closeContext(context);g.contextClosed=true;});context=null;
      await clean(recording.cleanup,'guard proxy',()=>closeOwned(proxy?.server));
    })();activeCleanup=async()=>{await cleanup();await previousCleanup?.();};
    try{
      proxy=await proxyFor(upstream,'guards',()=>guardPhase,{hold});g.origin=proxy.origin;
      context=await browser.newContext({viewport:{width:960,height:540},reducedMotion:'reduce'});
      // Collect the existing fixture's ONE initializer, then execute it between descriptor snapshots in ONE script.
      // This does not assume relative order among Playwright initScripts.
      const scripts=[];await probeProgress({addInitScript:async(fn,args)=>scripts.push({source:fn.toString(),args})},
        {prefix:'__recording',readFlag:'__recordingReadBlocked',quotaFlag:'__recordingQuota'});
      assert.equal(scripts.length,1);g.fixtureSource={bytes:Buffer.byteLength(scripts[0].source),sha256:hash(scripts[0].source)};
      await context.addInitScript(({source,args})=>{
        const targets=[[IDBFactory.prototype,'open'],[IDBDatabase.prototype,'transaction'],[IDBDatabase.prototype,'createObjectStore'],
          [IDBObjectStore.prototype,'get'],[IDBObjectStore.prototype,'put'],[Storage.prototype,'getItem'],[Storage.prototype,'setItem'],[Storage.prototype,'removeItem'],
          [HTMLCanvasElement.prototype,'getContext']];
        const same=(a,b)=>!!a===!!b&&(!a||['value','get','set','writable','enumerable','configurable'].every(k=>a[k]===b[k]));
        const rows=targets.map(([owner,key])=>({owner,key,before:Object.getOwnPropertyDescriptor(owner,key)}));
        const installer=(0,eval)('('+source+')');installer(args);
        const canvasRow=rows.at(-1),original=canvasRow.before.value,canvases=new WeakSet();let gpu=0;
        function wrapped(...args){const value=Reflect.apply(original,this,args);if(/^webgl/.test(args[0])&&value&&!canvases.has(this)){canvases.add(this);gpu++;}return value;}
        Object.defineProperty(canvasRow.owner,canvasRow.key,{...canvasRow.before,value:wrapped});
        for(const row of rows)row.installed=Object.getOwnPropertyDescriptor(row.owner,row.key);
        window.__recordingGpu=()=>gpu;
        window.__recordingNativeRestore=()=>{
          if(!rows.every(r=>same(Object.getOwnPropertyDescriptor(r.owner,r.key),r.installed)))return false;
          for(const r of rows)if(r.before)Object.defineProperty(r.owner,r.key,r.before);else delete r.owner[r.key];
          return rows.every(r=>same(Object.getOwnPropertyDescriptor(r.owner,r.key),r.before));
        };
      },scripts[0]);
      await prepareContext(context,'guards',()=>guardPhase,g.origin);page=await context.newPage();
      await page.goto(g.origin+'?camp&nosw');await page.waitForFunction(()=>!!window.__entry&&!window.__entry.importing);
      g.ui.settings=await fixtureSettings(page);await seedProgress(page,expected.guardRaw);
      await page.goto(g.origin+'?camp&nosw');await page.waitForFunction(()=>window.__entry?.mode==='camp'&&!window.__entry.importing);
      await page.locator('#camp-deploy').click();await page.waitForFunction(()=>document.getElementById('deploy-review')?.getAttribute('aria-busy')==='false');
      g.ui.rawBefore=await progressRaw(page);assert.equal(g.ui.rawBefore,expected.guardRaw);
      g.ui.review=await page.evaluate(async()=>{
        const{exportSnapshot}=await import('./src/franchise/save.js'),t=window.__entry.deployment;
        return{busy:t?.busy,cancelled:t?.cancelled,admitted:t?.admitted,
          open:document.getElementById('deploy-review').open,enabled:!document.getElementById('deploy-launch').disabled,
          baselineRaw:t?.manifest?exportSnapshot(t.manifest.baseline):null,allocation:t?.manifest?.allocation??null,
          note:document.getElementById('deploy-note').textContent};
      });
      assert(g.ui.review.open&&g.ui.review.enabled&&g.ui.review.busy===false&&g.ui.review.cancelled===false
        &&g.ui.review.admitted===false&&g.ui.review.baselineRaw===expected.guardRaw,'recordings: actual guard review was not admitted');
      assert.deepEqual(g.ui.review.allocation,expected.guardAllocation);
      await page.evaluate(()=>{
        window.__recordingTask=window.__entry.deployment;window.__recordingStart=null;window.__recordingCancel=null;
        const save=(name,event)=>{window[name]={trusted:event.isTrusted,at:performance.timeOrigin+performance.now(),timebase:'browser-performance-UTC'};};
        document.getElementById('deploy-launch').addEventListener('click',e=>save('__recordingStart',e),{capture:true,once:true});
        document.getElementById('deploy-cancel').addEventListener('click',e=>save('__recordingCancel',e),{capture:true,once:true});
      });
      guardPhase='cancel';hold.enabled=true;g.ui.startedAt=Date.now();await page.locator('#deploy-launch').click();
      const traces=()=>recording.browserAudio.filter(r=>r.case==='guards');
      await waitFor(()=>hold.rows.length===3&&traces().flatMap(r=>r.trace.requests).filter(r=>r.response?.status===200).length===3,'three native held recording responses',4500);
      g.ui.heldAt=Date.now();g.ui.heldProxyRequestIds=hold.rows.map(r=>r.row.id);
      g.ui.heldBrowser=traces().flatMap(t=>t.trace.requests.map(r=>({traceId:t.id,...r}))).filter(r=>r.response?.status===200)
        .map(r=>({traceId:r.traceId,id:r.id,url:r.url,method:r.method,response:r.response}));
      g.ui.preparing=await page.evaluate(()=>window.__entry.deployment===window.__recordingTask&&window.__recordingTask.busy
        &&!window.__recordingTask.cancelled&&!window.__game&&document.getElementById('deploy-note').textContent.includes('Preparing recorded battle sounds'));
      assert(g.ui.preparing);g.ui.cancelCommandAt=Date.now();await page.locator('#deploy-cancel').click();
      await page.waitForFunction(()=>!!window.__entry&&!window.__entry.importing&&!document.getElementById('deploy-review').open);
      g.ui.settledAt=Date.now();
      // Observe all original cancellation terminals before releasing any held body.
      await waitFor(()=>hold.rows.length===3&&hold.rows.every(r=>r.row.failed==='client-aborted')
        &&traces().flatMap(r=>r.trace.requests).filter(r=>r.terminal?.type==='failed').length===3,
        'three native cancellation terminals');
      g.ui.terminalsAt=Date.now();releaseBodies();
      const snapshots=await page.evaluate(async()=>{
        const read=()=>({at:performance.timeOrigin+performance.now(),gpu:window.__recordingGpu(),gamePresent:!!window.__game,cancelled:window.__recordingTask.cancelled,
          admitted:window.__recordingTask.admitted,ownerReleased:window.__entry.deployment===null,closed:!document.getElementById('deploy-review').open});
        const frames=[];for(let i=0;i<2;i++)frames.push(await new Promise(resolve=>requestAnimationFrame(()=>resolve(read()))));
        return{frames,start:window.__recordingStart,cancel:window.__recordingCancel};
      });
      g.ui.frames=snapshots.frames;g.ui.startEvent=snapshots.start;g.ui.cancelEvent=snapshots.cancel;
      g.ui.observedAt=Date.now();g.ui.rawAfter=await progressRaw(page);
      const last=g.ui.frames.at(-1);g.ui.gpu=last.gpu;g.ui.cancelled=last.cancelled;g.ui.closed=last.closed;
      g.ui.departures=recording.requests.filter(r=>r.case==='guards'&&r.path==='src/main.js').length;
      g.ui.holdsReleased=hold.rows.every(r=>Number.isFinite(r.row.releasedAt));
      g.ui.proxyAbortIds=hold.rows.filter(r=>r.row.failed==='client-aborted').map(r=>r.row.id);
      g.ui.browserAbort=traces().flatMap(t=>t.trace.requests.map(r=>({traceId:t.id,...r}))).filter(r=>r.terminal?.type==='failed')
        .map(r=>({traceId:r.traceId,id:r.id,url:r.url,method:r.method,terminal:r.terminal}));
      assert(g.ui.startEvent.trusted&&g.ui.cancelEvent.trusted&&g.ui.cancelEvent.at-g.ui.startEvent.at<6000);
      assert.equal(hold.rows.length,3);assert.equal(g.ui.proxyAbortIds.length,3);assert.equal(g.ui.browserAbort.length,3);
      assert(g.ui.frames.every(r=>r.gpu===0&&!r.gamePresent&&r.cancelled&&!r.admitted&&r.ownerReleased&&r.closed));
      assert.equal(g.ui.rawAfter,expected.guardRaw);assert.equal(g.ui.departures,0);assert(g.ui.holdsReleased);
      guardPhase='queued-cancel';
      for(const name of ['cancel','healthy']){
        const before=await progressRaw(page);assert.equal(before,expected.guardRaw);
        await page.evaluate(async raw=>{
          const{createProgressStore,parseSnapshot}=await import('./src/franchise/save.js');
          window.__recordingExchange={store:createProgressStore(undefined,{slot:1}),baseline:parseSnapshot(raw),calls:0,current:true,result:null};
        },before);
        const putsBefore=await page.evaluate(()=>window.__progressPuts);await holdProgressTransaction(page);
        await page.evaluate(()=>{
          const x=window.__recordingExchange;
          x.task=x.store.exchange(s=>s,null,{previous:x.baseline,isCurrent:()=>{x.calls++;return x.current;}})
            .then(()=>{x.result={ok:true};},error=>{x.result={ok:false,error:error.message};});
        });
        await page.waitForFunction(()=>window.__progressTransactions>window.__saveQueueBase);
        const queued=await page.evaluate(()=>window.__saveHolding&&!window.__saveReleaseRequested&&window.__recordingExchange.calls===0);
        assert(queued);if(name==='cancel')await page.evaluate(()=>{window.__recordingExchange.current=false;});
        await releaseProgressTransaction(page);await page.waitForFunction(()=>window.__recordingExchange.result!==null);
        const result=await page.evaluate(()=>({calls:window.__recordingExchange.calls,result:window.__recordingExchange.result,puts:window.__progressPuts}));
        const after=await progressRaw(page);g[name]={queued,before,after,currentCalls:result.calls,puts:result.puts-putsBefore,
          rejected:result.result.ok===false,error:result.result.error??null};
        assert.equal(after,expected.guardRaw);assert.equal(result.calls,1);assert.equal(g[name].puts,name==='cancel'?0:1);
        assert.equal(g[name].rejected,name==='cancel');guardPhase='queued-healthy';
      }
    }finally{await cleanup();activeCleanup=previousCleanup;}
    assert(browser.isConnected(),'isolated guard context must not close the healthy browser');return g;
  }


}

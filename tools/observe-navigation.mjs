// Actions-only controlled WebKit diagnosis. Deliberate faults never enter the canonical smoke.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startServer,ROOT} from './serve.mjs';

const CASES=['normal','held-release','navigation-cancel','non-navigation-failure'];
function verify(row,binding){
  assert.equal(row.sha,binding.sha);assert.equal(row.run,binding.run);assert(CASES.includes(row.case));
  assert.deepEqual(row.observerErrors,[]);assert.deepEqual(row.cleanupErrors,[]);
  assert.equal(row.observerFailureCount,0);
  assert(Array.isArray(row.errors)&&Array.isArray(row.events));
  for(let i=0;i<row.events.length;i++){const e=row.events[i];assert.equal(e.sequence,i);assert(Number.isFinite(e.ms)&&e.ms>=0);if(i)assert(e.ms>=row.events[i-1].ms);}
  const events=row.events,one=kind=>{const rows=events.filter(e=>e.event===kind);assert.equal(rows.length,1,kind);return rows[0];};
  const req=one('manifest-bound');assert.equal(req.url,row.url+'assets/art/manifest.json');assert.equal(req.method,'GET');assert.equal(req.document,1);assert.equal(req.main,true);assert.equal(req.context,row.case);assert.equal(req.page,1);assert.equal(req.frame,1);
  const target=events.filter(e=>e.request===req.request);
  assert.equal(target.filter(e=>e.event==='request').length,1);
  for(const e of target)for(const key of ['url','method','document','main','context','page','frame'])assert.equal(e[key],req[key],'request identity '+key);
  const titleNavigation=events.filter(e=>e.event==='main-navigation'&&e.document===1);
  assert.equal(titleNavigation.length,1);assert.equal(titleNavigation[0].url,row.url);
  assert(titleNavigation[0].sequence<target.find(e=>e.event==='request').sequence);
  const server=events.filter(e=>e.serverRequest===req.serverRequest);
  assert.equal(server.filter(e=>e.event==='server-request'&&e.url==='/assets/art/manifest.json'&&e.method==='GET').length,1);
  for(const e of events.filter(e=>e.event==='server-request'))assert(Array.isArray(e.rawHeaders)&&e.rawHeaders.every(v=>typeof v==='string'));
  const boundary=one('observation-end'),cleanup=one('cleanup-start');assert(boundary.sequence<cleanup.sequence);assert(one('cleanup-end').sequence>cleanup.sequence);
  const before=events.filter(e=>e.sequence<boundary.sequence);
  assert.deepEqual(row.errors,before.filter(e=>e.event==='pageerror'||e.event==='console').map(e=>({event:e.event,message:e.message,stack:e.stack??null,type:e.type??null})));
  assert(one('dispatcher-restored').exact);assert(one('context-closed'));assert(one('server-closed'));
  const cleanupEnd=one('cleanup-end');
  for(const kind of ['dispatcher-restored','context-closed','server-closed'])assert(one(kind).sequence>cleanup.sequence&&one(kind).sequence<cleanupEnd.sequence);
  assert.equal(events.filter(e=>['page-close','page-crash'].includes(e.event)&&e.sequence<cleanup.sequence).length,0);
  assert.equal(events.filter(e=>e.event==='request'&&e.document===1&&e.url===req.url).length,1);
  assert.equal(events.filter(e=>e.event==='server-request'&&e.url==='/assets/art/manifest.json'&&e.sequence<boundary.sequence).length,
    row.case==='non-navigation-failure'?1:2); // one title and one ordinary practice request
  if(row.case==='normal'||row.case==='held-release'){
    const finish=target.filter(e=>e.event==='requestfinished');assert.equal(finish.length,1);
    const response=target.filter(e=>e.event==='response');assert.equal(response.length,1);assert.equal(response[0].status,200);
    const done=server.filter(e=>e.event==='server-finish');assert.equal(done.length,1);assert.equal(done[0].status,200);assert.equal(typeof done[0].rawHeader,'string');
    const settlement=one('title-settlement');assert(settlement.settled&&settlement.manifest===true&&settlement.title);assert(settlement.sequence<one('continue-start').sequence);
    assert.deepEqual(row.errors.filter(e=>e.event==='pageerror'||e.type==='error'),[]);
    const click=one('continue-start');assert(finish[0].sequence<click.sequence&&done[0].sequence<click.sequence);assert.equal(target.filter(e=>e.event==='requestfailed').length,0);
    if(row.case==='held-release'){assert.equal(one('barrier-held').serverRequest,req.serverRequest);assert.equal(one('barrier-release').serverRequest,req.serverRequest);assert(one('barrier-held').sequence<one('barrier-release').sequence);assert(one('barrier-release').sequence<done[0].sequence);}else assert.equal(events.filter(e=>e.event==='barrier-held').length,0);
  }else{
    const pending=one('pending-before-intervention'),held=one('barrier-held');
    assert.equal(held.serverRequest,req.serverRequest);
    assert.equal(pending.request,req.request);assert.equal(pending.serverRequest,req.serverRequest);
    assert.equal(pending.document,1);assert.equal(pending.headersSent,false);assert.equal(pending.finished,false);assert.equal(pending.destroyed,false);assert.equal(pending.socketDestroyed,false);assert.equal(pending.settled,false);assert(held.sequence<pending.sequence);
    assert.equal(target.filter(e=>['response','requestfinished','requestfailed'].includes(e.event)&&e.sequence<pending.sequence).length,0);
    const failed=target.filter(e=>e.event==='requestfailed'&&e.sequence<boundary.sequence);assert.equal(failed.length,1);assert(failed[0].sequence>pending.sequence);
    assert.equal(typeof failed[0].failure?.errorText,'string');assert(failed[0].failure.errorText.length>0);
    assert.equal(target.filter(e=>['response','requestfinished'].includes(e.event)&&e.sequence<boundary.sequence).length,0);
    assert.equal(server.filter(e=>e.event==='server-finish'&&e.sequence<boundary.sequence).length,0);
    if(row.case==='navigation-cancel'){
      assert(one('continue-start').sequence>pending.sequence);
      assert(failed[0].sequence>one('continue-start').sequence);
      assert.equal(events.filter(e=>e.event==='fault-socket-destroy').length,0);
      assert.equal(events.filter(e=>e.event==='barrier-release'&&e.sequence<boundary.sequence).length,0);
      assert(events.some(e=>e.event==='main-navigation'&&e.document===2&&e.url===row.url+'?intro'&&e.sequence<boundary.sequence));
    }else{
      assert(one('fault-socket-destroy').sequence>pending.sequence);assert.equal(one('fault-socket-destroy').serverRequest,req.serverRequest);
      assert(failed[0].sequence>one('fault-socket-destroy').sequence);
      assert.equal(events.filter(e=>e.event==='continue-start').length,0);
      assert.equal(events.filter(e=>e.event==='main-navigation'&&e.document!==1&&e.sequence<boundary.sequence).length,0);
      const settlement=one('title-settlement');assert(settlement.settled&&settlement.manifest===null&&settlement.title);assert(settlement.sequence>failed[0].sequence);
    }
  }
  if(row.case!=='non-navigation-failure'){const practice=one('practice-check');assert(practice.ready&&practice.intro);assert(practice.sequence<boundary.sequence);
    const navigation=events.filter(e=>e.event==='main-navigation'&&e.document===2);assert.equal(navigation.length,1);assert.equal(navigation[0].url,row.url+'?intro');
    assert(navigation[0].sequence>one('continue-start').sequence&&navigation[0].sequence<practice.sequence);}
  return true;
}
function readerControls(){
  // Serialized fixtures and rejecting controls exercise the reader; they do not stand in for native execution.
  const bind={sha:'fixture',run:'fixture-run'};
  const make=kind=>{
    const r={case:kind,...bind,url:'http://fixture/',events:[],errors:[],observerErrors:[],cleanupErrors:[],observerFailureCount:0};
    const add=(event,x={})=>r.events.push({sequence:r.events.length,ms:r.events.length,event,...(event==='server-request'?{rawHeaders:['Host','fixture']}:{}),...x});
    add('main-navigation',{document:1,url:r.url});
    add('server-request',{serverRequest:1,url:'/assets/art/manifest.json',method:'GET'});
    add('request',{request:1,url:r.url+'assets/art/manifest.json',method:'GET',document:1,main:true,context:kind,page:1,frame:1});
    add('manifest-bound',{request:1,serverRequest:1,url:r.url+'assets/art/manifest.json',method:'GET',document:1,main:true,context:kind,page:1,frame:1});
    if(kind!=='normal')add('barrier-held',{serverRequest:1});
    if(kind==='normal'||kind==='held-release'){if(kind==='held-release')add('barrier-release',{serverRequest:1});add('server-finish',{serverRequest:1,status:200,rawHeader:'HTTP/1.1 200 OK\r\n'});add('response',{request:1,status:200});add('requestfinished',{request:1});}
    else{add('pending-before-intervention',{request:1,serverRequest:1,document:1,headersSent:false,finished:false,destroyed:false,socketDestroyed:false,settled:false});if(kind==='non-navigation-failure')add('fault-socket-destroy',{serverRequest:1});}
    if(kind==='normal'||kind==='held-release')add('title-settlement',{settled:true,manifest:true,title:true});
    if(kind!=='non-navigation-failure'){add('continue-start');add('main-navigation',{document:2,url:r.url+'?intro'});}
    if(kind==='navigation-cancel'||kind==='non-navigation-failure')add('requestfailed',{request:1,failure:{errorText:'fixture fault'}});
    for(const e of r.events.filter(e=>e.request===1))Object.assign(e,{url:r.url+'assets/art/manifest.json',method:'GET',document:1,main:true,context:kind,page:1,frame:1});
    if(kind==='non-navigation-failure')add('title-settlement',{settled:true,manifest:null,title:true});else{add('server-request',{serverRequest:2,url:'/assets/art/manifest.json',method:'GET'});add('practice-check',{ready:true,intro:true});}
    add('observation-end');add('cleanup-start');add('dispatcher-restored',{exact:true});add('context-closed');add('server-closed');add('cleanup-end');return JSON.parse(JSON.stringify(r));
  };
  const mutations=[
    r=>{r.sha='wrong';},r=>{r.run='wrong';},r=>{r.observerErrors=['failure'];},r=>{r.cleanupErrors=['failure'];},
    r=>{delete r.errors;},r=>{r.events=r.events.filter(e=>e.event!=='manifest-bound');},
    r=>{r.observerFailureCount=1;},r=>{delete r.events.find(e=>e.event==='server-request').rawHeaders;},
    r=>{r.events.find(e=>e.event==='manifest-bound').request=99;},r=>{r.events.find(e=>e.event==='manifest-bound').document=2;},
    r=>{r.events.find(e=>e.event==='manifest-bound').url='http://wrong/';},
    r=>{r.events.find(e=>e.event==='manifest-bound').serverRequest=99;},
    r=>{r.events.find(e=>e.event==='manifest-bound').context='foreign';},
    r=>{r.events.find(e=>e.event==='manifest-bound').frame=99;},
    r=>{r.events=r.events.filter(e=>e.event!=='cleanup-end');},
    r=>{r.events.find(e=>e.event==='dispatcher-restored').exact=false;},
  ];
  let positives=0,rejects=0;
  for(const kind of CASES){const row=make(kind);assert(verify(row,bind));positives++;for(const mutate of mutations){const bad=structuredClone(row);mutate(bad);bad.events.forEach((e,i)=>{e.sequence=i;e.ms=i;});assert.throws(()=>verify(bad,bind));rejects++;}}
  for(const [kind,mutate]of[
    ['navigation-cancel',r=>{r.events.find(e=>e.event==='pending-before-intervention').headersSent=true;}],
    ['navigation-cancel',r=>{r.events.find(e=>e.event==='requestfailed').event='after-cleanup-failure';}],
    ['navigation-cancel',r=>{r.events.find(e=>e.event==='main-navigation'&&e.document===2).url='http://wrong/';}],
    ['non-navigation-failure',r=>{r.events.find(e=>e.event==='title-settlement').manifest={};}],
    ['held-release',r=>{r.events.find(e=>e.event==='requestfinished').event='missing';}],
    ['normal',r=>{r.events.find(e=>e.event==='response').status=503;}],
    ['navigation-cancel',r=>{const failure=r.events.splice(r.events.findIndex(e=>e.event==='requestfailed'),1)[0];r.events.splice(r.events.findIndex(e=>e.event==='continue-start'),0,failure);}],
    ['non-navigation-failure',r=>{const failure=r.events.splice(r.events.findIndex(e=>e.event==='requestfailed'),1)[0];r.events.splice(r.events.findIndex(e=>e.event==='fault-socket-destroy'),0,failure);}],
    ['navigation-cancel',r=>{r.events.find(e=>e.event==='barrier-held').serverRequest=99;}],
    ['normal',r=>{r.events=r.events.filter(e=>!(e.event==='main-navigation'&&e.document===1));}],
    ['normal',r=>{r.events=r.events.filter(e=>!(e.event==='main-navigation'&&e.document===2));}],
    ['navigation-cancel',r=>{const close=r.events.splice(r.events.findIndex(e=>e.event==='context-closed'),1)[0];r.events.splice(0,0,close);}],
    ['non-navigation-failure',r=>{delete r.events.find(e=>e.event==='requestfailed').failure;}],
  ]){const bad=make(kind);mutate(bad);bad.events.forEach((e,i)=>{e.sequence=i;e.ms=i;});assert.throws(()=>verify(bad,bind));rejects++;}
  return{positives,rejects};
}
async function nativeCase(browser,kind,binding){
  const row={case:kind,...binding,events:[],errors:[],observerErrors:[],cleanupErrors:[],failure:null};
  const start=performance.now();let ctx,server,original,dispatcher,held=null,consumed=false,document=0,nextRequest=0,nextServer=0;
  const requests=new Map(), waiters=new Set();
  let observerFailures=0;
  const observerError=error=>{observerFailures++;try{row.observerErrors.push(String(error));}catch{}try{console.error('NAVIGATION_OBSERVER_FAILED',kind,observerFailures);}catch{}};
  const emit=(event,x={})=>{try{row.events.push({sequence:row.events.length,ms:performance.now()-start,event,...x});for(const wake of [...waiters])wake();}catch(e){observerError(e);}};
  const guarded=fn=>(...args)=>{try{fn(...args);}catch(e){observerError(e);}};
  const closeBounded=(fn,label)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(label+' cleanup expired')),30000);Promise.resolve().then(fn).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
  const wait=predicate=>new Promise((resolve,reject)=>{const wake=()=>{try{if(predicate()){clearTimeout(timer);waiters.delete(wake);resolve();}}catch(e){clearTimeout(timer);waiters.delete(wake);reject(e);}};const timer=setTimeout(()=>{waiters.delete(wake);reject(Error('Bounded event observation expired'));},30000);waiters.add(wake);wake();});
  try{
    const started=await startServer({port:0});server=started.server;row.url=started.url;
    const listeners=server.listeners('request');assert.equal(listeners.length,1);original=listeners[0];server.removeListener('request',original);
    dispatcher=(req,res)=>{
      const serverRequest=++nextServer;
      emit('server-request',{serverRequest,url:req.url,method:req.method,headers:req.headers,rawHeaders:[...req.rawHeaders],remotePort:req.socket.remotePort});
      res.on('finish',guarded(()=>emit('server-finish',{serverRequest,url:req.url,status:res.statusCode,rawHeader:typeof res._header==='string'?res._header:null})));
      res.on('close',guarded(()=>emit('server-close',{serverRequest,url:req.url,finished:res.writableFinished})));
      if(req.method==='GET'&&req.url==='/assets/art/manifest.json'&&!consumed){consumed=true;held={req,res,serverRequest,delegated:false};
        if(kind!=='normal'){emit('barrier-held',{serverRequest});return;}}
      if(held?.req===req)held.delegated=true;
      Reflect.apply(original,server,[req,res]);
    };server.on('request',dispatcher);
    ctx=await browser.newContext({viewport:{width:1280,height:720}});const page=await ctx.newPage();
    const describe=req=>{if(!requests.has(req))requests.set(req,{request:++nextRequest,document,url:req.url(),method:req.method(),context:kind,page:1,frame:req.frame()===page.mainFrame()?1:null,main:req.frame()===page.mainFrame(),type:req.resourceType(),navigation:req.isNavigationRequest()});return requests.get(req);};
    page.on('request',guarded(req=>emit('request',describe(req))));
    page.on('response',guarded(res=>emit('response',{...describe(res.request()),status:res.status(),headers:res.headers()})));
    page.on('requestfinished',guarded(req=>emit('requestfinished',{...describe(req),timing:req.timing()})));
    page.on('requestfailed',guarded(req=>emit('requestfailed',{...describe(req),failure:req.failure(),timing:req.timing()})));
    page.on('framenavigated',guarded(frame=>{if(frame===page.mainFrame()){document++;emit('main-navigation',{document,url:frame.url()});}else emit('frame-navigation',{url:frame.url()});}));
    page.on('pageerror',guarded(e=>emit('pageerror',{message:e.message,stack:e.stack,name:e.name,urlAtReceipt:page.url(),documentAtReceipt:document})));
    page.on('console',guarded(m=>{if(['error','warning'].includes(m.type()))emit('console',{message:m.text(),type:m.type(),location:m.location(),urlAtReceipt:page.url(),documentAtReceipt:document});}));
    page.on('domcontentloaded',guarded(()=>emit('domcontentloaded',{url:page.url(),document})));page.on('load',guarded(()=>emit('load',{url:page.url(),document})));
    page.on('close',guarded(()=>emit('page-close')));page.on('crash',guarded(()=>emit('page-crash')));
    await page.goto(row.url);await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    emit('title-check',await page.evaluate(()=>({mode:window.__entry.mode,focus:document.activeElement?.id})));
    // This exact module is already imported by the shipping entry. Observe its existing settlement, never call loadArt().
    await page.evaluate(async()=>{const {whenArt}=await import('./src/ui/art.js');window.__manifestSettlement={settled:false};
      whenArt(m=>{window.__manifestSettlement={settled:true,manifest:m===null?null:true};});});
    await wait(()=>held&&[...requests.values()].some(r=>r.url===row.url+'assets/art/manifest.json'&&r.document===1));
    const targets=[...requests.values()].filter(r=>r.url===row.url+'assets/art/manifest.json'&&r.document===1);assert.equal(targets.length,1);
    const target=targets[0];emit('manifest-bound',{...target,serverRequest:held.serverRequest});
    const targetEvents=()=>row.events.filter(e=>e.request===target.request);
    if(kind==='held-release'){emit('barrier-release',{serverRequest:held.serverRequest});held.delegated=true;Reflect.apply(original,server,[held.req,held.res]);}
    if(kind==='normal'||kind==='held-release'){await wait(()=>targetEvents().some(e=>e.event==='requestfinished')&&row.events.some(e=>e.event==='server-finish'&&e.serverRequest===held.serverRequest));await page.waitForFunction(()=>window.__manifestSettlement?.settled,null,{timeout:30000});emit('title-settlement',await page.evaluate(()=>({...window.__manifestSettlement,title:window.__entry?.mode==='title'})));}
    else{
      const settled=await page.evaluate(()=>window.__manifestSettlement.settled);assert.equal(settled,false);assert.equal(document,1);assert.equal(page.url(),row.url);
      emit('pending-before-intervention',{...target,serverRequest:held.serverRequest,document,headersSent:held.res.headersSent,finished:held.res.writableFinished,destroyed:held.res.destroyed,socketDestroyed:held.req.socket.destroyed,settled});
      assert.equal(held.res.headersSent,false);assert.equal(held.res.writableFinished,false);assert.equal(held.res.destroyed,false);assert.equal(held.req.socket.destroyed,false);assert.equal(targetEvents().filter(e=>['response','requestfinished','requestfailed'].includes(e.event)).length,0);
      if(kind==='non-navigation-failure'){emit('fault-socket-destroy',{serverRequest:held.serverRequest,remotePort:held.req.socket.remotePort});held.req.socket.destroy();}
    }
    if(kind!=='non-navigation-failure'){
      emit('continue-start');await page.locator('#entry-continue').click();emit('continue-end',{url:page.url()});
      await page.waitForFunction(()=>window.__ready&&window.__game,null,{timeout:180000,polling:250});
      const practice=await page.evaluate(()=>({ready:!!window.__ready,intro:!!document.getElementById('intro')?.open}));emit('practice-check',practice);
      if(kind==='navigation-cancel')await wait(()=>targetEvents().some(e=>e.event==='requestfailed'));
    }else{
      await wait(()=>targetEvents().some(e=>e.event==='requestfailed'));
      await page.waitForFunction(()=>window.__manifestSettlement?.settled,null,{timeout:30000});
      emit('title-settlement',await page.evaluate(()=>({...window.__manifestSettlement,title:window.__entry?.mode==='title'})));
    }
  }catch(error){row.failure={message:error.message,stack:error.stack};}
  finally{
    emit('observation-end');row.errors=row.events.filter(e=>e.event==='pageerror'||e.event==='console').map(e=>({event:e.event,message:e.message,stack:e.stack??null,type:e.type??null}));
    emit('cleanup-start');
    try{if(held&&!held.delegated&&!held.res.destroyed&&!held.res.writableFinished){emit('barrier-release-cleanup',{serverRequest:held.serverRequest});held.delegated=true;Reflect.apply(original,server,[held.req,held.res]);}}catch(e){row.cleanupErrors.push(String(e));}
    try{if(server&&original){server.removeListener('request',dispatcher);server.on('request',original);emit('dispatcher-restored',{exact:server.listeners('request').length===1&&server.listeners('request')[0]===original});}}catch(e){row.cleanupErrors.push(String(e));}
    try{if(ctx){await closeBounded(()=>ctx.close(),'context');emit('context-closed');}}catch(e){row.cleanupErrors.push(String(e));}
    try{if(server){server.closeAllConnections();await closeBounded(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),'server');emit('server-closed');}}catch(e){row.cleanupErrors.push(String(e));}
    emit('cleanup-end');
    row.observerFailureCount=observerFailures;
  }
  try{assert.equal(row.failure,null);assert.equal(row.observerFailureCount,0);verify(row,binding);row.complete=true;}catch(e){row.complete=false;row.validationFailure={message:e.message,stack:e.stack};}
  return row;
}
async function main(){
  const controls=readerControls();console.log('NAVIGATION_READER',JSON.stringify(controls));
  if(!process.argv.includes('--native')){assert(process.argv.includes('--prove-fail')||process.argv.includes('--unit'),'Select CPU controls or Actions-only --native');return;}
  assert.equal(process.env.GITHUB_ACTIONS,'true','Native diagnostic runs on Actions only');assert(process.env.GITHUB_SHA&&process.env.GITHUB_RUN_ID);
  const binding={sha:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID},out=path.join(ROOT,'.out','browsers-webkit','manifest-controls.json');
  const report={...binding,scope:'controlled plausibility only; canonical smoke unchanged; original cause unproved',controls,cases:[],browserCloseErrors:[]};
  let browser;
  try{const {webkit}=await import('playwright');browser=await webkit.launch();report.browser=browser.version();for(const kind of CASES){const row=await nativeCase(browser,kind,binding);report.cases.push(row);console.log('NAVIGATION_CASE',JSON.stringify({case:kind,complete:row.complete,failure:row.failure,validationFailure:row.validationFailure,errors:row.errors}));if(row.cleanupErrors.length)break;}}
  catch(e){report.failure={message:e.message,stack:e.stack};}
  finally{
    try{if(browser){let timer;try{await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('browser cleanup expired')),30000);})]);}finally{clearTimeout(timer);}}}catch(e){report.browserCloseErrors.push(String(e));}
    report.complete=!report.failure&&!report.browserCloseErrors.length&&report.cases.length===4&&report.cases.every(c=>c.complete);
    const serialized=JSON.stringify(report)+'\n';
    try{await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,serialized,{flag:'wx'});}
    catch(error){process.exitCode=1;try{console.error('NAVIGATION_PERSISTENCE_FAILED',JSON.stringify({error:String(error),report}));}catch{}throw error;}
    console.log('NAVIGATION_DIAGNOSTIC_PERSISTED',JSON.stringify({...binding,member:'browsers-webkit/manifest-controls.json',bytes:Buffer.byteLength(serialized),sha256:createHash('sha256').update(serialized).digest('hex'),complete:report.complete}));
    if(!report.complete)process.exitCode=1;
  }
}
await main().catch(e=>{console.error(e.message??String(e));process.exitCode=1;});


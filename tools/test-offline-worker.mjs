// Actual classic worker in a RAM-only CacheStorage model; native upgrade remains separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {createHash,webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOfflineManifest,serializeOfflineManifest} from './build-offline-manifest.mjs';

let source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const mutations={
  'early-retirement':{from:'await validateManifest();await prepare(await caches.open(VERSION),await predecessors());',
    to:"await validateManifest();await prepare(await caches.open(VERSION),await predecessors());await caches.delete('cw-v68');",message:'install preserves predecessor'},
  'missing-dependency':{from:'const members=new Set(MANIFEST.base),visited=new Set();',
    to:"const members=new Set(MANIFEST.base.filter(p=>p!=='src/new.js')),visited=new Set();",message:'added code dependency admitted'},
  'stale-activation':{from:'await prepare(cache,previous);',to:'/* omitted late key reconciliation */',message:'late terrain represented in admitted generation'},
  'corrupt-cache':{from:'if(await valid(hit,p))return hit;',to:'if(hit)return hit;',message:'corrupt admitted cache must reject'},
  'trace-drop-failure':{target:'producer',from:'const listener = raw => recorder.record(name, raw, stage());',
    to:"const listener = raw => {const copy={...raw};delete copy.canceled;recorder.record(name,copy,stage());};",message:'all native failure fields retained'},
  'trace-leak-listener':{target:'producer',from:'Reflect.apply(methods.removeListener, session, [name, listener]); cleanup.removed++;',
    to:'cleanup.removed++;',message:'trace removes only its exact listeners'},
  'trace-ignore-bound':{target:'producer',from:'if (events.length >= 8192 || bytes + size > 4194304)',
    to:'if (false)',message:'malformed or excessive CDP metadata is sticky invalid'},
  'trace-block-cleanup':{target:'producer',from:"admissionPrimaryWrite = admissionPersist('primary').then(() => admissionCleanupMark('primary-trace:return'));",
    to:"await admissionPersist('primary');",message:'hanging trace preserves original owner cleanup'},
};
const args=process.argv.slice(2),mutation=args.length===1&&args[0].startsWith('--mutation=')?args[0].slice(11):null;
if(args.length&&args[0]!=='--prove-fail'&&!mutations[mutation])throw Error('unknown offline worker test mode');
if(args.includes('--prove-fail')){
  assert.deepEqual(args,['--prove-fail']);
  for(const[id,m]of Object.entries(mutations)){
    const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--mutation='+id],{encoding:'utf8',maxBuffer:1000000});
    assert.notEqual(r.status,0,id+' must fail');
    assert.match(r.stderr,/AssertionError/,id+' must reach its own assertion');
    assert(r.stderr.includes(m.message),id+' must fail its intended control: '+r.stderr.slice(0,300));
  }
  console.log('OFFLINE WORKER own rejecting controls OK (8 distinct source mutants)');
  process.exit(0);
}
if(mutation&&mutations[mutation].target!=='producer'){const m=mutations[mutation];assert.equal(source.split(m.from).length,2,'unique source mutation anchor');source=source.replace(m.from,m.to);}
const hash=b=>createHash('sha256').update(b).digest('hex');
const scope='https://game.example/the-civil-war/';
const url=p=>new URL(p,scope).href;
let assertions=0;
const check=(condition,message)=>{assert(condition,message);assertions++;};
class BasicResponse{
  constructor(body,{status=200,type='basic'}={}){this.body=Buffer.from(body);this.status=status;this.type=type;}
  clone(){return new BasicResponse(this.body,{status:this.status,type:this.type});}
  async arrayBuffer(){return Uint8Array.from(this.body).buffer;}
  async json(){return JSON.parse(this.body.toString());}
}
const pathOf=p=>new URL(typeof p==='string'?p:p.url).pathname.split('/the-civil-war/')[1];
async function fixture({offline=false,corrupt=null,writeFailure=null,networkFailure=null,extraDependency=false}={}){
  const bodies={'index.html':'CURRENT HTML','src/main.js':'CURRENT MAIN','src/dependency.js':'CURRENT EXPORT',
    'assets/packs/shiloh.json':'PACK','assets/terrain/shiloh.json':'TERRAIN','assets/terrain/shiloh.bin':'HEIGHTS',
    'assets/terrain/lookout.json':'LATE TERRAIN','assets/terrain/lookout.bin':'LATE HEIGHTS','assets/terrain/unvisited.bin':'UNVISITED'};
  if(extraDependency)bodies['src/new.js']='NEW IMPORT';
  const files=Object.fromEntries(Object.entries(bodies).map(([p,b])=>[p,{bytes:Buffer.byteLength(b),sha256:hash(b)}]));
  const payload={schema:1,workerSha256:hash(source),files,base:['index.html','src/main.js','src/dependency.js',...(extraDependency?['src/new.js']:[])],
    groups:{'pack:shiloh':{members:['assets/packs/shiloh.json'],triggers:['assets/packs/shiloh.json']},
      'terrain:shiloh':{members:['assets/terrain/shiloh.json','assets/terrain/shiloh.bin'],triggers:['assets/terrain/shiloh.json','assets/terrain/shiloh.bin']},
      'terrain:lookout':{members:['assets/terrain/lookout.json','assets/terrain/lookout.bin'],triggers:['assets/terrain/lookout.json','assets/terrain/lookout.bin']}}};
  const manifest={...payload,generation:hash(JSON.stringify(payload))},stores=new Map(),events={},calls=[];
  const cache=name=>{
    if(stores.has(name))return stores.get(name);
    const rows=new Map(),value={rows,async keys(){return[...rows.keys()].map(p=>new Request(p));},
      async match(key){return rows.get(typeof key==='string'?key:key.url)?.clone();},
      async put(key,response){const p=typeof key==='string'?key:key.url;
        if(writeFailure&&p.endsWith(writeFailure))throw Error('write failed');rows.set(p,response.clone());}};
    stores.set(name,value);return value;
  };
  const old=cache('cw-v68');
  for(const[p,b]of Object.entries(bodies).filter(([p])=>!p.includes('lookout')&&!p.includes('unvisited')&&!p.includes('new.js')))
    old.rows.set(url(p==='index.html'?'?campaign=1&sw':p),new BasicResponse(p==='src/main.js'?'OLD MAIN':p==='src/dependency.js'?'OLD EXPORT':b));
  cache('unrelated').rows.set('https://elsewhere.example/file',new BasicResponse('FOREIGN'));
  let isOffline=offline;
  const context=vm.createContext({URL,Request,Response,BasicResponse,TextEncoder,crypto:webcrypto,
    self:{registration:{scope},addEventListener:(name,handler)=>events[name]=handler},
    importScripts:p=>{assert.equal(p,'./offline-manifest.js');context.self.CW_OFFLINE=manifest;},
    caches:{keys:async()=>[...stores.keys()],open:async name=>cache(name),delete:async name=>{calls.push('delete:'+name);return stores.delete(name);}},
    fetch:async request=>{const p=pathOf(request);calls.push('fetch:'+p);if(isOffline||p===networkFailure)throw Error('offline');
      return new BasicResponse(p===corrupt?'CORRUPT':bodies[p]??'NOT FOUND',{status:p in bodies?200:404});}});
  vm.runInContext(source,context);
  const fire=async(name,request)=>{
    let pending;
    events[name]({request,waitUntil:p=>pending=p,respondWith:p=>pending=p});
    return pending===undefined?undefined:await pending;
  };
  return{manifest,stores,old,calls,cache,fire,bodies,setOffline:value=>isOffline=value,
    current:()=>[...stores.entries()].find(([name])=>name.startsWith('cw-offline-v1:'))?.[1]};
}

{
  const f=await fixture({extraDependency:true});await f.fire('install');
  check(f.stores.has('cw-v68'),'install preserves predecessor');
  check(f.calls.includes('fetch:src/new.js'),'added code dependency admitted');
  check(f.calls.includes('fetch:src/main.js')&&f.calls.includes('fetch:src/dependency.js'),'incompatible old modules refused');
  check(!f.calls.some(c=>c.includes('unvisited')),'no unvisited terrain download');
  f.old.rows.set(url('assets/terrain/lookout.json'),new BasicResponse(f.bodies['assets/terrain/lookout.json']));
  f.old.rows.set(url('assets/terrain/lookout.bin'),new BasicResponse(f.bodies['assets/terrain/lookout.bin']));
  f.setOffline(true);await f.fire('activate');
  check(f.current().rows.has(url('assets/terrain/lookout.bin')),'late terrain represented in admitted generation');
  check(!f.stores.has('cw-v68'),'covered predecessor retired only after activation reconciliation');
  check(f.stores.has('unrelated'),'unrelated cache preserved');
  for(const p of ['?campaign=1&sw','src/main.js','src/dependency.js','assets/terrain/shiloh.bin','assets/terrain/lookout.bin']){
    const r=await f.fire('fetch',new Request(url(p)));check((await r.arrayBuffer()).byteLength>0,'offline loaded route '+p);
  }
  check(await f.fire('fetch',new Request('https://other.example/src/main.js'))===undefined,'foreign origin bypass');
  check(await f.fire('fetch',new Request(url('assets/unknown.bin')))===undefined,'unknown URL bypass');
  check(await f.fire('fetch',new Request(url('src/main.js'),{headers:{range:'bytes=0-1'}}))===undefined,'range bypass');
  check(await f.fire('fetch',new Request(url('src/main.js')+'?foreign=1'))===undefined,'non-document query bypass');
}
for(const options of [{offline:true},{corrupt:'src/main.js'},{writeFailure:'src/main.js'},{networkFailure:'src/dependency.js'}]){
  const f=await fixture(options);await assert.rejects(f.fire('install'));assertions++;
  check(f.stores.has('cw-v68'),'failed install retains predecessor');
  check(!(await f.current()?.match(url('__cw_offline_admission__'))),'failed install has no completion record');
  check(!f.calls.some(c=>c.startsWith('delete:')),'failed install never deletes cache');
}
{
  const f=await fixture();await f.fire('install');
  f.old.rows.set(url('unknown-old.bin'),new BasicResponse('UNRECOGNIZED'));
  await f.fire('activate');check(f.stores.has('cw-v68'),'unknown predecessor resource prevents retirement');
  f.current().rows.set(url('src/main.js'),new BasicResponse('CORRUPTED CURRENT'));f.setOffline(true);
  await assert.rejects(f.fire('fetch',new Request(url('src/main.js'))),undefined,'corrupt admitted cache must reject');assertions++;
}
{
  const manifest=createOfflineManifest(),again=createOfflineManifest();
  check(serializeOfflineManifest(manifest)===serializeOfflineManifest(again),'deterministic generated bytes');
  check(manifest.workerSha256===hash(source),'worker logic belongs to generation');
  check(manifest.base.includes('src/main.js')&&manifest.base.includes('src/world/terrain.js'),'complete executable base');
  check(!manifest.base.some(p=>p.endsWith('.bin')||p.endsWith('.ktx2')),'no battle binaries in base');
  check(manifest.groups['terrain:lookout-mountain'].members.includes('assets/terrain/lookout-mountain.bin'),'actual terrain closure');
  check(!manifest.groups['pack:chattanooga'].members.some(p=>p.startsWith('assets/terrain/')),'pack does not preload battles');
  check(manifest.groups['figures:CS:compact-close'].triggers.every(p=>!p.endsWith('.json')),'figure metadata does not select pages');
}
for(const p of ['%2e%2e/outside.js','src/main.js?alias=1','src/main.js#alias','../outside.js','https://other.example/main.js']){
  const f=await fixture();f.manifest.files[p]={bytes:1,sha256:hash('x')};f.manifest.base.push(p);
  const {generation,...payload}=f.manifest;f.manifest.generation=hash(JSON.stringify(payload));
  await assert.rejects(f.fire('install'),/file descriptor/);assertions++;
  check(f.calls.length===0,'malformed path never reaches fetch or cache deletion');
}
for(const [relative,tier,which]of [
  ['assets/figures/union-infantry/soldier.json','field',0],
  ['assets/figures/union-infantry/soldier.json','field',1],
  ['assets/figures/confederate-infantry/soldier-hybrid.json','close',0],
  ['assets/figures/confederate-infantry/soldier-hybrid.json','close',1],
]){
  const actual=fs.readFileSync,metadata=JSON.parse(actual(new URL('../'+relative,import.meta.url),'utf8')),pages=[];
  const collect=v=>{if(v&&typeof v==='object'){if(Object.hasOwn(v,'pages'))pages.push(v.pages);for(const c of Object.values(v))collect(c);}};
  collect(metadata.tiers[tier]);assert(pages.length>which);pages[which][0].file='missing-offline-page.png';
  try{
    fs.readFileSync=function(p,...args){if(String(p).endsWith(relative))return JSON.stringify(metadata);return Reflect.apply(actual,this,[p,...args]);};
    assert.throws(()=>createOfflineManifest(),/missing figure page/);assertions++;
  }finally{fs.readFileSync=actual;}
}
{
  const producer=fs.readFileSync(new URL('./test-offline-upgrade.mjs',import.meta.url),'utf8');
  const start=producer.indexOf('export function observeWorkerUpdate('),end=producer.indexOf('\nconst update=',start);
  assert(start>=0&&end>start);const code='('+producer.slice(start,end).replace(/^export /,'')+')';
  for(const mode of ['null-installing','deadline','rejection-null','sync-throw']){
    let timer,cleared=0;
    const emitter=extra=>Object.assign({listeners:new Map(),addEventListener(n,f){if(!this.listeners.has(n))this.listeners.set(n,new Set());this.listeners.get(n).add(f);},
      removeEventListener(n,f){this.listeners.get(n)?.delete(f);},emit(n){for(const f of this.listeners.get(n)||[])f();}},extra);
    const worker=emitter({state:'installing'}),registration=emitter({installing:null,update(){
      if(mode==='sync-throw')throw null;
      if(mode==='rejection-null')return Promise.reject(null);
      this.installing=worker;this.emit('updatefound');this.installing=null;return Promise.resolve();
    }});
    const observe=vm.runInNewContext(code,{setTimeout:(f,ms)=>{assert.equal(ms,60000);timer=f;return 1;},clearTimeout:id=>{assert.equal(id,1);cleared++;}});
    const promise=observe(registration);
    if(mode==='null-installing'){
      await Promise.resolve();worker.state='installed';worker.emit('statechange');
      assert.equal(await promise,'installed');assertions++;
    }else if(mode==='deadline'){timer();await assert.rejects(promise,/install state deadline/);assertions++;}
    else{let rejected=false;try{await promise;}catch(value){assert.equal(value,null);rejected=true;}check(rejected,'original falsy update failure retained');}
    check(cleared===1,'update timer cleared once');
    check((registration.listeners.get('updatefound')?.size??0)===0&&(worker.listeners.get('statechange')?.size??0)===0,'only owned update listeners removed');
    worker.state='redundant';worker.emit('statechange');registration.emit('updatefound');check(cleared===1,'late update callbacks no-op');
  }
}
{
  let producer=fs.readFileSync(new URL('./test-offline.mjs',import.meta.url),'utf8');
  if(mutation&&mutations[mutation].target==='producer'){const m=mutations[mutation];assert.equal(producer.split(m.from).length,2,'unique trace source mutation anchor');producer=producer.replace(m.from,m.to);}
  const functions=producer.slice(producer.indexOf('export function offlineRecorder()'),producer.indexOf('\nconst OUT =')).replaceAll('export ','');
  const bodies={'src/main.js':'MAIN','src/ui/entry.js':'ENTRY','assets/terrain/shiloh.bin':'HEIGHTS'};
  const expected=Object.fromEntries(Object.entries(bodies).map(([p,b])=>[p,{bytes:Buffer.byteLength(b),sha256:hash(b)}]));
  for(const mode of ['valid','missing','corrupt','metadata','ownership','reader-reject','oversized-body','oversized-admission']){
    const calls=[],worker={scriptURL:scope+'sw.js',state:'activated'};
    const api={keys:async()=>['current'],match:async(address,options)=>{
      calls.push([address,options]);assert.equal(options.cacheName,'current');
      const p=address.slice(scope.length);
      if(p==='__cw_offline_admission__')return new Response(mode==='oversized-admission'?'x'.repeat(32769):'{"scope":"'+scope+'"}');
      if(mode==='reader-reject'&&p==='src/main.js')throw null;
      if(mode==='missing'&&p==='src/main.js')return undefined;
      const response=new Response(p==='src/main.js'&&mode==='corrupt'?'BAD!':p==='src/main.js'&&mode==='oversized-body'?'x'.repeat(1000):bodies[p],
        {headers:{'content-type':mode==='metadata'?'text/plain':'text/javascript','content-length':Buffer.byteLength(bodies[p])}});
      Object.defineProperty(response,'type',{value:mode==='metadata'?'opaque':'basic'});return response;
    },open:()=>assert.fail('observer must not open caches'),delete:()=>assert.fail('observer must not delete caches')};
    const env={URL,Response,TextEncoder,TextDecoder,performance,setTimeout,clearTimeout,crypto:webcrypto,caches:api,
      navigator:{serviceWorker:{controller:worker,getRegistration:async()=>({scope:mode==='ownership'?'https://foreign.example/':scope,active:worker})}},
      fetch:()=>assert.fail('observer must not fetch')};
    const inspect=vm.runInNewContext(functions+';inspectOfflineCaches',env);
    const r=await inspect({scope,expected,hashes:true}),rows=r.caches[0].members;
    check(calls.length===4,'diagnostic uses only four exact named reads');
    if(mode==='valid')check(rows.every(r=>r.matches),'actual cached bytes match expectations');
    if(mode==='missing')check(rows[0].present===false,'missing cached member retained');
    if(mode==='corrupt')check(rows[0].matches===false,'mismatched cached bytes retained');
    if(mode==='metadata')check(rows[0].type==='opaque'&&rows[0].mime==='text/plain','wrong metadata retained independently of bytes');
    if(mode==='ownership')check(r.registration.scope==='https://foreign.example/','ownership mismatch retained');
    if(mode==='reader-reject')check(r.observerErrors.length===1&&rows.length===2,'falsy reader error retained without losing other members');
    if(mode==='oversized-body')check(rows[0].bodyTruncated===true&&r.observerErrors.length===1,'actual body bound rejects misleading declared length');
    if(mode==='oversized-admission')check(r.caches[0].admissionTruncated&&r.observerErrors.length===1,'admission body bound is explicit');
  }
  {
    let deadline,resolveMetadata;const calls=[];
    const inspect=vm.runInNewContext(functions+';inspectOfflineCaches',{URL,Response,TextEncoder,TextDecoder,performance,crypto:webcrypto,
      navigator:{serviceWorker:{getRegistration:async()=>null}},caches:{keys:async()=>['current'],match:address=>{
        calls.push(address);return new Promise(resolve=>{resolveMetadata=resolve;});}},
      setTimeout:(f,ms)=>{assert.equal(ms,9000);deadline=f;return 1;},clearTimeout:()=>{}});
    const pending=inspect({scope,expected,hashes:true});
    for(let n=0;n<8;n++)await Promise.resolve();
    assert.equal(calls.length,1);deadline();resolveMetadata(undefined);
    await assert.rejects(pending,/inventory deadline/);assertions++;
    check(calls.length===1,'late cache completion cannot start another cache read');
  }
  const make=vm.runInNewContext(functions+';offlineRecorder',{TextEncoder,performance});
  const r=make(),input={value:{n:1}};r.record('one',input);input.value.n=99;
  check(r.read().events[0].value.n===1,'trace captures detached input');
  const copy=r.read();copy.events[0].value.n=99;check(r.read().events[0].value.n===1,'trace read is detached');
  for(let n=0;n<2100;n++)r.record('row');
  check(r.read().events.length===2048&&r.read().overflow,'trace row overflow explicit');
  const unicode=make();unicode.record('wide',{text:'\u{1f600}'.repeat(270000)});
  check(unicode.read().overflow&&unicode.read().events.length===0,'UTF8 byte overflow rejects full event');
  const circular={};circular.self=circular;const bad=make();bad.record('circular',circular);
  check(bad.read().observerErrors.length===1,'serialization fault explicit');
  const auditCode=producer.slice(producer.indexOf('const audit = async hashes =>'),producer.indexOf('\nconst persist ='));
  for(const mode of ['success','reject','deadline']){
    const audits=[],auditErrors=[];let timer,cleared=0;
    const audit=vm.runInNewContext(auditCode+';audit',{audits,auditErrors,stage:'first-failure',url:scope,expected,
      inspectOfflineCaches:()=>{},page:{evaluate:()=>mode==='success'?Promise.resolve({caches:[]}):mode==='reject'?Promise.reject(null):new Promise(()=>{})},
      setTimeout:(f,ms)=>{assert.equal(ms,10000);timer=f;return 1;},clearTimeout:id=>{assert.equal(id,1);cleared++;}});
    const pending=audit(true);if(mode==='deadline')timer();await pending;
    check(mode==='success'?audits.length===1&&!auditErrors.length:!audits.length&&auditErrors.length===1,'audit success/rejection/deadline remains separate');
    check(cleared===1,'audit timer cleared');
  }
  const start=producer.indexOf('  const terminal = setTimeout('),end=producer.indexOf('\n}\nconst failed',start);
  assert(start>0&&end>start);const finish=producer.slice(start,end);
  for(const mode of ['normal','first-write','both-writes','browser','server','stuck-write']){
    const primary={results:[{id:'harness',ok:false,detail:'ORIGINAL FAILURE'}]},cleanupErrors=[],calls=[];
    let timer,cleared=0,writes=0;
    const run=vm.runInNewContext('(async()=>{'+finish+'})',{cleanupErrors,admission:null,admissionCleanupMark:()=>{},
      persist:async()=>{calls.push('persist');writes++;if(mode==='stuck-write')return new Promise(()=>{});
        if(mode==='both-writes'||mode==='first-write'&&writes===1)throw null;},
      browser:{close:async()=>{calls.push('browser');if(mode==='browser')throw null;}},
      server:{close:()=>{calls.push('server');if(mode==='server')throw null;}},
      setTimeout:(f,ms)=>{assert.equal(ms,20000);timer=f;return 2;},clearTimeout:id=>{assert.equal(id,2);cleared++;},
      process:{exit:code=>{assert.equal(code,1);calls.push('terminal');}}});
    const pending=run();
    if(mode==='stuck-write'){timer();check(calls.join(',')==='persist,terminal','watchdog armed before hanging persistence');continue;}
    await pending;
    check(calls.join(',')==='persist,browser,server,persist','independent cleanup and second persistence always attempted');
    check(primary.results[0].detail==='ORIGINAL FAILURE','cleanup never mutates original failure');
    check(cleared===1&&cleanupErrors.length===(mode==='normal'?0:mode==='both-writes'?2:1),'cleanup errors and timer exact');
  }
  const traceAPI=vm.runInNewContext(functions+';({make:offlineAdmissionRecorder,session:offlineAdmissionSession,setup:offlineAdmissionSetup,close:closeOfflineAdmission,error:offlineAdmissionError,read:readOfflineAdmissionTrace,write:writeOfflineAdmissionReport})',{TextEncoder,performance});
  function cdpFixture(mode='normal',failure=null){
    const listeners=new Map(),calls=[],foreign=()=>{},recorder=traceAPI.make();
    listeners.set('Network.loadingFailed',new Set([foreign]));
    const session={on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);calls.push('on:'+name);if(mode==='listener'&&calls.length===4)throw 0;},
      removeListener(name,fn){listeners.get(name)?.delete(fn);calls.push('remove:'+name);if(mode==='hostile')throw failure;},
      async send(name,parameters){calls.push(name);assert(!/Fetch|Cache|Debugger|Target/.test(name));if(mode==='setup'&&name==='Page.enable')throw null;},
      async detach(){calls.push('detach');if(mode==='detach')throw false;}};
    const owner=traceAPI.session(session,recorder,()=> 'existing-flow');
    return{listeners,calls,foreign,recorder,owner,session,emit(name,raw){for(const fn of listeners.get(name)||[])fn(raw);}};
  }
  const request=(id,loader='document-1',extra={})=>({requestId:id,loaderId:loader,frameId:'frame-1',timestamp:3,
    documentURL:scope,request:{url:scope+'same.js',method:'GET'},type:'Script',initiator:{type:'script'},...extra});
  let admissionChecks=0;
  {
    const f=cdpFixture();await f.owner.start();
    f.recorder.record('boundary',{operation:'first-title-goto:start'});
    f.emit('Network.requestWillBeSentExtraInfo',{requestId:'reused',headers:{}});
    f.emit('Network.requestWillBeSent',request('reused'));
    f.emit('Network.requestWillBeSent',request('reused','document-1',{redirectResponse:{status:302,url:scope+'same.js'}}));
    f.emit('Network.loadingFinished',{requestId:'reused',timestamp:4,encodedDataLength:12});
    f.emit('Network.requestWillBeSent',request('reused','document-2'));
    f.emit('Network.loadingFailed',{requestId:'reused',timestamp:5,type:'Script',errorText:'net::ERR_ABORTED',canceled:true,blockedReason:'other',corsErrorStatus:{corsError:'DisallowedByMode'}});
    f.emit('Network.requestWillBeSent',request('unfinished','document-3'));
    f.emit('ServiceWorker.workerVersionUpdated',{versions:[{versionId:'v1',status:'activated',runningStatus:'running'}]});
    const primary={setupComplete:f.owner.setupComplete,primaryFailure:null,trace:f.recorder.freeze()},cleanup=await f.owner.close(),
      report={schema:'offline-admission-v1',primary,cleanup:{...cleanup,timedOut:false}};
    const read=traceAPI.read(report);assert.deepEqual(JSON.parse(JSON.stringify(read)),{requests:4,redirects:1,terminals:2,orphans:0,missingTerminals:1});admissionChecks++;
    check(f.listeners.get('Network.loadingFailed').size===1&&f.listeners.get('Network.loadingFailed').has(f.foreign),'trace removes only its exact listeners');
    assert.equal((await f.owner.close()),cleanup);assert.equal(f.calls.filter(c=>c==='detach').length,1);admissionChecks+=2;
    const failure=primary.trace.events.find(e=>e.event==='Network.loadingFailed').raw;
    check(failure.canceled===true&&failure.blockedReason==='other'&&failure.corsErrorStatus.corsError==='DisallowedByMode','all native failure fields retained');
    for(const change of[r=>r.primary.setupComplete=false,r=>r.primary.trace.overflow=true,r=>r.primary.trace.events[0].sequence=8,
      r=>r.primary.trace.clocks.cdpTimestamp='same clock',r=>r.primary.trace.events.find(e=>e.event==='setup-return').raw.command='wrong-domain',
      r=>r.cleanup.detached=false,r=>r.cleanup.timedOut=true,r=>{delete r.cleanup.timedOut;},r=>r.primary.trace.events.find(e=>e.event==='Network.requestWillBeSent').raw.loaderId=3,
      r=>{const e=r.primary.trace.events.find(e=>e.event==='Network.loadingFailed');e.raw.canceled='yes';},
      r=>{const i=r.primary.trace.events.findIndex(e=>e.event==='Network.loadingFinished'),e=structuredClone(r.primary.trace.events[i]);r.primary.trace.events.splice(i+1,0,e);r.primary.trace.events.forEach((e,i)=>e.sequence=i);}]){
      const bad=structuredClone(report);change(bad);bad.primary.trace.bytes=bad.primary.trace.events.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e)),0);assert.throws(()=>traceAPI.read(bad));admissionChecks++;
    }
    const writes=[],logs=[],receipt=await traceAPI.write({report:{...report,run:'42',sha:'a'.repeat(40)},phase:'final',
      write:async b=>writes.push(Buffer.from(b)),hash,log:m=>logs.push(m)});
    assert.equal(receipt.bytes,writes[0].length);assert.equal(receipt.sha256,hash(writes[0]));assert.equal(JSON.parse(logs[0].split('OFFLINE_ADMISSION_TRACE_PERSISTED ')[1]).sha256,hash(writes[0]));admissionChecks+=3;
    await assert.rejects(traceAPI.write({report,phase:'primary',write:async()=>{throw 0;},hash,log:()=>assert.fail('failed write cannot print receipt')}),e=>e===0);admissionChecks++;
  }
  for(const mode of['listener','setup','detach']){
    const f=cdpFixture(mode);let failed=false,error;try{await f.owner.start();}catch(e){failed=true;error=e;}
    assert.equal(failed,mode!=='detach');if(failed)assert.equal(error,mode==='listener'?0:null);
    const cleanup=await f.owner.close();check(cleanup.attempted&&f.calls.includes('detach'),'partial trace setup still attempts complete owned cleanup');
    assert.equal(f.listeners.get('Network.loadingFailed').size,1);assert.equal(cleanup.errors.length,mode==='detach'?1:0);admissionChecks+=4;
  }
  for(const kind of['overflow','unicode','nesting','nonfinite','accessor']){
    const r=traceAPI.make();let reads=0;
    if(kind==='overflow')for(let n=0;n<8200;n++)r.record('boundary',{});
    if(kind==='unicode')r.record('boundary',{text:'\u{1f600}'.repeat(100000)});
    if(kind==='nesting'){const root={};let x=root;for(let n=0;n<40;n++)x=x.next={};r.record('boundary',root);}
    if(kind==='nonfinite')r.record('boundary',{timestamp:Infinity});
    if(kind==='accessor'){const raw={};Object.defineProperty(raw,'bad',{get(){reads++;throw 0;},enumerable:true});r.record('boundary',raw);}
    const result=r.read();check(result.overflow||result.errors.length,'malformed or excessive CDP metadata is sticky invalid');assert.equal(reads,0);admissionChecks++;
  }
  for(const mode of['normal','primary-trace-write','stuck-trace-write','detach','freeze']){
    const calls=[],cleanupErrors=[],admission={recorder:traceAPI.make(),owner:{setupComplete:true,close:async()=>{calls.push('detach');return{attempted:true,removed:14,detached:mode!=='detach',errors:mode==='detach'?['controlled']:[]};}},
      primary:null,primaryFailure:{type:'number',message:'0'},persistenceErrors:[],cleanup:null};
    if(mode==='freeze')admission.recorder.freeze=()=>{throw null;};
    let timer,cleared=0;
    const run=vm.runInNewContext('(async()=>{'+finish+'})',{cleanupErrors,admission,results:[{id:'harness',ok:false,detail:'0'}],offlineAdmissionError:traceAPI.error,
      admissionMark:()=>{},admissionCleanupMark:()=>{},closeOfflineAdmission:(owner,mark)=>traceAPI.close(owner,mark,{set:()=>9,clear:()=>{}}),
      admissionPersist:async phase=>{calls.push('trace:'+phase);if(phase==='primary'&&mode==='stuck-trace-write')return new Promise(()=>{});if(phase==='primary'&&mode==='primary-trace-write')admission.persistenceErrors.push({phase});},
      persist:async()=>calls.push('persist'),browser:{close:async()=>calls.push('browser')},server:{close:()=>calls.push('server')},
      setTimeout:(fn,ms)=>{assert.equal(ms,20000);timer=fn;return 2;},clearTimeout:()=>cleared++,process:{exit:n=>{assert.equal(n,1);calls.push('terminal');}}});
    const pending=run();for(let n=0;n<128&&(!calls.includes('server')||calls.filter(c=>c==='persist').length<2);n++)await Promise.resolve();
    if(mode==='stuck-trace-write'){assert(calls.includes('browser')&&calls.includes('server'),'hanging trace preserves original owner cleanup');assert.equal(calls.filter(c=>c==='persist').length,2);timer();assert(calls.includes('terminal'));admissionChecks+=4;continue;}
    await pending;assert(calls.includes('browser')&&calls.includes('server'));assert.equal(calls.filter(c=>c==='persist').length,2);assert.equal(cleared,1);assert.equal(admission.primaryFailure.message,'0');admissionChecks+=4;
  }
  {
    let reads=0;const hostile={[Symbol.toPrimitive](){reads++;throw 0;}};
    Object.defineProperty(hostile,'message',{get(){reads++;throw 0;}});
    const f=cdpFixture('hostile',hostile);f.recorder.fault('controlled',hostile);assert.equal(reads,0);assert.equal(f.recorder.read().errors.length,1);
    await f.owner.start();const cleanup=await f.owner.close();assert.equal(cleanup.errors.length,14);assert.equal(cleanup.detached,true);
    assert.equal(f.calls.filter(c=>c.startsWith('remove:')).length,14);assert.equal(reads,0);admissionChecks+=6;
    const raw=request('original');Object.defineProperty(raw,'toJSON',{get(){reads++;return()=>({requestId:'forged'});}});
    const r=traceAPI.make();r.record('Network.requestWillBeSent',raw);assert.equal(reads,0);assert.equal(r.read().events.length,0);assert.equal(r.read().errors.length,1);admissionChecks+=3;
    const trapped=new Proxy({},{getOwnPropertyDescriptor(){throw 0;}});assert.equal(traceAPI.error(trapped).descriptorFailure,true);admissionChecks++;
  }
  for(const mode of['pending-create','pending-send']){
    const f=cdpFixture();let timer,cleared=0,release,navigations=0,outcome;
    const held=new Promise(resolve=>release=resolve);
    if(mode==='pending-send')f.session.send=async name=>{f.calls.push(name);if(name==='Network.enable')await held;};
    const owner=traceAPI.setup(()=>mode==='pending-create'?held:Promise.resolve(f.session),f.recorder,()=> 'setup',{
      set:(fn,ms)=>{assert.equal(ms,20000);timer=fn;return 7;},clear:id=>{assert.equal(id,7);cleared++;}});
    const pending=owner.start().then(()=>navigations++,error=>{outcome=error;});
    for(let n=0;n<8;n++)await Promise.resolve();timer();await pending;
    assert.match(outcome.message,/setup deadline/);assert.equal(navigations,0);assert.equal(cleared,1);
    release(mode==='pending-create'?f.session:undefined);for(let n=0;n<16;n++)await Promise.resolve();
    const cleanup=await owner.close();assert.equal(cleanup.detached,true);assert(!f.calls.includes('Page.enable'));assert.equal(navigations,0);
    assert.equal(f.calls.filter(c=>c==='detach').length,1);assert.equal(f.listeners.get('Network.loadingFailed').size,1);admissionChecks+=8;
  }
  for(const mode of['delayed','never','late','falsy','mutable']){
    let deadline,cleared=0,release,attempts=0;const stages=[],raw={attempted:true,removed:14,detached:true,errors:[]},
      held=new Promise(resolve=>release=resolve),owner={close:async()=>{attempts++;if(mode==='falsy')throw 0;if(mode==='mutable')return raw;await held;return raw;}};
    const pending=traceAPI.close(owner,s=>stages.push(s),{set:(fn,ms)=>{assert.equal(ms,5000);deadline=fn;return 3;},clear:id=>{assert.equal(id,3);cleared++;}});
    if(mode==='delayed')release();if(mode==='never'||mode==='late')deadline();
    const result=await pending;assert.equal(attempts,1);assert.equal(cleared,1);
    if(mode==='never'||mode==='late'){
      assert.equal(result.timedOut,true);assert.equal(result.detached,false);assert.equal(result.removed,null);assert.equal(result.errors[0].stage,'detach-deadline');
      if(mode==='late'){release();for(let n=0;n<8;n++)await Promise.resolve();assert.equal(result.timedOut,true);assert.equal(result.detached,false);assert(stages.includes('detach:late-return'));}
    }else if(mode==='falsy'){assert.equal(result.errors[0].type,'number');assert.equal(result.errors[0].message,'0');}
    else{assert.equal(result.detached,true);assert.equal(result.timedOut,false);raw.detached=false;raw.errors.push({stage:'foreign',type:'string',message:'changed'});assert.equal(result.detached,true);assert.equal(result.errors.length,0);}
    admissionChecks+=7;
  }
  for(const mode of['delayed-detach','never-detach']){
    const calls=[],cleanupErrors=[];let timer,closeDeadline,release,detached=false;
    const held=new Promise(resolve=>release=resolve),admission={recorder:traceAPI.make(),owner:{setupComplete:true,close:async()=>{
      calls.push('detach:start');await held;detached=true;calls.push('detach:return');return{attempted:true,removed:14,detached:true,errors:[]};}},
      primary:null,primaryFailure:{type:'number',message:'0'},persistenceErrors:[],cleanup:null};
    const run=vm.runInNewContext('(async()=>{'+finish+'})',{cleanupErrors,admission,results:[{id:'harness',ok:false,detail:'0'}],offlineAdmissionError:traceAPI.error,
      admissionMark:()=>{},admissionCleanupMark:()=>{},admissionPersist:async phase=>calls.push('trace:'+phase),
      closeOfflineAdmission:(owner,mark)=>traceAPI.close(owner,mark,{set:(fn,ms)=>{assert.equal(ms,5000);closeDeadline=fn;return 3;},clear:()=>{}}),
      persist:async()=>calls.push('persist'),browser:{close:async()=>{calls.push('browser');if(mode==='delayed-detach')assert(detached,'observer detach settles before browser closes');}},
      server:{close:()=>calls.push('server')},setTimeout:(fn,ms)=>{assert.equal(ms,20000);timer=fn;return 2;},clearTimeout:()=>{},process:{exit:()=>assert.fail('bounded detach must reach final trace without overall watchdog')}});
    const pending=run();for(let n=0;n<8;n++)await Promise.resolve();assert(!calls.includes('browser'));
    if(mode==='delayed-detach')release();else closeDeadline();await pending;
    assert(calls.includes('browser')&&calls.includes('server')&&calls.includes('trace:final'));assert.equal(calls.filter(c=>c==='persist').length,2);
    assert.equal(admission.primaryFailure.message,'0');assert.equal(admission.cleanup.timedOut,mode==='never-detach');admissionChecks+=6;
  }
  console.log('OFFLINE ADMISSION TRACE CPU OK ('+admissionChecks+' checks; no native execution)');
}
{
  const producer=fs.readFileSync(new URL('./test-offline-upgrade.mjs',import.meta.url),'utf8');
  const code=producer.slice(producer.indexOf('export function inspectOrigin('),producer.indexOf('\ntry{\n  check(\'exact-ci-source\''))
    .replaceAll('export ','');
  const api=vm.runInNewContext(code+';({inspectOrigin,reopenOrigin})',{http,URL,assert,setTimeout,clearTimeout});
  const methods=[];
  const server=http.createServer((req,res)=>{methods.push(req.method);res.writeHead(200);res.end('owned fixture');});
  const close=()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port+'/';
  try{
    check((await api.inspectOrigin(origin)).status===200,'actual origin initially reachable');
    await assert.rejects(api.reopenOrigin(server,origin),/already be closed/);assertions++;
    await close();const interrupted=await api.inspectOrigin(origin);
    check(interrupted.reachable===false&&interrupted.error==='ECONNREFUSED','actual interruption listener unavailable');
    await api.reopenOrigin(server,origin);check((await api.inspectOrigin(origin)).status===200,'actual same-port listener reopened');
    await close();const adopted=await api.inspectOrigin(origin);
    check(adopted.reachable===false&&adopted.error==='ECONNREFUSED','actual final listener unavailable');
    for(const bad of ['https://127.0.0.1:1/','http://example.com:1/']){
      await assert.rejects(api.reopenOrigin(server,bad),/AssertionError/);assertions++;
    }
    check(methods.length===2&&methods.every(m=>m==='HEAD'),'availability probes use body-free HEAD requests');
    const blocker=http.createServer();await new Promise(resolve=>blocker.listen(Number(new URL(origin).port),'127.0.0.1',resolve));
    const listeners=['error','listening'].map(n=>server.listenerCount(n));
    try{
      await assert.rejects(api.reopenOrigin(server,origin),e=>e.code==='EADDRINUSE');assertions++;
      check(!server.listening&&['error','listening'].every((n,i)=>server.listenerCount(n)===listeners[i]),'occupied original port rejects without listener leaks');
    }finally{await new Promise(resolve=>blocker.close(resolve));}
  }finally{if(server.listening)await close();}
  // Closed emulation that still returns200 must not satisfy either unavailable oracle.
  const refused=r=>r.reachable===false&&r.error==='ECONNREFUSED';
  check(!refused({reachable:true,status:200})&&!refused({reachable:false,error:'ENOTFOUND'})
    &&!refused({reachable:null,error:'probe deadline'}),'reachable/foreign failure/deadline are not connection-refused proof');
  let fired,cleared=0,destroyed=0,errorCallback;
  const mock=vm.runInNewContext(code+';inspectOrigin',{URL,assert,
    http:{get:(address,options)=>{assert.equal(address,origin);assert.equal(options.agent,false);assert.equal(options.method,'HEAD');
      return{destroy(){destroyed++;},on(name,fn){assert.equal(name,'error');errorCallback=fn;}};}},
    setTimeout:(fn,ms)=>{assert.equal(ms,2000);fired=fn;return 1;},clearTimeout:id=>{assert.equal(id,1);cleared++;}});
  const pending=mock(origin);fired();const timed=await pending;errorCallback({code:'ECONNREFUSED'});
  check(timed.reachable===null&&timed.error==='probe deadline'&&destroyed===1&&cleared===1,'probe deadline stays incomplete despite late refused event');
}
console.log('OFFLINE WORKER CPU OK ('+assertions+'); native update/save proof UNRUN');

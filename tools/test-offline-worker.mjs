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
  console.log('OFFLINE WORKER own rejecting controls OK (4 distinct source mutants)');
  process.exit(0);
}
if(mutation){const m=mutations[mutation];assert.equal(source.split(m.from).length,2,'unique source mutation anchor');source=source.replace(m.from,m.to);}
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
  const producer=fs.readFileSync(new URL('./test-offline.mjs',import.meta.url),'utf8');
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
    const run=vm.runInNewContext('(async()=>{'+finish+'})',{cleanupErrors,
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

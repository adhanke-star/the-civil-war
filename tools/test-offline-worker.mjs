// Actual classic worker in a RAM-only CacheStorage model; native upgrade remains separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
console.log('OFFLINE WORKER CPU OK ('+assertions+'); native update/save proof UNRUN');

// Byte-checked updates for loaded routes, using the existing CacheStorage owner.
importScripts('./offline-manifest.js');
const MANIFEST=self.CW_OFFLINE,SCOPE=new URL(self.registration.scope);
const PREFIX='cw-offline-v1:'+encodeURIComponent(SCOPE.href)+':',VERSION=PREFIX+MANIFEST.generation;
const META=new URL('__cw_offline_admission__',SCOPE).href;
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const fail=message=>{throw Error('Offline update: '+message);};
function member(request){
  const url=new URL(typeof request==='string'?request:request.url);
  if(url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return null;
  if(url.pathname===SCOPE.pathname||url.pathname===new URL('index.html',SCOPE).pathname)return'index.html';
  if(url.search)return null;
  const p=url.pathname.slice(SCOPE.pathname.length);
  return Object.hasOwn(MANIFEST.files,p)?p:null;
}
const address=p=>new URL(p,SCOPE).href;
async function valid(response,p){
  if(!response||response.status!==200||response.type!=='basic')return false;
  const bytes=await response.clone().arrayBuffer(),f=MANIFEST.files[p];
  return bytes.byteLength===f.bytes&&await sha(bytes)===f.sha256;
}
async function validateManifest(){
  const {generation,...payload}=MANIFEST;
  if(MANIFEST.schema!==1||!/^[a-f0-9]{64}$/.test(generation)||await sha(new TextEncoder().encode(JSON.stringify(payload)))!==generation)fail('manifest identity');
  if(!Array.isArray(MANIFEST.base)||!MANIFEST.base.includes('index.html'))fail('base closure');
  for(const[p,f]of Object.entries(MANIFEST.files)){
    const resolved=new URL(p,SCOPE);
    if(!p||p.startsWith('/')||/[\\%?#]/.test(p)||p.split('/').some(s=>!s||s==='.'||s==='..')
      ||resolved.origin!==SCOPE.origin||resolved.pathname!==SCOPE.pathname+p||resolved.search||resolved.hash
      ||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>=100000000||!/^[a-f0-9]{64}$/.test(f.sha256))fail('file descriptor');
  }
  const declared=[...MANIFEST.base];
  for(const g of Object.values(MANIFEST.groups)){
    if(!Array.isArray(g.members)||!g.members.length||!Array.isArray(g.triggers)||!g.triggers.length||g.triggers.some(p=>!g.members.includes(p)))fail('content closure');
    declared.push(...g.members);
  }
  if(declared.some(p=>!Object.hasOwn(MANIFEST.files,p)))fail('unknown dependency');
}
async function completion(cache){
  try{const response=await cache.match(META);if(!response)return null;const r=await response.json();
    return r.schema===1&&r.scope===SCOPE.href&&r.generation===MANIFEST.generation&&Array.isArray(r.members)&&MANIFEST.base.every(p=>r.members.includes(p))?r:null;
  }catch{return null;}
}
async function predecessors(){
  const result=[];
  for(const name of await caches.keys()){
    if(name===VERSION||name!=='cw-v68'&&name!=='cw-v69'&&!name.startsWith(PREFIX))continue;
    const cache=await caches.open(name),keys=await cache.keys();
    if(name.startsWith(PREFIX)){
      const generation=name.slice(PREFIX.length);if(!/^[a-f0-9]{64}$/.test(generation))continue;
      try{const r=await(await cache.match(META))?.json();if(r?.schema!==1||r.scope!==SCOPE.href||r.generation!==generation)continue;}catch{continue;}
    }else if(!keys.length||!keys.some(k=>member(k)==='index.html')||keys.some(k=>{
      const u=new URL(k.url);return u.origin!==SCOPE.origin||!u.pathname.startsWith(SCOPE.pathname);
    }))continue;
    result.push({name,cache,keys});
  }
  return result;
}
async function oldResponse(p,previous){
  for(const row of previous)for(const key of row.keys)if(member(key)===p){
    const response=await row.cache.match(key);if(await valid(response,p))return response;
  }
  return null;
}
async function acquire(p,cache,previous){
  const hit=await cache.match(address(p));if(await valid(hit,p))return hit;
  const reused=await oldResponse(p,previous),response=reused||await fetch(new Request(address(p),{cache:'no-store'}));
  if(!await valid(response,p))fail('byte mismatch '+p);
  await cache.put(address(p),response.clone());return response;
}
function selected(previous){
  const members=new Set(MANIFEST.base),visited=new Set();
  for(const row of previous)for(const key of row.keys){const p=member(key);if(p){members.add(p);visited.add(p);}}
  for(const g of Object.values(MANIFEST.groups))if(g.triggers.some(p=>visited.has(p)))for(const p of g.members)members.add(p);
  return[...members].sort();
}
async function prepare(cache,previous){
  const members=selected(previous);for(const p of members)await acquire(p,cache,previous);
  // Last write: an interrupted install never admits or retires a predecessor.
  await cache.put(META,new Response(JSON.stringify({schema:1,scope:SCOPE.href,generation:MANIFEST.generation,members}),{headers:{'Content-Type':'application/json'}}));
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  await validateManifest();await prepare(await caches.open(VERSION),await predecessors());
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);if(!await completion(cache))fail('incomplete generation');
  const previous=await predecessors();
  try{
    // Waiting clients can load another route after the install-time snapshot.
    await prepare(cache,previous);
    for(const row of previous){
      const keys=row.keys.filter(k=>k.url!==META);if(keys.some(k=>!member(k)))continue;
      let covered=true;for(const key of keys){const p=member(key);if(!await valid(await cache.match(address(p)),p)){covered=false;break;}}
      if(covered)await caches.delete(row.name);
    }
  }catch{
    // Activation failure cannot restore the old worker. Retain predecessors;
    // later fetches may reuse only bytes matching the current manifest.
  }
})()));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET'||req.headers.has('range'))return;
  const url=new URL(req.url);if(url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
  const p=member(req);if(!p)return;
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);if(!await completion(cache))fail('generation not admitted');
    // Immutable generation: no network-first HTML or background module refresh.
    return acquire(p,cache,await predecessors());
  })());
});

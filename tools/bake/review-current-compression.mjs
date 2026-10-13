// Actions-only actual GPU readback of current five-page PNG/raw/UASTC/direct-format candidates.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { candidateKtx } from './compress.mjs';
import { readSmall, outputBytes, selectClosePages } from './current-compression.mjs';
import { comparePixels, candidateSupported } from './review-compression.mjs';
import {createHash} from 'node:crypto';
import {parseAtlasAstc,pageMipBytes} from '../../src/units/atlas-compression.js';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

// Immutable retained qualification. Acquisition is separate from export parsing and never writes assets.
export const QUALIFIED_HYBRID = Object.freeze({
  run:38282452947,sha:'9d60c12cfddadac7c74e7126b33ba568071c2066',closeGpuBytes:48996984,
  optimized:Object.freeze({id:11762770795,name:'cs-close-qualified-hybrid',size:41324044,
    digest:'278f619d48f77a22ce9be20ea3f0461e0e5e933960fa14953a02a9664194b60b'}),
  review:Object.freeze({id:11762905334,name:'cs-close-qualification-review',size:79493756,
    digest:'b9b761a24435489cfe272c90cbe04b60f7b9eb62c8ffec5f1b0f1ae37454452b'}),
});
const acquiredSceneInputs=new WeakMap();
export function validateQualifiedArtifacts(run,artifacts){
  const Q=QUALIFIED_HYBRID;
  if(run?.id!==Q.run||run.head_sha!==Q.sha||run.status!=='completed'||run.conclusion!=='success')throw Error('hybrid acquisition: qualification run');
  if(!Array.isArray(artifacts)||artifacts.length!==2)throw Error('hybrid acquisition: artifact coverage');
  for(const spec of [Q.optimized,Q.review]){
    const matches=artifacts.filter(a=>a.id===spec.id),a=matches[0];
    if(matches.length!==1||a.name!==spec.name||a.expired!==false||a.size_in_bytes!==spec.size
      ||a.workflow_run?.id!==Q.run||a.workflow_run.head_sha!==Q.sha)throw Error('hybrid acquisition: artifact identity');
  }
  return true;
}
export function validateQualifiedZip(bytes,spec){
  if(!(bytes instanceof Uint8Array)||bytes.length!==spec.size||bytes.length>=99000000
    ||createHash('sha256').update(bytes).digest('hex')!==spec.digest)throw Error('hybrid acquisition: ZIP identity');
  return true;
}
export function validateQualifiedSceneInput(input){
  if(input.compression?.toolSha!==QUALIFIED_HYBRID.sha||input.quality?.toolSha!==QUALIFIED_HYBRID.sha)throw Error('hybrid acquisition: report source');
  const admission=validateHybridExport(input);
  if(admission.closeGpuBytes!==QUALIFIED_HYBRID.closeGpuBytes)throw Error('hybrid acquisition: exact close allocation');
  return admission;
}
// Parse only digest-bound archives in production. Review PNGs are never opened/inflated.
export async function selectQualifiedMembers(bytes,kind){
  const require=createRequire(import.meta.url),{yauzl}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
  const review=['soldier-source.json','compression.json','quality.json'],selected=new Map(),seen=new Set();let total=0;
  if(!['optimized','review'].includes(kind))throw Error('hybrid acquisition: archive kind');
  await new Promise((resolve,reject)=>yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);
    const fail=e=>{zip.close();reject(e);};zip.on('error',fail);zip.on('end',resolve);
    zip.on('entry',entry=>{
      const name=entry.fileName,mode=entry.externalFileAttributes>>>16;
      const allowed=kind==='optimized'?name==='soldier-hybrid.json'||/^cs-close-[a-z0-9_-]+\.(png|ktx2)$/.test(name)
        :review.includes(name)||/^cs-close-0(?:0[1-9]|[1-6][0-9]|7[0-6])\.png$/.test(name);
      if(!allowed||seen.has(name)||name.includes('\\')||(mode&0xf000)===0xa000)return fail(Error('hybrid acquisition: member identity'));
      seen.add(name);
      if(kind==='review'&&!review.includes(name)){zip.readEntry();return;}
      if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||entry.uncompressedSize>=99000000
        ||(total+=entry.uncompressedSize)>=99000000)return fail(Error('hybrid acquisition: selected size'));
      zip.openReadStream(entry,(err,stream)=>{
        if(err)return fail(err);const chunks=[];let size=0;
        stream.on('error',fail);stream.on('data',chunk=>{size+=chunk.length;if(size>entry.uncompressedSize){stream.destroy();fail(Error('hybrid acquisition: expanded size'));}else chunks.push(chunk);});
        stream.on('end',()=>{
          const b=Buffer.concat(chunks);if(b.length!==entry.uncompressedSize)return fail(Error('hybrid acquisition: short member'));
          // ZIP CRC32 binds selected decompressed bytes as well as the outer SHA256.
          let crc=0xffffffff;for(const byte of b){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
          if(((crc^0xffffffff)>>>0)!==entry.crc32)return fail(Error('hybrid acquisition: member CRC'));
          selected.set(name,b);zip.readEntry();
        });
      });
    });zip.readEntry();
  }));
  if(kind==='optimized'?(selected.size!==11||!selected.has('soldier-hybrid.json')):review.some(n=>!selected.has(n)))throw Error('hybrid acquisition: selected coverage');
  return selected;
}
export async function acquireQualifiedHybrid(current,io){
  if(!io){
    if(process.env.GITHUB_ACTIONS!=='true')throw Error('hybrid acquisition: Actions only');
    const read=endpoint=>execFileSync('gh',['api',`repos/adhanke-star/the-civil-war/actions/${endpoint}`],{maxBuffer:99000000});
    io={json:endpoint=>JSON.parse(read(endpoint)),zip:id=>read(`artifacts/${id}/zip`)};
  }
  const Q=QUALIFIED_HYBRID,run=await io.json(`runs/${Q.run}`),artifacts=[];
  for(const spec of [Q.optimized,Q.review])artifacts.push(await io.json(`artifacts/${spec.id}`));
  validateQualifiedArtifacts(run,artifacts);
  const archives=[];
  for(const spec of [Q.optimized,Q.review]){const bytes=await io.zip(spec.id);validateQualifiedZip(bytes,spec);archives.push(bytes);}
  // Both downloaded identities must pass before either archive is extracted.
  const files=await selectQualifiedMembers(archives[0],'optimized'),review=await selectQualifiedMembers(archives[1],'review');
  const json=(map,name)=>JSON.parse(new TextDecoder().decode(map.get(name)));
  const input={current,files,manifest:json(files,'soldier-hybrid.json'),source:json(review,'soldier-source.json'),
    compression:json(review,'compression.json'),quality:json(review,'quality.json')};
  const result={...input,reviewFiles:review,admission:validateQualifiedSceneInput(input)};
  acquiredSceneInputs.set(result,new Map([...files,...review].map(([n,b])=>[n,createHash('sha256').update(b).digest('hex')])));
  return result;
}

/** Exact transport files; production acquisition has already bound both immutable ZIP digests. */
export function qualifiedSceneFiles(input){
  validateHybridExport(input);
  const reviewNames=['soldier-source.json','compression.json','quality.json'],review=input.reviewFiles;
  if(!(review instanceof Map)||review.size!==3||reviewNames.some(n=>!review.has(n)))throw Error('scene transport: review coverage');
  const values=[input.source,input.compression,input.quality];
  for(const [i,name]of reviewNames.entries()){
    const bytes=review.get(name);
    if(!(bytes instanceof Uint8Array)||JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)))!==JSON.stringify(values[i]))throw Error('scene transport: review byte binding');
  }
  const files=new Map();let total=0;
  for(const [name,inputBytes]of [...input.files,...review]){
    if(files.has(name)||!(/^(soldier-hybrid|soldier-source|compression|quality)\.json$/.test(name)||/^cs-close-[a-z0-9_-]+\.(png|ktx2)$/.test(name)))throw Error('scene transport: filename');
    if(!(inputBytes instanceof Uint8Array)||!inputBytes.length||(total+=inputBytes.length)>=99000000)throw Error('scene transport: byte bound');
    const bytes=Buffer.from(inputBytes),sha256=createHash('sha256').update(bytes).digest('hex');
    files.set(name,{bytes,sha256,contentType:name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'image/ktx2'});
  }
  return files;
}

/** Fresh runner-only files, never a repo asset or static-server exception. No overwrites/deletes. */
export function materializeQualifiedSceneInput(input){
  if(process.env.GITHUB_ACTIONS!=='true')throw Error('scene transport: Actions only');
  const acquired=acquiredSceneInputs.get(input);
  if(!acquired||![...input.files,...input.reviewFiles].every(([name,b])=>acquired.get(name)===createHash('sha256').update(b).digest('hex')))throw Error('scene transport: acquired byte provenance');
  const admission=validateQualifiedSceneInput(input);
  const files=qualifiedSceneFiles(input),temp=process.env.RUNNER_TEMP;
  if(!temp||!path.isAbsolute(temp)||temp.includes('\\')||fs.lstatSync(temp).isSymbolicLink()||fs.realpathSync(temp)!==temp||!fs.statSync(temp).isDirectory())throw Error('scene transport: real runner root');
  const directory=path.join(temp,'scene-qualified-input');
  if(fs.existsSync(directory))throw Error('scene transport: existing destination');
  fs.mkdirSync(directory);
  if(fs.realpathSync(directory)!==directory||!directory.startsWith(temp+path.sep))throw Error('scene transport: directory escape');
  for(const [name,file]of files){
    const target=path.join(directory,name);
    if(path.dirname(target)!==directory)throw Error('scene transport: target escape');
    fs.writeFileSync(target,file.bytes,{flag:'wx'});
    if(fs.lstatSync(target).isSymbolicLink()||!fs.statSync(target).isFile()||fs.realpathSync(target)!==target
      ||createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==file.sha256)throw Error('scene transport: materialized byte binding');
  }
  return {directory,files,admission,qualification:{run:QUALIFIED_HYBRID.run,sha:QUALIFIED_HYBRID.sha}};
}

/** Context-owned exact URLs. Unknown paths/methods fail closed and every attempted request is retained. */
export async function installQualifiedSceneRoutes(context,origin,files){
  const parsed=new URL(origin);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin||parsed.username||parsed.password
    ||!(files instanceof Map)||files.size!==14)throw Error('scene transport: route contract');
  const required=['soldier-hybrid.json','soldier-source.json','compression.json','quality.json'];
  if(required.some(n=>!files.has(n))||[...files].some(([name,f])=>
    !(required.includes(name)||/^cs-close-[a-z0-9_-]+\.(png|ktx2)$/.test(name))
    ||!(f?.bytes instanceof Uint8Array)||!f.bytes.length||f.contentType!==(name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'image/ktx2')
    ||createHash('sha256').update(f.bytes).digest('hex')!==f.sha256))throw Error('scene transport: route files');
  const admitted=new Map([...files].map(([name,file])=>[name,{file,bytes:file.bytes,sha256:file.sha256,contentType:file.contentType}]));
  const base=origin+'/__scene-qualified/',requests=[],pattern=base+'**';let restored=false;
  const handler=async route=>{
    const request=route.request(),url=request.url(),method=request.method(),name=url.startsWith(base)?url.slice(base.length):null,file=admitted.get(name);
    const record={url,method,name,served:false};requests.push(record);
    if(method!=='GET'||!file||files.get(name)!==file.file||file.file.bytes!==file.bytes||url!==base+name||!file.bytes?.length
      ||createHash('sha256').update(file.bytes).digest('hex')!==file.sha256)return route.abort('blockedbyclient');
    try{
      await route.fulfill({status:200,body:file.bytes,contentType:file.contentType,headers:{'Cache-Control':'no-store'}});
      Object.assign(record,{served:true,bytes:file.bytes.length,sha256:file.sha256});
    }catch(error){record.failure=error?.message||String(error);throw error;}
  };
  await context.route(pattern,handler);
  return {base,requests,async restore(){if(restored)return;await context.unroute(pattern,handler);restored=true;}};
}

export async function gpuReadback({ png, premul, files, w, h, hybrid=false }) {
  const T=window.T, renderer=window.renderer, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_compressed_texture_astc');
  const caps={maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),formats:[...gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS)],
    bptc:!!gl.getExtension('EXT_texture_compression_bptc'),astc:!!ext,profiles:ext?ext.getSupportedProfiles():[]};
  if(files.bc7&&!window.supported(caps,'bc7',w,h)) throw new Error('current compression: BC7 GPU unsupported');
  const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const decode=(s,loader=window.decoder)=>new Promise((resolve,reject)=>loader.parse(un64(s).buffer,resolve,reject));
  const textures={png:await new T.TextureLoader().loadAsync('data:image/png;base64,'+png),premul:new T.DataTexture(un64(premul),w,h),raw:await decode(files.raw)};
  if(files.uastc){textures.uastc=await decode(files.uastc);textures.rgba=await decode(files.uastc,window.rgbaDecoder);}
  if(files.bc7)textures.bc7=await decode(files.bc7);
  const astcSupported=window.supported(caps,'astc',w,h);
  let parserRejected=null;
  if(files.astc&&hybrid){
    const bytes=un64(files.astc),descriptor={w,h,encoding:'astc4x4',alpha:'premultiplied-gamma-bytes'};
    parserRejected=[bytes.subarray(0,79),bytes.subarray(0,bytes.length-1),(()=>{const b=bytes.slice();b[12]=158;return b;})()].every(b=>{try{window.atlasAdapter.parseAtlasAstc(b,descriptor);return false;}catch(e){return e.message.startsWith('baked ASTC:');}});
    parserRejected=parserRejected&&(()=>{try{window.atlasAdapter.parseAtlasAstc(bytes,{...descriptor,w:w/2});return false;}catch(e){return e.message.startsWith('baked ASTC:');}})();
    if(astcSupported)textures.astc=window.atlasAdapter.createAtlasAstcTexture(T,bytes,descriptor);
  }else if(files.astc&&astcSupported)textures.astc=await decode(files.astc);
  const metadata={};
  for(const [name,t] of Object.entries(textures)) {
    Object.assign(t,{colorSpace:T.NoColorSpace,flipY:false,generateMipmaps:name==='png'||name==='premul',premultiplyAlpha:name==='png',
      minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter}); t.needsUpdate=true;
    metadata[name]={format:Object.entries(T).find(([k,v])=>k.endsWith('Format')&&v===t.format)?.[0],allocation:t.mipmaps.reduce((s,m)=>s+m.data.byteLength,0),
      levels:t.mipmaps.length,colorSpace:t.colorSpace,premultiplyAlpha:t.premultiplyAlpha,generateMipmaps:t.generateMipmaps,flipY:t.flipY,adapterBytes:t.userData.atlasMipBytes??null};
  }
  const scene=new T.Scene(),camera=new T.Camera(),geometry=new T.PlaneGeometry(2,2);
  const material=new T.ShaderMaterial({uniforms:{map:{value:textures.raw},lod:{value:0},broken:{value:0}},
    vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'varying vec2 uv0;uniform sampler2D map;uniform float lod;uniform int broken;void main(){vec4 c=textureLod(map,uv0,lod);if(broken==1)c.a=0.;if(broken==2)c.rgb*=c.a;if(broken==3)c.rgb=mix(c.rgb/12.92,pow((c.rgb+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c.rgb));gl_FragColor=c;}',
    blending:T.NoBlending,depthTest:false,depthWrite:false}); scene.add(new T.Mesh(geometry,material));
  const b64=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);};
  const levels=[],errors=[];
  try {
    for(const lod of [0,1,2]) {
      const width=Math.max(1,w>>lod),height=Math.max(1,h>>lod),data={},rt=new T.WebGLRenderTarget(width,height,{depthBuffer:false}),pixels=new Uint8Array(width*height*4);
      try {
        renderer.setRenderTarget(rt); material.uniforms.lod.value=lod;
        for(const [name,t] of Object.entries(textures)) {material.uniforms.map.value=t;material.uniforms.broken.value=0;renderer.render(scene,camera);renderer.readRenderTargetPixels(rt,0,0,width,height,pixels);data[name]=b64(pixels);errors.push(gl.getError());}
        if(lod===0) for(const [name,mode] of [['WrongAlpha',1],['DoublePremul',2],['AutomaticSrgb',3]]) {
          material.uniforms.map.value=textures.raw;material.uniforms.broken.value=mode;renderer.render(scene,camera);renderer.readRenderTargetPixels(rt,0,0,width,height,pixels);data[name]=b64(pixels);errors.push(gl.getError());
        }
        levels.push({lod,width,height,data});
      } finally { renderer.setRenderTarget(null);rt.dispose(); }
    }
    return {caps,metadata,astcSupported:!!textures.astc,parserRejected,errors,levels,unsupportedRejected:!window.supported({...caps,bptc:false,astc:false,formats:[]},'bc7',w,h)
      && !window.supported({...caps,bptc:false,astc:false,formats:[]},'astc',w,h)
      &&(!hybrid||!window.atlasAdapter.astcAvailable({getExtension:()=>null},[{w,h}]))};
  } finally {Object.values(textures).forEach(t=>t.dispose());geometry.dispose();material.dispose();}
}
export function colourComposite(data, width, height, f, lod, background) {
  const scale=2**lod,x=Math.floor(f.x/scale),y=Math.floor(f.y/scale),w=Math.min(Math.ceil(f.w/scale),width-x),h=Math.min(Math.ceil(f.h/scale),height-y);
  const crop=new PNG({width:w,height:h});
  const linear=n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;
  const srgb=n=>n<=0.0031308?n*12.92:1.055*n**(1/2.4)-0.055;
  for(let row=0;row<h;row++) for(let col=0;col<w;col++) {
    const from=((y+row)*width+x+col)*4,to=(row*w+col)*4,a=data[from+3]/255;
    // Runtime's once-premultiplied display bytes: unpremultiply, sRGB-decode, linear blend, sRGB output.
    for(let c=0;c<3;c++) crop.data[to+c]=Math.round(255*srgb(linear(a?Math.min(1,data[from+c]/255/a):0)*a+linear(background[c]/255)*(1-a)));
    crop.data[to+3]=255;
  }
  return PNG.sync.write(crop);
}
export function closeQualified(review) {
  return review.mode==='cs-close-qualification'&&review.pages.length===10
    && new Set(review.pages.map(p=>p.id)).size===10
    && ['base','h2_slouch_roll_butternut'].every(look=>{
      const pages=review.pages.filter(p=>p.look===look);
      return pages.length===5&&pages.reduce((n,p)=>n+p.frames,0)===288;
    })
    &&review.pages.every(p=>p.integrity&&Object.values(p.controls).length===8&&Object.values(p.controls).every(Boolean)
      &&p.astcGpu==='RUN'&&p.quality['astc-software']===true&&p.quality.astc===true&&p.shownFrames===p.frames)
    &&review.sheets.length>0;
}
export function hybridQualified(review){
  return review.mode==='cs-close-hybrid'&&review.pages.length===10&&new Set(review.pages.map(p=>p.id)).size===10
    &&['base','h2_slouch_roll_butternut'].every(look=>{
      const pages=review.pages.filter(p=>p.look===look);
      return pages.length===5&&pages.reduce((n,p)=>n+p.frames,0)===288
        &&[0,1,2,3,4].every(i=>pages.some(p=>p.id===`cs-close-${look}-${i}`&&p.encoding===(i===4?'png':'astc4x4')));
    })&&review.pages.every(p=>p.integrity&&/^[a-f0-9]{64}$/.test(p.sourceSha256)&&p.sourceBound===true&&p.shownFrames===p.frames
      &&Object.keys(p.controls).length===(p.encoding==='png'?8:9)&&Object.values(p.controls).every(v=>v===true)
      &&(p.encoding==='png'?p.quality.png===true:p.astcGpu==='RUN'&&p.quality.astc===true&&p.quality['astc-software']===true&&p.metadata.astc.adapterBytes===p.allocation.block16))
    &&review.sheets.length>0;
}
/** Admission of a retained qualified export before any scene request; no encoding or asset adoption. */
export function validateHybridExport({current,source,manifest,compression,quality,files}){
  const fail=message=>{throw new Error(`hybrid scene input: ${message}`);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  // ASTC payload identity additionally requires acquisition of the two immutable qualification artifacts
  // with their run/SHA and ZIP digests verified by the Actions owner; the parser is not a payload hash.
  if(!/^[a-f0-9]{40}$/.test(compression.toolSha||'')||quality.toolSha!==compression.toolSha
    ||!compression.sources?.US||!compression.sources?.CS||!same(compression.sources,quality.sources))fail('report provenance');
  if(!quality.complete||!quality.qualified||quality.fieldable!==false||!hybridQualified(quality)
    ||compression.mode!=='cs-close-hybrid'||compression.fieldable!==false)fail('qualification');
  const sheets=Array.from({length:76},(_,i)=>`cs-close-${String(i+1).padStart(3,'0')}.png`);
  if(!same(quality.sheets,sheets))fail('sheet coverage');
  if(!same(source.camera,current.camera)||!same(source.clips,current.clips)||!same(source.tiers.field,current.tiers.field)
    ||!same(manifest.camera,source.camera)||!same(manifest.clips,source.clips)||!same(manifest.tiers.field,source.tiers.field))fail('source metadata');
  const strip=T=>Object.fromEntries(Object.entries(T).filter(([k])=>k!=='pages'&&k!=='variants'));
  if(!same(strip(source.tiers.close),strip(current.tiers.close))||!same(source.tiers.close.pages,current.tiers.close.pages)
    ||Object.keys(current.tiers.close.variants||{}).length)fail('current single close binding');
  if(!same(Object.keys(source.tiers.close.variants||{}),['h2_slouch_roll_butternut'])
    ||!same(Object.keys(manifest.tiers.close.variants||{}),['h2_slouch_roll_butternut']))fail('variant coverage');
  const selected=selectClosePages(source),sourceLooks={base:source.tiers.close,...source.tiers.close.variants},looks={base:manifest.tiers.close,...manifest.tiers.close.variants};
  if(!same(Object.keys(sourceLooks),['base','h2_slouch_roll_butternut'])||!same(Object.keys(sourceLooks),Object.keys(looks)))fail('look coverage');
  for(const [name,T]of Object.entries(looks))if(!same(strip(T),strip(sourceLooks[name]))||T.pages.length!==5)fail('frame metadata');
  if(compression.pages.length!==10||new Set(compression.pages.map(p=>p.id)).size!==10)fail('compression coverage');
  const expected=['soldier-hybrid.json'];let bytes=0,astc=0,png=0,frames=0;
  for(const p of selected){
    const c=compression.pages.find(c=>c.id===p.id),q=quality.pages.find(q=>q.id===p.id),index=Number(p.id.slice(-1)),page=looks[p.look].pages[index];
    const encoding=index===4?'png':'astc4x4',file=encoding==='png'?c?.original:c?.files?.astc;
    if(!c||!q||c.encoding!==encoding||q.encoding!==encoding||c.w!==p.w||c.h!==p.h||!same(c.frames,p.frames)
      ||q.sourceSha256!==c.sourceSha256||q.frames!==p.frames.length||!same([page.w,page.h],[p.w,p.h])
      ||page.encoding!==encoding||page.alpha!==(encoding==='png'?'straight-gamma-bytes':'premultiplied-gamma-bytes')
      ||page.file!==file||!/^cs-close-[a-z0-9_-]+\.(png|ktx2)$/.test(file||''))fail('page binding');
    const input=files.get(file);if(!(input instanceof Uint8Array)||page.bytes!==input.length)fail('file bytes');
    const allocation=pageMipBytes(p.w,p.h,encoding==='astc4x4');
    if(page.mipLevels!==allocation.levels.length)fail('mip count');
    if(encoding==='astc4x4'){if(parseAtlasAstc(input,page).bytes!==allocation.bytes)fail('ASTC allocation');astc++;}
    else{
      if(createHash('sha256').update(input).digest('hex')!==c.sourceSha256)fail('original PNG hash');
      const image=PNG.sync.read(input);if(image.width!==p.w||image.height!==p.h)fail('PNG dimensions');png++;
    }
    expected.push(file);bytes+=allocation.bytes;frames+=p.frames.length;
  }
  if(astc!==8||png!==2||frames!==576||new Set(expected).size!==11||files.size!==11||expected.some(f=>!files.has(f)))fail('export coverage');
  if(!same(JSON.parse(new TextDecoder().decode(files.get('soldier-hybrid.json'))),manifest))fail('manifest bytes');
  return {files:11,astc,png,frames,closeGpuBytes:bytes};
}
async function main() {
  if(process.env.GITHUB_ACTIONS!=='true') throw new Error('current compression review: Actions only');
  const out=fs.realpathSync(path.join(ROOT,'.out/current-compression')),report=JSON.parse(readSmall(out,'compression.json'));
  const hybrid=report.mode==='cs-close-hybrid',closeOnly=report.mode==='cs-close-qualification'||hybrid;
  if(report.pages.length!==(closeOnly?10:5) || report.fieldable!==false) throw new Error('current compression review: coverage incomplete');
  const review={diagnosticOnly:true,fieldable:false,mode:report.mode,toolSha:process.env.GITHUB_SHA,sources:report.sources,pages:[],sheets:[],complete:false,qualified:false};
  const {server,url}=await startServer({port:0});let browser;
  try {
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.route(url+'current-compression',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><script type="module">'+
      "import * as T from 'three';import * as atlasAdapter from '/src/units/atlas-compression.js';import {KTX2Loader} from '/node_modules/three/examples/jsm/loaders/KTX2Loader.js';window.atlasAdapter=atlasAdapter;window.T=T;window.renderer=new T.WebGLRenderer({antialias:false});"+
      "window.decoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);window.rgbaDecoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);for(const k of Object.keys(rgbaDecoder.workerConfig))rgbaDecoder.workerConfig[k]=false;window.supported="+candidateSupported.toString()+';window.ready=true;</script>'}));
    for(const [i,p] of report.pages.entries()) {
      await page.goto(url+'current-compression');await page.waitForFunction(()=>window.ready);
      const files=Object.fromEntries(Object.entries(p.files).map(([f,name])=>[f,readSmall(out,name)])),png=readSmall(out,p.original),premul=PNG.sync.read(png);
      for(let k=0;k<premul.data.length;k+=4)for(let c=0;c<3;c++)premul.data[k+c]=Math.round(premul.data[k+c]*premul.data[k+3]/255);
      const sourceBound=createHash('sha256').update(png).digest('hex')===p.sourceSha256;
      const direct=closeOnly?['raw',...(files.astc?['astc']:[])]:['raw','bc7','astc'];
      const info=Object.fromEntries(direct.map(f=>[f,candidateKtx(files[f],p.w,p.h,f)]));
      if(hybrid&&p.encoding==='astc4x4')parseAtlasAstc(files.astc,{...p,alpha:'premultiplied-gamma-bytes'});
      const actual=await page.evaluate(gpuReadback,{png:png.toString('base64'),premul:premul.data.toString('base64'),files:Object.fromEntries(Object.entries(files).map(([k,b])=>[k,b.toString('base64')])),w:p.w,h:p.h,hybrid});
      const levels=actual.levels.map(l=>({...l,data:Object.fromEntries(Object.entries(l.data).map(([k,b])=>[k,Buffer.from(b,'base64')]))})),comparisons=[];
      for(const l of levels) {
        if(files.astc){const soft=PNG.sync.read(readSmall(out,p.astcSoftware[l.lod]));
          if(soft.width!==l.width||soft.height!==l.height)throw new Error('current compression: software dimensions');l.data['astc-software']=soft.data;}
        for(const route of ['premul','raw',...(closeOnly?[]:['rgba','uastc','bc7']),...(files.astc?['astc-software']:[]),...(actual.astcSupported?['astc']:[])]) comparisons.push({route:'png->'+route,lod:l.lod,metrics:comparePixels(l.data.png,l.data[route])});
        for(const route of [...(closeOnly?[]:['uastc','bc7']),...(files.astc?['astc-software']:[]),...(actual.astcSupported?['astc']:[])])comparisons.push({route:'raw->'+route,lod:l.lod,metrics:comparePixels(l.data.raw,l.data[route])});
      }
      const at=(route,lod)=>comparisons.find(c=>c.route===route&&c.lod===lod).metrics;
      const base=levels[0].data.raw;
      const controls={upload:[0,1,2].every(l=>at('png->premul',l).ok),rawBase:at('png->raw',0).ok,identity:levels.every((l,i)=>l.data.raw.equals(info.raw.levels[i].data)),
        missing:!comparePixels(base,Buffer.alloc(base.length)).ok,unsupported:actual.unsupportedRejected};
      for(const k of ['WrongAlpha','DoublePremul','AutomaticSrgb'])controls[k]=!comparePixels(base,levels[0].data[k]).ok;
      if(hybrid&&files.astc)controls.parser=actual.parserRejected===true;
      const md=actual.metadata,integrity=actual.errors.every(e=>e===0)&&md.raw.format==='RGBAFormat'
        &&(closeOnly||(md.rgba.format==='RGBAFormat'&&md.uastc.format==='RGBA_BPTC_Format'&&md.bc7.format==='RGBA_BPTC_Format'))
        && (!actual.astcSupported||md.astc.format==='RGBA_ASTC_4x4_Format')
        && ['raw',...(closeOnly?[]:['bc7']),...(actual.astcSupported?['astc']:[])].every(f=>md[f].allocation===info[f].allocation&&md[f].levels===p.allocation.levels)
        && (closeOnly||(md.uastc.allocation===p.allocation.block16&&md.rgba.allocation===p.allocation.rgba8))
        && Object.entries(md).every(([n,m])=>m.colorSpace===''&&m.flipY===false&&m.premultiplyAlpha===(n==='png')&&m.generateMipmaps===(n==='png'||n==='premul'));
      const quality=Object.fromEntries([...(closeOnly?[]:['uastc','bc7']),...(files.astc?['astc-software']:[]),...(actual.astcSupported?['astc']:[])].map(f=>[f,comparisons.filter(c=>c.route.endsWith('->'+f)).every(c=>c.metrics.ok)]));
      if(hybrid&&p.encoding==='png')quality.png=sourceBound&&levels.every(l=>comparePixels(l.data.png,l.data.premul).ok);
      const entry={id:p.id,look:p.look,encoding:p.encoding,sourceSha256:p.sourceSha256,sourceBound,frames:p.frames.length,shownFrames:0,integrity,controls,quality,comparisons,allocation:p.allocation,metadata:md,capabilities:actual.caps,glErrors:actual.errors,astcGpu:actual.astcSupported?'RUN':'UNRUN'};
      review.pages.push(entry);
      if(closeOnly) {
        await page.evaluate(()=>{decoder.dispose();rgbaDecoder.dispose();renderer.dispose();});
        await page.setViewportSize({width:1800,height:1000});
        const routes=['png',...(files.astc?['astc-software']:['raw']),...(actual.astcSupported?['astc']:[])];
        for(let offset=0;offset<p.frames.length;offset+=8) {
          const cards=[];
          for(const [key,f]of p.frames.slice(offset,offset+8)) {
            const backgrounds=[];
            for(const [bg,colour]of [['light',[184,175,131]],['dark',[48,60,32]]]) {
              const images=[];
              for(const l of levels)for(const name of routes)images.push(`<figure><figcaption>mip${l.lod} ${name}</figcaption><img src="data:image/png;base64,${colourComposite(l.data[name],l.width,l.height,f,l.lod,colour).toString('base64')}"></figure>`);
              backgrounds.push(`<div class="row"><span>${bg}</span>${images.join('')}</div>`);
            }
            cards.push(`<section><h2>${key}</h2>${backgrounds.join('')}</section>`);
          }
          const number=review.sheets.length+1,sheet=`cs-close-${String(number).padStart(3,'0')}.png`;
          await page.setContent(`<style>body{background:#eee8da;color:#20251a;font:16px sans-serif}h2{font-size:18px;margin:4px}.row{display:flex;align-items:center}figure{flex:1;margin:2px;min-width:0}img{width:100%;height:130px;object-fit:contain}section{background:#d9ddc9;padding:4px;margin:8px}</style><h1>${number}. CS CLOSE QUALIFICATION — ${p.id}</h1><p>Every frame, direction and mip0/1/2 over light/dark ground. ${hybrid&&p.encoding==='png'?'Original unchanged PNG retained; raw control':'Original PNG / ASTC software / actual ASTC GPU '+entry.astcGpu}. Qualification only; visual approval, scene memory and runtime fallback remain required.</p>${cards.join('')}`);
          await page.evaluate(()=>Promise.all([...document.images].map(im=>im.decode())));
          await page.screenshot({path:path.join(out,sheet),fullPage:true});review.sheets.push(sheet);
          entry.shownFrames+=Math.min(8,p.frames.length-offset);
          review.outputBytes=outputBytes();
        }
        fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify(review,null,2));
        console.log(p.id,JSON.stringify({integrity,controls,quality,frames:entry.shownFrames}));
        continue;
      }
      const routes=['png','raw','uastc','bc7','astc-software',...(actual.astcSupported?['astc']:[])],cards=[];
      for(const l of levels)for(const [key,f]of p.frames)for(const [bg,colour]of [['light',[184,175,131]],['dark',[48,60,32]]]) {
        const images=routes.map(name=>`<figure><figcaption>${name}</figcaption><img src="data:image/png;base64,${colourComposite(l.data[name],l.width,l.height,f,l.lod,colour).toString('base64')}"></figure>`);
        cards.push(`<section><p>${key} mip${l.lod}, ${bg} terrain</p><div>${images.join('')}</div></section>`);
      }
      await page.evaluate(()=>{decoder.dispose();rgbaDecoder.dispose();renderer.dispose();});
      await page.setViewportSize({width:1500,height:1000});
      await page.setContent(`<style>body{background:#eee8da;color:#20251a;font:18px sans-serif}section div{display:flex}figure{width:16%;margin:4px}img{width:100%;height:150px;object-fit:contain}section{background:#d9ddc9;padding:4px;margin:8px}</style><h1>${i+1}. CURRENT DIAGNOSTIC — ${p.id}</h1><p>PNG / raw / UASTC to actual BC7 GPU / direct BC7 GPU / direct ASTC software. ASTC GPU ${actual.astcSupported?'RUN':'UNRUN'}. Separate source manifests; no fielding clearance. Once-premultiplied RGB reconstructed over light/dark terrain.</p>${cards.join('')}`);
      await page.evaluate(()=>Promise.all([...document.images].map(im=>im.decode())));
      const sheet=`current-compression-0${i+1}.png`;await page.screenshot({path:path.join(out,sheet),fullPage:true});review.sheets.push(sheet);
      fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify(review,null,2));
      console.log(p.id,JSON.stringify({integrity,controls,quality}));
    }
    review.complete=review.pages.every(p=>p.integrity&&Object.values(p.controls).every(Boolean))&&(closeOnly?review.pages.every(p=>p.frames===p.shownFrames):review.sheets.length===5);
    review.qualified=closeOnly&&(hybrid?hybridQualified(review):closeQualified(review));
    if(!review.complete)throw new Error('current compression: diagnostic integrity/control failure; inspect quality.json');
    if(closeOnly&&!review.qualified){console.error('CS close qualification HALT: a required page/route failed unchanged quality; inspect quality.json');process.exitCode=1;}
    if(hybrid&&review.complete&&review.qualified){
      const exported=path.join(out,'qualified-hybrid');fs.mkdirSync(exported);
      const manifest=JSON.parse(readSmall(out,'soldier-source.json'));
      for(const p of report.pages){
        const group=p.look==='base'?manifest.tiers.close:manifest.tiers.close.variants[p.look],index=Number(p.id.slice(-1));
        const source=p.encoding==='png'?p.original:p.files.astc,bytes=readSmall(out,source);
        if(p.encoding==='png'&&createHash('sha256').update(bytes).digest('hex')!==p.sourceSha256)throw new Error('hybrid export: original PNG changed');
        if(p.encoding==='astc4x4')parseAtlasAstc(bytes,{...p,alpha:'premultiplied-gamma-bytes'});
        fs.writeFileSync(path.join(exported,source),bytes,{flag:'wx'});
        group.pages[index]={...group.pages[index],file:source,bytes:bytes.length,mipLevels:p.allocation.levels,encoding:p.encoding,alpha:p.encoding==='png'?'straight-gamma-bytes':'premultiplied-gamma-bytes'};
      }
      fs.writeFileSync(path.join(exported,'soldier-hybrid.json'),JSON.stringify(manifest),{flag:'wx'});
      review.outputBytes=outputBytes();
    }
  } finally {fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify(review,null,2));if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href)await main();

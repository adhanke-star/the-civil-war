import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createQualifiedAtlasPayload,QUALIFIED_ASTC_PAYLOADS} from '../src/units/atlas-compression.js';
import {createDefaultContainer,write} from '../vendor/three/examples/jsm/libs/ktx-parse.module.js';
import {parseAtlasAstc,pageMipBytes,astcAvailable,createAtlasAstcTexture,createLimitedMipOwner} from '../src/units/atlas-compression.js';
import * as THREE from '../vendor/three/build/three.module.js';
const page={w:8,h:8,encoding:'astc4x4',alpha:'premultiplied-gamma-bytes'};
function fixture(metadata={}){
 const c=createDefaultContainer();Object.assign(c,{vkFormat:157,pixelWidth:8,pixelHeight:8,levelCount:4,keyValue:metadata});
 const d=c.dataFormatDescriptor[0];Object.assign(d,{colorModel:162,colorPrimaries:0,transferFunction:1,flags:1,texelBlockDimension:[3,3,0,0],bytesPlane:[16,0,0,0,0,0,0,0],samples:[{bitOffset:0,bitLength:127,channelType:0,samplePosition:[0,0,0,0],sampleLower:0,sampleUpper:0xffffffff}]});
 c.levels=pageMipBytes(8,8,true).levels.map(l=>({levelData:new Uint8Array(l.bytes).fill(l.width),uncompressedByteLength:l.bytes}));return write(c);
}
const original=fixture(),edit=(offset,value,big=false)=>{const b=original.slice(),v=new DataView(b.buffer);if(big)v.setBigUint64(offset,BigInt(value),true);else v.setUint32(offset,value,true);return b;};
const api={parse:parseAtlasAstc,mips:pageMipBytes,caps:astcAvailable,texture:createAtlasAstcTexture,limited:createLimitedMipOwner};
// Constructed public-API ownership fixture only; actual native levels/pixels/context restoration remain UNRUN.
function limitedFixture(factory=createLimitedMipOwner){
 const events=[],listeners=new Map();let properties=new Map(),lost=false,error=0;
 const gl={NO_ERROR:0,isContextLost:()=>lost,getError(){const n=error;error=0;return n;}},token={native:true};
 const renderer={domElement:{addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}},properties:{get:t=>{if(!properties.has(t))properties.set(t,{});return properties.get(t);},has:t=>properties.has(t)},getContext:()=>gl,
  initTexture(t){const p=this.properties.get(t);if(p.version!==t.version){events.push({op:'init',generate:t.generateMipmaps,dataReady:t.source.dataReady,levels:t.mipmaps.length});p.__webglTexture={native:true};t.onUpdate?.(t);p.version=t.version;}},
  copyTextureToTexture(source,t,a,b,c,d){this.initTexture(t);events.push({op:'copy',generate:t.generateMipmaps,sourceImage:source.image,destinationImage:t.image,args:[a,b,c,d],sourceUploaded:properties.has(source)});},
  render(...args){events.push({op:'draw',args,receiver:this});return token;}};
 const native=Object.getOwnPropertyDescriptor(renderer,'render'),image={width:8,height:8,complete:true},texture=new THREE.Texture(image);
 Object.assign(texture,{flipY:false,premultiplyAlpha:true,colorSpace:THREE.NoColorSpace,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping});texture.needsUpdate=true;
 const mipmaps=texture.mipmaps,source=texture.source,owner=factory(THREE,renderer);
 return {owner,renderer,texture,image,mipmaps,source,native,events,listeners,token,setLost:v=>lost=v,setError:v=>error=v,restoreContext(){lost=true;listeners.get('webglcontextlost')?.({isTrusted:true,target:renderer.domElement,type:'webglcontextlost'});lost=false;properties=new Map();renderer.properties={get:t=>{if(!properties.has(t))properties.set(t,{});return properties.get(t);},has:t=>properties.has(t)};listeners.get('webglcontextrestored')?.({isTrusted:true,target:renderer.domElement,type:'webglcontextrestored'});}};
}
const refuses=(a,b,p=page)=>assert.throws(()=>a.parse(b,p),/baked ASTC/);
const checks=[
 ['limited-release-cleanup',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');const native=f.texture.removeEventListener;f.texture.removeEventListener=()=>{throw 0;};let thrown=false,error;try{f.owner.releaseForDisposal(f.texture);}catch(e){thrown=true;error=e;}assert.ok(thrown&&error===0&&f.owner.receipt().failed&&f.owner.receipt().pages.length===1&&f.texture.mipmaps!==f.mipmaps&&f.source.dataReady===false&&f.texture.generateMipmaps===false,'limited-release-cleanup: falsy failed release rolled back into retained owned state');f.texture.removeEventListener=native;f.owner.restore();assert.ok(f.renderer.render===f.native.value&&f.listeners.size===0&&f.texture.mipmaps===f.mipmaps&&f.source.dataReady===true&&f.texture.generateMipmaps===true,'limited-release-cleanup: independent renderer/canvas/page restoration remains reachable');}],
 ['limited-release-nested',a=>{const f=limitedFixture(a.limited),t=f.texture.clone();t.source=new THREE.TextureSource(f.image);t.needsUpdate=true;f.owner.register(f.texture,{w:8,h:8},'field');f.owner.register(t,{w:8,h:8},'close');const native=f.texture.removeEventListener;let error;f.texture.removeEventListener=function(...args){try{f.owner.releaseForDisposal(t);}catch(e){error=e;}return native.apply(this,args);};f.owner.releaseForDisposal(f.texture);assert.ok(/release reentrancy/.test(error?.message)&&f.owner.receipt().pages.length===1&&f.owner.receipt().pages[0].tier==='close'&&!f.owner.receipt().failed,'limited-release-nested: nested sibling release refuses before mutation');f.texture.removeEventListener=native;f.owner.restore();}],
 ['limited-release',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'close');let disposed=0;f.texture.addEventListener('dispose',()=>disposed++);const r=f.owner.releaseForDisposal(f.texture);assert.ok(r.operation==='released-for-disposal'&&r.textureUUID===f.texture.uuid&&r.bytes===320&&f.owner.receipt().pages.length===0&&f.texture.mipmaps===f.mipmaps&&f.source.dataReady===true&&f.texture.generateMipmaps===true&&disposed===0,'limited-release: verified exact original fields released without disposing caller texture');f.texture.dispose();assert.equal(f.renderer.render(),f.token,'limited-release: ordinary native disposal cannot poison released owner');assert.equal(disposed,1,'limited-release: caller performs sole native disposal');f.owner.restore();}],
 ['limited-release-refusal',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');let error;try{f.owner.releaseForDisposal(new THREE.Texture(f.image));}catch(e){error=e;}assert.ok(/release texture ownership drift/.test(error?.message)&&f.owner.receipt().pages.length===1,'limited-release-refusal: foreign identity cannot remove owned page');f.texture.premultiplyAlpha=false;error=null;try{f.owner.releaseForDisposal(f.texture);}catch(e){error=e;}assert.ok(/release texture ownership drift/.test(error?.message)&&f.owner.receipt().pages.length===1,'limited-release-refusal: changed upload flags cannot escape');f.texture.premultiplyAlpha=true;f.owner.restore();}],
 ['limited-release-sibling',a=>{const f=limitedFixture(a.limited),t=f.texture.clone();t.source=new THREE.TextureSource(f.image);t.needsUpdate=true;f.owner.register(f.texture,{w:8,h:8},'field');f.owner.register(t,{w:8,h:8},'close');f.owner.releaseForDisposal(t);t.dispose();f.texture.needsUpdate=true;f.renderer.render();assert.deepEqual(f.owner.receipt().pages.map(p=>p.tier),['field'],'limited-release-sibling: field owner stays registered across rejected close page disposal');assert.equal(f.events.filter(e=>e.op==='copy').length,3,'limited-release-sibling: field changed-version preflight remains active');f.owner.restore();}],
 ['limited-initial',a=>{const f=limitedFixture(a.limited),r=f.owner.register(f.texture,{w:8,h:8},'field');assert.deepEqual(r,{tier:'field',levels:3,bytes:336},'limited-initial: only sampled immutable level allocation');assert.deepEqual(f.events.map(e=>e.op),['init','copy'],'limited-initial: allocation precedes one source-image copy');assert.deepEqual(f.events[0],{op:'init',generate:false,dataReady:false,levels:3},'limited-initial: no implicit chain or placeholder upload');assert.ok(f.events[1].generate&&!f.events[1].sourceUploaded&&f.events[1].sourceImage===f.image&&f.texture.image===f.image&&f.texture.source===f.source&&f.texture.generateMipmaps===false,'limited-initial: unchanged original image/texture, no extra native source or retained pixel copy');f.owner.restore();}],
 ['limited-forward',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'close');assert.equal(f.renderer.render('scene','camera'),f.token,'limited-forward: exact native return');assert.deepEqual(f.events.at(-1).args,['scene','camera'],'limited-forward: arguments retained');assert.equal(f.events.at(-1).receiver,f.renderer,'limited-forward: receiver retained');assert.equal(f.events.filter(e=>e.op==='copy').length,1,'limited-forward: stable frame does not reupload');f.owner.restore();}],
 ['limited-update',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');f.texture.needsUpdate=true;f.renderer.render();assert.deepEqual(f.events.slice(-3).map(e=>e.op),['init','copy','draw'],'limited-update: changed texture initializes synchronously before first draw');assert.equal(f.owner.receipt().events.length,2,'limited-update: version generation retained');f.owner.restore();}],
 ['limited-context',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');f.restoreContext();f.renderer.render();assert.deepEqual(f.events.slice(-3).map(e=>e.op),['init','copy','draw'],'limited-context: first restored-context draw initialized');assert.equal(f.owner.receipt().pages[0].epoch,1,'limited-context: explicit context epoch retained');f.owner.restore();}],
 ['limited-lost',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');f.setLost(true);let error;try{f.renderer.render();}catch(e){error=e;}assert.ok(/lost context/.test(error?.message)&&!f.events.some(e=>e.op==='draw'),'limited-lost: no draw in lost native context');f.setLost(false);f.owner.restore();}],
 ['limited-drift',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');const before=f.texture.premultiplyAlpha;f.texture.premultiplyAlpha=false;let error;try{f.renderer.render();}catch(e){error=e;}assert.ok(/ownership drift/.test(error?.message)&&!f.events.some(e=>e.op==='draw'),'limited-drift: art upload state drift refuses');f.texture.premultiplyAlpha=before;f.owner.restore();}],
 ['limited-initialized-refusal',a=>{const f=limitedFixture(a.limited);f.renderer.properties.get(f.texture).__webglTexture={existing:true};let error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){error=e;}assert.ok(/uninitialized original PNG/.test(error?.message)&&!f.events.length,'limited-initialized-refusal: cannot relabel an existing full-chain allocation');f.owner.restore();}],
 ['limited-version-fault',a=>{const f=limitedFixture(a.limited);f.texture.onUpdate=t=>{t.needsUpdate=true;};let error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){error=e;}assert.ok(/version drift/.test(error?.message)&&!f.events.some(e=>e.op==='copy')&&f.texture.mipmaps===f.mipmaps&&f.texture.source.dataReady===true,'limited-version-fault: callback version drift refuses before copy and restores original fields');f.owner.restore();}],
 ['limited-copy-fault',a=>{const primary=0,f=limitedFixture((T,r)=>{r.copyTextureToTexture=()=>{throw primary;};return a.limited(T,r);});let thrown=false,error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){thrown=true;error=e;}assert.ok(thrown&&error===primary&&f.texture.generateMipmaps===true&&f.texture.mipmaps===f.mipmaps&&f.owner.receipt().failed,'limited-copy-fault: falsy native failure and exact original field restoration preserved');f.owner.restore();}],
 ['limited-setup-fault',a=>{const f=limitedFixture(a.limited);f.texture.addEventListener=()=>{throw 0;};let thrown=false,error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){thrown=true;error=e;}assert.ok(thrown&&error===0&&f.texture.mipmaps===f.mipmaps&&f.texture.generateMipmaps===true&&f.source.dataReady===true&&f.owner.receipt().failed&&f.owner.receipt().pages.length===0,'limited-setup-fault: listener installation failure retains falsy primary and independently restores every setup mutation');f.owner.restore();}],
 ['limited-receipt-bound',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');for(let i=0;i<255;i++){f.texture.needsUpdate=true;f.owner.initialize();}const image={width:8,height:8,complete:true},t=new THREE.Texture(image);Object.assign(t,{flipY:false,premultiplyAlpha:true,colorSpace:THREE.NoColorSpace,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping});const mips=t.mipmaps;let disposed=0;t.addEventListener('dispose',()=>disposed++);let error;try{f.owner.register(t,{w:8,h:8},'close');}catch(e){error=e;}assert.ok(error instanceof AggregateError&&/receipt bound/.test(error.errors[0]?.message)&&t.mipmaps===mips&&t.generateMipmaps===true&&t.source.dataReady===true&&disposed===1&&f.owner.receipt().pages.length===1,'limited-receipt-bound: failed receipt write cannot skip original field restoration and native disposal');f.owner.restore();}],
 ['limited-dispose',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');f.texture.dispose();let error;try{f.renderer.render();}catch(e){error=e;}assert.ok(/unexpected registered texture disposal/.test(error?.message)&&!f.events.some(e=>e.op==='draw')&&f.owner.receipt().failed,'limited-dispose: still-referenced disposed placeholder texture refuses draw');f.owner.restore();}],
 ['limited-api-drift',a=>{for(const key of ['initTexture','copyTextureToTexture','getContext']){const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');const prior=f.renderer[key];f.renderer[key]=()=>{};f.texture.needsUpdate=true;let error;try{f.renderer.render();}catch(e){error=e;}assert.ok(/public API ownership drift/.test(error?.message)&&!f.events.some(e=>e.op==='draw'),'limited-api-drift: no-op native method replacement cannot claim upload');f.renderer[key]=prior;f.owner.restore();}}],
 ['limited-callback-api',a=>{const f=limitedFixture(a.limited),prior=f.renderer.copyTextureToTexture;f.texture.onUpdate=()=>{f.renderer.copyTextureToTexture=()=>{};};let error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){error=e;}assert.ok(/public API ownership drift/.test(error?.message)&&!f.events.some(e=>e.op==='copy')&&f.owner.receipt().failed&&f.owner.receipt().pages.length===0,'limited-callback-api: callback method replacement refuses before claiming initialization');f.renderer.copyTextureToTexture=prior;f.owner.restore();}],
 ['limited-callback-render',a=>{const f=limitedFixture(a.limited),installed=f.renderer.render;f.texture.onUpdate=()=>{f.renderer.render=f.native.value;};let error;try{f.owner.register(f.texture,{w:8,h:8},'field');}catch(e){error=e;}assert.ok(/render ownership drift/.test(error?.message)&&!f.events.some(e=>e.op==='copy')&&f.owner.receipt().failed&&f.owner.receipt().pages.length===0,'limited-callback-render: callback cannot remove the gate and report initialization success');f.renderer.render=installed;f.owner.restore();}],
 ['limited-restore',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');f.owner.restore();assert.deepEqual(Object.getOwnPropertyDescriptor(f.renderer,'render'),f.native,'limited-restore: exact original renderer descriptor');assert.ok(f.texture.mipmaps===f.mipmaps&&f.texture.source===f.source&&f.texture.source.dataReady===true&&f.texture.generateMipmaps===true&&f.texture.image===f.image&&f.listeners.size===0,'limited-restore: exact original texture ownership and event listener release');}],
 ['limited-restore-drift',a=>{const f=limitedFixture(a.limited);f.owner.register(f.texture,{w:8,h:8},'field');const installed=f.renderer.render,foreign=()=>{};f.renderer.render=foreign;let error;try{f.owner.restore();}catch(e){error=e;}assert.ok(/ownership drift/.test(error?.message)&&f.renderer.render===foreign,'limited-restore-drift: foreign renderer changes cannot be overwritten');f.renderer.render=installed;f.owner.restore();}],
 ['texture-adapter',a=>{const t=a.texture(THREE,original,page);assert.ok(t.isCompressedTexture,'texture-adapter: native compressed texture');assert.equal(t.userData.atlasMipBytes,112,'texture-adapter: exact bytes');assert.equal(t.format,THREE.RGBA_ASTC_4x4_Format,'texture-adapter: explicit linear ASTC');assert.equal(t.mipmaps.length,4,'texture-adapter: complete chain');assert.equal(t.premultiplyAlpha,false,'texture-adapter: no double premultiplication');assert.equal(t.colorSpace,THREE.NoColorSpace,'texture-adapter: shader owns decode');assert.equal(t.generateMipmaps,false,'texture-adapter: explicit encoder mips');assert.equal(t.flipY,false,'texture-adapter: preserved orientation');assert.equal(t.minFilter,THREE.LinearMipmapLinearFilter,'texture-adapter: native mip filtering');assert.equal(t.magFilter,THREE.LinearFilter,'texture-adapter: native magnification');assert.equal(t.wrapS,THREE.ClampToEdgeWrapping,'texture-adapter: preserved edge');assert.equal(t.wrapT,THREE.ClampToEdgeWrapping,'texture-adapter: preserved edge');assert.ok(t.version>0,'texture-adapter: upload requested');t.dispose();}],
 ['complete-chain',a=>{const before=original.slice(),r=a.parse(original,page);assert.deepEqual(r.mipmaps.map(m=>[m.width,m.height,m.data.length]),[[8,8,64],[4,4,16],[2,2,16],[1,1,16]],'complete-chain: exact mip payloads');assert.equal(r.bytes,112,'complete-chain: actual blocks');assert.deepEqual(original,before,'complete-chain: input bytes unchanged');}],
 ['npot-accounting',a=>{assert.equal(a.mips(5,3).bytes,72,'npot-accounting: floor each level');assert.equal(a.mips(5,3,true).bytes,64,'npot-accounting: full compressed chain including subblocks');}],
 ['manifest-bind',a=>{for(const p of [{...page,w:4},{...page,encoding:'uastc'},{...page,alpha:'straight'}])refuses(a,original,p);}],
 ['identity-format',a=>{for(const b of [edit(0,0),edit(12,158),edit(16,2),edit(28,1),edit(32,1),edit(36,6),edit(44,2)])refuses(a,b);}],
 ['mip-ranges',a=>{for(const b of [edit(40,3),edit(88,32,true),edit(80,80,true),edit(104,new DataView(original.buffer).getBigUint64(80,true),true),edit(80,9007199254740992n,true)])refuses(a,b);}],
 ['descriptor',a=>{const d=new DataView(original.buffer).getUint32(48,true);for(const o of [d+12,d+13,d+14,d+15,d+16,d+20]){const b=original.slice();b[o]^=1;refuses(a,b);}}],
 ['orientation-swizzle',a=>{for(const metadata of [{KTXorientation:'ru'},{KTXswizzle:'bgra'}])refuses(a,fixture(metadata));assert.equal(a.parse(fixture({KTXorientation:'rd',KTXswizzle:'rgba'}),page).bytes,112,'orientation-swizzle: supported metadata');}],
 ['bounded-input',a=>{for(const input of [12,new Uint8Array(79),original.subarray(0,original.length-1)])refuses(a,input);}],
 ['capability-route',a=>{const gl={COMPRESSED_TEXTURE_FORMATS:1,MAX_TEXTURE_SIZE:2,getExtension(){return {getSupportedProfiles:()=>['ldr']};},getParameter(k){return k===1?[0x93b0]:2048;}};assert.equal(a.caps(gl,[page]),true,'capability-route: explicit supported format/profile');assert.equal(a.caps({...gl,getExtension:()=>null},[page]),false,'capability-route: missing extension');assert.equal(a.caps({...gl,getParameter:k=>k===1?[]:2048},[page]),false,'capability-route: missing linear format');assert.equal(a.caps({...gl,getParameter:k=>k===1?[0x93b0]:4},[page]),false,'capability-route: dimension limit');}],
];
for(const [name,check]of checks){try{check(api);}catch(e){e.message=`${name}: ${e.message}`;throw e;}}console.log(`ATLAS-COMPRESSION OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){
 const mutants={
  'limited-release-cleanup':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.releaseForDisposal=()=>{};return r;}},
  'limited-release-nested':{limited:Function('return ('+createLimitedMipOwner.toString().replace("if(releasing&&!allowRelease)refuse('release reentrancy');",'')+')')()},
  'limited-release':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.releaseForDisposal=()=>({});return r;}},
  'limited-release-refusal':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.releaseForDisposal=()=>({});return r;}},
  'limited-release-sibling':{limited:(...args)=>{const r=createLimitedMipOwner(...args),release=r.releaseForDisposal;r.releaseForDisposal=t=>{const result=release(t);r.restore();return result;};return r;}},
  'limited-initial':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;r.register=(...v)=>({...register(...v),bytes:340});return r;}},
  'limited-forward':{limited:(...args)=>{args[1].render=()=>null;return createLimitedMipOwner(...args);}},
  'limited-update':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;r.register=(...v)=>{const result=register(...v);r.restore();return result;};return r;}},
  'limited-context':{limited:(...args)=>{const r=createLimitedMipOwner(...args),receipt=r.receipt;r.receipt=()=>{const p=receipt();p.pages[0].epoch=0;return p;};return r;}},
  'limited-lost':{limited:(...args)=>{const r=createLimitedMipOwner(...args);args[1].getContext().isContextLost=()=>false;return r;}},
  'limited-drift':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;r.register=(...v)=>{const result=register(...v);r.restore();return result;};return r;}},
  'limited-initialized-refusal':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-version-fault':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-copy-fault':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-setup-fault':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-receipt-bound':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;let calls=0;r.register=(...v)=>++calls===1?register(...v):{};return r;}},
  'limited-dispose':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;r.register=(...v)=>{const result=register(...v);r.restore();return result;};return r;}},
  'limited-api-drift':{limited:(...args)=>{const r=createLimitedMipOwner(...args),register=r.register;r.register=(...v)=>{const result=register(...v);r.restore();return result;};return r;}},
  'limited-callback-api':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-callback-render':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.register=()=>({});return r;}},
  'limited-restore':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.restore=()=>{};return r;}},
  'limited-restore-drift':{limited:(...args)=>{const r=createLimitedMipOwner(...args);r.restore=()=>{};return r;}},
  'texture-adapter':{texture:()=>({isCompressedTexture:false})},
  'complete-chain':{parse:()=>({mipmaps:[],bytes:0})},'npot-accounting':{mips:()=>({bytes:0})},'capability-route':{caps:()=>true},
 };
 for(const [name,check]of checks){const mutant=mutants[name]||{parse:()=>({mipmaps:[],bytes:0})};let error;try{check({...api,...mutant});}catch(e){error=e;}assert.equal(error?.code,'ERR_ASSERTION',`${name}: mutant must reject its own assertion`);console.log(`CAUGHT ${name}`);}
 console.log(`ATLAS-COMPRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

const payloadSource=fs.readFileSync(new URL('../src/units/atlas-compression.js',import.meta.url),'utf8');
const oldCompression=payloadSource.split('// Qualified retained payload foundation.')[0]
  .replace("import * as PayloadTHREE from 'three';\n",'').trimEnd()+'\n';
assert.equal(createHash('sha256').update(oldCompression).digest('hex'),'47febc757d6bea5e2845bb3918fd2596e09f01549be48a81144abeabe36aa863','all historical compression functions byte-exact');
const qualification=fs.readFileSync(new URL('./bake/review-current-compression.mjs',import.meta.url),'utf8');
const trusted=JSON.parse(qualification.split('export const QUALIFIED_RUNTIME_MEMBERS = Object.freeze(')[1].split('\n});')[0]+'\n}');
const specs=Object.values(QUALIFIED_ASTC_PAYLOADS),firstSpec=specs[0];
function payloadFixture(spec=firstSpec,factory=createQualifiedAtlasPayload){
  const {sha256,...page}=spec,b=fs.readFileSync(new URL('../assets/figures/confederate-infantry/'+spec.file,import.meta.url));
  const input=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  return {page,input,create:()=>factory(input,page)};
}
function scalarPayloadStatus(s){assert(Object.isFrozen(s));assert(Object.values(s).every(v=>v===null||['string','boolean','number'].includes(typeof v)));assert.equal(s.retirementAvailable,false);}
async function payloadRejection(task){let failed=false,error;try{await task;}catch(e){failed=true;error=e;}assert(failed,'payload task must reject');return error;}
const payloadChecks=[
  ...specs.map(spec=>['qualified-'+spec.file,async factory=>{
    assert(Object.isFrozen(QUALIFIED_ASTC_PAYLOADS));assert(Object.isFrozen(spec));assert.equal(spec.sha256,trusted[spec.file]);
    const f=payloadFixture(spec,factory),alias=new Uint8Array(f.input),view=new DataView(f.input),o=f.create();
    assert(Object.isFrozen(o));assert(Object.values(o).every(v=>typeof v==='function'));assert.equal(f.input.byteLength,0);assert.equal(alias.byteLength,0);assert.throws(()=>view.getUint8(0));
    scalarPayloadStatus(o.status());assert.equal(o.status().ownedBackingBytes,spec.bytes);assert.equal(o.status().state,'owned');
    const task=o.verify();assert.equal(o.verify(),task);await Promise.resolve();assert.equal(o.status().digestCopyBytes,spec.bytes);assert.equal(o.status().digestOutputBytes,32);
    const receipt=await task;scalarPayloadStatus(receipt);assert.equal(receipt.state,'verified');assert.equal(receipt.digestCopyBytes,0);assert.equal(receipt.ownedBackingBytes,spec.bytes);
    const constructed=o.construct();scalarPayloadStatus(constructed);assert.equal(constructed.state,'constructed-private');assert.equal(constructed.ownedBackingBytes,spec.bytes);
    const texture=o.handOff();assert(texture.isCompressedTexture);assert.equal(texture.mipmaps.length,12);assert.equal(new Set(texture.mipmaps.map(m=>m.data.buffer)).size,1);
    assert.equal(texture.mipmaps[0].data.buffer.byteLength,spec.bytes);assert.equal(texture.mipmaps.reduce((n,m)=>n+m.data.byteLength,0),pageMipBytes(spec.w,spec.h,true).bytes);
    assert.equal(texture.generateMipmaps,false);assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.premultiplyAlpha,false);
    const source=texture.source,mips=texture.mipmaps;let disposals=0;texture.addEventListener('dispose',()=>disposals++);
    assert.equal(o.status().state,'handed-off');assert.equal(o.status().ownedBackingBytes,0);assert.equal(o.status().handedOffBackingBytes,spec.bytes);
    assert.throws(()=>o.handOff(),/invalid state/);o.close();o.close();assert.equal(disposals,0);assert.equal(texture.source,source);assert.equal(texture.mipmaps,mips);
    assert.equal(o.status().state,'closed');assert.equal(o.status().handedOffBackingBytes,spec.bytes);texture.dispose();assert.equal(disposals,1);
  }]),
  ['corrupt',async factory=>{
    const f=payloadFixture(firstSpec,factory);new Uint8Array(f.input)[1024]^=1;const o=f.create(),task=o.verify();const error=await payloadRejection(task);
    assert.match(error.message,/digest mismatch/);assert.equal(o.verify(),task);assert.equal(o.status().failed,true);assert.equal(o.status().ownedBackingBytes,0);
    assert.throws(()=>o.construct(),e=>e===error);assert.throws(()=>o.close(),e=>e===error);
  }],
  ...['file','w','h','bytes','mipLevels','encoding','alpha'].map(key=>['wrong-'+key,async factory=>{
    const f=payloadFixture(firstSpec,factory);f.page[key]=typeof f.page[key]==='number'?f.page[key]+1:'wrong';assert.throws(()=>f.create());assert.equal(f.input.byteLength,firstSpec.bytes);
  }]),
  ['metadata-getter',async factory=>{
    const f=payloadFixture(firstSpec,factory);let calls=0;Object.defineProperty(f.page,'file',{get(){calls++;throw 0;},enumerable:true});assert.throws(()=>f.create());assert.equal(calls,0);assert.equal(f.input.byteLength,firstSpec.bytes);
  }],
  ...['typed','partial','shared','detached','resizable','short','decorated'].map(kind=>['backing-'+kind,async factory=>{
    const f=payloadFixture(firstSpec,factory);let input;
    if(kind==='typed')input=new Uint8Array(f.input);
    if(kind==='partial')input=new Uint8Array(f.input,1);
    if(kind==='shared')input=new SharedArrayBuffer(8);
    if(kind==='detached'){input=f.input;structuredClone(input,{transfer:[input]});}
    if(kind==='resizable')input=new ArrayBuffer(firstSpec.bytes,{maxByteLength:firstSpec.bytes*2});
    if(kind==='short')input=new ArrayBuffer(firstSpec.bytes-1);
    if(kind==='decorated'){input=f.input;input.extra=true;}
    assert.throws(()=>factory(input,f.page));
  }]),
  ['close-owned',async factory=>{
    const o=payloadFixture(firstSpec,factory).create();o.close();o.close();assert.equal(o.status().ownedBackingBytes,0);assert.equal(o.status().state,'closed');
    await assert.rejects(o.verify(),/closed/);assert.throws(()=>o.construct(),/invalid state/);
  }],
  ['close-before-digest',async factory=>{
    const o=payloadFixture(firstSpec,factory).create(),task=o.verify();o.close();assert.equal(o.status().digestCopyBytes,0);await assert.rejects(task,/closed/);
    assert.equal(o.status().state,'closed');assert.equal(o.status().ownedBackingBytes,0);assert.throws(()=>o.construct(),/closed/);
  }],
  ['close-during-digest',async factory=>{
    const o=payloadFixture(firstSpec,factory).create(),task=o.verify();await Promise.resolve();assert.equal(o.status().digestCopyBytes,firstSpec.bytes);o.close();
    assert.equal(o.status().state,'closed');assert.equal(o.status().ownedBackingBytes,firstSpec.bytes);assert.equal(o.status().digestCopyBytes,firstSpec.bytes);
    await assert.rejects(task,/closed/);assert.equal(o.status().ownedBackingBytes,0);assert.equal(o.status().digestCopyBytes,0);assert.throws(()=>o.construct(),/closed/);
  }],
  ['close-verified',async factory=>{
    const o=payloadFixture(firstSpec,factory).create();await o.verify();o.close();assert.equal(o.status().ownedBackingBytes,0);assert.throws(()=>o.construct(),/invalid state/);
  }],
  ['close-constructed',async factory=>{
    const o=payloadFixture(firstSpec,factory).create();await o.verify();o.construct();o.close();o.close();assert.equal(o.status().ownedBackingBytes,0);assert.equal(o.status().handedOffBackingBytes,0);assert.equal(o.status().cleanupFailed,false);assert.throws(()=>o.handOff(),/invalid state/);
  }],
  ['pending-alias-mutation',async factory=>{
    const f=payloadFixture(firstSpec,factory),alias=new Uint8Array(f.input),o=f.create(),task=o.verify();await Promise.resolve();alias[0]=0;
    assert.equal(alias.byteLength,0);assert.throws(()=>new Uint8Array(f.input));await task;o.construct();const texture=o.handOff();assert.equal(texture.mipmaps.length,12);o.close();texture.dispose();
  }],
  ['no-premature-construction',async factory=>{
    const o=payloadFixture(firstSpec,factory).create();assert.throws(()=>o.construct(),/invalid state/);assert.throws(()=>o.handOff(),/invalid state/);
    await o.verify();o.construct();const t=o.handOff();o.close();t.dispose();
  }],
];
assert.equal(specs.length,8);
for(const[name,check]of payloadChecks){try{await check(createQualifiedAtlasPayload);}catch(error){console.error('QUALIFIED-PAYLOAD FAILED',name);throw error;}}
console.log(`QUALIFIED-PAYLOAD CPU OK (${payloadChecks.length}; eight hashes/96 mip views; no upload or retirement)`);

function payloadSourceScript(replacements,body){
  return `import fs from'node:fs';import assert from'node:assert/strict';import * as THREE from'./vendor/three/build/three.module.js';
  let source=fs.readFileSync('src/units/atlas-compression.js','utf8');
  for(const[from,to]of ${JSON.stringify(replacements)}){assert.equal(source.split(from).length,2,'unique source seam');source=source.replace(from,to);}
  const base=new URL('./src/units/atlas-compression.js','file://'+process.cwd()+'/');source=source.replace(/from\\s*(['"])([^'"]+)\\1/g,(all,q,spec)=>'from '+JSON.stringify(spec.startsWith('.')?new URL(spec,base).href:import.meta.resolve(spec)));
  const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const {createQualifiedAtlasPayload,QUALIFIED_ASTC_PAYLOADS,pageMipBytes}=mod,firstSpec=Object.values(QUALIFIED_ASTC_PAYLOADS)[0],spec=firstSpec;
  const trusted=${JSON.stringify(trusted)},payloadFixture=${payloadFixture.toString().replace("new URL('../assets/figures/confederate-infantry/'+spec.file,import.meta.url)","'assets/figures/confederate-infantry/'+spec.file")},scalarPayloadStatus=${scalarPayloadStatus.toString()},payloadRejection=${payloadRejection.toString()};
  ${body}`;
}
function runPayloadSource(replacements,body){
  return execFileSync('node',['--input-type=module','-e',payloadSourceScript(replacements,body)],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,maxBuffer:1000000,stdio:['ignore','pipe','pipe']});
}
// Exercise raw failures in the actual owner, not a replacement owner API. No source file changes.
let payloadFaults=0;
for(const literal of ['undefined','null','0','false',"''"]){
  runPayloadSource([['digest=await payloadApply(payloadDigest,payloadSubtle,[\'SHA-256\',owned]);',`await payloadApply(payloadDigest,payloadSubtle,['SHA-256',owned]);throw ${literal};`]],
    `const o=payloadFixture().create(),raw=${literal};assert.equal(await payloadRejection(o.verify()),raw);assert(o.status().failed);assert.equal(o.status().ownedBackingBytes,0);assert.throws(()=>o.close(),e=>e===raw);`);payloadFaults++;
}
for(const mode of ['construct','dispose','both','dispatch']){
  const replacements=[['payloadApply(payloadDispose,disposing,[]);',"globalThis.disposeAttempts++;payloadApply(payloadDispose,disposing,[]);" ]];
  if(mode==='construct'||mode==='both')replacements.push(['        texture.userData.atlasMipBytes=decoded.bytes;texture.needsUpdate=true;',"        texture.userData.atlasMipBytes=decoded.bytes;throw 0;"]);
  if(mode==='dispose'||mode==='both')replacements[0][1]='globalThis.disposeAttempts++;throw false;';
  if(mode==='dispatch')replacements.push(["        state='constructed-private';","        texture.dispatchEvent=()=>{};state='constructed-private';"]);
  runPayloadSource(replacements,`globalThis.disposeAttempts=0;const o=payloadFixture().create();await o.verify();
    ${mode==='construct'||mode==='both'?"assert.throws(()=>o.construct(),e=>e===0);":"o.construct();"}
    ${mode==='dispatch'?"assert.throws(()=>o.close(),/cleanup ownership changed/);":mode==='dispose'?"assert.throws(()=>o.close(),e=>e===false);":"assert.throws(()=>o.close(),e=>e===0);"}
    try{o.close();}catch{}assert.equal(globalThis.disposeAttempts,1);assert.equal(o.status().ownedBackingBytes,0);
    assert.equal(o.status().cleanupFailed,${mode!=='construct'});assert.equal(o.status().failed,true);`);payloadFaults++;
}
console.log(`QUALIFIED-PAYLOAD RAW FAILURE CONTROLS OK (${payloadFaults}; five falsy digests/partial construction/disposal/dispatch; CPU only)`);
let payloadDriftControls=0;
for(const property of ['needsUpdate','image','uuid']){
  runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();let calls=0;
    const proto=T.Texture.prototype,original=Object.getOwnPropertyDescriptor(proto,${JSON.stringify(property)});
    try{Object.defineProperty(proto,${JSON.stringify(property)},{configurable:true,set(v){calls++;if(original?.set)original.set.call(this,v);}});
      assert.throws(()=>o.construct(),/construction hook ownership changed/);assert.equal(calls,0);assert.equal(o.status().ownedBackingBytes,firstSpec.bytes);
    }finally{if(original)Object.defineProperty(proto,${JSON.stringify(property)},original);else delete proto[${JSON.stringify(property)}];}
    o.close();assert.equal(o.status().retainedBackingBytes,0);`);payloadDriftControls++;
}
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();let calls=0;const p=T.TextureSource.prototype,d=Object.getOwnPropertyDescriptor(p,'needsUpdate');
  try{Object.defineProperty(p,'needsUpdate',{...d,set(v){calls++;d.set.call(this,v);}});assert.throws(()=>o.construct(),/construction hook ownership changed/);assert.equal(calls,0);}
  finally{Object.defineProperty(p,'needsUpdate',d);}o.close();`);payloadDriftControls++;
runPayloadSource([],`const o=payloadFixture().create();await o.verify();o.construct();let calls=0;const d=Object.getOwnPropertyDescriptor(globalThis,'crypto'),crypto=globalThis.crypto;
  try{Object.defineProperty(globalThis,'crypto',{configurable:true,get(){calls++;o.close();return crypto;}});assert.throws(()=>o.handOff(),/intrinsic ownership changed/);assert.equal(calls,0);assert.equal(o.status().state,'constructed-private');}
  finally{Object.defineProperty(globalThis,'crypto',d);}o.close();assert.equal(o.status().retainedBackingBytes,0);`);payloadDriftControls++;
runPayloadSource([],`const o=payloadFixture().create();await o.verify();let calls=0;const assign=Object.assign;
  try{Object.assign=(t,...xs)=>{if(t.isTexture)calls++;return assign(t,...xs);};assert.throws(()=>o.construct(),/construction hook ownership changed/);assert.equal(calls,0);}
  finally{Object.assign=assign;}o.close();`);payloadDriftControls++;
runPayloadSource([],`const o=payloadFixture().create();let calls=0;const p=Object.getPrototypeOf(crypto.subtle),d=Object.getOwnPropertyDescriptor(p,'digest');
  try{Object.defineProperty(p,'digest',{configurable:true,get(){calls++;return d.value;}});await assert.rejects(o.verify(),/intrinsic ownership changed/);assert.equal(calls,0);assert.equal(o.status().retainedBackingBytes,0);}
  finally{Object.defineProperty(p,'digest',d);}try{o.close();}catch{}`);payloadDriftControls++;
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();o.construct();let escaped;
  const p=T.Texture.prototype,d=Object.getOwnPropertyDescriptor(p,'dispatchEvent'),dispatch=p.dispatchEvent;
  try{p.dispatchEvent=function(...args){escaped=this;return dispatch.apply(this,args);};assert.throws(()=>o.close(),/cleanup ownership changed/);
    assert(escaped);assert.equal(escaped.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);assert.equal(o.status().uncertainBackingBytes,firstSpec.bytes);assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);assert(o.status().cleanupFailed);}
  finally{if(d)Object.defineProperty(p,'dispatchEvent',d);else delete p.dispatchEvent;}try{o.close();}catch{}assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);`);payloadDriftControls++;
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();o.construct();let calls=0,errorCalls=0,caught;
  const p=T.Texture.prototype,d=Object.getOwnPropertyDescriptor(p,'dispatchEvent'),dispatch=p.dispatchEvent,OriginalError=globalThis.Error;
  try{p.dispatchEvent=function(...args){calls++;return dispatch.apply(this,args);};globalThis.Error=()=>{errorCalls++;throw 0;};try{o.close();}catch(e){caught=e;}}
  finally{globalThis.Error=OriginalError;if(d)Object.defineProperty(p,'dispatchEvent',d);else delete p.dispatchEvent;}
  assert(caught instanceof OriginalError);assert.match(caught.message,/cleanup ownership changed/);assert.equal(calls,1);assert.equal(errorCalls,0);assert(o.status().failed);assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);`);payloadDriftControls++;
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();o.construct();let escaped;
  const p=T.Texture.prototype,parent=Object.getPrototypeOf(p),proxy=new Proxy(parent,{getOwnPropertyDescriptor(t,k){return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){if(k==='dispatchEvent')escaped=r;return Reflect.get(t,k,r);}});
  try{Object.setPrototypeOf(p,proxy);assert.throws(()=>o.close(),/cleanup ownership changed/);assert(escaped);assert.equal(escaped.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);}
  finally{Object.setPrototypeOf(p,parent);}`);payloadDriftControls++;
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();o.construct();let dispatches=0,caught;
  const p=T.Texture.prototype,parent=Object.getPrototypeOf(p),proxy=new Proxy(parent,{getOwnPropertyDescriptor(t,k){if(k==='dispatchEvent')throw 0;return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){const value=Reflect.get(t,k,r);if(k==='dispatchEvent')return function(...args){dispatches++;return value.apply(this,args);};return value;}});
  try{Object.setPrototypeOf(p,proxy);try{o.close();}catch(e){caught=e;}}
  finally{Object.setPrototypeOf(p,parent);}assert.match(caught.message,/cleanup ownership changed/);assert.equal(dispatches,1);assert(o.status().cleanupFailed);assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);`);payloadDriftControls++;
runPayloadSource([],`const T=await import('three'),o=payloadFixture().create();await o.verify();o.construct();let dispatches=0,caught,reentries=0;
  const p=T.Texture.prototype,parent=Object.getPrototypeOf(p),proxy=new Proxy(parent,{getOwnPropertyDescriptor(t,k){if(k==='dispatchEvent'){reentries++;try{o.close();}catch{}}return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){const value=Reflect.get(t,k,r);if(k==='dispatchEvent')return function(...args){dispatches++;return value.apply(this,args);};return value;}});
  try{Object.setPrototypeOf(p,proxy);try{o.close();}catch(e){caught=e;}}
  finally{Object.setPrototypeOf(p,parent);}assert.match(caught.message,/cleanup ownership changed/);assert.equal(reentries,1);assert.equal(dispatches,1);assert.equal(o.status().state,'closed');assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);`);payloadDriftControls++;
runPayloadSource([],`const o=payloadFixture().create(),includes=Array.prototype.includes;let calls=0,caught,receipt;
  try{Array.prototype.includes=function(){calls++;throw 0;};try{await o.verify();}catch(e){caught=e;}receipt=o.status();}
  finally{Array.prototype.includes=includes;}assert.match(caught.message,/construction hook ownership changed/);assert.equal(calls,0);scalarPayloadStatus(receipt);assert(receipt.failed);assert.equal(receipt.retainedBackingBytes,0);`);payloadDriftControls++;
runPayloadSource([["        requireState('verified');\n        Object.assign(texture,", "        globalThis.testOwner.close();requireState('verified');\n        Object.assign(texture,"]],
  `const o=payloadFixture().create();globalThis.testOwner=o;await o.verify();assert.throws(()=>o.construct(),/invalid state/);assert.equal(o.status().state,'closed');assert.equal(o.status().retainedBackingBytes,0);`);payloadDriftControls++;
console.log(`QUALIFIED-PAYLOAD DRIFT CONTROLS OK (${payloadDriftControls}; actual prototype/getter/privacy/uncertainty/reentry controls)`);
if(process.argv.includes('--prove-fail')){
  const mutants=[
    ['digest',"if(hex!==spec.sha256)refuse('digest mismatch');",'', 'corrupt'],
    ['identity',"if (payloadOwnKeys(page).length!==keys.length || keys.some(k=>value(page,k)!==spec[k])) refuse('qualified page binding');",'', 'wrong-w'],
    ['accounting','digestCopyBytes:hashing?length:0','digestCopyBytes:0','close-during-digest'],
    ['shared-promise','if(task)return task;','if(task)return task.then(x=>x);',payloadChecks[0][0]],
    ['pending-close','if(!hashing)owned=null;','owned=null;','close-during-digest'],
    ['public-close',"handedOffBackingBytes=length;texture=null;owned=null;state='handed-off';","handedOffBackingBytes=length;owned=null;state='handed-off';",payloadChecks[0][0]],
    ['premature-construction',payloadSource.slice(payloadSource.indexOf('  const requireState = expected => {'),payloadSource.indexOf('  const api = {',payloadSource.indexOf('  const requireState = expected => {'))),"  const requireState=expected=>{if(failed)throw failure;if(closed)refuse('closed');stable();};\n", 'no-premature-construction'],
  ];
  for(const[name,from,to,caseName]of mutants){const check=payloadChecks.find(c=>c[0]===caseName)[1];let failure;
    try{runPayloadSource([[from,to]],`const key=${JSON.stringify(caseName.replace(/^wrong-/,''))};await (${check.toString()})(createQualifiedAtlasPayload);`);}catch(e){failure=String(e.stderr);}
    assert(failure?.includes('AssertionError')&&!failure.includes('unique source seam')&&!failure.includes('ReferenceError'),name+' actual source mutant must reach semantic assertion');
  }
  console.log(`QUALIFIED-PAYLOAD SOURCE MUTANTS OK (${mutants.length}/${mutants.length} intended semantic failures)`);
}

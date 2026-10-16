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
    ['public-close',"handedOffBackingBytes=length;texture=null;constructedRecord=null;owned=null;state='handed-off';","handedOffBackingBytes=length;constructedRecord=null;owned=null;state='handed-off';",payloadChecks[0][0]],
    ['premature-construction',payloadSource.slice(payloadSource.indexOf('  const requireState = expected => {'),payloadSource.indexOf('  const api = {',payloadSource.indexOf('  const requireState = expected => {'))),"  const requireState=expected=>{if(failed)throw failure;if(closed)refuse('closed');stable();};\n", 'no-premature-construction'],
  ];
  for(const[name,from,to,caseName]of mutants){const check=payloadChecks.find(c=>c[0]===caseName)[1];let failure;
    try{runPayloadSource([[from,to]],`const key=${JSON.stringify(caseName.replace(/^wrong-/,''))};await (${check.toString()})(createQualifiedAtlasPayload);`);}catch(e){failure=String(e.stderr);}
    assert(failure?.includes('AssertionError')&&!failure.includes('unique source seam')&&!failure.includes('ReferenceError'),name+' actual source mutant must reach semantic assertion');
  }
  console.log(`QUALIFIED-PAYLOAD SOURCE MUTANTS OK (${mutants.length}/${mutants.length} intended semantic failures)`);
}

// Actual pinned Three upload/cache/state code; GL delegates are CPU controls, never native proof.
const {WebGLTextures}=await import('../node_modules/three/src/renderers/webgl/WebGLTextures.js');
const {WebGLState}=await import('../node_modules/three/src/renderers/webgl/WebGLState.js');
const {WebGLProperties}=await import('../node_modules/three/src/renderers/webgl/WebGLProperties.js');
function submissionFixture(hooks={}){
  const calls=[],bindings=new Map(),constants=new Map();let serial=0,active=0,lost=false;
  const target={
    getParameter(p){if(p===gl.VERSION)return 'WebGL 2.0';if(p===gl.VIEWPORT||p===gl.SCISSOR_BOX)return [0,0,64,64];
      if(p===gl.TEXTURE_BINDING_2D)return bindings.get(active)??null;if(p===gl.ACTIVE_TEXTURE)return active;return 16;},
    createTexture(){hooks.create?.();const t={cpuTexture:++serial};calls.push(['create',t]);return t;},
    bindTexture(type,t){hooks.bind?.(type,t);if(type===gl.TEXTURE_2D)bindings.set(active,t);calls.push(['bind',type,t]);},
    activeTexture(n){active=n;},texStorage2D(...args){hooks.storage?.(...args);calls.push(['storage',...args]);},
    compressedTexSubImage2D(...args){hooks.mip?.(...args);calls.push(['mip',...args]);},
    isContextLost(){return lost;},getError(){return 0;}
  };
  const gl=new Proxy(target,{get(t,k){if(k in t)return t[k];if(/^[A-Z0-9_]+$/.test(k)){
    if(!constants.has(k))constants.set(k,k==='NO_ERROR'?0:1000+constants.size);return t[k]=constants.get(k);}
    return t[k]=function(){};}});
  for(const key of ['TEXTURE_2D','TEXTURE_BINDING_2D','TEXTURE0','ACTIVE_TEXTURE'])void gl[key];
  for(const key of ['texImage2D','texSubImage2D','compressedTexImage2D','texStorage3D','texImage3D','texSubImage3D',
    'compressedTexImage3D','compressedTexSubImage3D','copyTexImage2D','copyTexSubImage2D','copyTexSubImage3D','generateMipmap','deleteTexture'])void gl[key];
  const extensions={has:()=>false,get:()=>null},properties=WebGLProperties(),state=WebGLState(gl,extensions),
    capabilities={maxTextureSize:4096,maxTextures:16,getMaxAnisotropy:()=>1},
    utils={convert:v=>v===THREE.RGBA_ASTC_4x4_Format?0x93b0:v===THREE.UnsignedByteType?gl.UNSIGNED_BYTE:v},
    info={memory:{textures:0},render:{frame:0}},textures=new WebGLTextures(gl,extensions,state,properties,capabilities,utils,info);
  const renderer={properties,getContext:()=>gl,initTexture(t){hooks.beforeInit?.(t);textures.setTexture2D(t,0);state.unbindTexture();hooks.afterInit?.(t);}};
  calls.length=0;
  return {renderer,gl,target,calls,properties,textures,state,setLost:v=>lost=v,wrongBinding:()=>bindings.set(active,{foreign:true})};
}
async function submissionOwner(factory=createQualifiedAtlasPayload){const o=payloadFixture(firstSpec,factory).create();await o.verify();o.construct();return o;}
function submitCaught(o,f){let thrown=false,error;const logs=[],original=console.error;console.error=(...args)=>logs.push(args);
  try{o.submit(f.renderer);}catch(e){thrown=true;error=e;}finally{console.error=original;}return {thrown,error,logs};}
function closeCaught(o){try{return o.close();}catch{return o.status();}}
function charged(o){assert.equal(o.status().submittedBackingBytes,firstSpec.bytes);assert.equal(o.status().retainedBackingBytes,firstSpec.bytes);}
const submissionChecks=[
  ['complete',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),descriptors=Object.getOwnPropertyDescriptors(f.target),r=o.submit(f.renderer);
    assert.equal(r.storageAllocations,1);assert.equal(r.mipSubmissions,12);assert.equal(r.state,'submitted-retained');assert(Object.isFrozen(r));
    assert.equal(r.contentAtConsumptionVerified,false);assert.equal(r.exclusiveOwnership,false);assert.equal(r.gpuCompletionVerified,false);assert.equal(r.retirementEligible,false);
    assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.filter(c=>c[0]==='mip').length,12);
    for(const[k,d]of Object.entries(descriptors))assert.deepEqual(Object.getOwnPropertyDescriptor(f.target,k),d,k);charged(o);o.close();charged(o);}],
  ['cached-no-retry',async factory=>{const o=await submissionOwner(factory),f=submissionFixture();o.submit(f.renderer);const count=f.calls.length;
    assert.throws(()=>o.submit(f.renderer),/invalid state|already attempted/);assert.equal(f.calls.length,count);o.close();charged(o);}],
  ['handoff-after-submit',async factory=>{const o=await submissionOwner(factory),f=submissionFixture();o.submit(f.renderer);const t=o.handOff();o.close();
    assert.equal(t.mipmaps.length,12);assert.equal(t.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);charged(o);t.dispose();}],
  ['renderer-alias',async factory=>{let retained;const o=await submissionOwner(factory),f=submissionFixture({beforeInit:t=>retained=t});o.submit(f.renderer);o.close();
    assert.equal(retained.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);charged(o);}],
  ['data-not-ready',async factory=>{const o=await submissionOwner(factory),f=submissionFixture({beforeInit:t=>t.source.dataReady=false});
    assert(submitCaught(o,f).thrown);assert.equal(f.calls.filter(c=>c[0]==='mip').length,0);closeCaught(o);charged(o);}],
  ...['storage','mip'].flatMap(key=>[0,false,undefined].map(raw=>[key+'-throw-'+String(raw),async factory=>{
    const o=await submissionOwner(factory),f=submissionFixture({[key]:()=>{throw raw;}}),r=submitCaught(o,f);assert(r.thrown);assert.equal(r.error,raw);
    assert(o.status().failed);assert(r.logs.length>0,'actual Three swallowed/logged native failure');closeCaught(o);charged(o);
  }])),
  ['wrong-binding',async factory=>{const o=await submissionOwner(factory),f=submissionFixture();
    const original=f.target.bindTexture;f.target.bindTexture=function(...args){original.apply(this,args);f.wrongBinding();};
    assert(submitCaught(o,f).thrown);assert.equal(f.calls.filter(c=>c[0]==='storage').length,0);closeCaught(o);charged(o);}],
  ['wrong-view',async factory=>{const o=await submissionOwner(factory),f=submissionFixture({beforeInit:t=>t.mipmaps[0].data=t.mipmaps[0].data.slice()});
    assert(submitCaught(o,f).thrown);assert.equal(f.calls.filter(c=>c[0]==='mip').length,0);closeCaught(o);charged(o);}],
  ['source-drift',async factory=>{const o=await submissionOwner(factory),f=submissionFixture({beforeInit:t=>t.source.data={width:2048,height:1808}});
    assert(submitCaught(o,f).thrown);closeCaught(o);charged(o);}],
  ['context-probe-drift',async factory=>{const o=await submissionOwner(factory),f=submissionFixture();let exposed;
    const has=f.properties.has;f.properties.has=t=>{if(t.isTexture)exposed=t;return has(t);};
    f.target.getError=()=>{if(exposed)exposed.source.dataReady=false;return 0;};
    const r=submitCaught(o,f);assert(r.thrown);assert.equal(f.calls.length,0);closeCaught(o);charged(o);}],
  ['context-loss',async factory=>{const o=await submissionOwner(factory);let f;f=submissionFixture({mip:()=>f.setLost(true)});assert(submitCaught(o,f).thrown);closeCaught(o);charged(o);}],
  ['recursive-close',async factory=>{const o=await submissionOwner(factory),f=submissionFixture({beforeInit:()=>o.close()});assert(submitCaught(o,f).thrown);
    assert.equal(o.status().state,'closed');assert.equal(f.calls.filter(c=>c[0]==='mip').length,0);charged(o);}],
  ['recursive-handoff',async factory=>{const o=await submissionOwner(factory),f=submissionFixture({beforeInit:()=>o.handOff()});assert(submitCaught(o,f).thrown);
    assert.equal(f.calls.filter(c=>c[0]==='mip').length,0);closeCaught(o);charged(o);}],
  ...['refuse','throw','close'].map(kind=>['properties-'+kind,async factory=>{const o=await submissionOwner(factory),f=submissionFixture();let retained;
    f.properties.has=t=>{retained=t;if(kind==='throw')throw 0;if(kind==='close')o.close();return true;};
    const r=submitCaught(o,f);assert(r.thrown);if(kind==='throw')assert.equal(r.error,0);assert.equal(f.calls.length,0);closeCaught(o);
    assert.equal(retained.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);charged(o);
  }]),
  ['malformed-before-exposure',async factory=>{const o=await submissionOwner(factory);assert.throws(()=>o.submit({}),/submission/);
    assert.equal(o.status().submittedBackingBytes,0);closeCaught(o);assert.equal(o.status().retainedBackingBytes,0);}],
  ['slot-preflight',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),before=Object.getOwnPropertyDescriptor(f.target,'texStorage2D');
    Object.defineProperty(f.target,'generateMipmap',{value:f.target.generateMipmap,writable:false,configurable:false});assert(submitCaught(o,f).thrown);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.target,'texStorage2D'),before);assert.equal(o.status().submittedBackingBytes,0);closeCaught(o);}],
  ['preinstall-foreign-slot',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),has=f.properties.has,foreign=()=>{};
    f.properties.has=t=>{f.target.texStorage2D=foreign;return has(t);};const r=submitCaught(o,f);assert(r.thrown);
    assert.match(r.error.message,/uninstalled slot ownership changed/);assert.equal(f.target.texStorage2D,foreign);assert.equal(f.calls.length,0);closeCaught(o);charged(o);}],
  ...['buffer','byteOffset','byteLength','length'].map(key=>['view-shadow-'+key,async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),has=f.properties.has;let calls=0;
    f.properties.has=t=>{if(t.isTexture){const data=t.mipmaps[0].data,original=data[key];Object.defineProperty(data,key,{get(){calls++;return original;},configurable:true});}return has(t);};
    const r=submitCaught(o,f);assert(r.thrown);assert.match(r.error.message,/view metadata shadow/);assert.equal(calls,0);assert.equal(f.calls.length,0);closeCaught(o);charged(o);
  }]),
  ['missing-final-mip',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),native=f.state.compressedTexSubImage2D;let attempts=0;
    f.state.compressedTexSubImage2D=function(...args){if(++attempts===12)return;return native.apply(this,args);};
    f.renderer.initTexture=t=>f.textures.setTexture2D(t,0);
    const r=submitCaught(o,f);assert(r.thrown);assert.match(r.error.message,/incomplete native calls/);assert.equal(attempts,12);
    assert.equal(f.calls.filter(c=>c[0]==='mip').length,11);closeCaught(o);charged(o);}],
  ...['copyTexImage2D','copyTexSubImage2D','copyTexSubImage3D'].map(key=>['alternative-'+key,async factory=>{
    const o=await submissionOwner(factory);let f;f=submissionFixture({beforeInit:()=>f.gl[key](f.gl.TEXTURE_2D,0)});
    const r=submitCaught(o,f);assert(r.thrown);assert.match(r.error.message,/alternative native operation/);assert.equal(f.calls.length,0);closeCaught(o);charged(o);
  }]),
  ['wrong-level',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),native=f.state.compressedTexSubImage2D;
    f.state.compressedTexSubImage2D=function(...args){args[1]++;return native.apply(this,args);};const r=submitCaught(o,f);
    assert(r.thrown);assert.match(r.error.message,/mip call/);assert.equal(f.calls.filter(c=>c[0]==='mip').length,0);closeCaught(o);charged(o);}],
  ['inherited-slots',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),parent={};
    for(const k of ['createTexture','bindTexture','activeTexture','texStorage2D','compressedTexSubImage2D','texImage2D','texSubImage2D','compressedTexImage2D',
      'texStorage3D','texImage3D','texSubImage3D','compressedTexImage3D','compressedTexSubImage3D','copyTexImage2D','copyTexSubImage2D','copyTexSubImage3D','generateMipmap','deleteTexture']){
      Object.defineProperty(parent,k,Object.getOwnPropertyDescriptor(f.target,k));delete f.target[k];}
    Object.setPrototypeOf(f.target,parent);const before=Object.getOwnPropertyDescriptors(parent);o.submit(f.renderer);
    for(const k of Object.keys(before))assert.equal(Object.hasOwn(f.target,k),false);assert.deepEqual(Object.getOwnPropertyDescriptors(parent),before);o.close();charged(o);}],
  ['install-then-throw',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),before=Object.getOwnPropertyDescriptors(f.target);let once=true;
    const proxy=new Proxy(f.gl,{defineProperty(t,k,d){Reflect.defineProperty(t,k,d);if(k==='texStorage2D'&&once){once=false;throw 0;}return true;}});
    f.renderer.getContext=()=>proxy;const r=submitCaught(o,f);assert(r.thrown);assert.equal(r.error,0);assert.equal(f.calls.length,0);
    for(const[k,d]of Object.entries(before))assert.deepEqual(Object.getOwnPropertyDescriptor(f.target,k),d,k);closeCaught(o);charged(o);}],
  ['first-falsy-before-restoration-fault',async factory=>{const o=await submissionOwner(factory);let f;const foreign=()=>{};
    f=submissionFixture({storage:()=>{f.target.texStorage2D=foreign;throw 0;}});const r=submitCaught(o,f);
    assert(r.thrown);assert.equal(r.error,0);assert.equal(f.target.texStorage2D,foreign);assert(o.status().cleanupFailed);closeCaught(o);charged(o);}],
  ['foreign-replacement',async factory=>{const o=await submissionOwner(factory);let f;const foreign=()=>{};f=submissionFixture({afterInit:()=>{f.target.texStorage2D=foreign;}});
    assert(submitCaught(o,f).thrown);assert.equal(f.target.texStorage2D,foreign);assert(o.status().cleanupFailed);closeCaught(o);charged(o);}],
  ['properties-mutates-content-limit',async factory=>{const o=await submissionOwner(factory),f=submissionFixture(),has=f.properties.has;let retained;
    f.properties.has=t=>{if(t.isTexture){retained=t;t.mipmaps[0].data[0]^=1;}return has(t);};const r=o.submit(f.renderer);assert.equal(r.contentAtConsumptionVerified,false);
    o.close();assert.equal(retained.mipmaps[0].data.buffer.byteLength,firstSpec.bytes);charged(o);}],
  ['delegate-mutates-restores-content-limit',async factory=>{const o=await submissionOwner(factory);let consumed=null,original=null;
    const f=submissionFixture({mip:(...a)=>{const data=a[7];original=data[0];data[0]^=1;consumed=data[0];data[0]=original;}}),r=o.submit(f.renderer);
    assert.notEqual(consumed,original);assert.equal(r.contentAtConsumptionVerified,false);o.close();charged(o);}],
];
for(const[name,check]of submissionChecks){try{await check(createQualifiedAtlasPayload);}catch(e){throw new Error('submission '+name,{cause:e});}}
console.log(`QUALIFIED-SUBMISSION CPU OK (${submissionChecks.length}; actual pinned Three call witness; no native/content/retirement proof)`);
if(process.argv.includes('--prove-fail')){
  const preamble=`const {WebGLTextures}=await import('./node_modules/three/src/renderers/webgl/WebGLTextures.js');
    const {WebGLState}=await import('./node_modules/three/src/renderers/webgl/WebGLState.js');
    const {WebGLProperties}=await import('./node_modules/three/src/renderers/webgl/WebGLProperties.js');
    const submissionFixture=${submissionFixture.toString()},submissionOwner=${submissionOwner.toString()},
      submitCaught=${submitCaught.toString()},closeCaught=${closeCaught.toString()},charged=${charged.toString()};`;
  const restoration=payloadSource.slice(payloadSource.indexOf('        for(let i=slots.length-1;i>=0;i--)'),payloadSource.indexOf('        if(restorationFailed)'));
  const mutants=[
    ['complete-counts',"if(created!==1||storage!==1||submitted!==12)refuse('submission incomplete native calls');",'',
      `await (${submissionChecks.find(c=>c[0]==='missing-final-mip')[1].toString()})(createQualifiedAtlasPayload);`],
    ['sticky-raw-throw','}catch(e){sticky(e);throw failure;}','}catch(e){throw e;}',
      `const o=await submissionOwner(),f=submissionFixture({storage:()=>{throw 0;}}),r=submitCaught(o,f);assert(r.thrown);assert.equal(r.error,0);`],
    ['exposure-charge','submittedBackingBytes=length;','',
      `await (${submissionChecks.find(c=>c[0]==='renderer-alias')[1].toString()})(createQualifiedAtlasPayload);`],
    ['descriptor-restoration',restoration,'',`await (${submissionChecks[0][1].toString()})(createQualifiedAtlasPayload);`],
    ['content-guarantee','contentAtConsumptionVerified:false','contentAtConsumptionVerified:true',
      `await (${submissionChecks[0][1].toString()})(createQualifiedAtlasPayload);`],
  ];
  for(const[name,from,to,body]of mutants){let failure;try{runPayloadSource([[from,to]],preamble+body);}catch(e){failure=String(e.stderr);}
    assert(failure?.includes('AssertionError')&&!failure.includes('unique source seam')&&!failure.includes('ReferenceError'),name+' submission mutant must reach semantic assertion');}
  console.log(`QUALIFIED-SUBMISSION SOURCE MUTANTS OK (${mutants.length}/${mutants.length} intended semantic failures)`);
}

// Constructor-only source controls: actual pinned Three constructor; structural CPU context only.
function rendererConstructionFixture(config={}){
 const calls=[],contexts=[],canvases=[],dimensions=new WeakMap(),constants=new Map([['NO_ERROR',0]]);
 let nextConstant=1,textureId=0,framebufferId=0,disposals=0;
 const record=(name,args=[])=>{assert(calls.length<2000,'bounded actual-constructor fixture');calls.push({name,args});};
 class GL{
  getParameter(key){record('getParameter',[key]);if(config.onQuery)config.onQuery(this);if(key===this.VERSION)return 'WebGL 2.0';if(key===this.VIEWPORT||key===this.SCISSOR_BOX)return [0,0,64,64];return 16;}
  getShaderPrecisionFormat(...args){record('getShaderPrecisionFormat',args);return {precision:23,rangeMin:127,rangeMax:127};}
  getExtension(...args){record('getExtension',args);return null;}
  getContextAttributes(){record('getContextAttributes');return {alpha:true,depth:true,stencil:false,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false};}
  createTexture(){record('createTexture');return {fixtureTexture:++textureId};}
  createFramebuffer(){record('createFramebuffer');if(config.framebufferThrow)throw config.raw;return {fixtureFramebuffer:++framebufferId};}
  isContextLost(){record('isContextLost');return config.lost===true;}
  getError(){record('getError');if(config.queryThrow)throw config.raw;if(config.onError)config.onError(this);return config.error??0;}
 }
 for(const name of ['bindTexture','texParameteri','texImage2D','texImage3D','clearColor','clearDepth','clearStencil','enable','disable','depthFunc','frontFace','cullFace','blendEquation','blendFunc','blendFuncSeparate','blendEquationSeparate','viewport','scissor','activeTexture','deleteTexture','bindVertexArray','deleteVertexArray'])Object.defineProperty(GL.prototype,name,{value:function(...args){record(name,args);},writable:true,configurable:true});
 Object.defineProperty(GL.prototype,'deleteFramebuffer',{value:function(...args){record('deleteFramebuffer',args);disposals++;if(config.cleanupThrow)throw config.cleanupRaw;},writable:true,configurable:true});
 class Canvas{
  constructor(){dimensions.set(this,{width:64,height:64});this.style={};this.listeners=new Map();canvases.push(this);const target=Object.assign(new GL(),{canvas:this,drawingBufferWidth:64,drawingBufferHeight:64});this.context=new Proxy(target,{get(object,key,receiver){if(key in object)return Reflect.get(object,key,receiver);if(typeof key==='string'&&/^[A-Z][A-Z0-9_]*$/.test(key)){if(!constants.has(key))constants.set(key,nextConstant++);return constants.get(key);}throw Error('unsupported fake GL access '+String(key));}});contexts.push(this.context);}
  get width(){const d=dimensions.get(this);if(!d)throw new TypeError('canvas brand');return d.width;}
  set width(value){const d=dimensions.get(this);if(!d)throw new TypeError('canvas brand');d.width=value;}
  get height(){const d=dimensions.get(this);if(!d)throw new TypeError('canvas brand');return d.height;}
  set height(value){const d=dimensions.get(this);if(!d)throw new TypeError('canvas brand');d.height=value;}
  setAttribute(...args){record('canvas.setAttribute',args);}
  addEventListener(name,fn){record('canvas.addEventListener',[name,fn]);assert(!this.listeners.has(name));this.listeners.set(name,fn);}
  removeEventListener(name,fn){record('canvas.removeEventListener',[name,fn]);assert.equal(this.listeners.get(name),fn);if(config.cleanupThrow)throw config.cleanupRaw;this.listeners.delete(name);}
  getContext(...args){record('canvas.getContext',args);if(config.contextThrow)throw config.raw;if(config.nullContext)return null;return this.context;}
 }
 return {Canvas,GL,calls,contexts,canvases,config,newCanvas:()=>new Canvas(),get framebufferDeletes(){return disposals;}};
}
function rendererConstructionScript(body,{beforeImport='',replacements=[]}={}){
 return `import fs from'node:fs';import assert from'node:assert/strict';import vm from'node:vm';import * as THREE from'three';
 assert(fs.readFileSync('vendor/three/build/three.module.js','utf8').includes(THREE.WebGLRenderer.toString()),'actual pinned shipping constructor');
 const fixture=(${rendererConstructionFixture.toString()})(),savedGlobals=['HTMLCanvasElement','WebGL2RenderingContext'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 globalThis.HTMLCanvasElement=fixture.Canvas;globalThis.WebGL2RenderingContext=fixture.GL;
 ${beforeImport}
 let source=fs.readFileSync('src/units/atlas-compression.js','utf8');
 for(const[from,to]of ${JSON.stringify(replacements)}){assert.equal(source.split(from).length,2,'unique renderer source seam');source=source.replace(from,to);}
 for(const[from,to]of [["from 'three';",'from '+JSON.stringify(import.meta.resolve('three'))+';'],["from '../../vendor/three/examples/jsm/libs/ktx-parse.module.js';",'from '+JSON.stringify(new URL('./vendor/three/examples/jsm/libs/ktx-parse.module.js','file://'+process.cwd()+'/').href)+';']]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
 globalThis.__rendererDisposeAttempts=0;
 const disposalSeam='if(renderer&&dispose)try{payloadApply(dispose,renderer,[]);}';assert.equal(source.split(disposalSeam).length,2);source=source.replace(disposalSeam,'if(renderer&&dispose)try{globalThis.__rendererDisposeAttempts++;payloadApply(dispose,renderer,[]);}');
 source+='\\nexport {validateQualifiedAtlasRendererLease as probeValidate,rendererBootstrap as probeBootstrap};\\n';
 const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')),create=mod.createQualifiedAtlasRenderer,validate=mod.probeValidate;
 const refused=fn=>{let threw=false,value;try{fn();}catch(e){threw=true;value=e;}assert(threw,'factory or lease must refuse');return value;};
 try{${body}}finally{for(const[k,d]of savedGlobals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,k),d);}}
 `;
}
function runRendererConstruction(body,options={}){
 return execFileSync('node',['--input-type=module','-e',rendererConstructionScript(body,options)],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000,maxBuffer:1000000,stdio:['ignore','pipe','pipe']});
}

const rendererConstructionCases=[
 {
  "name": "positive",
  "body": "assert.equal(mod.probeBootstrap.available,true,'supported structural bootstrap');\nassert.equal(mod.probeBootstrap.threeFunctions,224);\nconst canvas=fixture.newCanvas(),pair=create(canvas);\nassert(Object.isFrozen(pair));assert(Object.isFrozen(pair.lease));assert.deepEqual(Reflect.ownKeys(pair),['renderer','lease']);assert.deepEqual(Reflect.ownKeys(pair.lease),[]);\nconst record=validate(pair.lease,pair.renderer);assert.equal(record.renderer,pair.renderer);assert.equal(record.canvas,canvas);assert.equal(record.gl,canvas.context);\nassert.equal(canvas.listeners.size,3);\nassert.deepEqual(fixture.calls.find(c=>c.name==='canvas.getContext').args,['webgl2',{alpha:true,depth:true,stencil:false,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:false}]);\nassert.equal(fixture.calls.filter(c=>c.name==='createTexture').length,4);assert.equal(fixture.calls.filter(c=>c.name==='createFramebuffer').length,3);\nrefused(()=>validate({},pair.renderer));refused(()=>validate(Object.freeze({...pair.lease}),pair.renderer));refused(()=>validate(pair.lease,{}));\nconst other=create(fixture.newCanvas());refused(()=>validate(pair.lease,other.renderer));refused(()=>validate(other.lease,pair.renderer));assert.equal(validate(other.lease,other.renderer).renderer,other.renderer);\npair.renderer.dispose();assert.equal(canvas.listeners.size,0);refused(()=>validate(pair.lease,pair.renderer));other.renderer.dispose();assert.equal(fixture.canvases[1].listeners.size,0);\nconsole.log('RENDERER FOUNDATION POSITIVE');"
 },
 {
  "name": "cache",
  "body": "const pair=create(fixture.newCanvas()),p=pair.renderer.properties,has=p.has,get=p.get,record=validate(pair.lease,pair.renderer);p.dispose();assert.equal(p.has,has);assert.equal(p.get,get);assert(!has(record.sentinel));const error=refused(()=>validate(pair.lease,pair.renderer));assert(error.message.includes('cache epoch missing'));assert(!has(record.sentinel),'has-FIRST refusal must not recreate cache record');pair.renderer.dispose();"
 },
 {
  "name": "restore",
  "body": "const canvas=fixture.newCanvas(),pair=create(canvas),context=pair.renderer.getContext(),init=pair.renderer.initTexture,p=pair.renderer.properties,record=validate(pair.lease,pair.renderer);canvas.listeners.get('webglcontextlost')({preventDefault(){}});canvas.listeners.get('webglcontextrestored')({});assert.equal(pair.renderer.getContext(),context);assert.equal(pair.renderer.initTexture,init);assert.notEqual(pair.renderer.properties,p);assert(p.has(record.sentinel),'old cache witness survives restoration');refused(()=>validate(pair.lease,pair.renderer));pair.renderer.dispose();assert.equal(canvas.listeners.size,0);"
 },
 {
  "name": "color",
  "body": "const d=Object.getOwnPropertyDescriptor(THREE.ColorManagement,'colorSpaceToWorking');let calls=0;try{Object.defineProperty(THREE.ColorManagement,'colorSpaceToWorking',{...d,value:function(...a){calls++;return Reflect.apply(d.value,this,a);}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(THREE.ColorManagement,'colorSpaceToWorking',d);assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.ColorManagement,'colorSpaceToWorking'),d);}"
 },
 {
  "name": "up",
  "body": "const up=THREE.Object3D.DEFAULT_UP,d=Object.getOwnPropertyDescriptor(up,'x');let calls=0;try{Object.defineProperty(up,'x',{configurable:true,enumerable:d.enumerable,get(){calls++;return d.value;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(up,'x',d);assert.deepEqual(Object.getOwnPropertyDescriptor(up,'x'),d);}"
 },
 {
  "name": "console",
  "body": "const original=THREE.getConsoleFunction();let calls=0;try{THREE.setConsoleFunction(()=>{calls++;});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{THREE.setConsoleFunction(original);assert.equal(THREE.getConsoleFunction(),original);}"
 },
 {
  "name": "lateLoss",
  "body": "fixture.config.onError=()=>{fixture.config.lost=true;};refused(()=>create(fixture.newCanvas()));assert(fixture.calls.some(c=>c.name==='getError'));assert.equal(fixture.canvases[0].listeners.size,0);assert.equal(globalThis.__rendererDisposeAttempts,1);"
 },
 {
  "name": "ownGL",
  "body": "const canvas=fixture.newCanvas(),original=fixture.GL.prototype.getParameter;let calls=0;Object.defineProperty(canvas.context,'getParameter',{configurable:true,value:function(...args){calls++;return Reflect.apply(original,this,args);}});try{refused(()=>create(canvas));assert(calls>0,'Three may invoke own query shadows before the post-constructor refusal');assert.equal(canvas.listeners.size,0);}finally{delete canvas.context.getParameter;}"
 },
 {
  "name": "dual",
  "body": "fixture.config.queryThrow=true;fixture.config.raw=0;fixture.config.cleanupThrow=true;fixture.config.cleanupRaw='';const error=refused(()=>create(fixture.newCanvas()));assert(error instanceof AggregateError);assert.deepEqual(error.errors,[0,'']);assert.equal(error.cause,0);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,3,'cleanup uncertainty retains listeners');"
 },
 {
  "name": "devtools",
  "body": "const d=Object.getOwnPropertyDescriptor(globalThis,'__THREE_DEVTOOLS__');let calls=0;try{Object.defineProperty(globalThis,'__THREE_DEVTOOLS__',{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,'__THREE_DEVTOOLS__',d);else delete globalThis.__THREE_DEVTOOLS__;assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,'__THREE_DEVTOOLS__'),d);}"
 },
 {
  "name": "canvas-own-getContext",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"getContext\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"getContext\"];}"
 },
 {
  "name": "canvas-prototype-getContext",
  "body": "const key=\"getContext\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-own-width",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"width\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"width\"];}"
 },
 {
  "name": "canvas-prototype-width",
  "body": "const key=\"width\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-own-height",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"height\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"height\"];}"
 },
 {
  "name": "canvas-prototype-height",
  "body": "const key=\"height\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-own-setAttribute",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"setAttribute\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"setAttribute\"];}"
 },
 {
  "name": "canvas-prototype-setAttribute",
  "body": "const key=\"setAttribute\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-own-addEventListener",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"addEventListener\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"addEventListener\"];}"
 },
 {
  "name": "canvas-prototype-addEventListener",
  "body": "const key=\"addEventListener\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-own-removeEventListener",
  "body": "const canvas=fixture.newCanvas();let calls=0;Object.defineProperty(canvas,\"removeEventListener\",{configurable:true,get(){calls++;return undefined;}});try{refused(()=>create(canvas));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{delete canvas[\"removeEventListener\"];}"
 },
 {
  "name": "canvas-prototype-removeEventListener",
  "body": "const key=\"removeEventListener\",d=Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key);let calls=0;try{Object.defineProperty(fixture.Canvas.prototype,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.Canvas.prototype,key,d);assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.Canvas.prototype,key),d);}"
 },
 {
  "name": "canvas-forged-brand",
  "body": "const error=refused(()=>create(Object.create(fixture.Canvas.prototype)));assert(error instanceof TypeError);assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "canvas-subclass",
  "body": "class Sub extends fixture.Canvas{};refused(()=>create(new Sub()));assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "canvas-cross-realm",
  "body": "const Other=vm.runInNewContext('(class Canvas {})');refused(()=>create(new Other()));assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "bootstrap-missing-late-dom",
  "options": {
   "beforeImport": "delete globalThis.HTMLCanvasElement;delete globalThis.WebGL2RenderingContext;"
  },
  "body": "assert.equal(mod.probeBootstrap.available,false);globalThis.HTMLCanvasElement=fixture.Canvas;globalThis.WebGL2RenderingContext=fixture.GL;refused(()=>create(fixture.newCanvas()));assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "devtools-inherited",
  "body": "const d=Object.getOwnPropertyDescriptor(Object.prototype,'__THREE_DEVTOOLS__');let calls=0;try{Object.defineProperty(Object.prototype,'__THREE_DEVTOOLS__',{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(Object.prototype,'__THREE_DEVTOOLS__',d);else delete Object.prototype.__THREE_DEVTOOLS__;assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype,'__THREE_DEVTOOLS__'),d);}"
 },
 {
  "name": "devtools-lexical",
  "body": "vm.runInThisContext('let __THREE_DEVTOOLS__ = {}');assert.equal(Object.getOwnPropertyDescriptor(globalThis,'__THREE_DEVTOOLS__'),undefined);refused(()=>create(fixture.newCanvas()));assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "devtools-lexical-tdz",
  "body": "try{vm.runInThisContext('let __THREE_DEVTOOLS__ = (()=>{throw 0})()');}catch(e){assert.equal(e,0);}const error=refused(()=>create(fixture.newCanvas()));assert(error instanceof ReferenceError);assert.equal(fixture.calls.length,0);"
 },
 {
  "name": "global-binding-navigator",
  "body": "const key=\"navigator\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-OffscreenCanvas",
  "body": "const key=\"OffscreenCanvas\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-XRWebGLBinding",
  "body": "const key=\"XRWebGLBinding\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-self",
  "body": "const key=\"self\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-console",
  "body": "const key=\"console\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-parseFloat",
  "body": "const key=\"parseFloat\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-HTMLCanvasElement",
  "body": "const key=\"HTMLCanvasElement\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "global-binding-WebGL2RenderingContext",
  "body": "const key=\"WebGL2RenderingContext\",d=Object.getOwnPropertyDescriptor(globalThis,key);let calls=0;try{Object.defineProperty(globalThis,key,{configurable:true,get(){calls++;return undefined;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,key),d);}"
 },
 {
  "name": "parseFloat-forwarding",
  "body": "const d=Object.getOwnPropertyDescriptor(globalThis,'parseFloat');let calls=0;try{Object.defineProperty(globalThis,'parseFloat',{...d,value:function(...args){calls++;return Reflect.apply(d.value,this,args);}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(globalThis,'parseFloat',d);}"
 },
 {
  "name": "user-agent-shadow",
  "body": "const nav=globalThis.navigator,d=Object.getOwnPropertyDescriptor(nav,'userAgent');let calls=0;try{Object.defineProperty(nav,'userAgent',{configurable:true,get(){calls++;return 'fixture';}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{if(d)Object.defineProperty(nav,'userAgent',d);else delete nav.userAgent;assert.deepEqual(Object.getOwnPropertyDescriptor(nav,'userAgent'),d);}"
 },
 {
  "name": "color-data-primaries",
  "body": "const target=THREE.ColorManagement.spaces[THREE.LinearSRGBColorSpace].primaries,d=Object.getOwnPropertyDescriptor(target,'0');let calls=0;try{Object.defineProperty(target,'0',{configurable:true,enumerable:true,get(){calls++;return d.value;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(target,'0',d);assert.deepEqual(Object.getOwnPropertyDescriptor(target,'0'),d);}"
 },
 {
  "name": "color-data-matrix",
  "body": "const target=THREE.ColorManagement.spaces[THREE.LinearSRGBColorSpace].toXYZ.elements,d=Object.getOwnPropertyDescriptor(target,'0');let calls=0;try{Object.defineProperty(target,'0',{configurable:true,enumerable:true,get(){calls++;return d.value;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(target,'0',d);assert.deepEqual(Object.getOwnPropertyDescriptor(target,'0'),d);}"
 },
 {
  "name": "gl-prototype-query-shadow",
  "body": "const d=Object.getOwnPropertyDescriptor(fixture.GL.prototype,'getParameter');let calls=0;try{Object.defineProperty(fixture.GL.prototype,'getParameter',{configurable:true,get(){calls++;return d.value;}});refused(()=>create(fixture.newCanvas()));assert.equal(calls,0);assert.equal(fixture.calls.length,0);}finally{Object.defineProperty(fixture.GL.prototype,'getParameter',d);}"
 },
 {
  "name": "gl-own-query-getter",
  "body": "const canvas=fixture.newCanvas(),original=fixture.GL.prototype.getParameter;let calls=0;try{Object.defineProperty(canvas.context,'getParameter',{configurable:true,get(){calls++;return original;}});refused(()=>create(canvas));assert(calls>0,'actual Three may read own queries before postcheck');assert.equal(canvas.listeners.size,0);}finally{delete canvas.context.getParameter;}"
 },
 {
  "name": "renderer-drift-getContext",
  "body": "const pair=create(fixture.newCanvas()),key=\"getContext\",d=Object.getOwnPropertyDescriptor(pair.renderer,key);let calls=0;try{Object.defineProperty(pair.renderer,key,{...d,value:function(){calls++;return d.value;} });refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(pair.renderer,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "renderer-drift-initTexture",
  "body": "const pair=create(fixture.newCanvas()),key=\"initTexture\",d=Object.getOwnPropertyDescriptor(pair.renderer,key);let calls=0;try{Object.defineProperty(pair.renderer,key,{...d,value:function(){calls++;return d.value;} });refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(pair.renderer,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "renderer-drift-properties",
  "body": "const pair=create(fixture.newCanvas()),key=\"properties\",d=Object.getOwnPropertyDescriptor(pair.renderer,key);let calls=0;try{Object.defineProperty(pair.renderer,key,{...d,value:{has(){calls++;return true;},get(){calls++;return {};}} });refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(pair.renderer,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "properties-drift-has",
  "body": "const pair=create(fixture.newCanvas()),p=pair.renderer.properties,key=\"has\",d=Object.getOwnPropertyDescriptor(p,key);let calls=0;try{Object.defineProperty(p,key,{...d,value:function(){calls++;return undefined;}});refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(p,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "properties-drift-get",
  "body": "const pair=create(fixture.newCanvas()),p=pair.renderer.properties,key=\"get\",d=Object.getOwnPropertyDescriptor(p,key);let calls=0;try{Object.defineProperty(p,key,{...d,value:function(){calls++;return undefined;}});refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(p,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "properties-drift-dispose",
  "body": "const pair=create(fixture.newCanvas()),p=pair.renderer.properties,key=\"dispose\",d=Object.getOwnPropertyDescriptor(p,key);let calls=0;try{Object.defineProperty(p,key,{...d,value:function(){calls++;return undefined;}});refused(()=>validate(pair.lease,pair.renderer));assert.equal(calls,0);}finally{Object.defineProperty(p,key,d);pair.renderer.dispose();}"
 },
 {
  "name": "query-raw-undefined",
  "body": "fixture.config.queryThrow=true;fixture.config.raw=undefined;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,undefined);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-raw-undefined",
  "body": "fixture.config.contextThrow=true;fixture.config.raw=undefined;const error=refused(()=>create(fixture.newCanvas()));assert(error instanceof TypeError);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-raw-null",
  "body": "fixture.config.queryThrow=true;fixture.config.raw=null;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,null);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-raw-null",
  "body": "fixture.config.contextThrow=true;fixture.config.raw=null;const error=refused(()=>create(fixture.newCanvas()));assert(error instanceof TypeError);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-raw-0",
  "body": "fixture.config.queryThrow=true;fixture.config.raw=0;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,0);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-raw-0",
  "body": "fixture.config.contextThrow=true;fixture.config.raw=0;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,0);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-raw-false",
  "body": "fixture.config.queryThrow=true;fixture.config.raw=false;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,false);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-raw-false",
  "body": "fixture.config.contextThrow=true;fixture.config.raw=false;const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,false);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-raw-''",
  "body": "fixture.config.queryThrow=true;fixture.config.raw='';const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,'');assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-raw-''",
  "body": "fixture.config.contextThrow=true;fixture.config.raw='';const error=refused(()=>create(fixture.newCanvas()));assert.equal(error,'');assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-partial-framebuffer",
  "body": "fixture.config.framebufferThrow=true;fixture.config.raw=0;assert.equal(refused(()=>create(fixture.newCanvas())),0);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.calls.filter(c=>c.name==='createTexture').length,4);assert.equal(fixture.calls.filter(c=>c.name==='deleteTexture').length,0);assert.equal(fixture.framebufferDeletes,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "constructor-null-context",
  "body": "fixture.config.nullContext=true;const error=refused(()=>create(fixture.newCanvas()));assert(error instanceof Error);assert.equal(fixture.calls.filter(c=>c.name==='canvas.getContext').length,2);assert.equal(globalThis.__rendererDisposeAttempts,0);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-error",
  "body": "fixture.config.error=1280;refused(()=>create(fixture.newCanvas()));assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "query-already-lost",
  "body": "fixture.config.lost=true;refused(()=>create(fixture.newCanvas()));assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);"
 },
 {
  "name": "late-accessor-console",
  "options": {
   "beforeImport": "const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalConsole=THREE.getConsoleFunction(),late={armed:false,fired:0,foreignCalls:0,action:'none'};\nObject.defineProperty(globalThis,'navigator',{configurable:true,value:{get userAgent(){if(late.armed){late.armed=false;late.fired++;if(late.action==='console')THREE.setConsoleFunction(()=>late.foreignCalls++);if(late.action==='loss')fixture.config.lost=true;if(late.action==='error')fixture.config.error=1280;}return 'constructor fixture';}}});"
  },
  "body": "try{late.action=\"console\";fixture.config.onError=()=>{late.armed=true;};refused(()=>create(fixture.newCanvas()));assert(late.fired>0);assert.equal(late.foreignCalls,0);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);}finally{THREE.setConsoleFunction(originalConsole);if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}"
 },
 {
  "name": "late-accessor-loss",
  "options": {
   "beforeImport": "const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalConsole=THREE.getConsoleFunction(),late={armed:false,fired:0,foreignCalls:0,action:'none'};\nObject.defineProperty(globalThis,'navigator',{configurable:true,value:{get userAgent(){if(late.armed){late.armed=false;late.fired++;if(late.action==='console')THREE.setConsoleFunction(()=>late.foreignCalls++);if(late.action==='loss')fixture.config.lost=true;if(late.action==='error')fixture.config.error=1280;}return 'constructor fixture';}}});"
  },
  "body": "try{late.action=\"loss\";fixture.config.onError=()=>{late.armed=true;};refused(()=>create(fixture.newCanvas()));assert(late.fired>0);assert.equal(late.foreignCalls,0);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);}finally{THREE.setConsoleFunction(originalConsole);if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}"
 },
 {
  "name": "late-accessor-error",
  "options": {
   "beforeImport": "const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalConsole=THREE.getConsoleFunction(),late={armed:false,fired:0,foreignCalls:0,action:'none'};\nObject.defineProperty(globalThis,'navigator',{configurable:true,value:{get userAgent(){if(late.armed){late.armed=false;late.fired++;if(late.action==='console')THREE.setConsoleFunction(()=>late.foreignCalls++);if(late.action==='loss')fixture.config.lost=true;if(late.action==='error')fixture.config.error=1280;}return 'constructor fixture';}}});"
  },
  "body": "try{late.action=\"error\";fixture.config.onError=()=>{late.armed=true;};refused(()=>create(fixture.newCanvas()));assert(late.fired>0);assert.equal(late.foreignCalls,0);assert.equal(globalThis.__rendererDisposeAttempts,1);assert.equal(fixture.canvases[0].listeners.size,0);}finally{THREE.setConsoleFunction(originalConsole);if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}"
 },
 {
  "name": "no-accessors-after-final-health",
  "options": {
   "beforeImport": "const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),late={armed:false,queries:0,lateEffects:0};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get userAgent(){if(late.armed){late.armed=false;if(late.queries===2){late.lateEffects++;fixture.config.lost=true;}}return 'constructor fixture';}}});"
  },
  "body": "try{fixture.config.onError=()=>{late.queries++;late.armed=true;};const pair=create(fixture.newCanvas());assert.equal(late.queries,2);assert.equal(late.lateEffects,0,'no accessor callback after final health probes');assert.equal(fixture.config.lost??false,false);pair.renderer.dispose();}finally{if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}"
 },
 {
  "name": "late-accessor-preconstructor-console",
  "options": {
   "beforeImport": "const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalConsole=THREE.getConsoleFunction(),late={reads:0,foreignCalls:0};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get userAgent(){late.reads++;if(late.reads===3)THREE.setConsoleFunction(()=>late.foreignCalls++);return 'constructor fixture';}}});"
  },
  "body": "try{fixture.config.nullContext=true;refused(()=>create(fixture.newCanvas()));assert.equal(late.foreignCalls,0);assert.equal(fixture.calls.length,0,'private console side effect must be caught before actual constructor');}finally{THREE.setConsoleFunction(originalConsole);if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}"
 },
 {
  "name": "array-iterator-next",
  "body": "const prototype=Object.getPrototypeOf([][Symbol.iterator]()),d=Object.getOwnPropertyDescriptor(prototype,'next');let calls=0,threw=false,caught,observed,glCalls;const canvas=fixture.newCanvas();try{Object.defineProperty(prototype,'next',{...d,value:function(...args){calls++;return Reflect.apply(d.value,this,args);}});try{create(canvas);}catch(e){threw=true;caught=e;}observed=calls;glCalls=fixture.calls.length;}finally{Object.defineProperty(prototype,'next',d);}assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,'next'),d);assert(threw,'iterator drift refuses before construction');assert.equal(observed,0);assert.equal(glCalls,0);"
 }
];
const rendererConstructionMutants=[
 {
  "name": "renderer-binding",
  "caseName": "positive",
  "replacements": [
   [
    "if(!record||record.renderer!==expectedRenderer)",
    "if(!record)"
   ]
  ]
 },
 {
  "name": "cache-witness",
  "caseName": "cache",
  "replacements": [
   [
    "  if(payloadApply(record.has,record.properties,[record.sentinel])!==true)rendererRefuse('renderer cache epoch missing');",
    ""
   ],
   [
    "  if(payloadApply(record.get,record.properties,[record.sentinel])!==record.sentinelRecord)rendererRefuse('renderer cache epoch changed');",
    ""
   ],
   [
    "  if(rendererOwnValue(record.renderer,'properties',[])!==record.properties\n    ||payloadApply(record.getContext,record.renderer,[])!==record.gl\n    ||payloadApply(record.has,record.properties,[record.sentinel])!==true\n    ||payloadApply(record.get,record.properties,[record.sentinel])!==record.sentinelRecord)rendererRefuse('renderer epoch changed during validation');",
    "  if(false)rendererRefuse('renderer epoch changed during validation');"
   ]
  ]
 },
 {
  "name": "restoration-properties",
  "caseName": "restore",
  "replacements": [
   [
    "  if(rendererOwnValue(record.renderer,'properties',[])!==record.properties)rendererRefuse('renderer properties epoch changed');",
    ""
   ],
   [
    "for(let i=0;i<record.slots.length;i++)rendererSlotStable(record.slots[i]);",
    "for(let i=0;i<record.slots.length;i++)if(record.slots[i].key!=='properties')rendererSlotStable(record.slots[i]);"
   ],
   [
    "rendererOwnValue(record.renderer,'properties',[])!==record.properties",
    "false"
   ]
  ]
 },
 {
  "name": "color-management",
  "caseName": "color",
  "replacements": [
   [
    "function rendererHooksStable(hooks){",
    "function rendererHooksStable(hooks){if(hooks===rendererBootstrap.data)return;"
   ]
  ]
 },
 {
  "name": "default-up",
  "caseName": "up",
  "replacements": [
   [
    "rendererDataGraph([up.value,PayloadTHREE.ColorManagement])",
    "rendererDataGraph([PayloadTHREE.ColorManagement])"
   ]
  ]
 },
 {
  "name": "private-console",
  "caseName": "console",
  "replacements": [
   [
    "rendererGetConsole=PayloadTHREE.getConsoleFunction,",
    "rendererGetConsole=()=>null,"
   ]
  ]
 },
 {
  "name": "last-health",
  "caseName": "lateLoss",
  "replacements": [
   [
    "if(payloadApply(record.isContextLost,record.gl,[])!==false)rendererRefuse('renderer context lost after query');",
    "void 0;"
   ]
  ]
 },
 {
  "name": "own-context-query",
  "caseName": "ownGL",
  "replacements": [
   [
    "    const key=rendererQueryKeys[i];if(payloadGetDescriptor(gl,key))rendererRefuse('context own query shadow unsupported');\n    const now=payloadDescriptor(gl,key),expected=b.glSlots[i];\n    if(now.owner!==expected.owner||!payloadSameDescriptor(now.descriptor,expected.descriptor))rendererRefuse('context query ownership changed');",
    "    void rendererQueryKeys[i];"
   ]
  ]
 },
 {
  "name": "first-cleanup-failure",
  "caseName": "dual",
  "replacements": [
   [
    "if(cleanupFailed)throw new RendererAggregateError([first,cleanup],'qualified atlas renderer: construction failed; cleanup uncertain',{cause:first});",
    "if(cleanupFailed)throw cleanup;"
   ]
  ]
 },
 {
  "name": "devtools-descriptor",
  "caseName": "devtools",
  "replacements": [
   [
    "if(payloadDescriptor(globalThis,'__THREE_DEVTOOLS__').descriptor)rendererRefuse('devtools binding unsupported');",
    "void 0;"
   ]
  ]
 },
 {
  "name": "parse-float",
  "caseName": "parseFloat-forwarding",
  "replacements": [
   [
    ",'parseFloat'];",
    "];"
   ]
  ]
 },
 {
  "name": "post-health-accessor",
  "caseName": "no-accessors-after-final-health",
  "replacements": [
   [
    "rendererBootstrapStable(false);rendererCanvasStable(record.canvas);rendererContextStable(record);",
    "rendererBootstrapStable();rendererCanvasStable(record.canvas);rendererContextStable(record);"
   ]
  ]
 },
 {
  "name": "late-private-console",
  "caseName": "late-accessor-preconstructor-console",
  "replacements": [
   [
    "if(payloadApply(rendererGetConsole,PayloadTHREE,[])!==null)rendererRefuse('private console callback changed during bootstrap validation');",
    "void 0;"
   ]
  ]
 },
 {
  "name": "array-iterator-hook",
  "caseName": "array-iterator-next",
  "replacements": [
   [
    "    for(let i=0;i<iteratorChain.length;i++)add(iteratorChain[i]);",
    "    void iteratorChain;"
   ]
  ]
 }
];
for(const c of rendererConstructionCases){try{runRendererConstruction(c.body,c.options);}catch(e){throw new Error('renderer construction '+c.name,{cause:e});}}
console.log(`QUALIFIED-RENDERER CPU OK (${rendererConstructionCases.length}; constructor-only lease; no native/upload/retirement authority)`);
if(process.argv.includes('--prove-fail')){
 for(const m of rendererConstructionMutants){
  const c=rendererConstructionCases.find(c=>c.name===m.caseName);assert(c,'named renderer control exists');
  const tag='RENDERER_CONTROL_ASSERTION '+m.name,body='try{'+c.body+'}catch(e){if(e?.code==="ERR_ASSERTION")console.error('+JSON.stringify(tag)+');throw e;}';
  let failure;try{runRendererConstruction(body,{...c.options,replacements:m.replacements});}catch(e){failure=e;}
  const stderr=String(failure?.stderr??'');assert(failure&&stderr.includes('AssertionError [ERR_ASSERTION]')&&stderr.includes(tag),m.name+' renderer mutant must reach named semantic assertion');
 }
 console.log(`QUALIFIED-RENDERER SOURCE MUTANTS OK (${rendererConstructionMutants.length}/${rendererConstructionMutants.length} intended semantic failures)`);
}

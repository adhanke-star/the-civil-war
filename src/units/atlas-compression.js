import * as PayloadTHREE from 'three';
// Narrow explicit-ASTC container adapter. The existing atlas owns loading, publication and disposal.
import {read} from '../../vendor/three/examples/jsm/libs/ktx-parse.module.js';
const MAGIC=[171,75,84,88,32,50,48,187,13,10,26,10];
const fail=message=>{throw new Error(`baked ASTC: ${message}`);};
export function pageMipBytes(width,height,compressed=false){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=2048))fail('unsafe dimensions');
  const levels=[];for(let w=width,h=height;;w=Math.max(1,Math.floor(w/2)),h=Math.max(1,Math.floor(h/2))){
    levels.push({width:w,height:h,bytes:compressed?Math.ceil(w/4)*Math.ceil(h/4)*16:w*h*4});if(w===1&&h===1)break;
  }return {levels,bytes:levels.reduce((n,l)=>n+l.bytes,0)};
}
/** Validate ranges before the upstream parser can follow container offsets. */
export function parseAtlasAstc(input,page){
  if(!(input instanceof Uint8Array)&&!(input instanceof ArrayBuffer))fail('byte input required');
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<80||bytes.length>16*1024*1024||!MAGIC.every((n,i)=>bytes[i]===n))fail('container identity/size');
  if(page.encoding!=='astc4x4'||page.alpha!=='premultiplied-gamma-bytes')fail('manifest encoding/alpha');
  const allocation=pageMipBytes(page.w,page.h,true),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u32=o=>view.getUint32(o,true),u64=o=>{const n=Number(view.getBigUint64(o,true));if(!Number.isSafeInteger(n))fail('unsafe 64-bit offset');return n;};
  if(u32(12)!==157||u32(16)!==1||u32(20)!==page.w||u32(24)!==page.h||u32(28)!==0||u32(32)!==0
    ||u32(36)!==1||u32(40)!==allocation.levels.length||u32(44)!==0||u64(64)!==0||u64(72)!==0)fail('format/dimensions/complete chain');
  const headerEnd=80+allocation.levels.length*24;if(headerEnd>bytes.length)fail('truncated level index');
  const ranges=[[0,headerEnd]],range=(offset,length,label)=>{
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||length<=0||offset<headerEnd||offset+length>bytes.length)fail(`${label} range`);
    if(ranges.some(([a,b])=>offset<b&&offset+length>a))fail(`${label} overlap`);ranges.push([offset,offset+length]);
  };
  const dfd=u32(48),dfdLength=u32(52);range(dfd,dfdLength,'DFD');
  if(dfdLength<28||u32(dfd)!==dfdLength||view.getUint16(dfd+10,true)!==dfdLength-4)fail('DFD descriptor length');
  const kvd=u32(56),kvdLength=u32(60);
  if(kvdLength){
    range(kvd,kvdLength,'metadata');let cursor=kvd,count=0;const keys=new Set();
    while(cursor<kvd+kvdLength){
      if(++count>32||cursor+4>kvd+kvdLength)fail('metadata bounds');
      const size=u32(cursor);cursor+=4;const end=cursor+size,padded=end+(4-size%4)%4;
      if(size<2||padded>kvd+kvdLength)fail('metadata entry');
      const zero=bytes.indexOf(0,cursor);if(zero<cursor||zero>=end)fail('metadata key');
      const key=new TextDecoder().decode(bytes.subarray(cursor,zero));
      if(!/^KTX[A-Za-z0-9_]+$/.test(key)||keys.has(key))fail('unsupported/duplicate metadata key');keys.add(key);cursor=padded;
    }
  }else if(kvd!==0)fail('empty metadata offset');
  allocation.levels.forEach((level,i)=>{
    const index=80+i*24,offset=u64(index),length=u64(index+8),raw=u64(index+16);
    if(length!==level.bytes||raw!==length||offset%16)fail('mip block length/alignment');range(offset,length,'mip');
  });
  let container;try{container=read(bytes);}catch{fail('container parsing');}
  const d=container.dataFormatDescriptor[0];
  if(container.dataFormatDescriptor.length!==1||d.vendorId!==0||d.descriptorType!==0||d.versionNumber!==2||d.colorModel!==162
    ||d.transferFunction!==1||d.colorPrimaries!==0||d.flags!==1||d.texelBlockDimension.join()!=='3,3,0,0'
    ||d.bytesPlane.join()!=='16,0,0,0,0,0,0,0')fail('linear premultiplied ASTC descriptor');
  const metadata=container.keyValue;
  if(metadata.KTXorientation!==undefined&&metadata.KTXorientation!=='rd')fail('unsupported orientation');
  if(metadata.KTXswizzle!==undefined&&metadata.KTXswizzle!=='rgba')fail('unsupported swizzle');
  return {mipmaps:container.levels.map((l,i)=>({data:l.levelData,width:allocation.levels[i].width,height:allocation.levels[i].height})),bytes:allocation.bytes};
}
export function astcAvailable(gl,pages){
  const extension=gl.getExtension('WEBGL_compressed_texture_astc');
  return !!extension&&extension.getSupportedProfiles().includes('ldr')&&Array.from(gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS)).includes(0x93b0)
    &&pages.every(p=>p.w<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&p.h<=gl.getParameter(gl.MAX_TEXTURE_SIZE));
}
export function createAtlasAstcTexture(THREE,bytes,page){
  const decoded=parseAtlasAstc(bytes,page),texture=new THREE.CompressedTexture(decoded.mipmaps,page.w,page.h,THREE.RGBA_ASTC_4x4_Format,THREE.UnsignedByteType);
  Object.assign(texture,{flipY:false,premultiplyAlpha:false,colorSpace:THREE.NoColorSpace,generateMipmaps:false,
    minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping});
  texture.userData.atlasMipBytes=decoded.bytes;texture.needsUpdate=true;return texture;
}

/** Explicit diagnostic owner; no product caller. Allocate sampled PNG levels before first publication. */
export function createLimitedMipOwner(THREE,renderer){
  const refuse=message=>{throw Error('limited atlas mips: '+message);},canvas=renderer?.domElement;
  if(typeof renderer?.render!=='function'||typeof renderer.initTexture!=='function'||typeof renderer.copyTextureToTexture!=='function'
    ||typeof renderer.getContext!=='function'||typeof renderer.properties?.get!=='function'||typeof renderer.properties?.has!=='function'||typeof canvas?.addEventListener!=='function'||typeof canvas.removeEventListener!=='function')refuse('renderer prerequisites');
  const descriptor=Object.getOwnPropertyDescriptor(renderer,'render'),native=renderer.render,owned=new Map(),events=[],
    methods=['initTexture','copyTextureToTexture','getContext'].map(key=>({key,value:renderer[key],descriptor:Object.getOwnPropertyDescriptor(renderer,key)})),
    initialContext=renderer.getContext();
  let properties=renderer.properties,propertiesGet=properties.get,propertiesHas=properties.has,propertiesDescriptor=Object.getOwnPropertyDescriptor(properties,'get'),hasDescriptor=Object.getOwnPropertyDescriptor(properties,'has');
  if(!initialContext||initialContext.isContextLost())refuse('lost initial context');
  let epoch=0,busy=false,initializing=false,releasing=false,restored=false,failed=false,failure,pendingLoss=false;
  const same=(a,b)=>['value','writable','enumerable','configurable','get','set'].every(k=>a?.[k]===b?.[k]);
  const record=row=>{if(events.length>=256)refuse('receipt bound');events.push(row);};
  const sticky=error=>{if(!failed){failed=true;failure=error;}return error;};
  const apiOwned=()=>renderer.domElement===canvas&&renderer.properties===properties&&properties.get===propertiesGet&&properties.has===propertiesHas
    &&same(Object.getOwnPropertyDescriptor(properties,'get'),propertiesDescriptor)&&same(Object.getOwnPropertyDescriptor(properties,'has'),hasDescriptor)
    &&methods.every(m=>renderer[m.key]===m.value&&same(Object.getOwnPropertyDescriptor(renderer,m.key),m.descriptor));
  const context=()=>{if(!apiOwned())refuse('public API ownership drift');const gl=renderer.getContext();if(gl!==initialContext)refuse('context identity drift');if(gl.isContextLost())refuse('lost context');if(gl.getError()!==gl.NO_ERROR)refuse('native GL error');return gl;};
  const valid=r=>r.texture.source===r.source&&r.texture.image===r.image&&r.image.complete===true&&r.image.width===r.width&&r.image.height===r.height
    &&r.texture.mipmaps===r.mips&&r.source.dataReady===false&&r.texture.generateMipmaps===false
    &&Object.entries(r.fields).every(([key,value])=>r.texture[key]===value);
  const initialize=r=>{
    if(initializing)refuse('reentrant initialization');if(!valid(r))refuse('texture/image ownership drift');const gl=context(),version=r.texture.version,sourceVersion=r.source.version;let source,error,threw=false;initializing=true;
    try{renderer.initTexture(r.texture);
      assertOwner();if(!apiOwned())refuse('public API ownership drift');if(!valid(r)||r.texture.version!==version||r.source.version!==sourceVersion)refuse('initialization version drift');
      // Copy outside onUpdate: public copying changes unit-zero bindings, which the subsequent render repairs.
      source=new THREE.Texture(r.image);r.texture.generateMipmaps=true;
      try{renderer.copyTextureToTexture(source,r.texture,null,null,0,0);}finally{r.texture.generateMipmaps=false;}
      assertOwner();if(!apiOwned())refuse('public API ownership drift');if(!valid(r)||r.texture.version!==version||r.source.version!==sourceVersion||gl.isContextLost()||gl.getError()!==gl.NO_ERROR)refuse('copy/generation failed or changed version');
    }catch(e){threw=true;error=e;}finally{initializing=false;try{source?.dispose();}catch(e){if(threw)error=new AggregateError([error,e],'limited atlas mips: initialization and source cleanup failed');else{threw=true;error=e;}}}
    if(threw)throw error;assertOwner();context();if(!valid(r)||r.texture.version!==version||r.source.version!==sourceVersion)refuse('source cleanup ownership drift');
    r.version=version;r.sourceVersion=sourceVersion;r.epoch=epoch;record({operation:'initialized',tier:r.tier,levels:r.mips.length,bytes:r.bytes,version,sourceVersion,epoch});
  };
  const assertOwner=(allowRelease=false)=>{if(releasing&&!allowRelease)refuse('release reentrancy');if(restored)refuse('restored owner');if(!same(Object.getOwnPropertyDescriptor(renderer,'render'),installed))refuse('render ownership drift');if(failed)throw failure;};
  const preflight=()=>{assertOwner();context();for(const r of owned.values()){if(!valid(r))refuse('texture/image ownership drift');if(r.version!==r.texture.version||r.sourceVersion!==r.source.version||r.epoch!==epoch)initialize(r);}};
  const wrapped=function(...args){if(this!==renderer||busy||initializing||releasing)refuse('render receiver/reentrancy');busy=true;try{preflight();assertOwner();return Reflect.apply(native,this,args);}catch(error){throw sticky(error);}finally{busy=false;}};
  Object.defineProperty(renderer,'render',{value:wrapped,writable:true,enumerable:descriptor?.enumerable??true,configurable:true});const installed=Object.getOwnPropertyDescriptor(renderer,'render');
  const onLost=event=>{try{if(event?.isTrusted!==true||event.target!==canvas||event.type!=='webglcontextlost'||!apiOwned()
    ||!same(Object.getOwnPropertyDescriptor(renderer,'render'),installed)||renderer.getContext()!==initialContext||!initialContext.isContextLost())refuse('lost context ownership drift');pendingLoss=true;}catch(error){sticky(error);}};
  const onRestored=event=>{try{
    if(!pendingLoss||event?.isTrusted!==true||event.target!==canvas||event.type!=='webglcontextrestored'||renderer.domElement!==canvas
      ||!same(Object.getOwnPropertyDescriptor(renderer,'render'),installed)||!methods.every(m=>renderer[m.key]===m.value&&same(Object.getOwnPropertyDescriptor(renderer,m.key),m.descriptor))
      ||renderer.getContext()!==initialContext||initialContext.isContextLost()||renderer.properties===properties||typeof renderer.properties?.get!=='function'||typeof renderer.properties?.has!=='function'
      ||[...owned.keys()].some(t=>renderer.properties.has(t)))refuse('restored context ownership drift');
    // Three's earlier native listener replaces WebGLProperties; admit that fresh store only at this event.
    properties=renderer.properties;propertiesGet=properties.get;propertiesHas=properties.has;propertiesDescriptor=Object.getOwnPropertyDescriptor(properties,'get');hasDescriptor=Object.getOwnPropertyDescriptor(properties,'has');epoch++;pendingLoss=false;
  }catch(error){sticky(error);}};try{canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);}catch(error){const cleanup=[];
    for(const fn of [()=>canvas.removeEventListener('webglcontextlost',onLost),()=>canvas.removeEventListener('webglcontextrestored',onRestored),()=>{if(descriptor)Object.defineProperty(renderer,'render',descriptor);else delete renderer.render;}])try{fn();}catch(e){cleanup.push(e);}if(cleanup.length)throw new AggregateError([error,...cleanup],'limited atlas mips: owner setup and cleanup failed');throw error;}
  const originalFields=r=>{r.texture.mipmaps=r.originalMips;r.source.dataReady=r.originalReady;r.texture.generateMipmaps=r.originalGenerate;r.texture.needsUpdate=true;};
  return {
    register(texture,page,tier){assertOwner();if(busy)refuse('register during draw');if(!['field','close'].includes(tier)||owned.has(texture))refuse('tier/duplicate');
      const image=texture?.image,width=page?.w,height=page?.h;
      if(!texture?.isTexture||texture.isCompressedTexture||texture.isDataTexture||texture.isRenderTargetTexture||texture.format!==THREE.RGBAFormat||texture.type!==THREE.UnsignedByteType
        ||!image||image.complete!==true||image.width!==width||image.height!==height||!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<4||Math.max(width,height)>8192
        ||texture.mipmaps.length!==0||texture.source.dataReady!==true||texture.generateMipmaps!==true||texture.flipY!==false||texture.premultiplyAlpha!==true||texture.colorSpace!==THREE.NoColorSpace
        ||texture.minFilter!==THREE.LinearMipmapLinearFilter||texture.magFilter!==THREE.LinearFilter||texture.wrapS!==THREE.ClampToEdgeWrapping||texture.wrapT!==THREE.ClampToEdgeWrapping
        ||renderer.properties.get(texture).__webglTexture!==undefined)refuse('uninitialized original PNG required');
      const fields=Object.fromEntries(['flipY','premultiplyAlpha','colorSpace','format','type','minFilter','magFilter','wrapS','wrapT','unpackAlignment','onUpdate'].map(key=>[key,texture[key]])),
        levels=tier==='field'?3:2,mips=Object.freeze(Array.from({length:levels},(_,i)=>Object.freeze({width:Math.max(1,width>>i),height:Math.max(1,height>>i)}))),
        r={texture,source:texture.source,image,width,height,tier,mips,fields,originalMips:texture.mipmaps,originalReady:texture.source.dataReady,originalGenerate:texture.generateMipmaps,bytes:mips.reduce((n,m)=>n+m.width*m.height*4,0)};
      r.dispose=()=>{sticky(Error('limited atlas mips: unexpected registered texture disposal'));record({operation:'unexpected-disposal',tier});texture.removeEventListener('dispose',r.dispose);};
      try{texture.mipmaps=mips;texture.source.dataReady=false;texture.generateMipmaps=false;texture.needsUpdate=true;owned.set(texture,r);texture.addEventListener('dispose',r.dispose);
        initialize(r);return {tier,levels,bytes:r.bytes};}catch(error){sticky(error);const cleanup=[];try{record({operation:'failure',tier,error:String(error?.message??error)});}catch(e){cleanup.push(e);}
        for(const fn of [()=>originalFields(r),()=>texture.removeEventListener('dispose',r.dispose),()=>texture.dispose()])try{fn();}catch(e){cleanup.push(e);}owned.delete(texture);if(cleanup.length)throw new AggregateError([error,...cleanup],'limited atlas mips: registration and cleanup failed');throw error;}
    },
    // The caller still owns native disposal. Release only a verified page, keeping other tiers gated.
    releaseForDisposal(texture){
      assertOwner();if(busy||initializing)refuse('release during draw/initialization');
      const r=owned.get(texture);if(!r||!valid(r))refuse('release texture ownership drift');context();
      if(events.length>=256)refuse('receipt bound');
      const entry={operation:'released-for-disposal',textureUUID:texture.uuid,tier:r.tier,levels:r.mips.length,bytes:r.bytes,version:texture.version,sourceVersion:r.source.version,epoch};
      releasing=true;
      try{
        originalFields(r);texture.removeEventListener('dispose',r.dispose);assertOwner(true);context();
        if(texture.source!==r.source||texture.image!==r.image||texture.mipmaps!==r.originalMips||r.source.dataReady!==r.originalReady||texture.generateMipmaps!==r.originalGenerate
          ||Object.entries(r.fields).some(([key,value])=>texture[key]!==value))refuse('release restoration ownership drift');
        record(entry);owned.delete(texture);return {...entry};
      }catch(error){
        sticky(error);const cleanup=[];
        // Keep failed releases registered in their owned limited state, so independent restore remains possible.
        // Never replace an unexpected foreign image/source or mip array while rolling back.
        if(texture.source===r.source&&texture.image===r.image&&[r.mips,r.originalMips].includes(texture.mipmaps)){
          for(const fn of [()=>{texture.mipmaps=r.mips;},()=>{r.source.dataReady=false;},()=>{texture.generateMipmaps=false;},()=>texture.addEventListener('dispose',r.dispose)])try{fn();}catch(e){cleanup.push(e);}
        }
        if(cleanup.length)throw new AggregateError([error,...cleanup],'limited atlas mips: release and rollback failed');throw error;
      }finally{releasing=false;}
    },
    initialize(){if(busy)refuse('initialization during draw');try{preflight();}catch(error){throw sticky(error);}},
    receipt(){return {diagnosticOnly:true,nativeFeasibility:'UNRUN until external native readback',epoch,failed,error:failed?String(failure?.message??failure):null,events:structuredClone(events),pages:[...owned.values()].map(r=>({tier:r.tier,levels:r.mips.length,bytes:r.bytes,version:r.version,sourceVersion:r.sourceVersion,epoch:r.epoch}))};},
    restore(){if(releasing)refuse('release reentrancy');if(restored){if(failed)throw failure;return;}if(busy||!same(Object.getOwnPropertyDescriptor(renderer,'render'),installed))refuse('restore ownership drift');
      for(const r of owned.values())if(!valid(r))refuse('restore texture ownership drift');const errors=[];
      for(const r of [...owned.values()])for(const fn of [()=>originalFields(r),()=>r.texture.removeEventListener('dispose',r.dispose)])try{fn();}catch(e){errors.push(e);}
      for(const [name,fn]of [['webglcontextlost',onLost],['webglcontextrestored',onRestored]])try{canvas.removeEventListener(name,fn);}catch(e){errors.push(e);}try{if(descriptor)Object.defineProperty(renderer,'render',descriptor);else delete renderer.render;}catch(e){errors.push(e);}
      owned.clear();restored=true;if(errors.length){sticky(new AggregateError(errors,'limited atlas mips: restoration failed'));throw failure;}
    }
  };
}

// Qualified retained payload foundation. No caller, upload certificate or retirement operation.
export const QUALIFIED_ASTC_PAYLOADS = Object.freeze(Object.fromEntries([
  ['cs-close-base-0-astc.ktx2',1808,4938464,'b8166cadc1aeb0e7212bf81e9b105d5fb2e4e46c1912776289553028235677c5'],
  ['cs-close-base-1-astc.ktx2',1808,4938464,'47c36c5a0b215d47b16fdb3d647ef72913aa0a4f7ff9c2e3e487d09d9ff13a2c'],
  ['cs-close-base-2-astc.ktx2',1804,4929760,'ad30e65d87dbb9313f05f2548b85776e795e5cf58cd16ec2e9ad43f89f7491bc'],
  ['cs-close-base-3-astc.ktx2',1968,5375328,'4d5eca2159be8fca43dc7613f4a08b5cdb5d38c6ce736c1ddb64c8d39878a0bb'],
  ['cs-close-h2_slouch_roll_butternut-0-astc.ktx2',1808,4938464,'16eb7e53c3a74011defa0cb040a5f7fe7ca0af37334624a249067bfa0efd8647'],
  ['cs-close-h2_slouch_roll_butternut-1-astc.ktx2',1808,4938464,'0beab1432ca741c779e17ce002db7efb562fc87530d3ad620d4ae5f25e12cdcd'],
  ['cs-close-h2_slouch_roll_butternut-2-astc.ktx2',1800,4917472,'8f0c7ed1bbed4c1630cf9fbe4f269e88b7ae0e783edbe203c6845177be6f6193'],
  ['cs-close-h2_slouch_roll_butternut-3-astc.ktx2',1952,5331296,'d3c434628b6c5f537e69b05d66f8f5c64b283a1c1bf8919b5118786aea816fad'],
].map(([file,h,bytes,sha256]) => [file,Object.freeze({file,w:2048,h,bytes,mipLevels:12,
  encoding:'astc4x4',alpha:'premultiplied-gamma-bytes',sha256})])));

const payloadGetDescriptor=Object.getOwnPropertyDescriptor,payloadGetPrototype=Object.getPrototypeOf,payloadOwnKeys=Reflect.ownKeys,
  payloadApply=Reflect.apply,payloadFreeze=Object.freeze,payloadHasOwn=Object.hasOwn,payloadIs=Object.is,
  payloadString=String,payloadSlice=String.prototype.slice,payloadMax=Math.max,PayloadError=Error,
  PayloadPromise=Promise,payloadResolve=Promise.resolve,payloadReject=Promise.reject,payloadThen=Promise.prototype.then;
const payloadDescriptor = (object,key) => {
  for(let owner=object;owner;owner=payloadGetPrototype(owner)){
    const descriptor=payloadGetDescriptor(owner,key);if(descriptor)return {owner,descriptor};
  }
  return {owner:null,descriptor:null};
};
const payloadSameDescriptor = (a,b) => !!a===!!b && (!a || payloadIs(a.value,b.value)&&a.get===b.get&&a.set===b.set
  &&a.writable===b.writable&&a.enumerable===b.enumerable&&a.configurable===b.configurable);
const payloadTransfer = globalThis.structuredClone, payloadCrypto = globalThis.crypto,
  payloadSubtle = payloadCrypto?.subtle, payloadDigest = payloadSubtle?.digest,
  payloadLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,
  payloadResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get,
  payloadDispose = PayloadTHREE.Texture.prototype.dispose, payloadDispatch = PayloadTHREE.Texture.prototype.dispatchEvent;
const payloadBindings=[...['structuredClone','crypto','ArrayBuffer','Uint8Array','DataView','TextDecoder','Object','Array','Number','String','Promise','Math','Reflect'].map(k=>[globalThis,k]),[payloadCrypto,'subtle'],[payloadSubtle,'digest']]
  .filter(([object])=>object).map(([object,key])=>({object,key,...payloadDescriptor(object,key)}));
// The parser and Three constructors share mutable prototypes. Pin their hooks without invoking them.
const payloadHooks=[Object.prototype,Object,Array.prototype,Array,String.prototype,String,Number.prototype,Number,Promise.prototype,Promise,Math,Reflect,
  ArrayBuffer.prototype,Uint8Array.prototype,payloadGetPrototype(Uint8Array.prototype),DataView.prototype,TextDecoder.prototype,
  PayloadTHREE.CompressedTexture,PayloadTHREE.CompressedTexture.prototype,PayloadTHREE.Texture,PayloadTHREE.Texture.prototype,
  PayloadTHREE.TextureSource,PayloadTHREE.TextureSource.prototype,PayloadTHREE.EventDispatcher.prototype,
  PayloadTHREE.Vector2.prototype,PayloadTHREE.Matrix3.prototype].map(object=>({object,prototype:payloadGetPrototype(object),
    keys:payloadOwnKeys(object),descriptors:payloadOwnKeys(object).map(key=>payloadGetDescriptor(object,key))}));

/** Transfer only a complete qualified file. Handoff exposes mips and keeps them charged forever here. */
export function createQualifiedAtlasPayload(input, page) {
  const refuse = message => { throw new PayloadError('qualified atlas payload: '+message); };
  const stable = () => {
    for(let i=0;i<payloadHooks.length;i++){
      const h=payloadHooks[i],keys=payloadOwnKeys(h.object);
      if(payloadGetPrototype(h.object)!==h.prototype||keys.length!==h.keys.length)refuse('construction hook ownership changed');
      for(let j=0;j<keys.length;j++)if(keys[j]!==h.keys[j]||!payloadSameDescriptor(payloadGetDescriptor(h.object,keys[j]),h.descriptors[j]))
        refuse('construction hook ownership changed '+i+'/'+j);
    }
    for(let i=0;i<payloadBindings.length;i++){
      const b=payloadBindings[i],current=payloadDescriptor(b.object,b.key);
      if(current.owner!==b.owner||!payloadSameDescriptor(current.descriptor,b.descriptor))refuse('intrinsic ownership changed');
    }
    if(typeof payloadTransfer!=='function'||typeof payloadDigest!=='function')refuse('intrinsic ownership changed');
  };
  stable();
  const value = (object,key) => {
    const d = payloadGetDescriptor(object,key);
    if (!d || !payloadHasOwn(d,'value')) refuse('scalar data property required');
    return d.value;
  };
  if (!page || payloadGetPrototype(page)!==Object.prototype) refuse('plain page required');
  const file = value(page,'file'), spec = typeof file==='string' && payloadHasOwn(QUALIFIED_ASTC_PAYLOADS,file)
    ? QUALIFIED_ASTC_PAYLOADS[file] : null;
  if (!spec) refuse('qualified file required');
  const keys = ['file','w','h','bytes','mipLevels','encoding','alpha'];
  if (payloadOwnKeys(page).length!==keys.length || keys.some(k=>value(page,k)!==spec[k])) refuse('qualified page binding');
  if (!input || payloadGetPrototype(input)!==ArrayBuffer.prototype || payloadOwnKeys(input).length)
    refuse('whole ordinary ArrayBuffer required');
  let length;
  try { length=payloadApply(payloadLength,input,[]); if(payloadResizable&&payloadApply(payloadResizable,input,[])) refuse('fixed backing required'); new Uint8Array(input); }
  catch { refuse('live fixed backing required'); }
  if (length!==spec.bytes) refuse('whole file length');
  stable();
  let owned = payloadTransfer(input,{transfer:[input]});
  if (payloadApply(payloadLength,input,[])!==0 || payloadApply(payloadLength,owned,[])!==length) refuse('transfer incomplete');
  let state='owned', closed=false, failed=false, failure, cleanupFailed=false, task=null,
    hashing=false, texture=null, disposalAttempted=false, handedOffBackingBytes=0,uncertainBackingBytes=0;
  const describe = error => {
    if (error===null) return 'null';
    const type=typeof error;
    if (type==='undefined'||type==='boolean'||type==='number'||type==='string') return payloadApply(payloadSlice,payloadString(error),[0,4096]);
    try { const d=payloadGetDescriptor(error,'message');
      if(d&&payloadHasOwn(d,'value')&&typeof d.value==='string')return payloadApply(payloadSlice,d.value,[0,4096]);
    } catch {}
    return 'unknown thrown value';
  };
  const sticky = error => { if(!failed){failed=true;failure=error;} if(!closed)state='failed'; };
  const status = () => payloadFreeze({file,state,failed,error:failed?describe(failure):null,cleanupFailed,
    ownedBackingBytes:owned?length:0,digestCopyBytes:hashing?length:0,digestOutputBytes:hashing?32:0,
    handedOffBackingBytes,uncertainBackingBytes,
    retainedBackingBytes:payloadMax(owned?length:0,handedOffBackingBytes,uncertainBackingBytes),retirementAvailable:false});
  const releasePrivate = () => {
    if (texture && !disposalAttempted) {
      const disposing=texture;
      disposalAttempted=true;
      try{stable();}catch{cleanupFailed=true;uncertainBackingBytes=length;sticky(new PayloadError('qualified atlas payload: cleanup ownership changed'));}
      const sameMethod = (key,expected) => {
        for(let p=disposing;p;p=payloadGetPrototype(p)){
          const d=payloadGetDescriptor(p,key);
          if(d)return payloadHasOwn(d,'value')&&d.value===expected;
        }
        return false;
      };
      let methodsOwned=false;
      try{methodsOwned=sameMethod('dispose',payloadDispose)&&sameMethod('dispatchEvent',payloadDispatch);}catch{}
      if(!methodsOwned){
        cleanupFailed=true;uncertainBackingBytes=length;sticky(new PayloadError('qualified atlas payload: cleanup ownership changed'));
      }
      try { payloadApply(payloadDispose,disposing,[]); }
      catch(error){cleanupFailed=true;uncertainBackingBytes=length;sticky(error);}
    }
    texture=null;
    if(!hashing)owned=null;
  };
  const requireState = expected => {
    if(failed)throw failure;
    if(closed || state!==expected)refuse('invalid state');
    stable();
    if(failed)throw failure;
    if(closed || state!==expected)refuse('invalid state');
  };
  const api = {
    status,
    verify() {
      if(task)return task;
      if(closed || failed) { task=payloadApply(payloadReject,PayloadPromise,[failed?failure:new PayloadError('qualified atlas payload: closed')]); return task; }
      try{stable();}catch(error){sticky(error);releasePrivate();task=payloadApply(payloadReject,PayloadPromise,[failure]);return task;}
      state='hashing';
      // Publish the shared promise before invoking even the captured digest implementation.
      task=payloadApply(payloadThen,payloadApply(payloadResolve,PayloadPromise,[]),[async()=>{
        let digest=null;
        try {
          if(closed)refuse('closed'); stable(); hashing=true;
          digest=await payloadApply(payloadDigest,payloadSubtle,['SHA-256',owned]);
          stable();
          const hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
          if(hex!==spec.sha256)refuse('digest mismatch');
          if(closed)refuse('closed');
          state='verified';
        } catch(error){sticky(error);}
        finally { digest=null;hashing=false;if(closed||failed)releasePrivate(); }
        if(failed)throw failure;
        return status();
      }]);
      return task;
    },
    construct() {
      requireState('verified');
      try {
        const decoded=parseAtlasAstc(owned,spec);
        texture=new PayloadTHREE.CompressedTexture(decoded.mipmaps,spec.w,spec.h,PayloadTHREE.RGBA_ASTC_4x4_Format,PayloadTHREE.UnsignedByteType);
        requireState('verified');
        Object.assign(texture,{flipY:false,premultiplyAlpha:false,colorSpace:PayloadTHREE.NoColorSpace,generateMipmaps:false,
          minFilter:PayloadTHREE.LinearMipmapLinearFilter,magFilter:PayloadTHREE.LinearFilter,
          wrapS:PayloadTHREE.ClampToEdgeWrapping,wrapT:PayloadTHREE.ClampToEdgeWrapping});
        texture.userData.atlasMipBytes=decoded.bytes;texture.needsUpdate=true;
        requireState('verified');
        state='constructed-private';
        return status();
      } catch(error){sticky(error);releasePrivate();throw failure;}
    },
    handOff() {
      requireState('constructed-private');
      const result=texture;
      handedOffBackingBytes=length;texture=null;owned=null;state='handed-off';
      return result;
    },
    close() {
      closed=true;state='closed';releasePrivate();
      if(failed)throw failure;
      return status();
    },
  };
  return payloadFreeze(api);
}

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

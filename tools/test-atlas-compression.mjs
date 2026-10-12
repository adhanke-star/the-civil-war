import assert from 'node:assert/strict';
import {createDefaultContainer,write} from '../vendor/three/examples/jsm/libs/ktx-parse.module.js';
import {parseAtlasAstc,pageMipBytes,astcAvailable} from '../src/units/atlas-compression.js';
const page={w:8,h:8,encoding:'astc4x4',alpha:'premultiplied-gamma-bytes'};
function fixture(metadata={}){
 const c=createDefaultContainer();Object.assign(c,{vkFormat:157,pixelWidth:8,pixelHeight:8,levelCount:4,keyValue:metadata});
 const d=c.dataFormatDescriptor[0];Object.assign(d,{colorModel:162,colorPrimaries:0,transferFunction:1,flags:1,texelBlockDimension:[3,3,0,0],bytesPlane:[16,0,0,0,0,0,0,0],samples:[{bitOffset:0,bitLength:127,channelType:0,samplePosition:[0,0,0,0],sampleLower:0,sampleUpper:0xffffffff}]});
 c.levels=pageMipBytes(8,8,true).levels.map(l=>({levelData:new Uint8Array(l.bytes).fill(l.width),uncompressedByteLength:l.bytes}));return write(c);
}
const original=fixture(),edit=(offset,value,big=false)=>{const b=original.slice(),v=new DataView(b.buffer);if(big)v.setBigUint64(offset,BigInt(value),true);else v.setUint32(offset,value,true);return b;};
const api={parse:parseAtlasAstc,mips:pageMipBytes,caps:astcAvailable};
const refuses=(a,b,p=page)=>assert.throws(()=>a.parse(b,p),/baked ASTC/);
const checks=[
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
  'complete-chain':{parse:()=>({mipmaps:[],bytes:0})},'npot-accounting':{mips:()=>({bytes:0})},'capability-route':{caps:()=>true},
 };
 for(const [name,check]of checks){const mutant=mutants[name]||{parse:()=>({mipmaps:[],bytes:0})};let error;try{check({...api,...mutant});}catch(e){error=e;}assert.equal(error?.code,'ERR_ASSERTION',`${name}: mutant must reject its own assertion`);console.log(`CAUGHT ${name}`);}
 console.log(`ATLAS-COMPRESSION CONTROLS OK (${checks.length}/${checks.length})`);
}

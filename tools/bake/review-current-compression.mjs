// Actions-only actual GPU readback of current five-page PNG/raw/UASTC/direct-format candidates.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { candidateKtx } from './compress.mjs';
import { readSmall, outputBytes } from './current-compression.mjs';
import { comparePixels, candidateSupported } from './review-compression.mjs';

export async function gpuReadback({ png, premul, files, w, h }) {
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
  if(astcSupported) textures.astc=await decode(files.astc);
  const metadata={};
  for(const [name,t] of Object.entries(textures)) {
    Object.assign(t,{colorSpace:T.NoColorSpace,flipY:false,generateMipmaps:name==='png'||name==='premul',premultiplyAlpha:name==='png',
      minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter}); t.needsUpdate=true;
    metadata[name]={format:Object.entries(T).find(([k,v])=>k.endsWith('Format')&&v===t.format)?.[0],allocation:t.mipmaps.reduce((s,m)=>s+m.data.byteLength,0),
      levels:t.mipmaps.length,colorSpace:t.colorSpace,premultiplyAlpha:t.premultiplyAlpha,generateMipmaps:t.generateMipmaps,flipY:t.flipY};
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
    return {caps,metadata,astcSupported,errors,levels,unsupportedRejected:!window.supported({...caps,bptc:false,astc:false,formats:[]},'bc7',w,h)
      && !window.supported({...caps,bptc:false,astc:false,formats:[]},'astc',w,h)};
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
async function main() {
  if(process.env.GITHUB_ACTIONS!=='true') throw new Error('current compression review: Actions only');
  const out=fs.realpathSync(path.join(ROOT,'.out/current-compression')),report=JSON.parse(readSmall(out,'compression.json'));
  const closeOnly=report.mode==='cs-close-qualification';
  if(report.pages.length!==(closeOnly?10:5) || report.fieldable!==false) throw new Error('current compression review: coverage incomplete');
  const review={diagnosticOnly:true,fieldable:false,mode:report.mode,toolSha:process.env.GITHUB_SHA,sources:report.sources,pages:[],sheets:[],complete:false,qualified:false};
  const {server,url}=await startServer({port:0});let browser;
  try {
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.route(url+'current-compression',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><script type="module">'+
      "import * as T from 'three';import {KTX2Loader} from '/node_modules/three/examples/jsm/loaders/KTX2Loader.js';window.T=T;window.renderer=new T.WebGLRenderer({antialias:false});"+
      "window.decoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);window.rgbaDecoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);for(const k of Object.keys(rgbaDecoder.workerConfig))rgbaDecoder.workerConfig[k]=false;window.supported="+candidateSupported.toString()+';window.ready=true;</script>'}));
    for(const [i,p] of report.pages.entries()) {
      await page.goto(url+'current-compression');await page.waitForFunction(()=>window.ready);
      const files=Object.fromEntries(Object.entries(p.files).map(([f,name])=>[f,readSmall(out,name)])),png=readSmall(out,p.original),premul=PNG.sync.read(png);
      for(let k=0;k<premul.data.length;k+=4)for(let c=0;c<3;c++)premul.data[k+c]=Math.round(premul.data[k+c]*premul.data[k+3]/255);
      const direct=closeOnly?['raw','astc']:['raw','bc7','astc'];
      const info=Object.fromEntries(direct.map(f=>[f,candidateKtx(files[f],p.w,p.h,f)]));
      const actual=await page.evaluate(gpuReadback,{png:png.toString('base64'),premul:premul.data.toString('base64'),files:Object.fromEntries(Object.entries(files).map(([k,b])=>[k,b.toString('base64')])),w:p.w,h:p.h});
      const levels=actual.levels.map(l=>({...l,data:Object.fromEntries(Object.entries(l.data).map(([k,b])=>[k,Buffer.from(b,'base64')]))})),comparisons=[];
      for(const l of levels) {
        const soft=PNG.sync.read(readSmall(out,p.astcSoftware[l.lod]));
        if(soft.width!==l.width||soft.height!==l.height)throw new Error('current compression: software dimensions');
        l.data['astc-software']=soft.data;
        for(const route of ['premul','raw',...(closeOnly?[]:['rgba','uastc','bc7']),'astc-software',...(actual.astcSupported?['astc']:[])]) comparisons.push({route:'png->'+route,lod:l.lod,metrics:comparePixels(l.data.png,l.data[route])});
        for(const route of [...(closeOnly?[]:['uastc','bc7']),'astc-software',...(actual.astcSupported?['astc']:[])])comparisons.push({route:'raw->'+route,lod:l.lod,metrics:comparePixels(l.data.raw,l.data[route])});
      }
      const at=(route,lod)=>comparisons.find(c=>c.route===route&&c.lod===lod).metrics;
      const base=levels[0].data.raw;
      const controls={upload:[0,1,2].every(l=>at('png->premul',l).ok),rawBase:at('png->raw',0).ok,identity:levels.every((l,i)=>l.data.raw.equals(info.raw.levels[i].data)),
        missing:!comparePixels(base,Buffer.alloc(base.length)).ok,unsupported:actual.unsupportedRejected};
      for(const k of ['WrongAlpha','DoublePremul','AutomaticSrgb'])controls[k]=!comparePixels(base,levels[0].data[k]).ok;
      const md=actual.metadata,integrity=actual.errors.every(e=>e===0)&&md.raw.format==='RGBAFormat'
        &&(closeOnly||(md.rgba.format==='RGBAFormat'&&md.uastc.format==='RGBA_BPTC_Format'&&md.bc7.format==='RGBA_BPTC_Format'))
        && (!actual.astcSupported||md.astc.format==='RGBA_ASTC_4x4_Format')
        && ['raw',...(closeOnly?[]:['bc7']),...(actual.astcSupported?['astc']:[])].every(f=>md[f].allocation===info[f].allocation&&md[f].levels===p.allocation.levels)
        && (closeOnly||(md.uastc.allocation===p.allocation.block16&&md.rgba.allocation===p.allocation.rgba8))
        && Object.entries(md).every(([n,m])=>m.colorSpace===''&&m.flipY===false&&m.premultiplyAlpha===(n==='png')&&m.generateMipmaps===(n==='png'||n==='premul'));
      const quality=Object.fromEntries([...(closeOnly?[]:['uastc','bc7']),'astc-software',...(actual.astcSupported?['astc']:[])].map(f=>[f,comparisons.filter(c=>c.route.endsWith('->'+f)).every(c=>c.metrics.ok)]));
      const entry={id:p.id,look:p.look,frames:p.frames.length,shownFrames:0,integrity,controls,quality,comparisons,allocation:p.allocation,metadata:md,capabilities:actual.caps,glErrors:actual.errors,astcGpu:actual.astcSupported?'RUN':'UNRUN'};
      review.pages.push(entry);
      if(closeOnly) {
        await page.evaluate(()=>{decoder.dispose();rgbaDecoder.dispose();renderer.dispose();});
        await page.setViewportSize({width:1800,height:1000});
        const routes=['png','astc-software',...(actual.astcSupported?['astc']:[])];
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
          await page.setContent(`<style>body{background:#eee8da;color:#20251a;font:16px sans-serif}h2{font-size:18px;margin:4px}.row{display:flex;align-items:center}figure{flex:1;margin:2px;min-width:0}img{width:100%;height:130px;object-fit:contain}section{background:#d9ddc9;padding:4px;margin:8px}</style><h1>${number}. CS CLOSE QUALIFICATION — ${p.id}</h1><p>Every frame, direction and mip0/1/2 over light/dark ground. Original PNG / ASTC software / actual ASTC GPU ${entry.astcGpu}. Qualification only; visual approval, scene memory and runtime fallback remain required.</p>${cards.join('')}`);
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
    review.qualified=closeOnly&&closeQualified(review);
    if(!review.complete)throw new Error('current compression: diagnostic integrity/control failure; inspect quality.json');
    if(closeOnly&&!review.qualified)throw new Error('CS close qualification: a required page/route failed unchanged quality; inspect quality.json');
  } finally {fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify(review,null,2));if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href)await main();

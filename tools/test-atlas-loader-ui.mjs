// Actions-only controls. Synthetic fixture controls are separate from native GL upload observations.
import {installAllocationObserver,AllocationLedger,mipSizes,ReservationPeak} from './bake/scene-allocation.mjs';
export async function atlasLoaderControls({ browser, url, check, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  try {
    await page.goto(url + '?nosw');
    await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    const report = await page.evaluate(async () => {
      const { loaderFixture } = await import('./tools/atlas-loader-fixture.mjs');
      const {configureSceneCloseRoute}=await import('./tools/bake/inactive-figures.mjs');
      const THREE = await import('three'), rows = [];
      const row = (name, ok, detail) => rows.push({ name, ok: !!ok, detail });
      for (const [name, options] of [['success', {}], ['unsupported', { unsupported: true }],
        ['malformed', { malformed: true }], ['http', { httpFailure: true }], ['upload', { uploadFailure: true }]]) {
        const f = loaderFixture(options);
        try {
          const a = f.atlas.load('close'), b = f.atlas.load('close');
          const ts = await a;
          const candidate = name === 'success', firstBaseline = f.events.findIndex(e => e.startsWith('png:baseline/'));
          row(name, a === b && ts.length === (candidate ? 10 : 5)
            && f.atlas.layout === f.before.layout && f.atlas.layout.tiers.field === f.before.field
            && f.pools.every((p, i) => p.batches.field === f.before.batches[i] && p.layout === f.atlas.layout
              && p.batches.close.length === ts.length)
            && (name === 'unsupported' ? !f.events.some(e => e.startsWith('fetch:')) : candidate ||
              (f.disposed.size >= 9 && f.events.lastIndexOf('dispose') < firstBaseline)),
            { pages: ts.length, disposed: f.disposed.size, events: f.events, failure: f.atlas.closeDiagnosticFailure });
        } finally { f.cleanup(); }
      }
      const late = loaderFixture({ httpFailure: true, delay: true });
      try {
        const task = late.atlas.load('close'); for (let i = 0; i < 20; i++) await Promise.resolve();
        const pending = !late.atlas.loaded('close') && late.pools.every(p => !p.batches.close.length)
          && !late.events.some(e => e.startsWith('png:baseline/'));
        late.releaseLate(); await task;
        row('delayed-sibling', pending && late.disposed.size === 9
          && late.events.indexOf('late-done') < late.events.lastIndexOf('dispose')
          && late.events.lastIndexOf('dispose') < late.events.findIndex(e => e.startsWith('png:baseline/')), late.events);
      } finally { late.releaseLate(); late.cleanup(); }
      const mount = loaderFixture();
      try {
        let once = true; mount.pools[1].group.addEventListener('childadded', () => {
          if (once) { once = false; throw new Error('controlled native added callback failure'); }
        });
        await mount.atlas.load('close');
        row('mount-rollback', mount.disposed.size === 10 && mount.atlas.layout.tiers.close === mount.before.close
          && mount.pools.every(p => p.batches.close.length === 5 && p.group.children.length === 18), mount.events);
      } finally { mount.cleanup(); }
      const reentrant = loaderFixture();
      try {
        let once = true; reentrant.pools[0].group.addEventListener('childadded', () => {
          if (once) { once = false; reentrant.addPool(); }
        });
        await reentrant.atlas.load('close');
        row('reentrant-pool', reentrant.pools.length === 3
          && reentrant.pools.every(p => p.batches.close.length === 10 && p.group.children.length === 28), { pools: reentrant.pools.length });
      } finally { reentrant.cleanup(); }
      const disposed = loaderFixture({ delay: true });
      try {
        const task = disposed.atlas.load('close'); for (let i = 0; i < 20; i++) await Promise.resolve();
        disposed.atlas.dispose(); disposed.releaseLate(); let rejection;
        try { await task; } catch (error) { rejection = error.message; }
        row('dispose-pending', rejection?.includes('disposed') && !disposed.atlas.loaded('close')
          && disposed.disposed.size === 10 && disposed.pools.every(p => p.group.children.length === 0)
          && !disposed.events.some(e => e.startsWith('png:baseline/')), { rejection, events: disposed.events });
      } finally { disposed.releaseLate(); disposed.cleanup(); }

      const canvas = document.createElement('canvas'), renderer = new THREE.WebGLRenderer({ canvas });
      const gl = renderer.getContext();
      try {
        const f = loaderFixture(); f.atlas.renderer = renderer;
        try {
          const ts = await f.atlas.load('close');
          row('native-route-upload', ts.every(t => gl.isTexture(renderer.properties.get(t).__webglTexture))
            && gl.getError() === gl.NO_ERROR && ts.length === (gl.getExtension('WEBGL_compressed_texture_astc') ? 10 : 5),
            { pages: ts.length, astc: !!gl.getExtension('WEBGL_compressed_texture_astc'), memory: f.atlas.memoryBytes() });
        } finally { f.cleanup(); }
        // Constructed tiny manifests exercise real-GL configuration, never retained qualified-art admission.
        for(const route of ['capable','unsupported']){
          const US=loaderFixture(),CS=loaderFixture(),sourceManifest=CS.atlas.diagnosticClose.sourceManifest;
          US.atlas.diagnosticClose=undefined;CS.atlas.diagnosticClose=undefined;
          const before={renderer:Object.getOwnPropertyDescriptor(CS.atlas,'renderer'),close:Object.getOwnPropertyDescriptor(CS.atlas,'diagnosticClose')},
            base=new URL('/__scene-qualified/',location.href).href;
          let config;
          try{
            const observations=[];CS.io.observeClose=e=>observations.push(e);
            config=configureSceneCloseRoute({game:{paused:true,baked:{atlases:{US:US.atlas,CS:CS.atlas}}},post:{renderer}},
              {manifest:CS.hybrid,sourceManifest,base,route,candidateRequests:()=>CS.events.filter(e=>e.includes(base)).length});
            await Promise.all([US.atlas.load('close'),CS.atlas.load('close')]);
            const publication=config.assertPublication(),native=CS.atlas.textures.close.map(t=>({uploaded:gl.isTexture(renderer.properties.get(t).__webglTexture),
              versionMatches:renderer.properties.get(t).__version===t.version,compressed:!!t.isCompressedTexture})),restoration=await config.restore();
            const descriptor=(key,prior)=>{const current=Object.getOwnPropertyDescriptor(CS.atlas,key);return ['value','writable','enumerable','configurable','get','set'].every(k=>current?.[k]===prior?.[k]);};
            row('native-configured-'+route,restoration.ok&&publication.fieldUnchanged&&native.every(t=>t.uploaded&&t.versionMatches)
              &&native.filter(t=>t.compressed).length===(route==='capable'?8:0)&&gl.getError()===gl.NO_ERROR
              &&descriptor('renderer',before.renderer)&&descriptor('diagnosticClose',before.close),
              {kind:'constructed tiny two-atlas fixture, actual native GL; full qualified scene UNRUN',publication,native,restoration,nativeCapability:config.nativeCapability});
            const attempt=route==='capable'?'candidate':'baseline',pages=route==='capable'?10:5,of=op=>observations.filter(e=>e.operation===op);
            row('native-observation-'+route,of('created').length===pages&&of('uploaded').length===pages&&of('settled').length===pages
              &&of('all-settled').length===1&&observations.at(-1)?.operation==='publish-start'&&observations.every(e=>e.attempt===attempt)
              &&of('settled').every(e=>e.outcome==='fulfilled'&&of('uploaded').some(u=>u.page===e.page&&u.textureUUID===e.textureUUID&&observations.indexOf(u)<observations.indexOf(e))),
              {kind:'actual native GL, constructed tiny manifests; observer records native-check boundary',observations});
          }finally{if(config)await config.restore();US.cleanup();CS.cleanup();}
        }
        // A genuine native INVALID_VALUE produced during candidate upload must trigger cleanup and fallback.
        // Admission is controlled here to exercise this failure even on a machine without ASTC support.
        const failed = loaderFixture(), nativeUpload = renderer.initTexture.bind(renderer);
        const facade = new Proxy(gl, { get(target, key) {
          if (key === 'getExtension') return name => name === 'WEBGL_compressed_texture_astc'
            ? { getSupportedProfiles: () => ['ldr'] } : target.getExtension(name);
          if (key === 'getParameter') return p => p === gl.COMPRESSED_TEXTURE_FORMATS ? [0x93b0] : target.getParameter(p);
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
        failed.atlas.renderer = { properties: renderer.properties, getContext: () => facade, initTexture(t) {
          if (t.isCompressedTexture) {
            t.addEventListener('dispose', () => { failed.disposed.add(t); failed.events.push('dispose'); });
            // Upload a real uncompressed sentinel, then provoke the native error; candidate is never published.
            const sentinel = new THREE.DataTexture(new Uint8Array(16), 2, 2);
            try { nativeUpload(sentinel); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, -1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
            finally { sentinel.dispose(); }
          } else nativeUpload(t);
        } };
        try {
          const observations=[];failed.io.observeClose=e=>observations.push(e);
          const ts = await failed.atlas.load('close');
          row('native-upload-failure', ts.length === 5 && failed.atlas.layout.tiers.close === failed.before.close
            && failed.atlas.closeDiagnosticFailure === 'baked close: upload GL failure'
            && failed.disposed.size === 10
            && failed.events.lastIndexOf('dispose') < failed.events.findIndex(e => e.startsWith('png:baseline/'))
            && gl.getError() === gl.NO_ERROR && ts.every(t => gl.isTexture(renderer.properties.get(t).__webglTexture)),
            { failure: failed.atlas.closeDiagnosticFailure, pages: ts.length, events: failed.events });
          const candidate=observations.filter(e=>e.attempt==='candidate'),barrier=observations.findIndex(e=>e.attempt==='candidate'&&e.operation==='all-settled'),first=observations.findIndex(e=>e.attempt==='baseline');
          row('native-observation-upload-failure',candidate.filter(e=>e.operation==='settled'&&e.outcome==='rejected').length===8
            &&candidate.filter(e=>e.operation==='uploaded').length===2&&candidate.filter(e=>e.operation==='dispose-result'&&e.ok).length===10
            &&candidate.filter(e=>e.operation==='settled').every(e=>observations.indexOf(e)<barrier)
            &&candidate.filter(e=>e.operation==='dispose-result').every(e=>observations.indexOf(e)>barrier&&observations.indexOf(e)<first)
            &&observations.filter(e=>e.attempt==='baseline'&&e.operation==='uploaded').length===5,
            {kind:'actual native INVALID_VALUE injection; controlled capability facade, not positive ASTC evidence',observations});
        } finally { failed.cleanup(); }
        const fatal=loaderFixture({httpFailure:true});fatal.atlas.renderer=renderer;
        try{
          const observations=[];fatal.io.observeClose=e=>{observations.push(e);if(e.operation==='dispose-result')throw Error('controlled observation cleanup failure');};
          let rejection;try{await fatal.atlas.load('close');}catch(e){rejection={message:e.message,fatal:e.closeObservationFailure,errors:e.observationErrors};}
          row('native-observation-fatal-cleanup',rejection?.fatal===true&&rejection.errors.length===9&&observations.filter(e=>e.operation==='dispose-result'&&e.ok).length===9
            &&observations.filter(e=>e.operation==='settled').length===10&&!observations.some(e=>e.attempt==='baseline')&&!fatal.atlas.loaded('close')&&gl.getError()===gl.NO_ERROR,
            {kind:'actual native GL; observer failure retained independently, every sibling disposed',rejection,observations});
        }finally{fatal.cleanup();}
      } finally { renderer.dispose(); renderer.forceContextLoss(); }
      return { rows };
    });
    result.atlasLoader = report;
    for (const row of report.rows) check(`atlas-loader-${row.name}`, row.ok, JSON.stringify(row.detail));
    check('atlas-loader-errors', errors.length === 0, errors.join('; '));
  } finally { await ctx.close(); }
  await limitedMipControls({browser,url,check,result,watchErrors});
}

async function limitedMipControls({browser,url,check,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:64,height:32}}),errors=[];let page;
 try{await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString(),nativeJournal:true});
  page=await ctx.newPage();watchErrors(page,url,errors);await page.goto(url+'?nosw');await page.waitForFunction(()=>window.__entry&&!window.__entry.importing);
  const proof=await page.evaluate(async()=>{
   const THREE=await import('three'),{createLimitedMipOwner}=await import('./src/units/atlas-compression.js');
   const p={kind:'synthetic PNG, actual public native limited-mip lifecycle; full approved art and scene budget UNRUN',budgetClaim:false,levels:[],views:[],updates:[],snapshots:[],cleanup:[],primary:null};let renderer,owner,full,field,close,wrong,geo,material,gl;
   const clean=(name,fn)=>{try{fn();p.cleanup.push({name,ok:true});}catch(e){p.cleanup.push({name,ok:false,error:String(e?.message??e)});}},encode=b=>{let s='';for(const v of b)s+=String.fromCharCode(v);return btoa(s);};
   try{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const c=canvas.getContext('2d'),data=c.createImageData(64,32);
    for(let y=0;y<32;y++)for(let x=0;x<64;x++)data.data.set([(x*11+y*3)%256,(y*17+x*5)%256,(x*7+y*13)%256,40+(x*9+y*7)%216],(y*64+x)*4);c.putImageData(data,0,0);
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=canvas.toDataURL('image/png');});
    renderer=new THREE.WebGLRenderer({antialias:false});renderer.setPixelRatio(1);renderer.setSize(64,32);gl=renderer.getContext();
    const texture=()=>{const t=new THREE.Texture(image);Object.assign(t,{flipY:false,premultiplyAlpha:true,colorSpace:THREE.NoColorSpace,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping});t.needsUpdate=true;return t;};
    full=texture();field=texture();close=texture();wrong=texture();wrong.premultiplyAlpha=false;
    const nativeRender=Object.getOwnPropertyDescriptor(renderer,'render'),fieldSource=field.source,closeSource=close.source,fieldMips=field.mipmaps,closeMips=close.mipmaps;
    const snapshot=label=>({label,...window.__allocation.snapshot(gl)}),reservation=t=>window.__allocation.textureReservation(gl,renderer.properties.get(t).__webglTexture);
    const levels=(texture,count,rows)=>{const handle=renderer.properties.get(texture).__webglTexture,fb=gl.createFramebuffer(),previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
      try{gl.bindFramebuffer(gl.FRAMEBUFFER,fb);for(let i=0;i<count;i++){const width=64>>i,height=32>>i;gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,handle,i);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('limited mip readback framebuffer');const bytes=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);rows.push({level:i,width,height,pixels:encode(bytes),glError:gl.getError()});}}
      finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);renderer.resetState();}return rows;};
    p.snapshots.push(snapshot('renderer-baseline'));renderer.initTexture(full);p.originalLevels=[];levels(full,3,p.originalLevels);owner=createLimitedMipOwner(THREE,renderer);p.field=owner.register(field,{w:64,h:32},'field');p.close=owner.register(close,{w:64,h:32},'close');
    for(const [tier,texture,count]of [['field',field,3],['close',close,2]]){const r={tier,original:p.originalLevels.slice(0,count),limited:[]};p.levels.push(r);levels(texture,count,r.limited);}
    p.reservations={full:reservation(full),field:reservation(field),close:reservation(close)};p.snapshots.push(snapshot('initialized'));
    geo=new THREE.PlaneGeometry(2,2);material=new THREE.ShaderMaterial({uniforms:{uA:{value:full},uB:{value:full},uLod:{value:0},uMaxA:{value:2},uMaxB:{value:1}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:'uniform sampler2D uA; uniform sampler2D uB; uniform float uLod; uniform float uMaxA; uniform float uMaxB; varying vec2 vUv; void main(){gl_FragColor=vUv.x<0.5?textureLod(uA,vec2(vUv.x*2.0,vUv.y),min(uLod,uMaxA)):textureLod(uB,vec2((vUv.x-0.5)*2.0,vUv.y),min(uLod,uMaxB));}'});
    const scene=new THREE.Scene();scene.add(new THREE.Mesh(geo,material));const camera=new THREE.Camera(),draw=(a,b,lod)=>{material.uniforms.uA.value=a;material.uniforms.uB.value=b;material.uniforms.uLod.value=lod;renderer.render(scene,camera);gl.finish();const bytes=new Uint8Array(64*32*4);gl.readPixels(0,0,64,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return {pixels:encode(bytes),drawCalls:renderer.info.render.calls,drawTriangles:renderer.info.render.triangles,nonuniform:bytes.some((v,i)=>i%4<3&&v!==bytes[i%4]),glError:gl.getError()};};
    for(const lod of [0,.5,1,1.5,2,5]){const r={lod};p.views.push(r);r.original=draw(full,full,lod);r.limited=draw(field,close,lod);}
    field.needsUpdate=true;close.needsUpdate=true;p.updates.push({kind:'needsUpdate',first:draw(field,close,.5)});p.snapshots.push(snapshot('updated'));
    // Genuine damaged native base level: detects missing upload/generation without changing source image or counters.
    const handle=renderer.properties.get(field).__webglTexture;gl.bindTexture(gl.TEXTURE_2D,handle);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,64,32,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(64*32*4));gl.bindTexture(gl.TEXTURE_2D,null);renderer.resetState();p.damaged=draw(field,close,0);field.needsUpdate=true;p.repaired=draw(field,close,0);p.wrongAlpha=draw(wrong,wrong,0);
    p.ownerBefore=owner.receipt();const extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('limited mip native context loss extension unavailable');
    const event=type=>new Promise((resolve,reject)=>{const target=renderer.domElement,listener=e=>{clearTimeout(timer);resolve({type:e.type,trusted:e.isTrusted,prevented:e.defaultPrevented,lost:gl.isContextLost()});},timer=setTimeout(()=>{target.removeEventListener(type,listener);reject(Error('limited mip native '+type+' event timeout'));},10000);target.addEventListener(type,listener,{once:true});});
    const lost=event('webglcontextlost');extension.loseContext();p.contextLost=await lost;
    // Resolving within the loss listener resumes at a microtask checkpoint before dispatch has finished.
    // WEBGL_lose_context permits restoration only after that entire event completes, not inside its listener.
    await new Promise(resolve=>setTimeout(resolve,0));p.beforeRestore={lost:gl.isContextLost(),owner:owner.receipt()};
    const restored=event('webglcontextrestored');extension.restoreContext();p.contextRestored=await restored;
    p.snapshots.push(snapshot('restored-pre-draw'));p.updates.push({kind:'context-restored',first:draw(field,close,.5)});p.ownerAfter=owner.receipt();p.afterContext={field:reservation(field),close:reservation(close)};p.snapshots.push(snapshot('context-restored'));
    owner.restore();p.restoration={render: ['value','writable','enumerable','configurable','get','set'].every(k=>Object.getOwnPropertyDescriptor(renderer,'render')?.[k]===nativeRender?.[k]),
      field:field.source===fieldSource&&field.image===image&&field.mipmaps===fieldMips&&field.source.dataReady===true&&field.generateMipmaps===true,
      close:close.source===closeSource&&close.image===image&&close.mipmaps===closeMips&&close.source.dataReady===true&&close.generateMipmaps===true};
   }catch(e){p.primary=String(e?.message??e);}
   finally{if(owner)clean('owner',()=>owner.restore());for(const [name,t]of [['full',full],['field',field],['close',close],['wrong-alpha',wrong]])if(t)clean(name,()=>t.dispose());if(material)clean('material',()=>material.dispose());if(geo)clean('geometry',()=>geo.dispose());if(gl)clean('finish',()=>gl.finish());if(renderer)clean('renderer',()=>renderer.dispose());if(renderer)clean('context',()=>renderer.forceContextLoss());}
   return p;
  });result.limitedMipProof=proof;
  const healthy=r=>r&&r.glError===0&&r.drawCalls>0&&r.drawTriangles===2&&r.nonuniform;
  check('limited-mip-levels',proof.levels.length===2&&proof.levels.every(r=>r.original.length===r.limited.length&&r.original.every((o,i)=>o.glError===0&&r.limited[i].glError===0&&o.pixels===r.limited[i].pixels)),'actual original vs limited retained mip bytes');
  const exactSlots=(snapshot,reservation,sizes)=>{const rows=snapshot?.textureSlots?.filter(r=>r.texture===reservation?.id)||[];return rows.length===1&&!rows[0].pendingDelete&&JSON.stringify(Object.entries(rows[0].slots))===JSON.stringify(sizes.map((bytes,i)=>['3553:'+i,bytes]));};
  const initialized=proof.snapshots.find(s=>s.label==='initialized'),restored=proof.snapshots.find(s=>s.label==='context-restored'),baseline=proof.snapshots.find(s=>s.label==='renderer-baseline'),restoredBaseline=proof.snapshots.find(s=>s.label==='restored-pre-draw');
  const addedOnly=(before,after,expected)=>{const ids=new Set(before?.textureSlots?.map(r=>r.texture)||[]),added=after?.textureSlots?.filter(r=>!ids.has(r.texture)).map(r=>r.texture).sort((a,b)=>a-b)||[];return expected.every(Number.isInteger)&&JSON.stringify(added)===JSON.stringify([...expected].sort((a,b)=>a-b));};
  check('limited-mip-allocation',proof.reservations?.field.bytes===10752&&proof.reservations?.close.bytes===10240&&proof.field?.levels===3&&proof.close?.levels===2&&proof.afterContext?.field.bytes===10752&&proof.afterContext?.close.bytes===10240&&exactSlots(initialized,proof.reservations?.field,[8192,2048,512])&&exactSlots(initialized,proof.reservations?.close,[8192,2048])&&exactSlots(restored,proof.afterContext?.field,[8192,2048,512])&&exactSlots(restored,proof.afterContext?.close,[8192,2048])&&baseline?.textureSlots.length===4&&addedOnly(baseline,initialized,['full','field','close'].map(k=>proof.reservations?.[k]?.id))&&addedOnly(restoredBaseline,restored,['field','close'].map(k=>proof.afterContext?.[k]?.id))&&proof.snapshots.every(s=>!s.unknown.length),'exact native level slots and baseline-relative IDs before/after restoration; no native source texture; context-loss history is conservative, not a physical-release claim');
  check('limited-mip-first-frames',proof.views.length===6&&proof.views.every(r=>healthy(r.original)&&healthy(r.limited)&&r.original.pixels===r.limited.pixels)&&proof.updates.length===2&&proof.updates.every(r=>healthy(r.first)&&r.first.pixels===proof.views[1].original.pixels)&&proof.contextLost?.trusted&&proof.contextLost.prevented&&proof.contextLost.lost&&proof.beforeRestore?.lost&&!proof.beforeRestore.owner.failed&&proof.contextRestored?.trusted&&!proof.contextRestored.lost&&proof.ownerAfter?.epoch===1&&!proof.ownerAfter.failed,'unit0/unit1/fractional/clamped/updated/restored first frame exact; trusted loss finished before one restore request');
  check('limited-mip-rejecting-controls',healthy(proof.damaged)&&healthy(proof.repaired)&&healthy(proof.wrongAlpha)&&proof.damaged.pixels!==proof.views[0]?.original.pixels&&proof.wrongAlpha.pixels!==proof.views[0]?.original.pixels&&proof.repaired.pixels===proof.views[0]?.original.pixels,'native missing base and alpha drift detected; same source repairs exactly');
  check('limited-mip-restoration',Object.values(proof.restoration||{}).length===3&&Object.values(proof.restoration).every(Boolean)&&proof.cleanup.every(r=>r.ok),'original texture/image/mipmap/source fields and renderer descriptor restored independently');
  check('limited-mip-errors',!proof.primary&&errors.length===0,JSON.stringify({primary:proof.primary,errors}));
 }finally{await ctx.close();}
}

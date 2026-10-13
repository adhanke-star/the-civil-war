// Actions-only controls. Synthetic fixture controls are separate from native GL upload observations.
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
          const ts = await failed.atlas.load('close');
          row('native-upload-failure', ts.length === 5 && failed.atlas.layout.tiers.close === failed.before.close
            && failed.atlas.closeDiagnosticFailure === 'baked close: upload GL failure'
            && failed.disposed.size === 10
            && failed.events.lastIndexOf('dispose') < failed.events.findIndex(e => e.startsWith('png:baseline/'))
            && gl.getError() === gl.NO_ERROR && ts.every(t => gl.isTexture(renderer.properties.get(t).__webglTexture)),
            { failure: failed.atlas.closeDiagnosticFailure, pages: ts.length, events: failed.events });
        } finally { failed.cleanup(); }
      } finally { renderer.dispose(); renderer.forceContextLoss(); }
      return { rows };
    });
    result.atlasLoader = report;
    for (const row of report.rows) check(`atlas-loader-${row.name}`, row.ok, JSON.stringify(row.detail));
    check('atlas-loader-errors', errors.length === 0, errors.join('; '));
  } finally { await ctx.close(); }
}

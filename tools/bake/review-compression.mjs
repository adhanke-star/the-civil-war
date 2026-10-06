// Actions-only GPU decode/readback against every approved PNG page, mip levels 0/1/2.
// The output is a small report + numbered visual comparison, never raw frames or Blender files.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';
import { createHash } from 'node:crypto';
import { SOURCE, diagnosticPagesOkay, CANDIDATE_BINDS, candidateKtx, sha256 } from './compress.mjs';

export function comparePixels(a, b) {
  if (a.length !== b.length || a.length === 0) throw new Error('compression review: pixel lengths disagree');
  let rgb = 0, alpha = 0, samples = 0, clipped = 0;
  const edge = [], edgeAlpha = [];
  for (let i = 0; i < a.length; i += 4) {
    alpha += Math.abs(a[i + 3] - b[i + 3]);
    if (a[i + 3] >= 250 && b[i + 3] < 128) clipped++;
    if (a[i + 3] || b[i + 3]) {
      samples++;
      let error = 0;
      for (let c = 0; c < 3; c++) { const e = Math.abs(a[i + c] - b[i + c]); rgb += e; error = Math.max(error, e); }
      if (a[i + 3] > 0 && a[i + 3] < 250) { edge.push(error); edgeAlpha.push(Math.abs(a[i + 3] - b[i + 3])); }
    }
  }
  edge.sort((a, b) => a - b);
  edgeAlpha.sort((a, b) => a - b);
  const meanRgb = rgb / Math.max(1, samples * 3), meanAlpha = alpha / (a.length / 4);
  const edge95 = edge[Math.floor(edge.length * 0.95)] || 0;
  const edgeAlpha95 = edgeAlpha[Math.floor(edgeAlpha.length * 0.95)] || 0;
  return { meanRgb, meanAlpha, edge95, edgeAlpha95, clipped, samples,
    ok: samples > 0 && meanRgb <= 2 && meanAlpha <= 1 && edge95 <= 8 && edgeAlpha95 <= 8 && clipped === 0 };
}

// Evidence completion is separate from pixel acceptance. Lossy routes may fail unchanged thresholds;
// the actual lossless upload/identity controls and all allocation/format checks must pass.
export function diagnosticEvidenceOkay(review) {
  const expected = ['png->premul', 'png->raw', 'raw->rgba', 'rgba->bc7', 'png->bc7', 'raw->raw']
    .flatMap((route) => [0, 1, 2].map((lod) => `${route}:${lod}`)).sort().join();
  return review.diagnosticOnly === true && review.fieldable === false && diagnosticPagesOkay(review.pages)
    && ['close', 'field'].every((tier) => ['Upload', 'RawBase', 'Identity', 'Missing', 'Colour'].every((key) => review.controls[`${tier}${key}`] === true))
    && review.pages.every((p) => p.integrity && p.comparisons?.length === 18
      && p.comparisons.map((c) => `${c.route}:${c.lod}`).sort().join() === expected
      && p.comparisons.every((c) => c.metrics.samples > 0 && ['meanRgb', 'meanAlpha', 'edge95', 'edgeAlpha95', 'clipped'].every((key) => Number.isFinite(c.metrics[key]))));
}

async function diagnosticReview(source, out, report, manifest) {
  if (!diagnosticPagesOkay(report.pages) || JSON.stringify(report.source) !== JSON.stringify(SOURCE)
    || report.fieldable !== false) throw new Error('invalid diagnostic source/subset');
  const review = { label: 'DIAGNOSTIC ONLY', diagnosticOnly: true, fieldable: false, ok: false,
    source: report.source, toolSha: process.env.GITHUB_SHA, pages: [], controls: {}, sheets: [] };
  const { server, url } = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route(url + 'compression-diagnostic', (route) => route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><script type="module">
      import * as T from 'three'; import {KTX2Loader} from '/node_modules/three/examples/jsm/loaders/KTX2Loader.js';
      window.T=T; window.renderer=new T.WebGLRenderer({antialias:false});
      window.decoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);
      window.rgbaDecoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);
      // Disable compressed targets to request the genuine RGBA32 fallback. Never enable unsupported formats.
      for(const key of Object.keys(rgbaDecoder.workerConfig)) rgbaDecoder.workerConfig[key]=false;
      window.ready=true;</script>` }));
    await page.goto(url + 'compression-diagnostic'); await page.waitForFunction(() => window.ready);
    for (const p of report.pages) {
      if (!/^[a-z0-9_]+\.png$/.test(p.source) || !/^[a-z0-9_]+\.ktx2$/.test(p.file)
        || !/^[a-z0-9_]+-raw\.ktx2$/.test(p.rawFile)) throw new Error('unsafe diagnostic page');
      const checked = (root, file, hash) => {
        const full = path.join(root, file), st = fs.lstatSync(full);
        if (!st.isFile() || st.isSymbolicLink() || st.size > 100 * 1024 * 1024
          || !fs.realpathSync(full).startsWith(root + path.sep)) throw new Error('unsafe diagnostic input');
        const bytes = fs.readFileSync(full);
        if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('diagnostic input hash mismatch');
        return bytes;
      };
      const png = checked(source, p.source, p.pngSha256), ktx = checked(out, p.file, p.ktxSha256), raw = checked(out, p.rawFile, p.rawSha256);
      const premul = PNG.sync.read(png);
      for (let i = 0; i < premul.data.length; i += 4) for (let c = 0; c < 3; c++) premul.data[i + c] = Math.round(premul.data[i + c] * premul.data[i + 3] / 255);
      const result = await page.evaluate(async ({ png, ktx, raw, premul, w, h }) => {
        const T = window.T, renderer = window.renderer, un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        const decode = (loader, s) => new Promise((resolve, reject) => loader.parse(un64(s).buffer, resolve, reject));
        const textures = {
          png: await new T.TextureLoader().loadAsync('data:image/png;base64,' + png),
          premul: new T.DataTexture(un64(premul), w, h, T.RGBAFormat),
          raw: await decode(window.decoder, raw), rgba: await decode(window.rgbaDecoder, ktx), bc7: await decode(window.decoder, ktx),
        };
        const metadata = {};
        for (const [name, texture] of Object.entries(textures)) {
          metadata[name] = { format: Object.entries(T).find(([key, value]) => key.endsWith('Format') && value === texture.format)?.[0],
            premultiplyAlpha: texture.premultiplyAlpha, compressed: !!texture.isCompressedTexture,
            allocation: texture.mipmaps.reduce((s, m) => s + m.data.byteLength, 0), mipLevels: texture.mipmaps.length };
          Object.assign(texture, { colorSpace: T.NoColorSpace, flipY: false, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter,
            generateMipmaps: name === 'png' || name === 'premul', premultiplyAlpha: name === 'png' });
          // ArrayBuffer uploads already hold premultiplied bytes; the raw loader omits the DFD flag.
          texture.needsUpdate = true;
        }
        const scene = new T.Scene(), camera = new T.Camera(), geometry = new T.PlaneGeometry(2, 2);
        const mat = new T.ShaderMaterial({ uniforms: { map: { value: textures.png }, lod: { value: 0 } },
          vertexShader: 'varying vec2 uv0; void main(){uv0=uv; gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader: 'varying vec2 uv0; uniform sampler2D map; uniform float lod; void main(){gl_FragColor=textureLod(map,uv0,lod);}',
          depthTest: false, depthWrite: false, blending: T.NoBlending });
        scene.add(new T.Mesh(geometry, mat));
        const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
        const levels = [];
        try {
          for (const lod of [0, 1, 2]) {
            const width = Math.max(1, w >> lod), height = Math.max(1, h >> lod), data = {};
            const rt = new T.WebGLRenderTarget(width, height, { depthBuffer: false }), pixels = new Uint8Array(width * height * 4);
            mat.uniforms.lod.value = lod; renderer.setRenderTarget(rt);
            for (const [name, texture] of Object.entries(textures)) {
              mat.uniforms.map.value = texture; renderer.render(scene, camera); renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels); data[name] = b64(pixels);
            }
            levels.push({ lod, width, height, data }); rt.dispose();
          }
          return { metadata, levels, gpuError: renderer.getContext().getError() };
        } finally { renderer.setRenderTarget(null); for (const t of Object.values(textures)) t.dispose(); geometry.dispose(); mat.dispose(); }
      }, { png: png.toString('base64'), ktx: ktx.toString('base64'), raw: raw.toString('base64'),
        premul: premul.data.toString('base64'), w: p.width, h: p.height });
      const pairs = [['png', 'premul'], ['png', 'raw'], ['raw', 'rgba'], ['rgba', 'bc7'], ['png', 'bc7'], ['raw', 'raw']];
      const comparisons = [], decoded = result.levels.map((l) => ({ ...l, data: Object.fromEntries(Object.entries(l.data).map(([key, value]) => [key, Buffer.from(value, 'base64')])) }));
      for (const l of decoded) for (const [a, b] of pairs) comparisons.push({ route: `${a}->${b}`, lod: l.lod, metrics: comparePixels(l.data[a], l.data[b]) });
      const md = result.metadata;
      const integrity = result.gpuError === 0 && md.raw.format === 'RGBAFormat' && md.rgba.format === 'RGBAFormat'
        && md.bc7.format === 'RGBA_BPTC_Format' && md.bc7.premultiplyAlpha && md.rgba.premultiplyAlpha
        && ['raw', 'rgba'].every((key) => md[key].allocation === p.allocation.rgba8 && md[key].mipLevels === p.allocation.levels)
        && md.bc7.allocation === p.allocation.block16 && md.bc7.mipLevels === p.allocation.levels;
      review.pages.push({ source: p.source, file: p.file, integrity, metadata: md, comparisons });
      const at = (route, lod) => comparisons.find((c) => c.route === route && c.lod === lod).metrics;
      review.controls[`${p.tier}Upload`] = [0, 1, 2].every((lod) => at('png->premul', lod).ok);
      review.controls[`${p.tier}RawBase`] = at('png->raw', 0).ok;
      review.controls[`${p.tier}Identity`] = [0, 1, 2].every((lod) => at('raw->raw', lod).meanRgb === 0 && at('raw->raw', lod).meanAlpha === 0);
      review.controls[`${p.tier}Missing`] = !comparePixels(decoded[0].data.raw, Buffer.alloc(decoded[0].data.raw.length)).ok;
      const changed = Buffer.from(decoded[0].data.raw);
      for (let i = 0; i < changed.length; i += 4) if (changed[i + 3]) for (let c = 0; c < 3; c++) changed[i + c] = 255 - changed[i + c];
      review.controls[`${p.tier}Colour`] = !comparePixels(decoded[0].data.raw, changed).ok;
      console.log(`${p.source}: integrity=${integrity}\n${comparisons.map((c) => `${c.route} mip${c.lod}: ${JSON.stringify(c.metrics)}`).join('\n')}`);
      const G = manifest.tiers[p.tier];
      const frames = Object.entries(G.frames).filter(([, f]) => G.pages[f.page].file === p.file).slice(0, 6);
      const cards = [];
      for (const l of decoded) for (const [key, f] of frames) {
        const scale = 2 ** l.lod, x = Math.floor(f.x / scale), y = Math.floor(f.y / scale), width = Math.ceil(f.w / scale), height = Math.ceil(f.h / scale);
        const images = ['png', 'raw', 'rgba', 'bc7'].map((name) => {
          const crop = new PNG({ width, height }), data = l.data[name];
          for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const from = ((y + row) * l.width + x + col) * 4, to = (row * width + col) * 4, alpha = data[from + 3] / 255;
            for (let c = 0; c < 3; c++) crop.data[to + c] = Math.min(255, Math.round(data[from + c] + [109, 121, 74][c] * (1 - alpha)));
            crop.data[to + 3] = 255;
          }
          return `data:image/png;base64,${PNG.sync.write(crop).toString('base64')}`;
        });
        cards.push(`<section><p>${key} / mip${l.lod}</p>${images.map((s) => `<img src="${s}">`).join('')}</section>`);
      }
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.evaluate(() => { decoder.dispose(); rgbaDecoder.dispose(); renderer.dispose(); });
      await page.setContent(`<style>body{background:#eee8da;color:#20251a;font:18px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}img{width:24%;height:200px;object-fit:contain}section{background:#d9ddc9}</style><h1>DIAGNOSTIC ONLY — ${p.tier}</h1><p>Left to right: PNG / raw KTX / UASTC→RGBA / UASTC→BC7. Bake ${SOURCE.run} at ${SOURCE.sha}; tool ${report.toolSha}. No fielding clearance.</p><main>${cards.join('')}</main>`);
      await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
      const sheet = `compression-diagnostic-${p.tier}.png`; await page.screenshot({ path: path.join(out, sheet), fullPage: true }); review.sheets.push(sheet);
      // setContent replaces the diagnostic module; restore it for the next page.
      await page.goto(url + 'compression-diagnostic'); await page.waitForFunction(() => window.ready);
    }
    review.diagnosticComplete = diagnosticEvidenceOkay(review);
    fs.writeFileSync(path.join(out, 'quality.json'), JSON.stringify(review, null, 2));
    if (!review.diagnosticComplete) throw new Error('diagnostic integrity/control failure; inspect quality.json');
    console.log('DIAGNOSTIC ONLY: evidence complete; pixel acceptance reported separately; fieldable=false');
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

export function candidateSupported(c, format, w, h) {
  return w <= c.maxTextureSize && h <= c.maxTextureSize && (format === 'bc7'
    ? c.bptc === true && c.formats.includes(0x8e8c)
    : format === 'astc' && c.astc === true && c.profiles.includes('ldr') && c.formats.includes(0x93b0));
}

export function candidateEvidenceOkay(r) {
  const routes = ['png->premul', 'png->raw', 'raw->raw', 'raw->bc7-gpu', 'png->bc7-gpu', 'raw->astc-software', 'png->astc-software'];
  return r.mode === 'candidate' && r.diagnosticOnly === true && r.fieldable === false && r.ok === false
    && diagnosticPagesOkay(r.pages) && r.sheets?.length === 2 && new Set(r.sheets).size === 2
    && ['close', 'field'].every((tier) => ['Upload', 'RawBase', 'Identity', 'Missing', 'Colour', 'WrongAlpha', 'DoublePremul', 'AutomaticSrgb', 'Unsupported'].every((key) => r.controls?.[tier + key] === true))
    && r.pages.every((p) => {
      const expected = [...routes, ...(p.astcGpu === 'RUN' ? ['raw->astc-gpu', 'png->astc-gpu'] : [])]
        .flatMap((route) => [0, 1, 2].map((lod) => route + ':' + lod)).sort().join();
      return p.integrity === true && p.bc7Gpu === 'RUN' && ['RUN', 'UNRUN'].includes(p.astcGpu)
        && p.comparisons?.map((c) => c.route + ':' + c.lod).sort().join() === expected
        && p.comparisons.every((c) => c.status === 'RUN' && Number.isFinite(c.metrics.samples) && c.metrics.samples > 0 && c.metrics.clipped === 0
          && ['meanRgb', 'meanAlpha', 'edge95', 'edgeAlpha95'].every((key) => Number.isFinite(c.metrics[key])))
        && ['raw', 'bc7', 'astc'].every((key) => {
          const md = p.metadata[key], allocation = key === 'raw' ? p.allocation.rgba8 : p.allocation.block16;
          return md && md.allocation === allocation && md.levels?.length === p.allocation.levels
            && md.levels.reduce((s, l) => s + l.bytes, 0) === allocation
            && md.levels.every((l) => l.bytes > 0 && /^[a-f0-9]{64}$/.test(l.sha256));
        });
    });
}

async function candidateReview(source, out, report, manifest) {
  if (!diagnosticPagesOkay(report.pages) || JSON.stringify(report.source) !== JSON.stringify(SOURCE) || report.fieldable !== false) throw new Error('invalid candidate source/subset');
  const review = { mode: 'candidate', label: 'DIRECT CANDIDATE ONLY', diagnosticOnly: true, fieldable: false, ok: false,
    source: report.source, toolSha: process.env.GITHUB_SHA, historical: report.historical, pages: [], controls: {}, sheets: [] };
  const historicalRoot = fs.realpathSync(process.env.HISTORICAL_REVIEW);
  const historical = JSON.parse(fs.readFileSync(path.join(historicalRoot, 'quality.json')));
  const historicalPack = JSON.parse(fs.readFileSync(path.join(historicalRoot, 'compression.json')));
  if (!diagnosticEvidenceOkay(historical) || historical.toolSha !== '47d248ca0a6ea9be81d19dfde333da6b4a637cf0'
    || JSON.stringify(historical.source) !== JSON.stringify(SOURCE) || !diagnosticPagesOkay(historicalPack.pages)
    || historicalPack.pages.some((p) => { const b = CANDIDATE_BINDS[p.source.slice(0, -4)]; return p.pngSha256 !== b.png || p.rawSha256 !== b.raw || p.ktxSha256 !== b.uastc; })) throw new Error('historical comparator not bound to measured source');
  review.historical = { ...report.historical, source: historical.source, controls: historical.controls, pages: historical.pages };
  const checked = (root, file, hash) => {
    if (!/^[a-z0-9_-]+\.(png|ktx2)$/.test(file)) throw new Error('unsafe candidate filename');
    const full = path.join(root, file), st = fs.lstatSync(full);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 100 * 1024 * 1024 || !fs.realpathSync(full).startsWith(root + path.sep)) throw new Error('unsafe candidate file');
    const b = fs.readFileSync(full); if (sha256(b) !== hash) throw new Error('candidate hash mismatch'); return b;
  };
  const { server, url } = await startServer({ port: 0 }); let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route(url + 'compression-candidate', (route) => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><script type="module">' +
      "import * as T from 'three'; import {KTX2Loader} from '/node_modules/three/examples/jsm/loaders/KTX2Loader.js';" +
      'window.T=T; window.renderer=new T.WebGLRenderer({antialias:false}); window.decoder=new KTX2Loader().detectSupport(renderer); window.supported=' + candidateSupported.toString() + '; window.ready=true;</script>' }));
    for (const p of report.pages) {
      await page.goto(url + 'compression-candidate'); await page.waitForFunction(() => window.ready);
      const bind = CANDIDATE_BINDS[p.source.slice(0, -4)];
      if (p.pngSha256 !== bind.png || p.rawSha256 !== bind.raw) throw new Error('original candidate bind changed');
      const png = checked(source, p.source, bind.png), raw = checked(out, p.rawFile, bind.raw);
      const ktx = Object.fromEntries(['bc7', 'astc'].map((f) => [f, checked(out, p.candidates[f].file, p.candidates[f].sha256)]));
      const info = Object.fromEntries(['raw', 'bc7', 'astc'].map((f) => [f, candidateKtx(f === 'raw' ? raw : ktx[f], p.width, p.height, f)]));
      for (const f of ['bc7', 'astc']) if (info[f].levels.some((l, i) => l.sha256 !== p.candidates[f].levels[i]?.sha256)) throw new Error('candidate payload bind changed');
      if (info.raw.levels.some((l, i) => l.sha256 !== p.rawLevels[i]?.sha256)) throw new Error('raw mip bind changed');
      const software = p.candidates.astc.software.map((s) => {
        const decoded = PNG.sync.read(checked(out, s.file, s.sha256)), l = info.raw.levels[s.lod];
        if (sha256(decoded.data) !== s.rgbaSha256 || decoded.width !== l.width || decoded.height !== l.height) throw new Error('ASTC software bind');
        return decoded.data;
      });
      if (software.length !== 3 || p.candidates.astc.software.map((s) => s.lod).join() !== '0,1,2') throw new Error('ASTC software mip coverage');
      const premul = PNG.sync.read(png);
      for (let i = 0; i < premul.data.length; i += 4) for (let c = 0; c < 3; c++) premul.data[i + c] = Math.round(premul.data[i + c] * premul.data[i + 3] / 255);
      const result = await page.evaluate(async ({ png, raw, bc7, astc, premul, w, h }) => {
        const T = window.T, renderer = window.renderer, gl = renderer.getContext(), ext = gl.getExtension('WEBGL_compressed_texture_astc');
        const caps = { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), formats: [...gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS)],
          bptc: !!gl.getExtension('EXT_texture_compression_bptc'), astc: !!ext, profiles: ext ? ext.getSupportedProfiles() : [] };
        // Probe before parsing/uploading a hardware format. Never enable absent detector flags.
        if (!window.supported(caps, 'bc7', w, h)) throw new Error('BC7 GPU unsupported; diagnostic held');
        const astcSupported = window.supported(caps, 'astc', w, h);
        const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        const decode = (s) => new Promise((resolve, reject) => window.decoder.parse(un64(s).buffer, resolve, reject));
        const textures = { png: await new T.TextureLoader().loadAsync('data:image/png;base64,' + png),
          premul: new T.DataTexture(un64(premul), w, h), raw: await decode(raw), bc7: await decode(bc7) };
        if (astcSupported) textures.astc = await decode(astc);
        const md = {};
        for (const [name, t] of Object.entries(textures)) {
          Object.assign(t, { colorSpace: T.NoColorSpace, flipY: false, generateMipmaps: name === 'png' || name === 'premul',
            premultiplyAlpha: name === 'png', minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter }); t.needsUpdate = true;
          md[name] = { format: Object.entries(T).find(([key, v]) => key.endsWith('Format') && v === t.format)?.[0],
            allocation: t.mipmaps.reduce((s, l) => s + l.data.byteLength, 0), mipLevels: t.mipmaps.length,
            colorSpace: t.colorSpace, flipY: t.flipY, premultiplyAlpha: t.premultiplyAlpha, generateMipmaps: t.generateMipmaps };
        }
        const scene = new T.Scene(), camera = new T.Camera(), geometry = new T.PlaneGeometry(2, 2);
        const mat = new T.ShaderMaterial({ uniforms: { map: { value: textures.raw }, lod: { value: 0 }, broken: { value: 0 } },
          vertexShader: 'varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader: 'varying vec2 uv0;uniform sampler2D map;uniform float lod;uniform int broken;void main(){vec4 c=textureLod(map,uv0,lod);if(broken==1)c.a=0.;if(broken==2)c.rgb*=c.a;if(broken==3)c.rgb=mix(c.rgb/12.92,pow((c.rgb+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c.rgb));gl_FragColor=c;}',
          blending: T.NoBlending, depthTest: false, depthWrite: false });
        scene.add(new T.Mesh(geometry, mat));
        const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
        const levels = [], errors = [];
        try {
          for (const lod of [0, 1, 2]) {
            const width = Math.max(1, w >> lod), height = Math.max(1, h >> lod), data = {};
            const rt = new T.WebGLRenderTarget(width, height, { depthBuffer: false }), pixels = new Uint8Array(width * height * 4);
            renderer.setRenderTarget(rt); mat.uniforms.lod.value = lod;
            for (const [name, t] of Object.entries(textures)) {
              mat.uniforms.map.value = t; mat.uniforms.broken.value = 0; renderer.render(scene, camera);
              renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels); data[name] = b64(pixels); errors.push(gl.getError());
            }
            if (lod === 0) for (const [name, mode] of [['WrongAlpha', 1], ['DoublePremul', 2], ['AutomaticSrgb', 3]]) {
              mat.uniforms.map.value = textures.raw; mat.uniforms.broken.value = mode; renderer.render(scene, camera);
              renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels); data[name] = b64(pixels); errors.push(gl.getError());
            }
            levels.push({ lod, width, height, data }); rt.dispose();
          }
          return { caps, md, astcSupported, levels, errors,
            unsupportedRejected: !window.supported({ ...caps, bptc: false, astc: false, formats: [] }, 'bc7', w, h)
              && !window.supported({ ...caps, bptc: false, astc: false, formats: [] }, 'astc', w, h) };
        } finally { renderer.setRenderTarget(null); for (const t of Object.values(textures)) t.dispose(); geometry.dispose(); mat.dispose(); }
      }, { png: png.toString('base64'), raw: raw.toString('base64'), bc7: ktx.bc7.toString('base64'), astc: ktx.astc.toString('base64'),
        premul: premul.data.toString('base64'), w: p.width, h: p.height });
      const levels = result.levels.map((l) => ({ ...l, data: Object.fromEntries(Object.entries(l.data).map(([k, v]) => [k, Buffer.from(v, 'base64')])) }));
      const comparisons = [];
      for (const l of levels) {
        l.data['astc-software'] = software[l.lod];
        const pairs = [['png', 'premul'], ['png', 'raw'], ['raw', 'raw'], ['raw', 'bc7'], ['png', 'bc7'], ['raw', 'astc-software'], ['png', 'astc-software']];
        if (result.astcSupported) pairs.push(['raw', 'astc'], ['png', 'astc']);
        for (const [a, b] of pairs) comparisons.push({ route: a + '->' + (b === 'bc7' ? 'bc7-gpu' : b === 'astc' ? 'astc-gpu' : b), lod: l.lod, status: 'RUN', metrics: comparePixels(l.data[a], l.data[b]) });
      }
      const base = levels[0].data.raw, at = (route, lod) => comparisons.find((c) => c.route === route && c.lod === lod).metrics;
      review.controls[p.tier + 'Upload'] = [0, 1, 2].every((lod) => at('png->premul', lod).ok);
      review.controls[p.tier + 'RawBase'] = at('png->raw', 0).ok;
      review.controls[p.tier + 'Identity'] = [0, 1, 2].every((lod) => at('raw->raw', lod).meanRgb === 0 && at('raw->raw', lod).meanAlpha === 0 && levels[lod].data.raw.equals(info.raw.levels[lod].data));
      review.controls[p.tier + 'Missing'] = !comparePixels(base, Buffer.alloc(base.length)).ok;
      const changed = Buffer.from(base); for (let i = 0; i < changed.length; i += 4) if (changed[i + 3]) for (let c = 0; c < 3; c++) changed[i + c] = 255 - changed[i + c];
      review.controls[p.tier + 'Colour'] = !comparePixels(base, changed).ok;
      for (const key of ['WrongAlpha', 'DoublePremul', 'AutomaticSrgb']) review.controls[p.tier + key] = !comparePixels(base, levels[0].data[key]).ok;
      review.controls[p.tier + 'Unsupported'] = result.unsupportedRejected;
      const integrity = result.errors.every((e) => e === 0) && result.md.raw.format === 'RGBAFormat' && result.md.bc7.format === 'RGBA_BPTC_Format'
        && (!result.astcSupported || result.md.astc.format === 'RGBA_ASTC_4x4_Format')
        && ['raw', 'bc7', ...(result.astcSupported ? ['astc'] : [])].every((f) => result.md[f].allocation === info[f].allocation
          && result.md[f].mipLevels === info[f].levels.length && result.md[f].colorSpace === '' && result.md[f].premultiplyAlpha === false
          && result.md[f].flipY === false && result.md[f].generateMipmaps === false);
      const metadata = Object.fromEntries(Object.entries(info).map(([f, v]) => [f, { ...v, levels: v.levels.map(({ data, ...l }) => l) }]));
      review.pages.push({ source: p.source, integrity, allocation: p.allocation, metadata, upload: result.md, capabilities: result.caps,
        glErrors: result.errors, bc7Gpu: 'RUN', astcGpu: result.astcSupported ? 'RUN' : 'UNRUN', astcSoftware: 'RUN', comparisons,
        quality: { bc7Gpu: comparisons.filter((c) => c.route.endsWith('bc7-gpu')).every((c) => c.metrics.ok),
          astcSoftware: comparisons.filter((c) => c.route.endsWith('astc-software')).every((c) => c.metrics.ok) } });
      console.log(p.source + '\n' + comparisons.map((c) => c.route + ' mip' + c.lod + ': ' + JSON.stringify(c.metrics)).join('\n'));
      const G = manifest.tiers[p.tier], frames = Object.entries(G.frames).filter(([, f]) => G.pages[f.page].file === p.source).slice(0, 6), cards = [];
      for (const l of levels) for (const [key, f] of frames) {
        const scale = 2 ** l.lod, x = Math.floor(f.x / scale), y = Math.floor(f.y / scale), width = Math.ceil(f.w / scale), height = Math.ceil(f.h / scale);
        const images = ['png', 'raw', 'bc7', 'astc-software'].map((name) => {
          const crop = new PNG({ width, height }), data = l.data[name];
          for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const from = ((y + row) * l.width + x + col) * 4, to = (row * width + col) * 4, alpha = data[from + 3] / 255;
            for (let c = 0; c < 3; c++) crop.data[to + c] = Math.min(255, Math.round(data[from + c] + [109, 121, 74][c] * (1 - alpha)));
            crop.data[to + 3] = 255;
          }
          return 'data:image/png;base64,' + PNG.sync.write(crop).toString('base64');
        });
        cards.push('<section><p>' + key + ' / mip' + l.lod + '</p>' + images.map((s) => '<img src="' + s + '">').join('') + '</section>');
      }
      await page.evaluate(() => { decoder.dispose(); renderer.dispose(); });
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.setContent('<style>body{background:#eee8da;color:#20251a;font:18px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}img{width:24%;height:200px;object-fit:contain}section{background:#d9ddc9}</style><h1>DIRECT CANDIDATE ONLY — ' + p.tier + '</h1><p>PNG / raw RGBA / direct BC7 GPU / direct ASTC SOFTWARE. ASTC GPU: ' + (result.astcSupported ? 'RUN' : 'UNRUN') + '. Bake ' + SOURCE.run + ' at ' + SOURCE.sha + '; tool ' + report.toolSha + '. UASTC comparator is historical run 37374456139. No fielding clearance.</p><main>' + cards.join('') + '</main>');
      await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
      const sheet = 'compression-candidate-' + p.tier + '.png'; await page.screenshot({ path: path.join(out, sheet), fullPage: true }); review.sheets.push(sheet);
    }
    review.candidateComplete = candidateEvidenceOkay(review);
    if (!review.candidateComplete) throw new Error('candidate controls/integrity incomplete');
    console.log('Candidate evidence complete; quality reported independently; fieldable=false');
  } finally {
    fs.writeFileSync(path.join(out, 'quality.json'), JSON.stringify(review, null, 2));
    if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('compression review runs on Actions only');
  const source = fs.realpathSync(process.argv[2]), out = fs.realpathSync(process.argv[3]);
  if (!out.startsWith(path.join(ROOT, '.out') + path.sep) || out.includes('\\')) throw new Error('review output escapes .out/');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'compression.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'soldier.json')));
  if (report.mode === 'candidate') return candidateReview(source, out, report, manifest);
  if (report.diagnosticOnly) return diagnosticReview(source, out, report, manifest);
  const review = { pages: [], formats: [], controls: {}, source: report.source, toolSha: process.env.GITHUB_SHA };
  const html = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
    <script type="module">import * as THREE from 'three';
    import {KTX2Loader} from '/node_modules/three/examples/jsm/loaders/KTX2Loader.js';
    window.T=THREE; window.renderer=new THREE.WebGLRenderer({antialias:false});
    window.decoder=new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').setWorkerLimit(1).detectSupport(renderer);
    window.ready=true;</script>`;
  const { server, url } = await startServer({ port: 0 });
  let browser;
  const cards = [];
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route(url + 'compression-review', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(url + 'compression-review');
    await page.waitForFunction(() => window.ready);
    for (const p of report.pages) {
      if (![p.file, p.source].every((s) => /^[a-z0-9_]+\.(png|ktx2)$/.test(s))) throw new Error('unsafe review page name');
      const png = fs.readFileSync(path.join(source, p.source)).toString('base64');
      const ktx = fs.readFileSync(path.join(out, p.file)).toString('base64');
      const result = await page.evaluate(async ({ png, ktx, w, h }) => {
        const T = window.T, renderer = window.renderer;
        const original = await new T.TextureLoader().loadAsync('data:image/png;base64,' + png);
        Object.assign(original, { flipY: false, premultiplyAlpha: true, colorSpace: T.NoColorSpace,
          generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter });
        original.needsUpdate = true;
        const bytes = Uint8Array.from(atob(ktx), (c) => c.charCodeAt(0));
        const compressed = await new Promise((resolve, reject) => window.decoder.parse(bytes.buffer, resolve, reject));
        compressed.colorSpace = T.NoColorSpace;
        const format = Object.entries(T).find(([name, value]) => name.endsWith('Format') && value === compressed.format)?.[0] || compressed.format;
        const scene = new T.Scene(), camera = new T.Camera();
        const mat = new T.ShaderMaterial({ uniforms: { map: { value: original }, lod: { value: 0 } },
          vertexShader: 'varying vec2 uv0; void main(){uv0=uv; gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader: 'varying vec2 uv0; uniform sampler2D map; uniform float lod; void main(){gl_FragColor=textureLod(map,uv0,lod);}', depthTest: false, depthWrite: false });
        const geometry = new T.PlaneGeometry(2, 2); scene.add(new T.Mesh(geometry, mat));
        const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); };
        const levels = [];
        try {
          for (const lod of [0, 1, 2]) {
            const width = Math.max(1, w >> lod), height = Math.max(1, h >> lod);
            const rt = new T.WebGLRenderTarget(width, height, { depthBuffer: false });
            const pixels = new Uint8Array(width * height * 4);
            mat.uniforms.lod.value = lod; renderer.setRenderTarget(rt);
            mat.uniforms.map.value = original; renderer.render(scene, camera); renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);
            const a = b64(pixels);
            mat.uniforms.map.value = compressed; renderer.render(scene, camera); renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);
            levels.push({ lod, width, height, a, b: b64(pixels) }); rt.dispose();
          }
          return { format, premultiplyAlpha: compressed.premultiplyAlpha, compressed: !!compressed.isCompressedTexture,
            allocation: compressed.mipmaps.reduce((s, m) => s + m.data.byteLength, 0), mipLevels: compressed.mipmaps.length, levels };
        } finally { renderer.setRenderTarget(null); original.dispose(); compressed.dispose(); geometry.dispose(); mat.dispose(); }
      }, { png, ktx, w: p.width, h: p.height });
      const metrics = result.levels.map((l) => ({ lod: l.lod, ...comparePixels(Buffer.from(l.a, 'base64'), Buffer.from(l.b, 'base64')) }));
      const ok = result.compressed && result.premultiplyAlpha && result.allocation === p.allocation.block16
        && result.mipLevels === p.allocation.levels && metrics.every((m) => m.ok);
      review.pages.push({ file: p.file, format: result.format, allocation: result.allocation, mipLevels: result.mipLevels, metrics, ok });
      if (!review.formats.includes(result.format)) review.formats.push(result.format);
      console.log(`${p.file}: ${result.format}, ${result.allocation} B; ${metrics.map((m) => `mip${m.lod} rgb=${m.meanRgb.toFixed(3)} alpha=${m.meanAlpha.toFixed(3)} edge95=${m.edge95}/${m.edgeAlpha95}`).join('; ')} ${ok ? 'OK' : 'FAIL'}`);
      // Visual proof: every base pose + all nine identities, plus representative field mip/edge readback.
      const G = p.look === 'base' ? manifest.tiers[p.tier] : manifest.tiers[p.tier].variants[p.look];
      const keys = p.look === 'base' ? Object.keys(G.frames).filter((key) => /_d(00|04)$/.test(key)) : ['stand_0_d02'];
      for (const key of keys) {
        const f = G.frames[key];
        if (G.pages[f.page].file !== p.file) continue;
        for (const level of result.levels.filter((l) => p.tier === 'field' || l.lod === 0)) {
          const scale = 2 ** level.lod, x = Math.floor(f.x / scale), y = Math.floor(f.y / scale);
          const width = Math.max(1, Math.ceil(f.w / scale)), height = Math.max(1, Math.ceil(f.h / scale));
          const pair = [];
          for (const encoded of [level.a, level.b]) {
            const data = Buffer.from(encoded, 'base64'), crop = new PNG({ width, height });
            for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
              const from = ((y + row) * level.width + x + col) * 4, to = (row * width + col) * 4;
              const alpha = data[from + 3] / 255;
              for (let c = 0; c < 3; c++) crop.data[to + c] = Math.min(255, Math.round(data[from + c] + [109, 121, 74][c] * (1 - alpha)));
              crop.data[to + 3] = 255;
            }
            pair.push('data:image/png;base64,' + PNG.sync.write(crop).toString('base64'));
          }
          cards.push({ label: `${p.tier} / ${p.look} / ${key} / mip ${level.lod}`, pair });
        }
      }
    }
    // These controls exercise the same quality gate on visible colours and alpha, not just a CLI exit.
    const good = Buffer.from([20, 100, 200, 255, 10, 20, 30, 128]);
    review.controls = { identical: comparePixels(good, good).ok,
      missing: !comparePixels(good, Buffer.alloc(good.length)).ok,
      changedColour: !comparePixels(good, Buffer.from([200, 100, 20, 255, 30, 20, 10, 128])).ok };
    await page.evaluate(() => { window.decoder.dispose(); window.renderer.dispose(); });
    const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Split into small numbered sheets; no giant raster/browser canvas.
    review.sheets = [];
    for (let i = 0; i < cards.length; i += 18) {
      const number = Math.floor(i / 18) + 1, file = `compression-${String(number).padStart(2, '0')}.png`;
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.setContent(`<style>body{background:#eee8da;color:#20251a;font:18px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}section{padding:8px;background:#d9ddc9}img{width:48%;height:230px;object-fit:contain;image-rendering:auto}h2{font-size:15px}</style><h1>${number}. Compression: approved PNG (left) / GPU ${escape(review.formats.join('/'))} (right)</h1><p>Bake ${report.source.run} at ${report.source.sha.slice(0, 7)}; tool ${report.toolSha}. Not fielded; iPad/ASTC unverified.</p><main>${cards.slice(i, i + 18).map((c) => `<section><h2>${escape(c.label)}</h2><img src="${c.pair[0]}"><img src="${c.pair[1]}"></section>`).join('')}</main>`);
      await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
      await page.screenshot({ path: path.join(out, file), fullPage: true }); review.sheets.push(file);
    }
    review.totalAllocation = review.pages.reduce((s, p) => s + p.allocation, 0);
    review.ok = review.pages.length === 45 && review.pages.every((p) => p.ok) && Object.values(review.controls).every(Boolean);
    fs.writeFileSync(path.join(out, 'quality.json'), JSON.stringify(review, null, 2));
    if (!review.ok) throw new Error('compression quality/allocation gate failed; inspect quality.json');
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

if (process.argv[1]?.endsWith('/review-compression.mjs') || process.argv[1] === 'tools/bake/review-compression.mjs') main().catch((e) => { console.error(e.message); process.exitCode = 1; });

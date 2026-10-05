// Actions-only GPU decode/readback against every approved PNG page, mip levels 0/1/2.
// The output is a small report + numbered visual comparison, never raw frames or Blender files.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';

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

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('compression review runs on Actions only');
  const source = fs.realpathSync(process.argv[2]), out = fs.realpathSync(process.argv[3]);
  if (!out.startsWith(path.join(ROOT, '.out') + path.sep) || out.includes('\\')) throw new Error('review output escapes .out/');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'compression.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'soldier.json')));
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

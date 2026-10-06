// tools/gpu-fps.mjs: measure frame rate on THIS Mac's real GPU in headed system Google Chrome.
//
//   node tools/gpu-fps.mjs [url] [width height]
//   default url: the local server (start it with play.command or `npm run serve`), window 1440x900.
//
// For each Quality setting (high, auto, low) it loads the game, waits for Auto to settle, then samples
// window.__stats for 10 s at the opening view and 10 s during a fast-forwarded fight. It also drives one
// select + drag-order with Playwright's mouse in that headed Chrome and reports whether the order took.
// Prints a table and writes .out/gpu-fps.json. Opens a visible Chrome window while it runs.
//
//   node tools/gpu-fps.mjs --figures [url] [width height]
//   the soldier-figure matrix on Quality Auto only: rigged and baked figures (look.figureStyle) at 1 figure per
//   10 and per 5 men (look.menPerFigure), each at the opening view and in the fight, through ?figures= and
//   ?mpf= (this visit only, nothing saved). Also logs draw calls, triangles, sprites drawn, the Auto render
//   scale and the atlas memory. Writes .out/gpu-fps-figures.json. With no url it serves the repo itself.
//   Profiling switches pass through --extra, e.g. --extra='&bakesoft=0&bakeclose=0' (see src/main.js).

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';

const FIGURES = process.argv.includes('--figures');
const EXTRA = (process.argv.find((a) => a.startsWith('--extra=')) || '').slice(8);
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let server = null;
let url = pos[0];
if (!url && FIGURES) ({ server, url } = await startServer({ port: 0 }));
url = url || 'http://127.0.0.1:8770/';
if (!url.endsWith('/')) url += '/';
const W = Number(pos[1] || 1440), H = Number(pos[2] || 900);
mkdirSync('.out', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function sample(seconds) {
  const xs = [];
  for (let i = 0; i < seconds * 2; i++) {
    await page.waitForTimeout(500);
    xs.push(await page.evaluate(() => { const s = window.__stats; return { fps: s.fps, scale: s.scale, calls: s.drawCalls, tris: s.triangles, figures: s.figures, rigged: s.riggedDrawn, sprites: s.sprites, spriteCalls: s.spriteCalls, atlasMB: s.atlasMB, style: s.figureStyle, mpf: s.menPerFigure, lod: s.lod }; }));
  }
  const fps = xs.map((x) => x.fps).sort((a, b) => a - b);
  const last = xs[xs.length - 1];
  return { median: fps[Math.floor(fps.length / 2)], min: fps[0], max: fps[fps.length - 1], scale: last.scale, calls: last.calls, tris: last.tris, figures: last.figures, rigged: last.rigged, sprites: last.sprites, spriteCalls: last.spriteCalls, atlasMB: last.atlasMB, style: last.style, mpf: last.mpf, lod: last.lod };
}

const FIGHT = () => {
  const g = window.__game.game;
  const by = (id) => g.units.find((u) => u.id === id);
  g.order(by('franklin'), { type: 'move', points: [[by('franklin').x, by('franklin').z], [80, 470], [230, 500]] });
  g.order(by('willcox'), { type: 'move', points: [[by('willcox').x, by('willcox').z], [60, 300], [220, 360]] });
  g.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [150, 120], [240, 260]] });
  g.fastForward(200);
  const r = window.__game.rts; r.goal.x = 150; r.goal.z = 420; r.goal.dist = 560;
};

if (FIGURES) {
  const cases = [['rigged', 10], ['rigged', 5], ['baked', 10], ['baked', 5]];
  const rows = [];
  let gpu = null;
  for (const [style, mpf] of cases) {
    await page.goto(`${url}?practice&quality=auto&figures=${style}&mpf=${mpf}${EXTRA}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    if (style === 'baked') await page.waitForFunction(() => ['ready', 'failed'].includes(window.__game.game.baked.state), null, { timeout: 60000 });
    if (!gpu) {
      gpu = await page.evaluate(() => {
        const gl = document.getElementById('battlefield').getContext('webgl2');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
      });
    }
    await page.waitForTimeout(14000);
    const open = await sample(10);
    await page.evaluate(FIGHT);
    await page.waitForTimeout(3000);
    const fight = await sample(10);
    const baked = await page.evaluate(() => ({ state: window.__game.game.baked.state, error: window.__game.game.baked.error }));
    rows.push({ style, mpf, open, fight, baked });
    console.log(`${style.padEnd(6)} 1:${String(mpf).padEnd(2)} opening ${open.median} fps (min ${open.min}, scale ${open.scale}, ${open.calls} calls, ${Math.round(open.tris / 1000)}k tris, ${open.figures} figs, ${open.sprites} sprites) | fight ${fight.median} fps (min ${fight.min}, scale ${fight.scale}, ${fight.calls} calls, ${Math.round(fight.tris / 1000)}k tris, ${fight.figures} figs, ${fight.sprites} sprites, atlas ${fight.atlasMB} MB) [${fight.style}, ${baked.state}]`);
  }
  await page.screenshot({ path: '.out/gpu-fps-figures-last.png' });
  writeFileSync('.out/gpu-fps-figures.json', JSON.stringify({ when: new Date().toISOString(), url, extra: EXTRA, gpu, rows, errors }, null, 2));
  console.log(JSON.stringify({ gpu, errors: errors.slice(0, 5) }));
  await browser.close();
if (server) server.close();
  if (server) server.close();
  process.exit(0);
}

const rows = [];
let gpu = null;
let interaction = null;
for (const q of ['high', 'auto', 'low']) {
  await page.goto(`${url}?practice&quality=${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  if (!gpu) {
    gpu = await page.evaluate(() => {
      const gl = document.getElementById('battlefield').getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
    });
  }
  await page.waitForTimeout(q === 'auto' ? 14000 : 4000);
  const open = await sample(10);
  if (q === 'auto' && !interaction) {
    const marker = page.getByRole('button', { name: /^Franklin.s Brigade/ });
    const box = await marker.boundingBox();
    if (box) {
      const sx = box.x + box.width / 2, sy = box.y + box.height * 0.45;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(sx + i * 18, sy - i * 14 + Math.sin(i / 3) * 20); await page.waitForTimeout(25); }
      await page.mouse.up();
      interaction = await page.evaluate(() => { const g = window.__game.game; const u = g.units.find((v) => v.id === 'franklin'); return { selected: g.selected && g.selected.id, order: u.order.type, moving: u.follow.active }; });
    }
  }
  await page.evaluate(FIGHT);
  await page.waitForTimeout(3000);
  const fight = await sample(10);
  rows.push({ quality: q, open, fight });
  console.log(`${q.padEnd(5)} opening ${open.median} fps (min ${open.min}, scale ${open.scale}) | fight ${fight.median} fps (min ${fight.min}, scale ${fight.scale}) | ${fight.calls} calls, ${Math.round(fight.tris / 1000)}k tris`);
}
await page.screenshot({ path: '.out/gpu-fps-last.png' });
const out = { when: new Date().toISOString(), url, gpu, rows, interaction, errors };
writeFileSync('.out/gpu-fps.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ gpu, interaction, errors: errors.slice(0, 5) }));
await browser.close();

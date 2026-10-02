// tools/gpu-fps.mjs: measure frame rate on THIS Mac's real GPU in headed system Google Chrome.
//
//   node tools/gpu-fps.mjs [url] [width height]
//   default url: the local server (start it with play.command or `npm run serve`), window 1440x900.
//
// For each Quality setting (high, auto, low) it loads the game, waits for Auto to settle, then samples
// window.__stats for 10 s at the opening view and 10 s during a fast-forwarded fight. It also drives one
// select + drag-order with Playwright's mouse in that headed Chrome and reports whether the order took.
// Prints a table and writes .out/gpu-fps.json. Opens a visible Chrome window while it runs.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8770/';
const W = Number(process.argv[3] || 1440), H = Number(process.argv[4] || 900);
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
    xs.push(await page.evaluate(() => ({ fps: window.__stats.fps, scale: window.__stats.scale, calls: window.__stats.drawCalls, tris: window.__stats.triangles })));
  }
  const fps = xs.map((x) => x.fps).sort((a, b) => a - b);
  return { median: fps[Math.floor(fps.length / 2)], min: fps[0], max: fps[fps.length - 1], scale: xs[xs.length - 1].scale, calls: xs[xs.length - 1].calls, tris: xs[xs.length - 1].tris };
}

const rows = [];
let gpu = null;
let interaction = null;
for (const q of ['high', 'auto', 'low']) {
  await page.goto(`${url}?quality=${q}`);
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
  await page.evaluate(() => {
    const g = window.__game.game;
    const by = (id) => g.units.find((u) => u.id === id);
    g.order(by('franklin'), { type: 'move', points: [[by('franklin').x, by('franklin').z], [80, 470], [230, 500]] });
    g.order(by('willcox'), { type: 'move', points: [[by('willcox').x, by('willcox').z], [60, 300], [220, 360]] });
    g.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [150, 120], [240, 260]] });
    g.fastForward(200);
    const r = window.__game.rts; r.goal.x = 150; r.goal.z = 420; r.goal.dist = 560;
  });
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

// tools/compare-shots.mjs: our game next to the UG:G references, for honest visual review. LOCAL ONLY.
//
//   node tools/compare-shots.mjs [url]     (needs the local server; references from fetch-reference-shots)
//
// Captures three views in headed system Chrome on this Mac's GPU (Quality High) and writes side-by-side
// composites to .out/compare/: opening view vs ugg-0, a fight with an order arrow and the unit card vs
// ugg-6, and a close look at a farm vs ugg-5. The references are copyrighted: .out/ is never committed.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8770/';
mkdirSync('.out/compare', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1600,990'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await page.goto(`${url}?quality=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(4000);

const shots = {};
shots.opening = await page.screenshot();

// Fight: march the Union line in, fast-forward to contact, select Franklin and draw a new arrow.
await page.evaluate(() => {
  const G = window.__game.game;
  const by = (id) => G.units.find((u) => u.id === id);
  G.order(by('franklin'), { type: 'move', points: [[by('franklin').x, by('franklin').z], [100, 500], [300, 500]] });
  G.order(by('willcox'), { type: 'move', points: [[by('willcox').x, by('willcox').z], [80, 330], [290, 400]] });
  G.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [180, 120], [300, 250]] });
  G.order(by('ricketts'), { type: 'move', points: [[by('ricketts').x, by('ricketts').z], [51, 535]] });
  G.fastForward(205);
  G.order(by('sherman'), { type: 'move', points: [[by('sherman').x, by('sherman').z], [200, 160], [330, 300]] });
  G.select(by('franklin'));
  const R = window.__game.rts;
  R.goal.x = 170; R.goal.z = 420; R.goal.dist = 620; R.goal.pitch = 0.88; R.goal.yaw = -Math.PI / 2 - 0.15;
});
await page.waitForTimeout(5000);
shots.fight = await page.screenshot();

// Farm close-up.
await page.evaluate(() => {
  const R = window.__game.rts;
  R.goal.x = 300; R.goal.z = -50; R.goal.dist = 420; R.goal.pitch = 0.8;
});
await page.waitForTimeout(4000);
shots.farm = await page.screenshot();

const pairs = [['opening', 'ugg-0'], ['fight', 'ugg-6'], ['farm', 'ugg-5']];
const html = (ours, ref, label) => `<body style="margin:0;background:#111;color:#eee;font:16px sans-serif">
  <div style="display:flex;gap:8px;padding:8px"><figure style="margin:0"><img style="width:960px" src="data:image/png;base64,${ours}"><figcaption>The Civil War M1 — ${label} (Chrome, Intel UHD 617, Quality High)</figcaption></figure>
  <figure style="margin:0"><img style="width:960px" src="data:image/png;base64,${ref}"><figcaption>Ultimate General: Gettysburg (Steam store screenshot, reference only)</figcaption></figure></div></body>`;
for (const [name, ref] of pairs) {
  const refPath = `.out/reference/${ref}.png`;
  if (!existsSync(refPath)) { console.log(`missing ${refPath}: run node tools/fetch-reference-shots.mjs`); continue; }
  const p2 = await (await browser.newContext({ viewport: { width: 1944, height: 600 } })).newPage();
  await p2.setContent(html(shots[name].toString('base64'), readFileSync(refPath).toString('base64'), name));
  await p2.screenshot({ path: `.out/compare/${name}-vs-${ref}.png`, fullPage: true });
  console.log(`.out/compare/${name}-vs-${ref}.png`);
}
await browser.close();

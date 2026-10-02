// Fetch Ultimate General: Gettysburg store screenshots into .out/reference/ for LOCAL visual comparison only.
// Copyrighted: never commit them (.out/ is gitignored and auto-pruned). Usage: node tools/fetch-reference-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '.out/reference'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('https://store.steampowered.com/app/306660/Ultimate_General_Gettysburg/', { waitUntil: 'networkidle', timeout: 120000 });
const html = await p.content();
const urls = [...new Set([...html.matchAll(/https:\/\/[^"' )]+?\/ss_[0-9a-f]+\.[0-9x]+\.jpg/g)].map(m => m[0].replace(/\.[0-9x]+\.jpg$/, '.1920x1080.jpg')))];
let i = 0;
for (const u of urls.slice(0, 8)) {
  const q = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const r = await q.goto(u, { timeout: 60000 });
  if (r && r.ok()) await q.screenshot({ path: `${OUT}/ugg-${i++}.png` });
  await q.close();
}
console.log(`saved ${i} reference screenshots to ${OUT}/ (local only, never commit)`);
await b.close();

// Fetch Ultimate General: Gettysburg store screenshots into .out/reference/ for LOCAL visual comparison only.
// Copyrighted: never commit them (.out/ is gitignored and auto-pruned). Usage: node tools/fetch-reference-shots.mjs
// Saves every store screenshot (19 on 2026-10-02) at 1920x1080 as ugg-<n>.png, in store order.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const OUT = '.out/reference'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('https://store.steampowered.com/app/306660/Ultimate_General_Gettysburg/', { waitUntil: 'networkidle', timeout: 120000 });
const html = await p.content();
const urls = [...new Set([...html.matchAll(/https:\/\/[^"' )]+?\/ss_[0-9a-f]+\.[0-9x]+\.jpg/g)].map(m => m[0].replace(/\.[0-9x]+\.jpg$/, '.1920x1080.jpg')))];
let i = 0;
for (const u of urls.slice(0, 24)) {
  const file = `${OUT}/ugg-${i}.png`;
  if (!existsSync(file)) {
    const q = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    const r = await q.goto(u, { timeout: 60000 });
    if (r && r.ok()) await q.screenshot({ path: file });
    await q.close();
  }
  i++;
}
writeFileSync(`${OUT}/sources.txt`, urls.slice(0, 24).map((u, k) => `ugg-${k}.png ${u}`).join('\n') + '\n');
console.log(`saved ${i} reference screenshots to ${OUT}/ (local only, never commit)`);
await b.close();

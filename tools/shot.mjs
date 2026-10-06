// tools/shot.mjs: screenshot the running game (headless Chromium, SwiftShader) into .out/shots/.
//   node tools/shot.mjs [name] [jsToRunBeforeShot] [waitMs]
// Local visual check only; the real-GPU check is play.command in Chrome.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { startServer, ROOT } from './serve.mjs';
import { prune } from './prune.mjs';

const name = process.argv[2] || 'shot';
const js = process.argv[3] || '';
const wait = Number(process.argv[4] || 1500);
const dir = path.join(ROOT, '.out', 'shots');
mkdirSync(dir, { recursive: true });
const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(url + (process.argv[5] || '?practice'));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log(typeof r === "string" ? r : JSON.stringify(r)); }
await page.waitForTimeout(wait);
const file = path.join(dir, `${name}.png`);
await page.screenshot({ path: file });
const stats = await page.evaluate(() => window.__stats);
console.log(JSON.stringify(stats));
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
console.log(file);
await browser.close();
server.close();
await prune();

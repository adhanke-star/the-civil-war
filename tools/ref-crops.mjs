// tools/ref-crops.mjs: zoomed crop sheets of the UG:G reference screenshots, for studying detail. LOCAL ONLY.
//
//   node tools/ref-crops.mjs <out.png> <zoom> "ugg-2:560,560,360,220:Iron Brigade" ["ugg-N:x,y,w,h:label" ...]
//
// Rectangles are in the 1920x1080 pixels of .out/reference/ugg-N.png (fetch them with
// tools/fetch-reference-shots.mjs). Output goes wherever you say; keep it under .out/ (copyrighted, never commit).
// Saved examples: .out/reference/crops/{infantry,artillery,landscape}-2x.png (see docs/visual-reference.md).
import { chromium } from 'playwright';
import fs from 'node:fs';

const [out, zoom, ...specs] = process.argv.slice(2);
if (!out || !zoom || !specs.length) {
  console.error('usage: node tools/ref-crops.mjs <out.png> <zoom> "ugg-N:x,y,w,h:label" ...');
  process.exit(1);
}
const z = Number(zoom);
let cells = '';
for (const s of specs) {
  const [name, rect, label] = s.split(':');
  const [x, y, w, h] = rect.split(',').map(Number);
  const img = fs.readFileSync(`.out/reference/${name}.png`).toString('base64');
  cells += `<figure style="margin:4px;display:inline-block;vertical-align:top;font:13px sans-serif;color:#fff">` +
    `<div style="width:${w * z}px;height:${h * z}px;overflow:hidden;position:relative">` +
    `<img style="position:absolute;left:${-x * z}px;top:${-y * z}px;width:${1920 * z}px" src="data:image/png;base64,${img}"></div>` +
    `${name} ${label || ''}</figure>`;
}
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.setContent(`<body style="margin:0;background:#222">${cells}</body>`);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);

// tools/make-icons.mjs: draws the app icons (a plain swallow-tailed guidon on a dark field; no text, no
// insignia) from an inline SVG with headless Chromium and writes them to assets/icons/:
//   icon-192.png, icon-512.png (also the maskable icon: the flag sits inside the central safe circle),
//   apple-touch-icon.png (180).
// Run once after changing the drawing: node tools/make-icons.mjs. Fails if a PNG reaches 30 KB.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './serve.mjs';

const OUT = path.join(ROOT, 'assets', 'icons');
const MAX_BYTES = 30 * 1024;
const SIZES = [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]];

// Flat colours only (gradients make the PNGs too big). 100 x 100 units; everything that matters stays inside the central circle of radius 40 (maskable safe zone).
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <clipPath id="tail"><path d="M33 27 C45 24 56 30 76 26 L62 42 L77 58 C57 62 45 56 33 59 Z"/></clipPath>
  </defs>
  <rect width="100" height="100" fill="#17141a"/>
  <rect x="29.5" y="20" width="3.4" height="62" rx="1.2" fill="#c9a66b"/>
  <circle cx="31.2" cy="19" r="3" fill="#e2c27a"/>
  <g clip-path="url(#tail)">
    <rect x="30" y="20" width="50" height="22" fill="#b8323f"/>
    <rect x="30" y="42" width="50" height="22" fill="#f1ece0"/>
    <path d="M48 20 C52 34 52 50 49 64 L58 64 C61 50 61 34 57 20 Z" fill="#000" fill-opacity="0.12"/>
  </g>
  <path d="M33 27 C45 24 56 30 76 26 L62 42 L77 58 C57 62 45 56 33 59 Z" fill="none" stroke="#0e0c10" stroke-opacity="0.5" stroke-width="0.8"/>
</svg>`;

const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await fs.mkdir(OUT, { recursive: true });
  for (const [name, size] of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#17141a">${SVG.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    const { size: bytes } = await fs.stat(file);
    const ok = bytes < MAX_BYTES;
    if (!ok) failed = true;
    console[ok ? 'log' : 'error'](`${ok ? 'ok  ' : 'FAIL'} ${path.relative(ROOT, file)}: ${size}x${size}, ${(bytes / 1024).toFixed(1)} KB (limit 30 KB)`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);

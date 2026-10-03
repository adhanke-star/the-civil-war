// Bake stage 5 (Node): pack rendered sprite frames into atlas pages + a JSON manifest, build the
// contact sheet and the hero preview, and (with --summary) print the job-summary markdown.
//
//   node tools/bake/pack.mjs [--out .out/bake]            pack + contact sheet + preview
//   node tools/bake/pack.mjs [--out .out/bake] --summary  markdown report on stdout
//
// Inputs (written by the Blender stages under --out):
//   frames/<tier>/<clip>_<i>_d<dd>.png, variants/*.png, hero.png, report/*.json, timing.tsv
// Outputs:
//   atlas/soldier_<tier>_<page>.png, atlas/soldier.json, contact-sheet.png, hero-preview.png
//
// PNG I/O uses pngjs (already a devDependency in package.json; no new dependency).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(opt('out', process.env.BAKE_OUT || '.out/bake'));
const MAX_PAGE = 2048;
const PAD = 1;
// The shadow catcher leaves a faint sky-occlusion haze (alpha 1-5 of 255) over the whole frame,
// which would defeat trimming; anything below this is cleared before packing.
const ALPHA_CUT = 6;

const readJSON = (p, d = {}) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d);
const readPNG = (p) => PNG.sync.read(fs.readFileSync(p));
const writePNG = (p, png) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const buf = PNG.sync.write(png, { colorType: 6 });
  fs.writeFileSync(p, buf);
  return buf.length;
};
const blank = (w, h) => {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return png;
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function trimRect(png) {
  const { width: w, height: h, data } = png;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function blit(dst, src, sx, sy, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    const s = ((sy + y) * src.width + sx) * 4;
    const d = ((dy + y) * dst.width + dx) * 4;
    src.data.copy(dst.data, d, s, s + w * 4);
  }
}

// straight-alpha "over" onto an opaque destination
function over(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      const a = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round(src.data[s + c] * a + dst.data[d + c] * (1 - a));
      dst.data[d + 3] = 255;
    }
  }
}

function fill(png, rgb) {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
}

// shelf packer: tallest first; returns pages of placements
function shelfPack(items, width, maxH) {
  const pages = [];
  let page = null, x = 0, y = 0, shelfH = 0;
  const newPage = () => {
    page = { w: width, h: 0, items: [] };
    pages.push(page);
    x = 0; y = 0; shelfH = 0;
  };
  newPage();
  for (const it of items) {
    const w = it.rect.w + PAD * 2, h = it.rect.h + PAD * 2;
    if (x + w > width) { x = 0; y += shelfH; shelfH = 0; }
    if (y + h > maxH) newPage();
    page.items.push({ it, x: x + PAD, y: y + PAD });
    x += w;
    shelfH = Math.max(shelfH, h);
    page.h = Math.max(page.h, y + h);
  }
  for (const p of pages) p.h = Math.ceil(p.h / 4) * 4;
  return pages;
}

function packTier(tier) {
  const dir = path.join(OUT, 'frames', tier);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const items = files.map((f) => {
    const png = readPNG(path.join(dir, f));
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] < ALPHA_CUT) png.data.writeUInt32LE(0, i);
    return { key: f.replace(/\.png$/, ''), png, rect: trimRect(png), size: png.width };
  });
  items.sort((a, b) => b.rect.h - a.rect.h || b.rect.w - a.rect.w);
  const area = items.reduce((s, i) => s + (i.rect.w + 2) * (i.rect.h + 2), 0);
  let pages = null;
  for (const w of [256, 512, 1024, 2048]) {
    if (w * MAX_PAGE < area * 1.05) continue;
    const p = shelfPack(items, w, MAX_PAGE);
    if (p.length === 1) { pages = p; break; }
  }
  if (!pages) pages = shelfPack(items, MAX_PAGE, MAX_PAGE);
  const frames = {};
  const pageInfo = [];
  pages.forEach((pg, pi) => {
    const atlas = blank(pg.w, pg.h);
    for (const { it, x, y } of pg.items) {
      blit(atlas, it.png, it.rect.x, it.rect.y, it.rect.w, it.rect.h, x, y);
      frames[it.key] = { page: pi, x, y, w: it.rect.w, h: it.rect.h, ox: it.rect.x, oy: it.rect.y };
    }
    const file = `soldier_${tier}_${pi}.png`;
    const bytes = writePNG(path.join(OUT, 'atlas', file), atlas);
    pageInfo.push({ file, w: pg.w, h: pg.h, bytes });
  });
  const ordered = {};
  for (const k of Object.keys(frames).sort()) ordered[k] = frames[k];
  const rawBytes = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  return { frameSize: items[0]?.size ?? 0, count: items.length, pages: pageInfo, frames: ordered, rawFrameBytes: rawBytes };
}

function contactSheet(render, clips) {
  const dir = path.join(OUT, 'frames', 'close');
  const S = render?.tiers?.close?.px ?? 256;
  const N = render?.camera?.directions ?? 16;
  const have = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const rendered = render?.tiers?.close?.directions ?? [];
  const pref = render?.params?.hero_dir ?? 2;
  const wd = rendered.includes(pref) ? pref : (rendered[1] ?? rendered[0] ?? 0);
  const dd = (d) => String(d).padStart(2, '0');
  const cell = (row, col, file, scale = 1) => ({ row, col, file, scale });
  const cells = [];
  for (let d = 0; d < Math.min(N, 16); d++) cells.push(cell(d < 8 ? 0 : 1, d % 8, path.join(dir, `stand_0_d${dd(d)}.png`)));
  const walkN = clips?.walk?.frames?.length ?? 8;
  for (let i = 0; i < Math.min(walkN, 8); i++) cells.push(cell(2, i, path.join(dir, `walk_${i}_d${dd(wd)}.png`)));
  const row3 = [
    path.join(dir, `fire_0_d${dd(wd)}.png`), path.join(dir, `fire_1_d${dd(wd)}.png`),
    path.join(dir, `fire_2_d${dd(wd)}.png`), path.join(dir, `fallen_0_d${dd(wd)}.png`),
    path.join(OUT, 'variants', 'slouch.png'), path.join(OUT, 'variants', 'bayonet.png'),
    path.join(OUT, 'frames', 'field', `stand_0_d${dd(wd)}.png`), path.join(OUT, 'frames', 'field', `walk_0_d${dd(wd)}.png`),
  ];
  row3.forEach((f, i) => cells.push(cell(3, i, f)));
  const sheet = new PNG({ width: 8 * S, height: 4 * S });
  fill(sheet, hex('#7f8d4e'));
  let placed = 0;
  for (const c of cells) {
    if (!fs.existsSync(c.file)) continue;
    const png = readPNG(c.file);
    const ox = c.col * S + Math.floor((S - png.width) / 2);
    const oy = c.row * S + Math.floor((S - png.height) / 2);
    over(sheet, png, ox, oy);
    placed++;
  }
  // thin cell borders
  const line = hex('#5f6b38');
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      if (x % S === 0 || y % S === 0) {
        const i = (y * sheet.width + x) * 4;
        sheet.data[i] = line[0]; sheet.data[i + 1] = line[1]; sheet.data[i + 2] = line[2];
      }
    }
  }
  const bytes = writePNG(path.join(OUT, 'contact-sheet.png'), sheet);
  return {
    file: 'contact-sheet.png', bytes, placed, walkDirection: wd,
    layout: [
      'row 1: stand, directions 0-7 (0 faces the viewer, 4 faces screen-right)',
      'row 2: stand, directions 8-15',
      `row 3: walk cycle frames 0-7, direction ${wd}`,
      `row 4: aim, fire, recover, fallen (direction ${wd}); slouch-hat variant; fixed-bayonet variant; field tier (96 px) stand and walk at 1:1`,
    ],
  };
}

function heroPreview() {
  const f = path.join(OUT, 'hero.png');
  if (!fs.existsSync(f)) return null;
  const hero = readPNG(f);
  const bg = new PNG({ width: hero.width, height: hero.height });
  const top = hex('#9fae6c'), bot = hex('#6f7d40');
  for (let y = 0; y < bg.height; y++) {
    const t = y / (bg.height - 1);
    for (let x = 0; x < bg.width; x++) {
      const i = (y * bg.width + x) * 4;
      for (let c = 0; c < 3; c++) bg.data[i + c] = Math.round(top[c] * (1 - t) + bot[c] * t);
      bg.data[i + 3] = 255;
    }
  }
  over(bg, hero, 0, 0);
  return { file: 'hero-preview.png', bytes: writePNG(path.join(OUT, 'hero-preview.png'), bg) };
}

function pack() {
  const render = readJSON(path.join(OUT, 'report', 'render.json'));
  const poses = readJSON(path.join(OUT, 'report', 'poses.json'));
  const clips = render.clips || poses.clips || {};
  const tiers = {};
  for (const tier of ['close', 'field']) {
    const t = packTier(tier);
    if (!t) continue;
    const r = render.tiers?.[tier] || {};
    tiers[tier] = {
      frameSize: t.frameSize, pxPerMetre: r.px_per_m, anchor: r.anchor_px, samples: r.samples,
      directionsRendered: r.directions, count: t.count, pages: t.pages, rawFrameBytes: t.rawFrameBytes,
      frames: t.frames,
    };
  }
  const manifest = {
    version: 1,
    subject: 'Union infantry private, Western theater, 1862 (first-pass bake probe; uniform and kit are placeholder/Inferred)',
    generated: new Date().toISOString(),
    frameKey: '<clip>_<index>_d<direction, 2 digits>',
    rectRule: 'draw atlas rect (x,y,w,h) at (screenAnchor - anchor + (ox,oy)) at 1:1 scale; anchor = the feet on the ground',
    camera: render.camera, sun: render.sun, colour: render.colour, clips, tiers,
    variants: Object.keys(render.variants || {}),
  };
  fs.mkdirSync(path.join(OUT, 'atlas'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'atlas', 'soldier.json'), JSON.stringify(manifest, null, 1));
  const sheet = contactSheet(render, clips);
  const hero = heroPreview();
  const pack = {
    tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, {
      count: v.count, pages: v.pages, rawFrameBytes: v.rawFrameBytes,
      atlasBytes: v.pages.reduce((s, p) => s + p.bytes, 0),
    }])),
    manifestBytes: fs.statSync(path.join(OUT, 'atlas', 'soldier.json')).size,
    contactSheet: sheet, heroPreview: hero,
  };
  fs.writeFileSync(path.join(OUT, 'report', 'pack.json'), JSON.stringify(pack, null, 2));
  for (const [k, v] of Object.entries(pack.tiers)) {
    console.log(`${k}: ${v.count} frames -> ${v.pages.map((p) => `${p.file} ${p.w}x${p.h} ${(p.bytes / 1024).toFixed(0)} KB`).join(', ')}`);
  }
  console.log(`contact sheet: ${sheet.placed} cells, ${(sheet.bytes / 1024).toFixed(0)} KB; hero preview: ${hero ? (hero.bytes / 1024).toFixed(0) + ' KB' : 'missing'}`);
}

function dirBytes(p) {
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    n += e.isDirectory() ? dirBytes(q) : fs.statSync(q).size;
  }
  return n;
}

function summary() {
  const lines = [];
  const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
  const tsv = path.join(OUT, 'timing.tsv');
  lines.push('## Bake timing', '', '| step | seconds | status |', '|---|---:|---|');
  let total = 0;
  if (fs.existsSync(tsv)) {
    for (const row of fs.readFileSync(tsv, 'utf8').trim().split('\n')) {
      const [step, secs, status] = row.split('\t');
      total += Number(secs) || 0;
      lines.push(`| ${step} | ${Number(secs).toFixed(1)} | ${status} |`);
    }
  }
  lines.push(`| **timed total** | **${total.toFixed(1)}** (${(total / 60).toFixed(1)} min) | |`, '');
  const probe = readJSON(path.join(OUT, 'report', 'probe.json'));
  lines.push('## Body route', '');
  if (probe.route === 'mpfb2-headless') {
    lines.push(`MPFB2 headless: **YES** (${probe.mpfb_module}); body ${probe.body?.vertices_visible_evaluated} visible verts / ${probe.body?.faces_visible_evaluated} faces, height ${probe.body?.height_m} m; rig ${probe.rig?.bones} bones; skin ${probe.skin ? path.basename(probe.skin) : 'NONE'}; create_human ${probe.create_human_seconds}s, add_builtin_rig ${probe.add_rig_seconds}s.`);
  } else {
    lines.push(`**MPFB2 headless: NO / not reached** (route=${probe.route ?? 'missing'}). Attempts:`);
  }
  for (const a of probe.attempts || []) lines.push(`- ${a.ok ? 'ok' : 'FAILED'}: ${a.name} (${a.seconds ?? '-'}s)${a.error ? ' -- ' + a.error : ''}`);
  lines.push('');
  const render = readJSON(path.join(OUT, 'report', 'render.json'));
  const pack = readJSON(path.join(OUT, 'report', 'pack.json'));
  if (render.tiers) {
    lines.push('## Render', '', '| tier | px | samples | renders | s/frame mean | s/frame median | first frame s | total s | atlas |', '|---|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const [k, t] of Object.entries(render.tiers)) {
      const p = pack.tiers?.[k];
      const atlas = p ? `${p.pages.map((g) => `${g.w}x${g.h}`).join(' + ')}, ${mb(p.atlasBytes)}` : '-';
      lines.push(`| ${k} | ${t.px} | ${t.samples} | ${t.renders} | ${t.seconds_per_frame_mean} | ${t.seconds_per_frame_median} | ${t.seconds_first_frame} | ${t.seconds_total} | ${atlas} |`);
    }
    lines.push('', `hero ${render.hero?.px}px @ ${render.hero?.samples} spp: ${render.hero?.seconds}s. Variants: ${JSON.stringify(render.variants)}`);
    if (render.reduced) lines.push('', `**Directions reduced**: ${render.reduced.reason}; rendered ${JSON.stringify(render.reduced.directions_rendered)}`);
    const c = render.tiers.close, f = render.tiers.field;
    if (c) {
      const perDir = (c.renders / c.directions.length);
      const est = (dirs, frames, variants) => {
        const sec = dirs * frames * ((c.seconds_per_frame_mean || 0) + (f ? f.seconds_per_frame_mean : 0)) * variants;
        const bytesPerFrame = ((p) => (p ? p.atlasBytes / p.count : 0));
        const by = dirs * frames * (bytesPerFrame(pack.tiers?.close) + bytesPerFrame(pack.tiers?.field)) * variants;
        return `${(sec / 60).toFixed(1)} min CPU on this runner, atlas ~${mb(by)}`;
      };
      lines.push('', '## Extrapolation (same samples, same runner, linear)', '',
        `- this probe: ${c.directions.length} directions x ${perDir} frames x ${f ? 2 : 1} tiers`,
        `- full soldier (16 directions x 40 frames x 2 tiers): ${est(16, 40, 1)}`,
        `- 8 figure variants of that: ${est(16, 40, 8)}`);
    }
  }
  const up = ['frames', 'atlas', 'variants', 'report'].reduce((s, d) => s + dirBytes(path.join(OUT, d)), 0) +
    ['contact-sheet.png', 'hero.png', 'hero-preview.png', 'timing.tsv'].reduce((s, f) => s + (fs.existsSync(path.join(OUT, f)) ? fs.statSync(path.join(OUT, f)).size : 0), 0);
  lines.push('', `Artifact payload (uncompressed): ${mb(up)}`);
  console.log(lines.join('\n'));
}

if (argv.includes('--summary')) summary();
else pack();

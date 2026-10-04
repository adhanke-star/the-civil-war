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

function packTier(tier, framing = {}) {
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
      // added (second pass): this frame's own feet anchor (px, untrimmed frame) and px per metre
      const m = /^(.+)_(\d+)_d(\d+)$/.exec(it.key);
      const fc = m && framing[m[1]];
      if (fc && fc.anchors && fc.anchors[Number(m[3])]) {
        const [ax, ay] = fc.anchors[Number(m[3])];
        Object.assign(frames[it.key], { ax, ay, ppm: fc.pxPerMetre });
      }
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

// Third pass: the render runs as parallel shards (render.py --shard), each writing
// report/render-<shard>.json. Merge them into one render.json with the second pass's shape:
// tiers.<tier> sums renders and seconds and unions directions; field_variants unions variants.
function mergeShards() {
  const rdir = path.join(OUT, 'report');
  const files = fs.existsSync(rdir) ? fs.readdirSync(rdir).filter((f) => /^render-.+\.json$/.test(f)).sort() : [];
  if (!files.length) return null;
  const shards = files.map((f) => readJSON(path.join(rdir, f)));
  const base = shards.find((s) => s.shard === 'hero') || shards[0];
  const merged = JSON.parse(JSON.stringify(base));
  merged.tiers = {};
  merged.field_variants = { planned: [] };
  merged.shards = {};
  merged.variants = {};
  const mismatch = [];
  for (const s of shards) {
    merged.shards[s.shard] = { wall_seconds: s.wall_seconds, renders: Object.fromEntries(Object.entries(s.tiers || {}).map(([k, v]) => [k, v.renders])), timing: s.timing };
    Object.assign(merged.variants, s.variants || {});
    for (const [clip, fr] of Object.entries(s.framing || {})) {
      const b = base.framing?.[clip];
      if (b && Math.abs(b.orthoM - fr.orthoM) > 1e-3) mismatch.push(`${s.shard}:${clip} ${fr.orthoM} vs ${b.orthoM}`);
    }
    for (const [tier, t] of Object.entries(s.tiers || {})) {
      const m = merged.tiers[tier] || (merged.tiers[tier] = { ...JSON.parse(JSON.stringify(t)), renders: 0, seconds_total: 0, directions: [], directions_by_clip: {}, _medians: [], _firsts: [] });
      m.renders += t.renders || 0;
      m.seconds_total = Math.round((m.seconds_total + (t.seconds_total || 0)) * 100) / 100;
      m.directions = [...new Set([...m.directions, ...(t.directions || [])])].sort((a, b) => a - b);
      for (const [clip, ds] of Object.entries(t.directions_by_clip || {})) {
        m.directions_by_clip[clip] = [...new Set([...(m.directions_by_clip[clip] || []), ...ds])].sort((a, b) => a - b);
      }
      if (t.seconds_per_frame_median != null) m._medians.push(t.seconds_per_frame_median);
      if (t.seconds_first_frame != null) m._firsts.push(t.seconds_first_frame);
    }
    for (const [v, info] of Object.entries(s.field_variants || {})) {
      if (v === 'planned') { merged.field_variants.planned = [...new Set([...merged.field_variants.planned, ...info])]; continue; }
      if (v === 'dropped_for_budget') continue;
      const m = merged.field_variants[v] || (merged.field_variants[v] = { renders: 0, seconds_total: 0, composition: info.composition });
      m.renders += info.renders || 0;
      m.seconds_total = Math.round((m.seconds_total + (info.seconds_total || 0)) * 100) / 100;
    }
  }
  for (const t of Object.values(merged.tiers)) {
    t.seconds_per_frame_mean = t.renders ? Math.round((t.seconds_total / t.renders) * 1000) / 1000 : null;
    const med = [...t._medians].sort((a, b) => a - b);
    t.seconds_per_frame_median = med.length ? med[med.length >> 1] : null;
    t.seconds_first_frame = t._firsts.length ? Math.min(...t._firsts) : null;
    delete t._medians; delete t._firsts;
  }
  merged.framing_mismatch = mismatch;
  merged.reduced = null;
  fs.writeFileSync(path.join(rdir, 'render.json'), JSON.stringify(merged, null, 2));
  return { shards: files.length, mismatch };
}

function contactSheet(render, clips) {
  const dir = path.join(OUT, 'frames', 'close');
  const S = render?.tiers?.close?.px ?? 256;
  const N = render?.camera?.directions ?? 16;
  const rendered = render?.tiers?.close?.directions ?? [];
  const pref = render?.params?.hero_dir ?? 2;
  const wd = rendered.includes(pref) ? pref : (rendered[1] ?? rendered[0] ?? pref);
  const dd = (d) => String(d).padStart(2, '0');
  const cell = (row, col, file, scale = 1) => ({ row, col, file, scale });
  const cells = [];
  for (let d = 0; d < Math.min(N, 16); d++) cells.push(cell(d < 8 ? 0 : 1, d % 8, path.join(dir, `stand_0_d${dd(d)}.png`)));
  const walkN = clips?.walk?.frames?.length ?? 8;
  for (let i = 0; i < Math.min(walkN, 8); i++) cells.push(cell(2, i, path.join(dir, `walk_${i}_d${dd(wd)}.png`)));
  const row3 = [
    path.join(dir, `fire_0_d${dd(wd)}.png`), path.join(dir, `fire_1_d${dd(wd)}.png`),
    path.join(dir, `fire_2_d${dd(wd)}.png`), path.join(dir, `fallen_0_d${dd(wd)}.png`),
    ...[0, 1, 2, 3].map((i) => path.join(dir, `load_${i}_d${dd(wd)}.png`)),
  ];
  row3.forEach((f, i) => cells.push(cell(3, i, f)));
  const row4 = [
    path.join(dir, `load_4_d${dd(wd)}.png`),
    ...['slouch', 'bayonet', 'noroll', 'face2', 'mixed'].map((v) => path.join(OUT, 'variants', `${v}.png`)),
  ];
  row4.forEach((f, i) => cells.push(cell(4, i, f)));
  const fdir = path.join(OUT, 'frames', 'field');
  const fvars = Object.keys(render?.field_variants || {}).filter((v) => v !== 'planned' && v !== 'dropped_for_budget');
  const fv = (v) => path.join(OUT, 'frames', `field_${v}`, `stand_0_d${dd(wd)}.png`);
  const row5 = [
    path.join(fdir, `stand_0_d${dd(0)}.png`), path.join(fdir, `stand_0_d${dd(wd)}.png`),
    path.join(fdir, `walk_0_d${dd(wd)}.png`), path.join(fdir, `fire_1_d${dd(wd)}.png`),
    path.join(fdir, `load_2_d${dd(wd)}.png`), ...fvars.slice(0, 3).map(fv),
  ];
  row5.forEach((f, i) => cells.push(cell(5, i, f)));
  // third pass: every head preset (close tier, stand), then each at 256 px head-and-shoulders
  const heads = Object.keys(render?.heads_info || {}).sort().slice(0, 8);
  heads.forEach((h, i) => cells.push(cell(6, i, path.join(OUT, 'variants', `head_${h}.png`))));
  heads.forEach((h, i) => cells.push(cell(7, i, path.join(OUT, 'heads', `${h}.png`))));
  // third pass: a 256 px hand close-up for every grip frame
  const shots = Object.keys(render?.hand_shots || {});
  shots.slice(0, 8).forEach((k, i) => cells.push(cell(8, i, path.join(OUT, 'hands', `${k}.png`))));
  const row9 = [...shots.slice(8, 10).map((k) => path.join(OUT, 'hands', `${k}.png`)), ...fvars.slice(3, 9).map(fv)];
  row9.forEach((f, i) => cells.push(cell(9, i, f)));
  const sheet = new PNG({ width: 8 * S, height: 10 * S });
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
      `row 4: aim, fire, recover, fallen; load 0-3: cartridge from the box, charge, draw rammer, ram (direction ${wd})`,
      `row 5: load 4 (prime); variants (stand, d${wd}): slouch hat, fixed bayonet, no blanket roll, face2 (head h2), mixed (h3 + slouch + no roll)`,
      `row 6: field tier (96 px) at 1:1: stand d0 and d${wd}, walk, fire, load (d${wd}); field variants ${fvars.slice(0, 3).join(', ')} (stand d${wd})`,
      `row 7: head presets ${heads.join(', ')} at the close tier (256 px, stand, d${render?.params?.head_dir ?? 1})`,
      `row 8: the same head presets, 256 px head-and-shoulders (portrait camera)`,
      `row 9: hand close-ups ${shots.slice(0, 8).join(', ')}`,
      `row 10: hand close-ups ${shots.slice(8, 10).join(', ')}; field variants ${fvars.slice(3, 9).join(', ')} (96 px, stand d${wd})`,
    ],
  };
}

function heroPreview(src = 'hero.png', dst = 'hero-preview.png') {
  const f = path.join(OUT, src);
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
  return { file: dst, bytes: writePNG(path.join(OUT, dst), bg) };
}

// The sRGB each named part actually lands at in hero.png (median over directly visible pixels
// that render.py found by ray casting from the hero camera).
function measureColours(render) {
  const f = path.join(OUT, 'hero.png');
  const probes = render.colour_probes || {};
  if (!fs.existsSync(f)) return {};
  const png = readPNG(f);
  const out = {};
  for (const [label, pts] of Object.entries(probes)) {
    const rs = [], gs = [], bs = [];
    for (const [x, y] of pts) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= png.width || yi >= png.height) continue;
      const i = (yi * png.width + xi) * 4;
      if (png.data[i + 3] < 250) continue;
      rs.push(png.data[i]); gs.push(png.data[i + 1]); bs.push(png.data[i + 2]);
    }
    if (!rs.length) continue;
    const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    // lit side: the brightest third of the samples (by luminance), channel medians
    const idx = rs.map((_, i) => i).sort((a, b) => (0.2126 * rs[b] + 0.7152 * gs[b] + 0.0722 * bs[b]) - (0.2126 * rs[a] + 0.7152 * gs[a] + 0.0722 * bs[a]));
    const top = idx.slice(0, Math.max(1, Math.ceil(idx.length / 3)));
    const medOf = (arr, ids) => ids.map((i) => arr[i]).sort((p, q) => p - q)[ids.length >> 1];
    const lit = [medOf(rs, top), medOf(gs, top), medOf(bs, top)];
    const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
    const c = [med(rs), med(gs), med(bs)];
    out[label] = { hex: toHex(c), lit: toHex(lit), samples: rs.length };
  }
  return out;
}

// A variant's composition: head preset (with its CC0 assets), hat, blanket roll.
function variantComposition(name, render, probe) {
  let c = render?.field_variants?.[name]?.composition;
  if (!c) {
    const m = /^(h\d+)_(cap|slouch)_(roll|noroll)$/.exec(name);
    c = m ? { head: m[1], hat: m[2], roll: m[3] === 'roll' } : { head: probe?.heads_default || 'h1', hat: 'cap', roll: true };
  }
  const h = probe?.heads?.[c.head] || {};
  return {
    head: c.head, headLabel: h.label ?? null, use: h.use ?? null, hat: c.hat === 'slouch' ? 'slouch hat' : 'forage cap',
    blanketRoll: !!c.roll,
    assets: { skin: h.skin ?? null, hair: h.hair ?? null, eyebrows: h.brows ?? null, eyelashes: h.lashes ?? null, eyes: h.eyes ?? null, beard: h.beard ?? null },
  };
}

function pack() {
  const mergeInfo = mergeShards();
  if (mergeInfo) console.log(`merged ${mergeInfo.shards} shard reports${mergeInfo.mismatch.length ? '; FRAMING MISMATCH ' + mergeInfo.mismatch.join('; ') : ''}`);
  const render = readJSON(path.join(OUT, 'report', 'render.json'));
  const poses = readJSON(path.join(OUT, 'report', 'poses.json'));
  const probe = readJSON(path.join(OUT, 'report', 'probe.json'));
  const clips = render.clips || poses.clips || {};
  const tiers = {};
  for (const tier of ['close', 'field']) {
    const r = render.tiers?.[tier] || {};
    const t = packTier(tier, r.clips || {});
    if (!t) continue;
    tiers[tier] = {
      frameSize: t.frameSize, pxPerMetre: r.px_per_m, anchor: r.anchor_px, samples: r.samples,
      directionsRendered: r.directions, count: t.count, pages: t.pages, rawFrameBytes: t.rawFrameBytes,
      frames: t.frames,
      // added (second pass): per-clip framing; tier-level pxPerMetre/anchor above are the stand clip's
      clips: r.clips, directionsByClip: r.directions_by_clip,
    };
  }
  // added (second pass): extra figure variants in the field tier, same keys/anchors as the base
  const fieldVariants = {};
  const framesDir = path.join(OUT, 'frames');
  for (const d of (fs.existsSync(framesDir) ? fs.readdirSync(framesDir) : []).filter((x) => x.startsWith('field_')).sort()) {
    const t = packTier(d, render.tiers?.field?.clips || {});
    const name = d.slice('field_'.length);
    // composition added (third pass): which head preset, hat and blanket roll this variant shows
    if (t) fieldVariants[name] = { count: t.count, pages: t.pages, rawFrameBytes: t.rawFrameBytes, frames: t.frames, composition: variantComposition(name, render, probe) };
  }
  if (tiers.field && Object.keys(fieldVariants).length) tiers.field.variants = fieldVariants;
  if (tiers.field) tiers.field.baseComposition = variantComposition('base', render, probe);
  if (tiers.close) tiers.close.baseComposition = variantComposition('base', render, probe);
  const measuredColours = measureColours(render);
  const manifest = {
    version: 1,
    subject: 'Union infantry private, Western theater, 1862 (third-pass bake; uniform and kit are placeholder/Inferred)',
    generated: new Date().toISOString(),
    frameKey: '<clip>_<index>_d<direction, 2 digits>',
    rectRule: 'draw atlas rect (x,y,w,h) at (screenAnchor - (ax,ay) + (ox,oy)) where (ax,ay) and ppm are the frame record\'s own fields (feet anchor in the untrimmed frame, px per metre); scale the rect by (game px per metre) / ppm. One ppm per clip; one anchor per clip and direction. tiers.<tier>.anchor/pxPerMetre are the stand clip at direction 0, kept for older readers',
    camera: render.camera, sun: render.sun, colour: render.colour, clips, tiers,
    variants: Object.keys(render.variants || {}),
    // added (second pass)
    lights: render.lights, quick: render.quick, variantsFraming: render.variants_framing,
    measuredColours,
    readability: 'field tier only: musket cross-section thickened x' + (render.params?.field_musket_scale ?? '?') + ' (length unchanged) so it survives at 96 px',
    // added (third pass)
    heads: Object.fromEntries(Object.entries(probe.heads || {}).map(([k, h]) => [k, {
      label: h.label, use: h.use, skin: h.skin ?? null, hair: h.hair ?? null, eyebrows: h.brows ?? null,
      eyelashes: h.lashes ?? null, eyes: h.eyes ?? null, beard: h.beard ?? null, targets: h.targets_applied ?? {},
      missing: h.missing ?? [],
    }])),
    headsNote: 'every head preset is built only from CC0 assets (MakeHuman system assets; bodyparts05 beards) and MPFB2 CC0 targets; use "usct" heads only for United States Colored Troops regiments',
    grips: poses.grip_mesh || {},
    gripsNote: 'per clip frame and hand: finger segments (of 15) whose real skinned mesh is within ' + (poses.constants?.contact_mm ?? 3) + ' mm of the held surface, and the deepest penetration (mm) into the musket, rammer or cartridge',
    shards: render.shards || null,
  };
  fs.mkdirSync(path.join(OUT, 'atlas'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'atlas', 'soldier.json'), JSON.stringify(manifest, null, 1));
  const sheet = contactSheet(render, clips);
  const hero = heroPreview();
  const closeup = heroPreview('hero-closeup.png', 'hero-closeup-preview.png');
  const portrait = heroPreview('portrait.png', 'portrait-preview.png');
  const handsPrev = heroPreview('hands.png', 'hands-preview.png');
  const pack = {
    tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, {
      count: v.count, pages: v.pages, rawFrameBytes: v.rawFrameBytes,
      atlasBytes: v.pages.reduce((s, p) => s + p.bytes, 0),
    }])),
    manifestBytes: fs.statSync(path.join(OUT, 'atlas', 'soldier.json')).size,
    contactSheet: sheet, heroPreview: hero, closeupPreview: closeup, portraitPreview: portrait, handsPreview: handsPrev, measuredColours,
    fieldVariants: Object.fromEntries(Object.entries(fieldVariants).map(([k, v]) => [k, {
      count: v.count, pages: v.pages, atlasBytes: v.pages.reduce((s, p) => s + p.bytes, 0) }])),
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
  // timing.tsv is the prep job (per step); timing-<shard>.tsv one line per render shard and pack
  const tsvs = fs.readdirSync(OUT).filter((f) => /^timing.*\.tsv$/.test(f)).sort((p, q) => (p === 'timing.tsv' ? -1 : q === 'timing.tsv' ? 1 : p.localeCompare(q)));
  lines.push('## Bake timing', '', '| step | seconds | status |', '|---|---:|---|');
  let total = 0;
  for (const f of tsvs) {
    for (const row of fs.readFileSync(path.join(OUT, f), 'utf8').trim().split('\n').filter(Boolean)) {
      const [step, secs, status] = row.split('\t');
      total += Number(secs) || 0;
      lines.push(`| ${step} | ${Number(secs).toFixed(1)} | ${status} |`);
    }
  }
  lines.push(`| **timed total (CPU-job seconds, summed over parallel jobs)** | **${total.toFixed(1)}** (${(total / 60).toFixed(1)} min) | |`, '');
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
    lines.push('', `hero ${render.hero?.px}px @ ${render.hero?.samples} spp: ${render.hero?.seconds}s; close-up @ ${render.closeup?.samples} spp: ${render.closeup?.seconds}s. Variants: ${JSON.stringify(render.variants)}`);
    if (render.quick) lines.push('', '**Quick run** (check set only, not the full matrix).');
    if (pack.measuredColours) lines.push('', `measured sRGB in hero.png: ${Object.entries(pack.measuredColours).map(([k, v]) => `${k} median ${v.hex}, lit ${v.lit} (${v.samples})`).join('; ')}`);
    if (pack.fieldVariants) lines.push('', `field variants: ${JSON.stringify(pack.fieldVariants)}; plan ${JSON.stringify(render.field_variants)}`);
    const fr = render.tiers.close?.clips || {};
    lines.push('', '| clip | ortho m | close px/m | close anchor |', '|---|---:|---:|---|');
    for (const [k, v] of Object.entries(fr)) lines.push(`| ${k} | ${v.orthoM} | ${v.pxPerMetre} | ${JSON.stringify(v.anchor)} |`);
    const po = readJSON(path.join(OUT, 'report', 'poses.json'));
    if (po.grip_mesh) {
      lines.push('', '### Grips (real skinned hand mesh vs the held surface)', '', '| frame | hand | segments in contact /15 | thumb | max penetration mm | verts >1 mm inside | model wrist bend deg |', '|---|---|---:|---:|---:|---:|---:|');
      for (const [k, sides] of Object.entries(po.grip_mesh)) {
        for (const [s, v] of Object.entries(sides)) lines.push(`| ${k} | ${s} | ${v.segments_touching} | ${v.thumb_segments} | ${v.max_penetration_mm} | ${v.vertices_over_1mm_inside} | ${po.grips?.[k]?.[s]?.wrist_bend_deg ?? '-'} |`);
      }
    }
    if (po.grip_mesh_error) lines.push('', '**grip mesh measurement failed**', '```', po.grip_mesh_error, '```');
    if (po.hand_model) lines.push('', `hand model: ${JSON.stringify(po.hand_model).slice(0, 900)}`);
    if (render.shards) {
      lines.push('', '### Shards', '', '| shard | wall s | renders |', '|---|---:|---|');
      for (const [k, v] of Object.entries(render.shards)) lines.push(`| ${k} | ${v.wall_seconds} | ${JSON.stringify(v.renders)} |`);
      if (render.framing_mismatch?.length) lines.push('', `**framing mismatch between shards**: ${render.framing_mismatch.join('; ')}`);
    }
    const pr0 = probe;
    if (pr0.heads) lines.push('', '### Heads', '', ...Object.entries(pr0.heads).map(([k, h]) => `- ${k} (${h.use}): ${h.label}; skin ${h.skin}, hair ${h.hair}, brows ${h.brows}, lashes ${h.lashes}, eyes ${h.eyes}, beard ${h.beard ?? 'none'}; missing ${JSON.stringify(h.missing)}`));
    if (po.checks) lines.push('', '### Pose checks', '', '```', JSON.stringify(po.checks, null, 1).slice(0, 3000), '```');
    const un = readJSON(path.join(OUT, 'report', 'uniform.json'));
    if (un.timing) lines.push('', `uniform.py objects: ${Object.keys(un.objects || {}).length}; render triangles (viewport levels): ${un.render_triangles_viewport_levels}`);
    const pr = readJSON(path.join(OUT, 'report', 'probe.json'));
    if (pr.variant_assets) lines.push('', `variant assets: ${JSON.stringify(pr.variant_assets)}`);
    if (render.reduced) lines.push('', `**Directions reduced**: ${render.reduced.reason}`);
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

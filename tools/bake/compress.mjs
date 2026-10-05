// Repackage the APPROVED bake on Actions; never rebuild or change its poses.
// Node/pngjs premultiplies stored display RGB bytes, matching the existing PNG upload.
// toktx treats those bytes as linear data; the runtime still un-premultiplies and decodes sRGB.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
export const SOURCE = { run: 37347072866, sha: '820846fdc2fe11782a36b219220edcb16e222f92', artifact: 'bake-33' };
const LOOKS = ['base', 'h1_slouch_noroll', 'h2_cap_roll', 'h3_slouch_roll', 'h4_cap_noroll',
  'h4_slouch_roll', 'h5_slouch_noroll', 'h6_cap_roll', 'h7_cap_roll'];
const CLIPS = { stand: 1, walk: 8, fire: 3, fallen: 1, load: 5 };
export const groupsOf = (T) => ({ base: T, ...T.variants });
const fail = (message) => { throw new Error(`figure pack: ${message}`); };
const inside = (child, parent) => child.startsWith(parent + path.sep);

/** Validate the full approved pack, including actual composition metadata and every frame's own scale. */
export function validateApproved(m) {
  if (m.quick || m.camera?.directions !== 16) fail('requires the full 16-direction bake');
  if (Object.keys(m.clips || {}).sort().join() !== Object.keys(CLIPS).sort().join()) fail('clip set changed');
  for (const [clip, count] of Object.entries(CLIPS)) if (m.clips[clip].frames.length !== count) fail(`${clip} frame count`);
  const files = new Set();
  let frames = 0;
  if (Object.keys(m.tiers || {}).sort().join() !== 'close,field') fail('tier set changed');
  for (const tier of ['close', 'field']) {
    const T = m.tiers?.[tier];
    if (!T) fail(`missing ${tier}`);
    const groups = groupsOf(T);
    if (Object.keys(groups).sort().join() !== LOOKS.join()) fail(`${tier}: expected all nine looks`);
    let pages = 0;
    for (const [name, G] of Object.entries(groups)) {
      const composition = name === 'base' ? T.baseComposition : G.composition;
      const head = m.heads?.[composition?.head];
      if (!head || composition.use !== head.use) fail(`${tier}:${name}: eligibility metadata disagrees`);
      if ((name === 'h7_cap_roll') !== (composition.use === 'usct')) fail(`${tier}:${name}: USCT eligibility changed`);
      if (G.count !== 288 || Object.keys(G.frames || {}).length !== 288) fail(`${tier}:${name}: frame count`);
      pages += G.pages.length;
      for (const p of G.pages) {
        if (!/^soldier_(close|field)(_[a-z0-9_]+)?_\d+\.png$/.test(p.file) || files.has(p.file)) fail('unsafe/duplicate page name');
        if (![p.w, p.h].every((n) => Number.isInteger(n) && n > 0 && n <= 2048 && n % 4 === 0)) fail(`${p.file}: dimensions`);
        files.add(p.file);
      }
      for (const [clip, count] of Object.entries(CLIPS)) {
        const dirs = T.directionsByClip?.[clip];
        if (!dirs || dirs.length !== 16 || new Set(dirs).size !== 16 || dirs.some((d) => !Number.isInteger(d) || d < 0 || d > 15)) fail(`${tier}:${clip}: directions`);
        for (let k = 0; k < count; k++) for (let d = 0; d < 16; d++) {
          const key = `${clip}_${k}_d${String(d).padStart(2, '0')}`, f = G.frames[key], p = G.pages[f?.page];
          if (!p || !['x', 'y', 'w', 'h', 'ox', 'oy', 'ax', 'ay', 'ppm'].every((n) => Number.isFinite(f[n]))
            || f.x < 0 || f.y < 0 || f.w <= 0 || f.h <= 0 || f.x + f.w > p.w || f.y + f.h > p.h || f.ppm <= 0) fail(`${tier}:${name}:${key}: rect/anchor/scale`);
          frames++;
        }
      }
    }
    if (pages !== (tier === 'close' ? 36 : 9)) fail(`${tier}: page count`);
  }
  return { frames, pages: files.size, looksPerTier: 9 };
}

/** The GPU block and RGBA allocations for the complete mip chain, including tiny tail levels. */
export function mipBytes(w, h) {
  let block16 = 0, rgba8 = 0, levels = 0;
  do {
    block16 += Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
    rgba8 += w * h * 4; levels++;
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
  } while (true);
  return { block16, rgba8, levels };
}

function regular(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 100 * 1024 * 1024) fail(`not a safe small regular file: ${file}`);
  return fs.readFileSync(file);
}

function freshOut(out) {
  const base = path.join(ROOT, '.out');
  if (!fs.existsSync(base)) fs.mkdirSync(base);
  if (fs.lstatSync(base).isSymbolicLink() || fs.realpathSync(base) !== base || !inside(out, base) || out.includes('\\')) fail('output must stay under real .out/');
  let parent = path.dirname(out);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (fs.lstatSync(parent).isSymbolicLink() || (fs.realpathSync(parent) !== base && !inside(fs.realpathSync(parent), base))) fail('output parent escapes .out/');
  if (fs.existsSync(out)) fail('choose a fresh output directory');
  fs.mkdirSync(out, { recursive: true });
  if (!inside(fs.realpathSync(out), base)) fail('output escaped .out/');
}

export function markPremultiplied(buf, w, h, raw = false) {
  const magic = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 12).equals(magic) || buf.readUInt32LE(20) !== w || buf.readUInt32LE(24) !== h
    || buf.readUInt32LE(40) !== mipBytes(w, h).levels) fail('encoded KTX dimensions/mip count');
  const dfd = buf.readUInt32LE(48), length = buf.readUInt32LE(52);
  if (dfd < 80 || length < 28 || dfd + length > buf.length || buf[dfd + 12] !== (raw ? 1 : 166) || buf[dfd + 14] !== 1
    || buf.readUInt32LE(12) !== (raw ? 37 : 0) || buf.readUInt32LE(44) !== (raw ? 0 : 2)) fail('KTX must be linear RGBA8 or UASTC/Zstd byte data');
  // KHR_DF_FLAG_ALPHA_PREMULTIPLIED; metadata only, pixels have ALREADY been premultiplied once.
  buf[dfd + 15] |= 1;
  return buf;
}

export const DIAGNOSTIC_PAGES = ['soldier_close_0.png', 'soldier_field_0.png'];
export function diagnosticPagesOkay(pages) {
  return pages.length === 2 && DIAGNOSTIC_PAGES.every((name) => pages.filter((p) => p.source === name).length === 1);
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') fail('conversion runs on Actions only');
  const source = fs.realpathSync(process.argv[2]), out = path.resolve(process.argv[3]);
  const diagnostic = process.argv[4] === '--diagnostic';
  if (process.argv[4] && !diagnostic) fail('unknown mode');
  freshOut(out);
  const work = path.join(out, 'work'); fs.mkdirSync(work);
  const m = JSON.parse(regular(path.join(source, 'soldier.json')));
  const counts = validateApproved(m), report = { source: SOURCE, toolSha: process.env.GITHUB_SHA, counts, pages: [] };
  if (diagnostic) Object.assign(report, { diagnosticOnly: true, fieldable: false, label: 'DIAGNOSTIC ONLY' });
  m.compression = { container: 'ktx2', codec: 'uastc', alpha: 'premultiplied-gamma-bytes', source: SOURCE };
  for (const [tier, T] of Object.entries(m.tiers)) for (const [look, G] of Object.entries(groupsOf(T))) for (const p of G.pages) {
    if (diagnostic && !DIAGNOSTIC_PAGES.includes(p.file)) continue;
    const input = path.join(source, p.file), bytes = regular(input);
    if (!inside(fs.realpathSync(input), source)) fail('source page escapes atlas');
    const png = PNG.sync.read(bytes);
    if (png.width !== p.w || png.height !== p.h) fail(`${p.file}: image dimensions disagree`);
    for (let i = 0; i < png.data.length; i += 4) for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(png.data[i + c] * png.data[i + 3] / 255);
    const premul = path.join(work, p.file);
    fs.writeFileSync(premul, PNG.sync.write(png));
    const file = p.file.replace(/\.png$/, '.ktx2'), dest = path.join(out, file);
    const args = ['--t2', '--encode', 'uastc', '--uastc_quality', '4', '--zcmp', '18', '--genmipmap',
      '--filter', 'box', '--assign_oetf', 'linear', '--assign_primaries', 'none', dest, premul];
    const r = spawnSync('toktx', args, { encoding: 'utf8', timeout: 180000 });
    if (r.status !== 0) fail(`toktx ${p.file}: ${r.error?.message || r.stderr || r.stdout}`);
    const encoded = markPremultiplied(regular(dest), p.w, p.h);
    fs.writeFileSync(dest, encoded);
    let rawFile;
    if (diagnostic) {
      rawFile = p.file.replace(/\.png$/, '-raw.ktx2');
      const rawDest = path.join(out, rawFile);
      // Same input and mip recipe, with neither UASTC nor supercompression.
      const rawArgs = ['--t2', ...args.slice(7, -2), rawDest, premul];
      const rawResult = spawnSync('toktx', rawArgs, { encoding: 'utf8', timeout: 180000 });
      if (rawResult.status !== 0) fail(`raw toktx ${p.file}: ${rawResult.error?.message || rawResult.stderr || rawResult.stdout}`);
      fs.writeFileSync(rawDest, markPremultiplied(regular(rawDest), p.w, p.h, true));
    }
    const allocation = mipBytes(p.w, p.h);
    report.pages.push({ tier, look, source: p.file, file, width: p.w, height: p.h, pngBytes: bytes.length,
      bytes: encoded.length, allocation, pngSha256: createHash('sha256').update(bytes).digest('hex'),
      ktxSha256: createHash('sha256').update(encoded).digest('hex'), ...(diagnostic ? { rawFile,
        rawSha256: createHash('sha256').update(regular(path.join(out, rawFile))).digest('hex') } : {}) });
    Object.assign(p, { file, bytes: encoded.length, mipLevels: allocation.levels, encoding: 'uastc', alpha: 'premultiplied-gamma-bytes' });
    console.log(`${tier}:${look} ${file} ${(encoded.length / 1048576).toFixed(2)} MiB`);
  }
  if (diagnostic && !diagnosticPagesOkay(report.pages)) fail('diagnostic requires exactly the fixed two pages');
  fs.writeFileSync(path.join(out, 'soldier.json'), JSON.stringify(m, null, 1));
  report.ktxBytes = report.pages.reduce((s, p) => s + p.bytes, 0);
  report.block16Bytes = report.pages.reduce((s, p) => s + p.allocation.block16, 0);
  report.rgba8Bytes = report.pages.reduce((s, p) => s + p.allocation.rgba8, 0);
  fs.writeFileSync(path.join(out, 'compression.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...counts, ktxMiB: report.ktxBytes / 1048576, block16MiB: report.block16Bytes / 1048576 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });

// tools/vendor.mjs: copy ONLY the ESM runtime files the game needs from node_modules/ into vendor/.
//
// The game ships with no build step (GitHub Pages serves the repo as-is), so its runtime libraries are
// committed under vendor/ and reached through the import map in index.html. This script:
//   1. clears vendor/ (only after proving the real path is <repo>/vendor),
//   2. copies each ENTRY file plus every file it reaches through RELATIVE imports (followed transitively),
//      and each package's LICENSE,
//   3. checks that every BARE import in a vendored file ("three", "quarks.core", ...) is mapped by the
//      import map in index.html to a file that was vendored,
//   4. parses every vendored module with `node --check` (syntax only; resolution is proven by the browser
//      test loading index.html),
//   5. prints each file with its byte size and the total.
// Exit code is non-zero, with one line per problem, if anything fails.

import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'vendor');

// Entry files, as "<package>/<path inside package>". Relative imports are followed automatically, so
// only list what src/ imports directly (or what the import map exposes).
const ENTRIES = [
  'three/build/three.module.js',
  'three/examples/jsm/controls/OrbitControls.js',
  'three/examples/jsm/postprocessing/EffectComposer.js',
  'three/examples/jsm/postprocessing/RenderPass.js',
  'three/examples/jsm/postprocessing/OutputPass.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js',
  'yuka/build/yuka.module.js',
  'three.quarks/dist/three.quarks.esm.js',
  'quarks.core/dist/quarks.core.esm.js', // three.quarks imports the bare specifier 'quarks.core'
  'zzfx/ZzFX.js',
  '@mapbox/martini/index.js',
  'detect-gpu/dist/detect-gpu.esm.js',
  'lil-gui/dist/lil-gui.esm.min.js', // dev-only ?tune panel (src/dev/tune.js); never loaded for players
  'd3-delaunay/src/index.js', // Voronoi field parcels; imports 'delaunator', which imports 'robust-predicates'
  'delaunator/index.js',
  'robust-predicates/esm/orient2d.js', // delaunator needs only orient2d; mapping the bare name here skips ~65 KB
];

// Data folders copied verbatim (no import following): detect-gpu's GPU benchmark tables, so the game
// never fetches them from the unpkg CDN (src/main.js passes benchmarksURL).
const DATA_DIRS = ['detect-gpu/dist/benchmarks'];

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'];

const problems = [];

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Static import/export specifiers at statement starts, plus side-effect imports. Dynamic import() calls
// are reported, not followed.
const STATIC_FROM = /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/gm;
const SIDE_EFFECT = /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm;
const DYNAMIC = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

function specifiersOf(source) {
  const out = new Set();
  for (const re of [STATIC_FROM, SIDE_EFFECT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) out.add(m[2]);
  }
  const dynamic = new Set();
  DYNAMIC.lastIndex = 0;
  let m;
  while ((m = DYNAMIC.exec(source))) dynamic.add(m[2]);
  return { statics: [...out], dynamic: [...dynamic] };
}

async function readImportMap() {
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script\s+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('index.html has no <script type="importmap">');
  const map = JSON.parse(m[1]);
  return map.imports || {};
}

// Resolve a bare specifier through the import map the way a browser does (exact key, else longest
// trailing-slash prefix). Returns a repo-relative path or null.
function resolveBare(spec, imports) {
  if (Object.hasOwn(imports, spec)) return imports[spec];
  let best = null;
  for (const key of Object.keys(imports)) {
    if (key.endsWith('/') && spec.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? imports[best] + spec.slice(best.length) : null;
}

async function clearVendor() {
  let real;
  try {
    real = realpathSync(VENDOR);
  } catch {
    return; // nothing to clear
  }
  const lst = await fs.lstat(VENDOR);
  if (lst.isSymbolicLink()) throw new Error('vendor/ is a symlink; refusing to clear it');
  if (real !== path.join(realpathSync(ROOT), 'vendor')) {
    throw new Error(`vendor/ resolves to ${real}, outside the repo; refusing to clear it`);
  }
  await fs.rm(VENDOR, { recursive: true, force: true });
}

async function main() {
  const imports = await readImportMap();
  await clearVendor();

  const copied = new Map(); // repo-relative vendor path -> bytes
  const modules = []; // absolute vendor paths of JS modules
  const bareSeen = new Map(); // bare spec -> first importer
  const queue = ENTRIES.map((e) => path.join(NODE_MODULES, e));
  const seen = new Set();
  const packages = new Set();

  while (queue.length) {
    const src = queue.shift();
    if (seen.has(src)) continue;
    seen.add(src);
    if (!isInside(src, NODE_MODULES)) {
      problems.push(`import escapes node_modules: ${src}`);
      continue;
    }
    let source;
    try {
      source = await fs.readFile(src, 'utf8');
    } catch {
      problems.push(`missing file: ${path.relative(ROOT, src)} (run npm install)`);
      continue;
    }
    const rel = path.relative(NODE_MODULES, src);
    packages.add(rel.startsWith('@') ? rel.split(path.sep).slice(0, 2).join('/') : rel.split(path.sep)[0]);
    const dest = path.join(VENDOR, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    copied.set(path.relative(ROOT, dest), Buffer.byteLength(source));
    modules.push(dest);

    const { statics, dynamic } = specifiersOf(source);
    for (const spec of statics) {
      if (spec.startsWith('./') || spec.startsWith('../')) {
        queue.push(path.resolve(path.dirname(src), spec));
      } else if (!bareSeen.has(spec)) {
        bareSeen.set(spec, path.relative(ROOT, dest));
      }
    }
    for (const spec of dynamic) {
      console.warn(`note: ${path.relative(ROOT, dest)} has a dynamic import('${spec}') (not followed)`);
    }
  }

  for (const dir of DATA_DIRS) {
    const src = path.join(NODE_MODULES, dir);
    for (const name of (await fs.readdir(src)).sort()) {
      const buf = await fs.readFile(path.join(src, name));
      const dest = path.join(VENDOR, dir, name);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      copied.set(path.relative(ROOT, dest), buf.length);
    }
  }

  for (const pkg of packages) {
    for (const name of LICENSE_NAMES) {
      const src = path.join(NODE_MODULES, pkg, name);
      try {
        const buf = await fs.readFile(src);
        const dest = path.join(VENDOR, pkg, name);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buf);
        copied.set(path.relative(ROOT, dest), buf.length);
        break;
      } catch {
        // try the next spelling
      }
    }
    if (![...copied.keys()].some((k) => k.startsWith(`vendor/${pkg}/`) && LICENSE_NAMES.includes(path.basename(k)))) {
      problems.push(`no LICENSE file found for vendored package ${pkg}`);
    }
  }

  // Every bare import inside vendor/ must resolve through the import map to a vendored file.
  for (const [spec, importer] of bareSeen) {
    const target = resolveBare(spec, imports);
    if (!target) {
      problems.push(`bare import '${spec}' (in ${importer}) is not mapped in index.html's import map`);
      continue;
    }
    const norm = path.normalize(target.replace(/^\.\//, ''));
    if (!copied.has(norm)) problems.push(`import map sends '${spec}' to ${target}, which was not vendored`);
  }
  // Every import-map target (non-prefix) must exist in vendor/.
  for (const [spec, target] of Object.entries(imports)) {
    if (spec.endsWith('/')) continue;
    const norm = path.normalize(target.replace(/^\.\//, ''));
    if (norm.startsWith('vendor' + path.sep) && !copied.has(norm)) {
      problems.push(`import map entry '${spec}' -> ${target} has no vendored file`);
    }
  }

  // Syntax-only parse of each module (no import resolution happens under --check).
  for (const file of modules) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      problems.push(`parse failed: ${path.relative(ROOT, file)}\n${(r.stderr || '').trim().split('\n').slice(0, 4).join('\n')}`);
    }
  }

  let total = 0;
  const rows = [...copied.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [file, bytes] of rows) {
    total += bytes;
    console.log(`${file.padEnd(width)}  ${String(bytes).padStart(9)} B`);
  }
  console.log(`vendor/ total: ${total} B (${(total / 1024 / 1024).toFixed(2)} MiB) in ${rows.length} files; ${modules.length} modules parsed`);

  if (problems.length) {
    for (const p of problems) console.error(`VENDOR FAIL: ${p}`);
    process.exit(1);
  }
  console.log('VENDOR OK');
}

main().catch((err) => {
  console.error(`VENDOR FAIL: ${err.message}`);
  process.exit(1);
});

// tools/prune.mjs: keep .out/ under a size cap by deleting its OLDEST regular files.
//
//   node tools/prune.mjs              cap 300 MB
//   OUT_CAP_MB=50 node tools/prune.mjs
//
// Safety: .out/ must be a real directory (not a symlink) whose realpath is <repo>/.out; the walk never
// follows symlinks and only ever deletes regular files whose realpath is inside .out/. Nothing outside
// .out/ is read for deletion or touched. Silent unless it deletes something (then one summary line).

import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const OUT_DIR = path.join(ROOT, '.out');
const DEFAULT_CAP_MB = 300;

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function capBytesFromEnv() {
  const raw = process.env.OUT_CAP_MB;
  if (raw === undefined || raw === '') return DEFAULT_CAP_MB * 1024 * 1024;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb < 0) throw new Error(`prune: invalid OUT_CAP_MB "${raw}"`);
  return Math.floor(mb * 1024 * 1024);
}

async function listRegularFiles(dir, outReal, acc) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const st = await fs.lstat(full); // lstat: never follow symlinks
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      await listRegularFiles(full, outReal, acc);
    } else if (st.isFile()) {
      acc.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return acc;
}

/** Prune .out/ to capBytes. Returns { deleted, freedBytes, totalBytes }. */
export async function prune({ capBytes = capBytesFromEnv(), outDir = OUT_DIR } = {}) {
  let lst;
  try {
    lst = await fs.lstat(outDir);
  } catch {
    return { deleted: 0, freedBytes: 0, totalBytes: 0 }; // nothing to prune
  }
  if (lst.isSymbolicLink() || !lst.isDirectory()) throw new Error(`prune: ${outDir} is not a real directory; refusing`);
  const outReal = await fs.realpath(outDir);
  if (outReal !== path.join(ROOT, '.out')) throw new Error(`prune: ${outDir} resolves to ${outReal}, not <repo>/.out; refusing`);

  const files = await listRegularFiles(outReal, outReal, []);
  let total = files.reduce((s, f) => s + f.size, 0);
  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));

  let deleted = 0;
  let freed = 0;
  for (const f of files) {
    if (total <= capBytes) break;
    // Re-check right before deleting: still a regular file, not a symlink, real path inside .out/.
    let st;
    let real;
    try {
      st = await fs.lstat(f.path);
      real = await fs.realpath(f.path);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile() || !inside(real, outReal)) continue;
    await fs.unlink(f.path);
    total -= st.size;
    freed += st.size;
    deleted++;
  }
  if (deleted) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    console.log(`prune: deleted ${deleted} oldest file(s) (${mb(freed)} MB) from .out/; now ${mb(total)} MB (cap ${mb(capBytes)} MB)`);
  }
  return { deleted, freedBytes: freed, totalBytes: total };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  prune().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

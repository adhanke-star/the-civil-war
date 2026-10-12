// CPU check: card art, period portraits and backdrops (P6b; assets/art/manifest.json, src/ui/art.js, src/ui/briefing.js).
//   manifest-valid      the shipped manifest passes validateArtManifest (shape, paths inside assets/art, licence, credit)
//   files-exist         every manifest file exists and every file under assets/art is in the manifest (no strays)
//   budgets             arms <= 900 px wide and <= 90 KB; portraits 256 px tall and <= 25 KB; backdrops <= 1920 px wide and
//                       <= 350 KB; silhouettes are small SVGs; the title view (manifest + title backdrop) stays under 1 MB
//   licence-credit      every picture is public domain or CC0 with a credit and an https source page (the generics excepted)
//   attribution         ATTRIBUTION.md has an Art section listing every file
//   arms-resolve        every arm in src/reward/data.js (and every unique's base arm) resolves to art; only the labelled
//                       generic silhouette stands in, and only where the manifest says generic
//   captions-truthful   the pictured objects are named as the sources name them (a Tredegar Confederate howitzer is not
//                       a US M1841; a Parrott of unstated calibre is a "Parrott rifle"; Lincoln's Spencer is "used by")
//   portraits-in-packs  every portrait name (and alias) is a commander named in a battle pack
//   withheld            no portrait entry or file for a name the sources marked doubtful (McDowell, Woodruff, Phelps)
//   exact-names         a portrait never attaches to a different man of the same surname; an alias of the same man does
//   briefing-commanders the briefing lists the commanders its text names first, then the player's side
//   camp-commanders     pack summaries carry each unit's sourced commander for the camp's brigade cards
// `node tools/test-art.mjs` prints ART OK (n/n); `--prove-fail` runs one mutant per check and requires each to fail that
// check, with the check's own name in the failure text. No browser, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, UNIQUES } from '../src/reward/data.js';
import * as art from '../src/ui/art.js';
import { briefingCommanders, loadPackSummary } from '../src/ui/briefing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'assets/art');
const KB = 1024;
const DOUBTFUL = ['John A. McDowell', 'William E. Woodruff', 'Edward H. Phelps'];
const PACKS = ['shiloh', 'stones-river', 'chattanooga'];
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** WebP width and height from the RIFF header (VP8, VP8L or VP8X). */
export function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
  if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  return null;
}
function artFiles() {
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(ART, p).split(path.sep).join('/')); } };
  walk(ART);
  return out.filter((f) => f !== 'manifest.json');
}
function packCommanders() {
  const names = new Set();
  for (const id of PACKS) for (const ph of readJson(`assets/packs/${id}.json`).phases) {
    for (const u of [...ph.scenario.units, ...(ph.scenario.reinforcements || [])]) if (u?.commander?.name) names.add(u.commander.name);
  }
  return names;
}
const localFetch = async (url) => {
  const p = path.join(ROOT, url.replace(/^\.\//, ''));
  if (!fs.existsSync(p)) return { ok: false, headers: { get: () => null }, text: async () => '' };
  const body = fs.readFileSync(p, 'utf8');
  return { ok: true, headers: { get: () => String(Buffer.byteLength(body)) }, text: async () => body };
};

const API = {
  manifest: () => readJson('assets/art/manifest.json'),
  validate: art.validateArtManifest,
  files: artFiles,
  read: (f) => fs.readFileSync(path.join(ART, f)),
  attribution: () => fs.readFileSync(path.join(ROOT, 'ATTRIBUTION.md'), 'utf8'),
  ARMS, UNIQUES, armArt: art.armArt, armIdOf: art.armIdOf, portraitArt: art.portraitArt,
  commanders: packCommanders, doubtful: DOUBTFUL,
  briefingCommanders, loadPackSummary, fetcher: localFetch,
  scenario: (pack, phase) => readJson(`assets/packs/${pack}.json`).phases.find((p) => p.id === phase).scenario,
};

const fileList = (m) => [m.generic.arm.file, m.generic.portrait.file, ...Object.values(m.arms).map((e) => e.file),
  ...Object.values(m.portraits).map((e) => e.file), ...Object.values(m.backdrops).map((e) => e.file)];

const ART_CHECKS = [
  ['manifest-valid', (api) => {
    let error = null;
    try { api.validate(api.manifest()); } catch (e) { error = e; }
    assert.equal(error, null, `manifest-valid: ${error?.message}`);
    let refused = false;
    try { api.validate({ ...api.manifest(), arms: { m1842: { ...api.manifest().arms.m1842, file: '../../index.html' } } }); } catch (e) { refused = /invalid file path/.test(e.message); }
    assert.ok(refused, 'manifest-valid: a path outside assets/art must be refused');
  }],
  ['files-exist', (api) => {
    const m = api.manifest(), listed = new Set(fileList(m)), present = new Set(api.files());
    const missing = [...listed].filter((f) => !present.has(f)), stray = [...present].filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], `files-exist: manifest files missing on disk: ${missing.join(', ')}`);
    assert.deepEqual(stray, [], `files-exist: files under assets/art not in the manifest: ${stray.join(', ')}`);
  }],
  ['budgets', (api) => {
    const m = api.manifest(), over = [];
    const webp = (f, test) => { const b = api.read(f), s = webpSize(b); if (!s || !test(s, b.length)) over.push(`${f} ${s ? `${s.width}x${s.height}` : 'not webp'} ${b.length} B`); };
    for (const e of Object.values(m.arms)) if (!e.generic) webp(e.file, (s, n) => s.width <= 900 && n <= 90 * KB);
    for (const e of Object.values(m.portraits)) webp(e.file, (s, n) => s.height === 256 && s.width <= 256 && n <= 25 * KB);
    for (const e of Object.values(m.backdrops)) webp(e.file, (s, n) => s.width <= 1920 && n <= 350 * KB);
    for (const f of [m.generic.arm.file, m.generic.portrait.file]) { const b = api.read(f); if (!/\.svg$/.test(f) || b.length > 8 * KB || !b.toString('utf8').includes('<title>')) over.push(`${f} ${b.length} B`); }
    const title = api.read(m.backdrops.title.file).length + Buffer.byteLength(JSON.stringify(m));
    if (title > 1024 * KB) over.push(`title view ${title} B`);
    assert.deepEqual(over, [], `budgets: over budget: ${over.join('; ')}`);
  }],
  ['licence-credit', (api) => {
    const m = api.manifest(), bad = [];
    const all = [...Object.entries(m.arms), ...Object.entries(m.portraits), ...Object.entries(m.backdrops)];
    for (const [k, e] of all) {
      if (e.generic) continue;
      if (!/^(Public domain|CC0)\b/.test(e.licence || '') || !(e.credit || '').trim() || !/^https:\/\//.test(e.pageUrl || '')) bad.push(k);
      if (/CC BY/i.test(e.licence || '')) bad.push(`${k} (CC BY)`);
    }
    assert.deepEqual(bad, [], `licence-credit: entries without a public-domain or CC0 licence, credit or source page: ${bad.join(', ')}`);
  }],
  ['attribution', (api) => {
    const text = api.attribution(), m = api.manifest();
    assert.ok(/^## Art\b/m.test(text), 'attribution: ATTRIBUTION.md has no "## Art" section');
    const art = text.slice(text.search(/^## Art\b/m));
    const missing = fileList(m).filter((f) => !art.includes(`assets/art/${f}`));
    assert.deepEqual(missing, [], `attribution: files not listed in the Art section: ${missing.join(', ')}`);
  }],
  ['arms-resolve', (api) => {
    const m = api.manifest(), unresolved = [];
    for (const a of api.ARMS) {
      const x = api.armArt(a.id, m);
      if (!x) unresolved.push(a.id);
      else if (x.generic !== (m.arms[a.id].kind === 'generic') || (x.generic && !/^Generic\b/.test(x.caption))) unresolved.push(`${a.id} (unlabelled generic)`);
    }
    for (const u of api.UNIQUES) if (!api.armArt(api.armIdOf(u.id, api.UNIQUES), m)) unresolved.push(u.id);
    assert.deepEqual(unresolved, [], `arms-resolve: arms without art or an unlabelled stand-in: ${unresolved.join(', ')}`);
    const generics = api.ARMS.filter((a) => api.armArt(a.id, m)?.generic).map((a) => a.id);
    assert.deepEqual(generics, ['belgian'], `arms-resolve: only the Belgian rifle-musket may use the generic silhouette (got ${generics.join(', ')})`);
  }],
  ['captions-truthful', (api) => {
    const m = api.manifest(), c = (id) => m.arms[id].caption;
    assert.ok(/Confederacy/.test(c('howitzer12')) && /Tredegar/.test(c('howitzer12')) && !/M1841|US-made/i.test(c('howitzer12')), `captions-truthful: howitzer12 caption "${c('howitzer12')}"`);
    assert.ok(/Parrott rifle/.test(c('parrott10')) && !/10-pounder|10-pdr/i.test(c('parrott10')), `captions-truthful: parrott10 caption "${c('parrott10')}" claims a calibre the source does not state`);
    assert.ok(!/M1841/.test(c('sixPdr')) && /6-pounder/.test(c('sixPdr')), `captions-truthful: sixPdr caption "${c('sixPdr')}"`);
    assert.ok(/used by Abraham Lincoln/.test(c('spencer')), `captions-truthful: spencer caption "${c('spencer')}"`);
    for (const [id, e] of Object.entries(m.arms)) if (!e.generic) assert.ok(e.caption.startsWith('Pictured: '), `captions-truthful: ${id} caption does not say "Pictured:"`);
  }],
  ['portraits-in-packs', (api) => {
    const names = api.commanders(), m = api.manifest();
    const strangers = Object.entries(m.portraits).flatMap(([n, e]) => [n, ...(e.aliases || [])]).filter((n) => !names.has(n));
    assert.deepEqual(strangers, [], `portraits-in-packs: portrait names not in any pack's commander list: ${strangers.join(', ')}`);
  }],
  ['withheld', (api) => {
    const m = api.manifest(), files = new Set(api.files()), leaks = [];
    for (const n of api.doubtful) {
      if (!Object.hasOwn(m.withheld, n)) leaks.push(`${n} not recorded as withheld`);
      if (Object.hasOwn(m.portraits, n) || Object.values(m.portraits).some((e) => (e.aliases || []).includes(n))) leaks.push(`${n} has a portrait entry`);
      if (files.has(`portraits/${slug(n)}.webp`)) leaks.push(`${n} has a portrait file`);
    }
    assert.deepEqual(leaks, [], `withheld: doubtful identities leaked: ${leaks.join('; ')}`);
  }],
  ['exact-names', (api) => {
    const m = api.manifest();
    for (const n of ['John Beatty', 'William H. Gibson', 'R. T. Gibson', 'William T. Sherman', 'Gibson', 'Sherman']) {
      assert.equal(api.portraitArt(n, m), null, `exact-names: ${n} got a portrait of a different man`);
    }
    assert.equal(api.portraitArt('Samuel Beatty', m)?.src, './assets/art/portraits/samuel-beatty.webp', 'exact-names: Samuel Beatty lost his own portrait');
    assert.equal(api.portraitArt('Patton Anderson', m)?.src, './assets/art/portraits/j-patton-anderson.webp', 'exact-names: the alias Patton Anderson (the same man) does not resolve');
  }],
  ['briefing-commanders', (api) => {
    const list = api.briefingCommanders(api.scenario('shiloh', 'camps-at-dawn'), 'US', 6);
    assert.equal(list[0]?.name, 'Everett Peabody', `briefing-commanders: the commander the briefing names comes first (got ${list[0]?.name})`);
    assert.ok(list[0].named && list.length <= 6 && list.slice(1).every((c) => c.side === 'US' || c.named), 'briefing-commanders: then the player side only, at most six');
    assert.equal(new Set(list.map((c) => c.name)).size, list.length, 'briefing-commanders: a commander is listed once');
  }],
  ['camp-commanders', async (api) => {
    const sum = await api.loadPackSummary('chattanooga', { fetcher: api.fetcher });
    const who = sum.phases.find((p) => p.id === 'orchard-knob')?.commanders?.['us-hazen-brigade'];
    assert.deepEqual(who && { ...who }, { name: 'William B. Hazen', rank: 'Brigadier General' }, `camp-commanders: the pack summary does not name Hazen's brigade commander (got ${JSON.stringify(who)})`);
  }],
];

const MUTANTS = {
  'manifest-valid': { validate: (m) => m }, // a validator that checks nothing lets a path escape assets/art
  'files-exist': { files: () => artFiles().filter((f) => !f.startsWith('portraits/everett')) },
  budgets: { read: (f) => (f === 'arms/m1842.webp' ? Buffer.concat([fs.readFileSync(path.join(ART, f)), Buffer.alloc(100 * KB)]) : fs.readFileSync(path.join(ART, f))) },
  'licence-credit': { manifest: () => { const m = readJson('assets/art/manifest.json'); m.arms.ordnance3.licence = 'CC BY 4.0'; return m; } },
  attribution: { attribution: () => fs.readFileSync(path.join(ROOT, 'ATTRIBUTION.md'), 'utf8').replace('assets/art/arms/henry.webp', 'assets/art/arms/henry-gone.webp') },
  'arms-resolve': { armArt: (id, m) => (id === 'whitworth' ? null : art.armArt(id, m)) },
  'captions-truthful': { manifest: () => { const m = readJson('assets/art/manifest.json'); m.arms.howitzer12.caption = 'Pictured: US M1841 12-pounder field howitzer'; return m; } },
  'portraits-in-packs': { manifest: () => { const m = readJson('assets/art/manifest.json'); m.portraits['Ulysses S. Grant'] = { ...m.portraits['Everett Peabody'] }; return m; } },
  withheld: { manifest: () => { const m = readJson('assets/art/manifest.json'); m.portraits['Edward H. Phelps'] = { ...m.portraits['Everett Peabody'] }; return m; } },
  'exact-names': { portraitArt: (n, m) => art.portraitArt(n, m) || Object.entries(m.portraits).filter(([k]) => k.split(' ').pop() === n.split(' ').pop()).map(([k]) => art.portraitArt(k, m))[0] || null },
  'briefing-commanders': { briefingCommanders: (s, side, max) => briefingCommanders(s, side, max).filter((c) => !c.named) },
  'camp-commanders': { loadPackSummary: async (id, o) => { const s = await loadPackSummary(id, o); return { ...s, phases: s.phases.map((p) => ({ ...p, commanders: {} })) }; } },
};

async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function artUnit(api = API) {
  for (const [name, check] of ART_CHECKS) await runCheck(name, check, api);
  return ART_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of ART_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = ART_CHECKS.length;
  if (failed) { console.log(`ART FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`ART OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of ART_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`ART CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`ART CONTROLS OK (${caught}/${n})`);
  }
  process.exit(0);
}

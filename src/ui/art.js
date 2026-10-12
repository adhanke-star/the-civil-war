// src/ui/art.js: the card-art manifest (assets/art/manifest.json, P6b) and its lookups. DESIGN §3 Brigade card ("period
// photograph where a sourced one exists, generic silhouette otherwise") and §4b Card art: v1 shows the real object's museum
// or period photograph, cut out or tight-cropped on a dark mount, instead of a baked 3D render (a P6b decision).
//
//   loadArt({ fetcher? })        -> Promise<manifest|null>: fetched and validated once per page (null when missing or invalid;
//                                   every caller then falls back to the generic silhouettes or no art)
//   artManifest()                -> the loaded manifest or null
//   setArtManifest(m)            -> validate and install a manifest (Node tests)
//   validateArtManifest(m)       -> m, or throws on a bad shape, a path outside assets/art or an entry without licence/credit
//   armArt(armId, m?)            -> { src, caption, credit, licence, pageUrl, kind, generic } or null
//   portraitArt(name, m?)        -> the sourced portrait for exactly this name (or a listed alias of the same man), or null
//   genericPortrait(m?)          -> the generic officer silhouette { src, caption, generic: true } or null
//   backdropArt(key, m?)         -> { src, caption, credit, licence, pageUrl } for 'title' or a pack id, or null
//   armIdOf(itemId, uniques)     -> the real arm behind an item id (a unique game item resolves to its base arm)
//   whenArt(fn)                  -> calls fn(manifest) now if loaded, else once loadArt settles (null on failure). It never
//                                   starts a download itself: each page decides when (the battle HUD and the reward sequence
//                                   at once, the title and camp a moment after they render), so a quick navigation away
//                                   never cancels an image request half-way
// Names match exactly: never a different man of the same surname. Pure lookups do no DOM work, so Node can import this file.

export const ART_BASE = './assets/art/';
const MAX_BYTES = 256 * 1024;
const FILE = /^(arms|portraits|backdrops)\/[A-Za-z0-9][A-Za-z0-9-]{0,80}\.(webp|svg)$/;
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const text = (v, max = 400) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

let manifest = null;
let pending = null;
let settled = false;
const waiting = [];

function bad(why) { throw new Error(`Art manifest: ${why}`); }
function entry(e, label, { needPage = true } = {}) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) bad(`${label} is not an object.`);
  if (!text(e.file, 120) || !FILE.test(e.file)) bad(`${label} has an invalid file path.`);
  for (const k of ['credit', 'licence']) if (!text(e[k])) bad(`${label} has no ${k}.`);
  if (!/^(Public domain|CC0)\b/.test(e.licence)) bad(`${label} licence is not public domain or CC0.`);
  if (needPage) {
    if (!text(e.pageUrl, 600)) bad(`${label} has no pageUrl.`);
    let u; try { u = new URL(e.pageUrl); } catch { bad(`${label} pageUrl is not a URL.`); }
    if (u.protocol !== 'https:') bad(`${label} pageUrl is not https.`);
  }
  if (has(e, 'caption') && !text(e.caption, 400)) bad(`${label} caption is invalid.`);
  if (has(e, 'note') && !text(e.note, 200)) bad(`${label} note is invalid.`);
  if (has(e, 'aliases') && (!Array.isArray(e.aliases) || e.aliases.length > 4 || !e.aliases.every((a) => text(a, 80)))) bad(`${label} aliases are invalid.`);
  return e;
}

/** The manifest, or a thrown Error naming the first problem. */
export function validateArtManifest(m) {
  if (!m || typeof m !== 'object' || m.version !== 1) bad('unknown version.');
  for (const k of ['generic', 'arms', 'portraits', 'backdrops', 'withheld']) if (!m[k] || typeof m[k] !== 'object' || Array.isArray(m[k])) bad(`missing ${k}.`);
  entry(m.generic.arm, 'generic arm', { needPage: false });
  entry(m.generic.portrait, 'generic portrait', { needPage: false });
  for (const [id, e] of Object.entries(m.arms)) {
    if (!/^[A-Za-z0-9]{1,30}$/.test(id)) bad(`arm id ${id} is invalid.`);
    entry(e, `arm ${id}`, { needPage: e.generic !== true });
    if (!text(e.caption)) bad(`arm ${id} has no caption.`);
    if (e.generic === true ? !/^Generic\b/.test(e.caption) : !/^Pictured: /.test(e.caption)) bad(`arm ${id} caption does not say what is pictured.`);
  }
  const names = new Set();
  for (const [name, e] of Object.entries(m.portraits)) {
    if (!text(name, 80)) bad('a portrait name is invalid.');
    entry(e, `portrait ${name}`);
    for (const n of [name, ...(e.aliases || [])]) {
      if (names.has(n)) bad(`portrait name ${n} is listed twice.`);
      if (has(m.withheld, n)) bad(`portrait ${n} was withheld for a doubtful identity.`);
      names.add(n);
    }
  }
  for (const [key, e] of Object.entries(m.backdrops)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key)) bad(`backdrop key ${key} is invalid.`);
    entry(e, `backdrop ${key}`);
    if (!text(e.caption)) bad(`backdrop ${key} has no caption.`);
  }
  for (const [name, why] of Object.entries(m.withheld)) if (!text(name, 80) || !text(why, 600)) bad('a withheld entry is invalid.');
  return m;
}

export function setArtManifest(m) { manifest = m === null ? null : validateArtManifest(m); return manifest; }
export function artManifest() { return manifest; }

/** Fetch and validate the manifest once per page; resolves null (never rejects) when it is missing or invalid. */
export function loadArt({ fetcher = globalThis.fetch } = {}) {
  if (manifest) return Promise.resolve(manifest);
  if (!pending) {
    pending = (async () => {
      let m = null;
      try {
        const r = await fetcher(`${ART_BASE}manifest.json`);
        if (!r.ok) throw new Error('not found');
        const body = await r.text();
        if (body.length > MAX_BYTES) throw new Error('oversized');
        m = setArtManifest(JSON.parse(body));
      } catch (err) {
        console.warn('card art unavailable:', err?.message ?? err);
      }
      settled = true;
      for (const fn of waiting.splice(0)) { try { fn(m); } catch (err) { console.warn('card art:', err?.message ?? err); } }
      return m;
    })();
  }
  return pending;
}
/** fn(manifest) now when the art is loaded, otherwise once loadArt settles (manifest null on failure). */
export function whenArt(fn) {
  if (manifest || settled) { fn(manifest); return; }
  waiting.push(fn);
}

const src = (file) => `${ART_BASE}${file}`;
/** The real arm behind an item id: arms are themselves; a unique game item resolves to its base arm. */
export function armIdOf(itemId, uniques = []) {
  const u = Array.isArray(uniques) ? uniques.find((x) => x && x.id === itemId) : null;
  return u ? u.base : itemId;
}
export function armArt(armId, m = manifest) {
  const e = m && has(m.arms, armId) ? m.arms[armId] : null;
  if (!e) return null;
  return { src: src(e.file), caption: e.caption, credit: e.credit, licence: e.licence, pageUrl: e.pageUrl || '', kind: e.kind || 'mount', generic: e.generic === true };
}
export function portraitArt(name, m = manifest) {
  if (!m || !text(name, 80)) return null;
  if (has(m.withheld, name)) return null;
  let hit = has(m.portraits, name) ? m.portraits[name] : null;
  if (!hit) for (const e of Object.values(m.portraits)) if ((e.aliases || []).includes(name)) { hit = e; break; }
  if (!hit) return null;
  return { src: src(hit.file), name, credit: hit.credit, licence: hit.licence, pageUrl: hit.pageUrl, note: hit.note || '', generic: false };
}
export function genericPortrait(m = manifest) {
  if (!m) return null;
  return { src: src(m.generic.portrait.file), caption: m.generic.portrait.caption, credit: m.generic.portrait.credit, licence: m.generic.portrait.licence, generic: true };
}
export function backdropArt(key, m = manifest) {
  const e = m && has(m.backdrops, key) ? m.backdrops[key] : null;
  return e ? { key, src: src(e.file), caption: e.caption, credit: e.credit, licence: e.licence, pageUrl: e.pageUrl } : null;
}
/** One line naming a portrait for a tooltip or caption: the man, any dating note, the credit. */
export function portraitLine(p) {
  if (!p) return '';
  if (p.generic) return p.caption;
  return `${p.name}${p.note ? ` (${p.note})` : ''}. ${p.credit}; ${p.licence}.`;
}

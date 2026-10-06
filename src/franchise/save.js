// One progress-store seam. P1 stores only a completed reward, never a live battle.
import { ARMS, UNIQUES, VETERANCY, GRADES, CONDITIONS, itemDef } from '../reward/data.js';
import { ratings, canCarry } from '../reward/model.js';

export const SAVE_KEY = 'cw.progress';
export const MAX_SAVE_BYTES = 1024 * 1024;
const knownGear = new Set([...ARMS, ...UNIQUES].map((x) => x.id));
const vets = new Set(VETERANCY.map((x) => x.id));
const conditions = new Set(CONDITIONS.map((x) => x.id));
const bad = (message) => { throw new Error(`Progress: ${message}`); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function shape(o, required, optional = []) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) bad('expected a complete object.');
  if (required.some((k) => !has(o, k)) || Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))) {
    bad('missing or unsupported fields.');
  }
}
function word(v, label, max = 160) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) bad(`invalid ${label}.`);
  return v;
}
function id(v, label) {
  word(v, label, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v)) bad(`invalid ${label}.`);
  return v;
}
function number(v, label, lo, hi) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) bad(`invalid ${label}.`);
  return v;
}
function list(v, label, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max) bad(`incomplete or oversized ${label}.`);
  return v;
}
function item(v) {
  shape(v, ['uid', 'itemId', 'tier', 'conditionId', 'from'], ['source', 'depot']);
  const uid = id(v.uid, 'item identity');
  if (!knownGear.has(v.itemId)) bad('unknown gear.');
  if (v.tier !== itemDef(v.itemId).tier || !conditions.has(v.conditionId)) bad('unknown rarity or condition.');
  const out = { uid, itemId: v.itemId, tier: v.tier, conditionId: v.conditionId, from: word(v.from, 'item origin') };
  if (has(v, 'source')) {
    if (!['issue', 'capture'].includes(v.source)) bad('invalid item source.');
    out.source = v.source;
  }
  if (has(v, 'depot')) {
    if (v.depot !== true) bad('invalid depot flag.');
    out.depot = true;
  }
  return out;
}

/** Strict canonical copy. Imported derived OVR is never trusted; it is recomputed. */
export function validateSnapshot(v) {
  shape(v, ['format', 'version', 'kind', 'awardId', 'army', 'depot', 'issued', 'seed', 'grade']);
  if (v.format !== 'the-civil-war' || v.version !== 1 || v.kind !== 'completed-reward') bad('unsupported save format or version.');
  const awardId = id(v.awardId, 'completed award identity');
  const seed = typeof v.seed === 'string' ? word(v.seed, 'seed', 100) : number(v.seed, 'seed', 0, 0xffffffff);
  if (!GRADES.includes(v.grade)) bad('unknown grade.');
  const brigadeIds = new Set();
  const owners = new Map();
  const add = (it, owner) => {
    if (owners.has(it.uid)) bad('duplicate item identity or ownership.');
    owners.set(it.uid, owner);
    return it;
  };
  const army = list(v.army, 'army', 1, 200).map((b) => {
    shape(b, ['id', 'label', 'kind', 'men', 'vet', 'weapon', 'base'], ['guns', 'ovr']);
    const bid = id(b.id, 'brigade identity');
    if (brigadeIds.has(bid)) bad('duplicate brigade identity.');
    brigadeIds.add(bid);
    if (!['infantry', 'battery'].includes(b.kind) || !vets.has(b.vet)) bad('unknown brigade kind or veterancy.');
    shape(b.base, ['fire', 'melee', 'morale', 'drill']);
    const base = Object.fromEntries(Object.entries(b.base).map(([k, n]) => [k, number(n, `${k} rating`, 1, 99)]));
    const out = { id: bid, label: word(b.label, 'brigade label'), kind: b.kind, men: number(b.men, 'men', 0, 100000), vet: b.vet,
      weapon: add(item(b.weapon), bid), base };
    if (has(b, 'ovr')) number(b.ovr, 'derived OVR', 1, 99);
    if (b.kind === 'battery') out.guns = number(b.guns, 'guns', 0, 200);
    else if (has(b, 'guns')) bad('infantry cannot own guns.');
    if (out.weapon.depot || !canCarry(out, out.weapon)) bad('incompatible equipped gear.');
    out.ovr = ratings(out).ovr;
    return out;
  });
  const depot = list(v.depot, 'depot', 0, 2000).map((it) => add(item(it), null));
  const items = new Map([...army.map((b) => b.weapon), ...depot].map((it) => [it.uid, it]));
  const issued = list(v.issued, 'issued records', 0, 5000).map((r) => {
    shape(r, ['brigade', 'item', 'displaced']);
    if (!brigadeIds.has(r.brigade) || !owners.has(r.item) || !owners.has(r.displaced) || r.item === r.displaced) bad('invalid issued reference.');
    const brigade = army.find((b) => b.id === r.brigade);
    if (!canCarry(brigade, items.get(r.item)) || !canCarry(brigade, items.get(r.displaced))) bad('incompatible issued gear.');
    return { brigade: r.brigade, item: r.item, displaced: r.displaced };
  });
  // Walk the transfers backwards: records must describe this inventory, not reissue it.
  for (const r of [...issued].reverse()) {
    if (owners.get(r.item) !== r.brigade || owners.get(r.displaced) !== null) bad('inconsistent issued records.');
    owners.set(r.item, null);
    owners.set(r.displaced, r.brigade);
  }
  const out = { format: 'the-civil-war', version: 1, kind: 'completed-reward', awardId, army, depot, issued, seed, grade: v.grade };
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_SAVE_BYTES) bad('save exceeds the 1 MB limit.');
  return out;
}

export function completedSnapshot(result) {
  shape(result, ['awardId', 'army', 'depot', 'issued', 'seed', 'grade']);
  return validateSnapshot({ format: 'the-civil-war', version: 1, kind: 'completed-reward', ...result });
}
export function parseSnapshot(text) {
  if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES || new TextEncoder().encode(text).length > MAX_SAVE_BYTES) bad('save exceeds the 1 MB limit.');
  let v;
  try { v = JSON.parse(text); } catch { bad('file is not valid JSON.'); }
  return validateSnapshot(v);
}
export const exportSnapshot = (snapshot) => JSON.stringify(validateSnapshot(snapshot));

/** Lazy storage access can throw (private/blocked windows). setItem is one atomic replacement. */
export function createProgressStore(storage = () => window.localStorage) {
  function access() {
    try {
      const s = typeof storage === 'function' ? storage() : storage;
      if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') throw new Error();
      return s;
    } catch { bad('browser storage is unavailable. Retry or export your completed army.'); }
  }
  function read(s) {
    try { return s.getItem(SAVE_KEY); }
    catch { bad('cannot read browser storage. Retry; existing progress has not been replaced.'); }
  }
  function write(s, snapshot) {
    try { s.setItem(SAVE_KEY, JSON.stringify(snapshot)); }
    catch { bad('could not save. Keep this page open, retry, or export your completed army.'); }
    return snapshot;
  }
  return {
    load() {
      const raw = read(access());
      return raw === null ? null : parseSnapshot(raw);
    },
    complete(result, { previous = null } = {}) {
      const snapshot = result && has(result, 'format') ? validateSnapshot(result) : completedSnapshot(result);
      const s = access(), raw = read(s);
      const current = raw === null ? null : parseSnapshot(raw);
      if (current?.awardId === snapshot.awardId) return { snapshot: current, saved: true, duplicate: true };
      if (JSON.stringify(current) !== JSON.stringify(previous)) bad('progress changed since this demo started. Export this result before replacing the saved army.');
      return { snapshot: write(s, snapshot), saved: true, duplicate: false };
    },
    import(text) {
      const snapshot = parseSnapshot(text); // no storage mutation before full validation
      const s = access();
      read(s); // fail safely when access is blocked; an explicit import may repair corrupt JSON
      return write(s, snapshot);
    },
  };
}

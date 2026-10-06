// One progress-store seam. P1 stores only a completed reward, never a live battle.
import { ARMS, PRACTICE_ARMS, UNIQUES, VETERANCY, GRADES, CONDITIONS, itemDef } from '../reward/data.js';
import { ratings, canCarry, equip } from '../reward/model.js';

export const SAVE_KEY = 'cw.progress';
export const PROGRESS_DB = 'cw.progress';
export const PROGRESS_OBJECT_STORE = 'progress';
export const MAX_SAVE_BYTES = 1024 * 1024;
const knownGear = new Set([...ARMS, ...PRACTICE_ARMS, ...UNIQUES].map((x) => x.id));
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

/** One pure exchange. Identities, inventory cardinality and reverse transfer audit remain intact. */
export function exchangeDepot(snapshot, command) {
  const before = validateSnapshot(snapshot);
  shape(command, ['brigadeId', 'itemUid']);
  const brigadeId = id(command.brigadeId, 'brigade identity'), itemUid = id(command.itemUid, 'item identity');
  const brigade = before.army.find((b) => b.id === brigadeId), selected = before.depot.find((it) => it.uid === itemUid);
  if (!brigade || !selected) bad('selected brigade or depot item is no longer available.');
  if (brigade.men === 0 || (brigade.kind === 'battery' && brigade.guns === 0)) bad('depleted formations cannot receive new gear.');
  if (!canCarry(brigade, selected)) bad('selected gear is incompatible with this formation.');
  const next = equip(brigade, selected);
  return validateSnapshot({ ...before,
    army: before.army.map((b) => b.id === brigadeId ? next.brigade : b),
    depot: [...before.depot.filter((it) => it.uid !== itemUid), next.displaced],
    issued: [...before.issued, { brigade: brigadeId, item: itemUid, displaced: next.displaced.uid }],
  });
}

// IndexedDB owns both serialization and visibility. Web Locks cannot refresh another tab's
// localStorage cache; the retained native lost-update trace is DECISIONS0036.
function openProgressDatabase() {
  return new Promise((resolve, reject) => {
    let request, settled = false;
    const unavailable = () => {
      if (settled) return;
      settled = true; reject(new Error('Progress: browser progress database is unavailable. Retry or export your army.'));
    };
    try { request = globalThis.indexedDB.open(PROGRESS_DB, 1); }
    catch { unavailable(); return; }
    request.onupgradeneeded = () => {
      try { if (!request.result.objectStoreNames.contains(PROGRESS_OBJECT_STORE)) request.result.createObjectStore(PROGRESS_OBJECT_STORE); }
      catch { request.transaction.abort(); unavailable(); }
    };
    request.onerror = unavailable;
    request.onblocked = unavailable;
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true; db.onversionchange = () => db.close(); resolve(db);
    };
  });
}
async function databaseTransaction(operation, mode) {
  const db = await openProgressDatabase();
  return new Promise((resolve, reject) => {
    let transaction, answer, failure;
    const fail = (message) => new Error(`Progress: ${message} Retry or export your army.`);
    try {
      transaction = db.transaction(PROGRESS_OBJECT_STORE, mode);
      transaction.oncomplete = () => { db.close(); resolve(answer); };
      transaction.onabort = () => { db.close(); reject(failure || fail('could not save; the progress transaction was aborted.')); };
      const table = transaction.objectStore(PROGRESS_OBJECT_STORE), request = table.get(SAVE_KEY), presence = table.count(SAVE_KEY);
      request.onerror = () => { failure = fail('cannot read browser progress.'); };
      presence.onerror = () => { failure = fail('cannot read browser progress.'); };
      presence.onsuccess = () => {
        try {
          // Legacy bytes are a bootstrap source only. Never overwrite/delete them or consult them
          // after a committed database record exists. Failed first writes leave bootstrap intact.
          let raw = request.result;
          if (presence.result === 0) {
            try { raw = globalThis.localStorage.getItem(SAVE_KEY); }
            catch { bad('cannot read browser storage. Retry; existing progress has not been replaced.'); }
          } else if (typeof raw !== 'string') bad('unsupported browser progress record.');
          if (raw !== null && typeof raw !== 'string') bad('unsupported browser progress record.');
          answer = operation({
            getItem() { return raw; },
            setItem(key, value) {
              const write = table.put(value, SAVE_KEY);
              write.onerror = () => { failure = fail('could not save.'); };
              raw = value;
            },
          });
        } catch (err) { failure = err; transaction.abort(); }
      };
    } catch {
      if (transaction) { failure = fail('cannot read browser progress.'); transaction.abort(); }
      else { db.close(); reject(fail('cannot open a progress transaction.')); }
    }
  });
}

/** One authority. Explicit memory storage + serial locks are a Node-only test adapter. */
export function createProgressStore(storage, { locks } = {}) {
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
  async function locked(operation) {
    if (storage === undefined) return databaseTransaction(operation, 'readwrite');
    let manager;
    try { manager = typeof locks === 'function' ? locks() : locks; }
    catch { bad('coordinated saving is unavailable. Retry or export your army.'); }
    if (!manager || typeof manager.request !== 'function') bad('coordinated saving is unavailable. Retry or export your army.');
    try { return await manager.request(SAVE_KEY, { mode: 'exclusive' }, () => operation(access())); }
    catch (err) {
      if (err?.message?.startsWith('Progress:')) throw err;
      bad('could not coordinate saving. Retry or export your army.');
    }
  }
  const reading = (operation) => storage === undefined ? databaseTransaction(operation, 'readonly') : Promise.resolve().then(() => operation(access()));
  return {
    async readRawBaseline() { return reading((s) => read(s)); },
    async load() {
      return reading((s) => { const raw = read(s); return raw === null ? null : parseSnapshot(raw); });
    },
    async complete(result, { previous = null } = {}) {
      // Canonical copies are made before waiting; caller mutation cannot change a queued command.
      const snapshot = result && has(result, 'format') ? validateSnapshot(result) : completedSnapshot(result);
      const baseline = previous === null ? null : validateSnapshot(previous);
      return locked((s) => {
        const raw = read(s), current = raw === null ? null : parseSnapshot(raw);
        if (current?.awardId === snapshot.awardId) return { snapshot: current, saved: true, duplicate: true };
        if (JSON.stringify(current) !== JSON.stringify(baseline)) bad('progress changed since this demo started. Export this result before replacing the saved army.');
        return { snapshot: write(s, snapshot), saved: true, duplicate: false };
      });
    },
    async import(text, { previousRaw } = {}) {
      const snapshot = parseSnapshot(text);
      if (previousRaw !== null && typeof previousRaw !== 'string') bad('import requires an observed storage baseline.');
      return locked((s) => {
        // No parsing of old bytes: explicit imports can repair unchanged corrupt progress.
        if (read(s) !== previousRaw) bad('progress changed since this import was reviewed. Export the pending file or choose it again.');
        return write(s, snapshot);
      });
    },
    async issue(command, { previous } = {}) {
      const baseline = validateSnapshot(previous), draft = exchangeDepot(baseline, command);
      return locked((s) => {
        const raw = read(s), current = raw === null ? null : parseSnapshot(raw);
        if (JSON.stringify(current) !== JSON.stringify(baseline)) bad('progress changed since this equipment was reviewed. Export the pending army or reload saved progress.');
        return write(s, draft);
      });
    },
  };
}

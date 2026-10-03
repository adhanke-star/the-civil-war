// src/settings.js: the single registry of tunable choices (the sandbox reads it; renderers and rules obey it).
//
// A module that has something Aaron may tune calls define() once and listens with on():
//   const scale = define('look.figureScale', { tab: 'Look', label: 'Figure size', type: 'range', default: 1,
//     min: 0.5, max: 2, step: 0.05, note: 'Draws soldiers larger or smaller; larger costs a little fill rate.' });
//   on('look.figureScale', (v) => figures.setScale(v));
//
// spec: { tab: 'Units'|'Rules'|'Look'|'Moments'|'Screens', label, note (one plain sentence: what it does, its cost),
//         type: 'toggle'|'choice'|'range'|'action', default, options?: [{ value, label }] (choice),
//         min?, max?, step? (range), run?: () => void (action: a button with no stored value),
//         compare?: true (a choice that may be shown split-screen, see src/sandbox/compare.js) }
//
// Values persist in localStorage 'cw.settings' (only those that differ from the default) and locks in
// 'cw.locks'. Storage may be missing (Node, private windows): everything still works for the visit.
// No DOM and no dependencies, so Node can import this file for unit tests.

export const TABS = ['Units', 'Rules', 'Look', 'Moments', 'Screens'];
export const TYPES = ['toggle', 'choice', 'range', 'action'];
const STORE_KEY = 'cw.settings';
const LOCK_KEY = 'cw.locks';
const KEY_RE = /^[A-Za-z][\w.-]*$/;

const entries = new Map(); // key -> { spec, value }  (Map keeps definition order)
const listeners = new Map(); // key or '*' -> Set<fn>
const watchers = new Set(); // fn(event, key): 'define' | 'lock' | 'unlock'

function storage() {
  try {
    if (typeof window === 'undefined') return null; // Node: no window, no storage (and no Node localStorage warning)
    const s = window.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null; // storage blocked
  }
}
function loadJSON(key, fallback) {
  try {
    const s = storage();
    const raw = s ? s.getItem(key) : null;
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    const s = storage();
    if (s) s.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the choice simply is not remembered
  }
}

// Stored values for keys not defined yet are kept, so a module that defines its setting later still gets it.
const stored = (() => { const v = loadJSON(STORE_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
const locks = new Set((() => { const v = loadJSON(LOCK_KEY, []); return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []; })());

function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
}

/** The value a spec accepts for v, or undefined if v is not acceptable. Strings are coerced (for importText). */
function validate(spec, v) {
  switch (spec.type) {
    case 'toggle':
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 1 || v === '1') return true;
      if (v === 'false' || v === 0 || v === '0') return false;
      return undefined;
    case 'choice': {
      const hit = spec.options.find((o) => String(o.value) === String(v));
      return hit ? hit.value : undefined;
    }
    case 'range': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return undefined;
      let x = Math.min(spec.max, Math.max(spec.min, n));
      if (spec.step > 0) {
        x = spec.min + Math.round((x - spec.min) / spec.step) * spec.step;
        x = Number(x.toFixed(decimals(spec.step)));
        x = Math.min(spec.max, Math.max(spec.min, x));
      }
      return x;
    }
    default:
      return undefined; // actions hold no value
  }
}

function checkSpec(key, spec) {
  const bad = (why) => { throw new Error(`settings.define('${key}'): ${why}`); };
  if (typeof key !== 'string' || !KEY_RE.test(key)) bad('the key must be a word like "look.figureScale"');
  if (!spec || typeof spec !== 'object') bad('a spec object is required');
  if (!TABS.includes(spec.tab)) bad(`tab must be one of ${TABS.join(', ')}`);
  if (!TYPES.includes(spec.type)) bad(`type must be one of ${TYPES.join(', ')}`);
  if (typeof spec.label !== 'string' || !spec.label) bad('a label is required');
  if (spec.type === 'choice' && (!Array.isArray(spec.options) || spec.options.length < 2)) bad('a choice needs at least two options');
  if (spec.type === 'range' && !(Number.isFinite(spec.min) && Number.isFinite(spec.max) && spec.max > spec.min)) bad('a range needs numeric min < max');
  if (spec.type === 'action' && typeof spec.run !== 'function') bad('an action needs a run() function');
  if (spec.type !== 'action' && validate(spec, spec.default) === undefined) bad(`the default ${JSON.stringify(spec.default)} is not a valid value`);
}

function emit(key, value) {
  for (const k of [key, '*']) {
    const set = listeners.get(k);
    if (!set) continue;
    for (const fn of [...set]) {
      try {
        fn(value, key);
      } catch (err) {
        console.error(`settings: a listener for '${key}' failed:`, err); // other listeners still run
      }
    }
  }
}
function tell(event, key) {
  for (const fn of [...watchers]) {
    try {
      fn(event, key);
    } catch (err) {
      console.error(`settings: a watcher failed on ${event} '${key}':`, err);
    }
  }
}
function persistValue(key, e) {
  if (e.spec.type === 'action') return;
  if (e.value === e.spec.default) delete stored[key];
  else stored[key] = e.value;
  saveJSON(STORE_KEY, stored);
}
function apply(key, value, force) {
  const e = entries.get(key);
  if (!e || e.spec.type === 'action') return undefined;
  if (!force && locks.has(key)) return e.value; // "Lock this": Aaron's pick is final
  const v = validate(e.spec, value);
  if (v === undefined) return e.value; // not acceptable: keep the current value
  if (v === e.value) return v;
  e.value = v;
  persistValue(key, e);
  emit(key, v);
  return v;
}

/** Register one setting and return its current value. Idempotent: a second define of a key keeps the first spec. */
export function define(key, spec) {
  const had = entries.get(key);
  if (had) return had.value;
  checkSpec(key, spec);
  const s = { ...spec };
  if (s.type === 'range') {
    if (!(s.step > 0)) s.step = 0;
    s.default = validate(s, s.default);
  }
  let value;
  if (s.type !== 'action') {
    value = Object.prototype.hasOwnProperty.call(stored, key) ? validate(s, stored[key]) : undefined;
    if (value === undefined) value = s.default;
  }
  entries.set(key, { spec: s, value });
  tell('define', key);
  return value;
}

/** Current value of a setting (undefined for unknown keys and actions). */
export function get(key) {
  const e = entries.get(key);
  return e ? e.value : undefined;
}

/** Validate (clamp ranges, reject unknown choices), persist and notify. Locked settings do not change. Returns the value now held. */
export function set(key, value) {
  return apply(key, value, false);
}

/** Back to spec.default (unless locked). */
export function reset(key) {
  const e = entries.get(key);
  return e ? apply(key, e.spec.default, false) : undefined;
}

/** fn(value, key) on each change of key ('*' = any key). Returns an unsubscribe function. */
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => { listeners.get(key)?.delete(fn); };
}

/** fn(event, key) when the registry itself changes: 'define' (a new setting), 'lock', 'unlock'. Returns an unsubscribe function. */
export function watch(fn) {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

/** [{ key, spec, value, locked }] in definition order. */
export function all() {
  return [...entries].map(([key, e]) => ({ key, spec: e.spec, value: e.value, locked: locks.has(key) }));
}

export function lock(key) {
  if (locks.has(key)) return;
  locks.add(key);
  saveJSON(LOCK_KEY, [...locks]);
  tell('lock', key);
}
export function unlock(key) {
  if (!locks.has(key)) return;
  locks.delete(key);
  saveJSON(LOCK_KEY, [...locks]);
  tell('unlock', key);
}
export function isLocked(key) {
  return locks.has(key);
}

/** A short name for this device from the user agent, e.g. "iPad (Safari)", "Mac (Chrome)". */
export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0) {
  if (!ua || /^Node\.js\b/.test(ua)) return 'Node'; // Node 21+ has a navigator of its own
  let os = 'Unknown device';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) os = 'iPad'; // iPadOS Safari reports itself as a Mac
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'Chromebook';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/HeadlessChrome/.test(ua)) browser = 'Headless Chrome';
  else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return browser ? `${os} (${browser})` : os;
}

/** Text block Aaron pastes back: a header, one `key = value` line per setting that differs from its default, a `locked:` line. */
export function exportText() {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# The Civil War settings · ${date} · ${deviceName()}`];
  for (const [key, e] of entries) {
    if (e.spec.type === 'action' || e.value === e.spec.default) continue;
    lines.push(`${key} = ${e.value}`);
  }
  const locked = [...entries.keys()].filter((k) => locks.has(k));
  lines.push(`locked: ${locked.length ? locked.join(', ') : 'none'}`);
  return lines.join('\n');
}

/** Inverse of exportText(): applies each known `key = value` line (locks do not block a pasted block) and,
 *  if a `locked:` line is present, makes exactly those known settings locked. Unknown keys and other lines are
 *  ignored. Returns how many values were applied. */
export function importText(text) {
  let count = 0;
  let lockLine = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const lm = /^locked\s*:\s*(.*)$/i.exec(line);
    if (lm) { lockLine = lm[1]; continue; }
    const m = /^([A-Za-z][\w.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const e = entries.get(m[1]);
    if (!e || e.spec.type === 'action') continue; // unknown key: ignored
    if (validate(e.spec, m[2].trim()) === undefined) continue;
    apply(m[1], m[2].trim(), true);
    count++;
  }
  if (lockLine !== null) {
    const want = new Set(lockLine.split(',').map((s) => s.trim()).filter((s) => entries.has(s)));
    for (const key of entries.keys()) {
      if (entries.get(key).spec.type === 'action') continue;
      if (want.has(key)) lock(key);
      else unlock(key);
    }
  }
  return count;
}

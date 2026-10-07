// Storage-free phase snapshots. No launch, reward, history-verification or GPU admission authority.
import { equipmentProfile } from './equipment.js';

export const PHASE_LIMITS = Object.freeze({ bytes: 1024 * 1024, depth: 32 });
const fail = message => { throw new Error('Phase: ' + message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();

// Inspect data descriptors, never invoke authored getters or toJSON. Clone all metadata as JSON data.
function snapshot(input) {
  const ancestors = new Set(); let bytes = 0;
  const add = n => { bytes += n; if (bytes > PHASE_LIMITS.bytes) fail('pack exceeds the structural byte limit.'); };
  const stringBytes = value => {
    if (value.length > PHASE_LIMITS.bytes) fail('pack exceeds the structural byte limit.');
    return encoder.encode(JSON.stringify(value)).length;
  };
  const clone = (value, depth) => {
    if (depth > PHASE_LIMITS.depth) fail('pack exceeds the structural depth limit.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || finite(value)) {
      add(typeof value === 'string' ? stringBytes(value) : JSON.stringify(value).length);
      return value;
    }
    if (!value || typeof value !== 'object') fail('pack must contain only finite JSON data.');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('inherited or non-JSON data is unsupported.');
    if (ancestors.has(value)) fail('cyclic data is unsupported.');
    ancestors.add(value);
    const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => typeof key !== 'string')) fail('symbol data is unsupported.');
    const dataKeys = array ? keys.filter(key => key !== 'length') : keys;
    if (array && (dataKeys.length !== value.length || dataKeys.some((key, i) => key !== String(i)))) fail('sparse or extended arrays are unsupported.');
    add(2 + Math.max(0, dataKeys.length - 1));
    const result = array ? [] : {};
    for (const key of dataKeys) {
      const d = descriptors[key];
      if (!d.enumerable || !own(d, 'value')) fail('accessors and hidden data are unsupported.');
      if (!array) add(stringBytes(key) + 1);
      Object.defineProperty(result, key, { value: clone(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value);
    return Object.freeze(result);
  };
  return clone(input, 0);
}

function shape(value, keys, label) {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !own(value, key))) fail(label + ' has unsupported fields.');
}
function clock(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) fail('clock needs HH:MM.');
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) fail('clock is outside a day.');
  return hour * 60 + minute;
}
function scenario(value) {
  if (!record(value) || !['id', 'title', 'battle', 'date'].every(key => text(value[key]))) fail('scenario needs its identity, title, battle and date.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) fail('date needs YYYY-MM-DD.');
  const date = new Date(value.date + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) fail('date is invalid.');
  if (clock(value.end) <= clock(value.start)) fail('scenario needs a positive same-day clock window.');
  if (!Array.isArray(value.units) || !value.units.length) fail('scenario needs a roster.');
  const ids = new Set();
  for (const unit of value.units) {
    if (!record(unit) || !text(unit.id) || !text(unit.name) || ids.has(unit.id)) fail('unit identities must be nonempty and unique within the phase.');
    ids.add(unit.id);
    if (!['US', 'CS'].includes(unit.side) || (own(unit, 'type') && !['infantry', 'artillery'].includes(unit.type))) fail('unit side or current runtime type is unsupported.');
    if (own(unit, 'weapon') && !(unit.type === 'artillery' ? ['parrott', 'napoleon', 'smbart'] : ['smooth', 'rifled']).includes(unit.weapon)) fail('generic weapon is unsupported for this unit type.');
    if (!['x', 'z', 'facing', 'men'].every(key => finite(unit[key])) || unit.men <= 0) fail('unit geometry and positive strength must be finite.');
    if (own(unit, 'guns') && (!Number.isInteger(unit.guns) || unit.guns < 0)) fail('gun count must be a nonnegative integer.');
    if (own(unit, 'equipment')) {
      try { equipmentProfile(unit.equipment, unit.type || 'infantry'); }
      catch (error) { fail('unit equipment is invalid: ' + error.message); }
    }
  }
  const objective = value.objective;
  if (!record(objective) || !text(objective.name) || !['x', 'z', 'r'].every(key => finite(objective[key])) || objective.r <= 0) fail('objective geometry is invalid.');
  if (own(value, 'opening')) {
    if (!Array.isArray(value.opening)) fail('opening must be an array.');
    const ordered = new Set();
    for (const order of value.opening) {
      if (!record(order) || !ids.has(order.id) || ordered.has(order.id) || !Array.isArray(order.points) || order.points.length < 2
        || !order.points.every(point => Array.isArray(point) && point.length === 2 && point.every(finite))
        || (own(order, 'endFacing') && !finite(order.endFacing))) fail('opening has a duplicate or missing formation, or invalid path.');
      ordered.add(order.id);
    }
  }
}

/** Validate every phase before returning one detached, deeply immutable scenario snapshot. */
export function preparePhase(input, phaseId) {
  const pack = snapshot(input);
  shape(pack, ['version', 'id', 'title', 'phases'], 'pack');
  if (pack.version !== 1 || !text(pack.id) || !text(pack.title) || !Array.isArray(pack.phases) || !pack.phases.length) fail('pack identity, version or phases are invalid.');
  const ids = new Set();
  for (const phase of pack.phases) {
    shape(phase, ['id', 'scenario'], 'phase');
    if (!text(phase.id) || ids.has(phase.id)) fail('phase identities must be nonempty and unique.');
    ids.add(phase.id);
    scenario(phase.scenario);
  }
  const index = pack.phases.findIndex(phase => phase.id === phaseId);
  if (!text(phaseId) || index === -1) fail('requested phase is absent.');
  return Object.freeze({ packId: pack.id, phaseId, index, previousId: pack.phases[index - 1]?.id ?? null,
    nextId: pack.phases[index + 1]?.id ?? null, scenario: pack.phases[index].scenario });
}

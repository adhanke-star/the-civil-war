// Optional field equipment. Reuse the reward catalogue; never persist derived combat values.
// Rarity/power/condition are game choices, and named unique specials remain P5 work.
import { ARMS, PRACTICE_ARMS, UNIQUES, CONDITIONS, CONDITION_BY_ID, itemDef } from '../reward/data.js';
import { TUNING } from '../reward/model.js';
import { CLOCK_RATIO } from './combat.js';

const gearIds = new Set([...ARMS, ...PRACTICE_ARMS, ...UNIQUES].map((d) => d.id));
const conditionIds = new Set(CONDITIONS.map((c) => c.id));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bad = (why) => { throw new Error(`Equipment: ${why}`); };
function text(v, label, max, identity = false) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)
    || (identity && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v))) bad(`invalid ${label}.`);
}
function number(v, label, lo, hi) {
  if (!Number.isFinite(v) || v < lo || v > hi) bad(`invalid ${label}.`);
  return v;
}
function frozenCopy(v) {
  if (v === null || typeof v !== 'object') return v;
  const copy = Array.isArray(v) ? v.map(frozenCopy) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, frozenCopy(x)]));
  return Object.freeze(copy);
}

/** A supplied instance must already be equipped, with exactly the saved-item identity shape. */
export function equipmentProfile(item, type) {
  if (!['infantry', 'artillery'].includes(type)) bad('unsupported supplied unit type.');
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) bad('expected an equipped item.');
  const required = ['uid', 'itemId', 'tier', 'conditionId', 'from'];
  const allowed = [...required, 'source', 'depot'];
  if (required.some((k) => !has(item, k)) || Reflect.ownKeys(item).some((k) => !allowed.includes(k))
    || Object.values(Object.getOwnPropertyDescriptors(item)).some((d) => !has(d, 'value'))) bad('missing or unsupported item fields.');
  text(item.uid, 'item identity', 100, true);
  text(item.from, 'item origin', 160);
  // Check Sets before the catalogue's ordinary-object lookups (constructor/toString/__proto__).
  if (!gearIds.has(item.itemId)) bad('unknown gear.');
  if (!conditionIds.has(item.conditionId)) bad('unknown condition.');
  const definition = itemDef(item.itemId), condition = CONDITION_BY_ID[item.conditionId];
  if (item.tier !== definition.tier) bad('incompatible rarity.');
  if (has(item, 'source') && !['issue', 'capture'].includes(item.source)) bad('invalid item source.');
  if (has(item, 'depot')) bad('depot items must be issued before deployment.');
  // Field artillery corresponds to reward's battery/gun compatibility, not infantry.
  if (definition.arm !== type) bad('incompatible gear for this unit.');
  const rangeYards = number(definition.range?.v, 'range', Number.MIN_VALUE, Number.MAX_VALUE);
  const rpm = number(definition.rate?.v, 'rate of fire', Number.MIN_VALUE, Number.MAX_VALUE);
  const power = number(definition.power?.v, 'power', 0, 99);
  const accuracy = number(definition.accuracy?.v, 'accuracy', 0, 100);
  const mult = number(condition.mult, 'condition multiplier', Number.MIN_VALUE, Number.MAX_VALUE);
  const tuning = TUNING.namedFire;
  const powerReference = number(tuning.powerReference[type], 'power reference', 1, 99);
  const accuracyReference = number(tuning.accuracyReference, 'accuracy reference', 1, 100);
  const basePower = number(tuning.basePower[type], 'base power', 0, 10);
  const rangeMetres = rangeYards * 0.9144;
  const reloadSeconds = 60 / (rpm * CLOCK_RATIO);
  const powerMultiplier = basePower * (power / powerReference) * (accuracy / accuracyReference) * mult;
  for (const [label, v] of Object.entries({ rangeMetres, reloadSeconds, powerMultiplier })) {
    number(v, label, label === 'powerMultiplier' ? 0 : Number.MIN_VALUE, Number.MAX_VALUE);
  }
  return frozenCopy({ item, definition, condition, rangeMetres, reloadSeconds, powerMultiplier,
    provenance: { range: definition.range.src, rate: definition.rate.src, accuracy: definition.accuracy.src,
      power: definition.power.src, calibration: 'game choice', gameItem: definition.gameItem === true,
      gameModifier: condition.gameModifier === true, specialsImplemented: false } });
}

// Storage-free phase snapshots. No launch, reward, history-verification or GPU admission authority.
import { equipmentProfile } from './equipment.js';
import { DEPLOYMENT_LIMITS } from '../franchise/practice.js';
import { FieldCaptures } from '../franchise/captures.js';
import { VETERANCY } from '../reward/data.js';
import { CLOCK_RATIO } from './combat.js';

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
  if ('batteryOverrun' in value && !own(value, 'batteryOverrun')) fail('battery overrun activation must be own data.');
  if (own(value, 'batteryOverrun') && typeof value.batteryOverrun !== 'boolean') fail('battery overrun activation must be boolean.');
  if (own(value, 'batteryOverrun') && value.batteryOverrun === true && (!own(value, 'surrender') || value.surrender !== true)) fail('battery overrun needs true surrender activation.');
  if (own(value, 'surrender') && typeof value.surrender !== 'boolean') fail('surrender activation must be boolean.');
  if (value.surrender === true && value.units.some(unit => !text(unit?.id) || [...unit.id].length > FIELD_LIMITS.labelText)) fail('surrender source identity exceeds current text bounds.');
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

// Current Henry-ground input bounds, not hardware admission for future battle packs.
export const FIELD_LIMITS = Object.freeze({ formations: DEPLOYMENT_LIMITS.formations * 2,
  men: DEPLOYMENT_LIMITS.men * 2, guns: DEPLOYMENT_LIMITS.guns * 2, figures: DEPLOYMENT_LIMITS.figures * 2,
  sites: 64, buildings: 256, trees: 4096, woods: 128, vertices: 4096, polygon: 1024, labels: 64,
  labelText: 160, coordinate: 10000, dimension: 1000 });
const fieldFail = message => { throw new Error('Field: ' + message); };
const coordinate = value => finite(value) && Math.abs(value) <= FIELD_LIMITS.coordinate;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const styles = new Set(['frame-house', 'stone-house', 'log-house', 'barn', 'shed']);

/** Router-selected current field. Retain saved manifests' original scenario after validation. */
export function prepareFieldScenario(input, routeId) {
  const value = preparePhase({ version: 1, id: 'current-field', title: 'Current field',
    phases: [{ id: 'field', scenario: input }] }, 'field').scenario;
  if (!['henry-hill', 'first-command', 'saved-practice'].includes(routeId) || value.id !== routeId
    || (own(value, 'practiceIntro') && typeof value.practiceIntro !== 'boolean')
    || (own(value, 'savedPractice') && typeof value.savedPractice !== 'boolean')
    || (routeId === 'henry-hill' && (value.practiceIntro || value.savedPractice))
    || (routeId === 'first-command' && (value.practiceIntro !== true || value.savedPractice))
    || (routeId === 'saved-practice' && (value.practiceIntro !== true || value.savedPractice !== true))) fieldFail('the definition does not match the selected route.');
  if (!Array.isArray(value.sites) || value.sites.length > FIELD_LIMITS.sites
    || !Array.isArray(value.woods) || value.woods.length > FIELD_LIMITS.woods) fieldFail('current ground needs bounded sites and woods.');
  let buildings = 0, trees = 0, vertices = 0;
  for (const site of value.sites) {
    if (!record(site) || !coordinate(site.x) || !coordinate(site.z)
      || (own(site, 'rot') && !finite(site.rot))
      || ['yard', 'fenceRadius'].some(key => own(site, key) && (!coordinate(site[key]) || site[key] < 0))
      || (own(site, 'embowered') && typeof site.embowered !== 'boolean')) fieldFail('site geometry is invalid.');
    if (own(site, 'buildings')) {
      if (!Array.isArray(site.buildings) || (buildings += site.buildings.length) > FIELD_LIMITS.buildings) fieldFail('building count is invalid.');
      for (const b of site.buildings) if (!Array.isArray(b) || b.length !== 7 || !b.slice(0, 6).every(finite)
        || !b.slice(0, 2).every(coordinate) || !b.slice(2, 5).every(n => n > 0 && n <= FIELD_LIMITS.dimension)
        || !styles.has(b[6])) fieldFail('building geometry or style is unsupported.');
    }
    if (own(site, 'orchard')) {
      const o = site.orchard;
      if (!Array.isArray(o) || o.length !== 5 || !o.every(finite) || !o.slice(0, 2).every(coordinate)
        || !o.slice(2, 4).every(n => integer(n) && n <= FIELD_LIMITS.trees)
        || (trees += o[2] * o[3]) > FIELD_LIMITS.trees) fieldFail('orchard geometry or count is invalid.');
    }
  }
  for (const wood of value.woods) if (!record(wood) || !Array.isArray(wood.polygon)
    || wood.polygon.length < 3 || wood.polygon.length > FIELD_LIMITS.polygon
    || (vertices += wood.polygon.length) > FIELD_LIMITS.vertices
    || !wood.polygon.every(p => Array.isArray(p) && p.length === 2 && p.every(coordinate))) fieldFail('wood polygon is invalid.');
  if (own(value, 'labels')) {
    if (!Array.isArray(value.labels) || value.labels.length > FIELD_LIMITS.labels) fieldFail('label count is invalid.');
    for (const label of value.labels) if (!record(label) || !text(label.text) || [...label.text].length > FIELD_LIMITS.labelText
      || !coordinate(label.x) || !coordinate(label.z)
      || (own(label, 'height') && (!finite(label.height) || label.height < 1 || label.height > FIELD_LIMITS.dimension))
      || (own(label, 'angle') && !finite(label.angle))
      || (own(label, 'italic') && typeof label.italic !== 'boolean')) fieldFail('label geometry or text is invalid.');
  }
  if (own(value, 'ai') && (!record(value.ai) || (own(value.ai, 'chargeReach') && (!finite(value.ai.chargeReach) || value.ai.chargeReach <= 0)))) fieldFail('AI definition is invalid.');
  if (own(value, 'crates')) new FieldCaptures(value.crates);
  // Validate the initial-only opening before checking the complete future roster.
  if ('reinforcements' in value) timelineRows(value);
  const roster = [...value.units, ...(value.reinforcements || [])];
  let men = 0, guns = 0, figures = 0;
  for (const unit of roster) {
    if (!Number.isSafeInteger(unit.men) || unit.men <= 0 || (own(unit, 'guns') && !integer(unit.guns))
      || !coordinate(unit.x) || !coordinate(unit.z)
      || (own(unit, 'xp') && (!Number.isInteger(unit.xp) || unit.xp < 1 || unit.xp > VETERANCY.length))
      || (own(unit, 'morale') && (!finite(unit.morale) || unit.morale < 0 || unit.morale > 100))
      || ['short', 'parent', 'notes', 'status'].some(key => own(unit, key) && typeof unit[key] !== 'string')
      || (own(unit, 'regiments') && (!Array.isArray(unit.regiments) || !unit.regiments.every(r => typeof r === 'string')))
      || (own(unit, 'commander') && unit.commander !== null && (!record(unit.commander) || !text(unit.commander.name)
        || ['rank', 'portrait', 'portraitNote'].some(key => own(unit.commander, key) && typeof unit.commander[key] !== 'string')))) fieldFail('formation numbers or metadata are invalid.');
    men += unit.men; guns += unit.guns || 0;
    figures += Math.max(1, Math.round(unit.men / (unit.type === 'artillery' ? 4 : 5))) + 6;
  }
  if (roster.length > FIELD_LIMITS.formations || men > FIELD_LIMITS.men || guns > FIELD_LIMITS.guns || figures > FIELD_LIMITS.figures) fieldFail('the whole current field exceeds its input bounds.');
  if (!coordinate(value.objective.x) || !coordinate(value.objective.z) || value.objective.r > FIELD_LIMITS.coordinate
    || value.opening?.some(o => o.points.some(p => !p.every(coordinate)))) fieldFail('objective or opening is outside current ground bounds.');
  return value;
}

/** Bound the downloaded body before parsing; a pending read retains its caller's ownership. */
export async function loadFieldScenario({ isCurrent = () => true, fetcher = globalThis.fetch } = {}) {
  const current = () => { if (!isCurrent()) fieldFail('the field launch was cancelled.'); };
  current();
  const response = await fetcher('./assets/scenarios/henry-hill.json', { keepalive: true });
  let reader;
  try {
    current();
    if (!response.ok) fieldFail('the ground description could not be loaded.');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > PHASE_LIMITS.bytes)) fieldFail('the ground description exceeds its download bound.');
    if (!response.body) fieldFail('the ground description is empty.');
    // Finish the bounded guard before native consumption can allocate the complete body.
    // The original tee branch queues only the bytes consumed by this guard.
    reader = response.clone().body.getReader();
    let count = 0;
    while (true) {
      const { done, value } = await reader.read(); current();
      if (done) break;
      count += value.byteLength;
      if (count > PHASE_LIMITS.bytes) fieldFail('the ground description exceeds its download bound.');
    }
    current();
    const bytes = new Uint8Array(await response.arrayBuffer()); current();
    if (bytes.byteLength !== count) fieldFail('the ground description stream is incomplete.');
    return prepareFieldScenario(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'henry-hill');
  } catch (error) {
    // Tee cancellation settles only after BOTH branches are cancelled. Issue both before awaiting.
    const cancellations = [];
    if (response.body && !response.body.locked) cancellations.push(response.body.cancel());
    if (reader) cancellations.push(reader.cancel());
    await Promise.allSettled(cancellations);
    throw error;
  } finally { reader?.releaseLock(); }
}

// Ephemeral validation provenance, never a persisted cursor or strong-reference store.
const reinforcementPlans = new WeakSet();
function timelineUnit(unit) {
  if (!Number.isSafeInteger(unit.men) || unit.men <= 0
    || (unit.type === 'artillery' ? !Number.isSafeInteger(unit.guns) || unit.guns <= 0
      : own(unit, 'guns') && unit.guns !== 0)
    || (own(unit, 'xp') && (!Number.isInteger(unit.xp) || unit.xp < 1 || unit.xp > VETERANCY.length))
    || (own(unit, 'morale') && (!finite(unit.morale) || unit.morale < 0 || unit.morale > 100))
    || ['short', 'parent', 'notes', 'status'].some(key => own(unit, key) && typeof unit[key] !== 'string')
    || (own(unit, 'regiments') && (!Array.isArray(unit.regiments) || !unit.regiments.every(r => typeof r === 'string')))
    || (own(unit, 'commander') && unit.commander !== null && (!record(unit.commander) || !text(unit.commander.name)
      || ['rank', 'portrait', 'portraitNote'].some(key => own(unit.commander, key) && typeof unit.commander[key] !== 'string')))) fail('reinforcement roster numbers or metadata are invalid.');
}
function timelineRows(value) {
  const horizon = (clock(value.end) - clock(value.start)) * 60 / CLOCK_RATIO;
  const rows = own(value, 'reinforcements') ? value.reinforcements : [];
  if (!Array.isArray(rows)) fail('reinforcements must be an array.');
  for (const row of rows) {
    if (!record(row) || !finite(row.atSec) || row.atSec < 0 || row.atSec > horizon || !text(row.entry)
      || (own(row, 'noticeSec') && (!finite(row.noticeSec) || row.noticeSec < 0 || row.noticeSec > row.atSec))) fail('reinforcement entry or phase offset is invalid.');
  }
  const roster = [...value.units, ...rows];
  // Initial-only opening authority was already checked by preparePhase, before this union.
  scenario({ ...value, units: roster });
  for (const unit of roster) timelineUnit(unit);
  const events = rows.map((unit, sourceIndex) => Object.freeze({ atSec: unit.atSec,
    noticeAtSec: unit.atSec - (unit.noticeSec ?? 0), sourceIndex, unit }));
  const arrival = events.slice().sort((a, b) => a.atSec - b.atSec || a.sourceIndex - b.sourceIndex);
  const notices = events.slice().sort((a, b) => a.noticeAtSec - b.noticeAtSec || a.sourceIndex - b.sourceIndex);
  const empty = () => ({ formations: 0, men: 0, guns: 0, figures: 0 });
  const budget = { US: empty(), CS: empty(), total: empty() };
  for (const unit of roster) for (const target of [budget[unit.side], budget.total]) {
    target.formations++; target.men += unit.men; target.guns += unit.guns || 0;
    target.figures += Math.round(unit.men / (unit.type === 'artillery' ? 4 : 5)) + 6;
    if (!Object.values(target).every(Number.isSafeInteger)) fail('combined reinforcement budget is outside safe integer bounds.');
  }
  for (const row of Object.values(budget)) Object.freeze(row);
  return { horizon, events: Object.freeze(arrival), notices: Object.freeze(notices), budget: Object.freeze(budget) };
}

/** Detached whole-pack timeline. Simulation offsets are game data, not verified historical hours. */
export function prepareReinforcementTimeline(input, phaseId) {
  const pack = snapshot(input), selected = preparePhase(pack, phaseId);
  const timelines = pack.phases.map(phase => timelineRows(phase.scenario));
  const plan = Object.freeze({ packId: selected.packId, phaseId: selected.phaseId,
    index: selected.index, previousId: selected.previousId, nextId: selected.nextId,
    scenario: pack.phases[selected.index].scenario, ...timelines[selected.index] });
  reinforcementPlans.add(plan);
  return plan;
}

/** Stateless interval query: callers must advance contiguous windows to avoid replaying arrivals. */
export function reinforcementWindow(plan, input) {
  if (!reinforcementPlans.has(plan)) fail('reinforcement timeline must be prepared in this session.');
  const window = snapshot(input); shape(window, ['after', 'through'], 'reinforcement window');
  if (!(window.after === null || finite(window.after) && window.after >= 0)
    || !finite(window.through) || window.through < 0 || window.through > plan.horizon
    || window.after !== null && window.after > window.through) fail('reinforcement window is outside its forward phase interval.');
  const includes = at => (window.after === null || at > window.after) && at <= window.through;
  const arrivals = plan.events.filter(event => includes(event.atSec));
  const notices = plan.notices.filter(event => includes(event.noticeAtSec));
  const pending = { US: 0, CS: 0 };
  for (const event of plan.events) if (event.atSec > window.through) pending[event.unit.side]++;
  return Object.freeze({ packId: plan.packId, phaseId: plan.phaseId, ...window,
    arrivals: Object.freeze(arrivals), notices: Object.freeze(notices), pending: Object.freeze(pending) });
}

/** Pure accounting requests, not evidence or authority for battlefield capture eligibility. */
export function captureAccounting(plan, input) {
  if (!reinforcementPlans.has(plan)) fail('capture accounting needs a prepared reinforcement timeline.');
  const trace = snapshot(input); shape(trace, ['through', 'events'], 'capture accounting trace');
  if (!finite(trace.through) || trace.through < 0 || trace.through > plan.horizon || !Array.isArray(trace.events)) fail('capture accounting interval or events are invalid.');
  const budget = plan.budget.total;
  if (budget.formations > FIELD_LIMITS.formations || budget.men > FIELD_LIMITS.men || budget.guns > FIELD_LIMITS.guns) fail('capture accounting exceeds current software applicability bounds.');
  const roster = [...plan.scenario.units, ...(plan.scenario.reinforcements || [])];
  const figures = roster.reduce((sum, unit) => sum + Math.max(1, Math.round(unit.men / (unit.type === 'artillery' ? 4 : 5))) + 6, 0);
  if (figures > FIELD_LIMITS.figures) fail('capture accounting exceeds current software figure bounds.');
  const units = roster.map((unit, index) => {
    const arrivalAtSec = index < plan.scenario.units.length ? 0 : unit.atSec;
    const arrived = arrivalAtSec <= trace.through;
    return { unitId: unit.id, originSide: unit.side, arrivalAtSec, arrived, initialMen: unit.men,
      presentMen: arrived ? unit.men : 0, pendingMen: arrived ? 0 : unit.men,
      killedWounded: 0, missingMen: 0, capturedMen: 0, capturedBy: { US: 0, CS: 0 },
      guns: Array.from({ length: unit.type === 'artillery' ? unit.guns : 0 }, (_, gunIndex) => ({
        unitId: unit.id, gunIndex, originSide: unit.side, originWeapon: own(unit, 'weapon') ? unit.weapon : null,
        ownerSide: unit.side, condition: 'serviceable', arrived })) };
  });
  const byId = new Map(units.map(unit => [unit.unitId, unit])), seen = new Map();
  let last = -1, applied = 0, replayed = 0;
  for (const event of trace.events) {
    const common = ['id', 'atSec', 'unitId', 'kind'];
    const menEvent = ['loss', 'missing', 'capture-men'].includes(event?.kind);
    const gunEvent = ['disable-gun', 'capture-gun'].includes(event?.kind);
    if (!menEvent && !gunEvent) fail('capture event kind is unsupported.');
    const capture = event.kind === 'capture-men' || event.kind === 'capture-gun';
    const keys = [...common, menEvent ? 'men' : 'gunIndex', ...(capture ? ['captorSide'] : [])];
    shape(event, keys, 'capture event');
    if (!text(event.id) || !text(event.unitId) || !finite(event.atSec) || event.atSec < 0 || event.atSec > trace.through) fail('capture event identity or time is invalid.');
    const unit = byId.get(event.unitId);
    if (!unit || event.atSec < unit.arrivalAtSec) fail('capture event formation is absent or not yet arrived.');
    if (menEvent ? !finite(event.men) || event.men <= 0 : !Number.isSafeInteger(event.gunIndex) || event.gunIndex < 0 || event.gunIndex >= unit.guns.length) fail('capture event amount or gun identity is invalid.');
    if (capture && !['US', 'CS'].includes(event.captorSide)) fail('capture event captor side is invalid.');
    const canonical = JSON.stringify(keys.map(key => event[key]));
    if (seen.has(event.id)) {
      if (seen.get(event.id) !== canonical) fail('capture event id has changed payload.');
      replayed++; continue;
    }
    if (event.atSec < last) fail('unique capture events must be chronological.');
    if (menEvent) {
      if (capture && event.captorSide === unit.originSide) fail('prisoners need the opposite origin side.');
      if (event.men > unit.presentMen) fail('capture event overspends remaining men.');
      const key = event.kind === 'loss' ? 'killedWounded' : event.kind === 'missing' ? 'missingMen' : 'capturedMen';
      const next = unit[key] + event.men;
      const components = { killedWounded: unit.killedWounded, missingMen: unit.missingMen, capturedMen: unit.capturedMen, [key]: next };
      const lost = (components.killedWounded + components.missingMen) + components.capturedMen;
      const present = unit.initialMen - lost;
      if (!finite(next) || next <= unit[key] || !finite(lost) || lost > unit.initialMen || !finite(present) || present < 0 || present >= unit.presentMen) fail('capture event amount does not make representable progress.');
      unit[key] = next; unit.presentMen = present;
      if (capture) unit.capturedBy[event.captorSide] = next;
    } else {
      const gun = unit.guns[event.gunIndex];
      if (event.kind === 'disable-gun') {
        if (gun.condition === 'disabled') fail('gun disable event makes no change.');
        gun.condition = 'disabled';
      } else {
        if (event.captorSide === gun.ownerSide) fail('gun capture event needs the opposite current owner.');
        gun.ownerSide = event.captorSide;
      }
    }
    seen.set(event.id, canonical); last = event.atSec; applied++;
  }
  const counters = () => ({ initialMen: 0, presentMen: 0, pendingMen: 0, killedWounded: 0, missingMen: 0,
    capturedMen: 0, capturedBy: { US: 0, CS: 0 }, initialGuns: 0, pendingGuns: 0, retainedGuns: 0, netCapturedGuns: 0, disabledGuns: 0 });
  const totals = { US: counters(), CS: counters() };
  const possession = { US: { totalGuns: 0, fieldGuns: 0, pendingGuns: 0 }, CS: { totalGuns: 0, fieldGuns: 0, pendingGuns: 0 } };
  const conserveMen = row => {
    const accounted = (((row.presentMen + row.pendingMen) + row.killedWounded) + row.missingMen) + row.capturedMen;
    if (Math.abs(row.initialMen - accounted) > 16 * Number.EPSILON * Math.max(1, row.initialMen)) fail('capture accounting men conservation failed.');
  };
  for (const unit of units) {
    conserveMen(unit);
    const total = totals[unit.originSide];
    for (const key of ['initialMen', 'presentMen', 'pendingMen', 'killedWounded', 'missingMen', 'capturedMen']) total[key] += unit[key];
    for (const side of ['US', 'CS']) total.capturedBy[side] += unit.capturedBy[side];
    for (const gun of unit.guns) {
      total.initialGuns++;
      if (!gun.arrived) total.pendingGuns++;
      if (gun.ownerSide === gun.originSide) total.retainedGuns++; else total.netCapturedGuns++;
      if (gun.condition === 'disabled') total.disabledGuns++;
      const held = possession[gun.ownerSide]; held.totalGuns++;
      if (gun.arrived) held.fieldGuns++; else held.pendingGuns++;
    }
  }
  for (const side of ['US', 'CS']) {
    conserveMen(totals[side]);
    if (totals[side].initialGuns !== totals[side].retainedGuns + totals[side].netCapturedGuns
      || possession[side].totalGuns !== possession[side].fieldGuns + possession[side].pendingGuns) fail('capture accounting gun conservation failed.');
  }
  if (totals.US.initialGuns + totals.CS.initialGuns !== possession.US.totalGuns + possession.CS.totalGuns) fail('capture accounting physical gun total changed.');
  return snapshot({ packId: plan.packId, phaseId: plan.phaseId, through: trace.through, applied, replayed, units, totals, possession });
}

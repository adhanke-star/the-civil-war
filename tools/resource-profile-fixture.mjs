// Constructed resource-test inputs only. No prior phase was played; no progression or fielding proof.
import {newCampaign, recordPhase, campaignPhase, validateCampaign, applyCampaign} from '../src/franchise/campaign.js';
import {validateSnapshot} from '../src/franchise/save.js';
import {preparePhase, prepareFieldScenario} from '../src/sim/phase.js';
import {deriveSceneStressContract} from './bake/inactive-figures.mjs';

const fail = message => { throw Error('ordinary resource inputs: ' + message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Compare complete authored/applied rosters, including scheduled definitions, before native work. */
export function ordinaryCapacityContract(authored, applied, pages) {
  const definitions = scenario => [...scenario.units, ...(scenario.reinforcements || [])].map(d => ({
    id: d.id, name: d.name, short: d.short ?? null, commander: d.commander ?? null,
    side: d.side, type: d.type || 'infantry', guns: d.guns ?? null,
    atSec: d.atSec ?? null, noticeSec: d.noticeSec ?? null, entry: d.entry ?? null, x: d.x, z: d.z, facing: d.facing,
    regiments: d.regiments ?? null, sources: d.sources ?? null, notes: d.notes ?? null,
  }));
  if (authored.id !== applied.id || authored.terrain !== applied.terrain
    || !same(definitions(authored), definitions(applied))) fail('definition/arrival/source identity changed');
  const beforeUnits = [...authored.units, ...(authored.reinforcements || [])],
    afterUnits = [...applied.units, ...(applied.reinforcements || [])];
  if (afterUnits.some((d, i) => !Number.isSafeInteger(d.men) || d.men < 1 || d.men > beforeUnits[i].men))
    fail('applied formation strength exceeds authored');
  const before = deriveSceneStressContract(authored, pages), after = deriveSceneStressContract(applied, pages);
  for (const key of ['ratio', 'reserve', 'definitions', 'scheduled', 'commanders']) {
    if (before[key] !== after[key]) fail('fixed capacity changed: ' + key);
  }
  if (!same(before.guns, after.guns) || !same(before.pages, after.pages)) fail('gun/page contract changed');
  for (const key of ['US', 'CS', 'horses', 'mounts', 'flags']) {
    if (after[key] > before[key]) fail('applied capacity exceeds authored: ' + key);
  }
  return freeze({authored: before, applied: after});
}

/** The exact constructor-valid prefix for the first ordinary-entry Lookout pilot, never a played save. */
export function ordinaryLookoutFixture(campaign, pack) {
  const definition = validateCampaign(campaign);
  const index = definition.phases.findIndex(p => p.packId === 'chattanooga' && p.phaseId === 'lookout-mountain');
  if (index !== 9 || pack.id !== 'chattanooga') fail('first pilot target/ladder changed');
  const at = '2026-10-15T12:00:00Z';
  let save = newCampaign({campaign: definition, slot: 3, seed: 18631124, at, difficulty: 'veteran'});
  const records = [];
  for (let i = 0; i < index; i++) {
    const phase = campaignPhase(save, definition);
    const record = {packId: phase.packId, phaseId: phase.phaseId, awardId: phase.awardId,
      winner: null, grade: 'Draw', units: [], loot: [], at};
    save = recordPhase(save, definition, record);
    records.push(record);
  }
  save = validateSnapshot(save);
  const phase = campaignPhase(save, definition);
  if (phase.index !== 9 || phase.packId !== 'chattanooga' || phase.phaseId !== 'lookout-mountain'
    || phase.replay || phase.attempt !== 1) fail('constructor prefix target changed');
  // loadBattlePack validates the authored field BEFORE campaign carry can reduce its capacities.
  const authored = prepareFieldScenario(preparePhase(pack, phase.phaseId).scenario, 'pack');
  // Keep this composition identical to the shipping campaign admission in src/main.js.
  const applied = prepareFieldScenario(applyCampaign(authored, save, phase), 'pack');
  return freeze({kind: 'constructed resource fixture; nine earlier phases NOT PLAYED; no progression proof',
    save, phase, records, authored, applied});
}

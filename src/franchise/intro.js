// A fictional teaching exercise on reused terrain, never a historical OOB or campaign phase.
// Explicit fictional opt-in; validate descriptors before reading/materializing caller data.
export function surrenderOption(options) {
  if (options === undefined) return false;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Practice: surrender activation needs an own boolean option.');
  }
  const flag = Object.getOwnPropertyDescriptor(options, 'surrender');
  if (!flag) {
    if ('surrender' in options) throw new Error('Practice: inherited surrender activation is invalid.');
    return false;
  }
  if (!('value' in flag) || typeof flag.value !== 'boolean') {
    throw new Error('Practice: surrender activation needs an own boolean option.');
  }
  return flag.value;
}

export function fictionalSurrenderRoute(search) {
  const query = new URLSearchParams(search);
  return query.has('intro') && !['practice', 'battle', 'sandbox', 'tune'].some(key => query.has(key));
}

export function introScenario(ground, options) {
  const surrender = surrenderOption(options);
  const unit = (id, side, name, men, x, z, weapon = 'rifled') => ({
    id, side, type: 'infantry', name, short: name, men, x, z, weapon, xp: 1,
    facing: side === 'US' ? Math.PI / 2 : -Math.PI / 2, commander: null, regiments: [],
    status: 'Fictional practice formation; strength and equipment are game values',
  });
  const scenario = { ...ground, id: 'first-command', title: 'Your first command', battle: 'Fictional practice',
    practiceIntro: true, start: '14:00', end: '14:03',
    historyNote: 'This is a fictional teaching exercise on the Henry Hill terrain. Its formations, stores, clock and outcome do not describe a historical engagement. The historical battle is available separately.',
    units: [unit('practice-first', 'US', '1st Practice Brigade', 1000, -480, -690),
      unit('practice-second', 'US', '2nd Practice Brigade', 1000, -480, -535),
      unit('practice-opponent', 'CS', 'Opposing Practice Brigade', 600, -130, -610)],
    objective: { name: 'the practice stores', x: -400, z: -610, r: 165 },
    opening: [{ id: 'practice-opponent', points: [[-130, -610], [-420, -610]], endFacing: -Math.PI / 2 }],
    crates: [{ id: 'near-stores', name: 'Forward stores', x: -350, z: -665, r: 90, tier: 'rare' },
      { id: 'far-stores', name: 'Exposed stores', x: -190, z: -540, r: 65, tier: 'uncommon' }],
  };
  if (surrender) scenario.surrender = true;
  return scenario;
}

// tools/test-reward.mjs: Node-only checks for the reward sequence's model and data (no browser).
//
//   node tools/test-reward.mjs              run every check against src/reward/model.js; exit 1 on any failure
//   node tools/test-reward.mjs --prove-fail negative bind: run each check against a deliberately broken
//                                           stand-in and require that it FAILS with its expected text;
//                                           exit 1 if any check passes on its broken stand-in
//   REWARD_MODEL=<path> node tools/test-reward.mjs   point the checks at another copy of model.js
//
// Save checks use injected memory storage and per-invariant mutants: strict schema/gear/ownership,
// issued transfers, atomic imports, duplicate callbacks, conflicts, storage failure and bounded exports.
// Loot checks: determinism for a seed; the Rare-or-better guarantee over 500 seeds; Legendary share of cards at
// Victory between 0.5% and 8%; a better grade never lowers expected rarity (mean total rarity per roll AND
// mean best card per roll, 2,000 seeds each); compare/equip arithmetic agrees with ovr(); bestFit returns
// the max-gain brigade; every tier has a distinct shape; every unique is gameItem: true; no brigade label
// matches /Gen\.|Col\.|Brig\./. Writes nothing.

import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = process.env.REWARD_MODEL ? path.resolve(process.env.REWARD_MODEL) : path.join(ROOT, 'src/reward/model.js');
const realModel = await import(pathToFileURL(modelPath).href);
const realData = await import(pathToFileURL(path.join(ROOT, 'src/reward/data.js')).href);
const realSave = await import(pathToFileURL(path.join(ROOT, 'src/franchise/save.js')).href);

const GRADE_ORDER = ['Defeat', 'Draw', 'Victory', 'Decisive']; // worst to best
const rankOf = (data, card) => data.TIER_BY_ID[card.tier].rank;
const fail = (msg) => { throw new Error(msg); };

const CHECKS = [
  ['determinism', (m) => {
    for (const seed of [1, 7, 12345, 'shiloh-1']) {
      for (const grade of GRADE_ORDER) {
        const a = JSON.stringify(m.rollLoot({ seed, grade }));
        const b = JSON.stringify(m.rollLoot({ seed, grade }));
        if (a !== b) fail(`determinism: seed ${JSON.stringify(seed)} grade ${grade} rolled two different hauls`);
      }
    }
    const x = JSON.stringify(m.rollLoot({ seed: 1 }).cards);
    const y = JSON.stringify(m.rollLoot({ seed: 2 }).cards);
    if (x === y) fail('determinism: seeds 1 and 2 rolled the same haul (the seed is ignored)');
  }],

  ['rare-guarantee', (m, d) => {
    for (const grade of GRADE_ORDER) {
      for (let seed = 1; seed <= 500; seed++) {
        const r = m.rollLoot({ seed, grade });
        if (!r.cards.some((c) => rankOf(d, c) >= 2)) fail(`rare-guarantee: seed ${seed} grade ${grade} had no Rare-or-better card`);
      }
    }
  }],

  ['order-rarest-last', (m, d) => {
    for (let seed = 1; seed <= 200; seed++) {
      const ranks = m.rollLoot({ seed, grade: 'Victory' }).cards.map((c) => rankOf(d, c));
      for (let i = 1; i < ranks.length; i++) if (ranks[i] < ranks[i - 1]) fail(`order-rarest-last: seed ${seed} deals rank ${ranks[i]} after rank ${ranks[i - 1]}`);
    }
  }],

  ['legendary-rate', (m, d) => {
    let cards = 0, leg = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const r = m.rollLoot({ seed, grade: 'Victory' });
      cards += r.cards.length;
      leg += r.cards.filter((c) => rankOf(d, c) === 4).length;
    }
    const pct = (100 * leg) / cards;
    if (!(pct >= 0.5 && pct <= 8)) fail(`legendary-rate: ${pct.toFixed(2)}% of cards at Victory are Legendary (want 0.5%..8%)`);
    return `${pct.toFixed(2)}% of ${cards} cards`;
  }],

  ['grade-monotone', (m, d) => {
    const stats = {};
    for (const grade of GRADE_ORDER) {
      let sum = 0, best = 0;
      for (let seed = 1; seed <= 2000; seed++) {
        const ranks = m.rollLoot({ seed, grade }).cards.map((c) => rankOf(d, c));
        sum += ranks.reduce((a, b) => a + b, 0);
        best += Math.max(...ranks);
      }
      stats[grade] = { sum: sum / 2000, best: best / 2000 };
    }
    for (let i = 1; i < GRADE_ORDER.length; i++) {
      const lo = GRADE_ORDER[i - 1], hi = GRADE_ORDER[i];
      if (stats[hi].sum < stats[lo].sum) fail(`grade-monotone: ${hi} expects total rarity ${stats[hi].sum.toFixed(3)} < ${lo} ${stats[lo].sum.toFixed(3)}`);
      if (stats[hi].best < stats[lo].best) fail(`grade-monotone: ${hi} expects best card ${stats[hi].best.toFixed(3)} < ${lo} ${stats[lo].best.toFixed(3)}`);
    }
    return GRADE_ORDER.map((g) => `${g} ${stats[g].sum.toFixed(2)}/${stats[g].best.toFixed(2)}`).join(', ');
  }],

  ['compare-equip-ovr', (m, d) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const item of m.rollLoot({ seed }).cards) {
        for (const b of d.SAMPLE_ARMY) {
          const c = m.compare(b, item);
          if (c.before.ovr !== m.ovr(b)) fail(`compare-equip-ovr: compare(${b.label}).before.ovr ${c.before.ovr} != ovr() ${m.ovr(b)}`);
          if (!c.ok) continue;
          const { brigade: nb, displaced } = m.equip(b, item);
          if (c.after.ovr !== m.ovr(nb)) fail(`compare-equip-ovr: ${b.label} + ${item.itemId}: compare after ${c.after.ovr} != ovr(equip) ${m.ovr(nb)}`);
          if (c.delta.ovr !== c.after.ovr - c.before.ovr) fail(`compare-equip-ovr: delta ${c.delta.ovr} != ${c.after.ovr} - ${c.before.ovr}`);
          for (const k of ['fire', 'melee', 'morale', 'drill']) {
            if (c.delta[k] !== c.after[k] - c.before[k]) fail(`compare-equip-ovr: ${k} delta ${c.delta[k]} != after - before`);
          }
          if (displaced.itemId !== b.weapon.itemId) fail(`compare-equip-ovr: equip displaced ${displaced.itemId}, expected ${b.weapon.itemId}`);
          if (nb.weapon.itemId !== item.itemId) fail('compare-equip-ovr: equip did not put the new item in the brigade');
          if (m.ovr(b) !== c.before.ovr) fail('compare-equip-ovr: equip changed the input brigade (must be pure)');
          n++;
        }
      }
    }
    // gear-led: arms must dominate OVR (a better weapon on the weakest troops beats a worse one on the best)
    const green = d.SAMPLE_ARMY.find((b) => b.vet === 'green' && b.kind === 'infantry');
    const elite = d.SAMPLE_ARMY.find((b) => b.vet === 'elite' && b.kind === 'infantry');
    const top = { uid: 't1', itemId: 'spencer', conditionId: 'arsenalNew' };
    const bottom = { uid: 't2', itemId: 'm1842', conditionId: 'worn' };
    const g = m.ovr(m.equip(green, top).brigade), e = m.ovr(m.equip(elite, bottom).brigade);
    if (!(g > e)) fail(`compare-equip-ovr: OVR is not gear-led (green + Spencer ${g} <= elite + worn M1842 ${e})`);
    return `${n} compares`;
  }],

  ['depleted-no-issue', (m, d) => {
    for (const b of [{ ...d.SAMPLE_ARMY[0], men: 0 }, { ...d.SAMPLE_ARMY[4], guns: 0 }]) {
      const it = b.weapon;
      if (m.compare(b, it).ok || m.bestFit([b], it) !== null) fail('depleted-no-issue: depleted formation accepted a compare/best-fit');
      let rejected = false; try { m.equip(b, it); } catch (e) { if (/depleted/.test(e.message)) rejected = true; else throw e; }
      if (!rejected) fail('depleted-no-issue: depleted formation accepted equipment');
      if (!m.canCarry(b, it)) fail('depleted-no-issue: retained equipment records became invalid');
    }
  }],

  ['best-fit-max', (m, d) => {
    for (let seed = 1; seed <= 80; seed++) {
      for (const item of m.rollLoot({ seed }).cards) {
        const pick = m.bestFit(d.SAMPLE_ARMY, item);
        const gains = d.SAMPLE_ARMY.map((b) => { const c = m.compare(b, item); return c.ok ? c.delta.ovr : null; });
        const ok = gains.filter((x) => x !== null);
        if (!ok.length) { if (pick !== null) fail(`best-fit-max: ${item.itemId} fits nobody but bestFit chose ${pick.label}`); continue; }
        const max = Math.max(...ok);
        if (!pick) fail(`best-fit-max: bestFit returned null for ${item.itemId}`);
        const got = m.compare(pick, item);
        if (!got.ok || got.delta.ovr !== max) fail(`best-fit-max: ${item.itemId} best gain is ${max} but bestFit chose ${pick.label} (+${got.delta.ovr})`);
      }
    }
  }],

  ['tier-shapes', (m, d) => {
    const shapes = d.TIERS.map((t) => t.shape);
    if (d.TIERS.length !== 5) fail(`tier-shapes: ${d.TIERS.length} tiers, want 5`);
    if (new Set(shapes).size !== shapes.length || shapes.some((s) => !s)) fail(`tier-shapes: shapes are not distinct: ${shapes.join(', ')}`);
  }],

  ['uniques-game-items', (m, d) => {
    if (d.UNIQUES.length < 4) fail(`uniques-game-items: ${d.UNIQUES.length} uniques, want 4`);
    for (const u of d.UNIQUES) {
      if (u.gameItem !== true) fail(`uniques-game-items: ${u.id} is not flagged gameItem: true`);
      if (d.itemDef(u.id).gameItem !== true) fail(`uniques-game-items: itemDef(${u.id}) lost gameItem`);
      if (!u.flavour || !u.special || !u.special.text) fail(`uniques-game-items: ${u.id} needs a special effect and flavour`);
    }
    for (const c of d.CONDITIONS) if (c.gameModifier !== true) fail(`uniques-game-items: condition ${c.id} is not flagged gameModifier: true`);
    for (const a of d.ARMS) for (const k of ['range', 'rate', 'accuracy', 'power']) {
      if (!a[k] || !['old-data', 'placeholder'].includes(a[k].src)) fail(`uniques-game-items: ${a.id}.${k} has no src 'old-data' or 'placeholder'`);
    }
  }],

  ['no-rank-labels', (m, d) => {
    for (const b of d.SAMPLE_ARMY) if (/Gen\.|Col\.|Brig\./.test(b.label)) fail(`no-rank-labels: brigade label "${b.label}" names a rank`);
  }],
];

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = isDeepStrictEqual;
function memoryStorage() {
  const data = new Map([['cw.settings', 'preferences'], ['cw.locks', 'locks']]);
  return { data, writes: 0, getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { this.writes++; data.set(k, v); } };
}
function sampleResult(m, d, seed = 72) {
  const army = clone(d.SAMPLE_ARMY), cards = m.rollLoot({ seed }).cards;
  const it = cards.find((c) => m.canCarry(army[0], c));
  const { brigade, displaced } = m.equip(army[0], it);
  army[0] = brigade;
  return { awardId: `demo-test-${seed}`, army, depot: [...cards.filter((c) => c !== it), displaced],
    issued: [{ brigade: brigade.id, item: it.uid, displaced: displaced.uid }], seed, grade: 'Victory' };
}
function rejected(fn, name, reason) {
  let error;
  try { fn(); } catch (err) { error = err; }
  if (!error || !error.message.startsWith('Progress:') || !error.message.includes(reason)) fail(`${name}: expected rejection for ${reason}, got ${error?.message ?? 'success'}`);
}

const SAVE_CHECKS = [
  ['save-export-limit', (m, d, s) => {
    const input = sampleResult(m, d); input.issued = [];
    input.depot = Array.from({ length: 2000 }, (_, i) => ({ ...input.army[0].weapon, uid: `cap-${i}-${'a'.repeat(90)}`, from: 'é'.repeat(90) + 'a'.repeat(70), source: 'issue', depot: true }));
    const snap = realSave.completedSnapshot(input), exported = s.exportSnapshot(snap);
    if (new TextEncoder().encode(exported).length > s.MAX_SAVE_BYTES) fail('save-export-limit: accepted near-limit multibyte state exported an oversized file');
    if (!same(s.parseSnapshot(exported), snap)) fail('save-export-limit: near-limit export failed exact round-trip');
  }],
  ['save-roundtrip', (m, d, s) => {
    const mem = memoryStorage(), store = s.createProgressStore(mem), input = sampleResult(m, d);
    const snap = store.complete(input).snapshot, loaded = store.load();
    if (!same(snap, loaded) || !same(s.parseSnapshot(s.exportSnapshot(snap)), snap) || !same(snap.issued, input.issued)
      || !same(snap.depot, input.depot) || snap.awardId !== input.awardId) fail('save-roundtrip: identities, equipment or records changed');
    const tampered = clone(snap); tampered.army[0].ovr = 1;
    if (s.parseSnapshot(JSON.stringify(tampered)).army[0].ovr !== m.ratings(input.army[0]).ovr) fail('save-roundtrip: trusted imported derived OVR');
    if (mem.data.get('cw.settings') !== 'preferences' || mem.data.get('cw.locks') !== 'locks') fail('save-roundtrip: preferences changed');
  }],
  ['save-schema', (m, d, s) => {
    const snap = realSave.completedSnapshot(sampleResult(m, d));
    for (const text of ['{', 'null', JSON.stringify({ ...snap, version: 2 }), JSON.stringify({ ...snap, army: [] }), JSON.stringify({ ...snap, issued: undefined })]) {
      rejected(() => s.parseSnapshot(text), 'save-schema', text === '{' ? 'JSON' : text === 'null' ? 'object' : text.includes('"issued":') === false ? 'fields' : text.includes('"version":2') ? 'version' : 'army');
    }
    rejected(() => s.parseSnapshot(' '.repeat(s.MAX_SAVE_BYTES + 1)), 'save-schema', 'limit');
    rejected(() => s.parseSnapshot('é'.repeat(s.MAX_SAVE_BYTES / 2 + 1)), 'save-schema', 'limit');
    for (const seed of [-1, 0x100000000, null, NaN, Infinity]) {
      rejected(() => s.validateSnapshot({ ...snap, seed }), 'save-schema', 'seed');
    }
    rejected(() => s.validateSnapshot({ ...snap, grade: 'Win' }), 'save-schema', 'grade');
  }],
  ['save-gear', (m, d, s) => {
    for (const patch of [{ itemId: 'missing' }, { itemId: 'constructor' }, { conditionId: 'missing' }, { tier: 'legendary' }]) {
      const snap = realSave.completedSnapshot(sampleResult(m, d)); Object.assign(snap.army[0].weapon, patch);
      rejected(() => s.validateSnapshot(snap), 'save-gear', patch.itemId ? 'gear' : 'condition');
    }
    const snap = realSave.completedSnapshot(sampleResult(m, d)); snap.army[0].men = Infinity;
    rejected(() => s.validateSnapshot(snap), 'save-gear', 'men');
    snap.army[0].men = 10; snap.army[0].base.fire = 100;
    rejected(() => s.validateSnapshot(snap), 'save-gear', 'rating');
  }],
  ['save-ownership', (m, d, s) => {
    const snap = realSave.completedSnapshot(sampleResult(m, d));
    snap.depot.push(clone(snap.army[0].weapon));
    rejected(() => s.validateSnapshot(snap), 'save-ownership', 'duplicate item');
    snap.depot.pop(); snap.army[1].id = snap.army[0].id;
    rejected(() => s.validateSnapshot(snap), 'save-ownership', 'duplicate brigade');
  }],
  ['save-issued', (m, d, s) => {
    const input = sampleResult(m, d), oldWeapon = input.depot.find((it) => it.uid === input.issued[0].displaced);
    const next = m.equip(input.army[1], oldWeapon);
    input.army[1] = next.brigade;
    input.depot = [...input.depot.filter((it) => it.uid !== oldWeapon.uid), next.displaced];
    input.issued.push({ brigade: next.brigade.id, item: oldWeapon.uid, displaced: next.displaced.uid });
    const transferred = s.validateSnapshot(realSave.completedSnapshot(input));
    if (!same(transferred.issued, input.issued) || !same(transferred.depot, input.depot)) fail('save-issued: valid multi-brigade transfers did not round-trip');
    const snap = realSave.completedSnapshot(sampleResult(m, d));
    snap.issued.push(clone(snap.issued[0]));
    rejected(() => s.validateSnapshot(snap), 'save-issued', 'inconsistent');
    snap.issued.pop(); snap.issued[0].item = 'missing';
    rejected(() => s.validateSnapshot(snap), 'save-issued', 'reference');
  }],
  ['save-atomic-import', (m, d, s) => {
    const mem = memoryStorage(), store = s.createProgressStore(mem);
    const old = store.complete(sampleResult(m, d)).snapshot, raw = mem.getItem(s.SAVE_KEY), writes = mem.writes;
    for (const text of ['{', JSON.stringify({ ...old, version: 2 }), JSON.stringify({ ...old, depot: [...old.depot, old.army[0].weapon] })]) {
      let error; try { store.import(text); } catch (err) { error = err; }
      if (!error?.message.startsWith('Progress:') || mem.getItem(s.SAVE_KEY) !== raw || mem.writes !== writes || !same(store.load(), old)) fail('save-atomic-import: invalid input changed the previous save or did not reject');
    }
    const newer = realSave.completedSnapshot(sampleResult(m, d, 73));
    store.import(JSON.stringify(newer)); store.import(JSON.stringify(old));
    if (!same(store.load(), old)) fail('save-atomic-import: older export did not replace exactly');
  }],
  ['save-idempotent', (m, d, s) => {
    const mem = memoryStorage(), store = s.createProgressStore(mem), input = sampleResult(m, d);
    const first = store.complete(input).snapshot, raw = mem.getItem(s.SAVE_KEY);
    for (let n = 0; n < 5; n++) {
      const replay = s.createProgressStore(mem).complete(input);
      if (!replay.duplicate || !same(replay.snapshot, first) || mem.getItem(s.SAVE_KEY) !== raw || mem.writes !== 1) fail('save-idempotent: repeated callback rewrote or duplicated an award');
    }
  }],
  ['save-storage-failure', (m, d, s) => {
    const mem = memoryStorage(), store = s.createProgressStore(mem), input = sampleResult(m, d);
    const first = store.complete(input).snapshot, raw = mem.getItem(s.SAVE_KEY);
    mem.setItem = () => { throw new Error('quota'); };
    rejected(() => store.complete(sampleResult(m, d, 73), { previous: first }), 'save-storage-failure', 'could not save');
    rejected(() => store.import(JSON.stringify(realSave.completedSnapshot(sampleResult(m, d, 73)))), 'save-storage-failure', 'could not save');
    if (mem.getItem(s.SAVE_KEY) !== raw || !s.exportSnapshot(first)) fail('save-storage-failure: erased progress or export unavailable');
    mem.getItem = () => { throw new Error('blocked'); };
    rejected(() => store.load(), 'save-storage-failure', 'read');
    rejected(() => store.complete(input), 'save-storage-failure', 'read');
    rejected(() => s.createProgressStore(() => { throw new Error('blocked'); }).load(), 'save-storage-failure', 'unavailable');
  }],
  ['save-conflict', (m, d, s) => {
    const mem = memoryStorage(), store = s.createProgressStore(mem);
    const first = store.complete(sampleResult(m, d)).snapshot, raw = mem.getItem(s.SAVE_KEY);
    rejected(() => store.complete(sampleResult(m, d, 73)), 'save-conflict', 'changed');
    if (mem.getItem(s.SAVE_KEY) !== raw) fail('save-conflict: unacknowledged fresh demo overwrote saved army');
    const next = store.complete(sampleResult(m, d, 73), { previous: first }).snapshot;
    rejected(() => store.complete(sampleResult(m, d, 74), { previous: first }), 'save-conflict', 'changed');
    if (!same(next, store.load())) fail('save-conflict: stale callback overwrote new progress');
  }],
];
CHECKS.push(...SAVE_CHECKS);

function runAll(m, d, quiet) {
  const results = [];
  for (const [name, fn] of CHECKS) {
    try {
      const note = fn(m, d, realSave);
      results.push({ name, ok: true, note });
      if (!quiet) console.log(`PASS ${name}${note ? ` (${note})` : ''}`);
    } catch (err) {
      results.push({ name, ok: false, msg: err.message });
      if (!quiet) console.log(`FAIL ${err.message}`);
    }
  }
  return results;
}

// ---- negative bind: each check must fail on a broken stand-in, with its own failure text -------------------
function mutants(m, d) {
  const brokenData = (patch) => ({ ...d, ...patch });
  const modelMutants = {
    'determinism': [{ ...m, rollLoot: (o) => m.rollLoot({ ...o, seed: Math.random() }) }, d],
    'rare-guarantee': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: r.cards.map((c) => ({ ...c, tier: 'common' })) }; } }, d],
    'order-rarest-last': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: [...r.cards].reverse() }; } }, d],
    'legendary-rate': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: r.cards.map((c) => ({ ...c, tier: 'legendary' })) }; } }, d],
    'grade-monotone': [{ ...m, rollLoot: (o) => m.rollLoot({ ...o, grade: { Decisive: 'Defeat', Defeat: 'Decisive', Victory: 'Draw', Draw: 'Victory' }[o.grade] }) }, d],
    'compare-equip-ovr': [{ ...m, compare: (b, it) => { const c = m.compare(b, it); return { ...c, after: { ...c.after, ovr: c.after.ovr + 1 } }; } }, d],
    'best-fit-max': [{ ...m, bestFit: (bs, it) => bs.find((b) => m.compare(b, it).ok) || null }, d],
    'depleted-no-issue': [{ ...m, compare: (b, it) => m.compare({ ...b, men: 10, guns: 6 }, it) }, d],
    'tier-shapes': [m, brokenData({ TIERS: d.TIERS.map((t) => ({ ...t, shape: 'circle' })) })],
    'uniques-game-items': [m, brokenData({ UNIQUES: d.UNIQUES.map((u, i) => (i === 0 ? { ...u, gameItem: false } : u)) })],
    'no-rank-labels': [m, brokenData({ SAMPLE_ARMY: d.SAMPLE_ARMY.map((b, i) => (i === 0 ? { ...b, label: 'Brig. Gen. Example' } : b)) })],
  };
  const permissive = { ...realSave, parseSnapshot: (text) => { try { return JSON.parse(text); } catch { return null; } }, validateSnapshot: (v) => v };
  const wrapStore = (patch) => ({ ...realSave, createProgressStore: (mem) => {
    const store = realSave.createProgressStore(mem); return { ...store, ...patch(store, mem) };
  } });
  const saveMutants = {
    'save-export-limit': { ...realSave, exportSnapshot: (v) => JSON.stringify(realSave.validateSnapshot(v), null, 2) },
    'save-roundtrip': { ...realSave, parseSnapshot: (t) => { const v = realSave.parseSnapshot(t); v.army[0].ovr = 1; return v; } },
    'save-schema': permissive, 'save-gear': permissive, 'save-ownership': permissive, 'save-issued': permissive,
    'save-atomic-import': wrapStore((st, mem) => ({ import(t) { mem.setItem(realSave.SAVE_KEY, t); return JSON.parse(t); } })),
    'save-idempotent': wrapStore((st, mem) => ({ complete(r, o) { const v = st.complete(r, o); mem.setItem(realSave.SAVE_KEY, JSON.stringify(v.snapshot)); return v; } })),
    'save-storage-failure': wrapStore((st) => ({ complete(r, o) { try { return st.complete(r, o); } catch { return { saved: true }; } } })),
    'save-conflict': wrapStore((st) => ({ complete(r) { return { snapshot: st.import(JSON.stringify(realSave.completedSnapshot(r))), saved: true }; } })),
  };
  return { ...modelMutants, ...Object.fromEntries(Object.entries(saveMutants).map(([name, s]) => [name, [m, d, s]])) };
}

if (process.argv.includes('--prove-fail')) {
  const muts = mutants(realModel, realData);
  let bad = 0;
  for (const [name, fn] of CHECKS) {
    const pair = muts[name];
    if (!pair) { console.log(`NO-MUTANT ${name}`); bad++; continue; }
    try {
      fn(pair[0], pair[1], pair[2] || realSave);
      console.log(`NOT-CAUGHT ${name}: the check passed on its broken stand-in`);
      bad++;
    } catch (err) {
      if (!err.message.startsWith(`${name}:`)) { console.log(`WRONG-TEXT ${name}: ${err.message}`); bad++; }
      else console.log(`CAUGHT ${err.message}`);
    }
  }
  console.log(bad ? `prove-fail: ${bad} check(s) not proven` : `prove-fail: all ${CHECKS.length} checks fail on their broken stand-ins`);
  process.exit(bad ? 1 : 0);
}

const results = runAll(realModel, realData, false);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `test-reward: ${failed.length} of ${results.length} checks FAILED` : `test-reward: all ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

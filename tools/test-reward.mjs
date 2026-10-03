// tools/test-reward.mjs: Node-only checks for the reward sequence's model and data (no browser).
//
//   node tools/test-reward.mjs              run every check against src/reward/model.js; exit 1 on any failure
//   node tools/test-reward.mjs --prove-fail negative bind: run each check against a deliberately broken
//                                           stand-in and require that it FAILS with its expected text;
//                                           exit 1 if any check passes on its broken stand-in
//   REWARD_MODEL=<path> node tools/test-reward.mjs   point the checks at another copy of model.js
//
// Checks: determinism for a seed; the Rare-or-better guarantee over 500 seeds; Legendary share of cards at
// Victory between 0.5% and 8%; a better grade never lowers expected rarity (mean total rarity per roll AND
// mean best card per roll, 2,000 seeds each); compare/equip arithmetic agrees with ovr(); bestFit returns
// the max-gain brigade; every tier has a distinct shape; every unique is gameItem: true; no brigade label
// matches /Gen\.|Col\.|Brig\./. Writes nothing.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = process.env.REWARD_MODEL ? path.resolve(process.env.REWARD_MODEL) : path.join(ROOT, 'src/reward/model.js');
const realModel = await import(pathToFileURL(modelPath).href);
const realData = await import(pathToFileURL(path.join(ROOT, 'src/reward/data.js')).href);

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

function runAll(m, d, quiet) {
  const results = [];
  for (const [name, fn] of CHECKS) {
    try {
      const note = fn(m, d);
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
  return {
    'determinism': [{ ...m, rollLoot: (o) => m.rollLoot({ ...o, seed: Math.random() }) }, d],
    'rare-guarantee': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: r.cards.map((c) => ({ ...c, tier: 'common' })) }; } }, d],
    'order-rarest-last': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: [...r.cards].reverse() }; } }, d],
    'legendary-rate': [{ ...m, rollLoot: (o) => { const r = m.rollLoot(o); return { ...r, cards: r.cards.map((c) => ({ ...c, tier: 'legendary' })) }; } }, d],
    'grade-monotone': [{ ...m, rollLoot: (o) => m.rollLoot({ ...o, grade: { Decisive: 'Defeat', Defeat: 'Decisive', Victory: 'Draw', Draw: 'Victory' }[o.grade] }) }, d],
    'compare-equip-ovr': [{ ...m, compare: (b, it) => { const c = m.compare(b, it); return { ...c, after: { ...c.after, ovr: c.after.ovr + 1 } }; } }, d],
    'best-fit-max': [{ ...m, bestFit: (bs, it) => bs.find((b) => m.compare(b, it).ok) || null }, d],
    'tier-shapes': [m, brokenData({ TIERS: d.TIERS.map((t) => ({ ...t, shape: 'circle' })) })],
    'uniques-game-items': [m, brokenData({ UNIQUES: d.UNIQUES.map((u, i) => (i === 0 ? { ...u, gameItem: false } : u)) })],
    'no-rank-labels': [m, brokenData({ SAMPLE_ARMY: d.SAMPLE_ARMY.map((b, i) => (i === 0 ? { ...b, label: 'Brig. Gen. Example' } : b)) })],
  };
}

if (process.argv.includes('--prove-fail')) {
  const muts = mutants(realModel, realData);
  let bad = 0;
  for (const [name, fn] of CHECKS) {
    const pair = muts[name];
    if (!pair) { console.log(`NO-MUTANT ${name}`); bad++; continue; }
    try {
      fn(pair[0], pair[1]);
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

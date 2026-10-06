// P2j1: actual completed-progress transactions, awaited failures and serial competing writers.
// Mutants are injected APIs, never edits to shipped source. Each rejection must hit its own assertion.
import * as real from '../src/franchise/save.js';
import { SAMPLE_ARMY } from '../src/reward/data.js';
import { equip, ratings } from '../src/reward/model.js';
import { isDeepStrictEqual as same } from 'node:util';

const clone = structuredClone;
const assert = (name, ok, message) => { if (!ok) throw new Error(`${name}: ${message}`); };
async function rejected(name, run, reason) {
  let error; try { await run(); } catch (err) { error = err; }
  assert(name, error?.message?.startsWith('Progress:') && error.message.includes(reason), `expected ${reason}, got ${error?.message || 'success'}`);
}
function serialLocks(memory) {
  let tail = Promise.resolve();
  return { calls: [], request(name, options, run) {
    this.calls.push({ name, mode: options.mode });
    const next = tail.then(() => {
      const bytes = memory ? new Map(memory.data) : null, writes = memory?.writes;
      const rollback = (error) => {
        if (memory) { memory.data.clear(); for (const [key, value] of bytes) memory.data.set(key, value); memory.writes = writes; }
        throw error;
      };
      try {
        const value = run();
        return value?.then ? value.then((result) => result, rollback) : value;
      } catch (error) { return rollback(error); }
    }); tail = next.catch(() => {}); return next;
  } };
}
function fixture(awardId = 'save-fixture') {
  const army = clone(SAMPLE_ARMY);
  const depot = [{ ...clone(army[1].weapon), uid: 'spare-infantry', source: 'capture', from: 'Fictional practice crate', conditionId: 'worn' },
    { ...clone(army.find((b) => b.kind === 'battery').weapon), uid: 'spare-battery', source: 'issue', from: 'Quartermaster issue' }];
  return real.completedSnapshot({ awardId, army, depot, issued: [], seed: 7, grade: 'Victory' });
}
function env(api = real, initial = fixture()) {
  const data = new Map([['cw.settings', 'preferences'], ['cw.locks', 'locks']]);
  if (initial !== null) data.set(real.SAVE_KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
  const mem = { data, writes: 0, getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { this.writes++; data.set(k, v); } };
  const locks = serialLocks(mem);
  return { mem, locks, store: api.createProgressStore(mem, { locks }), second: () => api.createProgressStore(mem, { locks }) };
}
async function hold(locks) {
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const settled = locks.request(real.SAVE_KEY, { mode: 'exclusive' }, () => { entered(); return new Promise((resolve) => { release = resolve; }); });
  await ready; return async () => { release(); await settled; };
}
const command = (snap) => ({ brigadeId: snap.army[0].id, itemUid: snap.depot[0].uid });
const status = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

const CHECKS = [
  ['exchange-state', async (s, name) => {
    const before = fixture(), bytes = JSON.stringify(before), c = command(before), next = s.exchangeDepot(before, c);
    const expected = equip(before.army[0], before.depot[0]);
    assert(name, JSON.stringify(before) === bytes && next.awardId === before.awardId && next.seed === before.seed
      && next.grade === before.grade && next.version === before.version && next.army.length === before.army.length
      && next.depot.length === before.depot.length && same(next.army[0], { ...expected.brigade, ovr: ratings(expected.brigade).ovr })
      && same(next.army.slice(1), before.army.slice(1)) && same(next.depot, [before.depot[1], expected.displaced])
      && same(next.issued, [{ brigade: c.brigadeId, item: c.itemUid, displaced: before.army[0].weapon.uid }]), 'identity, provenance, cardinality, derived ratings or one transfer changed');
    assert(name, same(real.parseSnapshot(real.exportSnapshot(next)), next), 'next snapshot cannot round-trip');
  }],
  ['exchange-cycles', async (s, name) => {
    const before = fixture(), first = s.exchangeDepot(before, command(before));
    const back = s.exchangeDepot(first, { brigadeId: before.army[0].id, itemUid: before.army[0].weapon.uid });
    const across = s.exchangeDepot(back, { brigadeId: before.army[1].id, itemUid: before.depot[0].uid });
    assert(name, first.issued.length === 1 && back.issued.length === 2 && across.issued.length === 3
      && back.army[0].weapon.uid === before.army[0].weapon.uid && across.army[1].weapon.uid === before.depot[0].uid,
    'A to B to A or cross-brigade exchange lost the transfer history');
    assert(name, same(real.validateSnapshot(across), across), 'reverse ownership audit failed');
  }],
  ['exchange-refusals', async (s, name) => {
    const before = fixture();
    for (const c of [null, {}, { ...command(before), extra: true }, { brigadeId: 'missing', itemUid: before.depot[0].uid },
      { brigadeId: before.army[0].id, itemUid: 'missing' }]) await rejected(name, () => s.exchangeDepot(before, c), c === null ? 'object' : c?.brigadeId ? (c.extra ? 'fields' : 'available') : 'fields');
    await rejected(name, () => s.exchangeDepot(before, { brigadeId: before.army[0].id, itemUid: before.depot[1].uid }), 'incompatible');
    const depleted = clone(before); depleted.army[0].men = 0;
    await rejected(name, () => s.exchangeDepot(depleted, command(depleted)), 'depleted');
    const battery = depleted.army.find((b) => b.kind === 'battery'); battery.guns = 0;
    await rejected(name, () => s.exchangeDepot(depleted, { brigadeId: battery.id, itemUid: depleted.depot[1].uid }), 'depleted');
  }],
  ['exchange-long-origin', async (s, name) => {
    const before = fixture(); before.army[0].label = 'a'.repeat(146) + '😀'.repeat(7); // 160 UTF-16 units; truncation crosses a surrogate pair
    const next = s.exchangeDepot(before, command(before)), displaced = next.depot.find((it) => it.uid === before.army[0].weapon.uid);
    assert(name, next.army[0].label === before.army[0].label && displaced.from.length <= 160 && displaced.from.endsWith('…')
      && !/[\uD800-\uDBFF]…$/.test(displaced.from) && displaced.itemId === before.army[0].weapon.itemId, 'full name or bounded displaced provenance lost');
    assert(name, same(real.validateSnapshot(next), next), 'long legal label produced invalid progress');
  }],
  ['exchange-history-limit', async (s, name) => {
    const before = fixture(), c = command(before), old = before.army[0].weapon.uid;
    before.issued = Array.from({ length: 5000 }, (_, i) => ({ brigade: c.brigadeId, item: i % 2 ? old : c.itemUid, displaced: i % 2 ? c.itemUid : old }));
    real.validateSnapshot(before);
    await rejected(name, () => s.exchangeDepot(before, c), 'issued');
  }],
  ['exchange-byte-limit', async (s, name) => {
    const before = fixture(), c = command(before), old = before.army[0].weapon.uid;
    before.army.push(...Array.from({ length: 200 - before.army.length }, (_, i) => ({ ...clone(before.army[0]), id: `growth-brigade-${i}`,
      weapon: { ...clone(before.army[0].weapon), uid: `growth-equipped-${i}` } })));
    before.depot.push(...Array.from({ length: 2000 - before.depot.length }, (_, i) => ({ ...clone(before.depot[0]), uid: `growth-depot-${i}` })));
    for (const it of [...before.army.map((b) => b.weapon), ...before.depot]) it.from = 'x';
    before.issued = Array.from({ length: 3000 }, (_, i) => ({ brigade: c.brigadeId, item: i % 2 ? old : c.itemUid, displaced: i % 2 ? c.itemUid : old }));
    let remaining = real.MAX_SAVE_BYTES - 16 - new TextEncoder().encode(JSON.stringify(real.validateSnapshot(before))).length;
    assert(name, remaining > 0, 'fixture already exceeds the byte limit');
    for (const it of before.depot) {
      const growth = Math.min(319, remaining), bytes = growth + 1;
      it.from = 'é'.repeat(Math.floor(bytes / 2)) + 'x'.repeat(bytes % 2); remaining -= growth;
      if (!remaining) break;
    }
    assert(name, remaining === 0, 'fixture did not approach the UTF-8 byte limit');
    const baseline = real.validateSnapshot(before);
    await rejected(name, () => s.exchangeDepot(baseline, c), 'limit');
    const { store, mem } = env(s, baseline), raw = await store.readRawBaseline();
    await rejected(name, () => store.issue(c, { previous: baseline }), 'limit');
    assert(name, mem.writes === 0 && await store.readRawBaseline() === raw, 'oversized next state changed existing progress');
  }],
  ['writer-common-lock', async (s, name) => {
    for (const kind of ['complete', 'import', 'issue']) {
      const before = fixture(), { store, mem, locks } = env(s, kind === 'complete' ? null : before), release = await hold(locks);
      const next = kind === 'complete' ? fixture('new-award') : before;
      const queued = status(kind === 'complete' ? store.complete(next) : kind === 'import'
        ? store.import(JSON.stringify(next), { previousRaw: await store.readRawBaseline() }) : store.issue(command(before), { previous: before }));
      const blocked = mem.writes === 0 && locks.calls.length === 2 && locks.calls.every((c) => c.name === real.SAVE_KEY && c.mode === 'exclusive');
      await release(); const receipt = await queued;
      assert(name, blocked && receipt.ok && mem.writes === 1, `${kind} bypassed the shared exclusive lock or did not settle once`);
    }
  }],
  ['writer-stale-queue', async (s, name) => {
    const before = fixture(), { store, second, mem, locks } = env(s), release = await hold(locks);
    const first = status(store.issue(command(before), { previous: before }));
    const imported = status(second().import(JSON.stringify(fixture('new-award')), { previousRaw: await store.readRawBaseline() }));
    const completed = status(second().complete(fixture('third-award'), { previous: before }));
    await release(); const [a, b, c] = await Promise.all([first, imported, completed]);
    assert(name, a.ok && !b.ok && !c.ok && b.error.message.includes('changed') && c.error.message.includes('changed')
      && mem.writes === 1 && same(await store.load(), real.exchangeDepot(before, command(before))), 'competing stale writers overwrote the one winning exchange');
  }],
  ['writer-import-wins', async (s, name) => {
    const before = fixture(), replacement = fixture('replacement'), { store, second, mem, locks } = env(s), release = await hold(locks);
    const imported = status(store.import(JSON.stringify(replacement), { previousRaw: await store.readRawBaseline() }));
    const issued = status(second().issue(command(before), { previous: before }));
    const completed = status(second().complete(fixture('third-award'), { previous: before }));
    await release(); const [a, b, c] = await Promise.all([imported, issued, completed]);
    assert(name, a.ok && !b.ok && !c.ok && b.error.message.includes('changed') && c.error.message.includes('changed')
      && mem.writes === 1 && same(await store.load(), replacement), 'stale issue/completion overwrote a confirmed import');
  }],
  ['writer-immutable-issue', async (s, name) => {
    const before = fixture(), original = clone(before), c = command(before), { store, mem, locks } = env(s), release = await hold(locks);
    const queued = status(store.issue(c, { previous: before }));
    c.itemUid = before.depot[1].uid; before.army[0].men = 0; before.depot[0].from = 'Changed while waiting';
    await release(); const receipt = await queued;
    assert(name, receipt.ok && mem.writes === 1 && same(await store.load(), real.exchangeDepot(original, command(original))), 'queued exchange followed later caller mutation');
  }],
  ['writer-immutable-complete', async (s, name) => {
    const before = fixture(), next = fixture('next'), expected = clone(next), { store, mem, locks } = env(s), release = await hold(locks);
    const queued = status(store.complete(next, { previous: before }));
    next.army[0].men = 1; next.depot[0].from = 'Changed later'; before.army[0].men = 0;
    await release(); const receipt = await queued;
    assert(name, receipt.ok && mem.writes === 1 && same(await store.load(), expected), 'queued completion used mutable result/baseline');
  }],
  ['writer-same-award-edits', async (s, name) => {
    const before = fixture(), { store, mem } = env(s);
    const changed = await store.issue(command(before), { previous: before }), raw = await store.readRawBaseline();
    const receipt = await store.complete(before, { previous: null });
    assert(name, receipt.duplicate && same(receipt.snapshot, changed) && await store.readRawBaseline() === raw && mem.writes === 1,
      'same-award completion rewrote or returned obsolete equipment');
  }],
  ['import-required-baseline', async (s, name) => {
    const { store, mem } = env(s, null), text = JSON.stringify(fixture());
    await rejected(name, () => store.import(text), 'baseline');
    await rejected(name, () => store.import(text, { previousRaw: undefined }), 'baseline');
    assert(name, mem.writes === 0 && await store.readRawBaseline() === null, 'unobserved empty storage granted a write');
    await store.import(text, { previousRaw: null });
    assert(name, mem.writes === 1, 'observed empty baseline was refused');
  }],
  ['import-raw-conflict', async (s, name) => {
    const before = fixture(), { store, mem } = env(s), raw = await store.readRawBaseline();
    mem.data.set(real.SAVE_KEY, raw + ' ');
    await rejected(name, () => store.import(JSON.stringify(fixture('next')), { previousRaw: raw }), 'changed');
    assert(name, mem.writes === 0 && await store.readRawBaseline() === raw + ' ', 'whitespace-only change was overwritten');
  }],
  ['import-corrupt-repair', async (s, name) => {
    const { store, mem } = env(s, '{old-corrupt'), raw = await store.readRawBaseline(), next = fixture();
    await store.import(JSON.stringify(next), { previousRaw: raw });
    assert(name, mem.writes === 1 && same(await store.load(), next), 'unchanged corrupt bytes prevented explicit recovery');
    mem.data.set(real.SAVE_KEY, '{new-corrupt');
    await rejected(name, () => store.import(JSON.stringify(next), { previousRaw: raw }), 'changed');
    assert(name, await store.readRawBaseline() === '{new-corrupt' && mem.writes === 1, 'changed corrupt bytes were overwritten');
  }],
  ['writer-quota-retry', async (s, name) => {
    const before = fixture(), { store, mem } = env(s), raw = await store.readRawBaseline(), set = mem.setItem.bind(mem);
    mem.setItem = () => { throw new Error('quota'); };
    await rejected(name, () => store.issue(command(before), { previous: before }), 'could not save');
    await rejected(name, () => store.import(JSON.stringify(fixture('next')), { previousRaw: raw }), 'could not save');
    assert(name, await store.readRawBaseline() === raw && mem.writes === 0, 'quota erased prior state');
    mem.setItem = set;
    const changed = await store.issue(command(before), { previous: before });
    await rejected(name, () => store.issue(command(before), { previous: before }), 'changed');
    await rejected(name, () => store.import(JSON.stringify(fixture('next')), { previousRaw: raw }), 'changed');
    assert(name, same(await store.load(), changed) && mem.writes === 1, 'retry rebased stale exchange/import or appended twice');
  }],
  ['writer-coordination-failure', async (s, name) => {
    const before = fixture(), { mem } = env(), raw = mem.getItem(real.SAVE_KEY);
    for (const locks of [null, {}, { request: async () => { throw new Error('denied'); } }, () => { throw new Error('denied'); }]) {
      const store = s.createProgressStore(mem, { locks });
      assert(name, same(await store.load(), before) && !!real.exportSnapshot(before), 'coordination failure also blocked reading/export');
      await rejected(name, () => store.issue(command(before), { previous: before }), 'coordinat');
      await rejected(name, () => store.complete(fixture('next'), { previous: before }), 'coordinat');
      await rejected(name, () => store.import(JSON.stringify(before), { previousRaw: raw }), 'coordinat');
    }
    assert(name, mem.writes === 0 && mem.getItem(real.SAVE_KEY) === raw, 'missing/denied lock fell back to an unsafe write');
    const working = s.createProgressStore(mem, { locks: serialLocks() });
    await working.issue(command(before), { previous: before });
    assert(name, mem.writes === 1, 'failed coordination poisoned later explicit retry');
  }],
  ['writer-invalid-current', async (s, name) => {
    const before = fixture(), { store, mem } = env(s, '{corrupt');
    await rejected(name, () => store.issue(command(before), { previous: before }), 'JSON');
    await rejected(name, () => store.complete(fixture('next'), { previous: before }), 'JSON');
    assert(name, mem.writes === 0 && await store.readRawBaseline() === '{corrupt', 'corrupt current state was replaced without import');
  }],
];

const wrap = (patch) => ({ ...real, createProgressStore: (mem, opts) => {
  const store = real.createProgressStore(mem, opts); return { ...store, ...patch(store, mem) };
} });
const bypassImport = wrap((st, mem) => ({ async import(text) { const next = real.parseSnapshot(text); mem.setItem(real.SAVE_KEY, JSON.stringify(next)); return next; } }));
const bypassIssue = wrap((st, mem) => ({ async issue(c, o) { const next = real.exchangeDepot(o.previous, c); mem.setItem(real.SAVE_KEY, JSON.stringify(next)); return next; } }));
// Keep real preparation, coordination and quota errors, omit only the stale-baseline check.
const unsafeRetryIssue = { ...real, createProgressStore(mem, opts) {
  const store = real.createProgressStore(mem, opts);
  return { ...store, async issue(c, { previous }) {
    const next = real.exchangeDepot(previous, c);
    return opts.locks.request(real.SAVE_KEY, { mode: 'exclusive' }, () => {
      try { mem.setItem(real.SAVE_KEY, JSON.stringify(next)); }
      catch { throw new Error('Progress: could not save.'); }
      return next;
    });
  } };
} };
const MUTANTS = {
  'exchange-state': { ...real, exchangeDepot: (v) => clone(v) },
  'exchange-cycles': { ...real, exchangeDepot: (v, c) => ({ ...real.exchangeDepot(v, c), issued: [] }) },
  'exchange-refusals': { ...real, exchangeDepot: (v) => clone(v) },
  'exchange-long-origin': { ...real, exchangeDepot: (v, c) => {
    const out = real.exchangeDepot(v, c), b = v.army.find((x) => x.id === c.brigadeId);
    out.depot.find((it) => it.uid === b.weapon.uid).from = `Depot: from ${b.label}`; return out;
  } },
  'exchange-history-limit': { ...real, exchangeDepot: (v) => clone(v) },
  'exchange-byte-limit': { ...real, exchangeDepot: (v) => clone(v) },
  'writer-common-lock': { ...real, createProgressStore: (mem) => real.createProgressStore(mem, { locks: { request: (name, options, run) => run() } }) },
  'writer-stale-queue': bypassImport,
  'writer-import-wins': bypassIssue,
  'writer-immutable-issue': wrap((st) => ({ async issue(c, o) { await Promise.resolve(); return st.issue(c, o); } })),
  'writer-immutable-complete': wrap((st) => ({ async complete(r, o) { await Promise.resolve(); return st.complete(r, o); } })),
  'writer-same-award-edits': wrap((st) => ({ async complete(r, o) { const out = await st.complete(r, o); return { ...out, snapshot: r }; } })),
  'import-required-baseline': bypassImport,
  'import-raw-conflict': bypassImport,
  'import-corrupt-repair': bypassImport,
  'writer-quota-retry': unsafeRetryIssue,
  'writer-coordination-failure': { ...real, createProgressStore: (mem) => real.createProgressStore(mem, { locks: serialLocks() }) },
  'writer-invalid-current': bypassIssue,
};
let failed = 0;
const negative = process.argv.includes('--prove-fail');
for (const [name, run] of CHECKS) {
  try {
    await run(negative ? MUTANTS[name] : real, name);
    if (negative) { failed++; console.log(`NOT-CAUGHT ${name}`); } else console.log(`PASS ${name}`);
  } catch (err) {
    if (negative && err.message.startsWith(`${name}:`)) console.log(`CAUGHT ${err.message}`);
    else { failed++; console.log(`FAIL ${name}: ${err.message}`); }
  }
}
console.log(`test-save${negative ? ' prove-fail' : ''}: ${CHECKS.length - failed}/${CHECKS.length}`);
process.exitCode = failed ? 1 : 0;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prepareFieldScenario, loadFieldScenario, FIELD_LIMITS, PHASE_LIMITS } from '../src/sim/phase.js';
import { introScenario } from '../src/franchise/intro.js';
import { savedDeployment } from '../src/franchise/practice.js';
import { completedSnapshot } from '../src/franchise/save.js';
import { SAMPLE_ARMY } from '../src/reward/data.js';

const legacy = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
const copy = value => structuredClone(value), fresh = () => copy(legacy);
const api = { prepare: prepareFieldScenario, load: loadFieldScenario };
const bad = edit => { const value = fresh(); edit(value); return value; };
const refusal = /^(Error: (Phase:|Field:)|Error: Invalid field crate)/;
const rejects = (a, edits) => { for (const edit of edits) assert.throws(() => a.prepare(bad(edit), 'henry-hill'), refusal); };
const response = (body = JSON.stringify(legacy), headers = {}) => new Response(body, { headers });
const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); } };

// Observe application-owned guard and native body ordering, restoring the real descriptors exactly.
async function nativeGuardControl(a, kind) {
  const clone = Object.getOwnPropertyDescriptor(Response.prototype, 'clone');
  const buffer = Object.getOwnPropertyDescriptor(Response.prototype, 'arrayBuffer');
  const guards = []; let nativeStarts = 0, guardBytes = 0, guardEOF = false, owner = true, eofChecks = 0;
  const raw = new TextEncoder().encode(JSON.stringify(legacy));
  const bounded = async pending => {
    let timer;
    try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('unsettled invariant')), 5000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    Object.defineProperty(Response.prototype, 'clone', { ...clone, value: function (...args) {
      const copied = clone.value.apply(this, args), body = copied.body, getReader = body.getReader;
      guards.push(body);
      body.getReader = function (...args) {
        const reader = getReader.apply(this, args), read = reader.read;
        reader.read = async function (...args) { const value = await read.apply(this, args); guardBytes += value.value?.byteLength || 0; if (value.done) guardEOF = true; return value; };
        return reader;
      };
      return copied;
    } });
    const expected = Error('Owned native-consumption failure');
    Object.defineProperty(Response.prototype, 'arrayBuffer', { ...buffer, value: async function (...args) {
      nativeStarts++; assert.equal(guardEOF, true, 'native consumption follows guard EOF');
      assert.ok(guardBytes <= PHASE_LIMITS.bytes, 'native consumption follows the actual body bound');
      if (kind === 'native-rejection-after-EOF') throw expected;
      const bytes = await buffer.value.apply(this, args);
      if (kind === 'owner-after-native') owner = false;
      return bytes;
    } });
    if (kind.startsWith('guard-cancel-')) {
      const reason = kind.slice('guard-cancel-'.length); let release, seen, done = false, calls = 0;
      const cancelReady = new Promise(resolve => { seen = resolve; });
      const cancelHeld = new Promise(resolve => { release = resolve; });
      const stream = new ReadableStream({ start(c) {
        if (reason === 'body') c.enqueue(new Uint8Array(PHASE_LIMITS.bytes + 1));
        else if (reason === 'owner') c.enqueue(raw);
      }, cancel() { seen(); return cancelHeld; } });
      const pending = a.load({ isCurrent: () => reason !== 'owner' || ++calls < 3,
        fetcher: async () => new Response(stream, { headers: reason === 'announced' ? { 'content-length': String(PHASE_LIMITS.bytes + 1) } : {} }) }).finally(() => { done = true; });
      pending.catch(() => {});
      try {
        const first = await bounded(Promise.race([cancelReady.then(() => 'cancel'), pending.then(() => 'settled', () => 'settled')]));
        assert.equal(first, 'cancel', 'loader must request source cancellation before settling');
        assert.equal(done, false, 'loader retains ownership until source cancellation settles');
        assert.equal(nativeStarts, 0, 'refusal must precede native allocation');
        assert.equal(guards.length, reason === 'announced' ? 0 : 1, 'announced bound precedes cloning');
        release(); await assert.rejects(pending, /^Error: Field:/); assert.equal(done, true);
      } finally { release(); }
    } else if (kind === 'owner-after-native') {
      await assert.rejects(a.load({ isCurrent: () => owner, fetcher: async () => new Response(raw) }), /^Error: Field:/);
      assert.equal(nativeStarts, 1);
    } else if (kind === 'owner-after-EOF-before-native') {
      await assert.rejects(a.load({ isCurrent: () => !guardEOF || ++eofChecks < 2, fetcher: async () => new Response(raw) }), /^Error: Field:/);
      assert.equal(nativeStarts, 0); assert.equal(guardEOF, true);
    } else if (kind === 'native-rejection-after-EOF') {
      await assert.rejects(a.load({ fetcher: async () => new Response(raw) }), error => error === expected);
      assert.equal(nativeStarts, 1);
    } else {
      const split = Number(kind.slice('exact-bound-'.length)); let i = 0;
      const payload = new Uint8Array(PHASE_LIMITS.bytes).fill(32); payload.set(raw);
      const stream = new ReadableStream({ pull(c) {
        if (i === payload.length) { c.close(); return; }
        const stop = Math.min(payload.length, i + split); c.enqueue(payload.slice(i, stop)); i = stop;
      } });
      assert.deepEqual(await a.load({ fetcher: async () => new Response(stream) }), legacy);
      assert.equal(nativeStarts, 1); assert.equal(guardBytes, PHASE_LIMITS.bytes);
    }
    assert.ok(guards.every(body => !body.locked), 'application-owned guard reader released');
  } finally {
    Object.defineProperty(Response.prototype, 'clone', clone); Object.defineProperty(Response.prototype, 'arrayBuffer', buffer);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Response.prototype, 'clone'), clone);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Response.prototype, 'arrayBuffer'), buffer);
  }
}

export const FIELD_CHECKS = [
  ['original-scenarios', a => {
    const baseline = completedSnapshot({ awardId: 'field-baseline', seed: 'field-fixture', grade: 'Victory', army: copy(SAMPLE_ARMY.slice(0, 2)), depot: [], issued: [] });
    const manifest = savedDeployment({ baseline, ground: legacy, awardId: 'field-launch', seed: 'field-launch' });
    for (const input of [fresh(), introScenario(fresh()), manifest.scenario]) {
      const before = copy(input), out = a.prepare(input, input.id);
      assert.deepEqual(out, before); assert.deepEqual(input, before); assert.notEqual(out, input); frozen(out);
    }
    const input = fresh(), out = a.prepare(input, input.id); input.sites[0].x++;
    assert.equal(out.sites[0].x, legacy.sites[0].x);
  }],
  ['sites', a => {
    assert.ok(a.prepare(bad(s => { s.sites = Array.from({ length: FIELD_LIMITS.sites }, () => ({ x: 0, z: 0 })); }), 'henry-hill'));
    rejects(a, [s => { s.sites[0].x = '0'; }, s => { delete s.sites; }, s => { s.sites.push(...Array(FIELD_LIMITS.sites).fill({ x: 0, z: 0 })); }, s => { s.sites[0].embowered = 1; }, s => { s.sites[0].fenceRadius = -1; }]);
  }],
  ['buildings', a => {
    assert.ok(a.prepare(bad(s => { s.sites = [{ x: 0, z: 0, buildings: Array.from({ length: FIELD_LIMITS.buildings }, () => [0, 0, 1, 1, 1, 0, 'log-house']) }]; }), 'henry-hill'));
    rejects(a, [s => { s.sites[0].buildings[0][6] = 'toString'; }, s => { s.sites[0].buildings[0][2] = 0; }, s => { s.sites[0].buildings[0].push(1); }, s => { s.sites[0].buildings = Array(FIELD_LIMITS.buildings + 1).fill([0, 0, 1, 1, 1, 0, 'shed']); }]);
  }],
  ['orchards', a => {
    assert.ok(a.prepare(bad(s => { s.sites = [{ x: 0, z: 0, orchard: [0, 0, 64, 64, 0] }]; }), 'henry-hill'));
    rejects(a, [s => { s.sites[3].orchard[2] = 1.5; }, s => { s.sites[3].orchard = [0, 0, 65, 64, 0]; }, s => { s.sites[0].orchard = [0, 0, 64, 64, 0]; }, s => { s.sites[3].orchard = null; }]);
  }],
  ['woods', a => {
    assert.ok(a.prepare(bad(s => { s.woods = Array.from({ length: 4 }, () => ({ polygon: Array.from({ length: 1024 }, () => [0, 0]) })); }), 'henry-hill'));
    rejects(a, [s => { s.woods[0].polygon = [[0, 0], [1, 1]]; }, s => { s.woods[0].polygon[0] = [0, 0, 0]; }, s => { s.woods = Array.from({ length: 5 }, () => ({ polygon: Array.from({ length: 1024 }, () => [0, 0]) })); }, s => { s.woods[0].polygon[0][0] = 10001; }]);
  }],
  ['labels', a => {
    assert.ok(a.prepare(bad(s => { s.labels = [{ text: 'x'.repeat(160), x: 0, z: 0, height: 1 }]; }), 'henry-hill'));
    rejects(a, [s => { s.labels[0].height = Number.MIN_VALUE; }, s => { s.labels[0].text = 'x'.repeat(161); }, s => { s.labels[0].italic = 'true'; }, s => { s.labels = Array(65).fill(s.labels[0]); }, s => { s.labels[0].x = Infinity; }]);
  }],
  ['ai', a => {
    assert.ok(a.prepare(bad(s => { s.ai = { chargeReach: 170, note: 'Unchanged metadata' }; }), 'henry-hill'));
    rejects(a, [s => { s.ai = { chargeReach: 0 }; }, s => { s.ai = []; }, s => { s.ai = { chargeReach: '170' }; }]);
  }],
  ['route-flags', a => {
    assert.throws(() => a.prepare(legacy, 'first-command'), refusal);
    assert.throws(() => a.prepare(legacy, 'unsupported'), refusal);
    rejects(a, [s => { s.practiceIntro = true; }, s => { s.savedPractice = true; }, s => { s.practiceIntro = 'false'; }]);
    const intro = introScenario(fresh()); assert.throws(() => a.prepare({ ...intro, savedPractice: true }, 'first-command'), refusal);
    assert.throws(() => a.prepare({ ...intro, id: 'saved-practice' }, 'saved-practice'), refusal);
  }],
  ['crates', a => {
    const intro = introScenario(fresh()); assert.ok(a.prepare(intro, 'first-command'));
    intro.crates[0].r = 0; assert.throws(() => a.prepare(intro, 'first-command'), refusal);
    rejects(a, [s => { s.crates = null; }, s => { s.crates = [{ id: 'x', name: 'Generic diagnostic stores', tier: 'rare', x: 0, z: 0, r: 90 }, { id: 'x', name: 'Generic diagnostic stores', tier: 'rare', x: 0, z: 0, r: 90 }]; }]);
  }],
  ['unit-metadata', a => rejects(a, [s => { s.units[0].commander.name = []; }, s => { s.units[0].short = {}; }, s => { s.units[0].regiments = [1]; }, s => { s.units[0].commander.portrait = 1; }, s => { s.units[0].xp = 0; }, s => { s.units[0].xp = 5; }, s => { s.units[0].morale = 101; }, s => { s.units[0].men = 2000.5; }])],
  ['current-resource-bounds', a => {
    assert.ok(a.prepare(legacy, 'henry-hill'));
    rejects(a, [s => { s.units.push({ ...s.units[0], id: 'extra' }); }, s => { s.units[0].men = 100000; }, s => { s.units[3].guns = 25; }, s => { s.objective.x = 10001; }, s => { s.opening = [{ id: s.units[0].id, points: [[0, 0], [10001, 0]] }]; }]);
  }],
  ['strict-input', a => {
    let calls = 0; const s = fresh(); Object.defineProperty(s, 'extra', { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => a.prepare(s, 'henry-hill'), refusal); assert.equal(calls, 0);
    rejects(a, [s => { s.extra = s; }, s => { s.extra = undefined; }, s => { s.extra = 'x'.repeat(PHASE_LIMITS.bytes); }, s => { s.sites = [, s.sites[0]]; }]);
  }],
  ['fetch-http', async a => {
    await assert.rejects(a.load({ fetcher: async () => new Response('failure', { status: 503 }) }), /^Error: Field:/);
    for (const length of [String(PHASE_LIMITS.bytes + 1), '-1', 'abc']) {
      let cancelled = false;
      const stream = new ReadableStream({ cancel() { cancelled = true; } });
      await assert.rejects(a.load({ fetcher: async () => new Response(stream, { headers: { 'content-length': length } }) }), /^Error: Field:/);
      assert.equal(cancelled, true);
    }
  }],
  ['fetch-body', async a => {
    for (const headers of [{}, { 'content-length': '1' }]) {
      let cancelled = false, sent = false;
      const stream = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new Uint8Array(PHASE_LIMITS.bytes + 1)); } }, cancel() { cancelled = true; } });
      await assert.rejects(a.load({ fetcher: async () => new Response(stream, { headers }) }), /^Error: Field:/); assert.equal(cancelled, true);
    }
    await assert.rejects(a.load({ fetcher: async () => response('{bad-json') }), SyntaxError);
    await assert.rejects(a.load({ fetcher: async () => response(new Uint8Array([255])) }), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
    assert.deepEqual(await a.load({ fetcher: async () => response() }), legacy);
  }],
  ['fetch-owner', async a => {
    let current = false, fetched = false;
    await assert.rejects(a.load({ isCurrent: () => current, fetcher: async () => { fetched = true; return response(); } }), /^Error: Field:/); assert.equal(fetched, false);
    current = true; let release, settled = false, cancelled = false;
    const stream = new ReadableStream({ start(c) { release = () => c.enqueue(new TextEncoder().encode(JSON.stringify(legacy))); }, cancel() { cancelled = true; } });
    const pending = a.load({ isCurrent: () => current, fetcher: async () => new Response(stream) });
    const observed = pending.finally(() => { settled = true; }); observed.catch(() => {});
    await Promise.resolve(); await Promise.resolve(); current = false; await Promise.resolve();
    assert.equal(settled, false); release(); await assert.rejects(observed, /^Error: Field:/); assert.equal(cancelled, true);
  }],
  ...['guard-cancel-announced', 'guard-cancel-body', 'guard-cancel-owner', 'owner-after-native',
    'owner-after-EOF-before-native', 'native-rejection-after-EOF', 'exact-bound-4096', 'exact-bound-17']
    .map(name => [name, a => nativeGuardControl(a, name)]),
];

export async function fieldAdmissionUnit(candidate = api) {
  for (const [, verify] of FIELD_CHECKS) await verify(candidate);
  return FIELD_CHECKS.length;
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await fieldAdmissionUnit(); console.log(`FIELD ADMISSION OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const replacement = { sites: 'sites', buildings: 'sites', orchards: 'sites', woods: 'woods', labels: 'labels', ai: 'ai', crates: 'crates', 'unit-metadata': 'units', 'current-resource-bounds': 'units' };
    const rows = [];
    for (const [name, verify] of FIELD_CHECKS) {
      let mutant;
      if (name === 'original-scenarios') mutant = { ...api, prepare: input => input };
      else if (name === 'route-flags' || name === 'strict-input') mutant = { ...api, prepare: () => api.prepare(legacy, 'henry-hill') };
      else if (name.startsWith('fetch-') || ['guard-cancel-announced', 'guard-cancel-body', 'guard-cancel-owner', 'owner-after-native', 'owner-after-EOF-before-native', 'native-rejection-after-EOF', 'exact-bound-4096', 'exact-bound-17'].includes(name)) mutant = { ...api, load: async () => api.prepare(legacy, 'henry-hill') };
      else mutant = { ...api, prepare: (input, route) => { const value = copy(input), key = replacement[name]; if (Object.hasOwn(legacy, key)) value[key] = copy(legacy[key]); else delete value[key]; return api.prepare(value, route); } };
      let error; try { await verify(mutant); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', name + ' must reject its own mutant through the intended assertion');
      rows.push({ category: name, code: error.code, ...(name.startsWith('guard-cancel-') ? { message: error.message } : {}) });
    }
    console.log('FIELD ADMISSION CONTROLS ' + JSON.stringify(rows));
    console.log(`FIELD ADMISSION CONTROLS OK (${rows.length}/${count})`);
  }
}

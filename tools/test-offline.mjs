// tools/test-offline.mjs: the installed app plays offline (DESIGN §4b "loaded battles work offline").
//
//   node tools/test-offline.mjs
//
// Chromium on a local server with ?sw (src/entry.js and src/main.js register sw.js on https, or with ?sw for tests):
// 1. the title registers the service worker and it takes control; 2. the title and a battle are visited online so
// the worker caches what they load; 3. the browser goes offline; the title reloads from the cache and the same battle
// loads on its own terrain and runs 10 s; 4. back online, the worker still answers. Fails on any page error.
// Runs on CI (job "browsers" matrix entry "offline"); the Mac never launches a browser.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from './serve.mjs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// Diagnostic only: never routes a request, changes a worker or retries a failed operation.
export function offlineRecorder() {
  const events = [], observerErrors = [];
  let bytes = 0, overflow = false, sequence = 0;
  const record = (event, detail = {}) => {
    try {
      const row = { sequence: sequence++, ms: performance.now(), event, ...detail }, encoded = JSON.stringify(row);
      const size = new TextEncoder().encode(encoded).length;
      if (events.length >= 2048 || bytes + size > 1048576) { overflow = true; return; }
      events.push(JSON.parse(encoded)); bytes += size;
    } catch { if (observerErrors.length < 16) observerErrors.push('event serialization'); }
  };
  return { record, read: () => JSON.parse(JSON.stringify({ events, bytes, overflow, observerErrors })) };
}

// Passive, separately bounded diagnostic. CDP timestamps stay in their original
// clock domain; nodeMs is receipt time, and sequence is collector order only.
export function offlineAdmissionError(value) {
  const type = value === null ? 'null' : typeof value;
  const primitive = v => v === null ? 'null' : ['string', 'number', 'boolean', 'undefined', 'bigint', 'symbol'].includes(typeof v) ? String(v) : null;
  let message = primitive(value), descriptorFailure = false;
  if (message === null) {
    try {
      const d = Object.getOwnPropertyDescriptor(value, 'message');
      message = d && Object.hasOwn(d, 'value') ? primitive(d.value) : null;
    } catch { descriptorFailure = true; }
    if (message === null) message = 'non-primitive thrown value without an own data message';
  }
  return { type, message: message.slice(0, 4096), messageTruncated: message.length > 4096, descriptorFailure };
}
export function offlineAdmissionRecorder() {
  const events = [], errors = []; let bytes = 0, overflow = false, frozen = false, late = 0;
  const fault = (stage, value) => { if (errors.length < 32) errors.push({ stage, ...offlineAdmissionError(value) }); };
  const clone = input => {
    let nodes = 0;
    const walk = (value, depth) => {
      if (++nodes > 65536 || depth > 32) throw Error('metadata nesting/node bound');
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('nonfinite metadata'); return value; }
      if (typeof value === 'string') { if (new TextEncoder().encode(value).length > 262144) throw Error('metadata string bound'); return value; }
      if (typeof value !== 'object') throw Error('non-JSON metadata');
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) throw Error('non-JSON metadata');
      const array = Array.isArray(value), keys = Reflect.ownKeys(value), copy = array ? [] : Object.create(null);
      if (array) Object.setPrototypeOf(copy, null);
      if (keys.length > (array ? 8193 : 256)) throw Error('metadata key bound');
      for (const key of keys) {
        if (typeof key !== 'string' || new TextEncoder().encode(key).length > 4096) throw Error('metadata key type/size');
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d || !Object.hasOwn(d, 'value')) throw Error('metadata accessor');
        if (array && key === 'length') { if (!Number.isSafeInteger(d.value) || d.value > 8192 || keys.length !== d.value + 1) throw Error('sparse/oversized metadata array'); continue; }
        if (!d.enumerable || array && !/^(0|[1-9][0-9]*)$/.test(key)) throw Error('non-JSON property');
        Object.defineProperty(copy, key, { value: walk(d.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return copy;
    };
    return walk(input, 0);
  };
  const record = (event, raw = {}, stage = 'registration') => {
    if (frozen) { late++; return; }
    try {
      const row = { sequence: events.length, nodeMs: performance.now(), session: 'page-1', stage, event, raw: clone(raw) },
        size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (events.length >= 8192 || bytes + size > 4194304) { overflow = true; return; }
      events.push(row); bytes += size;
    } catch (error) { fault('record', error); }
  };
  const read = () => JSON.parse(JSON.stringify({ clocks: { nodeMs: 'Node performance.now receipt milliseconds',
    cdpTimestamp: 'raw CDP monotonic seconds; not synchronized to nodeMs' }, events, bytes, overflow, errors, late }));
  return { record, fault, read, freeze() { frozen = true; return read(); } };
}

export function offlineAdmissionSession(session, recorder, stage) {
  const methods = Object.fromEntries(['on', 'removeListener', 'send', 'detach'].map(k => [k, session[k]])), listeners = [];
  let started = false, closed = false, setupComplete = false;
  const cleanup = { attempted: false, removed: 0, detached: false, errors: [] };
  const failure = (where, error) => { cleanup.errors.push({ stage: where, ...offlineAdmissionError(error) }); };
  return {
    async start() {
      if (started) throw Error('offline admission: duplicate setup'); started = true;
      try {
        const open = () => { if (closed) throw Error('offline admission: closed setup'); };
        open();
        for (const name of ['Network.requestWillBeSent', 'Network.requestWillBeSentExtraInfo', 'Network.responseReceived',
          'Network.responseReceivedExtraInfo', 'Network.loadingFinished', 'Network.loadingFailed', 'Network.requestServedFromCache',
          'Page.frameNavigated', 'Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.lifecycleEvent',
          'ServiceWorker.workerRegistrationUpdated', 'ServiceWorker.workerVersionUpdated', 'ServiceWorker.workerErrorReported']) {
          open();
          const listener = raw => recorder.record(name, raw, stage());
          listeners.push([name, listener]); Reflect.apply(methods.on, session, [name, listener]);
          open();
        }
        for (const [command, parameters] of [['Network.enable', {}], ['Page.enable', {}],
          ['Page.setLifecycleEventsEnabled', { enabled: true }], ['ServiceWorker.enable', {}]]) {
          open();
          recorder.record('setup-command', { command }, stage());
          await Reflect.apply(methods.send, session, [command, parameters]);
          open();
          recorder.record('setup-return', { command }, stage());
        }
        setupComplete = true; recorder.record('setup-complete', {}, stage());
      } catch (error) { recorder.fault('setup', error); throw error; }
    },
    get setupComplete() { return setupComplete; },
    async close() {
      if (closed) return cleanup; closed = true; cleanup.attempted = true;
      for (const [name, listener] of listeners) {
        try { Reflect.apply(methods.removeListener, session, [name, listener]); cleanup.removed++; }
        catch (error) { failure('remove:' + name, error); }
      }
      try { await Reflect.apply(methods.detach, session, []); cleanup.detached = true; }
      catch (error) { failure('detach', error); }
      return cleanup;
    },
  };
}

export function offlineAdmissionSetup(create, recorder, stage, timers = { set: setTimeout, clear: clearTimeout }) {
  let owner = null, closed = false, started = false;
  const empty = { attempted: false, removed: 0, detached: false, errors: [] };
  return {
    get setupComplete() { return !closed && owner?.setupComplete === true; },
    async start() {
      if (started || closed) throw Error('offline admission: duplicate/closed setup'); started = true;
      let timer;
      const deadline = new Promise((resolve, reject) => { timer = timers.set(() => {
        closed = true; recorder.fault('setup-deadline', 'diagnostic setup exceeded 20000ms');
        if (owner) owner.close().catch(error => recorder.fault('deadline-cleanup', error));
        reject(Error('offline admission: diagnostic setup deadline'));
      }, 20000); });
      const pending = (async () => {
        const session = await create();
        owner = offlineAdmissionSession(session, recorder, stage);
        if (closed) { await owner.close(); throw Error('offline admission: late session'); }
        await owner.start();
        if (closed) throw Error('offline admission: late setup');
      })();
      try { await Promise.race([pending, deadline]); }
      finally { timers.clear(timer); }
    },
    async close() { closed = true; return owner ? owner.close() : empty; },
  };
}

export async function closeOfflineAdmission(owner, mark = () => {}, timers = { set: setTimeout, clear: clearTimeout }) {
  let timer, timedOut = false; const markerErrors = [];
  const signal = name => { try { mark(name); } catch (error) { markerErrors.push({ stage: 'cleanup-marker', ...offlineAdmissionError(error) }); } };
  const failed = (stage, error) => ({ attempted: true, removed: null, detached: false, timedOut,
    errors: [{ stage, ...offlineAdmissionError(error) }] });
  const snapshot = value => {
    const own = (object, key) => { const d = Object.getOwnPropertyDescriptor(object, key);
      if (!d || !Object.hasOwn(d, 'value')) throw Error('cleanup receipt data required'); return d.value; };
    const attempted = own(value, 'attempted'), removed = own(value, 'removed'), detached = own(value, 'detached'), errors = own(value, 'errors');
    if (typeof attempted !== 'boolean' || !Number.isSafeInteger(removed) || removed < 0 || removed > 14
      || typeof detached !== 'boolean' || !Array.isArray(errors) || errors.length > 32) throw Error('cleanup receipt shape');
    const copy = [];
    for (let i = 0; i < errors.length; i++) {
      const input = own(errors, String(i)), row = {};
      for (const key of ['stage', 'type', 'message']) {
        const text = own(input, key); if (typeof text !== 'string' || text.length > 4096) throw Error('cleanup error shape'); row[key] = text;
      }
      copy.push(Object.freeze(row));
    }
    return { attempted, removed, detached, timedOut: false, errors: copy };
  };
  signal('detach:start');
  const deadline = new Promise(resolve => { timer = timers.set(() => {
    timedOut = true; signal('detach:deadline'); resolve(failed('detach-deadline', 'diagnostic detach exceeded 5000ms'));
  }, 5000); });
  const closing = (async () => {
    try { const value = await owner.close(); signal(timedOut ? 'detach:late-return' : 'detach:return');
      return timedOut ? failed('detach-late', 'late completion cannot heal timeout') : snapshot(value);
    } catch (error) { signal(timedOut ? 'detach:late-rejection' : 'detach:rejection'); return failed('detach', error); }
  })();
  try {
    const result = await Promise.race([closing, deadline]);
    return Object.freeze({ ...result, errors: Object.freeze([...result.errors, ...markerErrors.map(Object.freeze)]) });
  } finally { timers.clear(timer); }
}

export function readOfflineAdmissionTrace(report) {
  const refuse = () => { throw Error('offline admission: invalid diagnostic'); }, p = report?.primary;
  if (report?.schema !== 'offline-admission-v1' || !p || p.setupComplete !== true || !Array.isArray(p.trace?.events)
    || p.trace.overflow !== false || !Array.isArray(p.trace.errors) || p.trace.errors.length || !Array.isArray(report.cleanup?.errors) || report.cleanup.errors.length
    || report.persistenceErrors !== undefined && (!Array.isArray(report.persistenceErrors) || report.persistenceErrors.length)
    || report.cleanup?.attempted !== true || report.cleanup.detached !== true || report.cleanup.removed !== 14 || report.cleanup.timedOut !== false) refuse();
  if (p.trace.clocks?.nodeMs !== 'Node performance.now receipt milliseconds'
    || p.trace.clocks.cdpTimestamp !== 'raw CDP monotonic seconds; not synchronized to nodeMs') refuse();
  const setup = p.trace.events.filter(e => e.event.startsWith('setup-')).map(e => [e.event, e.raw.command ?? null]);
  const expectedSetup = [];
  for (const name of ['Network.enable', 'Page.enable', 'Page.setLifecycleEventsEnabled', 'ServiceWorker.enable'])
    expectedSetup.push(['setup-command', name], ['setup-return', name]);
  expectedSetup.push(['setup-complete', null]);
  if (JSON.stringify(setup) !== JSON.stringify(expectedSetup)) refuse();
  const navigation = p.trace.events.filter(e => e.event === 'boundary' && e.raw.operation === 'first-title-goto:start');
  if (navigation.length !== 1 || navigation[0].sequence <= p.trace.events.find(e => e.event === 'setup-complete').sequence) refuse();
  const active = new Map(); let bytes = 0, requests = 0, redirects = 0, terminals = 0, orphans = 0;
  for (const [i, row] of p.trace.events.entries()) {
    if (row.sequence !== i || row.session !== 'page-1' || !Number.isFinite(row.nodeMs) || typeof row.stage !== 'string') refuse();
    bytes += new TextEncoder().encode(JSON.stringify(row)).length;
    const r = row.raw;
    if (row.event.startsWith('Network.')) {
      if (!r || typeof r.requestId !== 'string' || !r.requestId) refuse();
      const key = row.session + ':' + r.requestId;
      if (row.event === 'Network.requestWillBeSent') {
        if (typeof r.loaderId !== 'string' || typeof r.request?.url !== 'string' || typeof r.request.method !== 'string'
          || !Number.isFinite(r.timestamp) || r.frameId !== undefined && typeof r.frameId !== 'string') refuse();
        const old = active.get(key);
        if (old && !old.terminal) { if (!r.redirectResponse) refuse(); redirects++; }
        active.set(key, { terminal: false }); requests++;
      } else if (['Network.loadingFinished', 'Network.loadingFailed'].includes(row.event)) {
        if (!Number.isFinite(r.timestamp)) refuse();
        if (row.event === 'Network.loadingFailed' && (typeof r.errorText !== 'string'
          || r.canceled !== undefined && typeof r.canceled !== 'boolean')) refuse();
        const old = active.get(key); if (old?.terminal) refuse();
        if (old) old.terminal = true; else { active.set(key, { terminal: true }); orphans++; } terminals++;
      }
    }
  }
  if (p.trace.events.length > 8192 || bytes !== p.trace.bytes || bytes > 4194304) refuse();
  return { requests, redirects, terminals, orphans, missingTerminals: [...active.values()].filter(r => !r.terminal).length };
}

export async function writeOfflineAdmissionReport({ report, phase, write, hash, log }) {
  const bytes = new TextEncoder().encode(JSON.stringify(report, null, 1));
  await write(bytes);
  const receipt = { phase, run: report.run, sha: report.sha, bytes: bytes.byteLength, sha256: hash(bytes) };
  log('OFFLINE_ADMISSION_TRACE_PERSISTED ' + JSON.stringify(receipt)); return receipt;
}

// Runs in the page. Named CacheStorage reads do not create a missing cache.
export async function inspectOfflineCaches({ scope, expected, hashes }) {
  let expired = false;
  const readers = new Set(), guard = () => { if (expired) throw Error('inventory deadline'); };
  const timer = setTimeout(() => {
    expired = true;
    for (const reader of readers) reader.cancel().catch(() => {});
  }, 9000);
  const step = async operation => { guard(); const value = await operation(); guard(); return value; };
  const body = async (response, limit) => {
    const reader = response.body?.getReader();
    if (!reader) return { bytes: new Uint8Array(), truncated: false };
    readers.add(reader);
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await step(() => reader.read());
        if (done) break;
        if (size + value.byteLength > limit) {
          await reader.cancel(); return { bytes: null, truncated: true };
        }
        chunks.push(value); size += value.byteLength;
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, truncated: false };
    } finally { readers.delete(reader); reader.releaseLock(); }
  };
  try {
  const registration = await step(() => navigator.serviceWorker.getRegistration());
  const identity = worker => worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
  const names = await step(() => caches.keys()), result = { hashes, controller: identity(navigator.serviceWorker.controller),
    registration: registration ? { scope: registration.scope, active: identity(registration.active),
      waiting: identity(registration.waiting), installing: identity(registration.installing) } : null,
    caches: [], observerErrors: [] };
  if (names.length > 4 || Object.keys(expected).length > 128) throw Error('offline cache inventory bound');
  for (const name of names) {
    const metadata = await step(() => caches.match(new URL('__cw_offline_admission__', scope).href, { cacheName: name }));
    const admission = metadata ? await body(metadata, 32768) : null;
    const row = { name, admission: admission?.bytes ? new TextDecoder().decode(admission.bytes) : null,
      admissionTruncated: admission?.truncated ?? false, members: [] }; result.caches.push(row);
    if (row.admissionTruncated) result.observerErrors.push('admission body bound');
    for (const [p, f] of Object.entries(expected)) {
      try {
        const response = await step(() => caches.match(new URL(p, scope).href, { cacheName: name }));
        if (!response) { row.members.push({ path: p, present: false }); continue; }
        const member = { path: p, present: true, status: response.status, type: response.type,
          mime: response.headers.get('content-type'), declaredBytes: response.headers.get('content-length') };
        row.members.push(member);
        if (hashes) {
          if (f.bytes >= 100000000 || Number(member.declaredBytes) >= 100000000) throw Error('oversized cached response');
          const read = await body(response, Math.min(99000000, f.bytes + 1));
          if (read.truncated) { member.bodyTruncated = true; throw Error('cached body bound'); }
          const bytes = read.bytes;
          member.bytes = bytes.byteLength;
          member.sha256 = Array.from(new Uint8Array(await step(() => crypto.subtle.digest('SHA-256', bytes))), b => b.toString(16).padStart(2, '0')).join('');
          member.matches = member.bytes === f.bytes && member.sha256 === f.sha256;
        }
      } catch { if (result.observerErrors.length < 16) result.observerErrors.push(name + ':' + p); }
      if (expired) return result;
    }
  }
  return result;
  } finally { clearTimeout(timer); }
}

const OUT = path.join(ROOT, '.out', process.env.OFFLINE_OUT_DIR ?? 'offline');
// OFFLINE_OUT_DIR (a bare name under .out/, default "offline") lets CI keep two samples from one push. The line above
// stays first and uncommented: tools/test-offline-worker.mjs evaluates everything before "const OUT =" without process.
const OUT_NAME = process.env.OFFLINE_OUT_DIR ?? 'offline';
if (!OUT_NAME || OUT_NAME === '.' || /[\/\\]/.test(OUT_NAME) || OUT_NAME.includes('..')) { console.error('offline: OFFLINE_OUT_DIR must be a bare directory name'); process.exit(1); }
const cli = process.argv.slice(2), traceAdmission = cli.length === 1 && cli[0] === '--trace-admission';
if (cli.length && !traceAdmission) { console.error('offline: unknown diagnostic option'); process.exit(1); }
await fs.mkdir(OUT, { recursive: true });
const results = [];
const diagnostic = offlineRecorder(), audits = [], auditErrors = [], cleanupErrors = [];
const manifestBox = {};
vm.runInNewContext(await fs.readFile(path.join(ROOT, 'offline-manifest.js'), 'utf8'), { self: manifestBox });
const manifest = manifestBox.CW_OFFLINE;
const auditPaths = [...new Set([...manifest.base, 'assets/packs/shiloh.json', ...manifest.groups['terrain:shiloh'].members])];
const expected = Object.fromEntries(auditPaths.map(p => [p, manifest.files[p]]));
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${detail}`); };
const BATTLE = '?battle=shiloh&phase=camps-at-dawn&quality=low&sw';

// --trace-admission extras (Decision 0274): netlog, a browser trace of the online battle load, long tasks and the
// failure page. Best-effort: each fault lands in diagnosticErrors and never changes the OFFLINE OK/FAILED verdict.
const diagnosticErrors = [], longTasks = {}, deepTrace = traceAdmission ? { started: false, ended: false, file: null,
  bytes: 0, truncated: false, dataLossOccurred: null, detached: false } : null;
let failureState = null, traceSession = null;
const diagFault = (where, error) => { if (diagnosticErrors.length < 64) diagnosticErrors.push({ stage: where, ...offlineAdmissionError(error) }); };
const within = (promise, ms, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => {
  timer = setTimeout(() => reject(Error(label + ' exceeded ' + ms + 'ms')), ms); })]).finally(() => clearTimeout(timer)); };
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (traceAdmission) {
  try { launchArgs.push('--log-net-log=' + path.join(OUT, 'netlog.json'), '--net-log-capture-mode=Default'); }
  catch (error) { diagFault('netlog-args', error); }
}
const TRACE_LIMIT = 96 * 1024 * 1024;
const traceStart = async () => {
  if (!traceAdmission) return;
  try {
    traceSession = await browser.newBrowserCDPSession();
    await traceSession.send('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', includedCategories: ['blink', 'blink.net',
      'blink.resource', 'blink.user_timing', 'loading', 'navigation', 'ServiceWorker', 'devtools.timeline',
      'disabled-by-default-devtools.timeline', 'v8', 'v8.execute', 'toplevel', 'ipc', 'mojom', 'net', 'safe_browsing', 'benchmark'],
      excludedCategories: ['*'] }, transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'gzip' });
    deepTrace.started = true;
  } catch (error) { diagFault('trace-start', error); }
};
const traceEnd = async () => {
  if (!traceSession || deepTrace.ended) return;
  deepTrace.ended = true;
  const session = traceSession; let listener;
  try {
    if (!deepTrace.started) throw Error('tracing never started');
    const complete = within(new Promise(resolve => { listener = resolve; session.on('Tracing.tracingComplete', listener); }), 60000, 'Tracing.tracingComplete');
    complete.catch(() => {});
    await session.send('Tracing.end');
    const { stream, dataLossOccurred } = await complete;
    deepTrace.dataLossOccurred = dataLossOccurred ?? null;
    if (!stream) throw Error('tracingComplete carried no stream');
    const file = path.join(OUT, 'trace-online-battle.json.gz'), handle = await fs.open(file, 'w');
    deepTrace.file = path.relative(ROOT, file);
    try {
      while (true) {
        const { data, eof, base64Encoded } = await within(session.send('IO.read', { handle: stream, size: 1048576 }), 30000, 'IO.read');
        const chunk = Buffer.from(data ?? '', base64Encoded ? 'base64' : 'utf8');
        if (deepTrace.bytes + chunk.length > TRACE_LIMIT) {
          const room = TRACE_LIMIT - deepTrace.bytes;
          if (room > 0) { await handle.write(chunk.subarray(0, room)); deepTrace.bytes += room; }
          deepTrace.truncated = true; break;
        }
        if (chunk.length) { await handle.write(chunk); deepTrace.bytes += chunk.length; }
        if (eof) break;
      }
    } finally { await handle.close(); }
    try { await within(session.send('IO.close', { handle: stream }), 10000, 'IO.close'); } catch (error) { diagFault('trace-io-close', error); }
  } catch (error) { diagFault('trace-end', error); }
  finally {
    try { if (listener) session.removeListener('Tracing.tracingComplete', listener); } catch (error) { diagFault('trace-listener', error); }
    try { await within(session.detach(), 10000, 'trace detach'); deepTrace.detached = true; } catch (error) { diagFault('trace-detach', error); }
  }
};
const readLongTasks = async label => {
  if (!traceAdmission) return;
  try { longTasks[label] = await within(page.evaluate(() => { const rows = Array.isArray(window.__longTasks) ? window.__longTasks : [];
    return { count: rows.length, rows: rows.slice(0, 256) }; }), 10000, 'long-task read'); }
  catch (error) { diagFault('longtasks:' + label, error); }
};

const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({ headless: true, args: launchArgs });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(), errors = [];
let stage = 'registration', nextRequest = 0;
const admission = traceAdmission ? { recorder: offlineAdmissionRecorder(), owner: null, primary: null,
  cleanup: { attempted: false, removed: 0, detached: false, errors: [] }, persistenceErrors: [], primaryFailure: null } : null;
const admissionMark = (operation, detail = {}) => admission?.recorder.record('boundary', { operation, ...detail }, stage);
const admissionPersist = async phase => {
  if (!admission) return;
  try {
    await writeOfflineAdmissionReport({ report: { schema: 'offline-admission-v1', run: process.env.GITHUB_RUN_ID ?? null,
      sha: process.env.GITHUB_SHA ?? null, primary: admission.primary, cleanup: admission.cleanup,
      persistenceErrors: admission.persistenceErrors }, phase,
      write: bytes => fs.writeFile(path.join(OUT, 'admission-trace.json'), bytes),
      hash: bytes => createHash('sha256').update(bytes).digest('hex'), log: message => console.log(message) });
  } catch (error) { admission.persistenceErrors.push({ phase, ...offlineAdmissionError(error) }); }
};
const admissionCleanupMark = phase => {
  if (!admission) return;
  try { console.log('OFFLINE_ADMISSION_CLEANUP ' + JSON.stringify({ run: process.env.GITHUB_RUN_ID ?? null,
    sha: process.env.GITHUB_SHA ?? null, phase })); }
  catch (error) { admission.persistenceErrors.push({ phase: 'cleanup-marker', ...offlineAdmissionError(error) }); }
};
const requestIds = new WeakMap();
const requestId = req => { if (!requestIds.has(req)) requestIds.set(req, ++nextRequest); return requestIds.get(req); };
const describe = req => ({ stage, request: requestId(req), url: req.url(), method: req.method(), type: req.resourceType(),
  serviceWorker: req.serviceWorker()?.url() ?? null });
const listen = (emitter, event, callback) => emitter.on(event, (...args) => {
  try { callback(...args); } catch { diagnostic.record('observer-error', { stage, operation: event }); }
});
listen(ctx, 'request', req => diagnostic.record('request', describe(req)));
listen(ctx, 'response', res => diagnostic.record('response', { ...describe(res.request()), status: res.status(),
  mime: res.headers()['content-type'] ?? null, worker: res.fromServiceWorker() }));
listen(ctx, 'requestfinished', req => diagnostic.record('requestfinished', describe(req)));
listen(ctx, 'requestfailed', req => diagnostic.record('requestfailed', { ...describe(req), failure: req.failure() }));
listen(page, 'pageerror', error => diagnostic.record('pageerror', { stage, message: error.message, stack: error.stack }));
listen(page, 'console', msg => diagnostic.record('page-console', { stage, type: msg.type(), text: msg.text() }));
listen(ctx, 'serviceworker', worker => {
  diagnostic.record('serviceworker', { stage, url: worker.url() });
  listen(worker, 'console', msg => diagnostic.record('worker-console', { stage, type: msg.type(), text: msg.text() }));
  listen(worker, 'close', () => diagnostic.record('worker-close', { stage, url: worker.url() }));
});
const audit = async hashes => {
  let timer;
  try { audits.push({ stage, ...await Promise.race([
    page.evaluate(inspectOfflineCaches, { scope: url, expected, hashes }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('inventory deadline')), 10000); }),
  ]) }); }
  catch { auditErrors.push({ stage, operation: 'cache inventory' }); }
  finally { clearTimeout(timer); }
};
const persist = () => fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({ results, diagnostic: {
  generation: manifest.generation, ...diagnostic.read(), expected, audits, auditErrors, cleanupErrors,
  outDir: OUT_NAME, diagnosticErrors, longTasks, failureState, deepTrace } }, null, 1));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
const battleReady = () => page.waitForFunction(() => window.__ready === true, null, { timeout: 240_000, polling: 500 });
if (traceAdmission) {
  try {
    await ctx.addInitScript(() => {
      try {
        new PerformanceObserver(list => { (window.__longTasks ??= []).push(...list.getEntries().map(e => ({ start: e.startTime,
          duration: e.duration, name: e.name, container: e.attribution?.[0]?.containerSrc ?? null }))); }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });
  } catch (error) { diagFault('longtask-init', error); }
}
try {
  if (admission) {
    admission.owner = offlineAdmissionSetup(() => ctx.newCDPSession(page), admission.recorder, () => stage);
    await admission.owner.start();
  }
  // 1. registration and control
  admissionMark('first-title-goto:start');
  await page.goto(`${url}?sw`);
  admissionMark('first-title-goto:return');
  admissionMark('controller-wait:start');
  await page.waitForFunction(() => navigator.serviceWorker?.controller || null, null, { timeout: 60_000 }).catch(() => {});
  admissionMark('controller-wait:return');
  if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) { admissionMark('control-reload:start'); await page.reload(); admissionMark('control-reload:return'); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 }); }
  const sw = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, scope: (await navigator.serviceWorker.getRegistration())?.scope }));
  check('sw-controls', sw.controlled, JSON.stringify(sw));
  // 2. visit the title and one battle online, through the worker
  admissionMark('controlled-title-reload:start');
  await page.reload(); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  admissionMark('controlled-title-ready');
  await traceStart();
  admissionMark('online-battle-goto:start', { url: url + BATTLE });
  await page.goto(url + BATTLE); await battleReady(); await page.waitForTimeout(3000);
  admissionMark('online-battle-ready');
  await traceEnd(); await readLongTasks('online-battle-ready');
  const cached = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
  check('cache-filled', cached > 50, `${cached} cached responses after the title and one battle`);
  stage = 'before-offline'; await audit(false);
  // 3. offline
  admissionMark('offline-transition:start');
  await ctx.setOffline(true);
  admissionMark('offline-title-goto:start');
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  admissionMark('offline-title-ready');
  await page.screenshot({ path: path.join(OUT, 'offline-title.png') });
  check('offline-title', await page.evaluate(() => window.__entry.mode === 'title'), 'the title opens with no network');
  stage = 'after-offline-title'; await audit(false);
  stage = 'offline-battle';
  admissionMark('offline-battle-goto:start');
  await page.goto(url + BATTLE); await battleReady();
  admissionMark('offline-battle-ready');
  await readLongTasks('offline-battle-ready');
  const run = await page.evaluate(() => {
    const { game, pack, terrain } = window.__game, t0 = game.simTime;
    if (game.paused) game.togglePause();
    game.fastForward(10);
    return { pack: pack?.phaseId, terrain: terrain.meta.name, units: game.units.length, advanced: Math.round(game.simTime - t0) };
  });
  await page.screenshot({ path: path.join(OUT, 'offline-battle.png') });
  check('offline-battle', run.pack === 'camps-at-dawn' && run.units > 0 && run.advanced >= 9, JSON.stringify(run));
  // 4. back online
  admissionMark('online-transition:start');
  await ctx.setOffline(false);
  stage = 'online-again';
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  admissionMark('online-again-title-ready');
  check('online-again', await page.evaluate(() => !!navigator.serviceWorker.controller), 'the worker still controls the page online');
  check('no-errors', errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'no page or console errors');
} catch (e) {
  if (admission) { admission.primaryFailure = offlineAdmissionError(e); admissionMark('primary-failure', admission.primaryFailure); }
  check('harness', false, `${offlineAdmissionError(e).message.split('\n')[0]} | ${errors.slice(0, 3).join(' | ')}`);
  if (traceAdmission) {
    await traceEnd();
    try { failureState = await within(page.evaluate(() => ({ href: location.href, entryMode: window.__entry?.mode ?? null,
      ready: window.__ready ?? null, failureHeading: document.getElementById('field-failure-heading')?.textContent ?? null,
      failureNote: document.getElementById('entry-note')?.textContent ?? null, bodyText: document.body?.innerText?.slice(0, 2000) ?? null })),
      10000, 'failure state'); }
    catch (error) { diagFault('failure-state', error); }
    await readLongTasks('primary-failure');
    try { await page.screenshot({ path: path.join(OUT, 'offline-failure.png'), timeout: 10000 }); } catch (error) { diagFault('failure-screenshot', error); }
  }
  stage = 'first-failure'; await audit(true);
} finally {
  // Freeze the primary result before cleanup; a stuck close cannot erase it.
  const terminal = setTimeout(() => process.exit(1), 20000);
  try {
    let admissionPrimaryWrite;
    if (admission) {
      try {
        admissionMark('primary-freeze-before-cleanup');
        admission.primary = { setupComplete: admission.owner?.setupComplete ?? false, primaryFailure: admission.primaryFailure,
          results: JSON.parse(JSON.stringify(results)), trace: admission.recorder.freeze() };
        admissionCleanupMark('primary-trace:start');
        admissionPrimaryWrite = admissionPersist('primary').then(() => admissionCleanupMark('primary-trace:return'));
      } catch (error) { admission.persistenceErrors.push({ phase: 'freeze', ...offlineAdmissionError(error) }); }
    }
    admissionCleanupMark('primary-result:start');
    try { await persist(); } catch { cleanupErrors.push('primary persistence'); }
    admissionCleanupMark('primary-result:return');
    if (admission?.owner) {
      try { admission.cleanup = await closeOfflineAdmission(admission.owner, admissionCleanupMark); }
      catch (error) { admission.cleanup = { attempted: true, removed: null, detached: false, timedOut: false,
        errors: [{ stage: 'cleanup-wrapper', ...offlineAdmissionError(error) }] }; }
    }
    admissionCleanupMark('browser-close:start');
    try { await browser.close(); } catch { cleanupErrors.push('browser close'); }
    admissionCleanupMark('browser-close:return');
    admissionCleanupMark('server-close:start');
    try { server.close(); } catch { cleanupErrors.push('server close'); }
    admissionCleanupMark('server-close:return');
    admissionCleanupMark('final-result:start');
    try { await persist(); } catch { cleanupErrors.push('final persistence'); }
    admissionCleanupMark('final-result:return');
    if (admission) {
      admission.cleanup = { ...admission.cleanup, postFreezeEvents: admission.recorder.read().late };
      admissionCleanupMark('primary-trace-join:start');
      await admissionPrimaryWrite;
      admissionCleanupMark('primary-trace-join:return');
      admissionCleanupMark('final-trace:start');
      await admissionPersist('final');
      admissionCleanupMark('final-trace:return');
    }
  } finally { clearTimeout(terminal); }
}
const failed = results.filter((r) => !r.ok);
const receipt = diagnostic.read(), invalid = receipt.overflow || receipt.observerErrors.length || receipt.events.some(r => r.event === 'observer-error')
  || auditErrors.length || audits.some(r => r.observerErrors.length) || cleanupErrors.length;
let admissionInvalid = false;
if (admission) { try { readOfflineAdmissionTrace({ schema: 'offline-admission-v1', primary: admission.primary, cleanup: admission.cleanup });
  if (admission.persistenceErrors.length) throw Error('trace persistence'); } catch { admissionInvalid = true; } }
console.log(failed.length || invalid || admissionInvalid ? `OFFLINE FAILED (${results.length - failed.length}/${results.length}; diagnostic invalid=${!!invalid}${admission ? '; admission invalid=' + admissionInvalid : ''})` : `OFFLINE OK (${results.length}/${results.length})`);
process.exit(failed.length || invalid || admissionInvalid ? 1 : 0);

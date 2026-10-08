import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AxeBuilder } from '@axe-core/playwright';
import { deploymentFixture } from './test-deployment-ui.mjs';
import { exportSnapshot, validateSnapshot } from '../src/franchise/save.js';
import { introScenario } from '../src/franchise/intro.js';
import { probeProgress, progressRaw, seedProgress } from './test-progress-browser.mjs';

const accepted = '4f6113a624e0e533825c0be414bb36f3b073f726';
const pattern = '**/assets/scenarios/henry-hill.json';
export async function fieldAdmissionControls({ browser, url, check, shot, result, watchErrors, native }) {
  const groundText = await fs.readFile(new URL('../assets/scenarios/henry-hill.json', import.meta.url), 'utf8');
  const ground = JSON.parse(groundText), malformed = structuredClone(ground);
  malformed.sites[0].buildings[0][6] = 'toString';
  const badBody = JSON.stringify(malformed), record = result.fieldAdmission = { native, baseline: null, fixtures: [], routes: [], restored: [], errors: [], warnings: [] };
  const verdict = (name, ok, detail) => { check('field-admission-' + name, ok, detail); assert.ok(ok, name); };
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__admission' });
  await ctx.addInitScript(() => {
    const canvas = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    const fetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, 'parse');
    const readers = Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'getReader');
    const bodyCancel = Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'cancel');
    const clone = Object.getOwnPropertyDescriptor(Response.prototype, 'clone');
    const buffer = Object.getOwnPropertyDescriptor(Response.prototype, 'arrayBuffer');
    const seen = new WeakSet(), readerBindings = [], bodies = new WeakMap(); window.__admissionGpu = 0; window.__admissionBody = { bytes: 0, cancelled: false, largeParses: 0, stripped: false, requests: [], cancellations: [] };
    const cancellation = (binding, kind, action) => {
      if (!binding) return action();
      const row = { ...binding, kind, at: performance.timeOrigin + performance.now(), phase: document.getElementById('field-failure-heading') ? 'recovered' : 'loading', settled: false };
      window.__admissionBody.cancelled = true; window.__admissionBody.cancellations.push(row);
      const pending = action(); pending.then(() => { row.settled = true; row.settledAt = performance.timeOrigin + performance.now(); }, error => { row.error = error.message; }); return pending;
    };
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const value = canvas.value.apply(this, args);
      if (/^webgl/.test(args[0]) && value && !seen.has(this)) { seen.add(this); window.__admissionGpu++; }
      return value;
    };
    window.fetch = async function (...args) {
      const response = await fetchDescriptor.value.apply(this, args);
      let output = response;
      if (location.search.includes('fieldfixture=body') && String(args[0]).includes('/scenarios/henry-hill.json')) {
        const headers = new Headers(response.headers); headers.delete('content-length'); window.__admissionBody.stripped = true;
        output = new Response(response.body, { status: response.status, headers });
      }
      if (location.search.includes('fieldfixture=announced') && String(args[0]).includes('/scenarios/henry-hill.json')) {
        const headers = new Headers(response.headers); headers.set('content-length', '1048577');
        window.__admissionBody.announced = true; output = new Response(response.body, { status: response.status, headers });
      }
      if (String(args[0]).includes('/scenarios/henry-hill.json')) {
        const binding = { id: window.__admissionBody.requests.length + 1, url: new URL(args[0], location.href).href, method: args[1]?.method || 'GET', requestBody: args[1]?.body ?? null, keepalive: args[1]?.keepalive === true, fixture: new URLSearchParams(location.search).get('fieldfixture'), status: output.status,
          consumption: { guards: 0, guardBytes: 0, guardEOF: false, guardReleased: false, nativeStarted: false, nativeFinished: false, nativeBytes: 0, events: [] } };
        window.__admissionBody.requests.push(binding); if (output.body) bodies.set(output.body, binding);
      }
      return output;
    };
    Response.prototype.clone = function (...args) {
      const binding = bodies.get(this.body), copied = clone.value.apply(this, args);
      if (binding) {
        binding.consumption.guards++;
        bodies.set(this.body, { ...binding, branch: 'original' }); bodies.set(copied.body, { ...binding, branch: 'guard' });
      }
      return copied;
    };
    Response.prototype.arrayBuffer = async function (...args) {
      const binding = bodies.get(this.body), c = binding?.consumption;
      if (c) { c.nativeStarted = true; c.nativeStartGuardBytes = c.guardBytes; c.nativeStartGuardEOF = c.guardEOF; c.events.push('nativeStarted'); }
      const bytes = await buffer.value.apply(this, args);
      if (c) { c.nativeBytes = bytes.byteLength; c.nativeFinished = true; }
      return bytes;
    };
    ReadableStream.prototype.cancel = function (...args) { return cancellation(bodies.get(this), 'body', () => bodyCancel.value.apply(this, args)); };
    JSON.parse = function (...args) { if (typeof args[0] === 'string' && args[0].length > 1048576) window.__admissionBody.largeParses++; return parseDescriptor.value.apply(this, args); };
    ReadableStream.prototype.getReader = function (...args) {
      const reader = readers.value.apply(this, args), read = reader.read, cancel = reader.cancel, releaseLock = reader.releaseLock, binding = bodies.get(this);
      readerBindings.push({ reader, read, cancel, releaseLock, readDescriptor: Object.getOwnPropertyDescriptor(reader, 'read'), cancelDescriptor: Object.getOwnPropertyDescriptor(reader, 'cancel'), releaseDescriptor: Object.getOwnPropertyDescriptor(reader, 'releaseLock') });
      reader.read = async function (...a) {
        const value = await read.apply(this, a);
        if (binding) {
          window.__admissionBody.bytes += value.value?.byteLength || 0;
          if (binding.branch === 'guard') {
            binding.consumption.guardBytes += value.value?.byteLength || 0;
            if (value.done) { binding.consumption.guardEOF = true; binding.consumption.events.push('guardEOF'); }
          }
        }
        return value;
      };
      reader.cancel = function (...a) { return cancellation(binding, 'reader', () => cancel.apply(this, a)); };
      reader.releaseLock = function (...a) { const value = releaseLock.apply(this, a); if (binding?.branch === 'guard') binding.consumption.guardReleased = true; return value; };
      return reader;
    };
    window.__admissionRestore = () => {
      let local = true;
      for (const { reader, read, cancel, releaseLock, readDescriptor, cancelDescriptor, releaseDescriptor } of readerBindings) {
        if (readDescriptor) Object.defineProperty(reader, 'read', readDescriptor); else delete reader.read;
        if (cancelDescriptor) Object.defineProperty(reader, 'cancel', cancelDescriptor); else delete reader.cancel;
        if (releaseDescriptor) Object.defineProperty(reader, 'releaseLock', releaseDescriptor); else delete reader.releaseLock;
        local = reader.read === read && reader.cancel === cancel && reader.releaseLock === releaseLock
          && !!Object.getOwnPropertyDescriptor(reader, 'read') === !!readDescriptor
          && !!Object.getOwnPropertyDescriptor(reader, 'cancel') === !!cancelDescriptor
          && !!Object.getOwnPropertyDescriptor(reader, 'releaseLock') === !!releaseDescriptor && local;
      }
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', canvas); Object.defineProperty(window, 'fetch', fetchDescriptor);
      Object.defineProperty(JSON, 'parse', parseDescriptor); Object.defineProperty(ReadableStream.prototype, 'getReader', readers);
      Object.defineProperty(ReadableStream.prototype, 'cancel', bodyCancel);
      Object.defineProperty(Response.prototype, 'clone', clone); Object.defineProperty(Response.prototype, 'arrayBuffer', buffer);
      return local && [[HTMLCanvasElement.prototype, 'getContext', canvas], [window, 'fetch', fetchDescriptor], [JSON, 'parse', parseDescriptor], [ReadableStream.prototype, 'getReader', readers], [ReadableStream.prototype, 'cancel', bodyCancel], [Response.prototype, 'clone', clone], [Response.prototype, 'arrayBuffer', buffer]]
        .every(([object, key, descriptor]) => { const actual = Object.getOwnPropertyDescriptor(object, key); return Reflect.ownKeys(descriptor).every(k => actual[k] === descriptor[k]) && Reflect.ownKeys(actual).length === Reflect.ownKeys(descriptor).length; });
    };
  });
  const counters = page => page.evaluate(() => ({ gpu: window.__admissionGpu, writes: window.__admissionWrites, puts: window.__progressPuts, body: window.__admissionBody }));
  record.pageDiagnostics = []; const pageDiagnostics = new Map();
  async function close(page) {
    const diagnostic = pageDiagnostics.get(page);
    if (diagnostic) { diagnostic.counters = await counters(page); diagnostic.phase = 'restoring'; diagnostic.markers.push({ phase: diagnostic.phase, at: Date.now() }); }
    record.restored.push(await page.evaluate(() => window.__admissionRestore()));
    if (diagnostic) { diagnostic.phase = 'closing'; diagnostic.markers.push({ phase: diagnostic.phase, at: Date.now() }); }
    await page.close();
  }
  const cleanPage = async (label = 'camp') => {
    const page = await ctx.newPage(); watchErrors(page, url, record.errors);
    const diagnostic = { label, phase: 'loading', errors: [], requests: [], markers: [{ phase: 'loading', at: Date.now() }] }, requests = new Map();
    pageDiagnostics.set(page, diagnostic); record.pageDiagnostics.push(diagnostic); watchErrors(page, url, diagnostic.errors);
    page.on('request', request => { if (request.url().endsWith('/assets/scenarios/henry-hill.json')) { const row = { id: diagnostic.requests.length + 1, url: request.url(), method: request.method(), requestBody: request.postData(), at: Date.now() }; requests.set(request, row); diagnostic.requests.push(row); } });
    page.on('requestfailed', request => { const row = requests.get(request); if (row) Object.assign(row, { failed: request.failure()?.errorText, terminalPhase: diagnostic.phase, terminalAt: Date.now() }); });
    page.on('requestfinished', request => { const row = requests.get(request); if (row) Object.assign(row, { finished: true, terminalPhase: diagnostic.phase, terminalAt: Date.now() }); });
    page.on('console', message => { if (message.type() === 'warning') record.warnings.push(message.text()); }); return page;
  };
  const recover = page => page.waitForSelector('#field-failure-heading');
  try {
    // Actual original runtime with the same malformed JSON: diagnosis, never current acceptance.
    const base = await ctx.newPage(), baseErrors = []; base.on('pageerror', e => baseErrors.push({ message: e.message, stack: e.stack }));
    base.on('console', m => { if (['error', 'warning'].includes(m.type())) baseErrors.push({ message: m.text(), kind: m.type() }); });
    const baseMain = execFileSync('git', ['show', accepted + ':src/main.js']);
    const baseEntry = execFileSync('git', ['show', accepted + ':src/entry.js']);
    const oldMain = route => route.fulfill({ contentType: 'text/javascript', body: baseMain });
    const oldEntry = route => route.fulfill({ contentType: 'text/javascript', body: baseEntry });
    const badGround = route => route.fulfill({ contentType: 'application/json', body: badBody });
    await base.route('**/src/main.js', oldMain); await base.route('**/src/entry.js', oldEntry); await base.route(pattern, badGround);
    try {
      const failed = base.waitForEvent('pageerror', { timeout: 180000 });
      await base.goto(url + '?battle=henry-hill&quality=low&nosw', { waitUntil: 'domcontentloaded' });
      await base.waitForFunction(() => window.__admissionGpu > 0);
      // Wait for the actual authored-world failure, not merely the allocation counter.
      await base.waitForFunction(() => document.getElementById('status').textContent.includes('Loading'));
      await failed;
      record.baseline = { counters: await counters(base), errors: baseErrors, accepted, body: badBody };
      await shot(base, 'field-admission-base-malformed');
    } finally {
      await base.unroute(pattern, badGround); await base.unroute('**/src/main.js', oldMain); await base.unroute('**/src/entry.js', oldEntry); await close(base);
    }
    let page = await cleanPage('invalid-world-recovery'); await page.route(pattern, badGround);
    await page.goto(url + '?battle=henry-hill&quality=low&nosw'); await recover(page);
    record.invalid = await counters(page); pageDiagnostics.get(page).phase = 'recovered'; pageDiagnostics.get(page).markers.push({ phase: 'recovered', at: Date.now() });
    verdict('invalid-world-before-gpu', record.baseline.counters.gpu > 0 && record.baseline.errors.some(e => /g\.rotateY is not a function/.test(e.message) && e.stack?.includes('/src/world/props.js'))
      && record.invalid.gpu === 0 && record.invalid.writes === 0 && record.invalid.puts === 0,
    'same authored-world fixture: actual accepted BASE allocates; candidate refuses before GPU or progress writes');
    const layouts = [];
    for (const width of [320, 1024]) {
      await page.setViewportSize({ width, height: width === 320 ? 480 : 768 });
      const layout = await page.locator('#field-return').evaluate(n => {
        const r = n.getBoundingClientRect(), css = getComputedStyle(n), points = [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]];
        return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, font: parseFloat(css.fontSize), viewport: [innerWidth,innerHeight],
          hits: points.map(([x,y]) => { const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return hit===n||n.contains(hit); }),
          heading: document.activeElement.id, overflow: document.getElementById('front').scrollWidth > document.getElementById('front').clientWidth };
      }); layouts.push(layout); await shot(page, 'field-admission-recovery-' + width);
      const axe = await new AxeBuilder({ page }).include('#front').analyze(); record[width === 320 ? 'recoveryAxeNarrow' : 'recoveryAxeWide'] = axe.violations;
    }
    record.layouts = layouts;
    verdict('recovery-layout', layouts.every(l => l.width >= 48 && l.height >= 48 && l.font >= 14 && l.left >= 0 && l.right <= l.viewport[0] && l.top >= 0 && l.bottom <= l.viewport[1] && l.hits.every(Boolean) && !l.overflow), 'complete48px return target, readable320/1024 layouts and all five hits');
    await page.keyboard.press('Tab'); const linkFocused = await page.locator('#field-return').evaluate(n => document.activeElement === n);
    pageDiagnostics.get(page).phase = 'returning-to-camp'; pageDiagnostics.get(page).markers.push({ phase: 'returning-to-camp', at: Date.now() });
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__entry && !window.__entry.importing);
    verdict('recovery-keyboard', linkFocused && new URL(page.url()).searchParams.has('camp') && (await counters(page)).gpu === 0, 'native Tab/Enter returns to the original camp route');
    await page.unroute(pattern, badGround); await close(page);
    for (const fixture of ['json', 'announced', 'body', 'http']) {
      // Every refusal fixture retains raw diagnostics, with owned cancellation checked explicitly.
      page = await ctx.newPage(); const diagnostic = { errors: [], warnings: [], requests: [], markers: [] }, requests = new Map(); let phase = 'loading';
      watchErrors(page, url, diagnostic.errors);
      page.on('console', m => { if (m.type() === 'warning') diagnostic.warnings.push(m.text()); });
      page.on('request', request => { if (request.url().endsWith('/assets/scenarios/henry-hill.json')) { const row = { id: diagnostic.requests.length + 1, fixture, url: request.url(), method: request.method(), at: Date.now() }; requests.set(request,row); diagnostic.requests.push(row); } });
      page.on('requestfailed', request => { const row = requests.get(request); if (row) Object.assign(row, { failed: request.failure()?.errorText, terminalPhase: phase, terminalAt: Date.now() }); });
      page.on('requestfinished', request => { const row = requests.get(request); if (row) Object.assign(row, { finished: true, terminalPhase: phase, terminalAt: Date.now() }); });
      const body = fixture === 'body' ? JSON.stringify({ ...ground, padding: 'x'.repeat(1048576) }) : fixture === 'json' ? '{bad-json' : '{}';
      const handler = route => route.fulfill({ status: fixture === 'http' ? 503 : 200, headers: { 'content-type': 'application/json' }, body });
      await page.route(pattern, handler); diagnostic.markers.push({ phase, at: Date.now() }); await page.goto(url + '?battle=henry-hill&nosw&fieldfixture=' + fixture); await recover(page); phase = 'recovered';
      diagnostic.markers.push({ phase, at: Date.now() });
      const row = { fixture, counters: await counters(page), diagnostic }; record.fixtures.push(row);
      // Chromium's intercepted-body cancellation can leave response.finished pending until close.
      // Observe that distinction explicitly; do not await an unbounded transport observer.
      for (const request of requests.keys()) {
        let timer;
        row.transportSettledBeforeClose = await Promise.race([
          request.response().then(response => response?.finished()).then(() => true),
          new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
        ]); clearTimeout(timer);
      }
      row.counters = await counters(page); await shot(page, 'field-admission-' + fixture);
      phase = 'restoring'; diagnostic.markers.push({ phase, at: Date.now() }); await page.unroute(pattern, handler);
      record.restored.push(await page.evaluate(() => window.__admissionRestore())); phase = 'closing'; diagnostic.markers.push({ phase, at: Date.now() }); await page.close();
    }
    const faultValid = f => {
      if (f.diagnostic.warnings.length || f.diagnostic.requests.length !== 1 || f.counters.body.requests.length !== 1) return false;
      const request = f.diagnostic.requests[0], response = f.counters.body.requests[0];
      if (request.url !== response.url || request.method !== response.method || request.fixture !== response.fixture || request.id !== response.id
        || response.method !== 'GET' || response.requestBody !== null || !response.keepalive) return false;
      const c = response.consumption;
      if (!c || (f.fixture === 'body' && (c.guards !== 1 || !c.guardReleased || c.guardBytes <= 1048576 || c.nativeStarted
        || !f.counters.body.cancellations.some(x => x.branch === 'original' && x.kind === 'body')
        || !f.counters.body.cancellations.some(x => x.branch === 'guard' && x.kind === 'reader')))
        || (['announced', 'http'].includes(f.fixture) && (c.guards !== 0 || c.nativeStarted))
        || (f.fixture === 'json' && (!c.guardEOF || !c.guardReleased || !c.nativeFinished
          || c.nativeStartGuardEOF !== true || c.nativeStartGuardBytes !== c.nativeBytes))) return false;
      const abort = 'request failed: /assets/scenarios/henry-hill.json (net::ERR_ABORTED)';
      const http = 'HTTP 503 for /assets/scenarios/henry-hill.json';
      const console503 = 'console.error: Failed to load resource: the server responded with a status of 503 (Service Unavailable) (' + request.url.replace(url, '') + ':0)';
      const transportErrors = f.diagnostic.errors.filter(e => e !== abort);
      const diagnosticsValid = f.fixture === 'http'
        ? response.status === 503 && transportErrors.includes(http) && new Set(transportErrors).size === transportErrors.length && transportErrors.every(e => e === http || e === console503)
        : transportErrors.length === 0;
      if (!diagnosticsValid) return false;
      const cancellations = f.counters.body.cancellations, restoring = f.diagnostic.markers.find(m => m.phase === 'restoring').at;
      if (cancellations.length !== (f.fixture === 'body' ? 2 : 1)
        || !cancellations.every(c => c.id === request.id && c.url === request.url && c.method === request.method
          && c.fixture === f.fixture && c.phase === 'loading' && c.settled && !c.error
          && [request.at, c.at, c.settledAt, restoring].every(Number.isFinite)
          && request.at <= c.at + 2 && c.at <= c.settledAt && c.settledAt <= restoring + 2)
        || (['announced','http'].includes(f.fixture) && (cancellations[0].kind !== 'body' || cancellations[0].branch === 'guard'))
        || (f.fixture === 'json' && (cancellations[0].kind !== 'reader' || cancellations[0].branch !== 'guard'))) return false;
      if (!request.failed) return request.finished && !f.diagnostic.errors.includes(abort);
      const cleanupAbort = request.terminalPhase === 'closing' && f.transportSettledBeforeClose === false
        && request.terminalAt >= f.diagnostic.markers.find(m => m.phase === 'closing').at;
      return ['announced','body','http'].includes(f.fixture) && request.failed === 'net::ERR_ABORTED' && (['loading','recovered'].includes(request.terminalPhase) || cleanupAbort)
        && f.counters.body.cancellations.length > 0 && f.counters.body.cancellations.every(c => c.id === request.id && c.url === request.url && c.method === request.method && c.fixture === f.fixture && c.phase === 'loading' && c.settled && !c.error
          && [request.at, c.at, request.terminalAt, c.settledAt].every(Number.isFinite)
          && request.at <= c.at + 2 && c.at <= request.terminalAt + 2
          && c.at <= c.settledAt && c.settledAt <= f.diagnostic.markers.find(m => m.phase === 'restoring').at + 2)
        && f.diagnostic.errors.filter(e => e === abort).length === 1;
    };
    record.faultControls = [];
    for (const f of record.fixtures) {
      assert.ok(faultValid(f), 'actual fault diagnostics bind the exact owned refusal request: ' + f.fixture);
      const unexplained = structuredClone(f); unexplained.diagnostic.errors.push('unexplained failure');
      assert.throws(() => assert.ok(faultValid(unexplained)), { code: 'ERR_ASSERTION' });
      const detached = structuredClone(f); detached.diagnostic.requests[0].url += '?detached';
      assert.throws(() => assert.ok(faultValid(detached)), { code: 'ERR_ASSERTION' });
      record.faultControls.push({ fixture: f.fixture, unexplainedErrorRejected: true, detachedRequestRejected: true });
      const unsettled = structuredClone(f); unsettled.counters.body.cancellations[0].settled = false;
      assert.throws(() => assert.ok(faultValid(unsettled)), { code: 'ERR_ASSERTION' });
      const wrongOwner = structuredClone(f); wrongOwner.counters.body.cancellations[0].id++;
      assert.throws(() => assert.ok(faultValid(wrongOwner)), { code: 'ERR_ASSERTION' });
      const wrongUrl = structuredClone(f); wrongUrl.counters.body.cancellations[0].url += '?wrong-owner';
      assert.throws(() => assert.ok(faultValid(wrongUrl)), { code: 'ERR_ASSERTION' });
      Object.assign(record.faultControls.at(-1), { unsettledCancellationRejected: true, wrongCancellationIdRejected: true, wrongCancellationUrlRejected: true });
      if (f.fixture === 'body') {
        const early = structuredClone(f); early.counters.body.requests[0].consumption.nativeStarted = true;
        assert.throws(() => assert.ok(faultValid(early)), { code: 'ERR_ASSERTION' });
        const branch = structuredClone(f); branch.counters.body.cancellations = branch.counters.body.cancellations.filter(c => c.branch !== 'guard');
        assert.throws(() => assert.ok(faultValid(branch)), { code: 'ERR_ASSERTION' });
        record.faultControls.at(-1).nativeBeforeBoundRejected = true; record.faultControls.at(-1).missingGuardCancellationRejected = true;
      }
      if (f.diagnostic.requests[0].failed) {
        const missing = structuredClone(f); missing.counters.body.cancellations = []; assert.throws(() => assert.ok(faultValid(missing)), { code: 'ERR_ASSERTION' });
        record.faultControls.at(-1).missingCancellationRejected = true;
        const late = structuredClone(f); late.counters.body.cancellations[0].at = late.diagnostic.requests[0].terminalAt + 1000;
        assert.throws(() => assert.ok(faultValid(late)), { code: 'ERR_ASSERTION' });
        record.faultControls.at(-1).lateCancellationRejected = true;
        if (f.diagnostic.requests[0].terminalPhase === 'closing') {
          const finished = structuredClone(f); finished.transportSettledBeforeClose = true;
          assert.throws(() => assert.ok(faultValid(finished)), { code: 'ERR_ASSERTION' });
          const early = structuredClone(f); early.diagnostic.markers.find(m => m.phase === 'closing').at = early.diagnostic.requests[0].terminalAt + 1000;
          assert.throws(() => assert.ok(faultValid(early)), { code: 'ERR_ASSERTION' });
          Object.assign(record.faultControls.at(-1), { settledTransportRejected: true, preCloseFailureRejected: true });
        }
      }
    }
    record.faultBindings = record.fixtures.map(f => ({ fixture: f.fixture, exact: faultValid(f), terminalPhase: f.diagnostic.requests[0].terminalPhase, transportSettledBeforeClose: f.transportSettledBeforeClose }));
    verdict('http-failure-before-gpu', record.fixtures.every(f => f.counters.gpu === 0 && f.counters.writes === 0 && f.counters.puts === 0)
      && record.fixtures.find(f => f.fixture === 'body').counters.body.bytes > 1048576
      && record.fixtures.find(f => f.fixture === 'body').counters.body.cancelled
      && record.fixtures.find(f => f.fixture === 'announced').counters.body.announced
      && record.fixtures.find(f => f.fixture === 'announced').counters.body.bytes === 0
      && record.fixtures.every(f => f.counters.body.largeParses === 0), 'actual HTTP503/invalidJSON/announced and streamed oversized fixtures recover before allocation/large parse/write; raw fault diagnostics retained');

    const initial = deploymentFixture();
    async function camp() { const p = await cleanPage(); await p.goto(url + '?camp&nosw'); await p.waitForFunction(() => window.__entry && !window.__entry.importing); await seedProgress(p, exportSnapshot(initial)); await p.reload(); await p.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing); await p.locator('#camp-deploy').click(); await p.waitForFunction(() => document.getElementById('deploy-review').getAttribute('aria-busy') === 'false'); return p; }
    async function heldTerrain(p) {
      let release, seen, finished; const gate = new Promise(r => { release=r; }), ready = new Promise(r => { seen=r; }), done = new Promise(r => { finished=r; });
      const handler = async route => { seen(); await gate; try { await route.continue(); } finally { finished(); } };
      await p.route('**/assets/terrain/henry-hill.json', handler); await p.locator('#deploy-launch').click(); await ready;
      return { release, done, handler };
    }
    page = await camp(); let held = await heldTerrain(page); const beforeCancel = await counters(page), rawBefore = await progressRaw(page);
    await page.evaluate(() => { window.__admissionTask = window.__entry.deployment; }); await page.keyboard.press('Escape');
    const retained = await page.evaluate(() => ({ same: window.__entry.deployment === window.__admissionTask, busy: window.__entry.importing, cancelled: window.__admissionTask.cancelled, admitted: window.__admissionTask.admitted }));
    held.release(); await held.done; await page.waitForFunction(() => window.__entry && !window.__entry.importing);
    const settled = await counters(page), focus = await page.evaluate(() => document.activeElement.id);
    record.terrainCancel = { beforeCancel, retained, settled, focus, rawExact: await progressRaw(page) === rawBefore };
    verdict('terrain-cancel-owner', retained.same && retained.busy && retained.cancelled && !retained.admitted && settled.gpu === 0 && settled.writes === beforeCancel.writes && settled.puts === beforeCancel.puts && focus === 'camp-deploy' && record.terrainCancel.rawExact, 'native Escape retains the existing owner until held terrain settles, then returns focused camp with no GPU/write');
    await page.unroute('**/assets/terrain/henry-hill.json', held.handler); await shot(page, 'field-admission-terrain-cancel'); await close(page);

    page = await camp(); held = await heldTerrain(page); const beforeStale = await counters(page);
    const other = await cleanPage(); await other.goto(url + '?camp&nosw'); await other.waitForFunction(() => window.__entry?.mode === 'camp' && !window.__entry.importing);
    const alternative = validateSnapshot({ ...initial, awardId: 'field-other-tab', seed: 'field-other-tab' });
    await other.locator('#entry-file').setInputFiles({ name: 'field-other-tab.json', mimeType: 'application/json', buffer: Buffer.from(exportSnapshot(alternative)) });
    await other.locator('#entry-confirm').click(); await other.waitForFunction(() => window.__entry?.saved?.awardId === 'field-other-tab' && !window.__entry.importing);
    held.release(); await held.done; await page.waitForFunction(() => document.getElementById('deploy-review').getAttribute('aria-busy') === 'false');
    record.stale = { before: beforeStale, after: await counters(page), note: await page.locator('#deploy-note').textContent(), raw: await progressRaw(page) };
    verdict('stale-after-terrain', record.stale.after.gpu === 0 && record.stale.after.writes === beforeStale.writes && record.stale.note.includes('changed after deployment') && record.stale.raw === exportSnapshot(alternative), 'genuine second-tab import during terrain load is rejected by the final canonical save read');
    await page.unroute('**/assets/terrain/henry-hill.json', held.handler); await shot(page, 'field-admission-stale'); await close(other); await close(page);

    page = await camp(); const savedBefore = await counters(page);
    await page.locator('#deploy-launch').click(); await page.waitForFunction(() => window.__ready && window.__game?.manifest, null, { timeout: 180000 });
    record.savedIdentity = await page.evaluate(() => {
      const { game, manifest } = window.__game;
      const frozen = v => !v || typeof v !== 'object' || Object.isFrozen(v) && Object.values(v).every(frozen);
      return { exact: game.scenario === manifest.scenario, frozen: frozen(game.scenario), before: JSON.stringify(game.scenario),
        definitions: game.units.every(u => u.def === manifest.scenario.units.find(d => d.id === u.id)) };
    });
    await page.locator('#intro-start').click(); await page.waitForFunction(() => window.__game.game.simTime > 0);
    record.savedIdentity.after = await page.evaluate(() => JSON.stringify(window.__game.game.scenario));
    record.savedIdentity.counters = await counters(page); record.savedIdentity.beforeCounters = savedBefore;
    await shot(page, 'field-admission-saved-identity'); await close(page);

    for (const query of ['battle=henry-hill', 'intro', 'sandbox&battle=henry-hill&intro', 'tune&practice']) {
      page = await cleanPage('route:' + query); await page.goto(url + '?' + query + '&quality=low&nosw'); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
      const state = await page.evaluate(() => {
        const { game, manifest } = window.__game; const frozen = v => !v || typeof v !== 'object' || Object.isFrozen(v) && Object.values(v).every(frozen);
        const gl = document.getElementById('battlefield').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { id: game.scenario.id, frozen: frozen(game.scenario), before: JSON.stringify(game.scenario), originalSaved: !manifest || game.scenario === manifest.scenario, gpu: window.__admissionGpu,
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          definitions: game.units.every(u => u.def === game.scenario.units.find(d => d.id === u.id)),
          opening: (game.scenario.opening || []).map(o => ({ id: o.id, points: game.units.find(u => u.id === o.id).follow.path._waypoints.map(p => [p.x,p.z]) })) };
      });
      // Actual construction and opening orders have run; ordinary frames keep definitions immutable.
      if (await page.locator('#intro-start').isVisible()) await page.locator('#intro-start').click();
      await page.waitForFunction(() => window.__game.game.simTime > 0);
      state.after = await page.evaluate(() => JSON.stringify(window.__game.game.scenario));
      const expected = state.id === 'first-command' ? introScenario(ground) : ground;
      state.sourceExact = state.before === JSON.stringify(expected);
      state.openingExact = JSON.stringify(state.opening) === JSON.stringify((expected.opening || []).map(o => ({ id: o.id, points: o.points })));
      record.routes.push({ query, ...state });
      await shot(page, 'field-admission-route-' + state.id + '-' + record.routes.length); await close(page);
    }
    const s = record.savedIdentity;
    verdict('immutable-current-routes', s.exact && s.frozen && s.definitions && s.before === s.after && s.counters.gpu === 1
      && s.counters.writes === s.beforeCounters.writes && s.counters.puts === s.beforeCounters.puts
      && record.routes.every(r => r.frozen && r.before === r.after && r.gpu === 1 && r.originalSaved && r.sourceExact && r.openingExact && r.definitions
        && (!native || !/swiftshader|software|llvmpipe/i.test(r.renderer)))
      && record.routes.map(r => r.id).join(',') === 'henry-hill,first-command,henry-hill,henry-hill', 'actual current construction/openings and sandbox/battle/intro/tune precedence retain frozen definitions');
    verdict('scoped-axe', record.recoveryAxeNarrow.length === 0 && record.recoveryAxeWide.length === 0, 'both actual recovery scopes have zero axe violations');
    const requestValid = diagnostic => {
      const body = diagnostic.label === 'invalid-world-recovery' ? record.invalid.body : diagnostic.counters.body;
      return diagnostic.requests.length === body.requests.length && diagnostic.requests.every(request => {
        const response = body.requests.find(r => r.id === request.id);
        const c = response?.consumption, expectedBytes = Buffer.byteLength(diagnostic.label === 'invalid-world-recovery' ? badBody : groundText);
        return request.finished === true && !request.failed && request.method === 'GET' && request.requestBody === null
          && response?.url === request.url && response.method === request.method && response.requestBody === null && response.keepalive === true
          && c?.guards === 1 && c.guardEOF && c.guardReleased && c.nativeStarted && c.nativeFinished
          && c.guardBytes === expectedBytes && c.nativeBytes === expectedBytes && c.nativeStartGuardEOF === true
          && c.nativeStartGuardBytes === expectedBytes && JSON.stringify(c.events) === JSON.stringify(['guardEOF', 'nativeStarted']);
      });
    };
    record.requestBindings = record.pageDiagnostics.map(d => ({ label: d.label, exact: requestValid(d) })); record.requestControls = [];
    for (const d of record.pageDiagnostics.filter(d => d.requests.length && requestValid(d))) {
      const pending = structuredClone(d); pending.requests[0].finished = false;
      assert.throws(() => assert.ok(requestValid(pending)), { code: 'ERR_ASSERTION' });
      const detached = structuredClone(d); detached.requests[0].url += '?detached';
      assert.throws(() => assert.ok(requestValid(detached)), { code: 'ERR_ASSERTION' });
      const body = structuredClone(d); body.requests[0].requestBody = 'unexpected';
      assert.throws(() => assert.ok(requestValid(body)), { code: 'ERR_ASSERTION' });
      record.requestControls.push({ label: d.label, pendingRejected: true, detachedRejected: true, requestBodyRejected: true });
      if (d.label !== 'invalid-world-recovery') {
        const early = structuredClone(d); early.counters.body.requests[0].consumption.nativeStartGuardEOF = false;
        assert.throws(() => assert.ok(requestValid(early)), { code: 'ERR_ASSERTION' });
        const unlocked = structuredClone(d); unlocked.counters.body.requests[0].consumption.guardReleased = false;
        assert.throws(() => assert.ok(requestValid(unlocked)), { code: 'ERR_ASSERTION' });
        record.requestControls.at(-1).nativeBeforeEOFRejected = true; record.requestControls.at(-1).guardNotReleasedRejected = true;
      }
    }
    verdict('clean-console', record.errors.length === 0 && record.warnings.length === 0 && record.restored.every(Boolean)
      && record.requestBindings.every(r => r.exact), 'zero candidate errors/warnings; actual bounded GET transports finished; observers restored exactly; injected BASE/HTTP fault diagnostics separate');
  } finally {
    for (const page of ctx.pages()) {
      if (!page.isClosed()) {
        try { record.restored.push(await page.evaluate(() => window.__admissionRestore?.() ?? true)); }
        catch (error) { record.cleanupError = error.message; }
      }
    }
    await ctx.close();
  }
}

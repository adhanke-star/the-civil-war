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

const OUT = path.join(ROOT, '.out', 'offline');
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

const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(), errors = [];
let stage = 'registration', nextRequest = 0;
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
  generation: manifest.generation, ...diagnostic.read(), expected, audits, auditErrors, cleanupErrors } }, null, 1));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`console.error: ${m.text()}`); });
const battleReady = () => page.waitForFunction(() => window.__ready === true, null, { timeout: 240_000, polling: 500 });
try {
  // 1. registration and control
  await page.goto(`${url}?sw`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || null, null, { timeout: 60_000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 }); }
  const sw = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, scope: (await navigator.serviceWorker.getRegistration())?.scope }));
  check('sw-controls', sw.controlled, JSON.stringify(sw));
  // 2. visit the title and one battle online, through the worker
  await page.reload(); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  await page.goto(url + BATTLE); await battleReady(); await page.waitForTimeout(3000);
  const cached = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
  check('cache-filled', cached > 50, `${cached} cached responses after the title and one battle`);
  stage = 'before-offline'; await audit(false);
  // 3. offline
  await ctx.setOffline(true);
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  await page.screenshot({ path: path.join(OUT, 'offline-title.png') });
  check('offline-title', await page.evaluate(() => window.__entry.mode === 'title'), 'the title opens with no network');
  stage = 'after-offline-title'; await audit(false);
  stage = 'offline-battle';
  await page.goto(url + BATTLE); await battleReady();
  const run = await page.evaluate(() => {
    const { game, pack, terrain } = window.__game, t0 = game.simTime;
    if (game.paused) game.togglePause();
    game.fastForward(10);
    return { pack: pack?.phaseId, terrain: terrain.meta.name, units: game.units.length, advanced: Math.round(game.simTime - t0) };
  });
  await page.screenshot({ path: path.join(OUT, 'offline-battle.png') });
  check('offline-battle', run.pack === 'camps-at-dawn' && run.units > 0 && run.advanced >= 9, JSON.stringify(run));
  // 4. back online
  await ctx.setOffline(false);
  stage = 'online-again';
  await page.goto(`${url}?sw`); await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60_000 });
  check('online-again', await page.evaluate(() => !!navigator.serviceWorker.controller), 'the worker still controls the page online');
  check('no-errors', errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'no page or console errors');
} catch (e) {
  check('harness', false, `${e.message.split('\n')[0]} | ${errors.slice(0, 3).join(' | ')}`);
  stage = 'first-failure'; await audit(true);
} finally {
  // Freeze the primary result before cleanup; a stuck close cannot erase it.
  const terminal = setTimeout(() => process.exit(1), 20000);
  try {
    try { await persist(); } catch { cleanupErrors.push('primary persistence'); }
    try { await browser.close(); } catch { cleanupErrors.push('browser close'); }
    try { server.close(); } catch { cleanupErrors.push('server close'); }
    try { await persist(); } catch { cleanupErrors.push('final persistence'); }
  } finally { clearTimeout(terminal); }
}
const failed = results.filter((r) => !r.ok);
const receipt = diagnostic.read(), invalid = receipt.overflow || receipt.observerErrors.length || receipt.events.some(r => r.event === 'observer-error')
  || auditErrors.length || audits.some(r => r.observerErrors.length) || cleanupErrors.length;
console.log(failed.length || invalid ? `OFFLINE FAILED (${results.length - failed.length}/${results.length}; diagnostic invalid=${!!invalid})` : `OFFLINE OK (${results.length}/${results.length})`);
process.exit(failed.length || invalid ? 1 : 0);

// CPU check: recorded sound and music (src/audio/bank.js, mixer.js, director.js, music.js), the gore toggle
// (src/units/soldier-mesh.js FALLEN / FallenPool) and the player settings they persist (src/settings.js).
//   bank-files        every file under assets/audio is in the bank manifest and every manifest entry exists, with an
//                     allowed licence; effects are mono MP3, music stereo MP3
//   attribution       ATTRIBUTION.md lists each file with an allowed licence; no craigsmith source is used
//   budget            effects <= 4 MB, music <= 8 MB, each file <= 2.5 MB
//   mixer-maths       bus level = master x its slider, 0 when muted; gain = level^2 x duck; clamped
//   director-limits   per-type cooldowns, the simultaneous-voice cap and order-call rate limits on a fake clock
//   director-bed      the rolling-fire bed follows the number of units firing; pause silences it; season ambience
//   order-calls       one labelled call per order kind; the modern Retreat is never captioned as the 1862 signal
//   gore-sim          gore off changes no simulation result (Henry Hill, with figures animated and the fade running)
//   gore-fade         gore off: a casualty lies, sinks and is hidden on the fade clock; gore on puts every one back
//   settings-persist  volumes and gore persist; settings saved by an older build still load; bad stored values refused
//   music-moods       results vs lament after heavy losses; never over a battle
//   lazy-load         nothing is created, fetched or streamed before the first gesture
// `node tools/test-audio.mjs` prints AUDIO OK (n/n); `--prove-fail` also runs one mutant per check and requires each to
// fail that check, with the check's own name in the failure text. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { startServer } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { SOUNDS, AUDIO_BUDGET, ALLOWED_LICENCES, ORDER_CALLS, AUDIO_DIR, ambientFor, prepareBattleRecordings } from '../src/audio/bank.js';
import { busLevel, busGain, defineAudioSettings, AUDIO_SETTINGS, Mixer } from '../src/audio/mixer.js';
import { Director, DIRECTOR } from '../src/audio/director.js';
import * as music from '../src/audio/music.js';
import { FallenPool, FALLEN, fadeOf, UNIFORMS } from '../src/units/soldier-mesh.js';
import * as settings from '../src/settings.js';
import { henryHillRun } from './test-packs.mjs'; // sets the same flat-ground rules the Henry Hill oracle uses
import { Game } from '../src/game.js';
import { observeFallbackCall, recordingProofErrors } from './test-audio-ui.mjs';
import { observeAudioTransport, fieldAdmissionProbe } from './test-field-admission-ui.mjs';
import { setPlan } from '../src/world/landscape.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, AUDIO_DIR);
const HH = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/scenarios/henry-hill.json'), 'utf8'));
const MB = 1024 * 1024;

function audioFiles() {
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(AUDIO, p).split(path.sep).join('/')); } };
  walk(AUDIO);
  return out.sort();
}
/** MPEG audio frame header of a file (after any ID3v2 tag): { mpeg1, layer3, mono } or null. */
function mp3Header(file) {
  const b = fs.readFileSync(file);
  let i = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  for (const end = Math.min(b.length - 4, i + 4096); i < end; i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) return { mpeg1: ((b[i + 1] >> 3) & 3) === 3, layer3: ((b[i + 1] >> 1) & 3) === 1, mono: (b[i + 3] >> 6) === 3 };
  }
  return null;
}
const attributionText = () => fs.readFileSync(path.join(ROOT, 'ATTRIBUTION.md'), 'utf8');
/** The bullets of ATTRIBUTION.md's sound section (each with its continuation lines). */
function soundBullets(text) {
  const start = text.indexOf('## Sound and music');
  if (start < 0) return [];
  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  const bullets = [];
  for (const line of end < 0 ? rest : rest.slice(0, end)) {
    if (line.startsWith('- ')) bullets.push(line);
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ' ' + line.trim();
  }
  return bullets;
}

/** A fake mixer: records plays; each one-shot lasts `dur` seconds. */
function fakeMixer({ dur = 2, loaded = true } = {}) {
  const m = { plays: [], stopped: [], ducks: [], dur };
  m.has = () => loaded;
  m.play = (id, opts = {}) => {
    const h = { id, opts, duration: id.startsWith('call') ? 4 : m.dur, gains: [], stopped: false, pans: [] };
    h.setGain = (v) => h.gains.push(v); h.setPan = (p) => h.pans.push(p); h.stop = () => { h.stopped = true; };
    m.plays.push(h);
    return h;
  };
  m.stopBus = (bus) => m.stopped.push(bus);
  m.duck = (bus, f) => m.ducks.push([bus, f]);
  return m;
}
function clockAt(t0 = 0) { const c = { t: t0 }; c.now = () => c.t; return c; }

/** Henry Hill with every figure animated (so casualties reach the fallen pools and the gore fade runs). */
function goreRun(api, goreOn) {
  settings.set('look.gore', goreOn);
  const s = structuredClone(HH); s.end = '14:03';
  setPlan(s);
  const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  const clock = FALLEN.clock;
  FALLEN.clock = () => g.simTime;
  try {
    for (let i = 0; i < 160 && !g.over; i++) { for (let k = 0; k < 4; k++) { g.tick(0.05); api.goreHook(g, goreOn); } g.animate(0.2); }
  } finally { FALLEN.clock = clock; }
  const hidden = g.fallen.US.hiddenTo + g.fallen.CS.hiddenTo, laid = g.fallen.US.used + g.fallen.CS.used;
  return { sim: { over: g.over, winner: g.result?.winner ?? null, simTime: g.simTime, holder: g.holder, men: g.units.map((u) => [u.id, u.men, u.state, u.x, u.z]), next: g.rnd() }, hidden, laid };
}

/** A fresh copy of src/settings.js on a fake localStorage holding `stored` (the caller restores window). */
async function freshSettings(stored, tag) {
  const store = new Map(Object.entries(stored));
  globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  const S = await import(`${pathToFileURL(path.join(ROOT, 'src/settings.js')).href}?${tag}`);
  return { S, store };
}


/** Full real MP3 bytes in a bounded fake same-origin response; no decode, browser or disk output. */
function recordingFixture(mode = 'complete') {
  const stats = { calls: [], signals: [], readersCancelled: 0, releases: 0 };
  const fetcher = async (url, options) => {
    const index = stats.calls.length; stats.calls.push(String(url)); stats.signals.push(options.signal);
    if (mode === 'fetch-hang') return new Promise(() => {});
    const file = Object.values(SOUNDS).find(s => String(url).endsWith('/' + s.file));
    if (!file || file.stream) throw new Error('Unexpected recording request');
    const bytes = fs.readFileSync(path.join(AUDIO, file.file));
    const faulty = index === 0;
    if (mode === 'reject' && faulty) throw new Error('Declared unavailable recording');
    const headers = new Headers({ 'content-length': String(bytes.length) });
    if (faulty && mode === 'range') headers.set('content-range', 'bytes 0-4/100');
    if (faulty && mode === 'length') headers.set('content-length', 'garbage');
    if (faulty && mode === 'oversized') headers.set('content-length', String(AUDIO_BUDGET.file + 1));
    const value = faulty && mode === 'truncated' ? bytes.subarray(0, bytes.length - 1)
      : faulty && mode === 'overrun' ? Buffer.concat([bytes, Buffer.from([1])]) : bytes;
    let read = 0;
    return { status: faulty && mode === '503' ? 503 : faulty && mode === '206' ? 206 : 200,
      type: faulty && mode === 'opaque' ? 'opaque' : 'basic', headers,
      body: { cancel() { stats.readersCancelled++; }, getReader() { return {
        read() { if (mode === 'body-hang') return new Promise(() => {});
          return Promise.resolve(read++ ? { done: true } : { done: false, value }); },
        cancel() { stats.readersCancelled++; return mode === 'body-hang' ? new Promise(() => {}) : Promise.resolve(); },
        releaseLock() { stats.releases++; },
      }; } },
    };
  };
  return { stats, fetcher };
}
const recordingScenario = async () => ({ season: 'autumn' });
const prepareOptions = fetcher => ({ fetcher, deadlineMs: 1000 });


let recordingReaderFixture;
async function recordingProofFixture() {
  if (recordingReaderFixture) return structuredClone(recordingReaderFixture);
  const { newCampaign, campaignPhase } = await import('../src/franchise/campaign.js');
  const { validateDeck, cardsFor, chooseDecision } = await import('../src/franchise/decisions.js');
  const { breakCamp } = await import('../src/franchise/camp-orders.js');
  const { exportSnapshot } = await import('../src/franchise/save.js');
  const target = {}; Function('self', fs.readFileSync(path.join(ROOT, 'offline-manifest.js'), 'utf8'))(target);
  const manifest = target.CW_OFFLINE, campaign = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/campaign.json')));
  const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/packs/shiloh.json'))).phases[0].scenario;
  const fielded = [...scenario.units, ...(scenario.reinforcements || [])].filter(u => u.side === 'US').map(u => u.id);
  const expectedIds = [...Object.keys(SOUNDS).filter(id => SOUNDS[id].bank === 'battle'), ambientFor(scenario.season)];
  const deck = validateDeck(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/decisions.json'))));
  let save = newCampaign({ campaign, slot: 1, seed: 1861, at: '2026-10-15T00:00:00Z', difficulty: 'veteran' });
  const initial = structuredClone(save), decisionSaves = [];
  for (const card of cardsFor(deck, campaignPhase(save, campaign))) {
    save = chooseDecision(save, { campaign, deck, cardId: card.id, optionId: card.options[0].id });
    decisionSaves.push(exportSnapshot(save));
  }
  const before = exportSnapshot(save), departed = exportSnapshot(breakCamp(save, { campaign, fielded }));
  const sha = 'a'.repeat(40), report = { schema: 'battle-recordings-v1', complete: true, sha, run: '123', attempt: '1',
    generation: manifest.generation, failure: null, errors: [], console: [], requests: [], overflow: false, cases: [], cleanup: [{ ok: true }] };
  for (const name of ['healthy', 'unavailable']) {
    const healthy = name === 'healthy', origin = healthy ? 'http://127.0.0.1:12345/' : 'http://127.0.0.1:12346/';
    const cache = expectedIds.map(id => ({ id, present: healthy, ...(healthy ? { status: 200, type: 'basic', contentRange: null,
      bytes: manifest.files[AUDIO_DIR + SOUNDS[id].file].bytes, contentLength: String(manifest.files[AUDIO_DIR + SOUNDS[id].file].bytes),
      sha256: manifest.files[AUDIO_DIR + SOUNDS[id].file].sha256 } : {}) }));
    for (const id of expectedIds) report.requests.push({ id: report.requests.length + 1, case: name, phase: 'prepare', path: AUDIO_DIR + SOUNDS[id].file, method: 'GET', range: null, status: healthy ? 200 : 503, finished: true });
    report.cases.push({ name, origin, metadata: { schema: 1, scope: origin, generation: manifest.generation, members: manifest.base },
      initialActivation:{url:origin+'?sw',scope:origin,scriptURL:new URL('sw.js',origin).href,state:'activated',
        entryMode:'title',entryReady:true,controlled:false,startedAt:1000,observedAt:2000,deadline:61000},initialReloadAt:2001,
      installBeforeGesture: { calls: 0, observed: true }, initialReloaded: true,
      initialRaw: exportSnapshot(initial), controller: true, restartController: true,
      settings: { before: { 'audio.master': .8, 'audio.effects': 1, 'audio.voices': 1, 'audio.mute': false, 'audio.music': .5 },
        after: { 'audio.master': .8, 'audio.effects': 1, 'audio.voices': 1, 'audio.mute': false, 'audio.music': 0 } },
      restartSettings: { 'audio.master': .8, 'audio.effects': 1, 'audio.voices': 1, 'audio.mute': false, 'audio.music': 0 },
      noRequestsAfterClose: true, resumedForPlayback: false, beforeGesture: { requests: 0, audioContexts: 0, observed: true },
      beforeBegin: { simTime: 0, paused: true, briefing: true, decoded: 0 }, restartBeforeBegin: { simTime: 0, paused: true, briefing: true, decoded: 0 },
      online: { reachable: true, status: 200 }, closed: { reachable: false, error: 'ECONNREFUSED' }, listenerClosed: true, browserRestarted: true,
      saves: { before, departed, restart: departed, played: departed }, decisionSaves, departures: 1,
      coldCache: expectedIds.map(id => ({ id, present: false })), cache, restartCache: structuredClone(cache),
      rejectedPaths: healthy ? [] : expectedIds.map(id => AUDIO_DIR + SOUNDS[id].file), notice: { visible: !healthy, status: !healthy, role: 'status', toastRole: 'status' },
      playback: { running: true, simTime: 0, selectedUS: true,
        decoded: healthy ? expectedIds.map(id => ({ id, native: true, length: 100, channels: 1, sampleRate: 44100 })) : [],
        volley: healthy ? [{ id: 'volley-1', ok: true, bus: 'effects' }] : [], order: healthy ? [{ id: 'call-recall', ok: true, bus: 'effects' }] : [],
        ambient: { id: expectedIds[17], bus: 'ambient', loop: true, live: true, stopped: false }, fallback: healthy ? null
          : { owned: true, restored: true, failed: false, rows: [{ delegated: true, threw: false, nativeSource: true,
            nativeBuffer: true, length: 100, duration: 1, channels: 1, contextRunning: true }] } }, cleanup: [{ ok: true }, { ok: true }, { ok: true }] });
  }
  const { completedSnapshot } = await import('../src/franchise/save.js');
  const { SAMPLE_ARMY } = await import('../src/reward/data.js');
  const guardRaw = exportSnapshot(completedSnapshot({ awardId: 'recording-guard-fixture', army: structuredClone(SAMPLE_ARMY), depot: [], issued: [], seed: 1861, grade: 'Victory' }));
  report.guards = { cancel: { queued: true, currentCalls: 1, puts: 0, before: guardRaw, after: guardRaw, rejected: true, error: 'Progress: the reviewed exchange was cancelled.' },
    healthy: { queued: true, currentCalls: 1, puts: 1, before: guardRaw, after: guardRaw, rejected: false, error: null },
    ui: { preparing: true, cancelled: true, rawBefore: guardRaw, rawAfter: guardRaw, gpu: 0, departures: 0, closed: true } };
  const scripts = [];
  const { probeProgress } = await import('./test-progress-browser.mjs');
  await probeProgress({ addInitScript: async fn => scripts.push(fn.toString()) }, { prefix: '__recording', readFlag: '__recordingReadBlocked', quotaFlag: '__recordingQuota' });
  assert.equal(scripts.length, 1);
  const guardFixtureSource = { bytes: Buffer.byteLength(scripts[0]), sha256: createHash('sha256').update(scripts[0]).digest('hex') };
  report.browserAudio = [];
  const makeTrace = (name, origin, phase, ids, base, guard = false) => {
    const trace = { schema: 'audio-transport-node-v1', requests: [], events: [], main: null, overflow: false, observerFailure: false };
    const event = (type, id, at, extra = {}) => { const e = { sequence: trace.events.length + 1, type, id, at, phase, ...extra }; trace.events.push(e); return e; };
    if (phase === 'playback') trace.main = event('main-request', null, base - 1, { phase: 'restart' });
    for (const [i, sound] of ids.entries()) {
      const id = i + 1, row = { id, url: origin + AUDIO_DIR + SOUNDS[sound].file, method: 'GET', start: event('request', id, base + i * 3) };
      const unavailable = name === 'unavailable';
      if (!unavailable) row.response = event('response', id, base + i * 3 + 1, { status: 200 });
      if (!guard) row.terminal = event(unavailable ? 'failed' : 'finished', id, base + i * 3 + 2,
        unavailable ? { failure: 'net::ERR_FAILED' } : {});
      trace.requests.push(row);
    }
    if (guard) for (const [i, row] of trace.requests.entries()) row.terminal = event('failed', row.id, 1250 + i, { failure: 'net::ERR_ABORTED' });
    if (phase === 'prepare') trace.main = event('main-request', null, base + ids.length * 3);
    const result = { id: report.browserAudio.length + 1, case: name, origin, trace }; report.browserAudio.push(result); return result;
  };
  for (const c of report.cases) {
    for (const row of report.requests.filter(r => r.case === c.name)) Object.assign(row, { origin: c.origin, at: 1000 + row.id * 3, finishedAt: 1002 + row.id * 3 });
    c.requestCountAtClose = report.requests.filter(r => r.case === c.name).length;
    makeTrace(c.name, c.origin, 'prepare', expectedIds, 2000);
    makeTrace(c.name, c.origin, 'playback', expectedIds, 3000);
  }
  const origin = 'http://127.0.0.1:12347/', sounds = expectedIds.slice(0, 3), t = makeTrace('guards', origin, 'cancel', sounds, 1010, true);
  const held = sounds.map((id, i) => {
    const row = { id: report.requests.length + 1, case: 'guards', origin, phase: 'cancel', path: AUDIO_DIR + SOUNDS[id].file,
      method: 'GET', range: null, status: 200, held: true, finished: false, failed: 'client-aborted', at: 1005 + i, failedAt: 1250 + i, releasedAt: 1400 };
    report.requests.push(row); return row;
  });
  Object.assign(report.guards, { origin, fixtureSource: { ...guardFixtureSource }, probesRestored: true, contextClosed: true });
  Object.assign(report.guards.ui, { settings: structuredClone(report.cases[0].settings), startedAt: 1000, heldAt: 1100, cancelCommandAt: 1200, settledAt: 1300, terminalsAt: 1350, observedAt: 1600,
    startEvent: { trusted: true, at: 10000, timebase: 'browser-performance-UTC' }, cancelEvent: { trusted: true, at: 10020, timebase: 'browser-performance-UTC' },
    heldProxyRequestIds: held.map(r => r.id), proxyAbortIds: held.map(r => r.id), holdsReleased: true,
    heldBrowser: t.trace.requests.map(r => ({ traceId: t.id, id: r.id, url: r.url, method: r.method, response: r.response })),
    browserAbort: t.trace.requests.map(r => ({ traceId: t.id, id: r.id, url: r.url, method: r.method, terminal: r.terminal })),
    frames: [10040, 10060].map(at => ({ at, gpu: 0, gamePresent: false, cancelled: true, admitted: false, ownerReleased: true, closed: true })) });
  recordingReaderFixture = { report, expected: { sha, run: '123', manifest, campaign, fielded, expectedIds, initial, deck, guardRaw, guardFixtureSource } };
  return structuredClone(recordingReaderFixture);
}
const recordingProofMutations = [
  ['unrelated-cancel-error', r => { r.guards.cancel.error = 'Progress: something else cancelled'; }],
  ['healthy-exchange-rejected', r => { r.guards.healthy.rejected = true; }],
  ['healthy-exchange-error', r => { r.guards.healthy.error = 'unexplained'; }],
  ['hidden-pre-gesture-browser-trace', r => { const trace = structuredClone(r.browserAudio[0]); trace.id = r.browserAudio.length + 1;
    for (const row of trace.trace.requests) row.start.phase = 'title';
    for (const e of trace.trace.events) if (e.type === 'request') e.phase = 'title'; r.browserAudio.push(trace); }],
  ['late-proxy-request-hidden-by-summary', r => { r.requests.push({ ...r.requests[0], id: r.requests.length + 1, phase: 'playback' }); }],
  ['forged-origin-close-count', r => { r.cases[0].requestCountAtClose++; }],
  ['uncontrolled-install-document', r => { r.cases[0].initialReloaded = false; }],
  ['missing-initial-activation',r=>{delete r.cases[0].initialActivation;}],
  ['initial-worker-activating',r=>{r.cases[0].initialActivation.state='activating';}],
  ['initial-worker-scope',r=>{r.cases[0].initialActivation.scope='http://foreign.example/';}],
  ['initial-worker-script',r=>{r.cases[0].initialActivation.scriptURL=r.cases[0].origin+'other.js';}],
  ['initial-worker-document',r=>{r.cases[0].initialActivation.url=r.cases[0].origin+'?camp';}],
  ['initial-entry-importing',r=>{r.cases[0].initialActivation.entryReady=false;}],
  ['initial-worker-claimed',r=>{r.cases[0].initialActivation.controlled=true;}],
  ['initial-worker-late',r=>{r.cases[0].initialActivation.observedAt=r.cases[0].initialActivation.deadline;}],
  ['initial-worker-longer-budget',r=>{r.cases[0].initialActivation.deadline++;}],
  ['initial-worker-after-reload',r=>{r.cases[0].initialReloadAt=r.cases[0].initialActivation.observedAt-1;}],
  ['initial-worker-fractional-clock',r=>{r.cases[0].initialActivation.startedAt+=.5;r.cases[0].initialActivation.deadline+=.5;}],
  ['initial-worker-fractional-observation',r=>{r.cases[0].initialActivation.observedAt+=.5;}],
  ['initial-worker-fractional-reload',r=>{r.cases[0].initialReloadAt+=.5;}],
  ['install-created-audio-context', r => { r.cases[0].installBeforeGesture.calls = 1; }],
  ['wrong-held-proxy-id', r => { r.guards.ui.heldProxyRequestIds[0] = 9999; }],
  ['wrong-held-browser-id', r => { r.guards.ui.heldBrowser[0].id = 9999; }],
  ['wrong-abort-browser-id', r => { r.guards.ui.browserAbort[0].id = 9999; }],
  ['wrong-cancel-phase', r => { r.guards.ui.heldBrowser[0].response.phase = 'startup'; }],
  ['wrong-cancel-origin', r => { r.guards.origin = r.cases[0].origin; }],
  ['cancel-before-headers', r => { r.guards.ui.cancelCommandAt = r.guards.ui.heldAt - 1; }],
  ['release-before-abort', r => { r.requests.find(x => x.case === 'guards').releasedAt = 1100; }],
  ['absent-held-response', r => { r.guards.ui.heldBrowser.pop(); }],
  ['unrelated-proxy-abort', r => { r.requests[0].failed = 'client-aborted'; }],
  ['declared503-transport-failed', r => { r.requests.find(x => x.case === 'unavailable').failed = 'net::ERR_FAILED'; }],
  ['unreleased-held-bodies', r => { r.guards.ui.holdsReleased = false; }],
  ['unrestored-native-probes', r => { r.guards.probesRestored = false; }],
  ['guard-context-open', r => { r.guards.contextClosed = false; }],
  ['wrong-guard-probe-source', r => { r.guards.fixtureSource.sha256 = '0'.repeat(64); }],
  ['late-game-after-cancel', r => { r.guards.ui.frames[1].gamePresent = true; }],
  ['missing-second-frame', r => { r.guards.ui.frames.pop(); }],
  ['untrusted-cancel', r => { r.guards.ui.cancelEvent.trusted = false; }],
  ['cancel-after-deadline', r => { r.guards.ui.cancelEvent.at = r.guards.ui.startEvent.at + 6000; }],
  ['browser-trace-overflow', r => { r.browserAudio[0].trace.overflow = true; }],
  ['browser-observer-failure', r => { r.browserAudio[0].trace.observerFailure = true; }],
  ['orphan-browser-event', r => { const t = r.browserAudio[0].trace; t.events.push({ sequence: t.events.length + 1, at: 10000, type: 'failed', id: 999, phase: 'prepare', failure: 'net::ERR_FAILED' }); }],
  ['healthy-browser-abort', r => { r.browserAudio[0].trace.requests[0].terminal.type = 'failed'; r.browserAudio[0].trace.requests[0].terminal.failure = 'net::ERR_ABORTED'; }],
  ['missing-browser-recording', r => { r.browserAudio[0].trace.requests.pop(); }],
  ['duplicate-departure-marker', r => { r.browserAudio.push({ ...r.browserAudio[0], id: r.browserAudio.length + 1 }); }],
  ['wrong-playback-pause-type', r => { r.cases[0].resumedForPlayback = 'false'; }],

  ['wrong-order-bus', r => { r.cases[0].playback.order[0].bus = 'music'; }],
  ['wrong-ambient-bus', r => { r.cases[0].playback.ambient.bus = 'effects'; }],
  ['changed-effects-level', r => { r.cases[0].settings.after['audio.effects'] = 0; }],
  ['settings-not-persisted', r => { r.cases[0].restartSettings['audio.music'] = .5; }],
  ['wrong-notice-role', r => { r.cases[1].notice.role = null; }],
  ['unobserved-AC', r => { r.cases[0].beforeGesture.observed = false; }],
  ['fresh-save-absent', r => { delete r.cases[0].initialRaw; }],
  ['restart-controller-absent', r => { r.cases[0].restartController = false; }],
  ['late-origin-request', r => { r.cases[0].noRequestsAfterClose = false; }],
  ['same-case-origin', r => { r.cases[1].origin = r.cases[0].origin; }],
  ['failed-healthy-request', r => { r.requests[0].failed = 'net::ERR_ABORTED'; }],
  ['unknown-healthy500', r => { r.requests.push({ id: r.requests.length + 1, case: 'healthy', phase: 'prepare', path: 'unknown.json', method: 'GET', range: null, status: 500, finished: true }); }],
  ['unshipped-volley', r => { r.cases[0].playback.volley[0].id = 'volley-9'; }],
  ['fallback-overflow', r => { r.cases[1].playback.fallback.rows = Array.from({ length: 9 }, () => ({ ...r.cases[1].playback.fallback.rows[0] })); }],
  ['numeric-simtime-string', r => { r.cases[0].playback.simTime = '0'; }],
  ['unbound-run', r => { r.run = '999999'; }],
  ['unexplained-console', r => { r.console.push({ case: 'healthy', phase: 'playback', type: 'error', text: 'Uncaught unexpected error', url: r.cases[0].origin + 'src/main.js' }); }],
  ['first-decision-garbage', r => { r.cases[0].decisionSaves[0] = 'not a saved campaign'; }],
  ['already-departed-prefix', r => { for (const c of r.cases) { c.saves.before = c.saves.departed; c.decisionSaves[1] = c.saves.departed; } }],
  ['invalid-cancel-raw', r => { r.guards.cancel.before = r.guards.cancel.after = 'not JSON'; }],
  ['invalid-healthy-raw', r => { r.guards.healthy.before = r.guards.healthy.after = 'not JSON'; }],
  ['numeric-decoded-string', r => { r.cases[0].playback.decoded[0].length = '100'; }],
  ['numeric-fallback-string', r => { r.cases[1].playback.fallback.rows[0].duration = '1'; }],
  ['missing-request', r => { r.requests.pop(); }],
  ['changed-request-status', r => { r.requests[0].status = 503; }],
  ['source-SHA', r => { r.sha = 'b'.repeat(40); }], ['incomplete', r => { r.complete = false; }],
  ['generation', r => { r.generation = 'f'.repeat(64); }], ['overflow', r => { r.overflow = true; }],
  ['pageerror', r => { r.errors.push('native failure'); }], ['same-case', r => { r.cases[1].name = 'healthy'; }],
  ['cache-omission', r => { r.cases[0].cache.pop(); }], ['cache-digest', r => { r.cases[0].cache[0].sha256 = '0'.repeat(64); }],
  ['cache-length', r => { r.cases[0].cache[0].bytes--; }], ['cache-type', r => { r.cases[0].cache[0].type = 'opaque'; }],
  ['cache-range', r => { r.cases[0].cache[0].contentRange = 'bytes 0-3/100'; }], ['restart-cache', r => { r.cases[0].restartCache[0].present = false; }],
  ['cold-warmed', r => { r.cases[0].coldCache[0].present = true; }], ['missing-decoded', r => { r.cases[0].playback.decoded.pop(); }],
  ['fake-buffer', r => { r.cases[0].playback.decoded[0].native = false; }], ['fake-volley', r => { r.cases[0].playback.volley[0].ok = false; }],
  ['missing-order', r => { r.cases[0].playback.order = []; }], ['stopped-ambient', r => { r.cases[0].playback.ambient.stopped = true; }],
  ['fake-fallback', r => { r.cases[1].playback.fallback.rows[0].nativeSource = false; }], ['broken-restore', r => { r.cases[1].playback.fallback.restored = false; }],
  ['hidden-notice', r => { r.cases[1].notice.visible = false; }], ['missing-status', r => { r.cases[1].notice.status = false; }],
  ['503-warmed', r => { r.cases[1].cache[0].present = true; }], ['503-targets', r => { r.cases[1].rejectedPaths.pop(); }],
  ['origin-still-online', r => { r.cases[0].closed.reachable = true; }], ['not-restarted', r => { r.cases[0].browserRestarted = false; }],
  ['begun-early', r => { r.cases[0].beforeBegin.simTime = 1; }], ['pre-gesture-fetch', r => { r.cases[0].beforeGesture.requests = 1; }],
  ['second-departure', r => { r.cases[0].departures = 2; }], ['duplicate-charge', r => { const s = JSON.parse(r.cases[0].saves.departed); s.stores.ammunition++; r.cases[0].saves.departed = JSON.stringify(s); }],
  ['restart-save-change', r => { r.cases[0].saves.restart += ' '; }], ['queued-cancel-write', r => { r.guards.cancel.puts = 1; }],
  ['no-healthy-write', r => { r.guards.healthy.puts = 0; }], ['late-ui-departure', r => { r.guards.ui.departures = 1; }],
  ['ui-save-change', r => { r.guards.ui.rawAfter += ' '; }], ['cleanup-failure', r => { r.cases[0].cleanup[0].ok = false; }],
];

const API = { observeAudioTransport, observeFallbackCall, recordingProofErrors, prepareBattleRecordings, SOUNDS, AUDIO_BUDGET, ALLOWED_LICENCES, ORDER_CALLS, busLevel, busGain, Director, FallenPool, fadeOf, Mixer,
  servingSource: () => fs.readFileSync(path.join(ROOT, 'tools/serve.mjs'), 'utf8'), recordingSource: () => fs.readFileSync(path.join(ROOT, 'tools/test-offline-upgrade.mjs'), 'utf8'), fieldAdmissionProbe, defineAudio: defineAudioSettings, resultsMood: music.resultsMood, lossShareOf: music.lossShareOf, audioFiles, attributionText, goreHook: () => {} };

export const AUDIO_CHECKS = [

  ['recordings-serving-policy', async api => {
    const source = api.servingSource(), digest = b => createHash('sha256').update(b).digest('hex');
    const request = async (url, options = {}) => {
      try { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(1000) });
        return { status: response.status, headers: Object.fromEntries(response.headers), bytes: Buffer.from(await response.arrayBuffer()) }; }
      catch (error) { throw new Error('recordings-serving-policy: HTTP/body failure: ' + error.message); }
    };
    const verify = (row, bytes, policy = 'no-cache', head = false) => {
      assert.equal(row.status, 200, 'recordings-serving-policy: full200 required');
      assert.equal(row.headers['cache-control'], policy, 'recordings-serving-policy: exact public/private policy');
      assert.equal(row.headers['content-length'], String(bytes.length), 'recordings-serving-policy: declared current length');
      assert.equal(row.headers['content-range'], undefined, 'recordings-serving-policy: unchanged non-range response');
      assert.equal(row.headers.etag, undefined, 'recordings-serving-policy: no validator shortcut');
      assert.equal(row.headers['last-modified'], undefined, 'recordings-serving-policy: no date validator shortcut');
      assert.equal(row.headers['x-content-type-options'], 'nosniff', 'recordings-serving-policy: content protection changed');
      assert.equal(row.bytes.length, head ? 0 : bytes.length, 'recordings-serving-policy: actual body length');
      if (!head) assert.equal(digest(row.bytes), digest(bytes), 'recordings-serving-policy: exact current source bytes');
    };
    const close = async server => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); };
    const ram = async text => {
      const root = '/recordings-serving-ram', recording = root + '/assets/audio/sfx/volley-1.mp3';
      const files = new Map([[recording, Buffer.from('AAAA')], [root + '/assets/audio/music/title.mp3', Buffer.from('CCCC')],
        [root + '/other.mp3', Buffer.from('DDDD')], [root + '/index.html', Buffer.from('EEEE')]]), memo = new Map();
      const mockFS = { realpath: async p => { if (p === root || files.has(p)) return p; throw new Error('ENOENT'); },
        stat: async p => ({ size: files.get(p)?.length || 0, isDirectory: () => p === root, isFile: () => files.has(p) }),
        readFile: async p => Buffer.from(files.get(p)) };
      const declarations = text.slice(text.indexOf('const MIME ='), text.indexOf('const isMain =')).replace(/export /g, '');
      const factory = vm.runInNewContext(declarations + '; startServer', { http, path, URL, Buffer, fs: mockFS, SOUNDS, AUDIO_DIR, ROOT: root, DEFAULT_PORT: 0,
        memoizedReadFile: async p => { if (!memo.has(p)) memo.set(p, await mockFS.readFile(p)); return memo.get(p); } });
      const { server, url } = await factory({ port: 0 });
      try {
        verify(await request(url + 'assets/audio/sfx/volley-1.mp3'), Buffer.from('AAAA'));
        files.set(recording, Buffer.from('BBBB'));
        verify(await request(url + 'assets/audio/sfx/volley-1.mp3', { headers: { 'If-None-Match': 'invented', 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } }), Buffer.from('BBBB'));
        verify(await request(url + 'assets/audio/sfx/volley-1.mp3', { method: 'HEAD' }), Buffer.from('BBBB'), 'no-cache', true);
        verify(await request(url + 'assets/audio/sfx/volley-1.mp3', { headers: { Range: 'bytes=0-1' } }), Buffer.from('BBBB'), 'no-store');
        for (const [file, value] of [['assets/audio/music/title.mp3', 'CCCC'], ['other.mp3', 'DDDD'], ['index.html', 'EEEE']])
          verify(await request(url + file), Buffer.from(value), 'no-store');
        const missing = await request(url + 'missing.mp3');
        assert.ok(missing.status === 404 && missing.headers['cache-control'] === 'no-store', 'recordings-serving-policy: error policy changed');
      } finally { await close(server); }
    };
    await ram(source);
    const mutations = [
      ['broad', s => s.replace('PUBLIC_RECORDINGS.has(relative)', 'true')],
      ['max-age', s => s.replace("? 'no-cache' : 'no-store'", "? 'public, max-age=600' : 'no-store'")],
      ['304', s => s.replace('res.writeHead(200, {', "res.writeHead(req.headers['if-none-match'] ? 304 : 200, {")],
      ['stale', s => s.replace('await fs.readFile(real)', 'await memoizedReadFile(real)')],
      ['body', s => s.replace('await fs.readFile(real)', 'Buffer.alloc(st.size)')],
      ['length', s => s.replace("'Content-Length': st.size", "'Content-Length': st.size + 1")],
    ];
    for (const [name, mutate] of mutations) {
      const broken = mutate(source); assert.notEqual(broken, source, 'recordings-serving-policy: inert mutant ' + name);
      await assert.rejects(() => ram(broken), /recordings-serving-policy:/, 'recordings-serving-policy: accepted ' + name);
    }
    const { server, url } = await startServer({ port: 0 });
    try {
      const sounds = Object.values(SOUNDS).filter(s => s.bank === 'battle' || s.bank === 'ambient');
      assert.equal(sounds.length, 20, 'recordings-serving-policy: all seasons and battle recordings');
      for (const sound of sounds) {
        const file = AUDIO_DIR + sound.file, bytes = fs.readFileSync(path.join(ROOT, file));
        for (const options of [{}, { method: 'HEAD' }, { headers: { 'If-None-Match': 'invented', 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } }]) {
          const row = await request(url + file, options); verify(row, bytes, 'no-cache', options.method === 'HEAD');
          assert.equal(row.headers['content-type'], 'audio/mpeg', 'recordings-serving-policy: audio MIME changed');
        }
      }
      for (const file of ['index.html', 'offline-manifest.js', 'assets/audio/music/title.mp3']) verify(await request(url + file), fs.readFileSync(path.join(ROOT, file)), 'no-store');
      const file = 'assets/audio/sfx/volley-1.mp3'; verify(await request(url + file, { headers: { Range: 'bytes=0-1' } }), fs.readFileSync(path.join(ROOT, file)), 'no-store');
    } finally { await close(server); }
  }],
  ['recordings-producer-process', async api => {
    const source = api.recordingSource();
    const begin = source.indexOf('const report='), endText = 'process.exit(report.complete?0:1);';
    const old = source.slice(begin, source.indexOf(endText, begin) + endText.length);
    assert.ok(Buffer.byteLength(old) === 18405 && createHash('sha256').update(old).digest('hex') === '820020ae1d6bcc64895940aa0b9d753dcf0df5aabf16f26406aba05c3c535405',
      'recordings-producer-process: old26 source body changed');
    const closeStart = source.indexOf('  const closeContext=async context=>{');
    const closeEnd = source.indexOf('  const fixtureSettings=', closeStart);
    const closeExpression = source.slice(closeStart, closeEnd).trim().replace(/^const closeContext=/, '').replace(/;$/, '');
    for (const mode of ['healthy', 'restore-false', 'restore-falsy', 'restore-hang', 'close-falsy', 'both-falsy', 'close-hang']) {
      const recording = { cleanup: [] }, calls = [], first = null, second = false, deadline = new Error('controlled cleanup deadline');
      const context = { pages: () => [{ isClosed: () => false, evaluate: async () => {
        calls.push('restore'); if (mode === 'restore-falsy' || mode === 'both-falsy') throw first;
        if (mode === 'restore-hang') return new Promise(() => {});
        return mode !== 'restore-false'; } }], close: () => {
        calls.push('close'); if (mode === 'close-falsy' || mode === 'both-falsy') throw second;
        return mode === 'close-hang' ? new Promise(() => {}) : Promise.resolve(); } };
      const close = vm.runInNewContext('(' + closeExpression + ')', { recording, assert,
        bounded: (pending, label, ms) => { assert.equal(ms, 30000); return (mode === 'restore-hang' && label === 'AudioContext observer restoration')
          || (mode === 'close-hang' && label === 'actual browser/context close') ? Promise.reject(deadline) : pending; } });
      let caught = false, error;
      try { await close(context); } catch (e) { caught = true; error = e; }
      assert.deepEqual(calls, ['restore', 'close'], 'recordings-producer-process: restoration failure skipped actual close');
      assert.equal(caught, mode !== 'healthy', 'recordings-producer-process: cleanup failure disappeared');
      if (mode === 'restore-falsy' || mode === 'both-falsy') assert.equal(error, first, 'recordings-producer-process: first falsy failure replaced');
      if (mode === 'close-falsy') assert.equal(error, second, 'recordings-producer-process: close falsy failure replaced');
      if (mode === 'close-hang' || mode === 'restore-hang') assert.equal(error, deadline, 'recordings-producer-process: hanging close did not propagate bound');
      if (['close-falsy', 'both-falsy', 'close-hang'].includes(mode)) assert.ok(recording.cleanup.length === 1 && recording.cleanup[0].ok === false,
        'recordings-producer-process: close failure lacked separate receipt');
    }
    const hardstop = source.match(/  hardstop=setTimeout\((\(\)=>\{[\s\S]*?\}),480000\);/)?.[1];
    assert.ok(hardstop, 'recordings-producer-process: actual terminal callback unavailable');
    for (const persistence of ['new Promise(()=>{})', 'Promise.reject(new Error("controlled persistence failure"))']) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        'let recording={complete:true};const fail=()=>{};const nativeTimer=setTimeout;globalThis.setTimeout=(fn,ms)=>{console.log("timer:"+ms);return nativeTimer(fn,ms);};' +
        'const persist=()=>{console.log("persist-start");return ' + persistence + ';};(' + hardstop + ')();'],
        { encoding: 'utf8', timeout: 7000, maxBuffer: 16384 });
      assert.ok(child.status === 1 && child.signal === null && child.stdout.indexOf('timer:5000') >= 0
        && child.stdout.indexOf('timer:5000') < child.stdout.indexOf('persist-start'),
        'recordings-producer-process: terminal watchdog missing, late, or non-failing with stuck persistence');
    }
  }],
  ['recordings-worker-readiness',async api=>{
    const prefix='recordings-worker-readiness: ',source=api.recordingSource();
    const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,prefix+'actual helper missing');return source.slice(a,b);};
    const helpers=section('  const bounded=','  const persist=')+section('  const initialWorker=','  const closeContext=');
    const bundle=fs.readFileSync(path.join(ROOT,'node_modules/playwright-core/lib/coreBundle.js'),'utf8'),
      begin=bundle.indexOf('let evaledExpression;',bundle.indexOf('async waitForFunctionExpression(')),end=bundle.indexOf('}, { expression: expression2',begin);
    assert(begin>=0&&end>begin,prefix+'pinned poller unavailable');
    const pollScope={flag:false},queue=[];vm.createContext(pollScope);
    const poll=vm.runInContext('(function(injected,{expression:expression3,isFunction:isFunction3,polling,arg:arg2}){'+bundle.slice(begin,end)+'})',pollScope),
      injected={utils:{builtins:{requestAnimationFrame:fn=>queue.push(fn),setTimeout:fn=>queue.push(fn)}}};
    assert.equal(await poll(injected,{expression:'async p=>await p',isFunction:true,arg:Promise.resolve(false)}).result,false,prefix+'async false source behavior');
    assert.equal(queue.length,0,prefix+'async predicate unexpectedly polled');
    let finish;const pending=new Promise(r=>finish=r),late=poll(injected,{expression:'async p=>await p',isFunction:true,arg:pending});
    assert.equal(queue.length,0,prefix+'deferred Promise unexpectedly polled');finish(false);assert.equal(await late.result,false,prefix+'deferred false');
    const sync=poll(injected,{expression:'()=>globalThis.flag',isFunction:true});assert.equal(queue.length,1,prefix+'sync false must poll');
    pollScope.flag=true;queue.shift()();assert.equal(await sync.result,true,prefix+'sync true');
    const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
    const fixture=()=>{
      let clock=1000,next=0,reads=0,lateReads=0;const timers=new Map(),origin='http://127.0.0.1:12345/',
        registration={scope:origin,active:{scriptURL:origin+'sw.js',state:'activated'}},entry={mode:'title',importing:false};
      let read=()=>Promise.resolve(registration);
      const env={Date:{now:()=>clock},URL,Promise,window:{__entry:entry},location:{href:origin+'?sw'},
        navigator:{serviceWorker:{getRegistration:()=>read(),controller:null}},
        setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
      const initial=vm.runInNewContext(helpers+';initialWorker',env),page={evaluate:async fn=>{
        reads++;const value=await fn();return new Proxy(value,{get(target,key){if(clock>=61000&&key==='url')lateReads++;return Reflect.get(target,key);}});
      }};
      let outcome=null;const task=Promise.resolve().then(()=>initial(page,origin)).then(value=>{outcome={ok:true,value};},error=>{outcome={ok:false,error};});
      const tick=async at=>{clock=at;for(const[id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();};
      return{registration,entry,env,timers,task,tick,setRead:fn=>{read=fn;},get reads(){return reads;},get lateReads(){return lateReads;},get outcome(){return outcome;}};
    };
    // A deferred getRegistration cannot let reload advance; activating and importing stay unready.
    const f=fixture();let release;f.setRead(()=>new Promise(r=>release=r));await flush();assert.equal(f.outcome,null,prefix+'deferred registration advanced');
    release(undefined);await flush();f.setRead(()=>Promise.resolve(f.registration));f.registration.active.state='activating';await f.tick(1025);
    assert.equal(f.outcome,null,prefix+'activating worker advanced');f.registration.active.state='activated';f.entry.importing=true;await f.tick(1050);
    assert.equal(f.outcome,null,prefix+'importing entry advanced');f.entry.importing=false;await f.tick(1075);await f.task;
    assert.equal(f.outcome?.ok,true,prefix+'healthy activation rejected');assert.equal(f.outcome.value.state,'activated',prefix+'activation receipt');
    assert.equal(f.outcome.value.observedAt,1075,prefix+'observation time');assert.equal(f.timers.size,0,prefix+'successful timer cleanup');
    for(const kind of ['scope','script','document','controlled','mode']){
      const r=fixture();if(kind==='scope')r.registration.scope='http://foreign.example/';if(kind==='script')r.registration.active.scriptURL+='other';
      if(kind==='document')r.env.location.href+='wrong';if(kind==='controlled')r.env.navigator.serviceWorker.controller={};if(kind==='mode')r.entry.mode='camp';
      await flush();assert.equal(r.outcome,null,prefix+'wrong '+kind+' advanced');r.registration.scope='http://127.0.0.1:12345/';
      r.registration.active.scriptURL=r.registration.scope+'sw.js';r.env.location.href=r.registration.scope+'?sw';r.env.navigator.serviceWorker.controller=null;r.entry.mode='title';
      await r.tick(1025);await r.task;assert.equal(r.outcome?.ok,true,prefix+'repaired '+kind+' rejected');assert.equal(r.timers.size,0,prefix+'identity timer cleanup');
    }
    const timed=fixture();let lateRelease;timed.setRead(()=>new Promise(r=>lateRelease=r));await flush();await timed.tick(61000);await timed.task;
    assert.equal(timed.outcome?.ok,false,prefix+'shared60s deadline disappeared');assert.match(String(timed.outcome.error),/recording deadline: initial worker activation/,prefix+'wrong deadline');
    const before=timed.reads;lateRelease(timed.registration);await flush();await timed.tick(61025);
    assert.equal(timed.outcome.ok,false,prefix+'late resolution advanced');assert.equal(timed.reads,before,prefix+'observation after close');
    assert.equal(timed.lateReads,0,prefix+'late snapshot gate read after deadline');assert.equal(timed.timers.size,0,prefix+'timed-out timer cleanup');
  }],
  ['audio-body-observer', async api => {
    const fixture = async mode => {
      const sandbox = { URL, Headers, AbortController, performance, mode };
      const code = `(async () => {
        const signalOwner = new AbortController(), failure = mode === 'read-falsy' ? 0 : mode === 'fetch-falsy' ? null : false;
        const counts = { fetch: 0, acquire: 0, read: 0, cancel: 0, release: 0 }, cancelResolvers = [];
        const reader = { async read() { counts.read++; if (mode === 'read-falsy') throw failure;
            return counts.read === 1 ? { done: false, value: new Uint8Array(7) } : { done: true }; },
          cancel() { counts.cancel++; if (mode === 'cancel-falsy') throw failure;
            if (mode === 'repeat-cancel') return new Promise(resolve => cancelResolvers.push(resolve));
            return Promise.resolve('cancelled'); },
          releaseLock() { counts.release++; return 'released'; } };
        class Stream { getReader() { counts.acquire++; if (mode === 'acquire-falsy') throw failure; return reader; }
          cancel() { counts.cancel++; return Promise.resolve('body cancelled'); } }
        class Response { clone() { return this; } async arrayBuffer() { return new ArrayBuffer(0); } }
        class Canvas { getContext() { return null; } }
        const body = new Stream();
        globalThis.HTMLCanvasElement = Canvas; globalThis.ReadableStream = Stream; globalThis.Response = Response;
        globalThis.window = globalThis; globalThis.location = { href: 'http://example.test/', search: '' };
        globalThis.document = { getElementById: () => null };
        const nativeFetch = globalThis.fetch = async function(input, init) {
          counts.fetch++; if (mode === 'fetch-falsy') throw failure;
          const response = { status: 200, type: 'basic', url: input, body,
            headers: new Headers({ 'content-length': '7', 'content-type': 'audio/mpeg' }) };
          if (mode === 'metadata-fault') Object.defineProperty(response, 'url', { get() { throw failure; } });
          return response;
        };
        const original = [Canvas.prototype.getContext, Stream.prototype.getReader, Stream.prototype.cancel,
          Response.prototype.clone, Response.prototype.arrayBuffer, globalThis.fetch, JSON.parse];
        if (mode === 'cleanup-fault') signalOwner.signal.removeEventListener = () => { throw false; };
        (PROBE)();
        const method = mode === 'method-function' ? () => 'GET' : mode === 'method-symbol' ? Symbol('GET')
          : mode === 'method-large' ? 'X'.repeat(20000) : 'GET';
        const first = await fetch('http://example.test/assets/audio/sfx/volley-1.mp3', { signal: signalOwner.signal, method }).then(
          response => ({ response }), error => ({ rejected: true, exact: error === failure }));
        let readExact = false, acquireExact = false, cancelExact = false, returnExact = false;
        if (first.response) {
          let active;
          try { active = first.response.body.getReader(); } catch (error) { acquireExact = error === failure; }
          if (active) {
            try { await active.read(); await active.read(); } catch (error) { readExact = error === failure; }
            try { const pending = active.cancel();
              if (mode === 'repeat-cancel') { active.cancel(); cancelResolvers[0]('cancelled'); }
              returnExact = await pending === 'cancelled'; } catch (error) { cancelExact = error === failure; }
            returnExact = active.releaseLock() === 'released' && (mode === 'cancel-falsy' || returnExact);
          }
        }
        if (mode === 'aborted') signalOwner.abort();
        if (mode === 'cap') for (let i = 0; i < 65; i++) await fetch('http://example.test/assets/audio/sfx/volley-1.mp3');
        const report = globalThis.__admissionAudio;
        const restored = globalThis.__admissionRestore?.() === true;
        signalOwner.abort();
        const descriptors = original.every((v, i) => v === [Canvas.prototype.getContext, Stream.prototype.getReader, Stream.prototype.cancel,
          Response.prototype.clone, Response.prototype.arrayBuffer, globalThis.fetch, JSON.parse][i]);
        const readerRestored = reader.read.name === 'read' && reader.cancel.name === 'cancel' && reader.releaseLock.name === 'releaseLock';
        return { counts, first: { rejected: first.rejected, exact: first.exact }, readExact, acquireExact, cancelExact,
          returnExact, report, restored, descriptors, readerRestored };
      })()`.replace('PROBE', api.fieldAdmissionProbe.toString());
      return vm.runInNewContext(code, sandbox);
    };
    const healthy = await fixture('healthy');
    assert.ok(healthy.report && healthy.restored && healthy.descriptors && healthy.readerRestored && healthy.returnExact,
      'audio-body-observer: delegation or exact restoration lost');
    const row = healthy.report.requests[0];
    assert.ok(healthy.counts.fetch === 1 && healthy.counts.acquire === 1 && healthy.counts.read === 2
      && healthy.counts.cancel === 1 && healthy.counts.release === 1 && row.bytes === 7 && row.reads === 2
      && row.eof && row.readerCancel.settled && row.release.settled && !row.aborted
      && row.response.type === 'basic' && row.response.headers['content-length'] === '7'
      && !healthy.report.observerFailure && !healthy.report.overflow, 'audio-body-observer: real call facts lost or extra work performed');
    for (const [mode, flag] of [['fetch-falsy', 'fetchRejected'], ['read-falsy', 'readRejected'], ['acquire-falsy', 'getReader'], ['cancel-falsy', 'readerCancel']]) {
      const r = await fixture(mode), row = r.report.requests[0];
      assert.ok(r.restored && r.descriptors && row[flag] && (r.first.exact || r.readExact || r.acquireExact || r.cancelExact),
        'audio-body-observer: falsy original failure identity lost');
    }
    const aborted = await fixture('aborted');
    assert.ok(aborted.report.requests[0].aborted && !aborted.report.requests[0].signalInitiallyAborted,
      'audio-body-observer: actual signal abort lost');
    const capped = await fixture('cap');
    assert.ok(capped.report.requests.length === 64 && capped.report.overflow && capped.counts.fetch === 66,
      'audio-body-observer: cap must reject without suppressing native fetch');
    const repeated = await fixture('repeat-cancel');
    assert.ok(repeated.counts.cancel === 2 && repeated.report.observerFailure && !repeated.restored
      && repeated.descriptors && repeated.report.requests[0].readerCancel.calls === 2
      && !repeated.report.requests[0].readerCancel.settled,
      'audio-body-observer: first cancellation settled a different pending operation');
    const cleanup = await fixture('cleanup-fault');
    assert.ok(cleanup.report.observerFailure && !cleanup.restored && cleanup.descriptors,
      'audio-body-observer: cleanup observer fault escaped restoration gate');
    for (const mode of ['method-function', 'method-symbol', 'method-large']) {
      const r = await fixture(mode);
      assert.ok(r.report.observerFailure && r.report.requests[0].method === null && !r.restored && r.descriptors
        && r.counts.fetch === 1 && r.counts.read === 2 && JSON.stringify(r.report).length < 12000,
        'audio-body-observer: unsafe method escaped bound or changed native delegation');
    }
    const faulty = await fixture('metadata-fault');
    assert.ok(faulty.report.observerFailure && faulty.counts.fetch === 1 && faulty.counts.read === 2 && !faulty.restored && faulty.descriptors,
      'audio-body-observer: observer metadata fault changed delegation');
  }],
  ['audio-transport-observer', async api => {
    const listeners = new Map(), page = { on(type, fn) { listeners.set(type, fn); } }, emit = (type, value) => listeners.get(type)(value);
    let at = 0, phase = 'loading'; const r = api.observeAudioTransport(page, { phase: () => phase, now: () => ++at });
    const req = (file = 'volley-1.mp3') => ({ url: () => 'http://example.test/assets/audio/sfx/' + file, method: () => 'GET', failure: () => ({ errorText: 'net::ERR_ABORTED' }) });
    const first = req(), second = req(); emit('request', first); emit('request', second);
    emit('response', { request: () => first, status: () => 200 }); emit('requestfinished', first);
    emit('request', { url: () => 'http://example.test/src/main.js' }); phase = 'closing'; emit('requestfailed', second);
    assert.ok(r.requests.length === 2 && r.requests[0].id === 1 && r.requests[1].id === 2
      && r.requests[0].terminal.type === 'finished' && r.requests[1].terminal.type === 'failed'
      && r.requests[1].terminal.phase === 'closing' && r.main?.type === 'main-request'
      && r.events.every((e, i) => e.sequence === i + 1 && e.at === i + 1) && !r.overflow && !r.observerFailure,
      'audio-transport-observer: identity, terminal facts, Node ordering or phases lost');
    emit('requestfinished', second); assert.ok(r.observerFailure, 'audio-transport-observer: contradictory terminal event hidden');
    const bounded = api.observeAudioTransport(page);
    for (let i = 0; i < 65; i++) emit('request', req('shot-1.mp3'));
    assert.ok(bounded.requests.length === 64 && bounded.overflow, 'audio-transport-observer: request cap not rejecting');
    const fault = api.observeAudioTransport(page); emit('request', { url() { throw false; } });
    assert.ok(fault.observerFailure, 'audio-transport-observer: metadata failure escaped observation');
  }],

  ['prepare-transport-cleanup', async api => {
    for (const mode of ['complete', 'truncated', 'overrun', '503', 'length']) {
      const f = recordingFixture(mode), r = await api.prepareBattleRecordings(recordingScenario, prepareOptions(f.fetcher));
      const expectedCancel = ['overrun', '503', 'length'].includes(mode) ? 1 : 0;
      assert.ok(f.stats.readersCancelled === expectedCancel && f.stats.signals.every(s => !s.aborted)
        && r.complete === (mode === 'complete') && !r.cancelled,
        'prepare-transport-cleanup: EOF/nonEOF cleanup or normal abort wrong for ' + mode);
    }
  }],
  ['recordings-proof-reader', async api => {
    const f = await recordingProofFixture(); assert.deepEqual(api.recordingProofErrors(f.report, f.expected), [], 'recordings-proof-reader: complete constructed evidence rejected');
    for (const [name, mutate] of recordingProofMutations) {
      const changed = structuredClone(f.report); mutate(changed);
      assert.ok(api.recordingProofErrors(changed, f.expected).length > 0, 'recordings-proof-reader: accepted ' + name);
    }
    console.log('RECORDING READER ' + recordingProofMutations.length + ' intended field mutations rejected; CPU constructed evidence only');
  }],

  ['fallback-observer', async (api) => {
    const args = [0, false, null, Symbol('argument')], returned = {}, sound = { ctx: { state: 'running' } }; let calls = 0;
    sound.zzfx = function (...actual) { calls++; assert.equal(this, sound, 'fallback-observer: receiver changed'); assert.deepEqual(actual, args, 'fallback-observer: arguments changed'); return returned; };
    const descriptor = Object.getOwnPropertyDescriptor(sound, 'zzfx'), observer = api.observeFallbackCall(sound);
    assert.equal(sound.zzfx(...args), returned, 'fallback-observer: returned identity changed');
    const receipt = observer.close();
    assert.ok(calls === 1 && receipt.owned && receipt.restored && !receipt.failed && receipt.rows.length === 1 && receipt.rows[0].delegated,
      'fallback-observer: delegation or owned restoration failed');
    assert.deepEqual(Object.getOwnPropertyDescriptor(sound, 'zzfx'), descriptor, 'fallback-observer: descriptor changed');
    for (const thrown of [undefined, null, false, 0, '', Symbol('thrown')]) {
      sound.zzfx = () => { throw thrown; }; const o = api.observeFallbackCall(sound); let caught = false, value;
      try { sound.zzfx(); } catch (e) { caught = true; value = e; }
      const r = o.close(); assert.ok(caught && value === thrown && r.rows[0]?.threw === true && r.restored, 'fallback-observer: falsy thrown identity changed');
    }
  }],
  ['fallback-observer-foreign', async (api) => {
    const sound = { zzfx() {}, ctx: { state: 'running' } }, observer = api.observeFallbackCall(sound), foreign = () => 7;
    sound.zzfx = foreign; const r = observer.close();
    assert.ok(!r.owned && !r.restored && sound.zzfx === foreign, 'fallback-observer-foreign: foreign replacement was hidden or overwritten');
  }],
  ['fallback-observer-metadata', async api => {
    for (const [field, value] of [['length', () => {}], ['duration', Symbol('duration')], ['numberOfChannels', 'x'.repeat(20000)], ['length', Infinity]]) {
      const returned = { buffer: { length: 100, duration: 1, numberOfChannels: 1, [field]: value } };
      const sound = { zzfx: () => returned, ctx: { state: 'running' } }, observer = api.observeFallbackCall(sound);
      assert.equal(sound.zzfx(), returned, 'fallback-observer-metadata: actual returned identity changed');
      const receipt = observer.close();
      assert.ok(receipt.failed === true && receipt.restored && JSON.stringify(receipt).length < 2000
        && structuredClone(receipt).rows.length === 1, 'fallback-observer-metadata: unsafe metadata escaped bounded cloneable receipt');
    }
  }],
  ['fallback-observer-failure', async (api) => {
    const originalResult = {}, sound = { zzfx: () => originalResult, get ctx() { throw false; } };
    const observer = api.observeFallbackCall(sound), returned = sound.zzfx(), r = observer.close();
    assert.ok(returned === originalResult && r.failed && r.restored, 'fallback-observer-failure: metadata failure changed the delegated result or disappeared');
  }],


  ['prepare-complete', async (api) => {
    const f = recordingFixture(), result = await api.prepareBattleRecordings(recordingScenario, prepareOptions(f.fetcher));
    assert.ok(result.complete && result.available === 18 && result.requested === 18 && !result.cancelled, 'prepare-complete: full recorded banks were not prepared');
    assert.equal(f.stats.calls.length, 18, 'prepare-complete: every selected recording must be fetched once');
    assert.equal(new Set(f.stats.calls).size, 18, 'prepare-complete: duplicate recording request');
    assert.ok(f.stats.calls.some(u => u.endsWith('/amb-autumn.mp3')) && !f.stats.calls.some(u => /music\/|amb-spring|amb-winter/.test(u)), 'prepare-complete: wrong season or streamed music requested');
    assert.ok(f.stats.signals.every(s => s === f.stats.signals[0] && !s.aborted) && Object.isFrozen(result), 'prepare-complete: normal completion must close metadata without aborting settled transports');
  }],
  ['prepare-unavailable', async (api) => {
    for (const mode of ['reject', '503', '206', 'opaque', 'range', 'length', 'oversized', 'truncated', 'overrun']) {
      const f = recordingFixture(mode), r = await api.prepareBattleRecordings(recordingScenario, prepareOptions(f.fetcher));
      assert.ok(!r.complete && !r.cancelled && r.reason === 'unavailable' && r.available === 17 && r.requested === 18,
        'prepare-unavailable: ' + mode + ' was accepted or prevented ordinary limited departure');
    }
  }],
  ['prepare-deadline', async (api) => {
    const f = recordingFixture('fetch-hang'), r = await api.prepareBattleRecordings(recordingScenario, { fetcher: f.fetcher, deadlineMs: 15 });
    assert.ok(r.reason === 'deadline' && !r.cancelled && !r.complete && r.available === 0 && f.stats.calls.length === 3,
      'prepare-deadline: stuck fetch must settle limited with at most three in flight');
    assert.ok(f.stats.signals.every(s => s.aborted), 'prepare-deadline: deadline did not abort requests');
  }],
  ['prepare-scenario-deadline', async (api) => {
    const f = recordingFixture(); let signal;
    const r = await api.prepareBattleRecordings(s => { signal = s; return new Promise(() => {}); }, { fetcher: f.fetcher, deadlineMs: 15 });
    assert.ok(r.reason === 'deadline' && !r.complete && !r.cancelled && r.requested === 0 && f.stats.calls.length === 0 && signal.aborted,
      'prepare-scenario-deadline: deadline must include actual scenario resolution');
  }],
  ['prepare-cancel', async (api) => {
    const controller = new AbortController(), f = recordingFixture('fetch-hang');
    const p = api.prepareBattleRecordings(recordingScenario, { ...prepareOptions(f.fetcher), signal: controller.signal });
    await Promise.resolve(); controller.abort(); const r = await p;
    assert.ok(r.cancelled && r.reason === 'cancelled' && !r.complete && f.stats.calls.length <= 3, 'prepare-cancel: explicit cancellation did not suppress departure');
    const early = recordingFixture(), r0 = await api.prepareBattleRecordings(recordingScenario, { ...prepareOptions(early.fetcher), signal: controller.signal });
    assert.ok(r0.cancelled && early.stats.calls.length === 0, 'prepare-cancel: cancelled attempt started requests');
  }],
  ['prepare-stale', async (api) => {
    let current = true; const f = recordingFixture('fetch-hang');
    const p = api.prepareBattleRecordings(recordingScenario, { fetcher: f.fetcher, deadlineMs: 15, isCurrent: () => current });
    await Promise.resolve(); current = false; const r = await p;
    assert.ok(r.cancelled && r.reason === 'cancelled' && !r.complete, 'prepare-stale: deadline classification overrode stale ownership');
  }],
  ['prepare-late', async (api) => {
    const f = recordingFixture(); let release; const held = new Promise(resolve => { release = resolve; }); let calls = 0;
    const p = api.prepareBattleRecordings(recordingScenario, { deadlineMs: 15, fetcher: async (...args) => { calls++; await held; return f.fetcher(...args); } });
    const r = await p, snapshot = JSON.stringify(r); release();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(r.reason === 'deadline' && r.available === 0 && JSON.stringify(r) === snapshot && calls === 3,
      'prepare-late: late work changed metadata or started another request');
    assert.equal(f.stats.readersCancelled, 3, 'prepare-late: late response bodies were not cancelled');
  }],
  ['prepare-body-deadline', async (api) => {
    const f = recordingFixture('body-hang'), r = await api.prepareBattleRecordings(recordingScenario, { fetcher: f.fetcher, deadlineMs: 15 });
    assert.ok(r.reason === 'deadline' && !r.complete && !r.cancelled && r.available === 0 && f.stats.calls.length === 3,
      'prepare-body-deadline: stuck read/cancel held departure or escaped concurrency bound');
  }],
  ['prepare-pagehide', async (api) => {
    const add = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener'), remove = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
    let listener, removed = false;
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (name, fn) => { if (name === 'pagehide') listener = fn; } });
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: (name, fn) => { if (name === 'pagehide' && fn === listener) removed = true; } });
    try {
      const f = recordingFixture('fetch-hang'), p = api.prepareBattleRecordings(recordingScenario, prepareOptions(f.fetcher));
      await Promise.resolve(); listener(); const r = await p;
      assert.ok(r.cancelled && !r.complete && removed, 'prepare-pagehide: page departure did not cancel and remove its exact listener');
    } finally {
      if (add) Object.defineProperty(globalThis, 'addEventListener', add); else delete globalThis.addEventListener;
      if (remove) Object.defineProperty(globalThis, 'removeEventListener', remove); else delete globalThis.removeEventListener;
    }
  }],

  ['bank-files', (api) => {
    const files = api.audioFiles(), listed = Object.values(api.SOUNDS).map((s) => s.file).sort();
    assert.ok(files.length > 0, 'bank-files: no files under assets/audio');
    assert.deepEqual(files, [...new Set(listed)].sort(), 'bank-files: assets/audio and the bank manifest list different files');
    for (const [id, s] of Object.entries(api.SOUNDS)) {
      assert.ok(api.ALLOWED_LICENCES.some((l) => s.licence.startsWith(l)), `bank-files: ${id} has licence ${s.licence}`);
      const h = mp3Header(path.join(AUDIO, s.file));
      assert.ok(h && h.mpeg1 && h.layer3, `bank-files: ${s.file} is not an MPEG-1 Layer III (MP3) file`);
      assert.equal(h.mono, s.bus !== 'music', `bank-files: ${s.file} must be ${s.bus === 'music' ? 'stereo music' : 'a mono effect'}`);
    }
  }],
  ['attribution', (api) => {
    const text = api.attributionText(), bullets = soundBullets(text);
    assert.ok(bullets.length > 0, 'attribution: ATTRIBUTION.md has no "Sound and music" section');
    for (const s of Object.values(api.SOUNDS)) {
      const row = bullets.find((b) => b.includes(`assets/audio/${s.file}`));
      assert.ok(row, `attribution: assets/audio/${s.file} is not listed in ATTRIBUTION.md`);
      assert.ok(/ — (CC0 1\.0|Public domain|CC BY [\d.]+)/.test(row) && !/CC BY-(NC|ND|SA)/.test(row), `attribution: assets/audio/${s.file} has no allowed licence in ATTRIBUTION.md`);
      assert.ok(/https:\/\/(freesound\.org|commons\.wikimedia\.org|archive\.org)\//.test(row), `attribution: assets/audio/${s.file} has no source page URL`);
      if (/CC BY /.test(row)) assert.ok(/ — CC BY [\d.]+ — [^—]+/.test(row), `attribution: assets/audio/${s.file} is CC-BY without its author`);
    }
    assert.ok(!bullets.some((b) => /freesound\.org\/people\/craigsmith\//.test(b)), 'attribution: a craigsmith recording is used');
  }],
  ['budget', (api) => {
    let effects = 0, tunes = 0;
    for (const s of Object.values(api.SOUNDS)) {
      const n = fs.statSync(path.join(AUDIO, s.file)).size;
      assert.ok(n <= api.AUDIO_BUDGET.file, `budget: ${s.file} is ${(n / MB).toFixed(2)} MB (over ${(api.AUDIO_BUDGET.file / MB).toFixed(1)} MB)`);
      if (s.bus === 'music') tunes += n; else effects += n;
    }
    assert.ok(effects <= api.AUDIO_BUDGET.effects && effects <= 4 * MB, `budget: effects, calls, voices and ambience are ${(effects / MB).toFixed(2)} MB (over ${(Math.min(api.AUDIO_BUDGET.effects, 4 * MB) / MB).toFixed(1)} MB)`);
    assert.ok(tunes <= api.AUDIO_BUDGET.music && tunes <= 8 * MB, `budget: music is ${(tunes / MB).toFixed(2)} MB (over ${(Math.min(api.AUDIO_BUDGET.music, 8 * MB) / MB).toFixed(1)} MB)`);
  }],
  ['mixer-maths', (api) => {
    const v = { master: 0.5, effects: 0.8, music: 0.4, voices: 1, mute: false };
    const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `mixer-maths: ${what} is ${a}, expected ${b}`);
    near(api.busLevel('effects', v), 0.4, 'effects level');
    near(api.busLevel('ambient', v), 0.4, 'ambient level (follows Effects)');
    near(api.busLevel('ui', v), 0.4, 'reward sounds level (follow Effects)');
    near(api.busLevel('music', v), 0.2, 'music level');
    near(api.busLevel('voices', v), 0.5, 'voices level');
    near(api.busGain('effects', v), 0.16, 'effects gain (level squared)');
    near(api.busGain('ambient', v, 0.5), 0.08, 'ducked ambient gain');
    near(api.busLevel('effects', { ...v, mute: true }), 0, 'muted level');
    near(api.busLevel('music', { ...v, master: 0 }), 0, 'master 0');
    near(api.busLevel('effects', { ...v, master: 7, effects: -2 }), 0, 'clamped level');
    near(api.busLevel('voices', { ...v, master: NaN }), 0, 'NaN master');
    near(api.busLevel('effects', null), 0, 'no levels');
  }],
  ['director-limits', (api) => {
    const c = clockAt(100), m = fakeMixer({ dur: 10 }); // long sounds: none ends during the burst
    const d = new api.Director({ mixer: m, now: c.now, rnd: () => 0.5 });
    for (let i = 0; i < 20; i++) d.volley(0, 0, 400); // twenty units firing in one frame
    assert.equal(m.plays.length, 1, 'director-limits: a burst of volleys in one instant must play once (volley cooldown)');
    for (let i = 0; i < 30; i++) { c.t += DIRECTOR.cooldown.volley + 0.001; d.volley(0, 0, 400); }
    assert.equal(m.plays.length, DIRECTOR.maxVoices, `director-limits: ${m.plays.length} volleys live at once; the cap is ${DIRECTOR.maxVoices}`);
    assert.equal(d.voices(), DIRECTOR.maxVoices, 'director-limits: the voice count must stand at the cap');
    c.t += 10.1; // every one-shot has ended
    assert.ok(d.volley(0, 0, 400), 'director-limits: a volley must play again once voices have ended');
    const before = m.plays.length;
    d.cannon(0, 0); d.cannon(0, 0); c.t += DIRECTOR.cooldown.cannon / 2; d.cannon(0, 0);
    assert.equal(m.plays.length - before, 1, 'director-limits: cannon reports inside the cannon cooldown must not stack');
    assert.equal(m.plays.at(-1).id, 'cannon', 'director-limits: the cannon sound is "cannon"');
    assert.match(d.volley(0, 0, 40)?.id ?? 'none', /^shot-\d$/, 'director-limits: a unit under 80 men fires a single shot');
    // order calls: one per callGap, one per kind per callRepeat; labels come back
    c.t += 10;
    assert.equal(d.order('charge'), ORDER_CALLS.charge.label, 'director-limits: the first Charge call plays and names its call');
    assert.equal(d.order('move'), null, 'director-limits: a second call inside the call gap must not play');
    c.t += DIRECTOR.callGap + 0.01;
    assert.equal(d.order('charge'), null, 'director-limits: the same kind again inside callRepeat must not play');
    assert.equal(d.order('move'), ORDER_CALLS.move.label, 'director-limits: another kind after the call gap plays');
    assert.equal(d.order('dance'), null, 'director-limits: an unknown order kind has no call');
    // paused: one-shots stop and no new ones play
    d.update(0.016, { paused: true });
    c.t += 5;
    assert.equal(d.volley(0, 0, 400), null, 'director-limits: no volley may play while paused');
    assert.ok(m.stopped.includes('effects') && m.ducks.some(([b, f]) => b === 'ambient' && f < 1), 'director-limits: pause must stop the effects and duck the ambience');
    d.update(0.016, { paused: false });
    assert.ok(m.ducks.some(([b, f]) => b === 'ambient' && f === 1), 'director-limits: resuming must restore the ambience');
    // far away: too quiet to play at all; panned and duller with distance through locate()
    const far = new api.Director({ mixer: fakeMixer(), now: c.now, locate: () => ({ pan: -0.6, gain: 0.01, lowpass: 1400 }) });
    assert.equal(far.volley(0, 0, 400), null, 'director-limits: a volley too far to hear must not take a voice');
    const near = new api.Director({ mixer: fakeMixer(), now: c.now, locate: () => ({ pan: -0.6, gain: 0.8, lowpass: 2800 }) });
    const h = near.volley(0, 0, 500);
    assert.ok(h && h.opts.pan === -0.6 && h.opts.lowpass === 2800 && Math.abs(h.opts.gain - 0.8) < 1e-9, 'director-limits: a volley takes its pan, distance gain and low-pass from locate()');
  }],
  ['director-bed', (api) => {
    const c = clockAt(0), m = fakeMixer();
    const d = new api.Director({ mixer: m, now: c.now, rnd: () => 0.99 });
    const level = (firing, paused = false) => d.update(0.016, { firing, paused, season: 'winter' });
    assert.equal(level(0), 0, 'director-bed: nobody firing must leave the rolling-fire bed silent');
    const some = level(4), full = level(10), many = level(40);
    assert.ok(some > 0 && some < full, `director-bed: 4 units firing gave ${some}, 10 gave ${full}; the bed must swell with the fighting`);
    assert.equal(full, DIRECTOR.bedMax, 'director-bed: 10 or more firing is the full bed');
    assert.equal(many, DIRECTOR.bedMax, 'director-bed: the bed is capped');
    assert.equal(level(40, true), 0, 'director-bed: pause silences the bed');
    const bed = m.plays.find((p) => p.id === 'fire-bed');
    assert.ok(bed && bed.opts.loop && bed.gains.at(-1) === 0, 'director-bed: the bed is one looping sound whose gain follows the fighting');
    assert.ok(m.plays.some((p) => p.id === 'amb-winter' && p.opts.loop), 'director-bed: a winter field plays the winter ambience');
    assert.equal(ambientFor('spring'), 'amb-spring', 'director-bed: spring ambience');
    assert.equal(ambientFor('autumn'), 'amb-autumn', 'director-bed: autumn ambience');
    assert.equal(ambientFor(undefined), 'amb-spring', 'director-bed: a field with no season uses the summer meadow');
    d.update(0.016, { firing: 0, season: 'spring', cavalry: { x: 0, z: 0 } });
    assert.ok(m.plays.some((p) => p.id === 'amb-spring') && m.plays.some((p) => p.id === 'horse-gallop' && p.opts.loop), 'director-bed: a season change swaps the ambience; moving cavalry brings the gallop');
  }],
  ['order-calls', (api) => {
    for (const kind of ['move', 'run', 'attack', 'charge', 'hold', 'halt', 'holdfire', 'fallback']) {
      const c = api.ORDER_CALLS[kind];
      assert.ok(c && api.SOUNDS[c.id] && api.SOUNDS[c.id].role === 'call', `order-calls: the ${kind} order has no call in the bank`);
      assert.ok(typeof c.label === 'string' && c.label.length > 8, `order-calls: the ${kind} call has no label`);
    }
    for (const [kind, c] of Object.entries(api.ORDER_CALLS)) {
      if (c.id === 'call-retreat') assert.ok(/not the 1862/.test(c.label) && /modern/.test(c.label), `order-calls: the ${kind} call (modern Retreat) must say it is not the 1862 signal`);
      assert.ok(!/\b1862\b/.test(c.label) || /not the 1862/.test(c.label), `order-calls: the ${kind} call is captioned as an 1862 signal`);
    }
  }],
  ['gore-sim', (api) => {
    const a = henryHillRun(), b = (() => { settings.set('look.gore', false); try { return henryHillRun(); } finally { settings.set('look.gore', true); } })();
    assert.deepEqual(b, a, 'gore-sim: gore off changed the Henry Hill oracle run');
    const on = goreRun(api, true), off = goreRun(api, false);
    settings.set('look.gore', true);
    assert.ok(on.laid > 0, 'gore-sim: the run laid down no casualties (the check would prove nothing)');
    assert.ok(off.hidden > 0 && on.hidden === 0, `gore-sim: gore off must fade some fallen (${off.hidden} of ${off.laid}) and gore on none (${on.hidden})`);
    assert.deepEqual(off.sim, on.sim, 'gore-sim: gore off changed the simulation (men, positions, states, result or random stream)');
  }],
  ['gore-fade', (api) => {
    const c = clockAt(0), clock = FALLEN.clock;
    FALLEN.clock = c.now;
    settings.set('look.gore', false);
    try {
      const p = new api.FallenPool(8, UNIFORMS.US);
      const lay = (t, y) => { c.t = t; const i = p.alloc(); p.set(i, 0, y, 0, 0, 4.4, false, 0, 0, false); return i; };
      const a = lay(0, 10), b = lay(1, 20), d = lay(7, 30);
      const y = (i) => p.mesh.instanceMatrix.array[i * 16 + 13], clipOf = (i) => p.clip.array[i];
      c.t = 3; p.flush();
      assert.ok(y(a) === 10 && clipOf(a) === 0, 'gore-fade: a casualty must lie unchanged before the fade delay');
      c.t = 7; p.flush();
      assert.ok(y(a) < 10 && y(a) > 10 - 4.4 && clipOf(a) === 0, `gore-fade: halfway through the fade the casualty must be sinking (y ${y(a)})`);
      c.t = 9.01; p.flush();
      assert.ok(clipOf(a) === 2 && clipOf(b) === 2 && clipOf(d) === 0 && y(d) === 30, 'gore-fade: after delay + fade the casualty must be hidden and a younger one still lying');
      assert.equal(api.fadeOf(100, true), 0, 'gore-fade: with gore on nothing fades');
      settings.set('look.gore', true); p.flush();
      assert.ok(clipOf(a) === 0 && clipOf(b) === 0 && y(a) === 10 && y(b) === 20, 'gore-fade: gore on must put every faded casualty back where he fell');
    } finally { FALLEN.clock = clock; settings.set('look.gore', true); }
  }],
  ['settings-persist', async (api) => {
    const prev = globalThis.window;
    try {
      // An older build saved only its own keys (and a lock); this build adds the audio and gore settings.
      const old = { 'cw.settings': JSON.stringify({ 'screens.cardStyle': 'hybrid', 'look.smoke': false, 'audio.voices': 7, 'audio.mute': 'maybe' }), 'cw.locks': '["screens.cardStyle"]' };
      const { S, store } = await freshSettings(old, 'persist-a');
      api.defineAudio(S); S.define(settings.GORE_KEY, settings.GORE_SPEC);
      assert.equal(S.get('audio.master'), 0.8, 'settings-persist: a new setting must start at its default under an old save');
      assert.equal(S.get('audio.voices'), 1, 'settings-persist: an out-of-range stored volume must clamp to 1');
      assert.equal(S.get('audio.mute'), false, 'settings-persist: a garbage stored mute must fall back to off');
      assert.equal(S.get('look.gore'), true, 'settings-persist: gore starts on');
      S.set('audio.master', 0.45); S.set('audio.music', 0); S.set('look.gore', false); S.set('audio.mute', true);
      const saved = JSON.parse(store.get('cw.settings'));
      assert.ok(saved['screens.cardStyle'] === 'hybrid' && saved['look.smoke'] === false, 'settings-persist: saving must keep the older build\'s values');
      assert.ok(saved['audio.master'] === 0.45 && saved['audio.music'] === 0 && saved['look.gore'] === false && saved['audio.mute'] === true, `settings-persist: the new values were not saved: ${store.get('cw.settings')}`);
      assert.equal(store.get('cw.locks'), '["screens.cardStyle"]', 'settings-persist: locks must be untouched');
      const again = await freshSettings(Object.fromEntries(store), 'persist-b');
      api.defineAudio(again.S); again.S.define(settings.GORE_KEY, settings.GORE_SPEC);
      assert.ok(again.S.get('audio.master') === 0.45 && again.S.get('audio.music') === 0 && again.S.get('look.gore') === false && again.S.get('audio.mute') === true,
        'settings-persist: a reload must read the saved volumes, mute and gore');
      for (const [key, spec] of AUDIO_SETTINGS) assert.ok(again.S.all().some((e) => e.key === key && e.spec.tab === spec.tab), `settings-persist: ${key} is not defined`);
    } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
  }],
  ['music-moods', (api) => {
    assert.equal(api.resultsMood({ lossShare: 0.29 }), 'results', 'music-moods: light losses play the results tune');
    assert.equal(api.resultsMood({ lossShare: music.HEAVY_LOSSES }), 'lament', 'music-moods: heavy losses play the lament');
    const game = { playerSide: 'US', units: [{ side: 'US', men: 700, casualties: 300 }, { side: 'US', men: 900, casualties: 100 }, { side: 'CS', men: 10, casualties: 990 }] };
    assert.ok(Math.abs(api.lossShareOf(game) - 0.2) < 1e-9, `music-moods: the player's loss share is ${api.lossShareOf(game)}, expected 0.2 (enemy losses do not count)`);
    for (const mood of ['title', 'camp', 'results', 'lament']) assert.ok(api.SOUNDS[`music-${mood}`]?.stream, `music-moods: ${mood} has no streamed tune`);
    music.setBattle(true);
    try { assert.equal(music.playMusic('camp'), false, 'music-moods: music must be refused during a battle'); }
    finally { music.setBattle(false); }
    assert.equal(music.playMusic('anthem'), false, 'music-moods: an unknown mood is refused');
    music.stopMusic(0);
  }],
  ['lazy-load', async (api) => {
    const made = [], fetched = [], listeners = [];
    class FakeAC {
      constructor() { made.push(this); this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createDynamicsCompressor() { return { threshold: {}, ratio: {}, attack: {}, release: {}, connect() {} }; }
      createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
      decodeAudioData() { return Promise.resolve({ duration: 1 }); }
      resume() { return Promise.resolve(); }
    }
    const prev = { window: globalThis.window, fetch: globalThis.fetch };
    globalThis.window = { AudioContext: FakeAC, addEventListener: (type) => listeners.push(type), removeEventListener() {} };
    globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const m = new api.Mixer();
      m.arm();
      const loading = m.loadBank('battle');
      await Promise.resolve(); await new Promise((r) => setTimeout(r, 5));
      assert.equal(made.length, 0, 'lazy-load: an AudioContext was created before the first gesture');
      assert.equal(fetched.length, 0, `lazy-load: fetched before the first gesture: ${fetched.slice(0, 3).join(', ')}`);
      assert.ok(['pointerdown', 'keydown', 'touchend'].every((g) => listeners.includes(g)), 'lazy-load: arm() must listen for the first tap, click or key');
      assert.equal(m.play('cannon'), null, 'lazy-load: nothing may play before the first gesture');
      m.unlock(); // the gesture
      await loading;
      assert.equal(made.length, 1, 'lazy-load: the gesture must create one AudioContext');
      assert.ok(fetched.some((u) => u.endsWith('/assets/audio/sfx/cannon.mp3')) && !fetched.some((u) => /music\//.test(u) || /amb-/.test(u)),
        'lazy-load: the battle bank must load after the gesture, without music or ambience');
    } finally {
      if (prev.window === undefined) delete globalThis.window; else globalThis.window = prev.window;
      if (prev.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = prev.fetch;
    }
  }],
];

// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'recordings-serving-policy': { servingSource: () => fs.readFileSync(path.join(ROOT, 'tools/serve.mjs'), 'utf8').replace("? 'no-cache' : 'no-store'", "? 'no-store' : 'no-store'") },
  'recordings-worker-readiness': { recordingSource: () => fs.readFileSync(path.join(ROOT, 'tools/test-offline-upgrade.mjs'), 'utf8').replace('if(closed||at>=deadline)return false;', 'if(false)return false;') },
  'recordings-producer-process': { recordingSource: () => fs.readFileSync(path.join(ROOT, 'tools/test-offline-upgrade.mjs'), 'utf8').replace('setTimeout(()=>process.exit(1),5000)', 'setTimeout(()=>process.exit(0),5)') },
  'audio-body-observer': { fieldAdmissionProbe: () => {} },
  'audio-transport-observer': { observeAudioTransport: (...args) => { const r = observeAudioTransport(...args); Object.defineProperty(r, 'main', { configurable: true, get: () => null, set() {} }); return r; } },
  'fallback-observer-metadata': { observeFallbackCall: sound => { const o = observeFallbackCall(sound); return { close: () => ({ ...o.close(), failed: false }) }; } },
  'prepare-transport-cleanup': { prepareBattleRecordings: async (resolve, options) => {
    const c = new AbortController();
    const r = await prepareBattleRecordings(resolve, { ...options, fetcher: (url, init) => options.fetcher(url, { ...init, signal: c.signal }) });
    c.abort(); return r;
  } },
  'recordings-proof-reader': { recordingProofErrors: () => [] },
  'fallback-observer': { observeFallbackCall: () => ({ close: () => ({ owned: true, restored: true, failed: false, rows: [] }) }) },
  'fallback-observer-foreign': { observeFallbackCall: sound => { const o = observeFallbackCall(sound); return { close: () => ({ ...o.close(), owned: true }) }; } },
  'fallback-observer-failure': { observeFallbackCall: sound => { const o = observeFallbackCall(sound); return { close: () => ({ ...o.close(), failed: false }) }; } },

  'prepare-complete': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), complete: false }) },
  'prepare-unavailable': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), complete: true }) },
  'prepare-deadline': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), reason: 'complete' }) },
  'prepare-scenario-deadline': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), reason: 'complete' }) },
  'prepare-cancel': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), cancelled: false }) },
  'prepare-stale': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), cancelled: false, reason: 'deadline' }) },
  'prepare-late': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), available: 18 }) },
  'prepare-body-deadline': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), complete: true }) },
  'prepare-pagehide': { prepareBattleRecordings: async (...args) => ({ ...await prepareBattleRecordings(...args), cancelled: false }) },

  'bank-files': { audioFiles: () => [...audioFiles(), 'sfx/stray.mp3'] },
  attribution: { attributionText: () => attributionText().replace('`assets/audio/sfx/cannon.mp3` — CC0 1.0', '`assets/audio/sfx/cannon.mp3` — CC BY-NC 4.0') },
  budget: { AUDIO_BUDGET: { ...AUDIO_BUDGET, effects: 1 * MB } },
  'mixer-maths': { busLevel: (bus, v) => (v ? v.master * v.effects : 0) },
  'director-limits': { Director: class extends Director { allow() { return !this.paused; } } },
  'director-bed': { Director: class extends Director { update(dt, state = {}) { return super.update(dt, { ...state, firing: 99 }); } } },
  'order-calls': { ORDER_CALLS: { ...ORDER_CALLS, fallback: { id: 'call-retreat', label: 'Bugle: Retreat, the 1862 tactical signal' } } },
  'gore-sim': { goreHook: (g, goreOn) => { if (!goreOn) g.rnd(); } },
  'gore-fade': { FallenPool: class extends FallenPool { fade() { return null; } } },
  'settings-persist': { defineAudio: (S) => { for (const [key, spec] of AUDIO_SETTINGS) S.define(`${key}Volume`, spec); } },
  'music-moods': { resultsMood: () => 'results' },
  'lazy-load': { Mixer: class extends Mixer { arm() { super.arm(); this.unlock(); } } },
};

async function runCheck(name, check, api) {
  try { await check(api); }
  catch (e) {
    if (e?.code === 'ERR_ASSERTION' && String(e.message).startsWith(name)) throw e;
    throw new assert.AssertionError({ message: `${name}: unexpected error: ${e?.message ?? e}` });
  }
}
export async function audioUnit(api = API) {
  for (const [name, check] of AUDIO_CHECKS) await runCheck(name, check, api);
  return AUDIO_CHECKS.length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  let failed = 0;
  for (const [name, check] of AUDIO_CHECKS) {
    try { await runCheck(name, check, API); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${e.message.split('\n')[0]}`); }
  }
  const n = AUDIO_CHECKS.length;
  if (failed) { console.log(`AUDIO FAILED (${n - failed}/${n})`); process.exit(1); }
  console.log(`AUDIO OK (${n}/${n})`);
  if (process.argv.includes('--prove-fail')) {
    let caught = 0;
    for (const [name, check] of AUDIO_CHECKS) {
      let error = null;
      try { await runCheck(name, check, { ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      if (error && error.message.startsWith(`${name}:`) && !/unexpected error/.test(error.message)) { caught++; console.log(`CAUGHT ${error.message.split('\n')[0]}`); }
      else console.log(`NOT-CAUGHT ${name}${error ? `: ${error.message.split('\n')[0]}` : ''}`);
    }
    if (caught !== n) { console.log(`AUDIO CONTROLS FAILED (${caught}/${n})`); process.exit(1); }
    console.log(`AUDIO CONTROLS OK (${caught}/${n})`);
  }
  process.exit(0);
}

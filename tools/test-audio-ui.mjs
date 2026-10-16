// Browser checks for recorded sound, music, the Settings panel, the gore toggle and HUD feedback readability (P6a).
// `audioControls({ browser, url, check, shot, result, watchErrors })`, registered in tools/test.mjs shard 1 as `--audio`.
// 1. Title: no request under assets/audio (and no AudioContext) before a gesture; after one click the title tune
//    streams (src/audio/music.js currentMood() is 'title').
// 2. Battle (?sandbox&quality=low): after a click the battle bank loads; a volley through the real effects seam plays a
//    recorded volley (spied on window.__game.audio.mixer.log, no audio output needed); a Hold order (H) plays its call.
// 3. Settings panel: O opens it with focus inside, the keyboard moves a volume and it persists, Escape closes it and
//    focus returns to the field; the strip's button opens it and Close returns focus to the button; axe clean; 320 px
//    fits with 44 px controls.
// 4. Gore off: a casualty laid in the real fallen pool is hidden after the fade (battle clock), gore on restores him.
// 5. Feed and toasts: no box (transparent feed, translucent row backing, text shadow), at most 3 rows in view, clear of
//    the objective line and the dock, at 1280x720 and 320x568 (screenshots).
import { AxeBuilder } from '@axe-core/playwright';
import { AUDIO_DIR, SOUNDS } from '../src/audio/bank.js';
import { parseSnapshot, exportSnapshot, MAX_SAVE_BYTES } from '../src/franchise/save.js';
import { breakCamp } from '../src/franchise/camp-orders.js';
import { reconcileLevelRewards } from '../src/franchise/level-rewards.js';
import { campaignPhase } from '../src/franchise/campaign.js';
import { cardsFor, chooseDecision, optionOpen } from '../src/franchise/decisions.js';
import { savedDeployment } from '../src/franchise/practice.js';

const settle = (page) => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));

export async function audioControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. title: nothing before a gesture ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(() => {
        window.__audioContexts = 0;
        const AC = window.AudioContext;
        if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__audioContexts++; } };
      });
      const page = await ctx.newPage(), errors = [], requests = [];
      watchErrors(page, url, errors);
      page.on('request', (r) => requests.push(new URL(r.url()).pathname));
      await page.goto(url + '?nosw');
      await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => window.__audioContexts);
      check('audio-title-no-request', !requests.some((p) => /assets\/audio\//.test(p)) && before === 0,
        `${requests.filter((p) => /assets\/audio\//.test(p)).join(', ') || 'no audio request'}; ${before} AudioContext before a gesture`);
      result.audioTitleRequests = requests.filter((p) => /audio/.test(p));
      const heading = page.locator('#entry-title-heading');
      if (await heading.count()) await heading.click(); else await page.mouse.click(4, 4);
      await page.waitForFunction(async () => (await import('./src/audio/music.js')).currentMood() === 'title', null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const mood = await page.evaluate(async () => (await import('./src/audio/music.js')).currentMood());
      check('audio-title-after-gesture', mood === 'title' && requests.some((p) => p.endsWith('/assets/audio/music/title.mp3')),
        `mood ${mood}; title tune requested: ${requests.some((p) => p.endsWith('/assets/audio/music/title.mp3'))}`);
      check('audio-title-no-errors', errors.length === 0, errors.join('\n') || '0 errors');
    } finally { await ctx.close(); }
  }

  // ---- 2-5. the battlefield ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage(), errors = [];
    watchErrors(page, url, errors);
    await page.goto(`${url}?sandbox&quality=low&nosw`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    if ((await page.locator('#sb-toggle').getAttribute('aria-expanded').catch(() => null)) === 'true') await page.locator('#sb-toggle').click();
    await page.locator('#battlefield').click({ position: { x: 640, y: 300 } }); // the first gesture
    await page.waitForFunction(() => { const s = window.__game.audio.mixer.stats(); return s.state === 'running' && ['volley-1', 'cannon', 'fire-bed', 'call-recall'].every((id) => s.loaded.includes(id)); }, null, { timeout: 60000 })
      .catch(() => {});
    const stats = await page.evaluate(() => window.__game.audio.mixer.stats());
    check('audio-battle-bank', stats.state === 'running' && ['volley-1', 'cannon', 'fire-bed', 'call-recall'].every((id) => stats.loaded.includes(id)) && !stats.loaded.some((id) => id.startsWith('music-')),
      `${stats.state}; loaded ${stats.loaded.join(', ')}`);
    if (await page.evaluate(() => window.__game.game.paused)) await page.locator('#pause').click();
    const volley = await page.evaluate(async () => {
      const { game, effects, audio } = window.__game, n = audio.mixer.log.length;
      const u = game.units.find((x) => x.alive && x.type === 'infantry');
      await new Promise((r) => setTimeout(r, 200));
      effects.volley(u, [[u.x, u.z, 0]]);
      return audio.mixer.log.slice(n);
    });
    check('audio-volley-plays', volley.some((e) => /^(volley|shot)-\d$/.test(e.id) && e.ok && e.bus === 'effects'), JSON.stringify(volley));
    const call = await page.evaluate(async () => {
      const { game, audio } = window.__game, n = audio.mixer.log.length;
      const u = game.units.find((x) => x.alive && x.side === game.playerSide && game.controls(x) && x.canTakeOrders());
      game.select(u); document.getElementById('battlefield').focus();
      return { n, id: u?.id };
    });
    await page.keyboard.press('h'); await settle(page);
    const calls = await page.evaluate((n) => window.__game.audio.mixer.log.slice(n), call.n);
    check('audio-order-call', calls.some((e) => e.id === 'call-recall' && e.ok), `${call.id}: ${JSON.stringify(calls)}`);

    // ---- 3. the Settings panel ----
    await page.locator('#battlefield').focus(); await page.keyboard.press('o');
    await page.waitForSelector('#settings-panel[open]');
    const opened = await page.evaluate(() => ({ inside: document.getElementById('settings-panel').contains(document.activeElement), modal: document.querySelector('#settings-panel').matches(':modal') }));
    const master0 = await page.evaluate(async () => (await import('./src/settings.js')).get('audio.master'));
    await page.locator('#cws-audio-master').focus(); await page.keyboard.press('ArrowRight');
    const master1 = await page.evaluate(async () => (await import('./src/settings.js')).get('audio.master'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cw.settings') || '{}')['audio.master']);
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const trapped = await page.evaluate(() => document.getElementById('settings-panel').contains(document.activeElement));
    await shot(page, 'audio-settings-1280');
    const axe = await new AxeBuilder({ page }).include('#settings-panel').analyze(); result.audioSettingsAxe = axe.violations;
    await page.keyboard.press('Escape'); await settle(page);
    const closed = await page.evaluate(() => ({ gone: !document.getElementById('settings-panel'), focus: document.activeElement?.id }));
    check('audio-settings-key', opened.inside && opened.modal && trapped && Math.abs(master1 - master0 - 0.05) < 1e-9 && saved === master1 && closed.gone && closed.focus === 'battlefield',
      JSON.stringify({ opened, master0, master1, saved, trapped, closed }));
    check('audio-settings-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id)));
    await page.locator('#settings-btn').click();
    await page.waitForSelector('#settings-panel[open]');
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await settle(page);
    check('audio-settings-button', await page.evaluate(() => !document.getElementById('settings-panel') && document.activeElement?.id === 'settings-btn'), 'the strip button opens it; Close returns focus to the button');
    check('audio-settings-help', await page.locator('#menu ul.keys').textContent().then((t) => /Settings.*\bO\b/.test(t)), 'the help sheet lists O for Settings');

    // ---- 4. gore off: the fallen fade ----
    const gore = await page.evaluate(async () => {
      const S = await import('./src/settings.js'), { game } = window.__game, p = game.fallen.US;
      S.set('look.gore', false);
      const i = p.alloc(); p.set(i, 0, 5, 0, 0, 4.4, false, 0, 0, false);
      const lying = p.clip.array[i];
      game.fastForward(9); // the fade runs on the battle clock
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const hidden = p.clip.array[i];
      S.set('look.gore', true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { lying, hidden, restored: p.clip.array[i], y: p.mesh.instanceMatrix.array[i * 16 + 13] };
    });
    check('audio-gore-fade', gore.lying === 0 && gore.hidden === 2 && gore.restored === 0 && Math.abs(gore.y - 5) < 1e-6, JSON.stringify(gore));

    // ---- 5. feed and toasts read on the field without a box ----
    const readable = async (label) => {
      await page.evaluate(() => {
        const { game, hud } = window.__game, u = game.units.find((x) => x.alive);
        for (let i = 0; i < 5; i++) game.event(`Fictional feed line ${i + 1} for the readability check (test only).`, u, 'info');
        hud.toast('Fictional toast for the readability check (test only).');
      });
      await settle(page);
      const r = await page.evaluate(() => {
        const rect = (e) => e.getBoundingClientRect(), feed = document.getElementById('feed'), fr = rect(feed);
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const css = getComputedStyle(feed), rows = [...feed.querySelectorAll('li')];
        const inView = rows.filter((li) => { const b = rect(li); return b.bottom > fr.top + 2 && b.top < fr.bottom - 2; });
        const span = feed.querySelector('li:last-child span'), back = getComputedStyle(span).backgroundColor;
        const alpha = Number((/rgba?\(([^)]+)\)/.exec(back)?.[1].split(',')[3] ?? '1').trim());
        const blocks = ['objective', 'unitcard', 'orders', 'minimap-box'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden && e.getClientRects().length);
        const toast = document.querySelector('#toasts p'), tr = toast ? rect(toast) : null, obj = document.getElementById('objective');
        return { feedBg: css.backgroundColor, feedShadow: css.boxShadow, rows: rows.length, inView: inView.length, alpha, shadow: getComputedStyle(feed.querySelector('button')).textShadow,
          clear: blocks.filter((b) => overlap(fr, rect(b))).map((b) => b.id), toastBg: toast ? getComputedStyle(toast).backgroundColor : null,
          toastClear: !tr || !obj.getClientRects().length || tr.top >= rect(obj).bottom - 1, toasts: document.querySelectorAll('#toasts p').length };
      });
      await shot(page, `audio-feed-${label}`);
      return r;
    };
    const wide = await readable('1280');
    const ok = (r) => r.feedBg === 'rgba(0, 0, 0, 0)' && r.feedShadow === 'none' && r.inView >= 1 && r.inView <= 3 && r.alpha > 0 && r.alpha < 1
      && r.shadow !== 'none' && r.clear.length === 0 && r.toastClear && r.toasts <= 3 && /rgba\(.*0\.\d+\)/.test(r.toastBg || '');
    check('audio-feed-1280', ok(wide), JSON.stringify(wide));
    await page.setViewportSize({ width: 320, height: 568 }); await settle(page); await page.waitForTimeout(300);
    const narrow = await readable('320');
    check('audio-feed-320', ok(narrow), JSON.stringify(narrow));
    await page.locator('#settings-btn').click(); await page.waitForSelector('#settings-panel[open]');
    const fit = await page.evaluate(() => {
      const d = document.getElementById('settings-panel'), r = d.getBoundingClientRect();
      const small = [...d.querySelectorAll('.cws-close, .cws-choice, .cws-check, input[type=range], summary')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => e.className || e.tagName);
      const tiny = [...d.querySelectorAll('label, p, legend, summary, li, button')].filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.className || e.tagName);
      return { left: r.left, right: r.right, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, overflow: d.scrollWidth > d.clientWidth, small, tiny };
    });
    await shot(page, 'audio-settings-320');
    const axe320 = await new AxeBuilder({ page }).include('#settings-panel').analyze();
    await page.keyboard.press('Escape');
    check('audio-settings-320', fit.inView && !fit.overflow && fit.small.length === 0 && fit.tiny.length === 0 && axe320.violations.length === 0,
      JSON.stringify({ ...fit, axe: axe320.violations.map((v) => v.id) }));
    check('audio-no-console-errors', errors.length === 0, errors.join('\n') || '0 errors');
  } finally { await ctx.close(); }
}


/** Observe one real ZzFX delegation without changing its receiver, arguments, return or thrown value. */
export function observeFallbackCall(sound) {
  const descriptor = Object.getOwnPropertyDescriptor(sound, 'zzfx');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function' || !descriptor.configurable)
    throw new Error('fallback observer: expected owned configurable function');
  const original = descriptor.value, rows = [];
  let failed = false, closed = false;
  function wrapper(...args) {
    let value, threw = false, error;
    try { value = Reflect.apply(original, this, args); } catch (caught) { threw = true; error = caught; }
    try {
      if (rows.length >= 8) failed = true;
      else {
        const scalar = (number, max, integer = false) => {
          if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > max
            || (integer && !Number.isSafeInteger(number))) { failed = true; return 0; }
          return number;
        };
        rows.push({ delegated: true, threw,
          nativeSource: !threw && typeof AudioBufferSourceNode !== 'undefined' && value instanceof AudioBufferSourceNode,
          nativeBuffer: !threw && typeof AudioBuffer !== 'undefined' && value?.buffer instanceof AudioBuffer,
          length: !threw ? scalar(value?.buffer?.length ?? 0, 100000000, true) : 0,
          duration: !threw ? scalar(value?.buffer?.duration ?? 0, 600) : 0,
          channels: !threw ? scalar(value?.buffer?.numberOfChannels ?? 0, 8, true) : 0,
          contextRunning: sound.ctx?.state === 'running' });
      }
    } catch { failed = true; }
    if (threw) throw error;
    return value;
  }
  Object.defineProperty(sound, 'zzfx', { ...descriptor, value: wrapper });
  const installed = Object.getOwnPropertyDescriptor(sound, 'zzfx');
  return { close() {
    if (closed) return { owned: false, restored: false, failed: true, rows: rows.map(r => ({ ...r })) };
    closed = true;
    const current = Object.getOwnPropertyDescriptor(sound, 'zzfx');
    const owned = current && Object.keys(installed).every(k => current[k] === installed[k]);
    if (owned) Object.defineProperty(sound, 'zzfx', descriptor);
    const after = Object.getOwnPropertyDescriptor(sound, 'zzfx');
    const restored = !!after && Object.keys(descriptor).every(k => after[k] === descriptor[k]);
    return { owned: !!owned, restored, failed, rows: rows.map(r => ({ ...r })) };
  } };
}


/** Separate replay of recorded/synthetic execution; source inputs come from committed files, never the report. */
export function recordingProofErrors(report, { sha, run, manifest, campaign, fielded, expectedIds, initial, deck, guardRaw, guardFixtureSource }) {
  const errors = [], need = (ok, name) => { if (!ok) errors.push(name); };
  try {
    const positiveInt = (n, max = 100000000) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= max;
    const positive = (n, max) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max;
    need(typeof run === 'string' && report.run === run && expectedIds.length === 18 && new Set(expectedIds).size === 18, 'exact-run/source-ids');
    need(exportSnapshot(parseSnapshot(guardRaw)) === guardRaw && parseSnapshot(guardRaw).kind === 'completed-reward', 'source-guard-baseline');
    const guardBaseline=parseSnapshot(guardRaw);
    const guardAllocation=savedDeployment({baseline:guardBaseline,ground:{},awardId:'recording-guard-admission',seed:1861,surrender:true}).allocation;
    need(guardBaseline.army.length===1&&guardBaseline.army[0].id==='b1','source-admissible-guard-fixture');
    need(!initial.ready && initial.campaign.index === 0 && initial.campaign.history.length === 0, 'source-fresh-prefix');
    const sourceDecisions = [], phase = campaignPhase(initial, campaign);
    let decisionPrefix = initial;
    for (const card of cardsFor(deck, phase)) {
      const option = card.options.find(o => optionOpen(decisionPrefix, o).ok);
      decisionPrefix = reconcileLevelRewards(chooseDecision(decisionPrefix, { campaign, deck, cardId: card.id, optionId: option.id }), MAX_SAVE_BYTES);
      sourceDecisions.push(exportSnapshot(decisionPrefix));
    }
    need(sourceDecisions.length === 2 && !decisionPrefix.ready, 'source-decision-prefix');
    need(Array.isArray(report.console) && report.console.length <= 256 && Array.isArray(report.requests) && report.requests.length <= 4096, 'raw-diagnostic-containers');
    need(positiveInt(guardFixtureSource?.bytes, 100000) && /^[a-f0-9]{64}$/.test(guardFixtureSource?.sha256), 'actual-guard-probe-source');
    const g = report.guards, time = n => positive(n, Number.MAX_SAFE_INTEGER);
    const guardProxyIds = new Set(), guardBrowserKeys = new Set();
    let boundGuard = false;
    try {
      const u = g.ui, ordered = [u.startedAt, u.heldAt, u.cancelCommandAt, u.settledAt, u.terminalsAt, u.observedAt];
      boundGuard = g.origin !== report.cases[0].origin && g.origin !== report.cases[1].origin
        && new URL(g.origin).hostname === '127.0.0.1' && new URL(g.origin).origin + '/' === g.origin
        && JSON.stringify(g.fixtureSource) === JSON.stringify(guardFixtureSource)
        && g.probesRestored === true && g.contextClosed === true && u.holdsReleased === true
        && ['audio.master', 'audio.effects', 'audio.voices'].every(key => positive(u.settings.before[key], 1) && u.settings.after[key] === u.settings.before[key])
        && u.settings.after['audio.mute'] === false && u.settings.before['audio.mute'] === false && u.settings.after['audio.music'] === 0
        && ordered.every(time) && ordered.every((n, i) => i === 0 || n >= ordered[i - 1])
        && u.startEvent.trusted === true && u.cancelEvent.trusted === true
        && [u.startEvent, u.cancelEvent].every(e => e.timebase === 'browser-performance-UTC' && time(e.at))
        && u.cancelEvent.at >= u.startEvent.at && u.cancelEvent.at - u.startEvent.at < 6000
        && u.heldProxyRequestIds.length === 3 && new Set(u.heldProxyRequestIds).size === 3
        && u.proxyAbortIds.length === 3 && JSON.stringify(u.proxyAbortIds.slice().sort((a,b)=>a-b)) === JSON.stringify(u.heldProxyRequestIds.slice().sort((a,b)=>a-b))
        && u.heldBrowser.length === 3 && u.browserAbort.length === 3
        && u.frames.length === 2 && u.frames.every((f, i) => f.gpu === 0 && f.gamePresent === false && f.cancelled === true
          && f.admitted === false && f.ownerReleased === true && f.closed === true && time(f.at)
          && f.at >= u.cancelEvent.at && (i === 0 || f.at > u.frames[i - 1].at))
        && report.requests.filter(r => r.case === 'guards' && r.path === 'src/main.js').length === 0;
      const review=u.review;
      boundGuard=boundGuard&&review?.open===true&&review.enabled===true&&review.busy===false
        &&review.cancelled===false&&review.admitted===false&&review.baselineRaw===guardRaw
        &&JSON.stringify(review.allocation)===JSON.stringify(guardAllocation)&&typeof review.note==='string'&&review.note.length>0;
      const paths = new Set();
      for (const id of u.heldProxyRequestIds) {
        const p = report.requests.find(r => r.id === id);
        if (!p || p.case !== 'guards' || p.origin !== g.origin || p.phase !== 'cancel' || p.method !== 'GET' || p.range !== null
          || p.status !== 200 || p.held !== true || p.finished !== false || p.failed !== 'client-aborted'
          || !expectedIds.some(id => p.path === AUDIO_DIR + SOUNDS[id].file)
          || ![p.at, p.failedAt, p.releasedAt].every(time) || p.at > u.heldAt || p.failedAt < u.cancelCommandAt
          || p.failedAt > u.terminalsAt || p.releasedAt < u.terminalsAt || p.releasedAt > u.observedAt || paths.has(p.path)) boundGuard = false;
        if (p) { paths.add(p.path); guardProxyIds.add(id); }
      }
      for (const h of u.heldBrowser) {
        const t = report.browserAudio.find(t => t.id === h.traceId), r = t?.trace.requests.find(r => r.id === h.id);
        const key = h.traceId + ':' + h.id;
        const p = report.requests.find(p => guardProxyIds.has(p.id) && g.origin + p.path === h.url && p.method === h.method);
        const aborted = u.browserAbort.filter(a => a.traceId === h.traceId && a.id === h.id);
        if (!t || t.case !== 'guards' || t.origin !== g.origin || !r || !p || h.method !== 'GET' || h.url !== r.url
          || r.start.phase !== 'cancel' || h.response.status !== 200 || h.response.phase !== 'cancel'
          || !time(h.response.at) || h.response.at > u.heldAt || JSON.stringify(h.response) !== JSON.stringify(r.response)
          || aborted.length !== 1 || aborted[0].url !== h.url || aborted[0].method !== h.method
          || JSON.stringify(aborted[0].terminal) !== JSON.stringify(r.terminal) || r.terminal?.type !== 'failed'
          || r.terminal.failure !== 'net::ERR_ABORTED' || r.terminal.phase !== 'cancel'
          || !time(r.terminal.at) || r.terminal.at < u.cancelCommandAt || r.terminal.at > u.terminalsAt
          || r.response.sequence >= r.terminal.sequence || guardBrowserKeys.has(key)) boundGuard = false;
        guardBrowserKeys.add(key);
      }
    } catch { boundGuard = false; }
    need(boundGuard, 'bound-native-cancel-identities/order/restore');
    if (!boundGuard) { guardProxyIds.clear(); guardBrowserKeys.clear(); }
    need(Array.isArray(report.browserAudio) && report.browserAudio.length > 0 && report.browserAudio.length <= 16, 'browser-transport-container');
    for (const [i, t] of report.browserAudio.entries()) {
      const origin = t.case === 'guards' ? g.origin : report.cases.find(c => c.name === t.case)?.origin;
      const trace = t.trace;
      need(t.id === i + 1 && t.origin === origin && trace.schema === 'audio-transport-node-v1'
        && trace.overflow === false && trace.observerFailure === false && trace.requests.length <= 64 && trace.events.length <= 256,
        'browser-transport-identity/bounds');
      need(trace.events.every((e, i) => e.sequence === i + 1 && time(e.at) && (i === 0 || e.at >= trace.events[i - 1].at)
        && ['request', 'response', 'finished', 'failed', 'main-request'].includes(e.type)
        && (e.type === 'main-request' ? e.id === null && JSON.stringify(e) === JSON.stringify(trace.main)
          : trace.requests.some(r => r.id === e.id && [r.start, r.response, r.terminal].some(v => v && JSON.stringify(v) === JSON.stringify(e))))), 'browser-transport-events');
      need(trace.events.filter(e => e.type === 'main-request').length === (trace.main ? 1 : 0)
        && (t.case !== 'guards' || trace.main === null), 'actual-main-markers');
      for (const [j, r] of trace.requests.entries()) {
        const target = new URL(r.url), event = e => e && JSON.stringify(trace.events[e.sequence - 1]) === JSON.stringify(e);
        const path = target.pathname.slice(1), expectedPath = expectedIds.some(id => path === AUDIO_DIR + SOUNDS[id].file);
        need(r.id === j + 1 && r.method === 'GET' && target.origin + '/' === origin && expectedPath
          && (t.case === 'guards' ? r.start.phase === 'cancel' : ['prepare', 'playback'].includes(r.start.phase)) && event(r.start)
          && r.start.id === r.id && r.start.type === 'request' && event(r.terminal) && r.terminal.id === r.id
          && r.start.sequence < r.terminal.sequence && r.start.at <= r.terminal.at
          && (!r.response || (event(r.response) && r.response.id === r.id && r.response.type === 'response'
            && r.start.sequence < r.response.sequence && r.response.sequence < r.terminal.sequence)), 'browser-transport-occurrence');
        const guarded = guardBrowserKeys.has(t.id + ':' + r.id);
        const declaredUnavailable = t.case === 'unavailable' && ['prepare', 'playback'].includes(r.start.phase)
          && expectedPath && r.terminal.type === 'failed' && r.terminal.failure === 'net::ERR_FAILED'
          && (!r.response || r.response.status === 503);
        need(guarded || declaredUnavailable || (r.terminal.type === 'finished' && r.response?.status === 200), 'unexplained-browser-transport');
      }
    }
    need(report.requests.every((r, i) => r.id === i + 1 && ['healthy', 'unavailable', 'guards'].includes(r.case)
      && r.origin === (r.case === 'guards' ? g.origin : report.cases.find(c => c.name === r.case)?.origin)
      && time(r.at) && (r.finished !== true || (time(r.finishedAt) && r.finishedAt >= r.at))
      && typeof r.path === 'string' && r.path.length < 2048 && ['GET', 'HEAD'].includes(r.method)
      && (r.status === null || (positiveInt(r.status, 599) && r.status >= 100))), 'raw-request-shapes');
    need(report.requests.every(r => guardProxyIds.has(r.id) || (!r.failed && r.finished === true && (r.status === 200 || (r.case === 'unavailable' && r.phase === 'prepare'
      && r.status === 503 && expectedIds.some(id => r.path === AUDIO_DIR + SOUNDS[id].file))))), 'unexplained-request-failure');
    need(report.schema === 'battle-recordings-v1' && report.complete === true && report.sha === sha
      && /^[1-9][0-9]*$/.test(report.run) && report.attempt === '1' && report.failure === null, 'identity/completion');
    need(report.generation === manifest.generation && report.errors.length === 0 && report.overflow === false, 'source/errors/overflow');
    need(report.cases.length === 2 && report.cases[0].name === 'healthy' && report.cases[1].name === 'unavailable', 'two-distinct-cases');
    need(report.cases[0].origin !== report.cases[1].origin, 'distinct-owned-origins');
    for (const c of report.cases) {
      const healthy = c.name === 'healthy', prefix = c.name + ':';
      need(new URL(c.origin).origin === c.origin.slice(0, -1) && new URL(c.origin).hostname === '127.0.0.1', prefix + 'origin');
      need(c.metadata.schema === 1 && c.metadata.scope === c.origin && c.metadata.generation === manifest.generation
        && manifest.base.every(p => c.metadata.members.includes(p)), prefix + 'admission');
      const traces = report.browserAudio.filter(t => t.case === c.name);
      need(traces.filter(t => t.trace.main?.phase === 'prepare').length === 1
        && traces.filter(t => t.trace.main?.phase === 'restart').length === 1, prefix + 'one-actual-departure/full-restart');
      for (const phase of ['prepare', 'playback']) {
        const observed = traces.flatMap(t => t.trace.requests).filter(r => r.start.phase === phase);
        need(observed.length === 18 && expectedIds.every(id => observed.filter(r => r.url === c.origin + AUDIO_DIR + SOUNDS[id].file).length === 1),
          prefix + 'all-browser-recording-occurrences:' + phase);
      }
      need(c.initialRaw === exportSnapshot(initial), prefix + 'actual-fresh-initial-save');
      const levels = ['audio.master', 'audio.effects', 'audio.voices'];
      need(levels.every(key => positive(c.settings.before[key], 1) && c.settings.after[key] === c.settings.before[key])
        && c.settings.before['audio.mute'] === false && c.settings.after['audio.mute'] === false
        && typeof c.settings.before['audio.music'] === 'number' && Number.isFinite(c.settings.before['audio.music'])
        && c.settings.before['audio.music'] >= 0 && c.settings.before['audio.music'] <= 1 && c.settings.after['audio.music'] === 0
        && JSON.stringify(c.restartSettings) === JSON.stringify(c.settings.after), prefix + 'isolated-persisted-music-setting');
      const activation=c.initialActivation;
      need(activation?.url===c.origin+'?sw' && activation.scope===c.origin
        && activation.scriptURL===new URL('sw.js',c.origin).href && activation.state==='activated'
        && activation.entryMode==='title' && activation.entryReady===true && activation.controlled===false
        && positiveInt(activation.startedAt,Number.MAX_SAFE_INTEGER) && positiveInt(activation.observedAt,Number.MAX_SAFE_INTEGER)
        && activation.deadline===activation.startedAt+60000 && activation.observedAt>=activation.startedAt
        && activation.observedAt<activation.deadline && positiveInt(c.initialReloadAt,Number.MAX_SAFE_INTEGER)
        && c.initialReloadAt>=activation.observedAt, prefix+'initial-worker-before-reload');
      need(c.installBeforeGesture.observed === true && c.installBeforeGesture.calls === 0 && c.initialReloaded === true
        && c.controller === true && c.restartController === true && c.beforeGesture.observed === true
        && c.beforeGesture.requests === 0 && c.beforeGesture.audioContexts === 0, prefix + 'pre-gesture');
      need(c.beforeBegin.simTime === 0 && c.beforeBegin.paused === true && c.beforeBegin.briefing === true
        && c.beforeBegin.decoded === 0 && c.restartBeforeBegin.simTime === 0 && c.restartBeforeBegin.paused === true
        && c.restartBeforeBegin.briefing === true && c.restartBeforeBegin.decoded === 0, prefix + 'unbegun/restarted');
      need(positiveInt(c.requestCountAtClose, 4096) && c.requestCountAtClose === report.requests.filter(r => r.case === c.name).length
        && report.requests.filter(r => r.case === c.name).every(r => ['title', 'camp', 'prepare', 'briefing'].includes(r.phase)), prefix + 'raw-origin-closed-count');
      need(c.online.reachable === true && c.online.status === 200 && c.closed.reachable === false
        && c.closed.error === 'ECONNREFUSED' && c.listenerClosed === true && c.browserRestarted === true && c.noRequestsAfterClose === true
        && typeof c.resumedForPlayback === 'boolean', prefix + 'actual-offline');
      need(c.saves.before === exportSnapshot(decisionPrefix) && JSON.stringify(c.decisionSaves) === JSON.stringify(sourceDecisions), prefix + 'source-decision-saves');
      const before = parseSnapshot(c.saves.before), expected = exportSnapshot(reconcileLevelRewards(
        breakCamp(before, { campaign, fielded }), MAX_SAVE_BYTES));
      need(c.saves.departed === expected && c.saves.restart === expected && c.saves.played === expected, prefix + 'whole-save/one-charge');
      const requests = report.requests.filter(r => r.case === c.name && r.phase === 'prepare' && expectedIds.some(id => r.path === AUDIO_DIR + SOUNDS[id].file));
      need(requests.length === 18 && expectedIds.every(id => requests.filter(r => r.path === AUDIO_DIR + SOUNDS[id].file
        && r.method === 'GET' && r.range === null && r.status === (healthy ? 200 : 503) && r.finished === true).length === 1), prefix + 'actual-preparation-requests');
      need(c.decisionSaves.length === 2 && c.decisionSaves[1] === c.saves.before && c.departures === 1, prefix + 'decisions/departure');
      for (const key of ['coldCache', 'cache', 'restartCache']) {
        const rows = c[key]; need(rows.length === 18 && new Set(rows.map(r => r.id)).size === 18
          && expectedIds.every(id => rows.some(r => r.id === id)), prefix + key + ':coverage');
        for (const row of rows) {
          const source = manifest.files[AUDIO_DIR + SOUNDS[row.id].file], present = healthy && key !== 'coldCache';
          need(row.present === present, prefix + key + ':presence:' + row.id);
          if (present) need(row.status === 200 && row.type === 'basic' && row.contentRange === null
            && row.bytes === source.bytes && row.contentLength === String(source.bytes) && row.sha256 === source.sha256,
            prefix + key + ':body:' + row.id);
        }
      }
      need(c.playback.running === true && typeof c.playback.simTime === 'number' && Number.isFinite(c.playback.simTime) && c.playback.simTime >= 0 && c.playback.selectedUS === true, prefix + 'live-playback');
      if (healthy) {
        need(c.playback.decoded.length === 18 && new Set(c.playback.decoded.map(r => r.id)).size === 18
          && expectedIds.every(id => c.playback.decoded.some(r => r.id === id && r.native === true && positiveInt(r.length) && positiveInt(r.channels, 8) && positiveInt(r.sampleRate, 384000))), prefix + 'decoded');
        need(c.playback.volley.some(r => expectedIds.includes(r.id) && ['volley', 'shot'].includes(SOUNDS[r.id]?.role) && r.ok === true && r.bus === 'effects'), prefix + 'recorded-volley');
        need(c.playback.order.some(r => r.id === 'call-recall' && r.ok === true && r.bus === 'effects'), prefix + 'keyboard-call');
        need(c.playback.ambient.id === expectedIds[17] && c.playback.ambient.bus === 'ambient' && c.playback.ambient.loop === true
          && c.playback.ambient.live === true && c.playback.ambient.stopped === false, prefix + 'ambient-loop');
      } else {
        need(c.rejectedPaths.length === 18 && new Set(c.rejectedPaths).size === 18
          && expectedIds.every(id => c.rejectedPaths.includes(AUDIO_DIR + SOUNDS[id].file)), prefix + 'declared-503');
        need(c.playback.decoded.length === 0 && c.notice.visible === true && c.notice.status === true
          && c.notice.role === 'status' && c.notice.toastRole === 'status', prefix + 'limited-notice');
        const f = c.playback.fallback;
        need(f.owned === true && f.restored === true && f.failed === false && f.rows.length > 0 && f.rows.length <= 8
          && f.rows.every(r => r.delegated === true && r.threw === false && r.nativeSource === true && r.nativeBuffer === true
            && positiveInt(r.length) && positive(r.duration, 600) && positiveInt(r.channels, 8) && r.contextRunning === true), prefix + 'real-fallback');
      }
      need(c.cleanup.length === 3 && c.cleanup.every(r => r.ok === true), prefix + 'cleanup');
    }
    need(g.cancel.queued === true && g.cancel.currentCalls === 1 && g.cancel.puts === 0 && g.cancel.before === guardRaw && g.cancel.after === guardRaw
      && g.cancel.rejected === true && g.cancel.error === 'Progress: the reviewed exchange was cancelled.', 'native-queued-cancel');
    need(g.healthy.queued === true && g.healthy.currentCalls === 1 && g.healthy.puts === 1 && g.healthy.before === guardRaw && g.healthy.after === guardRaw && g.healthy.rejected === false && g.healthy.error === null, 'native-queued-healthy');
    need(g.ui.preparing === true && g.ui.cancelled === true && g.ui.rawBefore === guardRaw && g.ui.rawAfter === guardRaw
      && g.ui.gpu === 0 && g.ui.departures === 0 && g.ui.closed === true, 'native-ui-cancel');
    for (const row of report.console) {
      const c = report.cases.find(c => c.name === row.case);
      let allowed = false;
      if (c && typeof row.text === 'string' && row.text.length <= 16384 && typeof row.url === 'string' && row.url.length < 2048) {
        const target = new URL(row.url || c.origin, c.origin), audioTarget = target.origin === new URL(c.origin).origin
          && expectedIds.some(id => target.pathname === '/' + AUDIO_DIR + SOUNDS[id].file);
        if (c.name === 'unavailable' && ['prepare', 'playback'].includes(row.phase)) {
          allowed = row.type === 'error' && audioTarget && ['Failed to load resource: net::ERR_FAILED',
            'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'].includes(row.text);
          if (row.type === 'warning' && row.phase === 'playback') allowed = expectedIds.some(id => row.text === 'audio: ' + id + ' not loaded: Failed to fetch');
        }
        if (row.type === 'warning' && row.phase === 'restart' && c.closed.reachable === false && c.controller === true)
          allowed = row.text === "service worker not registered: Failed to register a ServiceWorker for scope ('" + c.origin
            + "') with script ('" + c.origin + "sw.js'): An unknown error occurred when fetching the script.";
      }
      need(allowed, 'unexplained-console');
    }
    need(report.cleanup.every(r => r.ok === true) && report.cleanup.length > 0, 'outer-cleanup');
  } catch { errors.push('malformed-report'); }
  return [...new Set(errors)].slice(0, 128);
}

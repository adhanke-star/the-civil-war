// Activation UI checks over the live aggregate that the intro, deployment and field-admission UI sections record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { progressRaw } from './test-progress-browser.mjs';
import { fictionalSurrenderRoute } from '../src/franchise/intro.js';

const copy = x => structuredClone(x);
export const ACTIVATION_UI_NAMES = Object.freeze(['activation-ui-intro', 'activation-ui-saved-review',
  'activation-ui-isolation', 'activation-ui-natural-intro', 'activation-ui-natural-saved',
  'activation-ui-readonly', 'activation-ui-stale', 'activation-ui-accessible']);

export async function installActivationObserver(page, label) {
  return page.evaluate(label => {
    if (Object.hasOwn(window, '__activationObserver')) throw new Error('Activation observer already owns this encounter');
    const { game: g, practice: p, manifest } = window.__game;
    const json = x => JSON.parse(JSON.stringify(x)), descriptor = Object.getOwnPropertyDescriptor(g, 'captureSnapshot'), original = g.captureSnapshot;
    const listeners = g.listeners.event, beforeListeners = [...listeners], scenario = g.scenario, definitions = [...scenario.units];
    const ready = { label, time: g.simTime, paused: g.paused, over: g.over, scenario: JSON.stringify(scenario), sourceUnits: json(scenario.units),
      ownFlag: Object.getOwnPropertyDescriptor(scenario, 'surrender')?.value ?? null,
      ownData: !!Object.getOwnPropertyDescriptor(scenario, 'surrender') && 'value' in Object.getOwnPropertyDescriptor(scenario, 'surrender'),
      sameManifestScenario: !manifest || manifest.scenario === scenario,
      manifest: manifest ? JSON.stringify(manifest) : null, baseline: manifest ? JSON.stringify(manifest.baseline) : null,
      sourceReferences: g.units.every(u => u.def === definitions.find(d => d.id === u.id)) };
    const state = () => ({ time: g.simTime, over: g.over, paused: g.paused, result: g.result ? json(g.result) : null,
      ids: g.units.map(u => u.id), units: g.units.map(u => ({ id: u.id, name: u.name, side: u.side, men: u.men, shots: u.shots || 0, state: u.state })),
      sourceReferences: g.scenario === scenario && g.units.every(u => u.def === definitions.find(d => d.id === u.id)),
      sourceJSON: JSON.stringify(scenario), outcome: p?.outcome ? JSON.stringify(p.outcome) : null,
      reportText: document.getElementById('result-text').textContent,
      cards: p?.reward ? JSON.stringify(p.reward.state.cards) : null, up: p?.reward ? [...p.reward.state.up] : null });
    const captures = [], terminalEvents = [], keys = [];
    g.captureSnapshot = function (...args) {
      const value = original.apply(this, args);
      captures.push({ receiverExact: this === g, argumentCount: args.length, sourceExact: g.scenario === scenario,
        time: g.simTime, terminal: g.over, nativeReturnForwarded: true, observation: json(value) });
      return value;
    };
    const onEvent = e => { if (e.kind === 'result') terminalEvents.push({ kind: e.kind, text: e.text, time: g.simTime, state: state(), captureCalls: captures.length }); };
    g.on('event', onEvent); // appended AFTER the real finishResult consumer
    const onKey = e => keys.push({ key: e.key, trusted: e.isTrusted, target: e.target.id || e.target.className, time: g.simTime,
      resultOpen: document.getElementById('result').open, rewardStep: document.querySelector('.rw')?.dataset.step ?? null });
    window.addEventListener('keydown', onKey, true);
    const refs = [g.rnd, g.combat.rnd, ...g.units.map(u => u.rnd)];
    window.__activationObserver = { g, original, descriptor, listeners, beforeListeners, onEvent, onKey, scenario, definitions, refs,
      ready, state, captures, terminalEvents, keys };
    return ready;
  }, label);
}

export async function readActivationObserver(page) {
  return page.evaluate(() => {
    const w = window.__activationObserver; if (!w) throw new Error('Activation observer missing before read');
    const now = w.state(), actualRefs = [w.g.rnd, w.g.combat.rnd, ...w.g.units.map(u => u.rnd)];
    return { ready: w.ready, terminalEvents: w.terminalEvents, captures: w.captures, captureCalls: w.captures.length,
      keys: w.keys, now, originalScenarioExact: w.g.scenario === w.scenario,
      rngReferencesExact: actualRefs.length === w.refs.length && actualRefs.every((x, i) => x === w.refs[i]),
      rngScope: 'Reference identity only; inherited accepted CPU zero-draw proof is separate' };
  });
}

export async function closeActivationObserver(page) {
  if (page.isClosed()) throw new Error('Activation observer must restore before page close');
  return page.evaluate(() => {
    const w = window.__activationObserver; if (!w) return { absent: true };
    let listenersExact = false, methodExact = false, ownDescriptorExact = false, listenerError = null, methodError = null;
    try {
      const before = [...w.listeners], index = before.indexOf(w.onEvent);
      if (index < 0 || before.filter(x => x === w.onEvent).length !== 1) throw new Error('Activation owned listener changed');
      w.listeners.splice(index, 1); // remove ONLY our callback, preserve all other refs/order
      listenersExact = w.g.listeners.event === w.listeners && w.listeners.length === w.beforeListeners.length && w.listeners.every((x, i) => x === w.beforeListeners[i]);
      if (!listenersExact) throw new Error('Activation event owner/order changed');
    } catch (e) { listenerError = e.message; }
    finally {
      try {
        if (w.descriptor) Object.defineProperty(w.g, 'captureSnapshot', w.descriptor); else delete w.g.captureSnapshot;
        const d = Object.getOwnPropertyDescriptor(w.g, 'captureSnapshot');
        ownDescriptorExact = w.descriptor ? Reflect.ownKeys(d).length === Reflect.ownKeys(w.descriptor).length && Reflect.ownKeys(d).every(k => d[k] === w.descriptor[k]) : d === undefined;
        methodExact = w.g.captureSnapshot === w.original;
      } catch (e) { methodError = e.message; }
      finally { window.removeEventListener('keydown', w.onKey, true); if (window.__activationObserver === w) delete window.__activationObserver; }
    }
    const globalAbsent = !Object.hasOwn(window, '__activationObserver');
    if (listenerError || methodError || !listenersExact || !ownDescriptorExact || !methodExact || !globalAbsent) {
      throw new Error('Activation cleanup failed after all restoration attempts: ' + [listenerError, methodError].filter(Boolean).join('; '));
    }
    return { restored: true, listenersExact, ownDescriptorExact, methodExact, globalAbsent,
      inheritedAbsenceRestored: w.descriptor ? null : Object.getOwnPropertyDescriptor(w.g, 'captureSnapshot') === undefined };
  });
}

export async function readAndCloseActivationObserver(page) {
  let record;
  try { record = await readActivationObserver(page); return record; }
  finally { const cleanup = await closeActivationObserver(page); if (record) record.cleanup = cleanup; }
}

export async function activationRouteRecord(page, query) {
  return page.evaluate(query => {
    const g = window.__game.game, d = Object.getOwnPropertyDescriptor(g.scenario, 'surrender');
    const snapshot = d?.value === true ? null : g.captureSnapshot(); // labelled inactive diagnostic only
    return { query, id: g.scenario.id, flag: d?.value ?? null, ownData: !d || 'value' in d,
      scenario: JSON.stringify(g.scenario), sourceUnits: g.scenario.units, time: g.simTime,
      originalDefinitions: g.units.every(u => u.def === g.scenario.units.find(d => d.id === u.id)),
      inactiveDiagnosticSnapshot: snapshot, diagnosticQueries: d?.value === true ? 0 : 1,
      activeQueryMade: false, diagnosticScope: 'Inactive snapshot only; not production query or private allocation count' };
  }, query);
}

export async function activationAccessible(page) {
  const before = await readActivationObserver(page), storedBefore = await progressRaw(page);
  const data = { auditViews: [], layout: [], images: [], keys: [], before, storedBefore };
  const stem = `activation-ui-saved-win-${Date.now()}`;
  async function view(root, name, width) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForFunction(() => document.getAnimations().filter(a => a.effect.getComputedTiming().iterations !== Infinity).every(a => a.playState === 'finished'), {}, { timeout: 3000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const topReach = await page.evaluate(root => {
      const owner = root === '#result' ? document.querySelector(root) : document.querySelector('.rw-aar'); owner.scrollTop = 0;
      const first = owner.firstElementChild.getBoundingClientRect(), r = owner.getBoundingClientRect();
      return first.y >= Math.max(0, r.y) && first.y < Math.min(innerHeight, r.bottom) && first.bottom > first.y;
    }, root);
    const target = root === '#result' ? page.locator('#result-close') : page.locator('.rw-primary');
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(async root => {
      const selector = root === '#result' ? '#result-close' : '.rw-primary'; let previous = null, stable = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(r => requestAnimationFrame(r)); const r = document.querySelector(selector).getBoundingClientRect(), value = JSON.stringify([r.x, r.y, r.width, r.height]);
        stable = value === previous ? stable + 1 : 0; previous = value; if (stable === 2) return;
      }
      throw new Error('Activation control geometry did not settle');
    }, root);
    const fit = await page.evaluate(root => {
      const owner = document.querySelector(root), button = root === '#result' ? document.getElementById('result-close') : document.querySelector('.rw-primary');
      const r = button.getBoundingClientRect(), or = owner.getBoundingClientRect();
      return { root, width: innerWidth, contained: owner.scrollWidth <= owner.clientWidth && or.x >= 0 && or.right <= innerWidth,
        scrollReach: r.y >= 0 && r.bottom <= innerHeight, targets: r.width >= 44 && r.height >= 44,
        focus: root === '#result' ? !!document.activeElement.closest('#result') : !!document.activeElement.closest('.rw'),
        button: r.toJSON(), owner: or.toJSON(), text: owner.textContent };
    }, root);
    data.layout.push({ ...fit, topReach });
    const audit = await new AxeBuilder({ page }).include(root).analyze();
    data.auditViews.push({ root, width, height: 740, violations: audit.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })) });
    const png = await page.locator(root).screenshot({ type: 'png' }); assert(png.length <= 512 * 1024);
    const path = `.out/${stem}-${name}.png`; fs.writeFileSync(path, png, { flag: 'wx' });
    data.images.push({ name, path, bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
  }
  await page.locator('#result-close').focus(); await page.keyboard.press('Tab');
  data.tabWrap = await page.evaluate(() => document.activeElement.id === 'result-action');
  await page.keyboard.press('Shift+Tab'); data.reverseWrap = await page.evaluate(() => document.activeElement.id === 'result-close');
  await view('#result', 'result-wide', 1000); await view('#result', 'result-narrow', 300);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('result').open && document.activeElement.id === 'after-action', {}, { timeout: 3000 });
  data.escapeFocus = await page.evaluate(() => document.activeElement.id === 'after-action');
  await page.getByRole('button', { name: 'After action', exact: true }).click();
  data.reentry = await readActivationObserver(page); data.storedAfterReentry = await progressRaw(page);
  await page.keyboard.press('Enter'); await page.waitForSelector('.rw[data-step="a"]');
  data.enterOpens = await page.evaluate(() => document.querySelector('main').inert && !!document.activeElement.closest('.rw'));
  await view('.rw', 'reward-wide', 1000); await view('.rw', 'reward-narrow', 300);
  data.rewardReportText = await page.locator('.rw-aar').textContent();
  await page.keyboard.press('Enter'); await page.waitForSelector('.rw[data-step="b"]');
  await page.setViewportSize({ width: 1024, height: 768 });
  return data; // Existing saved-win S event is reused downstream, never injected here.
}

function terminalValid(record) {
  if (!record || record.ready.ownFlag !== true || !record.ready.ownData || !record.ready.sourceReferences || record.captureCalls !== 1 || record.terminalEvents.length !== 1) return false;
  const e = record.terminalEvents[0], c = record.captures[0], o = c.observation;
  if (!e.state.over || !['US', 'CS'].includes(e.state.result?.winner) || e.time <= 0 || e.captureCalls !== 1 || e.state.time !== e.time
    || c.time !== e.time || !c.terminal || !c.receiverExact || c.argumentCount !== 0 || !c.sourceExact || !c.nativeReturnForwarded
    || !o || o.observedAtSec !== e.time || o.accounting.through !== e.time || !e.state.sourceReferences || e.state.sourceJSON !== record.ready.scenario) return false;
  const source = record.ready.sourceUnits;
  if (o.accounting.units.length !== source.length || !source.every(d => o.accounting.units.some(r => r.unitId === d.id && r.originSide === d.side && r.initialMen === d.men))) return false;
  for (const side of ['US', 'CS']) {
    const t = o.accounting.totals[side], opposite = side === 'US' ? 'CS' : 'US', label = side === 'US' ? 'Union' : 'Confederate';
    const prisoners = o.accounting.totals[opposite].capturedBy[side];
    const pieces = o.accounting.units.flatMap(r => r.guns), taken = pieces.filter(g => g.ownerSide === side && g.originSide !== side && g.arrived), lost = pieces.filter(g => g.originSide === side && g.ownerSide !== side);
    const disabled = taken.filter(g => g.condition === 'disabled').length;
    const expected = `${label}: ${t.killedWounded} killed or wounded; ${t.capturedMen} captured; ${prisoners} prisoners taken.`
      + (t.missingMen ? ` ${t.missingMen} missing.` : '') + (t.pendingMen ? ` ${t.pendingMen} still to arrive.` : '')
      + ` Guns: ${taken.length} taken, including ${disabled} disabled; ${lost.length} lost.`;
    if (!e.state.reportText.includes(expected)) return false;
  }
  return o.captures.every(c => e.state.reportText.includes(`${source.find(d => d.id === c.unitId)?.name}: ${c.men} captured by the ${c.captorSide === 'US' ? 'Union' : 'Confederate'} side.`));
}

export function verifyActivationUI(index, data) {
  const ok = value => assert.ok(value, ACTIVATION_UI_NAMES[index]);
  if (index === 0) ok(data.activated && data.record.ready.time === 0 && data.record.ready.paused && data.record.ready.ownFlag === true && data.record.ready.sourceReferences);
  else if (index === 1) ok(data.sameManifestScenario && data.records.length === 3 && data.records.every(r => r.ready.sameManifestScenario && r.ready.manifest
    && JSON.stringify(JSON.parse(r.ready.manifest).scenario) === r.ready.scenario && JSON.parse(r.ready.manifest).scenario.surrender === true && JSON.stringify(JSON.parse(r.ready.manifest).baseline) === r.ready.baseline));
  else if (index === 2) {
    ok(data.routes.map(r => r.query).join(',') === 'battle=henry-hill,intro,sandbox&battle=henry-hill&intro,tune&practice,practice,tune&intro');
    ok(data.routes.every(r => r.sourceExact && r.openingExact && r.gpu > 0 && typeof r.renderer === 'string' && r.originalDefinitions && r.ownData && (r.flag === true) === fictionalSurrenderRoute('?' + r.query)
      && !r.activeQueryMade && (r.flag === true ? r.diagnosticQueries === 0 : r.diagnosticQueries === 1 && r.inactiveDiagnosticSnapshot === null)));
  } else if (index === 3) ok(data.terminalEventObserved && terminalValid(data.record) && data.record.cleanup.restored);
  else if (index === 4) ok(data.sameSourceRoster && data.records.length === 2 && data.records.every(r => terminalValid(r) && r.cleanup.restored)
    && data.records[0].terminalEvents[0].state.result.winner === 'US' && data.records[1].terminalEvents[0].state.result.winner === 'CS');
  else if (index === 5) {
    ok(data.afterCalls === 1 && data.before.captureCalls === 1 && data.after.captureCalls === 1 && data.before.now.time === data.after.now.time
      && data.before.now.outcome === data.after.now.outcome && data.before.now.sourceJSON === data.after.now.sourceJSON
      && data.before.now.reportText === data.after.now.reportText && data.before.now.cards === data.after.now.cards
      && data.before.rngReferencesExact && data.after.rngReferencesExact && data.storedBefore === data.storedAfter);
  } else if (index === 6) ok(data.staleWrites === 0 && terminalValid(data.record) && data.record.cleanup.restored && data.pending && data.launchBaseline
    && data.savedAfterStale === data.otherTab && data.savedAfterRetry === data.otherTab && data.exportPending === data.pending
    && data.exportLaunch === data.launchBaseline && data.finalWrites === 1 && data.finalSaved === data.pending && data.waitingEscapeRetainedOwner);
  else if (index === 7) {
    ok(data.auditViews.length === 4 && data.auditViews.every(a => a.violations.length === 0)
      && data.auditViews.map(a => [a.root, a.width, a.height]).flat().join(',') === '#result,1000,740,#result,300,740,.rw,1000,740,.rw,300,740');
    ok(data.layout.length === 4 && data.layout.every(r => r.contained && r.scrollReach && r.targets && r.focus && r.topReach));
    ok(data.images.length === 4 && data.images.every(i => i.bytes > 0 && i.bytes <= 512 * 1024));
    ok(data.tabWrap && data.reverseWrap && data.escapeFocus && data.enterOpens && data.skipWorks && data.skipKeys.some(e => e.key.toLowerCase() === 's' && e.trusted));
    const text = data.before.terminalEvents[0].state.reportText;
    ok(text.includes('Union:') && data.rewardReportText.includes(text.slice(text.indexOf('Union:'))));
  } else throw new Error('Unknown activation UI category');
}

export function activationUIMutation(index, data) {
  const x = copy(data);
  if (index === 0) x.activated = false;
  if (index === 1) x.sameManifestScenario = false;
  if (index === 2) x.routes.find(r => r.query === 'tune&intro').flag = true;
  if (index === 3) x.terminalEventObserved = false;
  if (index === 4) x.sameSourceRoster = false;
  if (index === 5) x.afterCalls = 2;
  if (index === 6) x.staleWrites = 1;
  if (index === 7) x.auditViews[3].violations.push({ id: 'deliberate-activation-control' });
  return x;
}

// Each category needs records written by a different browser section (intro-ui, deployment-ui,
// field-admission-ui). When npm test is sharded only some of them exist in this process.
const ACTIVATION_UI_PRESENT = [a => !!a.intro, a => a.saved?.length > 0, a => a.routes?.length > 0, a => !!a.intro,
  a => a.saved?.length > 0, a => !!a.accessibility, a => !!a.stale, a => !!a.accessibility];
const ACTIVATION_UI_BUILD = [
  a => ({ activated: a.intro.ready.ownFlag === true, record: a.intro }),
  a => ({ sameManifestScenario: a.saved.every(r => r.ready.sameManifestScenario), records: a.saved }),
  a => ({ routes: a.routes }),
  a => ({ terminalEventObserved: a.intro.terminalEvents.length === 1, record: a.intro }),
  a => ({ sameSourceRoster: [a.saved[0], a.saved[1]].every(r => r.now.sourceReferences), records: [a.saved[0], a.saved[1]] }),
  a => ({ afterCalls: a.accessibility.reentry.captureCalls, before: a.accessibility.before, after: a.accessibility.reentry,
    storedBefore: a.accessibility.storedBefore, storedAfter: a.accessibility.storedAfterReentry }),
  a => ({ ...a.stale, record: a.saved[2] }),
  a => a.accessibility];

// One entry per category; null when the section that records it did not run in this process.
export function activationUIData(a) {
  return ACTIVATION_UI_BUILD.map((build, i) => ACTIVATION_UI_PRESENT[i](a) ? build(a) : null);
}

export function finalizeActivationUI({ result, check }) {
  const a = result.surrenderActivation;
  if (!a) return;
  a.categories = []; a.controls = [];
  ACTIVATION_UI_NAMES.forEach((name, i) => {
    if (!ACTIVATION_UI_PRESENT[i](a)) return;
    let value, failure = null;
    try { value = ACTIVATION_UI_BUILD[i](a); verifyActivationUI(i, value); }
    catch (e) { failure = e.message.split('\n')[0]; }
    if (!failure) {
      try { verifyActivationUI(i, activationUIMutation(i, value)); failure = 'mutation control escaped the reader'; }
      catch (e) {
        if (e.code === 'ERR_ASSERTION' && e.message.startsWith(name)) a.controls.push({ name, code: e.code, message: e.message });
        else failure = 'mutation control failed outside the reader: ' + e.message.split('\n')[0];
      }
    }
    check(name, !failure, failure || 'Actual existing live route and source-bound terminal observation');
    a.categories.push({ name, ok: !failure });
  });
  if (a.accessibility?.auditViews) a.axe = { result: a.accessibility.auditViews.slice(0, 2).flatMap(v => v.violations), reward: a.accessibility.auditViews.slice(2).flatMap(v => v.violations) };
  a.native = false;
}

const direct = process.argv[1] && fs.existsSync(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (direct) console.log('ACTIVATION UI: no standalone mode; npm test runs these checks through finalizeActivationUI.');

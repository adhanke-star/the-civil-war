// Observes the existing live aggregate. Standalone commands read that fresh actual dataset.
const EXPECTED_AGGREGATE_NAMES = ["activation-default-builder","activation-default-owner","activation-intro-definition","activation-invalid-option","activation-real-owner","activation-route-isolation","activation-route-positive","activation-saved-manifest","activation-ui-accessible","activation-ui-intro","activation-ui-isolation","activation-ui-natural-intro","activation-ui-natural-saved","activation-ui-readonly","activation-ui-saved-review","activation-ui-stale","approved-pack-contract","axe","baked-compare","baked-direction","baked-direction-per-clip","baked-draws","baked-height","baked-load","baked-maths","baked-rects","baked-standing-count-control","baked-variants","battery-overrun-model","camp-actual-comparison","camp-best-fit-eligibility","camp-blocked-read-retains","camp-byte-growth-refusal","camp-cancel-zero-write","camp-comparison-axe","camp-discard-reload","camp-escape-zero-write-focus","camp-full-labels","camp-import-roundtrip","camp-issue-focus-connected","camp-issue-one-exchange","camp-issued-limit-refusal","camp-keyboard-loop","camp-largest-inventory-bounded","camp-narrow-touch-targets","camp-no-console-errors","camp-no-field-assets","camp-no-recipient-refusal","camp-no-recipient-zero-write","camp-other-tab-real-write","camp-page-identity-preserved","camp-pending-export-while-queued","camp-preferences-preserved","camp-queued-close-owner","camp-quota-old-state-pending","camp-read-only-start","camp-recovery-axe","camp-recovery-two-exports","camp-reload-export-no-reissue","camp-retry-cancel-keeps-pending","camp-retry-one-record","camp-retry-original-review","camp-reverse-focus","camp-saving-owner-feedback","camp-stale-retry-no-rebase","camp-stale-review-refuses","camp-theme-clean-modern","camp-theme-hybrid","camp-theme-modal-clean-modern","camp-theme-modal-hybrid","camp-theme-modal-period-desk","camp-theme-period-desk","canvas-not-blank","capture-accounting-model","captured-guns-model","captured-loadouts-model","compression-controls","compression-dfd-controls","compression-diagnostic-contract","deployment-abort","deployment-all-scoped-axe","deployment-camp-read-only","deployment-camp-reload-bound","deployment-defeat-one-save","deployment-direct-review-cancel","deployment-distinct-exports","deployment-dormant-off-field","deployment-exact-one-save","deployment-fixed-new-loot","deployment-inspect-settlement","deployment-issued-profile","deployment-launch-cancel","deployment-launch-escape","deployment-launch-held","deployment-launch-repeat-guard","deployment-mixed-route-isolation","deployment-new-loot-dom-bound","deployment-no-console-errors","deployment-orders-capture","deployment-other-tab-launch-stale","deployment-other-tab-terminal-stale","deployment-queued-save-owner","deployment-quota","deployment-read-cancel","deployment-read-escape","deployment-read-held","deployment-real-camp-issue","deployment-real-range-ghost","deployment-real-roster-budget","deployment-refusal-blocked-read","deployment-refusal-corrupt","deployment-refusal-full-depot","deployment-refusal-headroom","deployment-refusal-missing","deployment-refusal-no-infantry","deployment-refusal-oversize","deployment-refusal-unsupported","deployment-repeat-no-award","deployment-request-failure","deployment-reveal-narrow-keyboard","deployment-review-all-active-dormant","deployment-review-cancel","deployment-review-escape","deployment-review-keyboard-loop","deployment-review-narrow","deployment-review-zero-field-write","deployment-saving-escape-no-navigation","deployment-stale-retry-no-rebase","deployment-terminal-freeze","deployment-themes-axe","deployment-unforced-defeat","deployment-unforced-victory","device-no-console-errors","device-page","direct-candidate-capability-controls","direct-candidate-completion-controls","direct-candidate-dds-metadata-controls","direct-candidate-ktx-controls","dock-axe","dock-fit","dock-keyboard-six-orders","dock-layout-1024","dock-layout-1440","dock-layout-320","dock-layout-375","dock-layout-760","dock-layout-landscape","dock-long-card-scroll","dock-map-expand","dock-map-pointer","dock-no-console-errors","dock-overlays-measured","dock-preserved-progress","dock-resize-restore","dock-sandbox-left","dock-sandbox-right","dock-touch-six-orders","entry-blocked-read-no-fresh","entry-camp-axe","entry-camp-narrow","entry-corrupt-import-recovery","entry-corrupt-read-no-fresh","entry-delayed-read-feedback","entry-depot-accessible-details","entry-depot-paging","entry-export-exact","entry-fresh-continue-intro","entry-fresh-no-write","entry-import-axe","entry-import-cancel-focus","entry-import-exact-consent","entry-import-replaces-once","entry-import-serialized-read","entry-import-single-write","entry-invalid-import","entry-legal-large-bound","entry-lightweight-camp","entry-lightweight-title","entry-no-console-errors","entry-pagination-repeat-key","entry-preferences-intact","entry-quota-retains-export","entry-quota-retry-confirms","entry-quota-retry-exact","entry-read-retry","entry-read-settlement-visible","entry-real-army-depot","entry-retry-consent-pending-file","entry-saved-continue-camp","entry-title-axe","entry-title-narrow","facing","field-admission-clean-console","field-admission-http-failure-before-gpu","field-admission-immutable-current-routes","field-admission-invalid-world-before-gpu","field-admission-model","field-admission-recovery-keyboard","field-admission-recovery-layout","field-admission-scoped-axe","field-admission-stale-after-terrain","field-admission-terrain-cancel-owner","fight","figures","header-after-action-native","header-axe","header-clock-strength","header-conditional-controls","header-height-consumers","header-layout-1024","header-layout-1440","header-layout-320","header-layout-375","header-layout-760","header-layout-landscape","header-native-army","header-native-menu","header-native-pause-speeds","header-native-stores","header-no-console-errors","header-preserved-progress","header-resize-restore","header-sandbox-left","header-sandbox-right","header-trusted-touch","hold-button","intro-actual-save","intro-briefing-axe","intro-briefing-narrow","intro-capture-loot-once","intro-contest-retake","intro-continue-focus","intro-continue-no-roll","intro-crate-labels-clear","intro-drag-command","intro-enlarged-marker-crates","intro-escape-focus","intro-first-card-timing","intro-fresh-entry","intro-idle-defeat","intro-keyboard-stores","intro-no-console-errors","intro-play-win","intro-real-capture","intro-real-fight","intro-stores-axe","intro-stores-close-focus","intro-stores-touch-target","intro-terminal-freeze","intro-touch-stores","keyboard-320-instructions-and-targets","keyboard-axe","keyboard-begin-no-order","keyboard-help-320-hit-areas","keyboard-help-320-tab-containment-scroll","keyboard-help-axe","keyboard-native-accessible-degrees","keyboard-native-accessible-destination","keyboard-native-attack-facing","keyboard-native-blur-cancellation","keyboard-native-close-preserves-new-focus","keyboard-native-escape-keeps-selection","keyboard-native-flag-selection","keyboard-native-group-ghost-commit","keyboard-native-help-close-activation","keyboard-native-help-focus-return","keyboard-native-manual-facing","keyboard-native-march-commit","keyboard-native-menu-button-focus-return","keyboard-native-minimum-distance","keyboard-native-moving-target-refresh","keyboard-native-pointer-cancellation","keyboard-native-ranged-order","keyboard-native-rotated-fine-steps","keyboard-native-sandbox-form-isolation","keyboard-native-shared-help","keyboard-native-shift-enter-group","keyboard-native-stale-close-preserves-reopened-menu","keyboard-native-stale-target-auto-cancel","keyboard-native-target-cycle","keyboard-progress-preserved","look-axe","look-copy","look-default-render-restored","look-defaults","look-lock","look-no-target-allocation","look-paste","look-progress-defaults-restored","look-reduced-motion","look-reload","look-saturation-rendered","look-smoke-clear-off","look-smoke-delayed-reenable","look-targets-look.saturation","look-targets-look.smoke","look-targets-look.tiltShift","look-tilt-rendered","men-per-figure","moments-active-reward-refused","moments-actual-warm-halo","moments-axe","moments-first-trigger-retained","moments-loot-axe","moments-loot-close-0","moments-loot-close-1","moments-loot-close-exact-cleanup-0","moments-loot-close-exact-cleanup-1","moments-loot-early-escape","moments-loot-early-exact-cleanup","moments-loot-isolated","moments-loot-modal-0","moments-loot-modal-1","moments-loot-narrow","moments-loot-narrow-close","moments-loot-narrow-first-focus","moments-loot-narrow-keyboard-visible","moments-loot-narrow-legendary-bind","moments-loot-narrow-readable","moments-loot-narrow-turn-focus","moments-paused-expiry","moments-practice-replay-preserved","moments-progress-before-reload","moments-real-mute","moments-state-resources","moments-style-lock","moments-style-reload","moments-style-reset","moments-style-transfer","moments-targets-narrow","moments-unmute-fresh","moments-unmute-no-replay","moments-xfactor-full","moments-xfactor-off","moments-xfactor-reduced","moments-xfactor-subtle","no-console-errors","order-attack-engages","order-hold-fire","order-move-arrives","order-move-fights-on-the-way","order-while-paused","phase-model","practice-after-action-fit-1024","practice-after-action-fit-320","practice-blocked-read-export","practice-cancelled-consent-retains-pending","practice-cancelled-read-held","practice-cancelled-read-no-mount","practice-cancelled-read-retains-pending","practice-conflict-retained","practice-continue-reload","practice-counts-current-gear-readable","practice-depleted-no-issue","practice-duplicate-completion","practice-historical-no-rewards","practice-loot-input","practice-no-console-errors","practice-queued-dismissal","practice-queued-export","practice-queued-result-owner","practice-quota-export","practice-recovered-read-confirm","practice-recovered-read-save","practice-replace-cancel-focus","practice-replace-confirm","practice-replay-isolated","practice-result-input","practice-result-reopen-freeze","practice-retry-same-award","practice-reward-real-army","practice-save-equipped","practice-terminal-survivors","practiceCountsAxe","practiceRecoveryAxe","practiceResultAxe","practiceWaitingAxe","ready","reinforcement-objective-reserve-on-appearance","reinforcement-objective-reserve-on-wrap","reinforcement-ui-arrival-keyboard-order","reinforcement-ui-density-and-restart","reinforcement-ui-future-spawn-once","reinforcement-ui-horizon-result-path","reinforcement-ui-narrow-readable-keyboard","reinforcement-ui-one-coincident-alert","reinforcement-ui-paused-no-replay","reinforcement-ui-trusted-resume-and-fly","reinforcement-ui-visible-advance-notice","reinforcement-ui-wide-readable-keyboard","reinforcement-ui-zero-before-first-field-step","reinforcement-ui-zero-idempotency","reinforcements-model","reinforcements-runtime","reward-callback-idempotent","reward-compare-axe","reward-delayed-read-feedback","reward-equip-save","reward-export","reward-export-reading-copy","reward-fresh-cancel-trigger","reward-import-axe","reward-import-cancel-focus","reward-import-replace","reward-invalid-import","reward-invalid-import","reward-invalid-import","reward-keyboard-compare","reward-launcher-axe","reward-no-console-errors","reward-preferences-preserved","reward-preview-keeps-conflict","reward-queued-export-waiting-copy","reward-queued-import-export","reward-queued-import-owner","reward-queued-replay-guard","reward-queued-save-owner","reward-quota-export","reward-quota-retains","reward-quota-retry","reward-read-failure-no-roll","reward-read-retry","reward-reload","reward-resume-axe","reward-resume-no-roll","reward-targets-1024","reward-targets-320","reward-unknown-baseline-no-write","reward-unknown-empty-retry","reward-unknown-empty-still-pending","reward-unknown-recovered-cancel","reward-unknown-recovered-confirm","sandbox-axe","sandbox-copy-paste","sandbox-fps","sandbox-hide","sandbox-late-define-compare","sandbox-live-chargeEffect","sandbox-live-fatigueGain","sandbox-lock","sandbox-lock-chargeEffect","sandbox-lock-fatigueGain","sandbox-new-rules-narrow","sandbox-new-units-narrow","sandbox-no-console-errors","sandbox-orderline-compare","sandbox-panel","sandbox-rule-reload","sandbox-rule-transfer-reset","sandbox-setting","sandbox-terminal-no-award","sandbox-tuning-preserves-progress-roster","sandbox-units-moments","sandbox-veterancy-both-sides","sandbox-veterancy-reset","save-db-async-request-failure","save-db-blocked-legacy-read","save-db-corrupt-legacy-read","save-db-corrupt-no-fallback","save-db-corrupt-repair","save-db-empty-read","save-db-existing-put-abort","save-db-failed-adoption","save-db-first-put-abort","save-db-legacy-read-duplicate","save-db-legacy-zero-writes","save-db-malformed-record","save-db-open-blocked-event","save-db-open-denied","save-db-open-retry","save-db-sealed-authority","save-db-unsealed-reread","save-db-upgrade-abort","save-db-upgrade-retry","save-no-console-errors","save-real-tabs-blocked","save-real-tabs-import-wins","save-real-tabs-one-winner","save-real-tabs-same-award","save-ui-baseline-recovery-consent","save-ui-baseline-recovery-write","save-ui-blocked-baseline-export","save-ui-consent-stale","save-ui-delayed-read-feedback","save-ui-export-reading-copy","save-ui-export-waiting-copy","save-ui-fresh-consent","save-ui-queued-export","save-ui-queued-overlap","save-ui-queued-owner","save-ui-retry-no-rebase","save-ui-waiting-axe","select-drag-order","settings","soldier-view-axe","soldier-view-blur-exit","soldier-view-depth","soldier-view-escape","soldier-view-figure-exit","soldier-view-focus-exit","soldier-view-ghost-preserved","soldier-view-map-restore","soldier-view-modal-isolation","soldier-view-moving-follow","soldier-view-native-held","soldier-view-native-release","soldier-view-no-console-errors","soldier-view-pointer-exit","soldier-view-refusal","soldier-view-repeat-guard","soldier-view-resize","soldier-view-resources","soldier-view-selection-exit","soldier-view-ui-isolation","spacing-axe","spacing-existing-ghost-reset","spacing-live-0.75","spacing-live-1","spacing-live-1.5","spacing-lock","spacing-new-placement","spacing-no-texture-target-allocation","spacing-progress-before-reload","spacing-progress-intact","spacing-real-group-preview-order","spacing-real-group-selection","spacing-reload","spacing-targets-narrow","spacing-transfer","surrender-result","surrender-runtime","surrender-ui-accessibility","surrender-ui-casualties","surrender-ui-fractions","surrender-ui-guns","surrender-ui-inactive","surrender-ui-labels","surrender-ui-pending","surrender-ui-reentry","surrender-ui-refusal","surrender-ui-saved","surrender-ui-sides","surrender-ui-terminal","touch-drag-order","touch-tap-select","view-axe","view-camera-fly-minimap","view-camera-live","view-camera-low","view-camera-touch-pinch","view-camera-zoom-anchor","view-high-markers-clear-dock","view-lock","view-marker-0.75","view-marker-1","view-marker-1.75","view-marker-drag","view-marker-keyboard","view-marker-new-unit","view-marker-touch","view-no-render-allocation","view-reload","view-reset-progress","view-targets-look.cameraElevation","view-targets-look.markerScale","view-top-markers-accessible","view-transfer","zoom-to-pointer"];
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { progressRaw } from './test-progress-browser.mjs';
import { fictionalSurrenderRoute } from '../src/franchise/intro.js';

const hash = b => createHash('sha256').update(b).digest('hex'), copy = x => structuredClone(x);
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
    data.images.push({ name, path, bytes: png.length, sha256: hash(png), width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
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
    ok(data.images.length === 4 && data.images.every(i => i.bytes > 0 && i.bytes <= 512 * 1024 && /^[a-f0-9]{64}$/.test(i.sha256)));
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

export function activationUIData(a) {
  const win = a.saved[0], defeat = a.saved[1], stale = a.saved[2], access = a.accessibility;
  return [{ activated: a.intro.ready.ownFlag === true, record: a.intro }, { sameManifestScenario: a.saved.every(r => r.ready.sameManifestScenario), records: a.saved },
    { routes: a.routes }, { terminalEventObserved: a.intro.terminalEvents.length === 1, record: a.intro },
    { sameSourceRoster: [win, defeat].every(r => r.now.sourceReferences), records: [win, defeat] },
    { afterCalls: access.reentry.captureCalls, before: access.before, after: access.reentry, storedBefore: access.storedBefore, storedAfter: access.storedAfterReentry },
    { ...a.stale, record: stale }, access];
}

export function finalizeActivationUI({ result, check }) {
  const a = result.surrenderActivation, access = a.accessibility, data = activationUIData(a);
  a.categories = data.map((value, i) => { verifyActivationUI(i, value); check(ACTIVATION_UI_NAMES[i], true, 'Actual existing live route and source-bound terminal observation'); return { name: ACTIVATION_UI_NAMES[i], dataSha256: hash(JSON.stringify(value)) }; });
  a.controls = data.map((value, i) => { try { verifyActivationUI(i, activationUIMutation(i, value)); throw new Error('Activation UI mutation escaped'); }
    catch (e) { assert.equal(e.code, 'ERR_ASSERTION'); assert.ok(e.message.startsWith(ACTIVATION_UI_NAMES[i])); return { name: ACTIVATION_UI_NAMES[i], code: e.code, message: e.message }; } });
  a.sources = result.surrenderActivationPure.sources;
  a.axe = { result: access.auditViews.slice(0, 2).flatMap(a => a.violations), reward: access.auditViews.slice(2).flatMap(a => a.violations) };
  a.native = false;
}

const direct = process.argv[1] && fs.existsSync(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (direct) {
  const p = '.out/last-result.json', bytes = fs.readFileSync(p); assert(bytes.length <= 48 * 1024 * 1024);
  const full = JSON.parse(bytes), a = full.surrenderActivation, sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(full.ok, true); assert.equal(full.checks.length, 568); assert(full.checks.every(c => c.ok)); assert.equal(new Set(full.checks.map(c => c.name)).size, 566);
  assert.deepEqual(full.checks.map(c => c.name).sort(), EXPECTED_AGGREGATE_NAMES);
  const data = activationUIData(a);
  assert.deepEqual(a.categories.map(c => c.name), ACTIVATION_UI_NAMES);
  assert.deepEqual(a.categories.map(c => Object.keys(c).sort()), ACTIVATION_UI_NAMES.map(() => ['dataSha256', 'name']));
  assert.deepEqual(a.categories.map(c => c.dataSha256), data.map(value => hash(JSON.stringify(value))));
  assert.equal(a.categories.length, 8); assert.equal(a.controls.length, 8); assert.equal(a.sources.length, 65);
  for (const s of a.sources) { const live = fs.readFileSync(s.path), git = execFileSync('git', ['show', sha + ':' + s.path]); assert.equal(live.length, s.bytes); assert.equal(hash(live), s.sha256); assert.deepEqual(live, git); }
  for (const i of a.accessibility.images) { assert(/^\.out\/activation-ui-saved-win-\d+-(result|reward)-(wide|narrow)\.png$/.test(i.path)); assert(!fs.lstatSync(i.path).isSymbolicLink()); assert(fs.realpathSync(i.path).startsWith(fs.realpathSync('.out') + '/')); const b = fs.readFileSync(i.path); assert.equal(b.length, i.bytes); assert.equal(hash(b), i.sha256); assert.equal(b.readUInt32BE(16), i.width); assert.equal(b.readUInt32BE(20), i.height); }
  a.categories.forEach((c, i) => { assert.equal(c.name, ACTIVATION_UI_NAMES[i]); verifyActivationUI(i, data[i]); });
  const controls = data.map((value, i) => { try { verifyActivationUI(i, activationUIMutation(i, value)); throw new Error('UI mutation escaped'); }
    catch (e) { assert.equal(e.code, 'ERR_ASSERTION'); assert.ok(e.message.startsWith(ACTIVATION_UI_NAMES[i])); return { name: ACTIVATION_UI_NAMES[i], code: e.code, message: e.message }; } });
  assert.deepEqual(controls, a.controls);
  const out = { sha, raw: { path: p, bytes: bytes.length, sha256: hash(bytes) }, categories: a.categories.map(c => c.name), sourceBindings: a.sources,
    images: a.accessibility.images, scope: 'Reader of this fresh single live aggregate; not an independent replay', controls: process.argv.includes('--prove-fail') ? controls : undefined };
  const text = 'ACTIVATION UI ACTUAL ' + JSON.stringify(out); assert(Buffer.byteLength(text) <= 64 * 1024); console.log(text); console.log('ACTIVATION UI OK (8/8)');
  if (process.argv.includes('--prove-fail')) { for (const c of controls) console.log('CAUGHT ' + c.name + ' ' + c.code + ' ' + c.message);
    console.log('ACTIVATION UI CONTROLS ' + JSON.stringify(controls)); console.log('ACTIVATION UI MUTANTS CAUGHT (8/8; live aggregate readers)'); }
}

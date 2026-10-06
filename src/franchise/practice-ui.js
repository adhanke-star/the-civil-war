// Same-page result -> reward -> single completed-progress store. The battlefield is inert during loot.
import { createProgressStore, completedSnapshot, exportSnapshot } from './save.js';
import { practiceOutcome } from './practice.js';
import { mountReward, configureRewardReplay } from '../reward/sequence.js';

export function attachPracticeFlow({ game, scenario, hud, mode }) {
  const store = createProgressStore();
  const field = document.querySelector('main');
  const dialog = document.getElementById('result');
  const title = document.getElementById('result-title');
  const text = document.getElementById('result-text');
  const action = document.getElementById('result-action');
  const back = document.getElementById('result-close');
  const exportButton = document.getElementById('result-export');
  const unsavedButton = document.getElementById('result-unsaved');
  const after = document.getElementById('after-action');
  let captured = false, outcome = null, pending = null, saved = null, previous = null, failure = null, reward = null, baselineKnown = false;

  configureRewardReplay(() => hud.toast('Open the separate reward demo from the menu. Practice rewards use the completed battlefield.'));
  dialog.addEventListener('close', () => after.focus({ preventScroll: true }));
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button, a[href]')].filter((n) => !n.hidden && !n.disabled);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
  after.addEventListener('click', openResult);
  exportButton.addEventListener('click', () => download(pending || previous));
  unsavedButton.addEventListener('click', () => startLoot(false));

  function download(snapshot) {
    if (!snapshot) return;
    const blob = new Blob([exportSnapshot(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'civil-war-army.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function panel(heading, message, label, run, { cancel = 'Inspect the field', exportable = false, focusCancel = false } = {}) {
    game.paused = true; hud.setPaused(true);
    field.inert = false;
    title.textContent = heading; text.textContent = message;
    action.textContent = label || ''; action.hidden = !label; action.onclick = run || null;
    back.textContent = cancel; exportButton.hidden = !exportable;
    unsavedButton.hidden = true;
    const menu = document.getElementById('menu');
    if (menu.open) menu.close();
    if (!dialog.open) dialog.showModal();
    (focusCancel || !label ? back : action).focus({ preventScroll: true });
  }
  function showSaved() {
    panel('Army saved', `${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} surviving men and ${saved.depot.length} depot cards are saved. Continue opens your saved army. Fresh practice starts with its original troops and gear.`,
      'Continue', () => location.assign('./reward.html'));
  }
  function recover() {
    panel(pending ? 'Army not saved' : 'Progress unavailable', failure,
      pending && baselineKnown ? 'Retry saving' : 'Retry loading', pending ? (baselineKnown ? savePending : reviewForSave) : openLoot, { exportable: !!pending });
    unsavedButton.hidden = !!pending || baselineKnown;
  }
  function reviewForSave() {
    try { previous = store.load(); }
    catch (err) { failure = err.message; recover(); return; }
    if (previous) {
      panel('Replace saved army?', 'Your unsaved practice result will replace this saved army. Export the practice result before cancelling if you want to keep both.',
        'Replace and save', () => { baselineKnown = true; savePending(); }, { cancel: 'Cancel', exportable: true, focusCancel: true });
    } else { baselineKnown = true; savePending(); }
  }
  function savePending() {
    if (!baselineKnown) {
      failure = 'Storage was unavailable when loot started. Export this army, or retry loading to review saved progress before replacing it.';
      recover(); return;
    }
    try {
      const receipt = store.complete(pending, { previous });
      saved = receipt.snapshot; failure = null; showSaved();
    } catch (err) { failure = err.message; recover(); }
  }
  function startLoot(authorized = true) {
    game.paused = true; hud.setPaused(true); baselineKnown = authorized;
    dialog.close(); field.inert = true; failure = null;
    reward = mountReward(document.body, { army: outcome.army, depot: outcome.depot, awardId: outcome.awardId,
      seed: outcome.seed, grade: outcome.grade, captures: outcome.captures, afterAction: outcome.summary,
      onDone: (result) => { pending = completedSnapshot(result); savePending(); } });
  }
  function openLoot() {
    if (!outcome) return;
    try { previous = store.load(); }
    catch (err) { baselineKnown = false; failure = err.message; recover(); return; }
    if (previous?.awardId === outcome.awardId) { saved = previous; showSaved(); return; }
    if (previous) {
      panel('Replace saved army?', 'This practice reward replaces your completed saved army. Export that army before continuing if you want to keep it.',
        'Replace and open loot', () => startLoot(true), { cancel: 'Cancel', exportable: true, focusCancel: true });
    } else startLoot(true);
  }
  function openResult() {
    if (saved) { showSaved(); return; }
    if (failure) { recover(); return; }
    const message = outcome
      ? `${game.result.why} ${outcome.summary.surviving.toLocaleString()} surviving men; ${outcome.summary.losses.toLocaleString()} lost. Open the practice quartermaster issue. No field crates are awarded.`
      : `${game.result.why} ${mode === 'historical' ? 'Historical battles grant no franchise rewards.' : 'Sandbox or altered battles grant no progress rewards.'}`;
    panel(game.result.winner === 'US' ? 'Union victory' : 'Confederate victory', message, outcome ? 'Open the loot' : null, openLoot);
  }
  function finishResult() {
    if (captured) return;
    captured = true;
    game.paused = true; hud.setPaused(true); after.hidden = false;
    if (mode === 'practice') {
      const awardId = `practice-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
      try { outcome = practiceOutcome({ game, scenario, mode, awardId, seed: awardId }); }
      catch (err) { hud.toast(err.message); }
    }
    openResult();
  }
  return { finishResult, openResult, get outcome() { return outcome; }, get pending() { return pending; },
    get saved() { return saved; }, get reward() { return reward; } };
}

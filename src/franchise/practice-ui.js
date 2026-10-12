// Same-page result -> reward -> single completed-progress store. The battlefield is inert during loot.
import { createProgressStore, completedSnapshot, exportSnapshot } from './save.js';
import { practiceOutcome, savedOutcome, assertSavedLaunch, surrenderOutcome } from './practice.js';
import { mountReward, configureRewardReplay, surrenderReportText } from '../reward/sequence.js';
import { phaseResult, recordPhase } from './campaign.js';
import { rewardArmy, applyRewardIssues } from '../ui/briefing.js';
import { phaseSummary } from './economy.js';

const GRADE_TEXT = { decisive: 'Decisive victory', victory: 'Victory', draw: 'Draw', defeat: 'Defeat' };
// The recorded phase's requisition points (economy.js phaseSummary) for the result wording and the after-action; never throws.
function pointsOf(campaign, phase) {
  try { return phase ? phaseSummary(campaign.save, phase.next) : null; } catch { return null; }
}
const pointsWords = (p) => !p ? '' : ` Requisition points: +${p.points}${p.levelUp ? `; reputation level ${p.levelUp.to} reached` : ''} (game rule).`;

// campaign: main.js's launch { slot, store, save, raw, phase } for a ?campaign=<slot> phase; the result records the
// phase (losses, loot, history) into that slot through the same pending/save/recover panels.
export function attachPracticeFlow({ game, scenario, hud, mode, manifest = null, campaign = null }) {
  if (manifest) assertSavedLaunch(manifest);
  if (campaign && (manifest || mode !== 'campaign')) throw new Error('Campaign: a campaign phase needs its own field route.');
  const store = campaign ? campaign.store : createProgressStore();
  const field = document.querySelector('main');
  const dialog = document.getElementById('result');
  const title = document.getElementById('result-title');
  const text = document.getElementById('result-text');
  const action = document.getElementById('result-action');
  const back = document.getElementById('result-close');
  const exportButton = document.getElementById('result-export');
  const launchExport = document.createElement('button'); launchExport.type = 'button'; launchExport.id = 'result-export-launch';
  launchExport.textContent = 'Export army at launch'; launchExport.hidden = true; exportButton.after(launchExport);
  const unsavedButton = document.getElementById('result-unsaved');
  const replayButton = document.createElement('button'); replayButton.type = 'button'; replayButton.id = 'result-replay';
  replayButton.textContent = 'Replay this phase'; replayButton.hidden = true;
  if (campaign) action.after(replayButton); // campaign routes only: other result dialogs keep their exact actions
  const campHref = campaign ? `./?camp=${campaign.slot}` : './?camp';
  let phase = null, phaseFailure = null, issueNote = '';
  const after = document.getElementById('after-action');
  let captured = false, outcome = null, pending = null, saved = null, previous = null, failure = null, reward = null, baselineKnown = false;
  let saving = false, reviewing = false, rewardActive = false;
  let reading = false, readCancelled = false;
  let surrenderResult = null, surrenderUnavailable = false;
  if (manifest) { previous = manifest.baseline; baselineKnown = true; }
  if (campaign) { previous = campaign.save; baselineKnown = true; }
  replayButton.addEventListener('click', () => location.assign(`./?campaign=${campaign.slot}&replay`));

  configureRewardReplay(() => hud.toast('Open the separate reward demo from the menu. Practice rewards use the completed battlefield.'));
  dialog.addEventListener('close', () => {
    if (!dialog.open && !rewardActive) {
      if (!saving) reviewing = false;
      sync(); after.focus({ preventScroll: true });
    }
  });
  dialog.addEventListener('cancel', () => { if (reading) readCancelled = true; });
  back.addEventListener('click', () => { if (reading) readCancelled = true; });
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button, a[href]')].filter((n) => !n.hidden && !n.disabled);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
  after.addEventListener('click', openResult);
  exportButton.addEventListener('click', () => download(pending || outcome?.snapshot || previous));
  launchExport.addEventListener('click', () => download(manifest?.baseline));
  unsavedButton.addEventListener('click', () => startLoot(false));

  function sync() {
    dialog.setAttribute('aria-busy', String(saving || reading));
    after.disabled = reviewing || rewardActive;
    action.disabled = saving || reading; back.disabled = false; unsavedButton.disabled = saving || reading;
  }

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
    replayButton.hidden = true;
    back.textContent = cancel; exportButton.hidden = !exportable;
    exportButton.textContent = manifest || campaign ? (saved ? 'Export result army' : 'Export pending army') : 'Export army';
    launchExport.hidden = !manifest || !exportable;
    unsavedButton.hidden = true;
    const menu = document.getElementById('menu');
    if (menu.open) menu.close();
    if (!dialog.open) dialog.showModal();
    sync();
    if (saving || reading) { title.tabIndex = -1; title.focus(); }
    else (focusCancel || !label ? back : action).focus({ preventScroll: true });
  }
  function showSaved() {
    if (campaign) {
      const done = saved.campaign.status === 'complete', defeat = phase.record.grade === 'Defeat';
      panel('Campaign saved', `${scenario.title}: ${phase.record.grade}${campaign.phase.replay ? ' (replay, marked on your record)' : ''}. ${saved.depot.length} cards are in your depot${saved.rp === undefined ? '' : ` and ${saved.rp.toLocaleString()} requisition points to spend in camp`}.${issueNote} ${done ? 'The campaign is complete; your camp shows the record.' : 'Return to camp for the next phase.'}${defeat ? ' You may replay this phase; the replay is marked on your record.' : ''}`,
        'Return to camp', () => location.assign(campHref), { exportable: true });
      replayButton.hidden = !defeat;
      return;
    }
    panel('Army saved', `${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} surviving men and ${saved.depot.length} depot cards are saved. Continue opens your saved army in camp.${manifest ? ' Compare and issue new gear there.' : ' Fresh practice starts with its original troops and gear.'}`,
      'Continue', () => location.assign('./?camp'), { exportable: !!manifest });
  }
  function recover() {
    panel(pending ? (campaign ? 'Campaign not saved' : 'Army not saved') : 'Progress unavailable', failure || 'Your completed army is waiting to be saved. Retry loading to review saved progress, or export this army.',
      pending && baselineKnown ? 'Retry saving' : 'Retry loading', pending ? (baselineKnown ? savePending : reviewForSave) : openLoot, { exportable: !!pending });
    unsavedButton.hidden = !!pending || baselineKnown;
  }
  async function readForReview() {
    reading = true; readCancelled = false;
    panel('Loading saved progress', 'Keep this page open while saved progress is read. Inspecting the field cancels this review.', null, null, { exportable: !!pending });
    let baseline;
    try { baseline = await store.load(); }
    catch (err) { failure = err.message; }
    finally { reading = false; sync(); }
    if (readCancelled || !dialog.open) { if (dialog.open) openResult(); return false; }
    if (failure) { recover(); return false; }
    previous = baseline; return true;
  }
  async function reviewForSave() {
    if (manifest) { savePending(); return; }
    if (saving || reading || reviewing || rewardActive) return;
    failure = null;
    if (!await readForReview()) return;
    if (previous) {
      reviewing = true;
      panel('Replace saved army?', 'Your unsaved practice result will replace this saved army. Export the practice result before cancelling if you want to keep both.',
        'Replace and save', () => { reviewing = false; baselineKnown = true; savePending(); }, { cancel: 'Cancel', exportable: true, focusCancel: true });
    } else { baselineKnown = true; savePending(); }
  }
  async function savePending() {
    if (saving || reading || rewardActive || !pending) return;
    if (!baselineKnown) {
      failure = 'Storage was unavailable when loot started. Export this army, or retry loading to review saved progress before replacing it.';
      recover(); return;
    }
    const result = pending, baseline = previous;
    saving = true; reviewing = false;
    panel('Saving army', 'Keep this page open while your completed army is saved. You can export this army while saving waits.', null, null, { exportable: true });
    try {
      const receipt = await store.complete(result, { previous: baseline });
      saved = receipt.snapshot; failure = null;
    } catch (err) { failure = err.message; }
    finally { saving = false; sync(); }
    // Inspect/Escape can dismiss the waiting panel without cancelling or rebasing the write.
    if (dialog.open) { if (failure) recover(); else showSaved(); }
    else hud.toast(failure ? 'Army not saved. Open After action to retry or export.' : 'Army saved. Open After action to continue.');
  }
  function startCampaignLoot() {
    if (saving || reading || rewardActive || !phase || pending || saved) return;
    rewardActive = true; sync();
    game.paused = true; hud.setPaused(true);
    dialog.close(); field.inert = true; failure = null;
    const us = phase.outcome.units.filter((u) => u.side === 'US');
    const starting = us.reduce((n, u) => n + u.menStart, 0), surviving = us.reduce((n, u) => n + u.men, 0);
    try {
      reward = mountReward(document.body, { army: rewardArmy(phase.next.army), depot: [], awardId: campaign.phase.awardId,
        seed: campaign.phase.seed, grade: phase.record.grade, captures: phase.outcome.captures, rememberReplay: false,
        afterAction: { title: scenario.title, why: game.result.why, starting, surviving, losses: starting - surviving,
          guns: us.reduce((n, u) => n + (u.guns || 0), 0), eyebrow: `Campaign · ${scenario.title}${campaign.phase.replay ? ' · replay' : ''}`,
          note: campaign.phase.loan ? "Grant's army was on loan: these numbers are its own and your franchise brigades are unchanged. Loot joins your depot."
            : 'Losses carry to your brigades. Loot joins your depot; issue it here or in camp. Ratings and loot are game values.',
          points: pointsOf(campaign, phase) },
        onDone: (result) => {
          if (saving || !rewardActive || saved || pending) return;
          rewardActive = false;
          const applied = applyRewardIssues(phase.next, phase.record.loot, result);
          issueNote = applied.issued ? '' : ' Issues made in the loot screen were not kept; the new cards wait in your depot.';
          pending = applied.save; baselineKnown = true; previous = campaign.save;
          savePending();
        } });
    } catch (err) {
      // The recorded phase never depends on the loot screen: save it with the new cards in the depot.
      rewardActive = false; issueNote = ` The loot screen could not open (${err.message}); the new cards wait in your depot.`;
      pending = phase.next; baselineKnown = true; previous = campaign.save;
      savePending();
    }
  }
  function startLoot(authorized = true) {
    if (campaign) { startCampaignLoot(); return; }
    if (saving || reading || rewardActive || !outcome) return;
    reviewing = false; rewardActive = true; sync();
    game.paused = true; hud.setPaused(true); baselineKnown = authorized;
    dialog.close(); field.inert = true; failure = null;
    if (manifest) {
      reward = mountReward(document.body, { preparedOutcome: outcome, rememberReplay: false,
        afterAction: { ...outcome.summary, why: savedResultWhy(), ...(surrenderResult ? { surrenderResult } : {}) },
        onDone: () => {
          if (saving || !rewardActive || saved) return;
          rewardActive = false; pending = outcome.snapshot; baselineKnown = true; previous = manifest.baseline;
          savePending();
        } });
      return;
    }
    reward = mountReward(document.body, { army: outcome.army, depot: outcome.depot, awardId: outcome.awardId,
      seed: outcome.seed, grade: outcome.grade, captures: outcome.captures,
      afterAction: surrenderResult ? { ...outcome.summary, surrenderResult } : outcome.summary,
      onDone: (result) => {
        if (saving) return;
        rewardActive = false;
        try { pending = completedSnapshot(result); savePending(); }
        catch (err) { failure = err.message; recover(); }
      } });
  }
  async function openLoot() {
    if (campaign) { if (pending) recover(); else startCampaignLoot(); return; }
    if (saving || reading || reviewing || rewardActive) return;
    if (!outcome) return;
    if (pending) { recover(); return; }
    if (manifest) { startLoot(true); return; }
    failure = null; baselineKnown = false;
    if (!await readForReview()) return;
    if (previous?.awardId === outcome.awardId) { saved = previous; showSaved(); return; }
    if (previous) {
      reviewing = true;
      panel('Replace saved army?', 'This practice reward replaces your completed saved army. Export that army before continuing if you want to keep it.',
        'Replace and open loot', () => startLoot(true), { cancel: 'Cancel', exportable: true, focusCancel: true });
    } else startLoot(true);
  }
  function savedResultWhy() {
    return game.result.winner === 'US' ? 'Your saved formations won the practice encounter. Actual survivors and new loot return to camp.'
      : 'Your saved formations lost the practice ground. Actual survivors and any stores still held return to camp.';
  }
  function openResult() {
    if (reviewing || rewardActive) return;
    if (surrenderUnavailable) {
      panel('Result unavailable', `The encounter report could not be verified. ${campaign ? 'This phase was not recorded; your campaign save is unchanged.' : 'Inspect the field before continuing.'}`,
        campaign ? 'Return to camp' : null, campaign ? () => location.assign(campHref) : null);
      return;
    }
    if (reading) {
      panel('Loading saved progress', 'The saved-progress read is still in progress. Inspecting the field cancels this review.', null, null, { exportable: !!pending });
      return;
    }
    if (saving) {
      panel('Saving army', 'Keep this page open while your completed army is saved. You can export this army while saving waits.', null, null, { exportable: true });
      return;
    }
    if (saved) { showSaved(); return; }
    if (failure || pending) { recover(); return; }
    if (campaign) { openCampaignResult(); return; }
    const grade = GRADE_TEXT[game.result.grade] || '';
    const message = outcome
      ? `${manifest ? savedResultWhy() : game.result.why} ${outcome.summary.surviving.toLocaleString()} surviving men; ${outcome.summary.losses.toLocaleString()} lost. ${outcome.captures.length} held field crates. ${manifest ? 'Open only the new loot, save these survivors, then return to camp.' : 'Open the practice quartermaster issue.'}`
      : `${game.result.why}${grade ? ` Result: ${grade}.` : ''} ${mode === 'historical' ? 'Historical battles grant no franchise rewards.' : 'Sandbox or altered battles grant no progress rewards.'}`;
    const report = surrenderReportText(surrenderResult);
    // Battle-pack results may be a draw (winner null) and carry the player's grade.
    const heading = game.result.winner === 'US' ? 'Union victory' : game.result.winner === 'CS' ? 'Confederate victory' : 'Drawn battle';
    panel(heading, report ? `${message} ${report}` : message, outcome ? 'Open the loot' : null, openLoot, { exportable: !!manifest && !!outcome });
  }
  function openCampaignResult() {
    const heading = game.result.winner === 'US' ? 'Union victory' : game.result.winner === 'CS' ? 'Confederate victory' : 'Drawn battle';
    if (!phase) {
      panel(heading, `${game.result.why} This phase result could not be recorded: ${phaseFailure} Your campaign save is unchanged.`,
        'Return to camp', () => location.assign(campHref));
      return;
    }
    const us = phase.outcome.units.filter((u) => u.side === 'US');
    const starting = us.reduce((n, u) => n + u.menStart, 0), surviving = us.reduce((n, u) => n + u.men, 0);
    panel(heading, `${game.result.why} Grade: ${phase.record.grade}. ${surviving.toLocaleString()} of ${starting.toLocaleString()} Union men remain; ${phase.outcome.captures.length} field crates held. ${campaign.phase.loan ? "Grant's army was on loan, so your franchise brigades are unchanged." : 'Losses carry to your brigades.'}${pointsWords(pointsOf(campaign, phase))} ${phase.record.grade === 'Defeat' ? 'The campaign continues after a defeat; you can replay this phase once it is saved.' : 'Open the after-action and loot to save this phase.'}`,
      'After-action & loot', startCampaignLoot);
  }
  function finishResult() {
    if (captured) return;
    captured = true;
    game.paused = true; hud.setPaused(true); after.hidden = false;
    // Validate the private encounter report before allocating or preparing any award.
    try { surrenderResult = surrenderOutcome({ game, scenario }); }
    catch {
      surrenderUnavailable = true;
      openResult();
      return;
    }
    if (campaign) {
      try {
        const { outcome: result, record } = phaseResult({ phase: campaign.phase, game, scenario });
        phase = { outcome: result, record, next: recordPhase(campaign.save, campaign.raw, { ...record, at: new Date().toISOString() }) };
      } catch (err) { phaseFailure = err.message; hud.toast(err.message); }
      openResult();
      return;
    }
    if (mode === 'practice') {
      const awardId = manifest?.awardId ?? `practice-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
      try { outcome = manifest ? savedOutcome({ manifest, game }) : practiceOutcome({ game, scenario, mode, awardId, seed: awardId }); }
      catch (err) { hud.toast(err.message); }
    }
    openResult();
  }
  return { finishResult, openResult, get outcome() { return outcome; }, get pending() { return pending; },
    get phase() { return phase; }, get phaseFailure() { return phaseFailure; },
    get saved() { return saved; }, get reward() { return reward; }, get saving() { return saving; }, get reading() { return reading; } };
}

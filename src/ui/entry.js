// Completed-army camp. Explicit imports and depot exchanges share the authoritative save seam.
import { createProgressStore, parseSnapshot, exportSnapshot, exchangeDepot, listSlots, MAX_SAVE_BYTES } from '../franchise/save.js';
import { newCampaign } from '../franchise/campaign.js';
import { loadCampaign, loadPackSummary, ladderPosition, formatDate } from './briefing.js';
import { get } from '../settings.js';
import { brigCard, staticCard, itemLabel, defineRewardSettings } from '../reward/sequence.js';
import { compare, bestFit } from '../reward/model.js';
import { savedDeployment } from '../franchise/practice.js';
import { loadFieldScenario } from '../sim/phase.js';

const PAGE_SIZE = 12;
const STYLE = { 'clean modern': 'modern', 'period desk': 'desk', hybrid: 'hybrid' };
export function showFieldFailure({ href = './?camp', message = 'Your saved army is unchanged. Return to camp and try again.' } = {}) {
  document.getElementById('battle').hidden = true;
  const root = document.createElement('main'); root.id = 'front'; root.className = 'rw rw-counts';
  root.dataset.uiStyle = STYLE[get('screens.cardStyle')] || 'modern';
  const wrap = document.createElement('div'); wrap.className = 'entry-wrap';
  const section = document.createElement('section'); section.id = 'entry-title'; section.setAttribute('aria-labelledby', 'field-failure-heading');
  const heading = document.createElement('h1'); heading.id = 'field-failure-heading'; heading.tabIndex = -1;
  heading.textContent = 'The battlefield could not be loaded';
  const note = document.createElement('p'); note.id = 'entry-note';
  note.textContent = message;
  const link = document.createElement('a'); link.id = 'field-return'; link.className = 'entry-primary';
  link.href = href; link.textContent = 'Return to camp';
  section.append(heading, note, link); wrap.append(section); root.append(wrap); document.body.append(root);
  document.title = 'The Civil War — Return to camp'; heading.focus();
}
/** ?campaign=<slot>[&replay]: the field loads that slot's next phase (src/entry.js routes every non-field query here). */
function launchCampaign(route, onDeploy) {
  const slot = Number(route.get('campaign'));
  const fail = (error) => {
    console.warn('campaign phase not loaded:', error?.message ?? error);
    showFieldFailure({ href: [1, 2, 3].includes(slot) ? `./?camp=${slot}` : './',
      message: `${error?.message ?? 'The campaign phase could not be loaded.'} Your campaign save is unchanged. Return to camp and try again.` });
  };
  if (![1, 2, 3].includes(slot) || typeof onDeploy !== 'function') { fail(new Error('Campaign: choose a save slot from the title.')); return; }
  document.getElementById('battle').hidden = false;
  Promise.resolve().then(() => onDeploy({ campaign: { slot, replay: route.has('replay') }, isCurrent: () => true })).catch(fail);
}
export function mountEntry({ camp = false, deploy = false, onDeploy } = {}) {
  const route = new URLSearchParams(location.search);
  if (route.has('campaign')) { launchCampaign(route, onDeploy); return; }
  defineRewardSettings();
  // ?camp=<2|3> opens that save slot's camp; ?camp (and ?saved) keep slot 1, today's key.
  const slot = !deploy && ['2', '3'].includes(route.get('camp')) ? Number(route.get('camp')) : 1;
  const store = createProgressStore(undefined, { slot });
  // The shipped campaign; null keeps today's title while assets/campaign.json ships empty (or cannot be read).
  const ladderPromise = loadCampaign().catch((err) => { console.warn('campaign unavailable:', err?.message ?? err); return null; });
  let ladder = null, slots = null, battlesLoaded = false;
  const titles = new Map();
  let saved = null, failed = false, pendingImport = null, pendingName = null, importing = false;
  let pendingBaseline, baselineKnown = false, phase = 'idle';
  let pendingExchange = null, activeReview = null;
  let activeDeployment = null, disposed = false;
  const pages = { army: 0, depot: 0 };
  const root = document.createElement('main'); root.id = 'front'; root.className = 'rw rw-counts';
  root.dataset.uiStyle = STYLE[get('screens.cardStyle')] || 'modern';
  root.innerHTML = `
    <div class="entry-wrap">
      <header class="entry-head"><a href="./" class="entry-brand">The Civil War</a><p>One army. One war.</p></header>
      <section id="entry-title" aria-labelledby="entry-title-heading">
        <p class="rw-eyebrow">Take the field</p><h1 id="entry-title-heading">Your first command</h1>
        <p id="entry-note"></p>
        <div class="entry-title-actions"><button id="entry-campaign-continue" class="entry-primary" type="button" aria-describedby="entry-campaign-slot" hidden>Continue</button><button id="entry-new-campaign" type="button" hidden>New campaign</button><button id="entry-battles" type="button" aria-expanded="false" aria-controls="entry-battle-list" hidden>Battles</button><button id="entry-continue" class="entry-primary" type="button">Continue</button></div>
        <p id="entry-campaign-slot" hidden></p>
        <section id="entry-battle-list" aria-labelledby="entry-battles-heading" hidden><h2 id="entry-battles-heading" tabindex="-1">Battles</h2><p class="entry-note">Every built phase with its historical armies. No loot, and your campaign army is not changed.</p><p id="entry-battles-status" role="status"></p><div id="entry-battle-rows"></div></section>
      </section>
      <section id="entry-camp" aria-labelledby="entry-camp-heading" hidden>
        <header class="entry-camp-head"><div><p class="rw-eyebrow">Between battles</p><h1 id="entry-camp-heading">Your army</h1><p id="entry-summary"></p></div>
          <div class="entry-field-actions"><button id="camp-deploy" class="entry-primary" type="button" aria-describedby="camp-deploy-note">Deploy saved army</button><a id="camp-practice" class="entry-secondary" href="./?intro">Practice again</a></div></header>
        <p class="entry-note" id="camp-deploy-note" hidden>Deploy saved army is for practice armies. Campaign brigades fight only in their own campaign phases, so their losses and loot stay on the record.</p>
        <p class="entry-note" id="camp-field-note">Deploy fights with your saved formations and equipment; actual losses return here. Practice again starts the original teaching formations and asks before replacing your army.</p>
        <section id="camp-campaign" aria-labelledby="camp-campaign-heading" hidden>
          <p class="rw-eyebrow" id="camp-campaign-position"></p><h2 id="camp-campaign-heading" tabindex="-1"></h2>
          <p id="camp-complete" hidden></p><p id="camp-campaign-note"></p>
          <div class="entry-field-actions"><a id="camp-next" class="entry-primary" href="./">Next</a><a id="camp-replay" class="entry-secondary" href="./" hidden>Replay</a></div>
          <h3 id="camp-record-heading">Record so far</h3><p id="camp-record-empty">No phase fought yet.</p><ol id="camp-record" aria-labelledby="camp-record-heading"></ol>
        </section>
        <section aria-labelledby="camp-army-heading"><h2 id="camp-army-heading">Brigades</h2><div id="camp-army" class="rw-brigs is-static" role="list" aria-label="Saved brigades"></div><div id="army-pages" class="entry-pages"></div></section>
        <section aria-labelledby="camp-depot-heading"><h2 id="camp-depot-heading" tabindex="-1">Depot</h2><p id="depot-note"></p><div id="camp-depot" role="list" aria-label="Saved depot"></div><div id="depot-pages" class="entry-pages"></div></section>
      </section>
      <dialog id="slot-picker" aria-labelledby="slot-picker-heading" aria-describedby="slot-picker-note"><h2 id="slot-picker-heading" tabindex="-1">New campaign: choose a save slot</h2><p id="slot-picker-note">Each slot keeps one army. The campaign autosaves between phases and in camp.</p><div id="slot-rows" role="group" aria-label="Save slots"></div><p id="slot-picker-status" role="status"></p><div class="camp-compare-actions"><button id="slot-picker-cancel" type="button">Cancel</button></div></dialog>
      <dialog id="slot-overwrite" role="alertdialog" aria-labelledby="slot-overwrite-heading" aria-describedby="slot-overwrite-note"><h2 id="slot-overwrite-heading">Overwrite this slot?</h2><p id="slot-overwrite-note"></p><div class="camp-compare-actions"><button id="slot-overwrite-cancel" type="button">Cancel</button><button id="slot-overwrite-confirm" type="button">Overwrite</button></div></dialog>
      <section class="entry-transfer" aria-label="Army transfer"><p id="entry-status" role="status"></p><button id="entry-export" type="button" disabled>Export army</button><button id="entry-export-saved" type="button" hidden>Export displayed saved army</button><button id="entry-import" type="button">Import army</button><button id="entry-retry" type="button" hidden>Retry loading</button><button id="entry-discard-exchange" type="button" hidden>Discard pending exchange and reload</button><input id="entry-file" type="file" accept=".json,application/json" hidden></section>
      <nav class="entry-modes" aria-label="Other ways to play"><a href="./?practice">Henry Hill practice</a><a href="./?battle=henry-hill">Historical battle</a><a href="./?sandbox">Sandbox</a><a href="./reward.html">Reward workbench</a></nav>
      <p class="entry-note">Practice formations, rewards and ratings are game values. The historical battle is available separately.</p>
    </div>
    <dialog id="entry-replace" aria-labelledby="entry-replace-heading" aria-describedby="entry-replace-note"><h2 id="entry-replace-heading">Replace saved army?</h2><p id="entry-replace-note">Import replaces your army and depot with this completed export. Export first to keep your current army.</p><button id="entry-cancel" type="button">Cancel</button><button id="entry-confirm" type="button">Import and replace</button></dialog>
    <dialog id="camp-compare" aria-labelledby="camp-compare-heading" aria-describedby="camp-compare-item">
      <h2 id="camp-compare-heading" tabindex="-1">Compare and issue</h2><p id="camp-compare-item"></p><p id="camp-recommendation"></p>
      <label for="camp-recipient">Issue to</label><select id="camp-recipient"></select><p id="camp-recipient-name"></p>
      <div id="camp-ratings"></div><p id="camp-exchange-note" role="status"></p>
      <div class="camp-compare-actions"><button id="camp-compare-cancel" type="button">Cancel</button><button id="camp-issue" type="button">Issue and save</button></div>
    </dialog>
    <dialog id="deploy-review" aria-labelledby="deploy-heading" aria-describedby="deploy-note">
      <h2 id="deploy-heading" tabindex="-1">Deploy your saved army</h2><p id="deploy-note" role="status"></p>
      <ul id="deploy-formations" aria-label="Formations taking the field"></ul>
      <details id="deploy-dormant"><summary id="deploy-dormant-count"></summary><ul id="deploy-dormant-names" aria-label="Formations staying in camp"></ul></details><p class="entry-note">Fictional exercise on Henry Hill terrain. Strengths, equipment and rewards are game values. Survivors and new loot return to camp; no recruitment or historical outcome is implied.</p>
      <div class="camp-compare-actions"><button id="deploy-cancel" type="button">Return to camp</button><button id="deploy-export" type="button" disabled>Export army at review</button><button id="deploy-again" type="button" hidden>Review again</button><button id="deploy-launch" class="entry-primary" type="button" disabled>Take the field</button></div>
    </dialog>`;
  document.body.append(root);
  const node = (id) => root.querySelector(`#${id}`), status = node('entry-status');
  const controls = () => {
    root.setAttribute('aria-busy', String(importing));
    node('entry-continue').disabled = failed || importing || !!pendingExchange;
    node('entry-export').disabled = !(saved || pendingImport || pendingExchange);
    node('entry-export').textContent = pendingExchange ? 'Export pending army' : pendingImport ? 'Export pending import' : 'Export army';
    node('entry-export-saved').hidden = !saved || !(pendingImport || pendingExchange);
    node('entry-retry').hidden = !failed && !pendingImport && !pendingExchange;
    node('entry-retry').textContent = pendingExchange ? 'Retry reviewed exchange' : pendingImport ? 'Retry importing' : 'Retry loading';
    node('entry-import').disabled = importing || !!pendingExchange;
    node('camp-deploy').disabled = importing || !!pendingImport || !!pendingExchange || !saved || failed || saved.version === 2;
    for (const id of ['entry-campaign-continue', 'entry-new-campaign', 'entry-battles']) node(id).disabled = importing || !!pendingExchange;
    node('entry-retry').disabled = importing;
    node('entry-discard-exchange').hidden = !pendingExchange;
    node('entry-discard-exchange').disabled = importing;
    root.querySelectorAll('.camp-compare-button').forEach((b) => { b.disabled = importing || !!pendingImport || !!pendingExchange; });
    root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('aria-disabled', String(importing || !!pendingExchange)));
  };
  function paged(items, container, controlsNode, build, noun, key) {
    let page = Math.min(pages[key], Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
    const buttons = items.length > PAGE_SIZE ? [['Previous', -1], ['Next', 1]].map(([label, delta], i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${label} ${noun}`;
      b.addEventListener('click', () => { page += delta; draw(); (b.disabled ? buttons[1 - i] : b).focus(); });
      return b;
    }) : [];
    const count = document.createElement('span'); count.setAttribute('role', 'status');
    controlsNode.replaceChildren(...buttons, ...(buttons.length ? [count] : []));
    function draw() {
      pages[key] = page;
      container.replaceChildren();
      items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((item, i) => container.append(build(item, page * PAGE_SIZE + i)));
      if (!buttons.length) return;
      buttons[0].disabled = page === 0; buttons[1].disabled = (page + 1) * PAGE_SIZE >= items.length;
      count.textContent = `${page * PAGE_SIZE + 1}–${Math.min(items.length, (page + 1) * PAGE_SIZE)} of ${items.length}`;
    }
    draw();
  }
  const titleOf = (packId, phaseId) => {
    const p = titles.get(packId)?.phases.find((x) => x.id === phaseId);
    return p ? p.title : `${packId} · ${phaseId}`;
  };
  // Campaign slots of this campaign, most recently updated first (a save with no time sorts last).
  const campaignSlots = () => (ladder && slots ? slots.filter((r) => r.kind === 'campaign' && r.label === ladder.def.title)
    .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '')) : []);
  function renderTitleCampaign() {
    const on = !!ladder, recent = campaignSlots()[0] || null;
    node('entry-campaign-continue').hidden = !recent; node('entry-new-campaign').hidden = !on; node('entry-battles').hidden = !on;
    node('entry-campaign-slot').hidden = !recent;
    node('entry-new-campaign').className = recent ? 'entry-secondary' : 'entry-primary';
    node('entry-continue').className = on ? 'entry-secondary' : 'entry-primary';
    node('entry-continue').textContent = on ? 'Practice: Henry House Hill' : 'Continue';
    if (!on) return;
    const packs = new Set(ladder.def.phases.map((p) => p.packId)).size;
    node('entry-title-heading').textContent = ladder.def.title;
    node('entry-note').textContent = failed ? 'Save slot 1 could not be read. Your campaign slots are listed under New campaign; retry loading or import an army export to recover slot 1.'
      : `One army through ${packs} battle${packs === 1 ? '' : 's'} and ${ladder.def.phases.length} phases. Losses, veterancy and loot carry from phase to phase; a defeat never ends the campaign.`;
    if (recent) node('entry-campaign-slot').textContent = `Slot ${recent.slot} · ${recent.nextPhase ? `Next: ${titleOf(recent.nextPhase.packId, recent.nextPhase.phaseId)}` : 'Campaign complete'}${recent.updated ? ` · saved ${new Date(recent.updated).toLocaleString()}` : ''}`;
  }
  function renderCampaignStrip() {
    const v2 = saved.version === 2, c = v2 ? saved.campaign : null, known = v2 && !!ladder && ladder.def.id === c.id;
    node('camp-campaign').hidden = !v2; node('camp-deploy-note').hidden = !v2; node('camp-practice').hidden = v2;
    node('camp-field-note').hidden = v2;
    if (!v2) return;
    const complete = c.status === 'complete', last = c.history[c.history.length - 1];
    node('camp-campaign-heading').textContent = known ? ladder.def.title : c.id;
    node('camp-next').hidden = !known || complete; node('camp-replay').hidden = !known || last?.grade !== 'Defeat';
    node('camp-complete').hidden = !(known && complete);
    if (!known) {
      node('camp-campaign-position').textContent = 'Campaign';
      node('camp-campaign-note').textContent = 'This campaign ladder is not available in this version of the game. Your army and depot are safe; export them to keep a copy.';
    } else {
      const pos = ladderPosition(ladder.def, c.index);
      node('camp-campaign-position').textContent = complete ? 'Campaign complete' : `Battle ${pos.battle} of ${pos.battles} · Phase ${pos.phase} of ${pos.phases}`;
      const next = complete ? null : ladder.def.phases[c.index];
      node('camp-campaign-note').textContent = complete ? 'Your army fought every phase of the campaign. The depot and compare-and-issue stay open.'
        : `Slot ${slot}. ${next.loan ? "Next phase: Grant's Army of the Tennessee is on loan; its results do not change your franchise brigades." : 'Your brigades take the field with their current men, veterancy and arms.'}`;
      if (next) { node('camp-next').textContent = `Next: ${titleOf(next.packId, next.phaseId)}`; node('camp-next').href = `./?campaign=${slot}`; }
      if (last) { node('camp-replay').textContent = `Replay this phase: ${titleOf(last.packId, last.phaseId)}`; node('camp-replay').href = `./?campaign=${slot}&replay`; }
      const replays = c.history.filter((r) => r.replay).length;
      node('camp-complete').textContent = `Campaign complete. ${c.history.length - replays} phases fought${replays ? `, ${replays} replay${replays === 1 ? '' : 's'} marked` : ''}. Final grade: ${saved.grade}.`;
    }
    node('camp-record-empty').hidden = c.history.length > 0; node('camp-record').hidden = !c.history.length;
    node('camp-record').replaceChildren(...c.history.map((r) => {
      const li = document.createElement('li'); li.dataset.grade = r.grade; if (r.replay) li.dataset.replay = 'true';
      li.textContent = `${titleOf(r.packId, r.phaseId)}: ${r.grade}${r.replay ? ' (replay)' : ''} · Union losses ${r.lossesUS.toLocaleString()} · Confederate losses ${r.lossesCS.toLocaleString()}`;
      return li;
    }));
  }
  function render() {
    const showCamp = camp && !!saved && !failed;
    node('entry-title').hidden = showCamp; node('entry-camp').hidden = !showCamp;
    node('entry-title-heading').textContent = saved ? 'Your army is ready' : 'Your first command';
    node('entry-note').textContent = saved ? `${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men return to camp. Continue opens your saved army and depot.`
      : failed ? 'Progress could not be read. Retry loading or import an army export to recover.'
        : 'Two brigades. One approaching enemy. Hold the ground, capture the stores, then open your first loot.';
    if (!showCamp) renderTitleCampaign();
    if (showCamp) {
      renderCampaignStrip();
      node('entry-summary').textContent = `${saved.army.length} formations · ${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men · ${saved.grade ?? 'no phase fought yet'}`;
      paged(saved.army, node('camp-army'), node('army-pages'), (b, i) => {
        const card = brigCard(b, i, { interactive: false }); card.dataset.brigadeId = b.id; return card;
      }, 'brigades', 'army');
      node('depot-note').textContent = saved.depot.length ? `${saved.depot.length} cards kept in the depot. Compare a card to issue it; your current weapon returns here.` : 'No spare arms in the depot.';
      paged(saved.depot, node('camp-depot'), node('depot-pages'), (item) => {
        const cell = document.createElement('div'); cell.setAttribute('role', 'listitem'); cell.dataset.itemUid = item.uid;
        const card = staticCard(item); card.setAttribute('role', 'group');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'camp-compare-button';
        button.disabled = importing || !!pendingImport || !!pendingExchange;
        button.textContent = 'Compare and issue'; button.setAttribute('aria-label', `Compare and issue ${itemLabel(item)}`);
        button.addEventListener('click', () => openExchange(item.uid, button)); cell.append(card, button); return cell;
      }, 'depot cards', 'depot');
    }
    controls();
    window.__entry = { mode: showCamp ? 'camp' : 'title', slot, saved, failed, pending: pendingImport,
      campaign: ladder ? { id: ladder.def.id, slots, continueSlot: campaignSlots()[0]?.slot ?? null } : null,
      get exchange() { return pendingExchange; }, get importing() { return importing; }, get deployment() { return activeDeployment; } };
    document.title = `The Civil War — ${showCamp ? 'Your army' : 'Take the field'}`;
  }
  function focusStatus() { status.tabIndex = -1; status.focus(); status.scrollIntoView({ block: 'nearest' }); }
  function loading(message = 'Loading saved progress…') { phase = 'reading'; status.textContent = message; focusStatus(); }
  function focusDepot(uid, index) {
    const cells = [...node('camp-depot').children];
    const cell = cells.find((n) => n.dataset.itemUid === uid) || cells[Math.min(cells.length - 1, Math.max(0, index - pages.depot * PAGE_SIZE))];
    const target = cell?.querySelector('button:not(:disabled)') || node('depot-pages').querySelector('button:not(:disabled)') || node('camp-depot-heading');
    target.focus(); target.scrollIntoView({ block: 'nearest' });
  }
  const signed = (n) => n > 0 ? `+${n}` : String(n);
  function updateComparison() {
    const review = activeReview; if (!review) return;
    const brigade = review.snapshot.army.find((b) => b.id === node('camp-recipient').value);
    review.task = null; node('camp-issue').disabled = true; node('camp-ratings').replaceChildren();
    if (!brigade) {
      node('camp-recipient-name').textContent = 'No eligible formation.';
      node('camp-exchange-note').textContent = 'No available brigade can carry this card. Depleted formations keep new gear in the depot.';
      return;
    }
    const comparison = compare(brigade, review.item);
    node('camp-recipient-name').textContent = `${brigade.label} · ${brigade.men.toLocaleString()} men${brigade.kind === 'battery' ? ` · ${brigade.guns} guns` : ''}`;
    const table = document.createElement('table'); table.innerHTML = '<caption>Game ratings</caption><thead><tr><th scope="col">Rating</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead><tbody></tbody>';
    for (const [key, label] of [['ovr', 'OVR'], ['arms', 'Arms'], ['fire', 'Fire'], ['melee', 'Melee'], ['morale', 'Morale'], ['drill', 'Drill']]) {
      const row = document.createElement('tr'), heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
      for (const value of [comparison.before[key], comparison.after[key], signed(comparison.delta[key])]) {
        const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
      }
      table.tBodies[0].append(row);
    }
    node('camp-ratings').append(table);
    try {
      const command = Object.freeze({ brigadeId: brigade.id, itemUid: review.item.uid });
      const draft = exportSnapshot(exchangeDepot(review.snapshot, command));
      review.task = Object.freeze({ baseline: review.baseline, command, draft, index: review.index });
      node('camp-exchange-note').textContent = `${itemLabel(brigade.weapon)} returns to your depot. ${review.retry
        ? 'Retry keeps the original reviewed army. If progress changed elsewhere, discard the pending exchange and reload before a fresh review.'
        : 'Issue saves this exchange. Cancel keeps your army unchanged.'}`;
      node('camp-issue').disabled = false;
    } catch (err) { node('camp-exchange-note').textContent = `${err.message} Your saved army is unchanged.`; }
  }
  async function reviewExchange(baseline, uid, { retry = false, brigadeId } = {}) {
    const snapshot = parseSnapshot(baseline), item = snapshot.depot.find((it) => it.uid === uid);
    if (!item) throw new Error('Progress: selected depot item is no longer available. Reload before a fresh review.');
    const eligible = snapshot.army.filter((b) => compare(b, item).ok), recommended = bestFit(eligible, item);
    const select = node('camp-recipient'); select.replaceChildren();
    for (const brigade of eligible) {
      const option = document.createElement('option'); option.value = brigade.id; option.textContent = brigade.label; select.append(option);
    }
    select.value = retry ? brigadeId : recommended?.id || ''; select.disabled = retry || !eligible.length;
    node('camp-compare-item').textContent = itemLabel(item);
    node('camp-recommendation').textContent = recommended ? `Recommended: ${recommended.label} (${signed(compare(recommended, item).delta.ovr)} OVR). Highest OVR change among eligible formations.`
      : 'No compatible formation has men and guns available.';
    node('camp-compare-heading').textContent = retry ? 'Retry reviewed exchange' : 'Compare and issue';
    node('camp-issue').textContent = retry ? 'Retry issue and save' : 'Issue and save';
    activeReview = { snapshot, item, baseline, retry, index: snapshot.depot.findIndex((it) => it.uid === uid), task: null };
    updateComparison(); phase = 'reviewing';
    const dialog = node('camp-compare'); dialog.returnValue = 'cancel'; dialog.showModal();
    node('camp-compare-heading').focus(); node('camp-compare-heading').scrollIntoView({ block: 'nearest' });
    const accepted = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'issue'), { once: true }));
    const task = accepted ? activeReview.task : null; activeReview = null; return task;
  }
  async function writeExchange() {
    const task = pendingExchange; phase = 'writing';
    status.textContent = 'Saving the reviewed exchange… The pending army is exportable while saving waits.';
    render(); focusStatus();
    try {
      const next = await store.issue(task.command, { previous: parseSnapshot(task.baseline) });
      saved = next; pendingExchange = null; failed = false;
      status.textContent = 'Issued and saved. The previous weapon is now in your depot.'; render(); return true;
    } catch (err) {
      status.textContent = `${err.message} The displayed saved army is unchanged. Export the pending army, retry the reviewed exchange, or discard it and reload.`;
      render(); return false;
    }
  }
  async function openExchange(uid, trigger, retry = false) {
    if (importing || pendingImport || !saved || failed || (pendingExchange && !retry)) return;
    const baseline = retry ? pendingExchange.baseline : exportSnapshot(saved);
    const index = retry ? pendingExchange.index : saved.depot.findIndex((it) => it.uid === uid);
    importing = true; controls(); let accepted = false, committed = false;
    try {
      const task = await reviewExchange(baseline, uid, { retry, brigadeId: pendingExchange?.command.brigadeId });
      accepted = !!task;
      if (task) { pendingExchange = retry ? pendingExchange : task; committed = await writeExchange(); }
    } catch (err) { status.textContent = `${err.message} The displayed saved army is unchanged.`; }
    finally {
      importing = false; phase = 'idle'; controls();
      if (accepted && !committed) { node('entry-retry').focus(); node('entry-retry').scrollIntoView({ block: 'nearest' }); }
      else if (trigger.isConnected && !trigger.disabled && trigger.getClientRects().length) { trigger.focus(); trigger.scrollIntoView({ block: 'nearest' }); }
      else focusDepot(uid, index);
    }
  }
  node('camp-recipient').addEventListener('change', updateComparison);
  node('camp-compare-cancel').addEventListener('click', () => { if (activeReview && node('camp-compare').open) node('camp-compare').close('cancel'); });
  node('camp-issue').addEventListener('click', () => {
    if (activeReview?.task && node('camp-compare').open && !node('camp-issue').disabled) node('camp-compare').close('issue');
  });
  node('camp-compare').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...node('camp-compare').querySelectorAll('select:not(:disabled),button:not(:disabled)')], first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && [first, node('camp-compare-heading')].includes(document.activeElement)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  root.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (e) => { if (importing || pendingExchange) e.preventDefault(); }));
  // Campaign state for the title (slots, next-phase titles) or a campaign camp (record titles). Never throws.
  async function refreshCampaign() {
    ladder = await ladderPromise;
    if (!ladder) return;
    const showCamp = camp && !!saved && !failed, packs = new Set();
    if (showCamp && saved.version === 2) {
      for (const r of saved.campaign.history) packs.add(r.packId);
      const next = ladder.def.phases[saved.campaign.index]; if (next) packs.add(next.packId);
    } else if (!showCamp) {
      try { slots = await listSlots(undefined, { campaign: ladder.def }); } catch { slots = null; }
      for (const r of slots || []) if (r.nextPhase) packs.add(r.nextPhase.packId);
    }
    await Promise.allSettled([...packs].filter((id) => !titles.has(id)).map((id) => loadPackSummary(id).then((sum) => titles.set(id, sum))));
  }
  function focusAfterLoad() {
    const showCamp = camp && !!saved && !failed;
    const target = failed && !(ladder && !camp) ? node('entry-retry')
      : showCamp ? saved.version === 2 ? (node('camp-next').hidden ? node('camp-campaign-heading') : node('camp-next')) : node('camp-practice')
        : ladder ? (node('entry-campaign-continue').hidden ? node('entry-new-campaign') : node('entry-campaign-continue')) : node('entry-continue');
    target.focus(); target.scrollIntoView?.({ block: 'nearest' });
  }
  async function load() {
    if (importing) return;
    importing = true; controls(); loading();
    try { saved = await store.load(); failed = false; status.textContent = saved ? 'Saved army ready.' : 'No completed army saved yet.'; }
    catch (err) { failed = true; status.textContent = err.message; }
    await refreshCampaign();
    importing = false; phase = 'idle';
    render(); focusAfterLoad();
  }
  async function confirm(returnTo = node('entry-import')) {
    phase = 'reviewing';
    const dialog = node('entry-replace'); dialog.returnValue = 'cancel'; dialog.showModal(); node('entry-cancel').focus();
    const accepted = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), { once: true }));
    if (!returnTo.disabled) returnTo.focus(); return accepted;
  }
  async function writeImport() {
    const text = pendingImport, previousRaw = pendingBaseline; phase = 'writing';
    status.textContent = 'Saving the imported army… You can export the pending import while saving waits.';
    render(); focusStatus();
    try {
      saved = await store.import(text, { previousRaw });
      pendingImport = null; pendingName = null; pendingBaseline = undefined; baselineKnown = false;
      failed = false; status.textContent = 'Imported and saved army.';
    }
    catch (err) { status.textContent = `${err.message} Export the pending import or retry. Current progress is unchanged.`; }
    render(); node('entry-import').focus();
  }
  function importNote(snapshot, name) {
    node('entry-replace-note').textContent = `Import ${name}: ${snapshot.army.length} formations and ${snapshot.depot.length} depot cards. This replaces your completed army and depot. Export first to keep your current army.`;
  }
  node('entry-continue').addEventListener('click', async () => {
    if (importing || pendingExchange) return;
    importing = true; controls();
    loading();
    // Re-read at navigation: another tab may have saved or invalidated progress.
    // With a campaign on the title this is Practice: a slot-1 campaign is not a practice army, so it starts the intro.
    try { saved = await store.load(); failed = false; location.assign(saved && !(ladder && saved.version === 2) ? './?camp' : './?intro'); }
    catch (err) { failed = true; status.textContent = err.message; render(); }
    finally { importing = false; phase = 'idle'; controls(); if (failed) node('entry-retry').focus(); }
  });
  // ---- campaign title: Continue, New campaign (slot picker + overwrite warning), Battles ----
  node('entry-campaign-continue').addEventListener('click', () => {
    const recent = campaignSlots()[0];
    if (!importing && !pendingExchange && recent) location.assign(`./?camp=${recent.slot}`);
  });
  const picker = node('slot-picker'), overwrite = node('slot-overwrite');
  function slotText(row) {
    if (row.empty) return 'Empty slot';
    if (row.kind !== 'campaign') return row.label;
    const next = row.nextPhase ? `next: ${titleOf(row.nextPhase.packId, row.nextPhase.phaseId)}` : 'complete';
    return `${row.label} · ${next}${row.updated ? ` · saved ${new Date(row.updated).toLocaleString()}` : ''}`;
  }
  async function openSlotPicker() {
    if (importing || pendingExchange || !ladder) return;
    importing = true; controls(); node('slot-rows').replaceChildren(); node('slot-picker-status').textContent = 'Reading your save slots…';
    picker.showModal(); node('slot-picker-heading').focus();
    try { slots = await listSlots(undefined, { campaign: ladder.def }); }
    catch (err) { node('slot-picker-status').textContent = `${err.message} No slot was changed.`; slots = null; }
    for (const r of slots || []) if (r.nextPhase && !titles.has(r.nextPhase.packId)) {
      try { titles.set(r.nextPhase.packId, await loadPackSummary(r.nextPhase.packId)); } catch { /* the phase id stands in for its title */ }
    }
    importing = false; controls();
    if (!slots) return;
    node('slot-picker-status').textContent = '';
    for (const row of slots) {
      const b = document.createElement('button'); b.type = 'button'; b.id = `slot-choice-${row.slot}`; b.className = 'slot-choice';
      b.dataset.slot = String(row.slot); b.dataset.empty = String(row.empty);
      const name = document.createElement('b'); name.textContent = `Slot ${row.slot}`;
      const detail = document.createElement('span'); detail.textContent = slotText(row);
      b.append(name, detail); b.addEventListener('click', () => chooseSlot(row, b));
      node('slot-rows').append(b);
    }
    (node('slot-rows').querySelector('[data-empty="true"]') || node('slot-rows').querySelector('button'))?.focus();
  }
  function confirmOverwrite(row) {
    node('slot-overwrite-heading').textContent = `Overwrite slot ${row.slot}?`;
    node('slot-overwrite-note').textContent = `Slot ${row.slot} holds ${slotText(row)}. A new campaign here replaces it for good. Cancel keeps it; export it from its camp first to keep a copy.`;
    node('slot-overwrite-confirm').textContent = `Overwrite slot ${row.slot}`;
    overwrite.returnValue = 'cancel'; overwrite.showModal(); node('slot-overwrite-cancel').focus();
    return new Promise((resolve) => overwrite.addEventListener('close', () => resolve(overwrite.returnValue === 'overwrite'), { once: true }));
  }
  async function chooseSlot(row, trigger) {
    if (importing || !ladder) return;
    if (!row.empty && !await confirmOverwrite(row)) { trigger.focus(); return; }
    importing = true; controls(); node('slot-rows').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    node('slot-picker-status').textContent = `Starting the campaign in slot ${row.slot}…`;
    let started = false;
    try {
      const target = createProgressStore(undefined, { slot: row.slot }), previousRaw = await target.readRawBaseline();
      if (row.empty && previousRaw !== null) throw new Error(`Progress: slot ${row.slot} was filled elsewhere. Choose it again to review overwriting it.`);
      const fresh = newCampaign({ campaign: ladder.raw, slot: row.slot, seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0], at: new Date().toISOString() });
      await target.import(exportSnapshot(fresh), { previousRaw });
      started = true; location.assign(`./?camp=${row.slot}`);
    } catch (err) { node('slot-picker-status').textContent = `${err.message} No slot was changed.`; }
    finally {
      importing = false; controls();
      if (!started) { node('slot-rows').querySelectorAll('button').forEach((b) => { b.disabled = false; }); trigger.focus(); }
    }
  }
  node('entry-new-campaign').addEventListener('click', openSlotPicker);
  node('slot-picker-cancel').addEventListener('click', () => picker.close('cancel'));
  picker.addEventListener('close', () => { if (!overwrite.open && !node('entry-new-campaign').hidden) node('entry-new-campaign').focus(); });
  node('slot-overwrite-cancel').addEventListener('click', () => overwrite.close('cancel'));
  node('slot-overwrite-confirm').addEventListener('click', () => overwrite.close('overwrite'));
  for (const d of [picker, overwrite]) d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...d.querySelectorAll('button')].filter((b) => !b.disabled && b.getClientRects().length), first = stops[0], last = stops[stops.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && [first, node('slot-picker-heading')].includes(document.activeElement)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  node('entry-battles').addEventListener('click', async () => {
    const button = node('entry-battles'), list = node('entry-battle-list'), open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open)); list.hidden = !open;
    if (!open || !ladder) return;
    if (!battlesLoaded) {
      battlesLoaded = true; node('entry-battles-status').textContent = 'Loading the battles…';
      const rows = node('entry-battle-rows'); rows.replaceChildren();
      for (const packId of new Set(ladder.def.phases.map((p) => p.packId))) {
        const group = document.createElement('section'); group.className = 'entry-battle';
        const heading = document.createElement('h3'), items = document.createElement('ul');
        try {
          const sum = titles.get(packId) || await loadPackSummary(packId); titles.set(packId, sum);
          heading.textContent = sum.title;
          for (const p of sum.phases) {
            const li = document.createElement('li'), a = document.createElement('a'), note = document.createElement('p');
            a.href = `./?battle=${encodeURIComponent(packId)}&phase=${encodeURIComponent(p.id)}`; a.textContent = p.title;
            a.addEventListener('click', (e) => { if (importing || pendingExchange) e.preventDefault(); });
            note.textContent = [formatDate(p.date), p.start, p.line].filter(Boolean).join(' · ');
            li.append(a, note); items.append(li);
          }
        } catch (err) {
          heading.textContent = packId;
          const li = document.createElement('li'); li.textContent = `This battle could not be loaded: ${err.message}`; items.append(li);
        }
        group.append(heading, items); rows.append(group);
      }
      node('entry-battles-status').textContent = '';
    }
    (node('entry-battle-rows').querySelector('a') || node('entry-battles-heading')).focus();
  });
  node('entry-retry').addEventListener('click', async () => {
    if (importing) return;
    if (pendingExchange) { await openExchange(pendingExchange.command.itemUid, node('entry-retry'), true); return; }
    if (!pendingImport) { load(); return; }
    importing = true; controls();
    let accepted = false;
    try {
      // A failed read grants no write. Only that case may acquire its first baseline on retry.
      if (!baselineKnown) { loading(); pendingBaseline = await store.readRawBaseline(); baselineKnown = true; }
      importNote(parseSnapshot(pendingImport), pendingName);
      accepted = await confirm(node('entry-retry'));
      if (accepted) await writeImport();
    } catch (err) { status.textContent = `${err.message} Export the pending import or retry. Current progress is unchanged.`; }
    finally { importing = false; phase = 'idle'; controls(); (accepted ? node('entry-import') : node('entry-retry')).focus(); }
  });
  function download(text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'the-civil-war-army.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  node('entry-export').addEventListener('click', () => {
    if (!(pendingExchange || pendingImport || saved)) return;
    download(pendingExchange?.draft || pendingImport || exportSnapshot(saved));
    status.textContent = pendingExchange ? `Exported pending army; this exchange is not saved yet. ${importing ? 'Saving is still waiting.' : 'Retry the reviewed exchange or discard it and reload.'}`
      : pendingImport ? importing ? phase === 'writing' ? 'Exported pending import. Saving is still waiting.' : 'Exported pending import. Review is still in progress.' : 'Exported pending import. Browser saving still needs a retry.' : 'Exported the displayed saved army.';
  });
  node('entry-export-saved').addEventListener('click', () => {
    if (!saved) return; download(exportSnapshot(saved)); status.textContent = 'Exported the displayed saved army. The pending army remains unsaved.';
  });
  node('entry-discard-exchange').addEventListener('click', async () => {
    if (importing || !pendingExchange) return;
    pendingExchange = null; controls(); await load();
  });
  node('entry-import').addEventListener('click', () => { if (!importing && !pendingExchange) node('entry-file').click(); });
  node('entry-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file || importing || pendingExchange) return;
    importing = true; controls(); loading('Reading the selected army…');
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error('Progress: file exceeds the 1 MB limit.');
      const text = await file.text(), snapshot = parseSnapshot(text);
      let previousRaw;
      try { previousRaw = await store.readRawBaseline(); }
      catch (err) {
        pendingImport = text; pendingName = file.name; pendingBaseline = undefined; baselineKnown = false;
        status.textContent = `${err.message} Export the pending import, or retry loading before reviewing replacement.`;
        render(); return;
      }
      importNote(snapshot, file.name);
      if (await confirm()) {
        pendingImport = text; pendingName = file.name; pendingBaseline = previousRaw; baselineKnown = true;
        await writeImport();
      }
    } catch (err) { status.textContent = `${err.message} Current progress is unchanged.`; }
    finally { importing = false; phase = 'idle'; controls(); node('entry-import').focus(); }
  });
  node('entry-cancel').addEventListener('click', () => node('entry-replace').close('cancel'));
  node('entry-confirm').addEventListener('click', () => node('entry-replace').close('replace'));
  node('entry-replace').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const first = node('entry-cancel'), last = node('entry-confirm');
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const reviewDialog = node('deploy-review');
  const currentDeployment = (task) => !disposed && activeDeployment === task && !task.cancelled && reviewDialog.open;
  function deploymentBusy(task, message) {
    task.busy = true; node('deploy-launch').disabled = true; node('deploy-again').disabled = true;
    reviewDialog.setAttribute('aria-busy', 'true'); node('deploy-note').textContent = message;
    node('deploy-heading').focus(); node('deploy-heading').scrollIntoView({ block: 'nearest' });
  }
  function finishDeployment(task) {
    if (disposed || activeDeployment !== task || task.busy || task.admitted) return;
    activeDeployment = null; importing = false; phase = 'idle'; render();
    const target = task.trigger?.isConnected && !task.trigger.disabled && task.trigger.getClientRects().length
      ? task.trigger : saved && !failed ? node(saved.version === 2 ? 'camp-campaign-heading' : 'camp-deploy') : node('entry-retry').hidden ? node('entry-continue') : node('entry-retry');
    target.focus(); target.scrollIntoView({ block: 'nearest' });
  }
  function cancelDeployment() {
    const task = activeDeployment; if (!task || task.admitted) return;
    task.cancelled = true; if (reviewDialog.open) reviewDialog.close('cancel');
    finishDeployment(task); // an outstanding operation retains its owner until settlement
  }
  function deploymentFailure(task, error) {
    node('deploy-note').textContent = `${error.message} No saved progress was changed. Export this file or return to camp; Review again reads a fresh army explicitly.`;
    node('deploy-launch').disabled = true; node('deploy-again').hidden = false;
    node('deploy-export').disabled = !task.raw;
    node('deploy-export').textContent = task.baseline ? 'Export army at review' : 'Export stored file';
  }
  async function openDeployment(trigger = node('camp-deploy')) {
    if (disposed || importing || pendingExchange || pendingImport) return;
    if (saved?.version === 2) { status.textContent = node('camp-deploy-note').textContent; return; }
    importing = true; phase = 'reading'; controls();
    const awardId = `saved-${globalThis.crypto.randomUUID()}`;
    const task = { awardId, seed: awardId, trigger, cancelled: false, admitted: false, busy: true,
      manifest: null, baseline: null, raw: null };
    activeDeployment = task; reviewDialog.returnValue = 'cancel';
    node('deploy-formations').replaceChildren(); node('deploy-dormant-names').replaceChildren();
    node('deploy-dormant-count').textContent = ''; node('deploy-dormant').hidden = true; node('deploy-dormant').open = false;
    node('deploy-export').disabled = true; node('deploy-again').hidden = true;
    reviewDialog.showModal(); deploymentBusy(task, 'Loading your saved army before the field is loaded…');
    try {
      let baseline;
      try { baseline = await store.load(); }
      catch (error) { if (!disposed) { saved = null; failed = true; } throw error; }
      if (!disposed) { saved = baseline; failed = false; }
      if (!currentDeployment(task)) return;
      if (!baseline) throw new Error('Practice: no completed army is saved yet. Choose introductory practice from camp.');
      task.baseline = baseline; task.raw = exportSnapshot(baseline);
      saved = baseline; failed = false;
      // Admission precedes even small scenario metadata; no terrain/GPU/unit import is needed.
      savedDeployment({ baseline, ground: {}, awardId, seed: task.seed, surrender: true });
      const ground = await loadFieldScenario({ isCurrent: () => currentDeployment(task) });
      if (!currentDeployment(task)) return;
      if (ground.id !== 'henry-hill' || !Array.isArray(ground.sites) || !Array.isArray(ground.woods)) throw new Error('Practice: the practice ground description is invalid.');
      task.manifest = savedDeployment({ baseline, ground, awardId, seed: task.seed, surrender: true });
      saved = baseline; failed = false; render();
      const manifest = task.manifest;
      for (const def of manifest.scenario.units.filter((d) => d.side === 'US')) {
        const b = manifest.baseline.army.find((b) => b.id === def.id), row = document.createElement('li');
        row.textContent = `${b.label} · ${b.men.toLocaleString()} men${b.kind === 'battery' ? ` · ${b.guns} guns` : ''} · ${itemLabel(b.weapon)} · ${b.weapon.from}${b.weapon.source ? ` · ${b.weapon.source}` : ''}`;
        node('deploy-formations').append(row);
      }
      node('deploy-note').textContent = `${manifest.allocation.formations} active formations, ${manifest.allocation.men.toLocaleString()} men and ${manifest.allocation.guns} guns. Your whole active army fits this exercise. Hold the ground for 45 seconds. Take the field rechecks this exact reviewed army before loading the battlefield.`;
      node('deploy-dormant-count').textContent = `${manifest.dormant.length} dormant formations stay unchanged in camp. Show names.`;
      node('deploy-dormant').hidden = manifest.dormant.length === 0;
      for (const id of manifest.dormant) {
        const row = document.createElement('li'); row.textContent = manifest.baseline.army.find((b) => b.id === id).label;
        node('deploy-dormant-names').append(row);
      }
      node('deploy-export').disabled = false; node('deploy-export').textContent = 'Export army at review';
      node('deploy-launch').disabled = false; phase = 'reviewing';
    } catch (error) {
      if (!currentDeployment(task)) return;
      if (!task.raw) {
        try { task.raw = await store.readRawBaseline(); } catch { /* the failed read grants no export or write */ }
        if (!currentDeployment(task)) return;
      }
      deploymentFailure(task, error);
    } finally {
      task.busy = false;
      if (currentDeployment(task)) {
        reviewDialog.setAttribute('aria-busy', 'false'); node('deploy-again').disabled = false;
        node('deploy-heading').focus(); node('deploy-heading').scrollIntoView({ block: 'nearest' });
      } else finishDeployment(task);
    }
  }
  node('camp-deploy').addEventListener('click', () => openDeployment());
  node('deploy-cancel').addEventListener('click', cancelDeployment);
  reviewDialog.addEventListener('cancel', (e) => { e.preventDefault(); cancelDeployment(); });
  reviewDialog.addEventListener('close', () => { if (!reviewDialog.open) cancelDeployment(); });
  node('deploy-export').addEventListener('click', () => { const task = activeDeployment; if (task?.raw) download(task.raw); });
  node('deploy-again').addEventListener('click', () => {
    const task = activeDeployment; if (!task || task.busy) return;
    const trigger = task.trigger; cancelDeployment(); openDeployment(trigger);
  });
  node('deploy-launch').addEventListener('click', async () => {
    const task = activeDeployment;
    if (!task?.manifest || task.busy || !currentDeployment(task) || node('deploy-launch').disabled) return;
    phase = 'launching'; deploymentBusy(task, 'Rechecking the reviewed army before loading the field… Return to camp cancels this handoff.');
    try {
      if (typeof onDeploy !== 'function') throw new Error('Practice: the field launcher is unavailable.');
      await onDeploy({ manifest: task.manifest, isCurrent: () => currentDeployment(task), onAdmitted: () => {
        if (!currentDeployment(task)) throw new Error('Practice: deployment review was cancelled.');
        task.admitted = true; disposed = true; reviewDialog.close('launch'); root.remove();
        delete window.__entry;
        const q = new URLSearchParams(location.search); q.delete('camp'); q.set('saved', '');
        history.replaceState(null, '', location.pathname + '?' + q.toString());
        document.getElementById('battle').hidden = false;
      } });
    } catch (error) {
      if (currentDeployment(task)) deploymentFailure(task, error);
      else if (task.admitted) {
        const link = document.createElement('a'); link.href = './?camp'; link.textContent = 'Return to camp';
        link.style.color = 'var(--focus)';
        document.getElementById('status').replaceChildren(document.createTextNode(`${error.message} `), link);
      }
    } finally {
      task.busy = false;
      if (currentDeployment(task)) { reviewDialog.setAttribute('aria-busy', 'false'); node('deploy-again').disabled = false; }
      else finishDeployment(task);
    }
  });
  reviewDialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...reviewDialog.querySelectorAll('button,summary')].filter((b) => !b.disabled && b.getClientRects().length);
    const first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && [first, node('deploy-heading')].includes(document.activeElement)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (deploy) { render(); openDeployment(); } else load();
}

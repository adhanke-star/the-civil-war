// Completed-army camp. Explicit imports and depot exchanges share the authoritative save seam. A campaign camp also has
// the Requisition drawer (src/franchise/economy.js: reputation track, this phase's stock, buy and turn-in with a confirm,
// each written through the store's compare-and-set exchange) and plays the level-up moment when a turn-in reaches a level.
// Badges (src/franchise/badges.js): each campaign brigade card shows its kept badges as buttons; one opens the badge's
// detail (the feat, tiers and effect, labelled game rules, apart from the real example with its provenance and source
// links). A brigade with more badges than slots shows "Choose badges to keep": a keyboard dialog of checkboxes (the X-Factor
// fixed) written through the same compare-and-set exchange (campaign.js chooseBadges); Cancel or Escape changes nothing.
// Camp (P5c): "Camp orders and stores" sets one standing order per brigade (src/franchise/camp-orders.js) and shows the
// stores and depot capacity; the Requisition drawer also sells stores, army upgrades, training, extra badge slots and affix
// re-rolls (src/franchise/economy.js), each behind a confirm and the same compare-and-set exchange. Next (and Replay) first
// deal the phase's decision cards (src/franchise/decisions.js), one at a time in a keyboard dialog that reveals what really
// happened after the choice is saved, then march the army out of camp (breakCamp, once per phase attempt) and load the
// field. Record book and Settings open modules other screens own (src/ui/records.js, src/ui/settings-panel.js); a
// missing module only disables its button.
// Art (P6b, src/ui/art.js): the title stands on a living backdrop (Homer's "Home, Sweet Home", 1863: a very slow pan and a
// drifting campfire smoke layer, both CSS-composited, paused while the tab is hidden and static under reduced motion); the
// camp shows a period view of the campaign's current battle with its caption and source, and a trophy shelf drawn from the
// save: captured guns and arms (items whose source is capture), the wagons in the stores (one icon each up to a cap, then
// ×N) and the reputation level. Campaign brigade cards carry their commander's period portrait or the generic silhouette.
// P5d: New campaign offers Recruit / Veteran / General (src/franchise/tuning.js DIFFICULTY; Veteran checked) above the slots
// and starts the campaign at the chosen level; the camp names the campaign's level; the Battles list has its own choice,
// carried on each phase link as ?difficulty= (none for Veteran). The trophy shelf also lists the regiment colours the army
// took (save `trophies.colours`), and the camp's notes say where camp orders, training, shortages and pioneers reach the battle.
// Sandbox battle (src/sim/sandbox-battle.js): below the battle sections, a field, a Union and a Confederate roster (from the pack
// summaries) and the attacker; the Battles list's Command and Difficulty apply; the Fight link's address follows every change.
import { createProgressStore, parseSnapshot, exportSnapshot, exchangeDepot, listSlots, MAX_SAVE_BYTES } from '../franchise/save.js';
import { newCampaign, chooseBadges, campaignPhase, campaignDifficulty } from '../franchise/campaign.js';
import { DIFFICULTY } from '../franchise/tuning.js';
import { BADGE_BY_ID, TIER_NAMES, BADGE_RULES_NOTE, featText, effectText, threshold, categoryName, slotsOf } from '../franchise/badges.js';
import { loadCampaign, loadPackSummary, ladderPosition, formatDate, loadDecisions, rankShort } from './briefing.js';
import { loadArt, backdropArt, whenArt } from './art.js';
import { ORDERS, orderName, orderText, setOrder, breakCamp, campReport, supplyNeed, CAMP_RULES_NOTE, BATTLE_NOTE, shortText } from '../franchise/camp-orders.js';
import { cardsFor, recorded, optionOpen, chooseDecision, historyOf, effectText as decisionEffect, DECISIONS_NOTE } from '../franchise/decisions.js';
import { get } from '../settings.js';
import { brigCard, staticCard, itemLabel, defineRewardSettings, levelUpMoment, badgeChip } from '../reward/sequence.js';
import { shopStock, buyLot, turnInCard, markShopSeen, levelUps, turnInPoints, nextLevelAt, shopTierFor, pendingLevelRewards, pendingLevelRewardReason, ECONOMY, RULES_NOTE, CAMP,
  storesOf, upgradesOf, depotCapacity, buyStores, buyUpgrade, buyTraining, buySlot, trainingOffer, rerollPreview, rerollAffix } from '../franchise/economy.js';
import { TIER_BY_ID, STORE_ITEMS, STORE_BY_ID, VETERANCY, itemDef, conditionEffect } from '../reward/data.js';
import { compare, bestFit } from '../reward/model.js';
import { savedDeployment, assertSavedLaunch } from '../franchise/practice.js';
import { loadFieldScenario, loadBattlePack } from '../sim/phase.js';
import { FIELDS, SANDBOX_PACKS, SANDBOX_NOTE, sandboxBattleHref } from '../sim/sandbox-battle.js';
import { prepareBattleRecordings } from '../audio/bank.js';

const PAGE_SIZE = 12;
const ART_DELAY_MS = 900; // backdrop, portraits and card pictures follow the first render (P6b)
const STYLE = { 'clean modern': 'modern', 'period desk': 'desk', hybrid: 'hybrid' };
// Difficulty in plain words (game rules; src/sim/ai.js and src/game.js apply them). Combat numbers never change with the level.
const DIFFICULTY_TEXT = Object.freeze({
  recruit: 'A slower enemy whose reserves wait for their set time; the battle always pauses on a rout, an arrival or a threatened objective.',
  veteran: 'The enemy as designed; the Auto-pause setting decides when the battle pauses.',
  general: 'A faster enemy that sends its reserves to the threatened point and counter-attacks breakthroughs; the battle never pauses itself.',
});
const DIFFICULTY_NOTE = 'Difficulty changes only how the enemy commands and when the battle pauses: casualties, fire and morale work the same at every level.';
const difficultyName = (level) => DIFFICULTY.names[level] || DIFFICULTY.names.veteran;
/** A Battles-list phase link at a difficulty and side (Veteran and the Union add nothing to the address; src/sim/sides.js). */
const battleHref = (packId, phaseId, level, side) => `./?battle=${encodeURIComponent(packId)}&phase=${encodeURIComponent(phaseId)}${level && level !== 'veteran' ? `&difficulty=${level}` : ''}${side === 'CS' ? '&side=CS' : ''}`;
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
  let activeDeployment = null, disposed = false, shopOpen = false, deck = null, marching = false;
  const pages = { army: 0, depot: 0, orders: 0 };
  const shopPick = { brigadeId: null, bar: 'fire', uid: null };
  const root = document.createElement('main'); root.id = 'front'; root.className = 'rw rw-counts';
  root.dataset.uiStyle = STYLE[get('screens.cardStyle')] || 'modern';
  root.innerHTML = `
    <div id="entry-backdrop" class="entry-backdrop" aria-hidden="true" hidden><div class="entry-backdrop-img"></div><div class="entry-smoke"><i></i><i></i><i></i><i></i><i></i></div><div class="entry-scrim"></div></div>
    <div class="entry-wrap">
      <header class="entry-head"><a href="./" class="entry-brand">The Civil War</a><p>One army. One war.</p><button id="entry-settings" type="button">Settings</button></header>
      <section id="entry-title" aria-labelledby="entry-title-heading">
        <p class="rw-eyebrow">Take the field</p><h1 id="entry-title-heading">Your first command</h1>
        <p id="entry-note"></p>
        <div class="entry-title-actions"><button id="entry-campaign-continue" class="entry-primary" type="button" aria-describedby="entry-campaign-slot" hidden>Continue</button><button id="entry-new-campaign" type="button" hidden>New campaign</button><button id="entry-battles" type="button" aria-expanded="false" aria-controls="entry-battle-list" hidden>Battles</button><button id="entry-continue" class="entry-primary" type="button">Continue</button></div>
        <p id="entry-campaign-slot" hidden></p>
        <section id="entry-battle-list" aria-labelledby="entry-battles-heading" hidden><h2 id="entry-battles-heading" tabindex="-1">Battles</h2><p class="entry-note">Every built phase with its historical armies. No loot, and your campaign army is not changed.</p><p class="entry-battles-difficulty"><label for="entry-battles-difficulty">Difficulty</label><select id="entry-battles-difficulty"><option value="recruit">Recruit</option><option value="veteran" selected>Veteran</option><option value="general">General</option></select></p><p class="entry-battles-difficulty"><label for="entry-battles-side">Command</label><select id="entry-battles-side"><option value="US" selected>Union</option><option value="CS">Confederate</option></select></p><p class="entry-note" id="entry-battles-difficulty-note"></p><p id="entry-battles-status" role="status"></p><div id="entry-battle-rows"></div><section id="entry-sandbox" class="entry-sandbox" aria-labelledby="entry-sandbox-heading"><h3 id="entry-sandbox-heading">Sandbox battle</h3><p class="entry-note" id="entry-sandbox-note">${SANDBOX_NOTE}</p><p id="entry-sandbox-status" role="status"></p><div id="entry-sandbox-controls" hidden><p class="entry-battles-difficulty"><label for="entry-sandbox-field">Field</label><select id="entry-sandbox-field"></select></p><p class="entry-battles-difficulty"><label for="entry-sandbox-us">Union army</label><select id="entry-sandbox-us"></select></p><p class="entry-battles-difficulty"><label for="entry-sandbox-cs">Confederate army</label><select id="entry-sandbox-cs"></select></p><p class="entry-battles-difficulty"><label for="entry-sandbox-attacker">Attacker</label><select id="entry-sandbox-attacker"><option value="US" selected>Union</option><option value="CS">Confederate</option></select></p><p class="entry-sandbox-fight"><a id="entry-sandbox-fight" class="entry-primary" href="./">Fight</a></p></div></section></section>
      </section>
      <section id="entry-camp" aria-labelledby="entry-camp-heading" hidden>
        <header class="entry-camp-head"><div><p class="rw-eyebrow">Between battles</p><h1 id="entry-camp-heading">Your army</h1><p id="entry-summary"></p></div>
          <div class="entry-field-actions"><button id="camp-begin-campaign" class="entry-primary" type="button" hidden>Begin the campaign</button><button id="camp-deploy" class="entry-primary" type="button" aria-describedby="camp-deploy-note">Deploy saved army</button><a id="camp-practice" class="entry-secondary" href="./?intro">Practice again</a><button id="camp-record-book" type="button" hidden>Record book</button></div></header>
        <p class="entry-note" id="camp-deploy-note" hidden>Deploy saved army is for practice armies. Campaign brigades fight only in their own campaign phases, so their losses and loot stay on the record.</p>
        <p class="entry-note" id="camp-field-note">Deploy fights with your saved formations and equipment; actual losses return here. Practice again starts the original teaching formations and asks before replacing your army.</p>
        <section id="camp-campaign" aria-labelledby="camp-campaign-heading" hidden>
          <p class="rw-eyebrow" id="camp-campaign-position"></p><h2 id="camp-campaign-heading" tabindex="-1"></h2>
          <p id="camp-complete" hidden></p><p id="camp-campaign-note"></p><p id="camp-difficulty"></p>
          <div class="entry-field-actions"><a id="camp-next" class="entry-primary" href="./">Next</a><a id="camp-replay" class="entry-secondary" href="./" hidden>Replay</a></div>
          <p id="camp-march-status" role="status" tabindex="-1"></p>
          <div id="camp-decisions" hidden><h3 id="camp-decisions-heading">Decisions for the next phase</h3><ul id="camp-decisions-list" aria-labelledby="camp-decisions-heading"></ul></div>
          <h3 id="camp-record-heading">Record so far</h3><p id="camp-record-empty">No phase fought yet.</p><ol id="camp-record" aria-labelledby="camp-record-heading"></ol>
        </section>
        <section id="camp-orders" aria-labelledby="camp-orders-heading" hidden>
          <h2 id="camp-orders-heading" tabindex="-1">Camp orders and stores</h2><p class="entry-note" id="camp-orders-note"></p>
          <div id="camp-stores" role="list" aria-label="Army stores"></div><p id="camp-supply"></p><p id="camp-capacity"></p>
          <p id="camp-orders-status" role="status" tabindex="-1"></p>
          <div id="camp-order-rows" role="list" aria-label="Brigade orders"></div><div id="order-pages" class="entry-pages"></div>
        </section>
        <section id="camp-shop" aria-labelledby="camp-shop-heading" hidden>
          <div class="camp-shop-head"><div><h2 id="camp-shop-heading" tabindex="-1">Requisition</h2><p id="camp-reputation"></p><p id="camp-level-pending" role="status" hidden></p>
            <div id="camp-rep-track" class="rw-rep-track" role="progressbar"><i></i></div><p id="camp-shop-new" hidden></p></div>
            <button id="camp-shop-toggle" type="button" aria-expanded="false" aria-controls="camp-shop-drawer">Open Requisition</button></div>
          <div id="camp-shop-drawer" hidden><p class="entry-note" id="camp-shop-note"></p><p id="camp-shop-status" role="status" tabindex="-1"></p>
            <div id="camp-shop-stock" role="list" aria-label="Requisition stock"></div><div id="camp-shop-more"></div></div>
        </section>
        <section id="camp-trophies" aria-labelledby="camp-trophies-heading"><h2 id="camp-trophies-heading">Trophy shelf</h2><div id="camp-shelf" role="list" aria-label="Trophies and train"></div></section>
        <section aria-labelledby="camp-army-heading"><h2 id="camp-army-heading">Brigades</h2><div id="camp-army" class="rw-brigs is-static" role="list" aria-label="Saved brigades"></div><div id="army-pages" class="entry-pages"></div></section>
        <section aria-labelledby="camp-depot-heading"><h2 id="camp-depot-heading" tabindex="-1">Depot</h2><p id="depot-note"></p><div id="camp-depot" role="list" aria-label="Saved depot"></div><div id="depot-pages" class="entry-pages"></div></section>
      </section>
      <dialog id="slot-picker" aria-labelledby="slot-picker-heading" aria-describedby="slot-picker-note"><h2 id="slot-picker-heading" tabindex="-1">New campaign: choose a save slot</h2><p id="slot-picker-note">Each slot keeps one army. The campaign autosaves between phases and in camp.</p><fieldset id="slot-difficulty" aria-describedby="slot-difficulty-note"><legend>Difficulty</legend>${DIFFICULTY.levels.map((l) => `<label class="slot-difficulty-choice"><input type="radio" name="slot-difficulty" id="slot-difficulty-${l}" value="${l}"${l === 'veteran' ? ' checked' : ''}><span><b>${difficultyName(l)}</b> ${DIFFICULTY_TEXT[l]}</span></label>`).join('')}<p class="entry-note" id="slot-difficulty-note">${DIFFICULTY_NOTE} The level stays with the campaign.</p></fieldset><div id="slot-rows" role="group" aria-label="Save slots"></div><p id="slot-picker-status" role="status"></p><div class="camp-compare-actions"><button id="slot-picker-cancel" type="button">Cancel</button></div></dialog>
      <dialog id="slot-overwrite" role="alertdialog" aria-labelledby="slot-overwrite-heading" aria-describedby="slot-overwrite-note"><h2 id="slot-overwrite-heading">Overwrite this slot?</h2><p id="slot-overwrite-note"></p><div class="camp-compare-actions"><button id="slot-overwrite-cancel" type="button">Cancel</button><button id="slot-overwrite-confirm" type="button">Overwrite</button></div></dialog>
      <dialog id="camp-confirm" role="alertdialog" aria-labelledby="camp-confirm-heading" aria-describedby="camp-confirm-note"><h2 id="camp-confirm-heading" tabindex="-1"></h2><p id="camp-confirm-note"></p><div class="camp-compare-actions"><button id="camp-confirm-cancel" type="button">Cancel</button><button id="camp-confirm-ok" type="button"></button></div></dialog>
      <section class="entry-transfer" aria-label="Army transfer"><p id="entry-status" role="status"></p><button id="entry-export" type="button" disabled>Export army</button><button id="entry-export-saved" type="button" hidden>Export displayed saved army</button><button id="entry-import" type="button">Import army</button><button id="entry-retry" type="button" hidden>Retry loading</button><button id="entry-discard-exchange" type="button" hidden>Discard pending exchange and reload</button><input id="entry-file" type="file" accept=".json,application/json" hidden></section>
      <nav class="entry-modes" aria-label="Other ways to play"><a href="./?practice">Henry Hill practice</a><a href="./?battle=henry-hill">Historical battle</a><a href="./?sandbox">Sandbox</a><a href="./reward.html">Reward workbench</a></nav>
      <p class="entry-note">Practice formations, rewards and ratings are game values. The historical battle is available separately.</p>
      <p id="entry-backdrop-caption" class="entry-backdrop-caption" hidden></p>
    </div>
    <dialog id="entry-replace" aria-labelledby="entry-replace-heading" aria-describedby="entry-replace-note"><h2 id="entry-replace-heading">Replace saved army?</h2><p id="entry-replace-note">Import replaces your army and depot with this completed export. Export first to keep your current army.</p><button id="entry-cancel" type="button">Cancel</button><button id="entry-confirm" type="button">Import and replace</button></dialog>
    <dialog id="camp-compare" aria-labelledby="camp-compare-heading" aria-describedby="camp-compare-item">
      <h2 id="camp-compare-heading" tabindex="-1">Compare and issue</h2><p id="camp-compare-item"></p><p id="camp-recommendation"></p>
      <label for="camp-recipient">Issue to</label><select id="camp-recipient"></select><p id="camp-recipient-name"></p>
      <div id="camp-ratings"></div><p id="camp-exchange-note" role="status"></p>
      <div class="camp-compare-actions"><button id="camp-compare-cancel" type="button">Cancel</button><button id="camp-issue" type="button">Issue and save</button></div>
    </dialog>
    <dialog id="camp-badge" aria-labelledby="camp-badge-heading">
      <h2 id="camp-badge-heading" tabindex="-1"></h2><p id="camp-badge-brigade"></p>
      <section aria-labelledby="camp-badge-rule-heading"><h3 id="camp-badge-rule-heading">The feat and its effect <span class="rw-rule-tag">Game rule</span></h3><p id="camp-badge-feat"></p><p id="camp-badge-effect"></p><p id="camp-badge-tiers"></p></section>
      <section aria-labelledby="camp-badge-history-heading"><h3 id="camp-badge-history-heading">The real example <span class="rw-rule-tag" id="camp-badge-provenance"></span></h3>
        <p id="camp-badge-unit"></p><p id="camp-badge-event"></p><p id="camp-badge-text"></p><p id="camp-badge-sources-label">Sources</p><ul id="camp-badge-sources" aria-labelledby="camp-badge-sources-label"></ul></section>
      <div class="camp-compare-actions"><button id="camp-badge-close" type="button">Close</button></div>
    </dialog>
    <dialog id="camp-choose" aria-labelledby="camp-choose-heading" aria-describedby="camp-choose-note">
      <h2 id="camp-choose-heading" tabindex="-1"></h2><p id="camp-choose-note"></p>
      <fieldset id="camp-choose-set"><legend id="camp-choose-legend">Badges to keep</legend><div id="camp-choose-rows"></div></fieldset><p id="camp-choose-status" role="status"></p>
      <div class="camp-compare-actions"><button id="camp-choose-cancel" type="button">Cancel</button><button id="camp-choose-save" type="button">Keep these and save</button></div>
    </dialog>
    <dialog id="camp-decision" aria-labelledby="camp-decision-heading" aria-describedby="camp-decision-dilemma">
      <p class="rw-eyebrow" id="camp-decision-count"></p><h2 id="camp-decision-heading" tabindex="-1"></h2><p id="camp-decision-dilemma"></p>
      <fieldset id="camp-decision-set"><legend>Your choice <span class="rw-rule-tag">Game rule</span></legend><div id="camp-decision-options"></div></fieldset>
      <p id="camp-decision-status" role="status"></p>
      <section id="camp-decision-reveal" aria-labelledby="camp-decision-reveal-heading" hidden><h3 id="camp-decision-reveal-heading" tabindex="-1">What really happened <span class="rw-rule-tag" id="camp-decision-provenance"></span></h3>
        <p id="camp-decision-history"></p><p id="camp-decision-match"></p><p id="camp-decision-sources-label">Sources</p><ul id="camp-decision-sources" aria-labelledby="camp-decision-sources-label"></ul></section>
      <p class="entry-note" id="camp-decision-note"></p>
      <div class="camp-compare-actions"><button id="camp-decision-cancel" type="button">Stay in camp</button><button id="camp-decision-choose" type="button">Choose and save</button><button id="camp-decision-continue" class="entry-primary" type="button" hidden>Continue</button></div>
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
    root.querySelectorAll('.camp-choose-button').forEach((b) => { b.disabled = importing || !!pendingImport || !!pendingExchange; });
    root.querySelectorAll('.camp-turnin-button, .camp-buy-button').forEach((b) => { b.disabled = importing || !!pendingImport || !!pendingExchange || b.dataset.blocked === 'true'; });
    node('camp-shop-toggle').disabled = importing || !!pendingImport || !!pendingExchange;
    root.querySelectorAll('.camp-order-select, .camp-shop-select').forEach((n) => { n.disabled = importing || !!pendingImport || !!pendingExchange; });
    node('camp-record-book').disabled = importing || node('camp-record-book').dataset.missing === 'true';
    node('entry-settings').disabled = node('entry-settings').dataset.missing === 'true';
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
    // One obvious Continue (DESIGN 4b): the latest campaign, else the first fight/practice camp; New campaign stays secondary.
    node('entry-new-campaign').className = 'entry-secondary';
    node('entry-continue').className = recent ? 'entry-secondary' : 'entry-primary';
    node('entry-continue').textContent = recent ? 'Practice: Henry House Hill' : 'Continue';
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
    node('camp-record-book').hidden = !v2;
    node('camp-field-note').hidden = v2;
    // A practice army's camp leads on into the campaign (DESIGN 4b First minute: camp, then the battles).
    node('camp-begin-campaign').hidden = v2 || !ladder;
    node('camp-deploy').className = !v2 && ladder ? 'entry-secondary' : 'entry-primary';
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
    const level = campaignDifficulty(saved);
    node('camp-difficulty').textContent = `Difficulty: ${difficultyName(level)}. ${DIFFICULTY_TEXT[level]} ${DIFFICULTY_NOTE}`;
    node('camp-difficulty').dataset.difficulty = level;
    renderDecisionStrip(known && !complete ? ladder.def.phases[c.index] : null);
    node('camp-record-empty').hidden = c.history.length > 0; node('camp-record').hidden = !c.history.length;
    node('camp-record').replaceChildren(...c.history.map((r) => {
      const li = document.createElement('li'); li.dataset.grade = r.grade; if (r.replay) li.dataset.replay = 'true';
      li.textContent = `${titleOf(r.packId, r.phaseId)}: ${r.grade}${r.replay ? ' (replay)' : ''} · Union losses ${r.lossesUS.toLocaleString()} · Confederate losses ${r.lossesCS.toLocaleString()}`;
      return li;
    }));
  }
  // ---- Requisition (campaign saves; amounts are game rules in src/franchise/tuning.js) ----
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = (ym) => (/^\d{4}-\d{2}/.test(ym || '') ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
  /** The shop's date: the next phase's (the last phase's once the campaign is complete); null until its pack is loaded. */
  function shopDate() {
    if (!saved || saved.version !== 2 || !ladder || ladder.def.id !== saved.campaign.id) return null;
    const phases = ladder.def.phases, entry = phases[Math.min(saved.campaign.index, phases.length - 1)];
    return titles.get(entry.packId)?.phases.find((p) => p.id === entry.phaseId)?.date ?? null;
  }
  const shopStatus = (text) => { node('camp-shop-status').textContent = text; };
  function renderShop() {
    const v2 = saved.version === 2;
    node('camp-shop').hidden = !v2;
    if (!v2) { shopOpen = false; return; }
    const next = nextLevelAt(saved.level), from = ECONOMY.levels[saved.level - 1], track = node('camp-rep-track');
    const pending=pendingLevelRewards(saved);
    node('camp-reputation').textContent = `Reputation ${saved.reputation.toLocaleString()} · Level ${saved.level} of ${ECONOMY.levels.length} · ${pending ? `rewards earned through level ${saved.level + pending}` : next === null ? 'top level' : `next level at ${next.toLocaleString()}`} · ${saved.rp.toLocaleString()} points to spend`;
    const pendingNotice=node('camp-level-pending'),reason=pendingLevelRewardReason(saved);pendingNotice.hidden=!pending;
    const prefix=`${pending} level reward${pending===1?'':'s'} pending.`;
    pendingNotice.textContent=!pending?'':reason==='depot'?`${prefix} Turn in a card to free a depot slot; delivery also requires room in the save.`:reason==='size'?`${prefix} This save has reached its size limit. Your army and earned reputation are preserved.`:`${prefix} Reload the camp to retry delivery.`;
    track.hidden = next === null;
    if (next !== null) {
      track.setAttribute('aria-label', pending ? `Level ${saved.level + 1} reward delivery pending` : `Reputation toward level ${saved.level + 1}`);
      track.setAttribute('aria-valuemin', String(from)); track.setAttribute('aria-valuemax', String(next)); track.setAttribute('aria-valuenow', String(Math.max(from,Math.min(next,saved.reputation))));
      track.setAttribute('aria-valuetext',`${saved.reputation.toLocaleString()} reputation${pending?`; rewards earned through level ${saved.level + pending}; ${pending} reward${pending===1?'':'s'} pending`:''}`);
      track.firstElementChild.style.width = `${Math.max(0, Math.min(100, Math.round(100 * (saved.reputation - from) / (next - from))))}%`;
    }
    node('camp-shop-new').hidden = saved.shopSeen >= saved.level;
    node('camp-shop-new').textContent = `New: reputation level ${saved.level}. The shop stocks up to ${TIER_BY_ID[shopTierFor(saved.level)].name} arms.`;
    const toggle = node('camp-shop-toggle'); toggle.setAttribute('aria-expanded', String(shopOpen));
    toggle.textContent = shopOpen ? 'Close Requisition' : 'Open Requisition';
    node('camp-shop-drawer').hidden = !shopOpen;
    const grid = node('camp-shop-stock'); grid.replaceChildren();
    renderCampShop();
    if (!shopOpen) return;
    const date = shopDate();
    let stock = null;
    if (!date) node('camp-shop-note').textContent = 'The shop needs the next phase\'s date, which could not be loaded. Reload the camp to try again. Your army is unchanged.';
    else {
      try { stock = shopStock(saved, { date }); } catch (err) { node('camp-shop-note').textContent = `${err.message} Your army is unchanged.`; }
    }
    if (!stock) return;
    node('camp-shop-note').textContent = `Stock for the phase of ${monthName(date)}: up to ${ECONOMY.shopSize} arms that were in service by the next phase, up to ${TIER_BY_ID[shopTierFor(saved.level)].name} rarity at your level. Purchases go to the depot. ${RULES_NOTE} First-issue months are cited on each lot; captured-only arms are never stocked.`;
    if (!stock.length) { const p = document.createElement('p'); p.textContent = 'Nothing is in stock for this phase.'; grid.append(p); return; }
    for (const lot of stock) {
      const def = itemDef(lot.itemId), cell = document.createElement('div'); cell.setAttribute('role', 'listitem'); cell.className = 'camp-lot'; cell.dataset.lot = lot.itemId;
      const card = staticCard({ ...lot, from: `In service from ${monthName(def.from)} (${def.fromProvenance})` }); card.setAttribute('role', 'group');
      const cite = document.createElement('p'); cite.className = 'camp-lot-cite'; cite.append(`${def.fromBasis} Sources: `);
      def.sources.forEach((href, i) => {
        const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = new URL(href).hostname.replace(/^www\./, '');
        cite.append(...(i ? ['; ', a] : [a]));
      });
      const buy = document.createElement('button'); buy.type = 'button'; buy.className = 'camp-buy-button';
      const short = saved.rp < lot.price;
      buy.dataset.blocked = String(lot.sold || short);
      buy.textContent = lot.sold ? 'Bought' : short ? `Needs ${lot.price} points` : `Buy for ${lot.price} points`;
      buy.setAttribute('aria-label', `${lot.sold ? 'Bought' : `Buy ${itemLabel(lot)} for ${lot.price} requisition points`}${!lot.sold && short ? `; you have ${saved.rp}` : ''}`);
      buy.disabled = importing || !!pendingImport || !!pendingExchange || lot.sold || short;
      buy.addEventListener('click', () => openBuy(lot, buy));
      cell.append(card, cite, buy); grid.append(cell);
    }
  }
  // ---- camp orders and stores (src/franchise/camp-orders.js; numbers are game rules in tuning.js CAMP) ----
  const fieldable = (b) => b.men > 0 && (b.kind !== 'battery' || b.guns > 0);
  const vetName = (id) => VETERANCY.find((v) => v.id === id)?.name ?? id;
  const say = (id) => (text) => { node(id).textContent = text; };
  /** The next phase's fielded franchise brigades (from its battle pack), or null until the pack summary is loaded. */
  function nextFielded() {
    if (!saved || saved.version !== 2 || !ladder || ladder.def.id !== saved.campaign.id || saved.campaign.status === 'complete') return null;
    const entry = ladder.def.phases[saved.campaign.index], us = titles.get(entry.packId)?.phases.find((p) => p.id === entry.phaseId)?.us;
    if (!us) return null;
    const ids = new Set(us), brigades = entry.loan ? [] : saved.army.filter((b) => b.unitId && ids.has(b.unitId) && fieldable(b));
    return { loan: entry.loan === true, brigades, batteries: brigades.filter((b) => b.kind === 'battery').length };
  }
  function renderOrders() {
    const v2 = saved.version === 2;
    node('camp-orders').hidden = !v2;
    if (!v2) return;
    const st = storesOf(saved);
    node('camp-orders-note').textContent = `One standing order per brigade, carried out when the army marches out of camp for the next phase (Next). ${ORDERS.map((o) => `${orderName(o)}: ${orderText(o)}.`).join(' ')} Fielded brigades draw stores for each phase; a brigade its stores cannot cover starts that phase with less morale. ${BATTLE_NOTE} ${CAMP_RULES_NOTE}`;
    node('camp-stores').replaceChildren(...STORE_ITEMS.map((x) => {
      const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'camp-store'; row.dataset.store = x.id;
      const name = document.createElement('b'); name.textContent = `${x.name}: ${st[x.id].toLocaleString()}`;
      const words = document.createElement('span'); words.textContent = ` ${x.words} ${shortText(x.id) || x.short}`;
      row.append(name, words); return row;
    }));
    const f = nextFielded();
    if (!f) node('camp-supply').textContent = saved.campaign.status === 'complete' ? 'The campaign is complete; no phase draws stores.' : 'The next phase\'s formations are still loading.';
    else if (f.loan) node('camp-supply').textContent = `Next phase: the army on loan fights; your brigades draw nothing. The quartermaster's issue still arrives when you march (${CAMP.stores.filter((k) => CAMP.issue[k]).map((k) => `+${CAMP.issue[k]} ${STORE_BY_ID[k].name.toLowerCase()}`).join(', ')}).`;
    else {
      const need = supplyNeed(saved, f.brigades.length, f.batteries), have = Object.fromEntries(CAMP.stores.map((k) => [k, st[k] + CAMP.issue[k]]));
      const short = Object.keys(need).filter((k) => need[k] > have[k]);
      node('camp-supply').textContent = `Next phase: ${f.brigades.length} of your brigades take the field (${f.batteries} batter${f.batteries === 1 ? 'y' : 'ies'}). With the quartermaster's issue they draw ${Object.keys(need).filter((k) => need[k]).map((k) => `${need[k]} ${STORE_BY_ID[k].name.toLowerCase()}`).join(', ')}${short.length ? `. Short: ${short.map((k) => `${STORE_BY_ID[k].name.toLowerCase()} (${have[k]} of ${need[k]})`).join(', ')}; buy more in the Requisition drawer or some brigades start with less morale and carry the shortage into battle (game rule).` : '. Enough for every brigade (Target practice also spends ammunition).'}`;
    }
    const cap = depotCapacity(saved), owned = upgradesOf(saved);
    node('camp-capacity').textContent = `Depot: ${saved.depot.length} of ${cap} cards (${st.wagons} wagons × ${CAMP.cardsPerWagon}${owned.includes('wagons') ? ` + ${CAMP.upgrades.wagons.cards} from the Wagons upgrade` : ''}).${saved.depot.length >= cap ? ' Full: purchases wait until a card is issued or turned in, or more wagons are bought. Loot is never refused.' : ''}`;
    const living = saved.army.filter((b) => b.unitId && fieldable(b));
    paged(living, node('camp-order-rows'), node('order-pages'), (b, i) => {
      const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'camp-order-row'; row.dataset.brigadeId = b.id;
      const label = document.createElement('label'); label.htmlFor = `camp-order-${i}`; label.textContent = b.label;
      const select = document.createElement('select'); select.id = `camp-order-${i}`; select.className = 'camp-order-select'; select.dataset.brigadeId = b.id;
      for (const o of ORDERS) { const opt = document.createElement('option'); opt.value = o; opt.textContent = orderName(o); select.append(opt); }
      select.value = b.order || 'rest';
      select.disabled = importing || !!pendingImport || !!pendingExchange;
      select.addEventListener('change', () => changeOrder(b.id, select.value));
      const meta = document.createElement('span'); meta.className = 'camp-order-meta';
      const bonus = b.bonus ? ['fire', 'melee', 'morale', 'drill'].filter((k) => b.bonus[k]).map((k) => `${k[0].toUpperCase()}${k.slice(1)} +${b.bonus[k]}`) : [];
      meta.textContent = `${vetName(b.vet)}${b.drilled ? ` · ${b.drilled} drill${b.drilled === 1 ? '' : 's'}` : ''}${bonus.length ? ` · camp ${bonus.join(', ')}` : ''}${b.extraSlot ? ' · extra badge slot' : ''}`;
      row.append(label, select, meta); return row;
    }, 'orders', 'orders');
  }
  async function changeOrder(brigadeId, order) {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    const b = saved.army.find((x) => x.id === brigadeId);
    await runEconomy(setOrder, { brigadeId, order }, () => `${b.label}: ${orderName(order)} (${orderText(order)}). Saved; carried out when the army marches.`, say('camp-orders-status'));
    const again = node('camp-order-rows').querySelector(`select[data-brigade-id="${CSS.escape(brigadeId)}"]`);
    (again || node('camp-orders-status')).focus();
  }
  // ---- Requisition drawer: stores, army upgrades, training, extra badge slots, affix re-rolls ----
  const UPGRADE_NAMES = Object.freeze({ wagons: 'Wagons', ambulances: 'Ambulances', ordnance: 'Ordnance train', pioneers: 'Pioneers' });
  const upgradeText = (id) => ({
    wagons: `+${CAMP.upgrades.wagons.cards} depot cards.`,
    ambulances: `${Math.round(CAMP.upgrades.ambulances.returned * 100)}% of each phase's losses in your brigades return to the ranks.`,
    ordnance: `Ammunition drawn and spent on Target practice × ${CAMP.upgrades.ordnance.factor} (rounded up).`,
    pioneers: `Your brigades and batteries march through woods at ${Math.round(CAMP.upgrades.pioneers.woods * 100)}% pace instead of 70%. Streams and fords do not slow troops in this version, so the upgrade gains nothing there.`,
  })[id];
  function shopButton(text, label, blocked, onClick) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'camp-buy-button'; b.textContent = text; b.setAttribute('aria-label', label);
    b.dataset.blocked = String(!!blocked); b.disabled = importing || !!pendingImport || !!pendingExchange || !!blocked;
    b.addEventListener('click', () => onClick(b)); return b;
  }
  const h3 = (id, text) => { const h = document.createElement('h3'); h.id = id; h.textContent = text; h.tabIndex = -1; return h; };
  const para = (text, cls) => { const p = document.createElement('p'); p.textContent = text; if (cls) p.className = cls; return p; };
  function shopSelect(id, label, options, value, onChange) {
    const wrap = document.createElement('div'); wrap.className = 'camp-shop-field';
    const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    const sel = document.createElement('select'); sel.id = id; sel.className = 'camp-shop-select';
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
    if (options.some(([v]) => v === value)) sel.value = value;
    sel.disabled = importing || !!pendingImport || !!pendingExchange;
    sel.addEventListener('change', () => { onChange(sel.value); renderCampShop(); node(id).focus(); });
    wrap.append(l, sel); return wrap;
  }
  function renderCampShop() {
    const more = node('camp-shop-more'); more.replaceChildren();
    if (!shopOpen || !saved || saved.version !== 2) return;
    const st = storesOf(saved), owned = upgradesOf(saved), busy = importing || !!pendingImport || !!pendingExchange;
    // Stores
    const stores = document.createElement('section'); stores.setAttribute('aria-labelledby', 'camp-buy-stores-heading');
    const rows = document.createElement('div'); rows.className = 'camp-shop-rows'; rows.setAttribute('role', 'list'); rows.setAttribute('aria-label', 'Stores for sale');
    for (const x of STORE_ITEMS) {
      const lot = CAMP.storeLots[x.id], row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'camp-shop-row'; row.dataset.store = x.id;
      row.append(para(`${x.name}: you have ${st[x.id]}. ${lot.qty} for ${lot.price} points.`),
        shopButton(saved.rp < lot.price ? `Needs ${lot.price} points` : `Buy ${lot.qty} for ${lot.price} points`, `Buy ${lot.qty} ${x.name.toLowerCase()} for ${lot.price} requisition points`, saved.rp < lot.price,
          (b) => openPurchase(b, { heading: `Buy ${lot.qty} ${x.name.toLowerCase()}?`, ok: `Buy for ${lot.price} points`,
            note: `${lot.qty} ${x.name.toLowerCase()} for ${lot.price} requisition points (you have ${saved.rp}). ${x.words} Quantities and prices are game rules.` },
          buyStores, { store: x.id }, (next) => `Bought ${lot.qty} ${x.name.toLowerCase()}; ${storesOf(next)[x.id]} in store, ${next.rp} points left.`)));
      rows.append(row);
    }
    stores.append(h3('camp-buy-stores-heading', 'Stores'), rows);
    // Army upgrades
    const ups = document.createElement('section'); ups.setAttribute('aria-labelledby', 'camp-upgrades-heading');
    const urows = document.createElement('div'); urows.className = 'camp-shop-rows'; urows.setAttribute('role', 'list'); urows.setAttribute('aria-label', 'Army upgrades');
    for (const id of Object.keys(CAMP.upgrades)) {
      const u = CAMP.upgrades[id], have = owned.includes(id), locked = saved.level < u.level, short = saved.rp < u.price;
      const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'camp-shop-row'; row.dataset.upgrade = id;
      row.append(para(`${UPGRADE_NAMES[id]}: ${upgradeText(id)} ${have ? 'Owned.' : locked ? `Opens at reputation level ${u.level}.` : `${u.price} points, once.`}`),
        shopButton(have ? 'Owned' : locked ? `Opens at level ${u.level}` : short ? `Needs ${u.price} points` : `Buy for ${u.price} points`,
          have ? `${UPGRADE_NAMES[id]} owned` : `Buy the ${UPGRADE_NAMES[id]} upgrade for ${u.price} requisition points`, have || locked || short,
          (b) => openPurchase(b, { heading: `Buy the ${UPGRADE_NAMES[id]} upgrade?`, ok: `Buy for ${u.price} points`,
            note: `${upgradeText(id)} It costs ${u.price} requisition points (you have ${saved.rp}) and is bought once for the whole army. A game rule.` },
          buyUpgrade, { id }, (next) => `The army has the ${UPGRADE_NAMES[id]} upgrade; ${next.rp} points left.`)));
      urows.append(row);
    }
    ups.append(h3('camp-upgrades-heading', 'Army upgrades'), urows);
    // Training and extra badge slots
    const living = saved.army.filter((b) => b.unitId && fieldable(b));
    if (!living.some((b) => b.id === shopPick.brigadeId)) shopPick.brigadeId = living[0]?.id ?? null;
    const train = document.createElement('section'); train.setAttribute('aria-labelledby', 'camp-train-heading');
    train.append(h3('camp-train-heading', 'Brigade training and badge slots'));
    if (!living.length) train.append(para('No brigade has men left to train.'));
    else {
      const b = living.find((x) => x.id === shopPick.brigadeId), offer = trainingOffer(saved, { brigadeId: b.id, bar: shopPick.bar });
      const tLocked = saved.level < CAMP.training.level, sLocked = saved.level < CAMP.extraSlot.level, bar = shopPick.bar[0].toUpperCase() + shopPick.bar.slice(1);
      train.append(shopSelect('camp-train-brigade', 'Brigade', living.map((x) => [x.id, x.label]), b.id, (v) => { shopPick.brigadeId = v; }),
        shopSelect('camp-train-bar', 'Card bar', [['fire', 'Fire'], ['melee', 'Melee'], ['morale', 'Morale'], ['drill', 'Drill']], shopPick.bar, (v) => { shopPick.bar = v; }),
        para(`Training adds up to ${CAMP.training.points} points to one card bar for ${CAMP.training.price} points (less when the camp limit of ${CAMP.barCap} per bar leaves less room). ${b.label}'s ${bar} bar has ${b.bonus?.[shopPick.bar] || 0} of ${CAMP.barCap} camp points. ${tLocked ? `Opens at reputation level ${CAMP.training.level}.` : ''} In battle each camp point gives +${CAMP.battle.perPoint}% (Fire: fire effect; Drill: reload and wheeling; Melee: melee; Morale: less morale lost under fire).`, 'entry-note'),
        shopButton(tLocked ? `Opens at level ${CAMP.training.level}` : offer.points <= 0 ? `${bar} is at its camp limit` : saved.rp < offer.price ? `Needs ${offer.price} points` : `Train +${offer.points} ${bar} for ${offer.price} points`,
          `Train ${b.label}: +${offer.points} ${bar} for ${offer.price} requisition points`, tLocked || offer.points <= 0 || saved.rp < offer.price,
          (btn) => openPurchase(btn, { heading: `Train ${b.label}?`, ok: `Train for ${offer.price} points`,
            note: `+${offer.points} ${bar} on ${b.label}'s card, for good, for ${offer.price} requisition points (you have ${saved.rp}). A game rule.` },
          buyTraining, { brigadeId: b.id, bar: shopPick.bar }, (next) => `${b.label} trained: +${offer.points} ${bar}; ${next.rp} points left.`)),
        para(`An extra badge slot lets ${b.label} keep one more badge than its veterancy allows (once per brigade): ${CAMP.extraSlot.price} points. ${sLocked ? `Opens at reputation level ${CAMP.extraSlot.level}.` : ''}`, 'entry-note'),
        shopButton(b.extraSlot ? 'Extra slot bought' : sLocked ? `Opens at level ${CAMP.extraSlot.level}` : saved.rp < CAMP.extraSlot.price ? `Needs ${CAMP.extraSlot.price} points` : `Buy an extra badge slot for ${CAMP.extraSlot.price} points`,
          `Buy an extra badge slot for ${b.label} for ${CAMP.extraSlot.price} requisition points`, b.extraSlot || sLocked || saved.rp < CAMP.extraSlot.price,
          (btn) => openPurchase(btn, { heading: `An extra badge slot for ${b.label}?`, ok: `Buy for ${CAMP.extraSlot.price} points`,
            note: `${b.label} gets ${slotsOf(b) + 1} badge slots instead of ${slotsOf(b)}, for good, for ${CAMP.extraSlot.price} requisition points (you have ${saved.rp}). A game rule.` },
          buySlot, { brigadeId: b.id }, (next) => `${b.label} has an extra badge slot; ${next.rp} points left.`)));
    }
    // Affix re-rolls
    const items = [...saved.army.map((b) => ({ item: b.weapon, where: b.label })), ...saved.depot.map((it) => ({ item: it, where: 'Depot' }))];
    if (!items.some((x) => x.item.uid === shopPick.uid)) shopPick.uid = items[0]?.item.uid ?? null;
    const re = document.createElement('section'); re.setAttribute('aria-labelledby', 'camp-reroll-heading');
    re.append(h3('camp-reroll-heading', 'Re-roll an affix'));
    if (shopPick.uid) {
      const p = rerollPreview(saved, { uid: shopPick.uid });
      re.append(shopSelect('camp-reroll-item', 'Card', items.map((x) => [x.item.uid, `${itemLabel(x.item)} · ${x.where}`]), shopPick.uid, (v) => { shopPick.uid = v; }),
        para(`A re-roll replaces the card's condition affix with a different one, fixed in advance for this campaign: you see the result before you pay. ${CAMP.reroll[p.item.tier]} points for a ${TIER_BY_ID[p.item.tier].name} card. Affixes are game modifiers, not history.`, 'entry-note'),
        shopButton(saved.rp < p.price ? `Needs ${p.price} points` : `Re-roll for ${p.price} points…`, `Re-roll the affix of ${itemLabel(p.item)} for ${p.price} requisition points`, saved.rp < p.price,
          (btn) => openPurchase(btn, { heading: 'Re-roll this affix?', ok: `Re-roll for ${p.price} points`,
            note: `${itemLabel(p.item)} (${p.brigade ? p.brigade.label : 'depot'}). Before: ${p.before.name} (${conditionEffect(p.before)}). After: ${p.after.name} (${conditionEffect(p.after)}). It costs ${p.price} requisition points (you have ${saved.rp}). Game modifier, not history.` },
          rerollAffix, { uid: p.item.uid, to: p.to }, (next) => `${itemDef(p.item.itemId).name} is now ${p.after.name}; ${next.rp} points left.`)));
    } else re.append(para('No card to re-roll.'));
    more.append(stores, ups, train, re);
    if (busy) more.querySelectorAll('button, select').forEach((n) => { n.disabled = true; });
  }
  async function openPurchase(trigger, dialog, rule, command, done) {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    const id = trigger.closest('[data-store],[data-upgrade]') ? null : trigger.closest('section')?.querySelector('h3')?.id;
    const key = trigger.closest('[data-store]')?.dataset.store ?? trigger.closest('[data-upgrade]')?.dataset.upgrade ?? null;
    phase = 'reviewing';
    const ok = await confirmAction(dialog);
    phase = 'idle';
    if (!ok) { trigger.focus(); return; }
    await runEconomy(rule, command, done);
    const back = key ? node('camp-shop-more').querySelector(`[data-store="${key}"] button:not(:disabled), [data-upgrade="${key}"] button:not(:disabled)`)
      : id ? node(id) : null;
    (back || node('camp-shop-status')).focus();
  }
  // ---- decision cards and the march out of camp (Next / Replay) ----
  function renderDecisionStrip(next) {
    const box = node('camp-decisions'), list = node('camp-decisions-list');
    let phaseNow = null;
    try { phaseNow = next && deck ? campaignPhase(saved, ladder.raw) : null; } catch { phaseNow = null; }
    const cards = phaseNow ? cardsFor(deck, phaseNow) : [];
    box.hidden = !cards.length;
    list.replaceChildren(...cards.map((card) => {
      const rec = recorded(saved, phaseNow, card.id), li = document.createElement('li');
      li.textContent = rec ? `${card.title}: you chose “${card.options.find((o) => o.id === rec.optionId)?.label ?? rec.optionId}” (recorded; ${rec.effects.map(decisionEffect).join('; ')}).`
        : `${card.title}: you decide when the army marches (Next).`;
      return li;
    }));
  }
  const decisionDialog = node('camp-decision');
  function decide(card, i, n, phaseNow, replay) {
    return new Promise((resolve) => {
      let chosen = false;
      node('camp-decision-count').textContent = `Decision ${i + 1} of ${n} · before ${titleOf(phaseNow.packId, phaseNow.phaseId)}${phaseNow.replay ? ' · replay: a new choice, marked on the record' : ''}`;
      node('camp-decision-heading').textContent = card.title;
      node('camp-decision-dilemma').textContent = card.dilemma;
      node('camp-decision-note').textContent = DECISIONS_NOTE;
      node('camp-decision-status').textContent = '';
      node('camp-decision-set').hidden = false; node('camp-decision-reveal').hidden = true;
      node('camp-decision-choose').hidden = false; node('camp-decision-continue').hidden = true;
      node('camp-decision-cancel').textContent = 'Stay in camp';
      node('camp-decision-options').replaceChildren(...card.options.map((o, k) => {
        const open = optionOpen(saved, o), label = document.createElement('label'), box = document.createElement('input');
        label.className = 'camp-decision-option'; label.dataset.option = o.id;
        box.type = 'radio'; box.name = 'camp-decision-option'; box.value = o.id; box.id = `camp-decision-option-${k}`; box.disabled = !open.ok;
        const text = document.createElement('span'), name = document.createElement('b');
        name.textContent = o.label;
        text.append(name, para(`Gain: ${o.gain}`), para(`Cost: ${o.cost}`), ...(open.ok ? [] : [para(`Not open: this ${open.reason}.`, 'camp-decision-closed')]));
        label.append(box, text); return label;
      }));
      const finish = (value) => { decisionDialog.removeEventListener('close', onClose); resolve(value); };
      const onClose = () => finish(decisionDialog.returnValue === 'done');
      decisionDialog.addEventListener('close', onClose);
      node('camp-decision-choose').onclick = async () => {
        if (chosen || importing) return;
        const pick = node('camp-decision-options').querySelector('input:checked');
        if (!pick) { node('camp-decision-status').textContent = 'Choose one of the options first (arrow keys move between them).'; node('camp-decision-options').querySelector('input:not(:disabled)')?.focus(); return; }
        const option = card.options.find((o) => o.id === pick.value);
        const ok = await runEconomy(chooseDecision, { campaign: ladder.raw, deck, cardId: card.id, optionId: option.id, replay },
          (next) => `Decision recorded: ${option.label} (${option.effects.map(decisionEffect).join('; ')}); ${next.rp} points to spend.`, say('camp-decision-status'));
        if (!ok) return;
        chosen = true;
        reveal(card, option);
      };
      decisionDialog.returnValue = ''; decisionDialog.showModal(); node('camp-decision-heading').focus();
    });
  }
  function reveal(card, option) {
    const h = historyOf(card);
    node('camp-decision-set').hidden = true; node('camp-decision-choose').hidden = true;
    node('camp-decision-continue').hidden = false; node('camp-decision-reveal').hidden = false;
    node('camp-decision-cancel').textContent = 'Stay in camp';
    node('camp-decision-provenance').textContent = h.provenance;
    node('camp-decision-history').textContent = h.text;
    node('camp-decision-match').textContent = `Closest to the real choice: “${h.option.label}”. You chose “${option.label}”${h.option.id === option.id ? ', as it happened.' : '.'}`;
    node('camp-decision-sources').replaceChildren(...h.sources.map((src) => {
      const li = document.createElement('li');
      if (src.url) { const a = document.createElement('a'); a.href = src.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = src.label; li.append(a); }
      else li.textContent = src.label;
      return li;
    }));
    node('camp-decision-reveal-heading').focus();
  }
  node('camp-decision-continue').addEventListener('click', () => decisionDialog.close('done'));
  node('camp-decision-cancel').addEventListener('click', () => decisionDialog.close('cancel'));
  decisionDialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...decisionDialog.querySelectorAll('input,button,a[href]')].filter((n) => !n.disabled && n.getClientRects().length);
    const radios = stops.filter((n) => n.type === 'radio'), checked = radios.find((n) => n.checked);
    const tabbable = stops.filter((n) => n.type !== 'radio' || n === (checked || radios[0]));
    const first = tabbable[0], last = tabbable[tabbable.length - 1];
    if (!first) return;
    if (e.shiftKey && [first, node('camp-decision-heading'), node('camp-decision-reveal-heading')].includes(document.activeElement)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  /** Next / Replay: the phase's decision cards one at a time, then the march out of camp, then the field. */
  async function leaveCamp(e, replay) {
    if (!saved || saved.version !== 2 || !ladder || ladder.def.id !== saved.campaign.id) return;
    e.preventDefault();
    if (importing || pendingImport || pendingExchange || marching) return;
    const link = e.currentTarget, href = link.href, march = say('camp-march-status');
    marching = true;
    const departure = new AbortController(), cancel = () => departure.abort();
    window.addEventListener('pagehide', cancel, { once: true });
    try {
      let phaseNow;
      try { phaseNow = campaignPhase(saved, ladder.raw, { replay }); } catch (err) { march(`${err.message} Your army is unchanged.`); return; }
      if (!phaseNow) { location.assign(href); return; }
      if (!deck) deck = await loadDecisions().catch((err) => { console.warn('decision cards unavailable:', err?.message ?? err); return null; });
      const cards = deck ? cardsFor(deck, phaseNow) : [];
      for (let i = 0; i < cards.length; i++) {
        if (recorded(saved, phaseNow, cards[i].id)) continue;
        if (!await decide(cards[i], i, cards.length, phaseNow, replay)) { march('You stayed in camp. Choices already made are saved; Next continues from the first open card.'); link.focus(); return; }
      }
      const before = saved, displayed = exportSnapshot(before), ladderBefore = ladder;
      const phaseKey = JSON.stringify(campaignPhase(before, ladderBefore.raw, { replay }));
      const owner = () => !disposed && root.isConnected && marching && !departure.signal.aborted && ladder === ladderBefore;
      const current = () => owner() && saved === before && !importing && !pendingImport && !pendingExchange && phase === 'idle';
      const raw = await store.readRawBaseline();
      if (!current() || raw === null || exportSnapshot(parseSnapshot(raw)) !== displayed) {
        march('Progress changed. Reload camp before taking the field.'); return;
      }
      let fielded;
      if (!(before.ready && before.ready.awardId === phaseNow.awardId)) {
        try { fielded = (await loadPackSummary(phaseNow.packId)).phases.find((p) => p.id === phaseNow.phaseId)?.us; } catch { fielded = undefined; }
      }
      if (!current()) return;
      march('Preparing recorded battle sounds…');
      const preparation = await prepareBattleRecordings(async (signal) => (await loadBattlePack({
        packId: phaseNow.packId, phaseId: phaseNow.phaseId, isCurrent: current,
        fetcher: (url, options) => fetch(url, { ...options, signal }),
      })).scenario, { isCurrent: current, signal: departure.signal });
      if (preparation.cancelled || !current()) return;
      const finalRaw = await store.readRawBaseline();
      if (!current() || finalRaw !== raw || exportSnapshot(saved) !== displayed
        || JSON.stringify(campaignPhase(saved, ladderBefore.raw, { replay })) !== phaseKey) {
        march('Progress changed. Reload camp before taking the field.'); return;
      }
      let departed = before;
      if (!(before.ready && before.ready.awardId === phaseNow.awardId)) {
        const ok = await runEconomy(breakCamp, { campaign: ladderBefore.raw, replay, fielded }, (next) => {
          departed = next; return `The army marches. ${(campReport(before, next) || []).join(' ')}`;
        }, march, () => owner() && saved === before);
        if (!ok) { if (owner()) node('camp-march-status').focus(); return; }
      }
      // A cancellation after a committed exchange retains that save and suppresses stale navigation.
      if (owner() && saved === departed && !pendingImport && !pendingExchange && phase === 'idle') location.assign(href);
    } catch (error) {
      if (!disposed && root.isConnected && !departure.signal.aborted) march(`${error.message} Reload camp before taking the field.`);
    } finally { departure.abort(); window.removeEventListener('pagehide', cancel); marching = false; }
  }
  node('camp-next').addEventListener('click', (e) => leaveCamp(e, false));
  node('camp-replay').addEventListener('click', (e) => leaveCamp(e, true));
  // ---- Record book and Settings (modules owned by other screens; a missing one only disables its button) ----
  node('camp-record-book').addEventListener('click', () => {
    const button = node('camp-record-book'), save = saved;
    import('./records.js').then((m) => m.openRecordBook(document.body, save)).catch((err) => {
      console.warn('record book unavailable:', err?.message ?? err);
      button.dataset.missing = 'true'; button.disabled = true; status.textContent = 'The record book is not available in this version.';
    });
  });
  node('entry-settings').addEventListener('click', () => {
    const button = node('entry-settings');
    import('./settings-panel.js').then((m) => m.openSettings(document.body)).catch((err) => {
      console.warn('settings unavailable:', err?.message ?? err);
      button.dataset.missing = 'true'; button.disabled = true; status.textContent = 'Settings are not available in this version.';
    });
  });
  const confirmDialog = node('camp-confirm');
  function confirmAction({ heading, note, ok }) {
    node('camp-confirm-heading').textContent = heading; node('camp-confirm-note').textContent = note; node('camp-confirm-ok').textContent = ok;
    confirmDialog.returnValue = 'cancel'; confirmDialog.showModal(); node('camp-confirm-cancel').focus();
    return new Promise((resolve) => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true }));
  }
  node('camp-confirm-cancel').addEventListener('click', () => confirmDialog.close('cancel'));
  node('camp-confirm-ok').addEventListener('click', () => confirmDialog.close('ok'));
  confirmDialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const first = node('camp-confirm-cancel'), last = node('camp-confirm-ok');
    if (e.shiftKey && [first, node('camp-confirm-heading')].includes(document.activeElement)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  /** One economy exchange through the store's compare-and-set; plays the level-up moment if it reached a level. */
  async function runEconomy(rule, command, done, say = shopStatus, isCurrent) {
    const baseline = saved;
    importing = true; controls(); say('Saving…');
    try {
      const next = await store.exchange(rule, command, { previous: baseline, isCurrent });
      const ups = levelUps(baseline, next);
      saved = next; failed = false;
      let text = done(next);
      if (ups) {
        text += ` Reputation level ${ups.to} reached: ${ups.cards.length === 1 ? 'a reward card is' : `${ups.cards.length} reward cards are`} in your depot${ups.opened ? `, and the shop now stocks ${TIER_BY_ID[ups.shopTier].name} arms` : ''}.`;
        levelUpMoment(root, { to: ups.to, opened: ups.opened, shopTier: ups.shopTier, reduced: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches });
      }
      importing = false; render(); say(text); status.textContent = text;
      return true;
    } catch (err) {
      importing = false; render();
      const text = `${err.message} Your saved army is unchanged; reload the camp if progress changed elsewhere.`;
      say(text); status.textContent = text;
      return false;
    } finally { importing = false; phase = 'idle'; controls(); }
  }
  async function openBuy(lot, trigger) {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    const date = shopDate();
    phase = 'reviewing';
    const ok = await confirmAction({ heading: 'Requisition this lot?', ok: `Buy for ${lot.price} points`,
      note: `${itemLabel(lot)}. It costs ${lot.price} requisition points (you have ${saved.rp}; ${saved.rp - lot.price} left) and goes to your depot. Prices are a game rule.` });
    phase = 'idle';
    if (!ok) { trigger.focus(); return; }
    const saved1 = await runEconomy(buyLot, { itemId: lot.itemId, date }, (next) => `Bought ${itemLabel(lot)} for ${lot.price} points. It is in your depot; ${next.rp} points left.`);
    const again = node('camp-shop-stock').querySelector(`[data-lot="${lot.itemId}"] button:not(:disabled)`);
    (saved1 || !again ? node('camp-shop-status') : again).focus();
  }
  async function openTurnIn(item, trigger) {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    const points = turnInPoints(item), index = saved.depot.findIndex((it) => it.uid === item.uid);
    phase = 'reviewing';
    const ok = await confirmAction({ heading: 'Turn in this card?', ok: `Turn in for ${points} points`,
      note: `${itemLabel(item)} leaves your depot for good and pays ${points} requisition points. Reputation rises by the same amount. Game rule, not history.` });
    phase = 'idle';
    if (!ok) { trigger.focus(); return; }
    await runEconomy(turnInCard, { itemUid: item.uid }, (next) => `Turned in ${itemLabel(item)} for ${points} points; ${next.rp} points to spend.`);
    if (saved.depot.some((it) => it.uid === item.uid) && trigger.isConnected) trigger.focus();
    else focusDepot(item.uid, index);
  }
  // ---- badges: the detail (game rule apart from the sourced real example) and the keep choice ----
  const badgeDialog = node('camp-badge');
  let badgeTrigger = null;
  function openBadge(entry, brigade, trigger) {
    const def = BADGE_BY_ID[entry.id];
    if (!def) return;
    const ex = def.example, x = brigade.xfactor === entry.id;
    node('camp-badge-heading').textContent = `${def.name}: ${TIER_NAMES[entry.tier]}${x ? ' · X-Factor' : ''}`;
    node('camp-badge-brigade').textContent = `${brigade.label} · ${categoryName(def.category)} badge${x ? '. Its first Gold, the brigade\'s X-Factor: friends within 300 m share its battle effect.' : ''}`;
    node('camp-badge-feat').textContent = `Earned for ${featText(def, entry.feat)} in one phase.`;
    node('camp-badge-effect').textContent = `${effectText(def, entry.tier)}.`;
    node('camp-badge-tiers').textContent = `Bronze ${threshold(def, 'bronze')}, Silver ${threshold(def, 'silver')}, Gold ${threshold(def, 'gold')} in one phase (${def.stat === 'holdingLoss' ? 'per cent of starting men' : def.feat}). ${BADGE_RULES_NOTE}`;
    node('camp-badge-provenance').textContent = ex.provenance;
    node('camp-badge-unit').textContent = ex.unit;
    node('camp-badge-event').textContent = `${ex.event}${ex.theatre === 'Western' ? '' : ` (${ex.theatre} theatre)`}`;
    node('camp-badge-text').textContent = ex.text;
    node('camp-badge-sources').replaceChildren(...ex.sources.map((s) => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = s.url; a.textContent = s.label; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a); return li;
    }));
    badgeTrigger = trigger; badgeDialog.showModal(); node('camp-badge-heading').focus();
  }
  node('camp-badge-close').addEventListener('click', () => badgeDialog.close());
  badgeDialog.addEventListener('close', () => { if (badgeTrigger?.isConnected) badgeTrigger.focus(); badgeTrigger = null; });
  const chooseDialog = node('camp-choose');
  let choosing = null;
  function openChoose(brigadeId, trigger) {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    const b = saved.army.find((x) => x.id === brigadeId);
    if (!b || !b.offer?.length) return;
    const slots = slotsOf(b), all = [...(b.badges || []), ...b.offer];
    choosing = { brigadeId, trigger, slots };
    node('camp-choose-heading').textContent = `${b.label}: choose badges`;
    node('camp-choose-note').textContent = `A ${b.vet} brigade${b.extraSlot ? ' with a bought extra slot' : ''} has ${slots} badge slot${slots === 1 ? '' : 's'}. Keep up to ${slots}; the others are let go for good.${b.xfactor ? ' The X-Factor badge is always kept.' : ''} Slots and badges are game rules.`;
    node('camp-choose-legend').textContent = `Badges to keep (up to ${slots})`;
    node('camp-choose-rows').replaceChildren(...all.map((x) => {
      const def = BADGE_BY_ID[x.id], label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; box.value = x.id; box.checked = (b.badges || []).some((k) => k.id === x.id); box.className = 'camp-choose-box';
      if (x.id === b.xfactor) { box.checked = true; box.disabled = true; }
      label.className = 'camp-choose-row'; label.append(box, badgeChip({ ...x, xfactor: x.id === b.xfactor }, { compact: true }),
        ` ${def.name} · ${TIER_NAMES[x.tier]} · ${featText(def, x.feat)}${b.offer.includes(x) ? ' (new)' : ''}`);
      return label;
    }));
    node('camp-choose-status').textContent = '';
    phase = 'reviewing'; chooseDialog.showModal(); node('camp-choose-heading').focus();
  }
  node('camp-choose-cancel').addEventListener('click', () => chooseDialog.close('cancel'));
  chooseDialog.addEventListener('close', () => {
    if (phase === 'reviewing') phase = 'idle';
    const t = choosing?.trigger; choosing = null;
    if (chooseDialog.returnValue !== 'saved' && t?.isConnected) t.focus();
    chooseDialog.returnValue = '';
  });
  node('camp-choose-save').addEventListener('click', async () => {
    if (!choosing || importing) return;
    const keep = [...node('camp-choose-rows').querySelectorAll('.camp-choose-box')].filter((n) => n.checked).map((n) => n.value);
    if (keep.length > choosing.slots) { node('camp-choose-status').textContent = `Choose at most ${choosing.slots}; ${keep.length} are ticked.`; return; }
    const { brigadeId } = choosing, baseline = saved;
    importing = true; controls(); node('camp-choose-status').textContent = 'Saving…';
    try {
      saved = await store.exchange(chooseBadges, { brigadeId, keep }, { previous: baseline }); failed = false;
      const b = saved.army.find((x) => x.id === brigadeId);
      importing = false; chooseDialog.close('saved'); render();
      status.textContent = `${b.label} keeps ${b.badges?.length ? b.badges.map((x) => `${BADGE_BY_ID[x.id].name} (${TIER_NAMES[x.tier]})`).join(', ') : 'no badges'}. Saved.`;
      const card = node('camp-army').querySelector(`[data-brigade-id="${CSS.escape(brigadeId)}"]`);
      (card?.querySelector('button') || status).focus();
    } catch (err) {
      importing = false;
      node('camp-choose-status').textContent = `${err.message} Your saved army is unchanged; reload the camp if progress changed elsewhere.`;
    } finally { importing = false; controls(); }
  });
  node('camp-shop-toggle').addEventListener('click', async () => {
    if (importing || pendingImport || pendingExchange || !saved || saved.version !== 2) return;
    shopOpen = !shopOpen; render(); node('camp-shop-toggle').focus();
    // Opening the shop at a new level clears its "new" marker (a small compare-and-set write; failure keeps the marker).
    if (shopOpen && saved.shopSeen < saved.level) {
      importing = true; controls();
      try { saved = await store.exchange(markShopSeen, null, { previous: saved }); }
      catch (err) { shopStatus(`${err.message} The shop still marks this level as new.`); }
      finally { importing = false; render(); node('camp-shop-toggle').focus(); }
    }
  });
  // ---- art (P6b): backdrops, the trophy shelf and commander portraits (src/ui/art.js) ----
  const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** The battle region the camp looks at: the next phase's pack (the last fought once complete); practice camps use the title view. */
  function backdropKey(showCamp) {
    if (!showCamp || saved?.version !== 2 || !ladder || ladder.def.id !== saved.campaign.id) return 'title';
    const c = saved.campaign, p = ladder.def.phases[c.index] || c.history[c.history.length - 1];
    return p?.packId || 'title';
  }
  function renderBackdrop(showCamp) {
    const box = node('entry-backdrop'), caption = node('entry-backdrop-caption'), key = backdropKey(showCamp);
    box.dataset.mode = showCamp ? 'camp' : 'title';
    box.dataset.motion = reducedMotion() ? 'reduced' : 'full';
    whenArt((m) => {
      if (disposed) return;
      const art = backdropArt(key, m) || backdropArt('title', m);
      if (!art) { box.hidden = true; caption.hidden = true; return; }
      if (box.dataset.key !== art.key) {
        box.querySelector('.entry-backdrop-img').style.backgroundImage = `url("${art.src}")`;
        box.dataset.key = art.key;
      }
      box.hidden = false;
      caption.textContent = `${showCamp ? 'Camp view' : 'Title painting'}: ${art.caption}. ${art.licence}.`;
      caption.hidden = false;
    });
  }
  const pauseBackdrop = () => node('entry-backdrop').classList.toggle('is-paused', document.hidden);
  document.addEventListener('visibilitychange', pauseBackdrop);
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { node('entry-backdrop').dataset.motion = reducedMotion() ? 'reduced' : 'full'; });
  // The art loads a moment after the screen renders (src/ui/art.js whenArt): the title and camp are usable at once.
  setTimeout(() => { if (!disposed) loadArt(); }, ART_DELAY_MS);
  /** The brigade's commander for the camp card: from the next phase on that names him (the loaded packs), else the latest
   *  phase before it; null when no loaded phase names one (the card shows the generic silhouette). */
  function commanderOf(b) {
    if (!b.unitId || !ladder || saved?.version !== 2 || ladder.def.id !== saved.campaign.id) return undefined;
    const all = ladder.def.phases, at = Math.min(saved.campaign.index, all.length - 1);
    const order = [...all.slice(at), ...all.slice(0, at).reverse()];
    for (const p of order) {
      const who = titles.get(p.packId)?.phases.find((x) => x.id === p.phaseId)?.commanders?.[b.unitId];
      if (who) return { name: who.name, rank: rankShort(who.rank) };
    }
    return null;
  }
  const SHELF_CAP = 12;
  const ICONS = {
    gun: '<svg viewBox="0 0 32 20" class="camp-trophy-icon"><circle cx="11" cy="13" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 9 L30 4 L31 7 L10 12 Z M2 18 L11 13" fill="currentColor" stroke="currentColor" stroke-width="2"/></svg>',
    arm: '<svg viewBox="0 0 32 20" class="camp-trophy-icon"><path d="M1 8 H22 L24 7 H27 L31 13 L30 16 L22 12 H1 Z" fill="currentColor"/></svg>',
    colour: '<svg viewBox="0 0 32 20" class="camp-trophy-icon"><path d="M4 1 V19" stroke="currentColor" stroke-width="2"/><path d="M5 2 H27 L23 7 L27 12 H5 Z" fill="currentColor" opacity="0.85"/></svg>',
    wagon: '<svg viewBox="0 0 32 20" class="camp-trophy-icon"><path d="M3 4 C8 -1 24 -1 29 4 V12 H3 Z" fill="currentColor" opacity="0.75"/><circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };
  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  function trophy(kind, count, label, icon) {
    const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'camp-trophy';
    row.dataset.trophy = kind; row.dataset.count = String(count);
    const icons = document.createElement('span'); icons.className = 'camp-trophy-icons'; icons.setAttribute('aria-hidden', 'true');
    if (icon) {
      icons.innerHTML = icon.repeat(Math.min(count, SHELF_CAP));
      if (count > SHELF_CAP) { const more = document.createElement('b'); more.className = 'camp-trophy-more'; more.textContent = `×${count}`; icons.append(more); }
    }
    const text = document.createElement('span'); text.className = 'camp-trophy-label'; text.textContent = label;
    row.append(icons, text);
    return row;
  }
  function renderShelf() {
    const v2 = saved.version === 2, rows = [];
    const captured = [...saved.army.map((b) => b.weapon), ...saved.depot].filter((it) => it && it.source === 'capture');
    const guns = captured.filter((it) => itemDef(it.itemId).arm === 'artillery'), arms = captured.filter((it) => itemDef(it.itemId).arm !== 'artillery');
    const names = (list) => [...new Set(list.map((it) => itemDef(it.itemId).name))].slice(0, 4).join(', ');
    if (v2) {
      const r = trophy('reputation', saved.level, `Army reputation level ${saved.level} of 10`, null);
      const badge = document.createElement('b'); badge.className = 'camp-trophy-level'; badge.textContent = String(saved.level);
      r.querySelector('.camp-trophy-icons').append(badge); rows.push(r);
    }
    rows.push(trophy('guns', guns.length, guns.length ? `Captured guns: ${plural(guns.length, 'gun')} (${names(guns)})` : 'Captured guns: none yet', ICONS.gun));
    rows.push(trophy('arms', arms.length, arms.length ? `Captured arms: ${plural(arms.length, 'card')} (${names(arms)})` : 'Captured arms: none yet', ICONS.arm));
    if (v2) {
      // Regiment colours the army took (P5d; save trophies.colours): each named with the phase and the brigade that took it.
      const colours = saved.trophies?.colours || [], row = trophy('colours', colours.length, colours.length ? `Captured colours: ${plural(colours.length, 'colour')}` : 'Captured colours: none yet', ICONS.colour);
      if (colours.length) {
        const ul = document.createElement('ul'); ul.className = 'camp-colours'; ul.setAttribute('aria-label', 'Captured colours');
        for (const c of colours.slice(0, SHELF_CAP)) {
          const li = document.createElement('li'); li.dataset.regiment = c.regiment;
          li.textContent = `${c.regiment}, taken by ${c.by} at ${titleOf(c.packId, c.phaseId)}`; ul.append(li);
        }
        if (colours.length > SHELF_CAP) { const li = document.createElement('li'); li.textContent = `and ${colours.length - SHELF_CAP} more`; ul.append(li); }
        row.append(ul);
      }
      rows.push(row);
    }
    if (v2) { const w = storesOf(saved).wagons; rows.push(trophy('wagons', w, `Wagons in the train: ${plural(w, 'wagon')}`, ICONS.wagon)); }
    node('camp-shelf').replaceChildren(...rows);
  }
  function render() {
    const showCamp = camp && !!saved && !failed;
    node('entry-title').hidden = showCamp; node('entry-camp').hidden = !showCamp;
    node('entry-title-heading').textContent = saved ? 'Your army is ready' : 'Your first command';
    node('entry-note').textContent = saved ? `${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men return to camp. Continue opens your saved army and depot.`
      : failed ? 'Progress could not be read. Retry loading or import an army export to recover.'
        : 'Two brigades. One approaching enemy. Hold the ground, capture the stores, then open your first loot.';
    if (!showCamp) renderTitleCampaign();
    renderBackdrop(showCamp);
    node('camp-trophies').hidden = !showCamp;
    if (showCamp) {
      renderShelf();
      renderCampaignStrip();
      renderOrders();
      renderShop();
      node('entry-summary').textContent = `${saved.army.length} formations · ${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men · ${saved.grade ?? 'no phase fought yet'}`;
      paged(saved.army, node('camp-army'), node('army-pages'), (b, i) => {
        const v2 = saved.version === 2;
        const who = v2 ? commanderOf(b) : undefined;
        const card = brigCard(b, i, { interactive: false, onBadge: v2 ? (x, br, chip) => openBadge(x, br, chip) : null, ...(who !== undefined ? { who } : {}) }); card.dataset.brigadeId = b.id;
        if (v2 && b.offer?.length) {
          const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'camp-choose-button';
          choose.textContent = 'Choose badges to keep'; choose.setAttribute('aria-label', `Choose which badges ${b.label} keeps`);
          choose.disabled = importing || !!pendingImport || !!pendingExchange;
          choose.addEventListener('click', () => openChoose(b.id, choose)); card.append(choose);
        }
        return card;
      }, 'brigades', 'army');
      node('depot-note').textContent = saved.depot.length ? `${saved.depot.length} cards kept in the depot. Compare a card to issue it; your current weapon returns here.${saved.version === 2 ? ' A card you do not need can be turned in for requisition points.' : ''}` : 'No spare arms in the depot.';
      paged(saved.depot, node('camp-depot'), node('depot-pages'), (item) => {
        const cell = document.createElement('div'); cell.setAttribute('role', 'listitem'); cell.dataset.itemUid = item.uid;
        const card = staticCard(item); card.setAttribute('role', 'group');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'camp-compare-button';
        button.disabled = importing || !!pendingImport || !!pendingExchange;
        button.textContent = 'Compare and issue'; button.setAttribute('aria-label', `Compare and issue ${itemLabel(item)}`);
        button.addEventListener('click', () => openExchange(item.uid, button)); cell.append(card, button);
        if (saved.version === 2) {
          const points = turnInPoints(item), turn = document.createElement('button'); turn.type = 'button'; turn.className = 'camp-turnin-button';
          turn.textContent = `Turn in for ${points} points`; turn.setAttribute('aria-label', `Turn in ${itemLabel(item)} for ${points} requisition points`);
          turn.disabled = importing || !!pendingImport || !!pendingExchange;
          turn.addEventListener('click', () => openTurnIn(item, turn)); cell.append(turn);
        }
        return cell;
      }, 'depot cards', 'depot');
    }
    controls();
    window.__entry = { mode: showCamp ? 'camp' : 'title', slot, saved, failed, pending: pendingImport, shop: { open: shopOpen, date: shopDate() }, decks: !!deck, get marching() { return marching; },
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
      deck = await loadDecisions().catch((err) => { console.warn('decision cards unavailable:', err?.message ?? err); return null; });
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
      : showCamp ? saved.version === 2 ? (node('camp-next').hidden ? node('camp-campaign-heading') : node('camp-next')) : node(ladder ? 'camp-begin-campaign' : 'camp-practice')
        : ladder && !node('entry-campaign-continue').hidden ? node('entry-campaign-continue') : node('entry-continue');
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
      const difficulty = picker.querySelector('input[name="slot-difficulty"]:checked')?.value || 'veteran';
      const fresh = newCampaign({ campaign: ladder.raw, slot: row.slot, seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0], at: new Date().toISOString(), difficulty });
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
  picker.addEventListener('close', () => {
    if (overwrite.open) return;
    const back = !node('camp-begin-campaign').hidden && node('camp-begin-campaign').getClientRects().length ? node('camp-begin-campaign') : node('entry-new-campaign');
    if (!back.hidden) back.focus();
  });
  node('camp-begin-campaign').addEventListener('click', openSlotPicker);
  node('slot-overwrite-cancel').addEventListener('click', () => overwrite.close('cancel'));
  node('slot-overwrite-confirm').addEventListener('click', () => overwrite.close('overwrite'));
  for (const d of [picker, overwrite]) d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...d.querySelectorAll('button, input[type="radio"]:checked')].filter((b) => !b.disabled && b.getClientRects().length), first = stops[0], last = stops[stops.length - 1];
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
            a.href = battleHref(packId, p.id, node('entry-battles-difficulty').value, node('entry-battles-side').value); a.textContent = p.title;
            a.dataset.pack = packId; a.dataset.phase = p.id;
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
      sandboxMenu(); // not awaited: the first battle link takes focus now
    }
    (node('entry-battle-rows').querySelector('a') || node('entry-battles-heading')).focus();
  });
  // Sandbox battle: options from the three packs' summaries (cached), the field list from FIELDS; then the controls show.
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  async function sandboxMenu() {
    const say = node('entry-sandbox-status'), rows = [];
    say.textContent = 'Loading the armies…';
    for (const packId of SANDBOX_PACKS) {
      try { const sum = titles.get(packId) || await loadPackSummary(packId); titles.set(packId, sum); rows.push(...sum.rosters); }
      catch (err) { say.textContent = `The sandbox armies could not be loaded: ${err.message}`; return; }
    }
    node('entry-sandbox-field').replaceChildren(...FIELDS.map((f) => option(f.id, f.name)));
    node('entry-sandbox-us').replaceChildren(...rows.filter((r) => r.side === 'US').map((r) => option(r.id, r.label)));
    node('entry-sandbox-cs').replaceChildren(...rows.filter((r) => r.side === 'CS').map((r) => option(r.id, r.label)));
    say.textContent = '';
    node('entry-sandbox-controls').hidden = false;
    sandboxHref();
  }
  const sandboxHref = () => {
    const field = node('entry-sandbox-field').value, us = node('entry-sandbox-us').value, cs = node('entry-sandbox-cs').value;
    if (!field || !us || !cs) return;
    node('entry-sandbox-fight').href = sandboxBattleHref({ field, us, cs, attacker: node('entry-sandbox-attacker').value,
      side: node('entry-battles-side').value, difficulty: node('entry-battles-difficulty').value });
  };
  for (const id of ['entry-sandbox-field', 'entry-sandbox-us', 'entry-sandbox-cs', 'entry-sandbox-attacker']) node(id).addEventListener('change', sandboxHref);
  node('entry-sandbox-fight').addEventListener('click', (e) => { if (importing || pendingExchange || node('entry-sandbox-controls').hidden) e.preventDefault(); });
  // The Battles list's own difficulty and side: every phase link carries them (?difficulty=, none for Veteran; ?side=CS).
  const battlesDifficulty = () => {
    const level = node('entry-battles-difficulty').value, side = node('entry-battles-side').value;
    node('entry-battles-difficulty-note').textContent = `${difficultyName(level)}: ${DIFFICULTY_TEXT[level]} ${DIFFICULTY_NOTE}${side === 'CS' ? ' You command the Confederates; the computer fights the Union.' : ''}`;
    node('entry-battle-rows').querySelectorAll('a[data-pack]').forEach((a) => { a.href = battleHref(a.dataset.pack, a.dataset.phase, level, side); });
    sandboxHref();
  };
  node('entry-battles-difficulty').addEventListener('change', battlesDifficulty);
  node('entry-battles-side').addEventListener('change', battlesDifficulty);
  battlesDifficulty();
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
    task.abort.abort(); activeDeployment = null; importing = false; phase = 'idle'; render();
    const target = task.trigger?.isConnected && !task.trigger.disabled && task.trigger.getClientRects().length
      ? task.trigger : saved && !failed ? node(saved.version === 2 ? 'camp-campaign-heading' : 'camp-deploy') : node('entry-retry').hidden ? node('entry-continue') : node('entry-retry');
    target.focus(); target.scrollIntoView({ block: 'nearest' });
  }
  function cancelDeployment() {
    const task = activeDeployment; if (!task || task.admitted) return;
    task.cancelled = true; task.abort?.abort(); if (reviewDialog.open) reviewDialog.close('cancel');
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
      manifest: null, baseline: null, raw: null, abort: new AbortController() };
    activeDeployment = task; reviewDialog.returnValue = 'cancel';
    window.addEventListener('pagehide', cancelDeployment, { once: true, signal: task.abort.signal });
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
      node('deploy-note').textContent = 'Preparing recorded battle sounds… Return to camp cancels this handoff.';
      const preparation = await prepareBattleRecordings(async () => task.manifest.scenario,
        { isCurrent: () => currentDeployment(task), signal: task.abort.signal });
      if (preparation.cancelled || !currentDeployment(task)) return;
      const raw = await store.readRawBaseline();
      if (!currentDeployment(task)) return;
      assertSavedLaunch(task.manifest, raw === null ? null : parseSnapshot(raw));
      await onDeploy({ manifest: task.manifest, isCurrent: () => currentDeployment(task), onAdmitted: () => {
        if (!currentDeployment(task)) throw new Error('Practice: deployment review was cancelled.');
        task.admitted = true; task.abort.abort(); disposed = true; reviewDialog.close('launch'); root.remove();
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

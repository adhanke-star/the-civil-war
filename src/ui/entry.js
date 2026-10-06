// Completed-army readback only. All mutations are validated explicit file imports through save.js.
import { createProgressStore, parseSnapshot, exportSnapshot, MAX_SAVE_BYTES } from '../franchise/save.js';
import { get } from '../settings.js';
import { brigCard, staticCard, defineRewardSettings } from '../reward/sequence.js';

const PAGE_SIZE = 12;
const STYLE = { 'clean modern': 'modern', 'period desk': 'desk', hybrid: 'hybrid' };
export function mountEntry({ camp = false } = {}) {
  defineRewardSettings();
  const store = createProgressStore();
  let saved = null, failed = false, pendingImport = null, pendingName = null, importing = false;
  let pendingBaseline, baselineKnown = false, phase = 'idle';
  const root = document.createElement('main'); root.id = 'front'; root.className = 'rw rw-counts';
  root.dataset.uiStyle = STYLE[get('screens.cardStyle')] || 'modern';
  root.innerHTML = `
    <div class="entry-wrap">
      <header class="entry-head"><a href="./" class="entry-brand">The Civil War</a><p>One army. One war.</p></header>
      <section id="entry-title" aria-labelledby="entry-title-heading">
        <p class="rw-eyebrow">Take the field</p><h1 id="entry-title-heading">Your first command</h1>
        <p id="entry-note"></p><button id="entry-continue" class="entry-primary" type="button">Continue</button>
      </section>
      <section id="entry-camp" aria-labelledby="entry-camp-heading" hidden>
        <header class="entry-camp-head"><div><p class="rw-eyebrow">Between battles</p><h1 id="entry-camp-heading">Your army</h1><p id="entry-summary"></p></div>
          <a id="camp-practice" class="entry-primary" href="./?intro">Practice again</a></header>
        <p class="entry-note">Practice again starts the original teaching formations. Your saved army stays here until you explicitly replace it after another result.</p>
        <section aria-labelledby="camp-army-heading"><h2 id="camp-army-heading">Brigades</h2><div id="camp-army" class="rw-brigs is-static" role="list" aria-label="Saved brigades"></div><div id="army-pages" class="entry-pages"></div></section>
        <section aria-labelledby="camp-depot-heading"><h2 id="camp-depot-heading">Depot</h2><p id="depot-note"></p><div id="camp-depot" role="list" aria-label="Saved depot"></div><div id="depot-pages" class="entry-pages"></div></section>
      </section>
      <section class="entry-transfer" aria-label="Army transfer"><button id="entry-export" type="button" disabled>Export army</button><button id="entry-import" type="button">Import army</button><button id="entry-retry" type="button" hidden>Retry loading</button><input id="entry-file" type="file" accept=".json,application/json" hidden><p id="entry-status" role="status"></p></section>
      <nav class="entry-modes" aria-label="Other ways to play"><a href="./?practice">Henry Hill practice</a><a href="./?battle=henry-hill">Historical battle</a><a href="./?sandbox">Sandbox</a><a href="./reward.html">Reward workbench</a></nav>
      <p class="entry-note">Practice formations, rewards and ratings are game values. The historical battle is available separately.</p>
    </div>
    <dialog id="entry-replace" aria-labelledby="entry-replace-heading" aria-describedby="entry-replace-note"><h2 id="entry-replace-heading">Replace saved army?</h2><p id="entry-replace-note">Import replaces your army and depot with this completed export. Export first to keep your current army.</p><button id="entry-cancel" type="button">Cancel</button><button id="entry-confirm" type="button">Import and replace</button></dialog>`;
  document.body.append(root);
  const node = (id) => root.querySelector(`#${id}`), status = node('entry-status');
  const controls = () => {
    root.setAttribute('aria-busy', String(importing));
    node('entry-continue').disabled = failed || importing;
    node('entry-export').disabled = !(saved || pendingImport);
    node('entry-retry').hidden = !failed && !pendingImport;
    node('entry-retry').textContent = pendingImport ? 'Retry importing' : 'Retry loading';
    node('entry-import').disabled = importing;
    node('entry-retry').disabled = importing;
  };
  function paged(items, container, controlsNode, build, noun) {
    let page = 0;
    const buttons = items.length > PAGE_SIZE ? [['Previous', -1], ['Next', 1]].map(([label, delta], i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${label} ${noun}`;
      b.addEventListener('click', () => { page += delta; draw(); (b.disabled ? buttons[1 - i] : b).focus(); });
      return b;
    }) : [];
    const count = document.createElement('span'); count.setAttribute('role', 'status');
    controlsNode.replaceChildren(...buttons, ...(buttons.length ? [count] : []));
    function draw() {
      container.replaceChildren();
      items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((item, i) => container.append(build(item, page * PAGE_SIZE + i)));
      if (!buttons.length) return;
      buttons[0].disabled = page === 0; buttons[1].disabled = (page + 1) * PAGE_SIZE >= items.length;
      count.textContent = `${page * PAGE_SIZE + 1}–${Math.min(items.length, (page + 1) * PAGE_SIZE)} of ${items.length}`;
    }
    draw();
  }
  function render() {
    const showCamp = camp && !!saved && !failed;
    node('entry-title').hidden = showCamp; node('entry-camp').hidden = !showCamp;
    node('entry-title-heading').textContent = saved ? 'Your army is ready' : 'Your first command';
    node('entry-note').textContent = saved ? `${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men return to camp. Continue opens your saved army and depot.`
      : failed ? 'Progress could not be read. Retry loading or import an army export to recover.'
        : 'Two brigades. One approaching enemy. Hold the ground, capture the stores, then open your first loot.';
    if (showCamp) {
      node('entry-summary').textContent = `${saved.army.length} formations · ${saved.army.reduce((n, b) => n + b.men, 0).toLocaleString()} men · ${saved.grade}`;
      paged(saved.army, node('camp-army'), node('army-pages'), (b, i) => {
        const card = brigCard(b, i, { interactive: false }); card.dataset.brigadeId = b.id; return card;
      }, 'brigades');
      node('depot-note').textContent = saved.depot.length ? `${saved.depot.length} cards kept in the depot.` : 'No spare arms in the depot.';
      paged(saved.depot, node('camp-depot'), node('depot-pages'), (item) => {
        const cell = document.createElement('div'); cell.setAttribute('role', 'listitem'); cell.dataset.itemUid = item.uid;
        const card = staticCard(item); card.setAttribute('role', 'group'); cell.append(card); return cell;
      }, 'depot cards');
    }
    controls();
    window.__entry = { mode: showCamp ? 'camp' : 'title', saved, failed, pending: pendingImport, get importing() { return importing; } };
    document.title = `The Civil War — ${showCamp ? 'Your army' : 'Take the field'}`;
  }
  function focusStatus() { status.tabIndex = -1; status.focus(); status.scrollIntoView({ block: 'nearest' }); }
  function loading(message = 'Loading saved progress…') { phase = 'reading'; status.textContent = message; focusStatus(); }
  async function load() {
    if (importing) return;
    importing = true; controls(); loading();
    try { saved = await store.load(); failed = false; status.textContent = saved ? 'Saved army ready.' : 'No completed army saved yet.'; }
    catch (err) { failed = true; status.textContent = err.message; }
    finally { importing = false; phase = 'idle'; }
    render(); (failed ? node('entry-retry') : camp && saved ? node('camp-practice') : node('entry-continue')).focus();
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
    if (importing) return;
    importing = true; controls();
    loading();
    // Re-read at navigation: another tab may have saved or invalidated progress.
    try { saved = await store.load(); failed = false; location.assign(saved ? './?camp' : './?intro'); }
    catch (err) { failed = true; status.textContent = err.message; render(); }
    finally { importing = false; phase = 'idle'; controls(); if (failed) node('entry-retry').focus(); }
  });
  node('entry-retry').addEventListener('click', async () => {
    if (importing) return;
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
  node('entry-export').addEventListener('click', () => {
    const text = pendingImport || exportSnapshot(saved), url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'the-civil-war-army.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = pendingImport ? importing ? phase === 'writing' ? 'Exported pending import. Saving is still waiting.' : 'Exported pending import. Review is still in progress.' : 'Exported pending import. Browser saving still needs a retry.' : 'Exported the displayed saved army.';
  });
  node('entry-import').addEventListener('click', () => { if (!importing) node('entry-file').click(); });
  node('entry-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file || importing) return;
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
  load();
}

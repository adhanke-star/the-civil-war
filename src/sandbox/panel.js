// src/sandbox/panel.js: the sandbox workbench panel (?sandbox, or Menu > Sandbox).
//
// A slide-out side panel built from the settings registry (src/settings.js): five tabs, one row per setting
// with its control, a plain-English note, Reset and "Lock this". Settings defined after the panel opens
// appear as they are defined. The footer holds Copy settings / Paste settings and an fps meter; a setting
// whose change drops the frame rate by 3 fps or more says so under its control.

import { TABS, define, get, set, reset, on, watch, all, lock, unlock, isLocked, exportText, importText } from '../settings.js';
import { startCompare, stopCompare, compareState } from './compare.js';

const HIDDEN_KEY = 'cw.sandbox.hidden';
const TAB_KEY = 'cw.sandbox.tab';
const BEFORE_MS = 2000; // fps window before a change
const AFTER_MS = 3000; // fps window after it
const COST_FPS = 3; // a drop this large is reported

function loadPref(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the panel state is simply not remembered
  }
}

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    n.setAttribute(k, v === true ? '' : v);
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

const LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7 V5 a3 3 0 0 1 6 0 V7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

/** The demonstration settings: the panel is never empty and the test can exercise each control type. */
function defineDemoSettings() {
  define('look.fpsMeter', {
    tab: 'Look', type: 'toggle', default: true, label: 'Frame-rate meter',
    note: 'Shows frames per second at the foot of this panel; it costs nothing measurable.',
  });
  define('look.panelSide', {
    tab: 'Look', type: 'choice', default: 'right', label: 'Panel side',
    options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
    note: 'Which edge of the screen this panel slides out from; no frame-rate cost.',
  });
  define('screens.uiScale', {
    tab: 'Screens', type: 'range', default: 1, min: 0.8, max: 1.4, step: 0.05, label: 'Interface size',
    note: 'Scales panel text and buttons (the --ui-scale CSS variable); no frame-rate cost.',
  });
}

/** Frame-time recorder with its own requestAnimationFrame loop: real frame times, not the game's. */
class FpsMeter {
  constructor(onTick) {
    this.samples = []; // [time, dt] for the last ~8 s
    this.last = 0;
    this.onTick = onTick;
    this.nextTick = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  frame(now) {
    if (this.last) {
      const dt = now - this.last;
      if (dt > 0 && dt < 1000) this.samples.push([now, dt]); // a long gap is a hidden tab, not a frame
    }
    this.last = now;
    while (this.samples.length && this.samples[0][0] < now - 8000) this.samples.shift();
    if (now >= this.nextTick) {
      this.nextTick = now + 500;
      this.onTick(this.average(now - 1500, now)); // a 1.5 s window still reads a 2 fps device
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  /** Average fps over frames that ended in (t0, t1]; null with too few frames to judge. */
  average(t0, t1) {
    let n = 0, sum = 0;
    for (const [t, dt] of this.samples) if (t > t0 && t <= t1) { n++; sum += dt; }
    return n >= 2 ? 1000 / (sum / n) : null;
  }
}

export function mountSandbox({ game } = {}) {
  if (document.getElementById('sb-panel')) return null; // mounted already
  defineDemoSettings();

  if (!document.querySelector('link[data-sandbox-css]')) {
    const link = el('link', { rel: 'stylesheet', href: new URL('./sandbox.css', import.meta.url).href, 'data-sandbox-css': true });
    document.head.append(link);
  }

  // ---- shell -------------------------------------------------------------------------------------------
  const toggle = el('button', { type: 'button', id: 'sb-toggle', class: 'sb-toggle', 'aria-controls': 'sb-panel', 'aria-expanded': 'true', 'aria-label': 'Sandbox panel', title: 'Show or hide the sandbox panel' });
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="9" cy="6" r="2.4" fill="currentColor"/><circle cx="15" cy="12" r="2.4" fill="currentColor"/><circle cx="7" cy="18" r="2.4" fill="currentColor"/></svg>';
  const panel = el('aside', { id: 'sb-panel', class: 'sb-panel', 'aria-labelledby': 'sb-title' });
  const head = el('header', { class: 'sb-head' });
  head.append(el('h2', { id: 'sb-title' }, 'Sandbox'), el('p', { class: 'sb-sub' }, 'Try a choice, then lock the ones you want to keep.'));
  const tablist = el('div', { class: 'sb-tabs', role: 'tablist', 'aria-label': 'Sandbox sections' });
  const tabpanel = el('div', { class: 'sb-body', id: 'sb-tabpanel', role: 'tabpanel', tabindex: '0' });
  const foot = el('footer', { class: 'sb-foot' });
  panel.append(head, tablist, tabpanel, foot);

  let current = TABS.includes(loadPref(TAB_KEY, '')) ? loadPref(TAB_KEY, '') : 'Look';
  const tabs = new Map();
  for (const name of TABS) {
    const t = el('button', { type: 'button', role: 'tab', id: `sb-tab-${name.toLowerCase()}`, class: 'sb-tab', 'aria-controls': 'sb-tabpanel', 'aria-selected': 'false', tabindex: '-1' }, name);
    t.addEventListener('click', () => selectTab(name));
    tablist.append(t);
    tabs.set(name, t);
  }
  // Arrow keys move between tabs (the ARIA tabs pattern); Tab leaves the tab list.
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(current);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    selectTab(TABS[j]);
    tabs.get(TABS[j]).focus();
  });

  // ---- footer: copy, paste, fps ---------------------------------------------------------------------
  const copyBtn = el('button', { type: 'button', class: 'sb-btn' }, 'Copy settings');
  const pasteBtn = el('button', { type: 'button', class: 'sb-btn', 'aria-expanded': 'false', 'aria-controls': 'sb-paste' }, 'Paste settings');
  const fps = el('p', { class: 'sb-fps', title: 'Frames per second, measured by this panel' });
  const fpsDot = el('span', { class: 'sb-dot', 'aria-hidden': 'true' });
  const fpsNum = el('span', { class: 'sb-fps-num' }, '--');
  const fpsWord = el('span', { class: 'sb-fps-word' }, '');
  fps.append(fpsDot, fpsNum, el('span', {}, ' fps '), fpsWord);
  const btnRow = el('div', { class: 'sb-foot-row' });
  btnRow.append(copyBtn, pasteBtn, fps);
  const status = el('p', { class: 'sb-status', role: 'status', 'aria-live': 'polite' });

  const copyBox = el('div', { class: 'sb-box', id: 'sb-copybox', hidden: true });
  const copyArea = el('textarea', { id: 'sb-copy-text', class: 'sb-text', rows: '5', readonly: true });
  const copyClose = el('button', { type: 'button', class: 'sb-btn' }, 'Done');
  copyBox.append(el('label', { for: 'sb-copy-text' }, 'Copying is blocked here: select all of this text and copy it.'), copyArea, copyClose);
  copyClose.addEventListener('click', () => { copyBox.hidden = true; copyBtn.focus(); });

  const pasteBox = el('div', { class: 'sb-box', id: 'sb-paste', hidden: true });
  const pasteArea = el('textarea', { id: 'sb-paste-text', class: 'sb-text', rows: '5', placeholder: 'look.panelSide = left' });
  const pasteApply = el('button', { type: 'button', class: 'sb-btn sb-primary' }, 'Apply');
  const pasteCancel = el('button', { type: 'button', class: 'sb-btn' }, 'Cancel');
  const pasteRow = el('div', { class: 'sb-foot-row' });
  pasteRow.append(pasteApply, pasteCancel);
  pasteBox.append(el('label', { for: 'sb-paste-text' }, 'Paste a settings block, then Apply.'), pasteArea, pasteRow);
  foot.append(btnRow, copyBox, pasteBox, status);

  const say = (text) => { status.textContent = text; };
  copyBtn.addEventListener('click', async () => {
    const text = exportText();
    copyBox.hidden = true;
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      say('Settings copied. Paste them into a message.');
    } catch {
      // some iPad Safari contexts have no clipboard API: show the text to copy by hand
      copyArea.value = text;
      copyBox.hidden = false;
      copyArea.focus();
      copyArea.select();
      say('Copy the selected text by hand.');
    }
  });
  const showPaste = (open) => {
    pasteBox.hidden = !open;
    pasteBtn.setAttribute('aria-expanded', String(open));
    if (open) pasteArea.focus();
  };
  pasteBtn.addEventListener('click', () => showPaste(pasteBox.hidden));
  pasteCancel.addEventListener('click', () => { showPaste(false); pasteBtn.focus(); });
  pasteApply.addEventListener('click', () => {
    const n = importText(pasteArea.value);
    render();
    say(n === 1 ? 'Applied 1 setting.' : `Applied ${n} settings.`);
    if (n > 0) { pasteArea.value = ''; showPaste(false); pasteBtn.focus(); }
  });

  // ---- rows -------------------------------------------------------------------------------------------
  const costs = new Map(); // key -> fps cost last measured
  const rows = new Map(); // key -> { row, sync() }

  function buildRow({ key, spec }) {
    const id = `sb-${key.replace(/[^\w-]/g, '-')}`;
    const row = el('div', { class: `sb-row sb-type-${spec.type}`, 'data-key': key });
    const noteId = `${id}-note`;
    const head = el('div', { class: 'sb-row-head' });
    const lockMark = el('span', { class: 'sb-lockmark', hidden: true });
    lockMark.innerHTML = `${LOCK_SVG} Locked`;
    let control, valueOut = null, inputs = [];

    if (spec.type === 'toggle') {
      const box = el('input', { type: 'checkbox', role: 'switch', id, 'aria-describedby': noteId });
      const state = el('span', { class: 'sb-onoff', 'aria-hidden': 'true' });
      control = el('label', { class: 'sb-switch', for: id });
      control.append(box, el('span', { class: 'sb-label' }, spec.label), state);
      box.addEventListener('change', () => set(key, box.checked));
      inputs = [box];
      head.append(control, lockMark);
    } else if (spec.type === 'choice') {
      control = el('fieldset', { class: 'sb-choice', 'aria-describedby': noteId });
      control.append(el('legend', { class: 'sb-label' }, spec.label));
      const opts = el('div', { class: 'sb-opts' });
      spec.options.forEach((o, i) => {
        const r = el('input', { type: 'radio', name: id, id: `${id}-${i}`, value: String(o.value) });
        const l = el('label', { class: 'sb-opt', for: `${id}-${i}` });
        l.append(r, el('span', {}, o.label));
        r.addEventListener('change', () => { if (r.checked) set(key, o.value); });
        inputs.push(r);
        opts.append(l);
      });
      control.append(opts);
      head.append(control, lockMark);
    } else if (spec.type === 'range') {
      const lab = el('label', { class: 'sb-label', for: id }, spec.label);
      valueOut = el('output', { class: 'sb-value', for: id });
      const r = el('input', { type: 'range', id, min: String(spec.min), max: String(spec.max), step: spec.step ? String(spec.step) : 'any', 'aria-describedby': noteId });
      r.addEventListener('input', () => set(key, Number(r.value)));
      inputs = [r];
      const top = el('div', { class: 'sb-range-top' });
      top.append(lab, valueOut, lockMark);
      head.append(top);
      control = r;
      head.append(r);
    } else {
      control = el('button', { type: 'button', class: 'sb-btn sb-action', id, 'aria-describedby': noteId }, spec.label);
      control.addEventListener('click', () => {
        try {
          spec.run();
        } catch (err) {
          console.error(`sandbox: action '${key}' failed:`, err);
          say(`${spec.label} failed: ${err && err.message ? err.message : err}`);
        }
      });
      head.append(control);
    }
    row.append(head);
    if (spec.note) row.append(el('p', { class: 'sb-note', id: noteId }, spec.note));
    else row.append(el('p', { class: 'sb-note', id: noteId }, ''));
    const cost = el('p', { class: 'sb-cost', hidden: true });
    row.append(cost);

    let resetBtn = null, lockBox = null, cmpBtn = null;
    if (spec.type !== 'action') {
      const tools = el('div', { class: 'sb-tools' });
      resetBtn = el('button', { type: 'button', class: 'sb-btn sb-small', 'aria-label': `Reset ${spec.label}` }, 'Reset');
      resetBtn.addEventListener('click', () => reset(key));
      const lockId = `${id}-lock`;
      lockBox = el('input', { type: 'checkbox', id: lockId, 'aria-label': `Lock this: ${spec.label}` });
      const lockLabel = el('label', { class: 'sb-lock', for: lockId });
      lockLabel.append(lockBox, el('span', {}, 'Lock this'));
      lockBox.addEventListener('change', () => { if (lockBox.checked) lock(key); else unlock(key); });
      tools.append(resetBtn, lockLabel);
      if (spec.type === 'choice' && spec.compare) {
        cmpBtn = el('button', { type: 'button', class: 'sb-btn sb-small', 'aria-pressed': 'false', 'aria-label': `Compare ${spec.label} side by side` }, 'Compare');
        cmpBtn.addEventListener('click', () => {
          const s = compareState();
          if (s && s.key === key) stopCompare();
          else { startCompare(key, spec, get(key), () => syncAll()); syncAll(); }
        });
        tools.append(cmpBtn);
      }
      row.append(tools);
    }

    function sync() {
      const v = get(key);
      const locked = isLocked(key);
      if (spec.type === 'toggle') {
        inputs[0].checked = Boolean(v);
        row.querySelector('.sb-onoff').textContent = v ? 'On' : 'Off';
      } else if (spec.type === 'choice') {
        for (const r of inputs) r.checked = r.value === String(v);
      } else if (spec.type === 'range') {
        inputs[0].value = String(v);
        valueOut.textContent = String(v);
      }
      for (const i of inputs) i.disabled = locked;
      if (resetBtn) resetBtn.disabled = locked || v === spec.default;
      if (lockBox) lockBox.checked = locked;
      if (cmpBtn) { const s = compareState(); cmpBtn.setAttribute('aria-pressed', String(!!s && s.key === key)); cmpBtn.textContent = s && s.key === key ? 'End compare' : 'Compare'; }
      lockMark.hidden = !locked;
      row.classList.toggle('sb-locked', locked);
      const c = costs.get(key);
      cost.hidden = !c;
      if (c) cost.textContent = `This costs about ${c} fps on this device.`;
    }
    sync();
    return { row, sync };
  }

  function syncAll() {
    for (const r of rows.values()) r.sync();
  }

  function render() {
    const focusKey = document.activeElement && tabpanel.contains(document.activeElement) ? document.activeElement.id : null;
    rows.clear();
    tabpanel.replaceChildren();
    const list = all().filter((s) => s.spec.tab === current);
    if (!list.length) tabpanel.append(el('p', { class: 'sb-empty' }, `Nothing on the ${current} tab yet.`));
    for (const s of list) {
      const r = buildRow(s);
      rows.set(s.key, r);
      tabpanel.append(r.row);
    }
    if (focusKey) document.getElementById(focusKey)?.focus();
  }

  function selectTab(name) {
    current = name;
    savePref(TAB_KEY, name);
    for (const [n, t] of tabs) {
      const on_ = n === name;
      t.setAttribute('aria-selected', String(on_));
      t.tabIndex = on_ ? 0 : -1;
    }
    tabpanel.setAttribute('aria-labelledby', tabs.get(name).id);
    render(); // re-reads the registry, so settings defined since the last render appear
  }

  // ---- registry events ----------------------------------------------------------------------------------
  watch((event, key) => {
    if (event === 'define') {
      const e = all().find((s) => s.key === key);
      if (e && e.spec.tab === current) render();
    } else rows.get(key)?.sync();
  });

  // fps meter + cost warnings
  const meter = new FpsMeter((v) => {
    if (v === null) return;
    const n = Math.round(v);
    fpsNum.textContent = String(n);
    const tone = n >= 45 ? 'good' : n >= 30 ? 'fair' : 'poor';
    fps.dataset.tone = tone;
    fpsWord.textContent = tone === 'good' ? 'smooth' : tone === 'fair' ? 'uneven' : 'slow';
  });
  on('*', (value, key) => {
    rows.get(key)?.sync();
    const t = performance.now();
    const before = meter.average(t - BEFORE_MS, t);
    if (before === null) return;
    setTimeout(() => {
      if (get(key) !== value) return; // changed again since; that change measures itself
      const now = performance.now();
      const after = meter.average(now - AFTER_MS, now);
      if (after === null) return;
      const drop = before - after;
      if (drop >= COST_FPS) costs.set(key, Math.round(drop));
      else costs.delete(key);
      rows.get(key)?.sync();
    }, AFTER_MS);
  });

  // ---- demo settings take effect ------------------------------------------------------------------------
  const applyMeter = (v) => { fps.hidden = !v; };
  const applySide = (v) => {
    const left = v === 'left';
    for (const n of [panel, toggle]) { n.classList.toggle('sb-left', left); n.classList.toggle('sb-right', !left); }
    syncBodyClass();
  };
  const applyScale = (v) => { document.documentElement.style.setProperty('--ui-scale', String(v)); };
  on('look.fpsMeter', applyMeter);
  on('look.panelSide', applySide);
  on('screens.uiScale', applyScale);

  // ---- hide / show ---------------------------------------------------------------------------------------
  function syncBodyClass() {
    const open = !panel.hidden;
    document.body.classList.toggle('sb-open-right', open && get('look.panelSide') !== 'left');
    document.body.classList.toggle('sb-open-left', open && get('look.panelSide') === 'left');
  }
  function setHidden(h) {
    panel.hidden = h;
    toggle.setAttribute('aria-expanded', String(!h));
    toggle.classList.toggle('sb-closed', h);
    savePref(HIDDEN_KEY, h ? '1' : '0');
    syncBodyClass();
  }
  toggle.addEventListener('click', () => setHidden(!panel.hidden));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setHidden(true); toggle.focus(); }
    e.stopPropagation(); // keys typed in the panel are not game keys (W A S D, Space ...)
  });
  toggle.addEventListener('keydown', (e) => e.stopPropagation());

  document.body.append(panel, toggle);
  applyMeter(get('look.fpsMeter'));
  applySide(get('look.panelSide'));
  applyScale(get('screens.uiScale'));
  selectTab(current);
  setHidden(loadPref(HIDDEN_KEY, '0') === '1');

  const api = { panel, toggle, meter, selectTab, render, setHidden, game };
  window.__sandbox = api;
  return api;
}

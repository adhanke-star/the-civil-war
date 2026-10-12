// src/ui/settings-panel.js: the player's Settings panel (DESIGN §4 Settings: quality, sound volumes, gore toggle).
//
//   openSettings(host = document.body, { returnFocus })  a modal dialog appended to host; returns it. Focus stays inside
//       (Tab wraps), Escape or Close closes it, focus returns to the control that opened it. A second call while one is
//       open focuses the open one. No three.js at module level: the title and camp can open it without the field.
//   setQualityHandler(apply, current)  main.js: apply a quality mode on the running field (post.mode); without it the
//       choice is only saved (cw.quality) for the next battle.
// Contents: Quality Auto/High/Low (cw.quality, as the menu and the G key), four volumes and Mute (src/audio/mixer.js),
// Gore on/off (look.gore, with its rule), X-Factor effects Full/Subtle/Off (look.xFactorStyle), and a note that reduced
// motion follows the device. Every value persists through src/settings.js; a setting locked in the sandbox is shown
// disabled. In battle: the HUD's Settings button or the O key (src/ui/hud.js, src/ui/input.js).

import { define, get, set, on, isLocked, GORE_KEY, GORE_SPEC } from '../settings.js';
import { AUDIO_SETTINGS } from '../audio/mixer.js';
import { ORDER_CALLS } from '../audio/bank.js';
import '../ui/look.js'; // defines look.xFactorStyle (no three.js)

const QUALITY_KEY = 'cw.quality';
const QUALITY = [['auto', 'Auto'], ['high', 'High'], ['low', 'Low']];
const VOLUMES = [['audio.master', 'Master'], ['audio.effects', 'Effects'], ['audio.music', 'Music'], ['audio.voices', 'Voices']];
let quality = null; // { apply(mode), current() }
let open = null; // the open dialog

export function setQualityHandler(apply, current) { quality = typeof apply === 'function' ? { apply, current } : null; }

function storedQuality() {
  try { const v = window.localStorage.getItem(QUALITY_KEY); return QUALITY.some(([m]) => m === v) ? v : 'auto'; } catch { return 'auto'; }
}
function saveQuality(mode) {
  try { window.localStorage.setItem(QUALITY_KEY, mode); } catch { /* storage blocked: the choice holds for this visit only */ }
}

function ensureCss() {
  if (document.querySelector('link[data-settings-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./settings-panel.css', import.meta.url).href; link.dataset.settingsCss = '';
  document.head.append(link);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}

/** A group of radio buttons; onPick(value) on change. */
function radios(name, legend, options, value, onPick, { disabled = false, note = '' } = {}) {
  const box = el('fieldset', { class: 'cws-group' }, el('legend', { text: legend }));
  const row = el('div', { class: 'cws-choices' });
  for (const [v, label] of options) {
    const input = el('input', { type: 'radio', name, value: String(v), id: `cws-${name}-${v}` });
    input.checked = String(v) === String(value); input.disabled = disabled;
    input.addEventListener('change', () => { if (input.checked) onPick(v); });
    row.append(el('label', { class: 'cws-choice', for: input.id }, input, el('span', { text: label })));
  }
  box.append(row);
  if (note) box.append(el('p', { class: 'cws-note', text: note }));
  return box;
}

export function openSettings(host = document.body, { returnFocus = null } = {}) {
  if (open?.isConnected && open.open) { open.focus(); return open; }
  ensureCss();
  define(GORE_KEY, GORE_SPEC);
  for (const [key, spec] of AUDIO_SETTINGS) define(key, spec);
  const opener = returnFocus || document.activeElement;
  const unsubs = [];
  const dialog = el('dialog', { id: 'settings-panel', class: 'cws', 'aria-labelledby': 'cws-title', 'aria-describedby': 'cws-intro' });
  const close = el('button', { type: 'button', class: 'cws-close', text: 'Close' });
  close.addEventListener('click', () => dialog.close());

  // ---- quality ----
  const q = quality ? quality.current() : storedQuality();
  const qBox = radios('quality', 'Quality', QUALITY, q, (mode) => { saveQuality(mode); quality?.apply(mode); }, {
    note: 'Auto picks High or Low for your graphics chip and steps down if a battle slows. On the battlefield it applies at once; '
      + 'some parts (the figures chosen when a battle loads) change only after you reload the page.' });

  // ---- sound ----
  const sound = el('fieldset', { class: 'cws-group' }, el('legend', { text: 'Sound' }));
  for (const [key, label] of VOLUMES) {
    const id = `cws-${key.replace('.', '-')}`, pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
    const input = el('input', { type: 'range', id, min: '0', max: '100', step: '5' });
    const out = el('output', { for: id, class: 'cws-pct', 'aria-hidden': 'true' });
    const show = (v) => { input.value = String(Math.round((Number(v) || 0) * 100)); input.setAttribute('aria-valuetext', pct(v)); out.textContent = pct(v); };
    show(get(key)); input.disabled = isLocked(key);
    input.addEventListener('input', () => show(set(key, Number(input.value) / 100)));
    unsubs.push(on(key, show));
    sound.append(el('div', { class: 'cws-slider' }, el('label', { for: id, text: `${label} volume` }), input, out));
  }
  const mute = el('input', { type: 'checkbox', id: 'cws-mute' });
  mute.checked = get('audio.mute') === true; mute.disabled = isLocked('audio.mute');
  mute.addEventListener('change', () => { mute.checked = set('audio.mute', mute.checked) === true; });
  unsubs.push(on('audio.mute', (v) => { mute.checked = v === true; }));
  sound.append(el('label', { class: 'cws-check', for: 'cws-mute' }, mute, el('span', { text: 'Mute all sound' })));
  sound.append(el('p', { class: 'cws-note', text: 'Sound starts after your first tap or key press. Music plays on the title, in camp and on the results, never over a battle; '
    + 'drums and bugle calls answer your orders.' }));
  const calls = el('ul', { class: 'cws-calls' });
  const byLabel = new Map(); // one row per call, naming every order kind it answers
  for (const [kind, c] of Object.entries(ORDER_CALLS)) byLabel.set(c.label, [...(byLabel.get(c.label) || []), kind === 'holdfire' ? 'hold fire' : kind === 'fallback' ? 'fall back' : kind]);
  for (const [label, kinds] of byLabel) calls.append(el('li', {}, el('b', { text: kinds.join(', ') }), `: ${label}`));
  sound.append(el('details', { class: 'cws-details' }, el('summary', { text: 'Which call answers which order' }), calls));

  // ---- gore ----
  const gore = radios('gore', 'Gore', [[true, 'On'], [false, 'Off']], get(GORE_KEY) !== false, (v) => set(GORE_KEY, v), {
    disabled: isLocked(GORE_KEY), note: 'On: the fallen remain where they fell. Off: no blood, and fallen men fade from the field after a few seconds. '
      + 'Wrecked guns and dead horses stay either way: they are not gore. Looks only; the battle is the same.' });
  unsubs.push(on(GORE_KEY, (v) => { for (const r of gore.querySelectorAll('input')) r.checked = r.value === String(v); }));

  // ---- X-Factor ----
  const xf = radios('xfactor', 'X-Factor effects', [['full', 'Full'], ['subtle', 'Subtle'], ['off', 'Off']], get('look.xFactorStyle'), (v) => set('look.xFactorStyle', v), {
    disabled: isLocked('look.xFactorStyle'), note: 'Full: a banner, a warm glow along the line and a sound sting. Subtle: a still banner. Off: no cues. Game rules are the same.' });
  unsubs.push(on('look.xFactorStyle', (v) => { for (const r of xf.querySelectorAll('input')) r.checked = r.value === String(v); }));

  // ---- motion ----
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = el('p', { class: 'cws-note cws-motion', text: `Reduced motion follows your device setting (now ${reduced ? 'on' : 'off'}). `
    + 'When it is on, battle smoke is hidden and big moments are toned down.' });

  dialog.append(
    el('div', { class: 'cws-head' }, el('h2', { id: 'cws-title', text: 'Settings' }), close),
    el('p', { id: 'cws-intro', class: 'cws-note', text: 'Your choices are saved on this device.' }),
    qBox, sound, gore, xf, motion);

  // Tab stays inside; Escape closes (native cancel); focus returns to the opener.
  // (Field keys need no blocking: src/ui/input.js ignores keys while a dialog is open and clears held camera keys.)
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const live = [...dialog.querySelectorAll('button, input, summary, a[href], select, textarea, [tabindex]')]
      .filter((n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length && (n.type !== 'radio' || n.checked));
    const first = live[0], last = live.at(-1), current = document.activeElement;
    if (first && ((e.shiftKey && current === first) || (!e.shiftKey && current === last))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  });
  dialog.addEventListener('close', () => {
    for (const off of unsubs) off();
    dialog.remove();
    if (open === dialog) open = null;
    if (opener?.isConnected && !opener.closest?.('[inert]') && opener.getClientRects?.().length) opener.focus({ preventScroll: true });
  });
  host.append(dialog);
  open = dialog;
  dialog.showModal();
  (qBox.querySelector('input:checked') || close).focus();
  return dialog;
}

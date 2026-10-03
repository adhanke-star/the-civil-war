// src/sandbox/compare.js: split-screen compare for a sandbox choice (a setting defined with compare: true).
//
// CONTRACT for renderers (the hookup is not built here):
//   import { compareState, onCompare } from './sandbox/compare.js';
//   compareState() -> null when compare is off, else { key, a, b, split }:
//     key   the setting being compared (its spec has type 'choice' and compare: true)
//     a     the option value to draw LEFT of the divider
//     b     the option value to draw RIGHT of the divider
//     split 0..1, the divider's position as a fraction of the window width from the left edge
//   onCompare(fn) -> unsubscribe; fn(state, 'compare') runs whenever compare starts, ends (state null), the
//     divider moves or a side's option changes (the same call shape as settings.on).
//   A renderer draws the scene twice with a scissor: x < split * width with option a, the rest with option b.
//   The setting's own value (settings.get(key)) is untouched while comparing; picking happens in the panel.
//
// The overlay passes pointer events through everywhere except the divider handle and the A/B/C toolbar, so
// the field stays playable while comparing.

const listeners = new Set();
let state = null;
let ui = null; // { root, line, handle, left, right, done }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function compareState() {
  return state ? { ...state } : null;
}

export function onCompare(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function fire() {
  const s = compareState();
  for (const fn of [...listeners]) {
    try {
      fn(s, 'compare');
    } catch (err) {
      console.error('compare: a listener failed:', err);
    }
  }
}

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

function placeLine() {
  if (!ui || !state) return;
  const pct = `${(state.split * 100).toFixed(2)}%`;
  ui.line.style.left = pct;
  ui.handle.style.left = pct;
  ui.handle.setAttribute('aria-valuenow', String(Math.round(state.split * 100)));
  ui.handle.setAttribute('aria-valuetext', `${Math.round(state.split * 100)} percent from the left`);
}

function setSplit(x) {
  if (!state) return;
  state.split = Math.min(0.95, Math.max(0.05, x));
  placeLine();
  fire();
}

/** One side's picker: a button per option, lettered A, B, C... The pressed one is that side's option. */
function picker(side, spec) {
  const group = el('div', { class: 'sb-cmp-side', role: 'group', 'aria-label': side === 'a' ? 'Left of the divider' : 'Right of the divider' });
  group.append(el('span', { class: 'sb-cmp-lbl' }, side === 'a' ? 'Left' : 'Right'));
  spec.options.forEach((o, i) => {
    const b = el('button', { type: 'button', class: 'sb-cmp-opt', 'aria-pressed': 'false', title: o.label, 'aria-label': `${LETTERS[i]}: ${o.label}` });
    b.append(el('b', {}, LETTERS[i]), el('span', {}, ` ${o.label}`));
    b.dataset.value = String(o.value);
    b.addEventListener('click', () => {
      if (!state) return;
      state[side] = o.value;
      syncPickers();
      fire();
    });
    group.append(b);
  });
  return group;
}

function syncPickers() {
  if (!ui || !state) return;
  for (const [side, group] of [['a', ui.left], ['b', ui.right]]) {
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === String(state[side])));
  }
}

/** Start comparing the choice `key` (spec from the settings registry); `current` is its value now. onEnd runs when compare closes. */
export function startCompare(key, spec, current, onEnd) {
  stopCompare();
  const opts = spec.options;
  const ia = Math.max(0, opts.findIndex((o) => String(o.value) === String(current)));
  state = { key, a: opts[ia].value, b: opts[(ia + 1) % opts.length].value, split: 0.5 };

  const root = el('div', { class: 'sb-compare' });
  const line = el('div', { class: 'sb-cmp-line', 'aria-hidden': 'true' });
  const handle = el('div', { class: 'sb-cmp-handle', role: 'slider', tabindex: '0', 'aria-label': `Compare divider for ${spec.label}`, 'aria-valuemin': '5', 'aria-valuemax': '95', 'aria-orientation': 'horizontal' });
  handle.append(el('span', { 'aria-hidden': 'true' }, '◂ ▸'));
  const bar = el('div', { class: 'sb-cmp-bar', role: 'toolbar', 'aria-label': `Compare ${spec.label}` });
  const left = picker('a', spec);
  const right = picker('b', spec);
  const done = el('button', { type: 'button', class: 'sb-cmp-done' }, 'End compare');
  done.addEventListener('click', () => stopCompare());
  bar.append(el('span', { class: 'sb-cmp-title' }, spec.label), left, right, done);
  root.append(line, handle, bar);

  // drag the handle (mouse, pen or touch)
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => { if (dragging) setSplit(e.clientX / window.innerWidth); });
  const end = () => { dragging = false; };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSplit(state.split - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSplit(state.split + step);
    else if (e.key === 'Home') setSplit(0);
    else if (e.key === 'End') setSplit(1);
    else if (e.key === 'Escape') stopCompare();
    else return;
    e.preventDefault();
  });
  // keys typed here are not game keys
  root.addEventListener('keydown', (e) => e.stopPropagation());

  document.body.append(root);
  ui = { root, line, handle, left, right, done, onEnd };
  placeLine();
  syncPickers();
  fire();
  return compareState();
}

export function stopCompare() {
  if (!state && !ui) return;
  const onEnd = ui && ui.onEnd;
  if (ui) ui.root.remove();
  ui = null;
  state = null;
  fire();
  if (onEnd) onEnd();
}

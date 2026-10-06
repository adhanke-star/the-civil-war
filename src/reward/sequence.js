// src/reward/sequence.js: the reward sequence prototype (S1), DOM + CSS only, on placeholder data.
//
//   mountReward(root = document.body, { seed, grade, captures, legendary, mode, awardId, completed, onDone })
//     -> { unmount, state }; completed restores a validated army without rolling loot.
//     a. After action: grade, captured crates (rarity colour + shape), one button "Open the loot"
//     b. Loot reveal: cards dealt face down, commons first and rarest last; tap / click / Space turns one;
//        S or press-and-hold turns all. Fanfare scales with rarity (Legendary: held beat, glow, sting).
//     c. Issue: brigade cards + loot tray; drag a card onto a brigade (mouse, pen, touch) or select it and
//        arrow to a brigade + Enter; side-by-side compare; confirm equips, the old weapon goes to the tray.
//     d. Ratings: changed brigades count up to their new OVR and bars; Continue calls onDone(result).
//   mode: 'one' deals a single card (the sandbox's "Deal one loot card") and closes after it.
//   onDone(result): { awardId, army, depot, issued, seed, grade }
//
// State lives in one plain object (S). Settings come from src/settings.js (defineRewardSettings below);
// the 'screens.cardStyle' choice can be split-screened through src/sandbox/compare.js.

import { define, get, on } from '../settings.js';
import { compareState, onCompare } from '../sandbox/compare.js';
import { TIER_BY_ID, CONDITION_BY_ID, conditionEffect, VETERANCY, GRADES, GRADE_NOTES, SAMPLE_ARMY, itemDef } from './data.js';
import { rollLoot, ratings, compare, bestFit, equip, armsRating, canCarry, makeRng } from './model.js';
import * as sfx from './sfx.js';
import { validateSnapshot, completedSnapshot } from '../franchise/save.js';

const STYLE_SLUG = { 'clean modern': 'modern', 'period desk': 'desk', hybrid: 'hybrid' };
const BARS = [['fire', 'Fire'], ['melee', 'Melee'], ['morale', 'Morale'], ['drill', 'Drill']];
const HOLD_MS = 600; // press-and-hold to turn every card
const DRAG_PX = 8; // a pointer that moves this far from a tray card starts a drag

let active = null; // the mounted sequence
let lastHost = null;
let lastOnDone = null;
let replayHandler = null;
export function configureRewardReplay(handler) { replayHandler = handler; }

// ---- settings -----------------------------------------------------------------------------------------
export function defineRewardSettings() {
  define('screens.revealPace', {
    tab: 'Screens', type: 'choice', default: 'one by one', label: 'Loot reveal pace',
    options: [{ value: 'one by one', label: 'One by one' }, { value: 'all at once', label: 'All at once' }],
    note: 'One by one: you turn each card. All at once: they turn themselves in a quick cascade, rarest last.',
  });
  define('screens.revealSpeed', {
    tab: 'Screens', type: 'range', default: 1, min: 0.5, max: 2, step: 0.1, label: 'Reveal speed',
    note: 'Speeds up or slows down dealing, card flips and rating count-ups; 2 is twice as fast.',
  });
  define('screens.fanfare', {
    tab: 'Screens', type: 'choice', default: 'full', label: 'Rarity fanfare',
    options: [{ value: 'full', label: 'Full' }, { value: 'subtle', label: 'Subtle' }, { value: 'off', label: 'Off' }],
    note: 'How big rare cards play: glow, a held beat and a sting for a Legendary. Off keeps only the flip.',
  });
  define('screens.cardStyle', {
    tab: 'Screens', type: 'choice', default: 'clean modern', label: 'Card and table style', compare: true,
    options: [{ value: 'clean modern', label: 'Clean modern' }, { value: 'period desk', label: 'Period desk' }, { value: 'hybrid', label: 'Hybrid' }],
    note: 'Three looks for the loot and brigade cards: dark slate, paper on a desk, or dark felt with paper ink.',
  });
  define('screens.bestFitStar', {
    tab: 'Screens', type: 'toggle', default: true, label: 'Best-fit star',
    note: 'Marks the brigade that gains most from the card you are holding.',
  });
  define('screens.sound', {
    tab: 'Screens', type: 'toggle', default: true, label: 'Reward sounds',
    note: 'Synthesised card sounds; they start after your first tap or key press.',
  });
  define('moments.rewardPlay', {
    tab: 'Moments', type: 'action', label: 'Play the reward sequence (Victory)',
    note: 'Starts the after-action, loot and issue screens from the top with a fresh roll.',
    run: () => replay({ grade: 'Victory' }),
  });
  define('moments.rewardLegendary', {
    tab: 'Moments', type: 'action', label: 'Play with a Legendary',
    note: 'The same sequence with one Legendary card forced into the deal.',
    run: () => replay({ grade: 'Victory', legendary: true }),
  });
  define('moments.rewardDealOne', {
    tab: 'Moments', type: 'action', label: 'Deal one loot card',
    note: 'Deals and turns a single random card, to judge the flip and its fanfare.',
    run: () => replay({ mode: 'one' }),
  });
}

function replay(opts) {
  if (replayHandler) return replayHandler(opts);
  if (active) active.unmount();
  mountReward(lastHost || document.body, { seed: Math.floor(Math.random() * 1e9), onDone: lastOnDone, ...opts });
}

// ---- small DOM helpers --------------------------------------------------------------------------------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function starPoints() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 4.4 : 10.2;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
const SHAPES = {
  circle: ['circle', { cx: 12, cy: 12, r: 8.6 }],
  square: ['rect', { x: 4.2, y: 4.2, width: 15.6, height: 15.6, rx: 1.6 }],
  diamond: ['polygon', { points: '12,1.8 22.2,12 12,22.2 1.8,12' }],
  hexagon: ['polygon', { points: '21.6,12 16.8,20.3 7.2,20.3 2.4,12 7.2,3.7 16.8,3.7' }],
  star: ['polygon', { points: starPoints() }],
};
/** The tier's shape as an inline SVG (fill = the tier colour via --tier). */
function shapeIcon(tierId, cls = 'rw-shape') {
  const t = TIER_BY_ID[tierId];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const [tag, at] = SHAPES[t.shape];
  const s = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(at)) s.setAttribute(k, String(v));
  svg.append(s);
  return svg;
}
function tint(node, tierId) {
  const t = TIER_BY_ID[tierId];
  node.style.setProperty('--tier', t.color);
  node.style.setProperty('--tier-ink', t.ink);
  return node;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtInt = (n) => Number(n).toLocaleString('en-US');
const MINUS = '−';
function fmtDelta(d) {
  if (d > 0) return `▲ +${d}`;
  if (d < 0) return `▼ ${MINUS}${Math.abs(d)}`;
  return '= 0';
}
function deltaWords(d) {
  return d > 0 ? `up ${d}` : d < 0 ? `down ${Math.abs(d)}` : 'no change';
}
const deltaClass = (d) => (d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-same');

/** "Enfield P53 rifle-musket": the name, plus the kind when the name does not already say it. */
function fullName(def) {
  const words = def.name.toLowerCase();
  const kindWords = def.kind.toLowerCase().split(/[\s-]+/);
  return kindWords.some((w) => words.includes(w)) ? def.name : `${def.name} ${def.kind}`;
}
function itemLabel(inst) {
  const def = itemDef(inst.itemId);
  const tier = TIER_BY_ID[tierId(inst)];
  const cond = CONDITION_BY_ID[inst.conditionId];
  const what = def.gameItem ? `${def.name} (game item, ${fullName({ name: def.baseName, kind: def.kind })})` : fullName(def);
  return `${tier.name}: ${what}, ${cond.name.toLowerCase()}`;
}
/** The tier of an item instance (falls back to its definition). */
function tierId(inst) {
  return inst.tier && TIER_BY_ID[inst.tier] ? inst.tier : itemDef(inst.itemId).tier;
}
const vetName = (id) => (VETERANCY.find((v) => v.id === id) || { name: id }).name;

// ---- card builders ------------------------------------------------------------------------------------
/** The face of a loot card (shared by the reveal, the compare view and nothing else). */
function cardFront(inst) {
  const def = itemDef(inst.itemId);
  const tier = TIER_BY_ID[tierId(inst)];
  const cond = CONDITION_BY_ID[inst.conditionId];
  const band = el('span', { class: 'rw-band' }, shapeIcon(tier.id), el('span', { class: 'rw-band-name', text: tier.name }));
  if (def.gameItem) band.append(el('span', { class: 'rw-tag', text: 'Game item' }));
  const stats = el('span', { class: 'rw-stats' },
    el('span', { class: 'rw-stat' }, el('b', { text: fmtInt(def.range.v) }), el('small', { text: 'yd range' })),
    el('span', { class: 'rw-stat' }, el('b', { text: String(def.rate.v) }), el('small', { text: 'per min' })),
    el('span', { class: 'rw-stat' }, el('b', { text: String(def.accuracy.v) }), el('small', { text: 'accuracy' })));
  const affix = el('span', { class: `rw-affix ${cond.mult > 1 ? 'is-up' : cond.mult < 1 ? 'is-down' : 'is-same'}` },
    el('span', { class: 'rw-chip', text: cond.name }),
    el('span', { class: 'rw-affix-fx', text: conditionEffect(cond) }));
  const effect = def.gameItem
    ? el('span', { class: 'rw-effect is-special', text: `✦ ${def.special.text}` })
    : el('span', { class: 'rw-effect', text: def.effect.text });
  const body = el('span', { class: 'rw-body' },
    el('span', { class: 'rw-titlerow' },
      el('span', { class: 'rw-name', text: def.name }),
      el('span', { class: 'rw-arms', title: 'Arms rating (with condition)' }, el('b', { text: String(armsRating(inst)) }), el('small', { text: 'Arms' }))),
    el('span', { class: 'rw-type', text: `${def.gameItem ? def.baseName : cap(def.kind)} · ${def.caliber}` }),
    stats, affix, effect,
    el('span', { class: 'rw-where', text: inst.from || '' }));
  const front = el('span', { class: 'rw-face rw-front' }, band, body);
  if (def.gameItem) front.title = def.flavour;
  return front;
}

function cardBack(inst) {
  return el('span', { class: 'rw-face rw-back' },
    el('span', { class: 'rw-back-frame' }),
    el('span', { class: 'rw-seal' }, shapeIcon(tierId(inst), 'rw-seal-shape')));
}

/** A flippable loot card for the reveal. */
function lootCard(inst, i, n) {
  const rank = TIER_BY_ID[tierId(inst)].rank;
  const card = el('div', { class: 'rw-card rw-themed is-pending', role: 'button', tabindex: '0', 'data-i': String(i), 'data-rank': String(rank), 'aria-label': `Face-down card ${i + 1} of ${n}` },
    el('span', { class: 'rw-card-inner' }, cardBack(inst), cardFront(inst)));
  return tint(card, tierId(inst));
}

/** A face-up card that does not flip (compare view). */
export function staticCard(inst) {
  const card = el('div', { class: 'rw-card rw-themed is-static is-up', 'data-rank': String(TIER_BY_ID[tierId(inst)].rank), role: 'img', 'aria-label': itemLabel(inst) }, cardFront(inst));
  return tint(card, tierId(inst));
}

/** A brigade card (rating-first front). interactive: a role=button target in the issue step. */
export function brigCard(b, i, { interactive = true, show = ratings(b) } = {}) {
  const def = itemDef(b.weapon.itemId);
  const cond = CONDITION_BY_ID[b.weapon.conditionId];
  const r = ratings(b);
  const meta = `${b.men === 0 || (b.kind === 'battery' && b.guns === 0) ? 'Depleted · ' : ''}${b.kind === 'battery' ? `${b.guns ?? 6} guns · ` : ''}${fmtInt(b.men)} men`;
  const bars = el('span', { class: 'rw-bars' });
  for (const [k, name] of BARS) {
    bars.append(el('span', { class: 'rw-bar', 'data-k': k },
      el('span', { class: 'rw-bar-k', text: name }),
      el('span', { class: 'rw-track' }, el('i', { class: 'rw-fill', style: `width:${show[k]}%` })),
      el('span', { class: 'rw-bar-v', text: String(show[k]) }),
      el('span', { class: 'rw-bar-d', 'aria-hidden': 'true' })));
  }
  const wTier = tierId(b.weapon);
  const weap = tint(el('span', { class: 'rw-bweap' }, shapeIcon(wTier),
    el('span', { class: 'rw-bweap-name', text: def.name }),
    el('span', { class: 'rw-bweap-cond', text: cond.name })), wTier);
  const card = el('div', {
    class: 'rw-brig rw-themed', 'data-b': String(i), 'data-kind': b.kind,
    role: interactive ? 'button' : 'listitem', tabindex: interactive ? '0' : null,
    'aria-label': `${b.label}, ${vetName(b.vet)}, ${meta}, OVR ${r.ovr}, ${itemLabel(b.weapon)}`,
  },
  el('span', { class: 'rw-ovr' }, el('b', { class: 'rw-ovr-v', text: String(show.ovr) }), el('small', { text: 'OVR' })),
  el('span', { class: 'rw-bhead' },
    el('span', { class: 'rw-bname', text: b.label }),
    el('span', { class: 'rw-bmeta' }, el('span', { class: 'rw-vet', 'data-vet': b.vet, text: vetName(b.vet) }), el('span', { text: meta }))),
  el('span', { class: 'rw-flags' },
    el('span', { class: 'rw-preview', 'aria-hidden': 'true' }),
    el('span', { class: 'rw-star', hidden: true }, el('span', { 'aria-hidden': 'true', text: '★ ' }), 'Best fit'),
    el('span', { class: 'rw-delta', 'aria-hidden': 'true' })),
  weap, bars,
  el('span', { class: 'rw-blocked', hidden: true }));
  return card;
}

/** A compact loot card in the tray. */
function trayTile(inst, t) {
  const def = itemDef(inst.itemId);
  const tier = TIER_BY_ID[tierId(inst)];
  const cond = CONDITION_BY_ID[inst.conditionId];
  const tile = el('div', { class: `rw-tile rw-themed${inst.depot ? ' is-depot' : ''}`, role: 'button', tabindex: '0', 'data-t': String(t), 'aria-pressed': 'false', 'aria-label': `${itemLabel(inst)}${inst.depot ? ', in the depot' : ''}. Arms ${armsRating(inst)}` },
    el('span', { class: 'rw-tile-band' }, shapeIcon(tier.id)),
    el('span', { class: 'rw-tile-main' },
      el('span', { class: 'rw-tile-name', text: def.name }),
      el('span', { class: 'rw-tile-sub', text: `${inst.depot ? 'Depot' : tier.name} · ${cond.name}` })),
    el('span', { class: 'rw-tile-arms' }, el('b', { text: String(armsRating(inst)) }), el('small', { text: 'Arms' })));
  if (def.gameItem) tile.querySelector('.rw-tile-main').append(el('span', { class: 'rw-tag rw-tile-tag', text: 'Game item' }));
  return tint(tile, tier.id);
}

// ---- the sequence -----------------------------------------------------------------------------------------
export function mountReward(root, opts = {}) {
  if (active) active.unmount();
  defineRewardSettings();
  sfx.armAudio();
  const host = root || document.body;
  if (opts.rememberReplay !== false) {
    lastHost = host;
    if (opts.onDone) lastOnDone = opts.onDone;
  }

  if (!document.querySelector('link[data-reward-css]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./reward.css', import.meta.url).href, 'data-reward-css': true }));
  }

  const completed = opts.completed ? validateSnapshot(opts.completed) : null;
  const seed = completed?.seed ?? opts.seed ?? Math.floor(Math.random() * 1e9);
  const grade = completed?.grade ?? (GRADES.includes(opts.grade) ? opts.grade : 'Victory');
  const awardId = completed?.awardId ?? opts.awardId ?? `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const starting = opts.army ? completedSnapshot({ awardId, army: opts.army, depot: opts.depot ?? [], issued: [], seed, grade }) : null;
  const loot = completed ? { cards: [], captures: [] } : rollLoot({ seed, grade, captures: opts.captures, forceLegendary: !!opts.legendary });
  let cards = loot.cards;
  if (starting) cards = cards.map((c) => ({ ...c, uid: `${awardId}.${c.uid}` }));
  if (opts.mode === 'one') {
    const rng = makeRng(`${seed}-one`);
    cards = opts.legendary ? [cards[cards.length - 1]] : [cards[Math.floor(rng() * cards.length)]];
  }

  /** The one state object. */
  const S = {
    mode: opts.mode === 'one' ? 'one' : 'full',
    seed, grade, captures: loot.captures, cards,
    awardId,
    onDone: opts.onDone,
    step: null,
    dealt: 0, up: cards.map(() => false), flipping: new Set(), skipping: false,
    army: (completed?.army ?? starting?.army ?? SAMPLE_ARMY).map((b) => ({ ...b, base: { ...b.base }, weapon: { ...b.weapon } })),
    armyStart: null,
    tray: [], log: completed?.issued.map((r) => ({ ...r })) ?? [],
    held: null, comparing: null, drag: null,
    counting: false, fast: false,
    reduced: false, dead: false,
    timers: new Set(), rafs: new Set(), waiters: new Set(), unsubs: [],
    ui: {},
  };
  S.armyStart = S.army.map((b) => ({ ...b, base: { ...b.base }, weapon: { ...b.weapon } }));
  S.tray = (completed?.depot ?? [...(starting?.depot ?? []), ...cards]).map((c) => ({ ...c }));

  // ---- timing ----
  const speed = () => Number(get('screens.revealSpeed')) || 1;
  const ms = (x) => (S.reduced ? 0 : Math.round(x / speed()));
  const later = (fn, t) => { const id = setTimeout(() => { S.timers.delete(id); if (!S.dead) fn(); }, t); S.timers.add(id); return id; };
  const wait = (t) => (S.fast || t <= 0 ? Promise.resolve() : new Promise((res) => { const done = () => { S.waiters.delete(done); res(); }; S.waiters.add(done); later(done, t); }));
  const flushWaits = () => { for (const w of [...S.waiters]) w(); };
  const fanfare = () => get('screens.fanfare') || 'full';

  // ---- shell ----
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  S.reduced = !!(motionQuery && motionQuery.matches);
  const rootEl = el('div', { class: 'rw', role: 'region', 'aria-label': 'After action and loot', 'data-step': 'a' });
  const bgB = el('div', { class: 'rw-bg-b', hidden: true, 'aria-hidden': 'true' });
  const flash = el('div', { class: 'rw-flash', 'aria-hidden': 'true' });
  const stage = el('div', { class: 'rw-stage' });
  const live = el('p', { class: 'rw-live', role: 'status', 'aria-live': 'polite' });
  rootEl.append(bgB, stage, flash, live);
  host.append(rootEl);
  S.ui = { root: rootEl, bgB, flash, stage, live };

  function applyVars() {
    rootEl.style.setProperty('--rw-flip', `${ms(560)}ms`);
    rootEl.style.setProperty('--rw-deal', `${ms(460)}ms`);
    rootEl.style.setProperty('--rw-charge', `${ms(fanfare() === 'full' ? 950 : 480)}ms`);
    rootEl.style.setProperty('--rw-charge-short', `${ms(260)}ms`);
    rootEl.style.setProperty('--rw-hold', `${HOLD_MS}ms`);
    rootEl.dataset.motion = S.reduced ? 'reduced' : 'full';
    rootEl.dataset.fanfare = fanfare();
  }
  function applyStyle() {
    if (S.dead) return;
    const cs = compareState();
    const themed = rootEl.querySelectorAll('.rw-themed');
    if (cs && cs.key === 'screens.cardStyle') {
      const X = cs.split * window.innerWidth;
      const box = rootEl.getBoundingClientRect();
      rootEl.dataset.uiStyle = STYLE_SLUG[cs.a] || 'modern';
      bgB.hidden = false;
      bgB.dataset.uiStyle = STYLE_SLUG[cs.b] || 'modern';
      const clip = `inset(0 0 0 ${Math.max(0, Math.round(X - box.left))}px)`;
      bgB.style.clipPath = clip;
      bgB.style.webkitClipPath = clip;
      for (const n of themed) {
        const r = n.getBoundingClientRect();
        n.dataset.uiStyle = STYLE_SLUG[(r.left + r.right) / 2 < X ? cs.a : cs.b] || 'modern';
      }
    } else {
      rootEl.dataset.uiStyle = STYLE_SLUG[get('screens.cardStyle')] || 'modern';
      bgB.hidden = true;
      for (const n of themed) delete n.dataset.uiStyle;
    }
  }
  function announce(text) {
    live.textContent = '';
    const id = requestAnimationFrame(() => { S.rafs.delete(id); if (!S.dead) live.textContent = text; });
    S.rafs.add(id);
  }
  function primary(label, onClick, { kbd = 'Enter' } = {}) {
    const b = el('button', { type: 'button', class: 'rw-primary' }, el('span', { class: 'rw-primary-label', text: label }), kbd ? el('kbd', { 'aria-hidden': 'true', text: kbd }) : null);
    b.addEventListener('click', onClick);
    return b;
  }
  function setPrimary(btn, label, kbd) {
    btn.querySelector('.rw-primary-label').textContent = label;
    const k = btn.querySelector('kbd');
    if (k) k.textContent = kbd;
  }
  function go(step) {
    S.step = step;
    rootEl.dataset.step = step;
    stage.replaceChildren();
    S.ui.deal = S.ui.grid = S.ui.tray = null;
    if (step === 'a') renderAfterAction();
    else if (step === 'b') renderReveal();
    else if (step === 'c') renderIssue();
    else if (step === 'd') renderCounts();
    applyStyle();
  }

  // ---- a. after action ----------------------------------------------------------------------------------
  function renderAfterAction() {
    const crates = el('ul', { class: 'rw-crates', 'aria-label': `Captured crates: ${S.captures.length}` });
    S.captures.forEach((tierId, i) => {
      const t = TIER_BY_ID[tierId];
      crates.append(tint(el('li', { class: 'rw-crate', style: `--i:${i}` }, shapeIcon(tierId), el('span', { text: t.name })), tierId));
    });
    const nIssue = S.cards.filter((c) => c.source === 'issue').length;
    const btn = primary('Open the loot', () => { sfx.play('whoosh'); go('b'); });
    const sec = el('section', { class: 'rw-step rw-aar', 'aria-labelledby': 'rw-aar-grade' },
      el('p', { class: 'rw-eyebrow', text: opts.afterAction ? `Practice · ${opts.afterAction.title}` : 'After action · placeholder phase' }),
      el('h1', { class: 'rw-grade', id: 'rw-aar-grade', 'data-grade': S.grade, text: S.grade }),
      el('p', { class: 'rw-grade-note', text: opts.afterAction?.why ?? GRADE_NOTES[S.grade] }),
      opts.afterAction ? el('p', { class: 'rw-hint', text: `${opts.afterAction.surviving.toLocaleString()} surviving men · ${opts.afterAction.losses.toLocaleString()} lost · ${opts.afterAction.guns} crewed guns. Practice rewards and ratings are game values; this does not record the historical outcome.` }) : null,
      el('div', { class: 'rw-aar-stats' },
        el('p', { class: 'rw-aar-stat' }, el('b', { text: String(S.captures.length) }), el('span', { text: 'Captures' })),
        el('p', { class: 'rw-aar-stat' }, el('b', { text: String(nIssue) }), el('span', { text: 'Quartermaster issue' })),
        el('p', { class: 'rw-aar-stat' }, el('b', { text: String(S.cards.length) }), el('span', { text: 'Cards to open' }))),
      S.captures.length ? crates : el('p', { class: 'rw-dim', text: 'No crates captured this phase.' }),
      el('div', { class: 'rw-foot' }, btn));
    stage.append(sec);
    btn.focus({ preventScroll: true });
    announce(`${S.grade}. ${S.captures.length} captures. ${S.cards.length} cards to open.`);
  }

  // ---- b. loot reveal --------------------------------------------------------------------------------------
  function renderReveal() {
    const n = S.cards.length;
    const deal = el('div', { class: 'rw-deal', role: 'group', 'aria-label': `Loot: ${n} card${n === 1 ? '' : 's'}` });
    const nodes = S.cards.map((c, i) => lootCard(c, i, n));
    deal.append(...nodes);
    const btn = primary('Turn next card', onRevealPrimary, { kbd: 'Space' });
    const hint = el('p', { class: 'rw-hint' },
      el('span', { class: 'rw-only-keys' }, 'Click a card to turn it. ', el('kbd', { text: 'Space' }), ' turns the next; ', el('kbd', { text: 'S' }), ' or press and hold turns them all.'),
      el('span', { class: 'rw-only-touch', text: 'Tap a card to turn it. Press and hold the table to turn them all.' }));
    const holdBar = el('span', { class: 'rw-holdbar', 'aria-hidden': 'true' });
    const sec = el('section', { class: 'rw-step rw-reveal', 'aria-labelledby': 'rw-reveal-title' },
      el('header', { class: 'rw-head' },
        el('p', { class: 'rw-eyebrow', text: S.mode === 'one' ? 'One card' : `${S.grade} · the loot` }),
        el('h2', { id: 'rw-reveal-title', class: 'rw-title', text: n === 1 ? 'One card' : `${n} cards, rarest last` })),
      deal,
      el('div', { class: 'rw-foot' }, hint, btn, holdBar));
    stage.append(sec);
    S.ui.deal = deal;
    S.ui.cardNodes = nodes;
    S.ui.revealBtn = btn;
    S.ui.hint = hint;
    fitCards();
    btn.focus({ preventScroll: true });

    deal.addEventListener('click', (e) => {
      const c = e.target.closest('.rw-card');
      if (!c) return;
      const i = Number(c.dataset.i);
      if (i < S.dealt) flip(i);
    });
    // press and hold anywhere on the table turns every card
    let hold = null;
    let start = null;
    const clearHold = () => { if (hold) { clearTimeout(hold); S.timers.delete(hold); hold = null; } sec.classList.remove('is-holding'); };
    deal.addEventListener('pointerdown', (e) => {
      if (S.up.every(Boolean)) return;
      start = { x: e.clientX, y: e.clientY };
      sec.classList.add('is-holding');
      hold = later(() => { hold = null; sec.classList.remove('is-holding'); skipAll(); }, HOLD_MS);
    });
    deal.addEventListener('pointermove', (e) => { if (hold && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) clearHold(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) deal.addEventListener(ev, clearHold);
    deal.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press on iPad must not open a menu

    // deal the cards one by one
    const gap = ms(150);
    const dealOne = (i) => {
      if (S.dead || i >= n || S.dealt > i) return;
      const node = nodes[i];
      node.classList.remove('is-pending');
      if (!S.reduced) {
        node.classList.add('is-dealing');
        node.addEventListener('animationend', () => { node.classList.remove('is-dealing'); if (compareState()) applyStyle(); }, { once: true });
      }
      S.dealt = i + 1;
      sfx.play('deal');
      if (S.dealt === n) dealtAll();
    };
    if (!gap) { for (let i = 0; i < n; i++) dealOne(i); } else nodes.forEach((_, i) => later(() => dealOne(i), 120 + i * gap));
    updateRevealFoot();
  }

  function dealtAll() {
    if (get('screens.revealPace') === 'all at once' && !S.up.every(Boolean)) {
      later(async () => {
        for (let i = 0; i < S.cards.length; i++) {
          if (S.dead || S.step !== 'b') return;
          if (S.up[i]) continue;
          await flip(i);
          await wait(ms(170));
        }
      }, ms(350));
    }
  }

  function fitCards() {
    const deal = S.ui.deal;
    if (!deal) return;
    const n = S.cards.length;
    const W = deal.clientWidth;
    const H = deal.clientHeight;
    const gap = W < 700 ? 12 : 18;
    let best = { cw: 0, cols: n };
    for (let rows = 1; rows <= 3; rows++) {
      const cols = Math.ceil(n / rows);
      const cw = Math.min(S.mode === 'one' ? 230 : 188, (W - (cols - 1) * gap) / cols, (H - (rows - 1) * gap) / rows / 1.42);
      if (cw > best.cw + 0.5) best = { cw, cols };
    }
    deal.style.setProperty('--cw', `${Math.max(96, Math.floor(best.cw))}px`);
    deal.style.setProperty('--cols', String(best.cols));
    deal.style.setProperty('--gap', `${gap}px`);
  }

  function nextFaceDown() {
    for (let i = 0; i < S.dealt; i++) if (!S.up[i] && !S.flipping.has(i)) return i;
    return -1;
  }
  function onRevealPrimary() {
    if (S.up.every(Boolean)) {
      if (S.mode === 'one') { unmount(); return; }
      sfx.play('whoosh');
      go('c');
      return;
    }
    const i = nextFaceDown();
    if (i >= 0) flip(i);
  }
  function updateRevealFoot() {
    const btn = S.ui.revealBtn;
    if (!btn) return;
    const all = S.up.every(Boolean);
    if (all) setPrimary(btn, S.mode === 'one' ? 'Close' : 'Issue to brigades', 'Enter');
    else setPrimary(btn, 'Turn next card', 'Space');
    btn.classList.toggle('is-ready', all);
    if (S.ui.hint) S.ui.hint.hidden = all;
  }

  async function flip(i) {
    if (S.up[i] || S.flipping.has(i) || S.dead) return;
    const inst = S.cards[i];
    const node = S.ui.cardNodes[i];
    const rank = TIER_BY_ID[inst.tier].rank;
    const fan = fanfare();
    S.flipping.add(i);
    node.classList.remove('is-dealing'); // turned mid-deal: the deal animation must not restart later
    if (rank === 4 && fan !== 'off' && !S.reduced && !S.skipping) {
      // the held beat: the card lifts and trembles while a riser swells
      node.classList.add('is-charging');
      sfx.play('riser', { dur: ms(fan === 'full' ? 950 : 480) / 1000 });
      await wait(ms(fan === 'full' ? 950 : 480));
      node.classList.remove('is-charging');
      if (S.dead) return;
    } else if (rank === 3 && fan === 'full' && !S.reduced && !S.skipping) {
      node.classList.add('is-charging', 'is-short');
      await wait(ms(260));
      node.classList.remove('is-charging', 'is-short');
      if (S.dead) return;
    }
    if (S.up[i]) { S.flipping.delete(i); return; } // turned by "turn all" during the beat
    turnUp(i);
    sfx.play('flip', { rank, level: fan });
    if (rank === 4 && fan !== 'off') { sfx.play('sting', { level: fan, delay: 0.08 }); legendaryFlash(); }
    announce(`${itemLabel(inst)}. Arms ${armsRating(inst)}.${itemDef(inst.itemId).gameItem ? ' A game item, not history.' : ''}`);
    S.flipping.delete(i);
    updateRevealFoot();
    await wait(ms(560));
  }
  function turnUp(i) {
    const node = S.ui.cardNodes[i];
    S.up[i] = true;
    node.classList.remove('is-pending');
    node.classList.add('is-up');
    node.setAttribute('aria-label', itemLabel(S.cards[i]));
    if (TIER_BY_ID[S.cards[i].tier].rank === 4 && !S.reduced && fanfare() !== 'off') node.classList.add('is-burst');
  }
  function legendaryFlash() {
    if (S.reduced) return;
    flash.classList.remove('is-on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('is-on');
  }
  function skipAll() {
    if (S.step !== 'b' || S.up.every(Boolean)) return;
    S.skipping = true;
    const n = S.cards.length;
    for (let i = S.dealt; i < n; i++) S.ui.cardNodes[i].classList.remove('is-pending');
    S.dealt = n;
    let top = 0;
    for (let i = 0; i < n; i++) {
      S.ui.cardNodes[i].classList.remove('is-charging', 'is-short', 'is-dealing');
      if (!S.up[i]) { top = Math.max(top, TIER_BY_ID[S.cards[i].tier].rank); turnUp(i); }
    }
    S.flipping.clear();
    const fan = fanfare();
    sfx.play('flip', { rank: Math.min(top, 3), level: fan });
    if (top === 4 && fan !== 'off') { sfx.play('sting', { level: fan, delay: 0.08 }); legendaryFlash(); }
    const counts = {};
    for (const c of S.cards) counts[c.tier] = (counts[c.tier] || 0) + 1;
    announce(`All cards turned: ${Object.entries(counts).map(([t, k]) => `${k} ${TIER_BY_ID[t].name}`).join(', ')}.`);
    updateRevealFoot();
    S.ui.revealBtn.focus({ preventScroll: true });
  }

  // ---- c. issue ---------------------------------------------------------------------------------------------
  function heldItem() {
    return S.held === null ? null : S.tray[S.held] || null;
  }
  function brigCols() {
    const w = stage.clientWidth;
    return w >= 860 ? 3 : w >= 540 ? 2 : 1;
  }
  function renderIssue(focus) {
    stage.replaceChildren();
    const done = primary('Done', () => { sfx.play('whoosh'); go('d'); });
    const grid = el('div', { class: 'rw-brigs', role: 'group', 'aria-label': 'Brigades and batteries' });
    S.army.forEach((b, i) => grid.append(brigCard(b, i)));
    grid.style.setProperty('--bcols', String(brigCols()));
    const tray = el('div', { class: 'rw-tray', role: 'group', 'aria-label': `Loot tray: ${S.tray.length} card${S.tray.length === 1 ? '' : 's'}` });
    S.tray.forEach((it, t) => tray.append(trayTile(it, t)));
    if (!S.tray.length) tray.append(el('p', { class: 'rw-dim rw-tray-empty', text: 'Every card has been issued.' }));
    const sec = el('section', { class: 'rw-step rw-issue', 'aria-labelledby': 'rw-issue-title' },
      el('header', { class: 'rw-head rw-head-row' },
        el('div', {},
          el('p', { class: 'rw-eyebrow', text: 'Issue the arms' }),
          el('h2', { id: 'rw-issue-title', class: 'rw-title', text: 'Who gets what?' }),
          el('p', { class: 'rw-hint' },
            el('span', { class: 'rw-only-keys' }, 'Drag a card onto a brigade. Or select a card, arrow to a brigade and press ', el('kbd', { text: 'Enter' }), '.'),
            el('span', { class: 'rw-only-touch', text: 'Drag a card onto a brigade, or tap a card and then a brigade.' }))),
        done),
      el('div', { class: 'rw-brigs-wrap' }, grid),
      el('div', { class: 'rw-tray-wrap' },
        el('p', { class: 'rw-tray-label' }, el('b', { text: 'Loot tray' }), el('span', { text: ` ${S.tray.length} card${S.tray.length === 1 ? '' : 's'} · what is left goes to the depot` })),
        tray));
    stage.append(sec);
    S.ui.grid = grid;
    S.ui.tray = tray;
    S.ui.doneBtn = done;

    grid.addEventListener('click', (e) => {
      const c = e.target.closest('.rw-brig');
      if (c) chooseBrigade(Number(c.dataset.b));
    });
    tray.addEventListener('pointerdown', onTilePointerDown);
    tray.addEventListener('contextmenu', (e) => e.preventDefault());
    refreshHeld();
    if (focus && focus.brig !== undefined) grid.querySelector(`[data-b="${focus.brig}"]`)?.focus({ preventScroll: false });
    else if (focus && focus.tile !== undefined) (tray.querySelector(`[data-t="${focus.tile}"]`) || tray.querySelector('.rw-tile') || done).focus({ preventScroll: true });
    else (tray.querySelector('.rw-tile') || done).focus({ preventScroll: true });
    if (!focus) announce(`Issue the arms. ${S.tray.length} cards in the tray, ${S.army.length} brigades and batteries.`);
  }

  /** Stars, previews and blocked labels for the card being held. */
  function refreshHeld() {
    const item = heldItem();
    const grid = S.ui.grid;
    if (!grid) return;
    for (const tile of S.ui.tray.querySelectorAll('.rw-tile')) {
      const on_ = Number(tile.dataset.t) === S.held;
      tile.classList.toggle('is-held', on_);
      tile.setAttribute('aria-pressed', String(on_));
    }
    const best = item ? bestFit(S.army, item) : null;
    const showStar = get('screens.bestFitStar') !== false;
    grid.classList.toggle('is-holding', !!item);
    S.army.forEach((b, i) => {
      const node = grid.querySelector(`[data-b="${i}"]`);
      if (!node) return;
      const star = node.querySelector('.rw-star');
      const prev = node.querySelector('.rw-preview');
      const blocked = node.querySelector('.rw-blocked');
      let label = node.getAttribute('aria-label').replace(/\. (Best fit|Would gain|Would lose|No change|Cannot carry).*$/, '');
      if (!item) {
        star.hidden = true; prev.textContent = ''; blocked.hidden = true;
        node.classList.remove('is-blocked', 'is-best');
        node.setAttribute('aria-label', label);
        return;
      }
      const c = compare(b, item);
      if (!c.ok) {
        star.hidden = true; prev.textContent = '';
        blocked.hidden = false; blocked.textContent = b.men === 0 || (b.kind === 'battery' && b.guns === 0) ? 'Depleted' : b.kind === 'battery' ? 'Guns only' : 'Small arms only';
        node.classList.add('is-blocked'); node.classList.remove('is-best');
        node.setAttribute('aria-label', `${label}. Cannot carry this card: ${c.reason}.`);
        return;
      }
      const isBest = best === b && c.delta.ovr > 0 && showStar;
      blocked.hidden = true;
      node.classList.remove('is-blocked');
      node.classList.toggle('is-best', isBest);
      star.hidden = !isBest;
      prev.textContent = fmtDelta(c.delta.ovr);
      prev.className = `rw-preview ${deltaClass(c.delta.ovr)}`;
      const words = c.delta.ovr > 0 ? `Would gain ${c.delta.ovr} OVR` : c.delta.ovr < 0 ? `Would lose ${-c.delta.ovr} OVR` : 'No change in OVR';
      node.setAttribute('aria-label', `${label}. ${isBest ? 'Best fit. ' : ''}${words}.`);
    });
  }

  function selectTile(t, { moveFocus = false } = {}) {
    if (S.held === t) { S.held = null; sfx.play('cancel'); refreshHeld(); return; }
    S.held = t;
    sfx.play('select');
    refreshHeld();
    const item = heldItem();
    const best = bestFit(S.army, item);
    const fit = best ? S.army.indexOf(best) : -1;
    announce(`${itemLabel(item)} selected.${fit >= 0 ? ` Best fit: ${S.army[fit].label}.` : ' No brigade can carry it.'} Choose a brigade.`);
    if (moveFocus) {
      const target = fit >= 0 ? fit : S.army.findIndex((b) => canCarry(b, item));
      S.ui.grid.querySelector(`[data-b="${Math.max(0, target)}"]`)?.focus({ preventScroll: false });
    }
  }

  function chooseBrigade(i) {
    const item = heldItem();
    if (!item) {
      announce('Pick a card from the loot tray first.');
      S.ui.tray?.classList.remove('is-nudge');
      void S.ui.tray?.offsetWidth;
      S.ui.tray?.classList.add('is-nudge');
      return;
    }
    const c = compare(S.army[i], item);
    if (!c.ok) {
      sfx.play('cancel');
      announce(`${S.army[i].label} cannot carry it. ${c.reason}.`);
      const node = S.ui.grid.querySelector(`[data-b="${i}"]`);
      node?.classList.remove('is-shake');
      void node?.offsetWidth;
      node?.classList.add('is-shake');
      return;
    }
    openCompare(S.held, i);
  }

  // drag from the tray (mouse, pen, touch). touch-action: pan-x on the tray keeps sideways scrolling.
  function onTilePointerDown(e) {
    const tile = e.target.closest('.rw-tile');
    if (!tile || (e.pointerType === 'mouse' && e.button !== 0) || S.comparing) return;
    const t = Number(tile.dataset.t);
    S.drag = { t, id: e.pointerId, x0: e.clientX, y0: e.clientY, tile, ghost: null, over: null };
    try { tile.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
    tile.addEventListener('pointermove', onDragMove);
    tile.addEventListener('pointerup', onDragEnd);
    tile.addEventListener('pointercancel', onDragCancel);
    tile.addEventListener('lostpointercapture', onDragCancel);
  }
  function detachDrag(tile) {
    tile.removeEventListener('pointermove', onDragMove);
    tile.removeEventListener('pointerup', onDragEnd);
    tile.removeEventListener('pointercancel', onDragCancel);
    tile.removeEventListener('lostpointercapture', onDragCancel);
  }
  function onDragMove(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_PX) return;
      const r = d.tile.getBoundingClientRect();
      d.dx = d.x0 - r.left;
      d.dy = d.y0 - r.top;
      d.ghost = d.tile.cloneNode(true);
      d.ghost.className += ' rw-ghost';
      d.ghost.removeAttribute('tabindex');
      d.ghost.removeAttribute('role');
      d.ghost.setAttribute('aria-hidden', 'true');
      d.ghost.style.width = `${r.width}px`;
      rootEl.append(d.ghost);
      d.tile.classList.add('is-lifted');
      if (S.held !== d.t) { S.held = d.t; sfx.play('select'); refreshHeld(); }
    }
    e.preventDefault();
    d.ghost.style.transform = `translate(${e.clientX - d.dx}px, ${e.clientY - d.dy}px) rotate(-3deg) scale(1.04)`;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const over = hit && hit.closest ? hit.closest('.rw-brig') : null;
    if (over !== d.over) {
      d.over?.classList.remove('is-over');
      over?.classList.add('is-over');
      d.over = over;
    }
  }
  function onDragEnd(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    finishDrag(true);
  }
  function onDragCancel() {
    finishDrag(false);
  }
  function finishDrag(dropped) {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    detachDrag(d.tile);
    try { d.tile.releasePointerCapture(d.id); } catch { /* already released */ }
    d.tile.classList.remove('is-lifted');
    d.ghost?.remove();
    d.over?.classList.remove('is-over');
    if (!d.ghost) {
      if (dropped) selectTile(d.t); // a tap, not a drag
      return;
    }
    if (dropped && d.over) chooseBrigade(Number(d.over.dataset.b));
    else { sfx.play('cancel'); }
  }

  // ---- compare --------------------------------------------------------------------------------------------
  function openCompare(t, b) {
    const item = S.tray[t];
    const br = S.army[b];
    const c = compare(br, item);
    const best = bestFit(S.army, item);
    const isBest = best === br && c.delta.ovr > 0 && get('screens.bestFitStar') !== false;
    S.comparing = { t, b };
    sfx.play('select');

    const vw = stage.clientWidth;
    const cw = Math.max(120, Math.min(184, Math.floor((vw - 340) / 2)));
    const rows = el('div', { class: 'rw-cmp-rows', role: 'table', 'aria-label': 'Ratings now and after' });
    for (const [k, name] of [['arms', 'Arms'], ...BARS]) {
      const d = c.delta[k];
      rows.append(el('div', { class: 'rw-cmp-row', role: 'row', 'aria-label': `${name} ${c.before[k]} to ${c.after[k]}, ${deltaWords(d)}` },
        el('span', { class: 'rw-cmp-k', role: 'rowheader', text: name }),
        el('span', { class: 'rw-cmp-v', role: 'cell', text: String(c.before[k]) }),
        el('span', { class: 'rw-cmp-arrow', role: 'cell', 'aria-hidden': 'true', text: '→' }),
        el('span', { class: 'rw-cmp-v is-new', role: 'cell', text: String(c.after[k]) }),
        el('span', { class: `rw-cmp-d ${deltaClass(d)}`, role: 'cell', text: fmtDelta(d) })));
    }
    const dOvr = c.delta.ovr;
    const ovr = el('div', { role: 'group', class: `rw-cmp-ovr ${deltaClass(dOvr)}`, 'aria-label': `OVR ${c.before.ovr} to ${c.after.ovr}, ${deltaWords(dOvr)}` },
      el('span', { class: 'rw-cmp-ovr-k', 'aria-hidden': 'true', text: 'OVR' }),
      el('span', { class: 'rw-cmp-ovr-nums', 'aria-hidden': 'true' },
        el('b', { class: 'rw-cmp-old', text: String(c.before.ovr) }),
        el('span', { class: 'rw-cmp-to', text: '→' }),
        el('b', { class: 'rw-cmp-new', text: String(c.after.ovr) })),
      el('span', { class: 'rw-cmp-ovr-d', 'aria-hidden': 'true', text: fmtDelta(dOvr) }));
    const def = itemDef(item.itemId);
    const cancel = el('button', { type: 'button', class: 'rw-secondary' }, 'Cancel ', el('kbd', { 'aria-hidden': 'true', text: 'Esc' }));
    const confirm = primary(`Issue to ${br.label}`, () => confirmCompare());
    cancel.addEventListener('click', () => closeCompare(true));
    const dlg = el('div', { class: 'rw-cmp rw-themed', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rw-cmp-title', style: `--cw:${cw}px` },
      el('div', { class: 'rw-cmp-head' },
        el('h2', { id: 'rw-cmp-title', class: 'rw-title', text: `${br.label}: issue this card?` }),
        isBest ? el('span', { class: 'rw-star' }, el('span', { 'aria-hidden': 'true', text: '★ ' }), 'Best fit: gains most') : null),
      el('div', { class: 'rw-cmp-grid' },
        el('figure', { class: 'rw-cmp-side' }, el('figcaption', { text: 'Current' }), staticCard(br.weapon)),
        el('div', { class: 'rw-cmp-mid' }, ovr, rows),
        el('figure', { class: 'rw-cmp-side is-new' }, el('figcaption', { text: 'New' }), staticCard(item),
          def.gameItem ? el('p', { class: 'rw-flavour', text: `“${def.flavour}”` }) : null)),
      el('div', { class: 'rw-cmp-actions' }, cancel, confirm));
    const back = el('div', { class: 'rw-cmp-back' }, dlg);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeCompare(true); });
    rootEl.append(back);
    S.ui.cmp = back;
    S.ui.cmpDialog = dlg;
    applyStyle();
    confirm.focus({ preventScroll: true });
    announce(`${br.label}. OVR ${c.before.ovr} to ${c.after.ovr}, ${deltaWords(dOvr)}.${isBest ? ' Best fit.' : ''} Enter to issue, Escape to cancel.`);
  }
  function closeCompare(cancelled) {
    if (!S.comparing) return;
    const { t } = S.comparing;
    S.comparing = null;
    S.ui.cmp?.remove();
    S.ui.cmp = S.ui.cmpDialog = null;
    if (cancelled) {
      sfx.play('cancel');
      S.held = null;
      refreshHeld();
      S.ui.tray.querySelector(`[data-t="${t}"]`)?.focus({ preventScroll: true });
      announce('Cancelled. The card is back in the tray.');
    }
  }
  function confirmCompare() {
    if (!S.comparing) return;
    const { t, b } = S.comparing;
    const item = S.tray[t];
    const before = ratings(S.army[b]).ovr;
    const { brigade, displaced } = equip(S.army[b], item);
    S.army[b] = brigade;
    S.tray.splice(t, 1);
    S.tray.push(displaced);
    S.log.push({ brigade: brigade.id, item: item.uid, displaced: displaced.uid });
    S.held = null;
    closeCompare(false);
    sfx.play('equip');
    renderIssue({ brig: b });
    applyStyle();
    const node = S.ui.grid.querySelector(`[data-b="${b}"]`);
    node?.classList.add('is-issued');
    const after = ratings(brigade).ovr;
    const d = node?.querySelector('.rw-delta');
    if (d) { d.textContent = fmtDelta(after - before); d.className = `rw-delta ${deltaClass(after - before)} is-shown`; }
    announce(`${brigade.label} now carries ${itemLabel(item)}. OVR ${before} to ${after}. ${itemDef(displaced.itemId).name} goes to the depot.`);
  }

  // ---- d. rating count-ups ---------------------------------------------------------------------------------
  function renderCounts() {
    const before = S.armyStart.map((b) => ratings(b));
    const after = S.army.map((b) => ratings(b));
    const changed = S.army.map((b, i) => b.weapon.uid !== S.armyStart[i].weapon.uid);
    const nChanged = changed.filter(Boolean).length;
    const grid = el('div', { class: 'rw-brigs is-static', role: 'list', 'aria-label': 'The army after the issue' });
    S.army.forEach((b, i) => {
      const node = brigCard(b, i, { interactive: false, show: changed[i] ? before[i] : after[i] });
      if (changed[i]) node.querySelector('.rw-bweap').append(el('span', { class: 'rw-was', text: `was ${itemDef(S.armyStart[i].weapon.itemId).name}` }));
      grid.append(node);
    });
    grid.style.setProperty('--bcols', String(brigCols()));
    const btn = primary('Continue', onContinue);
    const depot = S.tray.length;
    const sec = el('section', { class: 'rw-step rw-counts', 'aria-labelledby': 'rw-counts-title' },
      el('header', { class: 'rw-head' },
        el('p', { class: 'rw-eyebrow', text: 'Ratings' }),
        el('h2', { id: 'rw-counts-title', class: 'rw-title', text: completed ? 'Saved army' : nChanged ? 'The army after the issue' : 'No arms issued' }),
        el('p', { class: 'rw-hint', text: `Depot: ${depot} card${depot === 1 ? '' : 's'} kept in the wagons.` })),
      el('div', { class: 'rw-brigs-wrap' }, grid),
      el('div', { class: 'rw-foot' }, btn));
    stage.append(sec);
    S.ui.grid = grid;
    btn.focus({ preventScroll: true });
    announce(completed ? `Saved army. ${S.log.length} cards issued; ${depot} in the depot.` : nChanged
      ? S.army.filter((_, i) => changed[i]).map((b) => { const i = S.army.indexOf(b); return `${b.label}: OVR ${before[i].ovr} to ${after[i].ovr}`; }).join('. ')
      : 'No arms issued. The depot keeps every card.');
    S.counting = true;
    S.fast = false;
    (async () => {
      await wait(ms(450));
      for (let i = 0; i < S.army.length; i++) {
        if (S.dead || S.step !== 'd') return;
        if (!changed[i]) continue;
        await countUp(grid.querySelector(`[data-b="${i}"]`), before[i], after[i]);
        await wait(ms(260));
      }
      S.counting = false;
    })();
  }

  function countUp(node, from, to) {
    const keys = ['ovr', ...BARS.map(([k]) => k)];
    const show = (k, v) => {
      if (k === 'ovr') node.querySelector('.rw-ovr-v').textContent = String(v);
      else {
        const bar = node.querySelector(`.rw-bar[data-k="${k}"]`);
        bar.querySelector('.rw-fill').style.width = `${v}%`;
        bar.querySelector('.rw-bar-v').textContent = String(v);
      }
    };
    const finish = () => {
      for (const k of keys) show(k, to[k]);
      const d = to.ovr - from.ovr;
      const mark = node.querySelector('.rw-delta');
      mark.textContent = fmtDelta(d);
      mark.className = `rw-delta ${deltaClass(d)} is-shown`;
      for (const [k] of BARS) {
        const bd = to[k] - from[k];
        const m = node.querySelector(`.rw-bar[data-k="${k}"] .rw-bar-d`);
        m.textContent = bd ? fmtDelta(bd) : '';
        m.className = `rw-bar-d ${deltaClass(bd)}`;
      }
      node.classList.remove('is-counting');
      node.classList.add('is-counted', d >= 0 ? 'went-up' : 'went-down');
      sfx.play(d >= 0 ? 'up' : 'down');
    };
    const D = S.fast ? 0 : ms(1000);
    node.classList.add('is-counting');
    if (!D) { finish(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const t0 = performance.now();
      let shown = from.ovr;
      let lastTick = 0;
      let step = 0;
      const frame = (now) => {
        S.rafs.delete(id);
        if (S.dead) return resolve();
        const p = S.fast ? 1 : Math.min(1, (now - t0) / D);
        const e = 1 - Math.pow(1 - p, 3);
        for (const k of keys) show(k, Math.round(from[k] + (to[k] - from[k]) * e));
        const o = Math.round(from.ovr + (to.ovr - from.ovr) * e);
        if (o !== shown && now - lastTick > 45) { shown = o; lastTick = now; sfx.play('tick', { step: step++ }); }
        if (p < 1) { id = requestAnimationFrame(frame); S.rafs.add(id); } else { finish(); resolve(); }
      };
      let id = requestAnimationFrame(frame);
      S.rafs.add(id);
    });
  }

  function onContinue() {
    if (S.dead) return;
    if (S.counting) { // first press finishes the count-ups at once
      S.fast = true;
      flushWaits();
      return;
    }
    const result = {
      awardId: S.awardId,
      army: S.army.map((b) => ({ ...b, base: { ...b.base }, weapon: { ...b.weapon }, ovr: ratings(b).ovr })),
      depot: S.tray.map((it) => ({ ...it })),
      issued: S.log.slice(),
      seed: S.seed,
      grade: S.grade,
    };
    const cb = S.onDone;
    unmount();
    if (typeof cb === 'function') cb(result);
  }

  // ---- keyboard ------------------------------------------------------------------------------------------------
  function isNativeButton(t) {
    return t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'A');
  }
  function focusables(container) {
    return [...container.querySelectorAll('button, [tabindex="0"]')].filter((n) => !n.disabled && n.offsetParent !== null);
  }
  function onKey(e) {
    if (S.dead || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('.sb-panel, .sb-compare, .sb-toggle')) return;
    const native = isNativeButton(t);
    const key = e.key;

    if (S.comparing) {
      if (key === 'Escape') { e.preventDefault(); closeCompare(true); return; }
      if (key === 'Enter' && !native) { e.preventDefault(); confirmCompare(); return; }
      if (key === 'Tab') { // keep focus inside the compare dialog
        const list = focusables(S.ui.cmpDialog);
        if (!list.length) return;
        const i = list.indexOf(document.activeElement);
        const j = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i === list.length - 1 ? 0 : i + 1);
        e.preventDefault();
        list[j].focus();
      }
      return;
    }

    if (S.step === 'a') {
      if (key === 'Enter' && !native) { e.preventDefault(); sfx.play('whoosh'); go('b'); }
      return;
    }

    if (S.step === 'b') {
      const card = t && t.closest ? t.closest('.rw-card') : null;
      if ((key === ' ' || key === 'Enter') && card && !native) {
        e.preventDefault();
        const i = Number(card.dataset.i);
        if (!S.up[i] && i < S.dealt) flip(i);
        else if (key === 'Enter' && S.up.every(Boolean)) onRevealPrimary();
        return;
      }
      if (key === ' ' && !native) { e.preventDefault(); if (!e.repeat) onRevealPrimary(); return; }
      if (key === 'Enter' && !native) { e.preventDefault(); onRevealPrimary(); return; }
      if ((key === 's' || key === 'S') && !e.repeat) { e.preventDefault(); skipAll(); return; }
      if (key === ' ' && native) { if (e.repeat) e.preventDefault(); }
      return;
    }

    if (S.step === 'c') {
      const tile = t && t.closest ? t.closest('.rw-tile') : null;
      const brig = t && t.closest ? t.closest('.rw-brig') : null;
      const tiles = [...S.ui.tray.querySelectorAll('.rw-tile')];
      const brigs = [...S.ui.grid.querySelectorAll('.rw-brig')];
      const cols = brigCols();
      if (key === 'Escape' && S.held !== null) {
        e.preventDefault();
        const h = S.held;
        S.held = null;
        sfx.play('cancel');
        refreshHeld();
        S.ui.tray.querySelector(`[data-t="${h}"]`)?.focus();
        announce('Card put back.');
        return;
      }
      if (tile) {
        const i = tiles.indexOf(tile);
        if (key === 'Enter' || key === ' ') { e.preventDefault(); selectTile(Number(tile.dataset.t), { moveFocus: true }); return; }
        if (key === 'ArrowRight' || key === 'ArrowLeft') { e.preventDefault(); tiles[(i + (key === 'ArrowRight' ? 1 : tiles.length - 1)) % tiles.length]?.focus(); return; }
        if (key === 'ArrowUp') {
          e.preventDefault();
          const item = heldItem();
          const best = item ? bestFit(S.army, item) : null;
          brigs[best ? S.army.indexOf(best) : brigs.length - 1]?.focus();
          return;
        }
        return;
      }
      if (brig) {
        const i = brigs.indexOf(brig);
        let j = -1;
        if (key === 'ArrowRight') j = Math.min(brigs.length - 1, i + 1);
        else if (key === 'ArrowLeft') j = Math.max(0, i - 1);
        else if (key === 'ArrowUp') j = i - cols >= 0 ? i - cols : i;
        else if (key === 'ArrowDown') {
          if (i + cols < brigs.length) j = i + cols;
          else { e.preventDefault(); (S.ui.tray.querySelector(`[data-t="${S.held}"]`) || tiles[0] || S.ui.doneBtn).focus(); return; }
        }
        if (j >= 0) { e.preventDefault(); brigs[j].focus(); return; }
        if (key === 'Enter' || key === ' ') { e.preventDefault(); chooseBrigade(Number(brig.dataset.b)); return; }
      }
      return;
    }

    if (S.step === 'd') {
      if (key === 'Enter' && !native) { e.preventDefault(); onContinue(); }
    }
  }
  document.addEventListener('keydown', onKey);

  // ---- settings and layout listeners ----
  sfx.setSoundOn(get('screens.sound') !== false);
  S.unsubs.push(
    on('screens.sound', (v) => sfx.setSoundOn(v)),
    on('screens.revealSpeed', () => applyVars()),
    on('screens.fanfare', () => applyVars()),
    on('screens.cardStyle', () => applyStyle()),
    on('screens.bestFitStar', () => { if (S.step === 'c') refreshHeld(); }),
    onCompare(() => applyStyle()),
  );
  const onMotion = () => { S.reduced = !!motionQuery.matches; applyVars(); };
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotion);
    else if (motionQuery.addListener) motionQuery.addListener(onMotion);
  }
  let resizeRaf = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (S.dead) return;
      fitCards();
      if (S.ui.grid) S.ui.grid.style.setProperty('--bcols', String(brigCols()));
      applyStyle();
    });
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(stage);
  window.addEventListener('resize', onResize);

  function unmount() {
    if (S.dead) return;
    S.dead = true;
    for (const id of S.timers) clearTimeout(id);
    for (const id of S.rafs) cancelAnimationFrame(id);
    cancelAnimationFrame(resizeRaf);
    S.timers.clear();
    S.rafs.clear();
    S.waiters.clear();
    for (const u of S.unsubs) u();
    if (motionQuery) {
      if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotion);
      else if (motionQuery.removeListener) motionQuery.removeListener(onMotion);
    }
    if (S.drag) { S.drag.ghost?.remove(); detachDrag(S.drag.tile); S.drag = null; }
    ro?.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    rootEl.remove();
    if (active === api) active = null;
    opts.onClose?.();
  }

  const api = { unmount, state: S };
  active = api;
  applyVars();
  go(completed ? 'd' : S.mode === 'one' ? 'b' : 'a');
  return api;
}

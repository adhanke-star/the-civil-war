// src/ui/hud.js: the battle HUD: brigade markers, the bottom dock (unit card, orders, minimap), the top strip
// (clock, pause, speeds, army list button, balance bar), the army list, the event feed, the auto-pause banner
// and the ghost label. Markers move every frame (O(units)); their text and the card refresh 4 times a second.
// Delegation (Game.delegate): the card's Delegate button (G) starts picking a place (ui/input.js, via onDelegate);
// the chooser (openDelegate) asks Attack, Defend or Support by button or key (A / D / S; Esc cancels, nothing
// changes) and returns focus to the field. The card shows "Delegated: <role>" and Undo (Game.undelegate).
// Command (Game "Command"): a brigade whose commander fell shows "Commander down" on its marker and card (the
// successor stays "next in command" unless the data names a sourced one); the card says when a general's rally
// radius covers the brigade and lists its regiments (focus or hover one: a tooltip names it; not orderable).
// Hovering a regiment block on the field shows the same tooltip. Each general has a small star marker; selecting
// it shows his rally radius (Game.selectCommander) and describes him in the empty card.
// Cavalry: the marker's staff stands on a horseshoe; the card's cavalry row says Mounted, Dismounted, Dismounting or
// Remounting with the reach of its arms, and its Dismount toggle (N; pressed = on foot) orders orderSelected('dismount').
// Badges (src/franchise/badges.js): the card shows the selected formation's badges from its definition (shape, tier
// letter and name in each emblem's label; the camp's emblems, styled in src/reward/reward.css). An X-Factor brigade's card
// and flag carry a warm glow (has-xfactor); its moment in battle arrives through showMoment (src/fx/effects.js).
// Camp (P5d): the card's camp line (#uc-camp, under the command line) names what reached this battle from camp (camp training,
// a shortage of shoes, ammunition or horses, pioneers; badges.js campEffectLines on its definition), with the rounds it has
// now when it started short, labelled game rules; hidden for a formation without any.
// Settings (src/ui/settings-panel.js): the strip's Settings button, "All settings" in the menu and the O key
// (src/ui/input.js) open the panel (quality, volumes, gore, X-Factor effects); the help sheet lists the key.
// Portraits (P6b, src/ui/art.js): the unit card shows the commander's period portrait when one is sourced for exactly his
// name (assets/art/manifest.json), the generic silhouette otherwise; a scenario's own commander.portrait still comes first.
// Feedback readability (DECISIONS 0109): the event feed and toasts sit on the field without a box (a translucent backing
// behind each row's text only, a text shadow); the feed shows its 3 newest rows and scrolls to the newest (older ones
// scroll up out of view, still reachable by keyboard, wheel and touch); toasts keep at most 3, below the objective line.
// Temperament (P3t; assets/traits.json via src/ui/briefing.js): in a phase whose data gives commanders traits, an enemy
// formation's card shows its own commander's traits (while he is up) and its army commander's as plain labels, the game rule
// they drive and each man's provenance, with a record note where one is part of his record (Chalmers at Fort Pillow);
// "Records and sources" opens a dialog (keyboard: Esc or Close returns focus; the battle pauses while it is open) with each
// trait's claim and its opened sources as links. The enemy flag's tooltip names the traits too.

import * as THREE from 'three';
import { LOOK } from './look.js';
import { on as onSetting } from '../settings.js';
import { Minimap } from './minimap.js';
import { BADGE_BY_ID, TIER_NAMES, campEffectLines } from '../franchise/badges.js';
import { openSettings } from './settings-panel.js';
import { loadArt, portraitArt, genericPortrait, portraitLine } from './art.js';
import { loadTraits, formationTraits, traitRuleLine, traitDetails, commanderTitle } from './briefing.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

/** A nearby visible nonoverlapping marker rectangle; y is its bottom edge. */
export function markerPosition(s, placed, bounds, obstacles = []) {
  const x = Math.min(bounds.right - s.w / 2, Math.max(bounds.left + s.w / 2, s.x));
  const y = Math.min(bounds.bottom, Math.max(bounds.top + s.h, s.y));
  const candidates = [{ x, y }];
  const occupied = [...placed, ...obstacles];
  for (const p of occupied) candidates.push(
    { x, y: p.y - p.h - 3 }, { x, y: p.y + s.h + 3 },
    { x: p.x - (p.w + s.w) / 2 - 3, y }, { x: p.x + (p.w + s.w) / 2 + 3, y },
  );
  candidates.sort((a, b) => ((a.x - s.x) ** 2 + (a.y - s.y) ** 2) - ((b.x - s.x) ** 2 + (b.y - s.y) ** 2));
  const fits = (c) => c.x - s.w / 2 >= bounds.left && c.x + s.w / 2 <= bounds.right && c.y - s.h >= bounds.top && c.y <= bounds.bottom;
  const hits = (c, p) => Math.abs(p.x - c.x) < (p.w + s.w) / 2 + 2 && c.y > p.y - p.h - 2 && c.y - s.h < p.y + 2;
  const free = (c) => fits(c) && !occupied.some((p) => hits(c, p));
  const nearby = candidates.find(free);
  if (nearby) return nearby;
  // A dense cluster can need diagonal space; use a bounded grid only when the nearby candidates fail.
  let best = null, distance = Infinity;
  for (let yy = bounds.top + s.h; yy <= bounds.bottom; yy += s.h + 3) {
    for (let xx = bounds.left + s.w / 2; xx <= bounds.right - s.w / 2; xx += s.w + 3) {
      const p = { x: xx, y: yy }, d = (xx - s.x) ** 2 + (yy - s.y) ** 2;
      if (d < distance && free(p)) { best = p; distance = d; }
    }
  }
  return best || { x, y }; // physically overfull views still retain a visible control
}

// Flags for 21 July 1861: the US flag (34 stars from 4 July 1861) and the Confederate First National
// flag ("Stars and Bars", 11 stars from 2 July 1861). The battle flag came only after this battle.
function usFlag() {
  let stripes = '';
  for (let i = 0; i < 13; i++) stripes += `<rect y="${i * 2}" width="38" height="2" fill="${i % 2 ? '#fff' : '#c22'}"/>`;
  let stars = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) stars += `<circle cx="${2 + c * 3.2}" cy="${2 + r * 3}" r="0.7" fill="#fff"/>`;
  return `<g>${stripes}<rect width="17" height="14" fill="#2a3d8a"/>${stars}</g>`;
}
function csFlag() {
  let stars = '';
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    stars += `<circle cx="${8.5 + Math.cos(a) * 4.6}" cy="${8.7 + Math.sin(a) * 4.6}" r="0.75" fill="#fff"/>`;
  }
  return `<g><rect width="38" height="8.7" fill="#c22"/><rect y="8.7" width="38" height="8.6" fill="#fff"/><rect y="17.3" width="38" height="8.7" fill="#c22"/><rect width="17" height="17.3" fill="#2a3d8a"/>${stars}</g>`;
}
/** The marker: a small national flag on a staff (a gun's wheel at the foot for a battery). */
function markerSvg(side, type) {
  const flag = side === 'US' ? usFlag() : csFlag();
  const foot = type === 'artillery'
    ? '<circle cx="5" cy="31" r="3.2" fill="none" stroke="#e8dcc0" stroke-width="1.3"/>'
    : type === 'cavalry'
      ? '<path d="M2.2 33 v-3.4 a2.8 2.8 0 0 1 5.6 0 v3.4" fill="none" stroke="#e8dcc0" stroke-width="1.4"/>' // a horseshoe
      : '<path d="M5 26 l-2 6 h4z" fill="#e8dcc0"/>';
  return `<svg viewBox="0 0 40 34" aria-hidden="true"><line x1="5" y1="1" x2="5" y2="33" stroke="#e8dcc0" stroke-width="1.6"/><circle cx="5" cy="1.6" r="1.6" fill="#e8c96a"/>
    <g transform="translate(6 3) scale(0.86)">${flag}</g>${foot}</svg>`;
}

export function flagDataUrl(side) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 26">${side === 'US' ? usFlag() : csFlag()}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Compass word for a facing (forward = (sin f, cos f); +x east, +z south). */
export function compass(f) {
  const b = Math.atan2(Math.sin(f), -Math.cos(f)); // clockwise from north
  return COMPASS[((Math.round(b / (Math.PI / 4)) % 8) + 8) % 8];
}

/** What a unit is doing, in one or two words, and a tone for its colour. */
export function activity(u) {
  if (u.state === 'routing') return ['Routing', 'bad'];
  if (u.melee) return ['Hand to hand', 'bad'];
  if (u.switching) return [u.switching.to === 'mounted' ? 'Remounting' : 'Dismounting', 'warn'];
  const o = u.order.type;
  if (u.engaged) return [u.firing ? 'Halted, firing' : 'Halted to fight', 'hot'];
  if (u.follow.active) {
    if (o === 'charge') return ['Charging', 'hot'];
    if (o === 'fallback') return ['Falling back', 'warn'];
    if (o === 'attack') return [u.firing ? 'Closing, firing' : 'Closing to attack', 'hot'];
    if (u.firing) return ['Advancing, firing', 'hot'];
    return [u.formation === 'column' ? 'Marching in column' : u.run ? 'Advancing at the double' : 'Advancing', 'move'];
  }
  if (u.type === 'artillery' && !u.unlimbered) return ['Unlimbering', 'move'];
  if (u.firing) return [o === 'attack' ? 'Attacking' : 'Firing', 'hot'];
  if (u.holdFire && u.target) return ['Holding fire', 'warn'];
  if (u.masked && !u.holdFire) return ['Masked', 'warn']; // wants to fire, but friends stand across every line
  if (u.state === 'wavering') return ['Wavering', 'warn'];
  if (o === 'attack') return ['Attacking', 'hot'];
  return [o === 'hold' && u.order.firm ? 'Holding' : 'Halted', 'idle'];
}

const pathLength = (p) => {
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return len;
};

/** A sentence for the flag's tooltip: who, how many, what now and what next. */
export function intention(u) {
  const [now] = activity(u);
  let next = '';
  const o = u.order;
  if (o.type === 'attack' && o.target) {
    next = `; attacking ${o.target.short}: closes to effective range, halts and fires`;
  } else if ((u.follow.active || u.engaged) && u.path && u.path.length > 1) {
    const len = pathLength(u.path);
    const end = o.endFacing ?? u.facing;
    next = o.type === 'charge'
      ? `; ${Math.round(len)} m to the enemy, then hand-to-hand`
      : o.type === 'fallback'
        ? `; ${Math.round(len)} m back, then holds`
        : `; ${Math.round(len)} m to go, then holds facing ${compass(end)}`;
  } else if (u.state !== 'routing') {
    next = `; facing ${compass(u.facing)}`;
  }
  return `${u.name}: ${Math.round(u.men)} men, ${u.state}${u.type === 'cavalry' ? (u.mounted ? ', mounted' : ', dismounted') : ''}${u.holdFire ? ', holding fire' : ''}. ${now}${next}.`;
}

/** The card's cavalry line: in the saddle or on foot, the switch in progress, and the reach of its arms. */
export function mountText(u) {
  if (u.type !== 'cavalry') return '';
  if (u.switching) {
    const left = Math.max(0, Math.ceil(u.switching.dur - u.switching.t));
    return u.switching.to === 'mounted' ? `Remounting: ${left} s to the saddle.` : `Dismounting: ${left} s until the line can fire.`;
  }
  if (u.weapon === 'pistol') return 'Mounted: revolvers and sabres, 40 m.';
  return u.mounted ? 'Mounted: carbines from the saddle, 150 m.' : 'Dismounted: carbines, 300 m; every fourth man holds the horses.';
}

/** Plain words for a cover value from Game.coverAt. */
export const coverWord = (v) => (v >= 1.5 ? 'strong' : v >= 1.3 ? 'good' : 'light');
/** Historical minutes in words. */
export const minutesText = (m) => (m < 1 ? 'under a minute' : `${Math.round(m)} min`);

const titled = (rank, name) => (rank ? `${rank} ${name}` : name);
const rankShort = (r) => ({ General: 'Gen.', 'Major General': 'Maj. Gen.', 'Brigadier General': 'Brig. Gen.', Colonel: 'Col.', Captain: 'Capt.', Lieutenant: 'Lt.', 'First Lieutenant': '1st Lt.', Major: 'Maj.' }[r] || r || '');
const commanderLine = (u) => (u.commander && u.commander.name ? `${rankShort(u.commander.rank)} ${u.commander.name}`.trim() : '');
/** The card's name line: the commander, or his successor once he is down (generic unless sourced). */
function cardWho(u) {
  const c = u.commander;
  if (u.commandDown) {
    const s = c && c.successor;
    return s && s.name ? `${rankShort(s.rank)} ${s.name} (next in command)`.trim() : 'Next in command';
  }
  return c && c.name ? `${rankShort(c.rank)} ${c.name}` : u.name;
}
/** The card's command line: who fell, or which general's radius covers the brigade. */
function commandText(u, game) {
  const d = u.commandDown;
  if (d) return `Commander down: ${titled(d.rank, d.name)} ${d.kind}.`;
  const g = game && game.generalsOver ? game.generalsOver(u) : [];
  if (g.length) return `Rallied by ${rankShort(g[0].rank)} ${g[0].name} (within 300 m): faster rally, steadier morale.`;
  return '';
}
const STATE_WORD = { steady: 'Steady', shaken: 'Shaken', wavering: 'Wavering', routing: 'Routing' };
const STATE_GLYPH = { steady: '', shaken: '~', wavering: '!', routing: '✕' };
const ROLE_WORD = { attack: 'Attack', defend: 'Defend', support: 'Support' };
const ROLE_TIP = {
  attack: 'Attack: march there, form line, hold it and engage enemies within 150 m (A)',
  defend: 'Defend: go there and hold firm facing the enemy; counter-charge only a breaking foe (D)',
  support: 'Support: stay about 150 m behind the friend fighting there, follow it up and take its place if it breaks (S)',
};

export class Hud {
  constructor({ camera, canvas, terrain, units, playerSide, rts, game, onSelect, onOrder, onPause, onSpeed, onQuality, onSound }) {
    Object.assign(this, { camera, canvas, terrain, units, playerSide, rts, game, onSelect, onOrder });
    this.selected = null;
    // Card art loads beside the battle (about 25 KB, plus one small portrait per selected brigade); the card refreshes when it lands.
    loadArt().then(() => { if (this.selected) this.fillPortrait(this.selected); });
    // One bounded observer publishes overlay heights; none sizes its own observed element.
    const dock = $('dock');
    let layoutFrame = 0;
    this.dockObserver = new ResizeObserver(() => {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        const width = dock.getBoundingClientRect().width, css = getComputedStyle(document.documentElement);
        const wide = parseFloat(css.getPropertyValue('--dock-card-w')) + 3 * parseFloat(css.getPropertyValue('--dock-order-w'))
          + parseFloat(css.getPropertyValue('--mm')) + 36 + 16;
        const layout = width >= wide ? 'wide' : width >= 520 ? 'compact' : 'stacked';
        if (dock.dataset.layout !== layout) dock.dataset.layout = layout;
        document.documentElement.style.setProperty('--top-h', $('topbar').getBoundingClientRect().height + 'px');
        const height = dock.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--dock-h', height + 'px');
        document.documentElement.style.setProperty('--objective-h', $('objective').getBoundingClientRect().height + 'px');
      });
    });
    this.dockObserver.observe(dock);
    this.dockObserver.observe($('topbar'));
    this.dockObserver.observe($('objective'));
    // Native scroll defaults stay intact. Keyup still bubbles to clear previously held camera keys.
    $('unitcard').addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) e.stopPropagation();
    });
    $('unitcard').addEventListener('focus', () => { this.rts?.keys.clear(); if (this.rts) this.rts.inertia = null; });
    // Reading and native buttons own their keys. Defaults still scroll/click; keyup clears RTS keys.
    for (const id of ['topbar', 'army', 'field-stores', 'objective', 'tip', 'intro-hint', 'keyboard-targeting']) {
      const region = $(id);
      region.addEventListener('focusin', () => { this.rts?.keys.clear(); if (this.rts) this.rts.inertia = null; });
      region.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (id === 'army') { e.stopPropagation(); this.toggleArmy(false); }
          else if (id === 'field-stores') e.stopPropagation(); // Keep the existing same-element Close listener.
          else if (['objective', 'tip', 'intro-hint', 'keyboard-targeting'].includes(id)) this.canvas.focus({ preventScroll: true });
          return;
        }
        if (/^[a-z0-9?+\-=]$/i.test(e.key) || ['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) e.stopPropagation();
      });
    }
    this.markers = new Map();
    this.markerLinks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.markerLinks.setAttribute('class', 'marker-link'); this.markerLinks.setAttribute('aria-hidden', 'true'); this.markerLinks.setAttribute('focusable', 'false');
    $('markers').appendChild(this.markerLinks);
    this.onFocus = null; // (u) => fly to u (set by main.js)
    for (const u of units) this.addUnit(u);
    document.querySelector('#balance .flag.us').style.backgroundImage = flagDataUrl('US');
    document.querySelector('#balance .flag.cs').style.backgroundImage = flagDataUrl('CS');

    for (const btn of document.querySelectorAll('#orders button')) {
      btn.addEventListener('click', () => { this.onDirectOrder?.(); onOrder(btn.dataset.order); this.updateOrders(); });
    }
    $('pause').addEventListener('click', onPause);
    for (const b of document.querySelectorAll('.speeds button')) b.addEventListener('click', () => onSpeed(Number(b.dataset.speed)));
    const menu = $('menu');
    $('menu-btn').addEventListener('click', (e) => this.openMenu(e.currentTarget));
    menu.addEventListener('close', () => {
      // Native close is queued: a newer modal or newly focused field control owns focus now.
      if (menu.open) return;
      const trigger = this.menuTrigger; this.menuTrigger = null;
      const active = document.activeElement;
      if (trigger?.isConnected && !trigger.closest('[inert]')
        && (!active?.isConnected || active === document.body || menu.contains(active))) trigger.focus({ preventScroll: true });
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const live = [...menu.querySelectorAll('button, input, a[href], select, textarea, [tabindex]')]
        .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && (el.type !== 'radio' || el.checked));
      const first = live[0], last = live.at(-1), current = document.activeElement;
      if (first && ((e.shiftKey && current === first) || (!e.shiftKey && current === last))) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    });
    for (const r of menu.querySelectorAll('input[name=quality]')) r.addEventListener('change', () => onQuality(r.value));
    $('sound-toggle').addEventListener('change', (e) => onSound(e.target.checked));
    $('result-close').addEventListener('click', () => { $('result').close(); });
    $('army-btn').addEventListener('click', (e) => this.toggleArmy(undefined, e.currentTarget));
    this.buildDelegate();
    $('army-close').addEventListener('click', () => this.toggleArmy(false));
    this.buildSettings(menu);
    this.alertAt = null;
    this.momentBanner = document.createElement('p'); this.momentBanner.id = 'moment-banner';
    this.momentBanner.className = 'panel'; this.momentBanner.setAttribute('role', 'status');
    this.momentBanner.hidden = true; document.body.append(this.momentBanner);
    $('banner-fly').addEventListener('click', () => { if (this.alertAt && this.onFly) this.onFly(this.alertAt.x, this.alertAt.z); });
    $('banner-resume').addEventListener('click', () => { if (this.onResume) this.onResume(); });

    this.ghostLabel = $('ghost-label');
    this.ghostAt = null;
    this.dragLabel = null;
    this.feedItems = [];
    this.armyRows = new Map();
    this.cardTimer = 0;
    this.sizeTimer = 0;
    this.minimap = rts ? new Minimap({ canvas: $('minimap'), box: $('minimap-box'), terrain, units, rts, game }) : null;

    const applyWords = (v) => document.body.classList.toggle('no-status-words', !v);
    applyWords(LOOK.statusWords);
    onSetting('look.statusWords', applyWords);
    const applyFeed = (v) => { $('feed').hidden = !v; };
    applyFeed(LOOK.eventFeed);
    onSetting('look.eventFeed', applyFeed);
    this.applyMarkerScale(LOOK.markerScale);
    onSetting('look.markerScale', (v) => this.applyMarkerScale(v));
    this.buildCommand();
    this.buildTraits();
  }

  /** Temperament (P3t): the card's traits block and its data, only in a phase whose data gives commanders traits. */
  buildTraits() {
    this.traitData = null;
    this.traitsKey = null;
    this.traitsPaused = false;
    const s = this.game && this.game.scenario;
    if (!s || !s.commanderTraits || typeof s.commanderTraits !== 'object' || !Object.keys(s.commanderTraits).length) return;
    const body = $('uc-body');
    if (body && !$('uc-traits')) {
      const box = document.createElement('div');
      box.id = 'uc-traits'; box.className = 'uctraits'; box.hidden = true;
      body.insertBefore(box, $('uc-regiments') || body.querySelector('.ucdelegate'));
    }
    loadTraits().then((data) => {
      this.traitData = data; this.traitsKey = null;
      if (this.selected) this.fillTraits(this.selected);
    }).catch((e) => console.warn('commander traits unavailable:', e?.message ?? e));
  }

  /** An enemy formation's traits as shown ({ own, army }, either null), or null for a friend or a formation without any. */
  unitTraits(u) {
    if (!u || !this.traitData || !this.game || u.side === this.playerSide) return null;
    const t = formationTraits(this.traitData, this.game.scenario, u);
    return t.own || t.army ? t : null;
  }

  /** The card's traits block for u: a row per man (labels, provenance), the game rule, a record note, Records and sources. */
  fillTraits(u) {
    const box = $('uc-traits');
    if (!box) return;
    const t = this.unitTraits(u);
    const key = t ? `${u.id}|${t.own ? t.own.name : ''}|${t.army ? t.army.name : ''}` : '';
    if (key === this.traitsKey) return;
    this.traitsKey = key;
    box.replaceChildren();
    box.hidden = !t;
    if (!t) return;
    const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    for (const [who, e] of [['own', t.own], ['army', t.army]]) {
      if (!e) continue;
      const row = make('p', 'uct-row');
      row.dataset.who = who;
      row.append(make('span', 'uct-who', `${who === 'army' ? 'Army: ' : ''}${commanderTitle(e)}`));
      for (const tr of e.traits) {
        const chip = make('span', 'uct-chip', tr.label);
        chip.dataset.trait = tr.key; chip.title = tr.effect;
        row.append(' ', chip);
      }
      row.append(' ', make('span', 'uct-prov', `Provenance: ${e.provenance || 'not given'}`));
      box.append(row);
    }
    const rule = traitRuleLine([t.own, t.army]);
    if (rule) box.append(make('p', 'uct-rule', rule));
    for (const e of [t.own, t.army]) if (e && e.note && e.note.kind === 'record') box.append(make('p', 'uct-note', e.note.text));
    const more = make('button', 'uct-more', 'Records and sources');
    more.type = 'button'; more.id = 'uc-traits-more';
    more.setAttribute('aria-haspopup', 'dialog');
    more.title = 'Each trait\'s claim from the man\'s record and the sources behind it (the battle pauses while it is open)';
    more.addEventListener('click', (ev) => this.openTraits(ev.currentTarget));
    box.append(more);
  }

  /** The Records dialog for the selected enemy formation: each man's traits, game rules, claims and sources (links). */
  openTraits(trigger = document.activeElement) {
    const u = this.selected, t = this.unitTraits(u);
    if (!t) return null;
    let d = $('traits-dialog');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'traits-dialog'; d.setAttribute('aria-labelledby', 'traits-title');
      d.addEventListener('close', () => {
        if (this.traitsPaused && this.game && this.game.paused) this.game.togglePause();
        this.traitsPaused = false;
        const back = this.traitsTrigger;
        this.traitsTrigger = null;
        const target = back && back.isConnected && !back.closest('[hidden]') && back.getClientRects().length ? back : this.canvas;
        target?.focus({ preventScroll: true });
      });
      document.body.append(d);
    }
    const title = document.createElement('h2');
    title.id = 'traits-title'; title.tabIndex = -1; title.textContent = `${u.short}: the commanders' records`;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'Each trait comes from the man\'s documented record: the claim and the opened sources behind it. What it makes the enemy do is a game rule.';
    const close = document.createElement('button');
    close.type = 'button'; close.id = 'traits-close'; close.textContent = 'Close';
    close.addEventListener('click', () => d.close());
    d.replaceChildren(title, sub, ...[t.own, t.army].filter(Boolean).map((e) => traitDetails(e, document, 'h3')), close);
    this.closeDelegate(null, false);
    this.rts?.keys.clear();
    if (this.rts) this.rts.inertia = null;
    this.traitsTrigger = trigger;
    if (this.game && !this.game.paused) { this.game.togglePause(); this.traitsPaused = true; }
    d.showModal();
    title.focus({ preventScroll: true });
    return d;
  }

  /** The enemy flag tooltip's words for its commanders' traits ('' without). */
  traitTip(u) {
    const t = this.unitTraits(u);
    if (!t) return '';
    const words = (e) => e.traits.map((x) => x.label).join(', ');
    return `${t.own ? ` Commander: ${words(t.own)}.` : ''}${t.army ? ` Army commander ${t.army.name}: ${words(t.army)}.` : ''}`;
  }

  /** The Settings button in the strip, "All settings" in the menu, and the O key in the help sheet. */
  buildSettings(menu) {
    const gear = document.createElement('button');
    gear.type = 'button'; gear.id = 'settings-btn'; gear.textContent = '\u2699\uFE0E';
    gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-label', 'Settings');
    gear.title = 'Settings: quality, sound volumes, gore, X-Factor effects (O)';
    gear.addEventListener('click', (e) => this.openSettings(e.currentTarget));
    $('army-btn')?.after(gear);
    const all = document.createElement('button');
    all.type = 'button'; all.id = 'menu-settings'; all.textContent = 'All settings (O)';
    all.addEventListener('click', (e) => this.openSettings(e.currentTarget));
    const row = document.createElement('p'); row.className = 'row'; row.append(all);
    ($('sound-toggle')?.closest('label') ?? menu.querySelector('fieldset'))?.after(row);
    const keys = menu.querySelector('ul.keys');
    if (keys) {
      const li = document.createElement('li');
      li.innerHTML = '<b>Settings</b>: O or the \u2699\uFE0E button opens quality, sound volumes and mute, gore and X-Factor effects';
      keys.append(li);
    }
  }

  /** Open the Settings panel; focus returns to `trigger` when it closes. */
  openSettings(trigger = document.activeElement) {
    this.closeDelegate(null, false);
    this.rts?.keys.clear();
    if (this.rts) this.rts.inertia = null;
    return openSettings(document.body, { returnFocus: trigger });
  }

  /** The card's command line and regiment list, the regiment tooltip, field hover, and the generals' markers. */
  buildCommand() {
    this.generalMarkers = new Map();
    this.emptyText = $('uc-empty')?.textContent ?? '';
    const body = $('uc-body');
    if (body) {
      const line = document.createElement('p');
      line.id = 'uc-command'; line.className = 'uccommand'; line.hidden = true;
      const regs = document.createElement('ul');
      regs.id = 'uc-regiments'; regs.className = 'ucregs'; regs.hidden = true;
      regs.setAttribute('aria-label', 'Regiments of this brigade (they move with it; order the brigade)');
      const before = body.querySelector('.ucdelegate');
      body.insertBefore(line, before); body.insertBefore(regs, before);
    }
    const tip = document.createElement('div');
    tip.id = 'regiment-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    document.body.appendChild(tip);
    this.regTip = tip;
    this.hover = null; // { x, y } client point over the field while no button is held
    this.hoverT = 0;
    this.canvas?.addEventListener('pointermove', (e) => { this.hover = e.buttons ? null : { x: e.clientX, y: e.clientY }; if (e.buttons) this.hideRegimentTip('field'); });
    this.canvas?.addEventListener('pointerleave', () => { this.hover = null; this.hideRegimentTip('field'); });
  }

  /** The tooltip naming regiment r of u, beside (x, y); `from` is who owns it ('field' or 'card'). */
  showRegimentTip(u, r, x, y, from) {
    const tip = this.regTip;
    const text = `${u.regiments[r]}: about ${u.regimentMen(r)} men of ${u.short}. Not separately orderable: order the brigade.`;
    if (tip.textContent !== text) tip.textContent = text;
    tip.dataset.from = from; tip.dataset.unit = u.id; tip.dataset.regiment = String(r);
    tip.hidden = false;
    const w = tip.offsetWidth || 220, h = tip.offsetHeight || 24;
    const left = Math.max(4, Math.min(window.innerWidth - w - 4, x + 14)), top = Math.max(4, Math.min(window.innerHeight - h - 4, y - h - 10));
    tip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }

  hideRegimentTip(from) {
    if (this.regTip && !this.regTip.hidden && (!from || this.regTip.dataset.from === from)) this.regTip.hidden = true;
  }

  /** Field hover: the regiment block under the pointer (at most ten times a second). */
  updateHover(dt) {
    this.hoverT -= dt;
    if (this.hoverT > 0) return;
    this.hoverT = 0.1;
    const h = this.hover;
    if (!h || !this.rts || !this.game) { this.hideRegimentTip('field'); return; }
    const p = this.rts.pick(h.x, h.y, this.canvas);
    let hit = null;
    if (p) for (const u of this.units) {
      if (!u.alive || !u.regCount || !u.contains(p.x, p.z, 12)) continue;
      const r = u.regimentAt(p.x, p.z);
      if (r >= 0) { hit = [u, r]; break; }
    }
    if (hit) this.showRegimentTip(hit[0], hit[1], h.x, h.y, 'field');
    else this.hideRegimentTip('field');
  }

  /** The card's badge emblems for u (its definition's badges; hidden without any) and the X-Factor glow. */
  fillBadges(u) {
    let row = $('uc-badges');
    if (!row) {
      const state = $('uc-state');
      if (!state) return;
      row = document.createElement('p'); row.id = 'uc-badges'; row.className = 'ucbadges'; state.after(row);
    }
    const list = u && Array.isArray(u.def?.badges) ? u.def.badges.filter((b) => BADGE_BY_ID[b?.id] && TIER_NAMES[b.tier]) : [];
    row.replaceChildren(...list.map((b) => {
      const def = BADGE_BY_ID[b.id], tier = TIER_NAMES[b.tier], label = `${def.name}, ${tier} badge${b.xfactor ? ', X-Factor' : ''}`;
      const chip = document.createElement('span');
      chip.className = `cw-badge${b.xfactor ? ' is-xfactor' : ''}`; chip.dataset.badge = def.id; chip.dataset.tier = b.tier; chip.dataset.cat = def.category;
      chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', label); chip.title = label;
      const mark = document.createElement('span'); mark.className = 'cw-badge-mark'; mark.setAttribute('aria-hidden', 'true');
      const code = document.createElement('span'); code.textContent = def.mark;
      const letter = document.createElement('small'); letter.textContent = tier[0];
      mark.append(code, letter); chip.append(mark);
      return chip;
    }));
    row.hidden = !list.length;
    $('unitcard')?.classList.toggle('has-xfactor', list.some((b) => b.xfactor === true));
  }

  /** The card's regiment list for u (rebuilt when the selection changes). */
  fillRegiments(u) {
    const list = $('uc-regiments');
    if (!list) return;
    list.replaceChildren();
    const names = u && u.regCount ? u.regiments : [];
    list.hidden = !names.length;
    names.forEach((name, r) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = name;
      li.dataset.regiment = String(r);
      const show = () => { const b = li.getBoundingClientRect(); this.showRegimentTip(u, r, b.left, b.top, 'card'); li.setAttribute('aria-describedby', 'regiment-tip'); };
      const hide = () => { this.hideRegimentTip('card'); li.removeAttribute('aria-describedby'); };
      li.addEventListener('focus', show); li.addEventListener('blur', hide);
      li.addEventListener('pointerenter', show); li.addEventListener('pointerleave', () => { if (document.activeElement !== li) hide(); });
      list.appendChild(li);
    });
  }

  /** The generals' small star markers: made on first sight, placed with the brigade markers. */
  generalMarker(c) {
    let m = this.generalMarkers.get(c.id);
    if (m) return m;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `gmarker ${c.side.toLowerCase()}`;
    b.innerHTML = '<span class="gstar" aria-hidden="true">★</span><span class="gname"></span>';
    const last = c.name.split(' ').pop();
    b.querySelector('.gname').textContent = `${rankShort(c.rank)} ${last}`.trim();
    b.addEventListener('click', (e) => { e.stopPropagation(); this.game?.selectCommander(c); });
    $('markers').appendChild(b);
    m = { el: b, w: 0, h: 0, last: '' };
    this.generalMarkers.set(c.id, m);
    return m;
  }

  /** Words for a general: name, his brigades, his state, what the radius does. */
  generalText(c) {
    const shorts = c.units.map((id) => this.units.find((u) => u.id === id)?.short || id).join(', ');
    const state = c.down ? ` ${c.down === 'killed' ? 'Killed' : 'Wounded'} in action.` : ' Brigades of his side within 300 m of him rally faster and lose morale more slowly.';
    return `${titled(c.rank, c.name)}, commanding ${shorts}.${state}`;
  }

  /** The card's Delegate and Undo buttons, and the Attack / Defend / Support chooser (hidden until a place is picked). */
  buildDelegate() {
    this.delegateState = null;
    $('delegate-btn')?.addEventListener('click', () => { this.onDirectOrder?.(); this.onDelegate?.(); });
    $('dismount-btn')?.addEventListener('click', () => { this.onDirectOrder?.(); this.onOrder('dismount'); this.updateOrders(); if (this.selected) this.updateCard(this.selected); });
    $('delegate-undo')?.addEventListener('click', () => {
      if (this.game) this.game.undelegate(this.game.selection);
      this.updateOrders();
      this.canvas.focus({ preventScroll: true });
    });
    const c = document.createElement('section');
    c.id = 'delegate-chooser';
    c.className = 'panel';
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'false');
    c.setAttribute('aria-labelledby', 'dc-title');
    c.hidden = true;
    c.innerHTML = '<p id="dc-title"></p><div class="dc-roles"></div>';
    const row = c.querySelector('.dc-roles');
    for (const [role, key] of [['attack', 'A'], ['defend', 'D'], ['support', 'S'], ['cancel', 'Esc']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.role = role;
      const word = ROLE_WORD[role] || 'Cancel';
      b.setAttribute('aria-label', word);
      b.title = ROLE_TIP[role] || 'Cancel: delegate nothing (Esc)';
      b.innerHTML = `${word}<span class="key" aria-hidden="true">${key}</span>`;
      b.addEventListener('click', () => this.closeDelegate(role === 'cancel' ? null : role));
      row.appendChild(b);
    }
    c.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') { e.preventDefault(); e.stopPropagation(); this.closeDelegate(null); return; }
      const role = !e.metaKey && !e.ctrlKey && !e.altKey && { a: 'attack', d: 'defend', s: 'support' }[k];
      if (role) { e.preventDefault(); e.stopPropagation(); this.closeDelegate(role); return; }
      const buttons = [...row.children], i = buttons.indexOf(document.activeElement);
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && i >= 0) {
        e.preventDefault(); e.stopPropagation();
        const step = k === 'arrowleft' || k === 'arrowup' ? -1 : 1;
        buttons[(i + step + buttons.length) % buttons.length].focus();
        return;
      }
      if (k === 'tab') { // keep focus in the chooser until a choice is made
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (/^[a-z0-9?+\-=]$/i.test(e.key) || ['Enter', ' ', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) e.stopPropagation();
    });
    document.body.appendChild(c);
    this.chooser = c;
    // a press anywhere else closes it unchanged (that press then does what it always does)
    document.addEventListener('pointerdown', (e) => { if (this.delegateState && !c.contains(e.target)) this.closeDelegate(null, false); }, true);
  }

  /** Ask Attack, Defend or Support for `who`; onChoose(role) or onCancel() runs once, then focus returns to the field. */
  openDelegate({ who, onChoose, onCancel }) {
    this.closeDelegate(null, false);
    this.delegateState = { onChoose, onCancel };
    $('dc-title').textContent = `Delegate ${who} here:`;
    this.chooser.hidden = false;
    this.rts?.keys.clear();
    this.chooser.querySelector('button').focus({ preventScroll: true });
  }

  /** Close the chooser: with a role, delegate; with none, change nothing. Refocus the field unless told not to. */
  closeDelegate(role = null, refocus = true) {
    const s = this.delegateState;
    if (!s) return false;
    this.delegateState = null;
    this.chooser.hidden = true;
    if (role) s.onChoose(role); else s.onCancel?.();
    if (refocus) this.canvas.focus({ preventScroll: true });
    this.updateOrders();
    return true;
  }

  applyMarkerScale(v) {
    $('markers').style.setProperty('--marker-scale', String(v));
    // Stack/hit rectangles must use the new CSS dimensions on the next frame, including while paused.
    for (const m of this.markers.values()) { m.w = 0; m.h = 0; }
    this.sizeTimer = 0;
  }

  showMoment(moment) {
    this.momentBanner.hidden = !moment;
    this.momentBanner.textContent = moment ? `${moment.label} · ${moment.unit.short}` : '';
    this.momentBanner.dataset.style = moment?.style || 'subtle';
  }

  /** A marker for a unit (scenario units at start; sandbox spawns later). */
  addUnit(u) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `marker ${u.side.toLowerCase()}`;
    b.innerHTML = `<span class="info"><span class="nm"></span><span class="cmd"></span><span class="st"></span></span>${markerSvg(u.side, u.type)}<span class="hf" aria-hidden="true">HOLD FIRE</span>`
      + '<span class="mstr"><span class="sbar"><i></i></span><span class="glyph"></span><span class="str"></span></span><span class="cdn" aria-hidden="true">Commander down</span><span class="act"></span>';
    b.querySelector('.nm').textContent = u.short;
    if (Array.isArray(u.def?.badges) && u.def.badges.some((x) => x?.xfactor === true)) b.classList.add('has-xfactor'); // warm glow on its flag
    b.querySelector('.cmd').textContent = commanderLine(u);
    // pointer presses go through ui/input.js (select, drag an order, double-tap); a click without a pointer
    // (Enter or Space on a focused flag: detail 0) selects it from the keyboard
    b.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) this.onSelect(u, { add: e.shiftKey, fromMarker: true }); });
    b.addEventListener('dblclick', (e) => { e.stopPropagation(); if (this.onFocus) this.onFocus(u); });
    b.addEventListener('pointerdown', (e) => this.onMarkerDown && this.onMarkerDown(u, e));
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    link.innerHTML = '<path class="marker-link-back"/><path class="marker-link-front"/>';
    this.markerLinks.appendChild(link);
    $('markers').appendChild(b);
    this.markers.set(u.id, {
      el: b, link, cmd: b.querySelector('.cmd'), lastDown: false, str: b.querySelector('.str'), act: b.querySelector('.act'), bar: b.querySelector('.sbar i'), glyph: b.querySelector('.glyph'), st: b.querySelector('.st'),
      last: '', lastAct: '', lastTip: '', lastState: '', lastBar: '', lastHf: null,
    });
    this.armyDirty = true;
  }

  removeUnit(u) {
    const m = this.markers.get(u.id);
    if (m) { m.el.remove(); m.link.remove(); }
    this.markers.delete(u.id);
    if (this.selected === u) this.select(null);
    this.armyDirty = true;
  }

  setQuality(q) { this.quality = q; }

  setPaused(p) {
    $('pause').textContent = p ? '▶' : '❚❚';
    $('pause').setAttribute('aria-pressed', String(p));
    $('pause').setAttribute('aria-label', p ? 'Play' : 'Pause');
    if (!p) $('banner').hidden = true;
  }

  setSpeed(s) {
    for (const b of document.querySelectorAll('.speeds button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
  }

  /** Auto-pause banner: one line naming the reason, "Fly there" and "Resume". */
  showAlert({ text, x, z }) {
    $('banner-text').textContent = text;
    this.alertAt = Number.isFinite(x) ? { x, z } : null;
    $('banner-fly').hidden = !this.alertAt;
    $('banner').hidden = false;
  }

  select(u) {
    if (this.delegateState) this.closeDelegate(null, false); // a new selection drops a half-made delegation
    for (const [id, m] of this.markers) m.el.classList.toggle('selected', !!this.game && this.game.selection.some((v) => v.id === id));
    if (!this.game && this.selected) this.markers.get(this.selected.id)?.el.classList.remove('selected');
    if (this.selected !== u) $('unitcard').scrollTop = 0;
    this.selected = u;
    if (!this.game && u) this.markers.get(u.id)?.el.classList.add('selected');
    $('uc-empty').hidden = !!u;
    $('uc-body').hidden = !u;
    this.armyDirty = true;
    const general = !u && this.game ? this.game.selectedCommander : null;
    for (const [id, gm] of this.generalMarkers || []) gm.el.classList.toggle('selected', !!general && general.id === id);
    const empty = $('uc-empty');
    if (empty) { const text = general ? this.generalText(general) : this.emptyText; if (empty.textContent !== text) empty.textContent = text; }
    this.fillRegiments(u);
    this.fillBadges(u);
    this.fillTraits(u);
    this.hideRegimentTip('card');
    if (!u) {
      this.updateOrders();
      return;
    }
    this.fillPortrait(u);
    const n = this.game ? this.game.selection.length : 1;
    this.cardMore = n > 1 ? ` (+${n - 1} more selected)` : '';
    $('uc-name').textContent = `${cardWho(u)} — ${u.parent || u.name}${this.cardMore}`;
    this.cardTimer = 0;
    this.updateCard(u);
    this.updateOrders();
  }

  /** The card portrait: the scenario's own, else the sourced period portrait for exactly this name, else the silhouette. */
  fillPortrait(u) {
    const p = $('uc-portrait');
    if (!p || !u) return;
    p.className = `portrait ${u.side.toLowerCase()}`;
    const c = u.commander;
    const art = c && c.name && !c.portrait ? portraitArt(c.name) : null;
    const generic = !(c && c.portrait) && !art ? genericPortrait() : null;
    const url = c && c.portrait ? c.portrait : art ? art.src : generic ? generic.src : '';
    p.dataset.portrait = c && c.portrait ? 'scenario' : art ? 'sourced' : generic ? 'generic' : 'initials';
    p.title = art ? portraitLine(art) : generic ? `${c && c.name ? `${c.name}: ` : ''}${generic.caption}` : (c && c.portraitNote) || '';
    if (url) {
      p.style.backgroundImage = `url("${url}")`;
      p.textContent = '';
    } else {
      p.style.backgroundImage = '';
      p.textContent = c && c.name ? c.name.split(' ').map((w) => w[0]).filter((ch) => /[A-Z]/.test(ch)).slice(-2).join('') : u.short[0];
    }
    p.classList.toggle('down', !!u.commandDown);
  }

  updateOrders() {
    const u = this.selected;
    const mine = !!u && (this.game ? this.game.controls(u) : u.side === this.playerSide) && u.canTakeOrders();
    for (const btn of document.querySelectorAll('#orders button')) {
      btn.disabled = !mine;
      if (btn.dataset.order === 'run') btn.setAttribute('aria-pressed', String(!!(mine && u.run)));
      if (btn.dataset.order === 'holdfire') btn.setAttribute('aria-pressed', String(!!(mine && u.holdFire)));
    }
    const cav = $('uc-cav');
    if (cav) {
      const horse = !!u && u.type === 'cavalry';
      if (cav.hidden === horse) cav.hidden = !horse;
      const btn = $('dismount-btn');
      const can = horse && mine && !u.switching && !(u.mounted && u.weapon === 'pistol');
      if (btn.disabled === can) btn.disabled = !can;
      const pressed = String(horse && (!u.mounted || u.switching?.to === 'dismounted'));
      if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    }
    const del = $('delegate-btn');
    if (del) {
      const own = mine && (!this.game || u.side === this.game.playerSide);
      if (del.disabled === own) del.disabled = !own;
      const delegated = !!u && (this.game ? this.game.selection : [u]).some((v) => v.delegate && v.alive);
      const undo = $('delegate-undo');
      if (undo.hidden === delegated) undo.hidden = !delegated;
      const text = u && u.delegate ? `Delegated: ${ROLE_WORD[u.delegate.role] || u.delegate.role}` : '';
      const label = $('delegate-text');
      if (label.textContent !== text) label.textContent = text;
    }
  }

  updateCard(u) {
    const pct = (v) => `${Math.round(v)}%`;
    const set = (id, v) => { $(`uc-${id}`).textContent = pct(v); $(`uc-${id}-bar`).style.height = `${Math.max(0, Math.min(100, v))}%`; };
    set('morale', (u.morale / 100) * 100);
    set('condition', 100 - u.fatigue);
    set('cover', Math.min(100, (u.cover - 1) * 100));
    set('reload', u.reload * 100);
    $('uc-cas').textContent = String(Math.round(u.casualties));
    const name = `${cardWho(u)} — ${u.parent || u.name}${this.cardMore || ''}`;
    if ($('uc-name').textContent !== name) $('uc-name').textContent = name;
    $('uc-portrait').classList.toggle('down', !!u.commandDown);
    const line = $('uc-command');
    if (line) {
      const text = commandText(u, this.game);
      if (line.textContent !== text) line.textContent = text;
      line.hidden = !text;
      line.classList.toggle('down', !!u.commandDown);
    }
    const mount = $('uc-mount');
    if (mount) { const text = mountText(u); if (mount.textContent !== text) mount.textContent = text; }
    let camp = $('uc-camp');
    if (!camp && line) { camp = document.createElement('p'); camp.id = 'uc-camp'; camp.className = 'uccommand ucamp'; camp.hidden = true; line.after(camp); }
    if (camp) {
      const lines = campEffectLines(u.def);
      const text = lines.length ? `${lines.join(' · ')}${Number.isFinite(u.def?.ammo) ? ` · rounds now ${Math.round(u.ammo)}%` : ''} (game rules)` : '';
      if (camp.textContent !== text) camp.textContent = text;
      camp.hidden = !text;
    }
    $('uc-state').textContent = `${intention(u).replace(/^[^:]*: /, '')}${u.coverKind && u.coverKind !== 'open' ? ` In ${u.coverKind}.` : ''}`;
    if (this.traitData) this.fillTraits(u); // his own traits leave the card once he is down
  }

  /** The text label beside the ghost while an order is drawn: { text, x, z } or null (ui/input.js). */
  setGhostLabel(info) {
    this.dragLabel = info;
    this.showLabel(info || this.marchLabel());
  }

  /** One native help/menu path, shared by the menu button and keyboard. */
  openMenu(trigger) {
    const menu = $('menu');
    if (menu.open) return;
    this.closeDelegate(null, false);
    this.onOpenMenu?.(); this.menuTrigger = trigger;
    for (const r of menu.querySelectorAll('input[name=quality]')) r.checked = r.value === this.quality;
    menu.showModal();
  }

  setTargeting(text) {
    const el = $('keyboard-targeting');
    if (el.textContent !== (text || '')) el.textContent = text || '';
    el.hidden = !text;
    document.body.classList.toggle('keyboard-targeting', !!text);
  }

  showLabel(info) {
    this.ghostAt = info;
    if (!info) { this.ghostLabel.hidden = true; return; }
    if (this.ghostLabel.textContent !== info.text) this.ghostLabel.textContent = info.text;
    this.ghostLabel.hidden = false;
    this.placeGhostLabel();
  }

  /** Until it arrives, the selected brigade's ghost keeps its label: time still to march, cover there. */
  marchLabel() {
    const u = this.selected, g = this.game;
    if (!u || !g || !g.controls(u) || !u.path || u.path.length < 2 || u.order.type === 'charge' || u.state === 'routing') return null;
    const end = u.path[u.path.length - 1];
    const len = pathLength([[u.x, u.z], ...u.path.slice(1)]);
    if (len < 8) return null;
    const c = g.coverAt(end[0], end[1]);
    const cover = c.value > 1 ? ` · ${c.kind}: ${coverWord(c.value)} cover` : '';
    return { text: `${u.engaged ? 'Halted to fight; ' : ''}${minutesText(g.marchMinutes(len))} to go${cover}`, x: end[0], z: end[1] };
  }

  placeGhostLabel() {
    const g = this.ghostAt;
    if (!g) return;
    _v.set(g.x, this.terrain.heightAt(g.x, g.z) + 4, g.z).project(this.camera);
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth, y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.ghostLabel.style.transform = `translate(${(x + 18).toFixed(1)}px, ${(y + 10).toFixed(1)}px)`;
  }

  /** Per frame: place markers (stacked so none hides another); every 0.25 s refresh numbers. */
  update(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    const bounds = { left: 4, right: w - 4, top: $('topbar').getBoundingClientRect().bottom + 4, bottom: h - 4 };
    // Reserve the actual visible panels rather than the entire dock's transparent bounding box.
    const obstacles = ['unitcard', 'orders', 'minimap-box', 'objective', 'tip', 'intro-hint', 'army', 'field-stores', 'feed', 'moment-banner', 'keyboard-targeting', 'delegate-chooser'].flatMap((id) => {
      const el = $(id);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return !el.hidden && r.width > 0 && r.height > 0 ? [{ x: r.x + r.width / 2, y: r.bottom, w: r.width, h: r.height }] : [];
    });
    const shown = [];
    for (const u of this.units) {
      const m = this.markers.get(u.id);
      if (!m) continue;
      if (!u.alive) { m.el.classList.add('hidden'); m.link.style.display = 'none'; continue; }
      _v.set(u.x, this.terrain.heightAt(u.x, u.z) + 16, u.z).project(this.camera);
      const off = _v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1;
      m.el.classList.toggle('hidden', off);
      m.link.style.display = 'none';
      if (off) continue;
      if (!m.w || this.sizeTimer <= 0) { const rect = m.el.getBoundingClientRect(); m.w = rect.width; m.h = rect.height; }
      shown.push({ u, m, x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h });
    }
    this.sizeTimer = this.sizeTimer > 0 ? this.sizeTimer - dt : 1;
    // nearest (lowest on screen) first; a flag that would cover one already placed moves up above it
    shown.sort((a, b) => b.y - a.y);
    const placed = [];
    for (const s of shown) {
      const mw = s.m.w || 60, mh = s.m.h || 80;
      const p = markerPosition({ x: s.x, y: s.y, w: mw, h: mh }, placed, bounds, obstacles);
      placed.push({ ...p, w: mw, h: mh });
      s.m.anchor = { x: s.x, y: s.y };
      s.m.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      s.m.el.classList.toggle('info-below', p.y - mh < bounds.top + 52);
      if (Math.hypot(p.x - s.x, p.y - s.y) > 1) {
        const d = `M${s.x.toFixed(1)},${s.y.toFixed(1)} L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        for (const line of s.m.link.children) line.setAttribute('d', d);
        s.m.link.style.display = '';
      }
    }
    this.placeGenerals(placed, bounds, obstacles, w, h);
    this.updateHover(dt);
    this.placeGhostLabel();
    this.cardTimer -= dt;
    if (this.cardTimer > 0) return;
    this.cardTimer = 0.25;
    for (const { u, m } of shown) this.refreshMarker(u, m);
    for (const u of this.units) {
      const m = this.markers.get(u.id);
      if (!m || !u.alive) continue;
      const tip = intention(u) + (u.commandDown ? ' Commander down.' : '') + (this.traitData ? this.traitTip(u) : '');
      if (tip !== m.lastTip) {
        m.el.title = tip;
        m.el.setAttribute('aria-label', `${tip}${u.selected ? ' Selected.' : ''}`);
        m.lastTip = tip;
      }
    }
    if (this.selected) {
      this.updateCard(this.selected);
      this.updateOrders();
    }
    if (!this.dragLabel) this.showLabel(this.marchLabel());
    let us = 0, cs = 0;
    for (const u of this.units) {
      const v = u.state === 'routing' ? u.men * 0.3 : u.men;
      if (u.side === 'US') us += v; else cs += v;
    }
    const share = us / Math.max(1, us + cs);
    $('bal-us').style.width = `${(share * 100).toFixed(1)}%`;
    $('bal-mark').style.left = `${(share * 100).toFixed(1)}%`;
    $('bal-text').textContent = `Union ${Math.round(us)} effective, Confederate ${Math.round(cs)}`;
    if (!$('army').hidden) this.refreshArmy();
    if (this.minimap) this.minimap.draw();
  }

  /** Place each general's star marker among the brigade markers (hidden once he has left the field). */
  placeGenerals(placed, bounds, obstacles, w, h) {
    if (!this.game) return;
    const selected = this.game.selectedCommander;
    for (const c of this.game.commanders) {
      const m = this.generalMarker(c);
      _v.set(c.x, this.terrain.heightAt(c.x, c.z) + 12, c.z).project(this.camera);
      const off = c.gone || _v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1;
      m.el.classList.toggle('hidden', off);
      if (off) continue;
      if (!m.w || this.sizeTimer <= 0) { const r = m.el.getBoundingClientRect(); m.w = r.width; m.h = r.height; }
      const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      const p = markerPosition({ x: sx, y: sy, w: m.w || 50, h: m.h || 30 }, placed, bounds, obstacles);
      placed.push({ ...p, w: m.w || 50, h: m.h || 30 });
      m.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      const text = this.generalText(c) + (selected === c ? ' Selected: his rally radius is shown.' : ' Select to show his rally radius.');
      if (text !== m.last) { m.el.title = text; m.el.setAttribute('aria-label', text); m.last = text; }
      m.el.classList.toggle('down', !!c.down);
      m.el.classList.toggle('selected', selected === c);
    }
  }

  /** Strength bar (fill = men left, pattern and glyph = morale), number, state and activity words. */
  refreshMarker(u, m) {
    const down = !!u.commandDown;
    if (down !== m.lastDown) {
      m.el.classList.toggle('cmd-down', down);
      m.cmd.textContent = down ? 'Commander down' : commanderLine(u);
      m.lastDown = down;
    }
    const label = String(Math.round(u.men));
    if (label !== m.last) { m.str.textContent = label; m.last = label; }
    const bar = `${Math.max(2, Math.round((u.men / u.menMax) * 100))}%`;
    if (bar !== m.lastBar) { m.bar.style.width = bar; m.lastBar = bar; }
    if (u.state !== m.lastState) {
      for (const s of ['steady', 'shaken', 'wavering', 'routing']) m.el.classList.toggle(`m-${s}`, u.state === s);
      m.glyph.textContent = STATE_GLYPH[u.state] || '';
      m.st.textContent = STATE_WORD[u.state] || u.state;
      m.lastState = u.state;
    }
    if (u.holdFire !== m.lastHf) { m.el.classList.toggle('holdfire', !!u.holdFire); m.lastHf = u.holdFire; }
    if (LOOK.statusWords) {
      const [act, tone] = activity(u);
      const actKey = act + tone;
      if (actKey !== m.lastAct) { m.act.textContent = act; m.act.className = `act ${tone}`; m.lastAct = actKey; }
    }
  }

  // ---- army list (key L) ---------------------------------------------------------------------------------
  toggleArmy(open, trigger = document.activeElement) {
    const el = $('army');
    const wasHidden = el.hidden;
    const show = open ?? el.hidden;
    el.hidden = !show;
    $('army-btn').setAttribute('aria-expanded', String(show));
    if (show) {
      if (wasHidden) this.armyTrigger = trigger;
      this.armyDirty = true; this.refreshArmy();
      if (wasHidden) (this.armyRows.values().next().value?.b || $('army-close')).focus({ preventScroll: true });
    } else if (!wasHidden) {
      const target = this.armyTrigger; this.armyTrigger = null;
      (target?.isConnected && !target.closest('[inert]') && !target.disabled && target.getClientRects().length ? target : $('army-btn')).focus({ preventScroll: true });
    }
  }

  refreshArmy() {
    const list = $('army-list');
    const mine = this.units.filter((u) => u.alive && (this.game ? this.game.controls(u) : u.side === this.playerSide));
    if (this.armyDirty || mine.length !== this.armyRows.size || mine.some((u) => !this.armyRows.has(u.id))) {
      const focused = list.contains(document.activeElement), focusedId = focused ? [...this.armyRows].find(([, r]) => r.b === document.activeElement)?.[0] : null;
      const scroll = $('army').scrollTop;
      this.armyDirty = false;
      list.replaceChildren();
      this.armyRows.clear();
      for (const u of mine) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.armyUnit = u.id;
        b.innerHTML = '<span class="al-name"></span><span class="al-men"></span><span class="al-state"></span>';
        b.querySelector('.al-name').textContent = u.short;
        b.addEventListener('click', () => { this.onSelect(u); if (this.onFocus) this.onFocus(u); });
        li.appendChild(b);
        list.appendChild(li);
        this.armyRows.set(u.id, { b, men: b.querySelector('.al-men'), st: b.querySelector('.al-state'), last: '' });
      }
      if (focused && !$('army').hidden) {
        (this.armyRows.get(focusedId)?.b || $('army-close')).focus({ preventScroll: true });
        $('army').scrollTop = scroll;
      }
    }
    for (const u of mine) {
      const r = this.armyRows.get(u.id);
      const [act] = activity(u);
      const key = `${Math.round(u.men)}|${u.state}|${act}|${u.selected}`;
      if (key === r.last) continue;
      r.last = key;
      r.men.textContent = `${Math.round(u.men)} men`;
      r.st.textContent = `${STATE_WORD[u.state] || u.state} · ${act}`;
      r.st.className = `al-state ${u.state}`;
      r.b.setAttribute('aria-pressed', String(!!u.selected));
    }
  }

  // ---- event feed -----------------------------------------------------------------------------------------
  /** One event ({ text, time, x, z, side }): the newest at the bottom, the last six kept; click flies there. */
  feed(ev) {
    const list = $('feed');
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<time></time><span></span>';
    b.querySelector('time').textContent = ev.time;
    const span = b.querySelector('span');
    span.textContent = ev.text;
    if (ev.side) span.className = ev.side.toLowerCase();
    if (Number.isFinite(ev.x)) b.addEventListener('click', () => { if (this.onFly) this.onFly(ev.x, ev.z); });
    else b.disabled = true;
    b.title = Number.isFinite(ev.x) ? 'Fly there' : '';
    li.appendChild(b);
    const reading = list.contains(document.activeElement);
    list.appendChild(li);
    while (list.children.length > 6) list.firstChild.remove();
    if (!reading) list.scrollTop = list.scrollHeight; // the newest row in view (not while someone reads with focus inside)
  }

  toggleMinimap() { if (this.minimap) this.minimap.toggleLarge(); }

  setClock(date, time, frac) {
    $('clock-date').textContent = date;
    $('clock-time').textContent = time;
    $('clock-bar').style.width = `${(frac * 100).toFixed(1)}%`;
  }

  toast(text) {
    const p = document.createElement('p');
    p.textContent = text;
    $('toasts').appendChild(p);
    setTimeout(() => p.remove(), 5200);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }

  objective(text) {
    const objective = $('objective');
    if (objective.textContent === text) return;
    objective.textContent = text;
    // Reserve new text in the same frame; ResizeObserver retains viewport-driven updates.
    document.documentElement.style.setProperty('--objective-h', objective.getBoundingClientRect().height + 'px');
  }

  result(title, text) {
    $('result-title').textContent = title;
    $('result-text').textContent = text;
    $('result').showModal();
  }
}

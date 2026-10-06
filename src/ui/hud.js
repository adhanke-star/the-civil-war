// src/ui/hud.js: the battle HUD: brigade markers, the bottom dock (unit card, orders, minimap), the top strip
// (clock, pause, speeds, army list button, balance bar), the army list, the event feed, the auto-pause banner
// and the ghost label. Markers move every frame (O(units)); their text and the card refresh 4 times a second.

import * as THREE from 'three';
import { LOOK } from './look.js';
import { on as onSetting } from '../settings.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

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
  return `${u.name}: ${Math.round(u.men)} men, ${u.state}${u.holdFire ? ', holding fire' : ''}. ${now}${next}.`;
}

/** Plain words for a cover value from Game.coverAt. */
export const coverWord = (v) => (v >= 1.5 ? 'strong' : v >= 1.3 ? 'good' : 'light');
/** Historical minutes in words. */
export const minutesText = (m) => (m < 1 ? 'under a minute' : `${Math.round(m)} min`);

const rankShort = (r) => ({ 'Brigadier General': 'Brig. Gen.', Colonel: 'Col.', Captain: 'Capt.', Lieutenant: 'Lt.', 'First Lieutenant': '1st Lt.', Major: 'Maj.' }[r] || r || '');
const commanderLine = (u) => (u.commander && u.commander.name ? `${rankShort(u.commander.rank)} ${u.commander.name}`.trim() : '');
const STATE_WORD = { steady: 'Steady', shaken: 'Shaken', wavering: 'Wavering', routing: 'Routing' };
const STATE_GLYPH = { steady: '', shaken: '~', wavering: '!', routing: '✕' };

export class Hud {
  constructor({ camera, canvas, terrain, units, playerSide, rts, game, onSelect, onOrder, onPause, onSpeed, onQuality, onSound }) {
    Object.assign(this, { camera, canvas, terrain, units, playerSide, rts, game, onSelect, onOrder });
    this.selected = null;
    this.markers = new Map();
    this.onFocus = null; // (u) => fly to u (set by main.js)
    for (const u of units) this.addUnit(u);
    document.querySelector('#balance .flag.us').style.backgroundImage = flagDataUrl('US');
    document.querySelector('#balance .flag.cs').style.backgroundImage = flagDataUrl('CS');

    for (const btn of document.querySelectorAll('#orders button')) {
      btn.addEventListener('click', () => { onOrder(btn.dataset.order); this.updateOrders(); });
    }
    $('pause').addEventListener('click', onPause);
    for (const b of document.querySelectorAll('.speeds button')) b.addEventListener('click', () => onSpeed(Number(b.dataset.speed)));
    const menu = $('menu');
    $('menu-btn').addEventListener('click', () => {
      for (const r of menu.querySelectorAll('input[name=quality]')) r.checked = r.value === this.quality;
      menu.showModal();
    });
    for (const r of menu.querySelectorAll('input[name=quality]')) r.addEventListener('change', () => onQuality(r.value));
    $('sound-toggle').addEventListener('change', (e) => onSound(e.target.checked));
    $('result-close').addEventListener('click', () => { $('result').close(); });
    $('army-btn').addEventListener('click', () => this.toggleArmy());
    this.alertAt = null;
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
  }

  /** A marker for a unit (scenario units at start; sandbox spawns later). */
  addUnit(u) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `marker ${u.side.toLowerCase()}`;
    b.innerHTML = `<span class="info"><span class="nm"></span><span class="cmd"></span><span class="st"></span></span>${markerSvg(u.side, u.type)}<span class="hf" aria-hidden="true">HOLD FIRE</span>`
      + '<span class="mstr"><span class="sbar"><i></i></span><span class="glyph"></span><span class="str"></span></span><span class="act"></span>';
    b.querySelector('.nm').textContent = u.short;
    b.querySelector('.cmd').textContent = commanderLine(u);
    // pointer presses go through ui/input.js (select, drag an order, double-tap); a click without a pointer
    // (Enter or Space on a focused flag: detail 0) selects it from the keyboard
    b.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) this.onSelect(u, { fromMarker: true }); });
    b.addEventListener('dblclick', (e) => { e.stopPropagation(); if (this.onFocus) this.onFocus(u); });
    b.addEventListener('pointerdown', (e) => this.onMarkerDown && this.onMarkerDown(u, e));
    $('markers').appendChild(b);
    this.markers.set(u.id, {
      el: b, str: b.querySelector('.str'), act: b.querySelector('.act'), bar: b.querySelector('.sbar i'), glyph: b.querySelector('.glyph'), st: b.querySelector('.st'),
      last: '', lastAct: '', lastTip: '', lastState: '', lastBar: '', lastHf: null,
    });
    this.armyDirty = true;
  }

  removeUnit(u) {
    const m = this.markers.get(u.id);
    if (m) m.el.remove();
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
    for (const [id, m] of this.markers) m.el.classList.toggle('selected', !!this.game && this.game.selection.some((v) => v.id === id));
    if (!this.game && this.selected) this.markers.get(this.selected.id)?.el.classList.remove('selected');
    this.selected = u;
    if (!this.game && u) this.markers.get(u.id)?.el.classList.add('selected');
    $('uc-empty').hidden = !!u;
    $('uc-body').hidden = !u;
    this.armyDirty = true;
    if (!u) {
      this.updateOrders();
      return;
    }
    const p = $('uc-portrait');
    p.className = `portrait ${u.side.toLowerCase()}`;
    const c = u.commander;
    if (c && c.portrait) {
      p.style.backgroundImage = `url("${c.portrait}")`;
      p.textContent = '';
    } else {
      p.style.backgroundImage = '';
      p.textContent = c && c.name ? c.name.split(' ').map((w) => w[0]).filter((ch) => /[A-Z]/.test(ch)).slice(-2).join('') : u.short[0];
    }
    const who = c && c.name ? `${rankShort(c.rank)} ${c.name}` : u.name;
    const n = this.game ? this.game.selection.length : 1;
    $('uc-name').textContent = `${who} — ${u.parent || u.name}${n > 1 ? ` (+${n - 1} more selected)` : ''}`;
    this.cardTimer = 0;
    this.updateCard(u);
    this.updateOrders();
  }

  updateOrders() {
    const u = this.selected;
    const mine = !!u && (this.game ? this.game.controls(u) : u.side === this.playerSide) && u.canTakeOrders();
    for (const btn of document.querySelectorAll('#orders button')) {
      btn.disabled = !mine;
      if (btn.dataset.order === 'run') btn.setAttribute('aria-pressed', String(!!(mine && u.run)));
      if (btn.dataset.order === 'holdfire') btn.setAttribute('aria-pressed', String(!!(mine && u.holdFire)));
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
    $('uc-state').textContent = `${intention(u).replace(/^[^:]*: /, '')}${u.coverKind && u.coverKind !== 'open' ? ` In ${u.coverKind}.` : ''}`;
  }

  /** The text label beside the ghost while an order is drawn: { text, x, z } or null (ui/input.js). */
  setGhostLabel(info) {
    this.dragLabel = info;
    this.showLabel(info || this.marchLabel());
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
    const shown = [];
    for (const u of this.units) {
      const m = this.markers.get(u.id);
      if (!m) continue;
      if (!u.alive) { m.el.classList.add('hidden'); continue; }
      _v.set(u.x, this.terrain.heightAt(u.x, u.z) + 16, u.z).project(this.camera);
      const off = _v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1;
      m.el.classList.toggle('hidden', off);
      if (off) continue;
      if (!m.w || this.sizeTimer <= 0) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
      shown.push({ u, m, x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h });
    }
    this.sizeTimer = this.sizeTimer > 0 ? this.sizeTimer - dt : 1;
    // nearest (lowest on screen) first; a flag that would cover one already placed moves up above it
    shown.sort((a, b) => b.y - a.y);
    const placed = [];
    for (const s of shown) {
      const mw = s.m.w || 60, mh = s.m.h || 80;
      let y = s.y;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find((p) => Math.abs(p.x - s.x) < (p.w + mw) / 2 + 2 && y > p.y - p.h - 2 && y - mh < p.y + 2);
        if (!hit) break;
        y = hit.y - hit.h - 3;
      }
      placed.push({ x: s.x, y, w: mw, h: mh });
      s.m.el.style.transform = `translate(${s.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    this.placeGhostLabel();
    this.cardTimer -= dt;
    if (this.cardTimer > 0) return;
    this.cardTimer = 0.25;
    for (const { u, m } of shown) this.refreshMarker(u, m);
    for (const u of this.units) {
      const m = this.markers.get(u.id);
      if (!m || !u.alive) continue;
      const tip = intention(u);
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

  /** Strength bar (fill = men left, pattern and glyph = morale), number, state and activity words. */
  refreshMarker(u, m) {
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
  toggleArmy(open) {
    const el = $('army');
    const show = open ?? el.hidden;
    el.hidden = !show;
    $('army-btn').setAttribute('aria-expanded', String(show));
    if (show) { this.armyDirty = true; this.refreshArmy(); }
  }

  refreshArmy() {
    const list = $('army-list');
    const mine = this.units.filter((u) => u.alive && (this.game ? this.game.controls(u) : u.side === this.playerSide));
    if (this.armyDirty || mine.length !== this.armyRows.size || mine.some((u) => !this.armyRows.has(u.id))) {
      this.armyDirty = false;
      list.replaceChildren();
      this.armyRows.clear();
      for (const u of mine) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="al-name"></span><span class="al-men"></span><span class="al-state"></span>';
        b.querySelector('.al-name').textContent = u.short;
        b.addEventListener('click', () => { this.onSelect(u); if (this.onFocus) this.onFocus(u); });
        li.appendChild(b);
        list.appendChild(li);
        this.armyRows.set(u.id, { b, men: b.querySelector('.al-men'), st: b.querySelector('.al-state'), last: '' });
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
    list.appendChild(li);
    while (list.children.length > 6) list.firstChild.remove();
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
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  objective(text) { if ($('objective').textContent !== text) $('objective').textContent = text; }

  result(title, text) {
    $('result-title').textContent = title;
    $('result-text').textContent = text;
    $('result').showModal();
  }
}

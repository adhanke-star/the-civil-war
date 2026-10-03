// src/ui/hud.js: the UG:G HUD: brigade markers, unit card, clock, balance bar, order buttons, menu.

import * as THREE from 'three';

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
function markerSvg(side, type) {
  const flag = side === 'US' ? usFlag() : csFlag();
  const shield = side === 'US' ? '#2f5fb5' : '#9a3a3a';
  const icon = type === 'artillery'
    ? '<circle cx="31" cy="35" r="3.2" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="31" y="33.6" width="9" height="2.6" fill="#fff"/>'
    : '<path d="M27 29 L39 41 M39 29 L27 41" stroke="#fff" stroke-width="2"/>';
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="translate(2 4) scale(0.95)">${flag}</g>
    <path d="M22 22 h20 v12 c0 7 -5 10 -10 13 c-5 -3 -10 -6 -10 -13z" fill="${shield}" stroke="#fff" stroke-width="1.6"/>${icon}</svg>`;
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
  if (u.follow.active) {
    if (o === 'charge') return ['Charging', 'hot'];
    if (o === 'fallback') return ['Falling back', 'warn'];
    if (u.firing) return ['Advancing, firing', 'hot'];
    return [u.formation === 'column' ? 'Marching in column' : u.run ? 'Advancing at the double' : 'Advancing', 'move'];
  }
  if (u.type === 'artillery' && !u.unlimbered) return ['Unlimbering', 'move'];
  if (u.firing) return ['Firing', 'hot'];
  if (u.state === 'wavering') return ['Wavering', 'warn'];
  return [o === 'hold' && u.order.firm ? 'Holding' : 'Halted', 'idle'];
}

/** A sentence for the flag's tooltip: who, how many, what now and what next. */
export function intention(u) {
  const [now] = activity(u);
  let next = '';
  if (u.follow.active && u.path && u.path.length > 1) {
    let len = 0;
    for (let i = 1; i < u.path.length; i++) len += Math.hypot(u.path[i][0] - u.path[i - 1][0], u.path[i][1] - u.path[i - 1][1]);
    const end = u.order.endFacing ?? u.facing;
    next = u.order.type === 'charge'
      ? `; ${Math.round(len)} m to the enemy, then hand-to-hand`
      : u.order.type === 'fallback'
        ? `; ${Math.round(len)} m back, then holds`
        : `; ${Math.round(len)} m to go, then holds facing ${compass(end)}`;
  } else if (u.state !== 'routing') {
    next = `; facing ${compass(u.facing)}`;
  }
  return `${u.name}: ${Math.round(u.men)} men, ${u.state}. ${now}${next}.`;
}

const rankShort = (r) => ({ 'Brigadier General': 'Brig. Gen.', Colonel: 'Col.', Captain: 'Capt.', Lieutenant: 'Lt.', 'First Lieutenant': '1st Lt.', Major: 'Maj.' }[r] || r || '');

export class Hud {
  constructor({ camera, canvas, terrain, units, playerSide, onSelect, onOrder, onPause, onSpeed, onQuality, onSound }) {
    Object.assign(this, { camera, canvas, terrain, units, playerSide, onSelect, onOrder });
    this.selected = null;
    this.markers = new Map();
    const box = $('markers');
    for (const u of units) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `marker ${u.side.toLowerCase()}`;
      b.innerHTML = `<span class="str"></span>${markerSvg(u.side, u.type)}<span class="nm">${u.short}</span><span class="act"></span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onSelect(u, { fromMarker: true }); });
      b.addEventListener('dblclick', (e) => { e.stopPropagation(); if (this.onFocus) this.onFocus(u); });
      b.addEventListener('pointerdown', (e) => this.onMarkerDown && this.onMarkerDown(u, e));
      box.appendChild(b);
      this.markers.set(u.id, { el: b, str: b.querySelector('.str'), act: b.querySelector('.act'), last: '', lastAct: '', lastTip: '' });
    }
    document.querySelector('#balance .flag.us').style.backgroundImage = flagDataUrl('US');
    document.querySelector('#balance .flag.cs').style.backgroundImage = flagDataUrl('CS');

    for (const btn of document.querySelectorAll('#orders button')) {
      btn.addEventListener('click', () => onOrder(btn.dataset.order));
    }
    $('pause').addEventListener('click', onPause);
    $('speed').addEventListener('click', onSpeed);
    const menu = $('menu');
    $('menu-btn').addEventListener('click', () => {
      for (const r of menu.querySelectorAll('input[name=quality]')) r.checked = r.value === this.quality;
      menu.showModal();
    });
    for (const r of menu.querySelectorAll('input[name=quality]')) r.addEventListener('change', () => onQuality(r.value));
    $('sound-toggle').addEventListener('change', (e) => onSound(e.target.checked));
    $('result-close').addEventListener('click', () => { $('result').hidden = true; });
    this.cardTimer = 0;
  }

  setQuality(q) { this.quality = q; }

  setPaused(p) {
    $('pause').textContent = p ? '▶' : '❚❚';
    $('pause').setAttribute('aria-pressed', String(p));
    $('pause').setAttribute('aria-label', p ? 'Play' : 'Pause');
  }

  setSpeed(s) { $('speed').textContent = `${s}×`; }

  select(u) {
    if (this.selected) this.markers.get(this.selected.id)?.el.classList.remove('selected');
    this.selected = u;
    if (u) this.markers.get(u.id)?.el.classList.add('selected');
    const card = $('unitcard');
    card.hidden = !u;
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
    $('uc-name').textContent = `${who} — ${u.parent || u.name}`;
    this.cardTimer = 0;
    this.updateCard(u);
    this.updateOrders();
  }

  updateOrders() {
    const u = this.selected;
    const mine = u && u.side === this.playerSide && u.canTakeOrders();
    for (const btn of document.querySelectorAll('#orders button')) {
      btn.disabled = !mine;
      if (btn.dataset.order === 'run') btn.setAttribute('aria-pressed', String(!!(mine && u.run)));
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

  /** Per frame: place markers (stacked so none hides another); every 0.25 s refresh numbers. */
  update(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    const shown = [];
    for (const u of this.units) {
      const m = this.markers.get(u.id);
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
    for (const { u, m } of shown) {
      const label = String(Math.round(u.men));
      if (label !== m.last) { m.str.textContent = label; m.last = label; }
      m.el.classList.toggle('wavering', u.state === 'wavering');
      m.el.classList.toggle('routing', u.state === 'routing');
      const [act, tone] = activity(u);
      const actKey = act + tone;
      if (actKey !== m.lastAct) { m.act.textContent = act; m.act.className = `act ${tone}`; m.lastAct = actKey; }
    }
    this.cardTimer -= dt;
    if (this.cardTimer <= 0) {
      this.cardTimer = 0.25;
      for (const u of this.units) {
        const m = this.markers.get(u.id);
        if (!u.alive) continue;
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
      let us = 0, cs = 0;
      for (const u of this.units) {
        const v = u.state === 'routing' ? u.men * 0.3 : u.men;
        if (u.side === 'US') us += v; else cs += v;
      }
      const share = us / Math.max(1, us + cs);
      $('bal-us').style.width = `${(share * 100).toFixed(1)}%`;
      $('bal-mark').style.left = `${(share * 100).toFixed(1)}%`;
      $('bal-text').textContent = `Union ${Math.round(us)} effective, Confederate ${Math.round(cs)}`;
    }
  }

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

  objective(text) { $('objective').textContent = text; }

  result(title, text) {
    $('result-title').textContent = title;
    $('result-text').textContent = text;
    $('result').hidden = false;
  }
}

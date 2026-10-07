// Project crate markers without intercepting march gestures. Native briefing and three contextual hints.
import * as THREE from 'three';
import { TIER_BY_ID } from '../reward/data.js';

const GLYPHS = { circle: '●', square: '■', diamond: '◆', hexagon: '⬢', star: '★' };
export function attachPracticeField({ game, scenario, hud, camera, terrain, rts, effects, manifest = null }) {
  if (!game.fieldCaptures.crates.length) return { update() {}, started: true };
  const intro = document.getElementById('intro'), start = document.getElementById('intro-start');
  const hint = document.getElementById('intro-hint'), tip = document.getElementById('tip');
  const counter = document.getElementById('capture-count'), layer = document.getElementById('field-crates');
  const stores = document.getElementById('field-stores'), actions = document.getElementById('stores-actions');
  const selection = document.getElementById('stores-selection'), timer = document.getElementById('intro-timer');
  if (manifest) {
    document.getElementById('intro-title').textContent = 'Your army on practice ground';
    document.getElementById('intro-text').textContent = `${manifest.allocation.formations} active formations · ${manifest.allocation.men.toLocaleString()} men · ${manifest.allocation.guns} guns. Hold the ground for 45 seconds and march onto stores. ${manifest.dormant.length} dormant formations stay unchanged in camp. Your actual losses and new loot return to camp; equipment and strengths are game values.`;
  }
  const v = new THREE.Vector3();
  const markers = game.fieldCaptures.crates.map((c) => {
    const t = TIER_BY_ID[c.tier], n = document.createElement('p'); n.className = 'field-crate';
    n.dataset.crate = c.id; n.style.setProperty('--rarity', t.color);
    const glyph = document.createElement('span'); glyph.className = 'crate-shape'; glyph.textContent = GLYPHS[t.shape]; glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'crate-label';
    n.append(glyph, label);
    const ns = 'http://www.w3.org/2000/svg', connector = document.createElementNS(ns, 'svg');
    connector.classList.add('crate-connector'); connector.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(ns, 'line'), anchor = document.createElementNS(ns, 'circle');
    line.setAttribute('stroke', t.color); line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '3 4');
    anchor.setAttribute('fill', t.color); anchor.setAttribute('r', '4'); connector.append(line, anchor);
    layer.append(connector, n);
    const march = document.createElement('button'); march.type = 'button'; march.dataset.crateOrder = c.id;
    march.addEventListener('click', () => {
      const u = game.selected; if (!game.controls(u) || !u.canTakeOrders()) return;
      game.orderGroup(u, { type: 'move', points: [[u.x, u.z], [c.x, c.z]] });
      stores.hidden = true; counter.setAttribute('aria-expanded', 'false'); document.getElementById('battlefield').focus({ preventScroll: true });
    });
    actions.append(march); return { c, n, label, t, connector, line, anchor, march };
  });
  function refreshSelection() {
    const commandable = game.controls(game.selected) && game.selected.canTakeOrders();
    const text = commandable ? `March ${game.selected.short} to stores; the brigade fights on the way.` : 'Select a brigade to march onto stores.';
    if (selection.textContent !== text) selection.textContent = text;
    for (const { march } of markers) march.disabled = !commandable || game.over;
  }
  // Keyboard users can select and open stores before the next rendered frame.
  game.on('select', refreshSelection);
  refreshSelection();
  counter.addEventListener('click', () => {
    stores.hidden = !stores.hidden; counter.setAttribute('aria-expanded', String(!stores.hidden));
    if (!stores.hidden) (actions.querySelector('button:not(:disabled)') || document.getElementById('stores-close')).focus();
  });
  document.getElementById('stores-close').addEventListener('click', () => { stores.hidden = true; counter.setAttribute('aria-expanded', 'false'); counter.focus(); });
  stores.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); document.getElementById('stores-close').click(); } });
  counter.hidden = !markers.length;
  let started = !scenario.practiceIntro, selected = false;
  if (scenario.practiceIntro) {
    game.paused = true; hud.setPaused(true); tip.hidden = true;
    intro.showModal(); start.focus({ preventScroll: true });
    function begin() {
      if (started) return;
      started = true; intro.close(); effects.unlock(); game.paused = false; hud.setPaused(false);
      hint.hidden = false; document.getElementById('battlefield').focus({ preventScroll: true });
    }
    intro.addEventListener('cancel', (e) => { e.preventDefault(); begin(); });
    start.addEventListener('click', begin);
    game.on('select', (u) => { if (u?.side === game.playerSide) selected = true; });
  }
  game.on('event', (e) => {
    if (e.kind !== 'capture') return;
    effects._play(0.35, (gain) => effects.sound.zzfx(gain, 0, e.side === game.playerSide ? 660 : 220, 0.01, 0.08, 0.18, 0));
  });
  function update() {
    const owned = game.fieldCaptures.held(game.playerSide).length;
    const countText = `Crates: ${owned}/${markers.length}`;
    if (counter.textContent !== countText) { counter.textContent = countText; document.getElementById('capture-status').textContent = countText; }
    refreshSelection();
    const occupied = [...hud.markers.values()].filter((m) => !m.el.classList.contains('hidden')).map((m) => m.el.getBoundingClientRect());
    for (const { c, n, label, t, connector, line, anchor, march } of markers) {
      v.set(c.x, terrain.heightAt(c.x, c.z) + 10, c.z).project(camera);
      n.hidden = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      connector.hidden = n.hidden; connector.style.display = n.hidden ? 'none' : '';
      const state = c.status === 'contested' ? 'Contested' : c.candidate ? `${c.candidate === 'US' ? 'Union' : 'Confederate'} capturing`
        : c.owner === 'US' ? 'Union held' : c.owner === 'CS' ? 'Confederate held' : 'Unclaimed';
      const labelText = `${c.name} · ${t.name} crate · ${state}`;
      if (label.textContent !== labelText) { label.textContent = labelText; n.setAttribute('aria-label', `${c.name}: ${t.name}, ${t.shape}, ${state}`); }
      const actionText = `March to ${c.name} · ${t.name} · ${state}`;
      if (march.textContent !== actionText) march.textContent = actionText;
      if (n.hidden) continue;
      const px = (v.x * 0.5 + 0.5) * innerWidth, py = (-v.y * 0.5 + 0.5) * innerHeight;
      const w = n.offsetWidth, h = n.offsetHeight;
      let pos = null;
      for (const [dx, dy] of [[140, 0], [-140, 0], [0, -120], [140, -90], [-140, -90], [0, 95]]) {
        const x = Math.max(8 + w / 2, Math.min(innerWidth - 8 - w / 2, px + dx));
        const y = Math.max(110 + h / 2, Math.min(innerHeight - 170 - h / 2, py + dy));
        const rect = { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
        if (!occupied.some((b) => rect.left < b.right + 5 && rect.right > b.left - 5 && rect.top < b.bottom + 5 && rect.bottom > b.top - 5)) { pos = { x, y, rect }; break; }
      }
      pos ||= { x: px, y: py - 120, rect: { left: px - w / 2, right: px + w / 2, top: py - 120 - h / 2, bottom: py - 120 + h / 2 } };
      occupied.push(pos.rect); n.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      for (const [key, value] of Object.entries({ x1: px, y1: py, x2: pos.x, y2: pos.y })) line.setAttribute(key, String(value));
      anchor.setAttribute('cx', String(px)); anchor.setAttribute('cy', String(py));
    }
    if (!scenario.practiceIntro || !started) return;
    hint.hidden = game.over || document.querySelector('main').inert;
    const message = !selected ? (manifest ? '1 · Select a blue brigade flag. Hold the ground with your saved formations.' : '1 · Select a blue brigade flag. Your two brigades can hold off this approach.')
      : !game.orders ? '2 · Drag from your brigade toward the Rare crate to march. It halts to fight on the way; Charge is a separate order.'
        : '3 · Hold stores for two seconds to capture them. Stop the enemy before it reaches your ground. Retaken crates lose their loot.';
    if (hint.textContent !== message) hint.textContent = message;
    timer.hidden = game.over;
    const timeText = `${Math.max(0, Math.ceil(45 - game.simTime))} seconds until ${manifest ? 'the result' : 'the issue'}.`;
    if (timer.textContent !== timeText) timer.textContent = timeText;
  }
  return { update, get started() { return started; } };
}

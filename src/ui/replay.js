// src/ui/replay.js: the after-action's 30-second animated map replay (a 2D canvas over the phase's ground).
//
//   mountReplay(host, { track, terrain?, woods?, reduced?, durationMs? }) -> { root, play(), pause(), toggle(), step(dir),
//     seek(frac), destroy(), get state() }
//
// `track` is a validated replay (src/sim/recorder.js). The ground is drawn once like the dock's minimap (parchment tinted by
// height with a north-west hillshade, woods, streams, roads; src/ui/minimap.js does the same for the live map), from the
// battle's terrain (heightAt, half, meta) when it is still in memory, else plain parchment fitted to the recorded
// positions. Over it, each formation is a block in its side's colour, as wide as its strength: formed = solid block;
// shaken = a block broken in two; routed = a hollow chevron pointing the way it faces; gone = a small cross. The
// objective is a dashed ring tinted by its holder. A clock, play/pause, step back/forward and a scrub slider sit
// under the map: native buttons and a range input, so Tab, Enter, Space and the arrow keys work. The whole battle plays
// in `durationMs` (30 s). Reduced motion starts paused (step through it instead). A status line (polite live region)
// describes the moment whenever play stops, so a screen reader hears where things stand.

import { replayFrame, replayClock } from '../sim/recorder.js';

const RES = 480; // backing pixels; CSS scales the canvas to the page
const COLOURS = { US: '#1f4fb0', CS: '#b0262f' };
const SIDE = { US: 'Union', CS: 'Confederate' };
const HOLDER_TEXT = { US: 'Union troops hold the objective', CS: 'Confederate troops hold the objective', contested: 'The objective is contested', none: 'Nobody holds the objective' };

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

/** The square of ground the replay shows: the terrain's, or the recorded positions' bounds with a margin. */
function extentOf(track, terrain) {
  if (terrain && Number.isFinite(terrain.half) && terrain.half > 0) return { cx: 0, cz: 0, half: terrain.half };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const s of track.samples) for (let i = 0; i < s.u.length; i += 5) add(s.u[i], s.u[i + 1]);
  if (track.objective) { add(track.objective.x - track.objective.r, track.objective.z - track.objective.r); add(track.objective.x + track.objective.r, track.objective.z + track.objective.r); }
  if (!Number.isFinite(x0)) return { cx: 0, cz: 0, half: 1000 };
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, half: Math.max(300, (x1 - x0) / 2, (z1 - z0) / 2) * 1.15 };
}

function drawBase(ctx, ext, terrain, woods) {
  const px = (x, z) => [((x - ext.cx + ext.half) / (2 * ext.half)) * RES, ((z - ext.cz + ext.half) / (2 * ext.half)) * RES];
  if (terrain && typeof terrain.heightAt === 'function') {
    const N = 160, img = ctx.createImageData(N, N), step = (2 * ext.half) / N, H = new Float32Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = terrain.heightAt(ext.cx - ext.half + (i + 0.5) * step, ext.cz - ext.half + (j + 0.5) * step) || 0;
      H[j * N + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
      const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
      let nx = -hx, ny = -hz, nz = 2 * step; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const shade = Math.max(0, nx * -0.6 + ny * -0.6 + nz * 0.53) / 0.53, t = (H[k] - lo) / Math.max(1, hi - lo);
      img.data[k * 4] = Math.min(255, (214 - 34 * t) * (0.55 + 0.45 * shade));
      img.data[k * 4 + 1] = Math.min(255, (204 - 22 * t) * (0.55 + 0.45 * shade));
      img.data[k * 4 + 2] = Math.min(255, (164 - 34 * t) * (0.55 + 0.45 * shade));
      img.data[k * 4 + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = N; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, RES, RES);
  } else { ctx.fillStyle = '#d6cca4'; ctx.fillRect(0, 0, RES, RES); }
  const poly = (pts, close) => { ctx.beginPath(); pts.forEach(([x, z], n) => { const [a, b] = px(x, z); if (n) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); if (close) ctx.closePath(); };
  ctx.fillStyle = 'rgba(62, 100, 46, 0.5)';
  for (const w of woods || []) if (Array.isArray(w) && w.length > 2) { poly(w, true); ctx.fill(); }
  const meta = (terrain && terrain.meta) || {};
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#4a7bb5'; ctx.lineWidth = 2;
  for (const s of meta.streams || []) if (Array.isArray(s.points)) { poly(s.points, false); ctx.stroke(); }
  ctx.strokeStyle = '#a0561f'; ctx.lineWidth = 2.4;
  for (const r of meta.roads || []) if (Array.isArray(r.points)) { poly(r.points, false); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, RES - 2, RES - 2);
  return px;
}

export function mountReplay(host, { track, terrain = null, woods = [], reduced = false, durationMs = 30000 } = {}) {
  if (!track || !Array.isArray(track.samples) || !track.samples.length) throw new Error('Replay: a replay needs a recorded track.');
  const t0 = track.samples[0].t, t1 = track.samples[track.samples.length - 1].t, span = Math.max(1e-6, t1 - t0);
  const ext = extentOf(track, terrain);
  const base = document.createElement('canvas'); base.width = RES; base.height = RES;
  const px = drawBase(base.getContext('2d'), ext, terrain, woods);
  const metres = RES / (2 * ext.half);

  const canvas = el('canvas', { class: 'rp-canvas', width: RES, height: RES, role: 'img',
    'aria-label': `Map of the phase from ${replayClock(track, t0) ?? 'the start'} to ${replayClock(track, t1) ?? 'the end'}: Union blocks blue, Confederate blocks red; a hollow chevron is a routed formation, a split block a shaken one.` });
  const clock = el('p', { class: 'rp-clock' }, el('b', { class: 'rp-time', text: '' }), el('span', { class: 'rp-holder', text: '' }));
  const back = el('button', { type: 'button', class: 'rp-btn rp-back', 'aria-label': 'Step back' }, el('span', { 'aria-hidden': 'true', text: '◀' }), el('span', { class: 'rp-btn-text', text: 'Back' }));
  const play = el('button', { type: 'button', class: 'rp-btn rp-play' }, el('span', { class: 'rp-play-icon', 'aria-hidden': 'true', text: '▶' }), el('span', { class: 'rp-play-text', text: 'Play' }));
  const fwd = el('button', { type: 'button', class: 'rp-btn rp-fwd', 'aria-label': 'Step forward' }, el('span', { class: 'rp-btn-text', text: 'Step' }), el('span', { 'aria-hidden': 'true', text: '▶' }));
  const scrub = el('input', { type: 'range', class: 'rp-scrub', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Replay position' });
  const status = el('p', { class: 'rp-status', role: 'status', 'aria-live': 'polite' });
  const legend = el('ul', { class: 'rp-legend', 'aria-label': 'Map key' },
    el('li', {}, el('i', { class: 'rp-key rp-key-us', 'aria-hidden': 'true' }), 'Union'),
    el('li', {}, el('i', { class: 'rp-key rp-key-cs', 'aria-hidden': 'true' }), 'Confederate'),
    el('li', {}, el('i', { class: 'rp-key rp-key-shaken', 'aria-hidden': 'true' }), 'Shaken: split block'),
    el('li', {}, el('i', { class: 'rp-key rp-key-routed', 'aria-hidden': 'true' }), 'Routed: hollow chevron'),
    el('li', {}, el('i', { class: 'rp-key rp-key-gone', 'aria-hidden': 'true' }), 'Gone: cross'),
    el('li', {}, el('i', { class: 'rp-key rp-key-obj', 'aria-hidden': 'true' }), 'Objective'));
  const root = el('div', { class: 'rp', 'data-playing': 'false' },
    el('div', { class: 'rp-map' }, canvas), clock,
    el('div', { class: 'rp-controls', role: 'group', 'aria-label': 'Replay controls' }, back, play, fwd, scrub), status, legend);
  host.append(root);
  const ctx = canvas.getContext('2d');

  const S = { t: t0, playing: false, raf: 0, last: 0, dead: false, ended: false, frames: 0 };
  const sampleIndex = (t) => { let i = 0; while (i < track.samples.length - 1 && track.samples[i + 1].t <= t + 1e-9) i++; return i; };

  function draw() {
    const f = replayFrame(track, S.t);
    ctx.drawImage(base, 0, 0);
    const o = track.objective;
    if (o) {
      const [a, b] = px(o.x, o.z), r = Math.max(6, o.r * metres);
      ctx.save();
      ctx.fillStyle = f.holder === 'US' ? 'rgba(31,79,176,0.16)' : f.holder === 'CS' ? 'rgba(176,38,47,0.16)' : 'rgba(60,40,20,0.06)';
      ctx.beginPath(); ctx.arc(a, b, r, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(50,34,16,0.9)'; ctx.stroke();
      ctx.restore();
    }
    for (const u of f.units) {
      const [a, b] = px(u.x, u.z), col = COLOURS[u.side];
      ctx.save(); ctx.translate(a, b); ctx.rotate(-u.facing);
      if (u.state === 'gone') {
        ctx.strokeStyle = 'rgba(40,30,20,0.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.moveTo(3, -3); ctx.lineTo(-3, 3); ctx.stroke();
        ctx.restore(); continue;
      }
      // width from present strength (a game drawing scale, not to the map's metres): about 23 px for 3,000 men, 5 to 36 px
      const w = Math.max(5, Math.min(36, 0.42 * Math.sqrt(u.men))), h = u.type === 'artillery' ? 6 : 5;
      if (u.state === 'routed') {
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(0, h); ctx.lineTo(w / 2, -h / 2); ctx.stroke(); // chevron toward the facing (+y)
      } else {
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(255,250,235,0.85)'; ctx.lineWidth = 1;
        if (u.state === 'shaken') {
          const g = Math.max(2, w * 0.18), half = (w - g) / 2;
          ctx.fillRect(-w / 2, -h / 2, half, h); ctx.fillRect(g / 2, -h / 2, half, h);
          ctx.strokeRect(-w / 2, -h / 2, half, h); ctx.strokeRect(g / 2, -h / 2, half, h);
        } else { ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); }
      }
      ctx.restore();
    }
    const time = replayClock(track, S.t);
    clock.querySelector('.rp-time').textContent = time ?? `${Math.round(S.t)} s`;
    clock.querySelector('.rp-holder').textContent = HOLDER_TEXT[f.holder] || '';
    scrub.value = String(Math.round(((S.t - t0) / span) * 1000));
    scrub.setAttribute('aria-valuetext', `${time ?? `${Math.round(S.t)} seconds`}, ${HOLDER_TEXT[f.holder] || ''}`);
    root.dataset.sample = String(f.sample);
    S.frames++;
    return f;
  }
  function describe() {
    const f = replayFrame(track, S.t), count = (side, state) => f.units.filter((u) => u.side === side && u.state === state).length;
    const parts = ['US', 'CS'].map((side) => `${SIDE[side]}: ${count(side, 'formed')} formed, ${count(side, 'shaken')} shaken, ${count(side, 'routed')} routed, ${count(side, 'gone')} gone`);
    status.textContent = `${S.ended ? 'Replay ended. ' : ''}${replayClock(track, S.t) ?? `${Math.round(S.t)} s`}. ${HOLDER_TEXT[f.holder] || ''}. ${parts.join('; ')}.`;
  }
  function setPlaying(on) {
    S.playing = on; root.dataset.playing = String(on);
    play.querySelector('.rp-play-icon').textContent = on ? '❚❚' : '▶';
    play.querySelector('.rp-play-text').textContent = on ? 'Pause' : 'Play';
    if (!on) { cancelAnimationFrame(S.raf); S.raf = 0; describe(); }
  }
  function frame(now) {
    if (S.dead || !S.playing) return;
    const dt = S.last ? Math.min(100, now - S.last) : 0; S.last = now;
    S.t = Math.min(t1, S.t + (dt / durationMs) * span);
    draw();
    if (S.t >= t1) { S.ended = true; root.dataset.ended = 'true'; setPlaying(false); return; }
    S.raf = requestAnimationFrame(frame);
  }
  const api = {
    root,
    play() {
      if (S.dead || S.playing) return;
      if (S.t >= t1) { S.t = t0; S.ended = false; delete root.dataset.ended; }
      setPlaying(true); S.last = 0; S.raf = requestAnimationFrame(frame);
    },
    pause() { if (S.playing) setPlaying(false); },
    toggle() { if (S.playing) api.pause(); else api.play(); },
    /** One recorded sample back (-1) or forward (+1); pauses first. */
    step(dir) {
      api.pause();
      const i = sampleIndex(S.t), at = track.samples[i].t;
      const j = dir < 0 ? (S.t > at + 1e-6 ? i : Math.max(0, i - 1)) : Math.min(track.samples.length - 1, i + 1);
      S.t = track.samples[j].t; S.ended = S.t >= t1; draw(); describe();
    },
    seek(frac) { api.pause(); S.t = t0 + Math.max(0, Math.min(1, frac)) * span; S.ended = false; draw(); describe(); },
    destroy() { S.dead = true; cancelAnimationFrame(S.raf); root.remove(); },
    get state() { return { t: S.t, start: t0, end: t1, playing: S.playing, ended: S.ended, frames: S.frames, sample: sampleIndex(S.t), samples: track.samples.length }; },
  };
  play.addEventListener('click', () => api.toggle());
  back.addEventListener('click', () => api.step(-1));
  fwd.addEventListener('click', () => api.step(1));
  scrub.addEventListener('input', () => { api.pause(); S.t = t0 + (Number(scrub.value) / 1000) * span; S.ended = false; draw(); });
  scrub.addEventListener('change', () => describe());
  draw(); describe();
  if (!reduced) api.play();
  return api;
}

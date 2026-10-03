// src/ui/minimap.js: the dock's survey-style minimap (v1).
//
// The ground is drawn once into an offscreen canvas: parchment tinted by height with a hillshade from the
// terrain heights, the woods (PLAN.woods), roads and streams (terrain.meta), farm sites and the objective.
// Four times a second (Hud.update) the visible canvas copies it and adds a block per unit (blue Union, red
// Confederate, hollow when routing, ringed when selected) and the camera's view footprint. North is up.
// Click, tap or drag on it to move the camera there; key M toggles a large version.

import { PLAN } from '../world/landscape.js';

const RES = 400; // backing pixels (the dock shows it at ~140 CSS px; the large map at up to 720)

export class Minimap {
  constructor({ canvas, box, terrain, units, rts, game }) {
    Object.assign(this, { canvas, box, terrain, units, rts, game });
    canvas.width = RES;
    canvas.height = RES;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = RES;
    this.base.height = RES;
    this.half = terrain.half;
    this.foot = [];
    this.drawBase();
    this.draw();
    let down = false;
    const jump = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * this.half - this.half;
      const z = ((e.clientY - r.top) / r.height) * 2 * this.half - this.half;
      rts.focus(x, z);
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      down = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no capture */ }
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => { if (down) { jump(e); rts.snap(); } });
    const end = () => { down = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  /** World (x, z) to backing pixels. */
  px(x, z) {
    return [((x + this.half) / (2 * this.half)) * RES, ((z + this.half) / (2 * this.half)) * RES];
  }

  drawBase() {
    const T = this.terrain;
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(RES, RES);
    const step = (2 * this.half) / RES;
    let lo = Infinity, hi = -Infinity;
    const H = new Float32Array(RES * RES);
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const h = T.heightAt(-this.half + (i + 0.5) * step, -this.half + (j + 0.5) * step);
        H[j * RES + i] = h;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    // light from the north-west, as on a hand-shaded survey
    const lx = -0.6, ly = -0.6, lz = 0.53;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const k = j * RES + i;
        const hx = H[j * RES + Math.min(RES - 1, i + 1)] - H[j * RES + Math.max(0, i - 1)];
        const hz = H[Math.min(RES - 1, j + 1) * RES + i] - H[Math.max(0, j - 1) * RES + i];
        let nx = -hx, ny = -hz, nz = 2 * step;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const shade = Math.max(0, nx * lx + ny * ly + nz * lz) / 0.53; // 1 on flat ground
        const t = (H[k] - lo) / Math.max(1, hi - lo);
        const r = (214 - 34 * t) * (0.55 + 0.45 * shade);
        const g = (204 - 22 * t) * (0.55 + 0.45 * shade);
        const b = (164 - 34 * t) * (0.55 + 0.45 * shade);
        img.data[k * 4] = Math.min(255, r);
        img.data[k * 4 + 1] = Math.min(255, g);
        img.data[k * 4 + 2] = Math.min(255, b);
        img.data[k * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const poly = (pts, close) => {
      ctx.beginPath();
      pts.forEach(([x, z], n) => { const [a, b] = this.px(x, z); if (n) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
      if (close) ctx.closePath();
    };
    ctx.fillStyle = 'rgba(62, 100, 46, 0.55)';
    for (const w of PLAN.woods || []) { poly(w, true); ctx.fill(); }
    const meta = T.meta || {};
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4a7bb5';
    ctx.lineWidth = 2;
    for (const s of meta.streams || []) { poly(s.points, false); ctx.stroke(); }
    ctx.strokeStyle = '#b0612a';
    ctx.lineWidth = 2.6;
    for (const r of meta.roads || []) { poly(r.points, false); ctx.stroke(); }
    ctx.fillStyle = '#8a2a20';
    for (const s of PLAN.sites || []) { const [a, b] = this.px(s.x, s.z); ctx.fillRect(a - 3, b - 3, 6, 6); }
    const o = this.game && this.game.objective;
    if (o) {
      const [a, b] = this.px(o.x, o.z);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(60, 40, 20, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a, b, (o.r / (2 * this.half)) * RES, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, RES - 2, RES - 2);
  }

  /** Units and the view footprint over the base (4 times a second). */
  draw() {
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    const s = RES / (2 * this.half);
    for (const u of this.units) {
      if (!u.alive) continue;
      const [a, b] = this.px(u.x, u.z);
      const w = Math.max(7, u.lineHalfFront() * 2 * s), h = 5;
      ctx.save();
      ctx.translate(a, b);
      // facing f: forward (sin f, cos f) in (x, z) = (right, down) on the map
      ctx.rotate(-u.facing);
      const col = u.side === 'US' ? '#1f4fb0' : '#b0262f';
      if (u.state === 'routing') {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = col;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      if (u.selected) {
        ctx.strokeStyle = '#fff6c0';
        ctx.lineWidth = 2;
        ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
      }
      ctx.restore();
    }
    const f = this.rts.footprint(this.foot);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    f.forEach(([x, z], n) => { const [a, b] = this.px(x, z); if (n) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
    ctx.closePath();
    ctx.stroke();
  }

  toggleLarge() {
    this.box.classList.toggle('large');
  }
}

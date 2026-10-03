// src/ui/input.js: mouse and keyboard.
//
// Left button: on your brigade (or its flag) selects it, and dragging draws its march (release to order;
//   ending on an enemy orders a charge). On an enemy selects it to inspect. On open ground drags the map;
//   a click on open ground clears the selection.
// Right button: drag turns/tilts the camera; a click on the ground marches the selected brigade straight
//   there. Middle drag turns too.
// Mouse wheel zooms toward the pointer. Trackpad (Mac): two-finger scroll pans, pinch zooms toward the
//   pointer, Option + two-finger scroll turns and tilts. Double-click a flag to centre the camera on it.
// Keys: H hold, C charge, R run, F fall back, X halt, Space pause, 1/2/3 speed, Esc deselect, G quality;
//   camera keys are handled by RtsCamera.

const DRAG_PX = 7;
const MIN_ORDER_M = 22;

export class Input {
  constructor({ canvas, rts, game, arrows, hud, playerSide, onQualityKey }) {
    Object.assign(this, { canvas, rts, game, arrows, hud, playerSide, onQualityKey });
    this.drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.down(e, null));
    hud.onMarkerDown = (u, e) => this.down(e, u);
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', () => this.cancel());
    this.wheelGesture = null;
    const onWheel = (e) => {
      e.preventDefault();
      const kind = this.wheelKind(e);
      if (kind === 'pinch') {
        rts.zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.012), rts.pick(e.clientX, e.clientY, canvas));
      } else if (kind === 'trackpad') {
        if (e.altKey) rts.rotateBy(e.deltaX * 0.004, e.deltaY * 0.002);
        else rts.panPixels(e.deltaX, e.deltaY, window.innerHeight);
      } else {
        const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1); // lines or pages to pixels
        rts.zoomBy(Math.exp(Math.max(-120, Math.min(120, px)) * 0.0015), rts.pick(e.clientX, e.clientY, canvas));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // the flags sit over the canvas: wheel over a flag must still steer the camera
    document.getElementById('markers').addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => rts.onKey(e, false));
    window.addEventListener('blur', () => rts.keys.clear());
  }

  /**
   * What sent this wheel event: 'pinch' (trackpad pinch, which browsers send with ctrlKey), 'trackpad'
   * (two-finger scroll: precise pixel deltas) or 'mouse' (a wheel: line deltas, or pixel deltas in whole
   * notches of 120). A gesture keeps its first answer, so trackpad momentum is never read as a wheel.
   */
  wheelKind(e) {
    if (e.ctrlKey) return 'pinch';
    const now = performance.now();
    const g = this.wheelGesture;
    if (g && now - g.t < 240) { g.t = now; return g.kind; }
    let kind;
    if (e.deltaMode !== 0) kind = 'mouse';
    else if (e.deltaX !== 0) kind = 'trackpad';
    else if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) kind = Math.abs(e.wheelDeltaY) % 120 === 0 ? 'mouse' : 'trackpad';
    else kind = Math.abs(e.deltaY) >= 50 ? 'mouse' : 'trackpad';
    this.wheelGesture = { kind, t: now };
    return kind;
  }

  unitAt(p) {
    if (!p) return null;
    let best = null, bestD = Infinity;
    for (const u of this.game.units) {
      if (!u.alive || !u.contains(p.x, p.z, 12)) continue;
      const d = Math.hypot(u.x - p.x, u.z - p.z) + (u.side === this.playerSide ? 0 : 40);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  down(e, markerUnit) {
    this.game.effects.unlock();
    if (this.drag) return;
    if (markerUnit) e.preventDefault();
    else this.canvas.focus({ preventScroll: true });
    const p = this.rts.pick(e.clientX, e.clientY, this.canvas);
    const unit = markerUnit || (e.button === 0 ? this.unitAt(p) : null);
    if (e.button === 0) {
      if (unit) {
        this.game.select(unit);
        if (unit.side === this.playerSide && unit.canTakeOrders()) {
          this.drag = { mode: 'order', unit, x: e.clientX, y: e.clientY, active: false, points: [[unit.x, unit.z]], id: e.pointerId };
        } else {
          this.drag = { mode: 'pan', ground: p, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, keep: true };
        }
      } else {
        this.drag = { mode: 'pan', ground: p, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      }
    } else {
      this.drag = { mode: 'rotate', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, ground: p, id: e.pointerId, button: e.button };
    }
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX;
    if (d.mode === 'order') {
      if (!d.active && !far) return;
      d.active = true;
      const p = this.rts.pick(e.clientX, e.clientY, this.canvas);
      if (!p) return;
      const last = d.points[d.points.length - 1];
      if (Math.hypot(p.x - last[0], p.z - last[1]) > 9) d.points.push([p.x, p.z]);
      d.preview = this.arrows.setPreview(d.points.concat([[p.x, p.z]]), d.unit.side, Math.min(26, Math.max(12, d.unit.halfFront * 0.22)), d.unit.lineHalfFront());
      d.end = p;
    } else if (d.mode === 'pan') {
      if (far) d.moved = true;
      if (!d.moved || !d.ground) return;
      const p = this.rts.pick(e.clientX, e.clientY, this.canvas);
      if (p) this.rts.panBy(d.ground.x - p.x, d.ground.z - p.z);
    } else if (d.mode === 'rotate') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX) d.moved = true;
      this.rts.rotateBy((e.clientX - d.x) * 0.006, (e.clientY - d.y) * 0.004);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.mode === 'order') {
      this.arrows.clearPreview();
      if (!d.active || !d.preview) return;
      const pts = d.preview;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len < MIN_ORDER_M) return;
      const enemy = d.end ? this.unitAt(d.end) : null;
      const charge = enemy && enemy.side !== d.unit.side;
      this.game.order(d.unit, { type: charge ? 'charge' : 'move', points: pts, target: charge ? enemy : null });
    } else if (d.mode === 'pan') {
      if (!d.moved && !d.keep) this.game.select(null);
    } else if (d.mode === 'rotate') {
      if (!d.moved && d.button === 2 && d.ground) {
        const u = this.game.selected;
        if (u && u.side === this.playerSide && u.canTakeOrders()) {
          const enemy = this.unitAt(d.ground);
          const charge = enemy && enemy.side !== u.side;
          this.game.order(u, { type: charge ? 'charge' : 'move', points: [[u.x, u.z], [d.ground.x, d.ground.z]], target: charge ? enemy : null });
        }
      }
    }
  }

  cancel() {
    if (this.drag && this.drag.mode === 'order') this.arrows.clearPreview();
    this.drag = null;
  }

  key(e) {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const onButton = e.target instanceof HTMLButtonElement;
    if (k === ' ' && !onButton) { e.preventDefault(); this.game.togglePause(); return; }
    if (k === 'escape') { this.game.select(null); return; }
    if (k === 'g') { this.onQualityKey(); return; }
    if (k === '1' || k === '2' || k === '3') { this.game.setSpeed({ 1: 1, 2: 2, 3: 4 }[k]); return; }
    const orderKeys = { h: 'hold', c: 'charge', r: 'run', f: 'fallback', x: 'halt' };
    if (orderKeys[k]) { this.game.orderSelected(orderKeys[k]); return; }
    if (!onButton && this.rts.onKey(e, true)) e.preventDefault();
  }
}

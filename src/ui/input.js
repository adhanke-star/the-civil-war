// src/ui/input.js: mouse, trackpad, touch (Pointer Events) and keyboard.
//
// Mouse / trackpad:
//   left-drag from one of your brigades (its men or its flag) draws its march; release to order. Releasing on
//     an enemy orders an attack (close to effective range and fire); Shift while dragging faces the ghost
//     along the last part of the drag instead of toward the nearest enemy.
//   left-drag on open ground pans (the ground stays under the pointer) and glides on after release
//     (rules.panInertia); a click on open ground clears the selection; Shift+drag on ground = box select;
//     Shift+click a brigade adds it to (or takes it from) the selection.
//   right-drag (or middle) turns and tilts; a right-click on the ground marches the selection straight there
//     (on an enemy: attack). Double-click a brigade or its flag to fly to it.
//   wheel zooms toward the pointer; trackpad pinch (ctrlKey wheel) zooms toward the pointer; two-finger
//     scroll pans; Option + two-finger scroll turns and tilts.
// Touch (iPad): a tap selects; a drag from your brigade draws its order (a second finger placed during the drag
//   twists the ghost's facing); one-finger drag on open ground pans; hold 350 ms on open ground then drag to
//   box-select; two fingers pinch to zoom and drag to pan; double-tap a brigade to fly to it. The browser's
//   own pinch and its compatibility mouse events after a touch are suppressed.
// Keys: H hold, C charge, R run, F fall back, X halt, V hold fire, Space pause, 1/2/3 speed, M map, L army
//   list, Esc deselect, G quality; camera keys are handled by RtsCamera. Orders go to every selected brigade.

import { RULES } from '../sim/rules.js';
import { coverWord, minutesText } from './hud.js';

const DRAG_PX = { mouse: 7, pen: 7, touch: 11 };
const MIN_ORDER_M = 22;
const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 380;
const MOUSE_AFTER_TOUCH_MS = 800;

export class Input {
  constructor({ canvas, rts, game, arrows, hud, playerSide, onQualityKey }) {
    Object.assign(this, { canvas, rts, game, arrows, hud, playerSide, onQualityKey });
    this.drag = null;
    this.pointers = new Map(); // pointerId -> { x, y, type }
    this.lastTouch = -1e9;
    this.lastTap = null; // { t, unit } for double-tap
    this.longPress = 0;
    this.panSamples = [];
    this.box = document.createElement('div');
    this.box.id = 'boxsel';
    this.box.hidden = true;
    document.body.appendChild(this.box);

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.down(e, null));
    canvas.addEventListener('dblclick', (e) => {
      if (this.isCompatMouse(e)) return;
      const u = this.unitAt(this.rts.pick(e.clientX, e.clientY, canvas));
      if (u) this.rts.flyTo(u.x, u.z);
    });
    hud.onMarkerDown = (u, e) => this.down(e, u);
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.cancel(e));
    // Safari: no page pinch-zoom or rubber-band scroll over the field (touch-action: none covers the rest)
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    for (const el of [canvas, document.getElementById('markers')]) el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    this.wheelGesture = null;
    const onWheel = (e) => {
      e.preventDefault();
      this.rts.inertia = null;
      const kind = this.wheelKind(e);
      if (kind === 'pinch') {
        rts.zoomAt(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.012), e.clientX, e.clientY, canvas);
      } else if (kind === 'trackpad') {
        if (e.altKey) rts.rotateBy(e.deltaX * 0.004, e.deltaY * 0.002);
        else rts.panPixels(e.deltaX, e.deltaY, window.innerHeight);
      } else {
        const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1); // lines or pages to pixels
        rts.zoomAt(Math.exp(Math.max(-120, Math.min(120, px)) * 0.0015), e.clientX, e.clientY, canvas);
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // the flags sit over the canvas: wheel over a flag must still steer the camera
    document.getElementById('markers').addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => rts.onKey(e, false));
    window.addEventListener('blur', () => { rts.keys.clear(); this.cancel(); });
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

  /** A mouse event the browser made up after a touch (iPad Safari sends them): ignore it. */
  isCompatMouse(e) {
    return (e.pointerType === 'mouse' || e.pointerType === undefined) && performance.now() - this.lastTouch < MOUSE_AFTER_TOUCH_MS;
  }

  unitAt(p) {
    if (!p) return null;
    let best = null, bestD = Infinity;
    for (const u of this.game.units) {
      if (!u.alive || !u.contains(p.x, p.z, 12)) continue;
      const d = Math.hypot(u.x - p.x, u.z - p.z) + (this.game.controls(u) ? 0 : 40);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  mine(u) {
    return this.game.controls(u) && u.canTakeOrders();
  }

  // ---------------------------------------------------------------------------------------------------
  down(e, markerUnit) {
    if (this.isCompatMouse(e)) return;
    this.game.effects.unlock();
    const touch = e.pointerType === 'touch';
    if (touch) {
      this.lastTouch = performance.now();
      // the first finger of a new touch: forget fingers whose lift we never heard (a missed pointerup)
      if (e.isPrimary) for (const [id, p] of this.pointers) if (p.type === 'touch') this.pointers.delete(id);
      if (e.isPrimary && this.drag && this.drag.type === 'touch') this.cancel();
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    this.rts.inertia = null;
    if (markerUnit || touch) e.preventDefault();
    if (!markerUnit) this.canvas.focus({ preventScroll: true });
    if (touch) { this.touchDown(e, markerUnit); return; }
    if (this.drag && this.drag.mode === 'lifting') this.drag = null;
    if (this.drag) return;
    const p = this.rts.pick(e.clientX, e.clientY, this.canvas);
    const base = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
    if (e.button === 0) {
      const unit = markerUnit || this.unitAt(p);
      if (unit) {
        if (e.shiftKey && this.mine(unit)) { this.game.select(unit, { add: true }); return; }
        if (!this.game.selection.includes(unit)) this.game.select(unit);
        this.drag = this.mine(unit) ? { ...base, mode: 'order', unit, active: false, points: [[unit.x, unit.z]] } : { ...base, mode: 'pan', ground: p, moved: false, keep: true, unit };
      } else if (e.shiftKey) {
        this.drag = { ...base, mode: 'box', x0: e.clientX, y0: e.clientY, active: true };
        this.showBox(e.clientX, e.clientY, e.clientX, e.clientY);
      } else {
        this.drag = { ...base, mode: 'pan', ground: p, moved: false };
      }
    } else {
      this.drag = { ...base, mode: 'rotate', sx: e.clientX, sy: e.clientY, moved: false, ground: p, button: e.button };
    }
  }

  touchDown(e, markerUnit) {
    const n = this.pointers.size;
    const d = this.drag;
    if (n === 1) {
      const p = this.rts.pick(e.clientX, e.clientY, this.canvas);
      const unit = markerUnit || this.unitAt(p);
      const base = { x: e.clientX, y: e.clientY, id: e.pointerId, type: 'touch' };
      if (unit) {
        if (!this.game.selection.includes(unit)) this.game.select(unit);
        this.drag = this.mine(unit) ? { ...base, mode: 'order', unit, active: false, points: [[unit.x, unit.z]] } : { ...base, mode: 'pan', ground: p, moved: false, keep: true, unit };
      } else {
        this.drag = { ...base, mode: 'pan', ground: p, moved: false };
        clearTimeout(this.longPress);
        const mine = this.drag;
        this.longPress = setTimeout(() => {
          if (this.drag !== mine || mine.moved) return;
          // held still on open ground: a box select starts here
          this.drag = { ...base, mode: 'box', x0: base.x, y0: base.y, active: true };
          this.showBox(base.x, base.y, base.x, base.y);
        }, LONG_PRESS_MS);
      }
      return;
    }
    if (n !== 2) return; // three or more fingers: ignored
    clearTimeout(this.longPress);
    const ids = [...this.pointers.keys()];
    if (d && d.mode === 'order' && d.active) {
      // a second finger while drawing an order twists the ghost (DESIGN.md 4b "Touch orders")
      const other = ids.find((id) => id !== d.id);
      const a = this.pointers.get(d.id), b = this.pointers.get(other);
      d.twist = { id: other, a0: this.groundAngle(a, b), face0: d.face ?? d.unit.facing };
      return;
    }
    // otherwise two fingers pinch and pan the map
    if (d && d.mode === 'order') this.arrows.clearPreview();
    this.hideBox();
    this.hud.setGhostLabel(null);
    const [a, b] = ids.map((id) => this.pointers.get(id));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.drag = { mode: 'pinch', ids, ground: this.rts.pick(cx, cy, this.canvas), d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), dist0: this.rts.goal.dist };
  }

  /** World bearing (facing convention) from the ground under pointer a to the ground under pointer b. */
  groundAngle(a, b) {
    const pa = this.rts.pick(a.x, a.y, this.canvas), pb = this.rts.pick(b.x, b.y, this.canvas);
    if (!pa || !pb) return Math.atan2(b.x - a.x, b.y - a.y);
    return Math.atan2(pb.x - pa.x, pb.z - pa.z);
  }

  move(e) {
    if (this.isCompatMouse(e)) return;
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) { ptr.x = e.clientX; ptr.y = e.clientY; }
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pinch') { if (d.ids.includes(e.pointerId)) this.pinchMove(d); return; }
    if (d.mode === 'order' && d.twist && e.pointerId === d.twist.id) {
      const a = this.pointers.get(d.id), b = this.pointers.get(d.twist.id);
      if (a && b) { d.face = d.twist.face0 + (this.groundAngle(a, b) - d.twist.a0); d.faceSet = true; this.orderPreview(d, a.x, a.y, false); }
      return;
    }
    if (e.pointerId !== d.id) return;
    const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > (DRAG_PX[d.type] || 7);
    if (d.mode === 'order') {
      if (!d.active && !far) return;
      d.active = true;
      this.orderPreview(d, e.clientX, e.clientY, e.shiftKey);
    } else if (d.mode === 'pan') {
      if (far && !d.moved) { d.moved = true; clearTimeout(this.longPress); this.panSamples.length = 0; }
      if (!d.moved || !d.ground) return;
      this.rts.anchor(d.ground, e.clientX, e.clientY, this.canvas);
      this.rts.snap();
      const now = performance.now();
      this.panSamples.push([now, this.rts.goal.x, this.rts.goal.z]);
      while (this.panSamples.length > 2 && now - this.panSamples[0][0] > 100) this.panSamples.shift();
    } else if (d.mode === 'box') {
      this.showBox(d.x0, d.y0, e.clientX, e.clientY);
      d.x1 = e.clientX; d.y1 = e.clientY;
    } else if (d.mode === 'rotate') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX.mouse) d.moved = true;
      this.rts.rotateBy((e.clientX - d.x) * 0.006, (e.clientY - d.y) * 0.004);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  }

  pinchMove(d) {
    const a = this.pointers.get(d.ids[0]), b = this.pointers.get(d.ids[1]);
    if (!a || !b) return;
    const D = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const r = this.rts;
    r.goal.dist = Math.min(r.maxDist, Math.max(r.minDist, d.dist0 * (d.d0 / D)));
    r.goal.pitch = r._pitch(r.goal.dist);
    if (d.ground) r.anchor(d.ground, cx, cy, this.canvas);
    r.snap();
  }

  /** The order being drawn: preview line, ghost, arc and label (move, or attack when over an enemy). */
  orderPreview(d, cx, cy, shift) {
    const g = this.game;
    const u = d.unit;
    const p = this.rts.pick(cx, cy, this.canvas);
    if (!p) return;
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p.x - last[0], p.z - last[1]) > 9) d.points.push([p.x, p.z]);
    const over = this.unitAt(p);
    const enemy = over && over.side !== u.side && over.state !== 'routing' ? over : null;
    const arc = this.arcOf(u);
    const width = Math.min(26, Math.max(12, u.halfFront * 0.22));
    d.enemy = enemy;
    if (enemy) {
      const halt = g.attackHalt(u, enemy);
      d.preview = this.arrows.setPreview([[u.x, u.z], [halt.x, halt.z]], u.side, width, u.lineHalfFront(), { facing: halt.facing, arc });
      if (!d.preview) d.preview = [[u.x, u.z], [halt.x, halt.z]];
      const len = Math.hypot(halt.x - u.x, halt.z - u.z);
      const mins = g.marchMinutes(len);
      this.hud.setGhostLabel({ text: `Attack ${enemy.short}: halts at ${Math.round(g.effRange(u))} m and fires${len > 10 ? ` · ${minutesText(mins)}` : ''}`, x: halt.x, z: halt.z });
      d.end = p;
      return;
    }
    const pts = d.points.concat([[p.x, p.z]]);
    let face = g.ghostFacing(p.x, p.z, u.side, undefined);
    if (shift) face = this.dragDirection(pts) ?? face;
    if (d.faceSet) face = d.face;
    else d.face = face;
    let extras = null;
    if (g.selection.length > 1 && g.selection.includes(u)) {
      const f = Number.isFinite(face) ? face : u.facing;
      extras = g.orderable().filter((v) => v !== u).map((v) => {
        const [dx, dz] = g.groupOffset(u, v, f);
        return { x: p.x + dx, z: p.z + dz, facing: f, halfFront: v.lineHalfFront() };
      });
    }
    d.preview = this.arrows.setPreview(pts, u.side, width, u.lineHalfFront(), { facing: face, arc, extras });
    d.end = p;
    const end = this.arrows.previewEnd;
    if (end) {
      const c = g.coverAt(end.x, end.z);
      const cover = c.value > 1 ? ` · ${c.kind}: ${coverWord(c.value)} cover` : '';
      this.hud.setGhostLabel({ text: `${minutesText(g.marchMinutes(end.length))} march${cover}`, x: end.x, z: end.z });
    }
  }

  /** Facing along the last ~25 m of the drag (Shift while dragging). */
  dragDirection(pts) {
    const b = pts[pts.length - 1];
    for (let i = pts.length - 2; i >= 0; i--) {
      const a = pts[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 25 || i === 0) {
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return null;
        return Math.atan2(b[0] - a[0], b[1] - a[1]);
      }
    }
    return null;
  }

  /** The firing arc a ghost shows for unit u. */
  arcOf(u) {
    const range = this.game.range(u);
    return { range, canister: u.type === 'artillery' ? 150 * 0.9144 : 0 };
  }

  up(e) {
    if (this.isCompatMouse(e)) return;
    if (e.pointerType === 'touch') this.lastTouch = performance.now();
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (d.ids.includes(e.pointerId)) this.drag = { mode: 'lifting' }; // the other finger does nothing until it lifts
      return;
    }
    if (d.mode === 'lifting') { if (!this.pointers.size) this.drag = null; return; }
    if (d.mode === 'order' && d.twist && e.pointerId === d.twist.id) { d.twist = null; return; }
    if (e.pointerId !== d.id) return;
    this.drag = this.pointers.size ? { mode: 'lifting' } : null;
    clearTimeout(this.longPress);
    const g = this.game;
    if (d.mode === 'order') {
      this.arrows.clearPreview();
      this.hud.setGhostLabel(null);
      if (!d.active || !d.preview) { this.tapUnit(d.unit, e); return; }
      const pts = d.preview;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d.enemy) g.orderGroup(d.unit, { type: 'attack', target: d.enemy });
      else if (len >= MIN_ORDER_M) g.orderGroup(d.unit, { type: 'move', points: pts, endFacing: d.face });
    } else if (d.mode === 'pan') {
      if (!d.moved) {
        if (d.keep) this.tapUnit(d.unit, e);
        else g.select(null);
        return;
      }
      // a released pan glides on (rules.panInertia)
      const s = this.panSamples;
      if (RULES.panInertia && s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        const dt = (b[0] - a[0]) / 1000;
        if (dt > 0.01 && performance.now() - b[0] < 80) {
          const cap = this.rts.goal.dist * 3;
          let vx = (b[1] - a[1]) / dt, vz = (b[2] - a[2]) / dt;
          const sp = Math.hypot(vx, vz);
          if (sp > cap) { vx *= cap / sp; vz *= cap / sp; }
          if (sp > 30) this.rts.inertia = { vx, vz };
        }
      }
    } else if (d.mode === 'box') {
      this.hideBox();
      const x0 = Math.min(d.x0, d.x1 ?? d.x0), x1 = Math.max(d.x0, d.x1 ?? d.x0);
      const y0 = Math.min(d.y0, d.y1 ?? d.y0), y1 = Math.max(d.y0, d.y1 ?? d.y0);
      if (x1 - x0 < 6 && y1 - y0 < 6) return;
      const cam = this.rts.camera;
      const rect = this.canvas.getBoundingClientRect();
      const picked = g.units.filter((u) => {
        if (!u.alive || !this.mine(u)) return false;
        const v = cam.position.clone().set(u.x, g.terrain.heightAt(u.x, u.z), u.z).project(cam);
        if (v.z > 1) return false;
        const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      });
      g.selectMany(picked);
    } else if (d.mode === 'rotate') {
      if (!d.moved && d.button === 2 && d.ground) {
        const leader = g.selected;
        if (leader && this.mine(leader)) {
          const enemy = this.unitAt(d.ground);
          if (enemy && enemy.side !== leader.side) g.orderGroup(leader, { type: 'attack', target: enemy });
          else g.orderGroup(leader, { type: 'move', points: [[leader.x, leader.z], [d.ground.x, d.ground.z]] });
        }
      }
    }
  }

  /** A tap or click on a brigade that did not become a drag: select it alone; twice quickly flies to it. */
  tapUnit(u, e) {
    if (!u) return;
    if (this.game.selection.length > 1 || this.game.selected !== u) this.game.select(u);
    if (e.pointerType !== 'touch') return; // mouse double-click is the dblclick event
    const now = performance.now();
    if (this.lastTap && this.lastTap.unit === u && now - this.lastTap.t < DOUBLE_TAP_MS) {
      this.rts.flyTo(u.x, u.z);
      this.lastTap = null;
    } else this.lastTap = { t: now, unit: u };
  }

  cancel(e) {
    if (e && e.pointerId !== undefined) this.pointers.delete(e.pointerId);
    else this.pointers.clear();
    clearTimeout(this.longPress);
    if (this.drag && this.drag.mode === 'order') { this.arrows.clearPreview(); this.hud.setGhostLabel(null); }
    if (this.drag && this.drag.mode === 'box') this.hideBox();
    this.drag = null;
  }

  showBox(x0, y0, x1, y1) {
    const b = this.box;
    b.hidden = false;
    b.style.left = `${Math.min(x0, x1)}px`;
    b.style.top = `${Math.min(y0, y1)}px`;
    b.style.width = `${Math.abs(x1 - x0)}px`;
    b.style.height = `${Math.abs(y1 - y0)}px`;
  }

  hideBox() { this.box.hidden = true; }

  key(e) {
    if (document.querySelector('main')?.inert || document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const onButton = e.target instanceof HTMLButtonElement;
    if (k === ' ' && !onButton) { e.preventDefault(); this.game.togglePause(); return; }
    if (k === 'escape') { this.cancel(); this.game.select(null); return; }
    if (k === 'g') { this.onQualityKey(); return; }
    if (k === 'm') { this.hud.toggleMinimap(); return; }
    if (k === 'l') { this.hud.toggleArmy(); return; }
    if (k === '1' || k === '2' || k === '3') { this.game.setSpeed({ 1: 1, 2: 2, 3: 4 }[k]); return; }
    const orderKeys = { h: 'hold', c: 'charge', r: 'run', f: 'fallback', x: 'halt', v: 'holdfire' };
    if (orderKeys[k]) { this.game.orderSelected(orderKeys[k]); return; }
    if (!onButton && this.rts.onKey(e, true)) e.preventDefault();
  }
}

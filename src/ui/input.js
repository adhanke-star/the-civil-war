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
//   list, B march targeting, T ranged target, Enter commit, Esc cancel/deselect, ? help, G quality.
//   During march targeting arrows move the destination and Q/E face the ghost; Shift uses finer steps.

import { RULES } from '../sim/rules.js';
import { coverWord, minutesText, compass } from './hud.js';

const DRAG_PX = { mouse: 7, pen: 7, touch: 11 };
const MIN_ORDER_M = 22;
const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 380;
const MOUSE_AFTER_TOUCH_MS = 800;

export class Input {
  constructor({ canvas, rts, game, arrows, hud, playerSide, onQualityKey }) {
    Object.assign(this, { canvas, rts, game, arrows, hud, playerSide, onQualityKey });
    this.drag = null;
    this.targeting = null;
    this.pointers = new Map(); // pointerId -> { x, y, type }
    this.lastTouch = -1e9;
    this.lastTap = null; // { t, unit } for double-tap
    this.longPress = 0;
    this.panSamples = [];
    this.box = document.createElement('div');
    this.box.id = 'boxsel';
    this.box.hidden = true;
    document.body.appendChild(this.box);

    // A transient lens releases at window capture, before a reader or ordinary field picking owns
    // the event. Stop propagation, not immediate propagation: later capture observers see the return.
    const consumed = (e, handled) => { if (handled) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('keydown', (e) => consumed(e, this.soldierView?.keyDown(e)), true);
    window.addEventListener('keyup', (e) => consumed(e, this.soldierView?.keyUp(e)), true);
    for (const type of ['pointerdown', 'dblclick', 'wheel']) {
      window.addEventListener(type, () => this.soldierView?.end(type === 'wheel' ? 'wheel' : 'pointer'), true);
    }
    window.addEventListener('focusin', (e) => {
      if (this.soldierView?.active && !this.soldierView.isFieldFocus(e)) this.soldierView.end('focus');
    }, true);
    window.addEventListener('blur', (e) => { if (e.target === window) this.soldierView?.blur(); }, true);
    window.addEventListener('pagehide', () => this.soldierView?.blur('pagehide'), true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.soldierView?.blur('hidden'); });
    canvas.addEventListener('webglcontextlost', () => this.soldierView?.blur('context'));

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
    window.addEventListener('pointerdown', () => this.cancelTargeting());
    // Safari: no page pinch-zoom or rubber-band scroll over the field (touch-action: none covers the rest)
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    for (const el of [canvas, document.getElementById('markers')]) el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    this.wheelGesture = null;
    const onWheel = (e) => {
      this.cancelTargeting();
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
    game.on('select', () => this.cancelTargeting());
    game.on('remove', () => this.refreshTargeting());
    hud.onOpenMenu = () => { rts.keys.clear(); this.cancel(); };
    hud.onDirectOrder = () => this.cancelTargeting();
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
    this.cancelTargeting();
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
    const p = this.rts.pick(cx, cy, this.canvas);
    if (p) this.orderPreviewAt(d, p, shift);
  }

  /** Shared world-point preview: keyboard march forces ground, keyboard attack supplies its target. */
  orderPreviewAt(d, p, shift = false, target = undefined) {
    const g = this.game;
    const u = d.unit;
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p.x - last[0], p.z - last[1]) > 9) d.points.push([p.x, p.z]);
    const over = this.unitAt(p);
    const enemy = target === undefined ? (over && over.side !== u.side && over.state !== 'routing' ? over : null) : target;
    const arc = this.arcOf(u);
    const width = Math.min(26, Math.max(12, u.halfFront * 0.22));
    d.enemy = enemy;
    if (enemy) {
      const halt = g.attackHalt(u, enemy);
      const len = Math.hypot(halt.x - u.x, halt.z - u.z);
      if (len >= 6) d.preview = this.arrows.setPreview([[u.x, u.z], [halt.x, halt.z]], u.side, width, u.lineHalfFront(), { facing: halt.facing, arc });
      else { this.arrows.clearPreview(); d.preview = null; }
      if (!d.preview) d.preview = [[u.x, u.z], [halt.x, halt.z]];
      const mins = g.marchMinutes(len);
      this.hud.setGhostLabel({ text: `Attack ${enemy.short}: halts at ${Math.round(g.effRange(u))} m and fires${len > 10 ? ` · ${minutesText(mins)}` : ''}`, x: halt.x, z: halt.z });
      d.end = p;
      return;
    }
    const pts = d.points.concat([[p.x, p.z]]);
    let face = g.ghostFacing(p.x, p.z, u.side, u.facing);
    if (shift) face = this.dragDirection(pts) ?? face;
    if (d.faceSet) face = d.face;
    else d.face = face;
    const length = pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    if (length < 6) { d.preview = null; d.end = p; this.arrows.clearPreview(); this.hud.setGhostLabel(null); return; }
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
    } else this.hud.setGhostLabel(null);
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
    this.cancelTargeting();
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

  cancelTargeting(message = null) {
    if (this.targeting) { this.targeting = null; this.arrows.clearPreview(); this.hud.setGhostLabel(null); }
    this.hud.setTargeting(message);
  }

  eligibleTargets(leader) {
    return this.game.units.filter((u) => u.side !== leader.side && u.alive && u.state !== 'routing')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  beginTargeting(mode, reverse = false) {
    const unit = this.game.selected;
    if (!unit || !this.game.units.includes(unit) || !this.mine(unit)) {
      this.cancelTargeting(); this.hud.toast('Select a brigade that can take orders.'); return;
    }
    const old = this.targeting, targets = mode === 'attack' ? this.eligibleTargets(unit) : [];
    if (mode === 'attack' && !targets.length) { this.cancelTargeting(); this.hud.toast('No enemy is available for ranged attack.'); return; }
    this.cancel(); this.rts.keys.clear(); this.rts.inertia = null;
    const direction = reverse ? -1 : 1, i = old?.mode === 'attack' ? targets.indexOf(old.enemy) : -1;
    const enemy = mode === 'attack' ? targets[(i < 0 ? (reverse ? targets.length - 1 : 0) : (i + direction + targets.length) % targets.length)] : null;
    this.targeting = { mode, unit, selection: [...this.game.selection], point: { x: unit.x, z: unit.z },
      points: [[unit.x, unit.z]], enemy, face: unit.facing, faceSet: false };
    // Native Enter/Space controls must keep their meaning; targeting owns keys on the field.
    this.canvas.focus({ preventScroll: true });
    this.refreshTargeting(true);
  }

  refreshTargeting(announce = false) {
    const d = this.targeting;
    if (!d) return false;
    const g = this.game;
    if (document.querySelector('main')?.inert || document.querySelector('dialog[open]') || g.selected !== d.unit
      || !g.units.includes(d.unit) || !this.mine(d.unit) || g.selection.length !== d.selection.length
      || g.selection.some((u, i) => u !== d.selection[i])) { this.cancelTargeting(); return false; }
    if (d.mode === 'attack' && !this.eligibleTargets(d.unit).includes(d.enemy)) {
      this.cancelTargeting(); this.hud.toast('That enemy is no longer available. Choose another target with T.'); return false;
    }
    const p = d.mode === 'attack' ? { x: d.enemy.x, z: d.enemy.z } : d.point;
    const automaticFace = d.mode === 'attack' ? this.game.attackHalt(d.unit, d.enemy).facing : this.game.ghostFacing(p.x, p.z, d.unit.side, d.unit.facing);
    const previewKey = JSON.stringify([d.mode, p.x, p.z, d.faceSet ? d.face : automaticFace, this.game.range(d.unit), this.game.effRange(d.unit),
      this.arrows.mpp, this.game.marchMinutes(1),
      g.orderable().map((u) => [u.id, u.x, u.z, u.facing, u.halfFront, u.lineHalfFront()]), this.arrows.styles()]);
    if (previewKey !== d.previewKey) {
      d.points = [[d.unit.x, d.unit.z]];
      this.orderPreviewAt(d, p, false, d.mode === 'attack' ? d.enemy : null);
      d.previewKey = previewKey;
    }
    if (announce || !d.statusText) {
      const distance = Math.round(Math.hypot(p.x - d.unit.x, p.z - d.unit.z));
      const bearing = distance ? compass(Math.atan2(p.x - d.unit.x, p.z - d.unit.z)) : 'here';
      const face = d.face ?? d.unit.facing, degrees = ((Math.round(180 - face * 180 / Math.PI) % 360) + 360) % 360;
      d.statusText = d.mode === 'attack'
        ? `Attack ${d.enemy.short} · halt at ${Math.round(g.effRange(d.unit))} m · T next / Shift+T previous · Enter orders ranged fire · Esc cancels · ? help`
        : `March ${distance} m ${bearing}, facing ${compass(face)} ${degrees}° · arrows 25 m / Shift 5 m · Q/E facing 15° / Shift 5° · Enter orders · Esc cancels · ? help`;
    }
    this.hud.setTargeting(d.statusText);
    return true;
  }

  targetingKey(e, k) {
    if (!this.refreshTargeting()) return false;
    const d = this.targeting;
    if (k === 'escape') { this.cancelTargeting(); return true; }
    if (k === 'enter') {
      if (e.repeat) return true;
      let length = 0;
      for (let i = 1; i < (d.preview?.length || 0); i++) length += Math.hypot(d.preview[i][0] - d.preview[i - 1][0], d.preview[i][1] - d.preview[i - 1][1]);
      if (d.mode === 'march' && length < MIN_ORDER_M) { this.hud.toast('Move the destination at least 22 metres before ordering.'); return true; }
      const ok = d.mode === 'attack' ? this.game.orderGroup(d.unit, { type: 'attack', target: d.enemy })
        : this.game.orderGroup(d.unit, { type: 'move', points: d.preview, endFacing: d.face });
      this.cancelTargeting(); this.hud.toast(ok ? `${d.mode === 'attack' ? `Ranged attack on ${d.enemy.short}` : 'March'} ordered.` : 'That brigade could not take the order.'); return true;
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e'].includes(k)) {
      if (d.mode === 'attack') { this.hud.toast('Ranged attacks face their target. Use T to choose another enemy, or B to march.'); return true; }
      const step = e.shiftKey ? 5 : 25, angle = (e.shiftKey ? 5 : 15) * Math.PI / 180;
      if (k === 'q' || k === 'e') { d.face = (Number.isFinite(d.face) ? d.face : d.unit.facing) + (k === 'q' ? -angle : angle); d.faceSet = true; }
      else {
        const right = k === 'arrowright' ? step : k === 'arrowleft' ? -step : 0;
        const forward = k === 'arrowup' ? step : k === 'arrowdown' ? -step : 0;
        const s = Math.sin(this.rts.yaw), c = Math.cos(this.rts.yaw), half = this.game.terrain.half;
        d.point.x = Math.max(-half, Math.min(half, d.point.x + right * c - forward * s));
        d.point.z = Math.max(-half, Math.min(half, d.point.z - right * s - forward * c));
      }
      this.refreshTargeting(true); return true;
    }
    return false;
  }

  key(e) {
    if (document.querySelector('main')?.inert || document.querySelector('dialog[open]')) { this.rts.keys.clear(); this.cancelTargeting(); return; }
    if (e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), #sb-panel') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const onButton = !!e.target?.closest?.('button, a[href], [role="button"]');
    if (onButton && (k === 'enter' || k === ' ')) return;
    if (k === '?') { e.preventDefault(); this.hud.openMenu(e.target); return; }
    if (k === 'b' || k === 't') { e.preventDefault(); if (!e.repeat) this.beginTargeting(k === 'b' ? 'march' : 'attack', e.shiftKey); return; }
    if (this.targeting) {
      const consumed = this.targetingKey(e, k);
      if (consumed || (!this.targeting && ['escape', 'enter', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e'].includes(k))) { e.preventDefault(); return; }
    }
    if (k === ' ' && !onButton) { e.preventDefault(); this.game.togglePause(); return; }
    if (k === 'escape') { this.cancel(); this.game.select(null); return; }
    if (k === 'g') { this.onQualityKey(); return; }
    if (k === 'm') { this.hud.toggleMinimap(); return; }
    if (k === 'l') { this.hud.toggleArmy(); return; }
    if (k === '1' || k === '2' || k === '3') { this.game.setSpeed({ 1: 1, 2: 2, 3: 4 }[k]); return; }
    const orderKeys = { h: 'hold', c: 'charge', r: 'run', f: 'fallback', x: 'halt', v: 'holdfire' };
    if (orderKeys[k]) { this.cancelTargeting(); this.game.orderSelected(orderKeys[k]); return; }
    if (!onButton && this.rts.onKey(e, true)) e.preventDefault();
  }
}

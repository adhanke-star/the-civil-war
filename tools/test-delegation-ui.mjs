// Browser check: delegation through the real UI (src/ui/hud.js card row and chooser, src/ui/input.js picking,
// src/ui/arrows.js shade and marks, Game.delegate / reclaim / undelegate). Runs in tools/test.mjs shard 3 and alone
// with `node tools/test.mjs --delegation`. Mouse: select a flag, Delegate, click the field, Attack. Keyboard: G,
// arrows, Enter, Enter on Attack. Then the pencil line and role mark, the card's role and Undo, a direct drag that
// takes the brigade back, Escape in both stages, axe on the card and chooser, and the 320 px layout.
import { AxeBuilder } from '@axe-core/playwright';

const frames = (page, n = 2) => page.evaluate((n) => new Promise((resolve) => {
  const step = (k) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
}), n);

// Passive, bounded observation of one native field click. Registered after Input's own listeners;
// bubble observations therefore run after down/up, without relying on microtask ordering.
// Dependencies can be injected for CPU controls; page.evaluate uses the browser defaults.
export function installDelegationPointerObserver({ host = window, doc = document } = {}) {
  const key = '__delegationPointerObservation0257';
  if (Object.hasOwn(host, key)) throw new Error('delegation pointer observer already installed');
  const canvas = doc.getElementById('battlefield');
  if (!canvas || !host.__game) throw new Error('delegation pointer observer missing field');
  const rows = [], errors = [], listeners = [];
  let overflow = false, closed = false;
  const failure = (kind, e) => {
    let message = 'non-primitive observer failure';
    if (typeof e === 'string') message = e;
    else if (e === null || ['undefined', 'boolean', 'number', 'bigint'].includes(typeof e)) message = String(e);
    else { try { const d = Object.getOwnPropertyDescriptor(e, 'message'); if (d && Object.hasOwn(d, 'value') && typeof d.value === 'string') message = d.value; } catch {} }
    if (errors.length < 8) errors.push({ kind, message: message.slice(0, 500) }); else overflow = true;
  };
  const cleanup = () => {
    closed = true;
    for (const [target, type, fn, capture] of listeners) {
      try { target.removeEventListener(type, fn, capture); } catch (e) { failure('listener-cleanup', e); }
    }
    try {
      const d = Object.getOwnPropertyDescriptor(host, key);
      if (d?.value === observer) delete host[key];
      else failure('property-cleanup', 'delegation pointer observer replaced');
    } catch (e) { failure('property-cleanup', e); }
  };
  const point = (p) => p ? { x: p.x, z: p.z } : null;
  const state = () => {
    const { camera, rts, input, game } = host.__game, rect = canvas.getBoundingClientRect();
    return {
      camera: { position: camera.position.toArray(), world: [...camera.matrixWorld.elements], projection: [...camera.projectionMatrix.elements] },
      rts: { target: rts.target.toArray(), goal: { ...rts.goal }, groundY: rts.groundY, yaw: rts.yaw, pitch: rts.pitch, dist: rts.dist },
      canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewport: { width: host.innerWidth, height: host.innerHeight, dpr: host.devicePixelRatio },
      drag: input.drag ? { ground: point(input.drag.ground), id: input.drag.id, type: input.drag.type, moved: input.drag.moved, delegatePick: input.drag.delegatePick } : null,
      targeting: input.targeting?.mode ?? null, chooser: !doc.getElementById('delegate-chooser').hidden,
      delegate: game.units.find(u => u.id === 'franklin')?.delegate ? { ...game.units.find(u => u.id === 'franklin').delegate } : null,
    };
  };
  const append = (kind, event, screen) => {
    if (closed) return;
    if (rows.length >= 8) { overflow = true; return; }
    try {
      const p = screen ?? { x: event.clientX, y: event.clientY };
      rows.push({ kind, screen: { ...p }, event: event ? { type: event.type, pointerId: event.pointerId, pointerType: event.pointerType,
        button: event.button, buttons: event.buttons, trusted: event.isTrusted, timeStamp: event.timeStamp } : null,
      pick: point(host.__game.rts.pick(p.x, p.y, canvas)), ...state() });
    } catch (e) { failure(kind, e); }
  };
  const add = (target, type, fn, capture) => { listeners.push([target, type, fn, capture]); target.addEventListener(type, fn, capture); };
  const downCapture = e => append('down-capture', e);
  const downBubble = e => append('down-after-input', e);
  const upBubble = e => { if (e.target === canvas) append('up-after-input', e); };
  const observer = {
    mark: (kind, screen) => append(kind, null, screen),
    read: () => structuredClone({ rows, errors, overflow, closed }),
    close: () => {
      if (!closed) cleanup();
      return structuredClone({ rows, errors, overflow, closed });
    },
  };
  try {
    Object.defineProperty(host, key, { value: observer, configurable: true });
    add(canvas, 'pointerdown', downCapture, true);
    add(canvas, 'pointerdown', downBubble, false);
    add(host, 'pointerup', upBubble, false);
  } catch (e) {
    cleanup();
    throw e;
  }
  return { installed: true };
}

export async function delegationControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(180000);
  watchErrors(page, url, errors);
  const evidence = result.delegation = {};
  let pointerObserver = false;
  const record = (name, ok, data) => { evidence[name] = data; check('delegation-ui-' + name, ok, JSON.stringify(data).slice(0, 1200)); };
  const read = () => page.evaluate(() => {
    const { game, input, arrows, hud } = window.__game, f = game.units.find((u) => u.id === 'franklin');
    const chooser = document.getElementById('delegate-chooser');
    return { orders: game.orders || 0, paused: game.paused, selected: game.selected?.id ?? null, focus: document.activeElement?.id || document.activeElement?.dataset?.role || document.activeElement?.tagName,
      targeting: input.targeting ? { mode: input.targeting.mode, point: { ...input.targeting.point } } : null,
      status: document.getElementById('keyboard-targeting').hidden ? '' : document.getElementById('keyboard-targeting').textContent,
      chooser: !chooser.hidden, chooserTitle: document.getElementById('dc-title').textContent, preview: !!arrows.preview,
      delegate: f.delegate ? { ...f.delegate } : null, order: { type: f.order.type, firm: !!f.order.firm, dest: f.order.dest ?? null },
      franklin: { x: f.x, z: f.z }, card: document.getElementById('delegate-text').textContent,
      undo: !document.getElementById('delegate-undo').hidden, button: !document.getElementById('delegate-btn').disabled,
      line: arrows.unitArrows.get('franklin')?.userData.shade ?? null, marks: [...arrows.marks.keys()], open: !!hud.delegateState };
  });
  const flag = (name) => page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) });
  const select = async (name) => { await flag(name).focus(); await page.keyboard.press('Enter'); await frames(page); };
  // A screen point over the bare field near world (x, z): the canvas must own it (not a flag or a panel).
  const fieldPoint = (x, z) => page.evaluate(([x, z]) => {
    const { camera, terrain } = window.__game, canvas = document.getElementById('battlefield');
    for (let r = 0; r <= 120; r += 12) for (let a = 0; a < (r ? 8 : 1); a++) {
      const v = camera.position.clone().set(x + r * Math.cos(a * Math.PI / 4), terrain.heightAt(x, z), z + r * Math.sin(a * Math.PI / 4)).project(camera);
      const px = (v.x * 0.5 + 0.5) * innerWidth, py = (-v.y * 0.5 + 0.5) * innerHeight;
      if (px > 4 && py > 4 && px < innerWidth - 4 && py < innerHeight - 4 && document.elementFromPoint(px, py) === canvas) return { x: px, y: py };
    }
    return null;
  }, [x, z]);
  const pickAt = (p) => page.evaluate(([x, y]) => { const { rts } = window.__game; const g = rts.pick(x, y, document.getElementById('battlefield'));
    window.__delegationPointerObservation0257.mark('pre-click', { x, y });
    return g ? { x: g.x, z: g.z } : null; }, [p.x, p.y]);
  const near = (a, b, eps = 2) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) < eps;
  const axe = async (label, ...scopes) => {
    let builder = new AxeBuilder({ page });
    for (const s of scopes) builder = builder.include(s);
    const v = (await builder.analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
    record(`axe-${label}`, v.length === 0, v.map((x) => `${x.id}: ${x.nodes.length}`));
  };

  try {
    await page.goto(`${url}?sandbox&quality=low`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    if (await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#sb-toggle').click();
    if (!(await page.evaluate(() => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() => { const { game, rts } = window.__game, f = game.units.find((u) => u.id === 'franklin'); rts.flyTo(f.x + 120, f.z, 520); rts.snap(); });
    await frames(page, 3);

    // ---- mouse: select, Delegate, click the field, Attack ------------------------------------------------
    await select('Franklin');
    const start = await read();
    record('button-enabled', start.selected === 'franklin' && start.button && !start.undo && start.card === '', start);
    await page.locator('#delegate-btn').scrollIntoViewIfNeeded();
    await page.locator('#delegate-btn').click();
    const picking = await read();
    record('mouse-begin', picking.targeting?.mode === 'delegate' && /Delegate/.test(picking.status) && picking.orders === start.orders && !picking.delegate, picking);
    const spot = await fieldPoint(start.franklin.x + 160, start.franklin.z);
    if (!spot) throw new Error('no bare field point near Franklin to click');
    await page.evaluate(installDelegationPointerObserver);
    pointerObserver = true;
    const ground = await pickAt(spot);
    await page.mouse.click(spot.x, spot.y);
    await frames(page);
    const chosen = await read();
    record('mouse-chooser', chosen.chooser && chosen.open && chosen.focus === 'attack' && chosen.preview && !chosen.targeting && !chosen.delegate
      && /Franklin/.test(chosen.chooserTitle), chosen);
    await axe('chooser', '#delegate-chooser', '#unitcard');
    await shot(page, 'delegation-chooser');
    await page.getByRole('button', { name: 'Attack', exact: true }).click();
    await frames(page);
    const attack = await read();
    await page.evaluate(p => window.__delegationPointerObservation0257.mark('post-attack', p), spot);
    evidence.pointerObservation = await page.evaluate(() => window.__delegationPointerObservation0257.close());
    pointerObserver = false;
    const observation = evidence.pointerObservation;
    record('pointer-observer', observation.closed && !observation.overflow && observation.errors.length === 0
      && observation.rows.map(r => r.kind).join(',') === 'pre-click,down-capture,down-after-input,up-after-input,post-attack'
      && observation.rows.slice(1, 4).every(r => r.event.trusted && r.event.pointerType === 'mouse'),
    { kinds: observation.rows.map(r => r.kind), errors: observation.errors, overflow: observation.overflow, closed: observation.closed });
    record('mouse-attack', attack.delegate?.role === 'attack' && near(attack.delegate, ground, 3) && !attack.chooser && !attack.preview
      && attack.focus === 'battlefield' && attack.orders === start.orders + 1, { delegate: attack.delegate, ground, focus: attack.focus });
    record('card-role', attack.card === 'Delegated: Attack' && attack.undo, { card: attack.card, undo: attack.undo });
    await page.evaluate(() => window.__game.game.fastForward(3));
    await frames(page, 3);
    const marching = await read();
    record('pencil-line', marching.line === 'DL' && marching.marks.some((k) => k.startsWith('attack:')) && marching.order.type === 'move',
      { line: marching.line, marks: marching.marks, order: marching.order });
    await shot(page, 'delegation-pencil');
    await axe('card', '#unitcard');

    // ---- Undo ------------------------------------------------------------------------------------------
    await page.locator('#delegate-undo').scrollIntoViewIfNeeded();
    await page.locator('#delegate-undo').click();
    await frames(page, 3);
    const undone = await read();
    record('undo', !undone.delegate && undone.order.type === 'hold' && !undone.undo && undone.card === '' && undone.focus === 'battlefield'
      && !undone.marks.length, undone);

    // ---- keyboard: G, arrows, Enter, Enter on Attack ----------------------------------------------------
    await select('Franklin');
    await page.locator('#battlefield').focus();
    const kStart = await read();
    await page.keyboard.press('g');
    const kBegin = await read();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    const kMoved = await read();
    record('keyboard-begin', kBegin.targeting?.mode === 'delegate' && kBegin.focus === 'battlefield' && kMoved.targeting
      && Math.abs(Math.hypot(kMoved.targeting.point.x - kBegin.targeting.point.x, kMoved.targeting.point.z - kBegin.targeting.point.z) - 50) < 1e-6
      && kMoved.status !== kBegin.status, { begin: kBegin.targeting, moved: kMoved.targeting, status: kMoved.status });
    await page.keyboard.press('Enter');
    const kChooser = await read();
    await page.keyboard.press('Enter'); // the focused Attack button
    await frames(page);
    const kAttack = await read();
    record('keyboard-attack', kChooser.chooser && kChooser.focus === 'attack' && kAttack.delegate?.role === 'attack'
      && near(kAttack.delegate, kMoved.targeting.point, 1e-3) && kAttack.focus === 'battlefield' && kAttack.orders === kStart.orders + 1,
    { chooser: kChooser.focus, delegate: kAttack.delegate, point: kMoved.targeting.point, focus: kAttack.focus });

    // ---- a direct drag order takes it back ---------------------------------------------------------------
    await page.evaluate(() => window.__game.game.fastForward(2));
    await frames(page, 3);
    const box = await flag('Franklin').boundingBox();
    const f0 = await read();
    const to = await fieldPoint(f0.franklin.x - 40, f0.franklin.z - 120);
    if (!box || !to) throw new Error('no flag or field point for the drag order');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(box.x + box.width / 2 + (to.x - box.x - box.width / 2) * k / 8, box.y + box.height / 2 + (to.y - box.y - box.height / 2) * k / 8);
    await page.mouse.up();
    await frames(page, 3);
    // Native HUD refreshes the selected card on its 0.25 s clock; three RAFs can precede it.
    // Observe that refresh without forcing the HUD or changing the order/clock under test.
    await page.waitForFunction(() => document.getElementById('delegate-undo').hidden
      && document.getElementById('delegate-text').textContent === '', null, { timeout: 15000, polling: 100 });
    const dragged = await read();
    record('drag-reclaims', !dragged.delegate && dragged.order.type === 'move' && dragged.orders === f0.orders + 1 && !dragged.undo
      && dragged.card === '' && dragged.line !== 'DL', { delegate: dragged.delegate, order: dragged.order, line: dragged.line,
      orders: [f0.orders, dragged.orders], undo: dragged.undo, card: dragged.card });

    // ---- Escape cancels: while picking, and in the chooser ------------------------------------------------
    await page.locator('#battlefield').focus();
    const e0 = await read();
    await page.keyboard.press('g'); await page.keyboard.press('Escape');
    const e1 = await read();
    await page.keyboard.press('g'); await page.keyboard.press('Enter');
    const e2open = await read();
    await page.keyboard.press('Escape');
    await frames(page);
    const e2 = await read();
    record('escape-cancels', !e1.targeting && !e1.delegate && e2open.chooser && !e2.chooser && !e2.delegate && !e2.preview
      && e2.focus === 'battlefield' && e2.orders === e0.orders && e2.selected === 'franklin', { e1: e1.targeting, e2open: e2open.chooser, e2 });

    // ---- 320 px --------------------------------------------------------------------------------------------
    await page.setViewportSize({ width: 320, height: 568 });
    await frames(page, 4);
    await page.locator('#delegate-btn').scrollIntoViewIfNeeded();
    await page.locator('#delegate-btn').click();
    await page.keyboard.press('Enter');
    await frames(page, 2);
    const narrow = await page.evaluate(() => {
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; };
      const inside = (r) => r.x >= -0.5 && r.y >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
      const chooser = rect(document.getElementById('delegate-chooser'));
      const buttons = [...document.querySelectorAll('#delegate-chooser button')].map((b) => ({ role: b.dataset.role, ...rect(b),
        hit: document.elementFromPoint(b.getBoundingClientRect().x + b.getBoundingClientRect().width / 2, b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2)?.closest('button') === b }));
      const del = rect(document.getElementById('delegate-btn'));
      return { chooser, inside: inside(chooser), buttons, ok: buttons.every((b) => b.w >= 44 && b.h >= 44 && inside(b) && b.hit), del, delOk: del.w >= 44 && del.h >= 44,
        scroll: document.documentElement.scrollWidth <= innerWidth };
    });
    record('narrow-320', narrow.inside && narrow.ok && narrow.delOk && narrow.scroll, narrow);
    await axe('chooser-320', '#delegate-chooser');
    await shot(page, 'delegation-320');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    record('errors', errors.length === 0, errors.slice(0, 6));
  } finally {
    if (pointerObserver) {
      try { evidence.pointerObservation = await page.evaluate(() => window.__delegationPointerObservation0257.close()); }
      catch (e) { evidence.pointerObserverCleanupError = String(e?.message ?? e); check('delegation-ui-pointer-observer-cleanup', false, evidence.pointerObserverCleanupError); }
    }
    await ctx.close().catch(() => {});
  }
}

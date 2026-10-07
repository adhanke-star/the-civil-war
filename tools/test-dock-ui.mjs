import { AxeBuilder } from '@axe-core/playwright';

// Shared with the pre-edit diagnostic: child containment, not the outer dock alone.
export async function dockGeometry(page) {
  return page.evaluate(() => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const dock = rect(document.getElementById('dock'));
    const inside = (r, p) => r.x >= p.x - 0.5 && r.right <= p.right + 0.5 && r.y >= p.y - 0.5 && r.bottom <= p.bottom + 0.5;
    const overlaps = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;
    const hitPoints = (r) => [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 5, r.y + 5], [r.right - 5, r.y + 5], [r.x + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]];
    const ownsPoint = (e, x, y) => { const hit = document.elementFromPoint(x, y); return hit === e || e.contains(hit); };
    const children = ['unitcard', 'orders', 'minimap-box'].map((id) => ({ id, ...rect(document.getElementById(id)) }));
    const buttons = [...document.querySelectorAll('#orders button')].map((e) => {
      const r = rect(e), range = document.createRange(); range.selectNodeContents(e.firstChild);
      const labels = [...range.getClientRects()].map((r) => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom }));
      const key = rect(e.querySelector('.key'));
      return { order: e.dataset.order, ...r, labels, key, hit: hitPoints(r).every(([x, y]) => ownsPoint(e, x, y)),
        font: parseFloat(getComputedStyle(e).fontSize), keyFont: parseFloat(getComputedStyle(e.querySelector('.key')).fontSize),
        fullText: labels.length > 0 && labels.every((label) => inside(label, r) && !overlaps(label, key)) && inside(key, r) };
    });
    const failures = [];
    if (buttons.map((b) => b.order).join() !== 'hold,charge,run,fallback,halt,holdfire') failures.push('six-orders');
    if (!inside(dock, { x: 0, y: 0, right: innerWidth, bottom: innerHeight })) failures.push('dock-viewport');
    for (const c of children) if (!inside(c, dock)) failures.push(`${c.id}-containment`);
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) if (overlaps(children[i], children[j])) failures.push(`${children[i].id}-${children[j].id}-overlap`);
    for (const b of buttons) {
      if (!inside(b, children[1]) || !inside(b, dock)) failures.push(`${b.order}-containment`);
      if (b.width < 48 || b.height < 48) failures.push(`${b.order}-48px`);
      if (!b.hit) failures.push(`${b.order}-hit`);
      if (!b.fullText) failures.push(`${b.order}-text`);
    }
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) if (overlaps(buttons[i], buttons[j])) failures.push('button-overlap');
    const map = rect(document.getElementById('minimap'));
    if (map.width < 80 || map.height < 80) failures.push('map-80px');
    if (!inside(map, children[2])) failures.push('map-containment');
    if (!hitPoints(map).every(([x, y]) => ownsPoint(document.getElementById('minimap'), x, y))) failures.push('map-hit');
    const card = document.getElementById('unitcard');
    for (const e of card.querySelectorAll('.lbl, .val')) {
      const range = document.createRange(); range.selectNodeContents(e);
      const tile = rect(e.closest('.tile'));
      if ([...range.getClientRects()].some((r) => !inside(r, rect(e)) || r.x < tile.x || r.right > tile.right)) failures.push('card-stat-text-clipping');
    }
    if (!hitPoints(children[0]).every(([x, y]) => ownsPoint(card, x, y))) failures.push('card-hit');
    const identity = document.getElementById('uc-name'), identityRange = document.createRange(); identityRange.selectNodeContents(identity);
    for (const r of identityRange.getClientRects()) {
      const clipped = { x: Math.max(r.x, children[0].x + 1), right: Math.min(r.right, children[0].right - 1), y: Math.max(r.y, children[0].y + 1), bottom: Math.min(r.bottom, children[0].bottom - 1) };
      if (clipped.right > clipped.x && clipped.bottom > clipped.y && ![clipped.x + 0.5, (clipped.x + clipped.right) / 2, clipped.right - 0.5].every((x) => ownsPoint(identity, x, (clipped.y + clipped.bottom) / 2))) failures.push('card-identity-hit');
    }
    const toggle = document.getElementById('sb-toggle');
    const closedToggle = toggle?.classList.contains('sb-closed') ? rect(toggle) : null;
    if (closedToggle && overlaps(closedToggle, dock)) failures.push('closed-toggle-dock-overlap');
    if (closedToggle && (closedToggle.width < 48 || closedToggle.height < 48)) failures.push('closed-toggle-48px');
    const header = rect(document.getElementById('topbar'));
    if (closedToggle) for (const id of ['tip', 'intro-hint', 'keyboard-targeting']) {
      const e = document.getElementById(id);
      if (!e.hidden && e.getClientRects().length && getComputedStyle(e).display !== 'none') {
        const h = rect(e);
        if (overlaps(h, closedToggle)) failures.push(`${id}-closed-toggle-overlap`);
        if (h.x < 0 || h.right > innerWidth || h.y < header.bottom || h.bottom > dock.y) failures.push(`${id}-field-containment`);
      }
    }
    const panel = document.getElementById('sb-panel');
    if (panel && innerWidth >= 900 && matchMedia('(pointer: fine)').matches && panel.getClientRects().length && overlaps(dock, rect(panel))) failures.push('sandbox-dock-overlap');
    if (card.scrollWidth > card.clientWidth + 1) failures.push('card-horizontal-overflow');
    return { dock, children, buttons, map, closedToggle, header, failures,
      card: { width: card.clientWidth, height: card.clientHeight, scrollHeight: card.scrollHeight, scrollTop: card.scrollTop },
      mode: document.getElementById('dock').dataset.layout || 'original' };
  });
}

export async function settleDock(page) {
  // Require observable agreement across frames, including the published overlay height.
  await page.evaluate(() => { delete window.__dockSettledKey; });
  await page.waitForFunction(() => {
    const e = document.getElementById('dock'), r = e.getBoundingClientRect();
    const css = getComputedStyle(document.documentElement), h = parseFloat(css.getPropertyValue('--dock-h'));
    const wide = parseFloat(css.getPropertyValue('--dock-card-w')) + 3 * parseFloat(css.getPropertyValue('--dock-order-w'))
      + parseFloat(css.getPropertyValue('--mm')) + 36 + 16;
    const expected = r.width >= wide ? 'wide' : r.width >= 520 ? 'compact' : 'stacked';
    const key = [r.x, r.y, r.width, r.height, e.dataset.layout, h, ...[...e.querySelectorAll(':scope > *, button')].flatMap((c) => { const b = c.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })].join(':');
    const same = window.__dockSettledKey === key; window.__dockSettledKey = key;
    return same && e.dataset.layout === expected && Math.abs(h - r.height) < 0.5;
  }, null, { polling: 'raf', timeout: 15000 });
}

async function nativeCardScroll(page, key, direction) {
  const start = await page.locator('#unitcard').evaluate((e) => {
    e.dataset.scrollEnded = 'false'; e.addEventListener('scrollend', () => { e.dataset.scrollEnded = 'true'; }, { once: true });
    return e.scrollTop;
  });
  await page.keyboard.press(key);
  await page.waitForFunction(({ start, direction }) => {
    const e = document.getElementById('unitcard');
    const reached = direction === 'home' ? e.scrollTop === 0 : direction === 'end' ? e.scrollTop + e.clientHeight >= e.scrollHeight - 1
      : direction === 'up' ? e.scrollTop < start : e.scrollTop > start;
    return reached && e.dataset.scrollEnded === 'true';
  }, { start, direction }, { timeout: 15000 });
}

export async function dockControls({ page, check, shot, result, errors }) {
  const warnings = [], warn = (msg) => { if (msg.type() === 'warning') warnings.push(msg.text()); };
  page.on('console', warn);
  await page.reload();
  await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  if (!await page.evaluate(() => window.__game.game.paused)) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const viewport = page.viewportSize();
  const original = await page.evaluate(() => ({ prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks'), hidden: localStorage.getItem('cw.sandbox.hidden'), panelOpen: document.getElementById('sb-toggle').getAttribute('aria-expanded') === 'true' }));
  const panel = async (open) => { if ((await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') !== open) await page.locator('#sb-toggle').click(); };
  const side = await page.evaluate(async () => (await import('./src/settings.js')).get('look.panelSide'));
  const setSide = (value) => page.evaluate(async (v) => (await import('./src/settings.js')).set('look.panelSide', v), value);
  const select = async (name, add = false) => { const f = page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }); await f.focus(); await page.keyboard.press(add ? 'Shift+Enter' : 'Enter'); };
  const read = () => page.evaluate(async () => {
    const { game: g, input, rts, arrows } = window.__game;
    return { progress: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites,
      prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks'), time: g.simTime, paused: g.paused, orders: g.orders || 0,
      roster: JSON.stringify(g.units.map((u) => [u.id, u.x, u.z, u.men, u.morale, u.fatigue, u.ammo, u.gear, u.order.type, u.order.firm, u.order.target?.id, u.order.dest, u.run, u.holdFire])),
      camera: JSON.stringify([rts.goal, rts.yaw, rts.pitch, rts.dist, rts.target.toArray()]), keys: [...rts.keys],
      target: !!input.targeting, ghost: arrows.previewEnd ? JSON.stringify(arrows.previewEnd) : null };
  });
  const passiveSame = (a, b) => ['progress', 'writes', 'time', 'paused', 'orders', 'roster', 'target', 'ghost'].every((k) => a[k] === b[k]);
  await panel(false);
  await page.evaluate(() => { const r = window.__game.rts; r.keys.clear(); r.inertia = null; r.snap(); });
  const before = await read(), layouts = [], axes = [];
  const layout = async (width, height, name) => {
    await page.setViewportSize({ width, height }); await settleDock(page);
    const empty = await dockGeometry(page);
    await select('Franklin'); const ordinary = await dockGeometry(page);
    await select('Willcox', true); const group = await dockGeometry(page);
    const typography = await page.locator('#dock .lbl, #dock .val, #dock .ucname, #dock .ucstate, #orders button, #orders .key').evaluateAll((els) => els.every((e) => parseFloat(getComputedStyle(e).fontSize) >= 12));
    const fieldGap = width !== 568 || height !== 320 || group.header.bottom + 64 <= group.dock.y;
    const now = await read();
    check(name, [empty, ordinary, group].every((g) => g.failures.length === 0) && typography && fieldGap && passiveSame(before, now), JSON.stringify({ empty: empty.failures, selected: ordinary.failures, group: group.failures, typography, fieldGap, mode: group.mode, dock: group.dock }));
    layouts.push({ width, height, empty, ordinary, group });
    await shot(page, `dock-${width}`);
    const axe = await new AxeBuilder({ page }).include('#dock').analyze(); axes.push(...axe.violations.map((v) => ({ ...v, viewport: `${width}x${height}` })));
    await page.evaluate(() => window.__game.game.select(null));
  };
  try {
    for (const [w, h, name] of [[320, 568, '320'], [375, 667, '375'], [568, 320, 'landscape'], [760, 568, '760'], [1024, 768, '1024'], [1440, 788, '1440']]) await layout(w, h, `dock-layout-${name}`);
    for (const value of ['left', 'right']) {
      await setSide(value); await panel(false);
      const samples = [], closedSamples = [];
      for (const [width, height] of [[320, 568], [375, 667], [568, 320]]) {
        await page.setViewportSize({ width, height }); await settleDock(page); await select('Franklin');
        closedSamples.push(await dockGeometry(page)); await shot(page, `dock-closed-${value}-${width}`);
        await page.evaluate(() => window.__game.game.select(null));
      }
      await panel(true);
      for (const width of [1024, 1440]) { await page.setViewportSize({ width, height: 788 }); await settleDock(page); samples.push(await dockGeometry(page)); }
      check(`dock-sandbox-${value}`, [...samples, ...closedSamples].every((g) => g.failures.length === 0), JSON.stringify({ open: samples.map((g) => ({ mode: g.mode, dock: g.dock, failures: g.failures })), closed: closedSamples.map((g) => ({ dock: g.dock, toggle: g.closedToggle, failures: g.failures })) }));
      await shot(page, `dock-sandbox-${value}`); await panel(false);
    }
    await setSide('left');
    await page.setViewportSize({ width: 320, height: 568 }); await settleDock(page); await select('Franklin');
    // Labelled visual fixture, never a fabricated unit/history or gameplay proof.
    await page.evaluate(() => {
      const name = document.getElementById('uc-name'); window.__dockName = name.textContent;
      name.textContent = 'VISUAL FIXTURE — a deliberately long selected-brigade identity for native reading';
      const p = document.createElement('p'); p.id = 'dock-long-fixture'; p.className = 'ucstate';
      p.textContent = 'VISUAL FIXTURE: '.repeat(30) + 'Final complete intention remains reachable.';
      document.getElementById('uc-body').append(p); document.getElementById('unitcard').scrollTop = 0;
    });
    const readingFirst = await dockGeometry(page); await shot(page, 'dock-long-card-first');
    const scrollStart = await read(); await page.locator('#unitcard').focus();
    await nativeCardScroll(page, 'PageDown', 'down');
    const down = await page.locator('#unitcard').evaluate((e) => e.scrollTop);
    await nativeCardScroll(page, 'Home', 'home');
    await nativeCardScroll(page, 'ArrowDown', 'down');
    await nativeCardScroll(page, 'End', 'end');
    await nativeCardScroll(page, 'ArrowUp', 'up');
    await nativeCardScroll(page, 'PageUp', 'up');
    await nativeCardScroll(page, 'Home', 'home');
    await nativeCardScroll(page, 'Space', 'down');
    await nativeCardScroll(page, 'Shift+Space', 'up');
    await nativeCardScroll(page, 'End', 'end');
    const reading = await page.locator('#unitcard').evaluate((e) => {
      const n = document.getElementById('uc-name'), s = document.getElementById('uc-state'), css = getComputedStyle(n), state = getComputedStyle(s);
      const range = document.createRange(), text = document.getElementById('dock-long-fixture').firstChild;
      range.setStart(text, text.length - 42); range.setEnd(text, text.length);
      const r = range.getBoundingClientRect(), c = e.getBoundingClientRect();
      return { finalVisible: r.bottom <= c.bottom && r.top >= c.top, noClamps: css.textOverflow !== 'ellipsis' && state.webkitLineClamp === 'none',
        focus: document.activeElement === e, outline: getComputedStyle(e).outlineStyle, identityFirst: document.getElementById('uc-body').firstElementChild.classList.contains('ucname') };
    });
    await shot(page, 'dock-long-card-end'); const scrollEnd = await read();
    check('dock-long-card-scroll', readingFirst.failures.length === 0 && down > 0 && reading.finalVisible && reading.noClamps && reading.identityFirst && reading.focus && reading.outline !== 'none'
      && passiveSame(scrollStart, scrollEnd) && scrollStart.camera === scrollEnd.camera && scrollEnd.keys.length === 0, JSON.stringify({ down, reading, firstFailures: readingFirst.failures, cameraSame: scrollStart.camera === scrollEnd.camera }));
    await page.evaluate(() => { document.getElementById('dock-long-fixture').remove(); document.getElementById('uc-name').textContent = window.__dockName; delete window.__dockName; document.getElementById('unitcard').scrollTop = 0; });

    const activate = async (touch) => {
      const samples = [], cdp = touch ? await page.context().newCDPSession(page) : null;
      await page.evaluate(() => { window.__dockEvents = []; window.__dockCapture = (e) => { const b = e.target.closest('#orders button'); if (b) window.__dockEvents.push({ order: b.dataset.order, trusted: e.isTrusted, type: e.type, pointer: e.pointerType || '' }); }; document.addEventListener('click', window.__dockCapture, true); document.addEventListener('pointerdown', window.__dockCapture, true); });
      try {
        for (const [i, order] of ['hold', 'charge', 'run', 'fallback', 'halt', 'holdfire'].entries()) {
          await select('Franklin');
          if (order === 'charge') { await page.locator('#battlefield').focus(); await page.keyboard.press('t'); await page.keyboard.press('Enter'); }
          const a = await page.evaluate(() => { const g = window.__game.game, u = g.selected; window.__dockEvents.length = 0; return { orders: g.orders || 0, run: u.run, holdFire: u.holdFire }; });
          const button = page.locator(`#orders button[data-order="${order}"]`);
          if (touch) {
            const r = await button.boundingBox(), points = [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }];
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else { await button.focus(); await page.keyboard.press(i % 2 ? 'Space' : 'Enter'); }
          await page.waitForFunction(({ orders, order }) => window.__game.game.orders === orders + 1
            && window.__dockEvents.filter((e) => e.type === 'click' && e.order === order).length === 1,
          { orders: a.orders, order }, { timeout: 15000 });
          const b = await page.evaluate(() => { const g = window.__game.game, u = g.selected; return { orders: g.orders || 0, type: u.order.type, firm: !!u.order.firm, target: !!u.order.target, dest: u.order.dest, run: u.run, holdFire: u.holdFire, events: [...window.__dockEvents] }; });
          const effect = order === 'hold' ? b.type === 'hold' && b.firm : order === 'charge' ? b.type === 'charge' && b.target : order === 'run' ? b.run !== a.run : order === 'fallback' ? b.type === 'fallback' && !!b.dest : order === 'halt' ? b.type === 'hold' && !b.firm : b.holdFire !== a.holdFire;
          const clicks = b.events.filter((e) => e.type === 'click');
          samples.push({ order, ok: effect && b.orders === a.orders + 1 && clicks.length === 1 && clicks[0].trusted && clicks[0].order === order && (!touch || b.events.some((e) => e.type === 'pointerdown' && e.pointer === 'touch' && e.trusted && e.order === order)), a, b });
          if (order === 'run' || order === 'holdfire') { const axe = await new AxeBuilder({ page }).include('#dock').analyze(); axes.push(...axe.violations.map((v) => ({ ...v, pressed: order, input: touch ? 'touch' : 'keyboard' }))); }
        }
      } finally { await cdp?.detach(); await page.evaluate(() => { document.removeEventListener('click', window.__dockCapture, true); document.removeEventListener('pointerdown', window.__dockCapture, true); delete window.__dockCapture; delete window.__dockEvents; }); }
      return samples;
    };
    const keyboard = await activate(false); check('dock-keyboard-six-orders', keyboard.every((s) => s.ok), JSON.stringify(keyboard));
    const touch = await activate(true); check('dock-touch-six-orders', touch.every((s) => s.ok), JSON.stringify(touch));
    const mapBefore = await read(), map = await page.locator('#minimap').boundingBox();
    await page.mouse.move(map.x + map.width * 0.3, map.y + map.height * 0.3); await page.mouse.down();
    await page.mouse.move(map.x + map.width * 0.7, map.y + map.height * 0.7, { steps: 3 }); await page.mouse.up();
    const mapAfter = await read();
    const mapState = await page.evaluate(() => { const { rts, terrain } = window.__game; return { x: rts.goal.x, z: rts.goal.z, expected: terrain.half * 0.4, backing: document.getElementById('minimap').width }; });
    check('dock-map-pointer', passiveSame(mapBefore, mapAfter) && mapState.backing === 400 && Math.abs(mapState.x - mapState.expected) < 0.01 && Math.abs(mapState.z - mapState.expected) < 0.01, JSON.stringify(mapState));
    const normal = await dockGeometry(page); await page.locator('#battlefield').focus(); await page.keyboard.press('m');
    const expanded = await page.locator('#minimap-box').evaluate((e) => { const r = e.getBoundingClientRect(); return { large: e.classList.contains('large'), contained: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
    await shot(page, 'dock-map-large'); await page.keyboard.press('m'); await settleDock(page); const restored = await dockGeometry(page);
    check('dock-map-expand', expanded.large && expanded.contained && JSON.stringify(normal) === JSON.stringify(restored), JSON.stringify(expanded));

    await page.setViewportSize({ width: 568, height: 320 }); await settleDock(page); await select('Franklin');
    await page.locator('#battlefield').focus(); await page.keyboard.press('b'); await page.keyboard.press('ArrowUp');
    const hints = await page.evaluate(() => {
      const dock = document.getElementById('dock').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect();
      const h = document.getElementById('keyboard-targeting').getBoundingClientRect();
      return { keyboard: h.bottom <= dock.top && h.top >= top.bottom, fieldGap: top.bottom + 64 <= dock.top, published: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) === dock.height };
    }); const keyboardGeometry = await dockGeometry(page); await page.keyboard.press('Escape');
    const intro = await page.evaluate(() => { const e = document.getElementById('intro-hint'); const saved = { hidden: e.hidden, text: e.textContent }; e.hidden = false; e.textContent = 'VISUAL FIXTURE: select your brigade, then draw a march.'; const r = e.getBoundingClientRect(), dock = document.getElementById('dock').getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect(), toggle = document.getElementById('sb-toggle').getBoundingClientRect(); const overlap = r.x < toggle.right && toggle.x < r.right && r.y < toggle.bottom && toggle.y < r.bottom; const ok = r.top >= top.bottom && r.bottom <= dock.top && !overlap; e.hidden = saved.hidden; e.textContent = saved.text; return ok; });
    check('dock-overlays-measured', keyboardGeometry.failures.length === 0 && hints.keyboard && hints.fieldGap && hints.published && intro, JSON.stringify({ ...hints, intro, keyboardFailures: keyboardGeometry.failures })); await shot(page, 'dock-landscape-selected');

    const boundary = [];
    for (const width of [760, 761, 899, 900]) { await page.setViewportSize({ width, height: 568 }); await settleDock(page); boundary.push(await dockGeometry(page)); }
    const dockingBoundaries = [];
    for (const value of ['left', 'right']) {
      await setSide(value);
      for (const width of [899, 900]) {
        await page.setViewportSize({ width, height: 568 }); await panel(false); await settleDock(page); const closed = await dockGeometry(page);
        await panel(true); await settleDock(page); const open = await dockGeometry(page);
        // Below900 the workbench is intentionally an overlay; it must not reserve dock width.
        dockingBoundaries.push({ value, width, ok: width === 899 ? open.dock.x === closed.dock.x && open.dock.right === closed.dock.right : open.failures.length === 0, closed: closed.dock, open: open.dock });
        await panel(false);
      }
    }
    await setSide('left');
    await page.setViewportSize({ width: 320, height: 568 }); await settleDock(page); const a = await dockGeometry(page), controlStart = await read();
    const inline = () => page.locator('html, #dock, #unitcard, #orders, #orders button, #minimap-box, #minimap').evaluateAll((els) => els.map((e) => [e.id || e.dataset.order || e.tagName, e.getAttribute('style')]));
    const inlineBefore = await inline(); let b, a2, toggleB, toggleA2;
    try { await page.addStyleTag({ content: 'body .sb-toggle.sb-left.sb-closed{top:50%!important}' }).then((e) => e.evaluate((el) => { el.id = 'dock-toggle-control'; })); await settleDock(page); toggleB = await dockGeometry(page); }
    finally { await page.locator('#dock-toggle-control').evaluate((e) => e.remove()); await settleDock(page); toggleA2 = await dockGeometry(page); }
    try { await page.addStyleTag({ content: '#dock{grid-template-columns:230px 194px 138px!important;height:142px!important}#dock #unitcard{width:230px!important;height:142px!important}#dock #orders{grid-column:auto!important;width:194px!important;grid-template-columns:repeat(3,56px)!important}#dock #orders button{width:56px!important}#dock #minimap-box{grid-column:auto!important;grid-row:auto!important;height:138px!important}#dock #minimap{width:128px!important;height:128px!important}' }).then((e) => e.evaluate((el) => { el.id = 'dock-overflow-control'; })); await settleDock(page); b = await dockGeometry(page); }
    finally { await page.locator('#dock-overflow-control').evaluate((e) => e.remove()); await settleDock(page); a2 = await dockGeometry(page); }
    const controlEnd = await read(), inlineAfter = await inline();
    const exactInline = JSON.stringify(inlineBefore) === JSON.stringify(inlineAfter) && await page.locator('#dock-overflow-control, #dock-toggle-control').count() === 0;
    check('dock-resize-restore', boundary.every((g) => g.failures.length === 0) && dockingBoundaries.every((g) => g.ok) && a.failures.length === 0 && b.failures.includes('orders-containment') && toggleB.failures.includes('closed-toggle-dock-overlap') && toggleB.failures.includes('card-identity-hit') && JSON.stringify(a) === JSON.stringify(toggleA2) && JSON.stringify(a) === JSON.stringify(a2) && exactInline && passiveSame(controlStart, controlEnd), JSON.stringify({ boundary: boundary.map((g) => g.failures), dockingBoundaries, a: a.failures, b: b.failures, toggleB: toggleB.failures, a2: a2.failures, exactRestore: JSON.stringify(a) === JSON.stringify(a2) && JSON.stringify(a) === JSON.stringify(toggleA2), exactInline }));
    result.dock = { before, layouts, reading, keyboard, touch, mapState, hints, intro, control: { a, b, a2, toggleB, toggleA2 } };
  } finally {
    await panel(original.panelOpen); await setSide(side); await page.setViewportSize(viewport); await settleDock(page);
    await page.evaluate((o) => {
      for (const [key, value] of [['cw.settings', o.prefs], ['cw.locks', o.locks], ['cw.sandbox.hidden', o.hidden]]) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      document.getElementById('dock-long-fixture')?.remove(); document.getElementById('dock-overflow-control')?.remove(); document.getElementById('dock-toggle-control')?.remove();
      if (window.__dockName !== undefined) document.getElementById('uc-name').textContent = window.__dockName;
      delete window.__dockName; window.__game.game.select(null); document.getElementById('unitcard').scrollTop = 0;
      delete document.getElementById('unitcard').dataset.scrollEnded;
    }, original);
    await page.locator('#battlefield').focus();
    page.off('console', warn);
  }
  const after = await read(); result.dock.after = after;
  const panelRestored = await page.evaluate((o) => localStorage.getItem('cw.sandbox.hidden') === o.hidden && (document.getElementById('sb-toggle').getAttribute('aria-expanded') === 'true') === o.panelOpen, original);
  check('dock-preserved-progress', after.progress === before.progress && after.writes === before.writes && after.prefs === original.prefs && after.locks === original.locks && panelRestored && after.time === before.time && after.paused, 'all layouts/scroll/native commands/map/control preserve exact progress, zero writes, original preference/lock/panel bytes and paused simulation time');
  result.dockAxe = axes; check('dock-axe', axes.length === 0, JSON.stringify(axes));
  result.dockWarnings = warnings;
  check('dock-no-console-errors', errors.length === 0 && warnings.length === 0, JSON.stringify({ errors, warnings }));
}

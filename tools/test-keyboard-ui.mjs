import { AxeBuilder } from '@axe-core/playwright';

export async function keyboardControls({ page, check, shot, result }) {
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  if (!(await page.evaluate(() => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  if (await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#sb-toggle').click();
  const flag = (name) => page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) });
  const select = async (name, add = false) => { await flag(name).focus(); await page.keyboard.press(add ? 'Shift+Enter' : 'Enter'); };
  const read = () => page.evaluate(() => {
    const { game, input, arrows, rts, hud } = window.__game;
    return { orders: game.orders || 0, selected: game.selected?.id, selection: game.selection.map((u) => u.id), paused: game.paused,
      target: input.targeting ? { mode: input.targeting.mode, point: { ...input.targeting.point }, enemy: input.targeting.enemy?.id, face: input.targeting.face } : null,
      ghost: arrows.previewEnd ? { ...arrows.previewEnd } : null, label: hud.dragLabel, keys: [...rts.keys],
      progress: localStorage.getItem('cw.progress'), writes: window.__sandboxWrites, hint: document.getElementById('keyboard-targeting').textContent,
      hintHidden: document.getElementById('keyboard-targeting').hidden, focus: document.activeElement?.id,
      units: game.units.map((u) => ({ id: u.id, x: u.x, z: u.z, facing: u.facing, halfFront: u.lineHalfFront(),
        order: { type: u.order.type, dest: u.order.dest, endFacing: u.order.endFacing, target: u.order.target?.id, goal: u.order.goal } })) };
  });
  const near = (a, b, eps = 0.1) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < eps;
  const before = await read(); await select('Franklin'); const selected = await read();
  check('keyboard-native-flag-selection', selected.selected === 'franklin' && selected.orders === before.orders, 'Enter on a native flag selects without an order');
  await page.keyboard.press('b'); const begun = await read();
  check('keyboard-begin-no-order', begun.target?.mode === 'march' && begun.focus === 'battlefield' && begun.orders === before.orders
    && begun.keys.length === 0 && !begun.hintHidden, JSON.stringify(begun.target));
  await page.evaluate(() => { const { rts, camera } = window.__game; rts.goal.yaw = Math.PI / 2; rts.snap(); camera.updateMatrixWorld(); });
  const source = (await read()).units.find((u) => u.id === 'franklin');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowRight');
  const moved = await read();
  check('keyboard-native-rotated-fine-steps', near(moved.target.point.x, source.x - 25, 1e-6) && near(moved.target.point.z, source.z - 5, 1e-6)
    && near(moved.ghost.x, moved.target.point.x) && near(moved.ghost.z, moved.target.point.z) && moved.keys.length === 0,
    `yaw pi/2: actual25m forward and5m right ${JSON.stringify(moved.target.point)}`);
  check('keyboard-native-accessible-destination', moved.hint.includes('March 25 m') && moved.hint.includes('facing') && moved.hint !== begun.hint,
    `role=status reports explicit destination changes: ${moved.hint}`);
  await page.keyboard.press('e'); await page.keyboard.press('Shift+q'); const facing = await read();
  check('keyboard-native-manual-facing', near(facing.ghost.facing, moved.ghost.facing + 10 * Math.PI / 180, 1e-6), `actual ghost facing ${facing.ghost.facing}`);
  check('keyboard-native-accessible-degrees', facing.hint !== moved.hint && /facing [a-z-]+ \d+°/.test(facing.hint), `exact adjusted facing in role=status: ${facing.hint}`);
  await shot(page, 'keyboard-march'); await page.keyboard.press('Enter'); const marched = await read(), marchUnit = marched.units.find((u) => u.id === 'franklin');
  check('keyboard-native-march-commit', marched.paused && marched.orders === before.orders + 1 && marchUnit.order.type === 'move'
    && near(marchUnit.order.dest[0], facing.ghost.x) && near(marchUnit.order.dest[1], facing.ghost.z)
    && near(marchUnit.order.endFacing, facing.ghost.facing, 1e-6) && !marched.target && marched.hintHidden,
    `actual paused order ${JSON.stringify(marchUnit.order)}`);

  await select('Willcox'); await select('Franklin', true); const groupStart = await read();
  check('keyboard-native-shift-enter-group', groupStart.selected === 'franklin' && groupStart.selection.length === 2
    && groupStart.selection.includes('willcox'), JSON.stringify(groupStart.selection));
  await page.evaluate(() => { const a = window.__game.arrows, set = a.setPreview;
    window.__keyboardPreviewSet = set;
    a.setPreview = function (...args) { const out = set.apply(this, args); window.__keyboardPreview = structuredClone(args[4]); return out; };
  });
  await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('q');
  const groupGhost = await read(), extras = await page.evaluate(() => window.__keyboardPreview.extras);
  await shot(page, 'keyboard-group'); await page.keyboard.press('Enter'); const groupEnd = await read();
  check('keyboard-native-group-ghost-commit', groupEnd.orders === groupStart.orders + 2 && extras.length === 1
    && groupEnd.units.filter((u) => groupEnd.selection.includes(u.id)).every((u) => {
      const p = u.id === 'franklin' ? groupGhost.ghost : extras[0]; return u.order.type === 'move'
        && near(u.order.dest[0], p.x) && near(u.order.dest[1], p.z) && near(u.order.endFacing, p.facing, 1e-6);
    }), `actual group destinations ${JSON.stringify(groupEnd.units.filter((u) => groupEnd.selection.includes(u.id)))}`);
  await page.evaluate(() => { const a = window.__game.arrows; a.setPreview = window.__keyboardPreviewSet; delete window.__keyboardPreviewSet; });

  await select('Franklin'); await page.keyboard.press('t'); const attack = await read(); await page.keyboard.press('t'); const next = await read();
  await page.keyboard.press('Shift+t'); const previous = await read();
  check('keyboard-native-target-cycle', attack.target?.mode === 'attack' && next.target.enemy !== attack.target.enemy && previous.target.enemy === attack.target.enemy,
    `${attack.target?.enemy} -> ${next.target?.enemy} -> ${previous.target?.enemy}`);
  await page.keyboard.press('q'); const fixed = await read();
  check('keyboard-native-attack-facing', near(fixed.ghost.facing, previous.ghost.facing) && fixed.keys.length === 0, 'attack faces its enemy and Q cannot rotate the camera');
  await page.evaluate(() => { const d = window.__game.input.targeting; d.enemy.vehicle.position.x += 30; d.enemy.vehicle.position.z += 20; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const refreshed = await read(), halt = await page.evaluate(() => { const { input, game } = window.__game; return game.attackHalt(input.targeting.unit, input.targeting.enemy); });
  check('keyboard-native-moving-target-refresh', near(refreshed.ghost.x, halt.x) && near(refreshed.ghost.z, halt.z), JSON.stringify({ ghost: refreshed.ghost, halt }));
  await shot(page, 'keyboard-attack'); await page.keyboard.press('Enter'); const fired = await read(), firedUnit = fired.units.find((u) => u.id === 'franklin');
  check('keyboard-native-ranged-order', fired.orders === refreshed.orders + 1 && firedUnit.order.type === 'attack' && firedUnit.order.target === refreshed.target.enemy
    && !fired.target && fired.paused, `actual ranged order ${JSON.stringify(firedUnit.order)}; attack paths may adjust for line of sight`);

  const cancelStart = await read(); await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape'); const cancelled = await read();
  check('keyboard-native-escape-keeps-selection', !cancelled.target && cancelled.selected === 'franklin' && cancelled.orders === cancelStart.orders, 'Escape removes only the pending ghost');
  await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('?');
  check('keyboard-native-shared-help', await page.locator('#menu').evaluate((el) => el.open) && !(await read()).target
    && (await read()).keys.length === 0 && await page.locator('#menu').getByText('Keyboard march', { exact: true }).isVisible(), 'question mark opens shared native help and clears targeting');
  await page.keyboard.press('Escape');
  check('keyboard-native-help-focus-return', (await read()).focus === 'battlefield' && (await read()).orders === cancelStart.orders, 'native Escape closes help and returns focus to its connected field trigger');
  await page.locator('#menu-btn').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  check('keyboard-native-menu-button-focus-return', (await read()).focus === 'menu-btn', 'button and key share the menu lifecycle');

  await select('Franklin'); await page.keyboard.press('t'); await page.evaluate(() => { window.__game.input.targeting.enemy.state = 'routing'; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const stale = await read();
  check('keyboard-native-stale-target-auto-cancel', !stale.target && stale.selected === 'franklin' && stale.orders === cancelStart.orders, 'render-time routed-target cancellation keeps selection and issues no order');
  await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('keyboard-native-blur-cancellation', !(await read()).target && (await read()).keys.length === 0 && (await read()).orders === cancelStart.orders, 'window blur clears pending state');
  await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await page.locator('#army-btn').click();
  check('keyboard-native-pointer-cancellation', !(await read()).target && (await read()).orders === cancelStart.orders, 'real pointer on an unrelated HUD control cancels pending targeting');
  await page.locator('#army-btn').click();

  if (await page.locator('#sb-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sb-toggle').click();
  await page.getByRole('tab', { name: 'Look', exact: true }).click(); const slider = page.getByRole('slider', { name: 'Formation spacing', exact: true });
  await slider.focus(); await page.keyboard.press('b'); await page.keyboard.press('t');
  check('keyboard-native-sandbox-form-isolation', !(await read()).target && (await read()).orders === cancelStart.orders, 'real sandbox slider keeps letter keys out of battle orders');
  await page.locator('#sb-toggle').click();
  await select('Franklin'); await page.keyboard.press('b'); await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Enter'); const short = await read();
  check('keyboard-native-minimum-distance', short.target?.mode === 'march' && short.orders === cancelStart.orders, '5m ghost cannot become a march order');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 320, height: 568 }); await select('Franklin'); await page.keyboard.press('b'); await page.keyboard.press('ArrowUp');
  const rects = await page.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    return { hint: r('keyboard-targeting'), dock: r('dock'), menu: r('menu-btn'), focused: document.activeElement.id };
  });
  check('keyboard-320-instructions-and-targets', rects.hint.x >= 0 && rects.hint.right <= 320 && rects.hint.y >= 0
    && rects.hint.bottom <= rects.dock.y && rects.menu.width >= 44 && rects.menu.height >= 44 && rects.focused === 'battlefield', JSON.stringify(rects));
  await shot(page, 'keyboard-320'); const axe = await new AxeBuilder({ page }).include('#keyboard-targeting').include('#battlefield').analyze();
  result.keyboardAxe = axe.violations; check('keyboard-axe', axe.violations.length === 0, JSON.stringify(axe.violations));
  await page.keyboard.press('?'); await shot(page, 'keyboard-help-320'); const helpAxe = await new AxeBuilder({ page }).include('#menu').analyze();
  result.keyboardHelpAxe = helpAxe.violations; check('keyboard-help-axe', helpAxe.violations.length === 0, JSON.stringify(helpAxe.violations));
  const hits = await page.locator('#menu fieldset label, #menu label.row').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, x: r.x, right: r.right }; }));
  check('keyboard-help-320-hit-areas', hits.length === 4 && hits.every((r) => r.height >= 44 && r.width >= 44 && r.x >= 0 && r.right <= 320), JSON.stringify(hits));
  const tabStops = []; for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); tabStops.push(await page.evaluate(() => {
    const e = document.activeElement, r = e.getBoundingClientRect(); return { inside: !!e.closest('#menu'), close: e.matches('button[type=submit]'), visible: r.y >= 0 && r.bottom <= innerHeight }; })); }
  check('keyboard-help-320-tab-containment-scroll', tabStops.every((s) => s.inside && s.visible) && tabStops.some((s) => s.close), JSON.stringify(tabStops));
  await page.locator('#menu button[type=submit]').focus(); await shot(page, 'keyboard-help-close-320'); await page.keyboard.press('Enter');
  check('keyboard-native-help-close-activation', !await page.locator('#menu').evaluate((el) => el.open) && (await read()).focus === 'battlefield', 'keyboard reaches native Close, scrolls it into view and restores field focus');
  const after = await read();
  check('keyboard-progress-preserved', after.progress === before.progress && after.writes === before.writes, 'all actual keyboard orders/help/cancellation preserve exact saved progress and zero writes');
  result.keyboard = { before, marched, groupGhost, groupEnd, fired, rects, after };
  await page.setViewportSize({ width: 1280, height: 720 });
}

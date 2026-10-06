import { AxeBuilder } from '@axe-core/playwright';

export async function viewControls({ page, check, shot, result }) {
  if (!(await page.evaluate(async () => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('tab', { name: 'Look', exact: true }).click();
  const state = () => page.evaluate(async () => {
    const { game, rts, post, camera } = window.__game;
    return { pitch: rts.goal.pitch, actualPitch: rts.pitch, goal: [rts.goal.x, rts.goal.z, rts.goal.dist, rts.goal.yaw],
      units: JSON.stringify(game.units.filter((u) => !u.id.startsWith('sandbox-')).map((u) => [u.id, u.x, u.z, u.men, u.ammo, u.xp, u.order])),
      time: game.simTime, paused: game.paused, progress: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites,
      textures: post.renderer.info.memory.textures, geometries: post.renderer.info.memory.geometries,
      targets: [post.rtScene, post.rtSmall, post.rtBlur].map((t) => [t.uuid, t.width, t.height]), footprint: rts.footprint().map((p) => [...p]),
      matrix: camera.matrixWorld.toArray() };
  });
  const before = await state(), marker = page.getByRole('slider', { name: 'Marker size', exact: true });
  const markers = () => page.evaluate(async () => {
    const { hud, game, camera, terrain } = window.__game;
    return game.units.filter((u) => u.alive).map((u) => {
      const m = hud.markers.get(u.id), b = m.el.getBoundingClientRect(), s = getComputedStyle(m.el.querySelector('svg')), bar = getComputedStyle(m.el.querySelector('.sbar'));
      const p = camera.position.clone().set(u.x, terrain.heightAt(u.x, u.z) + 16, u.z).project(camera);
      return { id: u.id, hidden: m.el.classList.contains('hidden'), w: b.width, h: b.height, x: b.x, y: b.y, cw: m.w, ch: m.h,
        flag: [parseFloat(s.width), parseFloat(s.height)], bar: [parseFloat(bar.width), parseFloat(bar.height)],
        font: getComputedStyle(m.el.querySelector('.str')).fontSize,
        px: (p.x * 0.5 + 0.5) * innerWidth, py: (-p.y * 0.5 + 0.5) * innerHeight,
        anchor: m.anchor, tether: m.link.style.display !== 'none', paths: [...m.link.children].map((n) => n.getAttribute('d')),
        top: document.getElementById('topbar').getBoundingClientRect().bottom };
    });
  });
  const geometry = [];
  for (const scale of [0.75, 1, 1.75]) {
    if (scale === 1) await page.getByRole('button', { name: 'Reset Marker size', exact: true }).click();
    else { await marker.focus(); await page.keyboard.press(scale < 1 ? 'Home' : 'End'); }
    await page.waitForFunction((scale) => {
      const { hud } = window.__game; return document.getElementById('markers').style.getPropertyValue('--marker-scale') === String(scale)
        && [...hud.markers.values()].filter((m) => !m.el.classList.contains('hidden')).every((m) => { const b = m.el.getBoundingClientRect(); return Math.abs(m.w - b.width) < 0.05 && Math.abs(m.h - b.height) < 0.05; });
    }, scale);
    await page.locator('#sb-toggle').click();
    const all = await markers(), visible = all.filter((m) => !m.hidden), overlaps = [];
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps.push([a.id, b.id]);
    }
    check(`view-marker-${scale}`, visible.length > 0 && visible.every((m) => m.w >= 44 && m.h >= 44 && m.font === '11px'
      && Math.abs(m.flag[0] - 34 * scale) < 0.1 && Math.abs(m.flag[1] - 30 * scale) < 0.1
      && Math.abs(m.bar[0] - 36 * scale) < 0.1 && Math.abs(m.bar[1] - 6 * scale) < 0.1
      && m.x >= 3.9 && m.x + m.w <= 1276.1 && m.y >= m.top + 3.9 && m.y + m.h <= 716.1
      && Math.abs(m.anchor.x - m.px) < 0.15 && Math.abs(m.anchor.y - m.py) < 0.15
      && (Math.hypot(m.x + m.w / 2 - m.px, m.y + m.h - m.py) <= 1.2 || (m.tether && m.paths.length === 2 && m.paths.every((d) => {
        const nums = d?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
        return nums?.length === 4 && Math.abs(nums[0] - m.px) < 0.15 && Math.abs(nums[1] - m.py) < 0.15
          && Math.abs(nums[2] - m.x - m.w / 2) < 0.15 && Math.abs(nums[3] - m.y - m.h) < 0.15;
      })))) && overlaps.length === 0,
    `actual ${visible.length} flags/bars, >=44px visible hit rectangles below top strip, unchanged text and true anchors/tethers; overlaps ${JSON.stringify(overlaps)}`);
    geometry.push({ scale, markers: all }); await shot(page, `view-markers-${scale}`); await page.locator('#sb-toggle').click();
  }
  result.viewMarkers = geometry;
  await page.locator('#sb-toggle').click();
  const topHits = [];
  for (const id of ['bee', 'staunton', 'rockbridge']) {
    const point = await page.evaluate((id) => { const el = window.__game.hud.markers.get(id).el, b = el.querySelector('svg').getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
      return { x, y, hit: el.contains(document.elementFromPoint(x, y)) }; }, id);
    await page.mouse.click(point.x, point.y); const selected = await page.evaluate(async () => window.__game.game.selected?.id);
    const focus = await page.evaluate((id) => { const m = window.__game.hud.markers.get(id); m.el.focus(); const b = m.el.querySelector('.info').getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, min: document.getElementById('topbar').getBoundingClientRect().bottom }; }, id);
    topHits.push({ id, ...point, selected, focus });
  }
  check('view-top-markers-accessible', topHits.every((p) => p.hit && p.selected === p.id && p.focus.top >= p.focus.min && p.focus.bottom <= 720),
    `formerly obscured 1900/firing100 markers have real pointer and visible focus information: ${JSON.stringify(topHits)}`);
  result.viewTopHits = topHits;
  await shot(page, 'view-top-marker-focused'); await page.locator('#sb-toggle').click();
  const franklin = page.locator('.marker').filter({ has: page.locator('.nm', { hasText: 'Franklin' }) });
  await page.locator('#sb-toggle').click(); await franklin.focus(); await page.keyboard.press('Enter');
  check('view-marker-keyboard', await page.evaluate(async () => window.__game.game.selected?.id === 'franklin') && await franklin.locator('.info').isVisible(), 'large marker Enter selects real brigade and exposes readable unit information');
  await shot(page, 'view-marker-selected');
  const flag = await franklin.locator('svg').boundingBox(), start = { x: flag.x + flag.width / 2, y: flag.y + flag.height / 2 }, end = { x: start.x + 90, y: start.y + 50 };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 });
  const preview = await page.evaluate(async () => !!window.__game.arrows.preview); await page.mouse.up();
  const ordered = await page.evaluate(({ x, y }) => { const { game, rts } = window.__game, u = game.selected, p = rts.pick(x, y, document.getElementById('battlefield'));
    return { id: u?.id, type: u?.order.type, gap: p && u?.order.dest ? Math.hypot(p.x - u.order.dest[0], p.z - u.order.dest[1]) : null }; }, end);
  check('view-marker-drag', preview && ordered.id === 'franklin' && ordered.type === 'move' && ordered.gap !== null && ordered.gap < 20, `large flag real mouse drag uses ordinary ghost/order path: ${JSON.stringify(ordered)}`);
  await page.waitForTimeout(450);
  const touched = await page.evaluate(async () => { const { game, hud } = window.__game, el = hud.markers.get('franklin').el, b = el.querySelector('svg').getBoundingClientRect(); game.select(null);
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })); return game.selected?.id; });
  check('view-marker-touch', touched === 'franklin', 'large flag synthetic touch selects the same brigade through marker pointer handlers');
  await page.locator('#sb-toggle').click();
  await page.getByRole('tab', { name: 'Units', exact: true }).click(); await page.getByRole('button', { name: 'Spawn Union brigade at view centre', exact: true }).click();
  const placed = await page.evaluate(async () => { const { game, hud } = window.__game, u = game.selected, m = hud.markers.get(u.id); return { id: u.id, flag: parseFloat(getComputedStyle(m.el.querySelector('svg')).width) }; });
  check('view-marker-new-unit', placed.id.startsWith('sandbox-') && Math.abs(placed.flag - 59.5) < 0.1, 'new generic brigade inherits current marker size');
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click(); await page.getByRole('tab', { name: 'Look', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Marker size', exact: true }).click();

  const cameraBefore = await state();
  const angle = page.getByRole('slider', { name: 'Camera elevation', exact: true });
  await angle.focus(); await page.keyboard.press('End'); const high = await state();
  check('view-camera-live', Math.abs(high.pitch - Math.min(1.35, before.pitch + Math.PI / 6)) < 1e-8 && JSON.stringify(high.goal) === JSON.stringify(before.goal)
    && high.units === cameraBefore.units && high.time === cameraBefore.time && high.paused, 'keyboard elevation changes goal pitch by30degrees while centre/distance/yaw/paused units/time stay exact');
  await page.locator('#sb-toggle').click(); await page.waitForTimeout(900); const highSettled = await state();
  const highMarkers = await page.evaluate(async () => {
    const panels = ['unitcard', 'orders', 'minimap-box', 'objective', 'tip', 'intro-hint', 'army', 'field-stores', 'feed'].map((id) => document.getElementById(id))
      .filter((n) => !n.hidden).map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
    return [...window.__game.hud.markers.entries()].filter(([, m]) => !m.el.classList.contains('hidden')).map(([id, m]) => {
      const b = m.el.getBoundingClientRect(), f = m.el.querySelector('svg').getBoundingClientRect(), x = f.x + f.width / 2, y = f.y + f.height / 2;
      return { id, x, y, hit: m.el.contains(document.elementFromPoint(x, y)), clear: panels.every((p) => b.right <= p.left || b.left >= p.right || b.bottom <= p.top || b.top >= p.bottom) };
    });
  });
  const franklinHigh = highMarkers.find((m) => m.id === 'franklin');
  await page.mouse.click(franklinHigh.x, franklinHigh.y);
  check('view-high-markers-clear-dock', highMarkers.length > 0 && highMarkers.every((m) => m.hit && m.clear) && await page.evaluate(async () => window.__game.game.selected?.id === 'franklin'),
    `high-angle marker bodies avoid visible HUD panels and Franklin accepts actual pointer: ${JSON.stringify(highMarkers)}`);
  result.viewHighMarkers = highMarkers;
  await shot(page, 'view-camera-high'); await page.locator('#sb-toggle').click();
  await angle.focus(); await page.keyboard.press('Home'); const low = await state();
  check('view-camera-low', Math.abs(low.pitch - Math.max(0.3, before.pitch - Math.PI / 12)) < 1e-8 && low.units === cameraBefore.units && low.time === cameraBefore.time, 'minimum elevation is clamped and leaves paused brigade state unchanged');
  await page.locator('#sb-toggle').click(); await page.waitForTimeout(900); await shot(page, 'view-camera-low'); await page.locator('#sb-toggle').click();
  await page.getByRole('button', { name: 'Reset Camera elevation', exact: true }).click();
  await angle.focus(); for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.locator('#sb-toggle').click();
  // Real ctrl-wheel event, actual terrain pick, and a centre-only negative comparison.
  const zoom = await page.evaluate(async () => { const { rts, camera } = window.__game; for (let i = 0; i < 4; i++) rts.update(1); camera.updateMatrixWorld();
    const p = rts.pick(410, 418, document.getElementById('battlefield')); return { p: p?.toArray(), goal: { ...rts.goal } }; });
  await page.mouse.move(410, 418); await page.keyboard.down('Control'); await page.mouse.wheel(0, -240); await page.keyboard.up('Control');
  const anchored = await page.evaluate(({ p, goal }) => {
    const { rts, camera } = window.__game;
    const read = () => { for (let i = 0; i < 4; i++) rts.update(1); camera.updateMatrixWorld(); const v = camera.position.clone().fromArray(p).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, dist: rts.goal.dist }; };
    const actual = read(), after = { ...rts.goal }, factor = after.dist / goal.dist;
    Object.assign(rts.goal, goal); rts.snap(); rts.zoomBy(factor); const broken = read(); Object.assign(rts.goal, after); rts.snap(); read(); return { actual, broken };
  }, zoom);
  const error = (p, x = 410, y = 418) => Math.max(Math.abs(p.x - x) / 1280, Math.abs(p.y - y) / 720);
  check('view-camera-zoom-anchor', zoom.p && anchored.actual.dist < zoom.goal.dist * 0.8 && error(anchored.actual) < 0.03 && error(anchored.broken) > 0.03,
    `15degree elevation real wheel error ${error(anchored.actual)}, centre-only control ${error(anchored.broken)}`);
  const pinch = await page.evaluate(async () => {
    const { rts, camera, input } = window.__game, canvas = document.getElementById('battlefield');
    const p = rts.pick(460, 418, canvas), start = rts.goal.dist;
    const fire = (type, id, x) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 81, clientX: x, clientY: 418, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    fire('pointerdown', 81, 380); fire('pointerdown', 82, 540); const mode = input.drag?.mode;
    fire('pointermove', 81, 340); fire('pointermove', 82, 580); fire('pointerup', 81, 340); fire('pointerup', 82, 580);
    for (let i = 0; i < 4; i++) rts.update(1); camera.updateMatrixWorld(); const v = p?.clone().project(camera);
    return { mode, start, dist: rts.goal.dist, x: v && (v.x * 0.5 + 0.5) * innerWidth, y: v && (-v.y * 0.5 + 0.5) * innerHeight, pointers: input.pointers.size };
  });
  check('view-camera-touch-pinch', pinch.mode === 'pinch' && pinch.dist < pinch.start * 0.8 && pinch.pointers === 0 && error(pinch, 460, 418) < 0.03,
    `synthetic two-finger input path at15degrees: ${JSON.stringify(pinch)}; no physical device claim`);
  result.viewAnchors = { wheel: anchored, touch: pinch };
  const fly = await page.evaluate(async () => { const { rts, hud } = window.__game; rts.flyTo(100, 200, 350); for (let i = 0; i < 4; i++) rts.update(1);
    window.__game.camera.updateMatrixWorld(); hud.minimap.draw(); return { ...rts.goal, footprint: rts.footprint().map((p) => [...p]), minimap: hud.minimap.foot }; });
  check('view-camera-fly-minimap', fly.x === 100 && fly.z === 200 && fly.dist <= 350 && fly.footprint.flat().every(Number.isFinite) && JSON.stringify(fly.footprint) === JSON.stringify(fly.minimap), 'fly-to and real survey minimap use the changed camera footprint');
  await page.locator('#sb-toggle').click();

  for (const name of ['Marker size', 'Camera elevation']) await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).check();
  await page.evaluate(async () => { const S = await import('./src/settings.js'); S.set('look.markerScale', 1.75); S.reset('look.markerScale'); S.set('look.cameraElevation', -15); S.reset('look.cameraElevation'); });
  check('view-lock', await marker.isDisabled() && await angle.isDisabled() && await page.evaluate(async () => { const S = await import('./src/settings.js'); return S.get('look.markerScale') === 1 && S.get('look.cameraElevation') === 15; }), 'locks refuse direct Set/Reset and disable both sliders');
  await page.getByRole('button', { name: 'Copy settings', exact: true }).click(); const copied = await page.evaluate(async () => navigator.clipboard.readText());
  await page.reload(); await page.waitForFunction(() => window.__ready && document.getElementById('sb-panel'), null, { timeout: 180000 });
  const loaded = await state();
  check('view-reload', Math.abs(loaded.pitch - before.pitch - Math.PI / 12) < 1e-8 && await marker.isDisabled() && await angle.isDisabled()
    && loaded.progress === before.progress && loaded.writes === 0, 'constructor retains15degree elevation and both locks without progress changes');
  for (const name of ['Marker size', 'Camera elevation']) await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Reset Camera elevation', exact: true }).click();
  await page.getByRole('button', { name: 'Paste settings', exact: true }).click(); await page.locator('#sb-paste-text').fill(copied); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  check('view-transfer', await marker.isDisabled() && await angle.isDisabled() && Math.abs((await state()).pitch - loaded.pitch) < 1e-8, 'real Copy/Paste restores the elevation and lock set');
  for (const name of ['Marker size', 'Camera elevation']) await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Reset Camera elevation', exact: true }).click();
  const final = await state();
  check('view-reset-progress', Math.abs(final.pitch - before.pitch) < 1e-8 && final.progress === before.progress && final.writes === 0, 'Reset restores default camera angle and preserves exact progress');
  // Resource comparison before reload (same scene); changed camera may render different LOD, never allocate targets.
  // The explicit mouse order above creates its ordinary route mesh; compare before/after the angle edit.
  result.viewResources = { beforeOrder: { textures: before.textures, geometries: before.geometries },
    beforeAngle: { textures: cameraBefore.textures, geometries: cameraBefore.geometries }, afterAngle: { textures: highSettled.textures, geometries: highSettled.geometries } };
  check('view-no-render-allocation', highSettled.textures === cameraBefore.textures && highSettled.geometries === cameraBefore.geometries && JSON.stringify(highSettled.targets) === JSON.stringify(cameraBefore.targets),
    `settled angle edit retains target IDs/dimensions and allocations: ${JSON.stringify(result.viewResources)}`);
  await page.setViewportSize({ width: 320, height: 720 });
  for (const key of ['look.markerScale', 'look.cameraElevation']) {
    const row = page.locator(`[data-key="${key}"]`); await row.scrollIntoViewIfNeeded();
    const targets = await row.locator('input[type=range], .sb-btn, .sb-lock').evaluateAll((nodes) => nodes.map((n) => { const b = n.getBoundingClientRect(); return [b.width, b.height]; }));
    const fits = await page.locator('#sb-panel').evaluate((n) => n.scrollWidth <= n.clientWidth && n.querySelector('.sb-body').scrollWidth <= n.querySelector('.sb-body').clientWidth);
    check(`view-targets-${key}`, targets.length === 3 && targets.every(([w, h]) => w >= 44 && h >= 44) && fits, `320px controls ${JSON.stringify(targets)}, fits ${fits}`); await shot(page, `view-${key.split('.')[1]}-320`);
  }
  const axe = await new AxeBuilder({ page }).include('#sb-panel').analyze(); result.viewAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact }));
  check('view-axe', axe.violations.length === 0, JSON.stringify(result.viewAxe)); await page.setViewportSize({ width: 1280, height: 720 });
}

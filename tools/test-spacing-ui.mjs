import { AxeBuilder } from '@axe-core/playwright';

export async function spacingControls({ page, check, shot, result }) {
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  if (!(await page.evaluate(() => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const panel = async (open) => { if ((await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') !== open) await page.locator('#sb-toggle').click(); };
  const flag = (name) => page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) });
  await panel(false); await flag('Franklin').dblclick(); await page.waitForTimeout(1200);
  await page.evaluate(() => { const { rts, camera } = window.__game; for (let i = 0; i < 4; i++) rts.update(1); camera.updateMatrixWorld(); });
  await page.waitForTimeout(300); await panel(true); await page.getByRole('tab', { name: 'Look', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Formation spacing', exact: true });
  const read = () => page.evaluate(() => {
    const { game: g, post } = window.__game, u = g.units.find((v) => v.id === 'franklin');
    return { time: g.simTime, paused: g.paused, progress: localStorage.getItem('cw.progress'), writes: window.__sandboxWrites,
      roster: JSON.stringify(g.units.map((v) => [v.id, v.x, v.z, v.men, v.menMax, v.morale, v.fatigue, v.ammo, v.xp, v.weapon, v.order, v.path, v.facing, v.goalFacing])),
      halfFront: u.halfFront, depth: u.depth, textures: post.renderer.info.memory.textures, geometries: post.renderer.info.memory.geometries,
      targets: [post.rtScene, post.rtSmall, post.rtBlur].map((t) => [t.uuid, t.width, t.height]) };
  });
  await page.evaluate(() => {
    window.__spacingRefs = window.__game.game.units.map((u) => ({ u, figures: [...u.figures], slots: u.figures.map((f) => [f, f.lx, f.lz]),
      fallen: u.figures.filter((f) => !f.alive).map((f) => [f, f.x, f.z, f.yaw]), battery: u.type === 'artillery' ? JSON.stringify([u.halfFront, u.depth, u.gunSlots]) : null }));
  });
  result.spacingFallenCount = await page.evaluate(() => window.__spacingRefs.reduce((n, r) => n + r.fallen.length, 0));
  const before = await read(), layouts = [];
  for (const scale of [0.75, 1.5, 1]) {
    if (scale === 1) await page.getByRole('button', { name: 'Reset Formation spacing', exact: true }).click();
    else { await slider.focus(); await page.keyboard.press(scale < 1 ? 'Home' : 'End'); }
    const unchanged = await page.evaluate((scale) => window.__spacingRefs.every(({ u, figures, slots, fallen, battery }) => {
      if (figures.length !== u.figures.length || figures.some((f, i) => f !== u.figures[i])) return false;
      if (fallen.some(([f, x, z, yaw]) => f.x !== x || f.z !== z || f.yaw !== yaw)) return false;
      if (battery) return battery === JSON.stringify([u.halfFront, u.depth, u.gunSlots]);
      return slots.filter(([f]) => f.alive).every(([f, x, z]) => Math.abs(f.lx - x * scale) < 1e-8 && Math.abs(f.lz - z * scale) < 1e-8
        && Math.hypot(f.x - u.slotWorld(f)[0], f.z - u.slotWorld(f)[1]) < 1e-8);
    }), scale);
    const now = await read();
    check(`spacing-live-${scale}`, unchanged && now.paused && now.roster === before.roster && now.time === before.time
      && Math.abs(now.halfFront - before.halfFront * scale) < 1e-8 && Math.abs(now.depth - before.depth * scale) < 1e-8 && now.progress === before.progress && now.writes === 0,
      `real keyboard ${scale}: slots/footprint refresh while paused; identities, ${result.spacingFallenCount} existing fallen, batteries, brigade centres/stats/orders/time/progress unchanged`);
    layouts.push({ scale, halfFront: now.halfFront, depth: now.depth }); await panel(false); await shot(page, `spacing-${scale}`); await panel(true);
  }
  const stable = await read();
  check('spacing-no-texture-target-allocation', stable.textures === before.textures && stable.geometries === before.geometries && JSON.stringify(stable.targets) === JSON.stringify(before.targets), 'fixed-view no-order spacing edits retain texture/geometry counts and all target identities/dimensions');
  result.spacingResources = { before: [before.textures, before.geometries], after: [stable.textures, stable.geometries] };
  result.spacingLayouts = layouts;

  // Native shift-selection and a real rotated group drag, observed through the actual preview seam.
  await slider.focus(); await page.keyboard.press('End'); await panel(false);
  await flag('Franklin').click(); await page.keyboard.down('Shift'); await flag('Willcox').click(); await page.keyboard.up('Shift');
  check('spacing-real-group-selection', await page.evaluate(() => window.__game.game.selection.length === 2 && window.__game.game.selection.some((u) => u.id === 'franklin') && window.__game.game.selection.some((u) => u.id === 'willcox')), 'native Shift-click keeps both brigades selected');
  await page.evaluate(() => {
    const { arrows, game } = window.__game, original = arrows.setPreview;
    window.__spacingPreviewOriginal = original;
    window.__spacingGroupBefore = game.selection.map((u) => ({ id: u.id, x: u.x, z: u.z, facing: u.facing }));
    arrows.setPreview = function (points, side, width, halfFront, opts) {
      const ret = original.call(this, points, side, width, halfFront, opts);
      const c = Math.cos(opts.facing), s = Math.sin(opts.facing);
      const fronts = (this.previewGhost?.children || []).filter((m) => m.material === this.ghostMats[side]).map((m) => {
        const p = m.geometry.attributes.position; let min = Infinity, max = -Infinity;
        for (let i = 0; i < p.count; i++) { const v = p.getX(i) * c - p.getZ(i) * s; min = Math.min(min, v); max = Math.max(max, v); }
        return max - min;
      });
      window.__spacingPreview = { end: { ...this.previewEnd }, halfFront, opts: structuredClone(opts), fronts }; return ret;
    };
  });
  const box = await flag('Franklin').locator('svg').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.keyboard.down('Shift');
  await page.mouse.move(x + 95, y - 65, { steps: 12 });
  const preview = await page.evaluate(() => window.__spacingPreview); await page.mouse.up(); await page.keyboard.up('Shift');
  const group = await page.evaluate((preview) => {
    const { game, arrows } = window.__game; arrows.setPreview = window.__spacingPreviewOriginal;
    const leader = game.units.find((u) => u.id === 'franklin'), other = game.units.find((u) => u.id === 'willcox'), old = window.__spacingGroupBefore.find((u) => u.id === leader.id);
    return { leader: { dest: leader.order.dest, type: leader.order.type, halfFront: leader.lineHalfFront() },
      other: { dest: other.order.dest, type: other.order.type, halfFront: other.lineHalfFront() },
      turned: Math.abs(Math.atan2(Math.sin(preview.opts.facing - old.facing), Math.cos(preview.opts.facing - old.facing))), paused: game.paused };
  }, preview);
  const close = (a, b) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.1;
  check('spacing-real-group-preview-order', preview && group.paused && group.turned > 0.1 && group.leader.type === 'move' && group.other.type === 'move'
    && close(group.leader.dest, [preview.end.x, preview.end.z]) && close(group.other.dest, [preview.opts.extras[0].x, preview.opts.extras[0].z])
    && Math.abs(preview.halfFront - group.leader.halfFront) < 1e-8 && Math.abs(preview.opts.extras[0].halfFront - group.other.halfFront) < 1e-8
    && preview.fronts.length === 2 && preview.fronts.every((w, i) => Math.abs(w - 2 * [preview.halfFront, preview.opts.extras[0].halfFront][i]) < 0.1),
    `actual rotated group preview bar geometry/destinations match confirmed paused orders: ${JSON.stringify({ preview, group })}`);
  result.spacingGroup = { preview, group }; await shot(page, 'spacing-group-order');
  await panel(true); await page.getByRole('button', { name: 'Reset Formation spacing', exact: true }).click();
  await page.waitForTimeout(200);
  const resetGhosts = await page.evaluate(() => {
    const { game, arrows } = window.__game;
    return ['franklin', 'willcox'].map((id) => { const u = game.units.find((v) => v.id === id), g = arrows.ghosts.get(id)?.g;
      const m = g?.children.find((n) => n.material === arrows.ghostMats.US), p = m?.geometry.attributes.position, c = Math.cos(u.order.endFacing), s = Math.sin(u.order.endFacing);
      let min = Infinity, max = -Infinity; if (p) for (let i = 0; i < p.count; i++) { const v = p.getX(i) * c - p.getZ(i) * s; min = Math.min(min, v); max = Math.max(max, v); }
      return { id, actual: max - min, expected: u.lineHalfFront() * 2 }; });
  });
  check('spacing-existing-ghost-reset', resetGhosts.every((g) => Number.isFinite(g.actual) && Math.abs(g.actual - g.expected) < 0.1), `actual existing destination ghosts resize on Reset: ${JSON.stringify(resetGhosts)}`);

  await slider.focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Units', exact: true }).click(); await page.getByRole('button', { name: 'Spawn Union brigade at view centre', exact: true }).click();
  check('spacing-new-placement', await page.evaluate(() => { const u = window.__game.game.selected; return u.id.startsWith('sandbox-') && Math.abs(u.halfFront - Math.max(4, (u.files - 1) / 2 * 2.35 * 1.3)) < 1e-8; }), 'real placement inherits saved1.3spacing');
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click(); await page.getByRole('tab', { name: 'Look', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Lock this: Formation spacing', exact: true }).check();
  await page.evaluate(async () => { const S = await import('./src/settings.js'); S.set('look.formationSpacing', 0.75); S.reset('look.formationSpacing'); });
  check('spacing-lock', await slider.isDisabled() && await page.evaluate(async () => (await import('./src/settings.js')).get('look.formationSpacing') === 1.3), 'Lock refuses Set/Reset and disables actual slider');
  await page.getByRole('button', { name: 'Copy settings', exact: true }).click(); const copied = await page.evaluate(() => navigator.clipboard.readText());
  const preReload = await read(); check('spacing-progress-before-reload', preReload.progress === before.progress && preReload.writes === 0, 'slider/group/placement/lock phase preserves exact progress and zero writes before reload resets counters');
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  check('spacing-reload', await slider.isDisabled() && await page.evaluate(() => { const u = window.__game.game.units.find((v) => v.id === 'franklin'); return Math.abs(u.halfFront - Math.max(4, (u.files - 1) / 2 * 2.35 * 1.3)) < 1e-8; }), 'new constructor retains1.3spacing/lock; no in-progress battle-save claim');
  await page.getByRole('checkbox', { name: 'Lock this: Formation spacing', exact: true }).uncheck(); await page.getByRole('button', { name: 'Reset Formation spacing', exact: true }).click();
  await page.getByRole('button', { name: 'Paste settings', exact: true }).click(); await page.locator('#sb-paste-text').fill(copied); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  check('spacing-transfer', await slider.isDisabled() && await page.evaluate(async () => (await import('./src/settings.js')).get('look.formationSpacing') === 1.3), 'real Copy/Paste restores spacing and lock');
  await page.getByRole('checkbox', { name: 'Lock this: Formation spacing', exact: true }).uncheck(); await page.getByRole('button', { name: 'Reset Formation spacing', exact: true }).click();
  const end = await read(); check('spacing-progress-intact', end.progress === before.progress && end.writes === 0, 'all spacing controls/placement/reload leave exact completed progress and zero writes');
  await page.setViewportSize({ width: 320, height: 480 }); await slider.scrollIntoViewIfNeeded();
  const targets = await page.locator('[data-key="look.formationSpacing"]').evaluate((n) => {
    const r = n.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth && n.scrollWidth <= n.clientWidth,
      controls: [...n.querySelectorAll('input[type=range],button,label.sb-lock')].map((c) => { const b = c.getBoundingClientRect(); return [b.width, b.height]; }) };
  });
  check('spacing-targets-narrow', targets.fits && targets.controls.length >= 3 && targets.controls.every(([w, h]) => w >= 44 && h >= 44), `320px controls ${JSON.stringify(targets)}`);
  const axe = await new AxeBuilder({ page }).include('[data-key="look.formationSpacing"]').analyze(); result.spacingAxe = axe.violations;
  check('spacing-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id))); await shot(page, 'spacing-320');
  await page.setViewportSize({ width: 1280, height: 720 });
}

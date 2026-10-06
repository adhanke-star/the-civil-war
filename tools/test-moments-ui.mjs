import { AxeBuilder } from '@axe-core/playwright';

export async function momentControls({ page, check, shot, result }) {
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  if (!(await page.evaluate(async () => window.__game.game.paused))) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const panel = async (open) => { if ((await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') !== open) await page.locator('#sb-toggle').click(); };
  const flag = page.locator('.marker').filter({ has: page.locator('.nm', { hasText: /^Franklin$/ }) });
  await panel(false); await flag.dblclick(); await page.waitForTimeout(1200);
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) window.__game.rts.update(1); window.__game.camera.updateMatrixWorld(); });
  await panel(true); await page.getByRole('tab', { name: 'Moments', exact: true }).click();
  const preview = page.getByRole('button', { name: 'Selected: preview X-Factor', exact: true });
  const loot = page.getByRole('button', { name: 'Preview one loot card', exact: true });
  const tone = (name) => page.locator('[data-key="look.xFactorStyle"]').getByRole('radio', { name, exact: true });
  // Observe real action return/state and native close, without a product hook or replacing its lifecycle.
  await page.evaluate(async () => {
    const { all } = await import('./src/settings.js'), spec = all().find((s) => s.key === 'moments.lootCard').spec, run = spec.run;
    window.__momentPreviewHandles = [];
    spec.run = () => {
      const listeners = new Set(), add = document.addEventListener;
      document.addEventListener = function (type, fn, ...args) { if (type === 'keydown') listeners.add(fn); return add.call(this, type, fn, ...args); };
      const trigger = document.activeElement;
      let h; try { h = run(); } finally { document.addEventListener = add; } if (!h) return h;
      h.triggerConnected = trigger?.isConnected;
      h.nativeCloses = 0; h.unsubscribes = 0; h.unsubsExpected = h.reward.state.unsubs.length; h.keyRemoves = 0; h.keysExpected = listeners.size;
      const remove = document.removeEventListener; document.removeEventListener = function (type, fn, ...args) {
        if (type === 'keydown' && listeners.has(fn)) h.keyRemoves++; return remove.call(this, type, fn, ...args);
      };
      const close = h.dialog.close.bind(h.dialog); h.dialog.close = (...args) => { h.nativeCloses++; return close(...args); };
      h.reward.state.unsubs = h.reward.state.unsubs.map((fn) => () => { h.unsubscribes++; fn(); });
      window.__momentPreviewHandles.push(h); return h;
    };
  });
  const cleaned = () => page.evaluate(async () => {
    const h = window.__momentPreviewHandles.at(-1), s = h.reward.state;
    const snapshot = () => ({ dead: s.dead, timers: s.timers.size, rafs: s.rafs.size, waits: s.waiters.size,
      nativeCloses: h.nativeCloses, unsubs: h.unsubscribes, expected: h.unsubsExpected, keyRemoves: h.keyRemoves, keysExpected: h.keysExpected,
      detached: !h.dialog.isConnected && !s.ui.root.isConnected });
    const before = snapshot(); // never repair cleanup before asserting the real Close/Escape result
    h.close(); h.close(); h.reward.unmount(); // redundant requests must remain harmless
    return { before, after: snapshot() };
  });
  const cleanCheck = (name, value) => { const v = value.before; check(name, v.dead && v.detached && v.timers === 0 && v.rafs === 0 && v.waits === 0
    && v.nativeCloses === 1 && v.unsubs === v.expected && v.expected > 0 && v.keyRemoves === v.keysExpected && v.keysExpected === 1
    && JSON.stringify(value.before) === JSON.stringify(value.after), JSON.stringify(value)); };
  const read = () => page.evaluate(async () => {
    const { game: g, effects: e, post } = window.__game;
    return { time: g.simTime, paused: g.paused, progress: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites,
      preferences: [localStorage.getItem('cw.settings'), localStorage.getItem('cw.locks')],
      roster: JSON.stringify(g.units.map((u) => [u.id, u.x, u.z, u.men, u.morale, u.fatigue, u.ammo, u.order, u.path, u.facing, u.goalFacing])),
      resources: [post.renderer.info.memory.textures, post.renderer.info.memory.geometries], cues: e.moments.size,
      glow: g.selected?.momentGlow, sound: e.sound.enabled, reduced: e.reducedMotion };
  });
  await tone('Full').check(); const before = await read();
  await preview.focus(); await page.keyboard.press('Enter'); await page.evaluate(async () => new Promise((resolve) => requestAnimationFrame(resolve)));
  const full = await read(), banner = page.locator('#moment-banner');
  check('moments-xfactor-full', full.cues === 1 && full.glow && await banner.isVisible() && (await banner.textContent()).includes('X-Factor preview')
    && await preview.evaluate((n) => n === document.activeElement), 'real keyboard preview shows labelled banner/warm cue without moving focus');
  const warm = await page.evaluate(async () => {
    const h = window.__game.game.halos; let n = 0; for (let i = 0; i < h.n; i++) {
      const o = i * 4; if (h.color.array[o] > 0.9 && h.color.array[o + 1] > 0.4 && h.color.array[o + 1] < 0.8 && h.color.array[o + 2] < 0.3) n++;
    } return n;
  });
  check('moments-actual-warm-halo', warm > 0, `${warm} actual warm halo instances; shared buffer, not a label-only preview`);
  await panel(false); await shot(page, 'moments-full'); await panel(true);
  await tone('Subtle').check(); await preview.click();
  check('moments-xfactor-subtle', !(await read()).glow && await banner.getAttribute('data-style') === 'subtle', 'real toned-down choice retains static banner without warm glow');
  await panel(false); await shot(page, 'moments-subtle'); await panel(true);
  await tone('Off').check(); await preview.click();
  check('moments-xfactor-off', !(await banner.isVisible()) && (await read()).cues === 0 && !(await read()).glow, 'Off clears and refuses existing/new effects');
  await tone('Full').check(); await page.emulateMedia({ reducedMotion: 'reduce' }); await preview.click();
  check('moments-xfactor-reduced', (await read()).reduced && !(await read()).glow && await banner.getAttribute('data-style') === 'subtle', 'real media change tones the preview down');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const e = window.__game.effects; await e.unlock(); window.__momentAudioCalls = 0;
    const zzfx = e.sound.zzfx; e.sound.zzfx = (...args) => { window.__momentAudioCalls++; return zzfx(...args); };
  });
  await preview.click();
  const audioBeforeMute = await page.evaluate(async () => window.__momentAudioCalls);
  await panel(false); await page.getByRole('button', { name: 'Menu', exact: true }).click(); await page.locator('#sound-toggle').uncheck();
  await page.locator('#menu').getByRole('button', { name: 'Close', exact: true }).click(); await panel(true); await preview.click();
  check('moments-real-mute', audioBeforeMute > 0 && await page.evaluate((n) => !window.__game.effects.sound.enabled
    && window.__game.effects.momentVoice === null && window.__momentAudioCalls === n && window.__game.effects.moments.size === 1, audioBeforeMute), 'actual Menu Sound cancels the voice and suppresses new stings while keeping the cue');
  await panel(false); await page.getByRole('button', { name: 'Menu', exact: true }).click(); await page.locator('#sound-toggle').check();
  await page.locator('#menu').getByRole('button', { name: 'Close', exact: true }).click(); await panel(true);
  check('moments-unmute-no-replay', await page.evaluate((n) => window.__momentAudioCalls === n, audioBeforeMute), 'reenabling Sound does not replay a stale sting');
  await preview.click(); await page.waitForFunction(() => window.__game.effects.moments.size === 0, null, { timeout: 10000 });
  check('moments-unmute-fresh', await page.evaluate((n) => window.__momentAudioCalls === n + 1, audioBeforeMute), 'a fresh real preview can sound after unmute');
  check('moments-paused-expiry', !(await banner.isVisible()) && (await read()).paused && (await read()).time === before.time, 'presentation expires in real time while simulation stays paused');
  const stable = await read();
  check('moments-state-resources', stable.roster === before.roster && stable.time === before.time && JSON.stringify(stable.resources) === JSON.stringify(before.resources)
    && stable.progress === before.progress && stable.writes === 0, `actual field state/resources/progress preserved: ${JSON.stringify(stable.resources)}`);

  // Both early native Escape and normal reward Close must destroy the owned modal exactly once.
  const previewBefore = await read();
  await loot.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Loot-card preview', exact: true });
  check('moments-first-trigger-retained', await page.evaluate(async () => window.__momentPreviewHandles.at(-1).triggerConnected), 'first mount retains the actual trigger; settings registration does not rebuild the panel');
  await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  const escapeInitial = await page.evaluate(async () => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, class: document.activeElement?.className }));
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-key="moments.lootCard"] button'), null, { timeout: 5000 }).catch(() => {});
  check('moments-loot-early-escape', await loot.evaluate((n) => n === document.activeElement) && await page.locator('.rw').count() === 0,
    `Escape during the deal disposes preview/restores trigger; initial focus ${JSON.stringify(escapeInitial)}`);
  cleanCheck('moments-loot-early-exact-cleanup', await cleaned());
  for (let i = 0; i < 2; i++) {
    await loot.click(); await dialog.waitFor(); await page.waitForSelector('.rw .rw-card');
    const fit = await dialog.evaluate((n) => { const r = n.querySelector('.rw').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      valid: Math.abs(r.left) < 1 && Math.abs(r.right - innerWidth) < 1 && r.top >= 0 && r.bottom <= innerHeight }; });
    if (i === 0) {
      const refused = await page.evaluate(async () => { const { all } = await import('./src/settings.js'); return all().find((s) => s.key === 'moments.lootCard').spec.run() === null
        && document.querySelectorAll('.rw').length === 1 && !window.__momentPreviewHandles.at(-1).reward.state.dead; });
      check('moments-active-reward-refused', refused, 'another preview cannot unmount the live reward singleton');
    }
    const cycles = [];
    for (const key of [...Array(6).fill('Tab'), ...Array(6).fill('Shift+Tab')]) {
      await page.keyboard.press(key); cycles.push(await dialog.evaluate((n) => n.contains(document.activeElement) && getComputedStyle(document.activeElement).visibility === 'visible'));
    }
    const focus = await dialog.evaluate((n) => ({ inside: n.contains(document.activeElement), tag: document.activeElement?.tagName, id: document.activeElement?.id,
      class: document.activeElement?.className, targets: [...n.querySelectorAll('button,[tabindex="0"]')].map((b) => ({ class: b.className, text: b.textContent, disabled: b.disabled, rect: b.getBoundingClientRect().toJSON() })) }));
    check(`moments-loot-modal-${i}`, fit.valid && focus.inside && cycles.every(Boolean), `actual modal layout/focus ${JSON.stringify({ fit, focus, cycles })}`);
    await page.keyboard.press('s'); await page.waitForFunction(() => document.querySelector('.rw-primary-label')?.textContent === 'Close');
    if (i === 0) { await shot(page, 'moments-loot'); const axe = await new AxeBuilder({ page }).include('.field-loot-preview').analyze(); result.momentsLootAxe = axe.violations;
      check('moments-loot-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id))); }
    await page.locator('.rw-primary').click(); await dialog.waitFor({ state: 'detached' });
    check(`moments-loot-close-${i}`, await loot.evaluate((n) => n === document.activeElement) && await page.locator('.rw').count() === 0 && (await read()).paused,
      'reward Close cleans listeners/DOM, restores trigger and keeps field paused');
    cleanCheck(`moments-loot-close-exact-cleanup-${i}`, await cleaned());
  }
  const after = await read();
  check('moments-loot-isolated', after.progress === previewBefore.progress && after.writes === 0 && after.roster === previewBefore.roster && after.time === previewBefore.time
    && JSON.stringify(after.preferences) === JSON.stringify(previewBefore.preferences), 'repeated previews/Escape preserve exact progress, zero writes, field and preference/lock bytes before any reload');
  await page.getByRole('button', { name: 'Play the reward sequence (Victory)', exact: true }).click();
  check('moments-practice-replay-preserved', await page.locator('.rw').count() === 0 && (await read()).writes === 0 && (await page.locator('#toasts').textContent()).includes('separate reward demo'), 'existing practice replay handler remains isolated after preview host removal');

  await tone('Subtle').check(); await page.getByRole('checkbox', { name: 'Lock this: X-Factor effects', exact: true }).check();
  await page.evaluate(async () => { const s = await import('./src/settings.js'); s.set('look.xFactorStyle', 'full'); s.reset('look.xFactorStyle'); });
  check('moments-style-lock', await tone('Subtle').isChecked() && await tone('Subtle').isDisabled(), 'Lock refuses Set/Reset and disables the actual choice');
  await page.getByRole('button', { name: 'Copy settings', exact: true }).click(); const copied = await page.evaluate(async () => navigator.clipboard.readText());
  check('moments-progress-before-reload', (await read()).progress === before.progress && (await read()).writes === 0, 'all moment/loot/lock operations preserve exact progress and zero writes before reload');
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  check('moments-style-reload', await tone('Subtle').isChecked() && await tone('Subtle').isDisabled(), 'Subtle choice and lock survive reload');
  await page.getByRole('checkbox', { name: 'Lock this: X-Factor effects', exact: true }).uncheck(); await page.getByRole('button', { name: 'Reset X-Factor effects', exact: true }).click();
  await page.getByRole('button', { name: 'Paste settings', exact: true }).click(); await page.locator('#sb-paste-text').fill(copied); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  check('moments-style-transfer', await tone('Subtle').isChecked() && await tone('Subtle').isDisabled(), 'actual Copy/Paste restores choice and lock');
  await page.getByRole('checkbox', { name: 'Lock this: X-Factor effects', exact: true }).uncheck(); await page.getByRole('button', { name: 'Reset X-Factor effects', exact: true }).click();
  check('moments-style-reset', await tone('Full').isChecked() && !(await tone('Full').isDisabled()) && (await read()).progress === before.progress && (await read()).writes === 0, 'Reset returns Full while progress stays exact');

  await page.setViewportSize({ width: 320, height: 480 }); await preview.scrollIntoViewIfNeeded();
  const targets = await page.locator('[data-key="moments.xFactor"], [data-key="moments.lootCard"], [data-key="look.xFactorStyle"]').evaluateAll((rows) => rows.map((n) => {
    const r = n.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth && n.scrollWidth <= n.clientWidth,
      controls: [...n.querySelectorAll('button,label.sb-opt,label.sb-lock')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const b = c.getBoundingClientRect(); return [b.width, b.height]; }) };
  }));
  check('moments-targets-narrow', targets.length === 3 && targets.every((r) => r.fits && r.controls.length && r.controls.every(([w, h]) => w >= 44 && h >= 44)), `320px targets ${JSON.stringify(targets)}`);
  const axe = await new AxeBuilder({ page }).include('[data-key="moments.xFactor"]').include('[data-key="moments.lootCard"]').include('[data-key="look.xFactorStyle"]').analyze();
  result.momentsAxe = axe.violations; check('moments-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id))); await shot(page, 'moments-320');
  await loot.click(); await dialog.waitFor();
  check('moments-loot-narrow-first-focus', await dialog.getByRole('button', { name: 'Close preview', exact: true }).evaluate((n) => n === document.activeElement), 'short-screen preview starts on its visible Close control');
  const visibleFocus = () => dialog.evaluate((n) => {
    const b = document.activeElement, r = b.getBoundingClientRect(), s = b.closest('.rw-stage'), bounds = (s || n).getBoundingClientRect();
    return { inside: n.contains(b), visible: r.width >= 44 && r.height >= 44 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1,
      target: b.className, top: r.top, bottom: r.bottom, bounds: [bounds.top, bounds.bottom] };
  });
  await page.keyboard.press('Shift+Tab'); const reverseVisible = await visibleFocus();
  await page.keyboard.press('Tab'); const forwardVisible = await visibleFocus();
  check('moments-loot-narrow-keyboard-visible', reverseVisible.inside && reverseVisible.visible && forwardVisible.inside && forwardVisible.visible,
    `real boundary keys scroll their focused controls into view: ${JSON.stringify({ reverseVisible, forwardVisible })}`);
  await page.keyboard.press('s'); await page.waitForFunction(() => document.querySelector('.rw-primary-label')?.textContent === 'Close');
  const turnedFocus = await visibleFocus(); check('moments-loot-narrow-turn-focus', turnedFocus.inside && turnedFocus.visible, `reward's own post-turn focus remains visible: ${JSON.stringify(turnedFocus)}`);
  const readable = await dialog.evaluate((n) => {
    const card = n.querySelector('.rw-card'), stage = n.querySelector('.rw-stage'), detail = [...card.querySelectorAll('.rw-name,.rw-type,.rw-stat small,.rw-affix,.rw-effect,.rw-where')];
    return { width: card.getBoundingClientRect().width, textSizes: detail.map((d) => parseFloat(getComputedStyle(d).fontSize)),
      stageWidth: stage.clientWidth, contentWidth: stage.scrollWidth, stageHeight: stage.clientHeight, contentHeight: stage.scrollHeight };
  });
  check('moments-loot-narrow-readable', readable.width >= 220 && readable.textSizes.length > 5 && readable.textSizes.every((s) => s >= 12)
    && readable.contentWidth <= readable.stageWidth && readable.contentHeight > readable.stageHeight, `readable single card with vertical scrolling: ${JSON.stringify(readable)}`);
  await page.locator('.rw-card').scrollIntoViewIfNeeded(); await shot(page, 'moments-loot-320');
  const narrowAxe = await new AxeBuilder({ page }).include('.field-loot-preview').analyze(); result.momentsLootNarrowAxe = narrowAxe.violations;
  check('moments-loot-narrow', narrowAxe.violations.length === 0 && await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth
    && [...n.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width).every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })), '320px preview keeps controls/contents reachable and scoped axe clear');
  await page.locator('.rw-primary').click(); await dialog.waitFor({ state: 'detached' });
  check('moments-loot-narrow-close', await loot.evaluate((n) => n === document.activeElement), 'scrolled reward Close is reachable and restores the 320px trigger');
  result.moments = { warm, before, after }; await page.setViewportSize({ width: 1280, height: 720 });
}

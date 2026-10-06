import { PNG } from 'pngjs';
import { AxeBuilder } from '@axe-core/playwright';

/** Existing sandbox, paused real scene; no product hooks or simulation stepping. */
export async function lookControls({ page, check, shot, result }) {
  await page.getByRole('tab', { name: 'Look', exact: true }).click();
  // Settle camera easing before the fixed-view comparison (slow CI may still be approaching ground height).
  // Only the actual camera API advances; battle time/units stay paused and unchanged.
  result.lookCameraSettle = await page.evaluate(() => {
    const { game, rts, camera, terrain } = window.__game;
    const before = { time: game.simTime, paused: game.paused, groundY: rts.groundY, ground: terrain.heightAt(rts.target.x, rts.target.z) };
    for (let i = 0; i < 4; i++) rts.update(1);
    camera.updateMatrixWorld(true);
    return { before, after: { time: game.simTime, paused: game.paused, groundY: rts.groundY } };
  });
  const live = () => page.evaluate(() => {
    const { game, post, effects, rts } = window.__game;
    return { saturation: post.finalMat.uniforms.uSaturation.value, tilt: post.finalMat.uniforms.uTilt.value,
      exposure: post.finalMat.uniforms.uExposure.value, targets: [post.rtScene, post.rtSmall, post.rtBlur].map((t) => [t.uuid, t.width, t.height]),
      canvas: [post.renderer.domElement.width, post.renderer.domElement.height], textures: post.renderer.info.memory.textures,
      smoke: effects.smokeEnabled, visible: effects.batch.visible, reduced: effects.reducedMotion, puffs: effects.puffs,
      particles: effects.systems.reduce((n, s) => n + s.system.particleNum, 0), systems: effects.systems.length,
      progress: localStorage.getItem('cw.progress'), writes: window.__sandboxWrites,
      battle: JSON.stringify({ time: game.simTime, paused: game.paused, units: game.units.map((u) => [u.id, u.x, u.z, u.men, u.ammo, u.xp, u.order]),
        // Camera easing approaches its ground height asymptotically; bind to micrometre precision.
        target: rts.target.toArray().map((v) => Number(v.toFixed(6))), camera: window.__game.camera.matrixWorld.toArray().map((v) => Number(v.toFixed(6))) }) };
  });
  const before = await live(); result.lookBefore = before;
  check('look-defaults', before.saturation === 0.86 && before.tilt === 0.9 && before.exposure === 0.66 && before.smoke && !before.reduced && before.visible,
    'actual Post .86/.9/exposure .66 and visible smoke-on match retained defaults');
  const sample = async () => PNG.sync.read(await page.locator('#battlefield').screenshot());
  const difference = (a, b) => {
    let changed = 0, sampled = 0;
    for (let y = 110; y < a.height - 200; y += 3) for (let x = 50; x < a.width - 80; x += 3) {
      const i = (y * a.width + x) * 4; sampled++;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 8) changed++;
    }
    return { changed, sampled, fraction: changed / sampled };
  };
  await page.locator('#sb-toggle').click(); const baseline = await sample(); await shot(page, 'look-default-field');
  await page.locator('#sb-toggle').click();
  const sat = page.getByRole('slider', { name: 'Colour saturation', exact: true }); await sat.focus(); await page.keyboard.press('Home');
  const muted = await live(); await page.locator('#sb-toggle').click(); const mutedPng = await sample(); await shot(page, 'look-muted-field'); await page.locator('#sb-toggle').click();
  const satDiff = difference(baseline, mutedPng);
  check('look-saturation-rendered', muted.saturation === 0 && satDiff.fraction > 0.02, `real keyboard slider .86 -> 0; ${JSON.stringify(satDiff)}`);
  await page.getByRole('button', { name: 'Reset Colour saturation', exact: true }).click();
  const tilt = page.getByRole('slider', { name: 'Tilt-shift blur', exact: true }); await tilt.focus(); await page.keyboard.press('Home');
  const sharp = await live(); await page.locator('#sb-toggle').click(); const sharpPng = await sample(); await shot(page, 'look-sharp-field'); await page.locator('#sb-toggle').click();
  const tiltDiff = difference(baseline, sharpPng);
  check('look-tilt-rendered', sharp.tilt === 0 && tiltDiff.fraction > 0.002, `real keyboard slider .9 -> 0; ${JSON.stringify(tiltDiff)}`);
  await page.getByRole('button', { name: 'Reset Tilt-shift blur', exact: true }).click();
  await page.locator('#sb-toggle').click(); const restoredPng = await sample(); await page.locator('#sb-toggle').click(); const restored = await live();
  const restoreDiff = difference(baseline, restoredPng); result.lookRestored = restored;
  check('look-default-render-restored', restoreDiff.fraction < 0.01 && restored.battle === before.battle,
    `fixed paused camera/roster/orders/time, restored defaults: ${JSON.stringify(restoreDiff)}`);
  check('look-no-target-allocation', [muted, sharp, restored].every((s) => JSON.stringify(s.targets) === JSON.stringify(before.targets)
    && JSON.stringify(s.canvas) === JSON.stringify(before.canvas) && s.textures === before.textures && s.exposure === 0.66),
  `actual target identities/dimensions, canvas and ${before.textures} GPU textures unchanged`);
  result.lookPixels = { saturation: satDiff, tilt: tiltDiff, restored: restoreDiff };

  const smoke = page.getByRole('switch', { name: 'Battle smoke', exact: true });
  const puff = () => page.evaluate(() => { const { effects, scene } = window.__game; effects.puff(0, 0); scene.updateMatrixWorld(true); effects.update(0.1); });
  await puff(); const on = await live();
  await smoke.focus(); await page.keyboard.press('Space'); const off = await live(); await puff(); const suppressed = await live();
  check('look-smoke-clear-off', on.particles > 0 && !off.visible && off.particles === 0 && suppressed.puffs === off.puffs && suppressed.particles === 0 && off.systems === 200,
    `actual particle counts ${on.particles} -> ${off.particles}; disabled emissions suppressed, pool ${off.systems}`);
  await smoke.check();
  await page.evaluate(() => window.__game.effects.puff(0, 0, false, 2)); const queued = await live();
  await smoke.uncheck(); await smoke.check(); await page.waitForTimeout(2200); const cancelled = await live();
  await puff(); const newPuff = await live();
  check('look-smoke-delayed-reenable', cancelled.visible && cancelled.particles === 0 && cancelled.puffs === queued.puffs && newPuff.puffs === queued.puffs + 1 && newPuff.particles > 0,
    'off/on cancels pre-disable timer; on permits a newly requested puff');
  await page.evaluate(() => window.__game.effects.puff(0, 0, false, 2));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => window.__game.effects.reducedMotion);
  const reduced = await live(); await puff();
  await smoke.uncheck(); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => !window.__game.effects.reducedMotion);
  const stillOff = await live(); await smoke.check(); await page.waitForTimeout(2200); const motionRestored = await live();
  check('look-reduced-motion', !reduced.visible && reduced.particles === 0 && !stillOff.visible && stillOff.particles === 0
    && motionRestored.visible && motionRestored.particles === 0 && motionRestored.puffs === reduced.puffs,
  'real media change clears/suppresses; preference off remains off; restored motion/on never revives old timers');

  await sat.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await tilt.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await smoke.uncheck();
  for (const name of ['Colour saturation', 'Tilt-shift blur', 'Battle smoke']) await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).check();
  const locked = await live();
  await page.evaluate(async () => { const S = await import('./src/settings.js'); S.set('look.saturation', 1.5); S.set('look.tiltShift', 1); S.set('look.smoke', true);
    S.reset('look.saturation'); S.reset('look.tiltShift'); S.reset('look.smoke'); });
  const kept = await live();
  check('look-lock', kept.saturation === 0.01 && kept.tilt === 0.05 && !kept.smoke && kept.saturation === locked.saturation
    && await sat.isDisabled() && await tilt.isDisabled() && await smoke.isDisabled()
    && await page.getByRole('button', { name: 'Reset Battle smoke', exact: true }).isDisabled(), 'locks retain all three values against Set/Reset and disable actual controls');
  await page.getByRole('button', { name: 'Copy settings', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check('look-copy', ['look.saturation = 0.01', 'look.tiltShift = 0.05', 'look.smoke = false'].every((s) => copied.includes(s))
    && ['look.saturation', 'look.tiltShift', 'look.smoke'].every((key) => copied.split('\n').find((s) => s.startsWith('locked:'))?.slice(7).split(',').map((s) => s.trim()).includes(key)), 'actual settings clipboard carries three values and locks');
  await page.reload(); await page.waitForFunction(() => window.__ready && document.getElementById('sb-panel'), null, { timeout: 180000 });
  const loaded = await live();
  check('look-reload', loaded.saturation === 0.01 && loaded.tilt === 0.05 && !loaded.smoke && !loaded.visible
    && await sat.isDisabled() && await smoke.isDisabled() && loaded.progress === before.progress && loaded.writes === 0,
  'new Post/Effects read saved values/locks; exact completed progress remains unchanged');
  for (const name of ['Colour saturation', 'Tilt-shift blur', 'Battle smoke']) {
    await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck(); await page.getByRole('button', { name: `Reset ${name}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Paste settings', exact: true }).click(); await page.locator('#sb-paste-text').fill(copied);
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); const transferred = await live();
  check('look-paste', transferred.saturation === 0.01 && transferred.tilt === 0.05 && !transferred.smoke && await sat.isDisabled(), 'real paste reinstates all three settings/locks');
  for (const name of ['Colour saturation', 'Tilt-shift blur', 'Battle smoke']) {
    await page.getByRole('checkbox', { name: `Lock this: ${name}`, exact: true }).uncheck(); await page.getByRole('button', { name: `Reset ${name}`, exact: true }).click();
  }
  const final = await live();
  check('look-progress-defaults-restored', final.saturation === 0.86 && final.tilt === 0.9 && final.smoke && final.visible && final.progress === before.progress && final.writes === 0,
    'Reset restores all defaults with zero progress writes');
  await page.setViewportSize({ width: 320, height: 720 });
  for (const key of ['look.saturation', 'look.tiltShift', 'look.smoke']) {
    const row = page.locator(`[data-key="${key}"]`); await row.scrollIntoViewIfNeeded();
    const targets = await row.locator('input[type=range], .sb-switch, .sb-btn, .sb-lock').evaluateAll((nodes) => nodes.map((n) => { const b = n.getBoundingClientRect(); return { w: b.width, h: b.height }; }));
    const fits = await page.locator('#sb-panel').evaluate((n) => n.scrollWidth <= n.clientWidth && n.querySelector('.sb-body').scrollWidth <= n.querySelector('.sb-body').clientWidth);
    check(`look-targets-${key}`, targets.length >= 3 && targets.every((b) => b.w >= 44 && b.h >= 44) && fits, `320px targets ${JSON.stringify(targets)}, panel fits ${fits}`);
    await shot(page, `look-${key.split('.')[1]}-320`);
  }
  const axe = await new AxeBuilder({ page }).include('#sb-panel').analyze();
  result.lookAxe = axe.violations.map((v) => ({ id: v.id, impact: v.impact }));
  check('look-axe', axe.violations.length === 0, JSON.stringify(result.lookAxe));
  await page.setViewportSize({ width: 1280, height: 720 });
}

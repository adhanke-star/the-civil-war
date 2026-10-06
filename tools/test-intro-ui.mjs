// Unforced introductory play: actual Continue/select/drag/fight/result/loot/save, no clock or casualty edits.
// Separate controlled ownership fixtures below never stand in for introductory timing/play acceptance.
import { AxeBuilder } from '@axe-core/playwright';

export async function introPlay({ browser, url, check, shot, result, watchErrors, native = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', hasTouch: true });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const load = async () => { await page.goto(`${url}?quality=low`, { waitUntil: 'load' }); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 }); };
  const state = () => page.evaluate(() => {
    const { game: g, practice: p } = window.__game;
    return { time: g.simTime, paused: g.paused, speed: g.speed, over: g.over, result: g.result,
      units: g.units.map((u) => ({ id: u.id, side: u.side, x: u.x, z: u.z, men: u.men, shots: u.shots || 0, state: u.state })),
      held: g.fieldCaptures.held(), outcome: p.outcome };
  });
  try {
    await load();
    const first = await state();
    check('intro-fresh-entry', first.time === 0 && first.paused && first.units.length === 3 && first.units.filter((u) => u.side === 'US').length === 2
      && await page.locator('#intro-start').evaluate((n) => n === document.activeElement), 'fresh default entry pauses two fictional brigades vs one approach, Continue focused');
    const a = await new AxeBuilder({ page }).include('#intro').analyze(); result.introBriefingAxe = a.violations;
    check('intro-briefing-axe', a.violations.length === 0, JSON.stringify(a.violations.map((v) => v.id))); await shot(page, 'intro-briefing');
    await page.setViewportSize({ width: 320, height: 480 });
    check('intro-briefing-narrow', await page.locator('#intro').evaluate((n) => {
      const b = n.querySelector('button'), r = b.getBoundingClientRect();
      return n.scrollWidth <= n.clientWidth && r.height >= 48 && r.x >= 0 && r.right <= innerWidth;
    }), '320px briefing keeps text within the dialog and a >=48px primary action');
    await shot(page, 'intro-briefing-320'); await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => { window.__introCaptures = []; window.__game.game.on('event', (e) => { if (e.kind === 'capture') window.__introCaptures.push({ side: e.side, text: e.text }); }); });
    const renderer = await page.evaluate(() => {
      const gl = document.getElementById('battlefield').getContext('webgl2'), e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    if (native) check('intro-native-renderer', !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
    const started = Date.now();
    await page.locator('#intro-start').click();
    check('intro-continue-focus', await page.locator('#battlefield').evaluate((n) => n === document.activeElement)
      && !await page.locator('#intro').evaluate((n) => n.open), 'Continue starts battle and returns keyboard focus to the field');
    await page.getByRole('button', { name: /^1st Practice Brigade/ }).focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('intro-hint').textContent.startsWith('2'));
    const flag = page.getByRole('button', { name: /^1st Practice Brigade/ }), box = await flag.boundingBox();
    const dest = await page.evaluate(() => {
      const { camera, terrain } = window.__game, v = camera.position.clone().set(-350, terrain.heightAt(-350, -665), -665).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    });
    if (!box) throw new Error('intro flag not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(dest.x, dest.y, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(() => window.__game.game.orders > 0 && document.getElementById('intro-hint').textContent.startsWith('3'));
    check('intro-drag-command', await page.evaluate(() => window.__game.game.orders > 0 && document.getElementById('intro-hint').textContent.startsWith('3')),
      'actual drag issues a march and progresses contextual hints');
    await page.waitForFunction(() => window.__game.game.fieldCaptures.held().length > 0 || window.__game.game.over, null, { timeout: 240000 });
    const mid = await state();
    check('intro-real-capture', mid.held.some((c) => c.id === 'near-stores')
      && await page.evaluate(() => window.__introCaptures.some((e) => e.side === 'US')), 'living brigade marched onto forward stores; actual capture event retains Union side; no injected ownership');
    check('intro-crate-labels-clear', await page.evaluate(() => {
      const flags = [...document.querySelectorAll('.marker:not(.hidden)')].map((n) => n.getBoundingClientRect());
      const crates = [...document.querySelectorAll('.field-crate:not([hidden])')];
      return crates.length === 2 && crates.every((n) => {
        const r = n.getBoundingClientRect(); return flags.every((f) => r.left >= f.right || r.right <= f.left || r.top >= f.bottom || r.bottom <= f.top);
      });
    }), 'offset labels retain true-ground anchors without obscuring brigade information');
    await shot(page, 'intro-capture');
    await page.waitForFunction(() => window.__game.game.over && document.getElementById('result').open, null, { timeout: 240000 });
    const end = await state(), resultMs = Date.now() - started;
    check('intro-real-fight', end.units.some((u) => u.side === 'US' && u.shots > 0) && end.units.some((u) => u.side === 'CS' && u.shots > 0)
      && end.units.some((u) => u.men < first.units.find((v) => v.id === u.id).men), 'both sides fired and real casualties carry into the terminal army');
    check('intro-play-win', end.result.winner === 'US' && end.outcome.army.length === 2 && end.paused
      && end.outcome.summary.surviving + end.outcome.summary.losses === 2000, `instructed play wins at ${end.time.toFixed(2)} sim s, ${resultMs} wall ms; no forced state`);
    const freeze = await page.evaluate(() => {
      const { game: g, practice: p } = window.__game, before = JSON.stringify(p.outcome), c = g.fieldCaptures.crates.find((v) => v.owner === 'US');
      if (!c || !p.outcome.captures.length) return false;
      const owner = c.owner; c.owner = 'CS'; const ok = JSON.stringify(p.outcome) === before; c.owner = owner; return ok;
    });
    check('intro-terminal-freeze', freeze, 'separate post-terminal ownership mutation cannot rebase the actually captured reward; original owner restored');
    await page.getByRole('button', { name: 'Open the loot', exact: true }).click();
    await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.waitForSelector('.rw[data-step="b"]');
    await page.waitForFunction(() => window.__game.practice.reward.state.dealt > 0);
    await page.locator('.rw-card[data-i="0"]').click();
    await page.waitForFunction(() => window.__game.practice.reward.state.up[0]);
    const firstCardMs = Date.now() - started;
    result.introPlay = { renderer, native, resultMs, firstCardMs, simTime: end.time, first, end };
    check('intro-first-card-timing', end.time >= 44 && end.time <= 46 && (!native || firstCardMs <= 90000),
      `first revealed loot card ${firstCardMs} wall ms after Continue; native timing gate ${native ? 'RUN' : 'UNRUN (software renderer)'}; 45 sim s unchanged`);
    check('intro-capture-loot-once', await page.evaluate(() => {
      const { practice: p } = window.__game, s = p.reward.state;
      return s.captures.length === p.outcome.captures.length && s.cards.filter((c) => c.source === 'capture').length === p.outcome.captures.length;
    }), 'one card per finally held unique crate, opened after battle');
    await page.keyboard.press('s'); await page.getByRole('button', { name: /^Issue to brigades/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.reward.state.counting);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const saved = await page.evaluate(() => window.__game.practice.saved);
    check('intro-actual-save', saved && saved.army.length === 2 && saved.army.reduce((n, b) => n + b.men, 0) === end.outcome.summary.surviving,
      'real survivors and captured issue reach the atomic completed store');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL(/reward\.html/); await page.getByRole('button', { name: 'Resume saved army', exact: true }).click();
    await page.waitForSelector('.rw[data-step="d"]');
    check('intro-continue-no-roll', await page.evaluate((id) => window.__reward.state.awardId === id && window.__reward.state.army.length === 2 && window.__reward.state.cards.length === 0, saved.awardId),
      'Continue/reload resumes the actual introductory army without another award');

    // Distinct fresh session, same default setup, no orders and no altered state: passive play must fail.
    await load(); await page.locator('#intro-start').click();
    await page.waitForFunction(() => window.__game.game.over, null, { timeout: 240000 });
    const idle = await state(); result.introIdle = idle;
    check('intro-idle-defeat', idle.result.winner === 'CS' && idle.time < 45 && idle.outcome.grade === 'Defeat',
      `unopposed approach breaches held ground at ${idle.time.toFixed(2)} sim s; no scripted win`);
    await shot(page, 'intro-idle-defeat');

    // Keyboard and emulated touch destinations use the normal group-order seam, while truly paused.
    await load(); await page.keyboard.press('Escape');
    check('intro-escape-focus', await page.locator('#battlefield').evaluate((n) => n === document.activeElement)
      && !await page.locator('#intro').evaluate((n) => n.open), 'Escape safely begins the briefing and returns focus');
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: /^1st Practice Brigade/ }).focus(); await page.keyboard.press('Enter');
    await page.locator('#capture-count').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-crate-order="near-stores"]').focus(); await page.keyboard.press('Enter');
    const keyboardOrder = await page.evaluate(() => {
      const g = window.__game.game, o = g.selected.order;
      return { paused: g.paused, type: o.type, dest: o.dest, focus: document.activeElement.id };
    });
    check('intro-keyboard-stores', keyboardOrder.paused && keyboardOrder.type === 'move'
      && keyboardOrder.dest[0] === -350 && keyboardOrder.dest[1] === -665 && keyboardOrder.focus === 'battlefield',
      `keyboard selection/Crates/March sets the same destination while paused, focus returns: ${JSON.stringify(keyboardOrder)}`);
    await page.locator('#capture-count').tap();
    const touch = page.locator('[data-crate-order="far-stores"]');
    check('intro-stores-touch-target', await touch.evaluate((n) => { const r = n.getBoundingClientRect(); return r.height >= 48 && r.width >= 48; }), 'store march target >=48 CSS pixels');
    await touch.tap();
    check('intro-touch-stores', await page.evaluate(() => {
      const g = window.__game.game; return g.paused && g.selected.order.dest[0] === -190 && g.selected.order.dest[1] === -540;
    }), 'emulated touch uses the same march destination; no physical iPad claim');
    await page.locator('#capture-count').click();
    const storesAxe = await new AxeBuilder({ page }).include('#field-stores').analyze(); result.introStoresAxe = storesAxe.violations;
    check('intro-stores-axe', storesAxe.violations.length === 0, JSON.stringify(storesAxe.violations.map((v) => v.id))); await shot(page, 'intro-stores');
    await page.keyboard.press('Escape');
    check('intro-stores-close-focus', await page.locator('#capture-count').evaluate((n) => n === document.activeElement)
      && await page.locator('#field-stores').evaluate((n) => n.hidden), 'Escape closes stores and returns focus to Crates');

    // Controlled capture fixtures: do not confuse these with the unforced timing runs above.
    const fixtures = await page.evaluate(async () => {
      const { FieldCaptures } = await import('./src/franchise/captures.js');
      const c = new FieldCaptures(window.__game.game.scenario.crates), def = c.crates[0];
      const unit = (side) => ({ side, x: def.x, z: def.z, men: 100, state: 'steady', alive: true });
      const step = (us) => { let events = []; for (let i = 0; i < 40; i++) events.push(...c.step(us, 0.05)); return events; };
      const captured = step([unit('US')]), held = c.held(); step([unit('US'), unit('CS')]); const contested = c.held();
      const retaken = step([unit('CS')]), lost = c.held(); step([unit('US')]); const recovered = c.held();
      return { captured, held, contested, retaken, lost, recovered };
    });
    check('intro-contest-retake', fixtures.captured.length === 1 && fixtures.captured[0].side === 'US' && fixtures.held.length === 1
      && fixtures.contested.length === 0 && fixtures.retaken[0].side === 'CS' && fixtures.retaken[0].previous === 'US'
      && fixtures.lost.length === 0 && fixtures.recovered.length === 1, 'separate ownership fixture proves interruption, retake and no duplicate records');
    check('intro-no-console-errors', errors.length === 0, errors.join('\n') || '0 errors');
  } finally { await ctx.close(); }
}

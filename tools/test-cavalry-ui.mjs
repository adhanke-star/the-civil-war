// Browser check: cavalry through the real UI (src/ui/hud.js marker and card row, index.html Dismount button, the N key in
// src/ui/input.js, Game.spawnUnit type 'cavalry', the MountPool horses). Runs in tools/test.mjs shard 4 and alone with
// `node tools/test.mjs --cavalry`. A generic Union cavalry regiment is placed in the sandbox: it shows mounted (one horse
// per figure, a horseshoe on its flag, "Mounted" on the card); the card's Dismount button dismounts it (the card counts
// down, then only the horse-holders ride, each leading three horses); N remounts it; an infantry brigade hides the row
// and N does nothing to it. Axe on the card, screenshots mounted and dismounted, no console errors.
import { AxeBuilder } from '@axe-core/playwright';

const frames = (page, n = 2) => page.evaluate((n) => new Promise((resolve) => {
  const step = (k) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
}), n);

export async function cavalryControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(180000);
  watchErrors(page, url, errors);
  const evidence = result.cavalry = {};
  const record = (name, ok, data) => { evidence[name] = data; check('cavalry-ui-' + name, ok, JSON.stringify(data).slice(0, 1200)); };
  const read = () => page.evaluate(() => {
    const { game } = window.__game, c = game.units.find((u) => u.type === 'cavalry');
    const btn = document.getElementById('dismount-btn'), row = document.getElementById('uc-cav');
    const alive = c ? c.figures.filter((f) => f.alive) : [];
    return { selected: game.selected?.id ?? null, id: c?.id ?? null, mounted: c?.mounted ?? null, switching: c?.switching ? { ...c.switching } : null,
      figures: alive.length, riders: alive.filter((f) => f.clip === 'ride').length, holders: alive.filter((f) => f.holder).length,
      horses: game.mountsDrawn(), row: !!row && !row.hidden && row.getClientRects().length > 0, text: document.getElementById('uc-mount')?.textContent ?? '',
      button: btn ? { disabled: btn.disabled, pressed: btn.getAttribute('aria-pressed'), visible: btn.getClientRects().length > 0 } : null,
      orders: document.querySelectorAll('#orders button').length, focus: document.activeElement?.id || document.activeElement?.tagName,
      toasts: [...document.querySelectorAll('#toasts p')].map((p) => p.textContent) };
  });
  // the card and markers refresh four times a second: wait for what should show (a timeout falls through to the check)
  const settle = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => {});
  const flag = (name) => page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) });
  const select = async (name) => { await flag(name).focus(); await page.keyboard.press('Enter'); await frames(page); };
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
    // a generic regiment behind the Union line, far from the Confederates
    const placed = await page.evaluate(() => {
      const { game, rts } = window.__game, f = game.units.find((u) => u.id === 'franklin');
      const u = game.spawnUnit({ side: 'US', type: 'cavalry', men: 600, weapon: 'carbine', x: f.x - 380, z: f.z - 40, facing: Math.PI / 2 });
      if (u) { rts.flyTo(u.x + 40, u.z, 300); rts.snap(); }
      return u ? { id: u.id, short: u.short, type: u.type, weapon: u.weapon } : null;
    });
    if (!placed) throw new Error('the sandbox refused a cavalry regiment');
    await settle((short) => [...document.querySelectorAll('.marker')].some((m) => m.querySelector('.nm')?.textContent === short
      && /mounted/.test(m.getAttribute('aria-label') || '')) && window.__game.game.mountsDrawn() > 0, placed.short);

    // ---- mounted --------------------------------------------------------------------------------------------
    const marker = await flag(placed.short).evaluate((m) => ({ horseshoe: !!m.querySelector('svg path[d^="M2.2 33"]'), label: m.getAttribute('aria-label') || m.title }));
    await select(placed.short);
    const mounted = await read();
    record('mounted', mounted.selected === placed.id && mounted.mounted === true && mounted.horses === mounted.figures && mounted.riders === mounted.figures
      && mounted.figures > 0 && marker.horseshoe && /mounted/.test(marker.label), { placed, marker, ...mounted });
    record('card-mounted', mounted.row && /^Mounted: carbines/.test(mounted.text) && mounted.button?.visible && !mounted.button.disabled
      && mounted.button.pressed === 'false' && mounted.orders === 6, mounted);
    await axe('card', '#unitcard');
    await shot(page, 'cavalry-mounted');

    // ---- the Dismount button -----------------------------------------------------------------------------------
    await page.locator('#dismount-btn').scrollIntoViewIfNeeded();
    await page.locator('#dismount-btn').click();
    await frames(page, 2);
    const switching = await read();
    record('dismount-click', switching.switching?.to === 'dismounted' && /^Dismounting/.test(switching.text) && switching.button?.disabled
      && switching.button.pressed === 'true', switching);
    await page.evaluate(() => window.__game.game.fastForward(16));
    await settle(() => /^Dismounted/.test(document.getElementById('uc-mount').textContent));
    await frames(page, 2);
    const afoot = await read();
    record('dismounted', afoot.mounted === false && !afoot.switching && afoot.riders === afoot.holders && afoot.holders > 0
      && afoot.horses === afoot.holders * 4 && afoot.riders < mounted.riders, afoot);
    record('card-dismounted', /^Dismounted: carbines, 300 m/.test(afoot.text) && afoot.button?.pressed === 'true' && !afoot.button.disabled, afoot);
    await shot(page, 'cavalry-dismounted');

    // ---- N remounts ------------------------------------------------------------------------------------------
    await page.locator('#battlefield').focus();
    await page.keyboard.press('n');
    await settle(() => /^Remounting/.test(document.getElementById('uc-mount').textContent));
    const remounting = await read();
    await page.evaluate(() => window.__game.game.fastForward(21));
    await settle(() => /^Mounted/.test(document.getElementById('uc-mount').textContent));
    await frames(page, 2);
    const back = await read();
    record('key-remount', remounting.switching?.to === 'mounted' && /^Remounting/.test(remounting.text) && back.mounted === true && !back.switching
      && back.horses === back.figures && back.riders === back.figures && /^Mounted/.test(back.text) && back.button?.pressed === 'false', { remounting, back });

    // ---- infantry: no cavalry row, N does nothing ----------------------------------------------------------------
    await select('Franklin');
    await page.locator('#battlefield').focus();
    const before = await page.evaluate(() => { const f = window.__game.game.units.find((u) => u.id === 'franklin'); return { order: f.order.type, mounted: 'mounted' in f }; });
    await page.keyboard.press('n');
    await frames(page, 2);
    const inf = await read();
    const after = await page.evaluate(() => { const f = window.__game.game.units.find((u) => u.id === 'franklin'); return { order: f.order.type, mounted: 'mounted' in f }; });
    record('infantry', inf.selected === 'franklin' && !inf.row && after.order === before.order && !after.mounted
      && inf.toasts.some((t) => /Only cavalry can dismount/.test(t)), { inf, before, after });
    record('errors', errors.length === 0, errors.slice(0, 6));
  } finally {
    await ctx.close().catch(() => {});
  }
}

// Browser check: commanders and regiments through the real page (src/game.js "Command", src/ui/hud.js general
// markers, card command line, regiment list and tooltip, src/units/mounts.js RallyRings, soldier-mesh.js FlagPool).
// Runs in tools/test.mjs shard 3 and alone with `node tools/test.mjs --command`. On the Henry Hill sandbox a
// fictional general (labelled "test only") is added over Franklin and Willcox: his mounted figure and star marker
// show; his rally ring shows with Franklin selected and with the general selected, and hides otherwise; hovering a
// regiment block on the field and focusing the card's regiment list name the regiment; a forced kill of Franklin's
// commander (a fictional test event, Game.commanderDown) shows "Commander down" on the card and marker; axe and
// screenshots. Outranged (v5 LEG B, src/sim/combat.js OUTRANGED): Hampton's rifled line is set 219 m from Willcox's
// smoothbore line (a fictional test placement, not the battle); after 13 s of fire Willcox's marker reads "Outranged" and
// exactly one hint toast names a Union formation that is Outranged (Willcox, or another line the Confederate guns outrange);
// no Confederate (computer) marker reads Outranged. Writes screenshots only (through `shot`).
import { AxeBuilder } from '@axe-core/playwright';

const frames = (page, n = 2) => page.evaluate((n) => new Promise((resolve) => {
  const step = (k) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
}), n);

export async function commandControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(180000);
  watchErrors(page, url, errors);
  const evidence = result.command = {};
  const record = (name, ok, data) => { evidence[name] = data; check('command-ui-' + name, ok, JSON.stringify(data).slice(0, 1200)); };
  const read = () => page.evaluate(() => {
    const { game, hud } = window.__game, st = game.commandState(), c = game.commanders.find((v) => v.id === 'test-general');
    const f = game.units.find((u) => u.id === 'franklin'), tip = document.getElementById('regiment-tip');
    const marker = [...document.querySelectorAll('.marker')].find((m) => m.querySelector('.nm')?.textContent === 'Franklin');
    const gm = document.querySelector('.gmarker');
    return { selected: game.selected?.id ?? null, general: game.selectedCommander?.id ?? null, rings: st.rings.shown,
      c: c ? { x: c.x, z: c.z, horse: c.horse, down: c.down } : null, horsesUsed: game.horses.used, flags: st.flags.used,
      gmarker: gm ? { text: gm.textContent, hidden: gm.classList.contains('hidden'), label: gm.getAttribute('aria-label'), selected: gm.classList.contains('selected') } : null,
      tip: tip.hidden ? null : { text: tip.textContent, from: tip.dataset.from, regiment: Number(tip.dataset.regiment) },
      regiments: f.regiments, down: f.commandDown ? { ...f.commandDown } : null, ucName: document.getElementById('uc-name').textContent,
      ucCommand: document.getElementById('uc-command')?.hidden ? '' : document.getElementById('uc-command')?.textContent ?? '',
      ucEmpty: document.getElementById('uc-empty').hidden ? '' : document.getElementById('uc-empty').textContent,
      markerDown: !!marker?.classList.contains('cmd-down'), markerCmd: marker?.querySelector('.cmd')?.textContent ?? null,
      cdnShown: marker ? getComputedStyle(marker.querySelector('.cdn')).display !== 'none' : false,
      feed: [...document.querySelectorAll('#feed li')].map((li) => li.textContent), open: !!hud };
  });
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
    await page.evaluate(() => {
      const { game, rts } = window.__game, f = game.units.find((u) => u.id === 'franklin');
      game.addCommander({ id: 'test-general', side: 'US', name: 'Fictional general (test only)', rank: 'Brigadier General', units: ['franklin', 'willcox'],
        x: f.x - 150, z: f.z, sources: ['Test fixture, no source'], status: 'Fictional (test only)' });
      game.fastForward(4);
      const c = game.commanders[0];
      rts.flyTo((f.x + c.x) / 2, (f.z + c.z) / 2, 700); rts.snap();
    });
    await frames(page, 4);

    // ---- the general on horseback and his marker -------------------------------------------------------
    const start = await read();
    record('general-visible', !!start.c && start.c.horse >= 0 && !!start.gmarker && !start.gmarker.hidden && /Fictional general/.test(start.gmarker.label)
      && start.flags > 0, { c: start.c, gmarker: start.gmarker, flags: start.flags });
    await shot(page, 'command-general');

    // ---- the ring: with one of his brigades selected, with him selected, and not otherwise ----------------
    await page.evaluate(() => window.__game.game.select(null));
    await frames(page, 2);
    const none = await read();
    await select('Franklin');
    await frames(page, 2);
    const viaBrigade = await read();
    await page.locator('.gmarker').first().click();
    await frames(page, 2);
    const viaGeneral = await read();
    record('ring-on-selection', none.rings === 0 && viaBrigade.selected === 'franklin' && viaBrigade.rings === 1
      && viaGeneral.general === 'test-general' && viaGeneral.rings === 1 && viaGeneral.selected === null && /Fictional general/.test(viaGeneral.ucEmpty)
      && viaGeneral.gmarker.selected, { none: none.rings, brigade: viaBrigade.rings, general: viaGeneral.general, ring: viaGeneral.rings, empty: viaGeneral.ucEmpty });
    await shot(page, 'command-ring');

    // ---- regiment tooltip: hover a block on the field ------------------------------------------------------
    await select('Franklin');
    const spot = await page.evaluate(() => {
      const { game, camera, terrain } = window.__game, f = game.units.find((u) => u.id === 'franklin'), canvas = document.getElementById('battlefield');
      for (const pair of f.bearers) for (const man of pair || []) {
        if (!man) continue;
        const v = camera.position.clone().set(man.x, terrain.heightAt(man.x, man.z) + 2, man.z).project(camera);
        const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        if (x > 4 && y > 4 && x < innerWidth - 4 && y < innerHeight - 4 && document.elementFromPoint(x, y) === canvas) return { x, y, reg: man.reg };
      }
      return null;
    });
    if (!spot) throw new Error('no visible colour bearer of Franklin over the bare field');
    await page.mouse.move(spot.x - 3, spot.y - 3); await page.mouse.move(spot.x, spot.y);
    await page.waitForFunction(() => !document.getElementById('regiment-tip').hidden && document.getElementById('regiment-tip').dataset.from === 'field', null, { timeout: 5000 }).catch(() => {});
    const hovered = await read();
    const want = await page.evaluate(([x, y]) => {
      const { game, rts } = window.__game, f = game.units.find((u) => u.id === 'franklin'), p = rts.pick(x, y, document.getElementById('battlefield'));
      return p ? f.regimentAt(p.x, p.z) : -1;
    }, [spot.x, spot.y]);
    record('hover-names-regiment', !!hovered.tip && hovered.tip.from === 'field' && want >= 0 && hovered.tip.regiment === want
      && hovered.tip.text.startsWith(hovered.regiments[want]) && /Not separately orderable/.test(hovered.tip.text), { tip: hovered.tip, want, spot });
    await shot(page, 'command-tooltip');
    await page.mouse.move(4, 400);

    // ---- regiment list in the card: focus names it -------------------------------------------------------
    const item = page.locator('#uc-regiments li').nth(1);
    await item.scrollIntoViewIfNeeded();
    await item.focus();
    await frames(page, 2);
    const focused = await read();
    const described = await item.getAttribute('aria-describedby');
    record('list-focus-names-regiment', !!focused.tip && focused.tip.from === 'card' && focused.tip.regiment === 1 && focused.tip.text.startsWith(focused.regiments[1])
      && described === 'regiment-tip', { tip: focused.tip, described });
    await axe('card-regiments', '#unitcard');

    // ---- a forced kill: "Commander down" on the card and the marker ------------------------------------------
    await page.evaluate(() => { const { game } = window.__game; game.commanderDown(game.units.find((u) => u.id === 'franklin'), 'killed'); });
    await page.waitForFunction(() => /Commander down/.test(document.getElementById('uc-command')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
    await frames(page, 3);
    const down = await read();
    record('commander-down', down.down?.kind === 'killed' && /^Next in command/.test(down.ucName) && /^Commander down: .* killed\.$/.test(down.ucCommand)
      && down.markerDown && down.markerCmd === 'Commander down' && down.cdnShown && down.feed.some((t) => / is killed\./.test(t)),
    { down: down.down, ucName: down.ucName, ucCommand: down.ucCommand, markerDown: down.markerDown, cdn: down.cdnShown, feed: down.feed.slice(-2) });
    await page.evaluate(() => window.__game.game.fastForward(3));
    await frames(page, 3);
    const later = await read();
    record('commander-down-lasts', later.down?.kind === 'killed' && /Commander down/.test(later.ucCommand) && later.markerDown, { ucCommand: later.ucCommand, markerDown: later.markerDown });
    await shot(page, 'command-down');
    await axe('card-down', '#unitcard');
    await axe('general-marker', '.gmarker');

    // ---- Outranged: a rifled line 219 m from a smoothbore line (fictional placement) -------------------------------
    const setup = await page.evaluate(() => {
      const { game, rts } = window.__game, c = game.combat;
      const w = game.units.find((u) => u.id === 'willcox'), h = game.units.find((u) => u.id === 'hampton');
      // Isolate this fictional pair: otherwise Hampton chooses Griffin, the nearer target, and Willcox takes no fire.
      const edge = window.__game.terrain.half - 260;
      for (const u of game.units) {
        if (u === w || u === h) continue;
        u.manual = true; u.stop(); u.order = { type: 'hold' }; u.holdFire = true;
        u.vehicle.position.x = u.side === 'US' ? -edge : edge; u.vehicle.position.z = edge;
        u.layout(); u.snapFigures();
      }
      for (const u of [w, h]) { u.manual = true; u.stop(); u.order = { type: 'hold' }; u.holdFire = false; }
      const east = Math.atan2(h.x - w.x, h.z - w.z);
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6]) { // the first bearing with sight, starting toward Hampton's own side
        const a = east + (k * Math.PI) / 18, x = w.x + Math.sin(a) * 219, z = w.z + Math.cos(a) * 219;
        h.vehicle.position.x = x; h.vehicle.position.z = z;
        if (!c.los(h, w)) continue;
        h.facing = h.goalFacing = Math.atan2(w.x - x, w.z - z);
        w.facing = w.goalFacing = a;
        for (const u of [w, h]) { u.layout(); u.snapFigures(); }
        const men = w.men;
        game.fastForward(13);
        rts.flyTo((w.x + h.x) / 2, (w.z + h.z) / 2, 650); rts.snap();
        return { bearing: k * 10, dist: Math.round(Math.hypot(h.x - w.x, h.z - w.z)), target: h.target?.id, losses: men - w.men, outranged: w.outranged, hampton: h.outranged, reach: c.effRange(w) };
      }
      return null;
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.marker')].find((m) => m.querySelector('.nm')?.textContent === 'Willcox')?.querySelector('.act')?.textContent === 'Outranged', null, { timeout: 5000 }).catch(() => {});
    const word = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.marker')].find((x) => x.querySelector('.nm')?.textContent === 'Willcox'), r = m?.getBoundingClientRect();
      const toast = document.querySelector('#toasts p[data-hint="outranged"]');
      return { act: m?.querySelector('.act')?.textContent ?? null, shown: !!r && !m.classList.contains('hidden') && r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
        hint: toast?.textContent ?? null, hints: document.querySelectorAll('#toasts p[data-hint]').length,
        out: window.__game.game.units.filter((u) => u.side === 'US' && u.outranged).map((u) => u.short),
        enemyWords: [...document.querySelectorAll('.marker.cs .act')].filter((a) => a.textContent === 'Outranged').length };
    });
    record('outranged-word', !!setup && setup.target === 'willcox' && setup.losses > 0 && setup.outranged === true && setup.hampton === false && word.act === 'Outranged' && word.shown && word.enemyWords === 0, { setup, word });
    const named = /^(.+) is outranged: its (muskets|guns) cannot reach the line firing on it\. (Charge \(C\), fall back \(F\) or hold|Fall back \(F\) or hold)\.$/.exec(word.hint || '');
    record('outranged-hint', !!named && word.out.includes(named[1]) && word.hints === 1, { hint: word.hint, hints: word.hints, out: word.out });
    await shot(page, 'command-outranged');
    record('errors', errors.length === 0, errors.slice(0, 6));
  } finally {
    await ctx.close().catch(() => {});
  }
}

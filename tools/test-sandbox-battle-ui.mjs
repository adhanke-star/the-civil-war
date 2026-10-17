// tools/test-sandbox-battle-ui.mjs: the Battles menu's Sandbox battle in the real page (src/sim/sandbox-battle.js).
//
// 1. The title's Battles list shows the fourth section with 5 fields, 11 Union and 11 Confederate rosters and the attacker;
//    the Fight link follows every choice and the list's Command and Difficulty; keyboard order and axe are clean.
// 2. Two launches reach window.__ready with the rosters' formation counts, the clock shows no date, 40 s of battle run with
//    no page errors while the computer's attacker closes on the centre ground; screenshots sandbox-battle-<n>-opening and
//    -battle. Run to the clock's end, the result offers the after-action: one page (Done; no replay) with the grade, the
//    losses and the no-history line on its own (announced too, never "Historical battles"), and no loot. Registered in tools/test.mjs (CI shard 3, --sandbox-battle).
// 3. The opening view (v5 LEG A; src/sim/sandbox-battle.js openingView): on the opening screenshot the objective (the centre
//    ground has no flag of its own: its centre point projected through the page camera, as a 1 px box) and at least one of
//    the player's own brigade flags (their marker boxes) lie wholly inside the 1280 x 720 viewport, and the objective's
//    centre and the player's axial front (front x, z=0) project inside the viewport: for a Union defender (launch 1), a Confederate defender facing a Union
//    attack (launch 2) and a Union attacker on Henry Hill (launch 3: the opening only, screenshot sandbox-battle-3-opening;
//    its camera stands beyond the small field's edge and the top corners show the apron).

import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { rosterList, SANDBOX_PACKS, NO_HISTORY_NOTE } from '../src/sim/sandbox-battle.js';

const LAUNCHES = [
  { field: 'shiloh', us: 'shiloh.buell-attacks', cs: 'shiloh.camps-at-dawn', attacker: 'CS', side: 'US' },
  { field: 'henry-hill', us: 'shiloh.hornets-nest', cs: 'shiloh.buell-attacks', attacker: 'US', side: 'CS' },
  { field: 'henry-hill', us: 'shiloh.hornets-nest', cs: 'shiloh.buell-attacks', attacker: 'US', side: 'US', openingOnly: true },
];

export async function sandboxBattleUIControls({ browser, url, check, shot, result, watchErrors }) {
  const packs = SANDBOX_PACKS.map((id) => JSON.parse(fs.readFileSync(new URL(`../assets/packs/${id}.json`, import.meta.url), 'utf8')));
  const rosters = rosterList(packs), rows = result.sandboxBattleUI = [];
  await sandboxMenu({ browser, url, check, watchErrors });
  for (const [i, launch] of LAUNCHES.entries()) await sandboxLaunch({ browser, url, check, shot, rows, watchErrors, rosters }, i + 1, launch);
}

/** The fourth Battles section: its options, the Fight link's address, keyboard order and axe. */
async function sandboxMenu({ browser, url, check, watchErrors }) {
  const errors = [], ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watchErrors(page, url, errors);
  try {
    await page.goto(url);
    await page.click('#entry-battles');
    await page.waitForFunction(() => !document.getElementById('entry-sandbox-controls').hidden, null, { timeout: 60_000 });
    const menu = await page.evaluate(() => {
      const n = (id) => document.querySelectorAll(`#${id} option`).length;
      const sections = [...document.querySelectorAll('#entry-battle-list section')].map((s) => s.id || s.className);
      return { field: n('entry-sandbox-field'), us: n('entry-sandbox-us'), cs: n('entry-sandbox-cs'), attacker: n('entry-sandbox-attacker'),
        note: document.getElementById('entry-sandbox-note').textContent, heading: document.getElementById('entry-sandbox-heading').textContent,
        last: sections[sections.length - 1], battles: document.querySelectorAll('#entry-battle-rows section.entry-battle').length };
    });
    check('sandbox-battle-menu', menu.field === 5 && menu.us === 11 && menu.cs === 11 && menu.attacker === 2 && menu.heading === 'Sandbox battle'
      && menu.note === 'Not a historical engagement: two real rosters on a real field, placed by a game rule. No loot.' && menu.last === 'entry-sandbox' && menu.battles === 3,
    JSON.stringify(menu));
    const href = () => page.getAttribute('#entry-sandbox-fight', 'href');
    await page.selectOption('#entry-sandbox-field', 'henry-hill');
    await page.selectOption('#entry-sandbox-us', 'shiloh.hornets-nest');
    await page.selectOption('#entry-sandbox-cs', 'shiloh.buell-attacks');
    await page.selectOption('#entry-sandbox-attacker', 'US');
    const plain = await href();
    await page.selectOption('#entry-battles-side', 'CS');
    await page.selectOption('#entry-battles-difficulty', 'general');
    const both = await href();
    await page.selectOption('#entry-battles-side', 'US');
    await page.selectOption('#entry-battles-difficulty', 'veteran');
    const back = await href();
    check('sandbox-battle-link', plain === './?sandbox-battle&field=henry-hill&us=shiloh.hornets-nest&cs=shiloh.buell-attacks&attacker=US'
      && both === `${plain}&difficulty=general&side=CS` && back === plain, JSON.stringify({ plain, both, back }));
    await page.focus('#entry-sandbox-field');
    const order = [];
    for (let k = 0; k < 4; k++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.id)); }
    check('sandbox-battle-keyboard', order.join() === 'entry-sandbox-us,entry-sandbox-cs,entry-sandbox-attacker,entry-sandbox-fight', order.join());
    const axe = await new AxeBuilder({ page }).include('#entry-battle-list').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check('sandbox-battle-menu-axe', bad.length === 0 && errors.length === 0,
      bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : `0 serious/critical (${axe.violations.length} minor); ${errors.length} page errors ${JSON.stringify(errors.slice(0, 3))}`);
  } catch (error) {
    check('sandbox-battle-menu', false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
  } finally { await ctx.close(); }
}

/** One launch: the rosters on the field, 40 s of battle, then the clock's end and the after-action. */
async function sandboxLaunch({ browser, url, check, shot, rows, watchErrors, rosters }, n, launch) {
  const name = `sandbox-battle-${n}`, errors = [];
  const count = (id, side) => { const r = rosters.find((x) => x.id === id && x.side === side); return r.counts.brigades + r.counts.batteries + r.counts.cavalry; };
  const want = { US: count(launch.us, 'US'), CS: count(launch.cs, 'CS') };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watchErrors(page, url, errors);
  try {
    await page.goto(`${url}?sandbox-battle&field=${launch.field}&us=${launch.us}&cs=${launch.cs}&attacker=${launch.attacker}${launch.side === 'CS' ? '&side=CS' : ''}&quality=low`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000, polling: 250 });
    await page.waitForTimeout(2000);
    const opening = await page.evaluate(() => {
      const { game, terrain, sandboxBattle } = window.__game;
      return { params: sandboxBattle, terrain: terrain.meta.name, player: game.playerSide, ai: game.ai.side,
        US: game.units.filter((u) => u.side === 'US').length, CS: game.units.filter((u) => u.side === 'CS').length, figures: game.figureCount(),
        mode: document.getElementById('play-mode').textContent, clock: document.getElementById('clock-date').textContent,
        title: document.getElementById('menu-title').textContent, objective: document.getElementById('objective').textContent, view: view() };
      function view() {
        const { camera, hud } = window.__game, W = window.innerWidth, H = window.innerHeight, o = game.objective;
        const inside = (r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H;
        camera.updateMatrixWorld(true);
        const p = camera.position.clone().set(o.x, terrain.heightAt(o.x, o.z), o.z).project(camera);
        const ox = (p.x + 1) / 2 * W, oy = (1 - p.y) / 2 * H, objectiveBox = { left: ox, top: oy, right: ox + 1, bottom: oy + 1, width: 1, height: 1 };
        const own = game.units.filter((u) => u.side === game.playerSide && hud.markers.has(u.id)).map((u) => hud.markers.get(u.id).el)
          .filter((el) => el.isConnected && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
        const flags = own.filter((el) => inside(el.getBoundingClientRect())).length;
        // the band the HUD leaves clear, and the player's front formation (the one nearest the enemy along the field's axis)
        const band = [document.getElementById('topbar').getBoundingClientRect().bottom, document.getElementById('dock').getBoundingClientRect().top];
        const mine = game.units.filter((u) => u.side === game.playerSide), dir = game.playerSide === game.attacker ? 1 : -1;
        const front = dir > 0 ? Math.max(...mine.map((u) => u.x)) : Math.min(...mine.map((u) => u.x));
        const q = camera.position.clone().set(front, terrain.heightAt(front, 0), 0).project(camera);
        const fx = (q.x + 1) / 2 * W, fy = (1 - q.y) / 2 * H, clear = (x, y) => x >= 0 && x <= W && y >= 0 && y <= H;
        return { objective: inside(objectiveBox) && p.z > -1 && p.z < 1, objectiveAt: [Math.round(ox), Math.round(oy)], flags, ownMarkers: own.length,
          band: band.map(Math.round), frontAt: [Math.round(fx), Math.round(fy)], clear: clear(ox, oy) && clear(fx, fy) && q.z > -1 && q.z < 1,
          camera: { x: Math.round(window.__game.rts.target.x), z: Math.round(window.__game.rts.target.z), yaw: +window.__game.rts.yaw.toFixed(3), dist: Math.round(window.__game.rts.dist) } };
      }
    });
    await shot(page, `${name}-opening`);
    const run = await page.evaluate((attacker) => {
      const { game } = window.__game, t0 = game.simTime, o = game.objective;
      const att = game.units.filter((u) => u.side === attacker), dist = () => att.reduce((s, u) => s + Math.hypot(u.x - o.x, u.z - o.z), 0) / att.length;
      const before = dist();
      for (let guard = 0; guard < 200 && game.simTime - t0 < 40 && !game.over; guard++) {
        if (game.paused) game.togglePause();
        game.fastForward(Math.min(5, 40 - (game.simTime - t0)));
      }
      return { advanced: game.simTime - t0, over: game.over, closed: before - dist() };
    }, launch.attacker);
    await page.waitForTimeout(1500);
    await shot(page, `${name}-battle`);
    check(`${name}-opens`, opening.US === want.US && opening.CS === want.CS && opening.figures > 0 && opening.player === launch.side
      && opening.ai === (launch.side === 'CS' ? 'US' : 'CS') && opening.params?.field === launch.field && opening.title.startsWith('Sandbox battle · ')
      && opening.mode.startsWith('Sandbox battle · no progress rewards') && opening.clock === 'Sandbox battle' && /centre ground/.test(opening.objective),
    JSON.stringify({ want, opening }));
    check(`${name}-opening-view`, opening.view.objective && opening.view.flags >= 1 && opening.view.clear, JSON.stringify(opening.view));
    if (launch.openingOnly) { rows.push({ ...launch, opening, errors: errors.slice() }); check(`${name}-errors`, errors.length === 0, JSON.stringify(errors.slice(0, 5))); return; }
    check(`${name}-runs`, (run.advanced >= 39 || run.over) && run.closed > 10 && errors.length === 0, JSON.stringify({ run, errors: errors.slice(0, 5) }));
    // The clock's end (06:00-08:00 at 15x is 480 s of battle): the frame loop then opens the result.
    const end = await page.evaluate(() => {
      const { game } = window.__game;
      for (let guard = 0; guard < 400 && !game.over; guard++) { if (game.paused) game.togglePause(); game.fastForward(5); }
      return { over: game.over, grade: game.result?.grade ?? null };
    });
    await page.waitForFunction(() => document.getElementById('result').open && !document.getElementById('result-action').hidden, null, { timeout: 30_000 });
    const panel = await page.evaluate(() => ({ action: document.getElementById('result-action').textContent, text: document.getElementById('result-text').textContent }));
    await page.locator('#result-action').click();
    await page.waitForFunction(() => document.querySelector('.rw[data-step="a"]') && document.querySelector('.rw-live')?.textContent, null, { timeout: 30_000 });
    const aar = await page.evaluate(() => ({ grade: document.querySelector('.rw-grade')?.textContent, hint: [...document.querySelectorAll('.rw-hint')].map((p) => p.textContent).join(' | '),
      vs: !!document.querySelector('.rw-vs'), loot: document.querySelectorAll('.rw-card, .rw-crates, .rw-aar-stats, .rw-skip, .rw-deal').length,
      eyebrow: document.querySelector('.rw-eyebrow')?.textContent, line: [...document.querySelectorAll('.rw-aar-line')].map((p) => p.textContent),
      next: document.querySelector('.rw-aar .rw-primary-label')?.textContent ?? null, live: document.querySelector('.rw-live')?.textContent ?? '' }));
    await shot(page, `${name}-after-action`);
    rows.push({ ...launch, opening, run, end, panel, aar, errors: errors.slice() });
    check(`${name}-after-action`, end.over && panel.action === 'After-action' && /Sandbox battles grant no loot/.test(panel.text)
      && ['Decisive', 'Victory', 'Draw', 'Defeat'].includes(aar.grade) && aar.hint.includes(NO_HISTORY_NOTE) && !aar.vs && aar.loot === 0 && errors.length === 0
      // one page (no replay, no history page), the no-history note as its own single line, and a screen reader hears it too
      && aar.line.length === 1 && aar.line[0] === NO_HISTORY_NOTE && aar.next === 'Done' && aar.live.includes(NO_HISTORY_NOTE) && !/Historical battles/.test(aar.live),
    JSON.stringify({ end, panel, aar, errors: errors.slice(0, 5) }));
  } catch (error) {
    rows.push({ ...launch, failure: error.message, errors: errors.slice() });
    check(`${name}-opens`, false, `${error.message.split('\n')[0]} ${JSON.stringify(errors.slice(0, 5))}`);
  } finally { await ctx.close(); }
}

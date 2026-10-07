// Saved-army route proof. The first two encounters run ordinary UI orders and real frames only.
// A distinctly labelled third terminal fixture tests stale writes; it is not playable evidence.
import { promises as fs } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { SAMPLE_ARMY } from '../src/reward/data.js';
import { validateSnapshot, exportSnapshot, MAX_SAVE_BYTES } from '../src/franchise/save.js';
import { probeProgress, progressRaw, seedProgress, holdProgressTransaction, releaseProgressTransaction } from './test-progress-browser.mjs';

const copy = (v) => structuredClone(v), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function deploymentFixture() {
  const front = { ...copy(SAMPLE_ARMY[0]), id: 'saved-enemy-0', label: 'Saved Front', men: 2000,
    weapon: { uid: 'current', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Stored' } };
  const rear = { ...copy(SAMPLE_ARMY[2]), id: 'rear', label: 'Saved Rear', men: 1000,
    weapon: { uid: 'rear-arm', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Stored' } };
  const gun = { ...copy(SAMPLE_ARMY[4]), id: 'gun', label: 'Saved Battery', men: 80, guns: 2,
    weapon: { ...copy(SAMPLE_ARMY[4].weapon), uid: 'gun-arm', from: 'Stored' } };
  const army = [front, rear, gun, ...Array.from({ length: 197 }, (_, i) => ({ ...copy(i % 2 ? rear : gun),
    id: `d${i}`, label: `Dormant formation ${i + 1}`, men: 0, ...(i % 2 ? {} : { guns: i % 3 ? 0 : 2 }),
    weapon: { ...copy(i % 2 ? rear.weapon : gun.weapon), uid: `d-arm-${i}` } }))];
  const depot = [{ uid: 'target', itemId: 'enfield', tier: 'rare', conditionId: 'worn', source: 'capture',
    from: 'Game provenance '.repeat(10).trim() }, ...Array.from({ length: 1969 }, (_, i) => ({
    uid: `spare-${i}`, itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Stored' }))];
  const issued = Array.from({ length: 4999 }, (_, i) => ({ brigade: front.id,
    item: i % 2 ? 'target' : 'current', displaced: i % 2 ? 'current' : 'target' }));
  return validateSnapshot({ format: 'the-civil-war', version: 1, kind: 'completed-reward', awardId: 'saved-ui-baseline',
    seed: 'saved-ui-baseline', grade: 'Victory', army, depot, issued });
}

export async function deploymentProgress({ browser, url, check, shot, result, watchErrors, native = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', acceptDownloads: true });
  await probeProgress(ctx, { prefix: '__deploy', readFlag: '__deployReadBlocked', quotaFlag: '__deployQuota' });
  await ctx.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext, canvases = new WeakSet();
    window.__deployGpu = 0;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const value = original.call(this, kind, ...args);
      if (value && /^webgl/.test(kind) && !canvases.has(this)) { canvases.add(this); window.__deployGpu++; }
      return value;
    };
  });
  const page = await ctx.newPage(), errors = [], requests = [];
  watchErrors(page, url, errors); page.on('request', (r) => requests.push(r.url()));
  const fixture = deploymentFixture(), initial = exportSnapshot(fixture), axes = {};
  result.deploymentAxe = axes; result.deploymentFixtureBytes = Buffer.byteLength(initial);
  const verdict = (name, ok, detail) => check(`deployment-${name}`, ok, detail);
  const load = async (query = '?camp&quality=low') => {
    requests.length = 0; await page.goto(url + query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__entry && !window.__entry.importing);
  };
  const raw = () => progressRaw(page);
  const counters = () => page.evaluate(() => ({ writes: window.__deployWrites, puts: window.__progressPuts,
    gpu: window.__deployGpu, legacy: window.__progressLegacyWrites, busy: window.__entry?.importing }));
  const idle = () => page.waitForFunction(() => window.__entry && !window.__entry.importing);
  const review = async () => {
    await page.locator('#camp-deploy').click();
    await page.waitForFunction(() => document.getElementById('deploy-review')?.getAttribute('aria-busy') === 'false');
  };
  const cancelled = async () => { await idle(); return !await page.locator('#deploy-review').evaluate((n) => n.open)
    && (await counters()).gpu === 0 && await page.locator('#camp-deploy').evaluate((n) => n === document.activeElement); };
  async function axe(scope, key) {
    const a = await new AxeBuilder({ page }).include(scope).analyze();
    axes[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
    return axes[key].length === 0;
  }
  async function exported(selector) {
    const waiting = page.waitForEvent('download'); await page.locator(selector).click();
    return JSON.parse(await fs.readFile(await (await waiting).path(), 'utf8'));
  }
  async function importIn(other, snapshot) {
    await other.locator('#entry-file').setInputFiles({ name: 'other-tab-army.json', mimeType: 'application/json', buffer: Buffer.from(exportSnapshot(snapshot)) });
    await other.waitForSelector('#entry-replace[open]'); await other.locator('#entry-confirm').click();
    await other.waitForFunction(() => window.__entry && !window.__entry.importing);
  }
  const gameState = () => page.evaluate(() => {
    const { game: g, practice: p, manifest } = window.__game;
    return { time: g.simTime, over: g.over, paused: g.paused, orders: g.orders || 0, result: g.result,
      units: g.units.map((u) => ({ id: u.id, side: u.side, type: u.type, men: u.men, menMax: u.menMax,
        guns: u.guns, liveGuns: u.gunSlots?.filter((v) => v.alive).length, shots: u.shots || 0, state: u.state, alive: u.alive, equipment: u.equipment,
        profile: u.equipmentProfile, x: u.x, z: u.z, order: { type: u.order.type, dest: u.order.dest } })),
      held: g.fieldCaptures.held('US'), outcome: p.outcome, baseline: manifest.baseline, allocation: manifest.allocation };
  });
  const selectFront = async () => { await page.getByRole('button', { name: /^Saved Front:/ }).focus(); await page.keyboard.press('Enter'); };
  async function launch() {
    await review(); await page.locator('#deploy-launch').click();
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('intro').open, null, { timeout: 180000 });
  }
  async function waitLive(predicate) {
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate)) return;
      if (await page.locator('#banner-resume').isVisible()) await page.locator('#banner-resume').click();
      await page.waitForTimeout(1000);
    }
    throw new Error('Saved deployment live encounter did not reach its expected state in 240 seconds.');
  }
  async function lootStart() {
    await page.locator('#result-action').click(); await page.getByRole('button', { name: /^Open the loot/ }).click();
    await page.waitForSelector('.rw[data-step="b"]');
  }
  async function lootFinish() {
    await page.keyboard.press('s'); await page.getByRole('button', { name: 'Save and return to camp', exact: true }).click();
    await page.waitForFunction(() => !window.__game.practice.saving);
  }
  async function campAfter() {
    if (!await page.locator('#result').evaluate((n) => n.open)) await page.locator('#after-action').click();
    await page.locator('#result-action').click(); await page.waitForURL(/\?camp/); await idle();
  }
  try {
    await load(); await seedProgress(page, initial); await load();
    verdict('camp-read-only', await raw() === initial && (await counters()).writes === 0 && (await counters()).gpu === 0
      && await page.locator('#camp-army .rw-brig').count() === 12 && await page.locator('#camp-depot > [role="listitem"]').count() === 12,
    '200 formations/1970 depot/4999 valid issued records load as 12+12 camp cards, no write/GPU');
    await page.locator('#camp-depot .camp-compare-button').first().click();
    await page.waitForSelector('#camp-compare[open]'); await page.locator('#camp-recipient').selectOption(fixture.army[0].id);
    await page.locator('#camp-issue').click(); await idle();
    const equipped = JSON.parse(await raw());
    verdict('real-camp-issue', equipped.issued.length === 5000 && equipped.army[0].weapon.uid === 'target'
      && equipped.army[0].weapon.itemId === 'enfield' && equipped.army[0].weapon.conditionId === 'worn'
      && same(equipped.issued.slice(0, 4999), fixture.issued) && (await counters()).writes === 1,
    'actual compare/Issue saves the 5000th transfer; original reverse-audited prefix intact');
    await review(); const manifest = await page.evaluate(() => window.__entry.deployment.manifest);
    verdict('review-all-active-dormant', manifest.allocation.formations === 3 && manifest.dormant.length === 197
      && await page.locator('#deploy-formations li').count() === 3 && await page.locator('#deploy-dormant-names li').count() === 197
      && same(await page.locator('#deploy-dormant-names li').allTextContents(), equipped.army.slice(3).map((b) => b.label))
      && await page.locator('#deploy-formations').textContent().then((s) => s.includes('Enfield') && s.includes('worn') && s.includes('Game provenance')),
    'every active formation, actual condition/provenance and all dormant names disclosed');
    verdict('review-zero-field-write', (await counters()).gpu === 0 && (await counters()).writes === 1
      && !requests.some((r) => /\/src\/main\.js|\/terrain\//.test(r)) && await raw() === JSON.stringify(equipped),
    'pure review fetches small scenario metadata only, with zero renderer/terrain/progress mutation');
    await axe('#deploy-review', 'review'); await shot(page, 'deployment-review');
    await page.setViewportSize({ width: 320, height: 480 });
    verdict('review-narrow', await page.locator('#deploy-review').evaluate((n) => n.scrollWidth <= n.clientWidth
      && [...n.querySelectorAll('button')].filter((b) => !b.hidden).every((b) => b.getBoundingClientRect().height >= 48)),
    '320px review wraps provenance and keeps 48px actions without horizontal scroll');
    await shot(page, 'deployment-review-320');
    await page.locator('#deploy-launch').focus(); await page.keyboard.press('Tab');
    const firstFocus = await page.locator('#deploy-dormant-count').evaluate((n) => n === document.activeElement);
    await page.keyboard.press('Shift+Tab');
    verdict('review-keyboard-loop', firstFocus && await page.locator('#deploy-launch').evaluate((n) => n === document.activeElement),
    'native summary and actions stay within the review keyboard loop');
    await page.locator('#deploy-cancel').click();
    verdict('review-cancel', await cancelled() && await raw() === JSON.stringify(equipped), 'Cancel returns connected camp focus, no allocation/write');
    await page.setViewportSize({ width: 1024, height: 768 }); await review(); await page.keyboard.press('Escape');
    verdict('review-escape', await cancelled(), 'native Escape closes review and restores camp deploy focus');

    for (const [action, name] of [['click', 'read-cancel'], ['Escape', 'read-escape']]) {
      await holdProgressTransaction(page); await page.locator('#camp-deploy').click();
      if (action === 'click') verdict('read-held', await page.locator('#deploy-review').evaluate((n) => n.open && n.getAttribute('aria-busy') === 'true')
        && (await counters()).busy && (await counters()).gpu === 0 && await page.locator('#camp-deploy').isDisabled(),
      'real queued canonical read retains exclusive owner and keeps Cancel available');
      if (action === 'click') await page.locator('#deploy-cancel').click(); else await page.keyboard.press('Escape');
      const retained = (await counters()).busy; await releaseProgressTransaction(page);
      verdict(name, retained && await cancelled() && await raw() === JSON.stringify(equipped), 'cancelled held read settles before owner release, never opens a field');
    }
    let releaseModule, moduleSeen, moduleHandled;
    const seen = new Promise((r) => { moduleSeen = r; }), gate = new Promise((r) => { releaseModule = r; });
    const handled = new Promise((r) => { moduleHandled = r; });
    await page.route('**/src/main.js', async (route) => { moduleSeen(); await gate; await route.continue(); moduleHandled(); });
    await review(); await page.locator('#deploy-launch').click(); await seen;
    verdict('launch-held', (await counters()).gpu === 0 && (await counters()).busy
      && await page.locator('#deploy-launch').isDisabled() && await page.locator('#deploy-cancel').isEnabled(),
    'held main import owns launch without allocating and exposes cancellation');
    await page.locator('#deploy-launch').dispatchEvent('click');
    verdict('launch-repeat-guard', await page.evaluate(() => window.__entry.deployment.busy && !window.__game)
      && (await counters()).gpu === 0, 'repeat event cannot acquire another field or allocation');
    await page.locator('#deploy-cancel').click(); releaseModule(); await handled; await page.unroute('**/src/main.js');
    verdict('launch-cancel', await cancelled(), 'cancelled import does not call launcher or start its canonical read');
    await review(); await holdProgressTransaction(page); await page.locator('#deploy-launch').click();
    await page.waitForFunction(() => window.__entry.deployment.busy);
    await page.keyboard.press('Escape'); const heldOwner = (await counters()).busy; await releaseProgressTransaction(page);
    verdict('launch-escape', heldOwner && await cancelled(), 'Escape cancels a queued launch recheck before WebGL and releases on settlement');

    const bads = [['missing', null, 'no completed army'], ['corrupt', '{broken', 'not valid json'],
      ['unsupported', JSON.stringify({ ...equipped, version: 2 }), 'unsupported'],
      ['no-infantry', exportSnapshot({ ...equipped, army: equipped.army.map((b) => ({ ...b, men: 0 })) }), 'living infantry'],
      ['oversize', exportSnapshot({ ...equipped, army: equipped.army.map((b, i) => i < 6 ? { ...b, men: b.kind === 'battery' ? 80 : 1000, ...(b.kind === 'battery' ? { guns: 2 } : {}) } : b) }), 'exceeds'],
      ['full-depot', exportSnapshot({ ...equipped, depot: [...equipped.depot, ...Array.from({ length: 24 }, (_, i) => ({ ...equipped.depot[0], uid: `full-${i}` }))] }), 'free slots']];
    const headroom = copy(equipped);
    for (const item of [...headroom.army.map((b) => b.weapon), ...headroom.depot]) {
      const available = Math.floor((MAX_SAVE_BYTES - 512 - Buffer.byteLength(JSON.stringify(headroom))) / 6);
      if (available <= 0) break;
      item.from = '\ud800'.repeat(Math.min(160, available));
    }
    bads.push(['headroom', exportSnapshot(headroom), 'headroom'], ['blocked-read', JSON.stringify(equipped), 'cannot read']);
    for (const [name, value, message] of bads) {
      if (value === null) {
        await seedProgress(page, JSON.stringify(equipped)); await load();
        await page.evaluate(() => window.__progressFixture.clear()); requests.length = 0;
        await page.locator('#camp-deploy').click();
      } else {
        await seedProgress(page, value); requests.length = 0;
        await page.goto(url + '?camp&saved&quality=low', { waitUntil: 'load' });
      }
      if (name === 'blocked-read') {
        // First refuse the same valid profile via a real browser-storage SecurityError.
        await page.waitForFunction(() => document.getElementById('deploy-review')?.getAttribute('aria-busy') === 'false');
        await page.locator('#deploy-cancel').click(); await idle();
        await page.evaluate(() => { window.__deployReadBlocked = true; }); await page.locator('#camp-deploy').click();
      }
      await page.waitForFunction(() => document.getElementById('deploy-review')?.getAttribute('aria-busy') === 'false');
      const note = await page.locator('#deploy-note').textContent(), c = await counters();
      const refusal = note.toLowerCase().includes(message) && await page.locator('#deploy-launch').isDisabled()
        && c.gpu === 0 && c.puts === 0 && c.writes === 0 && !requests.some((r) => /\/src\/main\.js/.test(r));
      await page.keyboard.press('Escape'); await idle(); await page.evaluate(() => { window.__deployReadBlocked = false; });
      const unavailable = ['corrupt', 'unsupported', 'blocked-read'].includes(name);
      verdict(`refusal-${name}`, refusal && (!unavailable || await page.evaluate(() => window.__entry.failed)
        && await page.locator('#entry-continue').isDisabled() && await page.locator('#entry-retry').isVisible())
        && (name !== 'missing' || await page.locator('#camp-deploy').isDisabled() && !await page.locator('#entry-camp').isVisible()
          && await page.evaluate(() => window.__entry.saved === null && !window.__entry.failed)),
      `whole refusal before field import/allocation/write; failed read cancellation retains retry/import: ${note.slice(0, 150)}`);
    }
    await seedProgress(page, JSON.stringify(equipped)); await load(); await review();
    const other = await ctx.newPage(); watchErrors(other, url, errors);
    await other.goto(url + '?camp'); await other.waitForFunction(() => window.__entry?.mode === 'camp');
    const alternative = validateSnapshot({ ...equipped, awardId: 'other-tab-before-launch', seed: 'other-tab-before-launch' });
    await importIn(other, alternative); await page.locator('#deploy-launch').click();
    await page.waitForFunction(() => document.getElementById('deploy-review')?.getAttribute('aria-busy') === 'false');
    verdict('other-tab-launch-stale', await raw() === JSON.stringify(alternative) && (await counters()).gpu === 0 && (await counters()).writes === 0
      && await page.locator('#deploy-note').textContent().then((s) => s.includes('changed after deployment')),
    'genuine second-tab import invalidates reviewed launch without replacement or renderer');
    await page.keyboard.press('Escape'); await idle(); await other.close();

    await seedProgress(page, JSON.stringify(equipped));
    let releaseMetadata, metadataSeen, metadataHandled;
    const metadataGate = new Promise((r) => { releaseMetadata = r; }), metadataReady = new Promise((r) => { metadataSeen = r; });
    const metadataDone = new Promise((r) => { metadataHandled = r; });
    await page.route('**/assets/scenarios/henry-hill.json', async (route) => { metadataSeen(); await metadataGate; await route.continue(); metadataHandled(); });
    await page.goto(url + '?saved&quality=low', { waitUntil: 'domcontentloaded' }); await metadataReady;
    await page.keyboard.press('Escape'); releaseMetadata(); await metadataDone; await page.unroute('**/assets/scenarios/henry-hill.json'); await idle();
    const guard = await page.evaluate(async () => {
      const { savedDeployment } = await import('./src/franchise/practice.js'), { startField } = await import('./src/main.js');
      const m = savedDeployment({ baseline: window.__entry.saved, ground: {}, awardId: 'metadata-free-guard', seed: 1 });
      try { await startField({ manifest: m }); return false; } catch (e) { return e.message.includes('complete practice ground'); }
    });
    verdict('direct-review-cancel', guard && await cancelled() && await page.evaluate(() => window.__entry.mode === 'camp')
      && await raw() === JSON.stringify(equipped), 'direct saved route cancels held metadata to camp; authentic metadata-free launch explicitly refuses before read/allocation');

    await launch(); const first = await gameState();
    const renderer = await page.evaluate(() => { const gl = document.getElementById('battlefield').getContext('webgl2'), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
    verdict('real-roster-budget', first.units.filter((u) => u.side === 'US').length === 3 && first.units.length === 4
      && first.allocation.men === 3080 && first.allocation.guns === 2 && first.time === 0 && first.paused
      && (await counters()).gpu === 1 && (!native || !/swiftshader|software|llvmpipe/i.test(renderer)), `${renderer}; one allocation, admitted actual saved men/guns`);
    verdict('dormant-off-field', first.units.every((u) => !equipped.army.slice(3).some((b) => b.id === u.id))
      && first.units.find((u) => u.side === 'CS').id !== equipped.army[0].id, '197 dormant identities remain off-field; opponent namespace avoids dormant/active collisions');
    const front = first.units.find((u) => u.id === equipped.army[0].id);
    verdict('issued-profile', same(front.equipment, equipped.army[0].weapon) && front.menMax === 2000
      && front.profile.item.itemId === 'enfield' && front.profile.condition.id === 'worn'
      && Math.abs(front.profile.rangeMetres - 300 * 0.9144) < 1e-8 && front.profile.reloadSeconds === 5
      && Math.abs(front.profile.powerMultiplier - (59 / 28) * (70 / 50) * 0.88) < 1e-10,
    'the actual Unit carries the issued worn Enfield with identical item identity/provenance');
    await axe('#intro', 'briefing'); await shot(page, 'deployment-briefing');
    await page.setViewportSize({ width: 320, height: 480 }); await shot(page, 'deployment-briefing-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#intro-start').click(); await page.getByRole('button', { name: 'Pause', exact: true }).click(); await selectFront();
    await page.keyboard.press('b'); await page.keyboard.press('ArrowUp');
    const arc = await page.evaluate(() => {
      const { arrows, game } = window.__game, u = game.selected, p = arrows.previewEnd;
      const geometry = arrows.previewGhost.children.find((m) => m.material === arrows.arcMats.US)?.geometry;
      const a = geometry?.getAttribute('position'); let far = 0;
      for (let i = 0; a && i < a.count; i++) far = Math.max(far, Math.hypot(a.getX(i) - p.x, a.getZ(i) - p.z));
      return { far, range: game.range(u), order: game.orders || 0 };
    });
    verdict('real-range-ghost', Math.abs(arc.far - arc.range) < 0.0005 && Math.abs(arc.range - 300 * 0.9144) < 0.0005 && arc.order === 0,
    `actual range geometry ${arc.far}m follows worn Enfield range ${arc.range}m; no order committed`);
    await shot(page, 'deployment-range'); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
    await page.locator('#capture-count').click(); await page.locator('[data-crate-order="near-stores"]').click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const started = Date.now();
    await waitLive(() => window.__game.game.fieldCaptures.held('US').length > 0 || window.__game.game.over);
    const captured = await gameState();
    verdict('orders-capture', captured.orders > 0 && captured.held.some((c) => c.id === 'near-stores'),
    'normal keyboard flag/Crates/March reached and captured stores; no clock, casualty or ownership edits');
    await selectFront(); await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
    await waitLive(() => window.__game.game.over); const end = await gameState();
    result.deploymentWin = { native, renderer, wallMs: Date.now() - started, first, end };
    verdict('unforced-victory', end.result.winner === 'US' && end.time > 0 && end.time < 47
      && (end.time >= 45 || end.units.filter((u) => u.side === 'CS').every((u) => !u.alive || u.state === 'routing'))
      && end.units.some((u) => u.side === 'US' && u.shots > 0) && end.units.some((u) => u.side === 'CS' && u.shots > 0)
      && end.outcome.snapshot.army.reduce((n, b) => n + b.men, 0) < 3080,
    `actual ordered encounter ${end.result.winner}, ${end.time.toFixed(2)} sim seconds, actual shots/losses`);
    const frozen = await page.evaluate(() => {
      const { game, practice } = window.__game, before = JSON.stringify(practice.outcome), u = game.units[0], men = u.men;
      u.men = 0; const unchanged = JSON.stringify(practice.outcome) === before; u.men = men;
      return unchanged && Object.isFrozen(practice.outcome) && Object.isFrozen(practice.outcome.snapshot.army);
    });
    verdict('terminal-freeze', frozen && !await page.locator('#result-text').textContent().then((s) => s.includes('first issue'))
      && !await page.locator('#feed').textContent().then((s) => s.includes('first issue'))
      && same(end.outcome.snapshot.issued, equipped.issued)
      && same(end.outcome.snapshot.army.slice(3), equipped.army.slice(3)), 'first genuine terminal is deeply frozen; separate post-terminal mutation restored byte-for-byte');
    await axe('#result', 'terminal'); await shot(page, 'deployment-victory');
    await lootStart();
    verdict('fixed-new-loot', await page.evaluate(() => {
      const p = window.__game.practice, s = p.reward.state;
      return JSON.stringify(s.cards) === JSON.stringify(p.outcome.cards) && s.cards.length <= 7
        && s.cards.filter((c) => c.source === 'capture').length === p.outcome.captures.length;
    }), 'prepared reveal consumes the already frozen cards/captures; no roll or inventory rebuild');
    verdict('new-loot-dom-bound', await page.evaluate(() => {
      const p = window.__game.practice, s = p.reward.state;
      return s.army.length === 0 && s.armyStart.length === 0 && s.log.length === 0 && s.tray.length <= 7
        && document.querySelectorAll('.rw-brig').length === 0 && document.querySelectorAll('.rw-card').length <= 7;
    }), '200 saved formations/1970 inherited depot/5000 transfers never become reveal DOM or issue/counts state');
    const layoutReady = async (width) => {
      try {
        await page.waitForFunction((width) => {
          const n = document.querySelector('.rw-deal'); if (!n || innerWidth !== width) return false;
          return width <= 700 ? matchMedia('(max-width: 700px)').matches
            && n.style.getPropertyValue('--cols') === '1' && getComputedStyle(n).overflowY === 'auto'
            && parseFloat(n.style.getPropertyValue('--cw')) === Math.floor(Math.min(320, n.clientWidth - 16))
            : !matchMedia('(max-width: 700px)').matches && n.style.getPropertyValue('--cols') !== '1'
              && getComputedStyle(n).overflowY !== 'auto';
        }, width, { timeout: 3000 });
        return true;
      } catch { return false; }
    };
    const revealMetrics = () => page.locator('.rw-deal').evaluate((n) => ({ viewport: innerWidth,
      cols: n.style.getPropertyValue('--cols'), cw: n.style.getPropertyValue('--cw'),
      scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, scrollHeight: n.scrollHeight,
      clientHeight: n.clientHeight, scrollTop: n.scrollTop, overflowY: getComputedStyle(n).overflowY,
      card: n.lastElementChild.getBoundingClientRect().toJSON(), rect: n.getBoundingClientRect().toJSON() }));
    await page.setViewportSize({ width: 320, height: 480 }); await page.keyboard.press('s');
    const ready320 = await layoutReady(320);
    await page.locator('.rw-deal').focus();
    const scrollBefore = await page.locator('.rw-deal').evaluate((n) => n.scrollTop);
    await page.keyboard.press('PageDown');
    let scrolled = false;
    try { await page.waitForFunction((before) => document.querySelector('.rw-deal').scrollTop > before, scrollBefore, { timeout: 3000 }); scrolled = true; } catch { /* named reveal assertion records the failure */ }
    await page.locator('.rw-card').last().focus();
    const readable = await page.locator('.rw-deal').evaluate((n) => {
      const r = n.getBoundingClientRect(), card = n.lastElementChild.getBoundingClientRect();
      return n.scrollHeight > n.clientHeight && getComputedStyle(n).overflowY === 'auto'
        && n.scrollWidth <= n.clientWidth && card.left >= r.left && card.right <= r.right
        && card.top < r.bottom && card.bottom > r.top
        && [...n.querySelectorAll('.rw-stat small,.rw-arms small,.rw-affix,.rw-where,.rw-effect,.rw-type')].every((t) => parseFloat(getComputedStyle(t).fontSize) >= 12)
        && [...n.querySelectorAll('.rw-name,.rw-where,.rw-effect,.rw-type,.rw-affix-fx')].every((t) => t.scrollWidth <= t.clientWidth && getComputedStyle(t).textOverflow !== 'ellipsis');
    });
    const firstMetrics = await revealMetrics(); await shot(page, 'deployment-loot-last-320');
    await page.setViewportSize({ width: 700, height: 480 });
    const narrowReady = await layoutReady(700);
    const narrowBoundary = narrowReady && await page.locator('.rw-deal').evaluate((n) => n.style.getPropertyValue('--cols') === '1'
      && getComputedStyle(n).overflowY === 'auto' && n.scrollWidth <= n.clientWidth);
    const narrowMetrics = await revealMetrics();
    await page.setViewportSize({ width: 740, height: 480 });
    const wideBoundary = await layoutReady(740) && await page.locator('.rw-deal').evaluate((n) => getComputedStyle(n).overflowY !== 'auto');
    const wideMetrics = await revealMetrics();
    await page.setViewportSize({ width: 320, height: 480 });
    const restoreReady = await layoutReady(320);
    await page.locator('.rw-deal').evaluate((n) => { n.scrollTop = 0; });
    await page.getByRole('button', { name: 'Save and return to camp', exact: true }).focus();
    const rootFit = await page.locator('.rw').evaluate((n) => n.scrollWidth <= n.clientWidth),
      saveFocus = await page.getByRole('button', { name: 'Save and return to camp', exact: true }).evaluate((n) => n === document.activeElement && n.getBoundingClientRect().height >= 48),
      noIssue = await page.getByRole('button', { name: /^Issue to brigades/ }).count() === 0;
    result.deploymentReveal = { ready320, scrolled, readable, narrowBoundary, wideBoundary, restoreReady, rootFit, saveFocus, noIssue,
      layouts: [firstMetrics, narrowMetrics, wideMetrics, await revealMetrics()] };
    verdict('reveal-narrow-keyboard', ready320 && scrolled && readable && narrowBoundary && wideBoundary && restoreReady && rootFit && saveFocus && noIssue,
    `320px full-width cards keep >=12px complete detail, keyboard scroll reaches last card, save48px stays accessible; no issue/counts step: ${JSON.stringify(result.deploymentReveal)}`);
    await axe('.rw', 'reveal'); await shot(page, 'deployment-loot-320'); await page.setViewportSize({ width: 1024, height: 768 });
    const pending = end.outcome.snapshot, launchBaseline = end.baseline, writeBase = (await counters()).writes;
    await page.evaluate(() => { window.__deployQuota = true; }); await lootFinish();
    verdict('quota', await raw() === JSON.stringify(equipped) && (await counters()).writes === writeBase
      && await page.locator('#result-title').textContent().then((s) => s === 'Army not saved'), 'quota keeps full frozen pending and baseline, zero committed result writes');
    await axe('#result', 'recovery'); await shot(page, 'deployment-recovery');
    await page.setViewportSize({ width: 320, height: 480 }); await shot(page, 'deployment-recovery-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    const failurePutBase = (await counters()).puts;
    await page.evaluate(() => { window.__deployQuota = false; window.__progressRequestFailure = true; }); await page.locator('#result-action').click();
    await page.waitForFunction(() => !window.__game.practice.saving);
    verdict('request-failure', await raw() === JSON.stringify(equipped) && (await counters()).writes === writeBase
      && (await counters()).puts === failurePutBase + 1
      && await page.evaluate(() => window.__progressFailureName === 'ConstraintError'), 'real request failure aborts without committing or rerolling');
    await page.evaluate(() => { window.__progressRequestFailure = false; window.__progressAbortPut = true; }); await page.locator('#result-action').click();
    await page.waitForFunction(() => !window.__game.practice.saving);
    verdict('abort', await raw() === JSON.stringify(equipped) && (await counters()).writes === writeBase
      && (await counters()).puts === failurePutBase + 2
      && await page.evaluate(() => window.__progressTrace.filter((e) => e.kind === 'abort').length >= 2)
      && await page.evaluate((p) => JSON.stringify(window.__game.practice.pending) === JSON.stringify(p), pending), 'successful put followed by transaction abort is not a committed save');
    result.deploymentFaultCounters = { failurePutBase, afterAbort: await counters(),
      trace: await page.evaluate(() => window.__progressTrace) };
    verdict('distinct-exports', same(await exported('#result-export'), pending) && same(await exported('#result-export-launch'), launchBaseline)
      && !same(pending, launchBaseline), 'actual downloads distinguish full frozen result from full army at launch');
    await page.evaluate(() => { window.__progressAbortPut = false; }); await holdProgressTransaction(page);
    await page.locator('#result-action').click(); await page.waitForFunction(() => window.__game.practice.saving);
    const queuedBefore = await counters(); await page.locator('#after-action').dispatchEvent('click');
    await page.evaluate(() => { window.__game.practice.reward.state.onDone(); window.__game.practice.finishResult(); });
    verdict('queued-save-owner', await page.evaluate(() => window.__game.practice.saving && document.getElementById('result').getAttribute('aria-busy') === 'true')
      && queuedBefore.writes === writeBase && await page.locator('#result-action').isDisabled(), 'queued real write retains owner; repeat action cannot queue a second result');
    await page.locator('#result-close').click(); const beforeLocation = page.url(); await releaseProgressTransaction(page);
    await page.waitForFunction(() => !window.__game.practice.saving);
    verdict('inspect-settlement', page.url() === beforeLocation && !await page.locator('#result').evaluate((n) => n.open)
      && await page.evaluate(() => !!window.__game.practice.saved), 'Inspect dismisses waiting panel; settlement stays on battlefield with After action');
    verdict('exact-one-save', (await counters()).writes === writeBase + 1 && await raw() === JSON.stringify(pending)
      && same(JSON.parse(await raw()).issued, equipped.issued) && same(JSON.parse(await raw()).depot.slice(0, 1970), equipped.depot),
    'exact one committed result write preserves the entire 5000 prefix and inherited inventory');
    await page.locator('#after-action').click(); await page.keyboard.press('Escape'); await page.locator('#after-action').click();
    await page.evaluate(() => { window.__game.practice.reward.state.onDone(); window.__game.practice.finishResult(); });
    verdict('repeat-no-award', (await counters()).writes === writeBase + 1 && await raw() === JSON.stringify(pending)
      && await page.getByRole('button', { name: 'Open the loot', exact: true }).count() === 0
      && await page.evaluate(() => document.querySelectorAll('.rw').length === 0), 'repeated After action/close keeps completed award and cannot remount loot');
    await campAfter(); await page.reload(); await idle();
    verdict('camp-reload-bound', await raw() === JSON.stringify(pending) && await page.locator('#camp-army .rw-brig').count() === 12
      && await page.locator('#camp-depot > [role="listitem"]').count() === 12 && (await counters()).writes === 0 && (await counters()).gpu === 0,
    'actual Continue/reload reaches conserved 12+12 camp without field allocation/reward/write');
    await axe('#front', 'camp'); await shot(page, 'deployment-camp');

    await launch(); const defeatFirst = await gameState();
    await page.locator('#intro-start').click(); await selectFront(); await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
    await waitLive(() => window.__game.game.units.some((u) => u.side === 'CS' && u.shots > 0) || window.__game.game.over);
    if (!await page.evaluate(() => window.__game.game.over)) {
      await page.getByRole('button', { name: 'Pause', exact: true }).click(); await selectFront();
      await page.getByRole('button', { name: 'Run', exact: true }).click(); await page.locator('#battlefield').focus();
      await page.keyboard.press('b'); for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    await waitLive(() => window.__game.game.over); const defeat = await gameState(); result.deploymentDefeat = { first: defeatFirst, end: defeat };
    verdict('unforced-defeat', defeat.result.winner === 'CS' && defeat.time < 45 && defeat.outcome.snapshot.grade === 'Defeat'
      && defeat.units.some((u) => u.side === 'CS' && u.shots > 0), `ordinary Hold Fire/Run/march vacates held ground; actual loss at ${defeat.time.toFixed(2)} sim seconds`);
    await shot(page, 'deployment-defeat'); await lootStart(); await lootFinish();
    verdict('defeat-one-save', await raw() === JSON.stringify(defeat.outcome.snapshot) && (await counters()).writes === 1
      && same(defeat.outcome.snapshot.issued, pending.issued), 'genuine Defeat new loot and actual survivors save exactly once against the second launch baseline');
    await campAfter();

    // Controlled THIRD terminal: only stale-write and waiting Escape coverage, never win/defeat proof.
    await launch(); await page.locator('#intro-start').click(); await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() => { const g = window.__game.game; g.result = { winner: 'US', why: 'Controlled stale-save fixture' };
      g.over = true; window.__game.practice.finishResult(); });
    const stalePending = (await gameState()).outcome.snapshot, staleBaseline = (await gameState()).baseline;
    const tab = await ctx.newPage(); watchErrors(tab, url, errors); await tab.goto(url + '?camp'); await tab.waitForFunction(() => window.__entry?.mode === 'camp');
    const changed = validateSnapshot({ ...staleBaseline, awardId: 'other-tab-before-save', seed: 'other-tab-before-save' });
    await importIn(tab, changed); await lootStart(); await lootFinish();
    verdict('other-tab-terminal-stale', await raw() === JSON.stringify(changed) && (await counters()).writes === 0
      && await page.locator('#result-text').textContent().then((s) => s.includes('changed')),
    'controlled third terminal plus genuine second-tab Import rejects stale save, no Replace prompt');
    await page.locator('#result-action').click(); await page.waitForFunction(() => !window.__game.practice.saving);
    verdict('stale-retry-no-rebase', await raw() === JSON.stringify(changed) && (await counters()).writes === 0
      && same(await exported('#result-export'), stalePending) && same(await exported('#result-export-launch'), staleBaseline)
      && await page.getByRole('button', { name: /^Replace/ }).count() === 0, 'Retry uses the same launch baseline and exports; never adopts other-tab army');
    await importIn(tab, staleBaseline); await holdProgressTransaction(page); await page.locator('#result-action').click();
    await page.waitForFunction(() => window.__game.practice.saving); await page.keyboard.press('Escape'); const locationBeforeEscape = page.url();
    const waitingAfterEscape = await page.evaluate(() => window.__game.practice.saving); await releaseProgressTransaction(page);
    await page.waitForFunction(() => !window.__game.practice.saving);
    verdict('saving-escape-no-navigation', waitingAfterEscape && page.url() === locationBeforeEscape
      && !await page.locator('#result').evaluate((n) => n.open) && (await counters()).writes === 1 && await raw() === JSON.stringify(stalePending),
    'controlled queued save Escape retains owner and later commits once without navigation'); await tab.close();
    await campAfter();
    const themes = [];
    for (const [theme, value] of [['modern', 'clean modern'], ['desk', 'period desk'], ['hybrid', 'hybrid']]) {
      await page.evaluate(async (value) => { const S = await import('./src/settings.js'); S.set('screens.cardStyle', value); }, value);
      await page.reload(); await idle(); await page.setViewportSize({ width: 320, height: 480 });
      const clean = await axe('#front', `theme-${theme}`);
      const target = await page.locator('#camp-practice').evaluate((n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n);
        return { height: r.height, border: s.borderTopColor, focus: getComputedStyle(n).outlineColor }; });
      await page.locator('#camp-deploy').focus(); const focused = await page.locator('#camp-deploy').evaluate((n) => n === document.activeElement && getComputedStyle(n).outlineStyle !== 'none');
      themes.push({ theme, clean, target, focused }); await shot(page, `deployment-camp-${theme}-320`);
    }
    result.deploymentThemes = themes;
    verdict('themes-axe', themes.every((t) => t.clean && t.focused && t.target.height >= 48 && t.target.border === 'rgb(155, 147, 165)'),
    'all three actual camp themes: scoped axe, 48px actions, visible keyboard focus, strengthened borders');
    verdict('all-scoped-axe', Object.keys(axes).length === 9 && Object.values(axes).every((v) => v.length === 0),
    `actual review/briefing/result/reveal/recovery/camp and three theme scopes: ${JSON.stringify(Object.keys(axes))}`);
    const isolatedBaseline = await raw(); await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(url + '?saved&battle=henry-hill&quality=low'); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    verdict('mixed-route-isolation', await page.evaluate(() => !window.__game.manifest && window.__game.game.scenario.id === 'henry-hill')
      && (await counters()).writes === 0 && await raw() === isolatedBaseline, 'explicit historical route keeps its own field and cannot inherit saved manifest/award');
    verdict('no-console-errors', errors.length === 0, errors.join('\n') || '0 page/console/request errors');
  } finally { await ctx.close(); }
}

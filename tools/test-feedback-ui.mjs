import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress } from './test-progress-browser.mjs';
import { settleCamera, settleHeader } from './test-header-ui.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const frames = page => page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });

async function settledScroll(page, before, mode, childBefore = null) {
  const started = Date.now(); let timer;
  try { return await Promise.race([(async () => {
  await page.evaluate(() => { delete window.__feedbackScrollSettle; });
  await page.waitForFunction(({ before, mode, childBefore }) => {
    const e = document.getElementById('toasts'), top = e.scrollTop, max = e.scrollHeight - e.clientHeight;
    const child = document.getElementById('keyboard-targeting'), childTop = child.scrollTop, childMax = child.scrollHeight - child.clientHeight;
    // Height metrics are rounded integers; native scrollTop retains fractional CSS pixels.
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    const children = [...e.children].filter(child => child.getClientRects().length);
    const lastBottom = Math.max(...children.map(child => child.getBoundingClientRect().bottom));
    const endGap = r.bottom - parseFloat(c.borderBottomWidth) - parseFloat(c.paddingBottom) - lastBottom;
    const moved = mode === 'Home' ? top === 0 : mode === 'End' ? top > before && Math.abs(top - max) <= 1 && Math.abs(endGap) <= 1
      : mode === 'nested-down' ? top > before || childTop > childBefore
      : mode === 'up' ? top < before : mode === 'down' ? top > before : true;
    const old = window.__feedbackScrollSettle;
    const count = moved && old?.top === top && old?.childTop === childTop ? old.count + 1 : 0;
    window.__feedbackScrollSettle = { top, childTop, childMax, max, endGap, moved, count, before, childBefore, mode };
    return moved && count >= 3;
  }, { before, mode, childBefore }, { polling: 'raf', timeout: Math.max(1, 15000 - (Date.now() - started)) });
  return page.evaluate(() => window.__feedbackScrollSettle);
  })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native feedback scrolling exceeded original15000ms: ' + mode)), 15000); })]); }
  finally { clearTimeout(timer); }
}

async function state(page) {
  return page.evaluate(async () => {
    const { game: g, readout, rts } = window.__game;
    return { raw: await window.__progressFixture.raw(), writes: [window.__progressPuts, window.__progressLegacyWrites],
      time: g.simTime, paused: g.paused, orders: g.orders, selected: g.selected?.id, selection: g.selection.map(u => u.id),
      units: JSON.stringify(g.units.map(u => ({ id: u.id, x: u.x, z: u.z, facing: u.facing, state: u.state,
        men: u.men, menMax: u.menMax, morale: u.morale, fatigue: u.fatigue, ammo: u.ammo, tickAcc: u.tickAcc,
        xp: u.xp, gear: u.gear, equipment: u.equipment, weapon: u.weapon, path: u.path,
        order: JSON.parse(JSON.stringify(u.order, (k, v) => g.units.includes(v) ? { unitId: v.id } : v)) }))),
      tickT: readout.tickT, next: readout.next,
      ticks: JSON.stringify(readout.ticks.map(t => [t.age, t.x, t.y, t.z, t.dx, t.el.hidden, t.el.textContent])),
      keys: [...rts.keys], inertia: rts.inertia,
      prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks') };
  });
}

async function fixture(page) {
  return page.evaluate(() => {
    const { hud, game } = window.__game;
    const words = 'DIAGNOSTIC DISPLAY FIXTURE: complete field feedback remains readable when several messages arrive together. ';
    hud.showAlert({ text: words.repeat(3), x: game.selected.x, z: game.selected.z });
    hud.showMoment({ label: words.repeat(2), unit: { short: 'Generic diagnostic formation' }, style: 'subtle' });
    for (let i = 0; i < 4; i++) hud.toast(`DIAGNOSTIC TOAST ${i + 1}: ` + words);
    for (let i = 0; i < 6; i++) hud.feed({ text: `DIAGNOSTIC EVENT ${i + 1}: ` + words.repeat(2), time: 'FIXTURE', x: game.selected.x, z: game.selected.z, side: 'US' });
    return { fly: [game.selected.x, game.selected.z], alert: words.repeat(3), moment: words.repeat(2) + ' · Generic diagnostic formation',
      messages: [...document.querySelectorAll('#feed li > span')].map(e => e.textContent) };
  });
}

// Independent DOM bounds/hits, not Hud.layoutFeedback or its CSS properties.
async function geometry(page, button = null) {
  return page.evaluate(selector => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    const region = document.getElementById('toasts'), r = rect(region), c = getComputedStyle(region), failures = [];
    const header = rect(document.getElementById('topbar')), objective = rect(document.getElementById('objective')), dock = rect(document.getElementById('dock'));
    const available = region.clientHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom);
    if (r.x < 0 || r.right > innerWidth || r.y < Math.max(header.bottom, objective.bottom) || r.bottom > dock.y) failures.push('field-containment');
    if (available < 44 || r.width < 44 || region.scrollWidth > region.clientWidth + 1) failures.push('usable-reading-area');
    const blockers = [document.getElementById('sb-panel'), document.querySelector('.sb-toggle')].filter(e => e && !e.hidden && e.getClientRects().length);
    if (blockers.some(e => overlap(r, rect(e)))) failures.push('editor-or-toggle-overlap');
    const action = selector && document.querySelector(selector); let target;
    if (action) {
      const b = rect(action), points = [[b.x + 2, b.y + 2], [b.right - 2, b.y + 2], [b.x + 2, b.bottom - 2], [b.right - 2, b.bottom - 2], [(b.x + b.right) / 2, (b.y + b.bottom) / 2]];
      const hits = points.map(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === action || action.contains(hit)); });
      target = { ...b, font: parseFloat(getComputedStyle(action).fontSize), hits, disabled: action.disabled, label: action.textContent, name: action.getAttribute('aria-label') };
      if (b.width < 44 || b.height < 44 || target.font < 14 || b.x < r.x || b.right > r.right || b.y < r.y || b.bottom > r.bottom || hits.some(v => !v)) failures.push('complete-native-action');
    }
    return { viewport: [innerWidth, innerHeight], region: r, header, objective, dock, available, client: region.clientHeight, scroll: region.scrollHeight, top: region.scrollTop, target, failures };
  }, button);
}

async function reveal(page, selector) {
  await page.locator('#toasts').focus();
  let reached = false;
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(s => document.activeElement.matches(s), selector)) { reached = true; break; }
  }
  if (!reached) throw Error('Native Tab cannot reach ' + selector);
  await frames(page);
  return { ...await geometry(page, selector), nativeTab: reached };
}

async function nativeTap(page, selector) {
  const b = await page.locator(selector).boundingBox(), cdp = await page.context().newCDPSession(page);
  if (!b) throw Error('Native action lacks bounds');
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  await frames(page);
}

async function heldText(page) {
  return page.evaluate(() => {
    const e = document.getElementById('soldier-view-hint'), p = document.getElementById('toasts'), r = e.getBoundingClientRect(), b = p.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(e);
    const lines = [...range.getClientRects()].map(q => ({ top: q.top, bottom: q.bottom, x: q.x, right: q.right }));
    return { active: window.__game.soldierView.active, text: e.textContent, lines,
      complete: lines.length > 0 && lines.every(q => q.top >= b.top && q.bottom <= b.bottom && q.x >= r.x && q.right <= r.right),
      inside: r.top >= b.top && r.bottom <= b.bottom && r.x >= b.x && r.right <= b.right,
      client: e.clientHeight, scroll: e.scrollHeight, top: p.scrollTop, x: r.x, right: r.right,
      horizontal: e.scrollWidth <= e.clientWidth, region: { top: b.top, bottom: b.bottom, x: b.x, right: b.right } };
  });
}

async function textReach(page) {
  return page.evaluate(() => {
    const parent = document.getElementById('toasts'), p = parent.getBoundingClientRect();
    return [...document.querySelectorAll('#banner-text, #moment-banner, #feed time, #feed li > span, #toasts > .transient-toast')].map(e => {
      const c = getComputedStyle(e), range = document.createRange(); range.selectNodeContents(e);
      const lines = [...range.getClientRects()], r = e.getBoundingClientRect();
      return { text: e.textContent, font: parseFloat(c.fontSize), wrap: c.whiteSpace !== 'nowrap' && c.textOverflow !== 'ellipsis',
        horizontal: e.scrollWidth <= e.clientWidth + 1 && lines.every(q => q.x >= p.x && q.right <= p.right),
        reachable: lines.length > 0 && lines.every(q => q.top >= p.top - parent.scrollTop && q.bottom <= p.top - parent.scrollTop + parent.scrollHeight),
        height: r.height, lines: lines.length };
    });
  });
}

export async function feedbackControls({ browser, url, check, shot, result, watchErrors, native, focused = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await probeProgress(ctx, { prefix: '__feedback', readFlag: '__feedbackRead', quotaFlag: '__feedbackQuota' });
  const page = await ctx.newPage(), errors = [], warnings = [], rawDriverWarnings = [], evidence = {};
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(180000);
  result.feedback = evidence; result.feedbackAxe = [];
  watchErrors(page, url, errors);
  page.on('console', m => { if (m.type() === 'warning') (/GL Driver Message|GPU stall|already non-indexed/.test(m.text()) ? rawDriverWarnings : warnings).push(m.text()); });
  const record = (name, ok, data) => { evidence[name] = data; check('feedback-' + name, ok, JSON.stringify(data).slice(0, 1600) + ' (full evidence: result.feedback)'); };
  const field = page.locator('#battlefield');
  const panel = async open => { if ((await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') !== open) await page.locator('#sb-toggle').click(); };
  const setSide = side => page.evaluate(async value => (await import('./src/settings.js')).set('look.panelSide', value), side);
  const cameraEnd = async () => {
    const captured = await page.evaluate(() => {
      try { return { report: window.__headerCameraWitness?.finish() }; }
      catch (e) { return { report: window.__headerCameraArchive?.at(-1), error: e.message }; }
    });
    if (captured.report) (evidence.cameraEpochs ||= []).push(captured.report);
    if (captured.error) throw Error(captured.error);
  };
  let original, primary;
  evidence.cleanupErrors = [];
  try {
    await page.goto(url + '?sandbox&quality=low', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.__game && document.getElementById('sb-panel'), null, { timeout: 180000 });
    await page.evaluate(() => {
      const canvas = document.getElementById('battlefield'), events = [];
      const listen = e => events.push({ type: e.type, trusted: e.isTrusted, time: performance.now(), simulation: window.__game.game.simTime });
      for (const type of ['webglcontextlost', 'webglcontextrestored']) canvas.addEventListener(type, listen);
      window.__feedbackContext = { events, restore() { for (const type of ['webglcontextlost', 'webglcontextrestored']) canvas.removeEventListener(type, listen); } };
    });
    if (!await page.evaluate(() => window.__game.game.paused)) await page.locator('#pause').click();
    original = await page.evaluate(async () => ({ side: (await import('./src/settings.js')).get('look.panelSide'),
      prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks'), hidden: localStorage.getItem('cw.sandbox.hidden'),
      panel: !document.getElementById('sb-panel').hidden }));
    await panel(false);
    const flag = page.locator('#markers button').filter({ has: page.locator('.nm', { hasText: /^Franklin$/ }) });
    await flag.focus(); await page.keyboard.press('Enter'); await field.focus();
    await settleHeader(page); await settleCamera(page);
    if (native && focused) {
      const renderer = await page.evaluate(() => { const gl = window.__game.post.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
      check('feedback-native-renderer', !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
    }
    const pausedBefore = await state(page), layouts = [];
    for (const [width, height] of [[320, 480], [320, 568], [568, 320], [760, 600], [1024, 768], [1280, 800]]) {
      await page.setViewportSize({ width, height }); await settleHeader(page);
      const text = await fixture(page); await frames(page);
      const g = await geometry(page);
      const full = await page.evaluate(t => document.getElementById('banner-text').textContent === t.alert
        && document.getElementById('moment-banner').textContent === t.moment
        && [...document.querySelectorAll('#feed li > span')].every((e, i) => e.textContent === t.messages[i])
        && document.getElementById('toasts').getAttribute('aria-live') === null
        && document.getElementById('toasts').getAttribute('role') === 'region', text);
      const readText = await textReach(page), reachable = readText.length >= 15 && readText.every(e => e.font >= 14 && e.wrap && e.horizontal && e.reachable);
      layouts.push({ ...g, full, reachable, text: readText }); await shot(page, `feedback-${width}-${height}`);
    }
    const narrow = layouts.filter(g => g.viewport[0] === 320), landscape = layouts.find(g => g.viewport[0] === 568);
    record('narrow-layout', narrow.length === 2 && narrow.every(g => g.full && g.reachable && !g.failures.length), narrow);
    record('landscape-layout', landscape.full && landscape.reachable && !landscape.failures.length && same(pausedBefore, await state(page)), { layout: landscape, pausedConserved: same(pausedBefore, await state(page)) });

    // Both pointer media modes and actual panel sides in this same sequential context.
    await cameraEnd();
    const wide = [], media = await ctx.newCDPSession(page);
    try {
      for (const touch of [false, true]) {
        await media.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
        for (const side of ['left', 'right']) {
          await panel(false); await setSide(side); await page.setViewportSize({ width: 1280, height: 800 }); await panel(true); await settleHeader(page); await frames(page);
          const g = await geometry(page), coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
          await field.focus(); await page.keyboard.down('i'); await frames(page); const hint = await heldText(page);
          wide.push({ touch, coarse, side, ...g, hint }); await shot(page, `feedback-wide-${side}-${touch ? 'touch' : 'mouse'}`);
          await page.keyboard.up('i'); await frames(page);
        }
      }
    } finally { await media.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await media.detach(); }
    await page.setViewportSize({ width: 320, height: 480 }); await settleHeader(page); await frames(page);
    const hidden = await page.locator('#toasts').evaluate(e => !e.getClientRects().length && getComputedStyle(e).display === 'none');
    const retained = await page.locator('#feed').textContent();
    await page.getByRole('tab', { name: 'Look', exact: true }).focus(); await page.keyboard.press('Escape'); await frames(page);
    const returned = await geometry(page), retainedAfter = await page.locator('#feed').textContent();
    record('wide-workbench', wide.length === 4 && wide.every(g => !g.failures.length && g.coarse === g.touch && g.hint.active && g.hint.complete && g.hint.inside) && hidden && retained === retainedAfter && !returned.failures.length,
      { wide, narrowHidden: hidden, retained: retained === retainedAfter, returned });
    await setSide(original.side); await settleHeader(page); await frames(page);

    await cameraEnd();
    const held = [];
    for (const [width, height] of [[320, 480], [568, 320], [1280, 800]]) {
      await page.setViewportSize({ width, height }); await settleHeader(page); await field.focus(); await page.keyboard.down('i'); await frames(page);
      const h = await heldText(page);
      held.push(h); await shot(page, `feedback-held-${width}-${height}`); await page.keyboard.up('i'); await frames(page);
    }
    record('held-hint', held.every(h => h.active && h.inside && h.complete && h.horizontal && h.scroll <= h.client && h.top === 0 && h.text.includes('Release') && h.text.includes('for the map.')), held);
    await page.setViewportSize({ width: 320, height: 480 }); await settleHeader(page); await field.focus(); await settleCamera(page);

    const ghostFixture = await fixture(page); await field.focus(); await page.keyboard.press('b'); await page.keyboard.press('ArrowUp'); await frames(page);
    await page.evaluate(() => {
      const { input, game, arrows } = window.__game, d = input.targeting;
      const expectedKeys = ['mode', 'unit', 'selection', 'point', 'points', 'enemy', 'face', 'faceSet', 'preview', 'end', 'previewKey', 'statusText'];
      if (!d || d.points.length !== 2 || JSON.stringify(Reflect.ownKeys(d)) !== JSON.stringify(expectedKeys)) throw Error('Real twelve-key native march preview required');
      const value = x => x === null || typeof x !== 'object' ? x : Object.fromEntries(Object.getOwnPropertyNames(x).map(k => [k, value(x[k])]));
      const read = () => ({ keys: Reflect.ownKeys(input.targeting), values: Reflect.ownKeys(input.targeting).filter(k => !['unit', 'enemy', 'selection'].includes(k)).map(k => [k, value(input.targeting[k])]) });
      const original = read(), selected = game.selected, enemy = d.enemy, selection = [...game.selection], preview = arrows.preview, end = arrows.previewEnd;
      window.__feedbackGhost = { read: () => ({ exact: input.targeting === d && input.targeting.unit === selected && input.targeting.enemy === enemy
        && game.units.includes(selected) && (!enemy || game.units.includes(enemy)) && selection.every(u => game.units.includes(u))
        && game.selected === selected && game.selection.length === selection.length && game.selection.every((u, i) => u === selection[i])
        && input.targeting.selection.length === selection.length && input.targeting.selection.every((u, i) => u === selection[i])
        && arrows.preview === preview && arrows.previewEnd === end && JSON.stringify(original) === JSON.stringify(read()), data: read() }) };
    });
    const readingBefore = await state(page), reading = [];
    evidence.reading = reading;
    const region = page.locator('#toasts');
    await region.focus();
    for (const key of ['End', 'Home', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'Enter', 'q', 'b']) {
      evidence.readingPhase = 'key:' + key;
      const before = await region.evaluate(e => e.scrollTop); await page.keyboard.press(key);
      const mode = ['Home', 'End'].includes(key) ? key : ['PageUp', 'ArrowUp'].includes(key) ? 'up'
        : ['PageDown', 'ArrowDown', ' '].includes(key) ? 'down' : 'steady';
      const settled = await settledScroll(page, before, mode);
      reading.push({ key, before, after: settled.top, settled, ghost: await page.evaluate(() => window.__feedbackGhost.read().exact) });
    }
    evidence.readingPhase = 'wheel-home';
    await region.focus(); await page.keyboard.press('Home'); await settledScroll(page, await region.evaluate(e => e.scrollTop), 'Home');
    const bounds = await region.boundingBox(), wheelBefore = await region.evaluate(e => e.scrollTop);
    const childBefore = await page.locator('#keyboard-targeting').evaluate(e => e.scrollTop);
    evidence.readingPhase = 'wheel-nested';
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.wheel(0, 500);
    const firstWheel = await settledScroll(page, wheelBefore, 'nested-down', childBefore);
    evidence.firstWheel = firstWheel;
    if (firstWheel.top === wheelBefore) {
      if (Math.abs(firstWheel.childTop - firstWheel.childMax) > 1) throw Error('Nested instruction has not reached its native wheel boundary');
      evidence.readingPhase = 'wheel-parent';
      await page.mouse.wheel(0, 500); await settledScroll(page, wheelBefore, 'down');
    }
    const wheel = await region.evaluate(e => e.scrollTop);
    const scrollSession = await ctx.newCDPSession(page);
    evidence.readingPhase = 'touch';
    await page.evaluate(() => {
      const events = [], rows = new WeakMap(), types = ['pointerdown', 'pointercancel', 'touchstart', 'touchmove', 'touchend'];
      const listen = e => { const row = { type: e.type, trusted: e.isTrusted, inside: !!e.target.closest?.('#toasts') };
        events.push(row); rows.set(e, row); };
      // Input registered its window handlers during startup; this observes the SAME event after them.
      const after = e => { const row = rows.get(e); row.afterProduction = true;
        row.ghost = window.__feedbackGhost.read().exact; row.prevented = e.defaultPrevented; };
      for (const type of types) { document.addEventListener(type, listen, true); window.addEventListener(type, after); }
      window.__feedbackTouch = { events, restore() { for (const type of types) {
        document.removeEventListener(type, listen, true); window.removeEventListener(type, after); } } };
    });
    try {
      await scrollSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 5 }] });
      await scrollSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + 5 }] });
      await scrollSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await scrollSession.detach(); }
    await settledScroll(page, wheel, 'down');
    const touchScroll = await region.evaluate(e => e.scrollTop), ghost = await page.evaluate(() => window.__feedbackGhost.read());
    const nativeTouch = await page.evaluate(() => { const w = window.__feedbackTouch; w.restore(); return w.events; });
    evidence.nativeTouch = nativeTouch;
    const readingConserved = same(readingBefore, await state(page));
    const moved = key => { const r = reading.find(x => x.key === key); return ['PageUp', 'ArrowUp'].includes(key) ? r.after < r.before : r.after > r.before; };
    record('native-scroll-reading', reading.every(x => x.ghost) && reading.find(x => x.key === 'End').after > 0
      && reading.find(x => x.key === 'Home').after === 0 && ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' '].every(moved)
      && wheel > 0 && touchScroll > wheel && ghost.exact && readingConserved
      && ['touchstart', 'touchmove', 'touchend', 'pointercancel'].every(type => nativeTouch.some(e => e.type === type))
      && nativeTouch.every(e => e.trusted && e.inside && e.afterProduction && e.ghost && !e.prevented),
      { reading, firstWheel, wheel, touchScroll, nativeTouch, ghost, pausedConserved: readingConserved });
    const cancellationBefore = await state(page);
    await page.locator('#keyboard-targeting').focus(); await page.keyboard.press('Escape'); await frames(page);
    const cancelled = await page.evaluate(() => !window.__game.input.targeting && document.activeElement.id === 'battlefield');
    if (!cancelled || !same(cancellationBefore, await state(page))) throw Error('Original native instruction Escape cancellation conservation failed');

    // Observe original action owners and trusted native activations without compensation writes.
    await page.evaluate(() => {
      const h = window.__game.hud, saved = ['onFly', 'onResume'].map(k => ({ key: k, descriptor: Object.getOwnPropertyDescriptor(h, k), value: h[k] }));
      const calls = [], events = [], epochs = [];
      const listen = e => { if (e.target.closest('#toasts button')) events.push({ type: e.type, trusted: e.isTrusted, pointer: e.pointerType, text: e.target.textContent }); };
      for (const type of ['click', 'pointerdown']) document.addEventListener(type, listen, true);
      for (const row of saved) h[row.key] = function (...args) {
        if (row.key === 'onFly' && window.__headerCameraWitness) epochs.push(window.__headerCameraWitness.finish());
        calls.push({ key: row.key, args, before: window.__game.game.simTime });
        return row.value.apply(this, args);
      };
      window.__feedbackActions = { calls, events, epochs, restore: () => {
        for (const row of saved) row.descriptor ? Object.defineProperty(h, row.key, row.descriptor) : delete h[row.key];
        for (const type of ['click', 'pointerdown']) document.removeEventListener(type, listen, true);
        return saved.every(row => h[row.key] === row.value);
      } };
    });
    const actionsBefore = await state(page), keys = [];
    for (const [selector, key] of [['#feed li:first-child button', 'Enter'], ['#feed li:last-child button', ' ']]) {
      const g = await reveal(page, selector); await page.keyboard.press(key); await frames(page); await settleCamera(page);
      keys.push({ selector, key, ...g }); await shot(page, key === 'Enter' ? 'feedback-first-action' : 'feedback-last-action');
    }
    const keyCalls = await page.evaluate(() => window.__feedbackActions.calls.map(x => ({ ...x })));
    record('feed-keyboard', keys.every(g => !g.failures.length && g.target.name.includes('DIAGNOSTIC EVENT'))
      && keyCalls.length === 2 && keyCalls.every(x => x.key === 'onFly' && same(x.args, ghostFixture.fly)) && same(actionsBefore, await state(page)), { keys, calls: keyCalls, expectedCoordinates: ghostFixture.fly, pausedConserved: same(actionsBefore, await state(page)) });
    const tg = await reveal(page, '#feed li:last-child button'); await nativeTap(page, '#feed li:last-child button'); await settleCamera(page);
    const touchActions = await page.evaluate(() => ({ calls: window.__feedbackActions.calls, events: window.__feedbackActions.events }));
    record('feed-touch', !tg.failures.length && touchActions.calls.length === 3 && touchActions.events.filter(e => e.type === 'click').length === 3
      && touchActions.calls.every(x => x.key === 'onFly' && same(x.args, ghostFixture.fly))
      && touchActions.events.every(e => e.trusted) && touchActions.events.some(e => e.pointer === 'touch') && same(actionsBefore, await state(page)), { geometry: tg, expectedCoordinates: ghostFixture.fly, ...touchActions });

    const alertFixture = await fixture(page);
    const alertFly = await reveal(page, '#banner-fly'); await page.keyboard.press('Enter'); await frames(page); await settleCamera(page);
    const flyCalls = await page.evaluate(() => window.__feedbackActions.calls.length);
    const resumeGeometry = await reveal(page, '#banner-resume'), resumedBefore = await state(page);
    await page.keyboard.press(' '); await page.waitForFunction(() => !window.__game.game.paused && window.__game.game.simTime > 0);
    await frames(page); const running = await state(page); await page.locator('#pause').click(); await frames(page);
    const pausedAfter = await state(page), actionRows = await page.evaluate(() => window.__feedbackActions.calls);
    record('alert-actions', !alertFly.failures.length && !resumeGeometry.failures.length && flyCalls === 4
      && actionRows.length === 5 && actionRows.filter(x => x.key === 'onResume').length === 1
      && actionRows[3].key === 'onFly' && same(actionRows[3].args, alertFixture.fly) && actionRows[4].key === 'onResume' && actionRows[4].args.length === 0
      && !running.paused && running.time > resumedBefore.time && pausedAfter.paused
      && pausedAfter.orders === resumedBefore.orders && same(pausedAfter.raw, resumedBefore.raw) && same(pausedAfter.writes, resumedBefore.writes),
      { alertFly, resumeGeometry, calls: actionRows, resumedBefore, running, pausedAfter, note: 'Real resumed simulation effects allowed and recorded; no pose/time/counter rewind.' });
    await shot(page, 'feedback-alert-actions');

    // Resume legitimately hid the old alert. This independent expiry fixture owns only display text.
    await page.evaluate(t => window.__game.hud.showAlert({ text: t.alert, x: t.fly[0], z: t.fly[1] }), alertFixture);
    await reveal(page, '#feed li:last-child button');

    const retention = await page.evaluate(() => {
      const { hud } = window.__game, p = document.getElementById('toasts'), list = document.getElementById('feed');
      const nodes = Object.fromEntries(['tip', 'intro-hint', 'keyboard-targeting', 'soldier-view-hint', 'banner', 'moment-banner', 'feed'].map(id => [id, document.getElementById(id)]));
      for (let i = 0; i < 9; i++) hud.toast('DIAGNOSTIC RETENTION TOAST ' + i);
      const last = list.lastElementChild.querySelector('button'); last.focus({ preventScroll: true });
      const reading = p.scrollTop, y = last.getBoundingClientRect().y;
      hud.feed({ text: 'DIAGNOSTIC SURVIVING FOCUS', time: 'FIXTURE', x: 0, z: 0 });
      window.__feedbackSurvivor = { last, reading, y, dpr: devicePixelRatio,
        immediate: { y: last.getBoundingClientRect().y, top: p.scrollTop, max: p.scrollHeight - p.clientHeight } };
      window.__feedbackRetainedNodes = nodes;
      return { cap: p.querySelectorAll(':scope > .transient-toast').length };
    });
    await page.waitForFunction(() => {
      const w = window.__feedbackSurvivor, p = document.getElementById('toasts');
      const current = { y: w.last.getBoundingClientRect().y, top: p.scrollTop,
        max: p.scrollHeight - p.clientHeight, connected: w.last.isConnected,
        focused: document.activeElement === w.last };
      const old = w.settlement;
      const stable = old && Object.keys(current).every(k => old[k] === current[k]);
      w.settlement = { ...current, count: stable ? old.count + 1 : 0 };
      return w.settlement.count >= 3;
    }, null, { polling: 'raf', timeout: 15000 });
    const survivorGeometry = await geometry(page, '#feed li:nth-last-child(2) button');
    const survivor = await page.evaluate(() => {
      const w = window.__feedbackSurvivor, p = document.getElementById('toasts'), y = w.last.getBoundingClientRect().y;
      return { connected: w.last.isConnected, focused: document.activeElement === w.last, beforeY: w.y, afterY: y,
        dpr: w.dpr, beforePixel: Math.round(w.y * w.dpr), afterPixel: Math.round(y * w.dpr),
        beforeTop: w.reading, afterTop: p.scrollTop, max: p.scrollHeight - p.clientHeight, immediate: w.immediate,
        settlement: w.settlement,
        clamped: w.reading > p.scrollHeight - p.clientHeight
          && Math.abs(p.scrollTop - (p.scrollHeight - p.clientHeight)) <= 1 };
    });
    const remainingRetention = await page.evaluate(() => {
      const { hud } = window.__game, p = document.getElementById('toasts'), list = document.getElementById('feed');
      list.firstElementChild.querySelector('button').focus({ preventScroll: true });
      hud.feed({ text: 'DIAGNOSTIC PRUNED FOCUS', time: 'FIXTURE', x: 0, z: 0 });
      const pruned = document.activeElement === p;
      hud.feed({ text: 'DIAGNOSTIC NO COORDINATE', time: 'FIXTURE' });
      const disabled = list.lastElementChild.querySelector('button');
      return { feed: list.children.length, pruned,
        disabled: disabled.disabled && disabled.title === '' && list.lastElementChild.textContent.includes('DIAGNOSTIC NO COORDINATE') };
    });
    await page.waitForTimeout(5300);
    const expired = await page.evaluate(() => ({ count: document.querySelectorAll('#toasts > .transient-toast').length,
      nodes: Object.entries(window.__feedbackRetainedNodes).every(([id, node]) => document.getElementById(id) === node && node.isConnected),
      alert: !document.getElementById('banner').hidden, feed: document.getElementById('feed').children.length,
      moment: document.getElementById('moment-banner').textContent.includes('DIAGNOSTIC DISPLAY FIXTURE') }));
    record('bounded-retention', retention.cap === 4 && remainingRetention.feed === 6 && remainingRetention.pruned && remainingRetention.disabled
      && survivor.connected && survivor.focused && (survivor.beforePixel === survivor.afterPixel || survivor.clamped) && !survivorGeometry.failures.length
      && expired.count === 0 && expired.nodes && expired.alert && expired.feed === 6 && expired.moment,
      { retention, survivor, survivorGeometry, remainingRetention, expired, moment: 'Direct synthetic Hud.showMoment fixture only; original real Effects lifetime remains4s.' });

    // Same-task empty->intro reveal, then independently rejecting actual old geometry and markup.
    const injected = await page.evaluate(() => {
      const parent = document.getElementById('toasts'), ids = ['tip', 'intro-hint', 'keyboard-targeting', 'soldier-view-hint', 'banner', 'moment-banner', 'feed'];
      const saved = ids.map(id => { const e = document.getElementById(id); return { e, hidden: e.hidden, nodes: [...e.childNodes] }; });
      const oldScroll = parent.scrollTop;
      try {
        for (const { e } of saved) e.hidden = true;
        const empty = !parent.getClientRects().length;
        const intro = document.getElementById('intro-hint'); intro.hidden = false; intro.textContent = 'DIAGNOSTIC immediate instruction';
        const r = parent.getBoundingClientRect(), b = intro.getBoundingClientRect();
        return { empty, revealed: r.height > 0, inside: b.top >= r.top && b.bottom <= r.bottom,
          priorScroll: oldScroll, text: intro.textContent };
      } finally { for (const row of saved) { row.e.hidden = row.hidden; if (row.e.childNodes.length !== row.nodes.length || [...row.e.childNodes].some((n, i) => n !== row.nodes[i])) row.e.replaceChildren(...row.nodes); } parent.scrollTop = oldScroll; }
    });
    // Parent scroll is intentionally measured: layout-owner transitions, not every RAF, reset reading.
    await fixture(page); await page.waitForTimeout(5300); await frames(page);
    const controlBefore = await state(page);
    const selector = '#feed li:last-child button', a = await reveal(page, selector);
    const markupB = await page.evaluate(() => {
      const li = document.querySelector('#feed li:last-child'), b = li.querySelector('button'), time = li.querySelector('time'), span = li.querySelector('span');
      const label = [...b.childNodes], order = [...li.childNodes], style = b.style.cssText, styleAttribute = b.getAttribute('style');
      const reader = document.getElementById('toasts'), scroll = reader.scrollTop, focus = document.activeElement, bytes = li.outerHTML;
      window.__feedbackMarkupRestore = () => {
        b.replaceChildren(...label); li.replaceChildren(...order);
        if (styleAttribute === null) b.removeAttribute('style'); else b.setAttribute('style', styleAttribute);
        focus.focus({ preventScroll: true }); reader.scrollTop = scroll;
        return { exact: li.outerHTML === bytes && [...li.childNodes].every((n, i) => n === order[i])
          && [...b.childNodes].every((n, i) => n === label[i]) && b.style.cssText === style
          && reader.scrollTop === scroll && document.activeElement === focus, scroll, bytes };
      };
      b.replaceChildren(time, span); b.style.cssText = 'display:flex;width:100%;min-height:44px;gap:8px;align-items:baseline;padding:3px 6px;font-size:14px;text-align:left';
      return { exactNodes: b.contains(time) && b.contains(span), label: b.textContent };
    });
    await reveal(page, selector); const b = await geometry(page, selector); await shot(page, 'feedback-legacy-message-button');
    const markupRestore = await page.evaluate(() => { const r = window.__feedbackMarkupRestore(); delete window.__feedbackMarkupRestore; return r; });
    const a2 = await geometry(page, selector);
    const anchorBefore = await state(page);
    const anchors = await page.evaluate(() => {
      const reader = document.getElementById('toasts'), nodes = [...reader.childNodes], bytes = reader.outerHTML, scroll = reader.scrollTop, focus = document.activeElement;
      window.__feedbackAnchorRestore = () => {
        document.getElementById('feedback-legacy-anchors')?.remove(); focus.focus({ preventScroll: true }); reader.scrollTop = scroll;
        return { exact: reader.outerHTML === bytes && [...reader.childNodes].every((n, i) => n === nodes[i])
          && reader.scrollTop === scroll && document.activeElement === focus, scroll, bytes };
      };
      const style = document.createElement('style'); style.id = 'feedback-legacy-anchors';
      style.textContent = `body #toasts{display:contents!important}body #toasts>#tip{position:fixed!important;bottom:calc(var(--edge) + var(--dock-h) + 2px)!important;left:8px!important;width:calc(100vw - 16px)!important}body #toasts>#banner{position:fixed!important;top:calc(var(--top-h) + 14px)!important;left:8px!important;width:calc(100vw - 16px)!important;max-height:none!important}body #toasts>#moment-banner{position:fixed!important;top:calc(var(--top-h) + 60px)!important;left:8px!important;width:calc(100vw - 16px)!important}body #toasts>#feed{position:fixed!important;bottom:calc(var(--dock-h) + 16px)!important;right:8px!important;width:38vw!important}`;
      document.head.append(style); return { installed: style.isConnected };
    });
    const anchorB = await geometry(page, '#banner-resume'); await shot(page, 'feedback-legacy-anchors');
    const anchorRestore = await page.evaluate(() => { const r = window.__feedbackAnchorRestore(); delete window.__feedbackAnchorRestore; return r; });
    const anchorA2 = await geometry(page, selector); await shot(page, 'feedback-restored-layout');
    const stateAfterControls = await state(page);
    record('layout-control-restore', injected.empty && injected.revealed && injected.inside && !a.failures.length && markupB.exactNodes
      && b.failures.includes('complete-native-action') && markupRestore.exact && !a2.failures.length
      && same(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'nativeTab')), a2)
      && anchors.installed && anchorB.failures.length > 0 && anchorRestore.exact && !anchorA2.failures.length && same(a2, anchorA2)
      && same(controlBefore, stateAfterControls) && same(anchorBefore, stateAfterControls),
      { injected, a, markupB, b, markupRestore, a2, anchors, anchorB, anchorRestore, anchorA2, pausedConserved: same(controlBefore, stateAfterControls), stateAfterControls });

    await cameraEnd();
    const axe = await new AxeBuilder({ page }).include('#toasts').include('#topbar').include('#battlefield').analyze();
    result.feedbackAxe.push(...axe.violations);
    record('axe', result.feedbackAxe.length === 0, { count: result.feedbackAxe.length });
    const restored = await page.evaluate(() => { const w = window.__feedbackActions; const ok = w.restore(); return { ok, epochs: w.epochs, calls: w.calls, events: w.events }; });
    evidence.actions = restored;
  } catch (e) { primary = e; evidence.failure = e.message; }
  finally {
    const cleanup = async (label, work) => { try { await work(); } catch (e) { evidence.cleanupErrors.push({ label, error: e.message }); } };
    if (!page.isClosed()) {
      await cleanup('held release', () => page.keyboard.up('i'));
      await cleanup('camera descriptors', cameraEnd);
      await cleanup('failed scroll state', async () => { if (primary) evidence.failedScroll = await page.evaluate(() => ({ settlement: window.__feedbackScrollSettle,
        active: document.activeElement.id, readerTop: document.getElementById('toasts').scrollTop,
        client: document.getElementById('toasts').clientHeight, scroll: document.getElementById('toasts').scrollHeight })); });
      await cleanup('touch observer', async () => { evidence.nativeTouch ||= await page.evaluate(() => {
        window.__feedbackTouch?.restore(); return window.__feedbackTouch?.events || []; }); });
      await cleanup('context evidence', async () => { evidence.context = await page.evaluate(() => {
        const w = window.__feedbackContext, events = w?.events || []; w?.restore();
        return { events, lost: window.__game.post.renderer.getContext().isContextLost() };
      }); });
      await cleanup('nodes and action descriptors', async () => { evidence.actionCleanup = await page.evaluate(() => {
        window.__feedbackMarkupRestore?.(); window.__feedbackAnchorRestore?.(); document.getElementById('feedback-legacy-anchors')?.remove();
        const installed = !!window.__feedbackActions, restored = window.__feedbackActions?.restore();
        if (restored === false) throw Error('Action descriptors not restored');
        return { installed, restored: installed ? restored : null };
      }); });
      if (original) {
        await cleanup('panel and side', async () => { await panel(false); await setSide(original.side); await panel(original.panel); });
        await cleanup('raw preferences', async () => { const restored = await page.evaluate(o => {
          for (const [key, value] of [['cw.settings', o.prefs], ['cw.locks', o.locks], ['cw.sandbox.hidden', o.hidden]]) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
          return { prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks'), hidden: localStorage.getItem('cw.sandbox.hidden') };
        }, original);
        evidence.restoredPreferences = same(restored, { prefs: original.prefs, locks: original.locks, hidden: original.hidden });
        if (!evidence.restoredPreferences) throw Error('Feedback raw preferences not restored');
        });
      }
    }
    await cleanup('context close', () => ctx.close());
    record('no-console-errors', errors.length === 0 && warnings.length === 0 && evidence.cleanupErrors.length === 0
      && evidence.context && !evidence.context.lost && !evidence.context.events.some(e => e.type === 'webglcontextlost')
      && evidence.actionCleanup && (!evidence.actionCleanup.installed || evidence.actionCleanup.restored === true),
      { errors, warnings, rawDriverWarnings, cleanupErrors: evidence.cleanupErrors, context: evidence.context, actionCleanup: evidence.actionCleanup });
    if (primary) throw primary;
    if (evidence.cleanupErrors.length) throw Error('Feedback cleanup failed: ' + JSON.stringify(evidence.cleanupErrors));
  }
}

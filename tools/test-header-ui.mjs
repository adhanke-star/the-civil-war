import { AxeBuilder } from '@axe-core/playwright';
import { settleDock } from './test-dock-ui.mjs';
import { probeProgress } from './test-progress-browser.mjs';

const viewports = [[320, 568], [375, 667], [568, 320], [760, 568], [1024, 768], [1440, 788]];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function scopes(result) {
  result.headerAxe ||= []; result.headerWarnings ||= []; result.headerErrors ||= [];
  result.headerStages ||= { sandbox: false, afterAction: false, stores: false };
}

async function axe(page, result, label, selectors = ['#topbar', '#objective', '#tip', '#intro-hint', '#keyboard-targeting', '#army', '#field-stores']) {
  scopes(result);
  let builder = new AxeBuilder({ page });
  for (const selector of selectors) builder = builder.include(selector);
  const report = await builder.analyze();
  result.headerAxe.push(...report.violations.map(v => ({ ...v, headerScope: label })));
}

function warnings(page, result) {
  scopes(result);
  const listen = m => { if (m.type() === 'warning') result.headerWarnings.push(m.text()); };
  page.on('console', listen); return () => page.off('console', listen);
}

export async function settleHeader(page) {
  await settleDock(page);
  await page.evaluate(() => { delete window.__headerSettled; });
  await page.waitForFunction(() => {
    const top = document.getElementById('topbar'), objective = document.getElementById('objective'), css = getComputedStyle(document.documentElement);
    const h = top.getBoundingClientRect().height, o = objective.getBoundingClientRect().height;
    const key = JSON.stringify([h, o, css.getPropertyValue('--top-h'), css.getPropertyValue('--objective-h'), ...[...top.querySelectorAll('*')].map(e => {
      const r = e.getBoundingClientRect(); return [e.id, e.hidden, e.textContent, r.x, r.y, r.width, r.height];
    })]);
    const settled = window.__headerSettled === key; window.__headerSettled = key;
    return settled && Math.abs(h - parseFloat(css.getPropertyValue('--top-h'))) < 0.5 && Math.abs(o - parseFloat(css.getPropertyValue('--objective-h'))) < 0.5;
  }, null, { polling: 'raf', timeout: 15000 });
}

export async function headerGeometry(page) {
  return page.evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = e => !e.hidden && e.getClientRects().length && getComputedStyle(e).display !== 'none' && !e.closest('.visually-hidden');
    const inside = (r, p) => r.x >= p.x - 0.5 && r.right <= p.right + 0.5 && r.y >= p.y - 0.5 && r.bottom <= p.bottom + 0.5;
    const overlap = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;
    const hits = (e, r) => [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 5, r.y + 5], [r.right - 5, r.y + 5], [r.x + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]].every(([x, y]) => { const h = document.elementFromPoint(x, y); return h === e || e.contains(h); });
    const top = document.getElementById('topbar'), header = rect(top), dock = rect(document.getElementById('dock')), failures = [];
    const viewport = { x: 0, y: 0, right: innerWidth, bottom: innerHeight };
    if (!inside(header, viewport)) failures.push('header-viewport');
    const children = [...top.querySelectorAll('*')].filter(visible).map(e => ({ id: e.id || e.className || e.tagName, ...rect(e), contained: inside(rect(e), header) }));
    for (const c of children) if (!c.contained) failures.push('child-containment:' + c.id);
    const buttons = [...top.querySelectorAll('button')].filter(visible).map(e => ({ id: e.id || 'speed-' + e.dataset.speed, text: e.textContent, ...rect(e), hit: hits(e, rect(e)), font: parseFloat(getComputedStyle(e).fontSize) }));
    for (const b of buttons) {
      if (b.width < 44 || b.height < 44) failures.push('44px:' + b.id);
      if (!b.hit) failures.push('hit:' + b.id);
      if (b.font < 14) failures.push('font:' + b.id);
    }
    for (const id of ['menu-btn', 'pause', 'speed-1', 'speed-2', 'speed-4', 'army-btn']) if (!buttons.some(b => b.id === id)) failures.push('visible:' + id);
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) if (overlap(buttons[i], buttons[j])) failures.push('button-overlap');
    const pieces = [...top.querySelectorAll('button, .clocktext, #balance, #perf')].filter(visible).map(e => ({ id: e.id || e.dataset.speed || e.className, ...rect(e) }));
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) if (overlap(pieces[i], pieces[j])) failures.push('content-overlap:' + pieces[i].id + '/' + pieces[j].id);
    const texts = [], walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode, e = n.parentElement;
      if (!n.textContent.trim() || !visible(e) || e.closest('#perf')) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const bounds = [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom }));
      const full = bounds.length > 0 && bounds.every(r => inside(r, rect(e)) && inside(r, header));
      const font = parseFloat(getComputedStyle(e).fontSize);
      texts.push({ id: e.id || e.className, text: n.textContent, bounds, full, font });
      if (!full || font < 14) failures.push('text:' + (e.id || e.className));
    }
    const css = getComputedStyle(document.documentElement), published = parseFloat(css.getPropertyValue('--top-h'));
    if (Math.abs(published - header.height) > 0.5) failures.push('published-height');
    if (header.bottom + 64 > dock.y) failures.push('field-64px');
    const toggle = document.getElementById('sb-toggle'), closedToggle = toggle?.classList.contains('sb-closed') ? rect(toggle) : null;
    if (closedToggle && (overlap(closedToggle, header) || overlap(closedToggle, dock))) failures.push('closed-toggle-overlap');
    const consumers = [];
    for (const id of ['objective', 'tip', 'intro-hint', 'keyboard-targeting']) {
      const e = document.getElementById(id); if (!visible(e)) continue;
      const r = rect(e), style = getComputedStyle(e);
      const fits = r.y >= header.bottom && r.bottom <= dock.y && inside(r, viewport) && e.scrollWidth <= e.clientWidth + 1;
      consumers.push({ id, ...r, fits, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop, fullText: e.textContent, font: parseFloat(style.fontSize), touch: style.touchAction, pointer: style.pointerEvents });
      if (!fits) failures.push('field-consumer:' + id);
      if (id !== 'objective' && r.height < 44) failures.push('reading-44px:' + id);
      if (closedToggle && overlap(closedToggle, r)) failures.push('consumer-toggle:' + id);
    }
    for (let i = 0; i < consumers.length; i++) for (let j = i + 1; j < consumers.length; j++) if (overlap(consumers[i], consumers[j])) failures.push('consumer-overlap');
    const panel = document.getElementById('sb-panel');
    if (panel && innerWidth >= 900 && matchMedia('(pointer: fine)').matches && visible(panel) && overlap(header, rect(panel))) failures.push('sandbox-header-overlap');
    return { header, dock, children, buttons, texts, published, closedToggle, consumers, failures };
  });
}

async function read(page) {
  let timer;
  try { return await Promise.race([page.evaluate(async () => {
    if (window.__headerCameraWitness) await new Promise(resolve => requestAnimationFrame(resolve));
    const { game: g, input, rts, arrows, camera } = window.__game;
    return { progress: await window.__progressFixture.raw(), writes: window.__progressPuts + window.__progressLegacyWrites,
      time: g.simTime, paused: g.paused, speed: g.speed, orders: g.orders || 0,
      roster: JSON.stringify(g.units.map(u => [u.id, u.x, u.z, u.men, u.morale, u.fatigue, u.ammo, u.shots, u.casualties, u.gear, u.order.type, u.order.firm, u.order.dest, u.order.target?.id, u.order.points, u.run, u.holdFire])),
      camera: JSON.stringify([rts.goal, [rts.target.x, rts.target.z], rts.yaw, rts.pitch, rts.dist, camera.position.toArray(), camera.quaternion.toArray(), camera.near, camera.far]),
      cameraEvidence: window.__headerCameraWitness?.evidence() || null,
      terrainEase: { targetY: rts.target.y, groundY: rts.groundY },
      keys: [...rts.keys], inertia: rts.inertia, targeting: !!input.targeting,
      targetingState: input.targeting ? JSON.stringify([input.targeting.mode, input.targeting.unit.id, input.targeting.selection.map(u => u.id), input.targeting.point, input.targeting.enemy?.id, input.targeting.face, input.targeting.faceSet, input.targeting.preview, input.targeting.statusText]) : null,
      ghost: JSON.stringify({ end: arrows.previewEnd || null, keyboard: input.targeting?.preview || null }),
      selection: g.selection.map(u => u.id), prefs: localStorage.getItem('cw.settings'), locks: localStorage.getItem('cw.locks'), hidden: localStorage.getItem('cw.sandbox.hidden') };
  }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('header passive read exceeded15000ms')), 15000); })]);
  } finally { clearTimeout(timer); }
}

const cameraSame = (a, b) => a.cameraEvidence?.exact && b.cameraEvidence?.exact && a.cameraEvidence.epoch === b.cameraEvidence.epoch && b.cameraEvidence.frames > a.cameraEvidence.frames;
const passiveSame = (a, b) => ['progress', 'writes', 'time', 'paused', 'speed', 'orders', 'roster', 'targeting', 'targetingState', 'ghost'].every(k => a[k] === b[k]) && cameraSame(a, b) && a.keys.length === 0 && b.keys.length === 0 && a.inertia === null && b.inertia === null;

export async function settleCamera(page) {
  // Paused simulation still eases its camera. Conserve its exact ordinary trajectory instead of
  // requiring a static pose. This wrapper never changes the live timestep, pose or input state.
  const started = Date.now(), observations = [];
  const bounded = async work => {
    const remaining = 15000 - (Date.now() - started); let timer;
    if (remaining <= 0) throw Error('camera readiness exceeded original15000ms: ' + JSON.stringify(observations));
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('camera readiness exceeded original15000ms: ' + JSON.stringify(observations))), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  await bounded(() => page.evaluate(() => {
    if (window.__headerCameraWitness) {
      if (!window.__headerCameraWitness.evidence().exact) throw Error('Existing camera epoch failed');
      return; // Camera-neutral checkpoints retain their predictor and all prior errors.
    }
    const { rts: r, camera: c } = window.__game;
    if (r.keys.size || r.inertia) throw Error('camera baseline has active steering');
    const own = Object.getOwnPropertyDescriptor(r, 'update'), original = r.update;
    const clone = x => {
      const q = Object.assign(Object.create(Object.getPrototypeOf(x)), x, { goal: { ...x.goal }, target: x.target.clone(), camera: x.camera.clone(), keys: new Set(x.keys), inertia: x.inertia && { ...x.inertia } });
      delete q.update; return q;
    };
    const data = x => [x.goal, x.target.toArray(), x.yaw, x.pitch, x.dist, x.groundY, x.tilt, x.camera.position.toArray(), x.camera.quaternion.toArray(), x.camera.up.toArray(), x.camera.fov, x.camera.zoom, x.camera.near, x.camera.far, x.camera.aspect, x.camera.projectionMatrix.toArray(), x.camera.projectionMatrixInverse.toArray(), [...x.keys], x.inertia];
    const pose = x => JSON.stringify(data(x));
    const finite = x => typeof x === 'number' ? Number.isFinite(x) : x && typeof x === 'object' ? Object.values(x).every(finite) : true;
    const matches = (a, b) => finite(data(a)) && finite(data(b)) && pose(a) === pose(b) && a.keys.size === 0 && b.keys.size === 0 && a.inertia === null && b.inertia === null;
    const monitor = (actual, predicted, frame = () => 0) => {
      if (actual === predicted || actual.goal === predicted.goal || actual.target === predicted.target || actual.camera === predicted.camera || actual.keys === predicted.keys) throw Error('camera predictor is aliased');
      let failures = 0; const errors = [];
      const fail = (label, extra = {}) => { failures++; if (errors.length < 16) errors.push({ label, frame: frame(), ...extra }); };
      const inspect = label => { if (!matches(actual, predicted)) fail(label, { actual: pose(actual), predicted: pose(predicted) }); return pose(actual); };
      const status = () => ({ exact: failures === 0, failures, errors: [...errors] });
      return { inspect, status, fail };
    };
    const expected = clone(r), initial = pose(r), epoch = (window.__headerCameraEpoch || 0) + 1;
    window.__headerCameraEpoch = epoch;
    let frames = 0, minDt = Infinity, maxDt = 0;
    const guard = monitor(r, expected, () => frames), inspect = guard.inspect;
    const resize = () => { expected.camera.aspect = innerWidth / innerHeight; expected.camera.updateProjectionMatrix(); };
    const evidence = () => { const actual = inspect('read'); return { epoch, frames, ...guard.status(), initial, actual, expected: pose(expected), minDt: frames ? minDt : null, maxDt }; };
    const finish = () => {
      const report = evidence(); removeEventListener('resize', resize);
      if (own) Object.defineProperty(r, 'update', own); else delete r.update;
      const restored = Object.getOwnPropertyDescriptor(r, 'update');
      report.restored = r.update === original && !!restored === !!own && (!own || ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(k => restored[k] === own[k]));
      (window.__headerCameraArchive ||= []).push(report); delete window.__headerCameraWitness;
      if (!report.exact || !report.restored || frames < 2) throw Error('camera epoch failed: ' + JSON.stringify(report));
      return report;
    };
    r.update = function (dt) {
      inspect('before');
      if (!Number.isFinite(dt) || dt < 0.0001 || dt > 0.1) guard.fail('invalid actual dt', { dt });
      original.call(expected, dt); const value = original.call(this, dt);
      frames++; minDt = Math.min(minDt, dt); maxDt = Math.max(maxDt, dt); inspect('after'); return value;
    };
    addEventListener('resize', resize); window.__headerCameraWitness = { evidence, finish, clone, pose, original, matches, monitor };
  }));
  for (let i = 0; i < 2; i++) {
    const sample = await bounded(() => page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); return window.__headerCameraWitness.evidence(); }));
    sample.wall = Date.now() - started; observations.push(sample);
    if (!sample.exact) throw Error('camera trajectory mismatch: ' + JSON.stringify(sample));
  }
  if (observations[1].frames < 2 || observations[1].frames <= observations[0].frames || Date.now() - started >= 15000) throw Error('camera trajectory readiness failed original15000ms: ' + JSON.stringify(observations));
  return observations;
}

async function releaseCamera(page, result) {
  const { epochs, error } = await page.evaluate(() => {
    let error;
    try { window.__headerCameraWitness?.finish(); } catch (e) { error = e.message; }
    const epochs = window.__headerCameraArchive || []; window.__headerCameraArchive = []; return { epochs, error };
  });
  (result.headerCameraEpochs ||= []).push(...epochs);
  if (error) throw Error(error);
}

async function cameraControls(page) {
  return page.evaluate(() => {
    const { clone, pose, original, matches, monitor } = window.__headerCameraWitness, base = clone(window.__game.rts);
    const pair = () => [clone(base), clone(base)];
    const run = () => { const [a, b] = pair(), guard = monitor(a, b); for (const dt of [0.0001, 0.016, 0.1, 0.03]) { guard.inspect('before'); original.call(a, dt); original.call(b, dt); guard.inspect('after'); } return guard.status().exact; };
    const mutations = [x => x.goal.x++, x => x.keys.add('w'), x => x.inertia = { vx: 5, vz: 1 }, x => x.groundY++, x => x.camera.position.y++, x => x.camera.quaternion.x += 0.01, x => x.camera.near++, x => { x.camera.aspect++; x.camera.updateProjectionMatrix(); }, x => x.goal.x = NaN, x => x.camera.projectionMatrixInverse.elements[0]++, x => x.camera.fov++, x => x.camera.up.x++, x => x.camera.zoom++, x => x.tilt++];
    const a = run(), b = mutations.map(mutate => { const [actual, expected] = pair(), guard = monitor(actual, expected); mutate(actual); guard.inspect('before'); const beforeFailed = !guard.status().exact; original.call(actual, 0.1); original.call(expected, 0.1); guard.inspect('after'); return { beforeFailed, latchedFailed: !guard.status().exact, afterMatches: matches(actual, expected), failures: guard.status().failures }; });
    let aliasRefused = false; try { monitor(base, base); } catch (e) { aliasRefused = e.message === 'camera predictor is aliased'; }
    const a2 = run(); return { a, b, a2, aliasRefused, baseUnchanged: pose(base) === pose(window.__game.rts), detached: base !== window.__game.rts && base.goal !== window.__game.rts.goal && base.target !== window.__game.rts.target && base.camera !== window.__game.camera && base.keys !== window.__game.rts.keys };
  });
}

async function touchButton(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  await page.locator(selector).evaluate(e => {
    window.__headerEvents = [];
    window.__headerCapture = ev => { if (ev.target === e || e.contains(ev.target)) window.__headerEvents.push({ type: ev.type, trusted: ev.isTrusted, pointer: ev.pointerType || '', id: e.id || e.dataset.speed }); };
    document.addEventListener('click', window.__headerCapture, true); document.addEventListener('pointerdown', window.__headerCapture, true);
  });
  try {
    const r = await page.locator(selector).boundingBox();
    if (!r) throw Error('missing touch target ' + selector);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.__headerEvents.some(e => e.type === 'click'), null, { timeout: 15000 });
    return await page.evaluate(() => ({ events: [...window.__headerEvents], exact: window.__headerEvents.filter(e => e.type === 'click').length === 1 && window.__headerEvents.every(e => e.trusted) && window.__headerEvents.some(e => e.type === 'pointerdown' && e.pointer === 'touch') }));
  } finally {
    await cdp.detach(); await page.evaluate(() => { document.removeEventListener('click', window.__headerCapture, true); document.removeEventListener('pointerdown', window.__headerCapture, true); delete window.__headerCapture; delete window.__headerEvents; });
  }
}

export async function headerControls({ page, check, shot, result, errors }) {
  scopes(result); const unwatch = warnings(page, result);
  await page.reload(); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
  if (!await page.evaluate(() => window.__game.game.paused)) await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const viewport = page.viewportSize(), original = await read(page);
  const panelOpen = await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true';
  const side = await page.evaluate(async () => (await import('./src/settings.js')).get('look.panelSide'));
  const panel = async open => { if ((await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') !== open) await page.locator('#sb-toggle').click(); };
  const setSide = value => page.evaluate(async v => (await import('./src/settings.js')).set('look.panelSide', v), value);
  const select = async (name, add = false) => { const e = page.locator('.marker').filter({ has: page.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }); await e.focus(); await page.keyboard.press(add ? 'Shift+Enter' : 'Enter'); };
  const clear = async () => { await page.locator('#battlefield').focus(); await page.keyboard.press('Escape'); };
  const layouts = [], boundaries = []; let before, afterActions;
  try {
    await panel(false); const cameraReadiness = await settleCamera(page); before = await read(page);
    result.headerCameraReadiness = [cameraReadiness];
    for (const [width, height] of viewports) {
      const samples = [];
      for (const short of width === 320 ? [height, 480] : [height]) {
        await clear(); await page.setViewportSize({ width, height: short }); await settleHeader(page);
        const empty = await headerGeometry(page); await select('Franklin'); await settleHeader(page); const selected = await headerGeometry(page);
        await select('Willcox', true); await settleHeader(page); const group = await headerGeometry(page);
        const state = await read(page); samples.push({ width, height: short, empty, selected, group, state, passive: passiveSame(before, state) });
        await axe(page, result, `${width}x${short}`); await shot(page, `header-${width}-${short}`);
      }
      check('header-layout-' + (width === 568 ? 'landscape' : width), samples.every(s => s.passive && [s.empty, s.selected, s.group].every(g => !g.failures.length)), JSON.stringify(samples.map(s => ({ width, height: s.height, failures: [s.empty.failures, s.selected.failures, s.group.failures], header: s.group.header, dock: s.group.dock, passive: s.passive, changed: Object.keys(before).filter(k => !same(before[k], s.state[k])) }))));
      layouts.push(...samples);
    }
    await clear();
    for (const value of ['left', 'right']) {
      await setSide(value); const samples = [];
      for (const width of [900, 1024, 1440]) {
        await page.setViewportSize({ width, height: 768 }); await panel(true); await settleHeader(page); const open = await headerGeometry(page);
        await panel(false); await settleHeader(page); const closed = await headerGeometry(page); samples.push({ width, open, closed });
      }
      for (const width of [760, 761, 899, 900]) {
        await page.setViewportSize({ width, height: 568 }); await panel(false); await settleHeader(page); const closed = await headerGeometry(page);
        await panel(true); await settleHeader(page); const open = await headerGeometry(page);
        boundaries.push({ value, width, ok: width < 900 ? open.header.x === closed.header.x && open.header.right === closed.header.right : !open.failures.length, open: open.header, closed: closed.header });
        await panel(false);
      }
      check('header-sandbox-' + value, samples.every(s => !s.open.failures.length && !s.closed.failures.length) && boundaries.filter(b => b.value === value).every(b => b.ok), JSON.stringify({ samples: samples.map(s => ({ width: s.width, open: s.open.failures, closed: s.closed.failures })), boundaries: boundaries.filter(b => b.value === value) }));
      await shot(page, 'header-sandbox-' + value);
    }
    await page.setViewportSize({ width: 320, height: 568 }); await settleHeader(page);
    await page.waitForFunction(() => {
      const { game: g } = window.__game, c = g.clockText(); let us = 0, cs = 0;
      for (const u of g.units) { const men = u.state === 'routing' ? u.men * 0.3 : u.men; if (u.side === 'US') us += men; else cs += men; }
      return document.getElementById('clock-date').textContent === c.date && document.getElementById('clock-time').textContent === c.time
        && /^\d+(?:\.\d+)?%$/.test(document.getElementById('clock-bar').style.width)
        && parseFloat(document.getElementById('clock-bar').style.width) === Number((c.frac * 100).toFixed(1))
        && /^\d+(?:\.\d+)?%$/.test(document.getElementById('bal-us').style.width)
        && parseFloat(document.getElementById('bal-us').style.width) === Number((us / Math.max(1, us + cs) * 100).toFixed(1))
        && document.getElementById('bal-text').textContent === `Union ${Math.round(us)} effective, Confederate ${Math.round(cs)}`;
    }, null, { timeout: 15000 });
    const values = await page.locator('#clock-date, #clock-time, #bal-text').allTextContents();
    check('header-clock-strength', true, 'actual Game date/time/fraction and routing-weighted totals agree: ' + JSON.stringify(values));
    const menuBefore = await read(page), menuSamples = [];
    for (const key of ['Enter', 'Space']) {
      await page.locator('#menu-btn').focus(); await page.keyboard.press(key); await page.waitForFunction(() => document.getElementById('menu').open);
      const focus = await page.locator('#menu').evaluate(e => e.contains(document.activeElement));
      await page.keyboard.press('Escape'); menuSamples.push(focus && await page.locator('#menu-btn').evaluate(e => e === document.activeElement));
    }
    check('header-native-menu', menuSamples.every(Boolean) && passiveSame(menuBefore, await read(page)), JSON.stringify(menuSamples));
    const pauseSamples = [], actionBefore = await read(page);
    for (const key of ['Enter', 'Space']) {
      await page.locator('#pause').focus(); await page.keyboard.press(key); const running = await read(page);
      await page.keyboard.press(key); const paused = await read(page);
      pauseSamples.push({ key, running: !running.paused, paused: paused.paused, timeBefore: actionBefore.time, timeAfter: paused.time,
        interval: { before: actionBefore, running, paused }, legitimate: paused.time >= actionBefore.time && paused.progress === actionBefore.progress && paused.writes === actionBefore.writes });
    }
    const speedSamples = [];
    for (const [speed, key] of [[1, 'Enter'], [2, 'Space'], [4, 'Enter']]) {
      await page.locator(`[data-speed="${speed}"]`).focus(); await page.keyboard.press(key);
      speedSamples.push(await page.evaluate(s => window.__game.game.speed === s && document.querySelector(`[data-speed="${s}"]`).getAttribute('aria-pressed') === 'true', speed));
    }
    await page.locator(`[data-speed="${original.speed}"]`).focus(); await page.keyboard.press('Enter');
    check('header-native-pause-speeds', pauseSamples.every(s => s.running && s.paused && s.legitimate) && speedSamples.every(Boolean), JSON.stringify({ pauseSamples, speedSamples, noRewind: true }));
    const touch = [];
    touch.push({ action: 'menu', ...await touchButton(page, '#menu-btn'), effect: await page.locator('#menu').evaluate(e => e.open) }); await page.keyboard.press('Escape');
    for (const speed of [1, 2, 4]) touch.push({ action: 'speed-' + speed, ...await touchButton(page, `[data-speed="${speed}"]`), effect: await page.evaluate(s => window.__game.game.speed === s, speed) });
    const touchBefore = await read(page);
    for (const paused of [false, true]) touch.push({ action: paused ? 'pause' : 'play', ...await touchButton(page, '#pause'), effect: await page.evaluate(p => window.__game.game.paused === p, paused) });
    const touchAfter = await read(page);
    touch.push({ action: 'army', ...await touchButton(page, '#army-btn'), effect: await page.locator('#army').evaluate(e => !e.hidden && e.contains(document.activeElement)) });
    touch.push({ action: 'close-army', ...await touchButton(page, '#army-close'), effect: await page.locator('#army-btn').evaluate(e => document.activeElement === e && document.getElementById('army').hidden) });
    await page.locator(`[data-speed="${original.speed}"]`).focus(); await page.keyboard.press('Enter');
    check('header-trusted-touch', touch.every(s => s.exact && s.effect) && touchAfter.time >= touchBefore.time && touchAfter.progress === touchBefore.progress && touchAfter.writes === touchBefore.writes, JSON.stringify({ actions: touch, interval: { before: touchBefore, after: touchAfter } }));
    result.headerCameraReadiness.push(await settleCamera(page)); afterActions = await read(page); // Real Play intervals are never rewound.
    await page.locator('#army-btn').focus(); await page.keyboard.press('Enter');
    const row = page.locator('#army-list button').first(); await row.focus(); const rowId = await row.getAttribute('data-army-unit');
    await releaseCamera(page, result); // These two real row activations deliberately fly the map.
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => document.activeElement?.dataset.armyUnit === id && document.activeElement.isConnected && !window.__game.hud.armyDirty, rowId, { polling: 'raf', timeout: 15000 });
    const selectedFly = await page.evaluate(id => { const { game: g, rts } = window.__game, u = g.units.find(u => u.id === id); return g.selected === u && rts.goal.x === u.x && rts.goal.z === u.z && rts.goal.dist <= 650; }, rowId);
    await page.keyboard.press('Space');
    await page.waitForFunction(id => document.activeElement?.dataset.armyUnit === id && document.activeElement.isConnected && !window.__game.hud.armyDirty, rowId, { polling: 'raf', timeout: 15000 });
    result.headerCameraReadiness.push(await settleCamera(page)); await page.locator('#army').focus(); const armyBefore = await read(page);
    for (const key of ['w', 'q', 'b', 't', 'h', 'r', '1', '2', '3', 'Enter', 'Space', 'ArrowDown', 'PageDown', 'Home', 'End']) await page.keyboard.press(key);
    const armyAfter = await read(page), armyRead = passiveSame(armyBefore, armyAfter) && same(armyBefore.selection, armyAfter.selection);
    const armySamples = [];
    for (const [value, width, height] of [['left', 320, 480], ['left', 568, 320], ['right', 320, 480], ['right', 568, 320]]) {
      await setSide(value);
      await page.setViewportSize({ width, height }); await settleHeader(page); const baseline = await read(page);
      const geometry = await panelGeometry(page, 'army'); await page.locator('#army').focus(); await page.keyboard.press('End');
      await page.waitForFunction(() => { const n = document.getElementById('army'); return n.scrollTop + n.clientHeight >= n.scrollHeight - 1; }, null, { timeout: 15000 });
      const scroll = await page.locator('#army').evaluate(n => ({ top: n.scrollTop, height: n.clientHeight, full: n.scrollHeight }));
      await page.locator('#army-list button').last().focus();
      const last = await page.locator('#army-list button').last().evaluate(n => {
        const r = n.getBoundingClientRect(), p = n.closest('#army').getBoundingClientRect();
        const hits = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 5, r.y + 5], [r.right - 5, r.y + 5], [r.x + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]].map(([x, y]) => { const h = document.elementFromPoint(x, y); return h === n || n.contains(h); });
        return { connected: n.isConnected && document.activeElement === n, visible: r.top >= p.top && r.bottom <= p.bottom && hits.every(Boolean), hits, name: n.textContent };
      });
      await page.locator('#army-close').focus(); const closeHits = await page.locator('#army-close').evaluate(n => { const r = n.getBoundingClientRect(); return [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 5, r.y + 5], [r.right - 5, r.y + 5], [r.x + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]].map(([x, y]) => { const h = document.elementFromPoint(x, y); return h === n || n.contains(h); }); });
      const closeVisible = closeHits.every(Boolean) && await page.locator('#army-close').evaluate(n => { const r = n.getBoundingClientRect(), p = n.closest('#army').getBoundingClientRect(); return n === document.activeElement && r.top >= p.top && r.bottom <= p.bottom; });
      armySamples.push({ value, width, height, geometry, scroll, last, closeHits, closeVisible, passive: passiveSame(baseline, await read(page)) });
      await axe(page, result, 'army-' + value + '-' + width + '-' + height); await shot(page, 'header-army-' + value + '-' + width + '-' + height);
    }
    await page.setViewportSize({ width: 320, height: 568 }); await settleHeader(page);
    await page.keyboard.press('Escape'); const escapeFocus = await page.locator('#army-btn').evaluate(e => e === document.activeElement && document.getElementById('army').hidden);
    await page.keyboard.press('Space'); await page.locator('#army-close').focus(); await page.keyboard.press('Enter');
    const closeFocus = await page.locator('#army-btn').evaluate(e => e === document.activeElement && document.getElementById('army').hidden);
    check('header-native-army', selectedFly && armyRead && escapeFocus && closeFocus && armySamples.every(s => s.geometry.contained && s.geometry.noHorizontalClip && s.geometry.buttons.every(b => b.width >= 44 && b.height >= 44 && b.full && b.font >= 14 && b.hit) && s.scroll.top + s.scroll.height >= s.scroll.full - 1 && (s.scroll.full <= s.scroll.height || s.scroll.top > 0) && s.last.connected && s.last.visible && s.closeVisible && s.passive), JSON.stringify({ rowId, selectedFly, armyRead, escapeFocus, closeFocus, armySamples }));
    await clear(); await settleCamera(page);
    const consumers = [];
    for (const [width, height] of [[320, 480], [320, 568], [568, 320]]) {
      await page.setViewportSize({ width, height }); await settleHeader(page); const baseline = await read(page);
      const g = await headerGeometry(page), readers = [];
      for (const id of ['objective', 'tip']) {
        const e = page.locator('#' + id); await e.focus();
        const start = await e.evaluate(n => ({ top: n.scrollTop, height: n.clientHeight, scroll: n.scrollHeight, full: n.textContent, outline: getComputedStyle(n).outlineStyle }));
        for (const key of ['w', 'q', 'b', 't', 'h', 'r', '1', '2', '3', 'Space', 'End']) await page.keyboard.press(key);
        if (start.scroll > start.height) await page.waitForFunction(id => { const n = document.getElementById(id); return n.scrollTop + n.clientHeight >= n.scrollHeight - 1; }, id, { timeout: 15000 });
        const end = await e.evaluate(n => ({ top: n.scrollTop, focus: n === document.activeElement, full: n.textContent }));
        await page.keyboard.press('Home'); await page.keyboard.press('Tab'); const tabLeaves = !await e.evaluate(n => n === document.activeElement);
        readers.push({ id, start, end, tabLeaves, pass: end.focus && start.full === end.full && start.outline !== 'none' && tabLeaves && (start.scroll <= start.height || end.top > 0) });
      }
    await page.locator('#battlefield').focus(); await select('Franklin'); await page.locator('#battlefield').focus(); await page.keyboard.press('b');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await settleHeader(page);
      const targetingBefore = await read(page), targetGeometry = await headerGeometry(page); await page.locator('#keyboard-targeting').focus();
      for (const key of ['w', 'q', 'h', 'r', '1', '2', '3', 'Enter', 'Space', 'End']) await page.keyboard.press(key);
      const targetingSame = passiveSame(targetingBefore, await read(page)); await page.keyboard.press('Escape');
      const cancel = await page.evaluate(() => document.activeElement.id === 'battlefield' && !window.__game.input.targeting);
      await clear(); await settleHeader(page); const end = await read(page);
      consumers.push({ width, height, failures: g.failures, targetFailures: targetGeometry.failures, readers, targetingSame, cancel, passive: passiveSame(baseline, end) });
      await axe(page, result, 'readers-' + width + '-' + height); await shot(page, 'header-readers-' + width + '-' + height);
    }
    check('header-height-consumers', consumers.every(s => !s.failures.length && !s.targetFailures.length && s.readers.every(r => r.pass) && s.targetingSame && s.cancel && s.passive), JSON.stringify(consumers));
    await setSide('left'); await page.setViewportSize({ width: 320, height: 568 }); await settleHeader(page);
    const a = await headerGeometry(page), controlBefore = await read(page);
    const inline = () => page.locator('html, #topbar, #clock, #army-btn, #dock, #unitcard, #objective, #tip').evaluateAll(es => es.map(e => [e.id || e.tagName, e.getAttribute('style')]));
    const inlineBefore = await inline(); let b, a2;
    try {
      await page.addStyleTag({ content: '#topbar{height:52px!important;flex-wrap:nowrap!important;gap:10px!important}.header-primary,.header-secondary{display:flex!important;flex-wrap:nowrap!important;flex:none!important}#clock{display:flex!important;white-space:nowrap!important}#army-btn{display:none!important}' }).then(e => e.evaluate(n => { n.id = 'header-original-control'; }));
      await settleHeader(page); b = await headerGeometry(page);
    } finally {
      await page.locator('#header-original-control').evaluate(e => e.remove()); await settleHeader(page); a2 = await headerGeometry(page);
    }
    const inlineAfter = await inline(), controlAfter = await read(page);
    check('header-resize-restore', boundaries.every(s => s.ok) && !a.failures.length && b.failures.includes('visible:army-btn') && b.failures.some(f => f.startsWith('child-containment:')) && same(a, a2) && same(inlineBefore, inlineAfter) && passiveSame(controlBefore, controlAfter), JSON.stringify({ a: a.failures, b: b.failures, a2: a2.failures, exactGeometry: same(a, a2), exactInline: same(inlineBefore, inlineAfter), boundaries }));
    result.headerCameraControls = await cameraControls(page);
    result.header = { before, afterActions, layouts, boundaries, values, pauseSamples, speedSamples, touch, touchInterval: { before: touchBefore, after: touchAfter }, army: { rowId, selectedFly, armyBefore, armyAfter, armyRead, escapeFocus, closeFocus, armySamples }, consumers, control: { a, b, a2 } };
  } finally {
    try {
    await panel(panelOpen); await setSide(side); await page.setViewportSize(viewport); await settleHeader(page);
    await clear();
    await page.evaluate(o => { for (const [k, v] of [['cw.settings', o.prefs], ['cw.locks', o.locks], ['cw.sandbox.hidden', o.hidden]]) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } delete window.__headerSettled; delete window.__headerCamera; }, original);
    } finally { unwatch(); result.headerErrors.push(...errors); await releaseCamera(page, result); }
  }
  const after = await read(page); result.header.after = after;
  const restore = after.progress === before.progress && after.writes === before.writes && after.prefs === original.prefs && after.locks === original.locks && after.hidden === original.hidden && after.paused === original.paused && after.speed === original.speed && same(after.selection, original.selection) && after.time >= before.time;
  const control = result.headerCameraControls;
  check('header-preserved-progress', restore && control.a && control.a2 && control.baseUnchanged && control.detached && control.aliasRefused && control.b.length === 14 && control.b.every(b => b.beforeFailed && b.latchedFailed) && control.b[4].afterMatches && control.b[5].afterMatches, JSON.stringify({ restore, cameraControls: control, epochs: result.headerCameraEpochs.map(e => ({ epoch: e.epoch, frames: e.frames, exact: e.exact, restored: e.restored })) }));
  result.headerStages.sandbox = true;
}

async function terminal(page) {
  const state = await read(page);
  return { ...state, ...await page.evaluate(() => {
    const { game: g, practice: p } = window.__game;
    return { over: g.over, winner: g.result.winner, grade: p.outcome?.grade, result: JSON.stringify(g.result), outcome: JSON.stringify(p.outcome),
      pending: JSON.stringify(p.pending), saved: JSON.stringify(p.saved), rewardAbsent: !p.reward && !document.querySelector('.rw'), url: location.href };
  }) };
}

async function afterActionReturned(page, traces) {
  // PracticeUI restores focus in the dialog's close event. Observe it; never manufacture focus.
  const started = Date.now(), trace = {}; traces.push(trace); const expectedEvents = traces.length; let timer;
  try { return await Promise.race([(async () => {
  const state = () => page.evaluate(() => ({ active: document.activeElement?.id, open: document.getElementById('result').open, closeEvents: window.__headerAFcloseEvents || [] }));
  const before = await state(); trace.before = before;
  await page.waitForFunction(expected => {
    const button = document.getElementById('after-action');
    const events = window.__headerAFcloseEvents || [];
    return events.length === expected && events.every(e => !e.open && e.active === 'after-action') && !document.getElementById('result').open && button.isConnected && !button.hidden && !button.disabled && button.getClientRects().length > 0 && document.activeElement === button;
  }, expectedEvents, { polling: 'raf', timeout: Math.max(1, 15000 - (Date.now() - started)) });
  const after = await state(), elapsedMs = Date.now() - started;
  Object.assign(trace, { after, elapsedMs });
  if (elapsedMs >= 15000) throw Error('Afteraction return exceeded original15000ms');
  return trace;
  })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Afteraction return exceeded original15000ms')), 15000); })]);
  } catch (error) { trace.elapsedMs = Date.now() - started; trace.error = error.message; throw error; }
  finally { clearTimeout(timer); }
}

/** Reuse the original genuine idle defeat, after its assertion and photograph. Leave its result open. */
export async function headerAfterAction({ page, check, shot, result, errors }) {
  scopes(result); const unwatch = warnings(page, result), viewport = page.viewportSize();
  let cameraReadiness, before; const samples = [], focusReturns = [];
  result.headerAfterAction = { samples, focusReturns };
  try {
    cameraReadiness = await settleCamera(page); before = await terminal(page);
    Object.assign(result.headerAfterAction, { cameraReadiness, before });
    await page.evaluate(() => {
      window.__headerAFcloseEvents = [];
      window.__headerAFcloseListener = () => window.__headerAFcloseEvents.push({ time: performance.now(), active: document.activeElement?.id, open: document.getElementById('result').open });
      document.getElementById('result').addEventListener('close', window.__headerAFcloseListener);
    });
    const genuine = before.over && before.winner === 'CS' && before.grade === 'Defeat' && before.time < 45 && before.paused && before.rewardAbsent;
    await page.locator('#result-close').focus(); await page.keyboard.press('Enter');
    await afterActionReturned(page, focusReturns);
    const inspectFocus = await page.locator('#after-action').evaluate(e => e === document.activeElement);
    for (const [width, height] of [[320, 568], [320, 480], [375, 667], [568, 320]]) {
      await page.setViewportSize({ width, height }); await settleHeader(page); const geometry = await headerGeometry(page);
      const controls = await page.evaluate(() => ({ crates: !document.getElementById('capture-count').hidden, after: !document.getElementById('after-action').hidden, count: document.getElementById('capture-count').textContent, cratesTotal: window.__game.game.fieldCaptures.crates.length }));
      const actions = [];
      for (const key of ['Enter', 'Space']) {
        await page.locator('#after-action').focus(); await page.keyboard.press(key);
        const open = await page.locator('#result').evaluate(e => e.open && e.contains(document.activeElement));
        await axe(page, result, 'after-action-' + width + '-' + key, ['#result']);
        await page.keyboard.press('Escape'); await afterActionReturned(page, focusReturns); const returned = await page.locator('#after-action').evaluate(e => e === document.activeElement && !document.getElementById('result').open);
        actions.push({ key, open, returned });
      }
      const touch = await touchButton(page, '#after-action'); const touchOpen = await page.locator('#result').evaluate(e => e.open);
      await page.keyboard.press('Escape'); await afterActionReturned(page, focusReturns); const touchReturn = await page.locator('#after-action').evaluate(e => e === document.activeElement);
      await axe(page, result, 'conditional-' + width + '-' + height); await shot(page, 'header-after-action-' + width + '-' + height);
      const after = await terminal(page), { terrainEase: beforeEase, camera: beforePose, cameraEvidence: beforeEvidence, ...beforeConserved } = before, { terrainEase: afterEase, camera: afterPose, cameraEvidence: afterEvidence, ...afterConserved } = after;
      samples.push({ width, height, geometry, controls, actions, touch, touchOpen, touchReturn, beforeEase, afterEase, beforePose, afterPose, after, conserved: same(beforeConserved, afterConserved) && cameraSame(before, after) });
    }
    const closeEventsExact = focusReturns.length === 13 && focusReturns.every((r, i) => !r.error && r.elapsedMs < 15000 && r.after.active === 'after-action' && !r.after.open && r.after.closeEvents.length === i + 1 && r.after.closeEvents.every(e => e.active === 'after-action' && !e.open));
    check('header-after-action-native', genuine && inspectFocus && closeEventsExact && samples.every(s => s.conserved && s.actions.every(a => a.open && a.returned) && s.touch.exact && s.touchOpen && s.touchReturn), JSON.stringify({ genuine, inspectFocus, closeEventsExact, samples: samples.map(s => ({ width: s.width, height: s.height, actions: s.actions, touch: s.touch, conserved: s.conserved })) }));
    check('header-conditional-controls', samples.every(s => !s.geometry.failures.length && s.controls.crates && s.controls.after && s.controls.cratesTotal === 2 && /^Crates: \d\/2$/.test(s.controls.count)), JSON.stringify(samples.map(s => ({ width: s.width, height: s.height, failures: s.geometry.failures, header: s.geometry.header, dock: s.geometry.dock, controls: s.controls }))));
    result.headerAfterAction = { cameraReadiness, before, samples, focusReturns };
    result.headerStages.afterAction = true;
  } finally {
    try {
    await page.setViewportSize(viewport); await settleHeader(page);
    if (!await page.locator('#result').evaluate(e => e.open)) { await page.locator('#after-action').focus(); await page.keyboard.press('Enter'); }
    } finally {
      unwatch(); result.headerErrors.push(...errors);
      try { await page.evaluate(() => { document.getElementById('result').removeEventListener('close', window.__headerAFcloseListener); delete window.__headerAFcloseListener; delete window.__headerAFcloseEvents; }); }
      finally { await releaseCamera(page, result); }
    }
  }
}

async function panelGeometry(page, id) {
  return page.locator('#' + id).evaluate(e => {
    const r = e.getBoundingClientRect(), top = document.getElementById('topbar').getBoundingClientRect();
    const heading = e.querySelector('h2'), h = heading.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(heading);
    const headingText = { text: heading.textContent, full: [...range.getClientRects()].every(q => q.x >= h.x && q.right <= h.right && q.y >= h.y && q.bottom <= h.bottom) && h.x >= r.x && h.right <= r.right,
      fonts: [heading, ...heading.querySelectorAll('*')].map(n => parseFloat(getComputedStyle(n).fontSize)) };
    const contentTop = e.querySelector('.army-heading')?.getBoundingClientRect().bottom ?? r.top;
    const buttons = [...e.querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(b);
      const inPane = q.top >= (b.closest('.army-heading') ? r.top : contentTop) && q.bottom <= r.bottom;
      const hit = !inPane || [[q.x + q.width / 2, q.y + q.height / 2], [q.x + 5, q.y + 5], [q.right - 5, q.y + 5], [q.x + 5, q.bottom - 5], [q.right - 5, q.bottom - 5]].every(([x, y]) => { const h = document.elementFromPoint(x, y); return h === b || b.contains(h); });
      return { text: b.textContent, width: q.width, height: q.height, full: [...range.getClientRects()].every(t => t.x >= q.x && t.right <= q.right && t.y >= q.y && t.bottom <= q.bottom), font: parseFloat(getComputedStyle(b).fontSize), hit, inPane };
    });
    const toggle = document.querySelector('.sb-toggle.sb-closed')?.getBoundingClientRect();
    const toggleClear = !toggle || r.right <= toggle.left || r.left >= toggle.right || r.bottom <= toggle.top || r.top >= toggle.bottom;
    return { top: r.top, bottom: r.bottom, right: r.right, left: r.left, width: r.width, scroll: e.scrollHeight, height: e.clientHeight, toggleClear, heading: headingText,
      contained: r.top >= top.bottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && toggleClear && headingText.full && headingText.fonts.every(f => f >= 14),
      noHorizontalClip: e.scrollWidth <= e.clientWidth + 1, buttons };
  });
}

/** Reuse the original paused selected field after its native stores-close-focus assertion. */
export async function headerStores({ page, check, shot, result, errors }) {
  scopes(result); const unwatch = warnings(page, result), viewport = page.viewportSize(), samples = [];
  let cameraReadiness, before, march;
  try {
    cameraReadiness = await settleCamera(page); before = await read(page);
    for (const [width, height] of [[320, 480], [320, 568], [375, 667], [568, 320]]) {
      await page.setViewportSize({ width, height }); await settleHeader(page);
      const g = await headerGeometry(page), baseline = await read(page);
      await page.locator('#capture-count').focus(); await page.keyboard.press('Enter');
      const geometry = await panelGeometry(page, 'field-stores');
      const initialFocus = await page.locator('#field-stores').evaluate(e => e.contains(document.activeElement));
      await page.locator('#field-stores').focus();
      for (const key of ['w', 'q', 'b', 't', 'h', 'r', '1', '2', '3', 'Enter', 'Space', 'ArrowDown', 'PageDown', 'Home', 'End']) await page.keyboard.press(key);
      const reading = await read(page), readSame = passiveSame(baseline, reading) && same(baseline.selection, reading.selection);
      const reached = [];
      for (const button of await page.locator('#field-stores button').all()) {
        await button.focus();
        reached.push(await button.evaluate(n => {
          const r = n.getBoundingClientRect(), p = n.closest('#field-stores').getBoundingClientRect();
          const hits = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 5, r.y + 5], [r.right - 5, r.y + 5], [r.x + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]].map(([x, y]) => { const h = document.elementFromPoint(x, y); return h === n || n.contains(h); });
          return { text: n.textContent, hits, visible: document.activeElement === n && r.top >= p.top && r.bottom <= p.bottom && hits.every(Boolean) };
        }));
      }
      await page.locator('#stores-close').scrollIntoViewIfNeeded(); await page.locator('#stores-close').focus();
      const closeVisible = await page.locator('#stores-close').evaluate(e => { const r = e.getBoundingClientRect(), p = e.closest('#field-stores').getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.top >= p.top && r.bottom <= p.bottom && (h === e || e.contains(h)); });
      await axe(page, result, 'stores-' + width + '-' + height); await shot(page, 'header-stores-' + width + '-' + height);
      await page.keyboard.press('Enter'); const closeFocus = await page.locator('#capture-count').evaluate(e => e === document.activeElement && document.getElementById('field-stores').hidden);
      await page.keyboard.press('Space'); await page.keyboard.press('Escape'); const escapeFocus = await page.locator('#capture-count').evaluate(e => e === document.activeElement && document.getElementById('field-stores').hidden);
      samples.push({ width, height, g, geometry, initialFocus, baseline, reading, readSame, reached, closeVisible, closeFocus, escapeFocus });
    }
    await page.setViewportSize({ width: 320, height: 568 }); await settleHeader(page);
    const orderBefore = await read(page); await page.locator('#capture-count').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-crate-order="near-stores"]').scrollIntoViewIfNeeded();
    const touch = await touchButton(page, '[data-crate-order="near-stores"]');
    const orderAfter = await read(page), effect = await page.evaluate(() => { const g = window.__game.game, o = g.selected.order; return g.paused && o.type === 'move' && o.dest[0] === -350 && o.dest[1] === -665 && document.activeElement.id === 'battlefield' && document.getElementById('field-stores').hidden; });
    march = { touch, effect, beforeOrders: orderBefore.orders, afterOrders: orderAfter.orders, timeSame: orderBefore.time === orderAfter.time,
      progressSame: orderBefore.progress === orderAfter.progress && orderBefore.writes === orderAfter.writes,
      onlySelectedOrder: await page.evaluate(({ old, selected }) => {
        const before = JSON.parse(old), current = window.__game.game.units.map(u => [u.id, u.x, u.z, u.men, u.morale, u.fatigue, u.ammo, u.shots, u.casualties, u.gear, u.order.type, u.order.firm, u.order.dest, u.order.target?.id, u.order.points, u.run, u.holdFire]);
        return current.every((u, i) => JSON.stringify(u[0] === selected ? u.slice(0, 10).concat(u.slice(15)) : u) === JSON.stringify(before[i][0] === selected ? before[i].slice(0, 10).concat(before[i].slice(15)) : before[i]));
      }, { old: orderBefore.roster, selected: orderBefore.selection[0] }) };
    check('header-native-stores', before.paused && samples.every(s => !s.g.failures.length && s.geometry.contained && s.geometry.noHorizontalClip && s.geometry.buttons.every(b => b.width >= 48 && b.height >= 48 && b.full && b.font >= 14 && b.hit) && s.initialFocus && s.readSame && s.reached.every(b => b.visible) && s.closeVisible && s.closeFocus && s.escapeFocus)
      && march.touch.exact && march.effect && march.afterOrders === march.beforeOrders + 1 && march.timeSame && march.progressSame && march.onlySelectedOrder,
    JSON.stringify({ samples: samples.map(s => ({ width: s.width, height: s.height, headerFailures: s.g.failures, geometry: s.geometry, initialFocus: s.initialFocus, readSame: s.readSame, reached: s.reached, closeVisible: s.closeVisible, closeFocus: s.closeFocus, escapeFocus: s.escapeFocus })), march }));
    result.headerStores = { cameraReadiness, before, samples, march }; result.headerStages.stores = true;
  } finally { try { await page.setViewportSize(viewport); await settleHeader(page); } finally { unwatch(); result.headerErrors.push(...errors); await releaseCamera(page, result); } }
}

export function finishHeader({ check, result }) {
  scopes(result);
  const complete = Object.values(result.headerStages).every(Boolean);
  check('header-axe', complete && result.headerAxe.length === 0, JSON.stringify({ stages: result.headerStages, violations: result.headerAxe.map(v => ({ id: v.id, scope: v.headerScope })) }));
  check('header-no-console-errors', complete && result.headerErrors.length === 0 && result.headerWarnings.length === 0, JSON.stringify({ errors: result.headerErrors, warnings: result.headerWarnings }));
}

/** Focused header run has exactly one unforced default idle encounter and a separate paused UI load. */
export async function headerIntro({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  await probeProgress(ctx, { prefix: '__headerIntro', readFlag: '__headerIntroRead', quotaFlag: '__headerIntroQuota' });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const load = async () => { await page.goto(url + '?intro&quality=low'); await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 }); };
  try {
    await load(); await page.locator('#intro-start').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.game.over && document.getElementById('result').open, null, { timeout: 240000 });
    await headerAfterAction({ page, check, shot, result, errors });
    await load(); await page.keyboard.press('Escape'); await page.locator('#battlefield').focus(); await page.keyboard.press('Space');
    await page.getByRole('button', { name: /^1st Practice Brigade/ }).focus(); await page.keyboard.press('Enter');
    await headerStores({ page, check, shot, result, errors });
    finishHeader({ check, result });
  } finally { await ctx.close(); }
}

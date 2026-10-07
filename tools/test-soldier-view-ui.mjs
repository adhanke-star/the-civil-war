import fs from 'node:fs/promises';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { probeProgress, progressRaw } from './test-progress-browser.mjs';
import { settleCamera, settleHeader } from './test-header-ui.mjs';
import { OUT_DIR } from './prune.mjs';
import { ROOT } from './serve.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function bounded(label, work) {
  let timer;
  try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' exceeded original15000ms')), 15000); })]); }
  finally { clearTimeout(timer); }
}

// This listener is installed before Input. The late observer below uses the very same event.
function beforeInput() {
  const camera = () => {
    const c = window.__game?.camera;
    if (!c) return null;
    return Object.fromEntries([...['fov', 'near', 'far', 'zoom', 'aspect'].map(k => [k, c[k]]),
      ...['position', 'quaternion', 'up', 'scale', 'matrix', 'matrixWorld', 'matrixWorldInverse', 'projectionMatrix', 'projectionMatrixInverse'].map(k => [k, c[k].toArray()])]);
  };
  const feedback = () => {
    const x = window.__game;
    return x && { next: x.readout.next, tickT: x.readout.tickT,
      ticks: x.readout.ticks.map(t => ({ age: t.age, x: t.x, y: t.y, z: t.z, dx: t.dx, hidden: t.el.hidden, text: t.el.textContent })),
      units: x.game.units.map(u => ({ id: u.id, men: u.men, menMax: u.menMax, state: u.state, tickAcc: u.tickAcc, ammo: u.ammo, xp: u.xp,
        weapon: u.weapon, side: u.side, type: u.type, x: u.x, z: u.z, facing: u.facing,
        order: JSON.parse(JSON.stringify(u.order, (k, v) => x.game.units.includes(v) ? { unitId: v.id } : v)), equipment: u.equipment })),
      time: x.game.simTime, orders: x.game.orders, selected: x.game.selected?.id,
      selection: x.game.selection.map(u => u.id), paused: x.game.paused, speed: x.game.speed };
  };
  const mapState = () => { const r = window.__game?.rts; return r && { goal: { ...r.goal }, target: r.target.toArray(), yaw: r.yaw, pitch: r.pitch,
    dist: r.dist, groundY: r.groundY, tilt: r.tilt, keys: [...r.keys], inertia: r.inertia && { ...r.inertia } }; };
  const events = new WeakMap(), rows = [], listeners = [];
  const early = e => {
    if (!window.__game) return;
    const isI = e.key?.toLowerCase() === 'i';
    if (isI || window.__game.soldierView.active) {
      const row = { type: e.type, key: e.key, repeat: e.repeat, trusted: e.isTrusted,
        target: e.target.id || e.target.className, beforeCamera: camera(), beforeFeedback: feedback(), beforeMap: mapState(), wasActive: window.__game.soldierView.active,
        admission: (() => { const x = window.__game, v = x.soldierView, u = x.game.selected;
          return { canBegin: v.canBegin(e), eligible: v.eligible(u), fieldFocus: v.isFieldFocus(e), focus: document.activeElement.id,
            modal: [...document.querySelectorAll('dialog[open]')].map(d => d.id), drag: !!x.input.drag, pointers: x.input.pointers.size,
            targeting: !!x.input.targeting, preview: !!x.arrows.preview, previewEnd: !!x.arrows.previewEnd,
            formation: u?.formation, figureSample: u?.figures.filter(f => f.alive && !f.gone && !f.skirmisher && !f.mount).slice(0, 2) }; })(),
        mapFlag: (() => { const x = window.__game, e = x.hud.markers.get(x.game.selected?.id)?.el; if (!e) return null;
          const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + Math.min(r.height / 2, 25)]; })() };
      events.set(e, row); rows.push(row);
    }
  };
  for (const t of ['keydown', 'keyup', 'pointerdown', 'dblclick', 'wheel']) { addEventListener(t, early, true); listeners.push([t, early]); }
  window.__soldierWitness = { camera, feedback, mapState, rows, events, listeners, entry: null };
}

async function observers(page) {
  await page.evaluate(async () => {
    const { markerPosition } = await import('./src/ui/hud.js'); // Existing source-locked pure layout oracle.
    const w = window.__soldierWitness, x = window.__game;
    w.targets = [x.post.rtScene, x.post.rtSmall, x.post.rtBlur];
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const overlay = () => {
      const camera = x.camera, failures = [], markerRects = [], shown = [], expectedStyle = document.createElement('span').style;
      const bounds = { left: 4, right: innerWidth - 4, top: document.getElementById('topbar').getBoundingClientRect().bottom + 4, bottom: innerHeight - 4 };
      const obstacles = ['unitcard', 'orders', 'minimap-box', 'objective', 'tip', 'intro-hint', 'army', 'field-stores', 'feed', 'moment-banner', 'keyboard-targeting'].flatMap(id => {
        const e = document.getElementById(id), r = e.getBoundingClientRect();
        return !e.hidden && r.width > 0 && r.height > 0 ? [{ x: r.x + r.width / 2, y: r.bottom, w: r.width, h: r.height }] : [];
      });
      for (const [id, m] of x.hud.markers) {
        const u = x.game.units.find(u => u.id === id);
        if (!u) continue;
        const p = camera.position.clone().set(u.x, x.terrain.heightAt(u.x, u.z) + 16, u.z).project(camera);
        const hidden = !u.alive || p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1;
        if (m.el.classList.contains('hidden') !== hidden) failures.push('marker-visibility:' + id);
        if (hidden) continue;
        const r = m.el.getBoundingClientRect();
        markerRects.push({ id, x: r.x, y: r.y, width: r.width, height: r.height, cacheW: m.w, cacheH: m.h, transform: m.el.style.transform,
          expected: [(p.x * .5 + .5) * innerWidth, (-p.y * .5 + .5) * innerHeight] });
        const anchor = [(p.x * .5 + .5) * innerWidth, (-p.y * .5 + .5) * innerHeight];
        // Cached layout sizes are checked against independent DOM sizes below; transformed
        // DOM rectangles can differ by subpixel float rounding at collision boundaries.
        shown.push({ id, m, x: anchor[0], y: anchor[1], w: m.w, h: m.h });
        if (!m.anchor || Math.abs(m.anchor.x - anchor[0]) > 1e-8 || Math.abs(m.anchor.y - anchor[1]) > 1e-8) failures.push('marker-anchor:' + id);
        if (getComputedStyle(m.el).visibility === 'hidden' || r.width <= 0 || r.height <= 0 || Math.abs(m.w - r.width) > .5 || Math.abs(m.h - r.height) > .5) failures.push('marker-layout:' + id);
      }
      shown.sort((a, b) => b.y - a.y);
      const placed = [];
      for (const s of shown) {
        const p = markerPosition(s, placed, bounds, obstacles); placed.push({ ...p, w: s.w, h: s.h });
        const transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
        expectedStyle.transform = transform;
        Object.assign(markerRects.find(r => r.id === s.id), { rawExpectedTransform: transform, expectedTransform: expectedStyle.transform });
        if (s.m.el.style.transform !== expectedStyle.transform) failures.push('marker-placement:' + s.id);
      }
      const ticks = x.readout.ticks.filter(t => t.age < 1.6).map(t => {
        const p = camera.position.clone().set(t.x, t.y, t.z).project(camera);
        const transform = `translate(${((p.x * .5 + .5) * innerWidth + t.dx).toFixed(1)}px, ${((-p.y * .5 + .5) * innerHeight - 10 - t.age * 26).toFixed(1)}px) translate(-50%, -100%)`;
        const opacity = p.z > 1 ? '0' : String(Math.min(1, 2.2 * (1 - t.age / 1.6)).toFixed(2));
        expectedStyle.transform = transform; expectedStyle.opacity = opacity;
        if (t.el.style.opacity !== expectedStyle.opacity || (p.z <= 1 && t.el.style.transform !== expectedStyle.transform)) failures.push('tick-projection');
        return { transform: t.el.style.transform, rawExpected: transform, expected: expectedStyle.transform, opacity: t.el.style.opacity, rawExpectedOpacity: opacity, expectedOpacity: expectedStyle.opacity };
      });
      const foot = x.rts.footprint([]).map(p => [...p]);
      if (!equal(foot, x.hud.minimap.foot)) failures.push('minimap-footprint');
      const mpp = 2 * x.rts.dist * Math.tan(camera.fov * Math.PI / 360) / innerHeight;
      if (Math.abs(mpp - x.arrows.mpp) / x.arrows.mpp > .04 + 1e-12) failures.push('arrow-map-scale');
      const crates = x.game.fieldCaptures.crates.map(c => {
        const p = camera.position.clone().set(c.x, x.terrain.heightAt(c.x, c.z) + 10, c.z).project(camera), e = document.querySelector('[data-crate="' + c.id + '"]');
        const hidden = p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05;
        if (!e || e.hidden !== hidden) failures.push('crate-visibility:' + c.id);
        if (hidden) return { id: c.id, hidden: true };
        if (!e) return { id: c.id, missing: true };
        const connector = e.previousElementSibling, circle = connector.querySelector('circle');
        if (!circle || Math.abs(Number(circle.getAttribute('cx')) - (p.x * .5 + .5) * innerWidth) > 1e-8
          || Math.abs(Number(circle.getAttribute('cy')) - (-p.y * .5 + .5) * innerHeight) > 1e-8) failures.push('crate-anchor:' + c.id);
        return { id: c.id, hidden: false, transform: e.style.transform };
      });
      return { heldClass: document.body.classList.contains('soldier-view'), hintHidden: document.getElementById('soldier-view-hint').hidden,
        arrows: x.arrows.group.visible, lines: x.readout.mesh.visible, markerRects,
        ticks, foot, arrowMpp: x.arrows.mpp, expectedMpp: mpp, crates, failures };
    };
    const late = e => {
      const row = w.events.get(e); if (!row) return;
      row.afterCamera = w.camera(); row.afterFeedback = w.feedback(); row.afterMap = w.mapState(); row.active = x.soldierView.active;
      row.focus = document.activeElement.id || document.activeElement.className;
      if (e.type === 'keydown' && e.key.toLowerCase() === 'i' && !row.wasActive && row.active) {
        w.entry = row; w.liveSnapshot = x.soldierView.snapshot; w.liveDepth = x.post.rtScene.depthTexture;
        w.lod.epoch++;
      }
      if (row.wasActive && !row.active) {
        row.sameEvent = true; row.feedbackConserved = equal(row.beforeFeedback, row.afterFeedback);
        row.exactReturn = equal(w.entry?.beforeCamera, row.afterCamera) && equal(w.entry?.beforeMap, row.afterMap); row.overlay = overlay();
      }
    };
    for (const t of ['keydown', 'keyup', 'pointerdown', 'dblclick', 'wheel']) { addEventListener(t, late, true); w.listeners.push([t, late]); }
    const wrappers = [], calls = [];
    w.lostRenderAttempts = 0; w.lostTargetCalls = 0;
    const renderer = x.post.renderer, ownTarget = Object.getOwnPropertyDescriptor(renderer, 'setRenderTarget'), setTarget = renderer.setRenderTarget;
    renderer.setRenderTarget = function (...args) { if (this.getContext().isContextLost()) w.lostTargetCalls++;
      return setTarget.apply(this, args); };
    wrappers.push({ obj: renderer, key: 'setRenderTarget', own: ownTarget, original: setTarget });
    const wrap = (obj, key) => {
      const own = Object.getOwnPropertyDescriptor(obj, key), original = obj[key];
      obj[key] = function (...args) {
        const row = { method: key, active: x.soldierView.active, camera: w.camera(), entry: w.entry?.beforeCamera,
          overlay: overlay(), receiver: this === obj, args: args.map(a => typeof a === 'object' ? a?.type || null : a) };
        calls.push(row); return original.apply(this, args);
      };
      wrappers.push({ obj, key, own, original });
    };
    for (const k of ['down']) wrap(x.input, k);
    for (const k of ['zoomAt', 'panPixels', 'rotateBy', 'flyTo']) wrap(x.rts, k);
    const frames = [], ownView = Object.getOwnPropertyDescriptor(x.game, 'setView'), setView = x.game.setView;
    const lod = { epoch: 0, frames: 0, calls: 0, firstFrameCalls: 0, failures: [], near: [], crossings: [] }, previous = new WeakMap();
    x.game.setView = function (...args) {
      if (x.soldierView.active) frames.push({ phase: 'pre', sameCamera: args[0] === x.camera, camera: w.camera(),
        figure: { x: x.soldierView.figure.x, z: x.soldierView.figure.z, yaw: x.soldierView.figure.yaw }, simTime: x.game.simTime });
      const value = setView.apply(this, args);
      if (x.soldierView.active) {
        lod.frames++; lod.preCamera = x.camera.position.toArray();
        for (const pool of [x.game.pools.US, x.game.pools.CS, x.game.impostors.US, x.game.impostors.CS])
          if (!equal(pool.cam.toArray(), lod.preCamera)) lod.failures.push('first/pre-LOD camera');
      }
      return value;
    };
    wrappers.push({ obj: x.game, key: 'setView', own: ownView, original: setView });
    const animatedUnits = new WeakSet(), ownAnimate = Object.getOwnPropertyDescriptor(x.game, 'animate'), animate = x.game.animate;
    x.game.animate = function (...args) {
      for (const u of this.units) if (!animatedUnits.has(u)) {
        const own = Object.getOwnPropertyDescriptor(u, 'animate'), original = u.animate;
        u.animate = function (...values) { const prior = lod.unit; lod.unit = this;
          try { return original.apply(this, values); } finally { lod.unit = prior; } };
        wrappers.push({ obj: u, key: 'animate', own, original }); animatedUnits.add(u);
      }
      return animate.apply(this, args);
    };
    wrappers.push({ obj: x.game, key: 'animate', own: ownAnimate, original: animate });
    for (const [side, pool] of Object.entries(x.game.pools)) {
      const own = Object.getOwnPropertyDescriptor(pool, 'push'), original = pool.push;
      pool.push = function (...args) {
        if (!x.soldierView.active) return original.apply(this, args);
        const before = this.buckets.map(b => b.n), c = lod.preCamera;
        const distance = Math.hypot(args[0] - c[0], args[1] - c[1], args[2] - c[2]), expected = distance < 300 ? 0 : distance < 700 ? 1 : 2;
        const value = original.apply(this, args), changed = this.buckets.map((b, i) => b.n - before[i]);
        lod.calls++; if (lod.frames === 1) lod.firstFrameCalls++;
        if (changed[expected] !== 1 || changed.some((v, i) => i !== expected && v !== 0)) lod.failures.push({ side, distance, expected, changed });
        if (Math.abs(distance - 300) <= 10 && lod.near.length < 40) lod.near.push({ side, distance, expected, changed });
        const unit = lod.unit, figure = unit && side === unit.side && unit.figures.find(f => f.alive && !f.gone && f.x === args[0] && f.z === args[2]);
        if (figure) {
          const prior = previous.get(figure);
          if (prior && prior.epoch === lod.epoch && prior.bucket !== expected && lod.crossings.length < 120)
            lod.crossings.push({ epoch: lod.epoch, time: x.game.simTime, id: unit.id, i: figure.i, from: prior, to: { bucket: expected, distance } });
          previous.set(figure, { epoch: lod.epoch, bucket: expected, distance });
        }
        return value;
      };
      wrappers.push({ obj: pool, key: 'push', own, original });
    }
    const ownRender = Object.getOwnPropertyDescriptor(x.post, 'render'), render = x.post.render;
    x.post.render = function (...args) {
      if (this.renderer.getContext().isContextLost()) w.lostRenderAttempts++;
      if (x.soldierView.active) frames.push({ phase: 'post', sameCamera: args[1] === x.camera, camera: w.camera(),
        figure: { x: x.soldierView.figure.x, z: x.soldierView.figure.z, yaw: x.soldierView.figure.yaw }, simTime: x.game.simTime,
        depth: !!x.post.rtScene.depthTexture, linesHidden: !x.readout.mesh.visible });
      return render.apply(this, args);
    };
    wrappers.push({ obj: x.post, key: 'render', own: ownRender, original: render });
    Object.assign(w, { calls, frames, lod, overlay, finish: () => {
      const restored = wrappers.map(({ obj, key, own, original }) => {
        if (own) Object.defineProperty(obj, key, own); else delete obj[key];
        const now = Object.getOwnPropertyDescriptor(obj, key);
        return obj[key] === original && !!now === !!own && (!own || ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(k => now[k] === own[k]));
      });
      for (const [t, f] of w.listeners) removeEventListener(t, f, true);
      return restored.every(Boolean);
    } });
  });
}

async function frames(page, count = 2) {
  await bounded('native frame observation', () => page.evaluate(n => new Promise(resolve => { const next = () => --n <= 0 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next); }), count));
}

const read = (page, offsets = {}) => bounded('native state read', () => page.evaluate(offsets => {
  const x = window.__game, v = x.soldierView, w = window.__soldierWitness;
  return { active: v.active, held: v.held, latched: v.latched, selected: x.game.selected?.id,
    figure: v.figure && { i: v.figure.i, x: v.figure.x, z: v.figure.z, yaw: v.figure.yaw },
    camera: w.camera(), feedback: w.feedback(), focus: document.activeElement.id || document.activeElement.className,
    depth: !!x.post.rtScene.depthTexture, hint: !document.getElementById('soldier-view-hint').hidden,
    rows: w.rows.slice(offsets.rowsSince ?? -12), calls: w.calls.slice(offsets.callsSince ?? -12), frames: w.frames.slice(-20),
    rowCount: w.rows.length, callCount: w.calls.length, frameCount: w.frames.length, overlay: w.overlay(),
    renderer: x.post.renderer.info.memory, programs: x.post.renderer.info.programs.length,
    targets: [x.post.rtScene, x.post.rtSmall, x.post.rtBlur].map((t, i) => [t === w.targets[i], t.texture.uuid, t.width, t.height]),
    targeting: !!x.input.targeting, goal: { ...x.rts.goal } };
}, offsets));

async function geometry(page) {
  return page.evaluate(() => {
    const rect = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      font: parseFloat(getComputedStyle(e).fontSize), scroll: e.scrollWidth <= e.clientWidth + 1 }; };
    const hint = rect('soldier-view-hint'), objective = rect('objective'), dock = rect('dock'), panel = rect('sb-panel');
    const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    return { hint, objective, dock, panel, fits: hint.x >= 0 && hint.right <= innerWidth && hint.y >= objective.bottom
      && hint.bottom <= dock.y && hint.height >= 44 && hint.font >= 14 && hint.scroll,
      panelOverlap: !document.getElementById('sb-panel').hidden && overlap(hint, panel) };
  });
}

async function depthFixture(page, result) {
  const evidence = await page.evaluate(async () => {
    const T = await import('three'); // All imports finish before the synchronous A/B/A2 transaction.
    const { post, scene: field, camera: map } = window.__game, r = post.renderer, gl = r.getContext();
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    if (width !== 896 || height !== 560 || post.rtScene.width !== width || post.rtScene.height !== height) throw Error('Depth fixture requires actual896x560 low target');
    if (post.soldierView) throw Error('Depth fixture needs unowned map Post');
    const before = { target: r.getRenderTarget(), viewport: r.getViewport(new T.Vector4()), scissor: r.getScissor(new T.Vector4()),
      scissorTest: r.getScissorTest(), clear: r.getClearColor(new T.Color()), alpha: r.getClearAlpha(), quad: post.quad.material,
      uniforms: Object.fromEntries(Object.entries(post.finalMat.uniforms).map(([k, u]) => [k, { ref: u, value: u.value?.isVector2 ? u.value.clone() : u.value }])),
      shader: post.finalMat.fragmentShader };
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, width / height, 1, 128);
    camera.updateMatrixWorld(true);
    const data = new Uint8Array(96 * 96 * 4);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4, v = Math.round((.45 + .30 * Math.cos(2 * Math.PI * x / 8)) * 255);
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
    const tex = new T.DataTexture(data, 96, 96); tex.colorSpace = T.NoColorSpace;
    tex.minFilter = tex.magFilter = T.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const material = new T.MeshBasicMaterial({ map: tex }), geometries = [];
    for (const [i, z] of [8, 16, 32].entries()) {
      const size = 2 * z * Math.tan(Math.PI / 6) * 96 / height;
      const g = new T.PlaneGeometry(size, size); geometries.push(g);
      const mesh = new T.Mesh(g, material); mesh.position.set((i - 1) * .5 * z * Math.tan(Math.PI / 6) * camera.aspect, 0, -z); scene.add(mesh);
    }
    let control, owned, originalEye;
    const capture = () => {
      post.render(scene, camera);
      const bytes = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      const png = r.domElement.toDataURL('image/png'); // Same render task; no RAF or await in between.
      const decode = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      const amplitudes = [.25, .5, .75].map(cx => {
        let amplitude = 0;
        for (let y = height / 2 - 32; y < height / 2 + 32; y++) {
          const row = [];
          for (let x = width * cx - 32; x < width * cx + 32; x++) {
            const p = (y * width + x) * 4;
            row.push(.2126 * decode(bytes[p] / 255) + .7152 * decode(bytes[p + 1] / 255) + .0722 * decode(bytes[p + 2] / 255));
          }
          const mean = row.reduce((a, b) => a + b) / 64;
          let real = 0, imaginary = 0;
          for (let i = 0; i < 64; i++) { real += (row[i] - mean) * Math.cos(2 * Math.PI * i / 8); imaginary += (row[i] - mean) * Math.sin(2 * Math.PI * i / 8); }
          amplitude += 2 * Math.hypot(real, imaginary) / 64;
        }
        return amplitude / 64;
      });
      return { bytes, png, amplitudes };
    };
    try {
      r.setScissorTest(false); r.setClearColor(0x000000, 1);
      post.beginSoldierView(camera, 16); owned = post.soldierView; originalEye = owned.material;
      const a = capture();
      control = new T.ShaderMaterial({ vertexShader: owned.material.vertexShader, fragmentShader: owned.material.fragmentShader,
        uniforms: owned.material.uniforms, depthTest: false, depthWrite: false });
      const original = before.shader, start = original.indexOf('        // tilt-shift:'), end = original.indexOf('        vec3 col =', start);
      const startEye = control.fragmentShader.indexOf('        float nearPlane'), endEye = control.fragmentShader.indexOf('        vec3 col =', startEye);
      control.fragmentShader = control.fragmentShader.slice(0, startEye) + original.slice(start, end) + control.fragmentShader.slice(endEye);
      control.needsUpdate = true; owned.material = control;
      const b = capture(); owned.material = post.quad.material = originalEye;
      const a2 = capture();
      const ratios = a.amplitudes.map((v, i) => v / b.amplitudes[i]), ratios2 = a2.amplitudes.map((v, i) => v / b.amplitudes[i]);
      const accepts = values => b.amplitudes.every(v => v > .03) && values[0] <= .5 && values[1] >= .8 && values[2] <= .5;
      return { width, height, depths: [8, 16, 32], focus: 16, a: a.amplitudes, b: b.amplitudes, a2: a2.amplitudes,
        ratios, ratios2, positive: accepts(ratios), intendedControlFails: !accepts([1, 1, 1]), restored: accepts(ratios2),
        byteExact: a.bytes.every((v, i) => v === a2.bytes[i]), pngs: [a.png, b.png, a2.png],
        limitations: 'Controlled opaque fixture only; smoke and soft depthWrite:false edges use underlying opaque depth.' };
    } finally {
      if (owned) { owned.material = originalEye; post.endSoldierView(); }
      control?.dispose(); for (const g of geometries) g.dispose(); material.dispose(); tex.dispose();
      for (const [k, u] of Object.entries(before.uniforms)) { post.finalMat.uniforms[k] = u.ref; if (u.value?.isVector2) u.ref.value.copy(u.value); else u.ref.value = u.value; }
      post.quad.material = before.quad; r.setClearColor(before.clear, before.alpha);
      post.render(field, map);
      r.setRenderTarget(before.target); r.setViewport(before.viewport); r.setScissor(before.scissor); r.setScissorTest(before.scissorTest); r.setClearColor(before.clear, before.alpha);
      if (r.getRenderTarget() !== before.target || !r.getViewport(new T.Vector4()).equals(before.viewport)
        || !r.getScissor(new T.Vector4()).equals(before.scissor) || r.getScissorTest() !== before.scissorTest
        || !r.getClearColor(new T.Color()).equals(before.clear) || r.getClearAlpha() !== before.alpha) throw Error('Depth fixture renderer restoration failed');
    }
  });
  const stamp = result.timestamp.replace(/[:.]/g, '-');
  for (const [i, png] of evidence.pngs.entries()) {
    const file = path.join(OUT_DIR, `m1-soldier-depth-${['a', 'b', 'a2'][i]}-${stamp}.png`);
    await fs.writeFile(file, Buffer.from(png.split(',')[1], 'base64'), { flag: 'wx' }); result.screenshots.push(path.relative(ROOT, file));
  }
  delete evidence.pngs; return evidence;
}

export async function soldierViewControls({ browser, url, check, shot, result, watchErrors, native, focused = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await probeProgress(ctx, { prefix: '__soldier', readFlag: '__soldierRead', quotaFlag: '__soldierQuota' });
  await ctx.addInitScript(beforeInput);
  const page = await ctx.newPage(), errors = [], warnings = [], driverWarnings = [], evidence = {};
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(180000); result.soldierView = evidence;
  watchErrors(page, url, errors);
  page.on('console', m => { if (m.type() === 'warning') (/GL Driver Message|GPU stall|already non-indexed/.test(m.text()) ? driverWarnings : warnings).push(m.text()); });
  let finished = false, generic;
  const record = (name, ok, data) => { evidence[name] = data; check('soldier-view-' + name, ok, JSON.stringify(data).slice(0, 1800) + ' (full evidence: result.soldierView)'); };
  const field = page.locator('#battlefield');
  const select = async (name = 'Franklin') => bounded('native selection ' + name, async () => {
    const flag = page.locator('#markers button').filter({ hasText: name }).first();
    if (await flag.isVisible()) { await flag.focus(); await page.keyboard.press('Enter'); }
    else {
      if (await page.locator('#army').isHidden()) await page.locator('#army-btn').click();
      await page.locator('#army-list button').filter({ hasText: name }).first().focus(); await page.keyboard.press('Enter');
      await page.locator('#army-close').click();
    }
    await frames(page);
  });
  const closeWorkbench = async () => { if (await page.locator('#sb-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#sb-toggle').click(); };
  const openWorkbench = async () => { if (await page.locator('#sb-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#sb-toggle').click(); };
  const begin = async ({ flag = false } = {}) => {
    await page.keyboard.up('i');
    if (!flag) await field.focus();
    await page.keyboard.down('i'); await frames(page);
    const value = await read(page); if (!value.active) throw Error('Native I admission failed: ' + JSON.stringify({ focus: value.focus, held: value.held, latched: value.latched,
      entries: value.rows.filter(r => r.type === 'keydown' && r.key === 'i').slice(-1), frameCount: value.frames.length }));
    return value;
  };
  const end = async () => { await page.keyboard.up('i'); return read(page); };
  const refuse = async () => {
    const before = await read(page); await page.keyboard.press('i'); const after = await read(page);
    return { pass: !after.active && !after.depth && same(before.feedback, after.feedback) && before.focus === after.focus
      && before.targeting === after.targeting, before: before.feedback, after: after.feedback, focus: after.focus };
  };
  const scope = async label => {
    const report = await new AxeBuilder({ page }).include('#soldier-view-hint').include('#battlefield').include('#topbar').analyze();
    result.soldierViewAxe.push(...report.violations.map(v => ({ ...v, soldierScope: label })));
  };
  result.soldierViewAxe = [];
  try {
    await page.goto(url + '?sandbox&quality=low', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && document.getElementById('sb-panel'), null, { timeout: 180000 });
    if (!await page.evaluate(() => window.__game.game.paused)) await page.locator('#pause').click();
    await closeWorkbench(); await settleHeader(page); await observers(page);
    if (native && focused) {
      const renderer = await page.evaluate(() => { const gl = window.__game.post.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
      check('soldier-view-native-renderer', !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
    }
    const progressBefore = await progressRaw(page), writesBefore = await page.evaluate(() => [window.__progressPuts, window.__progressLegacyWrites]);
    await select();
    const originalMapResources = await read(page);
    const held = await begin({ flag: true });
    const initial = await page.evaluate(() => {
      const { soldierView: v, game, camera, terrain } = window.__game, f = v.figure;
      const candidates = game.selected.figures.filter(q => q.alive && !q.gone && !q.skirmisher && !q.mount)
        .sort((a, b) => a.rank - b.rank || (game.selected.formation === 'column' ? a.cfile - b.cfile : a.lx - b.lx) || a.i - b.i);
      window.__soldierInitial = { snapshot: v.snapshot, figure: f, depth: window.__game.post.rtScene.depthTexture };
      const s = 4.4 * v.scale(), x = f.x - Math.cos(f.yaw) * 1.8 * s + Math.sin(f.yaw) * .7 * s,
        z = f.z + Math.sin(f.yaw) * 1.8 * s + Math.cos(f.yaw) * .7 * s;
      return { actualFront: f === candidates[0], exactPose: camera.position.x === x && camera.position.z === z
        && camera.position.y === terrain.heightAt(x, z) + 1.64 * s, focus: v.focus, planes: [camera.fov, camera.near, camera.far],
        selected: game.selected.id, mainBody: !f.skirmisher && !f.mount, entryTrusted: window.__soldierWitness.entry.trusted };
    });
    await shot(page, 'soldier-held-rigged'); await scope('held-rigged');
    record('native-held', held.active && held.depth && held.hint && held.focus === 'battlefield' && initial.actualFront && initial.exactPose
      && initial.entryTrusted && same(initial.planes, [55, .3, 6000]) && held.frames.some(f => f.phase === 'pre' && f.sameCamera)
      && held.frames.some(f => f.phase === 'post' && f.sameCamera && f.linesHidden), initial);
    const returned = await end(), release = returned.rows.filter(r => r.type === 'keyup' && r.wasActive).at(-1);
    await frames(page, 2); const firstReturnResources = await read(page);
    evidence.initialResourceReturn = { before: { memory: originalMapResources.renderer, programs: originalMapResources.programs, targets: originalMapResources.targets },
      after: { memory: firstReturnResources.renderer, programs: firstReturnResources.programs, targets: firstReturnResources.targets },
      exact: same(originalMapResources.renderer, firstReturnResources.renderer) && originalMapResources.programs === firstReturnResources.programs
        && same(originalMapResources.targets, firstReturnResources.targets) };
    const primaryReleaseOK = release?.trusted && release.sameEvent && release.exactReturn && release.feedbackConserved && !returned.active
      && !returned.depth && !returned.hint && !release.overlay.heldClass && release.overlay.failures.length === 0;
    evidence['native-release'] = release;
    await shot(page, 'soldier-return-map'); await scope('return-map');

    await field.focus(); await page.keyboard.press('Escape'); const noSelection = await refuse();
    const unsupported = await page.evaluate(() => window.__game.game.units.filter(u => u.alive && (u.type !== 'infantry' || u.side !== 'US')).slice(0, 3).map(u => u.short));
    const refused = [{ kind: 'none', ...noSelection }];
    for (const name of unsupported) { await select(name); await field.focus(); refused.push({ kind: name, ...await refuse() }); }
    // Controlled invalidation stays on a disposable generic unit, never a restored historical roster.
    const spawn = async () => {
      await openWorkbench(); await page.getByRole('tab', { name: 'Units', exact: true }).click();
      await page.getByRole('button', { name: 'Spawn Union brigade at view centre', exact: true }).click();
      generic = await page.evaluate(() => window.__game.game.selected.id);
      await closeWorkbench(); await frames(page); await field.focus();
      return generic;
    };
    const remove = async () => {
      await end(); await openWorkbench(); await page.getByRole('tab', { name: 'Units', exact: true }).click();
      await page.getByRole('button', { name: 'Remove selected', exact: true }).click(); generic = null; await closeWorkbench();
    };
    await spawn();
    const feedbackFixture = await page.evaluate(() => { const x = window.__game, u = x.game.selected, before = u.men;
      if (!u.id.startsWith('sandbox-')) throw Error('Feedback fixture must be disposable generic');
      x.readout.spawn(u, 1); return { unit: u.id, men: u.men, menUnchanged: before === u.men, diagnosticOnly: true,
        label: 'Readout.spawn generic display fixture; not an actual combat casualty' }; });
    await begin(); const tickReturned = await end(), tickRelease = tickReturned.rows.filter(r => r.type === 'keyup' && r.wasActive).at(-1);
    release.activeTickReturn = tickRelease; release.feedbackFixture = feedbackFixture;
    record('native-release', primaryReleaseOK && feedbackFixture.menUnchanged && tickRelease?.trusted && tickRelease.sameEvent
      && tickRelease.exactReturn && tickRelease.feedbackConserved && tickRelease.overlay.failures.length === 0
      && tickRelease.overlay.ticks.length > 0 && tickRelease.overlay.ticks.some(t => Number(t.opacity) > 0), release);
    await page.evaluate(() => { window.__game.game.selected.men = 0; }); refused.push({ kind: 'controlled-generic-depleted', ...await refuse() }); await remove();
    await spawn(); await openWorkbench(); await page.getByRole('tab', { name: 'Moments', exact: true }).click();
    await page.getByRole('button', { name: 'Selected: rout', exact: true }).click(); await closeWorkbench(); await field.focus();
    refused.push({ kind: 'native-generic-rout', ...await refuse() }); await remove();
    record('refusal', refused.length >= 4 && refused.every(r => r.pass) && unsupported.length >= 2, refused);

    await select(); await field.focus(); await page.keyboard.press('b'); await page.keyboard.press('ArrowUp');
    const ghostBefore = await page.evaluate(() => JSON.stringify(window.__game.input.targeting)), ghost = await refuse();
    const ghostAfter = await page.evaluate(() => JSON.stringify(window.__game.input.targeting)); await page.keyboard.press('Escape');
    const pointerOwnership = await page.evaluate(() => {
      const { input, soldierView } = window.__game, canvas = document.getElementById('battlefield'), answer = [];
      for (const owner of ['drag', 'pointers']) {
        if (owner === 'drag') input.drag = { mode: 'pan' }; else input.pointers.set(987654, { x: 1, y: 1 });
        answer.push(!soldierView.begin({ target: canvas }));
        if (owner === 'drag') input.drag = null; else input.pointers.delete(987654);
      }
      return answer;
    });
    record('ghost-preserved', ghost.pass && ghostBefore === ghostAfter && pointerOwnership.every(Boolean), { ghost, ghostExact: ghostBefore === ghostAfter, pointerOwnership, adapterLabel: 'bounded nonnative drag/pointer ownership admission' });

    await openWorkbench(); await page.getByRole('tab', { name: 'Look', exact: true }).click();
    const uiRefusals = [];
    for (const owner of [page.getByRole('slider', { name: 'Figure size', exact: true }), page.locator('#army-btn')]) { await owner.focus(); uiRefusals.push(await refuse()); }
    await page.locator('#army-btn').click(); await page.locator('#army').focus(); uiRefusals.push(await refuse()); await page.locator('#army-close').click();
    await select(); await begin(); const fineGeometry = await geometry(page); await end();
    const cdp = await ctx.newCDPSession(page);
    const panelSide = await page.evaluate(async () => (await import('./src/settings.js')).get('look.panelSide'));
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true }); await begin(); const coarseGeometry = await geometry(page); await end();
      evidence.coarseHint = coarseGeometry;
      await page.evaluate(async () => (await import('./src/settings.js')).set('look.panelSide', 'left'));
      await frames(page, 3); await begin(); evidence.coarseLeftHint = await geometry(page); await end();
    } finally { await page.evaluate(async side => (await import('./src/settings.js')).set('look.panelSide', side), panelSide);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach(); }
    record('ui-isolation', uiRefusals.every(r => r.pass) && fineGeometry.fits && !fineGeometry.panelOverlap
      && evidence.coarseHint.fits && !evidence.coarseHint.panelOverlap && evidence.coarseLeftHint.fits && !evidence.coarseLeftHint.panelOverlap,
      { uiRefusals, fineGeometry, coarseGeometry: evidence.coarseHint, coarseLeftGeometry: evidence.coarseLeftHint });
    await closeWorkbench();

    const modals = [];
    for (const id of ['menu', 'intro', 'result']) {
      await page.locator('#' + id).evaluate(e => e.showModal());
      await page.locator('#' + id + ' button:visible').first().focus(); modals.push({ id, ...await refuse() });
      await page.locator('#' + id).evaluate(e => e.close());
    }
    await field.focus(); await page.evaluate(() => { document.querySelector('main').inert = true; });
    await frames(page); // Allow native inert focus removal before taking the refusal baseline.
    const inert = await refuse(); await page.evaluate(() => { document.querySelector('main').inert = false; });
    record('modal-isolation', modals.every(r => r.pass) && inert.pass, { modals, inert, setup: 'native keys in actual modal elements; diagnostic showModal/inert admission setup only' });

    await select(); await begin();
    for (let i = 0; i < 3; i++) await page.keyboard.down('i');
    const repeats = await page.evaluate(() => { const x = window.__game; return { active: x.soldierView.active,
      snapshot: x.soldierView.snapshot === window.__soldierWitness.liveSnapshot, depth: x.post.rtScene.depthTexture === window.__soldierWitness.liveDepth }; });
    // Snapshot references for this entry, rather than a previous entry, are captured in the late observer.
    await page.locator('#army-btn').focus(); await field.focus(); await page.keyboard.down('i');
    const latched = await read(page); await end();
    record('repeat-guard', repeats.active && repeats.snapshot && repeats.depth && !latched.active && latched.latched, { repeats, latched: { active: latched.active, latched: latched.latched } });
    await begin(); const selectedEscape = (await read(page)).selected; await page.keyboard.down('Escape'); await page.keyboard.down('Escape');
    const escaped = await read(page); await page.keyboard.up('Escape'); await end();
    record('escape', !escaped.active && !escaped.depth && escaped.selected === selectedEscape
      && escaped.rows.filter(r => r.key === 'Escape' && r.wasActive).at(-1)?.exactReturn, { selectedEscape, selectedAfter: escaped.selected, rows: escaped.rows.filter(r => r.key === 'Escape').slice(-2) });
    await begin(); await page.locator('#army-btn').focus(); const focusExit = await read(page); await end();
    record('focus-exit', !focusExit.active && !focusExit.depth && focusExit.focus === 'army-btn', { active: focusExit.active, depth: focusExit.depth, focus: focusExit.focus });

    const pointerCases = [], pointerCDP = await ctx.newCDPSession(page); evidence.pointerCases = pointerCases;
    try {
      for (const kind of ['pointer', 'double', 'wheel', 'trackpad', 'pinch', 'rotate']) {
        evidence.currentOperation = { kind, phase: 'select' };
        console.log('PROBE soldier native ' + kind + ' selection');
        await select(); await begin();
        evidence.currentOperation = { kind, phase: 'dispatch' };
        console.log('PROBE soldier native ' + kind + ' dispatch');
        const mark = await page.evaluate(() => ({ calls: window.__soldierWitness.calls.length, rows: window.__soldierWitness.rows.length, goal: { ...window.__game.rts.goal } }));
        if (kind === 'pointer') await bounded('native pointer dispatch', () => page.mouse.click(1080, 420));
        else if (kind === 'double') {
          const p = await page.evaluate(() => window.__soldierWitness.entry.mapFlag);
          // First down releases before picking at the saved map flag position; both clicks are native.
          await bounded('native double-click dispatch', () => page.mouse.dblclick(p[0], p[1])); evidence.doubleMapAnchor = p;
        } else {
          // Native CDP wheel; one fresh gesture preserves the ordinary classifier's ownership.
          await page.evaluate(() => { window.__game.input.wheelGesture = null; });
          await bounded('native ' + kind + ' wheel dispatch', () => pointerCDP.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1080, y: 420,
            deltaX: kind === 'trackpad' || kind === 'rotate' ? 7.5 : 0,
            deltaY: kind === 'wheel' ? 120 : 5.5, modifiers: kind === 'pinch' ? 2 : kind === 'rotate' ? 1 : 0 }));
        }
        evidence.currentOperation = { kind, phase: 'readback' };
        const after = await read(page, { rowsSince: mark.rows, callsSince: mark.calls }), rows = after.rows, calls = after.calls;
        const first = rows.find(r => r.wasActive && !r.active), method = kind === 'pointer' || kind === 'double' ? 'down' : kind === 'wheel' || kind === 'pinch' ? 'zoomAt' : kind === 'rotate' ? 'rotateBy' : 'panPixels';
        const forwarded = calls.filter(c => c.method === method);
        pointerCases.push({ kind, first, calls, goalChanged: !same(mark.goal, after.goal), pass: !!first?.trusted && first.exactReturn && first.feedbackConserved
          && first.overlay.failures.length === 0 && forwarded.length === (kind === 'double' ? 2 : 1)
          && forwarded[0].receiver && !forwarded[0].active && same(forwarded[0].camera, forwarded[0].entry)
          && (kind === 'pointer' ? after.selected !== 'franklin' : kind === 'double' ? calls.some(c => c.method === 'flyTo') : !same(mark.goal, after.goal)) });
        await end();
        console.log('PROBE soldier native ' + kind + ' completed');
      }
    } finally { await pointerCDP.detach().catch(() => {}); }
    record('pointer-exit', pointerCases.every(c => c.pass), pointerCases);

    const lifecycle = [];
    for (const kind of ['blur', 'hidden', 'pagehide', 'context']) {
      await select(); await begin();
      const item = await bounded('lifecycle ' + kind, () => page.evaluate(async kind => {
        const x = window.__game, w = window.__soldierWitness, before = w.feedback();
        let descriptor;
        try {
          const snapshot = trusted => ({ kind, diagnosticEvent: kind !== 'context', trusted, active: x.soldierView.active, depth: !!x.post.rtScene.depthTexture, latched: x.soldierView.latched,
            restored: JSON.stringify(w.camera()) === JSON.stringify(w.entry.beforeCamera), feedback: JSON.stringify(w.feedback()) === JSON.stringify(before), escapeClear: !x.soldierView.escapeHeld });
          if (kind === 'hidden') { descriptor = Object.getOwnPropertyDescriptor(document, 'hidden'); Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
          else if (kind === 'context') {
            const canvas = document.getElementById('battlefield'), extension = x.post.renderer.getContext().getExtension('WEBGL_lose_context');
            if (!extension) throw Error('Actual context-loss extension unavailable');
            window.__soldierLossExtension = extension;
            return await new Promise(resolve => { canvas.addEventListener('webglcontextlost', e => resolve(snapshot(e.isTrusted)), { once: true }); extension.loseContext(); });
          }
          else dispatchEvent(new Event(kind));
          return snapshot(false);
        } finally { if (kind === 'hidden') { if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden; } }
      }, kind));
      await page.keyboard.down('i'); item.repeatRefused = !(await read(page)).active; await end(); lifecycle.push(item);
      if (kind === 'context') {
        await frames(page, 3);
        Object.assign(item, await page.evaluate(() => ({ lostRenderAttempts: window.__soldierWitness.lostRenderAttempts, lostTargetCalls: window.__soldierWitness.lostTargetCalls })));
        item.restoreTrusted = await bounded('native context restoration', () => page.evaluate(() => new Promise(resolve => {
          document.getElementById('battlefield').addEventListener('webglcontextrestored', e => resolve(e.isTrusted), { once: true });
          window.__soldierLossExtension.restoreContext(); delete window.__soldierLossExtension;
        })));
        await frames(page, 3);
      }
    }
    await page.locator('#menu-btn').click(); await page.keyboard.press('Escape');
    const menuClosed = !await page.locator('#menu').evaluate(e => e.open);
    record('blur-exit', lifecycle.every(r => !r.active && !r.depth && r.latched && r.restored && r.feedback && r.repeatRefused && r.escapeClear)
      && menuClosed && lifecycle.find(r => r.kind === 'context')?.trusted && lifecycle.find(r => r.kind === 'context')?.restoreTrusted
      && lifecycle.find(r => r.kind === 'context').lostRenderAttempts >= 3 && lifecycle.find(r => r.kind === 'context').lostTargetCalls === 0, { lifecycle, menuClosed,
        limitation: 'Blur/hidden/pagehide are labelled synthetic delivery; context loss/restoration are actual native GPU events. Physical device/navigation remains unverified.' });

    await select(); await begin();
    // This native pointer changes the selection after capture has released inspection.
    await page.locator('#army-btn').click();
    await page.locator('#army-list button').filter({ hasText: 'Willcox' }).first().click();
    const selectionExit = await read(page); await end(); await page.locator('#army-close').click();
    await select(); await begin();
    const external = await page.evaluate(() => { const x = window.__game; x.rts.goal.x += 11; const changed = { ...x.rts.goal }; x.soldierView.updatePose();
      return { active: x.soldierView.active, retained: JSON.stringify(changed) === JSON.stringify(x.rts.goal), changed }; });
    await end(); record('selection-exit', !selectionExit.active && selectionExit.selected !== 'franklin' && !external.active && external.retained,
      { selected: selectionExit.selected, external });

    const invalidations = [];
    for (const kind of ['death', 'gone', 'replacement', 'remove', 'rout']) {
      await spawn(); await begin();
      const item = await page.evaluate(kind => {
        const { game, soldierView: v, post } = window.__game, f = v.figure, u = v.unit;
        if (kind === 'death') f.alive = false;
        else if (kind === 'gone') f.gone = true;
        else if (kind === 'replacement') u.figures[u.figures.indexOf(f)] = { ...f };
        else if (kind === 'remove') game.removeUnit(u);
        else game.combat.rout(u, true);
        v.updatePose(); return { kind, active: v.active, depth: !!post.rtScene.depthTexture, latched: v.latched,
          controlledGeneric: u.id.startsWith('sandbox-'), sameIndex: kind !== 'replacement' || u.figures.some(q => q !== f && q.i === f.i) };
      }, kind);
      invalidations.push(item); await end();
      if (kind === 'remove') generic = null; else await remove();
    }
    record('figure-exit', invalidations.every(r => !r.active && !r.depth && r.latched && r.controlledGeneric && r.sameIndex), invalidations);

    await select(); await begin(); await page.setViewportSize({ width: 320, height: 568 }); await settleHeader(page);
    const narrow = await geometry(page); await scope('held-320'); await shot(page, 'soldier-held-320');
    const resizeReturn = await end();
    await page.setViewportSize({ width: 1280, height: 800 }); await settleHeader(page);
    // Actual quality selector remains current through a held resize; it is not a lens setting.
    await page.locator('#menu-btn').click();
    await page.getByRole('radio', { name: /Auto/ }).check(); await page.locator('#menu button[type=submit]').click();
    await select(); await begin(); await page.setViewportSize({ width: 1024, height: 768 }); await frames(page);
    const auto = await page.evaluate(() => ({ mode: window.__game.post.mode, aspect: window.__game.camera.aspect, active: window.__game.soldierView.active }));
    await end(); const autoReturn = await page.evaluate(() => ({ mode: window.__game.post.mode, aspect: window.__game.camera.aspect }));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#menu-btn').click(); await page.getByRole('radio', { name: /^Low/ }).check(); await page.locator('#menu button[type=submit]').click();
    record('resize', narrow.fits && resizeReturn.camera.aspect === 320 / 568 && !resizeReturn.active && auto.active
      && auto.mode === 'auto' && autoReturn.mode === 'auto' && autoReturn.aspect === 1024 / 768, { narrow, returnedAspect: resizeReturn.camera.aspect, auto, autoReturn });

    await spawn(); await field.focus(); await page.keyboard.press('b'); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    const movingBefore = await begin();
    const movingEpoch = await page.evaluate(() => ({ epoch: window.__soldierWitness.lod.epoch, start: window.__soldierWitness.lod.crossings.length }));
    await page.keyboard.press('Space'); await page.keyboard.press('2'); await frames(page, 8);
    await page.waitForFunction(({ start, epoch }) => {
      const v = window.__game.soldierView, lod = window.__soldierWitness.lod;
      return v.active && Math.hypot(v.figure.x - start.x, v.figure.z - start.z) > 3
        && lod.crossings.some(c => c.epoch === epoch.epoch && c.time > start.time);
    }, { start: { ...movingBefore.figure, time: movingBefore.feedback.time }, epoch: movingEpoch }, { polling: 'raf', timeout: 15000 });
    const movingAfter = await read(page); await page.keyboard.press('Space'); await page.keyboard.press('1');
    const lodEvidence = await page.evaluate(() => window.__soldierWitness.lod);
    const poseEvidence = await page.evaluate(() => {
      const { soldierView: v, terrain } = window.__game, s = 4.4 * v.scale(), w = window.__soldierWitness;
      return w.frames.slice(-20).map(r => {
        const f = r.figure, x = f.x - Math.cos(f.yaw) * 1.8 * s + Math.sin(f.yaw) * .7 * s,
          z = f.z + Math.sin(f.yaw) * 1.8 * s + Math.cos(f.yaw) * .7 * s;
        return { phase: r.phase, simTime: r.simTime, exact: r.sameCamera && r.camera.position[0] === x && r.camera.position[2] === z
          && r.camera.position[1] === terrain.heightAt(x, z) + 1.64 * s };
      });
    });
    await shot(page, 'soldier-moving-rigged'); await end();
    await openWorkbench(); await page.getByRole('tab', { name: 'Look', exact: true }).click();
    await page.getByRole('radio', { name: 'Baked: sprites rendered in Blender', exact: true }).check(); await closeWorkbench();
    await page.waitForFunction(() => window.__game.game.baked.state === 'ready', null, { timeout: 180000 }); await frames(page, 3); await begin();
    const bakedProof = await page.evaluate(() => ({ ready: window.__game.game.baked.state, drawn: window.__game.game.figuresDrawn() }));
    await shot(page, 'soldier-held-baked-alpha'); await end();
    await openWorkbench(); await page.getByRole('button', { name: 'Compare Soldier figures side by side', exact: true }).click(); await closeWorkbench();
    await begin(); const splitProof = await page.evaluate(async () => {
      const { FIGURE_VIEW } = await import('./src/units/soldier-mesh.js');
      return { view: { ...FIGURE_VIEW }, drawn: window.__game.game.figuresDrawn() };
    }); await shot(page, 'soldier-held-split-clipping'); await end();
    await page.getByRole('button', { name: /End compare/ }).click();
    await openWorkbench(); await page.getByRole('radio', { name: "Rigged: today's 3D figures", exact: true }).check(); await closeWorkbench();
    record('moving-follow', movingBefore.figure?.i === movingAfter.figure?.i && movingAfter.active
      && movingAfter.feedback.time > movingBefore.feedback.time && (movingAfter.figure.x !== movingBefore.figure.x || movingAfter.figure.z !== movingBefore.figure.z)
      && poseEvidence.some(r => r.phase === 'pre') && poseEvidence.some(r => r.phase === 'post') && poseEvidence.every(r => r.exact)
      && lodEvidence.frames > 0 && lodEvidence.calls > 0 && lodEvidence.firstFrameCalls > 0 && lodEvidence.failures.length === 0
      && lodEvidence.near.length > 0 && lodEvidence.crossings.slice(movingEpoch.start).some(c => c.epoch === movingEpoch.epoch && c.time > movingBefore.feedback.time)
      && bakedProof.ready === 'ready' && bakedProof.drawn.sprites > 0 && splitProof.view.baked && splitProof.view.rigged
      && splitProof.view.clipBaked === -splitProof.view.clipRigged && Math.abs(splitProof.view.clipBaked) === 1
      && splitProof.drawn.sprites > 0 && splitProof.drawn.rigged > 0,
      { before: movingBefore.figure, after: movingAfter.figure, times: [movingBefore.feedback.time, movingAfter.feedback.time], poseEvidence, lodEvidence,
        bakedProof, splitProof, fieldImages: ['moving-rigged', 'held-baked-alpha', 'held-split-clipping'], limitation: 'Baked Confederate tint and original soft-edge depth limits retained; no art acceptance.' });
    await remove();

    const depth = await depthFixture(page, result);
    record('depth', depth.positive && depth.intendedControlFails && depth.restored && depth.byteExact, depth);
    await select(); await frames(page, 3); const resourcesBefore = await read(page), resourceCycles = [];
    for (let i = 0; i < 6; i++) { await begin(); await end(); await frames(page, 2); const r = await read(page);
      resourceCycles.push({ memory: r.renderer, programs: r.programs, targets: r.targets, depth: r.depth }); }
    await begin(); await page.setViewportSize({ width: 1024, height: 768 }); await end();
    await page.setViewportSize({ width: 1280, height: 800 }); await frames(page, 3); const resourcesAfter = await read(page);
    record('resources', evidence.initialResourceReturn.exact && resourcesBefore.targets.every(t => t[0]) && resourcesAfter.targets.every(t => t[0]) && resourceCycles.every(r => !r.depth && same(r.memory, resourcesBefore.renderer) && r.programs === resourcesBefore.programs
      && same(r.targets, resourcesBefore.targets)) && same(resourcesAfter.renderer, resourcesBefore.renderer)
      && resourcesAfter.programs === resourcesBefore.programs && same(resourcesAfter.targets, resourcesBefore.targets),
      { originalMap: evidence.initialResourceReturn, before: { memory: resourcesBefore.renderer, programs: resourcesBefore.programs, targets: resourcesBefore.targets }, cycles: resourceCycles,
        after: { memory: resourcesAfter.renderer, programs: resourcesAfter.programs, targets: resourcesAfter.targets } });

    await select(); await field.focus(); await settleCamera(page);
    await begin(); await frames(page, 3); await end(); await frames(page, 3);
    const epoch = await page.evaluate(() => window.__headerCameraWitness.finish());
    const descriptors = await page.evaluate(() => window.__soldierWitness.finish()); finished = true;
    const progressAfter = await progressRaw(page), writesAfter = await page.evaluate(() => [window.__progressPuts, window.__progressLegacyWrites]);
    evidence.sandboxTrace = await bounded('sandbox witness archive', () => page.evaluate(() => {
      const w = window.__soldierWitness; return { rows: w.rows, calls: w.calls, frames: w.frames, lod: w.lod };
    }));
    // Existing intro route, deliberately unstarted: this exercises real crate DOM without an extra encounter.
    console.log('PROBE soldier unstarted intro crate restoration');
    await page.goto(url + '?intro&quality=low', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && document.getElementById('intro').open, null, { timeout: 180000 });
    await page.locator('#intro').evaluate(e => e.close());
    await observers(page); finished = false;
    await select('1st Practice Brigade');
    const crateBefore = await read(page); await begin({ flag: true }); await end();
    const crateAfter = await read(page), crateRelease = crateAfter.rows.filter(r => r.type === 'keyup' && r.wasActive).at(-1);
    await shot(page, 'soldier-unstarted-intro-crate-return'); await scope('unstarted-intro-return');
    const projectionControls = await page.evaluate(() => {
      const w = window.__soldierWitness, accepts = () => w.overlay().failures.length === 0,
        m = [...window.__game.hud.markers.values()].find(m => !m.el.classList.contains('hidden'));
      if (!m) throw Error('No actual marker for placement control');
      const original = m.el.style.transform, a = accepts(); let b;
      try { m.el.style.transform = 'translate(9999px, 9999px)'; b = !accepts(); }
      finally { m.el.style.transform = original; }
      const a2 = accepts();
      return { a, intendedPlacementControlFails: b, a2, restoredBytes: m.el.style.transform === original };
    });
    const crateDescriptors = await page.evaluate(() => window.__soldierWitness.finish()); finished = true;
    const crateRaw = await progressRaw(page), crateCounters = await page.evaluate(() => [window.__progressPuts, window.__progressLegacyWrites]);
    const unstarted = await page.evaluate(() => ({ paused: window.__game.game.paused, time: window.__game.game.simTime, started: window.__game.practiceField.started,
      over: window.__game.game.over, outcome: window.__game.practice.outcome }));
    const crateProof = { before: crateBefore.overlay.crates, release: crateRelease, unstarted, projectionControls, crateDescriptors,
      rawExact: crateRaw === progressBefore, counters: crateCounters };
    record('map-restore', epoch.exact && epoch.restored && epoch.frames >= 2 && descriptors && progressAfter === progressBefore && same(writesBefore, writesAfter)
      && crateRelease?.trusted && crateRelease.exactReturn && crateRelease.feedbackConserved && crateRelease.overlay.failures.length === 0
      && crateRelease.overlay.crates.some(c => !c.hidden && !c.missing) && unstarted.paused && unstarted.time === 0 && !unstarted.started
      && !unstarted.over && unstarted.outcome === null && projectionControls.a && projectionControls.intendedPlacementControlFails
      && projectionControls.a2 && projectionControls.restoredBytes && crateDescriptors && crateRaw === progressBefore && same(crateCounters, writesBefore),
      { epoch, descriptors, progressExact: progressAfter === progressBefore, writesBefore, writesAfter, crateProof });
    record('axe', result.soldierViewAxe.length === 0, { count: result.soldierViewAxe.length });
    record('no-console-errors', errors.length === 0 && warnings.length === 0, { errors, warnings, rawDriverWarnings: driverWarnings });
    result.soldierView = evidence;
  } finally {
    try {
      if (!page.isClosed()) {
        evidence.trace = await bounded('partial witness readback', () => page.evaluate(() => {
          const w = window.__soldierWitness; return w && { rows: w.rows, calls: w.calls, frames: w.frames, lod: w.lod, feedback: w.feedback() };
        })).catch(e => ({ unrun: e.message }));
        if (!finished) await bounded('failed diagnostic cleanup', () => page.evaluate(() => {
          window.__game?.soldierView.end('failed'); window.__soldierWitness?.finish?.();
          window.__headerCameraWitness?.finish();
          const g = window.__game?.game; for (const u of g?.units.slice() || []) if (u.id.startsWith('sandbox-')) g.removeUnit(u);
        })).catch(e => { evidence.cleanupError = e.message; });
      }
    } finally { await ctx.close(); }
  }
}

// src/main.js: The Civil War, M1: First Bull Run, Henry House Hill (vertical slice).
//
// Boot: renderer + post chain, terrain data, scenario, world, battle, effects, HUD, input; then the loop.
// Test hooks: window.__ready (first frame drawn), window.__stats, window.__game (see the bottom).

import * as THREE from 'three';
import { loadTerrainData } from './world/terrain.js';
import { buildWorld } from './world/world.js';
import { Post, QUALITY_MODES } from './render/post.js';
import { RtsCamera } from './render/rts-camera.js';
import { SoldierView } from './render/soldier-view.js';
import { Game } from './game.js';
import { Effects } from './fx/effects.js';
import { ArrowLayer } from './ui/arrows.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Readout } from './ui/readout.js';
import { LOOK } from './ui/look.js';
import { defineSandboxTools } from './ui/sandbox-tools.js';
import { playMode, assertSavedLaunch } from './franchise/practice.js';
import { createProgressStore } from './franchise/save.js';
import { attachPracticeFlow } from './franchise/practice-ui.js';
import { introScenario } from './franchise/intro.js';
import { attachPracticeField } from './ui/practice-field.js';
import { prepareFieldScenario, loadFieldScenario } from './sim/phase.js';

let fieldClaimed = false;
// Importing this module has no field side effects. The owner commits navigation only after recheck.
export async function startField({ manifest = null, isCurrent = () => true, onAdmitted = () => {} } = {}) {
  if (!isCurrent()) throw new Error('Practice: deployment review was cancelled.');
  if (fieldClaimed) throw new Error('Practice: this page already owns a field. Return to camp before another deployment.');
  if (manifest) {
    assertSavedLaunch(manifest);
    if (manifest.scenario.id !== 'saved-practice' || !Array.isArray(manifest.scenario.sites)
      || !Array.isArray(manifest.scenario.woods)) throw new Error('Practice: the deployment needs its complete practice ground.');
    if (['intro', 'practice', 'battle', 'sandbox', 'tune'].some((key) => new URLSearchParams(location.search).has(key))) {
      throw new Error('Practice: saved deployment cannot override another field mode.');
    }
  }
  fieldClaimed = true;
  let allocated = false;
  try {
    const currentOwner = () => { if (!isCurrent()) throw new Error('Practice: deployment review was cancelled.'); };
    const mode = playMode(location.search);
    const ground = manifest ? null : await loadFieldScenario({ isCurrent });
    currentOwner();
    const routeId = manifest ? 'saved-practice' : mode === 'practice' && !new URLSearchParams(location.search).has('practice') ? 'first-command' : 'henry-hill';
    // A saved manifest's scenario reference is the authoritative outcome identity.
    const scenario = manifest ? (prepareFieldScenario(manifest.scenario, routeId), manifest.scenario)
      : prepareFieldScenario(routeId === 'first-command' ? introScenario(ground) : ground, routeId);
    document.getElementById('status').textContent = 'Loading the ground…';
    const terrain = await loadTerrainData('./assets/terrain');
    currentOwner();
    if (manifest) {
      const current = await createProgressStore().load();
      assertSavedLaunch(manifest, current);
      currentOwner();
      onAdmitted();
    }

const stats = { fps: 0, scale: 1, quality: 'auto', drawCalls: 0, triangles: 0, figures: 0 };
window.__stats = stats;
window.__ready = false;

const canvas = document.getElementById('battlefield');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const scaleEl = document.getElementById('scale');

function loadPref(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked (private window, preview): the setting is simply not remembered
  }
}

allocated = true;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.autoClear = false;
renderer.info.autoReset = false;
// ?quality=auto|high|low overrides the saved choice for this visit (tests use low) without saving it.
const urlQuality = new URLSearchParams(location.search).get('quality');
const post = new Post(renderer, { mode: QUALITY_MODES.includes(urlQuality) ? urlQuality : loadPref('cw.quality', 'auto') });
post.setSize(window.innerWidth, window.innerHeight);
// GPU tier picks Auto's starting level; benchmark tables are vendored (no CDN). Failure keeps High.
const gpuTier = import('detect-gpu')
  .then(({ getGPUTier }) => getGPUTier({ benchmarksURL: './vendor/detect-gpu/dist/benchmarks', glContext: renderer.getContext() }))
  .then((t) => { stats.gpuTier = t.tier; stats.gpu = t.gpu || ''; post.startFromTier(t.tier); return t; })
  .catch((err) => { console.warn('detect-gpu unavailable; Auto starts at High:', err && err.message ? err.message : err); return null; });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 2, 6000);

const world = buildWorld(scene, terrain, scenario);
Object.assign(stats, world.stats);

// Opening view: both armies between the clock and the bottom panels; the pitch follows the zoom.
const rts = new RtsCamera(camera, terrain, scenario.practiceIntro
  ? { target: [-300, -610], yaw: -Math.PI / 2 - 0.12, dist: 740 }
  : { target: [-60, 200], yaw: -Math.PI / 2 - 0.12, dist: 1150 });
const effects = new Effects(scene, terrain, rts);
await effects.init();
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
effects.reducedMotion = motion.matches;
motion.addEventListener('change', (e) => { effects.reducedMotion = e.matches; });

// ?figures=rigged|baked and ?mpf=10|5 choose the soldier figures for this visit only (measurements and
// screenshots), without saving: they set the live mirror in LOOK, not the stored setting.
{
  const q = new URLSearchParams(location.search);
  if (['rigged', 'baked'].includes(q.get('figures'))) LOOK.figureStyle = q.get('figures');
  if (['5', '10'].includes(q.get('mpf'))) LOOK.menPerFigure = Number(q.get('mpf'));
}
const game = new Game({ scene, terrain, scenario, world, effects, playerSide: 'US' });
{
  // profiling switches for the baked sprites: ?bakesoft=0 skips the soft edge/shadow pass, ?bakeclose=0 the close
  // tier, ?bakesoftfar=<m> draws the soft pass (edges and baked shadow) only for men within m metres of the camera
  const q = new URLSearchParams(location.search);
  const softFar = Number(q.get('bakesoftfar'));
  for (const p of [game.impostors.US, game.impostors.CS]) {
    p.softPass = q.get('bakesoft') !== '0';
    p.allowClose = q.get('bakeclose') !== '0';
    if (softFar > 0) p.softFar = softFar;
  }
}
const arrows = new ArrowLayer(scene, terrain);
let practiceFlow = null;

const hud = new Hud({
  camera, canvas, terrain, units: game.units, playerSide: 'US', rts, game,
  onSelect: (u, options) => game.select(u, options),
  onOrder: (kind) => game.orderSelected(kind),
  onPause: () => game.togglePause(),
  onSpeed: (s) => game.setSpeed(s),
  onQuality: (q) => setQuality(q),
  onSound: (on) => effects.setSound(on),
});
hud.onFocus = (u) => rts.flyTo(u.x, u.z);
hud.onFly = (x, z) => rts.flyTo(x, z);
hud.onResume = () => { if (game.paused) game.togglePause(); };
hud.setQuality(post.mode);
effects.onMoment = (moment) => hud.showMoment(moment);

function setQuality(mode) {
  post.setMode(mode);
  savePref('cw.quality', post.mode);
  hud.setQuality(post.mode);
}

document.getElementById('history-note').textContent = scenario.historyNote;
document.getElementById('menu-title').textContent = scenario.title;
document.getElementById('menu-subtitle').textContent = scenario.practiceIntro ? 'Fictional teaching exercise · Henry Hill terrain' : 'First Bull Run · 21 July 1861 · 2:00 p.m.';
document.title = `The Civil War — ${scenario.title}`;
game.on('select', (u) => hud.select(u));
game.on('log', (text) => hud.toast(text));
game.on('event', (ev) => {
  const shown = manifest && ev.kind === 'result' ? { ...ev,
    text: 'Practice encounter completed. Actual survivors and new loot return to camp.' } : ev;
  if (LOOK.eventFeed) hud.feed(shown); else hud.toast(shown.text);
  if (ev.kind === 'result') practiceFlow?.finishResult();
});
game.on('alert', (a) => { hud.setPaused(true); hud.showAlert(a); });
game.on('spawn', (u) => hud.addUnit(u));
game.on('remove', (u) => hud.removeUnit(u));

const input = new Input({
  canvas, rts, game, arrows, hud, playerSide: 'US',
  onQualityKey: () => {
    const next = QUALITY_MODES[(QUALITY_MODES.indexOf(post.mode) + 1) % QUALITY_MODES.length];
    setQuality(next);
    hud.toast(`Quality: ${next}`);
  },
});
const readout = new Readout({ scene, terrain, camera, game, layer: document.getElementById('ticks') });
defineSandboxTools({ game, rts, effects, hud });
practiceFlow = attachPracticeFlow({ game, scenario, hud, mode, manifest });
const practiceField = attachPracticeField({ game, scenario, hud, camera, terrain, rts, effects, manifest });
document.getElementById('play-mode').textContent = mode === 'practice'
  ? 'Practice · rewards enabled' : mode === 'historical' ? 'Historical battle · no franchise rewards' : 'Sandbox · no progress rewards';
// keep the pause/speed buttons in step with keyboard changes
const togglePause = game.togglePause.bind(game);
game.togglePause = () => { const p = togglePause(); hud.setPaused(p); return p; };
const setSpeed = game.setSpeed.bind(game);
game.setSpeed = (s) => { setSpeed(s); hud.setSpeed(s); };

const tip = document.getElementById('tip');
game.on('select', () => { if (game.orders) tip.hidden = true; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(window.innerWidth, window.innerHeight);
});

/** Metres per CSS pixel at the view centre (order lines and engagement lines keep a screen width). */
const metresPerPixel = () => (2 * rts.dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, window.innerHeight);
const arcOf = (u) => (u.selected ? input.arcOf(u) : null);
const commands = (u) => game.controls(u);

const fieldFocus = (event) => {
  const owner = event?.target || document.activeElement;
  if (!owner?.isConnected || owner.closest?.('[hidden], [inert]') || !owner.getClientRects().length
    || getComputedStyle(owner).visibility === 'hidden') return false;
  if (owner === canvas) return true;
  const flag = owner.closest?.('.marker'), u = game.selected;
  return !!u && u.side === game.playerSide && game.controls(u) && hud.markers.get(u.id)?.el === flag;
};
const lensAvailable = () => !document.querySelector('main')?.inert && !document.querySelector('dialog[open]')
  && !input.drag && !input.targeting && !input.pointers.size && !arrows.preview && !arrows.previewEnd;
let eyeUI = null;
const soldierView = new SoldierView({ camera, rts, game, terrain, post,
  isFieldFocus: fieldFocus,
  canBegin: event => lensAvailable() && fieldFocus(event),
  canContinue: () => lensAvailable() && fieldFocus(),
  onEnter: () => {
    const hint = document.getElementById('soldier-view-hint');
    eyeUI = { focus: document.activeElement, text: statusEl.textContent, arrows: arrows.group.visible,
      hintHidden: hint.hidden, classHeld: document.body.classList.contains('soldier-view') };
    canvas.focus({ preventScroll: true });
    document.body.classList.add('soldier-view');
    hint.hidden = false;
    statusEl.textContent = 'Soldier-eye inspection. Release I to return to the map.';
    arrows.group.visible = false;
    readout.mesh.visible = false;
  },
  onExit: reason => {
    const ui = eyeUI;
    eyeUI = null;
    if (!ui) return;
    // Camera is already coherent and inspection inactive. Restore layout before measuring it.
    document.body.classList.toggle('soldier-view', ui.classHeld);
    document.getElementById('soldier-view-hint').hidden = ui.hintHidden;
    statusEl.textContent = ui.text;
    hud.applyMarkerScale(LOOK.markerScale);
    hud.update(0);
    hud.minimap?.draw();
    practiceField.update();
    const mpp = metresPerPixel();
    arrows.setScale(mpp);
    arrows.update(game.units, commands, arcOf);
    readout.lines(mpp);
    readout.projectTicks();
    arrows.group.visible = ui.arrows;
    if (['release', 'escape'].includes(reason) && document.activeElement === canvas && ui.focus?.isConnected
      && !ui.focus.closest('[hidden], [inert]') && ui.focus.getClientRects().length) ui.focus.focus({ preventScroll: true });
  },
});
input.soldierView = soldierView;
window.addEventListener('resize', () => soldierView.onResize());
for (const event of ['select', 'remove']) game.on(event, () => {
  if (soldierView.active && !soldierView.valid()) soldierView.end('selection');
});

// All field subscribers must receive zero-time arrivals before the first simulation step.
game.initializeReinforcements();

// ---------------------------------------------------------------------------------------------------
// Loop
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let resultShown = false;
function frame(now) {
  const realDt = Math.max(0.0001, (now - last) / 1000); // true frame time, for FPS and the quality governor
  const dt = Math.min(0.1, realDt); // capped, for simulation and camera
  last = now;
  const simDt = game.step(dt);
  effects.updateMoments(realDt);
  soldierView.updatePose();
  game.setView(camera, window.innerHeight * post.scale);
  game.animate(simDt);
  soldierView.updatePose();
  effects.update(game.paused ? 0 : dt * game.speed);
  const mpp = metresPerPixel();
  if (!soldierView.active) arrows.setScale(mpp);
  input.refreshTargeting();
  arrows.update(game.units, commands, arcOf);
  soldierView.updateMap(dt);
  world.trees.userData.updateLod(camera, rts.dist + 200);
  hud.update(dt);
  readout.update(game.paused ? 0 : dt, mpp);
  if (soldierView.active) readout.mesh.visible = false;
  if (game.orders && !tip.hidden) tip.hidden = true;
  practiceField.update();

  renderer.info.reset();
  post.render(scene, camera);
  post.govern(realDt, now);
  stats.drawCalls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;

  fpsFrames++;
  fpsTime += realDt;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round((fpsFrames / fpsTime) * 10) / 10;
    stats.scale = post.scale;
    stats.quality = post.mode;
    stats.figures = game.figureCount();
    stats.figureTriangles = game.figureTriangles();
    stats.lod = game.pools.US.buckets.map((b) => b.n).join('/') + ' ' + game.pools.CS.buckets.map((b) => b.n).join('/');
    const drawn = game.figuresDrawn();
    stats.figureStyle = game.baked.state === 'ready' && LOOK.figureStyle === 'baked' ? 'baked' : 'rigged';
    stats.menPerFigure = LOOK.menPerFigure;
    stats.riggedDrawn = drawn.rigged;
    stats.sprites = drawn.sprites;
    stats.spriteCalls = drawn.calls;
    stats.atlasMB = game.baked.atlas ? Math.round(game.baked.atlas.memoryBytes() / 1e5) / 10 : 0;
    stats.simTime = Math.round(game.simTime);
    stats.puffs = effects.puffs;
    fpsEl.textContent = stats.fps.toFixed(0);
    scaleEl.textContent = `· ${post.mode} ×${post.scale.toFixed(2)}`;
    const c = game.clockText();
    hud.setClock(c.date, c.time, c.frac);
    const o = game.objective;
    hud.objective(`Objective: take ${o.name}. ${game.holder === 'US' ? 'Union troops hold it.' : game.holder === 'CS' ? 'The Confederates hold it.' : game.holder === 'contested' ? 'Contested.' : 'Nobody holds it.'}`);
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (game.over && !resultShown) {
    resultShown = true;
    practiceFlow.finishResult();
  }
  if (!window.__ready) {
    window.__ready = true;
    statusEl.textContent = manifest ? 'Your saved army is ready. Continue begins the fictional exercise; losses return to camp.' : scenario.practiceIntro ? 'Your first command is ready. Continue begins the fictional practice fight.'
      : 'Henry House Hill, 21 July 1861. Union brigades are below the hill; Jackson holds the crest.';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { game, rts, terrain, scene, camera, post, world, effects, input, hud, arrows, readout, soldierView, gpuTier, practice: practiceFlow, practiceField, manifest };

// Developer tuning panel (lil-gui), only with ?tune in the URL; players never load it.
if (new URLSearchParams(location.search).has('tune')) {
  import('./dev/tune.js').then((m) => m.openTuner({ post, world }));
}

// Sandbox workbench panel, with ?sandbox in the URL (Menu > Sandbox).
if (new URLSearchParams(location.search).has('sandbox')) {
  import('./sandbox/panel.js').then((m) => m.mountSandbox({ game: window.__game }));
}

// Installable app: the service worker only on the live https site (local http dev and tests never get one); ?nosw skips it.
if (location.protocol === 'https:' && 'serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker not registered:', err && err.message ? err.message : err));
}
  } finally {
    // Once allocated, a retry needs a new page; never stack GPU state, listeners or RAF loops.
    if (!allocated) fieldClaimed = false;
  }
}

// src/main.js: The Civil War, M1: First Bull Run, Henry House Hill (vertical slice).
//
// Boot: renderer + post chain, terrain data, scenario, world, battle, effects, HUD, input; then the loop.
// Test hooks: window.__ready (first frame drawn), window.__stats, window.__game (see the bottom).

import * as THREE from 'three';
import { loadTerrainData } from './world/terrain.js';
import { buildWorld } from './world/world.js';
import { Post, QUALITY_MODES } from './render/post.js';
import { RtsCamera } from './render/rts-camera.js';
import { Game } from './game.js';
import { Effects } from './fx/effects.js';
import { ArrowLayer } from './ui/arrows.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Readout } from './ui/readout.js';
import { LOOK } from './ui/look.js';
import { defineSandboxTools } from './ui/sandbox-tools.js';
import { playMode } from './franchise/practice.js';
import { attachPracticeFlow } from './franchise/practice-ui.js';
import { introScenario } from './franchise/intro.js';
import { attachPracticeField } from './ui/practice-field.js';

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

statusEl.textContent = 'Loading the ground…';
const terrain = await loadTerrainData('./assets/terrain');
const mode = playMode(location.search);
const ground = await (await fetch('./assets/scenarios/henry-hill.json')).json();
const scenario = mode === 'practice' && !new URLSearchParams(location.search).has('practice') ? introScenario(ground) : ground;
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
  onSelect: (u) => game.select(u),
  onOrder: (kind) => game.orderSelected(kind),
  onPause: () => game.togglePause(),
  onSpeed: (s) => game.setSpeed(s),
  onQuality: (q) => setQuality(q),
  onSound: (on) => { effects.sound.enabled = on; },
});
hud.onFocus = (u) => rts.flyTo(u.x, u.z);
hud.onFly = (x, z) => rts.flyTo(x, z);
hud.onResume = () => { if (game.paused) game.togglePause(); };
hud.setQuality(post.mode);

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
  if (LOOK.eventFeed) hud.feed(ev); else hud.toast(ev.text);
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
practiceFlow = attachPracticeFlow({ game, scenario, hud, mode });
const practiceField = attachPracticeField({ game, scenario, hud, camera, terrain, rts, effects });
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
  game.setView(camera, window.innerHeight * post.scale);
  game.animate(simDt);
  effects.update(game.paused ? 0 : dt * game.speed);
  const mpp = metresPerPixel();
  arrows.setScale(mpp);
  arrows.update(game.units, commands, arcOf);
  rts.update(dt);
  world.trees.userData.updateLod(camera, rts.dist + 200);
  hud.update(dt);
  readout.update(game.paused ? 0 : dt, mpp);
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
    statusEl.textContent = scenario.practiceIntro ? 'Your first command is ready. Continue begins the fictional practice fight.'
      : 'Henry House Hill, 21 July 1861. Union brigades are below the hill; Jackson holds the crest.';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { game, rts, terrain, scene, camera, post, world, effects, input, hud, arrows, readout, gpuTier, practice: practiceFlow, practiceField };

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

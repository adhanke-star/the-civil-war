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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 2, 6000);

statusEl.textContent = 'Loading the ground…';
const terrain = await loadTerrainData('./assets/terrain');
const scenario = await (await fetch('./assets/scenarios/henry-hill.json')).json();
const world = buildWorld(scene, terrain, scenario);
Object.assign(stats, world.stats);

const rts = new RtsCamera(camera, terrain, { target: [-130, 280], yaw: -Math.PI / 2 - 0.12, pitch: 0.95, dist: 920 });
const effects = new Effects(scene, terrain, rts);
await effects.init();
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
effects.reducedMotion = motion.matches;
motion.addEventListener('change', (e) => { effects.reducedMotion = e.matches; });

const game = new Game({ scene, terrain, scenario, world, effects, playerSide: 'US' });
const arrows = new ArrowLayer(scene, terrain);

function setQuality(mode) {
  post.setMode(mode);
  savePref('cw.quality', post.mode);
  hud.setQuality(post.mode);
}

const hud = new Hud({
  camera, canvas, terrain, units: game.units, playerSide: 'US',
  onSelect: (u) => game.select(u),
  onOrder: (kind) => game.orderSelected(kind),
  onPause: () => hud.setPaused(game.togglePause()),
  onSpeed: () => { game.setSpeed(game.speed === 1 ? 2 : game.speed === 2 ? 4 : 1); hud.setSpeed(game.speed); },
  onQuality: (q) => setQuality(q),
  onSound: (on) => { effects.sound.enabled = on; },
});
hud.setQuality(post.mode);
document.getElementById('history-note').textContent = scenario.historyNote;
game.on('select', (u) => hud.select(u));
game.on('log', (text) => hud.toast(text));

const input = new Input({
  canvas, rts, game, arrows, hud, playerSide: 'US',
  onQualityKey: () => {
    const next = QUALITY_MODES[(QUALITY_MODES.indexOf(post.mode) + 1) % QUALITY_MODES.length];
    setQuality(next);
    hud.toast(`Quality: ${next}`);
  },
});
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
  game.animate(simDt);
  effects.update(game.paused ? 0 : dt * game.speed);
  arrows.update(game.units, 'US');
  rts.update(dt);
  world.trees.userData.updateLod(camera, rts.dist + 450);
  hud.update(dt);
  if (game.orders && !tip.hidden) tip.hidden = true;

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
    hud.result(game.result.winner === 'US' ? 'Union victory' : 'Confederate victory', game.result.why);
  }
  if (!window.__ready) {
    window.__ready = true;
    statusEl.textContent = 'Henry House Hill, 21 July 1861. Union brigades are below the hill; Jackson holds the crest.';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { game, rts, terrain, scene, camera, post, world, effects, input, hud, arrows };

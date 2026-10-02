// src/main.js: M0 battlefield proof ("pipeline proven").
//
// One Union regiment of 200 instanced figures marches across painted farmland. A Yuka Vehicle with an
// ArriveBehavior drives the regiment's anchor; each figure keeps its formation offset from the anchor.
// three.quarks puffs musket smoke from the front rank every few seconds (optional: if it fails to load
// the game warns and carries on). ZzFX plays the volley only after the player's first click or key press.
//
// Test hooks: window.__ready = true after the first rendered frame; window.__stats = {fps, figures,
// drawCalls, smoke, reducedMotion}.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle, ArriveBehavior, EntityManager, Vector3 as YukaVector3 } from 'yuka';

// ---------------------------------------------------------------------------------------------------
// Settings
const FILES = 100; // men per rank
const RANKS = 2;
const FIGURES = FILES * RANKS;
const FILE_SPACING = 0.66; // metres between files
const RANK_SPACING = 0.95; // metres between ranks
const MARCH_SPEED = 2.0; // m/s (a brisk, slightly time-compressed quick step)
const WAYPOINTS = [new YukaVector3(0, 0, -60), new YukaVector3(0, 0, 60)];
const HALT_SECONDS = 3.5;
const VOLLEY_EVERY = 4.5; // seconds between volleys (with jitter)
const TERRAIN_SIZE = 900;
const TERRAIN_SEGMENTS = 180;

const stats = { fps: 0, figures: 0, drawCalls: 0, smoke: false, particles: 0, volleys: 0, reducedMotion: false };
window.__stats = stats;
window.__ready = false;

const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const soundBtn = document.getElementById('sound');

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
stats.reducedMotion = reducedMotion;
motionQuery.addEventListener('change', (e) => {
  reducedMotion = e.matches;
  stats.reducedMotion = reducedMotion;
});

// ---------------------------------------------------------------------------------------------------
// Renderer, scene, camera
const canvas = document.getElementById('battlefield');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // the composer renders several passes; count the whole frame

const HAZE = new THREE.Color('#d9c7a3');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HAZE, 140, 560);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(30, 12, -34);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.5, -58);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI * 0.47;
controls.listenToKeyEvents(canvas); // arrow keys pan while the canvas has keyboard focus
controls.update();

const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// Lights: warm late-afternoon sun with a sky/earth fill.
scene.add(new THREE.HemisphereLight('#ffe8c2', '#5a4a30', 1.4));
const sun = new THREE.DirectionalLight('#fff0d0', 2.2);
sun.position.set(140, 160, 120); // low western sun, lighting the regiment's front
scene.add(sun);

// ---------------------------------------------------------------------------------------------------
// Sky: a big gradient dome (painted, warm horizon) that ignores fog.
{
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color('#6f93b8');
  const horizon = new THREE.Color('#ead7ae');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / 1500));
    c.copy(horizon).lerp(zenith, Math.pow(t, 0.55));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
}

// ---------------------------------------------------------------------------------------------------
// Terrain: gentle procedural rolls with a painted vertex-colour palette.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function valueNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  return valueNoise(x, z) * 0.55 + valueNoise(x * 2.1, z * 2.1) * 0.3 + valueNoise(x * 4.3, z * 4.3) * 0.15;
}
function heightAt(x, z) {
  return (
    5.5 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 - 0.4) +
    2.4 * Math.sin(x * 0.027 + z * 0.019) +
    3.0 * (fbm(x * 0.012, z * 0.012) - 0.5)
  );
}

{
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const meadow = new THREE.Color('#7c8a3e');
  const deepGreen = new THREE.Color('#556b2f');
  const ochre = new THREE.Color('#c2a25a');
  const wheat = new THREE.Color('#d8b56a');
  const earth = new THREE.Color('#8a6a45');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const patch = fbm(x * 0.008 + 11, z * 0.008 - 7); // large field patches
    const fine = fbm(x * 0.09, z * 0.09); // brush-stroke variation
    c.copy(deepGreen).lerp(meadow, THREE.MathUtils.smoothstep(h, -6, 5));
    c.lerp(ochre, THREE.MathUtils.smoothstep(patch, 0.52, 0.66) * 0.75);
    c.lerp(wheat, THREE.MathUtils.smoothstep(patch, 0.7, 0.8) * 0.8);
    c.lerp(earth, THREE.MathUtils.smoothstep(fine, 0.68, 0.85) * 0.35);
    const k = 0.92 + fine * 0.14;
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.name = 'terrain';
  scene.add(terrain);
}

// ---------------------------------------------------------------------------------------------------
// Soldier figure: a few boxes/cylinders merged into one low-poly geometry with per-part colours.
// The figure faces +Z.
function part(geometry, color, x, y, z, rx = 0, rz = 0) {
  const g = geometry.toNonIndexed();
  geometry.dispose();
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
function buildSoldierGeometry() {
  const coat = '#34446e';
  const trousers = '#7f96b8';
  const skin = '#d6a57c';
  const leather = '#3a2a1c';
  const wood = '#6b4423';
  const parts = [
    part(new THREE.BoxGeometry(0.15, 0.86, 0.17), trousers, -0.095, 0.43, 0),
    part(new THREE.BoxGeometry(0.15, 0.86, 0.17), trousers, 0.095, 0.43, 0),
    part(new THREE.BoxGeometry(0.44, 0.62, 0.25), coat, 0, 1.16, 0),
    part(new THREE.BoxGeometry(0.11, 0.56, 0.12), coat, -0.27, 1.13, 0.02),
    part(new THREE.BoxGeometry(0.11, 0.56, 0.12), coat, 0.27, 1.13, 0.02),
    part(new THREE.BoxGeometry(0.2, 0.23, 0.21), skin, 0, 1.6, 0.01),
    part(new THREE.CylinderGeometry(0.1, 0.115, 0.13, 8), coat, 0, 1.78, 0.0),
    part(new THREE.BoxGeometry(0.2, 0.025, 0.09), leather, 0, 1.72, 0.12),
    part(new THREE.BoxGeometry(0.34, 0.36, 0.13), leather, 0, 1.2, -0.19),
    part(new THREE.CylinderGeometry(0.022, 0.026, 1.45, 5), wood, 0.3, 1.32, -0.05, -0.12, 0.08),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------------------------------
// Regiment: anchor driven by Yuka; figures follow formation offsets.
const entityManager = new EntityManager();
const anchor = new Vehicle();
anchor.maxSpeed = MARCH_SPEED;
anchor.maxForce = 6;
anchor.updateOrientation = false; // facing is handled by the formation logic below
anchor.position.copy(WAYPOINTS[0]);
const arrive = new ArriveBehavior(WAYPOINTS[1].clone(), 2.5, 0.25);
anchor.steering.add(arrive);
entityManager.add(anchor);

let targetIndex = 1;
let marchDir = 1; // +1 marching toward +Z, -1 toward -Z
let phase = 'march'; // 'march' | 'halt' | 'turn'
let phaseTime = 0;

const soldierGeo = buildSoldierGeometry();
const soldierMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const regiment = new THREE.InstancedMesh(soldierGeo, soldierMat, FIGURES);
regiment.name = 'regiment';
regiment.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
regiment.frustumCulled = false; // instances move far from the base geometry's bounds

const figures = [];
{
  const tint = new THREE.Color();
  for (let r = 0; r < RANKS; r++) {
    for (let f = 0; f < FILES; f++) {
      const i = r * FILES + f;
      figures.push({
        ox: (f - (FILES - 1) / 2) * FILE_SPACING + (hash2(i, 3) - 0.5) * 0.08,
        oz: (r - (RANKS - 1) / 2) * -RANK_SPACING + (hash2(i, 7) - 0.5) * 0.08, // rank 0 is nearer +Z
        rank: r,
        bobPhase: hash2(i, 13) * Math.PI * 2,
        turnDelay: hash2(i, 17) * 0.6,
        yaw: 0,
      });
      const k = 0.86 + hash2(i, 19) * 0.2;
      regiment.setColorAt(i, tint.setRGB(k, k, k * (0.97 + hash2(i, 23) * 0.06)));
    }
  }
  regiment.instanceColor.needsUpdate = true;
}
scene.add(regiment);
stats.figures = regiment.count;

let facingGoal = 0; // regiment facing (0 = +Z, PI = -Z)
const dummy = new THREE.Object3D();
let marchClock = 0;

function frontRankZ() {
  // The rank on the side the regiment faces is the front rank.
  const front = figures.find((fig) => (marchDir > 0 ? fig.rank === 0 : fig.rank === RANKS - 1));
  return front.oz;
}

function updateFormation(dt) {
  const ax = anchor.position.x;
  const az = anchor.position.z;
  const speed = anchor.getSpeed();
  if (speed > 0.05) marchClock += dt * (speed / MARCH_SPEED);
  for (let i = 0; i < FIGURES; i++) {
    const fig = figures[i];
    // Each man turns in place, slightly out of step with his neighbours.
    const lag = Math.max(0, phaseTime - fig.turnDelay);
    const goal = phase === 'turn' && lag <= 0 ? fig.yaw : facingGoal;
    const diff = Math.atan2(Math.sin(goal - fig.yaw), Math.cos(goal - fig.yaw));
    fig.yaw += diff * Math.min(1, dt * 4);
    const x = ax + fig.ox;
    const z = az + fig.oz;
    let y = heightAt(x, z);
    if (!reducedMotion && speed > 0.05) {
      const step = marchClock * 7.2 + fig.bobPhase;
      y += Math.abs(Math.sin(step)) * 0.05;
      dummy.rotation.set(0, fig.yaw + Math.sin(step) * 0.03, Math.sin(step) * 0.015);
    } else {
      dummy.rotation.set(0, fig.yaw, 0);
    }
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    regiment.setMatrixAt(i, dummy.matrix);
  }
  regiment.instanceMatrix.needsUpdate = true;
}

function updateMarch(dt) {
  phaseTime += dt;
  if (phase === 'march') {
    arrive.active = true;
    const dist = anchor.position.distanceTo(WAYPOINTS[targetIndex]);
    if (dist < 0.6 && anchor.getSpeed() < 0.15) {
      phase = 'halt';
      phaseTime = 0;
      anchor.velocity.set(0, 0, 0);
    }
  } else if (phase === 'halt') {
    arrive.active = false;
    anchor.velocity.set(0, 0, 0);
    if (phaseTime > HALT_SECONDS) {
      targetIndex = 1 - targetIndex;
      arrive.target.copy(WAYPOINTS[targetIndex]);
      marchDir = WAYPOINTS[targetIndex].z > anchor.position.z ? 1 : -1;
      facingGoal = marchDir > 0 ? 0 : Math.PI;
      phase = 'turn';
      phaseTime = 0;
    }
  } else if (phase === 'turn') {
    arrive.active = false;
    anchor.velocity.set(0, 0, 0);
    if (phaseTime > 1.6) {
      phase = 'march';
      phaseTime = 0;
    }
  }
  entityManager.update(dt);
}

// ---------------------------------------------------------------------------------------------------
// Musket smoke (three.quarks, optional).
const smoke = { ok: false, renderer: null, systems: [], emitters: [] };
const SMOKE_POINTS = 16;

async function initSmoke() {
  try {
    const Q = await import('three.quarks');
    const tex = makeSmokeTexture();
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: 0xffffff,
    });
    const batch = new Q.BatchedRenderer();
    batch.name = 'smoke';
    scene.add(batch);
    for (let i = 0; i < SMOKE_POINTS; i++) {
      const system = new Q.ParticleSystem({
        looping: false,
        duration: 0.4,
        worldSpace: true,
        shape: new Q.ConeEmitter({ radius: 0.9, angle: 0.4, thickness: 1, arc: Math.PI * 2 }),
        startLife: new Q.IntervalValue(2.8, 5.0),
        startSpeed: new Q.IntervalValue(1.6, 4.2),
        startSize: new Q.IntervalValue(0.9, 1.6),
        startRotation: new Q.IntervalValue(0, Math.PI * 2),
        startColor: new Q.ConstantColor(new Q.Vector4(0.93, 0.91, 0.86, 0.5)),
        emissionOverTime: new Q.ConstantValue(0),
        emissionBursts: [{ time: 0, count: new Q.IntervalValue(8, 12), cycle: 1, interval: 0.01, probability: 1 }],
        behaviors: [
          new Q.SizeOverLife(new Q.PiecewiseBezier([[new Q.Bezier(1, 1.9, 2.7, 3.4), 0]])),
          new Q.ColorOverLife(new Q.Gradient(
            [[new Q.Vector3(1, 1, 1), 0], [new Q.Vector3(0.86, 0.84, 0.8), 1]],
            [[0.6, 0], [0.35, 0.45], [0, 1]],
          )),
          new Q.SpeedOverLife(new Q.PiecewiseBezier([[new Q.Bezier(1, 0.35, 0.15, 0.08), 0]])),
          new Q.ApplyForce(new Q.Vector3(0.3, 1, 0), new Q.ConstantValue(0.7)),
          new Q.RotationOverLife(new Q.IntervalValue(-0.4, 0.4)),
        ],
        material,
        renderMode: Q.RenderMode.BillBoard,
      });
      system.pause();
      batch.addSystem(system);
      scene.add(system.emitter);
      smoke.systems.push(system);
      smoke.emitters.push(system.emitter);
    }
    smoke.renderer = batch;
    smoke.ok = true;
    stats.smoke = true;
  } catch (err) {
    console.warn('three.quarks smoke unavailable; continuing without musket smoke:', err && err.message ? err.message : err);
    smoke.ok = false;
    stats.smoke = false;
  }
}

function makeSmokeTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fireSmoke() {
  if (!smoke.ok || reducedMotion) return;
  const fz = frontRankZ();
  const span = (FILES - 1) * FILE_SPACING;
  for (let i = 0; i < smoke.systems.length; i++) {
    const e = smoke.emitters[i];
    const x = anchor.position.x + (i / (smoke.systems.length - 1) - 0.5) * span;
    const z = anchor.position.z + fz + marchDir * 0.9;
    e.position.set(x, heightAt(x, z) + 1.6, z);
    // ConeEmitter shoots along local +Z; aim forward and slightly up.
    e.rotation.set(marchDir > 0 ? -0.12 : 0.12, marchDir > 0 ? 0 : Math.PI, 0);
    e.updateMatrixWorld(true);
    smoke.systems[i].restart();
  }
}

// ---------------------------------------------------------------------------------------------------
// Sound (ZzFX), unlocked by the first user gesture (autoplay policy).
const sound = { unlocked: false, enabled: false, zzfx: null };

function unlockAudio() {
  if (sound.unlocked) return;
  sound.unlocked = true;
  sound.enabled = true;
  soundBtn.setAttribute('aria-pressed', 'true');
  import('zzfx')
    .then((m) => {
      sound.zzfx = m.zzfx;
      if (m.ZZFX.audioContext && m.ZZFX.audioContext.state === 'suspended') m.ZZFX.audioContext.resume();
    })
    .catch((err) => console.warn('ZzFX unavailable; continuing without sound:', err && err.message ? err.message : err));
}
window.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
window.addEventListener('keydown', unlockAudio, { once: false });
soundBtn.addEventListener('click', () => {
  if (!sound.unlocked) return unlockAudio();
  sound.enabled = !sound.enabled;
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
});

function volleySound() {
  if (!sound.enabled || !sound.zzfx) return;
  // A ragged volley: three overlapping noise cracks.
  const crack = () => sound.zzfx(1.1, 0.25, 85, 0.003, 0.04, 0.85, 4, 1.4, -1.5, 0, 0, 0, 0, 1.6, 0, 0.35, 0.06, 0.55, 0.12);
  crack();
  setTimeout(crack, 70 + Math.random() * 60);
  setTimeout(crack, 170 + Math.random() * 90);
}

let volleyTimer = 1.5;
function updateVolleys(dt) {
  volleyTimer -= dt;
  if (volleyTimer > 0) return;
  volleyTimer = VOLLEY_EVERY + Math.random() * 1.5;
  stats.volleys++;
  fireSmoke();
  volleySound();
}

// ---------------------------------------------------------------------------------------------------
// Loop
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
}
window.addEventListener('resize', onResize);

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let firstFrame = true;
const prevAnchor = new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z);

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;

  updateMarch(dt);
  updateFormation(dt);
  updateVolleys(dt);
  if (smoke.ok) {
    smoke.renderer.update(dt);
    let n = 0;
    for (const s of smoke.systems) n += s.particleNum;
    stats.particles = n;
  }

  // Camera follows the regiment's movement while leaving orbit control to the player.
  const dx = anchor.position.x - prevAnchor.x;
  const dz = anchor.position.z - prevAnchor.z;
  camera.position.x += dx;
  camera.position.z += dz;
  controls.target.x += dx;
  controls.target.z += dz;
  prevAnchor.set(anchor.position.x, anchor.position.y, anchor.position.z);
  controls.update();

  renderer.info.reset();
  composer.render(dt);
  stats.drawCalls = renderer.info.render.calls;

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round((fpsFrames / fpsTime) * 10) / 10;
    fpsEl.textContent = stats.fps.toFixed(0);
    fpsFrames = 0;
    fpsTime = 0;
  }

  if (firstFrame) {
    firstFrame = false;
    window.__ready = true;
    statusEl.textContent = 'A Union regiment advances in line of battle.';
  }
  requestAnimationFrame(frame);
}

await initSmoke();
requestAnimationFrame(frame);

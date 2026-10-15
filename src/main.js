// src/main.js: The Civil War, M1: First Bull Run, Henry House Hill (vertical slice).
//
// Boot: renderer + post chain, terrain data, scenario, world, battle, effects, HUD, input; then the loop.
// Test hooks: window.__ready (first frame drawn), window.__stats, window.__game (see the bottom).
// Sound (src/audio/): the field arms the mixer (nothing loads or plays before the first gesture), loads the battle bank
// and the season's ambience, stops the music for the battle, and once a frame tells the director who fires, who
// charges, whether mounted cavalry moves, and which order the player just gave (read from the units, not by wrapping
// Game methods). The result brings the results tune, or a lament after heavy losses. Gore (look.gore): the fallen fade
// on the game's simulation clock.

import * as THREE from 'three';
import { loadTerrainData, prepareTerrainPartition } from './world/terrain.js';
import { buildWorld } from './world/world.js';
import { Post, QUALITY_MODES, pinPostResourceDiagnostic } from './render/post.js';
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
import { introScenario, fictionalSurrenderRoute } from './franchise/intro.js';
import { attachPracticeField } from './ui/practice-field.js';
import { prepareFieldScenario, loadFieldScenario, loadBattlePack } from './sim/phase.js';
import { campaignPhase, applyCampaign } from './franchise/campaign.js';
import { loadCampaign, mountBriefing, showGraphicsReload } from './ui/briefing.js';
import { get as getSetting, set as setSetting, on as onSetting } from './settings.js';
import { mixer } from './audio/mixer.js';
import { bankIds } from './audio/bank.js';
import { Director } from './audio/director.js';
import { setBattle, playMusic, resultsMood, lossShareOf, stopMusicForReload } from './audio/music.js';
import { setQualityHandler } from './ui/settings-panel.js';
import { FALLEN } from './units/soldier-mesh.js';
import { pinRuntimeClose } from './units/impostor.js';

export function detectFieldGPUTier(renderer,post,stats,graphicsStop,load=()=>import('detect-gpu')) {
  return load().then(({getGPUTier})=>{
    if(graphicsStop && !graphicsStop.check())return null;
    // The pinned detector performs all GL work synchronously before its first await.
    return getGPUTier({benchmarksURL:'./vendor/detect-gpu/dist/benchmarks',glContext:renderer.getContext()});
  }).then(t=>{
    if(!t || graphicsStop?.stopped)return null;
    stats.gpuTier=t.tier;stats.gpu=t.gpu||'';post.startFromTier(t.tier);return t;
  }).catch(err=>{console.warn('detect-gpu unavailable; Auto starts at High:',err&&err.message?err.message:err);return null;});
}

export function fieldResourceProfile(search) {
  const query=new URLSearchParams(search),names=query.getAll('resources');
  if(!names.length)return null;
  if(names.length!==1 || names[0]!=='compact-v1' || query.has('tune') || query.has('sandbox'))
    throw new Error('Field: unknown or conflicting resource profile');
  return Object.freeze({name:'compact-v1',pixelBytes:3639218});
}

/** Metadata only: all three fixed source files settle before any renderer allocation. */
export async function prepareFieldResources(search,{fetcher=globalThis.fetch}={}) {
  const profile=fieldResourceProfile(search);if(!profile)return null;
  const base='./assets/figures/confederate-infantry/';
  const read=async file=>{
    const response=await fetcher(base+file);if(!response.ok)throw new Error('Field: resource metadata HTTP failure');
    const limit=1024*1024,length=response.headers.get('content-length');
    if(length!==null && (!Number.isSafeInteger(Number(length)) || Number(length)<0 || Number(length)>limit))
      throw new Error('Field: resource metadata exceeds its bound');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error('Field: resource metadata exceeds its bound');}chunks.push(value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  };
  const settled=await Promise.allSettled(['soldier.json','soldier-hybrid.json','soldier-source.json'].map(read));
  const failure=settled.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  const [baseline,manifest,sourceManifest]=settled.map(result=>result.value);
  return Object.freeze({...profile,csRuntimeClose:pinRuntimeClose({baseline,manifest,sourceManifest,base})});
}

/** One terminal field owner. This never resumes a context or claims whole-world retirement. */
export function createFieldGraphicsStop(owners) {
  const canvas=owners.renderer.domElement;
  let stopped=false,eventProcessed=false,disposalQueued=false,rendererDisposed=false,failed=false,failure;
  const retain=error=>{if(!failed){failed=true;failure=error;}};
  const attempt=action=>{try{const result=action();if(result?.then)Promise.resolve(result).catch(retain);}catch(error){retain(error);}};
  const publish=()=>{
    attempt(()=>owners.briefing?.stopForReload());
    attempt(()=>{const status=document.getElementById('status');if(status)status.textContent='Battle stopped. Reload to restart.';});
    attempt(()=>showGraphicsReload());
  };
  const stop=()=>{
    if(stopped)return;stopped=true;
    attempt(()=>{if(owners.raf)cancelAnimationFrame(owners.raf);});owners.raf=0;
    for(const action of [()=>owners.input?.stopForReload(),()=>owners.post?.stopForReload(),
      ()=>owners.effects?.stopForReload(),()=>stopMusicForReload(),()=>mixer.stopForReload(),
      ()=>{if(owners.game){owners.game.paused=true;return owners.game.closeFigureResources();}}])attempt(action);
    publish();
  };
  const onLoss=()=>{
    if(!owners.renderer.getContext().isContextLost())return;
    eventProcessed=true;stop();publish();
    if(disposalQueued)return;disposalQueued=true;
    // Registered LAST: every owner loss listener has already retired its old callbacks.
    // Game's one initial microtask retires materials/atlases before its network wait.
    // FIFO puts renderer disposal after that phase, without awaiting pending atlas I/O.
    queueMicrotask(()=>attempt(()=>{owners.renderer.dispose();rendererDisposed=true;}));
  };
  return Object.freeze({
    listenLast(){canvas.removeEventListener('webglcontextlost',onLoss);canvas.addEventListener('webglcontextlost',onLoss);},
    check(){if(owners.renderer.getContext().isContextLost())stop();return !stopped;},
    get stopped(){return stopped;},
    get snapshot(){return Object.freeze({stopped,eventProcessed,disposalQueued,rendererDisposed,failed,
      error:failed?String(failure?.message??failure):null,figures:owners.game?.figureResourceSnapshot()??null});}
  });
}

let fieldClaimed = false;
// Importing this module has no field side effects. The owner commits navigation only after recheck.
// A campaign launch ({ campaign: { slot, replay } }, from ?campaign=<slot>[&replay]) loads that slot's next phase.
export async function startField({ manifest = null, campaign = null, isCurrent = () => true, onAdmitted = () => {}, diagnosticTerrainFactory = null, diagnosticPost = null } = {}) {
  const resourceSearch=location.search,profile=fieldResourceProfile(resourceSearch);
  if(profile && (diagnosticTerrainFactory!==null || diagnosticPost!==null))throw new Error('Field: resource profile conflicts with diagnostic owners');
  if (diagnosticTerrainFactory !== null && (typeof diagnosticTerrainFactory !== 'function'
    || Object.prototype.toString.call(diagnosticTerrainFactory) === '[object AsyncFunction]')) throw new Error('Field: synchronous diagnostic terrain factory required');
  const postDiagnostic = pinPostResourceDiagnostic(diagnosticPost);
  if (!isCurrent()) throw new Error('Practice: deployment review was cancelled.');
  if (campaign && (manifest || ![1, 2, 3].includes(campaign.slot)
    || ['intro', 'practice', 'battle', 'sandbox', 'tune'].some((key) => new URLSearchParams(location.search).has(key)))) {
    throw new Error('Campaign: a campaign phase cannot share its launch with another field mode.');
  }
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
    // ?battle=<packId>[&phase=<phaseId>]: any battle pack but Henry Hill, which keeps its own route.
    const query = new URLSearchParams(location.search), packId = manifest || campaign ? null : query.get('battle');
    // Campaign: the slot's save and the shipped ladder name the phase; the pack is loaded, then carry and franchise apply.
    let launch = null;
    if (campaign) {
      const ladder = await loadCampaign();
      if (!ladder) throw new Error('Campaign: no campaign ships yet.');
      const store = createProgressStore(undefined, { slot: campaign.slot }), save = await store.load();
      if (!save || save.version !== 2) throw new Error(`Campaign: save slot ${campaign.slot} holds no campaign.`);
      const phase = campaignPhase(save, ladder.raw, { replay: campaign.replay === true });
      if (!phase) throw new Error('Campaign: this campaign is complete. Return to camp to see the record.');
      const loaded = await loadBattlePack({ packId: phase.packId, phaseId: phase.phaseId, isCurrent });
      launch = { slot: campaign.slot, store, save, raw: ladder.raw, def: ladder.def, phase, loaded,
        scenario: prepareFieldScenario(applyCampaign(loaded.scenario, save, phase), 'pack') };
    }
    const pack = launch ? launch.loaded : packId && packId !== 'henry-hill'
      ? await loadBattlePack({ packId, phaseId: query.get('phase') ?? undefined, isCurrent }) : null;
    const ground = manifest || pack ? null : await loadFieldScenario({ isCurrent });
    currentOwner();
    const routeId = manifest ? 'saved-practice' : pack ? 'pack' : mode === 'practice' && !new URLSearchParams(location.search).has('practice') ? 'first-command' : 'henry-hill';
    // A saved manifest's scenario reference is the authoritative outcome identity.
    const scenario = manifest ? (prepareFieldScenario(manifest.scenario, routeId), manifest.scenario) : launch ? launch.scenario : pack ? pack.scenario
      : prepareFieldScenario(routeId === 'first-command' ? introScenario(ground, { surrender: fictionalSurrenderRoute(location.search) }) : ground, routeId);
    document.getElementById('status').textContent = 'Loading the ground…';
    const terrain = await loadTerrainData('./assets/terrain', scenario.terrain ?? 'henry-hill');
    const resources=profile ? await prepareFieldResources(resourceSearch) : null;
    currentOwner();
    if (manifest) {
      const current = await createProgressStore().load();
      assertSavedLaunch(manifest, current);
      currentOwner();
      onAdmitted();
    }

const stats = { fps: 0, scale: 1, quality: 'auto', drawCalls: 0, triangles: 0, figures: 0 };
let graphicsStop=null;
Object.defineProperties(stats,{resourceProfile:{value:resources?.name??null,enumerable:true},
  resourceStop:{get:()=>graphicsStop?.snapshot??null,enumerable:true}});
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
const resourceOwners={renderer,post:null,game:null,effects:null,input:null,briefing:null,raf:0};
graphicsStop=resources ? createFieldGraphicsStop(resourceOwners) : null;
graphicsStop?.listenLast();
renderer.autoClear = false;
renderer.info.autoReset = false;
// ?quality=auto|high|low overrides the saved choice for this visit (tests use low) without saving it.
const urlQuality = new URLSearchParams(location.search).get('quality');
const post = new Post(renderer, { mode: QUALITY_MODES.includes(urlQuality) ? urlQuality : loadPref('cw.quality', 'auto'),
  diagnosticPixelBytes: resources?.pixelBytes ?? postDiagnostic?.pixelBytes ?? null,resourceLifetime:!!resources });
resourceOwners.post=post;graphicsStop?.listenLast();
if (postDiagnostic) {
  const prepared = postDiagnostic.prepare({ post, renderer });
  if (prepared !== undefined) {
    if (prepared && typeof prepared.then === 'function') Promise.resolve(prepared).catch(() => {});
    throw new Error('Field: diagnostic Post preparation must complete synchronously without a return value');
  }
}
post.setSize(window.innerWidth, window.innerHeight);
if(graphicsStop && !graphicsStop.check())return;
// GPU tier picks Auto's starting level; benchmark tables are vendored (no CDN). Failure keeps High.
const gpuTier = detectFieldGPUTier(renderer,post,stats,graphicsStop);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 2, 6000);

const world = buildWorld(scene, terrain, scenario, { terrainMeshFactory: diagnosticTerrainFactory });
let terrainOwner=null;
if(resources){
  terrainOwner=prepareTerrainPartition(world.terrainMesh,renderer);graphicsStop.listenLast();
  const installed=terrainOwner.install();
  if(!graphicsStop.check())return;
  if(installed!==true)throw new Error('Field: terrain resource preparation incomplete');
}
Object.assign(stats, world.stats);

// Opening view: both armies between the clock and the bottom panels; the pitch follows the zoom.
const rts = new RtsCamera(camera, terrain, scenario.camera
  ? { target: [...scenario.camera.target], yaw: scenario.camera.yaw, dist: scenario.camera.dist }
  : scenario.practiceIntro
  ? { target: [-300, -610], yaw: -Math.PI / 2 - 0.12, dist: 740 }
  : { target: [-60, 200], yaw: -Math.PI / 2 - 0.12, dist: 1150 });
const effects = new Effects(scene, terrain, rts);
resourceOwners.effects=effects;
graphicsStop?.listenLast();
await effects.init();
if(graphicsStop && !graphicsStop.check())return;
// Sound: no music over a battle; banks load after the first gesture (the mixer waits for it).
setBattle(true);
mixer.arm();
const recordingLoads = [mixer.loadBank('battle'), mixer.loadBank('ambient', { season: scenario.season })];
let recordingsLimited = false;
const recordingsNotice = 'Some recorded battle sounds are unavailable. You can still play.';
const _snd = new THREE.Vector3();
/** Where a field point sits for the ear: pan by screen x, quieter and duller with distance from the camera. */
const locate = (x, z) => {
  _snd.set(x, terrain.heightAt(x, z) + 2, z);
  const d = _snd.distanceTo(camera.position);
  _snd.project(camera);
  const pan = _snd.z > 1 ? 0 : Math.max(-1, Math.min(1, _snd.x)) * 0.8;
  return { pan, gain: Math.min(1, 700 / (d + 200)), lowpass: d > 1600 ? 1400 : d > 900 ? 2800 : 0 };
};
const director = new Director({ mixer, locate });
effects.director = director;
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
const game = new Game({ scene, terrain, scenario, world, effects, playerSide: 'US',
  figureResourceLifetime:!!resources,renderer:resources?renderer:null,csRuntimeClose:resources?.csRuntimeClose??null });
resourceOwners.game=game;
FALLEN.clock = () => game.simTime; // gore off: the fallen fade on battle time (a pause holds them)
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
  onSound: (on) => { effects.setSound(on); setSetting('audio.mute', !on); },
});
// The menu's Sound box is the Settings panel's Mute, inverted; ZzFX (the fallback before the banks load) follows it.
{
  const box = document.getElementById('sound-toggle');
  const sync = (muted) => { box.checked = muted !== true; effects.setSound(muted !== true); };
  sync(getSetting('audio.mute'));
  onSetting('audio.mute', sync);
}
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
setQualityHandler((mode) => setQuality(mode), () => post.mode);

document.getElementById('history-note').textContent = pack ? scenario.historyNote ?? '' : scenario.historyNote;
document.getElementById('menu-title').textContent = scenario.title;
document.getElementById('menu-subtitle').textContent = pack ? scenario.subtitle ?? scenario.title
  : scenario.practiceIntro ? 'Fictional teaching exercise · Henry Hill terrain' : 'First Bull Run · 21 July 1861 · 2:00 p.m.';
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
resourceOwners.input=input;
const readout = new Readout({ scene, terrain, camera, game, layer: document.getElementById('ticks') });
defineSandboxTools({ game, rts, effects, hud });
practiceFlow = attachPracticeFlow({ game, scenario, hud, mode, manifest, campaign: launch });
const practiceField = attachPracticeField({ game, scenario, hud, camera, terrain, rts, effects, manifest });
document.getElementById('play-mode').textContent = launch ? launch.phase.loan
    ? "Campaign · Grant's army on loan; your brigades are unchanged" : 'Campaign · losses and loot carry to your army'
  : pack || mode === 'historical' ? 'Historical battle · no franchise rewards'
  : mode === 'practice' ? 'Practice · rewards enabled' : 'Sandbox · no progress rewards';
// keep the pause/speed buttons in step with keyboard changes
const togglePause = game.togglePause.bind(game);
game.togglePause = () => { const p = togglePause(); hud.setPaused(p); return p; };
const setSpeed = game.setSpeed.bind(game);
game.setSpeed = (s) => { setSpeed(s); hud.setSpeed(s); };

const tip = document.getElementById('tip');
game.on('select', () => { if (game.orders) tip.hidden = true; });

// Campaign: the menu's camp link returns to this slot, and the Briefing holds the field paused until Begin.
let briefing = null;
if (launch) {
  const campLink = document.querySelector('#menu a[href="?camp"]');
  if (campLink) { campLink.href = `?camp=${launch.slot}`; campLink.textContent = 'Campaign camp'; }
  briefing = mountBriefing({ scenario, phase: launch.phase, game, hud, effects });
  resourceOwners.briefing=briefing;
}

window.addEventListener('resize', () => {
  if(graphicsStop?.stopped)return;
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
const lensAvailable = () => !graphicsStop?.stopped && !document.querySelector('main')?.inert && !document.querySelector('dialog[open]')
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
window.addEventListener('resize', () => {if(!graphicsStop?.stopped)soldierView.onResize();});
for (const event of ['select', 'remove']) game.on(event, () => {
  if (soldierView.active && !soldierView.valid()) soldierView.end('selection');
});

// All field subscribers must receive zero-time arrivals before the first simulation step.
game.initializeReinforcements();

// ---------------------------------------------------------------------------------------------------
// Sound, once a frame: firing count, charges (a cheer as one goes in), mounted cavalry on the move, and the player's
// order calls. game.orders counts accepted player orders; the kind is read from what changed on the player's units.
const ORDER_KIND = { move: 'move', attack: 'attack', charge: 'charge', hold: 'hold', fallback: 'fallback' };
const orderSeen = new Map(); // unit -> { order, type, run, holdFire }
const charging = new Set();
let ordersSeen = game.orders || 0;
function orderKind() {
  let kind = null;
  for (const u of game.units) {
    const s = orderSeen.get(u);
    if (!s || !u.alive || kind) continue;
    if (!!u.holdFire !== s.holdFire) kind = 'holdfire';
    else if (u.order !== s.order) kind = u.order?.type === 'hold' && !u.order.firm ? 'halt' : ORDER_KIND[u.order?.type] ?? null;
    else if (!!u.run !== s.run) kind = 'run';
  }
  return kind;
}
function soundFrame(dt) {
  let firing = 0, cavalry = null, near = Infinity;
  for (const u of game.units) {
    if (!u.alive) { charging.delete(u); continue; }
    if (u.firing) firing++;
    const charge = u.order?.type === 'charge' && u.follow?.active && u.state !== 'routing';
    if (charge && !charging.has(u)) { charging.add(u); director.cheer(u.x, u.z); }
    else if (!charge) charging.delete(u);
    if (u.type === 'cavalry' && u.mounted && u.follow?.active) {
      const d = Math.hypot(u.x - rts.target.x, u.z - rts.target.z);
      if (d < near) { near = d; cavalry = u; }
    }
  }
  const n = game.orders || 0;
  if (n !== ordersSeen) { ordersSeen = n; const kind = orderKind(); if (kind) director.order(kind); }
  for (const u of game.units) {
    if (!u.alive || !game.controls(u)) { orderSeen.delete(u); continue; }
    let s = orderSeen.get(u);
    if (!s) orderSeen.set(u, s = {});
    s.order = u.order; s.run = !!u.run; s.holdFire = !!u.holdFire;
  }
  director.update(dt, { paused: game.paused || game.over, firing, season: scenario.season, cavalry });
}

// ---------------------------------------------------------------------------------------------------
// Loop
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let resultShown = false;
function frame(now) {
  resourceOwners.raf=0;
  if(graphicsStop && !graphicsStop.check())return;
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
  soundFrame(dt);
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
  if(graphicsStop && !graphicsStop.check())return;
  post.render(scene, camera);
  if(graphicsStop && !graphicsStop.check())return;
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
    const atlases = game.baked.atlases ? Object.values(game.baked.atlases) : [];
    stats.atlasMB = Math.round(atlases.reduce((b, a) => b + a.memoryBytes(), 0) / 1e5) / 10;
    stats.simTime = Math.round(game.simTime);
    stats.puffs = effects.puffs;
    fpsEl.textContent = stats.fps.toFixed(0);
    scaleEl.textContent = `· ${post.mode} ×${post.scale.toFixed(2)}`;
    const c = game.clockText();
    hud.setClock(c.date, c.time, c.frac);
    const o = game.objective;
    hud.objective(`Objective: ${(scenario.attacker ?? 'US') === game.playerSide ? 'take' : 'hold'} ${o.name}. ${game.holder === 'US' ? 'Union troops hold it.' : game.holder === 'CS' ? 'The Confederates hold it.' : game.holder === 'contested' ? 'Contested.' : 'Nobody holds it.'}`);
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (game.over && !resultShown) {
    resultShown = true;
    setBattle(false);
    playMusic(resultsMood({ lossShare: lossShareOf(game) })); // a lament after heavy losses
    practiceFlow.finishResult();
  }
  if (!window.__ready) {
    window.__ready = true;
    statusEl.textContent = manifest ? 'Your saved army is ready. Continue begins the fictional exercise; losses return to camp.' : scenario.practiceIntro ? 'Your first command is ready. Continue begins the fictional practice fight.'
      : launch ? `${scenario.title}: campaign briefing. Begin starts the phase.`
      : pack ? scenario.statusText ?? `${scenario.title} is ready. Select a brigade, then drag to give it orders.`
      : 'Henry House Hill, 21 July 1861. Union brigades are below the hill; Jackson holds the crest.';
    if (recordingsLimited) statusEl.textContent += ' ' + recordingsNotice;
  }
  if(!graphicsStop?.stopped)resourceOwners.raf=requestAnimationFrame(frame);
}
graphicsStop?.listenLast();
if(!graphicsStop || graphicsStop.check())resourceOwners.raf=requestAnimationFrame(frame);

window.__game = { game, rts, terrain, scene, camera, post, world, effects, input, hud, arrows, readout, soldierView, gpuTier, practice: practiceFlow, practiceField, manifest,
  resources:resources?Object.freeze(Object.defineProperty({profile:resources.name,get terrain(){return terrainOwner.receipt;},get terminal(){return graphicsStop.snapshot;}},
    'terrainArrays',{get:()=>terrainOwner.retainedArrays})):null,
  audio: { mixer, director }, // the UI test spies on mixer.log; nothing plays without a gesture
  pack: pack ? { packId: pack.packId, phaseId: pack.phaseId, nextId: pack.nextId } : null,
  // Campaign phase launch (tests force a result through window.__game.game, then drive the real result dialog).
  campaign: launch ? { slot: launch.slot, phase: launch.phase, briefing } : null };

// The current field reports actual decoded availability, without carrying a preparation flag across pages.
Promise.allSettled(recordingLoads).then(() => {
  if (window.__game?.game !== game || !statusEl.isConnected || game.over || graphicsStop?.stopped || mixer.stoppedForReload) return;
  const ids = [...bankIds('battle'), ...bankIds('ambient', { season: scenario.season })];
  if (ids.every(id => mixer.has(id))) return;
  recordingsLimited = true;
  hud.toast(recordingsNotice);
  if (window.__ready) statusEl.textContent += ' ' + recordingsNotice;
});

// Developer tuning panel (lil-gui), only with ?tune in the URL; players never load it.
if (new URLSearchParams(location.search).has('tune')) {
  import('./dev/tune.js').then((m) => {if(!graphicsStop?.stopped)m.openTuner({ post, world });});
}

// Sandbox workbench panel, with ?sandbox in the URL (Menu > Sandbox).
if (new URLSearchParams(location.search).has('sandbox')) {
  import('./sandbox/panel.js').then((m) => {if(!graphicsStop?.stopped)m.mountSandbox({ game: window.__game });});
}

// Installable app: the service worker only on the live https site (local http dev and tests never get one); ?nosw skips it.
if ((location.protocol === 'https:' || new URLSearchParams(location.search).has('sw')) && 'serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((err) => console.warn('service worker not registered:', err && err.message ? err.message : err));
}
  } finally {
    // Once allocated, a retry needs a new page; never stack GPU state, listeners or RAF loops.
    if (!allocated) fieldClaimed = false;
  }
}

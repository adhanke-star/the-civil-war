// src/audio/music.js: period music on the title, in camp and on the results (DESIGN §4 Music: period tunes on period
// instruments; a sombre hymn after heavy losses; nothing over battle).
//
//   playMusic(mood)    'title' | 'camp' | 'results' | 'lament': crossfades to that tune and loops it; refused while a
//                      battle is on (setBattle). Before the first gesture it only remembers the mood (nothing loads).
//   stopMusic(s)       fade out over s seconds
//   setBattle(on)      main.js: true when a field starts (stops the music), false once the result is in
//   resultsMood({ lossShare })  'lament' when the player's side lost HEAVY_LOSSES or more of its men, else 'results'
// Tunes are streamed by an <audio> element (preload none; never decoded up front) and routed through the mixer's music
// bus, so the Music and Master sliders and Mute apply. While the music level is 0 nothing streams.

import { on } from '../settings.js';
import { mixer } from './mixer.js';
import { MOODS } from './bank.js';

export const HEAVY_LOSSES = 0.3; // share of the player's men lost in the phase that turns the results tune to a lament
const FADE = 2;

let battle = false;
let want = null; // the mood asked for (plays once unlocked and audible)
let current = null; // { mood, el, gain, src, stopping }

export function setBattle(onField) { battle = !!onField; if (battle) stopMusic(0.8); }
export function currentMood() { return current && !current.stopping ? current.mood : null; }
export function wantedMood() { return want; }

/** Ask for a mood's tune; returns false if refused (unknown mood or a battle is on). */
export function playMusic(mood) {
  if (!MOODS[mood] || battle) return false;
  want = mood;
  if (currentMood() === mood) return true;
  mixer.onUnlock(sync);
  return true;
}

export function stopMusic(seconds = FADE) {
  want = null;
  fadeOut(current, seconds);
  current = null;
}

/** Start or stop streaming to match what is wanted and audible (also on a volume or mute change). */
function sync() {
  if (!mixer.unlocked) return;
  const audible = mixer.level('music') > 0;
  if (!want || battle || !audible) { if (current) { fadeOut(current, 0.4); current = null; } return; }
  if (currentMood() === want) return;
  start(want);
}

function start(mood) {
  const ctx = mixer.ctx, id = MOODS[mood];
  fadeOut(current, FADE);
  const el = typeof Audio === 'function' ? new Audio() : null;
  if (!el) return;
  el.preload = 'none'; el.loop = true; el.src = mixer.url(id);
  let src = null, gain = null;
  try {
    src = ctx.createMediaElementSource(el);
    gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(gain).connect(mixer.bus('music'));
    gain.gain.setTargetAtTime(1, ctx.currentTime, FADE / 3);
  } catch {
    src = null; gain = null; el.volume = Math.min(1, mixer.gainOf('music')); // no Web Audio routing: the element's own volume
  }
  current = { mood, el, src, gain, stopping: false };
  mixer.log.push({ id, bus: 'music', gain: 1, pan: 0, ok: true });
  const p = el.play();
  if (p && typeof p.catch === 'function') p.catch((err) => console.warn(`music: ${mood} did not start:`, err?.message ?? err));
}

function fadeOut(c, seconds) {
  if (!c || c.stopping) return;
  c.stopping = true;
  const done = () => {
    try { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); } catch { /* fine */ }
    try { c.src?.disconnect(); c.gain?.disconnect(); } catch { /* fine */ }
  };
  if (c.gain && mixer.ctx && seconds > 0) {
    c.gain.gain.setTargetAtTime(0, mixer.ctx.currentTime, Math.max(0.02, seconds / 3));
    setTimeout(done, seconds * 1000 + 250);
  } else done();
}

/** The results tune for a finished phase: a lament after heavy losses. */
export function resultsMood({ lossShare = 0 } = {}) { return lossShare >= HEAVY_LOSSES ? 'lament' : 'results'; }

/** Share of the player's men lost (casualties over men at the start), from a game's units. */
export function lossShareOf(game) {
  let lost = 0, start = 0;
  for (const u of game?.units || []) {
    if (u.side !== game.playerSide) continue;
    const men = Number(u.men) || 0, cas = Number(u.casualties) || 0;
    lost += cas; start += men + cas;
  }
  return start > 0 ? lost / start : 0;
}

for (const key of ['audio.music', 'audio.master', 'audio.mute']) on(key, () => sync());

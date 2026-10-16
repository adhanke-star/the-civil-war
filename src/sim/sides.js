// src/sim/sides.js: the side the player commands in a Battles-menu phase (v2 "play either side", DECISIONS 0273).
//
// The campaign, practice and saved deployments stay Union (their franchise rules refuse another side); only the Battles
// menu's ?battle=<pack>&phase=<id>&side=CS route hands the player the Confederates. The engine is already side-neutral
// (Game/Hud/Input take playerSide, the AI commands the other side); this module supplies the two things the phase data,
// authored for a Union player, lacks when the Union is the computer's:
//   - AI roles. The four Union-attack phases (Buell attacks, Orchard Knob, Lookout Mountain, Missionary Ridge) give no
//     Union formation an `ai` role, so a computer Union would only stand. When the AI's side is the phase's attacker and
//     the data gives none of its formations a role, every one of them (reinforcements on arrival) takes the attack role
//     at once on the objective: the phase opens at the hour its attack began. A game rule, not a history claim.
//   - The opening view: centred on the Confederate formations, looking across from the opposite bearing.
// A Union player gets the scenario back unchanged (the same object), so every existing battle runs exactly as before.

import { prepareFieldScenario } from './phase.js';

export const SIDES = Object.freeze(['US', 'CS']);
export const otherSide = (side) => (side === 'CS' ? 'US' : 'CS');
export const sideName = (side) => (side === 'CS' ? 'Confederate' : 'Union');

/** The Battles route's side from the address: `side=CS` commands the Confederates; anything else is the Union. */
export function battleSide(search) {
  return new URLSearchParams(search).get('side') === 'CS' ? 'CS' : 'US';
}

/** A prepared battle-pack phase as fought with `playerSide` under the player's command (see the header): US returns
 * `scenario` itself; CS a re-prepared ('pack' route) copy. */
export function sideScenario(scenario, playerSide) {
  if (playerSide !== 'CS') return scenario;
  const ai = otherSide(playerSide);
  const defs = [...(scenario.units || []), ...(scenario.reinforcements || [])].filter((d) => d.side === ai);
  const attackAll = scenario.attacker === ai && defs.length > 0 && !defs.some((d) => d.ai);
  const out = structuredClone(scenario);
  if (attackAll) {
    for (const list of [out.units, out.reinforcements]) {
      for (const d of list || []) if (d.side === ai) d.ai = { role: 'attack' };
    }
  }
  const camera = sideCamera(scenario, playerSide);
  if (camera) out.camera = camera;
  return prepareFieldScenario(out, 'pack');
}

/** The opening view for `playerSide`: the scenario's own for the Union; for the Confederates, their formations' centre seen from the opposite bearing. */
export function sideCamera(scenario, playerSide) {
  const cam = scenario.camera;
  if (playerSide !== 'CS' || !cam) return cam ?? null;
  const own = (scenario.units || []).filter((d) => d.side === playerSide && Number.isFinite(d.x) && Number.isFinite(d.z));
  if (!own.length) return cam;
  const x = own.reduce((n, d) => n + d.x, 0) / own.length, z = own.reduce((n, d) => n + d.z, 0) / own.length;
  const yaw = Math.atan2(Math.sin(cam.yaw + Math.PI), Math.cos(cam.yaw + Math.PI));
  return { ...cam, target: [Math.round(x), Math.round(z)], yaw: +yaw.toFixed(3) };
}

/** The Confederate opening target moved toward the enemy until the camera itself (up to `dist` behind it) stands on the map. */
export function fitSideCamera(cam, half, margin = 60) {
  const sx = Math.sin(cam.yaw), sz = Math.cos(cam.yaw), lim = half - margin;
  let [x, z] = cam.target;
  for (let i = 0; i < 400 && (Math.abs(x + sx * cam.dist) > lim || Math.abs(z + sz * cam.dist) > lim); i++) { x -= sx * 10; z -= sz * 10; }
  return [Math.round(x), Math.round(z)];
}

const UNION_TIPS = [['#tip', 'a <b>blue flag</b>', 'a <b>Confederate flag</b>'], ['#uc-empty', 'a blue flag', 'a Confederate flag'],
  ['#battlefield', 'a blue brigade', 'a Confederate brigade']];
/** The field's first instructions (index.html) name the Union's blue flags; for a Confederate player they name the player's own. */
export function sideTexts(doc, playerSide) {
  if (playerSide !== 'CS') return;
  for (const [sel, from, to] of UNION_TIPS) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    if (sel === '#battlefield') el.setAttribute('aria-label', (el.getAttribute('aria-label') || '').replace(from, to));
    else el.innerHTML = el.innerHTML.replace(from, to);
  }
}

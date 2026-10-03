// src/ui/sandbox-tools.js: the sandbox's unit tools (tab Units) and battle moments (tab Moments).
//
// Spawned brigades are generic ("Union brigade 3"): never a real commander, regiment or rank (AGENTS.md
// history rule). They are built by Game.spawnUnit, the same construction path as the scenario's units.

import { define, on, get } from '../settings.js';

export function defineSandboxTools({ game, rts, effects, hud }) {
  const say = (text) => hud.toast(text);

  /** View centre, nudged sideways (screen right) until no brigade stands within 60 m. */
  const spot = () => {
    const c = rts.target;
    const rx = Math.cos(rts.yaw), rz = -Math.sin(rts.yaw);
    for (let k = 0; k < 12; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 80;
      const x = c.x + rx * off, z = c.z + rz * off;
      if (!game.units.some((u) => u.alive && Math.hypot(u.x - x, u.z - z) < 60)) return [x, z];
    }
    return [c.x, c.z];
  };
  const spawn = (side) => {
    const [x, z] = spot();
    const u = game.spawnUnit({ side, men: Number(get('units.spawnStrength')), weapon: get('units.spawnWeapon'), x, z });
    if (u && game.controls(u)) game.select(u);
  };

  define('units.spawnUS', {
    tab: 'Units', type: 'action', label: 'Spawn Union brigade at view centre',
    note: 'Places a generic Union infantry brigade (strength and muskets below) at the centre of the view, facing the nearest enemy.',
    run: () => spawn('US'),
  });
  define('units.spawnCS', {
    tab: 'Units', type: 'action', label: 'Spawn Confederate brigade at view centre',
    note: 'Places a generic Confederate infantry brigade at the centre of the view; the Confederate AI commands it unless you control both sides.',
    run: () => spawn('CS'),
  });
  define('units.spawnStrength', {
    tab: 'Units', type: 'choice', default: 500, label: 'Next brigade\'s strength',
    options: [{ value: 500, label: '500' }, { value: 1000, label: '1,000' }, { value: 1500, label: '1,500' }, { value: 2500, label: '2,500' }],
    note: 'Men in the next brigade you place (one figure stands for ten men).',
  });
  define('units.spawnWeapon', {
    tab: 'Units', type: 'choice', default: 'smooth', label: 'Next brigade\'s muskets',
    options: [{ value: 'smooth', label: 'Smoothbore (119 m)' }, { value: 'rifled', label: 'Rifled (293 m)' }],
    note: 'Smoothbore muskets reach about 119 m, rifled muskets about 293 m (and hit harder).',
  });
  define('units.removeSelected', {
    tab: 'Units', type: 'action', label: 'Remove selected',
    note: 'Takes the selected brigades off the field (their fallen stay where they lie).',
    run: () => {
      const list = game.selection.slice();
      if (!list.length) { say('Select a brigade first.'); return; }
      for (const u of list) game.removeUnit(u);
      say(list.length === 1 ? `${list[0].short} removed.` : `${list.length} brigades removed.`);
    },
  });
  game.controlBoth = define('units.controlBothSides', {
    tab: 'Units', type: 'toggle', default: false, label: 'Command both sides',
    note: 'Lets you select and order Confederate brigades too; the AI leaves alone any you have ordered.',
  });
  on('units.controlBothSides', (v) => {
    game.controlBoth = v;
    if (!v) for (const u of game.units) u.manual = false; // the AI takes its brigades back
    hud.select(game.selected);
  });

  // ---- moments -------------------------------------------------------------------------------------------
  const chosen = () => {
    const u = game.selected;
    if (!u || !u.alive) { say('Select a brigade first.'); return null; }
    return u;
  };
  const nearestEnemy = (u, within = Infinity) => {
    let best = null, bd = within;
    for (const e of game.units) {
      if (e.side === u.side || !e.alive) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };
  define('moments.volley', {
    tab: 'Moments', type: 'action', label: 'Selected: fire a volley now',
    note: 'The selected brigade or battery fires at once at its target, or at the nearest enemy within range.',
    run: () => {
      const u = chosen();
      if (!u) return;
      const t = u.target && u.target.alive ? u.target : nearestEnemy(u, game.range(u));
      if (!t) { say(`No enemy within ${Math.round(game.range(u))} m of ${u.short}.`); return; }
      game.combat.volleyAt(u, t, game.simTime);
    },
  });
  define('moments.charge', {
    tab: 'Moments', type: 'action', label: 'Selected: charge nearest enemy',
    note: 'The selected brigade charges the nearest enemy, wherever it is (either side).',
    run: () => {
      const u = chosen();
      if (!u) return;
      const t = nearestEnemy(u);
      if (!t) { say('No enemy on the field.'); return; }
      if (u.orderCharge(t) && u.side !== game.playerSide) u.manual = true;
    },
  });
  define('moments.rout', {
    tab: 'Moments', type: 'action', label: 'Selected: rout',
    note: 'The selected brigade breaks and runs for the rear (it can rally once no enemy is near).',
    run: () => { const u = chosen(); if (u) game.combat.rout(u, true); },
  });
  define('moments.shell', {
    tab: 'Moments', type: 'action', label: 'Shell burst at view centre',
    note: 'A shell bursts at the centre of the view: smoke, a bang and a few men down within 30 m.',
    run: () => {
      const { x, z } = rts.target;
      effects.shellBurst(x, z);
      for (const u of game.units) {
        if (!u.alive) continue;
        const d = Math.hypot(u.x - x, u.z - z);
        if (d > 30 + u.halfFront * 0.5) continue;
        const lost = Math.min(u.men, 3 + Math.round(game.rnd() * 5));
        u.takeLosses(lost, game.fallen[u.side], game.simTime);
        u.casTick = (u.casTick || 0) + lost;
        u.underFire = 1.4;
      }
    },
  });
}

// CPU check: no fire through friends (DESIGN.md §4b "Masked"; src/sim/combat.js masks, rules.friendlyMask).
// Fictional fields on flat ground, built here from small unit definitions; nothing here is historical.
// `node tools/test-masking.mjs` prints MASKING OK (n/n); `--prove-fail` also runs one mutant per check and requires
// each to fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import { activity } from '../src/ui/hud.js';
import * as settings from '../src/settings.js';

RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PAD = 8; // the contract's pad on each side of a friend's front
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const def = (id, side, x, z, extra = {}) => ({ id, name: 'Fictional ' + id, short: id, side, type: 'infantry', men: 800, weapon: 'rifled', xp: 1,
  commander: null, regiments: [], x, z, facing: side === 'US' ? 0 : Math.PI, sources: [], ...extra });

/** A fictional field: every unit holds and holds fire except the listed shooters; the AI orders nobody. */
function field(api, defs, shooters = ['shooter']) {
  const s = { id: 'henry-hill', title: 'Fictional masking CPU check', battle: 'CPU CHECK ONLY', date: '1861-07-21', start: '14:00', end: '15:00',
    units: defs, sites: [], woods: [], objective: { name: 'Fictional remote point', x: 1800, z: 1800, r: 45 } };
  setPlan(s);
  const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects: { volley() {}, boom() {} } });
  for (const u of g.units) { u.manual = true; u.holdFire = !shooters.includes(u.id); }
  api.patch(g);
  return g;
}
const unit = (g, id) => g.units.find(u => u.id === id);
const run = (g, seconds) => { for (let k = 0; k < Math.round(seconds / 0.05); k++) g.tick(0.05); };
const moveTo = (u, x, z) => { u.vehicle.position.x = x; u.vehicle.position.z = z; };
/** Half-front of a fictional 800-man line, read from a real unit so geometry follows the live layout. */
function lineHalf(api) { return unit(field(api, [def('probe', 'US', 0, 0)], []), 'probe').halfFront; }
/** One target pick and one loaded volley step for the shooter, before any unit turns (holding units face their target). */
function fireOnce(g) { const u = unit(g, 'shooter'); g.combat.pickTargets(); u.reload = 1; g.combat.fireStep(u, 0.05, 1); return [u.shots || 0, u.masked]; }
function withMask(on, fn) { const prev = RULES.friendlyMask; RULES.friendlyMask = on; try { return fn(); } finally { RULES.friendlyMask = prev; } }

/** Independent re-statement of the rule, parameterised so mutants can drop the pad or the nearer test. */
function refMasks(pad, nearer) {
  return function (u, e) {
    const dx = e.x - u.x, dz = e.z - u.z, reach = Math.hypot(dx, dz);
    for (const f of this.units) {
      if (f === u || f.side !== u.side || !f.alive) continue;
      if (nearer && Math.hypot(f.x - u.x, f.z - u.z) >= reach) continue;
      const h = f.halfFront + pad, lx = Math.cos(f.facing), lz = -Math.sin(f.facing);
      const ax = f.x + lx * h - u.x, az = f.z + lz * h - u.z, bx = f.x - lx * h - u.x, bz = f.z - lz * h - u.z;
      const side = (px, pz) => Math.sign(dx * pz - dz * px);
      const across = (x1, z1, x2, z2) => Math.sign((x2 - x1) * (0 - z1) - (z2 - z1) * (0 - x1)) !== Math.sign((x2 - x1) * (dz - z1) - (z2 - z1) * (dx - x1));
      if (side(ax, az) !== side(bx, bz) && across(ax, az, bx, bz)) return true;
    }
    return false;
  };
}

export const MASK_CHECKS = [
  ['masked-blocks-fire', async api => {
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', 0, 100), def('enemy', 'CS', 0, 200)]);
    const u = unit(g, 'shooter'), e = unit(g, 'enemy');
    g.combat.pickTargets();
    assert.equal(u.target?.id ?? null, null, 'masked-blocks-fire: the only enemy is behind a friend, so no target');
    assert.equal(u.masked, true, 'masked-blocks-fire: shooter reports masked');
    run(g, 4);
    assert.deepEqual([u.shots || 0, e.men, u.masked], [0, e.menMax, true], 'masked-blocks-fire: no volley through the friend in 4 s');
  }],
  ['pad-and-offset', async api => {
    const h = lineHalf(api);
    const shotsWith = fx => fireOnce(field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', fx, 100), def('enemy', 'CS', 0, 200)]));
    const inside = shotsWith(h + PAD - 3), beyond = shotsWith(h + PAD + 3);
    assert.deepEqual(inside, [0, true], `pad-and-offset: a friend whose front + ${PAD} m pad covers the line (offset ${(h + PAD - 3).toFixed(1)} m) masks it`);
    assert.ok(beyond[0] > 0 && beyond[1] === false, `pad-and-offset: a friend offset beyond its front + pad lets the shooter fire ${JSON.stringify(beyond)}`);
  }],
  ['farther-fires', async api => {
    // The friend's oblique front crosses the line of fire short of the enemy, but its centre is farther than the enemy.
    const h = lineHalf(api) + PAD, a = 0.4 * h, b = 0.1 * h, k = 0.2 * h;
    const len = Math.hypot(a, b + k), Lx = -a / len, Lz = -(b + k) / len;
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', a, 200 + b, { facing: Math.atan2(-Lz, Lx) }), def('enemy', 'CS', 0, 200)]);
    const u = unit(g, 'shooter'), f = unit(g, 'friend');
    assert.ok(Math.hypot(f.x, f.z) > 200 && refMasks(PAD, false).call(g.combat, u, unit(g, 'enemy')), 'farther-fires: fixture friend is beyond the enemy yet its front crosses the line');
    const r = fireOnce(g);
    assert.ok(r[0] > 0 && r[1] === false, `farther-fires: a friend farther than the target does not mask ${JSON.stringify(r)}`);
  }],
  ['second-target', async api => {
    const h = lineHalf(api), xB = 2 * (h + PAD) + 30;
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', 0, 100), def('enemyA', 'CS', 0, 200), def('enemyB', 'CS', xB, 200)]);
    const u = unit(g, 'shooter'), A = unit(g, 'enemyA'), B = unit(g, 'enemyB');
    withMask(false, () => g.combat.pickTargets());
    assert.equal(u.target?.id ?? null, 'enemyA', 'second-target: unmasked, the nearer enemy A is the better target');
    run(g, 4);
    assert.equal(u.target?.id ?? null, 'enemyB', 'second-target: masked A is passed over for clear B');
    assert.ok(B.men < B.menMax && A.men === A.menMax && u.masked === false, `second-target: B is fired on, A is not ${JSON.stringify([A.men, B.men, u.masked])}`);
  }],
  ['artillery-masked', async api => {
    const gun = { type: 'artillery', men: 100, guns: 4, weapon: 'napoleon' };
    const trace = friendX => {
      const g = field(api, [def('shooter', 'US', 0, 0, gun), def('friend', 'US', friendX, 200), def('enemy', 'CS', 0, 400)]);
      const u = unit(g, 'shooter'); u.unlimbered = true; run(g, 6); return [u.shots || 0, u.masked, unit(g, 'enemy').men];
    };
    const masked = trace(0), clear = trace(900);
    assert.ok(clear[0] > 0, 'artillery-masked: the battery fires with a clear line ' + JSON.stringify(clear));
    assert.deepEqual(masked.slice(0, 2), [0, true], 'artillery-masked: guns do not fire over a friendly line ' + JSON.stringify(masked));
  }],
  ['rule-off-restores', async api => {
    const spec = settings.all().find(e => e.key === 'rules.friendlyMask');
    assert.deepEqual([spec?.spec.tab, spec?.spec.type, spec?.spec.default, RULES.friendlyMask], ['Rules', 'toggle', true, true], 'rule-off-restores: Rules tab toggle, on by default');
    const prev = settings.get('rules.friendlyMask');
    settings.set('rules.friendlyMask', false);
    try {
      assert.equal(RULES.friendlyMask, false, 'rule-off-restores: the sandbox setting reaches RULES');
      const trace = withFriend => {
        const g = field(api, [def('shooter', 'US', 0, 0), ...(withFriend ? [def('friend', 'US', 0, 100)] : []), def('enemy', 'CS', 0, 200)]);
        run(g, 4); const u = unit(g, 'shooter'); return [u.shots || 0, u.masked, unit(g, 'enemy').men, u.reload];
      };
      const through = trace(true), open = trace(false);
      assert.ok(through[0] > 0, 'rule-off-restores: with the rule off the shooter fires through its friend ' + JSON.stringify(through));
      assert.deepEqual(through, open, 'rule-off-restores: the fire trace equals a field with no friend at all');
    } finally { settings.set('rules.friendlyMask', prev); }
  }],
  ['flag-clears', async api => {
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', 0, 100), def('enemy', 'CS', 0, 200)]);
    const u = unit(g, 'shooter');
    run(g, 1);
    assert.deepEqual([u.masked, u.shots || 0], [true, 0], 'flag-clears: masked while the friend stands across the line');
    moveTo(unit(g, 'friend'), 900, 100);
    run(g, 2);
    assert.ok(u.masked === false && (u.shots || 0) > 0 && u.target?.id === 'enemy', `flag-clears: friend gone, flag clears and fire resumes ${JSON.stringify([u.masked, u.shots || 0])}`);
  }],
  ['volley-time-mask', async api => {
    // A friend steps across the line after the target pick; the volley itself is refused.
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', 900, 100), def('enemy', 'CS', 0, 200)]);
    const u = unit(g, 'shooter'), e = unit(g, 'enemy');
    g.combat.pickTargets();
    assert.deepEqual([u.target?.id ?? null, u.masked], ['enemy', false], 'volley-time-mask: clear line at the pick');
    moveTo(unit(g, 'friend'), 0, 100); u.reload = 1;
    g.combat.fireStep(u, 0.05, 1);
    assert.deepEqual([u.shots || 0, u.masked, u.target?.id ?? null, u.firing, e.men], [0, true, null, false, e.menMax], 'volley-time-mask: no volley once a friend masks the line');
  }],
  ['marker-word', async api => {
    const g = field(api, [def('shooter', 'US', 0, 0), def('friend', 'US', 0, 100), def('enemy', 'CS', 0, 200)]);
    const u = unit(g, 'shooter');
    run(g, 1);
    assert.deepEqual(api.activity(u), ['Masked', 'warn'], 'marker-word: a masked unit reads Masked on its marker');
    u.holdFire = true;
    assert.notEqual(api.activity(u)[0], 'Masked', 'marker-word: Hold Fire is not reported as Masked');
    u.holdFire = false; moveTo(unit(g, 'friend'), 900, 100); run(g, 2);
    assert.equal(api.activity(u)[0], 'Firing', 'marker-word: the word goes once the line is clear');
  }],
];

const API = { patch() {}, activity };
const wrap = (g, name, after) => { const orig = g.combat[name].bind(g.combat); g.combat[name] = (...a) => { const before = g.units.map(u => u.masked); const r = orig(...a); after(g, before); return r; }; };
// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'masked-blocks-fire': { patch: g => { g.combat.masks = () => false; } },
  'pad-and-offset': { patch: g => { g.combat.masks = refMasks(0, true); } },
  'farther-fires': { patch: g => { g.combat.masks = refMasks(PAD, false); } },
  'second-target': { patch: g => wrap(g, 'pickTargets', g2 => { if (RULES.friendlyMask) for (const u of g2.units) if (u.target && g2.combat.enemiesOf(u).some(e => g2.combat.masks(u, e))) u.target = null; }) },
  'artillery-masked': { patch: g => { const m = g.combat.masks.bind(g.combat); g.combat.masks = (u, e) => u.type === 'artillery' ? false : m(u, e); } },
  'rule-off-restores': { patch: g => { const step = g.combat.step.bind(g.combat); g.combat.step = (dt, t) => withMask(true, () => step(dt, t)); } },
  'flag-clears': { patch: g => wrap(g, 'pickTargets', (g2, before) => { g2.units.forEach((u, i) => { if (before[i]) { u.masked = true; u.target = null; } }); }) },
  'volley-time-mask': { patch: g => { g.combat.masks = () => false; } },
  'marker-word': { activity: u => activity(Object.assign(Object.create(u), { masked: false })) },
};

export async function maskingUnit(api = API) {
  for (const [, check] of MASK_CHECKS) await check(api);
  return MASK_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const count = await maskingUnit();
  console.log(`MASKING OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of MASK_CHECKS) {
      let error; try { await check({ ...API, ...MUTANTS[name] }); } catch (e) { error = e; }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`MASKING CONTROLS OK (${rows.length}/${count})`);
  }
}

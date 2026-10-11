// CPU check: cavalry (DESIGN.md 2 "Cavalry"): type 'cavalry' validated in src/sim/phase.js; mounted pace, the column,
// dismount / remount and horse-holders in src/units/unit.js; fire, the mounted charge, riding down and the screen in
// src/sim/combat.js; pursuit, shock and flank attacks in src/sim/ai.js; the capture of ridden-down units, pursuit
// steering and the horses drawn in src/game.js. Fictional fixtures are built here from assets/scenarios/henry-hill.json
// on flat ground. `node tools/test-cavalry.mjs` prints CAVALRY OK (n/n); `--prove-fail` also runs one semantic mutant per
// check and requires each to fail its own assertion with that check's name. No browser, no GPU, writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { Unit } from '../src/units/unit.js';
import { Combat, CAVALRY, CAV, SCREENED } from '../src/sim/combat.js';
import { setPlan } from '../src/world/landscape.js';
import { RULES } from '../src/sim/rules.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { prepareFieldScenario } from '../src/sim/phase.js';
import { henryHillRun } from './test-packs.mjs';

const HH = JSON.parse(fs.readFileSync(new URL('../assets/scenarios/henry-hill.json', import.meta.url)));
// The Henry Hill oracle is owned by tools/test-packs.mjs and the 16 s places by tools/test-ai.mjs; read them, never restate them.
const ORACLE = JSON.parse(fs.readFileSync(new URL('./test-packs.mjs', import.meta.url), 'utf8').match(/^const HENRY_ORACLE = (\{.*\});$/m)[1]);
const PLACES = JSON.parse(fs.readFileSync(new URL('./test-ai.mjs', import.meta.url), 'utf8').match(/^const PLACES = (\[.*\]);$/m)[1]);
const copy = structuredClone;
const terrain = { half: 2000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const effects = { volley() {}, boom() {} };
RULES.autoPause = false; RULES.battleSpeed = 1;
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const API = { patch: {}, prepare: (s) => prepareFieldScenario(s, 'pack') };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** A fictional cavalry regiment (never a historical unit). */
const horse = (id, side, over = {}) => ({ id, name: `Fictional ${side} cavalry ${id} (test only)`, short: id, side, type: 'cavalry', weapon: 'carbine',
  men: 600, xp: 1, x: 0, z: 0, facing: 0, commander: null, parent: 'Test fixture', regiments: [], sources: [], notes: 'Test fixture only.', ...over });
/** A Henry Hill formation with overrides. */
const hh = (id, over = {}) => ({ ...copy(HH.units.find((u) => u.id === id)), ...over });
/** A fictional phase on the Henry Hill ground with exactly these units. */
function game(api, units, extra = {}) {
  const s = copy(HH);
  s.id = 'test-cavalry'; s.title = 'Fictional cavalry test (test only)';
  s.units = units;
  Object.assign(s, extra);
  const p = api.prepare(s);
  setPlan(p);
  const g = new Game({ scene: new Scene(), terrain, scenario: p, world: { fenceField: null }, effects });
  Object.assign(g.ai, api.patch);
  g.initializeReinforcements();
  return g;
}
const unit = (g, id) => g.units.find((u) => u.id === id);
const run = (g, seconds, each) => { for (let k = Math.round(seconds / 0.05); k > 0; k--) { g.tick(0.05); if (each && each()) return true; } return false; };
const place = (u, x, z, facing) => { u.vehicle.position.set(x, 0, z); if (facing !== undefined) { u.facing = facing; u.goalFacing = facing; } u.snapFigures(); };
const FAR_CS = { x: 1500, z: 1500 };
const refuses = (api, s, label) => {
  let error = null;
  try { api.prepare(s); } catch (e) { error = e; }
  assert.ok(error && /^(Phase|Field):/.test(error.message), `validation: refuses ${label} (${error ? error.message : 'accepted'})`);
};
const scenarioWith = (units) => { const s = copy(HH); s.id = 'test-cavalry-validation'; s.units = units; return s; };

export const CAVALRY_CHECKS = [
  ['validation', async (api) => {
    for (const weapon of ['carbine', 'pistol']) assert.doesNotThrow(() => api.prepare(scenarioWith([horse('h1', 'US', { weapon }), hh('jackson')])), `validation: accepts cavalry with ${weapon}`);
    const bare = horse('h1', 'US'); delete bare.weapon;
    const g = game(api, [bare, hh('jackson', FAR_CS)]);
    assert.equal(unit(g, 'h1').weapon, 'carbine', 'validation: cavalry without a weapon carries carbines');
    refuses(api, scenarioWith([horse('h1', 'US', { weapon: 'smooth' }), hh('jackson')]), 'cavalry with smoothbores');
    refuses(api, scenarioWith([horse('h1', 'US', { weapon: 'parrott' }), hh('jackson')]), 'cavalry with a gun');
    refuses(api, scenarioWith([horse('h1', 'US', { guns: 2 }), hh('jackson')]), 'cavalry with guns');
    refuses(api, scenarioWith([horse('h1', 'US', { type: 'dragoons' }), hh('jackson')]), 'an unknown type');
    refuses(api, scenarioWith([hh('franklin', { weapon: 'carbine' }), hh('jackson')]), 'infantry with carbines');
    refuses(api, scenarioWith([horse('h1', 'US', { equipment: { uid: 'fixture-arm', itemId: 'm1842', tier: 'common', conditionId: 'serviceable', from: 'Fictional issue' } }), hh('jackson')]), 'cavalry with issued equipment');
    const p = game(api, [horse('p1', 'US', { weapon: 'pistol' }), hh('jackson', FAR_CS)]);
    assert.equal(unit(p, 'p1').toggleMount(), false, 'validation: a pistol regiment does not dismount');
    assert.equal(p.range(unit(p, 'p1')), 40, 'validation: revolvers reach 40 m');
  }],
  ['speed', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: -400, z: 0, facing: Math.PI / 2 }), hh('willcox', { x: -400, z: 200, facing: Math.PI / 2 }), hh('jackson', FAR_CS)]);
    const c = unit(g, 'h1'), w = unit(g, 'willcox');
    for (const u of [c, w]) u.orderMove([[u.x, u.z], [u.x + 180, u.z]]);
    const pace = (u, woods = false, charge = false) => {
      const order = u.order; if (charge) u.order = { ...order, type: 'charge' };
      u.inWoods = woods; u.move(0.05, -1960); u.order = order; return u.vehicle.maxSpeed;
    };
    assert.ok(near(pace(c) / pace(w), CAVALRY.speed, 1e-9), `speed: mounted cavalry marches ${CAVALRY.speed} times the infantry pace (${(pace(c) / pace(w)).toFixed(4)})`);
    assert.ok(near(pace(c, false, true) / pace(w, false, true), CAVALRY.speed, 1e-9), 'speed: and charges as much faster');
    assert.ok(near(pace(c, true) / pace(c), CAVALRY.woods, 1e-9) && near(pace(w, true) / pace(w), 0.7, 1e-9),
      `speed: woods slow horsemen to ${CAVALRY.woods} and infantry to 0.7 (${(pace(c, true) / pace(c)).toFixed(4)}, ${(pace(w, true) / pace(w)).toFixed(4)})`);
    // a long march with no enemy near: a column of fours; on foot: no column, the infantry pace
    const long = game(api, [horse('h1', 'US', { x: -800, z: 0, facing: Math.PI / 2 }), hh('jackson', FAR_CS)]), lc = unit(long, 'h1');
    lc.orderMove([[lc.x, lc.z], [lc.x + 900, lc.z]]);
    run(long, 3);
    const files = new Set(lc.figures.filter((f) => f.alive).map((f) => f.cfile));
    assert.ok(lc.formation === 'column' && files.size === 4, `speed: a long mounted march goes in a column of fours (${lc.formation}, ${files.size} files)`);
    const foot = game(api, [horse('h1', 'US', { x: -800, z: 0, facing: Math.PI / 2, }), hh('willcox', { x: -800, z: 300, facing: Math.PI / 2 }), hh('jackson', FAR_CS)]);
    const fc = unit(foot, 'h1'), fw = unit(foot, 'willcox');
    fc.toggleMount(); run(foot, CAVALRY.dismountS + 0.5);
    assert.equal(fc.mounted, false, 'speed: the fixture dismounted');
    for (const u of [fc, fw]) u.orderMove([[u.x, u.z], [u.x + 900, u.z]]);
    run(foot, 3);
    assert.ok(fc.formation === 'line' && near(pace(fc) / pace(fw), 1, 1e-9) || fc.formation === 'line' && fw.formation === 'column' && near(pace(fc) * 1.1 / pace(fw), 1, 1e-9),
      `speed: dismounted troopers keep their skirmish line at the infantry pace (${fc.formation}, ${(pace(fc) / pace(fw)).toFixed(4)})`);
  }],
  ['dismount-timing', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: -400, z: 0 }), hh('jackson', FAR_CS)]);
    const c = unit(g, 'h1'), n = c.figures.length, men = c.men, at = [c.x, c.z];
    assert.equal(c.toggleMount(), true, 'dismount-timing: the order is taken');
    assert.equal(c.toggleMount(), false, 'dismount-timing: a second toggle while switching is refused');
    run(g, CAVALRY.dismountS - 0.5);
    assert.ok(c.switching && c.mounted && c.afoot, `dismount-timing: still dismounting after ${CAVALRY.dismountS - 0.5} s (${JSON.stringify(c.switching)})`);
    run(g, 1);
    assert.ok(!c.switching && !c.mounted, `dismount-timing: on foot after ${CAVALRY.dismountS + 0.5} s (${JSON.stringify(c.switching)}, mounted ${c.mounted})`);
    const holders = c.figures.filter((f) => f.alive && f.holder), line = c.figures.filter((f) => f.alive && !f.holder);
    assert.ok(holders.length === Math.floor(n / CAVALRY.holderEvery) && holders.every((f) => f.lz === -CAVALRY.holdersBack) && line.every((f) => f.lz === 0),
      `dismount-timing: every fourth man holds the horses ${CAVALRY.holdersBack} m behind the line (${holders.length} of ${n})`);
    assert.ok(c.men === men && Math.hypot(c.x - at[0], c.z - at[1]) < 1e-9, `dismount-timing: no man is lost and the regiment stood (${c.men})`);
    assert.equal(c.toggleMount(), true, 'dismount-timing: remount taken');
    run(g, CAVALRY.remountS - 0.5);
    assert.ok(c.switching && !c.mounted, `dismount-timing: still remounting after ${CAVALRY.remountS - 0.5} s`);
    run(g, 1);
    assert.ok(!c.switching && c.mounted && !c.afoot, `dismount-timing: in the saddle after ${CAVALRY.remountS + 0.5} s`);
  }],
  ['switching-vulnerable', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: 0, z: 0, facing: Math.PI / 2 }), hh('jackson', { x: 220, z: 0, facing: -Math.PI / 2, morale: 100 })]);
    const c = unit(g, 'h1'), j = unit(g, 'jackson');
    g.combat.coverAt = () => ({ value: 1.4, kind: 'woods' });
    j.holdFire = true;
    run(g, 1);
    assert.equal(c.cover, 1.4, 'switching-vulnerable: the fixture stands in woods');
    c.toggleMount();
    const shots = c.shots || 0;
    run(g, 1);
    run(g, CAVALRY.dismountS - 2, () => c.cover !== 1 || (c.shots || 0) !== shots);
    assert.ok(c.switching && c.cover === 1 && (c.shots || 0) === shots && c.target === j,
      `switching-vulnerable: while dismounting it has no cover and does not fire at the enemy in range (cover ${c.cover}, ${(c.shots || 0) - shots} shots)`);
    run(g, 4);
    assert.ok(!c.switching && c.cover === 1.4 && (c.shots || 0) > shots, `switching-vulnerable: on foot it takes cover and fires (${c.cover}, ${(c.shots || 0) - shots} shots)`);
  }],
  ['fire', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: 0, z: 0, facing: Math.PI / 2 }), hh('willcox', { x: 0, z: 0, facing: Math.PI / 2 }), hh('jackson', { x: 1, z: 0, facing: -Math.PI / 2, men: 9000, morale: 100 })]);
    const c = unit(g, 'h1'), w = unit(g, 'willcox'), j = unit(g, 'jackson');
    assert.equal(g.range(c), CAV.mountedRange.carbine, 'fire: carbines from the saddle reach 150 m');
    g.combat.rnd = () => 0.5;
    const perManSecond = (u) => { const before = j.men; g.combat.volleyAt(u, j, 0); const cas = before - j.men; j.men = before; return cas / u.men / g.combat.basePeriod(u); };
    const mounted = perManSecond(c), inf = perManSecond(w);
    c.mounted = false;
    assert.equal(g.range(c), CAV.dismountedRange, 'fire: on foot the carbines reach 300 m');
    const dismounted = perManSecond(c);
    c.mounted = true;
    assert.ok(near(mounted / inf, CAV.mountedMen, 0.01), `fire: mounted fire is ${CAV.mountedMen} of infantry per man (${(mounted / inf).toFixed(3)})`);
    assert.ok(near(dismounted / inf, CAV.dismountedMen * CAV.dismountedRate, 0.02),
      `fire: on foot ${CAV.dismountedMen} of the men fire ${CAV.dismountedRate} times as fast (${(dismounted / inf).toFixed(3)})`);
  }],
  ['charge', async (api) => {
    const melee = (target) => {
      const g = game(api, [horse('h1', 'US', { x: 0, z: 0, facing: Math.PI / 2, xp: 2 }), target]);
      const c = unit(g, 'h1'), t = unit(g, target.id);
      t.holdFire = true;
      assert.ok(g.order(c, { type: 'charge', points: [[c.x, c.z], [t.x, t.z]], target: t }), 'charge: the charge is ordered');
      let start = null;
      run(g, 40, () => { if (!start && c.melee) start = { c: c.men, t: t.men }; return start && !c.melee; });
      assert.ok(start, `charge: the horsemen reach ${t.id}`);
      return { cav: start.c - c.men, foe: start.t - t.men, foeMen: t.menMax };
    };
    const steady = melee(hh('jackson', { x: 160, z: 0, facing: -Math.PI / 2, men: 1200, morale: 80 }));
    assert.ok(steady.cav > 5 * steady.foe, `charge: horsemen charging a steady line head-on lose far more than it (${steady.cav.toFixed(1)} against ${steady.foe.toFixed(1)})`);
    const wavering = melee(hh('jackson', { x: 160, z: 0, facing: -Math.PI / 2, men: 1200, morale: 30 }));
    assert.ok(wavering.foe > 2 * wavering.cav && wavering.foe > 3 * steady.foe,
      `charge: a wavering line breaks under them (${wavering.foe.toFixed(1)} lost against ${wavering.cav.toFixed(1)}; steady ${steady.foe.toFixed(1)})`);
    const guns = melee(hh('rockbridge', { x: 160, z: 0, facing: Math.PI / 2 })); // the battery faces away: taken from behind
    assert.ok(guns.foe > 3 * guns.cav, `charge: a battery whose guns are not on them is overrun (${guns.foe.toFixed(1)} against ${guns.cav.toFixed(1)})`);
  }],
  ['ride-down-losses', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: 0, z: -120, facing: 0 }), hh('bee', { x: 0, z: 0, facing: Math.PI })]);
    const c = unit(g, 'h1'), b = unit(g, 'bee');
    g.combat.rout(b, true);
    assert.ok(g.order(c, { type: 'attack', target: b }) && c.order.type === 'charge' && c.order.target === b,
      `ride-down-losses: an attack order on a routing enemy is a mounted charge (${c.order.type})`);
    run(g, 25);
    const lost = b.menMax - b.men, own = c.menMax - c.men;
    assert.ok(lost >= 0.1 * b.menMax && own < lost / 5, `ride-down-losses: the fugitives are ridden down (${lost.toFixed(0)} of ${b.menMax} lost; riders ${own.toFixed(1)})`);
    assert.ok(b.state === 'routing' && b.state !== 'captured', 'ride-down-losses: without surrender rules nobody is taken');
  }],
  ['ride-down-surrender', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: 0, z: -220, facing: 0 }), hh('bee', { x: 0, z: 0, facing: Math.PI }), hh('willcox', { x: -1500, z: -1500 }), hh('jackson', { x: 1500, z: 1500 })], { surrender: true });
    const c = unit(g, 'h1'), b = unit(g, 'bee');
    g.combat.rout(b, true);
    g.order(c, { type: 'charge', points: [[c.x, c.z], [b.x, b.z]], target: b });
    let contact = null, taken = null;
    run(g, 40, () => { if (contact === null && b.men < b.menMax) contact = g.simTime; if (b.state === 'captured') { taken = g.simTime; return true; } return false; });
    const cap = g.captureSnapshot().captures.find((r) => r.unitId === 'bee');
    assert.ok(contact !== null && taken !== null && taken - contact <= 4.5 && cap?.captorSide === 'US' && cap.men > 0,
      `ride-down-surrender: a unit ridden down surrenders to the horsemen within 4.5 s (contact ${contact}, taken ${taken}, ${JSON.stringify(cap ?? null)})`);
  }],
  ['pursue-ai', async (api) => {
    const fixture = (extra = [], role = 'hold') => {
      const g = game(api, [hh('willcox', { x: 0, z: 0, facing: Math.PI }), horse('c1', 'CS', { x: 0, z: 250, facing: Math.PI, ai: { role, ...(role === 'reserve' ? { at: '15:30' } : {}) } }), ...extra]);
      const w = unit(g, 'willcox'), c = unit(g, 'c1');
      g.combat.rout(w, true);
      run(g, 1.5);
      return { g, w, c };
    };
    const free = fixture();
    assert.ok(free.c.order.type === 'charge' && free.c.order.target === free.w, `pursue-ai: AI horsemen ride down a lone fugitive (${free.c.order.type})`);
    const covered = fixture([hh('franklin', { x: 120, z: -60, facing: Math.PI })]);
    assert.ok(covered.c.order.type !== 'charge', `pursue-ai: not while a fresh enemy stands within 200 m of it (${covered.c.order.type})`);
    const reserve = fixture([], 'reserve');
    assert.ok(reserve.c.order.type === 'charge' && reserve.g.ai.memo.get(reserve.c)?.active === true, 'pursue-ai: a reserve commits to the pursuit');
  }],
  ['screen', async (api) => {
    const g = game(api, [hh('franklin', { x: 0, z: 0, facing: Math.PI / 2 }), horse('c1', 'CS', { x: 0, z: 240, facing: Math.PI }), hh('jackson', FAR_CS)]);
    const f = unit(g, 'franklin'), c = unit(g, 'c1');
    f.orderMove([[f.x, f.z], [f.x + 180, f.z]]);
    const pace = () => { f.move(0.05, -1960); return f.vehicle.maxSpeed; };
    const free = pace();
    g.combat.screenStep();
    assert.ok(SCREENED.has(f) && near(pace() / free, CAVALRY.screenSlow, 1e-9), `screen: infantry within 250 m of enemy horsemen marches ${CAVALRY.screenSlow} as fast (${(pace() / free).toFixed(3)})`);
    place(c, 0, 300);
    g.combat.screenStep();
    assert.ok(!SCREENED.has(f) && near(pace(), free, 1e-9), 'screen: not beyond 250 m');
    place(c, 0, 240); g.combat.rout(c, true); g.combat.screenStep();
    assert.ok(!SCREENED.has(f), 'screen: routing horsemen screen nothing');
  }],
  ['ai-flank', async (api) => {
    const g = game(api, [hh('franklin', { x: 0, z: 0, facing: 0 }), horse('c1', 'CS', { x: 600, z: 600, facing: Math.PI, ai: { role: 'attack' } })]);
    const f = unit(g, 'franklin'), c = unit(g, 'c1');
    f.holdFire = true; c.holdFire = true;
    const flank = [f.x + f.halfFront + 90, f.z - 30];
    let at = null, rode = false;
    run(g, 120, () => {
      if (c.order.type === 'move' && c.order.dest && Math.hypot(c.order.dest[0] - flank[0], c.order.dest[1] - flank[1]) < 5) rode = true;
      if (c.order.type === 'charge') { at = { x: c.x, z: c.z, rode, arc: g.combat.arcMult(c, f), beyond: Math.abs(c.x - f.x) - f.halfFront, target: c.order.target?.id }; return true; }
      return false;
    });
    assert.ok(at && at.target === 'franklin' && at.rode && at.beyond > 40 && at.arc > 1,
      `ai-flank: attacking horsemen ride round to the end of the line and charge its flank (${JSON.stringify(at)}, flank point ${flank.map((v) => v.toFixed(0))})`);
  }],
  ['drawing', async (api) => {
    const g = game(api, [horse('h1', 'US', { x: 0, z: 0 }), hh('jackson', FAR_CS)]);
    const c = unit(g, 'h1');
    g.animate(0.05);
    const n = c.figures.filter((f) => f.alive).length;
    assert.ok(g.mountsDrawn() === n && g.pools.US.pushed === n && g.scene.getObjectByName('cavalry-horses'),
      `drawing: one horse and one rider per mounted figure (${g.mountsDrawn()} horses, ${g.pools.US.pushed} riders, ${n} figures)`);
    c.toggleMount(); run(g, CAVALRY.dismountS + 0.5); g.animate(0.05);
    const holders = c.figures.filter((f) => f.alive && f.holder).length;
    assert.ok(g.mountsDrawn() === holders * (1 + CAVALRY.ledHorses) && c.figures.filter((f) => f.alive && f.clip === 'ride').length === holders,
      `drawing: on foot only the holders ride, each leading three horses (${g.mountsDrawn()} horses, ${holders} holders)`);
    const plain = game(api, [hh('franklin'), hh('jackson')]);
    plain.animate(0.05);
    assert.ok(!plain.scene.getObjectByName('cavalry-horses') && plain.mountsDrawn() === 0, 'drawing: a field without cavalry makes no horse pool');
  }],
  ['oracles-unchanged', async () => {
    const mask = RULES.friendlyMask;
    try {
      assert.deepEqual(henryHillRun(), ORACLE, 'oracles-unchanged: Henry Hill matches the test-packs oracle');
      RULES.friendlyMask = false; // the places were observed before the friendly-fire mask (as tools/test-ai.mjs compares them)
      const s = copy(HH); s.end = '14:01';
      setPlan(s);
      const g = new Game({ scene: new Scene(), terrain, scenario: s, world: { fenceField: null }, effects });
      g.fastForward(16);
      const places = g.units.map((u) => [u.id, +u.x.toFixed(3), +u.z.toFixed(3), +u.facing.toFixed(4), u.order.type, !!u.order.firm, u.follow.active]);
      assert.deepEqual(places, PLACES, 'oracles-unchanged: every formation stands, faces and holds as on the parent');
    } finally { RULES.friendlyMask = mask; }
  }],
];

/** Swap a prototype member for the length of one check; returns the restore. */
const swap = (proto, key, value) => () => {
  const d = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { ...d, ...(d.get ? { get: value } : { value }) });
  return () => Object.defineProperty(proto, key, d);
};
const downgrade = (s) => { const t = copy(s); for (const u of t.units) if (u.type === 'cavalry') { u.type = 'infantry'; if (u.weapon) u.weapon = 'rifled'; delete u.guns; delete u.equipment; } return t; };

// One semantic mutant per check: each must fail that check's own assertion.
const MUTANTS = {
  'validation': { prepare: (s) => prepareFieldScenario(downgrade(s), 'pack') }, // cavalry is read as infantry
  'speed': { proto: () => { // horsemen march at the infantry pace
    const move = Unit.prototype.move;
    Unit.prototype.move = function (...a) { const m = this.mounted; if (this.type === 'cavalry') this.mounted = false; try { return move.apply(this, a); } finally { if (this.type === 'cavalry') this.mounted = m; } };
    return () => { Unit.prototype.move = move; };
  } },
  'dismount-timing': { proto: swap(Unit.prototype, 'toggleMount', function () { // switches at once
    if (this.type !== 'cavalry' || !this.canTakeOrders()) return false;
    this.mounted = !this.mounted; this.switching = null; this.layout(); return true;
  }) },
  'switching-vulnerable': { proto: () => { // combat ignores a regiment that is switching
    const step = Combat.prototype.step;
    Combat.prototype.step = function (...a) { const saved = this.units.map((u) => u.switching); for (const u of this.units) if (u.switching) u.switching = null; try { return step.apply(this, a); } finally { this.units.forEach((u, k) => { if (saved[k]) u.switching = saved[k]; }); } };
    return () => { Combat.prototype.step = step; };
  } },
  'fire': { proto: swap(Unit.prototype, 'afoot', function () { return false; }) }, // on foot fights as mounted
  'charge': { proto: swap(Combat.prototype, 'cavalryShock', () => 1) }, // a mounted charge has no shock either way
  'ride-down-losses': { proto: swap(Combat.prototype, 'rideDown', () => {}) }, // horsemen pass fugitives by
  'ride-down-surrender': { proto: swap(Combat.prototype, 'rideDown', function (a, b, dt, time) { // losses, but no surrender accounting
    const bCas = Math.min(b.men, b.menMax * CAV.rideDown.cap * dt, CAV.rideDown.rate * dt);
    b.takeLosses(bCas, this.fallen[b.side], time);
  }) },
  'pursue-ai': { patch: { fugitive: () => null } }, // the AI never pursues
  'screen': { proto: swap(Combat.prototype, 'screenStep', () => {}) }, // horsemen screen nothing
  'ai-flank': { patch: { flankAttack: () => false } }, // attacking horsemen march on the objective like infantry
  'drawing': { proto: swap(Unit.prototype, 'animateRider', () => {}) }, // riders and horses are not drawn
  'oracles-unchanged': { proto: swap(Combat.prototype, 'basePeriod', (u) => (u.type === 'artillery' ? 7.5 : 5 / CAV.dismountedRate)) }, // every musket reloads like a carbine
};

export async function cavalryUnit(api = API) {
  for (const [, check] of CAVALRY_CHECKS) await check(api);
  return CAVALRY_CHECKS.length;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const list = only ? CAVALRY_CHECKS.filter(([n]) => n === only) : CAVALRY_CHECKS;
  for (const [name, check] of list) { await check(API); if (only) console.log(`ok ${name}`); }
  const count = list.length;
  console.log(`CAVALRY OK (${count}/${count})`);
  if (process.argv.includes('--prove-fail')) {
    const rows = [];
    for (const [name, check] of list) {
      const m = MUTANTS[name];
      const restore = m.proto ? m.proto() : null;
      let error;
      try { await check({ ...API, ...m }); } catch (e) { error = e; } finally { restore?.(); }
      assert.equal(error?.code, 'ERR_ASSERTION', `${name} must reject its own mutant through an assertion (got ${error?.message ?? 'no failure'})`);
      assert.ok(error.message.startsWith(name), `${name} mutant failed another check's text: ${error.message}`);
      console.log(`CAUGHT ${name}: ${error.message.split('\n')[0]}`);
      rows.push(name);
    }
    assert.equal(rows.length, count);
    console.log(`CAVALRY CONTROLS OK (${rows.length}/${count})`);
  }
}

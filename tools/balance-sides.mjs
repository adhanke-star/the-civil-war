// Diagnostic (v5 LEG D): how every shipped battle-pack phase plays out from each side. Each phase of the three packs is
// prepared as the Battles route prepares it (preparePhase, the 'pack' route, sideScenario for the side) and run headless on
// its real terrain twice, the player commanding the Union and then the Confederates, against the computer at Veteran, to
// the phase's end. The player's side follows one simple scripted doctrine so the runs compare the scenarios, not a player:
//   - defending: every formation holds where it is deployed (Hold); a reinforcement marches on the objective on arrival;
//   - attacking: every formation (reinforcements on arrival) marches on the objective, keeping its place in the line
//     (its offset from its side's centre, squeezed inside the objective's circle); the march halts to fire and resumes
//     (the player's line, combat.js), and a formation stopped short is sent on again every 10 battle seconds.
// Table: phase, side, result grade (from the player's side, packResult), own and enemy losses (% of the men each side
// brought to the field, reinforcements included once they arrive; a formation taken off the field counts as lost),
// the objective's holder at the end, and battle-clock minutes to first contact (the first man lost on either side).
// It measures; it never tunes and never judges: outcomes never fail the run, only an exception does (exit 1).
// Bounded for CI: each run stops at its phase end or CAP_S simulated seconds, whichever is first (a capped run is
// forced to its result there and flagged); past BUDGET_MS of wall time the remaining runs are capped at 60 s.
// `node tools/balance-sides.mjs` prints the table and "BALANCE SIDES OK (n/n)", and writes .out/balance-sides.json and
// .out/balance-sides.md. `node tools/test.mjs --balance-sides` runs it (also in CI shard 4, uploaded as an artifact).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Scene } from 'three';
import { Game } from '../src/game.js';
import { setPlan } from '../src/world/landscape.js';
import { TerrainData, EXAGGERATION } from '../src/world/terrain.js';
import { RULES } from '../src/sim/rules.js';
import { CLOCK_RATIO } from '../src/sim/combat.js';
import { LOOK } from '../src/ui/look.js';
import * as settings from '../src/settings.js';
import { preparePhase, prepareFieldScenario } from '../src/sim/phase.js';
import { sideScenario, sideName } from '../src/sim/sides.js';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('.out/', ROOT);
RULES.autoPause = false; RULES.battleSpeed = 1; // as tools/test-sides.mjs: no alert pauses the fast-forward
settings.set('look.menPerFigure', 10); settings.set('look.formationSpacing', 1); LOOK.figureStyle = 'rigged';

const PACKS = ['shiloh', 'stones-river', 'chattanooga'];
const H = 0.05; // the Game's own fixed sub-step (Game.fastForward)
const CAP_S = 1500; // simulated seconds; every shipped phase ends sooner (the longest is 6.5 h at 22:1 = 1064 s)
const BUDGET_MS = 9 * 60_000; // the contract's 10-minute CI bound, less a minute of margin
const REORDER_S = 10;
const CONTACT_EVERY = 10; // ticks between casualty scans (0.5 s)

const readText = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const terrains = new Map();
function terrainOf(name) {
  if (terrains.has(name)) return terrains.get(name);
  const meta = JSON.parse(readText(`assets/terrain/${name}.json`));
  const raw = zlib.gunzipSync(fs.readFileSync(new URL(`assets/terrain/${meta.heights.file}`, ROOT)));
  const q = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), G = meta.grid;
  const heights = new Float32Array(G * G), k = meta.heights.stepM * EXAGGERATION;
  for (let y = 0; y < G; y++) { let acc = 0; for (let x = 0; x < G; x++) { acc += q[y * G + x]; heights[y * G + x] = acc * k; } }
  const t = new TerrainData(meta, heights);
  terrains.set(name, t);
  return t;
}
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** One phase, one player side, to the end (or the cap). Returns the table row. */
function runPhase(packId, phaseId, base, playerSide, capS) {
  const scenario = { ...sideScenario(base, playerSide), difficulty: 'veteran' };
  setPlan(scenario);
  const game = new Game({ scene: new Scene(), terrain: terrainOf(scenario.terrain), scenario, world: { fenceField: null }, effects: { volley() {}, boom() {} }, playerSide });
  game.initializeReinforcements();
  const ratio = scenario.clockRatio ?? CLOCK_RATIO, phaseS = (clock(scenario.end) - clock(scenario.start)) * 60 / ratio;
  const role = scenario.attacker === playerSide ? 'attack' : 'defend', o = game.objective;
  const first = new Map(); // unit -> men when it took the field (losses are this battle's, not carried from earlier phases)
  const dest = new Map(); // player formation -> the point on the objective it was sent to
  const known = new Set(); // player formations the doctrine has seen (a new one is a reinforcement on arrival)
  let contactS = null;
  const own = () => game.units.filter((u) => u.side === playerSide);
  /** Where `u` marches on the objective: its offset from its side's centre, squeezed inside 60% of the circle. */
  const spot = (u) => {
    const mine = own().filter((v) => v.alive), cx = mine.reduce((n, v) => n + v.x, 0) / mine.length, cz = mine.reduce((n, v) => n + v.z, 0) / mine.length;
    const spread = Math.max(1, ...mine.map((v) => Math.hypot(v.x - cx, v.z - cz))), k = Math.min(1, (0.6 * o.r) / spread);
    return [o.x + (u.x - cx) * k, o.z + (u.z - cz) * k];
  };
  const march = (u) => {
    const d = dest.get(u) ?? spot(u);
    dest.set(u, d);
    if (Math.hypot(u.x - d[0], u.z - d[1]) < 30 || !u.canTakeOrders()) return;
    if (u.order.type === 'move' && u.order.dest && Math.hypot(u.order.dest[0] - d[0], u.order.dest[1] - d[1]) < 1) return;
    if (['charge', 'attack', 'fallback'].includes(u.order.type)) return; // its own close fight (initiative) runs its course
    game.order(u, { type: 'move', points: [[u.x, u.z], d] });
  };
  const doctrine = (opening) => {
    for (const u of own()) {
      if (!u.alive) continue;
      const fresh = !known.has(u);
      known.add(u);
      if (role === 'defend') { if (opening) u.orderHold(); else if (fresh || dest.has(u)) march(u); }
      else march(u);
    }
  };
  const seen = () => { for (const u of game.units) if (!first.has(u)) first.set(u, u.men); };
  seen(); doctrine(true);
  let ticks = 0, nextOrder = REORDER_S;
  while (!game.over && game.simTime < capS) {
    game.paused = false;
    game.tick(H);
    if (++ticks % CONTACT_EVERY === 0) {
      if (contactS === null && game.units.some((u) => first.has(u) && u.men < first.get(u))) contactS = game.simTime;
      seen();
    }
    if (game.simTime >= nextOrder) { nextOrder += REORDER_S; doctrine(false); seen(); }
  }
  const capped = !game.over;
  if (capped) game.checkObjective(0, true); // the result as it stands at the cap
  const enemy = playerSide === 'US' ? 'CS' : 'US', loss = { US: [0, 0], CS: [0, 0] };
  for (const [u, men] of first) { loss[u.side][0] += men; loss[u.side][1] += men - (game.units.includes(u) ? Math.max(0, u.men) : 0); }
  const pct = (s) => (loss[s][0] ? +(100 * loss[s][1] / loss[s][0]).toFixed(1) : 0);
  const minutes = (s) => +(s * ratio / 60).toFixed(1);
  const r = game.result || {};
  return { pack: packId, phase: phaseId, side: playerSide, role, grade: r.grade ?? (r.draw ? 'draw' : 'none'), winner: r.winner ?? null, why: r.why ?? null,
    ownLossPct: pct(playerSide), enemyLossPct: pct(enemy), ownMen: loss[playerSide][0], enemyMen: loss[enemy][0], holder: game.holder ?? 'none',
    contactMin: contactS === null ? null : minutes(contactS), endMin: minutes(game.simTime), phaseMin: minutes(phaseS), simS: +game.simTime.toFixed(1), capped };
}

function markdown(report) {
  const head = '| Phase | Side | Role | Result | Own losses % | Enemy losses % | Objective holder | First contact (min) | Ended (min) |';
  const rows = report.rows.map((r) => `| ${r.pack} / ${r.phase} | ${sideName(r.side)} | ${r.role} | ${r.error ? 'ERROR' : r.grade}${r.capped ? ' (capped)' : ''} | ${r.ownLossPct ?? '-'} | ${r.enemyLossPct ?? '-'} | ${r.holder ?? '-'} | ${r.contactMin ?? 'none'} | ${r.endMin ?? '-'} of ${r.phaseMin ?? '-'} |`);
  return [`# Sides balance (${report.generatedAt})`, '', `Computer: ${report.difficulty}. Player doctrine: ${report.doctrine}`, '',
    head, '|---|---|---|---|---|---|---|---|---|', ...rows, '', `${report.rows.length} runs in ${(report.durationMs / 1000).toFixed(0)} s; ${report.errors} error(s). Diagnostic only: outcomes never fail the run.`, ''].join('\n');
}

const started = Date.now();
const report = { generatedAt: new Date(started).toISOString(), difficulty: 'veteran',
  doctrine: 'defending, hold where deployed (reinforcements march on the objective); attacking, every formation marches on the objective.',
  capS: CAP_S, rows: [], errors: 0, durationMs: 0 };
for (const packId of PACKS) {
  const pack = JSON.parse(readText(`assets/packs/${packId}.json`));
  for (const p of pack.phases) {
    for (const side of ['US', 'CS']) {
      const cap = Date.now() - started > BUDGET_MS ? 60 : CAP_S;
      let row;
      try { row = runPhase(packId, p.id, prepareFieldScenario(preparePhase(pack, p.id).scenario, 'pack'), side, cap); }
      catch (e) { report.errors++; row = { pack: packId, phase: p.id, side, error: String(e?.stack || e) }; console.error(`balance-sides: ${packId}/${p.id} ${side}: ${e?.stack || e}`); }
      report.rows.push(row);
      console.log(row.error ? `err  ${packId}/${p.id} ${side}` : `ran  ${packId}/${p.id} ${side} ${row.role}: ${row.grade}${row.capped ? ' (capped)' : ''}, own ${row.ownLossPct}% enemy ${row.enemyLossPct}%, holder ${row.holder}, contact ${row.contactMin ?? 'none'} min (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
  }
}
report.durationMs = Date.now() - started;
const md = markdown(report);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(new URL('balance-sides.json', OUT), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(new URL('balance-sides.md', OUT), md);
console.log('\n' + md);
const ok = report.rows.length - report.errors;
console.log(report.errors ? `BALANCE SIDES FAILED (${report.errors} run(s) threw)` : `BALANCE SIDES OK (${ok}/${report.rows.length})`);
process.exit(report.errors ? 1 : 0);

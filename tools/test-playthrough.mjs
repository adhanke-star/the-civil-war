// tools/test-playthrough.mjs: the agent playthrough (PLAN P4 evidence, P7). One fresh player plays the whole shipped
// campaign through the real UI, with a deliberate defeat, its marked replay, a reload, and an export/import.
//
//   node tools/test-playthrough.mjs [--ff-budget=<s>] [--deadline=<min>] [--defeat=<index>] [--quality=low|auto]
//
// Flow (real clicks and keys wherever a player would use them; page.evaluate only reads state, fast-forwards simulated
// time with game.fastForward as tools/test-packs-ui.mjs does, and gives field orders through the game API the HUD calls):
//  1. Fresh profile: title -> New campaign -> slot picker -> slot 1 -> camp.
//  2. Every ladder phase of assets/campaign.json in order: camp (position and Next text) -> one camp order changed by its
//     select -> Next -> each decision card answered (options alternate) with its reveal -> march -> the field loads on its
//     own terrain with the Briefing -> Begin (Enter) -> fought to its end by fast-forward (Union-attacker phases send every
//     brigade at the enemy-held objective; the --defeat phase attacks, then every brigade falls back by the F key) ->
//     result -> after-action pages a (grade, you vs history, points) -> h (what really happened) -> r (replay plays) ->
//     b (loot dealt, turned with S) -> one card equipped by keyboard in the issue step -> Done -> Continue -> "Campaign
//     saved" -> Return to camp. The defeat must advance the ladder and carry its losses; "Replay this phase" from camp
//     plays it again and the record marks it replayed.
//  3. After phase 2's camp: reload the page, title Continue returns to the same camp (byte-identical save); Export army
//     downloads the save and Import army in a fresh context restores an identical camp.
//  4. The last phase ends on "Campaign ending" (grade, medals) and its Record book lists every phase with a grade.
// Checks throughout: no page error, console error or failed request (navigation aborts excepted, as in the UI tests);
// every grade recorded; reputation never falls and RP never falls across a recorded phase; award ids and item uids
// unique; stores never negative. Per-phase wall time is printed. Screenshots and result.json go to .out/playthrough/.
// Prints PLAYTHROUGH OK (n/n) or PLAYTHROUGH FAILED (passed/n) and exits non-zero on failure. Runs on CI (job
// "playthrough"); the Mac never launches a browser.

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import playwright from 'playwright';
import { startServer, ROOT } from './serve.mjs';

const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split('=')[1];
const FF_BUDGET_MS = Number(arg('ff-budget', 180)) * 1000; // wall time one phase may spend fast-forwarding
const DEADLINE_MS = Number(arg('deadline', 70)) * 60_000; // the whole run (CI job timeout sits above it)
const DEFEAT_AT = Number(arg('defeat', 3)); // ladder index fought to a deliberate defeat (default: Buell attacks, not a loan phase)
const QUALITY = arg('quality', 'low');
const OUT = path.join(ROOT, '.out', 'playthrough');
await fs.mkdir(OUT, { recursive: true });

const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const CAMPAIGN = read('assets/campaign.json');
const GRADES = ['Decisive', 'Victory', 'Draw', 'Defeat'];
const PACKS = {};
const hm = (t) => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };
const packOrder = [...new Set(CAMPAIGN.phases.map((p) => p.packId))];
const LADDER = CAMPAIGN.phases.map((p, index) => {
  PACKS[p.packId] ??= read(`assets/packs/${p.packId}.json`);
  const s = PACKS[p.packId].phases.find((x) => x.id === p.phaseId).scenario;
  const inPack = CAMPAIGN.phases.filter((x) => x.packId === p.packId);
  return { index, packId: p.packId, phaseId: p.phaseId, loan: p.loan === true, title: s.title, attacker: s.attacker,
    simLength: (hm(s.end) - hm(s.start)) / (s.clockRatio ?? 1), terrainName: read(`assets/terrain/${s.terrain}.json`).name,
    position: `Battle ${packOrder.indexOf(p.packId) + 1} of ${packOrder.length} · Phase ${inPack.findIndex((x) => x.phaseId === p.phaseId) + 1} of ${inPack.length}` };
});
if (!(DEFEAT_AT >= 0 && DEFEAT_AT < LADDER.length - 1 && !LADDER[DEFEAT_AT].loan)) throw new Error(`--defeat=${DEFEAT_AT} must be a non-loan phase before the last`);

// ---- reporting -----------------------------------------------------------------------------------------------------
const results = [], phases = [], t0 = Date.now();
let step = 'start', lastShot = null;
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${detail}`); };
const secs = (ms) => Math.round(ms / 100) / 10;
const IGNORED = /GL Driver Message|GPU stall|WebGL warning|texImage|AudioContext/i;
const ABORT = /ERR_ABORTED|NS_BINDING_ABORTED/;
function watch(page, url, into) {
  page.on('pageerror', (err) => into.push(`[${step}] pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED.test(msg.text())) into.push(`[${step}] console.error: ${msg.text()}`); });
  page.on('requestfailed', (req) => { if (req.url().startsWith(url)) into.push(`[${step}] request failed: ${req.url().replace(url, '/')} (${req.failure()?.errorText ?? '?'})`); });
  page.on('response', (res) => { if (res.status() >= 400) into.push(`[${step}] HTTP ${res.status()} for ${res.url().replace(url, '/')}`); });
}
const real = (errors) => errors.filter((e) => !ABORT.test(e));
async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  try { await page.screenshot({ path: file }); lastShot = file; } catch (e) { console.log(`(screenshot ${name} failed: ${e.message.split('\n')[0]})`); }
  return file;
}
/** What the player sees in any open dialog or overlay, for failure messages. */
const visible = (page) => page.evaluate(() => {
  const squash = (n) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const open = [...document.querySelectorAll('dialog[open], .rw, .rw-cmp')].map((n) => `${n.id || n.className.split(' ')[0]}: ${squash(n)}`);
  const status = ['camp-march-status', 'entry-status', 'camp-orders-status', 'status'].map((id) => document.getElementById(id)).filter((n) => n?.textContent)
    .map((n) => `#${n.id}: ${squash(n)}`);
  return `url ${location.search || '/'} | ${[...open, ...status].join(' | ') || '(no dialog open)'}`;
}).catch((e) => `(page unreadable: ${e.message.split('\n')[0]})`);
async function waitFn(page, what, fn, argument, timeout) {
  try { await page.waitForFunction(fn, argument, { timeout, polling: 250 }); }
  catch (e) { throw new Error(`timed out (${secs(timeout)} s) waiting for ${what}: ${e.message.split('\n')[0]}`); }
}

// ---- state reads (page.evaluate only to read) ----------------------------------------------------------------------
const slotRaw = (page) => page.evaluate(async () => (await import('./src/franchise/save.js')).createProgressStore(undefined, { slot: 1 }).readRawBaseline());
const slotSave = async (page) => { const raw = await slotRaw(page); return raw === null ? null : JSON.parse(raw); };
const menById = (save) => Object.fromEntries(save.army.map((b) => [b.id, b.men]));
const sumMen = (save, ids) => save.army.filter((b) => ids.includes(b.id)).reduce((n, b) => n + b.men, 0);
const campUi = (page) => page.evaluate(() => {
  const t = (id) => document.getElementById(id)?.textContent ?? null;
  return { position: t('camp-campaign-position'), next: document.getElementById('camp-next')?.hidden ? null : t('camp-next'),
    replay: document.getElementById('camp-replay')?.hidden ? null : t('camp-replay'), reputation: t('camp-reputation'), capacity: t('camp-capacity'),
    record: [...document.querySelectorAll('#camp-record li')].map((li) => li.textContent), army: document.querySelectorAll('#camp-army [data-brigade-id]').length,
    depot: document.querySelectorAll('#camp-depot [data-item-uid]').length, complete: document.getElementById('camp-complete')?.hidden ? null : t('camp-complete') };
});
const campReady = (page) => waitFn(page, 'the camp (window.__entry.mode camp, idle, decision deck loaded)',
  () => window.__entry?.mode === 'camp' && !window.__entry.importing && window.__entry.decks, null, 60_000);

// Invariants over every save observed: stores never negative, reputation never falls, award ids and item uids unique.
let seenReputation = -Infinity;
function observe(save, where) {
  const bad = [];
  for (const [k, v] of Object.entries(save.stores || {})) if (!(Number.isFinite(v) && v >= 0)) bad.push(`store ${k}=${v}`);
  const reputation = save.reputation ?? 0;
  if (!(reputation >= seenReputation)) bad.push(`reputation fell ${seenReputation} -> ${reputation}`);
  seenReputation = Math.max(seenReputation, reputation);
  const awards = save.campaign.history.map((r) => r.awardId), paid = (save.ledger || []).filter((r) => r.kind === 'phase').map((r) => r.awardId);
  if (new Set(awards).size !== awards.length) bad.push(`duplicate history award ids ${awards.join(',')}`);
  if (new Set(paid).size !== paid.length) bad.push(`duplicate paid award ids ${paid.join(',')}`);
  const uids = [...save.army.map((b) => b.weapon?.uid), ...save.depot.map((it) => it.uid)].filter(Boolean);
  if (new Set(uids).size !== uids.length) bad.push('duplicate item uids across army and depot');
  if (!((save.rp ?? 0) >= 0)) bad.push(`negative rp ${save.rp}`);
  check(`invariants-${where}`, !bad.length, bad.length ? bad.join('; ') : `stores ${JSON.stringify(save.stores || {})}; reputation ${save.reputation}; rp ${save.rp}; ${awards.length} awards unique`);
}

// ---- the field -----------------------------------------------------------------------------------------------------
/** Every orderable Union brigade marches at the objective (the HUD's drag order: march and fight on the way). */
const attackOrder = (page) => page.evaluate(() => {
  const { game } = window.__game, o = game.objective;
  const idle = game.units.filter((u) => u.alive && u.side === 'US' && game.controls(u) && u.canTakeOrders() && !u.follow?.active
    && Math.hypot(u.x - o.x, u.z - o.z) > o.r * 0.8);
  if (!idle.length) return { ordered: 0, of: 0 };
  game.selectMany(idle);
  const cx = idle.reduce((n, u) => n + u.x, 0) / idle.length, cz = idle.reduce((n, u) => n + u.z, 0) / idle.length;
  const spread = Math.max(1, ...idle.map((u) => Math.hypot(u.x - cx, u.z - cz))), k = Math.min(1, (o.r * 0.6) / spread);
  let ordered = 0;
  for (const u of idle) if (game.order(u, { type: 'move', points: [[u.x, u.z], [o.x + (u.x - cx) * k, o.z + (u.z - cz) * k]] })) ordered++;
  return { ordered, of: idle.length, objective: o.name };
});
/** Every Union brigade selected (box select), then the Fallback key F on the battlefield. */
async function fallbackOrder(page) {
  const before = await page.evaluate(() => {
    const { game } = window.__game;
    game.selectMany(game.units.filter((u) => u.alive && u.side === 'US'));
    return { orders: game.orders || 0, selected: game.orderable().length };
  });
  await page.locator('#battlefield').focus();
  await page.keyboard.press('f');
  const after = await page.evaluate(() => window.__game.game.orders || 0);
  if (after > before.orders) return { via: 'key F', selected: before.selected };
  // The key did not reach the field (focus taken by an overlay): the same order through the API the key calls.
  const ok = await page.evaluate(() => window.__game.game.orderSelected('fallback'));
  return { via: ok ? 'orderSelected (key F did not register)' : 'none taken', selected: before.selected };
}
/** Give up the field: every Union brigade marches 1.2 km straight away from the objective (a contested objective is a
 *  draw, so a Defeat needs the ground left to the enemy). The same move order a drag gives. */
async function abandonField(page) {
  return page.evaluate(() => {
    const { game, terrain } = window.__game, o = game.objective, lim = (terrain.half || 2500) - 150;
    const clamp = (v) => Math.max(-lim, Math.min(lim, v));
    let n = 0;
    for (const u of game.units.filter((x) => x.alive && x.side === 'US')) {
      const dx = u.x - o.x, dz = u.z - o.z, d = Math.hypot(dx, dz) || 1;
      if (game.order(u, { type: 'move', points: [[u.x, u.z], [clamp(o.x + (dx / d) * (d + 1200)), clamp(o.z + (dz / d) * (d + 1200))]] })) n++;
    }
    return { abandoned: n };
  });
}
/** Fast-forward to the phase's end; resume through arrival auto-pauses as a player pressing Resume would. */
async function fight(page, row, plan, label) {
  const start = Date.now(), simEnd = row.simLength, notes = [];
  let mid = false, lastSim = -1, stalls = 0, nextAttack = 0, fallbacks = 0;
  for (;;) {
    const sim = await page.evaluate(() => window.__game.game.simTime);
    if ((plan === 'attack' || (plan === 'defeat' && sim < 300)) && sim >= nextAttack) { notes.push({ at: Math.round(sim), attack: await attackOrder(page) }); nextAttack = sim + 240; }
    if (plan === 'defeat' && sim >= 300 + 150 * fallbacks && fallbacks < 3) {
      notes.push({ at: Math.round(sim), fallback: await fallbackOrder(page) }); fallbacks++;
      if (fallbacks === 3) notes.push({ at: Math.round(sim), ...(await abandonField(page)) });
    }
    const st = await page.evaluate((chunk) => {
      const { game } = window.__game, s0 = game.simTime;
      for (let guard = 0; guard < 400 && game.simTime - s0 < chunk && !game.over; guard++) {
        if (game.paused) game.togglePause();
        game.fastForward(Math.min(5, chunk - (game.simTime - s0)));
      }
      return { sim: game.simTime, over: game.over };
    }, 30);
    if (st.over) { lastSim = st.sim; break; }
    if (!mid && st.sim > simEnd / 2) { mid = true; await page.waitForTimeout(500); await shot(page, `${label}-battle`); }
    stalls = st.sim <= lastSim + 0.01 ? stalls + 1 : 0; lastSim = st.sim;
    if (stalls >= 3) throw new Error(`the simulation stopped advancing at ${Math.round(st.sim)} s of ${Math.round(simEnd)} s without an end`);
    if (Date.now() - start > FF_BUDGET_MS) {
      // Over budget: end the phase through Game's own objective/result path (the documented hook the UI tests use) so the
      // rest of the campaign still runs, and fail this phase's "fought to its end" check.
      notes.push({ at: Math.round(st.sim), forcedEnd: true });
      await page.evaluate(() => { const g = window.__game.game; g.paused = true; g.checkObjective(0, true); });
      return { wall: Date.now() - start, sim: st.sim, forced: true, notes };
    }
  }
  return { wall: Date.now() - start, sim: lastSim, forced: false, notes };
}

// ---- one camp -> field -> after-action -> camp cycle ---------------------------------------------------------------
let answered = 0;
async function playPhase(page, errors, { index, replay = false, plan }) {
  const L = LADDER[index], label = `p${String(index + 1).padStart(2, '0')}-${L.phaseId}${replay ? '-replay' : ''}`;
  const row = { index, packId: L.packId, phaseId: L.phaseId, title: L.title, loan: L.loan, replay, plan, decisions: [] };
  phases.push(row);
  const started = Date.now(), errorsAt = errors.length;
  console.log(`\n== phase ${index + 1}/${LADDER.length}${replay ? ' (replay)' : ''}: ${L.title} (${L.packId}/${L.phaseId}), plan ${plan}`);
  // ---- camp ----
  step = `${label}: camp`;
  await campReady(page);
  const before = await slotSave(page); observe(before, `${label}-camp`);
  const ui = await campUi(page);
  if (!replay) check(`${label}-camp`, ui.position === L.position && ui.next === `Next: ${L.title}` && before.campaign.index === index,
    `"${ui.position}"; "${ui.next}"; save index ${before.campaign.index}`);
  else check(`${label}-camp-replay-offered`, ui.replay === `Replay this phase: ${L.title}`, `"${ui.replay}"; Next still "${ui.next}"`);
  await shot(page, `${label}-camp`);
  step = `${label}: camp order`;
  const sel = page.locator('#camp-order-0');
  const current = await sel.inputValue(), brigadeId = await sel.getAttribute('data-brigade-id');
  const want = ['drill', 'target', 'rest'].filter((o) => o !== current)[index % 2];
  await sel.selectOption(want);
  await waitFn(page, `the order to save (${want})`, () => !window.__entry.importing && /Saved; carried out/.test(document.getElementById('camp-orders-status').textContent), null, 15_000);
  const ordered = await slotSave(page);
  check(`${label}-camp-order`, (ordered.army.find((b) => b.id === brigadeId)?.order ?? 'rest') === want, `${brigadeId}: ${current} -> ${want} saved (unset = Rest, the default)`);
  row.campOrder = { brigadeId, from: current, to: want };
  const menBefore = menById(ordered);
  // ---- Next / Replay: decision cards, then the march ----
  step = `${label}: leave camp`;
  const leftCamp = Date.now();
  await page.locator(replay ? '#camp-replay' : '#camp-next').click();
  for (let guard = 0; guard < 12; guard++) {
    let state = null;
    for (const until = Date.now() + 60_000; !state && Date.now() < until;) {
      if (/[?&]campaign=1/.test(page.url())) { state = 'field'; break; }
      state = await page.evaluate(() => (document.getElementById('camp-decision')?.open && document.getElementById('camp-decision-reveal').hidden
        && !window.__entry?.importing ? 'card' : null)).catch(() => null);
      if (!state) await page.waitForTimeout(250);
    }
    if (!state) throw new Error(`neither a decision card nor the field after leaving camp (60 s): ${await visible(page)}`);
    if (state === 'field') break;
    step = `${label}: decision card`;
    const card = await page.evaluate(() => ({ title: document.getElementById('camp-decision-heading').textContent, count: document.getElementById('camp-decision-count').textContent,
      options: [...document.querySelectorAll('#camp-decision-options input')].map((n) => ({ id: n.value, enabled: !n.disabled })) }));
    const open = card.options.filter((o) => o.enabled);
    if (!open.length) throw new Error(`decision "${card.title}" has no open option`);
    const pick = open[answered++ % open.length];
    await page.locator(`#camp-decision-options label.camp-decision-option[data-option="${pick.id}"]`).click();
    await page.locator('#camp-decision-choose').click();
    await waitFn(page, `the reveal of "${card.title}"`, () => !document.getElementById('camp-decision-reveal').hidden && !window.__entry.importing, null, 15_000);
    const reveal = await page.evaluate(() => ({ history: document.getElementById('camp-decision-history').textContent, provenance: document.getElementById('camp-decision-provenance').textContent,
      sources: document.querySelectorAll('#camp-decision-sources li').length }));
    const chosen = await slotSave(page);
    const rec = (chosen.decisions || []).at(-1);
    check(`${label}-decision-${row.decisions.length + 1}`, rec?.optionId === pick.id && reveal.history.length > 20 && reveal.sources > 0,
      `${card.count}: "${card.title}" -> ${pick.id} (option ${card.options.findIndex((o) => o.id === pick.id) + 1} of ${card.options.length}); revealed (${reveal.provenance}, ${reveal.sources} sources)`);
    row.decisions.push({ title: card.title, option: pick.id });
    if (row.decisions.length === 1) await shot(page, `${label}-decision`);
    await page.locator('#camp-decision-continue').click();
  }
  // ---- the field ----
  step = `${label}: field load`;
  await page.waitForURL(/[?&]campaign=1/, { timeout: 60_000 });
  const marched = await slotSave(page);
  await waitFn(page, 'the field with its Briefing (window.__ready, briefing open)',
    () => (window.__ready === true && window.__game && document.getElementById('briefing')?.open) || !!document.getElementById('field-failure-heading'), null, 300_000);
  const failedField = await page.evaluate(() => document.getElementById('field-failure-heading') ? document.getElementById('entry-note')?.textContent : null);
  if (failedField) throw new Error(`the battlefield could not be loaded: ${failedField}`);
  row.loadS = secs(Date.now() - leftCamp);
  const field = await page.evaluate(() => {
    const { game, pack, terrain, campaign } = window.__game;
    return { pack, terrain: terrain.meta.name, units: game.units.length, sides: [...new Set(game.units.map((u) => u.side))].sort().join(),
      replay: campaign?.phase.replay, awardId: campaign?.phase.awardId, title: document.getElementById('briefing-title')?.textContent,
      focus: document.activeElement?.id, paused: game.paused };
  });
  row.awardId = field.awardId;
  check(`${label}-field`, field.pack?.packId === L.packId && field.pack?.phaseId === L.phaseId && field.terrain === L.terrainName && field.sides === 'CS,US'
    && field.title === L.title && field.replay === replay && field.paused,
  `${field.pack?.packId}/${field.pack?.phaseId} on "${field.terrain}"; ${field.units} units; Briefing "${field.title}" (paused, focus ${field.focus}); replay ${field.replay}; loaded in ${row.loadS} s`);
  await shot(page, `${label}-briefing`);
  step = `${label}: begin`;
  if (field.focus !== 'briefing-begin') await page.locator('#briefing-begin').focus();
  await page.keyboard.press('Enter');
  await waitFn(page, 'Begin to close the Briefing', () => !document.getElementById('briefing')?.open && !window.__game.game.paused, null, 15_000);
  // ---- fight ----
  step = `${label}: fight`;
  const f = await fight(page, L, plan, label);
  row.fightS = secs(f.wall); row.orders = f.notes;
  check(`${label}-fought-to-end`, !f.forced, f.forced ? `fast-forward budget ${secs(FF_BUDGET_MS)} s ran out at ${Math.round(f.sim)} of ${Math.round(L.simLength)} sim s; ended through checkObjective(0, true)`
    : `ended at ${Math.round(f.sim)} of ${Math.round(L.simLength)} sim s in ${row.fightS} s wall`);
  step = `${label}: result`;
  await waitFn(page, 'the result dialog with its action', () => document.getElementById('result')?.open && !document.getElementById('result-action').hidden && !document.getElementById('result-action').disabled, null, 60_000);
  const result = await page.evaluate(() => ({ title: document.getElementById('result-title').textContent, action: document.getElementById('result-action').textContent,
    text: document.getElementById('result-text').textContent, grade: window.__game.practice.phase?.record.grade ?? null, failure: window.__game.practice.phaseFailure,
    why: window.__game.game.result?.why }));
  row.grade = result.grade; row.why = result.why;
  await shot(page, `${label}-result`);
  check(`${label}-result`, GRADES.includes(result.grade) && !result.failure && result.action === 'After-action & loot',
    `${result.title}: ${result.grade}${result.failure ? ` (failure: ${result.failure})` : ''}; "${result.why}"`);
  if (plan === 'defeat') check(`${label}-defeat`, result.grade === 'Defeat', `deliberate defeat (attack, then every brigade falls back): ${result.grade}`);
  // ---- after-action pages ----
  step = `${label}: after-action`;
  const afterStart = Date.now();
  await page.locator('#result-action').click();
  await waitFn(page, 'after-action page a', () => document.querySelector('.rw[data-step="a"]'), null, 30_000);
  const stepOf = () => page.evaluate(() => document.querySelector('.rw')?.dataset.step ?? null);
  const steps = [await stepOf()];
  const a = await page.evaluate(() => ({ kids: [...document.querySelector('.rw-aar').children].map((n) => n.className.split(' ')[0]),
    primary: document.querySelector('.rw-aar .rw-primary .rw-primary-label')?.textContent, vsRows: document.querySelectorAll('.rw-vs-table tbody tr').length,
    points: document.querySelector('.rw-points')?.dataset.points ?? null }));
  const at = (cls) => a.kids.indexOf(cls);
  check(`${label}-aar-a`, at('rw-grade') >= 0 && at('rw-grade') < at('rw-vs') && at('rw-vs') < at('rw-points') && (at('rw-badges') === -1 || at('rw-vs') < at('rw-badges'))
    && a.primary === 'What really happened' && a.vsRows > 0, `${a.kids.join(' > ')}; ${a.vsRows} you-vs-history rows; +${a.points} points; primary "${a.primary}"`);
  await shot(page, `${label}-aar`);
  await page.locator('#rw-aar-grade').focus(); await page.keyboard.press('Enter');
  await waitFn(page, 'after-action page h (what really happened)', () => document.querySelector('.rw[data-step="h"]'), null, 15_000);
  steps.push(await stepOf());
  const h = await page.evaluate(() => ({ text: document.querySelector('.rw-story-text')?.textContent ?? '', sources: document.querySelectorAll('.rw-story-sources li').length }));
  await page.keyboard.press('Enter');
  await waitFn(page, 'after-action page r (the replay)', () => document.querySelector('.rw[data-step="r"] .rp'), null, 15_000);
  steps.push(await stepOf());
  const r0 = await page.evaluate(() => ({ playing: document.querySelector('.rp').dataset.playing, sample: Number(document.querySelector('.rp').dataset.sample) }));
  if (r0.playing !== 'true') await page.locator('.rp-play').click();
  let played = true;
  try { await page.waitForFunction((s) => Number(document.querySelector('.rp').dataset.sample) > s, r0.sample, { timeout: 15_000, polling: 250 }); } catch { played = false; }
  const r1 = await page.evaluate(() => ({ playing: document.querySelector('.rp').dataset.playing, sample: Number(document.querySelector('.rp').dataset.sample) }));
  await shot(page, `${label}-replay`);
  check(`${label}-aar-story-replay`, h.text.length > 40 && h.sources > 0 && played, `story ${h.text.length} chars, ${h.sources} sources; replay played sample ${r0.sample} -> ${r1.sample} (${r1.playing})`);
  await page.getByRole('button', { name: /^Open the loot/ }).click();
  await waitFn(page, 'the loot (page b)', () => document.querySelector('.rw[data-step="b"]'), null, 15_000);
  steps.push(await stepOf());
  check(`${label}-aar-order`, steps.join() === 'a,h,r,b', `pages ${steps.join(' -> ')}`);
  // ---- loot: dealt, turned, one card equipped ----
  step = `${label}: loot`;
  const dealt = await page.evaluate(() => window.__game.practice.reward.state.cards.length);
  await page.keyboard.press('s');
  await page.getByRole('button', { name: /^Issue to brigades/ }).click();
  await waitFn(page, 'the issue step (c)', () => document.querySelector('.rw[data-step="c"]') || document.querySelector('.rw-tray'), null, 15_000);
  let equipped = null;
  const tiles = await page.locator('.rw-tray .rw-tile').count();
  for (let t = 0; t < tiles && !equipped; t++) {
    await page.locator(`.rw-tray .rw-tile[data-t="${t}"]`).focus();
    await page.keyboard.press('Enter');
    const onBrigade = await page.evaluate(() => document.activeElement?.classList.contains('rw-brig') && !document.activeElement.classList.contains('is-blocked'));
    if (!onBrigade) continue;
    await page.keyboard.press('Enter');
    if (!await page.locator('.rw-cmp').count()) continue;
    await page.locator('.rw-cmp .rw-primary').click();
    equipped = await page.evaluate(() => window.__game.practice.reward.state.log.at(-1) ?? null);
  }
  await shot(page, `${label}-issue`);
  check(`${label}-loot`, dealt > 0 && !!equipped, `${dealt} cards dealt; ${equipped ? `${equipped.item} issued to ${equipped.brigade}` : `no card could be issued (${tiles} in the tray)`}`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await waitFn(page, 'the rating count-ups to finish', () => !window.__game.practice.reward.state.counting, null, 30_000);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  step = `${label}: save`;
  await waitFn(page, '"Campaign saved"', () => document.getElementById('result')?.open && /^Campaign (saved|not saved)$/.test(document.getElementById('result-title').textContent), null, 60_000);
  const savedTitle = await page.locator('#result-title').textContent();
  if (savedTitle !== 'Campaign saved') throw new Error(`the phase was not saved: ${await visible(page)}`);
  row.afterS = secs(Date.now() - afterStart);
  const after = await slotSave(page); observe(after, `${label}-saved`);
  const last = after.campaign.history.at(-1), ids = Object.keys(menBefore);
  const expectIndex = index + 1; // a first play advances past this phase; its replay leaves the ladder where the first play left it
  check(`${label}-recorded`, last?.awardId === row.awardId && last.grade === result.grade && last.replay === replay && after.campaign.index === expectIndex
    && after.rp >= marched.rp && after.reputation >= marched.reputation,
  `history ${after.campaign.history.length}: ${last?.phaseId} ${last?.grade}${last?.replay ? ' (replay)' : ''}; index ${after.campaign.index}; rp ${marched.rp} -> ${after.rp}; reputation ${marched.reputation} -> ${after.reputation}`);
  if (equipped) check(`${label}-equipped-saved`, after.army.some((b) => b.id === equipped.brigade && b.weapon.uid === equipped.item), `${equipped.item} on ${equipped.brigade} in the save`);
  row.menBefore = sumMen(ordered, ids); row.menAfter = sumMen(after, ids);
  if (L.loan) check(`${label}-loan-unchanged`, row.menAfter === row.menBefore, `franchise men ${row.menBefore} -> ${row.menAfter} (Grant's army on loan)`);
  if (plan === 'defeat') {
    const offered = await page.evaluate(() => !document.getElementById('result-replay').hidden);
    check(`${label}-defeat-continues`, after.campaign.index === index + 1 && after.campaign.status === 'in-progress' && row.menAfter < row.menBefore && offered,
      `ladder advanced to ${after.campaign.index} (${after.campaign.status}); losses carried ${row.menBefore} -> ${row.menAfter} men; Replay this phase offered ${offered}`);
  }
  const newErrors = real(errors.slice(errorsAt));
  check(`${label}-no-errors`, newErrors.length === 0, newErrors.length ? newErrors.slice(0, 4).join(' | ') : 'no page, console or request errors');
  row.wallS = secs(Date.now() - started);
  console.log(`   phase ${index + 1}${replay ? ' replay' : ''} ${L.phaseId}: ${result.grade}; wall ${row.wallS} s (load ${row.loadS}, fight ${row.fightS}, after-action ${row.afterS})`);
  return { after, label };
}

// ---- the run -------------------------------------------------------------------------------------------------------
const { server, url } = await startServer({ port: 0 });
const browser = await playwright.chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const browserVersion = `chromium ${browser.version()}`;
console.log(`${browserVersion} at ${url}; fast-forward budget ${secs(FF_BUDGET_MS)} s/phase; deadline ${DEADLINE_MS / 60000} min; defeat at phase ${DEFEAT_AT + 1}`);
const errors = [];
let failure = null, page = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', acceptDownloads: true });
  page = await ctx.newPage();
  watch(page, url, errors);
  // ---- 1. fresh title -> New campaign -> slot 1 ----
  step = 'title';
  await page.goto(url);
  await waitFn(page, 'the title with the shipped campaign', () => window.__entry && !window.__entry.importing && window.__entry.campaign, null, 60_000);
  // Render quality is a saved player preference (cw.quality); low keeps swiftshader frames short between fast-forwards.
  if (QUALITY === 'low') await page.evaluate(() => localStorage.setItem('cw.quality', 'low'));
  const title = await page.evaluate(() => ({ heading: document.getElementById('entry-title-heading').textContent, focus: document.activeElement?.id,
    campaignContinue: !document.getElementById('entry-campaign-continue').hidden, newCampaign: !document.getElementById('entry-new-campaign').hidden }));
  check('title-fresh', title.heading === CAMPAIGN.title && title.focus === 'entry-continue' && !title.campaignContinue && title.newCampaign, JSON.stringify(title));
  await shot(page, 'title');
  step = 'new campaign';
  await page.locator('#entry-new-campaign').click();
  await waitFn(page, 'the slot picker with three slots', () => document.querySelectorAll('#slot-rows .slot-choice').length === 3, null, 30_000);
  await page.locator('#slot-choice-1').click();
  await page.waitForURL(/\?camp=1$/, { timeout: 60_000 });
  await campReady(page);
  const fresh = await slotSave(page);
  check('new-campaign', fresh?.version === 2 && fresh.campaign.index === 0 && fresh.campaign.history.length === 0 && fresh.army.length >= CAMPAIGN.franchise.length,
    `slot 1: v${fresh?.version}, index ${fresh?.campaign.index}, ${fresh?.army.length} formations`);
  // ---- 2-6. the ladder ----
  const plans = [];
  for (let i = 0; i < LADDER.length; i++) {
    const plan = i === DEFEAT_AT ? 'defeat' : LADDER[i].attacker === 'US' && !LADDER[i].loan ? 'attack' : 'default';
    plans.push({ index: i, plan });
    if (i === DEFEAT_AT) plans.push({ index: i, replay: true, plan: LADDER[i].attacker === 'US' ? 'attack' : 'default' });
  }
  for (const p of plans) {
    if (Date.now() - t0 > DEADLINE_MS) throw new Error(`run deadline (${DEADLINE_MS / 60000} min) passed before phase ${p.index + 1}`);
    // camp offers Replay only after a Defeat: if the deliberate defeat did not come out as one, say so and go on
    if (p.replay) {
      await campReady(page);
      if (await page.evaluate(() => document.getElementById('camp-replay')?.hidden !== false)) {
        check(`p${String(p.index + 1).padStart(2, '0')}-replay-skipped`, false, 'camp offers Replay only after a Defeat, and the deliberate defeat was not one');
        continue;
      }
    }
    // 5 and 6: after phase 2's camp, a reload and an export/import (once, before phase 3)
    if (p.index === 2 && !p.replay) {
      step = 'reload';
      await campReady(page);
      const raw = await slotRaw(page), uiBefore = await campUi(page);
      await page.goto(url);
      await waitFn(page, 'the title with a campaign to continue', () => window.__entry?.mode === 'title' && !window.__entry.importing && window.__entry.campaign?.continueSlot === 1, null, 60_000);
      const cont = await page.evaluate(() => ({ focus: document.activeElement?.id, slot: document.getElementById('entry-campaign-slot').textContent }));
      await shot(page, 'reload-title');
      await page.locator('#entry-campaign-continue').click();
      await page.waitForURL(/\?camp=1$/, { timeout: 60_000 });
      await campReady(page);
      const rawAfter = await slotRaw(page), uiAfter = await campUi(page), s = JSON.parse(rawAfter);
      check('reload-continue', rawAfter === raw && JSON.stringify(uiAfter) === JSON.stringify(uiBefore) && s.campaign.index === 2 && cont.focus === 'entry-campaign-continue',
        `title Continue (focused ${cont.focus}; "${cont.slot}") reopened phase index ${s.campaign.index}; save byte-identical ${rawAfter === raw}; camp UI identical ${JSON.stringify(uiAfter) === JSON.stringify(uiBefore)}`);
      step = 'export';
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.locator('#entry-export').click()]);
      const file = path.join(OUT, 'export-slot1.json');
      await download.saveAs(file);
      step = 'import (fresh context)';
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
      const errors2 = [];
      try {
        const p2 = await ctx2.newPage(); watch(p2, url, errors2);
        await p2.goto(url + '?camp');
        await waitFn(p2, 'the empty title in a fresh profile', () => window.__entry && !window.__entry.importing, null, 60_000);
        const empty = await slotRaw(p2);
        const [chooser] = await Promise.all([p2.waitForEvent('filechooser', { timeout: 15_000 }), p2.locator('#entry-import').click()]);
        await chooser.setFiles(file);
        await waitFn(p2, 'the replace-army confirm', () => document.getElementById('entry-replace')?.open, null, 15_000);
        await p2.locator('#entry-confirm').click();
        await waitFn(p2, '"Imported and saved army."', () => !window.__entry.importing && document.getElementById('entry-status').textContent === 'Imported and saved army.', null, 30_000);
        await p2.goto(url + '?camp');
        await campReady(p2);
        const imported = await slotRaw(p2), ui2 = await campUi(p2);
        await shot(p2, 'import-camp');
        const same = JSON.stringify(JSON.parse(imported)) === JSON.stringify(JSON.parse(rawAfter));
        const diff = same ? [] : Object.keys(JSON.parse(rawAfter)).filter((k) => JSON.stringify(JSON.parse(imported)[k]) !== JSON.stringify(JSON.parse(rawAfter)[k]));
        check('export-import', empty === null && same && JSON.stringify(ui2) === JSON.stringify(uiAfter) && real(errors2).length === 0,
          `fresh profile empty ${empty === null}; imported save identical ${same}${diff.length ? ` (differs in ${diff.join(', ')})` : ''}; camp UI identical ${JSON.stringify(ui2) === JSON.stringify(uiAfter)}${real(errors2).length ? `; errors ${real(errors2).slice(0, 3).join(' | ')}` : ''}`);
      } finally { await ctx2.close().catch(() => {}); }
    }
    const { after, label } = await playPhase(page, errors, p);
    const L = LADDER[p.index];
    step = `${label}: leave the result`;
    if (L.index === LADDER.length - 1) {
      // ---- 4. the campaign ending and the record book ----
      step = 'campaign ending';
      const action = await page.locator('#result-action').textContent();
      await page.locator('#result-action').click();
      await waitFn(page, 'the campaign ending with its medals', () => document.getElementById('campaign-ending')?.open && document.querySelector('#campaign-ending .rb-medal'), null, 30_000);
      await page.waitForTimeout(1000); // the grade section is redrawn once the ladder and packs load
      const ending = await page.evaluate(() => ({ grade: document.querySelector('#campaign-ending .rb-grade-v')?.dataset.grade,
        medals: [...document.querySelectorAll('#campaign-ending .rb-medal')].map((m) => m.dataset.medal) }));
      await shot(page, 'campaign-ending');
      check('campaign-ending', action === 'Campaign ending' && after.campaign.status === 'complete' && GRADES.includes(ending.grade) && ending.medals.length >= packOrder.length,
        `"${action}"; campaign grade ${ending.grade}; medals ${ending.medals.join(', ')}`);
      step = 'record book';
      await page.locator('#campaign-ending-book').click();
      await waitFn(page, 'the record book tables', () => document.getElementById('record-book')?.open && document.querySelector('#record-book .rb-table'), null, 30_000);
      const book = await page.evaluate(() => [...document.querySelectorAll('#record-book .rb-table tbody tr')].map((tr) => ({
        phase: tr.querySelector('th')?.textContent ?? '', grade: tr.querySelector('td span')?.textContent ?? '', replay: tr.dataset.replay === 'true' })));
      await shot(page, 'record-book');
      const missing = LADDER.filter((x) => !book.some((r) => r.phase.startsWith(x.title))).map((x) => x.title);
      check('record-book', book.length === after.campaign.history.length && !missing.length && book.every((r) => GRADES.includes(r.grade)) && book.filter((r) => r.replay).length === 1,
        `${book.length} rows (${book.filter((r) => r.replay).length} replay) for ${after.campaign.history.length} recorded attempts; ${missing.length ? `missing ${missing.join(', ')}` : `all ${LADDER.length} phases graded`}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      // and the camp shows the finished campaign
      await page.goto(url + '?camp=1');
      await waitFn(page, 'the completed camp', () => window.__entry?.mode === 'camp' && !window.__entry.importing, null, 60_000);
      const done = await campUi(page);
      await shot(page, 'camp-complete');
      check('camp-complete', typeof done.complete === 'string' && done.complete.startsWith('Campaign complete') && done.next === null && done.record.length === after.campaign.history.length,
        `"${done.complete}"; ${done.record.length} record rows`);
    } else {
      await page.locator('#result-action').click();
      await page.waitForURL(/\?camp=1$/, { timeout: 60_000 });
    }
  }
} catch (error) {
  failure = { step, message: error.message.split('\n')[0], lastShot: null, visible: null };
  if (page) { failure.visible = await visible(page); failure.lastShot = await shot(page, `FAIL-${step.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`); }
  check(`step: ${step}`, false, `${failure.message} | last screenshot ${failure.lastShot} | ${failure.visible}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
const all = real(errors);
check('console-clean', all.length === 0, all.length ? all.slice(0, 6).join(' | ') : `no page errors, console errors or failed requests (${errors.length - all.length} navigation aborts)`);
const totalS = secs(Date.now() - t0);
console.log('\nphase                          grade      wall s  load  fight  after');
for (const r of phases) console.log(`${`${r.index + 1}${r.replay ? 'R' : ' '} ${r.phaseId}`.padEnd(30)} ${String(r.grade ?? '-').padEnd(9)} ${String(r.wallS ?? '-').padStart(7)} ${String(r.loadS ?? '-').padStart(5)} ${String(r.fightS ?? '-').padStart(6)} ${String(r.afterS ?? '-').padStart(6)}`);
console.log(`total wall ${totalS} s`);
const failed = results.filter((r) => !r.ok);
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({ browser: browserVersion, ffBudgetS: FF_BUDGET_MS / 1000, defeatAt: DEFEAT_AT, totalS, failure, lastShot, phases, results, errors }, null, 1));
console.log(failed.length ? `PLAYTHROUGH FAILED (${results.length - failed.length}/${results.length})` : `PLAYTHROUGH OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);

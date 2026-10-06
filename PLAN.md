# PLAN — autonomous completion of v1 (Aaron, 2026-10-06; DECISIONS 0022)

## Finish line and authority

Finish **the complete existing v1**, with Shiloh, Stones River and Chattanooga, all v1 battle and
franchise systems in DESIGN.md, and the full title -> briefing -> battle -> results/loot -> camp ->
next phase flow. The brief request to finish the whole long-term vision was explicitly withdrawn.
There is no hard deadline and no new spending. Both the Mac and 2017 iPad remain targets.
Aaron explicitly requires **no hands-on checks**, superseding his earlier one-check answer.

The active agent makes reasonable design, implementation, art-selection, tuning and acceptance
decisions without routine approval requests. This replaces per-object popups, Aaron-only sandbox
locks, device playtest requests and approval stops for bounded engineering. Preserve approved art,
historical integrity, quality limits and every v1 function. Do not silently drop Stones River under
the old time-pressure cut rule. Do not ask for a Project-board auth refresh; this file is sufficient.
Escalate only a genuinely nondelegable access/authority issue or an unavoidable conflict that changes
the agreed product. Continue independent work while a dependent item is blocked.

Autonomy is not permission to mark failed or unrun checks passed. A failed experiment requires a new
hypothesis before retry; diagnose and fix without asking for permission for each reversible step.
The existing soldier packaging failures still prohibit shipping those candidates. Lossless residency
feasibility and a bounded, evidenced repair are now work to resolve autonomously, not another popup.

## Live baseline (source-inspected 2026-10-06)

At assessment: main/origin/main `bde3939463e11783b47b5f2ea87ff1e42671ae77`; exact-SHA CI
37404610471 and Pages 37404610443 passed. Only pre-existing untracked file:
`NEW-civil-war-video-game.code-workspace` (preserve; never include in commits). No COORDINATION.md
exists in this repo. The old Desktop repo is frozen and read-only.

Henry House Hill is a functioning practice battle. The reward page separately runs after-action,
deterministic loot, compare/equip and ratings. `src/main.js`'s result path does not connect to it;
`src/reward/sequence.js` starts from SAMPLE_ARMY and returns completed state; `reward.html` retains
that state only in a window variable. No progress store, battle-pack directory or franchise directory
exists yet. Touch/pinch/twist and box selection have implementations; hardware behavior is unverified.
Current CI runs npm test in Chromium/SwiftShader. `tools/test-reward.mjs` is separate and not in CI.
Source inspection is not a new gameplay, performance or accessibility pass.

## Build order and acceptance

Each row is a playable milestone, completed in small green commits. The art feasibility track starts
with P1 and feeds every milestone; it must not block unrelated persistence, simulation or content.
Thin slices are implementation stages, never exclusions from the final feature set.

| Phase | Deliverable | Required evidence before closing |
|---|---|---|
| P1 — preserve progress | Save/export/import completed reward army/depot state; cover reward logic in CI | Exact reload/round-trip identities and equipment; invalid imports leave state unchanged; no reroll or duplicate award; storage failures are recoverable |
| P2 — continuous practice loop | New-player fight, capturable/retakable field crates, actual survivors -> results -> loot/equip -> saved army -> Continue; complete sandbox and choose screen defaults | Agent plays the real UI from fresh start through first loot and reload; one obvious next action; no dead ends, orphaned overlays or duplicate rewards; first reward about a minute into the introductory fight |
| P3 — complete battle rules | Shared scenario/phase model and the missing combat functions listed below; real brigade regiments and eligible uniforms | Order-obedience, terrain/arrival/capture/delegation tests; asymmetric setup without hidden combat bonuses; real UI scenarios exercise every command and failure/recovery path |
| P4 — complete campaign path | Shiloh -> Stones River -> Chattanooga, thin camp, decision cards, briefings, phase carry-over, three slots, Battles menu and campaign ending | Every phase loads and finishes through real navigation; defeat continues; replay is recorded; Grant's day-1 loan army is separate from the franchise; sourced historical data and no invented names |
| P5 — full progression and depth | All planned loot/stores/shop/training/reputation/badge/X-Factor/enemy/record systems | Equipment changes actual combat; dates gate stock; stable identity and no duplicate transfers; balanced multi-phase campaigns; all 20 badges and reputation 1-10 reachable under their rules |
| P6 — final presentation | Complete baked art, terrain, effects, living title/camp, card art, recorded sound, music, settings, accessible keyboard/touch flow | Independent visual review against references; no placeholder Union-tinted Confederate art; quality/memory gates; native performance where accessible; screenshot baselines and reduced-motion/gore/audio settings |
| P7 — release proof | Agent playthroughs, regression, stress, browser/offline/upgrade/save tests, source/license review, version/tag/Release | All v1 requirements have evidence; no release-blocking defects or unacknowledged gaps; exact release SHA CI and Pages pass; release notes and future roadmap complete |

P4 introduces the six-badge/arms-shop/reputation-1-3 camp slice as soon as Shiloh works; P5 fills it
out while later battles are authored. Build battles in chronological order so carry-over is proved
as content grows. No separate engine per battle and no copied old global runtime.
P3/P4 overlap: use the first sourced Shiloh phase to exercise the shared pack and combat work early;
add capabilities in focused playable slices rather than building every rule in isolation first.

### P1: completed-state contract

Implementation (2026-10-06): completed rewards now use `cw.progress` through `src/franchise/save.js`.
Resume bypasses the loot generator; stable award IDs make completion idempotent. Version-1 imports
validate the complete inventory and reverse-issued history before a single storage replacement.
Compact exports remain importable near the 1 MiB UTF-8 limit. Retry/export preserves unsaved results;
live-snapshot conflicts cannot be bypassed by opening a one-card preview. Preferences/locks stay separate.
Reward positives and rejecting mutants are now CI steps; full smoke includes the real reward UI.
P1 was committed at `a2c29d339bd9c73f4f456fcee20cee860cdf91a9`; exact-SHA CI 37483119128 and
Pages 37483119093 succeeded. The next product phase is P2, not campaign saves.

Purpose: persist the reward prototype's **completed** army/depot state, not an in-progress battle or
full campaign. Use the already-planned `src/franchise/save.js` as the single progress-store seam;
do not create competing reward and campaign stores. `src/settings.js` remains preferences only:
its permissive per-key imports are unsuitable for atomic inventory validation. Begin with one
versioned completed-result envelope and extend to three campaign slots during P4.

Owned product seams: new `src/franchise/save.js`, reward completion/resume in `reward.html`, and
`src/reward/sequence.js` only where needed to accept restored army/depot without starting a new roll.
Use `src/reward/model.js` only if stable item identity requires it; do not rebalance loot in P1.
Tests: extend `tools/test-reward.mjs` for pure storage/envelope validation and rejecting controls;
add focused browser flow coverage through the existing test harness. Wire reward positives and
`--prove-fail` into `.github/workflows/ci.yml`. Bump `sw.js` VERSION when shipped runtime changes.
Read the existing reward model and data before choosing the envelope; derived ratings are recomputed,
not trusted from imported input. The result includes army, depot, issued, seed and grade.

Acceptance contract:
- Preserve brigade/item identities, equipment, depot, grade, seed and completed award identity on
  save/load and export/import. Reopening a completed result does not execute the loot generator.
- Commit a completed reward exactly once, including repeated completion callbacks or reload.
  Import replaces the selected progress snapshot atomically; it never merges or issues it again.
  Export/import may intentionally restore an older snapshot; no anti-cheat claim is made for editable
  local files. Prevent accidental duplication/reroll, not player-controlled backup restoration.
- Validate size, schema/version, finite bounded values, known references and unique ownership before
  writing. Malformed JSON, unsupported versions, unknown gear, duplicate identities, invalid numbers
  and partial payloads must reject with a useful message and zero mutation of the last valid state.
- Read/write failures and unavailable storage cannot erase the existing state or falsely report a
  successful save. Keep an export/retry path; do not fall back to starting a fresh random reward.
- Keep settings and their locks unchanged. Existing reward demo buttons may explicitly start a new
  demo; make the distinction from resuming saved progress clear and avoid overwriting silently.
- Real UI proof: finish/equip -> persist -> reload -> export -> import -> compare exact state;
  invalid import -> same prior state; resume/repeated completion -> same award/item counts.
  Keyboard, focus return and touch-sized controls remain usable. Run wcag review on changed UI.

Gates, in order (new coverage is implemented before these are acceptance gates):
1. `node --check src/franchise/save.js`; `node --check src/reward/sequence.js` if changed;
   `node --check tools/test-reward.mjs`; `git diff --check`.
2. `node tools/test-reward.mjs` then `node tools/test-reward.mjs --prove-fail`.
   The negative mode must exercise the new save invariants and match the expected rejection, not
   accept a harness crash as proof. Use injected storage/mutants; never mutate shipped saves.
3. `node tools/test.mjs --unit` then one `npm test` on the final candidate. Inspect
   `.out/last-result.json` and each relevant new screenshot; preserve existing assertions.
   If a source mutation is unavoidable for a negative control, record original hashes, run only on
   an isolated copy and require byte-for-byte restoration before the final positive run.
4. Agent review of the scoped diff and browser evidence; fix failures before committing.
5. Update this phase's status plus STATE/HANDOFF/DECISIONS; `git diff --check`; explicitly stage
   only owned files, commit, push main, and read CI and Pages for the exact SHA (commands below).

No texture/codec/art/renderer/simulation changes in P1. The independent art task is a read-only
residency assessment, not a second writer editing P1 or a license to load failed packs.

### P2a: practice result bridge (implemented 2026-10-06)

The Henry Hill practice now freezes its actual terminal roster, opens rewards on the same page and
continues to saved progress. Depleted identities and live gun counts survive export/reload; no sample
army or invented captures replace them. Native result/recovery panels pause the field, trap focus and
provide explicit replacement, unsaved export and retry. Sandbox/historical sessions cannot award loot.
Local proof: 9 outcome positives + 9 rejecting mutants; 21 reward/save positives + 21 mutants;
final smoke 101/101 in 346689 ms, timestamp 2026-10-06T15:34:29.856Z. Result/counts/recovery axe are
clear; 320/1024 actual screenshots reviewed. This is a clock-accelerated real result/UI test, not a
one-minute introductory playthrough or native-device proof. Exact commit CI/Pages must still pass.

Connect the unaltered Henry Hill practice result to the same reward/save UI. Pause and snapshot at
the terminal event once; include routed and depleted formations, floor fractional surviving men,
derive losses by conservation, and count live battery pieces. Keep scenario identities and use
explicit generic practice arms; do not assert a historical weapon model from an abstract runtime ID.
Pass zero captures until P2b implements real field crates. Preserve P1 atomic replacement, confirmation,
export/retry, idempotence and stale-baseline rejection. Continue reaches saved progress without a roll.
Historical `?battle=henry-hill` and altered `?sandbox` sessions grant no loot or progress writes.
Battle input is suspended behind result/reward/recovery UI; reward replay cannot inherit the save callback.
Gate pure outcome positives plus matching mutants, real result/equip/save/reload/Continue UI, zero-
survivor and disabled-gun cases, quota/conflict recovery, keyboard/focus/axe, final smoke and exact-SHA
CI/Pages. Intro timing, actual crates and full P2 remain open for the next green slice.

Next P2b: a clearly fictional two-vs-one introductory fight with contextual first-use hints, actual
capturable/retakable field crates and a measured first reward about a minute. Preserve the existing
Henry Hill practice as a distinct route, historical no-loot isolation and all P1/P2a recovery rules.
Write the bounded intro/crate acceptance contract before changing the scenario/result seams. Saved
equipment deployment, camp and the full title/campaign path remain open; P2a does not certify them.

### Required battle-system work (P3/P4; do not hide it inside “build Shiloh”)

Source-inspected existing foundations: infantry movement/fire/melee/fatigue, rout/rally, height/cover,
direct orders, paused orders, six buttons, objective/rout auto-pause, basic defender AI, moving artillery
limber/unlimber and distance-selected shot/canister, automatic line/column and a visual skirmisher screen.
Extend and verify these; “implemented” here does not certify finished behavior.

Explicit remaining work: capturable guns; cavalry scout/screen/pursue/wagon-capture/dismount;
mounted commander rally radius and wounds/death; cut-off surrender/prisoners/arms capture for both
sides; historical timed reinforcements with advance notice and auto-pause; Attack/Defend/Support
delegation and direct-order reclaim; road-aware formation/pathing; correct skirmisher behavior;
fords/bridges/thickets and meaningful obstacles; entrenchments and fences as breastworks; building
strongpoints/burning; friendly-line masking (DESIGN's “Masked”, no fire through friends); Recruit,
Veteran and General AI differences without hidden stat bonuses; per-phase sourced enemy openings,
adaptive reactions and temperament; unit initiative that never advances/charges unordered.
Keep drag-to-ground = march/fight en route, drag-to-enemy = engage at range, Charge explicit.
Ghost arrival position/facing/range/time must agree with execution, including touch and formations.
Regiments retain real identities/colours within a brigade and are not separately orderable.

### Scope accounting (all DESIGN v1 rows remain binding)

P2/P4: live title with Continue, first-use hints, full keyboard play/help, mouse/trackpad/touch,
minimap/army list/group selection, soldier's-eye view, complete dock, readable combat feedback,
pause/speeds and General's auto-pause policy; three named saves, autosave at phase/camp boundaries,
safe device transfer; independent historical Battles mode with no franchise loot; practice/sandbox
workbench retained. Custom pick-field/pick-armies sandbox battle remains in the post-v1 list.

P4: 3-5 sourced phases per battle, target 15-20 minutes each; 1-3 timed objectives plus casualties/
prisoners, four grades, historical-clock and early-end/fight-on behavior, losses carry forward without
game over; briefings/cited quotations, decision cards and 30-second after-action map replay;
“you vs history” and the slavery/emancipation/USCT/home-front thread. Proposed phase lists require
source verification by the agent, not another approval popup.

P5: gear-led OVR; Green/Trained/Veteran/Elite growth and casualty consequences; five rarities with
colour plus shape, condition affixes, clearly fictional named uniques, grade-dependent drops and
quartermaster issue; best-fit compare, equip, rarity fanfare and skip, rating count-ups; supplies,
wear, horses/wagons, trophies, depot capacity; requisition points, dated arms/stores stock, training,
army upgrades, badge slots/re-rolls; all 20 badges in Bronze/Silver/Gold, earned X-Factors and their
toned-down setting; reputation 1-10 and rewards; enemy losses/arms/veterancy/badges carry forward;
campaign grade and brigade record book; fresh seeded loot/shop/card choices on a new campaign.
Check the approved rarity cadence and ~20-25 OVR campaign growth against simulated/playable runs.

P6: baked soldiers/horses/guns/trees/buildings/ground/card art, eligible documented uniforms,
real regimental colours where sourced, fallen/field hospitals/dead horses/wreckage and gore toggle,
clear side/selection/state cues, artillery/charge/melee/cinematic/X-Factor effects, close-view detail,
Auto/Low/High/Ultra, recorded spatial battle audio and period music off the battlefield, living camp
reflecting army/depot, polished cards and UI; choose one coherent gallery style after comparing the
three candidates. Keep the working title unless a better checked name is useful; naming is delegated.

## Art feasibility and device proof

Approved source: Bake 37347072866 at `820846fdc2fe11782a36b219220edcb16e222f92`, sheets 1-12,
5,184 frames, nine looks per tier, 45 pages. Keep approved poses and ax/ay/ppm, directionsByClip,
tier anchors, stable name-bound looks and eligibility. Fix ninth-look/reordered-tier behavior when
integrating. Do not merge the whole bake branch into newer main.

Start with read-only lossless per-battle residency: loaded plus pending allocations, visible frame/
look/page needs, mip/transition requirements, disposal/caching, decoding/transient duplication,
total terrain/geometry/render-target memory and downloads. Existing full raw ~797 MiB cannot be
loaded wholesale; ~199.40 MiB compressed blocks alone do not establish the ~250 MB total scene cap.
Choose one justified bounded experiment after that assessment. Avoid repeated blind codec sweeps.
All heavy encoding/bakes/readbacks run on Actions; local downloads are small reports/previews.
Preserve byte limits RGB mean <=2, alpha mean <=1, edge RGB/alpha p95 <=8/8, clipping=0 and nonempty
samples. A new solution must meet them and whole-set visual inspection before asset fielding.

No hands-on checks from Aaron. Use agent-operated browsers and independent review; establish early
whether native Mac/iPad automation is already accessible without new spending or user intervention.
Do not close Aaron's browser or change device settings to obtain access. Current access to the actual
iPad has NOT been established. Chromium touch emulation and CI WebKit are useful compatibility checks,
but do not prove that A10X Safari holds 30 fps or survives full-battle memory pressure. Record native
performance, sustained fights, loading/transitions and offline cache checks separately. If physical
hardware remains inaccessible, keep the device release gate open and continue all other work;
never call it verified or silently redefine the target. No recurring playtest request to Aaron.

## Autonomous working loop and quality gates

- One active provider and one writer per file. Use the selected high-quality top loop for code,
  architecture, gameplay and final acceptance. At most one bounded read-only helper by default on
  this 8 GB Mac; explicitly select an available economical model/effort for research/inventory.
  Independent review should challenge the result; the author cannot close an unexamined screenshot.
- Choose the highest-value dependency-ready slice, write its short acceptance criteria here or in
  HANDOFF, implement, run focused checks, independently review, fix, run the final smoke, commit and
  push. Do not end the completion loop merely because a milestone finished. Batch related low-risk
  fixes; run broad browser/stress suites on Actions at meaningful integration/release boundaries.
- Start automated order, save, source/identity, flow and screenshot checks as soon as their behavior
  exists. Add CI WebKit/Firefox and a seeded balance robot on Actions; they are planned, not current
  gates. Reject vacuous samples, infinite battles, broken-control passes and unexplained loss/loot
  discontinuities. Simulation statistics supplement agent play; they do not certify fun.
- Agent playtests: fresh player through first reward; sustained battle and all command paths;
  full campaign with save/reload/defeat/replay/camp; historical standalone battle with no loot;
  touch/keyboard and offline/update/recovery paths. Inspect actual screenshots, state, requests and
  errors. Judge readability, responsiveness, interesting choices and obvious next steps.
- Frontend work receives wcag-auditor review and real keyboard/focus checks. Current serious/critical
  axe filtering is not a full accessibility claim. Test reduced motion, contrast and non-colour cues.
- Source facts require two independent sources for Verified, otherwise Inferred/Disputed. Reuse
  the old repo's data/citations before researching anew. Labels, rank and presence must be sourced.
  Game balance, hypothetical choices and invented item names are clearly distinguished from history.
- Keep artifacts in .out under the existing 300 MB cap; no new evidence catalogs, cloud offloads,
  paid services or giant local downloads. Small durable verdicts belong in the existing docs.
- Local routine gates: `git diff --check`; `node --check <touched-js>`; appropriate unit/reward checks;
  one `npm test` on the candidate. After push: `git rev-parse HEAD`,
  `gh run list --repo adhanke-star/the-civil-war --commit <SHA> --limit 10 --json databaseId,name,headSha,status,conclusion`,
  then `gh run view <id> --json headSha,status,conclusion,url` for CI and Pages. Read failures, repair,
  retest and check the new SHA. Successful deployment alone is never gameplay acceptance.
- Update phase statuses/evidence here, STATE (<20 lines), HANDOFF's live boundary and material
  DECISIONS in the implementation commit. Keep historical failures identifiable. At unavoidable
  session limits leave an exact fenced continuation packet; do not claim invisible work continues.

For sustained execution, use one goal-driven session with a verifiable v1 finish line, preserving
the same permissions and workspace. Goal mode must actually be activated; this planning session has
not activated it or scheduled anything. Official guidance: [long-running work](https://learn.chatgpt.com/docs/long-running-work).
No new scheduler framework is needed. Local work still needs the host/workspace available and sufficient
account capacity; neither remaining weekly quota nor unattended recovery has been verified here.
If a scheduler is later requested, first test one bounded run, prevent concurrent writers and preserve
the same acceptance rules. [Scheduled tasks](https://learn.chatgpt.com/docs/automations).

No credible calendar completion date is available from this inventory. Estimate remaining effort
after P2 demonstrates throughput and the art residency assessment resolves the largest uncertainty.
Report working milestones and remaining blockers, not invented percentages or promises of a weekend finish.

## After v1: build on the game, reuse strategy when it earns its place

Keep the roadmap: officers/cards/promotions and Confederate franchise; Eastern campaign;
custom sandbox battles; endgame medals, achievements, challenges and New Game Plus;
then strategy map/President; fog/weather/codex/gamepad/text scale/rebinding remain later as designed.
The core v1 campaign grade is included now; this broader endgame package is not required for v1.

The frozen old game provides candidate systems, not automatic acceptance. Start from
`GRAND-STRATEGY-PLAN.md`, `COMPLETION-MANIFEST.md`, the named source modules and citations at
`reference-freeze-2026-10-02`, plus known playtest findings in REVIEW-QUEUE. Candidate reuse:
captured supplies/provisioning and command advice; map maneuver, depots/rail/river logistics and
cavalry raids; later curated President decisions with delegation, politics and diplomacy. Reuse data,
rules and lessons; do not import the old UI/global architecture or its unresolved defects wholesale.

Before adopting a later system, build a small isolated playable example. Agent review must show a
meaningful choice, visible consequence, clear explanation and smooth return to battle/camp, with no
busywork, mandatory extra screens, save damage or performance regression. Compare against the current
loop; retain only a demonstrable improvement. Record rejected/deferred ideas with a short reason.
V1-shaped dates, quantities, coordinates and Washington standing provide expansion seams; do not
prebuild a speculative national simulation or let optional ideas move the v1 finish line.

## Detailed feature notes (original milestone names retained for navigation)

The P1-P7 order above supersedes the former approval-first sequence. The sandbox remains useful,
and agent-selected, reviewed defaults replace waiting for Aaron to lock every topic. Lock a topic
when its relevant tests and visual/play review pass; independent campaign work need not wait for an
unrelated art experiment. The following detailed notes continue to define their feature scope.

## S1 · Sandbox: feel + reward sequence
- `src/sandbox/`: slide-out panel, five tabs (Units, Rules, Look, Moments, Screens), a plain-English note
  and Reset per control, split-screen compare, Lock this, Copy settings, fps meter with cost warnings.
  Reached by `?sandbox` and the menu.
- Field feel, each as a switch: map-style camera (zoom to cursor, auto tilt, fly-to), touch (drag from
  the unit, twist to face, pinch, two-finger pan), ghost preview with range arc and march time, pencil
  order lines, automatic adjustable facing, move = fight on the way, attack = engage by fire, six order
  buttons, bottom dock with survey minimap, flag marker, box/division select, army list, engagement
  lines, casualty ticks, status words, event feed, pause with orders, 1x/2x/4x, auto-pause, soldier's-eye key.
- Units tab: place and command either side; strength, arms, veterancy. Rules tab: sliders on the
  constants in `src/sim/combat.js`. Moments tab: volley, charge, rout, shell burst, loot card, X-Factor.
- Reward sequence on placeholder data: capture crates on the field, after-action, cards dealt with
  rarity fanfare, side-by-side compare with best-fit star, equip, rating count-ups.
- Installable web app (manifest + service worker), save export/import, `device.html` GPU test page.
- Review: the agent plays, compares, tests and records defaults. No hands-on check is requested.

## Art track
- Read-only residency assessment (2026-10-06): wholesale lossless tier loading does not meet the budget.
  Approved full RGBA+mips = 835,971,548 B; eight eligible field looks = 83,402,304 B. Adding only one
  close page for each look already reaches 241,074,464–258,639,136 B before ~27.96 MB ground/info textures,
  render targets and other scene allocations. Current loader omits pending/decode/batch peaks and eviction.
  Next justified experiment: approved-manifest page-demand/transition admission estimator on Actions,
  with source hashes, name/eligibility binds and total-scene reserves. No encoding or runtime change yet.
- Source survey with pictures and licenses per object (Smithsonian 3D Open Access, MakeHuman/MPFB,
  Quaternius, Poly Haven, Kenney, LoC) -> agent selection and independent visual review.
- Bake job on GitHub Actions (Blender headless, dev only): model -> sprite atlas with baked light ->
  optimised texture in the repo; `tools/bake-sprites.mjs`; `src/units/impostor.js`.
- Candidates into the sandbox Look tab, split-screen against UG: Civil War / Total War references:
  figures, horses, guns, trees, buildings, terrain detail, grade, effects (artillery impact, charge and
  melee, cinematic moments, X-Factor banner), unflinching casualties with the gore toggle.
- Low/High/Ultra; 1 figure = 5 men must hold 30 fps in a fight on Auto on the UHD 617, else 1:10.

## S3 · Screens gallery
Static pages: brigade card, camp table with Requisition drawer and living backdrop, loot reveal, level-up,
badge ceremony, after-action, title; three UI styles (period desk / clean modern / hybrid), modern sans,
touch-sized targets, baked card art.

## Lock
Quality gates on: locked-look reference screenshots, frame-rate floor, order-obedience tests, balance robot.

## R3 · Shiloh in phases
- Battle pack format `battles/<id>/`: terrain, OOB, phases (starts, arrivals, objectives, enemy opening),
  fly-over stops, after-action text, quotations, citations. `src/world/world.js` and `src/main.js` load a pack.
- OOB and sources from the old repo's `data/shiloh.json`, re-verified (2 sources per fact; no invented names).
  Proposed phases, to be checked: dawn attack on the camps; Hornet's Nest; Grant's last line (first Army of
  the Ohio brigade lands); day-2 counterattack.
- New-player opening fight, regiments visible, sourced AI temperaments, terrain play, phase carry-over,
  three save slots, fly-over briefing, after-action with map replay, Battles menu, title diorama,
  difficulty levels, sound (howler.js, CC0/PD recordings), historical thread.

## R4 · Camp, thin slice
`src/franchise/` (`ovr.js`, `loot.js`, `badges.js`, `shop.js`, `reputation.js`, `enemy-army.js`, `save.js`,
`tuning.js`), `src/ui/` (`camp.js`, `card.js`, `loot-reveal.js`, `record.js`). Weapons loot, cards, 6 badges,
arms-only shop, reputation 1-3, Shiloh decision cards. Data with citations from the old repo's
`weapons.json`, `artillery.json`, `ratings.json`, `loot-survival.json`. Future hooks stored from the start
(dates, quantities, coordinates, standing with Washington).

## R6 · Chattanooga, R5 · Stones River
Source-verified phase list, battle pack, AI openings. Franchise fill-in alongside: all 20 badges with tiers and
X-Factors, stores, depot limit, uniques, training and army upgrades, slots and re-rolls, reputation to 10,
enemy badges, record book. Chattanooga ends v1: campaign grade, agent-selected name, tag and Release.

## Later
Endgame (medals, achievements, challenge phases, New Game Plus), sandbox battle; officers and the
Confederate franchise; Eastern campaign; strategy map and President; fog of war, weather, codex, gamepad,
text scale, key rebinding.

## Tools (all OSI or CC0; licenses checked through the GitHub API when vendored)
| Status | Tool | License | Why |
|---|---|---|---|
| in | three 0.186.1, yuka, three.quarks, d3-delaunay, detect-gpu, lil-gui (dev) | MIT / MIT / MIT / ISC / MIT / MIT | engine, steering, smoke, parcels, GPU tier, tuning |
| in (tests) | playwright, pixelmatch, @axe-core/playwright | Apache-2.0 / ISC / MPL-2.0 | smoke, visual diff, accessibility |
| S1/R3 | goldfire/howler.js | MIT | recorded, positioned sound; replaces ZzFX |
| art | Blender on Actions (dev, never shipped) | GPL | bake sprite atlases |
| art | donmccurdy/glTF-Transform (dev) | MIT | shrink models before baking |
| art | MakeHuman / MPFB (dev; exported humans CC0) | AGPL tool, CC0 output (confirm) | realistic bodies and faces |
| S3 | an SIL OFL sans, self-hosted | OFL | UI type |
| R3 | jrnold/acw_battle_data | BSD-3 code / CC-BY text | battle spine; verify provenance |

Rejected or deferred (unchanged): agargaro/instanced-mesh, proj4js, pmndrs/postprocessing, three-mesh-bvh,
troika-three-text, three-geo, playwright-mcp (reasons in DECISIONS 0006 and git history).

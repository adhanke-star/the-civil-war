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
one-minute introductory playthrough or native-device proof. P2a `fbd4c91` failed Linux weapon-name
readability in CI 37489994912; repair `d228fb91c6c2e364d2204024e1c6e1b0b3d50bee` passed CI
37491741829 and Pages 37491741950. Equipped names wrap; condition/history each have their own row.

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
Henry Hill practice as a distinct route, historical no-loot isolation and all P1/P2a recovery rules. Saved
equipment deployment, camp and the full title/campaign path remain open; P2a does not certify them.

### P2b: introductory fight and field crates (implemented 2026-10-06)

Final combined native full smoke: 125/125, 232973 ms, timestamp 2026-10-06T16:26:07.649Z; retained
.out/p2b-full-native-final-20261006.json. Actual UHD617 ANGLE Metal instructed play revealed a first
card in 47337 ms; unopposed idle play lost ground at 27.2803 simulation seconds. No forced play state.
Capture 6+6, intro 7+7, outcome 9+9 and reward/save 21+21 positives/intended mutants pass. Five final
intro PNGs including 320px briefing and scoped axe are reviewed. A prior full software run failed
immediate keyboard ordering (123/124, 727018 ms); synchronous select refresh fixes the real disabled-
button race, with immediate software readback and final full native proof. Minor hint/flag overlap
remains HUD polish. 4a4a4adb1f6ec695b3329d9298e7a5080b5bca80 passed CI 37496336886 and Pages
37496336828; no Auto/1:5/full-battle or iPad certification.

Default entry shows a short labelled fictional practice briefing; Continue starts two generic Union
brigades against one approaching Confederate brigade on reused Henry Hill terrain. Original Henry
Hill remains `?practice`; `?battle=henry-hill` and `?sandbox` retain original rosters/no progress awards.
Use the same combat constants on both sides. A 45-simulation-second hold challenge gives a first reward
about a minute after Continue at default 1x; record actual wall time and simulation time, without forced
clock/casualty/rout fixtures for introductory play acceptance. Losing the held ground or all brigades
must produce defeat; do not script a win. Three contextual hints cover selection, drag march and loot.

Preplaced generic practice stores are explicit fictional held-ground drops. Reuse the frozen old
exclusive-presence objective rule: living non-routing troops only, any opponent contests, no majority
capture. Two continuous seconds of exclusive presence captures/retakes; empty/contested ground resets
pending acquisition but retains the previous owner. Final contested crates grant no loot. Rewards come
once from unique finally owned crate records, never from the number of capture events; defeat may keep
uncontested stores still owned. No battery/wagon/surrender capture claim in this slice (P3 remains open).
Markers show rarity colour plus distinct shape/name, ownership/contested words, a top-strip counter and
capture cue. No in-fight card rolls. Freeze ownership with the same terminal army; fight-on cannot rebase.

Owned seams: new modules in existing src/franchise and src/ui, scenario selection in main, Game's
capture tick and generic practice objective text, index/HUD, existing practice result model/UI, focused
Node/browser tests, CI and SW version. Do not change combat constants, Henry Hill data, art/renderer,
settings locks, historical sources or P1's atomic envelope. One writer; serialize browser work.
Gates: syntax/diff; field-capture positives and named assertion-rejecting mutants; retained reward and
outcome positives/mutants; unit; actual fresh Continue/select/drag/fight/capture/loot/save/reload UI with
measured elapsed time, separate contested/retake/no-duplicate tests; keyboard/touch/axe/screenshots;
independent source and WCAG/play review; final npm test, docs, commit/push and exact-SHA CI/Pages.
P2c must still introduce camp/title defaults and resolve complete sandbox/flow scope before full P2 closes.

### P2c: lightweight title and completed-army camp (implemented 2026-10-06)

Focused 46/46, 24310 ms, 2026-10-06T16:50:56.481Z; title 200135 B/211 ms, no field assets or renderer.
Title/camp/import axe clear; seven actual screenshots independently reviewed, full names and accessible
depot details verified. Deferred-read overlap and failed-A/cancelled-B/retry-consent controls pass;
legal 200-formation/2000-item snapshot renders only 12+12 cards. Final native full smoke 157/157 in
250152 ms, 2026-10-06T16:52:57.328Z; .out/p2c-full-native-final-20261006.json. Title 200125 B/493 ms,
first real introductory loot card 47606 ms, idle defeat 27.30 sim seconds. f6edce7469944bf378b24f93e9e132d3d9c2aa46
passed Pages 37500375379, but CI 37500375376 failed the immediate post-Escape focus assertion and
next hidden-file upload (140 checks, 547941 ms). Queued dialog-close cleanup was still pending;
the test now waits for closed dialog, enabled Import and restored focus. A delayed-close notification
fixture passes software focused 46/46 in 29950 ms, 2026-10-06T17:14:52.370Z. Repair
2bf8f8030e856c6e5f097dbd17b1bbf80c06d729 passed CI 37502279679 and Pages 37502279685. This
static readback does not close living camp/title, editable inventory, deployment or the rest of P2.

Use the existing completed-reward store and card renderers; no second store or campaign schema.
No-query entry loads a lightweight title, with one Continue: successful empty read -> ?intro;
validated saved army -> camp. Blocked/corrupt reads show retry/import, never silently start a fresh army.
Explicit ?intro, ?practice, ?battle=henry-hill and ?sandbox still boot the field; reward.html remains
the explicit sample reward workbench. After successful practice saving, Continue opens camp.
Camp reads actual brigade equipment/ratings and full depot names/rarity/condition/provenance, retains
depleted identities and pages bounded sets so a legal 200-brigade/2000-item export cannot flood the DOM.
Title/camp entry, reload and export must not roll loot, duplicate an award or write progress/preferences.
Import uses the existing strict validator and atomic replace, explicit Cancel-focused confirmation,
failed-import/blocked-read/quota recovery and real file export/import. No editable issue/requisition,
saved-gear deployment, phase/campaign slots or full living diorama claim in this readback slice.

Clean modern is the reviewed default: three matched existing card-style screenshots were compared
independently; clearest OVR/identity hierarchy and coherent battle HUD. Keep other sandbox styles and
stored preferences/locks. Reuse full static item cards, not truncating compact tray names/conditions.
Title/camp must stay around 5 MB/10 s without terrain, three.js, effects or soldier-atlas requests.
Check fresh/saved/error/reload/depot/pagination/file transfer through real UI, exact stored bytes,
keyboard/focus/48px targets, 320/1024 screenshots and scoped axe. Keep all P1/P2a/P2b positives/mutants;
run syntax/diff/unit, one full local smoke, independent source/WCAG/play review, explicit commit/push
and exact-SHA CI/Pages. Complete sandbox/default/deployment scope remains accounted for before P2 closes.

### P2d: sandbox veterancy and remaining rule multipliers (implemented 2026-10-06)

Actual Game/Combat/settings positives 12/12 and intended rejecting controls 12/12 pass, including
composed melee-then-fatigue recovery. Native focused UI 39/39 in 52899 ms, 2026-10-06T17:12:40.035Z;
.out/p2d-focused-final-20261006.json and five reviewed PNGs. Both-side Elite placement/Hold, reset,
live rule sliders, lock/transfer/reload and exact progress/roster preservation pass; terminal fixture
calls the actual sandbox result controller and proves no award/write. Narrow targets >=44px, scoped
axe and console clear. Initial absent-controller assertion was vacuous; controller-state/terminal
checks replace it. Final native full smoke 169/169 in 274447 ms, 2026-10-06T17:18:14.463Z;
.out/p2d-full-native-final-20261006.json. First actual intro card 48078 ms; idle defeat 27.33 sim seconds.
Independent source/WCAG review clears this bounded candidate. 2d761dbd21c4aad797624d37cd63527ca5827581
passed CI 37503374519 and Pages 37503374677.
Incidental baseline FPS wording infers causation from uncontrolled samples; correct the wording in
the next Look slice rather than treating these readings as measured costs of scalar combat rules.

Add Next brigade's veterancy (Green/Trained/Veteran/Elite = existing xp 1..4) through the existing
Units registry and Game.spawnUnit. Omitted xp remains 1; invalid xp rejects before reserve/counter/
roster mutation. Both sides use the same construction path and generic labels; historical rosters
and already placed brigades are untouched. This is placement, not earned campaign advancement.
Charge effect scales existing melee casualty rates on both sides, including defenders; preserve
ratios, random draws, ordering and caps of available men and 4% of initial strength per sim second.
Fatigue gain scales positive march/run/rout/charge/melee gains only; rest/firing recovery and 0..100
bounds stay unchanged. Both multipliers use the existing 0.5..2, step .05, default 1 registry.

Like existing march/fire/morale choices, persisted rule settings apply to subsequent practice too;
this is explicit player tuning, not a hidden side/difficulty bonus or an anti-cheat boundary. Practice
award eligibility remains the existing route/roster contract. Sandbox/historical routes still grant
no progress; original practice roster xp stays unchanged. Do not claim arbitrary rule alterations
are rejected by practiceOutcome. P1 save schema, art, history, reward balancing and campaign stay out.

Gate actual Game/Combat prototypes with deterministic fixtures and matching assertion-rejecting
controls: both-side/default/invalid placement, live veterancy effect, charge symmetry/default/caps,
all fatigue gains, unchanged recovery/bounds and registry clamp/lock/reset/transfer. Actual UI must
place/control both sides at selected xp, exercise real sliders/Reset/Lock/Copy/Paste and reload,
preserve progress bytes, show readable notes/keyboard/focus/touch-sized controls, and pass scoped
axe/screenshots. Keep existing positives/mutants, unit and final native full smoke, independent source/
WCAG review, docs/commit/push and exact-SHA CI/Pages. This does not close remaining Look/Moments,
soldier's-eye/division selection, deployment, living camp or full P2.

### P2e: existing post grade, tilt-shift and smoke controls (implemented; CI fixture repair)

Actual Post/Effects/quarks positives 10/10 and ten intended mutants pass, including in-place target
resize rejection. Focused native 56/56 in 81327 ms, 2026-10-06T17:35:54.647Z; retained
.out/p2e-focused-final-20261006.json and six look PNGs. Saturation/tilt change 95.87%/12.14% of 52608
sampled pixels; Reset restores zero changed pixels, target UUID/dimensions/canvas and nine textures.
Space switches smoke off; existing particles clear, pre-disable timers remain cancelled after on,
real reduced-motion changes compose with the preference. Exact saved progress/zero writes, transfer,
reload, 320px >=44px controls and scoped axe pass. First fixture failure is retained separately;
it assumed Paste respected locks and compared asymptotically eased camera floats byte-for-byte.
Product behavior was correct. Explicit Paste may replace locked values; a supplied locked: line
restores its comma-delimited lock set. Independent focused source/WCAG review clears the candidate.
Final native full smoke186/186 in300516ms,2026-10-06T17:37:39.593Z, retained
.out/p2e-full-native-final-20261006.json and six full-run look PNGs. Default-on fight produces real
casualties and eight puffs; actual intro first card48195ms, win45.50sim/idle defeat27.28sim. Full-run
Reset again changes zero sampled pixels; all old save/flow checks pass. Independent final source/WCAG
review read the receipt and all six exact full-run PNGs; no bounded blocker. Commit2a9f86af3c168b8c3de5c85a5efa45443c454874
passed Pages37505846093; CI37505846001 failed only the before/after paused-camera state comparison,
with restored pixels0/52608. Retain .out/p2e-ci-37505846001.zip and -result.json. Slow frame cadence
can leave ground-height easing unsettled. Test-only repair settles the existing camera API before
baseline capture and records before/after camera/time/paused state; assertions/limits stay unchanged.
Isolated software proof20/20 serves every P2f-changed runtime file from the exact committed P2e SHA,
injects unsettled ground height and passes real Look UI: .out/p2e-ci-settle-software-proof-20261006.json.
Separate test-only repair48a1f72 excludes P2f runtime/tests; exact CI37508495648 and Pages37508497027 pass.

Register colour saturation, tilt-shift amount and smoke visibility in existing LOOK/settings.
Preserve current saturation .86, tilt .9, center .46, band .24 and fixed exposure .66; no texture,
terrain, lighting, approved pose/atlas or simulation changes. Saturation/tilt update existing uniforms
on construction and live changes, with no target resize/rebuild. Numeric split-screen is not promised.
Smoke defaults on; off/reduced-motion hides and clears existing clouds and suppresses new/scheduled
emissions. Turning on resumes new emissions without resurrecting pre-disable callbacks/clouds.
Preserve sound/casualties and particle pool bounds; visibility does not claim disposal or memory savings.
Use real renderer/particle APIs, verified at runtime. Keep the existing retained smoke-on fight check.
Correct generic FPS warning wording to describe an observed drop without implying a measured causal
cost. Preserve settings Reset/Lock/Copy/Paste/reload and all progress/history/art locks.

Gate actual Post/Effects methods with deterministic positive/intended-rejection tests for initial/live
uniforms/defaults, unchanged target allocation, suppression/clear/delayed callbacks/re-enable/reduced
motion and unchanged sound calls. Real UI must show actual pixel differences at fixed paused view,
unchanged dimensions/texture allocations and saved battle state, smoke on/off/readback, controls/
lock/reset/transfer/reload, keyboard/narrow targets/axe/screenshots and independent visual/source/WCAG
review. Run retained positives/mutants/unit, final native smoke, docs/commit/push and exact CI/Pages.
No iPad/performance/fieldable-art or full P2 claim; spacing/marker/camera behavior remain separately bound.

### P2f: marker dimensions and camera elevation (implemented 2026-10-06)

Reuse LOOK, Hud and RtsCamera; root sole writer. Own src/ui/look.js, src/ui/hud.js/CSS,
src/render/rts-camera.js, focused view tests/tools/test.mjs, CI if needed, sw.js and docs.
Marker size defaults1; scale the existing flag34x30 and bar36x6 through CSS dimensions, keep text
readable and every button >=44x44. Do not transform the entire button: Hud's projected/stacked transform
is authoritative. Invalidate cached m.w/m.h/sizeTimer on changes; newly placed markers inherit the
preference. Preserve ground anchors, stacking/hit rectangles/off-screen behavior, actual click/drag/
keyboard/touch selection and crate rectangle avoidance. No simulation/formation/art/history change.
Rendered review confirmed enlargement exposes upward-only stacking: two Confederate markers visible
at default move offscreen/under the top strip at max. Repair placement within visible bounds with an
alternative nonoverlapping position and a connector to the true projected ground anchor; do not merely
clamp into another marker. Reserve actual visible dock panels and persistent hints too: high-angle
review found a Union marker under Orders. Actual unobscured hit areas/selection of those top markers and intro crate
avoidance at enlarged size are required, in addition to full DOM rectangle dimensions.
Camera elevation offset defaults0, adds to pitchForDist plus existing manual tilt, retains final
pitch clamps. Initial constructor and later zoom/rotate/live preference agree; preserve easing9,
target/distance/yaw, terrain collision protection and near/far limits. Explicit notes explain that a
changed viewing angle can change pointer projection, not simulation coordinates. No split-screen promise.
Pure13+13, focused native78/78 and frozen full209/209 pass. Final .out/p2f-full-native-final-20261006.json
is369695ms/18:21:08.175Z with zero errors/axe; runtime/test source hashes unchanged. Exact nine final
view images plus enlarged-marker intro independently reviewed, clearing top-strip/high-angle Orders
occlusion. Eleven actual tethers have two bound paths; post-dock three flags59.5px avoid both crates.
Real firstcard48045ms/win45.51sim, idledefeat27.22sim; paused progress and settled render resources
unchanged. Integrated13a9ee90215985c9ff437c299a89fffcfacd8948; exact CI37511709837 and Pages37511709840
pass. Bounded source/visual clearance; no device/performance claim.

Before visual edits refresh/view reference shots. Bind actual camera constructor/live/zoom/manual tilt,
clamps/Reset to deterministic positives and intended mutants. Actual UI must prove marker flag/bar
dimensions and cache refresh, selected/new markers, anchor/stack geometry and >=44px hit areas at
min/default/max; camera pitch changes with unchanged target/distance/yaw/paused unit state, real zoom-
to-cursor and touch pinch anchors, fly-to/minimap footprint, unchanged progress/art/resources; settings
locks/explicit Paste/reset/reload, keyboard/320px axe/screens. Preserve all old controls and gates.
Run syntax for each owned module, git diff --check, all retained reward/outcome/capture/intro/sandbox/
Look positives+intended mutants, unit, focused native view, frozen final native smoke with receipt/PNG
readback, independent source/WCAG/visual review, docs sync, explicit commit/push and exact CI/Pages.
Red CI takes priority. Formation spacing, soldier's-eye, Moments/X-Factor, saved deployment/living camp
and complete P2/P3-P7 remain separate; no device/performance/approved-art fielding claim.

### P2g: shared infantry formation spacing (implemented 2026-10-06; CI fixture repair)

Pushed39cc6175469a5d402dc394eee8c0a0cb6f4116fb; Pages37515738423 passed. CI37515738493
passed222/223; only Reset ghost readback failed after a fixed200ms wait. The software renderer had
not refreshed existing ghosts despite reset unit frontage. Test-only repair waits two real frames,
preserving runtime/assertions/tolerances. Software30/30 in130987ms,19:20:42.479Z, retained
.out/p2g-reset-frame-software-proof-20261006.json: actual216.200013/216.200007 vs216.2,
unchanged9textures/26geometries, zero progress writes/axe/errors. Independent source/receipt clear;
native224/224 remains bound to unchanged runtime. Repair exact-SHA CI/Pages required before P2h.

Reuse LOOK/settings and Unit's existing layout; no new store or renderer. Root owns src/ui/look.js,
src/units/unit.js, src/game.js, src/ui/arrows.js, meaningful spacing Node/UI tests, tools/test.mjs, CI, sw.js and docs.
Default1 must preserve existing geometry exactly; range.75..1.5/step.05 scales infantry file/rank,
skirmisher lateral/forward/stagger and column lateral/trail-resampling offsets. Keep random jitter,
minimum footprint/picking/column safety padding and independent officer clearance unchanged except
the rank-spacing component. Batteries/guns/crews and fixed brigade-centre group offsets remain unchanged.
This is a game calibration: footprint, picking, fire/melee contact and destination ghosts follow actual
spacing; do not label it combat-neutral or sourced historical spacing. Figure size/count/identities,
RNG state, men, weapon/xp/ammo/morale/fatigue and casualty/speed coefficients remain unchanged.
Live changes re-layout existing infantry and snap living figures into the changed slots even paused;
fallen remain at exact positions. Never rebuild/reroll figures. Orders/path/facing/anchors remain exact.
New placements and reload use saved spacing. Existing 1:5 vs1:10 frontage behavior is unchanged.
Existing destination ghost cache includes infantry spacing: a150-man .80->.85 change shares rounded
halfFront7 but must update actual ghost13.16->13.9825. Bind cached updates, not only fresh geometry.
Pure13+13, strengthened focused native31/31 and frozen full native224/224 pass; final receipt
.out/p2g-full-native-final-20261006.json is371000ms/18:51:40.872Z with errors[]/all scoped axe[].
Eight frozen source hashes match. Fixed-view9textures/26geometries unchanged; actual rotated group
preview324.3m/destinations and Reset216.2m match orders. Browser has0fallen; nonempty pure death
fixture proves exact fallen preservation. Pre-reload progress unchanged/zero writes. First card47710ms,
instructed win45.44sim/idledefeat27.26sim. Independent final source/receipt and all five spacing plus
intro crate images clear. Exact committed-SHA CI/Pages still required.

Bind actual line/skirmisher/column slots and footprints at min/default/max, live same-formation refresh,
true picking boundary, lineHalfFront in column and matching actual ghost geometry, unchanged batteries,
identities/fallen/paused states/settings/progress. Exercise normal group-order preview and confirmed
rotated destinations; preserve relative centre offsets even when larger neighboring formations overlap.
Use actual movement through automatic column and redeployment with the scaled slots, not a label-only
fixture. Actual UI slider/Reset/Lock/Copy/Paste/reload/new spawn, keyboard,320px targets/axe/screens and
render resources must pass. No physical iPad/performance/art claim from those observations.
Before edits refresh/view references. Run node --check for every owned module, git diff --check,
spacing positives and per-invariant intended mutants, retained reward/practice/captures/intro/sandbox/
Look/view positives+mutants, unit, focused native spacing and frozen full native npm test; inspect
actual JSON/PNGs, independent source/WCAG/visual review, update docs, explicitly stage/commit/push,
read fullSHA CI/Pages and repair red CI before the next slice. Moments/X-Factor, soldier's-eye/full
keyboard/division selection, deployment/living camp and all P3-P7 scope remain open.

### P2h: isolated loot and X-Factor previews (next bounded slice)

After P2g exact CI/Pages, finish the missing field Moments previews using existing settings, Effects,
HaloPool/Hud and reward sequence. Root owns those seams, src/main.js/ui/sandbox-tools.js, meaningful
Node/UI tests, CI, sw.js and docs; no new progress store, art pipeline or combat multiplier.
Add a clearly labelled selected-unit X-Factor preview with a short banner, sound sting and warm line
glow, plus a Full/Subtle/Off setting. This is a presentation preview, not an earned Gold badge or
combat bonus; earned conditions/progression remain P5. Reduced motion uses a static toned-down cue;
Off clears active cues and queued sound. Existing sound mute remains authoritative. Repeated triggers
replace/refresh bounded effects without growing geometry/textures, stealing focus or blocking orders.
Presentation time advances while paused; unit identities, centres/orders/stats/RNG/progress stay exact.
The future earned-X-Factor path must reuse the same effects seam without making sandbox previews count.

Expose one loot-card preview from the field using mountReward(mode one) and an explicit close lifecycle.
Pause the field, use native modal focus/inert behavior, Close/Escape return to the triggering control,
dispose listeners/timers exactly once, and keep the field paused. The preview rolls demonstration loot
only; it cannot complete/replace/import an army, issue a card, award a badge or write cw.progress.
Refuse while an existing reward/result modal is active; opt out of global replay-host/callback memory
so a removed preview dialog cannot become a replay target or inherit a completed-army callback.
Keep current practice-result/replay handling and the separate reward workbench intact. Preserve exact
prior completed progress and settings/locks across repeated open/close, mid-animation Escape and reload.

Before visual edits refresh/view references. Bind the actual effects/halo attributes and the isolated
reward lifecycle, repeat/expiry/off/reduced-motion/mute, real keyboard/pointer preview controls,
320px targets/axe, modal focus containment/restoration and zero progress writes before any reload.
Run all changed syntax/diff checks, focused positives+intended mutants, retained deterministic gates,
focused native UI and one frozen full native npm test; read actual JSON/PNGs and independent source/
WCAG/visual review. Update docs/decision, explicitly stage owned files, commit/push and read exact-SHA
CI/Pages; repair red CI. This does not close earned badges/X-Factors, cinematic charge/melee polish,
soldier's-eye/fullkeyboard/division selection, campaign/deployment/art/device work or all remaining P2-P7.

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
National/regimental flags need source and rendered verification too: current Hud usFlag creates
4x5 stars while its own comment says34. Record this existing mismatch; P2g does not repair flag art.

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

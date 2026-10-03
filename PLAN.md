# PLAN — build order for "One Army, One War" (design: DESIGN.md; decision: DECISIONS 0013)

Status: M0 shipped (v0). M1 (Henry House Hill) is playable on Pages and becomes the practice field and
sandbox ground. Every step ends with CI green, the Pages link working, a five-line note to Aaron with
3-5 things to try, and a short "how games do this" lesson. Popups only for choices that change what
Aaron sees or plays.

## Order
1. **S1 · Sandbox: feel + reward sequence** (first build, Mac + iPad)
2. **Art track** (starts alongside S1; the battlefield look is the top polish priority)
3. **S3 · Screens gallery**
4. **Lock**: every sandbox topic locked by Aaron; quality gates switched on
5. **R3 · Shiloh** -> **R4 · Camp (thin slice)** -> **R6 · Chattanooga** -> **R5 · Stones River**
6. Endgame set, sandbox battle, then post-v1 (officers and Confederate franchise first)

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
- Review: Aaron plays on both devices and pastes the Copy-settings block; those become defaults.

## Art track
- Source survey with pictures and licenses per object (Smithsonian 3D Open Access, MakeHuman/MPFB,
  Quaternius, Poly Haven, Kenney, LoC) -> popup: hero-model route.
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
Phase-list popup, battle pack, AI openings. Franchise fill-in alongside: all 20 badges with tiers and
X-Factors, stores, depot limit, uniques, training and army upgrades, slots and re-rolls, reputation to 10,
enemy badges, record book. Chattanooga ends v1: campaign grade, name popup, tag and Release.

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

# PLAN — weekly milestones (each one playable)

Status: M0 shipped (v0); M1 playable on Pages, not yet tagged (STATE.md lists the gaps). Every milestone ends with: CI green, the GitHub Pages link working, a `vN`
Release, and Aaron able to play it.

## M0 · Pipeline proven (2026-10-02)
Public repo, scaffold, import map with three.js 0.186.1 plus Yuka, three.quarks and ZzFX vendored,
CI (Playwright smoke + axe), Pages deploy, `play.command`, `.out/` auto-pruned.
**Play:** one regiment of about 200 figures marching in line on a painted-colour field, with musket
smoke and a volley sound.

## M1 · First Bull Run vertical slice — looks like UG:G, plays (week of 2026-10-05)
M0 shipped a non-interactive demo, which Aaron judged "awful and doesn't work". M1 must clear the
AGENTS §1b bar on a small part of the field: Henry House Hill to Matthews Hill.

- Painted terrain from USGS 3DEP elevation (geotiff.js + martini), with field parcels, roads, fences,
  woods, the stream and 3D farm buildings.
- Ground labels; tilt-shift and colour grade.
- Two brigades per side as hundreds of instanced soldiers (instanced-mesh) in loose ranks, with flag
  markers.
- Select and drag-order with curved arrows; Yuka steering keeps formation.
- Fire, smoke, casualties and morale (simple v1).
- The UG:G HUD layout.
- OOB, names and places come from the old repo (`data/bullrun.json`, `src/tactical/T1-bull-run.js`).

**Play:** order a Union brigade up Henry House Hill against Jackson and watch the fight.

## M2 · The fight (week of 2026-10-12)
- Fire, casualties, morale, charge and rout, ported from the old Field rules: one universal combat
  model, no per-battle fudge.
- Smoke and sound tied to fire.
- Objective: hold or take Henry House Hill.
- AI v1 (Yuka goals).
- After-action summary.

**Play:** a real small fight you can win or lose.

## M3 · The whole battle (week of 2026-10-19)
- The full sourced First Bull Run OOB, ported and re-verified.
- Timed arrivals (Jackson; Kirby Smith and Early on Chinn Ridge).
- Officers, ammunition and teaching cards.
- After-action compared with the history.

**Play:** First Bull Run start to finish.

## M4 · Look and feel (week of 2026-10-26)
- Figure animation, smoother formations and painterly v2.
- HUD/UX polish, accessibility pass (keyboard, colour-blind safe), and a measured performance budget
  on this Mac.
- Gamepad (browser Gamepad API, no library; target a DualShock 4 over Bluetooth): left stick moves a
  cursor, right stick turns/tilts the camera, L2/R2 zoom, D-pad pans; X selects, hold X on your own
  brigade and steer to draw the order arrow (same path as a mouse drag); Square Hold, Triangle Charge,
  Circle Fallback, R1 Run, L1 Halt; Options pause, Share help sheet. Dead zones, cursor acceleration, a
  pad hint in the help sheet on `gamepadconnected`; mouse and keyboard keep working. CI injects a fake
  pad in Playwright to exercise select + order.

**Play:** the same battle, now beautiful.

## M5 · Second battle and battle menu
Gettysburg Day 1 or Wilson's Creek, plus a battle-select screen.

## Later
Campaign link between battles, more battles, codex and documents, Confederate side, save/load.

## Tools queued by milestone (all OSI or CC0; licenses checked through the GitHub API on 2026-10-02)
| Milestone | Tool | License | Why |
|---|---|---|---|
| M0 | three 0.186.1, yuka, three.quarks, zzfx; playwright, pixelmatch, @axe-core/playwright | MIT / MIT / MIT / MIT; Apache-2.0 / ISC / MPL-2.0 | scaffold + tests |
| M1 | geotiffjs/geotiff.js | MIT | read USGS 3DEP elevation into heights |
| M1 | proj4js/proj4js | MIT (LICENSE.md; API shows NOASSERTION, so confirm) | georeference LoC maps to the DEM |
| M1 | mapbox/martini | ISC | low-triangle adaptive terrain mesh |
| M1 (in, 6.0.4) | d3/d3-delaunay — https://github.com/d3/d3-delaunay (+ mapbox/delaunator 5.1.0 ISC, mourner/robust-predicates 3.0.3 Unlicense) | ISC (gh api 2026-10-02) | relaxed Voronoi field parcels split by roads and streams |
| M1 (in, 0.21.0, dev only) | georgealways/lil-gui — https://github.com/georgealways/lil-gui | MIT (gh api 2026-10-02) | look-tuning panel, loaded only with ?tune |
| M1 (in, 5.0.70) | pmndrs/detect-gpu — https://github.com/pmndrs/detect-gpu | MIT (gh api 2026-10-02) | GPU tier picks Auto quality's starting level; benchmark JSON vendored, no CDN |
| M1 | agargaro/instanced-mesh | MIT (peer three >=0.186) | thousands of soldiers with culling and LOD |
| M1 | donmccurdy/glTF-Transform (CLI, dev only) | MIT | shrink models and textures before they enter the repo |
| M1/M4 | KittyGiraudel/a11y-dialog, @floating-ui/dom, color-js/color.js | MIT | accessible menus, tooltips, CVD-safe palettes |
| M3 | jrnold/acw_battle_data | code BSD-3 / text CC-BY, data unlabelled | battle and commander spine; attribute it and verify each file's NPS provenance |
| any | Kenney, Poly Haven (download from the websites, not their GitHub repos) | CC0 | textures, trees, buildings |
| dev | ChromeDevTools/chrome-devtools-mcp | Apache-2.0 | console and performance traces from the real page; use a throwaway profile |

Rejected or deferred:
- agargaro/instanced-mesh: not needed at ~1,250 figures; conflicts with GPU walk/aim animation (DECISIONS 0006).
- proj4js/proj4js: not needed for a 2.6 km local frame (DECISIONS 0006).
- pmndrs/postprocessing: the custom 4-pass chain in src/render/post.js already does tilt-shift, grade and vignette cheaply on the UHD 617.
- gkjohnson/three-mesh-bvh: picking is a heightfield ray-march and markers are DOM buttons; nothing needs a BVH yet.
- protectwise/troika-three-text: ground names are painted once into canvas textures; no runtime SDF text needed.
- three-geo (needs a Mapbox token); three.js r128-era libraries; third-party skill aggregators
(no confirmed license, and a skill runs with shell rights); playwright-mcp (duplicates the test kit at
high token cost).

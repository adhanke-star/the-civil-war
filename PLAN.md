# PLAN — weekly milestones (each one playable)

Status: M0 in progress. Every milestone ends with: CI green, the GitHub Pages link working, a `vN`
Release, and Aaron able to play it.

## M0 · Pipeline proven (2026-10-02)
Public repo, scaffold, import map with three.js 0.186.1 plus Yuka, three.quarks and ZzFX vendored,
CI (Playwright smoke + axe), Pages deploy, `play.command`, `.out/` auto-pruned.
**Play:** one regiment of about 200 figures marching in line on a painted-colour field, with musket
smoke and a volley sound.

## M1 · The ground at First Bull Run (week of 2026-10-05)
- A public-domain 1861 Bull Run period map (Library of Congress), georeferenced and draped on terrain
  built from free USGS elevation data.
- Painterly post-process v1. Named landmarks: Henry House Hill, Matthews Hill, Stone Bridge, Sudley
  Ford, Chinn Ridge.
- A camera that feels like UG:G.
- Two brigades per side: select, drag to march and face, line or column, Yuka steering with formation
  slots.

**Play:** maneuver real brigades on the real field.

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
| M1 | agargaro/instanced-mesh | MIT (peer three >=0.186) | thousands of soldiers with culling and LOD |
| M1 | donmccurdy/glTF-Transform (CLI, dev only) | MIT | shrink models and textures before they enter the repo |
| M1/M4 | KittyGiraudel/a11y-dialog, @floating-ui/dom, color-js/color.js | MIT | accessible menus, tooltips, CVD-safe palettes |
| M3 | jrnold/acw_battle_data | code BSD-3 / text CC-BY, data unlabelled | battle and commander spine; attribute it and verify each file's NPS provenance |
| M4 | pmndrs/detect-gpu | MIT | automatic quality tier |
| any | Kenney, Poly Haven (download from the websites, not their GitHub repos) | CC0 | textures, trees, buildings |
| dev | ChromeDevTools/chrome-devtools-mcp | Apache-2.0 | console and performance traces from the real page; use a throwaway profile |

Rejected: three-geo (needs a Mapbox token); three.js r128-era libraries; third-party skill aggregators
(no confirmed license, and a skill runs with shell rights); playwright-mcp (duplicates the test kit at
high token cost).

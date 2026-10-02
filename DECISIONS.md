# DECISIONS (newest first; one short entry each)

## 0006 — Plain InstancedMesh; no proj4js (2026-10-02)
Soldiers use plain THREE.InstancedMesh with a patched Lambert shader (walk/aim/flash animated on the
GPU from per-instance attributes), not agargaro/instanced-mesh: its texture-packed matrices fight that
vertex animation, and ~1,250 figures x ~90 triangles is about 110k triangles in 4 draw calls. proj4js is
not needed: the map is a 2.6 km equirectangular local frame (under 0.1% scale error).

## 0005 — Combat model ported from the old Field rules, with fixes (2026-10-02)
src/sim/combat.js keeps the old formulas (fire T0:802-851, morale T0:927-1023, melee T0:853-919) in
metres, 1 sim s = 4 historical s. Changes: volleys timed by the real rate of fire (3 rounds/min muskets,
2 guns; old weapons.json and artillery.json, Verified); a 65-degree firing arc and terrain line of sight
(so Jackson's reverse slope protects him); rout roll as a per-second rate; symmetric capped melee;
Fallback keeps its face to the enemy; a marching line halts to engage inside 75% of its range.
FIRE_BASE 1.5 and the drains are tuned, not sourced.

## 0004 — Ground: real relief, roads, streams and sites; illustrative fields (2026-10-02)
Relief (USGS 3DEP, x2 vertical), roads (USGS transportation), streams (NHD) and farm sites (NPS POIs) are
real. Field parcel shapes and crops are a seeded patchwork, and woods edges are drawn from Beauregard's
report (OR I/2 no. 84) and the Atkinson map: both Inferred. Labels are canvas-painted, embossed and draped,
not extruded geometry. Flags: US 34-star and the Confederate First National (the battle flag came later).

## 0003 — Gamepad queued for M4; Quality setting in M1 (Aaron, 2026-10-02)
Gamepad via the browser Gamepad API (no library), DualShock 4 mapping in PLAN.md M4, with a fake pad
in CI. M1 gets a Quality control (Auto default / High / Low, keyboard toggle, saved in localStorage):
Auto starts at High and steps the render scale down only after 3 s under ~30 fps, back up over ~50.

## 0002 — M0 shipped (2026-10-02)
Pipeline proven: vendored ESM via an import map; quarks.core needs its own import-map entry; ZzFX
loads on the first click (its audio context starts the moment it loads); the smoke library loads in
a try/catch. Tests: Playwright headless with SwiftShader + axe, with the browser shell installed via
`--only-shell`.

## 0001 — Clean restart (Aaron, 2026-10-02)
UG:G-style real-time battles, one battle at a time; modern three.js in plain JS ES modules; light
process; weekly playable milestones; First Bull Run first; public repo with GitHub Actions + Pages;
local output auto-pruned (8 GB Mac); OSS/free tools only: Yuka, three.quarks, ZzFX,
Playwright/pixelmatch/axe-core. Old project frozen as the parts bin (its D1032).

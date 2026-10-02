# DECISIONS (newest first; one short entry each)

## 0008 — Voronoi fields replace the row patchwork (2026-10-02)
d3-delaunay 6.0.4 (ISC, with delaunator and robust-predicates' orient2d; +53 KB) builds relaxed,
domain-warped Voronoi fields split where roads and streams cross. Side by side with the patchwork and
the UG:G references, the Voronoi fields read as irregular farm parcels (Beauregard: "small open fields
of irregular outline"); the patchwork's straight rows read as tiling. Caveat: a slight honeycomb look
(similar cell sizes). ?parcels=grid keeps the old generator for comparison.

## 0007 — detect-gpu picks Auto's starting level (2026-10-02)
pmndrs/detect-gpu 5.0.70 (MIT) is vendored with its benchmark tables (+703 KB) and called with a local
benchmarksURL, so Pages never touches its default unpkg CDN. Tier 3/2/1/0 starts Auto at render scale
2/1.6/1.3/1; Auto still governs by measured fps (0003). This Mac: tier 1 (UHD 617, 24 fps benchmark),
Auto starts at 1.3 and holds about 43 fps instead of opening at 2.0 near 20 fps.

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
FIRE_BASE 1.5 and the drains are tuned, not sourced. Balance pass (headless 10-minute timelines): losses
drive morale (factor 150; flat under-fire drain 0.12/s divided by cover; firm Hold +0.12/s, defenders
start on it); melee 9 men/s x ratio, capped 4%/s (was ~108/s); player lines march to the arrow's end and
fire on the move at half effect; ammo ~80 volleys, refilled out of contact (>300 m, not under fire).

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

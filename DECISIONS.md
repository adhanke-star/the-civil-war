# DECISIONS (newest first; one short entry each)

## 0015 — Device benchmark waits for its minimum sample (2026-10-05)
CI twice produced only three measured frames in the six-second device benchmark under SwiftShader.
Keep the existing five-frame minimum and extend slow runs up to 30 seconds after warm-up; an
insufficient sample still reports that honestly. A controlled slow-frame check produces five samples
where the old window produces four, and a stalled renderer still reaches the ceiling. Local npm test
passes. This changes only device.html; the new drill-hand bake remains unapproved and unfielded.

## 0014 — Baked soldier on the field; hands to be posed from the drill manuals (Aaron, 2026-10-03..05)
The bake pipeline (branch `bake`: MPFB2 CC0 body + script-built uniform, Blender headless on GitHub Actions,
sprite atlases) is proven, and the second pass is the game's baked soldier (Look tab; rigged figures stay
default). Real GPU, UHD 617, Auto: baked 1:5 holds 40.7/38.7 fps (opening/fight), so 1 figure = 5 men is
affordable. Aaron rejected three hand methods in a row (closing fingers to touch, a per-finger grip solver,
fixed fists keyed to the musket): fingers bent oddly and hands in the wrong spot. Next: collect Hardee/Casey
plates and period photographs, have him approve the target positions, then pose to them with one simple hand
shape on top of pass 3's faces and variants. Sprite budget raised to ~200 MB with a per-battle iPad memory cap.

## 0013 — Redesign: "One Army, One War"; sandbox first (Aaron, 2026-10-03)
About 130 choices made by Aaron in popups are recorded in DESIGN.md, now the design of record. In short: an
army-commander franchise (Union Army of the Ohio/Cumberland) through Shiloh, Stones River and Chattanooga in
15-20 minute phases; Madden cards, 20 tiered badges with X-Factors, Borderlands loot (5 rarities, strong
condition affixes, invented-name uniques labelled as game items), a requisition shop and reputation levels;
spectacle is the top pillar and opening the loot is the core moment. Looks: a realistic diorama judged against
UG: Civil War / Total War, reached by baking sprites and ground on GitHub Actions; 1 figure = 5 men if it
holds 30 fps. Mac and iPad (Pro 12.9 2nd gen, A10X) are both first-class, with touch and an installable web
app. The first build is a sandbox (controls and feel + the reward sequence on placeholder data); every
sandbox topic is locked before campaign work. Supersedes 0009 (4.4x figures, saturated grade), the big
translucent arrows, the UG:G HUD layout and the M2-M5 milestones. Flags raised once: gear-led OVR with 15%
affixes cuts against realism (weights live in one tuning file); the scope is far beyond "finish quickly"
(thin-slice staging; Stones River is the battle that slips).

## 0012 — Welded geometry, an Auto that will not blur for nothing, Sherman faces the battle (2026-10-02)
Profiling on the UHD 617 showed the frame bound by vertex work, not pixels: 2.5M vertices a frame, because
every figure, tree, fence and gun was built from loose triangles; rendering at scale 0.35 was barely faster
than 1.3, so Auto's drop to 0.85 (Low 0.7) only stretched a blurred picture 2.4-2.9x on the retina screen.
Meshes are now indexed (src/render/weld.js; flat facets from screen derivatives, smooth tree crowns), fences
are chunked for culling, a step down that does not gain 8% fps is undone and held 60 s, the final pass
sharpens (clamped to the local range, stronger when upscaled), the tilt-shift sharp band is 19-69% of the
screen, and state halos are one crisp ellipse per man. Real GPU, opening/fight: High 32.9/25.2 (was
30/24.4), Auto 36/44 at scale 1.3/1.0 (was 36.8/33.8 at 0.85), Low 60/57.9 (was 44.5/36.8). Sherman's
brigade started facing 2.4 rad, away from Henry House Hill (Aaron: "facing the wrong way"); now 1.0, and
the test checks every unit starts within 75 degrees of its nearest enemy.

## 0011 — Rigged figures with a baked bone texture; no MSAA (Fable trial, branch figures-detail, 2026-10-02)
Soldiers are a hand-built 12-bone rig (350/228/96 triangles at three distances) animated on the GPU from
one float texture of baked bone matrices (clips keyframed in src/units/figure.js), not a CC0 glTF model:
no loader, no asset to shrink, and the kepi/slouch-hat, pack and musket silhouettes are drawn at the
13-17 px size that UG:G reads at. A back-face outline hull (1 / 0.7 px, none on the far level) gives the
painted-miniature edge. Formation is two dense ranks plus a skirmish screen, column of fours on long
marches (DECISIONS 0009's four loose ranks are superseded). State sits at the feet as halos; bodies are
not tinted. Place names are traced from the system serif and extruded (the three.js typeface JSONs are
MgOpen-licensed, outside the CC0/CC-BY asset rule). MSAA is off at every quality level: on the UHD 617,
2x at scale 0.6 ran 30 fps in a fight where scale 0.7 without it ran 54. Real GPU after the change:
High 30/24, Auto 37/34 (scale 1.3 -> 0.85), Low 46/39 (opening/fight); main was 31/27, 36/36, 46/46.

## 0010 — Graphics, movement and appearance first (Aaron, 2026-10-02)
Before any new gameplay: detailed soldiers and guns (Aaron: the M1 ones are "block blobs"), UG:G-like
movement (two dense ranks with skirmishers, column on roads, wheeling, charge swarm, rout scatter) and the
landscape detail measured in docs/visual-reference.md. Supersedes the four-rank block of 0009. The work is
queued as a Fable 5.1 trial on branch figures-detail (Aaron's routing exception).

## 0009 — UG:G-style scale stylisation (2026-10-02)
After side-by-side review against the UG:G references: figures 4.4x life size in four loose ranks
(one figure = 10 men, so frontage is already ~3x compressed), farm buildings 1.8x, and a darker, cooler
grade with violet corners. Historical formation was two ranks; the deeper block is a readability choice.

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

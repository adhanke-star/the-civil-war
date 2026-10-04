# Attribution

## Code (vendored in `vendor/`, each folder carries its LICENSE)
- three.js 0.186.1 — MIT — https://github.com/mrdoob/three.js
- Yuka 0.7.8 — MIT — https://github.com/Mugen87/yuka
- three.quarks 0.17.1 and quarks.core — MIT — https://github.com/Alchemist0823/three.quarks
- ZzFX 1.4.0 — MIT — https://github.com/KilledByAPixel/ZzFX
- @mapbox/martini 0.2.0 — ISC — https://github.com/mapbox/martini
- d3-delaunay 6.0.4 — ISC — https://github.com/d3/d3-delaunay
- delaunator 5.1.0 — ISC — https://github.com/mapbox/delaunator
- robust-predicates 3.0.3 (orient2d only) — Unlicense — https://github.com/mourner/robust-predicates
- lil-gui 0.21.0 — MIT — https://github.com/georgealways/lil-gui (developer panel, only with ?tune)
- detect-gpu 5.0.70 — MIT — https://github.com/pmndrs/detect-gpu (with its dist/benchmarks GPU tables)
- geotiff.js 3.0.5 — MIT — https://github.com/geotiffjs/geotiff.js (dev tool only: tools/fetch-terrain.mjs; not shipped)

## Data and assets
- `assets/terrain/henry-hill.bin` — elevation from the USGS 3D Elevation Program (3DEP) bare-earth DEM,
  https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer — public domain (US
  federal work). Smoothed and resampled by `tools/fetch-terrain.mjs` (exact request URL in henry-hill.json).
- `assets/terrain/henry-hill.json` roads — USGS The National Map transportation service,
  https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer — public domain.
- `assets/terrain/henry-hill.json` streams — USGS National Hydrography Dataset,
  https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer — public domain.
- `assets/portraits/jackson.jpg` — crop of "Stonewall Jackson.jpg" (derivative of NARA 526067),
  https://commons.wikimedia.org/wiki/File:Stonewall_Jackson.jpg — public domain. Photographed 1863.
- `assets/portraits/sherman.jpg` — crop of "General William T. Sherman - NARA - 527045.jpg",
  https://commons.wikimedia.org/wiki/File:General_William_T._Sherman_-_NARA_-_527045.jpg — public domain
  (US National Archives). Photographed later in the war.
- `assets/portraits/franklin.jpg` — crop of "William B. Franklin - Brady-Handy.jpg" (Mathew B. Brady; LoC
  Brady-Handy collection), https://commons.wikimedia.org/wiki/File:William_B._Franklin_-_Brady-Handy.jpg — public domain.
- `assets/portraits/willcox.jpg` — crop of "Orlando B. Willcox - Brady-Handy.jpg" (Mathew B. Brady),
  https://commons.wikimedia.org/wiki/File:Orlando_B._Willcox_-_Brady-Handy.jpg — public domain.
- `assets/portraits/bee.jpg` — crop of "Barnard Elliott Bee.JPG" (author unknown),
  https://commons.wikimedia.org/wiki/File:Barnard_Elliott_Bee.JPG — public domain.
- `assets/portraits/hampton.jpg` — crop of "Wade Hampton.jpg" (author unknown, wartime carte de visite),
  https://commons.wikimedia.org/wiki/File:Wade_Hampton.jpg — public domain.
- Place positions: NPS Public POIs (MANA) cross-checked with OpenStreetMap/Wikidata/Wikipedia; coordinates
  only (facts), each cited in `assets/scenarios/henry-hill.json`. No OSM geometry is shipped.
- Fonts: none shipped; ground labels are traced from the system serif (Georgia / Times / DejaVu Serif) at
  load and extruded. (The three.js example typefaces were considered and rejected: MgOpen licence, not CC0/CC-BY.)
- Figures, horses, guns, limbers and buildings are procedural geometry built in src/ (no model files), except
  the baked infantryman below.
- `assets/figures/union-infantry/` (soldier_field_0.png, soldier_field_mixed_0.png, soldier_close_0-2.png,
  soldier.json) — sprite atlases of one Union infantryman, second-pass bake, rendered with Blender 4.2 LTS on
  GitHub Actions (branch `bake`, tools/bake, run 37168455918, 2026-10-04; Standard view transform) from a
  MakeHuman/MPFB2 body. The `mixed` field-tier variant wears a slouch hat and the second face, without the
  blanket roll.
  - MakeHuman system assets, CC0 pack — CC0 1.0 —
    https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
    (assets used: skin `young_caucasian_male.mhmat`, eyes `low-poly.mhclo`, eyebrows `eyebrow001.mhclo`,
    hair `short02.mhclo`; second face: skin `middleage_caucasian_male.mhmat`, hair `short04.mhclo`);
  - MakeHuman "bodyparts05" pack (beards and moustaches) — CC0 (the pack page lists every asset in it as
    CC0) — https://files.makehumancommunity.org/asset_packs/bodyparts05/bodyparts05_cc0.zip (mirror on
    files2.makehumancommunity.org), page https://static.makehumancommunity.org/assets/assetpacks/bodyparts05.html
    (asset used: `wdg_scruffy_beard` by WDG, on the second face only);
  - MPFB2 base mesh, targets, rig and weights — CC0 1.0 (MPFB2 `LICENSE.ASSETS.md`, read at v2.0.17) —
    https://github.com/makehumancommunity/mpfb2 (tag v2.0.17).
  - Blender (GPL-2.0-or-later) and MPFB2's code (GPL-3.0-or-later) were build tools on CI only; no GPL code
    is shipped. pngjs (MIT, a devDependency) packed the atlases.
  - The uniform, kit, rifle-musket, poses, loading sequence and lighting are original geometry and settings
    built by the tools/bake scripts, with procedural textures only (no image textures). Their dimensions,
    colours, garment cut, kit layout, loading drill and weathering are **Inferred / placeholder estimates,
    not Verified**; belt and box plates are plain shapes with no lettering. No person, unit or regiment is
    depicted. Confederate infantry are this same sprite tinted grey/butternut in the shader: a
    **placeholder**, not a depiction of a Confederate uniform.

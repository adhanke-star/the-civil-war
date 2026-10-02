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
- Figures, horses, guns, limbers and buildings are procedural geometry built in src/ (no model files).

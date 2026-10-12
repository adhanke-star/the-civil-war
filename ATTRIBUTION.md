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
- KTX-Software 4.4.2 — Apache-2.0 — https://github.com/KhronosGroup/KTX-Software/tree/v4.4.2
  (Actions-only atlas encoder; not shipped). Basis Universal transcoder bundled with three.js —
  Apache-2.0 — https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE
  (Actions compression review; runtime vendoring pending).

## Data and assets
- `assets/terrain/henry-hill.bin` — elevation from the USGS 3D Elevation Program (3DEP) bare-earth DEM,
  https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer — public domain (US
  federal work). Smoothed and resampled by `tools/fetch-terrain.mjs` (exact request URL in henry-hill.json).
- `assets/terrain/henry-hill.json` roads — USGS The National Map transportation service,
  https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer — public domain.
- `assets/terrain/henry-hill.json` streams — USGS National Hydrography Dataset,
  https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer — public domain.
- `assets/terrain/{shiloh,stones-river,chattanooga,lookout-mountain}.{bin,json}` — elevation from the USGS 3DEP
  bare-earth DEM (as above, public domain); streams from the USGS National Hydrography Dataset (public domain);
  roads from the US Census Bureau TIGERweb transportation service,
  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer — public domain (US
  federal work). Modern roads stand in for the period alignments named in tools/terrain-config.mjs (Inferred).
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
    depicted.
- `assets/figures/confederate-infantry/` (soldier_field_0.png, soldier_field_h2_slouch_roll_butternut_0.png,
  soldier_field_h4_slouch_noroll_fadedtan_0.png, soldier_field_h3_cap_roll_greyjean_0.png, soldier_close_0-4.png,
  soldier.json) — sprite atlases of one Western Confederate infantryman, rendered with the same pipeline
  (branch `bake`, tools/bake with SIDE=cs, run 38186582847, artifact bake-cs-34, 2026-10-12). Shipped: the close
  tier's base look and four field looks (grey jean / slouch; butternut / slouch; faded tan / slouch, no roll;
  grey jean / forage cap). Same CC0 sources as above: MakeHuman system assets (skins `young_caucasian_male`,
  `young_caucasian_male2`, `middleage_caucasian_male`; hair `short01`-`short04`; eyebrows `eyebrow001/003/005/007`;
  eyelashes `eyelashes01/02`; eyes `high-poly`), the bodyparts05 pack (beards `grinsegold_beard_sigmund_wip`,
  `culturalibre_faun_beard`, `rehmanpolanski_moustache_viking`) and MPFB2 v2.0.17. Shell jacket cut, jean colours
  (hex values estimated from surviving garments, faded), slouch-hat share (~3 of 4), blanket roll and plain frame
  buckle follow a sourced dress summary (authentic-campaigner.com, adolphusconfederateuniforms.com, NPS Vicksburg
  collection, tools/bake/README.md); colours and cut are **Inferred estimates, not Verified**. No person, unit or
  regiment is depicted.

## Sound and music (`assets/audio/`)
Downloaded once to a scratch folder (never committed), cut and normalised with ffmpeg 8.1: effects mono MP3 96 kbps
(one-shots peak-normalised to -2 dBFS, loops loudness-normalised and made seamless by crossfading the last 2 s into the
first), music stereo MP3 112 kbps at -18 LUFS with short fades. Freesound files are the site's public 128 kbps previews.
Every source below is CC0 1.0 or public domain; no CC-BY item is used. None of the `craigsmith` Freesound items
(digitised studio effects of uncertain provenance) is used. Order calls are labelled in src/audio/bank.js ORDER_CALLS
and in the Settings panel; none is captioned as an 1862 tactical signal.
- `assets/audio/sfx/volley-1.mp3`, `assets/audio/sfx/volley-2.mp3`, `assets/audio/sfx/volley-3.mp3` — CC0 1.0 —
  ragged company volleys mixed here from three single-shot recordings: mlsulli, "Musket Shot",
  https://freesound.org/people/mlsulli/sounds/234869/ (0.62-2.0 s); bruno.auzet, "Old musket bangs, outdoors",
  https://freesound.org/people/bruno.auzet/sounds/538795/ (0.08-2.4 s); fennelliott, "Musket single shot",
  https://freesound.org/people/fennelliott/sounds/347647/ (0-1.9 s, -8 dB). Twelve shots each (seeded delays 0-0.7 s,
  pitch +-12%, -14 to 0 dB), limited, cut to 2.8 s with a 0.8 s fade.
- `assets/audio/sfx/shot-1.mp3` — CC0 1.0 — mlsulli, "Musket Shot", https://freesound.org/people/mlsulli/sounds/234869/
  (0.62-2.0 s). A real musket fired at a performance.
- `assets/audio/sfx/shot-2.mp3` — CC0 1.0 — bruno.auzet, "Old musket bangs, outdoors",
  https://freesound.org/people/bruno.auzet/sounds/538795/ (0.08-2.4 s).
- `assets/audio/sfx/cannon.mp3` — CC0 1.0 — adeluc4, "Cannon fired at a Civil War reenactment",
  https://freesound.org/people/adeluc4/sounds/125348/ (0.15-2.5 s).
- `assets/audio/sfx/shell-burst.mp3` — CC0 1.0 — vabadus, "M406 HE grenade burst on gravel" (a modern grenade, pitched
  down to 72% and low-passed at 3.2 kHz to stand in for a shell burst), https://freesound.org/people/vabadus/sounds/151076/.
- `assets/audio/sfx/fire-bed.mp3` — CC0 1.0 — electra, "Civil War reenactment from a distance" (recorded near Portland,
  Oregon, about 1991), https://freesound.org/people/electra/sounds/442293/ (50-74 s: steady distant musketry; a 22 s loop).
- `assets/audio/sfx/cheer.mp3` — CC0 1.0 — joelcarrsound, massed war cry at a Battle of Hastings reenactment (no words),
  https://freesound.org/people/joelcarrsound/sounds/521831/ (0.15-2.45 s). Used for the cheer as a charge goes in.
- `assets/audio/sfx/call-charge.mp3` — Public domain (US federal work) — "Charge", US Air Force Heritage of America Band,
  https://commons.wikimedia.org/wiki/File%3ACharge_-_Concert_Band_-_United_States_Air_Force_Heritage_of_America_Band.mp3
  (0.9-7.0 s). The standard US service call; answers Charge.
- `assets/audio/sfx/call-attention.mp3` — Public domain (US federal work) — "Attention", US Army Ceremonial Band,
  https://commons.wikimedia.org/wiki/File%3AAttention_Bugle_Call_%28US%29.oga (0.35-4.4 s). A modern US Army call; answers
  a ranged attack order.
- `assets/audio/sfx/call-recall.mp3` — Public domain (US federal work) — "Recall", U.S. Army Bands,
  https://commons.wikimedia.org/wiki/File%3ARecall.ogg (0.2-4.2 s). A modern US Army call, the nearest recording to a halt;
  answers Hold, Halt and Hold fire.
- `assets/audio/sfx/call-retreat.mp3` — Public domain (US federal work) — "Retreat", U.S. Army Bands,
  https://commons.wikimedia.org/wiki/File%3ARetreat.ogg (first phrase, 0.4-4.6 s). This is the modern Army's evening flag
  call, used only as a fall-back cue; it is not the 1862 tactical retreat signal and is never captioned as one.
- `assets/audio/sfx/drum-march.mp3`, `assets/audio/sfx/drum-quick.mp3` — CC0 1.0 (per the Commons page, via the Free
  Music Archive; a US Army unit's recording) — The United States Army Old Guard Fife and Drum Corps, "Reveille Variation /
  Drum Call / Slow Scotch / Quick Scotch / Yankee Doodle",
  https://commons.wikimedia.org/wiki/File%3AThe_United_States_Army_Old_Guard_Fife_and_Drum_Corps_-_09_-_Reveille_VariationDrum_CallSlow_ScotchQuick_ScotchYankee_DoodleMont.ogg
  (drums-only passages 1.0-4.6 s and 101.0-104.6 s, found by spectral flatness: no fife). Rope-tension field drums;
  answer march and run orders.
- `assets/audio/sfx/horse-gallop.mp3` — CC0 1.0 — Max_Headroom, "Horse galloping on hard dry ground",
  https://freesound.org/people/Max_Headroom/sounds/175356/ (0.1-5.7 s, looped).
- `assets/audio/sfx/horse-whinny.mp3` — CC0 1.0 — L.Finck, "Whinnying horse, far away",
  https://freesound.org/people/L.Finck/sounds/636554/ (4.3-6.1 s).
- `assets/audio/sfx/amb-spring.mp3` — CC0 1.0 — rubindaniel, early-spring meadow birdsong with soft wind (Hungary;
  European birds), https://freesound.org/people/rubindaniel/sounds/847380/ (60-92 s, a 30 s loop at -24 LUFS). Spring
  and summer fields.
- `assets/audio/sfx/amb-autumn.mp3` — CC0 1.0 — Globofonia, open field wind, northern Mexico (wind only),
  https://freesound.org/people/Globofonia/sounds/553733/ (20-52 s, a 30 s loop at -24 LUFS). Autumn fields.
- `assets/audio/sfx/amb-winter.mp3` — CC0 1.0 — szegvari, cold winter wind with sparse birds,
  https://freesound.org/people/szegvari/sounds/608269/ (0-32 s, a 30 s loop at -24 LUFS). Winter fields.
- `assets/audio/music/title.mp3` — CC0 1.0 (per the Commons page) — The United States Army Old Guard Fife and Drum Corps,
  "Brandywine Quickstep",
  https://commons.wikimedia.org/wiki/File%3AThe_United_States_Army_Old_Guard_Fife_and_Drum_Corps_-_10_-_Brandywine_Quickstep_from_the_Minstrel_Boy_Show.ogg
  (whole, 112 s, 2 s fade). Fife and drum. Title.
- `assets/audio/music/camp.mp3` — Public domain (US federal work) — "Tenting Tonight on the Old Camp Ground" (Walter
  Kittredge, 1863), US Army Field Band and Chorus, https://commons.wikimedia.org/wiki/File%3ATenting_Tonight_on_Old_Camp_Ground.ogg
  (0-161 s, cut at a pause with a 2.5 s fade so the file stays under 2.5 MB; the last verse is dropped). Camp.
- `assets/audio/music/results.mp3` — Public domain (US federal work) — "When Johnny Comes Marching Home" (Patrick Gilmore,
  1863), US Navy Band Brass Quartet (arr. John Schroeder),
  https://commons.wikimedia.org/wiki/File%3AWhen_Johnny_Comes_Marching_Home_-_Brass_Quartet_-_United_States_Navy_Band.opus
  (whole, 75.5 s). Results.
- `assets/audio/music/lament.mp3` — Public domain (US federal work) — "Nearer, My God, to Thee" (Lowell Mason, 1856), US Air
  Force Band Ceremonial Brass,
  https://commons.wikimedia.org/wiki/File%3ANearer_My_God_to_Thee_-_Ceremonial_Brass_-_United_States_Air_Force_Band.mp3
  (0-148 s, to the end of the playing). Results after heavy losses.
- Reward card sounds (src/reward/sfx.js) stay synthesised (no file).

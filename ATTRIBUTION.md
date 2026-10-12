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
- `assets/icons/` — the app icons (a plain guidon, no text), drawn for this game by `tools/make-icons.mjs`; CC0.
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

## Art (`assets/art/`, P6b)
Card art, period portraits and backdrops. Every file is public domain or CC0; each was cropped, toned and
re-encoded as WebP locally from the original at its source page (originals not kept). Arms: museum backgrounds cut out (or a
tight crop on a dark mount for guns), at most 900 px wide and 90 KB. Portraits: head-and-shoulders crop, one sepia tone,
205×256 px, at most 25 KB. Backdrops: crop and tone, at most 1920 px wide and 350 KB. The list and captions are in
`assets/art/manifest.json`. Smithsonian (NMAH) photographs are tagged PD-USGov-SI on Wikimedia Commons (staff photographs
treated as US government works), not CC0 on si.edu.

### Drawn for this game (CC0)
- `assets/art/arms/generic-rifle-musket.svg` — generic rifle-musket silhouette (used for the Belgian rifle-musket: no public-domain photograph found).
- `assets/art/portraits/generic-officer.svg` — generic officer silhouette (commanders without a sourced portrait).

### Arms
- `assets/art/arms/m1842.webp` (m1842) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Springfield Model 1842 percussion musket (AF*20400), National Museum of American History — https://commons.wikimedia.org/wiki/File:Springfield_Model_1842_Percussion_Musket-NMAH-AHB2015q027141.jpg
- `assets/art/arms/lorenz.webp` (lorenz) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Lorenz Model 1854 rifle-musket, National Museum of American History — https://commons.wikimedia.org/wiki/File:Lorenz_Smithsonian.jpg
- `assets/art/arms/springfield.webp` (springfield) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Model 1861 U.S. rifle-musket (AF*20402), National Museum of American History — https://commons.wikimedia.org/wiki/File:Springfield_Model_1861_Rifle_Musket-NMAH-AHB2015q028583.jpg
- `assets/art/arms/enfield.webp` (enfield) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — British Pattern 1853 rifle-musket made by the London Armoury Company, National Museum of American History — https://commons.wikimedia.org/wiki/File:NMAH-ET2012-13936.jpg
- `assets/art/arms/colt.webp` (colt) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Colt Model 1855 revolving rifle (AF*32763), National Museum of American History — https://commons.wikimedia.org/wiki/File:Colt_Model_1855_Revolving_Rifle-NMAH-AHB2015q026777.jpg
- `assets/art/arms/sharps.webp` (sharps) — Public domain (PD-USGov) — Smithsonian Institution, National Museum of American History — Sharps rifle, Model 1859, .52 calibre, National Museum of American History — https://commons.wikimedia.org/wiki/File:United_States_Sharps_rifle_Model_1859%2C_.52_caliber.png
- `assets/art/arms/spencer.webp` (spencer) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Spencer repeating rifle used by Abraham Lincoln for target practice, National Museum of American History — https://commons.wikimedia.org/wiki/File:NMAH-ET2012-13926.jpg
- `assets/art/arms/henry.webp` (henry) — Public domain (PD-USGov-SI) — Smithsonian Institution, National Museum of American History — Henry rifle, Model 1860, made by the New Haven Arms Company, National Museum of American History — https://commons.wikimedia.org/wiki/File:NMAH-2004-26295-12.jpg
- `assets/art/arms/whitworth.webp` (whitworth) — Public domain (PD-old-100-1923) — Civil War glass negatives, Library of Congress — Modified 12-pounder breech-loading Whitworth guarded by a Federal soldier, Richmond, Virginia, 1865 (Library of Congress) — https://commons.wikimedia.org/wiki/File:Richmond%2C_Virginia._Federal_soldier_guarding_cannon._(Modified_12-pdr._breech-loading_Whitworth)_LOC_cwpb.02499.jpg
- `assets/art/arms/sixPdr.webp` (sixPdr) — CC0 (cc-zero) — Gary Todd (WorldHistoryPics) — 6-pounder smoothbore gun made by N. P. Ames in 1841 (park sign), Chickamauga Battlefield Visitor Center — https://commons.wikimedia.org/wiki/File:6-Pounder_Smoothbore_Gun_(10483784704).jpg
- `assets/art/arms/howitzer12.webp` (howitzer12) — CC0 (cc-zero) — Gary Todd (WorldHistoryPics) — 12-pounder howitzer, tube made for the Confederacy at the Tredegar Iron Works in 1862 (park sign), Chickamauga Battlefield Visitor Center — https://commons.wikimedia.org/wiki/File:12-Pounder_Howitzer_(10483786586).jpg
- `assets/art/arms/napoleon.webp` (napoleon) — CC0 — Dsdugan — M1857 12-pounder Napoleon cast by the Hooper Foundry, Boston; served with the 13th New York Independent Battery in 1864; National Civil War Naval Museum — https://commons.wikimedia.org/wiki/File:21-18-122-m1857.jpg
- `assets/art/arms/ordnance3.webp` (ordnance3) — Public domain (PD-user-en, PD-self) — Hal Jespersen — 3-inch Ordnance rifle, Gettysburg National Military Park — https://commons.wikimedia.org/wiki/File:CW_Arty_3in_Ordnance_front.jpg
- `assets/art/arms/parrott10.webp` (parrott10) — CC0 (cc-zero) — Gary Todd (WorldHistoryPics) — Parrott rifle, Chickamauga Battlefield Visitor Center — https://commons.wikimedia.org/wiki/File:10-Pounder_Parrott_Rifle_(10483763166).jpg

### Backdrops
- `assets/art/backdrops/title-home-sweet-home.webp` (title) — CC0 (NGA Open Access) — Winslow Homer; National Gallery of Art, Washington — Winslow Homer, Home, Sweet Home, about 1863. National Gallery of Art, Washington — https://www.nga.gov/artworks/79933
- `assets/art/backdrops/camp-shiloh.webp` (shiloh) — Public domain (PD-Art) — Adolph Metzner; Library of Congress — Adolph Metzner, Shiloh Battlefield, April 9, 1862, pencil drawing. Library of Congress — https://commons.wikimedia.org/wiki/File:Shiloh_Battlefield%2C_April_9%2C_1862_LCCN2017646904.jpg
- `assets/art/backdrops/camp-stones-river.webp` (stones-river) — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — The Hazen Brigade monument on the Stones River battlefield, raised in 1863; wartime photograph. Library of Congress — https://commons.wikimedia.org/wiki/File:Murfreesboro%2C_Tennessee_(vicinity)._Monument_erected_on_the_battlefield_at_Stones_River_in_1863_LOC_cwpb.02109.jpg
- `assets/art/backdrops/camp-chattanooga.webp` (chattanooga) — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — George N. Barnard, Lookout Mountain from near the rolling mill, camp of the Engineer Brigade, Army of the Cumberland, Chattanooga, 1864. Library of Congress — https://commons.wikimedia.org/wiki/File:Chattanooga%2C_Tenn._1864._Lookout_Mountain%2C_from_near_the_rolling_mill%2C_looking_southwest%2C_camp_of_the_Engineer's_Brigade%2C_Army_of_the_Cumberland_LCCN2012648046.jpg

### Commander portraits (name exactly as in the battle packs)
- `assets/art/portraits/everett-peabody.webp` — Everett Peabody — Public domain (PD-old-70-1923) — Unknown photographer; Wilson's Creek National Battlefield (WICR 30677) — https://commons.wikimedia.org/wiki/File:Col-Everett_Peabody.jpg
- `assets/art/portraits/ralph-p-buckland.webp` — Ralph P. Buckland — Out of uniform; date unknown — Public domain (NARA-image-full, NARA-Author, NARA-cooperation) — Mathew Benjamin Brady, U.S. National Archives and Records Administration — https://commons.wikimedia.org/wiki/File:Gen._Ralph_P._Buckland_-_NARA_-_529051.jpg
- `assets/art/portraits/sterling-a-m-wood.webp` — Sterling A. M. Wood — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:CSA_Brigadier_General_Sterling_Alexander_Martin_Wood.jpg
- `assets/art/portraits/robert-g-shaver.webp` — Robert G. Shaver — Old age: published 1915 (Confederate Veteran) — Public domain (PD-1923) — Confederate Veteran (S. A. Cunningham, Nashville), 1915 — https://commons.wikimedia.org/wiki/File:Col._Robert_Glenn_Shaver%2C_Sr.jpg
- `assets/art/portraits/patrick-r-cleburne.webp` — Patrick R. Cleburne — Public domain (PD-US) — Library of Congress — https://commons.wikimedia.org/wiki/File:Patrick_Cleburne.jpg
- `assets/art/portraits/adley-h-gladden.webp` — Adley H. Gladden — Out of uniform; date unknown — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Adley_H._Gladden%2C_d._1862_LCCN2002711371.jpg
- `assets/art/portraits/james-m-tuttle.webp` — James M. Tuttle — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Gen._James_M._Tuttle_LOC_cwpb.07218.jpg
- `assets/art/portraits/thomas-w-sweeny.webp` — Thomas W. Sweeny — Public domain (PD-USGov, PD-US) — Charles D. Fredericks & Co. "Specialite," 587 Broadway, New York — https://commons.wikimedia.org/wiki/File:Thomas_William_Sweeny%2C_circa_1865.jpg
- `assets/art/portraits/benjamin-m-prentiss.webp` — Benjamin M. Prentiss — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Gen._Benjamin_M._Prentiss_LOC_cwpb.06380.jpg
- `assets/art/portraits/jacob-g-lauman.webp` — Jacob G. Lauman — Public domain (PD-old) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Jacob_Gartner_Lauman_1.JPG
- `assets/art/portraits/stephen-a-hurlbut.webp` — Stephen A. Hurlbut — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Gen._S.A._Hurlbut_LOC_cwpb.05689.jpg
- `assets/art/portraits/john-a-mcclernand.webp` — John A. McClernand — Public domain (PD-old) — Brady National Photographic Art Gallery; Library of Congress — https://commons.wikimedia.org/wiki/File:John_Alexander_McClernand.jpg
- `assets/art/portraits/james-r-chalmers.webp` — James R. Chalmers — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Gen._James_R._Chalmers%2C_Col._9th_Miss._Inf._LOC_cwpb.07597.jpg
- `assets/art/portraits/john-k-jackson.webp` — John K. Jackson — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:J_K_Jackson_CSA_ACW.jpg
- `assets/art/portraits/jacob-ammen.webp` — Jacob Ammen — Public domain (PD-old) — Unknown photographer — https://commons.wikimedia.org/wiki/File:JAmmen.jpg
- `assets/art/portraits/sanders-d-bruce.webp` — Sanders D. Bruce — Engraving published 1896 — Public domain (PD-US-expired) — The National Cyclopaedia of American Biography, vol. 6 (1896) — https://commons.wikimedia.org/wiki/File:Sanders_Dewees_Bruce.png
- `assets/art/portraits/william-b-hazen.webp` — William B. Hazen — Public domain (PD-old-100) — Mathew Benjamin Brady — https://commons.wikimedia.org/wiki/File:William_Babcock_Hazen_-_Brady-Handy.jpg
- `assets/art/portraits/william-sooy-smith.webp` — William Sooy Smith — Out of uniform; date unknown — Public domain (PD-old-100-1923) — Library of Congress — https://commons.wikimedia.org/wiki/File:William_Sooy_Smith-Chicago%2C_Ill._-_Baker's_Art_Gallery%2C_Columbus%2C_O(hio)._LCCN2002716948.jpg
- `assets/art/portraits/jeremiah-t-boyle.webp` — Jeremiah T. Boyle — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Jeremiah-T.-Boyle.jpg
- `assets/art/portraits/lovell-h-rousseau.webp` — Lovell H. Rousseau — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Maj._Gen._Lovell_Harrison_Rousseau_LOC_cwpb.07108_(1).jpg
- `assets/art/portraits/edward-n-kirk.webp` — Edward N. Kirk — Public domain (PD-old-100) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Edward_N_Kirk.jpg
- `assets/art/portraits/lew-wallace.webp` — Lew Wallace — Public domain (PD-old-100) — Mathew Benjamin Brady — https://commons.wikimedia.org/wiki/File:Lew_Wallace_-_Brady-Handy.jpg
- `assets/art/portraits/randall-l-gibson.webp` — Randall L. Gibson — Public domain (PD-US) — Hinton & Oppenheimer, Mobile — https://commons.wikimedia.org/wiki/File:Cartes-de-visite_of_General_Randall_Gibson%2C_C.S.A.jpg
- `assets/art/portraits/august-willich.webp` — August Willich — Public domain (PD-old-100-1923) — Library of Congress — https://commons.wikimedia.org/wiki/File:Colonel_August_Willich%2C_head-and-shoulders_portrait%2C_facing_front.jpg
- `assets/art/portraits/p-sidney-post.webp` — P. Sidney Post — Postwar congressional portrait — Public domain (PD-USGov-Congress) — The Graphic (Chicago), 1893; Collection of the U.S. House of Representatives — https://commons.wikimedia.org/wiki/File:PhilipSPost.jpg
- `assets/art/portraits/william-p-carlin.webp` — William P. Carlin — Public domain (PD-1923) — Civil War glass negative collection (Library of Congress) — https://commons.wikimedia.org/wiki/File:William_P_Carlin.jpg
- `assets/art/portraits/james-e-rains.webp` — James E. Rains — Published 1896 — Public domain (PD-US) — The Illustrator Co. — https://commons.wikimedia.org/wiki/File:Portrait_of_James_Edwards_Rains.jpg
- `assets/art/portraits/matthew-d-ector.webp` — Matthew D. Ector — Out of uniform; date unknown — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Mathew_Duncan_Ector.jpg
- `assets/art/portraits/evander-mcnair.webp` — Evander McNair — Public domain (PD-old-100-1923) — Library of Congress — https://commons.wikimedia.org/wiki/File:Evander_McNair%2C_of_Arkansas%2C_Brigadier_General%2C_C.S.A.%2C_head-and-shoulders_portrait%2C_facing_left_LCCN2004680079.jpg
- `assets/art/portraits/george-w-roberts.webp` — George W. Roberts — Public domain (PD-old-70-expired) — John Carbutt — https://commons.wikimedia.org/wiki/File:Union_Army_Colonel_George_Washington_Roberts_(1833%E2%80%931862)_in_1861_(cropped).tif
- `assets/art/portraits/nicholas-greusel.webp` — Nicholas Greusel — Postwar: 1888 lithograph — Public domain (PD-US) — Portrait and Biographical Album of Henry County, Iowa (1888) — https://commons.wikimedia.org/wiki/File:Nicholas_Greusel.PNG
- `assets/art/portraits/john-f-miller.webp` — John F. Miller — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Gen._John_F._Miller%2C_Col_of_29th_Ind._Inf._Wounded_at_Stone_River_LOC_cwpb.07056.jpg
- `assets/art/portraits/arthur-m-manigault.webp` — Arthur M. Manigault — Postwar portrait; date unknown — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Arthur_Middleton_Manigault.jpg
- `assets/art/portraits/george-maney.webp` — George Maney — Public domain (PD-US) — Confederate Memorial Literary Society — https://commons.wikimedia.org/wiki/File:Carte-de-Visite_of_a_bust_portrait_of_Brigadier_General_George_Earl_Maney_in_uniform.jpg
- `assets/art/portraits/j-patton-anderson.webp` — J. Patton Anderson (also listed as Patton Anderson) — Public domain (PD-1923) — Brady collection — https://commons.wikimedia.org/wiki/File:James_Patton_Anderson.jpg
- `assets/art/portraits/john-g-coltart.webp` — John G. Coltart — Public domain (PD-old-70-expired) — T.J. Robinson & Co. of Huntsville, Ala — https://commons.wikimedia.org/wiki/File:Colonel_John_G._Coltart_carte-de-visite.jpg
- `assets/art/portraits/alfred-j-vaughan-jr.webp` — Alfred J. Vaughan Jr. — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:A_J_Vaughan%2C_Jr._CSA_ACW.jpg
- `assets/art/portraits/alexander-p-stewart.webp` — Alexander P. Stewart — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:General_Alexander_P._Stewart.jpg
- `assets/art/portraits/lucius-e-polk.webp` — Lucius E. Polk — Postwar portrait; date unknown — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Portrait_of_Lucius_Eugene_Polk.jpg
- `assets/art/portraits/bushrod-r-johnson.webp` — Bushrod R. Johnson — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Bushrod_Rust_Johnson%2C_1817-1880_LCCN2003662200.jpg
- `assets/art/portraits/william-grose.webp` — William Grose — Public domain (PD-old-100) — Unknown photographer — https://commons.wikimedia.org/wiki/File:WGrose.jpg
- `assets/art/portraits/george-d-wagner.webp` — George D. Wagner — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:G.D._Wagner%2C_Brig._General_LCCN90712440.jpg
- `assets/art/portraits/milo-s-hascall.webp` — Milo S. Hascall — Public domain (PD-1923) — Unknown photographer — https://commons.wikimedia.org/wiki/File:MiloSHascall.jpg
- `assets/art/portraits/daniel-s-donelson.webp` — Daniel S. Donelson — Tennessee militia uniform; date unknown — Public domain (PD-1923) — Unknown photographer — https://commons.wikimedia.org/wiki/File:DSDonelson.jpg
- `assets/art/portraits/samuel-w-price.webp` — Samuel W. Price — Public domain (PD-old-100-1923) — Phipps, W. R. (William R.), photographer, Library of Congress — https://commons.wikimedia.org/wiki/File:Brigadier_General_Samuel_Woodson_Price_of_21st_Kentucky_Infantry_Regiment_in_uniform)_-_W.R._Phipps%2C_photographer%2C_Lexington%2C_Ky_LCCN2016652210.jpg
- `assets/art/portraits/charles-cruft.webp` — Charles Cruft — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Bv't.-Maj._Gen._Chas._Cruft_LCCN93513605.jpg
- `assets/art/portraits/roger-w-hanson.webp` — Roger W. Hanson — Public domain (PD-old-100-1923) — Bendann Bros., photographer, Library of Congress — https://commons.wikimedia.org/wiki/File:Brigadier-General_Roger_W._Hanson_of_2nd_Kentucky_Infantry_Regiment_in_uniform)_-_Bendann_Brothers'_Galleries_of_Photography%2C_205_Balto._St_LCCN2016647909.jpg
- `assets/art/portraits/gideon-j-pillow.webp` — Gideon J. Pillow — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Portrait_of_General_Gideon_Johnson_Pillow.jpg
- `assets/art/portraits/william-preston.webp` — William Preston — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Brigadier_General_William_Preston.jpg
- `assets/art/portraits/samuel-beatty.webp` — Samuel Beatty — Public domain (PD-1923) — Unknown photographer — https://commons.wikimedia.org/wiki/File:SamuelBeatty.jpg
- `assets/art/portraits/charles-g-harker.webp` — Charles G. Harker — Public domain (NARA-image-full, NARA-Author, NARA-cooperation) — Mathew Benjamin Brady, U.S. National Archives and Records Administration — https://commons.wikimedia.org/wiki/File:Col._Charles_G._Harker_-_NARA_-_530361.jpg
- `assets/art/portraits/george-a-cobham-jr.webp` — George A. Cobham Jr. — Public domain (PD-1923) — Unknown photographer — https://commons.wikimedia.org/wiki/File:George_Ashworth_Cobham.jpg
- `assets/art/portraits/david-ireland.webp` — David Ireland — Public domain (PD-old-70-expired) — Unknown photographer — https://commons.wikimedia.org/wiki/File:David_Ireland.jpg
- `assets/art/portraits/charles-candy.webp` — Charles Candy — Public domain (PD-old-70-1923) — Unknown photographer, Library of Congress — https://commons.wikimedia.org/wiki/File:Colonel_Charles_Candy_LOC_(cropped).jpg
- `assets/art/portraits/walter-c-whitaker.webp` — Walter C. Whitaker — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:WCWhitakerACWstanding.jpg
- `assets/art/portraits/edward-c-walthall.webp` — Edward C. Walthall — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Brig._Genl._Edward_Cary_Walthall.jpg
- `assets/art/portraits/john-c-moore.webp` — John C. Moore — Public domain (PD-US) — Ben Oppenheimer, Photograph Gallery, 56 Dauphin Street, Mobile — https://commons.wikimedia.org/wiki/File:Brigadier_General_John_Creed_Moore%2C_C.S.A.jpg
- `assets/art/portraits/ferdinand-van-derveer.webp` — Ferdinand Van Derveer — Public domain (PD-old-assumed-expired) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Ferdinand_Van_Derveer_(brigadier_general%2C_born_1823).jpg
- `assets/art/portraits/john-b-turchin.webp` — John B. Turchin — Out of uniform; date unknown — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Turchin.jpg
- `assets/art/portraits/francis-t-sherman.webp` — Francis T. Sherman — Public domain (PD-old) — Unknown photographer — https://commons.wikimedia.org/wiki/File:Brig._General_Francis_T._Sherman.jpg
- `assets/art/portraits/zachariah-c-deas.webp` — Zachariah C. Deas — Out of uniform; date unknown — Public domain (PD-old-100-1923) — E. & H. T. Anthony; Library of Congress — https://commons.wikimedia.org/wiki/File:Zachariah_C._Deas%2C_Brig._Gen._CSA.jpg
- `assets/art/portraits/william-f-tucker.webp` — William F. Tucker — Public domain (PD-US) — Unknown photographer — https://commons.wikimedia.org/wiki/File:William_Feimster_Tucker.png
- `assets/art/portraits/robert-c-tyler.webp` — Robert C. Tyler — Public domain (PD-US) — Bingham Brothers, Nashville — https://commons.wikimedia.org/wiki/File:Brig._Gen._Robert_Charles_Tyler.jpg
- `assets/art/portraits/jesse-j-finley.webp` — Jesse J. Finley — Public domain — Unknown photographer — https://commons.wikimedia.org/wiki/File:Brigadier_General_Jesse_J._Finley.jpg
- `assets/art/portraits/otho-f-strahl.webp` — Otho F. Strahl — Public domain (PD-US) — Bingham Brothers — https://commons.wikimedia.org/wiki/File:Carte-de-Visite_of_Otho_French_Strahl.jpg
- `assets/art/portraits/marcellus-a-stovall.webp` — Marcellus A. Stovall — Public domain (PD-old-100-1923) — Library of Congress, Civil War glass negatives — https://commons.wikimedia.org/wiki/File:Brig._Gen._M.A._Stovall%2C_head-and-shoulders_portrait%2C_facing_right_LCCN97508382.jpg

Withheld for a doubtful identity (no portrait shown): John A. McDowell, William E. Woodruff, Edward H. Phelps.

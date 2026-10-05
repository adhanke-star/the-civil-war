# tools/bake: the art bake probe

Builds one Union infantryman in headless Blender on GitHub Actions. It renders him as sprite frames
with the lighting and shadow baked in, then packs the frames into atlases the browser can draw as
camera-facing sprites. **Nothing here runs on the Mac.** Blender and the 280 MB asset pack only
ever exist on the runner.

**Stack-law exception.** The `.py` files are Python only because they run inside Blender's bundled
interpreter on CI. Each file says so at the top. Everything outside Blender is Node (`pack.mjs`).

## Drill-hand rebuild (2026-10-05; not approved for the game)

Restored pass 3 (a50968f), including its faces, variants and manifest shape. Removed the
per-finger contact optimiser and all pass-4 fist/channel fitting. One authored closed hand
is placed at named stations; only trigger/thumb and cartridge/rammer pinch use the manual's
exceptions. The rest-mesh nail directions orient flexion; contact/penetration reports are
diagnostics and do not adjust any joint or station.

Targets: docs/drill-reference.md. Stand and every walk frame use Hardee para 121's RIGHT
shoulder arms, guard to the front, right arm nearly extended. Loading holds the MIDDLE band,
butt grounded at the left thigh and muzzle opposite body centre. Aim/fire retain the head
on the stock and the left elbow low/right elbow raised. Baxter 1861 pp45-48, 51-53 and
Hardee 1861 paras121,163,171-174 remain Inferred (one source per item); dimensions are estimates.

The preview artifact adds review/ (512 px front/right-side figures for all 18 frames) and
hands/ close-ups. These must be compared to the original plates, with clear labels that
stand/walk have NO matching plate; Baxter's older LEFT carry must never be a claimed match.
Show the numbered comparisons and contact sheet in Preview, confirm Aaron saw them, and
get approval before fielding. A quick bake is incomplete coverage and cannot ship.

## Run it

- Push to the `bake` branch with a change under `tools/bake/**` or `.github/workflows/bake.yml`.
  This triggers `.github/workflows/bake.yml`.
- Or run `gh workflow run bake.yml --ref bake -f samples_close=32 -f directions=16`. GitHub only
  lists `workflow_dispatch` once the workflow file is on the default branch. Until then, the push
  trigger is the way in.
- Put `[quick]` in the commit message for a quick check run (one `all` render shard: hero, close-up,
  portrait, hands, kit, heads, hand shots, variants and a few frames; about 17 minutes) instead of
  the full matrix.
- Watch it with `gh run watch <id>`. Each run uploads `bake-<n>` (everything) and `preview-<n>`
  (contact sheet, hero/close-up/portrait/hands/kit previews, reports, drill views). Check its size, then fetch
  one with `gh run download <id> -n preview-<n> -D .out/<folder>`. Download only into `.out/`.
  `reports-<n>` (prep reports) is uploaded even when a prep stage fails.

**Jobs (third pass).** `prep` builds the soldier once (stages 1-3b) and hands `work/posed.blend` to
the `render` matrix as a 1-day artifact; `render` runs one job per shard (`SHARDS_FULL` in
`bake.yml`: `hero`, `c0of16`..`c15of16`, `f0of3`..`f2of3`); `pack` downloads every shard, merges
the reports (`report/render-<shard>.json` -> `report/render.json`) and packs. A close shard `cKofN`
renders the (variant, direction) units whose index modulo N is K, over every clip, so the load is
even and nothing is ever dropped for time. Quick runs use one shard, `all`.

Stages (each one is a separate Blender process, timed in the job summary):

| step | file | in -> out |
|---|---|---|
| 1 | `probe_mpfb.py` | MPFB2 + CC0 packs -> `work/body.blend`, `report/probe.json` (adult male, default rig; third pass: the seven head presets of `uniform.py` `HEADS`, each a body shape key plus its own CC0 eyes, brows, lashes, hair, beard and skin) |
| 2 | `uniform.py` | -> `work/soldier.blend`, `report/uniform.json`. Garments, kit, rifle-musket, cap, brogans, skin shading; **all dimensions/colours in one table at the top** |
| 3 | `poses.py` | -> `work/posed.blend`, `report/poses.json`. Stand (shoulder arms), 8-frame march, aim/fire/recover, fallen, load (5); authored closed hand with diagnostic real-skin contact report; cartridge; kit hang; motion checks |
| 3b | `cloth.py` | -> `work/posed.blend`, `report/cloth.json`. Blender cloth settled per pose for trousers, coat (sleeves) and coat skirt; never fails the job |
| 4 | `render.py --shard <s>` | -> `frames/<tier>/*.png`, `frames/<tier>_<variant>/*.png` (both tiers), `variants/*.png`, `heads/*.png`, `hands/*.png`, `hero.png`, `hero-closeup.png`, `portrait.png`, `hands.png`, `kit.png`, `report/render[-<shard>].json` |
| 5 | `pack.mjs` | -> `atlas/soldier_<tier>_<page>.png`, `atlas/soldier_<tier>_<variant>_<page>.png`, `atlas/soldier.json`, `contact-sheet.png`, `*-preview.png` |

`common.py` holds the shared helpers. The `work/*.blend` files stay on the runner and are not
uploaded.

## Outputs (artifact `bake-<run number>`, kept 7 days)

- `frames/close/*.png` (256 px) and `frames/field/*.png` (96 px): one frame per
  `<clip>_<index>_d<direction>`, with transparent background and the shadow kept in alpha.
- `atlas/soldier_<tier>_<page>.png` + `atlas/soldier.json`: trimmed frames on shelf-packed pages.
  The manifest holds:
  - each frame's rect and its offset inside the untrimmed frame;
  - the feet anchor (px) and pixels per metre;
  - clips (frames, fps, loop, metres per walk cycle);
  - the camera (orthographic, elevation, direction rule) and the sun direction (world and screen).

  To draw a frame, place its rect at `screenAnchor - (ax, ay) + (ox, oy)` using **the frame's own
  `ax`, `ay`** and scale it by `(game px per metre) / ppm` (see "Manifest additions").
- `contact-sheet.png` (third pass: 8 x 10 cells of 256 px):
  - rows 1-2: all 16 standing directions;
  - row 3: the walk cycle;
  - row 4: aim, fire, recover, fallen, load 0-3;
  - row 5: load 4, then close-tier variants slouch hat, fixed bayonet, no blanket roll, face2 (h2), mixed (h3, slouch, no roll);
  - row 6: the field tier at 1:1 and the first three field variants;
  - row 7: every head preset at the close tier (stand, direction 1);
  - row 8: every head preset, 256 px head-and-shoulders;
  - rows 9-10: a 256 px hand close-up for every grip frame (stand, walk, aim, fire, recover, load 0-4), then the other field variants at 1:1.
- `portrait.png` / `portrait-preview.png`: 1024 px head-and-shoulders lit as in game (direction 1, near eye level); `hands.png` / `hands-preview.png`: 1024 px, both hands on the musket in the aim frame; `kit.png` / `kit-preview.png`: 1024 px, blanket roll and kit from his right side.
- `frames/<tier>_<variant>/` and `atlas/soldier_<tier>_<variant>_<page>.png`: the variants, in both tiers.
- `hero.png` (transparent) and `hero-preview.png` (on a field-green ground): the 1024 px
  three-quarter-front render, fitted to the figure.
- `hero-closeup.png` / `hero-closeup-preview.png`: 1024 px head-to-waist crop of the same pose, for
  judging cloth and kit.
- `report/*.json`: every number the summary prints, including `poses.json` `checks` (foot slip,
  musket-to-shoulder distance, head pitch, arm clearance) and `pack.json` `measuredColours`.

### Manifest additions (second pass; no first-pass field was removed or renamed)

- `frames.<key>.ax`, `.ay`, `.ppm`: this frame's feet anchor (px, untrimmed frame) and px per
  metre. **Framing is now per clip**: one scale per clip (fitted to the figure and its shadow over
  all frames and directions), one centre per direction. Use these per-frame fields.
- `tiers.<tier>.clips.<clip>`: `orthoM`, `pxPerMetre`, `anchors[d]` (and `anchor` = direction 0).
- `tiers.<tier>.pxPerMetre` / `anchor` still exist but now mean **the stand clip at direction 0**.
  A reader that used them for every clip would draw walk/fire/load at the wrong scale.
- `tiers.<tier>.directionsByClip`: which directions exist per clip (see the direction plan).
- `tiers.field.variants.<name>`: `{count, pages, frames}` for extra figure variants in the field
  tier (same frame keys and anchors as the base). Atlas files `soldier_field_<name>_<page>.png`.
- `clips.load`: new clip (5 frames) and `clips.fire.note`, `clips.load.note`.
- `sun.ground_shadow`: the ground shadow's light (same azimuth as the key, steeper; see Lighting).
- `lights`: key, shadow, rim, fill, bounce and sky, with directions, colours and strengths.
- `measuredColours`: the sRGB each named part lands at in `hero.png`.
- `variantsFraming`, `quick`, `readability`.

### Manifest additions (third pass; additive, no existing field changed meaning)

- `tiers.close.variants.<name>`: the close tier now has the SAME variants as the field tier, same
  names, same `{count, pages, frames}` shape as `tiers.field.variants` (atlas files
  `soldier_close_<name>_<page>.png`), so a man keeps one variant at every distance.
- `tiers.<tier>.variants.<name>.composition`: `{head, headLabel, use, hat, blanketRoll, assets}`.
  `tiers.<tier>.baseComposition`: the same for the base frames.
- `heads`: every head preset with its CC0 assets, targets and `use` (`any`, or `usct` = only for
  United States Colored Troops regiments); `headsNote`.
- `grips`, `gripsNote`: per clip frame and hand, the real-skin contact count and penetration.
- `shards`: per render shard, wall seconds and renders.
- `readability` gains the field-tier slouch hat note. `measuredColours`, `lights` (now with
  `face_bounce`) as before. Per-frame `ax`, `ay`, `ppm`, `directionsByClip` and
  `tiers.<tier>.variants` keep exactly their second-pass meaning.
- Variant names are `<head>_<cap|slouch>_<roll|noroll>`. The second pass's field variants
  `mixed`, `face2`, `slouch` are replaced by these (names are data, not format).

### Direction plan (third pass)

Every clip, every frame, all 16 directions, in both tiers, for the base figure and all 8 variants
(9 x 288 = 2,592 frames per tier). There is no time budget and nothing is dropped: the work is
split across the shard matrix instead. `render.json` `reduced` is always null.

### Lighting (one standard light)

- **Key**: warm sun, azimuth 200 degrees (screen-left, slightly toward the viewer), elevation 52.
  This is `sun.to_sun_world` / `to_sun_screen`. It lights the figure only (light linking).
- **Ground shadow**: a second sun with the same azimuth at elevation 74 lights only the shadow
  catcher, so the cast shadow points the same way but is about 0.29 m per metre of height, and soft
  (9 degree source). In game the shadow is fixed on screen (it does not turn with the camera); it
  is kept short and soft so that is hard to notice.
- **Fills**, figure only, no ground shadow: cool rim from behind-right, soft frontal fill from the
  camera side, a green ground-bounce area light and (third pass) a **warm face bounce**: a soft sun
  from in front and 16 degrees below the eye line, strength 1.0, colour (1.0, 0.86, 0.68), the
  light reflected off sunlit ground. It reaches under the visor, so the eyes are no longer black.
  The key light and the single ground shadow are unchanged.
- **View transform: Standard** (was AgX). AgX desaturated the dark-blue coat to pale grey-blue on
  the field. The game applies its own grade and draws sprites as baked.

### Readability choices

- Field tier only: the musket's cross-section is scaled x1.7 (length unchanged) so it survives at
  96 px. Close tier and hero are true size.
- Straps and blanket are darker than the first pass so they do not out-shine the coat.
- Third pass, field tier only: the slouch hat is a twin with a wider brim (0.105 m against
  0.075 m) in a lighter felt (#5a5045 against #151413), so the hat still reads at 96 px.
- Drill rebuild: aim has a level barrel and the head down on the stock; fire keeps that head
  placement, with only a 3 degree muzzle rise and 2.5 cm recoil (art estimates). The rammer
  is held 0.10 m above the muzzle with the elbow near the body. These replace pass 3's
  exaggerated shot and high rammer hold.

Direction rule: direction `d` faces `d * 360/N` degrees counter-clockwise, seen from above, from
"toward the camera". So 0 faces the viewer, 4 faces screen-right and 8 faces away. The camera
never moves. The figure turns, so the one standard light always reads as upper-left on screen.

## Third pass (2026-10-04; historical methods, not the current hand rebuild)

Owner's order: face and hands first, then blanket roll and kit weight, cloth, parallel jobs,
variants. Plus five in-play findings from fielding the second-pass atlas (close-tier variants,
walk bob, silhouettes, slouch hat at field size, manifest fields kept).

### Face

- **Seven head presets** (`HEADS` at the top of `uniform.py`), each a body shape key
  `tcw_head_<name>` (weighted MPFB2 CC0 face-shape targets plus the CC0 expression units in
  `EXPR`: lids a little narrowed, brows a touch down with the inner ends up, lips pressed) and its
  own CC0 high-poly eyes, eyebrows, eyelashes, hair, beard and skin (every body material slot):

  | head | look | skin | hair, brows, lashes | beard | use |
  |---|---|---|---|---|---|
  | h1 (base) | young, clean-shaven, stubble | young_caucasian_male | short02, eyebrow001, eyelashes01 | none | any |
  | h2 | full beard, dark brown | middleage_caucasian_male | short04, eyebrow003, eyelashes02 | grinsegold_beard_sigmund_wip | any |
  | h3 | chin beard, shaved lip, sandy | young_caucasian_male2 | short01, eyebrow005, eyelashes01 | culturalibre_faun_beard | any |
  | h4 | moustache, near-black | middleage_caucasian_male | short03, eyebrow007, eyelashes02 | rehmanpolanski_moustache_viking | any |
  | h5 | older, grizzled short beard | old_caucasian_male | short04, eyebrow009, eyelashes03 | wdg_scruffy_beard | any |
  | h6 | young, auburn, heavy stubble | young_caucasian_male | short01, eyebrow011, eyelashes01 | none | any |
  | h7 | moustache | middleage_african_male | short02, eyebrow002, eyelashes02 | rehmanpolanski_moustache_viking | **usct only** |

  `use: usct` means the game may draw h7 only in United States Colored Troops regiments (the
  army was segregated); it must never appear in a white regiment. No person is depicted.
- **Eyes**: procedural (no image): warm sclera darkening toward the corners, striated iris with
  a dark limbal ring, black pupil, clear coat for the catch-light; iris 27 degrees and pupil 8.5
  degrees of the eyeball, found per pixel from each eye's own centre.
- **Skin**: sunburn, stubble and sideburns in the head's own hair colour, grime that gathers in
  creases (concave pointiness), reddened knuckles and cheekbones (convex pointiness), pores, a
  little subsurface scattering; grimed fingernails. Hair, brows, beard and lashes recoloured from
  their CC0 textures per head. Hair under the cap is masked at the band's lower edge.
- **Light under the visor**: the cap sits 1 cm higher and tips back (tilt 7 -> 1.5 degrees, visor
  dip 28 -> 18) and the warm face bounce (Lighting) reaches the eyes.
- Body gets render-level subdivision (face and fingers).

### Hands

`poses.py` measures the hand from the rest mesh (pad thickness per finger segment, pad side =
opposite its fingernail, palm thickness, palm centre), then for every gripping hand:
1. tries 90 placements (palm side round the object, wrap direction, hand tilt up to 45 degrees,
   slide along it): the palm skin goes against the surface, the wrist follows from the measured
   hand, the arm reaches it by IK, the forearm rolls to take the twist, the hand is set exactly;
2. curls each finger joint until its pad touches (bisection; the thumb is opposed by a fixed turn
   and its outer joints close); a joint never opens past 10 degrees beyond straight;
3. finishes the best 5 on the **real skinned mesh**: the palm and knuckles are pushed out of the
   wood, then each joint is curled or opened until its nearest skin is within -0.8..+1.2 mm of
   the surface; the placement with the best measured contact, least penetration and straightest
   wrist is kept.
The load clip's right hand pinches a paper cartridge (thumb and two fingers, palm held off) at
the box and over the muzzle, then grips the drawn rammer and the rammer for the stroke.
The report measures the real skin against the analytic surfaces (stock ellipse, barrel, rammer
and cartridge cylinders). Not measured: contact with the musket's actual mesh.

### Blanket roll and kit weight

Roll: squeezed 20% under each of the four ties, 3% fuller between them, flattened 22% where it
lies on the shoulder and at the hip ends, a 1 cm sag off the body between, a dark band near each
end (the blanket's end stripes, placeholder), heavier wool shading, and end discs with a stepped
spiral (3.5 turns). Haversack and canteen swing 75% of the way back to plumb from their strap
point every frame and swing 5 degrees on the march (lagging the stride).

### Cloth (Blender cloth simulation, kept)

`cloth.py` settles trousers, the coat (with its sleeves) and the coat skirt for each of the 17
standing clip frames: the armature-posed garment is the start, a shape key holds its rest shape
(the spring lengths, so squeezed cloth buckles into folds), pinned at the waist band, under the
belts and at the top of the skirt (pin stiffness 20), cuffs and hems weighted, 36 frames under
gravity colliding with the posed body (and, for the skirt, the trousers). Vertices that run away
more than 3 cm blend back to the posed shape over two rings; more than 3% runaway rejects that
garment-frame. Attempt 1 (run 16): trousers fine, the coat exploded at a few vertices. Attempt 2
(run 17): runaway blend-back, 49 of 51 kept. Attempt 3 (run 19): stiffer pins after the coat sagged
off the belt line, 48 of 51 kept. The fallen frame keeps the procedural folds.

### Walk, silhouettes, slouch hat (in-play findings)

- Walk: stride 0.36 -> 0.30 m each side, pelvis drop capped at 4.2 cm (2.4% of height), bob 5 mm;
  the planted feet now cover 1.00 m per cycle (0.92 m/s; manifest `clips.walk`).
- Silhouettes and the field-tier slouch hat: see Readability choices.

### Measured numbers, third pass (historical; not the drill rebuild)

Filled in from the final full run below.

## Measured numbers, second pass

Two full runs on the same pipeline, one runner fast and one slow (ubuntu-latest, 4 vCPU, Cycles CPU;
runner speed varied **1.9x** between them):

| | run 37168455918 (final code, slow runner) | run 37167400762 (fast runner) |
|---|---|---|
| job wall time | **22.0 min** | 18.9 min |
| close tier, 256 px @ 32 spp | 4.28 s/frame, 152 frames (stand 16 dirs, other clips 8) | 2.26 s/frame, 216 frames (stand and walk 16, others 8) |
| field tier, 96 px @ 16 spp | 0.72 s/frame, 288 frames (all clips, 16 dirs) | 0.43 s/frame, 288 frames |
| hero 1024 px @ 96 spp / close-up 1024 px @ 72 spp | 82 s / 81 s | 46 s / 45 s |
| field-tier variants | `mixed` only (`face2`, `slouch` dropped by the budget) | `mixed`, `face2`, `slouch` (about 2 min each) |
| close atlas | 3 pages: 2048x1804, 2048x1960, 2048x196; 3.35 MB | 3 pages, 4.63 MB |
| field atlas (each variant the same) | 1024x1736, 1.27 MB | 1024x1728, 1.27 MB |
| manifest | 162 KB | 295 KB |

The fast run cut directions one clip late because of an estimator bug (it counted clips already
rendered); the final code counts only clips still to render. **Cost of each field-tier variant**:
288 frames, about 2 min on a fast runner and about 3.5 min on a slow one, plus 1.3 MB of atlas.

- **Framing**: the stand clip is now framed at 1.93 m (132 px/m close, 49.6 px/m field), against
  3.0 m (85 px/m) in the first pass, so **+56% pixels per metre**. The other clips: walk 2.71 m,
  fire 2.51 m, fallen 2.26 m, load 2.52 m (the musket's reach sets their scale).
- **Ground shadow**: 0.29 m per metre of height (first pass 0.70).
- **Pose checks** (`poses.json` `checks`):
  - walk foot slip: at most **1.65 cm** for sole points in ground contact in consecutive frames;
  - musket axis: 2.4 cm from the shoulder-top point in every walk frame;
  - stand head: pitch +3.4 degrees, yaw 0;
  - arm clearance: every arm clears the kit, except the left arm in walk frames 3-5, which grazes
    the roll/canteen by 6-7 mm;
  - worst IK miss: 4.7 cm, the left hand in the aim frame.
- **Grip** (finger segments touching the stock, of 15): stand 6, walk 11, fire 2-5, load 1-4.
  The fire and load hands close into a fist next to the stock rather than round it.
- **Geometry**: 101,806 triangles at viewport levels (the render adds subdivision).

### Colours the parts land at (sRGB in `hero.png`, Standard view transform)

Median of all directly visible pixels, and "lit" = the brightest third (the side the key light hits):

| part | median | lit | albedo in `uniform.py` |
|---|---|---|---|
| sack coat | #24293e | #3f4760 | #1a2550 |
| trousers | #51677d | #758fb2 | #7393c4 |
| cartridge belt (leather) | #212023 | #3d3835 | #121110 |
| blanket roll | #4e4b43 | #71685a | #5a5246 |
| skin (face) | #7e5744 | #876851 | MakeHuman CC0 texture + sunburn/stubble |

The waist belt had too few visible samples (2) to report.

## Measured numbers, first pass (for comparison)

Measured on run 37160936587 (2026-10-03). The runner was ubuntu-latest with 4 vCPU and Cycles on
CPU. Speed varies between runners by about 30% (close tier: 3.1 s, 3.7 s and 4.0 s per frame on
three runs).

- **MPFB2 headless works.** It was installed with `blender --command extension install-file -r
  user_default` and enabled with `addon_utils.enable`. `create_human` takes 0.2 s and
  `add_builtin_rig("default")` takes 0.2 s. The body has 13,380 visible vertices, is 1.73 m tall and
  has 163 bones.
- Close tier, 256 px @ 48 spp: **4.0 s/frame**. Field tier, 96 px @ 24 spp: **0.54 s/frame**.
  Hero, 1024 px @ 128 spp: 59 s.
- Full probe matrix (16 directions x 13 frames x 2 tiers = 416 frames, plus 2 variants and the
  hero): render 17.0 min. **The job takes 17.7 min wall time** (setup about 0.7 min with warm caches).
- Close atlas: 4 pages, 2048 wide, 3.6 MB. Field atlas: 1024x1224, 0.75 MB. Manifest: 57 KB.
  Artifact: 21.8 MB zipped.
- Extrapolated, linear, same samples:
  - one full soldier (16 directions x 40 frames x 2 tiers): about 49 CPU-minutes and about 13 MB of
    atlas;
  - 8 figure variants: about 6.5 CPU-hours and about 107 MB.

  That does not fit one 30-minute job. Shard directions across parallel jobs, which are free on a
  public repo. Rendering the field tier by downsampling the close frames would remove its 12% share.

Walk clip: 8 frames at 7.33 fps (110 steps/min). The planted feet cover **1.20 m per cycle
(1.10 m/s)**, shorter than the 1.42 m drill step. The manifest carries both numbers, so the game
can match ground speed to the feet.

## Licences of everything external

| thing | licence | role |
|---|---|---|
| Blender 4.2 LTS (download.blender.org, sha256-pinned; official mirrors as fallback) | GPL-2.0-or-later | tool on CI only, never shipped |
| MPFB2 v2.0.17 (github.com/makehumancommunity/mpfb2) | GPL-3.0-or-later (code) | tool on CI only, never shipped |
| MakeHuman system assets, CC0 pack: https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip | CC0 1.0 | body mesh, skin, eyes, eyebrows, hair (geometry and textures end up in rendered pixels) |
| MPFB2 bundled data (base mesh, targets, rigs, weights) | CC0 1.0 (MPFB2 `LICENSE.ASSETS.md` is the CC0 text; read at v2.0.17) | body shape and rig |
| MakeHuman "bodyparts05" pack (beards and moustaches): https://files.makehumancommunity.org/asset_packs/bodyparts05/bodyparts05_cc0.zip (mirror files2.), page https://static.makehumancommunity.org/assets/assetpacks/bodyparts05.html (re-read 2026-10-04) | CC0 (the page lists each asset as CC0) | third pass uses four: `grinsegold_beard_sigmund_wip` (author grinsegold), `culturalibre_faun_beard` (culturalibre), `rehmanpolanski_moustache_viking` (RehmanPolanski), `wdg_scruffy_beard` (WDG) |
| From the system pack (page https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html, re-read 2026-10-04, every asset listed CC0), head presets: skins `young_caucasian_male`, `young_caucasian_male2`, `middleage_caucasian_male`, `old_caucasian_male`, `middleage_african_male`; hair `short01`-`short04`; eyebrows `eyebrow001/002/003/005/007/009/011`; eyelashes `eyelashes01`-`03`; eyes `high-poly` | CC0 1.0 | head presets h1-h7 |
| MPFB2 bundled targets: face shapes (`head-*`, `chin-*`, `nose-*`, `cheek`, `eyes`, `mouth`, `ears`, `eyebrows`) and expression units `targets/expression/units/<race>/` | CC0 1.0 (LICENSE.ASSETS.md at v2.0.17) | head shapes and the tired/alert expression |
| pngjs (already a devDependency) | MIT | atlas PNG I/O in `pack.mjs` |

Everything else (uniform, kit, rifle-musket, cap, brogans, poses, lighting) is built by these
scripts. **All cloth, leather, wood, metal and skin detail textures are procedural** (Blender
noise, wave, checker and Voronoi nodes driven by a rest-position attribute); no image texture
from Poly Haven or ambientCG was used, so none is listed.

**When baked outputs enter the repo**, add to `ATTRIBUTION.md` under "Data and assets":
- the sprite atlases: rendered with Blender from a MakeHuman/MPFB2 body. Cite the MakeHuman system
  assets (CC0) with the URL above, and the MPFB2 base mesh/targets/rigs (CC0, per its
  LICENSE.ASSETS.md) at `https://github.com/makehumancommunity/mpfb2` at the pinned tag;
- name the specific skin, eyes, eyebrows and hair assets used, from `report/probe.json`
  (`variant_assets` lists the second-face skin, hair and the CC0 beard `wdg_scruffy_beard` by WDG
  from bodyparts05);
- note that Blender and MPFB2 (GPL) were build tools only and no GPL code is shipped.

This branch does not edit `ATTRIBUTION.md`: no baked output is committed in this leg. When the
third-pass atlases enter the repo, list every asset in the two rows above (names from
`report/probe.json` `heads`) and the four bodyparts05 beard authors.

## History status

Every dimension, colour and drill position in `uniform.py` / `poses.py` is **Inferred or a
placeholder estimate**. None of it is Verified, because the project needs two independent sources
first, and no source was read in this leg. The tables say which is which. No person, unit or
regiment is depicted. Second-pass additions (garment cut, folds, brogan, cap seat, kit layout,
loading sequence, weathering colours) are all placeholder or recalled-and-Inferred. The belt,
breast and box plates are **plain ovals/discs with no lettering or eagle**. The sack coat has no
outside pocket line: my recollection is an inside breast pocket only, which is unverified.

Third pass: head shapes, expressions, hair and beard colours, eye colours, the cartridge size, the
blanket roll stripes and shape, kit swing, cloth stiffness and the grip stations are placeholder
estimates judged by eye. Facial-hair styles (full beard, chin beard, moustache, clean-shaven) are
recalled as common in period photographs: Inferred, not cited. The loading poses (cartridge from
the box, charge at the muzzle, draw, ram, prime) remain a reduced, recalled sequence (Inferred).
h7 is flagged for USCT regiments only so the game cannot place a Black soldier in a white regiment.

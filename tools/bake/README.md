# tools/bake: the art bake probe

Builds one Union infantryman in headless Blender on GitHub Actions. It renders him as sprite frames
with the lighting and shadow baked in, then packs the frames into atlases the browser can draw as
camera-facing sprites. **Nothing here runs on the Mac.** Blender and the 280 MB asset pack only
ever exist on the runner.

**Stack-law exception.** The `.py` files are Python only because they run inside Blender's bundled
interpreter on CI. Each file says so at the top. Everything outside Blender is Node (`pack.mjs`).

## Run it

- Push to the `bake` branch with a change under `tools/bake/**` or `.github/workflows/bake.yml`.
  This triggers `.github/workflows/bake.yml`.
- Or run `gh workflow run bake.yml --ref bake -f samples_close=32 -f directions=16`. GitHub only
  lists `workflow_dispatch` once the workflow file is on the default branch. Until then, the push
  trigger is the way in.
- Put `[quick]` in the commit message for a quick check run (hero, close-up, variants and a few
  frames, about 6 minutes) instead of the full matrix.
- Watch it with `gh run watch <id>`. Each run uploads two artifacts: `bake-<n>` (everything) and
  `preview-<n>` (contact sheet, hero preview, close-up preview, reports; under 3 MB). Fetch the
  small one with `gh run download <id> -n preview-<n> -D .out/<folder>`. Download only into `.out/`.

Stages (each one is a separate Blender process, timed in the job summary):

| step | file | in -> out |
|---|---|---|
| 1 | `probe_mpfb.py` | MPFB2 + CC0 packs -> `work/body.blend`, `report/probe.json` (adult male, default rig, CC0 skin, eyes, brows, hair; second-face parts: second skin, second hair, CC0 beard) |
| 2 | `uniform.py` | -> `work/soldier.blend`, `report/uniform.json`. Garments, kit, rifle-musket, cap, brogans, skin shading; **all dimensions/colours in one table at the top** |
| 3 | `poses.py` | -> `work/posed.blend`, `report/poses.json`. Stand (shoulder arms), 8-frame march, aim/fire/recover, fallen, load (5); grip and clearance solves; motion checks |
| 4 | `render.py` | -> `frames/<tier>/*.png`, `frames/field_<variant>/*.png`, `variants/*.png`, `hero.png`, `hero-closeup.png`, `report/render.json` |
| 5 | `pack.mjs` | -> `atlas/soldier_<tier>_<page>.png`, `atlas/soldier_field_<variant>_<page>.png`, `atlas/soldier.json`, `contact-sheet.png`, `hero-preview.png`, `hero-closeup-preview.png` |

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
- `contact-sheet.png`: the sheet a person judges at a glance. Its six rows:
  - rows 1-2: all 16 standing directions;
  - row 3: the walk cycle;
  - row 4: aim, fire, recover, fallen, load 0-3;
  - row 5: load 4, then the variants slouch hat, fixed bayonet, no blanket roll, second face, mixed;
  - row 6: the field tier at 1:1, including the field-tier variants.
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

### Direction plan (this leg)

The close tier renders `stand` in all 16 directions and the other clips in the 8 even directions;
the field tier renders every clip in all 16. If the measured close-tier speed predicts the stage
running over `--budget-min`, field-tier variants are dropped first, then the close tier's non-stand
clips fall to 4 directions. `render.json` `reduced` and `field_variants` record what happened.

### Lighting (one standard light)

- **Key**: warm sun, azimuth 200 degrees (screen-left, slightly toward the viewer), elevation 52.
  This is `sun.to_sun_world` / `to_sun_screen`. It lights the figure only (light linking).
- **Ground shadow**: a second sun with the same azimuth at elevation 74 lights only the shadow
  catcher, so the cast shadow points the same way but is about 0.29 m per metre of height, and soft
  (9 degree source). In game the shadow is fixed on screen (it does not turn with the camera); it
  is kept short and soft so that is hard to notice.
- **Fills**, figure only, no ground shadow: cool rim from behind-right, soft frontal fill from the
  camera side (lifts faces out of the cap's shadow), and a green ground-bounce area light.
- **View transform: Standard** (was AgX). AgX desaturated the dark-blue coat to pale grey-blue on
  the field. The game applies its own grade and draws sprites as baked.

### Readability choices

- Field tier only: the musket's cross-section is scaled x1.7 (length unchanged) so it survives at
  96 px. Close tier and hero are true size.
- Straps and blanket are darker than the first pass so they do not out-shine the coat.

Direction rule: direction `d` faces `d * 360/N` degrees counter-clockwise, seen from above, from
"toward the camera". So 0 faces the viewer, 4 faces screen-right and 8 faces away. The camera
never moves. The figure turns, so the one standard light always reads as upper-left on screen.

## Measured numbers

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
| MakeHuman "bodyparts05" pack (beards and moustaches): https://files.makehumancommunity.org/asset_packs/bodyparts05/bodyparts05_cc0.zip (mirror files2.), page https://static.makehumancommunity.org/assets/assetpacks/bodyparts05.html | CC0 (the page lists every asset in it as CC0) | only `wdg_scruffy_beard` (author WDG) is used, on the second face |
| From the system pack, second face: `middleage_caucasian_male.mhmat` skin, `short04.mhclo` hair | CC0 1.0 (same system pack) | second face preset |
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

This branch does not edit `ATTRIBUTION.md`: no baked output is committed in this leg.

## History status

Every dimension, colour and drill position in `uniform.py` / `poses.py` is **Inferred or a
placeholder estimate**. None of it is Verified, because the project needs two independent sources
first, and no source was read in this leg. The tables say which is which. No person, unit or
regiment is depicted. Second-pass additions (garment cut, folds, brogan, cap seat, kit layout,
loading sequence, weathering colours) are all placeholder or recalled-and-Inferred. The belt,
breast and box plates are **plain ovals/discs with no lettering or eagle**. The sack coat has no
outside pocket line: my recollection is an inside breast pocket only, which is unverified.

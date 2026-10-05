# HANDOFF — from Claude Code to the next agent (2026-10-05)

Read in this order: `AGENTS.md` (the canon: stack law, machine law, history rule), `DESIGN.md` (the design of
record, ~180 rows chosen by Aaron), `STATE.md`, `PLAN.md`, the top of `DECISIONS.md`. This file adds what
those do not say: how to work with Aaron, where the work stopped, and what to do next.

## Working with Aaron (his standing preferences)
- First serious coding project. Explain what he would not know to ask; terse and direct; no emojis.
- Every question carries options with **one recommendation first and a one-line reason**. (Claude used
  popups; in chat, give a short numbered list and mark the recommended option.)
- **Show the actual images before any approval about looks** and before building on a visual choice.
  Number them to match the options. Never ask him to approve something he has only had described.
- When a complex visual approach fails once, switch to the simplest version that reads correctly at
  game size, and say so ("make less complicated if you can't make perfect").
- When he rejects a look without saying why, ask what is wrong (shape? placement? colour? size?) before
  proposing a fix.
- Don't stop for reversible work; stop only for the irreversible or the paid. Report failures first,
  plainly; name what was not run or not verified.
- Never ask him to free disk space or delete files. 8 GB Mac: one browser at a time; heavy work on
  GitHub Actions; all generated output in `.out/` (pruned by `tools/prune.mjs`).
- AGENTS.md section 5 names Claude models (Opus/Sonnet/Haiku); read it as "use your strongest model for
  code and engine judgement".

## Where it stopped
- `main` = 6aa3d6e + this handoff. CI green, Pages live: https://adhanke-star.github.io/the-civil-war/
  - `?sandbox` = the S1 sandbox (Look tab: "Soldier figures" rigged/baked, Compare, men per figure).
  - `reward.html?sandbox` = loot reward sequence on placeholder data. `device.html` = GPU test page.
- The game's baked soldier is the **second bake pass** (`assets/figures/union-infantry/`, Aaron approved
  it for fielding). Rigged 3D figures remain the default style.
- Branch `bake` (e41d05e) holds the bake pipeline (`tools/bake/`, `.github/workflows/bake.yml`, README with
  every measured number and licence). Passes: 2 = af78b02/f0b845a (on the field); 3 = a50968f (new faces,
  8 variants in both tiers, all clips in 16 directions, sharded into 22 jobs, ~23 min); 4 = e41d05e
  (fixed-fist hands). Bake previews live in `.out/bake2`, `.out/bake3`, `.out/bake4/final/preview-27`.
- **Hands: Aaron rejected all three hand versions** (passes 2, 3 and 4): "fingers bent oddly" and "hands in
  the wrong spot". He likes the pass-3 faces and variants. Nothing from passes 3-4 is in the game.

## Next, in order
1. **DONE 2026-10-05: hand references approved.** `docs/drill-reference.md` holds the sources, the plate
   per clip, the manual's words for each hand, and Aaron's choice: aim and loading as drawn in the 1861
   plates; shoulder arms and march on the RIGHT shoulder per Hardee's text (no correct plate exists).
   Re-download the plates into `.out/reference/drill/` from the URLs there (`.out/` is pruned).
2. **Next: rebuild the hands on `bake`.** Start from pass 3 (`git checkout a50968f -- tools/bake
   .github/workflows/bake.yml`), remove the per-finger solver and the pass-4 fist system, and pose hands and
   musket to `docs/drill-reference.md` with one simple natural closed hand. Check renders yourself against
   the plates, then show Aaron each clip's render beside its plate, plus the contact sheet. Field only after
   he approves.
3. Fielding a new bake: `src/units/impostor.js` reads per-frame `ax/ay/ppm`, `directionsByClip`,
   `tiers.<tier>.variants` (keep these manifest fields; the tier-level `pxPerMetre`/`anchor` mean the stand
   clip only). Close-tier variants are new in pass 3: assign the same variant per man at both tiers.
   Bump `VERSION` in `sw.js` whenever `src/` or assets ship. Update ATTRIBUTION.md.
4. Waiting on Aaron (remind once): play the sandbox and reward page on Mac and iPad and paste the
   "Copy settings" blocks; paste `device.html` results from both; run `gh auth refresh -s project,read:project`
   so a GitHub Project board can be created (DESIGN: To do / Building / For your review / Done).
5. S1 leftovers (PLAN.md): save export/import, capture crates on the field, reward sequence at the end of a
   fight, soldier's-eye key, under-fire halos louder than the baked shadow, walk bob, front-on poses hard to
   tell apart. Then S3 screens gallery, lock every sandbox topic, then R3 Shiloh.

## Checks and tools
- `npm test` (~3 min; Playwright + SwiftShader, about 1 fps, so never judge speed from it);
  quick loops: `node tools/test.mjs --unit | --field | --s1`; `node tools/test-reward.mjs`.
- Real GPU: `node tools/gpu-fps.mjs --figures` (headed Chrome on the UHD 617; **Aaron's Chrome must be
  closed**, ask him). Last numbers are in STATE.md.
- Screenshots: `node tools/shot.mjs <name> "<js>" <waitMs> "<query>"` -> `.out/shots/`.
- Bake: push to `bake` touching `tools/bake/**`, then `gh run watch`, `gh run download <id> -D .out/...`
  (download previews only; atlases are ~10 MB). Never run Blender on the Mac.
- After every push: `gh run list --limit 3`; a red CI is the next task.

## Loose ends
- Claude's helper worktrees and branches were removed (they held no unpushed work). Local branches left:
  `main`, `bake`, `figures-detail` (old, merged).
- Showing images: Aaron could not see images sent through Claude's file panel; `open -a Preview <files>`
  on his Mac worked. Use whatever actually puts the picture on his screen, and confirm he saw it.
- `NEW-civil-war-video-game.code-workspace` is Aaron's editor file: leave it alone, uncommitted.
- `git fetch` in the main checkout hung twice on 2026-10-04/05 while GitHub answered; kill and retry.
- Commit trailers: Claude used `Co-Authored-By: Claude ...`; use your own tool's convention.

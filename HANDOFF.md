# HANDOFF — Claude Code / Codex transfer (2026-10-05)

Read in this order: `AGENTS.md`, this file, `docs/drill-reference.md`, `DESIGN.md` (the design of
record, ~180 rows chosen by Aaron), `STATE.md`, `PLAN.md`, the top of `DECISIONS.md`. Read `COORDINATION.md`
immediately after AGENTS if one is created (none exists at this transfer). This file adds what
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
- `main` runtime = 1ef787c plus review-tool/documentation changes. CI 37337607722 and Pages 37337607579
  passed for 1ef787c; device.html now waits up to 30 s after warm-up to collect its existing five-frame
  minimum. Live: https://adhanke-star.github.io/the-civil-war/
  - `?sandbox` = the S1 sandbox (Look tab: "Soldier figures" rigged/baked, Compare, men per figure).
  - `reward.html?sandbox` = loot reward sequence on placeholder data. `device.html` = GPU test page.
- The game's baked soldier is the **second bake pass** (`assets/figures/union-infantry/`, Aaron approved
  it for fielding). Rigged 3D figures remain the default style.
- Branch `bake` (d7c07b2) holds the bake pipeline (`tools/bake/`, `.github/workflows/bake.yml`, README with
  every measured number and licence). Passes: 2 = af78b02/f0b845a (on the field); 3 = a50968f (new faces,
  8 variants in both tiers, all clips in 16 directions, sharded into 22 jobs, ~23 min); 4 = e41d05e
  (fixed-fist hands). Older previews were stored in `.out/bake2`, `.out/bake3`,
  `.out/bake4/final/preview-27`; any of them may have been pruned.
- Codex restored pass 3, removed per-finger solving and pass-4 fitting, and authored one closed hand with
  the approved trigger/pinch exceptions. Pass-5 baseline Bake 37336806292 at 58b9894 succeeded, but self-review
  found bent wrists; it is NOT an approval candidate. Full revised Bake 37342865320 at d7c07b2 succeeded,
  but self-review found loading hands hidden in the coat/face. It is NOT an approval candidate either.
  Next: move the loading musket forward enough to clear the body while preserving ground contact,
  centreline and middle-band station, then rebake and visually check every pose before Aaron's review.
  Run 37341611250 was superseded/cancelled. Local npm test passed at d7c07b2 (95 s); no new art is fielded.
- **Hands: Aaron rejected all three hand versions** (passes 2, 3 and 4): "fingers bent oddly" and "hands in
  the wrong spot". He likes the pass-3 faces and variants. Nothing from passes 3-4 is in the game.

## Next, in order
1. **DONE 2026-10-05: hand references approved.** `docs/drill-reference.md` holds the sources, the plate
   per clip, the manual's words for each hand, and Aaron's choice: aim and loading as drawn in the 1861
   plates; shoulder arms and march on the RIGHT shoulder per Hardee's text (no correct plate exists).
   Re-download the plates into `.out/reference/drill/` from the URLs there (`.out/` is pruned).
2. **Next: repair loading clearance and inspect the next hand bake.** Do not restore a50968f again over
   the rebuild. Bake 37342865320 and CI 37342865259 succeeded at d7c07b2, but the renders failed self-review.
   Download preview/reports only into `.out/`; never the posed
   .blend. Confirm all 18 pose frames, 16 directions, base + 8 variants in EACH tier (2,592 frames per tier,
   5,184 total). A successful or partial bake is not visual acceptance. Check wrists, hand contact,
   trigger/thumb, elbow heights, head on stock, right-shoulder carry and the whole march cycle yourself.
   Then `node tools/review-drill.mjs <preview-dir> <fresh-.out-review-dir>` creates 12 numbered sheets.
   Put all 12 on Aaron's screen with `open -a Preview <explicit files>`, confirm visibility in a popup,
   THEN ask approval. Do not field before explicit approval; ask what is wrong before re-fixing rejection.
3. Fielding a new bake: `src/units/impostor.js` reads per-frame `ax/ay/ppm`, `directionsByClip`,
   `tiers.<tier>.variants` (keep these manifest fields; the tier-level `pxPerMetre`/`anchor` mean the stand
   clip only). Close-tier variants are new in pass 3: assign the same variant per man at both tiers.
   Bump `VERSION` in `sw.js` whenever `src/` or assets ship. Update ATTRIBUTION.md.
   Do NOT merge the whole bake branch (its runtime is older); copy approved assets/tool seams only. Bind
   appearance by name across tiers, filter h7 (`use: usct`) to eligible units, and account for actual loaded
   RGBA/mipmap memory before loading all nine looks. DESIGN's per-battle iPad ceiling is about 250 MB;
   compressed files on disk are not graphics memory. iPad performance remains unverified.
4. Waiting on Aaron (remind once): play the sandbox and reward page on Mac and iPad and paste the
   "Copy settings" blocks; paste `device.html` results from both; run `gh auth refresh -s project,read:project`
   so a GitHub Project board can be created (DESIGN: To do / Building / For your review / Done).
5. S1 leftovers (PLAN.md): save export/import, capture crates on the field, reward sequence at the end of a
   fight, soldier's-eye key, under-fire halos louder than the baked shadow, walk bob, front-on poses hard to
   tell apart. Then S3 screens gallery, lock every sandbox topic, then R3 Shiloh.
   Recommended first slice after art fielding: save/export/import the reward prototype's completed
   army/depot state. `src/reward/sequence.js` already returns `{army,depot,issued,seed,grade}` on completion;
   `reward.html` displays it but does not persist it. Preserve item identities, reject invalid imports
   without mutation, and prove import/reload cannot reroll or duplicate loot. Settings copy/paste already
   works and is separate from progress. Do not start battle-state or campaign saves for this slice.

## Checks and tools
- `npm test` (~3 min; Playwright + SwiftShader, about 1 fps, so never judge speed from it);
  quick loops: `node tools/test.mjs --unit | --field | --s1`; `node tools/test-reward.mjs`.
- Real GPU: `node tools/gpu-fps.mjs --figures` (headed Chrome on the UHD 617; **Aaron's Chrome must be
  closed**, ask him). Last numbers are in STATE.md.
- Screenshots: `node tools/shot.mjs <name> "<js>" <waitMs> "<query>"` -> `.out/shots/`.
- Bake: push to `bake` touching `tools/bake/**`, then `gh run watch`; download the named preview/report
  artifacts only into `.out/`. Full bake artifacts include raw frames: package optimized atlases and the
  manifest on Actions before local fielding if the full archive is over 100 MB. Never download .blend or
  run Blender on the Mac. A push to bake paths cancels the active bake; do not interrupt it for doc edits.
- After every push: `gh run list --limit 3`; a red CI is the next task.

## Loose ends
- Claude's helper worktrees and branches were removed (they held no unpushed work). Local branches left:
  `main`, `bake`, `figures-detail` (old, merged).
- Showing images: Aaron could not see images sent through Claude's file panel; `open -a Preview <files>`
  on his Mac worked. Use whatever actually puts the picture on his screen, and confirm he saw it.
- Baxter archive image indexing differs from scandata leafNum. Printed-page-checked URLs:
  p45=n46, p46=n47, p48=n49, p51=n52, p52=n53, p53=n54 in
  `https://archive.org/download/volunteersmanual01baxt/page/n<index>_w1100.jpg`. Verify printed numbers.
- `.out/` is capped at 300 MB and routinely pruned. Current review material may disappear; redownload
  Actions artifacts (7-day expiry) and plates rather than making an evidence catalog or offload.
- `NEW-civil-war-video-game.code-workspace` is Aaron's editor file: leave it alone, uncommitted.
- `git fetch` in the main checkout hung twice on 2026-10-04/05 while GitHub answered; kill and retry.
- Commit trailers: Claude used `Co-Authored-By: Claude ...`; use your own tool's convention.

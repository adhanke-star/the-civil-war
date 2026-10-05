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
- Branch `bake` (820846f) holds the bake pipeline (`tools/bake/`, `.github/workflows/bake.yml`, README with
  every measured number and licence). Passes: 2 = af78b02/f0b845a (on the field); 3 = a50968f (new faces,
  8 variants in both tiers, all clips in 16 directions, sharded into 22 jobs, ~23 min); 4 = e41d05e
  (fixed-fist hands). Older previews were stored in `.out/bake2`, `.out/bake3`,
  `.out/bake4/final/preview-27`; any of them may have been pruned.
- Codex restored pass 3, removed per-finger solving and pass-4 fitting, and authored one closed hand with
  the approved trigger/pinch exceptions. Pass-5 baseline Bake 37336806292 at 58b9894 succeeded, but self-review
  found bent wrists; it is NOT an approval candidate. Full revised Bake 37342865320 at d7c07b2 succeeded,
  but self-review found loading hands hidden in the coat/face. It is NOT an approval candidate either.
  Latest 820846f adds a small forward loading lean (an art estimate) to clear the coat/face while
  preserving ground contact, centreline and middle-band station; the trigger forefinger curls into the
  guard. Full Bake 37347072866 and CI 37347072709 passed. Self-review passed every clip, including the
  eight-frame march cycle. Recovery and priming remain abbreviated game stages; sheet 7 shows the
  cartridge held above the muzzle BEFORE charging (the manual's Fig78 shows the OPEN hand afterward).
  Twelve numbered sheets in `.out/bake5/review-33/` were opened in Preview. Aaron confirmed visibility,
  then explicitly approved this revision for fielding in separate popups (2026-10-05). Do not ask again.
  Run 37341611250 was superseded/cancelled. Local npm test passed at 820846f (94 s); no new art is fielded.
- **Hands: Aaron rejected all three hand versions** (passes 2, 3 and 4): "fingers bent oddly" and "hands in
  the wrong spot". He likes the pass-3 faces and variants. Nothing from passes 3-4 is in the game.

## Next, in order
1. **DONE 2026-10-05: hand references approved.** `docs/drill-reference.md` holds the sources, the plate
   per clip, the manual's words for each hand, and Aaron's choice: aim and loading as drawn in the 1861
   plates; shoulder arms and march on the RIGHT shoulder per Hardee's text (no correct plate exists).
   Re-download the plates into `.out/reference/drill/` from the URLs there (`.out/` is pruned).
2. **DONE 2026-10-05: Aaron saw and approved sheets 1–12 for 820846f.** Do not restore
   a50968f again over the rebuild. Bake 37347072866 and CI 37347072709 passed; self-review passed. Earlier
   Bake 37342865320 and CI 37342865259 succeeded at d7c07b2, but the renders failed self-review.
   Download preview/reports only into `.out/`; never the posed
   .blend. Confirm all 18 pose frames, 16 directions, base + 8 variants in EACH tier (2,592 frames per tier,
   5,184 total). A successful or partial bake is not visual acceptance. Check wrists, hand contact,
   trigger/thumb, elbow heights, head on stock, right-shoulder carry and the whole march cycle yourself.
   Current preview: `.out/bake5/preview-33/`. If pruned, download named `preview-33` from run 37347072866.
   `node tools/review-drill.mjs <preview-dir> <fresh-.out-review-dir> "Bake 37347072866 at 820846f"`
   creates 12 numbered sheets with the run/SHA printed on them.
   Approval covers the pictured poses, including abbreviated recovery/priming and the pre-charge cartridge
   in sheet 7. Compression must preserve that look; quality readback and integration remain required.
3. Fielding a new bake: `src/units/impostor.js` reads per-frame `ax/ay/ppm`, `directionsByClip`,
   `tiers.<tier>.variants` (keep these manifest fields; the tier-level `pxPerMetre`/`anchor` mean the stand
   clip only). Close-tier variants are new in pass 3: assign the same variant per man at both tiers.
   Bump `VERSION` in `sw.js` whenever `src/` or assets ship. Update ATTRIBUTION.md.
   Do NOT merge the whole bake branch (its runtime is older); copy approved assets/tool seams only. Bind
   appearance by name across tiers, filter h7 (`use: usct`) to eligible units, and account for actual loaded
   RGBA/mipmap memory before loading all nine looks. DESIGN's per-battle iPad ceiling is about 250 MB;
   compressed files on disk are not graphics memory. iPad performance remains unverified.
   Pass-5 run 33 has 5,184 frames, 79.80 MiB of atlas PNGs and 797.27 MiB of RGBA8/mipmap texture memory
   across all tiers/looks (36 close pages + 9 field pages; manifest 1,142,071 bytes). It cannot be loaded
   wholesale under the iPad ceiling. Implement DESIGN's compressed atlases/per-battle loading before
   fielding the full set. Preserve all nine looks in both tiers; do not silently remove variants.
   `.github/workflows/pack-figures.yml` repackages the approved existing run on Actions only (no rerender).
   `tools/bake/compress.mjs` checks every frame/look/eligibility record, premultiplies display bytes once,
   encodes with pinned KTX-Software 4.4.2 UASTC quality 4/Zstd 18/box mipmaps and marks the KTX DFD flag.
   `tools/bake/review-compression.mjs` checks GPU readback of every page at mips 0/1/2, real decoded format,
   complete mip allocation and missing-pixel/colour controls; it produces small numbered comparison sheets.
   **HALT:** Package 37360904656 at 3f439b0 encoded all 45 pages, preserving 5,184 frames and nine looks/tier.
   KTX files total 47.3972 MiB; actual SwiftShader format was `RGBA_BPTC_Format` (BC7), 199.3999 MiB with
   all mip levels. Counts, DFD premultiplication and decoded allocations passed; quality failed 45/45 pages.
   Field mip0 mean RGB error 2.26–2.37 (limit 2), alpha-edge 95th-percentile error 15 (limit 8); field mip2
   mean RGB 4.01–4.18, mean alpha 2.09–2.27 (limit 1), edge-alpha 23–24. Severe body clipping was zero.
   Identical/missing-pixel/changed-colour controls all behaved correctly. Main CI 37360906768 and Pages
   37360907081 passed for 3f439b0. No optimized asset artifact was published because the quality gate failed.
   Small `compression-review` artifact only (6,987,828 bytes); local readback:
   `.out/figure-pack-review-37360904656/{compression,quality}.json` and ten numbered PNG sheets.
   Sheets 1, 7 and 10 inspected locally; this is not whole-set visual or iPad clearance.
   The workflow now defaults to `mode=diagnostic`: ONLY `soldier_close_0.png` and `soldier_field_0.png`,
   with the same premultiplied input and box mip recipe in raw RGBA8 KTX and UASTC. GPU readback separates
   PNG/typed upload, PNG/raw offline mips, raw/UASTC→RGBA encoding and RGBA/BC7 transcoding at mips 0/1/2.
   Real upload/base/identity controls and complete allocations must pass; every route keeps the original
   pixel thresholds. `diagnosticComplete` is evidence completion, never quality or fielding clearance;
   `quality.json` stays `ok:false, fieldable:false`. Diagnostic mode cannot publish optimized assets.
   Diagnostic readback is complete (below). Next bounded task: resolve the codec experiment boundary;
   do not weaken thresholds, rerender the approved poses or field.
   Do not rerun the unchanged 24-minute encoder as a diagnostic. Prepare only the required small diagnostic
   outputs on Actions; full bake archives/raw frames/.blend never belong on the Mac.
   **Measured codec HALT (2026-10-05):** diagnostic 37374456139 attempt 1 at tool commit
   `47d248ca0a6ea9be81d19dfde333da6b4a637cf0` succeeded, as did CI 37374382896 and Pages 37374382736.
   Downloaded only `compression-review` (1,588,785 bytes, artifact 11371700695) into
   `.out/figure-diagnostic-37374456139/`; inspected both actual sheets and every metric. Source PNG AND
   encoded KTX hashes match the failed full run; all six end-to-end mip metrics reproduce it exactly.
   Both pages have all six routes at mips 0/1/2. All ten actual upload/base/identity/missing/colour
   controls pass; PNG/typed upload and raw identity have zero error. PNG/raw base has zero error;
   offline mip differences stay within limits (RGB mean <= .127; RGB/alpha edge p95 <= 1).
   Raw and UASTC-to-RGBA use RGBAFormat, 19,747,996 B/12 levels close and 10,441,740 B/11 levels field;
   BC7 uses RGBA_BPTC_Format, 4,937,968 B close and 2,611,264 B field. Complete chains, premultiplied
   metadata and GL integrity pass. `diagnosticComplete:true`, `ok:false`, `fieldable:false`; no asset artifact.
   UASTC reconstruction already fails BEFORE BC7: close mip1 RGB/alpha edge p95 9/12 (limits 8/8);
   field mip0 RGB mean 2.309 and edges 11/15; mip1 mean 3.309/1.212, edges 14/19; mip2 mean 4.157/2.106,
   edges 17/23. Close mip2 also fails. Additional RGBA-to-BC7 loss passes at every measured mip
   (RGB mean <= .529, edge RGB <= 2, edge alpha <= 4). Zero severe body clipping everywhere.
   Conclusion is specific to this recipe and two pages: UASTC encode/decode reconstruction is the main
   failing stage; upload, offline mip generation and BC7 conversion are not sufficient explanations.
   Sheets preserve coarse pose/silhouette, with small-mip colour/edge differences; six crops/page are
   not whole-pack or hand/pose clearance. Do not accept visual resemblance in place of the quality gate.
   **Recommendation:** a separately authorized two-page feasibility experiment with direct GPU-format
   encoding (bypassing UASTC), preserving the approved input, mip/colour/alpha semantics and thresholds.
   Establish OSI encoder licenses, pinned tools, actual supported desktop/iPad targets, fallback and
   total-memory implications before implementation; no codec success or device clearance is assumed.
   Alternatives: assess lossless per-battle residency (larger runtime slice), or ask Aaron to explicitly
   redefine acceptance after seeing the actual differences. Neither is authorized here. No more identical
   diagnostic/full runs; quality 4 is already used. Removing unused close mip2 cannot fix active failures.
   Runner failures remain separate: CI 37374692590 at 283ed16 attempt 1 and CI 37364379516 at a663090
   attempt 2 failed with no steps; annotations say hosted runner not acquired. Retried those exact runs
   once after successful hosted diagnostic/CI execution. CI 37374692590 attempt 2 at 283ed16 now passes;
   reconcile 37364379516 attempt 3 before retrying. Local syntax/unit checks and `npm test` pass again
   (168071 ms) for this documentation-only readback; no diagnostic or runtime code changed.
   GitHub status still reported degraded performance at 21:31 UTC (incident 3q1yb5m7ltvb); do not assume
   global recovery. Pages 37374692540 at 283ed16 passed. No local conversion/GPU diagnosis/Blender ran.
   After a scoped fix: `gh workflow run pack-figures.yml --ref main -f mode=full`; inspect exact run, download ONLY
   `compression-review`, then `approved-figures-ktx2` after every gate passes. Packaging is not fielding.
   Runtime KTX vendoring, name-bound identity, ninth counters, eligibility and total-scene admission are next.
   The existing baked-height unit check decodes PNGs; adapt it using actual compressed GPU readback/geometry
   evidence without discarding its feet/clip-scale assertions. Include geometry/render targets in admission.
   The local smoke exposed an existing count mismatch: rigged includes infantry still falling, while baked
   standing excludes FALLEN. The comparison now separates standing/falling and checks fallen sprite coverage;
   broken controls must still reject missing living or fallen figures. No runtime code changed for that fix.
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

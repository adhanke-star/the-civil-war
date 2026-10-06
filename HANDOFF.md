# HANDOFF — Claude Code / Codex transfer (current plan: 2026-10-06)

Read in this order: `AGENTS.md`, this file, `docs/drill-reference.md`, `DESIGN.md` (the design of
record, ~180 rows chosen by Aaron), `STATE.md`, `PLAN.md`, the top of `DECISIONS.md`. Read `COORDINATION.md`
immediately after AGENTS if one is created (none exists at this transfer). This file adds what
those do not say: how to work with Aaron, where the work stopped, and what to do next.

## Current boundary: P1 reward persistence implemented (2026-10-06)

Goal mode is active for complete existing v1 under DESIGN/DECISIONS 0022 and PLAN P1-P7. Codex owns
the active engineering loop; no other provider writer or COORDINATION.md was observed at startup.
No schedule was created. Preserve the untracked workspace file; the old Desktop repo stays read-only.
Remaining weekly capacity is unknown. Native iPad access and acceptance remain unestablished.

`src/franchise/save.js` is the single progress seam, key `cw.progress`, version-1 completed-reward
envelope. It preserves army/depot/equipment/issued/seed/grade/award identity; recomputes OVR; validates
gear, bounds, uniqueness and reverse transfer history; accepts only complete snapshots <=1 MiB UTF-8.
Imports replace once, never merge. Compact exports round-trip at the bound. Same-award callbacks
perform no additional write. New demos acknowledge a live previous snapshot; pending retries keep
that exact baseline even after previews. Blocked reads do not auto-roll; quota failure retains pending
export/retry and previous stored bytes. Reward demo, preferences and lock behavior remain available.

P1 also adds resume/export/import/retry and replacement confirmation controls to reward.html;
48px targets, narrow-screen scrolling, focus return/trapping and launcher inertness are exercised.
Save/source review caught and repaired oversized pretty exports and stale replacement authorization.
Independent WCAG/screenshot review caught dimmed resumed stats; restored cards now use full contrast.
Compare ARIA and key-hint contrast were repaired in scope. Runtime cache is `cw-v5`.
No reward rebalance, texture/codec/art/renderer/simulation change occurred. No campaign or live-battle save.

Local final gates passed: `node tools/test-reward.mjs` 20/20; `--prove-fail` 20/20 intended assertions;
`node tools/test.mjs --unit`; final `npm test` 76/76 in 202044 ms. Readback timestamp
2026-10-06T14:50:20.550Z, .out/last-result.json; six reward screenshots include the native import dialog.
Compare/resume/import/launcher axe each report zero violations. Actual screenshots were inspected.
Full smoke includes compare/resume/import/launcher axe, keyboard, equip/reload/file transfer, repeated
callbacks, quota export/retry, external conflict + preview + retry, blocked startup/retry, 1024/320 layout.
Check exact-HEAD CI and Pages via PLAN's gh commands before proceeding. CI now runs both reward modes.
Baseline battle/sandbox still has the separate moderate meta-viewport finding; emulation is not iPad proof.

Next product slice: P2 continuous practice loop. Inspect src/main.js result path (~210), Game objective
completion (~465), Hud.result (~453), index.html result/menu, src/units/unit.js and scenario weapon/source
data before specifying the bridge. Connect actual surviving brigades/captures to rewards and Continue;
retain a distinct explicit reward demo. Build the two-vs-one introductory fight with first loot about a
minute, capturable/retakable crates, saved army return and obvious next action in focused green commits.
Do not silently change historical unit labels/arms or reset survivors to SAMPLE_ARMY. Standalone historical
Battles mode must ultimately grant no franchise loot. Full campaign packs/three slots belong to P4.

Read-only art assessment: existing BakedAtlas loads all pages in a tier together and retains them;
memoryBytes ignores pending, image decode, batch buffers and total scene. Full approved RGBA+mips
835,971,548 B cannot fit. Eight eligible field looks + one close page each already cost
241,074,464–258,639,136 B, before ground/info ~27.96 MB and the rest. Preserve all nine looks including
USCT eligibility, name binding, anchors and directions. Next bounded art hypothesis is an Actions-only
approved-manifest/demand/transition estimator with pending/decode/disposal/scene reserves; not a codec
rerun or fielding. Exact clip/page demands and native allocations are still unmeasured. PLAN retains
the immutable byte gates and failed-pack boundary. Continue P2 independently of those gaps.

## Historical planning boundary: autonomous v1 plan ready (2026-10-06)

Read DECISIONS 0022 and PLAN's complete P1 contract. Aaron's latest choices: finish existing v1
(Shiloh, Stones River, Chattanooga and all v1 systems), no hard deadline, no new spending, **no
hands-on checks**. He undid the brief whole-vision answer and the one-device-check answer. Mac/iPad
remain targets. Keep an expansion roadmap; reuse old strategy only when playable review shows fun
and clear flow. Routine design, art, implementation and acceptance choices belong to the agent.

This supersedes the approval/popup/device-playtest waits below. Preserve their historical evidence
and quality restrictions: failed texture candidates remain unfieldable, but bounded feasibility and
repairs can proceed autonomously. First implementation: completed reward-state persistence/export/
import and reward CI coverage (PLAN P1); start read-only art residency feasibility independently.
One progress-store seam is planned at src/franchise/save.js; do not build campaign/battle saves yet.
No product code or assets changed in this planning session; no goal/schedule was activated.

Startup assessed main/origin/main at bde3939463e11783b47b5f2ea87ff1e42671ae77, CI 37404610471 and
Pages 37404610443 success. Preserve untracked NEW-civil-war-video-game.code-workspace. No COORDINATION
file or other active build/provider writer was observed; recheck on resume. PLAN/STATE hold the newest
state; never use an older SHA here to overwrite newer work. Old Desktop repo stays frozen/read-only.
Actual iPad automation access remains unestablished: emulation/WebKit cannot certify A10X GPU/memory.
Continue independent work; do not ask Aaron for hands-on evidence or mark device acceptance complete.

Planning verification: independent source/design coverage review found no material omissions.
Local `node tools/test.mjs --unit`, reward positives (10/10) and `--prove-fail` (10/10 caught) passed.
`npm test` passed in 177073 ms after a sandbox loopback-bind EPERM; the initial harness failure is
retained in `.out/planning-20261006-sandbox-failure.json`, passing readback in `.out/last-result.json`.
Existing axe checks still report a minor/moderate meta-viewport finding outside their serious/critical
filter. This is baseline smoke proof, not complete accessibility, native-device or gameplay clearance.
Existing prune finished at 299.7 MiB. No new native GPU run, iPad run or renderer experiment occurred.

## Historical renderer boundary: candidate complete, quality HALT (2026-10-05)

Aaron authorized the recommended two-page BC7 + ASTC diagnostic (“authorize all recs”). It is now
COMPLETE: candidate run 37404193171, attempt 1, tool SHA becad673675cc66f4a2dca3574d3b181c259bd42.
All 18 controls, hash/metadata/complete-chain checks and all 54 unique comparison rows pass evidence
completion; both candidates fail unchanged quality limits. Both actual sheets and every metric inspected.
No optimized assets published and no art/runtime/default/threshold changes. Earlier pending-scope
statements below are historical, not requests to approve the completed experiment again.
Next scope popup recommends read-only lossless per-battle loading feasibility; decision pending.
No further encoding, codec sweep, full packaging or runtime fielding is authorized at this HALT.

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
   Diagnostic readback and read-only feasibility are complete (below). Next bounded task: Aaron's scope decision;
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
   CI 37364379516 attempt 3 at a663090 also passes (reverified during feasibility). Local syntax/unit checks and `npm test` pass again
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

## Direct candidate measured readback (2026-10-05)

Tooling 15dfacc: CI 37403337062 and Pages 37403337065 SUCCESS, attempt 1. Setup-only candidate
37403600015 failed before encoding: pinned ert.h omits <cstdint> under GNU 13.3.0. CMake force-includes
that standard header, preserving the source archive/commit and encoding settings. Build fix becad67:
CI 37403837914 and Pages 37403837871 SUCCESS, attempt 1. Replacement candidate **37404193171** at
becad673675cc66f4a2dca3574d3b181c259bd42 SUCCESS, attempt 1, 1m47s. This was the first actual encoding
experiment, not an encoder sweep. Ubuntu image ubuntu24 / 20260927.320.1; Node v24.21.0; CMake 3.31.6;
GNU C++ 13.3.0; bc7enc 1.08; KTX 4.4.2. Both archive checksum checks passed; all 39 recorded commands
exited zero. BC7 source unchanged, SUPPORT_BC7E=OFF; no ISPC execution, RDO or perceptual metrics.

Only compression-review published: artifact 11386497801, archive 1,672,840 B, archive SHA256
9f51e8efb7205fbb257ea88bd3e9e1414097a73e737bca316bf0d2761efd8c69. No approved-figures-ktx2 artifact.
Local small regular files: .out/figure-candidate-37404193171/compression.json (80,363 B), quality.json
(56,042 B), compression-candidate-close.png (831,345 B), compression-candidate-field.png (860,808 B).
No encoded/raw atlases downloaded. Both actual comparison sheets inspected, coarse poses/silhouettes
preserved; small-mip edge/colour differences remain. Six crops/page do not clear all hands/poses or looks.
The sheets show PNG / raw / direct BC7 WebGL / ASTC SOFTWARE; they do not show ASTC WebGL imagery.

candidateEvidenceOkay(actual quality.json)=true; candidateComplete=true, diagnosticOnly=true,
ok=false, fieldable=false. Both pages have 27 unique route/mip rows (mips0/1/2, nine routes):
png->premul, png->raw, raw->raw, raw->bc7-gpu, png->bc7-gpu, raw->astc-software,
png->astc-software, raw->astc-gpu, png->astc-gpu. All samples nonempty and metrics finite;
severe body clipping is zero in every row. All 18 Upload/RawBase/Identity/Missing/Colour/WrongAlpha/
DoublePremul/AutomaticSrgb/Unsupported controls pass. Erroneous alpha, second multiplication and extra
sRGB decode controls are rendered shader mutations; unsupported capabilities are rejected before upload.
PNG/typed upload and raw identity are zero-error; raw upload matches original mip bytes exactly.
PNG/raw mip0 is zero-error; offline mip RGB mean <=.127 and edge RGB/alpha p95 <=1.
Full approved manifest validated: 45 pages, 5,184 frames, nine looks per tier, all identity/use/frame metadata.
Original PNG/raw hashes match the historical diagnostic. Historical UASTC 37374456139 is included with
its original hash-bound report and controls, labeled HISTORICAL; it was not rerun or approved as fallback.

Actual renderer is Actions **SwiftShader**, not native Mac/iPad. Both BPTC and ASTC extensions were
exposed, linear formats 0x8e8c/0x93b0 advertised, ASTC profiles included ldr, MAX_TEXTURE_SIZE=8192.
BC7 AND ASTC WebGL readback RUN, independently of ASTC software decode RUN. No unsupported format
was forced. All 18 GL error checks/page are zero. Formats RGBAFormat / RGBA_BPTC_Format /
RGBA_ASTC_4x4_Format; vkFormat 37/145/157, linear DFD, primaries none, premultiplied metadata,
typed premultiplyAlpha=false, flipY=false, NoColorSpace, generateMipmaps=false. Full mip/payload
hashes and metadata-only edits pass, including tiny tails; 12 levels close and 11 field. Each compressed
family allocates 4,937,968 + 2,611,264 = 7,549,232 B; raw allocates 30,189,736 B. Container files total
BC7 7,550,144 B and ASTC 7,550,192 B, no supercompression. Both families are about 14.40 MiB combined.

Unchanged byte limits: RGB mean<=2, alpha mean<=1, edge RGB/alpha p95<=8/8, clipping=0.
End-to-end actual results (software/WebGL numbers differ slightly; verdicts agree):

| Page | Route | Mip | RGB mean | Alpha mean | Edge RGB/alpha p95 | Pass |
|---|---|---:|---:|---:|---|---|
| close | png->bc7-gpu | 0 | 0.985 | 0.224 | 6/8 | yes |
| close | png->astc-software | 0 | 0.808 | 0.106 | 5/5 | yes |
| close | png->astc-gpu | 0 | 0.782 | 0.102 | 5/5 | yes |
| close | png->bc7-gpu | 1 | 1.583 | 0.390 | 8/12 | NO |
| close | png->astc-software | 1 | 1.230 | 0.193 | 6/7 | yes |
| close | png->astc-gpu | 1 | 1.243 | 0.189 | 6/7 | yes |
| close | png->bc7-gpu | 2 | 2.490 | 0.756 | 12/18 | NO |
| close | png->astc-software | 2 | 1.868 | 0.363 | 9/9 | NO |
| close | png->astc-gpu | 2 | 1.873 | 0.360 | 9/9 | NO |
| field | png->bc7-gpu | 0 | 1.987 | 0.647 | 10/14 | NO |
| field | png->astc-software | 0 | 1.585 | 0.336 | 8/8 | yes |
| field | png->astc-gpu | 0 | 1.578 | 0.332 | 8/8 | yes |
| field | png->bc7-gpu | 1 | 2.939 | 1.254 | 13/20 | NO |
| field | png->astc-software | 1 | 2.176 | 0.629 | 10/10 | NO |
| field | png->astc-gpu | 1 | 2.190 | 0.628 | 10/10 | NO |
| field | png->bc7-gpu | 2 | 3.751 | 2.224 | 16/25 | NO |
| field | png->astc-software | 2 | 2.750 | 1.102 | 12/13 | NO |
| field | png->astc-gpu | 2 | 2.749 | 1.104 | 12/13 | NO |

Raw->direct rows independently reach the same pass/fail verdicts. BC7 passes only close mip0 (1/6);
ASTC software and WebGL pass close mips0/1 and field mip0 (3/6 each). Active close mip1 still fails
BC7; active field mip1 fails both. Bypassing UASTC improves this candidate's errors but is insufficient
to meet the existing complete acceptance contract. This does not prove every BC7/ASTC configuration
fails. No route metrics were subtracted to invent additive attribution. No threshold tuning, mip removal,
alpha dilation, source mutation, new art, full conversion, runtime integration or native/iPad benchmark.

**HALT / recommendation:** define read-only lossless per-battle loading feasibility next, because it
preserves approved bytes/limits rather than repeating lossy candidates. Assess frame/look subsets,
loaded+pending residency, total scene/transient memory and downloads from existing data/code; return a
concrete bounded proposal before implementation. The scope popup is pending; no such implementation
is authorized. Alternatives: explicitly review limits with actual sheets, or separately approve an
all-mode BC7E proposal. Do not execute either silently. Full compressed extrapolation still 209,085,952 B
before terrain/geometry/targets; full raw 797.24 MiB cannot load wholesale. No fallback/new device clearance.

## Direct-format feasibility proposal (2026-10-05; awaiting scope decision)

Read-only feasibility is complete. **No encoder experiment, codec switch, threshold change or new art
fielding has been authorized.** The recommendation is one Actions-only two-page experiment, encoding
the approved bytes directly to **BC7 UNORM and ASTC 4x4 UNORM**, bypassing UASTC. It is a diagnostic
tool change, not a runtime replacement. Keep existing defaults and full packaging unchanged. The
following commands are a proposed implementation contract; they were source-reviewed, NOT executed.

### Tools, pins and licenses

- **BC7:** `richgel999/bc7enc_rdo`, CLI version **1.08**, immutable commit
  `b9438627eef73a1157e84201b6fa6eb2ffd6d9f0`. Choose its MIT license; retain bundled LodePNG's zlib
  notice and miniz's Apache-2.0 notice (checked in the actual pinned headers, not inferred from the
  top-level LICENSE). Build the C++ encoder with `SUPPORT_BC7E=OFF`: no ISPC download/execution.
  Upstream documents Linux clang and Windows MSVC builds; its CMake uses OpenMP. Mac compilation is
  not verified or needed. This commit has no binary release/checksum; the source archive was streamed
  and hashed without saving/building it locally: **15,085,185 B**, SHA256
  `bbb33d1dbb6178a3a2c044956c3cc0b8ea9fc2f2903824379dd86f87d53b64c6`.
  This is an independently measured archive pin, not an upstream signed release checksum.
- **ASTC and KTX container tools:** retain **KTX-Software 4.4.2**, Apache-2.0, Linux x86_64 archive
  SHA256 `a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245` (existing workflow pin).
  Its bundled ASTC encoder identifies itself as **5.3.0** in its CMakeLists. `ktx encode` supports
  direct ASTC from raw RGBA KTX; `ktx create --raw` packages preencoded BC7 blocks without reencoding.
  This avoids adding a second ASTC installation or writing a new KTX container implementation.
- Standalone **Arm astcenc 5.3.0**, Apache-2.0, is a feasible alternative, not a second candidate run:
  it supports RGBA PNG input and direct LDR `-cl input.png output.astc 4x4 -exhaustive` encoding.
  Official Linux x64 release SHA256:
  `495b2f0cf0357ae05728a727e3d0e81d6e7f27b242c21cb5ef6254dd56dba5ff`.
  Official binaries also exist for Linux arm64, macOS universal and Windows arm64/x64.
  No standalone binary was downloaded or run.
- AMD Compressonator 4.5.52 is another direct BC7 encoder (MIT), but its latest release API supplies
  no asset digest, and its release notes flag a source-build dependency issue. Do not add a third
  encoder to this slice or imply its release/toolchain was verified.

Source references (primary, pinned where applicable):
[BC7 CLI/build](https://github.com/richgel999/bc7enc_rdo/tree/b9438627eef73a1157e84201b6fa6eb2ffd6d9f0),
[BC7 license](https://github.com/richgel999/bc7enc_rdo/blob/b9438627eef73a1157e84201b6fa6eb2ffd6d9f0/LICENSE),
[LodePNG notice](https://github.com/richgel999/bc7enc_rdo/blob/b9438627eef73a1157e84201b6fa6eb2ffd6d9f0/lodepng.cpp),
[miniz notice](https://github.com/richgel999/bc7enc_rdo/blob/b9438627eef73a1157e84201b6fa6eb2ffd6d9f0/miniz.h),
[ASTC release/checksums](https://github.com/ARM-software/astc-encoder/releases/tag/5.3.0),
[KTX encode](https://github.com/KhronosGroup/KTX-Software/blob/v4.4.2/tools/ktx/command_encode.cpp),
[KTX raw create](https://github.com/KhronosGroup/KTX-Software/blob/v4.4.2/tools/ktx/command_create.cpp),
[ASTC options](https://github.com/KhronosGroup/KTX-Software/blob/v4.4.2/tools/ktx/encode_utils_astc.h),
[ASTC implementation](https://github.com/KhronosGroup/KTX-Software/blob/v4.4.2/lib/astc_codec.cpp),
[bundled ASTC version](https://github.com/KhronosGroup/KTX-Software/blob/v4.4.2/external/astc-encoder/CMakeLists.txt),
[Compressonator release](https://github.com/GPUOpen-Tools/compressonator/releases/tag/V4.5.52).

### Proposed Actions commands and byte contract

Use `ubuntu-24.04`, one page/candidate at a time, a fresh guarded runner output, and existing approved
source retrieval (run 37347072866 / 820846f / bake-33). Source and build pins fix the recipe; record
runner image, `cmake --version`, `g++ --version`, tool versions, complete argv and output hashes.
Build success and binary reproducibility are still UNRUN; do not call reviewed commands proven.

```bash
# PROPOSED ONLY: after explicit two-page experiment authorization, on Actions.
curl -fsSL --retry 3 -o "$RUNNER_TEMP/bc7-source.tar.gz" https://codeload.github.com/richgel999/bc7enc_rdo/tar.gz/b9438627eef73a1157e84201b6fa6eb2ffd6d9f0
echo "bbb33d1dbb6178a3a2c044956c3cc0b8ea9fc2f2903824379dd86f87d53b64c6  $RUNNER_TEMP/bc7-source.tar.gz" | sha256sum -c -
mkdir "$RUNNER_TEMP/bc7-source"
tar -xf "$RUNNER_TEMP/bc7-source.tar.gz" -C "$RUNNER_TEMP/bc7-source" --strip-components=1
cmake -S "$RUNNER_TEMP/bc7-source" -B "$RUNNER_TEMP/bc7-build" -DCMAKE_BUILD_TYPE=Release -DSUPPORT_BC7E=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$RUNNER_TEMP/bc7-build" --parallel 2
# Install/check KTX 4.4.2 using the exact existing workflow URL/SHA256; do not use latest.
# Node orchestration invokes this once per original raw mip, preserving dimensions and RGBA bytes:
"$RUNNER_TEMP/bc7-build/bc7enc" -C -u4 -p64 -g level.png level.dds
# Extract only the DX10 DDS BC7_UNORM payload in Node, assert original w/h and exact block byte count.
# In a Node spawnSync argv array: ordered mip0.raw ... mip11.raw, then the destination (no ellipsis argument):
ktx create --raw --format BC7_UNORM_BLOCK --width 2048 --height 1808 --levels 12 --assign-tf linear --assign-primaries none mip0.raw mip1.raw mip2.raw mip3.raw mip4.raw mip5.raw mip6.raw mip7.raw mip8.raw mip9.raw mip10.raw mip11.raw close-bc7.ktx2
# Field uses 1024x1912, 11 inputs (mip0.raw through mip10.raw), and its own destination.
ktx encode --format ASTC_4x4_UNORM_BLOCK --astc-quality exhaustive close-raw.ktx2 close-astc.ktx2
ktx encode --format ASTC_4x4_UNORM_BLOCK --astc-quality exhaustive field-raw.ktx2 field-astc.ktx2
# Software ASTC reconstruction only; repeat --level 0, 1 and 2 for each page:
ktx extract --level 0 close-astc.ktx2 close-astc-mip0.png
```

BC7 uses linear byte-error metrics, no perceptual option, RDO, entropy reduction, Y flip or alpha
replacement. This deliberately tests its C++ encoder (modes 1/5/6/7), not the higher-quality all-mode
BC7E/ISPC encoder. Failure would be specific to this candidate, not proof that direct BC7 cannot pass.
ASTC uses LDR linear encoding, identity RGBA swizzle, no normal/perceptual mode. No encoder makes mips.

Generate the raw KTX with the unchanged `toktx --t2 --genmipmap --filter box --assign_oetf linear
--assign_primaries none` recipe from the same once-premultiplied PNG. Extract its actual level bytes
with the pinned local KTX parser into minimal PNGs for BC7. Assert decoded PNG RGBA equals each raw
level byte-for-byte; do not recompute mips, gamma-convert, unpremultiply, threshold alpha or resample.
ASTC encodes that same raw KTX's complete chain directly. Re-mark output metadata after encoding:
UNORM vkFormat, linear DFD transfer, primaries none, ALPHA_PREMULTIPLIED; modifying metadata must
leave encoded payload hashes unchanged. KTX's ASTC implementation replaces the DFD, so preservation
of flags/primaries cannot be assumed. The existing markPremultiplied validator accepts only raw/UASTC;
extend validation explicitly for BC7/ASTC rather than bypassing it.

Require original PNG hashes:
close `1de135f0fbc9ed8623a929346048bcd20c9a323d45200a8c667d26b5d4e419fa`;
field `02a8e58dbfb6455eb206015613cc6ad48d128818188a831efac72f322ef09a3a`.
Regenerated raw KTX must match diagnostic raw hashes before candidate encoding:
close `18336770eb41febff52259f0dde6ee505a541b23644723924e99af23a0115cbf`;
field `ffd0fb7596ccbe2505d67022f7db1dc54e0f8e2f48b2d6dffda25ba50415f60f`.
HALT on mismatch; explain whether container metadata or actual mip bytes differ, without weakening
the bind. Do not rerun unchanged UASTC: use the already measured 37374456139 reports/hashes as the
historical comparator, clearly label them as that, and keep its six-route readback contract intact.

### Pinned loader and actual device requirements

Local `node_modules/three/examples/jsm/loaders/KTX2Loader.js` at three **0.186.1** contradicts its own
introductory comment that hardware-specific formats are unparsed: `_createTexture` dispatches defined
vkFormat to `createRawTexture`; FORMAT_MAP includes BC7 and ASTC 4x4/6x6 UNORM. It supports complete
chains and optional Zstd. The raw path ignores premultiplied DFD flags and does not choose/decompress
an unsupported direct format. Verify actual texture.format, mip bytes and GL errors, not the header
comment or current web docs. Keep `NoColorSpace`, `flipY=false`, `generateMipmaps=false`, linear filters
and typed uploads with `premultiplyAlpha=false`; the existing shader unpremultiplies/decodes sRGB once.
No vendoring or runtime change is part of this diagnostic.

- Desktop BC7 upload requires actual `EXT_texture_compression_bptc`, the linear RGBA BPTC format in
  COMPRESSED_TEXTURE_FORMATS, dimensions within MAX_TEXTURE_SIZE, and successful complete-chain
  upload/readback with no GL error. Prior SwiftShader BC7 evidence is software only; native UHD 617
  browser/driver support and performance are still unverified for these assets. Never infer support
  from GPU name, WebGL2 alone, or force detector flags.
- Aaron's recorded iPad is A10X (2017 Pro). Apple's tables put A10-series in Apple3: ASTC LDR is
  supported, BC is unavailable in that family. This supports ASTC as the hardware target, but is NOT
  live Safari/iPad proof. Require `WEBGL_compressed_texture_astc`, `getSupportedProfiles()` including
  `ldr`, linear RGBA ASTC 4x4 in COMPRESSED_TEXTURE_FORMATS, size limits and real upload/readback.
- Actions can read back BC7 when supported. ASTC reconstruction via `ktx extract` is **software byte
  evidence only**. If the actual runner exposes safe ASTC support, add separately labeled GPU readback;
  otherwise report ASTC GPU UNRUN. Do not enable an unsupported/emulated format to manufacture it.
  Passing software ASTC cannot clear the iPad, native rendering, filtering or performance.

Primary device sources:
[BPTC WebGL specification](https://registry.khronos.org/webgl/extensions/EXT_texture_compression_bptc/),
[ASTC WebGL specification](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_astc/),
[Apple GPU family/format tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf).

### Allocation, downloads and fallback

For both BC7 and ASTC 4x4, every level costs `ceil(w/4)*ceil(h/4)*16` bytes. Include non-square
dimensions and minimum one-block tails. Proposed complete payloads are exact arithmetic from the
verified source dimensions, not measurements of new encodings:

| Page | Complete levels | BC7 / ASTC 4x4 bytes | RGBA8 bytes |
|---|---:|---:|---:|
| close 2048x1808 | 12 | 4,937,968 | 19,747,996 |
| field 1024x1912 | 11 | 2,611,264 | 10,441,740 |
| two-page sum | 23 | 7,549,232 (7.20 MiB) | 30,189,736 (28.79 MiB) |

No supercompression in the first candidate experiment: each direct-format download is its block
payload plus KTX overhead; both format families stored together cost about 14.40 MiB for two pages.
Current two-page UASTC files total 1,942,713 B (1.85 MiB); direct-file size reduction must be measured,
not assumed. Optional lossless Zstd/container/HTTP compression can later shrink downloads without
changing GPU allocation, but is held outside the initial candidate to keep the comparison bounded.

Extrapolating the existing 45-page dimensions, either 4x4 format uses **209,085,952 B (199.40 MiB)**
of block payload, same as measured BC7; both stored sets approach 398.80 MiB before compression.
Even one uncompressed container family exceeds the nominal 200 MB whole-game download budget before
other assets; two approach 418 MB decimal. A later lossless download-compression decision needs actual
sizes and caching measurements. Bypassing UASTC does not guarantee either candidate meets pixel limits.
Only select/fetch one supported format per device; loading both doubles residency. Loading all looks
leaves only 40,914,048 B under a decimal 250 MB cap (or 53,058,048 B under 250 MiB). DESIGN says
approximately 250 MB: do not silently redefine units or count this as admission. Account for loaded
AND pending textures, terrain, geometry, render targets and transient duplication; even one set has
no total-scene clearance. Whole-pack download/residency remains a later decision.

Direct KTX has **no automatic cross-format or RGBA fallback** in this loader. Future runtime selection
must probe before fetching. A separate raw/lossless per-battle pack can be a fallback only with admission:
full RGBA mip payload remains 797.24 MiB and cannot be loaded wholesale. For this experiment only, test
raw RGBA8 controls independently and simulate unsupported-candidate rejection before upload, with no
second format fetched. The previously failing UASTC pack is not a quality-approved fallback. Existing
second-pass runtime assets remain the fallback until separately authorized integration.

### Controls, scope and exit

Exactly `soldier_close_0.png` and `soldier_field_0.png`; validate the full manifest first (45 pages,
5,184 frames, 18 pose frames, 16 directions, nine looks EACH tier; all names/use/rect/ax/ay/ppm intact).
Both candidate formats encode the full mip chains. Compare mips 0/1/2, separately for every candidate:
raw->direct isolates encoding; PNG->direct preserves the end-to-end standard; retain PNG->premul,
PNG->raw and raw->raw controls. Historical UASTC routes stay labeled historical, not freshly RUN.
BC7 requires actual GPU readback; ASTC software decode is a separate route with GPU UNRUN if unavailable.
Both pages and all route/mip combinations must be unique, present, nonempty and finite. Require real
upload/base/identity/missing/changed-colour controls, severe body clipping zero, complete actual format/
allocation checks, unchanged metadata and payload checksums. Test broken page/route, tail-level, alpha,
automatic-sRGB, double-premultiplication and unsupported-format cases; never force compressed support.

Unchanged limits: RGB mean <=2, alpha mean <=1, edge RGB p95 <=8, edge alpha p95 <=8 (0–255 bytes).
No threshold tuning, denoise, alpha dilation, mip removal, atlas resizing, pose rerender or source mutation.
If an authorized later A/B needs temporary files, bind inputs by hashes and restore byte-for-byte.
No new encoder sweep or all-mode BC7E escalation after a failure without another bounded decision.
Keep `diagnosticOnly:true`, `fieldable:false`, `ok:false`; record per-route quality separately from evidence
completion. Extend a dedicated candidate-completion predicate in the existing review seam; do not change
the existing six-route diagnostic predicate to mislabel old/new reports. Reports and both comparison
sheets only, no optimized asset publication. Inspect all metrics and both actual images after one run.

Allowed files AFTER explicit authorization: `tools/bake/compress.mjs`, `tools/bake/review-compression.mjs`,
`.github/workflows/pack-figures.yml`, meaningful existing `tools/test.mjs` checks, HANDOFF/STATE/DECISIONS.
No src/assets/sw.js/DESIGN/approved-pose edits. Keep legacy diagnostic/full recipes available unchanged;
add an explicit candidate workflow mode, never redirect full mode to an unevaluated codec.
Gates: source/contract read -> both `node --check` -> `node tools/test.mjs --unit` with broken controls ->
`npm test` (one local browser) -> `git diff --check` -> docs/staged review -> commit/push -> exact-SHA
CI/Pages readback -> one explicit candidate dispatch -> logs/reports/BOTH sheets -> documented HALT.
Any failed non-obvious gate, changed source/raw hash, codec/threshold/runtime choice, or missing actual
format proof is a HALT. Candidate evidence completion never grants full-pack/runtime/device clearance.

Scope options for Aaron: **recommended two-page direct BC7 + ASTC experiment**, because it bypasses the
measured failing stage without changing the art or limits; lossless per-battle residency is a larger
runtime/memory task; revised acceptance requires Aaron to see actual differences and explicitly choose
new limits. Current packet authorizes only this proposal/documentation and the scope popup.

Read-only verification here: live main/origin 6e1d31a and bake/origin 820846f reconciled; prior exact-SHA
CI/Pages and earlier retried CI runs pass. Both actual diagnostic sheets inspected; the actual
diagnosticEvidenceOkay returns true, while ok/fieldable remain false. Source archive hashing and primary
upstream/local loader reads completed. Encoder/build/GPU/device experiments remain UNRUN.
Local syntax/unit checks and `npm test` passed for this documentation-only slice (174578 ms);
the existing smoke/prune kept the 300 MiB cap. STATE remains 19 lines. No diagnostic was dispatched.

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

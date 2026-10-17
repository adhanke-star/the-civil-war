# STATE
2026-10-17 · Claude Code (Fable 5.1 top loop, Opus coders). Worktrees: /private/tmp/cw-v1-1-20261012 (diag-0274), /private/tmp/cw-v3-20261016 (v3-sandbox-battle).
origin/main = 1a1524e (0274 closed; CI 38999400179 all 9, both offline samples 6/6). v2 RELEASED tag v2 = 0304ff0; v1.1 = 6501d5b.
0274 CAUSE (0275/0276): headless GPU compositing teardown blocked the page 30 s; the offline smoke now runs --disable-gpu-compositing,
  cache-inventory deadline 60 s; NetLog + Chrome traces + 3 samples per push stay on. Aaron's live Confederate play still UNRUN.
OPEN 0278: one worker-served module fetch canceled (ERR_ABORTED) ~35-55 ms in, ~2 of 14 worker-controlled loads; field import then
  fails. Chrome trace now covers the offline battle load too (1d99ec3). Candidate mitigation for Aaron: one-shot reload on import failure.
v3 IN PROGRESS (0277): Sandbox battle (field + two rosters) on branch v3-sandbox-battle; CI 38998598887 8/9 (offline = 0276 deadline,
  since fixed). Defect found in CI screenshots: defender line at +400 never met the attacker (0 lost in 2 h); fix = defender front +100
  with a contact check; then rebase on diag-0274, CI, screenshots to Aaron, tag v3.
Open, not gates: compressed atlases (0270/0271); six badge-award gaps; Union AI temperament; CS-side balance; live worker install UNRUN.
Protected MAIN /Users/aaronhanke/Developer/the-civil-war (13a7b13 + WIP) is never edited. .out at cap: downloads go to the scratchpad.
Note: at 00:01 on 2026-10-17 the diag worktree's tracked files and .git link were deleted by an unknown process (restored from origin).
Old build ~/Desktop/Video Game is read-only. History: two sources for Verified; never invent people or units.

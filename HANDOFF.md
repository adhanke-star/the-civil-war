# Handoff — existing v1 (2026-10-11, Claude Opus 5.5)

**2026-10-12: v1 is complete** — see STATE.md and docs/release-v1.md. Work happened on branch `packs` (worktree
/private/tmp/the-civil-war-packs-20261011) and main fast-forwards to green packs commits. Every system has a CPU
probe (`node tools/test-<name>.mjs`, plus `--prove-fail`) and a browser module wired into `tools/test.mjs` shards;
`tools/test-playthrough.mjs`, `tools/test-browsers.mjs` and `tools/test-offline.mjs` run as their own CI jobs.
Coders worked to written contracts (session scratchpad contract-*.md); history research files are in the scratchpad
and their kept results are checked in (tools/data, assets/traits.json, pack sources).

**Process (DECISIONS 0108):** AGENTS.md §3 light loop. Change → `node tools/test.mjs --unit` locally →
commit → push → read that SHA's CI (three browser shards + probes) and Pages → look at the uploaded
screenshots. The byte-exact source-lock regime (parent inverses, embedded copies, collectors, transfer
caps, proof envelopes) is retired; its old receipts stay in `/private/tmp/*` worktrees and git history.
Earlier HANDOFF text is in git history (`git show 13a7b13:HANDOFF.md`).

**Finish line:** DESIGN/PLAN P1–P7 with Shiloh, Stones River and Chattanooga playable through
title → briefing → battle → loot → camp → next phase, then a tagged v1 Release. No spending, accounts or
hands-on checks from Aaron.

**Startup:** read AGENTS.md → STATE.md → this file → the PLAN phase table → DESIGN.md → newest DECISIONS.
`git fetch; git status --short; git rev-parse HEAD origin/main; gh run list --limit 5`.

**MAIN working tree** (`~/Developer/the-civil-war`) holds uncommitted P2o field-feedback WIP in 11 files
(index.html, src/main.js, src/ui/hud.css, src/ui/hud.js, src/ui/input.js, tools/test-soldier-view-ui.mjs,
tools/test-view-ui.mjs, tools/test.mjs, docs/shiloh-preflight.md, tools/test-feedback-ui.mjs and the
untracked .code-workspace). Never reset or stash it; integrate it through a clean worktree.

**History rules:** two independent sources for Verified; otherwise Inferred/Disputed and labelled.
No invented people, units, ranks or presence. Reuse the frozen repo's `data/<battle>.json` citations first
(`/Users/aaronhanke/Desktop/Video Game`, read-only).

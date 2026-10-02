# AGENTS.md — the canon for "The Civil War" (new build, 2026-10-02)

`CLAUDE.md` imports this file, so every Claude Code version loads it without a hook. Keep it short.
Every line must change what a session does.

## 1 · What we are building

An Ultimate General: Gettysburg–style **real-time Civil War battle game** in the browser. The battlefield
looks like a painted period map, regiments move smoothly in formation, orders are drag-to-march, and
the history is cited. One battle at a time; a campaign comes later. **Weekly milestones, each one
playable** (PLAN.md). Done for a milestone means Aaron can open it and enjoy it, not that a gate count
is high.

## 2 · Stack law

- **Plain JavaScript ES modules plus an import map.** No TypeScript, no bundler, no Python. Tools are
  Node `.mjs`; the one shell exception is `play.command`.
- **three.js 0.186.1, pinned.** Third-party runtime code is **vendored** into `vendor/` by
  `npm run vendor`, so GitHub Pages serves the game with no build step. Bump versions deliberately,
  one at a time.
- **Licenses:** OSI-licensed code only. Assets must be public domain, CC0 or CC-BY, recorded in
  `ATTRIBUTION.md` (source URL, license, author). No accounts, no paid tiers, no SaaS.
- **Libraries in use:** Yuka (movement/AI), three.quarks (smoke), ZzFX (sound), Playwright +
  pixelmatch + axe-core (tests only, never shipped).

## 3 · Process (light, chosen by Aaron)

1. Read `STATE.md`, then the current milestone in `PLAN.md`.
2. Make the change. Run `npm test` locally (a fast smoke test).
3. Commit to `main`, or a short branch merged the same day, then push.
4. Read the CI run for that SHA: `gh run list --limit 3`, then `gh run view <id>`. A red CI is the next
   task, not a stop.
5. Pages deploys automatically. At each weekly milestone, tag `vN` and publish a GitHub Release with
   notes on what is new to play.
6. Record real decisions in `DECISIONS.md`: one short entry each, newest first. Keep `STATE.md`
   under 20 lines.

**History:** a fact needs at least 2 independent sources to be marked Verified; otherwise mark it
Inferred or Disputed. Anti-Lost-Cause. **Never invent a person, unit, rank or presence.** The old
build shipped random real generals as "Gen. X" (old GM-182): a slot with no sourced name gets a
generic label.

**Questions to Aaron go in a popup, with a recommendation.** Don't stop for anything reversible.

## 4 · Machine law (8 GB Mac, limited disk) — Aaron must never be asked to free space

- One Claude pane. Heavy suites, cross-browser runs and screenshot baselines run on
  **GitHub Actions**, not the Mac.
- **Nothing accumulates locally.** All generated output goes to `.out/` (gitignored), capped at
  300 MB. `tools/prune.mjs` deletes the oldest files silently. There are no evidence catalogs, no
  offloads and no Google Drive. CI artifacts expire after 7 days on GitHub.
- Never run `du`/`find` over the home directory, and never parse files over 100 MB.
- Assets live in the repo only after they are optimized for size; source originals stay at their
  public URL (recorded in `ATTRIBUTION.md`), not on disk.
- If free disk falls under 5 GB, stop adding assets and say so once. Do not delete anything outside
  `.out/`.

## 5 · Routing

Top loop: Claude Opus 5.5 at `high`; use `xhigh` for renderer or engine judgment. Use a helper agent
when a job is independent. Code is written by Opus. Sonnet and Haiku only research or read. Every
helper gets the files it may touch and the exact command to run.

## 6 · The parts bin (the old build, frozen)

`~/Desktop/Video Game` = `github.com/adhanke-star/History-Video-Game`, tag
`reference-freeze-2026-10-02` (read-only, D1032 there). Copy from it; never edit it.

| What | Where in the old repo |
|---|---|
| Battle OOBs + sources | `data/<battle>.json` (e.g. `data/bullrun.json`), `src/tactical/T1-bull-run.js`, `T15-oob.js` |
| Field battle rules (fire, morale, charge, entrench, orders) | `src/tactical/T0-field-sandbox.js`, `T39-ugg-orders.js`, `T13-engineering.js`, `T26`/`T25` |
| Codex, documents, people | `data/codex.json`, `data/primary-sources.json`, `data/person-register.json`, `data/generals.json` |
| Weapons, ratings | `data/weapons.json`, `data/ratings.json`, `data/artillery.json` |
| Research packets | `docs/design/*research*`, `HISTORICAL-DATA*.md` |
| Lessons | the old `DECISIONS.md` live laws; `REVIEW-QUEUE.md` GM-182..188 (playtest findings) |

Re-check every copied historical claim against its cited sources as you port it.

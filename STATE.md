# STATE (keep under 20 lines)

- **Direction (2026-10-03):** DESIGN.md is the design of record, PLAN.md the order, DECISIONS 0013 the summary.
- **S1 sandbox, first build on main (b582466):** `?sandbox` panel (5 tabs, Lock this, Copy/Paste settings,
  fps meter, split-screen compare); field controls (touch/trackpad/mouse pointer model, move = fight on the
  way, attack = engage by fire, ghost with range arc and march time, pencil lines, Hold Fire, bottom dock +
  minimap, pause with orders, 1x/2x/4x, auto-pause, feed, army list, spawn and moment tools);
  `reward.html` (after-action, loot reveal, compare/equip, count-ups; placeholder data in src/reward);
  installable web app; `device.html` GPU test page.
- **Unverified:** everything on the real iPad (touch, install, service worker); real-GPU fps after S1
  (run `node tools/gpu-fps.mjs`); fps cost warning; pinch, twist-to-face, box select, minimap input.
- **Art track:** hero-model route chosen: MakeHuman/MPFB2 body + scripted uniform; first bake = Union
  infantryman. Bake probe runs on branch `bake` (GitHub Actions); survey findings in the 2026-10-03 session.
- **Awaiting Aaron:** play `?sandbox` and `reward.html?sandbox` on Mac and iPad, paste Copy-settings;
  paste device.html results from both; `gh auth refresh -s project,read:project` for the Project board.
- **Not built yet in S1:** save export/import, capture crates on the field, wiring the reward sequence to
  the end of a fight, soldier's-eye key, rule sliders beyond four multipliers.
- **Watch:** CI loads ?quality=low; game.fastForward(s) is the test hook; `node tools/test.mjs --unit|--field|--s1`;
  `node tools/test-reward.mjs`; bump VERSION in sw.js when src changes ship.

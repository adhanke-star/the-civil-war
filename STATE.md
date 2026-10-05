# STATE (keep under 20 lines)

- **Direction:** DESIGN.md is the design of record, PLAN.md the order, DECISIONS 0013 the summary.
- **S1 sandbox on main:** `?sandbox` panel (5 tabs, Lock this, Copy/Paste settings, fps meter, split-screen
  compare); field controls for mouse/trackpad/touch (ghost orders, pencil lines, six order buttons, bottom dock
  + minimap, pause with orders, feed, army list, spawn and moment tools); `reward.html` (loot reveal, compare,
  equip, count-ups on placeholder data); installable web app; `device.html`.
- **Figures:** Look tab switches rigged 3D (default) / baked sprites, split-screen, 1 figure per 10 or 5 men.
  Baked = second-pass Union infantryman (approved by Aaron for fielding), with load clip and one variant;
  Confederates are the Union sprite tinted (placeholder).
- **Real GPU, UHD 617, Auto, opening/fight (2026-10-04):** baked 1:10 42.6/40.7, baked 1:5 40.7/38.7 fps;
  rigged 1:5 40.6/36.8 (rigged 1:10 not comparable: Auto chose scale 1.6). 1:5 holds 30 fps.
- **Art track (branch `bake`):** passes 3-4 built; Aaron likes pass-3 faces/variants, rejected every hand
  version. Next: drill-manual references -> his approval -> repose (HANDOFF.md, DECISIONS 0014).
- **Known in play:** close tier has no variants; front-on firing poses hard to tell apart; under-fire halos
  louder than the baked shadow; all uniform details are placeholders with no source read.
- **Unverified:** everything on the real iPad; fps cost warning; pinch, twist-to-face, box select, minimap input.
- **Awaiting Aaron:** play `?sandbox` and `reward.html?sandbox` on Mac and iPad and paste Copy-settings;
  device.html results; `gh auth refresh -s project,read:project` for the Project board.
- **Not built yet in S1:** save export/import, capture crates on the field, reward sequence wired to the end
  of a fight, soldier's-eye key. GPU-compressed atlases (KTX2/ASTC) not started.
- **Watch:** `node tools/test.mjs --unit|--field|--s1`; `node tools/test-reward.mjs`; `node tools/gpu-fps.mjs
  --figures` (Chrome closed); bump VERSION in sw.js when src ships (now cw-v4).

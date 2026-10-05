# STATE (keep under 20 lines)
- **Handoff (2026-10-05):** read HANDOFF.md for where work stopped and what is next.
- **Direction:** DESIGN.md is the design of record, PLAN.md the order, DECISIONS 0013-0014 the summary.
- **S1 sandbox on main:** `?sandbox` panel (5 tabs, Lock this, Copy/Paste settings, fps meter, compare);
  mouse/trackpad/touch controls (ghost orders, pencil lines, six order buttons, dock + minimap, pause with
  orders, feed, army list, spawn and moment tools); `reward.html`; installable web app; `device.html`.
- **Figures:** Look tab: rigged 3D (default) / baked sprites, 1 figure per 10 or 5 men. Baked = second-pass
  Union infantryman; Confederates are the Union sprite tinted (placeholder).
- **Real GPU, UHD 617, Auto, opening/fight (2026-10-04):** baked 1:10 42.6/40.7, baked 1:5 40.7/38.7 fps;
  rigged 1:5 40.6/36.8. 1:5 holds 30 fps.
- **Art (`bake` 820846f):** simple authored hands; Full Bake 37347072866 + CI passed, 5,184 frames.
  Aaron saw and approved all 12 sheets. Package 37360904656: 47.40 MiB disk, 199.40 MiB BC7/mips.
  HALT: 45/45 fail quality; diagnosis 37374456139 complete: UASTC loss precedes BC7 (HANDOFF.md).
- **Known in play:** front-on firing poses hard to tell apart; halos louder than the baked shadow; walk bob;
  uniform details are placeholders. **Unverified:** iPad; pinch, twist-to-face, box select, minimap input.
- **Awaiting Aaron:** sandbox and reward page Copy-settings from Mac and iPad; device.html results;
  `gh auth refresh -s project,read:project` for the Project board.
- **Watch:** `node tools/test.mjs --unit|--field|--s1`; `node tools/test-reward.mjs`; `node tools/gpu-fps.mjs
  --figures` (Chrome closed); bump VERSION in sw.js when src ships (now cw-v4).

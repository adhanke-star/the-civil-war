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
- **Art (`bake` d7c07b2):** pass 3 restored; simple authored hands posed to approved drill targets.
  Full Bake 37342865320 running; inspect against plates, show 12 sheets in Preview, confirm visibility,
  then obtain Aaron's approval. No pass-5 art is fielded. HANDOFF.md carries the resume contract.
- **Known in play:** front-on firing poses hard to tell apart; halos louder than the baked shadow; walk bob;
  uniform details are placeholders. **Unverified:** iPad; pinch, twist-to-face, box select, minimap input.
- **Awaiting Aaron:** sandbox and reward page Copy-settings from Mac and iPad; device.html results;
  `gh auth refresh -s project,read:project` for the Project board.
- **Watch:** `node tools/test.mjs --unit|--field|--s1`; `node tools/test-reward.mjs`; `node tools/gpu-fps.mjs
  --figures` (Chrome closed); bump VERSION in sw.js when src ships (now cw-v4).

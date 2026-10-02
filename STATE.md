# STATE (keep under 20 lines)

- **Milestone:** M1 playable on Pages (main d420552, CI green); NOT tagged v1: visual bar not fully met.
- **Main has the rigged figures** (figures-detail merged 2026-10-02): rigged soldiers, guns with crews, painted farms, 3D place names.
- **Plays:** Henry House Hill 2 p.m.: 10 sourced units (1,320 figures), drag-order arrows, Hold/Charge/
  Run/Fallback/Halt, volleys + smoke banks + sound, morale/rout/rally, CS defence AI, objective, UG:G HUD.
- **Real GPU (UHD 617, 1440x788 @2x, headed Chrome):** High 32.9/25.2 fps, Auto 36/44 (scale 1.3/1.0), Low 60/57.9 (opening/fight); DECISIONS 0012.
- **Gaps vs UG:G (.out/compare, branch):** figures still simpler than UG:G's sprites up close (flat colours,
  no face/texture detail); trees blobby; horses static-legged; no stone walls; grade still lighter/greener.
- **Aaron (2026-10-02, playing):** "gameplay sucks", hard to navigate and zoom, hard to know what each troop will do; lines look fuzzy.
- **Next:** see ~/.claude/next-session-prompt.txt.
- **Watch:** CI loads ?quality=low; game.fastForward(s) is the test hook; ?tune opens lil-gui; ?parcels=grid;
  ?outline=0 disables the figure outline pass.

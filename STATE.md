# STATE (keep under 20 lines)

- **Milestone:** M1 playable on Pages (main d420552, CI green); NOT tagged v1: visual bar not fully met.
- **Branch figures-detail (Fable trial, not merged):** rigged soldiers with baked clips + 3 LODs + outline,
  two dense ranks + skirmishers, road columns, feet halos, Parrott/bronze guns with crews, limber teams and
  drivers, officers on horseback, painted buildings, open mixed woods, 3D place names, no MSAA (DECISIONS 0011).
  Try it: `git switch figures-detail`, then double-click play.command (Pages only shows main).
- **Plays:** Henry House Hill 2 p.m.: 10 sourced units (1,320 figures), drag-order arrows, Hold/Charge/
  Run/Fallback/Halt, volleys + smoke banks + sound, morale/rout/rally, CS defence AI, objective, UG:G HUD.
- **Real GPU (UHD 617, 1440x788 @2x, headed Chrome), branch:** High 30/24 fps, Auto 37/34 (scale 1.3->0.85),
  Low 46/39 (opening/fight). main: 31/27, 36/36, 46/46.
- **Gaps vs UG:G (.out/compare, branch):** figures still simpler than UG:G's sprites up close (flat colours,
  no face/texture detail); trees blobby; horses static-legged; no stone walls; grade still lighter/greener.
- **Not verified:** a human hand on a mouse (loop driven by Playwright in headed Chrome); TV/HDMI; sound by ear.
- **Next:** see ~/.claude/next-session-prompt.txt.
- **Watch:** CI loads ?quality=low; game.fastForward(s) is the test hook; ?tune opens lil-gui; ?parcels=grid;
  ?outline=0 disables the figure outline pass.

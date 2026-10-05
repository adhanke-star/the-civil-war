# DESIGN: "One Army, One War" (decided by Aaron in popups, 2026-10-02/03)

The design of record. PLAN.md holds the build order; DECISIONS.md 0013 records the change of direction.
Rows are Aaron's choices unless marked "(mine)". Change a row only by asking him in a popup.

## 1 · Game shape
| Topic | Decision |
|---|---|
| Role | Army commander now; save data shaped so a President layer bolts on later |
| Campaign v1 | West, 3 battles: Shiloh, Stones River, Chattanooga |
| Franchise army | Union Army of the Ohio -> Army of the Cumberland; Union only in v1 |
| Shiloh day 1 | Grant's Army of the Tennessee on loan (not franchise); its result sets your day-2 start |
| Strategy layer | Fixed battle ladder + camp; 1-2 sourced decision cards before each battle that change its setup or your points |
| Battle length | 3-5 phases per battle, 15-20 min each, save between phases |
| Phase lists | Shiloh proposed below; Stones River and Chattanooga drafted from sources and approved by popup |
| Victory | 1-3 named objectives with times + casualty ratio -> Decisive/Victory/Draw/Defeat; the grade sets the next phase |
| Phase end | Historical clock; early end offered once decided; player may fight on |
| Losing | No game over; losses carry forward; a replayed phase is marked on the record |
| Enemy | Historical opening per phase, then reacts. Its army carries losses, veterancy and captured arms between battles and earns its own badges and X-Factors |
| Difficulty | Recruit / Veteran / General: smarter, faster AI and no auto-pause; never hidden stat bonuses |
| Flow | Title (live diorama) with one Continue; loop: Decision cards -> Fly-over briefing -> Phase -> After-action and loot -> Camp |
| Other modes | "Battles" menu: every built phase open from the start, historical armies, no loot. Bull Run = "Practice: Henry House Hill". Sandbox battle (pick field and both armies) after the three battles exist |
| Teaching | Hints the first time each control is relevant; no guided tutorial |
| Saves | Three named slots in the browser, autosave between phases and in camp, export/import file |
| History | Fly-over briefing with captions; after-action "you vs history" with sources; codex later |
| After v1 | Officers (cards, promotion) and the Confederate franchise; then the Eastern campaign; then strategy map and President |

## 2 · Battle play
| Topic | Decision |
|---|---|
| Camera | Map-style: drag to pan, scroll/pinch zooms to cursor, minimap click, double-click unit flies to it, auto tilt; a close zoom level with higher-detail figures |
| Orders | Ghost preview on drag: destination line and facing, range arc (rings for guns), march time. After release: thin dashed staff-map pencil line |
| Command | Brigades and batteries directly. Delegate: click a place, choose Attack/Defend/Support; the general's pencil lines show his plan; a direct order takes a brigade back |
| Pace | Space pauses, orders while paused, 1x/2x/4x; auto-pause on rout, reinforcements, threatened objective |
| Formations | Fully automatic (column on roads, line near the enemy, skirmishers out) |
| Artillery | Separate batteries; limber/unlimber; ammunition switches automatically; guns can be captured |
| Cavalry | Light role: scout, screen, pursue, capture wagons, dismount |
| Commanders | Mounted figures with a rally radius; can be wounded or killed |
| Conditions | Cover and high ground, fatigue, entrenchments. No fog of war, weather or moving sun in v1 |
| Rout | Rout and rally; cut-off units surrender (prisoners count in the grade, arms become loot); both sides |
| Reinforcements | Historical hour and road; announced ahead; auto-pause on arrival |
| HUD | Bottom dock: unit card left, orders + Delegate centre, period survey-style minimap right (M expands); thin top strip: clock, speeds, balance |
| Marker | Small flag on a staff + strength bar tinted by morale; name and OVR on hover/selection |
| Controls | Mouse/trackpad + full keyboard play; fixed keys with a help sheet. Touch in v1 (iPad); gamepad later |

## 3 · Franchise, loot and rewards
| Topic | Decision |
|---|---|
| Brigade card | Rating-first: big OVR, names, veterancy tier, men, weapon with rarity and condition, Fire/Melee/Morale/Drill bars, badge icons; back: regiments, history, honours, equipment. Same card in camp and battle. Period photograph where a sourced one exists, generic silhouette otherwise |
| OVR | Gear-led: arms dominate |
| Veterancy | Green/Trained/Veteran/Elite; one tier per battle if it fights well; heavy losses can cost a tier |
| Rarity | 5 tiers, Borderlands colours + a shape each: .69 smoothbore, 6-pdr / Lorenz, Belgian, 12-pdr howitzer / Springfield, Enfield, Napoleon / Sharps, Colt revolving, 3-in, Parrott / Spencer, Henry, Whitworth (placements sourced before shipping) |
| Affixes | Rolled condition per lot, strong (about 15%); labelled as game modifiers, not history |
| Stores | Ammunition and rations (consumed), shoes/blankets/tents (wear out), horses and wagons, colours and trophies (trophy shelf) |
| Earning | Field captures (overrun batteries, held ground, routed wagons, surrenders; the enemy loots ground you lose) + a quartermaster issue scaled to the grade |
| Reveal | Cards dealt one by one, rarest last; one key skips |
| Depot | Limited by wagon capacity; choose what to keep |
| Camp | One screen, card table: brigade cards by division, loot tray, drag to issue with OVR change previewed; one order per brigade (Drill / Target practice / Rest) |
| Shop | "Requisition" drawer on the camp table. Currency: requisition points (grades, objectives, low losses, badges, turned-in loot). Stock: specific arms and stores (date-gated), per-brigade training upgrades, army-wide upgrade tree (wagons, ambulances, ordnance train, pioneers), extra badge slots, affix re-rolls |
| Reward tiers | Army reputation level 1-10; each level unlocks a shop tier and deals a reward card; track visible in camp |
| Badges (20) | Fire: Sharpshooters, First Volley, Cool Under Fire, Fire Discipline, Skirmishers. Assault: Stormers, Cold Steel, Shock, Flankers, Relentless, Gun-takers. Defence: Rock, Unshaken, Quick Rally, Rear Guard, Diggers. Support: Hard Marchers, Woodsmen, Foragers. Batteries: Canister. Each earned by a feat in play and needs a sourced real example |
| Badge tiers | Bronze/Silver/Gold; the first Gold becomes the brigade's X-Factor (dramatic: banner, sound sting, warm glow along the line; a setting tones it down). Slots: Green 1, Trained 2, Veteran 3, Elite 4 |
| Record | Franchise record book: grades, losses vs history, each brigade's history, best captures, campaign grade |
| Staging | Thin slice first: weapons loot, OVR cards, 6 badges at one tier, shop selling arms only, reputation 1-3. The rest fills in as updates during the later battles |

## 4 · Look and sound
| Topic | Decision |
|---|---|
| Realism | Realistic diorama: true proportions, real uniform detail, natural colours, richer terrain (grass and crop texture, mud, rock, moving creek water, tents and wagons). Supersedes DECISIONS 0009 and the "painted map" wording in AGENTS.md 1b |
| Figures | 1 figure = 5 men, only if measured at 30+ fps on the UHD 617. Baked sprite impostors, confirmed against the current rig in the sandbox |
| Models | Aaron picks per object from a surveyed shortlist of free sources with pictures |
| Casualties | Unflinching (fallen remain, blood, dead horses, wrecked guns, field hospitals), with a gore toggle |
| Lighting | One standard light |
| UI style | Aaron picks from three mock-ups (period desk / clean modern / hybrid); modern sans type; Madden polish (card flips, rating count-ups, level-up moments) |
| After-action | Grade, you vs history, badges and points, sourced "what really happened", 30-second animated map replay, then loot |
| Sound | CC0/public-domain recordings via howler.js: gunfire, drum and bugle calls as order feedback, voices, ambient field that swells with the fighting; period music on title/camp/results only |
| Settings | Quality Auto/High/Low, sound volumes, gore toggle |
| Approval | Screenshots in popups, one object at a time; nothing enters unapproved |
| Name | Working title; 5 checked candidates once the look exists |

**Defaults (mine):** colour is never the only cue (shape and label too); all tunable weights live in
`src/franchise/tuning.js`.
**Flags (mine, stated once):** (a) gear-led OVR with 15% affixes will let a green brigade with repeaters
outrate veterans, against "as realistic as possible"; it is one constants file to change after you
play. (b) The design is now far larger than "finish quickly"; the thin-slice staging is what keeps the
first playable campaign near.

## 4b · Feel and readability (round 2 of questions)
| Topic | Decision |
|---|---|
| Top pillar | Spectacle first: when goals conflict, the most dramatic look and feel wins; real places, units and timetables remain the frame |
| Selection | Click, drag-box (keeps relative positions), division select, collapsible army list panel (click to select and fly to) |
| Combat feedback | Engagement lines, casualty ticks, status words on the marker, clickable event feed |
| Session | About 30 minutes: one phase + results + loot + camp; campaign about 6-8 hours |
| Battle effects | Push: artillery impact (bursts, canister lanes, falling limbs, slight close-up shake), charge and melee drama (surge, cheer, flags falling and raised), optional slow-motion push-in on big events (off on General). Smoke stays as it is now |
| X-Factor look | Dramatic (supersedes "subtle" in section 3): banner, sound sting, warm glow along the line; a setting tones it down |
| Reward feel | Rarity fanfare on loot cards, rating count-ups, full-screen level-up, badge stamped on the card with its feat |
| Camera feel | Eased map-style camera; hold a key for a low soldier's-eye view along the selected brigade with depth of field |
| Drop rate | Several commons + usually one better card per phase; odds rise with grade and enemy beaten; guaranteed one Rare-or-better per battle; 1-2 Legendaries per campaign |
| Power curve | Best brigades gain about 20-25 OVR by Chattanooga; the enemy keeps pace |
| Decision cards | Sourced dilemmas, 2-3 cards with stated gain and cost, no dice; the real choice revealed afterwards |
| Endgame (after v1 core) | Campaign grade with medals per battle; 30-40 local achievements; challenge phases with reward cards; New Game Plus (keeps badges and trophies, tougher enemy, a new top reward tier) |
| AI character | Each enemy commander gets 2-3 temperament traits from his documented record (Inferred where sources disagree) |
| Own brigades | Sensible initiative: return fire, face a flank attack, fall back a little when badly outnumbered, resupply out of contact; never advance or charge unordered |
| Forgiveness | No fire through friends ("Masked"); passing through costs time and slight disorder, not men |
| Terrain play | Terrain effect shown on the ghost; roads, fords, bridges and thickets matter; fences become breastworks, buildings are strongpoints and can burn, bridges can be held; key ground glows for the first minute |
| Load budget | Title and camp in about 10 s (about 5 MB); each battle streams on choice and is browser-cached; whole game about 60-100 MB |
| Cut order | If time runs short, ship Shiloh and Chattanooga with every system complete; Stones River follows as an update |
| Public feedback | None until v1 |
| Target machine | Best appearance and performance wins; iPad is acceptable as a target if it looks and plays better there (model and role being settled) |
| Devices | Mac and iPad both first-class; touch in v1 (supersedes "touch later"). Aaron's iPad: Pro 12.9-inch 2nd gen (2017, A10X, 4 GB RAM, iPadOS 17.7, Safari). Its GPU is probably 1.5-2x the UHD 617 (unmeasured; a test page will measure it); Safari's per-tab memory limit is the tighter constraint |
| Quality levels | Auto picks Low/High/Ultra by measured GPU; Ultra = 1 figure per 2-3 men, soft shadows, grass, denser smoke (may exceed both of Aaron's devices; verified on CI only) |
| Touch orders | Drag from the unit, ghost follows the finger, second finger twists facing, lift to confirm; one-finger drag on empty ground pans |
| First build | A sandbox (Aaron, 2026-10-03): the first thing built is a field where he can try and change looks and gameplay flow himself |
| Sandbox form | Workbench on the Henry House Hill field (side panel of live switches, side-by-side options, "Lock this") + gallery pages for cards, menus and loot screens; runs on Mac and iPad from Pages |
| Sandbox powers | Place and command both sides (strength, arms, veterancy); rule sliders (speed, fire, morale, charge, fatigue, battle speed); look sliders (figure size, spacing, grade, smoke, tilt-shift, marker, camera); buttons to trigger a volley, charge, rout, shell burst, loot card, X-Factor |
| Sandbox output | "Copy settings" button produces a text block Aaron pastes back; those become defaults |
| Sandbox day one | Controls and feel with today's figures: camera, touch, ghost orders, pencil lines, bottom dock, pause/speeds, combat feedback. Art and UI candidates are added to the same sandbox as they are made |
| Historical frame | A fuller thread: briefings state plainly and with sources that the Confederacy fought to preserve slavery; decision cards and codex entries cover emancipation, people fleeing to Union lines, contraband camps, USCT and the home front where they touched the army |
| Uniform variety | Standard dress plus documented differences only (slouch hats, mixed greys and butternut, real regimental colours where sourced) |
| Voice | Cited quotations from real letters, diaries and reports open briefings and close after-actions; text only |
| Sandbox panel | Slide-out, five tabs (Units, Rules, Look, Moments, Screens), a plain-English note and Reset per control, hides with one tap |
| Comparing | Split screen with a draggable divider over the same scene; A/B/C buttons choose each side |
| Performance | Small fps figure with green/amber/red dot and a plain warning when a choice costs frames on this device |
| Sandbox exit | Every sandbox topic is locked before campaign work starts; the sandbox stays in the menu afterwards |
| Core moment | Opening the loot: the reveal and the choice of who gets it is the moment the game is built around |
| Must-pass tests | From Aaron's frustrations: (1) it must not look cheap; (2) units do what he meant; (3) few screens, always obvious what to do next |
| Madden hooks | All four: ratings growing, roster building, X-Factors, record and legacy |
| Borderlands hooks | The drop itself, comparing gear (side-by-side cards, green/red arrows), unique named items with character. Not skill trees |
| Field drops | Captures appear on the field as crate markers in their rarity colour with a sound and a counter in the top strip; opened at the after-action; lost if the enemy retakes the ground |
| Uniques | Real weapon and equipment types with invented Borderlands-style names, one special effect and flavour text; clearly labelled as game items, never presented as history |
| Compare | Side-by-side cards with green/red arrows and the OVR change in large type; a star marks the brigade that gains most |
| First sandbox build | Two halves on day one: the practice field with new controls, and a short fight ending in the full reward sequence (capture markers, after-action, cards with fanfare, compare and equip, ratings counting up) on placeholder data. Supersedes "controls first, screens third" |
| Move order | Drag to a spot = march there, halt and fire at any enemy in range on the way, continue when able, hold and face as set on arrival |
| Attack order | Drag onto an enemy = close to effective range, halt and fire, follow the target; charge only on the Charge button; ghost shows the halt point |
| Screens | No hard limit; keep it sensible (must still pass the "few screens, obvious next step" test) |
| Quality bar | Split-screen against Ultimate General: Civil War and Total War references, Aaron judges. Flag (mine): those run on gaming PCs; on a UHD 617 and an A10X in a browser this bar may not be reachable live, so detail must come from baking |
| Reaching the bar | Bake it: figures, horses, guns, trees and buildings rendered at high detail on GitHub Actions into sprite sheets with lighting and shadow baked in; terrain gets pre-rendered detail and shadow. This settles the figure-art question: baked impostors (the sandbox still shows them against today's rig for confirmation) |
| Order buttons | Hold, Charge, Run, Fallback, Halt + Hold Fire; tooltip and key on each |
| Facing | Ghost faces the nearest known enemy by default; swing the pointer or twist a second finger to turn it before release |
| First minute | Continue drops a new player into a small fight (two brigades vs one approaching); three hints as needed; first loot card within about a minute; camp introduced after that win |
| Hero models | Survey first with pictures (MakeHuman/MPFB + scripted uniforms, CC0 adaptations, museum scans), then Aaron decides |
| Quality gates | Locked-look reference screenshots in CI; frame-rate floor; order-obedience tests (unit ends where the ghost showed, faces as set, fires in range); balance robot (AI-vs-AI runs reporting win rates, casualty ratios, loot totals) |
| Updates | A note of five lines or fewer per session: what changed, what to try, what is needed from Aaron |
| Teaching | Short "how games do this" notes at each milestone (baking, AI, balance testing), plus a sentence of why on every choice |
| Regiments | A brigade's line is its real regiments side by side, each with its own colours and a small gap; hover names the regiment; not separately orderable |
| Replay variety | Fresh loot, conditions and shop stock each campaign; decision cards drawn from a larger sourced pool; choice of which historical division forms the core of the starting army. Enemy plan does not vary beyond its reactions |
| Side cues | National and regimental flags, blue/red marker bar, faint blue/red ground tint under selected or hovered units; no outlines on figures |
| iPad app feel | Installable web app (manifest + service worker): home-screen icon, full screen, loaded battles work offline; still served from Pages |
| Device transfer | Export save to a file, AirDrop or Files, import on the other device |
| Card art | Baked render of the real object's 3D model on dark felt with rarity-coloured light |
| Camp backdrop | Living diorama of the army encamped (tents, fires, drill squads, wagons growing with the depot, captured colours), reflecting the player's choices |
| Polish priority | How the battlefield looks reaches "excellent" first (baked figures, terrain, effects to the Total War bar); rewards and controls reach "good" first |
| Future hooks | Stored from the start: real dates on a war calendar; manpower, wagons and stores as real quantities; coordinates and routes for battles and camps; reputation also kept as standing with Washington |
| Music | Period tunes on period instruments (public-domain compositions, CC0/PD recordings); sombre hymns and laments after heavy losses; nothing over battle |
| Hand poses | Posed to the 1861 drill-book plates (aim, loading) and Hardee 1861 text (shoulder arms and march on the right shoulder) with one simple natural closed hand; docs/drill-reference.md. Aaron, 2026-10-05 |
| Hero soldier route | MakeHuman/MPFB2 body (CC0) + scripted uniform, baked on GitHub Actions (branch `bake`; proven 2026-10-03). First pass reads as a clean mannequin up close: second pass = cloth folds, real kit, gripping hands, brogans, weathering, tighter framing |
| Art next step | Put the baked soldier on the field now (split-screen against the current figures, fps measured at 1:5) while the model is improved in parallel |
| Sprite budget | Whole game up to about 200 MB; each battle under about 250 MB of graphics memory on the iPad, using GPU-compressed atlases (ASTC/KTX2) and per-battle loading; directions trimmed only on field-size sprites. To be checked on the iPad before locking. Supersedes the 60-100 MB load budget |

Where a later row contradicts an earlier section, the later row wins (touch in v1, dramatic X-Factor,
sandbox first, spectacle as top pillar).

## 5 · How we work
- Popups only for choices that change what Aaron sees or plays; code, tests, tools and CI proceed freely.
- `DESIGN.md` (this design), `PLAN.md` (milestones), a free GitHub Projects board (To do / Building /
  For your review / Done), a Release per milestone. Review = Pages link + 3-5 things to try, then a popup.
- Mac stays clean: baking, heavy tests and screenshot baselines on GitHub Actions; local output in `.out/`.


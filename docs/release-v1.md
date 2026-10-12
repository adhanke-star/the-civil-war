# The Civil War — v1 "The Western Campaign 1862–63"

Play it in the browser: https://adhanke-star.github.io/the-civil-war/ (Mac, iPad and any recent Chrome, Safari or
Firefox; install it to the home screen to play loaded battles offline).

## What you can play

- **The campaign**: one Union army through three battles and eleven phases — Shiloh (4), Stones River (4),
  Chattanooga (3). Each phase is title → decision cards → briefing → battle → after-action → loot → camp → next.
  Shiloh's first day is fought with Grant's army on loan; your own Army of the Ohio joins on the second day.
- **Battles menu**: every phase with its historical armies, no loot, your campaign untouched.
- **Practice: Henry House Hill** and the **sandbox** workbench.
- Three save slots, autosave between phases and in camp, export/import to move a campaign between devices.
- Difficulty: Recruit / Veteran / General — the enemy decides faster and smarter; the combat numbers never change.

## In battle

Drag-to-march orders with a ghost line, range arc and march time; Hold, Charge, Run, Fallback, Halt, Hold fire;
delegation (Attack / Defend / Support); mounted commanders with a rally radius who can be wounded or killed; brigades
drawn as their real regiments with their own colours; cavalry that scouts, screens, pursues and dismounts; batteries
that limber, unlimber and can be captured; no fire through your own lines; surrenders, captured guns and colours;
reinforcements on their historical hour and road; real terrain from USGS elevation with period roads and streams.
Baked soldiers for both armies (the Confederates in grey and butternut jean, mostly slouch hats).
Enemy army commanders bring their documented temperament (sourced, shown on their cards).

## Between battles

After-action: your grade, **you vs history** (losses, ground, clock), points and badges, **what really happened** with
a closing quotation and sources, and a **30-second animated map replay** of your fight. Then the loot: real weapons
from the period (museum photographs on the cards), five rarities, rolled condition. Camp: issue arms with the rating
change shown, one order per brigade (Drill / Target practice / Rest), stores (ammunition, rations, shoes, blankets,
tents, horses, wagons), the Requisition shop (date-gated arms, stores, army upgrades, training, badge slots, re-rolls),
reputation levels 1–10, 20 badges in Bronze/Silver/Gold with an X-Factor, sourced decision cards before each phase,
a record book and a campaign ending with medals. Recorded period music and battle sound (CC0 / public domain).
Settings: quality, four volumes, gore, X-Factor moments.

## History

Every unit, commander, strength and time is from cited sources; anything not twice-sourced is marked Inferred,
Estimated (with the method) or Disputed. No invented people. The briefings say plainly that the Confederacy fought to
preserve slavery. Sources are listed in the game (briefings, after-action, cards) and in ATTRIBUTION.md.

## Known gaps (honest list)

- Frame rate on the target machines (Intel UHD 617 Mac, iPad Pro 2017) is **not measured**: CI renders in software.
  If a battle is slow, Settings → Quality → Low.
- Up close, every Confederate in a line wears the same look (four looks at normal zoom); more need compressed
  textures first.
- Corps commanders are not modelled, so Polk's, Hardee's and Cheatham's traits have no effect yet.
- Badge, store and difficulty numbers are first guesses tuned by an automated playthrough, not by people.
- Sound and music were chosen by measurement; nobody has listened to them on a device.
- The Stones River dawn phase sits about 700 m north of the true ground (edge of the terrain tile).
- Card art is museum photography rather than 3D renders; the Belgian rifle-musket has a labelled silhouette.
- Original code is now MIT; original authored data/text are CC-BY 4.0 (Aaron, 12 October 2026).
  Third-party material retains its own licences and public-domain status; see LICENSE-data-text.md and ATTRIBUTION.md.

## Proof

CI on the release commit: four browser shards, CPU probes with mutation controls, Firefox and WebKit smoke runs, an
offline run, and a full agent playthrough of the campaign (title to ending, a defeat and its replay, reload,
export/import).

## Next (after v1)

Officers and promotions; the Confederate franchise; the Eastern campaign; achievements, challenge phases and New Game
Plus; a codex; corps commanders; GPU-compressed atlases with more uniform variety; measured performance on the
target Mac and iPad.

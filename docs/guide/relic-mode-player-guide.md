# Relic mode: player guide and tracker

!!! note "This page follows the current plan"
    This page follows the plan and the code in `mods/relics/` as of root commit `89a3b19` (all eight milestones are on `main`). Relics and tasks may still change. Every relic has automated tests (106 tests, 105 pass, 1 marked todo), run with a scripted headless client. Nobody has done a full play-through by hand, and this page's author ran nothing.

## The run in one minute

- You play a normal LostCityRS character (revision 274) with **8x XP** and **unlimited run energy**.
- There are **25 tasks**. Finishing one plays fireworks and the level-up jingle, then offers you **a pick of up to 3 random relics**.
- Relics are "game-breaking" perks (table below). One of them, the **XP Multiplier**, can be taken three times and lifts your XP rate to **16x, 32x, then 64x**.
- The last two tasks are the bosses: the **King Black Dragon** and the **Kalphite Queen**. Those two give no relic offer. Killing both is the end of the run.
- The first offer comes when you first log in (after Tutorial Island, or at once if you skip it).

### Rules worth knowing

1. **Tasks count in any order.** There is no unlock order: do them as you please, including the two bosses at any time. (`docs/design/relics-m3-tasks.md`, "Update: tier lock removed")
2. **A task counts once.** Doing it again gives nothing.
3. **Relics you decline stay in the pool** and can be offered again later. If only 1 or 2 are left you are offered just those. If none are left, the task still completes with the celebration but there is no choice.
4. **There are 21 pickable relics** (19 relics, with the XP Multiplier counting three times) for 23 offers, so the last offers of a full run are empty. (`docs/design/roguelike-relics.md`, "Offer mechanics")
5. **Hoarder** gives one extra pick from relics you were offered and declined earlier.

## Your tracker

Tick the box when you take a relic or finish a task. Ticks are saved in **this browser only** (local storage): they are not sent anywhere, they are not shared between devices, and clearing the site data for this page clears them. Use the notes box for your own reminders (for example which relics you turned down, for Hoarder).

<div id="relic-tracker-notes"></div>

## Relics { #relics }

<div class="relic-tracker-bar" data-for="relics"></div>

| # | Relic | What it does | Status | How to use it |
|---|---|---|---|---|
| 1a | XP Multiplier I | XP rate 8x to **16x** | tested | automatic |
| 1b | XP Multiplier II | XP rate 16x to **32x** (needs I) | tested | automatic |
| 1c | XP Multiplier III | XP rate 32x to **64x** (needs II) | tested | automatic |
| 2 | Quest Pass | every quest is marked complete | tested, see note | automatic |
| 3 | Stoneskin | you take **half** the damage | tested | automatic |
| 4 | Quickstrike | you attack **twice as fast** | tested (melee, bow) | automatic |
| 5 | Glass Cannon | you deal **x2** damage to NPCs and take **x1.5** | tested | automatic |
| 6 | Phoenix | a lethal hit leaves you on 1 HP, once every **5 minutes** | tested | automatic |
| 7 | Vampire | you heal a little on **every kill** | tested | automatic |
| 8 | Executioner | NPCs below 25% HP die instantly | tested, see note | automatic |
| 9 | Bounty | every kill drops **coins plus one food**, bigger for tougher NPCs | tested | pick the drop up |
| 10 | Eternal Vein | ore rocks never run out and ore goes **straight to your bank** | tested | automatic |
| 11 | Evergreen | trees never fall and logs go **straight to your bank** | tested | automatic |
| 12 | Double Yield | gathering and cooking give **x2** items | tested (not fishing or cooking) | automatic |
| 13 | Midas Loop | high alchemy keeps repeating on the same stack | tested | cast High Level Alchemy |
| 14 | Philosopher's Coin | alchemy pays **x2** coins | tested | cast an alchemy spell |
| 15 | Infinite Runes | spells cost **no runes** | tested | automatic |
| 16 | Everlasting Jewellery | duelling ring, glory amulet and games necklace never lose charges; one of each is put in your bank when you take it | tested | use the jewellery |
| 17 | Last Recall | teleports you back to where you last teleported **from**; using it again swaps between the two places | tested | a **Recall stone** item, op *Recall* |
| 18 | Banker's Call | opens your bank from anywhere | tested | a **Banker's stone** item, op *Open bank* |
| 19 | Hoarder | one extra pick from relics you declined earlier | tested | automatic, right after you take it |

*Status* says how the relic was checked. "Tested" means an automated test (with a control run without the relic) saw it work, using real client input where the test harness allows it. Not covered by any test: anything the client shows (dialogs, jingle, fireworks), Tutorial Island, real boss fights, and long sessions. (`docs/design/relics-e2e-tests.md`)

Things worth knowing:

- **Quest Pass** runs the engine's own "complete all quests" cheat script. It also hands out quest reward items and XP (quest points reached 135 in the test), so it is a big skill boost too. About 63 quest-complete scrolls open one after another, so expect to click through them (inference; the test closes them all).
- **Eternal Vein** was seen by hand to stop after each ore, so you may need to click the rock again. Evergreen keeps chopping until you walk away.
- **Midas Loop** stops when you walk or click something else.
- **Executioner** finishes an NPC below 25% of its base HP on your next landed hit, but it over-credits attack XP a little (a known issue, not fixed). **Quickstrike** halves melee and bow attack delays in tests; magic and special attacks were not tested, and nobody checked that the client shows the faster swing.
- **Glass Cannon** doubling is tested on melee only (ranged and magic not tested).
- **Phoenix** was tested with a debug hit, not a real killing blow, and its cooldown survives death.
- **Everlasting Jewellery**: all three items keep their charges in tests. The glory amulet's message still says it lost a charge, though it did not (a known message bug).
- **Closing an offer and relogging** gives you three new relics, so the offer is not a fixed pick (known, unchanged).

### If you die

Relic items (the three jewellery items, the Recall stone and the Banker's stone) are moved to your bank on death. If you lose one anyway, talk to the **Relic Keeper** near Lumbridge (`0_50_50_21_18`, about (3221, 3218)); it re-issues each missing item once. Tested: death with the bank full or not, one keeper after many logins. Not checked: PvP death, long uptime. (`docs/design/relics-m6-death-keeper.md`)

For the details and the code, see the notes [M5](../design/relics-m5-easy-relics.md), [M6](../design/relics-m6-death-keeper.md), [M7](../design/relics-m7-medium-relics.md) and the [development plan](../design/roguelike-relics-dev-plan.md).

## Tasks { #tasks }

<div class="relic-tracker-bar" data-for="tasks"></div>

Tasks count in any order. Ticking a task here does not affect any other row.

| # | Task | Requirements | Where (from the map spawn data) |
|---|---|---|---|
| 1 | Defeat a **goblin** | none. Any of five goblin types counts: combat levels 2, 5 or 13 | Lumbridge (3232, 3232), Rimmington (2976, 3232), Goblin Village (2976, 3488) |
| 2 | Defeat a **lesser demon** | a real fight: combat level 82, 79 HP | underground around (2848, 9568) |
| 3 | Defeat a **giant** | combat level 28, 35 HP. There is no "Hill giant" NPC; the plain *Giant* counts | underground around (3104, 9824), or in the Wilderness around (3104, 3872) |
| 4 | **Mine a mithril ore** | Mining 55 and a pickaxe | mithril rocks |
| 5 | **Chop a maple log** | Woodcutting 45 and an axe | maple trees |
| 6 | **Make a magic shortbow** | Fletching 80. Unstrung bow from magic logs, then string it | anywhere |
| 7 | **Burn a yew log** | Firemaking 60 and yew logs | anywhere you can light a fire |
| 8 | **Craft a law rune** | Runecrafting 54, **members** world, a law talisman and essence | law altar around (2858, 3381), on Entrana |
| 9 | **Harpoon a swordfish** | Fishing 50 and a harpoon | harpoon fishing spots |
| 10 | **Cook a raw shark** | Cooking 80. The cooked shark counts, a burnt one does not | any fire or range |
| 11 | **Smith a silver bar** | Smithing 20, silver ore and a furnace | any furnace |
| 12 | **Make a super attack potion** | Herblore 45, an unfinished Irit potion and an eye of newt | anywhere |
| 13 | **Pickpocket a paladin** | Thieving 70. A failed attempt stuns and hurts you | paladins |
| 14 | Defeat a **scorpion** | combat level 14, 17 HP | around (3040, 3552), (3296, 3296) or (2848, 3168) |
| 15 | Defeat a **bear** | brown bear (level 21) or dark bear (level 19) both count | brown: around (2720, 3360); dark: around (2976, 3488) |
| 16 | Defeat a **monkey** | combat level 3, 6 HP | Karamja, around (2848, 3040) and (2912, 3104) |
| 17 | Defeat a **green dragon** | combat level 79, 75 HP, members NPC | Wilderness around (3104, 3808) |
| 18 | Defeat a **blue dragon** | combat level 111, 105 HP | underground around (2592, 9440) |
| 19 | **Mine a runite ore** | Mining 85 and a pickaxe | runite rocks |
| 20 | **Chop a yew log** | Woodcutting 60 and an axe | yew trees |
| 21 | Defeat a **hellhound** | combat level 122, 116 HP | underground around (2848, 9824) or (2720, 9696) |
| 22 | Defeat a **black demon** | combat level 172, 157 HP | underground around (2848, 9760) or (3104, 9952) |
| 23 | Defeat a **Kalphite soldier** | combat level 85, 90 HP | Kalphite lair, around (3488, 9504) (height level 2) |
| 24 | Defeat the **King Black Dragon** | combat level 276. **Final task, no relic offer** | underground around (2720, 9824) |
| 25 | Defeat the **Kalphite Queen** | combat level 333, 255 HP. Her first form does not count: the kill that counts is her second (flying) form. **Final task, no relic offer** | Kalphite lair |

Coordinates are `(x, z)` in game tiles. They are the **centre of the 64x64 map square** that holds the spawns, so treat them as "around here", not an exact tile. A `z` of 6400 or more is an underground map square. I did not look up where the entrances are. Skill, level and combat numbers come from the game config files listed under *Evidence*.

!!! warning "Not verified"
    - Whether every task is reachable on a fresh character, and what else you need to get to the location (quests, keys, items), was not checked. The law altar and the Kalphite lair in particular may have access rules.
    - Task 6: stringing the bow counts (seen in a test, `tests/relic-tasks.test.ts`).
    - Task 12: brewing the potion counts (it makes a 3-dose super attack; seen in a test).
    - Every task row completes in tests. Real actions were tested for the goblin, mithril, maple, magic bow, yew burning, shark cooking, silver, super attack, paladin and yew tasks; runecrafting and fishing only through the hook, and the two bosses only through their death scripts (`docs/design/relics-e2e-tests.md`).
    - After you win (both bosses down) nothing resets, and pacing (the 10 hour target) was never measured (`docs/design/relics-m8-win-and-pacing.md`).

## Evidence

<details markdown="1">
<summary>Where each number on this page comes from</summary>

All paths are relative to the repo root. Content commit `6c7b18f`, root `8a83538`. Read, not run.

- Relic list and effects: `docs/design/roguelike-relics-spec.md:40-60`, names in `mods/relics/scripts/relic_offer.rs2:7-26`, effects in `mods/relics/scripts/relic_effects.rs2`.
- Phoenix 5 minutes: `relic_effects.rs2` sets `map_clock + 500` ticks. Stoneskin, Glass Cannon, Philosopher's Coin, Infinite Runes: same file. Bounty coin and food tiers: `relic_kill_effects` in the same file.
- Recall stone and Banker's stone: `mods/relics/configs/relic_items.obj`, ops handled at `relic_effects.rs2` (`[opheld1,relic_recall_stone]`, `[opheld1,relic_banker_stone]`).
- Task list: `docs/design/roguelike-relics.md` ("The task list (25)"); detection (the tier column in these files is now unused): `mods/relics/configs/relic_tasks.dbrow`, `mods/relics/configs/relic.constant`, `mods/relics/scripts/relic_tasks.rs2`.
- Mithril Mining 55: `Content/scripts/skill_mining/configs/mine.dbrow:101-109`. Runite Mining 85: `mine.dbrow:127-135`.
- Maple Woodcutting 45: `Content/scripts/skill_woodcutting/configs/trees.dbrow:116-118`. Yew Woodcutting 60: `trees.dbrow:131-133`.
- Magic shortbow Fletching 80: `Content/scripts/skill_fletching/configs/stringing/bows.dbrow:71-75` (stringing) and `cut_logs/cut_logs.dbrow:41` (unstrung).
- Yew Firemaking 60: `Content/scripts/skill_firemaking/configs/firemaking.obj` (`[yew_logs]`, `param=levelrequire,60`).
- Law rune Runecrafting 54, members flag and altar coord `0_44_52_42_53`: `Content/scripts/skill_runecraft/configs/runecraft.dbrow:138-148`, members check at `skill_runecraft/scripts/runecraft.rs2:33`. Coord format: [coordinates](../reference/coordinates.md). Entrana label near the altar: `Content/maps/labels.txt:15`.
- Swordfish Fishing 50: `Content/scripts/skill_fishing/scripts/fishing_spots/rarefish.rs2:113-114 and :145`.
- Shark Cooking 80: `Content/scripts/skill_cooking/configs/cooking_source/cooking_generic.dbrow:356-363`.
- Silver bar Smithing 20: `Content/scripts/skill_smithing/configs/smelting/smelting.struct:45-54`.
- Super attack Herblore 45, `iritvial` + `eye_of_newt`: `Content/scripts/skill_herblore/configs/brewing/brew_potion.struct:91-97`.
- Paladin Thieving 70: `Content/scripts/skill_thieving/configs/pickpocking/pickpocket.dbrow:105-115`.
- NPC combat level and HP (`vislevel`, `hitpoints`): the `.npc` configs, mostly `Content/scripts/_unpack/225/all.npc`, plus `areas/area_falador/configs/goblin_village/goblin_village.npc`, `areas/area_kalphite/configs/kalphite.npc` and `areas/area_wilderness/configs/king_dragon.npc`. The King Black Dragon entry has no `hitpoints` line in what was read, so none is shown.
- NPC locations: the `==== NPC ====` sections of `Content/maps/m*_*.jm2` (lines `level x z: npc id`), ids from `Content/pack/npc.pack`, summed per map square by a throwaway script. The "map label" idea (nearest place name) was not used because the label file is sparse.

</details>

## Related notes

- [Roguelike relics: spec](../design/roguelike-relics-spec.md) and [development plan](../design/roguelike-relics-dev-plan.md): what is decided and in which order it is built.
- [Relic offers (M4)](../design/relics-m4-offers.md) and [easy relics (M5)](../design/relics-m5-easy-relics.md): how the code behaves.

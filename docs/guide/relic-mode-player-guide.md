# Relic mode: player guide and tracker

!!! note "This page follows the current plan"
    The relic mode is still being built. Everything below comes from the plan and the code in `mods/relics/` as of root commit `8a83538` (Content `6c7b18f`). Relics and tasks may change, and some relics are listed but **not built yet** (see the *Status* column). Nothing here was run in a live game by the author of this page.

## The run in one minute

- You play a normal LostCityRS character (revision 274) with **8x XP** and **unlimited run energy**.
- There are **25 tasks**. Finishing one plays fireworks and the level-up jingle, then offers you **a pick of up to 3 random relics**.
- Relics are "game-breaking" perks (table below). One of them, the **XP Multiplier**, can be taken three times and lifts your XP rate to **16x, 32x, then 64x**.
- The last two tasks are the bosses: the **King Black Dragon** and the **Kalphite Queen**. Those two give no relic offer. Killing both is the end of the run.
- The first offer comes when you first log in (after Tutorial Island, or at once if you skip it).

### Rules worth knowing

1. **Tasks unlock in tiers.** Only tasks in the lowest tier that still has an unfinished task count. Tier 1 is tasks 1-6, tier 2 is 7-13, tier 3 is 14-23 and tier 4 is the two bosses. Inside a tier you may do them in any order. (`mods/relics/scripts/relic_tasks.rs2:1-24`)
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
| 1a | XP Multiplier I | XP rate 8x to **16x** | built | automatic |
| 1b | XP Multiplier II | XP rate 16x to **32x** (needs I) | built | automatic |
| 1c | XP Multiplier III | XP rate 32x to **64x** (needs II) | built | automatic |
| 2 | Quest Pass | every quest is marked complete | planned (M7) | automatic |
| 3 | Stoneskin | you take **half** the damage | built | automatic |
| 4 | Quickstrike | you attack **twice as fast** | planned (M7) | automatic |
| 5 | Glass Cannon | you deal **x2** damage to NPCs and take **x1.5** | built | automatic |
| 6 | Phoenix | a lethal hit leaves you on 1 HP, once every **5 minutes** | built | automatic |
| 7 | Vampire | you heal a little on **every kill** | built | automatic |
| 8 | Executioner | NPCs below 25% HP die instantly | planned (M7) | automatic |
| 9 | Bounty | every kill drops **coins plus one food**, bigger for tougher NPCs | built | pick the drop up |
| 10 | Eternal Vein | ore rocks never run out and ore goes **straight to your bank** | planned (M7) | automatic |
| 11 | Evergreen | trees never fall and logs go **straight to your bank** | planned (M7) | automatic |
| 12 | Double Yield | gathering and cooking give **x2** items | planned (M7) | automatic |
| 13 | Midas Loop | high alchemy keeps repeating on the same stack | planned (M7) | cast High Level Alchemy |
| 14 | Philosopher's Coin | alchemy pays **x2** coins | built | cast an alchemy spell |
| 15 | Infinite Runes | spells cost **no runes** | built | automatic |
| 16 | Everlasting Jewellery | duelling ring, glory amulet and games necklace never lose charges; one of each is put in your bank when you take it | built | use the jewellery |
| 17 | Last Recall | teleports you back to where you last teleported **from**; using it again swaps between the two places | built | a **Recall stone** item, op *Recall* |
| 18 | Banker's Call | opens your bank from anywhere | built | a **Banker's stone** item, op *Open bank* |
| 19 | Hoarder | one extra pick from relics you declined earlier | built | automatic, right after you take it |

*Status* means "the code exists in `mods/relics/scripts/`" (built) or "is in the plan but its milestone is not done" (planned). "Built" is not the same as tested in a live game. For the details and the code, see [M5: easy relics](../design/relics-m5-easy-relics.md) and the [development plan](../design/roguelike-relics-dev-plan.md).

## Tasks { #tasks }

<div class="relic-tracker-bar" data-for="tasks"></div>

The **Tier** column shows when a task counts: only tasks up to the current tier count (rule 1). Rows of a tier you cannot use yet are greyed out once you start ticking.

| # | Tier | Task | Requirements | Where (from the map spawn data) |
|---|---|---|---|---|
| 1 | 1 | Defeat a **goblin** | none. Any of five goblin types counts: combat levels 2, 5 or 13 | Lumbridge (3232, 3232), Rimmington (2976, 3232), Goblin Village (2976, 3488) |
| 2 | 1 | Defeat a **lesser demon** | a real fight: combat level 82, 79 HP | underground around (2848, 9568) |
| 3 | 1 | Defeat a **giant** | combat level 28, 35 HP. There is no "Hill giant" NPC; the plain *Giant* counts | underground around (3104, 9824), or in the Wilderness around (3104, 3872) |
| 4 | 1 | **Mine a mithril ore** | Mining 55 and a pickaxe | mithril rocks |
| 5 | 1 | **Chop a maple log** | Woodcutting 45 and an axe | maple trees |
| 6 | 1 | **Make a magic shortbow** | Fletching 80. Unstrung bow from magic logs, then string it | anywhere |
| 7 | 2 | **Burn a yew log** | Firemaking 60 and yew logs | anywhere you can light a fire |
| 8 | 2 | **Craft a law rune** | Runecrafting 54, **members** world, a law talisman and essence | law altar around (2858, 3381), on Entrana |
| 9 | 2 | **Harpoon a swordfish** | Fishing 50 and a harpoon | harpoon fishing spots |
| 10 | 2 | **Cook a raw shark** | Cooking 80. The cooked shark counts, a burnt one does not | any fire or range |
| 11 | 2 | **Smith a silver bar** | Smithing 20, silver ore and a furnace | any furnace |
| 12 | 2 | **Make a super attack potion** | Herblore 45, an unfinished Irit potion and an eye of newt | anywhere |
| 13 | 2 | **Pickpocket a paladin** | Thieving 70. A failed attempt stuns and hurts you | paladins |
| 14 | 3 | Defeat a **scorpion** | combat level 14, 17 HP | around (3040, 3552), (3296, 3296) or (2848, 3168) |
| 15 | 3 | Defeat a **bear** | brown bear (level 21) or dark bear (level 19) both count | brown: around (2720, 3360); dark: around (2976, 3488) |
| 16 | 3 | Defeat a **monkey** | combat level 3, 6 HP | Karamja, around (2848, 3040) and (2912, 3104) |
| 17 | 3 | Defeat a **green dragon** | combat level 79, 75 HP, members NPC | Wilderness around (3104, 3808) |
| 18 | 3 | Defeat a **blue dragon** | combat level 111, 105 HP | underground around (2592, 9440) |
| 19 | 3 | **Mine a runite ore** | Mining 85 and a pickaxe | runite rocks |
| 20 | 3 | **Chop a yew log** | Woodcutting 60 and an axe | yew trees |
| 21 | 3 | Defeat a **hellhound** | combat level 122, 116 HP | underground around (2848, 9824) or (2720, 9696) |
| 22 | 3 | Defeat a **black demon** | combat level 172, 157 HP | underground around (2848, 9760) or (3104, 9952) |
| 23 | 3 | Defeat a **Kalphite soldier** | combat level 85, 90 HP | Kalphite lair, around (3488, 9504) (height level 2) |
| 24 | 4 | Defeat the **King Black Dragon** | combat level 276. **Final task, no relic offer** | underground around (2720, 9824) |
| 25 | 4 | Defeat the **Kalphite Queen** | combat level 333, 255 HP. Her first form does not count: the kill that counts is her second (flying) form. **Final task, no relic offer** | Kalphite lair |

Coordinates are `(x, z)` in game tiles. They are the **centre of the 64x64 map square** that holds the spawns, so treat them as "around here", not an exact tile. A `z` of 6400 or more is an underground map square. I did not look up where the entrances are. Skill, level and combat numbers come from the game config files listed under *Evidence*.

!!! warning "Not verified"
    - Whether every task is reachable on a fresh character, and what else you need to get to the location (quests, keys, items), was not checked. The law altar and the Kalphite lair in particular may have access rules.
    - Task 6: it is not settled whether cutting the unstrung bow or stringing it counts; make the finished bow to be safe.
    - Task 12: the plan says the exact super attack dose that counts is not settled (`docs/design/roguelike-relics.md`, task list); make a potion and keep it.
    - Task 13 (pickpocket success) is not hooked in the mod yet; ticks for 4-13 and 19-20 depend on the "product" hooks in milestone 7.

## Evidence

<details markdown="1">
<summary>Where each number on this page comes from</summary>

All paths are relative to the repo root. Content commit `6c7b18f`, root `8a83538`. Read, not run.

- Relic list and effects: `docs/design/roguelike-relics-spec.md:40-60`, names in `mods/relics/scripts/relic_offer.rs2:7-26`, effects in `mods/relics/scripts/relic_effects.rs2`.
- Phoenix 5 minutes: `relic_effects.rs2` sets `map_clock + 500` ticks. Stoneskin, Glass Cannon, Philosopher's Coin, Infinite Runes: same file. Bounty coin and food tiers: `relic_kill_effects` in the same file.
- Recall stone and Banker's stone: `mods/relics/configs/relic_items.obj`, ops handled at `relic_effects.rs2` (`[opheld1,relic_recall_stone]`, `[opheld1,relic_banker_stone]`).
- Task list: `docs/design/roguelike-relics.md` ("The task list (25)"); tiers and detection: `mods/relics/configs/relic_tasks.dbrow`, `mods/relics/configs/relic.constant`, `mods/relics/scripts/relic_tasks.rs2`.
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

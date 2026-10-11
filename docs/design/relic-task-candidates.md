# Relic task candidates: unique encounters and dialogues

**Question this answers:** which unique, fun main-world encounters or dialogues in the RuneScript could become relic tasks? (Calum, 2026-10-11.) Quests (`Content/scripts/quests/`, or any script gated on a quest varp) and instanced areas are excluded.

**Based on:** root `e92c160`, Content `bf73428d9`. **Method:** three read-only scans of `Content/scripts/areas`, `general*`, `npc`, `player`, `minigames`, `skill_agility`, `skill_thieving`, then my own re-read of the scripts quoted below. **Nothing was run.** Nothing here is implemented; the list waits for Calum's pick.

All paths are under `Content/scripts/`. "Verified" = I opened the lines and the quoted snippet is from them. "Scan only" = reported by a scan, not re-opened by me.

## How a candidate becomes a task (existing mechanism)

Tasks are NPC-kill rows, item rows (`~relic_task_obj`) or hook procs such as `~relic_task_spell` (`docs/design/relics-skilling-tasks.md`, `mods/relics/scripts/relic_tasks.rs2`). A kill task needs only a table row. Any dialogue/interaction candidate below needs a **new hook**: one `~relic_task_try`-style call inserted at the line named in "Hook", a one-line edit to the Content script (logged in `docs/local-changes.md`). The varps used by the quest-style scripts could be read instead, but only where noted.

## Shortlist (verified)

| # | Task idea | Where | Why it's fun | Script | Hook |
|---|---|---|---|---|---|
| 1 | **Reach the Wine of Zamorak and take it** | Chaos temple, tile `0_45_54_50_59` | "STOP STEALING MY WINE! GAH!": flame, damage, five stats drained, chaos monks attack | `general/scripts/misc/wine_of_zamorak.rs2:5-12` (`[opobj3,wine_of_zamorak]`) | New: after the `mes`. Needs `obj_coord` check already present |
| 2 | **Tell Hans you've come to kill everyone** | Lumbridge castle | He flees yelling "Help! Help!" | `areas/area_lumbridge/scripts/hans.rs2:24-28` | New: option 2 branch |
| 3 | **Get yourself arrested by Shantay** | Shantay Pass | Pick "I am definitely an outlaw, prepare to die!": jailed, teleported to a cell, fined 5gp or sent to Port Sarim prison | `areas/area_alkharid/scripts/shantay.rs2:24-42`. Already sets `%shantay_jail_progress = ^put_in_shantay_jail` | None needed if the task reads that varp, otherwise a one-line hook |
| 4 | **Provoke Colonel Radick ("Foe!")** | Yanille | He answers "Oh righty..." and attacks you | `areas/area_yanille/scripts/colonel_radick.rs2:1-12` (`~npc_retaliate(0)`) | New: option 2 branch |
| 5 | **Steal the barbarians' beer** | Barbarian Village (3 tapped barrels) | Use an empty beer glass on the barrels and every nearby barbarian shouts "Oi - that's ours!" and attacks | `general_use/scripts/barrels.rs2:1-10`, `areas/area_barbarian_village/scripts/beer_barrels.rs2:1-9` | New: in `[label,beer_barrel_beatdown]` |
| 6 | **Lie to the cave monk and dive into Entrana's dungeon** | Entrana | One-way ladder, prayer set to 5 on entry, only exit is a portal into the deep Wilderness | `areas/area_entrana/scripts/cave_monk.rs2:1-15` (members area, access to Entrana not checked) | New: option 2 branch |
| 7 | **Bribe the bridge workman with beer** | Troll bridge, Seers/Rellekka path | Hand him a beer and he gives you a firecracker (other drinks get a joke refusal) | `areas/area_vt/scripts/vt_council_workman.rs2:21-26` (`[opnpcu,vt_council_workmen]`) | New: after `inv_add(... viking_firecracker ...)` |
| 8 | **Open the crystal chest** | Taverley (needs a crystal key, made by joining two halves that come from drop tables) | Always an uncut dragonstone plus a random prize, sometimes a new key half | `areas/area_taverly/scripts/crystal_chest.rs2:6-30`, `crystal_key.rs2:1-15`. Key halves are in `drop tables/scripts/shared_droptables.rs2` (not read) | New: in `[label,open_crystal_chest]`, or `~relic_task_obj(uncut_dragonstone)` |
| 9 | **Wake the Taverley dungeon suit of armour** | Taverley dungeon, iron door | "Suddenly the suit of armour comes to life!" and it attacks | `areas/area_taverly/dungeon/scripts/prison_doors.rs2:8-17`. Kill task would need the `suit_of_armour` npc row | None for a kill task |
| 10 | **Steal an ogre's rock cake** | Yanille ogre stall | Thieving 15. The ogre trader attacks if he's within 3 tiles | `areas/area_yanille/scripts/ogre_trader.rs2:21-38` | New: after `inv_add(inv, rockcake, 1)`, or `~relic_task_obj(rockcake)` |
| 11 | **Pray at the trapped chaos altar** | Yanille agility dungeon | Prayer restored, then "Suddenly a trap door opens beneath you..." and you drop with damage | `areas/area_yanille/scripts/agility_dungeon.rs2:127-139`. Other obstacles in this file have agility requirements not re-read | New: after the `p_teleport` |
| 12 | **Win the Mage Arena** (beat Kolodion through his forms to the final "koldemon") | Mage Arena | Real multi-stage boss fight: `%magearena` 1-5 then `^mage_arena_complete`; no weapons or armour, magic 60, god capes/staves afterwards | `areas/area_mage_arena/scripts/kolodion.rs2:1-60`, `kolodion_fight.rs2:100-139`. Not under `quests/` and no journal entry found by grep of `quests/` and `general/scripts/quests.rs2`, but the `%magearena` varp makes it quest-like (see Open points) | None: kill row for `koldemon`, or read `%magearena` |
| 13 | **Complete the Gnome Bar cocktail training** | Gnome Stronghold | Make the cocktails from Blurberry's fixed recipes, progress varp reaches 7 | `areas/area_gnome/scripts/gnome_bar.rs2` (`%gnome_bar_progress` set 1..6 in the file), `blurberry.rs2:14` treats 7 as "trained". Same shape for the restaurant: `gnome_restaurant.rs2`, `aluft_gianne.rs2:16`. Quest checks not found in these files | None: read the varp |
| 14 | **Win a game of Gnomeball** | Gnome Stronghold | Football minigame, "You win!" at 5 goals | `minigames/game_gnomeball/scripts/gnomeball_shoot.rs2:39` (scan: others in `gnome_baller.rs2`, `gnomeball_referee.rs2`). Note `docs` memory says Gnomeball also triggers the skilling second-chance hook | New: next to `mes("You win!")` |
| 15 | **Hit a Bulls-Eye** in the Ranging Guild competition | Ranging Guild | Rare roll at the target, 100 points | `minigames/game_ranging/scripts/target.rs2:59` (`"Bulls-Eye!"`). Entry needs Ranged 40 and a fee (scan: `ranging_guild_door.rs2:17`) | New: in the bullseye branch |
| 16 | **Open a spooky wardrobe** (1 in 21 skeleton) | Anywhere with a spooky wardrobe | "Eek! There's a skeleton in there." | `general_use/scripts/wardrobes.rs2:10,34-36` | New: but pure luck, and the wardrobe's map location is not verified |

## Easter-egg style (scan only, cheaper to skip)

- Canifis townspeople turn into werewolves when you attack them, unless you wear the wolfbane dagger: `areas/area_canifis/scripts/canafis_citizen.rs2:19-24` (verified). Kill the werewolf = reuses the kill hook.
- Grayzag the wizard summons imps mid-fight, capped at 5: `areas/area_wizard_tower/scripts/wizard_grayzag.rs2:3-24` (verified, comments say the numbers are "completely guessed").
- Aggie's fine for insulting her, Diango's toy horsey, Ned's wig, Makeover mage, Kalphite old man: scan only.
- Hard-clue wizard ambush (`general_use/scripts/spade.rs2:40-61`): requires a hard clue (rare drop), so a slow task.
- Ardougne Necromancer Invrigar (`areas/area_ardougne_east/scripts/necromancer_tower.rs2`): combat AI read (zombie summons), but his spawn is only in `_unpack/225/all.npc` as far as my grep went, so whether he is placed in the live map is **not verified**.

## Rejected, with the reason

- **Quest-gated or quest content**: Oziach, Hazelmere, gnome glider and spirit trees, Heroes' Guild entry, Priest in Peril monuments, Biohazard gate, poison salesman, barcrawl bars (`quests/quest_barcrawl`), poison karambwan (Tai Bwo Wannai), strange fruit (triffid random event, disabled), Merlin's beehive.
- **Needs a second real player**: Christmas cracker, Duel Arena, Games Room.
- **Already tasks or duplicates**: King Black Dragon (24), Kalphite Queen (25), green and blue dragons, hellhound, black demon, lesser demon.
- **Random events** are off (`^macro_events_enabled = 0`, `macro events/configs/macro_events.constant`).
- **Borderline, not recommended**: Fishing Trawler (single shared boat), Party Room, Agility Arena, agility course laps (mostly skill grind), Shantay desert survival.

## Not checked

Level, membership and access rules for most rows (Entrana boat, Kalphite, Zanaris), whether each target spot is reachable on a fresh character, the key-half drop tables, and anything at runtime. Scan-only items need re-reading before use.

## Open points for Calum's pick

1. Is the Mage Arena "main world" enough? It has a `%magearena` progress varp but no quest journal entry.
2. Dialogue tasks (2, 3, 4, 6, 7) are one-line hooks but trivially short. Do you want mostly fights and mini-events (1, 5, 9, 12) instead?

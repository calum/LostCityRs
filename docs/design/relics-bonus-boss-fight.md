# Bonus boss fight after the final bosses (feasibility)

**Question this answers:** how feasible is an extra fight after King Black Dragon (KBD) dies: wait until every player in the lair has clicked Continue on the "challenge complete" dialog, then spawn 2 KBDs and 2 Kalphite Queens (KQ), one in each corner of the lair, which attack the group as a final bonus challenge? What can already be done in RuneScript, what breaks, and how would the bonus completion be recorded?

**Based on:** root `3b0c433`, Engine-TS `33564f19`, Content `b36ee553b`. **Method:** code read, plus three throw-away experiments in the headless harness (Node 24.11.1, `node harness/run.mjs`): a collision map of the lair, a spawn of 2 KBD + 2 KQ at the corners with bots inside, and a prototype RuneScript that queues a dialog on every player in the lair and counts who has clicked Continue. The scratch test and mod were deleted afterwards (nothing in `tests/`, `mods/` or the submodules changed). Nothing was seen in a real client. The research sections below were written before building; see "Built (2026-10-11)" at the end for what was implemented after Calum simplified the design.

## Summary

**Feasible, medium effort, no engine change found.** Every piece exists as a RuneScript command or an existing pattern, and the three risky unknowns (can the bosses be placed and made hostile, can "everyone has acknowledged" be detected, what happens when a player leaves) were exercised in the harness. The hard parts are not technical: a room that is small for four 5x5 bosses, balance, and the rule for who counts as "in the room". My estimate is 2 to 3 working days including tests, then open-ended tuning in a real client. Recommendation: build it, as a one-off encounter gated on both final bosses, with a polling controller (not an "everyone clicked" event), and tune with play.

## What exists today (read)

1. **The two finals are tasks 24 (KBD, `npc,king_dragon`) and 25 (KQ, `npc,kalphite_flyingqueen`, the second form)** (`mods/relics/configs/relic_tasks.dbrow:97,103`). They are plain bits in `%relic_tasks_done`; either can come first. When a player's second final lands, `[queue,relic_task_done]` calls `~relic_win` (`mods/relics/scripts/relic_offer.rs2:286,295`), which sets the finish time and shows the `~mesbox` "Congratulations!" dialog (`relic_offer.rs2:364-367`; finish time `relic_playtime.rs2:30-35`). So the "challenge complete" dialog the idea builds on already exists, and it is per player.
2. **Shared credit.** `[proc,npc_death]` starts with `~relic_on_kill` (`Content/scripts/skill_combat/scripts/npc/npc_death.rs2:11`), which loops damage ranks 0 to 15 and gives every online damager the kill task (`mods/relics/scripts/relic_tasks.rs2:27-37`, `npc_findheroat` `Engine-TS/src/engine/script/handlers/NpcOps.ts:42`). Any NPC of those types triggers it, including ones added by script.
3. **Play time freezes at the win** (`%relic_finish_ticks`, `relic_playtime.rs2:30-35`; `docs/design/relics-playtime.md`).

## 1. Detecting every player in the lair, and waiting for each to acknowledge

- **The lair is map square `0_42_153`**, not `0_47_160`. Evidence: the KBD spawns at `m42_153`, local (28,25) = (2716, 9817) (`Content/maps/m42_153.jm2:7622`); the lever "into the Dragon's lair" teleports to `0_42_153_29_10` = (2717, 9802) (`Content/scripts/areas/area_wilderness/scripts/king_black_dragon.rs2:359-371`); `multiway.csv` lists a "kbd lair" block of 16 zones `0_42_153_{16..40}_{8..32}`, i.e. x 2704-2735, z 9800-9831 (`Content/maps/multiway.csv:2629`ff). `0_47_160` is the antechamber (`docs/reference/finding-npc-locations.md:40`). (`docs/design/custom-lair-music.md` assumed `0_47_160` was the lair; corrected there.)
- **Finding the players.** `huntall(coord, distance, 0)` + `huntnext` iterates players around a point (`PlayerOps.ts:1301-1330`; zone scan with `distanceToSW`, `ScriptIterators.ts:174-212`). `map_multiway(coord)` (`ServerOps.ts:337`) is true exactly in the lair's zones, so `huntall(0_42_153_32_20, 16, 0)` filtered by `map_multiway(coord)` gives "players in the lair". **Observed:** 3 bots in the lair were counted; a bot 20 tiles west in the cave and one 78 tiles away were not.
- **Pitfalls found by running it:** the iterator is only valid in the tick it was created (`ScriptIterators.ts:209` throws), so it cannot be held across a suspended dialog; and `huntnext` overwrites the active player, so a later `mes(...)` goes to the last player found. Save `def_player_uid $self = uid;` before the loop and restore with `p_finduid($self)`.
- **Dialog per player.** `queue(my_queue, 0, 0)` inside the `huntnext` loop runs a script on each found player (same idiom as `relic_on_kill`). The script sets a perm varp to 1 ("waiting"), runs `~mesbox(...)` (`Content/scripts/interface_chat/scripts/chat.rs2:439-447`, `p_pausebutton`) and sets it to 2 ("acked") afterwards. **Observed (prototype):** all three bots got the dialog, one clicked Continue and read 2, the other two stayed at 1.
- **An acknowledgement can be lost.** `Player.closeModal` and `openMainModal` throw away a script suspended in `p_pausebutton` (`Engine-TS/src/engine/entity/Player.ts:775-778`, `2055-2058`), so the code after the `mesbox` never runs. **Observed:** a bot that walked one step lost its dialog and stayed at state 1 forever. Any `if_close` has the same effect; the boss attack scripts call it (`king_black_dragon.rs2:125,176,200,231,275`). So "everyone clicked" cannot be an event.
- **A player can disappear.** A bot removed (logged out) was simply no longer found by the scan (waiting count dropped 2 to 1). Real logouts are delayed 16 ticks after combat (`Content/scripts/login_logout/logout.rs2:24-28`); a dropped connection requests an idle logout after 50 ticks and is force-logged out after 100 (`Engine-TS/src/engine/World.ts:132-133,740-751`).
- **Design that follows (inference):** a controller polls every few ticks. It scans the lair; players at 1 and not in a dialog get the dialog re-queued; when nobody is at 1 and at least one is at 2, it spawns the bosses; a timeout (say 2 to 3 minutes) spawns anyway for those who acked. The controller can be an NPC with a `timer` (`Npc.ts:551-553` runs `[ai_timer,<type>]`) or soft timers on the players; an NPC is the simpler single source of truth. A new invisible NPC type would be needed; `mods/relics/configs/relic_keeper.npc` shows how mod NPCs are declared (not read in detail).
- **Who is "in the room"?** Decide: everyone in the lair, or only the players credited with the KBD kill (the rank loop in `relic_on_kill`). The second is easier and avoids a bystander blocking the wait; late arrivals through the lever are then simply not required.

## 2. Spawning the bosses, aggression, pathing, size

- **Spawning.** `npc_add(coord, type, duration)` (`NpcOps.ts:71-82`) builds an NPC with `EntityLifeCycle.DESPAWN` and `World.addNpc` (`World.ts:1270-1294`). It validates nothing about the tiles: it only marks collision. Existing script spawns: `Content/scripts/general_use/scripts/spade.rs2:51`, `Content/scripts/general/scripts/misc/wine_of_zamorak.rs2:22`.
- **Aggression needs no script.** Both bosses have `huntmode`: KBD `huntmode=king_dragon` (`Content/scripts/areas/area_wilderness/configs/king_dragon.npc:49`, hunt `king_dragon.hunt`: players, line of sight), KQ `huntmode=kalphite_queen` (`kalphite.npc:199`/`:240`). `Npc.huntPlayers` skips the "already in combat" checks inside multi zones (`Npc.ts:1017`), and the whole lair is multi. **Observed:** I spawned 2 KBD and 2 KQ at four corner tiles with two bots inside (bots had 99 hp, no gear, did not fight back): all four had picked a target within 5 ticks and walked towards the bots. Both bots were dead within about 20 ticks ("You're horribly burnt by the dragon's fiery breath!", "Oh dear you are dead!"). I saw the KQs acquire targets and move but did not confirm a KQ hit landing. To force a target instead, set `npc_setmode(opplayer2)` with a player active (`wine_of_zamorak.rs2:22`; the spade script also sets `%npc_aggressive_player`, `spade.rs2:56-59`).
- **Reach limits.** Hunt range: KBD 20 (`king_dragon.npc:27`), KQ ground 15 (`kalphite.npc:200`), KQ flying 10 (`kalphite.npc:241`). KQ spells hit everyone within 10 tiles in line of sight (`kalphite_queen.rs2:90`, `huntall(coord, 10, 1)`), ranged hits up to 5 (`:135`). A player hiding behind rock outside line of sight is not hit by the spell and may not be hunted; the lair is about 20 tiles across so this is a small risk.
- **Size and space.** KBD, KQ ground, KQ flying and the KQ corpse are all `size=5` (`king_dragon.npc:2`, `kalphite.npc:193,223,232`). From a collision flood fill with the engine's own `canTravel` (size 5, started at the KBD's spawn): the lair floor reachable by a player from the entrance is **430 tiles**, about 21 wide (x 2709-2729) and 30 tall (z 9802-9831) with irregular rock. Map below: `O` = tile where a size-5 NPC can stand (its south-west corner), `+` = walkable by a player only, `.` = free but not reached from inside, `#` = blocked.

```
z\x  2704                    2728
9831 #########.......##############
9830 #####....#+#####.#############
9829 ####.#####++++#+#...##########
9828 ###.#####++++++++###....######
9827 ###.#####+++++++++++####.#####
9826 ###.###++++++++++++++####.####
9825 ##.###++++++++++++++++####.###
9824 #.###++++OOOO+++++++++####.###
9823 #.###++++OOOOOOO+++++++#######
9822 #.#.#++OOOOOOOOOO++++++####.##
9821 #####+OOOOOOOOOOOO+++++++###.#
9820 ####+OOOOOOOOOOOOO++++++++##.#
9819 ####+OOOOOOOOOOOOOO+++++++##.#
9818 ##.#+OOOOOOOOOOOOOO+++++++#..#
9817 ##.#+OOOOOOOOOOOOOOOO++++###.#
9816 ##.#OOOOOOOOOOOOOOOO++++####.#
9815 ###.#OOOOOOOOOOOOOO++++####.##
9814 ####.#OOOOOOOOOOOOO++++###.###
9813 ####.#OOOOOOOOOOOOO++++##.####
9812 ####.#OOOOOOOOOOOOO++++##.####
9811 ####.#OOOOOOOOOOOOO++++#.#####
9810 #####.OOOOOOOOOOOOO++++.######
9809 #####.OOOOOOOOOOOO++++#.######
9808 #####.OOOOOOOOOOOO++++.#######
9807 #####.OOOOOOOOOOOO++++.#######
9806 #####.#OOOOOOOOOO++++#.#######
9805 ######.#OOOOOOOO++++#.########
9804 #######.##OOO++++#...#########
9803 ########..#OO++++.############
9802 ##########.#+++##.############
9801 ##########.#++##.#############
```

  Candidate corner anchors from this map (south-west tile of each boss): NW (2711, 9822), NE (2724, 9817), SE (2722, 9810), SW (2710, 9807). Four bosses take 100 tiles of 430, and **the entrance (2717, 9802) is a 3-wide neck**: a boss anchored near (2715-2716, 9803-9804) would sit on the arrival tile. Spawning on top of a player was not tested.
- **The static KBD comes back.** When the real KBD dies, `npc_death` ends with `npc_del` (`npc_death.rs2`), and the static spawn respawns after `respawnrate=150` ticks (`king_dragon.npc:30`; `World.removeNpc` scales this by player count, about 150 ticks for a few players, `World.ts:1308-1334,1732-1735`). A fifth KBD would join the fight, or attack the group while it waits for the dialog. It has to be handled (spawn the bonus bosses before then, or delay the respawn).
- **No Kalphite workers.** `[ai_queue2,kalphite_queen]` calls `~kalphite_worker_spawn` (`kalphite_queen.rs2:27-29`), but workers only appear next to `kalphite_egg` locs near the coordinates in `cocoon_coords`, all in `0_54_148` (`kalphite_worker_spawn.rs2:8`, `kalphite_cocoon.enum`). Not checked: whether any egg loc is near the KBD lair (it is a different map square, the KQ lair is 700+ tiles away).
- **KQ's two forms.** On the ground form's death, `[ai_queue3,kalphite_queen]` does not kill it: it adds a corpse NPC for 3 ticks, then `npc_changetype_keepall(kalphite_flyingqueen, 2000)` and `npc_statheal(hitpoints, 0, 100)` (`kalphite_queen.rs2:36-58`). The flying form, with its own attack set, has the real death script (`Content/scripts/drop tables/scripts/kalphite_queen.rs2:1-2`, `gosub(npc_death)`). So each KQ is **two 255-hp health bars** (`kalphite.npc:203,244`). For an NPC from `npc_add`, `changeType` sets the lifecycle to 2000 ticks (`Npc.ts:443-465`) and the DESPAWN path then removes it (`Npc.ts:134-140`): an unkilled flying KQ vanishes after 20 minutes without dying.

## 3. Knowing when all four are dead

- Every death runs `~relic_on_kill` first (`npc_death.rs2:11`), so a hook there can see each bonus boss die. To tell bonus bosses from ordinary ones (and from the respawned static KBD) they need a mark: an NPC var (varn files exist, e.g. `Content/scripts/npc/configs/ai_spawn.varn`; whether the value survives `changetype_keepall` was **not verified**), or the controller keeps a list of uids. Alternative: the controller counts live NPCs of the three types in the lair on each poll, ignoring any not marked.
- Treat three end states: all four dead (success), everyone in the lair dead or gone (failure), timeout (despawn, see above). The KQ ground-to-flying switch must not count as a death.
- Normal tasks: bonus KBD/KQ are the same NPC types, so killing one runs `relic_kill_tasks` and could give tasks 24/25 to a player who lacks them (`relic_tasks.rs2:40-47`). If only winners are invited that is harmless; otherwise gate it.

## 4. Death and logout mid-fight

- **Death** is the normal player death: respawn in Lumbridge (`Content/scripts/player/scripts/death.rs2:32`), 3 most valuable items kept, the rest dropped where they died; relic items go to the bank instead (`mods/relics/scripts/relic_death.rs2`). Where the drops land and their timers in the lair were not checked. The way back is the Wilderness ladder to the lever (`docs/reference/finding-npc-locations.md:37-38`), so a dead player is effectively out of the fight. **Observed:** after the bots died the bosses dropped their targets and stood idle; they did not return to their spawn tiles within 30 ticks.
- **Logout.** Combat blocks logout for 16 ticks (`logout.rs2:24-28`; `auto_retaliate.rs2:2,26` call it), so a clean logout mid-fight is not instant; a dropped connection stays in the world up to 100 ticks. Where a player logs back in (still in the lair, possibly empty or mid-fight) was not tested.
- **Leaving.** The out-lever (`king_black_dragon.rs2` `dragonkingoutlever`) has no combat check in the script; whether the lever stands inside the lair was not checked. Players can probably leave the encounter at will.

## 5. Recording the bonus completion

- **Do not add a numbered task 46.** Tasks 1-45 are counted by loops to `^relic_task_count = 45` (`relic.constant:6`; `relic_offer.rs2:177-186`), that count drives the Quest Pass at 10 and the XP Multiplier every 5th (`relic_offer.rs2:304-317`), and the Tasks menu has 45 rows (`relic_menus.rs2:83-108`).
- **Use its own perm varp(s)** in `mods/relics/configs/relic.varp`, like `relic_finish_ticks` (`relic.varp:75-77`): `relic_bonus_done` (0/1) and optionally `relic_bonus_ticks`. Set it in the same queue that credits the kill (varps need protected access, `relic_tasks.rs2:15-16` comment). Add one line to the Relics menu next to the finish time (`relic_playtime.rs2:37-44`) and a chat line plus `:relictask:` style toast. The finish time stays frozen at the first win; the bonus does not touch it.
- **Who gets credit** (decide): everyone who dealt damage to any bonus boss (consistent with `relic_on_kill`), or everyone still alive in the lair at the last kill.

## Effort (estimate)

| Piece | Rough size |
|---|---|
| Trigger after the win, ack queue, polling controller with re-queue and timeout | 0.5 day |
| Spawn four bosses at anchors, mark them, count deaths, handle KQ forms, timeout and failure, static KBD respawn | 0.5 to 1 day |
| Completion varp, menu line, messages, guide update | 0.25 day |
| Harness tests (ack gate: all click / one walks away / one logs out / timeout; spawn positions; all four dead completes; death mid-fight; KQ both forms) | 0.5 to 1 day |
| Balance tuning in a real client | open-ended |

## Risks

1. **Balance.** KBD fire max hit 65 (`king_black_dragon.rs2` `kbd_fiery_breath_maxhit`), KQ spells and spines up to 31 on every player in reach. Four at once in a 430-tile room is very hard; in the experiment unarmoured bots died in about 20 ticks (meaningless for tuning, only proof of aggression). May need fewer bosses, lower stats, or phases.
2. **Cramped room, 5x5 bodies, one 3-wide entrance neck.** Pick anchors carefully; players can be trapped or boxed in.
3. **Lost acknowledgements** (verified above): the controller must re-offer or time out.
4. **Static KBD respawn** after 150 ticks joins the fight.
5. **Players who leave or get stuck** (lever, logout, disconnect) must not hang the encounter.
6. **Not covered by the harness:** how five giant models, projectiles and four sets of attack animations look and run in the real client, line-of-sight edge cases, real-time lag. Needs a live run (`docs/setup/headless-test-harness.md`, "Differences from a real client").

## Decisions needed from Calum

1. Trigger: when a player's second final lands (any order), or only a KBD kill by a player who already has both?
2. Who must acknowledge: everyone in the lair, or only the KBD killers? (Recommended: the killers, plus a timeout.)
3. Must all four bosses be 5x5 full strength, or tone down (HP, damage) for a bonus?
4. Credit: damage dealers, or survivors?

## Not checked

- Anything in a real client; the KQ landing a hit in the experiment; spawning on top of a player; the exact drop location and timers of items lost in the lair; whether the out-lever is inside the lair; whether a varn survives `npc_changetype_keepall`; how an invisible controller NPC type is declared; the sizes of Kalphite egg locs relative to the lair; balance. Listed in `open-questions.md`.
- The harness experiments used bots with default stats and no combat, and removed the static KBD where noted (after `World.removeNpc` with a long respawn). They are not committed.

## Built (2026-10-11): the simplified version

Calum simplified the design: a fixed timer instead of waiting for acknowledgements, death sends you back to the lever with your items, no despawn or old-KBD-respawn handling, and a per-player glow. Built test-first (`tests/relic-bonus-boss.test.ts`, 6 tests; failing run: 4 of 6 failed on missing behaviour, then 6 of 6 pass). Full suite: 379 of 380 pass; the one failure, `xp overflow: a single huge gain from level 1 caps too` (`tests/xp-overflow.test.ts`), fails identically with these changes stashed, so it is not caused by this work (cause not investigated; likely my local `world.json` XP rate). Not seen in a real client.

**Behaviour.** All in `mods/relics/scripts/relic_bonus.rs2`, configs in `mods/relics/configs/relic_bonus.{npc,spotanim,enum}` and `relic.varp`.
1. `[proc,relic_bonus_arm]` is the last line of `[proc,relic_on_kill]` (`relic_tasks.rs2`). When a `king_dragon` dies inside the lair box (x 2704-2735, z 9800-9831, level 0) and no fight or timer is already running, it adds an invisible `relic_bonus_timer` npc with duration 25 ticks (15 s). Who is in the room, who killed it and whether anyone clicked the win dialog do not matter. It uses the dotted `.npc_find` / `.npc_add` so the dying npc stays the active one for the rest of `npc_death`.
2. `[ai_despawn,relic_bonus_timer]` (the npc lifecycle ends; `Npc.ts:134-140`) adds 2 `king_dragon` at 0_42_153_23_30 and 0_42_153_34_18 and 2 `kalphite_queen` at 0_42_153_36_25 and 0_42_153_22_15 (the corner anchors from the map above), 3000 ticks each, plus an invisible `relic_bonus_glow` controller, and tells everyone in the lair "The lair shakes. A final challenge begins!". Aggression is the bosses' own huntmode (verified earlier).
3. **Glow.** `[ai_timer,relic_bonus_glow]` (`timer=2`) runs every 2 ticks: it lists the colours already taken in the lair, gives each player without one a random free colour of 12 through `[queue,relic_bonus_colour_q]` (temp varp `%relic_bonus_colour`, 0 = none), and re-plays that colour's `spotanim_pl` on everyone in the lair. The 12 effects are `relic_bonus_aura0..11`: copies of the existing `spells_confuse_impact` spotanim used for the Kalphite glow (`kalphite.spotanim`), recoloured with `recol1d`. Colours reset at the start of each fight. If more than 12 players are present, colours repeat. A player who dies and leaves the lair stops being refreshed.
4. **Death.** `Content/scripts/player/scripts/death.rs2` (`[queue,player_death]`): `def_boolean $bonus = ~relic_bonus_death;` skips the item-loss branch and teleports to `0_47_160_59_14` (the lever outside, the out-lever's destination) instead of Lumbridge; the common tail (stat reset, heal, prayers off) still runs. `~relic_bonus_death` is true only when the player is in the lair box and a glow controller exists. Control test: dying in the lair with no fight still respawns in Lumbridge. Observed in a debug run: a dead bot reappeared at (3067, 10254) with 99 hitpoints and kept all six test items.
5. **Repeat.** The bonus bosses are `king_dragon` too; the controller blocks a second round while it lives (3000 ticks). After it expires, the next KBD kill in the lair starts another round. No completion is recorded and nothing despawns early, as requested.

**Edits to upstream code (also in `docs/local-changes.md`):** Content `a0826d64d` (death.rs2 hook, pack ids for the new npcs, spotanims and varp). The `relic_on_kill` hook line is in `mods/`, not Content.

**Facts learned while building.** `p_finduid` fails (returns false) for a player who is not accessible, so a queue script that loops `huntnext` and then tries to restore itself with `p_finduid($self)` works for the first player and fails for the rest (seen: 3 of 4 players got no colour). The fix is to pick values in the timer script and pass them to the queue as its argument. Bosses killed unarmoured bots within about 8 to 15 ticks of appearing in the debug run.

**Not checked:** how the glow looks (colour distinctness, visibility on top of the player model, flicker every 2 ticks) and whether the recolour value `h*1024+966` gives the intended hues; a boss spawning on top of a player; balance; the real client; behaviour with more than 12 players.

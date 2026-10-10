# Relic mode M3: task engine and kill hook (observed)

**Question answered:** how do kill tasks fire from real deaths, and what do mod scripts need to know to write state from an NPC death?

**Based on:** Content `relic-mode` `e2ea89e31` (base `65b754f`), Engine-TS `relic-mode` `8c4fa9ca`. **Method:** read, then ran the server with a headless client; kills were triggered with `::~relic_kill <npc>` (spawns the npc, `npc_heropoints(10)`, `npc_queue(3,0,0)`, which runs the NPC's real `[ai_queue3,...]` script). Real melee kills were **not** done (clicking an NPC from the headless driver was unreliable).

## Findings
1. **Hook site.** First line of `[proc,npc_death]` (`Content/scripts/skill_combat/scripts/npc/npc_death.rs2:11`): `~relic_on_kill;`. It must come before the `if (finduid(%npc_aggressive_player) = true) {...}` block: placed after it, the compiler fails with `Attempt to access corrupted pointer [ 'p_active_player' ]` (that `if` leaves the player pointer conditional).
2. **Every death goes through `npc_death` except these `ai_queue3` scripts** (grep for files with `[ai_queue3` and neither `npc_death` nor `npc_default_death`): `areas/area_burthorpe/scripts/death_troll_thrower.rs2`, `areas/area_kalphite/scripts/kalphite_queen.rs2` (the first-form queen, it transforms; the `kalphite_flyingqueen` form calls `gosub(npc_death)` in `drop tables/scripts/kalphite_queen.rs2:2`), and quest scripts (`quest_viking`, `quest_druidspirit/ghast`, `quest_troll/troll_spectator`, `quest_legends` x3). The default `[ai_queue3,_]` calls `npc_default_death` which calls `npc_death` (`npc_combat.rs2:3,96-97`). Poison also uses `npc_queue(3,0,0)` (`npc_poison.rs2:13`). Answers the `npc_death` part of Q69 and Q73's Kalphite soldier name.
3. **Names:** goblin family `goblin`, `goblin_armed`, `goblin_helmet`, `goblin_greenarmour`, `goblin_redarmour`; Kalphite soldier is `kalphite_soldier` (`areas/area_kalphite/configs/kalphite.npc:61`).
4. **`npc_findhero` works at the start of `npc_death`** and sets the active player (kills of goblin, goblin_armed, lesser_demon, brownbear, giant all credited the player).
5. **Varps are protected.** Writing `%relic_tasks_done` from the NPC death script failed: `script error: pop_varp %relic_tasks_done requires protected access` (`Engine-TS/src/engine/script/handlers/CoreOps.ts:55-58`). Pattern used: the NPC-side proc only reads state and `queue(relic_task_done, 0, $task)`; the queue script has protected access and writes the bit, re-checking first.
6. **dbtable rule:** an INDEXED column must also be REQUIRED (`INDEXED columns must be marked REQUIRED as well`), so npc and obj tasks are two tables (`relic_task_npc`, `relic_task_obj`) in `mods/relics/configs/relic_tasks.dbtable`/`.dbrow`. `db_find(table:column, value)` then `db_findnext` in a `while` loop yields every row. `testbit` returns an int: compare with `^true`, not `true`.
7. **Observed task behaviour** (relog needed first, M1 finding 3): goblin kill -> task 1 once; a second goblin type does not repeat; lesser demon -> task 2; brownbear (task 15, tier 3) did nothing while tiers 1-2 were open; giant -> task 3. Tiers: lowest tier with an unfinished task is open (`relic_current_tier`).
8. **Debug:** `::~relic_task <n>` forces a task (tier check bypassed with tier 1), `::~relic_tasks_reset`, `::~relic_spawn <npc>`, `::~relic_kill <npc>`.

## Not checked
Dragon, hellhound, black demon, Kalphite and KBD kills (same code path, not run); real melee kills; persistence of `relic_tasks_done` across logout (same mechanism as M1's perm varps); object-task hooks (M7).


## Update: tier lock removed (Calum's request, 2026-10-10)

`relic_task_try` in `mods/relics/scripts/relic_tasks.rs2` no longer compares the task's tier with `relic_current_tier`, so tasks count in any order. The tier column and `relic_current_tier` remain in the data but are unused. Win check is unchanged (both final-boss bits). Checked: compiles; see the in-game check below if recorded.

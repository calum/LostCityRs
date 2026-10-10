# M7: medium relics and task hooks

**Question:** how are Midas Loop, Executioner, Eternal Vein, Evergreen, Double Yield, Quickstrike and Quest Pass implemented, and where are the remaining task-detection hooks?
**Based on:** Content `c8cff7b57` (branch `relic-mode`), Engine-TS `8c4fa9ca`. Method: written and **run in game** with the headless client (`scripts/headless-client.mjs`, account `relic3`). Hook rows: `docs/local-changes.md`.

## Gathering relics (10 Eternal Vein, 11 Evergreen, 12 Double Yield) and task products

- Mod code: `mods/relics/scripts/relic_gather.rs2`. `~relic_gathered($obj, $relic)` replaces `inv_add(inv, X, 1)`: it calls `~relic_task_obj`, doubles the count if Double Yield is owned and the destination has space for 2 (`inv_itemspace`; was the inventory only until the 2026-10-10 fix in `relics-e2e-tests.md`), and sends the product to the bank if the skill relic (10 mining, 11 woodcutting) is owned and the bank has space (falls back to the inventory; an `inv_add` that overflows drops the item on the floor, `Engine-TS/src/engine/script/handlers/InvOps.ts:74-81`).
- Hooks: mining (`inv_add` x2, `loc_change` x3 via `~relic_loc_change`, full-inventory check x2), woodcutting (`inv_add`, deplete check `random($deplete_chance) = 0 & ~relic_has(11) = 0`, full-inventory check x2), fishing (4 `inv_add`), cooking (the success `inv_add`). The full-inventory checks gain `& ~relic_has(n) = 0`.
- Task-only hooks (one added line): runecraft (`~relic_task_obj($rune)`), bows, smelting, herblore (`$mixture`), firemaking (`~relic_task_burn($log)`: task 7 is coded by hand because task 20 uses the same `yew_logs`; the table row for task 7 was removed), thieving (`~relic_task_pickpocket` after "You pick the ...", checks `npc_type = paladin`; answers the line part of Q73: `skill_thieving/scripts/thieving.rs2:25`).
- **Observed:** Double Yield gave 2 mithril ore per `~relic_gathered`; completing task 4 (mithril ore) raised the offer. With Evergreen the tree (a `tree` loc added by `::~relic_chop`) kept standing while the player kept chopping, and logs arrived in the bank (bank count 2 per catch with Double Yield, inventory unchanged). With Eternal Vein the mithril ore went to the bank (inventory 2, bank 2 after two calls).
- Mining with Eternal Vein stops after each ore (the label ends with `return`), so the player clicks the rock again; woodcutting continues (the normal loop). Answers Q76 for woodcutting: the full-inventory check is at `woodcut.rs2:41` and `:101`, and is bypassed with Evergreen; the bank-full case falls back to the inventory.

## Executioner (8)

`npc_default_damage` runs from the NPC queue with no active player, so the relic cannot be read there (compile error "'active_player' required", observed). The decision is made in the player's context instead: `~relic_dealt` (already hooked in `npc_max_dealt`) now first calls `~relic_execute`: if the npc's current hitpoints times 4 are below its base hitpoints, it credits hero points and combat XP for the remaining hitpoints and queues them as damage (`npc_queue(2, $hp, 0)`).
**Observed:** a giant left with 2 hitpoints died to the player's attack with bones dropped and task 3 completed. Not isolated from a plain hit with fists (inference that it was the relic). A missed roll does not trigger it, because `npc_max_dealt` is only called after a successful hit roll (`player_melee.rs2:21-28`).

## Quickstrike (4)

`~relic_delay($ticks)` halves the delay (minimum 1, rounded up). Hooked at `player_melee.rs2` (2), `player_ranged.rs2` (2), `player_special_attack.rs2` (1), `player_magic.rs2` (1). Not hooked: PvP files, chompy bird, `auto_retaliate.rs2` (its `$delay` is the retaliation flinch, not an attack rate), the crossbow/other specs that set their own delay. **Observed:** `::~relic_delay_test` printed 1/4/5 without the relic and 1/2/3 with it, and a melee attack ran with the relic without errors. Not verified: that the client shows the faster swing, and the real attack rate in game.

## Midas Loop (13)

First attempt (tail call after `p_delay(3)`) worked but could not be stopped: 12 daggers were alched in sequence while walking clicks and `::` commands were ignored (observed). That answers **Q71: a `p_delay` loop is not interrupted by walking**. Final design: before the `p_delay(3)` the hook queues `weakqueue*(relic_midas, 3)($item)` and returns; `[queue,relic_midas]` jumps back into `@magic_spell_high_alch`. Weak queues are cleared by `closeModal`, which `clearPendingAction` calls (`Engine-TS/src/engine/entity/Player.ts:761-763,973-975`). **Observed:** 12 daggers started, a walking click after about 9 s stopped the loop at 7 daggers and the character walked.

## Quest Pass (2)

Instead of a generated table, `[queue,relic_quest_pass]` runs upstream's own `@complete_all_quests` (`Content/scripts/_test/scripts/cheats/cheat_quest.rs2:332`), which asks for the Shield of Arrav gang and Temple of Ikov side and queues every quest's completion. **Observed:** after the grant the inventory filled with quest reward items and coins, `%qp` was 135, and the last "Quest complete" scroll opened. The headless client could not close that scroll (clicks and Escape did nothing), so it blocked later commands until a relog; not checked whether a real client can close it.
Balance warning (inference from `cheat_quest.rs2:379-393` and others): the script also grants quest XP rewards (for example `stat_advance(magic, 153000)`), so Quest Pass is also a large skill boost. It depends on the `_test` scripts being packed (they are in this setup).

## Not checked
Mining a real rock with Eternal Vein (loc stays) and the full-inventory bypass; woodcutting/fishing/cooking task completion by real play (only `~relic_gathered` called by debug procs); the other task hooks (runecraft, bows, smelting, herblore, burn yew, pickpocket paladin) were compiled but not triggered; Executioner on a miss; Quickstrike client animation; Q74 (combat spells).

New debug procs: `relic_give`, `relic_gather`, `relic_chop`, `relic_count`, `relic_wound`, `relic_alch`, `relic_swing`, `relic_delay_test`, `relic_qp`.

**Update (2026-10-10):** now covered by automated end-to-end tests; see [relics-e2e-tests.md](relics-e2e-tests.md) for what is verified, the bugs fixed and what is still untested.

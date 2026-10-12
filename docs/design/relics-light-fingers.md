# Relic 30 Light Fingers and tasks 41, 42

**Question this answers:** how does the thieving relic work, where are its hooks, and what are the two new thieving tasks?

**Based on:** root `e92c160` plus this change; Content `main` at `9a5b2466a` (hook `8308a8b14`). Method: code read, then **run** headless on Node 24.11.1: `tests/relic-thieving.test.ts` (14 tests) and the whole suite (337 before merging the offer-odds change). Not tried in a real client.

## What it does

- **Never fails a pickpocket.** `check_if_success_pick_pocket` (`Content/scripts/skill_thieving/scripts/thieving.rs2`) returns true first when `~relic_pickpocket_sure` (`mods/relics/scripts/relic_thieving.rs2`) says the player owns bit 30. No stun, no damage.
- **Repeats pickpockets.** After a successful pick `~relic_pickpocket_again` calls `p_opnpc(3)`, which runs `attempt_pick_pocket` again with all its normal checks (level, combat, backpack). A step, another click or a full backpack ends it (test: 27 bones in the pack, no loop).
- **Cancelling (bug fixed 2026-10-11):** the first version repeated at once, so the player was delayed (`p_delay(0)` in `pick_pocket` and `steal_from_stall`) on almost every tick, and `MoveClickHandler` drops a walk click while `player.delayed` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12`), so the loop could not be stopped (reproduced in tests: a click 1 to 3 ticks into the loop did nothing; 4 clicks in a row did not move the player at a stall). Now each repeat sets `%action_delay = map_clock + 2` and `p_opnpc(3)` / `p_oploc(2)`, so the next two ticks only wait (`attempt_pick_pocket` already had that wait; `~relic_stall_wait` does it for stalls) with the player not delayed, and a walk click clears the interaction. A click that lands on a delayed tick is still dropped, as in the base game: click again. Cadence is now about one pick or theft every 3 ticks.
- **Stalls never empty and repeat.** In `steal_from_stall`, after the delay, `~relic_stall_keeps` makes the script pay the reward and XP, run the task hook and call `p_oploc(2)`, then return: the stall is never swapped for the empty market table and the respawn queues are skipped. The guard and owner checks at the top of `steal_from_stall` are skipped for a Light Fingers owner (`if (~relic_stall_keeps = false)` around them), so guards and stall owners never notice the theft and nobody retaliates; the owner-alert path (`stolen_from_stall_*` queues) is never armed either. Test: a baker's stall with a guard, a knight and the owner standing next to the player (control without the relic: the theft is stopped).

## Tasks (numbers 41 and 42, stored in `%relic_tasks_done2` bits 9 and 10)

- **41 Steal from a gem stall** (Thieving 75, members): `~relic_task_steal` after a theft checks `loc_type = gem_stall_stealing`. The only gem stall in the loaded map near Ardougne is at (2667, 3303) (found in the harness with `locNear`).
- **42 Pickpocket a guard** (Thieving 40): `~relic_task_pickpocket` now also matches `guard1`, `guard2` and `ardougne_guard`, the three NPCs of `[pickpocket_guard]` in `pickpocket.dbrow`.
- Menu order: 42 after the lobster (level 40), 41 after the magic shortbow (level 75). `^relic_task_count` 42, `^relic_task_listed` 41, task menu rows 41 and 42 added (list scroll 586).

## Tests (`tests/relic-thieving.test.ts`)

One click on a level-1 thief: no failures and 15+ picks in 80 ticks (control without relic: exactly one attempt); full backpack stops it; tea stall: 10+ thefts from one click and it still stands (control: one theft, stall swapped); gem stall completes task 41 (a tea stall does not); a man does not complete task 42, all three guard types do. Stall tests remove every spawned NPC within 10 tiles so owners and guards do not interrupt.

## Not checked

A real client; fast repeat speed feel (about one pick every 2 ticks, one steal every few ticks, not measured exactly); Viking stalls and chests/doors (not hooked); other relics' interaction with stalls.

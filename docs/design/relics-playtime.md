# Relic mode play time and finish time

**Question this answers:** how does the server track how long a character has played, and how is the time of the final challenge recorded and shown?

**Based on:** root `e76e999`, Content `e393882d0` (plus the pack ids committed with this change), Engine-TS `e45392c4` (not modified). **Method:** built test-first in `tests/relic-playtime.test.ts` (6 tests); full suite 329 pass on Node 24.11.1. Not seen in a real client.

## What it does

- Every character counts the game ticks (0.6 s) it is logged in, in the perm varp `%relic_playticks` (`mods/relics/configs/relic.varp`). Existing characters start from 0 on the day this goes live; the count includes Tutorial Island.
- When the second final boss falls (tasks 24 and 25, the existing win in `relic_task_done`, `relic_offer.rs2`), `[proc,relic_playtime_finish]` copies the count to `%relic_finish_ticks` once and prints "Your final challenge time: 2h 05m 30s." in the chat. The finish time never changes after that. Time played keeps counting.
- The Relics menu shows "Time played: ..." at the top right, and once finished a green "Final challenge done in ..." line under the XP rate. The menu is refreshed when opened, not live.

## How (all in `mods/relics/scripts/relic_playtime.rs2`)

1. `[softtimer,relic_playtime_timer]` adds 1 to `%relic_playticks` every tick. A soft timer is used because it also runs while the player is busy (`Engine-TS/src/engine/entity/Player.ts` `processTimers`: "soft timers can execute while busy") and does not need protected access, so both varps are `protect=no`.
2. Timers are not saved (`Player.ts` clears them on logout), so `~relic_playtime_start` (first line of `[proc,relic_on_login]`, before the tutorial check) starts the timer at every login.
3. The engine already keeps its own `player.playtime` (`World.ts` `processClientsIn`) but no script command reads it, so no engine hook was needed. Using it would also have counted time from before this feature.
4. Time text: seconds = ticks * 6 / 10, shown as `Hh MMm SSs`.

## Menu layout change

`relic_relicmenu.if` gained the components `time` and `finish`; the XP line is narrower (text now "tier N of 3" instead of "XP Multiplier tier N of 3") and the rows below moved down by up to 2 px. Pack ids 11185 and 11186 were added by hand to `Content/pack/interface.pack` and `interface.order` (sync-mods cannot add components to an existing interface, see [relics-menus.md](relics-menus.md)).

## Not checked

- The layout in the real client (text overlap of the XP line and the time line is judged by character count only).
- Time lost: a timer tick missed during a crash or a save taken between ticks is not counted; nothing was measured.
- Very large counts: the varps are 32-bit, which is about 6.8 years of play.

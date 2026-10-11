# Non-blocking level-ups

**Question:** how do level-ups stop interrupting play (relic mode's 10x+ XP, and Eternal Vein autosmelting giving smithing level-ups mid-mining), while keeping a notice?

Based on: Content `975ff13d5` (fork `main`), Engine-TS `f8bd5427`. Method: read the script, ran the headless suite (192 tests pass, Node 24.11.1). Not checked in a real client.

## Cause (read)
`[label,levelup]` in `Content/scripts/levelup/scripts/levelup.rs2` set the dialog text, then `if_openchat(...)` and `p_pausebutton`. Opening a chat modal while the player was mining stopped the swing loop (the autosmelt test hit this: the player was idle after the level-up). The unlock boxes (`levelup_unlocks_*.rs2`, `~objbox`) are further modal dialogs after it.

## Choice
No non-modal level-up interface exists in this content, so the dialog is skipped entirely for everyone (not only relic mode):
- `mes("Congratulations, you just advanced a X level.")` as before, plus a new line `mes("Your X level is now N.")` (from the existing `level_prefix` db field).
- Fireworks (`spotanim_pl`), jingle (`~music_jingle`) and the relic `XP rate: Nx` line are kept.
- The unlock boxes ("You can now mine Iron" etc.) are skipped too, since they are the same kind of modal. Gap: that unlock info is no longer shown anywhere.
- Switch: `^levelup_dialogs` in `Content/scripts/levelup/configs/levelup.constant`; `1` restores the original dialog and unlock boxes. (Assigned to a `def_int` first: `if (^levelup_dialogs = 0)` fails to compile with "Unable to infer type".)

## Tests
`tests/levelup-nonblocking.test.ts` (2): failed first (no "Your fletching level is now 9." line; chat modal `levelup_fletching` open), pass now. `tests/relic-autosmelt.test.ts` real-copper-rock test changed: it used `waitUntilIdle`, which only held because the level-up dialog stopped mining; it now waits for the bank bar and scales the XP assertion by bars. Suite 192/192.

## Follow-up: mining still "stopped" (Calum, 2026-10-11)
A level-up does not stop a running action: with the dialog gone, an Evergreen chop loop ran straight through a woodcutting level-up (test 3). The engine's `ENGINE` queue script (`Player.ts:886`, `processEngineQueue` `Player.ts:661`) runs `closeModal(false)` afterwards, which leaves the interaction and weak queue alone (`Player.ts:759-762`; read).
What actually stopped mining: `[label,mining_continue]`'s success branches (`get_ore_normal`, `get_ore_fast`, `Content/scripts/skill_mining/scripts/mining.rs2`) end with `return` after every ore, because a normal rock depletes and ends the action. With Eternal Vein the rock stays but the loop still ended, one ore per click (a test showed one ore in 60 ticks, no level-up involved); the autosmelt smithing level-up just landed at the same moment. Fix: hook `~relic_mine_again` (`mods/relics/scripts/relic_gather.rs2`) before that `return`; with relic 10 it calls `p_oploc(3)` so the swing loop continues, like Evergreen. A walk click still stops it. Tests: `tests/levelup-nonblocking.test.ts` (4 now; the Evergreen and Eternal Vein ones run through a level-up); `mineOnce` in `tests/relic-skilling.test.ts` now stops the interaction itself. Suite 194/194. Not seen in a real client.

## Open
Real-client look at the chat line and that mining keeps going; whether to show unlock hints as chat lines.

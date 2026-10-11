# Skilling relics 25-29 (work package A of the skilling brief)

**Question this answers:** how do Prospector's Pick (25), Forge Echo (26), Endless Shoal (27), Fletcher's Echo (28) and Hunter's Haul (29) work, where are their hooks, and what did the tests show?

**Based on:** root `fe995ff` plus this change; Engine-TS `e45392c4` (no engine change was needed); Content branch `skilling-relics-a` at `c5d274233` (five hook commits on top of `dd72ac774`; the same five commits also sit on Content `main` as `a15fcce66`, rebased on `a6ed450c7`, see "Branches"). Method: code read, then **run** headless on Node 24.11.1: `tests/relic-skilling-routes.test.ts` (24 tests) and the whole suite 285/285, `test:types` clean. Brief: [skilling-relics-brief.md](skilling-relics-brief.md).

Ids: the brief said 16-20 but 16-19 were taken (`relic_offer.rs2` `relic_name`), so these use 25-29. Relic bits are in the 32-bit varp `relic_owned` (`testbit/setbit`), ids up to 30 fit.

## 25 Prospector's Pick

Mining, woodcutting and fishing all gate a roll on `%action_delay = map_clock + n` and roll when the clock equals it; the loop then re-arms the delay. Measured (tests): the interval between rolls is **n + 1** ticks (bronze pickaxe `mining_rate` 7 gave about 6 ore in 60 ticks, a delay of 1 gave 18 or more). `[proc,relic_gather_delay]` (`mods/relics/scripts/relic_skilling.rs2`) returns 1 with the relic, so rolls come every 2 ticks.

Hooks: `mining.rs2` (`$mining_rate` in `mining_firstswing` and `mining_continue`), `woodcut.rs2` (both `map_clock + 3`), `fishing_spots/*.rs2` (only the **continuing** labels, the ones that read `else if (%action_delay = map_clock)`).

Fishing limit: the first cast (`attempt_fish_*` labels) keeps its normal 4 or 5 ticks. Those labels only continue on the `map_clock + 3` branch (they `p_opnpc` there) and end otherwise, so a shorter delay there stopped fishing after one catch (observed: 1 fish in 50 ticks against 8). After the first cast every roll is 2 ticks apart.

## 26 Forge Echo / 28 Fletcher's Echo

`[proc,relic_forge_echo](product, count, xp)` and `[proc,relic_fletch_echo]` roll `random(2)`; on a hit they add one more batch (`count`) to the bank (`relic_bank_extra`: bank, else backpack, else lost) and `stat_advance` the same XP. Called after the product is added in: `smelting.rs2` (`smelting_ore`, 1 bar), `smithing.rs2` (`smithing_anvil`, `product_amount` items), `arrows.rs2` (2 sites), `bolts.rs2` (2), `bows.rs2`, `cut_logs.rs2` (`fletch_logs`), `darts.rs2`. Eternal Vein auto-smelting rolls once per bar inside `relic_gathered`. Not hooked: ogre arrows (`ogre_arrows.rs2`), cannonballs, glass, gold/silver crafting menus, Crafting.

## 27 Endless Shoal

`relic_fished` now passes relic id 27 to `relic_gathered`, which banks the product when the player owns it (the same path as Eternal Vein, with Double Yield cooking first). Every "inventory full" check in `fishing_spots/*.rs2` gained `& ~relic_has(27) = 0`. Spots: `[label,move_fishing_spot]` (`fishing_movement.rs2`) returns early, re-arming its timer, when `[proc,relic_spot_held]` finds a player with relic 27 within 3 tiles (`huntall` + `.huntnext`, `.%relic_owned`). `npc_settimer` only sets the interval and does not reset the clock (`Engine-TS/src/engine/entity/Npc.ts` `setTimer`), so a catch-time timer reset could not be used. A spot is therefore held by presence, not by "fishing at it".

## 29 Hunter's Haul

`[proc,relic_drop_hide]` replaces the `obj_add(npc_coord, <hide>, 1, ...)` line in `cow.rs2` and the four `*_dragon.rs2` drop tables. With the relic it queues player queues (`relic_haul_hide`: 3 leather, `relic_haul_gem`: one gem) because a death queue has no protected access to the killer's bank (observed error `inv_add $inv requires protected access: bank`). Leather: `leather`, `dragon_leather`, `dragon_leather_blue`, `_red`, `_black`. Gem: 50%, then sapphire/emerald/ruby/diamond with equal chance (not the mining gem table). Only the top damager gets it (`npc_findhero`), like Bounty.

## Branches

Content `main` moved while this was built (another thread removed task row 32's interface id) ahead of the root mods, so root `main` at the time did not build against Content `main`. This change pins Content to branch `skilling-relics-a` (based on `dd72ac774`, the commit the root recorded). The identical commits are on Content `main` too; whoever next merges should move the root pointer to `main` once the root mods match it.

## Tests (what they prove)

`tests/relic-skilling-routes.test.ts`: delay proc; mining 60 ticks (about 6 against 18+ bars), woodcutting 60 ticks (15 against more than 24 logs) and net fishing 50 ticks with and without the relic; bank vs backpack, full backpack, Double Yield cooked fish and spot hold with a control that does move; echo rates (60-140 of 200), XP exact, batch size, full bank/backpack; a real furnace smelt, an anvil smith (`[label,attempt_smithing]`) and a real bow stringing each echo within 40 tries; cow and green dragon real kills and the 3/50% numbers. Other suites changed because the offer pool grew from 19 to 24 relics: `relic-offers`, `relic-menus`, `relics`, `relic-teleport-network`, `relic-all-relics` (Forge Echo makes task 11 give 2-4 bars).

## Not checked

Fletching echo in `arrows.rs2`, `bolts.rs2`, `darts.rs2`, `cut_logs.rs2` (compiled and covered by the proc test, not run through the real flow). Waterfall, lava eel, Barbarian and Piscatorius spots (the same edit, not run). Hunter's Haul with the other dragons' real kills. Everything in a real client. Fishing spot hold when two players with and without the relic share a spot.

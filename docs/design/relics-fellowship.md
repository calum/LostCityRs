# Relic 31 Fellowship (co-op relic)

**Question this answers:** what does Fellowship do, where are its hooks, and what is tested?
**Based on:** root `e29261e` plus this change; Engine-TS `a5d259ac`; Content `d1d052a46`. **Method:** code written and read, then **run** headless on Node 24.11.1: `tests/relic-fellowship.test.ts` (9 tests) failed first (6 red: no relic 31, no sharing), then passed; whole suite 397/397, `tsc -p harness/tsconfig.json` clean. Not tried in a real client with several people.

## What it does (id 31, bit 31 of `%relic_owned`, the last free id)
Requested by Calum for playing with two friends. The effects belong to the **owner**; they reach every **other** player within **5 tiles** (Chebyshev, same level, `CoordGrid.distanceToSW`), whether or not that player has the relic. Owners stack.
1. **XP share, 50%.** Engine `Player.relicFellowship` (`Engine-TS/src/engine/entity/Player.ts`, called from `addXp`) takes the XP the owner just gained (tenths, after the XP rate and the XP Multiplier), floors 50% of it and calls `other.addXp(stat, share, false, true)` for each nearby player: **same skill**, normal level-ups. The last argument (`shared`) skips both the Fellowship hook and Green Thumb, so shared XP is never shared again (two adjacent owners settle at 1.5x each, tested) and Green Thumb does not read shared XP as raw XP. Rune Wellspring still counts shared XP (it counts all XP gained).
2. **Shared healing, 50%.** Hook line `~relic_fellowship_heal($hitpoints); // relic hook` after the stat-heal loop in `[proc,consume_effect_apply]` (`Content/scripts/player/scripts/consumption/effects/scripts/consume_effects.rs2`), so it covers everything eaten or drunk that raises hitpoints. `[proc,relic_fellowship_heal]` (`mods/relics/scripts/relic_fellowship.rs2`) measures hitpoints gained since the start of the consume and queues `[queue,relic_fellowship_heal_q]` on the eater. The queue `huntall`s players within 5 tiles and `stat_heal`s each other one by floor(50% of the heal), capped at their base level. The share runs in a queue because `huntnext` switches the active player and the consume script still needs the eater.
3. **Constants.** Radius and percentages: `^relic_fellowship_*` in `mods/relics/configs/relic.constant` (heal) and `RELIC_FELLOWSHIP_RADIUS` / `RELIC_FELLOWSHIP_XP_PERCENT` in `Player.ts` (XP). Keep the two radii equal.
4. **Menus/offers.** Name and one-line description in `relic_offer.rs2` (`case 31`), loops raised to 31, relic menu row 30 added to both lists (`relic_relicmenu.if`, scroll 364, `relic_menus.enum`, pack ids 11192 and 11193 in `Content/pack/interface.pack` and `interface.order`). Odds table regenerated (`docs/reference/relic-offer-odds.md`, 30 relics). **Relic 31 was the last free bit**: a further relic needs a second owned-varp.

## Behaviour to know
- Only the owner's gains and meals share. Receiving does not need the relic; owners also receive from other owners.
- Solo, the relic does nothing. It is in the normal pool anyway (it is not hidden when you are alone; Calum asked earlier whether co-op relics should only roll with others online: not built, `relic_eligible` could check for another online player).
- Shared XP skips the Green Thumb herb counter but not Wellspring; shared XP can trigger a friend's level-up message.
- Healing by prayer/restores that do not change hitpoints shares nothing. A heal of 1 shares 0 (floor).

## Not checked
Real client with 2+ people; other consume paths that bypass `consume_effect_apply`; performance with many players in range (one zone scan per XP gain by an owner); whether 50%/50% feels balanced (tuning constants above).

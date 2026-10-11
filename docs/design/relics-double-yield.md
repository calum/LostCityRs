# Relic 12 Double Yield: double XP and fishing

**Question it answers:** what does Double Yield do for XP and for fishing, and what defaults were chosen?
**Commits:** root `6a0d090` + this change; Content `d2cd75318` + this change. **Method:** code read and headless tests run (Node 24.11.1), `tests/relic-doubleyield-xp.test.ts` (7 tests).

## Behaviour (player view)
- Mining: two ore also gives two ores of mining XP. With Eternal Vein the second ore is also smelted, so smithing XP is for two bars (this already held, `relic-autosmelt.test.ts`).
- Fishing: one catch gives two fish and two catches of fishing XP.
- With Double Yield the fish arrive **cooked** (never burnt) and the player gets the fish's normal cooking XP, once per fish.

## Mechanism
- `[proc,relic_gathered]` (`mods/relics/scripts/relic_gather.rs2`) now **returns the count produced** (1, or 2 when Double Yield applies and the destination has room for 2). A full backpack gives 1 and 1x XP, because XP follows the count actually granted.
- Mining sites (`Content/scripts/skill_mining/scripts/mining.rs2`, both `get_ore` labels) call `stat_advance(mining, multiply(rock_exp, $relic_n))`.
- Fishing sites (`Content/scripts/skill_fishing/scripts/fishing.rs2`, four) call new `[proc,relic_fished]`, which with Double Yield looks the fish up in `cooking_generic:uncooked`, counts the **raw** fish for tasks, gathers the cooked fish and grants `cooking_generic:experience * n`. Fishing XP is `productexp * n`.
- Cooking sites already doubled the cooked item via `relic_gathered`, but cooking XP is still granted once per cook (unchanged, see open questions).

## Defaults chosen (Calum can change these)
- Cooked fish and cooking XP belong to Double Yield, not a separate relic.
- No cooking level is needed and burning never happens.
- Fish with no cooking row, and the karambwan (two cooking rows), stay raw.
- Tasks: the raw fish is still credited, so "catch a raw swordfish" (task 9) stays completable; the cooked fish is credited too ("shark", task 10).
- Fishing has no banking relic: cooked fish go to the backpack.

## Not checked
Every fish type (only a Draynor shrimp net spot is exercised in play; swordfish/shark go through `::~relic_fish`), the client display, other fishing spots' special cases (whirlpools, tutorial, Fishing Trawler).

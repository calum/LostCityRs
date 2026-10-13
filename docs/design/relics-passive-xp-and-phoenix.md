# Relics: passive XP Multiplier, monkey task retired, Phoenix effects (2026-10-13)

Question answered: what changed after Calum's request of 2026-10-13, and how it behaves. Based on root `e06d935` (before this work), Content `d61de358c`, Engine-TS `8f0539df`. Method: read the code, ran the headless suite (see "Tests"). No engine or Content hook changed: everything is in `mods/relics/`.

## 1. Monkey task (16) retired

- Removed the `relic_task16_monkey` row (`mods/relics/configs/relic_tasks.dbrow`), the `relic_task_order` entry (`relic_menus.enum`), and the `case 16` name in `relic_task_name` (`relic_menus.rs2`). `^relic_task_listed` is 43 (`relic.constant`), `^relic_task_count` stays 45 so bit positions of saved tasks keep their meaning (same approach as task 37).
- **Existing saves that finished the monkey task:** the bit stays set, but `[proc,relic_tasks_done_count]` skips task 16 (`relic_offer.rs2`), so it does not count towards the 5/10/15 unlocks or the 10th-task Quest Pass. Reason (inference, my choice): a task that can no longer be done should not count either, matching how the menu now reads "x of 43".
- Killing a monkey no longer calls `relic_task_try` (no row). `::~relic_task 16` still marks it (debug only).

## 2. XP Multiplier is passive

- Relic id 1 is never offered: `[proc,relic_eligible]` returns 0 for it (`relic_offer.rs2`). The forced-offer machinery (`relic_xp_due`, the `$force` parameter of `relic_offer_run`) is deleted.
- `[proc,relic_xp_passive]` sets `%relic_xp_tier = min(3, tasks done / 5)` when that is higher than the current tier, recomputes `%relic_xp_factor` and prints "XP Multiplier unlocked: tier N of 3. Your XP rate is now Nx." It runs in `[queue,relic_task_done]` right after the task is marked (before the special offers) and from `relic_on_login`.
- So: 5th finished task = tier 1 (30x) plus the normal 3-relic offer; 10th = tier 2 (90x) plus the Quest Pass; 15th = tier 3 (270x) plus a normal 3-relic offer. Final bosses owe no offer but still count.
- **Existing saves:** a tier already held is never lowered (older saves took tiers at the 4th/9th/12th task, so some hold a higher tier than tasks/5). Saves whose count is already above a threshold but who never took the multiplier get the tier at their next login. A stale "declined" bit 1 is harmless: the pool test rejects id 1.
- Relic menu: the XP Multiplier stays in the unlocked list once tier 1 is reached and in the "not yet unlocked" list until tier 3, showing "next Nx at M tasks" (`relic_menu_line`, `relic_relicmenu_refresh`).
- `docs/tools/relic_offer_odds.py` and `docs/reference/relic-offer-odds.md` were updated and regenerated (28 offerable picks; XP row 0 in the offered tables).

## 3. Phoenix

In `[proc,relic_damage_taken]` (`relic_effects.rs2`), when the save triggers: the existing `anim(human_death, 0)`, then `say("I rise from the ashes!")` (the SAY mask, `Player.say` sets `sayMessage` and `PlayerInfoProt.SAY`, `Engine-TS/src/engine/entity/Player.ts:2068`; it is overhead text, so every nearby player sees it) and `spotanim_pl(fireblast_impact, 92, 47)`.

- Fire graphic: `fireblast_impact`, already used by Content (`Content/scripts/areas/area_wilderness/scripts/king_black_dragon.rs2:154`, `quests/quest_dragon/scripts/elvarg.rs2:94`), so it exists in rev 274. Height 92 is the same as Elvarg's use.
- Delay 47: read from the cache in the harness, `human_death` frame delays are `[8,4,4,4,14,4,3,3,3,20000]`, so the fall lasts 47 client ticks before the endless hold on the last frame. The fire starts as the fall ends.
- **Not verified:** in a real client, whether the character visibly stands back up after the hold (the final frame has delay 20000) and how the fire looks against it. Recorded in `docs/open-questions.md` #137.

## Tests

`tests/relic-special-offers.test.ts` (rewritten), `relic-offers.test.ts`, `relic-menus.test.ts`, `relic-all-relics.test.ts`, `relic-tasks.test.ts`, `relic-combat.test.ts` (new Phoenix test). Red run first: 25 failures for the expected reasons (multiplier still in offers, monkey still listed, no Phoenix text). Final run in the commit message.

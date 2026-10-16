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

- **Full HP (Calum, 2026-10-13, same day):** the save no longer leaves 1 HP (that only meant dying on the next hitsplat). The lethal hit is negated (`$amount = 0`) and `stat_heal(hitpoints, 0, 100)` restores 100% of the base level (`relic_effects.rs2`). The 500-tick recharge is unchanged.

- **Stale cooldown after a restart (Calum, 2026-10-14):** `relic_phoenix_until` is a perm varp (`mods/relics/configs/relic.varp`), but `map_clock` is `World.currentTick` (`Engine-TS/src/engine/script/handlers/ServerOps.ts:16-17`), which starts at 0 on boot (`Engine-TS/src/engine/World.ts:165`, only ever incremented at `World.ts:504`). A cooldown saved by an earlier run can therefore be far ahead of the new clock and block every save until the clock catches up. Found by reading the code; reproduced in the harness with a seeded value (red: HP 0 after a lethal hit). Fix: `[proc,relic_phoenix_ready]` in `relic_effects.rs2` treats any value more than 500 ticks ahead as stale (a real cooldown is never that far ahead). Not checked: a real server reboot (open question 142).

- **Stand back up (Calum, 2026-10-14, after a live report):** the save played `human_death` once and nothing ever cleared it, so the player stayed in the death pose. Server side: `playAnimation` sends the ANIM mask only when called (`Engine-TS/src/engine/entity/Player.ts:2008-2017`), and `animId` is reset every tick (`PathingEntity.ts:614-616`), so the one-off call is the only ANIM the client gets. Client side (read, not run): an ANIM value replaces `primaryAnim` (`Client-TS/src/client/Client.ts:7973`); `human_death` has `postanim_move` = 0 = `DELAYMOVE` (`Client-TS/src/config/SeqType.ts:12-13`, cache value read in the harness), and while that is the primary anim the client holds route movement (`Client.ts:3639-3652`). Fix: `[queue,relic_phoenix_stand]` calls `anim(null, 0)` 3 ticks after the save (`relic_effects.rs2`), the same delay and clear as normal death (`Content/scripts/player/scripts/death.rs2:6-8,43`). Red first: the stand-up test timed out waiting for the clear. Not covered by the harness: whether the client actually stops holding movement (the rendering and movement side).

## Tests

`tests/relic-special-offers.test.ts` (rewritten), `relic-offers.test.ts`, `relic-menus.test.ts`, `relic-all-relics.test.ts`, `relic-tasks.test.ts`, `relic-combat.test.ts` (new Phoenix test; a stale-cooldown test added 2026-10-14, red first with HP 0 against the old check, green after the fix). Red run first: 25 failures for the expected reasons (multiplier still in offers, monkey still listed, no Phoenix text). Final run in the commit message.

### Phoenix cooldown reset and reminders (Calum, 2026-10-16)

Asked: "when I die with phoenix relic, it should reset the cooldown timer and it should also print to the messages every minute with an update on how long I have left." Engine-TS cd2f9e8c, root 5e8e973 before this change; method: read and ran the harness (red first: both new tests failed, `1438 !== 0` and a 110-tick timeout; then 24/24 in `tests/relic-combat.test.ts`).

- **Reset on death (interpretation, Calum can correct):** "die" is read as a real death while the cooldown runs. `[proc,relic_phoenix_death_reset]` (`relic_effects.rs2`) sets `%relic_phoenix_until = 0` and is called first in `[proc,relic_stash_items]` (`relic_death.rs2`), which `death.rs2:62` (`~relic_stash_items`) calls from `player_death_lose_items`. That proc returns early for staff above level 1 on a live world (`death.rs2:55`), so such deaths do not reset it.
- **Reminders:** `[softtimer,relic_phoenix_cd]` (`relic_effects.rs2`) runs every 100 ticks (one minute), printing `Phoenix cooldown: Xm YYs left.` until the cooldown is over, then once `Your Phoenix relic is ready...` and clears itself. The save starts it (`~relic_phoenix_timer_start`); `relic_on_login` (`relic_offer.rs2`) restarts it because softtimers are not saved. A death clears it. Same softtimer pattern as `relic_playtime_timer`.
- **Not tested:** the login restart (code path only), the staff-live case, and how it reads in a real client chat box.
- **Test-order note:** the two new tests tick about 600 world ticks and are placed at the end of `relic-combat.test.ts`. Run earlier in the file they shifted the phase of the 100-tick `[timer,stat_regen]` and "Vampire in real melee" saw prayer +1 (11 !== 9). That test is phase-sensitive on its own (it lowers prayer to 10 and relies on no regen tick).

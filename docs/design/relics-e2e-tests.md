# Relic mode: end-to-end tests (what is now verified)

**Question answered:** which relic-mode behaviours are proven by automated tests, what the tests found wrong, and what is still untested?

**Based on:** root `4be14d8` plus this change, Engine-TS `8c4fa9ca`, Content `c8cff7b57` (then `0bd36bfa3` for the glory fix), `mods/relics/` as changed here. **Method:** headless harness (`../setup/headless-test-harness.md`), run on Linux with Node 24.11.1. The full suite (`node harness/run.mjs`, the same as `mise run test`) ran twice with the same result: **106 tests, 105 pass, 0 fail, 1 todo** at first; after Calum's Executioner decision (below) **106 pass**. `mise run test:types` is clean.

## Test files

| File | Tests | Covers |
|---|---|---|
| `tests/relic-offers.test.ts` | 19 | offer engine: first offer, seed determinism (a local copy of the `relic_draw` formula predicts every offer), closed and pending offers, pool shrinking to 2, 1 ("No thanks") and 0, 1 XP Multiplier (tiers 1-3, factor, stops at 3, real bone burying at 4x), 19 Hoarder, 2 Quest Pass, `::~relic_reset` |
| `tests/relic-combat.test.ts` | 14 | 3 Stoneskin, 4 Quickstrike, 5 Glass Cannon (taken and dealt), 6 Phoenix, 7 Vampire, 8 Executioner, 9 Bounty |
| `tests/relic-skilling.test.ts` | 14 | 10 Eternal Vein, 11 Evergreen, 12 Double Yield, 13 Midas Loop, 14 Philosopher's Coin |
| `tests/relic-utility.test.ts` | 18 | 15 Infinite Runes, 16 Everlasting Jewellery, 17 Last Recall, 18 Banker's Call |
| `tests/relic-infinite-runes.test.ts` | 43 | 15 Infinite Runes on every spell: 30 combat spells (incl. god spells with their staff), 7 teleports, bones to bananas, low alchemy, enchant, superheat, a staff worn, a relog. Each spell has a control without the relic |
| `tests/relic-tasks.test.ts` | 13 | every `relic_task_npc` and `relic_task_obj` row, real kills and real skill actions for tasks 1, 4, 5, 6, 7, 10, 11, 12, 13, 20, no re-firing, any order |
| `tests/relic-death-win.test.ts` | 11 | death stash (inv and worn, bank full), Relic Keeper (one only, re-issue rules), win on both final bosses in either order |

Each relic test has a control: the same scenario without the relic. Actions are real client input where the harness allows it (OPLOC on real rocks and trees, OPHELD, IF_BUTTON on `magic:varrock_teleport`, melee and ranged attacks, rubbing jewellery and picking the destination). Alchemy (OPHELDT) and Wind Strike (OPNPCT) are sent from small helpers in the test files, through the engine's own handlers. Quest Pass, kills of the bosses and every dbrow row use debugprocs (`relic_grant`, `relic_kill`, `relic_gather`).

## Bugs the tests found, and the fixes (in `mods/relics/` unless noted)

1. **An offer earned by a real kill was closed straight away.** `~relic_on_kill` runs at the start of `npc_death` while the NPC is still swinging. A melee NPC's swing at 0 HP runs `if_close` (`Content/scripts/skill_combat/scripts/npc/npc_combat_melee.rs2:36`), which calls `Player.closeModal` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:246-247`) and drops the paused offer script. The offer stayed owed until the next login. **Fix:** `[queue,relic_task_done]` now queues `relic_offer_q` 3 ticks later instead of showing the offer inline (`mods/relics/scripts/relic_offer.rs2`). Test: "kill task: the offer from a real kill stays open after the goblin dies".
2. **Task 12 could not be completed.** The row named `4dose2attack`, but brewing makes `3dose2attack` (`Content/scripts/skill_herblore/configs/brewing/brew_potion.struct:91-97`). **Fix:** the row's `obj` is now `3dose2attack` (`mods/relics/configs/relic_tasks.dbrow`; the row's debugname still says `4dose2attack`). Test: "task 12: brewing a super attack potion".
3. **The "bank full" warning on death never fired.** `inv_moveitem` deletes the item first and drops whatever the target cannot take on the ground (`Engine-TS/src/engine/script/handlers/InvOps.ts:513-526`), so the old check after the move always saw an empty slot. **Fix:** `relic_stash_inv` checks `inv_itemspace(bank, ...)` before moving and warns otherwise; the item then goes through the normal death drops (`mods/relics/scripts/relic_death.rs2`).
4. **The first login queued the offer twice.** `relic_first_offer` queues it and `relic_on_login` queued it again because `%relic_pending` was now 1. Closing the first dialog brought up a second fresh draw. **Fix:** `relic_on_login` returns after starting the run.
5. **Double Yield with Evergreen or Eternal Vein gave 1, not 2, when the backpack was full**, because it checked backpack space even when the product goes to the bank. **Fix:** `relic_gathered` checks space for 2 in the destination (bank first, then the backpack). This was a reasonable-default call; the M7 note had described the old check.
6. **Harness:** `bot.choices` and `bot.choose` listed the buttons of an earlier dialog when one script shows two choice dialogs in a row. `if_addresumebutton` only appends (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:835`) and `Player.openChatModal` clears `resumeButtons` only when it replaces a *paused* script (`Engine-TS/src/engine/entity/Player.ts:2034-2056`). **Fix:** the harness keeps only buttons under the open chat modal (`harness/src/Bot.ts`, `resumeButtons`). Test: "bot.choices lists only the open dialog when one script asks twice" in `tests/relics.test.ts`.

7. **Amulet of glory said it lost a charge with Everlasting Jewellery** (Calum asked for the fix). The message printed before the relic hook, so the amulet stayed (4) but said "three charges left". **Fix (Content hook, `0bd36bfa3`):** the `mes($message)` is skipped when `~relic_keep_charge` is true (`Content/scripts/general/scripts/enchanted_jewellry/amulet_of_glory.rs2:28-30`). Test: "everlasting jewellery: rubbing amulet_of_glory_4 teleports and keeps the charge" now expects no charge message for all three items.
8. **Closing an offer and relogging rerolled it** (Calum asked for the fix). The seed advanced when the offer was drawn, so a player could close and relog to see three new relics. **Fix:** `relic_offer_mode` saves the seed, draws, puts the old seed back while the dialog is open and stores the advanced seed only once the player answers. Closing drops the script (`Player.closeModal`), so the old seed stays and the next login shows the same three relics. Tests: "closing an offer keeps it pending and unchanged ..." and "first login queues the offer once ...".

Each fix was made test first: the test failed for the expected reason, then passed after the fix.

## Decided and remaining questions

- **Executioner credits more XP than the monster had left: kept by design** (Calum, 2026-10-10). `relic_execute` credits the NPC's remaining HP (`mods/relics/scripts/relic_effects.rs2`, `[proc,relic_execute]`), and the landed hit is credited again: `player_melee.rs2:29` computes `min($damage, npc_stat(hitpoints))` while the NPC still has its HP, because the execution damage is only queued. Observed: a 3 HP giant credited 4 damage worth of attack XP. The test now asserts this (remaining HP plus at most one max hit).
- **Quest Pass on a live server** opens about 63 quest scrolls one after another (each `*_complete` queue opens one through `[proc,send_quest_complete]`, `Content/scripts/general/scripts/quests.rs2:15`); the test closes them all. Inference: a real player must click through each.

## Verified behaviour (by test, at the commits above)

**Offers.** Seed 5 offers Midas Loop, Hoarder, Eternal Vein (matches M4). Closing an offer grants and declines nothing, and keeps `%relic_pending` and the seed; a relog shows the same three relics. Several pending offers are answered in sequence, each draw excluding the relic just granted. Owned relics are never offered; XP Multiplier is offered until tier 3. One relic left gives "Take this relic?" with "No thanks", which sets the declined bit. An empty pool clears pending without a dialog and without moving the seed. Hoarder offers only relics that are both declined and still eligible, and does nothing when none are declined. Quest Pass ends with 63 quests complete and 135 quest points (Black Arm and Lucien chosen). XP tiers 1, 2, 3 give exactly 2x, 4x, 8x the tier 0 XP.

**Combat.** Applied damage from real giant hits is `d` without relics, `(d+1)/2` with Stoneskin, `(3d+1)/2` with Glass Cannon (on the halved value with both). Phoenix leaves 1 HP once per 500 ticks, checks the already-reduced amount, and its cooldown survives death. Glass Cannon doubles the value `npc_max_dealt` returns (after the `max_dealt` cap, `npc_combat.rs2:428`). Quickstrike halves unarmed melee and shortbow intervals from 4 ticks to 2. Vampire heals `1 + base*10/100`, capped at base. Executioner finishes an NPC below 25% of base HP on the next landed hit and not at exactly 25%. Bounty drops `5 + 3*basehp` coins and bread/trout/swordfish/shark at under 20, 20+, 50+, 100+ base HP, on the NPC's tile, before the drop table.

**Skilling.** Eternal Vein: the rock keeps its type, ore goes to the bank, a full backpack does not block mining, a full bank falls back to the backpack. Evergreen: the tree stays and chopping continues (3 logs to the bank), walking stops it. Double Yield gives 2 per success when there is room. Philosopher's Coin doubles high (21 to 42) and low (14 to 28) alchemy on an iron dagger. Midas Loop alchs all 4 daggers from one cast and stops when they run out; a walk click stops it (`MoveClickHandler.ts:30-31` calls `clearPendingAction`, which calls `closeModal` (`Player.ts:973`), which clears the weak queue (`Player.ts:761-763`)).

**Utility.** Infinite Runes: Varrock Teleport, high alchemy and Wind Strike all work with no runes; the controls fail with the rune message. Everlasting Jewellery: the three items go to the backpack (bank when full); rubbing the ring, glory and games necklace teleports and keeps (8), (4), (8); the controls lose a charge. Last Recall swaps the two ends on every use (Lumbridge to Varrock by spell, stone back to the exact tile, stone again to the Varrock landing tile). Banker's Call opens `bank_main`.

**Tasks.** All 18 kill rows (both finals included) and all 10 product rows complete their own task bit. Real actions complete tasks 1, 4, 5, 6 (stringing a magic shortbow), 7 (burning a yew log; ordinary logs do not), 10, 11, 12, 13 (a paladin; a man does not), 20. Two kills in one tick complete a task once; tasks count in any order.

**Death, keeper, win.** A skulled death moves the recall stone, banker stone and the three jewellery items (worn or carried) to the bank; ordinary items and a non-relic `ring_of_dueling_7` drop. Exactly one Relic Keeper stands in Lumbridge after many logins, including one far away (part of question 79). The keeper re-issues only items of owned relics that are missing from inv, worn and bank. Task 24 alone says "A final boss is down"; 24 and 25 in either order show the win mesbox; finals owe no offer.

## Not tested

- Quickstrike on magic and special attacks; Executioner and Glass Cannon dealt on ranged and magic hits.
- Phoenix against a real NPC killing blow (only `::~relic_hit`).
- Fishing and cooking `relic_gathered` sites with Double Yield; tasks 8 (law rune) and 9 (swordfish) only through the gather hook.
- Real fights with the King Black Dragon and the Kalphite Queen (killed with `relic_kill`, their real death scripts).
- Eternal Vein with bank and backpack both full (read only: `inv_add` would drop the overflow).
- Tutorial Island and the tutorial-complete hook (the harness does not cover Tutorial Island).
- Anything client-side: dialogs, jingles, spotanims, the win mesbox's look.

## Related

`relics-m2-xp-energy.md` to `relics-m8-win-and-pacing.md` (what was observed by hand), `../setup/headless-test-harness.md`, `../local-changes.md`.

**Infinite Runes sweep (2026-10-10, Content `0bd36bfa3`, root `c5da4f1`).** Every rune check goes through `[proc,check_spell_requirements]` and `[proc,staff_runes]` in `Content/scripts/skill_magic/scripts/magic.rs2`, which the `~relic_rune_count` hook zeroes (hook commit `30ede1e59`, 2026-10-10 16:10 UTC). `grep` found no other rune check: all 12 callers of `check_spell_requirements` (combat, pvp, autocast, crumble undead, alchemy, teleport, enchant, superheat, charge, charge orb, bones, telegrab) use it. The sweep test casts each spell from an empty backpack, with and without the relic; all pass. Not covered: Charge, Charge Orb and Telekinetic Grab (set-up needs the Mage Arena varp, an obelisk and a floor item), PvP magic. The client only greys the spell icon and shows rune counts in red (`Client-TS/src/client/Client.ts` `getIfActive`, callers at 10096-10252 and 10616 only draw); it does not stop a click.

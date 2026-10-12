# Relic 20 Green Thumb and tasks 43, 44, 45

**Question this answers:** how does the herblore relic work, which hooks does it use, and are the three herblore tasks possible on the current server?
**Based on:** root `f9cce01` plus this change (bank-XP section added 2026-10-12 at root `5da4549`, Content `49de3c73f`, Engine-TS `f6f52c47`); Content `514e71556` (hooks `a274da743`, `63824af58`); Engine-TS `33564f19`. **Method:** code written and read, then **run** headless on Node 24.11.1: `tests/relic-greenthumb.test.ts` (20 tests; 12 failed before the implementation, all 20 pass after) and the whole suite (364/364), `tsc` clean. Not tried in a real client. Research: [herblore-relic-research.md](herblore-relic-research.md).

## What it does (id 20, bit 20 of `%relic_owned`; id 20 was unused)
1. **Stat boosts never drain.** `[timer,stat_boost_restore]` (`Content/scripts/player/scripts/stat.rs2:51`) only subtracts a boost point when `~relic_boost_stays = 0`. Applies to every boost (potions, kebabs, special attacks). Drained stats still recover (`[timer,stat_regen]` untouched). Antifire is a separate timer (`%dragonresist`) and is not affected.
2. **Secondaries are never used up.** `[proc,brew_potion]` (`Content/scripts/skill_herblore/scripts/herblore.rs2:11`) skips `inv_del` of the ingredient when `~relic_keeps_secondary($ingredient, $solvent)` is 1: relic owned, solvent is not `vial_water`, and the ingredient is not a herb (`category_774`). So herb + vial of water is still consumed; limpwurt, eggs, dust, wine and so on stay.
3. **XP grows herbs.** Engine `Player.relicGreenThumb` (called from `addXp`) adds the **raw** XP (tenths, before the engine rate and the XP Multiplier) to `%relic_herb_xp` and queues `[queue,relic_herbs]` (Herblore excluded). `~relic_herbs_claim` (`mods/relics/scripts/relic_herblore.rs2`) pays one herb per 500 raw XP (`^relic_herb_xp_per_herb = 5000` tenths), picked **evenly** from the herbs the player's current Herblore level can identify, out of the eleven herbs of `[proc,randomherb]` (enum `relic_herb_list`). Herbs arrive **already identified** (no identify XP), in the **bank**, else the backpack; no room keeps the XP owed. Up to 200 per claim, the rest is claimed next. Below Herblore 3 the XP is dropped. Silent: no chat line per claim.
4. **Starter secondaries.** Taking the relic puts one each of eye of newt, red spiders' eggs, limpwurt root, snape grass, white berries, unicorn horn dust, dragon scale dust, wine of Zamorak, jangerberries, toad's legs, chocolate dust, mort myre mushroom and potato cactus in the bank (`~relic_herblore_starter`).

## 5. Banking herbs pays Herblore XP (added 2026-10-12)
Every herb put **into the bank** pays the Herblore XP of cleaning it, once per herb, grimy or clean. Asked by Calum; the choices below are defaults, not answers from him.
- **Hook:** `Content/scripts/interface_bank/scripts/bank.rs2`, `[proc,bank_deposit_request]`: `~relic_bank_herbs($obj, $deposit); // relic hook` right after `inv_moveitem_uncert($inv, bank, $obj, $deposit)`. `$deposit` is the number actually moved, so "deposit 5 of 10" pays 5 and a stack pays every herb. This proc is the only bank deposit path I found (`bank_deposit.rs2:27`, plus the Viking quest's `viking_peer.rs2:195,213`); a grep for `inv_moveitem_uncert(.*bank` finds no other.
- **Amount:** `identified_herb_exp` of the clean herb (`herbs.obj`, e.g. ranarr 75 = 7.5 XP, kwuarm 113). `~relic_herb_clean_xp` (`mods/relics/scripts/relic_herblore.rs2`) maps each grimy herb (`unidentified_*`, 19 of them, including the quest herbs) to its clean herb with a `switch_obj`; a clean herb carries the param itself. Anything else has no param (default 0, `identify.param`) and pays nothing.
- **XP path:** `stat_advance(herblore, ...)`, so the engine XP rate and the XP Multiplier apply like any other Herblore XP (test: factor 3 gives 3x). Silent, no message.
- **Cap:** at most `^relic_bank_herb_max` (1,000,000) herbs per deposit count, so `xp * n` stays inside 32 bits.
- **Not paid:** herbs Green Thumb itself adds to the bank (`inv_add`), herbs moved by the death relic (`relic_death.rs2:33`), and any herb that reaches the bank another way. Herbs are not noted in this revision (no `certlink` in `herbs.obj`), so noted herbs were not tested.
- **Loop to know about:** withdraw and deposit the same herbs again and every deposit pays again. This is what "each time a herb is banked" means; there is no once-per-herb tracking. Say if you want a limit.
- **Tests:** `tests/relic-greenthumb-bank.test.ts` (7; 5 failed before the change, all 7 pass after; whole suite 415/415 on Node 24.11.1, `tsc` clean).
- **Method note:** run headless, not tried in a real client. The packet that drives the test is the client's bank-panel click (`INV_BUTTON1..4` on `bank_side:inv`); "Deposit X" (`INV_BUTTON5` with the count dialogue) was not driven.

## Choices to change if wanted
- Raw XP, not displayed XP, so the XP Multiplier does not flood the bank (a yew log is 175 raw XP; 500 XP is about three logs). Tune `^relic_herb_xp_per_herb`.
- Torstol, toadflax and snapdragon are not in the herb list (no drop gives them; Calum did not answer that question). Add them to `relic_herb_list` in level order to include them.
- Evenly picked, not drop-weighted, so a level 70 character is not buried in guam leaves.

## Tasks (stored in `%relic_tasks_done2` bits 11 to 13)
Rows in `relic_tasks.dbrow`; the existing `~relic_task_obj($mixture)` hook in `brew_potion` (`herblore.rs2:16`) fires them.
- **43 Make a super strength potion**: obj `3dose2strength`, kwuarm vial + limpwurt, Herblore 55 (`brew_potion.struct:116-121`).
- **44 Make an antifire potion**: `3dose1antidragon` ("Antifire potion(3)"), lantadyme vial + dragon scale dust, Herblore 69 (`brew_potion.struct`, `[3dose1antidragon]`).
- **45 Make a ranging potion**: `3doserangerspotion`, dwarf weed vial + wine of Zamorak, Herblore 72.
Menu: 44 tasks listed, `^relic_task_count` 45; rows 43-45 added to `relic_taskmenu.if` (scroll 628), pack ids 11189-11191.

## Are the three potions supported? (answers Calum's question)
Yes, headless-tested: all three are made by the normal brew path with the level checks; drinking works (ranging +4 and 10% Ranged; super strength boosts Strength; antifire sets `%dragonresist` 600 ticks ahead, `anti_fire.rs2:1-8`, read by `dragon.rs2:124`, `king_black_dragon.rs2:342`, `elvarg.rs2:120,129`). Antifire's supply is thin: blue dragon scales are **not** a drop (`drop tables/scripts/blue_dragon.rs2` has none); the only ones are 5 ground spawns in the Taverley dungeon (x 2902-2910, z 9796-9809). Wine of Zamorak is one ground tile (Chaos temple, hostile on pickup, `general/scripts/misc/wine_of_zamorak.rs2`) plus a Canifis citizen drop. Green Thumb's starter set and keep-secondary rule remove both bottlenecks.

## Not checked
Real client; whether the Chaos temple wine is reachable on a fresh character; bank-full fallback to the backpack (written, not tested); how the herb flow feels at 270x; menu position of tasks 43-45 is approximate (by Herblore level among the other tasks).

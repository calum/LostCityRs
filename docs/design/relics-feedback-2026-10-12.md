> **Superseded in part (2026-10-13):** the XP Multiplier guarantee (4th/9th/12th task) was replaced by passive tiers at 5/10/15 tasks done. See [relics-passive-xp-and-phoenix.md](relics-passive-xp-and-phoenix.md).

# Relic review feedback, 2026-10-12

**Question answered:** what changed after Calum's line-by-line review of every relic and task (an editable review sheet; his notes were read from the sheet's saved data), and what was not done.

**Based on:** root `eafd8b4` plus the docs commit that adds this note, Engine-TS `f6f52c47`, Content `a51ba7bf9` (no Engine or Content change: all edits are in `mods/relics/`, the tests and the docs). **Method:** tests written first and run red, then the mod change, then green; each test file named below was run on Node 24.11.1 with `node harness/run.mjs`. Not seen in a real client (rendering, animation timing, scroll text).

## What Calum asked for and what was done

| Feedback | Change | Where | Tests |
|---|---|---|---|
| XP Multiplier I should be guaranteed from task 4 until picked; II from task 9; III from task 12 | New `[proc,relic_xp_due](int $count)` returns 1 when tier < 1 and 4+ tasks are done, tier < 2 and 9+, or tier < 3 and 12+. Every ordinary offer (and the "Quest Pass already owned" fallback at the 10th) forces the multiplier as option 1 when it is due. The old "every 5th task" rule and its `%relic_xp_owed` counter are no longer used (the varp stays declared). "Task N" is read as N tasks done, as for the earlier special offers ([relics-special-offers.md](relics-special-offers.md)). | `mods/relics/scripts/relic_offer.rs2:194` (proc), `:276`, `:280` (callers) | `tests/relic-special-offers.test.ts` (4th, 5th, 8th, 9th, 12th task, tier 3, relog stability) |
| Quest Pass should be a scroll put in the inventory, else the bank, and reading it autocompletes the quests (so quest screens do not stack while in combat) | Granting Quest Pass now sets `%relic_quest_scroll = 1` and gives `relic_quest_scroll` through `~relic_give_item` (inventory, else bank, with a chat line). `[opheld1,relic_quest_scroll]` removes it, clears the varp and queues the same `relic_quest_pass` script as before, so the quest completion and the plain 1x quest XP are unchanged. Death moves an unread scroll to the bank; the Relic Keeper replaces a lost scroll only while `%relic_quest_scroll = 1`, so a read scroll or a Quest Pass from before this change (varp 0) never gets one. | `relic_offer.rs2:174` (grant), `:396` (read), `relic_death.rs2:21` and `:78`, `relic.varp:99`, `relic_items.obj:66` | `tests/relic-offers.test.ts` (scroll tests, quests via the scroll), `tests/relic-death-win.test.ts` (death, keeper) |
| Phoenix should play the death animation when it triggers | `anim(human_death, 0)` before the chat line. | `relic_effects.rs2:20` | `tests/relic-combat.test.ts` ("Phoenix: the save plays the death animation") |
| Bounty coins x5 | Coins are `(5 + 3 x base hitpoints) x 5`. Food unchanged. | `relic_effects.rs2:181` | `tests/relic-combat.test.ts` (Bounty test) |
| Hunter's Haul: ten hides | `~relic_bank_extra($leather, 10)`. | `relic_skilling.rs2:63` | `tests/relic-skilling-routes.test.ts` (Hunter's Haul tests) |
| Remove auto-cooking from Double Yield, give it to the fishing relic (Endless Shoal) | `~relic_fished` now cooks when the player has relic **27** instead of 12. Double Yield only doubles the count (and the fishing XP, as before). The cooked fish and the cooking XP are credited per fish; the raw fish still counts for "catch a raw swordfish". Because Double Yield no longer cooks, the "cook a shark" task via fishing now needs Endless Shoal. | `relic_gather.rs2:52` | `tests/relic-doubleyield-xp.test.ts`, `tests/relic-skilling-routes.test.ts` (Endless Shoal tests) |
| Task "Where" column showed things like "automatic" or "use the Recall stone" for monster tasks; list all Giant locations | The guide's task table now links spawn areas read from the map files for tasks 2, 3, 14, 15, 16, 17 and 18 using `docs/tools/npc_spawns.py` (new `--all` and `--tiles` flags). The Giant row lists every spawn area with every spawn tile. Task 2 (lesser demon) had the same defect, so it was fixed too. | `docs/guide/relic-mode-player-guide.md` task table | no test: docs and tooling only |
| Name/description edits in the sheet | Task 13 (paladin) drops "A failed attempt stuns and hurts you", task 26 drops "(it is never smelted on its own)", task 40 drops the "already have a 99" sentence, relic 12 and 27 wording follows the moved cooking. | guide | no test: wording |

The offer odds table ([reference/relic-offer-odds.md](../reference/relic-offer-odds.md)) was regenerated with the new guarantee rule (`docs/tools/relic_offer_odds.py`, `relic_xp_due` mirrored in the simulator).

## Follow-up: Quest Pass hint dialog (Calum, 2026-10-12)

Granting Quest Pass now ends in a message box (`[proc,relic_quest_scroll_hint]`, called after the scroll is given in `[proc,relic_grant]`, `mods/relics/scripts/relic_offer.rs2`): "You gained the Quest Pass relic. A Quest Pass scroll is in your backpack (or bank). Read it when you are ready, ideally out of combat. It completes every quest, and each quest opens its own screen." Tests: `tests/relic-offers.test.ts` (backpack and bank wording), `tests/relic-special-offers.test.ts`, `tests/relic-death-win.test.ts`. Red run first: 7 failures, then green; suite 427/427, `tsc` clean.

The dialog exposed a hole, found by a test: closing a dialog drops the script that opened it, and the 10th-task grant ran inside `[proc,relic_offer_pending]` before `%relic_pending` was decremented, so closing the hint would have left an offer pending and given a free extra relic choice after a relog. The pending count is now paid before the Quest Pass grant. Test: "closing the Quest Pass hint does not leave an offer pending".

## Not done

- **Map search for NPCs, items and objects** (general note in the sheet): a `search` box in `::map` that highlights every "Mithril rock", "knife" on the floor or "Giant" and pans to the nearest. Not started. What it would need is in [open-questions.md](../open-questions.md) item 133; it is a separate piece of work.
- Item names in the sheet were not renamed by Calum (all names in the sheet kept their original text), so no in-game names changed.

## Not checked

- Real client: the scroll item model and icon (reuses `inv_map_scroll` with a recolour), how Phoenix's death animation looks when the player keeps fighting, the guide table with the long Giant cell.
- Whether anything outside `tests/` and the guide still says "every 5th task" or "Double Yield cooks fish" (searched `docs/design`, `docs/guide`, `mods/`; older notes such as [relics-double-yield.md](relics-double-yield.md) and [relics-special-offers.md](relics-special-offers.md) now carry a banner pointing here instead of being rewritten).

# Relic offers: Quest Pass on the 10th task, XP Multiplier on every 5th (and the removed rerolls)

**Question answered:** which offers are special, how are they built, and what happened to the rerolls?

**Based on:** LostCityRs after `dddc0ac` (this change on top), Engine-TS `e45392c4`, Content fork main. **Method:** read the offer scripts, tests first (red run: 15 failures, then green 323/323 on Node 24.11.1, `tsc` clean). Not played in a real client.

## Rules (Calum, 2026-10-11)
"Nth task" means the Nth task **done** (any order), counted by `[proc,relic_tasks_done_count]` in `mods/relics/scripts/relic_offer.rs2`, not task id N.
- **10th task done (and 20th, 30th, 40th while Quest Pass is not owned):** the offer is skipped and Quest Pass is granted directly (`%relic_quest_owed`, handled in `[proc,relic_offer_pending]`). If Quest Pass is already owned it becomes an ordinary offer that guarantees the XP Multiplier option, like every 5th.
- **Every 5th task done:** the first option is the XP Multiplier whenever it is eligible (tier below 3); the other two are drawn as usual (`[proc,relic_offer_run]` with `$force` 1, `%relic_xp_owed`). At tier 3 it is an ordinary three.
- The owed counters are decremented only when the offer is answered, so closing the offer or relogging shows the same offer again. They are set at task completion, so they are not retroactive.
- A final boss (tasks 24 and 25) gives no offer, so if one is the 5th/10th task done, that special offer is skipped. When several offers are pending the order is: Quest Pass grant, XP-guaranteed offers, ordinary offers.
- A closed offer keeps the same relics in the same order after a relog or after "Choose a relic now" (`tests/relic-offer-stable.test.ts`).

## Rerolls (added and removed on 2026-10-11)
Rerolls (1 to start, +1 per 7, then per 10 tasks, a "Reroll" option in the offer) were built and then removed at Calum's request because the new offer balance made them unnecessary. The commits are in the git history (`5515843` and earlier). The two varps `relic_rerolls_used` and `relic_offer_shown` stay declared but unused, so saves that hold a value for them keep loading (not verified what the engine does with an undeclared saved varp; kept declared to be safe).

## Tests
`tests/relic-special-offers.test.ts` (5th task offers XP at six seeds; 4th and 6th do not guarantee it; tier 3 gives an ordinary three; 5th-task offer stable over a relog; 10th grants Quest Pass directly; 10th with Quest Pass owned guarantees XP) and `tests/relic-offer-stable.test.ts`.

## Not checked
Real client. Whether the engine tolerates a saved value for an undeclared varp.

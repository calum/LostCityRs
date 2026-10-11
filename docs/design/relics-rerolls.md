# Relic rerolls (built, tests only)

**Question answered:** how does a player reroll a relic offer, how many rerolls do they have, and how is it built?

**Based on:** LostCityRs `c71497e` (+ this change), Engine-TS `e45392c4`, Content `a699b3add` (+ one pack line, see below). **Method:** read the offer scripts, wrote tests first (8 new tests red, then green), ran the headless suite on Node 24.11.1. Not played in a real client.

## Rules (Calum's request, 2026-10-11)
- Every account starts with 1 reroll. Every 7 tasks done gives one more.
- A reroll replaces all the offered relics with new ones.

## How it is built (`mods/relics/scripts/relic_offer.rs2`)
- Count: `[proc,relic_rerolls_earned]` = `1 + tasks done / 7`, `[proc,relic_rerolls_left]` = earned minus `%relic_rerolls_used` (new perm varp, `mods/relics/configs/relic.varp`). Tasks done are counted from the two task varps (`[proc,relic_tasks_done_count]`, all 39 tasks including the final bosses). Nothing is stored per grant, so characters that already exist get the right number from the tasks they have done (1 + done/7, minus 0 used).
- Offer: while rerolls are left, the offer is in mode 0 (not Hoarder's "declined" offer), there is a second relic and relics not yet shown remain, the choice dialogue has a last option `Reroll (N left)` (`p_choice4_header`, or `p_choice3_header` when only two relics are offered). It returns 99 internally.
- Picking it: `%relic_rerolls_used` goes up at once, the relics shown are marked declined (they feed Hoarder like any turned-down relic) and the loop draws again, excluding every relic shown earlier in this offer, so nothing repeats while the pool lasts.
- Seed: a normal offer stores the advanced seed only when answered (closing the dialog leaves the same offer for the next login). A reroll stores the advanced seed, the spent reroll and the relics shown so far (`%relic_offer_shown`, cleared when the offer is answered) straight away, so a relog after a reroll shows the same rerolled offer. Before `%relic_offer_shown` existed, a relog after a reroll drew again without the exclusion and could show different relics (found 2026-10-11 while checking that closed offers are stable).
- Announcement: `[queue,relic_task_done]` says "You earned a relic reroll (N available)." when the task count becomes a multiple of 7 (also for tasks 24 and 25).
- Menu: the Relics menu title reads `Relics (Rerolls left: N)` (`relic_menus.rs2`, `relic_relicmenu_refresh`). A new component was avoided: adding one to an existing interface means editing `Content/pack/interface.pack` and `interface.order` by hand (`scripts/sync-mods.mjs`).
- Content fork: sync-mods appended `373=relic_rerolls_used` to `Content/pack/varp.pack` (committed in the Content fork).

## Tests
`tests/relic-reroll.test.ts` (7 tests: fourth option on a fresh account, reroll spends and declines and never repeats, none left, existing character with 14 tasks has 3, two rerolls in a row, announcement on the 7th task and none on the 6th) and one in `tests/relic-menus.test.ts`, and `tests/relic-offer-stable.test.ts` (closed offer + relog, closed offer + "Choose a relic now", rerolled offer + relog: same relics, same order). Older tests that counted 3 choices now expect 4 (`relics.test.ts`, `relic-menus.test.ts`, `relic-tasks.test.ts`, `relic-offers.test.ts`). Red run: 8 failed (offer had 3 options, text and varp missing). Green run: 312/312 on Node 24.11.1, `tsc` clean.

## Not checked
- The 4-option dialogue in the real client (text fit, "Reroll (N left)" length).
- Pool smaller than the shown set (reroll is hidden then: `relic_pool_size($drawn,0) > 0` is false).

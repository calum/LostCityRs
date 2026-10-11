# Hoarder (relic 19): choose from every declined relic

**Question:** why did Hoarder only offer 3 relics, sometimes from the offer just closed, and how does it work now?
**Based on:** root `64c78b7` (+ this change), Content `d1d052a46`, Engine-TS `a5d259ac`. Method: read the scripts, then ran the headless suite.

## Before (bug, read from `mods/relics/scripts/relic_offer.rs2` at 71d8e14-era main)
- `relic_grant(19)` called `~relic_offer_mode(1)`, the ordinary offer engine, which draws **at most 3** relics (`relic_offer_run`) and shows a `p_choice3` dialogue. A player with 8 declined relics saw 3.
- `relic_offer_run` marked the unpicked relics of the current offer as declined **before** granting the pick, so the two relics offered next to Hoarder were in the Hoarder pool.
- Closing the dialogue lost the pick (Hoarder was already owned, nothing recorded it).

## Now
- `relic_hoarder_start` (granted Hoarder): if `relic_pool_size(0, 1)` > 0, `%relic_hoarder_owed` += 1 and `relic_hoarder_open` opens main interface `relic_hoardermenu` (scrolling layer, 30 rows, `mods/relics/interfaces/relic_hoardermenu.if`; row components via enum `relic_hoarder_rows`).
- The list is mode 1 of `relic_in_pool`: eligible, declined earlier, and not in `%relic_hoarder_skip`. Rows are in relic id order. Quest Pass is never listed (`relic_in_pool`).
- `relic_offer_run`: when the pick is 19 it sets `%relic_hoarder_skip` to the offer's relic bitmask first, so the other two relics of that offer are excluded; they still get their declined bit.
- Clicking row N runs `relic_hoarder_pick(N)`: grants the Nth listed relic (clears its declined bit), clears the skip mask, closes the widget, and re-queues `relic_offer_q` if offers are pending.
- Closing the widget without a pick leaves `%relic_hoarder_owed` set. `relic_on_login` re-opens it, and the Relics menu "Choose a relic now" button opens it instead of an offer. `relic_offer_pending` waits while a pick is owed so the next dialogue does not close the widget.
- Nothing declined yet (or all taken): no widget, no owed pick, as before.

## Tests
`tests/relic-hoarder.test.ts` (4): written first, all 4 failed (no widget; unknown varp). After the change: 4/4 pass. Full suite: see commit message.

## Not checked
- Scrolling, click hit-testing inside the scroll layer and the look of the widget in a real client (harness does not render). Added to open-questions.
- Choice stays free of choice for XP Multiplier: it is listed if it was declined and tier < 3, and a pick raises the tier.

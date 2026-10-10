# Relic mode M4: offers, first-login offer, celebration (observed)

**Question answered:** does the offer engine work (draw, dialog, grant), and when does the first offer fire?

**Based on:** Content `relic-mode` `8140aedf1` (base `65b754f`), Engine-TS `relic-mode` `8c4fa9ca`. **Method:** ran the server with the headless client, read dialogs from screenshots and results from the server console (`console()`).

## Design as built (`mods/relics/scripts/relic_offer.rs2`)
- Relic ids: 1 = XP Multiplier (a tier counter, not a bit), 2-19 = bit n of `%relic_owned`. Pool = every id still eligible (1 only while `%relic_xp_tier < 3`).
- RNG: `%relic_seed = (seed * 75 + 74) % 65537`, then `seed % pool_size` picks the k-th eligible id not yet drawn. Chosen because the plain `random()` opcode is not seedable (not read in the engine; this avoids needing it) and small numbers stay exact.
- Offer: up to 3 distinct ids, `~p_choice3_header` (or `~p_choice2_header` for two, and one relic plus "No thanks"). Unpicked ids set bits in `%relic_declined`. Empty pool shows nothing.
- `%relic_pending` counts earned-but-unanswered offers. A dialog the player closes leaves it set and `~relic_on_login` re-queues it (not tested).
- Task completion (`[queue,relic_task_done]`): celebrate (`spotanim_pl(levelup_anim, 124, 0)` and the attack levelup jingle via the `levelup` dbrow, as `levelup.rs2:33,50`), then the offer. Tasks 24 and 25 only celebrate.
- Hooks: `~relic_on_login` (login.rs2) starts the run for characters whose `%tutorial >= ^tutorial_complete`; `~relic_first_offer` at the end of `[label,tutorial_complete]` (tutorial.rs2) covers both the normal ending and the "skip the tutorial" choice, because both jump to that label (`runescape_guide.rs2:16`, `magic_instructor.rs2:85`).

## Observed
1. A choice dialog opened from a `[queue]` started by the login hook works (existing character, first login after the hook: three relics offered immediately). Answers Q77.
2. New character: no offer on Tutorial Island; talking to the RuneScape Guide, "Do you want to skip the tutorial?" then "Yes please." teleports to Lumbridge and the three-relic dialog follows. (The skip question only appears when `map_live` is false, as on this local server: `runescape_guide.rs2:11`.) The normal full-tutorial ending was not played.
3. Same seed gives the same three (seed 5: Midas Loop, Hoarder, Eternal Vein, twice). Option text fits the dialog at 3 lines (`Name: short effect`).
4. Pool shrinking: with all but two relics owned, a two-option dialog; with one left, "Take this relic? / No thanks"; with the pool empty, no dialog and the pending count clears. XP picks stop at tier 3. All 18 bit relics owned gave `owned=1048572`.
5. The headless driver's first click can land on a login-time dialog; it now clicks the empty inventory panel to focus.

## Not checked
Closing the dialog and re-offer at next login; level-up and relic jingle in the same tick (Q75); `spotanim_pl` visibility to other players; the full tutorial ending path.

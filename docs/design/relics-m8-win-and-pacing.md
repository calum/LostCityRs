# M8: win condition and pacing

**Question:** does the run end when both final bosses are killed, and what is known about pacing?
**Based on:** Content `c8cff7b57` (branch `relic-mode`, no new Content hook in M8), Engine-TS `8c4fa9ca`. Method: run in game with the headless client for the win condition; **no full run was played**.

## Win condition (verified in game)

- No new upstream hook: tasks 24 (`king_dragon`) and 25 (`kalphite_flyingqueen`) are rows in `mods/relics/configs/relic_tasks.dbrow` and are detected by the existing `~relic_on_kill` hook in `npc_death.rs2`. `[queue,relic_task_done]` (`mods/relics/scripts/relic_offer.rs2`) now checks, for tasks 24 and 25, whether both tier-4 bits are set (`^relic_tier4_mask`); if so it calls `~relic_win` (chat message plus `~mesbox`), otherwise it prints "A final boss is down. Defeat the other one to win." Finals give no relic offer.
- **Observed:** after `::~relic_alltasks` (new debug proc, marks tasks 1 to 23 done), `::~relic_kill king_dragon` and then `::~relic_kill kalphite_flyingqueen` (these spawn the npc and run its real death script) printed "Relic task 24 complete! A final boss is down...", then "Relic task 25 complete! You have defeated both final bosses. You win the relic run!".
- Not checked: that a real KBD kill and a real Kalphite Queen fight (through the first form, finding 14 of the design) reach those death scripts the same way; the `~mesbox` popup (the headless client could not be relied on to show it); and what a player does after winning (nothing resets).

## Pacing (not measured)

The plan asks for a stopwatch run on a fresh character to replace the 10-hour estimate. That was **not done**: it needs hours of real play (every kill and skilling task, the level-gated ones included), which the headless driver cannot do in a reasonable time. So the estimate in the spec stays unvalidated. What this work did establish, as inputs for the run:

- XP multipliers 8, 16, 32 and 64 times work (`docs/design/relics-m2-xp-energy.md`), run energy never drains.
- Task tiers: 1 to 6, 7 to 13, 14 to 23, then the two bosses (`relic_current_tier`). Tier 2 tasks need Runecrafting at the law altar (task 8), Smithing silver (task 11), Herblore super attack (task 12) and Thieving paladins (task 13); whether a fresh character can reach each in reasonable time at 8x to 16x XP is **not checked**.
- Pool size (inference from the code in `relic_offer.rs2`): 18 one-time relics plus up to 3 XP tiers serve 23 task offers plus the first-login offer, so the last few offers will be empty or short, as the spec expects.
- Quest Pass also grants the quests' XP rewards (see M7), which can skip a lot of leveling; Quickstrike and Executioner are untested against bosses.

## Not checked
Everything under "Pacing"; a play-through to the win message by real play; whether the offer dialogs can be closed without choosing (pending offers re-open at login).

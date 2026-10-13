# Glass Cannon: extra hitsplats (relic 5)

**Question this answers:** how does Glass Cannon's 25% chance of an extra damage hitsplat work, and what is tested?
**Based on:** root `40e221f` plus this change; Content `d61de358c` (no upstream file changed: the change is in `mods/relics/`); Engine-TS `8f0539df`. **Method:** code read, then **run** headless on Node 24.11.1 (whole suite after the change: 434/434, `tsc -p harness/tsconfig.json` clean): the 3 new tests in `tests/relic-glass-cannon.test.ts` failed first (`no proc relic_glass_extra`, and 0 extra hitsplats over 600 attacks), then passed. Not tried in a real client.

## What it does
Requested by Calum 2026-10-13: Glass Cannon also gives a 25% chance of an additional damage hitsplat, recursive (each extra can roll another).
- `[proc,relic_dealt]` (`mods/relics/scripts/relic_effects.rs2`), called from `[proc,npc_max_dealt]` (`Content/scripts/skill_combat/scripts/npc/npc_combat.rs2`, last return) on every landed player attack on an npc, now calls `~relic_glass_extra($maxhit, 25)` with the doubled max hit when the player has relic 5.
- `[proc,relic_glass_extra](maxhit, pct)` loops: while fewer than `^relic_glass_extra_max` (10, `mods/relics/configs/relic.constant`) extras have been rolled and `random(100) < pct`, it rolls `randominc($maxhit)` (same roll as the normal hit, with the doubled max), queues it with `npc_queue(2, damage, delay)`, credits hero points and combat XP for `min(damage, hitpoints not yet credited)` (same rule as the normal hit's `damage_capped`), and loops again. Chain length is geometric: mean `0.25 / 0.75` = 1/3 extra hitsplats per landed attack, at most 10.
- **Timing (design choice, not from upstream):** extra number `n` is queued with delay `n` ticks, so each shows its own hitsplat (an npc shows two hitsplats per tick, `Npc.applyDamage`, `hitmarkSlot % 2`). If the attack is not melee (`%damagetype ! ^melee_style`, i.e. ranged or magic) the delay is `n + 2`, so extras do not land before the projectile. The projectile flight time is not known inside `npc_max_dealt`, so a long-range shot can still show an extra a tick early (inference, not observed).
- The damage always goes through the npc's damage queue, so npcs that override `npc_default_damage` treat extras like normal hits. Extras on a dead npc do nothing (`npc_default_damage` returns when hitpoints are 0).
- Vampire heals from each extra (they go through `give_combat_experience`), Executioner is unchanged (it runs first, in `~relic_execute`).

## Tests (`tests/relic-glass-cannon.test.ts`, own file: in `relic-combat.test.ts` the extra ticks shifted the world clock and made the timing-sensitive Executioner test hit "I'm already under attack!")
1. `relic_glass_extra` with 0% queues nothing; with 100% it stops at exactly 10 hitsplats, each within `0..max`, and the npc loses hitpoints.
2. 600 `npc_max_dealt` calls: no extras without the relic; with it between 120 and 290 extras (expected about 200).
3. Extras credit attack XP and hero points.
The Vampire real-melee test was changed: it used to infer hits from per-tick hitpoint changes, which merge with extra hitsplats, so it now records each applied hitsplat (`spyHits`).

## Not checked
Real client rendering of the extra hitsplats, ranged/magic timing against real projectiles, special attacks and the cannon (they call `npc_max_dealt`, so they roll extras; not tested), balance. See open question 136.

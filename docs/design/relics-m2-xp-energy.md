# Relic mode M2: XP factor and run energy hooks (observed)

**Question answered:** do the two Engine hooks give 8x/16x/32x/64x XP and non-draining run energy?

**Based on:** Engine-TS `relic-mode` `8c4fa9ca` (base `1d25566`), Content `relic-mode` (base `65b754f`), root as pushed. **Method:** ran the server and a headless client (`scripts/headless-client.mjs`) on Linux, node 24.21.0.

## Findings
1. **XP.** `Player.addXp` multiplies `xp` by `Environment.node.xpRate` (`Engine-TS/src/engine/entity/Player.ts:1831`, hooked). With `node.xpRate = 8` in `world.json` and `::~relic_setxp <tier>` setting `%relic_xp_tier` and `%relic_xp_factor = pow(2, tier)` (`mods/relics/scripts/relic_state.rs2`), `stat_advance(fletching, 1000)` took the fletching base level 1 to 7, 14, 21, 28 at tiers 0 to 3 (cumulative). Computed from the standard level formula, 800, 2400, 5600 and 12000 real XP give levels 7, 14, 21, 28, which matches 8x, 16x, 32x, 64x **if `stat_advance`'s argument is in tenths of XP** (the stats array is stored x10: `Player.ts` cap comment). A factor of 0 (new player, varp unset) behaves as 1 because of `max(1, ...)`.
2. **`node.xpRate` is set through `Engine-TS/data/config/world.json`** (not a process env var): observed taking effect (8x base). Answers the config part of Q69.
3. **Run energy.** After enabling Run and running about 15 tiles by minimap clicks, `runenergy` stayed 10000 (read with `::~relic_energy`). Not compared against an unhooked baseline in this run (inference: without the hook each running step costs at least 67 per `updateEnergy`, `Player.ts:711-713`).
4. **Level-up shows a chatbox dialog** ("Click here to continue", client px about 286,440) that blocks further `::` commands until clicked; the headless tests must click it. Relevant to M4 (jingle/celebration overlap).
5. **Server pack on start:** a restart did not repack changed `mods/` files by itself (the new debugprocs did not exist until `::rebuild`); after `::rebuild`, restart or relog is still needed for new varps (M1 finding 3).

## Not checked
Other `addXp` callers with `allowMulti=false`; the cap logic at `Player.ts:1834-1836` with a 64x factor (not reached).

**Update (2026-10-10):** now covered by automated end-to-end tests; see [relics-e2e-tests.md](relics-e2e-tests.md) for what is verified, the bugs fixed and what is still untested.

## Update 2026-10-11: 10x base, x3 per tier

Calum changed the numbers: base `node.xpRate` is now **10** (`config/world.json`, `^relic_base_xp = 10` in `mods/relics/configs/relic.constant`) and each XP Multiplier tier multiplies by **3** (`%relic_xp_factor = pow(3, %relic_xp_tier)` in `mods/relics/scripts/relic_state.rs2`; the menu figure `relic_xp_rate` in `relic_menus.rs2` uses `pow(3, $tier)`). Overall rates: 10x, 30x, 90x, 270x (factor 1, 3, 9, 27). The engine hook (`Player.ts:1831`) is unchanged. The sections above describe the earlier 8x/2x numbers.

Existing characters keep their stored `relic_xp_factor` (1, 2, 4 or 8) until it is recomputed (the next XP Multiplier pick or `::~relic_setxp`); `::~relic_reset` and `::~relic_setxp N` recompute it. Tests changed: `relics`, `relic-levelup`, `relic-menus`, `relic-offers` (all updated first and failing on the old values). Run: 171 individual tests pass; the 14 failures are the known file-level worker-load errors, one per file.

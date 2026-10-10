# M6: death stash and Relic Keeper

**Question:** how do relic items (jewellery, Last Recall stone, Banker stone) survive death, and how does a player recover a lost one?
**Based on:** Content `73546549b` (branch `relic-mode`), Engine-TS `8c4fa9ca`, root repo at the commit that adds this file. Method: written, compiled and **run in game** with the headless client (`scripts/headless-client.mjs`).

## Findings

- **Hook:** one line `~relic_stash_items; // relic hook` in `Content/scripts/player/scripts/death.rs2:55`, directly after `inv_clear(deathkeep);` in `[proc,player_death_lose_items]` (so it runs before the drops are decided). Listed in `docs/local-changes.md`.
- **Mod code:** `mods/relics/scripts/relic_death.rs2`. `relic_item_relic` maps an exact object to the owning relic (16 ring_of_dueling_8, amulet_of_glory_4, necklace_of_minigames_8; 17 recall stone; 18 banker stone). `relic_stash_inv` loops the slots of `inv` and `worn` and does `inv_moveitem($from, bank, ...)`; it warns if the slot is still occupied (bank full).
- **Observed (death by `::~relic_hit 99`):** with 2 of each relic item in the inventory (a test artefact: the debug grant was run twice), all of them ended up in the bank and the inventory was empty after respawn at Lumbridge.
- **Relic Keeper:** NPC `relic_keeper` (`mods/relics/configs/relic_keeper.npc`), spawned by `~relic_ensure_keeper` on login (called from `relic_on_login`) with `npc_add(..., relic_keeper, 2000000000)` only if `npc_find(0_50_50_21_18, relic_keeper, 20, 0)` finds none. `[opnpc1,relic_keeper]` re-issues each relic item the player owns the relic for and has nowhere (inv, worn or bank).
- **Observed (keeper):** after `::~relic_lose` (deletes all relic items from inv and bank), talking once gave 1 stone, 1 banker stone and the three jewellery items; talking again gave nothing more (counts stayed 1).
- **Observed (keepers):** after a server restart and one login, `::~relic_keepers` (count within 60 tiles of Lumbridge) printed 1.
- **Q79 partly answered:** `npc_add` with duration 2000000000 worked for the session here, and the keeper was still talkable minutes later. New npc ids are appended to the tracked `Content/pack/npc.pack` by `scripts/sync-mods.mjs` (`1359=relic_keeper`, Content `73546549b`).
- **Gotcha:** `inv_total(...) + inv_total(...) > 0` inside `if (...)` is a syntax error; wrap the sum in `calc(...)`.
- New debug procs in `relic_debug.rs2`: `relic_where`, `relic_lose`, `relic_talk` (`p_opnpc(1)` on the nearest keeper), `relic_keepers`.

## Not checked
- Repeated logins from far away (the second login in my driver did not run, so only "one login, one keeper" is verified). The guard `npc_find ... 20` is read, not stress-tested; a keeper that wanders more than 20 tiles from the spawn could be duplicated (inference).
- Keeper surviving a long uptime or area unload (only minutes observed).
- PvP death and the `player_death_lose_items` early return for staff (`staffmodlevel > 1 & map_live`): not hooked or tested.
- Items lying in a trade, duel stake or the death-keep slots; bank-full path (warning text only seen as a false positive before the fix).

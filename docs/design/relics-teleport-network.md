# Teleport Network (relic 24) and the removal of Infinite Runes (relic 15)

**Question:** how does the Teleport Network relic work, and what happened to relic 15 and the characters that owned it?
**Based on (2026-10-11):** root `ebe235c` plus this work; Content `34a8a0397` then `5931e56d9`; Client-TS `2ea4280` then `cd03818`; Engine-TS `04db3dc2` (unchanged). Method: written and **run** in the headless harness (Node 24.11.1).

## Teleport Network
- Granting relic 24 (`~relic_grant`, `mods/relics/scripts/relic_offer.rs2`) puts a **Network stone** (`relic_network_stone`, `relic_items.obj`, op "Teleport") in the backpack, or the bank if it is full, like the Recall and Banker's stones.
- `[opheld1,relic_network_stone]` (`relic_effects.rs2`) opens the main interface `relic_teleportmenu` (`mods/relics/interfaces/relic_teleportmenu.if`): nine text buttons. Each `[if_button,relic_teleportmenu:<city>]` calls `~relic_network_go(coord)`, which runs the same `~pre_tele_checks` and `~player_teleport_normal` the spells use (`Content/scripts/skill_magic/scripts/spells/teleport.rs2`). So Tutorial Island, wilderness and similar teleport rules still apply, and the Last Recall origin is recorded.
- No runes, no XP.
- Destinations: Lumbridge, Varrock, Falador, Camelot, Ardougne are the `tele_coord` of the teleport spells (`magic_spells.dbrow`); Edgeville, Draynor Village, Al Kharid, Karamja are the glory amulet's coordinates (`amulet_of_glory.rs2:32-35`). Exact tiles, not the spells' radius-2 search.
- Death: the stone is stashed in the bank like the other relic items and re-issued by the Relic Keeper (`relic_death.rs2`).
- Tests: `tests/relic-teleport-network.test.ts` (each city), `tests/relic-death-win.test.ts` (stash, keeper).

## Infinite Runes removed
- Name, description and pool entry deleted; `~relic_exists` (relic_offer.rs2) returns 0 for id 15 (and the reserved ids 20 to 23 until the work packages that add them remove them from that proc), so it is never offered. Bit 15 of `%relic_owned` is never reused.
- Server: `~relic_rune_count` (hook in `magic.rs2`, Content `30ede1e59`) now returns its input unchanged. The hook line stays in Content so another magic relic can use it.
- Client: Client-TS `a822635` reverted (`cd03818`); `relic_owned` lost `transmit=yes` and `clientcode=100` in `relic.varp`.
- **Existing owners (default chosen, not asked):** on login `~relic_on_login` clears bit 15 (and its declined bit), adds 1 to `%relic_pending`, and says "The Infinite Runes relic has been retired. You have a new relic choice instead." The normal pending-offer path then opens a choice. Tested for one and for repeated logins (no second offer).
- Relic ids now in use: 1 to 14, 16 to 19, 24. Pool and menu loops run to 24. The relic menu still has 19 rows each, which fits exactly because 15 is gone.

## Not checked
- A real browser: the city list drawing and the magic tab after the client revert (not covered by the harness).
- `Engine-TS/public/client/client.js` (prebuilt) does not contain the removed flag (`grep -c relicFreeRunes` gave 0), so no rebuild was needed. Players need `mise run client:build` only if their own build predates the revert.

# Relic 21 Rune Wellspring

**Question it answers:** how does the Rune Wellspring relic work, and which defaults were chosen?
**Commits:** root on `ebe235c` + this change; Engine-TS `e45392c4`; Content `42043c0af` and `e7320ff30`. **Method:** code written and read, headless tests run on Node 24.11.1 (`tests/relic-wellspring.test.ts`, 13 tests). Not seen in a real client.

## Behaviour (player view)
- **XP becomes bundles.** Every XP gain in any skill except Runecrafting adds *Rune essence bundles* (stackable, 100 essence each): 1 bundle per 100 XP gained. The XP counted is what the player sees (after the engine XP rate and the XP Multiplier relic). Bundles go to the backpack, or the bank if the backpack cannot take them. A remainder carries over (and is saved with the character).
- **Bundle on an altar.** Using bundles on a runecrafting altar crafts every bundle in the backpack (up to 10,000 per use) at once: 100 essence each, same level check, runes per essence and XP as normal crafting. The crafting XP does not pay new bundles.
- **Talisman Locate.** With the relic, the *Locate* op of any talisman (instead of the compass hint) opens a list of the 11 altars; a row teleports next to that altar (same place as holding its talisman to the ruins), with the normal teleport checks and a members-world check for members altars.

- **Talisman granted.** Taking the relic also gives a *Wellspring talisman* (`relic_wellspring_talisman`, option "Altars") that opens the altar list at once, so no real talisman is needed. It is a relic item like the Recall stone: moved to the bank on death and re-issued by the Relic Keeper (`relic_death.rs2`). Tests: grant, option and Keeper in `tests/relic-wellspring.test.ts`, death in `tests/relic-death-win.test.ts`.

## Mechanism
- Engine hook `Player.relicWellspring` (called from `Player.addXp` right after `this.stats[stat] += xp * multi`): if bit 21 of `%relic_owned` is set and the stat is not Runecrafting, it adds the gained tenths to perm varp `relic_wellspring_xp` and puts `[queue,relic_wellspring]` on the engine queue (once; the engine queue waits until the player can be accessed).
- `[proc,relic_wellspring_claim]` (`mods/relics/scripts/relic_wellspring.rs2`) pays `owed / ^relic_wellspring_xp_per_bundle` bundles (constant 1000 tenths = 100 XP in `relic_wellspring.constant`). If neither backpack nor bank has room the XP stays owed.
- Content `skill_runecraft/scripts/runecraft.rs2`: one `case relic_essence_bundle : ~relic_wellspring_craft;` in `[oplocu,_rc_altar]`, and a 3-line early return in `[opheld4,_talismans]` and `[opheld4,cosmic_talisman]`.
- Interface `mods/relics/interfaces/relic_altarmenu.if` (11 button rows, enum `relic_altar_rows`), rows call `~relic_altar_go(type)` with `runecraft_table` type 1 to 11.

## Defaults chosen (Calum can change these)
- Runecrafting XP excluded, otherwise bundles would pay for more bundles without end.
- XP counted after the multipliers (the number on the XP drop). At 270x a single ore gives many bundles; to count base XP instead, change the hook. `^relic_wellspring_xp_per_bundle` tunes the rate.
- A used stack crafts all bundles, not one.
- Teleport goes inside the temple (the `enter_coord` of the runecraft table), not to the outside ruins.
- Relic bit 21 fits the owned bitmask (bits to 30 are fine in a 32-bit int; answers the brief's open question for this relic).

## Not done here (other work packages)
Offer pool and relic menu loops still run to 19, so the relic cannot be offered yet; all-relics task test and player-guide wording are with the pool work. Name and one-line description for id 21 are in `relic_offer.rs2`.

## Not checked
Real client display of the bundle and of the altar list; all 11 altars teleport (only air and mind tested; chaos `enter_coord` begins `3_` and death's equals `0_50_50_21_18` in the Content table, read, not investigated); members worlds.

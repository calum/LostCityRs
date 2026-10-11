# Relics 22 Archmage and 23 Endless Quiver

Question: how are the two combat-route relics from the skilling and route relics brief ([skilling-relics-brief.md](skilling-relics-brief.md)) built, and how do they behave?

Based on: root `ebe235c` plus this work, Content `24a48c50a` (hooks) on top of `e7320ff30`. Method: read the scripts, then wrote `tests/relic-archmage-quiver.test.ts` first (8 of 10 tests failed for the expected reasons: missing procs, wrong accuracy arity, arrows still used), implemented, and ran the whole suite on Node 24.11.1: 261/261 pass (after rebasing onto Rune Wellspring and the skilling tasks), `tsc -p harness/tsconfig.json` clean. Not run in a real client.

## Findings

- The engine already has an autocast loop: `[proc,pvm_spell_cast]` ends with `p_opnpct(<autocast spell component>)` when autocast is on and the spell has `continue_by_autocast` (`Content/scripts/skill_combat/scripts/player/player_magic.rs2`, end of `pvm_spell_cast`). Archmage reuses that for a manual cast: an `else if (~relic_keep_casting($spell_data))` branch re-issues `p_opnpct` with the same spell's component. The same `continue_by_autocast` flag decides which spells repeat (damage spells and Crumble Undead; freezes and stat drains do not). The loop ends when the player clicks or walks elsewhere (the interaction is replaced), or `check_spell_requirements` fails (no runes). Tests: repeats 30 casts exactly 3 ticks apart; stops after walking; stops with the "not enough runes" message.
- Spell damage: `~relic_spell_maxhit` doubles `[proc,magic_spell_maxhit]` (`pvp_magic.rs2`) when positive; a null max hit (-1) is left alone. Cast delay: `~relic_cast_delay(5)` gives 3 ticks (rounded up), then Quickstrike's `~relic_delay` applies to that (5 -> 3 -> 2 with both).
- Free cast: `~relic_free_cast` at the top of `delete_spell_runes` (`magic.rs2`), so it applies to every spell that deletes runes (combat, teleport, alchemy, enchant, superheat), 50% each cast. The rune check before the cast still needs the runes. Test: over 30 casts runes used is more than 0 and fewer than 30.
- Endless Quiver: `~relic_keep_ammo` returns early from `ranged_dropammo_npc` (`player_ranged.rs2`), the only place ammo is deleted or dropped on the NPC path, so bows, crossbows and thrown weapons keep their ammo. `~relic_ranged_maxhit` scales `%com_maxhit` by 150/100 (the holy water branch still scales the unboosted value). `~relic_accuracy` now takes the damage type and adds +50% for ranged (`^ranged_style = 3`) when relic 23 is owned, additive with combat relics 3-9 (so Endless Quiver plus Stoneskin is x2 for ranged, x1.5 for melee).

## Choices made (defaults, tell Calum if wrong)

- Archmage's free cast covers all spells, not only combat spells.
- Endless Quiver's accuracy bonus is ranged only, not all styles.
- Names and one-line descriptions added to `relic_name`/`relic_desc` (`relic_offer.rs2`).

## Not checked / open

See open questions 111 (PvP) and 112 (offer pool, real client). Both relics work through `relic_grant` but are **not offered yet**: ids 22 and 23 stay reserved in `relic_exists`, because enabling them overflowed the 19-row relic menu enums and changed the seeded draws that `tests/relic-offers.test.ts` pins (21 tests failed). The offer pool work package must raise the menu rows, update those tests and drop 22 and 23 from the reserved list. Player guide rows are held back until they are offered; wording to paste into `docs/guide/relic-mode-player-guide.md` then:

| 22 | Archmage | Your spells hit **twice as hard** and cast in about **half the time**. About half of all casts use **no runes** (you still need the runes in your backpack). After you cast a damage spell (strikes, bolts, blasts, waves, Crumble Undead) at a monster, you **keep casting the same spell** at it until you walk away, click something else, or run out of runes. Freezing and stat-lowering spells are cast once. | automatic |
| 23 | Endless Quiver | Arrows, bolts and thrown weapons are **never used up** and never fall on the floor. Ranged attacks are **+50% accurate** and hit **+50% harder**. | automatic |
 The ranged max hit hook is tested through the proc, not by measuring real shots. Testing note: auto-retaliate is switched off in the tests (`option_nodef = 1`), otherwise the monster's hits make the bot melee back and replace the cast.

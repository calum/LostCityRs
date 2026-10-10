# Relic mode M5: the easy relics (observed)

**Question answered:** do the easy relics work in game, and what did they teach about hooks and mod items?

**Based on:** Content `relic-mode` `6c7b18fe4` (base `65b754f`), Engine-TS `relic-mode` `8c4fa9ca`. **Method:** ran the server and the headless client; debug procs from `mods/relics/scripts/relic_debug.rs2` (`::~relic_hit n`, `::~relic_cast`, `::~relic_kill npc`, `::~relic_grant id`). Effects live in `mods/relics/scripts/relic_effects.rs2`; hooks are listed in `docs/local-changes.md`.

## Observed results
| Relic | Result |
|---|---|
| 3 Stoneskin, 5 Glass Cannon (taken) | a 10 damage hit took 10 HP baseline, 5 with Stoneskin (`(a+1)/2`), 8 with both (`(a*3+1)/2` on the halved value) |
| 6 Phoenix | HP 10, a 50 damage hit left 1 HP and printed the save message; a second 50 hit inside the window brought HP to 0 (window is 500 ticks, `%relic_phoenix_until`, a `protect=no` varp) |
| 7 Vampire | after a kill, HP rose by 6 at base HP 50 (`stat_heal(hitpoints, 1, 10)`) |
| 9 Bounty | a coin pile and an item appeared on the ground after a kill (screenshot); amounts by `npc_basestat(hitpoints)` not read back |
| 15 Infinite Runes | `::~relic_cast` (Varrock Teleport label) said "You do not have enough Fire Runes" without the relic and teleported with it, with no runes in the inventory. Combat spells and alchemy use the same `staff_runes` (`magic.rs2:32,78,97`) but were not cast |
| 16 Everlasting Jewellery | the three items are granted to the inventory (bank if full); rubbing the Ring of dueling teleported to the Duel Arena and the item stayed `(8)` |
| 17 Last Recall | after a Varrock Teleport from Lumbridge, using the Recall stone returned the player to Lumbridge (origin recorded by the `pre_tele_checks` hook). A second use (back again) not run |
| 18 Banker's Call | the Banker's stone (a mod `.obj`) opened the bank on its first left-click op |
| 19 Hoarder | granting Hoarder opened a second dialog listing earlier declined relics (inferred from the three names; the test sequence was disturbed by pending task offers) |
| 5 Glass Cannon (dealt), 14 Philosopher's Coin, 8 Executioner | hook compiles and reloads; **not exercised in game** |

## What it taught
1. **Mod objects work.** `mods/relics/configs/relic_items.obj` loads; model reuse (`model=inv_lawrune`), `iop1=Recall` and `[opheld1,relic_recall_stone]` all work, the icon shows in the inventory, and the item shows "Recall"/"Open bank" as the first op. New objs need `Content/pack/obj.pack` ids (tracked file; committed on `relic-mode`).
2. **Type rule (compiler):** a proc cannot turn an `obj` (such as `last_item`) into the `namedobj` that `oc_param(..., next_obj_stage)` yields, so the jewellery hook became "skip the swap with an early return" rather than a changed value.
3. **Hook placement:** the first run compiled the Content hook lines before the mod procs existed, so the engine printed `'~relic_dealt' cannot be resolved to a proc` once; a second pack after the mod files synced was clean. Sync mods before touching hooks.
4. **`protect=no`** on a varp (as in `Content/scripts/interface_controls/configs/player_controls.varp:2`) lets any script write it, which `relic_phoenix_until` and `relic_recall_a` need because `damage_self` and `pre_tele_checks` can run without protected access. `type=coord` varp works for the recall origin.
5. The magic spellbook is hard to drive blind from the headless client (greyed icons, no labels); `::~relic_cast` calls `@magic_teleport(^varrock_teleport)` instead.
6. The staff-runes hook is two lines (`magic.rs2:65` is the members-staff early return).

## Not checked
Dealt damage doubling, alch payout, combat spell rune use, recall ping-pong, jewellery bank gift when the inventory is full, the amulet of glory and games necklace (same code shape as the ring, only the ring was rubbed).

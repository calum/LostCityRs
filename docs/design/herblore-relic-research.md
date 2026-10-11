# Herblore: where herbs and secondaries come from, and a relic proposal

**Question it answers:** how does a player obtain herbs and potion secondaries in this content set, and what herblore relic and tasks would fit?
**Commits:** root `efbe8e9`; Content `9a5b2466a`; Engine-TS `82f83af0`. **Method:** code and data files read, plus a script that listed ground spawns from `Content/maps/*.jm2`. Nothing was run in a client or the harness. The relic section is the proposal; it was built afterwards as relic 20 (id 20, not 31) with tasks 43-45, see [relics-green-thumb.md](relics-green-thumb.md).

## Findings: herbs

1. **Herbs arrive unidentified and need a click.** Drops are `unidentified_*` items with op "Identify" (`Content/scripts/skill_herblore/configs/identifying/unids.obj`). `[proc,attempt_identify_herb]` requires members (`identify.rs2:59-62`) and `stat(herblore) >= identified_herb_level` (`identify.rs2:66-72`); `~identify_herb` swaps the item and gives XP (`herblore.rs2:1-7`, `stat_advance(herblore, $experience)`). Identify levels (`herbs.obj`, `param=identified_herb_level`): guam 3 (the param default, `identify.param:3`), marentill 5, tarromin 11, harralander 20, ranarr 25, toadflax 30, irit 40, avantoe 48, kwuarm 54, snapdragon 59, cadantine 65, lantadyme 67, dwarf weed 70, torstol 75.
2. **The only generic herb source is monster drops via one shared table.** `[proc,randomherb]` (`drop tables/scripts/shared_droptables.rs2:2-34`) rolls `random(128)`: guam 32/128, marentill 24, tarromin 18, harralander 14, ranarr 11, irit 8, avantoe 6, kwuarm 5, cadantine 4, lantadyme 3, dwarf weed 3. **Torstol, toadflax and snapdragon are not in it**, and a search of the `.rs2` files found no other source for them (only cheats, Trufitus and the herblore scripts). Grep `~randomherb` finds it in about 55 files: man, goblin, hobgoblin, farmer, giants, dragons, demons, druids, zombies, skeletons and others (e.g. `man.rs2:44`, `goblin.rs2:107`, `farmer.rs2:29`). The dryad woodcutting random event also drops it (`macro_event_dryad.rs2:55`; random events are currently off via `^macro_events_enabled = 0`) and Sanfew swaps goutweed for random herbs (`sanfew.rs2:172`).
3. **Tribesmen and jogres drop snake weed / rogue's purse** (`tribesman.rs2:28-30`, `jogre.rs2:48-50`). Those are the quest herbs (Trufitus, `trufitus.rs2`).
4. **One ground herb spawn in the whole map**: one `unidentified_guam` at x 3044 z 10313 (found with the spawn-listing script; levelled map squares were decoded to absolute coordinates).
5. **No shop sells herbs** (grep of every `.inv` for herb stock names found only the skill-guide display lists, `player/configs/skill_guide.inv`).
6. **No farming skill exists in this content set**: there is no `skill_farming` folder under `Content/scripts`; the only "farming" hits are a comment in `drop tables/scripts/farmer.rs2:11` ("Entire drop table structure changed on Farming release") and quest/display files. A dryad comment says snapdragon and toadflax "didnt exist in 2004" (`macro_event_dryad.rs2:50`).

## Findings: secondaries

| Secondary | How obtained (verified) |
|---|---|
| Eye of newt | Shops: Jatix (`taverly.inv:26-28`), Yanille/Gutanoth (`gutanoth.inv:27-29`), Entrana (`entrana.inv:9-11`), Port Sarim (`port_sarim.inv:50`); drops from zombie, ghast, Canifis citizen, Viking citizen |
| Limpwurt root | Drops only: tribesman, chaos druid warrior, giant, druid, hobgoblin, Canifis citizen, others (`tribesman.rs2:38`, `giant.rs2:52`, `druid.rs2:44`, `hobgoblin.rs2:64`) |
| Red spiders' eggs | **Ground spawns only**: 15 tiles (cluster near x 2336-2346 z 3309-3316; z 9948-9958 underground; two near x 3177 z 9880) and no NPC drop (grep of `obj_add` found none) |
| Snape grass | 3 ground tiles (x 2906-2917 z 3274-3297) plus drops (chaos druids, tribesman, Salarin, citizens) |
| White berries | 3 ground tiles (x 2262 z 3168; x 3214-3218 z 3809-3814) plus drops (chaos druid warrior, Salarin, Canifis citizen) |
| Unicorn horn (then grind) | Unicorn drop (`unicorn.rs2:11`), ground with pestle and mortar (`grind_ingredient.rs2`) |
| Wine of Zamorak | 1 ground tile (x 2930 z 3515); Canifis citizen drop (`canafis_citizen.rs2:69`) |
| Jangerberries | 4 ground tiles (x 2510-2517 z 3080-3090); drops from citizens |
| Toad's legs | Gnome swamp toad, `swamp_toad.rs2:3` |
| Chocolate dust | Gnome bar and restaurant give chocolate bars (`gnome_bar.rs2:105`, `gnome_restaurant.rs2:49`) |
| Vials | Empty vials: Jatix and several shops (`taverly.inv:26`, others); water vials: shops (`ardougne_east.inv:65`) and fountains (`water_sources.rs2`, not read in detail) |

Not checked: dragon scale dust, ashes beyond the few drops found, mort myre mushroom, potato cactus, blamish slime sources; Betty's (Port Sarim) stock beyond the one line.

## Findings: brewing and boosts

- Finishing a potion is `[proc,brew_potion]` (`herblore.rs2:9-29`): `inv_del(inv, $ingredient, 1)` and `inv_del(inv, $solvent, 1)` (lines 11-12), then adds the 3-dose item (`brew_potion.rs2` passes `brew_potion_mixture`; e.g. struct `3dose1strength` -> `Strength potion(3)`, `brew_potion.struct:108-114`). 4-dose objects exist (`potions.obj:1`, `[strength4]`) but brewing yields 3 doses. `~relic_task_obj($mixture)` is already called there (`herblore.rs2:14`), so a potion task needs only a table row.
- The same proc makes the unfinished potion (herb + vial of water, e.g. `[unf_guam_potion]`, `brew_potion.struct:1-5`), so "never consume the secondary" must still consume the herb in that step. How to tell the two apart (herb category 774, `herbs.obj:36` `category=category_774`) is an inference, not tested.
- **Boost decay is a timer**: `[timer,stat_boost_restore]` (`player/scripts/stat.rs2:45-56`) subtracts 1 from any stat whose level exceeds its base (not prayer or hitpoints). `login.rs2:36` starts it with `settimer(stat_boost_restore, 100)`. Boost reset on login only happens on non-members worlds (`stat.rs2:121-123`). Potions apply boosts with `stat_boost` (`consume_effects.rs2:65`). Same timer also decays Kebab, keg, spec-attack and chalice boosts.
- Existing task 12 is "Make a super attack potion" (`relic_menus.rs2:42`, `relic_tasks.dbrow:153-154`, `3dose2attack`).
- XP gains can be hooked at one place: `Player.addXp` calls `relicWellspring(stat, xp * multi)` after the XP is added (`Player.ts:1835`, hook body `:1896-1910`); runecrafting is excluded to avoid a feedback loop.

## Proposal: relic 31 "Herbalist's Satchel" (name open)

Id 31 is free (owned bitmask is 32-bit; 20 was never used and is also free). Pool would be 28 relics.

Calum's three ideas, refined:

1. **Boosts never drain.** Early return at the top of `[timer,stat_boost_restore]` when the relic is owned. Strong: one super combat potion is a permanent buff until combat drain or relog rules reset it. Also keeps kebab and spec-attack boosts; I would accept that. Open: does death reset boosts (not checked).
2. **Secondaries are never consumed.** In `[proc,brew_potion]` skip the `inv_del` of the secondary when the ingredient is not a herb. The herb, vial and unfinished potion are still consumed. This is the biggest upgrade because red spiders' eggs (15 ground tiles, no drops), snape grass and white berries are the real bottlenecks.
3. **XP chance of a cleanable herb.** Reuse the Wellspring accumulator: every N XP gained (in any skill except Herblore, to avoid the clean-herb XP loop) rolls one herb from the `randomherb` weights, filtered to herbs whose identify level is at most the player's Herblore level, delivered **already identified** (saves the click; the identify XP is lost, which is small). Because XP is multiplied up to 270x, the roll should be per N XP (like bundles), not per XP event, or fast skills would flood the bank. Torstol, snapdragon and toadflax are in no drop table, so the relic could add them at high level (my suggestion, Calum to decide).

Further ideas from the research:

4. **Starter secondaries.** Taking the relic grants one of each secondary once (the bottleneck is finding the first copy; with idea 2 it is then permanent). Cheap and removes the egg hunt.
5. **Full doses.** Brewed potions come out as 4-dose (`strength4`-style objects exist). +33% per brew, with no new items.
6. **Free vial.** Finishing a potion returns an empty vial or the vial of water is not consumed for the unfinished step; small quality-of-life idea, lowest value.
7. **Herb XP bonus.** Identifying gives double Herblore XP (herb XP is tiny next to potion XP; probably not worth a line).

I would build 1, 2, 3 and 4 as one relic, and treat 5 as optional. Not tested: strength of the combination. Hook cost: 2 Content lines (stat.rs2, herblore.rs2), 1 Engine hook (copy of `relicWellspring`) or a reuse of it, plus the usual offer-table, menu and description lines.

## Proposed herblore tasks (one line each; numbers would start at 43 in the second task varp)

- Make a prayer potion (snape grass + ranarr vial, level 38; only a table row, hook exists).
- Make a super strength potion (limpwurt + kwuarm vial, level 55).
- Make a super defence potion (white berries + cadantine vial, level 66).
- Make a ranging potion (wine of Zamorak + dwarf weed vial, level 72).
- Clean a dwarf weed (needs one new hook in `[proc,identify_herb]`, `herblore.rs2:1`).

Avoid tasks needing toadflax, snapdragon or torstol (super restore, agility, Zamorak brew): not obtainable without the relic. The task menu has fixed rows (`relic_task_count = 42`, `relic.constant`), so each new task also needs a pack id and an interface row (as for tasks 32-39, `docs/local-changes.md`).

## Open questions
- Does death clear stat boosts (matters for idea 1)? Not checked.
- Dragon scale dust, ashes, mort myre mushroom, potato cactus sources not traced.

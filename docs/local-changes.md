# Local changes to upstream code (relic mode)

Hooks live on `main` of each fork (fast-forwarded from the former `relic-mode` branch, which is kept; it branched from the pinned upstream commit), one commit per hook, so `git log 274..main` in the submodule lists them. Check with `mise run relics:hooks` (it must list exactly the lines below). Logic lives in `mods/relics/`.

**Based on:** Engine-TS base `1d25566`, Content base `65b754f`.

| Milestone | Repo | File:line | One-line change | Commit |
|---|---|---|---|---|
| M2 | Engine-TS | `src/engine/entity/Player.ts:1831` (`addXp`) | XP multiplier becomes `xpRate * max(1, %relic_xp_factor)` | `f959ad04` |
| Quest Pass | Engine-TS | `src/engine/entity/Player.ts` (`addXp`, `multi`) | whole multiplier (xpRate and factor) is 1 while temp varp `relic_quest_xp_off` is set (set by `[queue,relic_quest_pass]` in `mods/relics/scripts/relic_offer.rs2`, cleared by `relic_quest_pass_end` once `viking_quest_complete`, the last queued quest, has run) | `90baf22c`, `f6f52c47` |
| M2 | Engine-TS | `src/engine/entity/Player.ts:76,706` (`updateEnergy`) | `RELIC_UNLIMITED_RUN` constant makes the recovery branch always run, so run energy never drains | `8c4fa9ca` |
| M3 | Content | `scripts/skill_combat/scripts/npc/npc_death.rs2:11` (first line of `[proc,npc_death]`) | `~relic_on_kill; // relic hook` | `5321d0828` |
| M4 | Content | `scripts/login_logout/login.rs2` (after `queue(macro_event_login, 0, 0);`) | `~relic_on_login; // relic hook` | `f249435bb` |
| M4 | Content | `scripts/tutorial/scripts/tutorial.rs2` (end of `[label,tutorial_complete]`) | `~relic_first_offer; // relic hook` | `0df341314` |
| M5 | Content | `scripts/player/scripts/damage.rs2:6` (`damage_self`) | `$amount = ~relic_damage_taken($amount); // relic hook` | `3c261fc97` |
| M5 | Content | `scripts/skill_combat/scripts/npc/npc_combat.rs2:428` (`npc_max_dealt`, last return) | return value wrapped in `~relic_dealt(...)` | `ec59fab1d` |
| M5 | Content | `scripts/skill_magic/scripts/spells/alchemy.rs2:25,61` | `$profit` wrapped in `~relic_alch_profit(...)` (2 lines) | `2f51e8084` |
| M5 | Content | `scripts/skill_magic/scripts/magic.rs2:65,88` (`staff_runes`, both returns) | rune counts wrapped in `~relic_rune_count(...)`. Since 2026-10-11 the proc returns its argument unchanged (Infinite Runes retired); the hook is kept for a future magic relic | `30ede1e59` |
| M5 | Content | `.../enchanted_jewellry/ring_of_dueling.rs2:21` | 3-line `if (~relic_keep_charge = ^true) { return; }` before the charge swap | `3251ccafb` |
| M5 | Content | `.../enchanted_jewellry/necklace_of_minigames.rs2:21` | same | `a67cacfab` |
| M5 | Content | `.../enchanted_jewellry/amulet_of_glory.rs2:37` | same | `a995d118b` |
| e2e | Content | `.../enchanted_jewellry/amulet_of_glory.rs2:28-30` | `mes($message)` wrapped in `if (~relic_keep_charge = ^false)`, so no "charges left" message when the charge is kept (on fork `main`, also pushed to `relic-mode`) | `0bd36bfa3` |
| M5 | Content | `scripts/skill_magic/scripts/spells/teleport.rs2:127` (end of `pre_tele_checks`) | `~relic_record_origin($coord); // relic hook` | `c80daec05` |
| M6 | Content | `scripts/player/scripts/death.rs2:55` (`player_death_lose_items`, after `inv_clear(deathkeep);`) | `~relic_stash_items; // relic hook` | `d6197b655` |
| M6 | Content | `pack/npc.pack` | pack id `1359=relic_keeper` | `73546549b` |
| M7 | Content | `skill_mining/scripts/mining.rs2` (full-inventory checks x2, `loc_change` x3, `inv_add` x2) | `~relic_gathered` (since 2026-10-11 its result multiplies the mining XP), `~relic_loc_change`, `& ~relic_has(10) = 0` | `e2c977f8f` |
| M7 | Content | `skill_woodcutting/scripts/woodcut.rs2` (`inv_add`, deplete `if`, full-inventory checks x2) | `~relic_gathered`, `& ~relic_has(11) = 0` | `10964ca66` |
| M7 | Content | `skill_fishing/scripts/fishing.rs2` (4 `inv_add`) | `~relic_gathered($fish, 0)` (since 2026-10-11: `~relic_fished($fish)`, XP multiplied by its result) | `728de3250` |
| M7 | Content | `skill_cooking/scripts/cooking.rs2` (success `inv_add`) | `~relic_gathered($cooked_item, 0)` | `70eb085cb` |
| M7 | Content | `skill_firemaking/scripts/firemaking.rs2` (`firemaking_success`) | `~relic_task_burn($log)` | `e355eb836` |
| M7 | Content | `skill_runecraft/scripts/runecraft.rs2`, `skill_fletching/scripts/bows.rs2`, `skill_smithing/scripts/smelting/smelting.rs2`, `skill_herblore/scripts/herblore.rs2` | one `~relic_task_obj(...)` line each before the product is added (bows: 4 lines) | `af18d03ab`, `cd85440fe`, `a397c341b`, `4fab3bc43` |
| M7 | Content | `skill_thieving/scripts/thieving.rs2:25` | `~relic_task_pickpocket;` after a successful pick | `a73458088` |
| M7 | Content | `skill_magic/scripts/spells/alchemy.rs2` (before `p_delay(3)` in the high alchemy label) | 4-line Midas Loop weak-queue block | `73acf4119` |
| M7 | Content | `player_melee.rs2`, `player_ranged.rs2`, `player_special_attack.rs2`, `player_magic.rs2` (`%action_delay` assignments) | `~relic_delay(...)` around the delay | `9d53fde13`, `94235d5e4`, `975ad0c7a`, `c8cff7b57` |
| M1-M5 | Content | `pack/varp.pack` | pack ids for mod varps (generated by `scripts/sync-mods.mjs`); more ids are added per milestone | `2b5ffe4a2`, `d4272af19`, `e2ea89e31`, `8140aedf1`, `6c7b18fe4`, later ids on `relic-mode` |
| menus | Content | `scripts/interface_options/interfaces/options.if`, `options_ld.if`, `pack/interface.pack`, `pack/interface.order`, `pack/varp.pack` | two text buttons (`relic_tasks`, `relic_relics`) at x=144 in the settings tab, their pack ids, and the `relic_hide_done` varp id | `d61913385` |
| vampire | Content | `scripts/skill_combat/scripts/combat.rs2:89` (first line of `[proc,give_combat_experience]`) | `~relic_vampire($damage); // relic hook`. Test: `tests/relic-combat.test.ts` (3 Vampire tests) | `316f314dc` |
| levelup | Content | `scripts/levelup/scripts/levelup.rs2` (`[label,levelup]`, after `mes($message);`) | `~relic_levelup_note; // relic hook` | `8535c3ee6` |
| random events | Content | `scripts/macro events/configs/macro_events.constant`, `scripts/macro events/scripts/macro_events.rs2` (`[proc,macro_event_allowed]`) | constant `^macro_events_enabled = 0` and an early `return(false)` when it is 0. Every spawn path (500-tick timer `general_macro_events`, skilling/teleport/cooking triggers, login re-spawn, `::~macro_event`, `::~random_event`) goes through `~macro_event_general_spawn`, which checks `~macro_event_allowed` first (`macro_events.rs2:26-29`). Set the constant to 1 to turn them back on. Test: `tests/random-events.test.ts` | `eb68f73f9` |
| second chance | Engine-TS | `src/engine/script/handlers/PlayerOps.ts` (`STAT_RANDOM`), `src/util/WorldConfig.ts` (`node.skillingSecondChance`, default `true`, also `NODE_SKILLING_SECOND_CHANCE` in the legacy `.env` migration) | when `stat_random` fails, roll again with a flat 50% chance. Only skilling content calls `stat_random` (grep of `Content/scripts`: agility, cooking, crafting, firemaking, fishing, mining, thieving, woodcutting, plus quests/minigames). Test: `tests/skilling-second-chance.test.ts` | `f8bd5427` |
| combat accuracy | Content | `scripts/skill_combat/scripts/player/player_combat.rs2` (`[proc,player_attack_roll_specific]`) | body moved to new `[proc,player_attack_roll_base]`; the original proc now returns `~relic_accuracy(~player_attack_roll_base($damagetype)); // relic hook`. `~relic_accuracy` (relic_effects.rs2) scales the roll by (100 + 50 x number of relics 3-9 owned) / 100. Test: `tests/relic-combat.test.ts` | `587852425` |
| skilling tasks | Content | `scripts/skill_smithing/scripts/smithing/smithing.rs2` (`[proc,smithing_anvil]`, before `inv_add`), `pack/interface.pack`, `pack/interface.order` | `~relic_task_obj($product); // relic hook` so anvil products count for tasks 28 and 29; pack ids for `relic_taskmenu:row_26..39`. Test: `tests/relic-skilling-task-flows.ts` | `d82f09706` (fork branch `skilling-tasks`, on top of `5931e56d9`; main carries the same change as `3051fc17e`) |
| task 40 | Content | `scripts/levelup/scripts/levelup.rs2` (`[label,levelup]`, after `~relic_levelup_note`), `pack/interface.pack`, `pack/interface.order` | `~relic_level99($level); // relic hook`; pack id for `relic_taskmenu:row_40`. Tests: `tests/relic-skilling-task-flows.ts` | `b2e1fefad` |
| extra tasks 32-39 | Content | `scripts/skill_fletching/scripts/darts.rs2`, `skill_crafting/scripts/gem/uncut_gem.rs2`, `skill_crafting/scripts/leather/leather.rs2` (dragonhide branch only), `skill_magic/scripts/spells/teleport.rs2` (`magic_teleport`, after `~give_spell_xp`), `skill_magic/scripts/spells/alchemy.rs2` (high alchemy, after `wealth_event`), `pack/interface.pack`, `pack/interface.order`, `pack/varp.pack` | `~relic_task_obj($product)` (darts, cut gem, dragonhide) and `~relic_task_spell($spell)` (teleports, high alchemy) `// relic hook`; pack ids for `relic_taskmenu:row_32..39` and the varp `relic_tasks_done2`. Test: `tests/relic-skilling-task-flows.ts` | `a699b3add` |
| Archmage | Content | `scripts/skill_combat/scripts/pvp/pvp_magic.rs2` (`[proc,magic_spell_maxhit]`, last return) | return value wrapped in `~relic_spell_maxhit(...)` (spell max hit x2; used by PvM and PvP spells). Test: `tests/relic-archmage-quiver.test.ts` | see `git -C Content log --grep Archmage` |
| Archmage | Content | `scripts/skill_combat/scripts/player/player_magic.rs2` (`[proc,pvm_spell_cast]`, `%action_delay` line) | `~relic_delay(5)` becomes `~relic_delay(~relic_cast_delay(5))` | see `git -C Content log --grep Archmage` |
| Archmage | Content | `player_magic.rs2` (`pvm_spell_cast`, end) | `else if (~relic_keep_casting($spell_data) = true) { p_opnpct(<this spell's spellcom>); }` after the autocast `p_opnpct` | same |
| Archmage | Content | `scripts/skill_magic/scripts/magic.rs2` (`[proc,delete_spell_runes]`, first lines) | `if (~relic_free_cast = ^true) { return; }` (50% of casts of any spell use no runes) | same |
| Endless Quiver | Content | `player_ranged.rs2` (`player_ranged_attack`) | `def_int $maxhit = ~relic_ranged_maxhit(%com_maxhit);` | `git -C Content log --grep "Endless Quiver"` |
| Endless Quiver | Content | `player_ranged.rs2` (`[proc,ranged_dropammo_npc]`, first lines) | `if (~relic_keep_ammo = ^true) { return; }` (no ammo deleted or dropped) | same |
| Endless Quiver | Content | `player_combat.rs2` (`[proc,player_attack_roll_specific]`) | `~relic_accuracy(roll)` becomes `~relic_accuracy(roll, $damagetype)`; ranged attacks get another +50% with relic 23 | same |

| Fellowship | Engine-TS | `src/engine/entity/Player.ts` (`addXp` 4th parameter `shared`, new `relicFellowship`, constants `RELIC_FELLOWSHIP_*`) | shares 50% of an owner's XP gain with players within 5 tiles. Test: `tests/relic-fellowship.test.ts` | `a5d259ac` |
| Fellowship glow | Engine-TS | `src/engine/entity/Player.ts` (`relicFellowshipGlow`, `relicGlowTick`, `RELIC_FELLOWSHIP_GLOW_TICKS`) | gold spotanim on a receiver of shared XP | `cfd025fe` |
| Fellowship glow | Content | `pack/spotanim.pack` | pack ids 313-314 | `589afed39` |
| Fellowship | Content | `scripts/player/scripts/consumption/effects/scripts/consume_effects.rs2` (`[proc,consume_effect_apply]`, after the stat-heal loop), `pack/interface.pack`, `pack/interface.order` | `~relic_fellowship_heal($hitpoints); // relic hook`; pack ids 11192-11193 for relic menu row 30 | `d1d052a46` |

Not a code hook: `config/world.json` (copied to `Engine-TS/data/config/world.json` by `mise run relics:config`) sets `build.verify=false` and `node.xpRate=8`.

Verified in game (M2, `docs/design/relics-m2-xp-energy.md`).

M3 note: `Content/pack/dbrow.pack`, `dbtable.pack` and `param.pack` are gitignored in Content (generated server-side), so only `varp.pack` ids are committed.

## Client-TS (not relic mode)

Now `main` of `calum/Client-TS` (former branch `calum-research`, kept), branched from upstream `274` at `7d6ca61`. Details and observations: [flows/client-camera.md](flows/client-camera.md).

| Repo | File | Change | Commit |
|---|---|---|---|
| Client-TS | `src/client/GameShell.ts` | canvas `wheel` listener (`mouseWheel` hook); middle button goes to `middleMouseDown`/`middleMouseUp` instead of acting as a left click | `15ece4e` |
| Client-TS | `src/client/Client.ts` | scroll-wheel zoom (`cameraZoom`, 0.5x to 2x of `pitch * 3 + 600`), visibility table rebuilt for the zoom (`resetVisCalc`), middle-mouse drag sets yaw/pitch and `sendCamera` | `15ece4e` |
| Client-TS | `src/dash3d/World.ts`, `src/dash3d/Model.ts`, `src/client/Client.ts` | render radius setting `World.viewRadius` (upstream 25, default 32) with matching depth cut; `?radius=N`, `::radius N`; `::fpson` shows radius and scene draw time | `93b19c3` |
| Client-TS | `src/dash3d/World.ts`, `src/client/Client.ts`, `test/camera-pitch.test.ts` | camera pitch range 32..480 (upstream 128..383) for arrow keys and middle drag; visibility table covers the range; `bun test` added | `5fd6cc3` (fork `main`) |
| Client-TS | `src/client/Client.ts` | relic mode: Infinite Runes client display (`a822635`) **reverted** by `cd03818` when relic 15 was retired (2026-10-11); `relic_owned` is no longer sent with a client code | `a822635`, `cd03818` |
| Client-TS | `src/mapview/MapCoords.ts` (new), `src/mapview/MapView.ts`, `src/client/Client.ts`, `test/map-coords.test.ts` | world map: player marker, centre-on-player (`C`), auto area switch on first position, `::map` opens `/worldmap.html`, position posted once a second on `BroadcastChannel('lostcity-worldmap')`; phase 2: follow into another area, off-screen edge marker, wheel zoom steps ([design/world-map.md](design/world-map.md)) | `ec49aa1` |
| Engine-TS | `src/web.ts`, `public/worldmap.html` (new), `public/client/mapview.js` (new, prebuilt), `public/client/client.js` (rebuilt) | `/worldmap.jag` served outside debug mode; map page and prebuilt map program | `32537f36` |

## Level-ups without the dialog
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `scripts/levelup/scripts/levelup.rs2`, `scripts/levelup/configs/levelup.constant` (new) | level-up chat line with the new level; blocking dialog and unlock boxes skipped unless `^levelup_dialogs = 1` ([design/levelup-nonblocking.md](design/levelup-nonblocking.md)) | `975ff13d5` |
| Content | `scripts/skill_mining/scripts/mining.rs2` | `~relic_mine_again` hook before the `return` after a mined ore (Eternal Vein keeps swinging) | `e9c938b6c` |


## Shared relic kill credit
| Repo | File | Change | Commit |
|---|---|---|---|
| Engine-TS | `src/engine/script/ScriptOpcode.ts` (`NPC_FINDHEROAT`, after `DB_LISTALL`), `ScriptOpcodePointers.ts`, `handlers/NpcOps.ts`, `entity/HeroPoints.ts` (`findHeroAt`) | new script command `npc_findheroat(rank)`: sets `active_player` to the player with the rank-th most damage on the active npc; false for an empty rank or an offline player | `04db3dc2` |
| Content | `scripts/engine.rs2` | declaration of `npc_findheroat` | `d2cd75318` |
| root | `mods/relics/scripts/relic_tasks.rs2` (`relic_on_kill`, new `relic_kill_tasks`) | loops ranks 0 to 15 and gives each online damager the kill tasks; Bounty (`relic_kill_effects`) stays with the top damager (`npc_findhero`). Test: `tests/relic-shared-kill.test.ts` | `HEAD` of this change |


## Teleport Network (relic 24) and Infinite Runes removal (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `pack/obj.pack`, `pack/interface.pack`, `pack/interface.order` | pack ids for `relic_network_stone` and `relic_teleportmenu` (generated by `scripts/sync-mods.mjs`) | `5931e56d9` |
| Client-TS | `src/client/Client.ts` | revert of the Infinite Runes display change | `cd03818` |
| root | `mods/relics/` | Teleport Network, retirement of 15, see [design/relics-teleport-network.md](design/relics-teleport-network.md). Test: `tests/relic-teleport-network.test.ts` | `HEAD` of this change |
## Rune Wellspring (relic 21)
| Repo | File | Change | Commit |
|---|---|---|---|
| Engine-TS | `src/engine/entity/Player.ts` (`addXp`, new `relicWellspring`) | adds gained XP to `%relic_wellspring_xp` and queues `[queue,relic_wellspring]` when bit 21 of `%relic_owned` is set (not Runecrafting). Test: `tests/relic-wellspring.test.ts` | `e45392c4` |
| Content | `scripts/skill_runecraft/scripts/runecraft.rs2` | `case relic_essence_bundle : ~relic_wellspring_craft;` in `[oplocu,_rc_altar]`; `if (~relic_wellspring_talisman = ^true) { return; }` at the top of `[opheld4,_talismans]` and `[opheld4,cosmic_talisman]` | `42043c0af` |

## Skilling relics 25-29 (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `skill_mining/scripts/mining.rs2`, `skill_woodcutting/scripts/woodcut.rs2` | roll delay through `~relic_gather_delay` (Prospector's Pick). Test: `tests/relic-skilling-routes.test.ts` | `2836a3256` |
| Content | `skill_fishing/scripts/fishing_spots/*.rs2`, `fishing_movement.rs2` | roll delay on the continuing labels (Prospector's Pick), `& ~relic_has(27) = 0` on every inventory-full check, spot kept by `~relic_spot_held` (Endless Shoal) | `871b03a87` |
| Content | `skill_smithing/scripts/smelting/smelting.rs2`, `smithing/smithing.rs2` | `~relic_forge_echo` after the product (Forge Echo) | `9faec3d8c` |
| Content | `skill_fletching/scripts/{arrows,bolts,bows,cut_logs,darts}.rs2` | `~relic_fletch_echo` after the product (Fletcher's Echo) | `38c204a97` |
| Content | `drop tables/scripts/{cow,green_dragon,blue_dragon,red_dragon,black_dragon}.rs2` | hide `obj_add` replaced by `~relic_drop_hide` (Hunter's Haul) | `a15fcce66` |
| root | `mods/relics/` | `relic_skilling.rs2`, `relic_gather.rs2` (fish bank id 27, Forge Echo per bar), names in `relic_offer.rs2`. Design: [design/relics-skilling-routes.md](design/relics-skilling-routes.md) | `HEAD` of this change |
| Engine-TS | `src/engine/entity/Player.ts` (`addXp`), `src/engine/entity/PlayerLoading.ts` | clamp XP to the 200m cap before storing in the Int32Array (it wrapped negative); saved negative values load as the cap. Test: `tests/xp-overflow.test.ts` | this commit |

## Relic play time (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `pack/varp.pack`, `pack/interface.pack`, `pack/interface.order` | pack ids for `relic_playticks`, `relic_finish_ticks` and `relic_relicmenu:time`/`finish` | see root commit |
| root | `mods/relics/` | `relic_playtime.rs2`, login and win hook lines in `relic_offer.rs2`, menu components. Design: [design/relics-playtime.md](design/relics-playtime.md). Test: `tests/relic-playtime.test.ts` | `HEAD` of this change |

## Light Fingers (relic 30) and tasks 41, 42 (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `scripts/skill_thieving/scripts/thieving.rs2` | `~relic_pickpocket_sure` in `check_if_success_pick_pocket`, `~relic_pickpocket_again` after a pick, early return with reward, XP, task and `p_oploc(2)` in `steal_from_stall` when `~relic_stall_keeps`, `~relic_task_steal` after a normal theft; guard and owner checks skipped when `~relic_stall_keeps`; `~relic_stall_wait` at the top of `attempt_steal_from_stall` (repeat gap, so walk clicks can cancel). Test: `tests/relic-thieving.test.ts` | `8308a8b14` |
| Content | `pack/interface.pack`, `pack/interface.order` | pack ids for `relic_taskmenu:row_41` and `row_42` | `9a5b2466a` |
| root | `mods/relics/` | `relic_thieving.rs2`, task 42 in `relic_task_pickpocket`, names, menus. Design: [design/relics-light-fingers.md](design/relics-light-fingers.md) | `HEAD` of this change |

## Access code (2026-10-11)

| Repo | File | Change | Commit |
|---|---|---|---|
| Engine-TS | `src/util/AccessCode.ts` (new), `src/util/WorldConfig.ts` (`node.accessCode`, default `''`, legacy `NODE_ACCESS_CODE`), `src/engine/World.ts` (login handler, after the password length check) | When `node.accessCode` is set, a login whose password is not the code gets reply 3. Test: `tests/access-code.test.ts`. See `docs/setup/hosting-for-friends.md` | `53ed3a49` |

## Green Thumb (relic 20) and tasks 43-45 (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Engine-TS | `src/engine/entity/Player.ts` (`addXp`, new `relicGreenThumb`) | adds the raw XP gained to `%relic_herb_xp` and queues `[queue,relic_herbs]` when bit 20 of `%relic_owned` is set (not Herblore). Test: `tests/relic-greenthumb.test.ts` | `33564f19` |
| Content | `scripts/player/scripts/stat.rs2` (`[timer,stat_boost_restore]`) | `& ~relic_boost_stays = 0` added to the drain condition `// relic hook` | `a274da743` |
| Content | `scripts/skill_herblore/scripts/herblore.rs2` (`[proc,brew_potion]`) | `inv_del` of the ingredient only when `~relic_keeps_secondary($ingredient, $solvent) = 0` `// relic hook` | `63824af58` |
| Content | `scripts/interface_bank/scripts/bank.rs2` (`[proc,bank_deposit_request]`) | `~relic_bank_herbs($obj, $deposit); // relic hook` after the deposit: banked herbs pay their cleaning XP (2026-10-12). Also `pack/varp.pack` id 383 `relic_quest_xp_off`, written by `mods:sync` | `49de3c73f` |
| Content | `pack/varp.pack`, `pack/interface.pack`, `pack/interface.order` | pack ids for `relic_herb_xp` and `relic_taskmenu:row_43..45` | `514e71556` |
| root | `mods/relics/` | `relic_herblore.rs2`, `.enum`, `.constant`, tasks 43-45 rows, names, menus. Design: [design/relics-green-thumb.md](design/relics-green-thumb.md) | `HEAD` of this change |
| Content | `pack/synth.pack`, `synth/relic_attune.synth` | pack id `912=relic_attune`, copy of `enchant_diamond_amulet.synth` (relic attune chime) | `b36ee553b` |
| Client-TS | `src/sound/CustomSounds.ts`, `src/client/Client.ts` (`soundsDoQueue`, sounds start-up) | recorded sounds in `/custom-sounds/` replace synth id 912. Design: [design/relics-attune.md](design/relics-attune.md) | `8adf2b8` |
| Client-TS | `src/client/Toast.ts` (new), `src/client/Client.ts` (`MESSAGE_GAME`, `otherOverlays`), `src/graphics/PixFont.ts` (`drawStringTrans`) | task-complete toast: `<text>:relictask:` game messages draw a 2 s fading panel instead of a chat line. Design: [design/task-complete-toast.md](design/task-complete-toast.md) | `f92f245` |
| root | `mods/relics/scripts/relic_offer.rs2` (`relic_task_done`) | sends the `:relictask:` message | `HEAD` of this change |

## Bonus boss fight (2026-10-11)
| Repo | File | Change | Commit |
|---|---|---|---|
| Content | `scripts/player/scripts/death.rs2` (`[queue,player_death]`) | `def_boolean $bonus = ~relic_bonus_death; // relic hook`: in the KBD lair during the bonus fight the item-loss branch is skipped and the player is teleported to `0_47_160_59_14` instead of Lumbridge | `a0826d64d` |
| Content | `pack/npc.pack`, `pack/spotanim.pack`, `pack/varp.pack` | pack ids for `relic_bonus_timer`, `relic_bonus_glow`, `relic_bonus_aura0..11`, `relic_bonus_colour` | `a0826d64d` |
| root | `mods/relics/scripts/relic_tasks.rs2` (`relic_on_kill`) and `relic_bonus.rs2` | `~relic_bonus_arm` and the whole fight. Design: [design/relics-bonus-boss-fight.md](design/relics-bonus-boss-fight.md) | `HEAD` of this change |
| Client-TS | `src/sound/JagFX.ts` (`SYNTH_GAIN`, `makeSound`) | synth 912 relic_attune plays at 2x amplitude, clamped. Design: [design/relics-attune.md](design/relics-attune.md) | `a251dd5` |
| root | `mods/relics/scripts/relic_hoarder.rs2`, `interfaces/relic_hoardermenu.if`, `configs/relic_hoarder.enum`, varps `relic_hoarder_owed`/`relic_hoarder_skip`, hooks in `relic_offer.rs2` and `relic_menus.rs2` | Hoarder widget with the full declined list. Design: [design/relics-hoarder.md](design/relics-hoarder.md). Test: `tests/relic-hoarder.test.ts` | `HEAD` of this change |

# Design: a roguelike "relic" mode

**Question answered:** how could a relic-based roguelike (kill NPCs to unlock randomised relic choices; relics change XP rate, damage taken, attack speed, mining, high alchemy, quests; goal is King Black Dragon and Kalphite Queen) be built on this codebase, which relics are cheap vs. too costly to maintain, and how do we keep merging upstream easy?

**Based on commits:**
- Engine-TS: `1d25566`
- Content: `65b754f`
- Client-TS: `7d6ca61` (only checked that no client change is needed for the core loop, see "Not checked")
- RuneScriptTS: `c454554`

**Method:** read code and grepped (counts below are from `grep` at these commits). Nothing was run. The relic mod itself is **not written**; this is a design with verified hook points. Hook line numbers must be re-checked after any submodule bump (`docs/tools/check_citations.py`).

## Verdict in one paragraph

Almost everything can live in `mods/` (RuneScript + configs), because relic state is just perm varps and the choice UI is the existing chat-choice dialog. The mod cannot, however, *intercept* upstream behaviour: the engine has one global XP multiplier, the RuneScript compiler refuses to redefine an existing script, and there is no generic "NPC died" or "XP gained" trigger. So we need a **small, fixed set of one-line hook calls** in upstream files (about 10 lines in ~8 files, plus one engine line). Keep those as `.patch` files in this root repo applied on top of pristine submodules, never as hand edits, and everything else stays in `mods/`.

## Findings: what the code allows

### What a mod can and cannot do

1. A mod cannot replace an upstream script. The compiler reports `[trigger,name] is already defined.` when the same header appears twice. Source: `RuneScriptTS/src/compiler/semantics/ScriptRegistration.ts:173`, message at `RuneScriptTS/src/compiler/diagnostics/DiagnosticMessage.ts:31`. (Read, not run.)
2. Trigger lookup order is type-specific, then category, then global. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:124-134`. So a mod *can* define a more specific script (e.g. `[oploc1,copper_rock]`) that wins over upstream's category script `[oploc1,_mining_rock_normal]` (`Content/scripts/skill_mining/scripts/mining.rs2:2`). Inference: this works but forks the logic per loc, so it will drift from upstream; avoid it for anything but tiny cases.
3. `[login,_]` and `[logout,_]` are single global scripts: the engine looks up only the global one (`Engine-TS/src/engine/entity/Player.ts:525`, `Engine-TS/src/engine/World.ts:780`). The one upstream login script is `Content/scripts/login_logout/login.rs2:1`. So a mod cannot add a second login handler; it needs a one-line call inserted there (it already starts the other timers near `login.rs2:35-38`).
4. Cheats: `::~name` runs `[debugproc,name]` (see `docs/flows/dev-cheat-commands.md`), so every relic can be granted and tested from chat without touching the unlock loop.

### XP

5. XP gain goes through one function, `Player.addXp`: `const multi = allowMulti ? Environment.node.xpRate : 1; this.stats[stat] += xp * multi;` Source: `Engine-TS/src/engine/entity/Player.ts:1819-1831`. It caps at `2_000_000_000` (stored x10, so 200m xp) at `:1833-1836`. The rate is one integer for the whole server: `Engine-TS/src/util/WorldConfig.ts:98` (default 1) and `:237` (`tryParseInt(env.NODE_XPRATE, ...)`). It is not per player.
6. The script command `stat_advance` is the only script path into it (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:810-817`). There are 405 `stat_advance` calls in 142 `.rs2` files (grep), so wrapping call sites is not an option.
7. There is no script opcode that reads XP (the `STAT*` opcodes are `stat`, `stat_base`, `stat_total`, `stat_add/sub/heal/boost/drain/random`, `stat_advance`; `Engine-TS/src/engine/script/ScriptOpcode.ts:181-190`), and the engine's XP triggers fire only on level changes: `[advancestat]` on a level-up (`Player.ts:1883`) and `[changestat]` (`Player.ts:1896`). So "multiply by diffing XP in a timer" is impossible.
8. Therefore a per-player multiplier needs a one-line engine change at `Player.ts:1830`: multiply by a value read from a perm varp. A global `NODE_XPRATE` works as the *base* 10x (config only), and relics could then be a varp-driven extra factor.
9. XP units: stats are stored x10 and sent as `exp / 10` (`Engine-TS/src/network/game/server/codec/UpdateStatEncoder.ts:11`; Doric's reward `stat_advance(mining, 13000)` at `Content/scripts/quests/quest_doric/scripts/quest_doric.rs2:99`). Level 99 needs 13,034,431 xp, level 70 needs 737,627 (formula at `Player.ts:76-84`, evaluated by me with node).

### Damage taken

10. All damage to a player funnels through `[proc,damage_self]`, which calls the `damage` opcode once (`Content/scripts/player/scripts/damage.rs2:1-7`). The only other `damage(` caller is karambwan poison (`Content/scripts/player/scripts/consumption/effects/scripts/poison_karambwan.rs2:6`). `~damage_self` has 155 callers (grep). Melee NPC hits arrive via `queue(combat_damage_player ...)` (`Content/scripts/skill_combat/scripts/npc/npc_combat_melee.rs2:47`, handler `npc_combat.rs2:346` which ends in `~damage_self`). One hook line at `damage.rs2` before the `damage(...)` call covers every source, including dragonfire.

### Attack speed

11. Player attack delay is `%action_delay = map_clock + attackrate` written in separate places: `player_melee.rs2:54,56`, `player_ranged.rs2:18,20,23`, `player_special_attack.rs2:18`, `auto_retaliate.rs2:9,33`, `player_magic.rs2:176` (fixed 5), `Content/scripts/quests/quest_chompybird/scripts/chompy_bird.rs2:157` (all under `Content/scripts/skill_combat/scripts/player/` unless stated), plus a PvP copy under `pvp/`. About 9 PvM sites. "Half attack speed" is therefore a ~9-line patch, and it must also change `attackrate` for ranged's `sub(%action_delay, 1)` rapid logic (`player_ranged.rs2:23`) consistently. Whether the engine/client cap how fast the swing animation can play is **not verified**.
12. NPC attack delays are separate (`%npc_action_delay`, e.g. `npc_combat_melee.rs2:39`), so a relic that *slows enemies* is a different set of edits.

### Kill detection (to unlock relics)

13. NPC death is not engine-triggered. Each NPC has its own `[ai_queue3,<npc>]` script, and 152 files define one (grep) with 172 mentions of `npc_death`/`npc_default_death` (grep). Most call `gosub(npc_death)` (`Content/scripts/skill_combat/scripts/npc/npc_death.rs2:10` is `[proc,npc_death]`). So one hook line in `[proc,npc_death]` sees nearly every kill, and `npc_findhero` identifies the killer (used throughout the drop-table scripts).
14. **Bosses are special.** King Black Dragon: `[ai_queue3,king_dragon]` calls `gosub(npc_death)` (`Content/scripts/areas/area_wilderness/scripts/king_black_dragon.rs2:3-4`). Kalphite Queen has two forms. The first form's `[ai_queue3,kalphite_queen]` does **not** call `npc_death`; it spawns a dead-body NPC and turns into `kalphite_flyingqueen` (`Content/scripts/areas/area_kalphite/scripts/kalphite_queen.rs2:36-50`). The second form is the one in the drop tables (`drop tables/scripts/kalphite_queen.rs2:1-2`, path has a space), which does call `npc_death`. So "final KQ kill" = the `kalphite_flyingqueen` death, and the hook in `npc_death` will see it.
15. Some NPCs may bypass `npc_death` entirely (152 `ai_queue3` files vs. mentions; I did not check each). Not verified which.

### Relic state and UI

16. Perm varps (`scope=perm`, e.g. `Content/scripts/quests/quest_doric/configs/quest_doric.varp`) are saved with the player: `Player.ts:215-224` writes every non-zero perm varp. Hence relic ownership, progress counters and a per-run seed can be varps defined in `mods/relics/configs/*.varp` (`docs/setup/script-dev-loop.md:46` says mods support `.varp`; not yet run for a new varp).
17. A 5-option choice dialog already exists: `~p_choice5_header(...)` (`Content/scripts/interface_chat/scripts/chat.rs2:149`; used by `general/scripts/enchanted_jewellry/amulet_of_glory.rs2:13`). A "pick 1 of 3 random relics" screen needs no client work.
18. Quests: completion is a per-quest varp compared to a per-quest constant (e.g. `%doricquest = ^doric_complete`, `quest_doric.rs2:98`); quest points are recounted from those varps by `~update_questpoints` (`Content/scripts/general/scripts/quests.rs2:54-61`), and rewards (xp, items) are given by a separate `[queue,*_quest_complete]` (`quest_doric.rs2:97-101`). `quests/` has 65 entries (64 quests plus `interfaces`).

### Mining and alchemy

19. Mining rock depletion and ore delivery are inline in three labels: `loc_change(loc_param(next_loc_stage_mining), ...)` at `Content/scripts/skill_mining/scripts/mining.rs2:133,176,221`, and `inv_add(inv, ...)` at `:142,179,194`. "Never depletes" = skip the `loc_change`; "autobank" = `inv_add(bank, ...)`. Upstream already uses `inv_add(bank, ...)` elsewhere (`skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2:34`), so that is a valid target. Ore-to-bank would skip the inventory-full check at `mining.rs2:32,75`, which also needs a relic condition.
20. High alchemy is `[opheldt,magic:highlvl_alchemy]` -> `[label,magic_spell_high_alch]` (`Content/scripts/skill_magic/scripts/spells/alchemy.rs2:1,4`), ending in `p_delay(3)` at `:37`. A repeat is a tail call at the end of that label while the relic is on and the item stack remains. Whether the `p_delay` loop is interrupted by movement/clicks is **not verified** (open question).

## Relic feasibility

"Patch lines" = one-line hook calls in upstream files. "Mod" = new files in `mods/`. Maintenance is the chance an upstream change breaks it.

| Relic | Where | Patch lines | Maintenance | Verdict |
|---|---|---|---|---|
| Base 10x..100x XP | `NODE_XPRATE` config | 0 | none | trivial |
| Extra xN XP (stacking) | `Player.ts:1830` reads a varp | 1 engine line | very low | easy |
| 50% less damage taken | `damage.rs2` before `damage(...)` | 1 | very low | easy |
| Half attack delay (faster swings) | ~9 `%action_delay` sites | ~9 | medium (combat is active upstream) | doable; wrap in one proc `~relic_delay($base)` so each site changes once |
| Relic unlock on kill | `[proc,npc_death]` | 1 | low | easy |
| Relic menu on login/after kill | `login.rs2` + `p_choice5_header` | 1 | low | easy |
| Mining never depletes + autobank | `mining.rs2` 3 labels | ~6 | medium | doable; fixed to one file |
| Auto high-alch repeat | `alchemy.rs2:37` | 1-2 | low | doable, needs a test for interruption |
| Auto-complete all quests | mod-only table of (varp, complete constant) | 0 | high if hand-written | doable only if the table is *generated* from `quests/*/configs` and checked in CI; rewards are skipped; other quest-gated state is **not verified** |
| Free teleports / run energy / carry weight / no food needed | mod + 0-2 hooks | few | low | good "speed" relics |
| Skip skill level requirements | requirements are checked inline in hundreds of scripts | hundreds | very high | **too complex** |
| Item/drop-rate relics | 152+ per-NPC drop scripts | hundreds | very high | **too complex**; instead give relic-granted items on kill |
| New HUD/relic icons/interfaces | Client-TS and cache | client + data | high | **avoid** at first; use chat messages and a varp-driven existing tab text |
| Anything touching multiple players | engine | many | high | out of scope (single-player mode) |

## Design

### Layers (what lives where)

| Layer | Content | Where | Upstream-merge risk |
|---|---|---|---|
| L0 data | relic definitions as a `dbtable`/consts, varps for owned/active relics, kill counter, run seed | `mods/relics/configs/` | none |
| L1 logic | `[proc,relic_*]`, `[debugproc,relic_*]`, unlock + roll + menu, win detection | `mods/relics/scripts/` | none (new names only) |
| L2 hooks | `~relic_on_kill;`, `~relic_on_login;`, damage/mining/delay hooks, 1 engine line | `patches/*.patch` in this repo, applied to the submodule working trees | low: only when upstream touches those exact lines |

Rules to keep merging easy:
1. **Hook = one call, no logic.** Example: `damage.rs2` gets `$amount = ~relic_damage_taken($amount);`. All logic is in the mod, so an upstream conflict is a one-line re-apply.
2. **Patch series in the root repo, not commits in submodules.** This repo's rule is never to push submodules, and `calum-research` local edits are meant for research logging (`CLAUDE.md`, "Git rules"). Proposal (not built): `patches/NN-name.patch`, a `mise run patches:apply` that does `git apply` and a `patches:check` that does `git apply --check` after every submodule bump, so breakage is found at bump time. Needs Calum's agreement because it departs from the "local edits only for research" rule; either way each hook must be recorded in `docs/local-changes.md`.
3. **Prefix everything** with `relic_` (procs, varps, params) so mod names never collide with a future upstream name.
4. **Pin the submodules** and bump deliberately (CLAUDE.md "Staleness check"); after a bump run `patches:check`, then re-check this note's citations.
5. **Do not override upstream scripts via type-specific scripts** (finding 2) except as a last resort.
6. **Prefer a new relic that needs 0 patches** over one that needs a patch, until the core loop works.

### Relic data model (sketch)

- `%relic_owned` (bitmask varp(s), int = 32 bits; use a second varp if >32 relics).
- `%relic_kills` (counter) and `%relic_next_at` (kills needed for the next pick), or a table keyed by NPC type for "boss" unlocks (a `dbtable` in `mods/` like upstream's `mining_table`, `Content/scripts/skill_mining/scripts/mining.rs2:19-21`).
- `%relic_seed` per run so the random choices are reproducible when debugging.
- XP factor: `xpRate (config) x product(active xp relics)`. To avoid overflow and silly values, express it as one integer varp `%relic_xp_mult` recomputed whenever the owned set changes.

### Unlock loop

1. `[proc,npc_death]` calls `~relic_on_kill` (hook).
2. `~relic_on_kill` checks `npc_findhero` and the NPC's weight in the table; adds to `%relic_kills`; when the threshold passes, queue a strong script that rolls 3 not-yet-owned relics from the seed and shows `~p_choice3_header`-style options (the 2- and 5-option versions are verified to exist; the 3-option one was not looked for).
3. If the NPC is `king_dragon` or `kalphite_flyingqueen` and the other boss is already recorded, run the win sequence (mark run complete, message, optionally reset).

### Suggested order of work

1. **Prove the loop with 0 patches** (mod only): `[debugproc,relic_give]`, a varp, and a `p_choice5` menu; confirm hot reload and persistence across logout (open question 70).
2. **XP:** set `NODE_XPRATE` for the 10x base, then add the engine line for the relic factor.
3. **Kill hook + unlock menu.** Test with a chicken, then both bosses.
4. **Easy relics:** damage, XP, free teleport, run energy.
5. **Medium:** attack speed (via one proc), mining, high alchemy.
6. **Last:** quest auto-complete (generated table), tuning, and the 10-hour pacing pass.

## Pacing check (inference)

Level 99 is 13,034,431 xp (finding 9). A skill whose training you can do at, say, 50,000 xp/hour at 1x takes 260 hours; the same method with 10x xp takes 26 hours *per skill*, and with 100x about 2.6 hours. The "50,000 xp/hour" is an illustrative figure I did not derive from the code or an authoritative source. The conclusion that matters is structural: because multipliers divide the time directly, a 10-hour full playthrough implies roughly 50x-100x effective XP by midgame, i.e. relics must stack to ~100x quickly, and combat levels (not skilling) will be the bottleneck for KBD and KQ. (Whether dragonfire and other special attacks are reduced by shields or prayers was not checked; the damage hook sits after those reductions only if they are applied before `damage_self`, which was not verified.)

## Not checked / open questions

- Did not run the server or compile any mod; all hook points are from reading. Logged in `open-questions.md` (69-72).
- Whether `NODE_XPRATE` reaches the engine in this setup (memory notes say the engine reads `world.json`/`.env`, not env vars; not re-verified here).
- Whether every NPC death passes through `[proc,npc_death]` (finding 15).
- Whether setting only each quest's main varp is enough for all quest-gated content (finding 18).
- Client-TS: not read for this note. The claim "no client change needed for the core loop" rests on the server-side findings 16-17 only.
- A 3-option choice proc and any existing sidebar/overlay interface that could display relic status were not looked for.

---

# Part 2: tasks, offers and the relic pool

**Question answered:** which ~25 tasks drive the relic offers, how does a "pick 1 of 3" offer work, which ~30 game-breaking relics fill the pool (including infinite-charge jewellery and a "last recall"), and which hooks each needs?

**Based on commits:** Engine-TS `1d25566`, Content `65b754f`, RuneScriptTS `c454554` (same as Part 1). **Method:** read and grepped, nothing run. All hook sites below are one-line calls (`~relic_*`) unless stated, following the Part 1 rules.

## Part 2 findings (new facts)

21. **Skilling tasks can be detected at the point the product is created**, because each skill gives its output in one place. Output sites (all `Content/scripts/`):
    - mining: `skill_mining/scripts/mining.rs2:142,179` (`inv_add(inv, ...)`), gem rocks `:194`
    - woodcutting: `skill_woodcutting/scripts/woodcut.rs2:134` (`inv_add(inv, $product, 1)`); depletion `loc_change` at `:137`
    - fishing: `skill_fishing/scripts/fishing.rs2:52,65,81,95` (`$fish1`/`$fish2`)
    - cooking: `skill_cooking/scripts/cooking.rs2:176` (`$cooked_item`); burnt result `:189`
    - firemaking: `skill_firemaking/scripts/firemaking.rs2:121` (`stat_advance(firemaking, oc_param($log, productexp))`, so `$log` is the burnt log; no item is created)
    - runecrafting: `skill_runecraft/scripts/runecraft.rs2:98` (`inv_add(inv, $rune, ...)`)
    - fletching: `skill_fletching/scripts/bows.rs2:42` (`inv_add(inv, db_getfield($data, fletching_table:product, 0))`)
    - smithing/smelting: `skill_smithing/scripts/smelting/smelting.rs2:222` (`inv_add(inv, $product, 1)`)
    - herblore: `[proc,brew_potion]` in `skill_herblore/scripts/herblore.rs2:10`, product added at `:14` (`inv_add(inv, $mixture, 1)`)
    - pickpocket: entry label `skill_thieving/scripts/pickpocketing/pickpocket.rs2:100` (`attempt_pick_pocket`); the success line was **not pinned** (open question 73). `thieving.rs2:99,135` are stall and chest paths, not pickpocket.
    So a task is "object X produced by skill Y" and needs a hook `~relic_task_obj($obj)` at about 12 sites. An engine-level alternative (hook the `INV_ADD` opcode, `Engine-TS/src/engine/script/handlers/InvOps.ts:57-73`) would be one site, but it would also fire for shop buys, drops and rewards, so tasks could be cheesed; I recommend the explicit script hooks.
22. **Kill tasks** use the Part 1 `npc_death` hook (finding 13) with `npc_type`. NPC type names found in config: `goblin` (plus `goblin_armed`, `goblin_helmet`, `goblin_greenarmour`), `lesser_demon`, `scorpion`, `monkey`, `green_dragon`, `blue_dragon`, `black_demon`, `hellhound`, `paladin`, `king_dragon` (KBD). Bears are `brownbear`/`darkbear` (name "Bear"). There is **no NPC named "Hill giant"** in the configs I grepped: the generic one is `giant` (name "Giant") plus `firegiant`, `icegiant`, `mossgiant`. So task 3 must be "Giant" (this is revision 274; whether the `giant` type spawns in the open world is not verified).
23. **Items exist** by these debug names: `mithril_ore`, `runite_ore`, `maple_logs`, `yew_logs`, `magic_shortbow`, `lawrune`, `raw_swordfish`/`swordfish`, `raw_shark`/`shark`, `silver_bar`, and `4dose2attack` ("Super attack(4)"). Which dose `brew_potion` produces for super attack is not verified.
24. **Teleports**: all seven teleport spells and the charged jewellery call `~pre_tele_checks(coord)` with the *origin* coord (spells: `skill_magic/scripts/spells/teleport.rs2:39`; the proc is at `:96`; 7 call sites by grep) and then `~player_teleport_normal(dest)` (`teleport.rs2:54`, 33 callers by grep). So recording the origin once at the end of `pre_tele_checks` captures "where you last teleported from" for every source. Caveat: it records even if a later check cancels the teleport (e.g. the `afk_event` return at `teleport.rs2:42-45`).
25. **Jewellery charges** are item swaps: `inv_setslot(inv, $slot, oc_param($item, next_obj_stage), 1)` or delete when no next stage (ring of dueling: `general/scripts/enchanted_jewellry/ring_of_dueling.rs2` near the end; same pattern in `amulet_of_glory.rs2` and `necklace_of_minigames.rs2`; 3 `next_obj_stage` lines across the 6 files in that folder by grep). Rings of forging, life and recoil are also in the folder and charge differently (not read). "Infinite charges" = skip that swap in 3 places, via one proc `~relic_keep_charge`.
26. **Rune cost** goes through `[proc,delete_spell_runes]` (`skill_magic/scripts/magic.rs2:90`, 14 callers by grep), so free casting is one hook. Whether combat spells use it too is not verified.
27. **Damage dealt to NPCs** in melee, ranged, magic and the `pvm_*` specials is computed through `[proc,npc_max_dealt]` (`skill_combat/scripts/npc/npc_combat.rs2:391`; callers incl. `player_melee.rs2:28`, `player_ranged.rs2:51`, `player_magic.rs2:201`). One hook there scales damage dealt (and a "minimum hit" effect).
28. **Utility opcodes exist**: `RUNENERGY`, `WEIGHT` (`Engine-TS/src/engine/script/ScriptOpcode.ts:168,206`), and a reusable `@openbank` label used by bank booths (`interface_bank/scripts/bank_booth.rs2:5`). What each does (read vs set) was not read.

> **Revision (after review):** the base XP rate is now **8x** (not the 10x used in Part 1's examples), and the relic pool below replaces the first 32-relic draft.

## The task list (25)

Your 18 examples, plus 7 chosen by me. "Hook" = where the completion is detected. 1-3 and 14-25 are kills.

| # | Task | Detect with | Notes |
|---|---|---|---|
| 1 | Defeat a goblin | `npc_death`, `npc_type` in the goblin set | several goblin types (finding 22) |
| 2 | Defeat a lesser demon | `npc_death`, `lesser_demon` | |
| 3 | Defeat a **Giant** | `npc_death`, `giant` | no "Hill giant" type exists |
| 4 | Mine a mithril ore | mining output, `mithril_ore` | |
| 5 | Chop a maple log | `woodcut.rs2:134`, `maple_logs` | |
| 6 | Fletch a magic shortbow | `bows.rs2:42`, `magic_shortbow` | |
| 7 | Burn a yew log | `firemaking.rs2:121`, `$log = yew_logs` | no item is created |
| 8 | Craft a law rune | `runecraft.rs2:98`, `lawrune` | needs the altar and members flag; access gating not checked |
| 9 | Harpoon a swordfish | `fishing.rs2` (4 sites), `raw_swordfish` | |
| 10 | Cook a raw shark | `cooking.rs2:176`, `shark` | do not count the burnt result |
| 11 | Smith a silver bar | `smelting.rs2:222`, `silver_bar` | |
| 12 | Make a super attack potion | `herblore.rs2:14`, mixture is a super attack dose | dose not verified |
| 13 | Pickpocket a paladin | pickpocket success path | line not pinned; data row exists (`skill_thieving/configs/pickpocking/pickpocket.dbrow:105`) |
| 14 | Defeat a scorpion | `npc_death`, `scorpion` | |
| 15 | Defeat a bear | `npc_death`, `brownbear`/`darkbear` | |
| 16 | Defeat a monkey | `npc_death`, `monkey` | |
| 17 | Defeat a green dragon | `npc_death`, `green_dragon` | |
| 18 | Defeat a blue dragon | `npc_death`, `blue_dragon` | |
| 19 | Mine a runite ore (added) | mining output, `runite_ore` | |
| 20 | Chop a yew log (added) | `woodcut.rs2:134`, `yew_logs` | |
| 21 | Defeat a hellhound (added) | `npc_death`, `hellhound` | |
| 22 | Defeat a black demon (added) | `npc_death`, `black_demon` | |
| 23 | Defeat a Kalphite soldier (added) | `npc_death` | exact npc type name to confirm |
| 24 | Defeat the King Black Dragon | `npc_death`, `king_dragon` | final, no relic offer |
| 25 | Defeat the Kalphite Queen | `npc_death` of `kalphite_flyingqueen` (finding 14) | final, no relic offer |

Tasks 1-23 each trigger one offer (23 offers). Suggested order: tasks are *unlocked in tiers* (for example 1-6 first, then 7-13, then 14-23, then the two finals), but inside a tier the player picks any, which keeps routing interesting. The Compass, Tutor and Boss Key relics from the first draft were dropped, so v1 has no relic that points at the next task.

## Offer mechanics

1. Each completed task triggers `~relic_task_done`, which plays the celebration (below) and then `~relic_offer`. It draws **up to 3 distinct relics** with the run seed (`%relic_seed`, advanced each draw) from the *eligible pool*.
2. Eligible pool = every relic not yet owned, plus the next tier of the XP multiplier while it has tiers left. Relics offered but not picked **stay in the pool**, so they can reappear.
3. **Pool exhausted:** if the eligible pool is empty, no offer is shown and the task just completes (celebration only). If 1 or 2 relics remain, offer just those. This is the v1 rule you asked for.
4. Pick via the choice dialog: `~p_choice5_header` exists (`interface_chat/scripts/chat.rs2:149`; 2- and 5-option versions are verified; use the 5-option one with 3 entries if no 3-option proc exists).
5. Pool size vs offers (inference): 21 pickable relics (see below) for 23 offers, so with this pool the last offers are empty. That is fine for v1; a bigger pool is a later addition.

## Celebration on task completion (fireworks and level-up sound)

Both effects are already used by upstream's level-up script, so this is **mod only**, no hook beyond the task hook:
- **Fireworks:** `spotanim_pl(levelup_anim, 124, 0);` (`Content/scripts/levelup/scripts/levelup.rs2:33`, commented "play the fireworks"). The spotanim `levelup_anim` is defined in `Content/scripts/_unpack/225/all.spotanim:1341`. Being a player spotanim, other players nearby would see it too (inference from `spotanim_pl`; not run).
- **Level-up sound:** upstream plays it as a music jingle, not a sound effect: `~music_jingle($jingle)` (`levelup.rs2:50`, proc at `Content/scripts/music/scripts/music.rs2:50`, which wraps `midi_jingle`). The jingle is a per-skill value in the db table: `data=levelup_jingle,advance attack` (`Content/scripts/levelup/configs/levelup.dbrow:9`). For a task, call `~music_jingle(...)` with one fixed jingle, for example the value of that row's `levelup:levelup_jingle` field read with `db_find`/`db_getfield` as `levelup.rs2` does at `:24-25` and `:42-50`. The `sound_synth(firework, ...)` line is commented out upstream (`levelup.rs2:34`), so no firework synth exists to reuse.
- Not verified: how the jingle behaves if a real level-up jingle plays in the same tick (both can happen, since XP relics level skills quickly). Open question 75.

## The relic pool (19 names, 21 pickable relics)

Feasibility legend: **E** easy (mod + at most one hook line), **M** medium (several hook lines or behaviour to verify). Hooks refer to Part 1 and findings 21-28. Removed from the earlier draft per your review: Scholar/Warlord (merged), Tutor, Prodigy, Free Teleports, Boss Key, Compass, Fleet Foot, Featherweight, Pathfinder, Reroll, Fast Hands, Smelter's Blessing.

### XP
| # | Relic | Effect | Hook | |
|---|---|---|---|---|
| 1 | **XP Multiplier I / II / III** | one multiplier for all skills and combat. Start at **8x**; the three tiers take it to **16x, 32x, 64x** (3 offers) | base `NODE_XPRATE=8`; engine `addXp` line multiplies by a perm varp factor (1, 2, 4, 8) (finding 5) | E |
| 2 | Quest Pass | auto-complete all quests | generated (varp, constant) table (Part 1 finding 18) | M |

On the multiplier: finding 5 shows the rate is one integer from `NODE_XPRATE` (`WorldConfig.ts:98,237`), so 8x is configuration alone, and the tiers need the single engine line `this.stats[stat] += xp * multi * <varp factor>`. Memory notes say the engine reads `world.json`/`.env` rather than process env vars; confirm how to set 8 (open question 69).

### Combat (kept as you liked them)
| # | Relic | Effect | Hook | |
|---|---|---|---|---|
| 3 | Stoneskin | 50% less damage taken | `damage_self` (Part 1 finding 10) | E |
| 4 | Quickstrike | attacks twice as fast (halve attack delay) | ~9 `%action_delay` sites (Part 1 finding 11) | M |
| 5 | Glass Cannon | damage dealt x2, damage taken x1.5 | `npc_max_dealt` (finding 27) + `damage_self` | E |
| 6 | Phoenix | the first lethal hit in each 5-minute window leaves 1 HP | `damage_self` + timer | E |
| 7 | Vampire | heal a % of max HP on every kill | `npc_death` hook | E |
| 8 | Executioner | NPCs below 25% HP die instantly | `npc_max_dealt` (needs the target HP) | M |
| 9 | Bounty | every kill drops coins and supplies by NPC tier | `npc_death` hook, mod loot table | E |

### Gathering
| # | Relic | Effect | Hook | |
|---|---|---|---|---|
| 10 | **Eternal Vein** (merged) | ore rocks never deplete **and** ore goes straight to the bank | skip `loc_change` at `mining.rs2:133,176,221`; `inv_add(bank, ...)` at `:142,179,194` | M |
| 11 | **Evergreen** | trees never fall **and** logs go straight to the bank | skip `loc_change` at `woodcut.rs2:137`; `inv_add(bank, ...)` at `:134` | M |
| 12 | Double Yield | gathering and cooking give x2 items | change `inv_add` counts at the finding 21 sites | M |

Autobank skips the inventory-full check (`mining.rs2:32,75`), so the relic must also bypass that check, otherwise a full inventory still blocks mining. The woodcutting full-inventory check was not read (open question 76). Note the full-bank case is also unhandled: a bank has a finite number of slots (not read), so decide what happens when the bank is full.

### Magic and money (kept)
| # | Relic | Effect | Hook | |
|---|---|---|---|---|
| 13 | Midas Loop | high alchemy repeats on the same item stack | tail call at `alchemy.rs2:37` (interruption unverified, open question 71) | M |
| 14 | Philosopher's Coin | alchemy pays x2 | profit lines `alchemy.rs2:25,61` | E |
| 15 | Infinite Runes | spells cost no runes | `delete_spell_runes` (finding 26) | E |

### Travel and utility
| # | Relic | Effect | Hook | |
|---|---|---|---|---|
| 16 | **Everlasting Jewellery** | the duelling ring, glory amulet and games necklace never lose charges, **and unlocking the relic puts one of each in your bank** | `~relic_keep_charge` in 3 files (finding 25); on unlock `inv_add(bank, ring_of_dueling_8, 1)`, `amulet_of_glory_4`, `necklace_of_minigames_8` | E |
| 17 | Last Recall | teleports you back to where you last teleported from (ping-pongs between the two places) | record origin in `pre_tele_checks` (finding 24), then `~player_teleport_normal` | E |
| 18 | Banker's Call | open the bank from anywhere | reuse `@openbank` (finding 28), via an item op or command | E |
| 19 | Hoarder | grants one extra pick from relics you were offered and declined earlier | mod only; needs a "declined" bitmask varp | E |

Item names for the jewellery come from `Content/scripts/skill_magic/configs/enchanted_jewelry.obj` (`ring_of_dueling_8` "Ring of dueling(8)" at line 21, `amulet_of_glory_1`..`_4`, `necklace_of_minigames_8`). That `amulet_of_glory_4` is the full-charge item and `amulet_of_glory` the uncharged one is inferred from the name list and the `next_obj_stage` chain, not fully read; confirm before coding. If the player already holds the item, adding another is harmless, but the bank gift should be given once (`%relic_jewellery_given` varp).

**Last Recall details** are unchanged from the previous draft: two perm varps; the recall goes through `pre_tele_checks`, so it overwrites the stored origin with the place you are leaving and repeated recalls swap between two places. The trigger (item op vs command) is still to choose.

### Moved out of the relic pool

- **Unlimited run energy** is a default for every run, not a relic. Run energy is only readable from script (`RUNENERGY` pushes `player.runenergy`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:1240-1243`), so a script cannot set it. The drain is in the engine: `updateEnergy` subtracts energy while running (`Engine-TS/src/engine/entity/Player.ts:701-712`). Therefore this is **one engine edit** (skip the drain branch, or keep it at 10000), alongside the XP line. I found no setter opcode in `ScriptOpcode.ts` (only `RUNENERGY` and `HEALENERGY`). What `HEALENERGY` does was not read; if it restores energy, a per-tick timer could replace the engine edit (open question 74).

Counts: **19 relics**, with the XP multiplier counting as 3 offers, so **21 pickable relics**. Effort: easy are #1, 3, 5, 6, 7, 9, 14 to 19; medium are #2, 4, 8, 10 to 13.

## How much upstream surgery this adds (on top of Part 1)

New one-line hooks:
- ~12 task-detection calls at the finding 21 sites
- `pre_tele_checks` (1), `delete_spell_runes` (1), `npc_max_dealt` (1)
- 3 jewellery files
- `alchemy.rs2` tail call and two profit lines
- 3 mining labels and 1 woodcut label
- Engine: the XP factor line and the run-energy line (2 edits in `Player.ts`)

That is about 25 lines in ~13 Content files plus the two engine lines. Everything else (relic data, offer logic, celebration, tables, varps) is in `mods/relics/`. For the lowest merge risk, ship the easy relics first (#1, 3, 5, 6, 7, 9, 14 to 19) and add the medium ones afterwards.

## Risks to decide on

- **Level requirements.** Some tasks need levels (silver bar, mithril, magic shortbow, runecrafting at the law altar, paladin pickpocket). With the multiplier starting at 8x and no level-skipping relics, the player must train these skills; tier the tasks so each tier's requirement is reachable at the multiplier the player will have by then, and check this when tuning.
- **Access gating.** Some task sites sit behind quests or members-only areas. I did not verify that every task site is reachable on a fresh character (for example the law altar and the Kalphite lair). That check needs a play-through or a read of each access path.
- **Phoenix, Executioner and Quickstrike** change fight balance for the two bosses. Test against KBD and KQ before locking numbers.

## Not checked (Part 2)

- Which NPC types are spawned where, and whether each task is reachable without other quests.
- The exact pickpocket success line, the super attack dose produced, the Kalphite soldier NPC name.
- `HEALENERGY` semantics; whether combat spells call `delete_spell_runes`.
- Whether an item can be granted from `mods/` with an op that has a mod-only script (config shape not tried).
- Nothing was compiled or run.

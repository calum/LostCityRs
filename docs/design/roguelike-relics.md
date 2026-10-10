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

# Development plan: roguelike relic mode (v1)

**Question answered:** in what order do we build the relic mode specified in [roguelike-relics-spec.md](roguelike-relics-spec.md), and for each step which files change, which upstream hooks are added, how is it tested in game, and what docs change?

**Based on commits:** root `815cbbe`; Engine-TS `1d25566`, Content `65b754f`, RuneScriptTS `c454554`, Client-TS `7d6ca61` (unchanged; Client-TS is not touched in v1).

**Method:** read the spec and design doc, then read the code at the hook sites named below to confirm the proc signatures and anchor lines (`Engine-TS/src/engine/entity/Player.ts:701-713,1829-1830`, `Content/scripts/player/scripts/damage.rs2:1-7`, `npc_death.rs2:10`, `login.rs2:1-40`, `chat.rs2:149`, `npc_combat.rs2:391`, `magic.rs2:90`, `teleport.rs2:54,96`, `music.rs2:50`, `death.rs2:47`). **Nothing was compiled or run.** Hook sites not listed there come from the design doc and are not re-read; each milestone re-reads its sites before editing (rule 1 below).

## Working rules (apply to every milestone)

1. **Read before hooking.** Re-open each hook site, re-grep the line number, and only then edit (`CLAUDE.md`). The design doc's line numbers date from the commits above.
2. **Hook = one line, no logic.** Logic lives in `mods/relics/scripts/`. Names: `relic_*` for procs, varps, params, NPCs, items.
3. **Hook commits.** In each fork, create `relic-mode` from `calum-research` (`git -C <sub> switch -c relic-mode calum-research`) and make **one commit per hook**, message `relic hook: <proc> in <file>`. Push to `origin` (the fork) only, then commit and push the submodule pointer in the root on `main` (`CLAUDE.md` git rules). The submodule dir must be on `relic-mode` while hooks are added; note the CLAUDE.md line "each submodule is on `calum-research`, stay on it" conflicts with this, so **Calum should confirm the `relic-mode` branch** (the spec suggests it). Fallback: commit hooks straight on `calum-research`.
4. **Inventory.** Each hook is recorded in `docs/local-changes.md` (file, line, one-line call, milestone, commit hash). Created in M2.
5. **Merge check.** `git -C Content grep -n '~relic_'` and `git -C Engine-TS grep -n -i 'relic'` must list exactly the inventory. Added as a `mise` task `relics:hooks` in M2.
6. **Test loop.** `mise run live` (watcher + server, `docs/setup/script-dev-loop.md`), log in, type `::~relic_<name>`. A compile error leaves the old scripts running and prints the error (observed in the dev-loop note), so check the console after each save. Hot reload covers `.rs2` and configs; **Engine `.ts` edits need a server restart** (`mise run dev` restarts on engine `.ts` changes, `Engine-TS/package.json:19`).
7. **Docs per milestone.** Update `docs/design/roguelike-relics.md` findings that were wrong, add `docs/flows/` or `docs/design/` notes for new mechanics learnt by running, update `docs/README.md` and `docs/open-questions.md` (answer or add items), commit and push (`CLAUDE.md`).
8. **Subagents:** Sonnet or Haiku only.
9. After any submodule bump or upstream merge, run rule 5 and `python3 docs/tools/check_citations.py`.

## Layout of the mod

```
mods/relics/
  configs/   relic.varp (state), relic.param/dbtable (relic + task data), relic_keeper.npc, relic items if any
  scripts/   relic_state.rs2    constants, bit helpers, XP factor recompute
             relic_tasks.rs2    task table lookup, ~relic_task_done, ~relic_task_obj, ~relic_on_kill
             relic_offer.rs2    draw, choice dialog, grant
             relic_effects.rs2  one [proc,relic_*] per relic
             relic_death.rs2    stash + keeper
             relic_debug.rs2    [debugproc,relic_*]
```

Varps (all `scope=perm`, syntax as in `quest_doric.varp`: `[name]` then `scope=perm`): `relic_owned`, `relic_declined`, `relic_tasks_done`, `relic_xp_tier`, `relic_xp_factor`, `relic_seed`, `relic_started`, `relic_kills`, `relic_jewellery_given`, `relic_recall_a`, `relic_recall_b`, `relic_phoenix_until`. (Varp-per-bit counts: the 19 relics fit in one 32-bit bitmask because XP tiers use `relic_xp_tier`; 25 tasks fit in one mask too. Not verified: that mod varps get packed ids and persist, open question 70, settled in M1.)

---

## M1. Prove the mod loop (zero upstream edits)

**Goal:** answer open questions 70, 77 and the dialog/persistence unknowns before building on them.

- **Files:** `mods/relics/configs/relic.varp` (`relic_test`, `relic_owned`, `relic_seed`), `mods/relics/scripts/relic_debug.rs2`.
- **Scripts:** `[debugproc,relic_grant](int $bit)`-style procs. Check first whether `::~name` can pass arguments (`docs/flows/dev-cheat-commands.md`, not re-read here); if not, use fixed procs (`::~relic_demo`) and `%relic_test` as the input.
  - `[debugproc,relic_demo]`: set a bit in `%relic_owned`, show it with `mes`.
  - `[debugproc,relic_choice]`: open `~p_choice5_header` (`chat.rs2:149`; signature: five text/return pairs plus a header) with three entries and store the result.
- **Hooks:** none.
- **Test in game:** (a) `::~relic_demo`, log out, log in, check the value persisted (confirms perm varps from `mods/`, Q70). (b) `::~relic_choice` shows 3 options, the pick is stored. (c) Edit the text, save, see it change without restart. (d) Call the choice proc from a `settimer`/queue right after login to learn whether a dialog may open from login context (Q77), without touching `login.rs2` yet. (e) Test on Tutorial Island and after it.
- **Docs:** answer Q70/Q77 in `open-questions.md`; add `docs/setup/` or `design/` findings on the exact mod config shape that worked (varp, param, dbtable).
- **Done when:** persistence and the dialog work, or the failure is documented with the workaround chosen.

## M2. Engine XP and run-energy lines, hook inventory, merge check

- **Config:** set the base XP rate to 8. Engine config reads `NODE_XPRATE` (`WorldConfig.ts:237`) and the default is 1 (`:98`); memory notes say the engine ignores process env vars and uses `world.json`/`.env`, so find the supported setting by reading `Engine-TS/src/util/WorldConfig.ts` and `Environment.ts`, and record how it is set in `docs/setup/` (Q69).
- **Hook 1 (engine, `Player.ts:1829-1830`):** `const multi = allowMulti ? Environment.node.xpRate : 1; this.stats[stat] += xp * multi;` becomes a multiply by the player's relic factor. The engine needs to read a varp by name from a `Player`; read how `Player.ts` accesses varps (not yet read) and how a mod varp id is looked up (`VarPlayerType`), then pick the smallest correct edit. The factor varp holds 1, 2, 4, 8 (tiers 8x, 16x, 32x, 64x). Check the `2_000_000_000` cap logic after it (`Player.ts:1833-1836`).
- **Hook 2 (engine, `Player.ts:701-713`):** `updateEnergy` — when `stepsTaken >= 2` the else-branch subtracts `loss`. Make the energy not drop (skip the subtraction). Unlimited run energy is the default for everyone (spec section 3).
- **Files:** `mods/relics/configs/relic.varp` (add `relic_xp_factor`), `mods/relics/scripts/relic_state.rs2` (`[proc,relic_xp_recompute]` sets the factor from `relic_xp_tier`), `docs/local-changes.md` (new), `mise.toml` task `relics:hooks` (runs the two `git grep` commands from rule 5).
- **Test in game:** restart the server after the engine edits. Chop a normal tree: XP per log should be 8x base (compare with a known value, e.g. a log's `productexp` times 8; read the number from the config, do not assume). `::~relic_setxp` (debugproc setting tier 1..3 and recomputing) then chop again and check 16x/32x/64x. Run across the map and confirm the run-energy bar stays full.
- **Docs:** `docs/local-changes.md` with both engine hooks and their commits; note on how base XP and the factor combine; update the spec's "Run energy"/"XP" rows if the exact lines differ; Q69/Q74 resolved or updated.
- **Done when:** both engine edits are on `relic-mode` in Engine-TS, pushed to the fork, pointer committed, `mise run relics:hooks` lists them.

## M3. Task engine and kill hook

- **Data:** `relic_tasks` table (dbtable in `mods/relics/configs/`): task number, kind (kill/obj), NPC type or obj, tier. The 25 tasks are in the design doc table (Part 2). Tier suggestion from the spec: 1-6, 7-13, 14-23, then bosses. Pin the Kalphite soldier type name (Q73) by grepping `Content` configs for the NPC before filling task 23.
- **Scripts:** `relic_tasks.rs2`: `[proc,relic_on_kill]` (uses `npc_type` and `npc_findhero`; `npc_findhero` usage appears throughout the drop-table scripts, check its calling convention at `npc_death.rs2` before use), `[proc,relic_task_obj](obj $obj)`, `[proc,relic_task_done](int $task)` (marks the bit, then calls the offer in M4; until then just `mes`). Task-tier locking is a lookup of the lowest unfinished tier.
- **Hook (Content):** one line in `[proc,npc_death]` (`npc_death.rs2:10`) calling `~relic_on_kill;`. Read the whole proc first to choose a line where `npc_findhero` still resolves (the proc is the shared death proc for most NPCs; some `ai_queue3` scripts may not call it, Q on finding 15).
- **Debug:** `[debugproc,relic_task]` completes the task in `%relic_test`; `[debugproc,relic_tasks_reset]`.
- **Test in game:** kill a goblin (task 1): `mes` fires once, bit set, second goblin does not repeat it. Persistence across logout. Kill a non-task NPC: nothing. Check an NPC whose `ai_queue3` does not call `npc_death` and log the result (finding 15).
- **Docs:** list which NPCs bypass `npc_death` (Q finding 15), pin Q73 values, update the task table with exact type names.
- **Done when:** all kill tasks fire from real kills (bosses tested in M8), hook committed and inventoried.

## M4. Offer engine, first-login offer, celebration

- **Scripts:** `relic_offer.rs2`
  - Pool = relics not in `relic_owned`, plus the next XP tier while tier < 3 (design doc, offer mechanics rule 2).
  - Draw up to 3 distinct with `%relic_seed` advanced per draw (use the `random`-like opcodes only if they are seedable; otherwise implement a small LCG in script — which opcode exists is **not verified**, check `ScriptOpcode.ts` first).
  - Show with `~p_choice5_header` with 3 entries (leave the other two unused; check how unused slots render, M1 will show this). Track offered-not-picked in `relic_declined`.
  - Grant: set bit, or bump `relic_xp_tier` then `~relic_xp_recompute`. Hoarder second pick is M5.
  - Empty pool: skip dialog, celebrate only. 1 or 2 left: offer those.
  - `[proc,relic_celebrate]`: `spotanim_pl(levelup_anim, 124, 0)` and `~music_jingle(<midi>)` (`music.rs2:50`; take the jingle the way `levelup.rs2:24-50` does via the `levelup` dbrow) — check the actual value in `levelup.dbrow` before use.
- **Hook (Content):** one line in `login.rs2` (`[login,_]`, line 1, near the timers at `login.rs2:35-40`) calling `~relic_on_login;`. The mod proc: if `%relic_started = 0`, set it, seed the run, offer once. Defer to after Tutorial Island if M1 showed a dialog is unsafe there (spec section 9; `~in_tutorial_island` is at `teleport.rs2:97`).
- **Debug:** `::~relic_offer` (force an offer), `::~relic_seed` (set seed), `::~relic_reset` (clear all relic varps), `::~relic_grant`.
- **Test in game:** new character: first login shows the offer (or waits for the end of Tutorial Island). Same seed gives the same three. Pick one, confirm the bit; unpicked ones can reappear. Exhaust the pool with `::~relic_grant` and confirm no dialog. XP tiers advance 8x → 64x across three picks.
- **Docs:** note on the dialog from login; the chosen RNG; update Q77, Q75 (jingle overlap with a real level-up, test by levelling at the same time).
- **Done when:** a task kill leads to celebration plus offer, and first login works.

## M5. Easy relics

Build one `[proc,relic_*]` per relic, gated on its owned bit, and call it from a hook. Order below is by risk (lowest first); commit each hook separately.

| Relic | Mod proc | Hook (Content) | Test |
|---|---|---|---|
| 3 Stoneskin, 5 Glass Cannon (taken), 6 Phoenix | `~relic_damage_taken($amount)` returns the changed amount | `damage.rs2:7`, just before `damage(uid, 1, $amount)`: `$amount = ~relic_damage_taken($amount);` (`damage_self` is the only normal path, design finding 10) | take hits from a goblin with and without the relic; compare max hit. Phoenix: set a low HP, take a lethal hit, expect 1 HP then none for 5 minutes |
| 5 Glass Cannon (dealt) | `~relic_dealt($maxhit)` | `npc_combat.rs2:391` `[proc,npc_max_dealt](int $maxhit, int $spell)(int)`: wrap the return, read the proc fully before choosing the line (it has early returns) | max hit doubles on a dummy NPC |
| 7 Vampire, 9 Bounty | in `~relic_on_kill` | none (reuse the M3 hook) | heal on kill; coins/supplies appear (use `obj_add`/`inv_add`, choose which per tier in a mod table) |
| 14 Philosopher's Coin | `~relic_alch_profit` | `alchemy.rs2:25,61` | alch an item, compare coins |
| 15 Infinite Runes | `~relic_free_runes` | `magic.rs2:90` `[proc,delete_spell_runes](dbrow $spell_data)`: early `return` when owned. Check combat spells use it (Q74) | cast a combat spell, check runes |
| 16 Everlasting Jewellery | `~relic_keep_charge` | three jewellery files' charge swap (`ring_of_dueling.rs2`, `amulet_of_glory.rs2`, `necklace_of_minigames.rs2`, design finding 25); bank gift on unlock (`inv_add(bank, ...)`, once, `relic_jewellery_given`) | teleport with each, charges unchanged; bank has the three |
| 17 Last Recall | `~relic_record_origin($coord)` plus the recall action | `teleport.rs2:96` `[proc,pre_tele_checks](coord $coord)(boolean)`, at its successful end (design finding 24) | teleport, recall, recall again swaps |
| 18 Banker's Call | `@openbank` reuse (`bank_booth.rs2:5`) | none | trigger works from anywhere |
| 19 Hoarder | mod only: extra offer from `relic_declined` | none | decline some, pick Hoarder, extra pick lists a declined one |

**Decision needed before 17/18:** how the player triggers them (spec section 4: undecided). Default proposal: a debug-style chat command is not available to normal players, so use a granted item with an op handled in the mod, which also feeds M6. If an item needs a new `.obj` config, test that mod `.obj` files load (first check of Q on "item grant from mods", Part 2 Not checked).

- **Docs:** extend `docs/local-changes.md` per hook; note on each relic's verified behaviour; resolve Q74.

## M6. Death stash and Relic Keeper

- **Hook (Content):** `death.rs2:47` `[proc,player_death_lose_items]`; insert `~relic_stash_items;` immediately before the drops (`inv_dropall(inv, ...)` at about `death.rs2:97`, line re-checked at edit time).
- **Scripts:** `relic_death.rs2`: walk `inv` and `worn` for relic items (list proc), `inv_moveitem(inv, bank, obj, n)` each, message "Your relic items were sent to your bank." Handle the full-bank case (Q76): if the move fails, leave the item (it drops normally) and tell the player to visit the keeper.
- **Keeper NPC:** `mods/relics/configs/relic_keeper.npc`, `[opnpc1,relic_keeper]` dialogue that, for each owned relic with an item, re-issues it if `inv_total` is 0 across `inv`, `worn` and `bank` (stateless, no duplication). Spawn from `~relic_on_login` with `npc_add(coord, relic_keeper, duration)` if `npc_find` finds none nearby (`NpcOps.ts:57-68`; limits of `npc_add` duration, Q79). Lumbridge respawn is `0_50_50_21_18` (`death.rs2:32`).
- **Test in game:** own Everlasting Jewellery, wear and carry the items, die (low-HP fight or `::` damage command if one exists), verify items are in the bank. Drop an item, talk to the keeper, verify exactly one re-issue; repeat to confirm no duplicates. Log out/in far from Lumbridge and confirm the keeper exists once, not stacked.
- **Docs:** `docs/flows/` note for death + keeper; resolve Q76 (partial), Q79.

## M7. Medium relics

Order by increasing blast radius. Each needs the hook sites re-read first and a regression pass of the surrounding skill.

1. **Midas Loop (13)** — tail call at the end of `[label,magic_spell_high_alch]` (`alchemy.rs2:4`, `p_delay(3)` at `:37`). Test that movement or clicking interrupts the loop (Q71); if not interruptible, add a stop condition (e.g. a tick counter or inventory/rune check).
2. **Executioner (8)** — in `npc_max_dealt` need the target HP; read what NPC state is available there. If not, hook where damage is applied (`npc_combat.rs2`); decision to record in the spec.
3. **Eternal Vein (10)** and **Evergreen (11)** — the three mining labels (`mining.rs2:133,142,176,179,194,221`) and woodcutting (`woodcut.rs2:134,137`). Hooks change `inv_add(inv, …)` to the bank and skip `loc_change`. Also bypass the inventory-full checks (`mining.rs2:32,75`); read the woodcut one (Q76). Test with full inventory, full bank, and a rock/tree stays standing.
4. **Double Yield (12)** — counts at the task-detection `inv_add` sites; pair with the M3 task hooks so each site gets at most two lines.
5. **Quickstrike (4)** — the ~9 `%action_delay` sites (`player_melee.rs2:54,56`, `player_ranged.rs2:18,20,23`, `player_special_attack.rs2:18`, `auto_retaliate.rs2:9,33`, `player_magic.rs2:176`, `chompy_bird.rs2:157`, and the `pvp/` copy). Route all through `~relic_delay($base)` so each site is a one-token change; check that ranged's `sub(%action_delay, 1)` logic stays consistent (design finding 11). Verify the client plays the faster swings (not verified).
6. **Quest Pass (2)** — generate a table of (quest varp → complete constant) from `Content/scripts/quests/*/configs`. Add a script `scripts/gen-quest-table.mjs` and a check task, since a hand-written table will rot. Run it, then `~update_questpoints` (`quests.rs2:54-61`). Check what quest-gated content still refuses (Q finding 18) and record it.

Task-detection hooks (about 12 `~relic_task_obj` calls, design finding 21) are added here if not done in M3: mining `:142,179,194`, woodcut `:134`, fishing `:52,65,81,95`, cooking `:176`, firemaking `:121`, runecraft `:98`, bows `:42`, smelting `:222`, herblore `:14`, pickpocket success path (find the line, Q73). Do these together with the matching skill relic so a file is edited once.

## M8. Boss run-through and pacing

- **Win condition:** hook already exists (`npc_death`); add the win check: `king_dragon` and `kalphite_flyingqueen` (design finding 14). Test both: KBD kill from `::` teleport; KQ must be fought through form one to the `kalphite_flyingqueen` death.
- **Full run on a fresh character** with a stopwatch and notes, recording: XP per hour by method, which tasks were blocked by levels or access (spec section 9 risks), whether pool exhaustion happens before the end, and fight balance with Phoenix/Executioner/Quickstrike. Adjust tiers and numbers in the mod tables.
- **Docs:** replace the unvalidated 10-hour estimate with measured data; update the spec's risks section.
- **Done when:** a complete run was played to the win message once, with the findings written up.

## Dependencies

M1 → M2 → M3 → M4 → M5. M6 needs M5's jewellery. M7 needs M3's task hooks for sites it shares. M8 needs all. M1 and the engine part of M2 are independent and could run in parallel.

## Open decisions for Calum

1. `relic-mode` branch per fork vs committing hooks directly on `calum-research` (rule 3).
2. Trigger for Last Recall and Banker's Call (M5).
3. Whether first-login must wait for Tutorial Island completion (decided by M1 results).

## Not checked

Whether `::~name` accepts arguments; the exact way an engine edit reads a mod varp; the supported place to set `NODE_XPRATE`; seedable RNG opcodes; everything in M5-M7 beyond the signatures listed in Method; nothing here was compiled or run.

# Specification: roguelike relic mode (v1)

**Purpose:** the agreed requirements for the relic mode, written so a fresh session can produce the development plan without this conversation. Decisions here are Calum's, taken in the design thread. Evidence, line citations and feasibility reasoning are in [roguelike-relics.md](roguelike-relics.md) (read it for the "why" and the hook sites; finding numbers below refer to it). Nothing in this spec has been implemented or run.

**Based on commits:** Engine-TS `1d25566`, Content `65b754f`, RuneScriptTS `c454554`, Client-TS `7d6ca61`. Re-check hook line numbers if any submodule moves (`python3 docs/tools/check_citations.py`).

## 1. Goal

A single-player roguelike on top of LostCityRS (revision 274). The player completes tasks (kill an NPC, produce an item with a skill). Each completed task offers a pick of 3 random "game-breaking" relics. Relics speed progress with an XP multiplier that starts at 8x and reaches 64x. The run ends by killing the King Black Dragon and the Kalphite Queen. Target: a full run in roughly 10 hours of optimal play (pacing is an unvalidated estimate, see section 9).

## 2. Constraints (from the repo rules and Calum)

- Merge from upstream must stay easy. All logic lives in `mods/relics/` (RuneScript, configs). Upstream edits are limited to **one-line hook calls** (`~relic_*`) and two small engine edits, committed directly in Calum's submodule forks (`github.com/calum/*`), which `CLAUDE.md` now allows pushing to (never `LostCityRS/*`). Put them on a dedicated branch per fork (suggested `relic-mode`, branched from `calum-research`), one small commit per hook, so each can be found and re-applied when upstream is merged (`docs/setup/submodule-forks.md`). Record every hook in `docs/local-changes.md`, and after pushing in a submodule, commit and push the updated pointer in the root repo.
- Never `git push` in a submodule. Commit and push the root repo straight to `main`. Docs go in `docs/` and are updated with each finding (`CLAUDE.md`).
- A mod cannot redefine an upstream script (`[trigger,name] is already defined`, `RuneScriptTS/src/compiler/semantics/ScriptRegistration.ts:173`), has no login or NPC-death or XP trigger of its own (design doc findings 3, 7, 13), and `mods/` scripts must sit under a `scripts/` folder (`mods/README.md`).
- Client-TS is not changed in v1. Everything is server-side, using existing dialogs and effects.
- Use Sonnet or Haiku for any subagents.
- Name everything `relic_*` to avoid collisions with upstream.

## 3. Decisions already made

| Topic | Decision |
|---|---|
| XP | One multiplier for all skills and combat. Base **8x** (`NODE_XPRATE=8`). The relic tiers give **16x, 32x, 64x**. |
| Offers | On each completed task: up to **3 distinct** relics drawn with a per-run seed. Unpicked relics stay in the pool and can reappear. |
| Exhausted pool | If no relics remain, show no choice; the task still completes with the celebration. If 1 or 2 remain, offer those. |
| First login | The very first login of a character gives a pick of 3 random relics (may need to wait until after Tutorial Island, see 9). |
| Celebration | On task completion: level-up fireworks (`spotanim_pl(levelup_anim, 124, 0)`) and a level-up jingle (`~music_jingle`). Mod only. |
| Run energy | Unlimited run energy for everyone by default (not a relic). Engine edit at `Player.ts:701-712`. |
| Tasks | The 25-task list in the design doc, unchanged (18 from Calum plus 7 added). Task 3 is "Giant" because no "Hill giant" NPC exists. Tasks 24 and 25 are the bosses and give no offer. |
| Dropped | Scholar/Warlord (merged into XP Multiplier), Tutor, Prodigy, Free Teleports, Boss Key, Compass, Fleet Foot, Featherweight, Pathfinder, Reroll, Fast Hands, Smelter's Blessing. |
| Pool size | A short pool is fine for v1: 19 relics = 21 pickable. |
| Hooks | Committed in Calum's forks on a `relic-mode` branch (not patch files), per the coordinator update that forks are now pushable. |
| Death | Relic items must survive death: stash them in the bank on death (one hook), plus a "Relic Keeper" NPC in Lumbridge that re-issues missing relic items. |

## 4. Relic pool (v1)

E = easy (mod plus at most one hook line), M = medium. Hook sites are in the design doc (findings 5-28).

| # | Relic | Effect | E/M |
|---|---|---|---|
| 1 | XP Multiplier I/II/III | all XP doubled each tier: 16x, 32x, 64x total | E |
| 2 | Quest Pass | auto-complete all quests (generated table of quest varp -> complete constant) | M |
| 3 | Stoneskin | 50% less damage taken | E |
| 4 | Quickstrike | attacks twice as fast | M |
| 5 | Glass Cannon | damage dealt x2, taken x1.5 | E |
| 6 | Phoenix | first lethal hit per 5-minute window leaves 1 HP | E |
| 7 | Vampire | heal on every kill | E |
| 8 | Executioner | NPCs below 25% HP die instantly | M |
| 9 | Bounty | kills drop coins and supplies by NPC tier | E |
| 10 | Eternal Vein | ore rocks never deplete and ore goes straight to the bank | M |
| 11 | Evergreen | trees never fall and logs go straight to the bank | M |
| 12 | Double Yield | gathering and cooking give x2 items | M |
| 13 | Midas Loop | high alchemy repeats on the same stack | M |
| 14 | Philosopher's Coin | alchemy pays x2 | E |
| 15 | Infinite Runes | spells cost no runes | E |
| 16 | Everlasting Jewellery | duelling ring, glory amulet, games necklace never lose charges; unlocking puts one of each in the bank (once) | E |
| 17 | Last Recall | teleport back to where you last teleported from (swaps between the two places) | E |
| 18 | Banker's Call | open the bank from anywhere | E |
| 19 | Hoarder | one extra pick from relics previously offered and declined | E |

How a player triggers #17 and #18 (an item with an op, a command, other) is **undecided**.

## 5. Tasks

See the table in the design doc (Part 2, "The task list"). Detection: kills via one hook in `[proc,npc_death]` using `npc_type`; skilling via about 12 `~relic_task_obj` calls at the product-creation sites (finding 21). Kalphite Queen's first form does not call `npc_death`; the final kill is `kalphite_flyingqueen` (finding 14). Tasks are unlocked in tiers (suggested: 1-6, 7-13, 14-23, then the two bosses) so level requirements are reachable.

## 6. Systems to build

1. **State:** perm varps in `mods/relics/configs/` for owned-relic bitmask, XP factor, declined bitmask, task-done bitmask, kill/seed counters, `%relic_started`, jewellery-given flag, recall origin pair.
2. **Task engine:** `~relic_task_done` (celebration, mark task, call offer).
3. **Offer engine:** seeded draw of 3 from the eligible pool, choice dialog (`~p_choice5_header`), grant effect, Hoarder second chance.
4. **Relic effects:** one `[proc,relic_*]` per relic, gated on the owned bitmask, called from the hooks.
5. **Death handling:** stash relic items to the bank; Relic Keeper NPC (stateless re-issue across inv, worn, bank), spawned from the login hook with `npc_add`.
6. **Dev tools:** `[debugproc,relic_*]` commands (grant, reset, set seed, complete task) usable as `::~relic_grant` etc.
7. **Upstream merge routine:** `git fetch upstream` and merge into the fork branch as in `docs/setup/submodule-forks.md`; a conflict can only occur on a hook line. Add a `mise` task or script that lists all `relic_` hook lines (`git grep -n '~relic_'` in each submodule) so a merge can be checked quickly; and keep `docs/local-changes.md` as the hook inventory.

## 7. Upstream edits (approximately 25 one-line hooks in ~13 Content files, plus 2 engine lines)

- Engine `Player.ts:1830`: multiply by the relic XP factor varp. Engine `Player.ts:701-712`: no run-energy drain.
- `login.rs2` (first-login offer, ensure keeper NPC), `npc_death.rs2:10` (kill tasks, Vampire, Bounty, win check), `damage.rs2:7` (Stoneskin, Glass Cannon, Phoenix), `npc_combat.rs2:391` (`npc_max_dealt`: Glass Cannon, Executioner), `death.rs2:97` (stash items), `teleport.rs2` (`pre_tele_checks` origin), `magic.rs2:90` (`delete_spell_runes`), `alchemy.rs2` (repeat and profit), 3 jewellery files, `mining.rs2` (3 labels), `woodcut.rs2:134,137`, ~9 attack-delay sites (Quickstrike), and the task-detection sites for each skill (finding 21).

## 8. Out of scope for v1

Client changes or new interfaces; multiplayer; relics that skip level requirements; drop-rate relics; one-click crafting; crafting-failure removal; any relic that points at the next task; more than the 19 relics above.

## 9. Unverified and risky (see `docs/open-questions.md` 69-79)

- Nothing has been compiled or run; every hook site is from reading code.
- First-login offer vs Tutorial Island, and opening a dialog from `[login,_]` (77).
- Whether a new `scope=perm` varp from `mods/` persists (70); whether the high-alch loop is interrupted (71); `HEALENERGY` semantics (74); combat spells and `delete_spell_runes` (74); the Evergreen full-inventory/bank-full behaviour (76); `npc_add` duration and mod NPC id assignment (79).
- Task details still to pin: Kalphite soldier type (73) (pickpocket line and super attack dose answered: brewing makes `3dose2attack`, `relics-e2e-tests.md`); whether every task site is reachable on a fresh character.
- The 10-hour target is an estimate that rests on an illustrative XP rate, not data.

## 10. What the development plan should cover

Milestones in the order suggested in the design doc: (1) prove the mod loop with zero upstream edits (varp, debugproc, choice dialog, persistence across logout); (2) engine XP and run-energy lines plus the hook inventory (`docs/local-changes.md`) and the `git grep ~relic_` check; (3) task engine and kill hook; (4) offer engine, first-login offer and celebration; (5) easy relics; (6) death stash and Relic Keeper; (7) medium relics; (8) boss run-through and pacing tuning. For each milestone: files, hooks, test via `::~relic_*` in a running server, docs updated, and a check that every hook line is still present after any upstream merge.

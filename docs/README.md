# Documentation index

These notes are published as a searchable site at <https://calum.github.io/LostCityRs/> (built from `mkdocs.yml` by `.github/workflows/docs.yml` on every push to `main`). Preview locally with `mise run docs:serve`.

Rules: everything here must be evidenced and accurate. See [`../README.md`](../README.md#ground-rules-evidence-only-no-guessing) and [`../CLAUDE.md`](../CLAUDE.md).

## Notes

### Reader's guide

- [guide/a-short-introduction-to-the-tick.md](guide/a-short-introduction-to-the-tick.md): a short illustrated book for a reader new to the engine: what a tick is, the eleven phases, a player's and an NPC's turn, packets in and out, a tick-by-tick worked example (chopping a tree) and a crib for reading scripts. Compiled from the notes below (read from code, not run). Kindle edition: [guide/a-short-introduction-to-the-tick.epub](guide/a-short-introduction-to-the-tick.epub). Regenerate with `python3 docs/guide/gen_images.py` then `python3 docs/guide/build_epub.py`.

### Project history

- [history/project-origins.md](history/project-origins.md): how Lost City started and how the server was recreated (cache = assets only; logic and RuneScript recreated by the team). Based on submodule git history and READMEs plus a user-pasted forum FAQ (not fetched; unverified against the live page).

- [guide/an-introduction-to-runescript.md](guide/an-introduction-to-runescript.md): Book 3 in readable form, with figures. Source files to bytecode, headers and lookup keys, the language, the VM, pointers and protected access, commands, reading a script. Evidence: [books/runescript-intro/](books/runescript-intro/README.md). EPUB: [guide/an-introduction-to-runescript.epub](guide/an-introduction-to-runescript.epub). Build with `python3 docs/guide/gen_images_runescript.py` then `python3 docs/guide/build_epub_runescript.py`.
- [guide/how-multi-tick-scripts-run.md](guide/how-multi-tick-scripts-run.md): Book 4 in readable form, with figures. Suspension, queues, timers, re-arming loops, eight short and six long worked examples, the client side. Evidence: [books/multi-tick-scripts/](books/multi-tick-scripts/README.md). EPUB: [guide/how-multi-tick-scripts-run.epub](guide/how-multi-tick-scripts-run.epub). Build with `python3 docs/guide/build_epub_multitick.py` (images are checked in).

### Local setup

- [setup/local-setup-with-mise.md](setup/local-setup-with-mise.md): installing mise, the services `npm start` brings up (world, game TCP, web, management) and the tasks in the root [`mise.toml`](../mise.toml) that build and run them. `mise run up` was run on Linux: server started and a headless browser logged in. Not run on Windows.
- [setup/submodule-forks.md](setup/submodule-forks.md): the submodules now point at Calum's forks (`github.com/calum/*`); fork URLs, why `gh` could not create them, and how to add a fetch-only `upstream` remote and merge upstream changes. Based on `git ls-remote` (fork HEAD equals upstream HEAD for all five).
- [setup/script-dev-loop.md](setup/script-dev-loop.md): writing your own RuneScript and running it live on your character. The engine already hot-reloads `.rs2`/config edits (`DevThread`, `World.reload`); observed edit, compile error and reload in a headless browser; the `mods/` folder and `mise run mods:sync|mods:watch|live` tasks; what is and is not known about client-side scripts.

### Reference

- [reference/coordinates.md](reference/coordinates.md): what a coord literal such as `0_41_51_39_38` means (`level_mapX_mapZ_localX_localZ`), how it packs, and how to turn a map square plus a tile on the map page into one. Read from code, not run.

### Design

- [design/roguelike-relics-spec.md](design/roguelike-relics-spec.md): the agreed v1 specification for the relic mode (decisions, tasks, 19-relic pool, systems, upstream edits, out of scope, risks), written as the input for a development plan.
- [design/roguelike-relics-dev-plan.md](design/roguelike-relics-dev-plan.md): development plan for the relic mode, eight milestones in build order (prove the mod loop, engine XP/run-energy lines, task engine, offers, easy relics, death stash and keeper, medium relics, boss run and pacing), each with files, hooks, in-game test and docs update. Hook sites re-read at the listed commits; nothing compiled or run.
- [design/roguelike-relics.md](design/roguelike-relics.md): design guidance for a relic-based roguelike mode. Part 2: 25 tasks, 3-choice offer mechanics and a 19-relic pool (21 pickable; 8x to 64x XP multiplier, infinite jewellery, last recall, task celebration) with hooks per relic. What a mod can and cannot do (no script override, one global XP rate, no kill or XP trigger), the verified hook points (`addXp`, `damage_self`, `npc_death`, login, mining, high alch, attack delay), a feasibility table per relic, and a patch-series approach to keep upstream merges easy (read from code, not run).

### Traced flows

- [flows/click-loc-woodcutting.md](flows/click-loc-woodcutting.md): clicking a tree. Client packet, engine decode/handler, interaction processing in the tick, and the Content script that runs (read from code, not run).
- [flows/server-response-woodcutting.md](flows/server-response-woodcutting.md): the return path. How `mes`, `anim`, `sound_synth`, `inv_add` and `stat_advance` become packets and what the client does with them (read from code, not run).
- [flows/move-opclick.md](flows/move-opclick.md): how the client's walking route (`MOVE_OPCLICK`) is decoded, queued as waypoints and walked tick by tick (read from code, not run).
- [flows/dev-cheat-commands.md](flows/dev-cheat-commands.md): how `::` cheat commands get from the chat box to the engine, which staff level unlocks which command, why a default local player is staff level 4, and the `~` debug procs (read from code, not run; no command was typed in-game).
- [flows/script-testing.md](flows/script-testing.md): how RuneScript is checked. No unit-test harness; CI only lints/typechecks the engine and packs (compiles) Content; the compiler's parse/type/pointer errors exit 1; runtime testing is manual `~debugproc` scripts in `Content/scripts/_test` (read from code, not run).

### Books

Series index and reading order (tick guide, project history, RuneScript, then multi-tick scripts): [books/README.md](books/README.md).

- [books/multi-tick-scripts/README.md](books/multi-tick-scripts/README.md): Book 4, how multi-tick scripts run. Suspension model (`ScriptState`, the interpreter loop, the seven suspending commands, every resume site), queues/timers/re-arming loops, eight simple and six complex worked examples from Content with tick timelines, and the client side (interface expressions are the only client "scripts"; nothing on the client spans ticks as a script). Read from code, not run. EPUB: [books/multi-tick-scripts/multi-tick-scripts.epub](books/multi-tick-scripts/multi-tick-scripts.epub).

- [books/runescript-intro/README.md](books/runescript-intro/README.md): Book 3, an introduction to RuneScript. Toolchain (`.rs2` to `script.dat` to the VM), config languages, script headers/triggers/lookup keys (what `_tree` means), syntax and types, pointers and protected access, commands, three real scripts line by line, glossary. Answers open questions 5, 25 (by reading) and 30. Read from code, not run. EPUB: [books/runescript-intro/runescript-intro.epub](books/runescript-intro/runescript-intro.epub). Regenerate both book EPUBs with `python3 docs/books/build_epub.py` (needs `markdown-it-py`).

### One game tick (notes in tick order)

Start with the overview, then follow the phases in the order `World.cycle()` runs them.

- [tick/00-overview.md](tick/00-overview.md): one game tick at L1, compiled from notes 01-11: the eleven phases and the tail in order, each with its purpose and most important ordering rule, tick length and rescheduling, the per-tick order of one player and one NPC, where the code comments are wrong, and what the earlier provisional overview got wrong (read from code, not run).
- [tick/01-world.md](tick/01-world.md): phase 1 `processWorld`. World queue (`world_delay` scripts) delay and order rules, the delayed-obj queue, and NPC player-hunt (read from code, not run).
- [tick/02-clients-in.md](tick/02-clients-in.md): phase 2 `processClientsIn`. Player order (`playerLoop` buckets), per-tick packet limits and what happens to the excess, which state each packet handler sets and which phase consumes it, delayed/busy handling, afk-event roll and input tracking (read from code, not run).
- [tick/03-npc-event-queue.md](tick/03-npc-event-queue.md): phase 3 `processNpcEventQueue`. What queues `ai_spawn`/`ai_despawn` triggers and in which phase, the delayed-NPC gate, same-tick rules for entries and NPCs added during the phase, and the unguarded crash path (read from code, not run).
- [tick/04-npcs.md](tick/04-npcs.md): phase 4 `processNpcs`. Per-NPC turn order (resume, lifecycle, hunt, regen, timer, queue, modes, facing), what "not busy" means (`isValid`: active and not delayed), delay/queue/timer/regen counter semantics, per-NPC exception handling, adds/removes during the loop, and which NPC state phase 5 sees (read from code, not run).
- [tick/04b-npc-modes.md](tick/04b-npc-modes.md): phase 4 part 2, `processMovementInteraction`. Each NPC mode per tick (none, wander, patrol, escape, follow, face, `aiMode` op/ap), target validation and max range from spawn, how an NPC runs `ai_op*`/`ai_ap*` against a player, the one-step-per-tick movement rule and post-move facing (read from code, not run).
- [tick/05-players-queues-timers.md](tick/05-players-queues-timers.md): phase 5 part 1, `processPlayers` up to the engine queue. Per-player turn order (undelay, resume of `SUSPENDED` scripts, strong-queue modal close, normal and weak queues, normal and soft timers, engine queue), the `canAccess` gate, queue and timer counter semantics, what a delay-0 enqueue does in the same tick, `loggingOut` and timers, the per-player `catch`, and a player-vs-NPC comparison (read from code, not run).
- [tick/06-players-interaction-movement.md](tick/06-players-interaction-movement.md): phase 5 part 2, `processPlayers` from facing onward. Target facing (`setFaceEntity`/`reorientEntity` before the interaction, `reorient` after), `processInteraction` (pre-move and post-move op/ap attempts, target validation, `p_aprange`, "I can't reach that!", what clears the target), the walk trigger, walking 1 / running 2 tiles per tick and `stepsTaken`, run energy, the `jump` check skipped for `EXACT_MOVE`, and which gates (`delayed`, modal, `protect`) apply to each step (read from code, not run).
- [tick/07-logouts-logins.md](tick/07-logouts-logins.md): phases 6 and 7, `processLogouts` and `processLogins`. What requests a logout (`p_logout`, idle packet, 50/100-tick timeouts, kicks), the `p_preventlogout` window, the removal conditions (`canAccess`, empty engine queue, only discardable `LONG` entries) and what removal runs, the tick a player is gone; how login requests reach `newPlayers` between ticks, what the login tick sends (map in phase 7, inventories and stats in phase 10), when a new player first appears in each phase, and reconnects (read from code, not run).
- [tick/08-zones.md](tick/08-zones.md): phase 8 `processZones`. The loc/obj timer list (despawn, respawn, revert of changed locs, obj reveal after 100 ticks) and when timers fire, what a zone event is (`ENCLOSED` shared vs per-player `FOLLOWS`), which phases add them, the shared buffer computed after this tick's timers, how phase 10 builds each player's active zones and sends full/partial zone updates, phase-11 reset, `loc_change` traced to the packet, and the phase-wide `catch` (read from code, not run).
- [tick/09-info.md](tick/09-info.md): phase 9 `processInfo`. Per-entity pre-encoding of player/NPC update blocks vs per-observer encoding in phase 10, which entity fields are read, `walkDir`/`runDir`/`tele`/`jump` bit layouts, the mask writers and the one writer after phase 9 (phase 11 `FACE_ENTITY`), where NPC observer counts change (and how they can drift), login/logout/reconnect, and the missing `catch` (read from code, not run).
- [tick/10-clients-out.md](tick/10-clients-out.md): phase 10 `processClientsOut`. The order of everything a player is sent in a tick (camera, `SET_MULTIWAY`, player info, NPC info, zones, inventories and run weight, stats and run energy, interface close/open/overlay), which script effects are written immediately in earlier phases and which are deferred to phase 10, the size budgets and per-packet limits (no per-tick limit), disconnected and closed sockets, the per-player `catch`, and how the bandwidth stat is counted (read from code, not run).
- [tick/11-cleanup-and-tail.md](tick/11-cleanup-and-tail.md): phase 11 `processCleanup` and the end of `cycle()`. What is reset (zones, player/NPC per-tick fields and masks, the `FACE_ENTITY` re-arm, inventory tracking, shop restock, rsbuf) and why after phase 10; shutdown handling and the `tickRate` 0 speed-up, autosave (1500 ticks) and check-in log (50 ticks), log flushing, stats and Prometheus, when `currentTick` increments, the drift/rescheduling formula with worked arithmetic, the crash path and which phases catch exceptions (read from code, not run).

### Cross-cutting tick notes

- [tick/ordering-matrix.md](tick/ordering-matrix.md): which of the 11 phases (and the tail of `cycle()`) reads or writes each piece of player, NPC, world/zone and network/output state, with a pointer to the note rule for every cell; labelled conclusions on same-tick vs next-tick hand-offs, state written in several phases, writes outside the phase order, and a consolidated exception-path table (synthesised from notes 01-11; code read, not observed).
- [tick/scenarios.md](tick/scenarios.md): four worked tick-by-tick timelines that cross-check notes 01-11 and the flow notes: chopping a tree (approach, op, chop loop, packets back), walking vs running a `MOVE_OPCLICK` route, an NPC op while the NPC runs a queued script (with and without `npc_delay`), and packets while a script is delayed and queue entries wait (refusals, weak-queue clearing, `canAccess` gates); each states where the result depends on packet arrival within the 600 ms window (synthesised from notes; code read, not observed).

Add each new note here with a one-line summary. Unverified items live in [open-questions.md](open-questions.md). `docs/tools/check_citations.py` checks that each recorded commit hash matches the submodule's HEAD, that repo-prefixed citations (`Engine-TS/...:N`) are inside the cited file, and that a snippet quoted right after a citation appears at the cited lines; it does not parse un-prefixed citations such as `Client.ts:5847`, which the flow notes also use.

## Note template

```markdown
# <Title>

**Question answered:** <one sentence>

**Based on commits:**
- Engine-TS: `<hash>` (branch `calum-research`, based on `<upstream branch>`)
- Content: `<hash>`
- Client-TS: `<hash>`
- (only list the repos actually read)

**Method:** read code / ran the server and observed (say which)

## Findings

1. <Claim>. Source: `Engine-TS/src/...:LINE`
   ```ts
   // short quoted snippet if it carries the meaning
   ```

## Inferences (labelled)

- <Inference> — rests on findings 1 and 3.

## Not checked / open questions

- <Thing not verified>. Also logged in `open-questions.md`.
```

# Documentation index

Rules: everything here must be evidenced and accurate. See [`../README.md`](../README.md#ground-rules-evidence-only-no-guessing) and [`../CLAUDE.md`](../CLAUDE.md).

## Notes

### Project history

- [history/project-origins.md](history/project-origins.md): how Lost City started and how the server was recreated (cache = assets only; logic and RuneScript recreated by the team). Based on submodule git history and READMEs plus a user-pasted forum FAQ (not fetched; unverified against the live page).

### Traced flows

- [flows/click-loc-woodcutting.md](flows/click-loc-woodcutting.md): clicking a tree. Client packet, engine decode/handler, interaction processing in the tick, and the Content script that runs (read from code, not run).
- [flows/server-response-woodcutting.md](flows/server-response-woodcutting.md): the return path. How `mes`, `anim`, `sound_synth`, `inv_add` and `stat_advance` become packets and what the client does with them (read from code, not run).
- [flows/move-opclick.md](flows/move-opclick.md): how the client's walking route (`MOVE_OPCLICK`) is decoded, queued as waypoints and walked tick by tick (read from code, not run).

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

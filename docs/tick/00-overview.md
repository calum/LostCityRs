# Game tick overview (L1)

**Question answered:** In what order does one game tick run its phases, what does each phase do, which ordering rule matters most in each, and how long is a tick?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only, compiled from the verified phase notes 01-11 (each re-read for this overview; the cited lines below were re-opened at the commit above). Nothing was run: every statement here is "read, not observed". Details, quotes and proofs are in the linked notes; this page adds nothing they do not establish. Pointers like `05#8` mean "note 05, L3 rule 8"; `05§L2` means note 05's L2 section, `04§Inf` its Inferences section and `02§Pos` its "Position in the tick" section (the notation of [`ordering-matrix.md`](ordering-matrix.md)).

Related: [`ordering-matrix.md`](ordering-matrix.md) (which phase reads/writes which state), [`scenarios.md`](scenarios.md) (four worked tick-by-tick timelines).

## Phases

`World.cycle()` calls these eleven functions in this order, then runs a "tail" (`Engine-TS/src/engine/World.ts:340-508`). Every phase sees the same `currentTick` (rule in the Tail row).

| # | Phase | What it does (from the note's L2) | Note | Most important ordering rule |
|---|---|---|---|---|
| 1 | `processWorld` | Resumes due world-queue scripts (suspended by `world_delay`) in FIFO order; then places due delayed objs (`inv_dropitem_delayed`); then, if any player is logged in, each active NPC with a `PLAYER` hunt and at least one observer may pick a `huntTarget` (it does not act on it yet). | [01](01-world.md) | An entry is enqueued with `delay + 1` and runs when its pre-decrement delay is `<= 0`, so `world_delay(d)` runs on the (d+2)th phase-1 visit (01#2, 01#4; `Engine-TS/src/engine/World.ts:1249-1250`, `Engine-TS/src/engine/World.ts:535-539`). |
| 2 | `processClientsIn` | For each player in `playerLoop` order: `playtime++`; every 500 ticks re-roll `afkEventReady`; input-tracking flush check; for a connected client, decode buffered packets, running each handler at once, until 5 accepted user events or 20 client-category events (rejected user events count toward the 20) are reached, the rest waiting in the buffer (02#5, 02#6, 02#9); then, only if a move packet queued a path or an op packet was accepted, set `moveClickRequest`, or drop the path if the player became delayed mid-decode (02#12); post public chat. | [02](02-clients-in.md) | While `delayed`, move and op packets are consumed and dropped (`UNSET_MAP_FLAG`), not deferred (02#15; `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12-15`). Op/move packets only arm state for phase 5; button, held-item and resume packets run their scripts now (02#13). |
| 3 | `processNpcEventQueue` | Runs queued `ai_spawn`/`ai_despawn` trigger scripts in FIFO order, each with a fresh script state; entries whose NPC is `delayed` stay queued. No timing stat, no `try`/`catch`. | [03](03-npc-event-queue.md) | Triggers queued in phases 1-2 run in this tick's phase 3; those queued in phase 4 or later run in the next tick's (or later, if the NPC is delayed) (03#13; `Engine-TS/src/engine/World.ts:648-657`). |
| 4 | `processNpcs` | For each NPC by ascending nid, `turn()`: undelay and resume an `NPC_SUSPENDED` script; lifecycle (respawn, revert, despawn); then, only if valid: hunt, consume hunt target, regen, timer, queue, mode (which moves at most one step), facing. An NPC whose turn throws is passed to `removeNpc(npc, 0)`. | [04](04-npcs.md), [04b](04b-npc-modes.md) | "Not busy" is `isValid()`, active and not delayed, checked once, after the resume and lifecycle steps (04#4; `Engine-TS/src/engine/entity/Npc.ts:152-155`). |
| 5a | `processPlayers` (first half) | For each player in `playerLoop` order, with no turn-level gate: undelay; if not delayed, resume a `SUSPENDED` script; close the modal if a `STRONG` entry or a close request exists; normal queue; weak queue; normal then soft timers (both skipped while `loggingOut`); engine queue. | [05](05-players-queues-timers.md) | `canAccess()` (not `protect`, not `delayed`, no main/chat modal; always true once `World.shutdown`) is checked per entry for the queues, normal timers and the engine queue; soft timers ignore it (05#8, 05#17; `Engine-TS/src/engine/entity/Player.ts:825-832`). |
| 5b | `processPlayers` (second half) | Same turn, continued: `setFaceEntity`, `reorientEntity`, `processInteraction` (with a target and `canAccess()`: validate target, failing which the turn's movement is skipped, and a pre-move op/ap attempt; if no interaction ran: move (at most 1 tile walking, 2 running), then a post-move attempt, again only with a target and `canAccess()`), `reorient`, `updateEnergy` (skipped while `delayed`), jump check. | [06](06-players-interaction-movement.md) | An op on a loc/obj fires only in a tick with no step (`tryInteract(stepsTaken === 0)`), so after walking it fires the tick after arrival; a player/NPC op can fire in the arrival tick (06#17 and its Inferences; `Engine-TS/src/engine/entity/Player.ts:1287-1297`). |
| 6 | `processLogouts` | For each player: timeouts (world shutdown, or 100 ticks without input bytes, forces `loggingOut`; 50 ticks without a connection requests an idle logout); consume logout requests (one blocked by the `p_preventlogout` window is dropped; an explicit one must be made again); for a `loggingOut` player, if the logout is forced or the `p_preventlogout` window is over (`Engine-TS/src/engine/World.ts:764`), `closeModal()` and, if allowed, the `[logout,_]` script and removal. Then post pending saves to the login thread. | [07](07-logouts-logins.md) | Removal needs `canAccess()` (always true during shutdown), an empty engine queue and a normal queue holding only `LONG` entries with `logoutAction` 1; a "forced" logout skips only the anti-logout window, not these (07#6, 07#7; `Engine-TS/src/engine/World.ts:779-791`). |
| 7 | `processLogins` | Applies `newPlayers` (filled between ticks by login-thread replies): refuses pending-save, duplicate, shutdown-soon and world-full logins; re-attaches a reconnect to the existing player; otherwise takes the lowest free slot, adds the player to `playerLoop` and runs `onLogin` (map rebuild, varps, `[login,_]` script, all written at once). | [07](07-logouts-logins.md) | A player added in phase 7 of tick T is in phases 9-11 of T but gets its first input decode, phase-5 turn and logout check in T+1 (07#16, 07#17; `Engine-TS/src/engine/World.ts:893-944`). |
| 8 | `processZones` | Runs loc/obj timers (despawn, respawn, revert of changed map locs, obj reveal) in the order they were started; then encodes each tracked zone's `ENCLOSED` events into its shared buffer. Does not iterate players or build any active-zone list. | [08](08-zones.md) | The shared buffer is computed after this tick's timers and after every zone event from phases 1-7; no zone event is queued in phases 9-11 (08#18, 09#18; `Engine-TS/src/engine/World.ts:966-980`). |
| 9 | `processInfo` | If anyone is online: per player `rebuildNormal` (may write `REBUILD_NORMAL` at once), appearance bytes, `computePlayer`; then per NPC `computeNpc`. Copies fields into rsbuf and pre-encodes each entity's update blocks once; per-observer `PLAYER_INFO`/`NPC_INFO` is built in phase 10. No `try`/`catch`. | [09](09-info.md) | Masks and block fields are read as they stand after phase 8 (last write wins); the only mask written after phase 9 is phase 11's `FACE_ENTITY` re-arm (09#16, 09#18; `Engine-TS/src/engine/entity/PathingEntity.ts:606`). |
| 10 | `processClientsOut` | For each **connected** player: `updateMap` (queued camera packets, `SET_MULTIWAY` when the zone changed and its multiway state differs from the previous zone's, zone/mapzone triggers enqueued), `PLAYER_INFO`, `NPC_INFO`, zone packets, inventories then run weight, stats then run energy, afk-zone tracking (no packet), interface close/open/overlay. Disconnected players are skipped entirely. | [10](10-clients-out.md) | Every packet is handed to the socket when written (no output queue, no flush), so all of a player's immediate packets from phases 1-9 precede its phase-10 packets (10#1, 10#13; `Engine-TS/src/engine/entity/NetworkPlayer.ts:191-228`). |
| 11 | `processCleanup` | Resets tracked zones; per player `resetEntity(false)` and inventory tracking; per NPC `resetEntity(false)`; world inventory tracking, then shop restock; `rsbuf.cleanup()`. Runs no script, writes no packet. | [11](11-cleanup-and-tail.md) | Per-tick state (masks, `walkDir`/`runDir`, `tele`/`jump`, `stepsTaken`, `lastTickX/Z`) is cleared only here, after phase 10 has read it; `setFaceEntity()` then re-arms `FACE_ENTITY`, which is sent next tick (11#4, 11#5; `Engine-TS/src/engine/entity/PathingEntity.ts:593-631`). |
| tail | rest of `cycle()` | `processShutdown` on shutdown ticks; autosave every 1500 ticks; check-in log every 50; log flush; stats; `currentTick++`; reschedule. | [11](11-cleanup-and-tail.md) | `currentTick` is incremented once, here, so all eleven phases and the tail of a tick see the same number (11#12; `Engine-TS/src/engine/World.ts:503`). |

## Tick length and rescheduling

- The constant is 600 ms: `TICKRATE: number = 600` (`Engine-TS/src/engine/World.ts:120`). The variable used for scheduling is `tickRate`, initialised from it (`Engine-TS/src/engine/World.ts:163`) and changed only by `processShutdown` (to 0, `Engine-TS/src/engine/World.ts:1235`) and the developer cheat `::speed` (non-production, staff level 4 or more, at least 20 ms; `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:57`, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:154-167`) (11#19).
- Start: `nextTick = Date.now() + 600`, then the first `cycle()` is called at once (`Engine-TS/src/engine/World.ts:333-334`).
- Each cycle reads `drift = max(0, start - nextTick)` at its start (`Engine-TS/src/engine/World.ts:342-343`), and at its end does `currentTick++`, `nextTick += tickRate` and `setTimeout(cycle, max(0, tickRate - elapsed - drift))` (`Engine-TS/src/engine/World.ts:503-508`) (11#12, 11#19).
- **Inference** (11#19 worked arithmetic, 11#20): ticks never overlap or get skipped, since the next one is scheduled only at the end of the current one; the formula removes only lateness beyond one tick, so small timer lateness accumulates to about 600 ms and then stops. Not observed (open question #44).
- Shutdown: `processShutdown` sets `tickRate = 0` in the tail of the fourth shutdown tick (`duration > 2`), unless it has already called `process.exit(0)` earlier in that call because no player and no pending logout save remain (`Engine-TS/src/engine/World.ts:1228-1236`; 11#13). **Inference** (11#21): from `shutdownTick + 4` the ticks then run back to back; how fast `setTimeout(..., 0)` fires was not read.
- If an exception escapes a phase, `cycle()`'s `catch` removes every player and calls `process.exit(1)`; no further tick is scheduled (11#22; `Engine-TS/src/engine/World.ts:509-526`). Which phases catch what is tabulated in 11#24.

## Per-tick order of one player

A player's whole phase-5 turn finishes before the next player's starts; players are taken in `playerLoop` order (address-based bucket, then login order; not slot order) in phases 2, 5, 6, 9, 10 and 11 (02#1-3, 05#1, 07§L2 phase 6 step 2, 09§L2 step 2, 10§L2 step 2, 11§L2 step 3). Within phase 5 there is no early return; each step has its own gate (05§L2). Sources: `Engine-TS/src/engine/World.ts:692-726`.

1. Undelay if `currentTick >= delayedUntil` (`Engine-TS/src/engine/World.ts:692`; 05#4).
2. If not delayed, resume a `SUSPENDED` script, protected and forced (`Engine-TS/src/engine/World.ts:694-697`; 05#5-6).
3. `processQueues`: modal close on a `STRONG` entry or close request, then normal queue, then weak queue (`Engine-TS/src/engine/World.ts:701`; 05#10-12).
4. Normal timers, then soft timers, unless `loggingOut` (`Engine-TS/src/engine/World.ts:702-707`; 05#17-19).
5. Engine queue (`Engine-TS/src/engine/World.ts:709`; 05#20-21).
6. `setFaceEntity` (`Engine-TS/src/engine/World.ts:713`; 06#1).
7. `reorientEntity` (`Engine-TS/src/engine/World.ts:714`; 06#2).
8. `processInteraction` (`Engine-TS/src/engine/World.ts:717`; `Engine-TS/src/engine/entity/Player.ts:1247-1313`; 06#4-20): with a target and `canAccess()`, validate the target (on failure clear it and the waypoints and return: no movement this tick) and try a pre-move interaction; only if no interaction ran: re-path (player/NPC targets only), move at most 1 tile walking or 2 running, and, with a target, `canAccess()` and not following, a post-move attempt (06#5, 06#17, 06#18). Then the target is kept, replaced by a script-set one, or cleared (06#19).
9. `reorient` (loc/obj facing on a zero-step tick) (`Engine-TS/src/engine/World.ts:719`; 06#21).
10. `updateEnergy`, which returns at once while `delayed` (`Engine-TS/src/engine/World.ts:722`; `Engine-TS/src/engine/entity/Player.ts:701-704`; 06#22).
11. `validateDistanceWalked`, unless `EXACT_MOVE` is set (`Engine-TS/src/engine/World.ts:724-726`; 06#23).

## Per-tick order of one NPC

`Npc.turn()`, once per NPC per tick in phase 4, ascending nid (`Engine-TS/src/engine/entity/Npc.ts:109-192`; 04§L2):

1. If active: undelay, then resume an `NPC_SUSPENDED` script (`Engine-TS/src/engine/entity/Npc.ts:110-118`; 04#6-7).
2. If not delayed: lifecycle countdown and respawn/revert/despawn, also for inactive NPCs (`Engine-TS/src/engine/entity/Npc.ts:120-150`; 03#4-5).
3. Return unless `isValid()` (`Engine-TS/src/engine/entity/Npc.ts:152-155`; 04#4).
4. Non-player hunt and `huntClock++` (`Engine-TS/src/engine/entity/Npc.ts:157-170`; 04#9).
5. Consume hunt target; 6. regen; 7. `ai_timer`; 8. NPC queue (`Engine-TS/src/engine/entity/Npc.ts:172-179`; 04#10-13).
9. Mode, interaction and at most one step (`Engine-TS/src/engine/entity/Npc.ts:180-181`; 04b).
10. `reorientEntity`, `reorient`, `setFaceEntity`, `validateDistanceWalked`, all after movement (`Engine-TS/src/engine/entity/Npc.ts:186-191`; 04b#17).

**Inference** (04§Inf): in phase 5 players see NPCs after this tick's NPC movement, while NPCs in phase 4 see players where they were before this tick's player movement.

## Quick answers (pointers)

- **First tick a spawned NPC can move:** a brand-new NPC keeps `moveSpeed = INSTANT` until the first phase 11 after it is created, so if added in tick T it can first step in T+1; a respawned NPC was reset to `WALK` by phase 11 while it waited, so it can step in phase 4 of its respawn tick (04b#16 and Inferences, read, not observed).
- **First data a player gets after login:** login packets and the map rebuild are written at once in phase 7 of tick T; every active zone in full, the transmitted inventories, run weight, all stats and run energy in phase 10 of T; its first input decode, phase-5 turn and logout check are in T+1 (07#15, 07#16, 07#17).
- **NPC observer count, read vs updated:** read only by the hunt gates in phases 1 and 4; changed in phase 10 (per observer list add/remove, plus clears without a decrement), by player removal (phase 6, the shutdown force-removal, the crash path), and by a first spawn (reset to 0) or a `DESPAWN` removal (record deleted). So phases 1 and 4 of T see the value left by T-1's phase 10, apart from those removals and spawns, and it can drift from the true number of viewers (09#19, 09#20, 09#21, 09 Inferences).

## Where comments in the code are wrong or incomplete

Each item is established in the named note's comment-versus-code section.

- `cycle()` "world queue - npc hunt" omits the delayed-obj queue (`Engine-TS/src/engine/World.ts:345-347` vs `Engine-TS/src/engine/World.ts:563-575`); "npc hunt" is only `PLAYER` hunts (01).
- `cycle()` "process pathfinding/following request" has no code step, and "client input tracking", listed last, runs before decoding (`Engine-TS/src/engine/World.ts:353-354` vs `Engine-TS/src/engine/World.ts:615-617`) (02).
- `processNpcEventQueue` header "Despawn and respawn": the phase only runs the triggers (`Engine-TS/src/engine/World.ts:647`) (03).
- `cycle()` "npc processing (if npc is not busy)": NPCs have no `busy()`; the gate is `isValid()`, and the list omits lifecycle, hunt and facing (`Engine-TS/src/engine/World.ts:360-366`) (04).
- `reorientEntity` doc "Refreshed every turn BEFORE movement" is wrong for NPCs, which call it after movement (`Engine-TS/src/engine/entity/PathingEntity.ts:363-369`) (04b).
- `npc_arrivedelay` "If npc moved 1 tick ago, delay for 1 tick..." does not match the plain reading of the code's tick arithmetic (`lastMovement` is stored as `currentTick + 1`); whether the comment counts ticks differently was not determinable (`Engine-TS/src/engine/script/handlers/NpcOps.ts:561`) (04b).
- `cycle()` and `processPlayers` header "close interface if attempting to logout": no such step in phase 5; it is in `processLogouts` (`Engine-TS/src/engine/World.ts:377`, `Engine-TS/src/engine/World.ts:686`) (05).
- `EntityTimer.clock` doc "Tracks the time until execution": it holds the tick the timer was set or last fired (`Engine-TS/src/engine/entity/EntityTimer.ts:36-39`); "set clock back to interval" sets it to the current tick (`Engine-TS/src/engine/entity/Player.ts:954`) (05).
- `processMovement` and `validateAndAdvanceStep` docs: no force movement, returns `true` even when blocked, and one call takes at most one step (`Engine-TS/src/engine/entity/PathingEntity.ts:124-134`, `Engine-TS/src/engine/entity/PathingEntity.ts:191-205`) (06).
- `tryInteract` "Run the default apTrigger": no script runs; it sets `apRange = -1` (`Engine-TS/src/engine/entity/Player.ts:1219`) (06).
- `onLogin` "confirmed order" does not match the write order, and invs/stats go out in phase 10 (`Engine-TS/src/engine/entity/Player.ts:489-500`); `onReconnect` "rebuild scene later this tick" is written at once (`Engine-TS/src/engine/entity/Player.ts:555-556`) (07).
- `newPlayers` "players joining at the end of this tick": they join in phase 7 of the next tick (`Engine-TS/src/engine/World.ts:143`); "force logout" only skips the anti-logout window (`Engine-TS/src/engine/World.ts:745`) (07).
- `cycle()` "build list of active zones around players": phase 8 builds none; phase 10 `updateMap` does (`Engine-TS/src/engine/World.ts:387`) (08).
- `Zone.clearQueuedEvents` doc "the cheapest objs are automatically dropped": the first `DESPAWN` obj is dropped, no value check (`Engine-TS/src/engine/zone/Zone.ts:588-589`) (08).
- `cycle()` "convert player movements ... compute npc info": no separate convert step; movement bits are written per observer in phase 10 (`Engine-TS/src/engine/World.ts:392-396`) (09).
- `cycle()` "map update ... flush packets": `updateMap` does not send the map, and `encodeOut` writes interface packets; nothing is flushed (`Engine-TS/src/engine/World.ts:399-407`) (10).
- `processShutdown` "after 1 second, kick into high gear": `tickRate` is set to 0 on the fourth shutdown tick, about 1.8 s after the first started (by arithmetic from 11#21; inference), and applies from the tick after (`Engine-TS/src/engine/World.ts:1234`); "push stats to prometheus": they are pulled from `/prometheus` (`Engine-TS/src/engine/World.ts:476`) (11).

## What the provisional version of this page got wrong

The provisional page quoted the `cycle()` comments as each phase's purpose. Checked against the notes:

- **Phase 1** omitted the delayed-obj queue, and "npc hunt" suggested all NPC hunting; only `PLAYER` hunts run here, other hunts run in phase 4 (01).
- **Phase 2** listed a "pathfinding/following request" step that does not exist (following is computed in phase 5) and put input tracking last (it runs before decoding) (02).
- **Phase 4** said "if npc is not busy"; the gate is `isValid()`, applied only after the resume and lifecycle steps; lifecycle, hunt and facing were missing, and "movement" and "modes" are one step (04).
- **Phase 5** listed "close interface if attempting to logout", which has no code in `processPlayers` (it is in `processLogouts`, 05); it omitted undelay and the facing calls, and "interactions - movement" is really attempt, move, attempt (06).
- **Phase 7**'s "before packets so they immediately load" is ambiguous: it holds for this tick's phase-10 output (the new player is in phases 9-11 of the login tick), but the new player's first input decode is in the next tick (07).
- **Phase 8** "build list of active zones around players" is not done in phase 8; the per-player active-zone set is rebuilt in phase 10 (08).
- **Phase 9** "convert movements" / "compute info" is one pre-encode per entity; the info packets are built per observer in phase 10, and `REBUILD_NORMAL` can be sent here (09).
- **Phase 10** "flush packets" is not a flush: packets are written to the socket when created, in whatever phase; "map update" does not send the map; "afk zones changes" sends no packet (10).
- **Phase 11** omitted shop restock, `rsbuf.cleanup()` and the `FACE_ENTITY` re-arm (11).
- **Tick length**: the provisional overview page (an earlier draft of this file, no longer on disk) said `cycle()` "reschedules itself with the tick rate minus the time the cycle took and any drift"; that quoted wording comes from the draft and can no longer be checked here. That matches the formula but leaves out (11#19-22): `drift` is `max(0, start - nextTick)`, the lateness beyond one tick, so lateness up to one tick is never made up (inference from the worked arithmetic in 11#19); `tickRate` can change (0 during shutdown, `::speed`); and an exception that escapes a phase ends the process with no further tick.

## Inferences (labelled)

- **A move or op packet decoded in phase 2 of tick T can act in phase 5 of the same tick** (walk step and, if the conditions hold, the op/ap script); a script that re-arms the interaction (`p_oploc`) is first tried in T+1. Rests on 02#13, 06#5, 06#17, 06#19 ([`ordering-matrix.md`](ordering-matrix.md) Conclusion A).
- **Bytes that reach the engine after cycle T starts, even during phase 1, are decoded in T+1**, because socket handlers run only between synchronous cycles. Rests on 02§Pos and the 07#13 inference (JavaScript semantics). The exact boundary is open question #46.
- **Reset after output makes per-tick state mean "this tick"**: written in phases 1-8, read in 9-10, cleared in 11. Rests on 11#1-9 and 09#16 (11 Inferences).

## Not checked / open questions

- Nothing here was observed by running the server; all timings are read from code. Observation is still needed for tick scheduling (#44), packet arrival windows (#46), the phase-5 interaction timings (#33) and the woodcutting cadence (#10).
- Boundaries not read: the `rsmod` routefinder (#4), RuneScript VM internals (#15), client decoding (#6, #14, #31), worker threads (#22, #34), Node/`ws` socket internals (#29, #41, #46).
- JavaScript iteration semantics that some notes rely on (typed arrays, `Map`, `Set` changed during a loop) were not tested (#48).
- `docs/tools/check_citations.py` only parses citations written with a repo prefix (`Engine-TS/...:N`). The flow notes in `docs/flows/` also use un-prefixed citations such as `Client.ts:5847`, which the checker skips, so a passing run does not verify those.
- All open items are listed in [`../open-questions.md`](../open-questions.md).

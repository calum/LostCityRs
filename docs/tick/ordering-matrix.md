# Ordering matrix: which phase reads and writes which state

**Question answered:** For each piece of engine state that matters to tick ordering, which of the eleven phases of `World.cycle()` (and the tail of `cycle()` after phase 11) reads it or writes it, and what does that order imply for same-tick versus next-tick visibility?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only through the notes, no Content line is cited here)

**Method:** synthesised from notes 01-11; code read, not observed. Every cell and every conclusion rests on a rule or finding in [`01-world.md`](01-world.md), [`02-clients-in.md`](02-clients-in.md), [`03-npc-event-queue.md`](03-npc-event-queue.md), [`04-npcs.md`](04-npcs.md), [`04b-npc-modes.md`](04b-npc-modes.md), [`05-players-queues-timers.md`](05-players-queues-timers.md), [`06-players-interaction-movement.md`](06-players-interaction-movement.md), [`07-logouts-logins.md`](07-logouts-logins.md), [`08-zones.md`](08-zones.md), [`09-info.md`](09-info.md), [`10-clients-out.md`](10-clients-out.md) and [`11-cleanup-and-tail.md`](11-cleanup-and-tail.md). No new finding is introduced. The `file:line` citations in the Conclusions are copied from those notes and were re-opened in the source at the commit above. Nothing was run.

## How to read the tables

**Columns.** `1`-`11` are the phases of `World.cycle()` in call order: 1 `processWorld`, 2 `processClientsIn`, 3 `processNpcEventQueue`, 4 `processNpcs`, 5 `processPlayers`, 6 `processLogouts`, 7 `processLogins`, 8 `processZones`, 9 `processInfo`, 10 `processClientsOut`, 11 `processCleanup`. `Tail` is the rest of `cycle()` after phase 11: `processShutdown`, autosave, check-in log, log flush, stats, `currentTick++`, rescheduling ([`11-cleanup-and-tail.md`](11-cleanup-and-tail.md) L2).

**Cells.** `R` = engine code in that phase reads the item; `W` = it writes it; `RW` = both. Empty = no read or write by engine code in that phase is established by the notes (it does **not** mean "proven untouched", except where a note says so, e.g. [`11-cleanup-and-tail.md`](11-cleanup-and-tail.md) rule 10). Each mark is followed by its pointer(s). A letter in square brackets (`[a]`) is a condition. Letters are global: each is defined once in the key below and means the same in every table (the Notes column may repeat it).

**Condition key.**
- `[a]` only if the hunt config has `checkNotBusy` (01#20).
- `[b]` shutdown force-removal, on shutdown ticks with `duration >= 1024` (11#13 step 2).
- `[c]` reconnect, in phase 7 (07#18).
- `[d]` the `::kick` cheat, in phase 2 (07#1).
- `[e]` the `::npcadd` cheat, in phase 2: `addNpc` with `firstSpawn` (03#4).
- `[f]` only when a script run there stops in `NPC_SUSPENDED` (stored on its active NPC).
- `[g]` only when a script run by `Player.executeScript` or `Npc.executeScript` stops in `WORLD_SUSPENDED` (01#3).
- `[h]` the `::reboot` and `::speed` cheats, in phase 2 (11#12, 11#19).
- `[i]` only through scripts run in that phase.
- `[j]` the production script-error path: `ScriptRunner.execute`'s `catch`, in any phase that runs scripts (phases 1-7), logs out a player `self` and sets `loggingOut`, or removes an NPC `self` (05#3, 07#1, 01#6, 03#6). It acts on the script's `self`, which is set only when a script is created (`ScriptRunner.init`) and kept when it is resumed (03#8, 01#8). New scripts in phases 6 and 7 are started for a player (the logout and login triggers, 07#8, 07#15); phase 3 starts scripts with an NPC `self` (03#8). A script can also be resumed in a phase other than the one that started it: the world queue in phase 1 (01#8); an NPC's `activeScript` in phase 4 (04#7); and a player's `activeScript` in phase 5 (05#5) and by the phase-2 resume handlers and `IF_BUTTON` resume path (02#15). `Npc.executeScript` stores a script that stopped player-suspended on that player's `activeScript` (03#9, 04#7), so a script with an NPC `self` can be resumed in phases 2 and 5 too. Whether content ever leaves an NPC-`self` script player-suspended was not checked; the engine path exists. It is engine code, so it is marked in cells, but only in the `loggingOut` row (phases 1, 2, 4, 5, 6, 7) and the `World.npcs` row (phases 1, 2, 3, 4, 5); the knock-on effects of that NPC removal (rsbuf record, observer count, zone lists, collision) are the same `removeNpc` as phase 4's `catch` and are not repeated.
- `[k]` only if the hunt config has `checkAfk` (01#20).
- `[l]` the phase-2 cheat handler's call of a `World` loc/obj method (08#16).
- `[n]` only on shutdown ticks (`shutdown` true, from `shutdownTick` on), when the tail calls `processShutdown` (11#13).
- `[m]` on every tick from `shutdownTick` on: `processShutdown` step 1 writes `Logout` and calls `close()` for each connected player (11#13 step 1).

**Pointers.**
- `NN#R` = note NN, L3 rule R (e.g. `05#3` is [`05-players-queues-timers.md`](05-players-queues-timers.md) rule 3; `04b#14` is [`04b-npc-modes.md`](04b-npc-modes.md) rule 14). `05#10,11` = rules 10 and 11; `04b#1-5` = rules 1 to 5.
- `NN§L2.s` = note NN, L2 sub-step s (e.g. `02§L2.2.6`).
- `NN§Pos` = the note's "Position in the tick" section.
- `NN§Inf` = a labelled **inference** in the note (not a finding).

**Script column ("S").** Script commands write a great deal of state, and scripts run in phases 1-7: phase 1 (world-queue resumes), 2 (packet handlers), 3 (spawn/despawn triggers), 4 (NPC triggers and resumes), 5 (player resumes, queues, timers, engine queue, op/ap/walk triggers), 6 (the logout trigger, on a player removed right after) and 7 (the login trigger) (`09#17`). No script runs in phases 9-11 or the tail (`09#18`, `11#1`, `11#13`), and none of phase 8's per-entity actions runs a script (`08#6`). Writes made **only by script commands** are not marked in the phase cells; they are listed in the S column with the command and pointer, and apply in whichever of phases 1-7 the script runs. Engine routing code that runs after a script stops (e.g. storing a suspended script) is engine code and is marked in the cells. Writes from outside the tick (worker-thread messages, socket events) are listed in the S column as "Async" (see Conclusion E).

## Table 1: Player queues, scripts, access and logout state

| State | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tail | S (scripts / async) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Normal queue `queue` (`NORMAL`/`STRONG`/`LONG`) | | | | | RW 05#10,11; 06#12 | RW 07#6,8 | | | | | | W[b] 11#13; 07#8 | `queue`, `strongqueue`, `longqueue` (05#9); `clearqueue` (05#12). Async: friend-server `RELAY_QUEUESCRIPT` enqueues delay 0 (05#9; when it runs is not traced) | Phase 5 scans for any `STRONG` entry (not only due ones) and closes the modal every tick it is queued (05#10). Counter is post-decremented on every visit, gate `canAccess()` (05#11). While `loggingOut`, `LONG` with `logoutAction` 0 is forced to delay 0 (05#11). Phase 6 reads it for "discardable" and `cleanup()` clears it on removal (07#6, 07#8). Not touched by phase 11 (11#10). [b] shutdown force-removal at `duration >= 1024`. |
| Weak queue `weakQueue` | | W 02#13,16 | | | RW 05#10,12 | W 07#6,8 | W[c] 07#18; 05#10 | | | | | W[b] 11#13; 07#8 | `weakqueue` (05#9); cleared by any default `closeModal()`: `if_close`, `p_stopaction`/`p_clearpendingaction` (05#12); `clearqueue` (05#12) | Cleared by every default `closeModal()`: phase-2 move/op handlers via `clearPendingAction` (02#16), phase-5 `processQueues` when a `STRONG` entry or `requestModalClose` exists (05#10), every phase-6 removal attempt (07#6). [c] reconnect: `onReconnect` calls `closeModal()` (07#18). |
| Engine queue `engineQueue` | | | | | RW 05#21; 06#12 | RW 07#7,8 | | | | W 05#20; 10#3 | | W[b] 11#13; 07#8 | Stat commands through `changeStat`/`addXp` enqueue `CHANGESTAT`/`ADVANCESTAT` (05#20) | Always delay 0; runs on the first accessible visit; unlinked **after** the script (05#21). Phase 10 `updateMap` enqueues zone/mapzone triggers (05#20, 10#3). Phase 6 removal needs it empty (07#7). |
| Timers `timers` (normal and soft) | | | | | RW 05#16-18 | W 07#8 | | | | | | W[b] 11#13; 07#8 | `settimer`, `softtimer`, clear (05#16) | Absolute-tick comparison, no countdown; `clock` set before the script (05#17). Both kinds skipped while `loggingOut` (05#19). Normal timers need `canAccess()`, soft do not (05#17). Login script timers get `clock = T` (07#17). |
| `delayed` / `delayedUntil` (player) | R[a] 01#20 | R 02#12,15 | | | RW 05#4,8; 06#20,22,24 | R 07#7 | R[c] 07#18; 05#10 | | | | | | `p_delay`, `p_arrivedelay` (05#4) | Cleared only at the start of the player's phase-5 turn when `currentTick >= delayedUntil` (05#4); so phase 2 sees the value from the end of the previous phase 5, or as changed by phase 1 or earlier packets (02#15). [a] only if the hunt config has `checkNotBusy` (01#20). [c] `onReconnect`'s `closeModal()` reads `delayed` before clearing `protect` (07#18, 05#10). Not touched by phase 11 (11#10). |
| `activeScript` (player) and `resumeButtons` | W 01#7 | RW 02#13,15; 02#16, 05#10 | W 03#9 | W 04#7; 05#5 | RW 05#5,6,10 | W 07#6,8 | W 07#15 | | | | | W[b] 11#13; 07#8 | | Phase 1 hands a `SUSPENDED` world-queue script to the player (01#7). Phases 3-4: `Npc.executeScript` routes a player-suspended script to `activePlayer` (03#9, 05#5). Phase 2 resume handlers and `IF_BUTTON` resume `PAUSEBUTTON`/`COUNTDIALOG` scripts even while delayed (02#15). Phase 5 resumes only `SUSPENDED` (05#5). `closeModal` drops a dialogue script when a modal was open (05#10). |
| `protect` | | RW 02#13,15; 05#6 | W 03#9; 05#7 | W 05#7 | RW 05#6-8; 06#20 | RW 07#6,7 | W 07#15 | | | | W 11#3 | | | Set while a protected script runs and left `true` when a protected script stops suspended (05#6, 05#7). `Npc.executeScript` clears it on protected active players (03#9, 05#7). `closeModal` clears it when not delayed (05#10). Phase 11 resets it, so it lasts at most to the end of the tick (05#7, 11#3). The world-queue hand-over does not set it (01#7). |
| `modalState`, `modalMain/Chat/Side` | R[a] 01#20 | RW 02#12,16 | | | RW 05#8,10; 06#12 | RW 07#6,7 | W[c] 07#18 | | | R 10#10 | | | `if_openmain`, `if_openchat`, `if_openside`, `if_openmain_side`, `if_close` (10#10, 10#12) | `busy()` = `delayed` or a `MAIN`/`CHAT` modal (05#8). `closeModal` sets `NONE` (02#16, 05#10). Phase 10 `encodeOut` picks the open packet from the current `modalState` (10#10). Not touched by phase 11 (11#10). |
| `requestModalClose` | | W 02#13 | | | RW 05#10 | | | | | | | | | Set by `CLOSE_MODAL` in phase 2, consumed by `processQueues` in phase 5 (02#13, 05#10). |
| `refreshModal`, `refreshModalClose`, `overlay`, `lastOverlay` | | W 02#16; 05#10 | | | W 05#10 | W 07#6 | W[c] 10#23 | | | RW 10#10 | | | Modal-open commands set `refreshModal`; `if_openoverlay` sets `overlay` (10#10) | `closeModal` sets `refreshModalClose` only when a modal was open (05#10, 10#10). Phase 10 clears `refreshModal` and sets `lastOverlay` (10#10). `lastOverlay` is not reset on reconnect (10#23). |
| `loggingOut` | RW[j] 01#19; 05#3 | W[d][j] 07#1; 05#3 | | RW[j] 04b#5; 05#3 | RW 05#11,19; 06#5; W[j] 05#3 | RW 07#3,5,6; W[j] 05#3 | W[j] 05#3 | | | | | | Async: friend-server kick (07#1); `notifyPlayerBan` (07#1; when it runs relative to the tick is not stated in the notes) | Never set back to `false` (07#1). Makes `Player.isValid()` false (07#11), which phase-1 hunts (01#19), NPC target validation in phase 4 (04b#5) and player target validation in phase 5 (06#5) read. Freezes timers (05#19). [d] the `::kick` cheat, in phase 2 (07#1). [j] the production script-error path (05#3, 07#1); the R parts of the phase 1, 4 and 5 cells are unconditional. |
| `requestLogout`, `requestIdleLogout` | | W 02#13 | | | | RW 07#3,5 | | | | | | | `p_logout` sets `requestLogout` (07#1) | `requestIdleLogout`: `IDLE_TIMER` handler (02#13) and the phase-6 50-tick timeout (07#3). Both consumed in the same phase-6 pass, succeed or not (07#5). The phase-2 cell is the `IDLE_TIMER` handler only; `requestLogout` is written only by the `p_logout` script command (S column), normally from an `IF_BUTTON` script in phase 2 (07#1). |
| `preventLogoutUntil`, `preventLogoutMessage` | | | | | | RW 07#5,6 | | | | | | | `p_preventlogout` (07#2) | Absolute deadline (07#2). Phase 6 nulls the message after sending it once (07#5). |
| `lastConnected`, `lastResponse` | | W 02#4,10 | | | | R 07#3 | | | | | | | Async: stamped at load (07#13) | Not re-stamped on reconnect (07#18). Stop moving once the client is a `NullClientSocket` (07#4). |
| `afkEventReady` | | W 02#17 | | | | | | | | | | | `afk_event` reads and clears (02#17); a cheat sets it (02#17) | Overwritten every 500 ticks, before decode (02#17). |
| `lastAfkZone`, `afkZones` | R[k] 01#20 | R 02#17 | | | | | | | | RW 10#9 | | | | Updated only in phase 10, so only for connected players (10#9). [k] the `zonesAfk()` check in `huntPlayers` is gated by `hunt.checkAfk` (01#20). |
| `playtime` | | W 02#19 | | | | | | | | | | | | Every player in `playerLoop`, connected or not (02#19). |
| Input-tracking buffer `input` | | RW 02#18 | | | | W 02#18 | | | | | | | Async: turned on by `RELAY_TRACK` (02#18) | Flush check runs **before** this tick's decode (02#18). Phase 6 cell: `Player.cleanup()` flushes it on removal (02#18, 07#8). Posted to the logger thread (02#18). |
| Chat and social per-tick fields (`chatMessage`, `chatColour/Effect/Rights`, `logMessage`, `socialProtect`, `reportAbuseProtect`) | | RW 02#13,15 | | | | | | | R 09#5 | | W 11#3 | | | One social packet accepted per tick (02#15, 11#3). `logMessage` is consumed in phase 2 itself (02§L2.2.6). |

## Table 2: Player interaction, movement and run

| State | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tail | S (scripts / async) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Interaction target (`target`, `targetOp`, `targetSubject`, `apRange`) | | W 02#13 | | | RW 06#1-3,5,6,11,17,19 | | | | | | R 11#5 | | `p_oploc`, `p_opnpc` etc. through `setInteraction` (06#3); `p_stopaction`/`p_clearpendingaction` (06#19 table); `p_aprange` sets `apRange` (06#6) | Phase 2 op handlers arm it; phase 5 consumes and may clear it (06#19 table). Facing (steps 6-7) reads it **before** `processInteraction` can clear it (06#3). Phase 11 only reads it, in `setFaceEntity` (11#5, 11#10). |
| `apRangeCalled` | | W 02#13 | | | RW 06#6,17,19 | | | | | | W 11#4 | | `p_aprange` (06#6) | Reset by `setInteraction`/`clearInteraction`, the ap branch and phase 11 (06#19). |
| `nextTarget` | | | | | RW 06#4,6,19 | | | | | | | | | Cleared at the start of `processInteraction`; captures any interaction a script set (06#4, 06#6). |
| `targetX/Z` (loc/obj facing tile) | | W 02#13 | | | RW 06#21 | | | | | | | | `setInteraction` from `p_oploc` etc. (06#21) | Survives `clearInteraction`; cleared only by `reorient` on a zero-step tick (06#21). |
| Facing fields (`faceEntity`, `faceAngleX/Z`, `faceSquareX/Z`) | | | | | W 06#1,2,21 | | | | R 09#5 | | W 11#4,5 | | `facesquare` through `focus(..., true)` (09#17) | Phase 11 resets `faceSquareX/Z` and recomputes `faceEntity` with `setFaceEntity()` (11#4, 11#5). |
| `masks` and block fields (player: anim, say, hitmarks, spotanim, exact-move fields, chat) | | W 02#13; 09#17 | | | RW 06#1,21,23 | | W[c] 09#17,25 | | R 09#6,16 | | W 11#4,5 | | `anim`, `say`, `spotanim`, `damage`, `buildappearance`, `p_exactmove`, `facesquare` (09#17) | Phase 2: `CHAT` (02#13) and `APPEARANCE` from the design-screen handler (09#17). Phase 5: `FACE_ENTITY`, `FACE_COORD`, and reads `EXACT_MOVE` to skip the jump check (06#1, 06#21, 06#23). The only clear is phase 11's `masks = 0`, followed by the `FACE_ENTITY` re-arm (09#16, 11#4, 11#5). Last write before phase 9 wins (09#16). No writer in phases 9-10 (09#18). [c] reconnect sets `FACE_ENTITY` and `APPEARANCE`. |
| Appearance bytes (`appearanceBuf`, `lastAppearance`) | | | | | | W 07#8 | | | RW 09#9 | | | | | Regenerated in phase 9 only when the `APPEARANCE` mask is set or none exist (09#9). Phase 6: `cleanup()` resets appearance on removal (07#8). |
| `waypoints` / `waypointIndex` (player) | | W 02#12,13 | | | RW 06#5,6,10,11,15,19 | | | | | | | | `p_oploc` queues one waypoint (06#6); `p_exactmove` calls `unsetMapFlag` (06#23); `p_stopaction` clears them (06#19 table) | Phase 2: `MoveClickHandler` queues them, or `unsetMapFlag` when the player became delayed mid-decode (02#12, 02#13). Not touched by phase 11 (11#10). |
| `userPath`, `opcalled` | | RW 02#4,12 | | | | | | | | | | | | Phase 2 only; cleared at the next `decodeIn` (02#13). |
| `moveClickRequest` | | W 02#12,13 | | | R 06#12 | | W 07#15 | | | | | | | Kept from earlier ticks when a tick has no move/op packet (02#12). Reset `false` at login (07#15). |
| `tempRun` | | W 02#13 | | | RW 06#13,14,22 | | | | | | | | `p_temprun` (06#13) | Phase 5 sets 0 on every tick without a step attempt and when energy < 100 (06#14, 06#22). |
| `walktrigger` | | RW 06#20 | | | RW 06#20 | | | | | | | | `walktrigger` command sets it (06#20) | Phase 2 call only in `MoveClickHandler`'s `clientRoutefinder` branch (06#20, 02#13). Cleared before the script runs (06#20). |
| Position, collision marker and zone membership (player) | R 01#19 | | | R 04b#5,11 | RW 06#15 | W 07#8 | W 07#15 | | R 09#5 | R 08#20; 10#9 | R 11#4 | | Teleports: `p_telejump`, level change, `p_exactmove` (06#13, 06#23) | Phase 4 NPCs validate and path to the player's live position, i.e. before this tick's player steps (04b#5, 04b#11, 04§Inf). Phase 10 builds active zones from the post-phase-5 position (08#20). |
| `lastTickX/Z`, `lastLevel` | | | | | R 06#23 | | | | | R 11#4; 09#20 | W 11#4 | | | Phase 10 passes the tick's displacement and level change to the info encoders (11#4, 09#20). |
| `walkDir` / `runDir`, `stepsTaken` | | | | | RW 06#14-16 | | | | R 09#10 | | W 11#4 | | | `stepsTaken` has no reader after phase 5 (06#16). `walkDir === -1` gates the step, which bounds a player to 2 steps per tick (06#14). |
| `lastStepX/Z`, `followX/Z` | | | | | RW 06#4,10 | | W 06#4 | | | | | | | `onLogin` sets `lastStepX/Z` (06#4). A follower reads the target's `followX/Z` (06#10). |
| `lastMovement` (player) | | | | | W 06#16 | | | | | | | | Read by `p_arrivedelay` (05#4, 06#16) | |
| `moveSpeed` (player) | | | | | RW 06#13 | | W[c] 06#13 | | | R 10#9 | W 11#4 | | `p_telejump`, level-changing teleport set `INSTANT` (06#13) | [c] `onReconnect` sets `INSTANT` (06#13). |
| `tele` / `jump` (player) | | | | | W 06#23 | | W 07#15,18 | | R 09#5 | R 06#23; 10#9 | W 11#4 | | Teleport sets `tele` (06#23) | Phase 5 sets only `jump`, skipped for `EXACT_MOVE` (06#23). Login sets `tele`; reconnect sets `tele` and `jump` (07#15, 07#18). |
| Run state (`runenergy`, `run`) | | | | | RW 06#13,22 | | R[c] 07#18 | | | R 10#8 | R 11#4 | | `p_run` writes `run` and its varp (06#13) | Phase 11 `defaultMoveSpeed()` reads `run` (11#4). [c] `onReconnect` sends run energy at once (07#18). |
| `runweight` | | | | | R 06#22 | | | | | RW 10#6 | | | | Recomputed only in phase 10, only when a listened `runweight` inventory changed (10#6); so phase 5 uses the previous phase 10's value (06#22). |
| `lastRunEnergy` | | | | | | | | | | RW 10#8 | | | | Not updated by `onReconnect` (10#23). |

## Table 3: NPC state

| State | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tail | S (scripts / async) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `World.npcs` membership (NPC add/remove) | RW[j] 01#15; 03#6 | W[e][j] 03#4,6; 02#15 | W[j] 03#6 | RW 04#1,3; 03#5; W[j] 03#6 | W[j] 03#6; 05#5 | | | | R 09§L2.3 | | R 11#6 | | `npc_add` (03#4), `npc_del` (03#6). Startup map load (03#4) | Enters only in `addNpc` with `firstSpawn`; leaves only in `removeNpc` of a `DESPAWN` NPC; `RESPAWN` NPCs stay in the list while inactive (04#1). Phase 4 removes on despawn (03#5) and in its `catch` (04#3). An NPC added in phases 1-3 gets its phase-4 turn the same tick (03#15). [e] `::npcadd` cheat. [j] production script-error removal of an NPC `self`; in phases 2 and 5 only for a resumed script with an NPC `self` (key, `[j]`); the phase-1 R is unconditional. |
| `npcEventQueue` (spawn/despawn triggers) | | W[e] 03#4 | RW 03#10,11 | W 03#4,5 | | | | | | | | | `npc_add` in any script phase (03#7) | Only phase 3 removes entries; entries of a delayed NPC are kept (03#11). FIFO; entries added during phase 3 may run in the same pass (03#14). |
| `delayed` / `delayedUntil` (NPC) | | R 02#15 | R 03#11 | RW 04#4,6 | R 06#5; 04#15 | | | | | | | | `npc_delay`, `npc_arrivedelay` (03#11, 04#5); cleared by `cleanup()` and `resetEntity(true)` (03#11) | Cleared by time only inside `if (isActive)` at the start of the NPC's turn (04#6). The phase-1 player hunt does not check it (01#16). Phase 2: `OpNpcHandler` rejects a delayed NPC (02#15). Phase 5: a delayed NPC is an invalid target (06#5). |
| `activeScript` (NPC) | W[f] 01#7 | W[f] 02#13 | W[f] 03#9 | RW 04#6,7 | W[f] 05#6 | | W[f] 07#15; 05#6 | | | | | | Cleared by `cleanup()` (03#5) | [f] only when a script run there stops in `NPC_SUSPENDED`; it is then stored on its active NPC. Resumed in that NPC's phase-4 turn, even if a player script delayed it (04#7). |
| NPC queue (`ai_queueN` entries) | | | | RW 04#13,14 | | | | | | | | | `npc_queue` (04#13); cleared by `cleanup()`/`resetEntity(true)` (04#14) | Decremented only while not delayed; script looked up with the NPC's current type when it runs (04#13). |
| NPC timer (`timerInterval`, `timerClock`) | | | | RW 04#12; 04b#4 | | | | | | | | | `npc_settimer` (04#12) | Counts only valid turns (04#12). `resetDefaults()` reloads the interval from the type (04#12, 04b#4). |
| NPC regen (`regenClock`, `regenInterval`, `levels`) | | | | RW 04#11 | | | | | | | | | | |
| `huntTarget` | W 01#18 | | | RW 04#9,10; 04b#4 | | | | | | | | | Cleared by `cleanup()` (03#5) | Phase 1 clears then may set it for `PLAYER` hunts (01#18); phase 4 sets it for non-player hunts and consumes it (04#9, 04#10). |
| `huntClock` | R 01#18 | | | RW 04#9,10; 04b#4 | | | | | | | | | | Incremented only on valid turns (01#18, 04#9). |
| `huntMode` | R 01#16 | | | RW 04#9,10; 04b#4 | | | | | | | | | `npc_sethuntmode` (04#10) | Set to -1 after a consumed hunt unless `findKeepHunting` (04#10). |
| NPC mode and target (`targetOp`, `target`) | | | | RW 04b#1-5,14,17; 04#10 | | | | | | | | | `npc_setmode` (04b#2) | Targeted modes validate first and, on failure, reset and do nothing else that turn (04b#4). Facing after the mode reads the target as the mode left it (04b#17). |
| NPC `type` | | | | RW 03#4; 04#13 | R 06#5 | | | | R 09#5 | | | | `npc_changetype`, `npc_changetype_keepall` (03#4) | Phase 4 reverts it (03#4). Phase 5 validation fails on a type change (06#5). |
| NPC `lifecycleTick` (respawn/despawn countdown) | | | | RW 03#5; 04§L2 (turn step 2); 04#3 | | | | | | | | | `npc_del` sets the respawn countdown (03#6); `npc_changetype*` restarts a `DESPAWN` countdown (03#5) | Decremented only while not delayed (03#5). The phase-4 `catch` sets it to 1 for a `RESPAWN` NPC (04#3). |
| NPC position, waypoints, collision marker, zone membership, `walkDir`/`runDir` | R 01#19 | | | RW 04b#15,16; 04#15 | R 04#15; 06#10 | | | | R 09#5,10 | | W 11#4,6 | | `npc_walk` queues one waypoint (04b#7) | At most one step per tick (04b#16). Phase 5 reads the post-phase-4 position (04#15). |
| NPC `stuckCounter`, `lastMovement`, patrol state | | | | RW 04b#8-10,15 | | | | | | | | | | |
| NPC facing, `masks`, `tele`/`jump`, `moveSpeed` | | | | RW 04b#16,17; 09#17 | | | | | R 09#5,6 | | W 11#4,6 | | `npc_anim`, `npc_say`, `npc_damage`, `spotanim_npc`, `npc_facesquare`, `npc_changetype*` (09#17); `addNpc` sets `ANIM` and `tele` on spawn (09#17, 09#22) | Phase 4 writes facing and `FACE_ENTITY`/`FACE_COORD` after movement, then the jump check (04b#17), and the `CHANGE_TYPE` mask on a revert (09#17). Phase 11 clears masks then re-arms `FACE_ENTITY` (11#4-6). |
| NPC observer count (rsbuf `observers`) | R 01#16,17 | W[e] 03#4; 09#19 | | RW 04#9; 09#19 | | W 09#19 | | | | W 09#19-21 | | W[b] 09#19 | Reset to 0 by `addNpc` with `firstSpawn` (`npc_add`, cheat, startup) (09#19) | Phase 4 W: a `DESPAWN` removal deletes the record (09#19). Phase 6 W: `rsbuf.removePlayer` decrements (09#19). Phase 10: +1/-1 per observer list change, plus clears without decrement (09#19, 09#20). Read only in phases 1 and 4, so they see the value after the previous tick's phase 10, changed only by a shutdown force-removal in T-1's tail and by a first spawn (reset to 0) or a `DESPAWN` removal (record gone) earlier in tick T (09#21). [e] `::npcadd` resets the record to 0 (03#4, 09#19). Not changed by phase 9 or 11 (09#19). Can drift (09§Inf). The crash path also decrements (09#19). |

## Table 4: World, zone and lifecycle state

| State | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tail | S (scripts / async) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| World queue `World.queue` | RW 01#4-7,9 | W[g] 02#13; 01#3 | W[g] 03#9 | W[g] 01#3 | W[g] 05#6 | | W[g] 07#15; 05#6 | | | | | | `world_delay` (01#3) | [g] only when a script run by `Player.executeScript` or `Npc.executeScript` stops in `WORLD_SUSPENDED`; walk triggers, the hunt `findNewMode` queue script and the logout trigger never enqueue (01#3). Entry delay is `d + 1` (01#2). |
| Delayed-obj queue `objDelayedQueue` | RW 01#10-12 | | | | | | | | | | | | `inv_dropitem_delayed` (01#10) | Runs after the whole world-queue loop (01#12). |
| Loc/obj timer list `locObjTracker` and loc/obj `lifecycleTick` | W 01#13; 08#3 | W[l] 08#16 | | | | | | RW 08#2,5-8 | | | | | `loc_add`, `loc_change`, `loc_del`, `obj_add`, `obj_del`, overflow drops (08#3) | Only writer is `setLifeCycle` (08#2); the obj stack merge sets `lifecycleTick` without touching the list (08#4). Phase 8 never appends during its pass (08#6). |
| Obj `reveal` / `receiver64` | W 01#13 | | | | R 06#5 | | | RW 08#8-10 | | | | | `obj_add` through `addObj` (08#3) | Phase 8 `Obj.turn` counts `reveal` down and reveals; the countdown runs only while the obj has a timer (08#8-10). A private obj is an invalid target for others (06#5). |
| Loc/obj `lastLifecycleTick` | W 08#2 | W[l] 08#16 | | | | | | RW 08#2,14 | | R 08#22 | | | World loc/obj methods (08#3) | Equals `currentTick` when set this tick, which suppresses `ObjDel` and full-follows entries (08#14, 08#22). |
| Zone events (`events`, `entityEvents`) | W 08#16 | W[l] 08#16 | | | | | | RW 08#13,14,17 | | R 08#21,22 | W 08#24; 11#2 | | Loc/obj/map-anim `World` methods (08#13, 08#16) | No zone event is queued in phases 9-11 (09#18). Removals cancel the entity's earlier events this tick (08#14). |
| `zonesTracking` | W 08#13 | W[l] 08#13 | | | | | | RW 08§L2.3; 08#13 | | | RW 11#2 | | Same `World` methods (`trackZone`, 08#13) | Every zone with an event this tick is in it (08#13). |
| Zone `shared` buffer | | | | | | | | W 08#17,18 | | R 08#21 | W 08#24; 11#2 | | | Built once per tracked zone per tick, from `ENCLOSED` events, after phase 8's timers (08#17, 08#18). |
| Zone loc/obj contents | W 01#13 | W[l] 08#16 | | | | | | RW 08#7,8,13 | | R 08#22 | | | `World` loc/obj methods (08#13) | Phase 10 `writeFullFollows` reads current contents minus this tick's changes (08#22). |
| Collision map | | | | RW 04b#16; 04#15 | RW 06#15 | W 07#8 | | W 08#27 | | | | | `loc_change` and other loc methods (08#27); `addNpc` (03#4) | Updated synchronously by each step (04#15, 06#15) and by `revertLoc` in phase 8 (08#27 step 6). How pathing reads it (`canTravel`) was not read (#4). |
| Engine `Zone` player/NPC lists | R 01#19 | | | W 04#15; 08#25 | W 06#15; 08#25 | W 07#8 | W 07#15 | | | | | | `addNpc`/`removeNpc` (03#4) | Phase 8 reads none of this (08#25). |
| `playerLoop` and `players[]` (player add/remove) | R 01#14 | R 02#1 | | R 04#3 | R 05#1 | RW 07#8,9 | RW 07#14,15 | R 08#11 | R 09§L2.1,2 | R 10§L2.2 | R 11§L2.3 | R[n] 11#13; R 11#15,16; W[b] 11#13 | | Only phase 7 adds; phase 6, the shutdown force-removal and the crash path remove (02#2). Phases 2 and 5 visit the same players in the same order (02#3). The crash path removes everyone (11#22). Phases 4 and 8 read the `players[]` count through `scaleByPlayerCount` in `removeNpc`/`removeObj` (04#3, 08#11). |
| `newPlayers` | | | | | | | RW 07#14; 07§L2 (phase 7 step 3) | | | | | | Async: filled by the login thread reply between ticks (07#13) | `newPlayers.clear()` drops every entry each phase 7 (07§L2, phase 7 step 3). |
| `loginRequests` | | | | | | | | | | | | | Async only: login packet adds, login thread reply removes (07#12, 07#13) | Never touched by a phase. |
| `logoutRequests` (save hand-off) | | | | | | RW 07#8,10 | R 07#14 | | | | | R[n] 11#13; W[b] 11#14 | Async: deleted on a `success` logout response or `RELAY_CLEARLOGOUTS`; read by the login packet check (07#10) | Saves are posted only by phase 6's resend loop (07#10, 11#14). Shutdown exit waits for it to be empty (11#13). |
| World inventories `World.invs` and shop stock | | | | | | | | | | R 10#5 | RW 11#7,8 | | Inventory commands (10#5) | Restock runs after `resetTracking`, so it is sent in phase 10 of the next tick (11#8). |
| `currentTick` | R 08#2 | R 02#4,17 | | R 04#6 | R 05#4,17 | R 07#3 | R 07#14,17 | R 08#14 | R 09#9 | R 08#22 | R 11#8 | RW 11#12 | Async handlers between ticks see the next tick's number (11#12, inference) | Same value in every phase and the tail; the only write is `currentTick++` near the end of the tail (11#12). |
| Shutdown and scheduling (`shutdownTick`/`shutdown`, `tickRate`, `nextTick`) | | W[h] 11#12,19 | | | R 05#8 | R 07#3 | R 07#14,15 | | | | | RW 11#13,19,21 | Async: `SIGINT`/`SIGTERM` call `rebootTimer(0)` (11#12) | [h] `::reboot` and `::speed` cheats. `canAccess()` is always true during shutdown (05#8). `cycle()` reads `nextTick` for `drift` at its start, before phase 1 (11#19). |
| `cycleStats` (phase timings, bandwidth counters) | W 01§L2.5 | W 02§L2.1,3; 02#10 | W[i] 10#20 | W 04§L2 (processNpcs step 3) | W 05§L2.3 | W 07§L2 | W 07§L2 | W 08§L2.5 | W 10#20 | W 10#20; 10§L2.5 | W 11§L2.7 | RW 11#18 | | Phases 3 and 9 record no timing (03§Pos, 09§Pos); their cells are the `BANDWIDTH_OUT` additions made by `writeInner` (phase 9: `REBUILD_NORMAL`, 09#3; phase 3: only through scripts). Every `writeInner` in any phase adds to `BANDWIDTH_OUT`, but phase 10 resets it first, so phase 1-9 bytes are dropped (10#20). 16-bit counters (10#21). |
| Session logs and wealth events | | | | | | W 07#8 | W 07#15 | | | | | RW 11#16,17 | | Flushed to the logger thread in the tail of any tick that has some (11#17). Not reached on the `exit(0)` tick (11#17 inference). |
| Worker-thread posts (friend, login, logger) | | W 02§L2.2.6; 02#18 | | | | W 07#8,10 | W 07#14,15 | | | | | W 11#15,17 | | Phase 2: public chat (friend), input tracking (logger). Phase 6: `player_logout` (friend) and saves (login). Phase 7: `player_login` (friend), `player_force_logout` (login). Tail: `player_autosave` every 1500 ticks, logs (11#15, 11#17). Crash-path saves are never posted (11#23 inference). |

## Table 5: Network and output state

| State | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | Tail | S (scripts / async) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Client input buffer `client.in` | | RW 02#7,9 | | | | | | | | | | | Async: the socket `data` handler appends between ticks (02§Pos) | Excess packets stay buffered for the next tick (02#9). |
| Socket writes (immediate packets) and the ISAAC output stream | W[i] 10#13 | W 02#11 | W[i] 10#13 | W[i] 10#13 | W 06#26 | W 07#5,8 | W 07#15,18 | | W 09#3 | W 10#1; 10§L2 | | W[m] 11#13 | Most packet-producing commands write at once (10#11) | Every packet is encoded and handed to the socket when written; no output queue, no flush (10#1). Phase 11 writes nothing (10#13, 11#1). No writer in phase 8 is established by the notes (08#23: zone packets are written in phase 10). [i] only through scripts run in that phase. |
| `client.out` (5000-byte encode buffer, `pos`) | W[i] 10#1,2 | W 10#1,2 | W[i] 10#1,2 | W[i] 10#1,2 | W 10#1,2 | W 10#1,2 | W 10#1,2 | | W 10#1,2 | RW 10#2,4 | | W[m] 10#1,2 | | Every `writeInner` resets `pos` to 0 and re-encodes into it, so it is written in every phase the socket-writes row marks W (10#1, 10#2); phase 10 `updatePlayers`/`updateNpcs` read `pos`, the size of the last packet written, as part of the info size budget (10#4). |
| Connection state (`client` object, `client.state`, `isClientConnected`) | | RW 02§L2.2.4; 02#20 | | | RW 05#3 | RW 07#8 | RW 07#15,18 | | | RW 10#16,18 | | RW[m] 11#13 | Async: the socket `close` handler swaps in `NullClientSocket` (07#4, 10#15); data after `close()` terminates the socket (10#17) | Each per-player `catch` only sends `Logout` and calls `close()`; the swap waits for the `close` event (05#3, 10#18; open question #29). `Player.write` drops packets for an unconnected player in every phase (10#16). The crash path (`cycle()`'s `catch`, 11#22) also writes `Logout` and closes every connected client; it is not part of the tail (Conclusion F). |
| rsbuf records, block caches, `PLAYER_GRID`, rsbuf zone map | | W[e] 03#4; 09#19 | | W 09#19 | | W 09#24 | W 09#20,23 | | W 09#1,6,7 | R 09#4; W 09#14 | W 09#7; 11#9 | W[b] 09#19 | NPC record created by `addNpc` with `firstSpawn` (09#19) | Phase 9 is once per entity, phase 10 once per observer (09#2). Phase 10 only reads the phase-9 values, except lazily cached add blocks (09#4, 09#14). [e] `::npcadd` creates a fresh NPC record (09#19). |
| Observer lists (`build.players`, `build.npcs`, stored appearances) | | | | | | W 09#24 | W 09#20 | | | RW 09#2,12,13,20 | | W[b] 09#19 | | Frozen for a disconnected player (10#16). |
| Build area (`originX/Z`, `loadedZones`, `activeZones`) | | | | | | W 07#8 | W 07#15,18 | | RW 09#3 | RW 08#20,21; R 10#3 | | | | Phase 9 moves the origin before `computePlayer` and may write `REBUILD_NORMAL` at once (09#3). Phase 10 rebuilds `activeZones` only on a zone change (08#20). |
| `lastZone`, `lastMapZone` | | | | | | | | | | RW 10#3 | | | | Frozen while disconnected (10#16); not reset by reconnect (10#23). |
| `cameraPackets` | | | | | | W 10#16 | | | | RW 10#3 | | | `cam_moveto`, `cam_lookat` (10#3) | Deferred to phase 10; `cam_shake`/`cam_reset` write at once (10#3). Phase 6 cell: cleared only by `cleanup()` on removal (10#16). |
| Inventory listeners (`invListeners`, `firstSeen`) | | W 02#16; 05#10 | | | W 05#10 | W 07#8; 05#10 | W[c] 07#18 | | | RW 10#5 | | | `inv_transmit`, `invother_transmit` (deferred), `inv_stoptransmit` (immediate) (10#5) | `closeModal` clears the closed interfaces' listeners (05#10). [c] `refreshInvs` on reconnect sets `firstSeen` (07#18, 10#5). |
| Inventory dirty flags (`inv.update`, `dirtySlots`) | | | | | | | | | | R 10#5,6 | W 11#7,8 | | Every inventory change (10#5), in any script phase | Reset for every player (connected or not) and world inventory in phase 11 (11#7), so a disconnected player's changes are discarded (10#16). |
| `stats`/`levels` and `lastStats`/`lastLevels` | | | | | | | R[c] 10#23 | | | RW 10#7 | | | Stat commands change `stats`/`levels` only (10#7) | [c] `onReconnect` sends every stat at once without updating `lastStats` (10#23). |

## Conclusions (labelled inferences)

Each conclusion below is an **inference** from the findings it lists. None was observed.

### A. An input packet that arms a target or waypoints in phase 2 of tick T can act in phase 5 of tick T

**Inference.** A move or op packet decoded in phase 2 of tick T is acted on in phase 5 of the **same** tick: the walk step, and (if the conditions hold) the op/ap script. Rests on:
- the packet handler runs synchronously inside `read()`, during phase 2 ([`02-clients-in.md`](02-clients-in.md) rule 7, rule 11);
- op handlers set the target through `setInteraction` and `MoveClickHandler` queues waypoints; both are consumed by phase 5 (`02#13`); the move-click flag block that follows decoding is `Engine-TS/src/engine/World.ts:617-629` (`02#12`);
- phase 5 runs after phases 3-4 (`05§Pos`) and calls `setFaceEntity`, `reorientEntity` and `processInteraction` for each player (`Engine-TS/src/engine/World.ts:713-717`, `06§Pos`);
- the pre-move attempt validates the target and calls `tryInteract` (`Engine-TS/src/engine/entity/Player.ts:1256-1270`, `06#5`), then movement and a post-move attempt (`Engine-TS/src/engine/entity/Player.ts:1287-1297`, `06#17`);
- the per-target timing table in [`06-players-interaction-movement.md`](06-players-interaction-movement.md) Inferences.

Conditions under which it does **not** happen in tick T (each from a note):
- the packet was not fully buffered before cycle T started (bytes are buffered only between ticks, so a packet that arrives at any point after cycle T starts, even during phase 1, is decoded in T+1; `02§Pos`, `07#13` inference), or a per-tick packet limit was reached first (`02#5`, `02#7`, `02#9`);
- the player was `delayed` at decode time: the request is dropped, not deferred (`02#15`);
- at phase 5 the player fails `canAccess()` (delayed, protected, main/chat modal): the pre- and post-move attempts are skipped, although movement can still happen (`06#5`, `06#12`, `06#24`);
- the target fails validation: interaction cleared, no movement this tick (`06#5`);
- a loc/obj op fires only on a tick with no step (`06#17`), so after walking it fires in the tick after arrival (`06§Inf`);
- movement is blocked when `moveClickRequest`, `busy()` and a non-empty normal or engine queue all hold (`Engine-TS/src/engine/entity/Player.ts:674-678`, `06#12`);
- a script run in phase-5 steps 1-5 that delays the player or opens a main/chat modal stops the interaction from firing that tick (`06#24`).

A script that re-arms the interaction (`p_oploc` etc.) is first tried on the **next** tick (`Engine-TS/src/engine/entity/Player.ts:1300-1313`, `06#19`).

### B. Which earlier writes each phase sees

**Inference.** Every phase reads and writes the same live objects; nothing copies state between phases, except phase 9's copy into rsbuf. So a phase sees every write made earlier in the same tick, and the previous tick's state otherwise. Rests on: the fixed call order in `cycle()` (each note's Position section); "no code copies NPC state between `processNpcs()` and `processPlayers()`" (`04#15`); the phase-9 snapshot (`09#4`); and the synchronous `cycle()` (`07#13` inference).

| Phase | Sees, from tick T | Sees, from earlier ticks | Rests on |
|---|---|---|---|
| 1 | nothing earlier in T (only between-tick async changes) | player state after T-1's phase 11; observer counts after T-1's phase 10, except a shutdown force-removal in T-1's tail and a first spawn or `DESPAWN` removal by a world-queue script earlier in phase 1 of T | `01#17`, `01#22`, `09#21` |
| 2 | phase-1 writes (e.g. a world-queue script's `p_delay`) | `delayed` as left by T-1's phase 5 | `02#15` |
| 3 | spawn/despawn entries queued in phases 1-2 of T | entries queued in phase 4 or later of T-1 | `03#13` |
| 4 | NPCs spawned in phases 1-3; players **before** this tick's player movement | | `03#15`, `04§Inf`, `04b§Inf` |
| 5 | NPC state **after** phase 4 (position, `delayed`, type); players earlier in `playerLoop` after their own phase-5 turn | | `04#15`, `06#26`, `06§Inf` (following) |
| 6 | the results of phase 5 (queues drained or not, `delayed`) | | `07#7`, `07#11` |
| 7 | slots freed by phase 6 | | `07§Inf` (slot reuse) |
| 8 | every loc/obj timer started and every zone event queued in phases 1-7 | | `08#5`, `08#18` |
| 9 | masks and fields as at the end of phase 8; players added in phase 7; players removed in phase 6 are gone | | `09#16`, `09#23`, `09#24` |
| 10 | the phase-9 snapshot (same for every observer); the phase-8 shared buffer; positions after phase 5; the origin after phase 9 | | `09#4`, `08#20`, `08#21`, `10#3` |
| 11 | runs after phase 10 has read everything it resets | | `11#2`, `11#4`, `11#7`, `11#9` |

Within a phase, order also matters: NPCs are visited in ascending nid (`04#1`), and players in `playerLoop` order, the same in phases 2, 5, 6, 9, 10 and 11 (`02#3`, `05#1`, `07§L2`, `09§L2.2`, `10§L2.2`, `11§L2.3`). In phase 4, NPCs step against a collision map that earlier NPCs have already updated (`04§Inf`).

### C. Same-tick versus next-tick for the key hand-offs

Each row is an inference from the cited notes; the notes' own inferences are marked `§Inf`.

| Hand-off | Same tick? | When | Rests on |
|---|---|---|---|
| `world_delay(d)` from a script outside phase 1 | no | resumes in phase 1 of T+d+2 (T+d+1 if it re-suspends inside phase 1 and is not the last entry) | `01#2`, `01#4`, `01#9`, `01§Inf` |
| World queue hands a `SUSPENDED` script to a player | hand-over yes (phase 1) | resumed in phase 5 of T+1+n for `p_delay(n)` | `01#7`, `05#5`, `05§Inf` |
| Player script enqueued with delay 0 (normal/weak/engine) | yes if enqueued in phases 1-4, this player's phase-2 packets, or earlier in its own phase-5 turn before that queue's pass, **and** `canAccess()` is true at that entry's visit; a weak entry is also cleared first by any `closeModal()` (a later move/op packet, a `STRONG` entry or a pending `requestModalClose`) | otherwise in phase 5 of T+1 (first accessible visit) | `05#22`, `05#10`, `02#16` |
| Queue entry with delay d | | if the player is accessible on every visit: T+d if added before the player's pass, T+1+d if after (a blocked entry runs on the first accessible visit) | `05§Inf` |
| NPC queue entry with delay d | | T+max(0, d-1) if added before the NPC's step 8, T+max(1, d) if after; assumes the NPC stays valid; each delayed or inactive tick postpones it by one | `04§Inf` |
| `p_delay(n)` / `npc_delay(n)` in tick T | no | phase 5 / phase 4 of T+1+n | `05§Inf`, `04§Inf` |
| `npc_add` spawn trigger | yes if queued in phases 1-2 (or by a phase-3 entry that is not last) and the NPC is not `delayed` at phase 3 | otherwise phase 3 of T+1; an entry for a delayed NPC is kept and re-checked every phase 3 | `03#11`, `03#13`, `03#14` |
| Zone event (loc/obj change) to client | yes if queued in phases 1-8 | `ENCLOSED` events: shared buffer in phase 8 of T, sent in phase 10 of T; `FOLLOWS` events: read directly from `events` by `writePartialFollows` in phase 10 of T; nothing queues one in phases 9-11. If phase 8's `catch` fires, the remaining zones get no shared buffer that tick and their `ENCLOSED` events are dropped (`FOLLOWS` still sent) | `08#18`, `08#21`, `08#26`, `08§Inf`, `09#18` |
| Loc/obj timer with duration d started in phases 1-7 | | fires in phase 8 of T+d-1 (so d=1 fires the same tick) | `08§Inf` |
| Mask set in phases 1-8 | yes | encoded phase 9, sent phase 10 of T; last write wins | `09#16` |
| Target changed after phase-5 step 6 | no | `FACE_ENTITY` re-armed in phase 11, sent in T+1 | `06#1`, `09#18`, `11#5`, `06§Inf` |
| Inventory change, stat change, run energy | yes | phase 10 of T | `10#5`, `10#7`, `10#8` |
| Shop restock | no | phase 10 of T+1 | `11#8`, `10#13` |
| Immediate packet (`mes`, `if_settext`, varps, ...) | yes | in the phase where the script runs, before all of that player's phase-10 packets | `10#11`, `10#13` |
| Login (`newPlayers` filled between ticks) | partly | phase 7 of T: map and login packets, `[login,_]` script; phases 9-11 of T: info, inventories, stats, zones; first phase 2, 5 and 6 in T+1; zone/mapzone engine-queue triggers enqueued in phase 10 of T, run from phase 5 of T+1 | `07#13`, `07#15`, `07#16`, `07#17` |
| Logout button decoded in phase 2 of T | yes, if all of: `p_finduid` succeeds (player accessible, or the script already holds protected access), not in a duel or on a gnomeball pitch, `currentTick >= preventLogoutUntil`, and at phase 6 `canAccess()`, an empty engine queue and only `LONG` entries with `logoutAction` 1 in the normal queue | removed in phase 6 of T; absent from phases 7-11 of T; if `currentTick < preventLogoutUntil` the request is dropped, not retried, and `loggingOut` is not set (the button must be pressed again); if `loggingOut` was set but a phase-6 removal condition fails, removal is retried every tick while `loggingOut` | `07#1`, `07#5`, `07#7`, `07#11` |
| Zone/mapzone trigger enqueued in phase 10 | no | phase 5 of T+1 at the earliest | `05#20`, `05#22` |

### D. State written in more than one phase, and what the order of writes implies

**Inference** in each bullet, resting on the cited rows and rules.
- **Masks.** Written in phases 2, 4, 5, 7 (reconnect) and by scripts in phases 1-7; read once in phase 9; cleared only in phase 11, which then re-arms `FACE_ENTITY` (`09#16`, `09#17`, `09#18`, `11#5`). So the last write before phase 9 is what is sent, and a target change after the facing step is sent a tick late.
- **Weak queue.** Cleared by `closeModal()` in phase 2 (move/op packets), phase 5 (a `STRONG` entry or `requestModalClose`) and phase 6 (every removal attempt) (`02#16`, `05#10`, `07#6`). So a weak entry queued before phase 5's `processQueues` can be cleared before its pass (`05#22`); while any `STRONG` entry is queued, weak entries that existed at the start of `processQueues` never run (`05§Inf`).
- **Player `delayed`.** Set by scripts in any script phase, cleared only at step 1 of phase 5 (`05#4`). So it holds in phase 2 of the tick it expires. Packets decoded while it holds are treated by type (`02#15`): move, op, inventory-button and held-item packets are refused (dropped, not deferred); resume packets and `IF_BUTTON` resumes of a `PAUSEBUTTON` script run forced; an overlay `IF_BUTTON` script runs; a non-overlay `IF_BUTTON` (and tutorial) packet is accepted and counted but its protected script is refused by `runScript`; social and appearance packets are accepted (`02#15`), and so is `IDLE_TIMER` (its handler has no `delayed` check, `02#13`).
- **NPC `delayed`.** Set by scripts, cleared by time only in phase 4 (`04#6`), but read first by phase 3 (`03#11`). So a spawn trigger for an NPC delayed with `npc_delay(n)` in tick T runs in phase 3 of T+2+n at the earliest (`03§Inf`).
- **`protect`.** Set in script phases, reset in phase 11 (`05#7`, `11#3`). So "preserve protected access" lasts at most to the end of the tick; on later ticks a waiting script blocks through `delayed` (`05#7`).
- **Engine queue.** Filled in phase 10 (zone triggers) and by stat changes, drained in phase 5, required empty by phase 6 (`05#20`, `05#21`, `07#7`). So a zone trigger enqueued in phase 10 of T is still queued at phase 6 of T+1, and blocks removal there, if the player was not accessible at its visit in phase 5 of T+1 (an engine-queue entry runs and is unlinked on its first accessible visit). Rests on those three rules and the phase order.
- **`loggingOut`.** Written in phase 6, phase 2 (`::kick`), by the script-error path and between ticks (kick) (`07#1`); read by phase 5's timer gate (`05#19`). So a logout accepted in phase 6 of T freezes timers from phase 5 of T+1; one set by a script error earlier in the same phase-5 turn skips that turn's timers (`05#3`).
- **Player position and zone.** Written in phase 5 (steps), 6 (leave), 7 (enter) and by script teleports; snapshotted in phase 9 and used by phase 10 for active zones (`06#15`, `07#8`, `07#15`, `08#20`, `09#5`). Phase 4 NPCs see the position from before phase 5 (`04§Inf`).
- **NPC observer counts.** Changed in phase 10 (per observer), phase 6 and the tail (removals), and by `addNpc`/`removeNpc` (`09#19`); read in phases 1 and 4, so they see the value after the previous tick's phase 10, changed only by a shutdown force-removal in T-1's tail and by a first spawn or `DESPAWN` removal earlier in tick T (for phase 1, by a world-queue script before the hunt loop) (`09#21`).
- **Zone events and `zonesTracking`.** Added in phases 1-8, read in phases 8 and 10, cleared in phase 11 (`08#16`, `08#24`). One shared buffer per zone per tick (`08#18`).
- **Modal state.** Changed in phases 2, 5, 6 and 7 (reconnect) and by scripts; phase 10 sends only the final state of the tick (`10#10`).
- **Inventory dirty flags.** Set by any change; read in phase 10; cleared in phase 11, then restock sets them again for the next tick (`10#5`, `11#7`, `11#8`).
- **`lastStats`/`lastRunEnergy`.** Written only in phase 10; `onReconnect` in phase 7 sends stats without updating them, so phase 10 of the reconnect tick can send changed stats again (`10#23`).

### E. Writes outside the phase order

**Inference.** Three kinds of write do not belong to a single phase:
1. **Immediate writes by scripts and handlers, inside a phase.** A script command or handler changes state at once, in whichever phase runs it (phases 1-7, `09#17`), and packets it writes go to the socket at once (`Engine-TS/src/engine/entity/Player.ts:2239-2245`, `10#1`, `10#11`). Later phases of the same tick see the change (Conclusion B). Examples: phase-2 `IF_BUTTON` scripts run before NPCs and before every player's phase-5 turn (`02§Inf`); a player script's `npc_delay` is resumed in the NPC's phase-4 turn (`04#7`).
2. **Between-tick handlers (Node event loop).** `cycle()` and every phase are synchronous and the next cycle is scheduled with `setTimeout` (`Engine-TS/src/engine/World.ts:508`), so socket and worker-thread handlers run only between ticks (`07#13` inference; language semantics, not engine code). They see the next tick's `currentTick` (`11#12` inference). What they write and where it lands:
   - socket `data`: bytes appended to `client.in`, decoded in the next phase 2 (`02§Pos`, `02#9`);
   - socket `close`: `client.state = -1` and the player's `client` replaced by `NullClientSocket` (`Engine-TS/src/server/tcp/TcpServer.ts:43-51`, `07#4`); from then on phases 2 and 10 skip the player and the phase-6 timeouts start (`07#4`, `10#16`);
   - login packet and login-thread replies: `loginRequests`, `newPlayers`, `client.state = 1` (`07#12`, `07#13`), applied in the next phase 7; logout responses delete `logoutRequests` entries (`07#10`); the login thread's `message` handler is wrapped in a `try`/`catch` that only logs (`Engine-TS/src/engine/World.ts:180-186`, `07#13`);
   - friend-server messages: `RELAY_KICK` sets `loggingOut` and closes the socket (`07#1`), `RELAY_TRACK` turns on input tracking (`02#18`), `RELAY_CLEARLOGOUTS` clears `logoutRequests` (`07#10`), `RELAY_QUEUESCRIPT` enqueues a normal-queue script (`05#9`; not traced when it runs);
   - signals: `SIGINT`/`SIGTERM` set `shutdownTick`, so the next tick is the first shutdown tick (`11#12`).
3. **Outgoing worker-thread posts** in phases 2, 6, 7 and the tail (Table 4, last row). What the worker threads do with them was not read (open questions #22, #34).

### F. Exceptional paths, consolidated

**Finding summary** (copied from `11#24` and checked against each phase note), with the per-note consequences:

| Phase | Catch granularity | What happens | Rests on |
|---|---|---|---|
| 1 | per world-queue entry and per delayed-obj entry; **none** around the NPC hunt loop (`Engine-TS/src/engine/World.ts:577-592`) | a failing entry is already unlinked and is dropped (logged); a hunt throw takes the crash path | `01#6`, `01§L2.4` |
| 2 | per player (`Engine-TS/src/engine/World.ts:635-641`) | `Logout` + `close()`; rest of that player's phase 2 skipped; player stays in `playerLoop` and is processed by later phases this tick | `02#20` |
| 3 | **none** (`Engine-TS/src/engine/World.ts:648-657`) | e.g. `Npc.executeScript` routing to a null active player throws, crash path | `03#12` |
| 4 | per NPC (`Engine-TS/src/engine/World.ts:665-676`) | `removeNpc(npc, 0)`: a `DESPAWN` NPC is removed without `AI_DESPAWN`; a `RESPAWN` NPC respawns next turn unless it is delayed, in which case by the code read it never respawns | `04#3`, `03#6`, `03§Inf` |
| 5 | per player (`Engine-TS/src/engine/World.ts:727-733`) | `Logout` + `close()`; rest of the turn skipped; a normal/weak entry being run is lost, an engine-queue entry stays queued; a throw inside an op/ap wrapper loses the target | `05#3`, `05§Inf`, `06#25`, `06§Inf` |
| 6, 7 | **none** | crash path | `07§Pos` |
| 8 | one around the whole phase (`Engine-TS/src/engine/World.ts:965-986`) | rest of the phase skipped; if step 2 stopped, no zone gets a shared buffer that tick and its `ENCLOSED` events are dropped | `08#26`, `08§Inf` |
| 9 | **none** | crash path; a missing block cache throws later, in phase 10 | `09#26`, `09#27` |
| 10 | per connected player (`Engine-TS/src/engine/World.ts:1124-1130`) | `Logout` + `close()`; later steps skipped for that player, their tracking fields left unchanged; the `catch` body itself is unguarded | `10#18`, `10#19` |
| 11, tail | **none** | crash path | `11#24` |

- **Crash path.** `cycle()`'s `catch` (`Engine-TS/src/engine/World.ts:509-526`) removes every player and calls `process.exit(1)`; the rest of that tick, including `currentTick++`, does not run (`11#22`). The saves it builds are only stored in `logoutRequests` and are never posted (`11#23` inference).
- **Script errors** do not reach any of these `catch` blocks: `ScriptRunner.execute` catches them and returns `ABORTED`; in production it also logs out a player `self` (setting `loggingOut`) or removes an NPC `self` (`01#6`, `05#3`, `04#3`).
- **No per-player `catch` removes the player.** The phase 2, 5 and 10 blocks only send `Logout` and call `close()`; the player stays in `playerLoop`, keeps running queues and timers, and is written to until the socket `close` event swaps in a `NullClientSocket`, after which the phase-6 timeouts apply (`05#3`, `07#4`, `10#17`, `10#18`; open question #29).

### Not established by the notes

- Whether an `IF_CLOSE` script run by `closeModal()` (phases 2, 5, 6) can reopen a main/chat modal, which would change the `busy()` reads that follow in the same phase (open question #4; `02#16`, `07#7`).
- When the friend-server `RELAY_QUEUESCRIPT` handler and `notifyPlayerBan` run relative to the tick (`05#9`, `07#1`); only the between-tick inference for socket and worker `message` handlers (`07#13`) covers them, and that inference is about JavaScript semantics. `docs/open-questions.md` #50.
- When Node emits `close` after `close()`/`end()`, which bounds how long a caught player keeps receiving writes (open question #29).
- Whether entities added during a phase-4 pass or timers added during a timer pass are visited in the same pass: this depends on JavaScript typed-array and `Map` iteration semantics, not engine code (`04#2`, `04§Inf`, `05§Inf`). `docs/open-questions.md` #48.
- Nothing in this note was observed by running the server; every timing above is "read, not observed".

## Inconsistencies between notes found while building this matrix

None of these changes a cell. Both were corrected in the notes in review fix round 1 (minimal wording edits):
- [`09-info.md`](09-info.md) Inferences (first bullet) quoted wording of an [`01-world.md`](01-world.md) inference ("an NPC nobody can see never player-hunts") that 01 no longer contains; it now quotes 01's current wording ("observer count is 0") and its drift caveat.
- [`10-clients-out.md`](10-clients-out.md) rule 13 said "Phases 1-8 run scripts and handlers"; it now says phases 1-7, and that phase 8 writes no packet ([`08-zones.md`](08-zones.md) rule 6; [`09-info.md`](09-info.md) rule 17 lists script phases 1-7).
- Also fixed in the same round: two wrong rule numbers in [`08-zones.md`](08-zones.md) L2 (the phase-wide `catch` is rule 26, not 22; "builds no per-player zone list" is rules 20 and 25, not 23).

## Not checked / open questions

- No cell was checked by running the server. Cells marked from script commands rest on the notes' handler reads; what content scripts actually do in each phase was not enumerated (the notes say so: e.g. `03#7`, `05#23`).
- An empty cell means no read or write is **established by the notes**; it is not proof that none exists, except where a note states it (e.g. `11#10`, `09#18`).
- Open questions referred to above: #4, #22, #29, #34, #45, and #48, #50 (added to `docs/open-questions.md` in the final pass). No new open question is added by this note.

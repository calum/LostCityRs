# Scenarios: four worked tick timelines

**Question answered:** For four concrete player actions (chop a tree, walk, talk to an NPC that is busy with its own queue on the same tick, act while a script is delayed and a queue entry is waiting), what happens on each tick and in which phase, which note rule establishes each step, and where the outcome depends on when the client's bytes arrive within the 600 ms window?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only `Content/scripts/skill_woodcutting/scripts/woodcut.rs2` lines 1-142 read)
- Client-TS: `7d6ca61` (branch `calum-research`; only the `tryMove` packet writer and the loc/NPC op send sites read)

**Method:** synthesised from notes 01-11 and the flow notes; code read, not observed. Every row was checked against the rule it cites, and the code line was opened for the rows that give one (see "Cross-check" at the end). Nothing was run. Every timing here is "read, not observed".

**Notation.** `06#17` means [`06-players-interaction-movement.md`](06-players-interaction-movement.md) L3 rule 17; `06§Inf` its Inferences section; `02§Pos` the "Position in the tick" section of [`02-clients-in.md`](02-clients-in.md). `click-loc §4`, `move §3` and `response §7` are sections of [`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md), [`../flows/move-opclick.md`](../flows/move-opclick.md) and [`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md). Phases are numbered as in [`00-overview.md`](00-overview.md): 1 world, 2 clients in, 3 NPC event queue, 4 NPCs, 5 players (steps 1-11 of a player's turn, `05§L2` and `06§L2`), 6 logouts, 7 logins, 8 zones, 9 info, 10 clients out, 11 cleanup. `T` is the tick in whose phase 2 the first packet is decoded.

## When does a packet get processed? (applies to all four scenarios)

- Client bytes are not read during a tick. The socket `data` handler appends each chunk to `client.in` (`Engine-TS/src/server/tcp/TcpServer.ts:31-37`; WebSocket the same), and for a logged-in client nothing consumes them until `decodeIn` in phase 2 (`02§Pos`). Phase 2 is the only phase that decodes game packets (`02#4`-`02#7`).
- `cycle()` and every phase are synchronous and the next cycle is started by `setTimeout` (`Engine-TS/src/engine/World.ts:508`), so the `data` handler can only run between two cycles (`07#13` inference; JavaScript semantics, not engine code).
- **Inference: the arrival window for tick T.** A chunk handled between the end of cycle T-1 and the start of cycle T is decoded in phase 2 of T. A chunk that reaches the process while cycle T is running, even during phase 1 before phase 2 starts, is buffered only after cycle T returns and is decoded in T+1. So "early vs late in the 600 ms window" means: before or after the moment cycle T starts. Whether a chunk that became ready while cycle T-1 was running is always handled before the timer for cycle T fires depends on Node's event-loop ordering, which was not read (new open question #46).
- A packet whose payload is only partly buffered at phase 2 waits, with its opcode kept, for the next tick (`02#7`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:125-127` as cited there). At most 5 accepted user events are decoded per player per tick; the rest stay buffered for the next tick in order (`02#5`, `02#6`, `02#9`).
- When the client actually sends its buffered `out` bytes (so how its clicks map to arrival times) was not read (#46).

---

## Scenario 1: click a tree (loc op 1) two tiles away, and the chop loop

**Setup.** The player clicks "Chop down" on a tree whose operable tile is two walking steps away in a straight line, with run off. The client writes `MOVE_OPCLICK` (route: one point, the destination) and then `OPLOC1` (`click-loc §1`).

**Assumptions (all must hold for this timeline):**
- Both packets are fully buffered before cycle T starts, and at most 3 accepted user events precede them in that tick's decode (the limit 5 is checked before each `read()` and each of the two packets takes a user slot, so with 4 before them `MOVE_OPCLICK` is the 5th and `OPLOC1` waits for the next tick), and fewer than 20 client-category packets (including rejected user events) precede them (`02#5`, `02#6`, `02#7`; `Engine-TS/src/engine/entity/NetworkPlayer.ts:69`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:141-147`).
- The player is not `delayed`, not `loggingOut`, has no main/chat modal open, the world is not shutting down, and no queue, timer or engine-queue script in phase-5 steps 1-5 delays it, opens a main/chat modal or leaves `protect` set, on any tick below, so `canAccess()` is true at step 8 (`05#8`, `06#24`).
- The tree loc exists, is active, is within 52 tiles of the origin, its type has op 1 (not `hidden`) and op 3 (any truthy value, so `p_oploc(3)` does not return early) (`click-loc §3`; `Engine-TS/src/engine/script/handlers/PlayerOps.ts:392-395`); whether the tree's config has op 3 is open question #8.
- No `[aploc1,_tree]`/`[aploc3,_tree]` script exists (open question #9), so `tryInteract`'s ap branch never runs.
- The two route steps are not blocked (`canTravel` true; not read, #4) and the destination is in operable distance of the loc (`rsmod.reached`; not read, #4).
- Woodcutting level, free inventory space, an axe, `%action_delay < map_clock` on the first run, `afk_event` returns false, no `walktrigger` set, and no other player or script touches the tree.

| tick | phase | what happens | rule/finding cited |
|---|---|---|---|
| before T | client side | Menu option runs `interactWithLoc`, which calls `tryMove(..., 2)` (writes `MOVE_OPCLICK`) and then writes `OPLOC1` with x, z, loc id. | `click-loc §1`; `Client-TS/src/client/Client.ts:5591`, `Client-TS/src/client/Client.ts:5601-5604`, `Client-TS/src/client/Client.ts:5843` |
| between T-1 and T | between ticks | The socket `data` handler appends the bytes to `client.in`; nothing decodes them yet. | `02§Pos`; `Engine-TS/src/server/tcp/TcpServer.ts:31-37` |
| T | 2 | `MOVE_OPCLICK`: player not delayed, route valid; `opClick`, so the interaction is **not** cleared; `tempRun` from ctrl; `queueWaypoints` (one waypoint, the destination); walk trigger (none set). Handler returns `true`: 1 user slot. | `move §3`, `02#6`; `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12-15`, `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-50`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:141-147` |
| T | 2 | `OPLOC1`: checks pass; `clearPendingAction()` (clears the old interaction, `closeModal()`: weak queue cleared, any modal closed); `setInteraction(loc, APLOC1)` sets target, `targetOp`, `apRange = 10`, `targetX/Z`; `opcalled = true`. 2 user slots used. | `click-loc §3`, `02#13`, `02#16`, `05#10`; `Engine-TS/src/network/game/client/handler/OpLocHandler.ts:14-48`, `Engine-TS/src/engine/entity/Player.ts:970-973`, `Engine-TS/src/engine/entity/PathingEntity.ts:534-561` |
| T | 2 | Flag block: not delayed, `!busy() && opcalled`, so `moveClickRequest = false`. | `02#12`; `Engine-TS/src/engine/World.ts:617-629` |
| T | 5 (steps 1-7) | Steps 1-5 run nothing (assumption). `setFaceEntity`: a loc target gives `faceEntity = -1` (mask only if it changed); `reorientEntity` does nothing for a loc. | `05§L2`, `06#1`, `06#2`; `Engine-TS/src/engine/entity/PathingEntity.ts:514-532` |
| T | 5 (step 8.2) | Pre-move attempt: `canAccess()`, target valid, walk trigger, `tryInteract(false)`: the op branch cannot run for a loc (`allowOpScenery` false); no ap trigger, so if within approach distance branch 3 sets `apRange = -1`; returns `false`. | `06#5`, `06#6`, `06#9`; `Engine-TS/src/engine/entity/Player.ts:1256-1270`, `Engine-TS/src/engine/entity/Player.ts:1170`, `Engine-TS/src/engine/entity/Player.ts:1220-1223` |
| T | 5 (step 8.3) | No re-path for a loc. `updateMovement`: gate off (`moveClickRequest` false); speed `WALK`; one `validateAndAdvanceStep`: one tile; `stepsTaken = 1`. | `06#10`, `06#12`, `06#13`, `06#14`; `Engine-TS/src/engine/entity/Player.ts:674-699`, `Engine-TS/src/engine/entity/PathingEntity.ts:135-152` |
| T | 5 (step 8.3.5) | Post-move `tryInteract(false)` (a step was taken): no op. No "I can't reach that!" (a waypoint is left and a step was taken). | `06#17`; `Engine-TS/src/engine/entity/Player.ts:1287-1297` |
| T | 5 (steps 9-11) | `reorient` skipped (`stepsTaken` 1); energy regained (fewer than 2 steps); no `jump`. | `06#21`, `06#22`, `06#23`; `Engine-TS/src/engine/entity/Player.ts:701-723` |
| T | 9, 10 | `PLAYER_INFO`: local player walk bits (`walkDir`); observers get walk bits for this player; `UPDATE_RUNENERGY` only if the integer energy changed. | `09#10`, `09#11`, `09#12`, `10#4`, `10#8`; `Engine-TS/src/network/rsbuf/info.ts:51-65`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:326-329` |
| T | 11 | `walkDir`/`runDir` -1, `stepsTaken` 0, `lastTickX/Z` = position, masks 0. Target and the waypoint list are kept. | `11#4`, `11#10`; `Engine-TS/src/engine/entity/PathingEntity.ts:593-631` |
| T+1 | 5 (step 8) | Pre-move: no op (loc, `allowOpScenery` false). Second step reaches the only waypoint: `waypointIndex` drops to -1. Post-move: no op (`stepsTaken` 1). End: no waypoints and a step taken, so `unsetMapFlag()`: `UNSET_MAP_FLAG` is written at once. | `06#15`, `06#17`, `06#19`; `Engine-TS/src/engine/entity/PathingEntity.ts:233-239`, `Engine-TS/src/engine/entity/Player.ts:1310-1313`, `Engine-TS/src/engine/entity/Player.ts:2247-2250` |
| T+2 (= A) | 5 (step 8) | Pre-move `tryInteract(false)`: `false`. No waypoints: `processMovement` returns `false`, `tempRun = 0`, no step. Post-move `tryInteract(true)`: op branch: `getOpTrigger()` looks up `targetOp + 7` = `OPLOC1` for the tree's type/category, finds `[oploc1,_tree]`; target set to `null`, waypoints cleared, script run protected. This is the "A+1" (arrival tick + 1) case of 06's timing table. | `06#6`, `06#8`, `06#17`, `06§Inf`; `click-loc §4`; `Engine-TS/src/engine/entity/Player.ts:1170-1183`, `Engine-TS/src/engine/entity/Player.ts:1017`, `Engine-TS/src/engine/script/ServerTriggerType.ts:56`, `Engine-TS/src/engine/script/ServerTriggerType.ts:63`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:1` |
| A | 5 (script) | `@attempt_cut_tree`: checks pass; `%action_delay < map_clock` (`map_clock` pushes `World.currentTick`), so `%action_delay = A+3`, `p_oploc(1)`, `return`. | `click-loc §5`; `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:55-62`, `Engine-TS/src/engine/script/handlers/ServerOps.ts:16-17` |
| A | 5 (script) | `p_oploc(1)`: `stopAction()` = `clearPendingAction()` (`clearInteraction`, `closeModal`: weak queue cleared again) + `unsetMapFlag()` (`UNSET_MAP_FLAG` written); in operable distance, so no waypoint; `setInteraction(loc, APLOC1)`. | `click-loc §5`; 06 "Everything that clears a player's target" table; `Engine-TS/src/engine/script/handlers/PlayerOps.ts:387-401`, `Engine-TS/src/engine/entity/Player.ts:964-973` |
| A | 5 (step 8.4) | `nextTarget` holds the re-armed loc, so it becomes the target; the re-armed interaction is first tried on the next tick. | `06#19`; `Engine-TS/src/engine/entity/Player.ts:1300-1303` |
| A | 5 (step 9) | `reorient`: target is a loc, `targetX/Z` pending (re-set by `p_oploc`), no step: `FACE_COORD` mask; the player turns to the tree in A's `PLAYER_INFO`. | `06#21`; `Engine-TS/src/engine/entity/PathingEntity.ts:383-392` |
| A+1 | 5 (step 8) | Same path as A: post-move op runs `[oploc1,_tree]` again. `%action_delay` (A+3) is not `< A+1`: axe check, `anim`, `sound_synth`, `mes("You swing your axe at the tree.")`; not equal to `map_clock`, so no `@get_logs`; `p_oploc(3)`. | `06#19`, `06§Inf` (re-armed at most once per tick); `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:64-78` |
| A+1 | 5, then 9-10 | `MESSAGE_GAME` and `SYNTH_SOUND` (skipped for a low-memory client) are written during phase 5; `anim` only sets the `ANIM` mask (and only if `animProtect` is not set and the new sequence's priority is at least the current one's, `Engine-TS/src/engine/entity/Player.ts:1920-1929`), sent in phase 10's `PLAYER_INFO`, i.e. after the message and sound. | `10#11`, `10#12`, `10#13`; `response §2-5`; `Engine-TS/src/engine/script/handlers/PlayerOps.ts:343-347`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:476-487`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:196-201` |
| A+2 | 5 (step 8) | `[oploc3,_tree]` runs `@cut_tree`: `%action_delay` (A+3) is neither `<` nor `=` A+2, so only `p_oploc(3)`. | `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:3`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:108-115` |
| A+3 | 5 (step 8) | `@cut_tree`: `%action_delay = map_clock`: `anim`, `@get_logs`: success roll; on success `mes`, `stat_advance`, `inv_add`; then either `loc_change` + `anim(null, 0)` + `return` (no re-arm, so step 8.4 clears the interaction) or `p_oploc(3)`. | `06#19`; `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:110-113`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:130-142` |
| A+3 | 5, then 10 | `MESSAGE_GAME` at once; `stat_advance` and `inv_add` only change state, so phase 10 sends `PLAYER_INFO` (anim), then `UPDATE_INV_PARTIAL`, then `UPDATE_STAT` (xp times `xpRate`). | `10#5`, `10#7`, `10#13`; `response §6-7`; `Engine-TS/src/engine/script/handlers/PlayerOps.ts:810-817`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:317-324` |
| A+3 | 8, 10 | If `loc_change` ran: an `ENCLOSED` `LocAddChange` event; phase 8 puts it in the zone's shared buffer; phase 10 sends it in `UPDATE_ZONE_PARTIAL_ENCLOSED` to every connected player with that zone active. | `08#27`; `Engine-TS/src/engine/World.ts:1365-1401` |
| A+3 → A+4 | 5 | On a level-up, `addXp` enqueued the `ADVANCESTAT` script if one exists for that stat (and `changeStat` the `CHANGESTAT` script if one exists) on the engine queue during step 8; it runs at step 5 of A+4, before that tick's chop attempt in step 8, if accessible. | `05#20`, `05#22` (row "Steps 6-11"); `response §7`; `Engine-TS/src/engine/entity/Player.ts:1883-1886` |
| A+4 | 5 (step 8) | `@cut_tree`: `%action_delay` (A+3) `< A+4`: set to A+7; `p_oploc(3)`. A+5, A+6 as A+2; A+7 as A+3. | `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:108-109`; see Inferences |

**Arrival time.** If both packets are buffered before cycle T starts, the first step is in T and the op in T+2. If they arrive after cycle T starts (even during its phase 1), everything shifts to T+1. If the two packets land on different sides of that moment, `MOVE_OPCLICK` is decoded in T with `opcalled` false, so `moveClickRequest = true` (`02#12`), the player walks in T with whatever interaction it already had (the handler does not clear it, `move §3`), and `OPLOC1` sets the tree interaction in T+1. The chop-loop ticks after A are internal and do not depend on arrival.

**What would differ otherwise:**
- Already standing on an operable tile: if no route is sent and nothing else moves the player, the post-move attempt of T has `stepsTaken` 0 and runs the op in T (`06§Inf` table, "already in range"). What the client sends when the player already stands at the destination was not read.
- Run on: two steps in T, and the op on T+1 (arrival in T).
- Player delayed at decode: both packets are dropped with `UNSET_MAP_FLAG`, not retried (`02#15`).
- Player busy or protected at step 8: no attempt that tick; the player still walks (`06#24`), and the op fires on the first accessible tick with no step.
- An `[aploc*,_tree]` script exists (#9): it would run in the pre-move attempt whenever within `apRange` with line of sight (`06#9`).
- Tree op 3 missing in the loc config (#8): `p_oploc(3)` returns before re-arming (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:393-395`); the interaction is then cleared at step 8.4 and the loop stops after A+1.
- A level-up script that opens a main/chat modal in step 5 of A+4 makes the player busy, so that tick's chop is not tried (`06#24`); content not read.
- A weak-queue entry queued while chopping survives only if it falls due in a step-3 weak pass before the next chop pass: every `p_oploc` in step 8 calls `stopAction()` → `closeModal()`, which clears the weak queue (`05#12`; `Engine-TS/src/engine/entity/Player.ts:964-973`).

---

## Scenario 2: walk (the `MOVE_OPCLICK` route), walking versus running

**Setup.** Same click mechanism as scenario 1, with a route that turns once: the player at (0,0) is sent to (3,5) by a route that goes diagonally to (3,3) and then north (illustrative: the client's route search was not run for these tiles). The client sends the turn point nearest the player as the start point and the destination as one offset (`move §1`, `Client-TS/src/client/Client.ts:5801-5834`): `start = (3,3)`, one waypoint `(3,5)`. The engine stores them reversed, so `waypoints[1] = (3,3)` is walked first and `waypoints[0] = (3,5)` is the destination (`move §3`; `Engine-TS/src/engine/entity/PathingEntity.ts:268-275`). The paired op packet and what it does at the end are scenario 1.

**Assumptions:** as scenario 1 for decoding and access; every step is allowed by `canTravel` (not read, #4); the player is not teleported, `INSTANT`, or delayed by a script; for the running case `run` is on (or ctrl held with `runenergy >= 100`), `runanim !== -1`, and energy does not reach 0 before the end.

| tick | phase | what happens (walking) | rule/finding cited |
|---|---|---|---|
| T | 2 | `MoveClickDecoder` reads `ctrlHeld`, start, offsets; handler queues `[start, dest]` reversed: `waypointIndex = 1`. `userPath` is set, so the flag block runs; with the op accepted and not busy, `moveClickRequest = false`. | `move §2-4`, `02#12`; `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:42-50`, `Engine-TS/src/engine/entity/PathingEntity.ts:268-275`, `Engine-TS/src/engine/World.ts:617-629` |
| T | 5 (step 8.3.4) | `takeStep` heads for `waypoints[1]` = (3,3) by the sign of dx/dz: diagonal first (width 1, `canTravel`), so (1,1). `stepsTaken = 1`, `walkDir` = north-east. | `06#14`, `06#15`; `Engine-TS/src/engine/entity/PathingEntity.ts:633-679`, `Engine-TS/src/engine/entity/PathingEntity.ts:206-252` |
| T | 5 (step 10) | Fewer than 2 steps: energy `+ floor(agility/6) + 8`, capped at 10000. | `06#22`; `Engine-TS/src/engine/entity/Player.ts:701-713` |
| T | 9, 10 | `PLAYER_INFO`: walk bits `1, 1, walkDir, has-blocks`; other observers get the same movement for this player. | `09#11`, `09#12`; `Engine-TS/src/network/rsbuf/info.ts:51-65` |
| T+1 | 5 | (2,2). | `06#14` |
| T+2 | 5 | (3,3): the current waypoint is reached, `waypointIndex` 1 → 0. | `06#15`; `Engine-TS/src/engine/entity/PathingEntity.ts:233-239` |
| T+3 | 5 | (3,4), heading for `waypoints[0]`. | `06#15` |
| T+4 | 5 | (3,5): last waypoint reached, `waypointIndex` -1. End of `processInteraction`: no waypoints and a step taken, so `UNSET_MAP_FLAG` at once. | `06#19`; `Engine-TS/src/engine/entity/Player.ts:1310-1313` |
| T+5 | 5 | No waypoints: `processMovement` returns `false`, `tempRun = 0`, no movement bits (idle or blocks-only in `PLAYER_INFO`). For the paired loc op, this is the tick the op runs (scenario 1 row A). | `06#14`, `09#11`; `Engine-TS/src/engine/entity/Player.ts:689-692` |

| tick | phase | what happens (running) | rule/finding cited |
|---|---|---|---|
| T | 5 | Speed `RUN` (`run` set, or `tempRun`), chosen before energy is touched. First step (1,1) moved, so a second call: (2,2). `walkDir` and `runDir` both set, `stepsTaken = 2`. | `06#13`, `06#14`; `Engine-TS/src/engine/entity/Player.ts:680-687`, `Engine-TS/src/engine/entity/PathingEntity.ts:144-149` |
| T | 5 (step 10) | 2 steps: energy `- floor(67 + 67*w/64)`, `w` = weight in kg from the previous phase 10, clamped 0-64. | `06#22`; `Engine-TS/src/engine/entity/Player.ts:701-723` |
| T | 9, 10 | `PLAYER_INFO`: run bits `1, 2, walkDir, runDir, has-blocks`; `UPDATE_RUNENERGY` if the integer energy changed. | `09#11`, `10#8` |
| T+1 | 5 | (3,3) reaches waypoint 1; the second step heads for (3,5): (3,4). | `06#14`, `06#15` |
| T+2 | 5 | (3,5) reaches the last waypoint; the second call finds `waypointIndex === -1` and returns -1, so `runDir = -1`, `stepsTaken = 1`: info carries **walk** bits and energy is **regained** this tick. `UNSET_MAP_FLAG` at once. | `06#14`, `06#22`; `Engine-TS/src/engine/entity/PathingEntity.ts:215-218` |

**Arrival time.** Same rule as scenario 1: buffered before cycle T starts, first step in T; otherwise T+1. If 4 or more accepted user packets precede the pair in the same tick's decode (or 20 client-category packets), the pair or its second packet waits for the next tick (`02#5`, `02#6`, `02#9`).

**What would differ otherwise:**
- `MOVE_GAMECLICK` (a plain ground click): the handler also calls `clearPendingAction()` (target cleared, modal closed, weak queue cleared), and with no op packet `moveClickRequest = true` (`02#12`, `02#16`; `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32`).
- Blocked step: `takeStep` returns `[0, 0]`, the waypoint is not popped and is retried next tick; there is no path search (`06#15`).
- Busy with `moveClickRequest` true and a non-empty normal or engine queue: no movement that tick (`06#12`).
- A `p_telejump` or level-changing teleport before the step: `INSTANT`, no walking that tick (`06#13`).
- Delayed at decode: `UNSET_MAP_FLAG` and the route is dropped (`02#15`). Delayed later while waypoints remain: the player keeps walking (`06§Inf`).
- Energy reaching 0 on a running tick: the two steps are still taken; `run` is switched off afterwards (`06#22`).
- A route with more than 25 turn points: the client sends only the 25 nearest the player (`move §1`; `Client-TS/src/client/Client.ts:5830-5863`), so the player stops at the 25th and the destination is not reached by this packet.
- `clientRoutefinder` false: the engine computes the path with `findPath` to the last point instead (`move §3`; not read, #4).

---

## Scenario 3: talk to an NPC that runs a queued script on the same tick

**Setup.** NPC N has default mode `WANDER` (the type default, `04b#1`) and one `npc_queue` entry that is due in phase 4 of tick T (an entry with delay d added before N's step 8 runs in tick T0 + max(0, d-1), `04§Inf`). The player P, three tiles from N, clicks N's op 1. The client calls `tryMove(..., 2)` toward N (so a `MOVE_OPCLICK` if a route exists) and writes `OPNPC1` (`Client-TS/src/client/Client.ts:8687`, `Client-TS/src/client/Client.ts:8695`). Two cases: **(B)** N's `ai_queue` script calls `npc_delay(2)`; **(A)** it does not delay N.

**Assumptions:** P as in scenario 1 (not delayed, not `loggingOut`, accessible at step 8, packets before cycle T); N is active, not delayed at phase 2 of T, is in P's NPC-info list (`rsbuf.hasNpc`), its type has op 1 not `hidden` and an `[opnpc1,...]` script, and no `[apnpc1,...]` script (an existing one would run in the pre-move attempt whenever P is within `apRange` 10 with line of sight, `06#6`, `06#9`, `Engine-TS/src/engine/entity/Player.ts:1186`); P is not N's hunt target and has no `ai_timer` or hunt this tick; the queue script does not remove N or change its type; nothing else in phases 1-3 changes N.

| tick | phase | what happens | rule/finding cited |
|---|---|---|---|
| T | 2 | `MOVE_OPCLICK` queues the route (interaction not cleared). `OPNPC1`: P not delayed; N exists and is **not yet** delayed; N visible; op valid; `clearPendingAction()`; `setInteraction(N, APNPC1)` (succeeds: `N.isValid()` is true now); `opcalled`. `moveClickRequest = false`. | `02#13`, `02#15`, `02#12`; `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:16-49`, `Engine-TS/src/engine/entity/PathingEntity.ts:534-537` |
| T | 4 | N's turn: undelay/resume (nothing), lifecycle, `isValid` gate passed, hunt, regen, timer, then `processQueue`: the due entry is unlinked and its `ai_queueN` script run with `self` = N. | `04#4`, `04#13`; `Engine-TS/src/engine/entity/Npc.ts:152-155`, `Engine-TS/src/engine/entity/Npc.ts:561-583` |
| T | 4 (case B) | The script calls `npc_delay(2)`: `delayed = true`, `delayedUntil = T+3`, `NPC_SUSPENDED` stored as N's `activeScript`. Later entries in this pass are neither decremented nor run. `processMovementInteraction` returns at once (no wander, no step); the facing calls and jump check still run. | `04#5`, `04#6`, `04#13`; `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101`, `Engine-TS/src/engine/entity/Npc.ts:585-588`, `Engine-TS/src/engine/entity/Npc.ts:186-191` |
| T | 4 (case A) | The script finishes; `processMovementInteraction` runs `wanderMode`: if `moverestrict` is not `NOMOVE`, with probability 1/8 a new random waypoint within `wanderrange` of spawn, then `updateMovement` (at most one step). | `04b#8`, `04b#16`; `Engine-TS/src/engine/entity/Npc.ts:720-739` |
| T | 5 (steps 6-7) | P's `setFaceEntity`: target is an NPC, `faceEntity = N.nid`, `FACE_ENTITY` mask (if it changed); `reorientEntity` aims P's angle at N's position **after** phase 4. | `06#1`, `06#2`, `04#15`; `Engine-TS/src/engine/World.ts:713-714`, `Engine-TS/src/engine/entity/PathingEntity.ts:514-532` |
| T | 5 (step 8.2, case B) | `canAccess()`; `validateTarget()`: `N.isValid()` is false (delayed), so `clearInteraction()`, `unsetMapFlag()` (waypoints cleared, `UNSET_MAP_FLAG` written now) and **return**: P does not move this tick. | `06#5`, `04#15`, `06§Inf` ("interacting with a delayed NPC is cancelled"); `Engine-TS/src/engine/entity/Player.ts:1256-1263`, `Engine-TS/src/engine/entity/Player.ts:1233-1245`, `Engine-TS/src/engine/entity/Npc.ts:382-387` |
| T | 5 (step 8, case A) | Target valid. Pre-move `tryInteract(false)`: an NPC is a `PathingEntity`, so the op runs at once if P is already in operable distance of N's new tile (not the case at 3 tiles). With no ap script (assumption), branch 3 or nothing runs, so P walks one step (re-path toward N only at the last waypoint, `NAIVE`), then the post-move attempt may run `[opnpc1]` in the arrival tick. | `06#6`, `06#10`, `06#17`, `06§Inf` table; `Engine-TS/src/engine/entity/Player.ts:1170`, `Engine-TS/src/engine/entity/Player.ts:1287-1290` |
| T | 9, 10 | `NPC_INFO`: N's movement (none in case B; a walk step in case A if it moved) and any masks the queue script set (e.g. `npc_anim`, `npc_say`). `PLAYER_INFO`: P's `FACE_ENTITY` toward N (set at step 6), plus walk bits in case A. In case B the `UNSET_MAP_FLAG` from phase 5 precedes both. | `09#12`, `09#16`, `09#17`, `10#13`; `Engine-TS/src/engine/entity/NetworkPlayer.ts:286-292` |
| T | 11 (case B) | `resetEntity(false)` ends with `setFaceEntity()`: P's target is now `null`, so `faceEntity = -1` with the mask. | `11#5`, `06#1`; `Engine-TS/src/engine/entity/PathingEntity.ts:630` |
| T+1 | 9, 10 (case B) | P's `PLAYER_INFO` carries `FACE_ENTITY` -1: P stops facing N one tick after the interaction was cleared. | `06§Inf` (one tick late), `09#18`, `11#5` |
| T+1 | 2 (case B, if P clicks N again) | `MOVE_OPCLICK` is accepted and queues the route; `OPNPC1` is refused because N is delayed (`UNSET_MAP_FLAG`, counts as a client event). `opcalled` stays false, so `moveClickRequest = true`. | `02#15`, `02#6`, `02#12`; `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:27-31` |
| T+1 | 5 (case B, same click) | No target, so no attempts; the movement gate needs `busy()`, which is false, so P **walks the route toward N with no interaction**. (Inference from the rows above.) | `06#12`, `06#24`; `Engine-TS/src/engine/entity/Player.ts:674-678` |
| T+3 | 4 (case B) | `currentTick >= delayedUntil`: N's `delayed` clears and its `NPC_SUSPENDED` queue script resumes; if it finishes without delaying again, the rest of N's turn (wander) runs the same tick. `OPNPC1` is accepted again from phase 2 of T+4: phase 2 of T+3 runs before this phase-4 undelay, so it still sees `npc.delayed` (`Engine-TS/src/engine/entity/Npc.ts:111-112`, `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:27-31`). | `04#6`, `04§Inf`; `Engine-TS/src/engine/entity/Npc.ts:110-118` |

**Arrival time.** The outcome depends on whether `OPNPC1` is decoded before or after the tick in which N becomes delayed. Decoded in T (bytes buffered before cycle T started): accepted, then cancelled in phase 5 of T as above. Decoded in T+1, T+2 or T+3 (bytes arrived after cycle T started and before cycle T+4 started): refused in phase 2 because N is still delayed (`02#15`; N's `delayed` clears only in its phase-4 turn of T+3, after phase 2, `04#6`), while its `MOVE_OPCLICK` is accepted. Decoded in T+4 or later: accepted. Within one tick phase 4 always precedes phase 5, so N's queue, mode and step always happen before P's interaction attempt in the same tick (`04#15`, `04§Inf`).

**What would differ otherwise:**
- P not accessible at step 8 (delayed, protected, main/chat modal): validation is skipped, so P **keeps** the target that tick and can still walk (`04§Inf`, `06#24`); it is cancelled on P's first accessible tick while N is still delayed.
- N in an `OP*`/`AP*` mode against P (e.g. `ai_opplayer2`): N's script runs in phase 4 on every valid turn while in range, with P as `active_player`, before P's turn (`04b#14`, `04b§Inf`). N's validation of P does not check P's `delayed` or modal (`04b#5`).
- The queue script changes N's type: P's `validateTarget()` fails through the recorded type (`06#5`). If it calls `npc_setmode`, N's mode (and, for a targeted mode, its target) changes before N's own step 9 in the same turn, so N runs the new mode this tick (`04b#2`; `Engine-TS/src/engine/script/handlers/NpcOps.ts:206-248`); P's validation does not look at N's mode.
- N steps in phase 4 (case A): P's distance checks in phase 5 use N's new tile; N chasing P uses P's tile from before P's phase-5 step (`04§Inf`, `04b§Inf`).
- N not in P's NPC-info list (e.g. just spawned, not yet added in phase 10): `OPNPC1` refused (`Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:33-37`).

---

## Scenario 4: packets while a script is delayed and queue entries wait

**Setup.** In tick T0, P's op script (run in phase 5 step 8, protected) calls `weakqueue(w, 4)`, `queue(q, 0)` and then `p_delay(1)`. Then the client sends a non-overlay `IF_BUTTON`, and a plain ground click (`MOVE_GAMECLICK`), at various times.

**Assumptions:** P is not `loggingOut` and the world is not shutting down; no other queue entry, timer or engine-queue entry exists; no main/chat modal is open; the resumed script finishes in T0+2 without delaying again, opening a main/chat modal or suspending again; `q` and `w` do not delay P or open a modal; `q` is `NORMAL`, not `STRONG`; no `CLOSE_MODAL` packet is decoded (it would set `requestModalClose`, and `processQueues` would then call `closeModal()` and clear `w`, `Engine-TS/src/engine/entity/Player.ts:882-885`).

| tick | phase | what happens | rule/finding cited |
|---|---|---|---|
| T0 | 5 (step 8) | Op script runs protected. `weakqueue`/`queue` append to `weakQueue`/`queue` with the delays unchanged. `p_delay(1)`: `delayed = true`, `delayedUntil = T0+2`, state `SUSPENDED`. | `05#9`, `05#4`; `Engine-TS/src/engine/script/handlers/PlayerOps.ts:124-133`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:149-158`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380` |
| T0 | 5 (step 8) | `executeScript` stores the script as `activeScript` and sets `protect = true` ("preserve protected access when delayed"). `tryInteract` returns `true`; no new target, so the interaction is cleared; waypoints were already cleared before the script ran. | `05#6`, `05#14`, `06#6`, `06#19`; `Engine-TS/src/engine/entity/Player.ts:2211-2219`, `Engine-TS/src/engine/entity/Player.ts:1170-1183` |
| T0 | 5 (step 10) | `updateEnergy` returns early: P is delayed. | `06#22`; `Engine-TS/src/engine/entity/Player.ts:701-704` |
| T0 | 11 | `protect = false`. `delayed`, both queues and `activeScript` are kept. | `05#7`, `11#3`, `11#10`; `Engine-TS/src/engine/entity/Player.ts:470-484` |
| T0+1 | 2 | Non-overlay `IF_BUTTON` (component valid and visible, not in `resumeButtons`, and an `[if_button]` script exists): handler has no `delayed` check and returns `true` (a user slot), but `runScript` refuses the protected script because `delayed` (returns -1; nothing runs, nothing queued). An overlay button's script would run. | `02#15`; `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:16-22`, `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-40`, `Engine-TS/src/engine/entity/Player.ts:2171-2176` |
| T0+1 | 2 | `MOVE_GAMECLICK`: `MoveClickHandler` sees `delayed`, writes `UNSET_MAP_FLAG`, returns `false` (counts as a client event): the click is **dropped, not deferred**. `clearPendingAction` is not reached, so the weak queue is **not** cleared. | `02#15`, `02#6`; `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12-15` |
| T0+1 | 5 (steps 1-3) | Undelay check fails (`T0+1 < T0+2`); no resume. `processQueues`: no `STRONG` entry, no `requestModalClose`. `q`: post-decrement 0 → -1, due but `canAccess()` false. `w`: 4 → 3. | `05#4`, `05#5`, `05#10`, `05#11`, `05#12`; `Engine-TS/src/engine/World.ts:692-701`, `Engine-TS/src/engine/entity/Player.ts:897-926` |
| T0+1 | 5 (steps 4-11) | Normal timers blocked (none here); soft timers would still run. Movement: no waypoints. Energy unchanged (delayed). | `05#17`, `06#22`, `06#24` |
| T0+2 | 2 | A `MOVE_GAMECLICK` decoded now is **still refused**: `delayed` is cleared only at step 1 of phase 5, which has not run yet this tick. | `02#15` (last bullet); ordering-matrix §D ("Player `delayed`") |
| T0+2 | 5 (step 1) | `currentTick >= delayedUntil`: `delayed = false`. | `05#4`; `Engine-TS/src/engine/World.ts:692` |
| T0+2 | 5 (step 2) | `SUSPENDED` script resumed with `executeScript(s, true, true)` (protected, forced). It finishes: `activeScript` cleared; no main modal, so `closeModal(false)`, which does **not** clear the weak queue (and sets `protect = false`). | `05#5`, `05#6`; `Engine-TS/src/engine/World.ts:694-697`, `Engine-TS/src/engine/entity/Player.ts:2220-2227`, `Engine-TS/src/engine/entity/Player.ts:760-770` |
| T0+2 | 5 (step 3) | `canAccess()` is now true. `q` (pre-decrement -1) runs, protected. `w`: 3 → 2. | `05#11`, `05#12`, `05§Inf` (overdue entries run on the first accessible visit); `Engine-TS/src/engine/entity/Player.ts:903-911` |
| T0+3 | 2 | `MOVE_GAMECLICK` decoded now is accepted: `clearPendingAction()` → `closeModal()` (default argument) **clears the weak queue**: `w` is gone and will never run. Waypoints queued; no op, so `moveClickRequest = true`. | `02#16`, `05#12`, ordering-matrix §D ("Weak queue"); `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32`, `Engine-TS/src/engine/entity/Player.ts:760-763`, `Engine-TS/src/engine/World.ts:624-628` |
| T0+3 | 5 | Movement gate: `moveClickRequest` but not `busy()`, so P walks. | `06#12`; `Engine-TS/src/engine/entity/Player.ts:676` |
| T0+5 | 5 (step 3) | Only if no accepted move/op packet (or other `closeModal()`) cleared it: `w` (pre-decrement 0) runs: added after T0's pass with delay 4, it runs in T0+1+4. | `05#12`, `05§Inf` (queue timing) |

**Arrival time.** The ground click is refused if decoded in T0+1 or T0+2, i.e. if its bytes were buffered after cycle T0 started and before cycle T0+3 started; it is accepted if decoded in T0+3 or later. (One decoded in phase 2 of T0 itself comes before the op script and is a different case: it would clear the target before phase 5 of T0.) If accepted in T0+3, T0+4 or T0+5 it clears `w` before `w`'s run (phase 2 precedes phase 5 in T0+5); if decoded in T0+6 or later, `w` has already run in T0+5. So a click sent a few milliseconds before or after the start of cycle T0+3 decides whether it is dropped, and a click around the start of cycle T0+6 decides whether `w` runs.

**What would differ otherwise:**
- `q` is a `STRONG` entry: from T0+1 on, `processQueues` sees it and calls `closeModal()` before the queue pass, even while delayed, so `w` is cleared in T0+1 (`05#10`, `05§Inf`).
- The resumed script delays again, stops in `PAUSEBUTTON`/`COUNTDIALOG` instead of finishing, or finishes with a main modal open: `q` and `w` stay blocked. (A chat-only modal opened by a script that then finishes is closed at once by `executeScript`'s `closeModal(false)`, which sets `modalState = NONE`, so the queues run that turn; `Engine-TS/src/engine/entity/Player.ts:2220-2227`, `Engine-TS/src/engine/entity/Player.ts:768-772`.) Blocked entries keep counting down and run on the first accessible visit, in FIFO order (`05#14`, `05§Inf`).
- The resumed script leaves a main modal open: `executeScript` does not call `closeModal(false)` (`05#6`), and P is busy, so the queues stay blocked.
- A normal timer that fell due in T0+1 fires in step 4 of T0+2, after the queues; a soft timer fires on time, even while delayed (`05#17`, `05#18`).
- An op packet instead of the ground click: refused the same way while delayed (`02#15`); once accepted it also clears the weak queue (`02#16`) and sets `moveClickRequest = false` (`02#12`).
- A `PAUSEBUTTON`/`COUNTDIALOG` dialogue instead of `p_delay`: resume packets run it with `force` even while delayed; the phase-5 resume does not (`02#15`, `05#5`).
- `loggingOut`: timers are frozen; queues and the resume still run (`05#19`).
- The suspended script called `p_delay` from a walk trigger: it is not stored and never resumes (`06#20`, `06§Inf`).

---

## Inferences (labelled)

- **Inference: the woodcutting loop, once it reaches `@cut_tree`, attempts a log every 4 ticks**: at A+3, A+7, A+11, ... where A is the tick of the first `[oploc1,_tree]` run. Rests on: the re-armed interaction runs at the earliest next tick and, under scenario 1's assumptions, exactly next tick (`06#19`, `06#6`, `06#17`); `map_clock` is `World.currentTick` (`Engine-TS/src/engine/script/handlers/ServerOps.ts:16-17`), which is the same in every phase of a tick and rises by one per tick (`11#12`); and the `%action_delay` arithmetic in `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:55-62`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:74-78` and `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:108-115`. It also needs assumptions not verified: the tree has op 3 (#8), no `[aploc*,_tree]` script (#9), `%action_delay < map_clock` at the first run (the varp's initial value and other writers were not read), and `get_logs` and the procs it calls do not suspend. Not observed; open question #10 stays open, narrowed.
- **Inference: every pass of the chop loop that re-arms writes `UNSET_MAP_FLAG` and clears the player's weak queue**, because `p_oploc` calls `stopAction()`; the depleting pass (`loc_change` then `return`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:137-139`) and passes that return early on a failed check do not call `p_oploc` (`click-loc §5`; `Engine-TS/src/engine/entity/Player.ts:964-973`, `05#12`). Client effect not read.
- **Inference: in scenario 3 case B the player sees itself turn toward the NPC for one tick and then turn back, without moving.** Rests on the T and T+1 rows (`06#1`, `06#5`, `11#5`, `06§Inf`). Client rendering not read.
- **Inference: in scenario 3, a repeated click while the NPC is delayed moves the player without an interaction**, because `MOVE_OPCLICK` does not clear or need the interaction and the paired `OPNPC1` is refused (`move §3`, `02#15`, `06#12`).
- **Inference: in scenario 4, the 600 ms window matters twice** (refusal vs acceptance of the click, and whether an accepted click clears the weak entry before it runs). Rests on the arrival-window inference above and the T0+2 to T0+5 rows.

## Not checked / open questions

- Node's event-loop ordering of socket callbacks against the `setTimeout` that starts the next cycle, and when the client flushes its `out` buffer; together these decide the exact arrival window. New open question #46.
- `rsmod` reachability (`reachedLoc`, `reachedEntity`, line of sight, `canTravel`) that decides "in operable/approach distance" and whether a step is blocked (#4).
- The tree loc config (op 3) and any `[aploc*,_tree]` script (#8, #9); `%action_delay`'s initial value; what `random($deplete_chance)` returns for 0 (normal trees) (`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:126-135`); the procs `~woodcutting_axe_checker`, `~woodcutting_successchance` and the macro events. The exact chop cadence still needs a run (#10).
- What the client does with `MOVE_OPCLICK` when the player already stands on the destination, and with `UNSET_MAP_FLAG`, `FACE_ENTITY`, `FACE_COORD` (#14, #31).
- Content NPC queue and op scripts for scenario 3 (which NPCs use `npc_queue` with `npc_delay`), and the effect of an `[opnpc1]` dialogue on P's modal state (#28).
- Content use of `weakqueue`/`queue` together with `p_delay` for scenario 4 was not searched; the scenario is engine-level. `docs/open-questions.md` #51.
- Nothing was run.

## Cross-check

Every row above was compared with the rule or finding it cites, and the code line was opened for each row that gives one (re-grepped at the commits above). Two note statements were corrected (minimal edits):

- [`06-players-interaction-movement.md`](06-players-interaction-movement.md) Inferences, timing table paragraph: said "A packet that arrives after phase 2 of tick T is decoded in T+1". True but incomplete: a packet that arrives after cycle T starts, even during phase 1, is also decoded in T+1, since the socket handler runs only between ticks (`02§Pos`, `07#13` inference). Now says so.
- [`../flows/move-opclick.md`](../flows/move-opclick.md) section 1 item 3 called the first point "the route's start tile", which reads as the player's tile. It is the turn point nearest the player (or the destination for a straight route); the player's own tile is not sent (`Client-TS/src/client/Client.ts:5801-5834`). Now says so.

No contradiction between notes was found for the rules used here.

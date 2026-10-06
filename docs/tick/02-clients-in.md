# Phase 2: `processClientsIn` (client input: afk roll, input tracking, packet decode)

**Question answered:** What does the second phase of a game tick do for each player, in what order, how many client packets are handled per player per tick, and what state do the packet handlers set and which later phase consumes it?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only the `afk_event` command signature was read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

Related notes: [`../flows/move-opclick.md`](../flows/move-opclick.md) (the `MOVE_*CLICK` decoder, handler and waypoint stepping) and [`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md) (`OPLOC1` decode and `OpLocHandler`). Their phase-2 line numbers were re-checked at the same Engine-TS commit and still match; this note re-cites what it relies on.

## Position in the tick

`processClientsIn()` is the second call in `World.cycle()`, after `processWorld()` (phase 1, [`01-world.md`](01-world.md)) and before `processNpcEventQueue()` (phase 3). Source: `Engine-TS/src/engine/World.ts:348-358`
```ts
this.processWorld();
// client input
// - calculate afk event readiness
// - process packets
// - process pathfinding/following request
// - client input tracking
this.processClientsIn();
// Spawn triggers, despawn triggers
this.processNpcEventQueue();
```

Client bytes are not read from the socket in this phase. The TCP `data` handler, which runs on the Node event loop between ticks, appends every chunk to `client.in` with `client.buffer(data)` in **every** state (`Engine-TS/src/server/tcp/TcpServer.ts:31`), and only then dispatches on state: `World.onClientData` for state 0, otherwise `OnDemand.onClientData` (`Engine-TS/src/server/tcp/TcpServer.ts:33-37`), which returns at once unless the state is 2 (`Engine-TS/src/engine/OnDemand.ts:60-63`). The WebSocket handler does the same: `client.buffer(message)` first, then `World.onClientData` for state 0 or `OnDemand.onClientData` for state 2 only (`Engine-TS/src/web.ts:110-116`). The logged-in state 1 is set at login (`Engine-TS/src/engine/World.ts:900`), so for an in-game client nothing consumes the buffered bytes between ticks; they wait in `client.in` (`Engine-TS/src/server/ClientSocket.ts:25-32`) for phase 2's `decodeIn`.

## L2: ordered sub-steps

1. Record a start time and reset `cycleStats[WorldStat.BANDWIDTH_IN]` to 0. Source: `Engine-TS/src/engine/World.ts:602-604`
2. For each player in `World.playerLoop` order (L3 rules 1-3), inside a `try`:
   1. `player.playtime++`. Source: `Engine-TS/src/engine/World.ts:608`
   2. **AFK event roll**, only when `currentTick % 500 === 0`: set `afkEventReady` to a random draw (L3 rule 17). Source: `Engine-TS/src/engine/World.ts:610-612`
   3. **Input tracking flush check**: `player.processInputTracking()` (L3 rule 18). Source: `Engine-TS/src/engine/World.ts:614-615`
   4. **Packet decode**, only if the client is connected: `player.decodeIn()` reads and handles packets until a per-category limit is hit or no complete packet is buffered (L3 rules 4-10). Source: `Engine-TS/src/engine/World.ts:617`
   5. **Move-click flag**: if a move packet queued a client path (`userPath.length > 0`) or an op packet was accepted (`opcalled`) during this decode: if the player is `delayed`, `unsetMapFlag()` and skip the rest of this player's iteration (`continue`); otherwise set `moveClickRequest` (L3 rules 12, 15-16). Source: `Engine-TS/src/engine/World.ts:618-629`
   6. **Public chat log**: if a public chat message was accepted (`logMessage !== null`), post it to the friend thread. Source: `Engine-TS/src/engine/World.ts:632-634`
   7. On any exception: `console.error`, and for a connected client write a `Logout` packet and close the socket. The player is not removed here. Source: `Engine-TS/src/engine/World.ts:635-641`
3. Store elapsed ms in `cycleStats[WorldStat.CLIENT_IN]`. Source: `Engine-TS/src/engine/World.ts:644`

There is no separate "pathfinding/following request" step in the body (comment check below). Pathfinding that happens in this phase happens inside packet handlers during step 2.4 (L3 rule 14).

## L3: ordering rules

### Player order

1. `World.playerLoop` is a `HashTable<Player>` with 8 buckets. Source: `Engine-TS/src/engine/World.ts:146`
   ```ts
   readonly playerLoop: HashTable<Player> = new HashTable(8);
   ```
   `HashTable.all()` visits bucket 0 to 7, and within a bucket walks from the sentinel's `next` to the tail, saving `next` before each yield. Source: `Engine-TS/src/datastruct/HashTable.ts:49-60`
   ```ts
   *all(): IterableIterator<T> {
   for (let bucket = 0; bucket < this.bucketCount; bucket++) {
   const sentinel = this.buckets[bucket];
   let node = sentinel.next as T | null;
   ```
   `add(key, value)` picks bucket `key & (bucketCount - 1)` (i.e. `key & 7`) and inserts before the sentinel, which is the tail of that bucket. Source: `Engine-TS/src/datastruct/HashTable.ts:33-46`
   ```ts
   const sentinel: T = this.buckets[Number(key & BigInt(this.bucketCount - 1))];
   value.prev = sentinel.prev;
   value.next = sentinel;
   ```

2. The key is derived from the client's remote address at login (phase 7, `processLogins`): for an address containing `.` it is the four octets packed into a 32-bit number; for one containing `:` it is the IPv6 hextets packed into a bigint; a player without a connected client gets the key for 127.0.0.1 (`2130706433n`). Source: `Engine-TS/src/engine/World.ts:910-934`. So the bucket of an IPv4 player is its last octet `& 7`, and within a bucket players are in login order. A connected client whose address contains neither `.` nor `:` (the default `remoteAddress` is `'unknown'`, `Engine-TS/src/server/ClientSocket.ts:10`, and the TCP server passes `s.remoteAddress ?? 'unknown'`, `Engine-TS/src/server/tcp/TcpServer.ts:22`) matches neither branch, so no `add` happens, yet the login continues and puts the player in `players[slot]` (`Engine-TS/src/engine/World.ts:936`). **The order is not by player slot (pid) or username.** These three `add` calls are the only writes to `playerLoop` found by grep in `Engine-TS/src`; removal is `player.unlink()` in `World.removePlayer` (`Engine-TS/src/engine/World.ts:1615`), which is called from `processLogouts` (`Engine-TS/src/engine/World.ts:790`), `processShutdown` (`Engine-TS/src/engine/World.ts:1223`) and the `cycle()` crash handler (`Engine-TS/src/engine/World.ts:518`).
   `Player` reaches `Linkable` through `PathingEntity` -> `Entity` -> `DoublyLinkable` -> `Linkable` (`Engine-TS/src/engine/entity/Player.ts:100`, `Engine-TS/src/engine/entity/PathingEntity.ts:30`, `Engine-TS/src/engine/entity/Entity.ts:5`, `Engine-TS/src/datastruct/DoublyLinkable.ts:3`). Zone player lists use the separate `next2`/`prev2` links (`Engine-TS/src/engine/zone/Zone.ts:46`, `Engine-TS/src/engine/zone/Zone.ts:90`), so they do not disturb `playerLoop`.

3. `processPlayers` (phase 5) iterates the same structure with the same call. Source: `Engine-TS/src/engine/World.ts:606`, `Engine-TS/src/engine/World.ts:690`
   ```ts
   for (const player of this.playerLoop.all()) {
   ```
   Phases 3 and 4 do not call any of the `playerLoop` writers listed in rule 2 (they run `processNpcEventQueue` and `npc.turn()`, `Engine-TS/src/engine/World.ts:648-676`; what NPC scripts do was not enumerated), and phase 2's own `catch` only writes `Logout` and closes the socket (`Engine-TS/src/engine/World.ts:637-640`). So phase 2 and phase 5 visit the same players in the same order, unless a script run in phases 2 to 4 removes a player by some path not found by grep (see Inferences).

### Packet decode and per-tick limits

4. `decodeIn` first clears `userPath` and `opcalled`, returns `false` if the client is not connected, then stamps `lastConnected = currentTick` and resets the three per-category counters. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:55-66`
   ```ts
   decodeIn() {
   this.userPath = [];
   this.opcalled = false;
   ```

5. It calls `read()` in a loop while all three counters are below their limits and `read()` returns `true`. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:68-71`
   ```ts
   while (this.userLimit < ClientGameProtCategory.USER_EVENT.limit && this.clientLimit < ClientGameProtCategory.CLIENT_EVENT.limit && this.restrictedLimit < ClientGameProtCategory.RESTRICTED_EVENT.limit && this.read()) {
   ```
   The limits are `CLIENT_EVENT` 20, `USER_EVENT` 5, `RESTRICTED_EVENT` 2. Source: `Engine-TS/src/network/game/client/ClientGameProtCategory.ts:5-8`
   ```ts
   static readonly CLIENT_EVENT = new ClientGameProtCategory(0, 20);
   static readonly USER_EVENT = new ClientGameProtCategory(1, 5);
   // flood restricted events
   static readonly RESTRICTED_EVENT = new ClientGameProtCategory(2, 2);
   ```
   The counters are checked **before** each `read()`, so the tick's decoding stops right after the packet that brings any counter to its limit.

6. Which counter a packet increments, after its handler ran. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:132-148`
   ```ts
   if (success && message.category === ClientGameProtCategory.USER_EVENT) {
   this.userLimit++;
   } else if (message.category === ClientGameProtCategory.RESTRICTED_EVENT) {
   this.restrictedLimit++;
   } else {
   this.clientLimit++;
   ```
   - A `USER_EVENT` packet whose handler returned `true` counts toward the 5 user slots. One whose handler returned `false` (rejected, e.g. while delayed) counts toward the 20 client slots instead.
   - All game-action packets (`MoveClick`, `Op*`, `IfButton`, `InvButton*`, `OpHeld*`, chat, `CloseModal`, resume dialogs, friend/ignore, `ClientCheat`, etc.) are `USER_EVENT`; `IdleTimer` and the four `Event*` input-tracking packets are `CLIENT_EVENT` (grep of `category =` in `Engine-TS/src/network/game/client/model/`, e.g. `Engine-TS/src/network/game/client/model/MoveClick.ts:5`, `Engine-TS/src/network/game/client/model/IdleTimer.ts:5`).
   - **No message model uses `RESTRICTED_EVENT`** (grep finds it only in `ClientGameProtCategory.ts` and `NetworkPlayer.ts`), so `restrictedLimit` never increases and that limit is never reached.
   - The counter update is inside `if (decoder)`. An opcode that is in `ClientGameProt.byId` but has **no bound decoder** is read and its payload discarded without incrementing any counter (rule 8).

7. `read()` mechanics (one call handles at most one packet). Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:84-153`
   - Returns `false` if no byte is buffered (`Engine-TS/src/engine/entity/NetworkPlayer.ts:85-87`).
   - If no opcode is pending, reads one byte, subtracts the ISAAC decryptor's next value if there is one, and looks it up in `ClientGameProt.byId`. An unknown opcode **closes the connection** and returns `false` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:89-107`).
   - Size: fixed from the table, or a 1-byte size (`-1`), or a 2-byte size (`-2`, closes the connection if over 1600) (`Engine-TS/src/engine/entity/NetworkPlayer.ts:109-123`). No opcode in the current table has length `-2` (`Engine-TS/src/network/game/client/ClientGameProt.ts:4-96`).
   - If the payload is not fully buffered, returns `false` **keeping** `client.opcode` and `client.waiting`, so the next tick resumes the same packet (`Engine-TS/src/engine/entity/NetworkPlayer.ts:125-127`).
   - Otherwise copies the payload into the shared static `inBuf`, decodes, calls the handler **immediately**, counts it (rule 6), resets `client.opcode = -1` and returns `true` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:129-152`).
   - `client.read` copies from the front of `client.in` and shifts the rest down; `client.available` is `in.pos`, the number of buffered bytes. Source: `Engine-TS/src/server/ClientSocket.ts:34-57`

8. Binding: `ClientGameProtRepository` maps opcode id to one decoder and one optional handler; binding the same id twice throws at startup. Source: `Engine-TS/src/network/game/client/ClientGameProtRepository.ts:87-105`. Bound opcodes are listed at `Engine-TS/src/network/game/client/ClientGameProtRepository.ts:108-171`. Opcodes defined in `ClientGameProt` but **not bound** there: `NO_TIMEOUT` (120), `ANTICHEAT_OPLOGIC1-9`, `ANTICHEAT_CYCLELOGIC1-7` and `MAP_BUILD_COMPLETE` (214) (`Engine-TS/src/network/game/client/ClientGameProt.ts:4-28`, `Engine-TS/src/network/game/client/ClientGameProt.ts:82`). These are consumed and ignored and do not count toward any limit (rule 6). If a decoder exists but no handler, `success` is `false` (`?.handle(...) ?? false`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:138`); every decoder in the repository is bound with a handler.

9. **What happens to the excess.** Packets not reached because a limit was hit stay as bytes in `client.in` (nothing is discarded) and are read first on the next tick's phase 2, in arrival order. The comment on the categories says the same (`Engine-TS/src/network/game/client/ClientGameProtCategory.ts:10`). The only bound on the backlog is the buffer size: `client.in` is 65535 bytes (`Engine-TS/src/server/ClientSocket.ts:19`), and `buffer()` closes the connection if new data would overflow it (`Engine-TS/src/server/ClientSocket.ts:25-29`); the TCP data handler also terminates the socket if `remaining <= 0` (`Engine-TS/src/server/tcp/TcpServer.ts:26-29`). There is no limit on bytes decoded per tick other than the packet counts.

10. After the loop, `decodeIn` computes the bytes consumed this tick; if more than 0 it stamps `lastResponse = currentTick` and adds them to `BANDWIDTH_IN`. It always returns `true` once past the connection check. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:72-79`
    ```ts
    const bytesRead = bytesStart - this.client.in.pos;
    if (bytesRead > 0) {
    this.lastResponse = World.currentTick;
    ```
    `lastConnected` and `lastResponse` are read in phase 6: 100 ticks without a response forces logout, 50 ticks without a connection requests an idle logout. Source: `Engine-TS/src/engine/World.ts:744-751`, constants `Engine-TS/src/engine/World.ts:131-132`.

### State set by handlers, and its consumers

11. Handlers run synchronously inside `read()` (rule 7), in packet arrival order, so each handler sees the effects of the previous packet's handler in the same tick. Server packets written by a handler (e.g. `UnsetMapFlag`) go through `Player.write` -> `NetworkPlayer.writeInner`, which encodes and calls `client.send` straight away (`Engine-TS/src/engine/entity/Player.ts:2239-2245`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:191-227`); for TCP that is `socket.write` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:15-17`). They are not held for phase 10.

12. The move-click flag block. Source: `Engine-TS/src/engine/World.ts:617-629`
    ```ts
    if (isClientConnected(player) && player.decodeIn()) {
    if (player.userPath.length > 0 || player.opcalled) {
    if (player.delayed) {
    player.unsetMapFlag();
    continue;
    }
    ```
    - `userPath` is set only by `MoveClickHandler` and only in the `clientRoutefinder` branch (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:42-48`). With `clientRoutefinder` false the handler queues `findPath(...)` and leaves `userPath` empty (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:51-53`), so a plain move packet does not enter this block in that configuration.
    - `opcalled` is set by the `Op{Loc,Npc,Obj,Player}{1-5,T,U}` handlers after `setInteraction` (grep; e.g. `Engine-TS/src/network/game/client/handler/OpLocHandler.ts:45-47`). It is set even if `setInteraction` returned `false` for an invalid target (`Engine-TS/src/engine/entity/PathingEntity.ts:534-537`).
    - `unsetMapFlag()` clears waypoints and writes `UnsetMapFlag`. Source: `Engine-TS/src/engine/entity/Player.ts:2247-2250`
    - Otherwise `moveClickRequest = !(not busy && opcalled)`: `false` for an accepted op while not busy, `true` for a move-only tick or any tick where the player is busy. If neither `userPath` nor `opcalled` is set, `moveClickRequest` keeps its previous value. `busy()` is `delayed || containsModalInterface()`, and `containsModalInterface()` is true when the `MAIN` or `CHAT` modal bit is set. Source: `Engine-TS/src/engine/entity/Player.ts:816-823`
    - Since `MoveClickHandler` and every op handler reject when `player.delayed` (rule 15), the `delayed` branch here is only reachable if `delayed` became true later in the same decode, after a move/op packet was accepted (e.g. a script run by a later packet's handler; `P_DELAY` sets `delayed = true`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-379`). In that case the `continue` also skips the chat-log step for that player.

13. **What each phase-2 write is, and who consumes it** (handlers read: `MoveClick`, `OpLoc`, `OpNpc`, `OpPlayer`, `IfButton`, `InvButton`, `OpHeld`, `ResumePauseButton`, `ResumePCountDialog`, `CloseModal`, `IdleTimer`, `TutClickSide`, `MessagePublic`, the four `Event*`; the rest only by grep, see "Not checked"):

    | Field / effect | Set by (phase 2) | Consumed by |
    |---|---|---|
    | `waypoints` / `waypointIndex` | `MoveClickHandler` -> `queueWaypoints` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:48`, `Engine-TS/src/engine/entity/PathingEntity.ts:268-275`); cleared by `unsetMapFlag` (`Engine-TS/src/engine/entity/PathingEntity.ts:277-279`) | Phase 5: `processInteraction` -> `updateMovement` -> `processMovement` (`Engine-TS/src/engine/entity/Player.ts:1287`, `Engine-TS/src/engine/entity/Player.ts:689`) |
    | `tempRun` | `MoveClickHandler` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:35-39`) | Phase 5: `updateMovement` (`Engine-TS/src/engine/entity/Player.ts:684-691`) |
    | `target`, `targetOp`, `targetSubject`, `apRange`, `apRangeCalled`, `targetX/Z` | Op handlers -> `setInteraction` (`Engine-TS/src/engine/entity/PathingEntity.ts:539-558`); cleared by `clearPendingAction` -> `clearInteraction` (`Engine-TS/src/engine/entity/PathingEntity.ts:563-569`) | Phase 5: `setFaceEntity`/`reorientEntity` and `processInteraction` (`Engine-TS/src/engine/World.ts:713-717`, `Engine-TS/src/engine/entity/Player.ts:1247-1298`) |
    | `userPath`, `opcalled` | `MoveClickHandler`, op handlers | This phase only (rule 12); cleared at the next `decodeIn` |
    | `moveClickRequest` | This phase (rule 12); also set `false` by `OpHeldHandler` (`Engine-TS/src/network/game/client/handler/OpHeldHandler.ts:58`) and by `OpHeldUHandler` on its two "item does not exist" rejections (`Engine-TS/src/network/game/client/handler/OpHeldUHandler.ts:56`, `Engine-TS/src/network/game/client/handler/OpHeldUHandler.ts:73`); reset to `false` at login (phase 7, `Engine-TS/src/engine/World.ts:941`) | Phase 5: `updateMovement` (`Engine-TS/src/engine/entity/Player.ts:676`) |
    | `requestModalClose` | `CloseModalHandler` (`Engine-TS/src/network/game/client/handler/CloseModalHandler.ts:13`) | Phase 5: `processQueues` closes the modal (`Engine-TS/src/engine/entity/Player.ts:882-885`) |
    | `requestIdleLogout` | `IdleTimerHandler`, unless `node.debug` (`Engine-TS/src/network/game/client/handler/IdleTimerHandler.ts:8-11`) | Phase 6: `processLogouts` (`Engine-TS/src/engine/World.ts:753-761`) |
    | `logMessage`, `chatMessage`, `chatColour/Effect/Rights`, `CHAT` mask, `socialProtect` | `MessagePublicHandler` (`Engine-TS/src/network/game/client/handler/MessagePublicHandler.ts:29-42`) | `logMessage`: this phase (step 2.6). All cleared in phase 11 by `resetEntity` (`Engine-TS/src/engine/World.ts:1149`, `Engine-TS/src/engine/entity/Player.ts:477-482`). The chat mask is for phase 9/10 (not traced). |
    | `lastConnected`, `lastResponse` | `decodeIn` (rules 4, 10) | Phase 6 (rule 10) |
    | modal closed, weak queue cleared, `protect` reset, `IF_CLOSE` scripts run | `clearPendingAction` -> `closeModal()` from move (non-op) and op handlers (`Engine-TS/src/engine/entity/Player.ts:970-973`, `Engine-TS/src/engine/entity/Player.ts:760-814`) | Immediate |
    | Scripts executed now | `IfButtonHandler`, `InvButtonHandler`, `OpHeldHandler`, `TutClickSideHandler`, resume handlers, `MoveClickHandler` -> `processWalktrigger`, `closeModal` -> `IF_CLOSE` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-38`, `Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:12`, `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:50`, `Engine-TS/src/engine/entity/Player.ts:1108-1117`) | Immediate (except a protected script refused by `runScript`, rule 15). When the script stops in a non-final state, `Player.executeScript` routes it by state: `WORLD_SUSPENDED` -> `World.enqueueScript` (phase 1 of a later tick), `NPC_SUSPENDED` -> the active NPC's `activeScript`, anything else (`SUSPENDED`, `PAUSEBUTTON`, `COUNTDIALOG`) -> the active player's `activeScript` with `protect` preserved (`Engine-TS/src/engine/entity/Player.ts:2211-2219`). Phase 5 resumes a player's `SUSPENDED` script when not delayed (`Engine-TS/src/engine/World.ts:694-697`); `PAUSEBUTTON`/`COUNTDIALOG` wait for a resume packet. `processWalktrigger` uses `runScript` and ignores the result (`Engine-TS/src/engine/entity/Player.ts:1113-1114`). |
    | input-tracking buffer | `Event*` handlers -> `player.input.*` (e.g. `Engine-TS/src/network/game/client/handler/EventMouseClickHandler.ts:7`) | Rule 18 |

    So op and move packets only *arm* state in phase 2; walking and running the op/ap script for them happens in phase 5. Button, inventory-button, held-item, tutorial and resume packets run their scripts **during phase 2**, before NPCs (phase 4) and before any player's phase-5 processing.

14. "Pathfinding/following" in this phase: with the default `clientRoutefinder` the engine does no pathfinding here, it queues the client's route (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:42-50`); with `clientRoutefinder` false, `findPath` runs inside the handler during decode (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:51-53`). Paths to an entity target and following (op 3 on a player, `APPLAYER3`/`OPPLAYER3`) are computed in phase 5 by `pathToPathingTarget` (`Engine-TS/src/engine/entity/Player.ts:1054-1084`, called at `Engine-TS/src/engine/entity/Player.ts:1275`). `OpPlayerHandler` only sets the interaction (`Engine-TS/src/network/game/client/handler/OpPlayerHandler.ts:36-39`).

### Requests while busy or delayed

15. **While `delayed`**, requests are **dropped, not deferred**: the packet is consumed, its handler returns `false` (so it counts as a client event, rule 6) and nothing is queued for retry.
    - `MoveClickHandler` writes `UnsetMapFlag` and returns `false` without touching waypoints (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12-15`).
    - `OpLoc`/`OpNpc`/`OpPlayer` handlers write `UnsetMapFlag` and return `false` (`Engine-TS/src/network/game/client/handler/OpLocHandler.ts:14-18`, `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:16-20`, `Engine-TS/src/network/game/client/handler/OpPlayerHandler.ts:15-19`); grep shows the same `if (player.delayed)` check at the top of every `Op*` handler. `OpNpcHandler` also rejects a delayed **NPC** (`Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:27-30`).
    - `InvButtonHandler` and `OpHeldHandler` return `false` silently (`Engine-TS/src/network/game/client/handler/InvButtonHandler.ts:14-17`, `Engine-TS/src/network/game/client/handler/OpHeldHandler.ts:16-19`).
    - `IfButtonHandler` has **no** delayed check and two paths (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-38`). (a) If the component is in `resumeButtons` and `activeScript` is in `PAUSEBUTTON` state, it calls `executeScript(activeScript, true, true)` with `force = true` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-29`), so the paused dialogue script **resumes even while `delayed`** (same as the resume handlers below). If the component is a resume button but no `PAUSEBUTTON` script is waiting, nothing runs. (b) Otherwise it runs the `IF_BUTTON` script with `executeScript(..., root.overlay == false)` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:31-34`): for a non-overlay interface `protect = true`, and `runScript` refuses protected, non-forced scripts while `delayed` or already `protect` (returns -1, nothing runs, nothing queued); an overlay script runs regardless of `delayed`. The handler returns `true` in all these cases, so the packet counts as an accepted user event. Source: `Engine-TS/src/engine/entity/Player.ts:2171-2176`
      ```ts
      runScript(script: ScriptState, protect: boolean = false, force: boolean = false) {
      if (!force && protect && (this.protect || this.delayed)) {
      // can't get protected access, bye-bye
      ```
    - The resume handlers call `executeScript(activeScript, true, true)` (`force = true`), so a waiting `PAUSEBUTTON`/`COUNTDIALOG` script resumes even while `delayed`. Source: `Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:8-12`, `Engine-TS/src/network/game/client/handler/ResumePCountDialogHandler.ts:10-15`
    - `InvButtonDHandler` (drag an item between slots) has its own delayed branch after its validation: it writes `UpdateInvPartial` for the two slots to revert the client's drag and returns `false` (`Engine-TS/src/network/game/client/handler/InvButtonDHandler.ts:40-44`). `OpHeldTHandler` and `OpHeldUHandler` return `false` at the top when delayed (`Engine-TS/src/network/game/client/handler/OpHeldTHandler.ts:16-17`, `Engine-TS/src/network/game/client/handler/OpHeldUHandler.ts:16-17`; bodies not read in full).
    - `TutClickSideHandler` has no delayed check but runs its script with `protect = true` (`Engine-TS/src/network/game/client/handler/TutClickSideHandler.ts:18`), so `runScript` refuses it while delayed; the handler still returns `true`.
    - Social and appearance handlers do not look at `delayed`: `MessagePublic`, `MessagePrivate`, `FriendListAdd/Del` and `IgnoreListAdd/Del` are gated by `socialProtect` (one accepted per tick, reset in phase 11 by `resetEntity`), e.g. `Engine-TS/src/network/game/client/handler/MessagePrivateHandler.ts:13`, `Engine-TS/src/network/game/client/handler/FriendListAddHandler.ts:9`, `Engine-TS/src/engine/entity/Player.ts:482`; `ReportAbuse` by `reportAbuseProtect` (`Engine-TS/src/network/game/client/handler/ReportAbuseHandler.ts:10`, reset at `Engine-TS/src/engine/entity/Player.ts:483`); `ChatSetMode` has no gate (`Engine-TS/src/network/game/client/handler/ChatSetModeHandler.ts:8-12`); `IdkSaveDesign` is gated by `allowDesign` (`Engine-TS/src/network/game/client/handler/IdkSaveDesignHandler.ts:10`). These are accepted while delayed. `ClientCheatHandler` (688 lines) was not read in full; grep finds no `delayed` check in it.
    - `delayed` is cleared only at the start of the player's phase-5 turn when `currentTick >= delayedUntil` (`Engine-TS/src/engine/World.ts:692`), so in phase 2 it still holds the value from the end of the previous phase 5 (or as changed by phase 1 or earlier packets this phase).

16. **While busy only because a modal is open** (not delayed), move and op packets are **accepted** and close the modal: non-op `MoveClick` and all op handlers call `clearPendingAction()` -> `closeModal()` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32`, `Engine-TS/src/engine/entity/Player.ts:970-973`). `closeModal` sets `modalState = ModalState.NONE` synchronously (`Engine-TS/src/engine/entity/Player.ts:768-772`), so by the rule-12 check `containsModalInterface()` is false again unless an `IF_CLOSE` script run from `closeModal` reopened one (not checked). `MOVE_OPCLICK` does not call `clearPendingAction` itself; its paired op packet does (see [`../flows/move-opclick.md`](../flows/move-opclick.md) section 3). `OpHeldHandler` closes only if the item's interface is not the open main modal (`Engine-TS/src/network/game/client/handler/OpHeldHandler.ts:54-56`). `CloseModal` is deferred on purpose to phase 5 (rule 13).

### AFK event readiness

17. Every 500 ticks (`AFK_EVENTRATE`), on the same tick for all players (it tests the global `currentTick`), `afkEventReady` is **overwritten** with `Math.random() < p`, where `p` is `1/12` if `zonesAfk()` and `1/24` otherwise. Source: `Engine-TS/src/engine/World.ts:127-129`, `Engine-TS/src/engine/World.ts:610-612`
    ```ts
    if (this.currentTick % World.AFK_EVENTRATE === 0) {
    player.afkEventReady = Math.random() < (player.zonesAfk() ? World.AFK_CHANCE2 : World.AFK_CHANCE1);
    ```
    Because it is assigned rather than OR-ed, a `true` flag that no script consumed is reset at the next roll (it can also come up `true` again). `zonesAfk()` is `lastAfkZone === 1000` (`Engine-TS/src/engine/entity/Player.ts:2143-2145`); `lastAfkZone` is incremented (capped at 1000) and reset when the player leaves its afk zones in `updateAfkZones` (`Engine-TS/src/engine/entity/Player.ts:2128-2141`), called in phase 10 (`Engine-TS/src/engine/World.ts:1120`). `currentTick` is incremented at the end of `cycle()` (`Engine-TS/src/engine/World.ts:503`).
    The flag is consumed by the `afk_event` script command, which pushes 1 only if `node.debug` is on or `staffModLevel < 2`, and then clears it. Source: `Engine-TS/src/engine/script/handlers/PlayerOps.ts:1114-1117`. The content signature is `[command,afk_event]()(int)` (`Content/scripts/engine.rs2:474-475`). A cheat also sets it to `true` (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:185`).
    The roll runs **before** `decodeIn`, so any script that runs from this tick's packets (rule 13) already sees the new value.

### Input tracking

18. `processInputTracking()` calls `input.onCycle()`, which flushes only when the buffer holds `>= 1500` bytes; `flush()` does nothing unless tracking is `active`, and posts the bytes to the logger thread via `World.submitInputTracking`. Source: `Engine-TS/src/engine/entity/Player.ts:1316-1318`, `Engine-TS/src/engine/entity/tracking/InputTracking.ts:30-46`, `Engine-TS/src/engine/World.ts:2356-2363`. The buffer is filled by the `Event*` handlers during `decodeIn`, which each also flush if the next record would not fit (`Engine-TS/src/engine/entity/tracking/InputTracking.ts:48-100`). Tracking is off by default (`active = false`, `Engine-TS/src/engine/entity/tracking/InputTracking.ts:23`) and turned on by a friend-server `RELAY_TRACK` message or a macroing/bug-abuse report (`Engine-TS/src/engine/World.ts:2052-2057`, `Engine-TS/src/engine/World.ts:2339-2344`); it is also flushed in `Player.cleanup()` (`Engine-TS/src/engine/entity/Player.ts:467`). Since the flush check runs **before** this tick's decode, events decoded in tick T reach the size check at tick T+1 at the earliest.

### Other per-player effects

19. `playtime` is incremented once per tick for every player in `playerLoop`, connected or not; it is saved as part of the player save (`Engine-TS/src/engine/entity/Player.ts:205`). Steps 2.1 to 2.3 and 2.6 have no `isClientConnected` gate; only 2.4/2.5 do.

20. An exception in a handler aborts the rest of that player's phase 2 (later packets stay buffered, step 2.6 is skipped), and for a connected player sends `Logout` and closes the socket; the player stays in `playerLoop` and the next phases still process it this tick. Script errors normally do not reach this `catch`: `ScriptRunner.execute` catches them itself (see [`01-world.md`](01-world.md) rule 6). Source: `Engine-TS/src/engine/World.ts:635-641`

## Comment-versus-code check

- `cycle()` comment and header comment (`Engine-TS/src/engine/World.ts:350-354`, `Engine-TS/src/engine/World.ts:597-600`): "calculate afk event readiness - process packets - process pathfinding/following request - client input tracking".
  - "calculate afk event readiness": **matches**, but only every 500 ticks (`Engine-TS/src/engine/World.ts:610`).
  - "process packets": **matches** (`decodeIn`).
  - "process pathfinding/following request": **no such step** in the body. The only code after decoding sets the `moveClickRequest` flag; it does no pathfinding. Pathfinding is inside `MoveClickHandler` (server-routefinder config only) and following is in phase 5 (rule 14).
  - "client input tracking": **order mismatch**. It is listed last, but `processInputTracking()` runs before `decodeIn` (`Engine-TS/src/engine/World.ts:614-617`). The inline comment "- client input tracking" at `Engine-TS/src/engine/World.ts:614` matches the call under it.
  - Not mentioned by either comment: `playtime++`, the `moveClickRequest`/`unsetMapFlag` block, and posting public chat to the friend thread.
- `AFK_EVENTRATE` "5m: 60/5 = 12 chances per hour" (`Engine-TS/src/engine/World.ts:127`): **matches** given the 600 ms tick (500 x 0.6 s = 300 s). `AFK_CHANCE1` "1/24 - 4% chance every 5 mins: avg 1 event every 2 hrs" and `AFK_CHANCE2` "1/12 - 8% ... avg 1 event every 1 hr while 'aggro zone' hasn't changed" (`Engine-TS/src/engine/World.ts:128-129`): the values match (1/24 = 4.2%, 12 x 1/24 = 0.5/hr; 1/12 = 8.3%, 1/hr). The averages assume every true roll is consumed; because the flag is overwritten (rule 17) an unconsumed true is lost. "aggro zone hasn't changed" corresponds to `lastAfkZone === 1000`.
- `TIMEOUT_NO_CONNECTION` "30s with no connection (16 ticks in osrs)" and `TIMEOUT_NO_RESPONSE` "60s without any response" (`Engine-TS/src/engine/World.ts:131-132`): 50 and 100 ticks, **match** at 600 ms. The OSRS figure cannot be checked from code.
- `ClientGameProtCategory` "packet decoding limit per tick, exceeding this ends decoding and picks up where it left off on the next tick" (`Engine-TS/src/network/game/client/ClientGameProtCategory.ts:10`): **matches** (rules 5, 9). "flood restricted events" (`Engine-TS/src/network/game/client/ClientGameProtCategory.ts:7`): the category exists but nothing uses it (rule 6). The two "todo" comments (`Engine-TS/src/network/game/client/ClientGameProtCategory.ts:2-4`) say the numbers and categorisation are not settled.
- `NetworkPlayer` "user packet limit" / "client packet limit" (`Engine-TS/src/engine/entity/NetworkPlayer.ts:40-41`): match; note that a rejected user packet counts against the client limit (rule 6).
- `ClientSocket.in` "node won't let us read from the socket as a stream so we buffer it ourselves" (`Engine-TS/src/server/ClientSocket.ts:19`): consistent with `buffer()`/`read()`.
- `HashTable.all` "need to store the next node early in case it's removed while iterating" (`Engine-TS/src/datastruct/HashTable.ts:55`): **matches** (`Engine-TS/src/datastruct/HashTable.ts:56-58`).
- `MoveClickHandler` "Clear previous interaction — but not for op-click moves ..." (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:26-29`): the code matches (no clear when `opClick`). The claim that the op packet is "always paired" is about the client and was not re-checked here beyond [`../flows/move-opclick.md`](../flows/move-opclick.md).
- `CloseModalHandler` "For whatever reason the modal is not closed directly here ..." (`Engine-TS/src/network/game/client/handler/CloseModalHandler.ts:7-12`): **matches**; it only sets `requestModalClose`, consumed in phase 5 `processQueues`. The OSRS test descriptions ("If you have pid, the trade works") cannot be checked from code; in this engine "pid order" within a tick is `playerLoop` order (rule 2).
- `processWalktrigger` "we process walktriggers from regular movement in client input, and for each interaction" (`Engine-TS/src/engine/entity/Player.ts:1104-1107`): **partly matches**. From client input it is called only in the `clientRoutefinder` branch of `MoveClickHandler` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:50`); with server-side pathfinding it is not called in phase 2.
- `OpHeldHandler` "uses the dueling ring op to move whilst busy & queue pending" (`Engine-TS/src/network/game/client/handler/OpHeldHandler.ts:58`): the code sets `moveClickRequest = false`, which disables the `updateMovement` block for this tick if no later move/op packet this tick re-sets it in rule 12. The cited video was not checked.
- `OpLocHandler`/`OpNpcHandler`/`OpPlayerHandler` "normal: cannot interact while delayed", "bad client or lag: ..." (e.g. `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:17`): describe the checks that follow; match.

## Inferences (labelled)

- **Inference: within a tick, players are processed in an order set by the low 3 bits of their IP address, then by login order**, not by slot. Players from one IP (e.g. all local test clients) share a bucket and are processed in login order. Rests on rules 1-3. Not observed. An IPv4-mapped IPv6 address `::ffff:a.b.c.d` contains `.` and takes the IPv4 branch; its first piece is `::ffff:a`, `parseInt` of which is `NaN`, and `NaN << 24` is 0, so the key loses the first octet but the bucket is still the last octet `& 7` (checked with a one-line `node -e` evaluation of the same expression for `::ffff:127.0.0.9`, which gave key 9). Which `remoteAddress` format Node actually gives the engine was not checked.
- **Inference: a connected player whose `remoteAddress` has neither `.` nor `:` would be logged in but never visited by any `playerLoop` phase** (no input decode, no phase-5 turn, no phase-10 output). Rests on rule 2. Whether Node ever reports such an address for a live socket was not checked (`docs/open-questions.md` #23).
- **Inference: phase 2 and phase 5 use the same player order**, so a player earlier in `playerLoop` has both its input handled and its turn processed before a later player. Rests on rule 3 and the grep of `playerLoop` writers. A script run in phases 2 to 4 that removes a player through another path was not searched for.
- **Inference: a client sending many actions per tick has at most 5 accepted user actions applied per tick; the rest are applied on later ticks in order.** Rejected actions do not use up user slots, but 20 rejected or client-event packets end the tick's decoding. Rests on rules 5-6 and 9.
- **Inference: unbound opcodes (`NO_TIMEOUT`, anticheat, `MAP_BUILD_COMPLETE`) still keep the connection alive**, since `lastResponse` depends only on bytes consumed (rule 10) and these are consumed (rule 8). How often the client sends them was not checked.
- **Inference: a possible header-split mis-read in `read()`.** If the opcode byte of a variable-length packet is buffered but its size byte is not yet, `client.read(inBuf.data, 0, 1)` returns `false` without copying (`Engine-TS/src/server/ClientSocket.ts:45-47`), yet `read()` then takes `inBuf.g1()` as the size (`Engine-TS/src/engine/entity/NetworkPlayer.ts:109-113`), which is the stale byte left in `inBuf[0]` from the opcode read: the raw byte as received, before the ISAAC subtraction (`Engine-TS/src/engine/entity/NetworkPlayer.ts:91-94`), not the decrypted opcode. `client.waiting` would then be wrong and later bytes would be mis-framed. Whether TCP/WebSocket chunking ever splits a packet there was not observed. See `docs/open-questions.md` #21.
- **Inference: an accepted move followed in the same tick by a packet whose script delays the player** (e.g. an `IF_BUTTON` script calling `p_delay`) loses the move: the waypoints are cleared at step 2.5 and the public-chat log for that tick is skipped, while an interaction set by an earlier op packet is not cleared. Rests on rules 12, 13 and 15. Not observed.
- **Inference: scripts triggered by interface buttons, inventory buttons, held-item ops and dialogue resumes run in phase 2, so they act before NPC processing (phase 4) and before every player's phase-5 turn in that tick**, whereas loc/npc/obj/player ops wait for phase 5. Rests on rule 13 and the phase order.

## Not checked / open questions

- Handlers read only by grep, not in full: `OpLocT/U`, `OpNpcT/U`, `OpObj*`, `OpPlayerT/U`, `OpHeldT/U` (partly), and `ClientCheatHandler` (688 lines; whether any cheat is usable while delayed, and which scripts it runs, is `docs/open-questions.md` #24). `InvButtonD`, `MessagePrivate`, `ChatSetMode`, `FriendList*`, `IgnoreList*`, `ReportAbuse` and `IdkSaveDesign` were read for rule 15; what the friend server does with their messages was not. Statements about "all op handlers" rest on grep for `player.delayed`, `setInteraction`, `opcalled` and `clearPendingAction` (`docs/open-questions.md` #47; the friend-server side is #22).
- What scripts run from phase-2 handlers do (RuneScript VM). Boundary; also `docs/open-questions.md` #15.
- `IF_CLOSE` scripts run by `closeModal` during phase 2 and whether one can reopen a modal before the `moveClickRequest` check. Narrowed into `docs/open-questions.md` #4.
- The friend thread (`logPublicChat`) and the logger thread (`submitInputTracking`) are worker boundaries; what they do with the messages was not read. `docs/open-questions.md` #22.
- The `read()` size-byte case above (`docs/open-questions.md` #21) and the `remoteAddress` format that sets `playerLoop` order (`docs/open-questions.md` #23) were not observed.
- WebSocket client path: `Engine-TS/src/web.ts:103-116` buffers the same way as TCP (read), but its `send` was not read (already `docs/open-questions.md` #13).
- The ISAAC decryption of opcodes (`docs/open-questions.md` #7) and the `MoveClick`/`OpLoc` decoders beyond what is cited in the flow notes.
- Phase 5's use of `delayed`, `moveClickRequest` and waypoints is cited here only at its entry points; answered in [`05-players-queues-timers.md`](05-players-queues-timers.md) (undelay at the start of the turn, rule 4) and [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (the `moveClickRequest` movement gate, rule 12; waypoints and stepping, rules 10-15).

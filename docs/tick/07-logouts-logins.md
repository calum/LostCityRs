# Phases 6 and 7: `processLogouts` and `processLogins`

**Question answered:** In phases 6 and 7 of a game tick, when is a player taken out of the per-tick player loop (what requests a logout, what blocks it, what timeouts force it, what runs on removal, and on which tick the player is gone), and when is a new player put in (how login requests are queued and applied, what the first-tick setup sends, and in which phases of which tick the new player is first processed)?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only `scripts/login_logout/login.rs2` and `scripts/login_logout/logout.rs2` were read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". The login thread, the login server, the friend thread, the logger thread and the player save format (`Player.save()`, `PlayerLoading.load()` past its first lines) are boundaries and were not read.

Related notes: [`02-clients-in.md`](02-clients-in.md) (how `playerLoop` is keyed and ordered at login, rules 1-3; `lastConnected`/`lastResponse` stamps and the two timeout constants, rules 4 and 10; `requestIdleLogout` from the `IDLE_TIMER` packet, rule 13), [`05-players-queues-timers.md`](05-players-queues-timers.md) (`canAccess`, rule 8; `closeModal`, rule 10; the `LONG` queue acceleration while `loggingOut`, rule 11; timers frozen while `loggingOut` and who sets `loggingOut`, rule 19; the per-player `catch`, rule 3). Facts reused from these notes were re-checked at the same Engine-TS commit and are re-cited here.

## Position in the tick

`processLogouts()` is the sixth call in `World.cycle()`, right after `processPlayers()` (phase 5); `processLogins()` is the seventh, right before `processZones()` (phase 8). Source: `Engine-TS/src/engine/World.ts:378-390`
```ts
            this.processPlayers();

            // player logout
            this.processLogouts();

            // player login, good spot for it (before packets so they immediately load but after processing so nothing hits them)
            this.processLogins();

            // process zones
            // - build list of active zones around players
            // - loc/obj despawn/respawn
            // - compute shared buffer
            this.processZones();
```

Neither function has a `try`/`catch` (`Engine-TS/src/engine/World.ts:739-807`, `Engine-TS/src/engine/World.ts:809-959`), so an engine exception thrown in either reaches `cycle()`'s `catch`, which removes every player in `playerLoop` and exits the process (`Engine-TS/src/engine/World.ts:509-526`). Script errors do not: `ScriptRunner.execute` catches them itself (`Engine-TS/src/engine/script/ScriptRunner.ts:126`, `Engine-TS/src/engine/script/ScriptRunner.ts:170`, `Engine-TS/src/engine/script/ScriptRunner.ts:228-231`).

## L2: ordered sub-steps

### Phase 6, `processLogouts` (`Engine-TS/src/engine/World.ts:739-807`)

1. Record a start time.
2. For each player in `playerLoop.all()` order (the same order as phases 2 and 5, [`02-clients-in.md`](02-clients-in.md) rules 1-3):
   1. **Timeouts**: if the world is at or past its shutdown tick, or no bytes were read from the client for `TIMEOUT_NO_RESPONSE` (100) ticks, set `loggingOut = true` and `force = true`; otherwise, if the client has not been connected for `TIMEOUT_NO_CONNECTION` (50) ticks, set `requestIdleLogout = true` (L3 rules 3-4).
   2. **Requests**: if `requestLogout` or `requestIdleLogout`: set `loggingOut = true` if `currentTick >= preventLogoutUntil`; otherwise, for an explicit `requestLogout` with a pending `preventLogoutMessage`, send that message once. Then clear both request flags (L3 rules 1-2, 5).
   3. **Removal attempt**, only if `loggingOut` and (`force` or `currentTick >= preventLogoutUntil`): `closeModal()`; decide whether the normal queue is "discardable"; if `canAccess()`, the engine queue is empty and the queue is discardable, run the `[logout,_]` script and `removePlayer` (L3 rules 6-9).
3. For each pending save in `logoutRequests` whose last attempt is more than 15 s old, post `player_logout` with the save to the login thread (L3 rule 10).
4. Store elapsed ms in `cycleStats[WorldStat.LOGOUT]`.

### Phase 7, `processLogins` (`Engine-TS/src/engine/World.ts:809-959`)

1. Record a start time.
2. For each player in `newPlayers` (filled between ticks, L3 rules 12-13), in `Set` insertion order:
   1. If a save for the same username is still in `logoutRequests`: send response byte 5 and close (connected client only), skip.
   2. If the login is a reconnect and a player with the same username is in `playerLoop`: hand the new socket to that existing player, call `onReconnect()`, and skip the rest (L3 rule 18).
   3. If a player with the same username is in `playerLoop`: send 5 and close (`NetworkPlayer` only), skip.
   4. If a shutdown is due within 50 ticks or already past (`shutdownSoon`): `forceLogout(player, 14)` (connected client only), skip.
   5. Take the lowest free slot 1-2046; if none: `forceLogout(player, 7)` (connected client only), skip.
   6. For a connected client: set `client.state = 1`, send the login response `[2, min(staffModLevel, 2), 1]`, and add the player to `playerLoop` keyed by its address (an address with neither `.` nor `:` is not added, [`02-clients-in.md`](02-clients-in.md) rule 2); without a connected client add it with the 127.0.0.1 key.
   7. Put the player in `players[slot]`, `rsbuf.addPlayer(slot)`, set `slot`, `uid`, `tele = true`, `moveClickRequest = false`; enter the zone; `onLogin()` (L3 rule 15); send the reboot timer if a shutdown is scheduled; post `player_login` to the friend thread.
3. `newPlayers.clear()`: every entry is dropped, accepted or not.
4. Store elapsed ms in `cycleStats[WorldStat.LOGIN]`.

## L3: ordering rules

### What requests a logout

1. **Three flags, three different meanings.** Fields: `Engine-TS/src/engine/entity/Player.ts:331-338`
   ```ts
    requestLogout: boolean = false;
    requestIdleLogout: boolean = false;
    loggingOut: boolean = false;
    preventLogoutMessage: string | null = null;
    preventLogoutUntil: number = -1;

    lastResponse: number = -1;
    lastConnected: number = -1;
   ```
   - `requestLogout` is set only by the `p_logout` command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:636-638`; grep of `Engine-TS/src` finds no other writer of `true`). In Content, `[if_button,logout:try_logout]` closes the interface and calls `p_logout` only inside `if (p_finduid(uid) = true)`, and there only if the player is not in a duel or on a gnomeball pitch (`Content/scripts/login_logout/logout.rs2:8-22`). `p_finduid` pushes 0 when the player is not `canAccess()` (protected, delayed, or a main/chat modal open), unless the script already holds protected access to that same player (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:82-91`). So a logout click while the player is not accessible does nothing and shows no message. An `IF_BUTTON` script runs during phase 2 ([`02-clients-in.md`](02-clients-in.md) rule 13), so the flag is normally set in phase 2 of the tick in which the button packet is decoded.
   - `requestIdleLogout` is set by the `IDLE_TIMER` packet handler unless `node.debug` (`Engine-TS/src/network/game/client/handler/IdleTimerHandler.ts:7-11`) and by the 50-tick no-connection timeout (rule 3).
   - `loggingOut` is the state "trying to leave". It is set by phase 6 itself (`Engine-TS/src/engine/World.ts:746`, `Engine-TS/src/engine/World.ts:755`), by the production script-error path (`Engine-TS/src/engine/script/ScriptRunner.ts:203-206`), by the friend-server kick (`Engine-TS/src/engine/World.ts:2032-2037`), by `notifyPlayerBan` (`Engine-TS/src/engine/World.ts:2307-2310`) and by the `::kick` cheat (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:672-674`). The kick, ban and cheat paths also call `logout()` and `client.close()` at once for a connected client (`Engine-TS/src/engine/World.ts:2039-2042`, `Engine-TS/src/engine/World.ts:2311-2314`, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:675-677`), and the production script-error path calls `logout()` (`Engine-TS/src/engine/script/ScriptRunner.ts:204`). So the client can receive `Logout`, and lose its socket, many ticks before phase 6 removes the player (for example while `preventLogoutUntil` is pending or removal is blocked, rules 6-7). Grep finds no assignment of `false`, so once set it stays set for the life of that `Player` object ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 19).

2. **`p_preventlogout` is an absolute deadline.** Source: `Engine-TS/src/engine/script/handlers/PlayerOps.ts:640-644`
   ```ts
    [ScriptOpcode.P_PREVENTLOGOUT]: state => {
        // a short antilog can overwrite a long one in osrs, so no checks here
        state.activePlayer.preventLogoutMessage = check(state.popString(), StringNotNull);
        state.activePlayer.preventLogoutUntil = World.currentTick + check(state.popInt(), NumberNotNull);
    },
   ```
   A call in tick T with duration n blocks the logout checks below until tick T+n (they test `currentTick >= preventLogoutUntil`). A later call replaces both fields, even with a shorter duration. Content's combat procs use 16 ticks (`Content/scripts/login_logout/logout.rs2:24-28`); where they are called was not read.

### Timeouts (step 2.1)

3. **Timeout checks run first, for every player, every tick.** Source: `Engine-TS/src/engine/World.ts:742-751`
   ```ts
        for (const player of this.playerLoop.all()) {
            let force = false;
            if (this.shutdown || this.currentTick - player.lastResponse >= World.TIMEOUT_NO_RESPONSE) {
                // world shutdown or x-logged / timed out for 60s: force logout
                player.loggingOut = true;
                force = true;
            } else if (this.currentTick - player.lastConnected >= World.TIMEOUT_NO_CONNECTION) {
                // connection lost for 30s: request idle logout
                player.requestIdleLogout = true;
            }
   ```
   - `TIMEOUT_NO_CONNECTION` is 50 and `TIMEOUT_NO_RESPONSE` is 100 (`Engine-TS/src/engine/World.ts:131-132`). `shutdown` is `shutdownTick != -1 && currentTick >= shutdownTick` (`Engine-TS/src/engine/World.ts:197-199`).
   - `lastConnected` is stamped at the start of every phase-2 `decodeIn` while the client is connected; `lastResponse` only when that decode consumed at least one byte (`Engine-TS/src/engine/entity/NetworkPlayer.ts:59-63`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:72-77`). Phase 2 calls `decodeIn` only when `isClientConnected(player)` (`Engine-TS/src/engine/World.ts:617`), which is false for a non-network player or a `NullClientSocket` client (`Engine-TS/src/engine/entity/NetworkPlayer.ts:398-400`). Both stamps are also set to the current tick when the player is loaded (`Engine-TS/src/engine/entity/PlayerLoading.ts:36-37`).
   - `force` only matters for the `preventLogoutUntil` test in rule 6. It does **not** skip the removal conditions of rule 7.

4. **How a dropped connection reaches these timeouts.** When a TCP or WebSocket socket emits `close`, its handler sets `client.state = -1` and, if the socket has a `player`, replaces that player's `client` with a `NullClientSocket` (`Engine-TS/src/server/tcp/TcpServer.ts:43-51`, `Engine-TS/src/web.ts:122-130`). `client.player` is assigned only in the `NetworkPlayer` constructor (`Engine-TS/src/engine/entity/NetworkPlayer.ts:47-53`; grep of `Engine-TS/src` for `.player = ` finds no other site). After the swap, `isClientConnected` is false, phase 2 stops calling `decodeIn`, and neither stamp moves. So, with stamps last set in tick L:
   - from tick L+50, phase 6 sets `requestIdleLogout` every tick (rule 5 then applies `preventLogoutUntil`);
   - from tick L+100 (if `lastResponse` is also L), phase 6 sets `loggingOut` and `force` every tick.

   A client whose socket stays open but sends nothing keeps `lastConnected` current (stamped every tick); by the engine code alone it would reach only the 100-tick no-response branch. But each TCP socket is given `s.setTimeout(30000)` (`Engine-TS/src/server/tcp/TcpServer.ts:19`), and both the `error` and the `timeout` handlers call `s.destroy()` (`Engine-TS/src/server/tcp/TcpServer.ts:53-67`). **Inference, not verified:** under Node's socket semantics a TCP client silent for 30 s (50 ticks) is destroyed, its `close` handler swaps in the `NullClientSocket`, and the no-connection path then starts; so a silent TCP client may get the 50-tick idle request about 50 ticks after the socket timeout, before the 100-tick branch. No such timeout was found in the WebSocket `close` handler read (`Engine-TS/src/web.ts:122-130`); the rest of `web.ts` was not read for this. The `processPlayers` `catch` (and the other `Logout`+`close()` sites) only call `TcpClientSocket.close()`, which sets `state = -1` and calls `socket.end()` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:19-22`); the swap to `NullClientSocket` waits for Node's `close` event, whose timing was not checked (`docs/open-questions.md` #29).

### Requests and the anti-logout window (step 2.2)

5. **A request is consumed in the same pass, whether or not it succeeds.** Source: `Engine-TS/src/engine/World.ts:753-762`
   ```ts
            if (player.requestLogout || player.requestIdleLogout) {
                if (this.currentTick >= player.preventLogoutUntil) {
                    player.loggingOut = true;
                } else if (player.requestLogout && player.preventLogoutMessage !== null) {
                    player.messageGame(player.preventLogoutMessage); // engine message type in osrs
                    player.preventLogoutMessage = null;
                }
                player.requestLogout = false;
                player.requestIdleLogout = false;
            }
   ```
   - If not blocked by `preventLogoutUntil`, the request becomes `loggingOut = true` in this pass.
   - If blocked, the request is **dropped, not deferred**: both flags are cleared. Only an explicit `requestLogout` shows the message, and only once per `p_preventlogout` call (the message is nulled after sending; `messageGame` writes a `MessageGame` packet at once, `Engine-TS/src/engine/entity/Player.ts:2289-2291`, `Engine-TS/src/engine/entity/Player.ts:2239-2245`). A blocked `IDLE_TIMER` request shows nothing.
   - An explicit request blocked here must be made again (another button click). The no-connection timeout, by contrast, re-sets `requestIdleLogout` on every tick while the connection stays lost (rule 4), so it is retried each tick until the window ends.

### Removal (step 2.3)

6. **Removal is attempted every tick while `loggingOut`, once the anti-logout window is over or the logout is forced.** Source: `Engine-TS/src/engine/World.ts:764-778`
   ```ts
            if (player.loggingOut && (force || this.currentTick >= player.preventLogoutUntil)) {
                player.closeModal();

                let queueDiscardable = true;
                for (const request of player.queue.all()) {
                    if (request.type === PlayerQueueType.LONG) {
                        const logoutAction = request.args[0];
                        if (logoutAction === 1) {
                            // ^discard
                            continue;
                        }
                    }
                    queueDiscardable = false;
                    break;
                }
   ```
   - `force` is a local set in step 2.1 of the same pass, so it holds only on ticks where the shutdown or 100-tick condition holds. A `loggingOut` set by a kick, a ban, a script error or an accepted request is not forced and waits for `preventLogoutUntil`; the kick, ban and production script-error paths have already sent `Logout` (rule 1), so during that wait the player is still in the world without a working client.
   - `closeModal()` runs on **every** such tick, before the checks, even if removal then fails. With the default argument it clears the weak queue, sets `protect = false` if not delayed, and, if a modal is open, closes it and runs its `IF_CLOSE` scripts ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 10; `Engine-TS/src/engine/entity/Player.ts:760-772`).
   - **"Discardable" queue:** the normal `queue` (which holds `NORMAL`, `STRONG` and `LONG` entries, [`05-players-queues-timers.md`](05-players-queues-timers.md) rule 9) must contain only `LONG` entries whose `logoutAction` (`args[0]`) is 1. Any other entry, due or not, blocks removal. The weak queue is not checked (it was just cleared), and timers are not checked.

7. **The removal conditions.** Source: `Engine-TS/src/engine/World.ts:779-791`
   ```ts
                if (player.canAccess() && player.engineQueue.head() === null && queueDiscardable) {
                    const script = ScriptProvider.getByTriggerSpecific(ServerTriggerType.LOGOUT, -1, -1);
                    if (!script) {
                        printError('LOGOUT TRIGGER IS BROKEN!');
                        continue;
                    }

                    const state = ScriptRunner.init(script, player);
                    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
                    ScriptRunner.execute(state);

                    this.removePlayer(player);
                }
   ```
   All three must hold:
   - `canAccess()`: outside shutdown, not `protect`, not `delayed`, no `MAIN`/`CHAT` modal; always true once `World.shutdown` (`Engine-TS/src/engine/entity/Player.ts:821-832`). Since `closeModal()` just reset `modalState` and (if not delayed) `protect`, in practice this is "not `delayed`", unless an `IF_CLOSE` script run by that `closeModal()` set `delayed`, `protect` or reopened a main/chat modal (not checked; see `docs/open-questions.md` #4).
   - the engine queue is empty (it is filled by zone/mapzone triggers in phase 10 and by stat changes, [`05-players-queues-timers.md`](05-players-queues-timers.md) rule 20; it drains in phase 5 when the player is accessible);
   - the queue is discardable (rule 6).

   If any fails, nothing else happens this tick and the player stays in `playerLoop` with `loggingOut` still true; the attempt repeats next tick.

8. **What runs on removal, in order.**
   1. The `LOGOUT` trigger script, looked up with `getByTriggerSpecific(LOGOUT, -1, -1)`. Content defines `[logout,_]` (`Content/scripts/login_logout/logout.rs2:1-6`); that it is registered under this key was not verified (same question as `docs/open-questions.md` #25 for `[ai_spawn,_]`). The script is created with the player as `self`, given the protected-player pointer, and run by `ScriptRunner.execute` **directly**: not through `Player.executeScript`/`runScript`, so `player.protect` is not set and the returned state is ignored. A logout script that suspends (e.g. `p_delay`) is therefore abandoned when the player is removed straight after. If no `LOGOUT` script exists, the code logs an error and `continue`s: the player is never removed by this path.
   2. `removePlayer(player)`. Source: `Engine-TS/src/engine/World.ts:1602-1629`
      ```ts
    removePlayer(player: Player): void {
        if (player.slot === -1) {
            return;
        }

        if (isClientConnected(player)) {
            player.logout();
            player.client.close();
        }

        rsbuf.removePlayer(player.slot);
        this.gameMap.getZone(player.x, player.z, player.level).leave(player);
        delete this.players[player.slot];
        player.unlink();
        changeNpcCollision(player.width, player.x, player.z, player.level, false);
        changePlayerOccCollision(player.width, player.x, player.z, player.level, false);
        player.cleanup();

        player.isActive = false;

        player.addSessionLog(LoggerEventType.MODERATOR, 'Logged out');
        this.flushPlayer(player);

        this.friendThread.postMessage({
            type: 'player_logout',
            username: player.username
        });
      ```
      - For a connected client, the `Logout` packet is written and sent at once (`NetworkPlayer.logout` -> `writeInner` -> `client.send`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:191-232`), then the socket is ended. It is not held for phase 10.
      - The player leaves the rsbuf player list, its zone, the `players` slot array and `playerLoop` (`unlink`), and its NPC and player collision flags are cleared.
      - `cleanup()` sets `slot` and `uid` to -1, drops `activeScript` and resume buttons, clears inventory listeners, all three queues, camera packets, timers and hero points, clears the build area, resets appearance, sets `isActive = false` and flushes input tracking (`Engine-TS/src/engine/entity/Player.ts:449-468`). So any `LONG` entries with `logoutAction` 1 ("discard") are dropped here, and so are frozen timers.
      - `flushPlayer` stores `player.save()` in `logoutRequests` under the username with `lastAttempt: -1` (`Engine-TS/src/engine/World.ts:2365-2372`). What `save()` serialises was not read.
      - The friend thread is told `player_logout` (boundary, not read).

9. **Removal during the iteration is safe for the loop.** `HashTable.all()` saves `node.next` before yielding a player (`Engine-TS/src/datastruct/HashTable.ts:49-60`), so unlinking the current player does not stop the loop. Players later in `playerLoop` are still processed in this pass.

### The save hand-off (step 3)

10. **Saves are posted in the same phase, then retried every 15 s until confirmed.** Source: `Engine-TS/src/engine/World.ts:795-804`
    ```ts
        for (const [username, request] of this.logoutRequests) {
            if (request.lastAttempt < Date.now() - 15000) {
                request.lastAttempt = Date.now();
                this.loginThread.postMessage({
                    type: 'player_logout',
                    username,
                    save: request.save
                });
            }
        }
    ```
    - This loop runs after the per-player loop, so a player removed in step 2.3 has its save posted in the same phase 6 (`lastAttempt` starts at -1).
    - The entry is deleted only when the login thread answers with a logout response whose `success` is true (`Engine-TS/src/engine/World.ts:1961-1969`), or when a friend-server `RELAY_CLEARLOGOUTS` clears the whole map (`Engine-TS/src/engine/World.ts:2063-2064`). The interval is wall-clock (`Date.now()`), not ticks.
    - While the entry exists, a login with that username is refused with response 5 at three points: when the login packet arrives (`Engine-TS/src/engine/World.ts:2233-2238`), when the login thread's reply arrives (`Engine-TS/src/engine/World.ts:1923-1928`), and in phase 7 (rule 14).
    - What the login thread and server do with the save is a boundary (`docs/open-questions.md` #34).

11. **Which tick a logging-out player is gone.** Combining rules 3-8 with the phase order:
    - A logout button pressed so that its `IF_BUTTON` packet is decoded in phase 2 of tick T sets `requestLogout` in T (rule 1), provided `p_finduid` succeeds (the player is accessible, or the script already holds protected access to it) and the player is not in a duel or on a gnomeball pitch. Phase 5 of T still gives the player a full turn: queues, timers (not yet `loggingOut`), interaction and movement. Phase 6 of T sets `loggingOut` if `currentTick >= preventLogoutUntil`, and, if the rule-7 conditions hold, runs the logout script and removes the player **in phase 6 of tick T**. The player is then absent from phases 7-11 of T: no phase-9 info computation and no phase-10 output for it, and the `Logout` packet has already been sent (rule 8).
    - If the conditions fail, the player stays in `playerLoop` with `loggingOut` set. On every later tick it is still processed in phase 2 (packets are decoded and handled; nothing in phase 2 checks `loggingOut`, grep), in phase 5 without timers and with `LONG` entries whose `logoutAction` is 0 accelerated to delay 0 ([`05-players-queues-timers.md`](05-players-queues-timers.md) rules 11, 19), and in phases 9-11. Phase 6 retries removal each tick (rules 6-7).
    - While `loggingOut`, `Player.isValid()` returns false (`Engine-TS/src/engine/entity/Player.ts:2293-2296`) and the `busy` command reports 1 (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:950-952`). Which callers use `isValid` on players (targeting, hunting) was not enumerated here.

### How login requests are queued (between ticks)

12. **Login packet to login thread.** `World.onClientData` handles a socket only in state 0 (`Engine-TS/src/engine/World.ts:2086-2090`). For login opcodes 16 and 18, after the revision, CRC, RSA, length, rate-limit, capacity and pending-logout checks, it stores the socket in `loginRequests` and posts `player_login` to the login thread, with `reconnecting` true for opcode 18. Source: `Engine-TS/src/engine/World.ts:2242-2253`
    ```ts
            this.loginRequests.set(client.uuid, client);
            this.loginThread.postMessage({
                type: 'player_login',
                socket: client.uuid,
                remoteAddress: client.remoteAddress,
                username: safeName,
                password,
                uid,
                lowMemory,
                reconnecting: client.opcode === 18,
                hasSave: client.opcode === 18 ? typeof this.getPlayerByUsername(username) !== 'undefined' : false
            });
    ```
    `onClientData` is called from the socket `data` handler ([`02-clients-in.md`](02-clients-in.md), Position in the tick), not from `cycle()`.

13. **Login thread reply to `newPlayers`.** The login thread's `message` event calls `onLoginMessage` inside a `try`/`catch` that only logs (`Engine-TS/src/engine/World.ts:180-186`). For a login response it removes the socket from `loginRequests` (ignoring replies for unknown sockets), turns the reply codes -1, 1, 3, 5, 6, 7, 8, 9 and 10 into a response byte and a close (`Engine-TS/src/engine/World.ts:1838-1894`); any other reply continues (`Engine-TS/src/engine/World.ts:1896-1945`):
    - a rejection with 11 guarded by `!save && !reconnecting`. `save` is `msg.save ?? new Uint8Array()` (`Engine-TS/src/engine/World.ts:1897`; the response type declares `save: Uint8Array | null`, `Engine-TS/src/server/login/index.d.ts:10`), and any `Uint8Array`, even an empty one, is truthy in JavaScript, so **inference:** this branch can never be taken. A missing save becomes an empty one, and `PlayerLoading.load` turns a save shorter than 2 bytes into a fresh player with default stats (`Engine-TS/src/engine/entity/PlayerLoading.ts:39-51`);
    - builds the player with `PlayerLoading.load(username, save, client)`, which creates a `NetworkPlayer` for a socket and stamps `lastConnected` and `lastResponse` with the current tick (`Engine-TS/src/engine/entity/PlayerLoading.ts:29-37`);
    - copies session, `reconnecting`, staff level, low-memory flag, mute, members flag and message count;
    - rejects with 5 if a save for the username is still pending in `logoutRequests`;
    - on a free-to-play world, rejects a members player standing in a members area (17, and `player_force_logout`), or teleports a non-member to 3221,3219;
    - then `this.newPlayers.add(player)` and `client.state = 1`.

    A load exception sends 13, closes, and posts `player_force_logout` (`Engine-TS/src/engine/World.ts:1946-1960`). `newPlayers` is a `Set<Player>` commented "players joining at the end of this tick" (`Engine-TS/src/engine/World.ts:143`).

    **Inference: login replies and socket events are handled between ticks, never in the middle of a phase.** Facts: `cycle()` and all phase functions are synchronous (`cycle(): void`, `private processLogins(): void`, `Engine-TS/src/engine/World.ts:340`, `Engine-TS/src/engine/World.ts:809`), and the next cycle is scheduled with `setTimeout` (`Engine-TS/src/engine/World.ts:508`). JavaScript runs `message`, `data` and `close` handlers only when the call stack is empty. This is language semantics, not engine code. So a player added to `newPlayers` after tick T-1 ended (when `currentTick` became T, `Engine-TS/src/engine/World.ts:503`) is applied in phase 7 of tick T, and its load stamps are T.

    Between the reply and phase 7, `client.state` is already 1, so bytes that arrive are buffered and not consumed by anyone ([`02-clients-in.md`](02-clients-in.md), Position in the tick). The client has not yet received the login response at this point; it is sent in phase 7 (rule 15).

### Applying logins (phase 7)

14. **Checks, in order.** Source: `Engine-TS/src/engine/World.ts:811-891`
    - **Pending save** (`logoutRequests.has(username)`): send 5 and close (connected client only), skip. Comment: "prevent logging in if a player save is being flushed".
    - **Reconnect** (rule 18).
    - **Already in `playerLoop`** with the same username: for a `NetworkPlayer`, send 5 and close; skip.
    - **`shutdownSoon`** (`shutdownTick != -1 && currentTick >= shutdownTick - 50`, `Engine-TS/src/engine/World.ts:202-204`): `forceLogout(player, 14)` for a connected client; skip.
    - **Slot**: `getNextPlayerSlot()` returns the lowest `i` in 1..2046 with `players[i]` undefined, else -1 (`Engine-TS/src/engine/World.ts:1661-1669`). On -1, `forceLogout(player, 7)`; skip.

    `forceLogout` posts `player_force_logout` to the login thread (no save) and, for a connected client, sends the response byte if given and closes (`Engine-TS/src/engine/World.ts:1632-1645`). The two earlier rejections (pending save, already logged in) only send 5 and close; they do not post `player_force_logout`. What the login server does in each case is a boundary.

    The "already in `playerLoop`" check runs against players added earlier in the same pass too, because they were added to `playerLoop` in step 2.6. **Inference:** if two `newPlayers` entries carry the same username in one tick, the first is logged in and the second is refused with 5. Rests on the loop order of `Engine-TS/src/engine/World.ts:811-934`. Not observed.

15. **What the login does, in order.** Source: `Engine-TS/src/engine/World.ts:893-955`
    1. Connected client: session log; `client.state = 1`; send the login response bytes `[2, min(staffModLevel, 2), 1]`; add to `playerLoop` under the address key ([`02-clients-in.md`](02-clients-in.md) rule 2). Without a connected client: add under `2130706433n` (127.0.0.1).
    2. `players[slot] = player`, `rsbuf.addPlayer(slot)`, `slot`, `uid = ((username37 & 0x1fffff) << 11) | slot`, `tele = true`, `moveClickRequest = false`.
    3. `gameMap.getZone(x, z, level).enter(player)` (Zone internals not read).
    4. `player.onLogin()`. Source: `Engine-TS/src/engine/entity/Player.ts:502-532`
       ```ts
        this.buildArea.rebuildNormal();
        this.write(new ChatFilterSettings(this.publicChat, this.privateChat, this.tradeDuel));

        // todo: exact order
        if (Environment.friend.enabled) {
            this.write(new FriendlistLoaded(1));
        } else {
            this.write(new FriendlistLoaded(2));
            this.write(new UpdateIgnoreList([]));
        }

        this.write(new IfClose());
        this.write(new UpdatePid(this.slot, this.members));
        this.write(new ResetClientVarCache());
        for (let varp = 0; varp < this.vars.length; varp++) {
            const type = VarPlayerType.get(varp);
            const value = this.vars[varp];
            if (type.transmit) {
                this.writeVarp(varp, value);
            }
        }
        this.write(new ResetAnims());

        const loginTrigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.LOGIN, -1, -1);
        if (loginTrigger) {
            this.executeScript(ScriptRunner.init(loginTrigger, this), true);
        }

        this.lastStepX = this.x - 1;
        this.lastStepZ = this.z;
        this.isActive = true;
       ```
       - **Map send is immediate, in phase 7.** `rebuildNormal()` writes `RebuildNormal` when the player is outside the reload window around `originX/originZ` (`Engine-TS/src/engine/entity/BuildArea.ts:57-92`). `originX`/`originZ` start at -1 (`Engine-TS/src/engine/entity/Player.ts:322-323`), `PlayerLoading` does not set them (grep), and `CoordGrid.zone(-1)` is -1 (`pos >> 3`, `Engine-TS/src/engine/CoordGrid.ts:18`), so the window bounds are -40 and 32 and the rebuild condition (`x < reloadLeftX || z < reloadBottomZ || x > reloadRightX - 1 || z > reloadTopZ - 1 || reconnect`, `Engine-TS/src/engine/entity/BuildArea.ts:61-67`) is false only when both x and z are in -40..31. **Inference:** since a player's map coordinates are not both that small (not checked against `PlayerLoading`), a fresh login always sends `RebuildNormal` here, then sets the origin to the player's position.
       - Every `write` goes straight to the socket (`Engine-TS/src/engine/entity/Player.ts:2239-2245`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:191-227`), so these packets reach the client in phase 7, before anything phase 10 sends.
       - **Inventories and stats are not sent here.** They go out in phase 10 of the same tick (rule 16).
       - The `LOGIN` script runs **protected** (`executeScript(..., true)`), in phase 7. At this point `delayed` and `protect` are false on a freshly loaded player (field defaults; whether `PlayerLoading` restores either was not checked beyond a grep for `delayed` and `protect`, which found nothing), so `runScript` does not refuse it ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 6). If it suspends, it is stored as `activeScript` and resumed in phase 5 of a later tick (05 rules 5-6), and `executeScript` leaves `protect = true` on the player (`Engine-TS/src/engine/entity/Player.ts:2218`) until phase 11 of the login tick resets it (`Engine-TS/src/engine/World.ts:1148-1149`, `Engine-TS/src/engine/entity/Player.ts:476`). The lookup is `getByTriggerSpecific(LOGIN, -1, -1)`; that Content's `[login,_]` is registered under this key was not verified (as for `[logout,_]`, rule 8). Content's `[login,_]` writes a welcome `mes`, sets var defaults and player ops, sets four timers (`settimer(stat_regen, 100)` etc.), queues `macro_event_login` and `follower_login` with delay 0, calls many login procs, and in `~initalltabs` calls `inv_transmit` for the inventory and worn items and `if_settab` for each tab (`Content/scripts/login_logout/login.rs2:1-88`, `Content/scripts/login_logout/login.rs2:90-114`). The procs were not read.
       - `isActive = true` is set **after** the login script runs.
    5. If a shutdown is scheduled (`shutdownTick != -1`), write `UpdateRebootTimer`.
    6. Post `player_login` to the friend thread (boundary).

16. **The new player in phases 8-11 of its login tick T.**
    - Phase 8 (`processZones`) does not iterate players (`Engine-TS/src/engine/World.ts:963-988`).
    - Phase 9 (`processInfo`) iterates `playerLoop`, so it already includes the new player: `rebuildNormal()` again and `rsbuf.computePlayer(...)` with `tele` true (`Engine-TS/src/engine/World.ts:1000-1019`).
    - Phase 10 (`processClientsOut`) iterates `playerLoop` and, for a connected client, runs `updateMap`, `updatePlayers`, `updateNpcs`, `updateZones`, `updateInvs`, `updateStats`, `updateAfkZones`, `encodeOut` (`Engine-TS/src/engine/World.ts:1101-1123`). For a new player:
      - `updateMap`: `lastMapZone` and `lastZone` start at -1 (`Engine-TS/src/engine/entity/Player.ts:385-386`), so the mapzone and zone **enter** triggers are enqueued (no exit triggers, since the "last" values are -1) and `rebuildZones()` fills the active zones (`Engine-TS/src/engine/entity/NetworkPlayer.ts:251-283`). It also writes `SetMultiway` if `isMulti` differs between the old zone value (-1) and the new zone (`Engine-TS/src/engine/entity/NetworkPlayer.ts:270-274`); `isMulti(-1)` unpacks -1 to level 3, x 16383, z 16383 (`Engine-TS/src/engine/CoordGrid.ts:129-134`) and checks that zone's index in the multiway set (`Engine-TS/src/engine/GameMap.ts:102-105`, `Engine-TS/src/engine/zone/ZoneMap.ts:6-8`), so on login `SetMultiway` is written exactly when the player's zone is multiway, unless the multiway map lists that corner zone (map file not read; [`10-clients-out.md`](10-clients-out.md) rule 3). Engine-queue entries run from phase 5 of T+1 at the earliest ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 22).
      - `updateZones`: the loaded-zone set is empty (cleared by `rebuildNormal`, `Engine-TS/src/engine/entity/BuildArea.ts:90`), so every active zone gets `writeFullFollows` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:294-315`).
      - `updateInvs`: each listener added by `inv_transmit` starts with `firstSeen: true` (`Engine-TS/src/engine/entity/Player.ts:1513`), so it gets an `UpdateInvFull`, and a first-seen player inventory also forces `UpdateRunWeight` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:332-395`). **This is the inventory send for a login**, in phase 10 of tick T, provided the login script called `inv_transmit` (Content does, rule 15).
      - `updateStats`: the constructor calls `fill(-1)` on both `lastStats` and `lastLevels` (`Engine-TS/src/engine/entity/Player.ts:434-435`). `lastStats` is an `Int32Array`, so it holds -1; `lastLevels` is a `Uint8Array` (`Engine-TS/src/engine/entity/Player.ts:320-321`), so it holds 255. `stats` is an `Int32Array` and `levels` a `Uint8Array` (`Engine-TS/src/engine/entity/Player.ts:297-298`). `updateStats` sends `UpdateStat` for stat i when `stats[i] !== lastStats[i] || levels[i] !== lastLevels[i]` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:317-324`), so on the first tick every stat is sent unless its experience is exactly -1 **and** its level is exactly 255. **Inference:** all 21 are sent; a fresh save gives experience 0 or more and levels 1 or 10 (`Engine-TS/src/engine/entity/PlayerLoading.ts:39-51`); for a loaded save this was not checked. `lastRunEnergy` starts at -1 (`Engine-TS/src/engine/entity/Player.ts:294`), so run energy is sent unless `Math.floor(runenergy)` is -1 (`Engine-TS/src/engine/entity/NetworkPlayer.ts:326-329`).
    - Phase 11 (`processCleanup`) iterates `playerLoop` and calls `resetEntity(false)` on it (`Engine-TS/src/engine/World.ts:1148-1149`).

17. **When a new player first appears in each player phase.** Players added in phase 7 of tick T:
    - **Phase 2 (input):** first in tick T+1. The phase-2 loop of T ran before the add.
    - **Phase 5 (processing):** first in tick T+1. In T it only had its `LOGIN` script run, in phase 7.
    - **Phase 6 (logout checks):** first in tick T+1.
    - **Phases 9-11 (info, output, cleanup):** already in tick T (rule 16).

    The timers the login script sets have `clock = T` ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 16), so `settimer(x, 100)` first fires in phase 5 of T+100 if accessible. A delay-0 `queue(...)` from the login script runs in the first phase-5 queue pass, T+1 if accessible.

### Reconnect

18. **A reconnect re-attaches the socket to the existing player and discards the newly loaded one.** Source: `Engine-TS/src/engine/World.ts:825-854`
    ```ts
            if (player.reconnecting) {
                for (const other of this.playerLoop.all()) {
                    if (player.username !== other.username) {
                        continue;
                    }

                    if (isClientConnected(other)) {
                        player.addSessionLog(LoggerEventType.MODERATOR, 'Logged to world ' + Environment.node.id + ' replacing session', other.client.uuid);
                        other.client.close();
                    }

                    if (other instanceof NetworkPlayer && player instanceof NetworkPlayer) {
                        other.client = player.client;
                        other.session = other.client.uuid;
                        other.client.send(Uint8Array.from([15]));
                    }

                    rsbuf.cleanupPlayerBuildArea(other.slot);

                    other.onReconnect();
    ```
    - The existing `Player` (`other`) keeps its slot, position, queues, timers, `activeScript` and `loggingOut`. It was already processed in phases 2-6 of this tick with its old client. Its `lastConnected` and `lastResponse` are not re-stamped here; the new `player` object, whose stamps are current, is dropped by `newPlayers.clear()`.
    - The response byte is 15 rather than 2.
    - `onReconnect()` (`Engine-TS/src/engine/entity/Player.ts:535-578`) writes, at once: `ResetClientVarCache` and the transmitted varps, `RebuildNormal` (forced by `rebuildNormal(true)`), the reboot timer if a shutdown is pending, then `closeModal()`, `IfSetTab` for all 14 tabs, `UpdateStat` for every stat, `UpdateRunEnergy` and `ResetAnims`. `refreshInvs()` sets every listener's `firstSeen` (`Engine-TS/src/engine/entity/Player.ts:1442-1448`), so full inventories go out in phase 10. It sets the face-entity and appearance masks, `moveSpeed = INSTANT`, `tele` and `jump`. It does not run a script trigger.
    - A reconnect for a username that is not in `playerLoop` falls through to the normal checks and is logged in as a new player.

## Comment-versus-code check

- `cycle()` "player login, good spot for it (before packets so they immediately load but after processing so nothing hits them)" (`Engine-TS/src/engine/World.ts:383`):
  - "before packets so they immediately load": **depends on the reading (interpretation)**. The comment does not say which packets; `cycle()` itself says "process packets" for phase 2 input (`Engine-TS/src/engine/World.ts:352`) and "flush packets" for phase 10 output (`Engine-TS/src/engine/World.ts:407`).
    - Read as phase-10 output: **matches**. Phase 7 is before phase 10, and the new player is already in `playerLoop` for phases 9 and 10 of the same tick (rule 16); the map rebuild is sent even earlier, inside phase 7 (rule 15).
    - Read as phase-2 input: the login comes after phase 2 of tick T and before phase 2 of T+1, so the player's first input decode is in T+1 (rule 17). "Before packets" then holds only relative to the next tick's input.
  - "after processing so nothing hits them": **matches for the player loops** of phases 2 and 5 and for NPC processing in phases 3-4 of this tick: those ran before the add (rule 17). Two limits: the player's own `LOGIN` script runs in phase 7 and can act on the world and other players in that tick; and phase 10 enqueues its zone/mapzone triggers in the login tick.
- `cycle()` "player logout" (`Engine-TS/src/engine/World.ts:380`): matches; it omits that removal is conditional (rule 7) and that saves are posted here (rule 10).
- `processLogouts` "world shutdown or x-logged / timed out for 60s: force logout" (`Engine-TS/src/engine/World.ts:745`): 100 ticks x 600 ms = 60 s, **matches** the condition. "force logout" **overstates** the effect: it sets `loggingOut` and bypasses only `preventLogoutUntil`; removal still needs `canAccess()`, an empty engine queue and a discardable queue (rules 6-7).
- "connection lost for 30s: request idle logout" (`Engine-TS/src/engine/World.ts:749`): 50 ticks = 30 s, **matches**. "Connection lost" here means `isClientConnected` has been false (the `NullClientSocket` swap, rule 4), not "no data".
- "engine message type in osrs" (`Engine-TS/src/engine/World.ts:757`): not checkable from this code; the engine sends a plain `MessageGame`.
- "^discard" (`Engine-TS/src/engine/World.ts:772`): **matches in effect**. The loop only skips `LONG` entries with `logoutAction` 1 when deciding whether removal may happen; the actual discard is `queue.clear()` in `cleanup()` during `removePlayer` (rule 8).
- `logoutRequests` "waiting for confirmation from login server" (`Engine-TS/src/engine/World.ts:142`): **matches** (deleted only on a successful logout response or `RELAY_CLEARLOGOUTS`, rule 10). `loginRequests` "waiting for response from login server" (`Engine-TS/src/engine/World.ts:141`): **matches** (rule 13).
- `newPlayers` "players joining at the end of this tick" (`Engine-TS/src/engine/World.ts:143`): **imprecise**. Players are added to the set between ticks and join in phase 7 of the next tick, which is followed by phases 8-11; they are not processed at the end of the tick.
- `playerLoop` "the server processes players in the underlying bucket-order (key fragment + insertion order)" (`Engine-TS/src/engine/World.ts:145`): matches ([`02-clients-in.md`](02-clients-in.md) rules 1-2).
- `processLogins` inline comments "prevent logging in if a player save is being flushed", "reconnect a new socket with player in the world", "player already logged in", "prevent logging in when the server is shutting down", "normal login process", "world full" (`Engine-TS/src/engine/World.ts:812`, `Engine-TS/src/engine/World.ts:824`, `Engine-TS/src/engine/World.ts:857`, `Engine-TS/src/engine/World.ts:872`, `Engine-TS/src/engine/World.ts:882`, `Engine-TS/src/engine/World.ts:885`): each **matches** the code under it. `shutdownSoon` "shutting down within the next 30s" (`Engine-TS/src/engine/World.ts:201`): 50 ticks, matches. "IPv4"/"IPv6"/"127.0.0.1" (`Engine-TS/src/engine/World.ts:912`, `Engine-TS/src/engine/World.ts:917`, `Engine-TS/src/engine/World.ts:932`): match (`2130706433` is 0x7F000001). "mouse tracking can only be enabled on login" (`Engine-TS/src/engine/World.ts:906`): a client-side claim, not checked.
- `forceLogout` "let the login server know this player can log in elsewhere, do not update save file" (`Engine-TS/src/engine/World.ts:1631`): the engine side **matches** (it posts `player_force_logout` without a save). What the login server does was not read.
- `onLogin` "confirmed order: rebuild_normal, chat_filter_settings, varp_reset, varps, invs, interfaces, stats, runweight, runenergy, reset anims, social" (`Engine-TS/src/engine/entity/Player.ts:489-500`): **does not match the code order**, which the code itself flags with "todo: exact order" (`Engine-TS/src/engine/entity/Player.ts:505`). The code sends rebuild, chat filter, the friend-list state ("social") and `IfClose`/`UpdatePid`, then varp reset, varps and `ResetAnims`, all in phase 7; invs, run weight, stats and run energy follow in phase 10 (rule 16). Interfaces (`if_settab`) come from the login script in phase 7; whether `if_settab` writes at once was not checked.
- `onReconnect` "reload entity info (overkill? does the client have some logic around this?)" above `this.buildArea.clear(true)` (`Engine-TS/src/engine/entity/Player.ts:553-554`): **mismatch**. `clear(true)` does nothing; `BuildArea.clear` clears its sets only when `reconnecting` is false (`Engine-TS/src/engine/entity/BuildArea.ts:23-29`). The next line's `rebuildNormal(true)` does clear `loadedZones` (`Engine-TS/src/engine/entity/BuildArea.ts:90`), so phase 10's `updateZones` sends every active zone in full again (`Engine-TS/src/engine/entity/NetworkPlayer.ts:306-313`): zone state is re-sent, just not by `clear(true)`.
- `onReconnect` "rebuild scene later this tick (note: rebuild won't run on the client if you're in the same zone!)" (`Engine-TS/src/engine/entity/Player.ts:555-556`): **mismatch on timing**. `rebuildNormal(true)` writes `RebuildNormal` immediately, in phase 7 (`Engine-TS/src/engine/entity/BuildArea.ts:67-86`). The note about the client was not checked.
- `onReconnect` header list "varp_reset, varps, rebuild_normal, invs, stats, runweight, runenergy, reset_anims, socials" (`Engine-TS/src/engine/entity/Player.ts:536-544`): the order matches for the packets written directly, except that invs and run weight go out in phase 10 (via `refreshInvs`) and "socials" is not in `onReconnect`; the friend thread is told `player_login` by `processLogins` (`Engine-TS/src/engine/World.ts:846-851`).
- `onLoginMessage` "// rejected" under `if (!save && !reconnecting)` (`Engine-TS/src/engine/World.ts:1905-1910`): the branch is **unreachable as written** (inference, rule 13), because `save` is never falsy. The commented-out reconnect check above it (`Engine-TS/src/engine/World.ts:1899-1904`) is inactive code.
- `HashTable.all` "need to store the next node early in case it's removed while iterating" (`Engine-TS/src/datastruct/HashTable.ts:55`): **matches** and is what makes removal inside `processLogouts` safe (rule 9).

## Inferences (labelled)

- **Inference: a player whose logout is accepted in tick T gets no output in phase 10 of T**, apart from what was written directly before removal (e.g. the `Logout` packet and anything scripts wrote earlier in the tick). Rests on rules 8 and 11 and phase 10 iterating `playerLoop` (`Engine-TS/src/engine/World.ts:1101`). Not observed.
- **Inference: "forced" logouts can still be blocked for as long as the blocking condition lasts.** A disconnected player that is `delayed`, or whose normal queue keeps a non-discardable entry, or whose engine queue never drains, is not removed by the 100-tick path, because `force` only skips `preventLogoutUntil` (rules 6-7). Only the shutdown path ends this: during `World.shutdown`, `canAccess()` is always true (`Engine-TS/src/engine/entity/Player.ts:826-828`), and `processShutdown` removes every player once 1024 ticks have passed since the shutdown tick (`Engine-TS/src/engine/World.ts:1217-1225`). From `shutdownTick + 4` ticks run back to back (`tickRate = 0`, `Engine-TS/src/engine/World.ts:1233-1236`, `Engine-TS/src/engine/World.ts:504-508`; see [`11-cleanup-and-tail.md`](11-cleanup-and-tail.md) rule 21), so the 1024 ticks take far less than 614 s. Rests on rules 6-7. Not observed.
- **Inference: a `LONG` entry with `logoutAction` 0 delays removal by at least one tick.** In tick T phase 6 it blocks removal (not discardable); in T+1 phase 5 it is accelerated to delay 0 and runs if the player is accessible ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 11); T+1 phase 6 can then remove the player if nothing else blocks. One with `logoutAction` 1 does not delay removal and is dropped unrun. Rests on rule 6. Not observed.
- **Inference: a slot freed in phase 6 can be reused by a login in phase 7 of the same tick.** `removePlayer` deletes `players[slot]` (rule 8) and `getNextPlayerSlot` returns the lowest free slot (rule 14). The engine (rsbuf) side is read in [`09-info.md`](09-info.md) rules 12-14 and 24 (observers remove the old pid and may re-add it, because the new player has `tele` set); the client side is `docs/open-questions.md` #35.
- **Inference: a reconnect does not cancel a pending logout.** `loggingOut` is never reset (rule 1) and the reconnect keeps the existing `Player` (rule 18), so a player that was already `loggingOut` when it reconnects is still removed by phase 6 of a later tick once the rule-7 conditions hold. Rests on rules 1, 7 and 18. Not observed.
- **Inference: after a reconnect, closing the new socket may not be noticed through `NullClientSocket`.** The new socket's `player` is the discarded object built by `PlayerLoading.load` (rule 18; `client.player` is assigned only in the `NetworkPlayer` constructor, rule 4). If that socket later emits `close`, its handler swaps the `client` of the discarded object, not of `other`. `other.client` stays a closed `TcpClientSocket`, `isClientConnected(other)` stays true, phase 2 keeps stamping `lastConnected`, and only the 100-tick no-response path (rule 3) applies. Conversely, if the **old** socket was still connected at the reconnect, `other.client.close()` is called on it in phase 7 and, if Node later emits its `close` event, that handler (whose `player` is `other`) would replace the reconnected client with a `NullClientSocket`. Rests on rules 4 and 18 and the inference that socket events run between ticks (rule 13). Whether and when Node emits `close` after `socket.end()` was not checked; nothing was run (`docs/open-questions.md` #36).
- **Inference: a kick or ban aimed at a player who is still in `newPlayers` marks it `loggingOut` before it logs in.** `getPlayerByUsername` also searches `newPlayers` (`Engine-TS/src/engine/World.ts:1691-1706`), the kick and ban paths set `loggingOut` on what it returns (rule 1), and `processLogins` does not reset it. These paths also call `logout()` and `client.close()` when `isClientConnected` (rule 1), which is true for a player in `newPlayers` (its client is still the login socket). If the socket's `close` event is handled before phase 7, the handler swaps that player's client to a `NullClientSocket` (its `client.player` is this object, rule 4), and phase 7 takes the not-connected branch: no response bytes, added to `playerLoop` under the 127.0.0.1 key (`Engine-TS/src/engine/World.ts:931-934`). If not, phase 7 takes the connected branch and sets `client.state = 1` on the closed socket (`Engine-TS/src/engine/World.ts:900`). Either way the player would be logged in in phase 7 and then removed in phase 6 of a later tick if nothing blocks. Rests on rules 1, 4, 7 and 15. Not observed.

## Not checked / open questions

- The login thread, login server and friend thread (what `player_login`, `player_logout` with save, `player_force_logout`, `player_autosave` cause; when and whether a logout response with `success` arrives; what happens if it never does, which would keep refusing that username). Boundary; `docs/open-questions.md` #34 and #22.
- `Player.save()` and `PlayerLoading.load()` beyond its first 37 lines (which fields are restored, e.g. whether `delayed`, `protect`, queues or timers survive a relog). Boundary; `docs/open-questions.md` #34.
- When Node emits `close` after `TcpClientSocket.close()` (`socket.end()`), and so how long the phase-5/phase-2 `catch` path takes to reach the `NullClientSocket` swap. `docs/open-questions.md` #29. The reconnect back-reference issue is `docs/open-questions.md` #36.
- How other clients see a player appear, leave, or a slot reused in one tick (client side). The rsbuf side of `addPlayer`/`removePlayer`/`cleanupPlayerBuildArea` is in [`09-info.md`](09-info.md) rules 12-14 and 23-25. `docs/open-questions.md` #35.
- `Zone.enter`/`Zone.leave` and the collision helpers called by `removePlayer`. `Zone.enter`/`leave` are now read in [`08-zones.md`](08-zones.md) rule 25; the collision helpers are in `docs/open-questions.md` #4.
- Content: the procs called by `[login,_]` and `[logout,_]`, whether `if_settab` writes at once, whether the logout tab's root is an overlay (if not, its `IF_BUTTON` script is protected and refused while the player is `delayed` or `protect`, [`02-clients-in.md`](02-clients-in.md) rule 15), and where `combat_preventlogout` is called. `docs/open-questions.md` #37.
- Which engine code calls `Player.isValid()` (and so ignores a `loggingOut` player). `docs/open-questions.md` #52.
- `processShutdown` and the cycle tail were read only for the lines cited above; they are covered in [`11-cleanup-and-tail.md`](11-cleanup-and-tail.md) (rules 13-23).
- Nothing was run; no timing here was observed.

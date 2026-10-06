# Phase 5a: `processPlayers` part 1 (delay, resume, queues, timers, engine queue)

**Question answered:** In the fifth phase of a game tick, what happens for each player from the start of its turn up to (not including) facing and interaction: how `delayed` is cleared, when a suspended script resumes, how the normal, weak and engine queues and the two kinds of timer count down and run, what blocks each of them, and what an exception does?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

Related notes: [`02-clients-in.md`](02-clients-in.md) (player order in `playerLoop`, rules 1-3; which packets set `requestModalClose`, run scripts or call `clearPendingAction` in phase 2, rules 13 and 15-16), [`01-world.md`](01-world.md) (world queue hands `SUSPENDED` scripts to players, rule 7; `LinkList` iteration, rules 5 and 9; `ScriptRunner.execute` error handling, rule 6), [`04-npcs.md`](04-npcs.md) (the NPC equivalents: delay, resume, queue, timer; compared below). The second half of the per-player turn (facing, `processInteraction`, movement, run energy) is [`06-players-interaction-movement.md`](06-players-interaction-movement.md), which continues the numbered list in the L2 section. Facts reused from the related notes were re-checked at the same Engine-TS commit and are re-cited here.

## Position in the tick

`processPlayers()` is the fifth call in `World.cycle()`, after `processNpcs()` (phase 4) and before `processLogouts()` (phase 6). Source: `Engine-TS/src/engine/World.ts:367-381`
```ts
            this.processNpcs();

            // player processing
            // - primary queue
            // - weak queue
            // - timers
            // - soft timers
            // - engine queue
            // - interactions
            // - movement
            // - close interface if attempting to logout
            this.processPlayers();

            // player logout
            this.processLogouts();
```

## L2: ordered sub-steps

`processPlayers` itself (`Engine-TS/src/engine/World.ts:687-737`):

1. Record a start time.
2. For each player in `World.playerLoop.all()` order (L3 rule 1), run the per-player turn below inside a `try`; on any exception, log it and, for a connected client, send `Logout` and close the socket (L3 rule 3).
3. Store elapsed ms in `cycleStats[WorldStat.PLAYER]`.

**Per-player order within the tick** (one player's turn; the whole turn finishes before the next player's starts). Steps 1-5 are this note; steps 6-11 are listed only for position and are covered by [`06-players-interaction-movement.md`](06-players-interaction-movement.md).

1. **Undelay**: if `delayed` and `currentTick >= delayedUntil`, set `delayed = false` (L3 rule 4). Source: `Engine-TS/src/engine/World.ts:692`
2. **Resume suspended script**: if not delayed and `activeScript.execution === SUSPENDED`, `executeScript(activeScript, true, true)` (L3 rules 5-7). Source: `Engine-TS/src/engine/World.ts:694-697`
3. **`processQueues()`** (L3 rules 9-15). Source: `Engine-TS/src/engine/World.ts:699-701`, `Engine-TS/src/engine/entity/Player.ts:874-889`
   1. Scan the normal queue for any `STRONG` entry; if one exists set `requestModalClose`.
   2. If `requestModalClose`: clear it and `closeModal()` (clears the weak queue, closes modals, runs `IF_CLOSE` scripts).
   3. `processQueue()`: the normal queue (`NORMAL`, `STRONG`, `LONG` entries), FIFO.
   4. `processWeakQueue()`: the weak queue, FIFO.
4. **Timers**, only if not `loggingOut`: all `NORMAL` timers, then all `SOFT` timers (L3 rules 16-19). Source: `Engine-TS/src/engine/World.ts:702-707`
5. **`processEngineQueue()`** (L3 rules 20-21). Source: `Engine-TS/src/engine/World.ts:708-709`
6. `setFaceEntity()` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:713`
7. `reorientEntity()` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:714`
8. `processInteraction()`: interaction and movement ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:715-717`
9. `reorient()` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:719`
10. `updateEnergy()` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:721-722`
11. `validateDistanceWalked()`, only if the `EXACT_MOVE` mask is not set ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). Source: `Engine-TS/src/engine/World.ts:724-726`

There is no early return in the turn: steps 1-11 are reached for every player in `playerLoop` (delayed, busy, logging out or disconnected alike), and each step applies its own gate (L3 rule 2).

## L3: ordering rules

### Which players, in what order, and the per-player `catch`

1. **Order.** The loop is `for (const player of this.playerLoop.all())` (`Engine-TS/src/engine/World.ts:690`), the same structure and call as phase 2, so players are visited in `playerLoop` bucket order then login order, not by slot ([`02-clients-in.md`](02-clients-in.md) rules 1-3). Each player's turn (steps 1-11) completes before the next player's turn starts. The writers of `playerLoop` found by grep are in `processLogins` (phase 7, `Engine-TS/src/engine/World.ts:910-934`) and its removal is `World.removePlayer`, called from `processLogouts`, `processShutdown` and the `cycle()` crash handler ([`02-clients-in.md`](02-clients-in.md) rule 2), none of which runs inside phase 5.

2. **No turn-level gate.** `processPlayers` has no `isValid`, `isActive`, `delayed` or connection check around the turn (`Engine-TS/src/engine/World.ts:690-726`); compare `Npc.turn()`, which returns early when `!isValid()` ([`04-npcs.md`](04-npcs.md) rule 4). `isClientConnected` appears only in the `catch`. So a player without a connected client (`isClientConnected` is false for a non-`NetworkPlayer` or a `NullClientSocket` client, `Engine-TS/src/engine/entity/NetworkPlayer.ts:398-400`) still has its queues and timers processed every tick while it is in `playerLoop`.

3. **Exceptions.** Source: `Engine-TS/src/engine/World.ts:727-733`
   ```ts
            } catch (err) {
                console.error(err);
                if (isClientConnected(player)) {
                    player.logout();
                    player.client.close();
                }
            }
   ```
   - `NetworkPlayer.logout()` only writes a `Logout` packet (`Engine-TS/src/engine/entity/NetworkPlayer.ts:230-232`). `TcpClientSocket.close()` sets `state = -1` and calls `socket.end()` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:19-22`). The `catch` does **not** set `loggingOut` and does not remove the player; the rest of that player's turn is skipped for this tick and the loop goes on to the next player. What later removes such a player (socket close handling, the phase-6 timeouts) was not traced here (`docs/open-questions.md` #29).
   - For a player whose client is not connected, the `catch` only logs.
   - Script errors inside the interpreter do not reach this `catch`: `ScriptRunner.execute` catches them and returns `ABORTED` (`Engine-TS/src/engine/script/ScriptRunner.ts:126`, `Engine-TS/src/engine/script/ScriptRunner.ts:170`, `Engine-TS/src/engine/script/ScriptRunner.ts:228-231`). In production that `catch` also calls `logout()` and sets `loggingOut = true` on a player `self` (`Engine-TS/src/engine/script/ScriptRunner.ts:203-206`), which takes effect at once: if that script was run for this player before step 4 (steps 2-3), the timer step of the same turn is skipped (rule 19).
   - What can reach it is engine code that throws after `execute` returns, e.g. `Player.executeScript`'s routing reads `script.activePlayer` / `script.activeNpc` (`Engine-TS/src/engine/entity/Player.ts:2214-2217`), whose getters throw on a null pointer (`Engine-TS/src/engine/script/ScriptState.ts:185-191`, `Engine-TS/src/engine/script/ScriptState.ts:217-223`).
   - An exception thrown inside the `catch` itself (by `logout()` or `close()`) would leave `processPlayers` and reach `cycle()`'s `catch`, which removes every player and exits (`Engine-TS/src/engine/World.ts:509-526`); not analysed whether that can happen.
   - Effect on the queue entry being run: `processQueue` and `processWeakQueue` unlink the entry **before** running it (`Engine-TS/src/engine/entity/Player.ts:904-911`, `Engine-TS/src/engine/entity/Player.ts:919-923`), so a throw drops it; `processEngineQueue` unlinks **after** `executeScript` returns (`Engine-TS/src/engine/entity/Player.ts:663-667`), so a throw leaves the entry in the engine queue (see Inferences).

### Delay and resume (steps 1-2)

4. **When `delayed` clears.** Source: `Engine-TS/src/engine/World.ts:692`
   ```ts
                if (player.delayed && this.currentTick >= player.delayedUntil) player.delayed = false;
   ```
   The fields live on `PathingEntity` (`delayed = false`, `delayedUntil = -1`, `Engine-TS/src/engine/entity/PathingEntity.ts:60-61`). For players, grep of `Engine-TS/src` for `.delayed = ` and `delayedUntil` finds exactly two writers that set it and this one line that clears it:
   - `p_delay(n)`: `delayed = true`, `delayedUntil = currentTick + 1 + check(n, NumberNotNull)` (the argument is validated as not null before use), script state `SUSPENDED` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380`).
   - `p_arrivedelay`: returns without doing anything if `lastMovement < currentTick`; otherwise `delayed = true`, `delayedUntil = currentTick + 1`, state `SUSPENDED` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:359-367`).

   `World.currentTick` is incremented once per cycle, after phase 11 (`Engine-TS/src/engine/World.ts:503`). This is the same rule NPCs use in phase 4 (`Engine-TS/src/engine/entity/Npc.ts:110-112`), applied to players at the top of their phase-5 turn. Unlike the NPC version it is not inside an `isActive` check.

5. **When a suspended script resumes.** Source: `Engine-TS/src/engine/World.ts:694-697`
   ```ts
                // - resume suspended script
                if (!player.delayed && player.activeScript && player.activeScript.execution === ScriptState.SUSPENDED) {
                    player.executeScript(player.activeScript, true, true);
                }
   ```
   - Only `SUSPENDED` (2) is resumed here. `PAUSEBUTTON` (3) and `COUNTDIALOG` (4) (`Engine-TS/src/engine/script/ScriptState.ts:26-33`) wait for a resume packet in phase 2 ([`02-clients-in.md`](02-clients-in.md) rule 15). Grep of `Engine-TS/src/engine/script/handlers` for `ScriptState.SUSPENDED` finds only `P_ARRIVEDELAY` and `P_DELAY` (rule 4), both of which set `delayed` on the same `state.activePlayer`. So a `SUSPENDED` script is always waiting on a delay, and the resume happens in the same step as the undelay.
   - A script reaches `player.activeScript` in `SUSPENDED` state from three places, and all of them are resumed here: `Player.executeScript` (any phase; `Engine-TS/src/engine/entity/Player.ts:2216-2218`), the world queue in phase 1 (`Engine-TS/src/engine/World.ts:547-549`), and `Npc.executeScript` (`Engine-TS/src/engine/entity/Npc.ts:232-233`), which is called in phase 3 by `processNpcEventQueue` (`Engine-TS/src/engine/World.ts:654`) and in phase 4 from `Npc.turn()` and its callees (e.g. `Engine-TS/src/engine/entity/Npc.ts:116`, `Engine-TS/src/engine/entity/Npc.ts:555`, `Engine-TS/src/engine/entity/Npc.ts:579`; grep of `Engine-TS/src` found no other caller). In each case the target player is `script.activePlayer`, whose getter picks the primary or secondary player by `intOperand` at the current `pc` (`Engine-TS/src/engine/script/ScriptState.ts:185-191`, `Engine-TS/src/engine/script/ScriptState.ts:280-282`). The interpreter increments `pc` before calling a handler and stops right after the handler sets a non-running state (`Engine-TS/src/engine/script/ScriptRunner.ts:137-157`), so `pc` still points at the `p_delay`/`p_arrivedelay` instruction and the script is stored on the same player that instruction delayed.

6. **What `executeScript(script, true, true)` means.** `protect = true`, `force = true`. Source: `Engine-TS/src/engine/entity/Player.ts:2171-2187`
   ```ts
    runScript(script: ScriptState, protect: boolean = false, force: boolean = false) {
        if (!force && protect && (this.protect || this.delayed)) {
            // can't get protected access, bye-bye
            // printDebug('No protected access:', script.script.name, protect, this.protect);
            return -1;
        }

        if (protect) {
            script.pointerAdd(ScriptPointer.ProtectedActivePlayer);
            this.protect = true;
        }

        const state = ScriptRunner.execute(script);

        if (protect) {
            this.protect = false;
        }
   ```
   - `force` skips the refusal check, so the resume runs even if `protect` is still set. `protect` re-adds the `ProtectedActivePlayer` pointer and sets `player.protect = true` while the script runs, then clears it. `runScript` also clears `protect` on `_activePlayer`/`_activePlayer2` if the script holds their protected pointers (`Engine-TS/src/engine/entity/Player.ts:2189-2197`).
   - Afterwards `executeScript` routes by the returned state (`Engine-TS/src/engine/entity/Player.ts:2205-2228`):
     - **finished or aborted:** if it is the player's `activeScript`, clear `activeScript` and `resumeButtons`, and, if no `MAIN` modal is open, `closeModal(false)` (which leaves the weak queue alone).
     - **`WORLD_SUSPENDED`:** world queue.
     - **`NPC_SUSPENDED`:** the active NPC's `activeScript`.
     - **anything else** (`SUSPENDED` again, `PAUSEBUTTON`, `COUNTDIALOG`): store on `script.activePlayer.activeScript` and set that player's `protect = protect`, i.e. `true` here.

7. **How long `protect` lasts.** Grep of `Engine-TS/src` for `.protect = ` on players finds:
   - set `true` only in `runScript` while a protected script runs (`Engine-TS/src/engine/entity/Player.ts:2180`);
   - set to the script's `protect` argument in `executeScript` when a script stops in `SUSPENDED`, `PAUSEBUTTON` or `COUNTDIALOG` (`Engine-TS/src/engine/entity/Player.ts:2218`): `true` for a protected script, **`false`** for an unprotected one (e.g. a soft timer or an `IF_CLOSE` script, rules 10 and 17);
   - set `false` in `runScript` after execution (`Engine-TS/src/engine/entity/Player.ts:2186`, `Engine-TS/src/engine/entity/Player.ts:2191`, `Engine-TS/src/engine/entity/Player.ts:2196`), in `Npc.executeScript` (`Engine-TS/src/engine/entity/Npc.ts:240`, `Engine-TS/src/engine/entity/Npc.ts:245`), in `closeModal` when not delayed (`Engine-TS/src/engine/entity/Player.ts:764-766`), and in `resetEntity` (`Engine-TS/src/engine/entity/Player.ts:476`).

   `resetEntity(false)` is called for every player in `playerLoop` in phase 11 (`Engine-TS/src/engine/World.ts:1148-1149`). So the "preserve protected access when delayed" value set at `Engine-TS/src/engine/entity/Player.ts:2218` lasts at most until the end of the current tick. On later ticks a waiting `SUSPENDED` script blocks the player through `delayed` (rule 8), not through `protect`.

### The access gate (`canAccess`)

8. **`busy()` and `canAccess()`.** Source: `Engine-TS/src/engine/entity/Player.ts:816-832`
   ```ts
    containsModalInterface() {
        // main or chat is open
        return (this.modalState & (ModalState.MAIN | ModalState.CHAT)) !== ModalState.NONE;
    }

    busy() {
        return this.delayed || this.containsModalInterface();
    }

    canAccess() {
        if (World.shutdown) {
            // once the world has gone past shutting down, no protection rules apply
            return true;
        } else {
            return !this.protect && !this.busy();
        }
    }
   ```
   `canAccess()` (not `protect`, not `delayed`, no `MAIN`/`CHAT` modal; always true once `World.shutdown`) is the per-entry gate for the normal queue, weak queue, normal timers and engine queue. Soft timers do not check it (rule 17). A side modal does not make the player busy. The gate is evaluated **per entry**, not once per step, so a script that delays the player, opens a main/chat modal or leaves `protect` set blocks every later entry in the same pass.

### Queues (step 3)

9. **Three lists, one enqueue function.** `queue`, `weakQueue` and `engineQueue` are separate `LinkList`s (`Engine-TS/src/engine/entity/Player.ts:345-347`). Source: `Engine-TS/src/engine/entity/Player.ts:841-851`
   ```ts
    enqueueScript(script: ScriptFile, type: QueueType = PlayerQueueType.NORMAL, delay = 0, args: ScriptArgument[] = []) {
        const request = new PlayerQueueRequest(type, script, args, delay);
        if (type === PlayerQueueType.ENGINE) {
            request.delay = 0;
            this.engineQueue.addTail(request);
        } else if (type === PlayerQueueType.WEAK) {
            this.weakQueue.addTail(request);
        } else {
            this.queue.addTail(request);
        }
   ```
   - `NORMAL`, `STRONG` and `LONG` (and `SOFT`, for which grep finds no writer) all go into `queue`. Types: `Engine-TS/src/engine/entity/PlayerQueueRequest.ts:5-12`.
   - The script commands `strongqueue`, `weakqueue`, `queue` and `longqueue` (and their vararg forms) pass the script's `delay` unchanged (no `+1`, no range check); `longqueue` stores `[logoutAction, arg...]` as args (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:100-193`).
   - The friend-server message `RELAY_QUEUESCRIPT` also enqueues a `[queue,<name>]` script as `NORMAL` with delay 0 (`Engine-TS/src/engine/World.ts:2065-2075`); when that handler runs relative to the tick was not traced.
   - All three lists are FIFO: `addTail` is the only insert used, and `all()` walks head to tail (`Engine-TS/src/datastruct/LinkList.ts:13-23`, `Engine-TS/src/datastruct/LinkList.ts:97-111`).

10. **Strong entries and `requestModalClose` close the modal first, even while delayed.** Source: `Engine-TS/src/engine/entity/Player.ts:874-889`
    ```ts
    processQueues() {
        // the presence of a strong script closes modals before queue runs
        for (const request of this.queue.all()) {
            if (request.type === PlayerQueueType.STRONG) {
                this.requestModalClose = true;
                break;
            }
        }
        if (this.requestModalClose) {
            this.requestModalClose = false;
            this.closeModal();
        }

        this.processQueue();
        this.processWeakQueue();
    ```
    - The scan does not look at the entry's delay or at `canAccess`: any `STRONG` entry anywhere in `queue`, due or not, triggers `closeModal()`, and it does so every tick the entry is queued. `requestModalClose` is also set by the `CLOSE_MODAL` packet handler in phase 2 (`Engine-TS/src/network/game/client/handler/CloseModalHandler.ts:13`).
    - `closeModal()` (default `clearWeakQueue = true`) does the following (`Engine-TS/src/engine/entity/Player.ts:760-814`):
      - always: clears the **weak queue** and, if not delayed, sets `protect = false`. Both happen before the `modalState === ModalState.NONE` early return, so they happen even when nothing is open (`Engine-TS/src/engine/entity/Player.ts:761-770`).
      - only if `modalState !== NONE` (`Engine-TS/src/engine/entity/Player.ts:768-813`): sets `modalState = NONE`; drops an `activeScript` in `COUNTDIALOG`/`PAUSEBUTTON` state (the dialogue script is abandoned) and clears `resumeButtons`; for each of `modalMain`, `modalChat`, `modalSide` that is set (`!== -1`), runs its `IF_CLOSE` script, unprotected, if such a trigger exists, then clears its listeners and resets the slot to -1 (`Engine-TS/src/engine/entity/Player.ts:781-811`); and sets `refreshModalClose`.

11. **Normal queue pass.** Source: `Engine-TS/src/engine/entity/Player.ts:897-913`
    ```ts
        for (const request of this.queue.all()) {
            if (this.loggingOut && request.type === PlayerQueueType.LONG && request.args[0] === 0) {
                // ^accelerate
                request.delay = 0;
            }

            const delay = request.delay--;
            if (this.canAccess() && delay <= 0) {
                request.unlink();

                if (request.type === PlayerQueueType.LONG) {
                    request.args.shift();
                }
                const script = ScriptRunner.init(request.script, this, null, request.args);
                this.executeScript(script, true);
            }
        }
    ```
    - **Counter:** the delay is post-decremented on **every visit**, whether or not the player can be accessed; the entry runs when the value **before** the decrement is `<= 0` and `canAccess()` is true. So an entry with delay d is skipped on d visits and runs on visit d+1 if the player is accessible then; a blocked entry keeps counting down past 0 and runs on the first accessible visit.
    - **Order:** FIFO. `STRONG`, `NORMAL` and `LONG` are treated alike here apart from the modal close (rule 10) and the `LONG` rules: while `loggingOut`, a `LONG` entry whose `logoutAction` (`args[0]`) is 0 has its delay forced to 0 ("accelerate"); a `LONG` entry's `logoutAction` is removed from the args before the script runs.
    - **Run:** the entry is unlinked, then the script is created with `self` = this player and no target and run with `executeScript(script, true)`: protected, not forced. Outside shutdown, `canAccess()` being true means `protect` and `delayed` are false, so `runScript`'s refusal check passes (rule 6). During `World.shutdown`, `canAccess()` is true regardless (rule 8), so the refusal check can then reject an entry that was already unlinked (see Inferences).

12. **Weak queue pass.** Same counter and gate as rule 11, no type rules, runs after the whole normal-queue pass. Source: `Engine-TS/src/engine/entity/Player.ts:916-926`
    ```ts
    processWeakQueue() {
        for (const request of this.weakQueue.all()) {
            const delay = request.delay--;
            if (this.canAccess() && delay <= 0) {
                request.unlink();
    ```
    The difference between "weak" and "normal" lies in what clears them: `weakQueue` is cleared by every `closeModal()` with the default argument (rule 10), and `queue` is cleared only by `Player.cleanup()` (`Engine-TS/src/engine/entity/Player.ts:456-458`) or by `clearqueue` for one script id (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1102-1104`, `Engine-TS/src/engine/entity/Player.ts:853-872`, which removes from both `queue` and `weakQueue`). Callers of `closeModal()` (grep):
    - `clearPendingAction()` (`Engine-TS/src/engine/entity/Player.ts:970-973`). It is called by the move and op packet handlers in phase 2 ([`02-clients-in.md`](02-clients-in.md) rule 16) and by `p_stopaction` / `p_clearpendingaction` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:430-437`).
    - the `if_close` command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:246-247`).
    - `processQueues` (rule 10).
    - `processLogouts` (`Engine-TS/src/engine/World.ts:765`).
    - `Engine-TS/src/engine/entity/Player.ts:562`, in `onReconnect` (not read for this note; read in [`07-logouts-logins.md`](07-logouts-logins.md) rule 18 and [`10-clients-out.md`](10-clients-out.md) rule 23).
    - several cheats.

    The `closeModal(false)` at the end of a finished `activeScript` does not clear it (rule 6).

13. **Entries added or removed during a pass.** `LinkList.all()` saves the cursor (the node after the current one, set by `head()`/`next()` before the yield) and restores it after the loop body (`Engine-TS/src/datastruct/LinkList.ts:47-55`, `Engine-TS/src/datastruct/LinkList.ts:67-75`, `Engine-TS/src/datastruct/LinkList.ts:97-111`; [`01-world.md`](01-world.md) rules 5 and 9). For an entry appended to the same list by a script run from that list's pass:
    - if the running entry was **not** the last node, the new entry is reached in the same pass: decremented once and, if its delay was 0 and the player is accessible, run.
    - if the running entry **was** the last node, the saved cursor is the sentinel, `next()` returns `null`, and the new entry is first visited next tick.

    The code comment above `processQueue` describes exactly this (comment check below). A different list that has not been processed yet this turn is unaffected by this quirk: e.g. a weak entry added by a normal-queue script is visited in this turn's weak pass.

14. **A queue script that suspends.** The entry was already unlinked (rule 11), and the `ScriptState` it created becomes the player's `activeScript` with `protect = true` (rule 6). `p_delay` also set `delayed` (rule 4). For the rest of this turn `canAccess()` is false, so:
    - the remaining normal-queue entries, the weak queue, normal timers and the engine queue are visited (their delays still decrement) but nothing runs;
    - soft timers still run (rule 17).

    On each later tick, while `delayed` holds, the same applies (through `busy()`; `protect` was reset in phase 11, rule 7). On tick `delayedUntil` the script resumes in step 2, **before** that tick's queue pass, and if it finishes (and leaves no modal open) the queues run in the same turn. A protected script that stops in `PAUSEBUTTON`/`COUNTDIALOG` (a dialogue) instead also leaves `protect = true` for the rest of the tick and is resumed only by a phase-2 resume packet. Whether the content dialogue commands also open a chat modal (making the player `busy()` on later ticks) was not read.

15. **No per-entry `try`/`catch`.** None of `processQueue`, `processWeakQueue`, `processTimers` or `processEngineQueue` has its own `try` (`Engine-TS/src/engine/entity/Player.ts:660-670`, `Engine-TS/src/engine/entity/Player.ts:891-961`); an engine exception from one entry ends the player's whole turn for this tick (rule 3).

### Timers (step 4)

16. **A timer is a map entry keyed by script id, with the tick it was set or last fired.** Source: `Engine-TS/src/engine/entity/Player.ts:928-943`
    ```ts
    setTimer(type: PlayerTimerType, script: ScriptFile, args: ScriptArgument[] = [], interval: number) {
        const timerId = script.id;
        const timer = {
            type,
            script,
            args,
            interval,
            clock: World.currentTick
        };

        this.timers.set(timerId, timer);
    }
    ```
    - `timers` is a `Map<number, EntityTimer>` (`Engine-TS/src/engine/entity/Player.ts:349`; type `NORMAL` or `SOFT`, `Engine-TS/src/engine/entity/EntityTimer.ts:8-11`).
    - `settimer` and `softtimer` call it with the script's interval, unchecked (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:874-900`).
    - Because the key is the script id alone, setting a timer that already exists **replaces** it and restarts its clock at the current tick. A soft and a normal timer for the same script cannot coexist.
    - `clearTimer` deletes by id (`Engine-TS/src/engine/entity/Player.ts:941-943`).

17. **Firing rule.** Source: `Engine-TS/src/engine/entity/Player.ts:945-961`
    ```ts
    processTimers(type: PlayerTimerType) {
        for (const timer of this.timers.values()) {
            if (type !== timer.type) {
                continue;
            }

            // only execute if it's time and able
            // soft timers can execute while busy, normal cannot
            if (World.currentTick >= timer.clock + timer.interval && (timer.type === PlayerTimerType.SOFT || this.canAccess())) {
                // set clock back to interval
                timer.clock = World.currentTick;

                const script = ScriptRunner.init(timer.script, this, null, timer.args);
                this.executeScript(script, timer.type === PlayerTimerType.NORMAL);
            }
        }
    }
    ```
    - **No countdown.** A timer compares the absolute tick with `clock + interval`. Ticks while the player is delayed, busy or protected count towards the interval (unlike an NPC timer, which counts only valid turns; [`04-npcs.md`](04-npcs.md) rule 12).
    - **Normal timer:** fires only when `canAccess()`; it is run protected (`executeScript(script, true)`), and a due one that is blocked stays due and fires on the first accessible turn.
    - **Soft timer:** fires regardless of `delayed`, modal or `protect`; it is run unprotected (`executeScript(script, false)`).
    - **Clock:** set to the current tick **before** the script runs, so the next firing is `interval` ticks after the actual (possibly late) firing, not after the scheduled one. A script that re-sets its own timer replaces the entry and its clock again (rule 16).
    - **Interval 0 or negative:** fires on every pass.

18. **Normal before soft.** All `NORMAL` timers are processed (in `Map` iteration order), then all `SOFT` timers. Source: `Engine-TS/src/engine/World.ts:702-707`
    ```ts
                if (!player.loggingOut) {
                    // - timers
                    player.processTimers(PlayerTimerType.NORMAL);
                    // - soft timers
                    player.processTimers(PlayerTimerType.SOFT);
                }
    ```

19. **`loggingOut` stops both kinds of timer, and nothing else in steps 1-5.** The guard above is the only `loggingOut` check in `processPlayers` (`Engine-TS/src/engine/World.ts:690-726`); inside steps 1-5 the only other use is the `LONG` acceleration (rule 11).
    - **Who sets it:** `loggingOut` is set `true` by `processLogouts` (phase 6, `Engine-TS/src/engine/World.ts:746`, `Engine-TS/src/engine/World.ts:755`), by the production script-error path (`Engine-TS/src/engine/script/ScriptRunner.ts:205`) and by the kick and ban paths (friend-server `RELAY_KICK`, `Engine-TS/src/engine/World.ts:2032-2037`; `notifyPlayerBan`, `Engine-TS/src/engine/World.ts:2307-2310`; the `::kick` cheat, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:665-674`). Grep finds no assignment back to `false`.
    - **Effect:** a logging-out player's timers are frozen (not run, clocks unchanged), while its resume, queues and engine queue keep running. Among other conditions, `processLogouts` removes the player only when `canAccess()`, the engine queue is empty and the normal queue holds nothing but `LONG` entries with `logoutAction` 1 (`Engine-TS/src/engine/World.ts:764-791`). That is phase 6; its details are in [`07-logouts-logins.md`](07-logouts-logins.md) rules 6-7.

### Engine queue (step 5)

20. **Contents.** Only `enqueueScript(..., PlayerQueueType.ENGINE)` writes `engineQueue`, always with delay 0 (rule 9). Callers (grep):
    - `[mapzone,...]`, `[mapzoneexit,...]`, `[zone,...]` and `[zoneexit,...]` triggers, from `triggerMapzone`/`triggerMapzoneExit`/`triggerZone`/`triggerZoneExit` (`Engine-TS/src/engine/entity/Player.ts:580-615`). These are called by `NetworkPlayer.updateMap()` when the player's map square or zone changed, exit before enter (`Engine-TS/src/engine/entity/NetworkPlayer.ts:251-283`), and `updateMap()` runs in phase 10, `processClientsOut` (`Engine-TS/src/engine/World.ts:1108`).
    - `CHANGESTAT` triggers from `changeStat` (`Engine-TS/src/engine/entity/Player.ts:1895-1900`). It is called by the stat commands when a level changes (e.g. `Engine-TS/src/engine/script/handlers/PlayerOps.ts:529-531`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:546-548`) and by `addXp` on a level-up (`Engine-TS/src/engine/entity/Player.ts:1845-1851`).
    - `ADVANCESTAT` triggers from `addXp` on a level-up, after `CHANGESTAT` (`Engine-TS/src/engine/entity/Player.ts:1883-1886`). `addXp` is called by the `stat_advance` command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:816`) and one cheat.

21. **Pass.** Source: `Engine-TS/src/engine/entity/Player.ts:660-670`
    ```ts
    processEngineQueue() {
        for (const request of this.engineQueue.all()) {
            const delay = request.delay--;
            if (this.canAccess() && delay <= 0) {
                const script = ScriptRunner.init(request.script, this, null, request.args);
                this.executeScript(script, true);

                request.unlink();
            }
        }
    }
    ```
    FIFO, same counter and `canAccess()` gate as the normal queue. Since the delay is always 0, an entry runs on the first visit at which the player is accessible; while blocked it stays queued. It runs protected. Unlike the other two queues, it is unlinked **after** the script runs (rule 3). The engine queue runs even while `loggingOut`, and must be empty before phase 6 removes the player (rule 19).

### What a delay-0 enqueue does in the same tick

22. Combining the step order with rules 11-13, 17 and 21. "This tick" for the queue columns and the normal-timer case assumes `canAccess()` is true at that entry's visit. The timer column also assumes the player is not `loggingOut` (both timer passes are skipped then, rule 19); a soft timer does not need `canAccess()` (rule 17). Any weak entry is also subject to rule 10: if step 3a/3b runs `closeModal()` (a `STRONG` entry anywhere in `queue`, including one added by the same script, or a pending phase-2 `requestModalClose`), the weak queue is cleared before the weak pass.

    | Enqueued (on this player) during | Normal queue, delay 0 | Weak queue, delay 0 | Engine queue | Timer, interval 0 |
    |---|---|---|---|---|
    | Phases 1-4, or this player's phase-2 packets | this tick's pass | this tick's pass (unless a `closeModal()` clears it first, e.g. a later move/op packet, or rule 10) | this tick | this tick |
    | Step 2 (resumed script) | this tick | this tick, unless rule 10 clears it in step 3b | this tick | this tick |
    | Step 3c (normal-queue script) | this pass only if the running entry was not the last node (rule 13), else next tick | this tick (weak pass is later) | this tick | this tick |
    | Step 3d (weak-queue script) | next tick | as rule 13 | this tick | this tick |
    | Step 4 (timer script) | next tick | next tick | this tick | normal timer from a normal timer, or soft from a soft timer: depends on `Map` iteration (see Inferences); soft from a normal timer: this tick; normal from a soft timer: next tick |
    | Step 5 (engine-queue script) | next tick | next tick | as rule 13 | next tick |
    | Steps 6-11 (e.g. op/ap script in `processInteraction`), or phases 6-11 (e.g. `updateMap` in phase 10) | next tick | next tick | next tick | next tick |

    "Next tick" means the first visit, in tick T+1, at which the player is accessible.

### State this part of the phase writes (for the ordering matrix)

23. Per player:
    - `delayed` (cleared), `activeScript`, `protect`, `resumeButtons`;
    - the three queues (unlink, delay counters) and `timers` (`clock`);
    - `requestModalClose`, and through `closeModal`: `modalState`, `modalMain`/`modalChat`/`modalSide`, `refreshModalClose`, the weak queue and inventory listeners;
    - `cycleStats[WorldStat.PLAYER]` (written after all players);
    - plus anything the scripts do. They can affect other players, NPCs, the world queue, zones and inventories, and can set `delayed`, open modals and enqueue on any of the queues above.

## Player versus NPC (phase 5 vs phase 4)

| Aspect | Player (this note) | NPC ([`04-npcs.md`](04-npcs.md)) |
|---|---|---|
| Turn gate | None; each step gates itself (rule 2) | `turn()` returns early unless `isValid()` = active and not delayed (04 rule 4) |
| Undelay | `currentTick >= delayedUntil`, top of turn, no `isActive` check (rule 4) | same comparison, only `if (isActive)` (04 rule 6) |
| Resumed state | `SUSPENDED`, via `executeScript(s, true, true)` (protected, forced) (rules 5-6) | `NPC_SUSPENDED`, via `Npc.executeScript(s)` (04 rule 6) |
| Queues | three lists: normal (`NORMAL`/`STRONG`/`LONG`), weak, engine (rule 9) | one list of `ai_queueN` entries (04 rule 13) |
| Queue counter | post-decrement on every visit, even when blocked; runs when the pre-decrement value `<= 0` (delay d runs on visit d+1) (rule 11) | decremented only while not delayed, then runs when `<= 0` (delay d runs on visit max(1, d)) (04 rule 13) |
| Queue gate | `canAccess()` per entry: not protected, not delayed, no main/chat modal (rule 8) | `!delayed` per entry; `isActive` at start (04 rule 13) |
| Unlink vs run | normal and weak: unlink then run; engine: run then unlink (rule 3) | unlink then run (04 rule 13) |
| Script looked up | the `ScriptFile` stored at enqueue time (rule 11) | by trigger with the NPC's current type when it runs (04 rule 13) |
| Timers | any number, keyed by script id, absolute-tick comparison, normal (gated) and soft (ungated) (rules 16-17) | one `ai_timer`, counter incremented only on valid turns (04 rule 12) |
| Exception | `Logout` packet and socket close; player stays in the loop this tick (rule 3) | `World.removeNpc(npc, 0)` (04 rule 3) |

## Comment-versus-code check

`processPlayers` header comment (`Engine-TS/src/engine/World.ts:678-686`), "- resume suspended script - primary queue - weak queue - timers - soft timers - engine queue - interactions - movement - close interface if attempting to logout":
- Steps 1-5 **match in order**. The header omits the undelay line (step 1), which runs before the resume.
- "interactions" and "movement" are both inside `processInteraction` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)). The facing calls before it and the `reorient`/`updateEnergy`/`validateDistanceWalked` calls after it are not listed.
- "close interface if attempting to logout": **no such step in `processPlayers`**. The body contains no `loggingOut`-triggered `closeModal`; the only `loggingOut` use is to skip timers (rule 19). The interface close for a logging-out player is in `processLogouts`, phase 6 (`Engine-TS/src/engine/World.ts:764-765`).

`cycle()` comment above the call (`Engine-TS/src/engine/World.ts:369-377`): same list **without** "resume suspended script". Otherwise the same remarks as above.

Inline comments in the body:
- "- resume suspended script" (`Engine-TS/src/engine/World.ts:694`): **matches** (rule 5).
- "- primary queue - weak queue" (`Engine-TS/src/engine/World.ts:699-700`): **matches**, with two omissions. "Primary" is `queue` (`NORMAL`/`STRONG`/`LONG`), processed before `weakQueue`. Not mentioned: `processQueues` first may close the modal (rule 10).
- "- timers" / "- soft timers" (`Engine-TS/src/engine/World.ts:703`, `Engine-TS/src/engine/World.ts:705`): **match** the calls. Not mentioned: both sit inside `if (!player.loggingOut)`.
- "- engine queue" (`Engine-TS/src/engine/World.ts:708`): **matches**.
- "Face the interaction target -- both halves, the same tick the op set the target (the op ran in processClientsIn) and before processInteraction can clear it ..." (`Engine-TS/src/engine/World.ts:710-712`): the **position** matches (both calls come before `processInteraction`). What `setFaceEntity`/`reorientEntity` do is not checked here (see [`06-players-interaction-movement.md`](06-players-interaction-movement.md)).
- "- interactions - movement" (`Engine-TS/src/engine/World.ts:715-716`): above `processInteraction`; checked in [`06-players-interaction-movement.md`](06-players-interaction-movement.md).
- "After movement: face a loc/obj target if we walked over and held still (needs stepsTaken)" (`Engine-TS/src/engine/World.ts:718`): the position after `processInteraction` matches; the content is checked in [`06-players-interaction-movement.md`](06-players-interaction-movement.md).
- "- run energy" (`Engine-TS/src/engine/World.ts:721`): matches the call below it.

Queue, timer and related comments:
- `processQueues` "the presence of a strong script closes modals before queue runs" (`Engine-TS/src/engine/entity/Player.ts:875`): **matches**, and the code goes further: the strong entry need not be due, the close happens every tick while it is queued, it happens while delayed, and the same `closeModal()` clears the weak queue (rule 10).
- `processQueue` quirk comment "in .head() the next link is cached ... if a script is before the end of the list, it can be processed this tick and result in inconsistent queue timing (authentic)" (`Engine-TS/src/engine/entity/Player.ts:892-896`): **matches** this `LinkList` (rule 13). The attributions to the original game and to "De0" cannot be checked from code.
- "^accelerate" (`Engine-TS/src/engine/entity/Player.ts:899`): **matches**: the delay is set to 0 for a `LONG` entry with `logoutAction` 0 while logging out.
- `processTimers` "only execute if it's time and able / soft timers can execute while busy, normal cannot" (`Engine-TS/src/engine/entity/Player.ts:951-952`): **matches**, and soft timers also run while `protect` is set, since `canAccess()` covers `protect` as well as `busy()`.
- "set clock back to interval" (`Engine-TS/src/engine/entity/Player.ts:954`): **imprecise**. The clock is set to the **current tick**, not to the interval. The effect is that the timer restarts its interval from now.
- `EntityTimer.clock` doc "Tracks the time until execution" (`Engine-TS/src/engine/entity/EntityTimer.ts:36-39`): **mismatch**. `clock` holds the tick at which the timer was set or last fired, not a remaining time. `interval` "The time interval between executions" (`Engine-TS/src/engine/entity/EntityTimer.ts:31-34`) matches.
- `PlayerQueueRequest.delay` doc "The number of ticks remaining until the queue executes" (`Engine-TS/src/engine/entity/PlayerQueueRequest.ts:33-36`): **approximately**. It is the number of further visits to skip. With delay d, an entry added before this tick's pass runs d ticks later; one added after the pass runs d+1 ticks later; a blocked entry runs later than either (rule 11, Inferences).
- `PlayerQueueType` "LONG, // like normal with dev-controlled logout behavior" (`Engine-TS/src/engine/entity/PlayerQueueRequest.ts:7`): **matches** (acceleration here, discard in phase 6). The dates on `WEAK`, `STRONG` and `SOFT` ("sept 2004", "late-2004", "OSRS") are history, not checkable; `SOFT` has no writer.
- `enqueueScript` JSDoc (`Engine-TS/src/engine/entity/Player.ts:834-840`): lists parameters only.
- `executeScript` "preserve protected access when delayed" (`Engine-TS/src/engine/entity/Player.ts:2218`): **matches** for the rest of the tick only. Phase 11 resets `protect` (rule 7). The line also applies to `PAUSEBUTTON`/`COUNTDIALOG`, which are not delays.
- `runScript` "can't get protected access, bye-bye" (`Engine-TS/src/engine/entity/Player.ts:2173`): **matches**: the script is not run and nothing is queued.
- `closeModal` "close any input dialogue suspended scripts." (`Engine-TS/src/engine/entity/Player.ts:774`): **matches**, but only when a modal was open. With `modalState` `NONE` the function returns before this line.
- `canAccess` "once the world has gone past shutting down, no protection rules apply" (`Engine-TS/src/engine/entity/Player.ts:827`): **matches**.
- `containsModalInterface` "main or chat is open" (`Engine-TS/src/engine/entity/Player.ts:817`): **matches**.

## Inferences (labelled)

- **Inference: `p_delay(n)` called in tick T resumes in step 2 of this player's phase-5 turn in tick T+1+n, whichever phase called it.** Facts:
  - `delayedUntil = T+1+n` (rule 4);
  - the only line that clears a player's `delayed` runs once per tick, at step 1, and needs `currentTick >= delayedUntil`;
  - `currentTick` rises by one per cycle;
  - the resume is in the same turn (rule 5).

  So `p_delay(0)` is a one-tick pause and `p_arrivedelay` (when it delays) also resumes in T+1. This matches the NPC inference in [`04-npcs.md`](04-npcs.md). It also answers the "when" part of `docs/open-questions.md` #16: a `SUSPENDED` script handed over by the world queue in phase 1 is resumed in phase 5 of tick T+1+n. Not observed.
- **Inference: the missing `protect` assignment on the world-queue hand-over (`Engine-TS/src/engine/World.ts:547-549`) makes no difference to blocking.** Facts:
  - `SUSPENDED` is only produced by `p_delay`/`p_arrivedelay`, which set `delayed` on the same player the script is handed to (rules 4-5);
  - `busy()`, and hence `canAccess()` and `runScript`'s refusal check, are already false/refusing because of `delayed`;
  - `protect` would be reset in phase 11 anyway (rule 7);
  - the resume uses `force` (rule 6).

  Not observed.
- **Inference: queue timing.** If the player is accessible on every visit:
  - a normal or weak entry with delay d ≥ 0, added in tick T before this player's pass, runs in tick T+d;
  - one added after the pass runs in tick T+1+d;
  - negative delays behave like 0.

  Compare NPCs (T+max(0, d-1) / T+max(1, d)) and the world queue (d+2) in [`04-npcs.md`](04-npcs.md) and [`01-world.md`](01-world.md). Rests on rules 11-12 and the step order. Not observed.
- **Inference: a normal or weak queue entry that becomes due while the player is blocked runs on the first accessible tick, and all such overdue entries run in FIFO order that tick**, until one of their scripts makes the player inaccessible again. The delay keeps counting down while blocked, unlike the NPC queue. Rests on rules 8 and 11.
- **Inference: weak-queue entries that exist at the start of `processQueues` never get to run while any `STRONG` entry is in the normal queue**: `closeModal()` clears them each tick before `processWeakQueue` (rule 10). Entries added after that point in the same turn (by a normal-queue script) survive into this turn's weak pass. Not observed; whether content uses `strongqueue` and `weakqueue` together was not checked.
- **Inference: a player-A script that enqueues on player B (e.g. through the secondary active player) with delay 0 runs in B's pass this tick only if B comes after A in `playerLoop` order**; otherwise next tick. This needs B accessible and the command to target B (only `state.activePlayer` was read, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:157`). Rests on rules 1 and 22.
- **Inference: an engine-queue entry whose `executeScript` throws stays queued and runs again** on the next accessible visit, because the unlink comes after the call (rule 21), while the per-player `catch` only closes the socket (rule 3). Same for any engine exception thrown after the script ran. Not observed.
- **Inference: an entry removed from the list being iterated, by the script now running, can still be visited once.** This happens when the removed entry is the saved cursor (the next node), for example through `clearqueue` or a `closeModal()` that clears the weak queue during the weak pass. `unlink()` nulls its `next` (`Engine-TS/src/datastruct/Linkable.ts:6-15`), `next()` still returns the saved node, and the loop then ends. The removed entry is decremented and, if due and accessible, run. This is the same `LinkList` behaviour described in [`04-npcs.md`](04-npcs.md) Inferences. Rests on rule 13. Not observed.
- **Inference: a timer added during a timer pass may be visited in the same pass.** Examples: a soft timer set by a soft timer script, or a new normal timer set by a normal timer script. JavaScript `Map` iteration visits entries added during the iteration. This is language semantics, not engine code, and was not tested. Re-setting an existing timer keeps its position in the map and replaces the object (rule 16).
- **Inference: during `World.shutdown`, due entries of a delayed or protected player are lost.** `canAccess()` is true during shutdown (rule 8), but `runScript` still refuses a protected, non-forced script while `protect || delayed` (rule 6). So a normal or weak queue entry that is due is unlinked and then not run (rule 11), an engine-queue entry is not run and is then unlinked (rule 21), and a normal timer has its clock reset without running (rule 17). Rests on those rules. Not observed; the shutdown sequence itself was not read.
- **Inference: a disconnected player that is still in `playerLoop` keeps running queues, timers and engine-queue scripts** until it is removed (rule 2). How long that takes is phase 6/7 territory and was not traced (`docs/open-questions.md` #29).
- **Inference: a soft timer fires even during `p_delay`**, so its script can act on a delayed player, for example by changing stats or enqueueing. Whether the compiler or VM stops an unprotected soft-timer script from calling protected commands such as `p_delay` was not checked: the `P_DELAY` handler itself has no pointer check (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380`). See `docs/open-questions.md` #30.

## Not checked / open questions

- RuneScript VM internals (how `SUSPENDED` scripts keep `pc`, stacks and frames). Boundary; `docs/open-questions.md` #15.
- Whether the RuneScript compiler restricts protected-only commands (`p_delay`, queue commands, `settimer`) in unprotected script contexts (soft timers, `IF_CLOSE` scripts, the logout trigger). `docs/open-questions.md` #30.
- What happens after the `processPlayers` `catch` closes a socket: the socket close handling, when `client` becomes a `NullClientSocket`, and when phase 6 removes the player. `docs/open-questions.md` #29.
- `processLogouts` details (`LONG` discard, `preventLogoutUntil`, the logout trigger): only the lines cited in rule 19 were read here; answered in [`07-logouts-logins.md`](07-logouts-logins.md) rules 5-8.
- Steps 6-11 (`setFaceEntity`, `reorientEntity`, `processInteraction`, `reorient`, `updateEnergy`, `validateDistanceWalked`): only their call order was read here; covered by [`06-players-interaction-movement.md`](06-players-interaction-movement.md).
- The cheat handler's `closeModal`/`loggingOut` uses were found by grep only. `Player.ts:562` (a `closeModal()` caller, rule 12) was not read for this note; it is in `onReconnect`, read in [`07-logouts-logins.md`](07-logouts-logins.md) rule 18 and [`10-clients-out.md`](10-clients-out.md) rule 23; the cheat handler is `docs/open-questions.md` #24.
- When the friend-server `RELAY_QUEUESCRIPT` handler runs relative to the tick (`Engine-TS/src/engine/World.ts:2065-2075`). `docs/open-questions.md` #50.
- Content: which scripts use `strongqueue`, `weakqueue`, `longqueue` (and with which `logoutAction`), `settimer`/`softtimer` intervals, and whether dialogue commands open a chat modal. Not read. `docs/open-questions.md` #51.
- JavaScript `Map` iteration semantics for timers added during `processTimers` were not tested. `docs/open-questions.md` #48.
- Nothing was run; no timing here was observed (`docs/open-questions.md` #16 remains for observation).

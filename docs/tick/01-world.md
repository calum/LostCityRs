# Phase 1: `processWorld` (world queue, delayed objs, npc player-hunt)

**Question answered:** What does the first phase of a game tick do, in what order, with what script state, and what state does it read and change?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only two script comments and one command signature were read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

## Position in the tick

`processWorld()` is the first call inside `World.cycle()`, before `processClientsIn()` (phase 2). Source: `Engine-TS/src/engine/World.ts:345-355`
```ts
// world processing
// - world queue
// - npc hunt
this.processWorld();
// client input
this.processClientsIn();
```

Nothing runs in `cycle()` before it except reading the clock and computing drift (`Engine-TS/src/engine/World.ts:342-343`). The previous thing that ran is the end of the previous tick (`processCleanup` and the tail of `cycle()`), see `docs/tick/00-overview.md`.

## L2: ordered sub-steps

1. Record a start time. Source: `Engine-TS/src/engine/World.ts:532`
2. **World queue**: walk `World.queue` head to tail; for each entry, post-decrement its `delay`; if the pre-decrement value was `> 0` skip it, otherwise unlink it and resume its suspended `ScriptState`. Source: `Engine-TS/src/engine/World.ts:534-561`
3. **Delayed objs** (not mentioned in either header comment): walk `World.objDelayedQueue` head to tail with the same delay rule; due entries are unlinked and passed to `World.addObj`. Source: `Engine-TS/src/engine/World.ts:563-575`
4. **NPC player-hunt**: only if at least one player is logged in, for each active NPC (ascending nid) whose `huntMode !== -1` and that is currently in at least one player's NPC-info list, and whose hunt type is `PLAYER`, call `npc.huntAll(hunt)`, which may set `npc.huntTarget`. Source: `Engine-TS/src/engine/World.ts:577-592`. Unlike the two queue loops (each entry in its own `try`/`catch`), this loop has no `try`/`catch`, so an exception from `huntAll` propagates out of `processWorld` to `cycle()`'s `catch` (`Engine-TS/src/engine/World.ts:509-526`), which removes every player and calls `process.exit(1)`.
5. Store elapsed ms in `cycleStats[WorldStat.WORLD]`. Source: `Engine-TS/src/engine/World.ts:594`

## L3: ordering rules

### World queue

1. The world queue is `World.queue`, a `LinkList<EntityQueueState>`. Source: `Engine-TS/src/engine/World.ts:155`
   ```ts
   readonly queue: LinkList<EntityQueueState> = new LinkList();
   ```
   An `EntityQueueState` holds only a `ScriptState` and a `delay`. Source: `Engine-TS/src/engine/entity/PlayerQueueRequest.ts:49-58`
   ```ts
   export class EntityQueueState extends Linkable {
   script: ScriptState;
   delay: number;
   ```

2. The only way entries are added is `World.enqueueScript`, which appends to the tail with `delay + 1`. Source: `Engine-TS/src/engine/World.ts:1249-1251`
   ```ts
   enqueueScript(script: ScriptState, delay: number = 0): void {
   this.queue.addTail(new EntityQueueState(script, delay + 1));
   ```
   (Grep of `Engine-TS/src` for `World.queue`, `this.queue.` and `enqueueScript(` found no other writer of `World.queue`; `Npc.enqueueScript` and `Player.enqueueScript` write the entity's own queue.)

3. `World.enqueueScript` is called from exactly three places, each when a script's execution state is `WORLD_SUSPENDED` with the delay popped off the script's int stack:
   - `Player.executeScript`. Source: `Engine-TS/src/engine/entity/Player.ts:2212-2213`
   - `Npc.executeScript`. Source: `Engine-TS/src/engine/entity/Npc.ts:228-229`
   - `processWorld` itself (re-suspension). Source: `Engine-TS/src/engine/World.ts:554-556`

   `WORLD_SUSPENDED` is set only by the `WORLD_DELAY` opcode handler, which leaves its argument on the stack. Source: `Engine-TS/src/engine/script/handlers/ServerOps.ts:167-170`
   ```ts
   [ScriptOpcode.WORLD_DELAY]: state => {
   // arg is popped elsewhere
   state.execution = ScriptState.WORLD_SUSPENDED;
   ```
   In content this is the `world_delay` command. Source: `Content/scripts/engine.rs2:67-68`
   ```
   // info: Delay this script for $delay ticks on the world, not tied to any player/npc
   [command,world_delay](int $delay)
   ```
   `popInt` returns 0 for a missing/zero stack value. Source: `Engine-TS/src/engine/script/ScriptState.ts:288-294`

   So the world queue contains only scripts that called `world_delay` while being run by `Player.executeScript`, `Npc.executeScript` or the world queue. Four other paths run a script and ignore the returned state, so a `world_delay` there is not enqueued: NPC walk trigger (`Engine-TS/src/engine/entity/Npc.ts:367`), NPC hunt `findNewMode` queue trigger (`Engine-TS/src/engine/entity/Npc.ts:977`), the logout trigger (`Engine-TS/src/engine/World.ts:788`), and the player walk trigger: `Player.processWalktrigger` calls `this.runScript(script, true)` and discards the result (`Engine-TS/src/engine/entity/Player.ts:1113-1114`); `runScript` calls `ScriptRunner.execute` (`Engine-TS/src/engine/entity/Player.ts:2183`) and only clears protect flags before returning the state (`Engine-TS/src/engine/entity/Player.ts:2185-2199`), with no `WORLD_SUSPENDED` handling. So a `world_delay` in a player walktrigger is not enqueued either. What the script does after that is VM behaviour, not checked.

4. Delay rule: the loop reads the value **before** decrementing; the entry runs only when that value is `<= 0`, otherwise it is skipped (already decremented). Source: `Engine-TS/src/engine/World.ts:535-539`
   ```ts
   for (const request of this.queue.all()) {
   const delay = request.delay--;
   if (delay > 0) {
   continue;
   }
   ```
   With the `+1` from rule 2, an entry created with `world_delay(d)` (d >= 0) is skipped on d+1 visits and runs on visit d+2.

5. Order: entries run in queue order, head to tail, i.e. in the order they were enqueued (FIFO, since `addTail` is the only insert). `LinkList.all()` starts at `head()` and follows `next()`. Source: `Engine-TS/src/datastruct/LinkList.ts:97-111`
   ```ts
   *all(reverse = false): IterableIterator<T> {
   for (let link = this.head(); link !== null; link = this.next()) {
   const save = this.cursor;
   yield link;
   this.cursor = save;
   ```
   The cursor is set to the following node *before* the current node is yielded (`Engine-TS/src/datastruct/LinkList.ts:47-55`, `Engine-TS/src/datastruct/LinkList.ts:67-75`), so unlinking the current node during the loop is safe.

6. A due entry is unlinked **after** `ScriptRunner.execute` returns, whatever the result. Source: `Engine-TS/src/engine/World.ts:541-546`
   ```ts
   const script: ScriptState = request.script;
   const state: number = ScriptRunner.execute(script);
   // remove from queue no matter what, re-adds if necessary
   request.unlink();
   ```
   `ScriptRunner.execute` returns `ABORTED` early for a null state/script/info (`Engine-TS/src/engine/script/ScriptRunner.ts:122-124`), and wraps the interpreter loop in a `try` whose `catch` (`Engine-TS/src/engine/script/ScriptRunner.ts:170`) sets `ABORTED` (`Engine-TS/src/engine/script/ScriptRunner.ts:228`) and returns it (`Engine-TS/src/engine/script/ScriptRunner.ts:231`). That catch block has side effects of its own: in production it logs out a player `self` (`Engine-TS/src/engine/script/ScriptRunner.ts:203-206`) or removes an NPC `self` (`Engine-TS/src/engine/script/ScriptRunner.ts:211`). So script errors inside the interpreter loop do not normally reach the `catch` in `processWorld` (`Engine-TS/src/engine/World.ts:558-560`); that catch is mainly for errors thrown after `execute` returns (an error thrown inside the `execute` catch block itself was not analysed), e.g. by the `activePlayer`/`activeNpc` getters, which throw when the pointer is null (`Engine-TS/src/engine/script/ScriptState.ts:185-191`, `Engine-TS/src/engine/script/ScriptState.ts:217-223`). By then the entry is already unlinked, so the script is dropped and only logged.

7. After running, by returned state (`Engine-TS/src/engine/World.ts:548-557`):
   - `SUSPENDED` (2): `script.activePlayer.activeScript = script` (handed to a player; the player's resume is phase 5 territory, not traced here).
   - `NPC_SUSPENDED` (5): `script.activeNpc.activeScript = script`.
   - `WORLD_SUSPENDED` (6): `this.enqueueScript(script, script.popInt())` (new entry at the tail).
   - `FINISHED`, `ABORTED`, `PAUSEBUTTON` (3), `COUNTDIALOG` (4): no branch matches, so nothing further happens; the entry is already unlinked. State values: `Engine-TS/src/engine/script/ScriptState.ts:26-33`.

   By contrast, in `Player.executeScript` any state other than `FINISHED`, `ABORTED`, `WORLD_SUSPENDED` and `NPC_SUSPENDED` (so including `PAUSEBUTTON` and `COUNTDIALOG`) falls into the `else` branch that stores the script as the player's `activeScript`. Source: `Engine-TS/src/engine/entity/Player.ts:2216-2218`
   ```ts
   } else {
   script.activePlayer.activeScript = script;
   script.activePlayer.protect = protect; // preserve protected access when delayed
   ```

   Unlike `Player.executeScript`, the world queue does not set `player.protect` when handing a script to a player and does not clear any entity's `activeScript` on finish (compare `Engine-TS/src/engine/entity/Player.ts:2211-2221`).

8. Script state: the world queue does not create a new `ScriptState` and does not set any active entity. It resumes the exact `ScriptState` object that suspended, so `self`, `active_player`, `active_npc` etc. are whatever they were when `world_delay` ran. `ScriptRunner.execute` only records the previous execution state and sets it to `RUNNING` before continuing from the saved `pc`. Source: `Engine-TS/src/engine/script/ScriptRunner.ts:121-130`
   ```ts
   static execute(state: ScriptState) {
   if (state.execution !== ScriptState.RUNNING) {
   state.executionHistory.push(state.execution);
   }
   state.execution = ScriptState.RUNNING;
   ```

9. A re-suspended entry (rule 7, `WORLD_SUSPENDED`) is appended to the tail of the list being iterated. Whether it is visited again in the same pass depends on position: the cursor already points at the node after the current one (rule 5). If the current entry was the last node, the cursor is the sentinel and `next()` returns `null` (`Engine-TS/src/datastruct/LinkList.ts:67-72`), so the new entry is first visited next tick. If not, iteration continues through the tail and reaches the new entry this pass, decrementing its delay once (for d >= 0 it is skipped). The same applies to entries enqueued by any other script run inside this loop. Source for append: `Engine-TS/src/datastruct/LinkList.ts:13-23`

### Delayed objs

10. `World.objDelayedQueue` is a `LinkList<ObjDelayedRequest>`. Source: `Engine-TS/src/engine/World.ts:157`. The only writer found is the `INV_DROPITEM_DELAYED` opcode, which removes the items from the player's inventory immediately and queues a floor obj with the raw `delay` (no `+1`). Source: `Engine-TS/src/engine/script/handlers/InvOps.ts:201-208`
    ```ts
    const player = state.activePlayer;
    const completed = player.invDel(invType.id, objType.id, count);
    World.objDelayedQueue.addTail(new ObjDelayedRequest(floorObj, duration, delay, player.hash64));
    ```
    `delay` is not range-checked there (`duration` is, `Engine-TS/src/engine/script/handlers/InvOps.ts:195`).

11. Same pre-decrement rule as the world queue, but the entry is unlinked before `addObj`, and with no `+1` a request with delay d runs on visit d+1. Source: `Engine-TS/src/engine/World.ts:564-571`
    ```ts
    for (const request of this.objDelayedQueue.all()) {
    const delay = request.delay--;
    if (delay > 0) {
    continue;
    }
    request.unlink();
    this.addObj(request.obj, request.receiver64, request.duration);
    ```

12. The delayed-obj loop runs after the whole world-queue loop. So a world-queue script that calls `inv_dropitem_delayed` in this pass has its request visited in the same pass. Source: `Engine-TS/src/engine/World.ts:535`, `Engine-TS/src/engine/World.ts:564`

13. `addObj` either merges into an existing stackable `DESPAWN` obj of the same type and receiver on the tile (if the sum is within `Inventory.STACK_LIMIT`), or adds the obj to its zone, marks the zone tracked, sets the obj lifecycle to `duration`, and sets `reveal` to `Obj.REVEAL` (100) when there is a receiver, else `-1`. Source: `Engine-TS/src/engine/World.ts:1465-1500`. `Obj.REVEAL` is `Engine-TS/src/engine/entity/Obj.ts:9`. What the zone does with the obj (packets, reveal countdown) is phase 8 (`processZones`) and was not traced here.

### NPC player-hunt

14. The hunt step is skipped entirely when no player is logged in. `getTotalPlayers()` counts defined entries in `this.players[1..2046]`. Source: `Engine-TS/src/engine/World.ts:578`, `Engine-TS/src/engine/World.ts:1719-1729`

15. NPCs are visited in ascending nid order. In `EntityList`, the position in the `ids` array is the entity id (nid) and the value is the storage slot: `set(id, entity)` does `this.ids[id] = index; this[index] = entity` (`Engine-TS/src/engine/entity/EntityList.ts:62-74`). The iterator walks `ids` from position 0 upwards, skips `-1`, and yields `this[index]`, so iteration is by nid, not by storage slot. Source: `Engine-TS/src/engine/entity/EntityList.ts:36-47`
    ```ts
    *[Symbol.iterator](): ArrayIterator<T> {
    for (const index of this.ids) {
    if (index === -1) {
    continue;
    }
    ```

16. Per-NPC gate: `npc.isActive`, `npc.huntMode !== -1`, at least one observer, and the hunt config's type is `PLAYER`. There is no check of `npc.delayed`. Source: `Engine-TS/src/engine/World.ts:581-588`
    ```ts
    if (npc.isActive) {
    // Hunts will process even if the npc is delayed during this portion
    if (npc.huntMode !== -1 && rsbuf.getNpcObservers(npc.nid) > 0) {
    const hunt = HuntType.get(npc.huntMode);
    if (hunt && hunt.type === HuntModeType.PLAYER) {
    npc.huntAll(hunt);
    ```

17. "Observers" is a counter on the rsbuf NPC record (`Engine-TS/src/network/rsbuf/index.ts:290-295`). It is incremented when an NPC is added to a player's NPC-info list (`Engine-TS/src/network/rsbuf/info.ts:355`) and decremented when removed from it (`Engine-TS/src/network/rsbuf/info.ts:310-315`) or when a player is removed from rsbuf (`Engine-TS/src/network/rsbuf/index.ts:155-160`). Those encode calls run from `player.updateNpcs()` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:290-291`), which is called in `processClientsOut` (phase 10) for connected players (`Engine-TS/src/engine/World.ts:1101-1113`). So the observer count read here is the one left by the previous tick's phase 10. Exception: when `World.addNpc` is called with `firstSpawn` (the default) it calls `rsbuf.addNpc` (`Engine-TS/src/engine/World.ts:1269-1273`), which replaces the record with a new `Npc` (`Engine-TS/src/network/rsbuf/index.ts:263-268`) whose `observers` starts at 0 (`Engine-TS/src/network/rsbuf/npc.ts:28`). So an NPC first spawned in tick T has 0 observers until a phase 10 has run after the spawn, and cannot player-hunt before then; in particular an NPC spawned by a world-queue script in phase 1 cannot player-hunt in the hunt step of that same phase. The respawn path (`addNpc(..., false)`, `Engine-TS/src/engine/entity/Npc.ts:126`) skips `rsbuf.addNpc`; its record and count are kept across the removal ([`09-info.md`](09-info.md) rule 22, which narrows `docs/open-questions.md` #20). The count is also changed by clears that do not decrement (phase 10's `rebuildNpcs`, `Engine-TS/src/network/rsbuf/info.ts:280-282`; reconnect's `cleanupPlayerBuildArea`, `Engine-TS/src/engine/World.ts:842`, `Engine-TS/src/network/rsbuf/index.ts:310-315`) and by the shutdown force-removal after phase 11, which runs only on shutdown ticks with `currentTick - shutdownTick >= 1024` (`Engine-TS/src/engine/World.ts:422`, `Engine-TS/src/engine/World.ts:1217-1225`); see [`09-info.md`](09-info.md) rules 19-21.

18. `huntAll` first clears `huntTarget`, then returns early if `huntClock < hunt.rate - 1` (throttle), or if the hunt type is `OFF` or `huntrange < 1`. Otherwise it collects candidates and picks one uniformly at random with `Math.random()`. Source: `Engine-TS/src/engine/entity/Npc.ts:258-286`
    ```ts
    huntAll(hunt: HuntType): void {
    this.huntTarget = null;
    // If a huntrate is defined, this acts as a throttle
    if (this.huntClock < hunt.rate - 1) {
    return;
    }
    ```
    `huntClock` is not changed in this phase. It is incremented in `Npc.turn()` (phase 4) only when `turn()` gets past the `isValid()` early return (so not while the NPC is delayed, `Engine-TS/src/engine/entity/Npc.ts:153-155`), `huntMode !== -1`, and the condition `hunt.nobodyNear !== HuntNobodyNear.PAUSEHUNT || observers > 0 || hunt.type === HuntModeType.PLAYER` holds; for a `PLAYER` hunt that condition is always true (`Engine-TS/src/engine/entity/Npc.ts:158-170`). It is reset to 0 when a hunt target is consumed (`Engine-TS/src/engine/entity/Npc.ts:986`).

19. Candidates come from `HuntIterator` with type `PLAYER`: zones in a square of radius `(1 + huntrange / 8) | 0` zones around the NPC's zone, scanned from max x down and, within that, max z down; each zone's players iterated in reverse via `getAllPlayersSafe(true)`, which yields only `isValid()` players; then filtered by `distanceToSW <= huntrange` and the hunt's line-of-sight / line-of-walk setting. Source: `Engine-TS/src/engine/script/ScriptIterators.ts:53-97`, `Engine-TS/src/engine/zone/Zone.ts:411-417`. A player is not valid when `loggingOut` or `visibility !== DEFAULT`. Source: `Engine-TS/src/engine/entity/Player.ts:2293-2303`. The iteration order does not affect the result beyond the random pick (rule 18).

20. `huntPlayers` then filters on player state, each check only if the hunt config enables it: `busy()` (`delayed` or a modal interface open), `zonesAfk()` (`lastAfkZone === 1000`), combat level vs `vislevel * 2` outside the wilderness, recent-combat vars (`+ 8 > currentTick`) when not in multi-combat and the player is not already the NPC's target, varp conditions, and inventory totals. Source: `Engine-TS/src/engine/entity/Npc.ts:996-1049`, `Engine-TS/src/engine/entity/Player.ts:821-823`, `Engine-TS/src/engine/entity/Player.ts:2143-2145`. The busy check, for example: `Engine-TS/src/engine/entity/Npc.ts:1006-1008`
    ```ts
    if (hunt.checkNotBusy && player.busy()) {
    continue;
    }
    ```

21. The hunt step only sets `npc.huntTarget`. It runs no script and sets no interaction. Acting on the target happens in `Npc.turn()` (phase 4): non-player hunts run there (`Engine-TS/src/engine/entity/Npc.ts:158-170`), then `consumeHuntTarget()` runs before regen, timers, queue and movement/interaction. Source: `Engine-TS/src/engine/entity/Npc.ts:172-181`
    ```ts
    // Set target from hunt
    this.consumeHuntTarget();
    // Regen
    this.processRegen();
    ```
    `consumeHuntTarget` either runs an `ai_queueN` script directly or calls `setInteraction(Interaction.SCRIPT, huntTarget, findNewMode)`, then clears `huntTarget`, resets `huntClock` and, unless `findKeepHunting`, sets `huntMode = -1`. Source: `Engine-TS/src/engine/entity/Npc.ts:962-993`. `turn()` returns before that if the NPC is not valid; `Npc.isValid()` is false while `delayed`. Source: `Engine-TS/src/engine/entity/Npc.ts:153-155`, `Engine-TS/src/engine/entity/Npc.ts:382-387`

### Dependence on player state and client input

22. `processWorld` runs before `processClientsIn` (Position section), so in tick T it sees player state as left by tick T-1 (phase 11 cleanup was not read for this note), before any of tick T's client packets are read. Player state read directly by this phase: zone membership and position, `loggingOut`, `visibility`, `delayed`, open modals, `lastAfkZone`, `combatLevel`, wilderness/multi status, varps, inventories (rules 19-20), and the observer counts from tick T-1's phase 10 (rule 17). World-queue and delayed-obj steps may also act on players through the resumed scripts and `addObj` receivers.

### State this phase writes (for the ordering matrix)

23. Written: `World.queue` (unlink; tail appends), `player.activeScript` / `npc.activeScript` (rule 7), `World.objDelayedQueue` (unlink), zones and objs via `addObj` (zone contents, tracked zones, obj `lifecycleTick`, `receiver64`, `reveal`) (rule 13), `npc.huntTarget` (rule 18), `cycleStats[WorldStat.WORLD]` (`Engine-TS/src/engine/World.ts:594`), plus anything the resumed RuneScript does (not enumerable from engine code).

## Comment-versus-code check

- `cycle()` comment "world processing - world queue - npc hunt" (`Engine-TS/src/engine/World.ts:345-347`) vs body: **incomplete**. The body has a third step, the delayed-obj queue (`Engine-TS/src/engine/World.ts:563-575`), which neither the `cycle()` comment nor the header comment mentions. "npc hunt" is also narrower in the code: only hunts of type `PLAYER` happen here; NPC/obj/loc hunts happen in `Npc.turn()` (phase 4).
- Header comment above `processWorld` "- world queue - npc hunt" (`Engine-TS/src/engine/World.ts:529-530`): same omission of delayed objs.
- "remove from queue no matter what, re-adds if necessary" (`Engine-TS/src/engine/World.ts:545`): **matches**. Unlink is unconditional after `execute`; a new entry is added only for `WORLD_SUSPENDED`.
- "suspend to player (probably not needed)" / "suspend to npc (probably not needed)" (`Engine-TS/src/engine/World.ts:549`, `Engine-TS/src/engine/World.ts:552`): the code does make the assignment. "Probably not needed" is the author's opinion and cannot be checked from the code read.
- "- add objs delayed" (`Engine-TS/src/engine/World.ts:563`): matches.
- "- npc hunt players if not busy" (`Engine-TS/src/engine/World.ts:577`): **partly mismatched**. "players" matches (only `PLAYER` hunts). "if not busy" is not a check in `processWorld`: the NPC is not checked for delay/busy (and the next comment says so), and the player `busy()` check only applies when the hunt config has `checkNotBusy` (`Engine-TS/src/engine/entity/Npc.ts:1006`).
- "Check if npc is alive" (`Engine-TS/src/engine/World.ts:580`): matches (`isActive`).
- "Hunts will process even if the npc is delayed during this portion" (`Engine-TS/src/engine/World.ts:582`): matches; only `isActive` is checked, not `delayed` / `isValid()`.
- `huntAll` comments "If a huntrate is defined, this acts as a throttle", "If no hunt, just return", "Pick randomly from the hunted entities" (`Engine-TS/src/engine/entity/Npc.ts:261`, `Engine-TS/src/engine/entity/Npc.ts:266`, `Engine-TS/src/engine/entity/Npc.ts:282`): match.
- `HuntIterator` "a radius of 1 will loop 9 zones ... 2 ... 25 ... 3 ... 49" (`Engine-TS/src/engine/script/ScriptIterators.ts:37-39`): matches the `(2r+1)^2` zone loop at `Engine-TS/src/engine/script/ScriptIterators.ts:73-75`.
- `addObj` "objs with a receiver always attempt to reveal 100 ticks after being dropped" (`Engine-TS/src/engine/World.ts:1487`): the code sets `obj.reveal = Obj.REVEAL` (100). Whether reveal actually happens after 100 ticks is answered in [`08-zones.md`](08-zones.md) (rules 8-10 and its comment-versus-code item on this comment; read, not observed): the countdown runs in phase 8 only while the obj has a lifecycle timer, starts with the drop tick's phase 8, is not restarted by a stack merge, and a reveal is skipped for untradeable or members-on-f2p objs.
- Content `world_delay` comments: `quest_legends.rs2` says `world_delay(49); // 51t (something is wrong with world delay lol)` (`Content/scripts/quests/quest_legends/scripts/quest_legends.rs2:1159`), consistent with the d+2 reading (inference below). `necromancer_tower.rs2` says `world_delay(1); // delay spawn by 2 ticks` (`Content/scripts/areas/area_ardougne_east/scripts/necromancer_tower.rs2:61`), which does **not** match d+2 = 3 if the script was suspended outside phase 1. Neither was observed; see open question.

## Inferences (labelled)

- **Inference: a world-queue script that resumes and then stops in `PAUSEBUTTON` or `COUNTDIALOG` state is likely dropped**: the world queue has no branch for those states and has already unlinked the entry, so nothing holds a reference to the `ScriptState` any more, whereas `Player.executeScript` would store it as the player's `activeScript`. Rests on L3 rules 6 and 7. Not observed; whether content ever does this was not checked (`docs/open-questions.md` #20).

- **Inference: `world_delay(d)` resumes d+2 ticks later** when the script suspended in any phase after phase 1 of tick T (e.g. a player script in phase 5): it is visited in phase 1 of T+1 ... T+d+1 (skipped) and runs in phase 1 of T+d+2. When it re-suspends inside phase 1 and is not the last queue entry, it gets one extra decrement that same pass and resumes d+1 ticks later. Rests on L3 rules 2, 4, 9 and the phase order. The engine adds 1 (rule 2) and also requires the pre-decrement value to reach 0 (rule 4), which together give the extra tick that the content author noticed ("51t").
- **Inference: `inv_dropitem_delayed` with delay d places the obj d+1 ticks later** when called from a script outside phase 1, or d ticks later (same tick for d=0) when called from a world-queue script in phase 1. Rests on rules 10-12.
- **Inference: a player-hunt result found for a delayed NPC is discarded** unless the NPC is undelayed by its next `turn()`: `turn()` returns before `consumeHuntTarget()` while delayed (rule 21), and the next tick's `huntAll` clears `huntTarget` first (rule 18). If `huntAll` is not called next tick (e.g. no observers), the stale target stays. Rests on rules 16, 18, 21.
- **Inference: an NPC whose observer count is 0 never player-hunts** (rule 16). The count is normally the number of players' NPC-info lists containing it, but it can include disconnected players and can drift ([`09-info.md`](09-info.md) rules 19-21 and Inferences, `docs/open-questions.md` #39). Rests on rules 16-17.
- **Inference: an NPC's player-hunt choice in tick T is based on player state from before tick T's client packets, and the NPC acts on it (phase 4) before players are processed in phase 5 of the same tick.** Rests on rules 21-22 and the phase order in `docs/tick/00-overview.md`.

## Not checked / open questions

- RuneScript VM internals (what `world_delay` resumes into, how `pc` and stacks are kept) were not read beyond `ScriptRunner.execute`'s entry. Subsystem boundary. Also in `docs/open-questions.md` as #15.
- How a player resumes a script handed over with `SUSPENDED` from the world queue (phase 5), and whether missing `protect` matters: answered by reading (not observed) in [`05-players-queues-timers.md`](05-players-queues-timers.md) rules 4-7 and Inferences. Observation still open in `docs/open-questions.md` as #16.
- Zone/obj side of `addObj`: `zone.addObj`, `trackZone`, obj reveal after `Obj.REVEAL` ticks, lifecycle countdown. Answered in [`08-zones.md`](08-zones.md) rules 3-4, 8-10 and 13-15 (read, not observed).
- `HuntType` config fields (`rate`, `checkVis`, `findNewMode`, `findKeepHunting`, etc.) and their values in content were not read. The `CoordGrid.distanceToSW`, `isLineOfSight` and `isLineOfWalk` functions were not read. Also in `docs/open-questions.md` as #18.
- The `world_delay` d+2 timing and the conflicting `necromancer_tower.rs2` comment were not observed by running. Also in `docs/open-questions.md` as #19.
- Whether any engine path other than `INV_DROPITEM_DELAYED` writes `objDelayedQueue` was checked only by grep for `objDelayedQueue` in `Engine-TS/src`. `docs/open-questions.md` #52.

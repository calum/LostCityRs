# Phase 4: `processNpcs` (per-NPC turn pipeline)

**Question answered:** What does the fourth phase of a game tick do for each NPC, in what order, what exactly "if npc is not busy" means in code, how delays, the NPC queue, timers and regen count ticks, what happens when an NPC is added, removed or throws during the loop, and which NPC state later phases (especially `processPlayers`) see?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

Related notes: [`04b-npc-modes.md`](04b-npc-modes.md) (the last big step of the turn: NPC modes, target validation, NPC-initiated interaction, the movement step and facing), [`01-world.md`](01-world.md) (player hunts set `huntTarget` in phase 1; `LinkList` and `EntityList` iteration rules; `ScriptRunner.execute` error handling), [`03-npc-event-queue.md`](03-npc-event-queue.md) (the lifecycle block at the top of `Npc.turn()`: respawn, revert, despawn and the despawn trigger; `npc_delay`; crash removals that skip `AI_DESPAWN`). Facts reused from them were re-checked at the same Engine-TS commit and are re-cited here.

## Position in the tick

`processNpcs()` is the fourth call in `World.cycle()`, after `processNpcEventQueue()` (phase 3) and before `processPlayers()` (phase 5). Nothing runs between it and `processPlayers()` except comments. Source: `Engine-TS/src/engine/World.ts:357-378`
```ts
            this.processNpcEventQueue();

            // npc processing (if npc is not busy)
            // - resume suspended script
            // - stat regen
            // - timer
            // - queue
            // - movement
            // - modes
            this.processNpcs();
            // ...
            // player processing
            // ...
            this.processPlayers();
```

## L2: ordered sub-steps

`processNpcs` itself (`Engine-TS/src/engine/World.ts:665-676`):

1. Record a start time.
2. For each NPC in `World.npcs` (ascending nid, L3 rule 1), call `npc.turn()` inside a `try`; on any exception, log it and call `World.removeNpc(npc, 0)`, then continue with the next NPC (L3 rule 3).
3. Store elapsed ms in `cycleStats[WorldStat.NPC]`.

`Npc.turn()` for one NPC (`Engine-TS/src/engine/entity/Npc.ts:109-192`), in this exact order:

1. **Undelay and resume** (only if `isActive`): clear `delayed` if `currentTick >= delayedUntil`; then if not delayed and `activeScript.execution === NPC_SUSPENDED`, resume it with `executeScript`. Source: `Engine-TS/src/engine/entity/Npc.ts:110-118`
2. **Lifecycle events** (only if not delayed; runs for inactive NPCs too): decrement `lifecycleTick`; at 0, respawn / revert / despawn. Covered in [`03-npc-event-queue.md`](03-npc-event-queue.md) rules 4-5. Source: `Engine-TS/src/engine/entity/Npc.ts:120-150`
3. **Validity gate**: `if (!this.isValid()) return;` (L3 rule 4). Source: `Engine-TS/src/engine/entity/Npc.ts:152-155`
4. **Hunt (non-player types) and `huntClock++`**. Source: `Engine-TS/src/engine/entity/Npc.ts:157-170`
5. **Consume hunt target** (`consumeHuntTarget`). Source: `Engine-TS/src/engine/entity/Npc.ts:172-173`
6. **Regen** (`processRegen`). Source: `Engine-TS/src/engine/entity/Npc.ts:174-175`
7. **Timer** (`processTimers`, the `ai_timer` trigger). Source: `Engine-TS/src/engine/entity/Npc.ts:176-177`
8. **Queue** (`processQueue`, `ai_queueN` triggers). Source: `Engine-TS/src/engine/entity/Npc.ts:178-179`
9. **Mode, interaction and movement** (`processMovementInteraction`; see [`04b-npc-modes.md`](04b-npc-modes.md)). Source: `Engine-TS/src/engine/entity/Npc.ts:180-181`
10. **Facing and jump check**: `reorientEntity()`, `reorient()`, `setFaceEntity()`, `validateDistanceWalked()` (see [`04b-npc-modes.md`](04b-npc-modes.md) rule 17). Source: `Engine-TS/src/engine/entity/Npc.ts:182-191`

## L3: ordering rules

### Which NPCs, in what order

1. **List and order.** `World.npcs` is an `NpcList` of size `World.NPCS` (`Environment.runtime.maxNpcs`). Source: `Engine-TS/src/engine/World.ts:118`, `Engine-TS/src/engine/World.ts:150`. Iteration is by ascending nid: `ids` is indexed by nid and each value is a storage slot taken from the `free` set (`set` does `this.ids[id] = index; this[index] = entity`, `Engine-TS/src/engine/entity/EntityList.ts:71-74`); the iterator walks `ids` in nid order, skips `-1`, and yields the entity in the stored slot, skipping `undefined` (see [`01-world.md`](01-world.md) rule 15). Source: `Engine-TS/src/engine/entity/EntityList.ts:36-47`
   ```ts
   *[Symbol.iterator](): ArrayIterator<T> {
   for (const index of this.ids) {
   if (index === -1) {
   continue;
   }
   ```
   NPCs enter the list only in `World.addNpc` with `firstSpawn` (`Engine-TS/src/engine/World.ts:1269-1273`) and leave it only in `World.removeNpc` for `DESPAWN`-lifecycle NPCs (`Engine-TS/src/engine/World.ts:1327-1330`). A removed `RESPAWN` NPC stays in the list, inactive (`Engine-TS/src/engine/World.ts:1331-1333`), so its `turn()` still runs every tick; that is how the respawn countdown in step 2 advances.

2. **Adding and removing during the loop.** `EntityList.set` writes `ids[nid]` and `remove` writes `ids[nid] = -1` and deletes the slot (`Engine-TS/src/engine/entity/EntityList.ts:62-89`). New nids come from `World.getNextNid()` = `npcs.next()`, which returns the first free id after `lastUsedIndex`, wrapping to 0 (`Engine-TS/src/engine/World.ts:1757-1758`, `Engine-TS/src/engine/entity/EntityList.ts:21-34`). The loop in `processNpcs` holds the current `npc` in a local, so an NPC removing itself does not affect its own remaining `turn()` (it continues with `isActive = false`; rules 5 and 14). Whether the `for...of` over the `Int32Array` sees writes made after the loop started is JavaScript typed-array iterator behaviour, not engine code (see Inferences).

### Exceptions

3. **One NPC's exception removes that NPC and the loop carries on.** Source: `Engine-TS/src/engine/World.ts:665-676`
   ```ts
   private processNpcs(): void {
   const start: number = Date.now();
   for (const npc of this.npcs) {
   try {
   npc.turn();
   } catch (err) {
   console.error(err);
   this.removeNpc(npc, 0);
   }
   }
   this.cycleStats[WorldStat.NPC] = Date.now() - start;
   ```
   Script errors inside the interpreter do not reach this `catch`: `ScriptRunner.execute` catches them and returns `ABORTED`, and in production also calls `World.removeNpc(self, 0)` for an NPC `self` (`Engine-TS/src/engine/script/ScriptRunner.ts:207-212`, `Engine-TS/src/engine/script/ScriptRunner.ts:228-231`). What does reach it are throws from engine code in `turn()`, for example:
   - the per-mode type checks such as `throw new Error('[Npc] Target must be a Player for playerescape mode.')` (`Engine-TS/src/engine/entity/Npc.ts:784-786`, also `Engine-TS/src/engine/entity/Npc.ts:879-881`, `Engine-TS/src/engine/entity/Npc.ts:891-893`, `Engine-TS/src/engine/entity/Npc.ts:897-899`);
   - `Npc.executeScript`'s routing after `execute` returns: a script that stops in a state other than finished/aborted/world/NPC-suspended evaluates `script.activePlayer` (`Engine-TS/src/engine/entity/Npc.ts:232-233`), whose getter throws when the chosen active player is null (`Engine-TS/src/engine/script/ScriptState.ts:185-191`). NPC trigger scripts started by `turn()` with `ScriptRunner.init(script, this)` have no active player unless they set one or were started with a player target (`Engine-TS/src/engine/script/ScriptRunner.ts:66-91`).

   Effect of `removeNpc(npc, 0)` (`Engine-TS/src/engine/World.ts:1307-1334`): it returns at once if the NPC is already inactive. A `DESPAWN` NPC is removed from rsbuf and `World.npcs` and `cleanup()`ed, with no `AI_DESPAWN` trigger ([`03-npc-event-queue.md`](03-npc-event-queue.md) rule 6). A `RESPAWN` NPC gets `setLifeCycle(scaleByPlayerCount(0))`; `scaleByPlayerCount(0)` is `0` (`Engine-TS/src/engine/World.ts:1731-1735`) and `setLifeCycle` stores `Math.max(1, tick)` (`Engine-TS/src/engine/entity/Entity.ts:36-43`), so `lifecycleTick = 1` and the next `turn()` decrements it to 0 and respawns the NPC (`Engine-TS/src/engine/entity/Npc.ts:121-127`), **provided the NPC is not delayed**. `removeNpc` does not clear `delayed` for a `RESPAWN` NPC (`Engine-TS/src/engine/World.ts:1331-1333`), `turn()` clears it only inside `if (this.isActive)` (`Engine-TS/src/engine/entity/Npc.ts:111-112`), and the countdown is gated on `!this.delayed` (`Engine-TS/src/engine/entity/Npc.ts:121`). So a `RESPAWN` NPC that throws while delayed (e.g. its script called `npc_delay` and then a later step threw) stays inactive and delayed and, by this reading, never respawns; see [`03-npc-event-queue.md`](03-npc-event-queue.md) Inferences and `docs/open-questions.md` #26. The lifecycle block has its own `try`/`catch` (`Engine-TS/src/engine/entity/Npc.ts:143-149`, see 03). An exception thrown by `removeNpc` inside this `catch` would leave `processNpcs` and reach `cycle()`'s `catch` (`Engine-TS/src/engine/World.ts:509-526`), which logs the error, removes every player and calls `process.exit(1)`; not analysed whether that can happen.

### The "not busy" gate

4. **"Not busy" for an NPC is `Npc.isValid()`: active and not delayed.** NPCs have no `busy()` method (grep of `Engine-TS/src/engine/entity/Npc.ts` for `busy` finds only the player check at line 1006; `PathingEntity.ts` and `Entity.ts`, read in full, have none). Source: `Engine-TS/src/engine/entity/Npc.ts:382-387`
   ```ts
   isValid(_hash64?: bigint): boolean {
   if (this.delayed) {
   return false;
   }
   return super.isValid();
   ```
   `Entity.isValid` returns `this.isActive` (`Engine-TS/src/engine/entity/Entity.ts:32-34`). The gate is applied once, after steps 1 and 2. Source: `Engine-TS/src/engine/entity/Npc.ts:152-155`
   ```ts
   // Checks if Npc is alive and not delayed
   if (!this.isValid()) {
   return;
   }
   ```
   So it gates steps 4-10 (hunt, `huntClock`, consume hunt target, regen, timer, queue, mode/movement, facing). Step 1 has its own gates (`isActive`, then `!delayed`), and step 2 is gated by `!delayed` only, so it runs for inactive NPCs (`Engine-TS/src/engine/entity/Npc.ts:111-121`). For comparison, a player's `busy()` is `delayed || containsModalInterface()` (`Engine-TS/src/engine/entity/Player.ts:821-823`); NPCs have no modal state.

5. **Becoming delayed or inactive in the middle of a turn.** The gate in rule 4 is checked once. A script run in step 5, 7 or 8 can set `delayed` (`npc_delay`, `npc_arrivedelay`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:557-570`) or remove the NPC (`npc_del`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:93-95`). The later steps re-check only partly:
   - `processRegen` and `processTimers` have no `delayed` or `isActive` check (`Engine-TS/src/engine/entity/Npc.ts:528-559`).
   - `processQueue` returns if `!isActive` at its start, and checks `!this.delayed` per entry (`Engine-TS/src/engine/entity/Npc.ts:561-583`).
   - `processMovementInteraction` returns if `delayed || !isActive` (`Engine-TS/src/engine/entity/Npc.ts:585-588`).
   - The facing calls and `validateDistanceWalked` run unconditionally (`Engine-TS/src/engine/entity/Npc.ts:186-191`).

### Delay and resume

6. **When `delayed` clears and the script resumes.** Source: `Engine-TS/src/engine/entity/Npc.ts:110-118`
   ```ts
   // Continue npc_delay'd script
   if (this.isActive) {
   if (this.delayed && World.currentTick >= this.delayedUntil) this.delayed = false;
   // Resume suspended script
   if (!this.delayed && this.activeScript && this.activeScript.execution === ScriptState.NPC_SUSPENDED) {
   this.executeScript(this.activeScript);
   }
   }
   ```
   `npc_delay(n)` sets `delayed = true`, `delayedUntil = currentTick + 1 + n` and suspends with `NPC_SUSPENDED` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101`). `World.currentTick` is incremented once per cycle, after phase 11 (`Engine-TS/src/engine/World.ts:503`). Besides this line, `delayed` is cleared only by `resetEntity(true)` and `cleanup()` (`Engine-TS/src/engine/entity/Npc.ts:304`, `Engine-TS/src/engine/entity/Npc.ts:198`; see [`03-npc-event-queue.md`](03-npc-event-queue.md) rule 11). After the resume, if the script did not delay again, the rest of the turn (steps 2-10) runs in the same tick.

7. **Whose script is resumed.** `executeScript` stores an `NPC_SUSPENDED` script on `script.activeNpc.activeScript` (`Engine-TS/src/engine/entity/Npc.ts:225-237`), and `Player.executeScript` does the same (`Engine-TS/src/engine/entity/Player.ts:2214-2215`). So a **player's** script that calls `npc_delay` on its `active_npc` is resumed inside that NPC's phase-4 turn, not in phase 5. When a resumed script finishes or aborts, `executeScript` clears `activeScript` only if it is the same object (`Engine-TS/src/engine/entity/Npc.ts:235-237`). If it stops in a player-suspended state, it is handed to `script.activePlayer.activeScript` (`Engine-TS/src/engine/entity/Npc.ts:232-233`) while the NPC's `activeScript` still points at it, with an execution state other than `NPC_SUSPENDED`, so step 1 does not resume it again.

8. **Delayed NPCs do not advance their counters.** Because of rule 4, while `delayed` is true the NPC's `huntClock`, regen clock, timer clock and queue delays do not change, and the lifecycle countdown does not decrement either (`!this.delayed &&` at `Engine-TS/src/engine/entity/Npc.ts:121`). An inactive NPC (respawn pending) also skips steps 4-10; its lifecycle countdown decrements only if it is not delayed. Because `delayed` is cleared by time only inside `if (this.isActive)` (`Engine-TS/src/engine/entity/Npc.ts:111-112`) and `removeNpc` does not clear it for `RESPAWN` NPCs (`Engine-TS/src/engine/World.ts:1331-1333`), an NPC removed while delayed never clears it and, by this reading, never respawns ([`03-npc-event-queue.md`](03-npc-event-queue.md) Inferences, `docs/open-questions.md` #26).

### Hunt (steps 4-5)

9. **Non-player hunts run here; player hunts ran in phase 1.** If `huntMode !== -1` and `hunt.nobodyNear !== PAUSEHUNT || observers > 0 || hunt.type === PLAYER`, a non-`PLAYER` hunt calls `huntAll` here, and `huntClock` is incremented after it. Source: `Engine-TS/src/engine/entity/Npc.ts:157-170`
   ```ts
   if (this.huntMode !== -1) {
   const hunt = HuntType.get(this.huntMode);
   if (hunt.nobodyNear !== HuntNobodyNear.PAUSEHUNT || rsbuf.getNpcObservers(this.nid) > 0 || hunt.type === HuntModeType.PLAYER) {
   // - hunt npc/obj/loc
   if (hunt && hunt.type !== HuntModeType.PLAYER) {
   this.huntAll(hunt);
   }
   // Increment huntclock
   this.huntClock++;
   ```
   `huntAll` and its throttle are described in [`01-world.md`](01-world.md) rule 18. `HuntType.get(id)` is a plain array lookup (`Engine-TS/src/cache/config/HuntType.ts:41-43`); `hunt.nobodyNear` is read before the `hunt &&` check, so that check cannot prevent a `TypeError` for an id with no config (it would be caught by rule 3). `huntMode` is set only from the NPC type, `-1`, or a validated id (`Engine-TS/src/engine/script/handlers/NpcOps.ts:193-202`), so this is not expected to happen; not checked further.

10. **Consuming the hunt target.** Source: `Engine-TS/src/engine/entity/Npc.ts:962-994`. If `huntTarget` is set and the hunt type is not `OFF`:
    - if `findNewMode` is a `QUEUE1..QUEUE20` mode, the matching `ai_queueN` script is run **immediately** with `ScriptRunner.init(script, this, null, null)` and `ScriptRunner.execute`, whose returned state is ignored (`Engine-TS/src/engine/entity/Npc.ts:971-978`). No target pointer is set, so the hunted entity is not the script's active player/npc. This is not the NPC queue (`npc_queue`); it bypasses `processQueue`.
    - otherwise `setInteraction(Interaction.SCRIPT, huntTarget, findNewMode)` (`Engine-TS/src/engine/entity/Npc.ts:979-982`). Its boolean result is ignored; `setInteraction` returns `false` without changing anything if `!target.isValid(...)` (`Engine-TS/src/engine/entity/PathingEntity.ts:534-537`).

    Either way it then sets `huntTarget = null`, `huntClock = 0`, and, unless `findKeepHunting`, `huntMode = -1` (`Engine-TS/src/engine/entity/Npc.ts:984-993`). `huntMode` is restored from the NPC type only by `resetDefaults()` (`Engine-TS/src/engine/entity/Npc.ts:429-441`), `resetEntity(true)` (`Engine-TS/src/engine/entity/Npc.ts:321-323`) or `npc_sethuntmode` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:193-202`). `npc_setmode` with `NONE`/`WANDER`/`PATROL` calls only `clearInteraction()` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:209-215`), which does not restore it (`Engine-TS/src/engine/entity/Npc.ts:424-427`).

### Regen (step 6)

11. **Regen fires when the pre-incremented clock reaches the interval, and the interval is reloaded only when it fires.** Source: `Engine-TS/src/engine/entity/Npc.ts:528-548`
    ```ts
    private processRegen() {
    if (++this.regenClock >= this.regenInterval) {
    // ...
    const type = NpcType.get(this.type);
    this.regenInterval = type.regenrate;
    this.regenClock = 0;
    ```
    Each firing moves every stat one point toward its base level (up if below, down if above) (`Engine-TS/src/engine/entity/Npc.ts:537-546`). `regenInterval` starts at 0 (`Engine-TS/src/engine/entity/Npc.ts:62-63`), so the first valid turn after construction regens at once and loads `regenrate` (default 100, `Engine-TS/src/cache/config/NpcType.ts:99`). Afterwards it fires every `regenrate` valid turns (clock counts 1..`regenrate`). `resetEntity(true)` and `resetDefaults()` do not touch `regenClock`/`regenInterval` (`Engine-TS/src/engine/entity/Npc.ts:289-329`, `Engine-TS/src/engine/entity/Npc.ts:429-441`).

### Timer (step 7)

12. **`ai_timer` fires when the clock, incremented only while the interval is positive, reaches the interval; the clock is reset after the script, and only if a script exists.** Source: `Engine-TS/src/engine/entity/Npc.ts:550-559`
    ```ts
    private processTimers() {
    if (this.timerInterval > 0 && ++this.timerClock >= this.timerInterval) {
    const type = NpcType.get(this.type);
    const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, type.id, type.category);
    if (script) {
    this.executeScript(ScriptRunner.init(script, this));
    this.timerClock = 0;
    ```
    The interval comes from the NPC type: the constructor calls `setTimer(npcType.timer)`, and `setTimer` ignores `-1` (`Engine-TS/src/engine/entity/Npc.ts:95`, `Engine-TS/src/engine/entity/Npc.ts:219-223`); the type default is `timer = -1` (`Engine-TS/src/cache/config/NpcType.ts:104`), so by default the interval stays 0 and the timer never fires. `npc_settimer` calls `setTimer` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:293-295`). `resetDefaults()` assigns `timerInterval = type.timer` directly (`Engine-TS/src/engine/entity/Npc.ts:439-440`), so it **reverts any `npc_settimer` value** (and can set -1, which also disables the timer). `timerClock` is not reset by `resetDefaults` or `resetEntity(true)`.

### Queue (step 8)

13. **`npc_queue` entries: FIFO, raw delay, decremented before the check, only while not delayed.** `npc_queue(id, arg, delay)` appends a request for trigger `AI_QUEUE1 + id - 1` with the given `delay` (no `+1`) (`Engine-TS/src/engine/script/handlers/NpcOps.ts:159-165`, `Engine-TS/src/engine/entity/Npc.ts:250-254`). Source: `Engine-TS/src/engine/entity/Npc.ts:561-583`
    ```ts
    private processQueue() {
    if (!this.isActive) {
    return;
    }
    for (const request of this.queue.all()) {
    // purposely only decrements the delay when the npc is not delayed
    if (!this.delayed) {
    request.delay--;
    }
    if (!this.delayed && request.delay <= 0) {
    request.unlink();
    const type: NpcType = NpcType.get(this.type);
    const script = ScriptProvider.getByTrigger(request.queueId, type.id, type.category);
    if (script) {
    const state = ScriptRunner.init(script, this, null, request.args);
    state.lastInt = request.lastInt;
    this.executeScript(state);
    ```
    There is one queue per NPC with no strong/weak distinction. The script is looked up when the entry runs, with the NPC's **current** type (so after `npc_changetype` the new type's `ai_queueN` runs). An entry whose script does not resolve is unlinked and dropped silently. Every non-due entry is decremented on every valid turn, even when an earlier entry ran in the same pass. If a script run from this loop delays the NPC, the remaining entries in this pass are neither decremented nor run.

14. **Entries added or removed during the queue loop.** Iteration is `LinkList.all()` (`Engine-TS/src/datastruct/LinkList.ts:97-111`), which saves the cursor (the next node) before yielding and restores it after (see [`01-world.md`](01-world.md) rules 5 and 9). An entry appended by a queue script (`npc_queue` on the same NPC) is visited in the same pass unless the running entry was the last node, and is decremented then. `cleanup()` and `resetEntity(true)` call `queue.clear()` (`Engine-TS/src/engine/entity/Npc.ts:201`, `Engine-TS/src/engine/entity/Npc.ts:302`), which unlinks every node (`Engine-TS/src/datastruct/LinkList.ts:87-95`), and `unlink` sets the node's `next` and `prev` to `null` (`Engine-TS/src/datastruct/Linkable.ts:6-15`). `next()` returns the saved cursor node if it is not the sentinel, then moves the cursor to its `next || null` (`Engine-TS/src/datastruct/LinkList.ts:67-75`). See Inferences for what this means when a queue script removes its own NPC.

### Cross-phase visibility

15. **Phase 4 changes NPC state in place, and phase 5 reads the same objects right after.** Steps update the `Npc` object directly: position (`this.x = this.x + delta[0]`), collision flags and zone membership inside the step (`Engine-TS/src/engine/entity/PathingEntity.ts:226-231`, `Engine-TS/src/engine/entity/PathingEntity.ts:161-189`); `delayed` by scripts (rule 5); `type` by `npc_changetype`. No code copies NPC state between `processNpcs()` and `processPlayers()` (Position section). In phase 5 a player's interaction reads its target's live position (e.g. `this.target.x` in `Engine-TS/src/engine/entity/Player.ts:1072`) and validates the target with `this.target.isValid(this.hash64)` plus a type-change check (`Engine-TS/src/engine/entity/Player.ts:1233-1245`). For an `Npc` target, `isValid` is false while `delayed` (rule 4), and a failed validation clears the player's interaction. Source: `Engine-TS/src/engine/entity/Player.ts:1257-1262`
    ```ts
    if (this.target && this.canAccess()) {
    // Clear the interaction if target validation does not pass
    if (!this.validateTarget()) {
    this.clearInteraction();
    this.unsetMapFlag();
    return;
    ```

16. **Later phases.** Phase 9 (`processInfo`) passes each NPC's `x`, `z`, `tele`, `jump`, `runDir`, `walkDir`, `isActive`, `masks` and facing fields to `rsbuf.computeNpc` (`Engine-TS/src/engine/World.ts:1053-1070`). Phase 11 (`processCleanup`) calls `npc.resetEntity(false)` for every NPC in `World.npcs` (`Engine-TS/src/engine/World.ts:1161-1164`), which for `respawn = false` is `resetPathingEntity()` (`Engine-TS/src/engine/entity/Npc.ts:326-328`): it resets `moveSpeed` to the default, `walkDir`/`runDir` to -1, `jump`/`tele` to false, `lastTickX`/`lastTickZ` to the current position, `stepsTaken` to 0, `masks` to 0 and the per-tick visual fields (`Engine-TS/src/engine/entity/PathingEntity.ts:593-631`). Next tick, phase 1 reads `huntClock`/`huntMode` and the observer count (01 rules 16-18), and phase 3 reads `delayed` and the despawn entries queued in step 2 (03 rules 5, 11).

### State this phase writes (for the ordering matrix)

17. Per NPC: `delayed` (cleared), `activeScript`, `lifecycleTick` and spawn/despawn (adds `npcEventQueue` entries, changes `World.npcs`, rsbuf, zones, collision; see 03), `huntTarget`, `huntClock`, `huntMode`, `target`/`targetOp` (hunt and modes), `levels` (regen), `regenClock`/`regenInterval`, `timerClock`, the NPC queue, waypoints, `x`/`z`/`walkDir`, collision flags and zone membership, `lastMovement`, `stuckCounter`, patrol state, facing fields and `masks`, `jump`/`tele`; `cycleStats[WorldStat.NPC]`; plus anything the NPC scripts do (they can touch players, other NPCs, the world queue, `npcEventQueue` via `npc_add`, and so on).

## Comment-versus-code check

- `cycle()` comment "npc processing (if npc is not busy)" (`Engine-TS/src/engine/World.ts:360`): **imprecise**. There is no `busy()` for NPCs; the gate is `isValid()` = active and not delayed (rule 4), and it applies only after the resume and lifecycle steps. "Not busy" here means "not delayed" (and active), not the player meaning (delayed or modal open).
- `cycle()` list "- resume suspended script - stat regen - timer - queue - movement - modes" (`Engine-TS/src/engine/World.ts:361-366`) and the identical header comment above `processNpcs` (`Engine-TS/src/engine/World.ts:659-664`): **order of the listed items matches, list incomplete, and the last two are fused**. Resume, regen, timer and queue run in that order. Not listed: the lifecycle step (respawn/revert/despawn) between resume and regen, the NPC/obj/loc hunt and hunt-target consumption before regen, and the facing step after movement. "movement" and "modes" are one step (`processMovementInteraction`) in which the mode is chosen first and the mode itself calls the movement (see 04b), so it is "modes, which include movement", not "movement, then modes".
- "Continue npc_delay'd script" (`Engine-TS/src/engine/entity/Npc.ts:110`): **matches**; it also resumes scripts suspended by `npc_arrivedelay` (same `NPC_SUSPENDED` state) and player scripts suspended onto the NPC (rule 7).
- "Checks if Npc is alive and not delayed" (`Engine-TS/src/engine/entity/Npc.ts:152`): **matches** (rule 4).
- "Process partial hunt logic", "- hunt npc/obj/loc", "Increment huntclock" (`Engine-TS/src/engine/entity/Npc.ts:157`, `Engine-TS/src/engine/entity/Npc.ts:162`, `Engine-TS/src/engine/entity/Npc.ts:167`): **match**.
- "Set target from hunt" / "Regen" / "Timer" / "Queue" / "Movement-Interactions" (`Engine-TS/src/engine/entity/Npc.ts:172-180`): **match** the calls below them.
- "Dev note: Is this necessary?" (`Engine-TS/src/engine/entity/Npc.ts:190`): a question, not checkable from code.
- "Findnewmode runs a Queue trigger rather than setting the interaction" (`Engine-TS/src/engine/entity/Npc.ts:970`): **matches** (rule 10).
- "Once an npc finds a huntTarget, it will no longer hunt until its interactions are cleared" (`Engine-TS/src/engine/entity/Npc.ts:989`): **partly**. Hunting resumes when `resetDefaults()` (or a respawn, or `npc_sethuntmode`) runs, not whenever the interaction is cleared: `clearInteraction()` alone, e.g. from `npc_setmode` with `NONE`/`WANDER`/`PATROL`, does not restore `huntMode` (rule 10).
- `processRegen` "Every time we regen, let's reload regen interval from NPC type ... the regenrate doesn't update until a regen happens" (`Engine-TS/src/engine/entity/Npc.ts:530-532`): **matches** (rule 11). The OSRS comparison in the comment cannot be checked from code.
- `processQueue` "purposely only decrements the delay when the npc is not delayed" (`Engine-TS/src/engine/entity/Npc.ts:567`): **matches** (rule 13); since `turn()` returns early while delayed, the check only matters when the NPC becomes delayed during the loop.
- `processNpcEventQueue`-related comments in the lifecycle block (`Engine-TS/src/engine/entity/Npc.ts:120-145`) are checked in [`03-npc-event-queue.md`](03-npc-event-queue.md).

## Inferences (labelled)

- **Inference: `npc_delay(n)` called in tick T resumes in phase 4 of tick T+1+n, whichever phase called it.** `delayedUntil = T+1+n` (rule 6); the only line that clears `delayed` by time runs at the start of the NPC's turn, once per tick in phase 4, and checks `currentTick >= delayedUntil`; `currentTick` increases by one per cycle. A call in phases 1-3 of tick T or earlier in phase 4 of T still waits, because `T >= T+1+n` is false. So `npc_delay(0)` is a one-tick delay. Rests on rules 6 and 8. Not observed.
- **Inference: queue timing.** An `npc_queue` entry with delay d that is added in tick T **before** this NPC's step 8 (phases 1-3, earlier NPC turns, or steps 1-7 of its own turn) runs in tick T + max(0, d-1); one added **after** (later in phase 4 after its step 8, or phases 5-11) runs in tick T + max(1, d). So delays 0 and 1 behave the same. Both assume the NPC stays valid; each delayed or inactive tick postpones it by one. Rests on rule 13 and the phase order. Not observed.
- **Inference: a timer with interval n fires on every nth valid turn**, counting from the last firing (clock reset after the script, rule 12), and the first firing after construction is on the nth valid turn. Rests on rule 12.
- **Inference: NPCs added during phase 4 are turned in the same pass only if their nid is higher than the current NPC's nid**, and a `DESPAWN` NPC removed by a lower-nid NPC's script in this pass is skipped (`ids[nid]` is `-1`). This assumes the typed-array iterator reads the current element value at each step (JavaScript semantics, not engine code), as [`03-npc-event-queue.md`](03-npc-event-queue.md) also assumes. Because `npcs.next()` searches upward from `lastUsedIndex + 1` (rule 2), a newly added NPC usually gets a higher nid than existing ones until ids wrap. Rests on rules 1-2.
- **Inference: a removed NPC can still run queue scripts in the pass that removed it.** If a queue script removes a `RESPAWN` NPC (`npc_del`), `removeNpc` does not clear its queue (`Engine-TS/src/engine/World.ts:1331-1333`) and `processQueue` checks `isActive` only at its start, so the remaining due entries in this pass still run with `self` = the now inactive NPC. If it removes a `DESPAWN` NPC, `cleanup()` clears the queue and `delayed`, but if the running entry was not the last node, the node already saved as the cursor is still returned once by `next()`, decremented and, if due, run on the removed NPC; then the loop ends. If the running entry was the last node, the saved cursor is the sentinel and `next()` returns `null` (`Engine-TS/src/datastruct/LinkList.ts:67-72`), so nothing more runs. Rests on rules 13-14 and `Engine-TS/src/engine/World.ts:1327-1330`. Whether content does this was not checked.
- **Inference: a suspension inside the hunt `findNewMode` queue script is lost.** Its returned state is ignored (rule 10), so an `npc_delay` there sets `delayed` but the script is never stored as `activeScript` and never resumes; the NPC just stays delayed until `delayedUntil`. The same applies to the walk trigger ([`04b-npc-modes.md`](04b-npc-modes.md) rule 15). Rests on rules 6 and 10.
- **Inference: an NPC can permanently stop hunting if its hunted target becomes invalid before phase 4.** If `setInteraction` fails in `consumeHuntTarget` (target not valid; for a player: logging out or not `DEFAULT` visibility, `Engine-TS/src/engine/entity/Player.ts:2293-2303`), `targetOp` is left unchanged and, unless `findKeepHunting`, `huntMode` becomes -1. If the NPC is in a targetless mode (e.g. its default `WANDER`), nothing calls `resetDefaults()` (04b rule 4 only does so for targeted modes), so `huntMode` stays -1 until a respawn, a revert with `resetOnRevert` (`revertType` -> `removeNpc` -> `addNpc` -> `resetEntity(true)`, `Engine-TS/src/engine/entity/Npc.ts:1159-1162`), or a script resets it. For a player hunt the window is between phase 1 (choice) and phase 4 (consume) of the same tick. Rests on rules 9-10. Not observed; `docs/open-questions.md` #27.
- **Inference: in phase 5, players see NPCs where they are after this tick's NPC movement, and NPCs in phase 4 see players where they were before this tick's player movement** (players step in phase 5, `Engine-TS/src/engine/World.ts:715-717`, see [`../flows/move-opclick.md`](../flows/move-opclick.md)). For example, a player whose target NPC calls `npc_delay` in phase 4 has the interaction cleared in phase 5 of the same tick (rule 15), but only if the player passes `canAccess()` that tick: the validation sits inside `if (this.target && this.canAccess())` (`Engine-TS/src/engine/entity/Player.ts:1257`) and `canAccess()` is `!this.protect && !this.busy()` outside shutdown (`Engine-TS/src/engine/entity/Player.ts:825-832`), so a protected, delayed or modal player keeps the target that tick; and an NPC chasing a player paths to the player's position from the end of the previous tick (plus anything phases 1-3 changed). Rests on rules 15-16 and the phase order.
- **Inference: NPCs move in nid order against a collision map that is updated after each step**, so a lower-nid NPC's new tile is already blocked when a higher-nid NPC steps, while the tile a higher-nid NPC will vacate is still blocked when a lower-nid NPC steps. Rests on rules 1 and 15; `canTravel` itself was not read (`docs/open-questions.md` #4).

## Not checked / open questions

- RuneScript VM internals (what NPC scripts do; how `npc_delay`'s `NPC_SUSPENDED` state is resumed inside `execute`). Boundary; `docs/open-questions.md` #15.
- `HuntType` config decoding and content values (`findNewMode`, `findKeepHunting`, `nobodyNear`). `docs/open-questions.md` #18.
- Whether the hunt-loss path in the Inferences can happen in practice. `docs/open-questions.md` #27.
- NPC type values in content (`regenrate`, `timer`, `defaultmode`, etc.): only the engine defaults were read. `docs/open-questions.md` #28.
- Whether any NPC script in content removes its own NPC from inside an `ai_queue` script, which the queue-removal inference depends on. `docs/open-questions.md` #28.
- JavaScript typed-array iterator semantics for adds/removes during the `processNpcs` loop were not tested. `docs/open-questions.md` #48.
- Exceptions thrown inside `processNpcs`' own `catch` (`removeNpc`) were not analysed. `docs/open-questions.md` #49.
- Nothing was run; no tick timing here was observed.

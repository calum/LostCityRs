# Phase 3: `processNpcEventQueue` (NPC spawn and despawn triggers)

**Question answered:** What does the third phase of a game tick do: what the NPC event queue holds, who adds to it and in which phase, what runs for each entry, whether entries added during this phase run on the same tick, and whether an NPC spawned here gets its NPC turn (phase 4) on the same tick?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only the three `ai_spawn`/`ai_despawn` scripts found by grep were read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

Related notes: [`01-world.md`](01-world.md) (the same `LinkList` iteration rules, `ScriptRunner.execute` error handling, NPC observer counts) and [`02-clients-in.md`](02-clients-in.md) (scripts and the `::npcadd` cheat run during phase 2). Facts reused from them were re-checked at the same Engine-TS commit and are re-cited here.

## Position in the tick

`processNpcEventQueue()` is the third call in `World.cycle()`, after `processClientsIn()` (phase 2) and before `processNpcs()` (phase 4). Source: `Engine-TS/src/engine/World.ts:355-367`
```ts
            this.processClientsIn();

            // Spawn triggers, despawn triggers
            this.processNpcEventQueue();

            // npc processing (if npc is not busy)
            // ...
            this.processNpcs();
```

Unlike phases 1, 2 and 4, it records no timing: the function body has no `Date.now()` and no `cycleStats` write (`Engine-TS/src/engine/World.ts:648-657`), and `WorldStat` has no entry for it (`Engine-TS/src/engine/WorldStat.ts:1-14`).

## L2: ordered sub-steps

1. Walk `World.npcEventQueue` head to tail. For each entry: if the entry's NPC is **not** `delayed`, unlink the entry, create a fresh `ScriptState` for the entry's script with the NPC as `self`, and run it with `npc.executeScript(state)`. If the NPC **is** delayed, leave the entry where it is. Source: `Engine-TS/src/engine/World.ts:648-657`
   ```ts
       private processNpcEventQueue(): void {
           for (const request of this.npcEventQueue.all()) {
               const npc = request.npc;
               if (!npc.delayed) {
                   request.unlink();
                   const state = ScriptRunner.init(request.script, npc);
                   npc.executeScript(state);
               }
           }
       }
   ```

That is the whole phase. There is no `try`/`catch` around the loop or around each entry (L3 rule 12).

## L3: ordering rules

### What the queue holds

1. `World.npcEventQueue` is a `LinkList<NpcEventRequest>`. Source: `Engine-TS/src/engine/World.ts:156`
   ```ts
   readonly npcEventQueue: LinkList<NpcEventRequest> = new LinkList();
   ```
   An `NpcEventRequest` holds a `type` (`SPAWN` or `DESPAWN`), the `ScriptFile` to run and the `Npc`. Source: `Engine-TS/src/engine/entity/NpcEventRequest.ts:5-32`. The `type` field is written by the constructor but never read: grep of `Engine-TS/src` for `NpcEventType.` finds only the two constructor calls (`Engine-TS/src/engine/World.ts:1299`, `Engine-TS/src/engine/entity/Npc.ts:140`), and `processNpcEventQueue` reads only `request.npc` and `request.script`. So spawn and despawn entries are handled identically.

2. The entry stores an already resolved script, not a trigger. The script is looked up when the entry is created, with `ScriptProvider.getByTrigger(trigger, type.id, type.category)`, which returns the type-specific script, else the category script, else the global script for the trigger. If none exists, no entry is created. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:124-134`
   ```ts
   static getByTrigger(trigger: TargetOp, type: number = -1, category: number = -1): ScriptFile | undefined {
   let script = ScriptProvider.scriptLookup.get(trigger | (0x2 << 8) | (type << 10));
   ```
   The triggers are `AI_SPAWN` (166) and `AI_DESPAWN` (167). Source: `Engine-TS/src/engine/script/ServerTriggerType.ts:161-162`

### Who adds entries, and in which phase

3. Grep of `Engine-TS/src` for `npcEventQueue` finds exactly two writers, both `addTail` (FIFO): one in `World.addNpc` (spawn) and one in `Npc.turn` (despawn). Nothing else removes or clears entries; the only removal is the `unlink` in this phase (`Engine-TS/src/engine/World.ts:652`).

4. **Spawn entry.** Every call of `World.addNpc` queues an `AI_SPAWN` entry (if a script resolves), after placing the NPC in its zone, setting collision and calling `npc.resetEntity(true)`. Source: `Engine-TS/src/engine/World.ts:1295-1300`
   ```ts
   // Queue spawn trigger
   const type = NpcType.get(npc.type);
   const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
   if (script) {
   this.npcEventQueue.addTail(new NpcEventRequest(NpcEventType.SPAWN, script, npc));
   ```
   For a first spawn, `addNpc` puts the NPC into `World.npcs` (and rsbuf) **synchronously, before** queueing the trigger (`Engine-TS/src/engine/World.ts:1269-1273`). `resetEntity(true)` sets `delayed = false` and `activeScript = null` (`Engine-TS/src/engine/entity/Npc.ts:289-305`), so the NPC is not delayed when its spawn entry is queued.

   `addNpc` is called from (grep for `addNpc(` in `Engine-TS/src`):
   - `GameMap.loadNpcs`, for every map NPC loaded for this world type, with lifecycle `RESPAWN` (`Engine-TS/src/engine/GameMap.ts:153-154`). In a free world it skips NPCs on non-free-to-play squares (`Engine-TS/src/engine/GameMap.ts:143-145`) and members NPC types (`Engine-TS/src/engine/GameMap.ts:151`), and invalid NPC types are skipped (`Engine-TS/src/engine/GameMap.ts:146-150`). This runs from `gameMap.init()` in `World.start()` before the first `cycle()` call, unless `start` is called with `skipMaps` set (`Engine-TS/src/engine/World.ts:302-304`, `Engine-TS/src/engine/World.ts:330-335`; `loadNpcs` is called at `Engine-TS/src/engine/GameMap.ts:75` and `Engine-TS/src/engine/GameMap.ts:90`).
   - The `NPC_ADD` script command (`npc_add`), with lifecycle `DESPAWN` and the given duration (`Engine-TS/src/engine/script/handlers/NpcOps.ts:57-68`). It runs in whatever phase the calling script runs.
   - The `::npcadd` cheat, with lifecycle `DESPAWN` and duration 500, during phase 2 packet decoding (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:505-515`).
   - `Npc.turn()` respawn: an inactive `RESPAWN` NPC whose `lifecycleTick` reaches 0 is re-added with `World.addNpc(this, -1, false)` (`Engine-TS/src/engine/entity/Npc.ts:121-127`). `turn()` is phase 4.
   - `Npc.revertType()` when `resetOnRevert` is set: `removeNpc` then `addNpc(this, -1, false)` (`Engine-TS/src/engine/entity/Npc.ts:1159-1162`), reached from `turn()` when an active `RESPAWN` NPC's `lifecycleTick` reaches 0 (`Engine-TS/src/engine/entity/Npc.ts:128-131`). Phase 4. `resetOnRevert` is set by `changeType` (`Engine-TS/src/engine/entity/Npc.ts:443-450`), called by `npc_changetype` (reset `true`) and `npc_changetype_keepall` (reset `false`) (`Engine-TS/src/engine/script/handlers/NpcOps.ts:471-486`). So a revert after `npc_changetype` re-runs the spawn trigger; a revert after `npc_changetype_keepall` does not (it resets `type` to `baseType`, sets the `CHANGE_TYPE` mask and recomputes `uid`, without `removeNpc`/`addNpc`, `Engine-TS/src/engine/entity/Npc.ts:1163-1166`).

5. **Despawn entry.** Queued only in `Npc.turn()`, when a `DESPAWN`-lifecycle NPC's `lifecycleTick` reaches 0 and the NPC is not delayed. The NPC is removed **first**, then the trigger is looked up with the NPC's current `type` and queued. Source: `Engine-TS/src/engine/entity/Npc.ts:121-141`
   ```ts
           if (!this.delayed && --this.lifecycleTick === 0) {
   ```
   and `Engine-TS/src/engine/entity/Npc.ts:133-142`
   ```ts
                   // Despawn NPC (npc_add)
                   else if (this.lifecycle === EntityLifeCycle.DESPAWN) {
                       World.removeNpc(this, -1);
                       // Queue despawn trigger
                       const type = NpcType.get(this.type);
                       const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_DESPAWN, type.id, type.category);
                       if (script) {
                           World.npcEventQueue.addTail(new NpcEventRequest(NpcEventType.DESPAWN, script, this));
                       }
                   }
   ```
   For a `DESPAWN` NPC, `removeNpc` removes it from rsbuf and `World.npcs` and calls `npc.cleanup()` (`Engine-TS/src/engine/World.ts:1327-1330`), which sets `nid = -1`, `uid = -1`, `activeScript = null`, `delayed = false`, `delayedUntil = -1`, `huntTarget = null` and clears its queue (`Engine-TS/src/engine/entity/Npc.ts:194-202`). Coordinates and `type` are not reset by `cleanup`. So the despawn script later runs with `self` = an NPC that is inactive, has `nid` -1 and is no longer in `World.npcs`.

   When the despawn entry is queued depends on the lifecycle countdown, and `changeType` can replace it: for an active NPC with `duration >= 1`, unless the NPC is a `RESPAWN` NPC changing back to its `baseType`, it calls `setLifeCycle(duration)` (`Engine-TS/src/engine/entity/Npc.ts:444-446`, `Engine-TS/src/engine/entity/Npc.ts:461-465`). So `npc_changetype`/`npc_changetype_keepall` on a `DESPAWN` NPC (one from `npc_add`) overwrites its remaining lifetime, and the despawn (and its trigger) happen after `duration` more non-delayed `turn()` calls instead (the countdown only decrements when not delayed, `Engine-TS/src/engine/entity/Npc.ts:121`). Its `lifecycle` stays `DESPAWN`, so at the end it despawns rather than reverting.

6. **Not every removal queues a despawn trigger.** `npc_del` (`NPC_DEL`) calls `World.removeNpc(activeNpc, respawnrate)` directly (`Engine-TS/src/engine/script/handlers/NpcOps.ts:93-95`), and `removeNpc` itself never touches `npcEventQueue` (`Engine-TS/src/engine/World.ts:1307-1334`). So `npc_del`, a script-error removal (`Engine-TS/src/engine/script/ScriptRunner.ts:207-212`, production only) and the phase-4 crash removal (`Engine-TS/src/engine/World.ts:668-673`) do **not** run `AI_DESPAWN`. Only a `DESPAWN`-lifecycle NPC reaching the end of its duration does. Likewise a `RESPAWN` NPC removed by `npc_del` gets no despawn trigger, and gets a spawn trigger again when it respawns (rule 4).

7. Summary of enqueue sites by phase (rules 4-6):

   | Enqueued in | By | Trigger |
   |---|---|---|
   | Startup, before the first tick | `GameMap.loadNpcs` -> `addNpc` | `AI_SPAWN` |
   | Phase 1 | `npc_add` from a world-queue script (`processWorld` runs scripts, see [`01-world.md`](01-world.md)) | `AI_SPAWN` |
   | Phase 2 | `npc_add` from a script run by a packet handler; `::npcadd` cheat | `AI_SPAWN` |
   | Phase 3 | `npc_add` from an `AI_SPAWN`/`AI_DESPAWN` script run by this phase | `AI_SPAWN` |
   | Phase 4 | respawn and revert in `Npc.turn()`; `npc_add` from NPC scripts | `AI_SPAWN` |
   | Phase 4 | despawn at end of lifecycle in `Npc.turn()` | `AI_DESPAWN` |
   | Phase 5 or later | `npc_add` from player scripts (or any other script) | `AI_SPAWN` |

   Which phases run scripts that can call `npc_add` was taken from the earlier notes and the phase list; not every script entry point in phases 5 to 11 was enumerated.

### What runs per entry

8. `ScriptRunner.init(script, npc)` builds a **new** `ScriptState` with `self` = the NPC and the NPC as `active_npc`; no player is set. Source: `Engine-TS/src/engine/script/ScriptRunner.ts:66-75`
   ```ts
   static init(script: ScriptFile, self: Entity | null = null, target: Entity | null = null, args: ScriptArgument[] | null = []) {
   const state = new ScriptState(script, args);
   state.self = self;
   ```

9. `Npc.executeScript` runs it to its first stop and routes the result: `WORLD_SUSPENDED` -> `World.enqueueScript` (resumes in phase 1 of a later tick), `NPC_SUSPENDED` -> `activeNpc.activeScript`, any other non-final state -> `activePlayer.activeScript`; then clears `protect` on any protected active players. Source: `Engine-TS/src/engine/entity/Npc.ts:225-248`
   ```ts
   executeScript(script: ScriptState) {
   const state = ScriptRunner.execute(script);
   if (state !== ScriptState.FINISHED && state !== ScriptState.ABORTED) {
   if (state === ScriptState.WORLD_SUSPENDED) {
   World.enqueueScript(script, script.popInt());
   ```
   An `NPC_SUSPENDED` script (from `npc_delay`, which also sets `delayed` and `delayedUntil = currentTick + 1 + n`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101`) is resumed by `Npc.turn()` in phase 4 once `delayed` has cleared (`Engine-TS/src/engine/entity/Npc.ts:111-117`).

10. The script runs **immediately**, inside phase 3, in queue order. Iteration is `LinkList.all()`, which sets the cursor to the next node before yielding the current one and restores it after (`Engine-TS/src/datastruct/LinkList.ts:47-55`, `Engine-TS/src/datastruct/LinkList.ts:67-75`). Source: `Engine-TS/src/datastruct/LinkList.ts:105-109`
    ```ts
    for (let link = this.head(); link !== null; link = this.next()) {
    const save = this.cursor;
    yield link;
    this.cursor = save;
    ```
    The current entry is unlinked **before** its script runs (L2 step 1). `Linkable.unlink` only rewires the neighbours (`Engine-TS/src/datastruct/Linkable.ts:6-15`), so the saved cursor (the following node, or the sentinel) stays valid.

### Delayed NPCs

11. The gate is `npc.delayed` only, not `isActive` or `isValid()`. Entries for a delayed NPC are **kept in place** and re-checked on every later phase 3 until the NPC is no longer delayed; later entries in the queue are not blocked by them (the loop just moves on). Source: `Engine-TS/src/engine/World.ts:650-651`
    ```ts
    const npc = request.npc;
    if (!npc.delayed) {
    ```
    Phase 3 never clears `delayed`. It is cleared in `Npc.turn()` (phase 4) when `currentTick >= delayedUntil` (`Engine-TS/src/engine/entity/Npc.ts:111-112`; that line is inside `if (this.isActive)`), by `resetEntity(true)` (`Engine-TS/src/engine/entity/Npc.ts:304`) and by `cleanup()` (`Engine-TS/src/engine/entity/Npc.ts:198`). `delayed` is set by `npc_delay` and `npc_arrivedelay` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:556-569`). Because `cleanup()` clears it, a despawn entry runs at the next phase 3 unless some script still holding the removed NPC as `active_npc` delays it in between (not checked whether any can). An NPC is delayed when its spawn entry is queued only if a script delays it between `addNpc` and the next phase 3 (e.g. the script that called `npc_add` then calls `npc_delay` on the new `active_npc`; not observed in content).

### Exceptions

12. There is no `try`/`catch` in this phase (`Engine-TS/src/engine/World.ts:648-657`). Script errors inside the interpreter are caught by `ScriptRunner.execute` itself, which returns `ABORTED` (`Engine-TS/src/engine/script/ScriptRunner.ts:126`, `Engine-TS/src/engine/script/ScriptRunner.ts:170`, `Engine-TS/src/engine/script/ScriptRunner.ts:228-231`); in production its `catch` also calls `World.removeNpc(self, 0)` for an NPC `self` (`Engine-TS/src/engine/script/ScriptRunner.ts:207-212`), which returns at once for an already inactive NPC (`Engine-TS/src/engine/World.ts:1308-1310`). But `Npc.executeScript`'s routing runs **after** `execute` returns and is not protected: if the script stops in `SUSPENDED`, `PAUSEBUTTON` or `COUNTDIALOG` state, it evaluates `script.activePlayer`, and that getter picks `_activePlayer` when `intOperand === 0`, otherwise `_activePlayer2`, and throws if the chosen one is `null` (`Engine-TS/src/engine/script/ScriptState.ts:185-191`). A spawn/despawn script starts with no active player (rule 8), so this happens if it suspends that way without first setting one (e.g. with a player-finding command; VM not read). Such a throw leaves `processNpcEventQueue` and reaches `cycle()`'s `catch`, which removes every player and calls `process.exit(1)`. Source: `Engine-TS/src/engine/World.ts:509-526`. The entry that threw was already unlinked; the rest of the queue is not processed (the process exits).

### Same-tick behaviour

13. **Entries added before phase 3 run in this tick's phase 3.** Entries queued at startup run in phase 3 of the first tick; entries queued in phases 1 and 2 run in phase 3 of the same tick (rule 7 and the phase order). Entries queued in phase 4 or later run in phase 3 of the **next** tick (or later, if the NPC is delayed, rule 11).

14. **Entries added during phase 3** (an `AI_SPAWN`/`AI_DESPAWN` script calling `npc_add`) are appended at the tail of the list being iterated. They are visited in the **same** pass if the entry whose script added them was not the last node in the queue when the cursor was saved, because the cursor then points at a later node and `next()` walks on through the new tail. If it was the last node, the saved cursor is the sentinel and `next()` returns `null` (`Engine-TS/src/datastruct/LinkList.ts:67-72`), so the new entry first runs in the next tick's phase 3. Source for append: `Engine-TS/src/datastruct/LinkList.ts:13-23`. "Later nodes" includes entries skipped this tick because their NPC is delayed.

15. **An NPC added during phase 3 gets its phase-4 turn in the same tick.** `addNpc` with `firstSpawn` puts it into `World.npcs` at once (`Engine-TS/src/engine/World.ts:1270-1273`), via `EntityList.set`, which writes `ids[nid]` (`Engine-TS/src/engine/entity/EntityList.ts:62-76`). `processNpcs` starts a fresh iteration of `this.npcs` after phase 3 has finished (`Engine-TS/src/engine/World.ts:665-676`), and that iterator visits every `ids` position in ascending nid order (`Engine-TS/src/engine/entity/EntityList.ts:36-47`). So an NPC spawned by a phase-3 script (and any NPC spawned in phases 1-2) is visited by phase 4 in the same tick, whatever its nid. Its spawn trigger may or may not have run first (rule 14).

16. The NPCs whose triggers run here were added to `World.npcs` (first spawn) or kept in it (respawn: `removeNpc` keeps `RESPAWN` NPCs in the list, `Engine-TS/src/engine/World.ts:1327-1333`) when the entry was queued; despawned NPCs are no longer in it (rule 5), so their `turn()` is not called again.

## Comment-versus-code check

- `cycle()` comment "Spawn triggers, despawn triggers" (`Engine-TS/src/engine/World.ts:357`): **matches**. The phase runs only `AI_SPAWN` and `AI_DESPAWN` scripts.
- Header comment "Despawn and respawn" (`Engine-TS/src/engine/World.ts:647`): **mismatch**. The phase does not despawn or respawn any NPC; it runs the triggers queued by spawn and despawn. Despawning and respawning happen in `Npc.turn()` (phase 4) and `World.removeNpc`/`addNpc`; a respawn shows up here only as an ordinary spawn trigger (rule 4).
- `addNpc` "Queue spawn trigger" (`Engine-TS/src/engine/World.ts:1295`) and `turn()` "Queue despawn trigger" (`Engine-TS/src/engine/entity/Npc.ts:136`): **match**.
- `turn()` "Npc Events (Respawn, Revert, Despawn)" (`Engine-TS/src/engine/entity/Npc.ts:120`): matches the three branches. "Respawn NPC (npc_del)" (`Engine-TS/src/engine/entity/Npc.ts:124`): consistent, since `npc_del` on a `RESPAWN` NPC sets its lifecycle countdown (`Engine-TS/src/engine/World.ts:1331-1332`). "Revert NPC (npc_changetype)" (`Engine-TS/src/engine/entity/Npc.ts:128`) and "Despawn NPC (npc_add)" (`Engine-TS/src/engine/entity/Npc.ts:133`): consistent with rule 4 (`changeType`, `NPC_ADD` with `DESPAWN`); the `::npcadd` cheat also creates `DESPAWN` NPCs.
- `turn()` catch "there was an error adding or removing them, try again next tick..." (`Engine-TS/src/engine/entity/Npc.ts:144-145`): **matches**; `setLifeCycle(1)` (`Engine-TS/src/engine/entity/Npc.ts:148`) makes the next `turn()` decrement to 0 again. If the error was thrown after `removeNpc` succeeded, the retry hits `removeNpc`'s early return; not analysed further.
- `NpcEventRequest` "The type of queue request." (`Engine-TS/src/engine/entity/NpcEventRequest.ts:12`): describes the field correctly, but nothing reads it (rule 1).
- Content `cheat_npc.rs2` "// Spawn trigger should be 1 tick delayed" before `npc_add` (`Content/scripts/_test/scripts/cheats/cheat_npc.rs2:55-56`): **consistent** (inference). The `npc_add` follows `p_delay(2)` (`Content/scripts/_test/scripts/cheats/cheat_npc.rs2:53`), so it runs when phase 5 resumes the player's suspended script (`Engine-TS/src/engine/World.ts:694-697`), and by rule 13 a trigger queued in phase 5 runs in phase 3 of the next tick.

## Inferences (labelled)

- **Inference: every NPC spawn, respawn and reset-revert queues an entry**, if content's `[ai_spawn,_]` script (`Content/scripts/npc/scripts/ai_spawn.rs2:1-3`, which sets `%npc_combat_xp_multiplier` and `%npc_start_coord`) is registered under the global `AI_SPAWN` key that `getByTrigger` falls back to (rule 2). How `_` is compiled into the lookup key was not read (`docs/open-questions.md` #5, #25). If so, phase 3 of the first tick runs this script once per map NPC.
- **Inference: an `AI_SPAWN` script runs before the NPC's first phase-4 turn** when the NPC was spawned at startup, in phases 1-2, or in phase 5 or later. It runs **after** at least part of a turn when (a) the NPC respawns or reverts in `turn()` (the rest of that same `turn()` continues: after `addNpc` sets `isActive = true` and `resetEntity` clears `delayed`, `isValid()` is true, so hunt, queue and movement run in that tick; `Engine-TS/src/engine/entity/Npc.ts:152-155`, `Engine-TS/src/engine/entity/Npc.ts:382-387`), (b) an NPC script spawns it in phase 4 and its nid is later in the current `processNpcs` iteration (typed-array `for...of` reads `ids` live; JavaScript semantics, not engine code), or (c) it was spawned by the last entry of a phase-3 pass (rule 14). Rests on rules 4, 7, 13-15.
- **Inference: a `DESPAWN` NPC with duration 1 spawned in phase 1 or 2 runs its spawn trigger in phase 3 and despawns in phase 4 of the same tick** (`setLifeCycle(max(1, d))`, `Engine-TS/src/engine/entity/Entity.ts:36-43`, decremented in that tick's `turn()`), and its despawn trigger runs in phase 3 of the next tick. An NPC that despawns before its spawn entry has run would have both entries run in the next phase 3 in queue order, both on a cleaned-up NPC. Rests on rules 4, 5, 13, 15.
- **Inference: a spawn trigger for a delayed NPC that called `npc_delay(n)` in tick T runs in phase 3 of tick T+2+n at the earliest**: `delayedUntil = T+1+n` (rule 9), cleared in phase 4 of tick T+1+n (rule 11), and phase 3 of that tick has already passed. Rests on rules 9 and 11.
- **Inference: a `RESPAWN` NPC removed while delayed stays delayed and inactive indefinitely, and any spawn entry still queued for it is re-checked and skipped every tick.** `removeNpc` calls `cleanup()` (which clears `delayed`) only for `DESPAWN` NPCs; for a `RESPAWN` NPC it only sets the lifecycle countdown (`Engine-TS/src/engine/World.ts:1327-1333`). `turn()` clears `delayed` only inside `if (this.isActive)` (`Engine-TS/src/engine/entity/Npc.ts:111-112`), and the lifecycle countdown is gated by `!this.delayed` (`Engine-TS/src/engine/entity/Npc.ts:121`), so the respawn that would call `resetEntity(true)` (which clears `delayed`, `Engine-TS/src/engine/entity/Npc.ts:304`) never happens. Grep of `Engine-TS/src` for `delayed = false` finds only those three NPC sites (plus the player one at `Engine-TS/src/engine/World.ts:692`). Such a removal is possible e.g. by `npc_del` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:93-95`) on an NPC that is under `npc_delay`, or by the production script-error removal of a delayed NPC. Whether content ever does this was not checked, and it was not observed (`docs/open-questions.md` #26).
- **Inference: `AI_DESPAWN` scripts act on a removed NPC.** `self` has `nid` -1 and is out of `World.npcs` and rsbuf (rule 5); coordinates are kept, so `npc_coord` (used by `[ai_despawn,small_bat]`, `Content/scripts/_test/scripts/cheats/cheat_npc.rs2:62-63`) still returns the last position. What other commands do on such an NPC (e.g. `npc_say`, `npc_anim` masks for an NPC no player can see) was not checked (`docs/open-questions.md` #26).
- **Inference: none of the three content trigger scripts found by grep can hit the rule-12 crash.** `[ai_spawn,_]` only sets two vars, `[ai_spawn,small_bat]` calls `npc_say`, `[ai_despawn,small_bat]` calls `obj_addall` (`Content/scripts/npc/scripts/ai_spawn.rs2:1-3`, `Content/scripts/_test/scripts/cheats/cheat_npc.rs2:59-63`); none of them suspends. This rests on reading those three scripts only and on what each command does not being a suspension (VM handlers for `npc_say`/`obj_addall` not read).

## Not checked / open questions

- How content trigger keys like `[ai_spawn,_]` are compiled and registered in `ScriptProvider.scriptLookup`. Answered by reading in [`../books/runescript-intro/02-script-anatomy-and-lookup.md`](../books/runescript-intro/02-script-anatomy-and-lookup.md) (finding 47); the runtime effect is `docs/open-questions.md` #25.
- What commands do when `self`/`active_npc` is a despawned NPC (`nid` -1, not in `World.npcs`), or an inactive `RESPAWN` NPC removed by `npc_del` while its spawn entry was still queued. `docs/open-questions.md` #26.
- RuneScript VM internals (what the spawn script does beyond its entry; `npc_say`, `obj_addall` handlers). Boundary; `docs/open-questions.md` #15.
- The respawn path's rsbuf state (observer count after `addNpc(..., false)`) is read in [`09-info.md`](09-info.md) rule 22; `docs/open-questions.md` #20(a) is now observation-only.
- Phase 4 (`Npc.turn()` after the lifecycle block, `processNpcs` error handling beyond its `catch`) is cited here only where this phase depends on it; answered in [`04-npcs.md`](04-npcs.md) (the per-NPC turn order, L2; exception handling, rule 3) and [`04b-npc-modes.md`](04b-npc-modes.md).
- Script entry points in phases 5 to 11 that could call `npc_add` were not enumerated (rule 7 lists the kinds of caller, not every site). `docs/open-questions.md` #51.
- Nothing was run; no tick timings here were observed.

# Phase 5b: `processPlayers` part 2 (facing, interaction, movement, run energy)

**Question answered:** In the fifth phase of a game tick, after a player's queues and timers have run, in what order do target facing, the op/ap interaction, the walk trigger, the movement step(s), loc/obj facing, run energy and the "jump" check happen; on which tick an interaction fires relative to the click; how many tiles a player moves per tick; what clears the target; and how `delayed`, a modal and `protect` affect each step?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only a grep for `[if_close,...]` scripts, see Not checked)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". The pathfinding/collision library behind `reachedEntity`, `reachedLoc`, `reachedObj`, `isApproached`, `canTravel` and `findNaivePath` (`rsmod`, `Engine-TS/src/engine/routefinder/`) was not read; it is treated as a boundary.

Related notes: [`05-players-queues-timers.md`](05-players-queues-timers.md) (steps 1-5 of the same per-player turn, the `canAccess` gate, rule 8; `executeScript`/`runScript`, rules 6-7; the per-player `catch`, rule 3), [`02-clients-in.md`](02-clients-in.md) (which phase-2 handlers set the target, waypoints, `tempRun` and `moveClickRequest`, rules 12-16), [`04b-npc-modes.md`](04b-npc-modes.md) (the NPC side of facing and movement, rules 16-17), [`../flows/move-opclick.md`](../flows/move-opclick.md) (how the client route becomes waypoints), [`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md) (the loc-op trigger lookup and `p_oploc`). Facts reused from these notes were re-checked at the same Engine-TS commit and are re-cited here.

## Position in the tick

Steps 6-11 of each player's turn inside `processPlayers()` (phase 5), after `processEngineQueue()` (step 5, note 05) and before the next player's turn. After all players, phase 6 `processLogouts()` runs. Source: `Engine-TS/src/engine/World.ts:709-726`
```ts
                player.processEngineQueue();
                // Face the interaction target -- both halves, the same tick the op set the target (the op ran
                // in processClientsIn) and before processInteraction can clear it: the FACE_ENTITY mask, plus
                // the serverside faceAngle toward a pathing target (for new observers).
                player.setFaceEntity();
                player.reorientEntity();
                // - interactions
                // - movement
                player.processInteraction();
                // After movement: face a loc/obj target if we walked over and held still (needs stepsTaken).
                player.reorient();

                // - run energy
                player.updateEnergy();

                if ((player.masks & PlayerInfoProt.EXACT_MOVE) == 0) {
                    player.validateDistanceWalked();
                }
```

## L2: ordered sub-steps

**Per-player order within the tick**, continued from [`05-players-queues-timers.md`](05-players-queues-timers.md) (steps 1-5 there: undelay, resume, queues, timers, engine queue). The whole turn finishes before the next player's turn starts (05 rule 1).

6. **`setFaceEntity()`**: point `faceEntity` at the current target (player or NPC) or -1; set the `FACE_ENTITY` mask if it changed (L3 rule 1). Source: `Engine-TS/src/engine/World.ts:713`
7. **`reorientEntity()`**: if the target is a player/NPC, set the server-side facing angle toward it, no mask (L3 rule 2). Source: `Engine-TS/src/engine/World.ts:714`
8. **`processInteraction()`** (L3 rules 4-19). Source: `Engine-TS/src/engine/World.ts:717`, `Engine-TS/src/engine/entity/Player.ts:1247-1314`
   1. Record `followX/Z` = `lastStepX/Z`; clear `nextTarget`.
   2. **Pre-move attempt**, only if there is a target and `canAccess()`:
      1. `validateTarget()`; on failure clear the interaction, clear waypoints, send `UnsetMapFlag` and **return** (no movement this tick).
      2. If `clientRoutefinder` (default) and not a follow op: `processWalktrigger()`.
      3. `tryInteract(false)`.
   3. **If no interaction ran** in 8.2:
      1. `pathToPathingTarget()` (player/NPC targets only).
      2. If waypoints and `canAccess()`: `processWalktrigger()`.
      3. If no waypoints and this is a follow op: clear the interaction.
      4. `updateMovement()`: walk 1 tile or run 2 tiles along the waypoints.
      5. **Post-move attempt**, only if there is a target, `canAccess()` and not a follow op: `tryInteract(stepsTaken === 0)`; if that did not interact, `apRangeCalled` is false, there are no waypoints and no steps were taken, send "I can't reach that!" and clear the interaction.
   4. If a script set a new interaction (`nextTarget`), make it the target; else if an interaction ran and `p_aprange` was not called, clear the interaction.
   5. If there are no waypoints left and a step was taken this tick, `unsetMapFlag()`.
9. **`reorient()`**: if the target is not a player/NPC, a loc/obj facing tile is pending and no step was taken this tick, face it with the `FACE_COORD` mask (L3 rule 21). Source: `Engine-TS/src/engine/World.ts:719`
10. **`updateEnergy()`**: unless delayed, regain energy if fewer than 2 steps were taken, else drain; turn run off at 0 energy (L3 rule 22). Source: `Engine-TS/src/engine/World.ts:721-722`
11. **`validateDistanceWalked()`**, only if the `EXACT_MOVE` mask is not set: set `jump` if the player is more than 2 tiles from where it was at the end of the last tick (L3 rule 23). Source: `Engine-TS/src/engine/World.ts:724-726`

## L3: ordering rules

### Facing before the interaction (steps 6-7)

1. **`setFaceEntity` sets the `FACE_ENTITY` mask only when the faced entity changes.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:514-532`
   ```ts
    setFaceEntity(): void {
        const oldEntity = this.faceEntity;
        if (this.target instanceof Player) {
            const playerSlot: number = this.target.slot + 32768;
            if (this.faceEntity !== playerSlot) {
                this.faceEntity = playerSlot;
            }
        } else if (this.target instanceof Npc) {
            const nid: number = this.target.nid;
            if (this.faceEntity !== nid) {
                this.faceEntity = nid;
            }
        } else {
            this.faceEntity = -1;
        }
        if (this.faceEntity !== oldEntity) {
            this.masks |= this.entitymask;
        }
    }
   ```
   - For a player, `entitymask` is `PlayerInfoProt.FACE_ENTITY` and `coordmask` is `PlayerInfoProt.FACE_COORD` (constructor arguments, `Engine-TS/src/engine/entity/Player.ts:414-426`).
   - A loc or obj target, or no target, gives `faceEntity = -1`.
   - It is also called at the end of `resetPathingEntity()` in phase 11, **after** `masks = 0` (`Engine-TS/src/engine/entity/PathingEntity.ts:606`, `Engine-TS/src/engine/entity/PathingEntity.ts:630`), and phase 11 calls `resetEntity(false)` for every player in `playerLoop` (`Engine-TS/src/engine/World.ts:1148-1149`, `Engine-TS/src/engine/entity/Player.ts:470-474`). So a target change made **after** step 6 (by `processInteraction` in step 8, or by a later phase) is picked up in phase 11 and its mask is left set for the **next** tick's phase 9 (see Inferences).

2. **`reorientEntity` changes only the server-side facing angle, toward a player/NPC target.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:370-375`
   ```ts
    reorientEntity(): void {
        const target: Entity | null = this.target;
        if (target instanceof PathingEntity) {
            this.focus(CoordGrid.fine(target.x, target.width), CoordGrid.fine(target.z, target.length), false);
        }
    }
   ```
   `focus(x, z, false)` sets only `faceAngleX/Z`; with `client = true` it also sets `faceSquareX/Z` and the `coordmask` (`Engine-TS/src/engine/entity/PathingEntity.ts:341-353`). `fine(pos, size)` is `pos * 2 + size` (`Engine-TS/src/engine/CoordGrid.ts:125-127`). Phase 9 passes `faceSquareX/Z` and `faceAngleX/Z` to `rsbuf.computePlayer` (`Engine-TS/src/engine/World.ts:1006-1026`), where they become `faceX/Z` and `orientationX/Z` (`Engine-TS/src/network/rsbuf/index.ts:98-102`). When an observer adds this player (in phase 10, `Engine-TS/src/network/rsbuf/info.ts:119-127`), the `FACE_COORD` block already cached this tick is used if there is one (`Engine-TS/src/network/rsbuf/info.ts:209`), else it is built from `faceX/Z` if set, else from `orientationX/Z`, else from the player's own tile (`Engine-TS/src/network/rsbuf/info.ts:209-218`). The phase-10 encoder is described in [`09-info.md`](09-info.md).

3. **Both facing calls see the target as left by phase 2 and steps 1-5**, i.e. before `processInteraction` can clear it (rules 5, 17). The target is written in phase 2 by the op handlers through `setInteraction` ([`02-clients-in.md`](02-clients-in.md) rule 13; e.g. `Engine-TS/src/network/game/client/handler/OpLocHandler.ts:44-47`), and by scripts that call `setInteraction` (e.g. `p_oploc`, `p_opnpc`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:387-401`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:404-415`). `setInteraction` itself does not change facing; for a loc/obj it only records `targetX/Z` for `reorient()` (`Engine-TS/src/engine/entity/PathingEntity.ts:552-558`).

### `processInteraction`: entry and the pre-move attempt (step 8.1-8.2)

4. **Entry state.** Source: `Engine-TS/src/engine/entity/Player.ts:1248-1254`
   ```ts
        this.followX = this.lastStepX;
        this.followZ = this.lastStepZ;
        this.nextTarget = null;

        const followOp = this.targetOp === ServerTriggerType.APPLAYER3 || this.targetOp === ServerTriggerType.OPPLAYER3;

        let interacted = false;
   ```
   - `followX/Z` is what a player following **this** player walks to (rule 10).
   - `lastStepX/Z` is the tile the player was on before its last step attempt. It is set in `refreshZonePresence`, which runs on every step attempt, even one that did not move (`Engine-TS/src/engine/entity/PathingEntity.ts:182-183`, `Engine-TS/src/engine/entity/PathingEntity.ts:230-231`). A teleport sets it to the tile west of the new position (`Engine-TS/src/engine/entity/PathingEntity.ts:311-312`); so do the constructor (`Engine-TS/src/engine/entity/PathingEntity.ts:109-110`) and `onLogin` (`Engine-TS/src/engine/entity/Player.ts:530-531`).
   - Player op 3 (`APPLAYER3`/`OPPLAYER3`) is "follow".

5. **The pre-move attempt and target validation.** Source: `Engine-TS/src/engine/entity/Player.ts:1256-1270`
   ```ts
        // If there is a target and p_access is available, try to interact before movement
        if (this.target && this.canAccess()) {
            // Clear the interaction if target validation does not pass
            if (!this.validateTarget()) {
                this.clearInteraction();
                this.unsetMapFlag();
                return;
            }

            if (Environment.node.clientRoutefinder && !followOp) {
                this.processWalktrigger();
            }

            interacted = this.tryInteract(false);
        }
   ```
   - The whole block, **including the validity check**, is skipped when `canAccess()` is false: not `protect`, not `delayed`, no `MAIN`/`CHAT` modal, or `World.shutdown` (05 rule 8).
   - `validateTarget()` fails if the target is on another level, if an NPC or loc target's `type` differs from the type recorded at `setInteraction` (a `changetype`), or if `target.isValid(hash64)` is false (`Engine-TS/src/engine/entity/Player.ts:1233-1245`):
     - an NPC is invalid while it is **`delayed`** or inactive (`Engine-TS/src/engine/entity/Npc.ts:382-387`, `Engine-TS/src/engine/entity/Entity.ts:32-34`);
     - a player is invalid while `loggingOut` or when its visibility is not `DEFAULT` (`Engine-TS/src/engine/entity/Player.ts:2293-2303`);
     - an obj is invalid if it is still private to another player (`reveal > -1` and a different `receiver64`), if its count is below 1, or if it is inactive (`Engine-TS/src/engine/entity/Obj.ts:52-62`);
     - a loc is invalid when inactive (no override in `Loc`; base `Entity.isValid`).
   - On failure: `clearInteraction()` (target, op, subject reset; `apRange = 10`, `apRangeCalled = false`; `Engine-TS/src/engine/entity/PathingEntity.ts:563-569`), then `unsetMapFlag()`, which clears the waypoints and writes `UnsetMapFlag` (`Engine-TS/src/engine/entity/Player.ts:2247-2250`), then **`return`**. Steps 8.3-8.5 are skipped, so the player **does not move this tick**. `Player.write` sends at once ([`02-clients-in.md`](02-clients-in.md) rule 11).
   - The walk trigger runs **before** the first `tryInteract` (rule 20).

### `tryInteract`: which script runs and the distance checks

6. **`tryInteract` has four branches, tried in order; it returns `true` when an interaction counts as done.** Source: `Engine-TS/src/engine/entity/Player.ts:1160-1231`. Common gate, `Engine-TS/src/engine/entity/Player.ts:1161-1163`:
   ```ts
        if (!this.target || !this.hasInteraction() || !this.canAccess()) {
            return false;
        }
   ```
   `hasInteraction()` is false for no target and for the follow ops `APPLAYER3`/`OPPLAYER3` (`Engine-TS/src/engine/entity/Player.ts:975-984`), so **following never runs an op/ap script**.

   1. **Op script**: an op trigger exists, the target is a player/NPC **or** `allowOpScenery` is true, and `inOperableDistance(target)`. Source: `Engine-TS/src/engine/entity/Player.ts:1170-1183`
      ```ts
        if (opTrigger && (this.target instanceof PathingEntity || allowOpScenery) && this.inOperableDistance(this.target)) {
            const target = this.target;

            this.target = null;
            this.clearWaypoints();

            this.executeScript(ScriptRunner.init(opTrigger, this, target), true);

            // If p_opnpc was called, remember it for later
            // For now, keep the current target
            this.nextTarget = this.target;
            this.target = target;
            return true;
        }
      ```
      Before the script runs, the target is set to `null` and the **waypoints are cleared** (the player stops). The script runs protected (05 rule 6). Afterwards, whatever target the script set through `setInteraction` (e.g. `p_oploc`) is saved in `nextTarget`, and the old target is put back.
   2. **Ap script**: an ap trigger exists and `inApproachDistance(apRange, target)`. There is no player/NPC-or-`allowOpScenery` condition, so an ap script can run for a loc/obj in the pre-move attempt. Source: `Engine-TS/src/engine/entity/Player.ts:1186-1217`
      ```ts
        else if (apTrigger && this.inApproachDistance(this.apRange, this.target)) {
            // Reset apRangeCalled
            this.apRangeCalled = false;
      // ...
            this.target = null;
            this.clearWaypoints();

            this.executeScript(ScriptRunner.init(apTrigger, this, target), true);
      // ...
            this.nextTarget = this.target;
            this.target = target;

            // If p_opnpc was called, make sure destination is not set
            if (this.nextTarget) {
                this.clearWaypoints();
            }
            // if aprange was called then we did not interact.
            else if (this.apRangeCalled) {
                this.waypoints = wayPoints;
                this.waypointIndex = waypointIndex;
                this.target = target;
                return false;
            }
            return true;
        }
      ```
      - Same null-target, clear-waypoints, protected run and `nextTarget` capture as the op branch.
      - If the script set a new interaction, the waypoints are cleared **again**, which also drops any waypoint the script queued (`p_oploc` queues one when the player is not in operable distance, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:397-399`).
      - Else, if the script called `p_aprange`, the saved waypoints are restored and the branch returns `false` ("did not interact"). `p_aprange(n)` sets `apRange = n` and `apRangeCalled = true` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:353-356`).
   3. **No ap script, but within approach distance**: set `apRange = -1` and return `false`. Source: `Engine-TS/src/engine/entity/Player.ts:1220-1223`. This branch is reached only when branch 2 failed, and both test `inApproachDistance(this.apRange, ...)`, so in practice it means "no ap trigger". With `apRange = -1`, `distanceTo(...) <= -1` can never hold (rule 7), so branches 2 and 3 cannot fire again until `apRange` is reset (by `setInteraction`/`clearInteraction`, `Engine-TS/src/engine/entity/PathingEntity.ts:541`, `Engine-TS/src/engine/entity/PathingEntity.ts:567`, or `p_aprange`).
   4. **Default op**: the target is a player/NPC or `allowOpScenery`, and `inOperableDistance`; since branch 1 has the same conditions plus `opTrigger`, this means "no op trigger". `defaultOp()` writes "Nothing interesting happens." (and, only when not `production` **and** there is neither an op nor an ap trigger, "No trigger for [...]", `Engine-TS/src/engine/entity/Player.ts:1123`; branch 4 can be reached with an ap trigger present, when the player is outside approach distance), clears the waypoints, and the branch returns `true`. Source: `Engine-TS/src/engine/entity/Player.ts:1226-1229`, `Engine-TS/src/engine/entity/Player.ts:1119-1144`

   Otherwise `false`.

7. **Distance checks.**
   - **Operable** (`Player.inOperableDistance`, `Engine-TS/src/engine/entity/Player.ts:1146-1158`): same level required. A player/NPC target uses `reachedEntity`, a loc `reachedLoc` with its `angle`, `shape` and `LocType.forceapproach`, an obj `reachedEntity || reachedObj`. These are `rsmod.reached(...)` with shape `-2` (entity), the loc's shape, or `-1` (obj) (`Engine-TS/src/engine/GameMap.ts:428-438`). What `rsmod.reached` accepts (e.g. diagonals) was not read.
   - **Approach** (`PathingEntity.inApproachDistance`, `Engine-TS/src/engine/entity/PathingEntity.ts:422-436`): same level; `false` if the target is a player/NPC whose area overlaps the player's ("not allowed on same tile"); otherwise `CoordGrid.distanceTo(this, target) <= range && isApproached(...)`. `distanceTo` is the Chebyshev distance between the closest tiles of the two areas (`Engine-TS/src/engine/CoordGrid.ts:60-73`). `isApproached` is `rsmod.hasLineOfSight(..., CollisionFlag.BLOCK_NPC_AND_PLAYERS)` (`Engine-TS/src/engine/GameMap.ts:467-469`); line-of-sight internals not read.
   - `apRange` starts at 10 for every new interaction (`Engine-TS/src/engine/entity/PathingEntity.ts:541`).

8. **Trigger lookup.** `getOpTrigger()` looks up `targetOp + 7` and `getApTrigger()` looks up `targetOp`, each keyed by the target's NPC/loc/obj type id and category, with the type id replaced by `targetSubject.com` when set (`Engine-TS/src/engine/entity/Player.ts:986-1052`). The op handlers store the **ap** trigger value (e.g. `APLOC1 + (op - 1)`, `Engine-TS/src/network/game/client/handler/OpLocHandler.ts:44-46`), and `APLOC1 = 59`, `OPLOC1 = 66` (`Engine-TS/src/engine/script/ServerTriggerType.ts:56`, `Engine-TS/src/engine/script/ServerTriggerType.ts:63`), as already traced in [`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md) section 4. The `Interaction` argument to `setInteraction` (`SCRIPT` or `ENGINE`, `Engine-TS/src/engine/entity/Interaction.ts:1-4`) is unused (`_interaction`, `Engine-TS/src/engine/entity/PathingEntity.ts:534`), so it makes no difference to any of the above.

9. **Op versus ap priority.** Branch 1 is tested first, so when both an op and an ap script exist and the op conditions hold, the op runs. For a **loc/obj in the pre-move attempt** (`allowOpScenery = false`), branch 1 can never pass, so an existing ap script runs instead whenever the player is within approach distance. Rests on rule 6.

### No interaction yet: pathing, walk trigger, movement, post-move attempt (step 8.3)

10. **`pathToPathingTarget` re-paths only toward players/NPCs.** Source: `Engine-TS/src/engine/entity/Player.ts:1054-1084`
    - If the target is not a player/NPC (a loc/obj, or none): nothing. A loc/obj interaction relies on the waypoints already queued (the client route from `MOVE_OPCLICK`, [`../flows/move-opclick.md`](../flows/move-opclick.md) section 3; or `p_oploc`'s single waypoint).
    - **Follow** (op 3 on a player), when at or before the last waypoint (`waypointIndex <= 0`, `Engine-TS/src/engine/entity/PathingEntity.ts:404-406`): `queueWaypoint(target.followX, target.followZ)`, i.e. the tile the followed player last stepped from (rule 4). This happens **before** the `canAccess()` check, so a delayed or busy player keeps following.
    - Otherwise it returns if `!canAccess()`.
    - With `MoveStrategy.NAIVE`, which a player has when `clientRoutefinder` is on (the default; `Engine-TS/src/engine/entity/Player.ts:423`, `Engine-TS/src/util/WorldConfig.ts:103`):
      - standing under the target: `randomWalk()`, one waypoint to a random adjacent tile (`Engine-TS/src/engine/entity/PathingEntity.ts:438-447`);
      - else at the last waypoint: `naivePathToTarget()`, which queues `findNaivePath(...)` when there is no waypoint or the destination is more than 1 tile (per axis) from the target (`Engine-TS/src/engine/entity/Player.ts:1086-1102`).
    - With `SMART` (`clientRoutefinder` off): at the last waypoint, `pathToTarget()`, which for a player/NPC target queues `findPathToEntity(...)` (`Engine-TS/src/engine/entity/PathingEntity.ts:465-472`).
    - `queueWaypoint` and `queueWaypoints` **replace** the whole waypoint list (`Engine-TS/src/engine/entity/PathingEntity.ts:259-275`).

11. **Follow is cleared when no waypoints remain.** Source: `Engine-TS/src/engine/entity/Player.ts:1277-1285`
    ```ts
            // Process walktrigger if there is waypoints
            if (this.hasWaypoints() && this.canAccess()) {
                this.processWalktrigger();
            }

            // If a stun clears the Player's waypoints, clear the interaction
            if (!this.hasWaypoints() && followOp) {
                this.clearInteraction();
            }
    ```
    For a follow op, rule 10 always queues a waypoint when `waypointIndex <= 0`, so the follow is cleared here only if something between rule 10 and this line cleared the waypoints; the only call in between is the walk trigger script (rule 20).

12. **Movement gate in `updateMovement`.** Source: `Engine-TS/src/engine/entity/Player.ts:674-678`
    ```ts
    updateMovement(): boolean {
        // players cannot walk if they have a modal open *and* something in their queue, confirmed as far back as 2005
        if (this.moveClickRequest && this.busy() && (this.queue.head() != null || this.engineQueue.head() != null)) {
            return false;
        }
    ```
    All three must hold to block movement:
    - `moveClickRequest` (set in phase 2 for a move-only tick or an op accepted while busy, and kept from earlier ticks otherwise; [`02-clients-in.md`](02-clients-in.md) rules 12-13);
    - `busy()` **now**, i.e. `delayed` or a `MAIN`/`CHAT` modal at this point of phase 5 (05 rule 8);
    - a non-empty normal `queue` or `engineQueue` (the weak queue does not count).

    **There is no other `delayed`, modal or `protect` check on movement.** A delayed or busy player with waypoints walks unless all three hold (see Inferences). `updateMovement` has one caller, `processInteraction` (grep, `Engine-TS/src/engine/entity/Player.ts:1287`).

13. **Speed: walk or run, chosen at the moment of moving.** Source: `Engine-TS/src/engine/entity/Player.ts:680-687`
    ```ts
        if (this.moveSpeed !== MoveSpeed.INSTANT) {
            this.moveSpeed = this.defaultMoveSpeed();
            if (this.runanim === -1) {
                this.moveSpeed = MoveSpeed.WALK;
            } else if (this.tempRun) {
                this.moveSpeed = MoveSpeed.RUN;
            }
        }
    ```
    - The default is `RUN` if the `run` field is set, else `WALK`; `p_run` and `updateEnergy` write `run` together with the `RUN` varp (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1269-1274`, rule 22) (`Engine-TS/src/engine/entity/Player.ts:729-731`).
    - It is forced to `WALK` when `runanim === -1`, else forced to `RUN` when `tempRun` is set. `tempRun` is set from ctrl-click by `MoveClickHandler` (0 when `runenergy < 100`; [`../flows/move-opclick.md`](../flows/move-opclick.md) section 3) or to 1 by `p_temprun` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1276-1278`).
    - `INSTANT` is kept. It is set by `teleJump`, by a teleport that changes level, provided the teleport was not refused for an unallocated zone (a refused teleport returns early, unless the player has staff level 3 or more, `Engine-TS/src/engine/entity/PathingEntity.ts:293-298`) (`Engine-TS/src/engine/entity/PathingEntity.ts:281-285`, `Engine-TS/src/engine/entity/PathingEntity.ts:315-318`) and by `onReconnect` (`Engine-TS/src/engine/entity/Player.ts:575`), and reset to the default only by `resetPathingEntity()` in phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:594`). `processMovement` does not move an `INSTANT` entity (rule 14), so **a player does not walk in the tick of a `p_telejump` or level-changing teleport made before its movement step**.

14. **At most one step walking, two running, per tick.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:135-152`
    ```ts
    processMovement(): boolean {
        if (!this.hasWaypoints() || this.moveSpeed === MoveSpeed.STATIONARY || this.moveSpeed === MoveSpeed.INSTANT) {
            return false;
        }
    // ...
        } else if (this.walkDir === -1) {
            // either walk or run speed here.
            this.walkDir = this.validateAndAdvanceStep();
            if (this.moveSpeed === MoveSpeed.RUN && this.walkDir !== -1 && this.runDir === -1) {
                this.runDir = this.validateAndAdvanceStep();
            }
        }
        return true;
    }
    ```
    - One `validateAndAdvanceStep()` is one tile. Walking makes one call; running makes a second call only if the first step moved (`walkDir !== -1`).
    - `walkDir`/`runDir` are reset to -1 only in phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:595-596`), and `updateMovement` is called once per turn (rule 12), so a player never takes more than 2 steps in a tick.
    - A player is never `CRAWL` or `STATIONARY`: rule 13 only produces `WALK`, `RUN` or keeps `INSTANT` (`MoveSpeed` values: `Engine-TS/src/engine/entity/MoveSpeed.ts:1-7`).
    - `processMovement` returns `true` whenever there are waypoints and the speed is `WALK`/`RUN`, **even if no step was taken** (blocked). When it returns `false` (no waypoints, or `INSTANT`), `updateMovement` sets `tempRun = 0` (`Engine-TS/src/engine/entity/Player.ts:689-692`). [`../flows/move-opclick.md`](../flows/move-opclick.md) section 5 step 2 has been corrected to include the `INSTANT` case.

15. **One step: `validateAndAdvanceStep` and `takeStep`.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:206-252`, `Engine-TS/src/engine/entity/PathingEntity.ts:633-679`
    - If the entity has no collision strategy or a `NULL` block flag, the waypoints are cleared (never for a player: `getCollisionStrategy()` is `NORMAL` for non-NPCs and a player's flag is `BLOCK_NPC_AND_PLAYERS`, `Engine-TS/src/engine/entity/PathingEntity.ts:571-591`, `Engine-TS/src/engine/entity/Player.ts:725-727`).
    - `takeStep()` heads for `waypoints[waypointIndex]` by the sign of the x/z difference. It tries, in order: the diagonal (only for width 1), then the x part, then the z part, each checked by `canTravel`; otherwise no move. `FLY` skips collision. There is no path search between waypoints (`Engine-TS/src/engine/entity/PathingEntity.ts:652-678`). `canTravel` also refuses a members tile on a free world (`Engine-TS/src/engine/GameMap.ts:440-445`).
    - The position is updated and `refreshZonePresence` moves the player's collision marker and zone membership, even when the step did not move (`Engine-TS/src/engine/entity/PathingEntity.ts:226-231`, `Engine-TS/src/engine/entity/PathingEntity.ts:161-189`).
    - Reaching the current waypoint pops it (`waypointIndex--`). A blocked step does **not** pop it, so it is retried next tick.
    - A real step sets the facing angle one tile further along the step direction (no mask), increments **`stepsTaken`**, and returns the direction.

16. **`stepsTaken` and `lastMovement`.**
    - `stepsTaken` counts real steps this tick (0, 1 or 2). It is reset to 0 only in phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:602`) and incremented only in `validateAndAdvanceStep` (`Engine-TS/src/engine/entity/PathingEntity.ts:247`), so it is 0 at the start of every player's step 8.
    - Its readers (grep) are all in this part of phase 5: the post-move attempt and "can't reach" check (`Engine-TS/src/engine/entity/Player.ts:1290-1293`), the map-flag clear (`Engine-TS/src/engine/entity/Player.ts:1311`), `reorient()` (`Engine-TS/src/engine/entity/PathingEntity.ts:387`), `updateEnergy()` (`Engine-TS/src/engine/entity/Player.ts:705`) and `updateMovement`'s return value. No later phase reads it.
    - If `stepsTaken > 0`, `lastMovement = currentTick + 1` (`Engine-TS/src/engine/entity/Player.ts:694-696`). `p_arrivedelay` does nothing when `lastMovement < currentTick` and otherwise delays the player one tick (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:359-367`). So it delays when the player stepped in the previous tick, or earlier in the current tick.

17. **Post-move attempt and "I can't reach that!".** Source: `Engine-TS/src/engine/entity/Player.ts:1287-1297`
    ```ts
            this.updateMovement();
            // If there's a target and p_access is available, try to interact after moving
            if (this.target && this.canAccess() && !followOp) {
                interacted = this.tryInteract(this.stepsTaken === 0);

                // If Player did not interact, has no path, and did not move this cycle, terminate the interaction
                if (!interacted && !this.apRangeCalled && !this.hasWaypoints() && this.stepsTaken === 0) {
                    this.messageGame("I can't reach that!");
                    this.clearInteraction();
                }
            }
    ```
    - `allowOpScenery` is `true` only if the player took **no** step this tick. So an **op on a loc/obj fires only in a tick in which the player did not move** and is in operable distance. An op on a player/NPC can fire right after moving, in the arrival tick.
    - The message and clear need all of: a target, `canAccess()`, not a follow op, no interaction now, `p_aprange` not called this tick, no waypoints left, and no step this tick. A busy or delayed player is never told "I can't reach that!" and keeps its target.

18. **The second attempt can re-run an ap script in the same tick.** If the pre-move ap script called `p_aprange`, branch 2 returned `false` (rule 6) and step 8.3 runs. The post-move `tryInteract` runs the ap script again (resetting `apRangeCalled` first, `Engine-TS/src/engine/entity/Player.ts:1186-1188`) only if all of these hold:
    - the first ap script did not set a new interaction (if it did, `nextTarget` is set and branch 2 returned `true`, `Engine-TS/src/engine/entity/Player.ts:1206-1208`, so step 8.3 never runs);
    - the target is still set and `canAccess()` is still true after that script (`Engine-TS/src/engine/entity/Player.ts:1289`). A first ap script that called `p_delay`, opened a main/chat modal or stopped suspended fails this: `p_delay` sets `delayed`, and `executeScript` leaves `protect = true` on a suspended protected script (`Engine-TS/src/engine/entity/Player.ts:2216-2219`);
    - the op branch does not win first: no op trigger, or not in operable distance, or a loc/obj target after a step this tick (`Engine-TS/src/engine/entity/Player.ts:1170`);
    - the player is then within the new `apRange` with line of sight (`Engine-TS/src/engine/entity/Player.ts:1186`).

    If instead the op branch wins in the post-move attempt, see rule 19 for the `apRangeCalled` case. An op script, a non-`p_aprange` ap script or a default op that ran in the pre-move attempt returns `true` and skips step 8.3 entirely: **no movement in that tick**, and the waypoints were already cleared (rule 6).

### End of `processInteraction` (steps 8.4-8.5)

19. **What happens to the target afterwards.** Source: `Engine-TS/src/engine/entity/Player.ts:1300-1313`
    ```ts
        // If a script called p_op*, then nextTarget is prepped for next cycle
        if (this.nextTarget) {
            this.target = this.nextTarget;
        }

        // Otherwise, the interaction ran
        else if (interacted && !this.apRangeCalled) {
            this.clearInteraction();
        }

        // Remove mapflag if there are no waypoints
        if (!this.hasWaypoints() && this.stepsTaken > 0) {
            this.unsetMapFlag();
        }
    ```
    - A script that called `setInteraction` (`p_oploc`, `p_opnpc`, `p_opnpct`, ...) leaves its new target, op and subject in place. `tryInteract` runs at most twice per turn (rules 5, 17), and a run that returns `true` is the last, so **the re-armed interaction is first tried on the next tick**.
    - Otherwise, if an interaction ran **and `apRangeCalled` is false**, the interaction is cleared (`Engine-TS/src/engine/entity/Player.ts:1306-1308`). `apRangeCalled` is reset only by the ap branch, `setInteraction`, `clearInteraction` and phase 11 (`Engine-TS/src/engine/entity/Player.ts:1188`, `Engine-TS/src/engine/entity/PathingEntity.ts:542`, `Engine-TS/src/engine/entity/PathingEntity.ts:568`, `Engine-TS/src/engine/entity/PathingEntity.ts:604`); the op branch and default op do not touch it. So if the pre-move ap script called `p_aprange` (`apRangeCalled = true`, branch 2 returns `false`, `Engine-TS/src/engine/entity/Player.ts:1210-1214`) and the post-move attempt then runs an **op** script or the default op without a new interaction being set, `interacted` is `true` but the interaction is **not cleared**: the target stays, and after phase 11 resets `apRangeCalled` the op can fire again on the next tick (see Inferences).
    - Reaching the end of the path in a tick where the player moved sends `UnsetMapFlag` at once.
    - Not reached when validation failed (rule 5).

**Everything that clears a player's target** (grep of `clearInteraction` callers plus the target writes in `tryInteract`):

| What | When | Source |
|---|---|---|
| Move (non-op) or op packet: `clearPendingAction()` | phase 2, while decoding | [`02-clients-in.md`](02-clients-in.md) rule 16; `Engine-TS/src/engine/entity/Player.ts:970-973` |
| `p_stopaction` / `p_clearpendingaction` (and `p_oploc`/`p_opnpc`, which call `stopAction()` before setting the new target) | whenever the script runs | `Engine-TS/src/engine/script/handlers/PlayerOps.ts:430-437`, `Engine-TS/src/engine/entity/Player.ts:964-967` |
| Target fails validation (needs `canAccess()`) | step 8.2, before moving | rule 5 |
| Follow with no waypoints | step 8.3.3 | rule 11 |
| "I can't reach that!" | step 8.3.5 | rule 17 |
| An interaction ran, no new one was set, and `apRangeCalled` is false (not cleared when a `p_aprange` ap script ran earlier in the same turn) | step 8.4 | rule 19 |
| Temporarily `null` while an op/ap script runs, then restored | inside `tryInteract` | rule 6 |

### Walk trigger

20. **`processWalktrigger` runs before the tick's step, at most once per set.** Source: `Engine-TS/src/engine/entity/Player.ts:1108-1117`
    ```ts
    processWalktrigger() {
        if (this.walktrigger !== -1 && !this.protect && !this.delayed) {
            const trigger = ScriptProvider.get(this.walktrigger);
            this.walktrigger = -1;
            if (trigger) {
                const script = ScriptRunner.init(trigger, this);
                this.runScript(script, true);
            }
        }
    }
    ```
    - **Set by:** the `walktrigger` script command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1092-1094`).
    - **Gate:** `walktrigger !== -1`, not `protect`, not `delayed`. It is cleared **before** the script runs.
    - **Call sites (grep):**
      - `MoveClickHandler` in phase 2, `clientRoutefinder` branch only ([`02-clients-in.md`](02-clients-in.md) rule 13);
      - the pre-move attempt (needs target, `canAccess()`, valid target, `clientRoutefinder`, not a follow op; rule 5);
      - step 8.3.2 (needs waypoints and `canAccess()`; rule 11).

      All three are before `updateMovement`, so the trigger fires **before the player's step in that tick**. In processInteraction, `canAccess()` is required, so an open main/chat modal also blocks it there.
    - **Run style:** `runScript(script, true)`, not `executeScript`: it is protected while it runs, and its return state is ignored (`Engine-TS/src/engine/entity/Player.ts:2171-2200`). A walk-trigger script that suspends is therefore not stored as `activeScript` (see Inferences).
    - **Effects on the same tick:** the script runs before the step, so whatever it does (e.g. `p_delay`, a teleport, clearing waypoints) applies to that tick's movement as in rules 12-14.

### After movement (steps 9-11)

21. **`reorient` faces a loc/obj only once the player stands still.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:383-392`
    ```ts
    reorient(): void {
        if (this.target instanceof PathingEntity) {
            return;
        }
        if (this.targetX !== -1 && this.stepsTaken === 0) {
            this.focus(this.targetX, this.targetZ, true);
            this.targetX = -1;
            this.targetZ = -1;
        }
    }
    ```
    - `targetX/Z` is written only by `setInteraction` for a loc/obj target (the centre of its area in fine units) and cleared only here (grep; `Engine-TS/src/engine/entity/PathingEntity.ts:555-558`).
    - `clearInteraction` does not clear `targetX/Z`, and the check does not need a current target (`target` may be `null` after step 8). So when a loc/obj op ran this tick (which needs `stepsTaken === 0`, rule 17) and `targetX/Z` is still pending (it is consumed on the first zero-step tick after `setInteraction`, and `p_oploc` re-sets it), step 9 turns the player toward the loc, with `faceSquareX/Z` and the `FACE_COORD` mask set.
    - It must come after movement because it reads this tick's `stepsTaken` (rule 16).

22. **Run energy is updated after movement, from this tick's steps.** Source: `Engine-TS/src/engine/entity/Player.ts:701-723`
    ```ts
    updateEnergy() {
        if (this.delayed) {
            return;
        }
        if (this.stepsTaken < 2) {
            const recovered = ((this.baseLevels[PlayerStat.AGILITY] / 6) | 0) + 8;
            this.runenergy = Math.min(this.runenergy + recovered, 10000);
        } else {
            const weightKg = this.runweight / 1000;
            const clampWeight = Math.min(Math.max(weightKg, 0), 64);
            const loss = (67 + (67 * clampWeight) / 64) | 0;
            this.runenergy = Math.max(this.runenergy - loss, 0);
        }

        if (this.runenergy === 0) {
            this.run = 0;
            // todo: better way to sync engine varp
            this.setVar(VarPlayerType.RUN, this.run);
        }
        if (this.runenergy < 100) {
            this.tempRun = 0;
        }
    }
    ```
    - **Scale:** `runenergy` is 0-10000.
    - **Delayed:** a player that is `delayed` at this point (including one delayed earlier in this same turn) neither regains nor loses energy, and the zero/`tempRun` checks are skipped.
    - **Regain:** 0 or 1 steps (standing or walking, or "running" a single last tile) regains `floor(agility base level / 6) + 8` per tick.
    - **Drain:** 2 steps drains `floor(67 + 67 * w / 64)`, with `w` the carried weight in kg clamped to 0-64.
    - **At 0:** `run = 0` and the `RUN` varp is set (sent if the varp is `transmit`, `Engine-TS/src/engine/entity/Player.ts:1765-1780`).
    - **Below 100:** `tempRun = 0`.
    - **Weight timing:** `runweight` is recomputed only in phase 10's `updateInvs` (its only caller, `Engine-TS/src/engine/World.ts:1116`), when that function has set `runWeightChanged` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:386-394`), so this uses the weight as of the previous tick's phase 10.
    - **Sending:** the new energy reaches the client in phase 10 `updateStats` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:326-329`, called at `Engine-TS/src/engine/World.ts:1118`). `UpdateRunEnergy` is written only when the value differs from `lastRunEnergy`, which is then updated (`Engine-TS/src/engine/entity/NetworkPlayer.ts:326-328`).
    - Because the speed was chosen in step 8 (rule 13) before energy is taken, a player with `run` on and energy above 0 runs 2 tiles this tick even if this drain empties the energy. `run` is switched off only afterwards.

23. **`validateDistanceWalked` sets `jump`, unless an exact move happened.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:324-335`
    ```ts
    validateDistanceWalked() {
        const distanceCheck =
            CoordGrid.distanceTo(this, {
                x: this.lastTickX,
                z: this.lastTickZ,
                width: this.width,
                length: this.length
            }) > 2;
        if (distanceCheck) {
            this.jump = true;
        }
    }
    ```
    - `lastTickX/Z` is the position stored in the previous tick's phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:599-600`).
    - It sets `jump`, never `tele`, and never clears either. Phase 11 resets both (`Engine-TS/src/engine/entity/PathingEntity.ts:597-598`).
    - **Skipped for `EXACT_MOVE`** (`Engine-TS/src/engine/World.ts:724-726`). That mask is set only by `Player.exactMove` (grep), which `p_exactmove` calls after `unsetMapFlag()` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:939-947`). `exactMove` teleports to the end tile on the same level, which sets `tele` but not `jump`, and stores the exact-move parameters (`Engine-TS/src/engine/entity/Player.ts:2107-2117`, `Engine-TS/src/engine/entity/PathingEntity.ts:287-319`).
    - **Readers of `jump`:**
      - phase 10 (inside `rsbuf.playerInfo`, called from `NetworkPlayer.updatePlayers`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:286-288`, `Engine-TS/src/engine/World.ts:1110`; phase 9 only copies `jump` into the rsbuf record, `Engine-TS/src/network/rsbuf/index.ts:90`; see [`09-info.md`](09-info.md)) for the local player, only inside the teleport block, which is written when `tele` is set (`Engine-TS/src/network/rsbuf/info.ts:51-65`, `Engine-TS/src/network/rsbuf/info.ts:135-141`);
      - phase 10 when another player is added to an observer's list (`Engine-TS/src/network/rsbuf/info.ts:119-127`);
      - phase 10 `updateAfkZones`, together with `moveSpeed === INSTANT` (`Engine-TS/src/engine/entity/Player.ts:2128-2141`).

      What the client does with the bit was not read.

### Busy, modal, delay and protect, by step

24. Summary of the gates in steps 6-11 (rules 5-23; `canAccess()` = not `protect`, not `delayed`, no main/chat modal, or world shutdown; 05 rule 8):

    | Step | `delayed` | Main/chat modal open | `protect` set |
    |---|---|---|---|
    | 6-7 facing | runs | runs | runs |
    | 8.2 validation, walk trigger, pre-move `tryInteract` | skipped | skipped | skipped |
    | 8.3.1 re-path to player/NPC | skipped (follow still re-paths) | skipped (follow still re-paths) | skipped (follow still re-paths) |
    | 8.3.2 walk trigger | skipped | skipped | skipped |
    | 8.3.4 movement | moves, unless `moveClickRequest` and normal/engine queue non-empty | same as delayed | moves (`protect` is not part of `busy()`) |
    | 8.3.5 post-move `tryInteract`, "can't reach" | skipped | skipped | skipped |
    | 9 `reorient` | runs | runs | runs |
    | 10 `updateEnergy` | returns early | runs | runs |
    | 11 `validateDistanceWalked` | runs | runs | runs |

    The `delayed`, modal and `protect` values seen here are those **after** steps 1-5, so a queue, timer or engine-queue script in steps 3-5 that calls `p_delay` or opens a main/chat modal stops the interaction from firing this tick (05 rules 4, 14). Phase 2 makes the modal case rare for a fresh click: move (non-op) and op packets close the modal, and are refused while `delayed` ([`02-clients-in.md`](02-clients-in.md) rules 15-16).

### Exceptions

25. None of `setFaceEntity`, `reorientEntity`, `processInteraction`, `tryInteract`, `updateMovement`, `reorient`, `updateEnergy` or `validateDistanceWalked` has a `try`. An exception from engine code in steps 6-11 ends the player's turn: the remaining steps are skipped for this tick, and the per-player `catch` sends `Logout` and closes the socket for a connected client (05 rule 3, `Engine-TS/src/engine/World.ts:727-733`). Script errors inside an op/ap/walk-trigger script are caught by `ScriptRunner.execute` and do not get here (05 rule 3).

### State this part of the phase writes (for later phases)

26. Per player:
    - **Position and movement:** `x`, `z`, collision and zone membership (rule 15); `walkDir`, `runDir`, `stepsTaken`, `lastStepX/Z`, `lastMovement`, `waypoints`/`waypointIndex`, `moveSpeed`, `tempRun`, `followX/Z`.
    - **Interaction:** `target`, `targetOp`, `targetSubject`, `apRange`, `apRangeCalled`, `nextTarget`, `targetX/Z`, `walktrigger`.
    - **Facing and masks:** `faceEntity`, `faceAngleX/Z`, `faceSquareX/Z`, `masks` (`FACE_ENTITY`, `FACE_COORD`).
    - **Run:** `runenergy`, `run` and its varp, `jump`.
    - **Packets:** `UnsetMapFlag` and game messages, written immediately.
    - **Script effects:** anything the op/ap/walk-trigger scripts do.

    **Who reads it next** (as cited above):
    - **Phase 9** passes `x`, `z`, `tele`, `jump`, `runDir`, `walkDir`, `masks`, `faceEntity`, `faceSquareX/Z` and `faceAngleX/Z` to `rsbuf.computePlayer` (`Engine-TS/src/engine/World.ts:1006-1026`). Its comment says facing is not done there (`Engine-TS/src/engine/World.ts:1001`).
    - **Phase 10** sends run energy (rule 22) and reads `jump`/`moveSpeed` in `updateAfkZones` (rule 23).
    - **Phase 11** resets `walkDir`, `runDir`, `jump`, `tele`, `stepsTaken`, `apRangeCalled`, `masks`, `faceSquareX/Z`, `lastTickX/Z` and `moveSpeed`, then re-runs `setFaceEntity()` (`Engine-TS/src/engine/entity/PathingEntity.ts:593-631`).
    - A player processed **later** in the same phase 5 (`playerLoop` order) sees this player's new position and `followX/Z`.

## Player versus NPC (phase 5 vs phase 4)

| Aspect | Player (this note) | NPC ([`04b-npc-modes.md`](04b-npc-modes.md)) |
|---|---|---|
| Facing order | `setFaceEntity`, `reorientEntity` **before** `processInteraction`, `reorient` after (`Engine-TS/src/engine/World.ts:713-719`) | `reorientEntity`, `reorient`, `setFaceEntity`, all **after** `processMovementInteraction` (`Engine-TS/src/engine/entity/Npc.ts:181-189`) |
| Jump check | only without `EXACT_MOVE` | always (`Engine-TS/src/engine/entity/Npc.ts:191`) |
| Steps per tick | 1 walking, 2 running (rule 14) | see 04b rule 16 |

## Comment-versus-code check

`World.ts` comments in `processPlayers` (`Engine-TS/src/engine/World.ts:710-721`):
- "Face the interaction target -- both halves, the same tick the op set the target (the op ran in processClientsIn) and before processInteraction can clear it: the FACE_ENTITY mask, plus the serverside faceAngle toward a pathing target (for new observers)." (`Engine-TS/src/engine/World.ts:710-712`): **matches**. `setFaceEntity` sets the `FACE_ENTITY` mask on change, `reorientEntity` sets only `faceAngleX/Z` for a player/NPC target, both before `processInteraction`, which can clear the target (rules 1-3, 19). "For new observers": the angle is used when an observer adds the player, but only if `faceSquareX/Z` is unset (rule 2). "The op ran in processClientsIn" means the op **packet**; the op **script** runs later, in `processInteraction`.
- "- interactions - movement" (`Engine-TS/src/engine/World.ts:715-716`): **matches loosely**. Both are inside `processInteraction`, but the order is interaction attempt, movement, second interaction attempt (rules 5, 12, 17), not interactions then movement.
- "After movement: face a loc/obj target if we walked over and held still (needs stepsTaken)." (`Engine-TS/src/engine/World.ts:718`): **matches** (rule 21), with one difference: it fires on any tick with zero steps while a loc/obj facing tile is pending, including when the player did not walk at all and when the target has already been cleared.
- "- run energy" (`Engine-TS/src/engine/World.ts:721`): **matches**.
- The `EXACT_MOVE` condition (`Engine-TS/src/engine/World.ts:724`) has no comment.

Functions read:
- `PathingEntity.reorientEntity` doc "Refreshed every turn BEFORE movement ... captures the target before processInteraction can clear it" (`Engine-TS/src/engine/entity/PathingEntity.ts:363-369`): **matches for players** (for NPCs it is a mismatch, [`04b-npc-modes.md`](04b-npc-modes.md) comment check).
- `PathingEntity.reorient` doc "MUST run AFTER movement so stepsTaken reflects this tick. client=true: this is the only path that ships the face-coord for loc/obj facing" (`Engine-TS/src/engine/entity/PathingEntity.ts:377-382`): **matches**. The only other `focus(..., true)` callers are the explicit face-square commands (`Engine-TS/src/engine/entity/Player.ts:1983-1985`, `Engine-TS/src/engine/entity/Npc.ts:520`).
- `targetX` "this is only used to hack in the turning after walking on non pathing entity" (`Engine-TS/src/engine/entity/PathingEntity.ts:70-73`): **matches** (rule 21).
- `faceAngleX` "sent on first add" (`Engine-TS/src/engine/entity/PathingEntity.ts:75-77`): **partly**. It is the fallback after `faceSquareX/Z` (rule 2).
- `setInteraction` "Setting an interaction no longer focus()es here ..." (`Engine-TS/src/engine/entity/PathingEntity.ts:552-554`): **matches**.
- `processMovement` doc (`Engine-TS/src/engine/entity/PathingEntity.ts:124-134`): **partly mismatched**.
  - "Handles force movement": there is no force-movement code in it.
  - "Updates this PathingEntity zone presence if moved": zone presence is refreshed on every step attempt, moved or not (`Engine-TS/src/engine/entity/PathingEntity.ts:230-231`).
  - "Returns false is this PathingEntity has no waypoints. Returns true if a step was taken": it also returns `false` for `STATIONARY`/`INSTANT`, and returns `true` whenever it tried, even if blocked (rule 14).
- `validateAndAdvanceStep` doc "Deques to the next step if reached the end of current step, then attempts to look for a possible second next step, validates and repeats" (`Engine-TS/src/engine/entity/PathingEntity.ts:191-205`): **mismatch**. One call takes at most one step; the second (run) step is a second call from `processMovement` (rule 14). "A PathingEntity can persist their current step for example if blocked": **matches** (rule 15).
- Inline comments in `validateAndAdvanceStep` ("Clear waypoints if no movement is allowed", "Refresh zone presence if we had a waypoint, even if we didn't move", "If we actually moved, update orientation and steps taken", `Engine-TS/src/engine/entity/PathingEntity.ts:210`, `Engine-TS/src/engine/entity/PathingEntity.ts:230`, `Engine-TS/src/engine/entity/PathingEntity.ts:241`): **match**.
- `validateDistanceWalked` doc "Check if the number of tiles moved is > 2, we use Teleport for this PathingEntity." (`Engine-TS/src/engine/entity/PathingEntity.ts:321-323`): **imprecise**. It measures the size-aware Chebyshev distance from last tick's position, not tiles walked, and it sets `jump`, not `tele` (rule 23).
- `updateMovement` "players cannot walk if they have a modal open *and* something in their queue, confirmed as far back as 2005" (`Engine-TS/src/engine/entity/Player.ts:675`): **partly**. The code also requires `moveClickRequest`; "modal open" is `busy()`, which also includes `delayed`; and "queue" is the normal queue or the engine queue, not the weak queue (rule 12). The 2005 claim cannot be checked from code.
- `updateMovement` "todo: this is running every idle tick" (`Engine-TS/src/engine/entity/Player.ts:690`): **matches**. `tempRun = 0` runs on every tick without waypoints (rule 14).
- `processWalktrigger` "we process walktriggers from regular movement in client input, and for each interaction" (`Engine-TS/src/engine/entity/Player.ts:1104-1107`): **partly**. Client input only with `clientRoutefinder` ([`02-clients-in.md`](02-clients-in.md) comment check). In `processInteraction` it is called whenever there are waypoints and `canAccess()` (step 8.3.2), with or without an interaction, and once more in the pre-move attempt (rule 20).
- `hasInteraction` "The follow interaction doesn't do anything" (`Engine-TS/src/engine/entity/Player.ts:979`): **matches** (no op/ap script; following is done by re-pathing, rule 10).
- `stopAction` "clear current interaction and walk queue" and `clearPendingAction` "clear current interaction but leave walk queue intact" (`Engine-TS/src/engine/entity/Player.ts:963`, `Engine-TS/src/engine/entity/Player.ts:969`): **match**, but neither mentions that both also call `closeModal()`.
- `tryInteract`:
  - "allowOpScenery controls if Locs and Objs can be op'd" (`Engine-TS/src/engine/entity/Player.ts:1169`): **matches**.
  - "If p_opnpc was called, remember it for later" (`Engine-TS/src/engine/entity/Player.ts:1178`, `Engine-TS/src/engine/entity/Player.ts:1200`, `Engine-TS/src/engine/entity/Player.ts:1205`): **narrower than the code**. Any `setInteraction` call by the script (`p_oploc`, `p_opnpc`, `p_opnpct`, ...) is captured.
  - "if aprange was called then we did not interact." (`Engine-TS/src/engine/entity/Player.ts:1209`): **matches**.
  - "Run the default apTrigger. This is the ap analog to the "NIH" default op" (`Engine-TS/src/engine/entity/Player.ts:1219`): **misleading**. No script runs; the branch sets `apRange = -1` and returns `false`, so that later attempts can only use the op branches (rule 6).
  - "Run the default opTrigger if within range" (`Engine-TS/src/engine/entity/Player.ts:1225`): **matches** (`defaultOp`).
- `processInteraction`:
  - "If there is a target and p_access is available, try to interact before movement" (`Engine-TS/src/engine/entity/Player.ts:1256`): **matches**.
  - "Clear the interaction if target validation does not pass" (`Engine-TS/src/engine/entity/Player.ts:1258`): **matches**, and the code also clears the waypoints and skips movement for the tick.
  - "Recalc path" (`Engine-TS/src/engine/entity/Player.ts:1274`): only for player/NPC targets and only at the last waypoint (rule 10).
  - "Process walktrigger if there is waypoints" (`Engine-TS/src/engine/entity/Player.ts:1277`): also needs `canAccess()`.
  - "If a stun clears the Player's waypoints, clear the interaction" (`Engine-TS/src/engine/entity/Player.ts:1282`): applies only to follow ops (rule 11).
  - "try to interact after moving" (`Engine-TS/src/engine/entity/Player.ts:1288`): also not for follow ops.
  - "If Player did not interact, has no path, and did not move this cycle, terminate the interaction" (`Engine-TS/src/engine/entity/Player.ts:1292`): **matches**, plus `!apRangeCalled`.
  - "If a script called p_op*, then nextTarget is prepped for next cycle" (`Engine-TS/src/engine/entity/Player.ts:1300`): **matches** (rule 19).
  - "Otherwise, the interaction ran" (`Engine-TS/src/engine/entity/Player.ts:1305`): condition is `interacted && !apRangeCalled`.
  - "Remove mapflag if there are no waypoints" (`Engine-TS/src/engine/entity/Player.ts:1310`): also requires `stepsTaken > 0`.
- `inApproachDistance` "pathing entity has a -2 shape basically (not allow on same tile) for ap" (`Engine-TS/src/engine/entity/PathingEntity.ts:427-428`): **matches** the overlap check. The Npc-only comment at `Engine-TS/src/engine/entity/PathingEntity.ts:431` does not apply to players.
- `Player.naivePathToTarget` "If no waypoint, or waypoint is further than 1 tile from target, set new dest" (`Engine-TS/src/engine/entity/Player.ts:1097`): **matches** (per-axis distance of `waypoints[0]`, the destination). It passes a variable named `angle` in the parameter position named `extraFlag` of `findNaivePath` (`Engine-TS/src/engine/entity/Player.ts:1099`, `Engine-TS/src/engine/GameMap.ts:365-367`). For players this is always 0, because the method is reached only with a player/NPC target (rule 10).
- `processInfo` "facing (reorientEntity/reorient) runs in the player's turn (processPlayers), not here." (`Engine-TS/src/engine/World.ts:1001`): **matches**.

## Inferences (labelled)

- **Inference: tick of the first op/ap script after a click.** Rests on:
  - an op packet decoded in phase 2 of tick T sets the target that tick ([`02-clients-in.md`](02-clients-in.md) rule 13);
  - phase 5 of the same tick runs `processInteraction` (rule 5);
  - rules 6, 14 and 17.

  Assuming the player stays accessible and the target valid:

  | Target | Already in range at T | Needs to walk; last step lands in tick A |
  |---|---|---|
  | Player/NPC, op script | T, pre-move (no step that tick) | A, post-move (in the same turn as the arrival step), or the pre-move attempt of the first tick in which the target is reachable before moving |
  | Loc/obj, op script | T, post-move, if no step is taken in T | A+1 (the arrival tick has `stepsTaken > 0`) |
  | Any, ap script | T, pre-move, if within `apRange` (10) with line of sight | the first pre- or post-move attempt within `apRange` |

  When both an op and an ap script exist, the op runs whenever its branch conditions hold, before the ap branch is considered (rule 9).

  Walking covers 1 tile per tick and running 2 (rule 14). A packet whose bytes reach the engine after tick T's `cycle()` has started (even during phase 1, before phase 2 runs) is decoded in T+1, because the socket `data` handler that buffers it runs only between ticks ([`02-clients-in.md`](02-clients-in.md) Position section; [`07-logouts-logins.md`](07-logouts-logins.md) rule 13 inference), which shifts everything by one tick; the exact boundary also depends on Node's event-loop ordering and on when the client flushes its output, neither read (`docs/open-questions.md` #46). NPCs move in phase 4, before players, so a player's checks use the NPC's position after its move this tick. Not observed.
- **Inference: a re-armed interaction (`p_oploc(n)` etc.) runs at the earliest on the next tick**, so a script loop like woodcutting's `p_oploc(3)` re-runs at most once per tick. Rests on rule 19. This narrows `docs/open-questions.md` #10 (actual chopping cadence still needs the content's `%action_delay` logic and a run).
- **Inference: a delayed or busy player keeps walking queued waypoints.** `p_delay` does not clear waypoints (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380`), and movement is blocked only by the three-part condition in rule 12. Phase 2 does clear the waypoints for a move/op packet that arrives while delayed ([`02-clients-in.md`](02-clients-in.md) rule 12). Whether content scripts clear waypoints (`p_stopaction`, `unsetmapflag`) before delaying was not checked. Not observed.
- **Inference: interacting with a delayed NPC is cancelled.** `Npc.isValid` is false while the NPC is delayed (rule 5), so the next accessible pre-move validation clears the player's interaction and waypoints and the player stops for that tick. The op handler's `setInteraction` also refuses a delayed NPC (`Engine-TS/src/engine/entity/PathingEntity.ts:535-537`). Not observed.
- **Inference: an op that follows a `p_aprange` ap script in the same turn can fire again on the next tick.** In the case in rule 19 the target is kept and `apRangeCalled` is reset in phase 11, so the next tick's attempts see the same target and, if still operable, run the op again, unless the op script itself cleared or replaced the interaction (e.g. `p_stopaction`). Rests on rules 6 and 19. Read, not observed; whether content ap scripts call `p_aprange` for targets that also have op scripts is `docs/open-questions.md` #32, observation is #33.
- **Inference: the `FACE_ENTITY` mask for a cleared target is sent one tick late.** If step 8 clears the target in tick T (e.g. after the op ran), `faceEntity` still holds the target in T's phase 9. Phase 11 of T then sets `faceEntity = -1` with the mask (rule 1), which is encoded in T+1's phase 9 and sent in T+1's phase 10 (`Engine-TS/src/network/rsbuf/info.ts:236-238`; engine side confirmed in [`09-info.md`](09-info.md) rule 18). Rests on rule 1 and the phase order. The client effect was not read. Not observed.
- **Inference: a stale `targetX/Z` can turn the player toward an old loc/obj.** `targetX/Z` survives `clearInteraction` and is cleared only by `reorient` on a zero-step tick while the target is not a player/NPC (rule 21). Example: click a loc, then cancel by walking. On the first tick the player stands still, it faces the loc it clicked earlier. Rests on rule 21 and the grep of `targetX` writers. Not observed.
- **Inference: following trails by one step, and the exact tile depends on `playerLoop` order.** The follower walks to `target.followX/Z`. The target sets that at the start of its own `processInteraction` from its `lastStepX/Z` (rules 4, 10). If the target's turn came earlier this tick, the follower sees the value from this tick's start; otherwise from the previous tick's. Not observed.
- **Inference: a walk-trigger script that suspends is lost.** `processWalktrigger` uses `runScript` and ignores the result, unlike `executeScript`, which stores a `SUSPENDED` script on the player (rule 20; 05 rule 6). A `p_delay` in such a script would set `delayed` with nothing left to resume. Whether content walk triggers suspend was not checked. Not observed.
- **Inference: `validateDistanceWalked` can only set `jump` after a teleport.** A player's position changes only by `takeStep` (at most 1 tile per step, 2 per tick) and `teleport` (which sets `tele`). A grep for position writes found only these, the `Entity` constructor and save loading (`Engine-TS/src/engine/entity/PathingEntity.ts:227`, `Engine-TS/src/engine/entity/PathingEntity.ts:303`, `Engine-TS/src/engine/entity/PlayerLoading.ts:69`). So a distance above 2 needs a teleport since last tick. The skip for `EXACT_MOVE` therefore keeps `jump` false for an exact move longer than 2 tiles, so its teleport-block bit is 0 (rule 23). Why the client needs that was not read.
- **Inference: an exception inside an op/ap script's engine wrapper loses the target.** `tryInteract` sets `target = null` before `executeScript` and restores it after (rule 6). If `executeScript` throws after the script ran (05 rule 3), the restore is skipped, the waypoints are already cleared, and the per-player `catch` ends the turn. Not observed.
- **Inference: during `World.shutdown`, an op on a delayed or protected player is consumed without running.** `canAccess()` is true during shutdown (05 rule 8), so `tryInteract` proceeds and clears the target and waypoints. `runScript` then refuses the protected script (05 rule 6), and `tryInteract` still returns `true`, so the interaction is cleared. Rests on rules 6 and 19. Not observed.

## Not checked / open questions

- The `rsmod` routefinder internals: `reached` (what counts as operable distance for each shape, diagonals), `hasLineOfSight`, `canTravel`, `findNaivePath`, `findPathToEntity`. Added to `docs/open-questions.md` #4.
- Whether an `IF_CLOSE` script run by `closeModal()` in phase 2 can reopen a main/chat modal and so make `busy()` true at the `moveClickRequest` check and at the `updateMovement` gate (rule 12). Content has 24 `[if_close,...]` scripts (grep); not read. Still `docs/open-questions.md` #4.
- What the client does with `jump`, `FACE_ENTITY`, `FACE_COORD` and `walkDir`/`runDir`; only the engine's encoder entry points were read. `docs/open-questions.md` #14 and #31.
- Content: which scripts use `walktrigger`, `p_aprange`, `p_arrivedelay`, `p_exactmove`, and whether walk-trigger scripts suspend. `docs/open-questions.md` #32.
- Whether a loc's `forceapproach` or an obj's double check (`reachedEntity || reachedObj`) changes when a loc/obj op fires: depends on `rsmod.reached`, not read. `docs/open-questions.md` #4.
- `onReconnect` (`Engine-TS/src/engine/entity/Player.ts:535-578`) was read only for its `moveSpeed`/`tele`/`jump` lines; when reconnects are processed in the tick was not traced.
- Nothing was run; none of the timings above was observed (`docs/open-questions.md` #33).

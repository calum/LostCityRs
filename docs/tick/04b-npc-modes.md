# Phase 4 (part 2): NPC modes, NPC-initiated interaction and movement

**Question answered:** In step 9 of `Npc.turn()` (`processMovementInteraction`), how is the NPC's mode chosen, what does each mode do per tick, where and how is the mode's target (usually a player) validated, how does an NPC run its `ai_op*`/`ai_ap*` scripts against a player, how does one movement step work, and what facing runs afterwards?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

Related notes: [`04-npcs.md`](04-npcs.md) (the per-NPC pipeline this step belongs to, the validity gate, hunt-target consumption), [`../flows/move-opclick.md`](../flows/move-opclick.md) (the player side of waypoints and stepping).

## Position in the tick

`processMovementInteraction()` is step 9 of `Npc.turn()`, after the NPC queue and before facing. Source: `Engine-TS/src/engine/entity/Npc.ts:178-189`
```ts
        // Queue
        this.processQueue();
        // Movement-Interactions
        this.processMovementInteraction();
        // ...
        this.reorientEntity();
        this.reorient();
        // Update target facing
        this.setFaceEntity();
```
`turn()` runs for each NPC in phase 4, `processNpcs` ([`04-npcs.md`](04-npcs.md)).

## L2: ordered sub-steps

Source: `Engine-TS/src/engine/entity/Npc.ts:585-626`

1. Return if the NPC is `delayed` or not `isActive`.
2. If `targetOp` is `NULL` (-1), set it to the type's `defaultmode`.
3. Targetless modes: `NONE` -> `noMode()`, `WANDER` -> `wanderMode()`, `PATROL` -> `patrolMode()`; return.
4. Otherwise, if there is no `target` or `validateTarget()` fails: `resetDefaults()` and return.
5. Targeted modes: `PLAYERESCAPE`, `PLAYERFOLLOW`, `PLAYERFACE`, `PLAYERFACECLOSE`, else `aiMode()` (all `OP*`/`AP*`/`QUEUE*` modes).

Each mode that moves calls `updateMovement()` itself (rule 15). After step 9, `turn()` runs the facing calls (rule 17).

## L3: ordering rules

### Mode selection and target validation

1. **Modes.** `targetOp` holds an `NpcMode` value for NPCs: `NULL = -1`, `NONE = 0`, `WANDER = 1`, `PATROL = 2`, `PLAYERESCAPE = 3`, `PLAYERFOLLOW = 4`, `PLAYERFACE = 5`, `PLAYERFACECLOSE = 6`, then `OPPLAYER1-5` (7-11), `APPLAYER1-5` (12-16), `OPLOC1-5`, `APLOC1-5`, `OPOBJ1-5`, `APOBJ1-5`, `OPNPC1-5`, `APNPC1-5` (17-46), `QUEUE1-20` (47-66). Source: `Engine-TS/src/engine/entity/NpcMode.ts:1-96`. The constructor sets `targetOp = npcType.defaultmode` (`Engine-TS/src/engine/entity/Npc.ts:99`); the type default is `WANDER` (`Engine-TS/src/cache/config/NpcType.ts:110`).

2. **Who sets the mode.** Besides the constructor (`Engine-TS/src/engine/entity/Npc.ts:99`) and the `NULL` failsafe (`Engine-TS/src/engine/entity/Npc.ts:591-594`, rule 3), these paths write `targetOp`:
   - `npc_setmode` (`Engine-TS/src/engine/script/handlers/NpcOps.ts:206-248`): `NONE`/`WANDER`/`PATROL` -> `clearInteraction()` then set the mode (and `clearPatrol()` for `PATROL`); `NULL` -> `resetDefaults()`; any other mode sets `targetOp = mode` first, then picks the target from the script's pointers by mode range (`>= OPNPC1`: `_activeNpc2` if `intOperand === 0`, else `_activeNpc`; `>= OPOBJ1`: `_activeObj`; `>= OPLOC1`: `_activeLoc`; else `_activePlayer`) and calls `setInteraction`; with no such pointer it calls `resetDefaults()`.
   - `consumeHuntTarget` -> `setInteraction(Interaction.SCRIPT, huntTarget, findNewMode)` ([`04-npcs.md`](04-npcs.md) rule 10).
   - `resetDefaults()` / `clearInteraction()` (rule 4).

   Grep of `Engine-TS/src` for `targetOp =` finds no other writer for NPCs (the remaining hits are in player code; the `clearInteraction()` calls in `ClientCheatHandler.ts` act on players, e.g. `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:442-449`).

   `setInteraction` returns `false` and changes nothing if `!target.isValid(...)`; otherwise it sets `target`, `targetOp`, resets `apRange`, records `targetSubject.type` for an NPC/loc/obj target (for the change-type check), and for a loc/obj records `targetX`/`targetZ` for facing. Source: `Engine-TS/src/engine/entity/PathingEntity.ts:534-561`
   ```ts
   setInteraction(_interaction: Interaction, target: Entity, op: TargetOp, com?: number): boolean {
   if (!target.isValid(this instanceof Player ? this.hash64 : undefined)) {
   return false;
   }
   this.target = target;
   this.targetOp = op;
   ```
   Because `npc_setmode` assigns `targetOp` before calling `setInteraction` and ignores its result (`Engine-TS/src/engine/script/handlers/NpcOps.ts:220`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:236-242`), an invalid target leaves the new mode paired with whatever `target` the NPC had before (see Inferences).

3. **Targetless modes skip validation.** Source: `Engine-TS/src/engine/entity/Npc.ts:590-606`
   ```ts
   // Failsafe
   if (this.targetOp === NpcMode.NULL) {
   const type: NpcType = NpcType.get(this.type);
   this.targetOp = type.defaultmode;
   }
   // Targetless modes
   if (this.targetOp === NpcMode.NONE) {
   this.noMode();
   return;
   } else if (this.targetOp === NpcMode.WANDER) {
   ```
   `NONE`, `WANDER` and `PATROL` never look at `target`.

4. **Targeted modes: validate first; on failure reset and do nothing else this tick.** Source: `Engine-TS/src/engine/entity/Npc.ts:608-612`
   ```ts
   // Validate target before running targeted modes
   if (!this.target || !this.validateTarget()) {
   this.resetDefaults();
   return;
   }
   ```
   The NPC does not move or run its default mode on that tick; the default mode first runs on its next turn. `resetDefaults()` calls `clearInteraction()` (target `null`, `targetOp` -> `NONE`), then sets `targetOp = type.defaultmode`, restores `huntMode` and `huntrange` from the type, sets `huntClock = 0`, `huntTarget = null`, and `timerInterval = type.timer`. Source: `Engine-TS/src/engine/entity/Npc.ts:424-441`, `Engine-TS/src/engine/entity/PathingEntity.ts:563-569`. It does not clear waypoints.

5. **`validateTarget()` checks, in order:** same `level`; `targetWithinMaxRange()`; for an NPC or loc target, that its `type` still equals the type recorded when the interaction was set (catches `changetype`); then for an NPC target only `isActive` (so a **delayed** NPC is still a valid target), otherwise `target.isValid()`. Source: `Engine-TS/src/engine/entity/Npc.ts:629-650`
   ```ts
   private validateTarget(): boolean {
   // Validate that the target is on the same floor
   if (this.target?.level !== this.level) {
   return false;
   }
   // Check maxrange
   if (!this.targetWithinMaxRange()) {
   return false;
   }
   ```
   For a player target, `isValid` is false while the player is `loggingOut` or not at `DEFAULT` visibility, and otherwise `isActive`. Source: `Engine-TS/src/engine/entity/Player.ts:2293-2303`. Player `busy()`/`delayed` is **not** checked: an NPC keeps a delayed player or a player with a modal open as a valid target.

6. **Max range is measured from the NPC's spawn point, not its current position.** `startX`/`startZ` are set only in the constructor (`Engine-TS/src/engine/entity/Npc.ts:83-85`; grep of `Engine-TS/src` for `startX =`/`startZ =` finds no other NPC assignment). Source: `Engine-TS/src/engine/entity/Npc.ts:652-703`. By mode:
   - `PLAYERFOLLOW`: always within range (`Engine-TS/src/engine/entity/Npc.ts:656-658`).
   - `OP*` modes: target out of range if `max(|dx|, |dz|)` from spawn `> maxrange + 1`, or exactly the corner `(maxrange+1, maxrange+1)` (`Engine-TS/src/engine/entity/Npc.ts:662-672`).
   - `AP*` modes: out of range if `distanceToSW(target, spawn) > maxrange + attackrange` (`Engine-TS/src/engine/entity/Npc.ts:674-678`).
   - `PLAYERESCAPE`: out of range only if **both** the target's and the NPC's size-aware distance from spawn exceed `maxrange` (`Engine-TS/src/engine/entity/Npc.ts:680-697`).
   - everything else (`PLAYERFACE`, `PLAYERFACECLOSE`, `QUEUE*`): out of range if `distanceToSW(target, spawn) > maxrange + 1` (`Engine-TS/src/engine/entity/Npc.ts:699-701`).

   `distanceToSW` is the Chebyshev distance between the two south-west tiles; `distanceTo` is the Chebyshev distance between the closest tiles of two sized areas (`Engine-TS/src/engine/CoordGrid.ts:60-80`). Defaults: `wanderrange = 5`, `maxrange` = `wanderrange + 2` if not set and never below `wanderrange`, `attackrange = 0` (`Engine-TS/src/cache/config/NpcType.ts:101-108`, `Engine-TS/src/cache/config/NpcType.ts:118-126`).

### Per-mode behaviour (one call per valid turn)

7. **`NONE`**: only `updateMovement()`. So an idle NPC still walks waypoints queued by scripts (`npc_walk` queues a single waypoint, `Engine-TS/src/engine/script/handlers/NpcOps.ts:466-470`). Source: `Engine-TS/src/engine/entity/Npc.ts:716-718`

8. **`WANDER`**: Source: `Engine-TS/src/engine/entity/Npc.ts:720-739`
   ```ts
   // 1/8 chance to move every tick (even if they already have a destination)
   if (type.moverestrict !== MoveRestrict.NOMOVE && Math.random() < 0.125) {
   this.wander(type.wanderrange);
   }
   this.updateMovement();
   ```
   `wander(range)` picks `startX + round(random*2r - r)`, same for z, and if that differs from the current tile replaces all waypoints with that single tile (`Engine-TS/src/engine/entity/Npc.ts:705-714`, `queueWaypoint` at `Engine-TS/src/engine/entity/PathingEntity.ts:259-262`). Then, after movement, `if (this.stuckCounter++ > 500)`: teleport back to spawn unless already on it, and reset the counter (`Engine-TS/src/engine/entity/Npc.ts:730-738`). `stuckCounter` is reset to 0 whenever `updateMovement` sees the NPC's position changed since the last cleanup (rule 15).

9. **`PATROL`**: Source: `Engine-TS/src/engine/entity/Npc.ts:741-781`. With no patrol points it only calls `updateMovement()`. Otherwise, in this order:
   1. `dest` = current patrol point; if no waypoints and no target, queue a waypoint to it.
   2. `stuckCounter++`; if `stuckCounter >= 32` or the NPC is on a different level from `dest`, teleport to `dest` and reset the counter.
   3. If on `dest` (x and z only): if `patrolDelayTicksRemaining < 0`, load the point's delay (`patrolDelay[i] ?? 0`); then `if (this.patrolDelayTicksRemaining-- <= 0)` advance to the next point (wrapping), reset the delay to -1 and queue a waypoint to the new point.
   4. `updateMovement()`.

   Patrol points and delays come from the type (`patrolCoord`, `patrolDelay`, decoded as `g4s`/`g1`, `Engine-TS/src/cache/config/NpcType.ts:236-241`). `clearPatrol()` (called by `npc_setmode` `PATROL`) resets the point index to 0, `stuckCounter` to 0 and the delay to -1 (`Engine-TS/src/engine/entity/Npc.ts:389-393`).

10. **`PLAYERESCAPE`**: Source: `Engine-TS/src/engine/entity/Npc.ts:783-874`. Throws if the target is not a `Player` (caught by `processNpcs`, which removes the NPC; [`04-npcs.md`](04-npcs.md) rule 3). If `distanceToSW(npc, target) > 25`, `resetDefaults()` and return. Otherwise pick the diagonal pointing away from the player (player at `x >= npc.x` and `z >= npc.z` -> south-west, and so on for the other three quadrants; `Engine-TS/src/engine/entity/Npc.ts:793-802`); step diagonally if `canTravel` allows it and the new tile stays within `maxrange` of spawn; else try the x-axis step, then the z-axis step, under the same two conditions (`Engine-TS/src/engine/entity/Npc.ts:817-859`). Queue that single waypoint and call `updateMovement()`; if it did not move, `stuckCounter++`. If `stuckCounter >= 5` and the NPC is not at `maxrange` from spawn on both axes, `resetDefaults()` and reset the counter (`Engine-TS/src/engine/entity/Npc.ts:861-873`).

11. **`PLAYERFOLLOW`**: throws if the target is not a `Player`; `pathToTarget()` then `updateMovement()`. Source: `Engine-TS/src/engine/entity/Npc.ts:876-888`. `Npc.pathToTarget()` random-walks one tile if the NPC overlaps a pathing target, otherwise uses `PathingEntity.pathToTarget()` (`Engine-TS/src/engine/entity/Npc.ts:331-347`). NPCs are constructed with `MoveStrategy.NAIVE` (`Engine-TS/src/engine/entity/Npc.ts:78`), and no code changes an NPC's `moveStrategy` (grep of `Engine-TS/src` for `moveStrategy =` finds the constructor assignment and player cheats only), so this is the naive branch: if the type cannot move, nothing; for a pathing target `naivePathToTarget()` (`findNaivePath`), else a single waypoint on the target tile (`Engine-TS/src/engine/entity/PathingEntity.ts:481-497`). It re-paths every tick to the target's current position. Range is not limited (rule 6).

12. **`PLAYERFACE`**: only the `Player` type check; no movement call. Source: `Engine-TS/src/engine/entity/Npc.ts:890-894`. Facing comes from the post-mode facing step (rule 17). Because `updateMovement()` is not called, queued waypoints are not walked while in this mode, and the walk trigger does not fire. The range check is the generic `maxrange + 1` from spawn (rule 6).

13. **`PLAYERFACECLOSE`**: like `PLAYERFACE`, but `resetDefaults()` if `CoordGrid.distanceTo(npc, target) > 1`. Source: `Engine-TS/src/engine/entity/Npc.ts:896-905`

14. **`aiMode` (all `OP*`, `AP*` and `QUEUE*` modes)**: how an NPC interacts with a player (or NPC, loc, obj). Source: `Engine-TS/src/engine/entity/Npc.ts:907-934`
    ```ts
    // Reset the stuck timer if Npc runs its aimode
    this.stuckCounter = 0;
    // Try to interact before moving, include op Obj and Loc
    if (this.tryInteract(true)) {
    return;
    }
    // Set dest to target
    this.pathToTarget();
    // Path
    const moved: boolean = this.updateMovement();
    // Clear target if givechase=no
    if (moved && !type.givechase) {
    this.resetDefaults();
    return;
    }
    // Try to interact again after moving
    if (this.target) {
    this.tryInteract(false);
    }
    ```
    `tryInteract(allowOpScenery)` (`Engine-TS/src/engine/entity/Npc.ts:936-958`) looks up the trigger for the mode (`ai_opplayerN`, `ai_applayerN`, `ai_oplocN`, ..., by the map at `Engine-TS/src/engine/entity/Npc.ts:1074-1139`, with the NPC's current type and category). Then:
    - **OP mode** and `inOperableDistance(target)` (for a pathing target, `reachedEntity`; `Engine-TS/src/engine/entity/PathingEntity.ts:408-420`) and (target is a player/NPC, or `allowOpScenery`): run the script, return `true`.
    - **AP mode** and `inApproachDistance(type.attackrange, target)`: not when overlapping a pathing target; for an NPC, `distanceTo <= range` and `isApproached` computed **from the target to the NPC** ("Los for Npcs is always calculated backwards", `Engine-TS/src/engine/entity/PathingEntity.ts:422-436`). Run the script, return `true`.
    - Otherwise `false`.

    The script is run with `executeScript(ScriptRunner.init(script, this, this.target))`, so for a player target the player becomes the script's `active_player` (`Engine-TS/src/engine/script/ScriptRunner.ts:84-91`), and for an NPC target `active_npc2` (`Engine-TS/src/engine/script/ScriptRunner.ts:92-96`). `tryInteract` returns `true` when in range even if no script resolves. Nothing in `aiMode` or `tryInteract` clears the target or mode after the script runs. `QUEUE*` modes are neither OP nor AP (`Engine-TS/src/engine/entity/Npc.ts:1141-1157`), so for them `tryInteract` always returns `false`. `givechase` defaults to `true` (`Engine-TS/src/cache/config/NpcType.ts:116`). The second `tryInteract(false)` cannot op a loc or obj, so an NPC ops scenery only from where it stood at the start of the turn.

### Movement

15. **`Npc.updateMovement()`**: Source: `Engine-TS/src/engine/entity/Npc.ts:349-380`
    1. `moverestrict === NOMOVE` -> return `false` (no walk trigger, no step).
    2. `moveSpeed` = `WALK` (`defaultMoveSpeed`, `Engine-TS/src/engine/entity/Npc.ts:420-422`) unless it is `INSTANT`.
    3. If there are waypoints: if a walk trigger is set (`npc_walktrigger`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:498-505`), clear it and run that `ai_queueN` script **immediately**, ignoring its returned state; then `processMovement()`.
    4. `moved` = position differs from `lastTickX`/`lastTickZ` (set to the position at the previous phase 11, `Engine-TS/src/engine/entity/PathingEntity.ts:599-600`). If moved: `lastMovement = currentTick + 1`, `stuckCounter = 0`.

    So `moved` is true after **any** position change since the last cleanup, including a script `npc_tele` earlier in the tick, not only a step taken now.

16. **One step per tick at most.** Source: `Engine-TS/src/engine/entity/PathingEntity.ts:135-152`
    ```ts
    processMovement(): boolean {
    if (!this.hasWaypoints() || this.moveSpeed === MoveSpeed.STATIONARY || this.moveSpeed === MoveSpeed.INSTANT) {
    return false;
    }
    ```
    With `WALK`, it takes a step only if `walkDir === -1`, and `walkDir` is reset to -1 only by `resetPathingEntity()` in phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:593-596`). `validateAndAdvanceStep()` (`Engine-TS/src/engine/entity/PathingEntity.ts:206-252`) clears the waypoints if the NPC cannot move (no collision strategy or a `NULL` block flag); otherwise `takeStep()` (`Engine-TS/src/engine/entity/PathingEntity.ts:633-679`) heads for the current waypoint: diagonal only if `width === 1` and `canTravel` allows it, else the x-axis part, else the z-axis part, else no move. The position is updated and `refreshZonePresence` updates the collision map and zone at once, even when the NPC did not move (`Engine-TS/src/engine/entity/PathingEntity.ts:226-231`). Reaching the waypoint pops it. A real step sets the facing angle to the tile ahead (no mask) and increments `stepsTaken`. `moveSpeed` starts as `INSTANT` (`Engine-TS/src/engine/entity/PathingEntity.ts:38`) and is set to `INSTANT` by `teleJump` and by a teleport that changes level (`Engine-TS/src/engine/entity/PathingEntity.ts:281-285`, `Engine-TS/src/engine/entity/PathingEntity.ts:315-318`); only `resetPathingEntity()` sets it back (`Engine-TS/src/engine/entity/PathingEntity.ts:594`).

### After the mode

17. **Facing runs after movement, then the jump check.** Source: `Engine-TS/src/engine/entity/Npc.ts:182-191`
    - `reorientEntity()`: if the target is a player/NPC, set the facing angle toward it, with no mask (`Engine-TS/src/engine/entity/PathingEntity.ts:370-375`).
    - `reorient()`: for a loc/obj target, once `stepsTaken === 0` this tick, `focus(targetX, targetZ, true)`, which sets the face-coord mask, then clear `targetX`/`targetZ` (`Engine-TS/src/engine/entity/PathingEntity.ts:383-392`).
    - `setFaceEntity()`: `faceEntity` = player slot + 32768, NPC nid, or -1; the face-entity mask is set only when that value changes (`Engine-TS/src/engine/entity/PathingEntity.ts:514-532`).
    - `validateDistanceWalked()`: `jump = true` if the NPC is more than 2 tiles (size-aware) from its last-tick position (`Engine-TS/src/engine/entity/PathingEntity.ts:324-335`).

    These read `target` as left by the mode, so a target cleared by `resetDefaults()` this turn gives `faceEntity = -1` (and the mask, if it was facing something) on the same tick.

## Comment-versus-code check

- `NpcMode` enum comments (`Engine-TS/src/engine/entity/NpcMode.ts:2-18`): "Wander around the NPC's spawn point" **matches** (rule 8). "Patrol between a list of points" **matches**. "Retreat from its target" **matches**. "Follow its target" **matches**. "Face its target while within maxrange distance" **matches** for the range part (generic `maxrange + 1` from spawn, rule 6); the facing itself is done by the post-mode step, not the mode. "Face its target while within 1 tile distance" **matches** (`distanceTo > 1` resets). "Execute [ai_opplayerX,npc] script" etc. **match** for OP/AP modes; for `QUEUE1-20` "Execute the [ai_queueX,npc] script" **does not match** `aiMode`, which never runs a script for a `QUEUE*` `targetOp` (rule 14). `QUEUE*` as a hunt `findNewMode` does run the script ([`04-npcs.md`](04-npcs.md) rule 10).
- "Failsafe" (`Engine-TS/src/engine/entity/Npc.ts:590`), "Targetless modes", "Validate target before running targeted modes", "Modes with targets" (`Engine-TS/src/engine/entity/Npc.ts:596`, `Engine-TS/src/engine/entity/Npc.ts:608`, `Engine-TS/src/engine/entity/Npc.ts:614`): **match**.
- `validateTarget` comments "same floor", "Check maxrange", "effectively checking if the Npc or Loc did a changetype", "Npcs can interact with other Npcs who are delayed" (`Engine-TS/src/engine/entity/Npc.ts:630-645`): **match** (rule 5).
- `targetWithinMaxRange` comments "OpTrigger maxrange", "remove corner", "ApTrigger maxrange", "Retreat maxrange", "Everything else" (`Engine-TS/src/engine/entity/Npc.ts:661-698`): **match** (rule 6).
- `wanderMode` "1/8 chance to move every tick (even if they already have a destination)" (`Engine-TS/src/engine/entity/Npc.ts:723`): **matches** (`0.125`, no waypoint check). "Npc should teleport 501 ticks after its last movement" (`Engine-TS/src/engine/entity/Npc.ts:732`): **matches** by counting (see Inferences), with the exception that it does not teleport if already on the spawn tile.
- `patrolMode` "requeue waypoints in cases where an npc was interacting and the interaction has been cleared" (`Engine-TS/src/engine/entity/Npc.ts:753`): the code requeues whenever there are no waypoints and no target, which includes that case. "Npc should teleport 32 ticks after its last movement, or if it needs to change floors" (`Engine-TS/src/engine/entity/Npc.ts:759`): **matches**, but the counter also runs while the NPC stands on a point waiting out its patrol delay (see Inferences). "If patrol delay is unitialized, set it to next patroldelay" (`Engine-TS/src/engine/entity/Npc.ts:766`): it loads the delay of the **current** point (`patrolDelay[nextPatrolPoint]` before the index advances); "next" here means the point the NPC was heading to.
- `playerEscapeMode` "Prefer West over South", "Prefer East over North", "Prefer West over North", "Prefer East over South" (`Engine-TS/src/engine/entity/Npc.ts:826-844`): **match**; all four branches try the x-axis step first. "Resets if it has been stuck for 5 ticks and is not at max range in both directions" (`Engine-TS/src/engine/entity/Npc.ts:869`): **matches**.
- `aiMode` comments "Reset the stuck timer", "Try to interact before moving, include op Obj and Loc", "Clear target if givechase=no", "Try to interact again after moving" (`Engine-TS/src/engine/entity/Npc.ts:910-930`): **match**.
- `PathingEntity.reorientEntity` doc comment "Refreshed every turn BEFORE movement ... it runs before processInteraction and captures the target before processInteraction can clear it" (`Engine-TS/src/engine/entity/PathingEntity.ts:363-369`): **mismatch for NPCs**. In `Npc.turn()` it runs **after** `processMovementInteraction()` (`Engine-TS/src/engine/entity/Npc.ts:181-186`), so it sees the target as left by the mode. The `Npc.turn()` comment (`Engine-TS/src/engine/entity/Npc.ts:182-185`) correctly says "both run here after movement". The doc comment matches the player order (`Engine-TS/src/engine/World.ts:713-717`).
- `Npc.turn()` comment "An npc's target is set during its turn" (`Engine-TS/src/engine/entity/Npc.ts:183`): **partly**. Hunt consumption and modes set it during the turn, but `npc_setmode` can set it from any script in any phase (rule 2), e.g. a player script in phase 5.
- `PathingEntity.reorient` doc comment "MUST run AFTER movement so stepsTaken reflects this tick" (`Engine-TS/src/engine/entity/PathingEntity.ts:378-382`): **matches** for NPCs.
- `processInfo` comment "facing (reorientEntity/reorient) runs in Npc.turn(), not here." (`Engine-TS/src/engine/World.ts:1054`): **matches** (rule 17).
- `npc_arrivedelay` "If npc moved 1 tick ago, delay for 1 tick. If npc moved this tick, delay for 2 ticks" (`Engine-TS/src/engine/script/handlers/NpcOps.ts:561`): **does not match the plain reading** because `lastMovement` is stored as `currentTick + 1` (rule 15). By the code, in tick T: a move detected in tick T or T-1 gives `delayedUntil = T+2`; a move in T-2 gives `T+1`; older moves give no delay (`Engine-TS/src/engine/script/handlers/NpcOps.ts:557-570`). Whether the comment means ticks counted differently was not determinable.

## Inferences (labelled)

- **Inference: an NPC in an `OP*`/`AP*` mode runs its `ai_op*`/`ai_ap*` script on every valid turn while in range**, until the script itself changes the mode, delays the NPC, or the target fails validation. Rests on rule 14 (nothing clears the target after the script). Whether content scripts use `npc_delay` or `npc_setmode` for pacing was not checked.
- **Inference: target invalidation costs a tick.** When validation fails, the NPC does nothing that turn and starts its default mode next turn (rule 4). Rests on rule 4.
- **Inference: `npc_setmode` with an invalid target can pair the new mode with the old target.** If the NPC already had a target and the new one is not valid, `targetOp` changes but `target` stays the old one (rule 2); if it had none, the next turn's validation fails and `resetDefaults()` runs. Not observed.
- **Inference: wander teleport timing.** `stuckCounter` is 0 after a moving tick; on each later non-moving tick the test `stuckCounter++ > 500` sees 1, 2, ...; it is first true on the 501st consecutive non-moving tick. Rests on rules 8 and 15.
- **Inference: patrol timing.** Arrival is detected on the turn **after** the step onto the point (the check precedes `updateMovement`). With delay k the NPC stays on the point for k ticks after its arrival tick and steps toward the next point on the tick after that. While waiting, `stuckCounter` keeps increasing (no movement), and the stuck check (step 2) runs before the departing step (step 4): on the j-th tick after arrival the counter is j, so a delay of 31 or more (possible: delays are decoded as `g1`, up to 255) reaches 32 before the NPC leaves and triggers a teleport to the same point, which sets `tele`. Whether content has such delays was not checked (`docs/open-questions.md` #28). Rests on rules 9 and 15.
- **Inference: a brand-new NPC cannot take a step before the first phase 11 after it was constructed**, because `moveSpeed` starts as `INSTANT` and only `resetPathingEntity()` changes it (rule 16); `addNpc`'s `resetEntity(true)` does not call it (`Engine-TS/src/engine/entity/Npc.ts:289-329`). On the same first turn, `lastTickX`/`lastTickZ` are still -1 (`Engine-TS/src/engine/entity/PathingEntity.ts:43-44`), so if any mode calls `updateMovement` it reports `moved` (setting `lastMovement`, and for a `givechase=no` NPC in `aiMode` causing `resetDefaults()`), and `validateDistanceWalked` measures from (-1, -1) and sets `jump` unless the NPC is within 2 tiles of it. Not observed.
- **Inference: a respawned NPC, unlike a brand-new one, can take a step in its respawn tick.** A `RESPAWN` NPC waiting to respawn stays in `World.npcs` (`Engine-TS/src/engine/World.ts:1331-1333`), so phase 11 calls `resetEntity(false)` on it every tick (`Engine-TS/src/engine/World.ts:1161-1164`), which runs `resetPathingEntity()` and sets `moveSpeed = WALK` and `walkDir = -1` (`Engine-TS/src/engine/entity/PathingEntity.ts:593-596`, `Engine-TS/src/engine/entity/Npc.ts:420-422`). The respawn in step 2 of its turn, `World.addNpc(this, -1, false)` (`Engine-TS/src/engine/entity/Npc.ts:121-127`), sets the position directly and calls `resetEntity(true)`, which clears waypoints but does not touch `moveSpeed` (`Engine-TS/src/engine/World.ts:1275-1292`, `Engine-TS/src/engine/entity/Npc.ts:289-329`), and the rest of that `turn()` runs ([`03-npc-event-queue.md`](03-npc-event-queue.md) Inferences). So if its mode queues a waypoint in that turn (e.g. `WANDER`'s 1/8 roll, rule 8), it steps in phase 4 of the respawn tick T; a brand-new NPC added in tick T (with `moveSpeed` still `INSTANT`, `Engine-TS/src/engine/entity/PathingEntity.ts:38`) can first step in T+1, after T's phase 11. Rests on rules 8, 15-16. Read, not observed.
- **Inference: NPCs chase where the player was at the end of the previous tick.** `pathToTarget` reads the player's current coordinates in phase 4 and players step in phase 5 ([`04-npcs.md`](04-npcs.md) Inferences). Rests on rules 11 and 14.

## Not checked / open questions

- `canTravel`, `findNaivePath`, `reachedEntity`, `isApproached` and the collision flags were not read. `docs/open-questions.md` #4.
- RuneScript VM internals for the trigger scripts. `docs/open-questions.md` #15.
- `HuntType` decoding and content hunt configs. `docs/open-questions.md` #18.
- NPC type values in content (modes, ranges, patrol delays, `givechase`, `timer`, `regenrate`). `docs/open-questions.md` #28.
- How content scripts drive NPC combat (`ai_opplayer2`/`ai_applayer2` pacing). Not read; `docs/open-questions.md` #28.
- Nothing was run.

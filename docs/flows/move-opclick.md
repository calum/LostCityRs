# MOVE_OPCLICK: how the engine handles the client's walking route

**Question answered:** When the client sends `MOVE_OPCLICK` (the movement packet that comes with an "op" click such as chopping a tree), what does the engine do with the route in it, and how does the player then actually walk?

Follows [`click-loc-woodcutting.md`](click-loc-woodcutting.md), which noted that the client sends `MOVE_OPCLICK` before `OPLOC1` but did not read the engine side.

**Based on commits** (branch `calum-research`, based on upstream `274`):
- Engine-TS: `1d25566c`
- Client-TS: `7d6ca61`

**Method:** read code only. Nothing was run.

**Scope:** `MOVE_OPCLICK`, and where it shares code with `MOVE_GAMECLICK` and `MOVE_MINIMAPCLICK` (all three use the same decoder and handler). Not covered: how the engine's `findPath` (the non-default branch) works, and collision checks inside `canTravel`.

## Summary

With the default config the engine **trusts the client's route**. The client computes a route on its own collision map, sends the corner points, and the engine queues those points as waypoints. Each tick the engine walks the player toward the current waypoint one tile at a time, checking collision per step, and does **not** re-path between waypoints.

## 1. What the client sends

`Client.tryMove(...)` builds a route on the client's collision map (`Client-TS/src/client/Client.ts:5608`). If a route exists it writes (`Client.ts:5829-5866`):

1. The opcode (`MOVE_GAMECLICK` for `type 0`, `MOVE_MINIMAPCLICK` for `type 1`, `MOVE_OPCLICK` for `type 2`; the `MOVE_OPCLICK` write is at `5843`), then a 1 byte payload size `bufferSize + bufferSize + 3` (plus 14 for minimap).
2. `p1(1)` if `keyHeld[5] === 1`, else `p1(0)` (`Client.ts:5847`). The engine names this `ctrlHeld`.
3. The route's start point: `p2(startX + mapBuildBaseX)`, `p2(startZ + mapBuildBaseZ)`. This is **not** the player's own tile: `startX/Z` is `routeX/Z[length - 1]`, the last turn point collected while walking back from the destination, and that loop stops on reaching the source tile without adding it (`Client-TS/src/client/Client.ts:5801-5834`). So it is the turn point nearest the player, or the destination itself for a straight route.
4. Up to `bufferSize - 1` further waypoints as 1 byte offsets from the start tile (`p1(routeX[length] - startX)`, `p1(routeZ[length] - startZ)`). `bufferSize = Math.min(length, 25)` where the code comment says "max number of turns in a single pf request" (`Client.ts:5830`).

The route is stored from destination back to source; the packet is written from the source end toward the destination. The waypoints are the **corner points** of the route (a point is only added when the step direction changes, `Client.ts:5800-5827`).

`interactWithLoc` calls `tryMove` with `type` `2` (`Client.ts:5591, 5593`), so `MOVE_OPCLICK` is written first and `OPLOC1` right after (`Client.ts:5601`). The minimap variant additionally appends 14 extra bytes (`Client.ts:2770-2784`, with the comment "the additional 14-bytes in MOVE_MINIMAPCLICK"). The client also sets its own minimap flag at `5856`.

## 2. Engine decoding

1. Opcode `138` is `MOVE_OPCLICK`, variable length (`-1`, a 1 byte size) (`Engine-TS/src/network/game/client/ClientGameProt.ts:83`). `MOVE_MINIMAPCLICK` (86) and `MOVE_GAMECLICK` (207) are at lines 85 and 96. All three are bound to `MoveClickDecoder` + `MoveClickHandler` (`ClientGameProtRepository.ts:125-127`).
2. `MoveClickDecoder.decode(buf, length)` (`network/game/client/codec/MoveClickDecoder.ts`) reads `ctrlHeld = g1`, `startX = g2`, `startZ = g2`. It computes `waypoints = (length - buf.pos - offset) / 2`, with `offset = 14` for `MOVE_MINIMAPCLICK` and `0` otherwise. It builds `path = [start]` then pushes `start + (g1b, g1b)` for each waypoint while `index < 25`. The result is `new MoveClick(path, ctrlHeld, prot === MOVE_OPCLICK)`.
3. Check against the client: the client's payload is `2*bufferSize + 3` bytes, the decoder has already read 5, so `(2*bufferSize + 3 - 5) / 2 = bufferSize - 1` waypoints after the start. For minimap the 14 extra bytes are subtracted by `offset`. The sizes agree.
4. `MoveClick` has category `USER_EVENT` (`model/MoveClick.ts`). That category has a limit of `5` decoded per tick (`ClientGameProtCategory.ts:6`), and `decodeIn` stops reading when it is reached, picking up on the next tick (comment in `ClientGameProtCategory.ts`; loop at `NetworkPlayer.ts:69`). A `USER_EVENT` packet increments `userLimit` only if its handler returned `true`; a `USER_EVENT` whose handler returned `false` falls through to the final `else` and increments `clientLimit` instead (`NetworkPlayer.ts:141-147`). So a successful `MOVE_OPCLICK` + `OPLOC1` pair uses 2 of the 5 `userLimit` slots.

## 3. `MoveClickHandler`

`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts`:

1. If `player.delayed`: write `UnsetMapFlag` and return `false` (line 12).
2. Validate (line 20): `ctrlHeld` must be 0 or 1, and `CoordGrid.distanceToSW(player, start) <= 104`. `distanceToSW` is `max(|dx|, |dz|)` between the player and the start tile (`CoordGrid.ts:75-80`). On failure: `unsetMapFlag()`, `userPath = []`, return `false`.
3. `if (!message.opClick) player.clearPendingAction();` (line 30). For `MOVE_OPCLICK` the current interaction is **not** cleared here. The code comment says the move is "always paired with a following op packet that clears+sets the interaction itself", and that clearing here "would drop the target in the gap when the per-tick user packet limit splits the pair across ticks".
4. Run: `tempRun = 0` if `runenergy < 100 && ctrlHeld === 1`, else `tempRun = ctrlHeld` (lines 35-39).
5. Path, with `Environment.node.clientRoutefinder` (default `true`, `util/WorldConfig.ts:103`, env `NODE_CLIENT_ROUTEFINDER` at `WorldConfig.ts:242`) (line 42):
   - `player.userPath` becomes the packed coords of each path point on `player.level` (lines 43-47);
   - `player.queueWaypoints(player.userPath)` (line 48);
   - `player.processWalktrigger()` (line 50).
   If `clientRoutefinder` is **false**, it instead queues `findPath(level, player.x, player.z, dest.x, dest.z)` using only the **last** point as the destination (lines 52-53), and `userPath` is not set.
6. Returns `true` (line 56).

`queueWaypoints` stores the points **reversed** into `waypoints` (an `Int32Array(25)`, `PathingEntity.ts:42`) and sets `waypointIndex` to the last index (`PathingEntity.ts:268-275`). So `waypoints[waypointIndex]` is the **first** point of the client's path (the one nearest the player) and `waypoints[0]` is the destination.

## 4. After decoding: flags set in `processClientsIn`

`World.processClientsIn` (`World.ts:601`) runs after `decodeIn` (`World.ts:617-628`):

- `decodeIn` starts by clearing `userPath` and `opcalled` each tick (`NetworkPlayer.ts:56-57`), so `userPath.length > 0` means a move packet was handled **this tick**, and `opcalled` means an op packet was handled this tick (set by `OpLocHandler`, see the previous note).
- If either holds: if the player is `delayed`, `unsetMapFlag()` and `continue`. Otherwise `moveClickRequest = false` when `!player.busy() && player.opcalled`, else `moveClickRequest = true`.
- `moveClickRequest` is not assigned anywhere in this block when neither condition holds, so it **keeps its previous value** (it is also reset to `false` at login, `World.ts:941`, and by `OpHeldHandler.ts:58` / `OpHeldUHandler.ts:56,73`).
- `busy()` is `delayed || containsModalInterface()`, and `containsModalInterface()` is true when the `MAIN` or `CHAT` modal state is set (`Player.ts:816-823`).

The only consumer found is `Player.updateMovement` (`Player.ts:676`):

```ts
// players cannot walk if they have a modal open *and* something in their queue, confirmed as far back as 2005
if (this.moveClickRequest && this.busy() && (this.queue.head() != null || this.engineQueue.head() != null)) {
    return false;
}
```

So a click-movement is ignored for that tick if the click was a plain move (or an op while busy), the player is busy, **and** a script is waiting in the player's `queue` or `engineQueue`.

## 5. Walking, tick by tick

1. `processPlayers` calls `Player.processInteraction()` (`World.ts:717`), covered in the previous note. Before movement it runs `processWalktrigger()` (when `clientRoutefinder` is on and the op is not a follow op, `Player.ts:1265`) and the first `tryInteract(false)`. Then `pathToPathingTarget()` (a no-op for locs, since a `Loc` is not a `PathingEntity`), then `updateMovement()`.
2. `Player.updateMovement` (`Player.ts:674`): after the check above, sets `moveSpeed` to the default (walk or run by the `run` varp), forced to `WALK` if `runanim === -1`, or `RUN` if `tempRun` is set (lines 680-687). Then calls `PathingEntity.processMovement()`. If `processMovement` returns `false` (no waypoints, or `moveSpeed` is `STATIONARY`/`INSTANT`, `PathingEntity.ts:136`) it sets `tempRun = 0` (lines 689-692). It records `lastMovement` when a step was taken.
3. `processMovement` (`PathingEntity.ts:135`): returns `false` without moving if there are no waypoints, or the speed is `STATIONARY`/`INSTANT`. For `WALK`/`RUN`: `walkDir = validateAndAdvanceStep()`, and for `RUN`, if the first step succeeded, a second `runDir = validateAndAdvanceStep()`.
4. `validateAndAdvanceStep` (`PathingEntity.ts:206`) calls `takeStep()`, applies the delta to `x`/`z`, updates collision and zone presence, and **decrements `waypointIndex` when the entity reaches the current waypoint tile**. If it moved, it increments `stepsTaken` and returns the direction.
5. `takeStep` (`PathingEntity.ts:633`): takes the current waypoint, computes `dir = CoordGrid.face(src, waypoint)` (a direction from the signs of the x and z differences, `CoordGrid.ts:24-`), then tries, in order: the diagonal (if `width === 1` and `canTravel`), then east/west only, then north/south only, otherwise `[0, 0]` (`PathingEntity.ts:664-678`). **It does no path search**: between two waypoints it goes in the sign-based direction and gets stuck if blocked.
6. Run energy: `updateEnergy` (`Player.ts:701`) runs after `processInteraction` in `processPlayers` (`World.ts`, the call is after `player.reorient()`): `stepsTaken < 2` recovers energy (`agility/6 + 8`, capped at 10000), otherwise it drains by a weight-based amount. If `runenergy < 100`, `tempRun = 0`.

## 6. How this fits the loc click

For `MOVE_OPCLICK` + `OPLOC1` (default config), as read:

1. Decode loop reads `MOVE_OPCLICK` → `MoveClickHandler` queues the client's waypoints, leaves the interaction alone.
2. Decode loop reads `OPLOC1` → `OpLocHandler` runs `clearPendingAction()` (clears the interaction and closes modals, but leaves waypoints, per the comment at `Player.ts:969`) then `setInteraction(...)` and `opcalled = true`.
3. `processClientsIn` sets `moveClickRequest`.
4. In `processPlayers` the interaction first tries to run (it can only run for a loc after movement, see previous note); the movement step takes the player along the queued waypoints; the next tick repeats until `inOperableDistance` is true for the loc.
5. When the script calls `p_oploc`, it calls `queueWaypoint(loc.x, loc.z)` only if the player is not in operable distance (`PlayerOps.ts:397-399`), which **replaces** the whole queue with one waypoint (`PathingEntity.ts:259-262`).

## Inferences (labelled)

- **The engine accepts any route within the size limits, without re-checking it against its own pathfinder.** Rests on section 3 (the only checks are `delayed`, `ctrlHeld`, and the 104 tile distance to the start) and section 5 step 5 (per-step collision check only). A hostile client sending an unreachable route would stall at the blocked step. Not tested.
- **Why `MOVE_OPCLICK` does not clear the interaction** is taken from the code comment (section 3). The tick-splitting scenario was not reproduced.

## Not checked / open questions

Logged in [`../open-questions.md`](../open-questions.md):

- `canTravel` and the collision flags (what blocks a step).
- `findPath` (used when `clientRoutefinder` is false).
- `Player.closeModal()` and whether `OpLocHandler`'s `clearPendingAction()` changes `busy()` before the `moveClickRequest` check.
- `MoveStrategy.NAIVE` vs `SMART` (`Player.ts:423`): where each is used besides `pathToPathingTarget`.
- How the engine sends the player's movement back (`walkDir`/`runDir` in `PLAYER_INFO`) and how the client uses it to move its own player.
- What the 14 extra minimap bytes are used for (the engine only subtracts them).

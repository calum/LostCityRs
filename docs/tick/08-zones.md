# Phase 8: `processZones` (loc/obj timers and the shared zone buffer)

**Question answered:** What does the eighth phase of a game tick do, in what order: which loc and obj timers (despawn, respawn, revert, reveal) run here and when they fire; what a "zone event" is and which phases add them; when the shared zone buffer is computed relative to those events; how a loc change or obj add made earlier in the tick reaches the bytes sent in phase 10; and where the "active zone list" is really built?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only the woodcutting `loc_change` call and the `loc_change` command signature were read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". Client handling of the zone packets was not read (boundary).

Related notes: [`01-world.md`](01-world.md) (the delayed-obj queue that calls `World.addObj` in phase 1, rules 10-13), [`03-npc-event-queue.md`](03-npc-event-queue.md) and [`04-npcs.md`](04-npcs.md) (NPC spawn/despawn/respawn and NPC timers, which are **not** handled here), [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (player steps and `refreshZonePresence`, rule 15), [`07-logouts-logins.md`](07-logouts-logins.md) (login tick: `rebuildNormal` in phase 7, the first `updateZones` in phase 10, rule 16), [`05-players-queues-timers.md`](05-players-queues-timers.md) (zone/mapzone triggers enqueued in phase 10, rule 20), [`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md) (the woodcutting script that calls `loc_change`).

## Position in the tick

`processZones()` is the eighth call in `World.cycle()`, after `processLogins()` (phase 7) and before `processInfo()` (phase 9). Source: `Engine-TS/src/engine/World.ts:383-390`
```ts
            this.processLogins();

            // process zones
            // - build list of active zones around players
            // - loc/obj despawn/respawn
            // - compute shared buffer
            this.processZones();
```

`World.currentTick` is incremented only after `processCleanup()` (phase 11), near the end of `cycle()` (`Engine-TS/src/engine/World.ts:503`). So every phase of one tick sees the same `currentTick`; comparisons like `lastLifecycleTick === World.currentTick` below mean "set earlier in this same tick, in any phase".

## L2: ordered sub-steps

Source for the whole phase: `Engine-TS/src/engine/World.ts:961-988`.

1. Record a start time. Source: `Engine-TS/src/engine/World.ts:964`
2. **Loc/obj timers:** walk `World.locObjTracker` head to tail. For each `LocObjEvent`, if `event.check()` passes call `event.entity.turn()` (`Loc.turn` or `Obj.turn`), otherwise log "Loc Obj event is invalid". Source: `Engine-TS/src/engine/World.ts:966-975`
3. **Shared buffers:** for each zone in `World.zonesTracking` (a `Set`, iterated in insertion order), call `zone.computeShared()`. Source: `Engine-TS/src/engine/World.ts:977-980`
4. Steps 2-3 are inside one `try`; on an error, log it and skip the rest of steps 2-3 (L3 rule 26). Source: `Engine-TS/src/engine/World.ts:965`, `Engine-TS/src/engine/World.ts:981-986`
5. Store elapsed ms in `cycleStats[WorldStat.ZONE]`. Source: `Engine-TS/src/engine/World.ts:987`

The phase does **not** iterate players or NPCs and does not build any per-player zone list (L3 rules 20 and 25).

## L3: ordering rules

### What the timer list holds (step 2)

1. `World.locObjTracker` is a `LinkList<LocObjEvent>`; `World.zonesTracking` is a `Set<Zone>`. Source: `Engine-TS/src/engine/World.ts:153-154`
   ```ts
       readonly zonesTracking: Set<Zone> = new Set();
       readonly locObjTracker: LinkList<LocObjEvent> = new LinkList();
   ```
   A `LocObjEvent` holds one `NonPathingEntity` and, in its constructor, sets that entity's `eventTracker` to itself; `check()` is `this === this.entity.eventTracker`. Source: `Engine-TS/src/engine/entity/LocObjEvent.ts:5-17`. Only `Loc` and `Obj` extend `NonPathingEntity` (grep for `extends NonPathingEntity`: `Engine-TS/src/engine/entity/Loc.ts:7`, `Engine-TS/src/engine/entity/Obj.ts:5`); `Npc` and `Player` extend `PathingEntity` (`Engine-TS/src/engine/entity/Npc.ts:41`, `Engine-TS/src/engine/entity/Player.ts:100`). So NPC respawn/despawn timers are not in this list; they run in `Npc.turn()` in phase 4 ([`03-npc-event-queue.md`](03-npc-event-queue.md) rule 4, [`04-npcs.md`](04-npcs.md)).

2. **The only writer of the list is `NonPathingEntity.setLifeCycle`.** It always unlinks the entity's previous event first; then, only for `duration > 0`, it appends a new event at the tail and calls `Entity.setLifeCycle(duration)`; otherwise it calls `Entity.setLifeCycle(-1)`. Source: `Engine-TS/src/engine/entity/NonPathingEntity.ts:11-25`
   ```ts
       setLifeCycle(duration: number): void {
           // Clear previous event tracking
           if (this.eventTracker) {
               this.eventTracker.unlink();
               this.eventTracker = null;
           }
           // Track the event for positive durations
           if (duration > 0) {
               const event = new LocObjEvent(this);
               World.locObjTracker.addTail(event);
               super.setLifeCycle(duration);
           } else {
               super.setLifeCycle(-1);
           }
       }
   ```
   `Entity.setLifeCycle` sets `lifecycleTick` (`-1`, or `Math.max(1, tick)`) and **always** sets `lastLifecycleTick = World.currentTick`. Source: `Engine-TS/src/engine/entity/Entity.ts:36-43`. (Grep for `eventTracker` finds no other writer than these two files.) So an entity has at most one event in the list, and the list order is the order in which timers were last (re)started.

3. **Who starts a timer** (calls `setLifeCycle` with a positive value), all in `World`. Three of these methods first have an early-return guard; when it applies, the call does nothing at all (no zone event, no `trackZone`, no collision or timer change): `changeLoc` returns for a `DESPAWN` loc that is not valid (inactive) (`Engine-TS/src/engine/World.ts:1367-1369`), `removeLoc` returns for any inactive loc (`Engine-TS/src/engine/World.ts:1419-1421`), `removeObj` returns for any inactive obj (`Engine-TS/src/engine/World.ts:1518-1520`).
   - `addLoc(loc, duration)`: always `setLifeCycle(duration)`. Source: `Engine-TS/src/engine/World.ts:1352-1363`
   - `changeLoc(..., duration)` (past its guard): `setLifeCycle(duration)` if the loc is now changed from its base type or is a `DESPAWN` loc, else `-1`. Source: `Engine-TS/src/engine/World.ts:1393-1400`
   - `removeLoc(loc, duration)` (past its guard): `setLifeCycle(duration)` for a `RESPAWN` (map) loc, `-1` for a `DESPAWN` (script-added) loc. Source: `Engine-TS/src/engine/World.ts:1432-1439`
   - `addObj(obj, receiver64, duration)`: `setLifeCycle(duration)` in both branches. Source: `Engine-TS/src/engine/World.ts:1485-1499`
   - `removeObj(obj, duration)` (past its guard): `setLifeCycle(scaleByPlayerCount(duration))` only if `duration > 0` and the obj is `RESPAWN`; else `-1`. Source: `Engine-TS/src/engine/World.ts:1523-1532`
   - `revertLoc` always sets `-1`. Source: `Engine-TS/src/engine/World.ts:1461`

   Script commands reach these through handlers such as `LOC_ADD`, `LOC_CHANGE`, `LOC_DEL`, `OBJ_ADD`, `OBJ_DEL` and `OBJ_TAKEITEM` (`Engine-TS/src/engine/script/handlers/LocOps.ts:18-77`, `Engine-TS/src/engine/script/handlers/ObjOps.ts:20-161`; inventory handlers too, e.g. an overflow drop with duration 200 at `Engine-TS/src/engine/script/handlers/InvOps.ts:73-81`). Script durations pass `DurationValid`, a range check of 1 to 2147483647 (`Engine-TS/src/engine/script/ScriptValidators.ts:109`). Map locs whose type is `active` are added to their zone as `RESPAWN` locs (`Engine-TS/src/engine/GameMap.ts:284-285`; a non-`active` map loc only gets collision and no `Loc` object); `LOC_ADD` creates `DESPAWN` locs when no loc on the same layer exists (`Engine-TS/src/engine/script/handlers/LocOps.ts:39-40`).

4. **The obj-merge path restarts a countdown without touching the list.** When `addObj` is given a stackable `DESPAWN` obj and an existing `DESPAWN` obj of the same type and receiver lies on the tile and is valid (`getObjOfReceiver` iterates `getObjsSafe`, which yields only objs whose `isValid()` holds: active and `count >= 1`; `Engine-TS/src/engine/zone/Zone.ts:386-393`, `Engine-TS/src/engine/zone/Zone.ts:447-453`, `Engine-TS/src/engine/entity/Obj.ts:52-62`), and the summed count is within `Inventory.STACK_LIMIT`, it calls `changeObj` on the existing obj and sets `existing.lifecycleTick = duration` directly, then returns. `lastLifecycleTick`, `reveal` and the existing event's list position are not changed. Source: `Engine-TS/src/engine/World.ts:1468-1479`
   ```ts
           if (ObjType.get(obj.type).stackable && obj.lifecycle === EntityLifeCycle.DESPAWN) {
               const existing = this.getObjOfReceiver(obj.x, obj.z, obj.level, obj.type, receiver64);
               if (existing && existing.lifecycle === EntityLifeCycle.DESPAWN) {
                   const nextCount = obj.count + existing.count;
                   if (nextCount <= Inventory.STACK_LIMIT) {
                       // If an obj of the same type exists and is stackable and have the same receiver, then we merge them.
                       this.changeObj(existing, nextCount);
                       // Set the lifecycle without all the extra logic surrounding it
                       existing.lifecycleTick = duration;
                       return;
   ```

### How step 2 runs the timers

5. **Order and coverage.** Events are visited head to tail (`LinkList.all()`, `Engine-TS/src/datastruct/LinkList.ts:97-111`; the cursor is saved before each yield, so unlinking the current event during `turn()` is safe, as in [`01-world.md`](01-world.md) rule 5). Every event in the list at the start of phase 8 is visited, including timers started earlier in the same tick (phases 1-7), since nothing in phases 1-7 runs the list.

6. **`turn()` never starts a new timer**, so no event is appended during step 2. Every action `turn()` can take passes 0 or -1: `World.removeLoc(this, 0)` on a `DESPAWN` loc (sets -1, rule 3), `World.revertLoc` (-1), `World.addLoc(this, 0)` (0 is not `> 0`, so -1, rule 2), `World.removeObj(this, 0)` (`duration > 0` false, so -1), `World.addObj(this, Obj.NO_RECEIVER, 0)` on a `RESPAWN` obj (no merge, since merging needs `DESPAWN`; `setLifeCycle(0)` gives -1), `World.revealObj` (no `setLifeCycle` call), and the fail-safes `setLifeCycle(-1)`. Sources: `Engine-TS/src/engine/entity/Loc.ts:54-74`, `Engine-TS/src/engine/entity/Obj.ts:27-50`, `Engine-TS/src/engine/World.ts:1502-1506`. And each of those calls only changes the `turn()`ing entity's own event (the `Zone.addObj` overflow branch, which removes a different obj, runs only for `DESPAWN` objs, rule 15).

7. **Loc timer.** `Loc.turn` decrements `lifecycleTick`, then, only when it reaches exactly 0: a `DESPAWN` loc that is active is removed (`removeLoc(this, 0)`, no further timer); else a `RESPAWN` loc that is changed and active is reverted to its base type (`revertLoc`); else a `RESPAWN` loc that is inactive is re-added (`addLoc(this, 0)`, which also reverts it, rule 13). Any other case logs an error and stops the timer. A negative value also logs and stops the timer. Source: `Engine-TS/src/engine/entity/Loc.ts:54-74`
   ```ts
       turn() {
           // Decrement lifecycle tick
           --this.lifecycleTick;
           if (this.lifecycleTick === 0) {
               if (this.lifecycle === EntityLifeCycle.DESPAWN && this.isActive) {
                   World.removeLoc(this, 0);
               } else if (this.lifecycle === EntityLifeCycle.RESPAWN && this.isChanged() && this.isActive) {
                   World.revertLoc(this);
               } else if (this.lifecycle === EntityLifeCycle.RESPAWN && !this.isActive) {
                   World.addLoc(this, 0);
   ```

8. **Obj timer: reveal first, then lifecycle.** `Obj.turn` first handles the reveal countdown (`if (this.reveal > -1 && --this.reveal === 0) World.revealObj(this)`), then decrements `lifecycleTick`; at exactly 0, an active `DESPAWN` obj is removed (`removeObj(this, 0)`) and an inactive `RESPAWN` obj is re-added (`addObj(this, Obj.NO_RECEIVER, 0)`); any other case, or a negative value, logs and stops the timer. Source: `Engine-TS/src/engine/entity/Obj.ts:27-50`
   ```ts
       turn() {
           if (this.reveal > -1 && --this.reveal === 0) {
               World.revealObj(this);
           }

           // Decrement lifecycle tick
           --this.lifecycleTick;
   ```
   So when the reveal and the despawn fall on the same visit, the reveal is queued first and then cleared by the removal (rule 14).

9. **The reveal countdown only runs while the obj has a timer.** `Obj.turn` is the only place `reveal` is decremented (grep for `.reveal` in `Engine-TS/src`: `Obj.ts:28`, `Obj.ts:53`, `World.ts:1493`, `World.ts:1497`, `Zone.ts:334-341`), and `turn()` is only called from step 2. `addObj` sets `reveal = Obj.REVEAL` (100, `Engine-TS/src/engine/entity/Obj.ts:9`) and `receiver64` when there is a receiver, and `reveal = -1` otherwise. Source: `Engine-TS/src/engine/World.ts:1485-1499`

10. **What a reveal does.** `Zone.revealObj` does nothing but set `reveal = -1` (and `lastChange = -1`) if the obj type is not tradeable, or is members-only on a free world, or `reveal` is already -1; the obj then keeps its `receiver64`. Otherwise it sets `receiver64 = Obj.NO_RECEIVER`, `reveal = -1`, and queues an `ENCLOSED` `ObjReveal` event whose `receiver64` is the old receiver and whose message carries that player's slot (0 if not found). Source: `Engine-TS/src/engine/zone/Zone.ts:328-347`

11. **Obj respawn time is scaled by player count at removal.** `removeObj` computes `scaleByPlayerCount(duration)` = `(((4000 - min(players, 2000)) * duration) / 4000) | 0` before the timer starts. Source: `Engine-TS/src/engine/World.ts:1523`, `Engine-TS/src/engine/World.ts:1731-1735`. With the player count capped at 2000, the factor `4000 - min(players, 2000)` is between 2000 and 4000, so for `duration >= 1` the result is 0 exactly when `duration` is 1 and at least one player is logged in (`getTotalPlayers() >= 1`); then `setLifeCycle(0)` starts no timer (rule 2). With no players, or `duration >= 2`, the result is at least 1.

### Zone events

12. **A zone event** is `{ type, receiver64, message }`: `type` is `ENCLOSED` or `FOLLOWS`, `receiver64` a player hash or -1 (`Obj.NO_RECEIVER`, `Engine-TS/src/engine/entity/Obj.ts:10`), and `message` a `ServerGameZoneMessage` (one zone packet). Source: `Engine-TS/src/engine/zone/ZoneEvent.ts:4-14`, `Engine-TS/src/engine/zone/ZoneEventType.ts:1-4`. Each `Zone` keeps this tick's events in a `Set<ZoneEvent>` (`events`), a map from entity to its events (`entityEvents`), and `shared` (the computed buffer, initially null). Source: `Engine-TS/src/engine/zone/Zone.ts:54-58`. `queueEvent` adds to both; `animMap` and `mapProjAnim` add to `events` only. Source: `Engine-TS/src/engine/zone/Zone.ts:576-584`, `Engine-TS/src/engine/zone/Zone.ts:397-403`

13. **Which call queues which event** (all in `Engine-TS/src/engine/zone/Zone.ts`):

    | `World` method (tracks the zone, unless its guard returned first, rule 3) | `Zone` method | Event |
    |---|---|---|
    | `addLoc` | `addLoc` (243-252): appends a `DESPAWN` loc to the zone's loc list, `revert()`, `isActive = true` | `ENCLOSED`, -1, `LocAddChange` |
    | `changeLoc` (not for an inactive `DESPAWN` loc), `revertLoc` | `changeLoc` (254-264): `isActive = true`, moves the loc to the tail of the loc list | `ENCLOSED`, -1, `LocAddChange` (current type) |
    | `removeLoc` (active locs only) | `removeLoc` (266-281): unlinks the loc from the zone's loc list; a `RESPAWN` loc is re-appended at the tail (so it moves to the end of the order `writeFullFollows` walks), a `DESPAWN` loc is left out and `locsCount` is decremented (268-275); clears the loc's earlier events this tick; `isActive = false` | `ENCLOSED`, -1, `LocDel` |
    | `mergeLoc`, `animLoc` | `mergeLoc`, `animLoc` (292-298) | `ENCLOSED`, -1, `LocMerge` / `LocAnim` |
    | `addObj` (not merged) | `addObj` (302-326) | `RESPAWN` obj or no receiver: `ENCLOSED`, receiver, `ObjAdd`; `DESPAWN` obj with a receiver: `FOLLOWS`, receiver, `ObjAdd` |
    | `revealObj` | `revealObj` (328-347) | `ENCLOSED`, old receiver, `ObjReveal` (rule 10) |
    | `changeObj` | `changeObj` (349-356): sets `count`, `lastChange` | `FOLLOWS`, `obj.receiver64`, `ObjCount` |
    | `removeObj` (active objs only) | `removeObj` (358-375) | rule 14 |
    | `animMap`, `mapProjAnim` | (397-403) | `ENCLOSED`, -1, `MapAnim` / `MapProjAnim` |

    Each of those `World` methods calls `this.trackZone(zone)`, which adds the zone to `zonesTracking`. Source: `Engine-TS/src/engine/World.ts:1348-1350`, `Engine-TS/src/engine/World.ts:1352-1545`. Grep for calls of the `Zone` event methods finds them only inside these `World` methods (and `Zone.addObj` calling `World.removeObj`), so every zone with events this tick is in `zonesTracking`.

14. **Removals cancel this tick's earlier events.** `removeLoc` and `removeObj` call `clearQueuedEvents(entity)`, which deletes that entity's earlier events of this tick from `events` (`Engine-TS/src/engine/zone/Zone.ts:593-601`). A loc then gets one `LocDel`. An obj gets an `ObjDel` **only if `obj.lastLifecycleTick !== World.currentTick`** (`ENCLOSED` to all if the obj is `RESPAWN` or has no receiver, else `FOLLOWS` to the receiver). Source: `Engine-TS/src/engine/zone/Zone.ts:358-375`
    ```ts
            this.clearQueuedEvents(obj);
            obj.isActive = false;

            if (obj.lastLifecycleTick !== World.currentTick) {
                if (obj.lifecycle === EntityLifeCycle.RESPAWN || obj.receiver64 === Obj.NO_RECEIVER) {
    ```
    `World.removeObj` calls `zone.removeObj` before its own `setLifeCycle` (`Engine-TS/src/engine/World.ts:1524-1532`), so `lastLifecycleTick` here is the value from the obj's previous `setLifeCycle` (the `addObj` that placed it, or for a map obj possibly an earlier `removeObj`, rule 3). It equals the current tick when the obj was placed earlier in this same tick.

15. **Zone obj limit.** When a `DESPAWN` obj is added and the zone already holds `Zone.OBJS` (129) objs, the first `DESPAWN` obj in the zone's obj list order is removed with `World.removeObj(obj2, 0)` before the new one is appended. Source: `Engine-TS/src/engine/zone/Zone.ts:38`, `Engine-TS/src/engine/zone/Zone.ts:304-317`

16. **When events are added.** Events come from the `World` methods in rule 13, which are called from: script command handlers (in any phase that runs scripts, see notes 01-07), the phase-1 delayed-obj loop (`Engine-TS/src/engine/World.ts:571`), the phase-2 cheat handler (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:503`), and `Loc.turn`/`Obj.turn` in phase 8 step 2 (rules 7-8). (Grep of `Engine-TS/src` for callers of these `World` methods outside `World.ts` finds only `Loc.ts`, `Obj.ts`, `Zone.ts`, the `InvOps`, `LocOps`, `ObjOps`, `PlayerOps` and `ServerOps` handlers, and `ClientCheatHandler.ts`.)

### The shared buffer (step 3)

17. **`computeShared` encodes only the `ENCLOSED` events, in the order they were added** (a `Set` iterates in insertion order; deleted events are skipped). Each event is written as its zone-protocol opcode byte followed by its payload (`ServerGameZoneMessageEncoder.enclose`). If nothing was written, `shared` stays null. Sources: `Engine-TS/src/engine/zone/Zone.ts:553-559` (`enclosed()`), `Engine-TS/src/network/game/server/ServerGameZoneMessageEncoder.ts:9-12` (`enclose`), and `Engine-TS/src/engine/zone/Zone.ts:101-122`
    ```ts
        computeShared(): void {
            const buf: Packet = Packet.alloc(1);
            for (const event of this.enclosed()) {
                // console.log(event.message);
                const encoder: ServerGameZoneMessageEncoder<ServerGameZoneMessage> | undefined = ServerGameProtRepository.getZoneEncoder(event.message);
                if (typeof encoder === 'undefined') {
                    continue;
                }
                encoder.enclose(buf, event.message);
            }
    ```
    An event whose message has no zone encoder is skipped silently (`Engine-TS/src/engine/zone/Zone.ts:105-108`). All ten zone messages queued by `Zone` (rule 13) have an encoder bound (`Engine-TS/src/network/game/server/ServerGameProtRepository.ts:192-208`), so this does not happen at this commit.
    The `receiver64` of an `ENCLOSED` event is not read here, so it does not limit who gets the event (rule 21).

18. **The buffer is computed after this tick's timers and after every event from phases 1-7.** Step 3 follows step 2 in the same phase (`Engine-TS/src/engine/World.ts:966-980`), so a timer that fires in step 2 is in the same tick's buffer. It is computed once per tracked zone per tick, and the same bytes go to every player (rule 21).

19. **Events after phase 8 are not in the buffer.** `shared` is set only by `computeShared` and cleared only by `reset()` (`Engine-TS/src/engine/zone/Zone.ts:221-225`). No caller of the rule-13 `World` methods was found in the phase 9 and phase 10 code read here (`processInfo`'s loop head, `updateMap`, `updateZones`); [`09-info.md`](09-info.md) rule 18 later read phases 9-11 in full: no script runs and none of these `World` methods is called there (phase 10 only enqueues zone/mapzone triggers, `Engine-TS/src/engine/entity/Player.ts:580-615`; read, not observed).

### From buffer to bytes (phase 10) and cleanup (phase 11)

20. **The active zone list is built per player in phase 10, not here.** In `processClientsOut`, for each connected player in `playerLoop`, `updateMap()` runs before `updateZones()` (`Engine-TS/src/engine/World.ts:1101-1114`). `updateMap` calls `buildArea.rebuildZones()` only when the player's zone (level and 8x8 zone coordinates) differs from `lastZone`. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:264-267`
    ```ts
            // zone changed
            const zone = CoordGrid.packCoord(this.level, (this.x >> 3) << 3, (this.z >> 3) << 3);
            if (this.lastZone !== zone) {
                this.buildArea.rebuildZones();
    ```
    `rebuildZones` clears `activeZones` and adds the 7x7 zones centred on the player's current zone (`centerX - 3 .. centerX + 3`, same for z) on the player's level, skipping any zone more than 6 zones from the build-area origin (`originX/originZ`). Source: `Engine-TS/src/engine/entity/BuildArea.ts:31-55`. So it uses the player's position as of phase 10, after this tick's phase-5 movement and teleports, and the origin as possibly just moved by phase 9's `rebuildNormal()` (`Engine-TS/src/engine/World.ts:1002`; `Engine-TS/src/engine/entity/BuildArea.ts:57-93`). `rebuildNormal` also clears `loadedZones` when it rebuilds (`Engine-TS/src/engine/entity/BuildArea.ts:90`).

21. **Per player, per active zone, in this order** (`updateZones`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:294-315`): first, loaded zones that are no longer active are dropped from `loadedZones` (no packet is written for them). Then for each active zone:
    1. if not in `loadedZones`: `writeFullFollows` (rule 22);
    2. `writePartialEncloses`: if `shared` is non-null, one `UpdateZonePartialEnclosed` packet carrying the zone position relative to the player's origin and the shared bytes (`Engine-TS/src/engine/zone/Zone.ts:198-203`, `Engine-TS/src/network/game/server/codec/UpdateZonePartialEnclosedEncoder.ts:10-14`; opcode 195, variable short length, `Engine-TS/src/network/game/server/ServerGameProt.ts:83`);
    3. `writePartialFollows`: if the zone has any event this tick (`events.size`, which counts `ENCLOSED` ones too), an `UpdateZonePartialFollows` header, then each `FOLLOWS` event whose `receiver64` is -1 or this player, as its own packet (`Engine-TS/src/engine/zone/Zone.ts:208-219`);
    4. add the zone to `loadedZones`.

    Zones are visited in `activeZones` insertion order, which `rebuildZones` fills x-outer, z-inner (`Engine-TS/src/engine/entity/BuildArea.ts:46-52`). The unload pass deletes from `loadedZones` while iterating it with `for..of` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:299-303`); a JavaScript `Set` iterator tolerates deleting the current entry (language semantics, not engine code). An exception in `updateZones` (including `writeFullFollows`) is caught by the per-player `catch` of `processClientsOut`, which logs it and, if the client is still connected, sends `Logout` and closes the client; the rest of that player's phase-10 output is skipped (`Engine-TS/src/engine/World.ts:1124-1129`).

    `ENCLOSED` events reach every player for whom the zone is active, whatever their `receiver64`; `FOLLOWS` events are filtered per player.

22. **`writeFullFollows` sends current state minus this tick's changes.** It writes `UpdateZoneFullFollows`, then for each obj in the zone that is not `updatedThisTick` for this player and is public or the player's own, an `UpdateZonePartialFollows` header and, if the obj is active and `DESPAWN` or `RESPAWN`, an `ObjAdd` (an inactive obj gets the header alone); then for each loc whose `lastLifecycleTick !== currentTick`: an active `DESPAWN` loc as `LocAddChange`, an inactive `RESPAWN` loc as `LocDel`, a changed `RESPAWN` loc as `LocAddChange`. Source: `Engine-TS/src/engine/zone/Zone.ts:157-189`. `updatedThisTick` is true if the obj has an `ObjDel` event, an `ObjAdd` event that is public or to this player, or an `ObjReveal` event to a different receiver; `ObjCount` events do not count. Source: `Engine-TS/src/engine/zone/Zone.ts:124-147`

23. **Bytes go out immediately.** `Player.write` returns if the client is not connected, else calls `writeInner` (`Engine-TS/src/engine/entity/Player.ts:2239-2245`), which encodes opcode (plus ISAAC), length and payload into `client.out` and calls `client.send` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:191-227`); for TCP that is `socket.write` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:15-17`). So zone packets are written during phase 10, in `playerLoop` order, after that player's map, player-info and NPC-info packets.

24. **Phase 11 clears everything.** `processCleanup` first calls `reset()` on every tracked zone (sets `shared = null`, clears `events` and `entityEvents`) and clears `zonesTracking`. Source: `Engine-TS/src/engine/World.ts:1143-1145`, `Engine-TS/src/engine/zone/Zone.ts:221-225`. Events not delivered in that tick's phase 10 are not kept; a player who later loads the zone gets its state from `writeFullFollows` (rule 22).

### Zone membership of players and NPCs

25. Players and NPCs enter and leave zones in other phases (NPC add/remove from scripts and `Npc.turn`, NPC steps in phase 4, player steps in phase 5, logout in phase 6, login in phase 7; [`03-npc-event-queue.md`](03-npc-event-queue.md) rule 4, [`06-players-interaction-movement.md`](06-players-interaction-movement.md) rule 15, [`07-logouts-logins.md`](07-logouts-logins.md)). A step calls `leave`/`enter` only when the zone or level changes (`Engine-TS/src/engine/entity/PathingEntity.ts:185-187`). `Zone.enter`/`leave` update the zone's player or NPC list and, for players, flag the zone in the level's `ZoneGrid` on every player `enter`, and unflag it on a player `leave` only when the zone's `playersCount` reaches 0 (`Engine-TS/src/engine/zone/Zone.ts:93-95`; whole methods `Engine-TS/src/engine/zone/Zone.ts:78-99`, `Engine-TS/src/engine/zone/ZoneGrid.ts:18-24`). Phase 8 reads none of this, and grep finds no caller of `ZoneGrid.isFlagged` (`Engine-TS/src/engine/zone/ZoneGrid.ts:26`) in `Engine-TS/src`.

### Exceptions

26. One `try`/`catch` wraps both steps (`Engine-TS/src/engine/World.ts:965-986`). An error thrown by any `turn()` or `computeShared()` is logged and the rest of the phase is skipped: the remaining events are not visited this tick and no further zone gets `computeShared`. The error does not reach `cycle()`'s `catch` (which removes all players and calls `process.exit(1)`, `Engine-TS/src/engine/World.ts:509-526`), so the tick continues with phase 9. What can throw inside `turn()` was not analysed.

### Worked chain: `loc_change` on a tree (open question #12, engine side)

27. Content: `get_logs` in `woodcut.rs2` calls `loc_change(loc_param(next_loc_stage), $respawnrate)` after scaling `$respawnrate` with `~scale_by_playercount` (`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:136-137`); the command is declared `[command,loc_change](loc $new_loc, int $duration)` (`Content/scripts/engine.rs2:687-688`). The script runs in phase 5 from the player's interaction ([`../flows/click-loc-woodcutting.md`](../flows/click-loc-woodcutting.md), [`06-players-interaction-movement.md`](06-players-interaction-movement.md)). The hops:
    1. `LOC_CHANGE` handler: pops `id, duration`, validates both (`DurationValid`, `LocTypeValid`), calls `World.changeLoc(activeLoc, id, activeLoc.shape, activeLoc.angle, duration)` (keeps shape and angle). Source: `Engine-TS/src/engine/script/handlers/LocOps.ts:60-67`
    2. `World.changeLoc`: returns at once for an inactive `DESPAWN` loc; removes the old type's collision if the loc is active and the old type `blockwalk`s; `loc.change(...)`; adds the new type's collision if it `blockwalk`s; `zone.changeLoc(loc)` (rule 13: `ENCLOSED` `LocAddChange`); `trackZone`; starts the timer (rule 3). The collision map is updated synchronously, before the handler returns; how pathing reads it was not read (#4). Source: `Engine-TS/src/engine/World.ts:1365-1401`
    3. Phase 8 of the same tick: step 2 decrements the loc's timer once (rules 5, 7); step 3 encodes the `LocAddChange` (opcode 138, `Engine-TS/src/network/game/server/ServerGameZoneProt.ts:9`; payload coord byte, `shape << 2 | angle`, 2-byte type, `Engine-TS/src/network/game/server/codec/LocAddChangeEncoder.ts:9-13`) into the zone's `shared` buffer (rule 17).
    4. Phase 10: every connected player whose active zones include that zone gets it inside `UpdateZonePartialEnclosed`; a player loading the zone this tick gets the full-follows state first, which skips this loc because its `lastLifecycleTick` is this tick (rules 21-22).
    5. In later ticks, a player loading the zone gets the changed loc in `writeFullFollows` as a changed `RESPAWN` loc (rule 22), provided the tree is a map (`RESPAWN`) loc.
    6. When the timer reaches 0 in some phase 8, `Loc.turn` calls `revertLoc` (rule 7), which swaps collision back, `revert()`s, queues a `LocAddChange` with the base type, sets no timer and tracks the zone (`Engine-TS/src/engine/World.ts:1442-1463`); the same phase's step 3 puts it in the buffer, and phase 10 sends it.

## Comment-versus-code check

- `cycle()` comment "build list of active zones around players" (`Engine-TS/src/engine/World.ts:387`): **mismatch**. `processZones` builds no such list; the per-player active-zone set is rebuilt in phase 10's `updateMap` when the player's zone changed (rule 20). The phase only uses `zonesTracking`, the set of zones that had a zone event this tick (rule 13), which is not related to where players are.
- `cycle()` comment "loc/obj despawn/respawn" (`Engine-TS/src/engine/World.ts:388`): **matches, incomplete**. Step 2 also reverts changed map locs (`revertLoc`) and reveals private objs (rules 7-10). It runs only for locs/objs with a running timer.
- `cycle()` comment "compute shared buffer" (`Engine-TS/src/engine/World.ts:389`): **matches**, for tracked zones only and only from `ENCLOSED` events (rule 17).
- Header comment above `processZones` (`Engine-TS/src/engine/World.ts:961-962`) lists only "loc/obj despawn/respawn" and "compute shared buffer": consistent with the body.
- "Check if the event is still valid" / "If this is false, we have not constructed our LinkedList properly somewhere" (`Engine-TS/src/engine/World.ts:967`, `Engine-TS/src/engine/World.ts:971`): consistent; by the code read the check cannot fail (Inferences).
- "Compute shared for tracked zones" (`Engine-TS/src/engine/World.ts:977`): matches.
- `World.addObj` "objs with a receiver always attempt to reveal 100 ticks after being dropped" (`Engine-TS/src/engine/World.ts:1487`): **matches with conditions**. The countdown runs only while the obj has a timer (rule 9), is counted in phase-8 visits starting with the drop tick's phase 8 (Inferences), and is not restarted when a drop merges into an existing stack (rule 4). The follow-up comment "items that can't be revealed ... will be skipped in revealObj" (`Engine-TS/src/engine/World.ts:1488`) matches rule 10.
- `Zone.clearQueuedEvents` doc "objs are added into a zone than what the zone can actually hold, then the cheapest objs are automatically dropped" (`Engine-TS/src/engine/zone/Zone.ts:588-589`): **mismatch**. `Zone.addObj` removes the first `DESPAWN` obj in the zone's list order, with no value comparison (rule 15).
- `Zone.writeFullFollows` doc "This does not include any updates that were made to the zones THIS TICK" (`Engine-TS/src/engine/zone/Zone.ts:155`): **mostly matches**. Objs with `ObjDel`/`ObjAdd`/`ObjReveal` events are skipped, and so is every loc with `lastLifecycleTick === currentTick`, i.e. any loc on which `setLifeCycle` was called this tick, including calls that set -1 (`revertLoc`, an unchanged `changeLoc`, a `DESPAWN` `removeLoc`; rules 2-3); `animLoc`/`mergeLoc` do not set it; an obj whose count changed this tick (`ObjCount`, a `FOLLOWS` event) is not skipped and is written with its new count, and the `ObjCount` event is then also sent by `writePartialFollows` (rules 21-22).
- `Zone.writeFullFollows` doc "When UpdateZoneFullFollows is written, this completely resets the client zones to default" / "Default zones, meaning, no objs and the original locs" (`Engine-TS/src/engine/zone/Zone.ts:150-154`): **claims about the client**, not checkable from engine code; client not read (#38).
- `World.changeLoc` comment "If a dynamic loc is inactive, it should never return to the game world" (`Engine-TS/src/engine/World.ts:1366`): matches; the guard returns for a `DESPAWN` loc that is not valid, before any change (rule 3).
- `Zone.writePartialEncloses` doc "Updates are only known by the server once per cycle" (`Engine-TS/src/engine/zone/Zone.ts:193`): consistent with rule 18.
- `Zone.enclosed()`/`follows()` doc "These are cleared at the end of every game cycle" (`Engine-TS/src/engine/zone/Zone.ts:551`, `Engine-TS/src/engine/zone/Zone.ts:563`): matches (rule 24).
- `Loc.turn`/`Obj.turn` "Fail safe in case no conditions are met (should never happen)" (`Engine-TS/src/engine/entity/Loc.ts:65`, `Engine-TS/src/engine/entity/Obj.ts:41`): not checked whether reachable (Not checked).

## Inferences (labelled)

- **Inference: a timer started with duration d (d >= 1) in phases 1-7 of tick T fires in phase 8 of tick T+d-1.** The same tick's phase 8 is the first decrement (rule 5), and it fires when the count reaches 0 (rules 7-8). So `loc_change(..., 1)` or `loc_del(1)` from a phase-5 script is undone in phase 8 of the **same** tick, and both `LocAddChange` events (changed, then base type) end up in that tick's shared buffer in that order (rules 13, 17). Rests on rules 2, 5, 7, 17. Not observed.
- **Inference: an obj dropped to a player in phase 5 of tick T with duration 200** (e.g. the inventory-overflow drop, `Engine-TS/src/engine/script/handlers/InvOps.ts:77`), if it does not merge into an existing stack, is revealed in phase 8 of T+99 (if tradeable, and not members-only on a free world) and removed in phase 8 of T+199; clients see each change in phase 10 of that tick. Rests on rules 3, 8-10, 21.
- **Inference: an obj added and removed in the same tick is never sent to any client**: the removal clears its `ObjAdd` and, since `lastLifecycleTick` equals the current tick, queues no `ObjDel` (rule 14). Rests on rules 2, 14.
- **Inference: `event.check()` is always true for an event in the list**, because `eventTracker` is only set by the `LocObjEvent` constructor, and `setLifeCycle` unlinks the old event whenever it replaces or clears it (rule 2). Rests on rules 1-2.
- **Inference: if an exception stops step 2, no zone has a shared buffer that tick**, so all `ENCLOSED` events of that tick (loc changes, public obj adds and removals, reveals, map anims) are never sent to players who already had the zone loaded, and phase 11 discards them (rules 21, 24, 26). Their clients would keep the old view of those zones until the zone is loaded again with `writeFullFollows` (client behaviour not checked). `FOLLOWS` events are still sent, since `writePartialFollows` reads `events` directly. Rests on rules 17, 21, 24, 26.
- **Inference: the active zone set is always consistent with the origin set in phase 9.** `rebuildNormal` moves the origin only when the player is outside the reload window around the old origin (`Engine-TS/src/engine/entity/BuildArea.ts:61-67`); the window edges are zone edges, so a player outside it is in a different zone than at the last phase 10 (when the player was inside it), so `rebuildZones` runs in the same tick's phase 10 with the new origin. Rests on rule 20 and on nothing moving the player between phases 9 and 10, which [`09-info.md`](09-info.md) rule 18 found by reading (phase 10 runs no script and no movement; not observed).
- **Inference: a `RESPAWN` obj removed with a respawn duration that scales to 0 never respawns** (no timer, rule 11). Whether content has such small `respawnrate` values was not checked.

## Not checked / open questions

- Client handling of `UPDATE_ZONE_FULL_FOLLOWS`, `UPDATE_ZONE_PARTIAL_FOLLOWS`, `UPDATE_ZONE_PARTIAL_ENCLOSED` and the zone messages (in particular `LOC_ADD_CHANGE`, `OBJ_REVEAL` for the original receiver, and `OBJ_COUNT` after a full follows that already has the new count). Also in `docs/open-questions.md` as #12 and #38.
- Whether anything queues zone events after phase 8 (phases 9-11), and so misses the shared buffer: answered by reading in [`09-info.md`](09-info.md) rule 18 (nothing does; not observed).
- What can throw inside `Loc.turn`/`Obj.turn`/`computeShared` (e.g. `LocType.get` on a bad id), and whether the fail-safe branches are reachable. Also in `docs/open-questions.md` as #38.
- `changeLocCollision` and the routefinder collision maps (boundary, see #4).
- Reconnect: `activeZones` and `lastZone` after `onReconnect` (07 rule 18) were not traced.
- Content values: woodcutting `respawnrate` values and `next_loc_stage` params (#12); obj `respawnrate` values (rule 11; `docs/open-questions.md` #51).

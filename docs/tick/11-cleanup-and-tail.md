# Phase 11: `processCleanup` and the end of `cycle()`

**Question answered:** What does the last phase of a game tick reset (zones, players, NPCs, inventories, rsbuf), why must that come after phase 10, and what does `cycle()` do after it: shutdown handling, autosave and check-in logging, log flushing, statistics, the `currentTick` increment (so which tick number each phase sees), the rescheduling and drift formula, what happens when a tick overruns 600 ms, and what happens when an exception escapes a phase?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". The worked timing examples are arithmetic on the code, not measurements. The login, friend and logger worker threads, `prom-client` and Node's timer and `process.exit` internals were not read (boundary).

Related notes: [`08-zones.md`](08-zones.md) (rule 24: zone reset; rules 19-22: what phase 10 reads from zones), [`09-info.md`](09-info.md) (rule 7: `rsbuf.cleanup` and the block caches; rules 16-18: masks and the phase-11 `FACE_ENTITY` writer; rule 26: no `catch` in phase 9), [`10-clients-out.md`](10-clients-out.md) (rule 13: restock sent in T+1; rule 16: disconnected players; rules 20-21: bandwidth stats), [`05-players-queues-timers.md`](05-players-queues-timers.md) (rule 3: the phase-5 `catch`; `protect`), [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (`apRangeCalled`, `stepsTaken`, `walkDir`/`runDir`, one-tick-late `FACE_ENTITY`), [`07-logouts-logins.md`](07-logouts-logins.md) (shutdown in phases 6-7, `removePlayer`, `logoutRequests`), [`04-npcs.md`](04-npcs.md) (rule 16; the phase-4 `catch`), [`01-world.md`](01-world.md) (the phase-1 `catch` blocks).

## Position in the tick

`processCleanup()` is the eleventh and last phase call in `World.cycle()`, after `processClientsOut()` (phase 10). Everything after it in `cycle()` (here called "the tail") runs inside the same `try`. Source: `Engine-TS/src/engine/World.ts:408-423`
```ts
            this.processClientsOut();

            // cleanup
            // - reset zones
            // - reset players
            // - reset npcs
            // - reset invs
            this.processCleanup();

            // ----

            const tick: number = this.currentTick;

            if (this.shutdown) {
                this.processShutdown();
            }
```

The next thing that runs is phase 1 of the next tick, started by the `setTimeout` at the end of the tail (`Engine-TS/src/engine/World.ts:508`), or nothing if the tail or the `catch` exits the process.

## L2: ordered sub-steps

### `processCleanup` (`Engine-TS/src/engine/World.ts:1135-1207`)

1. Record a start time; `tick = currentTick`. Source: `Engine-TS/src/engine/World.ts:1140-1141`
2. **Zones:** `reset()` every zone in `zonesTracking`, then clear `zonesTracking` (L3 rule 2). Source: `Engine-TS/src/engine/World.ts:1143-1145`
3. **Players**, in `playerLoop.all()` order (the order of phases 2, 5, 6, 9 and 10; [`02-clients-in.md`](02-clients-in.md) rules 1-2): `player.resetEntity(false)` (L3 rules 3-5), then `resetTracking()` on each non-null inventory in `player.invs` (L3 rule 7). Source: `Engine-TS/src/engine/World.ts:1147-1159`
4. **NPCs**, in `World.npcs` iteration order (ascending nid, `Engine-TS/src/engine/entity/EntityList.ts:36-47`): `npc.resetEntity(false)` (L3 rule 6). Source: `Engine-TS/src/engine/World.ts:1161-1164`
5. **World inventories** (`World.invs`, a `Set`, so insertion order): `resetTracking()`, then shop restock/destock for this inventory (L3 rules 7-8). Source: `Engine-TS/src/engine/World.ts:1166-1202`
6. `rsbuf.cleanup()` (L3 rule 9). Source: `Engine-TS/src/engine/World.ts:1204`
7. Store elapsed ms in `cycleStats[CLEANUP]`. Source: `Engine-TS/src/engine/World.ts:1206`

There is no `try`/`catch` in `processCleanup` (L3 rule 24).

### The tail of `cycle()` (`Engine-TS/src/engine/World.ts:417-508`)

1. `tick = currentTick` (the number every phase of this tick used, L3 rule 12). Source: `Engine-TS/src/engine/World.ts:419`
2. If `shutdown` (`shutdownTick != -1 && currentTick >= shutdownTick`): `processShutdown()` (L3 rules 13-14). Source: `Engine-TS/src/engine/World.ts:421-423`, `Engine-TS/src/engine/World.ts:197-199`
3. If `tick % 1500 === 0 && tick > 0`: `savePlayers()` (L3 rule 15). Source: `Engine-TS/src/engine/World.ts:425-428`
4. If `tick % 50 === 0 && tick > 0`: a "Server check in" session-log entry for every player in `playerLoop` (L3 rule 16). Source: `Engine-TS/src/engine/World.ts:430-434`
5. Post any session logs, then any grouped and ungrouped wealth events, to the logger thread, and empty the buffers (L3 rule 17). Source: `Engine-TS/src/engine/World.ts:436-459`
6. `cycleStats[CYCLE] = Date.now() - start`; copy all 12 stats to `lastCycleStats` (L3 rule 18). Source: `Engine-TS/src/engine/World.ts:461-474`
7. In production only: set/observe the Prometheus metrics (L3 rule 18). Source: `Engine-TS/src/engine/World.ts:476-493`
8. If `debugProfile`: print three lines of timings and counts (L3 rule 18). Source: `Engine-TS/src/engine/World.ts:495-501`
9. `currentTick++`; `nextTick += tickRate` (L3 rules 12, 19). Source: `Engine-TS/src/engine/World.ts:503-504`
10. `setTimeout(this.cycle, Math.max(0, tickRate - (Date.now() - start) - drift))` (L3 rules 19-21). Source: `Engine-TS/src/engine/World.ts:508`

If anything in phases 1-11 or the tail throws out to `cycle()`, the `catch` removes every player and calls `process.exit(1)` (L3 rules 22-23). Source: `Engine-TS/src/engine/World.ts:509-526`

## L3: ordering rules

### What phase 11 resets, and why after phase 10

1. **Phase 11 runs no script and writes no packet.** It calls only `zone.reset`, `resetEntity(false)` (which ends in `setFaceEntity`, a mask write, rule 5), `Inventory.resetTracking`, `Inventory.add`/`remove` for restock, and `rsbuf.cleanup` (`Engine-TS/src/engine/World.ts:1139-1207`). None of these calls `write` or runs a script (read in full: `Engine-TS/src/engine/zone/Zone.ts:221-225`, `Engine-TS/src/engine/entity/Player.ts:470-484`, `Engine-TS/src/engine/entity/Npc.ts:289-329`, `Engine-TS/src/engine/entity/PathingEntity.ts:593-631`, `Engine-TS/src/engine/entity/PathingEntity.ts:514-532`, `Engine-TS/src/engine/Inventory.ts:107-245`, `Engine-TS/src/network/rsbuf/index.ts:297-308`). This agrees with [`09-info.md`](09-info.md) rule 18 and [`10-clients-out.md`](10-clients-out.md) rule 13.

2. **Zones: only zones that got an event this tick are reset.** `Zone.reset()` sets `shared = null` and clears `events` and `entityEvents` (`Engine-TS/src/engine/zone/Zone.ts:221-225`). `zonesTracking` is filled only by `World.trackZone`, which every zone-event method of `World` calls ([`08-zones.md`](08-zones.md) rules 13 and 24; `Engine-TS/src/engine/World.ts:1348-1350`). **Why after phase 10:** phase 10's `updateZones` reads `shared` (`writePartialEncloses`), `events` (`writePartialFollows`) and `entityEvents` (`updatedThisTick`, called from `writeFullFollows`) (`Engine-TS/src/engine/zone/Zone.ts:124-125`, `Engine-TS/src/engine/zone/Zone.ts:157-162`, `Engine-TS/src/engine/zone/Zone.ts:198-219`). Events not delivered in this tick's phase 10 are dropped ([`08-zones.md`](08-zones.md) rule 24). Source: `Engine-TS/src/engine/World.ts:1143-1145`
   ```ts
           this.zonesTracking.forEach(zone => zone.reset());
           this.zonesTracking.clear();
   ```

3. **Players: `resetEntity(false)` = `resetPathingEntity()` plus nine player fields.** With `respawn` false, `unfocus()` is not called. After `resetPathingEntity()` (rule 4) it sets `repathed = false`, `protect = false`, `chatColour`, `chatEffect`, `chatRights`, `chatMessage` and `logMessage` to `null`, and `socialProtect` and `reportAbuseProtect` to `false`. Source: `Engine-TS/src/engine/entity/Player.ts:470-484`
   ```ts
       resetEntity(respawn: boolean) {
           if (respawn) {
               this.unfocus();
           }
           super.resetPathingEntity();
           this.repathed = false;
           this.protect = false;
   ```
   Effects (each established in an earlier note or by the cited lines):
   - `protect`: a protected script that suspended keeps `protect` true for at most the rest of the tick ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 7).
   - `chatMessage`/`chatColour`/`chatEffect`/`chatRights`: set by `MessagePublicHandler` in phase 2 and read by phase 9 into the `CHAT` block (`Engine-TS/src/engine/World.ts:1036-1039`; [`02-clients-in.md`](02-clients-in.md) rule 13, [`09-info.md`](09-info.md) rule 17). `logMessage` is read in phase 2 itself (`Engine-TS/src/engine/World.ts:632-634`).
   - `socialProtect` and `reportAbuseProtect`: the social handlers refuse a packet while the flag is set and set it when they accept one (e.g. `Engine-TS/src/network/game/client/handler/MessagePublicHandler.ts:14`, `Engine-TS/src/network/game/client/handler/MessagePublicHandler.ts:42`, `Engine-TS/src/network/game/client/handler/ReportAbuseHandler.ts:10`, `Engine-TS/src/network/game/client/handler/ReportAbuseHandler.ts:26`), so with the phase-11 reset at most one such packet per player is accepted per tick (as in [`02-clients-in.md`](02-clients-in.md) rule 15).
   - `repathed`: grep of `Engine-TS/src` finds only its declaration (`Engine-TS/src/engine/entity/PathingEntity.ts:63`) and this reset; no other reader or writer.

4. **`resetPathingEntity()` (players and NPCs) clears the per-tick movement and visual state.** In order: `moveSpeed = defaultMoveSpeed()` (players: `RUN` if `run` else `WALK`; NPCs: `WALK`; `Engine-TS/src/engine/entity/Player.ts:729-731`, `Engine-TS/src/engine/entity/Npc.ts:420-422`); `walkDir = runDir = -1`; `jump = tele = false`; `lastTickX/Z/Level` = the current `x`/`z`/`level`; `stepsTaken = 0`; `interacted = false`; `apRangeCalled = false`; `masks = 0`; the seven `EXACT_MOVE` fields to -1; `animId`/`animDelay` to -1 (written twice); `sayMessage = null`; both hitmarks' damage/type to -1 and `hitmarkSlot = 0`; `spotanimId/Height/Time` to -1; `faceSquareX/Z` to -1; then `setFaceEntity()`. Source: `Engine-TS/src/engine/entity/PathingEntity.ts:593-631`
   ```ts
       protected resetPathingEntity(): void {
           this.moveSpeed = this.defaultMoveSpeed();
           this.walkDir = -1;
           this.runDir = -1;
           this.jump = false;
           this.tele = false;
           this.lastTickX = this.x;
           this.lastTickZ = this.z;
           this.lastLevel = this.level;
           this.stepsTaken = 0;
           this.interacted = false;
           this.apRangeCalled = false;
   
           this.masks = 0;
   ```
   **Why after phase 10, field by field:**
   - Phase 10 reads these entity fields directly, not through rsbuf: `updatePlayers`/`updateNpcs` pass `|lastTickX - x|`, `|lastTickZ - z|` and `lastLevel !== level` to the info encoders (`Engine-TS/src/engine/entity/NetworkPlayer.ts:286-292`), which `npcInfo` uses to decide whether the observer's NPC list is rebuilt ([`09-info.md`](09-info.md) rule 20); `updateAfkZones` reads `moveSpeed` and `jump` (`Engine-TS/src/engine/entity/Player.ts:2128-2141`). Resetting `lastTickX/Z/Level`, `moveSpeed` or `jump` before phase 10 would change those results.
   - `masks`, `walkDir`/`runDir`, `tele`/`jump` and the visual fields are copied into the rsbuf record in phase 9 ([`09-info.md`](09-info.md) rule 1); phase 10 encodes from the copies, which `rsbuf.cleanup()` clears at the end of phase 11 (rule 9).
   - The next tick reads the reset values: `lastTickX/Z` is the "position at the previous phase 11" used by phase 4's `moved` check (`Engine-TS/src/engine/entity/Npc.ts:374`) and phase 5's `validateDistanceWalked` (`Engine-TS/src/engine/entity/PathingEntity.ts:324-335`); `walkDir`/`runDir` = -1 and `stepsTaken` = 0 at the start of a turn bound movement to one or two steps per tick ([`06-players-interaction-movement.md`](06-players-interaction-movement.md), [`04b-npc-modes.md`](04b-npc-modes.md)); `apRangeCalled` ([`06-players-interaction-movement.md`](06-players-interaction-movement.md)).
   - `interacted`: grep of `Engine-TS/src` finds the field only at its declaration (`Engine-TS/src/engine/entity/PathingEntity.ts:62`) and this reset; the `interacted` in `processInteraction` is a local variable (`Engine-TS/src/engine/entity/Player.ts:1254`).

5. **The `FACE_ENTITY` mask is re-armed after the clear.** `setFaceEntity()` runs after `masks = 0`: it recomputes `faceEntity` from the current `target` (player slot + 32768, NPC nid, or -1) and sets the mask bit only if the value changed (`Engine-TS/src/engine/entity/PathingEntity.ts:514-532`, `Engine-TS/src/engine/entity/PathingEntity.ts:630`). So a target set or cleared after the entity's own `setFaceEntity` call in phase 4/5 is sent in the next tick's phase 9/10. This is the one mask write after phase 9 ([`09-info.md`](09-info.md) rule 18; [`06-players-interaction-movement.md`](06-players-interaction-movement.md) rule 1 and Inferences; open question #31 for the client side).

6. **NPCs: `resetEntity(false)` is only `resetPathingEntity()`.** The `respawn = true` branch (type, stats, queue, vars, hunt, `delayed`, `tele = true`) is used by `World.addNpc` and is not reached from phase 11. Source: `Engine-TS/src/engine/entity/Npc.ts:289-329`
   ```ts
           } else {
               super.resetPathingEntity();
           }
   ```
   The loop visits every NPC still in `World.npcs`, which includes inactive `RESPAWN` NPCs waiting to respawn (they are not removed from the list, `Engine-TS/src/engine/World.ts:1327-1333`; [`09-info.md`](09-info.md) rule 22). A `DESPAWN` NPC removed earlier in the tick is no longer in the list and is not visited.

7. **Inventory tracking is cleared for every player inventory and every world inventory.** `resetTracking()` sets `update = false` and clears `dirtySlots` (`Engine-TS/src/engine/Inventory.ts:237-240`). Every item change sets both (`markDirty`, `Engine-TS/src/engine/Inventory.ts:242-245`). **Why after phase 10:** `updateInvs` sends a partial update from `inv.update` and `getDirtySlots()` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:354-355`; [`10-clients-out.md`](10-clients-out.md) rule 5). Players are visited whether or not their client is connected, so a disconnected player's inventory changes are discarded without being sent ([`10-clients-out.md`](10-clients-out.md) rule 16). `World.invs` holds the `SCOPE_SHARED` inventories created by `reload` and any created by `getInventory` (`Engine-TS/src/engine/World.ts:223-229`, `Engine-TS/src/engine/World.ts:1253-1267`).

8. **Shop restock runs after `resetTracking`, uses this tick's number, and is sent next tick.** For a world inventory whose type has `restock` and both `stockcount` and `stockrate` arrays (config codes 4 and 5, `Engine-TS/src/cache/config/InvType.ts:91-104`), each non-null slot `index` is checked in order (`Engine-TS/src/engine/World.ts:1170-1201`):
   - count below `stockcount[index]` and `tick % stockrate[index] === 0`: `inv.add(id, 1, index)`;
   - else count above `stockcount[index]` and `tick % stockrate[index] === 0`: `inv.remove(id, 1, index)`;
   - else, if the type has `allstock` (code 6, `Engine-TS/src/cache/config/InvType.ts:105-106`) and `stockcount[index]` is 0 or absent, and `tick % 100 === 0` (`INV_STOCKRATE`, `Engine-TS/src/engine/World.ts:122`): `inv.remove(id, 1, index)`.
   - A `stockrate[index]` of 0 makes `tick % 0` `NaN` (language semantics), so the two rate tests are never true and that slot never restocks or destocks by rate (only the `allstock` branch can still apply).

   Source: `Engine-TS/src/engine/World.ts:1182-1200`
   ```ts
                   // Item stock is under min
                   if (item.count < invType.stockcount[index] && tick % invType.stockrate[index] === 0) {
                       inv.add(item.id, 1, index);
                       inv.update = true;
                       continue;
                   }
   ```
   `tick` is `currentTick` of this tick (`Engine-TS/src/engine/World.ts:1141`), so restock fires on ticks that are multiples of the rate, including tick 0 (there is no `tick > 0` guard here, unlike the tail). `remove` keeps a slot at count 0 instead of emptying it when the id is one of the type's `stockobj` (`Engine-TS/src/engine/Inventory.ts:153`, `Engine-TS/src/engine/Inventory.ts:181-183`). Because this runs after the same inventory's `resetTracking`, the change leaves `update`/`dirtySlots` set and goes out as a partial update in phase 10 of the next tick ([`10-clients-out.md`](10-clients-out.md) rule 13). The `stockcount`/`stockrate` values for actual shops are content data and were not read.

9. **`rsbuf.cleanup()` is last.** It clears `PLAYER_GRID`, the non-appearance block caches and `highs` of both renderers, and the per-tick fields of every rsbuf player and NPC record (`Engine-TS/src/network/rsbuf/index.ts:297-308`, `Engine-TS/src/network/rsbuf/renderer.ts:128-133`, `Engine-TS/src/network/rsbuf/renderer.ts:233-238`, `Engine-TS/src/network/rsbuf/player.ts:61-83`, `Engine-TS/src/network/rsbuf/npc.ts:35-55`). **Why after phase 10:** phase 10 encodes per observer from these records and caches ([`09-info.md`](09-info.md) rules 2, 7). The appearance cache, `lows`, positions and NPC `observers` are kept ([`09-info.md`](09-info.md) rule 7).

10. **What phase 11 does not touch.** Reading the functions in rules 2-9, none changes: `target`/interaction, waypoints, `delayed`/`delayedUntil`, queues and timers, `activeScript`, `faceEntity`'s value except through `setFaceEntity` (rule 5), the stored orientation, `run`/run energy, modal state, `loggingOut`, or the `newPlayers`/`logoutRequests` collections. Those persist into the next tick.

11. **Order inside phase 11 matters in one place only (Inference).** Restock must follow `resetTracking` for its change to be sent (rule 8, `Engine-TS/src/engine/World.ts:1168-1192`). The other steps touch disjoint state (zones; entity fields; inventory flags; rsbuf), and none reads what another writes, by the functions read in rules 2-9.

### Tick numbering

12. **Every phase of a tick and the whole tail see the same `currentTick`; it is incremented once, near the very end.** `currentTick` starts at 0 (`Engine-TS/src/engine/World.ts:164`) and its only writer is `currentTick++` (grep of `Engine-TS/src`), after the stats and the `debugProfile` print and just before `nextTick` and the `setTimeout`. Source: `Engine-TS/src/engine/World.ts:503-508`
    ```ts
                this.currentTick++;
                this.nextTick += this.tickRate;
    
                // ----
    
                setTimeout(this.cycle.bind(this), Math.max(0, this.tickRate - (Date.now() - start) - drift));
    ```
    So in tick N, phases 1-11, `processShutdown`, the autosave and check-in tests (`tick` captured at `Engine-TS/src/engine/World.ts:419`) and the `debugProfile` line ("tick N", `Engine-TS/src/engine/World.ts:496`) all use N. **Inference:** code that runs between ticks (worker-thread messages, socket events, signals; [`07-logouts-logins.md`](07-logouts-logins.md) Inference on between-tick handling) sees N+1, the number of the tick about to run. For example `SIGINT`/`SIGTERM` call `World.rebootTimer(0)` (`Engine-TS/src/app.ts:48-58`), which sets `shutdownTick = currentTick + 0` (`Engine-TS/src/engine/World.ts:1803-1809`; only on the first signal, later ones return at the `exiting` guard, `Engine-TS/src/app.ts:47-55`); between ticks that is N+1, so the next tick is the first shutdown tick. A `::reboot` cheat (production, staff level 3 or more, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:189`, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:412-416`) runs in phase 2 of tick N and sets `shutdownTick = N`, so that same tick's phases 5-6 and tail already see `shutdown` true.

### Shutdown

13. **`processShutdown` runs in the tail of every tick from `shutdownTick` on, after phase 11.** Order (`Engine-TS/src/engine/World.ts:1209-1237`):
    1. every player in `playerLoop` whose client is connected: `logout()` (writes `Logout`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:230-232`) and `client.close()`. This repeats on every shutdown tick for a player still in `playerLoop` with a connected client (until the `close` event swaps in a `NullClientSocket`, open question #29);
    2. `duration = currentTick - shutdownTick`; if `duration >= 1024`: for every player in `playerLoop`, a session-log entry "Player force removed!", an error print, and `removePlayer` (no logout trigger, no `canAccess`/queue checks, unlike phase 6, [`07-logouts-logins.md`](07-logouts-logins.md));
    3. if `getTotalPlayers() === 0` (slots 1-2046, `Engine-TS/src/engine/World.ts:1719-1729`) **and** `logoutRequests.size === 0`: print "Server shutdown complete" and `process.exit(0)`;
    4. if `duration > 2`: `tickRate = 0`.

    Source: `Engine-TS/src/engine/World.ts:1217-1236`
    ```ts
            const duration = this.currentTick - this.shutdownTick;
            if (duration >= 1024) {
                // force remove all players, they had their chances to finish processing
    // ...
            const online = this.getTotalPlayers();
            if (online === 0 && this.logoutRequests.size === 0) {
                printInfo('Server shutdown complete');
                process.exit(0);
            }
    
            if (duration > 2) {
                // after 1 second, kick into high gear (need time to flush logout packets first)
                this.tickRate = 0;
            }
    ```
    Removing players while iterating `playerLoop.all()` is safe: the iterator saves `next` before yielding (`Engine-TS/src/datastruct/HashTable.ts:49-61`). Phase 6 of the same ticks also force-logs players out while `shutdown` is true, and `canAccess()` is always true then ([`07-logouts-logins.md`](07-logouts-logins.md) rule 3; `Engine-TS/src/engine/entity/Player.ts:825-832`).

14. **Exit waits for the login server to confirm every logout save.** `removePlayer` (from phase 6 or the force-removal) calls `flushPlayer`, which stores `{ save, lastAttempt: -1 }` in `logoutRequests` (`Engine-TS/src/engine/World.ts:1622-1623`, `Engine-TS/src/engine/World.ts:2365-2372`). The save is posted to the login thread only by phase 6's resend loop, which posts every entry whose `lastAttempt` is more than 15 s old (so at once for `-1`) (`Engine-TS/src/engine/World.ts:795-804`): in the same phase 6 for a phase-6 removal (`removePlayer` at `Engine-TS/src/engine/World.ts:790` runs in the per-player loop, `Engine-TS/src/engine/World.ts:742-793`, before the resend loop; as [`07-logouts-logins.md`](07-logouts-logins.md) rule 10), and in phase 6 of the next tick for a removal in the tail or the `catch`, and the entry is deleted only when the login thread answers `success` (`Engine-TS/src/engine/World.ts:1961-1969`). **Inference:** a player force-removed in the tail of tick N has its save posted in phase 6 of tick N+1, and the process can exit only after a later tick finds the answer has arrived; if the login thread never answers with `success`, the world keeps ticking (at `tickRate` 0, rule 21) and re-posting every 15 s. Rests on rules 13-14. The login thread was not read (open question #34).

### Periodic work in the tail

15. **Autosave every 1500 ticks.** `PLAYER_SAVERATE = 1500`, commented "15m autosave" (`Engine-TS/src/engine/World.ts:124`). On a tick N with `N % 1500 === 0 && N > 0` (so ticks 1500, 3000, ...; never tick 0), `savePlayers()` posts `{ type: 'player_autosave', username, save: player.save() }` to the login thread for every player in `playerLoop`, connected or not (`Engine-TS/src/engine/World.ts:425-428`, `Engine-TS/src/engine/World.ts:1239-1247`). It runs after `processShutdown`, so on a tick where `processShutdown` exits, no autosave happens. What `save()` contains and what the login thread does with it were not read (open question #34).

16. **"Server check in" every 50 ticks.** `PLAYER_COORDLOGRATE = 50`, commented "30s server check-in" (`Engine-TS/src/engine/World.ts:125`). On a tick N with `N % 50 === 0 && N > 0`, every player in `playerLoop` gets `addSessionLog(MODERATOR, 'Server check in')` (`Engine-TS/src/engine/World.ts:430-434`). `Player.addSessionLog` passes the player's packed coordinate (`Engine-TS/src/engine/entity/Player.ts:648-650`), and `World.addSessionLog` stores `{ session_uuid, timestamp, coord, event, event_type }` in `sessionLogs` (`Engine-TS/src/engine/World.ts:2264-2273`). This is the "coordinate log": a periodic position record per player.

17. **Session and wealth logs are flushed every tick in which there are any.** If `sessionLogs` is not empty it is posted as one `session_log` message to the logger thread and replaced with a new array; then all grouped wealth events are appended to `wealthTransactions` and the group map cleared; then, if `wealthTransactions` is not empty, it is posted as one `wealth_event` message and replaced (`Engine-TS/src/engine/World.ts:436-459`). Grouped events are keyed by event type, session, recipient, coordinate **and `currentTick`** (`Engine-TS/src/engine/World.ts:2290-2296`), so grouping only merges events of one tick, which this flush then sends. The flush runs after `processShutdown` and the check-in, so their log entries leave in the same tick. **Inference:** on the tick where `processShutdown` calls `process.exit(0)`, the flush at `Engine-TS/src/engine/World.ts:436-459` is not reached, so that tick's session logs (for example the "Logged out" entry `removePlayer` adds, `Engine-TS/src/engine/World.ts:1622`) and wealth events are never posted. Whether messages posted in earlier ticks reach the logger thread before `exit` was not checked (open question #45).

### Statistics

18. **Cycle stats, Prometheus and the debug print.** `cycleStats[CYCLE]` is set to the whole cycle's time up to this point (phases plus tail work so far) "before telemetry", then all 12 entries are copied into `lastCycleStats` (`Engine-TS/src/engine/World.ts:461-474`). Grep of `Engine-TS/src` finds no reader of `lastCycleStats` outside these assignments. Both arrays are `Uint16Array(12)` (`Engine-TS/src/engine/World.ts:160-161`), so a stored value wraps modulo 65536 ([`10-clients-out.md`](10-clients-out.md) rule 21). In production (`NODE_PRODUCTION`, default false, `Engine-TS/src/util/WorldConfig.ts:99`, `Engine-TS/src/util/WorldConfig.ts:238`) the player and NPC count gauges are set and the cycle, world, client-in, client-out, NPC, player, zone, login and logout times are observed into histograms, and the two bandwidth counters incremented (`Engine-TS/src/engine/World.ts:476-493`). There is no metric for `CLEANUP` (none is defined in `Engine-TS/src/server/Metrics.ts:1-73`). These are not pushed anywhere by the tick: they are held by `prom-client` and served on the management server's `/prometheus` route (`Engine-TS/src/web.ts:318-321`). If `debugProfile` (`NODE_DEBUG_PROFILE`, default false, `Engine-TS/src/util/WorldConfig.ts:102`, `Engine-TS/src/util/WorldConfig.ts:241`), three lines are printed each tick: "tick N: cycle/tickRate ms, heap MB", the player/NPC/zone/loc/obj counts, and the per-phase ms (`Engine-TS/src/engine/World.ts:495-501`). Phases 3 and 9 have no timing entry ([`09-info.md`](09-info.md) Position section). Time spent after line 461 (Prometheus, the print) is not in `CYCLE` but is subtracted from the next delay by rule 19's `Date.now() - start`.

### Scheduling

19. **Rescheduling formula.** At startup `nextTick = Date.now() + 600` and the first `cycle()` is called at once (`Engine-TS/src/engine/World.ts:330-335`). Each cycle computes, at its start, `drift = max(0, start - nextTick)` (`Engine-TS/src/engine/World.ts:342-343`), and at its end `nextTick += tickRate` and `delay = max(0, tickRate - (Date.now() - start) - drift)` (`Engine-TS/src/engine/World.ts:504-508`). `tickRate` starts at `TICKRATE = 600` (`Engine-TS/src/engine/World.ts:120`, `Engine-TS/src/engine/World.ts:163`) and is changed only by `processShutdown` (to 0, rule 13) and by the developer cheat `::speed <ms>` (non-production, staff level 4 or more, `ms >= 20`; `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:57`, `Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:154-167`). The start of each cycle: Source: `Engine-TS/src/engine/World.ts:341-343`
    ```ts
            try {
                const start: number = Date.now();
                const drift: number = Math.max(0, start - this.nextTick);
    ```
    **Worked arithmetic (inference from the code; assumes the timer fires exactly when asked, which was not checked).** Let cycle 0 start at time 0, so `nextTick` is 600 when it starts. Then at the start of cycle k, `nextTick = 600(k+1)`, the time cycle k+1 would start on a perfect schedule. Write `L` for how late cycle k starts compared with `600k`. Then `drift = max(0, L - 600)`.
    - Steady state, each cycle takes 100 ms: cycle 0 at 0, `drift = 0`, `delay = 600 - 100 - 0 = 500`, cycle 1 at 600; `nextTick` is then 1200, `drift = 0`; and so on. `drift` is 0 whenever a cycle starts less than one full tick late.
    - One overrun of 900 ms in cycle 1 (start 600): `delay = max(0, 600 - 900 - 0) = 0`, cycle 2 starts at 1500 (`L = 300`), `nextTick = 1800`, `drift = 0`. If cycle 2 takes 100 ms, `delay = 500` and cycle 3 starts at 2100 (`L = 300`). The 300 ms is never made up.
    - A stall of 2000 ms in cycle 1: cycle 2 starts at 2600 (`L = 1400`), `drift = 2600 - 1800 = 800`, `delay = max(0, 600 - 100 - 800) = 0`; cycle 3 at 2700 (`L = 900`), `drift = 300`, `delay = 600 - 100 - 300 = 200`; cycle 4 at 3000 (`L = 600`), `drift = 0`, `delay = 500`; cycle 5 at 3600 (`L = 600`).

    So, by this arithmetic, the formula removes only lateness beyond one tick: while `L <= 600` each interval is 600 ms (or the cycle's own duration if longer), and once `L > 600` the next delay is shortened by `L - 600` (down to 0), bringing `L` back to 600. Small timer lateness therefore accumulates until `L` reaches about 600 ms and then stops accumulating; the long-run average is one tick per `tickRate`. Not observed (open question #44).

20. **A tick that overruns is never skipped or overlapped.** The next `cycle()` is scheduled only at the end of the current one (`Engine-TS/src/engine/World.ts:508`), and `delay` is clamped to 0, so after an overrun the next tick starts as soon as the timer allows, with the next tick number. **Inference:** game time (ticks) falls behind wall time by the overrun, and is pulled back only as described in rule 19; nothing runs two phases at once, since `cycle()` is synchronous (as in [`07-logouts-logins.md`](07-logouts-logins.md)'s between-ticks inference).

21. **Shutdown speed-up.** On the shutdown tick with `duration = 3` (the fourth tick from `shutdownTick`, counting it as the first) `processShutdown` sets `tickRate = 0` (rule 13). In that tick's tail `nextTick += 0` and `delay = max(0, 0 - elapsed - drift) = 0`, and from then on `nextTick` stops advancing, so `drift` only grows and every delay is 0. **Inference:** ticks `shutdownTick` to `shutdownTick + 3` start at the normal pace (three intervals of about 600 ms each, shorter if the schedule is catching up drift, rule 19; about 1.8 s between the starts of the first and the fourth), and from `shutdownTick + 4` the ticks run back to back. Tick-counted shutdown effects then pass in much less wall time than 600 ms per tick: the 1024-tick force-removal (rule 13, `Engine-TS/src/engine/World.ts:1217-1218`) and the autosave/check-in moduli (rules 15-16, `Engine-TS/src/engine/World.ts:425`, `Engine-TS/src/engine/World.ts:430`). The phase-6 tick clocks play no part during shutdown: while `shutdown` is true every player takes phase 6's first branch, which sets `loggingOut` and `force` (`Engine-TS/src/engine/World.ts:744-747`), so the 50-tick no-connection `else if` is never reached, the 100-tick no-response test is short-circuited, and `force` bypasses `preventLogoutUntil` (`Engine-TS/src/engine/World.ts:764`). How fast `setTimeout(..., 0)` fires was not read.

### Exceptions

22. **Error path of `cycle()`.** Any exception that leaves a phase function or the tail goes to `cycle()`'s `catch`: if it is an `Error`, it prints "eep eep cabbage! An unhandled error occurred during the cycle: <message>" and the stack; then "Removing all players...", `removePlayer` for every player in `playerLoop` (which writes `Logout` and closes connected clients, removes the player from rsbuf, its zone, `players` and `playerLoop`, clears collision, builds the save into `logoutRequests` and posts `player_logout` to the friend thread, `Engine-TS/src/engine/World.ts:1602-1629`), "All players removed.", "Closing the server.", and `process.exit(1)`. No `setTimeout` is scheduled, so no further tick runs. Source: `Engine-TS/src/engine/World.ts:509-526`
    ```ts
            } catch (err) {
                if (err instanceof Error) {
                    printError('eep eep cabbage! An unhandled error occurred during the cycle: ' + err.message);
                    console.error(err.stack);
                }
    
                printError('Removing all players...');
    
                for (const player of this.playerLoop.all()) {
                    this.removePlayer(player);
                }
    ```
    The rest of the tick that threw (later phases, phase 11, the tail, the `currentTick` increment) does not run.

23. **Inferences on the error path.** (a) **The saves built by the crash path are not sent.** `removePlayer` only stores the save in `logoutRequests` (rule 14); it reaches the login thread only from phase 6's resend loop (`Engine-TS/src/engine/World.ts:795-804`), and `process.exit(1)` follows immediately (`Engine-TS/src/engine/World.ts:525`). So, by the engine code, the latest saves after a crash are the last autosave (rule 15) or logout saves already posted; whether the login server keeps anything else was not read (open questions #34, #45). (b) **An exception inside the `catch` itself** (from `removePlayer`), in a tick started by `setTimeout`, would leave `cycle()` with no handler in it (the very first `cycle()` is called synchronously from `start()`, `Engine-TS/src/engine/World.ts:334`, so there it would propagate to `start()`'s caller instead); the process has an `uncaughtException` handler that only logs (`Engine-TS/src/app.ts:60-62`), and no next tick would be scheduled. By Node's documented behaviour (not read here) the process would then stay up with the tick loop stopped. Not observed (open question #45).

24. **Which phases catch exceptions, and at what granularity.**

    | Phase | `try`/`catch` | What the `catch` does | Source |
    |---|---|---|---|
    | 1 `processWorld` | per world-queue entry; per delayed-obj entry; **none** around the NPC hunt loop | log only | `Engine-TS/src/engine/World.ts:542-560`, `Engine-TS/src/engine/World.ts:569-574`, `Engine-TS/src/engine/World.ts:577-592` ([`01-world.md`](01-world.md)) |
    | 2 `processClientsIn` | per player | log; if connected, `Logout` + `close()` | `Engine-TS/src/engine/World.ts:607-641` ([`02-clients-in.md`](02-clients-in.md) rule 20) |
    | 3 `processNpcEventQueue` | **none** | - | `Engine-TS/src/engine/World.ts:648-657` ([`03-npc-event-queue.md`](03-npc-event-queue.md) rule 12) |
    | 4 `processNpcs` | per NPC | log; `removeNpc(npc, 0)` | `Engine-TS/src/engine/World.ts:667-674` ([`04-npcs.md`](04-npcs.md)) |
    | 5 `processPlayers` | per player | log; if connected, `Logout` + `close()` | `Engine-TS/src/engine/World.ts:690-734` ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 3) |
    | 6 `processLogouts` | **none** | - | `Engine-TS/src/engine/World.ts:739-807` ([`07-logouts-logins.md`](07-logouts-logins.md)) |
    | 7 `processLogins` | **none** | - | `Engine-TS/src/engine/World.ts:809-959` ([`07-logouts-logins.md`](07-logouts-logins.md)) |
    | 8 `processZones` | one around the whole phase | log; rest of the phase skipped | `Engine-TS/src/engine/World.ts:965-986` ([`08-zones.md`](08-zones.md) rule 26) |
    | 9 `processInfo` | **none** | - | ([`09-info.md`](09-info.md) rule 26) |
    | 10 `processClientsOut` | per player (connected players only) | log; if connected, `Logout` + `close()` | `Engine-TS/src/engine/World.ts:1101-1131` ([`10-clients-out.md`](10-clients-out.md) rules 17-19) |
    | 11 `processCleanup` | **none** | - | `Engine-TS/src/engine/World.ts:1139-1207` |
    | tail (incl. `processShutdown`, `savePlayers`) | **none** of its own | - | `Engine-TS/src/engine/World.ts:417-508`, `Engine-TS/src/engine/World.ts:1209-1247` |

    Every "none" row, the loop heads and the `catch` bodies of the per-entity rows are covered only by `cycle()`'s `catch` (rule 22). Script errors inside the interpreter do not reach any of these: `ScriptRunner.execute` catches them ([`01-world.md`](01-world.md) rule 6). What engine code in phase 11 or the tail could throw was not analysed beyond reading the functions (for example `InvType.get` or `ObjType.get` on a bad id in restock, `Engine-TS/src/engine/World.ts:1171`, `Engine-TS/src/engine/Inventory.ts:108`).

## Comment-versus-code check

- `cycle()` "cleanup - reset zones - reset players - reset npcs - reset invs" (`Engine-TS/src/engine/World.ts:410-414`) and the same four lines above `processCleanup` (`Engine-TS/src/engine/World.ts:1135-1138`): **order matches, incomplete.** Inventories are reset in two places (player inventories inside the player loop, world inventories after the NPCs; inline comments "reset invs (players)" and "reset invs (world)", `Engine-TS/src/engine/World.ts:1151`, `Engine-TS/src/engine/World.ts:1166`). Not mentioned: shop restock (rule 8), `rsbuf.cleanup()` (rule 9) and the `FACE_ENTITY` re-arm (rule 5).
- "Increase or Decrease shop stock" (`Engine-TS/src/engine/World.ts:1170`): **matches.** "Item stock is under min" / "Item stock is over min" (`Engine-TS/src/engine/World.ts:1182`, `Engine-TS/src/engine/World.ts:1188`): **wording imprecise**: `stockcount` is the normal stock level (the count `Inventory.fromType` fills in, `Engine-TS/src/engine/Inventory.ts:34-41`), and stock moves toward it from both sides, so it is a target, not a minimum. "Item stock is not listed, such as general stores. Tested on low and high player count worlds, ever 1 minute stock decreases." (`Engine-TS/src/engine/World.ts:1195-1196`): `INV_STOCKRATE = 100` ticks = 60 s at 600 ms (`Engine-TS/src/engine/World.ts:122`), **matches**; the code also covers listed items with `stockcount` 0.
- `TICKRATE` "ms (0.6s) - DO NOT CHANGE. This is only exposed for condensing time while testing long-running operations." (`Engine-TS/src/engine/World.ts:120`): the constant is not changed anywhere; the variable `tickRate` is, by shutdown and `::speed` (rule 19). **Consistent.**
- `tickRate` "speeds up when we're processing server shutdown" (`Engine-TS/src/engine/World.ts:163`): **matches** (rule 21); it is also changed by `::speed`.
- `nextTick` "the next time the game world should tick." (`Engine-TS/src/engine/World.ts:165`): **matches at the start of a cycle** (it is then the ideal start time of the following cycle, rule 19); after line 504 it is one tick further ahead.
- `PLAYER_SAVERATE` "15m autosave" and "auto-save players every 15 mins" (`Engine-TS/src/engine/World.ts:124`, `Engine-TS/src/engine/World.ts:426`): 1500 x 600 ms = 900 s, **matches** at the normal tick rate (not during the shutdown speed-up).
- `PLAYER_COORDLOGRATE` "30s server check-in" (`Engine-TS/src/engine/World.ts:125`): 50 x 600 ms = 30 s, **matches**. The name says "coord log"; the code writes a "Server check in" session-log entry that carries the coordinate (rule 16).
- "todo: move this into PLAYER_COORDLOGRATE if memory usage is sane?" (`Engine-TS/src/engine/World.ts:436`): **accurate as a todo**: the session-log flush runs every tick that has logs, not every 50 ticks.
- "set the main logic stat here, before telemetry." (`Engine-TS/src/engine/World.ts:461`): **matches** (rule 18).
- "push stats to prometheus" (`Engine-TS/src/engine/World.ts:476`): **imprecise**: the code records values in `prom-client` metric objects; they are pulled from `/prometheus` (`Engine-TS/src/web.ts:318-321`), not pushed. Only in production.
- `processShutdown` "force remove all players, they had their chances to finish processing" (`Engine-TS/src/engine/World.ts:1219`): **matches** (1024 ticks after `shutdownTick`).
- `processShutdown` "after 1 second, kick into high gear (need time to flush logout packets first)" (`Engine-TS/src/engine/World.ts:1234`): **mismatch in the number**: `duration > 2` first holds on the fourth shutdown tick, about 1.8 s of normal ticks after the first one started, and the speed-up applies from the tick after (rule 21).
- `cycle()` `catch` "TODO inform Friends server that the world has gone offline" (`Engine-TS/src/engine/World.ts:521`): **accurate**: no world-offline message is sent; only the per-player `player_logout` messages from `removePlayer` go to the friend thread (`Engine-TS/src/engine/World.ts:1625-1628`).
- `PathingEntity.resetPathingEntity` sets `animId`/`animDelay` twice (`Engine-TS/src/engine/entity/PathingEntity.ts:614-617`): harmless duplication, no effect.
- `Npc.resetEntity` "Very awkward function - needs to be reworked" (`Engine-TS/src/engine/entity/Npc.ts:288`): opinion; consistent with the two unrelated branches (rule 6).

## Inferences (labelled)

- **Inference: the ordering "reset after output" is what makes per-tick state mean "this tick".** Masks, movement directions, `tele`/`jump`, zone events and inventory dirty flags are written in phases 1-8 (and 9 for rsbuf), read in phases 9-10, and cleared only in phase 11 (rules 2-9; the single clear site for masks is [`09-info.md`](09-info.md) rule 16). The only per-tick state that phase 11 itself sets for the next tick is the `FACE_ENTITY` mask (rule 5) and restocked shop slots (rule 8). Rests on rules 1-9.
- **Inference: tick N's tail and phase 1 of tick N+1 see different tick numbers but the same world state** apart from what between-tick handlers change (login replies, socket data, signals): nothing else runs between the `setTimeout` and the next `cycle()` (rule 12, rule 20).
- **Inference: shutdown has two different clocks.** The 1024-tick grace (and the autosave/check-in moduli) are counted in ticks (the phase-6 timeouts and `preventLogoutUntil` do not apply during shutdown, rule 21); from `shutdownTick + 4` ticks run back to back (rule 21), so a 1024-tick grace (614 s at 600 ms) can pass in a small fraction of that time. Rests on rules 13 and 21. Not observed.
- Inferences in rules 11, 12, 14, 17, 19, 20, 21 and 23 are labelled where they appear.

## Not checked / open questions

- Actual tick start times and the lateness `L` in a running server, the speed of shutdown ticks at `tickRate` 0, and whether `setTimeout` lateness makes `L` settle near 600 ms (rule 19). Open question #44.
- What is lost at process exit: whether worker-thread messages posted just before `process.exit(0)`/`process.exit(1)` are delivered, that the crash path's saves are never posted, and the `uncaughtException` case if `removePlayer` throws inside the `catch` (rules 17, 23). Open question #45.
- What `Player.save()` contains and what the login thread does with `player_autosave` and logout saves (rules 14-15). Open question #34.
- When the `close` event swaps a closed client to `NullClientSocket` during shutdown, which bounds how many ticks `processShutdown` writes `Logout` to the same socket (rule 13). Open question #29.
- The shop `stockcount`/`stockrate` values in content, and how `Inventory.add` behaves for a non-stacking shop inventory (it fills the first empty slot at or after `index`, `Engine-TS/src/engine/Inventory.ts:113-126`); not traced with real configs. `docs/open-questions.md` #51.
- What the logger thread does with `session_log` and `wealth_event`, and the wealth filtering by `filteredEventTypes`/`groupedEventTypes` (`Engine-TS/src/engine/World.ts:2275-2305`) beyond the lines cited. Worker boundary (see open question #22 for the friend and logger threads).

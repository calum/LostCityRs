# Phase 10: `processClientsOut` (client output)

**Question answered:** In what order are a player's server-to-client packets put on the wire in one tick: which packets phase 10 writes, under which conditions, and in what order (map/camera, player info, NPC info, zones, inventories, run weight, stats, run energy, interfaces), which packets scripts and handlers write immediately in other phases (and so where they sit in the byte stream relative to phase 10), what limits apply, what happens when a socket is closed or the client is not connected, what the per-player `catch` does, and how the bandwidth statistic is counted?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". Client handling of the packets was not read (boundary). The `ws` library behind `@fastify/websocket` and Node's `net.Socket` internals are not in the repository (no `node_modules` installed) and were not read.

Related notes: [`07-logouts-logins.md`](07-logouts-logins.md) (packets written in phase 7 at login and reconnect, the `Logout` written by `removePlayer`, rule 16 for the login tick's phase 10), [`08-zones.md`](08-zones.md) (rules 20-23: `updateMap`'s `rebuildZones` and the zone packets of `updateZones`), [`09-info.md`](09-info.md) (rule 3: `REBUILD_NORMAL` written in phase 9; rules 2, 11-15: the per-observer `PLAYER_INFO`/`NPC_INFO` encoding; rule 27: what can throw in it), [`05-players-queues-timers.md`](05-players-queues-timers.md) (rule 20: engine-queue entries from zone/mapzone triggers), [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (run energy changes in phase 5), [`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md) (`mes`, `sound_synth`, `anim`, `inv_add`, `stat_advance` traced to their packets).

## Position in the tick

`processClientsOut()` is the tenth call in `World.cycle()`, after `processInfo()` (phase 9) and before `processCleanup()` (phase 11). Source: `Engine-TS/src/engine/World.ts:397-415`
```ts
            this.processInfo();

            // client output
            // - map update
            // - player info
            // - npc info
            // - zone updates
            // - inv changes
            // - stat changes
            // - afk zones changes
            // - flush packets
            this.processClientsOut();
```

`World.currentTick` is incremented only after phase 11 (`Engine-TS/src/engine/World.ts:503`), so phase 10 sees the same tick number as phases 1-9.

## L2: ordered sub-steps

Source for the whole phase: `Engine-TS/src/engine/World.ts:1096-1133`.

1. Record a start time and set `cycleStats[BANDWIDTH_OUT] = 0` (L3 rule 20). Source: `Engine-TS/src/engine/World.ts:1097-1099`
2. For each player in `playerLoop.all()` order (the same order as phases 2, 5, 6 and 9; [`02-clients-in.md`](02-clients-in.md) rules 1-2): skip the player if `isClientConnected(player)` is false (L3 rule 16). Source: `Engine-TS/src/engine/World.ts:1101-1104`
3. Otherwise, inside one `try` (L3 rule 17), call in this order (Source: `Engine-TS/src/engine/World.ts:1106-1123`):
   1. `updateMap()`: queued camera packets, `SET_MULTIWAY` on a zone change, zone/mapzone trigger scripts **enqueued** (L3 rule 3).
   2. `updatePlayers()`: one `PLAYER_INFO` (L3 rule 4).
   3. `updateNpcs()`: one `NPC_INFO` (L3 rule 4).
   4. `updateZones()`: zone packets per active zone ([`08-zones.md`](08-zones.md) rules 21-22).
   5. `updateInvs()`: `UPDATE_INV_FULL`/`UPDATE_INV_PARTIAL` per listener, then possibly `UPDATE_RUNWEIGHT` (L3 rules 5-6).
   6. `updateStats()`: `UPDATE_STAT` per changed stat, then possibly `UPDATE_RUNENERGY` (L3 rules 7-8).
   7. `updateAfkZones()`: no packet; updates afk-zone tracking (L3 rule 9).
   8. `encodeOut()`: `IF_CLOSE`, then a modal open, then `IF_OPENOVERLAY`, each only if needed (L3 rule 10). Nothing is flushed (L3 rule 1).
4. `catch`: log, and if the client is still connected, send `Logout` and close the socket (L3 rule 17). Source: `Engine-TS/src/engine/World.ts:1124-1130`
5. Store elapsed ms in `cycleStats[CLIENT_OUT]`. Source: `Engine-TS/src/engine/World.ts:1132`

## L3: ordering rules

### How a packet reaches the socket

1. **Every packet is encoded and handed to the socket at the moment it is written; there is no per-player output queue and no flush.** `Player.write` returns if the client is not connected, else calls `writeInner` (`Engine-TS/src/engine/entity/Player.ts:2239-2245`). `writeInner` resets the client's `out` buffer to position 0, writes the opcode (plus the next ISAAC value if an encryptor is set), reserves 1 or 2 size bytes for variable-length packets, encodes the payload, fills in the size, and calls `client.send` with a view of the bytes, then adds the byte count to the bandwidth stat. Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:191-228`
   ```ts
           const prot = encoder.prot;
           const buf = client.out;

           buf.pos = 0;

           if (client.encryptor) {
               buf.p1(prot.id + client.encryptor.nextInt());
   // ...
           this.client.send(buf.data.subarray(0, buf.pos));
           World.cycleStats[WorldStat.BANDWIDTH_OUT] += buf.pos;
   ```
   - TCP: `send` is `this.socket.write(src)` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:15-17`); the socket has Nagle disabled and a 30 s timeout (`s.setNoDelay(true)`, `s.setTimeout(30000)`, `Engine-TS/src/server/tcp/TcpServer.ts:19-20`).
   - WebSocket: `send` is `this.socket.send(src)` (`Engine-TS/src/server/ws/WSClientSocket.ts:19-21`), and the object passed in by `web.ts` forwards to the `@fastify/websocket` socket's `send` (`Engine-TS/src/web.ts:87-101`). So at the engine level the WebSocket path is the same as TCP: one `send` per packet, at write time (narrows open question #13; the library side was not read).
   - `NullClientSocket.send` does nothing (`Engine-TS/src/server/NullClientSocket.ts:4-6`).
   - A message type with no encoder is dropped silently: `writeInner` logs `No encoder for ...` and returns before touching the buffer or the ISAAC stream (`Engine-TS/src/engine/entity/NetworkPlayer.ts:194-198`). `encodeOut` has its own `isClientConnected` guard (`Engine-TS/src/engine/entity/NetworkPlayer.ts:156-158`), redundant when called from phase 10.
   - The return value of `socket.write`/`send` is not used; the engine has no backpressure check (`Engine-TS/src/server/tcp/TcpClientSocket.ts:15-17`).

   **Consequence:** the bytes a client receives in one tick are in exactly the order the engine called `write`/`writeInner` for that player across all phases, and the ISAAC stream advances once per packet in that same order. `encodeOut` is not a flush: it writes interface packets (rule 10).

2. **`client.out` is one 5000-byte buffer per client, reused for every packet.** `ClientSocket` declares `out = Packet.alloc(1)` (`Engine-TS/src/server/ClientSocket.ts:20`), and `Packet.alloc(1)` returns a 5000-byte packet (a new one, or a cached one, which `release` only caches when its length is 5000) (`Engine-TS/src/io/Packet.ts:98-128`, `Engine-TS/src/io/Packet.ts:148-150`). `writeInner` passes `buf.data.subarray(0, buf.pos)`, a view on that buffer (language semantics), not a copy, and the next `writeInner` overwrites the buffer from position 0. Whether Node's `net.Socket.write` or the `ws` `send` copies the bytes before returning, or keeps a reference when it cannot write at once, was not read (new open question #41).

### What phase 10 writes, in order, for one connected player

3. **`updateMap` (camera, multiway, triggers).** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:238-284`
   - First, each queued camera entry is written as `CAM_MOVETO` (type 0) or `CAM_LOOKAT` (type 1), in queue order, with coordinates relative to the south-west corner of the zone 6 zones south-west of the origin's zone (`zoneOrigin(pos)` is `((pos >> 3) - 6) << 3`, `Engine-TS/src/engine/CoordGrid.ts:18-20`), and unlinked (`Engine-TS/src/engine/entity/NetworkPlayer.ts:240-249`). The queue is filled only by the `cam_lookat` and `cam_moveto` script commands (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:207-219`), so **these two commands are deferred to phase 10**, unlike `cam_shake` and `cam_reset`, which write at once (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:221-224`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:226-228`). **Inference:** a script that runs `cam_moveto` and then `cam_reset` in one tick sends `CAM_RESET` first (immediately) and `CAM_MOVETO` later (phase 10), the reverse of script order. Rests on rules 1 and 3. Client effect not read. The origin used is the one after phase 9's `rebuildNormal` ([`09-info.md`](09-info.md) rule 3), which is what the code comment "update the camera after rebuild." refers to.
   - If the 64x64 map square changed since `lastMapZone`: enqueue the `mapzoneexit` trigger of the old square (only if `lastMapZone !== -1`) and the `mapzone` trigger of the new one, then store it (`Engine-TS/src/engine/entity/NetworkPlayer.ts:252-262`).
   - If the 8x8 zone (with level) changed since `lastZone`: `buildArea.rebuildZones()` ([`08-zones.md`](08-zones.md) rule 20); write `SET_MULTIWAY` if `isMulti(lastZone)` differs from `isMulti(zone)`; enqueue `zoneexit` (only if `lastZone !== -1`) and `zone` triggers; store it (`Engine-TS/src/engine/entity/NetworkPlayer.ts:265-283`). The triggers are put on the **engine queue** (`Engine-TS/src/engine/entity/Player.ts:580-615`), so they run in phase 5 of a later tick ([`05-players-queues-timers.md`](05-players-queues-timers.md) rule 20); nothing runs here.
   - Login tick (`lastZone` is -1, [`07-logouts-logins.md`](07-logouts-logins.md) rule 16): `isMulti(-1)` unpacks -1 to level 3, x 16383, z 16383 (`Engine-TS/src/engine/CoordGrid.ts:129-134`) and looks up that zone's index in the multiway set (`Engine-TS/src/engine/GameMap.ts:102-105`, `Engine-TS/src/engine/zone/ZoneMap.ts:6-8`). So on login `SET_MULTIWAY` is sent exactly when the player's zone is multiway, unless the multiway map lists that corner zone (the map file was not read).

4. **`PLAYER_INFO` then `NPC_INFO`, every tick, unconditionally.** `updatePlayers` and `updateNpcs` each call `this.write(...)` with no condition (`Engine-TS/src/engine/entity/NetworkPlayer.ts:286-292`). If the player has no rsbuf record, rsbuf returns an empty array and an empty-payload packet is still written (`Engine-TS/src/network/rsbuf/index.ts:128-139`, `Engine-TS/src/network/rsbuf/index.ts:250-261`). How the payload is built is in [`09-info.md`](09-info.md) rules 2, 11-15. The rsbuf encoders return a copy (`slice`) of their own 5000-byte buffers (`Engine-TS/src/network/rsbuf/info.ts:48`, `Engine-TS/src/network/rsbuf/info.ts:301`).
   - **Size budget and the `pos` argument.** Both calls pass `this.client.out.pos` as the first argument, evaluated before the new `write` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:287`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:291`). Since `writeInner` restarts at 0 for every packet (rule 1), `client.out.pos` is the total size of the **last packet written to this client**, whenever and in whichever phase that was. The encoders add it to their running byte estimate (`bytes1 + pos` for players, `pos` for NPCs, `Engine-TS/src/network/rsbuf/info.ts:37`, `Engine-TS/src/network/rsbuf/info.ts:290`), and the same `fits` test (estimate at or under 4997, `Engine-TS/src/network/rsbuf/info.ts:264-266`, `Engine-TS/src/network/rsbuf/info.ts:468-470`) decides two things: whether an already-listed entity's update blocks are attached (otherwise movement bits are sent without blocks, [`09-info.md`](09-info.md) rule 12), and whether a new entity is **added** at all. In the add loops a failed `fits` ends the loop with `return`, so no further player or NPC is added to that observer's list this tick. Source: `Engine-TS/src/network/rsbuf/info.ts:109-112`
     ```ts
                 const length = renderer.lowdefinitions(pid) + renderer.highdefinitions(pid);
                 if (!this.fits(bytes + 2, PlayerInfoEncoder.BITS_ADD, length)) {
                     return;
                 }
     ```
     NPCs: `Engine-TS/src/network/rsbuf/info.ts:349-352`. The local player's own movement and blocks are written with no `fits` check (`Engine-TS/src/network/rsbuf/info.ts:51-65`); only other players' blocks and adds are budgeted, and the local player's block size (`bytes1`) is counted into their budget. For `NPC_INFO` the previous packet is always this tick's `PLAYER_INFO`, so the NPC budget (for blocks and for adds) is reduced by the full size of the player-info packet just sent. For `PLAYER_INFO` it is reduced by the size of whatever packet was written last (e.g. a camera packet from step 1, a `REBUILD_NORMAL` from phase 9, a `MESSAGE_GAME` from phase 5, or a packet from an earlier tick). Whether this is intended (as if both info packets shared one 5000-byte frame) cannot be told from the code (Inferences).

5. **`updateInvs`: one packet per listener whose inventory needs it, in `invListeners` order.** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:332-384`
   ```ts
               const needsFullUpdate = listener.firstSeen;
   ```
   - For each listener (array order, which is `push` order; re-listening on a component already used for another inventory removes the old entry and pushes the new one at the end, `Engine-TS/src/engine/entity/Player.ts:1493-1514`):
     - a world (shared) inventory (`source === -1`) is looked up with `World.getInventory`; a player inventory with `World.getPlayerByUid(source)` then `getInventory`; if either is missing the listener is skipped silently;
     - `firstSeen` true: `UPDATE_INV_FULL` and `firstSeen = false`; else if `inv.update`: `UPDATE_INV_PARTIAL` with the dirty slots in ascending order (`Engine-TS/src/engine/Inventory.ts:233-235`); else nothing.
   - `firstSeen` is set true when a listener is created (`inv_transmit`/`invother_transmit`, `Engine-TS/src/engine/script/handlers/InvOps.ts:641-659`, `Engine-TS/src/engine/entity/Player.ts:1513`) and by `refreshInvs` (reconnect, `Engine-TS/src/engine/entity/Player.ts:1442-1450`). So `inv_transmit` is **deferred**: the full inventory goes out in the next phase 10, even if the script ran in phase 7 of the same tick (login, [`07-logouts-logins.md`](07-logouts-logins.md) rule 16). Calling `inv_transmit` again for the same inventory and component does nothing (`Engine-TS/src/engine/entity/Player.ts:1498-1501`), so it does not force a full resend. `inv_stoptransmit` is **immediate**: it removes the listener and writes `UPDATE_INV_STOP_TRANSMIT` at once (`Engine-TS/src/engine/entity/Player.ts:1516-1524`).
   - `inv.update` and the dirty slots are set by every `Inventory` change (`set`, `add`, `remove`, `removeAll` all call `markDirty`, `Engine-TS/src/engine/Inventory.ts:98-227`, `Engine-TS/src/engine/Inventory.ts:242-245`) and cleared only by `resetTracking` (`Engine-TS/src/engine/Inventory.ts:237-240`) in phase 11 (rule 13). So the partial update carries every slot changed since the last phase 11, whichever phase made the change.

6. **`UPDATE_RUNWEIGHT` after all inventory packets, when the weight changed or a player inventory was sent in full.** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:377-394`
   ```ts
           if (runWeightChanged) {
               const current = this.runweight;
               this.calculateRunWeight();
               runWeightChanged = current !== this.runweight;
           }

           if (runWeightChanged || firstSeen) {
               this.write(new UpdateRunWeight(Math.trunc(this.runweight / 1000)));
           }
   ```
   `runWeightChanged` is set only for a **player** inventory listener whose inventory type has `runweight` and which was sent in full or had `inv.update`; `calculateRunWeight` then sums `weight * count` of non-stackable items over **this** player's own `runweight` inventories (`Engine-TS/src/engine/entity/Player.ts:617-646`), and the packet is sent only if the sum changed. `firstSeen` is set by any player-inventory full update, whatever its type (the comment "ensure weight is sent between logins"). A world inventory never triggers it. So `runweight` is only recomputed in phase 10, and only on ticks when such a listened inventory changed; the `weight` command reads the stored value (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1245-1247`).

7. **`UPDATE_STAT` for each stat whose experience or level differs from what was last sent, in stat index order (0-20).** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:317-324`
   ```ts
           for (let i = 0; i < this.stats.length; i++) {
               if (this.stats[i] !== this.lastStats[i] || this.levels[i] !== this.lastLevels[i]) {
                   this.write(new UpdateStat(i, this.stats[i], this.levels[i]));
                   this.lastStats[i] = this.stats[i];
                   this.lastLevels[i] = this.levels[i];
   ```
   It compares end-of-tick values with the last values **sent by this function**, so several changes to one stat in a tick give one packet with the final values, and a change that is undone within the tick gives none. Stat-changing commands (e.g. `stat_add`, `stat_advance`) only change `stats`/`levels` (and may enqueue engine-queue scripts) (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:514-532`; `stat_advance` in [`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md) section 7), so stat packets are **deferred** to phase 10. The first phase 10 after login sends all stats ([`07-logouts-logins.md`](07-logouts-logins.md) rule 16).

8. **`UPDATE_RUNENERGY` last in `updateStats`, whenever the integer part of `runenergy` changed.** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:326-329`
   ```ts
           if (Math.floor(this.runenergy) / 100 !== Math.floor(this.lastRunEnergy) / 100) {
               this.write(new UpdateRunEnergy(this.runenergy));
               this.lastRunEnergy = this.runenergy;
   ```
   Dividing both sides by 100 does not change whether they are equal, so the test is `Math.floor(runenergy) !== Math.floor(lastRunEnergy)`. `runenergy` is on a 0-10000 scale (`Engine-TS/src/engine/entity/Player.ts:293`, `Engine-TS/src/engine/entity/Player.ts:707`) and the packet carries `(energy / 100) | 0`, i.e. whole percent (`Engine-TS/src/network/game/server/codec/UpdateRunEnergyEncoder.ts:10`). Phase 5's `updateEnergy` raises it by at least 8 (or up to the 10000 cap, `Math.min(runenergy + recovered, 10000)`) every tick a non-delayed player below 10000 takes fewer than 2 steps, or by the weight-based loss when running 2 steps (`Engine-TS/src/engine/entity/Player.ts:701-713`; [`06-players-interaction-movement.md`](06-players-interaction-movement.md)). So during recovery or running the packet is sent nearly every tick, even on ticks when the whole-percent value it carries is unchanged (Inferences).

9. **`updateAfkZones` writes no packet.** It increments `lastAfkZone` (capped at 1000); if the player is inside neither of its two stored 21x21 areas, it stores a new area at `(x - 10, z - 10)` (shifting the old one into slot 1, unless the player has just teleported with `INSTANT` + `jump`, in which case the new area goes into both slots) and resets the counter to 0. Source: `Engine-TS/src/engine/entity/Player.ts:2128-2156`. `zonesAfk()` (counter at 1000) is read by phase 2's afk-event roll (`Engine-TS/src/engine/World.ts:611`) and NPC hunts with `checkAfk` (`Engine-TS/src/engine/entity/Npc.ts:1010`). Because it runs only here, the counter counts phase-10 runs of a **connected** player (rule 16).

10. **`encodeOut` writes interface packets, last of all.** Source: `Engine-TS/src/engine/entity/NetworkPlayer.ts:155-189`
    1. `IF_CLOSE` if `refreshModalClose` is set (which `closeModal` sets whenever a modal was open, `Engine-TS/src/engine/entity/Player.ts:768-813`). The surrounding `if` also copies `modalMain/Chat/Side` into `lastModalMain/Chat/Side`, but those copies are not read anywhere else (grep of `Engine-TS/src` for `lastModalMain` finds only its declaration and `encodeOut`), so the only output of this block is that one `IF_CLOSE`.
    2. If `refreshModal`: one of `IF_OPENMAIN_SIDE` (main and side bits set), `IF_OPENMAIN`, `IF_OPENCHAT`, `IF_OPENSIDE`, chosen from the **current** `modalState` in that priority; none if no bit is set; then `refreshModal = false`. `refreshModal` is set by `openMainModal`, `openChatModal`, `openSideModal`, `openMainSideModal` (`Engine-TS/src/engine/entity/Player.ts:2012`, `Engine-TS/src/engine/entity/Player.ts:2048`, `Engine-TS/src/engine/entity/Player.ts:2072`, `Engine-TS/src/engine/entity/Player.ts:2098`), reached from the `if_openmain`, `if_openchat`, `if_openside`, `if_openmain_side` commands (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:655-666`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:720-722`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:733-735`).
    3. `IF_OPENOVERLAY` if `overlay !== lastOverlay`, then `lastOverlay = overlay` (also when the new value is -1). `overlay` is set by `openMainOverlay` from `if_openoverlay` (`Engine-TS/src/engine/entity/Player.ts:2021-2031`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:724-727`).

    So within one tick: a modal close followed by a modal open gives `IF_CLOSE` then the open; an open followed by a close gives only `IF_CLOSE` (the open finds no modal bit). Only the final modal state of the tick is sent. **Not all modal packets are deferred:** `openMainModal`/`openChatModal`/`openSideModal`/`openMainSideModal` write an `IF_CLOSE` **at once** when they displace another modal type (`Engine-TS/src/engine/entity/Player.ts:1995-2008`, `Engine-TS/src/engine/entity/Player.ts:2033-2044`, `Engine-TS/src/engine/entity/Player.ts:2057-2068`, `Engine-TS/src/engine/entity/Player.ts:2087-2092`), and `openTutorial` writes `TUT_OPEN` at once (`Engine-TS/src/engine/entity/Player.ts:2081-2085`).

### Packets written outside phase 10 (immediate writes)

11. **Most script commands that produce a packet write it at once, in the phase where the script runs.** Grep of `Engine-TS/src/engine/script/handlers` for `write(new` finds only `PlayerOps.ts`, with `IfSetText`, `IfSetHide`, `IfSetObject`, `IfSetModel`, `IfSetAnim`, `IfSetColour`, `IfSetPlayerHead`, `IfSetNpcHead`, `IfSetPosition`, `IfSetScrollPos`, `IfSetTabActive`, `TutFlash`, `CamShake`, `CamReset`, `SynthSound`, `SetPlayerOp`, `PCountDialog`, `MinimapToggle`. Others write through `Player` methods that call `write` directly. Examples, each traced:
    - `mes`: `messageGame` -> `write(new MessageGame(...))` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:343-347`, `Engine-TS/src/engine/entity/Player.ts:2289-2291`).
    - `sound_synth`: `write(new SynthSound(...))`, skipped for a low-memory client (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:476-487`); `midi_song`/`midi_jingle` likewise skip low-memory clients and call `playSong`/`playJingle` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:847-867`; `playJingle` writes at once, `Engine-TS/src/engine/entity/Player.ts:1991-1993`).
    - `if_settext`: `write(new IfSetText(com, text))` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:782`).
    - `if_settab`: `setTab` -> `write(new IfSetTab(...))` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:712-718`, `Engine-TS/src/engine/entity/Player.ts:2119-2122`).
    - varp writes (`%var = ...`): `POP_VARP` -> `setVar` -> `writeVarp` (`VARP_SMALL` for -128..127, else `VARP_LARGE`) only if the varp type has `transmit` (`Engine-TS/src/engine/script/handlers/CoreOps.ts:41-59`, `Engine-TS/src/engine/entity/Player.ts:1765-1780`, `Engine-TS/src/engine/entity/Player.ts:1811-1817`). Varbits go through `setVarBit` -> `setVar` (`Engine-TS/src/engine/entity/Player.ts:1794-1809`). `p_run` also calls `setVar` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1269-1274`), and so does phase 5's `updateEnergy` when energy hits 0 (`Engine-TS/src/engine/entity/Player.ts:715-719`).
    - Engine-side immediate writes covered in other notes: `REBUILD_NORMAL` in phase 9 (and phase 7) ([`09-info.md`](09-info.md) rule 3), the login and reconnect packets in phase 7 ([`07-logouts-logins.md`](07-logouts-logins.md) rules 15, 18), the anti-logout message in phase 6 and `Logout` on removal ([`07-logouts-logins.md`](07-logouts-logins.md) rules 5, 8), the script-error messages (`wrappedMessageGame`, then `logout()` in production; `Engine-TS/src/engine/script/ScriptRunner.ts:188-206`).

12. **Deferred to phase 10** (state changed when the command runs, packet written in phase 10 of the same tick if the client is connected): masks such as `anim`, `say`, `spotanim`, damage, appearance (in `PLAYER_INFO`/`NPC_INFO`, [`09-info.md`](09-info.md) rules 16-17); `cam_moveto`/`cam_lookat` (rule 3); zone changes (`loc_*`, `obj_*`, map anims; [`08-zones.md`](08-zones.md) rules 13, 21); `inv_transmit` and all inventory contents (rule 5); stats (rule 7); run energy (rule 8); run weight (rule 6); modal opens, modal closes via `if_close` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:246-248` -> `closeModal`) and overlays (rule 10).

13. **Where each kind lands in the byte stream of one tick T.** Phases 1-7 run scripts and handlers, so their immediate writes reach the socket during those phases, in the order they ran; phase 8 writes no packet (it calls only `Loc.turn`/`Obj.turn` and `computeShared`, [`08-zones.md`](08-zones.md) rule 6; zone packets are written in phase 10, rule 23 there); phase 9 adds `REBUILD_NORMAL`; phase 10 adds that player's block (rules 3-10) in the fixed order of L2 step 3; phase 11 writes nothing (`Engine-TS/src/engine/World.ts:1139-1207`; it calls `resetEntity`, `resetTracking`, shop restock and `rsbuf.cleanup`). So, for one client, within tick T: **all immediate packets from phases 1-9 come before any of its phase-10 packets.** Two consequences:
    - A script that runs `if_openmain(x)` and then `if_settext(...)` on a component of `x` sends the text first (phase 5, say) and the `IF_OPENMAIN` last (phase 10 `encodeOut`). Likewise an interface's inventories (`inv_transmit`) arrive before the `IF_OPEN*` that shows them, since `updateInvs` runs before `encodeOut`.
    - A message (`mes`) or sound written in tick T precedes the `PLAYER_INFO` carrying an `anim` set in the same script ([`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md) section 2 Inference).

    Shop restock in phase 11 runs **after** `resetTracking` for world inventories in the same loop iteration and sets `inv.update` again (`Engine-TS/src/engine/World.ts:1166-1201`), so restock changes are sent as partial updates in phase 10 of **T+1**.

### Limits

14. **No per-tick output limit; per-packet limits only.** Nothing in phase 10 counts or caps bytes or packets per player or per tick (`Engine-TS/src/engine/World.ts:1096-1133`). The limits read:
    - `PLAYER_INFO`/`NPC_INFO` keep their estimate at or under 4997 bytes (rule 4): over budget, an already-listed entity's blocks are left out, and new entities are added only while the list holds fewer than 250 players / 255 NPCs **and** the add fits; the first add that does not fit stops adding for that tick (rule 4; [`09-info.md`](09-info.md) rules 12-13). Movement bits and removals of listed entities, and the local player's own block, are always written.
    - Each packet is encoded into the 5000-byte `client.out` (rule 2). Writes use `DataView.setUint8`/`setUint16`/`setInt32` and `Uint8Array.set` (`Engine-TS/src/io/Packet.ts:303-326`, `Engine-TS/src/io/Packet.ts:351-354`), which throw a `RangeError` past the end of the buffer (language semantics), so a packet larger than 5000 bytes throws inside `writeInner`.
    - Variable-byte packets (`length -1`, e.g. `MESSAGE_GAME`, `Engine-TS/src/network/game/server/ServerGameProt.ts:45`) store their size with `psize1`, i.e. `setUint8` (`Engine-TS/src/io/Packet.ts:364-366`), which stores the value modulo 256 without error (language semantics). So a payload over 255 bytes would get a wrong size byte without any exception. Whether any content message or other `-1` packet can exceed 255 bytes was not checked (new open question #43).

### Disconnected clients and closed sockets

15. **What "connected" means.** `isClientConnected(player)` is true for a `NetworkPlayer` whose `client` is not a `NullClientSocket` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:398-400`). The swap to `NullClientSocket` happens only in the TCP and WebSocket `close` handlers (`Engine-TS/src/server/tcp/TcpServer.ts:43-51`, `Engine-TS/src/web.ts:122-130`; [`07-logouts-logins.md`](07-logouts-logins.md) rule 4). `client.state` is **not** checked by `isClientConnected`, `Player.write` or `writeInner`.

16. **A disconnected player gets no phase-10 processing at all**, not just no packets: `updateMap` (so no zone/mapzone triggers enqueued and `lastZone`/`lastMapZone` frozen), `updatePlayers`/`updateNpcs` (so its rsbuf lists and the NPC observer counts it contributes are frozen, [`09-info.md`](09-info.md) Inferences), `updateZones`, `updateInvs` (listeners keep `firstSeen`, inventory changes are discarded by phase 11's `resetTracking`), `updateStats` (`lastStats` stays at the last sent values), `updateAfkZones` and `encodeOut` are all skipped (`Engine-TS/src/engine/World.ts:1101-1104`). `cameraPackets` is not drained either; it is cleared only by `cleanup` on removal (`Engine-TS/src/engine/entity/Player.ts:459`). **Inference:** `cam_moveto`/`cam_lookat` queued while disconnected are sent on the first phase 10 after a reconnect, in queue order. Rests on rule 3 and this rule. Not observed. Packets written in other phases to such a player are dropped by `Player.write` (`Engine-TS/src/engine/entity/Player.ts:2239-2242`).

17. **After `client.close()` but before the `close` event, writes still go to the socket.** `TcpClientSocket.close` only sets `state = -1` and calls `socket.end()`; `WSClientSocket.close` sets `state = -1` and calls the socket's `close()` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:19-22`, `Engine-TS/src/server/ws/WSClientSocket.ts:23-26`). Until Node emits `close` and the handler swaps in a `NullClientSocket`, `isClientConnected` stays true, so phase 10 keeps calling `write` and `send` on that socket every tick. What Node and `ws` do with a write after `end()`/`close()` (error event, silent drop) was not read; the TCP `error` handler would call `s.destroy()` (`Engine-TS/src/server/tcp/TcpServer.ts:53-59`) and the WebSocket one `socket.terminate()` (`Engine-TS/src/web.ts:132-134`). Separately, any data the client still sends after `close()` makes the TCP `data` handler call `client.terminate()` (`socket.destroy()`), because `state === -1` (`Engine-TS/src/server/tcp/TcpServer.ts:24-28`, `Engine-TS/src/server/tcp/TcpClientSocket.ts:24-27`); the WebSocket `message` handler does the same (`Engine-TS/src/web.ts:103-108`). (Narrows open question #29; the timing of the `close` event is still not checked.)

### The per-player `catch`

18. **An exception in any of the eight calls ends that player's phase-10 output for this tick, sends `Logout` and closes the socket; other players continue.** Source: `Engine-TS/src/engine/World.ts:1124-1130`
    ```ts
            } catch (err) {
                console.error(err);
                if (isClientConnected(player)) {
                    player.logout();
                    player.client.close();
                }
            }
    ```
    - `NetworkPlayer.logout` is `writeInner(new Logout())`, written at once (`Engine-TS/src/engine/entity/NetworkPlayer.ts:230-232`), so the `Logout` follows whatever this player's phase 10 had already written.
    - The steps after the throwing call are skipped for this tick, and the tracking fields of the skipped steps are left as they were (e.g. if `updateZones` throws: `firstSeen`, `lastStats`, `lastRunEnergy`, `refreshModal`, `refreshModalClose`, `lastOverlay`). Fields set by steps that completed before the throw keep their new values (e.g. `lastZone`/`lastMapZone` from `updateMap`, `NetworkPlayer.ts` lines cited in rule 3); if `updateMap` itself threw, only the fields it had already set are updated.
    - The `catch` does **not** set `loggingOut`, does not remove the player, and does not stop later phases or ticks from processing it. The player stays in `playerLoop`; removal follows the disconnect timeouts of phase 6 once the `close` event has swapped in a `NullClientSocket` ([`07-logouts-logins.md`](07-logouts-logins.md) rules 3-4; open question #29).
    - What can throw here: a missing rsbuf block cache ([`09-info.md`](09-info.md) rule 27), zone encoding ([`08-zones.md`](08-zones.md) rule 21), a packet over 5000 bytes (rule 14), `InvType.get`/`Component.get` on a bad id, or a socket `write` that throws synchronously (not checked).

19. **Unguarded code in phase 10.** The `for` head, `isClientConnected`, and the `catch` body itself are outside the `try`. If `player.logout()` or `client.close()` threw inside the `catch`, the exception would leave `processClientsOut` and reach `cycle()`'s `catch`, which removes every player and exits the process (`Engine-TS/src/engine/World.ts:509-526`). Nothing read shows that they can throw; `Logout` has an empty payload (`Engine-TS/src/network/game/server/ServerGameProt.ts:61`).

### Bandwidth statistic

20. **`BANDWIDTH_OUT` counts only bytes written from phase 10 to the end of the tick.** Every `writeInner` adds its size (rule 1), but phase 10 sets the counter to 0 first (`Engine-TS/src/engine/World.ts:1099`), so bytes written by `writeInner` in phases 1-9 (immediate script writes, `REBUILD_NORMAL`, login packets) are added and then discarded. The value is copied into `lastCycleStats` and, in production, added to the Prometheus counter after phase 11 and the cycle tail (`Engine-TS/src/engine/World.ts:474`, `Engine-TS/src/engine/World.ts:492`); in between, the shutdown removal in the tail can add `Logout` bytes (`Engine-TS/src/engine/World.ts:421-423`). Raw `client.send` calls that bypass `writeInner` (login response bytes, rejections, `Engine-TS/src/engine/World.ts:817`, `Engine-TS/src/engine/World.ts:839`, `Engine-TS/src/engine/World.ts:902`) are never counted. `writeInner` also counts bytes "sent" to a `NullClientSocket` when called directly (the production script-error `logout()`, `Engine-TS/src/engine/script/ScriptRunner.ts:203-206`).

21. **The counters are 16-bit.** `cycleStats` and `lastCycleStats` are `Uint16Array(12)` (`Engine-TS/src/engine/World.ts:160-161`), so `BANDWIDTH_OUT` (and `BANDWIDTH_IN`, reset in phase 2, `Engine-TS/src/engine/World.ts:604`) wrap modulo 65536 (typed-array semantics). One full `PLAYER_INFO` can approach 5000 bytes (rule 4); 65536 / 5000 is about 13.1, so with about a dozen or more players each receiving near-full info packets the per-tick figure wraps (Inferences).

### Reconnect and first tick

22. **First tick after login:** see [`07-logouts-logins.md`](07-logouts-logins.md) rule 16: enter triggers enqueued, every active zone sent in full, every transmitted inventory sent in full (`firstSeen`) with `UPDATE_RUNWEIGHT`, all stats and run energy sent. On that tick `refreshModal` is false unless the login script opened a modal, and `overlay`/`lastOverlay` both start at -1 (`Engine-TS/src/engine/entity/Player.ts:359-362`), so no interface open is sent unless a script set one.

23. **Reconnect tick:** `onReconnect` (phase 7) writes all stats and run energy at once but does not update `lastStats`, `lastLevels` or `lastRunEnergy` (`Engine-TS/src/engine/entity/Player.ts:568-571`); it calls `closeModal()` (`Engine-TS/src/engine/entity/Player.ts:562`), which sets `refreshModalClose` only if a modal was open (rule 10), and `refreshInvs()`. In the same tick's phase 10 the new client therefore gets: full inventories and `UPDATE_RUNWEIGHT` (rules 5-6); again an `UPDATE_STAT` for every stat that changed since the last phase 10 that ran while the old client was connected, and `UPDATE_RUNENERGY` if the integer energy changed since then (rules 7-8, 16); `IF_CLOSE` if a modal was open. `lastOverlay` is not reset, so an open overlay is **not** re-sent to the new client. Likewise `lastZone`/`lastMapZone` are not reset by a reconnect (their only assignments are `Engine-TS/src/engine/entity/NetworkPlayer.ts:261` and `Engine-TS/src/engine/entity/NetworkPlayer.ts:282`; initial values -1 at `Engine-TS/src/engine/entity/Player.ts:385-386`), so `SET_MULTIWAY` is not re-sent to the new client either: it is written only when the zone differs from `lastZone` (rule 3), i.e. only if the player's zone changed since the last phase 10 that ran while a client was connected (in which case the zone/mapzone triggers are enqueued too). Client effect of either not read (new open question #42).

## Comment-versus-code check

- `cycle()` and function header "client output - map update - player info - npc info - zone updates - inv changes - stat changes - afk zones changes - flush packets" (`Engine-TS/src/engine/World.ts:399-407`, `Engine-TS/src/engine/World.ts:1088-1095`), and the same labels inside the loop (`Engine-TS/src/engine/World.ts:1107-1122`):
  - **order matches the calls** (rule L2).
  - "map update": **partly**. `updateMap` does not send the map (`REBUILD_NORMAL` is sent in phase 9 or 7, [`09-info.md`](09-info.md) rule 3); it sends deferred camera packets and `SET_MULTIWAY`, rebuilds the active-zone set and enqueues zone/mapzone triggers (rule 3).
  - "inv changes": also sends `UPDATE_RUNWEIGHT` (rule 6). "stat changes": also sends `UPDATE_RUNENERGY` (rule 8).
  - "afk zones changes": **matches** as state, but no packet is sent (rule 9).
  - "flush packets": **mismatch**. `encodeOut` flushes nothing; packets were already handed to the socket when written (rule 1). It writes the deferred `IF_CLOSE`, modal-open and overlay packets (rule 10).
  - Not mentioned: the bandwidth counter reset (rule 20), the skip of disconnected players (rule 16), and the per-player `catch` (rule 18).
- "reset bandwidth counter" (`Engine-TS/src/engine/World.ts:1099`): **matches the line**, but placing it here makes the counter ignore bytes written in phases 1-9 (rule 20).
- "update the camera after rebuild." (`Engine-TS/src/engine/entity/NetworkPlayer.ts:239`): **matches**: phase 9's `rebuildNormal` has already run, and the camera coordinates use the updated origin (rule 3).
- "map zone changed" / "map zone triggers" / "zone changed" / "zone triggers" (`Engine-TS/src/engine/entity/NetworkPlayer.ts:251`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:254`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:264`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:269`): match; "zone triggers" also covers the `SET_MULTIWAY` write.
- "unload any zones that are no longer active" / "update active zones" (`Engine-TS/src/engine/entity/NetworkPlayer.ts:298`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:305`): match ([`08-zones.md`](08-zones.md) rule 21).
- "ensure weight is sent between logins" (`Engine-TS/src/engine/entity/NetworkPlayer.ts:371`): **matches, broader**: any full update of a player inventory forces `UPDATE_RUNWEIGHT`, including `inv_transmit` of a non-weight inventory mid-session and reconnect (rule 6).
- `Player.lastStats`/`lastLevels` "we track this so we know to flush stats only once a tick on changes" (`Engine-TS/src/engine/entity/Player.ts:320-321`): **matches** (rule 7), except on reconnect, where `onReconnect` sends stats without updating them and phase 10 may send changed stats again (rule 23).
- `Player.ts` `onReconnect` "rebuild scene later this tick" (`Engine-TS/src/engine/entity/Player.ts:555`): already found to be a mismatch in [`07-logouts-logins.md`](07-logouts-logins.md) (written at once in phase 7); still so.
- `ClientSocket` "node won't let us read from the socket as a stream so we buffer it ourselves" (`Engine-TS/src/server/ClientSocket.ts:19`): about input; there is no matching output buffer (rule 1).

## Inferences (labelled)

- **Inference: interface text and inventory contents arrive before the interface is opened, whatever the script order.** `if_settext` and other `IF_SET*` packets are immediate (rule 11), `inv_transmit` contents come from `updateInvs` and the `IF_OPEN*` from `encodeOut`, which runs after it (rules 5, 10). Rests on rules 1, 5, 10, 11, 13. Client handling not read.
- **Inference: the `PLAYER_INFO`/`NPC_INFO` size budget is smaller than 4997 by an amount that depends on unrelated earlier packets.** For `NPC_INFO`, by the whole size of this tick's `PLAYER_INFO` (so in a crowded area the NPC info can drop update blocks, and stop adding new NPCs for that tick, where a full 4997-byte budget would have allowed them); for `PLAYER_INFO`, by the size of the last packet written to the client, which may be from an earlier phase or tick, with the same two effects on other players' blocks and adds. The local player's own block is never budgeted out (rule 4). Rests on rules 1 and 4 (`Engine-TS/src/engine/entity/NetworkPlayer.ts:287`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:291`). Whether this is intended is not answerable from the code. Not observed.
- **Inference: `UPDATE_RUNENERGY` is sent on most ticks while a player's energy is recovering or draining**, with an unchanged percent value on most of them (recovery of at least 8 per tick on a 0-10000 scale changes the percent about every 12 ticks or fewer). Rests on rule 8. Not observed.
- **Inference: the per-tick bandwidth figure is low by the bytes written in phases 1-9 and wraps at 65536.** Rests on rules 20-21. Not observed.
- **Inference: a phase-10 exception is followed by further writes to the same socket in later ticks** until the `close` event arrives, because the `catch` neither swaps the client nor marks it. Rests on rules 17-18. When `close` arrives was not checked (#29).
- **Observed in passing (not phase 10, labelled as a reading only):** when `openChatModal` displaces a main or side modal it sets `modalChat = -1` in both branches instead of clearing `modalMain`/`modalSide`; when `openSideModal` displaces a main modal it sets `modalChat = -1` instead of `modalMain`, and when it displaces a chat modal it sets `modalSide = -1` instead of `modalChat` (`Engine-TS/src/engine/entity/Player.ts:2034-2043`, `Engine-TS/src/engine/entity/Player.ts:2058-2067`). By the code read, the displaced interface id stays in `modalMain`/`modalSide`/`modalChat` while its `modalState` bit is cleared. A later `closeModal` (which only checks that `modalState` is not `NONE`, then tests each id against -1) would run that stale interface's `IF_CLOSE` script and clear its listeners (`Engine-TS/src/engine/entity/Player.ts:768-800`). `encodeOut` is not affected (it chooses the open packet from `modalState`, rule 10). Not traced further.

## Not checked / open questions

- Whether Node's `net.Socket.write` and the `ws` `send` copy the `client.out` view or keep a reference when the data cannot be written at once, and so whether the reuse of `client.out` can corrupt queued output under backpressure; how the engine behaves when a client reads slowly (no backpressure check). `docs/open-questions.md` #41.
- What Node/`ws` do with writes after `end()`/`close()`, and when the `close` event fires. `docs/open-questions.md` #29 (narrowed here) and #13 (WebSocket library side).
- Client effects of the reconnect-tick duplicates and of the overlay not being re-sent. `docs/open-questions.md` #42.
- Whether any `-1` length packet (e.g. a long `mes`) can exceed 255 payload bytes, or any packet 5000 bytes. `docs/open-questions.md` #43.
- The multiway map file (whether it lists the zone that `isMulti(-1)` looks up) was not read (rule 3). `docs/open-questions.md` #51.
- How the client decodes and applies any of these packets (#6, #14).
- `writeFullFollows`/zone packet details are in [`08-zones.md`](08-zones.md); `PLAYER_INFO`/`NPC_INFO` encoding in [`09-info.md`](09-info.md); they were not re-derived here.
- Nothing was run; no order or timing here was observed.

# Phase 9: `processInfo` (player and NPC info)

**Question answered:** What does the ninth phase of a game tick do, in what order: which player and NPC fields (position, `walkDir`/`runDir`, `tele`/`jump`, masks, appearance) it reads, whether it works once per entity or once per observer, what it leaves to phase 10, which earlier phases wrote the masks it consumes (and whether any writer runs after it), where the NPC "observer" counts used by phases 1 and 4 are updated, and what happens to players who log in or out?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76` (branch `calum-research`; only the `[login,_]` script and the `update_all`/`update_bas` procs were read, for rule 23)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed". Client decoding of `PLAYER_INFO`/`NPC_INFO` was not read (boundary).

Related notes: [`04-npcs.md`](04-npcs.md) and [`04b-npc-modes.md`](04b-npc-modes.md) (NPC movement, facing and masks set in phase 4), [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (player facing, movement, `walkDir`/`runDir`, `stepsTaken`, `jump`, `EXACT_MOVE`), [`07-logouts-logins.md`](07-logouts-logins.md) (phases 6-7: `rsbuf.removePlayer`, `rsbuf.addPlayer`, reconnect), [`08-zones.md`](08-zones.md) (phase 10's `updateMap`/`updateZones`, which use the origin set here), [`01-world.md`](01-world.md) (the observer gate on player hunts), [`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md) (the `anim` command traced to the `ANIM` block in `PLAYER_INFO`).

## Position in the tick

`processInfo()` is the ninth call in `World.cycle()`, after `processZones()` (phase 8) and before `processClientsOut()` (phase 10). Source: `Engine-TS/src/engine/World.ts:390-397`
```ts
            this.processZones();

            // process player & npc update info
            // - convert player movements
            // - compute player info
            // - convert npc movements
            // - compute npc info
            this.processInfo();
```

`World.currentTick` is incremented only after phase 11 (`Engine-TS/src/engine/World.ts:503`), so phase 9 sees the same `currentTick` as phases 1-8 of the tick.

Like phase 3 (`processNpcEventQueue`, `Engine-TS/src/engine/World.ts:648-657`; see [`03-npc-event-queue.md`](03-npc-event-queue.md)), and unlike the other phases, `processInfo` records no `cycleStats` entry: there is no `WorldStat` for it (`Engine-TS/src/engine/WorldStat.ts:1-14`), and the `cycleStats[...] = Date.now() - start` writes are only for `CYCLE`, `WORLD`, `CLIENT_IN`, `NPC`, `PLAYER`, `LOGOUT`, `LOGIN`, `ZONE`, `CLIENT_OUT` and `CLEANUP` (`Engine-TS/src/engine/World.ts:461`, `Engine-TS/src/engine/World.ts:594`, `Engine-TS/src/engine/World.ts:644`, `Engine-TS/src/engine/World.ts:675`, `Engine-TS/src/engine/World.ts:736`, `Engine-TS/src/engine/World.ts:806`, `Engine-TS/src/engine/World.ts:958`, `Engine-TS/src/engine/World.ts:987`, `Engine-TS/src/engine/World.ts:1132`, `Engine-TS/src/engine/World.ts:1206`). So its time is only part of `WorldStat.CYCLE`.

## L2: ordered sub-steps

Source for the whole phase: `Engine-TS/src/engine/World.ts:994-1086`.

1. **Return at once if no player is logged in** (`getTotalPlayers() === 0`). NPCs are then not computed either. Source: `Engine-TS/src/engine/World.ts:995-997`. `getTotalPlayers` counts defined entries of `players[1..2046]` (`Engine-TS/src/engine/World.ts:1719-1726`).
2. **Players**, in `playerLoop` order (`for (const player of this.playerLoop.all())`, `Engine-TS/src/engine/World.ts:1000`; the order is described in [`02-clients-in.md`](02-clients-in.md) rules 1-2). For each player:
   1. `player.buildArea.rebuildNormal()`: may move the map origin and write `REBUILD_NORMAL` (L3 rule 3). Source: `Engine-TS/src/engine/World.ts:1002`
   2. Choose the appearance bytes: regenerate them if the `APPEARANCE` mask is set, else reuse `appearanceBuf`, or generate if there is none (L3 rule 9). Source: `Engine-TS/src/engine/World.ts:1004`
   3. `rsbuf.computePlayer(...)` with 43 arguments (L3 rules 1, 4-6). Source: `Engine-TS/src/engine/World.ts:1006-1050`
3. **NPCs**, in `World.npcs` order (`for (const npc of this.npcs)`): `rsbuf.computeNpc(...)` with 28 arguments. Source: `Engine-TS/src/engine/World.ts:1053-1085`. `World.npcs` is an `NpcList` (`Engine-TS/src/engine/World.ts:150`) whose iterator walks its `ids` array by index, i.e. in ascending `nid` order, skipping free ids (`Engine-TS/src/engine/entity/EntityList.ts:36-47`).
4. There is no `try`/`catch` in the phase (L3 rule 26).

The phase does not encode any packet bytes for movement and does not touch any observer's view of the world; that is phase 10 (L3 rule 2).

## L3: ordering rules

### What phase 9 does and what it leaves to phase 10

1. **`computePlayer` and `computeNpc` copy the entity's fields into an rsbuf record, update rsbuf's own zone map, and pre-encode the entity's update blocks.** For a player (`Engine-TS/src/network/rsbuf/index.ts:23-126`):
   - returns at once if `pid === -1` or there is no rsbuf record for that slot (`Engine-TS/src/network/rsbuf/index.ts:68-75`);
   - builds packed coordinates for the position and the origin, an `ExactMove` object if `exactStartX !== -1`, a `Chat` object if a chat message exists (`Engine-TS/src/network/rsbuf/index.ts:77-80`);
   - if the position changed **and** the 8x8 zone or the level changed, moves the pid from the old rsbuf zone to the new one (`Engine-TS/src/network/rsbuf/index.ts:82-85`);
   - copies every field into the record (`Engine-TS/src/network/rsbuf/index.ts:87-116`), calls `PLAYER_RENDERER.computeInfo(player)` (`Engine-TS/src/network/rsbuf/index.ts:118`), and appends the pid to `PLAYER_GRID` under its exact tile (`Engine-TS/src/network/rsbuf/index.ts:120-125`).

   `computeNpc` does the same for an NPC (returning at once if `nid === -1`, `ntype === -1`, or no record), without the grid and without origin, appearance or chat (`Engine-TS/src/network/rsbuf/index.ts:176-248`). rsbuf's zone map (`ZONE_MAP`, a map from zone index to sets of player and NPC ids, `Engine-TS/src/network/rsbuf/grid.ts:1-45`) is separate from the engine's `Zone` objects; ids are moved in or out of it only here and by `removePlayer`/`removeNpc` (`Engine-TS/src/network/rsbuf/index.ts:155`, `Engine-TS/src/network/rsbuf/index.ts:277`); a lookup of a zone not yet present creates an empty entry (`Engine-TS/src/network/rsbuf/grid.ts:36-44`).

2. **Phase 9 is once per entity; phase 10 is once per observer.** The per-observer work is `rsbuf.playerInfo` and `rsbuf.npcInfo`, called from `updatePlayers`/`updateNpcs` in phase 10 for each connected player (`Engine-TS/src/engine/entity/NetworkPlayer.ts:286-292`, `Engine-TS/src/engine/World.ts:1101-1112`). They walk that observer's own lists (`build.players`, `build.npcs`), write the movement bits for each listed entity, remove entities that are no longer visible, add nearby new ones, and copy in the block bytes that phase 9 cached (`Engine-TS/src/network/rsbuf/info.ts:21-49`, `Engine-TS/src/network/rsbuf/info.ts:278-302`). So the comment's "compute player info"/"compute npc info" means pre-encoding per-entity blocks here; the actual `PLAYER_INFO` (opcode 167) and `NPC_INFO` (opcode 197) payloads are built in phase 10 (`Engine-TS/src/network/game/server/ServerGameProt.ts:40-41`).

3. **`rebuildNormal` runs before `computePlayer`, so the origin passed in is already updated.** `BuildArea.rebuildNormal` checks whether the player is outside the reload window around the current origin; if so it writes a `RebuildNormal` packet, sets `originX/Z` to the player's position and clears `loadedZones`. Source: `Engine-TS/src/engine/entity/BuildArea.ts:57-93`
   ```ts
           if (this.player.x < reloadLeftX || this.player.z < reloadBottomZ || this.player.x > reloadRightX - 1 || this.player.z > reloadTopZ - 1 || reconnect) {
   // ...
               this.player.write(new RebuildNormal(zoneX, zoneZ, this.mapsquares));

               this.player.originX = this.player.x;
               this.player.originZ = this.player.z;
               this.loadedZones.clear();
   ```
   `Player.write` returns without writing when the client is not connected, else encodes the packet into the socket at once (`Engine-TS/src/engine/entity/Player.ts:2239-2245`; [`08-zones.md`](08-zones.md) rule 23). So a `REBUILD_NORMAL` is sent during phase 9, before any phase-10 packet of any player that tick; a disconnected player still gets its origin moved. The origin copied into rsbuf is used in phase 10 for the local player's teleport coordinates and for `EXACT_MOVE` (`Engine-TS/src/network/rsbuf/info.ts:54`, `Engine-TS/src/network/rsbuf/info.ts:254-258`); the engine's own `originX/Z` is what phase 10's `rebuildZones` uses ([`08-zones.md`](08-zones.md) rule 20).

4. **Every observer in phase 10 sees the same phase-9 snapshot.** All players and then all NPCs are computed before `processClientsOut` starts (phase order, `Engine-TS/src/engine/World.ts:397-408`), and in phase 10 the rsbuf position, mask and value fields, the zone map and `PLAYER_GRID` are only read; phase 10 writes the observer's own lists, view distance and appearance memory, the NPC observer counts (rules 19-20) and the lazily cached add blocks of rule 14, which are built from phase-9 values. So what an observer is told does not depend on its position in `playerLoop` relative to the observed entity.

### Which entity fields are read

5. **Fields passed by `processInfo`** (`Engine-TS/src/engine/World.ts:1006-1050`, `Engine-TS/src/engine/World.ts:1055-1084`), and where rsbuf uses them:

   | Engine field(s) | Player | NPC | rsbuf use |
   |---|---|---|---|
   | `x`, `level`, `z` | yes | yes | record `coord`; rsbuf zone move (rule 1); visibility and distance checks in phase 10 |
   | `originX`, `originZ` | yes | no | record `origin` (rule 3) |
   | `slot` / `nid`, `type` | `slot` | `nid`, `type` | record index; NPC `ntype` (add bits, `CHANGE_TYPE` block) |
   | `tele`, `jump`, `runDir`, `walkDir` | yes | yes | movement bits in phase 10 (rules 10-13) |
   | `visibility` | yes | no | `HARD` hides the player from others in phase 10 (`Engine-TS/src/network/rsbuf/info.ts:73`, `Engine-TS/src/network/rsbuf/info.ts:105`) |
   | `isActive` | yes | yes | record `active`; an inactive entity is removed from observers' lists in phase 10 (`Engine-TS/src/network/rsbuf/info.ts:73`, `Engine-TS/src/network/rsbuf/info.ts:310`) |
   | `masks` | yes | yes | which blocks are encoded (rule 6) |
   | appearance bytes, `lastAppearance` | yes | no | `APPEARANCE` block; per-observer "already seen" check (rules 9, 14) |
   | `faceEntity`, `faceSquareX/Z`, `faceAngleX/Z` | yes | yes | `FACE_ENTITY`/`FACE_COORD` blocks; `faceAngle` only for an add (rule 14) |
   | `hitmarkDamage/Type`, `hitmark2Damage/Type`, `levels[HITPOINTS]`, `baseLevels[HITPOINTS]` | yes | yes | `DAMAGE`/`DAMAGE2` blocks |
   | `animId`, `animDelay` | yes | yes | `ANIM` block |
   | `sayMessage` | yes | yes | `SAY` block |
   | `chatMessage`, `chatColour`, `chatEffect`, `chatRights` | yes | no | `CHAT` block (`chatRights` is passed into the parameter named `ignored`, `Engine-TS/src/network/rsbuf/index.ts:56`) |
   | `spotanimId/Height/Time` | yes | yes | `SPOT_ANIM` block |
   | `exactStartX/Z`, `exactEndX/Z`, `exactMoveStart/End`, `exactMoveFacing` | yes | no | `EXACT_MOVE` block, encoded per observer (rule 8) |

   `chatColour`, `chatEffect` and `chatRights` default to -1, -1 and 0 when null (`Engine-TS/src/engine/World.ts:1037-1039`). Engine masks use the same bit values as the wire masks: `Player` and `Npc` import `PlayerInfoProt`/`NpcInfoProt` from rsbuf (`Engine-TS/src/engine/entity/Player.ts:1`, `Engine-TS/src/engine/entity/Npc.ts:1`; values in `Engine-TS/src/network/rsbuf/prot.ts:1-50`).

### Pre-encoding the blocks (once per entity)

6. **`computeInfo` encodes one block per set mask, from the values copied in rule 1.** It returns at once if the masks are 0. For a player, `APPEARANCE`, `ANIM`, `FACE_ENTITY`, `SAY` (only if `say !== null`), `DAMAGE`, `DAMAGE2`, `FACE_COORD`, `CHAT` (only if `chat !== null`) and `SPOT_ANIM` are encoded into per-mask caches; `EXACT_MOVE` only adds 9 to the size estimate. Source: `Engine-TS/src/network/rsbuf/renderer.ts:37-94`
   ```ts
           if (pid === -1 || masks === 0) {
               return;
           }
   // ...
           if ((masks & PlayerInfoProt.ANIM) !== 0) {
               highs += this.cache(pid, new PlayerInfoAnim(player.animId, player.animDelay), PlayerInfoProt.ANIM);
           }
   ```
   NPCs: `ANIM`, `FACE_ENTITY`, `SAY` (if not null), `DAMAGE`, `DAMAGE2`, `CHANGE_TYPE`, `SPOT_ANIM`, `FACE_COORD` (`Engine-TS/src/network/rsbuf/renderer.ts:155-203`). Each block's byte layout is its message class's `encode` (`Engine-TS/src/network/rsbuf/messages.ts:9-329`; e.g. `ANIM` is `p2(anim)`, `p1(delay)`, `Engine-TS/src/network/rsbuf/messages.ts:68-71`, as in [`../flows/server-response-woodcutting.md`](../flows/server-response-woodcutting.md)). The renderer also stores a size estimate per entity (`highs`, `lows`) that phase 10 uses to decide whether a block still fits in the packet (`Engine-TS/src/network/rsbuf/renderer.ts:85-93`, `Engine-TS/src/network/rsbuf/info.ts:264-266`).

7. **Cache lifetime.** `cache()` encodes only if the slot is empty or the message "persists"; only `PlayerInfoAppearance` persists (`Engine-TS/src/network/rsbuf/renderer.ts:100-106`, `Engine-TS/src/network/rsbuf/messages.ts:21-23`; every other message's `persists()` returns false). Phase 11 calls `rsbuf.cleanup()` as its last step (`Engine-TS/src/engine/World.ts:1204`), which clears `PLAYER_GRID`, every non-appearance block cache and the `highs` estimates, and resets each record's per-tick fields (`Engine-TS/src/network/rsbuf/index.ts:297-308`, `Engine-TS/src/network/rsbuf/renderer.ts:128-133`, `Engine-TS/src/network/rsbuf/renderer.ts:233-238`, `Engine-TS/src/network/rsbuf/player.ts:61-83`, `Engine-TS/src/network/rsbuf/npc.ts:35-55`). So at the start of phase 9 the temporary caches are empty, and each entity's blocks are encoded once, from the values at phase 9. The appearance block cache is kept across ticks until `removePermanent` (player removal, `Engine-TS/src/network/rsbuf/renderer.ts:135-139`). The `lows` estimate is not cleared per tick (only by `removePermanent`). The record fields not reset by `cleanup` (position, origin, `visibility`, `active`, `faceEntity`, `orientationX/Z`, appearance, `lastAppearance`, NPC `observers`) are overwritten by the next compute.

8. **`EXACT_MOVE` is not pre-encoded.** Phase 10 writes it per observer, converting the start and end tiles to coordinates relative to the **observer's** origin, and only if the record has an `exactMove`. Source: `Engine-TS/src/network/rsbuf/info.ts:254-258`
   ```ts
           if ((masks & PlayerInfoProt.EXACT_MOVE) !== 0 && other.exactMove !== null) {
               const x = ((player.origin.x() >> 3) - 6) << 3;
               const z = ((player.origin.z() >> 3) - 6) << 3;
   ```

9. **Appearance bytes are regenerated only when the `APPEARANCE` mask is set, or when none exist yet.** `World.ts:1004` calls `generateAppearance()` if `masks & APPEARANCE`, else uses `appearanceBuf`, falling back to `generateAppearance()` when it is null. `generateAppearance` builds the bytes from gender, head icons, the worn inventory (or NPC id when transformed), colours, base animations, name, combat and skill level, and sets `lastAppearance = World.currentTick` and `appearanceBuf`. Source: `Engine-TS/src/engine/entity/Player.ts:1355-1438`. Grep finds no other caller of `generateAppearance` than `Engine-TS/src/engine/World.ts:1004`, so `lastAppearance` is the tick of the last phase 9 that regenerated the bytes. The bytes are cached by the renderer only when the mask is set (rule 6).

### Movement directions (engine half of open question #14)

10. **`walkDir` and `runDir` are direction codes 0-7, or -1 for no step.** They are set by `processMovement` from `validateAndAdvanceStep`, which returns `CoordGrid.face(src, dst)` when the entity actually moved and -1 otherwise (`Engine-TS/src/engine/entity/PathingEntity.ts:135-152`, `Engine-TS/src/engine/entity/PathingEntity.ts:241-251`). Codes: `NORTH_WEST` 0, `NORTH` 1, `NORTH_EAST` 2, `WEST` 3, `EAST` 4, `SOUTH_WEST` 5, `SOUTH` 6, `SOUTH_EAST` 7 (`Engine-TS/src/engine/CoordGrid.ts:1-10`, `Engine-TS/src/engine/CoordGrid.ts:24-50`). Phase 9 only copies them; which phase sets them, and the one-step/two-step rules, are in [`06-players-interaction-movement.md`](06-players-interaction-movement.md) (players, phase 5) and [`04b-npc-modes.md`](04b-npc-modes.md) (NPCs, phase 4). They are reset to -1 in phase 11 (`Engine-TS/src/engine/entity/PathingEntity.ts:595-596`).

11. **Local player (phase 10): teleport beats run beats walk beats extend.** Source: `Engine-TS/src/network/rsbuf/info.ts:51-65`
    ```ts
            if (player.tele) {
                this.teleport(renderer, player, player, player.coord.x() - (((player.origin.x() >> 3) - 6) << 3), player.coord.y(), player.coord.z() - (((player.origin.z() >> 3) - 6) << 3), player.jump, length > 0);
            } else if (player.runDir !== -1) {
                this.run(renderer, player, player, length > 0);
            } else if (player.walkDir !== -1) {
                this.walk(renderer, player, player, length > 0);
            } else if (length > 0) {
    ```
    Bit layouts written (`Engine-TS/src/network/rsbuf/info.ts:135-183`): teleport `1, 3 (2 bits), level (2), x (7), z (7), jump (1), has-blocks (1)`; run `1, 2 (2 bits), walkDir (3), runDir (3), has-blocks (1)`; walk `1, 1 (2 bits), walkDir (3), has-blocks (1)`; blocks only `1, 0 (2 bits)`; nothing `0 (1 bit)`. The teleport x/z are relative to 6 zones south-west of the origin's zone. So the local player's own `jump` is sent only inside the teleport case.

12. **Other players and NPCs already in the observer's list (phase 10).** Each listed id is first checked; it is **removed** (`1, 3 (2 bits)`) if the record is gone, `tele` is set, the level differs, it is more than `viewDistance` (players) or 15 (NPCs) tiles away on either axis, it is inactive, or (players) its visibility is `HARD`. Otherwise run, walk, blocks-only or idle are written as for the local player, with no teleport case. Sources: `Engine-TS/src/network/rsbuf/info.ts:304-332` (NPCs), `Engine-TS/src/network/rsbuf/info.ts:67-92` (players)
    ```ts
                if (!other || other.pid === -1 || other.tele || other.coord.y() !== player.coord.y() || !CoordGrid.withinDistanceSw(player.coord, other.coord, player.build.viewDistance) || !other.active || other.visibility === Visibility.HARD) {
                    this.remove(player, pid);
                    continue;
                }
    ```
    Blocks are attached only if the size estimate still fits under 4997 bytes (`fits`); otherwise the movement bits are sent with "no blocks", and those blocks are not sent to that observer this tick (`Engine-TS/src/network/rsbuf/info.ts:78-88`, `Engine-TS/src/network/rsbuf/info.ts:264-266`).

13. **New entities are added after the list pass, with the `jump` bit.** For each nearby id not in the list (players: same level, within `viewDistance`, not self, not `HARD`, with no check of `active`; NPCs: same level, within 15, active), while the list holds fewer than 250 players / 255 NPCs and the add fits, the encoder writes the id, the offset from the observer (5 bits each), `jump`, and `1`, then the low-definition blocks (rule 14), and inserts the id. Sources: `Engine-TS/src/network/rsbuf/info.ts:94-127`, `Engine-TS/src/network/rsbuf/info.ts:334-369`, `Engine-TS/src/network/rsbuf/build.ts:244-260`, `Engine-TS/src/network/rsbuf/build.ts:55-57`. NPC adds also carry `ntype` (11 bits). Because `tele` makes rule 12 remove the entity and the add pass then finds it absent from the list, **a teleported entity (including a successful `EXACT_MOVE`, login, reconnect and NPC spawn/respawn, which all set `tele`) is removed and, if still in range, re-added in the same packet**, with its `jump` bit. Whether it is re-added that tick depends on the 250/255 caps and the size budget.

14. **Low-definition (add) blocks.** An add writes the entity's masks for this tick plus extra blocks. `FACE_COORD` is always included: this tick's block if one was cached, else built from `faceX/Z` (`faceSquare`) if set, else `orientationX/Z` (`faceAngle`), else the entity's own tile. `FACE_ENTITY` is included if its mask is set this tick or `faceEntity !== -1`. For players, this tick's `APPEARANCE` bit is replaced by a per-observer check: `APPEARANCE` is included only if `lastAppearance !== -1` and the observer has not stored that `lastAppearance` value for this pid; it then stores it. (The engine's `lastAppearance` starts at 0 and is otherwise only set to `currentTick` or reset to 0, `Engine-TS/src/engine/entity/Player.ts:400`, `Engine-TS/src/engine/entity/Player.ts:464`, so after a compute the `-1` case does not occur. Edge case: an observer's appearance memory starts at 0 and `BuildArea.cleanup` resets it to 0, `Engine-TS/src/network/rsbuf/build.ts:61`, `Engine-TS/src/network/rsbuf/build.ts:66-70`; `World.currentTick` starts at 0, `Engine-TS/src/engine/World.ts:164`; so by this reading an appearance generated on tick 0 counts as already seen and is not sent on an add. Inference, not observed.) Missing `FACE_ENTITY`/`FACE_COORD` blocks are cached on first need, so they are encoded at most once per entity per tick. Sources: `Engine-TS/src/network/rsbuf/info.ts:416-437` (NPCs), `Engine-TS/src/network/rsbuf/build.ts:119-125`, `Engine-TS/src/network/rsbuf/info.ts:193-221` (players)
    ```ts
            if (other.lastAppearance !== -1 && !player.build.hasAppearance(pid, other.lastAppearance >>> 0)) {
                player.build.saveAppearance(pid, other.lastAppearance >>> 0);
                masks |= PlayerInfoProt.APPEARANCE;
            } else {
                masks &= ~PlayerInfoProt.APPEARANCE;
            }
    ```
    The stored appearance values survive `remove` (which only edits the id list, `Engine-TS/src/network/rsbuf/info.ts:129-133`), so re-adding a player whose appearance has not changed does not resend it.

15. **The local player never gets its own `CHAT` block**; every other set mask is sent to itself. Source: `Engine-TS/src/network/rsbuf/info.ts:185-191`. Block order in the payload: players `APPEARANCE, ANIM, FACE_ENTITY, SAY, DAMAGE, FACE_COORD, CHAT, SPOT_ANIM, EXACT_MOVE, DAMAGE2`, with a 2-byte little-endian mask header (plus `0x80`) when the mask exceeds `0xff` (`Engine-TS/src/network/rsbuf/info.ts:223-262`); NPCs `DAMAGE2, ANIM, FACE_ENTITY, SAY, DAMAGE, CHANGE_TYPE, SPOT_ANIM, FACE_COORD` with a 1-byte header (`Engine-TS/src/network/rsbuf/info.ts:439-466`).

### Masks: who wrote them, and when

16. **Phase 9 reads the masks and values as they stand at the end of phase 8; the last write in the tick wins.** Masks are cleared in only one place, `resetPathingEntity` (`masks = 0`, `Engine-TS/src/engine/entity/PathingEntity.ts:606`), which phase 11 calls for every player in `playerLoop` and every NPC in `World.npcs` (`Engine-TS/src/engine/World.ts:1148-1149`, `Engine-TS/src/engine/World.ts:1161-1164`, `Engine-TS/src/engine/entity/Player.ts:470-474`, `Engine-TS/src/engine/entity/Npc.ts:326-328`). `Npc.resetEntity(true)` (spawn/respawn) does not clear masks (`Engine-TS/src/engine/entity/Npc.ts:289-329`). So any mask set in phases 1-8 of tick T (or left by T-1's phase 11, rule 17) is sent in tick T, with the field values current at phase 9: e.g. a second `say` in the same tick replaces the first (`Engine-TS/src/engine/entity/Player.ts:1978-1981`); `playAnimation` does nothing if `anim >= SeqType.count` or the player's `animProtect` is set; otherwise it replaces the current animation if the new `anim` is -1, or the current `animId` is -1, or the new sequence's priority is at least the current one's (`Engine-TS/src/engine/entity/Player.ts:1920-1930`; the NPC version has no `animProtect` check, `Engine-TS/src/engine/entity/Npc.ts:470-480`); and the `DAMAGE` block carries `levels[HITPOINTS]` as read in phase 9, not at the time of the hit (`Engine-TS/src/engine/World.ts:1031-1032`).

17. **Mask writers** (each sets a bit on `masks` and the fields its block reads):

    | Mask | Writer | Reached from (phase) |
    |---|---|---|
    | `FACE_ENTITY` (player and NPC) | `setFaceEntity`, only when `faceEntity` changes (`Engine-TS/src/engine/entity/PathingEntity.ts:514-532`) | phase 5 player turn (`Engine-TS/src/engine/World.ts:713`), phase 4 NPC turn (`Engine-TS/src/engine/entity/Npc.ts:189`), **phase 11** end of `resetPathingEntity` (`Engine-TS/src/engine/entity/PathingEntity.ts:630`); reconnect sets it directly (`Engine-TS/src/engine/entity/Player.ts:573`, phase 7) |
    | `FACE_COORD` | `focus(x, z, true)` (`Engine-TS/src/engine/entity/PathingEntity.ts:341-353`) | `reorient` after movement (`Engine-TS/src/engine/entity/PathingEntity.ts:383-392`; phases 4 and 5), `faceSquare` from the `FACESQUARE` / `NPC_FACESQUARE` handlers (`Engine-TS/src/engine/entity/Player.ts:1983-1985`, `Engine-TS/src/engine/entity/Npc.ts:519-521`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:243`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:106`) |
    | `ANIM` | `Player.playAnimation` (`Engine-TS/src/engine/entity/Player.ts:1920-1930`), `Npc.playAnimation` (`Engine-TS/src/engine/entity/Npc.ts:470-480`) | `anim`/`npc_anim` commands (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:196-201`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:74`), so any phase that runs scripts; NPC spawn/respawn (`Engine-TS/src/engine/World.ts:1293`, `Engine-TS/src/engine/entity/Npc.ts:294`) |
    | `EXACT_MOVE` | `Player.exactMove`, which also teleports (sets `tele`) (`Engine-TS/src/engine/entity/Player.ts:2107-2117`) | `p_exactmove` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:939-947`) |
    | `APPEARANCE` | `buildAppearance` (`Engine-TS/src/engine/entity/Player.ts:1915-1918`) | `buildappearance` command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:203-205`), combat-level change in `addXp`/`setLevel` (`Engine-TS/src/engine/entity/Player.ts:1889-1892`, `Engine-TS/src/engine/entity/Player.ts:1909-1912`), the design-screen handler in phase 2 (`Engine-TS/src/network/game/client/handler/IdkSaveDesignHandler.ts:55`); reconnect sets it directly (`Engine-TS/src/engine/entity/Player.ts:574`, phase 7) |
    | `CHAT` | `MessagePublicHandler` (`Engine-TS/src/network/game/client/handler/MessagePublicHandler.ts:29-40`) | phase 2 ([`02-clients-in.md`](02-clients-in.md)) |
    | `SAY` | `Player.say` / `Npc.say` (`Engine-TS/src/engine/entity/Player.ts:1978-1981`, `Engine-TS/src/engine/entity/Npc.ts:510-517`) | `say`/`npc_say` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:472-474`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:186`) |
    | `DAMAGE`/`DAMAGE2` | `applyDamage`, alternating by `hitmarkSlot` (`Engine-TS/src/engine/entity/Player.ts:1939-1958`, `Engine-TS/src/engine/entity/Npc.ts:489-508`) | `DAMAGE` / `NPC_DAMAGE` handlers (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:818-830`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:278-283`) |
    | `SPOT_ANIM` | `spotanim` (`Engine-TS/src/engine/entity/Player.ts:1932-1937`, `Engine-TS/src/engine/entity/Npc.ts:482-487`) | `SPOTANIM_PL` / `SPOTANIM_NPC` handlers (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:602-608`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:296-303`) |
    | `CHANGE_TYPE` (NPC) | `changeType`, `revertType` (`Engine-TS/src/engine/entity/Npc.ts:443-448`, `Engine-TS/src/engine/entity/Npc.ts:1159-1167`) | `NPC_CHANGETYPE` / `NPC_CHANGETYPE_KEEPALL` handlers (`Engine-TS/src/engine/script/handlers/NpcOps.ts:477`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:485`); revert in phase 4 `Npc.turn` (`Engine-TS/src/engine/entity/Npc.ts:121-131`) |

    (Grep of `Engine-TS/src` for `masks |=` outside rsbuf finds only the sites in this table, including `Engine-TS/src/engine/entity/PathingEntity.ts:351`, `Engine-TS/src/engine/entity/PathingEntity.ts:530` and the per-class setters.) Scripts run in phases 1 (world queue), 2, 3, 4, 5, 6 (logout trigger, on a player removed right after) and 7 (login trigger), per notes 01-07.

18. **No mask writer runs in phase 9 or phase 10; the only one after phase 9 is phase 11's `setFaceEntity`.** Phase 9 calls only `rebuildNormal`, `generateAppearance`, `computePlayer` and `computeNpc` (rule 1, L2). Phase 10 calls `updateMap`, `updatePlayers`, `updateNpcs`, `updateZones`, `updateInvs`, `updateStats`, `updateAfkZones`, `encodeOut` (`Engine-TS/src/engine/World.ts:1106-1123`); of those, `updateMap` only **enqueues** zone/mapzone trigger scripts (`Engine-TS/src/engine/entity/NetworkPlayer.ts:238-284`, `Engine-TS/src/engine/entity/Player.ts:580-615`) and the others only write packets and tracking fields (`Engine-TS/src/engine/entity/NetworkPlayer.ts:155-189`, `Engine-TS/src/engine/entity/NetworkPlayer.ts:294-395`, `Engine-TS/src/engine/entity/Player.ts:2128-2141`); of these, `updateAfkZones` writes no packet, only the tracking fields `afkZones` and `lastAfkZone` (`Engine-TS/src/engine/entity/Player.ts:2128-2141`), and `updateInvs` also recomputes `runweight` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:386-390`). Phase 11 (`Engine-TS/src/engine/World.ts:1139-1206`) runs no script and calls no zone-event writer: it calls `zone.reset()` on tracked zones (which only clears `shared`, `events` and `entityEvents`, `Engine-TS/src/engine/zone/Zone.ts:221-225`), `resetEntity(false)` on players and NPCs, inventory `resetTracking` and shop restock, and `rsbuf.cleanup()`. Phase 9 and the phase-10 functions above also call none of the zone-event `World` methods listed in [`08-zones.md`](08-zones.md) rule 13. Phase 11's `resetPathingEntity` clears the masks and then calls `setFaceEntity()`, which sets the `FACE_ENTITY` mask again if `faceEntity` differs from the current target (`Engine-TS/src/engine/entity/PathingEntity.ts:606`, `Engine-TS/src/engine/entity/PathingEntity.ts:630`). That mask survives to the next tick's phase 9 (rule 16). This confirms the engine side of the "one tick late" `FACE_ENTITY` inference in [`06-players-interaction-movement.md`](06-players-interaction-movement.md).

### NPC observer counts (used by phases 1 and 4)

19. **Where the count changes.** `observers` is a field of the rsbuf NPC record, starting at 0 (`Engine-TS/src/network/rsbuf/npc.ts:28`). Every write:
    - **+1** when an NPC is added to an observer's list in phase 10 (`Engine-TS/src/network/rsbuf/info.ts:354-355`);
    - **-1** (not below 0) when it is removed from an observer's list in phase 10 because it failed the rule-12 checks and its record still exists (`Engine-TS/src/network/rsbuf/info.ts:310-315`);
    - **-1** (not below 0) for each NPC in a player's list when `rsbuf.removePlayer` runs (`Engine-TS/src/network/rsbuf/index.ts:154-161`), i.e. from `World.removePlayer` (`Engine-TS/src/engine/World.ts:1612`), which is called in phase 6 (`Engine-TS/src/engine/World.ts:790`), by the shutdown force-removal after phase 11, which runs only on shutdown ticks with `currentTick - shutdownTick >= 1024` (`Engine-TS/src/engine/World.ts:1217-1225`) and by `cycle()`'s `catch` (`Engine-TS/src/engine/World.ts:517-519`);
    - **reset to 0** by `rsbuf.addNpc`, which replaces the record (`Engine-TS/src/network/rsbuf/index.ts:263-268`), called only by `World.addNpc` with `firstSpawn` true (`Engine-TS/src/engine/World.ts:1269-1273`);
    - **record deleted** by `rsbuf.removeNpc` (`Engine-TS/src/network/rsbuf/index.ts:270-281`), called only for a `DESPAWN` NPC (`Engine-TS/src/engine/World.ts:1327-1330`); `getNpcObservers` then returns 0 (`Engine-TS/src/network/rsbuf/index.ts:290-295`).

    Phase 9 does not change it: `computeNpc` does not touch `observers` (`Engine-TS/src/network/rsbuf/index.ts:176-248`), and `Npc.cleanup` in phase 11 does not reset it (`Engine-TS/src/network/rsbuf/npc.ts:35-55`).

20. **Two paths clear an observer's NPC list without decrementing.** In phase 10, `npcInfo` calls `build.rebuildNpcs()` when `rebuild` is true or the observer moved more than 15 tiles on an axis since the last phase 11 (`Engine-TS/src/network/rsbuf/info.ts:280-282`); `rebuild` is `lastLevel !== level` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:290-292`). `rebuildNpcs` is just `npcs.clear()` (`Engine-TS/src/network/rsbuf/build.ts:95-97`). On reconnect in phase 7, `rsbuf.cleanupPlayerBuildArea` calls `build.cleanup()`, which clears both lists and the stored appearances, also without decrementing (`Engine-TS/src/engine/World.ts:842`, `Engine-TS/src/network/rsbuf/index.ts:310-315`, `Engine-TS/src/network/rsbuf/build.ts:66-70`). The NPCs that were in the list are then added again (+1) if still nearby. So the count is **not** always the number of lists that contain the NPC (Inferences).

21. **Readers.** `getNpcObservers` is called only in phase 1's player-hunt gate (`Engine-TS/src/engine/World.ts:583`) and phase 4's hunt gate (`Engine-TS/src/engine/entity/Npc.ts:161`) (grep for `rsbuf.` in `Engine-TS/src`). Phase 10 changes the counts progressively, player by player in `playerLoop` order, and only for connected players (`Engine-TS/src/engine/World.ts:1101-1104`), but nothing reads them during phase 10. So the count read in phase 1 or phase 4 of tick T is the value after phase 10 of T-1, changed only by: a shutdown force-removal after T-1's phase 11 (only when `currentTick - shutdownTick >= 1024`, `Engine-TS/src/engine/World.ts:1217-1218`; -1 per list entry), and a first spawn (record reset to 0) or a `DESPAWN` removal (record gone) earlier in tick T: for phase 4, in phases 1-4; for phase 1, by a world-queue script (`npc_add`/`npc_del`), since the world-queue loop (`Engine-TS/src/engine/World.ts:535-561`) runs before the hunt loop (`Engine-TS/src/engine/World.ts:577-591`). In phase 1 this has no practical effect: a new NPC reads 0 and a removed one fails the `isActive` gate. This is how the "left by the previous tick's phase 10" statement in [`01-world.md`](01-world.md) rule 17 holds; rule 20 limits what the count means.

22. **A respawned NPC keeps its rsbuf record and count (narrows open question #20(a)).** `World.removeNpc` on a `RESPAWN` NPC does not call `rsbuf.removeNpc` and does not remove it from `World.npcs` (`Engine-TS/src/engine/World.ts:1327-1333`), so phase 9 keeps computing it with `active = false` and each connected observer that lists it removes it in phase 10 with -1 (rule 12); `filterNpc` does not add inactive NPCs (`Engine-TS/src/network/rsbuf/build.ts:253-260`). The respawn, `World.addNpc(this, -1, false)` in phase 4 (`Engine-TS/src/engine/entity/Npc.ts:121-127`), skips `rsbuf.addNpc` (`Engine-TS/src/engine/World.ts:1269-1273`), so in its first tick back the NPC has whatever count is left: 0 if every observer that had it in its list ran phase 10 since the removal, more if a disconnected player (no phase 10) still lists it or rule 20 inflated it. That tick's phase 9 computes it with `tele` true (`Engine-TS/src/engine/entity/Npc.ts:325`) and observers in range add it in phase 10 (+1), so from the next tick's phase 1 it can player-hunt if seen. (In the respawn tick's own phase 1 it was inactive, which fails the `isActive` gate, [`01-world.md`](01-world.md) rule 16.)

### Login, logout and reconnect

23. **Login (phase 7) is in this tick's phase 9.** Phase 7 creates a fresh rsbuf record (`rsbuf.addPlayer`, `Engine-TS/src/network/rsbuf/index.ts:141-146`), puts the player in `players`, sets `tele = true` and runs `onLogin` (which calls `rebuildNormal` and the `[login,_]` script) (`Engine-TS/src/engine/World.ts:936-944`, `Engine-TS/src/engine/entity/Player.ts:488-533`). The player was added to `playerLoop` earlier in the same login step (`Engine-TS/src/engine/World.ts:910-934`; except for an address with neither `.` nor `:`, [`02-clients-in.md`](02-clients-in.md) rule 2), so phase 9 of the login tick computes it: the record moves from coordinate (0,0,0) into its real rsbuf zone (rule 1), and with `tele` set the local player gets the teleport block in phase 10 (rule 11). Other players near it can add it in the same tick's phase 10, whatever their `playerLoop` position (rule 4). The `[login,_]` script calls `~update_all` (`Content/scripts/login_logout/login.rs2:79`), which calls `~update_bas` (`Content/scripts/player/scripts/appearance.rs2:98-113`), which ends in `buildappearance(worn)` on both of its branches (`Content/scripts/player/scripts/appearance.rs2:1-3`, `Content/scripts/player/scripts/appearance.rs2:24`), so when the script gets there the `APPEARANCE` mask is set for the login tick's phase 9. Also on the login tick `lastLevel` is still its initial -1 (`Engine-TS/src/engine/entity/PathingEntity.ts:45`; only phase 11 sets it, `Engine-TS/src/engine/entity/PathingEntity.ts:601`), so the new player's own phase-10 info is built with `rebuild` true.

24. **Logout (phase 6) happens before phase 9.** `World.removePlayer` calls `rsbuf.removePlayer` (remove from rsbuf's zone, -1 for each NPC in its list, clear its lists, drop its appearance cache, null the record), removes the slot from `players` and unlinks it from `playerLoop` (`Engine-TS/src/engine/World.ts:1602-1615`, `Engine-TS/src/network/rsbuf/index.ts:148-167`). Phase 9 therefore skips it, and each observer's phase-10 list pass finds no record and removes it (rule 12). If a phase-7 login in the same tick reuses the slot (see [`07-logouts-logins.md`](07-logouts-logins.md) Inferences), the observers find a new record with `tele` set, so they remove the old pid and may re-add it as the new player (rules 12-13); the new player's `lastAppearance` is this tick (rule 9), which differs from the departed player's last regeneration tick (an earlier phase 9), so its appearance is sent if its appearance block was cached (rule 14). (Engine side of open question #35.)

25. **Reconnect (phase 7)** clears the reconnecting player's rsbuf lists (rule 20) and sets `FACE_ENTITY`, `APPEARANCE`, `tele` and `jump` (`Engine-TS/src/engine/entity/Player.ts:573-577`), so phase 9 re-encodes its appearance and observers remove and re-add it (rules 12-13).

### Exceptions

26. **`processInfo` has no `try`/`catch`.** An exception anywhere in it (e.g. in `generateAppearance`, `rebuildNormal`'s `write`, or the rsbuf encoders) leaves `processInfo` and reaches `cycle()`'s `catch`, which logs it, calls `removePlayer` for every player in `playerLoop`, and calls `process.exit(1)`. Source: `Engine-TS/src/engine/World.ts:509-526`. Phases 10 and 11 do not run for that tick. This differs from phases 2, 5 and 10 (per-player `catch`) and phase 8 (phase-wide `catch`, [`08-zones.md`](08-zones.md) rule 26). What can actually throw here was not analysed beyond the next point.

27. **A missing block cache throws in phase 10, not here.** `PlayerRenderer.write` / `NpcRenderer.write` throw `Tried to write a buf not cached!` if asked for a block that phase 9 did not cache (`Engine-TS/src/network/rsbuf/renderer.ts:108-114`, `Engine-TS/src/network/rsbuf/renderer.ts:213-219`). `writeBlocks` writes `SAY` and `CHAT` whenever the mask bit is set, while `computeInfo` caches them only when the value is not null (rule 6), and an add writes `APPEARANCE` from a cache that is filled only on ticks when the `APPEARANCE` mask was set (rules 6, 14). Such an error is thrown inside the observer's `updatePlayers`/`updateNpcs` and is caught by phase 10's per-player `catch`, which sends `Logout` to that observer and closes its client (`Engine-TS/src/engine/World.ts:1124-1129`). Whether any path sets these masks with a null value, or lets a player be added before its `APPEARANCE` mask was ever set, was not checked (Inferences, open question #40).

## Comment-versus-code check

- `cycle()` comment "process player & npc update info - convert player movements - compute player info - convert npc movements - compute npc info" (`Engine-TS/src/engine/World.ts:392-396`) and the same four lines above `processInfo` (`Engine-TS/src/engine/World.ts:990-993`): **order matches, steps are merged**. All players are done before all NPCs. There is no separate "convert movements" step: per entity, one call (`computePlayer`/`computeNpc`) both copies the movement fields into rsbuf (and moves the entity between rsbuf zones) and pre-encodes the update blocks (rule 1). The movement bits themselves are not produced here but per observer in phase 10 (rules 2, 11-13). Not mentioned by the comments: the early return when no player is online, the `rebuildNormal` call (which can send `REBUILD_NORMAL` now, rule 3), and appearance regeneration (rule 9).
- "facing (reorientEntity/reorient) runs in the player's turn (processPlayers), not here." (`Engine-TS/src/engine/World.ts:1001`) and "facing (reorientEntity/reorient) runs in Npc.turn(), not here." (`Engine-TS/src/engine/World.ts:1054`): **match**; phase 9 calls no facing method. Phase 11's `setFaceEntity` does run after phase 9 (rule 18), which these comments do not claim otherwise.
- "set origin before compute player is why this is above." (`Engine-TS/src/engine/World.ts:1002`): **matches** (rule 3).
- "TODO: benchmark this?" (`Engine-TS/src/engine/World.ts:999`): consistent with the missing `cycleStats` entry (Position section).
- `processClientsOut` comment "- player info - npc info" (`Engine-TS/src/engine/World.ts:401-402`): consistent with rule 2; that is where the per-observer encoding happens.
- `Player.onReconnect` "resync appearance (todo: is it possible to do this for the local observer only?)" (`Engine-TS/src/engine/entity/Player.ts:574`): consistent: the mask is per player, not per observer. Because reconnect also sets `tele`, observers do not get the block in their list pass but remove and re-add the player (rules 12-13); on the re-add the block is sent because phase 9 regenerated the appearance and so `lastAppearance` is a value they have not stored (rules 9, 14). The local player gets it inside its teleport block (rule 11).

## Inferences (labelled)

- **Inference: NPC observer counts can drift from the number of lists that contain the NPC.** Upward: whenever a connected player changes level, moves more than 15 tiles on an axis within one tick (teleport), or reconnects, while NPCs are in its list. Each NPC that was in the cleared list loses that membership without the -1, so it keeps one extra count; if it is re-added it gets a new +1, which is decremented normally later (rules 19-20). Nothing removes the extra count while the NPC keeps its rsbuf record (a `RESPAWN` NPC keeps it across death, rule 22). Effects, by the gates read: phase 1's player-hunt gate and phase 4's `PAUSEHUNT` gate pass for such an NPC even when no player has it in view. [`01-world.md`](01-world.md)'s inference "an NPC whose observer count is 0 never player-hunts" already notes that the count can drift; for an NPC with a drifted count the gate passes with no player viewing it, though a player hunt still needs a candidate player in range (01 rule 19). Rests on rules 19-21. Downward (rare): a disconnected player's list keeps the nid of a `DESPAWN` NPC whose record was deleted (`Engine-TS/src/network/rsbuf/index.ts:270-281`), because phase 10 skips that player (`Engine-TS/src/engine/World.ts:1102-1104`); `World.getNextNid` uses `EntityList.next`, which wraps and reuses freed ids (`Engine-TS/src/engine/World.ts:1757-1758`, `Engine-TS/src/engine/entity/EntityList.ts:21-34`); a new NPC with that nid gets a fresh record with count 0 (`Engine-TS/src/network/rsbuf/index.ts:263-268`); a connected viewer adds it (+1); when the disconnected player is later removed, `rsbuf.removePlayer` decrements the new record (`Engine-TS/src/network/rsbuf/index.ts:156-160`), back to 0 while a player still has it in view. Read, not observed (open question #39).
- **Inference: an NPC near a player whose client disconnected keeps that player's observer contribution** until the player is removed (phase 6, after the timeouts in [`07-logouts-logins.md`](07-logouts-logins.md)) or reconnects, because phase 10 skips unconnected players (`Engine-TS/src/engine/World.ts:1102-1104`) and so never removes the NPC from that list. Rests on rules 19 and 21.
- **Inference: a teleport is shown to observers as remove-then-add, never as movement**, and the add carries `jump`; the local player gets a teleport block with `jump` instead. A player that teleports by `EXACT_MOVE` (same level) has `jump` false unless set elsewhere ([`06-players-interaction-movement.md`](06-players-interaction-movement.md) rule 23), so its add carries `jump = 0`. Rests on rules 11-13. What the client does with this was not read.
- **Inference: within one tick only the final values are sent.** Masks are a bitset and the block fields are single values, read once in phase 9 (rules 6, 16); e.g. three hits in one tick: the third `applyDamage` uses `hitmarkSlot` 2 (even), so it overwrites the first hit's `DAMAGE` fields, and only two hitsplats are sent (`Engine-TS/src/engine/entity/Player.ts:1948-1957`; `hitmarkSlot` is reset to 0 in phase 11, `Engine-TS/src/engine/entity/PathingEntity.ts:623`). Client display not read. Rests on rules 6 and 16.
- **Inference: a player who gets no `APPEARANCE` mask on its login tick would make an observer that adds it throw in phase 10** (rule 27): `generateAppearance` sets `lastAppearance` (rule 9), so the add includes `APPEARANCE` (rule 14) but no appearance block was cached (rule 6). The content login script normally sets the mask (rule 23), so this needs the script to stop before `~update_all` (e.g. an error, or a suspend); not checked (#40).
- **Inference: the "nothing moves the player between phases 9 and 10" assumption in [`08-zones.md`](08-zones.md) Inferences holds for the functions read**: phase 10 runs no script and calls no teleport or movement (rule 18).

## Not checked / open questions

- Client decoding of `PLAYER_INFO`/`NPC_INFO`: how the client applies the movement bits, teleport block, `jump` bit, remove/add, block order and the 2-byte mask header (`docs/open-questions.md` #14, #31).
- Whether observer counts really drift in a running server, and whether content NPC hunts with `PAUSEHUNT` are affected (`docs/open-questions.md` #39).
- Whether any path sets `SAY`/`CHAT` with a null value, or lets a player be added to another's list before its `APPEARANCE` mask was ever set (`docs/open-questions.md` #40).
- What can throw inside `generateAppearance` (e.g. `ObjType.get` on a bad worn id) and the rsbuf compute path; not analysed (rule 26). `docs/open-questions.md` #49.
- The size-budget (`fits`) arithmetic and the `viewDistance` resize logic of `BuildArea.resize`/`rebuildPlayers` (`Engine-TS/src/network/rsbuf/build.ts:72-117`) were read but not traced through examples; `getNearbyPlayersNearest`'s spiral order was not checked. `docs/open-questions.md` #53.
- `REBUILD_NORMAL` encoding (`RebuildNormalEncoder`) was not read. `docs/open-questions.md` #53.

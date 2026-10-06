# Server response to a chop: script effects back to the client

**Question answered:** When the woodcutting script runs `mes`, `anim`, `sound_synth`, `inv_add` and `stat_advance`, how does each effect reach the client, and what does the client do with it?

Continues [`click-loc-woodcutting.md`](click-loc-woodcutting.md), which covers the click up to the script being selected.

**Based on commits** (branch `calum-research`, based on upstream `274`):
- Engine-TS: `1d25566c`
- Content: `65b754f76`
- Client-TS: `7d6ca61`

**Method:** read code only. Nothing was run.

**Scope:** the five script commands above, as used in `Content/scripts/skill_woodcutting/scripts/woodcut.rs2` (`mes` at 37/45/73/132, `anim` at 71, `sound_synth` at 72, `stat_advance` at 133, `inv_add` at 134). Not covered: `loc_change` (the tree turning into a stump), the afk macro events, and anything that happens on the client after the data is stored (rendering).

## Summary

Script commands do one of two things. They either **write a packet immediately**, or **change player state that is sent later in the tick**.

| Script command | What the engine does when it runs | When the client is told | Packet |
|---|---|---|---|
| `mes(...)` | `write(new MessageGame(msg))` | immediately | `MESSAGE_GAME` (161) |
| `sound_synth(...)` | `write(new SynthSound(...))` | immediately | `SYNTH_SOUND` (34) |
| `anim(...)` | sets `animId`/`animDelay` and an `ANIM` mask bit | `processClientsOut`, inside `PLAYER_INFO` | `PLAYER_INFO` (167), mask `0x2` |
| `inv_add(...)` | changes the inventory container (dirty slots) | `processClientsOut` → `updateInvs` | `UPDATE_INV_FULL` (106) or `UPDATE_INV_PARTIAL` (172) |
| `stat_advance(...)` | changes `stats`/`levels` | `processClientsOut` → `updateStats` | `UPDATE_STAT` (105) |

## 1. How a write reaches the socket

1. `Player.write(message)` returns if the client is not connected, otherwise calls `writeInner(message)`. `Engine-TS/src/engine/entity/Player.ts:2239`.
2. `NetworkPlayer.writeInner` (`NetworkPlayer.ts:191`):
   - finds the encoder for the message type (`ServerGameProtRepository.getEncoder`);
   - writes the opcode byte: `buf.p1(prot.id + client.encryptor.nextInt())` when an encryptor is set, else `buf.p1(prot.id)` (`NetworkPlayer.ts:206`);
   - reserves a 1 byte (length `-1`) or 2 byte (length `-2`) size field for variable-length packets, encodes the body, then fills in the size;
   - calls `this.client.send(...)` (`NetworkPlayer.ts:226`).
3. For TCP, `send` is `this.socket.write(src)` (`Engine-TS/src/server/tcp/TcpClientSocket.ts:15-16`), so the bytes are handed to the socket as soon as `write` is called. The WebSocket client does the same at the engine level: `WSClientSocket.send` calls `this.socket.send(src)` (`Engine-TS/src/server/ws/WSClientSocket.ts:19-21`), which forwards to the `@fastify/websocket` socket (`Engine-TS/src/web.ts:87-101`), one send per packet at write time; the library side was not read (see [`../tick/10-clients-out.md`](../tick/10-clients-out.md) rule 1, open question #13).
4. The client reads the opcode and **subtracts** its own ISAAC value: `this.ptype = (this.ptype - this.randomIn.nextInt) & 0xff` (`Client-TS/src/client/Client.ts:5886`), then looks up the size in `ServerProtSizes[this.ptype]` (5887). This is consistent with the engine's addition (step 2).
5. The opcode ids agree on both sides for all packets used here: `MESSAGE_GAME = 161`, `UPDATE_STAT = 105`, `UPDATE_INV_FULL = 106`, `UPDATE_INV_PARTIAL = 172`, `PLAYER_INFO = 167`, `SYNTH_SOUND = 34` (`Engine-TS/src/network/game/server/ServerGameProt.ts:30,31,41,45,56,76`; `Client-TS/src/io/ServerProt.ts` same lines).

## 2. Where in the tick each kind of write happens

`World.cycle()` (`Engine-TS/src/engine/World.ts:340`) order, as read: `processClientsIn` (355), `processPlayers` (378), `processZones` (390), `processInfo` (397), `processClientsOut` (408), `processCleanup` (415).

- Scripts for the interaction run inside `processPlayers` (via `processInteraction`, see the previous note), so `mes` and `sound_synth` packets are written during that phase.
- `processInfo` (`World.ts:994`) passes each player's `masks`, `animId`, `animDelay` and more to `rsbuf.computePlayer`.
- `processClientsOut` (`World.ts:1096`) calls, per connected player and in this order: `updateMap`, `updatePlayers`, `updateNpcs`, `updateZones`, `updateInvs`, `updateStats`, `updateAfkZones`, then `encodeOut`. Inventory, stat and animation packets are therefore sent here.
- `processCleanup` resets per-tick tracking, including `inv.resetTracking()` for each player's inventories (it is called at `World.ts:415`; the loop is in the function body).

**Inference (labelled):** within one tick the client receives the immediately-written packets (`MESSAGE_GAME`, `SYNTH_SOUND`) before the `PLAYER_INFO`, inventory and stat packets for that tick. This rests on the order above and on step 1.3 (TCP writes immediately).

## 3. `mes`: chat message

1. Handler: `[ScriptOpcode.MES]` pops a string and calls `state.activePlayer.messageGame(message)`. `Engine-TS/src/engine/script/handlers/PlayerOps.ts:343`.
2. `messageGame(msg)` is `this.write(new MessageGame(msg))`. `Player.ts:2289`.
3. `MessageGameEncoder` writes the string with `buf.pjstr(message.msg)`. `network/game/server/codec/MessageGameEncoder.ts`. `MESSAGE_GAME` has variable length `-1` (`ServerGameProt.ts:45`).
4. Client handler (`Client.ts:6417`): reads `this.in.gjstr()`. If the message ends in `:tradereq:` or `:duelreq:` it is handled as a trade/duel request (with an ignore-list and chat-setting check), otherwise it calls `this.addChat(0, message, '')` (`Client.ts:6451`).

## 4. `sound_synth`: sound effect

1. Handler `[ScriptOpcode.SOUND_SYNTH]` pops `synth, loops, delay`, checks `synth` is not null, **returns without sending if `player.lowMemory`** (`PlayerOps.ts:476-483`), otherwise `player.write(new SynthSound(synth, loops, delay))` (`PlayerOps.ts:486`).
2. `SYNTH_SOUND` has fixed length 5 (`ServerGameProt.ts:76`), which matches the client reading `g2, g1, g2`.
3. Client handler (`Client.ts:7022`): stores the sound only if `this.waveEnabled && !Client.lowMem && this.waveCount < 50`, with `delay + JagFX.delays[soundId]`. What plays it later was not read.

## 5. `anim`: animation

1. Handler `[ScriptOpcode.ANIM]` pops `delay` then `seq`, calls `state.activePlayer.playAnimation(seq, delay)`. `PlayerOps.ts:196`.
2. `playAnimation` (`Player.ts:1920`): returns if `anim >= SeqType.count` or `this.animProtect`. Otherwise it only applies if `anim == -1`, or the current `animId == -1`, or `SeqType.get(anim).priority >= SeqType.get(this.animId).priority`; then it sets `animId`, `animDelay`, and `masks |= PlayerInfoProt.ANIM` (`Player.ts:1925-1928`).
3. In `processInfo` the values go into `rsbuf.computePlayer` (`World.ts:1033-1034`). The renderer builds `new PlayerInfoAnim(player.animId, player.animDelay)` when the `ANIM` mask is set (`network/rsbuf/renderer.ts:53-54`). It encodes `p2(anim)` then `p1(delay)` (`network/rsbuf/messages.ts:62-71`). `PlayerInfoProt.ANIM = 0x2` (`network/rsbuf/prot.ts:3`).
4. It is sent in `PLAYER_INFO` (167) from `updatePlayers`, which calls `rsbuf.playerInfo(...)` (`NetworkPlayer.ts`, `updatePlayers`).
5. Client: `PLAYER_INFO` → `getPlayerPos` (`Client.ts:6409`). Mask `PlayerUpdate.ANIM = 0x2` (`Client-TS/src/dash3d/ClientPlayer.ts:22`) is handled at `Client.ts:7843`: `seqId = g2` (`65535` becomes `-1`), `delay = g1`. The client applies **its own** priority check: it takes the new animation if `seqId === -1`, or the current one is `-1`, or `SeqType.list[seqId].priority >= SeqType.list[player.primaryAnim].priority`. If the same animation is already playing it instead follows that animation's `duplicatebehaviour` (`RestartMode.RESET` or `RESETLOOP`).

## 6. `inv_add`: items

1. Handler `[ScriptOpcode.INV_ADD]` (`Engine-TS/src/engine/script/handlers/InvOps.ts:57`) pops `inv, objId, count` and validates them. It throws if the inventory type is protected and the script does not have protected access, and if a dummy item is added to a non-dummy inventory.
2. It calls `player.invAdd(invType.id, objType.id, count)`, which is `container.add(obj, count, -1)` (`Player.ts:1548-1555`). Anything that does not fit (`overflow`) is spawned in the world at the player's position as a despawning `Obj` with the player as owner (`World.addObj(..., player.hash64, 200)`), one at a time for non-stackable items or one stack for stackable ones (`InvOps.ts:75-85`).
3. Nothing is sent at this point. In `processClientsOut`, `updateInvs` (`NetworkPlayer.ts:332`) walks the player's inventory listeners. For a listener seen for the first time it writes `UpdateInvFull(listener.com, inv)`. Otherwise, if `inv.update` is set, it writes `UpdateInvPartial(listener.com, inv, ...inv.getDirtySlots())`. For player inventories it also tracks weight changes (`NetworkPlayer.ts:332-380`).
4. Client (`Client.ts:6262` full, `6293` partial): looks up the interface component `IfType.list[comId]`, fills `linkObjType[slot]` / `linkObjNumber[slot]` (count `255` means a following `g4`), and sets `this.redrawSide = true`.

## 7. `stat_advance`: experience

1. Handler `[ScriptOpcode.STAT_ADVANCE]` pops `stat, xp` and calls `state.activePlayer.addXp(stat, xp)`. `PlayerOps.ts:810`.
2. `addXp(stat, xp, allowMulti = true)` (`Player.ts:1819`):
   - throws if `xp < 0`, returns if `xp == 0`;
   - `const multi = allowMulti ? Environment.node.xpRate : 1; this.stats[stat] += xp * multi;` (`Player.ts:1830-1831`). **So the script's xp is multiplied by the configured `xpRate`.** `Environment` spreads the result of `loadWorldConfig()` (`Engine-TS/src/util/Environment.ts:3-10`); the default is `xpRate: 1` (`util/WorldConfig.ts:98`), overridable with the `NODE_XPRATE` env var (`WorldConfig.ts:237`).
   - caps at `2_000_000_000` (the code comment says this represents 200m, with the value divided by 10);
   - recomputes `levels[stat]` (only if no buff/debuff is active, `levels == baseLevels`) and `baseLevels[stat]` from `getLevelByExp(this.stats[stat])` (1838-1843);
   - **if the base level went up**: replenishes the stat, calls `changeStat(stat)` (which enqueues the `CHANGESTAT` script for that stat if one exists, `Player.ts:1895-1899`), logs it, and enqueues the `ADVANCESTAT` script for that stat if one exists (`Player.ts:1885`). Both are enqueued on `PlayerQueueType.ENGINE`;
   - recomputes combat level and rebuilds appearance if it changed.
3. Sent in `updateStats` (`NetworkPlayer.ts:317`): for each stat where `stats[i] !== lastStats[i]` or `levels[i] !== lastLevels[i]`, writes `UpdateStat(i, stats[i], levels[i])`.
4. `UpdateStatEncoder` writes `p1(stat)`, `p4((exp / 10) | 0)`, `p1(level)`, and the code comment says level is "not base level". `UPDATE_STAT` has fixed length 6 (`ServerGameProt.ts:56`).
5. Client (`Client.ts:6656`): `statXP[stat] = xp`, `statEffectiveLevel[stat] = level`, and `statBaseLevel[stat]` is **recomputed on the client** from `Client.levelExperience` thresholds (`for i < 98: if xp >= levelExperience[i] then base = i + 2`). It sets `redrawSide = true`.

## Findings that connect to the previous note

- The loop in `woodcut.rs2` (`p_oploc(3)` repeatedly) produces this output on each pass that reaches `get_logs`: `mes`, `stat_advance`, `inv_add` (lines 132-134). Animation and sound are at lines 71-72, in `attempt_cut_tree` only (the `cut_tree` label re-plays the animation at 111 but has no `sound_synth`). Both are read from the script, not observed.

## Inferences (labelled)

- **The client does not receive base level from the server.** It receives `exp` and the effective level, and computes base level from `exp`. Rests on section 7 steps 4-5.
- **The unit of `productexp` values in the db.** `addXp` multiplies by `xpRate` and treats `2_000_000_000` as the cap for 200m, so the stat value appears to be stored in tenths of experience. Whether `woodcutting_trees:productexp` values in Content are in the same tenths unit is **not verified** (see open questions).

## Not checked / open questions

Logged in [`../open-questions.md`](../open-questions.md):

- The unit of `productexp` (see above) and what `getLevelByExp` / `Client.levelExperience` produce.
- `loc_change` (tree to stump and respawn).
- Whether `ws` clients behave like `tcp` in `send`.
- What the client does with the stored wave, chat, inventory and animation data (rendering is not covered).
- The remainder of `PLAYER_INFO` decoding on the client (`getPlayerPos`), including the movement bits that come before the masks.
- The client→server ISAAC use (`p1Enc`).

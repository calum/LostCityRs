# Clicking a loc (tree): client packet to script

**Question answered:** When a player clicks a loc (scenery object, e.g. a tree) and picks its first option, what happens from the client's click to the Content script that runs?

**Based on commits** (all on branch `calum-research`, based on upstream `274`):
- Engine-TS: `1d25566c`
- Content: `65b754f76`
- Client-TS: `7d6ca61`

**Method:** read code only. Nothing was run, so no tick timing or runtime behaviour has been observed.

**Scope:** the first-option loc click (`OPLOC1`) through to the script that is selected. The server's replies back to the client (messages, animation, inventory, stats) are **not** covered. See "Not checked".

## Flow summary (each step is verified below)

```
Client: menu option chosen -> interactWithLoc -> (local path) MOVE_OPCLICK + OPLOC1 packets
   |  socket
Engine: World.cycle -> processClientsIn -> NetworkPlayer.decodeIn -> OpLocDecoder -> OpLocHandler
        -> Player.setInteraction(target=loc, op=APLOC1)
Engine: (same tick) processPlayers -> Player.processInteraction -> tryInteract
        -> ScriptProvider.getByTrigger(op+7 = OPLOC1, loc type, loc category)
        -> executeScript(...)
Content: [oploc1,_tree] -> @attempt_cut_tree -> ... p_oploc(3) re-arms the interaction -> [oploc3,_tree] @cut_tree
```

## 1. Client sends the packets

1. Choosing a menu option runs `doAction`. `Client-TS/src/client/Client.ts:8552`.
2. For the loc's first option it calls `this.interactWithLoc(b, c, a, ClientProt.OPLOC1)`. `Client.ts:8769`.
3. `interactWithLoc(x, z, typecode, opcode)` (`Client.ts:5535`):
   - extracts the loc id from the typecode: `const locId = (typecode >> 14) & 0x7fff` (`Client.ts:5540`);
   - works out the loc's width/length, rotated by its angle, and its `forceapproach`, then calls `this.tryMove(...)` with `type` `2` (`Client.ts:5575-5593`; the calls are at 5591 and 5593);
   - writes the packet: `this.out.p1Enc(opcode); p2(x + mapBuildBaseX); p2(z + mapBuildBaseZ); p2(locId)` (`Client.ts:5601-5604`).
4. `tryMove` (`Client.ts:5608`) computes a route on the **client's** collision map. When it finds a route and `type === 2` it writes a `MOVE_OPCLICK` packet containing the route's start tile and up to 25 waypoint offsets (`Client.ts:5829-5868`, packet at 5843).
   - Order on the wire, as written in code: `MOVE_OPCLICK` is written inside `tryMove`, before `OPLOC1` is written. Both are written to `this.out` in the same call.
5. `p1Enc` writes an opcode byte. Which ISAAC cipher is applied to it was not read. See open questions.
6. The opcodes: `ClientProt.OPLOC1 = 215`, `MOVE_OPCLICK = 138` (`Client-TS/src/io/ClientProt.ts`). The engine's table agrees on 215: `ClientGameProt.OPLOC1 = new ClientGameProt(215, 6)` (`Engine-TS/src/network/game/client/ClientGameProt.ts:46`). The second argument (6) is the payload length, which matches three `p2` writes.

## 2. Engine reads and decodes the packet

1. `World.cycle()` runs the phases in a fixed order: `processWorld`, `processClientsIn` (line 355), `processNpcEventQueue`, `processNpcs`, `processPlayers` (378), `processLogouts`, `processLogins`, `processZones` (390), `processInfo`, `processClientsOut` (408). `Engine-TS/src/engine/World.ts:340-408`.
2. `processClientsIn` calls `player.decodeIn()` for each player. `World.ts:617`.
3. `NetworkPlayer.decodeIn()` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:55`):
   - resets `this.userPath = []` and `this.opcalled = false` (56-57);
   - loops `this.read()` while per-category limits (`userLimit`, `clientLimit`, `restrictedLimit`) are not reached (69).
4. `read()` reads the opcode byte (subtracting the next ISAAC value if a decryptor exists, lines 93-97), looks it up in `ClientGameProt.byId` (99), and closes the connection if the opcode is unknown (100-103). It reads the length, then the payload, then decodes it and calls the handler: `decoder.decode(...)` then `ClientGameProtRepository.getHandler(packetType)?.handle(message, this)`. `NetworkPlayer.ts:132-138`.
5. Opcode 215 is bound to `new OpLocDecoder(ClientGameProt.OPLOC1, 1)` with `new OpLocHandler()` (`ClientGameProtRepository.ts:135`). `OPLOC2..5` are bound the same way with op `2..5` (136-139).
6. `OpLocDecoder.decode` reads `x = g2(); z = g2(); loc = g2()` and builds `OpLoc(op, x, z, loc)`. `Engine-TS/src/network/game/client/codec/OpLocDecoder.ts`. This matches the client's three `p2` writes (section 1, step 3).

## 3. `OpLocHandler` validates and sets the interaction

`Engine-TS/src/network/game/client/handler/OpLocHandler.ts` rejects the click, sending `UnsetMapFlag` to the client and returning `false`, if any check fails:

1. `player.delayed` is true (line 14).
2. `x`/`z` are outside the player's `originX/originZ ± 52` box (lines 20-28). The code comment says "bad client: tile is not visible on client".
3. `World.getLoc(x, z, player.level, locId)` finds no loc.
4. `LocType.get(locId).op[op - 1]` is missing, `null` or `'hidden'`.

If all pass:

```ts
const trigger: ServerTriggerType = ServerTriggerType.APLOC1 + (message.op - 1);
player.clearPendingAction();
player.setInteraction(Interaction.ENGINE, loc, trigger);
player.opcalled = true;
return true;
```

`setInteraction` (`PathingEntity.ts:534`) stores `target`, `targetOp = op`, and sets `apRange = 10` and `apRangeCalled = false`. For a loc it records the type so a later change of type can be detected (`targetSubject.type`).

Back in `processClientsIn`, when `userPath.length > 0 || opcalled`: if the player is `delayed`, the map flag is unset; otherwise `moveClickRequest` is set to `false` when `!player.busy() && player.opcalled`, else `true`. `World.ts:618-628`. What `moveClickRequest` does was not read. See open questions.

## 4. The interaction runs later in the same tick

1. `processPlayers` runs after `processClientsIn` in `World.cycle()`. Per player it runs, in order: clear `delayed` if due (`World.ts:692`), resume a suspended script, `processQueues`, `processTimers` (normal and soft), `processEngineQueue`, `setFaceEntity`, `reorientEntity`, **`processInteraction`**, `reorient`, `updateEnergy`, and `validateDistanceWalked` unless the `EXACT_MOVE` mask is set (`World.ts:724-726`). `World.ts:687-737` (`processInteraction` at 717). The block comment above `processPlayers` (`World.ts:678-686`) does **not** list the same order: it omits the undelay, `setFaceEntity`, `reorientEntity`, `reorient`, `updateEnergy` and `validateDistanceWalked`, and lists "close interface if attempting to logout", which has no code in `processPlayers`. Full order: [`../tick/05-players-queues-timers.md`](../tick/05-players-queues-timers.md) and [`../tick/06-players-interaction-movement.md`](../tick/06-players-interaction-movement.md).
2. `Player.processInteraction()` (`Player.ts:1247`):
   - if there is a target and the player can access (`canAccess()`), validate the target (same level, same loc type, still valid), then `interacted = this.tryInteract(false)` (line 1269): the first attempt **before** moving, with `allowOpScenery = false`;
   - if not interacted: `pathToPathingTarget()`, then `processWalktrigger()` if there are waypoints and `canAccess()`, then clear the interaction if this is a follow op (player op 3) and there are no waypoints (lines 1277-1285), then `updateMovement()`, then, if there is still a target **and** `canAccess()` **and** it is not a follow op (line 1289), `tryInteract(this.stepsTaken === 0)` (line 1290): the attempt **after** moving, where `allowOpScenery` is true only if the player took no steps this tick;
   - if still not interacted, there are no waypoints, no steps were taken and `apRangeCalled` is false, the player gets the message `"I can't reach that!"` and the interaction is cleared.
3. `tryInteract(allowOpScenery)` (`Player.ts:1160`). The first branch runs the **op** script when all of these hold: an op trigger exists, the target is a `PathingEntity` **or** `allowOpScenery` is true, and `inOperableDistance(target)`. `Loc` extends `NonPathingEntity` (`Engine-TS/src/engine/entity/Loc.ts:7`), not `PathingEntity` (`PathingEntity.ts:30`), so for a loc this condition only passes when `allowOpScenery` is true (condition at `Player.ts:1170`). In that branch it clears waypoints and calls `this.executeScript(ScriptRunner.init(opTrigger, this, target), true)` (`Player.ts:1176`).
4. The op trigger lookup: `getOpTrigger()` returns `ScriptProvider.getByTrigger(this.targetOp + 7, typeId, categoryId)` (`Player.ts:1017`), where `typeId` and `categoryId` come from the loc's `LocType`. `ServerTriggerType.APLOC1 = 59` and `OPLOC1 = 66` (`ServerTriggerType.ts:56, 63`), so `APLOC1 + 7 = OPLOC1`. The "ap" trigger (`getApTrigger`, `Player.ts:1020`) uses `targetOp` unmodified and runs instead only if there is no usable op branch (approach distance, `apRange`).
5. `ScriptProvider.getByTrigger(trigger, type, category)` tries in order: a script keyed on the specific type, then one keyed on the category, then the global trigger. `ScriptProvider.ts:124-134`.

## 5. Content: the tree script

`Content/scripts/skill_woodcutting/scripts/woodcut.rs2`:

- `[oploc1,_tree] @attempt_cut_tree;` (line 1) and `[oploc3,_tree] @cut_tree;` (line 3). The comment on line 2 is `// "hidden" op`.
- `attempt_cut_tree` looks up the tree in the `woodcutting_trees` db table, then checks in order: members-only (27-32), woodcutting level (34-39), free inventory space (41-47), the afk event (49-54). If `%action_delay < map_clock` it checks the axe, sets `%action_delay = calc(map_clock + 3)`, calls **`p_oploc(1)`** and returns (55-62). Otherwise it plays the swing animation and sound, shows `"You swing your axe at the tree."`, may call `@get_logs` (`if (%action_delay = map_clock)`, 74-76), and ends with **`p_oploc(3)`** (78).
- `cut_tree` (81-115) repeats the checks and ends with `p_oploc(3)`. `get_logs` (117-142) rolls the success chance, gives the item and xp, may swap the loc (`loc_change`) and otherwise ends with `p_oploc(3)` (142).

**How `p_oploc` loops:** `ScriptOpcode.P_OPLOC` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:387`) pops `type`, rejects values outside 1..5, returns early if the loc has no such op in its `LocType`, then calls `stopAction()`, queues a waypoint to the loc if the player is not in operable distance, and calls `setInteraction(Interaction.SCRIPT, state.activeLoc, ServerTriggerType.APLOC1 + type)` (lines 387-400). That re-sets `targetOp`, so the next `processInteraction` finds `OPLOC1 + type` through the same `+ 7` lookup (section 4, step 4). This is why `p_oploc(3)` at the end of `attempt_cut_tree` leads to `[oploc3,_tree]` and then repeats through `cut_tree`.

## Inferences (labelled)

- **The repeated chopping is driven by scripts re-arming the interaction each time.** Rests on section 5 (`p_oploc(3)` at lines 78, 115, 142) and section 4 (a script calling `setInteraction`, so a new target op is processed on a later `processInteraction`). Which tick the next run happens on was not verified.
- **`oploc3` being a "hidden" op** is taken from the comment on `woodcut.rs2:2`. Whether the tree's `LocType` actually marks op 3 as hidden was not checked. Note `P_OPLOC` returns early if `locType.op[type]` is falsy (`PlayerOps.ts:393`), so the loc's op list matters for the loop. This needs verifying in the loc config.

## Not checked / open questions

Logged in [`../open-questions.md`](../open-questions.md):

- What the server sends back (message, animation, inventory, stats) and how the client handles it.
- What `MOVE_OPCLICK` does on the engine (`userPath`, `moveClickRequest`) and how the engine pathing relates to the client's route.
- What `_tree` means (a loc category?), and how the compiled script is keyed (`ScriptProvider`'s `(0x1 << 8) | (category << 10)` form).
- The exact ISAAC cipher use on both sides.
- No `[aploc*,_tree]` was searched for outside `woodcut.rs2`.
- Real tick timing (nothing was run).

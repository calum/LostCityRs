# Open questions

Things not yet verified. Nothing here is a finding. Move an item into a note, with citations, once answered, and delete it from this list.

| # | Question | Why it is open / what is needed |
|---|---|---|
| 1 | The Engine-TS and Content READMEs are titled "November 23, 2004" while the Client-TS README is titled "September 7, 2004". What does each date refer to? | Only README headings read. Evidence so far on compatibility: the client sends `CLIENT_VERSION = 274` in login (`Client-TS/src/client/Client.ts:75,1774`) and the engine rejects any other revision than `Environment.engine.revision`, default `274` (`Engine-TS/src/engine/World.ts:2159`, `util/WorldConfig.ts:91`). That shows the revision *number* matches; it does not explain the dates. |
| 2 | What game revision/date does number `274` correspond to? | The number is evidenced (see #1). Its meaning in terms of game date is not read. |
| 3 | What is the full tick structure of the engine? | The phase order of `World.cycle()`, `processPlayers` and `processClientsOut` has been read (both flow notes). Not yet read: what each phase does in detail, the tick length, `processWorld`, `processZones`, `processInfo` internals. |
| 4 | What does the engine do with `MOVE_OPCLICK` (`userPath`, `moveClickRequest`), and how does the engine's pathing relate to the client's locally computed route? | The client sends the packet before `OPLOC1` (read). The engine handler and the use of `moveClickRequest` were not read. |
| 5 | How are RuneScript scripts compiled and keyed in `ScriptProvider`? What does `_tree` in `[oploc1,_tree]` mean (loc category?) | Only `ScriptProvider.getByTrigger` was read. `RuneScriptTS/` and how the `scriptLookup` keys are built are not read. |
| 6 | How does the client **render/use** the data it stores (chat, inventory, animation, sound, stats)? | The server-to-client path up to the client's stored state is covered in `docs/flows/server-response-woodcutting.md`. Rendering and `getPlayerPos` movement decoding are not read. |
| 7 | How is the client-to-server ISAAC cipher applied (client `p1Enc`) and how are the seeds exchanged at login? | Server-to-client use is read (engine `NetworkPlayer.ts:206`, client `Client.ts:5886`) and engine decrypt of incoming opcodes (`NetworkPlayer.ts:93-97`). Client `p1Enc` and the seed exchange (`World.ts` login around 2150) not read. |
| 8 | Does the tree's `LocType` really mark op 3 as hidden, as the comment on `woodcut.rs2:2` says? Does `P_OPLOC` returning early on a missing op (`PlayerOps.ts:393`) interact with that? | The comment was read, the loc config was not. |
| 9 | Is there any `[aploc*,_tree]` script in Content? | Only `woodcut.rs2` was read. |
| 10 | What is the real timing of the chopping loop (which tick each `p_oploc(3)` re-run happens on, how `%action_delay` and `map_clock` interact)? | Needs the server running (or a close read of the scheduling code) to be sure. Not observed. |
| 11 | What unit are `woodcutting_trees:productexp` values in (whole xp or tenths)? | `addXp` adds `xp * xpRate` to a stat that is capped at 2,000,000,000 and sent as `exp / 10` (`Player.ts:1830-1834`, `UpdateStatEncoder.ts`). Content's db values and `getLevelByExp` not read. |
| 12 | What does `loc_change` do (tree to stump, respawn), and how does it reach the client (`LOC_ADD_CHANGE`)? | Not read. |
| 13 | Does the WebSocket client (`Engine-TS/src/server/ws`) send packets the same way as TCP? | Only `TcpClientSocket.send` read. |

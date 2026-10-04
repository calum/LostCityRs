# Open questions

Things not yet verified. Nothing here is a finding. Move an item into a note, with citations, once answered, and delete it from this list.

| # | Question | Why it is open / what is needed |
|---|---|---|
| 1 | The Engine-TS and Content READMEs are titled "November 23, 2004" while the Client-TS README is titled "September 7, 2004". Is the client revision compatible with the engine on branch `274`, and what does each date refer to? | Only the README headings have been read. The `OPLOC1` opcode (215) and payload (3 x `g2`/`p2`) match between client and engine (`docs/flows/click-loc-woodcutting.md`), but that is one packet, not a revision check. |
| 2 | Which game revision does branch `274` correspond to? | Branch name only; nothing else read. |
| 3 | What is the full tick structure of the engine? | The phase order of `World.cycle()` and `processPlayers` has been read (`docs/flows/click-loc-woodcutting.md` section 2 and 4). Not yet read: what each phase does in detail, the tick length, `processWorld`, `processZones`, `processInfo`, `processClientsOut`. |
| 4 | What does the engine do with `MOVE_OPCLICK` (`userPath`, `moveClickRequest`), and how does the engine's pathing relate to the client's locally computed route? | The client sends the packet before `OPLOC1` (read). The engine handler and the use of `moveClickRequest` were not read. |
| 5 | How are RuneScript scripts compiled and keyed in `ScriptProvider`? What does `_tree` in `[oploc1,_tree]` mean (loc category?) | Only `ScriptProvider.getByTrigger` was read. `RuneScriptTS/` and how the `scriptLookup` keys are built are not read. |
| 6 | What does the server send back after the script runs (message, animation, inventory, stats), and how does the client handle each? | Not read (`Engine-TS/src/network/game/server`, `processClientsOut`; client `tcpIn`/`ServerProt.ts`). |
| 7 | How is the ISAAC cipher used for opcodes on both sides (client `p1Enc` and the engine `decryptor`)? | Only the engine's use at `NetworkPlayer.ts:93-97` was read, and the client's `randomIn` use at `Client.ts` `tcpIn`. Seed exchange (login) not read. |
| 8 | Does the tree's `LocType` really mark op 3 as hidden, as the comment on `woodcut.rs2:2` says? Does `P_OPLOC` returning early on a missing op (`PlayerOps.ts:393`) interact with that? | The comment was read, the loc config was not. |
| 9 | Is there any `[aploc*,_tree]` script in Content? | Only `woodcut.rs2` was read. |
| 10 | What is the real timing of the chopping loop (which tick each `p_oploc(3)` re-run happens on, how `%action_delay` and `map_clock` interact)? | Needs the server running (or a close read of the scheduling code) to be sure. Not observed. |

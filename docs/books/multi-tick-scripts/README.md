# Book 4: How multi-tick scripts run

**Question answered:** How does a RuneScript script (or any server work) spread over several game ticks, on the server and on the client, shown first with the smallest real examples and then with the most involved ones in Content?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`
- Client-TS: `7d6ca61`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". The chapters were drafted by research agents that read the submodules, then checked: `docs/tools/check_citations.py` passes on every chapter (cited lines exist, quoted snippets are found in them, abbreviated quotes are marked ```` ```abbrev ````), and the central claims below were re-read by hand against the source (see "What was verified by hand").

Series: this is Book 4 of [the series](../README.md). It builds on [Book 1, *A Short Introduction to the Tick*](../../guide/a-short-introduction-to-the-tick.md): that guide's chapters 3 to 6 (phases, a player's and an NPC's turn, packets) and its crib in chapter 8 are what the engine rules here (chapter 4) re-verify and extend. Its one worked example, chopping a tree, is the `p_oploc` loop of chapter 3 here, and the guide's "not covered" list (content read for woodcutting only) is what chapters 5-11 address.

Companion book: [Book 3, an introduction to RuneScript](../runescript-intro/README.md). Read that first if `.rs2` syntax is new to you; the examples here use it without explaining it.

## The short answer

1. **A script is a data structure, not a thread.** One running script is one `ScriptState` object (program counter, int/string stacks, locals, call frames, "active player/npc/loc/obj" pointers). `ScriptRunner.execute` is a `while (state.execution === RUNNING)` loop that runs one opcode handler at a time (`Engine-TS/src/engine/script/ScriptRunner.ts:137-157`). Chapter 1.
2. **Suspending means leaving that loop.** A handler sets `state.execution` to something other than `RUNNING`; the loop exits and the object is kept. The complete list of writers is `p_delay`, `p_arrivedelay`, `p_pausebutton`, `p_countdialog`, `npc_delay`, `npc_arrivedelay`, `world_delay`. Resuming is calling `execute` again on the same object, which carries on from the saved `pc`. Chapter 1, findings 4-10.
3. **Who resumes it depends on what it waits for.** Time-waits resume at a fixed point of the tick: player `p_delay` at the start of the player's phase-5 turn, `npc_delay` at the top of the NPC's phase-4 turn, `world_delay` in the phase-1 world queue. Dialogue waits (`p_pausebutton`, `p_countdialog`) resume in phase 2 when the matching client packet is decoded. Chapter 1, finding 8 (table).
4. **Much "multi-tick" behaviour is not suspension at all.** Queues (`queue`, `weakqueue`, `longqueue`), timers (`settimer`, `softtimer`) and the `p_oploc`/`p_opnpc` re-arming loop run a *new* script on a later tick; state between runs lives in varps, queue arguments and entity fields, not in the interpreter. Chapter 2, and chapters 5-10 for real cases.
5. **Interruption is a property of the mechanism.** A delayed player has move/op packets dropped; opening or closing a modal abandons a waiting dialogue script and clears the weak queue; logout or removal wipes the slot. Chapters 1 (1.6-1.7) and 4.
6. **There is no client script that spans ticks in this revision.** The only client "scripts" are interface-component expressions (`IfType.scripts`), stateless and re-evaluated at draw time; no server packet carries code to the client. What runs over several ticks on the client is local counters (animation frames, walking interpolation, camera moves, countdowns) started by one packet and advanced about 30 times per tick. Chapter 12.

## Reading order

| # | Chapter | What it covers |
|---|---|---|
| 1 | [suspension model](01-suspension-model.md) | `ScriptState`, the interpreter loop, every suspending command, every resume site, delay arithmetic, what abandons a waiting script, how dialogues are built on `p_pausebutton` |
| 2 | [multi-tick without suspension](02-multi-tick-without-suspension.md) | queues, timers, NPC/world queues, the `p_oploc` loop, Content usage counts |
| 3 | [eight simple examples](03-simple-examples.md) | bury bones, hay bale, shopkeeper, lyre, maze timer, NPC death, tutorial fire, woodcutting loop, each with a tick-by-tick timeline |
| 4 | [engine rules for the complex examples](04-engine-rules-for-the-complex-examples.md) | the twelve engine rules chapters 5-10 rely on, re-verified |
| 5 | [Old Man and Maze](05-random-event-old-man-and-maze.md) | player timer, `p_delay` inside a timer script, NPC timer and queue, zone-armed countdown |
| 6 | [the Mime](06-random-event-mime.md) | an NPC timer as a shared state machine over many players |
| 7 | [pottery wheel](07-pottery-wheel-weakqueue-loop.md) | a skill loop re-armed through `weakqueue*` |
| 8 | [Zombie Queen raft and bridge](08-zombie-queen-raft-and-bridge.md) | a ~26-tick `p_delay` cutscene with camera and teleports; a timer that runs a `p_delay` chain |
| 9 | [Shilo green mist](09-zombie-queen-green-mist.md) | a `queue` handing over to `world_delay`, so the script outlives the player's own state |
| 10 | [thieving stall cooldown](10-thieving-stall-longqueue.md) | `longqueue` as a persistent timer that survives logout |
| 11 | [patterns catalogue](11-patterns-catalogue.md) | the mechanisms side by side, when authors seem to pick each (labelled inference), consolidated not-checked list |
| 12 | [the client side](12-client-side.md) | interface expressions, packet list, what progresses over client cycles, the camera example, server+client pairings |

## What was verified by hand (by the author of this README, after the drafts)

- `p_delay` sets `delayedUntil = currentTick + 1 + n` and `SUSPENDED` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380`); the player's phase-5 turn clears `delayed` and resumes `SUSPENDED` scripts (`Engine-TS/src/engine/World.ts:692-697`); `npc_delay` resumes at the top of `Npc.turn` (`Engine-TS/src/engine/entity/Npc.ts:110-118`); `world_delay` returns the script to the world queue (`Engine-TS/src/engine/World.ts:548-556`).
- No Content script calls `strongqueue`: `grep` finds the declarations in `Content/scripts/engine.rs2:93-100` and otherwise only comments.
- Client: the 69 server opcodes are the entries of `Client-TS/src/io/ServerProt.ts:1-96` (counted by grep) and an unknown opcode logs out at `Client-TS/src/client/Client.ts:7133-7135`; `rebootTimer = ... * 30` is at `Client-TS/src/client/Client.ts:6650`; `getIfActive` is at `Client-TS/src/client/Client.ts:10365`; `rantz.rs2:319-320` holds the slow camera calls.
- Not re-derived by hand: the individual tick timelines in chapters 3 and 5-10, the interface examples in chapter 12 (beyond what the checker confirms), and the "pottery runs every 3 ticks" inference (chapter 7). Treat those as "read once by an agent, citations machine-checked".

## Limits of the whole book

- Nothing was run. Several drafts flag readings that conflict with code comments (for example `world_delay(d)` resuming `d+2` ticks later versus a `// 4t` comment); these are listed in chapters 1, 9 and 11 and in `docs/open-questions.md`.
- The compiler (`RuneScriptTS`) is covered only in Book 3; chapters 1-12 rely on the engine's view of compiled scripts.

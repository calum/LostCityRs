# Chapter 2: Multi-tick behaviour without suspension (server)

**Question answered:** Which mechanisms spread work over several ticks without suspending a script: engine queues, timers, the NPC and world queues, and the re-arming `p_oploc` loop?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---

## Part 2: Multi-tick behaviour without suspension

Summarised from 05, 04, 01 and 06 (each rule re-checked at the cited lines). None of these touch `ScriptState.execution`; each creates **new** script runs later.

26. **Player queues** (`Engine-TS/src/engine/entity/Player.ts:841-851`, `:874-926`): `queue` (`NORMAL`), `strongqueue`, `longqueue` go to `queue`; `weakqueue` to `weakQueue`; engine triggers (`mapzone`, `zone`, `changestat`, `advancestat`) to `engineQueue` with delay 0 (05 rules 9, 20). The command handlers pass the script's delay unchanged: `PlayerOps.ts:100-193`.
    - Counter: `const delay = request.delay--; if (this.canAccess() && delay <= 0) {...run...}` (`Player.ts:903-904`). The counter ticks down on every visit even when the player is blocked. An entry with delay d runs on visit d+1 if accessible (05 rule 11). Visit = once per tick, phase 5 step 3.
    - Order inside a turn: normal queue pass then weak queue pass (`Player.ts:887-888`).
    - Entry added by a script running *in the same list's pass* is reached in the same pass unless the running entry was the last node (05 rule 13).
    - Weak entries are wiped by every `closeModal()` with the default argument, i.e. by any move/op click, `p_stopaction`, `if_close`, or a `STRONG` entry in the queue (Finding 17).
    - Timing (05 Inferences, rests on the above): d >= 0 added before this player's phase-5 pass in tick T runs in T+d; added after it (e.g. from a step-8 op script) in T+1+d, if accessible on every visit.

27. **Player timers** (`Player.ts:928-961`): `settimer(script, n)` / `softtimer(script, n)` store `{clock: currentTick, interval}` in a `Map` keyed by script id (replacing any existing one); `processTimers` fires when `currentTick >= clock + interval`, sets `clock = currentTick` *before* running, and a normal timer also needs `canAccess()` while a soft timer does not (`Player.ts:945-961`). No countdown: ticks spent blocked count toward the interval. All timers are skipped while `loggingOut` (`World.ts:702-707`). Commands: `PlayerOps.ts:874-900`; clear: `Player.ts:941-943`.

28. **NPC queue and timer** (`Npc.ts:550-583`): `npc_queue(queueId, arg, delay)` (`NpcOps.ts:159-165`; note the argument order in `engine.rs2:577`: `ai_queue, arg, delay`) appends to the NPC's queue; `processQueue` decrements only when the NPC is not delayed and runs when `delay <= 0` (`Npc.ts:566-581`); the script is looked up by trigger at run time (`Npc.ts:575`). `npc_settimer(n)` sets `timerInterval` (`NpcOps.ts:293-295`, `Npc.ts:219-223`); `processTimers` runs `[ai_timer,...]` when `++timerClock >= timerInterval`, a counter that increments once per NPC turn that reaches that code (`Npc.ts:550-559`). Order of an NPC's turn: resume, lifecycle, `isValid` gate, hunt, regen, timer, queue, movement/interaction (`Npc.ts:109-181`). Detail: 04 rules 12-13.

29. **World queue**: only `world_delay` writes it (suspension, so it is in Part 1). The other thing in the same phase is the delayed-obj queue (`World.ts:563-575`; 01).

30. **Interaction re-arming ("the loop")**: `p_oploc(n)` / `p_opnpc(n)` do not wait; they call `stopAction()` and `setInteraction(Interaction.SCRIPT, target, APLOC1 + type)` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:387-401`, `:404-415`). The interaction is processed by `processInteraction` in phase 5 step 8 (`Player.ts:1247-1314`). `tryInteract` clears `target` before running the op script and, after it returns, copies whatever target the script set into `nextTarget`, then restores the old target (`Player.ts:1171-1182`); at the end of `processInteraction`: `if (this.nextTarget) this.target = this.nextTarget;` else if the interaction ran, `clearInteraction()` (`Player.ts:1300-1308`). So a script that ends with `p_oploc(3)` keeps its interaction and the engine runs `[oploc3,...]` on a **later tick** (06 rule 19: first tried next tick). A script that does not re-arm ends the loop. This is what makes woodcutting repeat (Example 8).

31. **Counts of use in Content** (method: `grep -rn --include=*.rs2 -F '<text>' Content/scripts` with `/_test/` lines removed; counts are matching *lines*, include comments, and `-F` substring matches overlap, e.g. `settimer(` also matches `npc_settimer(`; indicative only):

    | Text | Lines |
    |---|---|
    | `p_delay(` | 1735 |
    | `p_arrivedelay` | 201 |
    | `p_pausebutton` | 37 |
    | `p_countdialog` | 39 |
    | `npc_delay(` | 82 |
    | `npc_arrivedelay` | 4 |
    | `world_delay(` | 29 |
    | `weakqueue(` | 12 |
    | `strongqueue(` | 1 |
    | `longqueue(` | 33 |
    | `npc_queue(` | 76 |

    So `p_delay` is by far the commonest suspension; dialogue goes through the few procs in `chat.rs2`.

---

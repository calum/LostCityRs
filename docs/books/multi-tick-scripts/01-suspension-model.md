# Chapter 1: The suspension model (server)

**Question answered:** How does a script stop in the middle, where is its state kept, what resumes it and in which tick phase, and what ends or abandons a waiting script?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---

## Part 1: The suspension model

### 1.1 What a script's state is

1. A running script is one `ScriptState` object. Its fields are the whole of the interpreter state. Source: `Engine-TS/src/engine/script/ScriptState.ts:25-62`
   ```ts
   export default class ScriptState {
       static readonly ABORTED = -1;
       static readonly RUNNING = 0;
       static readonly FINISHED = 1;
       static readonly SUSPENDED = 2; // suspended to move to player
       static readonly PAUSEBUTTON = 3;
       static readonly COUNTDIALOG = 4;
       static readonly NPC_SUSPENDED = 5; // suspended to move to npc
       static readonly WORLD_SUSPENDED = 6; // suspended to move to world
   ```
   - program counter `pc = -1` and `opcount` (`Engine-TS/src/engine/script/ScriptState.ts:41-42`);
   - gosub frames `frames`, frame pointer `fp` (`Engine-TS/src/engine/script/ScriptState.ts:44-45`);
   - int stack + `isp`, string stack + `ssp`, int and string locals (`Engine-TS/src/engine/script/ScriptState.ts:50-57`);
   - the `ScriptPointer` bit set `pointers` (`Engine-TS/src/engine/script/ScriptState.ts:62`);
   - the active entities: `self`, `_activePlayer`, `_activePlayer2`, `_activeNpc`, `_activeNpc2`, `_activeLoc(2)`, `_activeObj(2)` (`Engine-TS/src/engine/script/ScriptState.ts:68-103`);
   - `lastInt` (the value a number-input dialogue delivers, `Engine-TS/src/engine/script/ScriptState.ts:129`).

   `ScriptRunner.init` creates the state, sets `self` and the active-entity pointers from the `self`/`target` arguments (`Engine-TS/src/engine/script/ScriptRunner.ts:66-119`).

2. A gosub (`~proc`) pushes a frame that saves the caller's `script`, `pc` and locals, then starts the callee at `pc = -1`. `RETURN` pops it, or finishes the script when `fp === 0`. Source: `Engine-TS/src/engine/script/ScriptState.ts:334-347` (`gosubFrame`), `Engine-TS/src/engine/script/ScriptState.ts:324-332` (`popFrame`), `Engine-TS/src/engine/script/handlers/CoreOps.ts:206-212`
   ```ts
       [ScriptOpcode.RETURN]: state => {
           if (state.fp === 0) {
               state.execution = ScriptState.FINISHED;
   ```
   So when a command inside a proc suspends the script, the whole call stack (all frames) is part of the saved state. Gosub depth is capped at 50 (`Engine-TS/src/engine/script/handlers/CoreOps.ts:226-228`). `gotoFrame` (the `@label` jump) discards the frames (`fp = 0`, `Engine-TS/src/engine/script/ScriptState.ts:349-357`).

### 1.2 The interpreter loop: suspension is "leave the loop"

3. `ScriptRunner.execute(state)` is the only interpreter. Source: `Engine-TS/src/engine/script/ScriptRunner.ts:126-157`
   ```ts
               if (state.execution !== ScriptState.RUNNING) {
                   state.executionHistory.push(state.execution);
               }
               state.execution = ScriptState.RUNNING;
               ...
               while (state.execution === ScriptState.RUNNING) {
                   ...
                   const opcode = opcodes[++state.pc];
                   const handler = ScriptRunner.HANDLERS[opcode];
                   ...
                   handler(state);
               }
   ```
   and it ends with `return state.execution;` (`Engine-TS/src/engine/script/ScriptRunner.ts:231`). Read hop by hop:
   - On entry, whatever the previous stop reason was is pushed onto `executionHistory`, and `execution` is set back to `RUNNING` (`ScriptRunner.ts:127-130`). **A resume is therefore just another call to `execute` on the same object.**
   - `pc` is pre-incremented before the handler runs (`ScriptRunner.ts:150`). When a handler sets `state.execution` to anything other than `RUNNING`, the `while` condition fails after the handler returns and `execute` returns that value. `pc` is left pointing at the instruction that suspended. The next `execute` call does `++state.pc`, i.e. continues with the instruction *after* it. Stacks, locals, frames are untouched because nothing resets them.
   - `opcount` is never reset (grep of `opcount` in `Engine-TS/src` finds only `ScriptState.ts:42` and `ScriptRunner.ts:144,148,162`), so the 500,000-opcode limit (`ScriptRunner.ts:144-146`) is cumulative across suspensions of one `ScriptState`.

4. **Suspension = a command handler writes a non-`RUNNING` value to `state.execution`.** The complete list: grep of `Engine-TS/src` for `execution = ` finds exactly these writers outside the runner.

   | Command (opcode) | Sets | Also sets | Source |
   |---|---|---|---|
   | `p_delay(n)` | `SUSPENDED` | `delayed = true`, `delayedUntil = currentTick + 1 + n` (player) | `Engine-TS/src/engine/script/handlers/PlayerOps.ts:376-380` |
   | `p_arrivedelay` | `SUSPENDED`, but only if `lastMovement >= currentTick`; otherwise returns without effect | `delayed = true`, `delayedUntil = currentTick + 1` | `Engine-TS/src/engine/script/handlers/PlayerOps.ts:359-367` |
   | `p_pausebutton` (and `.p_pausebutton`) | `PAUSEBUTTON` | nothing else (the handler body is the single assignment) | `Engine-TS/src/engine/script/handlers/PlayerOps.ts:425-427` |
   | `p_countdialog` | `COUNTDIALOG` | writes a `PCountDialog` packet to the client first | `Engine-TS/src/engine/script/handlers/PlayerOps.ts:369-372` |
   | `npc_delay(n)` | `NPC_SUSPENDED` | NPC `delayed = true`, `delayedUntil = currentTick + 1 + n` | `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101` |
   | `npc_arrivedelay` | `NPC_SUSPENDED`, only if `lastMovement >= currentTick - 1` | `delayedUntil = currentTick + 1` if the NPC moved last tick, else `currentTick + 2` | `Engine-TS/src/engine/script/handlers/NpcOps.ts:557-570` |
   | `world_delay(n)` | `WORLD_SUSPENDED` | the delay argument is left on the int stack ("arg is popped elsewhere") | `Engine-TS/src/engine/script/handlers/ServerOps.ts:167-170` |
   | `return` at `fp === 0` | `FINISHED` (end, not a suspension) | | `Engine-TS/src/engine/script/handlers/CoreOps.ts:206-208` |
   | any thrown error | `ABORTED` | logs; in production also `logout()` + `loggingOut = true` for a player, `World.removeNpc` for an NPC | `Engine-TS/src/engine/script/ScriptRunner.ts:170-229` |

   `p_delay`, `.p_delay`, `.p_pausebutton`, `p_arrivedelay`, `p_countdialog`, `npc_delay`, `.npc_delay`, `npc_arrivedelay`, `world_delay` are declared as commands in `Content/scripts/engine.rs2:68,169,171,173,175,185,187,545,547,659`. Other commands that "wait" in the game sense (`queue`, `weakqueue`, `settimer`, `p_oploc`...) do **not** appear in this table: they do not touch `execution` (Part 3).

### 1.3 Where the suspended `ScriptState` is kept

5. `Player.executeScript` runs the script and then files the state by the returned execution value. Source: `Engine-TS/src/engine/entity/Player.ts:2202-2229`
   ```abbrevts
       executeScript(script: ScriptState, protect: boolean = false, force: boolean = false) {
           const state = this.runScript(script, protect, force);
           if (state === -1) { return; }
           if (state !== ScriptState.FINISHED && state !== ScriptState.ABORTED) {
               if (state === ScriptState.WORLD_SUSPENDED) {
                   World.enqueueScript(script, script.popInt());
               } else if (state === ScriptState.NPC_SUSPENDED) {
                   script.activeNpc.activeScript = script;
               } else {
                   script.activePlayer.activeScript = script;
                   script.activePlayer.protect = protect; // preserve protected access when delayed
               }
           } else if (script === this.activeScript) {
               this.activeScript = null;
               this.resumeButtons = [];
               if ((this.modalState & ModalState.MAIN) === ModalState.NONE) {
                   // close chat dialogues automatically and leave main modals alone
                   this.closeModal(false);
               }
           }
       }
   ```
   (the quote drops blank lines and comments; the code is at the cited lines). So the three homes are:
   - **`Player.activeScript`** (`Engine-TS/src/engine/entity/Player.ts:366`) for `SUSPENDED`, `PAUSEBUTTON`, `COUNTDIALOG`. It is a single field: one suspended script per player. The player chosen is `script.activePlayer`, whose getter picks primary/secondary by the operand at the current `pc` (`Engine-TS/src/engine/script/ScriptState.ts:185-191`, `:280-282`). `pc` still points at the suspending instruction, so `.p_delay` stores on the secondary player, the same one it delayed.
   - **`Npc.activeScript`** (`Engine-TS/src/engine/entity/Npc.ts:58`) for `NPC_SUSPENDED`. `Npc.executeScript` has the same routing (`Engine-TS/src/engine/entity/Npc.ts:225-248`).
   - **The world queue** `World.queue`, a `LinkList<EntityQueueState>` (`Engine-TS/src/engine/World.ts:155`), for `WORLD_SUSPENDED`. `World.enqueueScript(script, delay)` appends `new EntityQueueState(script, delay + 1)` (`Engine-TS/src/engine/World.ts:1249-1251`); `EntityQueueState` holds the `ScriptState` object itself (`Engine-TS/src/engine/entity/PlayerQueueRequest.ts:49-58`). `executeScript` pops the delay argument (`script.popInt()`) only after `execute` returned.

6. **Contrast with player queues.** `PlayerQueueRequest` holds a `ScriptFile` plus `args` (`Engine-TS/src/engine/entity/PlayerQueueRequest.ts:17-47`), and each time it fires, `processQueue` creates a *new* `ScriptState` with `ScriptRunner.init` (`Engine-TS/src/engine/entity/Player.ts:910`). A queue entry is "start a fresh script later", a suspension is "continue this exact interpreter later". Two scripts that look alike in content can therefore have very different state: `p_delay` keeps locals and the stack, `queue` keeps nothing but the arguments passed (`args`).

7. The world-queue pass also files states returned by a world-resumed script: `SUSPENDED` goes to `script.activePlayer.activeScript` (without setting `protect`), `NPC_SUSPENDED` to the NPC, `WORLD_SUSPENDED` re-enqueues (`Engine-TS/src/engine/World.ts:541-557`). Everything else returned there is dropped (`FINISHED`, `ABORTED`, and also `PAUSEBUTTON`/`COUNTDIALOG`, for which no branch exists at `World.ts:548-557`; whether content can reach that is not checked).

### 1.4 What resumes each state, and when

8. Complete list of resume sites. Grep of `Engine-TS/src` for `execution ===`/`execution !==` finds exactly these readers (plus the abandon sites in Part 1.7):

   | State | Resumed by | Tick phase | Condition | Source |
   |---|---|---|---|---|
   | `SUSPENDED` | `processPlayers` step 2: `player.executeScript(player.activeScript, true, true)` | phase 5, step 2 (after the undelay at step 1, before the queues) | `!player.delayed` and `activeScript.execution === SUSPENDED` | `Engine-TS/src/engine/World.ts:692-697` |
   | `PAUSEBUTTON` | `ResumePauseButtonHandler` (client packet `RESUME_PAUSEBUTTON`) | phase 2 (packet decode) | `activeScript.execution === PAUSEBUTTON` | `Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:7-13` |
   | `PAUSEBUTTON` | `IfButtonHandler` (client packet `IF_BUTTON`) | phase 2 | clicked component is in `player.resumeButtons` **and** `activeScript.execution === PAUSEBUTTON` | `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:24-29` |
   | `COUNTDIALOG` | `ResumePCountDialogHandler` (client packet `RESUME_P_COUNTDIALOG`) | phase 2 | `activeScript.execution === COUNTDIALOG`; it first stores `lastInt = input` | `Engine-TS/src/network/game/client/handler/ResumePCountDialogHandler.ts:10-15` |
   | `NPC_SUSPENDED` | `Npc.turn()` top: `this.executeScript(this.activeScript)` | phase 4 (NPC's turn, before lifecycle, hunt, timer and queue) | NPC `isActive`, `!delayed` after the undelay line, `execution === NPC_SUSPENDED` | `Engine-TS/src/engine/entity/Npc.ts:109-118` |
   | `WORLD_SUSPENDED` | `processWorld` world-queue pass: `ScriptRunner.execute(script)` | phase 1 | entry's post-decremented delay `<= 0` (01 rule 4) | `Engine-TS/src/engine/World.ts:535-557` |

   The three player resume packets are bound to their handlers in `Engine-TS/src/network/game/client/ClientGameProtRepository.ts:163-164`, and `IfButtonHandler` at `:113`. Packet-level details (which phase decodes them, per-tick packet limits) are in `docs/tick/02-clients-in.md` rule 15.

9. All three player resume paths call `executeScript(activeScript, true, true)`: `protect = true, force = true`. `force` skips the refusal test in `runScript` (`!force && protect && (this.protect || this.delayed)`, `Engine-TS/src/engine/entity/Player.ts:2171-2176`), so a `PAUSEBUTTON` dialogue resumes even if the player is `delayed` (05 rule 6; `docs/tick/02-clients-in.md` rule 15).

10. The `SUSPENDED` state is only ever produced by `p_delay`/`p_arrivedelay`, which set `delayed` on the same player (grep of `Engine-TS/src/engine/script/handlers` for `ScriptState.SUSPENDED`: `PlayerOps.ts:366,379`). So a `SUSPENDED` script is always waiting on a time, never on a client event; `PAUSEBUTTON`/`COUNTDIALOG` are always waiting on a client event, never on time (nothing in `processPlayers` resumes them; see 05 rule 5).

### 1.5 Delay arithmetic (`p_delay`, `npc_delay`, `world_delay`)

11. Player. `p_delay(n)` called in tick T sets `delayedUntil = T + 1 + n` (`PlayerOps.ts:378`). The only line that clears a player's `delayed` by time is at the top of the player's phase-5 turn: `if (player.delayed && this.currentTick >= player.delayedUntil) player.delayed = false;` (`Engine-TS/src/engine/World.ts:692`), immediately followed by the resume (`World.ts:695-697`). `currentTick` is incremented once per cycle after phase 11 (`Engine-TS/src/engine/World.ts:503`; 05 rule 4).
    - **Inference (from those facts, not observed):** the script resumes in phase 5, step 2 of tick **T + 1 + n**, regardless of which phase called `p_delay`. So `p_delay(0)` = resume next tick; `p_delay(2)` = resume 3 ticks later. This is also 05 "Inferences" first bullet.
    - During the ticks in between (T through T+n inclusive) the player is `delayed`: phase 2 refuses move and op packets (Part 1.6), the per-entry gate `canAccess()` is false so no queue entry, normal timer or engine-queue entry runs, soft timers still run (05 rules 8, 14, 17).

12. NPC. `npc_delay(n)` in tick T sets `delayedUntil = T + 1 + n` (`NpcOps.ts:99`); the NPC's phase-4 turn undelays with the same comparison and resumes (`Npc.ts:112-117`). **Inference:** resume in phase 4 of tick T + 1 + n. Same as 04 "Inferences" first bullet. `npc_arrivedelay` is the exception: T+1 or T+2 depending on `lastMovement` (`NpcOps.ts:558-567`).

13. World. `world_delay(d)` stores `delay + 1` (`World.ts:1250`) and `processWorld` post-decrements and runs when the old value is `<= 0` (`World.ts:536-540`), so an entry runs on visit d+2. **Inference:** a `world_delay(d)` executed in tick T in phase 2 or later resumes in phase 1 of tick T+d+2 (01 rule 4 and its Inferences; the conflicting comment about `necromancer_tower.rs2` is discussed there and still open).

### 1.6 What the player can and cannot do while the script is waiting

14. **While `delayed` (a `SUSPENDED` script waits).** Source-verified gates:
    - Move click: `MoveClickHandler` starts with `if (player.delayed) { player.write(new UnsetMapFlag()); return false; }` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:12-15`); the same early return exists in every `Op*` handler and in `OpHeld`, `InvButton` (grep of `network/game/client/handler/*.ts` for `delayed`, e.g. `OpLocHandler.ts:14-15`, `OpHeldHandler.ts:16-18`, `OpNpcHandler.ts:16-17`). `OpNpc*` additionally refuses a *delayed NPC* (`OpNpcHandler.ts:27-31`).
    - Pending walking: `processClientsIn` also drops a pending `userPath`/`opcalled` if delayed (`Engine-TS/src/engine/World.ts:617-622`).
    - Scripts: `tryInteract` returns false without `canAccess()` (`Engine-TS/src/engine/entity/Player.ts:1161`), queues/normal timers/engine queue are gated per entry by `canAccess()` (`Player.ts:904,919,663,297` via 05 rule 8).
    - **Not blocked:** `IfButtonHandler` has no `delayed` check, so a button click that is a resume-button for a `PAUSEBUTTON` script still resumes it (`IfButtonHandler.ts:24-29`); other `IF_BUTTON` scripts run if the interface is an overlay (`protect = root.overlay == false`, `IfButtonHandler.ts:30-34`). Already-queued waypoints are still walked (06 Inferences, "a delayed or busy player keeps walking queued waypoints"; not observed).
    - `delayed` is cleared in phase 5, after phase 2 of the same tick, so in the tick in which the script resumes, the phase-2 packets of that tick were still refused (`World.ts:692` vs `World.ts:617-622`; `docs/tick/02-clients-in.md` rule 15 last bullet).

15. **While a dialogue waits (`PAUSEBUTTON`/`COUNTDIALOG`).** The player is *not* `delayed`. What blocks queued work is the open chat modal: `p_pausebutton` itself does nothing but set the state (`PlayerOps.ts:425-427`), but the content procs call `if_openchat(...)` first (Part 1.8), and `openChatModal` sets `modalState |= ModalState.CHAT` (`Engine-TS/src/engine/entity/Player.ts:2046`). `busy()` is `delayed || containsModalInterface()` with `MAIN | CHAT` (`Player.ts:816-823`), and `canAccess()` is `!protect && !busy()` (`Player.ts:825-832`). So while a chat dialogue is open: queue entries, normal timers and the engine queue wait (their delay counters still tick down, 05 rule 11), soft timers still run, and move/op packets are *accepted* (they are not `delayed`) and then close the dialogue (Part 1.7).

### 1.7 What ends or abandons a waiting script

16. **`closeModal()` drops a waiting dialogue script.** Source: `Engine-TS/src/engine/entity/Player.ts:760-778`
    ```abbrevts
    closeModal(clearWeakQueue: boolean = true) {
        if (clearWeakQueue) { this.weakQueue.clear(); }
        if (!this.delayed) { this.protect = false; }
        if (this.modalState === ModalState.NONE) { return; }
        this.modalState = ModalState.NONE;
        // close any input dialogue suspended scripts.
        if (this.activeScript?.execution === ScriptState.COUNTDIALOG || this.activeScript?.execution === ScriptState.PAUSEBUTTON) {
            this.activeScript = null;
            this.resumeButtons = [];
        }
   ```
   (blank lines and comments elided in the first lines). Facts:
    - Only `COUNTDIALOG`/`PAUSEBUTTON` scripts are dropped. A `SUSPENDED` (delayed) script is not touched by `closeModal`.
    - The drop only happens if `modalState !== NONE` at entry (the early `return` at `:768-770` comes first). A `PAUSEBUTTON` script waiting without any open modal would survive a `closeModal()`.
    - Dropping = `activeScript = null`. Nothing else references that `ScriptState` (it is not in any queue), so it simply is never resumed again. No cleanup script runs for it; the `IF_CLOSE` trigger of the closed interface (if the content defines one) is run separately, unprotected (`Player.ts:781-811`).
    - It also clears the **weak queue** (default argument) and, if not delayed, `protect` (`Player.ts:761-766`).

17. **Callers of `closeModal()` (i.e. how a dialogue gets abandoned).** From 05 rule 10-12, re-verified:
    - Walking/clicking: `MoveClickHandler` calls `player.clearPendingAction()` for a non-op-click move (`MoveClickHandler.ts:30-32`) and `clearPendingAction()` = `clearInteraction()` + `closeModal()` (`Player.ts:970-973`). Op packets do the same (06 / 02 rule 16). `OpHeldHandler` only if the item's interface is not the open main modal (`OpHeldHandler.ts:54-56`). So **walking away from an NPC mid-conversation abandons the script** (this requires the player to be not delayed, which a dialogue does not make it).
    - The server `if_close` command: `state.activePlayer.closeModal()` (`PlayerOps.ts:246-248`). Also `p_stopaction`/`p_clearpendingaction` (`PlayerOps.ts:430-437`).
    - The `CLOSE_MODAL` packet: sets `requestModalClose = true` (`Engine-TS/src/network/game/client/handler/CloseModalHandler.ts:13`), consumed in phase 5 step 3 by `processQueues` (`Player.ts:874-885`); also set whenever a `STRONG` entry sits in the normal queue (`Player.ts:876-881`).
    - Opening another modal: `openMainModal`, `openChatModal`, `openSideModal`, `openMainSideModal` each end with "clear old suspended scripts" for `COUNTDIALOG`/`PAUSEBUTTON` (`Player.ts:2014-2018`, `:2050-2054`, `:2074-2078`, `:2100-2104`). `openMainModal` itself starts at `:1995`.
    - Logout: `processLogouts` calls `player.closeModal()` when `loggingOut` and the prevent-logout window has passed (`Engine-TS/src/engine/World.ts:764-765`).

18. **Why a running dialogue does not drop itself when it opens the next page.** While the script is executing after a resume, `Player.activeScript` still points at the same `ScriptState` (nothing sets it to null at resume: grep of `activeScript = null` in `Engine-TS/src/engine/entity/Player.ts` finds only `:452,776,2016,2052,2076,2102,2221`, none on the resume path). But `ScriptRunner.execute` has already set `execution = RUNNING` (`ScriptRunner.ts:130`), so the "clear old suspended scripts" tests in `openChatModal` (`Player.ts:2050-2054`) do not match the script that is calling `if_openchat`. They only match an *older, different* waiting dialogue script. (Fact chain; not observed.)

19. **Normal end.** `FINISHED` or `ABORTED` for the script that is `activeScript`: clear `activeScript` and `resumeButtons`, and if no `MAIN` modal is open, `closeModal(false)`, which closes the chat dialogue but keeps the weak queue (`Player.ts:2220-2228`). An error inside a resumed script (`ABORTED`) takes the same branch, so the script is abandoned (and in production the player is logged out, `ScriptRunner.ts:203-206`).

20. **Player removal.** `World.removePlayer` ends with `player.cleanup()` (`Engine-TS/src/engine/World.ts:1618`), which sets `activeScript = null`, empties `resumeButtons`, and clears `queue`, `weakQueue`, `engineQueue` and `timers` (`Engine-TS/src/engine/entity/Player.ts:449-468`). So a `SUSPENDED` script that has not resumed by then is never resumed. But `processLogouts` only removes a player when `player.canAccess()`, the engine queue is empty and the queue holds only discardable `LONG` entries (`World.ts:764-791`; 05 rule 19, 07 rules 6-7), and `canAccess()` is false while `delayed`; so in ordinary logouts the delayed player's script gets to resume first (phase 5 runs before phase 6 each tick). During `World.shutdown`, `canAccess()` is true regardless (`Player.ts:826-828`) and `force` is set (`World.ts:744-747`), so a delayed script can be dropped (05 Inferences "during `World.shutdown`...").
    - The `LOGOUT` trigger script is run with `ScriptRunner.execute(state)` and the return value is discarded (`World.ts:786-790`), so a suspension inside it would be lost (the script is not stored anywhere). Whether content's logout script suspends: not checked.

21. **NPC removal.** `Npc.cleanup()` and the respawn reset set `activeScript = null` and clear the queue and `delayed` (`Engine-TS/src/engine/entity/Npc.ts:194-202`, `:295-306`). `World.removeNpc` calls `cleanup()` only for `DESPAWN` NPCs; a `RESPAWN` NPC (`npc_del` on a normal NPC) just becomes inactive (`Engine-TS/src/engine/World.ts:1307-1334`). `Npc.turn` only resumes while `isActive` (`Npc.ts:111`). `removeNpc` does not touch the running script, which keeps executing after `npc_del` (see Example 6).

22. **Other paths where a suspension is lost** (return value ignored): the player `processWalktrigger` uses `runScript` and ignores the result (`Player.ts:1108-1117`); NPC `walktrigger` and hunt `findNewMode` queue scripts use `ScriptRunner.execute` with the result ignored (`Engine-TS/src/engine/entity/Npc.ts:360-368`, `:970-978`). A `p_delay`/`npc_delay` inside them sets `delayed` but nothing stores the script, so it never resumes (06 Inferences; 04 Inferences; not observed).

23. **One slot only.** `Player.activeScript` is a single field assigned without a check (`Player.ts:2217`). **Inference:** if a second script suspends on the same player while another is still stored, the earlier `ScriptState` is overwritten and lost. This should be rare because protected scripts cannot start while `delayed` or while a chat modal is open (`canAccess`), but unprotected scripts (soft timers, `IF_CLOSE` scripts, overlay `IF_BUTTON` scripts) can run and whether they can call `p_delay` is open (`docs/open-questions.md` #30).

### 1.8 How content builds dialogues from `p_pausebutton`

24. The dialogue "commands" `~chatnpc`, `~chatplayer`, `~mesbox`, `~objbox`, `~p_choice2..5` are ordinary RuneScript **procs** in `Content/scripts/interface_chat/scripts/chat.rs2` (not engine commands). Each page is: fill interface text, `if_openchat(<interface>)`, `p_pausebutton`, then loop to the next page.
    - `~chatplayer` (`Content/scripts/interface_chat/scripts/chat.rs2:271-279`):
      ```
      271 [proc,chatplayer](string $string)
      272 split_init($string, 380, 4, q8_full);
      273 def_int $page = 0;
      274 def_int $pagetotal = split_pagecount;
      275 while ($page < $pagetotal) {
      276     ~chatplayer_page($page);
      277     p_pausebutton;
      278     $page = calc($page + 1);
      279 }
      ```
      and `chatplayer_page` ends with `if_openchat($interface);` (`chat.rs2:269`).
    - `~chatnpc` additionally does `facesquare(npc_coord);` and `npc_setmode(playerfaceclose)` (unless the NPC is in `opplayer2`/`applayer2` mode) before `p_pausebutton` (`chat.rs2:323-333`). `~mesbox` is the same with no head (`chat.rs2:439-447`).
    - `~p_choice2` (`chat.rs2:1-16`): sets text, `if_openchat(multi2)`, then `if_addresumebutton(multi2:com_1); if_addresumebutton(multi2:com_2); p_pausebutton;` then `switch_component (last_com)` returns the value paired with the clicked button. `if_addresumebutton` pushes the component id onto `player.resumeButtons` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:832-836`); `last_com` pushes `player.lastCom` (`PlayerOps.ts:250-252`), which `IfButtonHandler` sets just before it resumes (`IfButtonHandler.ts:24`).
    - Number input: `p_countdialog` then `last_int` (`chat.rs2:741-743` `case skill_multi2:makex_a : p_countdialog; return($obj1, last_int);`). `last_int` pushes `state.lastInt` (`PlayerOps.ts:256-258`), which `ResumePCountDialogHandler` set from the packet (`ResumePCountDialogHandler.ts:14`).
    - `if_openchat` handler: `state.activePlayer.openChatModal(...)` (`PlayerOps.ts:655-657`) which sets `modalState |= CHAT`, `modalChat = com`, `refreshModal = true` (`Player.ts:2046-2048`). This answers the question left open in 05 "Not checked" (whether dialogue commands open a chat modal): **yes, via the content procs**.

25. Client side of the resume (read at Client-TS `7d6ca61`): the "click here to continue" action (`MiniMenuAction.PAUSE_BUTTON`) sends `ClientProt.RESUME_PAUSEBUTTON` (id 72) and the component id, at most once until `resumedPauseButton` is reset (`Client-TS/src/client/Client.ts:9190-9196`; `Client-TS/src/io/ClientProt.ts:75`). Pressing Enter in the number-input box sends `RESUME_P_COUNTDIALOG` (id 102) with a 4-byte value (`Client.ts:3033-3044`; `ClientProt.ts:77`). Which client action produces `IF_BUTTON` instead for the `multi2`-style choice buttons was not traced (the engine side that handles it is `IfButtonHandler.ts:24-29`).

---

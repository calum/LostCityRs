# Chapter 7: Pottery wheel, a skill loop that re-arms itself with `weakqueue*`

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** How does "use soft clay on the wheel, make 10" produce ten items over many ticks without any `p_delay`, timer or `p_oploc`, what exactly keeps the loop alive, and what stops it?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed. Compare the woodcutting loop, which re-arms through `p_oploc` and the interaction system ([`flows/click-loc-woodcutting.md`](../../flows/click-loc-woodcutting.md)).

## 3.1 The scripts

Use soft clay on the wheel, then the choose-and-repeat chain:

```
// Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:15-20
  15  switch_obj (last_useitem)
  16  {
  17      case softclay : @craft_pottery_interface;
  18      case clay : ~objbox(clay, "This clay is too hard to craft|You'll need to soften it with some water.", 250, 0, divide(^objbox_height, 2));
  19      case default : ~displaymessage(^dm_default);
  20  }
```

```
// Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:62-66
  62  $item, $count = ~skill_multi3(
  63      pot_unfired, 0, 2, 185, "\\n\\n\\n\\nPot",
  64      piedish_unfired, 0, -4, 190, "\\n\\n\\n\\nPie Dish",
  65      bowl_unfired, 0, 0, 200, "\\n\\n\\n\\nBowl"
  66  );
```

```
// Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:80-101
  80  [label,process_craft_pottery](namedobj $item, struct $struct, string $name, int $level, int $count)
  81  sound_synth(pottery, 1, 0);
  82  anim(human_potterywheel, 0);
  83  if (%action_delay < map_clock) {
  84      %action_delay = add(map_clock, 2);
  85  }
  86  weakqueue*(craft_pottery, sub(%action_delay, map_clock))($item, $struct, $name, $level, $count);
  87  
  88  [queue,craft_pottery](namedobj $item, struct $struct, string $name, int $level, int $count)
  89  if(inv_total(inv, softclay) = 0) {
  90      mes("You have run out of soft clay.");
  91      return;
  92  }
  93  inv_del(inv, softclay, 1);
  94  inv_add(inv, $item, 1);
  95  stat_advance(crafting, struct_param($struct, processexp));
  96  mes("You make the clay into a <substring($name, 8, string_length($name))>.");
  97  if(sub($count, 1) < 1) {
  98      return;
  99  }
 100  %action_delay = add(map_clock, 2);
 101  @process_craft_pottery($item, $struct, $name, $level, sub($count, 1));
```

The "how many / which" chat interface used by `~skill_multi3` (shared by all skills) and its close hook:

```
// Content/scripts/interface_chat/scripts/chat.rs2:827-834
 827  if_addresumebutton(skill_multi3:makex_c);
 828  p_pausebutton;
 829  
 830  def_component $last_com = last_com;
 831  if(%weakqueue_map_clock = map_clock) {
 832      if_close;
 833      p_delay(0);
 834  }
```

```
// Content/scripts/interface_chat/scripts/chat.rs2:1106-1109
1106  [if_close,skill_multi3]
1107  if(p_finduid(uid) = true) {
1108      %weakqueue_map_clock = map_clock;
1109  }
```

The oven's version of the same pattern (a three-script weak-queue cycle):

The three scripts are `weakqueue*(process_fire_pottery, ...)` at `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:121`, `[queue,process_fire_pottery]` (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:123-136`: check item, anim, `%action_delay = add(map_clock, 5)`, then `weakqueue*(fire_pottery, sub(%action_delay, map_clock))`) and `[queue,fire_pottery]` (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:138-153`: `inv_del`, success roll, product, then `%action_delay = add(map_clock, 1)` and `weakqueue*(process_fire_pottery, 0)(...)` at `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:152-153`).

## 3.2 Walkthrough

1. **Click the wheel with soft clay** (`[oplocu,_potters_wheel]`, `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:8-20`). The use-on-loc script runs in the interaction step of phase 5 (protected, `Engine-TS/src/engine/entity/Player.ts:1160-1176`) and calls `@craft_pottery_interface`.
2. **The choice dialogue suspends the script.** `~skill_multi3` opens a CHAT modal (`if_openchat`, `Content/scripts/interface_chat/scripts/chat.rs2:802`), registers resume buttons (`if_addresumebutton` pushes the component id onto `player.resumeButtons`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:832-836`) and stops at `p_pausebutton` (`Content/scripts/interface_chat/scripts/chat.rs2:828`). The script is the player's `activeScript` in `PAUSEBUTTON` state (E3). From now on `busy()` is true (E4) but the weak queue is still empty.
3. **The click on a quantity button** arrives as `IF_BUTTON`; because the component is in `resumeButtons` and `activeScript` is `PAUSEBUTTON`, `IfButtonHandler` resumes it with `executeScript(active, true, true)` in **phase 2** (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:24-29`). (The "X" option calls `p_countdialog` first: `COUNTDIALOG`, resumed by `ResumePCountDialogHandler`, `Engine-TS/src/network/game/client/handler/ResumePCountDialogHandler.ts:6-17`.)
4. **Back in the script, still in phase 2:** `switch_component (last_com)` returns `(item, count)` (chat.rs2 `skill_multi3` return values), the level is checked, then `@process_craft_pottery`: sound and `anim` immediately, and
   ```
   if (%action_delay < map_clock) { %action_delay = add(map_clock, 2); }
   weakqueue*(craft_pottery, sub(%action_delay, map_clock))($item, $struct, $name, $level, $count);
   ```
   (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:83-86`). `weakqueue*` appends a `WEAK` `PlayerQueueRequest` with those args and the computed delay (E7). The script then ends; `executeScript` clears `activeScript` and calls `closeModal(false)` because no MAIN modal is open (E3). `closeModal(false)` leaves the weak queue alone but runs the `[if_close,skill_multi3]` script (`Content/scripts/interface_chat/scripts/chat.rs2:1106-1109`), which records `%weakqueue_map_clock = map_clock`.
5. **The loop body is a `[queue,craft_pottery]` script** (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:88-101`): check clay left, swap one soft clay for the product, `stat_advance`, message, stop if `$count` is used up, otherwise set `%action_delay = map_clock + 2` and `@process_craft_pottery(..., $count - 1)` - which plays the animation and enqueues the next `craft_pottery` weak entry with delay `%action_delay - map_clock` = 2. That enqueue is what keeps the loop going. There is no timer and no suspended script: each iteration is a fresh `ScriptState` created from the stored `ScriptFile` and args (`Engine-TS/src/engine/entity/Player.ts:916-926`).
6. **Stopping.** Four things end it: the count reaches 0, the soft clay runs out (message and `return` without re-enqueueing, `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:89-92`), a `closeModal()` with the default argument empties the weak queue (E6), or the player logs out (phase 6 calls `closeModal()` before removal, `Engine-TS/src/engine/World.ts:765`, and only `queue`, not `weakQueue`, is inspected for removability, `Engine-TS/src/engine/World.ts:766-779`).

## 3.3 Tick timeline (T = tick of the quantity-button click, phase 2)

| tick | phase / step | what happens | source |
|---|---|---|---|
| Tw (earlier) | 5/8 | Wheel op script; dialogue open (CHAT modal), `activeScript = PAUSEBUTTON`, `protect = true` for the rest of Tw. | E3, E4 |
| T | 2 | Button click resumes the script with `force`; `weakqueue*(craft_pottery, 2)` appends entry A (delay 2); script ends, chat closed by `closeModal(false)`, weak queue kept. | `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:24-29`, E3, E7 |
| T | 5/3d | `processQueues` -> `processWeakQueue`: A is visited, post-decrement: pre-value 2 (> 0), A.delay := 1. | `Engine-TS/src/engine/entity/Player.ts:916-926` |
| T+1 | 5/3d | pre-value 1, A.delay := 0. | same |
| T+2 | 5/3d | pre-value 0 and `canAccess()` -> A unlinked and run (protected): one item made. Its script appends entry B (delay 2). A was the **last node** of the weak list, so the cached cursor is the sentinel and B is **not visited this tick** (E7). | `Engine-TS/src/engine/entity/Player.ts:916-926`, `Engine-TS/src/datastruct/LinkList.ts:47-55,67-75` |
| T+3 | 5/3d | B: pre-value 2, B.delay := 1. | |
| T+4 | 5/3d | pre-value 1, B.delay := 0. | |
| T+5 | 5/3d | B runs: second item; enqueues C. | |
| ... | | one item every 3 ticks (inference below) until `$count` is 1 at the last run, or something clears the weak queue. | |
| Tx | 2 | Player clicks to walk or operates something: `MoveClickHandler`/`OpNpcHandler` -> `clearPendingAction()` -> `closeModal()` -> `weakQueue.clear()`. The pending entry disappears; no further iterations; no message. | E6, `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32` |

## 3.4 What persists between ticks

- In the weak queue entry: the `ScriptFile` and an args array `[item, struct, name, level, count]` (`PlayerQueueRequest`, `Engine-TS/src/engine/entity/Player.ts:841-851`). The loop counter lives only in the `$count` argument of the next entry.
- `%action_delay` (temp varp declared in the 225 dump, `Content/scripts/_unpack/225/all.varp:80`, no scope line) is written by this loop (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:84`, `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:100`) and also by woodcutting (`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:55-59`, `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:108-109`) and many other scripts (`grep -rl action_delay Content/scripts --include=*.rs2` finds 84 files in total, including these two). It is only a number read at enqueue time as `%action_delay - map_clock`, so a recent action by another skill makes the *first* delay longer than 2.
- Nothing is stored on the player's `activeScript` or `delayed` between iterations: the player is free to do anything that does not close modals.

## 3.5 What interrupts it / what the player can do meanwhile

- **Interrupts (clears the weak queue silently):** any accepted `MOVE_GAMECLICK`/op packet (phase 2, `clearPendingAction`, `Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32`, `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:47`); `if_close` or the `CLOSE_MODAL` packet (via `requestModalClose` in `processQueues`, `Engine-TS/src/engine/entity/Player.ts:874-886`); a director/NPC script calling `if_close` on the player (chapter 2 does this to a player at the stage); logout (`Engine-TS/src/engine/World.ts:765`).
- **Not determined here:** whether item (OPHELD), interface-button, chat and other packet handlers call `clearPendingAction()`; only the move and NPC-op handlers were read. A MAIN or CHAT modal opened *without* an op/move packet (e.g. a script opening one) blocks the loop (`canAccess()` false, E4) without clearing it: the entry keeps counting down and runs on the first accessible visit (E7).
- A `MOVE_OPCLICK` does not clear the weak queue in `MoveClickHandler` (`Engine-TS/src/network/game/client/handler/MoveClickHandler.ts:30-32` skips `clearPendingAction` for op-clicks), but the paired op packet does (`Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:47`; the loc/obj handlers were not read).

## 3.6 Gotchas verified in code

1. **First-iteration timing vs later iterations differ.** An entry enqueued in phase 2 (before the phase-5 pass) with delay d runs at T+d; an entry enqueued from inside the weak pass, when the running entry was the last node, runs at (its enqueue tick) + d + 1 (E7; 05#22 row "Step 3d"). The script's own arithmetic (`%action_delay = map_clock + 2`) assumes d ticks.
2. **`weakqueue*` delay may be negative.** `sub(%action_delay, map_clock)` is negative when `%action_delay` is in the past; the engine does no range check on the delay (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:135-146`) and the counter treats `<= 0` as due (`Engine-TS/src/engine/entity/Player.ts:918-919`), so it behaves like 0 (05#11).
3. **The `if_close` hook uses `p_finduid(uid)`**, which returns 0 unless the player passes `canAccess()` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:78-96`). When the modal is closed by a finishing script (`executeScript` -> `closeModal(false)`) the player is accessible at that point (`runScript` has already reset `protect`, `Engine-TS/src/engine/entity/Player.ts:2171-2187`), so the hook sets `%weakqueue_map_clock`. When the modal is closed from inside a still-running protected script (e.g. its own `if_close`), `protect` is true and the hook does nothing. What the guard at `Content/scripts/interface_chat/scripts/chat.rs2:831-834` (`if(%weakqueue_map_clock = map_clock) { if_close; p_delay(0); }`) is for is not determined by the code read (open question).
4. **A dialogue-driven loop and a queue-driven loop use different resume paths.** The choice is resumed by a phase-2 packet with `force`, the iterations by phase-5 step 3 with normal protected access (`executeScript(script, true)`), so an iteration cannot run while a dialogue is open and the player cannot be delayed (`p_delay`) between iterations unless the queue script itself calls it (these do not).
5. **`updateMovement` refuses to walk when a modal is open and the *normal* or engine queue is non-empty** (`Engine-TS/src/engine/entity/Player.ts:674-678`); the weak queue is not part of that test, so a pending weak entry never blocks walking. (Walking then clears it anyway, as above.)
6. **Oven variant: `fire_pottery` re-enqueues `process_fire_pottery` with delay 0** (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:153`). Delay 0 and the last-node rule means "next tick", not "this tick" (E7).

## 3.7 Inferences (labelled)

- **Inference: the wheel produces one item every 3 ticks, not 2.** Facts: delay is 2 (`Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:84`, `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:86`, `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:100-101`); the loop entry is enqueued from inside `processWeakQueue` by the last (only) entry, so its first visit is next tick (E7, `Engine-TS/src/engine/entity/Player.ts:892-896` comment, `Engine-TS/src/datastruct/LinkList.ts:67-75`); an entry with delay 2 runs on its third visit. Result: runs at T+2, T+5, T+8, ... If another weak entry sat behind the running one (not the case here) the new entry would be visited in the same pass and the cadence would be 2. Not observed; this is the kind of value `docs/open-questions.md` #10 asks to measure. The content author's comment style (`// 2 ticks`) suggests 2 was intended, but intent is not checkable.
- **Inference: the oven cycle is 7 ticks per item**: `process_fire_pottery` runs at tick a, sets `%action_delay = a+5`, enqueues `fire_pottery` with delay 5 (last node, first visit a+1, runs a+6); `fire_pottery` enqueues `process_fire_pottery` with delay 0 (first visit a+7, pre-value 0, runs a+7). Rests on `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:123-153` and E7.
- **Inference: the loop survives lag and busy states but not input.** Rests on E4 (blocked entries keep counting and run overdue), E6 (any accepted move/op clears), and E7.

## 3.8 Not checked / open questions

- Loc/obj/item op handlers (`OpLocHandler` etc.) were not read; only `MoveClickHandler` and `OpNpcHandler` were. Whether each of them calls `clearPendingAction()` was not verified here (05#12 and 02#16 list it for the move and op handlers).
- The purpose of the `%weakqueue_map_clock` guard in `~skill_multi*`.
- `~skill_multi3` client rendering, `stat_random`, `inv_*` behaviour; the `anim` mask delay semantics.
- Crafting at the furnace or tanning (other `weakqueue*` users) were not read; they may differ.
- Nothing was run: the 3-tick cadence is a calculation.

---

# Chapter 6: Random event, the Mime (an NPC timer as a shared state machine)

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** How does the Mime event keep many players in step with one performing NPC across 32-tick cycles, and what happens, tick by tick, when a player answers an emote?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed.

## 2.1 The scripts

Entry from the old man (chapter 1; `^macro_mime` = 7, `Content/scripts/macro events/configs/macro_events.constant:10`; the old-man side is `macro_event_mysterious_old_man.rs2:12-18`) and the zone triggers:

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:9-18
   9  [proc,mime_entry_point]
  10  %macro_event_target_coord = coord;
  11  p_teleport(0_31_74_24_28);
  12  ~macro_events_set_tabs; //Was not originally in mapzone trigger I think. https://www.youtube.com/watch?v=ROQJPpb7Qrc
  13  ~chatnpc("<p,neutral>You need to copy the mime's performance,|then you'll be returned to where you were."); // https://i.imgur.com/wkPd7aY.png
  14  
  15  // Enter map trigger: 
  16  [mapzone,0_31_74]
  17  %macro_event = ^macro_mime;
  18  def_int $count = divide(modulo(map_clock, multiply(16,2)), 2);
```

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:35-41
  35  mes("You need to copy the mime's performance, then you'll return to where you were.");
  36  @music_playbyregion(coord);
  37  
  38  // Exit map trigger: restore tabs
  39  [mapzoneexit,0_31_74]
  40  ~initalltabs;
  41  ~macro_events_varps_reset;
```

The NPC's timer (the "director"):

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:43-62
  43  [ai_timer,macro_mime]
  44  def_int $count = divide(modulo(map_clock, multiply(16,2)), 2);
  45  if($count = 0) {
  46      npc_facesquare(movecoord(npc_coord, 0, 0, -1));
  47      if (loc_find(0_31_74_23_25, macro_spotlight) = true) {
  48          loc_anim(macro_spotlight_off);
  49      }
  50      if (loc_find(0_31_74_26_25, macro_spotlight) = true) {
  51          loc_anim(macro_spotlight_on);
  52      }
  53      huntall(0_31_74_24_28, 1, 0);
  54      while(huntnext = true) {
  55          if_close();
  56          queue(mime_step_right_up, 0, 0);
  57      }
  58      huntall(0_31_74_24_26, 1, 0);
  59      while (huntnext = true) {
  60          if_close();
  61      }
  62  }
```

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:63-66
  63  if($count = 1) {
  64      %npc_int = random(8);
  65      switch_int(%npc_int) {
  66          case 0 : npc_anim(emote_cry, 0);
```

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:76-95
  76  if($count = 4) {
  77      npc_anim(emote_bow, 0);
  78      npc_facesquare(movecoord(npc_coord, -1, 0, 0));
  79      if (loc_find(0_31_74_23_25, macro_spotlight) = true) {
  80          loc_anim(macro_spotlight_on);
  81      }
  82      if (loc_find(0_31_74_26_25, macro_spotlight) = true) {
  83          loc_anim(macro_spotlight_off);
  84      }
  85      huntall(0_31_74_24_26, 1, 0);
  86      while (huntnext = true) {
  87          if_openchat(macro_mime_emotes);
  88      }
  89  
  90  }
  91  npc_settimer(2); // Called every 2 ticks
  92  
  93  
  94  [queue,mime_step_right_up]
  95  if(coord = 0_31_74_24_28) p_teleport(movecoord(coord, 0, 0, -2));
```

The player's answer:

The eight button triggers are one-liners of the form `[if_button,macro_mime_emotes:com_2] @mime_random_emote(emote_cry,0);` (`Content/scripts/macro events/scripts/general/macro_event_mime.rs2:99-106`), each calling this label:

```
// Content/scripts/macro events/scripts/general/macro_event_mime.rs2:109-144
 109  [label,mime_random_emote](seq $anim, int $num)
 110  if_close;
 111  anim($anim, 0);
 112  
 113  def_int $curr_emote = random(8);
 114  if (npc_find(0_31_74_27_26, macro_mime, 1, 0) = true) {
 115      $curr_emote = %npc_int;
 116  }
 117  
 118  if ($num = $curr_emote) {
 119      p_delay(4);
 120      anim(emote_cheer, 0);
 121      // https://www.youtube.com/watch?v=Y0AsFEr6sxY 4 correct in a row to leave
 122      // https://www.youtube.com/watch?v=yWcG5T3KEUQ 4 correct in a row to leave
 123      switch_int(%macro_event) {
 124          case ^macro_mime : %macro_event = ^macro_mime_solve_1;
 125          case ^macro_mime_solve_1 : %macro_event = ^macro_mime_solve_2;
 126          case ^macro_mime_solve_2 : %macro_event = ^macro_mime_solve_3;
 127          case ^macro_mime_solve_3 :
 128          // Return where you are from
 129          p_delay(4);
 130          ~macro_return_teleport;
 131          def_int $rand = random(2);
 132          if($rand = 0 & ~has_all_mime_emotes = false) {
 133              ~unlock_mime_emote;
 134          } else if($rand = 1 & ~has_full_mime_outfit = true & ~has_all_mime_emotes = false) {
 135              ~unlock_mime_emote;
 136          } else {
 137              inv_add(inv, ~macro_mime_reward);
 138          }
 139      }
 140  } else {
 141      p_delay(4);
 142      anim(emote_cry, 0);
 143      %macro_event = ^macro_mime;
 144  }
```

Solve counter constants: `^macro_mime = 7`, `^macro_mime_solve_1..3 = 100..102` (`Content/scripts/macro events/configs/macro_events.constant:10-13`).

## 2.2 Walkthrough

1. **Entry.** The old man's mime case: `npc_say`, `p_delay(1)`, `npc_del`, `%macro_event = ^macro_mime`, `~mime_entry_point` (`Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:12-18`). `mime_entry_point` saves the return coordinate in the perm varp `%macro_event_target_coord`, `p_teleport(0_31_74_24_28)`, hides tabs and opens a chat dialogue (`Content/scripts/macro events/scripts/general/macro_event_mime.rs2:9-13`) - a `PAUSEBUTTON` suspension (E3). The `[mapzone,0_31_74]` trigger (an engine-queue script, E9) then sets `%macro_event = ^macro_mime` again, flips the two spotlight locs according to `map_clock`, sends a message. It waits until the dialogue is closed (E4).
2. **The performer.** The Mime NPC is a static spawn: `Content/maps/m31_74.jm2:1199` is `0 27 26: 1056`, and `Content/pack/npc.pack:1057` names id 1056 `macro_mime` (the script itself looks for it at `0_31_74_27_26`, `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:114`). Its `ai_timer` is the director. Each firing computes `$count = divide(modulo(map_clock, 32), 2)`, i.e. 0..15 over a 32-tick cycle, and ends with `npc_settimer(2)` so it fires every 2 ticks (`Engine-TS/src/engine/entity/Npc.ts:550-559` clock resets after the script; E11). Because the interval is 2 and the count divides by 2, every `$count` value is reached exactly once per 32 ticks (inference).
3. **Count 0 (ticks 0-1 of the cycle).** The mime turns, flips spotlights, then two hunts: players within distance 1 of the start tile `(24,28)` get `if_close()` and a queued `mime_step_right_up` (which `p_teleport`s them two tiles south to the stage `(24,26)`); players within distance 1 of `(24,26)` get `if_close()` (closes any open emote interface, and, by E6, empties their weak queue). `huntall` stores an iterator on the script state and `huntnext` sets the script's **active player** to each hit in turn (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1294-1316`), so the `queue(...)`/`if_close()` inside the loop act on the hit player. (Hit rules - what "distance 1" means - are in `PlayerHuntAllCommandIterator`, not read.)
4. **Count 1 (ticks 2-3).** The mime picks the emote: `%npc_int = random(8)` and plays the matching animation. `%npc_int` is an NPC variable, so it is the cycle's single shared "question".
5. **Count 4 (ticks 8-9).** Bow, face west, swap spotlights; for every player within distance 1 of the stage: `if_openchat(macro_mime_emotes)` (a chat modal - `openChatModal`, `Engine-TS/src/engine/entity/Player.ts:2033-2054`, which also discards a pending `PAUSEBUTTON`/`COUNTDIALOG` script, E6).
6. **The answer.** The eight `[if_button,macro_mime_emotes:com_N]` triggers are not dialogue resumes (that interface registers no resume buttons here), so `IfButtonHandler` takes the `else` branch: look up the `IF_BUTTON` script, run it with `ScriptRunner.init(script, player)` and `protect = (root layer is not an overlay)` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:30-38`; the interface's overlay flag was not read). `[label,mime_random_emote]`: `if_close` (modal closed, weak queue cleared), play the chosen animation, read the question from the NPC (`npc_find(0_31_74_27_26, macro_mime, 1, 0)` makes it the active NPC; `$curr_emote = %npc_int`), compare, then **`p_delay(4)`**, then cheer or cry and update `%macro_event`: 7 -> 100 -> 101 -> 102 on consecutive correct answers, any wrong answer resets to 7. On the 4th correct answer there is a second `p_delay(4)` then `~macro_return_teleport` and a reward.

## 2.3 Tick timeline for one player

Let k = `currentTick mod 32` and assume the timer parity is such that the director fires at ticks with k = 0,2,4,... (otherwise shift by one; the structure is the same). "Dir" = the NPC's phase-4 turn, "P" = the player's phase-5 turn.

| tick (k) | phase | what happens | source |
|---|---|---|---|
| arrival tick | 5/2 (old man resume) | Chapter 1 branch: `p_teleport(24,28)`, chat dialogue open (`PAUSEBUTTON`), `protect = true` for the rest of that tick. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:9-13` |
| arrival tick | 10 | `updateMap`: new 64x64 square `0_31_74` -> `[mapzone,0_31_74]` queued on the engine queue; blocked while the CHAT modal is open (E4). | E9 |
| next k=0 | 4 (Dir) | `huntall(24_28)` finds the player: `if_close()` (dialogue script dropped if still `PAUSEBUTTON`, E6), `queue(mime_step_right_up, 0, 0)`. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:53-57` |
| same tick | 5/3 (P) | The queue entry (added in phase 4, delay 0) runs if `canAccess()`: `p_teleport(coord - 2 z)`. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:94-95`, 05#22 |
| same tick | 5/5 | Dialogue is gone (dropped by `if_close()`), so `canAccess()` is true and the engine-queue `[mapzone,0_31_74]` runs now (flip spotlights, message, music) - if the player is not delayed. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:16-36`, E9 |
| k=2 | 4 | `%npc_int = random(8)`, mime animates. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:63-75` |
| k=8 | 4 | `huntall(24_26)`: `if_openchat(macro_mime_emotes)` for the player (CHAT modal: `busy()` becomes true). | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:85-89` |
| Tb | 2 | Player clicks an emote button: `IfButton` script runs (refused by `runScript` if the player is `delayed`/`protect`ed). `if_close`, `anim`, compare. Correct: `p_delay(4)` -> `delayedUntil = Tb+5`. | E2, scenarios.md row T0+1 |
| Tb+1..Tb+4 | 2 | Clicks (walk, op, buttons) are refused/ignored while delayed. | E5 |
| Tb+5 | 5/2 | Resume: `anim(emote_cheer)`, `%macro_event` 7 -> 100 (or 100 -> 101 ...). Script ends. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:119-126` |
| Tb+5 (4th correct) | 5/2 | `case ^macro_mime_solve_3`: second `p_delay(4)` -> Tb+10 | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:127-129` |
| Tb+10 | 5/2 | `macro_return_teleport` (`p_teleport`), unlock emote or `inv_add(reward)`. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:130-138`, `Content/scripts/macro events/scripts/macro_events.rs2:228-234` |
| next tick | 10 -> 5/5 | Leaving square `0_31_74`: `[mapzoneexit,0_31_74]` -> `~initalltabs`, `~macro_events_varps_reset`. | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:39-41`, E9 |
| Tb' (wrong answer) | 5/2 at Tb'+5 | `anim(emote_cry)`, `%macro_event = ^macro_mime` (back to 7). | `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:140-144` |

## 2.4 What persists between ticks

- Player: `%macro_event` (the state: 7, 100-102), `%macro_event_target_coord` (perm), `delayed`/`activeScript` during the `p_delay(4)`s, the modal state (`modalChat`), the engine-queue `[mapzone]` entry while blocked.
- NPC: `%npc_int` (the current question), its timer interval (set to 2 by the script), `timerClock`.
- Locs: the spotlight animations are `loc_anim` side effects, not state.

## 2.5 Interruptions and what the player can do

- Closing the emote interface or walking: a plain `closeModal()` runs; walking away is only possible outside a `p_delay` (E5). Nothing in this file re-opens the interface except the next cycle's count 4 (so the next chance is the following 32-tick cycle).
- Not answering: the director continues every cycle; nothing in this file times the event out (a player who never answers is not removed by anything in mime.rs2; the old man NPC was already deleted before the teleport). Other exits (logout, teleports) were not traced.
- Logging in inside the mime area fires `[mapzone,0_31_74]` as the "first" zone entry (inference, as in chapter 1: relies on `lastMapZone` starting unset).

## 2.6 Gotchas verified in code

1. **The NPC timer is a broadcast.** One `ai_timer` firing acts on all players in the hunt area via the `huntnext` loop; `queue` and `if_close` inside the loop act on the current hit (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1304-1316`: `state.activePlayer = result.value`). The question (`%npc_int`) is shared; each player's progress (`%macro_event`) is their own.
2. **Phase order gives the NPC the first move every tick.** The director runs in phase 4 and queues onto players in the same tick; those `queue(...)` entries run in the same tick's phase 5 pass (05#22 first row) - unless the player is not accessible, in which case they wait and keep counting (E7).
3. **`if_close()` from the director is `closeModal()` with the default argument**, so it empties the player's weak queue too (E6). A player in the middle of a weak-queue activity (chapter 3) who stands at the stage would lose it.
4. **A `p_delay(4)` is five ticks long** (E2), longer than the 2-tick director interval, so a director firing can land inside a player's answer delay. `if_close()` then runs on a delayed player: the `closeModal` call sets `protect = false` only `if (!this.delayed)` (`Engine-TS/src/engine/entity/Player.ts:764-766`), and it does not touch the suspended script (state `SUSPENDED`, not `PAUSEBUTTON`, E6).
5. **Answer evaluation is at click time, not at display time.** `$curr_emote` is read from `%npc_int` when the button script runs (`Content/scripts/macro events/scripts/general/macro_event_mime.rs2:113-116`), not when the interface opened; the question changes at count 1 of the next cycle only (`Content/scripts/macro events/scripts/general/macro_event_mime.rs2:63-64`).
6. **If the NPC is not found at that spot, the correct answer is a random number** (`def_int $curr_emote = random(8)` is only overwritten `if (npc_find(...) = true)`, `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:113-116`).
7. **`IfButtonHandler` returns `true` even when `runScript` refuses** the protected script (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:32-40`; `Engine-TS/src/engine/entity/Player.ts:2171-2176`), so a click while delayed is silently ignored but counts as handled input (scenarios.md row T0+1).

## 2.7 Inferences (labelled)

- **Inference:** a player gets one question every 32 ticks (about 19 s at 600 ms), needs four correct answers, and each correct answer costs five ticks of delay; the fastest possible run is therefore bounded below by four cycles. Rests on `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:43-91`, E2, and the assumption the director keeps firing every 2 ticks.
- **Inference:** the intro dialogue never needs to be dismissed by the player: at the next count 0 the director's `huntall(24_28)` closes it (and moves the player), after which the `[mapzone]` trigger can run. Rests on `Content/scripts/macro events/scripts/general/macro_event_mime.rs2:53-57`, E6, E9.
- **Inference:** two players on the stage share the question, so one player's wrong answer does not affect the other's `%macro_event`. Rests on `%macro_event` being a player varp and `%npc_int` an NPC varn.

## 2.8 Not checked / open questions

- **Which file defines the `macro_mime` NPC type for revision 274 and its `timer=`.** The only definition found is the dump `Content/scripts/_unpack/254/all.npc:30-57`, which includes `timer=5` (line 57); `Content/scripts/_unpack/274/all.npc` has no `macro_mime` block. If the packer does not read the 254 dump, the NPC would have the default `timer = -1` (`docs/tick/04-npcs.md` rule 12) and `[ai_timer,macro_mime]` would never fire. Resolving needs the pack/unpack code (not read).
- The `PlayerHuntAllCommandIterator` hit rules and order (multiple players).
- Whether `macro_mime_emotes` root layer is an overlay (decides `protect` for the button scripts); `~initalltabs`; `macro_events_set_tabs`.
- The arrival of the mime-cycle phase relative to when the player is teleported (depends on tick arithmetic, not observable without a run).

---

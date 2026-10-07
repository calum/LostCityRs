# Chapter 9: Zombie Queen, the Shilo green mist (`queue` handing over to `world_delay`)

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** After the player agrees to be dragged through Shilo's gates, a mist hurts everything near one spot four times, five ticks apart, even if the player has long since moved or logged out. Which mechanism lets a script keep running without belonging to the player, and how does it interact with the player's own queue, delays and logout?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed.

## 5.1 The scripts

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:43-63
  43  if(coordx(coord) < coordx(loc_coord)) {
  44      p_teleport(loc_coord);
  45      ~shilo_metalgates_open;
  46      return;
  47  }
  48  ~mesbox("The gate feels very cold to your touch! Are you sure you want to go through?");
  49  switch_int(~p_choice2("Yes, I am very nimble and agile!", 1, "No, actually, I have a bad feeling about this!", 2)) {
  50      case 1 :
  51          if_close;
  52          mes("The gates slowly begin to open...");
  53          p_delay(0); // 1t
  54          mes("Suddenly some Zombies grab you and start dragging you inside!");
  55          queue(shilo_mist_queue, 16, 0);
  56          ~shilo_metalgates_open;
  57          ~forcemove(0_44_46_54_9);
  58      case 2 :
  59          if_close;
  60          mes("You drag your quivering body away from the gates.");
  61          p_delay(1); // 2t
  62          mes("You look around, but you don't think anyone saw you.");
  63  }
```

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:65-82
  65  [queue,shilo_mist_queue]
  66  if(inzone(0_44_46_52_1, 0_44_46_58_15, coord) = false) {
  67      return;
  68  }
  69  @zq_greenmist(coord, 0);
  70  
  71  [label,zq_greenmist](coord $mist_coord, int $counter)
  72  if($counter >= 4) {
  73      return;
  74  }
  75  spotanim_map(shilomist, $mist_coord, 124, 3);
  76  huntall($mist_coord, 1, 0);
  77  while (huntnext = true) {
  78      if($counter = 0) mes("A green thick mist rises from the ground and starts choking you.");
  79      queue(damage_player, 0, ~random_range(2,3));
  80  }
  81  world_delay(3); // 4t, might be npc_queue on a zombie or something
  82  @zq_greenmist($mist_coord, calc($counter + 1));
```

`damage_player` (the per-hit queue script): `Content/scripts/player/scripts/damage.rs2:20-21` (`~damage_self($amount)`). The mist coordinate is `coord` = the player's position *at the moment the 16-tick queue entry runs* (line 69), not at the gate.

## 5.2 Walkthrough

1. `[oploc1,_shilo_metalgate]` (quest not complete): `~mesbox` and `~p_choice2` are two `PAUSEBUTTON` suspensions resumed by phase-2 packets (chapter 4 step 1). On "Yes": `if_close`, message, **`p_delay(0)`** (line 53).
2. One tick later (phase 5 step 2): message, **`queue(shilo_mist_queue, 16, 0)`** (line 55): a NORMAL queue entry with delay 16 on the player. `~shilo_metalgates_open` swaps the gate locs. `~forcemove(0_44_46_54_9)` drags the player tile by tile, one tick per tile (chapter 4: `Content/scripts/skill_agility/scripts/agility.rs2:18-43`).
3. The queue entry counts down while the player is dragged (a delayed player is not `canAccess()`, E4, but the counter still decrements, E7), and runs on the first accessible visit at or after its due tick.
4. `[queue,shilo_mist_queue]`: if the player is not in the mist box, stop. Otherwise `@zq_greenmist(coord, 0)` (a `goto` into the label, so the label's `$mist_coord`/`$counter` are the new locals): puff animation on `$mist_coord`, then `huntall($mist_coord, 1, 0)` and for each hit player (the loop sets the script's active player each time, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:1304-1316`) a message on pulse 0 and `queue(damage_player, 0, 2..3)` on that player.
5. **`world_delay(3)`** (line 81). The handler only sets `WORLD_SUSPENDED` and leaves the argument on the stack (`Engine-TS/src/engine/script/handlers/ServerOps.ts:167-170`). `Player.executeScript` (the queue pass called it, `Engine-TS/src/engine/entity/Player.ts:911`) sees that state and calls `World.enqueueScript(script, script.popInt())` (`Engine-TS/src/engine/entity/Player.ts:2212-2213`), which stores `delay + 1` = 4 (`Engine-TS/src/engine/World.ts:1249-1251`). The `ScriptState` is **not** assigned to any entity's `activeScript` in this branch, so the player is not delayed, not protected and not blocked by it: `runScript` clears `protect` on return (`Engine-TS/src/engine/entity/Player.ts:2185-2187`).
6. In **phase 1** of a later tick `processWorld` finds the entry due, calls `ScriptRunner.execute(script)` directly (no player involved: `Engine-TS/src/engine/World.ts:541-543`) and the script continues after `world_delay` with `@zq_greenmist($mist_coord, calc($counter + 1))`: pulse 1 at the saved coordinate, then `world_delay(3)` again, which `processWorld` re-enqueues (`Engine-TS/src/engine/World.ts:554-556`). Pulses 0..3 happen; at `$counter = 4` the label returns and the script ends (lines 72-74).

## 5.3 Tick timeline (T = tick of the "Yes" click, phase 2; Q = tick the queue entry runs)

| tick | phase | what happens | source |
|---|---|---|---|
| T | 2 | Resume (forced): `if_close` (weak queue emptied, chat closed), message, `p_delay(0)` -> `delayedUntil = T+1` | E6, E2, `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-29` |
| T+1 | 5/2 | Resume: message, `queue(shilo_mist_queue, 16, 0)` (enqueued before this turn's queue pass), gates opened, first `forcemove` step (`p_teleport`, `p_stopaction`, `p_delay(0)`) | `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:54-57`, E1 |
| T+1 | 5/3 | Queue pass: entry visited, pre-value 16 -> 15 (blocked anyway: delayed) | E7 |
| T+2 ... | 5/2 | One more tile per tick until the destination is reached (number of tiles not computed) | `Content/scripts/skill_agility/scripts/agility.rs2:18-43` |
| T+17 (or the first accessible visit after) = Q | 5/3 | Entry due (pre-value 0 at the 17th visit) and `canAccess()`: unlinked and run protected. Pulse 0: puff, `huntall`, message, `queue(damage_player, 0, n)` per hit player, `world_delay(3)` -> world queue entry (delay 4). | E7, `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:65-81`, E10 |
| Q (or Q+1) | 5/3 | Own `damage_player` entry: runs this tick if the running entry was not the last node of the queue, else next tick | E7, 05#13 |
| Q+1 .. Q+4 | 1 | World queue visits: pre-values 4,3,2,1 -> skipped | `Engine-TS/src/engine/World.ts:535-539` |
| Q+5 | 1 | pre-value 0: pulse 1 runs from `processWorld`, re-enqueues itself | `Engine-TS/src/engine/World.ts:541-557` |
| Q+5 | 5/3 | Hit players' `damage_player` entries (enqueued in phase 1) run in this tick's phase-5 pass if they are accessible | 05#22 row 1 |
| Q+10, Q+15 | 1 | Pulses 2 and 3 | |
| Q+20 | 1 | `$counter = 4`: returns; entry gone | line 72-74 |

## 5.4 What persists between ticks

- The player's queue entry (`ScriptFile` + args), then, after pulse 0, only the world-queue entry: the `ScriptState` with `$mist_coord`, `$counter` (the label's locals), the `playerIterator` and its active-player pointers.
- Nothing about this is in a varp: no state survives a server restart (the world queue is an in-memory list, `Engine-TS/src/engine/World.ts:155`).

## 5.5 What interrupts it / what the player can do meanwhile

- **Before Q:** while being dragged the player is delayed (E5: clicks dropped). When the drag is over, the player can walk; walking calls `clearPendingAction()` -> `closeModal()` which clears only the **weak** queue (E6), not this NORMAL queue entry. So the entry cannot be cancelled by moving (the guard at line 66 only decides whether pulses start).
- **Logout before Q:** `processLogouts` requires the normal queue to hold only `LONG` entries with `logoutAction == 1` before removing a player (`Engine-TS/src/engine/World.ts:766-779`). This entry is a plain `queue` (type NORMAL), so `queueDiscardable` becomes false and the player is not removed until the entry has run (it keeps counting; `loggingOut` accelerates only `LONG` entries with `logoutAction 0`, `Engine-TS/src/engine/entity/Player.ts:898-901`). Chapter 6 shows the `LONG` + `^discard` alternative. (Engine facts read; the consequence for this specific quest is an inference.)
- **After Q:** nothing interrupts the world-queue script. The player can leave, die or log out; the pulses continue at the saved coordinate and hurt whoever stands within distance 1 (`huntall($mist_coord, 1, 0)`, hit rules not read).

## 5.6 Gotchas verified in code

1. **Content comment vs engine arithmetic.** Line 81 says `world_delay(3); // 4t`. By the engine's rule a `world_delay(d)` called in phase 5 of tick U resumes in phase 1 of tick U+d+2 (E10, 01#4), i.e. U+5 here. Other scripts compensate: `Content/scripts/skill_firemaking/scripts/firemaking.rs2:130-131` and `Content/scripts/quests/quest_tbwt/scripts/tbwt_jogre_bones.rs2:79-80` use `world_delay(add($delay, -2))` with the comment "Potentially this is an engine problem with world_delay being too slow though".
2. **A world-queue script holds a `ScriptState` without being run by a player.** It resumes via `ScriptRunner.execute` only (`Engine-TS/src/engine/World.ts:543`); `Player.runScript` is not involved, and when the first (queue-pass) run ended, `runScript` had already removed the `ProtectedActivePlayer` pointer bit from the state and reset `protect` (`Engine-TS/src/engine/entity/Player.ts:2185-2192`). So the continuation runs without protected access. Whether the VM would reject a `p_*` command in that state was not checked; this script uses none (only `spotanim_map`, `huntall`, `huntnext`, `mes`, `queue`).
3. **`goto` (`@label`) reuses the script state**, so no new stack frame accumulates across pulses (the frames are in `ScriptState.frames`, `Engine-TS/src/engine/script/ScriptState.ts:44-45`).
4. **Error in the resumed script is swallowed.** `processWorld` wraps execution in `try`/`catch` and only logs (`Engine-TS/src/engine/World.ts:558-560`); the entry is unlinked first, so a thrown error ends the mist silently (01#6).
5. **`queue(damage_player, ...)` from the world queue is applied in phase 5 of the same tick** (phase 1 precedes phase 5; delay 0, 05#22 first row), so damage lands on the pulse tick.
6. **The pulse location is fixed at Q.** `$mist_coord` is a local copied from `coord` when the queue script ran (line 69), so players who walked 10 tiles away between the click and Q are not hit unless they are near *that* tile (the guard at line 66 uses the player's current `coord` as well).

## 5.7 Inferences (labelled)

- **Inference:** pulses at Q, Q+5, Q+10, Q+15 (four pulses, five ticks apart), and Q is T+17 if the drag is done by then. Rests on E7 (queue pre-value counting), E10/01#4 (world-queue arithmetic) and `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:55` and `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:72-82`. The content comment suggests 4-tick spacing was intended.
- **Inference:** a player who logs out between T+1 and Q stays in the world until Q (and then has the pulse-0 effect at their last position). Rests on `Engine-TS/src/engine/World.ts:766-779` and the type of the queue entry.
- **Inference:** two players standing together both get a message only on pulse 0 and both get hit on every pulse, since `huntall` returns each player once per pulse. Rests on the loop structure (lines 76-80); `huntall` internals not read.

## 5.8 Not checked / open questions

- `PlayerHuntAllCommandIterator` semantics (distance 1, ordering), `spotanim_map`, `~forcemove` end tile versus gate position (decides whether the drag finishes before T+17), `~damage_self`.
- Whether `ScriptRunner.execute` behaves differently for a state with protected-pointer bits but `player.protect == false` (VM internals; 05 open question #15).
- Nothing run: pulse spacing is a calculation.

---

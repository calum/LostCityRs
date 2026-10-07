# Chapter 8: Zombie Queen, the raft cutscene and the Cairn Island bridge

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** How does a cutscene made of ~13 `p_delay`s, teleports, loc swaps and camera commands run across ~26 ticks, what can the player do during it, and what happens to the zone triggers the teleports cause? Second half: how does a zone-armed timer fire a *fall* sequence that is itself a `p_delay` chain run from inside a timer?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed.

## 4.1 The scripts

The raft: dialogue, choice, then the ride.

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:677-697
 677          ~mesbox("You see that this table already looks very sea worthy it takes virtually no time at all to help fix it into a crude raft.");
 678          if_close;
 679          mes("You place it carefully on the water!");
 680          // Temp note: dur updated
 681          loc_add(0_45_146_17_29, zqlograft, 0, centrepiece_straight, 7);
 682          cam_shake(4, 0, 20, 5);
 683          cam_shake(1, 0, 20, 4);
 684          stat_advance(crafting, 30);
 685          %zq_map_mechanisms = setbit(%zq_map_mechanisms, ^zq_used_table_logs);
 686          p_teleport(0_45_146_17_29);
 687          p_delay(1); // 2t
 688          mes("You board the raft!");
 689          p_delay(1);
 690          mes("You push off!");
 691          p_delay(1);
 692          say("Weeeeeeee!");
 693          // Temp note: dur updated
 694          loc_del(2);
 695          loc_add(0_45_146_12_17, zqlograft, 0, centrepiece_straight, 3);
 696          p_telejump(0_45_146_12_17);
 697          p_delay(1);
```

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:719-732
 719          p_telejump(0_45_146_55_7);
 720          cam_moveto(0_45_146_48_7, 550, 100, 100);
 721          cam_lookat(0_46_146_7_7, 20, 100, 100);
 722          p_delay(1);
 723          mes("...And plough through it!");
 724          // Temp note: dur updated
 725          loc_del(2);
 726          loc_add(0_45_146_61_7, zqlograft, 1, centrepiece_straight, 3);
 727          p_teleport(0_45_146_61_7);
 728          p_delay(1);
 729          cam_reset;
 730          p_telejump(0_45_46_49_5);
 731          facesquare(movecoord(coord, 8, 0, 0));
 732          p_delay(0);
```

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:742-761
 742          p_delay(0);
 743          mes("The raft soons breaks up.");
 744          // Temp note: dur updated
 745          loc_change(lograft_broken, 6);
 746          ~agility_exactmove(human_walk_logbalance_stumble, 5, 0, coord, movecoord(coord, 0, 0, 1), 6, 30, ^exact_east, false);
 747          // Temp note: dur updated
 748          loc_del(2);
 749          sound_synth(pool_plop, 1, 0);
 750          spotanim_map(watersplash, coord, 0, 0);
 751          // Temp note: dur updated
 752          loc_add(movecoord(coord, 1, 0, 0), lograft_broken, 1, centrepiece_straight, 6);
 753          ~set_readywalkturn_bas(human_swim_ready, human_swim_ready, human_swim);
 754          p_delay(0);
 755          ~forcemove(movecoord(coord, 0, 0, 1));
 756          ~update_bas;
 757          // Temp note: dur updated
 758          loc_del(2);
 759          // Temp note: dur does not need updated ? @indio
 760          loc_add(0_45_46_53_7, lograft_broken, 1, centrepiece_straight, 10);
 761          ~forcemove(movecoord(coord, 0, 0, 1));
```

The movement helpers used at the end (one tile and one tick per recursion):

```
// Content/scripts/skill_agility/scripts/agility.rs2:36-43
  36  def_coord $movement_coord = movecoord(coord, $move_x, 0, $move_z);
  37  p_teleport(movecoord(coord, $move_x, 0, $move_z));
  38  $change_x = calc($change_x - $move_x);
  39  $change_z = calc($change_z - $move_z);
  40  p_stopaction;
  41  p_delay(0);
  42  // recursive call
  43  ~agility_walk($change_x, $change_z, $reset_bas);
```

`~agility_exactmove` is `anim`, optional `p_locmerge`, `p_exactmove`, then `p_delay($movement_delay)` (`Content/scripts/skill_agility/scripts/agility.rs2:94-100`); `~forcemove($dest)` computes the x/z difference to the destination and calls `~agility_walk(dx, dz, false)` (`Content/scripts/skill_agility/scripts/agility.rs2:125-128`).

Zone triggers the ride crosses (they are engine-queue scripts, E9):

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1059-1066
1059  [mapzoneexit,0_45_145] queue(exit_ah_za_rhoon, 0, 0);
1060  [mapzoneexit,0_45_146] queue(exit_ah_za_rhoon, 0, 0);
1061  
1062  [queue,exit_ah_za_rhoon]
1063  if(inzone(0_45_145_0_0, 0_45_146_63_63, coord) = true) {
1064      return;
1065  }
1066  if(%zombiequeen = ^zombiequeen_entered_ah_za_rhoon) %zombiequeen = ^zombiequeen_left_ah_za_rhoon;
```

(Music: `[mapzone,0_45_146]` and `[mapzone,0_45_46]` at `Content/scripts/music/scripts/move.rs2:205` and `Content/scripts/music/scripts/move.rs2:190`.)

The bridge:

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:563-576
 563  [zone,0_43_46_24_32] settimer(cairn_island_bridge, 3);
 564  [zoneexit,0_43_46_24_32] cleartimer(cairn_island_bridge);
 565  
 566  [timer,cairn_island_bridge]
 567  if(inzone(0_43_46_24_35, 0_43_46_29_35, coord) = true) {
 568      if(stat_random(agility, 75, 250) = false) {
 569          // fall
 570          mes("You fall!");
 571          p_stopaction;
 572          cleartimer(cairn_island_bridge);
 573          ~set_walkbas(human_walk_logbalance_stumble);
 574          sound_synth(stumble_loop, 10, 0);
 575          facesquare(movecoord(coord, 0, 0, -2));
 576          p_delay(0);
```

```
// Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:596-610
 596          ~forcemove(movecoord(coord, 1, 0, 1));
 597          p_delay(0);
 598          ~update_bas;
 599          mes("You just manage to drag your pitiful frame onto the river bank.");
 600          mes("Though you nearly drowned in the river!");
 601          p_teleport(movecoord(coord, 1, 0, -1));
 602          ~damage_self(calc(stat(hitpoints) / 11));
 603          ~damage_self(calc(stat(hitpoints) / 11));
 604          ~damage_self(calc(stat(hitpoints) / 11));
 605          return;
 606      }
 607      mes("You manage to keep your balance on the bridge.");
 608      stat_advance(agility, 100);
 609      settimer(cairn_island_bridge, 20); // it's always 20 ticks
 610  }
```

## 4.2 Walkthrough: the raft

1. `[oploc2,zqtableraft]` runs from the interaction step (phase 5/8, protected). A `~mesbox` (`p_pausebutton` per page, `Content/scripts/interface_chat/scripts/chat.rs2:439-447`) and `~p_choice3` (a `PAUSEBUTTON` choice) each suspend it; every resume is a phase-2 packet (`Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:8-12`, `Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-29`), forced (E3, chapter 1 gotcha 2).
2. After the second dialogue (`Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:677`), the script runs on **inside phase 2**: `if_close` (which is `closeModal()`: empties the weak queue, closes the chat, E6; the script itself is `RUNNING` so it is not dropped), `loc_add` of the raft, two `cam_shake`s (written immediately, E12), `stat_advance`, a varp bit, `p_teleport(0_45_146_17_29)` and the first `p_delay(1)`.
3. From here the script is the player's `activeScript` in `SUSPENDED` state (E3) and every later leg is "resume in phase 5 step 2, do the next small thing, `p_delay` again". Each leg changes the world with loc commands and moves the player with `p_telejump` (instant jump flag, E12) or `p_teleport`; legs of `p_delay(1)` last two ticks, legs of `p_delay(0)` one tick.
4. The camera commands are queued (`cam_moveto`/`cam_lookat`, written in the phase 10 of the same tick, E12) and `cam_reset` is written when it runs (leg at T+18).
5. The final stretch uses `~agility_exactmove` (`anim`, `p_exactmove`, `p_delay(0)`, `Content/scripts/skill_agility/scripts/agility.rs2:94-100`) and two `~forcemove`s, which are recursions of "`p_teleport` one tile, `p_stopaction`, `p_delay(0)`" (`Content/scripts/skill_agility/scripts/agility.rs2:18-43`): one tick per tile.

## 4.3 Tick timeline of the raft (T = tick of the second dialogue's Continue click, phase 2)

| tick | phase | what the script does (line numbers: quest_zombiequeen.rs2) | delay set -> resumes at |
|---|---|---|---|
| T | 2 | `if_close`, message, raft `loc_add`, `cam_shake` x2, `p_teleport(0_45_146_17_29)` (678-686) | `p_delay(1)` -> T+2 |
| T+2 | 5/2 | "You board the raft!" (688) | `p_delay(1)` -> T+4 |
| T+4 | 5/2 | "You push off!" (690) | `p_delay(1)` -> T+6 |
| T+6 | 5/2 | `say`, move raft loc, `p_telejump(12,17)` (692-696) | -> T+8 |
| T+8 | 5/2 | raft loc, `p_telejump(22,7)` (698-701) | -> T+10 |
| T+10 | 5/2 | `say`, `p_telejump(38,6)` (703-707) | -> T+12 |
| T+12 | 5/2 | `p_telejump(47,7)` (709-712) | -> T+14 |
| T+14 | 5/2 | message, `say`, `p_telejump(55,7)`, `cam_moveto`, `cam_lookat` (714-721) | -> T+16 |
| T+16 | 5/2 | message, `p_teleport(61,7)` (723-727) | -> T+18 |
| T+18 | 5/2 | `cam_reset`, `p_telejump(0_45_46_49_5)`, `facesquare` (729-731) | `p_delay(0)` -> T+19 |
| T+19 | 5/2 | `p_telejump(+1,0,0)`, `loc_add` (733-735) | `p_delay(1)` -> T+21 |
| T+21 | 5/2 | `loc_del`, `p_telejump(+1,0,0)`, `loc_add` (737-741) | `p_delay(0)` -> T+22 |
| T+22 | 5/2 | message, `loc_change`, `~agility_exactmove(...)` (743-746) | `p_delay(0)` -> T+23 |
| T+23 | 5/2 | loc swaps, sound, bas change (747-753) | `p_delay(0)` -> T+24 |
| T+24 | 5/2 | `~forcemove(+1 z)`: one `p_teleport` | `p_delay(0)` -> T+25 |
| T+25 | 5/2 | recursion ends, `update_bas`, loc swaps (756-760), `~forcemove(+1 z)`: one `p_teleport` | `p_delay(0)` -> T+26 |
| T+26 | 5/2 | recursion ends; script finishes; `activeScript` cleared; `closeModal(false)` | - |
| T+26 | 5/5 | Engine queue is now accessible: `[mapzoneexit,0_45_146]` (queued at T+18's phase 10) and the music `[mapzone,0_45_46]` run; the former does `queue(exit_ah_za_rhoon, 0, 0)` | E9 |
| T+27 | 5/3 | `[queue,exit_ah_za_rhoon]`: player is outside the zone, `%zombiequeen` entered -> left | `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1062-1066`, 05#22 row "Step 5" |

Each "resume" row sits at phase 5 step 2, before that tick's queue pass, timers and engine queue (E1), and each row ends with a new delay so the player is `delayed` for steps 3-5 as well (E4). Camera: `cam_moveto`/`cam_lookat` queued in T+14 reach the wire in phase 10 of T+14; `cam_reset` at T+18 is written during phase 5 (E12).

## 4.4 Walkthrough and timeline: the bridge timer

1. Entering the 8x8 zone `0_43_46_24_32` queues `[zone,0_43_46_24_32]` in phase 10 (tick Z); it runs at step 5 of Z+1 and executes `settimer(cairn_island_bridge, 3)` (clock := Z+1). `[zoneexit,...]` clears the timer (`Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:563-564`).
2. `[timer,cairn_island_bridge]` fires at step 4 whenever `currentTick >= clock + 3` and the player passes `canAccess()` (E8): first at Z+4 and every 3 ticks while the player stays in the zone.
3. If the player is not on the bridge strip (`inzone(0_43_46_24_35, 0_43_46_29_35, coord)` false, line 567) nothing happens and the timer simply stays registered (the interval does not change).
4. On the strip: `stat_random(agility, 75, 250)`. **Success:** message, XP, `settimer(cairn_island_bridge, 20)` replaces the entry and restarts its clock, so the next check is 20 ticks later (line 609). **Failure:** `mes("You fall!")`, `p_stopaction`, `cleartimer`, then the fall chain.
5. Fall chain (all inside the *timer* script, which a NORMAL timer runs protected, E8): `p_delay(0)` (F -> F+1: walkbas, `p_teleport` +/-1 tile, `say`) `p_delay(0)` (F+2: `say`, splash, swim bas) `p_delay(0)` (F+3: a series of `~forcemove`s, one tick per tile, then `update_bas`, messages, `p_teleport` to the bank, three `damage_self`).

| tick | phase | what happens | source |
|---|---|---|---|
| Z | 5/8, 10 | Player steps into the zone; phase 10 queues `[zone]` | E9 |
| Z+1 | 5/5 | `[zone]` runs: `settimer(..., 3)`, clock = Z+1 | line 563 |
| Z+4, Z+7, ... | 5/4 | timer fires, off-bridge: nothing; clock := now | line 567; E8 |
| F | 5/4 | on bridge, fail roll lost: message, `p_stopaction`, `cleartimer`, `p_delay(0)` | 568-576 |
| F+1 | 5/2 | `p_teleport`, `say`, `p_delay(0)` | 578-582 |
| F+2 | 5/2 | `say`, splash/sound, bas, `p_delay(0)` | 584-588 |
| F+3 .. | 5/2 | `~forcemove`s (one tile and one tick each), `p_delay(0)`, messages, `p_teleport`, damage | 590-604 |

## 4.5 What persists between ticks, and what interrupts

- The whole cutscene is one `ScriptState` (program counter, locals, subroutine frames) in `player.activeScript` (E3). Persisted world state: raft locs (with their own timeouts as the `loc_add` last argument), a varp bit `%zq_map_mechanisms` set at line 685, camera state on the client.
- The player cannot interrupt the ride: every phase 2 within T..T+26 sees `delayed == true` (E5) because each resume re-delays before the next phase 2. `MoveClick`/`OpNpc` are dropped with an `UNSET_MAP_FLAG`; there is no deferral. Normal timers, the normal and weak queues and the engine queue are blocked (E4); soft timers (e.g. `musicloop`, `Content/scripts/music/scripts/musicplayer.rs2:14`) still fire.
- Logout is held back: `processLogouts` removes a player only when `canAccess()` (plus empty engine queue and discardable queue), `Engine-TS/src/engine/World.ts:779`, so a delayed player stays until the script ends (unless `World.shutdown`, where `canAccess()` is true, E4; 07 rules 5-7).
- The zone triggers that the teleports cause are *not* skipped; they pile up on the engine queue and run when the script ends, in the order enqueued (E9, 05#21). Here `[mapzoneexit,0_45_146]` runs at T+26 and chains a normal-queue script that runs at T+27.

## 4.6 Gotchas verified in code

1. **`p_delay(1)` is two ticks, `p_delay(0)` is one** (E2). The content comments (`// 2t`, `// 1t`) agree with the engine arithmetic.
2. **Phase 2 resumes vs phase 5 resumes.** The *first* leg runs in phase 2 (a dialogue resume packet), all later legs in phase 5 step 2. Phase 2 of tick T sees the pre-resume state; so a camera/loc change in the first leg is visible to the packets of that same tick's phase 10, same as any other.
3. **Dialogue pages and `if_close` in a running script.** `if_close` inside the running script calls `closeModal()`. That drops an `activeScript` only if it is `PAUSEBUTTON`/`COUNTDIALOG` (`Engine-TS/src/engine/entity/Player.ts:774-778`); the running script's `execution` is `RUNNING` (`Engine-TS/src/engine/script/ScriptRunner.ts:128-130`), so it survives.
4. **`p_teleport` into a different map square is only noticed in phase 10** (E9), and the exit/enter scripts wait for `canAccess()`: here ~8 ticks after the jump, because the player is delayed all the while.
5. **A script that suspends from inside a timer:** `executeScript(script, true)` for NORMAL timers (`Engine-TS/src/engine/entity/Player.ts:958`) and the `SUSPENDED` branch stores it as `activeScript` (E3). The timer entry itself was already clock-reset (E8) and, on the failure path, deleted by `cleartimer` *during* the pass over `this.timers.values()` (`Engine-TS/src/engine/entity/Player.ts:945-961`); deleting during `Map` iteration is defined JavaScript behaviour, not tested here (05 Inferences).
6. **`settimer` of an existing timer id replaces it** (E8): the success path's `settimer(cairn_island_bridge, 20)` turns a 3-tick poll into a 20-tick poll; a later failure to leave the strip is only noticed at the next firing.
7. **Failure leaves no timer.** `cleartimer` ran at the start of the fall, and the player is `p_teleport`ed within the same 8x8 zone neighbourhood; zone triggers fire only on a *change* of zone (`Engine-TS/src/engine/entity/NetworkPlayer.ts:264-283`), so the poll is re-armed only after leaving and re-entering the zone (inference: depends on where the end position is).

## 4.7 Inferences (labelled)

- **Inference:** the ride takes 26 ticks from the final click to the last resume (15.6 s at 600 ms). Rests on E2 and the table above; assumes no other script delays the player further (none of the called procs besides `agility_*` and `forcemove` delay).
- **Inference:** a nearby player does not see the ride's teleports as walking: `p_telejump` sets `jump`, `p_teleport` sets `tele` (E12); how `PLAYER_INFO` renders these is in 09-info (not re-read).
- **Inference:** `[mapzone,0_45_46]` (music) fires at T+26 phase 5 although the player arrived in that square at T+18, because the player was delayed. Rests on E9 and the delay chain.

## 4.8 Not checked / open questions

- Loc commands (`loc_add`/`loc_del`/`loc_change`) timing and the `dur updated` notes in the script; `p_exactmove`/`p_locmerge`; `say`, `anim` masks; client rendering of cam commands.
- Whether `zqtableraft` and the raft start are in map square `0_45_146` (decides whether T's teleport itself triggers any zone script).
- The ladder/vault cases (they only message); other `[zone,...]` triggers elsewhere in Content for the zones the raft passes (grep found only the bridge one in this quest file plus music `mapzone`s).

---

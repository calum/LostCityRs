# Chapter 5: Random event, the Mysterious Old Man and the Maze

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** How does a 500-tick player timer turn into an NPC that talks to you, escalates, teleports you away, or sends you into a maze, across ~80 ticks and two actors (player scripts in phase 5, NPC scripts in phase 4)?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed.

## 1.1 The scripts

The player's repeating timer is armed at login. Source: `Content/scripts/login_logout/login.rs2:40`
```
settimer(general_macro_events, 500);
```
(login scripts run via `executeScript(loginTrigger, true)`, `Engine-TS/src/engine/entity/Player.ts:524-528`; the login queue entry `queue(macro_event_login, 0, 0)` is at `Content/scripts/login_logout/login.rs2:48`.)

The timer script and the spawn proc:

```
// Content/scripts/macro events/scripts/macro_events.rs2:1-11
   1  // timer is initiated on login, in scripts\player\scripts\global.rs2
   2  [timer,general_macro_events]
   3  // make sure this is before afk_event is called, to retain the 'queueing' behavior for random event spawning
   4  if (~macro_event_allowed = false) { 
   5      return;
   6  }
   7  if (afk_event = ^true) {
   8      // random events arent restricted in wildy? https://youtu.be/uPKaH7yg4To?t=421
   9      // Not restricted in banks: https://youtu.be/1Rz9Eg4ZHhA
  10      ~macro_event_general_spawn(~macro_event_set_random);
  11  }
```

```
// Content/scripts/macro events/scripts/macro_events.rs2:26-45
  26  [proc,macro_event_general_spawn](int $event)
  27  if (~macro_event_allowed = false) { 
  28      return;
  29  }
  30  def_coord $event_coord = map_findsquare(coord, 1, 1, ^map_findsquare_lineofwalk);
  31  if ($event_coord = null) {
  32      return;
  33  }
  34  %macro_event = $event;
  35  def_npc $event_npc = ~macro_event_npc($event);
  36  npc_add($event_coord, $event_npc, 1000);
  37  %macro_event_uid = npc_uid;
  38  session_log(^log_moderator, "Random event spawned: <nc_debugname(npc_type)>");
  39  switch_int ($event) {
  40      case ^macro_swarm : ~macro_swarm_spawn;
  41      case ^macro_triffidseed : ~macro_event_triffid_spawn;
  42      case ^macro_dwarf : ~macro_dwarf_spawn;
  43      case ^macro_geni : ~macro_geni_spawn;
  44      case ^macro_mysterious_old_man, ^macro_cube, ^macro_mime, ^macro_maze : ~macro_mysterious_old_man_spawn($event);
  45  }
```

All four "old man" events map to one NPC type, `macro_mage`: `Content/scripts/macro events/configs/macro_events.enum:7-10` (values 4, 6, 7, 8), whose type has `timer=20` (`Content/scripts/macro events/configs/antimacro.npc:123-125`). The spawn proc `macro_mysterious_old_man_spawn` switches on the event; the Mime and Strange-box cases are at `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:12-28` (chapter 2 covers Mime). The Maze and Gift cases:

```
// Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:29-41
  29      case ^macro_maze : // Maze
  30          npc_say("Aha, you'll do <displayname>!"); // No bowing for maze event, either according to https://youtu.be/A0V4NJn11ow?si=iVJ16Z7Yv4ueT4ao&t=11
  31          p_delay(1);
  32          npc_del;
  33          %macro_event = ^macro_maze;
  34          ~start_macro_maze;
  35          return;
  36      case ^macro_mysterious_old_man : // Gift
  37          npc_anim(emote_bow, 20);
  38          npc_say("Greetings <displayname>!");
  39          p_delay(1);
  40          %npc_macro_event_target = uid;
  41          return;
```

The NPC's own scripts (timer, queues, the player-click handler):

```
// Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:49-88
  49  [ai_timer,macro_mage]
  50  if (~macro_event_lost = true) {
  51      // only confirmed for mysterious old man https://youtu.be/HwGAzcmvF9k?list=PLn23LiLYLb1Y3P9S9qZbijcJihiD416jT
  52      npc_queue(5, 0, 0);
  53      return;
  54  }
  55  
  56  if (finduid(%npc_macro_event_target) = true) {
  57      if (%npc_int = 0) {
  58          npc_anim(emote_wave, 20);
  59          npc_say("ehem... Hello <displayname>!");
  60      } else if (%npc_int = 1) {
  61          npc_anim(emote_think, 20);
  62          npc_say("Hello, are you there <displayname>!");
  63      } else if (%npc_int = 2) {
  64          npc_anim(emote_angry, 20);
  65          npc_say("It's really rude to ignore someone, <displayname>!");
  66      } else if (%npc_int = 3) { // fail
  67          npc_say("No-one ignores me!");
  68          npc_anim(human_castteleport, 0);
  69          %macro_event = ^no_macro_event;
  70          // https://youtu.be/Ai89wqupYqA?t=45
  71          queue(macro_event_fail_teleport, 0, 0);
  72          npc_delay(0);
  73          npc_del;
  74          return;
  75      }
  76      %npc_int = add(%npc_int, 1);
  77  }
  78  
  79  [ai_queue5,macro_mage] // despawn
  80  npc_anim(emote_cry, 20);
  81  npc_say("I lose more friends that way.");
  82  npc_delay(2);
  83  ~macro_event_disappear;
  84  
  85  [ai_queue6,macro_mage] // say goodbye to player
  86  npc_anim(emote_wave, 20);
  87  npc_delay(2);
  88  ~macro_event_disappear;
```

```
// Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:90-113
  90  [opnpc1,macro_mage]
  91  if (uid ! %npc_macro_event_target) {
  92      // https://youtu.be/U_TRFGTfIY0?t=276
  93      // no comma and 'ignorning' is authentic
  94      if (.finduid(%npc_macro_event_target) = true) {
  95          ~chatnpc("<p,sad>Sorry, but I'm trying to talk to <.displayname>.|However <.text_gender("he", "she")> appears to be ignorning me...");
  96          return;
  97      }
  98      ~chatnpc("<p,sad>Sorry, but I'm trying to talk to another player.|However, they appear to be ignoring me...");
  99      return;
 100  }
 101  if (%npc_int = ^mysterious_old_man_happy) {
 102      ~chatnpc("<p,neutral>Goodbye.");
 103      return;
 104  }
 105  
 106  %npc_int = ^mysterious_old_man_happy;
 107  %macro_event = ^no_macro_event;
 108  inv_add(inv, ~macro_mysterious_old_man_reward);
 109  // dialogue taken from osrs. Neutral is a guess.
 110  npc_queue(6, 0, 2); // say goodbye to player
 111  npc_settimer(0);
 112  ~chatnpc("<p,neutral>Ah, so you are there. I hoped you would talk to me, I get so lonely. Here, have a present! I must be going now though."); // https://youtu.be/HpmsgVshwxg?t=305 uses chatnpc
 113  // delays are taken from this video: https://youtu.be/JeQUY1m1wRo?list=PLn23LiLYLb1bQ7Hwp77KoNBjKvpZQTfJT&t=137
```

The failure teleport that the NPC queues on the player:

```
// Content/scripts/macro events/scripts/macro_events.rs2:123-130
 123  %macro_event = ^no_macro_event;
 124  p_delay(1);
 125  // https://youtu.be/g5k3XuXxyYQ?list=PLn23LiLYLb1Y3P9S9qZbijcJihiD416jT&t=37
 126  spotanim_map(smokepuff, coord, 124, 0);
 127  sound_synth(smokepuff2, 1, 0);
 128  ~tele_checks;
 129  //--
 130  ~p_telejump_safe($teleport_coord); // todo: Confirm this
```

The Maze branch (`^macro_maze`, started at `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:34` via `~start_macro_maze`):

```
// Content/scripts/macro events/scripts/general/macro_event_maze.rs2:1-12
   1  [mapzoneexit,0_45_71]
   2  ~macro_events_varps_reset;
   3  ~macro_maze_cleanup;
   4  
   5  [mapzone,0_45_71]
   6  %macro_event = ^macro_maze;
   7  settimer(macro_maze, 5);
   8  ~update_macro_maze_progress;
   9  if_openoverlay(mazetimer);
  10  // https://youtu.be/LWfcA_C2bJY?si=9sY2pzIesH4AkEjO&t=107 tabs not hidden originally
  11  //https://youtu.be/yCBpihIGy68?si=CsTkheu7cAfGpjHa&t=13 login inside maze
  12  @music_playbyregion(coord);
```

```
// Content/scripts/macro events/scripts/general/macro_event_maze.rs2:14-47
  14  [proc,start_macro_maze]
  15  def_coord $coord = enum(int, coord, macro_maze_teleports, random(enum_getoutputcount(macro_maze_teleports)));
  16  %xplamp = 100;
  17  %macro_event_target_coord = coord;
  18  p_telejump($coord);
  19  ~update_macro_maze_progress;
  20  if_openoverlay(mazetimer);
  21  mes("You need to reach the maze centre, then you'll be returned to where you were.");
  22  ~chatnpc_specific("Mysterious Old Man", macro_mage, "<p,neutral>You need to reach the maze centre,|then you'll be returned to where you were."); // Split line as per https://imgur.com/riCliBA
  23  
  24  [proc,end_macro_maze]
  25  if_openoverlay(null);
  26  cleartimer(macro_maze);
  27  ~music_jingle("maze centre");
  28  anim(emote_cheer, 20);
  29  p_delay(5);
  30  ~macro_return_teleport;
  31  if (%xplamp > 0) {
  32      ~macro_maze_give_reward(~total_level, %xplamp);
  33  }
  34  
  35  [proc,update_macro_maze_progress]
  36  if_settext(mazetimer:com_2, "<tostring(%xplamp)>%");
  37  
  38  [proc,macro_maze_cleanup]
  39  cleartimer(macro_maze);
  40  if_openoverlay(null);
  41  %xplamp = 0;
  42  
  43  [timer,macro_maze]
  44  if (%xplamp > 0) {
  45      %xplamp = sub(%xplamp, 1);
  46  }
  47  ~update_macro_maze_progress;
```

The finish is `[oploc1,macro_maze_complete]` (`Content/scripts/macro events/scripts/general/macro_event_maze.rs2:72-74`): `if_close;` then `~end_macro_maze;`.

## 1.2 Walkthrough

**A. Rolling the event (both branches).**
1. `afkEventReady` is re-rolled in phase 2 every 500 ticks: `if (this.currentTick % World.AFK_EVENTRATE === 0) player.afkEventReady = Math.random() < (zonesAfk ? AFK_CHANCE2 : AFK_CHANCE1)` (`Engine-TS/src/engine/World.ts:610-611`; constants `Engine-TS/src/engine/World.ts:127-129`, 1/24 or 1/12). `afk_event` pushes it (only for `staffModLevel < 2` unless debug) and **clears it** (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1114-1117`), so one roll can be consumed once.
2. The timer is a NORMAL timer: it fires in step 4 of the player's phase-5 turn when `currentTick >= clock + 500` and `canAccess()`, with `clock` reset first and the script run protected (E8). If the player is busy at that moment it fires on the first accessible turn and the next due time moves with it (no catch-up). Nothing in the script re-arms it: the entry stays in `timers` and re-fires 500 ticks after each firing.
3. `macro_event_general_spawn`: `map_findsquare`, `%macro_event = $event`, `npc_add(..., 1000)` (a `DESPAWN` NPC with a 1000-tick lifetime; the NPC becomes the script's active NPC and all its `varn`s are zeroed, E11), `%macro_event_uid = npc_uid`, then the per-event proc. `%macro_event > 0` blocks new events (`Content/scripts/macro events/scripts/macro_events.rs2:70-72`).

**B. Gift/ignore branch (event 4).** `npc_setmode(playerfollow)`, `npc_anim`, `npc_say`, then `p_delay(1)` **inside the player's timer script** (E2): the timer script is stored as the player's `activeScript` in state `SUSPENDED` and `protect = true` (E3). After the delay it stores the player's uid in the NPC var `%npc_macro_event_target`; that single varn is what the NPC's later scripts use to find "its" player. After that nothing in the player's scripts waits for the NPC: the rest is the NPC's `ai_timer` (every 20 NPC turns).
- `ai_timer,macro_mage` (`Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:49-77`): if the target is gone/out of area (`~macro_event_lost`, `Content/scripts/macro events/scripts/macro_events.rs2:140-157`) it does `npc_queue(5, 0, 0)` (despawn queue). Otherwise it plays one of four lines by `%npc_int` (0,1,2 = nudges; 3 = fail) and increments `%npc_int`.
- Fail (`%npc_int = 3`): `queue(macro_event_fail_teleport, 0, 0)` is run on the **target player** (the script's active player was set by `finduid(%npc_macro_event_target)`, `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:56`; `queue` acts on `state.activePlayer`, `Engine-TS/src/engine/script/handlers/PlayerOps.ts:149-159`), then `npc_delay(0)` suspends the NPC script with `NPC_SUSPENDED`; one NPC tick later it resumes at `npc_del`.
- The player clicks the NPC: the op arrives as `OpNpc` in phase 2, refused if the player or the NPC is delayed (`Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:16-31`); the interaction is processed in phase 5 step 8 and `[opnpc1,macro_mage]` runs protected (`Engine-TS/src/engine/entity/Player.ts:1160-1176`). The script gives the reward at once (`inv_add`, `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:108`), sets `%npc_int = -1` ("happy"), turns the NPC's timer off (`npc_settimer(0)`), queues `ai_queue6` on the NPC with delay 2, then opens the dialogue (`~chatnpc` = `p_pausebutton`, `Content/scripts/interface_chat/scripts/chat.rs2:323-332`).
- `ai_queue6` (`Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:85-88`): wave, `npc_delay(2)`, then `~macro_event_disappear` -> `npc_del`.

**C. Maze branch (event 8).** The player-side timer script does `npc_say`, `p_delay(1)`, `npc_del`, `%macro_event = ^macro_maze`, `~start_macro_maze`. `start_macro_maze` picks one of four start tiles (all in map square `0_45_71`, `Content/scripts/macro events/configs/macro_events.enum:73-79`), stores the old position in the **perm** varp `%macro_event_target_coord` (`Content/scripts/macro events/configs/antimacro.varp:14-16`), calls `p_telejump`, opens the `mazetimer` overlay and a chat dialogue (`PAUSEBUTTON`). The **timer is not started here**: it is started by the `[mapzone,0_45_71]` trigger (`Content/scripts/macro events/scripts/general/macro_event_maze.rs2:5-12`), which is an engine-queue script (E9). That trigger also fires if the player logs in inside the maze (script comment, `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:11`; `lastMapZone` starts unset as `Engine-TS/src/engine/entity/NetworkPlayer.ts:253-255` implies, initial value not read). The finish is `[oploc1,macro_maze_complete]`: `if_close`, then `end_macro_maze`: overlay off, `cleartimer`, jingle, cheer anim, `p_delay(5)`, `~macro_return_teleport` (`p_teleport` back; `Content/scripts/macro events/scripts/macro_events.rs2:228-234`) and, if `%xplamp > 0`, three reward rolls. Leaving the map square runs `[mapzoneexit,0_45_71]` (`Content/scripts/macro events/scripts/general/macro_event_maze.rs2:1-3`), which resets varps, clears the timer and the overlay.

## 1.3 Tick timeline (T0 = tick in which the timer fires; "5/4" = phase 5, step 4)

**Gift/ignore branch**

| tick | phase | what happens | source |
|---|---|---|---|
| T0 | 5/4 | Timer fires (clock := T0), script runs protected. `npc_add` creates the NPC, `p_delay(1)`: `delayedUntil = T0+2`; script stored as `activeScript`, `protect = true`. | E8, E2, E3 |
| T0 | 11 | `resetEntity` sets `protect = false` (`Engine-TS/src/engine/entity/Player.ts:476`); `delayed` and `activeScript` stay. | 05#7 |
| T0+1 | 2 | Any move/op click from this player is refused (`delayed` still true; cleared only at phase 5 step 1). | E5 |
| T0+1 | 4 | The NPC's first turn (it was added after phase 4 of T0). `timerClock` goes 0 -> 1. | E11 |
| T0+2 | 5/1-2 | `delayed` cleared, `executeScript(active, true, true)` resumes the timer script: `%npc_macro_event_target = uid`; script ends; `activeScript` cleared, `closeModal(false)`. | E1, E3 |
| T0+20 | 4 | NPC `ai_timer` fires on its 20th turn (`++timerClock >= 20`), `%npc_int` 0: wave + "ehem... Hello". Timer clock resets to 0. | E11, `Content/scripts/macro events/configs/antimacro.npc:124` |
| T0+40, T0+60 | 4 | `%npc_int` 1, 2: further nudges. | `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:60-65` |
| T0+80 | 4 | `%npc_int` 3: "No-one ignores me!", `queue(macro_event_fail_teleport, 0, 0)` on the target player, `npc_delay(0)` (`delayedUntil = T0+81`). | `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:66-75`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101` |
| T0+80 | 5/3 | The player's queue entry (delay 0, enqueued in phase 4, before the player's pass) runs this tick if the player passes `canAccess()`: `%macro_event = 0`, `p_delay(1)` (-> T0+82). | E7; 05#22 table, first row |
| T0+81 | 4 | NPC undelay + resume: `npc_del`. | E11 |
| T0+82 | 5/2 | Player resumes: puff of smoke, `~tele_checks`, `~p_telejump_safe(random coord)`; zone triggers for the new location fire from T0+83 on. | `Content/scripts/macro events/scripts/macro_events.rs2:123-130`, E9 |

**Click path (player talks to the NPC in tick R, i.e. the op script runs in phase 5/8 of tick R)**

| tick | phase | what happens | source |
|---|---|---|---|
| R | 5/8 | Reward added, `%npc_int := -1`, `npc_queue(6, 0, 2)` (NPC queue delay 2), `npc_settimer(0)` (timer off), dialogue opens (`PAUSEBUTTON`). | `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:101-112` |
| R+1 | 4 | NPC queue entry: delay 2 -> 1, not due. | `Engine-TS/src/engine/entity/Npc.ts:561-570` |
| R+2 | 4 | delay -> 0: `ai_queue6` runs: wave, `npc_delay(2)` (`delayedUntil = R+5`). | `Engine-TS/src/engine/entity/Npc.ts:561-583`, `Engine-TS/src/engine/script/handlers/NpcOps.ts:97-101` |
| R+2..R+4 | 2 | `OpNpc` for this NPC is refused (NPC delayed), and a player whose target is this NPC loses the interaction in `validateTarget` at its next accessible turn. | `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:27-31`, `Engine-TS/src/engine/entity/Player.ts:1257-1262`, `scenarios.md` scenario 3 |
| R+5 | 4 | NPC undelays, resumes: `~macro_event_disappear` -> `npc_del`. This happens whether or not the player finished reading the dialogue. | `Engine-TS/src/engine/entity/Npc.ts:110-118`, `Content/scripts/macro events/scripts/macro_events.rs2:133-138` |

**Maze branch**

| tick | phase | what happens | source |
|---|---|---|---|
| T0 | 5/4 | Timer fires; `npc_say`; `p_delay(1)` (-> T0+2). | as above |
| T0+2 | 5/2 | Resume (forced): `npc_del`; `%macro_event = maze`; `%xplamp = 100`; `p_telejump` (position changes now); overlay; message; `~chatnpc_specific` opens a CHAT modal and suspends in `PAUSEBUTTON`. `protect = true` for the rest of the tick. | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:14-22`, E3 |
| T0+2 | 10 | `updateMap` sees a new 64x64 square (`0_45_71`): queues `[mapzoneexit,<old>]` if one exists and `[mapzone,0_45_71]` on the engine queue. | E9 |
| T0+3 ... | 5/5 | Engine queue visited every tick; `canAccess()` is false (CHAT modal open) so the mapzone script waits. **No timer is running yet.** | E4, E9 |
| Tc | 2 | Player clicks "Continue": `ResumePauseButtonHandler` runs `executeScript(active, true, true)`; script ends; `closeModal(false)` closes the chat. | `Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:8-12`, E3 |
| Tc | 5/5 | Engine queue: `[mapzone,0_45_71]` runs: `%macro_event = maze`, `settimer(macro_maze, 5)` (clock := Tc), overlay text, music. | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:5-12` |
| Tc+5, +10, ... | 5/4 | `[timer,macro_maze]`: `%xplamp -= 1` if > 0, overlay text updated. NORMAL timer: skipped while busy and not made up later. | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:43-47`, E8 |
| Te | 5/8 | Op on the statue: `if_close`, `end_macro_maze`: overlay off, `cleartimer`, anim, `p_delay(5)` (`delayedUntil = Te+6`). | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:72-74`, 24-29 |
| Te+6 | 5/2 | Resume: `macro_return_teleport` (`p_teleport`), then reward uses `%xplamp` (still intact). | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:30-33` |
| Te+6 | 10 | `updateMap`: map square changed -> `[mapzoneexit,0_45_71]` queued. | E9 |
| Te+7 | 5/5 | `[mapzoneexit]`: `macro_events_varps_reset`, `macro_maze_cleanup` (`cleartimer`, overlay off, `%xplamp = 0`). | `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:1-3`, 38-41 |

## 1.4 What persists between ticks

- Player: `activeScript` (the whole timer script's `ScriptState`, including `$event`, pointers to the active player and NPC), `delayed/delayedUntil`, the `timers` entry (`general_macro_events`, later `macro_maze`), varps `%macro_event`, `%macro_event_uid`, `%xplamp`, `%macro_event_target_coord` (perm), and the engine-queue entry for `[mapzone]`.
- NPC: `varn`s `%npc_macro_event_target`, `%npc_int`; its `timerClock`; its `activeScript` while `npc_delay`ed; its `queue`.
- Which survive logout is outside what was read, apart from `%macro_event_target_coord`, which is `scope=perm` (`Content/scripts/macro events/configs/antimacro.varp:16`). `%macro_event` has no `scope=` line (`Content/scripts/macro events/configs/antimacro.varp:1-3`) and the engine default is `SCOPE_TEMP` (`Engine-TS/src/cache/config/VarPlayerType.ts:83`), yet `[queue,macro_event_login]` reads `%macro_event` at login (`Content/scripts/macro events/scripts/macro_events.rs2:76-81`). Whether a temp varp survives a logout was not checked (open question).

## 1.5 What interrupts it / what the player can do meanwhile

- During `p_delay(1)` steps (T0..T0+2, Te..Te+6, T0+80..T0+82): move and op clicks are dropped (E5). Normal timers and queues wait (E4); soft timers would still fire (none here).
- While the maze dialogue is open: walking away (accepted `MoveClick` -> `clearPendingAction` -> `closeModal`) drops the dialogue script (`PAUSEBUTTON`) and unblocks the engine queue in the same tick (phase 2 precedes phase 5), so the `[mapzone]` trigger runs that tick (E6, E9). The `CLOSE_MODAL` packet only sets `requestModalClose`; `closeModal()` runs in step 3 of the phase-5 turn (E6), still before the engine-queue step 5.
- In the Gift branch the player may ignore the NPC entirely: the 4th `ai_timer` firing (T0+80) teleports them away. They may log out: `macro_event_lost` returns true when the target is missing, queueing the despawn lines (`Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:50-54`), and `ai_timer` is also tied to `follow_player_on_logout=^true` (`Content/scripts/macro events/configs/antimacro.npc:125`) which `macro_event_login` uses (`Content/scripts/macro events/scripts/macro_events.rs2:76-81`); not traced further.

## 1.6 Gotchas verified in code

1. **A timer script can itself be a multi-tick script.** `p_delay` inside the NORMAL timer's script works because NORMAL timers run protected (`Engine-TS/src/engine/entity/Player.ts:958`) and the stored script is resumed by the generic step 2 (E1, E3). The timer's own schedule is independent of the suspended script: `clock` was set before the script ran (E8).
2. **Dialogue resume is `force`d.** `ResumePauseButtonHandler` and the resume branch of `IfButtonHandler` call `executeScript(active, true, true)` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-29`), so a dialogue can be continued even if `protect` is stuck true, unlike a plain protected script (`Engine-TS/src/engine/entity/Player.ts:2171-2176`).
3. **The maze countdown starts late and does not catch up.** It starts only when the engine-queue `[mapzone]` script runs, after the dialogue is closed (see timeline), and a blocked NORMAL timer fires once on the first accessible turn (E8, 05#17). So `%xplamp` drops by at most 1 per accessible firing, not by "elapsed/5".
4. **Order matters in `end_macro_maze`.** The reward reads `%xplamp` after `p_teleport`; this works because the exit trigger that zeroes it is an engine-queue script that runs at the earliest in the next tick (E9). (Inference from E9 and `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:24-33`, 38-41.)
5. **NPC removal while the player's dialogue is open.** `ai_queue6` removes the NPC at R+5 independent of the player's dialogue (Npc.ts timing above). `chatnpc` re-reads `npc_coord`/`npc_getmode` for each page (`Content/scripts/interface_chat/scripts/chat.rs2:329-330`). What those do on a removed NPC for pages after the first was not checked.
6. **The `ai_timer` clock resets only if a script exists, after it ran** (`Engine-TS/src/engine/entity/Npc.ts:553-557`), and `npc_settimer(0)` disables it (`Engine-TS/src/engine/entity/Npc.ts:551`: `timerInterval > 0`), which is how the Gift branch stops the escalation once the player has talked to it.
7. **NPC and player scripts share one `ScriptState` only for the spawn.** Everything after the player's `p_delay(1)` is two independent schedules (player phase 5, NPC phase 4) linked only by varn/varp values and by `queue(...)` calls from the NPC onto the player. A `queue` from an NPC script in phase 4 runs in the same tick's phase 5 pass (05#22, first row).

## 1.7 Inferences (labelled)

- **Inference:** the gift NPC speaks at T0+20, +40, +60 and teleports the player at T0+80..T0+82, if the NPC is never delayed and the player is never inaccessible. Rests on E11 (first NPC turn T0+1, 20 valid turns per fire), `Content/scripts/macro events/scripts/general/macro_event_mysterious_old_man.rs2:49-77` and E2.
- **Inference:** the maze `xplamp` percent drops once per five accessible ticks starting 5 ticks after the dialogue is dismissed, so a player who dismisses quickly and never gets blocked sees 100 -> 0 over roughly 500 ticks. Rests on E8 and `Content/scripts/macro events/scripts/general/macro_event_maze.rs2:43-47`. Nothing in the three files read ends the event when `%xplamp` reaches 0 (the percent only scales the reward).
- **Inference:** a player who never clicks "Continue" and never moves keeps the engine-queue `[mapzone]` script (and so the timer) blocked indefinitely, because a CHAT modal makes `canAccess()` false (E4). Rests on E4/E9.

## 1.8 Not checked / open questions

- `npc_setmode(playerfollow)` semantics, what `macro_event_lost` does in `npc_tele` cases, `~tele_checks`/`~p_telejump_safe` bodies, door and chest scripts of the maze (they use `p_arrivedelay`/`p_delay(0)` the same way), the other three old-man events beyond the spawn lines, `World.removeNpc` for DESPAWN NPCs beyond 04#3.
- Whether a TEMP varp (`%macro_event`) is kept across logout, and so how `macro_event_login` ever sees a non-zero value (needs a read of the player save/load code).
- The initial value of `lastMapZone` (needed to confirm the login-in-maze path).
- Client-side behaviour of `if_openoverlay`, `p_telejump` on the client.

---

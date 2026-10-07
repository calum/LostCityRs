# Chapter 3: Eight simple worked examples (server)

**Question answered:** What do small, real multi-tick scripts look like in Content, and what happens on which tick when each one runs?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---

## Worked examples

Common assumption for all of them: the player is connected, not logging out, and each example is "read, not observed". When a script is run by an interaction (an `[oploc*]`, `[opnpc*]`, `[opobj*]` script), the phase is "phase 5, step 8" (the post-move or pre-move `tryInteract`, `Player.ts:1160-1182`, `:1289-1290`); the exact tick relative to the click depends on distance and is in `docs/tick/06-players-interaction-movement.md` and `scenarios.md`.

### Example 1: bury bones (`p_delay(0)` between an animation and the result)

`Content/scripts/skill_prayer/scripts/bury_bone.rs2:1-20`
```
 1 [opheld1,_bones] @bury_bones(last_slot);
 3 [label,bury_bones](int $slot)
 4 mes("You dig a hole in the ground...");
 5 anim(human_pickupfloor, 0);
 6 sound_synth(bones_down, 1, 0);
 8 p_stopaction;
 9 // bones used to delay: https://www.youtube.com/watch?v=LSpyUVXa4LE&t=84s
10 p_delay(0);
12 // delete is after delay: https://www.youtube.com/watch?v=OnW0ZwXLze4&t=141s
13 def_obj $last_item = inv_getobj(inv, $slot);
14 inv_delslot(inv, $slot);
15 stat_advance(prayer, oc_param($last_item, bone_exp));
16 mes("You bury the bones.");
```
(blank lines omitted; lines 18-20 are the `afk_event` check.)

Timeline (T = tick the item-option packet is decoded):
- **T, phase 2.** `OpHeldHandler` accepts the packet (it is not delayed, `OpHeldHandler.ts:16-19`), looks up `[opheld1,_bones]` and runs it protected: `player.executeScript(ScriptRunner.init(script, player), true)` (`OpHeldHandler.ts:65-68`). Lines 4-6 run: `mes`, `anim`, `sound_synth` (their packet/mask effects go out in phases 9-10; `docs/tick/10-clients-out.md`). `p_stopaction` clears interaction and walk queue (`PlayerOps.ts:430-432`, `Player.ts:964-973`; note this also calls `closeModal()`, which clears the weak queue). `p_delay(0)` sets `delayed = true`, `delayedUntil = T + 1` and `execution = SUSPENDED` (`PlayerOps.ts:376-380`). The loop exits, `execute` returns 2, `executeScript` stores the state in `player.activeScript` with `protect = true` (`Player.ts:2216-2218`). `pc` is at the `p_delay` instruction; `$slot` and `$last_item`'s slot remain in the state's locals.
- **T, phase 5.** Step 1: `delayed && T >= T+1` is false, nothing changes. Step 2: `!player.delayed` is false, no resume (`World.ts:692-697`). Step 3: `canAccess()` false, no queue entry runs. Steps 6-11: `processInteraction`, no target; nothing relevant.
- **T, phase 11.** `resetEntity(false)` clears `protect` (`World.ts:1148-1149`, `Player.ts:476`); `delayed` still holds, so `busy()` keeps blocking (05 rule 7).
- **T+1, phase 2.** Move, op and opheld packets from this player are refused (`delayed` is still true until phase 5): the bones are still in the inventory (line 14 has not run) and cannot be used again. (`MoveClickHandler.ts:12-15`, `OpHeldHandler.ts:16-19`.)
- **T+1, phase 5, step 1.** `T+1 >= T+1`: `delayed = false`. **Step 2:** `activeScript.execution === SUSPENDED`, so `executeScript(activeScript, true, true)`. `execute` sets `RUNNING`, increments `pc` past the `p_delay`, and runs lines 13-16 (item removed, XP given, message) and the `afk_event` branch. It reaches the end: `RETURN` with `fp === 0` gives `FINISHED` (`CoreOps.ts:206-208`), `executeScript` clears `activeScript` and, with no main modal, calls `closeModal(false)` (`Player.ts:2220-2227`). Steps 3-11 of the same turn then run with the player free again.
- **Cannot do during T..T (the tick of the delay):** everything involving packets and protected scripts. Can: nothing the player triggers; soft timers still run.

Net: two server-side effects, one tick apart (anim at T, item/XP at T+1). `p_delay(0)` is the minimal one-tick pause. Read, not observed. The comments at lines 9 and 12 cite videos for the original behaviour; those cannot be checked from code.

### Example 2: searching a hay bale (`p_delay(2)`, a dialogue pause, and a queue that has to wait)

`Content/scripts/general_use/scripts/haybales.rs2:1-3,17-29`
```
 1 [oploc1,haystack]
 2 mes("You search the hay bales...");
 3 @search_haybale();
17 [label,search_haybale]()
18 anim(human_pickupfloor, 0);
19 p_delay(2);
20 def_int $rand = random(100);
21 if ($rand < 2) {
22     queue(damage_player, 0, 1);
23     ~chatplayer("<p,angry>Ow! There's something sharp in there!");
24 } else if ($rand < 12) {
25     inv_add(inv, needle, 1);
26     ~chatplayer("<p,happy>Wow! A needle!|Now what are the chances of finding that?");
27 } else {
28     mes("You find nothing of interest.");
29 }
```
and the queued script `Content/scripts/player/scripts/damage.rs2:20-21`: `[queue,damage_player](int $amount)` / `~damage_self($amount);`.

Timeline (T = tick in whose phase 5, step 8 the `[oploc1,haystack]` script runs; loc ops are attempted after movement, `Player.ts:1289-1290`):
- **T, phase 5 step 8.** `tryInteract` sets `target = null`, clears waypoints, runs the script protected (`Player.ts:1173-1176`). `mes`, `anim`, then `p_delay(2)`: `delayedUntil = T+3`, `SUSPENDED`; stored with `protect = true`. Back in `tryInteract`: `nextTarget = this.target` (null), target restored, returns true (`Player.ts:1180-1182`); at the end of `processInteraction`, `interacted` is true and `nextTarget` is null, so `clearInteraction()` (`Player.ts:1306-1308`). The player is no longer interacting with the bale.
- **T+1 and T+2.** Phase 5 step 1: `T+1 >= T+3` false, `T+2 >= T+3` false: still delayed. Packets refused in phase 2 (Finding 14). Nothing happens server-side.
- **T+3, phase 2.** Packets from this player are still refused (`delayed` clears later in the tick).
- **T+3, phase 5.** Step 1 clears `delayed`; step 2 resumes: `random(100)` and one of three branches.
  - *98% branches (needle or nothing):* `inv_add` + `~chatplayer(...)`, or `mes`. The needle branch calls `~chatplayer`, which opens `chat1`/`chat2` with `if_openchat` and hits `p_pausebutton` (`chat.rs2:271-279`, `:269`): `execute` returns `PAUSEBUTTON`; `executeScript` stores it with `protect = true`. `modalState` now has `CHAT`. The player is waiting for the client.
  - *2% branch:* `queue(damage_player, 0, 1)` appends a `NORMAL` queue entry with delay 0 (`PlayerOps.ts:149-158`). Then `~chatplayer` pauses as above. The same turn's step 3 visits the queue: the entry's old delay is 0, but `canAccess()` is false (`protect` still true, chat modal open), so it is **not run**; its counter drops to -1 (`Player.ts:903-904`). The entry waits.
- **Tick U (any later tick), phase 2.** The player clicks "Click here to continue": client sends `RESUME_PAUSEBUTTON` (Finding 25) and `ResumePauseButtonHandler` runs `executeScript(activeScript, true, true)` (`ResumePauseButtonHandler.ts:8-12`). The script continues after `p_pausebutton`: `$page = 1`, the while loop ends, the label ends, `FINISHED`. `executeScript` clears `activeScript`/`resumeButtons` and calls `closeModal(false)` (`Player.ts:2220-2227`): `modalState = NONE`, chat closed.
- **Tick U, phase 5, step 3.** `canAccess()` is true again (not protected, not delayed, no main/chat modal; `protect` was set false at the end of `runScript`, `Player.ts:2185-2187`), so the queued `damage_player` runs now with its stale counter (-1 <= 0). **Inference:** in the 2% branch the damage lands when the player dismisses the dialogue, not at the tick of the "Ow!" line. (Rests on `Player.ts:903-904`, `:825-832`; the `damage_self` proc was not read.)
- **If instead the player walks away at tick U:** `MoveClickHandler` calls `clearPendingAction()` -> `closeModal()` (`MoveClickHandler.ts:30-32`, `Player.ts:970-973`). `modalState` was `CHAT`, so the `PAUSEBUTTON` script is dropped (`Player.ts:775-778`); the dialogue is never resumed. The rest of the label (nothing, here) is lost. The `damage_player` queue entry is not cleared (it is in `queue`, not `weakQueue`) and runs next accessible visit.

Net: `p_delay(2)` = 3 ticks (T to T+3), then a client-paced wait that has no tick length. The delayed ticks T..T+2 cannot be shortened by the client; the dialogue wait is arbitrary.

### Example 3: shopkeeper conversation (`chatnpc` + `p_choice2`: repeated pauses in one script run)

`Content/scripts/areas/area_rimmington/scripts/rommik.rs2:1-10`
```
 1 [opnpc1,rommik]
 2 ~chatnpc("<p,happy>Would you like to buy some crafting equipment?");
 3 def_int $option = ~p_choice2("No thanks, I've got all the Crafting equipment I need.", 1, "Let's see what you've got, then.", 2);
 4 if($option = 1) {
 5     ~chatplayer("<p,neutral>No thanks; I've got all the Crafting equipment I need.");
 6     ~chatnpc("<p,happy>Okay. Fare well on your travels.");
 7 } else if($option = 2) {
 8     ~chatplayer("<p,neutral>Let's see what you've got, then."); 
 9     ~openshop_activenpc;
10 }
```
Timeline:
- **T, phase 5, step 8.** `tryInteract` runs `[opnpc1,rommik]` protected (NPCs can be operated pre-move, `Player.ts:1170`). Line 2 -> `~chatnpc` -> loop page 0: `chatnpc_page` sets text and `if_openchat(npcchat1)`; `facesquare(npc_coord)`; `npc_setmode(playerfaceclose)` (changes the NPC's mode, `chat.rs2:329-330`); `p_pausebutton` -> `PAUSEBUTTON` (`chat.rs2:323-333`). The state (with the proc frames) is stored in `player.activeScript`, `protect = true`; `modalState` has `CHAT`. The interaction is cleared at the end of `processInteraction` as in Example 2.
- **Phase 10 of T.** The server writes the chat interface to the client (modal changes are sent in `processClientsOut`, `docs/tick/10-clients-out.md`; not re-read here).
- **Tick U1 (client-paced), phase 2.** `RESUME_PAUSEBUTTON` -> resume (`ResumePauseButtonHandler.ts:8-12`). Page loop ends, `~chatnpc` returns. Line 3 runs: `~p_choice2` sets texts, `if_openchat(multi2)` (`openChatModal`, `Player.ts:2033-2048`), `if_addresumebutton(multi2:com_1)` and `(multi2:com_2)` (push two ids onto `resumeButtons`), `p_pausebutton` (`chat.rs2:1-11`). All of this happens inside the phase-2 packet handler of tick U1; no tick passes between the two dialogue pages. Stored again as `PAUSEBUTTON`.
- **Tick U2, phase 2.** The player clicks one of the two options: `IF_BUTTON` for `multi2:com_1` or `com_2` reaches `IfButtonHandler`; the component is visible (chat modal), `lastCom` is set, it is in `resumeButtons`, and `activeScript.execution === PAUSEBUTTON`, so the script resumes (`IfButtonHandler.ts:24-29`). (Whether the real client sends `IF_BUTTON` for these buttons was not traced; the engine side is verified.) `switch_component (last_com)` returns 1 or 2, `$option` is set, then `~chatplayer` pauses again (or `~openshop_activenpc`: not read; it presumably opens the shop interface, and `openMainModal` closes a chat modal, `Player.ts:1995-2001`).
- **Tick U3.** Continue click -> `~chatnpc` page -> pause; continue click -> `FINISHED` -> `closeModal(false)`.
- **Anything else the player does in between:** a move or op click arrives with `delayed` false, so it is accepted and calls `closeModal()`, dropping the script at whatever page it is on (`Player.ts:775-778`). The NPC keeps whatever mode `npc_setmode(playerfaceclose)` gave it (Content-level behaviour of that mode: not read).

Net: three "waits" in one script, none of them with a tick length: each is a client packet in phase 2. While waiting, the player is `busy()` through the chat modal (Finding 15), so queue entries, normal timers and the engine queue (including the `mapzone` triggers) wait.

### Example 4: playing a lyre (a chain of `weakqueue` scripts, no suspension at all)

`Content/scripts/quests/quest_viking/scripts/viking_olaf.rs2:276-311` (the tail of `[opheld1,viking_enchanted_strung_lyre]` plus the queue scripts)
```
276 p_stopaction;
277 mes("You withdraw your lyre.");
278 anim(viking_lyre_ready, 0);
279 weakqueue(viking_play1, 1, 0);
281 [queue,viking_play1]
282 anim(viking_lyre_playing_loop, 0);
283 say("Doh Ray Me So.");
284 ~music_jingle("ballad opening");
285 weakqueue(viking_play2, 3, 0);
287 [queue,viking_play2]
288 anim(viking_lyre_playing_loop, 0);
289 say("Fah La Ti Doh.");
290 ~music_jingle("ballad refrain");
291 weakqueue(viking_play3, 3, 0);
...
305 [queue,viking_play5]
306 anim(viking_lyre_play_once, 0);
307 ~music_jingle("perfectly tuned");
308 weakqueue(viking_play6, 2, 0);
310 [queue,viking_play6]
311 mes("Your lyre is perfectly tuned.");
```
Assume the player is outside the `inzone` branch at lines 265-275 (that branch ends in `@play_lyre_longhall` for an in-progress quest; not read). `~music_jingle` just stores `%musicstart` and calls `midi_jingle` (`Content/scripts/music/scripts/music.rs2:50-54`), no suspension.

Timeline (T = tick of the item packet; each `[queue,...]` is a separate `ScriptState`):
- **T, phase 2.** `OpHeldHandler` runs the opheld script (`OpHeldHandler.ts:65-68`). `p_stopaction` (clears weak queue), message, `anim`, `weakqueue(viking_play1, 1, 0)` appends a `WEAK` entry with delay 1 (`PlayerOps.ts:124-133`). The script finishes (it did not suspend); the player is **not** delayed and can act normally.
- **T, phase 5, step 3 (weak pass).** The entry is visited: old delay 1 > 0, counter becomes 0, not run (`Player.ts:918-919`).
- **T+1, phase 5, weak pass.** Old delay 0 and `canAccess()` true: unlinked and run (`Player.ts:918-923`): `viking_play1` does `anim`, `say`, jingle and `weakqueue(viking_play2, 3, 0)`. That entry is appended during the weak pass by the last (only) entry, so the saved cursor is the sentinel and it is not reached this pass (05 rule 13). So `viking_play1` ran at **T+1 = T + delay**.
- **T+2, T+3, T+4.** Visits with old delay 3, 2, 1: not run (counter 2, 1, 0).
- **T+5.** Old delay 0: `viking_play2` runs. **Inference** (05 rules 11-13 and the table row "step 3d, weak queue"): an entry added by a weak-queue script with delay d first runs d+1 ticks later: play2 at T+5, play3 at T+9, play4 at T+13, play5 (delay 2 in `play4`: `:303`) at T+16, play6 (delay 2 in `play5`: `:308`) at T+19. Read, not observed.
- **What cancels it:** every `closeModal()` with the default argument empties the weak queue (`Player.ts:761-763`). Any move click (`MoveClickHandler.ts:30-32`), op click, `if_close`, or a `CLOSE_MODAL` request does that. So walking away stops the song: the pending entry is deleted, nothing resumes, and "Your lyre is perfectly tuned" never appears. The effect is in `closeModal` (`Player.ts:761-763`); why the queue is called "weak" was not checked beyond that code.
- **What delays it:** if at a visit the player is not accessible (a dialogue is open, or `delayed`), the entry is not run, the counter keeps going down and it runs at the first accessible visit (05 rule 11).

Net: this is the "multi-tick without suspension" pattern: state between the steps lives only in the queued script id, delay and one argument, not in a `ScriptState`.

### Example 5: a timer (`settimer` + `[timer,...]`)

`Content/scripts/macro events/scripts/general/macro_event_maze.rs2:5-9,24-29,43-47`
```
 5 [mapzone,0_45_71]
 6 %macro_event = ^macro_maze;
 7 settimer(macro_maze, 5);
 8 ~update_macro_maze_progress;
 9 if_openoverlay(mazetimer);
...
24 [proc,end_macro_maze]
25 if_openoverlay(null);
26 cleartimer(macro_maze);
...
43 [timer,macro_maze]
44 if (%xplamp > 0) {
45     %xplamp = sub(%xplamp, 1);
46 }
47 ~update_macro_maze_progress;
```
Timeline:
- **Tick T, phase 10.** The player's map square changes (for example via `p_telejump` at `macro_event_maze.rs2:18`, if the teleport target lies in map square 0_45_71, which was not checked; or by walking). `updateMap()` (called from `World.ts:1108`) sees `lastMapZone !== mapZone` and calls `triggerMapzone` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:251-262`), which looks up `[mapzone,0_45_71]` by name and `enqueueScript(trigger, PlayerQueueType.ENGINE)` (`Player.ts:580-586`).
- **Tick T+1, phase 5, step 5.** `processEngineQueue` runs it if `canAccess()` (`Player.ts:660-670`): `%macro_event = ...`, then `settimer(macro_maze, 5)`: `SETTIMER` pops args, interval and script id and calls `setTimer(NORMAL, script, args, 5)` (`PlayerOps.ts:890-900`), storing `{interval: 5, clock: T+1}` in `player.timers` (`Player.ts:928-939`). The script finishes in that one run (nothing suspends).
- **Tick T+6, phase 5, step 4.** `processTimers(NORMAL)`: `T+6 >= (T+1) + 5` is true and `canAccess()`; `clock` becomes T+6, then `[timer,macro_maze]` runs protected (`Player.ts:945-961`): `%xplamp` goes down by 1, text updated. Repeats in T+11, T+16, ... as long as the timer exists and the player is accessible at that visit. A normal timer blocked at its due tick (a dialogue open, or `delayed`) stays due and fires at the first accessible turn; the interval restarts from that firing (05 rule 17).
- **End.** `cleartimer(macro_maze)` (`:26`, also in `macro_maze_cleanup` `:39` via `[mapzoneexit,0_45_71]` `:1-3`) deletes the map entry (`Player.ts:941-943`). While `loggingOut` timers do not run (`World.ts:702-707`), and `cleanup()` clears them (`Player.ts:460`).
- **What the player can do meanwhile:** everything; a timer does not delay or suspend the player. (The first mapzone run happening in T+1 rather than T is by 05 table row "phases 6-11: next tick".)

Compare `softtimer` (e.g. `Content/scripts/skill_combat/scripts/pvp/pk_skull.rs2:33`): same bookkeeping, but fires even while busy and runs unprotected (`Player.ts:297`, `:958`).

### Example 6: an NPC dying (`npc_delay(1)` then `npc_del`)

`Content/scripts/drop tables/scripts/black_demon.rs2:1-5` and `Content/scripts/skill_combat/scripts/npc/npc_death.rs2:10-24`
```abbrev
 1 [ai_queue3,_black_demon]
 2 gosub(npc_death);
 3 if (npc_findhero = ^false) {
 4     return;
 5 }
...
10 [proc,npc_death]
13 npc_walk(npc_coord);
14 npc_setmode(none);
15 npc_arrivedelay; // arrivedelay for up to two ticks (current osrs too) ...
16 if (finduid(%npc_aggressive_player) = true) {
...
22 npc_anim(npc_param(death_anim), 0);
23 npc_delay(1); // osrs has an extra tick of delay here. ...
24 npc_del;
```
The script is started by `npc_queue(3, 0, 0)` from `npc_default_damage` when hitpoints reach 0 (`Content/scripts/skill_combat/scripts/npc/npc_combat.rs2:92-93`); which tick that call happens in depends on the combat script and is not traced. Take **T** = the tick in whose phase 4 the `ai_queue3` entry is run.
- **T, phase 4.** `Npc.processQueue` (`Npc.ts:561-583`): not delayed, `request.delay <= 0` -> unlink, look up `[ai_queue3,...]` by the NPC's type, `ScriptRunner.init(script, this, null, args)`, `this.executeScript(state)` (`Npc.ts:575-579`). `npc_walk`, `npc_setmode(none)`. `npc_arrivedelay`: if the NPC has not moved since `currentTick - 1` it returns without effect (`NpcOps.ts:558-560`); otherwise it delays 1 or 2 ticks (`NpcOps.ts:561-569`) and the rest of the proc happens later (branch not drawn). In the no-move case: `npc_anim` (death animation), then `npc_delay(1)`: `delayed = true`, `delayedUntil = T+2`, `NPC_SUSPENDED` (`NpcOps.ts:97-101`). `Npc.executeScript` stores the state in `activeNpc.activeScript` (`Npc.ts:230-231`). The `gosub` frame (return address into the `[ai_queue3]` script) is saved in the state's `frames`.
- **T+1, phase 2.** An attack op on the NPC is refused by `OpNpcHandler` (`OpNpcHandler.ts:27-31`).
- **T+1, phase 4.** `Npc.turn()`: `T+1 >= T+2` false, still delayed, no resume; the lifecycle counter does not tick while delayed (`Npc.ts:121`); `isValid()` is false for a delayed NPC (`Npc.ts:382-387`) so the turn returns before hunt, regen, timer, queue, and movement (`Npc.ts:153-155`). The NPC just plays out the animation.
- **T+2, phase 4.** Undelay and resume (`Npc.ts:112-117`): `npc_del` -> `World.removeNpc(npc, respawnrate)` (`NpcOps.ts:93-95`): marks inactive, leaves the zone, schedules the respawn (`World.ts:1307-1333`). The script goes on: back in the `[ai_queue3,...]` script `npc_findhero` and the `obj_add` drops run (`black_demon.rs2:3-8`). `FINISHED`; `Npc.executeScript` clears `activeScript` (`Npc.ts:235-236`).
- **Note:** the running script is not aborted by `npc_del` (Finding 21).

### Example 7: a chain of `p_delay` and a `world_delay` (tutorial fire lighting)

`Content/scripts/tutorial/scripts/skills/tut_firemaking.rs2:26-35` and `:72-87`
```abbrev
26 p_delay(0);
27 anim(human_createfire, 0);
28 sound_synth(tinderbox_strike, 1, 0);
29 ~tutorial_please_wait_firemaking;
30 p_delay(3);
31 sound_synth(tinderbox_strike, 1, 0);
32 p_delay(2);
33 anim(null, 0);
34 ~push_player(obj_coord);
35 ~tut_firemaking_success(obj_coord, $log);
...
72 [proc,tut_firemaking_success](coord $fire_coord, obj $log)
73 obj_del();
...
83 def_int $delay = 150;
85 loc_add($fire_coord, fire, 1, centrepiece_straight, $delay);
86 world_delay($delay);
87 obj_add($fire_coord, ashes, 1, calc(^lootdrop_duration / 2));
```
(lines 1-25 are the `[opobj4,newbielogs]` entry and checks; `~tutorial_please_wait_firemaking` calls `~tutorialstep(...)`, `tut_chatbox_steps.rs2:43-44`, which was not read.)

Timeline (T = tick the `[opobj4,newbielogs]` script runs, phase 5 step 8):
- **T.** Checks pass; `p_delay(0)` (line 26): `delayedUntil = T+1`; stored `SUSPENDED`.
- **T+1, phase 5 step 2.** Resume: `anim`, `sound_synth`, `~tutorial_please_wait_firemaking`, `p_delay(3)` (line 30): `delayedUntil = (T+1) + 1 + 3 = T+5`. The *same* `ScriptState` is stored again (`Player.ts:2217`) with `pc` at line 30.
- **T+2..T+4.** Delayed; nothing.
- **T+5.** Resume: `sound_synth`, `p_delay(2)` (line 32): `delayedUntil = T+5+1+2 = T+8`.
- **T+8.** Resume: `anim(null)`, `~push_player`, `~tut_firemaking_success`: `obj_del`, XP, `loc_add(... fire ... 150)`, then `world_delay(150)` (line 86): `execution = WORLD_SUSPENDED` with 150 left on the int stack. `Player.executeScript` calls `World.enqueueScript(script, script.popInt())` (`Player.ts:2212-2213`): world queue entry with delay 151. The player is not delayed: `world_delay` sets no player state and `activeScript` is not assigned in this branch. (The old reference in `player.activeScript` is not cleared on this path; its `execution` is `WORLD_SUSPENDED`, which no player-side test matches (`World.ts:695`, `Player.ts:775`, `ResumePauseButtonHandler.ts:8`), so it is inert. **Inference.**)
- **T+9 on, phase 1.** Each tick `processWorld` visits the entry and post-decrements (`World.ts:535-540`). It runs on the visit where the old value is `<= 0`: **T+8+150+2 = T+160** by the d+2 reading (Finding 13). `ScriptRunner.execute` resumes after `world_delay` and runs `obj_add(... ashes ...)` (line 87). No protected-player access in this tail: `runScript` removed the `ProtectedActivePlayer` pointer when the earlier run finished (`Player.ts:2189-2192`), and `obj_add` does not need it. `FINISHED` -> the entry is unlinked (`World.ts:546`).

Net: `p_delay` blocks the player and returns to *phase 5* of a later tick; `world_delay` unblocks the player immediately and returns to *phase 1* of a much later tick. Read, not observed.

### Example 8: the `p_oploc` loop (woodcutting) — a repeat without a delay

`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:55-62,73-78`
```
55 if (%action_delay < map_clock) {
...
59     %action_delay = calc(map_clock + 3);
60     p_oploc(1);
61     return;
62 }
...
73 mes("You swing your axe at the tree.");
74 if (%action_delay = map_clock) {
75     @get_logs($data, $axe);
76 }
78 p_oploc(3);
```
This is traced tick by tick in [`docs/tick/scenarios.md`](../../tick/scenarios.md) scenario 1 (rows A, A+1, A+2, A+3 at `scenarios.md:52-63`) and [`docs/flows/click-loc-woodcutting.md`](../../flows/click-loc-woodcutting.md). The mechanism, re-read: `p_oploc(n)` returns early if the loc lacks that op, otherwise `stopAction()`, a waypoint if not in operable distance, and `setInteraction(Interaction.SCRIPT, loc, APLOC1 + type)` (`PlayerOps.ts:387-401`). `tryInteract` stores the target the script set into `nextTarget` (`Player.ts:1171-1182`), and `processInteraction` ends with `if (this.nextTarget) this.target = this.nextTarget;` (`Player.ts:1300-1303`); the new interaction is first tried on the next tick (06 rule 19). **The script itself never suspends**: the "waiting" is the pause between ticks and the `%action_delay` / `map_clock` comparison in the script.

---

## Inferences (labelled)

- **I1. `p_delay(n)` resumes in phase 5 step 2 of tick T+1+n** (Finding 11), and `npc_delay(n)` in phase 4 of T+1+n (Finding 12). Rests on `PlayerOps.ts:378`, `World.ts:692-697`, `NpcOps.ts:99`, `Npc.ts:112-117`, `World.ts:503`. Not observed.
- **I2. A dialogue can add "ticks" only when the client says so**; server ticks pass without anything being resumed (Findings 8, 10). Rests on the resume table.
- **I3. The queue entry in Example 2 runs on the tick the dialogue closes** (counter ticks while blocked). Rests on `Player.ts:903-904`.
- **I4. A weak-queue chain with delay d advances every d+1 ticks** (Example 4). Rests on 05 rules 11-13.
- **I5. At most one suspended script per player** (`activeScript` is one field) and a second suspension on the same player would overwrite the first (Finding 23). Not tested, and whether content can trigger it is open.
- **I6. `world_delay` lets the player continue at once** and the tail runs in phase 1 as the d+2 tick (Example 7). Rests on `Player.ts:2212-2213`, `World.ts:535-557`.
- **I7. Walking away from a conversation abandons it** (Findings 16-17): based on `MoveClickHandler` -> `clearPendingAction` -> `closeModal` -> `activeScript = null`. The client's own behaviour (whether it also closes the chat window) was not read.
- **I8. Suspending in a context that does not store the state loses the script** (Finding 22). Based on the ignored return values.

## Not checked / open questions

Each item says what is needed to resolve it. Items also tracked in `docs/open-questions.md` carry the number.

1. **Nothing was run.** All tick numbers (T+1+n, T+d+2, T+d+1 for weak chains, timers) are inferences from code. To resolve: run the server with `[debugproc,delay]` (`Content/scripts/_test/scripts/engine/debug_delay.rs2:1-7`, which calls `p_delay($delay)`) or logging in `World.cycle` and observe the tick at which the resume happens. #16 stays open.
2. **`world_delay(d)` = d+2 vs content comments** (`necromancer_tower.rs2:61` comment says 2 ticks for `world_delay(1)`): #19. Needs a run.
3. **Which client action sends `IF_BUTTON` vs `RESUME_PAUSEBUTTON`** for continue/choice/skill-multi buttons. Only the two send sites in `Client.ts:9190-9196` and `:3042-3043` were read, not the component button-type table or `MiniMenuAction.PAUSE_BUTTON` assignment. Needs reading `Client-TS` where `MiniMenuAction.PAUSE_BUTTON` is chosen and the `IfButton` send site.
4. **What happens client-side when the chat interface is closed by the server** (`IfClose` after `closeModal`) and whether the client sends a `CLOSE_MODAL` packet on its own (e.g. pressing Escape or clicking elsewhere) was not read. Needs reading `Client.closeModal` and callers.
5. **Whether `processInteraction`/`tryInteract` re-arm interplays with suspended op scripts** beyond the sequence in Example 1/2 (an op script that calls `p_delay` and then `p_oploc` before returning) was not traced for every combination; 06 rules 19 and the `Not checked` there apply. In particular `ap`-range scripts that suspend (06 rule near `:329`).
6. **`openshop_activenpc`, `~tutorialstep`, `~damage_self`, `~macro_events_varps_reset`** and similar procs called in the examples were not read; any `p_delay` or modal they perform would change the timelines. Needs reading those procs.
7. **Whether any content path hands a `PAUSEBUTTON`/`COUNTDIALOG` state to the world queue** (processWorld has no branch for those, Finding 7), or runs a suspending command in an unprotected context (soft timer, `IF_CLOSE`, logout, walk-trigger scripts): #30. Needs compiler read (`RuneScriptTS/src`, not read) or a content grep for `p_delay` under `[softtimer,...]`, `[if_close,...]`, `[logout]`, `[walktrigger]`.
8. **Stale `resumeButtons`**: entries are cleared only at script end or on a dropped dialogue (`Player.ts:453,455,777,2017,2222`); they are not cleared on each resume. **Inference** only: a later `PAUSEBUTTON` in the same script could be resumed by a click on an earlier choice button if that component were still visible. Not tested; component visibility (`isComponentVisible`) would normally prevent it. Needs a trace of a choice followed by another dialogue.
9. **NPC `npc_arrivedelay` branch of Example 6** (`lastMovement` for NPCs: where it is set) was not traced.
10. **Friend-server `RELAY_QUEUESCRIPT`** timing relative to the tick: #50 (`World.ts:2065-2075`).
11. **Timer iteration order and same-pass additions** (`Map` iteration): #48.
12. **Logout script content** and whether it can suspend (Finding 20) was not read.
13. **The `ScriptProvider`/compiler side** (how `settimer(macro_maze, 5)` resolves the timer script id; how `queue` arguments are type-checked) is outside this note: `RuneScriptTS` and `ScriptProvider.ts` were not read. #15.
14. **The `ScriptPointer` checks** (which commands need `ProtectedActivePlayer` at run time) were not read, only that `p_delay`'s handler has no pointer check (`PlayerOps.ts:376-380`).
15. **`docs/tick/*.md` line numbers** other than the ones re-read here were not rechecked; this note relies only on those listed above.

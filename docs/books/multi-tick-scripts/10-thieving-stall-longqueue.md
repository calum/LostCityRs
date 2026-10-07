# Chapter 10: Thieving stall cooldown (`longqueue` as a persistent timer)

**Question answered:** How does this script run across many ticks: what suspends it, what resumes it, which engine phase runs each piece, what state survives between ticks, what interrupts it, and what can the player do meanwhile?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---


**Question answered:** Stealing from a stall makes the stall's owner hostile to you for ~1000-1500 ticks (10 to 15 minutes at 600 ms per tick; an earlier draft wrongly said 25 minutes). Where is that memory kept, what happens to it when you log out and in, and why is it a `longqueue` with `^discard` rather than a timer or a plain `queue`?

**Based on commits:** Engine-TS `1d25566c`, Content `65b754f76`. **Method:** read, not observed.

## 6.1 The scripts

The theft (reached from `[oploc2,*_stall*]` -> `@attempt_steal_from_stall`, `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:1-84`):

```
// Content/scripts/skill_thieving/scripts/thieving.rs2:61-72
  61  p_arrivedelay;
  62  def_int $experience = db_getfield($data, stealing:experience, 0);
  63  // osrs is 2x respawn speed, since they removed the scale by playercount
  64  def_int $respawn_ticks = ~scale_by_playercount(db_getfield($data, stealing:respawn_ticks, 0));
  65  anim(human_pickuptable, 0);
  66  sound_synth(pick, 1, 0);
  67  // p_delay here was added with this update: https://oldschool.runescape.wiki/w/Update:Special_Attacks
  68  p_delay(0); 
  69  switch_loc (loc_type) {
  70      case bakers_stall_stealing : 
  71          longqueue(stolen_from_stall_baker, ^baker_stall_timer, 0, ^discard);
  72          %thieving_stall_timer = setbit(%thieving_stall_timer, ^baker_stall_index);
```

```
// Content/scripts/skill_thieving/scripts/thieving.rs2:96-102
  96          %thieving_stall_timer = setbit(%thieving_stall_timer, ^vikingfish_stall_index);
  97  }
  98  ~stealing_check_for_reward($data);
  99  stat_advance(thieving, $experience);
 100  // Temp note: dur does not need updated
 101  if(loc_type = viking_fur_market | loc_type = viking_fish_market) loc_change(viking_market, $respawn_ticks);
 102  else loc_change(market, $respawn_ticks);
```

The expiry script and the login re-arm:

```
// Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:124-127
 124  [proc,thieving_stall_timers_login]
 125  if (testbit(%thieving_stall_timer, ^baker_stall_index) = ^true) {
 126      longqueue(stolen_from_stall_baker, ^baker_stall_timer, 0, ^discard);
 127  }
```

```
// Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:154-157
 154  // these are longqueues in osrs - they affect movement when p_delay'd
 155  
 156  [queue,stolen_from_stall_baker]
 157  %thieving_stall_timer = clearbit(%thieving_stall_timer, ^baker_stall_index);
```

Durations (`Content/scripts/skill_thieving/configs/stalls/stealing.constant:1-10`): baker 1500, tea/silk/fur/silver/gem/viking-fur 1000, spice 600, viking-fish 1500 (`^baker_stall_timer = 1500` etc.). The `longqueue` logout actions are constants: `^accelerate = 0`, `^discard = 1` (`Content/scripts/engine.constant:43-45`).

Who reads the cooldown (the stall owner NPC) and the owner's reaction:

```
// Content/scripts/areas/area_ardougne_east/scripts/baker.rs2:1-4
   1  [opnpc1,baker_merchant]
   2  if (getqueue(stolen_from_stall_baker) > 0) {
   3      @stall_owner_alert_guards;
   4  }
```

The owner's reaction is `[label,stall_owner_alert_guards]` (`Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:111-122`): `npc_say`, `p_delay(1)`, `npc_say`, then `npc_huntall` and `~npc_retaliate` for nearby guards.

Login hook: `Content/scripts/login_logout/login.rs2:67` (`~thieving_stall_timers_login;`, in the login trigger run at `Engine-TS/src/engine/entity/Player.ts:524-528`). The varp is `[thieving_stall_timer] scope=perm` (`Content/scripts/_unpack/225/all.varp:168-169`). The contrasting `^accelerate` user: `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:148`, `longqueue(hide_rashiliyia_doors, 50, 0, ^accelerate);`.

## 6.2 Walkthrough

1. **Steal.** `attempt_steal_from_stall` checks (members world, combat, level, inventory space), then `~steal_from_stall`: guard and owner checks (`npc_say`, retaliation) and `p_arrivedelay` (line 61): a one-tick delay unless the player's last step was before the previous tick (E2: `lastMovement < currentTick` returns; `lastMovement` is set to `currentTick + 1` on a tick with steps, `Engine-TS/src/engine/entity/Player.ts:694-696`). Then `anim`, `sound_synth`, **`p_delay(0)`** (line 68; the comment cites an OSRS update).
2. **Next tick (phase 5 step 2): the cooldown is recorded twice.** `longqueue(stolen_from_stall_baker, ^baker_stall_timer, 0, ^discard)` (line 71) and `%thieving_stall_timer = setbit(...)` (line 72). Then `~stealing_check_for_reward`, XP, and `loc_change(market, $respawn_ticks)`: the stall loc is swapped for an empty one and reverts after the respawn time (a loc timer in phase 8, not traced here).
3. **What a `longqueue` is.** `LONGQUEUE` stores the entry as type `LONG` with args `[logoutAction, arg]` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:172-181`) in the normal `queue` list (E7). `^accelerate = 0`, `^discard = 1` (`Content/scripts/engine.constant:44-45`). When it is due, `processQueue` removes the `logoutAction` from the args (`request.args.shift()`, `Engine-TS/src/engine/entity/Player.ts:907-909`) and runs the script with the remaining args.
4. **Expiry.** 1500 visits later (pre-decrement value 0 on the 1501st visit; E7) `[queue,stolen_from_stall_baker]` clears the varp bit (`Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:156-157`). Until then, `getqueue(stolen_from_stall_baker)` is > 0: that command counts entries with that script id in both `queue` and `weakQueue` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:960-975`), which is how the baker NPC's `[opnpc1]` knows (`Content/scripts/areas/area_ardougne_east/scripts/baker.rs2:2`) and reacts with `@stall_owner_alert_guards` (npc_say, **`p_delay(1)`**, npc_say, guards retaliate; `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:111-122`).
5. **Logout.** `processLogouts`: while the player is logging out it calls `closeModal()` and scans the normal queue; a `LONG` entry whose `logoutAction` is `1` (`^discard`) counts as discardable, anything else makes removal wait (`Engine-TS/src/engine/World.ts:765-779`). With only discardable entries (and `canAccess()` and an empty engine queue) the logout trigger runs and the player is removed, taking the queue with it (`removePlayer`, not traced). The bit in the perm varp is what survives.
6. **Login.** `~thieving_stall_timers_login` re-creates a `longqueue` for each set bit, with the **full** duration constant again (`Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:124-151`). So the cooldown restarts at its full length after each login (inference, below).

## 6.3 Tick timeline (S = tick the op script runs in phase 5 step 8)

| tick | phase | what happens | source |
|---|---|---|---|
| S | 5/8 | Op script (protected): checks, guard/owner checks, `p_arrivedelay` (delays only if the player moved recently), animation, `p_delay(0)` -> resume at S+1 (S+2 if `p_arrivedelay` delayed one tick) | `Content/scripts/skill_thieving/scripts/thieving.rs2:56-68`, E2 |
| S+1 | 5/2 | Resume: `longqueue(..., 1500, 0, ^discard)` appended with delay 1500; varp bit set; reward; XP; stall loc swapped | `Content/scripts/skill_thieving/scripts/thieving.rs2:69-102` |
| S+1 | 5/3 | Queue pass: new entry visited (it was enqueued in step 2, before the pass): pre-value 1500 -> 1499 | `Engine-TS/src/engine/entity/Player.ts:897-913` |
| S+2 .. S+1500 | 5/3 | pre-value counts down every tick, whether or not the player is accessible | E7 |
| S+1501 | 5/3 | pre-value 0: entry runs (protected, if `canAccess()`; otherwise on the first accessible visit): bit cleared | `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:156-157` |
| any tick in between | 5/8 | `[opnpc1,baker_merchant]`: `getqueue(...) > 0` -> the owner shouts (`p_delay(1)` inside the op script -> 2 ticks) | `Content/scripts/areas/area_ardougne_east/scripts/baker.rs2:1-4`, `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:111-122` |
| L | 6 | Logout requested, `loggingOut = true`; entry is `LONG`/`^discard`, so removal is not blocked by it | `Engine-TS/src/engine/World.ts:765-779` |
| next login | 5/ (login trigger, run in the login tick) | `thieving_stall_timers_login`: `longqueue(..., 1500, 0, ^discard)` again for every set bit | `Content/scripts/login_logout/login.rs2:67`, `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:124-151` |

## 6.4 What persists between ticks and sessions

- Between ticks in a session: the `PlayerQueueRequest` in `player.queue` (script id, args, remaining delay counter).
- Across sessions: only `%thieving_stall_timer` (perm). The queue entry is not saved; the login hook rebuilds it from the bit.
- Bits are 1..9 per stall (`Content/scripts/skill_thieving/configs/stalls/stealing.constant:12-21`), packed in one varp via `setbit`/`testbit`.

## 6.5 What interrupts it / what the player can do meanwhile

- Nothing the player does cancels the entry: `closeModal()` clears only the weak queue (E6) and this entry is in `queue`. `clearqueue` for the script id is a script command (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1102-1104`, 05#12) and no script here calls it.
- It does not delay or block the player. One engine rule makes a non-empty normal or engine queue matter: `updateMovement` refuses a click-move when `moveClickRequest && busy() && (queue.head() != null || engineQueue.head() != null)` (`Engine-TS/src/engine/entity/Player.ts:674-678`, with the comment "players cannot walk if they have a modal open *and* something in their queue, confirmed as far back as 2005"). A pending 1500-tick LONG entry therefore counts as "something in their queue" for that rule. The content comment at `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:154` ("these are longqueues in osrs - they affect movement when p_delay'd") seems to refer to this kind of effect. How often a player is `busy()` with a pending click at that step in practice is not determined here.
- The owner NPC's `p_delay(1)` shout is an ordinary op-script delay: clicks dropped for two ticks (E5).

## 6.6 Gotchas verified in code

1. **A plain `queue` would have trapped the player at logout.** Any non-`LONG` or non-discard entry in `queue` stops `processLogouts` removing the player until it has run (`Engine-TS/src/engine/World.ts:766-779`). That is what chapter 5's `queue(shilo_mist_queue, 16, 0)` does; the stall cooldown avoids it with `^discard`.
2. **`^accelerate` is the opposite**: while `loggingOut`, `processQueue` sets the delay of a `LONG` entry with `logoutAction == 0` to 0 (`Engine-TS/src/engine/entity/Player.ts:898-901`), so it runs at the player's next accessible queue visit, and it also blocks removal until it has run. `hide_rashiliyia_doors` (50-tick delay, `^accelerate`) therefore runs immediately when the player logs out inside those 50 ticks. (Engine facts; the reason the content author chose it is not stated in the script.)
3. **The arguments are shifted before the script runs**: `args = [logoutAction, arg]`, and `request.args.shift()` is executed only for `LONG` entries when they run (`Engine-TS/src/engine/entity/Player.ts:907-909`), so `[queue,...]` script parameters never see `logoutAction`. The shift happens after the entry is unlinked and only on the normal queue path; a `LONG` entry that is dropped at logout never runs.
4. **The delay counter is in ticks of visits, not wall time.** It also counts while the player is delayed or in a dialogue; it does not count while the player is offline (the entry is gone).
5. **`getqueue` counts weak entries too** (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:960-975`) and matches by script id only, so it would also see a `weakqueue` of the same script.
6. **Two `p_delay`s with different roles in one flow**: the thief's `p_delay(0)` (an animation beat) and the owner's `p_delay(1)` (a pacing beat between two `npc_say`s); both are ordinary E2 delays.

## 6.7 Inferences (labelled)

- **Inference:** after a logout/login the stall owner stays hostile for another full 1500 ticks (not the remaining time), because the hook passes the constant and not a stored remainder. Rests on `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:124-151`, `Engine-TS/src/engine/entity/Player.ts:897-913` (queue counter starts from the passed delay) and the absence of any remainder variable in the files read.
- **Inference:** if the player logs out while the cooldown entry is pending and their normal queue contains nothing else, removal is not delayed by it. Rests on `Engine-TS/src/engine/World.ts:766-779`.
- **Inference:** two thefts from the same stall within the cooldown add a second queue entry (the command appends; no replace), so `getqueue` returns 2 and the bit is cleared by the first expiry although the second entry is still pending. Rests on `enqueueScript` appending (`Engine-TS/src/engine/entity/Player.ts:841-851`) and the expiry script clearing the bit unconditionally; whether the loc state prevents a second theft within the window (the stall is swapped for an empty loc for the respawn time) was not checked, so this may never occur.

## 6.8 Not checked / open questions

- `removePlayer` and how the save drops queues; the login-time ordering of `~thieving_stall_timers_login` relative to the first queue pass (the login trigger runs in `onLogin`, phase 7, 07-logouts-logins).
- `stealing_check_for_guard`/`owner` details and the guard retaliation (`~npc_retaliate`), the loc respawn timers, `stat_random` odds.
- Other `longqueue` users (corrected: `grep -rl longqueue Content/scripts` also finds `keg_of_beer.rs2`, `quest_horror`, `quest_tbwt`, `quest_viking`, `game_mortton`, `quest_mortton`, `quest_zombiequeen` and a test script; an earlier draft said only thieving and Zombie Queen): not read.
- Nothing was run.

---

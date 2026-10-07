# Chapter 11: Patterns catalogue and consolidated not-checked list

**Question answered:** Comparing the mechanisms used in chapters 5-10, when do content authors seem to choose each one (labelled inference), and what was left unchecked?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---

# Part C. Patterns catalogue (inference, resting on the chapters)

**Label:** everything in this part is **inference** from the facts in chapters 1-6 and rules E1-E12. The "why authors choose it" column in particular is a reading of the scripts and their comments, not something the code states.

## C.1 The mechanisms side by side

| Mechanism | Used in | Who/what runs it, and when | State kept between ticks | What blocks it | What cancels it | Player input meanwhile |
|---|---|---|---|---|---|---|
| **Suspend: `p_delay(n)` / `p_arrivedelay`** | ch 1 (timer script), 2, 4, 5, 6 | The same `ScriptState`, resumed at phase 5 step 2 of tick T+1+n (E1, E2) | The whole `ScriptState` in `player.activeScript` (pc, locals, frames, pointers); `delayed`, `delayedUntil` | Nothing: resume is forced and happens before queues/timers (E1, E3) | Only `closeModal` for `PAUSEBUTTON`/`COUNTDIALOG`, not for `SUSPENDED` (E6); logout waits (E4) | Move/op packets dropped (E5); normal timers, queues, engine queue wait; soft timers still fire (E4, E8) |
| **Suspend: `p_pausebutton` / `p_countdialog`** (dialogues, choices) | ch 1, 3, 4, 5 | Same script, resumed by a phase-2 packet with `force` (`Engine-TS/src/network/game/client/handler/IfButtonHandler.ts:26-29`, `Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:8-12`) | Same as above; `resumeButtons`; a CHAT or MAIN modal (so `busy()`) | Waiting for the packet; the modal makes the player busy (E4) | Walking, op packets, `CLOSE_MODAL`, opening another chat modal: all drop the script (E6) | May click Continue, choose, walk away (which abandons it) |
| **`queue(script, d)`** (NORMAL) | ch 1 (NPC -> player), 2, 4 (zone chain), 5, 6 (LONG variant) | A fresh `ScriptState` from `ScriptFile` + args at phase 5 step 3 (E7) | The entry (`ScriptFile`, args, delay counter) | `canAccess()` (E4), but the counter keeps running | Not cleared by moves (E6); only `clearqueue` or logout drop it | Free; but a pending normal/engine queue entry plus a modal changes walking (`Engine-TS/src/engine/entity/Player.ts:674-678`) |
| **`weakqueue(script, d)`** | ch 3 | Same pass as `queue`, but after it (E7) | Same | `canAccess()` | **Any** `closeModal()` with the default argument: every accepted move/op packet, `if_close`, `CLOSE_MODAL`, logout (E6) | Free, but any "deliberate" input cancels it |
| **`longqueue(script, d, ..., logoutAction)`** | ch 6, ch 4-5 comparison | Normal queue pass; special at logout (`Engine-TS/src/engine/entity/Player.ts:898-901`, `Engine-TS/src/engine/World.ts:766-779`) | Entry in `queue` (args `[logoutAction, ...]`) | `canAccess()` | Logout with `^discard` drops it; with `^accelerate` it runs first | Free |
| **Engine queue via `[zone]` / `[mapzone]` / `[...exit]` triggers** | ch 1, 2, 4 | Phase 10 detects the change and enqueues; phase 5 step 5 of a later tick runs it (E9) | Entry in `engineQueue` | `canAccess()`: waits behind dialogues, delays, protect | None found; they pile up | Free; the effect is late if the player is busy |
| **Player timer: `settimer(t, n)` / `softtimer`** | ch 1 (500-tick poll, maze countdown), 4 (bridge) | Phase 5 step 4 (normal) / after it (soft) when `currentTick >= clock + n`; clock reset before the run (E8) | Map entry (`script`, `args`, `interval`, `clock`) | Normal: `canAccess()`; soft: nothing (E8) | `cleartimer`; replaced by another `settimer` for the same script id; not run while `loggingOut` | Free |
| **NPC `ai_timer` / `npc_queue` / `npc_delay`** | ch 1, 2 | NPC turn in phase 4 (E11) | NPC's own `timerClock`, queue, `varn`s, `delayedUntil`, `activeScript` | NPC `delayed` (queue/timer clocks freeze), `isActive` | `npc_del`, `npc_settimer(0)`, `resetEntity(true)` | Clicks on a delayed NPC are refused (`Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:27-31`) |
| **`world_delay(d)`** | ch 5 | Phase 1 `processWorld` (E10) | A `ScriptState` in `World.queue` only | Nothing player-related | Error in script (swallowed); nothing else found | Unaffected: it is not the player's script |
| **Re-arm through the interaction system (`p_oploc`, `p_opnpc`)** | not in these chapters; see [`flows/click-loc-woodcutting.md`](../../flows/click-loc-woodcutting.md) | Phase 5 step 8 each tick (`processInteraction`) | The player's `target`/`targetOp` | Interaction validation, `canAccess()` | Any new move/op packet (`clearPendingAction`) | Free; a new click replaces the target |

## C.2 When do authors seem to choose which? (inference, with the facts it rests on)

1. **"One thing, then a beat, then another thing": suspend with `p_delay`.** Rests on: the cutscene (ch 4: 13 `p_delay` calls in one script), `p_delay(0)`/`(1)` between an animation and its effect in thieving (ch 6, `Content/scripts/skill_thieving/scripts/thieving.rs2:65-68`), and the Content comments `// 1t`/`// 2t` next to them (`Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:53`, `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:61`, `Content/scripts/quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:687`). The player is deliberately locked for the duration (E5), which is what a cutscene or an animation wants.
2. **"Do this later, and don't make the player wait for it": `queue`.** Rests on: damage applied through `queue(damage_player, 0, n)` from other scripts (ch 5, ch 2 `mime_step_right_up`), the NPC-to-player hand-off in the old man's failure path (ch 1), and the 16-tick `queue` in ch 5. A queue entry does not set `delayed`/`protect` (E3 applies only to suspended scripts) and, outside the pass, the player may move.
3. **"Repeat while the player keeps doing nothing else": `weakqueue`.** Rests on: pottery's re-arming chain (ch 3), the engine rule that every default `closeModal()` clears the weak queue (E6), and the comment-less but consistent use of `weakqueue*` in crafting, fletching and smithing (grep, introduction). The "cancel when the player does anything" behaviour comes for free from the engine. A `queue` chain would not stop on movement.
4. **"Remember this for a long time, even across logout": `longqueue` + a perm varp bit.** Rests on: ch 6 (1000-1500-tick cooldowns, `^discard`, rebuilt at login from the bit) and the logout rule that plain `queue` entries block removal (`Engine-TS/src/engine/World.ts:766-779`). A plain `queue` of 1500 ticks would keep a logged-out player online for up to 1500 ticks.
5. **"Do something when the player arrives or leaves a place": zone triggers (engine queue).** Rests on: the maze and mime arm their timers there (ch 1, 2), the bridge arms/clears its poll on `[zone]`/`[zoneexit]` (ch 4), and the exit trigger resets state (maze, mime, `exit_ah_za_rhoon`). Authors can rely on "enter -> run once, when the player is accessible".
6. **"Poll while in a state": `settimer`.** Rests on: the maze countdown (5 ticks), the bridge poll (3 -> 20 ticks), the 500-tick random-event roll (ch 1). The timer is armed by an event and re-set from inside its own script to change the cadence (bridge success path). Normal timers tolerate lateness (no catch-up) and are blocked while busy, which suits "slowly drains" effects (maze percent).
7. **"A non-player actor drives the beat": NPC `ai_timer`/`npc_queue`.** Rests on: the old man's 20-tick escalation and the Mime's 2-tick director (ch 1, 2). The actor reads shared state in NPC varns and writes player state by `queue`/direct varp writes after `finduid`/`huntnext`.
8. **"Something must outlive its player or its script": `world_delay`.** Rests on: the mist (ch 5) and firemaking's ash/fire timer (`firemaking.rs2:130-131`, whose comment complains the engine's `world_delay` is slow by 2 ticks; E10 gives the d+2 rule).

## C.3 Combined behaviours worth remembering

- **A suspended script and a queued script are two different things on the same player.** The suspended one lives in `activeScript` and blocks everything else via `delayed`/`protect`; the queued ones live in lists and wait. A queued script that itself calls `p_delay` becomes the `activeScript` (05#14).
- **There is only one `activeScript` slot.** `Player.executeScript` assigns it with no check (E3). If a second suspending script is started while one is waiting (for example a soft timer, which is not gated, that suspends), the first is overwritten (inference from `Engine-TS/src/engine/entity/Player.ts:2216-2218`; no such script found in these chapters, and `p_delay` in an unprotected script may be rejected by the compiler: 05 open question #30).
- **Order inside a tick decides same-tick vs next-tick:** NPC scripts (phase 4) queue onto players who handle them in the same tick; a player script queueing onto itself during step 3 sees the new entry only next tick if it was the last queue node (E7); an engine-queue script (step 5) that queues a normal entry waits for the next tick (ch 4 table T+26 -> T+27).
- **Packets are dropped, not buffered, while delayed; dialogues are abandoned, not paused, by input** (E5, E6). Both are "forgiving for the engine, final for the player".
- **Late is not skipped.** Queue entries, engine-queue entries and normal timers that fall due while the player is blocked run on the first accessible visit (E7, E8); the one thing that is dropped is a *weak* entry, by `closeModal`.

---

# Part D. Consolidated "not checked" list

- Nothing was run: every tick number above is arithmetic from the code ("read, not observed"); the arrival window of packets within the 600 ms tick (scenarios.md "Arrival time" paragraphs) applies to every packet-driven step here.
- Content not read: maze doors and chests, the other three old-man events beyond their spawn lines, other `weakqueue*` users (glass, leather, jewellery, fletching, smelting), other `longqueue` users, all other quests and minigames, tutorial island, boardgames, duel arena, NPC combat AI.
- Engine not read: `removePlayer`/player save and load (which varps persist), `PlayerHuntAllCommandIterator`, loc/obj/item op handlers, client code (what the client does with `tele`/`jump`, camera packets, `UNSET_MAP_FLAG`).
- VM/compiler: whether `p_*` commands in unprotected contexts are rejected: answered in [Book 2 section 4.4](../runescript-intro/04-pointers-and-protected-access.md) (compile error for `p_delay` in soft-timer/`IF_CLOSE` triggers; `queue`/`settimer` allowed); script pointer checks for resumed world-queue scripts.
- Configs: which file supplies the `macro_mime` NPC type at revision 274 (chapter 2.8); `lastMapZone` initial value.
- Doc rules from `docs/tick/05-players-queues-timers.md` and `docs/tick/01-world.md` that these chapters rely on (05#4-5, 05#8, 05#10-14, 05#16-22, 01#3-4, 01#6-7) were re-read against the cited source lines at `1d25566c`; no mismatch was found. Line numbers of doc 04/06/07/10 rules were used only as pointers.

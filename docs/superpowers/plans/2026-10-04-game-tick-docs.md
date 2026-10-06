# Game Tick Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verified, cited documentation of what one game tick consists of, at three levels (L1 overview, L2 per-phase sub-steps, L3 ordering rules), by reading the code only.

**Architecture:** One note per phase of `World.cycle()`, traced in tick order. L2 (ordered sub-steps) and L3 (ordering rules) live in each phase note. A cross-phase ordering matrix and worked scenarios cross-check them. L1 is written provisionally first, then regenerated from the verified notes. A small script mechanically checks citations so wrong line numbers and stale commit hashes are caught.

**Tech Stack:** Markdown, Python 3 (Git Bash `python3`) for the citation checker, `git`, `grep`/Grep tool. Source under `Engine-TS/`, with `Content/` and `Client-TS/` only when a flow crosses into them.

**Spec:** `docs/superpowers/specs/2026-10-04-game-tick-docs-design.md`

## Global Constraints

- Method is **reading code only**. Do not run the server. Do not edit submodules. Label every L3 claim "read, not observed".
- **Never guess.** Say "not verified" and add the item to `docs/open-questions.md` (CLAUDE.md).
- Every factual claim cites `Repo/path/file.ts:line` (full path from the repo root, backticked) and the note records the repo commit (`git -C <Repo> rev-parse --short HEAD`).
- Re-grep line numbers just before saving each note; do not cite from memory or an earlier `sed` range.
- Comments in the code are claims to verify against the code, not facts.
- Separate findings, labelled inferences, and "not checked".
- Stop at subsystem boundaries (RuneScript execution internals, login/logout persistence, logger thread, client rendering) and log an open question.
- Documentation goes in this container repo's `docs/`, never in submodules.
- **Never `git push`. Commit only when the user asks.** Steps below say "stage nothing; do not commit" accordingly.
- Notes are only valid at recorded commits. Baseline at planning time: Engine-TS `1d25566c`, Content `65b754f76`, Client-TS `7d6ca61`. If `git rev-parse --short HEAD` differs when you start a task, re-verify the cited lines and say so in the note.
- Depth: NPC phases get the same L2 and L3 depth as player phases. `processWorld`, `processZones`, `processInfo`, `processClientsOut`, `processCleanup` get L2, plus L3 where they affect ordering (spec assumption, pending user confirmation).

## Review Focus

Failure modes the notes are most likely to get wrong, each pinned to the task that owns it:

1. A comment in `World.cycle()` or a phase body says X happens but the code does a different order. Pinned: every phase task has a step "compare each comment with the code and record mismatches".
2. The same player/NPC state is touched in two phases (a packet in `processClientsIn` sets a target, `processPlayers` consumes it on the same tick). Pinned: ordering matrix (Task 13) and the scenarios (Task 14).
3. Iteration order within a phase (player loop order, NPC loop order, zone order) is stated without reading how the loop is built. Pinned: Tasks 3, 5, 6, 9, 10.
4. Anything that happens "next tick" versus "this tick" (delays, queue delay counters, `delayedUntil`). Pinned: Tasks 5, 6 and 7, and scenario timelines name the tick number of each step.
5. Behaviour on the exceptional path: a player who throws during `processPlayers` is logged out (`World.ts:727-732`), and an error in `cycle()` removes everyone and exits (`World.ts:509-526`). Pinned: Task 12.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/tools/check_citations.py` | Mechanically checks cited paths, line numbers, quoted snippets and recorded commit hashes in notes. |
| `docs/tick/_template.md` | Skeleton every phase note is copied from. |
| `docs/tick/00-overview.md` | L1. |
| `docs/tick/01-world.md` … `docs/tick/11-cleanup.md` | One note per phase (see tasks). |
| `docs/tick/ordering-matrix.md` | Phase-by-state read/write table. |
| `docs/tick/scenarios.md` | Worked tick-by-tick timelines. |
| `docs/README.md` | Index entries (modify). |
| `docs/open-questions.md` | Add/resolve items (modify). |

Note numbering follows tick order: 01 world, 02 clients-in, 03 npc-event-queue, 04 npcs, 05 players-queues-timers, 06 players-interaction-movement, 07 logouts-logins, 08 zones, 09 info, 10 clients-out, 11 cleanup-and-tail.

---

### Task 1: Citation checker, note template, provisional L1

**Files:**
- Create: `docs/tools/check_citations.py`
- Create: `docs/tick/_template.md`
- Create: `docs/tick/00-overview.md`

**Interfaces:**
- Produces: `python3 docs/tools/check_citations.py <note.md>...` exits 0 when every check passes, 1 otherwise, printing one line per failure. Checks:
  1. each backticked citation `` `Repo/path:line` `` or `` `Repo/path:a-b` `` (Repo in Engine-TS, Content, Client-TS, RuneScriptTS) names an existing file and a line within its length;
  2. when the line after a citation is a code fence, every non-blank snippet line (stripped, skipping lines that are `...` or `// ...`) occurs in the cited file within `[a, max(b, a+snippet_lines+2)]`;
  3. each note line `- <Repo>: `<hash>`` matches the repo's current `HEAD` by prefix.
- Produces: `docs/tick/_template.md`, copied by Tasks 2 to 11.

- [ ] **Step 1: Write the checker**

Create `docs/tools/check_citations.py`:

```python
#!/usr/bin/env python3
"""Check citations in docs notes against the submodule sources. See docs/tick/_template.md."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPOS = ("Engine-TS", "Content", "Client-TS", "RuneScriptTS")
CITE = re.compile(r"`((?:%s)/[^`:\s]+):(\d+)(?:-(\d+))?`" % "|".join(REPOS))
COMMIT = re.compile(r"^- (%s): `([0-9a-f]{7,40})`" % "|".join(REPOS))
SKIP = {"...", "// ..."}


def head(repo):
    return subprocess.check_output(["git", "-C", str(ROOT / repo), "rev-parse", "HEAD"], text=True).strip()


def check(note):
    errors = []
    lines = note.read_text(encoding="utf-8").splitlines()
    cache = {}

    def src(rel):
        if rel not in cache:
            p = ROOT / rel
            cache[rel] = p.read_text(encoding="utf-8", errors="replace").splitlines() if p.is_file() else None
        return cache[rel]

    for i, line in enumerate(lines):
        m = COMMIT.match(line)
        if m and not head(m.group(1)).startswith(m.group(2)):
            errors.append(f"{note}:{i+1}: {m.group(1)} recorded {m.group(2)} but HEAD is {head(m.group(1))[:8]}")
        cites = list(CITE.finditer(line))
        for c in cites:
            rel, a = c.group(1), int(c.group(2))
            b = int(c.group(3)) if c.group(3) else a
            code = src(rel)
            if code is None:
                errors.append(f"{note}:{i+1}: no such file {rel}")
                continue
            if a < 1 or b < a or b > len(code):
                errors.append(f"{note}:{i+1}: {rel}:{a}-{b} outside file length {len(code)}")
        # a citation followed directly by a code fence: snippet must be in the cited range
        if cites and i + 1 < len(lines) and lines[i + 1].strip().startswith("```"):
            snippet = []
            j = i + 2
            while j < len(lines) and not lines[j].strip().startswith("```"):
                s = lines[j].strip()
                if s and s not in SKIP:
                    snippet.append(s)
                j += 1
            c = cites[-1]
            rel, a = c.group(1), int(c.group(2))
            b = int(c.group(3)) if c.group(3) else a
            code = src(rel)
            if code is None:
                continue
            window = [x.strip() for x in code[a - 1 : max(b, a + len(snippet) + 2)]]
            for s in snippet:
                if not any(s in w for w in window):
                    errors.append(f"{note}:{i+1}: snippet line not found in {rel}:{a}-{b}: {s!r}")
    return errors


if __name__ == "__main__":
    failures = []
    for arg in sys.argv[1:]:
        failures += check(Path(arg))
    for f in failures:
        print(f)
    print("OK" if not failures else f"{len(failures)} problem(s)")
    sys.exit(1 if failures else 0)
```

- [ ] **Step 2: Write a failing fixture and run it**

Create the fixture in the scratchpad (`C:\Users\Calum\AppData\Local\Temp\claude\C--Users-Calum-repos-LostCityRs\00b90c23-f1ec-482a-97fd-55675c21a5d0\scratchpad\bad.md`) with this content (wrong snippet, line out of range, wrong hash):

````markdown
- Engine-TS: `deadbeef`

1. Tick length. Source: `Engine-TS/src/engine/World.ts:120`
   ```ts
   private static readonly TICKRATE: number = 700;
   ```
2. Out of range. Source: `Engine-TS/src/engine/World.ts:99999`
````

Run: `python3 docs/tools/check_citations.py "<scratchpad>/bad.md"`
Expected: exit 1 with three problems: hash mismatch, snippet line not found, outside file length.

- [ ] **Step 3: Run it on a correct fixture**

Create `good.md` in the scratchpad: the commit line `- Engine-TS: \`<output of git -C Engine-TS rev-parse --short HEAD>\``, and
`1. Tick length. Source: \`Engine-TS/src/engine/World.ts:120\`` followed by a fence containing `private static readonly TICKRATE: number = 600;`.
Run the checker on it. Expected: `OK`, exit 0.

- [ ] **Step 4: Write the template**

Create `docs/tick/_template.md` (this is the `docs/README.md` template, extended with L2 and L3 sections):

````markdown
# <Phase title>

**Question answered:** <one sentence>

**Based on commits:**
- Engine-TS: `<hash>` (branch `calum-research`)
- (only repos actually read)

**Method:** read code only. Nothing was run. L3 rules are "read, not observed".

## Position in the tick

<Which phase number of `World.cycle()`, what runs immediately before and after it. Source: `Engine-TS/src/engine/World.ts:LINE`>

## L2: ordered sub-steps

1. <Step>. Source: `Engine-TS/src/...:LINE`

## L3: ordering rules

Each rule is a precise statement and names the lines that establish it.

1. <Rule>. Source: `Engine-TS/src/...:LINE`
   ```ts
   // short quoted snippet
   ```

## Comment-versus-code check

- <Comment in code> vs <what the code does>: matches / mismatch (describe).

## Inferences (labelled)

- <Inference>. Rests on L3 rules N and M.

## Not checked / open questions

- <Thing not verified>. Also in `docs/open-questions.md` as #N.
````

- [ ] **Step 5: Write provisional L1**

Create `docs/tick/00-overview.md` with: title "Game tick overview (L1)", a bold banner `PROVISIONAL: built only from the phase comments in World.cycle(); not yet verified against phase bodies.`, the commit block, the table below, and the tick-length fact. Each row's "Purpose (from comment)" is a quote of the comment at `World.ts:345-415`, re-read when writing.

| # | Phase | Purpose (from `cycle()` comment) | Note |
|---|---|---|---|
| 1 | `processWorld` | world queue, npc hunt | 01-world.md |
| 2 | `processClientsIn` | afk readiness, packets, pathfinding/follow requests, input tracking | 02-clients-in.md |
| 3 | `processNpcEventQueue` | spawn and despawn triggers | 03-npc-event-queue.md |
| 4 | `processNpcs` | resume script, regen, timer, queue, movement, modes | 04-npcs.md |
| 5 | `processPlayers` | queues, timers, engine queue, interactions, movement, logout interface close | 05, 06 |
| 6 | `processLogouts` | player logout | 07-logouts-logins.md |
| 7 | `processLogins` | player login | 07-logouts-logins.md |
| 8 | `processZones` | active zones, loc/obj despawn/respawn, shared buffer | 08-zones.md |
| 9 | `processInfo` | player and npc update info | 09-info.md |
| 10 | `processClientsOut` | map, player info, npc info, zone updates, invs, stats, flush | 10-clients-out.md |
| 11 | `processCleanup` | reset zones, players, npcs, invs | 11-cleanup-and-tail.md |

Add the tick-length fact: `TICKRATE = 600` ms at `Engine-TS/src/engine/World.ts:120`, rescheduled at `World.ts:508`. Re-grep both lines before saving.

- [ ] **Step 6: Run the checker on the overview**

Run: `python3 docs/tools/check_citations.py docs/tick/00-overview.md`
Expected: `OK`. Fix any citation it flags.

- [ ] **Step 7: Add the index entry**

Edit `docs/README.md`: add under `## Notes`: `- [tick/00-overview.md](tick/00-overview.md): one game tick at L1 (provisional until all phase notes are verified). Per-phase notes are listed below as they are written.` Do not commit.

---

### Task 2: Phase 1, `processWorld` (note `01-world.md`)

**Files:**
- Create: `docs/tick/01-world.md` (copy `docs/tick/_template.md`)
- Modify: `docs/tick/00-overview.md` (link only), `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`, `check_citations.py`.
- Produces: L2/L3 for `processWorld`; the list of state it mutates for the ordering matrix (Task 12).

- [ ] **Step 1: Read the code**

Read `Engine-TS/src/engine/World.ts` from the line of `private processWorld` (grep `processWorld` first; it was line 531 at `1d25566c`) to the start of `processClientsIn`. Follow each call: the world queue processing (what queue, how entries are added and delayed), the "npc hunt" call (find the function with Grep, read it in its file). Note which loops they use and how those lists are built.

- [ ] **Step 2: Answer these questions in the note, each with citations**

- What exactly is in the world queue, how is an entry's delay decremented, and in what order do entries run?
- Which scripts run here and with what script state (what is the active entity)?
- What does the hunt step do for each NPC, and does it run before NPC movement/modes in `processNpcs`?
- Does anything here depend on player state, and does it run before client input is read?
- Comment-versus-code: compare the comment at `World.cycle()` and at the top of `processWorld` with the body.

- [ ] **Step 3: Write the note**

Copy the template to `docs/tick/01-world.md` and fill every section. Unknowns go under "Not checked". If a callee is a subsystem boundary (RuneScript execution), stop there and log it.

- [ ] **Step 4: Re-grep and verify**

Re-grep each cited line number against the file. Run: `python3 docs/tools/check_citations.py docs/tick/01-world.md`. Expected: `OK`.

- [ ] **Step 5: Update indexes**

Add the note to `docs/README.md` with a one-line summary. In `docs/open-questions.md`, add any new unverified items with the next free number and what is needed to resolve them. Do not commit.

---

### Task 3: Phase 2, `processClientsIn` (note `02-clients-in.md`)

**Files:**
- Create: `docs/tick/02-clients-in.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`; existing notes `docs/flows/click-loc-woodcutting.md`, `docs/flows/move-opclick.md` (reuse their verified findings by linking, but re-check lines against the current commit).
- Produces: L2/L3 for input handling, including what state a packet may set (targets, waypoints, queues) for Task 12.

- [ ] **Step 1: Read the code**

Read `processClientsIn` in `Engine-TS/src/engine/World.ts` (about line 601), then `Engine-TS/src/engine/entity/NetworkPlayer.ts` `decodeIn`/`read` and the per-player calls it makes (afk readiness, pathfinding/follow requests, input tracking). Read how `ClientGameProtRepository.ts` binds opcodes to handlers, and how many packets or bytes are processed per player per tick (find the limits in code).

- [ ] **Step 2: Answer these questions, each with citations**

- In what order are players iterated, and how is that list built (`playerLoop`)? Is it the same order as in `processPlayers`?
- Is there a per-tick cap on packets or bytes read per player, and what happens to the excess?
- When a packet handler sets state (target, interaction, waypoints), is that state consumed in this phase or left for later phases? Name the field and the consumer.
- What happens to a request that the player cannot act on while busy/delayed (is it dropped or deferred)?
- What are the "pathfinding/following request" and "afk event readiness" steps, and when do they run relative to packet decoding?
- Comment-versus-code for the `cycle()` comment at the `processClientsIn` call and any comment in the function.

- [ ] **Step 3: Write the note** (copy template, fill all sections).

- [ ] **Step 4: Re-grep line numbers; run** `python3 docs/tools/check_citations.py docs/tick/02-clients-in.md`. Expected: `OK`.

- [ ] **Step 5: Update `docs/README.md` and `docs/open-questions.md`.** Move answered parts of open question #3 into the note; leave the rest. Do not commit.

---

### Task 4: Phase 3, `processNpcEventQueue` (note `03-npc-event-queue.md`)

**Files:**
- Create: `docs/tick/03-npc-event-queue.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L2/L3 for spawn and despawn triggers; which later phases see NPCs spawned here.

- [ ] **Step 1: Read** `processNpcEventQueue` (World.ts, about line 648) and follow what populates the queue (Grep for the queue's name and every `.push`/enqueue site) and what triggers it runs.

- [ ] **Step 2: Answer, with citations:** what the queue holds, who adds to it and in which phase, what runs per entry, whether entries added during this phase run the same tick, and whether an NPC spawned here is processed by `processNpcs` on the same tick. Comment-versus-code check.

- [ ] **Step 3: Write the note.**

- [ ] **Step 4: Re-grep; run** `python3 docs/tools/check_citations.py docs/tick/03-npc-event-queue.md`. Expected: `OK`.

- [ ] **Step 5: Update indexes.** Do not commit.

---

### Task 5: Phase 4, `processNpcs` (note `04-npcs.md`)

**Files:**
- Create: `docs/tick/04-npcs.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L2/L3 for the per-NPC pipeline; NPC state for the ordering matrix.

- [ ] **Step 1: Read** `processNpcs` (World.ts, about line 665), then in `Engine-TS/src/engine/entity/Npc.ts` the per-NPC functions it calls (resume suspended script, stat regen, timer, queue, movement, modes; Grep names from the body) and `PathingEntity.ts` for movement. Read how NPC modes (wander, patrol, follow, attack and so on) are selected and run, and how interaction with players (NPC-initiated) is processed.

- [ ] **Step 2: Answer, with citations:**
  - NPC iteration order and how the list is built; are NPCs added/removed during the loop safely?
  - What does "if npc is not busy" mean in code (the exact condition), and which steps it gates.
  - The exact order of: resume script, regen, timer, queue, movement, mode, versus the comment.
  - What each mode does per tick and where mode targets (players) are validated.
  - Whether NPC movement this tick is visible to `processPlayers` on the same tick (that is, whether players see NPC state from before or after this phase).
  - Delay, queue-counter and timer semantics (when counters decrement relative to execution).

- [ ] **Step 3: Write the note.** If the file gets too big, split into `04-npcs.md` (pipeline) and `04b-npc-modes.md` (modes) and index both.

- [ ] **Step 4: Re-grep; run** the checker on the new file(s). Expected: `OK`.

- [ ] **Step 5: Update indexes.** Do not commit.

---

### Task 6: Phase 5a, `processPlayers`: scripts, queues, timers (note `05-players-queues-timers.md`)

**Files:**
- Create: `docs/tick/05-players-queues-timers.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L3 rules for the first half of the per-player pipeline: delayed, suspended-script resume, `processQueues`, timers, engine queue. These rules are cited by Task 7 (interaction) and the scenarios.

- [ ] **Step 1: Read** `processPlayers` (`World.ts:687-737` at `1d25566c`; re-grep) and in `Engine-TS/src/engine/entity/Player.ts`: `processQueues` (about line 874), `processQueue`, `processWeakQueue`, `processTimers` (about 945), `processEngineQueue` (about 660), `enqueueScript` (about 841), `setTimer`. Read the `delayed`/`delayedUntil` fields and how scripts suspend (`ScriptState.SUSPENDED` in `Engine-TS/src/engine/script/ScriptState.ts`), stopping at the script VM boundary.

- [ ] **Step 2: Answer, with citations:**
  - How `delayed` is cleared at the top of the loop and what `delayedUntil` is compared against.
  - The condition for resuming a suspended `activeScript`, and what `executeScript(..., true, true)` parameters mean.
  - Normal queue versus weak queue: order, delay-counter decrement timing, what blocks them (modal open, `busy`, delayed), and what the "primary" queue does when a script suspends.
  - Timer and soft-timer intervals: how the countdown works and when the script runs.
  - Engine queue: contents and order.
  - Effect of `player.loggingOut` on timers.
  - Whether a script enqueued in this phase with delay 0 runs in this same tick's queue pass.
  - Comment-versus-code for every comment in `processPlayers`.

- [ ] **Step 3: Write the note**, including a numbered "per-player order within the tick" list that Task 7 continues.

- [ ] **Step 4: Re-grep; run** `python3 docs/tools/check_citations.py docs/tick/05-players-queues-timers.md`. Expected: `OK`.

- [ ] **Step 5: Update indexes.** Do not commit.

---

### Task 7: Phase 5b, `processPlayers`: face, interaction, movement, energy (note `06-players-interaction-movement.md`)

**Files:**
- Create: `docs/tick/06-players-interaction-movement.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`; `docs/tick/05-players-queues-timers.md`; `docs/flows/click-loc-woodcutting.md`, `docs/flows/move-opclick.md` (link, re-check lines).
- Produces: L3 rules for target facing, `processInteraction`, `processWalktrigger`, movement, `updateEnergy`, `validateDistanceWalked`.

- [ ] **Step 1: Read** in `Engine-TS/src/engine/entity/Player.ts`: `setFaceEntity`, `reorientEntity`, `reorient`, `processInteraction` (about line 1247), `processWalktrigger` (about 1108), `updateMovement` (about 674), `updateEnergy`, `validateDistanceWalked`; in `PathingEntity.ts` the waypoint stepping and `stepsTaken`; and `Interaction.ts` for approach/operate logic.

- [ ] **Step 2: Answer, with citations:**
  - Order inside `processInteraction`: when the interaction runs versus when movement steps, and how many steps (walk versus run) occur per tick.
  - When an interaction fires (ap versus op trigger), on which tick after the click arrives, and how distance/approach is checked.
  - What clears the target and when (including the comment that facing runs "before `processInteraction` can clear it").
  - Walk trigger: when it runs relative to the move.
  - Why `reorient` runs after movement and what `stepsTaken` is.
  - Energy update order relative to movement; what `validateDistanceWalked` checks and why it is skipped for `EXACT_MOVE`.
  - Interaction with `busy`/modal/delay (answers open question #4's `closeModal` item if reached).
  - Comment-versus-code for the multi-line comments at `World.ts:710-719` (re-grep).

- [ ] **Step 3: Write the note.**

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes**; resolve or narrow open question #4. Do not commit.

---

### Task 8: Phases 6 and 7, `processLogouts` and `processLogins` (note `07-logouts-logins.md`)

**Files:**
- Create: `docs/tick/07-logouts-logins.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L3 rules on when players enter and leave the per-tick loops, for the ordering matrix and scenarios.

- [ ] **Step 1: Read** `processLogouts` (about line 739) and `processLogins` (about 809) in `World.ts`. Read only as far as needed to state: the conditions for a logout, when the player is removed from `playerLoop`, how login requests are queued and applied, and when a new player first appears in input, processing, and output phases. Stop at persistence/logger-thread/login-server boundaries and log open questions.

- [ ] **Step 2: Answer, with citations:** logout conditions (`loggingOut`, busy, combat or script blocks, timeout), what runs on removal, and the tick on which a player who requested logout is gone; what login does to a new player (first-tick setup, map/inventory send) and whether they are processed by `processPlayers` on the login tick (compare with the comment about "before packets" at `World.cycle()`); comment-versus-code.

- [ ] **Step 3: Write the note** (L2 and L3; keep the persistence boundary explicit).

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes.** Do not commit.

---

### Task 9: Phase 8, `processZones` (note `08-zones.md`)

**Files:**
- Create: `docs/tick/08-zones.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L2/L3 for zone processing; resolves part of open question #12 (loc changes) as far as it is in this phase.

- [ ] **Step 1: Read** `processZones` (about line 963), `Engine-TS/src/engine/zone/Zone.ts`, `ZoneMap.ts`, `ZoneEvent.ts`, `ZoneEventType.ts`, and the code that builds the active-zone list and the shared buffer.

- [ ] **Step 2: Answer, with citations:** how the active zone list is built (around which players, from which positions: before or after this tick's movement); order of loc/obj despawn and respawn processing; what a "zone event" is, when events are added (which phases), and when the shared buffer is computed relative to those; how a loc change or obj add made earlier this tick reaches the buffer; comment-versus-code.

- [ ] **Step 3: Write the note.**

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes**; narrow open question #12. Do not commit.

---

### Task 10: Phase 9, `processInfo` (note `09-info.md`)

**Files:**
- Create: `docs/tick/09-info.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`; `docs/flows/server-response-woodcutting.md`.
- Produces: L2/L3 for how this tick's movement and masks become player/NPC info.

- [ ] **Step 1: Read** `processInfo` (about line 994) and the `Engine-TS/src/network/rsbuf/` code it calls (player info, npc info, mask encoding), plus how movement directions (`walkDir`, `runDir`) and masks are read from entities.

- [ ] **Step 2: Answer, with citations:** order of the four sub-steps in the comment (convert player movements, compute player info, convert npc movements, compute npc info) versus the code; which entity fields are read (masks, directions, appearance); whether it runs once per entity or once per observer; and which earlier phases wrote the masks consumed here (cite the writer for at least three masks, for example `FACE_ENTITY`, animation, `EXACT_MOVE`). Comment-versus-code.

- [ ] **Step 3: Write the note.** Do not describe client-side decoding (out of scope; log it).

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes**; narrow open question #14 if the engine half is answered. Do not commit.

---

### Task 11: Phase 10, `processClientsOut` (note `10-clients-out.md`)

**Files:**
- Create: `docs/tick/10-clients-out.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`; `docs/flows/server-response-woodcutting.md`.
- Produces: L2/L3 for the order of packets sent in a tick.

- [ ] **Step 1: Read** `processClientsOut` (about line 1096) and in `NetworkPlayer.ts` `updateInvs`, `updateStats`, `writeInner` and flush; read the map-update (rebuild) condition.

- [ ] **Step 2: Answer, with citations:** the exact order packets are produced (map update, player info, npc info, zone updates, inv changes, stat changes, afk zone changes, flush) versus the comment; where script-triggered packets (messages, animations, sounds) are written (this phase or immediately, and cite the write path); per-tick output limits; what happens if a socket is closed; comment-versus-code.

- [ ] **Step 3: Write the note.**

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes.** Do not commit.

---

### Task 12: Phase 11, `processCleanup` and end-of-cycle tail (note `11-cleanup-and-tail.md`)

**Files:**
- Create: `docs/tick/11-cleanup-and-tail.md`
- Modify: `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: `_template.md`.
- Produces: L2/L3 for what is reset and what runs after the phases.

- [ ] **Step 1: Read** `processCleanup` (about line 1139), the reset functions it calls on zones, players, NPCs and inventories, then the rest of `cycle()` after it (`World.ts:417-508`, re-grep): shutdown handling, autosave rate, coordinate log rate, log flush, stats, `currentTick++`, rescheduling. Read `processShutdown` (about 1209) and the `catch` at the end of `cycle()`.

- [ ] **Step 2: Answer, with citations:** what is reset and why that must come after output (which masks and flags are cleared); what runs only on some ticks (`PLAYER_SAVERATE`, `PLAYER_COORDLOGRATE`) and their values; when `currentTick` increments relative to the phases (so which tick number each phase sees); the drift/rescheduling formula; the error path (unhandled error removes all players and exits, `World.ts:509-526`) and the per-player catch in `processPlayers` (`World.ts:727-732`). Comment-versus-code.

- [ ] **Step 3: Write the note.**

- [ ] **Step 4: Re-grep; run** the checker on the file. Expected: `OK`.

- [ ] **Step 5: Update indexes**; narrow open question #3. Do not commit.

---

### Task 13: Ordering matrix (`ordering-matrix.md`)

**Files:**
- Create: `docs/tick/ordering-matrix.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: all of notes 01 to 11 (their L3 rules and "state it mutates" lists).
- Produces: a table used by Task 14.

- [ ] **Step 1: Build the table from the notes only.** Rows are state items; columns are phases 1 to 11; cells are `R`, `W` or `RW`, each with a pointer to the L3 rule or finding in the note that establishes it (for example `05#3`). State items: world queue, NPC queue/timers/modes/targets, player normal queue, weak queue, timers, engine queue, `delayed`/`delayedUntil`, `activeScript`, interaction target, waypoints/`stepsTaken`, run energy, masks, zone events and shared buffer, player and npc lists (add/remove), inventory and stat update flags, output buffers. Add any state the notes show that is missing from this list.

- [ ] **Step 2: Write conclusions as labelled inferences**, each listing the notes' findings it rests on (for example "an input packet that sets a target on tick T can fire its interaction on tick T").

- [ ] **Step 3: Run** `python3 docs/tools/check_citations.py docs/tick/ordering-matrix.md`. Expected: `OK`. Add to `docs/README.md`. Do not commit.

---

### Task 14: Scenarios (`scenarios.md`)

**Files:**
- Create: `docs/tick/scenarios.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: notes 01 to 11, the ordering matrix, and `docs/flows/*.md`.
- Produces: cross-checks of the L3 rules. A scenario that contradicts a note triggers a fix to the note.

- [ ] **Step 1: Write four scenarios**, each a timeline with columns `tick`, `phase`, `what happens`, `rule/finding cited`:
  1. Click a tree: packet arrives, interaction set, approach and operate, script, packets back (uses `docs/flows/click-loc-woodcutting.md` and `server-response-woodcutting.md`).
  2. Walk: `MOVE_OPCLICK` arrives, waypoints, steps per tick, info packet (uses `docs/flows/move-opclick.md`).
  3. Interact with an NPC while the NPC also runs a mode or queue on the same tick.
  4. A packet arrives while the player has a delayed or suspended script, and a queued script exists.
  Mark the tick number of each step as relative (`T`, `T+1`), and say where the answer depends on the arrival time within the 600 ms window (inputs are read at one phase per tick, so state which).

- [ ] **Step 2: Cross-check.** For each timeline row confirm the cited rule says what the row says. Any mismatch: fix the phase note (and tell the user what was wrong) before continuing.

- [ ] **Step 3: Run** the checker on `docs/tick/scenarios.md`. Expected: `OK`. Add to `docs/README.md`. Do not commit.

---

### Task 15: Final L1, index and open-questions pass

**Files:**
- Modify: `docs/tick/00-overview.md`, `docs/README.md`, `docs/open-questions.md`

**Interfaces:**
- Consumes: every note.

- [ ] **Step 1: Regenerate L1 from the notes.** Remove the PROVISIONAL banner. Each phase row now has a verified purpose written from its note's L2, a link, and the single most important ordering rule from its L3. Add an L1 "per-tick order of one player" line from notes 05 and 06. Fix any difference from the provisional table and tell the user what the provisional version had wrong.

- [ ] **Step 2: Staleness check.** Run `git -C Engine-TS rev-parse --short HEAD` (and Content, Client-TS, RuneScriptTS if cited). If any differ from a note's recorded hash, re-verify that note and update the hash.

- [ ] **Step 3: Run the checker on every note.** Run: `python3 docs/tools/check_citations.py docs/tick/*.md`. Expected: `OK`. (The `_template.md` file has no real citations and passes.)

- [ ] **Step 4: Open questions.** Every "not checked" item in every note is in `docs/open-questions.md` with what would resolve it. Answered items are removed.

- [ ] **Step 5: Definition-of-done check against the spec.** Confirm each: every phase called in `cycle()` has a note with L2 and L3; ordering matrix exists; at least four scenarios exist; L1 agrees with the notes; every claim has a citation. Report anything unmet to the user.

- [ ] **Step 6: Report to the user:** list files created, the questions answered, the mismatches found between comments and code, and open questions added. Do not commit unless the user asks.

---

## Self-Review

- **Spec coverage:** provisional L1 (Task 1), phases in tick order (Tasks 2 to 12), logouts/logins (8), ordering matrix (13), scenarios (14), final L1 and index (15), accuracy rules (Global Constraints and per-task re-grep and checker steps), NPC depth equal to players (Tasks 4 and 5), scope boundaries (Global Constraints). No gaps found.
- **Addition beyond the spec:** `docs/tools/check_citations.py` is not in the spec. It mechanically enforces the spec's "cite everything" rule. Flag it to the user, who can veto it.
- **Placeholders:** none; the per-task reading targets are named, and their approximate line numbers are marked as "about, re-grep".
- **Consistency:** note filenames match the File Structure table and the L1 table in Task 1 (`02-clients-in.md`, `03-npc-event-queue.md`, `04-npcs.md`, `05-players-queues-timers.md`, `06-players-interaction-movement.md`, `07-logouts-logins.md`, `08-zones.md`, `09-info.md`, `10-clients-out.md`, `11-cleanup-and-tail.md`). Task numbers differ from note numbers by one after Task 1; each task states its note file explicitly. Task cross-references in the Review Focus section and in Task 6 were corrected during self-review.
- **Review Focus:** all five items are pinned to tasks (1: every phase task; 2: Tasks 13 and 14; 3: Tasks 3, 5, 6, 9, 10; 4: Tasks 5 to 7 and 14; 5: Task 12).

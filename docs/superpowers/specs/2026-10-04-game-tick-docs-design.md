# Game tick documentation: design

Date: 2026-10-04. Status: approved by the user (2026-10-04). Nothing in this spec is a finding about the engine; it is a plan for producing verified findings.

## Goal

Be able to state accurately, at three levels of abstraction, what one game tick consists of and in what order things happen:

- **L1 (overview):** the phases of a tick in order, one line each, plus tick length.
- **L2 (per phase):** the ordered sub-steps inside each phase, and per-entity ordering.
- **L3 (ordering rules):** precise, cited statements that answer "what happens first if X and Y both occur?" (for example when `delayed` and `busy` are checked, which tick an interaction resumes on, what a click arriving in one phase does compared with another).

## Decisions made with the user

- Approach B: trace one phase at a time in tick order, write L2 and L3 inside each phase note, then write L1 last from the verified notes. A provisional L1 is written first and marked unverified.
- Method: **reading code only**. Nothing is run and the submodules are not edited. Every L3 claim is labelled "read, not observed". Timing questions such as open question #10 stay open.
- NPC phases (`processNpcEventQueue`, `processNpcs`) get the same L2 and L3 depth as player phases.

## Assumption to confirm

The user said "same depth for NPCs". The depth for `processWorld`, `processZones`, `processInfo`, `processClientsOut` and `processCleanup` was not stated. Assumed: L2 for all of them, plus L3 rules wherever they affect ordering (for example when the shared zone buffer is computed relative to player movement, or what is reset in cleanup). Confirm or correct.

## Starting facts (read, Engine-TS `1d25566c`, Content `65b754f76`, Client-TS `7d6ca61`)

- `World.cycle()` (`Engine-TS/src/engine/World.ts:340-415`) calls, in order: `processWorld`, `processClientsIn`, `processNpcEventQueue`, `processNpcs`, `processPlayers`, `processLogouts`, `processLogins`, `processZones`, `processInfo`, `processClientsOut`, `processCleanup`.
- Tick length is `TICKRATE = 600` ms (`World.ts:120`), rescheduled with `setTimeout` and drift compensation (`World.ts:508`).
- `processPlayers` per-player order (`World.ts:687-737`): resume suspended script, `processQueues`, timers, soft timers, `processEngineQueue`, `setFaceEntity`, `reorientEntity`, `processInteraction`, `reorient`, `updateEnergy`, `validateDistanceWalked`.
- The phase comments in `cycle()` are claims to verify, not facts.

## Deliverables (all under `docs/`)

| File | Content |
|---|---|
| `docs/tick/00-overview.md` | L1. Provisional first (from `cycle()` comments, marked unverified), regenerated at the end. |
| `docs/tick/NN-<phase>.md` | One note per phase: L2 sub-steps and L3 ordering rules. |
| `docs/tick/ordering-matrix.md` | Which phase reads or writes which state (queues, `delayed`, `busy`, target, waypoints, masks, zone buffers). |
| `docs/tick/scenarios.md` | At least four worked tick-by-tick timelines (for example click a tree, walk, NPC interaction, a packet arriving mid-tick), used to cross-check the notes. |
| `docs/README.md` | Index entries for every new note. |
| `docs/open-questions.md` | Updated as items are answered or discovered (#3, #4 and #10 are expected to move). |

## Per-phase note format

Follows the template in `docs/README.md`: question answered, commits, method ("read code"), findings with `file:line` and short quoted snippets, labelled inferences, not-checked items. L2 is an ordered list of sub-steps. L3 is an "Ordering rules" section; each rule names the lines that establish it. Stale comments are checked against code and mismatches reported.

## Order of work

1. Provisional L1.
2. Phases in tick order: `processWorld`, `processClientsIn`, `processNpcEventQueue`, `processNpcs`, `processPlayers`, `processLogouts`/`processLogins` (only as they affect ordering), `processZones`, `processInfo`, `processClientsOut`, `processCleanup`.
3. Ordering matrix.
4. Scenarios.
5. Final L1 and index update.

## Accuracy rules (from CLAUDE.md)

- Read each function and follow caller to callee; do not infer from names or comments.
- Re-grep line numbers just before saving each note.
- Record `git rev-parse --short HEAD` per repo read.
- Stop at subsystem boundaries (for example RuneScript execution internals) and log an open question.
- Do not commit unless the user asks. Never push.

## Scope boundaries

- Out of scope: login and logout internals beyond their position in the tick, the persistence and logger thread, client-side rendering, script command semantics (only when scripts run matters).
- A note is added for any of these only if it changes tick ordering.

## Definition of done

- Every phase called in `cycle()` has a note with L2 and L3 sections.
- The ordering matrix and at least four scenarios exist.
- L1 is regenerated from the notes and agrees with them.
- Every factual claim has a citation, and every unverified item is in `docs/open-questions.md`.

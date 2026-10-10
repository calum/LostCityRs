# CLAUDE.md

This is a learning project: understanding how the LostCityRS game engine, scripts and client work. See `README.md` for the repository layout.

## Non-negotiable: evidence and accuracy

The user needs to *fully understand* the system. Wrong documentation is actively harmful. Therefore:

- **Never guess.** Do not state how something works unless you have read the code that does it (or observed it running). If you have not verified it, say "not verified" and add it to `docs/open-questions.md`.
- **Cite everything.** Every factual claim in docs and in chat answers needs a citation: `Repo/path/file.ts:line`, plus the commit hash the repo was at (`git -C <Repo> rev-parse --short HEAD`). Quote short snippets where they carry the meaning.
- **Read before describing.** Open the actual file. Do not infer behaviour from file names, function names, comments alone, or prior knowledge of RuneScape or of other emulators. Comments can be stale; confirm against the code.
- **Follow the call chain.** When explaining a flow, trace each hop through real code (caller → callee) rather than summarising from the top.
- **Separate fact from inference.** If a conclusion requires inference across several verified facts, label it as an inference and show the facts it rests on.
- **Say what you did not check.** State the limits of an answer (files not read, paths not followed, nothing run).
- **Re-verify when revisiting.** Docs record the commit they were written against. If the submodule commit has moved, re-check before relying on them.
- **Fix wrong docs immediately** and tell the user what was wrong.
- When the user asks a question the code cannot answer, say so rather than filling the gap.

## Git rules: push the root repo and the submodule forks, never upstream

- **Always push new commits in this root repo** (`calum/LostCityRs`) once they are made.
- **Commit and push straight to `main`.** Only use a separate branch to avoid conflicts with another agent working at the same time, and bring it back onto `main` when done. Do not open pull requests.
- **Submodules point at Calum's forks** (`github.com/calum/<name>`, see `docs/setup/submodule-forks.md`). Agents may push `calum-research` (and other branches) in a submodule, but **only to the fork (`origin`)**. Never push to, or open PRs/issues against, the original `LostCityRS/*` upstreams. Do not add a remote that points at upstream with push enabled (the `upstream` remote in `docs/setup/submodule-forks.md` is fetch-only: set its push URL to `DISABLED_NO_PUSH`).
- After pushing in a submodule, commit the updated submodule pointer in the root repo and push it too, so the root never references a commit that only exists locally.
- Do not open PRs, issues or comments on the upstream submodule repos.
- Read-only `gh` / `git fetch` use is fine.
- Each submodule is on the local branch `calum-research`, except where the relic mode (`docs/design/roguelike-relics-dev-plan.md`) adds hooks: there the submodule is on `relic-mode` (branched from the pinned commit), one commit per hook, pushed to the fork only. Otherwise stay on `calum-research`. Local edits to upstream code are allowed only when they help research (e.g. temporary logging); commit them on `calum-research`, keep them minimal, and record them in `docs/local-changes.md` (create it when first needed) so they can be told apart from upstream behaviour.
- Documentation goes in this container repo's `docs/`, not in the submodules.
- Commit and push doc updates as part of the work. Commit other changes (for example `mise.toml` or other repo config) when the user asks for them.

## Test-driven development (required for new behaviour)

The headless harness (`mise run test`, how-to in `docs/setup/headless-test-harness.md`, tests in `tests/*.test.ts`) boots the real `World` in-process and drives bots through the engine's own packet handlers, so a behaviour test runs in seconds without a browser.

- **Write the failing test first.** For any new or changed game behaviour (a mod, a relic, a content script change, an engine hook), add or extend a test in `tests/` before the implementation. Run `mise run test` and confirm it fails **for the expected reason** (an assertion about the new behaviour, not a typo or missing import). Then implement until it passes.
- **Bug fixes start with a reproducing test.** Write the test that fails on the bug, then fix.
- **Keep the whole suite green.** Run `mise run test` (and `mise run test:types` after touching `harness/` or `tests/`) before every commit that changes `mods/`, a hook, or the harness. Do not commit with a red test; if one fails for a reason unrelated to your change, say so in the commit message and in chat.
- **Report what you ran.** In chat and in docs, state the failing run, the passing run and the test count. Do not claim "tested" for something only compiled or only read.
- **Never weaken a test to get green** (no skipping, loosening an assertion or deleting the case) without telling the user why.
- **What the harness cannot prove** is listed in `docs/setup/headless-test-harness.md` ("Differences from a real client"): rendering, the client route finder, packet bytes, real-time timing. For those, say "not covered by the harness" and use `scripts/headless-client.mjs` or a live run; record the gap in `docs/open-questions.md`.
- **Exceptions** (docs-only changes, research notes, tracing existing behaviour) need no test. Say "no test: docs only" in the commit message when it is not obvious.
- When a test reveals how the engine or a script really behaves, record that in `docs/` as usual.

## Documentation conventions

- **Always keep the docs up to date.** Any new finding about server or client mechanics, RuneScript details, or important information about this repo (setup, tooling, conventions, layout) goes into `docs/` in the same piece of work, with citations as above. Add a new note or update the existing one, update the index in `docs/README.md`, and add or remove items in `docs/open-questions.md`. A finding that lives only in a chat answer is lost. Then commit and push it (see Git rules).
- Location and index: `docs/README.md`. Each note follows the template there.
- Each note records: the question it answers, the commit hash of each repo it was based on, the findings with citations, and its own open questions.
- Keep notes focused (one flow or subsystem per file) and link to related notes.
- Unverified items go in `docs/open-questions.md` with what would be needed to resolve them.
- Describe game *mechanics and behaviour* (what happens, in what order, on which tick, triggered by what), not just code structure.

## Start here (navigation)

1. Read `docs/README.md` (index of notes) and `docs/open-questions.md` **before** exploring code, so you do not re-derive what is already traced and so you know what is unverified.
2. Notes live in `docs/flows/`, one per traced flow. Notes state facts; this file only says where to look.

These are **starting points only** (paths verified to exist). What they do is in the notes, or must be read from the code:

| Area | Where to look |
|---|---|
| Engine tick loop | `Engine-TS/src/engine/World.ts` (`cycle`, `processClientsIn`, `processPlayers`, `processClientsOut`) |
| Engine reads/writes client packets | `Engine-TS/src/engine/entity/NetworkPlayer.ts` (`decodeIn`, `read`, `writeInner`, `updateInvs`, `updateStats`) |
| Client packet to decoder/handler binding | `Engine-TS/src/network/game/client/ClientGameProtRepository.ts`; opcodes and sizes in `ClientGameProt.ts`; one `codec/`, `handler/` and `model/` file per packet |
| Server packet encoders | `Engine-TS/src/network/game/server/` (`ServerGameProt.ts`, `codec/`, `model/`) |
| Player/NPC info (appearance, anim masks) | `Engine-TS/src/network/rsbuf/` and `World.processInfo` |
| Player, entity state, interactions, movement | `Engine-TS/src/engine/entity/` (`Player.ts`, `PathingEntity.ts`, `Interaction.ts`) |
| Script execution | `Engine-TS/src/engine/script/` (`ScriptProvider.ts`, `ServerTriggerType.ts`, `handlers/*.ts` implement script commands) |
| Config defaults and env overrides | `Engine-TS/src/util/WorldConfig.ts`, `Environment.ts` |
| Client opcodes | `Client-TS/src/io/ClientProt.ts` (client to server), `ServerProt.ts` (server to client) |
| Client logic | `Client-TS/src/client/Client.ts`: one very large file. Grep for the packet name (`ClientProt.X`, `ServerProt.X`) or the method name; do not read it whole |
| Game rules/content | `Content/scripts/<feature>/scripts/*.rs2` and `configs/` |
| Script compiler | `RuneScriptTS/src/` (not yet read) |
| Headless tests | `harness/src/` (world stepping, `Bot` API), `tests/*.test.ts`; run `mise run test`. How it works: `docs/setup/headless-test-harness.md` |

## Tracing workflow

This is how the existing notes were produced; follow it for new ones.

1. Pick one concrete behaviour (e.g. "click a tree", "talk to an NPC") and find its opcode on **both** sides: `ClientProt.ts` and the engine's `ClientGameProt.ts` (or the `ServerProt` pair for the return path). Check ids and payload sizes agree.
2. Follow the chain hop by hop: client send site, engine decoder, handler, state change, which tick phase acts on it, script trigger, script, and the packet that goes back, ending at the client handler. Read each function; do not skip hops.
3. Get citations with `grep -n` on the actual file **after** reading. Do not cite a line number from memory or from an earlier `sed` range. Re-check line numbers before saving a note; earlier drafts had wrong ranges.
4. Record the `git rev-parse --short HEAD` of each repo read, and the method (read vs ran).
5. Separate findings, labelled inferences and "not checked". Add every unverified thing to `docs/open-questions.md` and remove items you answer.
6. Add the note to the index in `docs/README.md`, then commit and push it to `main`.

## Staleness check

Notes are only valid at the commits they record. Before relying on a note's line numbers, compare its recorded hashes with `git -C Engine-TS rev-parse --short HEAD` (and `Content`, `Client-TS`). If they differ, re-verify the cited lines and update the note's commit hash. Do not move the submodules to other commits or branches without telling the user, since that invalidates the notes.

## Environment

- Windows 11; use Git Bash or PowerShell. `python3` is available in Git Bash and is handy for scripted doc edits. The "LF will be replaced by CRLF" git warnings are harmless.
- Upstream READMEs state the engine and content must be on matching revision branches (currently `274`) and the setup is run through `Engine-TS` (`npm start`) or the `Server` scripts. Check the READMEs before running anything, and note in docs when behaviour was observed by running the server.

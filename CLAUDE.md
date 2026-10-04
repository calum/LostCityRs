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

## Git rules: never push upstream

- **Never run `git push`** in any submodule or in this repo, and never add or change remotes to enable it. Submodule push URLs are intentionally set to `DISABLED_NO_PUSH`; do not change that.
- Do not open PRs, issues or comments on GitHub for these repos.
- Read-only `gh` / `git fetch` use is fine.
- Each submodule is on the local branch `calum-research`. Stay on it. Local edits to upstream code are allowed only when they help research (e.g. temporary logging); commit them on `calum-research`, keep them minimal, and record them in `docs/local-changes.md` (create it when first needed) so they can be told apart from upstream behaviour.
- Documentation goes in this container repo's `docs/`, not in the submodules.
- Commit only when the user asks.

## Documentation conventions

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

## Tracing workflow

This is how the existing notes were produced; follow it for new ones.

1. Pick one concrete behaviour (e.g. "click a tree", "talk to an NPC") and find its opcode on **both** sides: `ClientProt.ts` and the engine's `ClientGameProt.ts` (or the `ServerProt` pair for the return path). Check ids and payload sizes agree.
2. Follow the chain hop by hop: client send site, engine decoder, handler, state change, which tick phase acts on it, script trigger, script, and the packet that goes back, ending at the client handler. Read each function; do not skip hops.
3. Get citations with `grep -n` on the actual file **after** reading. Do not cite a line number from memory or from an earlier `sed` range. Re-check line numbers before saving a note; earlier drafts had wrong ranges.
4. Record the `git rev-parse --short HEAD` of each repo read, and the method (read vs ran).
5. Separate findings, labelled inferences and "not checked". Add every unverified thing to `docs/open-questions.md` and remove items you answer.
6. Add the note to the index in `docs/README.md`. Commit only when the user asks.

## Staleness check

Notes are only valid at the commits they record. Before relying on a note's line numbers, compare its recorded hashes with `git -C Engine-TS rev-parse --short HEAD` (and `Content`, `Client-TS`). If they differ, re-verify the cited lines and update the note's commit hash. Do not move the submodules to other commits or branches without telling the user, since that invalidates the notes.

## Environment

- Windows 11; use Git Bash or PowerShell. `python3` is available in Git Bash and is handy for scripted doc edits. The "LF will be replaced by CRLF" git warnings are harmless.
- Upstream READMEs state the engine and content must be on matching revision branches (currently `274`) and the setup is run through `Engine-TS` (`npm start`) or the `Server` scripts. Check the READMEs before running anything, and note in docs when behaviour was observed by running the server.

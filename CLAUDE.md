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

## Environment

- Windows 11; use Git Bash or PowerShell.
- Upstream READMEs state the engine and content must be on matching revision branches (currently `274`) and the setup is run through `Engine-TS` (`npm start`) or the `Server` scripts. Check the READMEs before running anything, and note in docs when behaviour was observed by running the server.

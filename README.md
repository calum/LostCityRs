# LostCityRS Research

A personal **learning project**. The goal is to fully understand, from the source code, how the LostCityRS game engine works:

- how the **server engine** processes client interactions (packets, the game tick, entities, interactions, zones),
- how **scripts** (RuneScript, in the Content repo) define game mechanics and are executed by the engine,
- how the **client** behaves, from the perspective of game mechanics and observable behaviour.

This repository is a container. It holds the upstream LostCityRS repositories as git submodules plus our own notes in [`docs/`](docs/).

## Ground rules: evidence only, no guessing

Everything written in this project must be **evidenced and accurate**.

1. **Every claim cites source.** Reference the repo, file and line (e.g. `Engine-TS/src/engine/World.ts:123`) and the commit it was read at. If you cannot point at the code, do not write the claim.
2. **No guesses, no "probably".** If something has not been verified in code or by running it, it is an **Open Question**, written as one, and listed in [`docs/open-questions.md`](docs/open-questions.md). It is never written as fact.
3. **Distinguish what was read from what was run.** Say whether a statement comes from reading code or from observed runtime behaviour.
4. **Names and file layouts are not behaviour.** A file called `Interaction.ts` does not tell us what it does until we have read it.
5. **Prior knowledge of RuneScape is not evidence.** The engine replicates a specific historical revision; real-game memory or wiki knowledge must not be assumed to match. Verify in this code.
6. **Correct, don't pile on.** If a doc turns out to be wrong, fix or delete it. Stale documentation is worse than none.

See [`CLAUDE.md`](CLAUDE.md) for the same rules as instructions to Claude Code.

## Repositories (submodules)

Each fork's **`main`** branch holds all of Calum's changes (relic hooks, client camera, earlier research), fast-forwarded from the former `relic-mode` / `calum-research` branches (kept for history, listed in [`docs/local-changes.md`](docs/local-changes.md)). `.gitmodules` sets `branch = main` for every submodule. Upstream-derived branches in the forks (e.g. `274`) are left as they are.

Each submodule's `origin` is Calum's fork (`github.com/calum/<name>`), not the upstream below. See [`docs/setup/submodule-forks.md`](docs/setup/submodule-forks.md).

| Directory | Upstream | Role (per upstream description) |
|---|---|---|
| `Engine-TS/` | https://github.com/LostCityRS/Engine-TS | RS engine behaviour in TypeScript. Contains the network protocol and data tools. |
| `Content/` | https://github.com/LostCityRS/Content | Game content: scripts, configs, maps and assets. |
| `Client-TS/` | https://github.com/LostCityRS/Client-TS | Client source port to TypeScript. |
| `RuneScriptTS/` | https://github.com/LostCityRS/RuneScriptTS | Compiler for the RuneScript implementation, written in TypeScript. |
| `Server/` | https://github.com/LostCityRS/Server | Setup scripts that bring Engine and Content together. |

The Engine-TS README states that historical versions are organised as **branches** and that matching engine and content branches must be used together. Engine-TS, Content and Client-TS were all added at their `274` branch. How the client's revision relates to the engine's is still an open question (see `docs/open-questions.md`).

### Safety: push only to the forks, never to upstream

The submodules point at Calum's forks (`github.com/calum/<name>`). Agents may push `main` (and other branches) to the fork (`origin`) and then commit and push the updated submodule pointer in this root repo. Never push to, or open PRs or issues against, the original `LostCityRS/*` upstreams. If you add an `upstream` remote, set its push URL to `DISABLED_NO_PUSH` (fetch-only). Steps for merging upstream changes into a fork are in [`docs/setup/submodule-forks.md`](docs/setup/submodule-forks.md); the full rules are in [`CLAUDE.md`](CLAUDE.md).

- Our modifications to upstream code (debug logging, the relic-mode hooks, the client camera) are committed on the fork branches and listed in [`docs/local-changes.md`](docs/local-changes.md).
- Our documentation lives in this container repo's `docs/`, not in the submodules.

## Cloning this project elsewhere

```sh
git clone <this repo> LostCityRs
cd LostCityRs
git submodule update --init
```

The submodule commits recorded here are on the forks' `main` branches (the pointers can be ahead of upstream). If `git submodule update --init` cannot find a commit, see [`docs/setup/submodule-forks.md`](docs/setup/submodule-forks.md).

`Client-TS` has its own nested submodules under `3rdparty/` (`tinymidipcm`, `bzip2-wasm`, `emsdk`). They have **not** been initialised.

## Documentation layout

| Path | Purpose |
|---|---|
| [`docs/README.md`](docs/README.md) | Index of all notes and the template every note follows |
| [`docs/open-questions.md`](docs/open-questions.md) | Things not yet verified; the to-do list for research |
| [`docs/local-changes.md`](docs/local-changes.md) | Every edit we made to upstream code (relic hooks, client camera) |
| [`docs/setup/headless-test-harness.md`](docs/setup/headless-test-harness.md) | `mise run test`: fast in-process tests (`harness/`, `tests/`); new behaviour starts with a failing test (see `CLAUDE.md`) |
| [`docs/guide/relic-mode-player-guide.md`](docs/guide/relic-mode-player-guide.md) | Player guide for the relic mode (source of truth for the Pages relic wiki) |
| `mods/` | Our own RuneScript (the relic mode), synced into `Content/scripts/_mods/` |
| `harness/`, `tests/` | The headless test harness and its tests (`mise run test`; 426 tests passing on 2026-10-12) |
| `config/` | `world.json`, the engine config this repo expects; `mise run relics:config` copies it to `Engine-TS/data/config/` (`config/README.md`) |
| `custom-sounds/` | Your own audio replacing the relic chime and the KBD / Kalphite Queen lair music (client side; `custom-sounds/README.md`) |
| `scripts/` | Helper scripts behind the `mise` tasks (submodule updates, client build copy, mod sync, public hosting, headless client) |
| `docs-site/`, `mkdocs.yml` | MkDocs config for the published docs site |

## Status

What has been traced and where it is written down (all in [`docs/`](docs/README.md), which is the index):

- **The game tick**, phase by phase, with an overview, an ordering matrix and worked scenarios: [`docs/tick/`](docs/tick/00-overview.md). Read from code, not all observed running (see `docs/open-questions.md`).
- **Traced flows** (click a tree, the return path, walking, `::` commands, camera, lag): [`docs/flows/`](docs/flows/).
- **RuneScript** (toolchain, language, VM, pointers) and **multi-tick scripts**, as books: [`docs/books/`](docs/books/README.md); readable editions in [`docs/guide/`](docs/guide/).
- **The relic roguelike mode** (our own mod, in `mods/relics/` plus small hooks in the forks): design notes `docs/design/relics-*.md`, the player guide [`docs/guide/relic-mode-player-guide.md`](docs/guide/relic-mode-player-guide.md) and the relic wiki page generated from it (<https://wiki.rogue-relics.co.uk/>).
- **Setup, tooling and hosting**: [`docs/setup/`](docs/setup/local-setup-with-mise.md).

Not covered by the notes: the parts of `Client-TS` outside the packet paths, the camera, the world map and the client-side interface code (rendering in particular). The unverified items are listed in [`docs/open-questions.md`](docs/open-questions.md).

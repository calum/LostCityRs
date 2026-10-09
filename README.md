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

All submodules are checked out on a local branch named **`calum-research`**, branched from the upstream default branch at the time of adding.

| Directory | Upstream | Role (per upstream description) |
|---|---|---|
| `Engine-TS/` | https://github.com/LostCityRS/Engine-TS | RS engine behaviour in TypeScript. Contains the network protocol and data tools. |
| `Content/` | https://github.com/LostCityRS/Content | Game content: scripts, configs, maps and assets. |
| `Client-TS/` | https://github.com/LostCityRS/Client-TS | Client source port to TypeScript. |
| `RuneScriptTS/` | https://github.com/LostCityRS/RuneScriptTS | Compiler for the RuneScript implementation, written in TypeScript. |
| `Server/` | https://github.com/LostCityRS/Server | Setup scripts that bring Engine and Content together. |

The Engine-TS README states that historical versions are organised as **branches** and that matching engine and content branches must be used together. Engine-TS, Content and Client-TS were all added at their `274` branch. How the client's revision relates to the engine's is still an open question (see `docs/open-questions.md`).

### Safety: never push the submodules

Commits to this root repo are pushed to `calum/LostCityRs`. The submodules are owned by other developers and are never pushed. As a guard, every submodule's **push URL** has been set to the invalid value `DISABLED_NO_PUSH`, so `git push` inside a submodule fails by design. Do not undo this.

- Our modifications to upstream code (for example debug logging added to trace behaviour) stay local, on `calum-research`.
- Our documentation lives in this container repo's `docs/`, not in the submodules.

To re-apply the guard (for example after re-cloning):

```sh
git submodule foreach 'git remote set-url --push origin DISABLED_NO_PUSH'
```

This root repo's remote is https://github.com/calum/LostCityRs.

## Cloning this project elsewhere

```sh
git clone <this repo> LostCityRs
cd LostCityRs
git submodule update --init
```

The submodule commits recorded here point at upstream commits. The local `calum-research` branches exist only in the clones where they were created.

`Client-TS` has its own nested submodules under `3rdparty/` (`tinymidipcm`, `bzip2-wasm`, `emsdk`). They have **not** been initialised.

## Documentation layout

| Path | Purpose |
|---|---|
| [`docs/README.md`](docs/README.md) | Index of all notes and the template every note follows |
| [`docs/open-questions.md`](docs/open-questions.md) | Things not yet verified; the to-do list for research |

## Research plan

Planned approach: trace one action end to end and document each hop with citations.

1. Client packet definitions: `Client-TS/src/io/ClientProt.ts`, `ServerProt.ts`.
2. Engine decoding and dispatch: `Engine-TS/src/network/`.
3. The game tick: `Engine-TS/src/engine/World.ts`.
4. Entities and interactions: `Engine-TS/src/engine/entity/`.
5. Script execution: `Engine-TS/src/engine/script/` and `RuneScriptTS/`.
6. Game rules: `Content/scripts/`.
7. Client behaviour: `Client-TS/src/client/`.

None of the above has been read yet. This list is a reading order, not a set of findings.

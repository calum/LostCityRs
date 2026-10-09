# Running LostCityRS locally with mise

Companion config: [`mise.toml`](../../mise.toml) at the repo root.

**Question this answers:** how do I install mise, which services make up a local LostCityRS setup, and which mise tasks build and run them?

**Based on (read, not run):**

| Repo | Commit |
|---|---|
| LostCityRs (container) | `2573b8d` |
| Engine-TS | `1d25566` |
| Server | `0b6a0cb` |
| Client-TS | `7d6ca61` |
| Content | `65b754f` (recorded commit only; not checked out or read) |

**Method:** read the upstream start script, engine config and client build. The `mise.toml` was loaded by mise 2026.10.6 on Linux and `mise tasks ls` listed all seven tasks. No tool was installed through mise, no task was run, and the server was not started.

## 1. Install mise

Not verified here; follow the official instructions at https://mise.jdx.dev/getting-started.html. On Windows, mise is available through `winget install jdx.mise` or Scoop, per those docs (not checked in this session).

Then, from the repo root:

```sh
mise trust          # mise refuses to read a new mise.toml until it is trusted (observed)
mise install        # installs node 24 and bun 1 from [tools]
mise tasks ls       # lists the tasks below
```

## 2. What a local setup is made of

One Node process does almost everything. `npm start` in `Engine-TS` runs `npm install && tsx src/app.ts` (`Engine-TS/package.json:30`). `src/app.ts` then:

1. Packs the cache from Content if it is missing or incomplete (`Engine-TS/src/app.ts:14-20`). The content folder comes from `build.srcDir`, default `'../content'` (`Engine-TS/src/util/WorldConfig.ts:142`).
2. Starts the game world (`World.start()`, `app.ts:36`).
3. Starts the game TCP server (`app.ts:38-39`), default port `43594` (`WorldConfig.ts:95`).
4. Starts the web server (`app.ts:41`), default port `80` on Windows and macOS, `8888` elsewhere (`WorldConfig.ts:86`). This serves the web client at `/rs2.cgi` (`Server/start.js:162,164`).
5. Starts the management server (`app.ts:42`), default port `8898` (`WorldConfig.ts:88`), which hosts the setup page at `/setup` (`Engine-TS/README.md:34`).

Optional services: login, friend and logger servers are separate scripts (`src/login.ts`, `src/friend.ts`, `src/logger.ts`). With `easyStartup` on, `app.ts` starts all three as worker threads (`app.ts:30-34`); it is `false` by default (`WorldConfig.ts:81`). They are off unless enabled in config and are not covered by the mise tasks.

The **client** needs no separate service: the engine ships a prebuilt `client.js` in `Engine-TS/public/client/`, served by the web server. Rebuilding it from Client-TS is optional (`client:build` below).

## 3. Configuration (and one gotcha for mise)

Config lives in `Engine-TS/data/config/world.json` (`WorldConfig.ts:72`). Edit it through the setup page (`mise run configure`, which runs `npm run setup`).

**The engine does not read process environment variables for config.** The `BUILD_SRC_DIR`-style names (`WorldConfig.ts:276`) are only read from a legacy `Engine-TS/.env` file (`WorldConfig.ts:73`), and only when `world.json` does not exist yet, after which they are migrated into `world.json` (`loadWorldConfig`). So a mise `[env]` section cannot configure the engine; `mise.toml` has none.

**Content folder name.** The default `srcDir` is `../content` (lowercase), but this repo's submodule is `Content`. On Windows the filesystem is case-insensitive, so this should work there (inferred, not run). On Linux or macOS with a case-sensitive filesystem, set `build.srcDir` to `../Content` in the setup page first.

## 4. The mise tasks

| Task | Runs | Mirrors |
|---|---|---|
| `submodules:init` | `git submodule update --init Engine-TS Content Client-TS` | First clone only. On existing checkouts it moves submodules to the recorded commit and detaches them from `calum-research`. |
| `engine:install` | `npm install` in `Engine-TS` | `start.js:100` |
| `configure` | `npm run setup` in `Engine-TS` | `start.js:106,256`; `package.json:26` |
| `start` | `npm start` in `Engine-TS` | `start.js:149`; `package.json:30` |
| `dev` | `npm run dev` (restarts on `.ts` changes) | `start.js:251`; `package.json:19`; `Engine-TS/README.md` Workflow |
| `engine:clean-build` | `npm run clean` then `npm run build` | `start.js:262-270`; `package.json:14-15` |
| `client:build` | `bun install`, `bun run build` in `Client-TS`, then copy `out/client.js` to `Engine-TS/public/client/client.js` | `start.js:272-277`; `Client-TS/package.json:10` |

`client:build` overwrites a tracked file in Engine-TS, so it creates a local change in that submodule; record it in `docs/local-changes.md` if kept.

### First run

```sh
mise install
mise run submodules:init     # only if the submodule folders are empty
mise run configure           # Linux/macOS: set build.srcDir to ../Content; then stop it with ctrl+c
mise run start               # first run packs the cache; wait for "world is ready"
```

Then open http://localhost/rs2.cgi (Windows/macOS) or http://localhost:8888/rs2.cgi (Linux).

## 5. What the Server repo does that this does not

`Server/start.js` clones fresh copies of engine, content, web client and **Client-Java** into its own folders (`start.js:83-97`) and runs the Java client with Gradle (`start.js:166-178`). This repo has no Client-Java submodule, so `mise.toml` has no Java client task.

## Open questions

Also listed in [`../open-questions.md`](../open-questions.md) as #62-#65.

- Does the default `../content` resolve to `Content` on Calum's Windows machine? (Inferred yes; not run.)
- Is `bun` actually needed, or is the prebuilt `client.js` enough for research? (Only needed for `client:build`.)
- Do the mise tool installs and each task succeed on Windows? Nothing was run.
- Does `npm run setup` exit on its own after saving, or must it be stopped with ctrl+c? (Not read past `setup.ts:140`.)

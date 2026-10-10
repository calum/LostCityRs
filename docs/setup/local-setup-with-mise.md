# Running LostCityRS locally with mise

Companion config: [`mise.toml`](../../mise.toml) at the repo root.

**Question this answers:** how do I install mise, which services make up a local LostCityRS setup, and which mise tasks build and run them?

**Based on (read, and run on Linux):**

| Repo | Commit |
|---|---|
| LostCityRs (container) | `84fd937` (Windows run; the `copy-client.mjs` change below is uncommitted when this was written) |
| Engine-TS | `1d25566` |
| Server | `0b6a0cb` |
| Client-TS | `7d6ca61` |
| Content | `65b754f` (checked out and packed by the engine; scripts not read) |
| RuneScriptTS | `c454554` (one file read: the compiler's default source path) |

**Method:** read the upstream start script, engine config and client build, then **ran** `mise run up` on Linux (cloud container, mise 2026.10.6 installed from npm `@jdxcode/mise`) against fresh clones of the five upstream repos at the commits above, laid out like this repo (`Engine-TS/`, `Content/`, `Client-TS/` side by side). Observed: mise installed node 24.21.0 and bun 1.3.10, `up` built the client, packed the cache and logged `World ready: Visit http://localhost:8888/rs2.cgi` (`Engine-TS/src/engine/World.ts:327`). A headless Chromium (Playwright) then loaded `/rs2.cgi`, logged in with a new username and password, and reached the in-game character design screen. Not run on macOS.

**Windows 11 run (observed, this session):** `mise trust`, `mise install` (its output showed bun 1.3.10 installed; node 24 was not checked), `mise run setup` (exit 0), `mise run client:build` (exit 0 after the copy step fix below) and `mise run start` all ran. The engine logged `World ready: Visit http://localhost/rs2.cgi` at 11:53:16 (port 80, the Windows default, `WorldConfig.ts:86`); `curl` returned 200 for `/rs2.cgi` and for `/client/client.js` (350315 bytes, the freshly built file), and 80, 8898 and 43594 were listening. `mise run up` was not invoked as one command; its three steps were run in sequence instead. Browser login on Windows was not tested.

## 1. Install mise

Not verified here; follow the official instructions at https://mise.jdx.dev/getting-started.html. On Windows, mise is available through `winget install jdx.mise` or Scoop, per those docs (not checked in this session).

Then, from the repo root:

```sh
mise trust          # mise refuses to read a new mise.toml until it is trusted (observed)
mise install        # installs node 24 and bun 1.3.10 from [tools] (observed on Linux)
mise tasks ls       # lists the tasks below
```

## Quick start

```sh
mise run submodules:init     # only if Engine-TS/, Content/, Client-TS/ are empty (see warning below)
mise run up                  # set up, build the client, start the server
```

Wait for `World ready: Visit http://localhost.../rs2.cgi`, open that URL, click **Existing User** and enter any new username and password. The first run packs the cache from Content (about 20 s observed on Linux). Stop the server with ctrl+c.

The URL is http://localhost/rs2.cgi on Windows and macOS and http://localhost:8888/rs2.cgi elsewhere (`Engine-TS/src/util/WorldConfig.ts:86`, `World.ts:325-327`).

## 2. What a local setup is made of

One Node process does almost everything. `npm start` in `Engine-TS` runs `npm install && tsx src/app.ts` (`Engine-TS/package.json:30`). `src/app.ts` then:

1. Packs the cache from Content if it is missing or incomplete (`Engine-TS/src/app.ts:14-20`). The content folder comes from `build.srcDir`, default `'../content'` (`Engine-TS/src/util/WorldConfig.ts:142`).
2. Starts the game world (`World.start()`, `app.ts:36`).
3. Starts the game TCP server (`app.ts:38-39`), default port `43594` (`WorldConfig.ts:95`).
4. Starts the web server (`app.ts:41`), default port `80` on Windows and macOS, `8888` elsewhere (`WorldConfig.ts:86`). This serves the web client at `/rs2.cgi` (`Server/start.js:162,164`).
5. Starts the management server (`app.ts:42`), default port `8898` (`WorldConfig.ts:88`), which hosts the setup page at `/setup` (`Engine-TS/README.md:34`).

Optional services: login, friend and logger servers are separate scripts (`src/login.ts`, `src/friend.ts`, `src/logger.ts`). With `easyStartup` on, `app.ts` starts all three as worker threads (`app.ts:30-34`); it is `false` by default (`WorldConfig.ts:81`). They are off unless enabled in config and are not covered by the mise tasks.

The **client** needs no separate service: the web server serves `Engine-TS/public/` as static files (`Engine-TS/src/web.ts:301`), and the engine repo ships a prebuilt `public/client/client.js` and `ondemandworker.js`. `client:build` (run by `up`) rebuilds them from Client-TS so client edits take effect. The Client-TS build writes `client.js`, `mapview.js` and `ondemandworker.js` plus `tinymidipcm.wasm` to `out/` (`Client-TS/bundle.ts:149,154-170`); the client loads `ondemandworker.js` as a separate file (`Client-TS/src/io/OnDemand.ts:293`), which is why the task copies it as well as `client.js`.

No login server or database is needed for local play: with the defaults (`easyStartup: false`, login disabled) a new username and password logged straight in (observed).

## 3. Configuration (and one gotcha for mise)

Config lives in `Engine-TS/data/config/world.json` (`WorldConfig.ts:72`). Edit it through the setup page (`mise run configure`, which runs `npm run setup`).

**The engine does not read process environment variables for config.** The `BUILD_SRC_DIR`-style names (`WorldConfig.ts:276`) are only read from a legacy `Engine-TS/.env` file (`WorldConfig.ts:73`), and only when `world.json` does not exist yet, after which they are migrated into `world.json` (`loadWorldConfig`). So a mise `[env]` section cannot configure the engine; `mise.toml` has none.

**Content folder name.** The engine looks for content at `../content` (lowercase), but this repo's submodule is `Content`. Two places use that path:

1. The engine's `build.srcDir`, default `'../content'` (`WorldConfig.ts:142`), used for maps, the watcher and so on.
2. The RuneScript compiler's own default, `['../content/scripts']` (`RuneScriptTS/src/runescript/ServerScriptCompilerApplication.ts:36`; the same string is in the engine's installed `node_modules/@lostcityrs/runescript/dist/runescript.js`). The engine calls `CompileServerScript({ symbols: ... })` without `sourcePaths` (`Engine-TS/tools/pack/Compiler.ts:337`), so **this ignores `build.srcDir`**.

So setting `build.srcDir` to `../Content` is not enough on a case-sensitive filesystem. Observed on Linux: with `build.srcDir` set to `../Content`, packing failed with `ENOENT: no such file or directory, scandir '.../content/scripts'`. The fix used here is a `content` symlink next to `Content`, made by `mise run content:link` (`scripts/link-content.mjs`, ignored by `.gitignore`). The script does nothing when `content` already resolves. On Windows (observed): no link was created, `fsutil reparsepoint query content` reports the entry is not a reparse point, and the packer read the scripts from `content/` without error, so the case-insensitive name resolves directly.

## 4. The mise tasks

| Task | Runs | Mirrors |
|---|---|---|
| `up` | `setup`, then `client:build`, then `start` | The whole stack in one command (run, Linux) |
| `setup` | `content:link`, `engine:install`, `client:install` (in parallel) | `start.js:99-111` |
| `submodules:init` | `git submodule update --init Engine-TS Content Client-TS` | First clone only. On existing checkouts it moves submodules to the recorded commit and detaches them from `calum-research`. |
| `content:link` | `node scripts/link-content.mjs` | See section 3 |
| `engine:install` | `npm install` in `Engine-TS` | `start.js:100` |
| `client:install` | `bun install` in `Client-TS` | |
| `client:build` | `bun run build` in `Client-TS`, then `node ../scripts/copy-client.mjs`, which copies `client.js`, `ondemandworker.js`, `tinymidipcm.wasm` from `Client-TS/out/` to `Engine-TS/public/client/` | `start.js:272-277` (which copies only `client.js`); `Client-TS/package.json:10`. The copy was an inline `node -e` in `mise.toml` until it failed on Windows (observed: `SyntaxError: Invalid or unexpected token`, the quoting was mangled by mise's shell); it now lives in `scripts/copy-client.mjs`. |
| `start` | `npm start` in `Engine-TS` | `start.js:149`; `package.json:30` |
| `dev` | `npm run dev` (restarts on `.ts` changes) | `start.js:251`; `package.json:19`; `Engine-TS/README.md` Workflow |
| `configure` | `npm run setup` in `Engine-TS` | `start.js:106,256`; `package.json:26` |
| `engine:clean-build` | `npm run clean` then `npm run build` | `start.js:262-270`; `package.json:14-15` |
| `mods:sync` / `mods:watch` / `live` | copy `mods/` into `Content/scripts/_mods/` (once / on every change / alongside `start`) | `scripts/sync-mods.mjs`; see `script-dev-loop.md` (tested on Linux) |
| `test` / `test:types` | `node harness/run.mjs` (sync mods, pack what changed, run `tests/*.test.ts` in-process) / typecheck `harness/` and `tests/` | `mise.toml` tasks; see `headless-test-harness.md` (run on Linux) |
| `relics:config` / `relics:hooks` | write the relic-mode `world.json` (8x XP, no checksum verify) / list the relic hooks in the forks, which must match `docs/local-changes.md` | `mise.toml`; see `docs/design/roguelike-relics-dev-plan.md` rule 5 |
| `docs:install` | `python -m pip install -r docs-site/requirements.txt` | MkDocs + Material for the docs site (not an upstream script; not run through mise) |
| `docs:serve` | `python -m mkdocs serve` (live preview at http://127.0.0.1:8000) | `mkdocs.yml` at the repo root |
| `docs:build` | `python -m mkdocs build --strict` into `site/` | Same build `.github/workflows/docs.yml` runs for GitHub Pages |

Run on Linux: `up` (and so `setup`, `content:link`, `engine:install`, `client:install`, `client:build`, `start`). Not run: `submodules:init`, `dev`, `configure`, `engine:clean-build`.

`client:build` overwrites tracked files in Engine-TS (`public/client/client.js`, `ondemandworker.js`, `tinymidipcm.wasm`), so `git status` in that submodule shows them modified after `up`. The built `client.js` differed byte-wise from the shipped one (observed; reason not checked). To return to the shipped copies: `git -C Engine-TS checkout public/client`.

Seen in the log and harmless for a local run (observed, not investigated): npm 11 warns that the install scripts of `prisma`, `@prisma/engines` and `esbuild` are "not yet covered by allowScripts"; the packer warns about three missing models (`woman_legs_model_434`, `npc_mummy`, `skill_slayer_wall_cave_2`).

## 5. What the Server repo does that this does not

`Server/start.js` clones fresh copies of engine, content, web client and **Client-Java** into its own folders (`start.js:83-97`) and runs the Java client with Gradle (`start.js:166-178`). This repo has no Client-Java submodule, so `mise.toml` has no Java client task.

## Open questions

Open questions on this topic are listed in [`../open-questions.md`](../open-questions.md) (the `npm run setup` exit question is #64).

- Does `mise run up` succeed on Windows as one command? Its steps were run in sequence on Windows (see the Windows run note above); the combined `up` invocation was not run.
- Does the Windows browser login work? Not tested.
- Does `npm run setup` exit on its own after saving, or must it be stopped with ctrl+c? (Not read past `setup.ts:140`.)

# Writing your own RuneScript and running it live

**Question this answers:** can I write my own RuneScript, run it on my in-game character without restarting, what is the edit-test loop, and what is there for client-side and server-side changes?

**Based on:**

| Repo | Commit |
|---|---|
| LostCityRs (container) | `2cb4a14` (+ the `mods/` changes in this note's commit) |
| Engine-TS | `1d25566` |
| Content | `65b754f` |
| Client-TS | `7d6ca61` |
| RuneScriptTS | `c454554` (one function read) |

**Method:** read the engine's live-reload code, then **ran** it on Linux (node 24.21.0 via mise, server from `npx tsx src/app.ts`, a headless Chromium logged in as a new user). Observed in game: a new `.rs2` file, an edit to it, a compile error, and the `mods/` sync below. Not run on Windows or macOS. Timings are from one run.

## Answer

**Yes.** A stock `mise run start` already hot-reloads scripts and configs. Save a `.rs2` file under `Content/scripts/`, wait about 10 seconds, and the running world has the new code. No server restart, no logout. Your character stays where it is.

The way to run a script on your own character is a **debug proc**: a script declared `[debugproc,name]`, run by typing `::~name` in the chat box (staff level 4 is automatic locally; see `../flows/dev-cheat-commands.md`).

## The loop (observed)

1. Write `[debugproc,hello]` / `mes("hello v1 from my script");` in a new file `Content/scripts/_calum/scripts/hello.rs2` while the server was running.
2. Engine log, 11 s later: `Packing changes`, then `Reloading with changes`. In game, `::~hello` showed "hello v1 from my script".
3. Changed the text, saved. Log: `Packing changes` 13:10:19, `Reloading with changes` 13:10:27 (8 s). `::~hello` showed the new text. Same logged-in session throughout.
4. Introduced a type error (`def_int $a = "str";`). The console printed `hello.rs2:2:14: ERROR: Type mismatch: 'string' was given but 'int' was expected.` with a caret, and **no reload happened** (the log ends at `Packing changes`). The previously loaded scripts stay live. Fixing the file and saving recovers.
5. A script saved outside a `scripts/` folder is rejected: `Script file ../content/scripts/_mods/hello/hello.rs2 must be located inside a "scripts" directory.`

Tutorial Island quirk (observed): `mes` output appeared as a "Click to continue" dialog, not a chat line.

## How it works (read)

- `World.start` creates a worker thread when `!Environment.node.production && Environment.build.liveReload` (`Engine-TS/src/engine/World.ts:316-317`). `liveReload` defaults to `true` (`Engine-TS/src/util/WorldConfig.ts:141`).
- The worker, `Engine-TS/src/cache/DevThread.ts`, `fs.watch`es `<srcDir>/scripts` and the other asset folders (maps, models, sprites, songs, ...) recursively (`DevThread.ts:114-125`, `trackDir` at `:68-99`). A change starts a 1000 ms timer (`:66`), then `packAll` runs (`:24`). On success it posts `dev_reload`, on an exception `dev_failure` (`:30,37`).
- The world thread handles `dev_reload` by calling `World.reload()` (`World.ts:1766-1767`), which reloads the config types, `Component`, then `ScriptProvider.load('data/pack')` (`World.ts:206-274`). `ScriptProvider.parse` builds new tables and swaps them in at the end (`Engine-TS/src/engine/script/ScriptProvider.ts:85-88`). `dev_failure` prints the error to the console and broadcasts it to every player's chat (`World.ts:1768-1774`).
- `packAll` only runs the server compiler when sources changed (`Engine-TS/tools/pack/PackAll.ts`, `shouldRunServerCompiler`).
- Staff can also type `::reload` (calls `World.reload()`) and `::rebuild` (asks the worker to pack, then reload), `ClientCheatHandler.ts:149-153`.
- `mise run dev` (`npm run dev` = `tsx watch src/app.ts`) is different: it restarts the whole engine when **engine `.ts`** files change (`Engine-TS/package.json:19`). You do not need it for script edits.

## Where to put your own scripts: `mods/`

Content is a submodule owned by upstream, so edits there cannot be pushed. This repo now has:

- `mods/<feature>/scripts/*.rs2` (and `mods/<feature>/configs/*.obj|.npc|.loc|.param|.varp|...`, `interfaces/*.if`), committed in this repo.
- `mise run mods:sync` copies `mods/` into `Content/scripts/_mods/` once; `mise run mods:watch` does it now and on every save; `mise run live` runs the watcher and `start` together. The copy is added to the Content submodule's local `.git/info/exclude` so `git -C Content status` stays clean. Script: `scripts/sync-mods.mjs`.
- Why a copy, not a symlink: the compiler's file walk recurses only into real directories (`RuneScriptTS/src/compiler/ScriptCompiler.ts:586-596 (`walkTopDown`)`, `entry.isDirectory()`). This was **not tested with a symlink**; the copy approach was tested end to end (sync, repack, reload, `::~hello`; `mods:watch` picked up an edit).
- The `scripts/` and `configs/` folder rule comes from `Engine-TS/tools/pack/PackFile.ts:385-394` (`verifyFolder`, default true).
- `mods/hello/scripts/hello.rs2` is a working example.

## Client side and server side: what exists

- **Server scripts** = RuneScript `.rs2`, covered above. Triggers other than `debugproc` (`[opnpc1,...]`, `[opheld1,...]`, `[queue,...]`, `[timer,...]`) are used the same way; look at an existing script in `Content/scripts/` for the header form. Not run in this session beyond `debugproc`.
- **Client "scripts" for this revision**: `Content` has no client script source files besides interfaces: file counts under `Content/scripts` are 1416 `.rs2`, 197 `.if`, and no `.cs2` (`find`). A grep of `Engine-TS/src` and `tools` for `cs2|clientscript` matches only `ScriptFile.ts`, `ScriptOpcode.ts`, `Jagfile.ts`, which were not opened for this; whether any client-script compiler exists is **not verified**. The `.if` interface files contain small stack-op expressions (`script1op1=pushvar,option_brightness`, `script1=eq,1` in `Content/scripts/interface_options/interfaces/options.if`) that the client evaluates; see `../books/multi-tick-scripts/12-client-side.md`.
- **Client code** is TypeScript in `Client-TS`. `mise run client:build` bundles it and copies it into the engine's `public/client/`; there is no watcher, and the browser needs a page refresh (re-login) to load a new `client.js`. `bun run build:dev` (not minified, keeps `console`) exists (`Client-TS/package.json:11`, `bundle.ts:152,163`).
- **Config/interface changes** (new `.obj`, `.if`, models): `packAll` rebuilds the client cache files too and `World.reload` calls `OnDemand.reloadCache()` (`World.ts:207`), but **what an already-open client does with them was not tested**. Expect to refresh the browser for anything the client caches (inference).

## Not checked

- What happens to a script that is mid-run (suspended on a delay or dialogue) when a reload swaps the script tables. Not read.
- Whether editing an existing `.obj`/`.npc`/`.loc` or `.if` shows up in an already-connected client. Not tested.
- Windows behaviour of `fs.watch` recursion and of `mods:watch`.
- Reload time with larger edits (observed 7-11 s for a one-file change).

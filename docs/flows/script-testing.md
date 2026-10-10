# How RuneScript is tested

**Question this answers:** are there unit tests for `.rs2` scripts, and what checking exists instead?

**Based on:** root `19b57d6`; Engine-TS `1d25566`, Content `65b754f`, RuneScriptTS `c454554`. Client-TS and Server were **not** checked out or read. **Method:** read from code and file listings; nothing run.

## Findings

1. **No unit-test harness exists for scripts.** `git ls-files | grep -i -E "test|spec|vitest|jest"` in Engine-TS and RuneScriptTS returns only `UpdateStatEncoder.ts` / `UpdateStat.ts` (a name match on "UpdateStat", not tests). Engine-TS `package.json` has no `test` script (scripts: `build`, `lint`, `dev`, `start`, ... `Engine-TS/package.json:13-31`). RuneScriptTS has only `build` (`RuneScriptTS/package.json:23`) and its README "Testing" section means copying the built compiler into a consumer (`RuneScriptTS/README.md:54-60`), not a test suite.
2. **CI checks compilation only.**
   - Engine: `npm run lint` and `npx tsc --noEmit` (`Engine-TS/.github/workflows/engine.yml:26-32`).
   - Content: clones Engine-TS at ref `274`, `npm ci`, then `npm run build` (the pack) (`Content/.github/workflows/content.yml`). No server start, no script is executed.
3. **The pack step is the static check.** `npm run build` runs `packAll` (`Engine-TS/tools/pack/Build.ts:7`), which calls `runServerCompiler()` (`Engine-TS/tools/pack/PackAll.ts:142-143`), which calls RuneScriptTS `CompileServerScript` (`Engine-TS/tools/pack/Compiler.ts:337`). The compiler runs parse, type-check, code generation, then a pointer check, and stops at the first failed stage (`RuneScriptTS/src/compiler/ScriptCompiler.ts:224-262`, stage results at `:332,377,438,459`). Pointer checking is the protected-access/active-entity analysis (see `docs/books/runescript-intro/`). Errors are printed with file:line and a caret, and `process.exit(1)` if any error exists (`RuneScriptTS/src/compiler/diagnostics/DiagnosticsHandler.ts:144`). So a type error, bad symbol or pointer error fails the Content CI job. **Inference:** the exit code reaches CI through that `process.exit`; I did not run a failing build to confirm.
4. **Runtime testing is manual, via in-game "debugproc" scripts.** `Content/scripts/_test/scripts/{cheats,debug,engine}/*.rs2` hold `[debugproc,name]` scripts (for example `engine/debug_delay.rs2:1`, `engine/bugs.rs2:2`). They are run by a developer typing `~name args` in chat. `ClientCheatHandler` only looks them up when the server is **not** `production` and the player's staff level is 4+ (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:57-62`), parsing typed arguments to the script's parameter types (`:64-90`). The prefix char is `debugProcChar`, default `~` (`Engine-TS/src/util/WorldConfig.ts:106`). These have no assertions or pass/fail result. Grep for `assert`-style procs in Content found none (the `check_*` procs are game logic, e.g. `check_spell_requirements`). One helper, `[debugproc,error]`, just calls `error($str)` (`engine/debug_error.rs2:1-2`).
5. Other review gates: Engine-TS pre-commit runs prettier and eslint on `.ts/.js` (`Engine-TS/package.json` `lint-staged`, `.husky/pre-commit`); Content's pre-commit only normalises final newlines in `scripts/` (`Content/.githooks/pre-commit`).

## Not checked

- Client-TS and Server repos (their own CI/tests).
- Whether any other workflow exists on the upstream default branches beyond the three Engine and one Content file listed (`Engine-TS/.github/workflows/` also holds `migrations.yml` and `pr-convention.yml`, not read).
- That a deliberately broken script fails `npm run build` (not run).

## What a real script test would need (inference)

The engine has no headless mode in the files read; a test would have to start `World`, create a player, run a script and inspect state.

**Update:** this now exists in this repo (not upstream): [`../setup/headless-test-harness.md`](../setup/headless-test-harness.md). `World.start(false, false)` loads the world without starting the clock, a test steps `World.cycle()` itself, and players with a fake socket are driven through the engine's packet handlers. Run with `mise run test`. Also observed while building it: a RuneScript type error makes the pack (`tools/pack/Build.ts`) exit 1, which answers the first part of open question 78.

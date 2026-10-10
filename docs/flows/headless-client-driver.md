# The headless client driver (`scripts/headless-client.mjs`)

**Question this answers:** how does the headless driver work, and can it serve as an end-to-end test runner?

**Based on:** root `16f7eb5` (the script was added in commit `4376b3f`, "relics M1"). Submodules are not checked out in this session, so Engine-TS/Content/Client-TS were **not** read. **Method:** read `scripts/headless-client.mjs` in full and the docs that describe running it; **did not run it**. The author is the relics builder thread; this note describes it and does not modify it.

## What it is

A Playwright-driven Chromium that opens the real browser client and drives it with synthetic mouse/keyboard input. It is not a protocol-level bot: nothing speaks the game TCP protocol directly (`scripts/headless-client.mjs:1-7`, `:21-23`).

> **Update (branch `claude/test-harness-xavwsl`):** for pass/fail tests of server behaviour, use the in-process harness in [`../setup/headless-test-harness.md`](../setup/headless-test-harness.md) (`mise run test`). It addresses the gaps below except client coverage: real assertions and exit codes, waits on game state instead of sleeps, no separate server to start, and NPC/loc ops sent through the engine's handlers instead of pixel clicks. This driver remains the way to exercise the real client.

## How it works (all line numbers `scripts/headless-client.mjs`)

1. **Start-up** (`:13-23`): `node scripts/headless-client.mjs <user> [dir]`. Defaults: user `relic1`, work dir `/tmp/claude-0/drv`, URL `http://localhost:8888/rs2.cgi` (env `CLIENT_URL`). Playwright is `require`d from `/opt/node-tools/node_modules/playwright` (env `PLAYWRIGHT_DIR`) and Chromium from `/opt/pw-browsers/chromium-1194/...` (env `CHROME`): both paths are specific to this cloud container (`:7`, `:11`, `:21`). Launched with `--no-sandbox`, viewport 1000x700.
2. **Login** (`:24-37`): waits a fixed 8 s for the client to load, finds the first `<canvas>`, then clicks by **hard-coded client pixel coordinates**: (462,292) "Existing User", types the username, Enter, types the password `test` (hard-coded, `:32`), clicks (302,322) "Login", waits a fixed 8 s, saves `login.png`, clicks (150,435) to focus the chat input. Success is not checked: it logs `login sent` regardless.
3. **Command loop** (`:39-56`): the driver polls the file `<dir>/cmd` every 200 ms. Any complete (newline-terminated) line appended since the last pass is executed; the offset is kept in memory. Another process (a shell, or Claude) drives it with `echo "say ::~relic_show" >> <dir>/cmd`. Commands: `say <text>` (type with 40 ms/key delay, Enter), `type`, `key <name>`, `click x y`, `shot <name>` (PNG to `<dir>/<name>.png`), `wait <ms>`, `quit`. Unknown commands are ignored silently. Each executed line is logged to `<dir>/driver.log`; the pid is in `<dir>/pid` (`:17-19`).
4. **Sending actions:** two routes. (a) `say ::~name args` types a staff cheat into chat. Per `docs/flows/script-testing.md` finding 4, the server only runs `~` debugprocs when not `production` and the player is staff level 4+ (cites `ClientCheatHandler.ts:57-62`), so the test account must be staff. (b) `click x y` for in-world clicks; the M3 note says clicking an NPC to fight was "unreliable" (`docs/design/relics-m3-tasks.md:5`).
5. **Checking results:** the driver itself has **no assertions and returns no state**. Documented observation methods: screenshots (`shot`), and `console("...")` in a debugproc, which prints to the **server's stdout** (`docs/design/relics-m1-mod-loop.md` finding 8, citing `DebugOps.ts:10`; the helper `[proc,relic_say]` in `mods/relics/scripts/relic_debug.rs2:3-5` does both `mes` and `console`). So a human or Claude reads server stdout or an image afterwards.

## Can it run full end-to-end tests?

**Short answer: it can drive them, but it is not yet a test runner.** This is an inference from the script contents above.

- Works today: log in, run any debugproc, take screenshots, and read results from server stdout. The relic milestones M1 to M3 were verified this way (`docs/design/relics-m1-mod-loop.md`, `relics-m2-xp-energy.md`, `relics-m3-tasks.md`).
- Gaps for a real e2e runner:
  - **No assertions or exit code.** Needs a test file format, expected-output matching, and a nonzero exit on failure.
  - **Results only via server stdout/screenshots.** A runner should capture server stdout (or add a debugproc that writes a structured `PASS`/`FAIL` line via `console`) and match on it. Waiting on the log line would replace the fixed sleeps.
  - **Fixed sleeps and pixel coordinates** for login and focus (`:24`, `:30-36`); fragile if layout or load time changes. No login-success check.
  - **Blocking UI.** A level-up dialog blocks further `::` commands until clicked (`docs/design/relics-m2-xp-energy.md:11`); Tutorial Island dialogs also intercept (`relics-m1 finding 8`). Tests need a known-clean character state or a click-to-continue step.
  - **Server lifecycle.** The script assumes the server is already up (`mise run up`, see `docs/setup/local-setup-with-mise.md`); a runner must start it, wait for ready, reset or create fresh accounts, and stop it. Account creation on first login is implied by "a new user" in `docs/setup/script-dev-loop.md:15` but not verified here.
  - **Container-specific paths** for Playwright and Chromium (`:11`, `:21`); needs to resolve these generally (e.g. a local `playwright` dependency).
  - **Real in-world interaction** (clicking NPCs, walking) is unreliable per the M3 note; stick to debugproc-triggered scenarios, which exercise the real scripts (the M3 `::~relic_kill` runs the NPC's real `[ai_queue3,...]`).
- Suggested shape (design suggestion, not built): a spec file of `say`/expect-log pairs; a runner that spawns the server, tails its stdout, plays the commands, and fails if an expected line does not appear within a timeout. The builder thread owns the script, so this would be a new file or a request to that thread.

## Not checked

- Never ran the script, so login coordinates, timings and the default Chromium path were not confirmed here.
- Did not read `DebugOps.ts` (submodules not checked out); the `console` claim rests on `relics-m1-mod-loop.md`.
- Whether the server's stdout can be captured under `mise run up` was not checked.

## Open questions

See `docs/open-questions.md` #80.

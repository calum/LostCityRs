# Headless test harness (`harness/`, `tests/`)

**Question this answers:** how do I write fast, repeatable pass/fail tests for game behaviour (content scripts, mods, engine hooks) without a browser, and how does the harness drive the real engine?

**Based on:**

| Repo | Commit |
|---|---|
| LostCityRs (container) | branch `claude/test-harness-xavwsl`, merged with `main` at `5ed50cb` |
| Engine-TS | `8c4fa9ca` (`relic-mode`) |
| Content | `73546549b` (`relic-mode`, M6) when built; suite re-run green at `c8cff7b57` (M8, root `5ed50cb`) |

**Method:** engine code read (citations below), then the harness was **built and run** on Linux with Node 24.21.0: the 16 tests in `tests/` pass, a deliberately failing test exits 1, and three runs of the same combat test gave the same tick count and XP. Not run on Windows or macOS.

## Summary

The harness runs the real `World` **inside the test process**, with no network, no client and no 600 ms clock. Each test logs in one or more headless players ("bots") and drives them either with **client packets handled by the engine's own handlers** (op an NPC, op a loc, op an item, walk, continue a dialogue, pick a choice, type `::` commands) or with **direct server-side set-up** (teleport, give items, set varps and levels, call a proc). Tests assert on real state: position, inventory, varps, stats, messages, dialogue text, open interfaces.

It does **not** test the client: no rendering, no client route finder, no packet bytes. For that, `scripts/headless-client.mjs` (`../flows/headless-client-driver.md`) is still the tool.

Speed (observed): booting the world takes about 4.5 s per test file (map and 7322 NPC spawns load). A tick then takes about 20 ms with the whole world simulated, about 30 times faster than real time. The full suite (16 tests in 3 files, 2 files in parallel) runs in about 13 s including the incremental pack.

## Running

```
mise run test                                   # sync mods/, pack what changed, run tests/*.test.ts
mise run test -- tests/relics.test.ts           # one file
mise run test -- --grep Hans                    # tests whose name matches
mise run test -- --no-build                     # skip sync and pack (cache already current)
mise run test -- --verbose                      # also print engine output while tests run
mise run test:types                             # typecheck harness/ and tests/
```

Without mise: `node harness/run.mjs [same arguments]` with Node 24+. `harness/run.mjs`:

1. runs `scripts/link-content.mjs` and `scripts/sync-mods.mjs` (so `mods/` is in the build, as in the dev loop, `script-dev-loop.md`);
2. packs with `tools/pack/Build.ts`, which only recompiles what changed (observed about 1 s when nothing changed, about 20 s for a first full pack). A RuneScript compile error stops the run before any test (observed: a type error printed `ERROR: Type mismatch` and the pack exited 1);
3. runs `node --import tsx --test --test-concurrency=2 <files>` with the working directory `Engine-TS/` (the engine reads `data/config/private.pem` and `data/pack/` by relative path, `Engine-TS/src/engine/World.ts:104`). Node's test runner gives each file its own process, so each file gets its own fresh world.

It opens no ports, so it can run while a dev server (`mise run start`) is up in the same checkout. It writes no save files (see "How it works", step 6).

## Writing a test

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld(); // boot once per file; remove bots after each test

test('woodcutting: chop a tree near Lumbridge until some logs arrive', () => {
    const bot = Bot.spawn(); // Lumbridge, tutorial done, staff 4
    bot.clearInv().give('bronze_axe');

    bot.opLoc(bot.findLoc('tree', 40), 1); // "Chop down"
    bot.waitForMessage('You swing your axe at the tree.', 40);
    bot.waitForMessage('You get some logs.', 200);

    assert.equal(bot.count('logs'), 1);
});
```

Put files in `tests/` named `*.test.ts`. Everything is synchronous: a "wait" runs ticks until a condition holds or a tick limit is hit.

### Bot API (all in `harness/src/Bot.ts`)

| Group | Methods |
|---|---|
| Spawn | `Bot.spawn({ name, at, tutorialDone, staff, varps, levels, save, failOnScriptError })`, `Bot.defaults` (merged into every spawn), `bot.relog()`, `bot.remove()`, `bot.save()` |
| Time | `tick(n)`, `waitUntil(cond, maxTicks, what)`, `waitForMessage(re, maxTicks)`, `waitUntilIdle(maxTicks)`, `idle` |
| Read state | `pos`, `x`/`z`/`level`, `stat(s)`, `baseLevel(s)`, `xp(s)` (tenths, as stored), `varp(name)`, `count(obj, inv)`, `items(inv)`, `messages`, `texts`, `dialogText`, `choices`, `inDialog`, `chatModal`, `mainModal`, `serverLog(sinceTick)` |
| Find | `findNpc(type, radius)`, `findLoc(type, radius)`, `findObj(type, radius)`, `spawnNpc(type, at)` |
| Client input (queued, real handlers) | `opNpc(npc, op)`, `opLoc(loc, op)`, `opObj(obj, op)`, `opHeld(obj, op)`, `useOnHeld`, `useOnNpc`, `useOnLoc`, `walkTo(coord, run)`, `walk(coord)`, `continueDialog()`, `skipDialog()`, `choose(n or text)`, `clickButton(com)`, `enterCount(n)`, `closeModal()`, `cheat(text)`, `debugproc(name, ...args)` |
| Server-side set-up (immediate) | `teleport(coord)`, `give(obj, n, inv)`, `clearInv(inv)`, `setVar(name, v)`, `setLevel(stat, lvl)`, `call(script, ...args)` |
| Assert | `expectMessage(re)`, `expectNoMessage(re)`; failures carry `describe()`: position, tick, active script, open interfaces, dialogue text, last inputs (and whether the handler rejected them), last messages |

Names are config debugnames (`'bronze_axe'`, `'hans'`, `'tree'`, varp `'tutorial'`, stat `'woodcutting'`). Coordinates are `{x, z, level}` or a RuneScript literal such as `'0_50_50_22_22'` (`../reference/coordinates.md`).

`useWorld()` (from `harness/src/index.ts`) boots the world in `before`, and removes every bot after each test. **World state carries over between tests in one file** (a felled tree stays a stump, a killed NPC is gone until it respawns); put tests that need a clean world in their own file.

`tests/helpers.ts` `useVanillaWorld()` also sets `Bot.defaults = { varps: { relic_started: 1 } }` when the relic mod is in the cache. Without it, every bot that logs in with the tutorial done gets the first relic offer (`[login,_]` calls `~relic_on_login`, `Content/scripts/login_logout/login.rs2:49`, which calls `[proc,relic_first_offer]` and queues `relic_offer_q`, `mods/relics/scripts/relic_offer.rs2:216-225`), and the offer's choice dialogue blocks other actions. `tests/relics.test.ts` uses plain `useWorld()` because it tests that offer.

### Example tests in this branch

- `tests/smoke.test.ts`: login and welcome message, tick speed, give/count/clear, teleport and walk (including a blocked destination), `::~hello` through the real cheat handler, debugprocs refused below staff 4, levels, a full dialogue with Hans (NPC op, continue, choice by text, continue to the end), relog keeps items/position/varps, a RuneScript `error()` fails the test.
- `tests/skills.test.ts`: woodcutting with and without an axe, burying bones (`opheld1`), killing a spawned chicken.
- `tests/relics.test.ts`: first-login relic offer and picking a relic; XP tier 3 gives exactly 8 times the XP of tier 0 for the same `stat_advance` (the `Player.addXp` hook, `../design/relics-m2-xp-energy.md`).

## How it works (read from code; the harness relies on each point)

1. **The world can start without its own clock.** `World.start(skipMaps = false, startCycle = true)` (`Engine-TS/src/engine/World.ts:293`) only calls `cycle()` when `startCycle` is true. The harness calls `World.start(false, false)` (`harness/src/world.ts`), so maps and NPC spawns load but nothing ticks until a test asks.
2. **One tick = one `World.cycle()` call.** `cycle()` ends by scheduling itself with `setTimeout(this.cycle.bind(this), ...)` (`World.ts:508`). `stepTick()` swaps `setTimeout` for one call so that the bound `cycle` is not scheduled, and the eleven phases run exactly as on a live server (`../tick/00-overview.md`). If a phase throws, `cycle()` logs "eep eep cabbage", removes all players and calls `process.exit(1)` (`World.ts:509-525`); the harness turns that exit into an `EngineCrash` error so the test fails with the logged cause.
3. **The live-reload worker is not started.** `World.start` creates the `DevThread` file watcher when not production and `build.liveReload` is on (`World.ts:316`). The harness sets `Environment.build.liveReload = false` before starting, and `node.production = false` so debugprocs are allowed (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:57`).
4. **A headless player is a real `NetworkPlayer` with a fake socket.** `PlayerLoading.load(name, save, client)` builds a `NetworkPlayer` when given a client and a plain `Player` otherwise (`Engine-TS/src/engine/entity/PlayerLoading.ts:29-34`). A plain `Player` is not enough: `Player.write` drops every message unless `isClientConnected` (`Engine-TS/src/engine/entity/Player.ts:2240-2243`), and phase 2 only decodes input for connected players (`World.ts:617`). `isClientConnected` is "a `NetworkPlayer` whose client is not a `NullClientSocket`" (`Engine-TS/src/engine/entity/NetworkPlayer.ts:398-400`). So the harness loads a `Player` (no client) and re-prototypes it to `TestPlayer extends NetworkPlayer` with a `HarnessSocket` (`harness/src/TestPlayer.ts`). The socket's `remoteAddress` is `127.0.0.1` because `processLogins` puts a connected player into `playerLoop` only when the address contains `.` or `:` (`World.ts:911-933`); any other value would leave the player out of every phase.
5. **Login is the real login tick.** `Bot.spawn` adds the player to `World.newPlayers`, the set a real login reaches (`World.onLoginMessage`), and ticks once: `processLogins` gives it a slot, enters the zone and runs `Player.onLogin` and the `[login,_]` script. Before that, `spawn` places the player (Lumbridge by default) and sets `%tutorial` to 1000 (`^tutorial_complete`, `Content/scripts/general/configs/quest.constant:1`), so the login script skips `@start_tutorial` (`login.rs2:82`) and sets up all tabs (`~initalltabs`, `login.rs2:85`). Staff level defaults to 4.
6. **The login, friend and logger workers are terminated after boot.** Players never go through them, and a logout would otherwise write a save file: the login thread writes `data/players/<profile>/<name>.sav` (`Engine-TS/src/server/login/LoginThread.ts:121`). `bot.remove()` calls `World.removePlayer` and deletes the `logoutRequests` entry that `flushPlayer` adds (`World.ts:2365-2368`), so no save is queued. It does **not** run the `[logout]` script.
7. **Client input goes through the engine's handlers, in phase 2.** `TestPlayer.decodeIn` replaces `NetworkPlayer.decodeIn`/`read`: each queued `{prot, message}` goes to `ClientGameProtRepository.getHandler(prot).handle(message, player)`, the same call `read()` makes after decoding bytes. The per-tick cap on accepted user events (`ClientGameProtCategory.USER_EVENT`, limit 5, `Engine-TS/src/network/game/client/ClientGameProtCategory.ts:6`) is kept. So the handlers' rules apply: for example `OpNpcHandler` rejects an NPC the client could not see (`rsbuf.hasNpc`, `Engine-TS/src/network/game/client/handler/OpNpcHandler.ts:33`), and `OpHeldHandler` needs the inventory component to be visible and transmitted (`OpHeldHandler.ts:25-31`). Rejected inputs show as `REJECTED` in a failure's description.
8. **Ops send a route first, as the client does.** The real client sends `MOVE_OPCLICK` with its own route before an op packet, and with the default `clientRoutefinder` the engine follows that route instead of pathing itself (`../flows/move-opclick.md`; `MoveClickHandler.ts:42`). Observed: an `OPLOC1` on a tree 30 tiles away without a route ended in "I can't reach that!" (`Player.ts:1295`). The harness computes the route with the engine's own `findPathToLoc`/`findPathToEntity`/`findPath` (`Engine-TS/src/engine/GameMap.ts:416-426`, the calls `PathingEntity.pathToTarget` makes) and sends it as `MOVE_OPCLICK` before the op. This stands in for the client's route finder; the two may pick different routes.
9. **Server messages are recorded, not encoded.** `TestPlayer.writeInner` stores each message object with its tick (player and NPC info are skipped: one per tick). `mes` arrives as `MessageGame`, dialogue text as `IfSetText`. Phase 10 still computes player/NPC info for the bot, which is what makes `rsbuf.hasNpc` true for nearby NPCs.
10. **RuneScript errors fail the test.** `ScriptRunner` reports an error to the player as `script error: ...` plus a backtrace (`Engine-TS/src/engine/script/ScriptRunner.ts:191`). After each tick and each `call`, the bot throws if such a message arrived (turn off with `failOnScriptError: false`).
11. **Engine output is captured.** `console.log/info/warn/error` are replaced after boot and every line is kept in `serverLog` with its tick. The engine logger prints with `console.log` (`Engine-TS/src/util/Logger.ts:9,15`) and RuneScript `console(...)` is `console.log` (`Engine-TS/src/engine/script/handlers/DebugOps.ts:9-11`), so `bot.serverLog()` can assert on `~relic_say` style output. Use `log()` from the harness to print to the real stderr.
12. **Runs repeat.** The engine has two random sources: `Math.random` (NPC wander, hunt, `PathingEntity`, `World.ts:611` afk events, ...) and the `JavaRandom` singleton behind RuneScript `random`/`randominc` (`Engine-TS/src/engine/script/handlers/NumberOps.ts:32-34`). `JavaRandom` seeds itself from `Math.random` when first imported (`Engine-TS/src/util/JavaRandom.ts:67,126`), before a test could replace `Math.random`, so `bootWorld` reseeds both (seed 1 by default, `bootWorld({ seed })`). Observed: before `JavaRandom` was reseeded, three runs gave three different relic seeds; after, three runs gave the same seed and the same 40-tick chicken kill.
13. **The world warms up for 20 ticks before the first test.** Content compares timestamps in varps (0 for a new character) with `map_clock`, which is `World.currentTick` (`Engine-TS/src/engine/script/handlers/ServerOps.ts:16-17`). Example: `[proc,player_in_combat_check]` says "I'm already under attack!" while `add(%lastcombat_pvp, 8) > map_clock` (`Content/scripts/skill_combat/scripts/player/player_combat.rs2:94,103`). Observed: a bot attacking a chicken on tick 2 got that message and the attack never started. **Inference:** on a live server too, nobody can attack an NPC in a single-combat area during the first 8 ticks after a restart.

## Differences from a real client (what a passing test does not prove)

- No packet bytes: client encoders and engine decoders are not exercised. Use `scripts/headless-client.mjs` or a real client for that.
- Routes come from the engine's route finder, not the client's (point 8).
- Every queued input is "sent" in the same tick; a real client spreads clicks over frames.
- `::` input is lower-cased by `ClientCheatHandler` (`ClientCheatHandler.ts:47`), so string arguments to `bot.debugproc` arrive lower case, as typed ones do.
- `bot.teleport`, `give`, `setVar`, `setLevel` and `call` act between ticks, outside any phase. `call` runs the script with protected access forced, like `ResumePauseButtonHandler` does when resuming (`executeScript(..., true, true)`).
- Tutorial Island, logout scripts and the login/friend servers are not covered.

## Findings recorded while building this

- The `map_clock` warm-up (point 13), the `JavaRandom` seeding (point 12) and the save-file write on logout (point 6) above.
- The nearest `tree` loc to the Lumbridge spawn is about 30 tiles away (3255,3241 in this cache, read from the loaded map).
- Woodcutting checks for a free backpack slot **before** the first swing (`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:41`, swing message at `:73`) and again on each later chop (`:101`).
- The `[tree]` loc config marks `op3=hidden` (`Content/scripts/skill_woodcutting/configs/trees/normal.loc:1,9`), as the comment on `woodcut.rs2:2` says.

## Not checked

- Windows/macOS runs of `harness/run.mjs` (paths are built with `path`, and Node is spawned without a shell, but not run there).
- Memory use with more parallel files (each process loads the whole map; `--jobs` defaults to 2).
- Whether `PlayerLoading.load` + re-prototyping misses any `NetworkPlayer` constructor side effect beyond the fields it sets (`NetworkPlayer.ts` constructor read: `client`, `session`, `client.player`, plus field initialisers).
- Content that depends on `afk_event`, or that reads real time (`Date.now`), under the seeded RNG.

## Related

- `../flows/headless-client-driver.md` (browser driver), `../flows/script-testing.md` (what testing exists), `script-dev-loop.md` (mods and live reload), `../tick/00-overview.md` (what one `cycle()` does).

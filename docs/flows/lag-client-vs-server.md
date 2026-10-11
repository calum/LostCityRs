# Lag in busy moments: browser or server, and what the relic mods cost

**Question this answers:** when the game lags in an intense moment, is it the browser client on the laptop or the server, and do the relic/leagues changes add notable CPU or memory cost on either side?

**Based on:**

| Repo | Commit |
|---|---|
| LostCityRs (container) | `ea92dfa` |
| Engine-TS | `33564f19` |
| Content | `5d971d1da` |
| Client-TS | `a83519a` |

**Method:** code read (citations below) and **measured** in a Linux cloud container, Node 24.21.0, with the in-process harness (`tests/perf-tick.bench.ts`, new) and with the real server plus the real client in headless Chromium (`scripts/headless-client.mjs`, software rendering). All numbers are **from this container's CPU, not Calum's laptop**. Absolute values will differ on the laptop; the comparisons (relics on/off, radius 25 vs 32) are what carry over. Not run on Windows or macOS, and not run during a real play session.

## Verdict (read the caveats below it)

1. **The server has a lot of headroom and the relic hooks are not measurable in the tick time.** A tick must finish inside 600 ms (`Engine-TS/src/engine/World.ts:121`). Measured: about 16-17 ms with nobody online, about 22-27 ms with 120 bots online, about 21-25 ms in the bonus boss fight. The relic runs sat inside the run-to-run noise (about 2-3 ms), see the table. So a server-side cause for lag in a fight is **unlikely** for relic reasons.
2. **The browser is the likelier place for lag.** The client draws the 3D scene in JavaScript on the CPU and pushes the pixels to a 2D canvas (inference from `PixMap.ts:31` `putImageData` and `Canvas.ts:2` `getContext('2d')`; grep -i webgl of `Client-TS/src` finds nothing), at a target of 50 fps, i.e. 20 ms per frame (`Client-TS/src/client/GameShell.ts:40`, `:213`). Your local mod set **raised the default render radius from 25 to 32 tiles** (`Client-TS/src/client/Client.ts:100`, `:1266`; upstream value `Client-TS/src/dash3d/World.ts:117`). Measured scene draw time went from about 7 ms to about 10-11 ms for that change (table), so a busy scene plus a laptop slower than this container can leave very little of the 20 ms frame.
3. **Relic changes to the client are small.** The task toast, custom sounds and custom lair music are start-up fetches and an `<audio>` element, not per-frame work (see "Client-side relic changes"). The one client change that is per-frame and costs real time is the **render radius** (and the camera zoom/tilt range, which was not separately measured).
4. **Both run on the same laptop** if you host locally (the server is one Node thread, about 750 MB resident when idle, `docs/setup/hosting-for-friends.md` item 7). So other tabs and services compete with both. That the laptop's CPU is shared by server and browser is inference from the setup, not measured while playing.

**What was not shown:** which of these was the actual cause of the lag Calum saw. That needs a reading taken at the moment of lag (see "How to tell which side lags").

## Server side

### Per-tick work added by relic mode (read)

- **Engine hooks** that run on hot paths: `addXp` calls `relicWellspring` and `relicGreenThumb` on every XP gain (`Engine-TS/src/engine/entity/Player.ts:1835-1836`); each returns early unless the relic's bit is set (`Player.ts:1897-1900` read for Wellspring). `RELIC_UNLIMITED_RUN` is a constant that changes one condition (`Player.ts:76`, `:706`). Cheap by construction (a varp read and a bit test); not profiled separately.
- **One script per online player per tick:** `[softtimer,relic_playtime_timer]` adds 1 to a varp every tick (`mods/relics/scripts/relic_playtime.rs2:5-6`, started with `softtimer(relic_playtime_timer, 1)` at `:11`, from `[proc,relic_on_login]` `mods/relics/scripts/relic_offer.rs2:335-336`).
- **Bonus boss fight only:** `[ai_timer,relic_bonus_glow]` every 2 ticks does two `huntall` scans (radius 16) of the lair and, per player in the lair, a `spotanim_pl` (`mods/relics/scripts/relic_bonus.rs2:54-84`). Runs only while that controller NPC exists.
- **Content hooks** (kill, damage, delay, gather and so on in `docs/local-changes.md`) are procs called inside scripts that already ran; each is a few instructions. Not profiled one by one.

### Measured tick times (`tests/perf-tick.bench.ts`, wall time of `World.cycle()`, ms)

Two full runs; the second run was noisier. "Every relic" = all relic bits except the retired id 15.

| Situation | Run 1 median / p95 / max | Run 2 median / p95 / max |
|---|---|---|
| 0 bots (world idle) | 16.0 / 20.9 / 24.0 | 17.1 / 20.8 / 39.0 |
| 20 idle bots, relic softtimer running | 19.2 / 27.7 / 34.8 | 21.7 / 27.0 / 32.4 |
| 20 idle bots, timers cleared | 19.9 / 27.4 / 35.8 | 24.1 / 31.2 / 39.1 |
| 120 idle bots (100 with every relic) | 22.3 / 29.8 / 31.5 | 26.6 / 35.5 / 45.0 |
| 1 bot attacking cows, no relics | 22.1 / 30.9 / 44.4 | 23.0 / 29.6 / 46.8 |
| 1 bot attacking cows, every relic | 21.1 / 29.3 / 33.2 | 23.8 / 30.2 / 37.2 |
| lair, 1 bot, no bosses | 23.1 / 30.3 / 31.2 | 23.9 / 26.5 / 27.6 |
| lair, bonus fight running (2 KBD + KQs + glow controller; run 2 confirmed 2 `king_dragon`, 3 `kalphite_queen`, 1 `relic_bonus_glow` alive) | 21.2 / 33.7 / 56.8 | 24.9 / 30.0 / 35.6 |

Reading: the "timers cleared" row is as slow as or slower than the "running" row, so the playtime softtimer is below the noise. Relics on versus off in the cow fight differ by less than the difference between the two runs. These are **ticks in one process with bots**, so they do not include real sockets or real client packet volume.

Where the baseline goes: with debug profiling on and no players the real server printed `13-21 ms npcs` and `2-3 ms cleanup` per tick (observed), i.e. the 7322 static NPCs (`7322/16383 npcs`) are most of the idle cost. That is upstream behaviour, not relic code.

### Spikes

The worst single ticks were 39-57 ms, still about a tenth of the 600 ms budget. The loop schedules the next tick with `setTimeout(..., tickRate - elapsed - drift)` (`World.ts:509`), so a slow tick is absorbed unless it exceeds 600 ms. Whether a laptop under load, with a GC pause or with other programs hungry for CPU would push a tick past that was **not measured**. Memory: Engine heap 405 MB at tick 32 in the profiled run (`debugProfile` line, observed); resident size about 750 MB idle (`docs/setup/hosting-for-friends.md`).

## Client side

### Rendering cost (read, then measured)

- The scene is drawn by JavaScript into an `ImageData` and copied with `putImageData` (`Client-TS/src/graphics/PixMap.ts:19`, `:31`). Frame target 50 fps (`GameShell.ts:40`).
- Scene radius: `World.viewRadius` defaults to 25 upstream (`Client-TS/src/dash3d/World.ts:117`); this fork's client sets it from `?radius=` with default 32, range 10..50 (`Client.ts:100-102`, `:1266`; `::radius N` at `:3129`). 32 vs 25 is 1.64x the tile count (inference: `(32/25)^2`).
- `::fpson` shows `Fps`, `Mem` (Chrome only) and, added in this fork, `Radius` and the moving average (about 20 frames) of the scene draw time (`Client.ts:4312-4314`, `:4955-4980`). The FPS text turns red under 15 (`:4960-4962`).

Measured (headless Chromium, software rendering, Tutorial Island view behind the character design screen, one reading each after 6 s, `Scene:` average):

| Radius | Scene draw (this run) | Earlier run on a Varrock scene (`docs/flows/client-camera.md` finding 19) |
|---|---|---|
| 10 | 4.1 ms | not measured |
| 25 | 7.4 ms | 6.3 ms |
| 32 | 10.6 ms | 10.2 ms |
| 50 | 12.1 ms | 14.0 ms |

Fps stayed at 50 in every case here. The earlier note records one reading of 18.5 ms (Fps 40) at radius 40 with 2x zoom, so the frame budget can run out at larger radius, zoom and a busier scene. The scene draw is only part of a frame (interfaces, minimap and overlays are also drawn each frame; not measured separately). Busy fights add models and animations to the scene; not measured with a real fight.

### Client-side relic changes (read)

- Custom sounds and lair music are fetched once at start-up when low-memory mode is off (`Client.ts:1205-1210`; `Client-TS/src/sound/CustomSounds.ts`, `CustomMusic.ts:21-43`), then music plays from an `<audio>` element (`docs/design/custom-lair-music.md`). That adds a little start-up time and memory, nothing per frame. The memory size of the two decoded tracks was not measured.
- The task-complete toast draws a 2 s fading panel (`docs/design/task-complete-toast.md`); the camera code and the world map (`::map` opens a second window and posts a position once a second, `docs/design/world-map.md`) were not profiled. An open `::map` window is a second page rendering in the same browser, so close it when not needed (inference).

## How to tell which side lags

1. **Client:** type `::fpson`. Watch `Fps` (50 is full speed), `Scene:` (ms to draw the 3D view; the frame budget is 20 ms) and `Mem`. If `Fps` drops in the lag moment while the chat and the character still react once it passes, the browser is the bottleneck. `::radius 25` (back to the upstream value) or `::radius 20` is the quick test: if the lag goes away, rendering was the cost. `::fps 30` caps the target framerate (`Client.ts:3117-3121`).
2. **Server:** put `"node": { "debugProfile": true }` in `Engine-TS/data/config/world.json` and restart (observed to work; `node.debugProfile`, `Engine-TS/src/util/WorldConfig.ts:106`). Each tick then prints `tick N: <ms>/600 ms` and the per-phase times (`World.ts:496-501`), and in-game you get a warning line for any script that takes more than 1 ms (`ScriptRunner.ts:159-169`; seen once in the test run for a first-time `[label,music_play]`, 13 ms). If the `ms/600` stays in the tens while you lag, it is not the server. Server lag looks different in play: everything stops and then jumps (NPCs, walking and chat all freeze together) while the client's Fps stays at 50. That symptom description is inference.
   **Caution:** `mise run relics:config` copies `config/world.json` over `Engine-TS/data/config/world.json` (`mise.toml:134-136`), which would remove the setting again.
3. **Laptop:** the usual suspects are other tabs, a second `::map` window, a laptop on battery saver, and other Node processes. Chrome's task manager (Shift+Esc) shows per-tab CPU and memory.

## Practical tips

- Close other tabs and heavy programs before playing; keep the game tab in the foreground (browsers throttle background tabs; not tested here).
- If `Fps` drops in busy scenes, use `::radius 25` or lower. This is the one change in this fork that is known to cost frame time.
- Zoom out less (a larger zoom shows more of the scene; per-frame cost vs zoom was not measured).
- Do not expect the relics themselves to be the cause; if a fight lags with `Fps` at 50, check the server profile.

## Not checked

- No measurement on Calum's laptop, in a real client session, or in a real fight with many monsters and spell effects on screen (client side).
- Server numbers use bots, no network I/O, one player per run (several for idle). Many real players were not simulated.
- GC pauses, memory growth over a long session and the effect of the audio files on memory were not measured.
- Per-hook cost of each Content hook was not profiled; the evidence is the aggregate comparison above.
- WebGL: the grep found nothing, but the `Pix3D`/`Model` paths were not read in full to prove the rasteriser is software.

## Open questions

Added to `docs/open-questions.md` (#130).

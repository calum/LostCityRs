# Changing settings: client (render distance, zoom) and server (world.json)

**Question answered:** where does each setting live, how do you change it, and when does the change take effect? Includes why scroll zoom and middle-mouse drag can seem not to work.

**Based on commits:**
- Client-TS: `a822635` (fork `main`)
- Engine-TS: `8c4fa9c`

**Method:** read code. Ran the server and the client built from Client-TS `a822635` in headless Chromium on Linux: `::fpson` showed `Radius:32`, scroll zoom and middle-mouse drag worked, and a middle click did not walk. Ran both check scripts below against a stale and a current checkout. Not run on Windows.

## The short version

| Setting | Where it lives | How to change it | Takes effect |
|---|---|---|---|
| Render distance (radius in tiles) | Client only | `::radius N` in chat, or `?radius=N` on the URL | `::radius`: at once. URL: on page load |
| World map window | Client only | `::map` in chat opens `/worldmap.html` (drag to pan, wheel or keys `1`-`4` zoom, `C` centre on you, `K` key, `O` overview, `]` dungeon) | At once (see [design/world-map.md](../design/world-map.md)) |
| Camera zoom | Client only | Mouse wheel over the game view | At once (not saved) |
| Camera rotate/tilt | Client only | Middle-mouse drag, or arrow keys (tilt range 32..480, about 6 to 84 degrees; nearby high ground can stop it going lower) | At once |
| FPS / scene time overlay | Client only | `::fpson`, `::fpsoff`, `::fps N` | At once |
| Canvas size, scaling, mobile keyboard | Browser page (saved in the browser's `localStorage`) | Drop-downs under the game | At once |
| XP rate, members, ports, debug, production, database, … | Server: `Engine-TS/data/config/world.json` | Edit the file or use the setup page | **Restart the server** |
| How far away players/NPCs are sent (15 tiles) | Server code constant | Code change only | Rebuild/restart |

## Client settings

Render distance is a **client** setting. The server does not know or care about it.

1. **`::radius N`** typed in chat sets the radius to N tiles (clamped to 10..50) and rebuilds the visibility table at once (`Client-TS/src/client/Client.ts:3100`). The client handles it itself and does not send it to the server. It lasts until you reload the page.
2. **`?radius=N` on the client URL**, for example `http://localhost/rs2.cgi?radius=40` on Windows (port 80) or `http://localhost:8888/rs2.cgi?radius=40` on Linux. The client reads it at start-up (`Client.ts:1243`). The server's `/rs2.cgi` route ignores the unknown parameter (`Engine-TS/src/web.ts:138-140` reads only `plugin` and `lowmem`). Bookmark the URL to keep your choice.
3. **The default is 32** (`Client.ts:96`), with limits 10 and 50 (`Client.ts:97-98`). Upstream was a fixed 25. Change the default by editing `DEFAULT_VIEW_RADIUS` and rebuilding the client.
4. **`::fpson`** shows FPS, memory, and `Radius:N Scene:X ms`, the average time to draw the 3D scene (`Client.ts:3086`). `::fps N` caps the frame rate (`Client.ts:3092`). The scene line is a quick check that the browser is running the Client-TS build (see the troubleshooting section).
5. **Zoom** is the mouse wheel over the 3D view, from 0.5x to 2x of the original camera distance (`Client.ts:93-94`). It resets on reload.
6. **`?lowmem=1`** on the URL is passed to the client as its low-memory flag (`web.ts:140`, `Engine-TS/view/client.ejs:397`). What low-memory mode changes was not traced.
7. Page controls (size, filtering, mobile keyboard) are saved in the browser's `localStorage` by `Engine-TS/view/client.ejs` (for example `canvasSize`, line 305).

What a bigger radius costs and what it cannot show (players and NPCs beyond 15 tiles): [flows/client-camera.md](../flows/client-camera.md).

## Server settings: `world.json`

1. **The file is `Engine-TS/data/config/world.json`.** The path is resolved from the folder the server is started in, which is `Engine-TS` for `mise run start` (`Engine-TS/src/util/WorldConfig.ts:72`).
2. **Every key is optional.** On load, each key missing from the file takes its default (`WorldConfig.ts:151-176`, `normalizeWorldConfig` at `178`). So a file with only `{ "node": { "xpRate": 8 } }` works. Numbers, booleans and strings are parsed with the `tryParse*` helpers, and a bad value falls back to the default.
3. **The defaults** are in `createDefaultWorldConfig` (`WorldConfig.ts:79-145`). The ones you are most likely to change:

   | Key | Default | Meaning (from its name and use; not every one traced) |
   |---|---|---|
   | `web.port` | 80 on Windows/macOS, 8888 on Linux (`:86`) | Web server port, which serves the client page |
   | `web.managementPort` | 8898 (`:88`) | Management server, which hosts the `/setup` page |
   | `node.port` | 43594 (`:95`) | Game TCP port |
   | `node.members` | true (`:96`) | Members world |
   | `node.xpRate` | 1 (`:98`) | XP multiplier |
   | `node.skillingSecondChance` | true | Skilling buff: a failed skilling roll is rolled again with a 50% chance. `false` = upstream odds. See below |
   | `node.production` | false (`:99`) | Production mode; dev cheats need it off (see [flows/dev-cheat-commands.md](../flows/dev-cheat-commands.md)) |
   | `node.debug` | true (`:101`) | Debug mode |
   | `node.clientRoutefinder` | true (`:103`) | Use the client's route finder |
   | `node.debugProcChar` | `~` (`:106`) | Prefix for `::~name` debug procs |
   | `build.verify` | true (`:138`) | Cache verification (relic mode turns it off) |
   | `build.liveReload` | true (`:141`) | Hot reload of scripts (see [setup/script-dev-loop.md](script-dev-loop.md)) |
   | `build.srcDir` | `../content` (`:142`) | Path to Content |

4. **Changes need a server restart.** The config is read once when the engine loads (`Engine-TS/src/util/Environment.ts:3`). The setup page saves the file and answers `restartRequired: true` (`Engine-TS/src/web.ts:335-342`).
5. **Three ways to edit it:**
   - Edit the JSON by hand, then restart.
   - While the server runs, open `http://localhost:8898/setup` (`web.ts:323`), save, then restart.
   - With the server stopped, `mise run configure` runs `npm run setup` (`Engine-TS/src/setup.ts`), which serves the same page on the management port (`setup.ts:244`, URL built at `:275`).
6. **Environment variables are ignored.** A legacy `Engine-TS/.env` is read only when `world.json` does not exist yet, and is then converted into `world.json` once (`WorldConfig.ts:311-316`). See [setup/local-setup-with-mise.md](local-setup-with-mise.md).
7. **`mise run relics:config` overwrites the whole file** with this repo's `config/world.json` (`build.verify=false`, `node.xpRate=8`). It copies the file rather than merging, so any other keys you set are lost. Re-add them after running it.

## Skilling second chance (on by default on this server)

World setting `node.skillingSecondChance` (default `true`; Engine-TS fork `f8bd5427`). When a skilling success roll fails, the engine rolls once more with a flat 50% chance. Set `"node": { "skillingSecondChance": false }` in `world.json` and restart to get upstream odds. Applies to every player, not a relic.

- Where: the script command `stat_random` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts`, `STAT_RANDOM`). Content calls it for woodcutting, mining, fishing, cooking, firemaking, crafting, thieving (pickpocket, locked doors) and agility, plus some quests and minigames (the Gnomeball shot uses `ranged`). No combat script calls it (grep of `Content/scripts/skill_combat`, `skill_magic`, `skill_prayer`, and the test below counts zero calls during a melee fight).
- Effect: with per-roll success p, success becomes p + (1 - p) / 2. A man pickpocket at thieving 1 goes from about 71% to 85%.
- Agility: `stat_random` is the fall check there too, so obstacles fail less often.
- Tests: `tests/skilling-second-chance.test.ts` (failed before the change with 0.7105 observed vs 0.854 expected; passes after). Not checked: a real client session.
- `mise run relics:config` overwrites `world.json` with the repo copy, which does not set this key, so the default (on) applies.

## Random events (off by default on this server)

Not a `world.json` setting (there is none; searched `Engine-TS` and `Content` for random-event config, nothing found). It is a content constant: `^macro_events_enabled` in `Content/scripts/macro events/configs/macro_events.constant` (Content fork `eb68f73f9`). `0` = off, `1` = upstream behaviour. Edit it in Content, then restart the server (or let live reload recompile). While off, `::~macro_event N` and `::~random_event` do nothing too. Verified by `tests/random-events.test.ts` (failed before the change, passes after; suite 168 passing). Not checked: a real client session.

## Not a setting: the server's entity view distance

The server sends players and NPCs within 15 tiles (`PREFERRED_VIEW_DISTANCE = 15`, `Engine-TS/src/network/rsbuf/build.ts:57`). It is a code constant, not a `world.json` key. The packet format stores positions as 5-bit offsets, so raising it means changing the protocol on both sides ([flows/client-camera.md](../flows/client-camera.md) finding 12).

## Troubleshooting: middle click still walks, or the wheel does nothing

When this happens the browser is running a client **without** the camera changes. There are two ways to get there, and both are now checked by the mise tasks:

1. **Stale submodule.** `git pull` in the root repo updates the commit it records for `Client-TS`, but not the `Client-TS` folder, so `client:build` rebuilds the old code. `mise run client:build` now runs `scripts/check-submodules.mjs Client-TS` first. When the folder is behind, it stops with the fix: `git submodule update --init Client-TS`. `mise run start` runs the same check for `Engine-TS` and `Content`. To make every `git pull` update submodules: `git config submodule.recurse true`.
2. **Upstream client served.** `Engine-TS/public/client/client.js` ships as the upstream build, and only `mise run client:build` replaces it (`scripts/copy-client.mjs`). If you start the server without building, it serves that upstream copy. `mise run start` now runs `scripts/check-client-build.mjs`, which warns when the served `client.js` lacks a string only the Client-TS build contains (`'::radius '`).

**To verify:**

```bash
git pull
git submodule update --init Client-TS Engine-TS Content
mise run client:build      # stops with a message if Client-TS is still stale
mise run start             # warns if it would serve the upstream client
```

Then reload the page with Ctrl+F5 and type `::fpson`. If the overlay shows `Radius:32`, you are on the right build, and the wheel and middle drag should work over the 3D view.

## Troubleshooting: Tasks / Relics buttons missing from the wrench tab

Observed 2026-10-10 on Windows (Content `8535c3ee6`, Engine-TS `8c4fa9c`, root `456ef02`): Content already contained the buttons (`Content/scripts/interface_options/interfaces/options.if:600` `[relic_tasks]`; `Content/pack/interface.pack:10984-10987`), but the packed cache was older than the Content commit: `Engine-TS/data/pack/client/interface` was written 18:19 +0100 (17:19 UTC), `d61913385` is dated 18:25 UTC, and no server was listening.

**Cause (inference from the above plus the code):** `Engine-TS/src/app.ts:14` only packs on startup when the cache is missing (`OnDemand.cache.count(0) !== 9 || ... || !fs.existsSync('data/pack/server/script.dat')`), so an existing cache is not rebuilt after Content changes. The client reads interfaces from that cache.

**Fix (run, worked):** `cd Engine-TS && npm run build` (`tools/pack/Build.ts` calls `packAll`, 6.3 s). `data/pack/client/interface` grew from 102899 to 103791 bytes. Then restart the server and hard refresh (Ctrl+Shift+R), relog. Use `mise run engine:clean-build` for a full rebuild.

**Prevention (added, `mise.toml`):** `mise run engine:pack` syncs mods and repacks. `mise run start` (and so `live`) now runs the same two steps before `npm start`, so a restart always picks up Content and mods changes. Cost: the pack took 6.3 s and 26.2 s on two runs, added to each start. Not verified: a full `mise run start` end to end after this change.

Not checked: that the buttons render in a browser (not run); `mods:sync` printed no errors and `Content/scripts/_mods/relics/interfaces/` has both menu files; which tab (`options` or `options_ld`) you use (`login.rs2:109` picks `options_ld` when `lowmem = true`), but both define the buttons.

## Not checked

- None of this was run on Windows. A `git submodule update` there over a `Client-TS` folder with local changes was not tried.
- Mice or drivers that remap the middle button (so the browser sees another button) were not tested.
- What `lowmem` changes in the client.
- Whether the browser caches `client.js` across a normal reload. The engine serves `public/` with `@fastify/static` (`web.ts:301`); its cache headers were not checked, hence Ctrl+F5 in the steps above.

## Open questions

See `docs/open-questions.md` #97.

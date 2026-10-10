# In-game world map: design

**Question answered:** how do we give the player a world map they can open in game, pan and zoom, and see where they are? Which of "live-rendered" and "pre-rendered" is better, how would it open, and how does it fit the upstream-merge strategy?

**Based on commits:** root `ca4f6ba`, Client-TS `5fd6cc3`, Engine-TS `8c4fa9ca`, Content `8535c3ee6`.
**Phase 1 and 2 status: implemented** (see "Implementation status" at the end; Client-TS `ec49aa1`, Engine-TS `32537f36`).
**Method:** read code, then **built and ran** the existing world-map applet headlessly on Linux (Node 24.21.0, bun, headless Chromium). Nothing here is implemented yet; this is a design plus the evidence it rests on. Not run: a real game session with the map open, Windows/macOS, a production (`node.debug: false`) server.

**Recommendation (details in "Recommendation"):** do not build a new map. The client repo already contains a complete world-map program (`MapView`) and the pack tool already builds its data file. Reuse it, add a player marker, and open it from the game with `::map` (plus an optional button) as a second view that receives the player's position. Phase 1 is almost all wiring.

## Findings

### 1. A world-map program already exists in Client-TS

1. `Client-TS/src/mapview/MapView.ts` (1962 lines) is a separate program from the game client: `export class MapView extends GameShell` (`MapView.ts:14`). It is its own bundle entry, built to `out/mapview.js` (`Client-TS/bundle.ts:154-158`, entry list; MapView at `:156`). Observed: `bun run bundle.ts` produced `out/mapview.js` (80,902 bytes) next to `client.js`.
2. It already does what the request asks for, except the player marker:
   - **Pan:** mouse drag (`MapView.ts:625`, `mainloop` drag block: `focusX = dragFocusX + ((nextMouseClickX - mouseX) * 2 / targetZoom)`) and the arrow keys (`mainloop`, `keyHeld[1..4]`, `MapView.ts:438-455`).
   - **Zoom:** four levels, keys `1`-`4` = 37/50/75/100 % (`targetZoom` 3, 4, 6, 8; first case `MapView.ts:463`) and on-screen buttons, with an eased transition (`zoom += zoom / 30`).
   - **Labels** from the pack (`labels.dat`, loaded in `maininit` `MapView.ts:209-215`), three sizes, drawn only when the zoom has settled (`renderWorldMap`, `if (this.zoom == this.targetZoom && MapView.shouldDrawLabels)`, `MapView.ts:1307`).
   - **Map icons** (`mapfunction` sprites: banks, shops, anvils...) with a **Key** panel (`K`) that flashes all of one kind (`key*` fields from `MapView.ts:92`, `keyNames` at `MapView.ts:129`).
   - **Overview** thumbnail of the whole map with a viewport rectangle (`O`).
   - **Three map areas**: main (`[`), dungeon (`]`), and "extra" (`\`), by changing `mapOrigin*`/`mapWidth/Height` and re-running `maininit` (`reloadMain/reloadDungeon/reloadExtra`, `MapView.ts:1802-1870`).
   - Toggles for NPC dots (`N`), item dots (`I`), labels (`L`), borders (`B`), multi-combat (`M`) and free-to-play (`F`) overlays; `E` exports a PNG.
3. **It renders from tile data at runtime, not from an image.** `renderWorldMap` (`MapView.ts:1015`) fills one rectangle per tile from blended underlay colours and overlay colours/shapes, draws wall lines, map-scene and map-function sprites, then labels. Every redraw is a re-render of the visible tile window, scaled by the zoom ratio. It only redraws when something sets `redraw` (`mainredraw`, `MapView.ts:322-323`).
4. Data it needs is one file, `/worldmap.jag`, downloaded at start (`loadWorldmap`, `MapView.ts:683-713`, `downloadUrl('/worldmap.jag')`). Inside: `underlay.dat`, `overlay.dat`, `loc.dat`, `floorcol.dat`, `labels.dat`, sprites and fonts (`maininit`, `MapView.ts:188-300`).

### 2. The data pipeline already exists and works

1. The pack tool `Engine-TS/tools/pack/map/Worldmap.ts` (`packWorldmap`) reads the packed maps and writes `data/pack/mapview/worldmap.jag` (`Worldmap.ts:690`, `jag.save('data/pack/mapview/worldmap.jag')`). `Pack.js` calls it when the file is missing or maps changed (`Engine-TS/tools/pack/map/Pack.js:255,299,483-485`). So an ordinary `mise run engine:pack` / `start` already builds it.
2. Labels come from `Content/maps/labels.txt` (136 lines of `=Name,x,z,size`; sizes: 96 of size 0, 30 of size 1, 10 of size 2) and are written to `labels.dat` (`Worldmap.ts:651-662`). `/` in a name is a line break (e.g. `=Kingdom Of/Misthalin`; the screenshot shows it wrapped). **Observed.**
3. Only one plane is packed: `let level = 0` per map square (`Worldmap.ts:118`), bumped to 1 only for the Underground Pass squares (`Worldmap.ts:119-121`). Tiles on a bridge use the level above (`flags[1] & 0x2` check). **Inference:** upper floors of buildings are not drawn; the map is "ground floor from above". Not checked in game.
4. Observed: on this checkout, with `Engine-TS/.env` containing `BUILD_VERIFY=false` and `node scripts/sync-mods.mjs` run first, `npm run build` took 21.6 s and wrote `data/pack/mapview/worldmap.jag` = 425,252 bytes.

### 3. Observed: it runs, and it is fast to start

`mapview.js` exports the class but **nothing instantiates it** (`export{Q as MapView}` at the end of `out/mapview.js`; the constructor itself calls `this.run()`, `MapView.ts:182-186`). The engine has no page for it (`Engine-TS/view/` holds `client.ejs`, `java.ejs`, `maped.ejs`, `setup.ejs`), and `scripts/copy-client.mjs` copies only `client.js`, `ondemandworker.js`, `tinymidipcm.wasm`. I made a throwaway page (a `<canvas id="canvas">` and `new MapView()` from `mapview.js`), served it with `worldmap.jag` from a tiny Node server and drove it with Playwright:

- First map frame about **1.3 s** after page load (two runs: 1382 ms, 1297 ms; headless Chromium, localhost, software rendering). No page errors.
- Screenshots: [main map around Lumbridge](../assets/world-map/mapview-main.png), [with the overview open](../assets/world-map/mapview-overview.png), [dungeon area](../assets/world-map/mapview-dungeon.png). All three look right: Lumbridge, Draynor, Port Sarim, Al Kharid, Duel Arena, Tutorial Island, labels, icons; the dungeon view shows the underground rooms on black.
- Not measured: per-frame cost while dragging (the production bundle is minified, so its methods were not callable from the test; I did not rebuild a dev bundle).

### 4. What the game client knows about the player's position

- Absolute tile: `(localPlayer.x >> 7) + mapBuildBaseX`, `(localPlayer.z >> 7) + mapBuildBaseZ`. Used exactly like this in `getSpecialArea` (`Client.ts:5042-5043`); `mapBuildBase*` are set from the scene-centre zone in the rebuild packet (`Client.ts:6869-6870`).
- Level: `Client.minusedlevel`, set from the local player's teleport/level update (`Client.ts:7728`, `this.minusedlevel = buf.gBit(2)`). **Inference** that this is the player's level (it is also the level the scene is drawn at, `Client.ts:4360`); not observed.
- Absolute z >= 6400 is the dungeon band (`docs/reference/finding-npc-locations.md` step 3). The map's dungeon area covers z 9024..10431 and x 2048..3647 (`reloadDungeon`, `MapView.ts:1825-1846`: `mapOriginX = 32<<6`, `mapOriginZ = 141<<6`, `25<<6` by `22<<6`); the main area covers x 2048..3647, z 2624..4031 (`MapView.ts:23-28`); the "extra" area x 1792..3135, z 4032..5119 (`MapView.ts:1848-`). What is in "extra" was not checked.
- Map pixel to tile and back (from `renderWorldMap` label code, `MapView.ts:1307-1313`): `mapX = x - mapOriginX`, `mapY = mapOriginZ + mapHeight - z` (z is flipped: north is up).
- The in-game minimap cannot be reused for a world view: it is built only from the loaded 104-tile scene (`minimapBuildBuffer`, loops `BuildArea.SIZE`, `Client.ts:5326-5340`), so it holds nothing outside the player's surroundings.
- The client has a precedent for player-facing local commands: a block commented `// custom: player-facing commands` handles `::fpson`, `::fps`, `::radius` before any other `::` is sent to the server as `CLIENT_CHEAT` (`Client.ts:3085-3112`). A `::map` handler goes in the same block.

### 5. Constraints that shape the design

- **One canvas per document.** `Canvas.ts` takes `document.getElementById('canvas')` once at import time and exports it (`Client-TS/src/graphics/Canvas.ts:1`); `GameShell` attaches its mouse/keyboard/wheel handlers to that canvas (`GameShell.ts:96-111`). `MapView` and `Client` are both `GameShell`s using that same singleton, so they cannot share one page's canvas without refactoring. They can each run in their own document.
- The engine serves `/worldmap.jag` only inside `if (Environment.node.debug)` (`Engine-TS/src/web.ts:254-257`). `debug` defaults to `true` (`Engine-TS/src/util/WorldConfig.ts:101`), so a default local server already serves it. A production-mode server would 404.
- Anything under `Engine-TS/public/` is served statically (`web.ts:300-302`, `FastifyStatic root public`), so a map page can be a plain HTML file there with no route code.

## Options

| | A. Live render from the game's own scene | B. Pre-rendered image from the cache | C. Reuse `MapView` (render from `worldmap.jag`) |
|---|---|---|---|
| Idea | Draw tile colours from what the client has loaded | Offline tool renders PNG tiles; client shows them | Existing applet, existing data |
| World-wide pan | **No.** Client holds ~104x104 tiles only (finding 4) | Yes | Yes (observed) |
| New code | Large, and the data is not there | New renderer or new use of `MapView` (to bake an image) + tile pyramid + viewer | Marker + wiring |
| Zoom | n/a | Fixed levels baked in; smooth zoom needs a tile pyramid | Four levels already, eased (observed) |
| Labels, icons, key | Would need building | Baked in (static) or re-built | Already there, toggleable |
| Size | n/a | Full-res 1600x1408 tiles at 8 px = 12800x11264 px; a pyramid is tens of MB (arithmetic, not measured) | `worldmap.jag` 425 KB (observed) |
| Updates when maps change | n/a | Must re-bake | Pack tool rebuilds it automatically (finding 2.1) |
| Player marker | Easy | Easy (overlay on image) | Easy (draw after `renderWorldMap`) |
| Upstream conflicts | Edits to `Client.ts` | New files, few edits | New files + small hunks |

A is ruled out by the data, not by taste. B re-solves what `MapView` already does and loses its icons, key, labels and dungeon switching unless rebuilt. **C wins.**

## Opening it: three ways to host `MapView`

All three use the same `MapView` and `worldmap.jag`; they differ in where the map appears.

- **C1. Separate window or tab (recommended first step).** `::map` (and later a button) calls `window.open('/worldmap.html?...')`. The new document has its own canvas, so there is no clash (finding 5). Position goes over a same-origin channel (`BroadcastChannel('worldmap')` or `postMessage` to the opener) about once per second and on level change. Pros: smallest change, zero effect on the game loop. Cons: popup blockers (it is opened from a user key press so should be allowed; not tested), and it is not "in" the game window.
- **C2. Overlay iframe in the game page.** `client.ejs` gets a hidden `<iframe src="/worldmap.html">` positioned over the canvas; `::map` or a key shows/hides it. Same position channel. Pros: feels like in-game, still no canvas clash, game keeps running underneath. Cons: key focus must move between the iframe and the game canvas (the game uses a hidden keyboard canvas; see `client.ejs` near line 362 for the keyboard option), and `client.ejs` is an upstream file (one small hunk).
- **C3. Same canvas.** Run `MapView` inside `Client`'s canvas, a true in-game screen. Needs the `Canvas.ts` singleton and `GameShell` handlers made re-targetable, and the drawing state shared safely (inference: both use the `Pix2D` module's static drawing target, as `MapView.ts` imports `Pix2D` and calls `Pix2D.cls()`, `Pix2D.fillRect`; not tested). Largest refactor, highest merge cost. Not recommended.

Recommended: **C1 now, C2 as an optional polish** reusing the same page and channel. Entry points: `::map` (needs `Client.ts` hunk at `Client.ts:3085`), plus optionally a small button in `client.ejs` (the page already has controls under the canvas). A keyboard shortcut is possible but the game's keys are used for chat input and camera, so a command is safer (reason: chat input handling at `Client.ts:3060` captures typed characters; not checked which function keys are free).

## Design

### Pieces and who owns them

1. **Page `Engine-TS/public/worldmap.html`**: canvas `#canvas`, `import { MapView } from './client/mapview.js'`, `new MapView()`. Static file; no engine route.
2. **Build copy**: add `mapview.js` to the file list in root `scripts/copy-client.mjs` (our own file, not upstream). `mise run client:build` then ships it.
3. **Data route**: `/worldmap.jag` already served in debug mode. To work in production mode, move the route out of the `if (Environment.node.debug)` block (`web.ts:254-257`): one small hunk in the engine fork.
4. **Marker in `MapView`** (`Client-TS`): a `playerX, playerZ, playerLevel` field set from the channel; draw a dot after `renderWorldMap`'s content using the same pixel math as the labels (finding 4). Sprite: `mapmarker.png` and `mapdots.png` exist in `Content/sprites/`; the pack already writes `mapdots` (`Worldmap.ts:638`) and `MapView` already depends on `mapdot0/1`. A pulsing circle (`Pix2D.fillCircle`, used for the key flash at `MapView.ts:1300-1301`) needs no new asset. Blink using the existing `flashTimer`-style counter. Edge case: when the player is off screen, draw an arrow at the edge, or recentre.
5. **Centre on me**: a key (`C`) and the initial focus: set `focusX/focusZ` from the player at start, using the same conversion; clamp using the existing bounds code at the end of `mainloop` (`MapView.ts:662-678` clamps `focusX/Z` to 48 tiles inside the edges).
6. **Area/plane**: choose the area from the player's absolute coordinate (main, dungeon band z >= 6400, "extra" box) and call `reloadMain/reloadDungeon/reloadExtra`. Planes 1-3: put the marker at the same x,z (map only has ground floor); show "Level N" text beside the marker. The Underground Pass squares are packed as level 1 (`Worldmap.ts:118-121`), so check them when testing.
7. **Wheel zoom (optional)**: `GameShell.mouseWheel` is an overridable hook (`GameShell.ts:337`); map it to step `targetZoom` through 3/4/6/8 (the label code only has fonts for those four values, `MapView.ts:1307-`), so free-form zoom would need new label sizing. Keep the four levels.
8. **Position feed from the game**: in `Client.ts`, once per second (or when `mapBuildBase*` or `minusedlevel` change) post `{x, z, level}` computed as in finding 4. Receiving side: `BroadcastChannel` listener in `MapView`.
9. **Command**: `::map` in the player-facing block (`Client.ts:3085`), opens the window; `::map` with the window open focuses it.

### Performance

- Start: about 1.3 s headless (observed). Download 425 KB (observed). Memory: tile arrays of 1600 x 1408 entries for several layers (`TypedArray2d(mapWidth, mapHeight)` in `maininit`); size not measured.
- Redraw is event driven (`redraw` flag), not every frame (`MapView.ts:322-323`), and the marker only needs a redraw once per second plus on input. A separate window/iframe adds a second canvas and a second render loop, but the game loop is untouched.
- Not covered: frame cost while dragging at 100 % on a real GPU browser; mobile.

### Upstream-merge fit

- New files: `public/worldmap.html` (engine fork), our script change in `scripts/` (root repo). No conflict surface.
- Small hunks in upstream-owned files: `Client.ts` (`::map` + position feed), `MapView.ts` (marker, centre key, area pick, wheel), `web.ts` (optional: un-gate the jag route), `client.ejs` (optional button/iframe). Keep each as one commit per hook on `main` of the fork, and list them in `docs/local-changes.md`, as the relic hooks do (`CLAUDE.md`, git rules).
- `MapView.ts` and `Worldmap.ts` are upstream code and have their own history in the fork (`aa20105 chore: MapView changes from 2004-11-17`, etc.), so upstream may change them. Keeping our marker code in a small block and a separate helper class limits the merge surface.
- The pack tool's output format (`worldmap.jag`) is untouched, so mods or content changes keep working.

### Testing plan (TDD rule in `CLAUDE.md`)

- The harness (`mise run test`) boots the server in process and has no client, so it cannot test rendering ("Not covered by the harness", `docs/setup/headless-test-harness.md`). Testable in the harness: nothing new on the server side in Phase 1.
- Coordinate conversion (absolute tile to map pixel and area choice) is pure arithmetic: put it in a small module and unit-test it (bun test exists in Client-TS: `package.json` `"test": "bun test"`). Write those tests first.
- Rendering and window behaviour: verify with the headless-browser driver (`scripts/headless-client.mjs` style, as done for this note), screenshot with the marker at known tiles (Lumbridge `3222,3218`, a dungeon tile, Tutorial Island). Record the gap in `docs/open-questions.md`.

## Phases

1. **Phase 1 (smallest useful):** page + `copy-client` change + `::map` opening it + marker at the player's tile + centre on start. Unit tests for the coordinate math, screenshot test.
2. **Phase 2:** live position updates, level text, auto area switch (dungeon/extra), edge arrow, `C` to recentre, wheel steps.
3. **Phase 3 (optional):** iframe overlay in the game page (C2), production-mode route, relic-mode extras (for example, mark kill-task spawn areas from `docs/tools/npc_spawns.py`).

## Risks and unknowns

- Whether a popup opened by `::map` (typed, then Enter) counts as a user gesture in common browsers: not tested. Fallback is a button.
- Whether `MapView` works inside a nested iframe with focus handling: not tested.
- Whether the "extra" area contains anything of interest, and where Karamja/other islands sit relative to the main area bounds: not checked.
- The map reflects the packed maps at pack time; temporary changes (mods that add scenery) will not show unless they change the map files.
- Wilderness, instanced or special areas where the client's `mapBuildBase` is not the real world position were not checked.

## Not checked

- No real game session with the map open; the position channel and marker do not exist yet.
- `MapView.ts` was read for structure and the parts cited above, not line by line (the render helpers `drawOverlayShape`, wall drawing, loaders were not read in full).
- `maped.js` in `Engine-TS/public/maped/` contains a MapView-derived editor bundle (it fetches `worldmap.jag`); not read.

## Implementation status (Phase 1, done)

Built as designed, option C1 (separate window). Commits: Client-TS `ec49aa1`, Engine-TS `32537f36`; the changes are listed in [../local-changes.md](../local-changes.md).

- `Client-TS/src/mapview/MapCoords.ts`: area table (mirrors `reloadMain/reloadDungeon/reloadExtra`), `areaForTile`, `tileToMap`, `mapToScreen`, `parsePlayerPos`. **Tests first:** `test/map-coords.test.ts` failed 5 of 5 on assertions against stubs, then passed after implementing; `bun test` in Client-TS: 7 pass (5 new, 2 existing camera tests), `tsc --noEmit` clean.
- `MapView.ts`: `BroadcastChannel('lostcity-worldmap')` listener, `drawPlayerMarker` (red dot with white ring and halo, "Level N" text above ground floor), `centreOnPlayer` (switches area if needed, then focuses), run once automatically on the first position after the map data has loaded, and on key `C`.
- `Client.ts`: `::map` in the player-facing command block opens `/worldmap.html` and posts the position at once; afterwards `postMapPosition` posts `{x, z, level}` every 50 client cycles (`Client.loopCycle % 50`, about once a second; 50 cycles at the 20 ms cycle is an inference).
- Engine: `public/worldmap.html`, prebuilt `public/client/mapview.js`, `/worldmap.jag` route moved out of the debug block (`web.ts`). Root `scripts/copy-client.mjs` now also copies `mapview.js`.

**Observed (Linux, Node 24, headless Chromium, real server, new account):**
1. `::map` typed in chat opened a popup; its marker sat on Tutorial Island at the player's tile (3094, 3106), [screenshot](../assets/world-map/marker-tutorial-island.png).
2. After `::~kbd` the posted position became (3068, 10256), the dungeon band. In that run the player then died to the antechamber spiders and respawned in Lumbridge (3221, 3219), so the popup's own `C` press raced with the move; I did not get a clean screenshot of the marker in the dungeon from the real game.
3. The dungeon marker was checked with a synthetic position (3069, 10255) posted to the map page: area switched to the dungeon, marker drawn, [screenshot](../assets/world-map/marker-dungeon.png).

**Not done / not covered:** edge arrow when the player is off screen, wheel zoom, live area switch when you walk into a dungeon after the map is already open (only the first position and `C` switch area; the marker is hidden while you are in a different area), the in-page overlay (C2), mobile, real GPU browsers. `mise run test` (server harness) was not run: nothing server-side changed except serving the jag.

## Implementation status (Phase 2, done)

Client-TS `2ea4280`, Engine-TS `7825ebda`. Tests first again: three new cases in `Client-TS/test/map-coords.test.ts` (`stepZoom`, `shouldFollowArea`, `clampToScreen`) failed on stubs (3 fail, 5 pass), then passed; `bun test` in Client-TS: 10 pass, `tsc --noEmit` clean.

- **Follow into another area:** a position in a different map area than the previous one (for example down the ladder into the dungeon band) sets a flag; `mainloop` then runs `centreOnPlayer` (it is not run from the message callback, so the map data is never reloaded while a frame is drawing). Moving to a tile outside every area does nothing.
- **Off-screen marker:** when the player's tile is outside the window, a dot and the word "You" are drawn on the nearest window edge (24 px margin), `clampToScreen`.
- **Wheel zoom:** `MapView.mouseWheel` steps `targetZoom` through 3, 4, 6, 8 (the label fonts exist only for these), at most one step per 120 ms.
- **"Level N" text** beside the marker (white with black shadow) when the player is above the ground floor.

**Observed** (map page with positions posted over the channel, headless Chromium, real `worldmap.jag`): wheel up moved zoom from 50 % to 75 % ([screenshot](../assets/world-map/marker-edge.png), the 75 % button is lit); a Varrock position while the view showed Lumbridge produced the edge marker at the top ("You" beside it); a following dungeon position switched the map to the dungeon with the marker on the KBD antechamber ([screenshot](../assets/world-map/marker-follow-dungeon.png)); a level-1 position showed "Level 2". Positions were posted by a test script, not by the game client, in this round (the game-to-map feed was observed in Phase 1).

**Still not done:** the in-page overlay (C2), mobile/touch zoom, real GPU browsers, a clean real-game capture of the marker in the dungeon. Marker "level" text assumes `minusedlevel` is the player's level (open question 103).

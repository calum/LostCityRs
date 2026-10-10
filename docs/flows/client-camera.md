# Client camera: orbit camera, render radius, scroll zoom and middle-mouse drag

**Question answered:** how does the web client place and draw the camera, what limits how far you can see (client and server), and how do the local scroll-wheel zoom and middle-mouse drag work?

**Based on commits:**
- Client-TS: upstream `7d6ca61` (branch `274`) for upstream behaviour; `93b19c3` (branch `calum-research`: zoom/drag in `15ece4e`, render radius in `93b19c3`). Line numbers marked *(up)* are at `7d6ca61`; unmarked lines are at `93b19c3`.
- Engine-TS: `8c4fa9c` (branch `relic-mode`).

**Method:** read code. Then **ran** the server (node 24, `npm start`) and the rebuilt client in headless Chromium (Playwright, software rendering, Linux cloud container): at `15ece4e` wheel zoom in and out, middle drag left/right/up/down, middle click on the ground, wheel over the side panel; at `93b19c3` `::radius 25/32/40/50` in Varrock square with `::fpson`. Observed from screenshots only.

## Findings: upstream camera

1. The orbit camera is updated once per client cycle while the scene is loaded: `if (this.sceneState === 2) { this.followCamera(); }` (`Client-TS/src/client/Client.ts:2354`). Arrow keys (`keyHeld[1..4]`) push yaw/pitch velocities, which halve each cycle when released; pitch is clamped to 128..383 and yaw wraps with `& 0x7ff` (2048 units per turn) (`Client.ts:3256` onward; *(up)* `3243-3266`).
2. The camera distance from the player was fixed at `pitch * 3 + 600` in `gameDrawMain` (*(up)* `Client.ts:4194`). There was no zoom.
3. The scene is drawn around the **camera** tile, not the player: upstream `World.minX = World.gx - 25` and the same for `maxX`, `minZ`, `maxZ` (*(up)* `Client-TS/src/dash3d/World.ts:982-997`). The 25-tile radius was hard-coded across `World.ts` (constants 25/26/50/51/53 on 33 lines, including the `visBacking` array sizes, *(up)* `World.ts:116`, `866`).
4. Which tiles in that square are drawn comes from a visibility table built by `World.resetVisCalc(pitchDistance, 500, 800, 512, 334)` (*(up)* `World.ts:858`). `pitchDistance` is the camera's height above the player per pitch bucket, computed from the same `angle * 3 + 600` distance (*(up)* `Client.ts:1227-1235`). The table was built once at start-up.
5. Depth cut: `testPoint` rejected points with depth over 3500 (*(up)* `World.ts:938`), and models with `midZ >= 3500` were not drawn (*(up)* `Model.ts:1723`). 3500 units is about 27 tiles. There is no fog (no match for "fog" in `src/`).
6. Mouse input: upstream `GameShell.mouseDown` maps button 2 to a right click and **every other button, including the middle button, to a left click** (*(up)* `GameShell.ts:327-333`). There was no `wheel` listener.
7. Touchscreen panning already rotates the camera by emulating arrow keys from finger movement (`Client.ts`, `override pointerMove`, the `// moving camera` branch).
8. The client sends `EVENT_CAMERA_POSITION` (pitch, yaw) at most every 20 cycles when `sendCamera` is set (`Client.ts:2185`); upstream only arrow keys set it. The engine only records it for input tracking (`Engine-TS/src/network/game/client/handler/EventCameraPositionHandler.ts`).

## Findings: what the server limits

9. Terrain and locs come from the client's own cache. `REBUILD_NORMAL` carries only the centre zone (`Engine-TS/src/network/game/server/codec/RebuildNormalEncoder.ts`), and the client requests the map files for centre ±6 zones itself (*(up)* `Client.ts:6812-6873`), a 104x104 area (`BuildArea.SIZE = 13 << 3`, `Client-TS/src/dash3d/CollisionMap.ts:9`).
10. The server rebuilds only when the player leaves origin zones -4..+4 (`Engine-TS/src/engine/entity/BuildArea.ts:61-67`). From that arithmetic, the player can be as close as 16 tiles to the edge of the loaded area.
11. Zone updates (ground items, loc changes) are sent only for zones within ±3 zones of the player (`BuildArea.ts:46-53`, used in `Engine-TS/src/engine/entity/NetworkPlayer.ts:296-306`), so about 24 to 31 tiles.
12. Players and NPCs are sent only within 15 tiles (`PREFERRED_VIEW_DISTANCE = 15`, `Engine-TS/src/network/rsbuf/build.ts:57`; checked at `info.ts:24,73,280,310`). Their positions are 5-bit deltas (`info.ts:121-122,363-364`; client `gBit(5)` at *(up)* `Client.ts:7789-7794,8126-8131`), so going past 15 needs a protocol change on both sides.

## Findings: local zoom and drag change, `15ece4e` (see [../local-changes.md](../local-changes.md))

13. **Wheel zoom.** `GameShell` adds a canvas `wheel` listener with `{ passive: false }` (`GameShell.ts:111`). `Client.mouseWheel` (`Client.ts:11682`) calls `preventDefault()` whenever in game, and zooms only over the 3D view (`insideGame()`) and not in a cutscene camera. Each event multiplies `cameraZoom` by 0.9 (wheel up, closer) or 1/0.9 (wheel down, further), clamped to 128..512 (0.5x..2x of the original distance, `Client.ts:93`). The distance becomes `((pitch * 3 + 600) * cameraZoom) >> 8` (`Client.ts:4233`).
14. **Visibility table follows the zoom.** `resetVisCalc()` (`Client.ts:3243`) builds the table with the zoomed distance. `followCamera` rebuilds it once the zoom has not changed for 150 ms (`Client.ts:3262`). Observed: at 2x the far side of the view ends in black earlier, as expected from findings 3 and 5.
15. **Middle drag.** `GameShell.onmousedown` sends `e.button === 1` to `middleMouseDown` with `preventDefault()` (stops browser autoscroll) and returns before `mouseDown`, so a middle click is no longer a left click (`GameShell.ts:322`); `onmouseup` does the same for release (`GameShell.ts:376`). `Client.windowMouseMove` (`Client.ts:11724`) applies the screen-pixel delta directly: yaw `-= dx * 2`, pitch `+= dy` (clamped 128..383), and sets `sendCamera = true`. The drag stops on middle release or if a move arrives with the middle button no longer held. Directions match the touch panning: drag right turns like the left arrow, drag down tilts towards a top-down view.
16. Observed in headless Chromium: zoom in and out change the view; dragging right rotated the view; dragging down raised the pitch; dragging up at minimum pitch did nothing (clamped); a middle click on the floor did not walk the player; the wheel over the side panel did not change the zoom.

## Findings: local render radius change, `93b19c3`

17. `World.viewRadius` (default 25, `World.ts:117`) replaces every radius constant in the visibility table, tile loops and occluder checks; the tables are sized `2R+1` and `2R+3`. `World.setViewRadius(r)` (`World.ts:863`) also sets the depth cut to `r * 128 + 300` for both `testPoint` (`World.ts:950`) and `Model.worldRender` (`Model.ts:1726`), so `r = 25` gives the upstream 3500.
18. The client sets the radius at start-up from `?radius=N`, default 32, clamped to 10..50 (`Client.ts:96`, `1243`), and `::radius N` in chat changes it live and rebuilds the visibility table (`Client.ts:3100`); this command is handled in the client and not sent to the server. With `::fpson`, the client also shows `Radius:` and the average `renderAll` time (`Client.ts:4284`, `4943`).
19. Observed (Varrock square, minimum pitch, 2x zoom, headless software Chromium): radius 25 shows black where the far side of the square should be; 32 fills most of it; 40 and 50 fill the view. Average scene draw time: 6.3 ms (25), 10.2 ms (32), 12.8 ms (40), 14.0 ms (50). At 40 with 2x zoom and a higher pitch, one reading was 18.5 ms with Fps 40, against the 20 ms frame budget at 50 fps. No map edge was seen in these spots.

## Inferences (labelled)

- A larger render radius (raising the 25 in `World.ts` and the 3500 depth cuts) would show more scenery, but beyond about 16 tiles from the player the scene edge can be visible until the next rebuild (finding 10), ground items and loc changes would not update beyond about 24-31 tiles (11), and no players or NPCs would appear beyond 15 tiles (12). Rests on findings 3, 5 and 9-12.
- Zoom out and render radius are coupled: zooming out moves the camera back, but the drawn square and depth cut stay centred on the camera, so less is visible in front of the player. Rests on findings 3, 5 and 13; matches what was seen at 2x.
- Rendering cost grows with the radius but less than the square of it in the one place measured (finding 19), because the visibility table skips tiles outside the view. The timings are from headless software rendering in a cloud container; a desktop browser will differ.

## Not checked

- Frame time on Calum's machine; only the headless container was measured (finding 19).
- How `roofCheck` (roof hiding) behaves when zoomed.
- On Windows/macOS browsers with real mice: only headless Chromium on Linux was run. Trackpad wheel events (many small `deltaY` values) zoom one step per event, which may feel fast.
- Whether anything outside `World.ts` and `Model.ts` assumes the 25-tile radius (only those two files were grepped).
- The scene edge at a large radius while walking towards the edge of the loaded area (finding 10) was not reproduced.

## Open questions

See `docs/open-questions.md` #86 and #87.

# World map search (`::map`)

**Question answered:** how can the player find NPCs, ground items and objects ("mithril", "giant", "knife") on the world map, including underground?

**Based on commits:** root `4316878` (plus this change), Client-TS `a83519a`, Engine-TS `f6f52c47`, Content `d61de358c`.
**Method:** read the map/config files, wrote tests first, then built and ran the map page in headless Chromium (Node 24.11.1, bun, real `worldmap.jag`). **Not covered:** a real game session with `::map`, real GPU browsers, mobile.
**Decisions (Calum, 2026-10-12):** option A (search box inside the existing map page, not a wiki table); locs are searched by **internal name** ("less pretty", no friendly-name generation).

## How it works

1. **Index build** (`scripts/build-map-search.mjs`, pure logic in `scripts/lib/map-search-index.ts`) writes `Engine-TS/public/mapsearch.json` (`{"v":1,"entries":[{id,name,kind,at:[x,z,level,...]}]}`). Inputs:
   - spawns: the `==== LOC ====`, `==== NPC ====` and `==== OBJ ====` sections of `Content/maps/m<MX>_<MZ>.jm2` (`level lx lz: id ...`, absolute tile = `MX*64+lx`, `MZ*64+lz`; same layout as in [../reference/finding-npc-locations.md](../reference/finding-npc-locations.md));
   - ids to debug names: `Content/pack/{loc,npc,obj}.pack`;
   - display names and ops: `name=` and `op1..op5=` in every `*.loc/*.npc/*.obj` under `Content/scripts` (including `_mods`).
2. **What is kept:** all NPC and object spawns; locs only when a config op is not `hidden` (so walls, fences and scenery are dropped). Locs are named by internal name (`mithrilrock1`), because all rocks have the in-game name "Rocks" (`Content/scripts/skill_mining/configs/rocks.loc:245`). NPCs and objects also match on their display name ("Giant", "Moss giant").
3. **Observed result** on this checkout: 2632 names (1304 loc, 1114 npc, 214 obj), 35,689 spawns, 607,377 bytes. "mithril" finds `mithrilrock1` (33 spawns), `mithrilrock2` (33) and the Mithril arrow item (1); "knife" finds 13 ground spawns.
4. **Search** (`Client-TS/src/mapview/MapSearch.ts`): every word must appear in the internal or display name, case-insensitive, spaces and underscores ignored ("mithril rock" finds `mithrilrock1`). Ranking: exact name, prefix, other; ties by spawn count.
5. **Choosing a result** (`MapView.selectSearch`): all its spawns in the viewed area get yellow rings; the map pans to the spawn nearest the player (position from the `::map` channel) among those in the viewed area, else the nearest anywhere. If that spawn is in another map area (main/dungeon/extra, `MapCoords.ts`) the map switches area first (`reloadMain/reloadDungeon/reloadExtra`). Without a player position it takes the first spawn in the viewed area.
6. **UI:** an HTML box over the canvas in `Engine-TS/public/worldmap.html` (Esc clears, Enter picks the first result). The production bundle mangles method names, so the page talks to `MapView` through the fixed handle `globalThis.worldMapSearch` (`query`, `select`, `clear`).
7. **Rebuilding:** `mise run client:build` now also runs the index builder. Re-run `node scripts/build-map-search.mjs` (Node 24) when maps or loc/npc/obj configs change. The generated file is committed in the Engine-TS fork like the prebuilt client.

## Tests (written first, run red, then green)

- `tests/map-search-index.test.ts` (root, node:test): stubs failed 4 of 4, then 4 pass. Run: `node harness/run.mjs --no-build tests/map-search-index.test.ts`; `mise run test:types` clean.
- `Client-TS/test/map-search.test.ts` (bun): stubs failed 6 of 6, then 6 pass; after a later change (no player position takes the first spawn in the viewed area) the updated case failed first, then passed. `bun test` in Client-TS: 30 pass; `tsc --noEmit` clean.
- Rendering: headless Chromium with a throwaway static server (`worldmap.jag` + `public/`). "mithril" panned to Ardougne/Port Khazard-area rocks with rings on screen; "king dragon" switched to the dungeon area and ringed the King Black Dragon spawn; "giant" listed `giant` first. No page errors. Screenshots were inspected, not stored.

## Known limits

- Item search finds **static ground spawns** only, not drops or shop stock.
- Locs show internal names (`mithrilrock1`); 7 `macro_` loc names (random-event rocks) are in the index.
- The map shows the ground floor; spawns on other levels are ringed at the same x,z (the first-level info is in the index but not shown).
- Spawns outside every map area (`areaForTile` = -1) are not shown. How many exist was not counted.
- Locs without a visible op are not indexed, so you cannot search for things like a particular door that has no op.
- Not covered by the harness: everything client-side beyond the pure search logic; the index was checked against the files, not against game behaviour (some NPCs are created by scripts, not spawn lines).

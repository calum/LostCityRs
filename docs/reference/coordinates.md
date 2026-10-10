# Coordinate literals (`0_41_51_39_38`) and map squares

**Question answered:** what does a RuneScript coord literal such as `0_41_51_39_38` mean, how is it packed, and how do you turn a map square and a tile on the world map into one?

**Based on commits:**
- Engine-TS: `1d25566c` (branch `calum-research`, based on `274`)
- RuneScriptTS: `c454554` (branch `calum-research`)
- Content: `65b754f76` (branch `274`)

**Method:** read code. Nothing was run; the packing was not checked by executing the compiler.

## Findings

1. A coord literal is written `level_mapX_mapZ_localX_localZ`. The compiler splits on `_` and reads five integers. Source: `RuneScriptTS/src/parser/parser/AstBuilder.ts:309-318`
   ```ts
   const parts = text.split('_').map(part => parseInt(part, 10));
   const x = (parts[1] << 6) | (parts[3] & 0x3fff);
   const z = (parts[2] << 6) | (parts[4] & 0x3fff);
   const y = parts[0] & 0x3;
   const packed = z | (x << 14) | (y << 28) | 0;
   ```
   So `parts[0]` is the level, `parts[1]`/`parts[2]` the map square, `parts[3]`/`parts[4]` the tile inside that square.

2. The class comment gives the same shape (`0_50_50_0_0`). Source: `RuneScriptTS/src/parser/ast/expr/literal/CoordLiteral.ts:10-13`.

3. The engine packs and unpacks the same layout. Source: `Engine-TS/src/engine/CoordGrid.ts:129-138`
   ```ts
   unpackCoord(coord: number): CoordGrid {
       const level: number = (coord >> 28) & 0x3;
       const x: number = (coord >> 14) & 0x3fff;
       const z: number = coord & 0x3fff;
       return { level, x, z };
   },
   packCoord(level: number, x: number, z: number): number {
       return (z & 0x3fff) | ((x & 0x3fff) << 14) | ((level & 0x3) << 28);
   },
   ```
   So a packed coord holds: level in bits 28-29, absolute x in bits 14-27, absolute z in bits 0-13.

4. Map square from absolute coordinate: `mapsquare = pos >> 6` (`Engine-TS/src/engine/CoordGrid.ts:21`). Zone = `pos >> 3` (`CoordGrid.ts:18`).

5. Therefore, for a literal `L_MX_MZ_LX_LZ`:
   - absolute x = `MX * 64 + LX`
   - absolute z = `MZ * 64 + LZ`
   - level = `L`

   Worked example, `0_41_51_39_38` (`Content/scripts/_test/scripts/cheats/cheat_teles.rs2:79`): x = 41×64 + 39 = **2663**, z = 51×64 + 38 = **3302**, level 0. Arithmetic from finding 1 and 3, not executed.

6. The parser uses `& 0x3fff` on the local parts and `<<6` on the map parts, so a local value of 64 or more would overlap the map-square bits. Local values are therefore expected to be 0-63. Inferred from the arithmetic in finding 1; not tested with an out-of-range literal.

7. Converting a map square and a tile from the map page. A map square `m44_49` is `MX=44, MZ=49`. A tile reading of X 40 and Z 32 lies in 0-63, so it must be the local part. Result: `0_44_49_40_32`, absolute x = 2856, z = 3168. This is an **inference**: it rests on findings 4-6, and on the fact that an absolute X of 40 would sit in map square 0, not 44.

## Inferences (labelled)

- The map page's "X: 40, Z: 32" are tile-local values inside square `m44_49`. Rests on finding 7 and on the map square being named `m44_49` (the square name is the map-square part, so the tile values are inside it).

## Not checked / open questions

- Whether the map page's X/Z really are local-to-square values. Not read: the map viewer's source. Logged in `docs/open-questions.md`.
- Whether `map_findsquare` (used in `Content/scripts/skill_magic/scripts/spells/teleport.rs2:51`) is needed to land on a walkable tile. Not read. The literal in `cheat_teles.rs2` is used directly with `player_teleport_normal`.
- Whether the compiler rejects a local value of 64 or more. Not tested.
- The level/plane meaning of `0` (ground floor) was taken from the bit layout only, not checked against the client.

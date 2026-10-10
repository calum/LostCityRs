# Finding where an NPC is (and linking it to a map)

**Question answered:** for a task such as "defeat a giant", where do those NPCs spawn, what can be said about the place, and how do you get a clickable map link for it?

**Based on commits:** root `HEAD` at the time of writing (see `git log -1 -- docs/reference/finding-npc-locations.md`), Content `8535c3e` (`git -C Content rev-parse --short HEAD`). **Method:** read the map files and scripts with a script (`docs/tools/npc_spawns.py`) and by hand. The map links were **not opened**: the build environment could not reach any map website.

## The method (reusable)

1. **Get the NPC's id.** `Content/pack/npc.pack` has lines `id=debugname`, for example `117=giant` and `50=king_dragon`.
2. **Find its spawns.** Spawns are in `Content/maps/m<MX>_<MZ>.jm2`, one file per 64x64 map square, in a section headed `==== NPC ====`. Each line is `level localX localZ: npcId` (for example `0 20 10: 83`, `Content/maps/m47_160.jm2:5734-5735`). Absolute tile = `MX*64 + localX`, `MZ*64 + localZ`, as in [coordinates.md](coordinates.md) finding 5.
3. **Underground.** A tile whose absolute z is 6400 or more is in the dungeon band. The same convention is used by this repo's own scripts, for example the King Black Dragon ladder sends you from z 3849 to z 10255 (`Content/scripts/ladders+stairs/scripts/ladders.rs2:109`). Subtracting 6400 gives the surface point directly above (an inference about where the entrance probably is; not every dungeon entrance is above its rooms).
4. **Name the place.** `Content/maps/labels.txt` is a list of `=Name,x,z,level` labels from the world map (136 of them). The tool reports the nearest label to the surface point. This is a hint only: labels are sparse, and some are region names ("Kingdom of Kandarin") rather than towns.
5. **Make the link.** `https://explv.github.io/?centreX=<x>&centreY=<z>&centreZ=<level>&zoom=9`. Those parameter names are read from the map's source, `js/map.js` in `Explv/explv.github.io`, by a helper agent (not re-read by me). Explv's `centreY` is this server's `z`.

All of steps 1-5 are done by:

```
python3 docs/tools/npc_spawns.py goblin giant king_dragon        # detailed list
python3 docs/tools/npc_spawns.py --md --top 3 giant               # one Markdown table cell, as used in the relic guide
python3 docs/tools/npc_spawns.py goblin+goblin_armed              # several NPC types as one group
```

The tool reads `Content/` only and changes nothing.

## Does the map's coordinate system match this server?

- **Evidence for:** `Content/maps/labels.txt` gives Lumbridge `3239,3233`, Varrock `3211,3450`, Falador `2989,3355` (lines 1, 2, 10); these are the familiar world coordinates for those towns, and the Lumbridge goblin spawns land next to the Lumbridge label (12 tiles) in the tool's output. That is an **inference** from names I already know, not a check against the map site.
- **Not verified:** whether Explv's map (an Old School map) matches this 2004-era revision exactly. Surface areas that existed in 2004 should line up; areas added later will show on the map but not exist here, and the reverse is possible.
- **Not verified:** whether Explv shows underground areas at `centreY` 9000+ and plane 0. The guide therefore also links the surface point above an underground spawn.
- **Not verified:** the mejrs map (`mejrs.github.io/osrs`): its source has `enableUrlLocation` and default `x`, `y`, `plane` options, but I could not confirm the URL parameter names, so it is not used.
- No LostCity map viewer with coordinate links was found. `Engine-TS/public/maped` on the `274` branch looks like a map *editor*; not read.

## Worked example: the King Black Dragon

- Spawn: one `king_dragon` at map square `m42_153`, tile (2716, 9817) (tool output).
- That is not the lair you walk into first. The scripts show the route (all read, not walked):
  1. The Wilderness ladder at `0_47_60_9_9`, absolute (3017, 3849), runs `p_teleport(0_47_160_61_15)` and is commented "kdb entrance" (`Content/scripts/ladders+stairs/scripts/ladders.rs2:109`). `0_47_160_61_15` is (3069, 10255).
  2. The lever there (`[oploc1,dragonkinginlever]`) runs `~player_teleport_normal(0_42_153_29_10)`, absolute (2717, 9802), with the message "...And teleport into the Dragon's lair." (`Content/scripts/areas/area_wilderness/scripts/king_black_dragon.rs2:371-372`). The way out is the other lever to `0_47_160_59_14` (`:385`).
  3. `0_42_153_29_10` is in the same map square as the spawn, so that is the lair. This last step is an inference from the matching square.
- The debug command `::kbd` teleports you to `0_47_160_60_16` (`Content/scripts/_test/scripts/cheats/cheat_teles.rs2:84`), the antechamber, not the lair.

To find the way into any other dungeon, search the scripts for teleports near the spawn: `grep -rn "p_teleport\|climb_ladder\|player_teleport_normal" Content/scripts` and compare the `0_MX_MZ_LX_LZ` literals with the spawn's map square. Not done for the other tasks.

## Limits

- The tool averages the spawns inside one map square, so the link lands near the group, not on a particular NPC. A square with spawns far apart can give a tile in between.
- It reports spawns from the map files only. NPCs created by scripts (`npc_add`, the Kalphite Queen's flying form) have no spawn line. The Kalphite Queen's first form (`kalphite_queen`) does.
- Whether an NPC spawn is reachable by a normal player (quests, keys, items) is not checked.

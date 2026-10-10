# Developer and staff cheat commands (`::` commands)

**Question this answers:** how do I get developer or cheat commands (teleport, set stats, give any item, spawn NPCs and locs, run debug scripts) in a local LostCityRS world, and what gates them?

**Based on (read, not run):**

| Repo | Commit |
|---|---|
| LostCityRs (container) | `195feba` |
| Engine-TS | `1d25566c` |
| Content | `65b754f76` |
| Client-TS | `7d6ca61` |

**Method:** read the client chat path, the engine's cheat handler, the login thread that sets the staff level, the config defaults and the cheat scripts. **No command was run in-game** in this note. The answer below is what the code says the commands do.

## Findings

### 1. Typing a command in the client

- The client treats chat input beginning with `::` as a cheat. It sends `CLIENT_CHEAT` with the text after the first two characters: `Client-TS/src/client/Client.ts:3091-3094` (`else if (this.chatInput.startsWith('::'))` … `this.out.pjstr(this.chatInput.substring(2))`).
- Client-side some `::` names are handled locally and never sent: `::clientdrop`, `::prefetchmusic`, `::lag`, `::fpson`, `::fpsoff`, `::fps ` (`Client.ts:3063-3083`).
- Characters up to code 126 are accepted only when the input starts with `::`, and the input is capped at 80 characters (`Client.ts:3051`). The engine rejects input over 80 characters (`Engine-TS/src/network/game/client/handler/ClientCheatHandler.ts:41-43`).

### 2. Engine side: the handler and the staff level

- `ClientCheatHandler.handle` lowercases the input, splits it on spaces, and takes the first word as the command (`ClientCheatHandler.ts:45-51`).
- **Correction:** the debug-proc commands below (`maxme`, `help`, `coord`, `pos`, `zone`, and every name in `cheat_help.rs2`) are typed with the `~` prefix, e.g. `::~maxme`. An earlier version of this note listed `::maxme` without it. Only the engine commands in the table (`minme`, `setstat`, `give`, `tele`, ...) take no prefix.
- Commands are grouped by the player's `staffModLevel` (`Engine-TS/src/engine/entity/Player.ts:376`):

| Level check | Lines | Commands (as coded) |
|---|---|---|
| `>= 2` | `ClientCheatHandler.ts:550-684` | `getcoord`, `tele <level,mx,mz[,lx,lz]>` (`:558-591`), `setvis` and `teleto`/`ban`/`mute`/`kick` (production only) |
| `>= 3` | `:189-548` | `setvar`, `getvar`, `give <item> [n]` (`:340-354`), `givemany <item>` (up to 1000, `:391-404`), `givecrap` (28 random items, `:375-390`), `setstat <skill> <level>` (`:453-466`), `advancestat <skill> <xp-level>` (`:467-483`), `minme` (`:484-492`), `locadd <name>` (`:493-504`), `npcadd <name>` (`:505-515`), `openmain`/`openoverlay`/`closeoverlay`, `serverdrop`, `reboot` (production only) |
| `>= 4` and `!production` | `:57-186` | `~<debugproc name> [args]` (`:60-148`), `reload`, `rebuild`, `speed <ms>`, `fly`, `naive`, `random` |

- Every cheat sent by a player at level 2 or above is written to the session log before it is dispatched (`ClientCheatHandler.ts:53-55`).
- The production check is `Environment.node.production`. Commands marked "production only" in the table are only active when `production` is `true` (`ClientCheatHandler.ts` lines marked `&& Environment.node.production`).

### 3. How a local player gets staff level 4

- **Login disabled (the default):** the login thread builds the player's login reply itself. `staffmodlevel = 0`, then `4` when `!Environment.node.production` (`Engine-TS/src/server/login/LoginThread.ts:63-66`). The reply is posted to the world with that value (`LoginThread.ts:82` for a new player, `:95` for an existing save).
- **Login enabled:** the reply comes from the login server, and the code then forces `staffmodlevel = 4` when not in production (`LoginThread.ts:50`).
- The world copies the value onto the player: `player.staffModLevel = staffmodlevel ?? 0` (`Engine-TS/src/engine/World.ts:1917`).
- `production` defaults to `false` (`Engine-TS/src/util/WorldConfig.ts:99`). `debugProcChar` defaults to `'~'` (`WorldConfig.ts:106`). Both can be overridden through environment variable names (`WorldConfig.ts:238,245`); how those names are loaded was not traced.
- No `Engine-TS/data/config/world.json` exists in the checkout (directory listing), so the defaults above are the ones in effect (inferred from the absence of the file; the engine's own loader was not traced to confirm).

**Inference:** with the default local setup (production off, login off), every player is staff level 4, so every command above is enabled.

### 4. Debug procs (`~name`)

- A `::~name` command runs the script `[debugproc,name]` (`ClientCheatHandler.ts:60-62`). The `~` comes from `debugProcChar`, so `::~help` runs `[debugproc,help]`. Inferred from the char check at `:60`, the default at `WorldConfig.ts:106`, and `Client.ts:3094` sending everything after `::`.
- Arguments are parsed by the debugproc's parameter types: strings, ints, obj/npc/loc/seq/stat/inv/coord/interface/spotanim/idkit names (`ClientCheatHandler.ts:67-148`). A bad argument returns `false` and nothing runs (`:142-145`).
- The scripts live in `Content/scripts/_test/scripts/cheats/`. Examples: `cheat_help.rs2` (`[debugproc,help]`, the menu of commands), `cheat_maxme.rs2` (`[debugproc,maxme]`), `cheat_magic.rs2` (`[debugproc,giverunes]`), and `debug/` and `cheat_*` files for banks, teleports and more.
- **The menu text is wrong about the prefix.** `cheat_help.rs2` writes the debug-proc commands without `~` (for example `::coord`, `::maxme`). The handler only runs a debug proc when the command starts with the `debugProcChar` (`ClientCheatHandler.ts:60-62`), so `::coord` is not dispatched to `[debugproc,coord]`; the `~` form is. Not fixed here: the script lives in the Content submodule, which is not edited (see `CLAUDE.md`).
- `cheat_help.rs2` lists the commands by category: account (`::reset`, `::minme`, `::maxme`, `::setstat`, `::addxp`, `::setxp`, `::1hp`, `::foodbank`, `::energy`), item (`::bank`, `::bank_preset`, `::clearinv`, `::give`, `::fmtest`, `::fishtest`, `::giverunes`, `::magicbank`), teleport (`::tele`, `::home`, `::varrock`, `::falador`, ...), and engine (`::seq`, `::loc`, `::npc`, `::open`, `::close`, `::delay`) (`Content/scripts/_test/scripts/cheats/cheat_help.rs2:1-37`).
- **Not verified:** the bodies of `cheat_maxme.rs2`, `cheat_magic.rs2` and the other cheat scripts were not read. The menu text is only a description of what the scripts were written to do.

### 5. Viewing coordinates

Read from code, not run. All three are debug procs, so they need the `~` prefix and staff level 4 with `production` off:

| Type | Script | What it prints (from the script) |
|---|---|---|
| `::~pos` | `Content/scripts/_test/scripts/engine/debug_pos.rs2` | `Position: <x> <z> <level>` (`mes`, shown as a game message) |
| `::~coord` | `.../engine/debug_coord.rs2` | `Coord: <level>_<mx>_<mz>_<lx>_<lz>` (Jagex format, via `coord_unpack`) |
| `::~zone` | `.../engine/debug_zone.rs2` | `Zone: <x>_<z>`, where the zone is the coordinate divided by 8 (`pow(2, 3)`) |

These print to the chat, not onto a map. The map editor at `/maped` is registered only in debug mode (`Engine-TS/src/web.ts:270`, inside the `if (Environment.node.debug)` block at `web.ts:254-298`; `debug` defaults to `true`, `WorldConfig.ts:101`). Its page (`Engine-TS/view/maped.ejs`) and script (`Engine-TS/public/maped/maped.js`) contain a status line that formats `Tile: <x>, <z> | Level: <n>` (the format string is in `maped.js`). **Not verified:** which tile the status line shows (presumably the one under the mouse) and whether the editor draws your position. The mousemove listener on the editor canvas only records the pointer position, and the function that feeds the status line was not traced. The page is also not known to load the Client-TS `MapView` (`Client-TS/src/mapview/MapView.ts`); no HTML in `Engine-TS/public` or `Engine-TS/view` references `mapview.js` (grep).

## Limits and caveats

- `::setstat` calls `player.setLevel(stat, parseInt(args[1]))` with no range check (`ClientCheatHandler.ts:466`). Values above or below the valid range were not tested.
- `::give` adds to the inventory only (`:354`). Bank items come from the `~` debugprocs (`::bank`, `::foodbank`, and so on), which were not read.
- **Names with spaces do not work.** The handler lowercases the whole line and splits it on single spaces (`ClientCheatHandler.ts:47`), so `::give rune sword` gives `args = ['rune', 'sword']`. `give` reads only `args[0]` (`:348`) and looks up `rune`, which is not an obj, so `ObjType.getId` returns `-1` and the handler returns `false` (`:348-351`). That path sends no message to the player. The same applies to `givemany`, `locadd`, `npcadd` and the debug-proc OBJ/NPC/LOC parameters (each takes one token: `:83-103`).
- **Use the internal name, with underscores.** `ObjType.getId` is keyed by `debugname` (`Engine-TS/src/cache/config/ObjType.ts:43-44`). That is the header of the config block, read as the pack name (`Engine-TS/tools/pack/config/ObjConfig.ts:207,222`). The rune sword is `[rune_sword]` with `name=Rune sword` (`Content/scripts/skill_combat/configs/melee/swords.obj:175-176`). So `::give rune_sword` (and `::give rune_sword 5` for a count) is the form that matches. The display name is not used for the lookup.
- `::locadd` and `::npcadd` spawn with `EntityLifeCycle.DESPAWN` at the player's tile (`:503`, `:515`).
- Level 4 also enables `reload` and `rebuild`, which reload or rebuild content while the world runs (`:149-153`).

## Finding NPC and obj names for `::npcadd`, `::give`

Read from code, not run. There is no in-game command that lists NPCs. The internal names come from two places:

- `Content/pack/npc.pack` maps numeric IDs to names, one `id=name` per line (`1359` lines at `65b754f76`; first entry `0=hans`). This is the list the server uses to assign IDs.
- The `.npc` config files under `Content/scripts/**/configs/` hold the `[name]` headers (`1359` headers in `138` files at `65b754f76`). The header is the name `::npcadd` takes; `name=` is the display name, and is not used for the lookup. Example: `[borderguard1]` with `name=Border Guard` in `Content/scripts/areas/area_alkharid/configs/border_guard.npc:1-2`.
- How `npc.pack` relates to the configs: `validateConfigPack` crawls the config names with `crawlConfigNames` and registers each new name with the next free ID (`pack.register(pack.max++, names[i])`) (`Engine-TS/tools/pack/PackFile.ts:131-151`, `:366`; `NpcPack` at `:295`; the pack path is listed in `Engine-TS/tools/pack/PackAll.ts:55`). **Not verified:** the step that saves the updated `npc.pack`, and whether the list is rewritten on every pack run.

### Ranking NPCs by hitpoints

The `hitpoints=` line is read by the packer, range-checked to 0-5000, and written as server-only opcode 77 (`Engine-TS/tools/pack/config/NpcConfig.ts:23,80,353-355`). The engine reads it into `stats[NpcStat.HITPOINTS]` (`Engine-TS/src/cache/config/NpcType.ts:186`). A block without the line gets `1` (`NpcType.ts:106`). Whether this value is the NPC's max hitpoints or its starting level was not traced.

Method (read, and run over the `.npc` files at `65b754f76`, with a short script in the scratchpad, not committed): every `[name]` block under `Content/scripts`, sorted by `hitpoints`. Result: 1,359 blocks, 597 with an explicit line, no block with two lines. Top 10:

| Rank | Name | hitpoints | File |
|---|---|---|---|
| 1 | `kalphite_flyingqueen` | 255 | `areas/area_kalphite/configs/kalphite.npc` |
| 2 | `kalphite_queen` | 255 | `areas/area_kalphite/configs/kalphite.npc` |
| 3 | `macro_dwarf` | 255 | `macro events/configs/antimacro.npc` |
| 4 | `macro_swarm` | 255 | `macro events/configs/antimacro.npc` |
| 5 | `viking_enemy4` | 255 | `quests/quest_viking/configs/viking.npc` |
| 6 | `nasty_tree` | 250 | `_unpack/225/all.npc` |
| 7 | `nasty_tree_swamp` | 250 | `areas/area_mortmyre/configs/mortmyre.npc` |
| 8 | `king_dragon` | 240 | `areas/area_wilderness/configs/king_dragon.npc` |
| 9 | `macro_triffidseed` | 200 | `macro events/configs/antimacro.npc` |
| 10 | `macro_triffidseed_angry` | 200 | `macro events/configs/antimacro.npc` |

Not checked: what `_unpack/` is and whether `nasty_tree` is used in play; whether the `hitpoints` value is the in-game maximum. Ties at 255 are ordered by name.

## Open questions

- Do the `~` debugprocs `maxme`, `giverunes`, `bank`, `foodbank` and the rest do what `cheat_help.rs2` says? Needs their scripts read, or an in-game run.
- Does `::setstat` with an out-of-range level behave well? Needs a run.
- Does the server behave as described here when started through `mise run start` on Windows? Observed only that it started and logged `World ready` (see `docs/setup/local-setup-with-mise.md`); no cheat was typed.

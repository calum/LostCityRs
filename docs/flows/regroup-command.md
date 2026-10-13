# ::regroup: teleport to another player, 10-minute cooldown, player list

**Question this answers:** how does `::regroup` work, and how can a non-staff player run a `::` command at all?

**Based on:** root (this commit), Engine-TS `cd2f9e8c`, Content `d4aba0332`, Client-TS `d081cc2`. **Method:** built test-first (`tests/regroup.test.ts`, 14 tests: all red before, 14/14 after; whole suite 448/448 on Node 24.11.1, `tsc -p harness/tsconfig.json` clean). Not tried in a real client.

## What the player gets

- `::regroup <name>`: teleports to that signed-in player (case-insensitive; an underscore stands for a space). Unknown name: "<name> is not signed in."; own name: refused.
- `::regroup` with no name: opens the interface `regroup_menu` with a scrolling list of every other signed-in player (first 30; a line says how many more). Clicking a name teleports there. Nobody else online: a chat message instead of an empty list. The list has a Refresh button.
- Cooldown 10 minutes (`^regroup_cooldown = 1000` ticks, `mods/regroup/configs/regroup.constant`). A refused attempt says "You can regroup again in 9m 12s." and the list's status line shows the same. Refused or failed attempts do not start the cooldown, only a real teleport does.
- Refused when either player is on Tutorial Island, in the Duel Arena, Fishing Trawler, or a Mime / Maze random event (`regroup_target_ok` for the target, `pre_tele_checks` for the caller, `mods/regroup/scripts/regroup.rs2`).

## How it works

1. **Commands for everyone.** `ClientCheatHandler.handle` (Engine-TS `src/network/game/client/handler/ClientCheatHandler.ts`) used to run only commands gated by `staffModLevel`. A new block before those gates looks up `[label,playercmd_<cmd>]` and, if it exists, runs it with protected access and one string argument (rest of the line, lowercased, `_` turned into a space). A player who is busy gets "Please finish what you are doing first." So any mod can add a command by naming a label `playercmd_<name>`. Dev `::~debugprocs` and staff commands are unchanged.
2. **Listing players.** New script command `world_playeruid(int $index)(player_uid)` (`ServerOps.ts`): the uid of the n-th signed-in player in slot order, -1 for a missing one. `uid_toint` casts a `player_uid` to int (RuneScript has no cast). Both are declared in `Content/scripts/engine.rs2` and registered in `ScriptOpcode.ts`.
3. **Cooldown clock.** `%regroup_last` (perm varp) holds `%relic_playticks` (ticks logged in, `relic_playtime.rs2`) at the last use. It survives relog (tested) but only counts time spent logged in: time offline does not run it down. There is no wall-clock script command, which is why. If `%relic_playticks` is ever lower than `%regroup_last` (reset), the cooldown is capped at a full 10 minutes.
4. **Stale lists.** On open the menu stores a fingerprint of the rows (`%regroup_sig`, temp varp). A click recomputes it; if someone logged in or out meanwhile it says "The player list changed. Please pick again." and redraws instead of teleporting to the wrong person (tested).
5. **Teleport.** `~player_teleport_normal(<target coord>)`, the same teleport animation as the Teleport Network relic.

## Not checked

- The list in a real client (scroll layer, row hover colour, layout); row hit boxes copy the Tasks menu's.
- Players with the same display name only differing by case/space are indistinguishable by name; the list route is unaffected.
- Behaviour with more than 30 players online (only rows 0-29 are clickable; the rest need `::regroup <name>`).
- Hidden/invisible staff are listed like anyone else.

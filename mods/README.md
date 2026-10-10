# mods/

Your own RuneScript (`.rs2`), configs (`.obj`, `.npc`, `.loc`, `.param`, ...) and interfaces (`.if`).
`mise run mods:sync` (or `mods:watch`) mirrors this folder into `Content/scripts/_mods/`, where the engine's
live reload picks it up. See `docs/setup/script-dev-loop.md`.

Layout rule (observed): the compiler rejects an `.rs2` file that is not under a folder named `scripts`
("must be located inside a \"scripts\" directory"), so use `mods/<feature>/scripts/*.rs2`, and put configs
beside it in `mods/<feature>/configs/`, like the folders in `Content/scripts/`.

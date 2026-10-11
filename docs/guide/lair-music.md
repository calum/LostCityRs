# Your own music in the King Black Dragon and Kalphite lairs

Inside the King Black Dragon lair the game plays `chop_suey`, and inside the Kalphite lair (the burrow and the chamber with the Queen) it plays `halo_theme`. They loop until you leave. Design and checks: [../design/custom-lair-music.md](../design/custom-lair-music.md). Checked in a headless browser (the files were fetched and started); nobody has listened to them in the game yet.

## Run it

1. `git pull && git submodule sync --recursive && git submodule update --init` (a plain pull does not move the submodule folders).
2. `mise run mods:sync` (copies `custom-sounds/*.mp3` to the server's `public/custom-sounds/`; `mise run live` does it for you).
3. `mise run client:build`, restart the server, press **Ctrl+F5** in the browser. The recordings are loaded when the page loads.
4. Try it: `::~kbd` (King Black Dragon lair) and `::~kq` (Kalphite chamber). Leave with any teleport, for example `::~brimhaven`.

## Change a track

Replace `custom-sounds/chop_suey.mp3` or `halo_theme.mp3` (keep the name; `.ogg` and `.wav` also work, `.mp3` is tried first), run `mise run mods:sync` and press Ctrl+F5. Delete the file to get the original MIDI back.

## Good to know

- It follows the music volume in the Options tab and is silent when music is off. If it is too loud or quiet, change `CUSTOM_MUSIC_GAIN_DB` in `Client-TS/src/sound/CustomMusic.ts` (default -3 dB; not tuned by ear).
- The music-tab buttons "Attack3" and "Insect Queen" play your recordings too, because the client swaps those two songs everywhere.
- Leaving fades the recording out over 2 seconds. Jingles (level up, quest complete, death) are silenced while it plays, so the track carries on unbroken.
- The recordings are about 6 MB together and every player downloads them once when the page loads (friends on a tunnel too). They are committed to the repo; remove them before making the repo public if you do not own the rights.
- Low-memory mode has no music at all.

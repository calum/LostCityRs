# Your own shout for the Phoenix relic

When the Phoenix relic saves you from a lethal hit, the game says "I rise from the ashes!" over your head. It also plays a sound: a built-in fire-blast sound by default, or **your own recording** if you put one in the right place. Everyone within 15 tiles of you hears it (and you do), at the same moment the overhead line appears.

Checked in the headless test (the server sends the sound to you and to a player 3 tiles away, not to one 40 tiles away) and by a client unit test (the file name is requested). Nobody has heard it in a real browser, so how it *sounds* and how loud it is are for you to judge.

## Steps

1. **Record it.** A phone voice memo or Audacity is fine. Keep it short, **one to three seconds**. Trim silence from the start so it lines up with the text. Normalise it so it is not quiet (see below).
2. **Export** as `.wav`, `.mp3` or `.ogg` (the client tries `.wav`, then `.mp3`, then `.ogg`, and uses the first one it finds). Safari does not play `.ogg`.
3. **Name it exactly `relic_phoenix`** plus the extension: `relic_phoenix.mp3` is the usual choice.
4. **Put it in the `custom-sounds/` folder** at the top of this repository (next to `custom-sounds/relic_attune.mp3` if you have one) and commit it if you want it kept.
5. **Copy it to the server:** `mise run mods:sync` (`mise run live` does this for you whenever you save in `custom-sounds/`). It lands in `Engine-TS/public/custom-sounds/`, which the web server serves at `/custom-sounds/`.
6. **Update to this version** (once): `git pull && git submodule sync --recursive && git submodule update --init`, then `mise run mods:sync`, `mise run client:build`, restart the server and press **Ctrl+F5**. The client loads the recordings when the page loads, so a plain relog is not enough, and you need Ctrl+F5 again whenever you swap the file.
7. **Try it:** `::~relic_reset`, `::~relic_grant 6` (Phoenix), then `::~relic_hit 9999` (a debug command in `mods/relics/scripts/relic_debug.rs2` that takes that much damage). The shout plays with the overhead text. Phoenix then recharges for 5 minutes; `::~relic_reset` clears that.

To go back to the built-in sound, delete the file, run `mise run mods:sync` and refresh.

## Limits and good to know

- **No hard length limit in the code**: the client decodes the whole file with the browser's `decodeAudioData` and plays it from the start (`Client-TS/src/3rdparty/audio.js` `playWave`). It cannot be stopped early and does not loop. Keep it under about 3 seconds so it does not overlap a second save (a save is possible every 5 minutes).
- **File size**: every player downloads it once when the page loads (friends on a tunnel too). A 2 second mp3 is tiny (tens of KB). Keep it well under 1 MB.
- **Volume**: it plays through the Options "sound effects" volume. Recordings are not boosted (only the built-in attune chime is). It is silent when sound effects are off, and in low-memory mode.
- **A missing file is not an error**: with no `relic_phoenix.*` the built-in fire-blast sound plays instead.
- Other players hear *your* recording too, because the file is served to every client. Remove it before making the repo public if you do not want it published.
- The relic text itself (`say("I rise from the ashes!")`) is unchanged.

## How it fits together (for the curious)

- `[proc,relic_hit]`-style damage hook in `mods/relics/scripts/relic_effects.rs2`: when Phoenix saves you it calls `say("I rise from the ashes!")` and then `queue(relic_phoenix_shout_q, 0, 0)`.
- `[queue,relic_phoenix_shout_q]` does `huntall(coord, ^relic_phoenix_shout_radius, 0)` and `sound_synth(relic_phoenix, 1, 0)` for each player found, the owner included. `^relic_phoenix_shout_radius = 15` is in `mods/relics/configs/relic.constant`. It runs from a queue because `huntnext` changes the active player, which would otherwise redirect the rest of the save script.
- `relic_phoenix` is synth id **913** (`Content/pack/synth.pack`), file `Content/synth/relic_phoenix.synth`, a byte copy of `Content/synth/magic/magicalsounds/fire_blast_all.synth`.
- The client maps `913: 'relic_phoenix'` in `CUSTOM_SOUND_NAMES` (`Client-TS/src/sound/CustomSounds.ts`) and plays the file instead of the synth sound. Same mechanism as [relic-attune-sound.md](relic-attune-sound.md).
- Tests: `tests/relic-phoenix-shout.test.ts` (failed on "relic_phoenix not in synth.pack", then passed), `Client-TS/test/custom-sounds.test.ts`.

# Use your own sound for "attuned"

When you choose or are given a relic your character kneels, a gold glow rises around them and a chime plays. The animation and glow are built into the game. The chime is a short synthesised sound that ships with the cache. You can replace it with a sound you recorded yourself, without touching any code.

Everything below was checked in a headless browser on Linux with a generated test tone (the file was fetched and played). Nobody has listened to the built-in chime or to a real recording, so how it *sounds* is for you to judge.

## Steps

1. **Record it.** Any app will do (phone voice memo, Audacity). Keep it short, one to three seconds. Export as `.wav`, `.mp3` or `.ogg`. The browser decodes the file, so any of the three works if your browser plays it (Safari does not play `.ogg`).
2. **Name it exactly `relic_attune`** plus the extension, for example `relic_attune.wav`. If you have more than one, the client tries `.wav`, then `.mp3`, then `.ogg` and uses the first it finds.
3. **Put it in the `custom-sounds/` folder** at the top of this repository (next to `mods/`). Create the folder if it is missing.
4. **Copy it to the server:** run `mise run mods:sync` once. `mise run live` and `mise run mods:watch` do this every time you save a file in `custom-sounds/`. The copy ends up in `Engine-TS/public/custom-sounds/`, which the web server serves at `/custom-sounds/`. That folder is hidden from git in the submodule, so it stays out of your commits.
5. **Use a client that knows about custom sounds.** Run `git pull && git submodule update --init`, then `mise run client:build`, restart the server, and press **Ctrl+F5** in the browser. This is a one-off: the client only needs rebuilding when the code changes, not when you change the recording.
6. **Try it.** Log in and type `::~relic_grant 3` in the chat box (dev commands must be on, which they are in the default local setup). You should hear your recording. Undo it with `::~relic_reset`.

To swap in a different recording later, replace the file, run `mise run mods:sync` and press **Ctrl+F5**. The sound is loaded when the page loads, so a plain relog is not enough.

To go back to the built-in chime, delete your file from `custom-sounds/`, run `mise run mods:sync`, and refresh the page.

## Good to know

- The sound plays only when **sound effects** are on in the Options tab, and it follows the same volume. Both come from the existing sound-effect path, so a very quiet recording will be quiet in game. Normalise it before you export.
- Friends who join your hosted server hear your recording too, because the file is served by the same web server. They need no extra steps. (Not tried through the tunnel.)
- Low-memory mode has no sound effects at all, so no chime plays there.
- If nothing plays: open the browser developer tools, Network tab, reload, and look for `relic_attune.wav` (or `.mp3` / `.ogg`). A 404 means the file is not in `Engine-TS/public/custom-sounds/` yet, so check step 4. If the file loads but is silent, check your Options sound volume and that the browser can play the file directly.

## For the curious: how it fits together

- The server tells the client to play synth sound **912**, named `relic_attune`. That line is `sound_synth(relic_attune, 1, 0);` in `[proc,relic_attune]` in `mods/relics/scripts/relic_offer.rs2`. The built-in sound is `Content/synth/relic_attune.synth`, a copy of the enchant-diamond-amulet chime.
- When the client starts it asks the web server for `/custom-sounds/relic_attune.wav`, `.mp3` and `.ogg`. If one exists it is remembered for synth 912, and every time the server asks for 912 the recording plays instead of the synthesised sound.
- The list of replaceable sounds is `CUSTOM_SOUND_NAMES` in `Client-TS/src/sound/CustomSounds.ts` (`912: 'relic_attune'`). To make another sound replaceable, add a line with its synth id and a file name. The ids are in `Content/pack/synth.pack`.
- To play a different *built-in* sound instead of recording one, change `relic_attune` in the `sound_synth(...)` line to any name from `Content/pack/synth.pack` (for example `prayer_boost`). The change reloads live. If you do that and also have a recording, the recording only replaces synth 912, so remove it or add the other sound's id to `CUSTOM_SOUND_NAMES`.

Design note with evidence: [../design/relics-attune.md](../design/relics-attune.md).

# Custom MP3 for the King Black Dragon and Kalphite Queen lairs (feasibility)

**Question:** how is the music chosen when you enter the King Black Dragon (KBD) lair and the Kalphite Queen (KQ) lair, and how hard is it to play your own MP3 there instead?
**Based on:** root `1cae35f`, Engine-TS `33564f19`, Content `b36ee553b`, Client-TS `f92f245`. Method: read only, nothing built or run. No test: docs only.

## How the music is chosen today (read)

1. **Mapsquare zone trigger.** Crossing into a 64x64 mapsquare runs its `[mapzone,L_X_Z]` script. KBD lair: `[mapzone,0_47_160]` runs `~wilderness_underground_enter;` then `@music_playbyregion(coord);` (`Content/scripts/music/scripts/move.rs2:345`). KQ lair: `[mapzone,0_54_148] @music_playbyregion(coord);` (`move.rs2:749`). The KBD teleport debug proc lands at `0_47_160_60_16` (`Content/scripts/_test/scripts/cheats/cheat_teles.rs2:81-84`); the KQ chamber entrance constant is `0_54_148_52_21` (`Content/scripts/areas/area_kalphite/configs/kalphite.constant:3`).
2. **Region lookup.** `[label,music_playbyregion]` rounds the coord to its mapsquare, finds the `musicregion` row for it and reads `musicdata` (`Content/scripts/music/scripts/music.rs2:83-110`). Only if `%musicplay ! 0` (the Auto button; Manual sets it to 0) does it call `@music_play(track)` (`music.rs2:106`).
3. **The two rows.** `[musicregion_47_160]` -> `music_Attack3` (`Content/scripts/music/configs/musicregion.dbrow:1163-1166`); `[musicregion_54_148]` -> `music_Insect_Queen` (`musicregion.dbrow:1728-1731`). Those songs are `track=attack3` (`music.dbrow:92`) and `track=insect queen` (`music.dbrow:687`). In the cache they are MIDI ids 26 and 260 (`Content/pack/midi.pack:27` and `:261`); the files are `Content/songs/attack3.mid` and `insect queen.mid`.
4. **Sending it.** `[label,music_play]` stores `%currentsong`, `%musicstart`, `%musiclength` and runs `midi_song(...)` (`music.rs2:44-48`). `MIDI_SONG` calls `player.playSong(id)` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:854-862`, `Player.ts:2027`), a packet `ServerGameProt.MIDI_SONG` (opcode 23, 2-byte id, `ServerGameProt.ts:77`).
5. **Client.** `ServerProt.MIDI_SONG` reads the id; if music is on, not low-memory and no jingle delay is running, it sets `midiSong` and asks the update server for archive 2 file `<id>` with fade on (`Client-TS/src/client/Client.ts:7133-7149`). When the MIDI bytes arrive, `saveMidi` -> `playMidi(data, volume, fade)` (`Client.ts:1359-1361`, `:627-629`). `playMidi` renders the MIDI to PCM with a soundfont (`SCC1_Florestan.sf2`) in `Client-TS/src/3rdparty/tinymidipcm.js` (`window._tinyMidiPlay`, line 324).

**Inference from 3 (not checked by walking there):** both lairs are the *whole* mapsquare, so anything else in `0_47_160` or `0_54_148` has the same music. These two songs are used by no other `musicregion` row (only one `mapsquare` follows each `music_Attack3` / `music_Insect_Queen` reference in `musicregion.dbrow`). The extent of the squares on the map was not checked.

## Does the custom-sounds loader extend to music?

Not as it is. `CustomSounds.ts` fetches `/custom-sounds/<name>.wav|mp3|ogg` for the synth ids in `CUSTOM_SOUND_NAMES` and `soundsDoQueue` plays them with `playWave` (a one-shot `AudioBufferSource`, no loop, no fade, uses the sound-effect volume) (`Client-TS/src/sound/CustomSounds.ts`, `Client.ts:1194`, `:3465-3470`, `Client-TS/src/3rdparty/audio.js:47-57`). Synth ids and MIDI ids are different packets and different volume settings, so music needs a parallel path. What does carry over: the `custom-sounds/` -> `Engine-TS/public/custom-sounds/` copy by `scripts/sync-mods.mjs`, the fetch-at-start pattern, and the browser doing the MP3 decoding.

## Approach (proposal, not built)

- **Server/content (small).** Add a dedicated MIDI id for each lair (e.g. 346 `lair_kbd`, 347 `lair_kq`, after `345=barking mad`, `midi.pack` tail) with a byte copy of the original `.mid`, and point the two `musicregion` rows at new `music` rows using it. This keeps every other place that plays Attack3 / Insect Queen (the music tab buttons) unchanged and means only the lairs use the recording. Alternative with no content change: key the override on ids 26 / 260, which would also replace the song when played from the music tab.
- **Client (the real work).** A `CustomMusic` loader like `CustomSounds`, and a hook where the client turns "play song N" into a MIDI request: the song packet (`Client.ts:7139`), the jingle-delay resume (`Client.ts:3497-3508`), the music-option change (`Client.ts:10720-10752`) and `saveMidi`. For an id with a recording: play the MP3 with its own gain node, and stop it whenever anything else is requested (any later `MIDI_SONG` for another region, music turned off, logout reset at `Client.ts:2487`).
- **Hosting.** Same as sounds: file in `custom-sounds/`, copied by `mise run mods:sync`, served at `/custom-sounds/`.
- **Tests.** Server side: harness test that entering `0_47_160` / `0_54_148` sends `MidiSong` with the new ids (this part the harness can prove). Client side: bun unit test for the loader and the "which source plays" decision, like `Client-TS/test/custom-sounds.test.ts`. Actual audio only by ear / a headless audio-start log; not covered by the harness.

**Effort (my estimate, not measured):** roughly a day of work; content and server part small, client part moderate (one new module plus four small hooks in the very large `Client.ts`).

## Catches

- **Looping.** MIDI songs in this client do not loop by themselves (the loop in `tinymidipcm.js` is commented out, line 196); the server's `Loop` button restarts a song using `midi_length` (`Content/scripts/music/scripts/musicplayer.rs2:8-39`). For an MP3 we choose: play once like the MIDI, or loop (an `AudioBufferSource.loop` is gapless; an `<audio loop>` element usually has a small gap). A boss lair track suits looping; this is a decision to make. The server's length for the copied MIDI would be wrong for the MP3, so the Loop-button path must not be used for these ids.
- **Fade.** MIDI changes fade the old track out over 144 steps of 0.25 dB every 50 ms (about 7.2 s, 36 dB) before the next one starts (`tinymidipcm.js:138-141`, `stepFade`). Leaving the lair for a normal region would fade the MIDI path only; a custom MP3 needs its own fade-out or it will be cut hard (or the MIDI path must be told to stop it). Entering the lair from a MIDI track: the MIDI fades out for ~7 s first, then the MP3 can start, if we reuse that timing.
- **Volume and music settings.** The music slider sets `midiVolume` of 0/-4/-8/-12 dB or off (`Client.ts:10720-10752`). The MP3 must follow the same values and the off setting, and must also stay silent in low-memory mode (the MIDI path skips it, `Client.ts:7139`). The MP3's own loudness is unknown, so normalise it.
- **Jingles.** A level-up or task jingle inside the lair interrupts the song and the client later re-requests `nextMidiSong` (`Client.ts:3497-3508`); the custom path has to resume the MP3 there too, or it will go silent after a jingle.
- **Autoplay / first sound.** The browser only plays audio after a user gesture; `audio.js` already resumes the context on click and visibility change, so a Web Audio MP3 inherits that. Not tried.
- **Size and hosting.** An MP3 is megabytes; over the Cloudflare tunnel it is downloaded by each friend, once at page start if we preload (adds to load time) or on first entry if we fetch lazily (a silent gap on first entry). Preloading is simplest.
- **Copyright.** Do not commit a copyrighted MP3 to the public repo; `custom-sounds/` content is hidden from the submodule's git status but is **not** in the root `.gitignore` (`grep custom .gitignore` finds nothing), so add an ignore entry for the audio files.
- **Formats.** MP3 decode through `decodeAudioData` works in current browsers; Safari lacks `.ogg` (see `docs/guide/relic-attune-sound.md`).

## Not checked

Nothing was built, run or heard. Not read: `OnDemand` internals (how a missing MIDI is handled), `ClientBuild`/`Client.ts` paths outside the cited lines, how `wilderness_underground_enter` interacts with music, the map extents of the two squares, and whether other `mapzone` triggers (e.g. the KQ tunnels) play different music en route. Added to `docs/open-questions.md` as item 123.

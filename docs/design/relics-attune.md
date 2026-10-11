# Relic "attuned" effect and custom sound

**Question:** what happens when a relic is chosen or granted, and how can the chime be replaced by a recording?
**Based on:** root `a56b9ce`, Engine-TS `33564f19`, Content `514e71556` (+ `b36ee553b`), Client-TS `cd03818` (+ `8adf2b8`). Method: read, then ran (headless tests and a headless Chromium login). Player steps: [../guide/relic-attune-sound.md](../guide/relic-attune-sound.md).

## Findings

- Every relic gain goes through `[proc,relic_grant]` (`mods/relics/scripts/relic_offer.rs2:146`), whether it came from an offer pick, `Quest Pass` or `::~relic_grant`. After the "You gained the relic" line it now calls `~relic_attune` (`relic_offer.rs2:155`).
- `[proc,relic_attune]` (`relic_offer.rs2:141-144`) does `anim(human_pray, 0)`, `spotanim_pl(enchant_amulet_lvl3, 92, 0)` and `sound_synth(relic_attune, 1, 0)`. The animation and glow are existing cache assets (`human_pray` is used by the altar script, `Content/scripts/skill_prayer/scripts/altar.rs2:18`; `enchant_amulet_lvl3` is the enchant spell glow, `Content/scripts/_unpack/225/all.spotanim:697`). The task-complete fireworks and jingle (`~relic_celebrate`) are unchanged and separate.
- The sound is a new synth id: `Content/pack/synth.pack` `912=relic_attune`, file `Content/synth/relic_attune.synth`, a byte copy of `Content/synth/magic/enchant/enchant_diamond_amulet.synth` (Content `b36ee553b`). A dedicated id lets a recording replace only this sound.
- Engine: `sound_synth` writes a `SynthSound` packet (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:476`). Client: `ServerProt.SYNTH_SOUND` queues the id (`Client-TS/src/client/Client.ts:7102`), `soundsDoQueue` plays it.
- Override: the client has no sound names, only ids and `JagFX` synth data, and `playWave` already decodes any browser-supported audio (`Client-TS/src/3rdparty/audio.js:47`). `Client-TS/src/sound/CustomSounds.ts` fetches `/custom-sounds/<name>.wav|mp3|ogg` for each id in `CUSTOM_SOUND_NAMES` at start-up (`Client.ts:1191`); `soundsDoQueue` plays the recording instead of the synth when there is one (`Client.ts:3465`). The server serves `Engine-TS/public/` statically (`Engine-TS/src/web.ts:301`); `scripts/sync-mods.mjs` (`syncSounds`) copies root `custom-sounds/*.{wav,mp3,ogg}` there and hides the folder from the Engine-TS git status.

## What was run

- `tests/relic-attune.test.ts` (new, first): failed on `actual: [] expected: [645]` (no animation), then passed. Checks animation id, spotanim id/height/delay, and one `SynthSound` for id 912 with loops 1, delay 0, for Stoneskin and XP Multiplier grants.
- `Client-TS/test/custom-sounds.test.ts` (new, first): failed on the missing module; 12/12 bun tests pass after.
- Full suite `node harness/run.mjs` on Node 24.11.1: 372/372 (was 370); `npx tsc -p ../harness/tsconfig.json` clean.
- Real client (headless Chromium, built client, server on port 8888): with a 1.234 s test tone in `custom-sounds/`, the browser requested `/custom-sounds/relic_attune.wav` (200) and an audio source of 1.234 s started right after `::~relic_grant 3`. Screenshots 250 ms apart show the kneel and the gold glow.
- `scripts/sync-mods.mjs`: copy, hide-from-git and removal of a deleted file observed by hand (no automated test).

## Not covered

- Nobody has heard the built-in chime or judged how it sounds; `enchant_diamond_amulet` was chosen by name only. Playing a recording was verified by the audio-start log, not by ears.
- The kneel lasts only as long as `human_pray`; whether it feels right while a choice dialog closes was seen in stills only.
- Safari, `.ogg` and `.mp3` playback not tried (only `.wav`). Hosting through the tunnel not tried.
- The harness cannot render or play audio (`docs/setup/headless-test-harness.md`).

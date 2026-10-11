// Entering the King Black Dragon lair or the Kalphite lair sends the MIDI song id that the client swaps for a recording
// (Client-TS/src/sound/CustomMusic.ts CUSTOM_MUSIC_NAMES: 26 -> chop_suey, 260 -> halo_theme). Design note: docs/design/custom-lair-music.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import MidiSong from '../Engine-TS/src/network/game/server/model/MidiSong.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

/** Id of `name` in Content/pack/midi.pack (lines "id=name"). */
function midiId(name: string): number {
    const text = fs.readFileSync(new URL('../Content/pack/midi.pack', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const [id, n] = line.split('=');
        if (n === name) return Number(id);
    }
    throw new Error(`${name} not in midi.pack`);
}

function songsAfterEntering(at: string): number[] {
    const bot = Bot.spawn({});
    bot.player.received.length = 0;
    bot.teleport(at).tick(2);
    // the song can be sent more than once on a teleport; the client ignores a repeat of the song it already has (Client.ts, MIDI_SONG)
    const sent = bot.player.received.filter(r => r.message instanceof MidiSong).map(r => (r.message as MidiSong).id);
    return [...new Set(sent)];
}

test('the King Black Dragon lair plays Attack3 (midi 26, replaced by chop_suey in the client)', () => {
    assert.equal(midiId('attack3'), 26);
    assert.deepEqual(songsAfterEntering('0_47_160_60_16'), [26]);
});

test('the Kalphite chamber and the burrow above it play Insect Queen (midi 260, replaced by halo_theme in the client)', () => {
    assert.equal(midiId('insect queen'), 260);
    assert.deepEqual(songsAfterEntering('0_54_148_52_21'), [260]);
    assert.deepEqual(songsAfterEntering('2_54_148_27_38'), [260]);
});

// Phoenix (relic 6) shout: when the "I rise from the ashes!" line fires, every player near the Phoenix owner (and the owner)
// is sent synth sound 913 relic_phoenix, which the client replaces with the recording custom-sounds/relic_phoenix.<ext>.
// Script: mods/relics/scripts/relic_effects.rs2. Doc: docs/guide/relic-phoenix-shout.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import SynthSound from '../Engine-TS/src/network/game/server/model/SynthSound.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

function packId(file: string, name: string): number {
    const text = fs.readFileSync(new URL(`../Content/pack/${file}`, import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const [id, n] = line.split('=');
        if (n === name) return Number(id);
    }
    throw new Error(`${name} not in ${file}`);
}

const shouts = (bot: Bot, synth: number) => bot.player.received.filter(r => r.message instanceof SynthSound && (r.message as SynthSound).synth === synth).length;

test('Phoenix save sends the shout sound to the owner and players nearby, not to players far away', t => {
    if (skip()) return t.skip(String(skip()));
    const synth = packId('synth.pack', 'relic_phoenix');
    const owner = Bot.spawn({ at: { x: 3200, z: 3220 }, levels: { hitpoints: 10 } });
    owner.debugproc('relic_grant', 6);
    owner.expectMessage('You gained the relic');
    const near = Bot.spawn({ at: { x: 3203, z: 3220 } });
    const far = Bot.spawn({ at: { x: 3200, z: 3260 } });

    owner.debugproc('relic_hit', 4);
    assert.equal(shouts(owner, synth), 0, 'a non-lethal hit does not shout');
    owner.debugproc('relic_hit', 50);
    owner.expectMessage('Your Phoenix relic saves you from a lethal hit!');

    assert.equal(shouts(owner, synth), 1, 'owner hears it once');
    assert.equal(shouts(near, synth), 1, 'a player 3 tiles away hears it once');
    assert.equal(shouts(far, synth), 0, 'a player 40 tiles away does not');
});

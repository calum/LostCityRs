// Choosing or being granted a relic plays the "attuned" effect: player animation, spotanim and a sound
// (mods/relics/scripts/relic_offer.rs2 [proc,relic_attune], called from [proc,relic_grant]).
// Design note: docs/design/relics-attune.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot, ids, useWorld } from '../harness/src/index.js';
import SynthSound from '../Engine-TS/src/network/game/server/model/SynthSound.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

/** Id of `name` in a Content/pack/*.pack file (lines "id=name"). */
function packId(file: string, name: string): number {
    const text = fs.readFileSync(new URL(`../Content/pack/${file}`, import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const [id, n] = line.split('=');
        if (n === name) return Number(id);
    }
    throw new Error(`${name} not in ${file}`);
}

/** Grant relic `id` through ~relic_grant and report what the server told the client to show and play. */
function grantAndObserve(id: number) {
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    const anims: number[] = [];
    const spots: number[][] = [];
    const player = bot.player;
    const playAnimation = player.playAnimation.bind(player);
    player.playAnimation = (anim: number, delay: number) => {
        anims.push(anim);
        playAnimation(anim, delay);
    };
    const spotanim = player.spotanim.bind(player);
    player.spotanim = (s: number, height: number, delay: number) => {
        spots.push([s, height, delay]);
        spotanim(s, height, delay);
    };
    bot.debugproc('relic_grant', id);
    const sounds = player.received.filter(r => r.message instanceof SynthSound).map(r => r.message as SynthSound);
    return { bot, anims, spots, sounds };
}

test('granting a relic plays the attune animation, spotanim and sound', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, anims, spots, sounds } = grantAndObserve(3);
    bot.expectMessage('You gained the relic: Stoneskin.');
    assert.deepEqual(anims, [ids.seq('human_pray')]);
    assert.deepEqual(spots, [[packId('spotanim.pack', 'enchant_amulet_lvl3'), 92, 0]]);
    assert.equal(sounds.length, 1);
    assert.equal(sounds[0].synth, packId('synth.pack', 'relic_attune'));
    assert.equal(sounds[0].loops, 1);
    assert.equal(sounds[0].delay, 0);
});

test('the attune effect plays for the XP Multiplier too, once per grant', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, anims, sounds } = grantAndObserve(1);
    bot.expectMessage('You gained the relic: XP Multiplier.');
    assert.equal(anims.length, 1);
    assert.equal(sounds.length, 1);
});

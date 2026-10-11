// Relic 22 Archmage and relic 23 Endless Quiver (mods/relics/scripts/relic_effects.rs2). Content hooks:
// pvp_magic.rs2 [proc,magic_spell_maxhit] (~relic_spell_maxhit), player_magic.rs2 [proc,pvm_spell_cast]
// (~relic_cast_delay, ~relic_keep_casting), magic.rs2 [proc,delete_spell_runes] (~relic_free_cast),
// player_ranged.rs2 (~relic_ranged_maxhit, ~relic_keep_ammo in ranged_dropammo_npc), player_combat.rs2
// (~relic_accuracy with the damage type). Each behaviour has a no-relic control.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, spawnNpc, World } from '../harness/src/index.js';
import ScriptProvider from '../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../Engine-TS/src/engine/script/ScriptRunner.js';
import Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import OpNpcT from '../Engine-TS/src/network/game/client/model/OpNpcT.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

// Open tiles near Lumbridge, one per test so spawned NPCs and drops do not mix.
const SPOT = {
    maxhit: { x: 3200, z: 3200 },
    cast: { x: 3232, z: 3224 },
    stop: { x: 3236, z: 3220 },
    quiver: { x: 3260, z: 3234 },
    accuracy: { x: 3208, z: 3232 }
};

const HP = 3; // NpcStat.HITPOINTS (Engine-TS/src/engine/entity/NpcStat.ts)
const MELEE_STYLE = 0; // ^stab_style (combat_damagetypes.constant)
const RANGED_STYLE = 3; // ^ranged_style
const MAGIC_STYLE = 4; // ^magic_style

function relicBot(at: { x: number; z: number }, relics: number[], levels: Record<string, number> = {}): Bot {
    const bot = Bot.spawn({ at, levels });
    for (const id of relics) {
        bot.debugproc('relic_grant', id);
        bot.expectMessage('You gained the relic');
    }
    return bot;
}

/** Run a proc as `bot` and return its int result (ScriptRunner.init as relic-combat.test.ts does; Bot.call cannot pass procs' parameter types). */
function callProc(bot: Bot, name: string, ...args: number[]): number {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, `no proc ${name}`);
    const state = ScriptRunner.init(script, bot.player, null, args);
    bot.player.executeScript(state, true, true);
    return state.isp > 0 ? state.popInt() : NaN;
}

function retire(npc: Npc) {
    World.removeNpc(npc, -1);
}

/** Tick `n` times, topping hitpoints up each tick so the monster cannot kill the bot mid-test. */
function step(bot: Bot, n: number) {
    for (let i = 0; i < n; i++) {
        bot.player.levels[ids.stat('hitpoints')] = 99;
        bot.tick();
    }
}

function castOn(bot: Bot, npc: Npc, spell: string) {
    bot.player.send('OPNPCT', ClientGameProt.OPNPCT, new OpNpcT(npc.nid, ids.com(`magic:${spell}`)));
}

function mageBot(at: { x: number; z: number }, relics: number[]): Bot {
    const bot = relicBot(at, relics, { magic: 99, hitpoints: 99, defence: 99 });
    bot.setVar('option_nodef', 1); // auto retaliate off (^player_auto_retaliate_off), so a hit back does not replace the cast
    bot.clearInv().clearInv('worn');
    bot.give('mindrune', 100).give('airrune', 100);
    return bot;
}

// ----------------------------------------------------------------------------------------- 22 Archmage

test('Archmage doubles spell max hit (relic_spell_maxhit), leaves a null max hit alone', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.maxhit, []);
    const mage = relicBot(SPOT.maxhit, [22]);
    for (const max of [1, 2, 13, 20]) {
        assert.equal(callProc(plain, 'relic_spell_maxhit', max), max);
        assert.equal(callProc(mage, 'relic_spell_maxhit', max), max * 2);
    }
    assert.equal(callProc(mage, 'relic_spell_maxhit', -1), -1, 'spells without a max hit (null) stay null');
});

test('Archmage halves the cast delay (5 -> 3); other relics and no relic leave it alone', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.maxhit, []);
    const mage = relicBot(SPOT.maxhit, [22]);
    assert.equal(callProc(plain, 'relic_cast_delay', 5), 5);
    assert.equal(callProc(mage, 'relic_cast_delay', 5), 3);
});

/** Cast wind strike on a 157 HP monster once, then watch up to `ticks` ticks. Returns casts seen, runes used and the biggest hit. */
function castAndWatch(relics: number[], at: { x: number; z: number }, ticks: number, wantCasts: number) {
    const bot = mageBot(at, relics);
    const npc = spawnNpc('black_demon', { x: at.x + 3, z: at.z });
    bot.tick();
    castOn(bot, npc, 'wind_strike');
    const castTicks: number[] = [];
    let last = bot.xp('magic'); // every cast grants magic xp (give_spell_xp), so an xp rise is a cast
    let hp = npc.levels[HP];
    let maxDrop = 0;
    for (let i = 0; i < ticks && castTicks.length < wantCasts; i++) {
        step(bot, 1);
        const d = bot.xp('magic');
        if (d !== last) castTicks.push(World.currentTick);
        last = d;
        maxDrop = Math.max(maxDrop, hp - npc.levels[HP]);
        hp = npc.levels[HP];
    }
    const used = 100 - bot.count('mindrune');
    retire(npc);
    return { bot, hp: npc.levels[HP], casts: castTicks.length, intervals: castTicks.slice(1).map((v, i) => v - castTicks[i]), used, maxDrop };
}

test('without Archmage a manual cast fires once (control)', t => {
    if (skip()) return t.skip(String(skip()));
    const r = castAndWatch([], SPOT.cast, 30, 5);
    assert.equal(r.casts, 1);
    assert.equal(r.used, 1);
    assert.equal(r.bot.count('airrune'), 99);
});

test('Archmage keeps casting the last spell at the same target, 3 ticks apart, and saves some runes', t => {
    if (skip()) return t.skip(String(skip()));
    const r = castAndWatch([22], SPOT.cast, 200, 30);
    assert.equal(r.casts, 30, `the cast repeats on its own (intervals ${r.intervals}, hp ${r.hp}, msgs ${r.bot.messages.slice(-4)})`);
    assert.ok(r.intervals.every(i => i === 3), `intervals ${r.intervals}`);
    assert.ok(r.used > 0 && r.used < r.casts, `runes used ${r.used} of ${r.casts} casts (about half expected)`);
    assert.ok(r.maxDrop > 2, `wind strike maxes at 2, doubled 4; biggest hit seen ${r.maxDrop}`);
});

test('Archmage loop stops when the player walks away', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = mageBot(SPOT.stop, [22]);
    const npc = spawnNpc('black_demon', { x: SPOT.stop.x + 3, z: SPOT.stop.z });
    bot.tick();
    castOn(bot, npc, 'wind_strike');
    const xp0 = bot.xp('magic');
    let ticks = 0;
    while (bot.xp('magic') === xp0 && ticks++ < 20) step(bot, 1);
    const perCast = bot.xp('magic') - xp0; // the first cast
    assert.ok(perCast > 0, 'the first cast happened');
    step(bot, 14);
    assert.ok(bot.xp('magic') - xp0 >= 3 * perCast, `it kept casting (${(bot.xp('magic') - xp0) / perCast} casts)`);
    bot.walkTo({ x: SPOT.stop.x - 3, z: SPOT.stop.z });
    step(bot, 2);
    const after = bot.xp('magic');
    step(bot, 15);
    assert.equal(bot.xp('magic'), after, 'no more casts once the player walked away');
    retire(npc);
});

test('Archmage stops (no endless loop) when the runes run out', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot(SPOT.stop, [22], { magic: 99, hitpoints: 99, defence: 99 });
    bot.setVar('option_nodef', 1);
    bot.clearInv().clearInv('worn');
    bot.give('mindrune', 3).give('airrune', 3);
    const npc = spawnNpc('black_demon', { x: SPOT.stop.x + 3, z: SPOT.stop.z });
    bot.tick();
    castOn(bot, npc, 'wind_strike');
    step(bot, 60);
    assert.ok(bot.count('mindrune') <= 3);
    bot.expectMessage(/You do not have enough .* Runes to cast this spell/);
    retire(npc);
});

// ------------------------------------------------------------------------------------- 23 Endless Quiver

test('Endless Quiver: ranged max hit x1.5 (relic_ranged_maxhit)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.maxhit, []);
    const quiver = relicBot(SPOT.maxhit, [23]);
    for (const [max, want] of [[1, 1], [2, 3], [10, 15], [13, 19]] as const) {
        assert.equal(callProc(plain, 'relic_ranged_maxhit', max), max);
        assert.equal(callProc(quiver, 'relic_ranged_maxhit', max), want);
    }
});

test('Endless Quiver: +50% attack roll for ranged only; combat relics 3-9 keep stacking', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.accuracy, []);
    const quiver = relicBot(SPOT.accuracy, [23]);
    const both = relicBot(SPOT.accuracy, [23, 3]);
    const stone = relicBot(SPOT.accuracy, [3]);
    const acc = (b: Bot, roll: number, style: number) => callProc(b, 'relic_accuracy', roll, style);
    assert.equal(acc(plain, 1000, RANGED_STYLE), 1000);
    assert.equal(acc(quiver, 1000, RANGED_STYLE), 1500);
    assert.equal(acc(quiver, 1000, MELEE_STYLE), 1000);
    assert.equal(acc(quiver, 1000, MAGIC_STYLE), 1000);
    assert.equal(acc(stone, 1000, RANGED_STYLE), 1500, 'a combat relic still gives +50%');
    assert.equal(acc(both, 1000, RANGED_STYLE), 2000, 'additive with the combat relics: 1 + 0.5 + 0.5');
    assert.equal(acc(both, 1000, MELEE_STYLE), 1500);
});

function shoot(relics: number[], at: { x: number; z: number }, swings: number) {
    const bot = relicBot(at, relics, { ranged: 99, hitpoints: 99, defence: 99 });
    bot.setVar('option_nodef', 1);
    bot.clearInv().clearInv('worn').give('shortbow').give('bronze_arrow', 100);
    bot.opHeld('shortbow', 2).tick();
    bot.opHeld('bronze_arrow', 2).tick();
    assert.equal(bot.count('shortbow', 'worn'), 1);
    const npc = spawnNpc('black_demon', { x: at.x + 4, z: at.z });
    bot.tick();
    bot.opNpc(npc, 2);
    let n = 0;
    let last = bot.varp('action_delay');
    bot.waitUntil(
        () => {
            const d = bot.varp('action_delay');
            if (d !== last) n++;
            last = d;
            return n >= swings;
        },
        400,
        `${swings} shots`
    );
    bot.tick(8); // let the last arrow land or drop
    const left = bot.count('bronze_arrow', 'worn');
    retire(npc);
    return { bot, left };
}

test('arrows are used up by default (control)', t => {
    if (skip()) return t.skip(String(skip()));
    const r = shoot([], SPOT.quiver, 12);
    assert.ok(r.left <= 90, `${r.left} arrows left after 12 shots`);
});

test('Endless Quiver: arrows are never used up and none fall to the floor', t => {
    if (skip()) return t.skip(String(skip()));
    const r = shoot([23], SPOT.quiver, 12);
    assert.equal(r.left, 100);
    assert.equal(r.bot.count('bronze_arrow'), 0);
});

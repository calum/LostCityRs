// Self-tests for the harness: login, set-up helpers, walking, scripts, dialogues, relog.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, World } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

test('a bot logs in at Lumbridge and gets the welcome message', () => {
    const bot = Bot.spawn();
    assert.deepEqual(bot.pos, { x: 3222, z: 3218, level: 0 });
    bot.expectMessage('Welcome to RuneScape.');
    assert.equal(bot.chatModal, null);
});

test('ticks run without waiting for the 600 ms clock', () => {
    const bot = Bot.spawn();
    const start = World.currentTick;
    const t0 = performance.now();
    bot.tick(50);
    assert.equal(World.currentTick, start + 50);
    assert.ok(performance.now() - t0 < 50 * 600, 'faster than real time');
});

test('give, count and clear the backpack', () => {
    const bot = Bot.spawn();
    bot.clearInv().give('bronze_axe').give('coins', 500);
    assert.equal(bot.count('bronze_axe'), 1);
    assert.equal(bot.count('coins'), 500);
    assert.deepEqual(
        bot.items().map(i => i.obj),
        ['bronze_axe', 'coins']
    );
});

test('teleport by coord literal and walk with the real movement code', () => {
    const bot = Bot.spawn();
    bot.teleport('0_50_50_22_22'); // 3222,3222
    assert.deepEqual(bot.pos, { x: 3222, z: 3222, level: 0 });

    const t0 = World.currentTick;
    bot.walk({ x: 3232, z: 3222 });
    // walking is one tile per tick (docs/tick/06-players-interaction-movement.md)
    assert.ok(World.currentTick - t0 >= 10, `took ${World.currentTick - t0} ticks`);

    // a blocked destination is reported instead of timing out
    assert.throws(() => bot.walk({ x: 3222, z: 3226 }), /no route to 3222,3226/);
});

test('debugproc runs through the real ::~ cheat handler', () => {
    const bot = Bot.spawn();
    bot.debugproc('hello');
    bot.expectMessage('hello from mods/hello/scripts/hello.rs2');
});

test('debugprocs are refused below staff level 4', () => {
    const bot = Bot.spawn({ staff: 0 });
    bot.debugproc('hello');
    bot.expectNoMessage('hello from mods');
});

test('setLevel and xp', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 30 } });
    assert.equal(bot.baseLevel('woodcutting'), 30);
    bot.setLevel('attack', 40);
    assert.equal(bot.stat('attack'), 40);
});

test('talk to Hans: dialogue, choice by text, continue to the end', () => {
    const bot = Bot.spawn();
    const hans = bot.findNpc('hans', 40); // he patrols around the castle
    bot.teleport({ x: hans.x, z: hans.z });
    bot.opNpc(hans, 1);
    bot.waitUntil(() => bot.inDialog, 30, 'Hans to speak');
    assert.match(bot.dialogText, /What are you doing here\?/);
    bot.continueDialog();
    assert.deepEqual(bot.choices, ["I'm looking for whoever is in charge of this place.", 'I have come to kill everyone in this castle!', "I don't know. I'm lost. Where am I?"]);
    bot.choose(/lost/);
    assert.match(bot.dialogText, /I'm lost/);
    bot.continueDialog();
    assert.match(bot.dialogText, /You are in Lumbridge Castle/);
    bot.continueDialog();
    bot.waitUntilIdle(5);
    assert.equal(bot.chatModal, null);
});

test('relog keeps the save: position, items and varps survive', () => {
    const bot = Bot.spawn();
    bot.give('bronze_axe').teleport({ x: 3230, z: 3230 });
    const again = bot.relog();
    assert.equal(again.count('bronze_axe'), 1);
    assert.deepEqual(again.pos, { x: 3230, z: 3230, level: 0 });
    assert.equal(again.varp('tutorial'), 1000);
});

test('a RuneScript error fails the test with the script trace', () => {
    const bot = Bot.spawn();
    // [debugproc,error] in Content/scripts/_test/scripts/engine/debug_error.rs2 calls error($str)
    assert.throws(() => bot.debugproc('error', 'boom'), /RuneScript error reported to .*\n.*script error: .*boom/s);
});

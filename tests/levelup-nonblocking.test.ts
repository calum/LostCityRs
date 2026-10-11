// Level-ups must not open a blocking chat dialog; instead the chat box says the skill and the new level.
// Design notes: docs/design/levelup-nonblocking.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

// ::~relic_xptest advances 1000 xp in fletching (a level-up), see relic_debug.rs2
test('a level-up prints the skill and new level in the chat box', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_xptest').tick(2);
    const level = bot.baseLevel('fletching');
    bot.expectMessage(`Your fletching level is now ${level}.`);
});

test('a level-up opens no chat dialog and does not interrupt the player', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_xptest').tick(2);
    assert.equal(bot.chatModal, null);
    assert.equal(bot.inDialog, false);
});

// Evergreen keeps the tree standing, so the chopping loop (p_oploc(3), woodcut.rs2) runs on its own: a level-up must not break it.
test('a woodcutting level-up mid-chop does not stop the chopping loop', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 1, hitpoints: 99 }, varps: { relic_tasks_done2: 1 << 8 } });
    bot.clearInv().give('bronze_axe');
    bot.debugproc('relic_grant', 11);
    bot.opLoc(bot.findLoc('tree', 40), 1);
    bot.waitUntil(() => bot.baseLevel('woodcutting') > 1, 400, 'a woodcutting level-up');
    const logs = () => bot.count('logs', 'bank') + bot.count('logs');
    const before = logs();
    bot.waitUntil(() => logs() > before, 400, 'another log after the level-up');
});

// Eternal Vein keeps the rock, so one click keeps mining (like Evergreen). Smithing 1: the autosmelt XP levels smithing mid-loop.
test('eternal vein: one click keeps mining through a smithing level-up', () => {
    const bot = Bot.spawn({ at: { x: 3299, z: 3311, level: 0 }, levels: { mining: 99, smithing: 1, hitpoints: 99 }, varps: { relic_tasks_done2: 1 << 8 } });
    bot.clearInv().give('rune_pickaxe');
    bot.debugproc('relic_grant', 10);
    bot.opLoc(bot.findLoc('copperrock1', 20), 1);
    bot.waitUntil(() => bot.baseLevel('smithing') > 1, 400, 'a smithing level-up');
    const bars = () => bot.count('bronze_bar', 'bank');
    const before = bars();
    bot.waitUntil(() => bars() > before, 400, 'another bar after the level-up');
});

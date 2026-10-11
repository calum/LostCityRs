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

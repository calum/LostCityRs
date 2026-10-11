// The task-complete toast: the server sends "<task name>:relictask:" as a game message and the client draws a fading panel
// instead of a chat line (Client-TS toast). Design: docs/design/task-complete-toast.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

test('completing a task sends the toast marker with the task name, besides the chat line', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_task', 1).tick(3);
    bot.expectMessage('Relic task 1 complete!');
    bot.expectMessage('Defeat a goblin:relictask:');
});

test('an already completed task sends no second toast', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_task', 1).tick(3);
    bot.expectMessage('Defeat a goblin:relictask:');
    bot.debugproc('relic_task', 1).tick(3);
    assert.equal(bot.messages.filter(m => m.endsWith(':relictask:')).length, 1);
});

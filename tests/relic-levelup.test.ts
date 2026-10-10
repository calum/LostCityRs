// The level-up chat line that shows the XP rate ([proc,relic_levelup_note], called from Content's levelup.rs2 hook).
// Design notes: docs/design/relics-menus.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

// ::~relic_xptest advances 1000 xp in fletching (a level-up at every tier), see relic_debug.rs2
test('a level-up says the XP rate: 8x with no XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_xptest').tick(2);
    bot.expectMessage(/Congratulations.*Fletching/i);
    bot.expectMessage('XP rate: 8x');
});

test('a level-up says the raised XP rate with the XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_xp_tier: 2, relic_xp_factor: 4 } });
    bot.debugproc('relic_xptest').tick(2);
    bot.expectMessage('XP rate: 32x');
});

test('no level-up, no XP rate line', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.debugproc('relic_grant', 1).tick(2);
    bot.expectNoMessage(/XP rate:/);
});

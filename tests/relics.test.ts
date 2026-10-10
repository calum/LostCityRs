// Relic mode (mods/relics). Skipped when the relic mod is not in the packed cache.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

test('first login after the tutorial offers a relic, and picking one settles the offer', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn(); // tutorial done, relic_started 0: [proc,relic_on_login] -> relic_first_offer
    bot.waitUntil(() => bot.choices.length >= 2, 10, 'the relic offer');
    assert.equal(bot.varp('relic_started'), 1);
    assert.equal(bot.varp('relic_pending'), 1);

    bot.choose(1);
    bot.skipDialog();
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.chatModal, null);
});

test('XP tier multiplies stat_advance (engine hook in Player.addXp)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = Bot.spawn({ varps: { relic_started: 1 } });
    const boosted = Bot.spawn({ varps: { relic_started: 1 } });

    boosted.debugproc('relic_setxp', 3);
    boosted.expectMessage('xp tier 3 factor 8');

    plain.debugproc('relic_xptest');
    boosted.debugproc('relic_xptest');
    assert.ok(plain.xp('fletching') > 0);
    assert.equal(boosted.xp('fletching'), plain.xp('fletching') * 8);
});

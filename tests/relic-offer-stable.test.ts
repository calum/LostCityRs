// A closed relic offer keeps the same relics, in the same order, after a relog and after "Choose a relic now" in the Relics menu.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

function waitForOffer(bot: Bot) {
    bot.waitUntil(() => bot.inDialog && bot.choices.length >= 2, 20, 'a relic offer');
}

function openRelics(bot: Bot) {
    bot.clickButton('options:relic_relics').tick();
    assert.equal(bot.mainModal, 'relic_relicmenu');
}

for (const seed of [5, 6, 1234, 40000]) {
    test(`seed ${seed}: closing the offer and relogging shows the same relics in the same order`, t => {
        if (skip()) return t.skip(String(skip()));
        const bot = Bot.spawn({ varps: { relic_seed: seed } });
        waitForOffer(bot);
        const first = [...bot.choices];
        bot.closeModal().tick(3);
        const again = bot.relog();
        waitForOffer(again);
        assert.deepEqual(again.choices, first);
        // and a second relog
        again.closeModal().tick(3);
        const third = again.relog();
        waitForOffer(third);
        assert.deepEqual(third.choices, first);
    });
}

test('closing the offer and clicking Choose a relic now shows the same relics in the same order', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_seed: 5 } });
    waitForOffer(bot);
    const first = [...bot.choices];
    bot.closeModal().tick(3);
    openRelics(bot);
    bot.clickButton('relic_relicmenu:choose');
    waitForOffer(bot);
    assert.deepEqual(bot.choices, first);
});

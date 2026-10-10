// Random events are switched off on this server: ^macro_events_enabled = 0 in
// Content/scripts/macro events/configs/macro_events.constant gates [proc,macro_event_allowed].
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

test('~macro_event_allowed is false in Lumbridge', () => {
    const bot = Bot.spawn();
    assert.equal(bot.call('macro_event_allowed').popInt(), 0);
});

test('::~random_event and ::~macro_event spawn nothing', () => {
    const bot = Bot.spawn();
    for (let event = 1; event <= 5; event++) {
        bot.debugproc('macro_event', event);
        assert.equal(bot.varp('macro_event'), 0, `::~macro_event ${event} must not start an event`);
    }
    for (let i = 0; i < 30; i++) {
        bot.debugproc('random_event');
    }
    assert.equal(bot.varp('macro_event'), 0);
});

test('the 500-tick timer never spawns an event', () => {
    const bot = Bot.spawn();
    for (let i = 0; i < 300; i++) {
        bot.call('[timer,general_macro_events]');
    }
    assert.equal(bot.varp('macro_event'), 0);
});

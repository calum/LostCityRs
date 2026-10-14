// Skip Tutorial Island on a production server (`mise run host` sets node.production = true, scripts/public-config.mjs).
// The guide's skip offer is gated on map_live in Content/scripts/tutorial/scripts/guides/runescape_guide.rs2,
// and map_live reads Environment.node.production (Engine-TS/src/engine/script/handlers/ServerOps.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import Environment from '../Engine-TS/src/util/Environment.js';
import { Bot } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld(); // boot once per file; remove bots after each test

test('skip tutorial: the guide offers it on a production (hosted) server, and Yes ends Tutorial Island', () => {
    const production = Environment.node.production;
    Environment.node.production = true;
    try {
        // Tutorial Island start, next to the guide (npc_find(0_48_48_21_35, newbie_basics_instructor, 10, 0) in runescape_guide.rs2).
        // %tutorial = 1 (^newbie_basics_instructor_designed_character, tutorial.constant:2) is the step where the guide's switch_int shows the skip offer.
        const bot = Bot.spawn({ tutorialDone: false, at: '0_48_48_21_35', varps: { tutorial: 1 } });
        bot.opNpc(bot.findNpc('newbie_basics_instructor', 15), 1);
        bot.waitUntil(() => bot.inDialog, 100, 'guide dialogue');
        bot.skipDialog();
        assert.deepEqual(bot.choices, ['Yes please.', 'No, thank you.']);
        bot.choose(/Yes please/);
        bot.tick(5);
        assert.equal(bot.varp('tutorial'), 1000);
        bot.remove();
    } finally {
        Environment.node.production = production;
    }
});

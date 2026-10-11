// Relic tasks 26-31 (the skilling tasks added after the two final bosses), driven through the real skilling scripts where
// that is cheap. Shared by relic-tasks.test.ts (no relics) and relic-all-relics.test.ts (every relic owned), so each task
// is proven in both worlds: with Eternal Vein, Evergreen and Double Yield owned an ore turns into a bar before it reaches
// the inventory, and a fish arrives cooked, so a task keyed on the item can silently stop firing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Bot } from '../harness/src/index.js';
import type { CoordLike } from '../harness/src/index.js';
import { isDone, locNear, standNear } from './relic-helpers.js';

export type SpawnFn = (levels?: Record<string, number>, at?: CoordLike) => Bot;

export function defineSkillingTaskTests(prefix: string, spawn: SpawnFn, skip: () => string | false) {
    const doneMsg = (bot: Bot, task: number) => {
        assert.ok(isDone(bot, task), `task ${task} not done`);
        bot.expectMessage(`Relic task ${task} complete!`);
    };

    test(`${prefix}: mining a real coal rock completes task 26`, t => {
        if (skip()) return t.skip(String(skip()));
        const rock = locNear('coalrock1', 2575, 3479, 15);
        const bot = spawn({ mining: 99 }, standNear(rock));
        bot.clearInv().give('rune_pickaxe');
        bot.opLoc(rock, 1);
        bot.waitUntil(() => isDone(bot, 26), 300, 'task 26');
        doneMsg(bot, 26);
        assert.ok(bot.count('coal') + bot.count('coal', 'bank') >= 1, 'the coal is in the inventory or the bank (Eternal Vein banks it, unsmelted)');
    });

    test(`${prefix}: mining a real adamantite rock completes task 31`, t => {
        if (skip()) return t.skip(String(skip()));
        const rock = locNear('adamantiterock1', 3242, 3165, 10);
        const bot = spawn({ mining: 99 }, standNear(rock));
        bot.clearInv().give('rune_pickaxe');
        bot.opLoc(rock, 1);
        bot.waitUntil(() => isDone(bot, 31), 500, 'task 31');
        doneMsg(bot, 31);
    });

    test(`${prefix}: smelting a steel bar in a furnace completes task 27`, t => {
        if (skip()) return t.skip(String(skip()));
        const bot = spawn({ smithing: 99 });
        bot.clearInv().give('iron_ore').give('coal', 2);
        const furnace = locNear('furnace1', bot.x, bot.z, 60);
        bot.teleport(standNear(furnace));
        bot.opLoc(furnace, 2); // "Smelt": opens the bar interface
        bot.tick(2);
        bot.clickButton('smelting:com_27'); // steel bar, make 1
        bot.waitUntil(() => isDone(bot, 27), 60, 'task 27');
        doneMsg(bot, 27);
        assert.equal(bot.count('steel_bar'), 1);
    });

    for (const [task, product] of [[28, 'adamant_platebody'], [29, 'rune_scimitar']] as const) {
        test(`${prefix}: smithing ${product} at an anvil completes task ${task}`, t => {
            if (skip()) return t.skip(String(skip()));
            const bot = spawn({ smithing: 99 });
            bot.clearInv();
            if (product === 'adamant_platebody') bot.give('adamantite_bar', 5);
            else bot.give('runite_bar', 2);
            bot.debugproc('relic_smith', product); // relic_debug.rs2: ~smithing_anvil, the proc the anvil interface runs after its checks
            bot.waitUntil(() => isDone(bot, task), 20, `task ${task}`);
            doneMsg(bot, task);
            assert.equal(bot.count(product), 1);
        });
    }

    for (const [task, fish] of [[30, 'raw_lobster']] as const) {
        test(`${prefix}: catching a ${fish.slice(4)} through the fishing hook completes task ${task}`, t => {
            if (skip()) return t.skip(String(skip()));
            const bot = spawn();
            bot.clearInv();
            bot.debugproc('relic_fish', fish); // relic_debug.rs2: ~relic_fished, the call the four fishing.rs2 sites make
            bot.waitUntil(() => isDone(bot, task), 15, `task ${task}`);
            doneMsg(bot, task);
        });
    }
}

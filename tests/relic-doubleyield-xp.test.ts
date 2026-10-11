// Relic 12 Double Yield: the doubled product also doubles the XP, and fishing is covered too
// (double fish, caught already cooked, with the cooking XP). Mod code: relic_gather.rs2; hooks in
// Content skill_mining/skill_fishing (docs/local-changes.md). Design: docs/design/relics-double-yield.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import Environment from '../Engine-TS/src/util/Environment.js';
import Loc from '../Engine-TS/src/engine/entity/Loc.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');

// Al Kharid mine (same spot as relic-skilling.test.ts) and the Draynor net spots.
const MINE = { x: 3299, z: 3311, level: 0 };
const ROCKS = ['copperrock1', 'copperrock2', 'tinrock1', 'tinrock2'];
const DRAYNOR = { x: 3087, z: 3229, level: 0 };
const SPOT = '0_48_50_saltfish';

function xpMulti(bot: Bot): number {
    return Environment.node.xpRate * Math.max(1, bot.varp('relic_xp_factor') as number);
}

function nearestLoc(bot: Bot, types: string[], radius = 20): Loc {
    let best: Loc | null = null;
    let bestDist = Infinity;
    for (const t of types) {
        try {
            const loc = bot.findLoc(t, radius);
            const d = Math.max(Math.abs(loc.x - bot.x), Math.abs(loc.z - bot.z));
            if (d < bestDist) {
                best = loc;
                bestDist = d;
            }
        } catch {
            // none of this type in range
        }
    }
    if (!best) throw new Error(`no ${types.join('/')} within ${radius}`);
    return best;
}

/** One successful swing, then stop (Eternal Vein would otherwise keep swinging). Returns the mining XP it gave. */
function mineOnce(bot: Bot): number {
    const xp0 = bot.xp('mining');
    bot.opLoc(nearestLoc(bot, ROCKS), 1);
    bot.waitForMessage(/You manage to mine some/, 300);
    bot.player.stopAction();
    bot.waitUntilIdle(20);
    return bot.xp('mining') - xp0;
}

function miner(relics: number[]): Bot {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv().give('rune_pickaxe');
    for (const r of relics) bot.debugproc('relic_grant', r);
    return bot;
}

/** Net a fish at Draynor until one is caught, then stop. Returns the fishing XP it gave. */
function fishOnce(bot: Bot): number {
    const xp0 = bot.xp('fishing');
    bot.opNpc(bot.findNpc(SPOT, 40), 1);
    bot.waitForMessage(/You catch/, 300);
    bot.player.stopAction();
    bot.waitUntilIdle(20);
    return bot.xp('fishing') - xp0;
}

function fisher(relics: number[]): Bot {
    const bot = Bot.spawn({ at: DRAYNOR, levels: { fishing: 1, cooking: 1 } });
    bot.clearInv().give('net');
    for (const r of relics) bot.debugproc('relic_grant', r);
    return bot;
}

// ---------------------------------------------------------------- mining

test('double yield (mining): two ore also give two ores of mining xp', t => {
    if (skip()) return t.skip(String(skip()));
    const control = mineOnce(miner([]));
    assert.ok(control > 0);

    const bot = miner([12]);
    const xp = mineOnce(bot);

    assert.equal(bot.count('copper_ore') + bot.count('tin_ore'), 2);
    assert.equal(xp, 2 * control);
});

test('double yield (mining): with room for only one ore you get one ore and one ore of xp', t => {
    if (skip()) return t.skip(String(skip()));
    const control = mineOnce(miner([]));

    const bot = miner([12]);
    const free = bot.player.getInventory(ids.inv('inv'))!.freeSlotCount;
    bot.give('bronze_dagger', free - 1);
    const xp = mineOnce(bot);

    assert.equal(bot.count('copper_ore') + bot.count('tin_ore'), 1);
    assert.equal(xp, control);
});

test('double yield + eternal vein: a mined ore gives double mining xp and two bars of smithing xp', t => {
    if (skip()) return t.skip(String(skip()));
    const control = mineOnce(miner([]));

    const bot = miner([10, 12]);
    const smith0 = bot.xp('smithing');
    const xp = mineOnce(bot);

    assert.equal(xp, 2 * control);
    assert.equal(bot.count('bronze_bar', 'bank'), 2);
    assert.equal(bot.xp('smithing') - smith0, 2 * 62 * xpMulti(bot));
});

// ---------------------------------------------------------------- fishing

test('fishing control: without the relic a net catches one raw shrimp and no cooking xp', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = fisher([]);
    const xp = fishOnce(bot);

    assert.ok(xp > 0);
    assert.equal(bot.count('raw_shrimp') + bot.count('raw_anchovies'), 1);
    assert.equal(bot.xp('cooking'), 0);
});

test('double yield (fishing): two fish, caught already cooked, with double fishing xp and the cooking xp for both', t => {
    if (skip()) return t.skip(String(skip()));
    const control = fishOnce(fisher([]));

    const bot = fisher([12]);
    const xp = fishOnce(bot);

    assert.equal(bot.count('raw_shrimp') + bot.count('raw_anchovies'), 0, 'nothing is left raw');
    assert.equal(bot.count('burntfish1'), 0);
    const cooked = bot.count('shrimp') + bot.count('anchovies');
    assert.equal(cooked, 2);
    assert.equal(xp, 2 * control);
    // cooking_generic.dbrow: shrimp gives experience 300 (tenths) per cook. Fishing level 1 keeps the catch to shrimp (anchovies need 15)
    assert.equal(bot.xp('cooking'), 2 * 300 * xpMulti(bot));
});

test('double yield (fishing): with room for one fish you get one cooked fish and one fish of xp', t => {
    if (skip()) return t.skip(String(skip()));
    const control = fishOnce(fisher([]));

    const bot = fisher([12]);
    const free = bot.player.getInventory(ids.inv('inv'))!.freeSlotCount;
    bot.give('bronze_dagger', free - 1);
    const xp = fishOnce(bot);

    assert.equal(bot.count('shrimp') + bot.count('anchovies'), 1);
    assert.equal(xp, control);
    assert.equal(bot.xp('cooking'), 300 * xpMulti(bot));
});

// ---------------------------------------------------------------- tasks stay completable

test('double yield: a caught fish still counts for the catch-the-raw-fish task and the cooked-fish task', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ at: DRAYNOR, varps: { relic_owned: (1 << 2) | (1 << 19) } });
    bot.debugproc('relic_grant', 12);
    // task 9 = catch a raw swordfish (relic_task_obj raw_swordfish), task 10 = a shark; ::~relic_fish runs the fishing hook for a fish
    bot.debugproc('relic_fish', 'raw_swordfish');
    assert.equal(((bot.varp('relic_tasks_done') as number) >>> 8) & 1, 1, 'task 9 (raw swordfish) done');
    bot.debugproc('relic_fish', 'raw_shark');
    assert.equal(((bot.varp('relic_tasks_done') as number) >>> 9) & 1, 1, 'task 10 (shark) done');
});

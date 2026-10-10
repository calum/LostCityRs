// Real content, driven through the engine's own packet handlers and scripts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, spawnNpc } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

test('woodcutting: chop a tree near Lumbridge until some logs arrive', () => {
    const bot = Bot.spawn();
    bot.clearInv().give('bronze_axe');
    const xp0 = bot.xp('woodcutting');

    bot.opLoc(bot.findLoc('tree', 40), 1); // "Chop down": [oploc1,_tree] in skill_woodcutting/scripts/woodcut.rs2
    bot.waitForMessage('You swing your axe at the tree.', 40);
    bot.waitForMessage('You get some logs.', 200);

    assert.equal(bot.count('logs'), 1);
    assert.ok(bot.xp('woodcutting') > xp0);
});

test('woodcutting: no axe, no logs', () => {
    const bot = Bot.spawn();
    bot.clearInv();
    // The first test may have felled the nearest tree (loc_change to a stump in [label,get_logs]);
    // tests in one file share the world, so this bot may walk to a further tree.
    bot.opLoc(bot.findLoc('tree', 40), 1);
    bot.waitForMessage(/You do not have an axe/i, 150);
    assert.equal(bot.count('logs'), 0);
});

test('prayer: bury bones from the backpack (opheld1)', () => {
    const bot = Bot.spawn();
    bot.clearInv().give('bones');
    const xp0 = bot.xp('prayer');

    bot.opHeld('bones', 1);
    bot.waitForMessage('You bury the bones.', 5);

    assert.equal(bot.count('bones'), 0);
    assert.ok(bot.xp('prayer') > xp0);
});

test('combat: attack a chicken until it dies', () => {
    const bot = Bot.spawn({ levels: { attack: 20, strength: 20 } });
    const chicken = spawnNpc('chicken', { x: bot.x + 2, z: bot.z });
    bot.tick();

    bot.opNpc(chicken, 2); // "Attack"
    const ticks = bot.waitUntil(() => !chicken.isActive, 100, 'the chicken to die');
    assert.ok(ticks > 0);
    assert.ok(bot.xp('attack') > 0 || bot.xp('strength') > 0 || bot.xp('defence') > 0);
    // hitpoints xp is always given for melee damage
    assert.ok(bot.xp('hitpoints') > 0);
});

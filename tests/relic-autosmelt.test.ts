// Relic 10 Eternal Vein also smelts: each ore mined goes to the bank as a bar, with that bar's smithing XP.
// Mod code: [proc,relic_gathered] and [proc,relic_smelt_ore] in mods/relics/scripts/relic_gather.rs2.
// Bar table and XP: Content/scripts/skill_smithing/configs/smelting/smelting.struct (productexp is in tenths of a point).
//
// Most cases call the gather hook directly (::~relic_gather <ore> 10, the call mining.rs2 makes with relic 10);
// one case mines a real copper rock through OPLOC.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

import ObjType from '../Engine-TS/src/cache/config/ObjType.js';
import Environment from '../Engine-TS/src/util/Environment.js';

useVanillaWorld();

const MINE = { x: 3299, z: 3311, level: 0 };

/** Player.addXp multiplies every stat_advance by node.xpRate * max(1, %relic_xp_factor) (Engine-TS Player.ts addXp). */
function xpMulti(bot: Bot): number {
    return Environment.node.xpRate * Math.max(1, bot.varp('relic_xp_factor') as number);
}

function eternal(): Bot {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv();
    bot.debugproc('relic_grant', 10);
    return bot;
}

// [ore, bar, productexp in tenths] from smelting.struct
const BARS: [string, string, number][] = [
    ['copper_ore', 'bronze_bar', 62],
    ['tin_ore', 'bronze_bar', 62],
    ['iron_ore', 'steel_bar', 175], // steel, not iron: Calum's mapping
    ['silver_ore', 'silver_bar', 137],
    ['gold_ore', 'gold_bar', 225],
    ['mithril_ore', 'mithril_bar', 300],
    ['adamantite_ore', 'adamantite_bar', 375],
    ['runite_ore', 'runite_bar', 500]
];

for (const [ore, bar, exp] of BARS) {
    test(`autosmelt: ${ore} is banked as ${bar} and grants its smithing xp`, () => {
        const bot = eternal();
        const xp0 = bot.xp('smithing');

        bot.debugproc('relic_gather', ore, 10);

        assert.equal(bot.count(bar, 'bank'), 1);
        assert.equal(bot.count(ore, 'bank'), 0);
        assert.equal(bot.count(ore), 0);
        assert.equal(bot.xp('smithing') - xp0, exp * xpMulti(bot));
    });
}

for (const item of ['coal', 'clay', 'sapphire']) {
    test(`autosmelt: ${item} is banked unchanged with no smithing xp`, () => {
        const bot = eternal();
        const xp0 = bot.xp('smithing');

        bot.debugproc('relic_gather', item, 10);

        assert.equal(bot.count(item, 'bank'), 1);
        assert.equal(bot.xp('smithing'), xp0);
    });
}

test('autosmelt: needs no smithing level and no coal', () => {
    const bot = eternal();
    assert.equal(bot.stat('smithing'), 1);

    bot.debugproc('relic_gather', 'mithril_ore', 10);

    assert.equal(bot.count('mithril_bar', 'bank'), 1);
});

test('autosmelt: without the relic an ore stays an ore in the backpack', () => {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv();
    const xp0 = bot.xp('smithing');

    bot.debugproc('relic_gather', 'iron_ore', 10);

    assert.equal(bot.count('iron_ore'), 1);
    assert.equal(bot.count('steel_bar', 'bank'), 0);
    assert.equal(bot.xp('smithing'), xp0);
});

test('autosmelt: only mining smelts (relic 0, a fish is untouched)', () => {
    const bot = eternal();
    bot.debugproc('relic_gather', 'iron_ore', 0);
    assert.equal(bot.count('iron_ore'), 1);
    assert.equal(bot.count('steel_bar', 'bank'), 0);
});

test('autosmelt + double yield: two bars and two bars of xp per ore', () => {
    const bot = eternal();
    bot.debugproc('relic_grant', 12);
    const xp0 = bot.xp('smithing');

    bot.debugproc('relic_gather', 'iron_ore', 10);

    assert.equal(bot.count('steel_bar', 'bank'), 2);
    assert.equal(bot.xp('smithing') - xp0, 2 * 175 * xpMulti(bot));
});

test('autosmelt: with the bank full the bar lands in the backpack', () => {
    const bot = eternal();
    const bankId = ids.inv('bank');
    const bank = bot.player.getInventory(bankId)!;
    const skip = new Set([ids.obj('steel_bar')]);
    // the bank is stackall: one slot per obj type, so fill every slot with a distinct obj that is not a steel bar
    for (let id = 0; id < ObjType.count && bank.freeSlotCount > 0; id++) {
        const t = ObjType.get(id);
        if (!t || skip.has(id) || t.dummyitem !== 0 || t.certtemplate !== -1) continue;
        bot.player.invAdd(bankId, id, 1);
    }
    assert.equal(bank.freeSlotCount, 0, 'bank should be full');

    bot.debugproc('relic_gather', 'iron_ore', 10);

    assert.equal(bot.count('steel_bar'), 1);
});

test('autosmelt: a real copper rock gives a bronze bar in the bank and the rock stays', () => {
    const bot = eternal();
    bot.give('rune_pickaxe');
    const rock = bot.findLoc('copperrock1', 20);
    const type = rock.type;
    const xp0 = bot.xp('smithing');

    bot.opLoc(rock, 1);
    bot.waitForMessage(/You manage to mine some/, 300);
    bot.waitUntilIdle(20);

    assert.equal(bot.count('bronze_bar', 'bank'), 1);
    assert.equal(bot.count('copper_ore', 'bank') + bot.count('copper_ore'), 0);
    assert.equal(rock.type, type);
    assert.equal(bot.xp('smithing') - xp0, 62 * xpMulti(bot));
});

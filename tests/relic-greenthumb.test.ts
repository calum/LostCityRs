// Relic 20 Green Thumb (herblore) and tasks 43 (super strength potion), 44 (antifire potion), 45 (ranging potion).
// 1. Stat boosts never drain (Content player/scripts/stat.rs2 [timer,stat_boost_restore] hook).
// 2. Secondaries are never used up when a potion is finished; the herb and the vial still are (Content skill_herblore/scripts/herblore.rs2).
// 3. XP pays herbs the player is able to identify (Engine hook Player.addXp, mods/relics/scripts/relic_herblore.rs2), straight into the bank.
// 4. Taking the relic puts one of every potion secondary in the bank.
// Design: docs/design/relics-green-thumb.md. Research: docs/design/herblore-relic-research.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';
import { isDone } from './relic-helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

const RELIC = 20;
const owned = (...relics: number[]) => relics.reduce((m, id) => m | (1 << id), 0);

/** The eleven herbs of [proc,randomherb] (drop tables/scripts/shared_droptables.rs2), with the identify level of herbs.obj. */
const HERBS: [string, number][] = [
    ['guam_leaf', 3], ['marentill', 5], ['tarromin', 11], ['harralander', 20], ['ranarr_weed', 25], ['irit_leaf', 40],
    ['avantoe', 48], ['kwuarm', 54], ['cadantine', 65], ['lantadyme', 67], ['dwarf_weed', 70]
];

/** XP in the unit the engine stores (tenths): 500 real XP is one herb. Raw XP, before the engine rate and the XP Multiplier relic. */
const XP_PER_HERB = 500;
function gain(bot: Bot, stat: string, xp: number) {
    bot.player.addXp(ids.stat(stat), xp * 10);
}

function herbCount(bot: Bot): number {
    return HERBS.reduce((n, [herb]) => n + bot.count(herb, 'bank') + bot.count(herb), 0);
}

/** A potion maker: relics, Herblore level, every task other than the three new ones marked done so no offer opens over the test. */
function maker(relics: number[], herblore = 99): Bot {
    const bot = Bot.spawn({ levels: { herblore, strength: 50, ranged: 50 } });
    bot.clearInv();
    bot.setVar('relic_tasks_done', 0x7fffffff);
    bot.setVar('relic_tasks_done2', 0x7fffffff & ~(7 << 11)); // tasks 43, 44 and 45 are bits 11-13
    return bot.setVar('relic_owned', owned(...relics));
}

// ---------------------------------------------------------------- 1. boosts never drain

test('green thumb control: without the relic a potion boost drops by 1 every 100 ticks', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('3dose2strength').opHeld('3dose2strength', 1).tick(2);
    const boosted = bot.stat('strength');
    assert.ok(boosted > bot.baseLevel('strength'), 'the potion boosts strength');
    bot.tick(260);
    assert.ok(bot.stat('strength') < boosted, `still ${bot.stat('strength')} after 260 ticks`);
});

test('green thumb: a potion boost never drains', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    bot.give('3dose2strength').opHeld('3dose2strength', 1).tick(2);
    const boosted = bot.stat('strength');
    assert.ok(boosted > bot.baseLevel('strength'));
    bot.tick(500);
    assert.equal(bot.stat('strength'), boosted);
});

test('green thumb: a drained stat still recovers to its base level', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    bot.player.levels[ids.stat('strength')] = 45;
    assert.equal(bot.stat('strength'), 45);
    bot.tick(560);
    assert.equal(bot.stat('strength'), 50);
});

// ---------------------------------------------------------------- 2. secondaries are never used up

test('green thumb control: finishing a potion uses up the secondary', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('tarrominvial').give('limpwurt_root');
    bot.useOnHeld('limpwurt_root', 'tarrominvial').tick(3);
    assert.equal(bot.count('3dose1strength'), 1);
    assert.equal(bot.count('limpwurt_root'), 0);
});

test('green thumb: finishing a potion keeps the secondary, so one limpwurt root makes any number of potions', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    bot.give('tarrominvial', 3).give('limpwurt_root');
    for (let i = 0; i < 3; i++) bot.useOnHeld('limpwurt_root', 'tarrominvial').tick(3);
    assert.equal(bot.count('3dose1strength'), 3);
    assert.equal(bot.count('tarrominvial'), 0, 'the unfinished potions are used up');
    assert.equal(bot.count('limpwurt_root'), 1, 'the secondary stays');
});

test('green thumb: the herb and the vial of water are still used up when the unfinished potion is made', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    bot.give('guam_leaf').give('vial_water');
    bot.useOnHeld('guam_leaf', 'vial_water').tick(3);
    assert.equal(bot.count('guamvial'), 1);
    assert.equal(bot.count('guam_leaf'), 0);
    assert.equal(bot.count('vial_water'), 0);
});

// ---------------------------------------------------------------- 3. XP pays herbs

test('green thumb control: without the relic XP pays no herbs', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    gain(bot, 'mining', XP_PER_HERB * 10);
    bot.tick(3);
    assert.equal(herbCount(bot), 0);
});

test('green thumb: one herb per 500 XP, in the bank, and the remainder carries over', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    gain(bot, 'woodcutting', 300);
    bot.tick(3);
    assert.equal(herbCount(bot), 0);
    gain(bot, 'fishing', 300);
    bot.tick(3);
    assert.equal(herbCount(bot), 1); // 600 XP gained
    gain(bot, 'mining', 900);
    bot.tick(3);
    assert.equal(herbCount(bot), 3); // 1500 XP gained
    assert.equal(bot.items().length, 0, 'nothing in the backpack');
});

test('green thumb: the herbs are identified, and only herbs the player has the Herblore level to identify', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC], 30);
    gain(bot, 'mining', XP_PER_HERB * 200);
    bot.tick(3);
    assert.equal(herbCount(bot), 200);
    const allowed = HERBS.filter(([, level]) => level <= 30).map(([herb]) => herb);
    assert.equal(allowed.length, 5);
    const got = allowed.filter(herb => bot.count(herb, 'bank') > 0);
    assert.ok(got.length >= 4, `only ${got.join(', ')} of ${allowed.join(', ')} in 200 herbs`);
    for (const [herb, level] of HERBS) {
        if (level > 30) assert.equal(bot.count(herb, 'bank'), 0, `${herb} needs level ${level}`);
    }
    assert.ok(bot.items('bank').every(i => !i.obj.startsWith('unidentified_')), 'no unidentified herb');
});

test('green thumb: at Herblore 99 every one of the eleven herbs turns up', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC], 99);
    gain(bot, 'mining', XP_PER_HERB * 400);
    bot.tick(3);
    assert.equal(herbCount(bot), 400);
    for (const [herb] of HERBS) assert.ok(bot.count(herb, 'bank') > 0, `no ${herb} in 400 herbs`);
});

test('green thumb: Herblore XP itself pays no herbs (cleaning and brewing would feed themselves)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    gain(bot, 'herblore', XP_PER_HERB * 10);
    bot.tick(3);
    assert.equal(herbCount(bot), 0);
});

test('green thumb: below Herblore 3 there is nothing to identify, and the XP is not saved up for later', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC], 1);
    gain(bot, 'mining', XP_PER_HERB * 50);
    bot.tick(3);
    assert.equal(herbCount(bot), 0);
    assert.ok((bot.varp('relic_herb_xp') as number) < XP_PER_HERB * 10, 'the owed XP was dropped');
});

test('green thumb: the XP rate does not change the herbs (raw XP counts, not the XP on the drop)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([RELIC]);
    bot.setVar('relic_xp_factor', 27);
    gain(bot, 'mining', XP_PER_HERB * 4);
    bot.tick(3);
    assert.equal(herbCount(bot), 4);
});

// ---------------------------------------------------------------- 4. starter secondaries

const STARTER = [
    'eye_of_newt', 'red_spiders_eggs', 'limpwurt_root', 'snape_grass', 'white_berries', 'unicorn_horn_dust', 'dragon_scale_dust',
    'wine_of_zamorak', 'jangerberries', 'toads_legs', 'chocolate_dust', 'mortmyremushroom', 'cactus_potato'
];

test('green thumb: taking the relic puts one of every potion secondary in the bank', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.debugproc('relic_grant', RELIC).tick(3);
    bot.expectMessage('You gained the relic: Green Thumb.');
    for (const obj of STARTER) assert.equal(bot.count(obj, 'bank'), 1, obj);
    assert.equal(bot.items().length, 0, 'nothing in the backpack');
    assert.equal(((bot.varp('relic_owned') as number) >>> RELIC) & 1, 1);
});

// ---------------------------------------------------------------- tasks 43, 44, 45

test('task 43: finishing a super strength potion (a strength potion does not count)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('tarrominvial').give('limpwurt_root');
    bot.useOnHeld('limpwurt_root', 'tarrominvial').tick(3);
    assert.ok(!isDone(bot, 43));
    bot.give('kwuarmvial').give('limpwurt_root');
    bot.useOnHeld('limpwurt_root', 'kwuarmvial').tick(3);
    assert.equal(bot.count('3dose2strength'), 1);
    assert.ok(isDone(bot, 43));
    bot.expectMessage('Relic task 43 complete!');
});

test('task 44: finishing an antifire potion', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('lantadymevial').give('dragon_scale_dust');
    bot.useOnHeld('dragon_scale_dust', 'lantadymevial').tick(3);
    assert.equal(bot.count('3dose1antidragon'), 1);
    assert.ok(isDone(bot, 44));
    bot.expectMessage('Relic task 44 complete!');
});

test('task 45: finishing a ranging potion', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('dwarfweedvial').give('wine_of_zamorak');
    bot.useOnHeld('wine_of_zamorak', 'dwarfweedvial').tick(3);
    assert.equal(bot.count('3doserangerspotion'), 1);
    assert.ok(isDone(bot, 45));
    bot.expectMessage('Relic task 45 complete!');
});

test('tasks 43-45 need the Herblore level of the potion (55, 69 and 72)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([], 50);
    bot.give('kwuarmvial').give('limpwurt_root');
    bot.useOnHeld('limpwurt_root', 'kwuarmvial').tick(3);
    assert.equal(bot.count('3dose2strength'), 0);
    assert.ok(!isDone(bot, 43));
});

// ---------------------------------------------------------------- the three potions work on this server (not part of the relic)

test('support: a ranging potion boosts Ranged by 4 + 10%', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('3doserangerspotion').opHeld('3doserangerspotion', 1).tick(2);
    assert.equal(bot.stat('ranged'), 50 + 4 + Math.floor(50 * 0.1));
    assert.equal(bot.count('2doserangerspotion'), 1);
});

test('support: a super strength potion boosts Strength, an antifire potion sets the dragonfire resistance timer', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker([]);
    bot.give('3dose2strength').opHeld('3dose2strength', 1).tick(2);
    assert.ok(bot.stat('strength') >= 50 + 5, `strength ${bot.stat('strength')}`);
    bot.tick(5).give('3dose1antidragon').opHeld('3dose1antidragon', 1).tick(2);
    assert.equal(bot.count('2dose1antidragon'), 1);
    const until = bot.varp('dragonresist') as number;
    assert.ok(until > 0, 'dragonresist is set');
});

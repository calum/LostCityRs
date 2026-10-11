// Relic 21 Rune Wellspring. Every XP gain adds Rune Essence Bundles (1 per 100 XP gained, runecrafting XP excluded),
// a bundle used on an altar crafts 100 rune essence into runes at once, and a talisman's Locate op opens an altar list
// that teleports into the temple. Mod code: mods/relics/scripts/relic_wellspring.rs2, mods/relics/interfaces/relic_altarmenu.if,
// engine hook Player.addXp and Content runecraft.rs2 hooks (docs/local-changes.md). Design: docs/design/relics-wellspring.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import Environment from '../Engine-TS/src/util/Environment.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_wellspring_xp') ? false : 'relic mod not loaded');

const RELIC = 21;
const BUNDLE = 'relic_essence_bundle';
const AIR_TEMPLE = { x: 2841, z: 4830, level: 0 }; // runecraft_air enter_coord 0_44_75_25_30
const MIND_TEMPLE = { x: 2793, z: 4829, level: 0 }; // runecraft_mind enter_coord 0_43_75_41_29

/** Real XP (not tenths) as the player sees it after the engine rate: addXp takes tenths and multiplies by xpRate * factor. */
const xpRate = () => Environment.node.xpRate;

/** Gain `xp` real XP in a stat, as a script's stat_advance does (tenths). The XP rate and relic factor apply on top. */
function gain(bot: Bot, stat: string, xp: number) {
    bot.player.addXp(ids.stat(stat), xp * 10);
}

function owner(): Bot {
    const bot = Bot.spawn();
    bot.setVar('relic_owned', 1 << RELIC);
    bot.setVar('relic_xp_factor', 1);
    return bot;
}

const near = (bot: Bot, c: { x: number; z: number; level: number }, r = 3) => Math.abs(bot.x - c.x) <= r && Math.abs(bot.z - c.z) <= r && bot.level === c.level;

test('wellspring control: without the relic XP gives no bundles', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    gain(bot, 'mining', 1000);
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 0);
    assert.equal(bot.count(BUNDLE, 'bank'), 0);
});

test('wellspring: 1 bundle per 100 XP gained (after the XP rate), straight into the backpack', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    // 10 real XP base becomes 10 * xpRate; pick a base so the displayed gain is exactly 300 XP
    gain(bot, 'mining', 300 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 3);
});

test('wellspring: the remainder carries over to the next gain', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    gain(bot, 'woodcutting', 60 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 0);
    gain(bot, 'fishing', 60 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 1);
    gain(bot, 'fishing', 80 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 2); // 60 + 60 + 80 = 200
});

test('wellspring: the gain is counted after the XP multiplier relic', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.setVar('relic_xp_factor', 3);
    gain(bot, 'mining', 100 / xpRate()); // 100 base-rate XP becomes 300
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 3);
});

test('wellspring: runecrafting XP gives no bundles (otherwise crafting bundles would feed itself)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    gain(bot, 'runecraft', 1000 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 0);
    assert.equal(bot.varp('relic_wellspring_xp'), 0);
});

test('wellspring: a full backpack sends the bundles to the bank', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.clearInv().give('bronze_dagger', 28);
    gain(bot, 'mining', 200 / xpRate());
    bot.tick(3);
    assert.equal(bot.count(BUNDLE), 0);
    assert.equal(bot.count(BUNDLE, 'bank'), 2);
});

test('wellspring: bundles stack in one slot', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.clearInv();
    gain(bot, 'mining', 500 / xpRate());
    bot.tick(3);
    gain(bot, 'mining', 500 / xpRate());
    bot.tick(3);
    assert.equal(bot.items().filter(i => i.obj === BUNDLE).length, 1);
    assert.equal(bot.count(BUNDLE), 10);
});

test('wellspring: the owed XP is kept across a relog and paid out', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    gain(bot, 'mining', 70 / xpRate());
    bot.tick(3);
    const again = bot.relog();
    gain(again, 'mining', 70 / xpRate());
    again.tick(3);
    assert.equal(again.count(BUNDLE), 1);
});

test('wellspring: a bundle used on an altar crafts 100 rune essence per bundle at once, with the normal runecrafting XP', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.clearInv().give(BUNDLE, 2);
    bot.setLevel('runecraft', 22); // runecraft_air multiplier 11: 22 / 11 + 1 = 3 runes per essence
    bot.teleport(AIR_TEMPLE).tick(2);
    const xp0 = bot.xp('runecraft');
    bot.useOnLoc(BUNDLE, bot.findLoc('air_altar'));
    bot.waitUntil(() => bot.count(BUNDLE) === 0, 40, 'bundles used');
    assert.equal(bot.count('airrune'), 600); // 2 bundles * 100 essence * 3
    // runecraft_air experience 50 (tenths) per essence, times the engine rate and relic factor
    assert.equal(bot.xp('runecraft') - xp0, 200 * 50 * xpRate() * 1);
    bot.tick(5);
    assert.equal(bot.count(BUNDLE), 0, 'crafting does not pay out new bundles');
});

test('wellspring: bundles need the altar level like normal essence', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.clearInv().give(BUNDLE, 1);
    bot.setLevel('runecraft', 1);
    // the mind altar needs level 2 (runecraft_mind level)
    bot.teleport(MIND_TEMPLE).tick(2);
    bot.useOnLoc(BUNDLE, bot.findLoc('mind_altar'));
    bot.waitUntil(() => bot.chatModal !== null, 40, 'level message box');
    assert.equal(bot.count(BUNDLE), 1);
    assert.equal(bot.count('mindrune'), 0);
});

test('wellspring: a talisman Locate opens the altar list, a row teleports into that temple', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.give('fire_talisman');
    bot.opHeld('fire_talisman', 4);
    bot.waitUntil(() => bot.mainModal === 'relic_altarmenu', 10, 'altar menu');
    assert.match(bot.texts.get('relic_altarmenu:row_1') ?? '', /Air/);
    assert.match(bot.texts.get('relic_altarmenu:row_2') ?? '', /Mind/);
    bot.clickButton('relic_altarmenu:row_2');
    bot.waitUntil(() => near(bot, MIND_TEMPLE), 20, 'teleport to the mind temple');
    assert.equal(bot.mainModal, null);
});

test('wellspring control: without the relic a talisman still only locates', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.give('air_talisman');
    bot.opHeld('air_talisman', 4);
    bot.tick(3);
    assert.notEqual(bot.mainModal, 'relic_altarmenu');
});

test('wellspring: the first row of the list is the air temple', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = owner();
    bot.give('air_talisman');
    bot.opHeld('air_talisman', 4);
    bot.waitUntil(() => bot.mainModal === 'relic_altarmenu', 10, 'altar menu');
    bot.clickButton('relic_altarmenu:row_1');
    bot.waitUntil(() => near(bot, AIR_TEMPLE), 20, 'teleport to the air temple');
});

test('wellspring: taking the relic gives a talisman whose option opens the altar list at once', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', RELIC).tick(2);
    assert.equal(bot.count('relic_wellspring_talisman'), 1);
    bot.opHeld('relic_wellspring_talisman', 1);
    bot.waitUntil(() => bot.mainModal === 'relic_altarmenu', 10, 'altar menu');
    bot.clickButton('relic_altarmenu:row_1');
    bot.waitUntil(() => near(bot, AIR_TEMPLE), 20, 'teleport to the air temple');
});

test('wellspring: the Relic Keeper replaces a lost talisman', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', RELIC).tick(2);
    bot.clearInv();
    bot.teleport({ x: 3222, z: 3218, level: 0 }).tick(2);
    bot.opNpc(bot.findNpc('relic_keeper', 20), 1);
    bot.waitUntil(() => bot.inDialog, 30, 'the keeper to talk');
    bot.skipDialog();
    bot.waitUntilIdle(10);
    assert.equal(bot.count('relic_wellspring_talisman'), 1);
});

// Relic 20 Green Thumb: every herb put in the bank (grimy or clean) pays the Herblore XP of cleaning it, through the normal XP path.
// Mod code: mods/relics/scripts/relic_herblore.rs2 (~relic_bank_herbs); hook: Content interface_bank/scripts/bank.rs2 [proc,bank_deposit_request].
// Design: docs/design/relics-green-thumb.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import Environment from '../Engine-TS/src/util/Environment.js';
import InvButton from '../Engine-TS/src/network/game/client/model/InvButton.js';
import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');
const RELIC = 20;

/** A bot with the bank open, optionally owning relic 20 (and XP Multiplier tier `xpTier` bits already in relic_owned by the caller). */
function banker(owned: number): Bot {
    const bot = Bot.spawn({ levels: { herblore: 1 } });
    bot.clearInv();
    bot.setVar('relic_tasks_done', 0x7fffffff);
    bot.setVar('relic_tasks_done2', 0x7fffffff);
    bot.setVar('relic_owned', owned);
    bot.give('relic_banker_stone').opHeld('relic_banker_stone', 1).tick(2);
    assert.equal(bot.mainModal, 'bank_main');
    bot.clearInv();
    return bot;
}

/** Click "deposit" (op 1 = one, 2 = five, 3 = ten, 4 = all) on the first backpack slot holding `obj` in the bank side panel. */
function deposit(bot: Bot, obj: string, op: number) {
    const id = ids.obj(obj);
    bot.player.send('INV_BUTTON' + op, ClientGameProt['INV_BUTTON' + op as 'INV_BUTTON1'], new InvButton(op, id, 0, ids.com('bank_side:inv')));
    bot.tick(2);
}

/** Herblore XP in tenths that one cleaned herb pays at the engine rate, from identified_herb_exp (herbs.obj). */
const perHerb = (tenths: number) => tenths * Environment.node.xpRate;

test('green thumb bank: without the relic banking a herb pays no XP', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(0);
    bot.give('unidentified_guam', 3);
    deposit(bot, 'unidentified_guam', 4);
    assert.equal(bot.count('unidentified_guam', 'bank'), 3);
    assert.equal(bot.xp('herblore'), 0);
});

test('green thumb bank: a grimy herb banked pays the XP of cleaning it', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.give('unidentified_ranarr', 1);
    deposit(bot, 'unidentified_ranarr', 1);
    assert.equal(bot.count('unidentified_ranarr', 'bank'), 1);
    assert.equal(bot.xp('herblore'), perHerb(75)); // identified_herb_exp for ranarr_weed is 75 (7.5 XP)
});

test('green thumb bank: a clean herb banked pays the same XP', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.give('ranarr_weed', 1);
    deposit(bot, 'ranarr_weed', 1);
    assert.equal(bot.xp('herblore'), perHerb(75));
});

test('green thumb bank: a stack counts each herb', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.give('kwuarm', 10);
    deposit(bot, 'kwuarm', 4);
    assert.equal(bot.count('kwuarm', 'bank'), 10);
    assert.equal(bot.xp('herblore'), perHerb(113 * 10));
});

test('green thumb bank: only what was banked counts (deposit five of ten)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.give('kwuarm', 10);
    deposit(bot, 'kwuarm', 2);
    assert.equal(bot.count('kwuarm', 'bank'), 5);
    assert.equal(bot.xp('herblore'), perHerb(113 * 5));
});

test('green thumb bank: other items pay nothing', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.give('limpwurt_root', 4);
    deposit(bot, 'limpwurt_root', 4);
    assert.equal(bot.count('limpwurt_root', 'bank'), 4);
    assert.equal(bot.xp('herblore'), 0);
});

test('green thumb bank: the XP goes through the normal XP path, so the XP Multiplier applies', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = banker(1 << RELIC);
    bot.setVar('relic_xp_factor', 3); // XP Multiplier tier 1 (relic_state.rs2)
    const factor = bot.varp('relic_xp_factor') as number;
    assert.ok(factor > 1, `xp factor ${factor}`);
    bot.give('guam_leaf', 2);
    deposit(bot, 'guam_leaf', 4);
    assert.equal(bot.xp('herblore'), perHerb(25 * 2) * factor);
});

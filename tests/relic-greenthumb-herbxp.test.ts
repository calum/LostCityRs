// Relic 20 Green Thumb: every herb the relic pays out (XP -> herbs, mods/relics/scripts/relic_herblore.rs2 ~relic_herbs_claim) also grants
// the Herblore XP of cleaning that herb, through the normal XP path. Design: docs/design/relics-green-thumb.md section 5.
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

/** identified_herb_exp (tenths of XP, herbs.obj) of the eleven herbs the relic pays. */
const CLEAN_XP: Record<string, number> = {
    guam_leaf: 25, marentill: 38, tarromin: 50, harralander: 63, ranarr_weed: 75, irit_leaf: 88,
    avantoe: 100, kwuarm: 113, cadantine: 125, lantadyme: 131, dwarf_weed: 138
};

function maker(owned: number, herblore = 99): Bot {
    const bot = Bot.spawn({ levels: { herblore } });
    bot.clearInv();
    bot.setVar('relic_tasks_done', 0x7fffffff);
    bot.setVar('relic_tasks_done2', 0x7fffffff);
    bot.setVar('relic_owned', owned);
    START.set(bot, bot.xp('herblore'));
    return bot;
}

/** Herblore XP gained since the bot was made (a level-99 bot starts with the XP of level 99). */
const START = new WeakMap<Bot, number>();
const gained = (bot: Bot) => bot.xp('herblore') - (START.get(bot) ?? 0);

/** 500 raw XP is one herb; XP is stored in tenths. */
function gain(bot: Bot, xp: number) {
    bot.player.addXp(ids.stat('mining'), xp * 10);
    bot.tick(3);
}

/** Herblore XP the herbs in the bank should have paid, at the engine rate. */
function expected(bot: Bot): { herbs: number; xp: number } {
    let herbs = 0;
    let xp = 0;
    for (const [herb, exp] of Object.entries(CLEAN_XP)) {
        const n = bot.count(herb, 'bank');
        herbs += n;
        xp += n * exp * Environment.node.xpRate;
    }
    return { herbs, xp };
}

test('green thumb herb xp: without the relic nothing pays Herblore XP', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker(0);
    gain(bot, 5000);
    assert.equal(gained(bot), 0);
});

test('green thumb herb xp: each herb paid also grants the Herblore XP of cleaning it', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker(1 << RELIC);
    gain(bot, 500 * 20);
    const { herbs, xp } = expected(bot);
    assert.equal(herbs, 20);
    assert.ok(xp > 0);
    assert.equal(gained(bot), xp);
});

test('green thumb herb xp: banking a herb by hand pays nothing (the XP is on the relic trigger)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker(1 << RELIC);
    bot.give('ranarr_weed', 3).give('relic_banker_stone').opHeld('relic_banker_stone', 1).tick(2);
    assert.equal(bot.mainModal, 'bank_main');
    bot.clearInv().give('ranarr_weed', 3);
    const id = ids.obj('ranarr_weed');
    bot.player.send('INV_BUTTON4', ClientGameProt.INV_BUTTON4, new InvButton(4, id, 0, ids.com('bank_side:inv')));
    bot.tick(2);
    assert.equal(bot.count('ranarr_weed', 'bank'), 3);
    assert.equal(gained(bot), 0);
});

test('green thumb herb xp: the XP Multiplier applies to it', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker(1 << RELIC);
    bot.setVar('relic_xp_factor', 3);
    gain(bot, 500 * 10);
    const { xp } = expected(bot);
    assert.equal(gained(bot), xp * 3);
});

test('green thumb herb xp: herb XP does not itself pay herbs (Herblore is excluded)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = maker(1 << RELIC);
    gain(bot, 500);
    bot.tick(10);
    assert.equal(expected(bot).herbs, 1);
});

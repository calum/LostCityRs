// Relic 19 Hoarder: a scrollable widget with the whole list of earlier declined relics (not a 3-option dialogue), and the
// offer that granted Hoarder is not part of that list. Design: docs/design/relics-hoarder.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { existingRelicIds } from './relic-helpers.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');
const bit = (id: number) => 1 << id;
const ALL_BITS = existingRelicIds().filter(id => id >= 2).reduce((m, id) => m | (1 << id), 0);
const ownedExcept = (...ids: number[]) => ids.reduce((m, id) => m & ~bit(id), ALL_BITS);
const mask = (...ids: number[]) => ids.reduce((m, id) => m | bit(id), 0);

const rows = (bot: Bot) =>
    Array.from({ length: 30 }, (_, i) => bot.texts.get(`relic_hoardermenu:row_${i + 1}`) ?? '').filter(r => r !== '');

const NAMES: Record<number, string> = { 5: 'Glass Cannon', 6: 'Phoenix', 7: 'Vampire', 8: 'Executioner', 9: 'Bounty', 10: 'Eternal Vein', 11: 'Evergreen', 12: 'Double Yield' };
const EARLIER = [5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Earlier declined relics 5..12 are still eligible, so they are drawn in the offer too. Pool = {19} + EARLIER (everything else owned).
 * Try seeds until the offer contains Hoarder, take it, and return the bot with the ids of the two other relics of that offer.
 */
function takeHoarder(): { bot: Bot; justOffered: number[] } {
    for (let seed = 1; seed < 200; seed++) {
        const bot = Bot.spawn({
            varps: { relic_started: 1, relic_seed: seed, relic_xp_tier: 3, relic_xp_factor: 27, relic_owned: ownedExcept(19, ...EARLIER), relic_declined: mask(...EARLIER) }
        });
        bot.debugproc('relic_offer');
        bot.waitUntil(() => bot.inDialog && bot.choices.length >= 2, 10, 'the offer');
        const names = bot.choices.map(c => c.split(':')[0]);
        if (!names.includes('Hoarder')) {
            bot.remove();
            continue;
        }
        const justOffered = EARLIER.filter(id => names.includes(NAMES[id]));
        bot.choose('Hoarder');
        bot.tick(5);
        return { bot, justOffered };
    }
    throw new Error('no seed offers Hoarder');
}

test('Hoarder opens a widget listing every earlier declined relic, not just three', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, justOffered } = takeHoarder();
    assert.equal(bot.mainModal, 'relic_hoardermenu', bot.describe());
    const shown = rows(bot);
    assert.equal(shown.length, EARLIER.length - justOffered.length, JSON.stringify(shown));
    assert.ok(shown.length > 3, 'more than the three options of a dialogue');
});

test('relics from the offer that granted Hoarder are not in the list', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, justOffered } = takeHoarder();
    const text = rows(bot).join('|');
    for (const id of justOffered) assert.ok(!text.includes(NAMES[id]), `${NAMES[id]} was in the offer just closed: ${text}`);
    for (const id of EARLIER.filter(i => !justOffered.includes(i))) assert.ok(text.includes(NAMES[id]), `${NAMES[id]} missing: ${text}`);
    // the just-offered ones are still declined (they can come up again)
    assert.equal(Number(bot.varp('relic_declined')) & mask(...justOffered), mask(...justOffered));
});

test('clicking a row grants that relic, clears its declined bit and closes the widget', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, justOffered } = takeHoarder();
    const listed = EARLIER.filter(i => !justOffered.includes(i)); // rows are in relic id order
    bot.clickButton('relic_hoardermenu:row_2').tick(2);
    const id = listed[1];
    bot.expectMessage(`You gained the relic: ${NAMES[id]}.`);
    assert.equal(bot.mainModal, null);
    assert.equal(bot.varp('relic_hoarder_owed'), 0);
    assert.equal(Number(bot.varp('relic_owned')) & bit(id), bit(id));
    assert.equal(Number(bot.varp('relic_declined')) & bit(id), 0);
});

test('closing the widget keeps the pick owed; a relog opens it again', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, justOffered } = takeHoarder();
    bot.closeModal().tick();
    assert.equal(bot.varp('relic_hoarder_owed'), 1);
    const again = bot.relog();
    again.tick(10);
    assert.equal(again.mainModal, 'relic_hoardermenu');
    assert.equal(rows(again).length, EARLIER.length - justOffered.length);
});

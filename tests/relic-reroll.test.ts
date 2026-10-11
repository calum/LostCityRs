// Relic rerolls: every account starts with 1, one more per 10 tasks done (relic_offer.rs2 relic_rerolls_left).
// A "Reroll" option is the last choice of an offer while rerolls are left; it replaces the three relics with new ones.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

const relicNames = (choices: string[]) => choices.filter(c => !/^Reroll/.test(c)).map(c => c.split(':')[0]);

function waitForOffer(bot: Bot) {
    bot.waitUntil(() => bot.inDialog && bot.choices.length >= 2, 10, 'a relic offer');
}

/** A plain relic the offer can grant without opening a follow-up dialogue (not Quest Pass, not Hoarder). */
function plainIndex(bot: Bot): number {
    return bot.choices.findIndex(c => !/^(Reroll|Hoarder|Quest Pass)/.test(c)) + 1;
}

test('a fresh account sees a fourth option: Reroll (1 left)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_seed: 5 } });
    waitForOffer(bot);
    assert.equal(bot.choices.length, 4);
    assert.equal(bot.choices[3], 'Reroll (1 left)');
});

test('choosing Reroll shows three other relics, spends the reroll and counts the old ones as declined', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_seed: 5 } });
    waitForOffer(bot);
    const first = relicNames(bot.choices);
    assert.equal(first.length, 3);

    bot.choose(4);
    bot.waitUntil(() => bot.choices.length >= 2 && relicNames(bot.choices).join() !== first.join(), 10, 'the rerolled offer');
    const second = relicNames(bot.choices);
    assert.equal(bot.varp('relic_rerolls_used'), 1);
    assert.equal(second.length, 3);
    assert.deepEqual(second.filter(n => first.includes(n)), [], 'no relic comes back');
    assert.equal(bot.choices.length, 3, 'no reroll left, so no Reroll option');
    assert.equal(bot.varp('relic_pending'), 1, 'still one offer owed');
    assert.notEqual(bot.varp('relic_declined'), 0, 'the three rerolled-away relics are declined');

    const take = plainIndex(bot);
    assert.ok(take > 0);
    const name = second[take - 1];
    bot.choose(take);
    bot.waitForMessage(`You gained the relic: ${name}.`, 10);
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.varp('relic_rerolls_used'), 1);
});

test('no reroll left: the offer has three options and no Reroll', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_seed: 5, relic_rerolls_used: 1 } });
    waitForOffer(bot);
    assert.equal(bot.choices.length, 3);
    assert.ok(!bot.choices.some(c => /^Reroll/.test(c)));
});

test('existing characters: 1 + one per 10 tasks already done (20 tasks = 3 rerolls)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_pending: 1, relic_seed: 5, relic_tasks_done: 0xfffff } });
    waitForOffer(bot);
    assert.equal(bot.choices[3], 'Reroll (3 left)');
    assert.equal(bot.call('relic_rerolls_left').popInt(), 3);
});

test('rerolls stack: spend two in a row, the third offer has one left', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_pending: 1, relic_seed: 5, relic_tasks_done: 0xfffff } });
    waitForOffer(bot);
    const a = relicNames(bot.choices);
    bot.choose(4);
    bot.waitUntil(() => bot.choices.length >= 2 && relicNames(bot.choices).join() !== a.join(), 10, 'second offer');
    assert.equal(bot.choices[3], 'Reroll (2 left)');
    const b = relicNames(bot.choices);
    bot.choose(4);
    bot.waitUntil(() => bot.choices.length >= 2 && relicNames(bot.choices).join() !== b.join(), 10, 'third offer');
    assert.equal(bot.choices[3], 'Reroll (1 left)');
    assert.equal(bot.varp('relic_rerolls_used'), 2);
    const c = relicNames(bot.choices);
    assert.deepEqual([...a, ...b].filter(n => c.includes(n)), [], 'nothing repeats while the pool lasts');
});

test('completing the 10th task announces a new reroll', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: 0x1ff } }); // tasks 1-9 done
    bot.call('[debugproc,relic_task]', 10);
    bot.waitForMessage('Relic task 10 complete!', 10);
    bot.expectMessage(/You earned a relic reroll \(2 available\)/);
});

test('the 9th task does not announce a reroll', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: 0xff } });
    bot.call('[debugproc,relic_task]', 9);
    bot.waitForMessage('Relic task 9 complete!', 10);
    assert.ok(!bot.messages.some(m => /relic reroll/.test(m)));
});

test('the 7th task no longer announces a reroll (one per 10 tasks)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: 0x3f } });
    bot.call('[debugproc,relic_task]', 7);
    bot.waitForMessage('Relic task 7 complete!', 10);
    assert.ok(!bot.messages.some(m => /relic reroll/.test(m)));
});

test('the 40th task done announces the fifth reroll (1 + 40 / 10)', t => {
    if (skip()) return t.skip(String(skip()));
    // tasks 1-31 in relic_tasks_done, 32-39 in relic_tasks_done2 (bits 0-7): 39 done
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: 0x7fffffff, relic_tasks_done2: 0xff } });
    bot.call('[debugproc,relic_task]', 40);
    bot.waitForMessage('Relic task 40 complete!', 10);
    bot.expectMessage(/You earned a relic reroll \(5 available\)/);
});

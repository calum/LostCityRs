// Special offers by tasks done (relic_offer.rs2, [queue,relic_task_done]): the 10th task done grants Quest Pass directly.
// The XP Multiplier is passive (Calum, 2026-10-13): tier I unlocks at the 5th task done, II at the 10th, III at the 15th,
// on top of the normal offer (3 relics at 5 and 15, Quest Pass at 10). It is never in an offer. Task 16 (monkey) was retired and no longer counts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');
const SEEDS = [5, 6, 1234, 40000, 777, 9999];
const hasXp = (b: Bot) => b.choices.some(c => c.startsWith('XP Multiplier'));
const names = (b: Bot) => b.choices.map(c => c.split(':')[0]);
const doTask = (b: Bot, n: number) => b.call('[debugproc,relic_task]', n);
const waitOffer = (b: Bot) => b.waitUntil(() => b.inDialog && b.choices.length >= 2, 20, 'a relic offer');
const spawnAt = (done: number, seed: number, extra: Record<string, number> = {}) =>
    Bot.spawn({ varps: { relic_started: 1, relic_seed: seed, relic_tasks_done: done, ...extra } });
const tier = (b: Bot) => b.varp('relic_xp_tier') as number;

test('the 5th task done unlocks XP Multiplier I on top of an ordinary offer of three', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0xf, seed); // 4 tasks done
        assert.equal(tier(bot), 0);
        doTask(bot, 5);
        waitOffer(bot);
        assert.equal(names(bot).length, 3, `seed ${seed}: ${JSON.stringify(bot.choices)}`);
        assert.ok(!hasXp(bot), 'the multiplier is not an offer choice');
        assert.equal(tier(bot), 1);
        assert.equal(bot.varp('relic_xp_factor'), 3);
        bot.expectMessage('XP Multiplier');
    }
});

test('the 4th task done offers three relics and no multiplier yet', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0x7, seed);
        doTask(bot, 4);
        waitOffer(bot);
        assert.equal(names(bot).length, 3);
        assert.ok(!hasXp(bot));
        assert.equal(tier(bot), 0);
    }
});

test('the 10th task done: Quest Pass is granted and XP Multiplier II unlocks', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5, { relic_xp_tier: 1, relic_xp_factor: 3 }); // 9 done
    doTask(bot, 10);
    bot.waitForMessage('You gained the relic: Quest Pass.', 30);
    assert.equal(tier(bot), 2);
    assert.equal(bot.varp('relic_xp_factor'), 9);
});

test('the 15th task done unlocks XP Multiplier III on top of an ordinary offer of three', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0x3fff, seed, { relic_xp_tier: 2, relic_xp_factor: 9, relic_owned: 1 << 2 }); // 14 done
        doTask(bot, 15);
        waitOffer(bot);
        assert.equal(names(bot).length, 3, `seed ${seed}: ${JSON.stringify(bot.choices)}`);
        assert.ok(!hasXp(bot));
        assert.equal(tier(bot), 3);
        assert.equal(bot.varp('relic_xp_factor'), 27);
    }
});

test('other counts do not move the tier (6th, 9th and 11th task done)', t => {
    if (skip()) return t.skip(String(skip()));
    for (const [done, task, want] of [[0x1f, 6, 1], [0xff, 9, 1], [0x3ff, 11, 2]] as const) {
        const bot = spawnAt(done, 5, { relic_xp_tier: want, relic_xp_factor: 3 ** want, relic_owned: 1 << 2 });
        doTask(bot, task);
        waitOffer(bot);
        assert.equal(tier(bot), want, `task ${task}`);
        assert.ok(!hasXp(bot));
    }
});

test('a save that already owns a higher tier keeps it (tier 3 at 6 tasks done stays 3 at the 7th)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1f + 0x20, 5, { relic_xp_tier: 3, relic_xp_factor: 27 }); // 6 done
    doTask(bot, 7);
    waitOffer(bot);
    assert.equal(tier(bot), 3);
    const five = spawnAt(0xf, 5, { relic_xp_tier: 3, relic_xp_factor: 27 }); // 4 done, 5th lowers nothing
    doTask(five, 5);
    waitOffer(five);
    assert.equal(tier(five), 3);
    assert.equal(five.varp('relic_xp_factor'), 27);
});

test('relog catches a tier the tasks already earned (12 tasks done, tier 0 -> tier 2)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0, 5, { relic_owned: 1 << 2 });
    bot.setVar('relic_tasks_done', 0xfff); // 12 done, as an older save that took no multiplier from the offers
    assert.equal(tier(bot), 0);
    const again = bot.relog();
    again.tick(5);
    assert.equal(tier(again), 2);
    assert.equal(again.varp('relic_xp_factor'), 9);
});

test('the retired monkey task does not count towards the unlocks', t => {
    if (skip()) return t.skip(String(skip()));
    // tasks 1-4 and the monkey (16, bit 15) are done: 4 count. Task 5 makes 5 counted tasks: unlock.
    const bot = spawnAt(0xf | (1 << 15), 5);
    doTask(bot, 5);
    waitOffer(bot);
    assert.equal(tier(bot), 1);
    const lag = spawnAt(0x7 | (1 << 15), 5); // 3 counted + monkey
    doTask(lag, 4); // 4 counted, not 5 (the raw bit count would be 5)
    waitOffer(lag);
    assert.equal(tier(lag), 0);
});

test('killing a monkey no longer completes a task', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0, 5);
    bot.debugproc('relic_kill', 'monkey');
    bot.tick(8);
    assert.equal(((bot.varp('relic_tasks_done') as number) >>> 15) & 1, 0);
});

test('the 4th-task offer is the same after closing it and relogging', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x7, 6);
    doTask(bot, 4);
    waitOffer(bot);
    const first = [...bot.choices];
    bot.closeModal().tick(3);
    const again = bot.relog();
    waitOffer(again);
    assert.deepEqual(again.choices, first);
});

test('the 10th task done grants Quest Pass directly, with no choice', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5); // 9 tasks done
    doTask(bot, 10);
    bot.waitForMessage('You gained the relic: Quest Pass.', 30);
    assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 1);
    bot.waitUntil(() => bot.inDialog, 20, 'the Quest Pass scroll hint');
    assert.match(bot.dialogText, /Quest Pass scroll/, 'the hint explains the scroll');
    assert.equal(bot.count('relic_quest_scroll'), 1);
    bot.continueDialog();
    assert.equal(bot.varp('relic_pending'), 0);
    assert.ok(!bot.choices.some(c => /: /.test(c) && !/Quest/.test(c)), 'no relic choice was shown');
});

test('the 10th task done with Quest Pass already owned: an ordinary offer, no multiplier choice, tier II still unlocks', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5, { relic_owned: 1 << 2 });
    doTask(bot, 10);
    waitOffer(bot);
    assert.ok(!hasXp(bot));
    assert.equal(tier(bot), 2);
});

test('Quest Pass is never in an ordinary offer (30 seeds, first-login offers)', t => {
    if (skip()) return t.skip(String(skip()));
    for (let seed = 1; seed <= 30; seed++) {
        const bot = Bot.spawn({ varps: { relic_seed: seed * 2111 } });
        waitOffer(bot);
        assert.ok(!bot.choices.some(c => c.startsWith('Quest Pass')), `seed ${seed * 2111}: ${JSON.stringify(bot.choices)}`);
    }
});

test('the 9th and 11th task done do not grant Quest Pass', t => {
    if (skip()) return t.skip(String(skip()));
    for (const [done, task] of [[0xff, 9], [0x3ff, 11]]) {
        const bot = spawnAt(done, 5);
        doTask(bot, task);
        waitOffer(bot);
        assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 0);
        assert.ok(!bot.choices.some(c => c.startsWith('Quest Pass')));
    }
});

test('the 20th task done does not grant Quest Pass (only the 10th does)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x7ffff, 5); // 19 done
    doTask(bot, 20);
    waitOffer(bot);
    assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 0);
    assert.ok(!hasXp(bot));
});

test('the 10th task done grants Quest Pass even when that task is a final boss (no other offer)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5); // 9 done (tasks 1-9)
    doTask(bot, 24);
    bot.waitForMessage('You gained the relic: Quest Pass.', 30);
    assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 1);
});

test('closing the Quest Pass hint does not leave an offer pending: no extra relic choice after a relog', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5); // 9 done
    doTask(bot, 10);
    bot.waitForMessage('You gained the relic: Quest Pass.', 30);
    bot.waitUntil(() => bot.inDialog, 20, 'the Quest Pass scroll hint');
    bot.closeModal().tick(3);
    assert.equal(bot.varp('relic_pending'), 0, 'pending cleared before the hint');
    assert.equal(bot.count('relic_quest_scroll'), 1);
    const again = bot.relog();
    again.tick(10);
    assert.equal(again.inDialog, false, 'no offer after the relog');
    assert.equal(again.count('relic_quest_scroll'), 1);
});

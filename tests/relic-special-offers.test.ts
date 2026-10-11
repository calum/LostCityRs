// Special offers by tasks done (relic_offer.rs2, [queue,relic_task_done]): the 10th task done grants Quest Pass directly,
// every 5th task done guarantees an XP Multiplier option (while the tier is below 3).
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

test('the 5th task done always offers the XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0xf, seed); // 4 tasks done
        doTask(bot, 5);
        waitOffer(bot);
        assert.ok(hasXp(bot), `seed ${seed}: ${JSON.stringify(bot.choices)}`);
        assert.equal(names(bot).length, 3);
    }
});

test('other tasks do not guarantee it (4th and 6th task done)', t => {
    if (skip()) return t.skip(String(skip()));
    const offers = [] as boolean[];
    for (const [done, task] of [[0x7, 4], [0x1f, 6]]) {
        for (const seed of SEEDS) {
            const bot = spawnAt(done, seed);
            doTask(bot, task);
            waitOffer(bot);
            offers.push(hasXp(bot));
        }
    }
    assert.ok(offers.includes(false), 'XP Multiplier is not in every ordinary offer');
});

test('XP Multiplier already at tier 3: the 5th task offer is an ordinary three', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0xf, 5, { relic_xp_tier: 3, relic_xp_factor: 27 });
    doTask(bot, 5);
    waitOffer(bot);
    assert.ok(!hasXp(bot));
    assert.equal(names(bot).length, 3);
});

test('the 5th-task offer is the same after closing it and relogging', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0xf, 6);
    doTask(bot, 5);
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
    assert.equal(bot.varp('relic_pending'), 0);
    assert.ok(!bot.choices.some(c => /: /.test(c) && !/Quest/.test(c)), 'no relic choice was shown');
});

test('the 10th task done with Quest Pass already owned: an ordinary offer that guarantees the XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5, { relic_owned: 1 << 2 });
    doTask(bot, 10);
    waitOffer(bot);
    assert.ok(hasXp(bot));
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

test('the 20th task done does not grant Quest Pass (only the 10th does); it guarantees the XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x7ffff, 5); // 19 done
    doTask(bot, 20);
    waitOffer(bot);
    assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 0);
    assert.ok(hasXp(bot));
});

test('the 10th task done grants Quest Pass even when that task is a final boss (no other offer)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawnAt(0x1ff, 5); // 9 done (tasks 1-9)
    doTask(bot, 24);
    bot.waitForMessage('You gained the relic: Quest Pass.', 30);
    assert.equal(((bot.varp('relic_owned') as number) >> 2) & 1, 1);
});

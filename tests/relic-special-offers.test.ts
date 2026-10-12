// Special offers by tasks done (relic_offer.rs2, [queue,relic_task_done]): the 10th task done grants Quest Pass directly,
// XP Multiplier I is guaranteed in every offer from the 4th task done until picked, II from the 9th, III from the 12th.
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

// XP Multiplier guarantee (Calum, 2026-10-12): tier I is in every offer from the 4th task done until picked, tier II from the 9th,
// tier III from the 12th. "task N" = N tasks done.
test('the 4th task done always offers XP Multiplier I', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0x7, seed); // 3 tasks done
        doTask(bot, 4);
        waitOffer(bot);
        assert.ok(hasXp(bot), `seed ${seed}: ${JSON.stringify(bot.choices)}`);
        assert.equal(names(bot).length, 3);
    }
});

test('XP Multiplier I is still guaranteed on later offers while it is not picked (5th and 8th task done)', t => {
    if (skip()) return t.skip(String(skip()));
    for (const [done, task] of [[0xf, 5], [0x7f, 8]]) {
        for (const seed of SEEDS) {
            const bot = spawnAt(done, seed);
            doTask(bot, task);
            waitOffer(bot);
            assert.ok(hasXp(bot), `task ${task} seed ${seed}: ${JSON.stringify(bot.choices)}`);
        }
    }
});

test('before the 4th task done and once tier I is owned, it is not guaranteed (3rd task; 5th task with tier 1)', t => {
    if (skip()) return t.skip(String(skip()));
    const offers = [] as boolean[];
    for (const [done, task, extra] of [[0x3, 3, {}], [0xf, 5, { relic_xp_tier: 1, relic_xp_factor: 3 }]] as const) {
        for (const seed of SEEDS) {
            const bot = spawnAt(done, seed, extra);
            doTask(bot, task);
            waitOffer(bot);
            offers.push(hasXp(bot));
        }
    }
    assert.ok(offers.includes(false), 'XP Multiplier is not in every ordinary offer');
    assert.equal(offers.filter(x => !x).length >= 4, true);
});

test('the 9th task done always offers XP Multiplier II (tier I owned) and still tier I when it is not owned', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const owned = spawnAt(0xff, seed, { relic_xp_tier: 1, relic_xp_factor: 3 }); // 8 done
        doTask(owned, 9);
        waitOffer(owned);
        assert.ok(hasXp(owned), `tier 1, seed ${seed}: ${JSON.stringify(owned.choices)}`);
        const none = spawnAt(0xff, seed);
        doTask(none, 9);
        waitOffer(none);
        assert.ok(hasXp(none), `tier 0, seed ${seed}: ${JSON.stringify(none.choices)}`);
    }
});

test('the 12th task done always offers XP Multiplier III while tier 3 is not owned; at tier 3 it is an ordinary three', t => {
    if (skip()) return t.skip(String(skip()));
    for (const seed of SEEDS) {
        const bot = spawnAt(0x7ff, seed, { relic_xp_tier: 2, relic_xp_factor: 9, relic_owned: 1 << 2 }); // 11 done, Quest Pass owned
        doTask(bot, 12);
        waitOffer(bot);
        assert.ok(hasXp(bot), `seed ${seed}: ${JSON.stringify(bot.choices)}`);
    }
    const full = spawnAt(0x7ff, 5, { relic_xp_tier: 3, relic_xp_factor: 27, relic_owned: 1 << 2 });
    doTask(full, 12);
    waitOffer(full);
    assert.ok(!hasXp(full));
    assert.equal(names(full).length, 3);
});

test('tier II is not forced before the 9th task done (8th task with tier I owned)', t => {
    if (skip()) return t.skip(String(skip()));
    const offers = SEEDS.map(seed => {
        const bot = spawnAt(0x7f, seed, { relic_xp_tier: 1, relic_xp_factor: 3 });
        doTask(bot, 8);
        waitOffer(bot);
        return hasXp(bot);
    });
    assert.ok(offers.includes(false));
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

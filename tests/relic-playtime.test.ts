// Play time in relic mode (mods/relics/scripts/relic_playtime.rs2): a per-character count of logged-in ticks, shown in the Relics menu,
// and the time at which the final challenge (both final bosses, tasks 24 and 25) was completed.
// Design notes: docs/design/relics-playtime.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_playticks') ? false : 'relic playtime varp not loaded');

const ticks = (bot: Bot) => bot.varp('relic_playticks') as number;
const finish = (bot: Bot) => bot.varp('relic_finish_ticks') as number;

function text(bot: Bot, com: string): string {
    const t = bot.texts.get(com);
    assert.notEqual(t, undefined, `no text was ever set on ${com}`);
    return t as string;
}

function openRelics(bot: Bot) {
    bot.clickButton('options:relic_relics').tick();
    assert.equal(bot.mainModal, 'relic_relicmenu');
}

test('playtime: a new character starts at 0 and counts one per game tick', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    const start = ticks(bot);
    assert.ok(start <= 1, `starts at (about) 0, was ${start}`);
    bot.tick(50);
    assert.equal(ticks(bot) - start, 50);
    assert.equal(finish(bot), 0, 'no finish time yet');
});

test('playtime: saved with the character and counted on from there after a relog', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_playticks: 1000 } });
    bot.tick(10);
    const before = ticks(bot);
    assert.ok(before >= 1010);
    const again = bot.relog();
    assert.ok(ticks(again) >= before && ticks(again) <= before + 2, `kept across relog: ${ticks(again)} vs ${before}`);
    again.tick(20);
    assert.ok(ticks(again) >= before + 20);
});

test('playtime: the Relics menu shows the time played as hours, minutes and seconds (1 tick = 0.6 s)', t => {
    if (skip()) return t.skip(String(skip()));
    // 6000 ticks = 3600 s = 1h; a few more ticks pass while the menu opens
    const bot = Bot.spawn({ varps: { relic_playticks: 6000 } });
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:time'), /^Time played: 1h 00m 0\ds$/);
    assert.equal(text(bot, 'relic_relicmenu:finish'), '', 'no finish line before the final challenge is done');
});

test('playtime: 125 minutes 30 s shows as 2h 05m 30s', t => {
    if (skip()) return t.skip(String(skip()));
    // 12550 ticks = 7530 s
    const bot = Bot.spawn({ varps: { relic_playticks: 12550 } });
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:time'), /^Time played: 2h 05m (30|31|32|33|34|35)s$/);
});

test('playtime: finishing the final challenge records the time, says it in chat and shows it in the menu; time keeps counting', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_playticks: 6000 } });
    bot.debugproc('relic_kill', 'king_dragon');
    bot.waitForMessage('A final boss is down. Defeat the other one to win.', 15);
    assert.equal(finish(bot), 0, 'one boss is not the finish');
    bot.debugproc('relic_kill', 'kalphite_flyingqueen');
    bot.waitForMessage('You have defeated both final bosses. You win the relic run!', 20);
    const done = finish(bot);
    assert.ok(done >= 6000 && done <= ticks(bot), `finish ${done} is the tick count at the win (now ${ticks(bot)})`);
    assert.match(bot.waitForMessage(/^Your final challenge time: 1h 00m \d\ds\.$/, 5), /1h 00m/);
    bot.waitUntil(() => bot.inDialog, 5, 'the win mesbox');
    bot.skipDialog();
    bot.tick(30);
    assert.equal(finish(bot), done, 'the finish time never changes');
    assert.ok(ticks(bot) >= done + 30, 'time played keeps counting');
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:finish'), /^Final challenge done in 1h 00m \d\ds$/);
    assert.match(text(bot, 'relic_relicmenu:time'), /^Time played: 1h 0[01]m/);
});

test('playtime: the finish time survives a relog', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_playticks: 600, relic_finish_ticks: 500 } });
    const again = bot.relog();
    assert.equal(finish(again), 500);
    openRelics(again);
    assert.match(text(again, 'relic_relicmenu:finish'), /^Final challenge done in 0h 05m 00s$/);
});

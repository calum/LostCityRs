// XP is stored in an Int32Array (tenths of a point, cap 2,000,000,000 = 200M xp). Player.addXp used to add first and cap after, so a
// gain past 2^31 wrapped to a negative value before the cap check ran: the skill dropped to level 1 (seen with a big Rune Wellspring
// craft). Fixed in Player.addXp (clamp before storing); PlayerLoading repairs saves that already hold a negative value.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

const CAP = 2_000_000_000;

test('xp overflow: a gain that would pass 2^31 stops at the cap instead of going negative', () => {
    const bot = Bot.spawn();
    const stat = ids.stat('runecraft');
    bot.player.stats[stat] = 1_900_000_000;
    bot.player.addXp(stat, 500_000_000); // x the XP rate: far past 2^31
    assert.equal(bot.player.stats[stat], CAP);
    assert.equal(bot.player.baseLevels[stat], 99);
});

test('xp overflow: a single huge gain from level 1 caps too', () => {
    const bot = Bot.spawn();
    const stat = ids.stat('mining');
    bot.player.addXp(stat, 1_000_000_000);
    assert.equal(bot.player.stats[stat], CAP);
    assert.equal(bot.player.baseLevels[stat], 99);
});

test('xp overflow: a save that already holds a negative xp value loads as the cap (it can only have wrapped past it)', () => {
    const bot = Bot.spawn();
    const stat = ids.stat('runecraft');
    bot.player.stats[stat] = -1_500_000_000;
    const again = bot.relog();
    assert.equal(again.player.stats[stat], CAP);
    assert.equal(again.baseLevel('runecraft'), 99);
});

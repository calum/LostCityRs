// Relic 31 Fellowship: everyone within 5 tiles of the owner (relic or not) gets 50% of the owner's XP gains in the same skill
// (engine hook Player.addXp -> relicFellowship) and 50% of the hitpoints the owner heals by eating (Content hook in
// consume_effect_apply -> ~relic_fellowship_heal). Several owners stack; shared XP and heals never re-share.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld(); // relic_started = 1 on every bot: no first-login offer

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

const FELLOWSHIP = 1 << 31; // relic 31 is bit 31 of %relic_owned (a negative int, as the varp is a signed 32-bit int)

// One open spot per test (Lumbridge fields), so bots from different tests never share a radius.
const SPOT = {
    grant: { x: 3200, z: 3210 },
    xp: { x: 3208, z: 3232 },
    chain: { x: 3216, z: 3240 },
    stack: { x: 3224, z: 3248 },
    level: { x: 3232, z: 3224 },
    heal: { x: 3200, z: 3250 },
    healStack: { x: 3216, z: 3256 },
    cap: { x: 3240, z: 3236 }
};

const owner = (at: { x: number; z: number; level?: number }) => Bot.spawn({ at, varps: { relic_started: 1, relic_owned: FELLOWSHIP } });
const plain = (at: { x: number; z: number; level?: number }) => Bot.spawn({ at, varps: { relic_started: 1 } });
const near = (at: { x: number; z: number }, dx: number) => ({ x: at.x + dx, z: at.z });

/** stat_advance(fletching, 1000) as the player (relic_xptest, mods/relics/scripts/relic_debug.rs2), at 10x with no XP Multiplier. */
const gainXp = (bot: Bot) => bot.debugproc('relic_xptest');
const fletch = (bot: Bot) => bot.xp('fletching');

function setHp(bot: Bot, base: number, now: number) {
    const hp = ids.stat('hitpoints');
    bot.player.baseLevels[hp] = base;
    bot.player.levels[hp] = now;
}

test('Fellowship is relic 31: it can be granted and sets bit 31 of the owned relics', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = plain(SPOT.grant);
    bot.debugproc('relic_grant', 31);
    assert.equal((bot.varp('relic_owned') as number) | 0, FELLOWSHIP);
    bot.expectMessage('You gained the relic: Fellowship.');
});

test('XP share: the owner keeps all of a gain and players within 5 tiles get half of it in the same skill', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.xp;
    const control = plain({ x: 3200, z: 3300 }); // far away: the XP a plain player gets from the same gain
    const a = owner(at);
    const close = plain(near(at, 3));
    const edge = plain(near(at, 5)); // exactly 5 tiles: inside
    const far = plain(near(at, 6)); // 6 tiles: outside
    gainXp(control);
    const gain = fletch(control);
    assert.ok(gain > 0);

    gainXp(a);
    assert.equal(fletch(a), gain, 'the owner gets the full gain');
    assert.equal(fletch(close), Math.floor(gain / 2));
    assert.equal(fletch(edge), Math.floor(gain / 2));
    assert.equal(fletch(far), 0);
});

test('XP share: a player without Fellowship shares nothing, and the owner gets nothing from them', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.xp;
    const a = owner({ x: at.x, z: at.z + 30 });
    const b = plain({ x: at.x, z: at.z + 31 });
    gainXp(b);
    assert.equal(fletch(a), 0);
    assert.ok(fletch(b) > 0);
});

test('XP share: shared XP is never shared again, so two owners next to each other settle at 1.5x', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.chain;
    const control = plain({ x: 3200, z: 3300 });
    gainXp(control);
    const gain = fletch(control);
    const a = owner(at);
    const b = owner(near(at, 1));

    gainXp(a);
    assert.equal(fletch(a), gain);
    assert.equal(fletch(b), Math.floor(gain / 2));
    gainXp(b);
    assert.equal(fletch(b), gain + Math.floor(gain / 2));
    assert.equal(fletch(a), gain + Math.floor(gain / 2));
});

test('XP share: Fellowships stack, a bystander gets half of each owner\'s gain', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.stack;
    const control = plain({ x: 3200, z: 3300 });
    gainXp(control);
    const gain = fletch(control);
    const a = owner(at);
    const b = owner(near(at, 2));
    const c = plain(near(at, 4));
    gainXp(a);
    gainXp(b);
    assert.equal(fletch(c), 2 * Math.floor(gain / 2));
});

test('XP share: another level is not near, even on the same x and z', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.level;
    const a = owner(at);
    const upstairs = plain({ x: at.x, z: at.z, level: 1 });
    gainXp(a);
    assert.equal(fletch(upstairs), 0);
});

test('shared healing: eating gives players within 5 tiles half of the hitpoints the owner healed, relic or not', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.heal;
    const a = owner(at);
    const close = plain(near(at, 4));
    const far = plain(near(at, 7));
    for (const b of [a, close, far]) setHp(b, 70, 20);
    a.give('lobster');
    a.opHeld('lobster', 1).tick(4);
    const healed = a.stat('hitpoints') - 20;
    assert.ok(healed > 0, 'the lobster healed the owner');
    assert.equal(close.stat('hitpoints'), 20 + Math.floor(healed / 2));
    assert.equal(far.stat('hitpoints'), 20);
});

test('shared healing: a player without Fellowship eating shares nothing', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: SPOT.heal.x, z: SPOT.heal.z + 30 };
    const eater = plain(at);
    const friend = plain(near(at, 2));
    const holder = owner(near(at, 3));
    for (const b of [eater, friend, holder]) setHp(b, 70, 20);
    eater.give('lobster');
    eater.opHeld('lobster', 1).tick(4);
    assert.ok(eater.stat('hitpoints') > 20);
    assert.equal(friend.stat('hitpoints'), 20);
    assert.equal(holder.stat('hitpoints'), 20, 'owning the relic does not make you receive from others, only share');
});

test('shared healing: owners stack and a heal is capped at base level', t => {
    if (skip()) return t.skip(String(skip()));
    const at = SPOT.healStack;
    const a = owner(at);
    const b = owner(near(at, 1));
    const c = plain(near(at, 3));
    for (const x of [a, b, c]) setHp(x, 70, 20);
    a.give('lobster');
    b.give('lobster');
    a.opHeld('lobster', 1).tick(4);
    const healed = a.stat('hitpoints') - 20;
    const half = Math.floor(healed / 2);
    assert.equal(c.stat('hitpoints'), 20 + half);
    assert.equal(b.stat('hitpoints'), 20 + half, 'an owner receives from another owner');
    b.opHeld('lobster', 1).tick(4);
    const bHealed = b.stat('hitpoints') - (20 + half);
    assert.ok(bHealed > 0);
    assert.equal(c.stat('hitpoints'), 20 + half + Math.floor(bHealed / 2), 'two owners, two shares');
    assert.equal(a.stat('hitpoints'), 20 + healed + Math.floor(bHealed / 2), 'the owners also feed each other');

    // base level is the cap
    const at2 = SPOT.cap;
    const d = owner(at2);
    const e = plain(near(at2, 2));
    setHp(d, 70, 20);
    setHp(e, 70, 69);
    d.give('lobster');
    d.opHeld('lobster', 1).tick(4);
    assert.equal(e.stat('hitpoints'), 70);
});

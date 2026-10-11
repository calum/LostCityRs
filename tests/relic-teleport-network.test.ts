// Relic 24 Teleport Network (opens a city list, a click teleports) and the removal of relic 15 Infinite Runes.
// Mod code: mods/relics/scripts/relic_effects.rs2 ([opheld1,relic_network_stone], [if_button,relic_teleportmenu:*]),
// relic_offer.rs2 (names, pool, grant), mods/relics/interfaces/relic_teleportmenu.if.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, spawnNpc } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';
import { existingRelicIds } from './relic-helpers.js';

import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import OpNpcT from '../Engine-TS/src/network/game/client/model/OpNpcT.js';
import VarPlayerType from '../Engine-TS/src/cache/config/VarPlayerType.js';

useVanillaWorld();

const bit = (id: number) => 1 << id;
/** Every bit relic that exists: 2..14, 16..19 and 24 (15 is retired). */
/** Every bit relic that exists (retired and reserved ids skipped, see relicExists). */
const ALL = existingRelicIds().filter(id => id >= 2).reduce((m, id) => m | bit(id), 0);
const near = (bot: Bot, c: { x: number; z: number }, r = 2) => Math.abs(bot.x - c.x) <= r && Math.abs(bot.z - c.z) <= r && bot.level === 0;

// Destinations: tele_coord of the Lumbridge/Varrock/Falador/Camelot/Ardougne spells (magic_spells.dbrow) and the amulet of glory
// choices (amulet_of_glory.rs2:32-35). coord 0_mx_mz_lx_lz = mx*64+lx, mz*64+lz.
const CITIES: [string, { x: number; z: number }][] = [
    ['lumbridge', { x: 3221, z: 3218 }],
    ['varrock', { x: 3213, z: 3424 }],
    ['falador', { x: 2965, z: 3378 }],
    ['edgeville', { x: 3087, z: 3496 }],
    ['draynor', { x: 3105, z: 3251 }],
    ['alkharid', { x: 3293, z: 3163 }],
    ['camelot', { x: 2757, z: 3478 }],
    ['ardougne', { x: 2661, z: 3301 }],
    ['karamja', { x: 2918, z: 3176 }]
];

test('teleport network: granting gives a stone whose op opens the city list', () => {
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', 24);
    bot.expectMessage('You gained the relic: Teleport Network.');
    assert.equal(bot.count('relic_network_stone'), 1);
    assert.equal(bot.mainModal, null);
    bot.opHeld('relic_network_stone', 1);
    bot.tick();
    assert.equal(bot.mainModal, 'relic_teleportmenu');
});

for (const [name, dest] of CITIES) {
    test(`teleport network: ${name} button teleports there and keeps the stone`, () => {
        const bot = Bot.spawn({ at: { x: 2606, z: 3093 } }); // Yanille: far from every city
        bot.clearInv();
        bot.debugproc('relic_grant', 24);
        bot.opHeld('relic_network_stone', 1);
        bot.tick();
        bot.clickButton(`relic_teleportmenu:${name}`);
        bot.waitUntil(() => near(bot, dest), 12, `arrival in ${name}`);
        assert.equal(bot.count('relic_network_stone'), 1);
        assert.equal(bot.mainModal, null);
    });
}

test('teleport network: the tutorial island rule still applies (pre_tele_checks)', () => {
    const bot = Bot.spawn({ at: { x: 3094, z: 3107 } }); // Tutorial Island
    bot.clearInv();
    bot.debugproc('relic_grant', 24);
    bot.opHeld('relic_network_stone', 1);
    bot.tick();
    bot.clickButton('relic_teleportmenu:varrock');
    bot.tick(6);
    assert.ok(!near(bot, { x: 3213, z: 3424 }), 'must not leave Tutorial Island');
});

test('teleport network: it is in the relic pool and has a name and a description', () => {
    // everything else owned and XP maxed: relic 24 is the only one left, so the dialogue is the single "Take this relic?" form
    const b = Bot.spawn({ varps: { relic_started: 1, relic_seed: 1, relic_pending: 1, relic_xp_tier: 3, relic_xp_factor: 27, relic_owned: ALL & ~bit(24) } });
    b.waitUntil(() => b.inDialog, 20, 'the relic offer');
    assert.match(b.dialogText, /Take this relic\?/);
    assert.ok(b.choices.some(t => /Teleport Network: /.test(t)), JSON.stringify(b.choices));
});

// ---------------------------------------------------------------- Infinite Runes is gone

const NO_RUNES = /You do not have enough .* Runes to cast this spell/;

test('infinite runes removed: owning bit 15 does not waive runes any more', () => {
    const bot = Bot.spawn({ levels: { magic: 99 }, varps: { relic_owned: bit(15) } });
    bot.clearInv();
    bot.clickButton('magic:varrock_teleport');
    bot.tick(6);
    bot.expectMessage(NO_RUNES);
});

test('infinite runes removed: a spell on an NPC with the bit set still needs runes', () => {
    const bot = Bot.spawn({ levels: { magic: 99 }, varps: { relic_owned: bit(15) } });
    bot.clearInv();
    const chicken = spawnNpc('chicken', { x: bot.x + 3, z: bot.z });
    bot.tick();
    bot.player.send('OPNPCT', ClientGameProt.OPNPCT, new OpNpcT(chicken.nid, ids.com('magic:wind_strike')));
    bot.tick(6);
    bot.expectMessage(NO_RUNES);
});

test('infinite runes removed: the client is no longer sent relic_owned with a client code', () => {
    const v = VarPlayerType.getByName('relic_owned')!;
    assert.equal(v.clientcode, 0);
});

test('infinite runes removed: it is never offered (the pool skips id 15)', () => {
    // everything but 15 owned and XP maxed: nothing is left to offer, so the choice never opens
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_pending: 1, relic_xp_tier: 3, relic_xp_factor: 27, relic_owned: ALL } });
    bot.tick(10);
    assert.equal(bot.inDialog, false);
});

test('infinite runes removed: a character that owned it loses the bit on login and is owed one new offer', () => {
    // the varp is set after the first login (spawn applies varps before it), then saved and loaded by the relog
    const before = Bot.spawn();
    before.setVar('relic_owned', bit(15) | bit(3));
    const bot = before.relog();
    bot.expectMessage(/Infinite Runes relic has been retired/);
    assert.equal(bot.varp('relic_owned'), bit(3));
    assert.equal(bot.varp('relic_pending'), 1);
    bot.waitUntil(() => bot.inDialog, 20, 'the replacement offer');
});

test('infinite runes removed: logging in again does not owe a second offer', () => {
    const before = Bot.spawn();
    before.setVar('relic_owned', bit(15));
    const once = before.relog();
    once.waitUntil(() => once.inDialog, 20, 'the replacement offer');
    once.closeModal();
    const twice = once.relog();
    assert.equal(twice.varp('relic_pending'), 1, 'still the one offer, not two');
});

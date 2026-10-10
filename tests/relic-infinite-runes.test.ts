// Relic 15 Infinite Runes: EVERY spell must work with no runes in the backpack, not only the three covered in
// relic-utility.test.ts. Each spell is cast twice from an empty backpack: once without the relic (control: the rune
// message must appear, proving the cast reached the rune check) and once with it (no rune message, the spell happens).
// Rune rule: skill_magic/scripts/magic.rs2 ([proc,check_spell_requirements], [proc,staff_runes], [proc,delete_spell_runes]).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, spawnNpc } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import OpHeldT from '../Engine-TS/src/network/game/client/model/OpHeldT.js';
import OpNpcT from '../Engine-TS/src/network/game/client/model/OpNpcT.js';

useVanillaWorld();

const NO_RUNES = /You do not have enough .* Runes to cast this spell/;

function fresh(relic: boolean): Bot {
    const bot = Bot.spawn({ levels: { magic: 99, smithing: 99 } });
    bot.clearInv().clearInv('worn');
    if (relic) bot.debugproc('relic_grant', 15);
    return bot;
}

// ---------------------------------------------------------------- combat spells (magic_combat_spells.dbrow)

// [spell component, staff that must be worn (wornrequired) or null]
const COMBAT: [string, string | null][] = [
    ...['wind', 'water', 'earth', 'fire'].flatMap(e => ['strike', 'bolt', 'blast', 'wave'].map(t => [`${e}_${t}`, null] as [string, null])),
    ['confuse', null],
    ['weaken', null],
    ['curse', null],
    ['bind', null],
    ['snare', null],
    ['entangle', null],
    ['vulnerability', null],
    ['enfeeble', null],
    ['stun', null],
    ['crumble_undead', null],
    ['iban_blast', 'ibanstaff'],
    ['saradomin_strike', 'saradomin_staff'],
    ['claws_of_guthix', 'guthix_staff'],
    ['flames_of_zamorak', 'zamorak_staff']
];

function castCombat(bot: Bot, spell: string, staff: string | null) {
    if (staff) bot.give(staff, 1, 'worn');
    const chicken = spawnNpc('chicken', { x: bot.x + 3, z: bot.z });
    bot.tick();
    bot.player.send('OPNPCT', ClientGameProt.OPNPCT, new OpNpcT(chicken.nid, ids.com(`magic:${spell}`)));
    bot.tick(6);
}

for (const [spell, staff] of COMBAT) {
    test(`infinite runes: ${spell} on a chicken with no runes`, () => {
        const control = fresh(false);
        castCombat(control, spell, staff);
        control.expectMessage(NO_RUNES);

        const bot = fresh(true);
        castCombat(bot, spell, staff);
        bot.expectNoMessage(NO_RUNES);
        bot.expectNoMessage(/members/);
    });
}

// ---------------------------------------------------------------- non-combat spells (magic_spells.dbrow)

function castOnHeld(bot: Bot, spell: string, obj: string) {
    const objId = ids.obj(obj);
    const invId = ids.inv('inv');
    const listener = bot.player.invListeners.find(l => l && l.type === invId && l.source !== -1)!;
    const inv = bot.player.getInventory(invId)!;
    let slot = -1;
    for (let i = 0; i < inv.capacity; i++) {
        if (inv.hasAt(i, objId)) {
            slot = i;
            break;
        }
    }
    assert.ok(slot >= 0, `no ${obj} in the backpack`);
    bot.player.send('OPHELDT', ClientGameProt.OPHELDT, new OpHeldT(objId, slot, listener.com, ids.com(spell)));
    bot.tick(6);
}

// Teleports are IF_BUTTON; the quest gated ones stop on the quest message, but only after the rune check (teleport.rs2:14-30).
for (const t of ['varrock', 'lumbridge', 'falador', 'camelot', 'ardougne', 'watchtower', 'trollheim']) {
    test(`infinite runes: ${t} teleport with no runes`, () => {
        const control = fresh(false);
        control.clickButton(`magic:${t}_teleport`);
        control.tick(6);
        control.expectMessage(NO_RUNES);

        const bot = fresh(true);
        bot.clickButton(`magic:${t}_teleport`);
        bot.tick(6);
        bot.expectNoMessage(NO_RUNES);
    });
}

test('infinite runes: bones to bananas with no runes', () => {
    const control = fresh(false);
    control.give('bones', 3);
    control.clickButton('magic:bones_to_bananas');
    control.tick(6);
    control.expectMessage(NO_RUNES);

    const bot = fresh(true);
    bot.give('bones', 3);
    bot.clickButton('magic:bones_to_bananas');
    bot.waitUntil(() => bot.count('banana') === 3, 10, 'bananas');
    assert.equal(bot.count('bones'), 0);
});

test('infinite runes: low level alchemy with no runes', () => {
    const control = fresh(false);
    control.give('iron_dagger');
    castOnHeld(control, 'magic:lowlvl_alchemy', 'iron_dagger');
    control.expectMessage(NO_RUNES);

    const bot = fresh(true);
    bot.give('iron_dagger');
    castOnHeld(bot, 'magic:lowlvl_alchemy', 'iron_dagger');
    assert.equal(bot.count('iron_dagger'), 0);
    assert.ok(bot.count('coins') > 0);
});

test('infinite runes: enchant sapphire ring with no runes', () => {
    const control = fresh(false);
    control.give('sapphire_ring');
    castOnHeld(control, 'magic:enchant_lvl1', 'sapphire_ring');
    control.expectMessage(NO_RUNES);

    const bot = fresh(true);
    bot.give('sapphire_ring');
    castOnHeld(bot, 'magic:enchant_lvl1', 'sapphire_ring');
    assert.equal(bot.count('ring_of_recoil'), 1);
});

test('infinite runes: superheat iron ore with no runes', () => {
    const control = fresh(false);
    control.give('iron_ore');
    castOnHeld(control, 'magic:superheat_item', 'iron_ore');
    control.expectMessage(NO_RUNES);

    const bot = fresh(true);
    bot.give('iron_ore');
    castOnHeld(bot, 'magic:superheat_item', 'iron_ore');
    bot.expectNoMessage(NO_RUNES);
    assert.equal(bot.count('iron_ore'), 0);
});

// ---------------------------------------------------------------- other ways to reach the same check

test('infinite runes: wielding a staff of air changes nothing, Fire Strike still needs no runes', () => {
    const bot = fresh(true);
    castCombat(bot, 'fire_strike', 'staff_of_air');
    bot.expectNoMessage(NO_RUNES);
    assert.ok(bot.xp('magic') > 0);
});

test('infinite runes: still free after a relog (the relic is saved with the character)', () => {
    const before = fresh(true);
    const bot = before.relog();
    bot.clearInv().clearInv('worn');
    bot.clickButton('magic:lumbridge_teleport');
    bot.tick(6);
    bot.expectNoMessage(NO_RUNES);
});

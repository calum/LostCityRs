// Relics 15 Infinite Runes, 16 Everlasting Jewellery, 17 Last Recall, 18 Banker's Call, end to end.
// Mod code: mods/relics/scripts/relic_effects.rs2 (~relic_rune_count, ~relic_keep_charge, ~relic_record_origin,
// [opheld1,relic_recall_stone], [opheld1,relic_banker_stone]) and relic_offer.rs2 ([proc,relic_grant], [proc,relic_give_item]).
// Content hooks: skill_magic/scripts/magic.rs2 (staff_runes), skill_magic/scripts/spells/teleport.rs2 (pre_tele_checks),
// general/scripts/enchanted_jewellry/{ring_of_dueling,amulet_of_glory,necklace_of_minigames}.rs2.
//
// Spells are cast through the client input path: teleports by IF_BUTTON on the magic tab component, alchemy by
// OPHELDT (spell on a backpack item), combat spells by OPNPCT (spell on an NPC). Jewellery by OPHELD4 ("Rub").
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, spawnNpc } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

import Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import OpHeldT from '../Engine-TS/src/network/game/client/model/OpHeldT.js';
import OpNpcT from '../Engine-TS/src/network/game/client/model/OpNpcT.js';

useVanillaWorld();

// Varrock Teleport lands within 2 tiles of 0_50_53_13_32 = 3213,3424 (magic_spells.dbrow tele_coord; map_findsquare
// radius 2, teleport.rs2:51). Lumbridge spawn: Bot.LUMBRIDGE 3222,3218.
const VARROCK = { x: 3213, z: 3424 };
const near = (bot: Bot, c: { x: number; z: number }, r = 2) => Math.abs(bot.x - c.x) <= r && Math.abs(bot.z - c.z) <= r && bot.level === 0;

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
}

/** Cast a spell on an NPC (OPNPCT). OpNpcTHandler sets an APNPCT interaction; the engine paths into range. */
function castOnNpc(bot: Bot, spell: string, npc: Npc) {
    bot.player.send('OPNPCT', ClientGameProt.OPNPCT, new OpNpcT(npc.nid, ids.com(spell)));
}

function castVarrockTeleport(bot: Bot) {
    bot.clickButton('magic:varrock_teleport'); // [if_button,magic:varrock_teleport] teleport.rs2:1
}

function fillInv(bot: Bot) {
    const free = bot.player.getInventory(ids.inv('inv'))!.freeSlotCount;
    if (free > 0) bot.give('bronze_dagger', free);
}

// ---------------------------------------------------------------- 15 Infinite Runes

test('infinite runes control: without runes Varrock Teleport fails with the rune message', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv();
    castVarrockTeleport(bot);
    bot.tick(5);
    // runesrequired firerune,1,airrune,3,lawrune,1: the first missing rune is reported (magic.rs2:34-35)
    bot.expectMessage('You do not have enough Fire Runes to cast this spell.');
    assert.ok(near(bot, { x: 3222, z: 3218 }, 0), 'did not move');
});

test('infinite runes: Varrock Teleport with no runes', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv();
    bot.debugproc('relic_grant', 15);
    const xp0 = bot.xp('magic');
    castVarrockTeleport(bot);
    bot.waitUntil(() => near(bot, VARROCK), 10, 'arrival in Varrock');
    assert.ok(bot.xp('magic') > xp0);
});

test('infinite runes control: high alchemy without runes fails', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger');
    castOnHeld(bot, 'magic:highlvl_alchemy', 'iron_dagger');
    bot.tick(3);
    bot.expectMessage('You do not have enough Nature Runes to cast this spell.');
    assert.equal(bot.count('iron_dagger'), 1);
});

test('infinite runes: high alchemy with no runes', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger');
    bot.debugproc('relic_grant', 15);
    castOnHeld(bot, 'magic:highlvl_alchemy', 'iron_dagger');
    bot.waitUntil(() => bot.count('iron_dagger') === 0, 5, 'the alch');
    assert.equal(bot.count('coins'), 21); // iron_dagger cost 35 -> scale(6, 10, 35) = 21
});

test('infinite runes control: Wind Strike on a chicken without runes fails', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv();
    const chicken = spawnNpc('chicken', { x: bot.x + 3, z: bot.z });
    bot.tick();
    const xp0 = bot.xp('magic');
    castOnNpc(bot, 'magic:wind_strike', chicken);
    bot.tick(5);
    // runesrequired mindrune,1,airrune,1 (magic_combat_spells.dbrow)
    bot.expectMessage('You do not have enough Mind Runes to cast this spell.');
    assert.equal(bot.xp('magic'), xp0);
});

test('infinite runes: Wind Strike on a chicken with no runes', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv();
    bot.debugproc('relic_grant', 15);
    const chicken = spawnNpc('chicken', { x: bot.x + 3, z: bot.z });
    bot.tick();
    const xp0 = bot.xp('magic');
    castOnNpc(bot, 'magic:wind_strike', chicken);
    // ~pvm_spell_cast gives the base spell XP whether or not the spell then hits (player_magic.rs2:156-158)
    bot.waitUntil(() => bot.xp('magic') > xp0, 10, 'the cast');
    bot.expectNoMessage(/You do not have enough/);
});

// ---------------------------------------------------------------- 16 Everlasting Jewellery

const JEWELS = ['ring_of_dueling_8', 'amulet_of_glory_4', 'necklace_of_minigames_8'];

test('everlasting jewellery: granting gives the ring, glory and games necklace to the backpack', () => {
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', 16);
    for (const j of JEWELS) {
        assert.equal(bot.count(j), 1, j);
        assert.equal(bot.count(j, 'bank'), 0, j);
    }
});

test('everlasting jewellery: with a full backpack the three items go to the bank', () => {
    const bot = Bot.spawn();
    bot.clearInv();
    fillInv(bot);
    bot.debugproc('relic_grant', 16);
    for (const j of JEWELS) {
        assert.equal(bot.count(j), 0, j);
        assert.equal(bot.count(j, 'bank'), 1, j);
    }
    bot.expectMessage(/Your inventory was full: .* went to your bank/);
});

/** Rub (op4), pick the first destination, wait for the teleport. Returns the backpack afterwards. */
function rub(bot: Bot, item: string, choice: string, dest: { x: number; z: number }) {
    bot.opHeld(item, 4);
    bot.waitUntil(() => bot.choices.length > 0, 5, 'the destination choice');
    bot.choose(choice);
    bot.waitUntil(() => near(bot, dest), 10, `teleport to ${dest.x},${dest.z}`);
    bot.waitUntilIdle(10);
}

// Destinations: ring 0_51_50_51_35 = 3315,3235 (+-2, ring_of_dueling.rs2:20); games necklace 0_34_77_31_12 = 2207,4940
// (+-2, necklace_of_minigames.rs2:20); glory Edgeville 0_48_54_15_40 = 3087,3496 exact (amulet_of_glory.rs2:94).
const RUBS = [
    { item: 'ring_of_dueling_8', next: 'ring_of_dueling_7', choice: 'Duel Arena', dest: { x: 3315, z: 3235 }, mes: 'Your Ring of Dueling has 7 uses left.' },
    { item: 'amulet_of_glory_4', next: 'amulet_of_glory_3', choice: 'Edgeville', dest: { x: 3087, z: 3496 }, mes: 'Your amulet has three charges left.' },
    { item: 'necklace_of_minigames_8', next: 'necklace_of_minigames_7', choice: 'Burthorpe', dest: { x: 2207, z: 4940 }, mes: 'Your Games Necklace has 7 uses left.' }
];

for (const r of RUBS) {
    test(`everlasting jewellery control: rubbing ${r.item} without the relic uses a charge`, () => {
        const bot = Bot.spawn();
        bot.clearInv().give(r.item);
        rub(bot, r.item, r.choice, r.dest);
        assert.equal(bot.count(r.item), 0);
        assert.equal(bot.count(r.next), 1);
        if (r.mes) bot.expectMessage(r.mes);
    });

    test(`everlasting jewellery: rubbing ${r.item} teleports and keeps the charge`, () => {
        const bot = Bot.spawn();
        bot.clearInv();
        bot.debugproc('relic_grant', 16); // gives the three items
        rub(bot, r.item, r.choice, r.dest);
        assert.equal(bot.count(r.item), 1);
        assert.equal(bot.count(r.next), 0);
        if (r.item === 'amulet_of_glory_4') {
            // Current behaviour: the glory prints its charge message BEFORE the hook (amulet_of_glory.rs2:92 mes($message),
            // hook at :99), so with the relic it still says "three charges left" although the amulet stays (4).
            bot.expectMessage('Your amulet has three charges left.');
        } else {
            // ring and games necklace print their "uses left" message after the hook (ring_of_dueling.rs2:21,32)
            bot.expectNoMessage(/uses? left/);
        }
    });
}

// ---------------------------------------------------------------- 17 Last Recall

test('last recall: the stone says so before any teleport', () => {
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', 17);
    assert.equal(bot.count('relic_recall_stone'), 1);
    bot.opHeld('relic_recall_stone', 1);
    bot.tick(2);
    bot.expectMessage('You have not teleported anywhere yet.');
    assert.ok(near(bot, { x: 3222, z: 3218 }, 0));
});

test('last recall control: a stone without the relic records nothing, so a teleport cannot be recalled', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('relic_recall_stone');
    bot.debugproc('relic_grant', 15); // no runes needed
    castVarrockTeleport(bot);
    bot.waitUntil(() => near(bot, VARROCK), 10, 'arrival in Varrock');
    bot.waitUntilIdle(10);
    bot.opHeld('relic_recall_stone', 1);
    bot.tick(2);
    bot.expectMessage('You have not teleported anywhere yet.');
    assert.ok(near(bot, VARROCK));
});

test('last recall: Lumbridge -> Varrock by spell, the stone returns to the exact origin, and a second use goes back to Varrock', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv();
    bot.debugproc('relic_grant', 15);
    bot.debugproc('relic_grant', 17);
    const origin = bot.pos;

    castVarrockTeleport(bot);
    bot.waitUntil(() => near(bot, VARROCK), 10, 'arrival in Varrock');
    bot.waitUntilIdle(10);
    const landed = bot.pos;

    // [opheld1,relic_recall_stone] runs ~pre_tele_checks(coord), which records the CURRENT tile as the new origin
    // (teleport.rs2:127) before ~player_teleport_normal($dest): so each use swaps the two ends.
    bot.opHeld('relic_recall_stone', 1);
    bot.waitUntil(() => bot.x === origin.x && bot.z === origin.z, 10, 'recall to the origin');
    bot.waitUntilIdle(10);

    bot.opHeld('relic_recall_stone', 1);
    bot.waitUntil(() => bot.x === landed.x && bot.z === landed.z, 10, 'recall back to the landing tile');
    bot.waitUntilIdle(10);
    assert.equal(bot.count('relic_recall_stone'), 1, 'the stone is not used up');
});

// ---------------------------------------------------------------- 18 Banker's Call

test("banker's call: granting gives the stone, and its first op opens the bank", () => {
    const bot = Bot.spawn();
    bot.clearInv();
    bot.debugproc('relic_grant', 18);
    assert.equal(bot.count('relic_banker_stone'), 1);
    assert.equal(bot.mainModal, null);
    bot.opHeld('relic_banker_stone', 1);
    bot.tick();
    // @openbank: if_openmain_side(bank_main, bank_side) (interface_bank/scripts/bank.rs2)
    assert.equal(bot.mainModal, 'bank_main');
});

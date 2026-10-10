// Relics 10 Eternal Vein, 11 Evergreen, 12 Double Yield, 13 Midas Loop, 14 Philosopher's Coin, end to end.
// Mod code: mods/relics/scripts/relic_gather.rs2 (~relic_gathered, ~relic_loc_change) and relic_effects.rs2
// (~relic_alch_profit, ~relic_midas, [queue,relic_midas]). Content hooks: grep "relic hook" in
// Content/scripts/skill_mining/scripts/mining.rs2, skill_woodcutting/scripts/woodcut.rs2, skill_magic/scripts/spells/alchemy.rs2.
//
// Every action goes through the client input path: rocks and trees by OPLOC (Bot.opLoc), alchemy by OPHELDT
// (a spell component used on a backpack item, OpHeldTHandler), walking by MOVE_GAMECLICK.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

import ObjType from '../Engine-TS/src/cache/config/ObjType.js';
import Loc from '../Engine-TS/src/engine/entity/Loc.js';
import ClientGameProt from '../Engine-TS/src/network/game/client/ClientGameProt.js';
import OpHeldT from '../Engine-TS/src/network/game/client/model/OpHeldT.js';

useVanillaWorld();

// Al Kharid mine, south end: copper (copperrock) and tin rocks at 3296-3302,3314-3318 in this cache (read from the loaded map). Trees: the Lumbridge spawn (nearest normal tree about 30 tiles east).
const MINE = { x: 3299, z: 3311, level: 0 };
const ROCKS = ['copperrock1', 'copperrock2', 'tinrock1', 'tinrock2'];
const ORES = ['copper_ore', 'tin_ore'];

// ---------------------------------------------------------------- local helpers

/** Nearest loc of any of `types` (findLoc only ignores locs whose current type changed, e.g. a depleted rock). */
function nearestLoc(bot: Bot, types: string[], radius = 20): Loc {
    let best: Loc | null = null;
    let bestDist = Infinity;
    for (const t of types) {
        try {
            const loc = bot.findLoc(t, radius);
            const d = Math.max(Math.abs(loc.x - bot.x), Math.abs(loc.z - bot.z));
            if (d < bestDist) {
                best = loc;
                bestDist = d;
            }
        } catch {
            // none of this type in range
        }
    }
    if (!best) throw new Error(`no ${types.join('/')} within ${radius} of ${bot.x},${bot.z}`);
    return best;
}

function ores(bot: Bot, inv = 'inv'): number {
    return ORES.reduce((n, o) => n + bot.count(o, inv), 0);
}

/** Fill the free backpack slots, leaving `leave` free, with unstackable filler (bronze daggers). */
function fillInv(bot: Bot, leave = 0) {
    const inv = bot.player.getInventory(ids.inv('inv'))!;
    const free = inv.freeSlotCount;
    if (free > leave) bot.give('bronze_dagger', free - leave);
}

/** Fill every free bank slot with distinct objs (the bank is stackall, so one slot per obj type). */
function fillBank(bot: Bot, avoid: string[]) {
    const bankId = ids.inv('bank');
    const bank = bot.player.getInventory(bankId)!;
    const skip = new Set(avoid.map(a => ids.obj(a)));
    for (let id = 0; id < ObjType.count && bank.freeSlotCount > 0; id++) {
        const t = ObjType.get(id);
        if (!t || skip.has(id) || t.dummyitem !== 0 || t.certtemplate !== -1) continue;
        bot.player.invAdd(bankId, id, 1);
    }
    assert.equal(bank.freeSlotCount, 0, 'bank should be full');
}

/** Cast a spell from the magic tab on a backpack item: the OPHELDT packet the client sends (OpHeldTHandler). */
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

/** Click the rock until one ore has been mined (the get_ore labels end with `return` after a success, mining.rs2:145,182). */
function mineOnce(bot: Bot, rock: Loc) {
    bot.opLoc(rock, 1);
    bot.waitForMessage(/You manage to mine some/, 300);
    bot.waitUntilIdle(20);
}

// ---------------------------------------------------------------- 10 Eternal Vein

test('eternal vein control: without the relic a mined rock depletes and the ore goes to the backpack', () => {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv().give('rune_pickaxe');
    const rock = nearestLoc(bot, ROCKS);
    const before = rock.type;

    mineOnce(bot, rock);

    assert.equal(ores(bot), 1);
    assert.equal(ores(bot, 'bank'), 0);
    // ~relic_loc_change falls through to loc_change(next_loc_stage_mining) (relic_gather.rs2)
    assert.notEqual(rock.type, before, 'rock should have turned into its empty stage');
});

test('eternal vein: the rock never depletes, ore goes to the bank, and a full backpack does not stop mining', () => {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv().give('rune_pickaxe');
    bot.debugproc('relic_grant', 10);
    const rock = nearestLoc(bot, ROCKS);
    const type = rock.type;

    mineOnce(bot, rock);
    assert.equal(rock.type, type, 'rock must not change');
    mineOnce(bot, rock); // the same rock again
    assert.equal(rock.type, type);
    assert.equal(ores(bot, 'bank'), 2);
    assert.equal(ores(bot), 0);

    // A full backpack no longer blocks the first swing (mining.rs2:32 `& ~relic_has(10) = 0`).
    fillInv(bot);
    mineOnce(bot, rock);
    assert.equal(ores(bot, 'bank'), 3);
    bot.expectNoMessage(/inventory is too full/i);
});

test('eternal vein: with the bank full the ore falls back to the backpack', () => {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv().give('rune_pickaxe');
    bot.debugproc('relic_grant', 10);
    fillBank(bot, [...ORES, 'rune_pickaxe']);
    const rock = nearestLoc(bot, ROCKS);

    mineOnce(bot, rock);

    assert.equal(ores(bot), 1);
    assert.equal(ores(bot, 'bank'), 0);
});

// ---------------------------------------------------------------- 11 Evergreen

test('evergreen control: without the relic a normal tree falls after one log, which goes to the backpack', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 99 } });
    bot.clearInv().give('bronze_axe');
    const tree = bot.findLoc('tree', 40);

    bot.opLoc(tree, 1);
    bot.waitForMessage('You get some logs.', 300);
    bot.tick();

    assert.equal(bot.count('logs'), 1);
    assert.equal(bot.count('logs', 'bank'), 0);
    // normal trees have respawnrate 0, so $deplete_chance = 0 and random(0) = 0 always fells them (woodcut.rs2:126-137)
    assert.notEqual(tree.type, ids.loc('tree'), 'tree should be a stump');
});

test('evergreen: the tree keeps standing, chopping continues and the logs go to the bank', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 99 } });
    bot.clearInv().give('bronze_axe');
    bot.debugproc('relic_grant', 11);
    const tree = bot.findLoc('tree', 40);

    bot.opLoc(tree, 1);
    // the [label,get_logs] loop continues with p_oploc(3) when the tree does not fall (woodcut.rs2:142)
    bot.waitUntil(() => bot.count('logs', 'bank') >= 3, 600, '3 logs in the bank');

    assert.equal(tree.type, ids.loc('tree'));
    assert.equal(bot.count('logs'), 0);
    assert.ok(bot.player.hasInteraction(), 'still chopping');

    bot.walkTo({ x: bot.x + 1, z: bot.z });
    bot.waitUntilIdle(20);
});

// ---------------------------------------------------------------- 12 Double Yield

test('double yield (mining): 2 ore per success when the backpack has room for 2, 1 when it has room for 1', () => {
    const bot = Bot.spawn({ at: MINE, levels: { mining: 99 } });
    bot.clearInv().give('rune_pickaxe');
    bot.debugproc('relic_grant', 12);

    mineOnce(bot, nearestLoc(bot, ROCKS));
    assert.equal(ores(bot), 2);

    // inv_itemspace(inv, $obj, 2, ...) fails with one free slot (unstackable ore), so $n stays 1 (relic_gather.rs2)
    fillInv(bot, 1);
    mineOnce(bot, nearestLoc(bot, ROCKS));
    assert.equal(ores(bot), 3);
    assert.equal(bot.player.getInventory(ids.inv('inv'))!.freeSlotCount, 0);
});

test('double yield (woodcutting): 2 logs per success', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 99 } });
    bot.clearInv().give('bronze_axe');
    bot.debugproc('relic_grant', 12);

    bot.opLoc(bot.findLoc('tree', 40), 1);
    bot.waitForMessage('You get some logs.', 300);
    bot.tick();

    assert.equal(bot.count('logs'), 2);
});

test('double yield + evergreen: 2 logs to the bank per success, backpack untouched', () => {
    const bot = Bot.spawn({ levels: { woodcutting: 99 } });
    bot.clearInv().give('bronze_axe');
    bot.debugproc('relic_grant', 11);
    bot.debugproc('relic_grant', 12);

    bot.opLoc(bot.findLoc('tree', 40), 1);
    bot.waitForMessage('You get some logs.', 300);
    bot.tick();
    assert.equal(bot.count('logs', 'bank'), 2);
    assert.equal(bot.count('logs'), 0);
    bot.walkTo({ x: bot.x + 1, z: bot.z });
    bot.waitUntilIdle(20);
});

test('double yield + evergreen with a FULL backpack: 2 logs still reach the bank', () => {
    // ~relic_gathered checks space for 2 where the product goes: the bank when the skill relic sends it there
    // (mods/relics/scripts/relic_gather.rs2, [proc,relic_gathered]). A full backpack does not halve the yield.
    const bot = Bot.spawn({ levels: { woodcutting: 99 } });
    bot.clearInv().give('bronze_axe');
    bot.debugproc('relic_grant', 11);
    bot.debugproc('relic_grant', 12);
    fillInv(bot);

    bot.opLoc(bot.findLoc('tree', 40), 1);
    bot.waitForMessage('You get some logs.', 300);
    bot.tick();
    assert.equal(bot.count('logs', 'bank'), 2);
    bot.walkTo({ x: bot.x + 1, z: bot.z });
    bot.waitUntilIdle(20);
});

// ---------------------------------------------------------------- 14 Philosopher's Coin

// iron_dagger cost=35 (Content/scripts/skill_combat/configs/melee/daggers.obj). Payout is scale(6, 10, cost)
// (high, alchemy.rs2:25) or scale(4, 10, cost) (low, alchemy.rs2:65); SCALE is a*c/b truncated by toInt32
// (Engine-TS NumberOps.ts SCALE, ScriptState.pushInt). High 21, low 14; doubled 42 and 28.
function alch(relics: number[], spell: 'highlvl_alchemy' | 'lowlvl_alchemy'): number {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger').give('naturerune', 1).give('firerune', 5);
    for (const r of relics) bot.debugproc('relic_grant', r);
    castOnHeld(bot, `magic:${spell}`, 'iron_dagger');
    bot.waitUntil(() => bot.count('iron_dagger') === 0, 10, 'the dagger to be alched');
    bot.waitUntilIdle(10);
    assert.equal(bot.count('naturerune'), 0, 'runes were used');
    const coins = bot.count('coins');
    bot.remove();
    return coins;
}

test("philosopher's coin: high alchemy pays 42 instead of 21 for an iron dagger", () => {
    assert.equal(alch([], 'highlvl_alchemy'), 21);
    assert.equal(alch([14], 'highlvl_alchemy'), 42);
});

test("philosopher's coin: low alchemy pays 28 instead of 14 for an iron dagger", () => {
    assert.equal(alch([], 'lowlvl_alchemy'), 14);
    assert.equal(alch([14], 'lowlvl_alchemy'), 28);
});

// ---------------------------------------------------------------- 13 Midas Loop

test('midas loop control: without the relic one cast alchs one item', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger', 3).give('naturerune', 10).give('firerune', 50);
    castOnHeld(bot, 'magic:highlvl_alchemy', 'iron_dagger');
    bot.tick(20);
    assert.equal(bot.count('iron_dagger'), 2);
    assert.equal(bot.count('coins'), 21);
});

test('midas loop: one cast keeps alching while the item remains, then stops', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger', 4).give('naturerune', 10).give('firerune', 50);
    bot.debugproc('relic_grant', 13);
    castOnHeld(bot, 'magic:highlvl_alchemy', 'iron_dagger');

    const ticks = bot.waitUntil(() => bot.count('iron_dagger') === 0, 40, 'all daggers alched');
    bot.waitUntilIdle(10);
    assert.equal(bot.count('coins'), 4 * 21);
    assert.equal(bot.count('naturerune'), 6, 'one nature rune per cast');
    // weakqueue*(relic_midas, 3) between casts (alchemy.rs2:38): 3 more casts take at least 9 ticks
    assert.ok(ticks >= 9, `took ${ticks} ticks`);
    bot.tick(10);
    assert.equal(bot.count('naturerune'), 6, 'no cast after the item ran out');
});

test('midas loop: walking clears the weak queue and stops the loop', () => {
    const bot = Bot.spawn({ levels: { magic: 99 } });
    bot.clearInv().give('iron_dagger', 6).give('naturerune', 10).give('firerune', 50);
    bot.debugproc('relic_grant', 13);
    castOnHeld(bot, 'magic:highlvl_alchemy', 'iron_dagger');
    bot.waitUntil(() => bot.count('iron_dagger') === 4, 20, 'two daggers alched');

    // MOVE_GAMECLICK -> clearPendingAction -> closeModal clears the weak queue (Player.ts closeModal/clearPendingAction)
    bot.walkTo({ x: bot.x + 2, z: bot.z });
    bot.tick(20);
    assert.equal(bot.count('iron_dagger'), 4);
    assert.equal(bot.count('coins'), 2 * 21);
    assert.equal(bot.player.weakQueue.head(), null);
});

// Relic mode death stash, Relic Keeper (mods/relics/scripts/relic_death.rs2, hook in
// Content/scripts/player/scripts/death.rs2 player_death_lose_items) and the win condition
// ([queue,relic_task_done] and [proc,relic_win] in relic_offer.rs2).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, World, ids } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import ObjType from '../Engine-TS/src/cache/config/ObjType.js';

useVanillaWorld(); // relic_started = 1 on every bot: no first-login offer

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');

const RELIC_ITEMS = ['relic_recall_stone', 'relic_banker_stone', 'ring_of_dueling_8', 'amulet_of_glory_4', 'necklace_of_minigames_8'];
// [proc,player_death] respawn square: map_findsquare(0_50_50_21_18, 0, 2, ...) (death.rs2)
const RESPAWN = { x: 3221, z: 3218 };

function total(bot: Bot, obj: string): number {
    return bot.count(obj, 'inv') + bot.count(obj, 'worn') + bot.count(obj, 'bank');
}

/** Ground objs of a type on one tile that this player can see. */
function groundCount(bot: Bot, obj: string, x: number, z: number): number {
    const id = ids.obj(obj);
    let n = 0;
    for (const o of World.gameMap.getZone(x, z, 0).getAllObjsUnsafe()) {
        if (o.type === id && o.x === x && o.z === z && World.getObj(o.x, o.z, 0, id, bot.player.hash64)) n += o.count;
    }
    return n;
}

/** Lethal damage through ~damage_self (relic_debug.rs2 relic_hit), then wait for the respawn in Lumbridge. */
function die(bot: Bot) {
    bot.debugproc('relic_hit', 99);
    bot.waitForMessage('Oh dear you are dead!', 20);
    bot.waitUntil(() => Math.max(Math.abs(bot.x - RESPAWN.x), Math.abs(bot.z - RESPAWN.z)) <= 2, 20, 'the respawn');
    bot.tick(2);
}

/** True if the dialogue texts contain `phrase` (chatnpc wraps long lines; IfSetText parts are joined with " | "). */
function said(seen: string[], phrase: string): boolean {
    return seen.join(' ').replace(/ \| /g, ' ').includes(phrase);
}

function keepers(): number {
    const id = ids.npc('relic_keeper');
    return [...World.npcs].filter(n => n && n.isActive && n.type === id).length;
}

/** Talk to the Relic Keeper ([opnpc1,relic_keeper]) and click through; returns the dialogue texts. */
function talkToKeeper(bot: Bot): string[] {
    bot.opNpc(bot.findNpc('relic_keeper', 20), 1);
    bot.waitUntil(() => bot.inDialog, 30, 'the keeper to talk');
    const seen = bot.skipDialog();
    bot.waitUntilIdle(10);
    return seen;
}

// ---------------------------------------------------------------- death

test('death: relic items in the backpack and worn go to the bank; ordinary items and a non-relic ring still drop', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3230, z: 3225 };
    const bot = Bot.spawn({ at: { ...at, level: 0 } });
    bot.clearInv().clearInv('worn');
    bot.debugproc('relic_grant', 16); // ring_of_dueling_8, amulet_of_glory_4, necklace_of_minigames_8
    bot.debugproc('relic_grant', 17); // relic_recall_stone
    bot.debugproc('relic_grant', 18); // relic_banker_stone
    for (const item of RELIC_ITEMS) assert.equal(bot.count(item), 1, item);

    bot.opHeld('ring_of_dueling_8', 2).tick(); // "Wear"
    bot.opHeld('amulet_of_glory_4', 2).tick();
    assert.equal(bot.count('ring_of_dueling_8', 'worn'), 1);
    assert.equal(bot.count('amulet_of_glory_4', 'worn'), 1);

    bot.give('bronze_dagger').give('logs').give('ring_of_dueling_7'); // control: a ring that is not the exact relic obj
    // Skulled: no "keep 3 most valuable items" (death.rs2 player_death_lose_items), so every ordinary item drops
    bot.setVar('pk_skull', 100);
    die(bot);

    for (const item of RELIC_ITEMS) {
        assert.equal(bot.count(item, 'bank'), 1, `${item} in the bank`);
        assert.equal(bot.count(item, 'inv') + bot.count(item, 'worn'), 0, `${item} not carried`);
        assert.equal(groundCount(bot, item, at.x, at.z), 0, `${item} not on the ground`);
    }
    assert.equal(groundCount(bot, 'bronze_dagger', at.x, at.z), 1);
    assert.equal(groundCount(bot, 'logs', at.x, at.z), 1);
    assert.equal(groundCount(bot, 'ring_of_dueling_7', at.x, at.z), 1);
    assert.equal(groundCount(bot, 'bones', at.x, at.z), 1);
    assert.equal(bot.count('ring_of_dueling_7', 'bank'), 0);
    assert.equal(bot.items('inv').length, 0);
    assert.equal(bot.items('worn').length, 0);
});

test('death without relic items: nothing goes to the bank (control)', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3232, z: 3227 };
    const bot = Bot.spawn({ at: { ...at, level: 0 } });
    bot.clearInv().clearInv('worn').give('bronze_dagger');
    bot.setVar('pk_skull', 100);
    die(bot);
    assert.equal(bot.items('bank').length, 0);
    assert.equal(groundCount(bot, 'bronze_dagger', at.x, at.z), 1);
});

// Was a bug: inv_moveitem drops what does not fit, so the old check after the move never fired (now checks bank space first).
test('death with a full bank: the player is told the relic item could not be kept safe', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3234, z: 3229 };
    const bot = Bot.spawn({ at: { ...at, level: 0 } });
    bot.clearInv().clearInv('worn').clearInv('bank');
    const bank = bot.player.getInventory(ids.inv('bank'))!;
    const skipIds = new Set(RELIC_ITEMS.map(n => ids.obj(n)));
    for (let id = 0; id < ObjType.count && bank.freeSlotCount > 0; id++) {
        const type = ObjType.get(id);
        if (skipIds.has(id) || type.certtemplate !== -1 || !type.debugname) continue;
        bot.player.invAdd(ids.inv('bank'), id, 1);
    }
    assert.equal(bank.freeSlotCount, 0, 'bank is full');
    bot.give('relic_recall_stone');
    bot.setVar('pk_skull', 100);
    die(bot);

    assert.equal(bot.count('relic_recall_stone', 'bank'), 0);
    assert.equal(groundCount(bot, 'relic_recall_stone', at.x, at.z), 1, 'the stone dropped where the player died');
    // relic_death.rs2 relic_stash_inv: "Your bank is full: <oc_name> could not be kept safe."
    bot.expectMessage('Your bank is full: Recall stone could not be kept safe.');
});

// ---------------------------------------------------------------- keeper

test('Relic Keeper: one keeper stands in Lumbridge after login, still one after several logins', t => {
    if (skip()) return t.skip(String(skip()));
    let bot = Bot.spawn();
    assert.equal(keepers(), 1);
    const keeper = bot.findNpc('relic_keeper', 20);
    // relic_death.rs2 relic_ensure_keeper: npc_add(map_findsquare(0_50_50_21_18, 0, 3, ...)) when none is within 20
    // (+10: slack in case it wandered; its wander range was not checked)
    assert.ok(Math.max(Math.abs(keeper.x - 3221), Math.abs(keeper.z - 3218)) <= 3 + 10, 'near the spawn square');
    for (let i = 0; i < 3; i++) bot = bot.relog();
    Bot.spawn();
    Bot.spawn({ at: { x: 3100, z: 3250, level: 0 } }); // logging in far away (Draynor) also checks Lumbridge
    bot.tick(5);
    assert.equal(keepers(), 1);
});

test('Relic Keeper: re-issues a missing item only for an owned relic, then says you have them all', t => {
    if (skip()) return t.skip(String(skip()));
    // owns 17 (Last Recall) but has no stone anywhere; does not own 18 (Banker's Call)
    const bot = Bot.spawn({ varps: { relic_owned: 1 << 17 } });
    bot.clearInv();
    const first = talkToKeeper(bot);
    assert.ok(said(first, 'You had lost some of your relic items. I have replaced them.'), first.join(' / '));
    assert.equal(bot.count('relic_recall_stone'), 1);
    assert.equal(bot.count('relic_banker_stone'), 0, 'not owned: not given');
    assert.equal(total(bot, 'ring_of_dueling_8'), 0, 'not owned: not given');

    const second = talkToKeeper(bot);
    assert.ok(said(second, 'You have all of your relic items. Take care of them.'), second.join(' / '));
    assert.equal(bot.count('relic_recall_stone'), 1, 'not given twice');
});

test('Relic Keeper: an item kept in the bank or worn counts as not lost; only the missing jewellery is replaced', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_owned: (1 << 16) | (1 << 17) } });
    bot.clearInv().clearInv('worn').clearInv('bank');
    bot.give('ring_of_dueling_8');
    bot.opHeld('ring_of_dueling_8', 2).tick(); // worn
    bot.give('amulet_of_glory_4', 1, 'bank');
    bot.give('relic_recall_stone', 1, 'bank');
    assert.equal(bot.count('ring_of_dueling_8', 'worn'), 1);

    const seen = talkToKeeper(bot);
    assert.ok(said(seen, 'I have replaced them'), seen.join(' / '));
    assert.equal(bot.count('necklace_of_minigames_8'), 1, 'the missing necklace is replaced');
    assert.equal(total(bot, 'ring_of_dueling_8'), 1);
    assert.equal(total(bot, 'amulet_of_glory_4'), 1);
    assert.equal(total(bot, 'relic_recall_stone'), 1);
    assert.equal(bot.count('relic_recall_stone', 'inv'), 0);
});

test('Relic Keeper: a player with no relics gets nothing (control)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.clearInv();
    const seen = talkToKeeper(bot);
    assert.ok(said(seen, 'You have all of your relic items'), seen.join(' / '));
    assert.equal(bot.items('inv').length, 0);
});

test('death then keeper: relic items are safe in the bank, so the keeper gives nothing', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3226, z: 3228 };
    const bot = Bot.spawn({ at: { ...at, level: 0 } });
    bot.clearInv().clearInv('worn').clearInv('bank');
    bot.debugproc('relic_grant', 17);
    bot.setVar('pk_skull', 100);
    die(bot);
    assert.equal(bot.count('relic_recall_stone', 'bank'), 1);
    const seen = talkToKeeper(bot);
    assert.ok(said(seen, 'You have all of your relic items'), seen.join(' / '));
    assert.equal(total(bot, 'relic_recall_stone'), 1);
});

// ---------------------------------------------------------------- win

test('win: one final boss (King Black Dragon) says a final boss is down and owes no offer; the second (Kalphite Queen) wins', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();

    // relic_debug.rs2 relic_kill: spawns the npc, credits the player, runs its real [ai_queue3] death script
    // (king_black_dragon.rs2 [ai_queue3,king_dragon]; drop tables/kalphite_queen.rs2 gosub(npc_death))
    bot.debugproc('relic_kill', 'king_dragon');
    bot.waitForMessage(/^Relic task 24 complete!$/, 15);
    bot.waitForMessage('A final boss is down. Defeat the other one to win.', 2);
    bot.tick(5);
    assert.equal(bot.varp('relic_pending'), 0, 'finals owe no offer');
    assert.equal(bot.choices.length, 0);
    bot.expectNoMessage(/win the relic run/);

    bot.debugproc('relic_kill', 'kalphite_flyingqueen');
    bot.waitForMessage(/^Relic task 25 complete!$/, 15);
    bot.waitForMessage('You have defeated both final bosses. You win the relic run!', 2);
    bot.waitUntil(() => bot.inDialog, 5, 'the win mesbox');
    assert.match(bot.dialogText, /Congratulations!/);
    assert.match(bot.dialogText, /You have defeated the King Black Dragon and the Kalphite Queen\./);
    assert.match(bot.dialogText, /You have won the relic run\./);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.choices.length, 0);
    assert.equal(bot.varp('relic_tasks_done'), (1 << 23) | (1 << 24));
    assert.equal(bot.messages.filter(m => m.startsWith('A final boss is down')).length, 1);
});

test('win: the Kalphite Queen alone is not a win, and the other order also wins', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.debugproc('relic_kill', 'kalphite_flyingqueen');
    bot.waitForMessage(/^Relic task 25 complete!$/, 15);
    bot.waitForMessage('A final boss is down. Defeat the other one to win.', 2);
    bot.tick(3);
    bot.expectNoMessage(/win the relic run/);
    assert.equal(bot.varp('relic_pending'), 0);

    // a second Kalphite Queen does not count again
    bot.debugproc('relic_kill', 'kalphite_flyingqueen');
    bot.tick(10);
    assert.equal(bot.messages.filter(m => m === 'Relic task 25 complete!').length, 1);
    bot.expectNoMessage(/win the relic run/);

    bot.debugproc('relic_kill', 'king_dragon');
    bot.waitForMessage('You have defeated both final bosses. You win the relic run!', 15);
});

test('win: with tasks 1-23 already done, killing both finals wins and owes no offer', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    bot.debugproc('relic_alltasks'); // tasks 1-23 done (relic_debug.rs2)
    bot.debugproc('relic_kill', 'king_dragon');
    bot.debugproc('relic_kill', 'kalphite_flyingqueen');
    bot.waitForMessage('You have defeated both final bosses. You win the relic run!', 20);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.varp('relic_tasks_done'), (1 << 25) - 1);
});

// Relic offer flow and the non-combat "meta" relics (mods/relics/scripts/relic_offer.rs2, relic_state.rs2).
// Design notes: docs/design/relics-m4-offers.md (offers), docs/design/relics-m2-xp-energy.md (XP factor).
// Uses plain useWorld(): several tests need the first-login offer, so Bot.defaults is not set here.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import Component from '../Engine-TS/src/cache/config/Component.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

// [proc,relic_name] (relic_offer.rs2): id -> name. Index 0 unused.
const NAMES = [
    '',
    'XP Multiplier',
    'Quest Pass',
    'Stoneskin',
    'Quickstrike',
    'Glass Cannon',
    'Phoenix',
    'Vampire',
    'Executioner',
    'Bounty',
    'Eternal Vein',
    'Evergreen',
    'Double Yield',
    'Midas Loop',
    "Philosopher's Coin",
    'Infinite Runes',
    'Everlasting Jewellery',
    'Last Recall',
    "Banker's Call",
    'Hoarder'
];

/** Every bit relic (2..19) owned: bits 2..19 of %relic_owned. */
const ALL_BITS = (1 << 20) - 4;
const bit = (id: number) => 1 << id;
const ownedExcept = (...ids: number[]) => ids.reduce((m, id) => m & ~bit(id), ALL_BITS);

/**
 * Model of [proc,relic_offer_mode]/relic_draw in mode 0 (relic_offer.rs2): advance the seed with
 * seed = (seed * 75 + 74) % 65537, take the (seed % size)-th eligible id (ascending) not drawn yet,
 * up to three times. Returns the ids in offer order and the seed afterwards.
 */
function predictOffer(seed: number, owned: number, xpTier: number, declinedOnly = -1): { ids: number[]; seed: number } {
    const drawn: number[] = [];
    for (let n = 0; n < 3; n++) {
        const pool: number[] = [];
        for (let id = 1; id <= 19; id++) {
            const eligible = id === 1 ? xpTier < 3 : (owned & bit(id)) === 0;
            const inMode = declinedOnly === -1 || (declinedOnly & bit(id)) !== 0;
            if (eligible && inMode && !drawn.includes(id)) pool.push(id);
        }
        if (pool.length === 0) break;
        seed = (seed * 75 + 74) % 65537;
        drawn.push(pool[seed % pool.length]);
    }
    return { ids: drawn, seed };
}

/**
 * The options of the choice dialogue that is open now. Not bot.choices: Player.resumeButtons is only
 * cleared when the script finishes or the modal closes (Player.ts executeScript/closeModal), and
 * if_addresumebutton pushes (PlayerOps.ts IF_ADDRESUMEBUTTON), so when one script pauses on a second
 * choice (Hoarder, several pending offers, Quest Pass) the list still holds the first dialogue's
 * buttons. Keep only buttons of the open chat interface, in order, without duplicates.
 */
function visibleChoices(bot: Bot): { com: number; text: string }[] {
    const root = bot.player.modalChat;
    if (root === -1) return [];
    const texts = bot.texts;
    const out: { com: number; text: string }[] = [];
    for (const com of bot.player.resumeButtons) {
        const c = Component.get(com);
        if (c.rootLayer !== root || out.some(o => o.com === com)) continue;
        out.push({ com, text: texts.get(c.comName ?? '') ?? '' });
    }
    return out;
}
const choiceTexts = (bot: Bot) => visibleChoices(bot).map(c => c.text);

/** Click an option of the open choice by 1-based index or by (part of) its text, then tick. */
function pick(bot: Bot, option: number | string): void {
    const opts = visibleChoices(bot);
    const o = typeof option === 'number' ? opts[option - 1] : opts.find(x => x.text.toLowerCase().includes(option.toLowerCase()));
    if (!o) throw new Error(`pick(${option}): options are ${JSON.stringify(opts.map(x => x.text))}\n${bot.describe()}`);
    bot.clickButton(o.com).tick();
}

/** The ids of the relics in the open offer, read from the choice texts ("Name: effect"). */
function offeredIds(bot: Bot): number[] {
    return choiceTexts(bot).map(c => {
        if (c === 'No thanks') return 0;
        const id = NAMES.indexOf(c.split(':')[0]);
        assert.ok(id > 0, `unexpected choice text "${c}"`);
        return id;
    });
}

function waitForOffer(bot: Bot, maxTicks = 10) {
    bot.waitUntil(() => bot.inDialog && visibleChoices(bot).length >= 2, maxTicks, 'a relic offer');
}

test('first login after the tutorial: three relics from the seed, the pick is granted, the rest declined', t => {
    if (skip()) return t.skip(String(skip()));
    // %relic_seed preset so the draw is known; relic_first_offer only rolls a seed when it is 0.
    const bot = Bot.spawn({ varps: { relic_seed: 5 } });
    waitForOffer(bot);
    assert.equal(bot.varp('relic_started'), 1);
    assert.equal(bot.varp('relic_pending'), 1);

    const expected = predictOffer(5, 0, 0);
    // seed 5 gives Midas Loop, Hoarder, Eternal Vein (observed by hand in relics-m4-offers.md, Observed 3)
    assert.deepEqual(expected.ids, [13, 19, 10]);
    assert.deepEqual(offeredIds(bot), expected.ids);
    assert.equal(choiceTexts(bot)[0], 'Midas Loop: high alch repeats');
    assert.match(bot.dialogText, /Choose a relic/);
    // the advanced seed is only stored once the offer is answered, so closing it cannot reroll it
    assert.equal(bot.varp('relic_seed'), 5);

    pick(bot, 'Midas Loop');
    bot.waitUntilIdle(20);
    bot.expectMessage('You gained the relic: Midas Loop.');
    assert.equal(bot.varp('relic_seed'), expected.seed);
    assert.equal(bot.varp('relic_owned'), bit(13));
    assert.equal(bot.varp('relic_declined'), bit(19) | bit(10));
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.varp('relic_xp_tier'), 0);
    assert.equal(bot.chatModal, null);
});

test('first login with a fresh character rolls a non-zero seed', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn();
    waitForOffer(bot);
    assert.equal(choiceTexts(bot).length, 3);
    assert.notEqual(bot.varp('relic_seed'), 0);
    assert.equal(new Set(offeredIds(bot)).size, 3, 'three distinct relics');
});

test('picking XP Multiplier on the first offer raises the tier instead of an owned bit', t => {
    if (skip()) return t.skip(String(skip()));
    // find a seed whose first offer contains XP Multiplier (id 1)
    let seed = 1;
    while (!predictOffer(seed, 0, 0).ids.includes(1)) seed++;
    const bot = Bot.spawn({ varps: { relic_seed: seed } });
    waitForOffer(bot);
    assert.deepEqual(offeredIds(bot), predictOffer(seed, 0, 0).ids);
    pick(bot, 'XP Multiplier');
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_xp_tier'), 1);
    assert.equal(bot.varp('relic_xp_factor'), 2);
    assert.equal(bot.varp('relic_owned'), 0);
    assert.equal((bot.varp('relic_declined') as number) & bit(1), 0);
});

test('tutorial not done: no offer and the run does not start; finishing it and relogging starts it', t => {
    if (skip()) return t.skip(String(skip()));
    // Bot.spawn with tutorialDone false leaves %tutorial 0 but still logs in at Lumbridge (not on
    // Tutorial Island), so [login,_] does not run @start_tutorial (login.rs2:82) and relic_on_login returns early.
    const bot = Bot.spawn({ tutorialDone: false, varps: { relic_seed: 5 } });
    bot.tick(10);
    assert.equal(bot.varp('tutorial'), 0);
    assert.deepEqual(bot.pos, { x: 3222, z: 3218, level: 0 });
    assert.equal(bot.inDialog, false);
    assert.equal(bot.varp('relic_started'), 0);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.varp('relic_seed'), 5, 'seed untouched');

    bot.setVar('tutorial', 1000);
    const again = bot.relog();
    waitForOffer(again);
    assert.equal(again.varp('relic_started'), 1);
    assert.deepEqual(offeredIds(again), predictOffer(5, 0, 0).ids);
});

test('the same seed gives the same offer, a different seed a different one', t => {
    if (skip()) return t.skip(String(skip()));
    const runs = [5, 5, 6, 1234].map(seed => {
        const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: seed } });
        bot.debugproc('relic_offer');
        waitForOffer(bot);
        const ids = offeredIds(bot);
        assert.deepEqual(ids, predictOffer(seed, 0, 0).ids, `seed ${seed}`);
        bot.remove();
        return ids;
    });
    assert.deepEqual(runs[0], runs[1]);
    assert.notDeepEqual(runs[0], runs[2]);
    assert.notDeepEqual(runs[0], runs[3]);
});

test('closing an offer keeps it pending and unchanged; the next login shows the same three relics', t => {
    if (skip()) return t.skip(String(skip()));
    // run already started and one offer owed: [login,_] -> relic_on_login queues relic_offer_q once (relic_offer.rs2:240-241)
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 5, relic_pending: 1 } });
    waitForOffer(bot);
    const first = predictOffer(5, 0, 0);
    assert.deepEqual(offeredIds(bot), first.ids);

    bot.closeModal().tick();
    // Player.closeModal drops a script paused on p_pausebutton, so nothing is granted or declined
    assert.equal(bot.inDialog, false, bot.describe());
    assert.equal(bot.chatModal, null);
    assert.equal(bot.varp('relic_pending'), 1);
    assert.equal(bot.varp('relic_owned'), 0);
    assert.equal(bot.varp('relic_declined'), 0);
    bot.tick(10);
    assert.equal(bot.inDialog, false, 'not re-offered without a relog');

    assert.equal(bot.varp('relic_seed'), 5, 'a closed offer does not advance the seed');

    const again = bot.relog();
    waitForOffer(again);
    // no reroll: the re-offer shows the same three relics
    assert.deepEqual(offeredIds(again), first.ids);
    pick(again, 1);
    again.waitUntilIdle(20);
    assert.equal(again.varp('relic_pending'), 0);
    assert.equal(again.varp('relic_seed'), first.seed);
    again.expectMessage(`You gained the relic: ${NAMES[first.ids[0]]}.`);
});

test('first login queues the offer once: closing it leaves it owed until a relog', t => {
    if (skip()) return t.skip(String(skip()));
    // relic_on_login starts the run with relic_first_offer (which queues relic_offer_q) and only re-queues an
    // owed offer for a run that had already started (mods/relics/scripts/relic_offer.rs2, [proc,relic_on_login]).
    const bot = Bot.spawn({ varps: { relic_seed: 5 } });
    waitForOffer(bot);
    const first = predictOffer(5, 0, 0);
    assert.deepEqual(offeredIds(bot), first.ids);

    bot.closeModal().tick(10);
    assert.equal(bot.inDialog, false, 'no second offer straight after closing the first');
    assert.equal(bot.varp('relic_pending'), 1);

    const again = bot.relog();
    waitForOffer(again);
    assert.deepEqual(offeredIds(again), first.ids, 'the same offer, not a reroll');
});

test('several pending offers are answered one after another', t => {
    if (skip()) return t.skip(String(skip()));
    // relic_on_login queues relic_offer_q when %relic_pending > 0; relic_offer_pending loops until 0
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 5, relic_pending: 2 } });
    waitForOffer(bot);
    const one = predictOffer(5, 0, 0);
    assert.deepEqual(offeredIds(bot), one.ids);
    pick(bot, 1); // Midas Loop (13)
    waitForOffer(bot);
    assert.equal(bot.varp('relic_pending'), 1);

    const two = predictOffer(one.seed, bit(13), 0);
    assert.deepEqual(offeredIds(bot), two.ids);
    assert.ok(!two.ids.includes(13));
    pick(bot, 1);
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.varp('relic_owned'), bit(13) | (two.ids[0] === 1 ? 0 : bit(two.ids[0])));
    assert.equal(bot.chatModal, null);
});

test('owned relics are never offered', t => {
    if (skip()) return t.skip(String(skip()));
    const owned = ownedExcept(3, 4, 5, 6, 7); // own everything but 3-7 (and 1 is at tier 0)
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 77, relic_owned: owned } });
    let seed = 77;
    for (let i = 0; i < 6; i++) {
        bot.debugproc('relic_offer');
        waitForOffer(bot);
        const ids = offeredIds(bot);
        const p = predictOffer(seed, owned, 0);
        assert.deepEqual(ids, p.ids);
        for (const id of ids) assert.ok([1, 3, 4, 5, 6, 7].includes(id), `offered owned relic ${id}`);
        seed = p.seed;
        bot.closeModal().tick();
        bot.setVar('relic_pending', 0);
        bot.setVar('relic_seed', seed); // a closed offer keeps its seed; move on to get a different draw
    }
});

test('pool shrinking: two left gives two options, one left gives "No thanks", none left gives no dialog', t => {
    if (skip()) return t.skip(String(skip()));
    // XP tier 3 removes XP Multiplier from the pool (relic_eligible)
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 9, relic_xp_tier: 3, relic_xp_factor: 8, relic_owned: ownedExcept(11, 18) } });

    bot.debugproc('relic_offer');
    waitForOffer(bot);
    assert.equal(choiceTexts(bot).length, 2);
    assert.deepEqual([...offeredIds(bot)].sort((a, b) => a - b), [11, 18]);
    assert.match(bot.dialogText, /Choose a relic/);
    pick(bot, 'Evergreen');
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_owned'), ownedExcept(18));
    assert.equal(bot.varp('relic_declined'), bit(18));

    bot.debugproc('relic_offer');
    waitForOffer(bot);
    assert.deepEqual(choiceTexts(bot), ["Banker's Call: bank from anywhere", 'No thanks']);
    assert.match(bot.dialogText, /Take this relic\?/);
    pick(bot, 'No thanks');
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_owned'), ownedExcept(18), 'No thanks grants nothing');
    assert.equal(bot.varp('relic_declined'), bit(18));
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.count('relic_banker_stone'), 0);

    bot.setVar('relic_owned', ALL_BITS);
    const seedBefore = bot.varp('relic_seed');
    bot.debugproc('relic_offer');
    bot.tick(3);
    assert.equal(bot.inDialog, false);
    assert.equal(bot.chatModal, null);
    assert.equal(bot.varp('relic_pending'), 0, 'an empty pool clears the pending count');
    assert.equal(bot.varp('relic_seed'), seedBefore, 'relic_draw does not advance the seed on an empty pool');
});

test('XP Multiplier is offered until tier 3, then never', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 3, relic_owned: ALL_BITS, relic_xp_tier: 2, relic_xp_factor: 4 } });
    bot.debugproc('relic_offer');
    waitForOffer(bot);
    assert.deepEqual(choiceTexts(bot), ['XP Multiplier: XP rate doubles', 'No thanks']);
    pick(bot, 'XP Multiplier');
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_xp_tier'), 3);
    assert.equal(bot.varp('relic_xp_factor'), 8);

    bot.debugproc('relic_offer');
    bot.tick(3);
    assert.equal(bot.inDialog, false, 'nothing left to offer at tier 3');
    assert.equal(bot.varp('relic_pending'), 0);
});

test('XP Multiplier grants: each raises the tier and sets factor 2^tier', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    assert.equal(bot.varp('relic_xp_tier'), 0);
    for (const tier of [1, 2, 3]) {
        bot.debugproc('relic_grant', 1);
        bot.expectMessage('You gained the relic: XP Multiplier.');
        assert.equal(bot.varp('relic_xp_tier'), tier);
        assert.equal(bot.varp('relic_xp_factor'), 2 ** tier);
    }
    assert.equal(bot.varp('relic_owned'), 0);
});

test('XP tiers 1 and 2 give 2x and 4x the XP of tier 0 for the same stat_advance', t => {
    if (skip()) return t.skip(String(skip()));
    // tier 3 (8x) is covered in tests/relics.test.ts
    const plain = Bot.spawn({ varps: { relic_started: 1 } });
    const t1 = Bot.spawn({ varps: { relic_started: 1 } });
    const t2 = Bot.spawn({ varps: { relic_started: 1 } });
    t1.debugproc('relic_grant', 1);
    t2.debugproc('relic_grant', 1).debugproc('relic_grant', 1);

    for (const b of [plain, t1, t2]) b.debugproc('relic_xptest'); // stat_advance(fletching, 1000)
    assert.ok(plain.xp('fletching') > 0);
    assert.equal(t1.xp('fletching'), plain.xp('fletching') * 2);
    assert.equal(t2.xp('fletching'), plain.xp('fletching') * 4);
});

test('XP tier 2 gives 4x prayer XP for burying bones (a real skill action)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = Bot.spawn({ varps: { relic_started: 1 } });
    const boosted = Bot.spawn({ varps: { relic_started: 1, relic_xp_tier: 2, relic_xp_factor: 4 } });
    for (const b of [plain, boosted]) {
        const before = b.xp('prayer');
        b.clearInv().give('bones');
        b.opHeld('bones', 1);
        b.waitForMessage('You bury the bones.', 5);
        b.waitUntil(() => b.xp('prayer') > before, 5, 'prayer xp');
    }
    assert.ok(plain.xp('prayer') > 0);
    assert.equal(boosted.xp('prayer'), plain.xp('prayer') * 4);
});

test('Hoarder opens a second offer drawn only from declined relics; the pick leaves the declined set', t => {
    if (skip()) return t.skip(String(skip()));
    // pool is exactly {3, 4, 19}: everything else owned and XP at tier 3
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 11, relic_xp_tier: 3, relic_xp_factor: 8, relic_owned: ownedExcept(3, 4, 19) } });
    bot.debugproc('relic_offer');
    waitForOffer(bot);
    assert.deepEqual([...offeredIds(bot)].sort((a, b) => a - b), [3, 4, 19]);
    pick(bot, 'Hoarder');

    // relic_grant(19) -> relic_offer_mode(1): only declined relics (3 and 4 were just declined)
    waitForOffer(bot);
    bot.expectMessage('You gained the relic: Hoarder.');
    assert.equal(choiceTexts(bot).length, 2);
    assert.deepEqual([...offeredIds(bot)].sort((a, b) => a - b), [3, 4]);
    assert.equal(bot.varp('relic_declined'), bit(3) | bit(4));
    pick(bot, 'Quickstrike');
    bot.waitUntilIdle(20);
    bot.expectMessage('You gained the relic: Quickstrike.');

    assert.equal(bot.varp('relic_owned'), ownedExcept(3));
    assert.equal(bot.varp('relic_declined'), bit(3), 'Quickstrike left the declined set, Stoneskin stays');
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.chatModal, null);
});

test('Hoarder second offer skips declined relics that are owned since, and offers declined XP Multiplier', t => {
    if (skip()) return t.skip(String(skip()));
    // declined: 1 (XP, tier 0) and 5 (now owned). Mode 1 pool = eligible AND declined = {1}.
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 2, relic_owned: bit(5), relic_declined: bit(1) | bit(5) } });
    bot.debugproc('relic_grant', 19);
    waitForOffer(bot);
    assert.deepEqual(choiceTexts(bot), ['XP Multiplier: XP rate doubles', 'No thanks']);
    pick(bot, 'XP Multiplier');
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_xp_tier'), 1);
    assert.equal(bot.varp('relic_declined'), bit(5));
});

test('Hoarder with nothing declined is granted and opens no offer', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_seed: 4 } });
    bot.debugproc('relic_grant', 19);
    bot.tick(3);
    bot.expectMessage('You gained the relic: Hoarder.');
    assert.equal(bot.varp('relic_owned'), bit(19));
    assert.equal(bot.inDialog, false);
    assert.equal(bot.chatModal, null);
    assert.equal(bot.varp('relic_seed'), 4, 'no draw happened');
});

test('Quest Pass completes every quest through @complete_all_quests', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    assert.equal(bot.varp('qp'), 0);
    assert.equal(bot.varp('cookquest'), 0);

    bot.debugproc('relic_grant', 2);
    bot.expectMessage('You gained the relic: Quest Pass.');
    assert.equal(bot.varp('relic_owned'), bit(2));

    // [label,complete_all_quests] (cheat_quest.rs2:332-334) asks two side choices first
    waitForOffer(bot);
    assert.match(bot.dialogText, /Choose a gang for Shield of Arrav/);
    pick(bot, 'Black Arm Gang.');
    waitForOffer(bot);
    assert.match(bot.dialogText, /Choose a side for Temple of Ikov/);
    pick(bot, 'Lucien.');
    bot.waitForMessage('All quests have been completed.', 5);

    // Each queued *_complete script opens a quest scroll (send_quest_complete, quests.rs2) and a
    // normal queue does not run while a modal is open (Player.processQueue canAccess), so close them.
    let scrolls = 0;
    bot.waitUntil(
        () => {
            if (bot.mainModal !== null) {
                scrolls++;
                bot.closeModal();
            } else if (bot.inDialog) {
                // druid_quest_complete talks through Kaqemeex (queued when npc_find near 0_45_54_45_30 finds him)
                if (visibleChoices(bot).length > 0) pick(bot, 1);
                else bot.continueDialog();
            }
            return bot.player.queue.head() === null && bot.mainModal === null && !bot.inDialog;
        },
        400,
        'every quest completion queue to run'
    );
    bot.tick(2);

    // 63 quest scrolls, one per quest (observed); quest.constant has 63 ^*_questpoints constants summing to 135
    assert.equal(scrolls, 63);
    assert.equal(bot.varp('cookquest'), 2); // ^cook_complete (quest.constant:12)
    assert.equal(bot.varp('runemysteries'), 6); // ^runemysteries_complete (quest.constant:48)
    const counted = bot.call('count_questpoints').intStack[0];
    assert.equal(bot.varp('blackarmgang'), 4); // Black Arm side: ^blackarmgang_complete (quest.constant:7)
    assert.equal(bot.varp('phoenixgang'), 0);
    assert.equal(bot.varp('ikov'), 90); // Lucien side: ^ikov_completed_lucien (quest.constant:35)
    assert.equal(counted, 135, 'every quest counted by ~count_questpoints');
    assert.equal(bot.varp('qp'), 135);
});

test('::~relic_reset clears every relic varp', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({
        varps: { relic_started: 1, relic_seed: 99, relic_owned: ownedExcept(2), relic_declined: bit(2), relic_tasks_done: 7, relic_xp_tier: 2, relic_xp_factor: 4, relic_pending: 0 }
    });
    bot.debugproc('relic_reset');
    bot.expectMessage('relic state cleared');
    for (const v of ['relic_owned', 'relic_declined', 'relic_tasks_done', 'relic_xp_tier', 'relic_seed', 'relic_started', 'relic_pending']) {
        assert.equal(bot.varp(v), 0, v);
    }
    assert.equal(bot.varp('relic_xp_factor'), 1, 'pow(2, 0)');
});

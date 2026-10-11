// Relic 30 Light Fingers and tasks 41 (steal from a gem stall) and 42 (pickpocket a guard).
// Mod code: mods/relics/scripts/relic_thieving.rs2. Content hooks: grep "relic hook" in skill_thieving/scripts/thieving.rs2.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, spawnNpc, World } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';
import { isDone, locNear, standNear } from './relic-helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

const LIGHT_FINGERS = 30;
const GEM_STALL_TASK = 41;
const GUARD_TASK = 42;
const ARDOUGNE_GEMS = { x: 2667, z: 3303 };
const VARROCK_TEA = { x: 3269, z: 3410 };

/** A thief with the given relics. Every other task is marked done so that a completion does not open an offer over the test. */
function thief(relics: number[], levels: Record<string, number> = { thieving: 99, hitpoints: 99 }, at?: { x: number; z: number; level?: number }): Bot {
    const bot = Bot.spawn({ levels, at });
    bot.clearInv();
    bot.setVar('relic_tasks_done', 0x7fffffff);
    bot.setVar('relic_tasks_done2', 0x7fffffff & ~((1 << (GEM_STALL_TASK - 32)) | (1 << (GUARD_TASK - 32))));
    return bot.setVar('relic_owned', relics.reduce((m, id) => m | (1 << id), 0));
}

function stallBot(relics: number[], type: string, near: { x: number; z: number }) {
    const loc = locNear(type, near.x, near.z, 30);
    const bot = thief(relics, { thieving: 99, hitpoints: 99 }, standNear(loc));
    // the stall owner and the town guards stop a theft they can see (steal_from_stall): take every spawned npc away
    for (const npc of World.npcs) {
        if (npc && npc.isActive && Math.max(Math.abs(npc.x - bot.x), Math.abs(npc.z - bot.z)) <= 10) World.removeNpc(npc, 100000);
    }
    bot.tick(2);
    return { bot, loc };
}

/** True while a stall of this type stands near the spot (a stolen-from stall is swapped for the empty market table for a while). */
function stallStands(type: string, near: { x: number; z: number }): boolean {
    try {
        locNear(type, near.x, near.z, 30);
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------- pickpocketing

test('light fingers: one click on a man picks his pocket again and again, and never fails', t => {
    if (skip()) return t.skip(String(skip()));
    // thieving level 1: the man's success chance is low, so without the relic some of these attempts fail (control below)
    const bot = thief([LIGHT_FINGERS], { thieving: 1, hitpoints: 99 });
    const man = spawnNpc('man', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(man, 3);
    bot.tick(80);
    const picked = bot.messages.filter(m => m === "You pick the man's pocket.").length;
    const failed = bot.messages.filter(m => m === "You fail to pick the man's pocket.").length;
    assert.equal(failed, 0, 'a relic owner never fails');
    assert.ok(picked >= 15, `only ${picked} pickpockets in 80 ticks from one click`);
    assert.ok(bot.count('coins') >= 3 * picked, 'the loot arrives');
});

test('light fingers control: without the relic a level 1 thief fails now and then and needs a click per attempt', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = thief([], { thieving: 1, hitpoints: 99 });
    const man = spawnNpc('man', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(man, 3);
    bot.tick(80);
    const attempts = bot.messages.filter(m => /^You (pick|fail to pick) the man's pocket\.$/.test(m)).length;
    assert.equal(attempts, 1, 'one click is one attempt');
});

test('light fingers: stops when the backpack is full of items that do not stack', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = thief([LIGHT_FINGERS]);
    const man = spawnNpc('man', { x: bot.x + 2, z: bot.z });
    bot.tick();
    for (let i = 0; i < 27; i++) bot.give('bones');
    bot.opNpc(man, 3);
    bot.tick(30);
    const attempts = bot.messages.filter(m => /^You (pick|fail to pick) the man's pocket\.$/.test(m)).length;
    assert.ok(attempts <= 40, 'no endless loop');
    assert.equal(bot.count('bones'), 27);
});

// ---------------------------------------------------------------- stalls

test('light fingers: one click on a stall steals again and again and the stall never empties', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, loc } = stallBot([LIGHT_FINGERS], 'tea_stall', VARROCK_TEA);
    const xp0 = bot.xp('thieving');
    bot.opLoc(loc, 2);
    bot.tick(60);
    const steals = bot.messages.filter(m => /^You steal/.test(m)).length;
    assert.ok(steals >= 10, `only ${steals} thefts in 60 ticks from one click`);
    assert.ok(bot.xp('thieving') > xp0);
    assert.ok(stallStands('tea_stall', VARROCK_TEA), 'the stall was never swapped for the empty market table');
});

test('light fingers control: without the relic a stall gives one theft and then becomes the empty market table', t => {
    if (skip()) return t.skip(String(skip()));
    const { bot, loc } = stallBot([], 'tea_stall', VARROCK_TEA);
    bot.opLoc(loc, 2);
    bot.waitForMessage(/^You steal/, 30);
    bot.tick(2);
    assert.equal(stallStands('tea_stall', VARROCK_TEA), false, 'the stall is now the empty market table');
    bot.tick(40);
    const steals = bot.messages.filter(m => /^You steal/.test(m)).length;
    assert.equal(steals, 1);
});

// ---------------------------------------------------------------- tasks 41 and 42

test('task 41: stealing from a gem stall (a tea stall does not count)', t => {
    if (skip()) return t.skip(String(skip()));
    const tea = stallBot([], 'tea_stall', VARROCK_TEA);
    tea.bot.opLoc(tea.loc, 2);
    tea.bot.tick(20);
    assert.ok(tea.bot.messages.some(m => /^You steal/.test(m)));
    assert.equal(isDone(tea.bot, GEM_STALL_TASK), false);

    const { bot, loc } = stallBot([], 'gem_stall_stealing', ARDOUGNE_GEMS);
    bot.opLoc(loc, 2);
    bot.waitForMessage(/^You steal/, 30);
    bot.waitUntil(() => isDone(bot, GEM_STALL_TASK), 20, 'task 41');
    bot.expectMessage(/^Relic task 41 complete!$/);
});

test('task 42: pickpocketing a guard (a man does not count)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = thief([]);
    const man = spawnNpc('man', { x: bot.x + 2, z: bot.z });
    bot.tick();
    for (let i = 0; i < 10 && !bot.messages.includes("You pick the man's pocket."); i++) {
        bot.opNpc(man, 3);
        bot.waitForMessage(/You (pick|fail to pick) the man's pocket\./, 30);
        bot.tick(10); // stun and %action_delay
    }
    assert.ok(bot.messages.includes("You pick the man's pocket."));
    assert.equal(isDone(bot, GUARD_TASK), false);

    bot.setVar('relic_owned', 1 << LIGHT_FINGERS); // never fails: the rest of the test is about the task, not the dice
    for (const type of ['guard1', 'guard2', 'ardougne_guard']) {
        bot.setVar('relic_tasks_done2', 0x7fffffff & ~(1 << (GUARD_TASK - 32)));
        const guard = spawnNpc(type, { x: bot.x, z: bot.z + 2 });
        bot.tick();
        bot.opNpc(guard, 3);
        bot.waitUntil(() => isDone(bot, GUARD_TASK), 30, `task 42 from a ${type}`);
        bot.expectMessage(/^Relic task 42 complete!$/);
        bot.walkTo({ x: bot.x + 1, z: bot.z }); // end the repeating pickpocket
        bot.tick(5);
    }
});

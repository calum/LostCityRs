// Every relic task must stay completable when the player owns every relic at once. Relics change what the
// task hooks see (Eternal Vein smelts a mined ore into a bar before it reaches the inventory, Evergreen and
// Eternal Vein send products to the bank, Double Yield doubles them, Executioner and Glass Cannon change
// kills), so a task keyed on an item can silently stop firing. One test per task number, all relics owned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot, spawnNpc } from '../harness/src/index.js';
import type { CoordLike } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';
import { dbrows, isDone, locNear, standNear, tasksDone } from './relic-helpers.js';
import { defineSkillingTaskTests } from './relic-skilling-task-flows.js';

useVanillaWorld(); // relic_started = 1 on every bot: no first-login offer

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');

const read = (file: string) => fs.readFileSync(new URL(`../mods/relics/${file}`, import.meta.url), 'utf8');

/** Highest relic id: the `case N :` lines of [proc,relic_name] in relic_offer.rs2. New relics are picked up automatically. */
function relicIds(): number[] {
    const src = read('scripts/relic_offer.rs2');
    const body = src.slice(src.indexOf('[proc,relic_name]'), src.indexOf('[proc,relic_desc]'));
    return [...body.matchAll(/case (\d+) :/g)].map(m => Number(m[1]));
}

/** Task 37 (death rune) was retired: the death altar is not usable in the game, so the task can never be done. Its number stays reserved. */
const RETIRED_TASK = 37;

/** ^relic_task_count of relic.constant (the highest task number, retired 37 included). */
function taskCount(): number {
    return Number(/\^relic_task_count = (\d+)/.exec(read('configs/relic.constant'))![1]);
}

/**
 * relic_owned with every relic bit set. Id 1 (XP Multiplier) is a tier in relic_xp_tier, not a bit
 * (relic_offer.rs2 relic_grant). Quest Pass (2) and Hoarder (19) only act when granted, so setting the bit is enough.
 */
function allRelicVarps(): Record<string, number> {
    let owned = 0;
    for (const id of relicIds()) if (id >= 2) owned |= 1 << id;
    return { relic_owned: owned, relic_xp_tier: 3 };
}

function spawn(levels: Record<string, number> = {}, at?: CoordLike): Bot {
    return Bot.spawn({ varps: allRelicVarps(), levels, at });
}

/** The relic argument the real gathering sites pass to ~relic_gathered: mining 10, woodcutting 11, everything else 0. */
function gatherRelic(obj: string): number {
    if (/_ore$|^coal$|^clay$/.test(obj)) return 10;
    if (/_logs$/.test(obj)) return 11;
    return 0;
}

function expectDone(bot: Bot, task: number) {
    assert.ok(isDone(bot, task), `task ${task} not done (done mask ${tasksDone(bot).toString(2)})`);
    bot.expectMessage(`Relic task ${task} complete!`);
}

test('all relics: the harness gives the bot every relic', t => {
    if (skip()) return t.skip(String(skip()));
    const ids = relicIds();
    assert.ok(ids.length >= 19);
    const bot = spawn();
    for (const id of ids) {
        if (id === 1) assert.equal(bot.varp('relic_xp_tier'), 3);
        else assert.equal(((bot.varp('relic_owned') as number) >>> id) & 1, 1, `relic ${id}`);
    }
});

test('all relics: every task number 1..count has a driver below or a table row', t => {
    if (skip()) return t.skip(String(skip()));
    const rowTasks = new Set(dbrows().map(r => r.task));
    const missing: number[] = [];
    for (let task = 1; task <= taskCount(); task++) {
        if (task === RETIRED_TASK) continue;
        if (!rowTasks.has(task) && !HOOK_TASKS.has(task)) missing.push(task);
    }
    assert.deepEqual(missing, [], 'tasks with no table row and no entry in HOOK_TASKS');
});

/** Tasks that are hard-coded in script hooks, not table rows (relic_gather.rs2 relic_task_burn, relic_task_pickpocket, relic_task_steal, relic_task_spell, relic_level99). */
const HOOK_TASKS = new Set([7, 13, 38, 39, 40, 41, 42]);

// ---------------------------------------------------------------- table rows

for (const row of dbrows()) {
    test(`all relics: ${row.table === 'relic_task_npc' ? 'kill' : 'product'} row ${row.name} (${row.key}) completes task ${row.task}`, t => {
        if (skip()) return t.skip(String(skip()));
        const bot = spawn();
        bot.clearInv();
        if (row.table === 'relic_task_npc') {
            bot.debugproc('relic_kill', row.key); // relic_debug.rs2: npc_add, npc_heropoints, npc_queue(3): the real death script
        } else {
            bot.debugproc('relic_gather', row.key, gatherRelic(row.key));
        }
        bot.waitUntil(() => isDone(bot, row.task), 15, `task ${row.task}`);
        expectDone(bot, row.task);
        assert.equal(bot.choices.length, 0, 'with every relic owned there is nothing left to offer');
    });
}

// ---------------------------------------------------------------- fishing with Double Yield (fish arrive cooked)

test('all relics: catching a swordfish (task 9) and a shark (task 10) through the fishing hook, which hands them over cooked', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();
    bot.debugproc('relic_fish', 'raw_swordfish'); // relic_debug.rs2: ~relic_fished, the call the four fishing.rs2 sites make
    bot.waitUntil(() => isDone(bot, 9), 15, 'task 9');
    bot.debugproc('relic_fish', 'raw_shark');
    bot.waitUntil(() => isDone(bot, 10), 15, 'task 10');
    expectDone(bot, 9);
    expectDone(bot, 10);
});

// ---------------------------------------------------------------- mining with Eternal Vein (ore goes to the bank as a bar)

// Was a bug: the task hook was only called with the ore, and Eternal Vein turns silver_ore into silver_bar
// before it reaches the bank, so task 11 (the silver bar row) could never fire for a miner holding Eternal Vein.
test('all relics: mining silver ore (banked as a bar) completes task 11', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();
    bot.debugproc('relic_gather', 'silver_ore', 10);
    bot.waitUntil(() => isDone(bot, 11), 15, 'task 11');
    expectDone(bot, 11);
    // Double Yield: two bars; Forge Echo (26) rolls once per bar and adds one more bar each time, so 2 to 4
    const bars = bot.count('silver_bar', 'bank');
    assert.ok(bars >= 2 && bars <= 4, `${bars} bars in the bank`);
});

test('all relics: a real silver rock gives task 11 and bars in the bank', t => {
    if (skip()) return t.skip(String(skip()));
    const rock = locNear('silverrock1', 3300, 3300, 40);
    const bot = spawn({ mining: 99, hitpoints: 99, defence: 99 }, standNear(rock));
    bot.clearInv().give('rune_pickaxe');
    bot.opLoc(rock, 1);
    bot.waitForMessage('You manage to mine some silver.', 300);
    bot.tick(3);
    expectDone(bot, 11);
    assert.ok(bot.count('silver_bar', 'bank') >= 1);
    assert.equal(bot.count('silver_ore'), 0);
});

test('all relics: a real mithril rock (banked as a bar) completes task 4', t => {
    if (skip()) return t.skip(String(skip()));
    const rock = locNear('mithrilrock1', 3243, 3160, 10);
    const bot = spawn({ mining: 99 }, standNear(rock));
    bot.clearInv().give('rune_pickaxe');
    bot.opLoc(rock, 1);
    bot.waitForMessage(/^Relic task 4 complete!$/, 300);
    assert.ok(bot.count('mithril_bar', 'bank') >= 1);
});

// ---------------------------------------------------------------- real skilling flows

test('all relics: chopping a real maple (task 5) and yew (task 20)', t => {
    if (skip()) return t.skip(String(skip()));
    const maple = locNear('mapletree', 2655, 3521, 20);
    const bot = spawn({ woodcutting: 99 }, standNear(maple));
    bot.clearInv().give('rune_axe');
    bot.opLoc(maple, 1);
    bot.waitForMessage(/^Relic task 5 complete!$/, 200);
    assert.ok(bot.count('maple_logs', 'bank') >= 1, 'Evergreen sends the logs to the bank');
    const yew = locNear('yewtree', 2705, 3459, 20);
    bot.teleport(standNear(yew));
    bot.opLoc(yew, 1);
    bot.waitForMessage(/^Relic task 20 complete!$/, 300);
});

test('all relics: burning a yew log taken out of the bank (task 7)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ firemaking: 99 }, { x: 3232, z: 3222, level: 0 }); // each test lights its fire on its own tile: fires outlast the test
    bot.clearInv().give('tinderbox').give('yew_logs');
    bot.useOnHeld('yew_logs', 'tinderbox');
    bot.waitForMessage('The fire catches and the logs begin to burn.', 200);
    bot.waitForMessage(/^Relic task 7 complete!$/, 10);
});

test('all relics: stringing a magic shortbow (task 6)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ fletching: 99 });
    bot.clearInv().give('unstrung_magic_shortbow').give('bow_string');
    bot.useOnHeld('bow_string', 'unstrung_magic_shortbow');
    bot.waitForMessage(/^Relic task 6 complete!$/, 10);
});

test('all relics: brewing a super attack potion (task 12)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ herblore: 99 });
    bot.clearInv().give('iritvial').give('eye_of_newt');
    bot.useOnHeld('eye_of_newt', 'iritvial');
    bot.waitForMessage(/^Relic task 12 complete!$/, 20);
});

test('all relics: smelting silver ore at a furnace (task 11)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ smithing: 99 });
    bot.clearInv().give('silver_ore');
    const furnace = locNear('furnace1', bot.x, bot.z, 60);
    bot.teleport(standNear(furnace));
    bot.useOnLoc('silver_ore', furnace);
    bot.waitForMessage(/^Relic task 11 complete!$/, 100);
});

test('all relics: cooking a raw shark (task 10) on a fire', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ firemaking: 99, cooking: 99 }, { x: 3228, z: 3224, level: 0 });
    bot.clearInv().give('tinderbox').give('logs');
    bot.useOnHeld('logs', 'tinderbox');
    bot.waitForMessage('The fire catches and the logs begin to burn.', 100);
    bot.tick(12);
    const fire = bot.findLoc('fire', 3);
    bot.give('raw_shark', 10);
    for (let i = 0; i < 10 && !isDone(bot, 10); i++) {
        bot.tick(3);
        bot.useOnLoc('raw_shark', fire);
        bot.waitForMessage(/nicely cooked|accidentally burn/, 20);
        bot.tick(2);
    }
    bot.waitUntil(() => isDone(bot, 10), 5, 'task 10');
});

test('all relics: pickpocketing a paladin (task 13)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ thieving: 99, hitpoints: 99 });
    bot.clearInv();
    const paladin = spawnNpc('paladin', { x: bot.x + 2, z: bot.z });
    bot.tick();
    for (let i = 0; i < 20 && !isDone(bot, 13); i++) {
        bot.opNpc(paladin, 3);
        bot.waitForMessage(/You (pick|fail to pick) the paladin's pocket\./, 30);
        bot.tick(12);
    }
    expectDone(bot, 13);
});

test('all relics: a real melee kill of a goblin (task 1) with Glass Cannon, Executioner, Vampire and Bounty on', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ attack: 99, strength: 99, defence: 99, hitpoints: 99 });
    const goblin = spawnNpc('goblin', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(goblin, 2);
    bot.waitUntil(() => !goblin.isActive, 100, 'the goblin to die');
    expectDone(bot, 1);
});

// ---------------------------------------------------------------- tasks 26-31 (skilling)

defineSkillingTaskTests('all relics', spawn, skip);

// ---------------------------------------------------------------- everything at once

test('all relics: every task, one after another on one character, ends with all task bits set', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();
    // the two final bosses (tasks 24, 25) last: winning opens a message box that holds back later queued completions
    const rows = dbrows().sort((a, b) => Number(a.task === 24 || a.task === 25) - Number(b.task === 24 || b.task === 25));
    for (const row of rows) {
        if (row.table === 'relic_task_npc') bot.debugproc('relic_kill', row.key);
        else bot.debugproc('relic_gather', row.key, gatherRelic(row.key));
    }
    bot.debugproc('relic_gather', 'silver_ore', 10);
    bot.tick(10);
    // 7, 13, 38, 39, 41 and 42 are hook tasks (real sites are tested above): complete them with the debug proc
    for (const task of [7, 13, 38, 39, 40, 41, 42]) bot.debugproc('relic_task', task);
    bot.tick(10);
    // tasks 1-31 fill the first varp (bits 0-30), 32 and up the second (bit = task - 32)
    const count = taskCount();
    const full1 = (2 ** Math.min(count, 31) - 1) | 0;
    assert.equal(tasksDone(bot) | 0, full1, `done ${(tasksDone(bot) >>> 0).toString(2)} of ${(full1 >>> 0).toString(2)}`);
    const full2 = (2 ** (count - 31) - 1) & ~(1 << (RETIRED_TASK - 32));
    assert.equal(bot.varp('relic_tasks_done2'), full2, 'second varp');
});

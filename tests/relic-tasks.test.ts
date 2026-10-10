// Relic mode task engine (mods/relics/scripts/relic_tasks.rs2, [queue,relic_task_done] in relic_offer.rs2,
// the product hooks in relic_gather.rs2). Kills go through the real death scripts; products through real
// skilling where it is cheap, and through the gather hook for every table row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot, World, ids, spawnNpc } from '../harness/src/index.js';
import type { CoordLike } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import LocType from '../Engine-TS/src/cache/config/LocType.js';
import { CoordGrid } from '../Engine-TS/src/engine/CoordGrid.js';
import type Loc from '../Engine-TS/src/engine/entity/Loc.js';
import { findPathToLoc, isMapBlocked, reachedLoc } from '../Engine-TS/src/engine/GameMap.js';

useVanillaWorld(); // relic_started = 1 on every bot: no first-login offer

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');

// Relic 2 (Quest Pass) queues @complete_all_quests, which opens quest choice dialogues, and relic 19
// (Hoarder) opens a second offer (relic_offer.rs2 relic_grant). Owning them keeps them out of the
// offer pool (relic_eligible), so picking an offer here only ever grants a relic with no follow-up dialogue.
const NO_FOLLOWUP_RELICS = (1 << 2) | (1 << 19);

function spawn(levels: Record<string, number> = {}, at?: CoordLike): Bot {
    return Bot.spawn({ varps: { relic_owned: NO_FOLLOWUP_RELICS }, levels, at });
}

function tasksDone(bot: Bot): number {
    return bot.varp('relic_tasks_done') as number;
}

function isDone(bot: Bot, task: number): boolean {
    return ((tasksDone(bot) >>> (task - 1)) & 1) === 1; // bit = task - 1 (relic_tasks.rs2:1)
}

function completions(bot: Bot, task: number): number {
    return bot.messages.filter(m => m === `Relic task ${task} complete!`).length;
}

/** Wait for the offer [queue,relic_task_done] opens, pick the first relic, check it was granted. */
function takeOffer(bot: Bot): string {
    bot.waitUntil(() => bot.choices.length >= 2, 20, 'a relic offer');
    const name = bot.choices[0].split(':')[0];
    bot.choose(1);
    bot.waitForMessage(`You gained the relic: ${name}.`, 5);
    bot.skipDialog();
    bot.waitUntil(() => bot.player.activeScript === null && bot.chatModal === null, 20, 'the offer to close');
    assert.equal(bot.varp('relic_pending'), 0);
    return name;
}

type Row = { name: string; table: string; task: number; key: string };

/** The rows of mods/relics/configs/relic_tasks.dbrow (the source the pack was built from). */
function dbrows(): Row[] {
    const text = fs.readFileSync(new URL('../mods/relics/configs/relic_tasks.dbrow', import.meta.url), 'utf8');
    const rows: Row[] = [];
    let cur: Partial<Row> | null = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const head = /^\[(.+)\]$/.exec(line);
        if (head) {
            if (cur) rows.push(cur as Row);
            cur = { name: head[1] };
            continue;
        }
        if (!cur) continue;
        let m;
        if ((m = /^table=(.+)$/.exec(line))) cur.table = m[1];
        else if ((m = /^data=task,(\d+)$/.exec(line))) cur.task = Number(m[1]);
        else if ((m = /^data=(npc|obj),(.+)$/.exec(line))) cur.key = m[2];
    }
    if (cur) rows.push(cur as Row);
    return rows;
}

/** Nearest loc of a type around a coord, searched in the loaded map (wider than Bot.findLoc). */
function locNear(type: string, x: number, z: number, radius: number): Loc {
    const id = ids.loc(type);
    let best: Loc | null = null;
    let bestDist = Infinity;
    for (let zx = x - radius; zx <= x + radius + 7; zx += 8) {
        for (let zz = z - radius; zz <= z + radius + 7; zz += 8) {
            for (const loc of World.gameMap.getZone(zx, zz, 0).getAllLocsUnsafe()) {
                if (loc.type !== id || !loc.isActive) continue;
                const d = Math.max(Math.abs(loc.x - x), Math.abs(loc.z - z));
                if (d <= radius && d < bestDist) {
                    best = loc;
                    bestDist = d;
                }
            }
        }
    }
    if (!best) throw new Error(`no ${type} within ${radius} of ${x},${z}`);
    return best;
}

/** A free tile near a loc from which the engine's route finder reaches it (to teleport a bot to). */
function standNear(loc: Loc): { x: number; z: number; level: number } {
    const fa = LocType.get(loc.type).forceapproach;
    for (let r = 1; r <= 4; r++) {
        for (let dx = -r; dx <= r + loc.width - 1; dx++) {
            for (let dz = -r; dz <= r + loc.length - 1; dz++) {
                const x = loc.x + dx;
                const z = loc.z + dz;
                if (isMapBlocked(x, z, loc.level)) continue;
                const route = findPathToLoc(loc.level, x, z, loc.x, loc.z, 1, loc.width, loc.length, loc.angle, loc.shape, fa);
                const end = route.length ? CoordGrid.unpackCoord(route[route.length - 1]) : { x, z };
                if (reachedLoc(loc.level, end.x, end.z, loc.x, loc.z, loc.width, loc.length, 1, loc.angle, loc.shape, fa)) {
                    return { x, z, level: loc.level };
                }
            }
        }
    }
    throw new Error(`no free tile next to loc ${loc.type} at ${loc.x},${loc.z}`);
}

// ---------------------------------------------------------------- kills

/** Attack a freshly spawned goblin until it dies (real melee through [opnpc2]). */
function killGoblin(bot: Bot) {
    const goblin = spawnNpc('goblin', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(goblin, 2); // "Attack"
    bot.waitUntil(() => !goblin.isActive, 100, 'the goblin to die');
    return goblin;
}

test('kill task: a real melee kill of a goblin completes task 1 and owes an offer; a chicken kill does not', t => {
    if (skip()) return t.skip(String(skip()));
    let bot = spawn({ attack: 99, strength: 99, defence: 99, hitpoints: 99 });

    // control: an NPC with no relic_task_npc row
    const chicken = spawnNpc('chicken', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(chicken, 2);
    bot.waitUntil(() => !chicken.isActive, 100, 'the chicken to die');
    bot.tick(5);
    assert.equal(tasksDone(bot), 0);
    bot.expectNoMessage(/^Relic task/);
    assert.equal(bot.choices.length, 0);

    const goblin = spawnNpc('goblin', { x: bot.x + 2, z: bot.z });
    bot.tick();
    bot.opNpc(goblin, 2); // "Attack"
    // [proc,npc_death] -> ~relic_on_kill runs at the start of the death (npc_death.rs2:11), so the task
    // completes while the goblin is still in its death delay
    bot.waitForMessage(/^Relic task 1 complete!$/, 100);
    assert.equal(tasksDone(bot), 1); // bit 0 only
    bot.waitUntil(() => !goblin.isActive, 10, 'the goblin to despawn');
    // relic_task_done queues the offer 3 ticks later, after the dying goblin's last swing (its if_close,
    // npc_combat_melee.rs2:36, would drop an open dialog): see the next test.
    bot.waitUntil(() => bot.choices.length === 3, 10, 'a 3-relic offer');
    assert.equal(bot.varp('relic_pending'), 1);

    const owned0 = bot.varp('relic_owned') as number;
    const xpTier0 = bot.varp('relic_xp_tier') as number;
    const name = takeOffer(bot);
    const owned1 = bot.varp('relic_owned') as number;
    const xpTier1 = bot.varp('relic_xp_tier') as number;
    // exactly one relic gained: a new owned bit, or one XP tier (relic 1 is a tier, relic_offer.rs2 relic_grant)
    const gained = owned1 !== owned0 ? 1 : 0;
    assert.equal(gained + (xpTier1 - xpTier0), 1, `granted ${name}`);
    assert.equal(tasksDone(bot), 1);
});

// Was a bug: the offer opened inside npc_death and the dying NPC's last swing closed it (fixed by delaying the offer).
test('kill task: the offer from a real kill stays open after the goblin dies', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ attack: 99, strength: 99, defence: 99, hitpoints: 99 });
    killGoblin(bot);
    bot.expectMessage(/^Relic task 1 complete!$/);
    bot.waitUntil(() => bot.choices.length === 3, 10, 'the relic offer');
    bot.tick(5);
    assert.equal(bot.choices.length, 3, 'the relic offer should still be open');
});


test('every relic_task_npc row: the real death script ([ai_queue3] via ::~relic_kill) completes its task', t => {
    if (skip()) return t.skip(String(skip()));
    const rows = dbrows().filter(r => r.table === 'relic_task_npc');
    assert.ok(rows.length >= 18);
    const failed: string[] = [];
    for (const row of rows) {
        const bot = spawn();
        // relic_debug.rs2 relic_kill: npc_add east of the player, npc_heropoints(10), npc_queue(3,0,0)
        bot.debugproc('relic_kill', row.key);
        try {
            bot.waitUntil(() => isDone(bot, row.task), 15, `task ${row.task}`);
            bot.expectMessage(`Relic task ${row.task} complete!`);
            assert.equal(tasksDone(bot), 1 << (row.task - 1), `${row.key} set only bit ${row.task - 1}`);
        } catch (e) {
            failed.push(`${row.name} (${row.key} -> task ${row.task}): ${(e as Error).message.split('\n')[0]}`);
        }
        bot.remove();
    }
    assert.deepEqual(failed, []);
});

// ---------------------------------------------------------------- products

test('every relic_task_obj row: producing the object through the gather hook completes its task', t => {
    if (skip()) return t.skip(String(skip()));
    const rows = dbrows().filter(r => r.table === 'relic_task_obj');
    assert.ok(rows.length >= 10);
    const failed: string[] = [];
    for (const row of rows) {
        const bot = spawn();
        bot.clearInv();
        // relic_debug.rs2 relic_gather -> [proc,relic_gathered] (relic_gather.rs2), which is the hook at the
        // woodcutting, mining, fishing and cooking sites and calls ~relic_task_obj like the other sites
        bot.debugproc('relic_gather', row.key, 0);
        try {
            bot.waitUntil(() => isDone(bot, row.task), 5, `task ${row.task}`);
            bot.expectMessage(`Relic task ${row.task} complete!`);
            assert.equal(bot.count(row.key), 1, `the hook also gives the ${row.key}`);
        } catch (e) {
            failed.push(`${row.name} (${row.key} -> task ${row.task}): ${(e as Error).message.split('\n')[0]}`);
        }
        bot.remove();
    }
    assert.deepEqual(failed, []);
});

test('product control: gathering an object with no row (logs) completes nothing', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();
    bot.debugproc('relic_gather', 'logs', 0);
    bot.tick(3);
    assert.equal(bot.count('logs'), 1);
    assert.equal(tasksDone(bot), 0);
    bot.expectNoMessage(/^Relic task/);
});

test('task 5 and 20: chopping a real maple and a real yew; task 7: burning the yew log; task 10: cooking a shark on a fire it lit', t => {
    if (skip()) return t.skip(String(skip()));
    const maple = locNear('mapletree', 2655, 3521, 20);
    const bot = spawn({ woodcutting: 99, firemaking: 99, cooking: 99 }, standNear(maple));
    bot.clearInv().give('rune_axe').give('tinderbox');

    bot.opLoc(maple, 1);
    bot.waitForMessage(/^Relic task 5 complete!$/, 200);
    assert.ok(bot.count('maple_logs') >= 1);
    takeOffer(bot);

    const yew = locNear('yewtree', 2705, 3459, 20);
    bot.teleport(standNear(yew));
    bot.opLoc(yew, 1);
    bot.waitForMessage(/^Relic task 20 complete!$/, 300);
    takeOffer(bot);
    bot.waitUntil(() => bot.count('yew_logs') >= 1, 50, 'yew logs');
    assert.equal(isDone(bot, 7), false, 'chopping a yew is not burning one');

    // control: burning ordinary logs completes no task ([proc,relic_task_burn] only counts yew_logs)
    bot.teleport({ x: 3230, z: 3220, level: 0 }); // open ground east of Lumbridge castle
    bot.give('logs');
    bot.useOnHeld('logs', 'tinderbox'); // [opheldu,tinderbox] -> light_logs_inv (firemaking.rs2)
    bot.waitForMessage('The fire catches and the logs begin to burn.', 100);
    bot.tick(2);
    assert.equal(isDone(bot, 7), false);

    bot.tick(10); // firemaking pushed the bot off the fire (~push_player), onto a free tile
    bot.useOnHeld('yew_logs', 'tinderbox');
    bot.waitForMessage('The fire catches and the logs begin to burn.', 200);
    bot.waitForMessage(/^Relic task 7 complete!$/, 10);
    takeOffer(bot);

    // a fire the bot lit: cook a raw shark on it until one is not burnt
    const fire = bot.findLoc('fire', 3);
    bot.give('raw_shark', 10);
    for (let i = 0; i < 10 && !isDone(bot, 10); i++) {
        bot.tick(3);
        bot.useOnLoc('raw_shark', fire);
        bot.waitForMessage(/nicely cooked|accidentally burn/, 20);
        bot.tick(2);
    }
    bot.waitUntil(() => isDone(bot, 10), 5, 'task 10');
    assert.ok(bot.count('shark') >= 1);
    assert.equal(completions(bot, 10), 1);
});

test('task 4: mining a real mithril rock in the Lumbridge swamp', t => {
    if (skip()) return t.skip(String(skip()));
    const rock = locNear('mithrilrock1', 3243, 3160, 10);
    const bot = spawn({ mining: 99 }, standNear(rock));
    bot.clearInv().give('rune_pickaxe');
    bot.opLoc(rock, 1);
    bot.waitForMessage(/^Relic task 4 complete!$/, 300);
    assert.equal(bot.count('mithril_ore'), 1);
    takeOffer(bot);
});

test('task 6: stringing a magic shortbow', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ fletching: 99 });
    bot.clearInv().give('unstrung_magic_shortbow').give('bow_string');
    bot.useOnHeld('bow_string', 'unstrung_magic_shortbow'); // [opheldu,_unstrung_bow] -> string_bow (bows.rs2)
    bot.waitForMessage('You add a string to the bow.', 10);
    bot.waitForMessage(/^Relic task 6 complete!$/, 10);
    assert.equal(bot.count('magic_shortbow'), 1);
    takeOffer(bot);
});

test('task 11: smelting a silver bar at the Lumbridge furnace', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ smithing: 99 });
    bot.clearInv().give('silver_ore');
    const furnace = locNear('furnace1', bot.x, bot.z, 60);
    bot.teleport(standNear(furnace));
    bot.useOnLoc('silver_ore', furnace); // [oplocu,_smithing_furnace] -> smelt_ore_single (smelting.rs2)
    bot.waitForMessage(/^Relic task 11 complete!$/, 100);
    assert.equal(bot.count('silver_bar'), 1);
    takeOffer(bot);
});

// Was a bug: the task 12 row named 4dose2attack, but brewing makes 3dose2attack (row fixed).
test('task 12: brewing a super attack potion (eye of newt into an irit potion)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ herblore: 99 });
    bot.clearInv().give('iritvial').give('eye_of_newt');
    bot.useOnHeld('eye_of_newt', 'iritvial'); // [opheldu,iritvial] -> attempt_brew_potion -> [proc,brew_potion]
    bot.waitForMessage('You mix the eye of newt into your potion.', 10);
    // brew_potion.struct [3dose2attack]: brewing makes the 3-dose super attack
    assert.equal(bot.count('3dose2attack'), 1);
    bot.tick(3);
    assert.ok(isDone(bot, 12), 'brewing a super attack should complete task 12');
});

test('task 13: pickpocketing a paladin (and a man does not count)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn({ thieving: 99, hitpoints: 99 });
    bot.clearInv();

    // control: a successful pickpocket of a man runs the same hook line (thieving.rs2:25) but is not a paladin
    const man = spawnNpc('man', { x: bot.x + 2, z: bot.z });
    bot.tick();
    for (let i = 0; i < 10 && !bot.messages.includes("You pick the man's pocket."); i++) {
        bot.opNpc(man, 3);
        bot.waitForMessage(/You (pick|fail to pick) the man's pocket\./, 30);
        bot.waitUntilIdle(30);
        bot.tick(10); // stun (pickpocket.dbrow stun_ticks) and %action_delay
    }
    assert.ok(bot.messages.includes("You pick the man's pocket."));
    assert.equal(tasksDone(bot), 0);

    const paladin = spawnNpc('paladin', { x: bot.x, z: bot.z + 2 });
    bot.tick();
    for (let i = 0; i < 20 && !isDone(bot, 13); i++) {
        bot.opNpc(paladin, 3); // "Pickpocket": [opnpc3,paladin] (pickpocket.rs2)
        bot.waitForMessage(/You (pick|fail to pick) the paladin's pocket\./, 30);
        bot.tick(12);
        if (bot.choices.length > 0) break;
    }
    bot.expectMessage(/^Relic task 13 complete!$/);
    assert.ok(isDone(bot, 13));
    takeOffer(bot);
});

// ---------------------------------------------------------------- dedupe and order

test('a completed task never fires again: a second goblin type, a same-tick double kill, a second product', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();

    // two kills queued in the same tick: both deaths call ~relic_task_try before the bit is set, so the
    // second [queue,relic_task_done] must re-check (relic_offer.rs2) and do nothing
    bot.cheat('~relic_kill goblin').cheat('~relic_kill goblin_armed').tick();
    bot.waitForMessage(/^Relic task 1 complete!$/, 10);
    takeOffer(bot);
    bot.tick(5);
    assert.equal(completions(bot, 1), 1);

    bot.debugproc('relic_kill', 'goblin_redarmour');
    bot.tick(8);
    assert.equal(completions(bot, 1), 1);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.equal(bot.choices.length, 0);

    bot.debugproc('relic_gather', 'maple_logs', 0);
    bot.waitForMessage(/^Relic task 5 complete!$/, 5);
    takeOffer(bot);
    bot.debugproc('relic_gather', 'maple_logs', 0);
    bot.tick(5);
    assert.equal(completions(bot, 5), 1);
    assert.equal(bot.count('maple_logs'), 2, 'the product is still given');
    assert.equal(bot.choices.length, 0);
    assert.equal(tasksDone(bot), (1 << 0) | (1 << 4));
});

test('tasks count in any order: tier 3 and tier 2 tasks complete with no tier 1 task done', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = spawn();
    bot.clearInv();

    bot.debugproc('relic_kill', 'brownbear'); // task 15, tier 3
    bot.waitForMessage(/^Relic task 15 complete!$/, 10);
    takeOffer(bot);
    bot.debugproc('relic_gather', 'yew_logs', 0); // task 20, tier 3
    bot.waitForMessage(/^Relic task 20 complete!$/, 5);
    takeOffer(bot);
    bot.debugproc('relic_gather', 'lawrune', 0); // task 8, tier 2
    bot.waitForMessage(/^Relic task 8 complete!$/, 5);
    takeOffer(bot);
    bot.debugproc('relic_kill', 'goblin'); // task 1, tier 1, last
    bot.waitForMessage(/^Relic task 1 complete!$/, 10);
    takeOffer(bot);

    assert.equal(tasksDone(bot), (1 << 14) | (1 << 19) | (1 << 7) | (1 << 0));
    // four offers were owed and answered, one per task
    assert.equal(bot.messages.filter(m => m.startsWith('You gained the relic:')).length, 4);
});

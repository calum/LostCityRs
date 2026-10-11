// Shared kill credit: every online player who damaged an npc gets its relic kill task, not only the top damager
// (npc heroPoints: Engine-TS/src/engine/entity/HeroPoints.ts; hook [proc,relic_on_kill] in mods/relics/scripts/relic_tasks.rs2).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, spawnNpc } from '../harness/src/index.js';
import type { CoordLike } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import type Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ServerTriggerType from '../Engine-TS/src/engine/script/ServerTriggerType.js';

useVanillaWorld(); // relic_started = 1 on every bot: no first-login offer

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');

// Same no-follow-up relic mask as relic-tasks.test.ts (Quest Pass and Hoarder open extra dialogue).
const NO_FOLLOWUP_RELICS = (1 << 2) | (1 << 19);
const TASK_1 = 1; // goblin (relic_tasks.dbrow)
const TASK_24 = 1 << 23; // King Black Dragon
const TASK_25 = 1 << 24; // Kalphite Queen
const ALL_BUT_FINALS = (1 << 23) - 1; // tasks 1 to 23

function spawn(at: CoordLike, varps: Record<string, number> = {}): Bot {
    return Bot.spawn({ at, varps: { relic_owned: NO_FOLLOWUP_RELICS, ...varps } });
}

const tasksDone = (bot: Bot) => bot.varp('relic_tasks_done') as number;

/** Give each bot hero points on a fresh npc (the damage record the combat scripts keep), then run its real death script (ai_queue3). */
function killWithDamage(type: string, at: { x: number; z: number }, damage: Array<[Bot, number]>): Npc {
    const npc = spawnNpc(type, at);
    for (const [bot, points] of damage) npc.heroPoints.addHero(bot.player.hash64, points);
    npc.enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    return npc;
}

test('shared kill: two players who both damaged a goblin both complete its task', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3200, z: 3210 };
    const a = spawn(at);
    const b = spawn({ x: at.x + 1, z: at.z });
    const npc = killWithDamage('goblin', { x: at.x + 2, z: at.z }, [[a, 10], [b, 4]]);
    a.waitForMessage('Relic task 1 complete!', 20);
    b.waitForMessage('Relic task 1 complete!', 20);
    assert.equal(tasksDone(a), TASK_1);
    assert.equal(tasksDone(b), TASK_1, 'the lower damager is credited too');
    assert.equal(npc.heroPoints.length, 16);
});

test('shared kill: a player who dealt no damage gets nothing, and an offline damager does not break the others', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3200, z: 3220 };
    const a = spawn(at);
    const bystander = spawn({ x: at.x + 1, z: at.z });
    const gone = spawn({ x: at.x, z: at.z + 1 });
    killWithDamage('goblin', { x: at.x + 2, z: at.z }, [[gone, 20], [a, 5]]);
    gone.remove();
    a.waitForMessage('Relic task 1 complete!', 20);
    bystander.tick(5);
    assert.equal(tasksDone(a), TASK_1);
    assert.equal(tasksDone(bystander), 0);
});

test('shared kill: a player credited twice for the same task completes it once', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3208, z: 3232 };
    const a = spawn(at, { relic_tasks_done: TASK_1 });
    const b = spawn({ x: at.x + 1, z: at.z });
    killWithDamage('goblin', { x: at.x + 2, z: at.z }, [[a, 10], [b, 4]]);
    b.waitForMessage('Relic task 1 complete!', 20);
    a.tick(5);
    assert.equal(a.messages.filter(m => m === 'Relic task 1 complete!').length, 0);
    assert.equal(tasksDone(a), TASK_1);
});

test('shared kill: friends who both hit King Black Dragon or Kalphite Queen both finish the run', t => {
    if (skip()) return t.skip(String(skip()));
    const at = { x: 3222, z: 3238 };
    const a = spawn(at, { relic_tasks_done: ALL_BUT_FINALS | TASK_25 });
    const b = spawn({ x: at.x + 1, z: at.z }, { relic_tasks_done: ALL_BUT_FINALS | TASK_25 });
    killWithDamage('king_dragon', { x: at.x + 2, z: at.z }, [[a, 300], [b, 40]]);
    a.waitForMessage('You have defeated both final bosses. You win the relic run!', 20);
    b.waitForMessage('You have defeated both final bosses. You win the relic run!', 20);
    assert.equal(tasksDone(a) & TASK_24, TASK_24);
    assert.equal(tasksDone(b) & TASK_24, TASK_24);
});

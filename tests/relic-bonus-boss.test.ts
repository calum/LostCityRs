// Bonus boss fight: 25 ticks (15 s) after a King Black Dragon dies in its lair, 2 more KBDs and 2 Kalphite Queens appear in the
// four corners and hunt the group; every player in the lair glows in their own colour; dying during the fight sends you to the
// lever outside with your items (mods/relics/scripts/relic_bonus.rs2, hook in Content/scripts/player/scripts/death.rs2).
// Design and evidence: docs/design/relics-bonus-boss-fight.md.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { Bot, World, ids, spawnNpc } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import type Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ServerTriggerType from '../Engine-TS/src/engine/script/ServerTriggerType.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');
const NO_FOLLOWUP_RELICS = (1 << 2) | (1 << 19);
const LAIR = { x: 2717, z: 9812 };
const inLair = (n: { x: number; z: number }) => n.x >= 2704 && n.x <= 2735 && n.z >= 9800 && n.z <= 9831;
const CORNERS = [
    { type: 'king_dragon', x: 2711, z: 9822 },
    { type: 'king_dragon', x: 2722, z: 9810 },
    { type: 'kalphite_queen', x: 2724, z: 9817 },
    { type: 'kalphite_queen', x: 2710, z: 9807 }
];

function lairNpcs(type: string): Npc[] {
    const id = ids.npc(type);
    return [...World.npcs].filter((n): n is Npc => !!n && n.isActive && n.type === id && inLair(n));
}

/** One world per file: clear the bosses and controllers a test leaves behind. */
function cleanLair() {
    for (const type of ['king_dragon', 'kalphite_queen', 'kalphite_flyingqueen', 'kalphite_queen_dead', 'relic_bonus_timer', 'relic_bonus_glow']) {
        const id = ids.npc(type);
        for (const n of [...World.npcs]) {
            if (n && n.isActive && n.type === id && (inLair(n) || type.startsWith('relic_bonus'))) World.removeNpc(n, 100000);
        }
    }
}
afterEach(cleanLair);

function bot(at = LAIR): Bot {
    return Bot.spawn({ at, levels: { hitpoints: 99 }, varps: { relic_owned: NO_FOLLOWUP_RELICS } });
}

/** Remove the lair's static KBD (it respawns on its own after 150 ticks) and kill a fresh one with the real death script. */
function killKbd(at = { x: LAIR.x + 3, z: LAIR.z }) {
    for (const n of lairNpcs('king_dragon')) World.removeNpc(n, 100000);
    const npc = spawnNpc('king_dragon', at);
    npc.enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    return npc;
}

test('bonus: nothing spawns for 24 ticks, then 2 KBD and 2 KQ stand in the four corners', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot();
    killKbd();
    a.tick(22);
    assert.equal(lairNpcs('kalphite_queen').length, 0, 'not before the 15 s are up');
    a.tick(8);
    assert.equal(lairNpcs('kalphite_queen').length, 2);
    assert.equal(lairNpcs('king_dragon').length, 2);
    for (const c of CORNERS) {
        assert.ok(lairNpcs(c.type).some(n => Math.abs(n.startX - c.x) <= 1 && Math.abs(n.startZ - c.z) <= 1), `a ${c.type} spawned at ${c.x},${c.z}`);
    }
});

test('bonus: a KBD that dies outside its lair starts nothing', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot({ x: 3200, z: 3210 });
    spawnNpc('king_dragon', { x: 3203, z: 3210 }).enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    a.tick(40);
    assert.equal(lairNpcs('kalphite_queen').length, 0);
    assert.equal(lairNpcs('king_dragon').length, 0);
});

test('bonus: killing the bonus bosses does not start another round while the fight lasts', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot();
    killKbd();
    a.tick(30);
    const first = lairNpcs('king_dragon')[0];
    first.enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    a.tick(40);
    assert.equal(lairNpcs('kalphite_queen').length, 2, 'still two queens, no second batch');
    assert.equal(lairNpcs('king_dragon').length, 1);
});

test('bonus: every player in the lair gets their own glow colour, players outside get none', t => {
    if (skip()) return t.skip(String(skip()));
    const players = [bot(), bot({ x: LAIR.x + 2, z: LAIR.z }), bot({ x: LAIR.x + 1, z: LAIR.z + 3 }), bot({ x: LAIR.x - 1, z: LAIR.z + 1 })];
    const outside = bot({ x: 3200, z: 3210 });
    assert.equal(players[0].varp('relic_bonus_colour'), 0, 'no colour before the fight');
    killKbd();
    players[0].tick(32); // the bosses kill unarmoured bots within about 20 ticks, look soon after they appear
    const colours = players.map(p => p.varp('relic_bonus_colour') as number);
    assert.ok(colours.every(c => c > 0), `all assigned: ${colours}`);
    assert.equal(new Set(colours).size, colours.length, `all different: ${colours}`);
    assert.equal(outside.varp('relic_bonus_colour'), 0);
});

test('bonus: dying during the fight puts you at the lever outside with all your items and full hitpoints', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot();
    const items = ['rune_longsword', 'adamant_platebody', 'shark', 'lobster', 'bronze_dagger', 'iron_axe'];
    for (const i of items) a.give(i);
    killKbd();
    a.tick(30);
    a.debugproc('relic_hit', 99);
    a.waitForMessage('Oh dear you are dead!', 30);
    a.waitUntil(() => !inLair(a), 30, 'the respawn');
    a.tick(2);
    // the out-lever sends you to 0_47_160_59_14 = 3067,10254 (king_black_dragon.rs2)
    assert.ok(Math.abs(a.x - 3067) <= 3 && Math.abs(a.z - 10254) <= 3, `at the lever, not Lumbridge: ${a.x},${a.z}`);
    for (const i of items) assert.equal(a.count(i), 1, `${i} kept`);
    assert.equal(a.stat('hitpoints'), 99);
});

test('bonus: control, dying in the lair with no fight still respawns in Lumbridge', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot();
    a.debugproc('relic_hit', 99);
    a.waitForMessage('Oh dear you are dead!', 30);
    a.waitUntil(() => Math.abs(a.x - 3221) <= 3 && Math.abs(a.z - 3218) <= 3, 30, 'the Lumbridge respawn');
});

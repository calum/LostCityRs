// Congratulating bot players (docs/design/relics-party-bots.md): when the four bonus bosses of the final fight are dead, a crowd of
// cosmetic npcs with famous names appears around the players in the lair, follows them, shouts congratulations and leaves after a while.
// ::~relic_party spawns the same crowd around the caller for testing.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { Bot, World, ids, spawnNpc } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ServerTriggerType from '../Engine-TS/src/engine/script/ServerTriggerType.js';
import NpcType from '../Engine-TS/src/cache/config/NpcType.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_tasks_done') ? false : 'relic mod not loaded');
const NO_FOLLOWUP_RELICS = (1 << 2) | (1 << 19);
const LAIR = { x: 2717, z: 9812 };
const inLair = (n: { x: number; z: number }) => n.x >= 2704 && n.x <= 2735 && n.z >= 9800 && n.z <= 9831;

function partyNpcs(): Npc[] {
    return [...World.npcs].filter((n): n is Npc => !!n && n.isActive && (NpcType.get(n.type).debugname ?? '').startsWith('relic_party_'));
}
function lairNpcs(type: string): Npc[] {
    const id = ids.npc(type);
    return [...World.npcs].filter((n): n is Npc => !!n && n.isActive && n.type === id && inLair(n));
}
function clean() {
    for (const n of partyNpcs()) World.removeNpc(n, 100000);
    for (const type of ['king_dragon', 'kalphite_queen', 'kalphite_flyingqueen', 'kalphite_queen_dead', 'relic_bonus_timer', 'relic_bonus_glow', 'relic_bonus_kill', 'relic_party_timer']) {
        const id = ids.npc(type);
        for (const n of [...World.npcs]) if (n && n.isActive && n.type === id && (inLair(n) || type.startsWith('relic_'))) World.removeNpc(n, 100000);
    }
}
const spawned: Bot[] = [];
afterEach(() => {
    clean();
    // bots left in the world would be picked as targets by a later test's crowd
    for (const b of spawned.splice(0)) b.remove();
});

const near = (n: Npc, b: Bot, d: number) => Math.abs(n.x - b.x) <= d && Math.abs(n.z - b.z) <= d;
const bot = (at = LAIR) => {
    const b = Bot.spawn({ at, levels: { hitpoints: 99 }, varps: { relic_owned: NO_FOLLOWUP_RELICS } });
    spawned.push(b);
    return b;
};
/** Tick while keeping every player at full health: the bonus bosses would otherwise kill the bots before the fight is won. */
function tickAlive(players: Bot[], n: number) {
    for (let i = 0; i < n; i++) {
        for (const p of players) (p as unknown as { player: { levels: number[] } }).player.levels[ids.stat('hitpoints')] = 99;
        players[0].tick();
    }
}

test('party: ::~relic_party spawns a crowd of distinct famous names around the caller', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot({ x: 3200, z: 3210 });
    assert.equal(partyNpcs().length, 0);
    a.debugproc('relic_party');
    const crowd = partyNpcs();
    assert.equal(crowd.length, 40);
    assert.equal(new Set(crowd.map(n => n.type)).size, 40, 'every bot is a different name');
    assert.ok(crowd.every(n => near(n, a, 4)), 'all next to the player');
});

test('party: bots are spread at random over the players, and shout lines from the list', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot({ x: 3200, z: 3210 });
    const b = bot({ x: 3230, z: 3210 });
    const said: string[] = [];
    const orig = Npc.prototype.say;
    Npc.prototype.say = function (text: string) {
        if ((NpcType.get(this.type).debugname ?? '').startsWith('relic_party_')) said.push(text);
        return orig.call(this, text);
    };
    try {
        a.debugproc('relic_party');
        // the command is for the caller only: b is far away, so all bots belong to a
        assert.ok(partyNpcs().every(n => near(n, a, 4)));
        b.tick(0);
        a.tick(30);
    } finally {
        Npc.prototype.say = orig;
    }
    assert.ok(said.length >= 40, `bots chat (said ${said.length})`);
    assert.ok(new Set(said).size > 10, 'many different lines');
});

test('party: the crowd follows the player and leaves after a while', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot({ x: 3200, z: 3210 });
    a.debugproc('relic_party');
    a.walk({ x: 3212, z: 3208 });
    a.tick(15);
    assert.ok(partyNpcs().filter(n => near(n, a, 6)).length >= 30, 'they came along');
    a.tick(300);
    assert.equal(partyNpcs().length, 0, 'gone');
});

/** Fight the bonus bosses: kill the KBD, wait for the 2 KBD + 2 KQ, and kill them as soon as they stand. Returns the players. */
function startFight(players: Bot[]) {
    for (const n of lairNpcs('king_dragon')) World.removeNpc(n, 100000);
    spawnNpc('king_dragon', { x: LAIR.x + 3, z: LAIR.z }).enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    tickAlive(players, 26);
    assert.equal(lairNpcs('kalphite_queen').length, 2, 'bonus fight started');
}
function kill(n: Npc) {
    n.enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
}

test('party: nothing until all four bonus bosses are dead; then the crowd arrives around the players in the lair', t => {
    if (skip()) return t.skip(String(skip()));
    const players = [bot(), bot({ x: LAIR.x + 1, z: LAIR.z + 1 })];
    startFight(players);
    const [k1, k2] = lairNpcs('king_dragon');
    kill(k1);
    kill(k2);
    tickAlive(players, 2);
    // each queen: ground form dies into the flying form, which has to die too
    for (const q of lairNpcs('kalphite_queen')) kill(q);
    tickAlive(players, 1);
    assert.equal(partyNpcs().length, 0, 'three of four dead is not the end');
    tickAlive(players, 10);
    const flying = lairNpcs('kalphite_flyingqueen');
    assert.equal(flying.length, 2);
    kill(flying[0]);
    tickAlive(players, 10);
    assert.equal(partyNpcs().length, 0, 'three of four dead is not the end');
    kill(flying[1]);
    tickAlive(players, 8);
    const crowd = partyNpcs();
    assert.equal(crowd.length, 40, 'the party started');
    assert.ok(crowd.every(n => inLair(n) || players.some(p => near(n, p, 6))));
});

test('party: a KBD that dies outside the lair never starts a party', t => {
    if (skip()) return t.skip(String(skip()));
    const a = bot({ x: 3200, z: 3210 });
    spawnNpc('king_dragon', { x: 3203, z: 3210 }).enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    a.tick(60);
    assert.equal(partyNpcs().length, 0);
});

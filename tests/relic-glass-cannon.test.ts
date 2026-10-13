// Glass Cannon (relic 5) extra hitsplats: mods/relics/scripts/relic_effects.rs2 [proc,relic_glass_extra], called from
// ~relic_dealt (npc_max_dealt hook). Notes: docs/design/relics-glass-cannon-extra.md. Own file so the extra tick-consuming
// tests do not shift the world clock under the timing-sensitive tests in relic-combat.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, spawnNpc, World } from '../harness/src/index.js';
import Npc from '../Engine-TS/src/engine/entity/Npc.js';
import ScriptProvider from '../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../Engine-TS/src/engine/script/ScriptRunner.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

const SPOT = { x: 3212, z: 3200 };
const HP = 3; // NpcStat.HITPOINTS

function relicBot(relics: number[]): Bot {
    const bot = Bot.spawn({ at: SPOT });
    for (const id of relics) {
        bot.debugproc('relic_grant', id);
        bot.expectMessage('You gained the relic');
    }
    return bot;
}

function retire(npc: Npc) {
    World.removeNpc(npc, -1);
}

/** Run a proc as `bot` with `npc` as the active npc, as a combat label would. */
function callWithNpc(bot: Bot, name: string, npc: Npc, ...args: number[]): number {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, `no proc ${name}`);
    const state = ScriptRunner.init(script, bot.player, npc, args);
    bot.player.executeScript(state, true, true);
    return state.isp > 0 ? state.popInt() : NaN;
}

// ----------------------------------------------------------------------- 5 Glass Cannon (extra hitsplats)

/** Record every applyDamage on `npc` (one entry per hitsplat, the hitpoints actually lost: a lethal hit is capped) */
function spyHits(npc: Npc): number[] {
    const hits: number[] = [];
    const orig = npc.applyDamage.bind(npc);
    npc.applyDamage = (damage: number, type: number) => {
        const before = npc.levels[HP];
        orig(damage, type);
        hits.push(before - npc.levels[HP]);
    };
    return hits;
}

test('Glass Cannon extra hitsplats: [proc,relic_glass_extra](max, pct) queues one rolled hitsplat per success, at most 10', t => {
    if (skip()) return t.skip(String(skip()));
    const glass = relicBot([5]);
    const npc = spawnNpc('giant', { x: SPOT.x + 3, z: SPOT.z });
    glass.tick();
    npc.levels[HP] = 9999;
    const hits = spyHits(npc);

    callWithNpc(glass, 'relic_glass_extra', npc, 4, 0);
    glass.tick(15);
    assert.equal(hits.length, 0, '0% chance: no extra hitsplat');

    callWithNpc(glass, 'relic_glass_extra', npc, 4, 100);
    glass.tick(20);
    assert.equal(hits.length, 10, '100% chance: every roll succeeds, so the chain stops at the cap of 10');
    assert.ok(
        hits.every(h => h >= 0 && h <= 4),
        `each extra hit is randominc(max): ${hits}`
    );
    assert.ok(npc.levels[HP] < 9999, 'extra hits take hitpoints');
    retire(npc);
});

test('Glass Cannon: npc_max_dealt rolls the 25% chain only with the relic (about 1/3 extra hitsplat per attack on average)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot([]);
    const glass = relicBot([5]);
    const a = spawnNpc('giant', { x: SPOT.x + 3, z: SPOT.z });
    const b = spawnNpc('giant', { x: SPOT.x + 3, z: SPOT.z + 2 });
    plain.tick();
    a.levels[HP] = 9999;
    b.levels[HP] = 9999;
    const plainHits = spyHits(a);
    const glassHits = spyHits(b);
    const attacks = 600;
    for (let i = 0; i < attacks; i++) {
        callWithNpc(plain, 'npc_max_dealt', a, 1, 0);
        callWithNpc(glass, 'npc_max_dealt', b, 1, 0);
    }
    plain.tick(20);
    assert.equal(plainHits.length, 0, 'control: no extra hitsplats without the relic');
    // Geometric chain, p = 1/4: mean p/(1-p) = 1/3 per attack, so ~200 over 600 attacks (sd ~16).
    assert.ok(glassHits.length > 120 && glassHits.length < 290, `extra hitsplats over ${attacks} attacks: ${glassHits.length}`);
    retire(a);
    retire(b);
});

test('Glass Cannon extra hits credit combat xp and hero points like a landed hit', t => {
    if (skip()) return t.skip(String(skip()));
    const glass = relicBot([5]);
    const npc = spawnNpc('giant', { x: SPOT.x + 3, z: SPOT.z });
    glass.tick();
    glass.setVar('damagestyle', 0);
    npc.levels[HP] = 9999;
    const atk0 = glass.xp('attack');
    callWithNpc(glass, 'relic_glass_extra', npc, 6, 100);
    glass.tick(20);
    assert.ok(glass.xp('attack') > atk0, 'attack xp for the extra hits');
    const hero = npc.heroPoints.find(h => h.hash64 === glass.player.hash64);
    assert.ok((hero?.points ?? 0) > 0, 'hero points for the extra hits');
    retire(npc);
});

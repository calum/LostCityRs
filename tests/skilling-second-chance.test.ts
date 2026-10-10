// Default buff: when a skilling success roll (RuneScript `stat_random`) fails, it is rolled once more.
// Engine-TS/src/engine/script/handlers/PlayerOps.ts STAT_RANDOM; switch: world.json node.skillingSecondChance.
// Combat never calls stat_random (it has its own rolls), so combat results must not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, seedRandom, spawnNpc } from '../harness/src/index.js';
import DbRowType from '../Engine-TS/src/cache/config/DbRowType.js';
import { ScriptOpcode } from '../Engine-TS/src/engine/script/ScriptOpcode.js';
import ScriptProvider from '../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../Engine-TS/src/engine/script/ScriptRunner.js';
import Environment from '../Engine-TS/src/util/Environment.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

const ROLLS = 4000;

/**
 * Run [proc,check_if_success_pick_pocket](dbrow) and return 1 or 0. Bot.call cannot pass the argument
 * (the compiled script reports no parameter types, see docs/setup/headless-test-harness.md), so this
 * does what Bot.call does with the argument already converted.
 */
function pickpocketRoll(bot: Bot, row: number): number {
    const script = ScriptProvider.getByName('[proc,check_if_success_pick_pocket]')!;
    const state = ScriptRunner.init(script, bot.player, null, [row]);
    bot.player.executeScript(state, true, true);
    return state.popInt();
}

/** Success rate of `~check_if_success_pick_pocket` (Content skill_thieving/scripts/thieving.rs2) for a man at thieving 1. */
function pickpocketRate(bot: Bot, secondChance: boolean): number {
    const row = DbRowType.getId('pickpocket_man');
    const before = Environment.node.skillingSecondChance;
    Environment.node.skillingSecondChance = secondChance;
    try {
        let wins = 0;
        for (let i = 0; i < ROLLS; i++) {
            wins += pickpocketRoll(bot, row);
        }
        return wins / ROLLS;
    } finally {
        Environment.node.skillingSecondChance = before;
    }
}

test('the buff is on by default', () => {
    assert.equal(Environment.node.skillingSecondChance, true);
});

test('thieving: a failed roll gets a second 50% chance', () => {
    const bot = Bot.spawn();
    seedRandom(7);
    // pickpocket_man success_chance 180,240 at level 1: (180 + 1) / 256 = 0.707 per roll.
    const p = 181 / 256;
    const base = pickpocketRate(bot, false);
    const buffed = pickpocketRate(bot, true);
    assert.ok(Math.abs(base - p) < 0.03, `without the buff expected about ${p.toFixed(3)}, got ${base}`);
    const expected = p + (1 - p) / 2;
    assert.ok(Math.abs(buffed - expected) < 0.03, `with the buff expected about ${expected.toFixed(3)}, got ${buffed}`);
});

test('combat never rolls stat_random, so the buff cannot touch it', () => {
    // Count every STAT_RANDOM the script runner executes during a whole fight.
    const handlers = ScriptRunner.HANDLERS;
    const original = handlers[ScriptOpcode.STAT_RANDOM];
    let rolls = 0;
    handlers[ScriptOpcode.STAT_RANDOM] = state => {
        rolls++;
        original(state);
    };
    try {
        Environment.node.skillingSecondChance = true;
        const bot = Bot.spawn({ levels: { attack: 20, strength: 20 } });
        const chicken = spawnNpc('chicken', { x: bot.x + 2, z: bot.z });
        bot.tick();
        bot.opNpc(chicken, 2);
        bot.waitUntil(() => !chicken.isActive, 200, 'the chicken to die');
        assert.ok(bot.xp('hitpoints') > 0, 'the fight must have happened');
        assert.equal(rolls, 0, 'melee combat executed stat_random');

        // The counter works: a thieving roll goes through it.
        pickpocketRoll(bot, DbRowType.getId('pickpocket_man'));
        assert.equal(rolls, 1);
    } finally {
        handlers[ScriptOpcode.STAT_RANDOM] = original;
    }
});

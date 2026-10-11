// Combat relics (mods/relics/scripts/relic_effects.rs2): 3 Stoneskin, 4 Quickstrike, 5 Glass Cannon,
// 6 Phoenix, 7 Vampire, 8 Executioner, 9 Bounty. Content hooks: damage.rs2 (~relic_damage_taken),
// npc_combat.rs2 npc_max_dealt (~relic_dealt, which first calls ~relic_execute), npc_death.rs2 (~relic_on_kill),
// player_melee/ranged/magic/special_attack (~relic_delay). Each test has a no-relic control.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, spawnNpc, World } from '../harness/src/index.js';
import VarNpcType from '../Engine-TS/src/cache/config/VarNpcType.js';
import Npc from '../Engine-TS/src/engine/entity/Npc.js';
import Obj from '../Engine-TS/src/engine/entity/Obj.js';
import ScriptProvider from '../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../Engine-TS/src/engine/script/ScriptRunner.js';
import Environment from '../Engine-TS/src/util/Environment.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

// Open tiles near Lumbridge (route-checked from the spawn), one per test so spawned NPCs and drops do not mix.
const SPOT = {
    taken: { x: 3200, z: 3210 },
    phoenix: { x: 3200, z: 3220 },
    dealt: { x: 3208, z: 3232 },
    quick: { x: 3232, z: 3224 },
    ranged: { x: 3260, z: 3234 },
    vampire: { x: 3222, z: 3238 },
    exec: { x: 3206, z: 3200 },
    execE2e: { x: 3208, z: 3230 },
    bounty: { x: 3236, z: 3220 }
};

const HP = 3; // NpcStat.HITPOINTS (Engine-TS/src/engine/entity/NpcStat.ts)

function relicBot(at: { x: number; z: number }, relics: number[], levels: Record<string, number> = {}): Bot {
    const bot = Bot.spawn({ at, levels });
    for (const id of relics) {
        bot.debugproc('relic_grant', id);
        bot.expectMessage('You gained the relic');
    }
    return bot;
}

/** Remove a spawned npc now (World.removeNpc), so it cannot keep fighting a later bot. */
function retire(npc: Npc) {
    World.removeNpc(npc, -1);
}

/** Player.addXp multiplies every stat_advance by node.xpRate * max(1, %relic_xp_factor) (Engine-TS/src/engine/entity/Player.ts addXp). */
function xpMulti(bot: Bot): number {
    return Environment.node.xpRate * Math.max(1, bot.varp('relic_xp_factor') as number);
}

/** Run a proc as `bot` with `npc` as the active npc (ScriptRunner.init target), as a combat label would. Returns the int result. */
function callWithNpc(bot: Bot, name: string, npc: Npc, ...args: number[]): number {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, `no proc ${name}`);
    const state = ScriptRunner.init(script, bot.player, npc, args);
    bot.player.executeScript(state, true, true);
    return state.isp > 0 ? state.popInt() : NaN;
}

function npcVar(npc: Npc, name: string): number {
    return npc.getVar(VarNpcType.getId(name)) as number;
}

function hpLoss(bot: Bot, amount: number): number {
    const before = bot.stat('hitpoints');
    bot.debugproc('relic_hit', amount); // [debugproc,relic_hit] -> ~damage_self (relic_debug.rs2)
    return before - bot.stat('hitpoints');
}

// ----------------------------------------------------------------------- 3 Stoneskin / 5 Glass Cannon (taken)

test('Stoneskin halves and Glass Cannon multiplies damage taken by 1.5 (~damage_self via ::~relic_hit)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.taken, [], { hitpoints: 99 });
    const stone = relicBot(SPOT.taken, [3], { hitpoints: 99 });
    const glass = relicBot(SPOT.taken, [5], { hitpoints: 99 });
    const both = relicBot(SPOT.taken, [3, 5], { hitpoints: 99 });

    // relic_damage_taken: stoneskin (a+1)/2, then glass cannon (a*3+1)/2 on the result.
    const cases: [number, number, number, number, number][] = [
        // amount, plain, stoneskin, glass, both
        [10, 10, 5, 15, 8],
        [7, 7, 4, 11, 6],
        [1, 1, 1, 2, 2] // both: stoneskin (1+1)/2 = 1, then glass (3+1)/2 = 2
    ];
    for (const [amount, p, s, g, b] of cases) {
        assert.equal(hpLoss(plain, amount), p, `plain ${amount}`);
        assert.equal(hpLoss(stone, amount), s, `stoneskin ${amount}`);
        assert.equal(hpLoss(glass, amount), g, `glass cannon ${amount}`);
        assert.equal(hpLoss(both, amount), b, `both ${amount}`);
    }
});

test('Stoneskin and Glass Cannon on real NPC melee hits: each rolled hit lands transformed', t => {
    if (skip()) return t.skip(String(skip()));
    // Pair each rolled npc hit (the arg of [queue,combat_damage_player], npc_combat_melee.rs2) with the damage the
    // engine applied (Player.applyDamage, the `damage` command in ~damage_self), via test-local spies on this player.
    const f: Record<string, (d: number) => number> = {
        none: d => d,
        stone: d => (d <= 0 ? 0 : Math.floor((d + 1) / 2)),
        glass: d => (d <= 0 ? 0 : Math.floor((d * 3 + 1) / 2))
    };
    const runs: [string, number[], number][] = [
        ['none', [], 0],
        ['stone', [3], 4],
        ['glass', [5], 8]
    ];
    for (const [name, relics, dz] of runs) {
        const at = { x: SPOT.taken.x, z: SPOT.taken.z + 6 + dz };
        const bot = relicBot(at, relics, { attack: 1, strength: 1, defence: 1, hitpoints: 99 });
        const rolled: number[] = [];
        const applied: number[] = [];
        const p = bot.player;
        const enq = p.enqueueScript.bind(p);
        p.enqueueScript = (script, type, delay, args) => {
            if (script.name === 'combat_damage_player' || script.name === '[queue,combat_damage_player]') rolled.push(args![0] as number);
            return enq(script, type, delay, args);
        };
        const apply = p.applyDamage.bind(p);
        p.applyDamage = (damage, type) => {
            applied.push(damage);
            return apply(damage, type);
        };
        const npc = spawnNpc('giant', { x: at.x + 2, z: at.z });
        bot.tick();
        bot.opNpc(npc, 2);
        bot.waitUntil(() => applied.filter(d => d > 0).length >= 4, 300, 'four landed npc hits');
        bot.tick(2);
        retire(npc);
        assert.ok(rolled.length >= applied.length, `${name}: rolled ${rolled} applied ${applied}`);
        assert.deepEqual(applied, rolled.slice(0, applied.length).map(f[name]), `${name}: rolled ${rolled}`);
        bot.remove();
    }
});

// ----------------------------------------------------------------------- 6 Phoenix

test('Phoenix: a lethal hit leaves 1 HP once per 500 ticks; a second lethal hit inside the window kills', t => {
    if (skip()) return t.skip(String(skip()));
    // Control: without the relic a lethal hit kills (damage.rs2 queues player_death at 0 HP).
    const plain = relicBot(SPOT.phoenix, [], { hitpoints: 10 });
    plain.debugproc('relic_hit', 50);
    assert.equal(plain.stat('hitpoints'), 0);
    plain.waitForMessage('Oh dear you are dead!', 20);
    plain.remove();

    const bot = relicBot(SPOT.phoenix, [6], { hitpoints: 10 });
    const t0 = World.currentTick;
    bot.debugproc('relic_hit', 50);
    assert.equal(bot.stat('hitpoints'), 1);
    bot.expectMessage('Your Phoenix relic saves you from a lethal hit!');
    const until = bot.varp('relic_phoenix_until') as number;
    // map_clock is World.currentTick; the debugproc ran during the tick after t0.
    assert.ok(until >= t0 + 500 && until <= t0 + 502, `phoenix_until ${until}, t0 ${t0}`);

    // Second lethal hit inside the window: dies. [queue,player_death] (death.rs2) prints, teleports near
    // 0_50_50_21_18 and resets stats (~stat_reset_all).
    bot.debugproc('relic_hit', 50);
    assert.equal(bot.stat('hitpoints'), 0);
    bot.waitForMessage('Oh dear you are dead!', 20);
    bot.waitUntil(() => bot.stat('hitpoints') === 10, 20, 'stats reset after death');
    assert.ok(Math.abs(bot.x - (50 * 64 + 21)) <= 2 && Math.abs(bot.z - (50 * 64 + 18)) <= 2, `respawn at ${bot.x},${bot.z}`);
    assert.equal(bot.messages.filter(m => /Phoenix relic saves/.test(m)).length, 1);

    // After the window: saves again.
    bot.waitUntil(() => World.currentTick >= until, 520, 'phoenix window to expire');
    bot.debugproc('relic_hit', 50);
    assert.equal(bot.stat('hitpoints'), 1);
    bot.expectMessage('Your Phoenix relic saves you from a lethal hit!');
    assert.ok((bot.varp('relic_phoenix_until') as number) >= until + 500);
});

test('Phoenix + Stoneskin: the save is checked on the already halved amount', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot(SPOT.phoenix, [3, 6], { hitpoints: 10 });
    // 19 -> stoneskin 10, which is >= 10 HP: lethal, so Phoenix saves (relic_effects.rs2 order: 3, 5, then 6).
    bot.debugproc('relic_hit', 19);
    assert.equal(bot.stat('hitpoints'), 1);
    bot.expectMessage('Phoenix relic saves you');
    const other = relicBot(SPOT.phoenix, [3, 6], { hitpoints: 10 });
    // 17 -> 9: not lethal, no save, window not used.
    other.debugproc('relic_hit', 17);
    assert.equal(other.stat('hitpoints'), 1);
    other.expectNoMessage('Phoenix relic saves you');
    assert.equal(other.varp('relic_phoenix_until'), 0);
});

// ----------------------------------------------------------------------- 5 Glass Cannon (dealt)

test('Glass Cannon doubles the max hit returned by npc_max_dealt (the proc every player attack uses)', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.dealt, []);
    const glass = relicBot(SPOT.dealt, [5]);
    const npc = spawnNpc('giant', { x: SPOT.dealt.x + 3, z: SPOT.dealt.z });
    plain.tick();
    for (const max of [1, 7, 13]) {
        assert.equal(callWithNpc(plain, 'npc_max_dealt', npc, max, 0), max);
        assert.equal(callWithNpc(glass, 'npc_max_dealt', npc, max, 0), max * 2);
    }
    retire(npc);
});

test('Glass Cannon in real melee: hits above the unarmed max hit appear only with the relic', t => {
    if (skip()) return t.skip(String(skip()));
    const run = (relics: number[]) => {
        const bot = relicBot(SPOT.dealt, relics, { attack: 99, strength: 1, hitpoints: 99, defence: 99 });
        assert.equal(bot.varp('com_maxhit'), 1); // unarmed at strength 1
        const npc = spawnNpc('giant', { x: SPOT.dealt.x + 2, z: SPOT.dealt.z });
        bot.tick();
        bot.opNpc(npc, 2);
        let last = npc.levels[HP];
        let maxDrop = 0;
        let swings = 0;
        let lastDelay = bot.varp('action_delay');
        bot.waitUntil(
            () => {
                const hp = npc.levels[HP];
                if (hp < last) maxDrop = Math.max(maxDrop, last - hp);
                last = hp;
                const d = bot.varp('action_delay');
                if (d !== lastDelay) swings++;
                lastDelay = d;
                return swings >= 25 || !npc.isActive || hp === 0;
            },
            400,
            '25 swings'
        );
        retire(npc);
        bot.remove();
        return maxDrop;
    };
    assert.equal(run([]), 1, 'without the relic no hit exceeds max hit 1');
    assert.equal(run([5]), 2, 'with Glass Cannon a 2 lands (randominc(2))');
});

// ----------------------------------------------------------------------- 4 Quickstrike

/** Ticks between successive changes of %action_delay (set once per swing in player_melee.rs2 / player_ranged.rs2). */
function swingIntervals(bot: Bot, npc: Npc, swings: number): number[] {
    const at: number[] = [];
    let last = bot.varp('action_delay');
    bot.waitUntil(
        () => {
            const d = bot.varp('action_delay');
            if (d !== last) at.push(World.currentTick);
            last = d;
            return at.length >= swings || !npc.isActive;
        },
        200,
        `${swings} swings`
    );
    return at.slice(1).map((v, i) => v - at[i]);
}

test('Quickstrike halves the real melee attack interval (unarmed 4 ticks -> 2)', t => {
    if (skip()) return t.skip(String(skip()));
    const run = (relics: number[]) => {
        const bot = relicBot(SPOT.quick, relics, { attack: 1, strength: 1, hitpoints: 99, defence: 99 });
        const npc = spawnNpc('black_demon', { x: SPOT.quick.x + 2, z: SPOT.quick.z }); // 157 HP: survives
        bot.tick();
        bot.opNpc(npc, 2);
        const iv = swingIntervals(bot, npc, 6);
        retire(npc);
        bot.remove();
        return iv;
    };
    assert.deepEqual(run([]), [4, 4, 4, 4, 4]);
    assert.deepEqual(run([4]), [2, 2, 2, 2, 2]);
});

test('Quickstrike halves the ranged interval (shortbow, attackrate default 4 -> 2)', t => {
    if (skip()) return t.skip(String(skip()));
    const run = (relics: number[]) => {
        const bot = relicBot(SPOT.ranged, relics, { ranged: 1, hitpoints: 99, defence: 99 });
        bot.clearInv().give('shortbow').give('bronze_arrow', 100);
        bot.opHeld('shortbow', 2).tick(); // Wield
        bot.opHeld('bronze_arrow', 2).tick();
        assert.equal(bot.count('shortbow', 'worn'), 1);
        const npc = spawnNpc('black_demon', { x: SPOT.ranged.x + 4, z: SPOT.ranged.z });
        bot.tick();
        bot.opNpc(npc, 2);
        const iv = swingIntervals(bot, npc, 6);
        retire(npc);
        bot.remove();
        return iv;
    };
    assert.deepEqual(run([]), [4, 4, 4, 4, 4]);
    assert.deepEqual(run([4]), [2, 2, 2, 2, 2]);
});

// ----------------------------------------------------------------------- 7 Vampire

/** Run give_combat_experience (called by every player-vs-npc hit with the damage actually dealt) as `bot` against `npc`. */
function dealt(bot: Bot, npc: Npc, damage: number) {
    callWithNpc(bot, 'give_combat_experience', npc, 0, damage, 1); // style 0 = ^style_melee_accurate
}

test('Vampire heals floor(10% of damage dealt) as hitpoints and prayer on each hit, capped at base', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot(SPOT.vampire, [], { hitpoints: 50, prayer: 50 });
    const vamp = relicBot(SPOT.vampire, [7], { hitpoints: 50, prayer: 50 });
    const npc = spawnNpc('giant', { x: SPOT.vampire.x + 3, z: SPOT.vampire.z });
    vamp.tick();
    for (const b of [plain, vamp]) {
        b.player.levels[ids.stat('hitpoints')] = 20;
        b.player.levels[ids.stat('prayer')] = 20;
    }
    dealt(plain, npc, 25);
    dealt(vamp, npc, 25);
    assert.equal(plain.stat('hitpoints'), 20);
    assert.equal(plain.stat('prayer'), 20);
    assert.equal(vamp.stat('hitpoints'), 22); // floor(25 / 10) = 2
    assert.equal(vamp.stat('prayer'), 22);

    dealt(vamp, npc, 9); // rounds down to 0
    assert.equal(vamp.stat('hitpoints'), 22);
    assert.equal(vamp.stat('prayer'), 22);
    dealt(vamp, npc, 30);
    assert.equal(vamp.stat('hitpoints'), 25);
    assert.equal(vamp.stat('prayer'), 25);

    // capped at base level
    vamp.player.levels[ids.stat('hitpoints')] = 49;
    vamp.player.levels[ids.stat('prayer')] = 49;
    dealt(vamp, npc, 60);
    assert.equal(vamp.stat('hitpoints'), 50);
    assert.equal(vamp.stat('prayer'), 50);
    retire(npc);
});

test('Vampire no longer heals on an npc death', t => {
    if (skip()) return t.skip(String(skip()));
    const vamp = relicBot(SPOT.vampire, [7], { hitpoints: 50 });
    vamp.debugproc('relic_hit', 30);
    vamp.debugproc('relic_kill', 'chicken').tick(3); // ::~relic_kill: hero points + death queue, no hit through give_combat_experience
    assert.equal(vamp.stat('hitpoints'), 20);
});

test('Vampire in real melee: each landed hit heals floor(damage / 10)', t => {
    if (skip()) return t.skip(String(skip()));
    // Glass Cannon (5) doubles the max hit so that a 10+ hit comes up quickly; its damage is what give_combat_experience sees.
    const bot = relicBot(SPOT.vampire, [7, 5], { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99 });
    bot.player.levels[ids.stat('prayer')] = 10; // hitpoints stay full: the giant hits back
    const giant = spawnNpc('giant', { x: SPOT.vampire.x + 2, z: SPOT.vampire.z });
    bot.tick();
    bot.opNpc(giant, 2);
    // The giant loses hp two ticks after the hit (npc_queue(2, ...)); prayer is healed on the hit itself, so tick a few more after.
    let last = giant.levels[HP];
    let expected = 0;
    for (let i = 0; i < 200 && expected < 3; i++) {
        bot.tick();
        const d = last - giant.levels[HP];
        if (d > 0) expected += Math.floor(d / 10);
        last = giant.levels[HP];
    }
    bot.tick(4);
    last = giant.levels[HP];
    assert.ok(expected > 0, 'expected at least one hit of 10+ damage');
    assert.equal(bot.stat('prayer') - 10, expected); // giants do not drain prayer, so all of the change is Vampire
    retire(giant);
});

// ----------------------------------------------------------------------- 8 Executioner

test('Executioner: a landed hit on an npc below 25% HP queues its remaining HP and credits xp and hero points', t => {
    if (skip()) return t.skip(String(skip()));
    const exec = relicBot(SPOT.exec, [8]);
    const plain = relicBot(SPOT.exec, []);
    exec.setVar('damagestyle', 0); // ^style_melee_accurate (combat_damagestyles.constant)

    const giant = (dx: number, hp: number) => {
        const n = spawnNpc('giant', { x: SPOT.exec.x + dx, z: SPOT.exec.z + 3 });
        exec.tick();
        n.levels[HP] = hp;
        return n;
    };
    assert.equal(giant(0, 35).baseLevels[HP], 35);

    // 8 * 4 = 32 < 35: executed.
    const low = giant(2, 8);
    const mult = npcVar(low, 'npc_combat_xp_multiplier');
    const atk0 = exec.xp('attack');
    const hp0 = exec.xp('hitpoints');
    assert.equal(callWithNpc(exec, 'npc_max_dealt', low, 1, 0), 1); // max hit unchanged without Glass Cannon
    // give_combat_experience (combat.rs2): accurate -> attack scale(m,1000,scale(400,100,10d)); hp scale(m,1000,scale(133,100,10d))
    const base = 8 * 10;
    assert.equal(exec.xp('attack') - atk0, Math.floor((Math.floor((base * 400) / 100) * mult) / 1000) * xpMulti(exec));
    assert.equal(exec.xp('hitpoints') - hp0, Math.floor((Math.floor((base * 133) / 100) * mult) / 1000) * xpMulti(exec));
    const hero = low.heroPoints.find(h => h.hash64 === exec.player.hash64);
    assert.equal(hero?.points, 8);
    exec.waitUntil(() => low.levels[HP] === 0, 5, 'the queued execution damage');
    exec.waitUntil(() => !low.isActive, 10, 'the npc to die');

    // 9 * 4 = 36 >= 35: not executed.
    const mid = giant(4, 9);
    const atk1 = exec.xp('attack');
    callWithNpc(exec, 'npc_max_dealt', mid, 1, 0);
    exec.tick(3);
    assert.equal(mid.levels[HP], 9);
    assert.equal(exec.xp('attack'), atk1);

    // Control: same low npc, no relic.
    const ctl = giant(6, 8);
    plain.setVar('damagestyle', 0);
    const patk = plain.xp('attack');
    callWithNpc(plain, 'npc_max_dealt', ctl, 1, 0);
    plain.tick(3);
    assert.equal(ctl.levels[HP], 8);
    assert.equal(plain.xp('attack'), patk);
    for (const n of [mid, ctl]) retire(n);
});

test('Executioner in real melee: a wounded giant (3 HP) dies on the first landed hit, never showing 2 or 1 HP', t => {
    if (skip()) return t.skip(String(skip()));
    // relic_wound deals base-2 damage, but a new npc regenerates 1 HP on its first npc phase (Npc.processRegen:
    // regenInterval starts at 0), so the giant has 3 HP. Max hit is 1 (strength 1, unarmed), so without the relic it
    // must pass through 2 and 1 HP.
    const run = (relics: number[], dz: number) => {
        const bot = relicBot({ x: SPOT.execE2e.x, z: SPOT.execE2e.z + dz }, relics, { attack: 99, strength: 1, hitpoints: 99, defence: 99 });
        const atk0 = bot.xp('attack');
        bot.debugproc('relic_wound', 'giant'); // spawn east with 2 HP left, p_opnpc(2) (relic_debug.rs2)
        const npc = bot.findNpc('giant', 2);
        const seen = new Set<number>([npc.levels[HP]]);
        bot.waitUntil(
            () => {
                seen.add(npc.levels[HP]);
                return !npc.isActive || npc.levels[HP] === 0;
            },
            200,
            'the giant to die'
        );
        bot.tick(3);
        const gained = (bot.xp('attack') - atk0) / xpMulti(bot);
        bot.remove();
        return { seen, gained };
    };
    const ctl = run([], 0);
    assert.deepEqual([...ctl.seen], [3, 2, 1, 0], 'control');
    assert.equal(ctl.gained, 3 * 40, 'control: 3 damage, 40 attack xp tenths each (accurate, multiplier 1000)');
    const ex = run([8], 4);
    assert.deepEqual([...ex.seen], [3, 0], 'executed from 3 HP');
    // Execution credits at least the 3 remaining HP (the test below covers the extra credit for the landed hit).
    assert.ok(ex.gained >= 3 * 40, `attack xp ${ex.gained}`);
});

test(
    'Executioner credits the remaining HP plus the landed hit (kept by design, Calum 2026-10-10)',
    t => {
        if (skip()) return t.skip(String(skip()));
        const bot = relicBot({ x: SPOT.execE2e.x, z: SPOT.execE2e.z + 8 }, [8], { attack: 99, strength: 1, hitpoints: 99, defence: 99 });
        bot.setVar('damagestyle', 0);
        const atk0 = bot.xp('attack');
        bot.debugproc('relic_wound', 'giant');
        const npc = bot.findNpc('giant', 2);
        let maxHp = npc.levels[HP];
        bot.waitUntil(
            () => {
                if (npc.isActive && npc.levels[HP] > 0) maxHp = Math.max(maxHp, npc.levels[HP]);
                return !npc.isActive || npc.levels[HP] === 0;
            },
            200,
            'the giant to die'
        );
        bot.tick(3);
        // accurate style: 40 attack xp tenths per damage point at multiplier 1000 (combat.rs2 give_combat_experience).
        // relic_execute credits the remaining HP, and player_melee.rs2 credits the landed hit again (its damage_capped
        // reads npc_stat before the queued execution). Strength 1 means a max hit of 1, so the extra is 0 or 1 point.
        const credited = (bot.xp('attack') - atk0) / xpMulti(bot);
        assert.ok(credited >= maxHp * 40 && credited <= (maxHp + 1) * 40, `credited ${credited} for an npc with at most ${maxHp} HP`);
    }
);

// ----------------------------------------------------------------------- 9 Bounty

type Drop = { type: string; count: number; x: number; z: number };

/** Record every World.addObj while `fn` runs (test-local spy; restored after). */
function recordDrops(fn: () => void): Drop[] {
    const drops: Drop[] = [];
    const orig = World.addObj;
    World.addObj = function (this: typeof World, obj: Obj, receiver: bigint, duration: number) {
        drops.push({ type: objName(obj.type), count: obj.count, x: obj.x, z: obj.z });
        return orig.call(this, obj, receiver, duration);
    } as typeof World.addObj;
    try {
        fn();
    } finally {
        World.addObj = orig;
    }
    return drops;
}

function objName(id: number): string {
    for (const n of ['coins', 'bread', 'trout', 'swordfish', 'shark']) if (ids.obj(n) === id) return n;
    return String(id);
}

test('Bounty drops 5 + 3*baseHP coins and food by tier at the death tile; nothing without the relic', t => {
    if (skip()) return t.skip(String(skip()));
    const tiers: [string, number, string][] = [
        ['chicken', 3, 'bread'],
        ['giant', 35, 'trout'],
        ['lesser_demon', 79, 'swordfish'],
        ['black_demon', 157, 'shark']
    ];
    let row = 0;
    for (const [npc, hp, food] of tiers) {
        for (const relics of [[], [9]]) {
            const at = { x: SPOT.bounty.x - 8 + row * 4, z: SPOT.bounty.z - 6 };
            row++;
            const bot = relicBot(at, relics);
            const drops = recordDrops(() => {
                bot.debugproc('relic_kill', npc); // npc_add one tile east, then its death queue
                bot.tick(4);
            });
            const ex = { x: at.x + 1, z: at.z };
            const coins = drops.filter(d => d.type === 'coins' && d.count === 5 + hp * 3 && d.x === ex.x && d.z === ex.z);
            const fish = drops.filter(d => d.type === food && d.count === 1 && d.x === ex.x && d.z === ex.z);
            if (relics.length) {
                assert.equal(coins.length, 1, `${npc}: coins ${5 + hp * 3} in ${JSON.stringify(drops)}`);
                assert.equal(fish.length, 1, `${npc}: ${food} in ${JSON.stringify(drops)}`);
                // Bounty runs first in npc_death, so the bounty coins are the first drop.
                assert.deepEqual(drops[0], { type: 'coins', count: 5 + hp * 3, ...ex });
                const pile = bot.findObj('coins', 3);
                assert.ok(pile.x === ex.x && pile.z === ex.z && pile.count >= 5 + hp * 3);
                bot.findObj(food, 3);
            } else {
                assert.equal(coins.length, 0, `${npc} control: ${JSON.stringify(drops)}`);
                assert.equal(fish.length, 0, `${npc} control: ${JSON.stringify(drops)}`);
            }
            bot.remove();
        }
    }
});

// ----------------------------------------------------------------------- combat relics: +50% accuracy (attack roll)

/** Run [proc,name] as `bot` with no active target and return its int result. */
function callProc(bot: Bot, name: string, ...args: number[]): number {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, `no proc ${name}`);
    const state = ScriptRunner.init(script, bot.player, null, args);
    bot.player.executeScript(state, true, true);
    return state.isp > 0 ? state.popInt() : NaN;
}

test('every combat relic (3-9) gives +50% to the attack roll of every style, and they stack additively', t => {
    if (skip()) return t.skip(String(skip()));
    // style ids: Content/scripts/skill_combat/configs/combat_damagetypes.constant (stab 0, slash 1, crush 2, ranged 3, magic 4)
    const varps = ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'];
    const plain = relicBot(SPOT.taken, []);
    const rolls = [1000, 777, 3, 1, 0];
    for (const id of [3, 4, 5, 6, 7, 8, 9, 3 + 100]) {
        // id 103 is not a relic: control that a non-combat relic (15 Infinite Runes) does nothing
        const relics = id === 103 ? [15] : [id];
        const bot = relicBot(SPOT.taken, relics);
        for (let style = 0; style < 5; style++) {
            for (const roll of rolls) {
                plain.player.setVar(ids.varp(varps[style]), roll);
                bot.player.setVar(ids.varp(varps[style]), roll);
                const base = callProc(plain, 'player_attack_roll_specific', style);
                const got = callProc(bot, 'player_attack_roll_specific', style);
                assert.equal(base, roll, `plain style ${style}`);
                const expected = id === 103 ? roll : Math.floor((roll * 150) / 100);
                assert.equal(got, expected, `relic ${id} style ${style} roll ${roll}`);
            }
        }
    }
    // each combat relic adds its own +50% (additive: 2 relics x2.0, 3 relics x2.5, all 7 x4.5)
    for (const [relics, pct] of [[[3, 5], 200], [[3, 5, 8], 250], [[3, 4, 5, 6, 7, 8, 9], 450]] as [number[], number][]) {
        const many = relicBot(SPOT.taken, relics);
        many.player.setVar(ids.varp('com_rangeattack'), 1000);
        assert.equal(callProc(many, 'player_attack_roll_specific', 3), pct * 10, `${relics.length} combat relics`);
    }
});

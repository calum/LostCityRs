// Work package A of the skilling-relics brief (docs/design/skilling-relics-brief.md): relics 25 Prospector's Pick,
// 26 Forge Echo, 27 Endless Shoal, 28 Fletcher's Echo, 29 Hunter's Haul.
// Mod code: mods/relics/scripts/relic_skilling.rs2 (+ ~relic_fished in relic_gather.rs2). Content hooks: grep "relic hook" in
// skill_mining/scripts/mining.rs2, skill_woodcutting/scripts/woodcut.rs2, skill_fishing/scripts/fishing_spots/*.rs2,
// skill_fishing/scripts/fishing_movement.rs2, skill_smithing/scripts/smelting/smelting.rs2, skill_smithing/scripts/smithing/smithing.rs2,
// skill_fletching/scripts/*.rs2 and drop tables/scripts/{cow,*_dragon}.rs2.
//
// Random rolls use the harness seed (World seeds Math.random and JavaRandom), so runs repeat. Echo/gem rolls are 50%: the tests
// count over 200 (or 60) calls and accept a band that a fair coin misses with probability below 1e-9.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, ids, LUMBRIDGE, spawnNpc, World } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';
import { locNear, standNear } from './relic-helpers.js';

import ObjType from '../Engine-TS/src/cache/config/ObjType.js';
import NpcEntity from '../Engine-TS/src/engine/entity/Npc.js';
import ScriptProvider from '../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../Engine-TS/src/engine/script/ScriptRunner.js';
import Environment from '../Engine-TS/src/util/Environment.js';

useVanillaWorld();

const skip = () => (hasVarp('relic_owned') ? false : 'relic mod not loaded');

const PROSPECTOR = 25;
const FORGE = 26;
const SHOAL = 27;
const FLETCHER = 28;
const HAUL = 29;
const ETERNAL_VEIN = 10;
const EVERGREEN = 11;
const DOUBLE_YIELD = 12;

const MINE = { x: 3299, z: 3311, level: 0 };
const DRAYNOR = { x: 3087, z: 3228, level: 0 }; // next to the Draynor net/bait spot 0_48_50_saltfish (spawn 3085,3231)

/** Player.addXp multiplies every stat_advance by node.xpRate * max(1, %relic_xp_factor) (Engine-TS Player.ts addXp). */
function xpMulti(bot: Bot): number {
    return Environment.node.xpRate * Math.max(1, bot.varp('relic_xp_factor') as number);
}

/** Own exactly these relics (bit n of relic_owned, relic_offer.rs2 relic_grant). */
function own(bot: Bot, ...relics: number[]): Bot {
    return bot.setVar(
        'relic_owned',
        relics.reduce((m, id) => m | (1 << id), 0)
    );
}

function relicBot(relics: number[], opts: { at?: { x: number; z: number; level?: number }; levels?: Record<string, number> } = {}): Bot {
    const bot = Bot.spawn({ at: opts.at ?? MINE, levels: opts.levels });
    bot.clearInv();
    bot.clearInv('bank');
    bot.setVar('relic_tasks_done', 0x1ffffff); // every task done: a task completion would open a relic offer over the test
    return own(bot, ...relics);
}

/** Run a script as `bot` (Bot.call cannot: procs report no parameter types). Strings are obj names. Returns the int result, or NaN. */
function run(bot: Bot, name: string, ...args: (string | number)[]): number {
    const full = name.startsWith('[') ? name : `[proc,${name}]`;
    const script = ScriptProvider.getByName(full);
    assert.ok(script, `no script ${full}`);
    const state = ScriptRunner.init(script, bot.player, null, args.map(a => (typeof a === 'string' ? ids.obj(a) : a)));
    bot.player.executeScript(state, true, true);
    return state.isp > 0 ? state.popInt() : NaN;
}

function total(bot: Bot, objs: string[]): number {
    return objs.reduce((n, o) => n + bot.count(o) + bot.count(o, 'bank'), 0);
}

// ---------------------------------------------------------------- 25 Prospector's Pick: the roll interval

test('prospector: ~relic_gather_delay is 1 with the relic and the given delay without it', t => {
    if (skip()) return t.skip(String(skip()));
    const plain = relicBot([]);
    const bot = relicBot([PROSPECTOR]);
    for (const n of [2, 3, 4, 5, 7]) {
        assert.equal(run(plain, 'relic_gather_delay', n), n);
        assert.equal(run(bot, 'relic_gather_delay', n), 1);
    }
});

/** Ore mined in 60 ticks from one copper rock with a bronze pickaxe (mining_rate 7). Eternal Vein keeps the rock standing. */
function oreIn60Ticks(relics: number[]): number {
    const bot = relicBot([ETERNAL_VEIN, ...relics], { levels: { mining: 99 } });
    bot.give('bronze_pickaxe');
    const rock = locNear('copperrock1', MINE.x, MINE.z, 20);
    bot.teleport(standNear(rock));
    bot.opLoc(rock, 1);
    bot.tick(60);
    return bot.count('bronze_bar', 'bank');
}

test('prospector: mining with the relic rolls about 4x as often as a bronze pickaxe alone (interval 2 against 8 ticks)', t => {
    if (skip()) return t.skip(String(skip()));
    const base = oreIn60Ticks([]);
    const fast = oreIn60Ticks([PROSPECTOR]);
    assert.ok(base >= 4 && base <= 9, `control: ${base} bars in 60 ticks`);
    assert.ok(fast >= 18, `prospector: ${fast} bars in 60 ticks (control ${base})`);
});

/** Logs chopped in 60 ticks from a tree next to the bot (::~relic_chop). Evergreen keeps the tree and banks the logs. */
function logsIn60Ticks(relics: number[]): number {
    const bot = relicBot([EVERGREEN, ...relics], { levels: { woodcutting: 99 } });
    bot.give('rune_axe');
    bot.debugproc('relic_chop'); // relic_debug.rs2: loc_add a tree one tile east and p_oploc(1)
    bot.tick(60);
    return bot.count('logs', 'bank');
}

test('prospector: woodcutting with the relic rolls about 2x as often (interval 2 against 4 ticks)', t => {
    if (skip()) return t.skip(String(skip()));
    const base = logsIn60Ticks([]);
    const fast = logsIn60Ticks([PROSPECTOR]);
    assert.ok(base >= 6, `control: ${base} logs in 60 ticks`);
    assert.ok(fast >= base * 1.6, `prospector: ${fast} logs in 60 ticks (control ${base})`);
});

const NET_FISH = ['raw_shrimp', 'raw_anchovies'];

/** Fish caught in 50 ticks at the Draynor net spot. Endless Shoal sends them to the bank, so a full backpack never stops the count. */
function fishIn50Ticks(relics: number[]): number {
    const bot = relicBot([SHOAL, ...relics], { at: DRAYNOR, levels: { fishing: 99 } });
    bot.give('net');
    const spot = bot.findNpc('0_48_50_saltfish', 12);
    bot.opNpc(spot, 1);
    bot.tick(50);
    return total(bot, NET_FISH);
}

test('prospector: fishing with the relic rolls about 2.5x as often (interval 2 against 5 ticks)', t => {
    if (skip()) return t.skip(String(skip()));
    const base = fishIn50Ticks([]);
    const fast = fishIn50Ticks([PROSPECTOR]);
    assert.ok(base >= 3, `control: ${base} fish in 50 ticks`);
    assert.ok(fast >= base * 1.8, `prospector: ${fast} fish in 50 ticks (control ${base})`);
});

// ---------------------------------------------------------------- 27 Endless Shoal

test('endless shoal: a net catch goes to the bank, not the backpack, and a full backpack does not stop fishing', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([SHOAL], { at: DRAYNOR, levels: { fishing: 99 } });
    bot.give('net');
    for (let i = 0; i < 27; i++) bot.give('logs', 1); // 27 + the net = a full backpack (logs do not stack)
    const spot = bot.findNpc('0_48_50_saltfish', 12);
    bot.opNpc(spot, 1);
    bot.tick(40);
    assert.ok(total(bot, NET_FISH) >= 3, bot.describe());
    assert.equal(bot.count('raw_shrimp') + bot.count('raw_anchovies'), 0, 'nothing in the backpack');
    bot.expectNoMessage("You can't carry any more fish");
});

test('endless shoal control: without the relic the fish go to the backpack', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([], { at: DRAYNOR, levels: { fishing: 99 } });
    bot.give('net');
    const spot = bot.findNpc('0_48_50_saltfish', 12);
    bot.opNpc(spot, 1);
    bot.tick(40);
    assert.ok(bot.count('raw_shrimp') + bot.count('raw_anchovies') >= 2, bot.describe());
    assert.equal(bot.count('raw_shrimp', 'bank') + bot.count('raw_anchovies', 'bank'), 0);
});

test('endless shoal + double yield: the catch arrives cooked in the bank (cooking xp, never burnt)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([SHOAL, DOUBLE_YIELD]);
    const xp0 = bot.xp('cooking');
    bot.debugproc('relic_fish', 'raw_trout'); // relic_debug.rs2: ~relic_fished
    assert.equal(bot.count('trout', 'bank'), 2);
    assert.equal(bot.count('raw_trout', 'bank') + bot.count('raw_trout'), 0);
    assert.equal(bot.count('trout'), 0);
    assert.ok(bot.xp('cooking') > xp0);
});

test('endless shoal: ~relic_fished banks the raw fish and counts 1 (2 with double yield)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([SHOAL]);
    assert.equal(run(bot, 'relic_fished', 'raw_shrimp'), 1);
    assert.equal(bot.count('raw_shrimp', 'bank'), 1);
    assert.equal(bot.count('raw_shrimp'), 0);
});

/** Move every fishing spot of one type to a tile and report whether the first one left after its timer fired. */
test('endless shoal: a spot with a relic owner next to it does not move away when its timer fires', t => {
    if (skip()) return t.skip(String(skip()));
    const hold = (relics: number[]) => {
        const bot = relicBot(relics, { at: DRAYNOR });
        const spot = bot.findNpc('0_48_50_saltfish', 12);
        const from = { x: spot.x, z: spot.z };
        spot.timerInterval = 1; // fire [ai_timer,_saltfish] (fishing_movement.rs2) on the next npc cycle
        spot.timerClock = 0;
        bot.tick(6);
        const moved = spot.x !== from.x || spot.z !== from.z;
        bot.remove();
        return moved;
    };
    assert.equal(hold([]), true, 'control: the spot moves');
    assert.equal(hold([SHOAL]), false, 'with the relic it stays');
});

// ---------------------------------------------------------------- 26 Forge Echo

/** Run `proc` 200 times and return how many extra products reached the bank. */
function echoes(bot: Bot, proc: string, product: string, count: number, xp: number): number {
    for (let i = 0; i < 200; i++) run(bot, proc, product, count, xp);
    return bot.count(product, 'bank');
}

test('forge echo: 50% of ~relic_forge_echo calls bank one extra product and grant its smithing xp', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FORGE]);
    const xp0 = bot.xp('smithing');
    const n = echoes(bot, 'relic_forge_echo', 'steel_bar', 1, 175);
    assert.ok(n >= 60 && n <= 140, `${n} echoes in 200`);
    assert.equal(bot.xp('smithing') - xp0, n * 175 * xpMulti(bot));
    assert.equal(bot.count('steel_bar'), 0, 'nothing in the backpack');
});

test('forge echo: an extra batch is as big as the product (15 bronze arrowtips)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FORGE]);
    echoes(bot, 'relic_forge_echo', 'bronze_arrowheads', 15, 125);
    const n = bot.count('bronze_arrowheads', 'bank');
    assert.ok(n > 0 && n % 15 === 0, `bank has ${n}`);
});

test('forge echo control: without the relic nothing is added', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([]);
    const xp0 = bot.xp('smithing');
    assert.equal(echoes(bot, 'relic_forge_echo', 'steel_bar', 1, 175), 0);
    assert.equal(bot.xp('smithing'), xp0);
});

/** Fill every bank slot with a distinct obj (the bank is stackall: one slot per obj type), except `skipObj`. */
function fillBank(bot: Bot, skipObj: string) {
    const bankId = ids.inv('bank');
    const bank = bot.player.getInventory(bankId)!;
    const skip = ids.obj(skipObj);
    for (let id = 0; id < ObjType.count && bank.freeSlotCount > 0; id++) {
        const t = ObjType.get(id);
        if (!t || id === skip || t.dummyitem !== 0 || t.certtemplate !== -1) continue;
        bot.player.invAdd(bankId, id, 1);
    }
    assert.equal(bank.freeSlotCount, 0, 'bank should be full');
}

test('forge echo: with the bank full the extra goes to the backpack, with both full it is lost', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FORGE]);
    fillBank(bot, 'steel_bar');
    run(bot, 'relic_bank_extra', 'steel_bar', 1);
    assert.equal(bot.count('steel_bar'), 1, 'bank full: backpack');
    for (let i = 0; i < 27; i++) bot.give('logs', 1);
    run(bot, 'relic_bank_extra', 'steel_bar', 1);
    assert.equal(bot.count('steel_bar'), 1, 'both full: nothing more');
});

test('forge echo: Eternal Vein smelting rolls per bar (two bars with double yield roll twice)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([ETERNAL_VEIN, FORGE, DOUBLE_YIELD]);
    let bars = 0;
    for (let i = 0; i < 100; i++) run(bot, 'relic_gathered', 'copper_ore', 10);
    bars = bot.count('bronze_bar', 'bank');
    // 100 ores x 2 (double yield) = 200 bars, plus about one extra bar per two bars made
    assert.ok(bars >= 200 + 60 && bars <= 200 + 140, `${bars} bronze bars`);
});

test('forge echo: a real furnace smelt can echo (silver ore at the Lumbridge furnace)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FORGE], { at: LUMBRIDGE, levels: { smithing: 99 } });
    const furnace = locNear('furnace1', bot.x, bot.z, 60);
    bot.teleport(standNear(furnace));
    let made = 0;
    let smelted = 0; // bars that reached the backpack the normal way: proves the real smelting path ran
    for (let i = 0; i < 40 && bot.count('silver_bar', 'bank') === 0; i++) {
        bot.give('silver_ore');
        bot.useOnLoc('silver_ore', furnace);
        bot.waitUntil(() => bot.count('silver_ore') === 0, 60, 'the ore is smelted');
        bot.tick(4);
        smelted += bot.count('silver_bar');
        made++;
        bot.clearInv();
    }
    assert.equal(smelted, made, 'every smelt made its bar');
    assert.ok(bot.count('silver_bar', 'bank') >= 1, `no echo in ${made} smelts`);
});

test('forge echo: smithing at an anvil can echo (bronze daggers)', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FORGE], { levels: { smithing: 99 } });
    let made = 0;
    let smithed = 0; // daggers that reached the backpack the normal way
    for (let i = 0; i < 40 && bot.count('bronze_dagger', 'bank') === 0; i++) {
        bot.give('bronze_bar', 1);
        run(bot, '[label,attempt_smithing]', 'bronze_dagger', 1); // smithing.rs2: the label the anvil interface buttons jump to
        bot.tick(8);
        smithed += bot.count('bronze_dagger');
        made++;
        bot.clearInv();
    }
    assert.equal(smithed, made, 'every smith made its dagger');
    assert.ok(bot.count('bronze_dagger', 'bank') >= 1, `no echo in ${made} smiths`);
});

// ---------------------------------------------------------------- 28 Fletcher's Echo

test('fletcher: 50% of ~relic_fletch_echo calls bank one extra product and grant its fletching xp', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FLETCHER]);
    const xp0 = bot.xp('fletching');
    const n = echoes(bot, 'relic_fletch_echo', 'magic_shortbow', 1, 825);
    assert.ok(n >= 60 && n <= 140, `${n} echoes in 200`);
    assert.equal(bot.xp('fletching') - xp0, n * 825 * xpMulti(bot));
});

test('fletcher control: without the relic nothing is added; forge echo does not echo fletching', t => {
    if (skip()) return t.skip(String(skip()));
    assert.equal(echoes(relicBot([]), 'relic_fletch_echo', 'magic_shortbow', 1, 825), 0);
    assert.equal(echoes(relicBot([FORGE]), 'relic_fletch_echo', 'magic_shortbow', 1, 825), 0);
    assert.equal(echoes(relicBot([FLETCHER]), 'relic_forge_echo', 'steel_bar', 1, 175), 0);
});

test('fletcher: stringing a bow can echo', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([FLETCHER], { levels: { fletching: 99 } });
    let made = 0;
    let strung = 0; // bows that reached the backpack the normal way
    for (let i = 0; i < 40 && bot.count('magic_shortbow', 'bank') === 0; i++) {
        bot.give('unstrung_magic_shortbow').give('bow_string');
        bot.useOnHeld('bow_string', 'unstrung_magic_shortbow'); // [opheldu,_unstrung_bow] -> string_bow (bows.rs2)
        bot.waitUntil(() => bot.count('unstrung_magic_shortbow') === 0, 20, 'the bow is strung');
        bot.tick(4);
        strung += bot.count('magic_shortbow');
        made++;
        bot.clearInv();
    }
    assert.equal(strung, made, 'every stringing made its bow');
    assert.ok(bot.count('magic_shortbow', 'bank') >= 1, `no echo in ${made} bows`);
});

// ---------------------------------------------------------------- 29 Hunter's Haul

const GEMS = ['uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'];

/** Run [proc,name] as `bot` with `npc` as the active npc (ScriptRunner.init target), as a death queue would. */
function callWithNpc(bot: Bot, name: string, npc: NpcEntity, ...args: (string | number)[]) {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, `no proc ${name}`);
    const state = ScriptRunner.init(script, bot.player, npc, args.map(a => (typeof a === 'string' ? ids.obj(a) : a)));
    bot.player.executeScript(state, true, true);
}

/** Run [proc,relic_drop_hide] as `bot` with a cow as the active npc, `n` times. */
function dropHides(bot: Bot, n: number, hide = 'cow_hide', leather = 'leather') {
    const cow = spawnNpc('cow', { x: bot.x + 2, z: bot.z });
    bot.tick();
    for (let i = 0; i < n; i++) {
        callWithNpc(bot, 'relic_drop_hide', cow as NpcEntity, hide, leather);
    }
    bot.tick(3); // the items are added from player queues (relic_skilling.rs2)
    World.removeNpc(cow as NpcEntity, -1);
}

test("hunter's haul: a hide drop becomes 3 tanned leather in the bank, no hide on the ground", t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([HAUL]);
    dropHides(bot, 1);
    assert.equal(bot.count('leather', 'bank'), 3);
    assert.equal(bot.count('leather'), 0);
    assert.throws(() => bot.findObj('cow_hide', 6), 'no cow_hide on the ground');
});

test("hunter's haul control: without the relic the hide is dropped as before", t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([]);
    dropHides(bot, 1);
    assert.equal(bot.count('leather', 'bank'), 0);
    assert.equal(total(bot, GEMS), 0);
    bot.findObj('cow_hide', 6);
});

test("hunter's haul: 50% of hide drops also bank one random uncut gem", t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([HAUL]);
    dropHides(bot, 60);
    assert.equal(bot.count('leather', 'bank'), 180);
    const gems = total(bot, GEMS);
    assert.ok(gems >= 14 && gems <= 46, `${gems} gems in 60 drops`);
    const kinds = GEMS.filter(g => bot.count(g, 'bank') > 0).length;
    assert.ok(kinds >= 3, `${kinds} gem kinds`);
});

test("hunter's haul: each dragon hide tans to its own leather", t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([HAUL]);
    for (const [hide, leather] of [
        ['dragonhide_green', 'dragon_leather'],
        ['dragonhide_blue', 'dragon_leather_blue'],
        ['dragonhide_red', 'dragon_leather_red'],
        ['dragonhide_black', 'dragon_leather_black']
    ]) {
        dropHides(bot, 1, hide, leather);
        assert.equal(bot.count(leather, 'bank'), 3, leather);
    }
});

test("hunter's haul: a real cow kill and a real green dragon kill use the hook", t => {
    if (skip()) return t.skip(String(skip()));
    const bot = relicBot([HAUL]);
    bot.debugproc('relic_kill', 'cow'); // relic_debug.rs2: npc_add east, credit the kill, run the real ai_queue3
    bot.tick(12); // npc_death ends with npc_delay(1) and npc_del; the drop lines run after it
    assert.equal(bot.count('leather', 'bank'), 3);
    bot.debugproc('relic_kill', 'green_dragon');
    bot.tick(12); // npc_death ends with npc_delay(1) and npc_del; the drop lines run after it
    assert.equal(bot.count('dragon_leather', 'bank'), 3);
    assert.equal(bot.count('dragonhide_green', 'bank') + bot.count('dragonhide_green'), 0);
});

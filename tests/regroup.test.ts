// ::regroup (mods/regroup/): any player can teleport to another logged-in player, once per 10 minutes of play time.
//   ::regroup <name>   teleports to that player
//   ::regroup          opens a list of everyone else who is signed in; clicking a name teleports there
// Engine hooks: ClientCheatHandler runs [label,playercmd_<cmd>] for every player, and the script command world_playeruid lists players.
// The cooldown is %regroup_last (a perm varp holding %relic_playticks at the last use), so it survives relog and counts only time logged in.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

useVanillaWorld();

const COOLDOWN_TICKS = 1000; // 10 minutes of 0.6 s ticks
const FALADOR = { x: 2965, z: 3378 };
const VARROCK = { x: 3213, z: 3424 };
const YANILLE = { x: 2606, z: 3093 };
const near = (bot: Bot, c: { x: number; z: number }, r = 3) => Math.abs(bot.x - c.x) <= r && Math.abs(bot.z - c.z) <= r && bot.level === 0;

/** A plain player (no staff level), so only commands open to everyone work. */
const player = (name: string, at: { x: number; z: number; level?: number }) => Bot.spawn({ name, at, staff: 0 });

const rowTexts = (bot: Bot) => {
    const out: string[] = [];
    for (let i = 0; i < 30; i++) {
        const t = bot.texts.get(`regroup_menu:row_${i}`);
        if (t) out.push(t);
    }
    return out;
};
const rowOf = (bot: Bot, name: string) => {
    for (let i = 0; i < 30; i++) {
        // the list shows display names: capitalised, underscores as spaces
        if (bot.texts.get(`regroup_menu:row_${i}`)?.toLowerCase().includes(name.replace(/_/g, ' '))) return i;
    }
    return -1;
};

// First on purpose: every test file shares one world and bots stay logged in, so only the first test sees an empty server.
test('regroup (no name): with nobody else online it says so instead of opening an empty list', () => {
    const a = player('rg_jay', YANILLE);
    a.cheat('regroup');
    a.tick(3);
    assert.equal(a.mainModal, null);
    assert.ok(a.messages.some(m => /no other players/i.test(m)), a.messages.join(' | '));
});

test('regroup <name>: a player without staff rights teleports to the named player', () => {
    const a = player('rg_alice', YANILLE);
    const b = player('rg_bob', FALADOR);
    a.cheat('regroup rg_bob');
    a.waitUntil(() => near(a, FALADOR), 15, 'arrival next to rg_bob');
    assert.equal(b.x, FALADOR.x);
});

test('regroup <name>: the name is case-insensitive', () => {
    const a = player('rg_cara', YANILLE);
    player('rg_dave', FALADOR);
    a.cheat('regroup RG_Dave');
    a.waitUntil(() => near(a, FALADOR), 15, 'arrival next to rg_dave');
});

test('regroup <name>: a name with a space can be typed with an underscore', () => {
    const a = player('rg_ed', YANILLE);
    player('rg fay', VARROCK);
    a.cheat('regroup rg_fay');
    a.waitUntil(() => near(a, VARROCK), 15, 'arrival next to "rg fay"');
});

test('regroup: a second use inside 10 minutes is refused with the time left, and does not move the player', () => {
    const a = player('rg_gus', YANILLE);
    player('rg_hal', FALADOR);
    player('rg_ivy', VARROCK);
    a.cheat('regroup rg_hal');
    a.waitUntil(() => near(a, FALADOR), 15, 'first regroup');
    a.tick(5);
    a.cheat('regroup rg_ivy');
    a.tick(15);
    assert.ok(near(a, FALADOR), `second regroup must not move the player, at ${a.x},${a.z}`);
    const msg = a.messages.filter(m => /regroup/i.test(m)).at(-1) ?? '';
    assert.match(msg, /9m \d\ds/, `the refusal tells the time left: "${msg}"`);
});

test('regroup: usable again once 10 minutes of play time have passed', () => {
    const a = player('rg_jon', YANILLE);
    player('rg_kim', FALADOR);
    player('rg_lee', VARROCK);
    a.cheat('regroup rg_kim');
    a.waitUntil(() => near(a, FALADOR), 15, 'first regroup');
    a.setVar('relic_playticks', Number(a.varp('relic_playticks')) + COOLDOWN_TICKS);
    a.tick(2);
    a.cheat('regroup rg_lee');
    a.waitUntil(() => near(a, VARROCK), 15, 'second regroup after the cooldown');
});

test('regroup: the cooldown survives a relog', () => {
    let a = player('rg_max', YANILLE);
    player('rg_ned', FALADOR);
    player('rg_oli', VARROCK);
    a.cheat('regroup rg_ned');
    a.waitUntil(() => near(a, FALADOR), 15, 'first regroup');
    a.tick(5);
    a = a.relog();
    a.tick(5);
    const before = { x: a.x, z: a.z };
    a.cheat('regroup rg_oli');
    a.tick(15);
    assert.deepEqual({ x: a.x, z: a.z }, before, 'relog must not reset the cooldown');
    assert.match(a.messages.filter(m => /regroup/i.test(m)).at(-1) ?? '', /again in \d+m \d\ds/);
});

test('regroup <name>: an unknown or offline name is reported and does not use up the cooldown', () => {
    const a = player('rg_pat', YANILLE);
    player('rg_quin', FALADOR);
    a.cheat('regroup nobody_here');
    a.tick(3);
    assert.ok(a.messages.some(m => /nobody here is not (logged in|signed in)/i.test(m)), a.messages.join(' | '));
    a.cheat('regroup rg_quin');
    a.waitUntil(() => near(a, FALADOR), 15, 'regroup still available');
});

test('regroup <name>: your own name is refused and does not use up the cooldown', () => {
    const a = player('rg_ron', YANILLE);
    player('rg_sue', FALADOR);
    a.cheat('regroup rg_ron');
    a.tick(3);
    assert.ok(a.messages.some(m => /yourself/i.test(m)), a.messages.join(' | '));
    a.cheat('regroup rg_sue');
    a.waitUntil(() => near(a, FALADOR), 15, 'regroup still available');
});

test('regroup: nobody on Tutorial Island can use it, and nobody can regroup onto the island', () => {
    const island = { x: 3100, z: 3100 };
    const newbie = player('rg_tom', island);
    player('rg_uma', FALADOR);
    newbie.cheat('regroup rg_uma');
    newbie.tick(15);
    assert.ok(Math.abs(newbie.x - island.x) < 30, `a player on Tutorial Island stays there, at ${newbie.x},${newbie.z}`);

    const a = player('rg_val', YANILLE);
    a.cheat('regroup rg_tom');
    a.tick(15);
    assert.ok(near(a, YANILLE, 5), `a regroup onto Tutorial Island is refused, at ${a.x},${a.z}`);
    // refused regroups do not use up the cooldown
    player('rg_wes', FALADOR);
    a.cheat('regroup rg_wes');
    a.waitUntil(() => near(a, FALADOR), 15, 'regroup still available');
});

test('regroup (no name): opens a list of the other signed-in players', () => {
    const a = player('rg_xan', YANILLE);
    player('rg_yan', FALADOR);
    player('rg_zed', VARROCK);
    a.cheat('regroup');
    a.tick(3);
    assert.equal(a.mainModal, 'regroup_menu');
    const rows = rowTexts(a).join(' | ');
    assert.match(rows, /Rg Yan/);
    assert.match(rows, /Rg Zed/);
    assert.doesNotMatch(rows, /Rg Xan/, 'the list leaves out the player who opened it');
});

test('regroup (no name): clicking a name teleports there and closes the list', () => {
    const a = player('rg_ann', YANILLE);
    player('rg_ben', FALADOR);
    player('rg_cy', VARROCK);
    a.cheat('regroup');
    a.tick(3);
    const row = rowOf(a, 'rg_cy');
    assert.ok(row >= 0, 'rg_cy is listed');
    a.clickButton(`regroup_menu:row_${row}`);
    a.waitUntil(() => near(a, VARROCK), 15, 'arrival next to rg_cy');
    assert.equal(a.mainModal, null);
});

test('regroup (no name): clicking while the cooldown runs is refused', () => {
    const a = player('rg_di', YANILLE);
    player('rg_ez', FALADOR);
    player('rg_flo', VARROCK);
    a.cheat('regroup rg_ez');
    a.waitUntil(() => near(a, FALADOR), 15, 'first regroup');
    a.tick(5);
    a.cheat('regroup');
    a.tick(3);
    const row = rowOf(a, 'rg_flo');
    assert.ok(row >= 0, 'the list still opens during the cooldown');
    assert.match(a.texts.get('regroup_menu:status') ?? '', /\d+m \d\ds/, 'the list shows the time left');
    a.clickButton(`regroup_menu:row_${row}`);
    a.tick(15);
    assert.ok(near(a, FALADOR), 'a click during the cooldown does not teleport');
});

test('regroup (no name): when the signed-in list changed since it was opened, a click does not teleport to someone else', () => {
    const a = player('rg_gil', YANILLE);
    const b = player('rg_hex', FALADOR);
    player('rg_ike', VARROCK);
    a.cheat('regroup');
    a.tick(3);
    const row = rowOf(a, 'rg_hex');
    assert.ok(row >= 0);
    b.remove();
    a.tick(2);
    a.clickButton(`regroup_menu:row_${row}`);
    a.tick(15);
    assert.ok(near(a, YANILLE, 5), `a stale click must not teleport, at ${a.x},${a.z}`);
    assert.ok(a.messages.some(m => /list changed/i.test(m)), a.messages.join(' | '));
});

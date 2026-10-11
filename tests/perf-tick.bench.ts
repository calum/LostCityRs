// Server tick-time benchmark (NOT a behaviour test: the file name does not end in .test.ts, so `mise run test` skips it).
// Run: node harness/run.mjs --no-build tests/perf-tick.bench.ts   (or: cd Engine-TS && node --import tsx --test ../tests/perf-tick.bench.ts)
// Prints the wall time of World.cycle() per tick (median / p95 / max, ms) for several situations. Numbers depend on the machine.
// Notes: docs/flows/lag-client-vs-server.md
import fs from 'node:fs';
import { test } from 'node:test';

import { Bot, World, ids, spawnNpc } from '../harness/src/index.js';
import { hasVarp, useVanillaWorld } from './helpers.js';

import ServerTriggerType from '../Engine-TS/src/engine/script/ServerTriggerType.js';
import { stepTick } from '../harness/src/world.js';

useVanillaWorld();

const ALL_RELICS = (() => {
    let owned = 0;
    for (let id = 2; id <= 30; id++) if (id !== 15) owned |= 1 << id;
    return owned;
})();

function measure(label: string, ticks: number, before?: (i: number) => void): void {
    const ms: number[] = [];
    for (let i = 0; i < ticks; i++) {
        before?.(i);
        const t0 = performance.now();
        stepTick();
        ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2);
    const mean = (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2);
    fs.appendFileSync(process.env.BENCH_OUT ?? 'bench.txt', `BENCH ${label.padEnd(58)} median ${q(0.5)}  mean ${mean}  p95 ${q(0.95)}  max ${q(1)}  (${ticks} ticks)\n`);
}

function warm() {
    for (let i = 0; i < 30; i++) stepTick();
}

test('bench: idle world, then idle bots (relic playtime softtimer runs for each)', () => {
    warm();
    measure('0 bots', 200);
    const bots: Bot[] = [];
    for (let i = 0; i < 20; i++) bots.push(Bot.spawn({ varps: { relic_owned: 0 } }));
    warm();
    measure('20 idle bots, relic softtimer running', 200);
    for (const b of bots) b.player.timers.clear();
    measure('20 idle bots, timers cleared (no relic_playtime_timer)', 200);
    for (const b of bots) b.remove();
    for (let i = 0; i < 100; i++) bots.push(Bot.spawn({ varps: { relic_owned: ALL_RELICS } }));
    warm();
    measure('120 idle bots (100 with every relic), softtimer', 100);
    for (const b of bots) b.remove();
});

test('bench: one bot fighting cows, no relics vs every relic', t => {
    for (const [label, owned] of [['no relics', 0], ['every relic', ALL_RELICS]] as const) {
        const bot = Bot.spawn({ levels: { hitpoints: 99, attack: 99, strength: 99 }, varps: { relic_owned: owned } });
        const cows = [0, 1, 2, 3, 4].map(i => spawnNpc('cow', { x: 3224 + i, z: 3220 }, 400));
        measure(`1 bot attacking cows, ${label}`, 150, i => {
            bot.player.levels[ids.stat('hitpoints')] = 99;
            if (i % 5 === 0) {
                const c = cows.find(n => n.isActive);
                if (c) bot.opNpc(c, 2);
            }
        });
        for (const c of cows) if (c.isActive) World.removeNpc(c, 100000);
        bot.remove();
    }
});

test('bench: bonus boss fight (2 KBD + 2 KQ + glow controller, 1 bot in the lair)', t => {
    if (!hasVarp('relic_tasks_done')) return t.skip('relic mod not loaded');
    const LAIR = { x: 2717, z: 9812 };
    const bot = Bot.spawn({ at: LAIR, levels: { hitpoints: 99 }, varps: { relic_owned: (1 << 2) | (1 << 19) } });
    for (const n of [...World.npcs]) if (n && n.isActive && n.type === ids.npc('king_dragon')) World.removeNpc(n, 100000);
    measure('lair, 0 bosses, 1 bot', 50);
    const kbd = spawnNpc('king_dragon', { x: LAIR.x + 3, z: LAIR.z });
    kbd.enqueueScript(ServerTriggerType.AI_QUEUE3, 0, 0);
    for (let i = 0; i < 30; i++) stepTick();
    const alive = (type: string) => [...World.npcs].filter(n => n && n.isActive && n.type === ids.npc(type)).length;
    fs.appendFileSync(process.env.BENCH_OUT ?? 'bench.txt', `BENCH before measuring: king_dragon ${alive('king_dragon')}, kalphite_queen ${alive('kalphite_queen')}, relic_bonus_glow ${alive('relic_bonus_glow')}\n`);
    measure('lair, bonus fight running (4 bosses + glow npc)', 100, () => {
        bot.player.levels[ids.stat('hitpoints')] = 99;
    });
    fs.appendFileSync(process.env.BENCH_OUT ?? 'bench.txt', `BENCH after measuring: king_dragon ${alive('king_dragon')}, kalphite_queen ${alive('kalphite_queen')}, bot hp ${bot.player.levels[ids.stat('hitpoints')]}\n`);
});

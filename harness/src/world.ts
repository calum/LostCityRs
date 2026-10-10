// Boots the real engine World in this process and steps it one tick at a time.
// No network, no client, no wall-clock waiting: a tick runs as fast as the CPU allows.
//
// Must run with the working directory set to Engine-TS (World.ts reads
// data/config/private.pem and data/pack/ with relative paths). harness/run.mjs does that.
import fs from 'fs';

import World from '../../Engine-TS/src/engine/World.js';
import Environment from '../../Engine-TS/src/util/Environment.js';
import JavaRandom from '../../Engine-TS/src/util/JavaRandom.js';

export type LogLine = { tick: number; text: string };

export interface BootOptions {
    /**
     * Seed both random sources so runs repeat: Math.random (engine code) and JavaRandom (RuneScript
     * `random`/`randominc`, NumberOps.ts RANDOM). Default 1. Pass null to keep real randomness.
     */
    seed?: number | null;
    /** Print engine/console output as it happens (default: only when HARNESS_VERBOSE=1). */
    verbose?: boolean;
    /**
     * Ticks to run after boot, before the first test. Default 20. Content compares var timestamps
     * (0 for a new character) with map_clock (= World.currentTick, ServerOps.ts MAP_CLOCK); e.g.
     * [proc,player_in_combat_check] says "I'm already under attack!" while add(%lastcombat_pvp, 8) > map_clock,
     * so in the first 8 ticks of a fresh world nobody can attack an NPC in a single-combat area.
     */
    warmupTicks?: number;
}

const realLog = console.log.bind(console);
const realError = console.error.bind(console);

/** Everything the engine and `console(...)` in RuneScript printed, oldest first. */
export const serverLog: LogLine[] = [];

/** Print to the real stderr (console.* is captured into serverLog once the world boots). */
export function log(...args: unknown[]) {
    realError(...args);
}

let booted = false;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function captureConsole(verbose: boolean) {
    const capture =
        (real: (...a: unknown[]) => void) =>
        (...args: unknown[]) => {
            const text = args
                .map(a => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : String(a)))
                .join(' ')
                .replace(ANSI, '');
            serverLog.push({ tick: World.currentTick, text });
            if (verbose) {
                real(...args);
            }
        };
    console.log = capture(realLog);
    console.info = capture(realLog);
    console.error = capture(realError);
    console.warn = capture(realError);
}

/**
 * Seed the engine's two random sources. JavaRandom is a singleton seeded from Math.random when it
 * is first imported (JavaRandom.ts constructor), so it is reseeded here explicitly.
 * Math.random is replaced by mulberry32: small, fast, good enough for game rolls.
 */
export function seedRandom(seed: number) {
    JavaRandom.setSeed(seed >>> 0);
    let a = seed >>> 0;
    Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export async function bootWorld(options: BootOptions = {}): Promise<typeof World> {
    if (booted) {
        return World;
    }

    if (!fs.existsSync('data/pack/server/script.dat')) {
        throw new Error(`No packed cache in ${process.cwd()}/data/pack. Run "mise run test" (it packs first) or "npm run build" in Engine-TS.`);
    }

    // World.start would otherwise start the file-watching DevThread (World.ts:316-321).
    Environment.build.liveReload = false;
    Environment.build.startup = false;
    // debugprocs only run when not production (ClientCheatHandler.ts:57).
    Environment.node.production = false;

    const seed = options.seed === undefined ? 1 : options.seed;
    if (seed !== null) {
        seedRandom(seed);
    }

    captureConsole(options.verbose ?? process.env.HARNESS_VERBOSE === '1');

    // skipMaps=false: load the real map, NPC spawns and locs. startCycle=false: we drive cycle() ourselves.
    await World.start(false, false);

    // The login, friend and logger worker threads are not needed: players join in-process, and we do
    // not want saves (LoginThread.ts player_logout writes data/players/*.sav) or logs written to disk.
    // postMessage on a terminated worker is a no-op.
    const w = World as unknown as Record<string, { terminate(): Promise<number> } | undefined>;
    await Promise.all(['loginThread', 'friendThread', 'loggerThread'].map(k => w[k]?.terminate()));

    booted = true;

    for (let i = 0; i < (options.warmupTicks ?? 20); i++) {
        stepTick();
    }
    return World;
}

export class EngineCrash extends Error {}

/**
 * Run exactly one World.cycle() synchronously.
 * World.cycle() ends by scheduling itself with setTimeout (World.ts:508); that one call is swallowed.
 * If the cycle throws, World.cycle() logs "eep eep cabbage", removes all players and calls
 * process.exit(1) (World.ts:509-524); that exit is turned into an EngineCrash so the test fails with the cause.
 */
export function stepTick(): void {
    const realSetTimeout = globalThis.setTimeout;
    const realExit = process.exit;
    const before = serverLog.length;

    (globalThis as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
        if (typeof fn === 'function' && fn.name === 'bound cycle') {
            return undefined;
        }
        return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout;

    process.exit = ((code?: number) => {
        const tail = serverLog
            .slice(before)
            .map(l => l.text)
            .join('\n');
        throw new EngineCrash(`World.cycle() crashed on tick ${World.currentTick} (exit ${code}).\n${tail}`);
    }) as typeof process.exit;

    try {
        World.cycle();
    } finally {
        globalThis.setTimeout = realSetTimeout;
        process.exit = realExit;
    }
}

export { World };

// Public entry point for tests: import { useWorld, Bot } from '../harness/src/index.js'
import { after, afterEach, before } from 'node:test';

import { bootWorld, BootOptions } from './world.js';
import { Bot } from './Bot.js';

export { Bot, HarnessError, ids, LUMBRIDGE, parseCoord, spawnNpc } from './Bot.js';
export type { Coord, CoordLike, SpawnOptions } from './Bot.js';
export { TestPlayer } from './TestPlayer.js';
export { bootWorld, EngineCrash, log, seedRandom, serverLog, stepTick, World } from './world.js';

/**
 * Call once at the top of a test file. Boots the World before the first test (one World per
 * file: node --test runs each file in its own process), and removes every bot after each test so
 * tests do not see each other's players. World state (NPCs killed, locs changed, objs dropped)
 * does carry over between tests in the same file.
 */
export function useWorld(options: BootOptions = {}) {
    before(async () => {
        await bootWorld(options);
    });
    afterEach(() => {
        for (const bot of [...Bot.live]) {
            bot.remove();
        }
    });
    after(() => {
        for (const bot of [...Bot.live]) {
            bot.remove();
        }
    });
}

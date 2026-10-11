// Shared set-up for tests in this folder.
import { before } from 'node:test';

import { Bot, ids, useWorld } from '../harness/src/index.js';

/**
 * Boot the world. When the relic mod (mods/relics) is loaded, also make every new bot look like a
 * character whose relic run already started, so the first relic offer ([proc,relic_first_offer],
 * queued from [login,_] via ~relic_on_login) does not open a choice over tests of unrelated content.
 */
export function useVanillaWorld() {
    useWorld();
    before(() => {
        if (hasVarp('relic_started')) {
            // relic_tasks_done2 bit 8 = task 40 (reach level 99 in any skill) done: bots with a 99 would otherwise be given it at login and
            // have a relic offer open over the test. The task 40 tests clear it themselves.
            Bot.defaults = { varps: { relic_started: 1, relic_tasks_done2: 1 << 8 } };
        }
    });
}

export function hasVarp(name: string): boolean {
    try {
        ids.varp(name);
        return true;
    } catch {
        return false;
    }
}

// Helpers shared by the relic task tests (copied from relic-tasks.test.ts, which keeps its own copy).
import fs from 'node:fs';

import { World, ids } from '../harness/src/index.js';
import type { Bot } from '../harness/src/index.js';

import LocType from '../Engine-TS/src/cache/config/LocType.js';
import { CoordGrid } from '../Engine-TS/src/engine/CoordGrid.js';
import type Loc from '../Engine-TS/src/engine/entity/Loc.js';
import { findPathToLoc, isMapBlocked, reachedLoc } from '../Engine-TS/src/engine/GameMap.js';

export function tasksDone(bot: Bot): number {
    return bot.varp('relic_tasks_done') as number;
}

/** Tasks 32 and up live in the second varp, bit = task - 32 (relic_tasks.rs2). */
export function tasksDone2(bot: Bot): number {
    return bot.varp('relic_tasks_done2') as number;
}

export function isDone(bot: Bot, task: number): boolean {
    if (task >= 32) return ((tasksDone2(bot) >>> (task - 32)) & 1) === 1;
    return ((tasksDone(bot) >>> (task - 1)) & 1) === 1; // bit = task - 1 (relic_tasks.rs2:1)
}

export type Row = { name: string; table: string; task: number; key: string };

/** The rows of mods/relics/configs/relic_tasks.dbrow (the source the pack was built from). */
export function dbrows(): Row[] {
    const text = fs.readFileSync(new URL('../mods/relics/configs/relic_tasks.dbrow', import.meta.url), 'utf8');
    const rows: Row[] = [];
    let cur: Partial<Row> | null = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const head = /^\[(.+)\]$/.exec(line);
        if (head) {
            if (cur) rows.push(cur as Row);
            cur = { name: head[1] };
            continue;
        }
        if (!cur) continue;
        let m;
        if ((m = /^table=(.+)$/.exec(line))) cur.table = m[1];
        else if ((m = /^data=task,(\d+)$/.exec(line))) cur.task = Number(m[1]);
        else if ((m = /^data=(npc|obj),(.+)$/.exec(line))) cur.key = m[2];
    }
    if (cur) rows.push(cur as Row);
    return rows;
}

/** Nearest loc of a type around a coord, searched in the loaded map (wider than Bot.findLoc). */
export function locNear(type: string, x: number, z: number, radius: number): Loc {
    const id = ids.loc(type);
    let best: Loc | null = null;
    let bestDist = Infinity;
    for (let zx = x - radius; zx <= x + radius + 7; zx += 8) {
        for (let zz = z - radius; zz <= z + radius + 7; zz += 8) {
            for (const loc of World.gameMap.getZone(zx, zz, 0).getAllLocsUnsafe()) {
                if (loc.type !== id || !loc.isActive) continue;
                const d = Math.max(Math.abs(loc.x - x), Math.abs(loc.z - z));
                if (d <= radius && d < bestDist) {
                    best = loc;
                    bestDist = d;
                }
            }
        }
    }
    if (!best) throw new Error(`no ${type} within ${radius} of ${x},${z}`);
    return best;
}

/** A free tile near a loc from which the engine's route finder reaches it (to teleport a bot to). */
export function standNear(loc: Loc): { x: number; z: number; level: number } {
    const fa = LocType.get(loc.type).forceapproach;
    for (let r = 1; r <= 4; r++) {
        for (let dx = -r; dx <= r + loc.width - 1; dx++) {
            for (let dz = -r; dz <= r + loc.length - 1; dz++) {
                const x = loc.x + dx;
                const z = loc.z + dz;
                if (isMapBlocked(x, z, loc.level)) continue;
                const route = findPathToLoc(loc.level, x, z, loc.x, loc.z, 1, loc.width, loc.length, loc.angle, loc.shape, fa);
                const end = route.length ? CoordGrid.unpackCoord(route[route.length - 1]) : { x, z };
                if (reachedLoc(loc.level, end.x, end.z, loc.x, loc.z, loc.width, loc.length, 1, loc.angle, loc.shape, fa)) {
                    return { x, z, level: loc.level };
                }
            }
        }
    }
    throw new Error(`no free tile next to loc ${loc.type} at ${loc.x},${loc.z}`);
}


/** [proc,relic_exists] of relic_offer.rs2 evaluated in JS: false for retired (15) and still reserved ids, so tests follow the script as relics land. */
export function relicExists(id: number): boolean {
    const src = fs.readFileSync(new URL('../mods/relics/scripts/relic_offer.rs2', import.meta.url), 'utf8');
    const m = /\[proc,relic_exists\]\(int \$id\)\(int\)\s*if \((.*)\) \{\s*return\(0\);/.exec(src);
    if (!m) throw new Error('relic_exists not found in relic_offer.rs2');
    const expr = m[1].replace(/\$id = /g, 'id === ').replace(/\$id/g, 'id').replace(/\|/g, '||').replace(/&/g, '&&');
    return !new Function('id', `return (${expr});`)(id);
}

/** Relic ids that exist today (1..31 minus the hidden ones). */
export function existingRelicIds(): number[] {
    return Array.from({ length: 31 }, (_, i) => i + 1).filter(relicExists);
}

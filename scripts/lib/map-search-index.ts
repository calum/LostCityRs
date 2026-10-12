// Builds the world-map search index (docs/design/map-search.md). Pure functions; the CLI wrapper is
// scripts/build-map-search.mjs.

export type SearchKind = 'npc' | 'obj' | 'loc';
export type ConfigInfo = { name: string | null; interactive: boolean };
export type Spawn = { section: SearchKind; id: number; x: number; z: number; level: number };
export type IndexEntry = { id: string; name: string; kind: SearchKind; at: number[] };
export type SearchIndex = { v: 1; entries: IndexEntry[] };

export function parseConfigNames(text: string): Map<string, ConfigInfo> {
    const out = new Map<string, ConfigInfo>();
    let cur: ConfigInfo | null = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const header = /^\[([^\]]+)\]$/.exec(line);
        if (header) {
            cur = { name: null, interactive: false };
            out.set(header[1], cur);
        } else if (cur) {
            const eq = line.indexOf('=');
            if (eq < 0) {
                continue;
            }
            const key = line.slice(0, eq);
            const value = line.slice(eq + 1);
            if (key === 'name') {
                cur.name = value;
            } else if (/^op[1-5]$/.test(key) && value !== 'hidden') {
                cur.interactive = true;
            }
        }
    }
    return out;
}

export function parseJm2(text: string, mx: number, mz: number): Spawn[] {
    const spawns: Spawn[] = [];
    let section: SearchKind | null = null;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('====')) {
            const name = line.replace(/=/g, '').trim().toLowerCase();
            section = name === 'loc' || name === 'npc' || name === 'obj' ? name : null;
            continue;
        }
        if (!section) {
            continue;
        }
        const m = /^(\d+) (\d+) (\d+): (\d+)/.exec(line);
        if (m) {
            spawns.push({ section, id: +m[4], x: mx * 64 + +m[2], z: mz * 64 + +m[3], level: +m[1] });
        }
    }
    return spawns;
}

export function parsePack(text: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const line of text.split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq > 0) {
            out.set(+line.slice(0, eq), line.slice(eq + 1).trim());
        }
    }
    return out;
}

// Locs are kept only when their config has a visible op (walls, fences and scenery are dropped) and are
// searched by debug name (rocks all share the in-game name "Rocks"). NPCs and objects keep their display
// name as well.
export function buildIndex(
    spawns: Spawn[],
    packs: Record<SearchKind, Map<number, string>>,
    configs: Record<SearchKind, Map<string, ConfigInfo>>
): SearchIndex {
    const groups = new Map<string, IndexEntry>();
    for (const s of spawns) {
        const id = packs[s.section].get(s.id);
        if (!id) {
            continue;
        }
        const cfg = configs[s.section].get(id);
        if (s.section === 'loc' && !cfg?.interactive) {
            continue;
        }
        const key = s.section + ':' + id;
        let entry = groups.get(key);
        if (!entry) {
            entry = { id, name: s.section === 'loc' ? id : (cfg?.name ?? id), kind: s.section, at: [] };
            groups.set(key, entry);
        }
        entry.at.push(s.x, s.z, s.level);
    }
    const entries = [...groups.values()].sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1));
    return { v: 1, entries };
}

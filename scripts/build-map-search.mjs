// Writes Engine-TS/public/mapsearch.json, the index behind the search box in the world map (::map).
// Reads Content/maps/*.jm2 (spawns), Content/pack/{loc,npc,obj}.pack (ids) and the *.loc/*.npc/*.obj
// configs under Content/scripts. See docs/design/map-search.md. Run: node scripts/build-map-search.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildIndex, parseConfigNames, parseJm2, parsePack } from './lib/map-search-index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = path.join(root, 'Content');
const out = path.join(root, 'Engine-TS/public/mapsearch.json');

function walk(dir, ext, files = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, ext, files);
        else if (e.name.endsWith(ext)) files.push(p);
    }
    return files;
}

const kinds = ['loc', 'npc', 'obj'];
const packs = {};
const configs = {};
for (const k of kinds) {
    packs[k] = parsePack(fs.readFileSync(path.join(content, 'pack', `${k}.pack`), 'utf8'));
    configs[k] = new Map();
    for (const f of walk(path.join(content, 'scripts'), '.' + k)) {
        for (const [id, info] of parseConfigNames(fs.readFileSync(f, 'utf8'))) configs[k].set(id, info);
    }
}

const spawns = [];
for (const f of fs.readdirSync(path.join(content, 'maps'))) {
    const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (m) spawns.push(...parseJm2(fs.readFileSync(path.join(content, 'maps', f), 'utf8'), +m[1], +m[2]));
}

const index = buildIndex(spawns, packs, configs);
fs.writeFileSync(out, JSON.stringify(index));
const total = index.entries.reduce((n, e) => n + e.at.length / 3, 0);
console.log(`wrote ${path.relative(root, out)}: ${index.entries.length} names, ${total} spawns, ${fs.statSync(out).size} bytes`);
const generic = index.entries.filter(e => e.kind === 'loc' && /^(macro_)/.test(e.id)).length;
console.log(`(${generic} macro_ loc names included)`);

// World-map search index builder (scripts/lib/map-search-index.ts, docs/design/map-search.md).
// Pure parsing and grouping, so this test does not boot the engine.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildIndex, parseConfigNames, parseJm2, parsePack } from '../scripts/lib/map-search-index.ts';

test('parseConfigNames reads name and whether any op is visible', () => {
    const cfg = parseConfigNames(
        ['[mithrilrock2]', 'name=Rocks', 'op1=Mine', 'op2=Prospect', 'op3=hidden', '', '[mithrilrock_empty]', 'name=Rocks', '', '[wall]', 'op1=hidden', '', '[banker]', 'name=Banker'].join('\n')
    );
    assert.deepEqual(cfg.get('mithrilrock2'), { name: 'Rocks', interactive: true });
    assert.deepEqual(cfg.get('mithrilrock_empty'), { name: 'Rocks', interactive: false });
    assert.equal(cfg.get('wall')?.interactive, false);
    assert.deepEqual(cfg.get('banker'), { name: 'Banker', interactive: false });
});

test('parsePack maps ids to debug names', () => {
    const pack = parsePack('0=mcannoncrate\n2102=mithrilrock1\n\n');
    assert.equal(pack.get(2102), 'mithrilrock1');
    assert.equal(pack.size, 2);
});

test('parseJm2 turns section lines into absolute tiles', () => {
    const text = ['==== MAP ====', '0 0 0: u48', '', '==== LOC ====', '0 5 6: 2102 10 1', '', '==== NPC ====', '1 63 0: 117', '', '==== OBJ ====', '0 2 3: 882 1'].join('\n');
    const spawns = parseJm2(text, 50, 52);
    assert.deepEqual(spawns, [
        { section: 'loc', id: 2102, x: 50 * 64 + 5, z: 52 * 64 + 6, level: 0 },
        { section: 'npc', id: 117, x: 50 * 64 + 63, z: 52 * 64, level: 1 },
        { section: 'obj', id: 882, x: 50 * 64 + 2, z: 52 * 64 + 3, level: 0 }
    ]);
});

const packs = {
    loc: new Map([
        [2102, 'mithrilrock1'],
        [2103, 'mithrilrock2'],
        [9, 'fence']
    ]),
    npc: new Map([[117, 'giant']]),
    obj: new Map([[882, 'knife']])
};
const configs = {
    loc: new Map([
        ['mithrilrock1', { name: 'Rocks', interactive: true }],
        ['mithrilrock2', { name: 'Rocks', interactive: true }],
        ['fence', { name: 'Fence', interactive: false }]
    ]),
    npc: new Map([['giant', { name: 'Giant', interactive: true }]]),
    obj: new Map([['knife', { name: 'Knife', interactive: false }]])
};

test('buildIndex groups spawns by type, keeps only interactive locs and packs coordinates', () => {
    const idx = buildIndex(
        [
            { section: 'loc', id: 2102, x: 3000, z: 3100, level: 0 },
            { section: 'loc', id: 2102, x: 3001, z: 3100, level: 0 },
            { section: 'loc', id: 2103, x: 3002, z: 3100, level: 1 },
            { section: 'loc', id: 9, x: 3003, z: 3100, level: 0 },
            { section: 'npc', id: 117, x: 3200, z: 3300, level: 0 },
            { section: 'obj', id: 882, x: 3210, z: 3310, level: 0 }
        ],
        packs,
        configs
    );
    assert.equal(idx.v, 1);
    const byId = Object.fromEntries(idx.entries.map(e => [e.kind + ':' + e.id, e]));
    assert.deepEqual(Object.keys(byId).sort(), ['loc:mithrilrock1', 'loc:mithrilrock2', 'npc:giant', 'obj:knife']);
    assert.deepEqual(byId['loc:mithrilrock1'].at, [3000, 3100, 0, 3001, 3100, 0]);
    assert.deepEqual(byId['loc:mithrilrock2'].at, [3002, 3100, 1]);
    // locs are found by their debug name; npcs and objs also carry their display name
    assert.equal(byId['loc:mithrilrock1'].name, 'mithrilrock1');
    assert.equal(byId['npc:giant'].name, 'Giant');
    assert.equal(byId['obj:knife'].name, 'Knife');
});

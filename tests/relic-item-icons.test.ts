// Relic items must not reuse rune (or rune talisman) models for their inventory icon: in a magic run they read as
// real runes. Icons are item models from the cache (ObjType.model) plus optional recolours; no new model files needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ids } from '../harness/src/index.js';
import { useVanillaWorld } from './helpers.js';

import ObjType from '../Engine-TS/src/cache/config/ObjType.js';
import Environment from '../Engine-TS/src/util/Environment.js';
import { ModelPack } from '../Engine-TS/tools/pack/PackFile.js';

useVanillaWorld();

// The test process does not load the pack files itself; model names to ids come from the packed model.pack.
ModelPack.load(`${Environment.build.srcDir}/pack/model.pack`);

const modelId = (obj: string) => ObjType.get(ids.obj(obj)).model;

test('relic stones and talisman use non-rune icon models', () => {
    assert.equal(modelId('relic_recall_stone'), ModelPack.getByName('inv_glowingorb'));
    assert.equal(modelId('relic_banker_stone'), ModelPack.getByName('inv_casket'));
    assert.equal(modelId('relic_network_stone'), ModelPack.getByName('inv_map_scroll'));
    assert.equal(modelId('relic_wellspring_talisman'), ModelPack.getByName('inv_talisman'));
});

test('no relic item uses a rune or rune talisman model', () => {
    for (const obj of ['relic_recall_stone', 'relic_banker_stone', 'relic_network_stone', 'relic_wellspring_talisman']) {
        const m = ModelPack.getById(modelId(obj));
        assert.ok(!/rune$/.test(m) && !m.startsWith('inv_runetalisman_'), `${obj} uses ${m}`);
    }
});

test('recoloured icons carry recolours; the rune essence bundle keeps its model', () => {
    for (const obj of ['relic_recall_stone', 'relic_network_stone', 'relic_wellspring_talisman']) {
        assert.ok(ObjType.get(ids.obj(obj)).recol_s?.length, `${obj} has no recolour`);
    }
    assert.equal(modelId('relic_essence_bundle'), ModelPack.getByName('inv_blankrune'));
});

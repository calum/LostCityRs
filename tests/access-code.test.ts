// Shared access code for a public server: Engine-TS/src/util/AccessCode.ts, used by the login handler in
// World.onClientData. world.json: node.accessCode ('' = off). The player types the code as the password.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accessCodeAllows } from '../Engine-TS/src/util/AccessCode.js';
import { createDefaultWorldConfig, normalizeWorldConfig } from '../Engine-TS/src/util/WorldConfig.js';

test('no code configured: any password is allowed (upstream behaviour)', () => {
    assert.equal(accessCodeAllows('', 'anything'), true);
});

test('code configured: only the exact code is allowed', () => {
    assert.equal(accessCodeAllows('friends2026', 'friends2026'), true);
    assert.equal(accessCodeAllows('friends2026', 'friends2027'), false);
    assert.equal(accessCodeAllows('friends2026', 'friends202'), false);
    assert.equal(accessCodeAllows('friends2026', ''), false);
    assert.equal(accessCodeAllows('friends2026', 'FRIENDS2026'), false);
});

test('world.json node.accessCode defaults to off and is read from the file', () => {
    assert.equal(createDefaultWorldConfig().node.accessCode, '');
    assert.equal(normalizeWorldConfig({ node: { accessCode: 'abc' } }).node.accessCode, 'abc');
});

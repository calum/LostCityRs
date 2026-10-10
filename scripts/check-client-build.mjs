// Warns when the engine is about to serve its own prebuilt (upstream) client
// instead of the Client-TS build, which is what happens if you start the
// server without `mise run client:build` first. The upstream copy has no
// scroll zoom, middle-mouse camera or ::radius. Usage (from anywhere):
//   node scripts/check-client-build.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const served = path.join(root, 'Engine-TS/public/client/client.js');

// '::radius ' is a string literal only our Client-TS build contains (Client-TS/src/client/Client.ts, the ::radius command)
const marker = '::radius ';

if (!fs.existsSync(served)) {
    console.log(`[client] ${served} is missing. Run: mise run client:build`);
} else if (!fs.readFileSync(served, 'utf8').includes(marker)) {
    console.log('[client] WARNING: the server will serve the engine\'s prebuilt upstream client, not the Client-TS build.');
    console.log('[client]   Scroll zoom, middle-mouse camera and ::radius will not work. Run: mise run client:build (then restart).');
}

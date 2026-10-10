// Copies the Client-TS build output over the engine's prebuilt client, so the
// web server (Engine-TS/src/web.ts) serves the freshly built files. This is a
// script rather than an inline `node -e` in mise.toml because mise on Windows
// mangles the quoting of inline commands (observed).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolved from this script's location, since mise runs it inside Client-TS/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'Client-TS/out');
const to = path.join(root, 'Engine-TS/public/client');

for (const file of ['client.js', 'mapview.js', 'ondemandworker.js', 'tinymidipcm.wasm']) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
    console.log(`copied ${file}`);
}

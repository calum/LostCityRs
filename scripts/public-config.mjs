// Writes Engine-TS/data/config/world.json for a public server: config/world.json (relic settings)
// plus node.production=true (no dev commands), node.debug=false (no map editor) and the access code
// from the ACCESS_CODE environment variable (1-20 characters: players type it as their password).
// Usage: ACCESS_CODE=yourcode node scripts/public-config.mjs   (restart the server after)
import fs from 'node:fs';

const code = process.env.ACCESS_CODE ?? '';
if (code.length < 1 || code.length > 20) {
    console.error('Set ACCESS_CODE to 1-20 characters (the login password field is limited to 20), e.g. ACCESS_CODE=dragon-7391 mise run public:config');
    process.exit(1);
}

const base = JSON.parse(fs.readFileSync('config/world.json', 'utf8'));
base.node = { ...base.node, production: true, debug: false, accessCode: code };
fs.mkdirSync('Engine-TS/data/config', { recursive: true });
fs.writeFileSync('Engine-TS/data/config/world.json', JSON.stringify(base, null, 4) + '\n');
console.log('wrote Engine-TS/data/config/world.json (production on, debug off, access code set). Restart the server.');

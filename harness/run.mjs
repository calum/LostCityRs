#!/usr/bin/env node
// Runs the headless test suite: sync mods/, pack the cache if anything changed, then run the
// tests with node's built-in test runner. Each test file gets its own process and its own World.
//
//   node harness/run.mjs                      all tests in tests/
//   node harness/run.mjs tests/relics.test.ts one file
//   node harness/run.mjs --grep Hans          only tests whose name matches
//   node harness/run.mjs --no-build           skip mods sync and pack (cache must be current)
//   node harness/run.mjs --verbose            print engine output while tests run
//   node harness/run.mjs --jobs 2             test files run in parallel (default 2)
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'Engine-TS');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 24) {
    console.error(`Node ${process.versions.node}: the engine needs Node 24+ (Engine-TS/package.json engines). Use "mise run test".`);
    process.exit(1);
}

const args = process.argv.slice(2);
let build = true;
let verbose = false;
let jobs = 2;
const passthrough = [];
const files = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-build') build = false;
    else if (a === '--verbose') verbose = true;
    else if (a === '--grep') passthrough.push('--test-name-pattern', args[++i]);
    else if (a === '--jobs') jobs = parseInt(args[++i], 10);
    else if (a.startsWith('--')) passthrough.push(a);
    else files.push(path.resolve(a));
}

function run(cmd, cmdArgs, cwd, env = process.env) {
    const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env });
    return r.status ?? 1;
}

if (!fs.existsSync(path.join(engine, 'node_modules'))) {
    console.error('Engine-TS/node_modules is missing: run "mise run setup" first.');
    process.exit(1);
}

if (build) {
    if (run(process.execPath, ['scripts/link-content.mjs'], root) !== 0) process.exit(1);
    if (run(process.execPath, ['scripts/sync-mods.mjs'], root) !== 0) process.exit(1);
    console.log('[harness] packing (only what changed)...');
    if (run(process.execPath, ['--import', 'tsx', 'tools/pack/Build.ts'], engine) !== 0) {
        console.error('[harness] pack failed: fix the script/config error above.');
        process.exit(1);
    }
}

if (files.length === 0) {
    const dir = path.join(root, 'tests');
    for (const f of fs.readdirSync(dir).sort()) {
        if (f.endsWith('.test.ts')) files.push(path.join(dir, f));
    }
}

const env = { ...process.env };
if (verbose) env.HARNESS_VERBOSE = '1';

const status = run(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${jobs}`, ...passthrough, ...files], engine, env);
process.exit(status);

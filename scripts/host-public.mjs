// One command to host the server for friends over a public https link (docs/setup/hosting-for-friends.md).
//   mise run host
// 1. asks for the access code (or reads ACCESS_CODE) and writes world.json (scripts/public-config.mjs),
// 2. starts the server (`mise run start`) and waits until the web port answers,
// 3. opens a Cloudflare tunnel to that one port and prints the https link to share.
// Only the web port is tunnelled: it carries the page, the WebSocket and ::map. The game TCP port (43594)
// and the management port (8898) are never exposed.
// Default is a free "quick tunnel": no Cloudflare account or login, but a new random link every run.
// Set CF_TUNNEL_HOSTNAME=game.example.com for a stable link on a domain in your Cloudflare account: the
// script then runs `cloudflared tunnel login` if you have not logged in yet (opens a browser).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const PORT = 8888; // public-config.mjs writes the same value into world.json
const CF = process.env.CLOUDFLARED ?? 'cloudflared';
const hostname = process.env.CF_TUNNEL_HOSTNAME ?? '';
const win = process.platform === 'win32';

if (spawnSync(CF, ['--version'], { shell: win, stdio: 'ignore' }).status !== 0) {
    console.error('cloudflared is not installed or not on PATH. Install it, then run again:');
    console.error('  Windows: winget install Cloudflare.cloudflared    macOS: brew install cloudflared');
    console.error('  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    process.exit(1);
}

let code = process.env.ACCESS_CODE ?? '';
if (!code) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    code = (await rl.question('Access code for your friends (1-20 characters, they type it as the password): ')).trim();
    rl.close();
}
if (code.length < 1 || code.length > 20) {
    console.error('The code must be 1-20 characters.');
    process.exit(1);
}

const cfg = spawnSync(process.execPath, ['scripts/public-config.mjs'], { env: { ...process.env, ACCESS_CODE: code }, stdio: 'inherit' });
if (cfg.status !== 0) process.exit(cfg.status ?? 1);

const children = [];
let stopping = false;
function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping the tunnel and the server (the server saves players first, wait a few seconds)...');
    for (const c of children) {
        try {
            if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T'], { stdio: 'ignore' });
            else c.kill('SIGINT');
        } catch {}
    }
    setTimeout(() => process.exit(exitCode), 8000).unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('Starting the server (the first start repacks the cache and can take a few minutes)...');
const server = spawn('mise', ['run', 'start'], { stdio: 'inherit', shell: win });
children.push(server);
server.on('exit', c => {
    if (!stopping) {
        console.error(`The server exited (code ${c}). Stopping.`);
        stop(1);
    }
});

const url = `http://localhost:${PORT}/rs2.cgi`;
for (let i = 0; ; i++) {
    if (stopping) await new Promise(() => {});
    try {
        if ((await fetch(url)).ok) break;
    } catch {}
    if (i > 600) {
        console.error('The server did not answer within 10 minutes.');
        stop(1);
    }
    await new Promise(r => setTimeout(r, 1000));
}
console.log(`Server is up at ${url}`);

function show(link) {
    console.log('\n==============================================================');
    console.log(` Share this link: ${link}`);
    console.log(` Access code (type it in the Password box): ${code}`);
    console.log(' Keep this window open. Ctrl+C stops everything.');
    console.log('==============================================================\n');
}

if (!hostname) {
    const tunnel = spawn(CF, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { shell: win });
    children.push(tunnel);
    let shown = false;
    const onData = buf => {
        const text = buf.toString();
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && !shown) {
            shown = true;
            show(m[0]);
        } else if (/ERR|error|failed/i.test(text)) {
            process.stderr.write('[cloudflared] ' + text);
        }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', c => {
        if (!stopping) {
            console.error(`cloudflared exited (code ${c}). Stopping.`);
            stop(1);
        }
    });
} else {
    // Named tunnel on your own domain (not run in testing: needs a Cloudflare account and domain).
    const run = (args, opts = {}) => spawnSync(CF, args, { shell: win, encoding: 'utf8', ...opts });
    if (!fs.existsSync(path.join(os.homedir(), '.cloudflared', 'cert.pem'))) {
        console.log('Not logged in to Cloudflare yet: a browser window opens, pick the domain, then come back here.');
        if (run(['tunnel', 'login'], { stdio: 'inherit', encoding: undefined }).status !== 0) {
            console.error('cloudflared login failed.');
            stop(1);
        }
    }
    const name = 'lostcity-relics';
    const list = run(['tunnel', 'list', '--output', 'json']);
    let exists = false;
    try {
        exists = JSON.parse(list.stdout || '[]').some(t => t.name === name);
    } catch {}
    if (!exists && run(['tunnel', 'create', name], { stdio: 'inherit', encoding: undefined }).status !== 0) {
        console.error('Could not create the tunnel.');
        stop(1);
    }
    if (run(['tunnel', 'route', 'dns', '--overwrite-dns', name, hostname], { stdio: 'inherit', encoding: undefined }).status !== 0) {
        console.error(`Could not point ${hostname} at the tunnel (is the domain in your Cloudflare account?).`);
        stop(1);
    }
    const tunnel = spawn(CF, ['tunnel', '--no-autoupdate', 'run', '--url', `http://localhost:${PORT}`, name], { stdio: 'inherit', shell: win });
    children.push(tunnel);
    tunnel.on('exit', c => {
        if (!stopping) {
            console.error(`cloudflared exited (code ${c}). Stopping.`);
            stop(1);
        }
    });
    show(`https://${hostname}`);
}

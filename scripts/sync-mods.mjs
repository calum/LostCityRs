// Mirror mods/ (this repo) into Content/scripts/_mods/ so your own RuneScript,
// configs and interfaces live in the root repo instead of the Content submodule.
// The engine's live-reload watcher (Engine-TS/src/cache/DevThread.ts) watches
// Content/scripts, so a copy there triggers a repack and script reload.
// Why copy and not symlink: RuneScriptTS's file walk only recurses into real
// directories (RuneScriptTS/src/compiler/ScriptCompiler.ts walkTopDown uses
// Dirent.isDirectory(), false for symlinks), so a linked folder would be skipped.
//
// Usage: node scripts/sync-mods.mjs [--watch]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const SRC = 'mods';
const DEST = 'Content/scripts/_mods';

function walk(dir, base = dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full, base));
        else if (!e.name.endsWith('.md')) out.push(path.relative(base, full));
    }
    return out;
}

// Keep the copy out of the Content submodule's git status (local-only, never pushed).
function excludeFromContentGit() {
    try {
        const file = execFileSync('git', ['-C', 'Content', 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
        const p = path.resolve('Content', file);
        const line = 'scripts/_mods/';
        const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
        if (!cur.split(/\r?\n/).includes(line)) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.appendFileSync(p, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
        }
    } catch {
        // Content is not a git checkout; nothing to exclude.
    }
}

// Write only files whose bytes changed, so unchanged files do not retrigger the engine's watcher.
function sync() {
    if (!fs.existsSync(SRC)) return;
    fs.mkdirSync(DEST, { recursive: true });
    const want = new Set(walk(SRC));
    let changed = 0;
    for (const rel of want) {
        const from = path.join(SRC, rel);
        const to = path.join(DEST, rel);
        const data = fs.readFileSync(from);
        if (!fs.existsSync(to) || !fs.readFileSync(to).equals(data)) {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.writeFileSync(to, data);
            changed++;
        }
    }
    for (const rel of walk(DEST)) {
        if (!want.has(rel)) {
            fs.rmSync(path.join(DEST, rel));
            changed++;
        }
    }
    if (changed) console.log(`[mods] synced ${changed} file(s) -> ${DEST}`);
}

// Config names need an id in Content/pack/<type>.pack (observed: the pack step fails with
// "Missing varp pack IDs for" otherwise, Engine-TS/tools/pack/PackFile.ts:164-173). Append any
// missing `[name]` from mods/**/configs/*.<ext> with the next free id. This edits the Content
// submodule's tracked pack files: commit the result on Content's relic-mode branch.
const PACK_EXTS = ['varp', 'varbit', 'varn', 'vars', 'inv', 'obj', 'npc', 'loc', 'param', 'dbtable', 'dbrow', 'enum', 'struct', 'seq', 'spotanim', 'category', 'hunt', 'mesanim', 'idk'];
function ensurePackIds() {
    if (!fs.existsSync(SRC)) return;
    const names = {};
    for (const rel of walk(SRC)) {
        const ext = path.extname(rel).slice(1);
        if (!PACK_EXTS.includes(ext) || !rel.includes('configs')) continue;
        for (const m of fs.readFileSync(path.join(SRC, rel), 'utf8').matchAll(/^\[([^\]]+)\]/gm)) (names[ext] ??= []).push(m[1]);
    }
    for (const [ext, list] of Object.entries(names)) {
        const file = path.join('Content', 'pack', `${ext}.pack`);
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        const have = new Set();
        let max = -1;
        for (const line of text.split(/\r?\n/)) {
            const [id, name] = line.split('=');
            if (name === undefined) continue;
            have.add(name);
            max = Math.max(max, Number(id));
        }
        const add = list.filter((n) => !have.has(n));
        if (!add.length) continue;
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const lines = add.map((n) => `${++max}=${n}`);
        fs.appendFileSync(file, (text.endsWith('\n') ? '' : eol) + lines.join(eol) + eol);
        console.log(`[mods] ${file}: added ${lines.join(', ')}`);
    }
}

excludeFromContentGit();
ensurePackIds();
sync();

if (process.argv.includes('--watch')) {
    console.log(`[mods] watching ${SRC}/ (ctrl+c to stop)`);
    let t;
    fs.watch(SRC, { recursive: true }, () => {
        clearTimeout(t);
        t = setTimeout(() => { ensurePackIds(); sync(); }, 300);
    });
}

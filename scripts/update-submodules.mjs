// Brings the checked-out submodules up to the commits this repo records (what a plain `git pull` in the
// root does NOT do). Used by `mise run up` (mise.toml) before installing and building. Usage:
//   node scripts/update-submodules.mjs [Engine-TS Content Client-TS ...]
// Safe by design: it only moves a submodule that is strictly BEHIND the recorded commit (the stale case
// scripts/check-submodules.mjs stops on). A submodule that is ahead, diverged or on another branch is
// local work and is left alone with a warning. It never pulls the root repo, never uses --remote (so it
// never moves to commits you have not recorded) and never pushes. `git fetch` runs against the
// submodule's own origin (your fork) only when the recorded commit is not present locally.
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['Engine-TS', 'Content', 'Client-TS'];

const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ok = (args, cwd) => {
    try {
        execFileSync('git', args, { cwd, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};
const short = (sha) => sha.slice(0, 7);

let failed = false;
for (const name of names) {
    const dir = path.join(root, name);
    const recorded = git(['ls-tree', 'HEAD', name]).split(/\s+/)[2];
    if (!recorded) {
        console.log(`[submodules] ${name}: not recorded in this repo, skipping.`);
        continue;
    }

    let current = null;
    try {
        current = git(['rev-parse', 'HEAD'], dir);
    } catch {
        // folder missing or empty: first clone
    }

    const update = () => {
        try {
            execFileSync('git', ['submodule', 'update', '--init', name], { cwd: root, stdio: 'inherit' });
            console.log(`[submodules] ${name}: now at ${short(recorded)}.`);
        } catch {
            console.log(`[submodules] ${name}: git submodule update failed (see above). Local changes to files the new commit also changes block it; fix or stash them and re-run.`);
            failed = true;
        }
    };

    if (current === null) {
        update();
        continue;
    }
    if (current === recorded) {
        console.log(`[submodules] ${name}: up to date (${short(current)}).`);
        continue;
    }

    // The recorded commit may not exist locally yet (after a root pull): fetch from the fork, read-only.
    if (!ok(['cat-file', '-e', `${recorded}^{commit}`], dir)) {
        console.log(`[submodules] ${name}: fetching ${short(recorded)} from origin...`);
        if (!ok(['fetch', 'origin'], dir) || !ok(['cat-file', '-e', `${recorded}^{commit}`], dir)) {
            console.log(`[submodules] ${name}: ${short(recorded)} is not on origin. Push it from the machine that recorded it.`);
            failed = true;
            continue;
        }
    }

    if (ok(['merge-base', '--is-ancestor', current, recorded], dir)) {
        update();
    } else {
        console.log(`[submodules] warning: ${name} is at ${short(current)}, this repo records ${short(recorded)}; local commits or another branch, left alone.`);
    }
}

process.exit(failed ? 1 : 0);

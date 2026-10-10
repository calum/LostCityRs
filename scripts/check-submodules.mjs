// Checks that the checked-out submodules match the commits this repo records.
// `git pull` in the root repo updates the recorded commits but not the
// submodule folders, so a build after a plain pull silently uses old code
// (seen with the Client-TS camera controls). Usage:
//   node scripts/check-submodules.mjs [Client-TS Engine-TS ...]
// Exits 1 when a submodule is behind the recorded commit (the stale case),
// and only warns when it is ahead or on a different branch (local work).
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['Engine-TS', 'Content', 'Client-TS'];

const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let stale = false;
for (const name of names) {
    let recorded;
    let current;
    try {
        recorded = git(['ls-tree', 'HEAD', name]).split(/\s+/)[2];
        current = git(['rev-parse', 'HEAD'], path.join(root, name));
    } catch {
        console.log(`[submodules] ${name}: not checked out. Run: git submodule update --init ${name}`);
        stale = true;
        continue;
    }

    if (!recorded || recorded === current) {
        continue;
    }

    let behind = false;
    try {
        // current is an ancestor of recorded: the folder is simply out of date
        execFileSync('git', ['merge-base', '--is-ancestor', current, recorded], { cwd: path.join(root, name), stdio: 'ignore' });
        behind = true;
    } catch {
        behind = false;
    }

    const short = (sha) => sha.slice(0, 7);
    if (behind) {
        console.log(`[submodules] ${name} is out of date: checked out ${short(current)}, this repo records ${short(recorded)}.`);
        console.log(`[submodules]   Run: git submodule update --init ${name}   (then build again)`);
        stale = true;
    } else {
        console.log(`[submodules] warning: ${name} is at ${short(current)}, this repo records ${short(recorded)} (local commits or another branch). Building what is checked out.`);
    }
}

process.exit(stale ? 1 : 0);

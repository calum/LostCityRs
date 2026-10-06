#!/usr/bin/env python3
"""Check citations in docs notes against the submodule sources. See docs/tick/_template.md."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPOS = ("Engine-TS", "Content", "Client-TS", "RuneScriptTS")
CITE = re.compile(r"`((?:%s)/[^`:\s]+):(\d+)(?:-(\d+))?`" % "|".join(REPOS))
COMMIT = re.compile(r"^- (%s): `([0-9a-f]{7,40})`" % "|".join(REPOS))
SKIP = {"...", "// ..."}


def head(repo):
    return subprocess.check_output(["git", "-C", str(ROOT / repo), "rev-parse", "HEAD"], text=True).strip()


def check(note):
    errors = []
    lines = note.read_text(encoding="utf-8").splitlines()
    cache = {}

    def src(rel):
        if rel not in cache:
            p = ROOT / rel
            cache[rel] = p.read_text(encoding="utf-8", errors="replace").splitlines() if p.is_file() else None
        return cache[rel]

    for i, line in enumerate(lines):
        m = COMMIT.match(line)
        if m and not head(m.group(1)).startswith(m.group(2)):
            errors.append(f"{note}:{i+1}: {m.group(1)} recorded {m.group(2)} but HEAD is {head(m.group(1))[:8]}")
        cites = list(CITE.finditer(line))
        for c in cites:
            rel, a = c.group(1), int(c.group(2))
            b = int(c.group(3)) if c.group(3) else a
            code = src(rel)
            if code is None:
                errors.append(f"{note}:{i+1}: no such file {rel}")
                continue
            if a < 1 or b < a or b > len(code):
                errors.append(f"{note}:{i+1}: {rel}:{a}-{b} outside file length {len(code)}")
        # a citation followed directly by a code fence: snippet must be in the cited range
        if cites and i + 1 < len(lines) and lines[i + 1].strip().startswith("```"):
            snippet = []
            j = i + 2
            while j < len(lines) and not lines[j].strip().startswith("```"):
                s = lines[j].strip()
                if s and s not in SKIP:
                    snippet.append(s)
                j += 1
            c = cites[-1]
            rel, a = c.group(1), int(c.group(2))
            b = int(c.group(3)) if c.group(3) else a
            code = src(rel)
            if code is None:
                continue
            window = [x.strip() for x in code[a - 1 : max(b, a + len(snippet) + 2)]]
            for s in snippet:
                if not any(s in w for w in window):
                    errors.append(f"{note}:{i+1}: snippet line not found in {rel}:{a}-{b}: {s!r}")
    return errors


if __name__ == "__main__":
    failures = []
    for arg in sys.argv[1:]:
        failures += check(Path(arg))
    for f in failures:
        print(f)
    print("OK" if not failures else f"{len(failures)} problem(s)")
    sys.exit(1 if failures else 0)

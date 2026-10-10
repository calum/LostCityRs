#!/usr/bin/env python3
"""List where an NPC spawns, from the map files, with absolute coordinates and map links.

Usage: python3 docs/tools/npc_spawns.py goblin giant king_dragon [--top N] [--md]
A task with several NPC types can be given as one argument joined with +: goblin+goblin_armed.
--md prints one Markdown table cell per argument (the form used in the relic guide).
Reads Content/pack/npc.pack (id=debugname), Content/maps/m<MX>_<MZ>.jm2 (`==== NPC ====` lines
`level localX localZ: npcId`) and Content/maps/labels.txt (place names). Read-only. See
docs/reference/finding-npc-locations.md for the method and its limits.
"""
import collections, glob, math, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Content")
EXPLV = "https://explv.github.io/?centreX={x}&centreY={y}&centreZ={p}&zoom=9"


def load_ids(names):
    ids = {}
    for line in open(os.path.join(ROOT, "pack", "npc.pack")):
        m = re.match(r"(\d+)=(\S+)$", line.strip())
        if m and m[2] in names:
            ids[int(m[1])] = m[2]
    return ids


def load_labels():
    out = []
    for line in open(os.path.join(ROOT, "maps", "labels.txt")):
        m = re.match(r"=([^,]+),(\d+),(\d+),", line)
        if m:
            out.append((m[1].replace("/", " "), int(m[2]), int(m[3])))
    return out


def spawns(ids):
    """{name: {(mapsquare, level): [(x, z), ...]}} with absolute tile coordinates."""
    res = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in sorted(glob.glob(os.path.join(ROOT, "maps", "m*_*.jm2"))):
        m = re.match(r"m(\d+)_(\d+)\.jm2$", os.path.basename(f))
        mx, mz = int(m[1]), int(m[2])
        section = None
        for line in open(f):
            if line.startswith("===="):
                section = line.strip()
            elif section == "==== NPC ====":
                s = re.match(r"(\d+) (\d+) (\d+): (\d+)", line)
                if s and int(s[4]) in ids:
                    res[ids[int(s[4])]][((mx, mz), int(s[1]))].append((mx * 64 + int(s[2]), mz * 64 + int(s[3])))
    return res


def main():
    md = "--md" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 4
    if "--top" in sys.argv:
        args.remove(sys.argv[sys.argv.index("--top") + 1])
    ids, labels = load_ids({n for a in args for n in a.split("+")}), load_labels()
    res = spawns(ids)
    for name in args:
        merged = collections.defaultdict(list)
        for part in name.split("+"):
            for key, tiles in res.get(part, {}).items():
                merged[key] += tiles
        # surface squares first (easier to reach), then underground, each by spawn count
        groups = sorted(merged.items(), key=lambda kv: (sum(t[1] for t in kv[1]) / len(kv[1]) >= 6400, -len(kv[1])))[:top]
        if md:
            cells = []
            for (sq, level), tiles in groups:
                cx = round(sum(t[0] for t in tiles) / len(tiles))
                cz = round(sum(t[1] for t in tiles) / len(tiles))
                under = cz >= 6400
                sz = cz - 6400 if under else cz
                lab = min(labels, key=lambda a: (a[1] - cx) ** 2 + (a[2] - sz) ** 2)
                near = math.hypot(lab[1] - cx, lab[2] - sz) <= 60
                text = f"{lab[0]} " if near else ""
                text += f"({cx}, {cz})"
                if under:
                    cells.append(f"[underground {text}]({EXPLV.format(x=cx, y=cz, p=level)}) ([surface above]({EXPLV.format(x=cx, y=sz, p=0)}))")
                else:
                    cells.append(f"[{text}]({EXPLV.format(x=cx, y=cz, p=level)})")
            print(f"{name}\t" + "; ".join(cells) if cells else f"{name}\t(no spawn in the map files)")
            continue
        print(f"## {name}")
        for (sq, level), tiles in groups:
            cx = round(sum(t[0] for t in tiles) / len(tiles))
            cz = round(sum(t[1] for t in tiles) / len(tiles))
            under = cz >= 6400
            sz = cz - 6400 if under else cz  # surface tile above an underground one
            lab = min(labels, key=lambda a: (a[1] - cx) ** 2 + (a[2] - sz) ** 2)
            d = int(math.hypot(lab[1] - cx, lab[2] - sz))
            print(f"- {len(tiles)} spawn(s), m{sq[0]}_{sq[1]}, level {level}: tile ({cx}, {cz})"
                  f"{' underground' if under else ''}; nearest label {lab[0]} ({d} tiles from the surface point {cx},{sz})")
            print("  " + EXPLV.format(x=cx, y=cz, p=level))
            if under:
                print("  surface above: " + EXPLV.format(x=cx, y=sz, p=0))


main()

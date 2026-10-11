#!/usr/bin/env python3
"""Builds the standalone relic mode page, styled after the OSRS Wiki (dark by default, tan in light mode).

Source of truth is docs/guide/relic-mode-player-guide.md: the relic and task
tables, the rules and the menu notes are parsed from it, so the page cannot
drift from the guide. Only the styling, layout and tracker script live here.

Usage: python3 docs/tools/relic-wiki/build_relic_wiki.py [OUT_DIR]
OUT_DIR defaults to site/relics (the MkDocs output; run after `mkdocs build`).
Needs the `markdown` package (installed with MkDocs).
"""
import html
import re
import sys
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GUIDE = ROOT / "docs/guide/relic-mode-player-guide.md"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site/relics"
TRACKER_KEY = "lostcityrs-relic-tracker-v1"  # same key as the MkDocs guide, so ticks are shared


def md(text):
    return markdown.markdown(text, extensions=["tables", "admonition", "attr_list"])


def sections(text):
    """Split the guide into {heading: body} at '## ' lines (anchors like { #x } stripped)."""
    parts = re.split(r"^## (.+)$", text, flags=re.M)
    out = {"": parts[0]}
    for i in range(1, len(parts), 2):
        out[re.sub(r"\s*\{.*?\}\s*$", "", parts[i]).strip()] = parts[i + 1]
    return out


def table_rows(md_text):
    """Return (rows, rest) where rows are lists of rendered-HTML cells and rest is md without the table."""
    lines = md_text.splitlines()
    idx = [i for i, l in enumerate(lines) if l.startswith("|")]
    if not idx:
        return [], md_text
    tbl = "\n".join(lines[idx[0]:idx[-1] + 1])
    rest = "\n".join(lines[:idx[0]] + ["@@TABLE@@"] + lines[idx[-1] + 1:])
    h = md(tbl)
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", h, flags=re.S):
        cells = re.findall(r"<td>(.*?)</td>", tr, flags=re.S)
        if cells:
            rows.append(cells)
    return rows, rest


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def relic_cards(rows):
    out = []
    for num, name, what, how in rows:
        tag = "" if strip(how) == "automatic" else f'<p class="how"><b>How:</b> {how}</p>'
        out.append(
            f'<article class="card" data-kind="relics" data-id="{html.escape(strip(num))}" '
            f'data-text="{html.escape((strip(name) + " " + strip(what)).lower())}">'
            f'<label class="tick"><input type="checkbox" aria-label="Have {html.escape(strip(name))}"><span></span></label>'
            f'<h3>{name}</h3><p>{what}</p>{tag}<span class="num">#{html.escape(strip(num))}</span></article>'
        )
    return "\n".join(out)


def task_rows(rows):
    out = []
    for num, task, req, where in rows:
        out.append(
            f'<tr data-kind="tasks" data-id="{html.escape(strip(num))}" '
            f'data-text="{html.escape((strip(task) + " " + strip(req) + " " + strip(where)).lower())}">'
            f'<td class="tickcell"><label class="tick"><input type="checkbox" aria-label="Done task {html.escape(strip(num))}"><span></span></label></td>'
            f'<td class="num">{html.escape(strip(num))}</td><td class="tname">{task}</td><td>{req}</td><td>{where}</td></tr>'
        )
    return "\n".join(out)


def build():
    text = re.sub(r'^!!! tip "Prefer.*?\n(?:    .*\n|\n)+', "", GUIDE.read_text(encoding="utf-8"), count=1, flags=re.M)  # link to this page
    secs = sections(text)
    intro_paras = secs[""].split("\n\n")
    intro = md("\n\n".join(intro_paras[1:]))  # drop the '# title' line

    run = md(secs["The run in one minute"])
    menus = md(secs["In-game menus"])

    relic_md = secs["Relics"]
    relic_main, die = relic_md.split("### If you die")
    rrows, rest = table_rows(relic_main)
    rest = rest.replace('<div class="relic-tracker-bar" data-for="relics"></div>', "")
    after = md(rest.split("@@TABLE@@")[1])
    cards = relic_cards(rrows)
    die_html = md(die.strip())

    task_md = secs["Tasks"].replace('<div class="relic-tracker-bar" data-for="tasks"></div>', "")
    trows, trest = table_rows(task_md)
    task_before, task_after = trest.split("@@TABLE@@")
    tasks_html = task_rows(trows)

    page = (HERE / "template.html").read_text(encoding="utf-8")
    subs = {
        "INTRO": intro, "RUN": run, "MENUS": menus, "RELIC_CARDS": cards, "RELIC_AFTER": after,
        "DIE": die_html, "TASK_BEFORE": md(task_before), "TASK_ROWS": tasks_html, "TASK_AFTER": md(task_after),
        "NRELICS": str(len(rrows)), "NTASKS": str(len(trows)), "TRACKER_KEY": TRACKER_KEY,
    }
    for k, v in subs.items():
        page = page.replace("{{" + k + "}}", v)
    return page


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(build(), encoding="utf-8")
    print(f"wrote {OUT}/index.html")


if __name__ == "__main__":
    main()

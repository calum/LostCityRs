#!/usr/bin/env python3
"""Build the EPUB 3 edition of "How Multi-Tick Scripts Run" from the Markdown source.

This is a copy of docs/guide/build_epub.py, adapted for Book 4. Differences: source,
output, title, book id, title-page text, image alt texts, and support for fenced code
blocks (the tick guide uses none).

Python standard library only. The converter handles just the Markdown
constructs the book uses: #/##/### headings, paragraphs, bullet and numbered
lists, pipe tables, blockquotes, fenced code blocks, images with an italic caption
line, **bold**, *italic*, `code` and [links]. Relative links to other .md files are
rendered as plain text (they do not exist inside the EPUB).

Run: python3 docs/guide/build_epub_multitick.py
Output: docs/guide/how-multi-tick-scripts-run.epub
"""
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
SRC = HERE / "how-multi-tick-scripts-run.md"
OUT = HERE / "how-multi-tick-scripts-run.epub"
IMAGES = HERE / "images"
TITLE = "How Multi-Tick Scripts Run"
AUTHOR = "Calum (compiled with Claude Code)"
BOOK_ID = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, "lostcityrs-multitick-guide"))

CSS = """\
body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.4em; page-break-before: always; }
h2 { font-size: 1.25em; margin: 1.4em 0 0.4em; }
h3 { font-size: 1.1em; margin: 1.2em 0 0.3em; }
p { margin: 0.6em 0; text-align: left; }
code { font-family: monospace; font-size: 0.9em; }
blockquote { margin: 1em 0; padding: 0.2em 0.9em; border-left: 0.25em solid #000; }
blockquote p { margin: 0.4em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #000; padding: 0.3em 0.4em; vertical-align: top; text-align: left; }
th { background-color: #e4e4e4; }
figure { margin: 1em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85em; font-style: italic; margin-top: 0.3em; }
ul, ol { margin: 0.5em 0; padding-left: 1.4em; }
li { margin: 0.25em 0; }
pre { font-family: monospace; font-size: 0.8em; border: 1px solid #000; padding: 0.4em 0.6em; margin: 0.8em 0; white-space: pre-wrap; word-wrap: break-word; }
pre code { font-size: 1em; }
.sources { font-size: 0.85em; }
.subtitle { font-style: italic; text-align: center; }
"""


def inline(s):
    """Inline Markdown to XHTML. Code spans are protected first."""
    codes = []

    def keep(m):
        codes.append(m.group(1))
        return "\0%d\0" % (len(codes) - 1)

    s = re.sub(r"`([^`]+)`", keep, s)
    s = escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)

    def link(m):
        text, target = m.group(1), m.group(2)
        if target.startswith("http"):
            return '<a href="%s">%s</a>' % (target, text)
        return text  # relative file links do not exist inside the EPUB

    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, s)
    s = re.sub(r"\0(\d+)\0", lambda m: "<code>%s</code>" % escape(codes[int(m.group(1))]), s)
    return s


def cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


def convert(lines, images_used, alt_for):
    out = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            code = []
            i += 1
            while i < n and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # closing fence
            out.append("<pre><code>%s</code></pre>" % escape("\n".join(code)))
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2)), level))
            i += 1
            continue
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", line)
        if m:
            alt, path = m.group(1), m.group(2)
            images_used.append(path)
            cap = ""
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n and re.match(r"^\*[^*].*\*\s*$", lines[j]):
                cap = "<figcaption>%s</figcaption>" % inline(lines[j].strip()[1:-1])
                i = j
            out.append('<figure><img src="%s" alt="%s"/>%s</figure>' % (path, escape(alt_for.get(path, alt)), cap))
            i += 1
            continue
        if line.startswith(">"):
            block = []
            while i < n and lines[i].startswith(">"):
                block.append(lines[i][1:].lstrip())
                i += 1
            inner = convert(block, images_used, alt_for)
            out.append("<blockquote>%s</blockquote>" % inner)
            continue
        if line.startswith("|"):
            rows = []
            while i < n and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            head = cells(rows[0])
            body = [cells(r) for r in rows[2:]]
            t = "<table><thead><tr>%s</tr></thead><tbody>" % "".join("<th>%s</th>" % inline(c) for c in head)
            for r in body:
                t += "<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r)
            out.append(t + "</tbody></table>")
            continue
        if re.match(r"^[-*]\s+", line):
            items = []
            while i < n and re.match(r"^[-*]\s+", lines[i]):
                items.append(re.sub(r"^[-*]\s+", "", lines[i]))
                i += 1
            out.append("<ul>%s</ul>" % "".join("<li>%s</li>" % inline(x) for x in items))
            continue
        if re.match(r"^\d+\.\s+", line):
            items = []
            while i < n and re.match(r"^\d+\.\s+", lines[i]):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i]))
                i += 1
            out.append("<ol>%s</ol>" % "".join("<li>%s</li>" % inline(x) for x in items))
            continue
        para = [line.strip()]
        i += 1
        while i < n and lines[i].strip() and not re.match(r"^(#{1,3}\s|>|\||[-*]\s|\d+\.\s|!\[|```)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        text = " ".join(para)
        cls = ' class="sources"' if text.startswith("**Where this comes from.**") else ""
        out.append("<p%s>%s</p>" % (cls, inline(text)))
    return "\n".join(out)


def xhtml(title, body):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">\n'
        "<head><meta charset=\"utf-8\"/><title>%s</title>"
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        "<body>\n%s\n</body></html>\n" % (escape(title), body)
    )


def split_chapters(md):
    """Return (preamble_lines, [(title, lines)]) split on '## ' headings."""
    lines = md.splitlines()
    pre, chapters, cur = [], [], None
    for ln in lines:
        if ln.startswith("## "):
            cur = (ln[3:].strip(), [ln])
            chapters.append(cur)
        elif cur is None:
            pre.append(ln)
        else:
            cur[1].append(ln)
    return pre, chapters


def alt_texts():
    return {
        "images/multitick-suspension-vs-queue.svg": "Diagram: a suspension keeps one script state, stored and then run again; a queue or timer entry stores a script id, arguments and a delay counter, and builds a new script state when it runs.",
        "images/multitick-resume-points.svg": "Diagram: the eleven phases of a tick with four highlighted: phase 1 resumes world_delay, phase 2 resumes dialogue waits, phase 4 resumes npc_delay, phase 5 resumes p_delay at step 2 before queues, timers and the engine queue.",
        "images/multitick-mime-states.svg": "Diagram: the Mime's 16-count director cycle with counts 0, 1 and 4 marked, and a player's state going 7, 100, 101, 102 to the reward on right answers, with any wrong answer returning to 7.",
        "images/multitick-pottery-cadence.svg": "Diagram: weak queue entries A, B, C and D each read 2, 1, 0 over three ticks and run on T+2, T+5, T+8 and T+11, one item every three ticks.",
        "images/multitick-raft-timeline.svg": "Diagram: ticks 0 to 27 of the Zombie Queen raft ride; the script runs at ticks 0, 2, 4 up to 18, then 19, 21 to 25, and ends at tick 26; the p_delay argument chosen at each is shown.",
        "images/multitick-mist-handoff.svg": "Diagram: the player's queue entry runs at tick Q and calls world_delay, which moves the same script state to the world queue, where it runs pulses at Q+5, Q+10 and Q+15.",
        "images/multitick-longqueue-logout.svg": "Diagram: a permanent varp bit persists across session 1, offline and session 2, while the longqueue entry counting down from 1500 is dropped at logout and queued again with the full time at login.",
        "images/multitick-client-cycles.svg": "Diagram: server ticks 600 ms apart, about 30 client cycles per tick, and a camera shake started by one packet at tick T that runs until a cam_reset packet about 60 ticks later.",
    }


def main():
    md = SRC.read_text(encoding="utf-8")
    pre, chapters = split_chapters(md)
    alts = alt_texts()
    used = []

    files = []  # (filename, id, title, xhtml)
    # title page
    title_body = (
        '<h1 style="page-break-before:avoid">%s</h1>\n<p class="subtitle">%s</p>\n'
        "<p class=\"subtitle\">Source: LostCityRS Engine-TS, Content and Client-TS at the commits listed in the last chapter. "
        "Everything here was read from code; nothing was run.</p>"
    ) % (escape(TITLE), escape("How a LostCityRS script spreads its work over many ticks, from the smallest examples to the most involved ones, and what the client does meanwhile"))
    files.append(("title.xhtml", "title", TITLE, xhtml(TITLE, title_body)))

    for idx, (title, body_lines) in enumerate(chapters, start=1):
        body_lines = list(body_lines)
        body_lines[0] = "# " + body_lines[0][3:]  # chapter heading becomes h1 in its own file
        body = convert(body_lines, used, alts)
        files.append(("ch%02d.xhtml" % idx, "ch%02d" % idx, title, xhtml(title, body)))

    # navigation document (EPUB 3) and NCX (older readers)
    nav_items = "".join('<li><a href="%s">%s</a></li>' % (f[0], escape(f[2])) for f in files)
    nav = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">\n'
        '<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        '<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>%s</ol></nav></body></html>\n' % nav_items
    )
    ncx_points = "".join(
        '<navPoint id="np%d" playOrder="%d"><navLabel><text>%s</text></navLabel><content src="%s"/></navPoint>'
        % (k, k, escape(f[2]), f[0])
        for k, f in enumerate(files, start=1)
    )
    ncx = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
        '<head><meta name="dtb:uid" content="%s"/><meta name="dtb:depth" content="1"/>'
        '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>'
        "<docTitle><text>%s</text></docTitle><navMap>%s</navMap></ncx>\n" % (BOOK_ID, escape(TITLE), ncx_points)
    )

    unique_images = sorted(set(used))
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    ]
    spine = []
    for fname, fid, _t, _x in files:
        manifest.append('<item id="%s" href="%s" media-type="application/xhtml+xml"/>' % (fid, fname))
        spine.append('<itemref idref="%s"/>' % fid)
    for k, img in enumerate(unique_images, start=1):
        manifest.append('<item id="img%d" href="%s" media-type="image/svg+xml"/>' % (k, img))
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">\n'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="bookid">%s</dc:identifier><dc:title>%s</dc:title><dc:language>en</dc:language>'
        "<dc:creator>%s</dc:creator>"
        '<meta property="dcterms:modified">%s</meta></metadata>\n'
        "<manifest>%s</manifest>\n<spine toc=\"ncx\">%s</spine>\n</package>\n"
        % (BOOK_ID, escape(TITLE), escape(AUTHOR), modified, "".join(manifest), "".join(spine))
    )
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n'
    )

    with zipfile.ZipFile(OUT, "w") as z:
        # the mimetype entry must be first and stored, not compressed
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/style.css", CSS, compress_type=zipfile.ZIP_DEFLATED)
        for fname, _i, _t, content in files:
            z.writestr("OEBPS/" + fname, content, compress_type=zipfile.ZIP_DEFLATED)
        for img in unique_images:
            z.write(HERE / img, "OEBPS/" + img, compress_type=zipfile.ZIP_DEFLATED)
    print("wrote", OUT, "(%d chapters, %d images)" % (len(files), len(unique_images)))


if __name__ == "__main__":
    main()

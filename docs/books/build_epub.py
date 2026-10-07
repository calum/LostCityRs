#!/usr/bin/env python3
"""Build one EPUB 3 per book under docs/books/ (needs the `markdown-it-py` package).

Each book is a folder holding README.md (the introduction) plus numbered chapter
files (NN-name.md). The README becomes the first chapter, then the numbered
files in order. Links between chapters of the same book are rewritten to the
chapter's XHTML file; any other relative link (to notes outside the EPUB) is
rendered as plain text.

Run: python3 docs/books/build_epub.py
Output: docs/books/<book>/<book>.epub
"""
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from markdown_it import MarkdownIt

HERE = Path(__file__).resolve().parent
AUTHOR = "Calum (compiled with Claude Code)"
BOOKS = {
    "runescript-intro": ("An Introduction to RuneScript", "Book 3 of the LostCityRS series: how .rs2 becomes bytecode the engine runs"),
    "multi-tick-scripts": ("How Multi-Tick Scripts Run", "Book 4 of the LostCityRS series: suspension, queues, timers and worked examples"),
}

CSS = """\
body { font-family: serif; line-height: 1.45; margin: 0 4%; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.4em; page-break-before: always; }
h2 { font-size: 1.25em; margin: 1.4em 0 0.4em; }
h3 { font-size: 1.1em; margin: 1.2em 0 0.3em; }
h4, h5 { font-size: 1em; margin: 1em 0 0.3em; }
p { margin: 0.6em 0; text-align: left; }
code { font-family: monospace; font-size: 0.85em; word-wrap: break-word; }
pre { font-family: monospace; font-size: 0.8em; white-space: pre-wrap; word-wrap: break-word; margin: 0.8em 0; padding: 0.4em 0.6em; border: 1px solid #888; }
pre code { font-size: 1em; }
blockquote { margin: 1em 0; padding: 0.2em 0.9em; border-left: 0.25em solid #000; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.8em; }
th, td { border: 1px solid #000; padding: 0.3em 0.4em; vertical-align: top; text-align: left; word-wrap: break-word; }
th { background-color: #e4e4e4; }
ul, ol { margin: 0.5em 0; padding-left: 1.4em; }
li { margin: 0.25em 0; }
hr { margin: 1.2em 0; }
.subtitle { font-style: italic; text-align: center; }
"""


def md_engine():
    return MarkdownIt("commonmark", {"xhtmlOut": True, "html": False}).enable("table")


def chapter_files(book_dir):
    nums = sorted(p for p in book_dir.glob("[0-9][0-9]-*.md"))
    return [book_dir / "README.md"] + nums


def title_of(text, fallback):
    m = re.search(r"^#\s+(.*)$", text, re.M)
    return m.group(1).strip() if m else fallback


def rewrite_links(html, names):
    """Same-book .md links -> chapter file; other relative links -> plain text."""

    def fix(m):
        href, inner = m.group(1), m.group(2)
        if href.startswith(("http://", "https://")):
            return m.group(0)
        base = href.split("#")[0].split("/")[-1]
        if "/" not in href.split("#")[0] and base in names:
            return '<a href="%s">%s</a>' % (names[base], inner)
        return inner

    return re.sub(r'<a href="([^"]*)">(.*?)</a>', fix, html, flags=re.S)


def xhtml(title, body):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">\n'
        '<head><meta charset="utf-8"/><title>%s</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        "<body>\n%s\n</body></html>\n" % (escape(title), body)
    )


def build(slug, title, subtitle):
    book_dir = HERE / slug
    out = book_dir / (slug + ".epub")
    book_id = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, "lostcityrs-" + slug))
    md = md_engine()
    srcs = chapter_files(book_dir)
    names = {p.name: "ch%02d.xhtml" % i for i, p in enumerate(srcs)}
    files = []
    title_body = '<h1 style="page-break-before:avoid">%s</h1>\n<p class="subtitle">%s</p>\n<p class="subtitle">Source: LostCityRS Engine-TS, Content, Client-TS and RuneScriptTS at the commits listed in each chapter. Everything here was read from code; nothing was run.</p>' % (escape(title), escape(subtitle))
    files.append(("title.xhtml", "title", title, xhtml(title, title_body)))
    for i, p in enumerate(srcs):
        text = p.read_text(encoding="utf-8")
        ctitle = title_of(text, p.stem)
        if i == 0:
            ctitle = "Introduction: " + ctitle
        html = rewrite_links(md.render(text), names)
        files.append((names[p.name], "ch%02d" % i, ctitle, xhtml(ctitle, html)))

    nav_items = "".join('<li><a href="%s">%s</a></li>' % (f[0], escape(f[2])) for f in files)
    nav = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">\n'
        '<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        '<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>%s</ol></nav></body></html>\n' % nav_items
    )
    ncx_points = "".join(
        '<navPoint id="np%d" playOrder="%d"><navLabel><text>%s</text></navLabel><content src="%s"/></navPoint>' % (k, k, escape(f[2]), f[0])
        for k, f in enumerate(files, start=1)
    )
    ncx = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
        '<head><meta name="dtb:uid" content="%s"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>'
        "<docTitle><text>%s</text></docTitle><navMap>%s</navMap></ncx>\n" % (book_id, escape(title), ncx_points)
    )
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    ]
    spine = []
    for fname, fid, _t, _x in files:
        manifest.append('<item id="%s" href="%s" media-type="application/xhtml+xml"/>' % (fid, fname))
        spine.append('<itemref idref="%s"/>' % fid)
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">\n'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">%s</dc:identifier><dc:title>%s</dc:title><dc:language>en</dc:language><dc:creator>%s</dc:creator>'
        '<meta property="dcterms:modified">%s</meta></metadata>\n<manifest>%s</manifest>\n<spine toc="ncx">%s</spine>\n</package>\n'
        % (book_id, escape(title), escape(AUTHOR), modified, "".join(manifest), "".join(spine))
    )
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n'
    )
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/style.css", CSS, compress_type=zipfile.ZIP_DEFLATED)
        for fname, _i, _t, content in files:
            z.writestr("OEBPS/" + fname, content, compress_type=zipfile.ZIP_DEFLATED)
    print("wrote", out, "(%d files)" % len(files))


if __name__ == "__main__":
    for slug, (title, subtitle) in BOOKS.items():
        build(slug, title, subtitle)

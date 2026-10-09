"""MkDocs hook: point links that leave docs/ (CLAUDE.md, mise.toml, ...) at GitHub.

The notes link to files elsewhere in the repo with relative paths such as
`../mise.toml`. Those files are not part of the site, so the hook rewrites
them to the file on GitHub instead of leaving a broken link.
"""
import posixpath
import re

REPO_BLOB = "https://github.com/calum/LostCityRs/blob/main/"
LINK = re.compile(r"\]\((?!https?:|mailto:|#)([^)\s]+)\)")


def on_page_markdown(markdown, page, config, files):
    page_dir = posixpath.dirname(page.file.src_uri)

    def rewrite(match):
        target = match.group(1)
        path, sep, anchor = target.partition("#")
        resolved = posixpath.normpath(posixpath.join("docs", page_dir, path))
        if resolved.startswith("docs/") or resolved == "docs":
            return match.group(0)
        return "](" + REPO_BLOB + resolved + sep + anchor + ")"

    return LINK.sub(rewrite, markdown)

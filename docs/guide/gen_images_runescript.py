#!/usr/bin/env python3
"""Generate the RuneScript book's SVG diagrams into docs/guide/images/runescript-*.svg.
Same visual rules as docs/guide/gen_images.py: white background rect, black/grey, thick strokes."""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent / "images"
FONT = 'font-family="Helvetica, Arial, sans-serif"'
MONO = 'font-family="Consolas, Menlo, monospace"'
INK, MID, LIGHT = "#111111", "#666666", "#e4e4e4"


def svg(w, h, body, title):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img">\n'
        f"<title>{escape(title)}</title>\n"
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>\n'
        f"{body}</svg>\n"
    )


def text(x, y, s, size=16, anchor="start", weight="normal", fill=INK, style="normal", mono=False):
    f = MONO if mono else FONT
    return (
        f'<text x="{x}" y="{y}" {f} font-size="{size}" text-anchor="{anchor}" '
        f'font-weight="{weight}" font-style="{style}" fill="{fill}">{escape(s)}</text>\n'
    )


def box(x, y, w, h, fill="#ffffff", stroke=INK, sw=2.5, rx=6, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>\n'


def line(x1, y1, x2, y2, sw=2.5, stroke=INK, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}/>\n'


def arrow_down(x, y1, y2):
    return line(x, y1, x, y2 - 7) + f'<polygon points="{x-7},{y2-9} {x+7},{y2-9} {x},{y2}" fill="{INK}"/>\n'


def arrow_right(x1, x2, y):
    return line(x1, y, x2 - 8, y) + f'<polygon points="{x2-10},{y-7} {x2-10},{y+7} {x2},{y}" fill="{INK}"/>\n'


# 1. pipeline -------------------------------------------------------------
def pipeline():
    b = text(300, 28, "From .rs2 text to a running script", 18, "middle", "bold")
    b += box(30, 50, 250, 62, fill=LIGHT) + text(155, 76, "scripts: *.rs2", 15, "middle", "bold") + text(155, 98, "Content/scripts/**", 12, "middle", fill=MID)
    b += box(320, 50, 250, 62, fill=LIGHT) + text(445, 76, "data: configs + id tables", 15, "middle", "bold") + text(445, 98, "*.loc *.npc ... and pack/*.pack", 12, "middle", fill=MID)
    b += arrow_down(155, 112, 150) + arrow_down(445, 112, 150)
    b += box(30, 150, 540, 74)
    b += text(300, 176, "packAll  (Engine-TS/tools/pack)", 16, "middle", "bold")
    b += text(300, 200, "revalidatePack, then packConfigs, then runServerCompiler", 13, "middle")
    b += arrow_down(300, 224, 262)
    b += box(30, 262, 540, 128, fill=LIGHT)
    b += text(300, 288, "RuneScriptTS compiler (the npm package @lostcityrs/runescript)", 15, "middle", "bold")
    stages = ["1 parse", "2 analyze", "3 codegen", "4 pointer check", "5 write"]
    x = 46
    for i, s in enumerate(stages):
        w = 90 if i != 3 else 116
        b += box(x, 306, w, 40, fill="#ffffff", sw=2) + text(x + w / 2, 331, s, 13, "middle", "bold")
        x += w + 8
    b += text(300, 372, "any error: the compiler prints it and calls process.exit(1)", 12, "middle", fill=MID)
    b += arrow_down(300, 390, 428)
    b += box(30, 428, 540, 56)
    b += text(300, 454, "data/pack/server/script.dat + script.idx", 16, "middle", "bold", mono=False)
    b += text(300, 474, "one byte block per script id", 12, "middle", fill=MID)
    b += arrow_down(300, 484, 522)
    b += box(30, 522, 540, 74, fill=LIGHT)
    b += text(300, 548, "Engine: ScriptProvider.load  ->  ScriptFile objects", 15, "middle", "bold")
    b += text(300, 572, "ScriptRunner.execute(state) is the virtual machine", 13, "middle")
    b += text(300, 618, "Read from code at the commits in the last chapter; no compile was run.", 12, "middle", style="italic", fill=MID)
    return svg(600, 636, b, "Pipeline from .rs2 sources and config files through packAll and the compiler to script.dat and the engine VM")


# 2. header anatomy and key ------------------------------------------------
def header_anatomy():
    b = text(300, 28, "A header names a trigger and a subject", 18, "middle", "bold")
    b += text(300, 86, "[oploc1,_tree]", 34, "middle", "bold", mono=True)
    # braces under trigger and subject (mono 34px ~ 20.4px/char, string starts at x=300-143)
    left = 300 - 7 * 20.4
    # characters: [ o p l o c 1 , _ t r e e ]
    tx0, tx1 = left + 20.4, left + 20.4 * 7
    sx0, sx1 = left + 20.4 * 9, left + 20.4 * 13
    b += line(tx0, 100, tx1, 100, 3) + line(tx0, 100, tx0, 94, 3) + line(tx1, 100, tx1, 94, 3)
    b += line(sx0, 100, sx1, 100, 3) + line(sx0, 100, sx0, 94, 3) + line(sx1, 100, sx1, 94, 3)
    b += text((tx0 + tx1) / 2, 122, "trigger", 14, "middle", "bold") + text((tx0 + tx1) / 2, 140, "which event", 12, "middle", fill=MID)
    b += text((sx0 + sx1) / 2, 122, "subject", 14, "middle", "bold") + text((sx0 + sx1) / 2, 140, "which thing", 12, "middle", fill=MID)
    b += text(300, 178, "Three forms of subject, and the type number each gets in the key", 14, "middle", "bold")
    rows = [("hans", "specific: one config", "type 2"), ("_citizen", "category: every config with category=citizen", "type 1"), ("_", "global: everything (also login, ai_spawn)", "no subject part")]
    y = 192
    for name, what, t in rows:
        b += box(30, y, 540, 40, fill=LIGHT if name == "_citizen" else "#ffffff")
        b += text(46, y + 26, name, 15, "start", "bold", mono=True)
        b += text(150, y + 26, what, 13)
        b += text(556, y + 26, t, 13, "end", "bold", fill=MID)
        y += 48
    b += box(30, y + 12, 540, 62, fill=INK)
    b += text(300, y + 38, "key = trigger id + (type << 8) + (subject id << 10)", 17, "middle", "bold", fill="#ffffff")
    b += text(300, y + 60, "global: key = trigger id. Name-mode triggers (proc, label, queue ...): key = -1", 12, "middle", fill="#dddddd")
    return svg(600, y + 96, b, "Anatomy of a script header and how the three subject forms become a numeric lookup key")


# 3. lookup fallback --------------------------------------------------------
def lookup():
    b = text(300, 28, "How the engine finds the script for a click", 18, "middle", "bold")
    b += text(300, 52, "getByTrigger(trigger, typeId, categoryId): first hit wins", 13, "middle", fill=MID)
    steps = [
        ("1", "specific", "trigger | (2 << 8) | (typeId << 10)", "[opnpc1,hans]"),
        ("2", "category", "trigger | (1 << 8) | (categoryId << 10)", "[opnpc1,_citizen]"),
        ("3", "global", "trigger", "[opnpc1,_]"),
    ]
    y = 74
    for i, (n, name, how, ex) in enumerate(steps):
        b += box(30, y, 330, 66, fill=LIGHT if i == 1 else "#ffffff")
        b += text(46, y + 28, n, 17, "start", "bold") + text(70, y + 28, name, 16, "start", "bold")
        b += text(70, y + 52, how, 12, "start", mono=True)
        b += arrow_right(360, 410, y + 33)
        b += box(410, y + 8, 160, 50, sw=2)
        b += text(490, y + 38, ex, 12 if len(ex) > 18 else 13, "middle", "bold", mono=True)
        if i < 2:
            b += arrow_down(195, y + 66, y + 84)
            b += text(205, y + 80, "miss", 11, "start", fill=MID)
        y += 84
    b += box(30, y + 4, 540, 44, dash="6,4", sw=2)
    b += text(300, y + 31, "all three miss: the interaction ends without a script (default op message)", 13, "middle")
    b += text(300, y + 80, "A more specific script shadows the others: only one runs.", 13, "middle", style="italic")
    return svg(600, y + 100, b, "Script lookup tries the specific key, then the category key, then the global key")


# 4. VM trace ---------------------------------------------------------------
def vm_trace():
    rows = [
        ("caller", "PUSH_INT_LOCAL", "[120]", ""),
        ("gosub", "GOSUB_WITH_PARAMS", "[]", "[120, 0]"),
        ("0", "playercount (3 online)", "[3]", ""),
        ("1", "PUSH_CONSTANT_INT 2000", "[3, 2000]", ""),
        ("2", "min", "[3]", ""),
        ("3", "POP_INT_LOCAL 1", "[]", "[120, 3]"),
        ("4-5", "push 4000, push local 1", "[4000, 3]", ""),
        ("6", "sub", "[3997]", ""),
        ("7-8", "push 4000, push local 0", "[3997, 4000, 120]", ""),
        ("9", "scale", "[119]", ""),
        ("10", "RETURN", "[119]", "restored"),
    ]
    h = 90 + 34 * len(rows)
    b = text(300, 28, "~scale_by_playercount(120) on the stacks", 18, "middle", "bold")
    b += text(300, 50, "hand-traced from the handlers, not run", 12, "middle", style="italic", fill=MID)
    cols = [30, 100, 310, 480]
    b += box(30, 62, 540, 30, fill=INK)
    for x, t in zip(cols, ["step", "executed", "int stack", "locals"]):
        b += text(x + 8, 83, t, 13, "start", "bold", "#ffffff")
    y = 92
    for i, (a, bb, c, d) in enumerate(rows):
        b += box(30, y, 540, 34, fill=LIGHT if i % 2 == 0 else "#ffffff", sw=1.5, rx=0)
        b += text(cols[0] + 8, y + 22, a, 12, "start", "bold")
        b += text(cols[1] + 8, y + 22, bb, 12, "start", mono=True)
        b += text(cols[2] + 8, y + 22, c, 12, "start", "bold", mono=True)
        b += text(cols[3] + 8, y + 22, d, 11 if len(d) > 12 else 12, "start", mono=True)
        y += 34
    return svg(600, y + 20, b, "Step by step stack contents while the scale_by_playercount proc runs, ending with 119 left on the int stack")


# 5. protected idiom ---------------------------------------------------------
def protect_idiom():
    b = text(300, 28, "Doing protected work from an unprotected trigger", 18, "middle", "bold")
    b += text(300, 50, "tutorial.rs2, the player_kit interface", 12, "middle", style="italic", fill=MID)
    items = [
        ("[if_button,player_kit:accept]", "body: if_close;", "protected unless the interface is an overlay", False),
        ("[if_close,player_kit]", "body: queue(tutorial_designed_character, 0, 0);", "provides active_player only: unprotected", True),
        ("[queue,tutorial_designed_character]", "body: %tutorial = ^...designed_character;", "queue scripts run protected: the varp write is allowed", False),
    ]
    y = 72
    for i, (hd, body, note, hl) in enumerate(items):
        b += box(30, y, 540, 84, fill=LIGHT if hl else "#ffffff")
        b += text(46, y + 26, hd, 14, "start", "bold", mono=True)
        b += text(46, y + 48, body, 12, "start", mono=True)
        b += text(46, y + 70, note, 12, "start", fill=MID)
        if i < 2:
            b += arrow_down(300, y + 84, y + 110)
        y += 110
    b += box(30, y + 6, 540, 58, dash="6,4", sw=2)
    b += text(300, y + 30, "p_delay written in [if_close,...] is a compile error:", 13, "middle", "bold")
    b += text(300, y + 50, "Attempt to access uninitialized pointer p_active_player.", 12, "middle", mono=True)
    return svg(600, y + 84, b, "An interface button closes the interface, the unprotected close script queues a script, and the queued script runs protected")


# 6. four places -------------------------------------------------------------
def four_places():
    b = text(300, 28, "One command, four places", 18, "middle", "bold")
    b += box(130, 46, 340, 44, fill=LIGHT) + text(300, 74, 'mes("It looks like ...");', 16, "middle", "bold", mono=True)
    items = [
        ("1  signature", "Content/scripts/engine.rs2:159", "[command,mes](string $text)", "read by the compiler: types"),
        ("2  opcode number", "Engine-TS ScriptOpcode.ts, ScriptOpcodeMap", "['MES', ScriptOpcode.MES]", "read by the compiler: the number written"),
        ("3  pointer rule", "Engine-TS ScriptOpcodePointers.ts:268", "require: ['active_player']", "read by the pointer check"),
        ("4  handler", "Engine-TS PlayerOps.ts:343", "pops the string, messageGame(...)", "run by the VM"),
    ]
    y = 110
    for i, (n, where, what, who) in enumerate(items):
        b += arrow_down(300, y - 18, y) if i == 0 else ""
        b += box(30, y, 540, 74)
        b += text(46, y + 24, n, 15, "start", "bold")
        b += text(556, y + 24, where, 11, "end", fill=MID)
        b += text(46, y + 46, what, 13, "start", mono=True)
        b += text(46, y + 64, who, 12, "start", style="italic")
        y += 84
    b += text(300, y + 18, "Miss one and it fails at a different stage (compile, pointer check, or run).", 13, "middle", style="italic")
    return svg(600, y + 36, b, "A command call needs a signature, an opcode number, a pointer rule and a handler")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "runescript-pipeline.svg": pipeline(),
        "runescript-header.svg": header_anatomy(),
        "runescript-lookup.svg": lookup(),
        "runescript-vm.svg": vm_trace(),
        "runescript-protect.svg": protect_idiom(),
        "runescript-command.svg": four_places(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()

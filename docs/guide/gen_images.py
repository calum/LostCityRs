#!/usr/bin/env python3
"""Generate the book's SVG diagrams into docs/guide/images/.

Black, white and grey only, thick strokes, generic fonts: the diagrams have to
survive an e-ink screen. Every statement a diagram makes is taken from
docs/tick/ (phase order and steps: tick/00-overview.md; chop timeline:
tick/scenarios.md scenario 1).
Run: python3 docs/guide/gen_images.py
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent / "images"
FONT = "font-family=\"Helvetica, Arial, sans-serif\""
INK, MID, LIGHT = "#111111", "#666666", "#e4e4e4"


def svg(w, h, body, title):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img">\n'
        f"<title>{escape(title)}</title>\n"
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>\n'
        f"{body}</svg>\n"
    )


def text(x, y, s, size=16, anchor="start", weight="normal", fill=INK, style="normal"):
    return (
        f'<text x="{x}" y="{y}" {FONT} font-size="{size}" text-anchor="{anchor}" '
        f'font-weight="{weight}" font-style="{style}" fill="{fill}">{escape(s)}</text>\n'
    )


def box(x, y, w, h, fill="#ffffff", stroke=INK, sw=2.5, rx=6):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>\n'


def line(x1, y1, x2, y2, sw=2.5, stroke=INK, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"{d}/>\n'


def arrow_down(x, y1, y2):
    return line(x, y1, x, y2 - 7) + f'<polygon points="{x-7},{y2-9} {x+7},{y2-9} {x},{y2}" fill="{INK}"/>\n'


def arrow_right(x1, x2, y):
    return line(x1, y, x2 - 8, y) + f'<polygon points="{x2-10},{y-7} {x2-10},{y+7} {x2},{y}" fill="{INK}"/>\n'


# 1. the tick loop ---------------------------------------------------------
def tick_loop():
    b = ""
    b += box(40, 60, 520, 90, fill=LIGHT)
    b += text(300, 95, "cycle()", 24, "middle", "bold")
    b += text(300, 125, "phases 1 to 11, then the tail (autosave, logs, currentTick + 1)", 15, "middle")
    b += arrow_down(300, 150, 200)
    b += box(40, 200, 520, 70)
    b += text(300, 232, "setTimeout(cycle, 600 - elapsed - drift)", 18, "middle", "bold")
    b += text(300, 256, "wait out whatever is left of the 600 ms", 15, "middle")
    # return path up the right side
    b += line(560, 235, 590, 235) + line(590, 235, 590, 105) + line(590, 105, 570, 105)
    b += f'<polygon points="568,98 568,112 558,105" fill="{INK}"/>\n'
    b += text(300, 30, "One tick = one pass through cycle()", 18, "middle", "bold")
    b += text(300, 305, "Incoming packets wait in a buffer until phase 2.", 15, "middle", style="italic")
    return svg(600, 320, b, "The tick loop: cycle() runs, then waits for the rest of 600 ms, then runs again")


# 2. the eleven phases -----------------------------------------------------
PHASES = [
    (1, "processWorld", "world queue, delayed objs, NPC player-hunt"),
    (2, "processClientsIn", "decode and act on packets from players"),
    (3, "processNpcEventQueue", "ai_spawn / ai_despawn scripts"),
    (4, "processNpcs", "each NPC takes its turn"),
    (5, "processPlayers", "each player takes its turn"),
    (6, "processLogouts", "players leaving"),
    (7, "processLogins", "players arriving"),
    (8, "processZones", "loc and obj timers, shared zone events"),
    (9, "processInfo", "pre-encode player and NPC update blocks"),
    (10, "processClientsOut", "write each player's packets"),
    (11, "processCleanup", "reset per-tick state"),
]
ACTS = [
    ("Input and NPCs", 1, 4),
    ("Players", 5, 5),
    ("Logouts, logins, zones", 6, 8),
    ("Output and reset", 9, 11),
]


def phases(highlight=None, compact=False):
    row = 34 if compact else 44
    top = 14 if compact else 50
    h = top + row * 11 + (14 if compact else 40)
    b = ""
    if not compact:
        b += text(300, 28, "The eleven phases of cycle()", 18, "middle", "bold")
    x0, bw = 140, 440
    for i, (n, name, what) in enumerate(PHASES):
        y = top + i * row
        on = highlight is not None and n in (highlight if isinstance(highlight, (list, tuple, set)) else [highlight])
        b += box(x0, y, bw, row - 6, fill=INK if on else "#ffffff")
        col = "#ffffff" if on else INK
        b += text(x0 + 14, y + (row - 6) / 2 + 5, f"{n}", 16, "start", "bold", col)
        b += text(x0 + 44, y + (row - 6) / 2 + 5, name, 15, "start", "bold", col)
        if not compact:
            b += text(x0 + bw - 10, y + (row - 6) / 2 + 5, what, 11, "end", "normal", col if on else MID)
    # act brackets on the left
    for label, a, z in ACTS:
        ya = top + (a - 1) * row
        yz = top + z * row - 6
        b += line(128, ya, 128, yz, 3)
        b += line(128, ya, 134, ya, 3) + line(128, yz, 134, yz, 3)
        mid = (ya + yz) / 2
        if compact:
            continue
        words = label.split(" ")
        # up to three short lines, right-aligned against the bracket
        lines = []
        cur = ""
        for wd in words:
            if len(cur) + len(wd) + 1 > 12 and cur:
                lines.append(cur)
                cur = wd
            else:
                cur = (cur + " " + wd).strip()
        lines.append(cur)
        for k, ln in enumerate(lines):
            b += text(118, mid - (len(lines) - 1) * 9 + k * 18 + 5, ln, 13, "end", "bold", MID)
    if not compact:
        b += text(300, h - 12, "Grouping into four acts is this book's, not the code's.", 12, "middle", style="italic", fill=MID)
    return svg(600, h, b, "The eleven phases of a tick in order" + (f", phase {highlight} highlighted" if highlight else ""))


# 3. a player's turn ------------------------------------------------------
PLAYER_STEPS = [
    ("1", "Undelay", "delayed ends when currentTick >= delayedUntil"),
    ("2", "Resume a suspended script", "only if not delayed"),
    ("3", "Queues", "close modal if asked, normal queue, weak queue"),
    ("4", "Timers", "normal, then soft (not while logging out)"),
    ("5", "Engine queue", "stat changes, zone and map triggers"),
    ("6", "Face the target", "setFaceEntity"),
    ("7", "Re-aim", "reorientEntity"),
    ("8", "Interaction and movement", "try op/ap, move 1 or 2 tiles, try again"),
    ("9", "Reorient", "face a loc/obj if standing still"),
    ("10", "Run energy", "skipped while delayed"),
    ("11", "Distance check", "sets the jump flag; skipped for exact move"),
]


def player_turn():
    row, top = 50, 46
    h = top + row * len(PLAYER_STEPS) + 10
    b = text(300, 28, "One player's turn (phase 5)", 18, "middle", "bold")
    for i, (n, name, what) in enumerate(PLAYER_STEPS):
        y = top + i * row
        fill = LIGHT if n in ("3", "4", "8") else "#ffffff"
        b += box(30, y, 540, row - 12, fill=fill)
        b += text(48, y + 26, n, 17, "start", "bold")
        b += text(84, y + 26, name, 16, "start", "bold")
        b += text(560, y + 26, what, 12, "end", fill=MID)
        if i < len(PLAYER_STEPS) - 1:
            b += line(300, y + row - 12, 300, y + row, 2.5)
    return svg(600, h, b, "The eleven steps of one player's turn in phase 5")


# 4. an NPC's turn --------------------------------------------------------
NPC_STEPS = [
    ("1", "Undelay and resume", "only if the NPC is active"),
    ("2", "Lifecycle", "respawn, revert, despawn (if not delayed)"),
    ("gate", "isValid()?", "active and not delayed; if not, the turn ends here"),
    ("4", "Hunt", "non-player hunts; hunt counter + 1"),
    ("5", "Use hunt target", "turn a chosen target into an interaction"),
    ("6", "Regen", "stat regeneration"),
    ("7", "ai_timer", "the NPC's timer script"),
    ("8", "NPC queue", "ai_queue scripts"),
    ("9", "Mode and move", "at most one step"),
    ("10", "Facing", "after movement"),
]


def npc_turn():
    row, top = 50, 46
    h = top + row * len(NPC_STEPS) + 10
    b = text(300, 28, "One NPC's turn (phase 4)", 18, "middle", "bold")
    for i, (n, name, what) in enumerate(NPC_STEPS):
        y = top + i * row
        gate = n == "gate"
        b += box(30, y, 540, row - 12, fill=INK if gate else "#ffffff")
        col = "#ffffff" if gate else INK
        b += text(48, y + 26, "" if gate else n, 17, "start", "bold", col)
        b += text(84 if not gate else 48, y + 26, name, 16, "start", "bold", col)
        b += text(560, y + 26, what, 12, "end", fill="#dddddd" if gate else MID)
        if i < len(NPC_STEPS) - 1:
            b += line(300, y + row - 12, 300, y + row, 2.5)
    return svg(600, h, b, "The steps of one NPC's turn in phase 4, with the validity gate after lifecycle")


# 5. packets in and out ---------------------------------------------------
def packet_window():
    b = text(300, 28, "Where a click spends its time", 18, "middle", "bold")
    # two tick bands
    b += box(30, 60, 250, 56, fill=LIGHT) + text(155, 94, "tick T - 1 (cycle runs)", 14, "middle", "bold")
    b += box(290, 60, 280, 56, fill=LIGHT) + text(430, 94, "tick T (cycle runs)", 14, "middle", "bold")
    b += line(285, 118, 285, 134, 2.5, INK, "5,4")
    b += text(285, 152, "bytes arrive between cycles and wait in a buffer", 13, "middle", fill=MID)
    # inside tick T
    b += box(290, 170, 280, 46) + text(430, 198, "phase 2: decode, run handler", 14, "middle", "bold")
    b += box(290, 232, 280, 46) + text(430, 260, "phase 5: walk, op / ap, scripts", 14, "middle", "bold")
    b += box(290, 294, 280, 46) + text(430, 322, "phase 10: write results", 14, "middle", "bold")
    b += arrow_down(430, 216, 232) + arrow_down(430, 278, 294)
    b += text(30, 192, "In:", 15, "start", "bold") + text(30, 254, "Act:", 15, "start", "bold") + text(30, 316, "Out:", 15, "start", "bold")
    b += text(300, 372, "A packet that reaches the process while cycle T is running is decoded in T + 1.", 13, "middle", style="italic")
    b += text(300, 392, "(inference from how the event loop is used; open question 46)", 12, "middle", fill=MID)
    return svg(600, 410, b, "A click is buffered between ticks, decoded in phase 2, acted on in phase 5 and answered in phase 10")


# 6. the chop timeline ----------------------------------------------------
def chop_timeline():
    ticks = ["T", "T+1", "T+2", "A+1", "A+2", "A+3", "A+4", "A+5", "A+6", "A+7"]
    # T+2 is A, the arrival-plus-one tick where [oploc1,_tree] first runs
    labels = ["T", "T+1", "A", "A+1", "A+2", "A+3", "A+4", "A+5", "A+6", "A+7"]
    notes = {
        "T": ["packets", "decoded", "walk 1"],
        "T+1": ["walk 1", "arrive"],
        "A": ["oploc1", "sets the", "delay,", "re-arms"],
        "A+1": ["swing", "message"],
        "A+2": ["wait"],
        "A+3": ["log", "attempt"],
        "A+4": ["sets", "delay", "A+7"],
        "A+5": ["wait"],
        "A+6": ["wait"],
        "A+7": ["log", "attempt"],
    }
    emph = {"A+3", "A+7"}
    b = text(300, 28, "Chopping a tree, tick by tick", 18, "middle", "bold")
    b += text(300, 50, "worked out from code, not observed; assumptions in the text", 12, "middle", style="italic", fill=MID)
    cw = 54
    x0 = 30
    for i, lab in enumerate(labels):
        x = x0 + i * cw
        on = lab in emph
        b += box(x, 70, cw - 4, 40, fill=INK if on else LIGHT, sw=2)
        b += text(x + (cw - 4) / 2, 96, lab, 13, "middle", "bold", "#ffffff" if on else INK)
        for k, ln in enumerate(notes[lab]):
            b += text(x + (cw - 4) / 2, 134 + k * 15, ln, 11, "middle", fill=INK)
    b += line(x0, 210, x0 + 10 * cw - 4, 210, 2.5)
    # brackets
    b += line(x0, 216, x0, 232, 2.5) + line(x0, 232, x0 + 2 * cw - 4, 232, 2.5) + line(x0 + 2 * cw - 4, 232, x0 + 2 * cw - 4, 216, 2.5)
    b += text(x0 + cw - 2, 252, "approach", 13, "middle", "bold")
    b += line(x0 + 2 * cw, 216, x0 + 2 * cw, 232, 2.5) + line(x0 + 2 * cw, 232, x0 + 10 * cw - 4, 232, 2.5) + line(x0 + 10 * cw - 4, 232, x0 + 10 * cw - 4, 216, 2.5)
    b += text(x0 + 6 * cw, 252, "chop loop: one script run per tick, a log attempt every 4 ticks", 13, "middle", "bold")
    b += text(300, 292, "Two tiles away, walking, tree has op 3 and no [aploc] script.", 12, "middle", fill=MID)
    return svg(600, 310, b, "Timeline of the chop loop from the click at tick T to log attempts at A+3 and A+7")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "tick-loop.svg": tick_loop(),
        "phases.svg": phases(),
        "player-turn.svg": player_turn(),
        "npc-turn.svg": npc_turn(),
        "packet-window.svg": packet_window(),
        "chop-timeline.svg": chop_timeline(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()

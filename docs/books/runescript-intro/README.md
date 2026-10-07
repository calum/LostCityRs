# Book 3: An introduction to RuneScript (as implemented in this repository)

**Question answered:** What is RuneScript in this project, how does a `.rs2` file become something the engine runs, how are scripts keyed and found, what do the syntax, types, commands and pointers look like, and how does a newcomer read (and begin to write) a script that compiles against this compiler?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run (no `node_modules`, no generated parser, no `data/pack` in this checkout), so every bytecode listing is a hand-trace of the compiler's source. Chapters were drafted by a research agent, citations were machine-checked with `docs/tools/check_citations.py`, and the claims called out under "Verified by hand" below were re-read against the source by the author of this README.

Series: this is Book 3 of [the series](../README.md). [Book 1, *A Short Introduction to the Tick*](../../guide/a-short-introduction-to-the-tick.md) used `[oploc1,_tree]` as a trigger without explaining how it is compiled or looked up; chapter 2 of this book answers that (guide open question 5), and chapter 4 answers the guide's open question 30 (protected access).

Companion: [Book 4, how multi-tick scripts run](../multi-tick-scripts/README.md) uses this language heavily (`p_delay`, `queue`, `weakqueue`, dialogue procs). Read this book first if `.rs2` is new to you.

## RuneScript in two minutes (all of it from chapter 6.1 and its sources)

This whole script is real (`Content/scripts/skill_thieving/scripts/chest/trapped_chest.rs2:110-111`):

```abbrev
[oploc1,loc_2572]
mes("It looks like this chest has already been looted.");
```

- `[oploc1,loc_2572]` is the **header**: a *trigger* (`oploc1`, "player chose option 1 on a scenery object") and a *subject* (the loc named `loc_2572`). The pair becomes a numeric **lookup key**; the engine computes the same key when a player clicks that loc and runs the script (chapter 2).
- `mes(...)` is a **command**: declared in Content (`[command,mes](string $text)`, `Content/scripts/engine.rs2:159`), numbered by the compiler, implemented by an engine handler (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:343-347`) (chapter 5).
- The compiler appends a `RETURN`; the script is 3 instructions (chapter 6.1, hand-compiled).
- The compiler checks, before the script ever runs, that the trigger provides the pointer the command needs (`mes` needs `active_player`, and `oploc1` provides it) (chapter 4).

Everything else in the language is variations on that: more triggers (`[proc,...]`, `[queue,...]`, `[timer,...]`, `[ai_...]`), local variables (`$x`), game variables (`%x`), constants (`^x`), calls (`~proc(...)`, `@label`), `if`/`while`/`switch`, and a few hundred commands (366 distinct names declared in `Content/scripts/engine.rs2`, counting `.name` and `name*` variants once; chapter 5.2).

## Reading order

| # | Chapter | What it covers |
|---|---|---|
| 1 | [toolchain and config files](01-toolchain-and-config-files.md) | `.rs2` to `script.dat`/`script.idx` to `ScriptProvider`; the five compiler stages; pack files and symbol tables; what each config extension (`.obj`, `.loc`, `.npc`, `.inv`, `.seq`, `.param`, `.enum`, `.dbtable`, `.if` ...) is |
| 2 | [script anatomy and lookup](02-script-anatomy-and-lookup.md) | headers, the trigger list and which engine code fires each family, lookup-key construction, specific/category/global fallback (what `_tree` means) |
| 3 | [syntax, semantics and the VM](03-syntax-semantics-and-the-vm.md) | lexer, statements, types, operand encodings, three hand-compiled examples run through the VM |
| 4 | [pointers and protected access](04-pointers-and-protected-access.md) | `active_*`, `p_active_*`, what the compiler enforces vs the runtime |
| 5 | [commands](05-commands.md) | where a command lives, family map with counts, ten commands traced signature to handler |
| 6 | [writing a first script](06-writing-a-first-script.md) | three real scripts line by line, a constructed example, verified compiler gotchas |
| 7 | [glossary](07-glossary.md) | terms, with where each was verified |
| 8 | [inferences and not-checked](08-inferences-and-not-checked.md) | what is inference, answers to open questions 5/25/30/15/55, what was not read |

## Things that may surprise you (each cited in the chapters)

- There is **no `self` keyword**; scripts use pointers such as `active_player` (chapter 4).
- A **missing `return` is not an error**: the code generator appends one (chapter 3, finding 65; `generateDefaultReturns`, and the `RETURN` write at `RuneScriptTS/src/runescript/writer/BinaryScriptWriter.ts:332`).
- There is **no unreachable-code diagnostic** (chapter 6.5).
- **String-to-string comparison is a compile error** (chapter 6.5).
- **Arrays compile but the VM throws `unimplemented`**, and Content uses none (chapter 3; `Engine-TS/src/engine/script/handlers/CoreOps.ts:264`).
- `AI_WALKTRIGGER` exists only on the engine side, not in the compiler's trigger list (chapter 2).
- `p_delay` inside a soft timer or `[if_close]` script is a **compile error** (the trigger does not provide `p_active_player`), but `queue` and `settimer` are allowed there (chapter 4.4; answers open question 30).

## Verified by hand (after the draft)

- Category subjects are written with type `1` in the lookup key by the compiler (`RuneScriptTS/src/runescript/writer/BinaryScriptWriter.ts:80-81`, `const type = subjectType === ScriptVarType.CATEGORY ? 1 : 2;`), and the engine falls back specific (type 2) then category (type 1) then global (`Engine-TS/src/engine/script/ScriptProvider.ts:125-129`).
- `p_delay` has `require: ['p_active_player']` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:317-318`); `queue`, `settimer`, `softtimer`, `weakqueue` and `longqueue` require only `active_player` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:257-258`, `:410-411`, `:433-434`, `:437-438`, `:489-490`).
- The chapter 6.1 lookup-key arithmetic: `66 + (2 << 8) + (2572 << 10) = 2,634,306`.
- The arrays `unimplemented` throws are in `Engine-TS/src/engine/script/handlers/CoreOps.ts:264-272`.
- Not re-derived by hand: the hand-compiled bytecode listings, the command-family counts, the `*.pack` and config-language details in chapter 1, and the diagnostics list in chapter 6.5.

## Limits

- Nothing was compiled or run; the ANTLR parser is absent from the checkout, so precedence and tie-breaking rely on ANTLR's documented behaviour plus consistent Content usage.
- Whether `npm` installs `RuneScriptTS` from a registry or links this checkout is unknown, so the compiler read here (`c454554`) may differ from the one Engine-TS actually uses.
- Content statistics (scripts, files, `def_` frequency) are one-off regex counts and approximate.

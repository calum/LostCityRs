# Chapter 8: Inferences collected, answers to open questions, and what was not checked

**Question answered:** Which conclusions are inferences, which open questions did Book 3 answer, and what remains unchecked?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

### 8.1 Inferences in one place

Each was labelled where it appeared; this list repeats them so they are not mistaken for findings.

- A (1.7): script ids are not stable across machines; only consistent within one `script.dat`.
- B (1.7): "transmitted" packs are those shared with the client.
- C (1.7): editing a varp's `protect` flag changes type-checking of existing scripts.
- D (2.6): `ScriptState.trigger` is 255 for name-mode scripts.
- E (2.6): a more specific script shadows the category/global ones completely.
- F (2.6): the packed coordinate keys of `mapzone`/`zone` scripts are truncated 32-bit numbers and unused by lookups; collisions with real keys were not analysed.
- G-J (3.9): no switch fall-through by lowering; operator precedence by ANTLR's rule; default returns; `5-3` lexing.
- K-M (4.5): the exclusive-protection model; unchecked mutating commands; the `writeinv` table is unused by the compiler.
- N-P (5.4): the new-command checklist; per-run query state; counts describe vocabulary size.
- The `u`/`t` suffix reading in the trigger table (2.3): `u` = use item, `t` = component/spell target.
- 6.2/6.3: "queue to get protected access" as an idiom; "the `-1` name-mode key is inserted into `scriptLookup`" (1.4 observation).

### 8.2 Answers to the open questions assigned to this chapter

- **#5 (how scripts are keyed; what `_tree` means):** answered in findings 43-47 (`_tree` is a category subject; key = `trigger + (1<<8) + (categoryId<<10)`; engine fallback order specific -> category -> global).
- **#25 (is `[ai_spawn,_]` registered under the global `AI_SPAWN` key):** yes by the code read, finding 47: subject `_` gives key = trigger id 166, which is `getByTrigger`'s third lookup. The runtime effect (queue length after loading maps) was not observed.
- **#30 (can unprotected scripts call protected-only commands):** section 4.4: not `p_` commands (compile error), but `queue`, `settimer`, `softtimer` are allowed; `p_delay` has no runtime check; the logout trigger is protected.
- **#15 (VM internals for a resumed script):** partly answered in finding 75: the `ScriptState` object, with `pc`, stacks, frames and locals, is parked and `execute` simply continues. The NPC and world-queue resume paths, and what exactly happens to `pointers` after a suspend (they are kept in the state), were not traced further.
- **#55 (client-side scripts):** only the interface component "script" vocabulary was read (finding 35). Whether the `_unpack` data was extracted unchanged or authored by the team is not answered; no code records provenance.

### 8.3 Not checked (consolidated)

- **Nothing was run.** No compile, no `script.dat`, no engine start, no packet. All bytecode listings are hand-compiled from source.
- The ANTLR-generated parser is absent in the checkout; grammar semantics (precedence, tie-breaking) rely on ANTLR's documented behaviour.
- Whether `npm install` fetches RuneScriptTS from a registry or links the local checkout (the commit hash `c454554` read here may differ from the compiler Engine-TS actually uses).
- Most `*Config.ts` packers and the client side of the config archive.
- Most handler bodies (only those quoted), most `ScriptOpcodePointers` entries (only those quoted; the 248-entry count is of entry headers).
- All compiler/engine trigger ids were not compared one by one (spot checks only); `AI_WALKTRIGGER` exists only on the engine side.
- Possible key collisions from truncated `mapzone`/`zone` lookup keys (Inference F).
- `Server/` setup scripts, `Engine-TS/src/setup.ts`, the dev-server watcher beyond `DevThread.ts:26`.
- Whether any Content script relies on behaviours listed in 6.5 as "not diagnosed" (e.g. dead code).
- Macros: none exist in Content; the macro processor was not read.
- Content statistics (10,938 scripts, 1,416 files, `def_` frequencies, `gosub(` 228) are one-off regex counts, approximate.

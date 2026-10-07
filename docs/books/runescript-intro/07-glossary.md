# Chapter 7: Glossary

**Question answered:** Which terms does a newcomer need, and where was each verified?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

Terms are as used in this chapter. "Where verified" gives the finding (F) or the primary source.

| Term | Definition | Where verified |
|---|---|---|
| RuneScript | the scripting language of `.rs2` files; compiled to bytecode by RuneScriptTS and run by Engine-TS's interpreter | F1-F24 |
| `.rs2` | a script source file; may hold many scripts | `ScriptCompiler.ts:296` |
| script | one `[trigger,subject]` header plus its statements | F36 |
| trigger | the first word in a header; names an event kind (`opnpc1`, `queue`, `login`, ...) or a callable kind (`proc`, `label`) | F39, F44 |
| subject | the second part of a header: a config name, `_` (global), `_name` (category), a coordinate, or just a name | F43 |
| global subject | `_`; the script applies to every subject of that trigger | F43, F46 |
| category subject | `_name`; applies to every config with `category=name` | F43, F46 |
| lookup key | `trigger.id + (kind << 8) + (subjectId << 10)`, or `-1` for name-mode triggers | F46 |
| `getByTrigger` | engine lookup: specific, then category, then global | F47 |
| name-mode trigger | trigger whose subject is just a name: `proc`, `label`, `queue`, `timer`, `softtimer`, `walktrigger`, `debugproc` | F43, F46 |
| proc | a callable script with params and return values, called `~name(args)` | F58, F69 |
| label | a callable script that never returns to the caller, entered with `@name(args)` | F58, F70 |
| command | a built-in operation implemented by an engine handler; declared in `engine.rs2` | F90-F94 |
| `engine.rs2` | `Content/scripts/engine.rs2`; the command signatures | F90 |
| opcode | a numeric VM instruction: 0-46 core, others are command ids | F67, F91 |
| handler | the TypeScript function that executes one opcode | F93 |
| dynamic command | a command with custom compile-time type-checking/codegen | F95 |
| secondary (`.`) | the second entity of a class: `.name` command, `.%var` variable, `.active_player` pointer | F80, F81 |
| pointer | a compile-time token (and 10 runtime bits) saying which entities a script currently holds | F78, F79 |
| `active_player` etc. | the primary entity pointers | F78 |
| protected access (`p_active_player`) | exclusive right to change the player; required by `p_` commands and by writes to protected varps / invs | F82-F86 |
| `protect` (config) | a varp / inv flag: when true (the varp default), writes need protected access | F86, `VarPlayerType.ts:85` |
| `corrupt` | a command effect that invalidates a pointer (e.g. `p_delay` corrupts `find_*`) | F83, F89 |
| `conditional` set | a pointer a command sets only when its boolean result is true | F83 |
| local (`$x`) | typed variable local to a script run | F62 |
| game variable (`%x`) | varp (player), varbit, varn (npc), vars (world) | F61 |
| varp | persistent or temporary player variable; `scope=perm` saved | `VarpConfig.ts:55-62` |
| constant (`^x`) | compile-time text, re-parsed with the expected type | F60 |
| type hint | the type the checker expects at a position; resolves bare names and literals | F59 |
| `null` | `-1` for int-based types, `"null"` for strings (`CodeGenerator.ts:722-743`) | F93 |
| `calc` | the only place arithmetic operators are allowed | F57 |
| `def_<type>` | local declaration | F55, F62 |
| `switch_<type>` | switch statement on a type | F55, F66 |
| tick / `map_clock` | the world cycle counter | `ServerOps.ts:16-18` |
| `script.dat` / `script.idx` | compiled output in `data/pack/server` | F20 |
| `.pack` | `id=name` table for one kind of config | F25-F27 |
| transmitted pack | pack shared with the client; ids must be committed | F26 |
| config | a data definition block in `.npc`/`.loc`/`.obj`/... | F32-F33 |
| symbol | a (kind, name) -> id entry the compiler can resolve | F11, F30 |
| `ScriptState` | the VM's per-run state: pc, stacks, frames, locals, pointers | F68 |
| frame | a saved caller (`gosub`) | F69 |
| suspended script | a `ScriptState` parked on `activeScript` waiting to be resumed | F75 |
| queue / `weakqueue` / `strongqueue` / `longqueue` | commands to run a `queue` script later | F45, F98 |
| timer / `softtimer` | repeating scripts on a player; normal timers are protected, soft ones not | F44 |
| `mapzone` / `zone` | triggers fired when moving in/out of a map square / zone; looked up by name | F48 |
| `ai_*` | triggers for NPC behaviour (`ai_opplayer2`, `ai_queue1`, `ai_timer`, `ai_spawn`, ...) | F44 |
| `debugproc` | developer cheat script run with `::name` | F44 |
| category | an id table generated from `category=` lines | F28 |
| dbtable / dbrow / dbcolumn | a database table, one row, and a column symbol `table:column` | F32-F33, F97 |
| enum | an int->type lookup table; used with the `enum` command | F33, F95 |
| struct / param | a bag of params / a typed attribute attached to configs | F32-F33 |
| gotcha | see 6.5 | F107-F116 |

---

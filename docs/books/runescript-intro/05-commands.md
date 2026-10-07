# Chapter 5: Commands

**Question answered:** Where is a command declared, numbered and implemented, how are the families laid out, and what is the path from a call in a script to its handler?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

### 5.1 Findings: the four places a command lives

A **command** is a built-in operation called as `name(args)` (or bare `name`). Four separate artefacts make one command work; a missing piece fails at a different stage.

90. **(1) The signature, in Content.** `Content/scripts/engine.rs2` is an ordinary `.rs2` file whose "scripts" all use the pseudo-trigger `command`; it contains the types of the parameters and the return values, plus a comment line `// info: ...` for humans. The file is not special-cased by the language: it is parsed and registered like any other (the `command` trigger is registered in `ScriptCompiler`'s constructor, `ScriptCompiler.ts:123`; `ScriptRegistration` builds a `ServerScriptSymbol` for it, `ScriptRegistration.ts:167-178`). Two things are special: the code generator skips command "scripts" (`CodeGenerator.ts:173-176`) and the pack tool skips the file when assigning script ids (`PackFile.ts:370`). Commands are also the only scripts allowed to take parameter types that are otherwise forbidden (`ScriptRegistration.ts:427`, `script.triggerType !== CommandTrigger && !type.options.allowParameter`) and to end their name in `*` (`:119-126`). Examples (`Content/scripts/engine.rs2`):
    ```
    [command,mes](string $text)
    ```
    (`:159`)
    ```
    [command,map_clock]()(int)
    ```
    (`:9`; no parameters, one int result)
    ```
    [command,if_close]
    ```
    (`:143`; no parenthesis at all: no parameters, no result). The file has 521 `[command,...]` header lines (`grep -c '^\[command'`) which are 366 distinct names once the dotted (secondary) twins `.name` and the `name*` variants are folded in (one-off script count).

91. **(2) The opcode number, in the engine.** The compiler never decides the number. `Engine-TS/src/engine/script/ScriptOpcode.ts` has (a) the enum `ScriptOpcode`, a `const enum` grouped in numeric bands (`// Server ops (1000-1999)` ... `// Debug ops (10000-11000)`, section lines `:2, :41, :67, :208, :259, :275, :289, :299, :309, :328, :363, :367, :400, :433, :436, :449`), and (b) the map `ScriptOpcodeMap` from the upper-case command name to the enum value (`:456-881`), e.g. `:472` `['GOSUB', ScriptOpcode.GOSUB],`. `Engine-TS/tools/pack/Compiler.ts:108-114` lower-cases those names and passes them to the compiler as the command symbol table, so the **name in `engine.rs2` must equal the lower-cased key in `ScriptOpcodeMap`**. The star variants are separate keys, e.g. `['QUEUE*', ScriptOpcode.QUEUEVARARG]` (`ScriptOpcode.ts:618`). The map has 404 entries; 401 of them have a handler. The three that do not (`LC_OP`, `OC_OP`, `OC_IOP`) are also not declared in `engine.rs2` (one-off script comparison of the three artefacts).

92. **(3) The pointer rule, in the engine** (`ScriptOpcodePointers`, section 4). 248 of the commands have an entry; the rest (e.g. `map_clock`, `random`, `tostring`, `enum`) require nothing.

93. **(4) The handler, in the engine.** A function `(state: ScriptState) => void` registered under the opcode. The handler files are merged into one table in `ScriptRunner.HANDLERS` (`ScriptRunner.ts:38-56`): `CoreOps`, `ServerOps`, `PlayerOps`, `NpcOps`, `LocOps`, `ObjOps`, `NpcConfigOps`, `LocConfigOps`, `ObjConfigOps`, `InvOps`, `EnumOps`, `StringOps`, `NumberOps`, `StructOps`, `DbOps`, `DebugOps`. A handler pops its arguments **in reverse order of the signature** from the stack (`popInts(n)` returns them in signature order), does its work, and pushes any results. The first line of each handler usually validates arguments: `check(value, SomeValidator)`, where the validators throw on `-1` ("null") or on an id that does not exist (`ScriptValidators.ts:37-41`, `:142-144`). That is the runtime meaning of `null`: every int-based type uses `-1` as null (compiler default values, section 3; `PrimitiveType.ts`, `ScriptVarType.ts`).

94. **How a call becomes a handler invocation.** Walking one call `mes("hi");` through the code:
    1. `visitCommandCallExpression` looks up the symbol `mes` of kind `command` in the root table and type-checks the arguments against `(string $text)` (`TypeChecking.ts:714-729`, `checkCallExpression` `:807-823`).
    2. `CodeGenerator.visitCommandCallExpression` emits the argument code and an `Opcode.Command` instruction carrying the symbol (`CodeGenerator.ts:580-595`).
    3. The binary writer asks the `SymbolMapper` for the symbol's id: for a command it strips any leading `.` from the name and looks the rest up in the map filled from `commandInfo.map` (`SymbolMapper.ts:59-70`, filled at `ServerScriptCompilerApplication.ts:110`); it writes the id as the opcode and `1` or `0` as the operand according to whether the symbol name started with `.` (`BinaryScriptWriter.ts:322-329`). If the id is unknown the writer throws `Missing opcode id for command ...` (`:325-327`).
    4. At run time `ScriptRunner.execute` looks up `HANDLERS[opcode]` (`ScriptRunner.ts:150-156`); if there is none it throws `Unhandled command <NAME>` (`:152-154`).

    So: a command declared in `engine.rs2` but absent from `ScriptOpcodeMap` fails at **compile** time; one present in the map but without a handler compiles and fails at **run** time on first use. (Inference from the cited code; not triggered.)

95. **Dynamic commands** have custom type checking (and sometimes code generation) in RuneScriptTS because their signatures cannot be written as a fixed list of types. They are registered by name in `ServerScriptCompiler.setup`; the registration order also shows the *feature era* the authors tag them with in comments (September 2004, 2005, 2009, ...). Source: `RuneScriptTS/src/runescript/ServerScriptCompiler.ts:64-199`:

    | Command(s) | Handler class | What it customises |
    |---|---|---|
    | `queue`, `.queue` (and `weakqueue`, `strongqueue`, `longqueue`) | `QueueCommandHandler` / `LongQueueCommandHandler` | first argument must be a `queue`-trigger script, then int delay, then one int arg (`:86-98`, `:151-156`, `:159-164`; handler `QueueCommandHandler.ts:16-26`) |
    | `queue*`, `weakqueue*`, `strongqueue*`, `longqueue*` | `QueueVarArgCommandHandler` / `LongQueueVarArgCommandHandler` | the extra arguments are type-checked against the callee's own parameter list, and a type-code string is pushed (`QueueVarArgCommandHandler.ts:19-54`) |
    | `settimer`, `softtimer` (+dot forms) | `TimerCommandHandler` | first argument a `timer`/`softtimer`-trigger script, then the interval, then the callee's parameters (`TimerCommandHandler.ts:19-56`; registered `ServerScriptCompiler.ts:100-102`, `:180-182`) |
    | `lc_param`, `nc_param`, `oc_param`, `struct_param`, `loc_param`, `npc_param`, `obj_param` | `ParamCommandHandler` | the second argument must be a `param`, and the **result type is that param's declared type** (`ParamCommandHandler.ts:17-48`; registered `:104-113`, `:177`) |
    | `enum` | `EnumCommandHandler` | `enum(inputtype, outputtype, enumName, key)`: the first two arguments are *type names* and the result is typed as the output type (`EnumCommandHandler.ts:19-41`; `ServerScriptCompiler.ts:168-169`) |
    | `db_find`, `db_find_refine`, `db_find_with_count`, `db_find_refine_with_count` | `DbFindCommandHandler` | the key is typed by the column's type, and one extra constant (the key's stack type: int / string) is pushed before the command (`DbFindCommandHandler.ts:21-61`; `ServerScriptCompiler.ts:187-190`) |
    | `db_getfield` | `DbGetFieldCommandHandler` | the result type is the column's type (`DbGetFieldCommandHandler.ts:21-53`; `:191`) |
    | `dump`, `script` | debug handlers | `ServerScriptCompiler.ts:198-199` |

    Each of these is gated by the corresponding feature flag (all on by default): `queueTyped`, `enums`, `structs`, `dbtables` (`StrictFeatureLevel.ts`).

### 5.2 Findings: the map of command families

96. `engine.rs2` is divided by comment headers that mirror the engine's opcode bands. Counting `[command,...]` base names (dot twins merged) per band in `engine.rs2`, and the number of handler keys in the matching engine handler file(s) (one-off scripts; headers: `engine.rs2:1, 7, 83, 519, 671, 721, 751, 767, 783, 815, 938, 944, 965, 1026, 1039`):

    | Family | `ScriptOpcode` band | Declared names (`engine.rs2`) | Handler file(s): keys | Sample names |
    |---|---|---|---|---|
    | core language | 0-99 | 2 | `CoreOps.ts`: 33 (push/pop/branch/switch/gosub/jump/return/join are handlers too, but not declared) | `gosub`, `jump` |
    | server / world | 1000-1999 | 34 | `ServerOps.ts`: 26 (`split_*`, `struct_param` are declared here but implemented in `StringOps.ts`/`StructOps.ts`) | `map_clock`, `map_members`, `playercount`, `huntall`, `inzone`, `distance`, `movecoord`, `split_init` |
    | player | 2000-2499 | 136 | `PlayerOps.ts`: 139 | `mes`, `anim`, `queue`, `settimer`, `p_delay`, `p_oploc`, `if_close`, `cam_*`, `walkanim*`, `p_*` (26 names) |
    | stat | (inside player / npc) | 9 player + 4 npc | `PlayerOps.ts`, `NpcOps.ts` | `stat`, `stat_base`, `stat_add`, `stat_sub`, `stat_heal`, `stat_boost`, `stat_drain`, `stat_random`, `stat_advance`; `npc_stat`, `npc_statadd`, `npc_statheal`, `npc_statsub` |
    | npc | 2500-2999 | 46 | `NpcOps.ts`: 48 | `npc_add`, `npc_say`, `npc_setmode`, `npc_find`, `npc_param`, `npc_coord` |
    | loc | 3000-3499 | 14 | `LocOps.ts`: 14 | `loc_add`, `loc_change`, `loc_del`, `loc_find`, `loc_param`, `loc_coord` |
    | obj | 3500-4000 | 12 | `ObjOps.ts`: 12 | `obj_add`, `obj_del`, `obj_find`, `obj_param`, `obj_coord` |
    | config | 4000-4299 | npc 7 + loc 7 + obj 15 = 29 | `NpcConfigOps.ts` 8, `LocConfigOps.ts` 7, `ObjConfigOps.ts` 15 | `nc_name`, `lc_param`, `oc_name`, `oc_param`, `oc_members`, `oc_cost` |
    | inventory | 4300-4399 | 33 | `InvOps.ts`: 33 | `inv_add`, `inv_del`, `inv_total`, `inv_freespace`, `inv_getobj`, `inv_dropitem` |
    | enum | 4400-4499 | 2 | `EnumOps.ts`: 2 | `enum`, `enum_getoutputcount` |
    | string | 4500-4599 | 11 | `StringOps.ts`: 17 | `append`, `lowercase`, `tostring`, `compare`, `substring`, `string_length` |
    | number | 4600-4699 | 31 | `NumberOps.ts`: 31 | `add`, `sub`, `random`, `min`, `scale`, `setbit`, `testbit` |
    | struct | 4700-4799 | (1: `struct_param`, declared in the server band) | `StructOps.ts`: 1 | `struct_param` |
    | db | 7500-7599 | 11 | `DbOps.ts`: 11 | `db_find`, `db_findnext`, `db_getfield`, `db_getfieldcount`, `db_listall` |
    | debug | 10000-11000 | 5 | `DebugOps.ts`: 4 | `error`, `console`, `timespent` |

    Totals: declared base names 366 (sum of the "declared" column: 2+34+136+46+14+12+7+7+15+33+2+11+31+11+5); handler keys 401 (sum of the "keys" column, including the 33 core handlers and the struct handler). Handler counts are lines matching `^\s{4}\[ScriptOpcode\.X\]:` in each file. The "stat" and "config" rows are slices of other bands, so they are not additional totals.

### 5.3 Worked traces: ten commands from signature to handler

Each row follows one command through the four artefacts. "Pointer rule" is from `ScriptOpcodePointers.ts`; the numbers are the enum values counted from the file's anchors, with the same cross-check as in 3.6.

| Command (family) | Signature (`engine.rs2`) | Opcode | Pointer rule | Handler and what it does |
|---|---|---|---|---|
| `mes` (player) | `:159` `[command,mes](string $text)` | 2063 | require `active_player` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:268-271`) | `PlayerOps.ts:343-347`: pops the string, `state.activePlayer.messageGame(message)` |
| `p_delay` (player, protected) | `:173` `[command,p_delay](int $delay)` | 2073 | require `p_active_player`, corrupt `find_*`/`last_*` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:317-330`) | `PlayerOps.ts:376-380`: sets `delayed`, `delayedUntil = currentTick + 1 + n`, `execution = SUSPENDED` |
| `stat_advance` (stat) | `:317` `[command,stat_advance](stat $stat, int $exp)` | 2114 | require `active_player` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:118-120`) | `PlayerOps.ts:810-817`: pops `[stat, xp]`, rejects `-1` for both, `state.activePlayer.addXp(stat, xp)` |
| `npc_say` (npc) | `:583` `[command,npc_say](string $text)` | 2533 | require `active_npc` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:680-683`) | `NpcOps.ts:185-187`: `state.activeNpc.say(state.popString())` |
| `loc_change` (loc) | `:687` `[command,loc_change](loc $new_loc, int $duration)` | 3004 | require `active_loc` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:779-782`) | `LocOps.ts:60-67`: pops `[id, duration]`, validates, `World.changeLoc(state.activeLoc, id, shape, angle, duration)` |
| `obj_add` (obj) | `:723` `[command,obj_add](coord $coord, namedobj $obj, int $count, int $duration)` | 3500 | require `active_player`, **set `active_obj`** (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:825-830`) | `ObjOps.ts:20-...`: pops four ints, validates, creates `Obj` entities, `World.addObj(obj, state.activePlayer.hash64, duration)`, then `state.activeObj = obj; state.pointerAdd(ActiveObj[...])` (`:45-46`): the runtime does what the rule promised |
| `inv_add` (inventory) | `:825` `[command,inv_add](inv $inv, namedobj $obj, int $count)` | 4302 | require `active_player` (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:881-884`) | `InvOps.ts:57-83`: validates, **runtime protected check** (`:64-66`), then `player.invAdd(...)`; items that do not fit are dropped on the ground for 200 ticks (`:73-82`) |
| `tostring` (string) | `:952` `[command,tostring](int $int0)(string)` | 4505 | none | `StringOps.ts:33-35`: `state.pushString(state.popInt().toString())` |
| `random` (number) | `:975` `[command,random](int $num)(int)` | 4604 | none | `NumberOps.ts:32-35`: `state.pushInt(JavaRandom.nextDouble() * n)` (truncated by `pushInt`) |
| `db_find` / `db_findnext` / `db_getfield` (db) | `:1035`, `:1028`, `:1029` | 7508, 7501, 7502 | `db_find` sets `find_db`, `db_findnext` requires it (`Engine-TS/src/engine/script/ScriptOpcodePointers.ts:1011-1016`) | `DbOps.ts:10-23` (`db_find`: pops key-type flag, key, packed `table:column`; stores `state.dbTable`, `dbRow = -1`, `dbRowQuery = DbTableIndex.find(...)`), `:82-95` (`db_findnext`: next row id or `-1`), `:97-...` (`db_getfield`: decodes table, column and tuple index from the packed column symbol, pushes the values) |
| `enum` (enum) | `:940` `[command,enum]` (comment shows the real shape) | 4400 | none | `EnumOps.ts:7-23`: pops `[inputType, outputType, enumId, key]`, checks the types match the enum's, pushes `enumType.values.get(key)` or the enum's default |
| `map_clock` (server) | `:9` `[command,map_clock]()(int)` | 1008 | none | `ServerOps.ts:16-18`: `state.pushInt(World.currentTick)` |
| `oc_param` (config) | `:787` `[command,oc_param](obj $obj, param $param)(any)` | 4209 | none | `ObjConfigOps.ts:15-25`: pops `[objId, paramId]`, validates both, pushes the param value from the obj config, as a string if the param is a string param, else an int, with the param's default if the config does not set it |

Two of these deserve the full chain.

97. **`db_find` end to end.** Source line (`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:19`): `db_find(woodcutting_trees:tree, loc_type);`.
    - *Symbol resolution.* `woodcutting_trees:tree` is a `dbcolumn` symbol that `Compiler.ts` created from the table definition (`Compiler.ts:293`, name `${table.debugname}:${columnName}`; `Content/scripts/skill_woodcutting/configs/trees.dbtable:1-3`). Its id is `((table.id & 0xffff) << 12) | ((column & 0x7f) << 4)` (`Compiler.ts:292`).
    - *Type check.* `DbFindCommandHandler.typeCheck` checks argument 0 is a `dbcolumn`, hints argument 1 with the column's type (`loc`, per the `.dbtable` line `column=tree,loc,LIST,INDEXED,REQUIRED`), so `loc_type` (a command returning the active loc's type) is accepted (`DbFindCommandHandler.ts:21-42`).
    - *Code generation.* `generateCode`: emit both arguments, then `PUSH_CONSTANT_INT <base type of the column's type>` (0 for int-like, 2 for string), then the command (`:44-61`). So the stack at the call is `[packedColumn, locTypeId, 0]`.
    - *Run time.* `db_find` pops the flag first (`== 2` means string), then the key, then the packed column, extracts the table id with `>> 12 & 0xffff`, remembers the table in `ScriptState.dbTable` and the list of matching row ids in `dbRowQuery`, and resets `dbRow` (`DbOps.ts:10-23`). `db_findnext` then steps through the list (`:82-95`), returning `-1` ("null") at the end, which is why Content writes `def_dbrow $data = db_findnext; if ($data = null) {...}` (`woodcut.rs2:20-24`).
    - *Pointers.* `db_find` sets `find_db`, `db_findnext` requires it (`ScriptOpcodePointers.ts:1011-1016`). The query state (`dbTable`, `dbRow`, `dbRowQuery`) is a field of the one `ScriptState` (`ScriptState.ts:114-117`), not of a gosub frame, so a proc called after `db_find` still sees (and can advance) the same query.

98. **`queue` end to end** (the idiom of section 4). `Content/scripts/tutorial/scripts/tutorial.rs2:137` `queue(tutorial_designed_character, 0, 0);`: `QueueCommandHandler` checks `(queue, int, int)` (`QueueCommandHandler.ts:16-26`); the name `tutorial_designed_character` resolves to the `[queue,tutorial_designed_character]` script (finding 50) and is pushed as its script id; opcode `QUEUE` = 2096 with the pointer rule "require `active_player`" (`ScriptOpcodePointers.ts:410-413`); handler `PlayerOps.ts:149-158` pops `[scriptId, delay, arg]`, looks the script up by id (`ScriptProvider.get`), throws if missing, and calls `state.activePlayer.enqueueScript(script, PlayerQueueType.NORMAL, delay, [arg])`. Later the queue processor runs the script protected (`Player.ts:910-911`).

### 5.4 Inferences (labelled), section 5

- *Inference N:* the engine's `ScriptOpcodeMap` doubles as the language's built-in vocabulary: a new command needs an enum entry, a map entry, a handler, a pointer rule (if it touches entities) and a signature in `engine.rs2`. Rests on findings 90-94. The checklist is mine; no change was made to test it.
- *Inference O:* because `db_findnext` and the `split_*` commands keep their state in the `ScriptState` (`dbTable`, `dbRowQuery`, `splitPages`; `ScriptState.ts:105-117`), they are per-script-execution and survive `gosub` but are not shared with other scripts. Rests on the fields and the handlers reading `state.*`.
- *Inference P:* counts in 96 are of *declarations* in `engine.rs2` and of *handler keys*; they say how big the vocabulary is, not how many are used by Content (not counted).

### 5.5 Not checked, section 5

- The bodies of most handlers: only the ones in the table were read, and several only partially (`obj_add` past `:50`, `db_getfield` past `:120`).
- `ScriptOpcodePointers` entries other than those quoted, and whether each entry's `require`/`set` is faithful to what the handler really needs.
- `Opcode`-level details of `CodeGeneratorContext`/`TypeCheckingContext` (the API handlers use).

---

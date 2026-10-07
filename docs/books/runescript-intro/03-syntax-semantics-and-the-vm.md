# Chapter 3: Syntax, types, bytecode and the VM that runs it

**Question answered:** What do statements, expressions, types and variables look like, how are they compiled to opcodes, and how does the VM execute them (hand-traced examples)?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

Everything in 3.1-3.5 is from `RuneScriptTS/src/antlr/*.g4`, `compiler/semantics/*`, `compiler/codegen/CodeGenerator.ts`; 3.6-3.7 trace two real scripts through code generation and the engine VM.

### 3.1 Findings: lexical structure

51. **Comments** are `// ... end of line` and `/* ... */`, both discarded. **Whitespace** is insignificant (newlines too). Source: `RuneScriptTS/src/antlr/RuneScriptLexer.g4:59-60`, `:75`.
    ```
    LINE_COMMENT    : '//' .*? ('\n' | EOF) -> channel(HIDDEN) ;
    BLOCK_COMMENT   : '/*' .*? '*/' -> channel(HIDDEN) ;
    ```
    Because a statement ends with `;` or a `}` and a script ends at the next `[`, a script's layout is free-form. Real code uses one statement per line. A block comment is used in e.g. `Content/scripts/skill_herblore/scripts/herblore.rs2:1` `/** Identify herb and give experience. */`.

52. **Literals** (lexer, `RuneScriptLexer.g4:49-56`):
    - decimal `-?[0-9]+`, hex `0x...`, binary `0b...` (the checker accepts hex up to `0xffffffff` for `int`, `TypeChecking.ts:1126-1134`; real use: `Content/scripts/_test/scripts/cheats/cheat_music.rs2:18` `%musicmulti_1 = 0xFFFFFFFF;`);
    - coordinates `level_mx_mz_lx_lz` (five underscore-separated numbers), e.g. `0_50_52_44_54` (`Content/scripts/ladders+stairs/scripts/ladders.rs2:126`); the 3-number form `a_b_c` is a *mapzone* literal that is only allowed as a script subject (it is in `identifier`, not in `literal`: `RuneScriptParser.g4:178-187` vs `:216-227`);
    - `true` / `false`; `null`; a character literal `'x'` (with `\\` and `\'` escapes).
    - **a negative number is one token**: `INTEGER_LITERAL : '-'? Digit+`. So `5-3` would lex as `5` then `-3` (inference from the lexer rule; not run). Content writes arithmetic with spaces (`calc($count - 1)`, `woodcut.rs2:210`).
    - A bare run of digits is `INTEGER_LITERAL` not `IDENTIFIER` (`INTEGER_LITERAL` is defined first at `RuneScriptLexer.g4:49`, `IDENTIFIER` at `RuneScriptLexer.g4:74`; ANTLR prefers the earlier rule on a tie, which is ANTLR's documented behaviour, not something verified in this repo). The consequence the type checker handles: when the *expected* type is not a literal type, an integer literal is resolved as the **name** of a config of that type (`TypeChecking.ts:1105-1108`, `resolveSymbol(integerLiteral, integerLiteral.value, hint)`).

53. **Strings** are in double quotes. Inside a string the lexer switches to a *string mode* (`RuneScriptLexer.g4:73`, `:78-87`):
    - plain text, with escapes `\\`, `\"`, `\<`;
    - `<br>`, `<col=...>`, `<str>`, `<shad>`, `<u>`, `<img=...>`, `<gt>`, `<lt>` and closing forms are recognised as *tags* and kept as literal text (`:82-84`, tag names at `:95-104`);
    - `<p,name>` is a separate token, kept as literal text (`RuneScriptLexer.g4:85`, `AstBuilder.ts:349-350` makes a `PTagStringPart`, a subclass of the plain text part, `StringPart.ts:37`);
    - any other `<` starts an **interpolated expression** that ends at the matching `>`: `STRING_EXPR_START : '<' -> pushMode(DEFAULT_MODE)` (`RuneScriptLexer.g4:86`) and the `GT` rule switches back when `depth > 0` (`RuneScriptLexer.g4:31`).
    The code generator emits one `PUSH_CONSTANT_STRING` per text part, the code of each interpolated expression, and a final `JOIN_STRING n` (`CodeGenerator.ts:765-784`, `BinaryScriptWriter.ts:291-293`). Type check: each interpolated expression must be a `string` (`TypeChecking.ts:1248-1259`), hence the `tostring(...)` in `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:37`
    ```
    mes("You need a Woodcutting level of <tostring($level)> to chop down this tree.");
    ```
    The `<p,happy>` prefix is not interpreted by the compiler: the engine's `split_init` command reads it at runtime, looks the name up as a `mesanim` and strips it. Source: `Engine-TS/src/engine/script/handlers/StringOps.ts:76-96`, esp. `:83-85`
    ```ts
    if (text.startsWith('<p,') && text.indexOf('>') !== -1) {
        const mesanim = text.substring(3, text.indexOf('>'));
        state.splitMesanim = MesanimType.getId(mesanim);
    ```
    and the caller `Content/scripts/interface_chat/scripts/chat.rs2:323-324` `[proc,chatnpc](string $string)` then `split_init($string, 380, 4, q8_full);`. A string whose escape/tag content has no interpolation is parsed as a plain `stringLiteral`; one with tags or `<expr>` as a `joinedString` (`RuneScriptParser.g4:178-213`).

54. **Keywords**: `if else while case default return calc`, and the prefixes `def_<type>`, `switch_<type>`, `<type>array`. Source: `RuneScriptLexer.g4:37-46`. The sigils: `$` local, `%` game variable (`.%` secondary), `^` constant, `~` proc call, `@` label jump, `.` leading a command name for the secondary pointer. Source: `RuneScriptLexer.g4:21-30`, `RuneScriptParser.g4:139-176`.

### 3.2 Findings: statements

55. The statement forms (grammar `RuneScriptParser.g4:34-97`), each with a real example. Examples show the exact source text.

    | Form | Grammar | Real example |
    |---|---|---|
    | block | `{ statement* }` (`:47-49`) | the bodies below |
    | if / else | `if (cond) stmt [else stmt]` (`:55-57`); any statement, braces optional | `Content/scripts/areas/area_lumbridge/scripts/hans.rs2:20-31` (`if ... else if ... else if`); braceless: `Content/scripts/drop tables/scripts/grip.rs2:5-6` `if(p_finduid(uid) = true) %heroquest = ^hero_phoenix_killed_grip;` / `else queue(grip_queue_progress, 0, 0);` |
    | while | `while (cond) stmt` (`:59-61`) | `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:202-212` |
    | switch | `switch_<type> (expr) { case k1, k2 : stmt* ... case default : stmt* }` (`:63-69`) | `Content/scripts/npc/scripts/man.rs2:3-8` and `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:6-14` |
    | declaration | `def_<type> $name [= expr];` (`:71-73`) | `woodcut.rs2:119` `def_int $tree_chance_low;` and `:20` `def_dbrow $data = db_findnext;` |
    | array declaration | `def_<type> $name(size);` (`:75-77`) | none in Content (count of `def_*array`: 0; the VM does not implement arrays, finding 72) |
    | assignment | `lhs [, lhs]* = expr [, expr]*;` (`:79-81`), lhs is `$local`, `$arr(i)`, `%var`, `.%var` | `woodcut.rs2:121` `$tree_chance_low, $tree_chance_high = ~woodcutting_successchance($data, $axe);` |
    | expression statement | `expr;` (`:83-85`) | `woodcut.rs2:78` `p_oploc(3);`, `Content/scripts/login_logout/login.rs2:3` `cam_reset;` |
    | return | `return;` or `return(expr, ...);` (`:51-53`); **the parentheses are part of the syntax** | `woodcut.rs2:208` `return($tree_chance_low, $tree_chance_high);` |
    | empty | `;` (`:87-89`) | - |

    Notes on the table:
    - There is no `for`, `do`, `break` or `continue`, and no `else if` keyword (it is `else` followed by an `if` statement). Source: absence from the grammar `:34-45`.
    - `return` without parentheses and without a value is the only value-less form; `return 5;` does not parse (the grammar requires `(`). Content never writes a bare `return 5;` (`grep` found only `return(...)` and `return;`).
    - A script that ends in a bare jump is common: `woodcut.rs2:1` `[oploc1,_tree] @attempt_cut_tree;`.
    - `woodcut.rs2:213` `return(null, null);` returns two `null`s for the declared `(int, int)` return list; `null` takes its type from the expected return type (`TypeChecking.ts:1171-1180`).

56. **Conditions** are a separate grammar rule from expressions. Source: `RuneScriptParser.g4:117-124`
    ```
    condition
        : LPAREN condition RPAREN                                                   # ConditionParenthesizedExpression
        | condition op=(LT | GT | LTE | GTE) condition                              # ConditionBinaryExpression
        | condition op=(EQ | EXCL) condition                                        # ConditionBinaryExpression
        | condition op=AND condition                                                # ConditionBinaryExpression
        | condition op=OR condition                                                 # ConditionBinaryExpression
    ```
    - Equal is `=`, not-equal is `!`, and-or are single characters `&` and `|` (there is no `==`, `!=`, `&&`, `||`, and no unary `!`).
    - The type checker requires every condition to be built from these binary operators: a bare boolean such as `if ($flag)` is rejected with "`Conditions are only allowed to be binary expressions.`" (`TypeChecking.ts:258-276`, message `DiagnosticMessage.ts:56`). So tests of a boolean return value are written `= true`/`= false`, as in `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:27` `if (oc_members($product) = true) {`.
    - Operand typing, `TypeChecking.ts:543-619`: `&` and `|` need both sides `boolean`; `<`, `>`, `<=`, `>=` need `int` or `long`; `=` and `!` need the two sides to be the same type, **except two strings may not be compared at all** (`:612-614`, binary-operator error). `<`...`!` cannot be nested directly inside each other (`:573-576`, "Condition is not valid.").
    - **Precedence.** In an ANTLR left-recursive rule an earlier alternative binds tighter. By that rule (an ANTLR property, not verified by running the generated parser): relational `< > <= >=` bind tighter than `= !`, which bind tighter than `&`, which binds tighter than `|`. Supporting evidence from Content: `woodcut.rs2:56` `if ($level > 0 & ~woodcutting_axe_checker(true) = null) {` only type-checks as `($level > 0) & (~...(true) = null)`, i.e. relational and equality tighter than `&`; and `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:118-119` wraps `|` groups in parentheses before `&`.
    - **Short-circuit evaluation.** `&` and `|` compile to separate blocks with conditional branches, so the right operand is not evaluated when the left decides. Source: `CodeGenerator.ts:312-323`
      ```ts
      const nextBlockLabel = condition.operator.text === CodeGenerator.LOGICAL_OR ? this.labelGenerator.generate('condition_or') : this.labelGenerator.generate('condition_and');
      ```

57. **Arithmetic exists only inside `calc(...)`.** The `arithmetic` rule (`+ - * / % & |` over expressions, with parentheses; `* / %` tighter than `+ -`, tighter than `&`, tighter than `|` by the same ANTLR rule) is reachable only through `calc` (`RuneScriptParser.g4:126-137`). Operands and result must be `int` or `long` (`TypeChecking.ts:692-712`, `:645-659`). The generator emits `ADD`/`SUB`/`MULTIPLY`/`DIVIDE`/`MODULO`/`AND`/`OR` opcodes (`CodeGenerator.ts:547-573`, mapping at `:891-899`, writer `BinaryScriptWriter.ts:335-365`). Content mixes `calc(...)` with the named commands `add`, `sub`, `min`, `scale`, ...: e.g. `woodcut.rs2:59` `%action_delay = calc(map_clock + 3);` and `woodcut.rs2:127` `$respawnrate = add(120, random(80));`. Both compile to the same ADD opcode (4600) for `+`/`add` (`ServerScriptOpcode.ts:48`; `ScriptOpcode.ADD` is also in the engine's command table, so `add(a, b)` as a *command* compiles to a command call with the same id; not diffed in bytecode).

58. **Calls** (grammar `RuneScriptParser.g4:139-144`):
    - `name(args)` calls a **command**; a command with no parameters may be written bare (`name`), e.g. `login.rs2:3` `cam_reset;` and `woodcut.rs2:55` `map_clock`. Source for bare commands: `TypeChecking.ts:1262-1286`, `CodeGenerator.ts:800-808`.
    - `name*(args)(args2)` is the "star" form used by `queue*`-style commands (two argument lists).
    - `~name(args)` / `~name` calls a **proc** (a script of trigger `proc`), may return values; the parentheses are optional when there are no arguments: `Content/scripts/tutorial/scripts/tutorial.rs2:146` `~tutorial_step_player_controls_left_click;`.
    - `@name(args)` / `@name` **jumps** to a `label`; labels are declared to return `nothing` (`ServerScriptCompiler.ts:76`, `MetaType.Nothing`), so a jump cannot be used as an expression, and control never comes back (VM, finding 70).
    - Argument type-checking against the callee's declared signature happens in `typeCheckArguments` (`TypeChecking.ts:871-912`); an argument list given to something that takes none is "`'~%s' is expected to have no arguments but has '%s'.`" (`DiagnosticMessage.ts:65-69`).
    - Because a call to a proc/command/label is just a name, the **kind of thing a name refers to is decided by the sigil, not by lookup order**: `~x` is always a proc named `x`; `@x` always a label; bare `x(...)` always a command.

59. **Bare identifiers are config references, resolved by the expected type ("type hint").** This is the central trick of the language: `inv_add(inv, bronze_axe, 1)` has three arguments `inv $inv`, `namedobj $obj`, `int $count` (`Content/scripts/engine.rs2:825`); the type checker visits each argument with the *parameter's type as a hint*, and `resolveSymbol` looks the name up among all symbols with that name, preferring the one whose type matches the hint. Source: `TypeChecking.ts:1288-1336`, esp. `:1293-1313` (loop over `this.table.findAllIter(name)`, `if (!hint || this.typeManager.check(hint, tempType))`). Consequences:
    - the same word can mean different things in different places (`inv` is an inventory in an `inv` position, `hans.rs2:4` `inv_total(inv, trail_clue_hard_riddle012)`; `coord` is a command returning the player's coordinate in an expression position, `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:106` `npc_find(coord, $owner, 5, 0)`);
    - an identifier that matches no symbol, when a `string` is expected, is treated as **plain text**: `resolveSymbol(identifier, name, hint, allowToString=true)` returns `null` and sets the node type to `string` if `hint == STRING` and the found symbol (if any) is not a command (`TypeChecking.ts:1316-1319`, `:1411-1413`). Otherwise: "`'%s' could not be resolved to a symbol.`" (`:1320-1325`).
    - a string literal can be used to name a symbol that is not a legal identifier, when the expected type is a non-string, non-literal type (`TypeChecking.ts:1182-1207`).

60. **Constants** `^name` are text substituted at compile time *and re-parsed against the expected type*. `visitConstantVariableExpression` looks up the constant's string value, and if the hint is `string` (or `graphic`) wraps it as a string literal, otherwise parses it with the same lexer/parser as an *expression* (`parseConstantExpressionTree` runs `parser.singleExpression()`), applies the hint, and requires the result to be a constant expression. Source: `TypeChecking.ts:979-1089`, esp. `:1026-1032`, `:1046-1050`. So `^true = 1` is an integer literal in an int position and a boolean in a boolean position (`TypeChecking.ts:1099-1102`); `^gnome_batta = 3` is the int 3; a constant may contain a config name (`^x = bronze_axe`) because the text is parsed as an expression. Cyclic constants are an error (`:1007-1017`, "Cyclic constant references are not permitted"). Constants are also substituted textually inside config values by the packer (finding 31).

61. **Game variables** `%name` / `.%name`. The type checker finds a symbol with that name whose type is a game-var type (varp / varbit / varn / vars) in the root table (`TypeChecking.ts:959-977`; variable names are therefore in one global namespace, enforced at pack time, finding 34). Reads compile to `PUSH_VARP`/`PUSH_VARBIT`/`PUSH_VARN`/`PUSH_VARS`, writes to the `POP_` forms, with the operand `id`, plus `1 << 16` for the dot (secondary) form (`BinaryScriptWriter.ts:156-202`, esp. `:172-175`). Example of the dot form: `Content/scripts/skill_combat/scripts/pvp/pk_skull.rs2:20-22`
    ```
    .%pk_predator3 = .%pk_predator2;
    .%pk_predator2 = .%pk_predator1;
    .%pk_predator1 = uid;
    ```
    the target of those writes is the *secondary* player pointer (section 4).

62. **Locals** `$name`: parameters and `def_` declarations. Facts:
    - a local must be declared before use ("`'$%s' cannot be resolved to a local variable.`", `TypeChecking.ts:926-930`);
    - a block `{ }` and each `case` body open a nested scope (`TypeChecking.ts:189-194`, `:338-341`), and `SymbolTable.insert` refuses a name already present in **any enclosing** scope (`RuneScriptTS/src/compiler/symbol/SymbolTable.ts:30-40`, loops `current = current.parent`), so a local cannot shadow an outer local or a parameter ("`'$%s' is already defined.`"); two sibling blocks may reuse a name;
    - `topLevelDefOnly` (declarations only at the top of a script) is an optional feature flag, default off, so `def_` inside `while` is legal and is used: `woodcut.rs2:203-205`. Source: `StrictFeatureLevel.ts:83-89`, `TypeChecking.ts:386-389`;
    - `def_x $v;` without initializer assigns the type's **default value**: `0` for `int`/`boolean`, `''` for `string`, `-1` for the other int-based types (`CodeGenerator.ts:421-433`, values from `PrimitiveType.ts:41-52` and `ScriptVarType.ts`); a declaration inside a loop re-executes the push/pop each time round;
    - local indices are assigned **per base type**: `getVariableId` counts int-like locals and string locals separately, in declaration order, parameters first (`RuneScriptTS/src/compiler/writer/BaseScriptWriter.ts:276-282`). The engine therefore has two local arrays, `intLocals` and `stringLocals` (`ScriptState.ts:56-57`).

### 3.3 Findings: the type table

63. Type names appear in `def_<type>`, `switch_<type>`, in parameter and return lists, and in the `command` signatures. They come from three sources.

    **Primitive types** (`RuneScriptTS/src/compiler/type/PrimitiveType.ts:41-52`), `code` is the one-character type code written into bytecode where types are encoded (e.g. `queue*` argument strings, `debugproc` parameter lists):

    | name | code | base | default | notes |
    |---|---|---|---|---|
    | `int` | `i` | int | 0 | |
    | `boolean` | `1` | int | 0 | `true`/`false`; represented as 1/0 |
    | `coord` | `c` | int | -1 | packed coordinate |
    | `string` | `s` | string | `''` | not allowed in `switch`, not in arrays (`:44-47`) |
    | `char` | `z` | int | -1 | |
    | `long` | `Ï` | long | 0n | `ServerScriptCompiler.ts:68-71` forbids declaring locals of this type; `BinaryScriptWriter.ts:99-101` throws "Not supported." for long constants |
    | `mapzone` | `0` | int | -1 | only as a script subject |

    **Script var types** (`RuneScriptTS/src/runescript/type/ScriptVarType.ts:25-65`), 41 of them, all int-based with default `-1`. Name (code): `seq`(A) `locshape`(H) `component`(I) `idkit`(K) `midi`(M) `npc_mode`(N) `namedobj`(O) `synth`(P) `area`(R) `stat`(S) `npc_stat`(T) `writeinv`(V) `wma`(`` ` ``) `graphic`(d) `fontmetrics`(f) `enum`(g) `hunt`(h) `jingle`(j) `loc`(l) `model`(m) `npc`(n) `obj`(o) `player_uid`(p) `spotanim`(t) `npc_uid`(u) `inv`(v) `texture`(x) `category`(y) `mapelement`(µ) `hitmark`(×) `struct`(J) `dbrow`(Ð) `interface`(a) `toplevelinterface`(F) `overlayinterface`(L) `movespeed`(Ý) `entityoverlay`(-) `dbtable`(Ø) `stringvector`(¸) `mesanim`(Á) `verifyobj`(®). All are registered by name in `registerScriptVarTypes` (`ServerScriptCompiler.ts:202-209`), minus any disabled by feature flags (enum, struct, dbrow/dbtable). Real `def_` usage in Content (a one-off count of `def_<type>` words): `int` 2,764; `coord` 361; `obj` 289; `string` 228; `namedobj` 142; `boolean` 132; `dbrow` 102; `struct` 37; `locshape` 31; `loc` 30; `seq` 25; `npc` 20; `stat` 15; `synth` 12; `component`, `category` 10 each; `spotanim` 7; and a few of `npc_uid`, `interface`, `player_uid`, `enum`, `npc_stat`, `midi`, `inv`.

    **Wrapped / meta types** (never written by users except where noted): `varp<T>`, `varbit<T>`, `varn<T>`, `vars<T>` (`GameVarType`, cannot be declared, switched on, or passed as parameters, `compiler/type/wrapped/GameVarType.ts:13-27`); `param<T>` (`ParamType.ts`), `dbcolumn<T>` (`DbColumnType.ts`), `<type>array` (`ArrayType`); and `MetaType`: `any`, `nothing`, `error`, `unit`, `type<T>`, script types such as `proc`/`label`/`queue`/`timer` (`compiler/type/MetaType.ts:41-80`). `unit` is "no values", `nothing` is "never returns", `error` is compatible with everything so one mistake does not cascade.

64. **Assignability.** `TypeManager.check(left, right)` is a list of checker functions, any of which may accept. The base set: `any` accepts anything; `error` accepts/is accepted by anything; identical types; matching script types; wrapped types with equal inner types; tuples element by element; and finally equal `representation` strings. Source: `RuneScriptTS/src/compiler/ScriptCompiler.ts:129-190`. On top, the server compiler adds exactly one rule: `namedobj` may be assigned to `obj` (not the reverse). Source: `RuneScriptTS/src/runescript/ServerScriptCompiler.ts:79`
    ```ts
    this.types.addTypeChecker((left, right) => left === ScriptVarType.OBJ && right === ScriptVarType.NAMEDOBJ);
    ```
    Practically: `int` and `boolean` and `coord` and `npc` etc. are all different types even though they share the int stack (assigning an `int` to a `boolean` variable is a type error unless the *literal* `0`/`1` is hinted into a boolean, `TypeChecking.ts:1099-1103`). Mismatch message: "`Type mismatch: '%s' was given but '%s' was expected.`" (`DiagnosticMessage.ts:25`).

### 3.4 Findings: the compiler pipeline for a single statement

65. **Registration pass (`ScriptRegistration`)** declares every script symbol in the root table *before* any body is checked, which is why scripts can call procs and labels defined later in the same or another file (`ScriptCompiler.ts:346-351`, then `:363-369`). **Type-check pass (`TypeChecking`)** then walks each body with a local symbol table per script/block, propagates type hints downward, resolves names to symbols, and sets each expression's `type`. **Code-generation pass (`CodeGenerator`)** converts the typed tree into **blocks of instructions** with labels (`Block`, `Label`, `SwitchTable`), one `RuneScript` per script. Source: `CodeGenerator.ts:172-199` (`visitScript`). Every script gets an `entry` block (`:185`), and the generator appends **default returns** at the end (`generateDefaultReturns`, `:212-231`): for each declared return type it pushes `0` (`int`), `-1` (other int-based types), `''` (`string`), then `RETURN`.
    This means *there is no "missing return" error*: a proc declared `(int)` that falls off the end returns `0`. Evidence: the diagnostics list has no such message (`DiagnosticMessage.ts:1-110`), and `generateDefaultReturns` exists.

66. **Statement lowering** (all `CodeGenerator.ts`):
    - `if (c) A [else B]` -> condition code that branches to `if_true` or (`if_else` / `if_end`); the `if_true` block is `A` followed by `BRANCH if_end`; then `B` and `BRANCH if_end` (`:243-268`).
    - `while (c) S` -> `while_start` block (condition), `while_body` (`S` then `BRANCH while_start`), `while_end` (`:270-286`).
    - condition `l op r` -> `l`, `r`, then `BRANCH_<op> true_label`, then `BRANCH false_label` (`:288-311`); the branch opcode is chosen by the operands' base type. For **strings** the table has only `ObjBranchEquals`/`ObjBranchNot` (`:862-865`, `:884`), but `BinaryScriptWriter.writeBranch` has no case for those: its `switch` ends in a `default` that throws `Unsupported opcode` (`BinaryScriptWriter.ts:254-281`, the throw is at `:280`). That is consistent with the type checker rejecting string-string comparisons earlier (finding 56).
    - `switch_T (e) { cases }` -> `e`, `SWITCH tableId`, then `BRANCH default-or-end` (omitted if the first case is `default`), then one block per case ending in `BRANCH switch_end`. There is no fall-through: every case block ends with a branch to `switch_end` (`:331-385`, esp. `:380` `this.instruction(Opcode.Branch, switchEnd);`). Case keys must be constant expressions (`TypeChecking.ts:329-332`, "Switch case value is not a constant expression."): literals, `^constants`, or config names.
    - `a, b = e1, e2` -> evaluate all right-hand sides left to right, then **pop in reverse** into the variables (`:448-485`); a single call returning two values (`$a, $b = ~f()`) works the same way because both values are on the stack.
    - expression statement -> the expression, then one `POP_INT_DISCARD` / `POP_STRING_DISCARD` for every value it leaves (`:487-503`); an expression statement without side effects is a **warning** "`Value is discarded.`" (`TypeChecking.ts:497-505`), and warnings do not stop the build (`Diagnostics.ts` counts only `ERROR` and `SYNTAX_ERROR` as errors).
    - `~p(args)` -> args, then `GOSUB_WITH_PARAMS <script id>`; `@l(args)` -> args, then `JUMP_WITH_PARAMS <script id>`; `name(args)` -> args, then the command opcode with a 0/1 "secondary" operand (`:580-636`, writer `BinaryScriptWriter.ts:312-329`).

### 3.5 Findings: operand encodings in the bytecode

67. The writer maps each IR instruction to a VM opcode (`RuneScriptTS/src/runescript/writer/BinaryScriptWriter.ts`):
    - integer constants -> `PUSH_CONSTANT_INT n` (`:91-93`); strings -> `PUSH_CONSTANT_STRING` (`:95-97`);
    - a **symbol** used as a value (a config name, a script id) -> `PUSH_CONSTANT_INT <id>`, where the id comes from the id provider: for a *type* used as an argument (e.g. `int` in `enum(int, stat, stats, k)`) the pushed value is the type's one-character code as a number (`:103-120`, `:108-112`);
    - locals -> `PUSH_INT_LOCAL`/`POP_INT_LOCAL`/`PUSH_STRING_LOCAL`/`POP_STRING_LOCAL` with the per-type index (`:122-154`);
    - game variables -> `PUSH_VARP`/`POP_VARP`/`PUSH_VARBIT`/... with `id (+ 1<<16 for the dot form)` (`:156-202`);
    - branches -> `BRANCH`, `BRANCH_NOT`, `BRANCH_EQUALS`, `BRANCH_LESS_THAN`, `BRANCH_GREATER_THAN`, `..._OR_EQUALS` with a **relative** operand `targetIndex - currentIndex - 1` (`:254-289`, `:288`), where indices count instructions, not bytes;
    - `SWITCH tableId` with the table written separately in the trailer: for each key, `key` and relative jump (`:217-237`; `BinaryScriptWriterContext.ts:103-121`);
    - `JOIN_STRING n` (`:291`), `POP_INT_DISCARD` / `POP_STRING_DISCARD` (`:295-310`), `GOSUB_WITH_PARAMS id` (`:312-315`), `JUMP_WITH_PARAMS id` (`:317-320`), `RETURN` (`:331-333`), arithmetic opcodes (`:335-365`);
    - commands -> `instructionRaw(opcode, secondary)`: a 2-byte opcode and a 1-byte flag, 1 if the command's name starts with `.` (`:322-329`).

    Opcode numbers fall in bands: core language ops 0-46; number ops 4600+ (the compiler's own table has only the seven math ops); everything else is a *command* numbered by the engine's table (section 5). Source: `RuneScriptTS/src/runescript/ServerScriptOpcode.ts:12-54` and `Engine-TS/src/engine/script/ScriptOpcode.ts:1-40`.

68. **What the VM holds.** One `ScriptState` per running script: `script` (the current `ScriptFile`), `pc`, an `opcount`, a gosub frame stack `frames`/`fp`, a parallel `debugFrames`/`debugFp` for backtraces, an **int stack** (`intStack`, `isp`) and a **string stack** (`stringStack`, `ssp`), two local arrays (`intLocals`, `stringLocals`), a bit set of **pointers** (`pointers`), the primary entity `self`, and the active-entity fields `_activePlayer`, `_activePlayer2`, `_activeNpc`, `_activeNpc2`, `_activeLoc`, `_activeLoc2`, `_activeObj`, `_activeObj2`. Source: `Engine-TS/src/engine/script/ScriptState.ts:35-103`. Pushing an int stores `toInt32(value)` (`ScriptState.ts:304-306`); popping an empty/zero slot gives 0 (`:288-294`).

69. **`gosub` (a proc call).** The compiler's `~name(args)` becomes `GOSUB_WITH_PARAMS <script id>` (finding 66). The handler refuses deeper than 50 nested calls, looks the callee up by id, saves the caller (`script`, `pc`, `intLocals`, `stringLocals`) as a frame, and starts the callee at `pc = -1` with its arguments popped from the stacks into its first locals. `RETURN` with no saved frame ends the script (`FINISHED`), otherwise restores the caller's script, pc and locals. Return values are not copied anywhere: they are already on the stacks. Source: `CoreOps.ts:206-212`, `:236-245`; `ScriptState.ts:324-347`, `:359-376`. There is also a stack-argument form `GOSUB` (opcode 22, handler `CoreOps.ts:225-234`) which pops the callee id from the stack; Content reaches it through the *command* `gosub(proc)` declared at `Content/scripts/engine.rs2:3` (`[command,gosub](proc $proc)`), e.g. `Content/scripts/drop tables/scripts/grip.rs2:2` `gosub(npc_death);`, where `npc_death` is resolved against the parameter type `proc` and pushed as a script id (finding 50). Its operand is 1 byte (the command form) while `GOSUB_WITH_PARAMS` has a 4-byte operand (`ScriptFile.ts:19-34` excludes `GOSUB`/`JUMP` from the large-operand set).

70. **`jump` (a label call, `@name`).** `JUMP_WITH_PARAMS` calls `state.gotoFrame(label)`: it records a debug frame, **discards all gosub frames** (`fp = 0`, `frames.length = 0`) and starts the label script with its arguments. So `@label;` *replaces* the current script (and anything it was called from); when the label script returns, the whole stack unwinds as if the original script had returned. Source: `CoreOps.ts:247-261`, `ScriptState.ts:349-357`. This is why `[oploc1,_tree] @attempt_cut_tree;` (`woodcut.rs2:1`) can be a one-liner: the label runs as the script.

71. **Commands.** Any opcode that is not one of the core language ops is looked up in `ScriptRunner.HANDLERS` and run by a handler `(state) => void` that pops its arguments from the state and pushes its results. A command's second byte-operand is the "secondary" flag; handlers read the active entity through `state.activePlayer` / `activeNpc` / `activeLoc` / `activeObj`, which pick the primary or secondary field by `state.intOperand` (`ScriptState.ts:185-191`, `:217-223`, `:240-246`, `:260-266`). That is the whole mechanism behind `.mes(...)` vs `mes(...)`, `.npc_say` vs `npc_say`. Example: `Engine-TS/src/engine/script/handlers/PlayerOps.ts:343-347`
    ```ts
    [ScriptOpcode.MES]: state => {
        const message = state.popString();
    ```
    The core-language opcodes (push/pop, branches, switch, gosub, return, join) are the handlers in `CoreOps.ts`, which has 33 handler keys; `NumberOps.ts` (31 keys) implements the arithmetic commands (`ScriptRunner.ts:38-56`).

72. **Arrays are not implemented in the engine.** The three array opcodes throw. Source: `CoreOps.ts:263-273`
    ```ts
    [ScriptOpcode.DEFINE_ARRAY]: () => {
        throw new Error('unimplemented');
    },
    ```
    (and the same for `PUSH_ARRAY_INT`, `POP_ARRAY_INT`.) The compiler accepts `def_<type> $a(n);` and indexing (`TypeChecking.ts:423-472`, `:917-957`), and `grep` finds no `def_*array` or array declaration in Content, so the feature is present in the compiler and absent at runtime and in content.

### 3.6 Worked example 1: a proc, hand-compiled and then run

The script (`Content/scripts/general/scripts/player_count.rs2:1-4`):
```
[proc,scale_by_playercount](int $base)(int)
//not sure if it caps at 2k player count or not
def_int $playercount = min(playercount, 2000);
return (scale(sub(4000, $playercount), 4000, $base));
```
Declarations used (from `Content/scripts/engine.rs2`): `playercount` at `:60` `[command,playercount]()(int)`, `min` at `:999` `[command,min](int $a, int $b)(int)`, `sub` at `:969` `[command,sub](int $n1, int $n2)(int)`, `scale` at `:1001` `[command,scale](int $int0, int $int1, int $int2)(int)`.
Opcode numbers (engine `ScriptOpcode` enum order; values computed by counting the enum members from the explicit anchors `COORDX = 1000` etc., `ScriptOpcode.ts:41-65` for the 1000 band and `:400-432` for the 4600 band): `PLAYERCOUNT` 1018, `MIN` 4616, `SUB` 4601, `SCALE` 4618. The 4601 value agrees with the compiler's own `SUB = new ServerScriptOpcode(4601)` (`ServerScriptOpcode.ts:49`), a cross-check that the counting is right.

73. **Hand-trace of code generation** (read from `CodeGenerator.ts`; the compiler was not run):

    | idx | instruction | operand | source construct | bytes (hex) |
    |---|---|---|---|---|
    | 0 | `COMMAND` | opcode 1018, secondary 0 | `playercount` (bare identifier resolved to the command, `CodeGenerator.ts:800-808`; the engine handler `ServerOps.ts:126-128` pushes `World.getTotalPlayers()`) | `03 FA 00` |
    | 1 | `PUSH_CONSTANT_INT` | 2000 | `2000` | `00 00 00 00 07 D0` |
    | 2 | `COMMAND` | 4616, 0 | `min(...)` | `12 08 00` |
    | 3 | `POP_INT_LOCAL` | 1 | `def_int $playercount =` (`CodeGenerator.ts:410-435`) | `00 22 00 00 00 01` |
    | 4 | `PUSH_CONSTANT_INT` | 4000 | `4000` inside `sub` | `00 00 00 00 0F A0` |
    | 5 | `PUSH_INT_LOCAL` | 1 | `$playercount` | `00 21 00 00 00 01` |
    | 6 | `COMMAND` | 4601, 0 | `sub(...)` | `11 F9 00` |
    | 7 | `PUSH_CONSTANT_INT` | 4000 | second argument of `scale` | `00 00 00 00 0F A0` |
    | 8 | `PUSH_INT_LOCAL` | 0 | `$base` (the parameter is int local 0) | `00 21 00 00 00 00` |
    | 9 | `COMMAND` | 4618, 0 | `scale(...)` | `12 0A 00` |
    | 10 | `RETURN` | 0 | the `return` statement (`CodeGenerator.ts:237-241`) | `00 15 00` |
    | 11 | `PUSH_CONSTANT_INT` | 0 | default return value for `(int)` (`CodeGenerator.ts:218-219`) | `00 00 00 00 00 00` |
    | 12 | `RETURN` | 0 | default return | `00 15 00` |

    Opcode ids used above: `PUSH_CONSTANT_INT` 0 (`ServerScriptOpcode.ts:13`), `RETURN` 21 (`:26`), `PUSH_INT_LOCAL` 33 = 0x21 (`:34`), `POP_INT_LOCAL` 34 = 0x22 (`:35`). Large-operand opcodes (4-byte operand) are all but `RETURN`, `GOSUB`, `JUMP`, `POP_*_DISCARD` and everything above 100 (commands use a 1-byte operand): `ScriptFile.ts:19-34`.
    The header would be: `[proc,scale_by_playercount]\0`, the source path `\0`, lookup key `FF FF FF FF` (name-mode), parameter-type byte `00`, the line table, then the 13 instructions above (total 3+6+3+6+6+6+3+6+6+3+3+6+3 = 60 bytes), then the trailer: instruction count 13, int locals 2, string locals 0, int args 1, string args 0, switch tables 0 (`BinaryScriptWriterContext.ts:159-176`). Int locals = 2 because both the parameter and `$playercount` are int-based (`getLocalCount`, `BaseScriptWriter.ts:269-271`).

74. **Running it** on the engine VM, called as `~scale_by_playercount(120)` with 3 players online (the caller is `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:136`, `$respawnrate = ~scale_by_playercount($respawnrate);`). The caller's code pushes `$respawnrate` (`PUSH_INT_LOCAL`), executes `GOSUB_WITH_PARAMS <id>`, then `POP_INT_LOCAL`. `GOSUB_WITH_PARAMS` (`Engine-TS/src/engine/script/handlers/CoreOps.ts:236-245`) checks `state.fp >= 50` ("stack overflow"), fetches the callee with `ScriptProvider.get(operand)` and calls `state.gosubFrame(proc)` (`ScriptState.ts:334-347`), which saves `{script, pc, intLocals, stringLocals}` on `frames` and then `setupNewScript` (`:359-376`): allocate `intLocals` of the callee's size filled with 0, pop `intArgCount` ints off the int stack *into the locals in reverse* (so the last argument pushed becomes the last parameter), set `pc = -1`. Then:

    | step | executed | int stack after | locals after |
    |---|---|---|---|
    | caller pushes arg | `PUSH_INT_LOCAL` | `[120]` | |
    | gosub | `GOSUB_WITH_PARAMS` | `[]` | `[120, 0]` (local0=`$base`) |
    | 0 | `COMMAND 1018` (`ServerOps.ts:126`, pushes the player count) | `[3]` | |
    | 1 | `PUSH_CONSTANT_INT 2000` | `[3, 2000]` | |
    | 2 | `COMMAND 4616` (`NumberOps.ts:114` `Math.min(a, b)`) | `[3]` | |
    | 3 | `POP_INT_LOCAL 1` | `[]` | `[120, 3]` |
    | 4-5 | push 4000, push local1 | `[4000, 3]` | |
    | 6 | `COMMAND 4601` (`NumberOps.ts:14` `a - b`) | `[3997]` | |
    | 7-8 | push 4000, push local0 | `[3997, 4000, 120]` | |
    | 9 | `COMMAND 4618` (`NumberOps.ts:124-127`: pops `[a, b, c]`, pushes `(a * c) / b`) | `[119]` | |
    | 10 | `RETURN` (`CoreOps.ts:206-212`: `fp` is 1, so `popFrame`, `ScriptState.ts:324-332`) | `[119]` | caller's locals restored |
    | caller | `POP_INT_LOCAL k` | `[]` | `$respawnrate = 119` |

    The division is `3997 * 120 / 4000 = 119.91`, and `pushInt` truncates with `toInt32(value)` = `num | 0` (`ScriptState.ts:304-306`, `Engine-TS/src/util/Numbers.ts:7-9`), giving 119. (Arithmetic by hand from the quoted handlers; not run.) Return values simply stay on the stack; the caller's next instruction consumes them. A proc that returns *two* values leaves two on the stack, which is how `$a, $b = ~proc();` works (assignment pops in reverse, finding 66).

75. **The interpreter loop.** `ScriptRunner.execute(state)` sets `state.execution = RUNNING` and loops while it stays `RUNNING`: it checks the pc is in range, increments `state.opcount` and throws `Too many instructions` above 500,000, fetches `opcode = opcodes[++state.pc]`, looks it up in `ScriptRunner.HANDLERS` (the union of all the ops files, `ScriptRunner.ts:38-56`) and calls the handler. A handler that needs to stop the script sets `state.execution` to something else (`FINISHED`, `SUSPENDED`, ...). Source: `Engine-TS/src/engine/script/ScriptRunner.ts:121-157`
    ```ts
    const opcode = opcodes[++state.pc];
    const handler = ScriptRunner.HANDLERS[opcode];
    ```
    On any thrown error it builds a backtrace from `debugFrames` and the line table, tells the player ("script error: ..."), and sets `ABORTED`; in production it also logs a player out / removes an NPC (`ScriptRunner.ts:170-229`). The state values are `ABORTED -1, RUNNING 0, FINISHED 1, SUSPENDED 2, PAUSEBUTTON 3, COUNTDIALOG 4, NPC_SUSPENDED 5, WORLD_SUSPENDED 6` (`ScriptState.ts:26-33`).

    Partial answer to **open question 15**: a suspended script is the same `ScriptState` object (it holds `pc`, `frames`/`fp`, both stacks, both local arrays and the pointer bit set, `ScriptState.ts:41-62`) kept in `player.activeScript` (`Player.ts:2211-2218`); resuming is just calling `execute` on it again, which sets `RUNNING` and continues from `pc + 1` (the `pc` was left at the suspending instruction). The resume sites are: `World.ts:695-696` for `SUSPENDED` (after `p_delay`, once `delayed` clears), `ResumePauseButtonHandler.ts:8-13` for `PAUSEBUTTON` (a chat dialogue waiting for "Click here to continue"), and `Npc.ts:115` for `NPC_SUSPENDED`. The `p_delay` handler itself is `PlayerOps.ts:376-380`
    ```ts
    state.activePlayer.delayed = true;
    state.activePlayer.delayedUntil = World.currentTick + 1 + check(state.popInt(), NumberNotNull);
    state.execution = ScriptState.SUSPENDED;
    ```
    How many ticks later it resumes is the tick-phase question already covered in `docs/tick/05-players-queues-timers.md`; the *interpreter* part of #15 is: nothing is re-initialised, the frames and stacks persist inside the object. `WORLD_SUSPENDED` scripts are re-queued with a delay popped from the stack (`Player.ts:2212-2213`). Not read: the NPC and world-queue resume paths in detail.

### 3.7 Worked example 2: branches and a game variable (`[queue,set_rat_kill]`)

`Content/scripts/tutorial/scripts/npcs/tut_giant_rat.rs2:110-119`
```
[queue,set_rat_kill]
if (%tutorial = ^newbie_combat_instructor_during_attacking_melee) {
    %tutorial = ^newbie_combat_instructor_after_rat_kill_melee;
    ~set_tutorial_progress;
}

if (%tutorial = ^newbie_combat_instructor_before_attacking_ranged) {
    %tutorial = ^newbie_combat_instructor_after_attacking_ranged;
    ~set_tutorial_progress;
}
```
Constants (`Content/scripts/tutorial/configs/tutorial.constant:54-57`): 440, 450, 460, 470. `%tutorial` is varp id 281 (`Content/pack/varp.pack:282` `281=tutorial`). `~set_tutorial_progress` is `Content/scripts/tutorial/scripts/tutorial.rs2:178` (a proc with no parameters; id written `P` below). A `queue` script returns `nothing` so there are no default-return pushes.

76. Hand-compiled (labels resolved as `jump - cur - 1`):

    | idx | instruction | operand | note |
    |---|---|---|---|
    | 0 | `PUSH_VARP` | 281 | `%tutorial` (entry block) |
    | 1 | `PUSH_CONSTANT_INT` | 440 | `^newbie_combat_instructor_during_attacking_melee`, inlined |
    | 2 | `BRANCH_EQUALS` | +1 | to idx 4 (`if_true`) |
    | 3 | `BRANCH` | +4 | to idx 8 (`if_end`) |
    | 4 | `PUSH_CONSTANT_INT` | 450 | |
    | 5 | `POP_VARP` | 281 | |
    | 6 | `GOSUB_WITH_PARAMS` | P | `~set_tutorial_progress;` (no return values, so no discard) |
    | 7 | `BRANCH` | 0 | to idx 8 |
    | 8 | `PUSH_VARP` | 281 | second `if` is emitted into the first `if`'s end block |
    | 9 | `PUSH_CONSTANT_INT` | 460 | |
    | 10 | `BRANCH_EQUALS` | +1 | to idx 12 |
    | 11 | `BRANCH` | +4 | to idx 16 |
    | 12 | `PUSH_CONSTANT_INT` | 470 | |
    | 13 | `POP_VARP` | 281 | |
    | 14 | `GOSUB_WITH_PARAMS` | P | |
    | 15 | `BRANCH` | 0 | to idx 16 |
    | 16 | `RETURN` | 0 | default return (nothing to push) |

    The engine's branch handlers use the same arithmetic: `BRANCH_EQUALS` pops `b` then `a` and, if equal, does `state.pc += state.intOperand` (`CoreOps.ts:153-160`); the loop's own `++state.pc` then lands on `pc + operand + 1`, which is exactly the compiler's `jumpLocation - curIndex - 1`. Source: `BinaryScriptWriter.ts:288`, `CoreOps.ts:140-142`, `ScriptRunner.ts:150`.

    `POP_VARP` is where the protection rule bites: `CoreOps.ts:41-59` throws "`%<name> requires protected access`" if the script is not running with the protected pointer and the varp has `protect` set; `tutorial` has no `protect=no` (`Content/scripts/tutorial/configs/tutorial.varp:1-2`) and `VarPlayerType` defaults `protect = true` (`Engine-TS/src/cache/config/VarPlayerType.ts:85`). Queue scripts are always run protected (`Player.ts:910-911`), so this write is allowed (section 4).

### 3.8 Worked example 3: `switch` (`[oplocu,_tree]`)

`Content/scripts/skill_woodcutting/scripts/woodcut.rs2:6-14`
```
[oplocu,_tree]
switch_obj(last_useitem) {
    case bronze_axe, iron_axe, steel_axe, black_axe, mithril_axe, adamant_axe, rune_axe :
        p_oploc(1); // gets delayed by a tick >:(
    // case raw_herring, herring :
    //     mes("This is not the mightiest tree in the forest.");
    //     return;
    case default : ~displaymessage(^dm_default);
}
```
77. Hand-compiled (read from `CodeGenerator.ts:331-385`; `last_useitem` 2058, `p_oploc` 2079, proc `displaymessage` from `Content/scripts/general/scripts/misc/displaymessage.rs2:1` `(int $index)`, `^dm_default = 0` from `Content/scripts/general/configs/displaymessage.constant:2`):

    | idx | instruction | operand | note |
    |---|---|---|---|
    | 0 | `COMMAND` | 2058 | `last_useitem` (declared `()(obj)`, `engine.rs2:155`) |
    | 1 | `SWITCH` | table 0 | pops the key |
    | 2 | `BRANCH` | +3 | to idx 6, the `default` block |
    | 3 | `PUSH_CONSTANT_INT` | 1 | `case bronze_axe, ...:` block (label `switch_0_case`) |
    | 4 | `COMMAND` | 2079 | `p_oploc(1)` |
    | 5 | `BRANCH` | +3 | to idx 9 (`switch_end`) |
    | 6 | `PUSH_CONSTANT_INT` | 0 | `default` block: `^dm_default` |
    | 7 | `GOSUB_WITH_PARAMS` | `displaymessage` | |
    | 8 | `BRANCH` | 0 | to idx 9 |
    | 9 | `RETURN` | 0 | |

    Switch table 0 has seven entries, one for each axe name: key = that obj's id (`findCaseKeyValue`, `BinaryScriptWriter.ts:239-252`), value = relative jump `3 - 1 - 1 = 1` (`BinaryScriptWriter.ts:217-237`, `jumpLocation - context.curIndex - 1`, with `curIndex` the index of the `SWITCH`). At run time `SWITCH` pops the key; if the key is in the table `pc += offset`, otherwise execution simply continues with the next instruction (the `BRANCH` to `default`). Source: `CoreOps.ts:275-286`
    ```ts
    const result = table[key];
    if (result) {
        state.pc += result;
    }
    ```
    (`result` of 0 is falsy, which also means "continue with the next instruction", the same thing as a jump of 0.) `p_oploc(1)` is a protected command (section 4) and `[oplocu,...]` triggers carry `p_active_player` (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:505-511`).

### 3.9 Inferences (labelled), section 3

- *Inference G:* "no fall-through in `switch`" is the *compiler's* lowering (every case block ends in `BRANCH switch_end`); multiple keys on one `case` is the way to share code. Rests on `CodeGenerator.ts:380` and the `case a, b, c :` form (`RuneScriptParser.g4:67-69`).
- *Inference H:* operator precedence as stated in finding 56/57 relies on ANTLR's documented rule for left-recursive alternatives. It is consistent with the Content lines cited but was not tested by parsing.
- *Inference I:* "a proc that falls off the end returns 0/-1/''" rests on `generateDefaultReturns` (finding 65). The `-1` default for non-`int` int-based types (e.g. `namedobj`, `coord`) is why `return(null);` and falling off the end behave the same for those types.
- *Inference J:* "`5-3` lexes as `5` and `-3`" (finding 52), from the lexer rule only.

### 3.10 Not checked, section 3

- The generated ANTLR parser itself (absent), so no parse was reproduced; the AST builder was read for the pieces cited only (`AstBuilder.ts:124-420`).
- `Opcode.ts` long/obj branch opcodes (unused by the binary writer except by throwing).
- Bytecode and hand-compiled listings in 3.6-3.8 were derived by reading, not produced by the compiler. The risk points are (a) block ordering around `if`, which follows `visitIfStatement`/`generateCondition` as read, and (b) the numeric opcode ids, which come from counting the engine enum.
- `DbFindCommandHandler`, `ParamCommandHandler`, `EnumCommandHandler` code generation is covered in section 5 only by their type-checking behaviour.

---

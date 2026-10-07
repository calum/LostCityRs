# Chapter 4: Pointers and protected access

**Question answered:** What are `active_player`, `p_active_player` and the other pointers, what does the compiler enforce, and what is checked at run time?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

### 4.1 Findings: the vocabulary

78. A script operates on **entities that the engine hands it**, not on arguments. The words for them are *pointers*: `active_player`, `active_npc`, `active_loc`, `active_obj` (the primary ones) and `.active_player`, `.active_npc`, `.active_loc`, `.active_obj` (the secondary ones). There is no `self` keyword in the language: the lexer keyword list is `if else while case default return calc` plus the `def_`/`switch_`/`array` prefixes (`RuneScriptLexer.g4:37-46`), and `self` is not a command in `engine.rs2` (searched: no `[command,self`). "Self" exists only inside the engine: `ScriptState.self` is the entity that owns the running script (`ScriptState.ts:68`) and `ScriptRunner.init(script, self, target)` fills the active fields from it. The compiler's full set of 22 pointer names is `RuneScriptTS/src/compiler/pointer/PointerType.ts:2-23`
    ```ts
    public static readonly ACTIVE_PLAYER = new PointerType('active_player');
    ```
    - entity pointers: `active_player`, `.active_player`, `p_active_player`, `.p_active_player`, `active_npc`, `.active_npc`, `active_loc`, `.active_loc`, `active_obj`, `.active_obj`;
    - search results: `find_player`, `find_npc`, `find_loc`, `find_obj`, `find_db` ("a search has been started, `...next` may be called");
    - event context: `last_com`, `last_int`, `last_item`, `last_slot`, `last_targetslot`, `last_useitem`, `last_useslot` (values the trigger provides, e.g. `last_useitem` in `[oplocu,...]`).
    The prefix `p_` in a *pointer* name means **protected**: `p_active_player` is "active_player, and this script has exclusive protected access to it".

79. Runtime and compile time have different pointer sets. The engine's runtime `ScriptPointer` has only 10 bits: `ActivePlayer`, `ActivePlayer2`, `ProtectedActivePlayer`, `ProtectedActivePlayer2`, `ActiveNpc`, `ActiveNpc2`, `ActiveLoc`, `ActiveLoc2`, `ActiveObj`, `ActiveObj2`. Source: `Engine-TS/src/engine/script/ScriptPointer.ts:1-12`. The `find_*` and `last_*` pointers do not exist at runtime: they are purely a compile-time device (`grep` of `ScriptPointer` in `Engine-TS/src/engine/script` finds no such member). Runtime pointer bits are set when the script starts and by a few commands, and tested in very few places (finding 85).

### 4.2 Findings: how a script starts with its pointers

80. `ScriptRunner.init(script, self, target, args)` builds the `ScriptState`. If `self` is a Player it becomes `_activePlayer` (pointer `ActivePlayer`); NPC -> `_activeNpc`; Loc -> `_activeLoc`; Obj -> `_activeObj`. The `target` goes into the **primary** field of its class when `self` is of a different class, and into the **secondary** field when `self` is the same class. Source: `Engine-TS/src/engine/script/ScriptRunner.ts:66-119`, e.g. `:84-91`
    ```ts
    if (target instanceof Player) {
        if (self instanceof Player) {
            state._activePlayer2 = target;
            state.pointerAdd(ScriptPointer.ActivePlayer2);
        } else {
            state._activePlayer = target;
    ```
    So: a player clicking an NPC (`[opnpc1,x]`): `active_player` = the clicker, `active_npc` = the NPC. A player clicking another player (`[opplayer1,_]`): `active_player` = the clicker, `.active_player` = the target. An NPC acting on a player (`[ai_opplayer2,x]`): `active_npc` = the NPC, `active_player` = the target. This is the answer to "what is `.`": **the dot addresses the second entity of the same class**. In the trigger table (finding 44) the compiler's expectation matches: `opplayer*` starts with `active_player`, `p_active_player`, `.active_player` (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:638-644`), `opnpc*` with `active_player`, `p_active_player`, `active_npc` (`:134-139`).

81. The dot form of a command, `.name`, is the same opcode with the **secondary flag** set (finding 67, `BinaryScriptWriter.ts:322-329`), and every handler reads its entity through `state.activePlayer` etc., which choose the field by that flag (finding 71). Declaring the dotted commands is part of `engine.rs2`: e.g. `[command,mes](string $text)` at `:159` and `[command,.mes](string $text)` at `:161`. For a command whose pointer rules have a second set (`require2`/`set2`/`corrupt2`), the compiler *creates the dotted alias itself* if `engine.rs2` did not declare it: `registerSecondaryCommands` (`RuneScriptTS/src/compiler/ScriptCompiler.ts:380-408`). The same `.` prefix on variables is the lexer token `.%` (`RuneScriptLexer.g4:21`): `.%pk_predator1 = uid;` writes a varp of the secondary player (`Content/scripts/skill_combat/scripts/pvp/pk_skull.rs2:22`, the opcode `POP_VARP` carries `1 << 16`, finding 61, and `CoreOps.ts:42-47` selects `_activePlayer2` for it).

82. **Protected access at runtime.** A trigger that is documented as protected runs through `Player.executeScript(script, protect = true)`. `runScript` then refuses to run the script at all if the player already has a protected script running or is `delayed`, otherwise sets the `ProtectedActivePlayer` bit and the player's `protect` flag for the duration. Source: `Engine-TS/src/engine/entity/Player.ts:2171-2200`
    ```ts
    if (!force && protect && (this.protect || this.delayed)) {
        // can't get protected access, bye-bye
    ```
    ```ts
    if (protect) {
        script.pointerAdd(ScriptPointer.ProtectedActivePlayer);
        this.protect = true;
    }
    ```
    (the first quote is `:2172-2173`, the second `:2178-2181`). `canAccess()` (`Player.ts:825-832`) is `!this.protect && !this.busy()`, and the queue/timer processors only start a script when `canAccess()` is true. A resumed script is run with `force = true` (`World.ts:696`, `ResumePauseButtonHandler.ts:12`). Which triggers run protected, from the call sites: op/ap scripts, the normal / weak / engine queues (the engine queue is what `advancestat`, `changestat` and the zone triggers use, finding 44), normal timers, and `login` (`Player.ts:527`): yes; soft timers and `if_close`: no; `if_button`: only when the component's root layer is not an overlay (`IfButtonHandler.ts:34`). Source for the list: `Player.ts:527, 665, 911, 923, 958, 1176, 1198` (protect `true`), `Player.ts:739, 784, 795, 806` (false), `Player.ts:958` (timer type decides). The logout trigger is run with the protected bit set by hand (`World.ts:786-788`).

### 4.3 Findings: what the compiler enforces

83. **Every command has pointer rules, declared engine-side.** `ScriptOpcodePointers` maps an opcode to `require`, `set`, `corrupt` (and `require2`, `set2`, `corrupt2` for the dot form, and `conditional`). 248 commands have an entry (count of entry headers, `Engine-TS/src/engine/script/ScriptOpcodePointers.ts:5-1028`). `tools/pack/Compiler.ts` converts them to the strings the compiler wants (finding 9), and `CompileServerScript` parses them into `PointerHolder { required, set, conditionalSet, corrupted }` (`ServerScriptCompilerApplication.ts:90-108`). Examples, quoted:

    `Engine-TS/src/engine/script/ScriptOpcodePointers.ts:268-271` (`mes`)
    ```ts
    [ScriptOpcode.MES]: {
        require: ['active_player'],
        require2: ['active_player2']
    },
    ```
    `Engine-TS/src/engine/script/ScriptOpcodePointers.ts:317-330` (`p_delay`)
    ```ts
    [ScriptOpcode.P_DELAY]: {
        require: ['p_active_player'],
        corrupt: [
            // everything except active is assumed corrupted
            ...POINTER_GROUP_FIND,
    ```
    `Engine-TS/src/engine/script/ScriptOpcodePointers.ts:334-338` (`p_finduid`)
    ```ts
    [ScriptOpcode.P_FINDUID]: {
        set: ['p_active_player', 'active_player'],
        set2: ['p_active_player2', 'active_player2'],
        conditional: true
    },
    ```
    `Engine-TS/src/engine/script/ScriptOpcodePointers.ts:410-413` (`queue` needs only the unprotected pointer)
    ```ts
    [ScriptOpcode.QUEUE]: {
        require: ['active_player'],
        require2: ['active_player2']
    },
    ```
    `conditional: true` means the `set` happens only on the path where the command's boolean result was `true` (the graph generator inserts a pointer-setting node on the branch of `if (cmd(...) = true)`: `GraphGenerator.ts:127-148`, `isConditionalPointerSetter` at `:203-209`). Content relies on it: `Content/scripts/drop tables/scripts/grip.rs2:5` `if(p_finduid(uid) = true) %heroquest = ^hero_phoenix_killed_grip;`.

84. **The rule, as the checker implements it.** For every pointer P and every instruction that *requires* P (a command with `P` in `require`, a `gosub`/`jump` to a script that requires P, a game-variable read/write, see finding 86), search **backwards over all control-flow paths** from that instruction. The search is blocked by any instruction that *sets* P. If it reaches (a) a *corrupting* instruction, error "`Attempt to access corrupted pointer %s.`" (plus a hint at the corrupting instruction, "`%s corrupted here.`"), or (b) the script's first instruction when the trigger does not provide P, error "`Attempt to access uninitialized pointer %s.`". Sources: `RuneScriptTS/src/compiler/codegen/script/config/PointerChecker.ts:182-231` (in it, `PointerChecker.ts:192-203`: the trigger's own pointer set counts as set at entry; for any other pointer the first node is treated as corrupting; and `PointerChecker.ts:229`)
    ```ts
    const message = isCorrupted ? DiagnosticMessage.POINTER_CORRUPTED : DiagnosticMessage.POINTER_UNINITIALIZED;
    ```
    the search `findEdgePath` at `PointerChecker.ts:373-414`, messages `DiagnosticMessage.ts:106-109`. When the requirement comes from a proc, an extra hint "`%s required here.`" points into the proc (`PointerChecker.ts:243-301`).

    Therefore pointer safety is a **static, path-sensitive dataflow check**: it only rejects scripts where *some* path reaches the use without the pointer, and it needs no annotations in Content, because it computes the requirements of every proc/label by analysing their bodies (`calculatePointers`, `PointerChecker.ts:145-166`, used at call sites at `:650-662`). Comments such as `// requires active_player` above `[proc,pk_skull]` (`Content/scripts/skill_combat/scripts/pvp/pk_skull.rs2:28`) are documentation only; the checker does not read them.

85. **What is checked at runtime, in contrast.** Only three things (searched `Engine-TS/src/engine/script/handlers` for `pointerGet`, `protect`, and the "null active" errors):
    1. `state.activePlayer` / `activeNpc` / `activeLoc` / `activeObj` throw if the selected field is null ("Attempt to access null active_player"), `ScriptState.ts:185-266`.
    2. Writes to a varp or varbit whose `protect` flag is set require the `ProtectedActivePlayer` bit: "`%<name> requires protected access`", `CoreOps.ts:41-59`, `:73-90`.
    3. Inventory commands on a protected inv (unless the inv has shared scope) require the bit: "`$inv requires protected access: ...`", `InvOps.ts:57-67` and similar checks at `:91`, `:119`, `:136`, ...
    The `p_delay` handler has **no** runtime check (`PlayerOps.ts:376-380`), nor do other `p_` commands; their safety comes entirely from the compile-time rule in finding 84. (Answers the second half of the question in open question 30.)

86. **Game variables are pointer uses.** `%v` read: requires `active_player` for a varp/varbit, `active_npc` for a varn (nothing for a `vars`); `%v` write: requires `p_active_player` if the varp/varbit is protected, else `active_player`; the dot forms use the `2` pointers. Source: `PointerChecker.ts:664-706`. A varp is protected unless its config says `protect=no` (`VarPlayerType.ts:85` default `protect = true`; `VarpConfig.ts:95-98` only writes the "unprotected" opcode when the value is `false`), and the compiler is told the flag per varp through `varpInfo.protect[id] = varp.protect` (`Engine-TS/tools/pack/Compiler.ts:237`) which `CompilerTypeInfoProtectedLoader` stores on the symbol (`RuneScriptTS/src/runescript/CompilerTypeInfoProtectedLoader.ts:33-40`).

87. **Pointer rules for the trigger itself.** Each trigger lists the pointers it provides (finding 44). The special case: `if_button` and `inv_button*` provide `p_active_player` only if the interface of the script's component subject is **not** an overlay. `ServerPointerChecker.setsPointerTrigger` implements it by checking the subject's interface name against the list of overlay interfaces that `Compiler.ts` built from the component config (`Engine-TS/tools/pack/Compiler.ts:213-227`). Source: `RuneScriptTS/src/runescript/ServerPointerChecker.ts:27-53`, key line `:52`
    ```ts
    return !this.overlayInterfaces.has(ServerPointerChecker.normalizeName(interfaceName));
    ```
    The runtime counterpart is `IfButtonHandler.ts:34` `player.executeScript(ScriptRunner.init(script, player), root.overlay == false)`: the two sides agree (compile-time "overlay => unprotected", run-time "overlay => `protect` false").

88. **The prefix `p_` on command names** is a convention that matches the rule almost exactly. Of the 26 pointer-table entries whose command name starts with `P_`, 25 `require: ['p_active_player']`; the 26th is `P_FINDUID`, which *sets* it. Four commands without the prefix also require it: `SETIDKIT`, `SETGENDER`, `SETIDKCOLOUR` (`ScriptOpcodePointers.ts:422-424`, `:508-513`) and `WEIGHT` (`:522-525`). Counted by a one-off script over the table; the 28 `// info: Requires protected access` comments in `engine.rs2` are the human-facing statement of the same thing (count of lines containing that phrase). So "`p_`" in a command name is not syntax; the compiler never looks at the prefix; it looks at `require`.

89. **`corrupt` and the iteration pointers.** `p_delay`, `p_arrivedelay` and similar *corrupt* all the `find_*` and `last_*` pointers (`ScriptOpcodePointers.ts:317-330`, `:289-301`) because a delay lets other code run. And `huntall` / `npc_huntall` / `npc_findall` set `find_player` / `find_npc`, `huntnext` / `npc_findnext` require it and conditionally set the `active_*` pointer, which is the pattern behind `Content/scripts/skill_thieving/scripts/stalls/stealing.rs2:116-117` `npc_huntall(npc_coord, 5, 0);` / `while (npc_findnext = true) {` (rules at `ScriptOpcodePointers.ts:142-151`, `:156-158`, `:634-639`). By the rule in finding 84 the compiler should therefore reject a loop that calls `p_delay` and then comes back round to `npc_findnext` ("corrupted pointer find_npc"); this consequence was derived, not run.

### 4.4 Answer to open question 30

**Question:** can an unprotected script (soft timer, `IF_CLOSE`, logout trigger) call protected-only commands such as `p_delay`, `queue` or `settimer`?

- `p_delay` requires `p_active_player` (`ScriptOpcodePointers.ts:317-318`). `SOFTTIMER` provides only `active_player` (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:904-910`) and `IF_CLOSE` only `active_player` (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:981-987`), so a `p_delay` in either is a **compile error** ("Attempt to access uninitialized pointer p_active_player."), by findings 84 and 44. (The error text is constructed from the rule; not produced by running the compiler.)
- `queue` requires only `active_player` (`ScriptOpcodePointers.ts:410-413`), `settimer` and `softtimer` also (`ScriptOpcodePointers.ts:433-440`), so all three are allowed in soft timers and `if_close`. Content does exactly this: `[if_close,player_kit]` does nothing but `queue(tutorial_designed_character, 0, 0);` (`Content/scripts/tutorial/scripts/tutorial.rs2:136-137`), and the queued script (run protected, `Player.ts:910-911`) does the protected write `%tutorial = ^newbie_basics_instructor_designed_character;` (`tutorial.rs2:139-140`). *Inference:* this is the idiom for "I am in an unprotected trigger but need a protected write": queue a script.
- Soft timers can still write varps that are marked `protect=no`: `[softtimer,pk_skull_timer]` calls `~clear_pk_skull`, which does `%pk_skull = 0;` (`pk_skull.rs2:35-41`), and `[pk_skull]` is declared `protect=no` (`Content/scripts/_unpack/225/all.varp:97-99`).
- The **logout** trigger *does* get `p_active_player` (compiler: `LOGOUT` pointers include `P_ACTIVE_PLAYER`, `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:1086-1092`; engine: the bit is added by hand in `World.ts:787`). So the examples in the question are not uniform: `logout` is protected, `softtimer` and `if_close` are not.
- The runtime does not re-check `p_delay` etc. (finding 85), so enforcement is compile-time only for commands.

### 4.5 Inferences (labelled), section 4

- *Inference K:* the model behind the design is "at most one script at a time may mutate a player in ways that depend on the player's state", realised as an exclusive `protect` flag plus `canAccess()`, with the compile-time pointer rule making sure unprotected scripts cannot call the mutating commands. Rests on findings 82-85. The wording is mine; the code only shows the mechanisms.
- *Inference L:* because only `varp`/`varbit` writes and protected-inventory commands are runtime-checked (finding 85), a command whose `ScriptOpcodePointers` entry omits `p_active_player` but which really mutates protected state would not be caught anywhere. Not looked for.
- *Inference M:* the `writeinv` symbol table passed in `Engine-TS/tools/pack/Compiler.ts:345` (with a `protect` flag per inventory, `Engine-TS/tools/pack/Compiler.ts:203-211`) is not used by the compiler: `grep writeinv RuneScriptTS/src` finds only the type declaration (`RuneScriptTS/src/runescript/type/ScriptVarType.ts:36`) and no symbol loader registers it (`RuneScriptTS/src/runescript/ServerScriptCompiler.ts:106-146` has loaders for many names but not `writeinv`). So the "protected inventory" rule is runtime-only in this revision.

### 4.6 Not checked, section 4

- Whether `player.protect` is set by `p_finduid` (the handler adds the pointer bit only, `PlayerOps.ts:93-96`; the reset at the end of `runScript` clears `protect` on `_activePlayer`, `Player.ts:2189-2197`). Not analysed.
- The NPC and world equivalents of "protected" (NPC scripts have no protect flag; `Npc.executeScript` was not read in detail).
- Pointer corruption by `jump` parameters of label type (the checker has a special "static label argument" path, `PointerChecker.ts:455-520`); read, not exercised.

---

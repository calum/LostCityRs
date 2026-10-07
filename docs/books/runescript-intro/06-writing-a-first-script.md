# Chapter 6: Writing a first script

**Question answered:** Reading three real scripts line by line, and which compiler diagnostics and gotchas are verified?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

Three real scripts, each richer than the last, then the compile-time gotchas. Every construct used is one established in sections 2-5; each line below carries the citation of the rule it relies on. All three scripts are copied from Content; the one script written from scratch in 6.4 is marked **constructed** and was not compiled.

### 6.1 Script 1: the smallest useful script (an option on a scenery object)

`Content/scripts/skill_thieving/scripts/chest/trapped_chest.rs2:110-111`
```
[oploc1,loc_2572]
mes("It looks like this chest has already been looted.");
```

99. Line by line.
    - `[oploc1,loc_2572]`: trigger `oploc1` (id 66, `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:470`), subject type `loc`. The subject is looked up as a `loc` symbol named `loc_2572`; that name exists because `Content/pack/loc.pack:2573` says `2572=loc_2572` and the loc is defined as `[loc_2572]` in `Content/scripts/_unpack/225/all.loc:12741-12748`, whose line 12746 is `op1=Open` (the label of the first option). `loc_NNNN` names are the debug names given to configs that have no friendlier name. The checker resolves the subject in `ScriptRegistration.checkTypeScriptSubject` -> `resolveSubjectSymbol` (`ScriptRegistration.ts:273-290`, `:353-378`).
    - the trigger provides `active_player`, `p_active_player`, `active_loc` (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:470-476`, from the listing in finding 44).
    - `mes("...")`: a command call, `[command,mes](string $text)` (`engine.rs2:159`); the argument is a plain string literal so the hint is `string` and no resolution is needed (`TypeChecking.ts:1182-1207`). `mes` requires `active_player` (`ScriptOpcodePointers.ts:268-271`) which the trigger provides, so the pointer check passes (finding 84).
    - the file ends the script at the next `[` (or end of file): the code generator appends `RETURN` (finding 65).

100. What the compiler emits (hand-compiled, not run):

     | idx | instruction | operand | bytes |
     |---|---|---|---|
     | 0 | `PUSH_CONSTANT_STRING` | `"It looks like this chest has already been looted."` | `00 03` + text + `00` |
     | 1 | `COMMAND` | 2063 (`mes`), secondary 0 | `08 0F 00` |
     | 2 | `RETURN` | 0 | `00 15 00` |

     and its lookup key (finding 46): `66 + (2 << 8) + (2572 << 10)` = `66 + 512 + 2,633,728` = **2,634,306**. The engine's `getByTrigger(66, 2572, category)` computes the same number for a click on that loc (finding 47), so this script runs (`Player.ts:1176`) when the player chooses option 1 on loc 2572. Which packet/op number selects `oploc1` is traced in `docs/flows/click-loc-woodcutting.md` (not repeated here).

101. At run time: `PUSH_CONSTANT_STRING` pushes the text on the string stack (`CoreOps.ts:21-23`); `COMMAND 2063` finds `MES` in `HANDLERS` (`PlayerOps.ts:343-347`), pops the string and calls `state.activePlayer.messageGame(message)`; `RETURN` with `fp === 0` ends the script (`CoreOps.ts:206-208`). The chat message reaches the client via the path in `docs/flows/server-response-woodcutting.md`.

### 6.2 Script 2: branching, procs, and a suspended conversation

`Content/scripts/areas/area_lumbridge/scripts/hans.rs2:18-32`
```
~chatnpc("<p,neutral>Hello. What are you doing here?");
def_int $option = ~p_choice3("I'm looking for whoever is in charge of this place.", 1, "I have come to kill everyone in this castle!", 2, "I don't know. I'm lost. Where am I?", 3);
if ($option = 1) {
    ~chatplayer("<p,neutral>I'm looking for whoever is in charge of this place.");
    ~chatnpc("<p,neutral>Who, the Duke? He's in his study, on the first floor.");
} else if ($option = 2) {
    ~chatplayer("<p,angry>I have come to kill everyone in this castle!");
    if_close;
    npc_setmode(playerescape);
    p_delay(0);
    npc_say("Help! Help!");
} else if ($option = 3) {
    ~chatplayer("<p,confused>I don't know. I'm lost. Where am I?");
    ~chatnpc("<p,neutral>You are in Lumbridge Castle.");
}
```
(These are the last lines of the script that begins `[opnpc1,hans]` at `hans.rs2:1`; lines 2-16 are an `if(map_members = ^true)` block for treasure-trail clues that this walk-through skips.)

102. Line by line.
    - `~chatnpc("...")`: a **proc call** with one string argument (finding 58). The proc is `Content/scripts/interface_chat/scripts/chat.rs2:323-333`: it calls `split_init` (whose engine handler strips the leading `<p,neutral>` tag into a mesanim id, `StringOps.ts:76-96`), loops over the pages with `while ($page < $pagetotal)`, shows each page with `~chatnpc_page`, and ends each iteration with **`p_pausebutton;`** (`chat.rs2:331`), which sets `execution = PAUSEBUTTON` (`PlayerOps.ts:425-427`). The interpreter loop exits, `executeScript` parks the state in `player.activeScript` (`Player.ts:2216-2218`), and the world carries on. When the player clicks "continue", `ResumePauseButtonHandler` runs `player.executeScript(player.activeScript, true, true)` (`ResumePauseButtonHandler.ts:8-13`), which calls `execute` again and the script continues at the instruction after `p_pausebutton`, inside the proc's `while`. This is how a conversation that "waits for the player" is just straight-line code.
    - `def_int $option = ~p_choice3(...)`: a **proc that returns an int**, `chat.rs2:36` `[proc,p_choice3](string $string1, int $ret1, ..., int $ret3)(int)`, six arguments (3 strings and 3 ints, interleaved). The proc opens a chat interface, calls `p_pausebutton`, and then returns one of its int arguments chosen by `switch_component (last_com)` (`chat.rs2:50-54`): `case multi3:com_1 : return($ret1);`. So `$option` is 1, 2 or 3. `last_com` is allowed there because `p_pausebutton` *sets* the `last_com` pointer (`ScriptOpcodePointers.ts:374-378`, the `P_PAUSEBUTTON` entry's `set: ['last_com']`). The 6.2 script needs no pointer annotation: the compiler computed that `~p_choice3` requires `p_active_player` and that `[opnpc1,...]` provides it (finding 84).
    - `if ($option = 1) {...} else if ($option = 2) {...} else if ($option = 3) {...}`: three comparisons with `=` (finding 56); `else if` is an `else` whose statement is an `if` (finding 55).
    - `if_close;`: a bare no-argument command (`engine.rs2:143`, handler `PlayerOps.ts:246-248` calls `closeModal()`). `closeModal` runs the `[if_close,<interface>]` scripts of the open interfaces unprotected and clears the player's interface state (`Player.ts:760-814`).
    - `npc_setmode(playerescape);`: `[command,npc_setmode](npc_mode $mode)` (`engine.rs2:591`). `playerescape` is a bare identifier with hint `npc_mode`; the symbol table for `npc_mode` is built from the engine's `NpcModeMap` (`Compiler.ts:309`, `ServerScriptCompiler.ts:140`). It acts on `active_npc`, which `[opnpc1,hans]` provides.
    - `p_delay(0);`: suspends the script for the rest of this tick (`delayedUntil = currentTick + 1 + 0`, `PlayerOps.ts:376-380`); it is resumed in the next tick's player phase (`World.ts:695-696`; the exact phase ordering is in `docs/tick/05-players-queues-timers.md`). Only protected scripts may call it (finding 84); `opnpc1` is protected (`Player.ts:1176`).
    - `npc_say("Help! Help!");`: `engine.rs2:583`, handler `NpcOps.ts:185-187`. After `p_delay(0)` the pointer analysis would flag a use of `find_*`/`last_*`, but `npc_say` needs only `active_npc`, which is not corrupted (`P_DELAY`'s `corrupt` list, `ScriptOpcodePointers.ts:317-330`, names `find_*` and `last_*` only).
    - `"<p,confused>..."` strings are passed through unchanged by the compiler (finding 53).
    - locals: `$option` is int local 0 of this script (nothing else is declared before it at the top level of the script in lines 2-16; the first `if` has no `def_`), so `~p_choice3(...)` compiles to six pushes, `GOSUB_WITH_PARAMS`, then `POP_INT_LOCAL 0` (findings 62, 66).

103. **A `switch` variant**, from the other NPC script of 6.2's family: `Content/scripts/npc/scripts/man.rs2:3-8,17`
    ```
    switch_int(random(23)) {
        case 0 :
            ~chatnpc("<p,neutral>How can I help you?");
            def_int $option = ~p_choice3("Do you want to trade?", 1, "I'm in search of a quest.", 2, "I'm in search of enemies to kill.", 3);
    ```
    and `Content/scripts/npc/scripts/man.rs2:17`
    ```
        case 1 : ~chatnpc("<p,happy>I'm very well thank you.");
    ```
    `random(23)` gives 0..22 (`NumberOps.ts:32-35`); `switch_int` takes an `int`; each `case` has constant int keys; there is no fall-through (finding 66). The header of that script is `[opnpc1,_citizen]` (`Content/scripts/npc/scripts/man.rs2:1`): the same script serves every NPC whose config says `category=citizen`, unless a more specific `[opnpc1,<npc>]` exists (finding 47). Note that a `def_` inside a `case` body is scoped to that case (`TypeChecking.ts:338-341`).

### 6.3 Script 3: a variable, an unprotected trigger, a queue, and a delay

Three small scripts that cooperate. `Content/scripts/tutorial/scripts/tutorial.rs2:133-141`
```
[if_button,player_kit:accept]
if_close;

[if_close,player_kit]
queue(tutorial_designed_character, 0, 0);

[queue,tutorial_designed_character]
%tutorial = ^newbie_basics_instructor_designed_character;
allowdesign(false);
```
(`^newbie_basics_instructor_designed_character` is `1`, `Content/scripts/tutorial/configs/tutorial.constant:2`; `%tutorial` is the varp declared at `Content/scripts/tutorial/configs/tutorial.varp:1-2`, id 281.)

104. Chain of events (all read, not run): the player presses the "accept" button of the `player_kit` interface -> `IfButtonHandler` looks up `[if_button,player_kit:accept]` by the component id (`IfButtonHandler.ts:31`) and runs it (protected iff the interface is not an overlay, `:34`) -> the one statement `if_close;` calls `closeModal()` (`PlayerOps.ts:246-248`) -> `closeModal` finds the open modal(s) and looks up `[if_close,<modal>]` with `getByTrigger(IF_CLOSE, id)`, running it **unprotected** (`Player.ts:781-785`, `executeScript(..., false)`) -> `queue(tutorial_designed_character, 0, 0)` puts the queue script on the player's queue (`PlayerOps.ts:149-158`) -> the queue processor runs it later with protected access (`Player.ts:897-912`) -> the script writes the varp and calls `allowdesign(false)`.

105. **Why three scripts, not one?** The varp `tutorial` has no `protect=no` line, so it is protected (`VarPlayerType.ts:85`, `VarpConfig.ts:95-98`); writing it needs `p_active_player` (`PointerChecker.ts:675-683`, runtime `CoreOps.ts:50-52`). `[if_close,...]` does not provide that pointer (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:981-987`), but `queue` needs only `active_player` (`ScriptOpcodePointers.ts:410-413`). So `if_close`'s only possible move is to queue a script, and the queue script gets protected access (`Player.ts:910-911`) and may write the varp. *Inference* (labelled): this is the standard idiom for "do protected work from an unprotected trigger". Rests on findings 82-85 and 4.4.

106. `p_delay` and the other "wait" commands follow the same pattern. A real, short example of protected waiting: `Content/scripts/ladders+stairs/scripts/ladders.rs2:154-161`
    ```
    [proc,climb_ladder](coord $coord, boolean $up)
    if ($up = true) {
        anim(human_reachforladder, 0);
    } else {
        anim(human_pickupfloor, 0);
    }
    p_delay(0);
    p_telejump($coord);
    ```
    It plays an animation (`anim(seq, delay)`, `engine.rs2:109`), suspends for the remainder of the tick, then teleports with `p_telejump` (a `p_` command that requires `p_active_player`, `ScriptOpcodePointers.ts:394-397`). Because this is a proc, its pointer requirement (`p_active_player`, from `p_delay` and `p_telejump`) is inherited by every script that calls `~climb_ladder`, e.g. `[oploc1,phoenixladder]` at `ladders.rs2:124-126`, which is protected by virtue of being an `oploc1` script.

### 6.4 A constructed example (not compiled, not run)

To show how the pieces combine, here is a new script made only from constructs read in this chapter. It is **constructed**: nothing in Content has this header, and it was not compiled.

```
[opnpc3,man2]
def_int $roll = random(3);
if ($roll = 0) {
    npc_say("Mind your own business.");
} else {
    mes("The man ignores you.");
}
```
- `man2` is an NPC (`Content/pack/npc.pack:3` `2=man2`); `opnpc3` is the third option; its config has `op3=Pickpocket`-style options (`Content/scripts/_unpack/225/all.npc:34-37`, `op2=Attack` shown at `:37`; the third option text is on a following line, not shown).
- It would use pointers `active_player` (for `mes`) and `active_npc` (for `npc_say`), both provided by `opnpc3` (finding 44).
- `random(3)` returns 0, 1 or 2 (`NumberOps.ts:32-35`); the `=` comparison and `else` follow findings 55-56; locals are int, declared with an initializer (finding 62).
- Because `man2` has `category=citizen` (`_unpack/225/all.npc:63`), defining a *specific* `[opnpc3,man2]` would, by `getByTrigger`'s order, take precedence over any `[opnpc3,_citizen]` for that NPC (finding 47). Whether a `[opnpc3,_citizen]` exists in Content was not checked.
This is the whole edit-compile-run loop: save the file under a `scripts/` folder (`PackFile.ts:384-394`), run the build (`npm run build`) or let the `dev` watcher repack (finding 7), and the engine loads the new `script.dat` (finding 7, `World.ts:274`). No part of that loop was executed for this chapter.

### 6.5 Verified gotchas (from the compiler's own diagnostics)

*Reference convention for 6.5 only:* a bare `:N` is a line of `RuneScriptTS/src/compiler/diagnostics/DiagnosticMessage.ts`; every place where the diagnostic is raised is written with its own file name.

Each item: what goes wrong, the message (verbatim from `RuneScriptTS/src/compiler/diagnostics/DiagnosticMessage.ts`), and where it is raised. The compiler prints `file:line:col: ERROR: message`, then the source line and a caret (`DiagnosticsHandler.ts:98-116`), and then exits with status 1 (`:143-145`). Syntax errors are reported through ANTLR with the type `SYNTAX_ERROR` and ANTLR's own text (`RuneScriptTS/src/compiler/ParserErrorListener.ts:20-35`).

107. **Header problems.**
     - Unknown trigger: `'%s' is not a valid trigger type.` (`:33`, raised at `ScriptRegistration.ts:111`).
     - Duplicate script: `[%s,%s] is already defined.` (`:31`, `ScriptRegistration.ts:173`); applies to trigger + exact name.
     - `*` on a non-command: `Using a '*' is only allowed for commands.` (`:34`).
     - Parameters/returns on a trigger that forbids them: `The trigger type '%s' is not allowed to have parameters defined.` (`:35`) / `... not allowed to return values.` (`:37`).
     - Bad subject: `Trigger '%s' only allows global subjects.` (`:39`), `... does not allow global subjects.` (`:40`), `... does not allow category subjects.` (`:41`), `... does not allow spaces in subjects.` (`:42`); an unknown name gives `'%s' could not be resolved to a symbol.` (`:26`). E.g. (derived from `ScriptRegistration.ts:273-290` and `:244-268`; not run) `[opplayer1,hans]` should fail with "only allows global subjects" because the `opplayer1` mode is `None`, and `[if_button,_x]` with "does not allow category subjects".
     - For `mapzone`/`zone` subjects: `Mapzone subject must be of the form: 'level_mx_mz'.`, `Invalid mapzone coord.`, `Mapzone affect all level, just specify '0'.`, `Zone subject must be of the form: 'level_mx_mz_lx_lz'.`, `Local zone coord must be a multiple of 8` (`ScriptRegistration.ts:292-348`).
     - **A name that exists in no pack file** fails earlier, in the pack tool, not the compiler: e.g. a new `.loc` block without an id line gives `Missing loc pack ID for: [name]` ... `You may need to edit .../pack/loc.pack` (`PackFile.ts:162-173`) for transmitted packs; non-transmitted ones are added automatically (finding 26).

108. **Conditions.** `if ($x)`: `Conditions are only allowed to be binary expressions.` (`:56`, `TypeChecking.ts:249`). `a < b < c` style nesting: `Condition is not valid.` (`:57`, raised at `TypeChecking.ts:574`). Two strings with `=`/`!`: `Operator '%s' cannot be applied to '%s', '%s'.` (`:60`, `TypeChecking.ts:612-614`). A tuple (a call returning two values) on one side: `%s side of binary expressions can only have one type but has '%s'.` (`:61`). `&`/`|` on non-booleans, `<` on non-numbers: the same `Operator ...` message (raised at `TypeChecking.ts:602-604`).

109. **Types.** `Type mismatch: '%s' was given but '%s' was expected.` (`:25`, `TypeChecking.ts:1515`) is the generic one (wrong argument type, wrong number of values, assigning `int` to a `coord`/`boolean` variable). `'%s' is not a valid type.` for an unknown `def_` / parameter type (`:24`). `'%s' is not allowed to be declared as a type.` for e.g. `def_long` (`:75`, `ServerScriptCompiler.ts:68-71`); `'%s' is not allowed to be used as a parameter.` (`:76`). `Integer value is out of range for type '%s'.` for an int literal beyond 32 bits (`:28`, `TypeChecking.ts:1113`). `Cannot infer type of 'null' from context.` if `null` appears where nothing tells its type (`:93`, `:1179`).

110. **Names.** `'$%s' cannot be resolved to a local variable.` (use before declaration, `:77`), `'$%s' is already defined.` (redeclaration or shadowing an outer local, `:32`, `SymbolTable.ts:30-40`), `'%%%s' cannot be resolved to a game variable.` (message text `'%%%s'`, shown as `'%name'`; `:83`), `'^%s' cannot be resolved to a constant.` (`:86`), `'%s' cannot be resolved to a command.` (`:64`), `'~%s' cannot be resolved to a proc.` (`:66`), `'@%s' cannot be resolved to a label.` (`:68`). Constants: `Cyclic constant references are not permitted: %s.` (`:87`), `Unable to infer type for '^%s'.` (a constant used where no type is expected, `:88`), `Unable to parse constant value of '%s' into type '%s'.` (`:89`), `Constant value of '%s' evaluated to a non-constant expression.` (`:90`).

111. **Calls.** Arguments given to a no-argument callee: `'%s' is expected to have no arguments but has '%s'.` (commands, `:65`), `'~%s' is expected ...` (procs, `:67`), `'@%s' ...` (labels, `:69`). Wrong argument types or counts are a `Type mismatch` (e.g. `'int,string' was given but 'int,int' was expected`-style, the representation comes from `TupleType.representation`, `TupleType.ts:32`).

112. **Switch.** `'%s' is not allowed within a switch statement.` (`switch_string`, `switch_long`: their type options forbid it, `PrimitiveType.ts:44-47`, `:49-51`; message `:45`), `Duplicate default label.` (`:46`), `Switch case value is not a constant expression.` (`:47`).

113. **Pointers.** `Attempt to access uninitialized pointer %s.` and `Attempt to access corrupted pointer %s.`, with hints `%s required here.` and `%s corrupted here.` (`:106-109`). The most common newcomer cause is calling a `p_` command from an unprotected trigger (4.4).

114. **Warnings and non-errors (things that compile).** An expression statement without effect: warning `Value is discarded.` (`:53`, `TypeChecking.ts:502-503`); warnings do not stop the build. **Not diagnosed at all** (searched `DiagnosticMessage.ts:1-110`, no such message exists): unreachable code after `return;` or `@label;`; a missing `return` in a proc with a return type (default values are appended, finding 65); unused locals; an `if` whose branches are identical; a `switch` with duplicate case keys (the source has a `TODO: Check for duplicate case labels (other than default)` at `TypeChecking.ts:297-298`).

115. **Things that compile but fail at run time.** Arrays (finding 72); a command with a `ScriptOpcodeMap` entry but no handler (finding 94); `-1` (null) passed where a valid id is required: the handler's `check(...)` throws `An input number was null(-1).` (`ScriptValidators.ts:37-41`) and the engine reports `script error: ...` with a backtrace to the player and the console, and in production logs the player out (`ScriptRunner.ts:170-229`); more than 500,000 instructions: `Too many instructions` (`ScriptRunner.ts:144-146`); nested `~proc` calls deeper than 50: `stack overflow` (`CoreOps.ts:236-239`).

116. **Lexing surprises** (from the lexer rules, finding 52-53): `-3` is one token; `<` inside a string starts an interpolation, so a literal `<` needs `\<` or the `<lt>` tag; a name with `+`, `.`, `:` is one identifier; a pure-digit word is an integer, so a config literally named `123` can only be referenced through the integer-as-name rule (`TypeChecking.ts:1105-1108`).

### 6.6 Not checked, section 6

- None of the three real scripts, and not the constructed one, was compiled or run; the hand-compiled listings in 6.1 are derived like those in section 3.
- The packet path that selects `oploc1` for a click (see `docs/flows/click-loc-woodcutting.md`), and the client side of `mes`, `p_choice3`'s interface (`multi3`) and the chat interface scripts, were not read for this chapter.
- Whether `loc_2572` is actually reachable in the game world (map placement) was not checked.
- Gotcha messages were taken from the diagnostic definitions and the raise sites; no message was reproduced by running the compiler.

---

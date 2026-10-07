# Chapter 2: Script anatomy, triggers and lookup keys

**Question answered:** What is in a script header, which triggers exist and what fires them, and how does the engine find the script for an event (including `_tree`-style category subjects)?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

### 2.1 Findings: the header

36. The grammar of one script (header, optional parameter list, optional return-type list, then zero or more statements until the next `[`). Source: `RuneScriptTS/src/antlr/RuneScriptParser.g4:11-15`
    ```
    script
        : LBRACK trigger=identifier COMMA name=scriptName MUL? RBRACK
          ((LPAREN parameterList? RPAREN) (LPAREN typeList? RPAREN)?)?
          statement*
        ;
    ```
    - `trigger` is an `identifier` token; whether it is a *valid* trigger is decided later by a name lookup (finding 41).
    - `scriptName` is one or more identifiers; several identifiers are joined with a single space (`RuneScriptTS/src/parser/parser/AstBuilder.ts:152-159`, `identifiers.map(id => id.getText()).join(' ')`).
    - the optional `*` after the name is allowed only for the `command` trigger (finding 41).
    - `parameterList` is `type $name, type $name`; the optional second parenthesis is the **return type list** (`typeList`: types only). Source: `RuneScriptParser.g4:21-31`.

    There is no terminator for a script: it ends where the next line-start `[` begins, i.e. where the parser can no longer continue `statement*` and sees `LBRACK`. (Inference from the grammar; not run.)

37. An `identifier` (trigger names, script names, config names) is lexed as one token of `[a-zA-Z0-9_+.:]+`. So `:` (as in `player_kit:accept`), `.` (as in `.chatnpc`) and even `+` (as in the obj name `unfinished_cheese+tom_batta`) are ordinary name characters. Source: `RuneScriptTS/src/antlr/RuneScriptLexer.g4:74`
    ```
    IDENTIFIER      : [a-zA-Z0-9_+.:]+ ;
    ```
    Real use of a `+` name: `Content/scripts/skill_cooking/scripts/gnome_cooking/gnome_battas.rs2:77` `return(unfinished_cheese+tom_batta);` where `Content/pack/obj.pack:2258` is `2257=unfinished_cheese+tom_batta`.

38. Real headers, as they appear in Content (each is line 1 of the cited script unless a line is given):

    | Header | Where | What it shows |
    |---|---|---|
    | `[opnpc1,hans]` | `Content/scripts/areas/area_lumbridge/scripts/hans.rs2:1` | a script for one specific NPC |
    | `[opnpc1,_citizen]` | `Content/scripts/npc/scripts/man.rs2:1` | a script for every NPC whose config says `category=citizen` |
    | `[oploc1,_tree]` | `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:1` | the same for locs of category `tree` |
    | `[ai_spawn,_]` | `Content/scripts/npc/scripts/ai_spawn.rs2:1` | a *global* script: every NPC |
    | `[login,_]` | `Content/scripts/login_logout/login.rs2:1` | a trigger that only allows the global subject |
    | `[proc,scale_by_playercount](int $base)(int)` | `Content/scripts/general/scripts/player_count.rs2:1` | a proc with one int parameter and one int return |
    | `[label,levelup](stat $stat)` | `Content/scripts/levelup/scripts/levelup.rs2:23` | a label with a parameter, no return |
    | `[queue,tutorial_designed_character]` | `Content/scripts/tutorial/scripts/tutorial.rs2:139` | a named, queueable script |
    | `[softtimer,pk_skull_timer]` | `Content/scripts/skill_combat/scripts/pvp/pk_skull.rs2:40` | a named timer script |
    | `[if_button,player_kit:accept]` | `Content/scripts/tutorial/scripts/tutorial.rs2:133` | an interface button: subject is `interface:component` |
    | `[if_close,player_kit]` | `Content/scripts/tutorial/scripts/tutorial.rs2:136` | interface close: subject is the interface |
    | `[inv_button1,crafting_jewelry:rings_inv]` | `Content/scripts/skill_crafting/scripts/jewellery/jewellery.rs2:1` | an inventory-component button |
    | `[ai_queue3,grip]` | `Content/scripts/drop tables/scripts/grip.rs2:1` | NPC queue slot 3 for one NPC |
    | `[ai_timer,_]` | `Content/scripts/skill_combat/scripts/npc/npc_poison.rs2:1` | NPC timer, all NPCs |
    | `[mapzone,0_29_75]` | `Content/scripts/music/scripts/move.rs2:1` | subject is a map square `level_mx_mz` |
    | `[zone,0_48_52_40_8]` | `Content/scripts/areas/area_draynor/scripts/manor_vines.rs2:1` | subject is a zone `level_mx_mz_lx_lz` |
    | `[advancestat,attack]` | `Content/scripts/levelup/scripts/levelup.rs2:3` | subject is a `stat` |
    | `[walktrigger,pvp_frozen]` | `Content/scripts/skill_combat/scripts/pvp/pvp_magic.rs2:256` | a named walk trigger |
    | `[debugproc,setup_sheep_herder]` | `Content/scripts/_test/scripts/debug/debug_quests.rs2:1` | a developer cheat |
    | `[command,mes](string $text)` | `Content/scripts/engine.rs2:159` | not a script: a **command signature** (section 5) |

    A script can be a one-liner; the whole script is the statement(s) after the `]`. E.g. `Content/scripts/music/scripts/move.rs2:1`
    ```
    [mapzone,0_29_75] @music_playbyregion(coord);
    ```
    and `Content/scripts/skill_woodcutting/scripts/woodcut.rs2:1`
    ```
    [oploc1,_tree] @attempt_cut_tree;
    ```

### 2.2 Findings: the trigger list (compiler side)

39. The compiler's trigger list is the class `ServerTriggerType` (RuneScriptTS), one static instance per trigger with: numeric `id`, `subjectMode`, whether it `allowParameters` / `allowReturns`, and the set of **pointers** it starts with (section 4). All instances are registered by name (lower-cased) at compiler setup. Source: `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:60` (first instance) and `RuneScriptTS/src/runescript/ServerScriptCompiler.ts:65`
    ```ts
    this.triggers.registerAll(ServerTriggerType);
    ```
    The `command` trigger is added separately in the base compiler's constructor (`RuneScriptTS/src/compiler/ScriptCompiler.ts:123`, `RuneScriptTS/src/compiler/trigger/CommandTrigger.ts:6`), plus the meta triggers `proc`, `label`, `queue`, `timer`, `softtimer`, `walktrigger` which the setup code also registers as *types* so they can be used as command arguments (`ServerScriptCompiler.ts:74-84`, `:86`, `:100`, `:180`).

40. The engine has its **own copy** of the numbering, an enum, which must agree with the compiler's `id`s. Source: `Engine-TS/src/engine/script/ServerTriggerType.ts:1-163`, e.g. `:2` `PROC = 0`. Spot checks done: `OPNPC1 = 10` (engine `:13`) equals compiler `OPNPC1` id 10 (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:134-139`); `AI_SPAWN = 166`, `AI_DESPAWN = 167` match the compiler's `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:1142` and `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:1149`. Not every id was compared by hand. **One difference:** the engine enum has `AI_WALKTRIGGER = 156` (`Engine-TS/src/engine/script/ServerTriggerType.ts:150`) but `grep AI_WALKTRIGGER RuneScriptTS/src` finds nothing, so scripts cannot be written with that trigger in this compiler. Also the compiler registers the aliases `IF_BUTTON1..5`/`IF_BUTTOND` with the **same ids** as `INV_BUTTON1..5`/`INV_BUTTOND` (149-154) (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:988-1065`); the engine has only the `INV_BUTTON*` names.

41. `ScriptRegistration.visitScript` validates a header in this order. Source: `RuneScriptTS/src/compiler/semantics/ScriptRegistration.ts:107-182`.
    1. Look the trigger name up; error "`'%s' is not a valid trigger type.`" if unknown (`:108-111`, message `DiagnosticMessage.SCRIPT_TRIGGER_INVALID`).
    2. `*` after the name only for commands (`:119-126`, "`Using a '*' is only allowed for commands.`").
    3. Check the *subject* (finding 43).
    4. Visit the parameters (declares each as a local, `:132-136`, `visitParameter` at `:410-447`), then check the trigger allows parameters (`:383-393`: "`The trigger type '%s' is not allowed to have parameters defined.`").
    5. Build the return type: given explicitly, or a default of `unit` (if the trigger allows returns) or `nothing` (if not). Check against the trigger (`:141-165`, `:398-408`: "`The trigger type '%s' is not allowed to return values.`").
    6. Insert a `ServerScriptSymbol(trigger, name, params, returns)` in the root table; a second script with the same trigger and name is an error "`[%s,%s] is already defined.`" (`:167-178`).

42. Which triggers accept parameters / returns (from the instances): `proc` (params + returns), `label` (params), `debugproc` (params), `queue`, `timer`, `softtimer` (params; they are the ones `queue(...)`/`settimer(...)`/`softtimer(...)` can pass extra arguments to). All others: none. Source: `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:60-76` (proc, label), `:77-83` (debugproc), `:757-763` (queue `allowParameters: true`), `:904-917` (softtimer, timer). Examples with params: `[queue,craft_pottery](namedobj $item, struct $struct, string $name, int $level, int $count)` at `Content/scripts/skill_crafting/scripts/pottery/pottery.rs2:88`.

### 2.3 Findings: the trigger families and what fires them

43. **Subject modes.** A trigger's `subjectMode` says what may appear after the comma (`RuneScriptTS/src/compiler/trigger/SubjectMode.ts:6-30`):
    - `Name`: the "subject" is just part of the script's name; not a reference to anything (procs, labels, queues, timers, walk triggers, debugprocs). `SubjectMode.ts:18`.
    - `None`: only the global form `_` is allowed (`login`, `logout`, `tutorial`, and `opplayer1-5`/`applayer1-5`; verified for ids 87-91 and 94-98 by listing each instance, `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:589-670`). `SubjectMode.ts:12`.
    - `Type(type, category = true, global = true)`: the subject is a reference to a config of that `type` (npc, loc, namedobj, stat, interface, component, coord, mapzone, ...), and optionally also a **category** form (`_name`) and a **global** form (`_`). `SubjectMode.ts:23-29`.

    `checkScriptSubject` applies it. Source: `ScriptRegistration.ts:188-217`
    ```ts
    // Check for global subject
    if (subject === '_') {
    ```
    ```ts
    // Check for category reference subject
    if (subject.startsWith('_')) {
    ```
    That is the rule: **exactly `_` means global; `_` followed by a name means "category <name>"; anything else is a reference to a specific config of the trigger's type.** The category form is only legal if the trigger's `Type(..., category=true)` (error "`Trigger '%s' does not allow category subjects.`") and the name must resolve to a symbol of type `category` (`ScriptRegistration.ts:244-268`, `resolveSubjectSymbol` `:353-378`). Triggers declared with `Type(COMPONENT, false, false)` (`opnpct`, `if_button`, `inv_button*`, `opheldt`, ...) accept neither (`RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:176-181`, `:974-980`).

    This **answers open question 5 (`_tree`):** `[oploc1,_tree]` is the `oploc1` trigger with a *category* subject. `tree` must be a category name; categories come from `category=` lines in `.loc`/`.npc`/`.obj` configs (finding 28), e.g. `Content/scripts/skill_woodcutting/configs/trees/willow.loc:10` `category=tree`.

44. **Trigger table.** Ids are the compiler's. "Fired by" is where Engine-TS looks the script up (read, not run); "Pointers" are the pointers the trigger starts with (section 4: `P` = `p_active_player`, i.e. protected access). `ap` = "approach", `op` = "operate": the engine tries the `op` script when the player is within operable distance and the `ap` script when within approach distance (`Engine-TS/src/engine/entity/Player.ts:1170-1198`). The meaning of the `u`/`t` suffixes is read from the pointer sets and subject types: `...u` additionally sets `last_useitem`/`last_useslot` (use an item on the target); `...t` has a *component* subject (use a component, presumably a spell, on the target; the spell reading is an inference, the variable name `spellComId` at `Engine-TS/src/network/game/client/handler/OpHeldTHandler.ts:61` supports it).

    | Family (ids) | Subject | Pointers | Fired by (engine lookup) |
    |---|---|---|---|
    | `proc` (0), `label` (1), `debugproc` (2) | name | all pointers (proc/label); `active_player` (debugproc) | proc: `~name` compiles to a call (section 3); label: `@name` jumps; debugproc: a `::name` cheat, `ClientCheatHandler.ts:62` `ScriptProvider.getByName(\`[debugproc,${cmd.slice(1)}]\`)`, only when not `production` and staff level >= 4 (`:57-62`) |
    | `apnpc1-5/u/t` (3-9), `opnpc1-5/u/t` (10-16) | npc (or component for `t`) | `active_player`, `p`, `active_npc` | `Player.getApTrigger/getOpTrigger` -> `ScriptProvider.getByTrigger(op+7, ...)` (`Player.ts:1017`, `:1051`); executed at `Player.ts:1176`, `:1198` with protect=true |
    | `aploc*` (59-65), `oploc*` (66-72) | loc | `active_player`, `p`, `active_loc` | same functions |
    | `apobj*` (31-37), `opobj*` (38-44) | namedobj | `active_player`, `p`, `active_obj` | same functions |
    | `applayer*` (87-93), `opplayer*` (94-100) | none (global) or item/component for `u`/`t` | `active_player`, `p`, `active_player2` | same functions |
    | `ai_apnpc*/ai_opnpc*` (17-28), `ai_aploc*/ai_oploc*` (73-84), `ai_apobj*/ai_opobj*` (45-56), `ai_applayer*/ai_opplayer*` (101-112) | npc (the acting NPC) | `active_npc` + the target pointer (`active_npc2`/`active_loc`/`active_obj`/`active_player`) | NPC mode processing: `Npc.getTrigger` -> `getByTrigger(trigger, this.type, type.category)` (`Engine-TS/src/engine/entity/Npc.ts:1066-1070`), run at `Npc.ts:944-954` |
    | `queue` (116) | name | `active_player`, `p` | `queue(...)` command -> `player.enqueueScript` (`PlayerOps.ts:149-158`); processed with `executeScript(script, true)` (`Player.ts:910-911`, `:922-923`) |
    | `ai_queue1-20` (117-136) | npc | `active_npc`, `last_int` | `Npc.processQueue` -> `getByTrigger(request.queueId, type.id, type.category)` (`Npc.ts:575`); also NPC walk triggers `AI_QUEUE1 + walktrigger` (`Npc.ts:362`) |
    | `softtimer` (137), `timer` (138) | name | softtimer: `active_player`; timer: `active_player`, `p` | `Player.processTimers` (`Player.ts:945-960`): `executeScript(script, timer.type === PlayerTimerType.NORMAL)` so a **normal** timer runs protected, a **soft** one does not (`Player.ts:958`) |
    | `ai_timer` (139) | npc | `active_npc` | `Npc.processTimers` -> `getByTrigger(AI_TIMER, ...)` (`Npc.ts:553`) |
    | `opheld1-5/u/t` (140-146) | namedobj (or component for `t`) | `active_player`, `p`, `last_item`, `last_slot` (+ `last_useitem/useslot` for `u`) | `OpHeldHandler.ts:66`, `OpHeldUHandler.ts:94-112`, `OpHeldTHandler.ts:61` |
    | `if_button` (147), `inv_button1-5/d` (149-154) | component | `active_player`, `last_com` or `last_item/last_slot`... | `IfButtonHandler.ts:31`, `InvButtonHandler.ts:52`, `InvButtonDHandler.ts:49`; `p` is granted only for non-overlay interfaces (finding 59) |
    | `if_close` (148) | interface | `active_player` | `Player.ts:737`, `:782`, `:793`, `:804` (`getByTrigger(IF_CLOSE, modal id)`), run with `executeScript(..., false)` |
    | `walktrigger` (155) | name | `active_player`, `p` | `Player.processWalktrigger` (`Player.ts:1108-1116`): `ScriptProvider.get(this.walktrigger)`, i.e. a script *id* stored in the field `Player.walktrigger` (which command stores it was not read) |
    | `login` (157), `logout` (158), `tutorial` (159) | none (`_`) | `active_player`, `p` | `Player.ts:525` (`getByTriggerSpecific(LOGIN, -1, -1)`), `World.ts:780` (`LOGOUT`), `TutClickSideHandler.ts:16` |
    | `advancestat` (160), `changestat` (165) | stat | `active_player`, `p` | `Player.ts:1883` and `:1896`, queued as `PlayerQueueType.ENGINE` |
    | `mapzone` (161), `mapzoneexit` (162), `zone` (163), `zoneexit` (164) | mapzone / coord | `active_player`, `p` | `Player.ts:581-613`: **by name** (`getByName(\`[mapzone,0_${x >> 6}_${z >> 6}]\`)`), enqueued as ENGINE |
    | `ai_spawn` (166), `ai_despawn` (167) | npc | `active_npc` | `World.ts:1297` and `Npc.ts:138` (`getByTrigger(..., type.id, type.category)`), put on `World.npcEventQueue` |

    Sources for the compiler-side columns: the instances at `RuneScriptTS/src/runescript/trigger/ServerTriggerType.ts:60-1155` (read via a one-off listing of every instance's `id`, `subjectMode` and `pointers`; the `1-5` ranges in the first column mean the five numbered variants have the same shape, checked for `apnpc`, `opnpc`, `applayer`, `opplayer`, `ai_*player` and the first/last of the others, not for every single instance).

45. `queue` and the other "named script" arguments are typed. `queue(name, delay, arg)` is checked by `QueueCommandHandler`: argument 0 must be a `queue`-trigger script, argument 1 an int delay, argument 2 an int. Source: `RuneScriptTS/src/runescript/command/QueueCommandHandler.ts:16-26` and its registration `RuneScriptTS/src/runescript/ServerScriptCompiler.ts:86-88`. The `queue*` variant takes the *callee's own parameter list* after the delay (`QueueVarArgCommandHandler.typeCheck`, `RuneScriptTS/src/runescript/command/QueueVarArgCommandHandler.ts:19-34`), and appends a type-code string argument so the engine can pop the right number of values (`generateCode`, `:36-54`). The engine pairs that with `popScriptArgs` in `QUEUEVARARG` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:160-170`).

### 2.4 Findings: how a script is found at runtime (the lookup key)

46. The writer builds the **lookup key** in `BinaryScriptWriter.generateLookupKey`. Source: `RuneScriptTS/src/runescript/writer/BinaryScriptWriter.ts:58-85`
    ```ts
    // Special case for no name.
    if (subjectMode === SubjectMode.Name) {
        return -1;
    }

    let lookupKey = trigger.id;
    ```
    ```ts
    const type = subjectType === ScriptVarType.CATEGORY ? 1 : 2;
    lookupKey += (type << 8) | (subjectId << 10);
    ```
    (the first quote is `BinaryScriptWriter.ts:63-68`, the second is `:80-81`). In words:
    - **Name-mode triggers** (proc, label, queue, timer, softtimer, walktrigger, debugproc): key = `-1`, i.e. "no key". These scripts are never found by trigger; they are found by **script id** (carried on the stack by `gosub`/`queue`/...) or by **full name** (`ScriptProvider.getByName("[debugproc,x]")`).
    - **Global form `_`** (or a trigger whose subject is absent): the writer's `'type' in subjectMode && subject != null` test is false (no `subjectReference` was set for `_`, `ScriptRegistration.ts:222-239` sets none), so key = `trigger.id`.
    - **Category form `_tree`**: `type = 1`, `subjectId` = the **category id** of `tree`: key = `trigger.id + (1 << 8) + (categoryId << 10)`.
    - **Specific form `hans`**: `type = 2`, `subjectId` = the id of that config in its pack: key = `trigger.id + (2 << 8) + (id << 10)`.
    - For `mapzone`/`zone` subjects the "id" is the packed coordinate parsed from the subject (`BinaryScriptWriter.ts:74-75`, `ScriptRegistration.ts:292-348`), which does not fit the bit layout (see finding 48).
    The low 8 bits hold the trigger id (max 167, so it fits), bits 8-9 hold the type, bits 10+ the subject id.

47. At load time the engine puts every script into the map `scriptLookup` under its key (finding 24), and `getByTrigger` tries the three forms **most specific first**. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:124-134`
    ```ts
    let script = ScriptProvider.scriptLookup.get(trigger | (0x2 << 8) | (type << 10));
    if (script) {
        return script;
    }
    script = ScriptProvider.scriptLookup.get(trigger | (0x1 << 8) | (category << 10));
    if (script) {
        return script;
    }
    return ScriptProvider.scriptLookup.get(trigger);
    ```
    `getByTriggerSpecific` tries exactly one of the three (type if `type !== -1`, else category if `category !== -1`, else global). Source: `ScriptProvider.ts:147-154`.

    Worked example (arithmetic by hand from the code above; not run):
    - Click "Talk-to" on the NPC type `hans` (pack id 0, `Content/pack/npc.pack:1`). `OPNPC1` = 10. `getByTrigger(10, 0, categoryOfHans)` first looks up `10 | 0x200 | (0 << 10)` = 522. The compiler wrote `[opnpc1,hans]` (hans.rs2:1) with key `10 + (2<<8) + (0<<10)` = 522. Found: Hans's own script wins.
    - Click the NPC type `man` (id 1, `npc.pack:2`). No `[opnpc1,man]` exists. The first lookup (`10 | 512 | (1<<10)` = 1546) misses; the second looks up `10 | 256 | (citizenId << 10)`; `Content/scripts/npc/scripts/man.rs2:1` `[opnpc1,_citizen]` was written with exactly that key (the `man` config has `category=citizen`, `_unpack/225/all.npc:30`), so the category script runs.
    - An NPC with neither: the third lookup `scriptLookup.get(10)` finds a `[opnpc1,_]` script if one exists, else `undefined` and the engine prints "Nothing interesting happens." (`Player.ts:1142`; in non-production also `No trigger for [...]`, `Player.ts:1123-1139`).

    This is also the answer to **open question 25**: `Content/scripts/npc/scripts/ai_spawn.rs2:1` `[ai_spawn,_]` has subject `_`, so it is written with key = `AI_SPAWN`'s id (166), which is exactly the third lookup in `getByTrigger`. `World.ts:1297` calls `getByTrigger(AI_SPAWN, type.id, type.category)`, so for every NPC without a more specific `[ai_spawn,<npc>]` or `[ai_spawn,_<category>]` script the global script is found and a spawn event is put on `World.npcEventQueue` (`World.ts:1298-1299`). Content has two `ai_spawn` scripts: `Content/scripts/npc/scripts/ai_spawn.rs2:1` (global) and `Content/scripts/_test/scripts/cheats/cheat_npc.rs2:59` (`[ai_spawn,small_bat]`, in `_test`). Whether the event queue is then actually drained each tick is documented in `docs/tick/03-npc-event-queue.md` (not re-checked here). That *every* NPC spawn queues an entry is therefore explained by code that was read; what was **not** observed is a running server's queue length.

48. **Zones and mapzones are looked up by name, not by key.** The comment says why: `Engine-TS/src/engine/entity/Player.ts:581` `// todo: getByTrigger needs more bits to lookup by coord`, and then `Player.ts:582`
    ```ts
    const trigger = ScriptProvider.getByName(`[mapzone,0_${x >> 6}_${z >> 6}]`);
    ```
    (and the same pattern at `:589`, `:600`, `:611` for `mapzoneexit`, `zone`, `zoneexit`). For this to work, the script's stored full name must be exactly that string: `RuneScript.fullName` is `[${trigger.identifier},${name}]` (`RuneScriptTS/src/compiler/codegen/script/RuneScript.ts:50`) and the header text is the name (e.g. `Content/scripts/music/scripts/move.rs2:1` `[mapzone,0_29_75]`).

49. **Name lookup.** `ScriptProvider.getByName` uses the `scriptNames` map filled from each script's stored full name. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:105-111` and `:70`. Engine uses: `[debugproc,...]` (`ClientCheatHandler.ts:62`), `[queue,<name>]` for a friends-server relay message (`World.ts:2070`), and the four zone triggers above. Everything else that is name-mode is reached through ids baked into other scripts' bytecode.

50. **How a name-mode script id gets into a calling script.** When the type checker resolves the identifier `tutorial_designed_character` in `queue(tutorial_designed_character, 0, 0)` against the expected `queue` type, it finds the script symbol; the code generator then emits `Opcode.PushConstantSymbol`, and the writer turns a symbol into its integer id through the `SymbolMapper`: for script symbols that id is the entry for `"[queue,tutorial_designed_character]"` in `script.pack`. Sources: `RuneScriptTS/src/compiler/semantics/TypeChecking.ts:1288-1336` (`resolveSymbol`), `RuneScriptTS/src/compiler/codegen/CodeGenerator.ts:786-811` (`visitIdentifier`), `RuneScriptTS/src/runescript/SymbolMapper.ts:58-81` (the key built at `:72` is `[${symbol.trigger.identifier},${symbol.name}]`), `BinaryScriptWriter.ts:103-120` (`writePushConstantSymbol`).

### 2.5 Examples: three scripts and how each is keyed

| Script | Kind | Key written by the compiler | Found by |
|---|---|---|---|
| `[opnpc1,hans]` (`hans.rs2:1`) | specific | `10 + 512 + (npcId("hans") << 10)` | `getByTrigger(10, npcType, cat)`, first lookup |
| `[opnpc1,_citizen]` (`Content/scripts/npc/scripts/man.rs2:1`) | category | `10 + 256 + (categoryId("citizen") << 10)` | same call, second lookup |
| `[ai_spawn,_]` (`ai_spawn.rs2:1`) | global | `166` | same pattern, third lookup |
| `[proc,scale_by_playercount]` (`player_count.rs2:1`) | name | `-1` (not in the lookup) | by id, via `gosub` operand |
| `[mapzone,0_29_75]` (`move.rs2:1`) | mapzone | `trigger + (2<<8) + (packed << 10)` with a 28-bit packed coordinate, so the `<< 10` wraps in 32 bits (arithmetic, not run) | by exact full name (finding 48) |

### 2.6 Inferences (labelled), section 2

- *Inference D:* the id `-1` for name-mode scripts means `ScriptState.trigger` (`script.info.lookupKey & 0xff`, `Engine-TS/src/engine/script/ScriptState.ts:133`) is 255 for them. Rests on findings 46 and 22. Not checked whether anything reads `state.trigger` for such scripts.
- *Inference E:* the three-step `getByTrigger` means a more specific script **shadows** the category and global ones completely (it does not also run them). Rests on finding 47 (early returns). If content wants both, it must call the other explicitly (e.g. a proc), which is what `gosub(npc_death)` at `Content/scripts/drop tables/scripts/grip.rs2:2` and 228 other `gosub(` uses in Content look like (a count of text matches; not each one examined).
- *Inference F:* the packed coordinate for `mapzone`/`zone` subjects is up to 28-30 bits (`ScriptRegistration.ts:317` `(z & 0x3fff) | ((x & 0x3fff) << 14)`; zone adds level bits at `:347`), and `BinaryScriptWriter.ts:81` shifts it `<< 10`; in JavaScript a `<<` result is wrapped to 32 bits, so the stored key is a truncated number. The engine looks these scripts up by name (finding 48), so the truncated key is not used for them. What *is* possible (not analysed, listed in 2.7) is that a truncated key equals the real key of an unrelated script, in which case `scriptLookup.set` (`ScriptProvider.ts:74`) would silently overwrite one with the other.

### 2.7 Not checked, section 2

- Each trigger's engine firing path beyond the lines quoted (e.g. the exact packet that sets `targetOp`); see `docs/flows/click-loc-woodcutting.md` for one traced example.
- That all compiler ids equal all engine ids (only spot-checked).
- What happens on a duplicate lookup key (`scriptLookup.set` overwrites, `ScriptProvider.ts:74`; the compiler's `SCRIPT_REDECLARATION` only rejects identical trigger+name pairs, `ScriptRegistration.ts:171-173`). For ordinary subjects two different scripts cannot share a key (different trigger or different subject id), but the truncated `mapzone`/`zone` keys (Inference F) were not checked for collisions with other keys.

---

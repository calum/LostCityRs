# Chapter 1: What RuneScript is here, and the toolchain from `.rs2` to the engine VM

**Question answered:** How does a `.rs2` file become something the engine runs, and what are the other config languages and id tables around it?

**Based on commits:**
- RuneScriptTS: `c454554` (branch `calum-research`)
- Engine-TS: `1d25566c` (branch `calum-research`, based on upstream `274`)
- Content: `65b754f76`

**Method:** read code only. Nothing was run: `node_modules`, the ANTLR-generated parser and `Engine-TS/data/pack` are absent in this checkout, so no compile output exists. Every bytecode listing is a hand-trace of the code generator and writer source. Line numbers were taken with `grep -n` after reading; `docs/tools/check_citations.py` passes.

Book: [An introduction to RuneScript](README.md).

---

### 1.1 Findings: the pipeline in one picture

```
Content/scripts/**/*.rs2          source text (scripts)          10,938 script headers in 1,416 files (counted by regex, see Method note in 1.9)
Content/scripts/**/*.{npc,loc,obj,...}  config text (data)       one [name] block per config
Content/pack/*.pack               "id=name" tables that fix ids  (some committed, some generated)
        |
        |  Engine-TS/tools/pack/Build.ts  ->  packAll()          (npm run build / first start / dev watcher)
        v
   revalidatePack()       make every .pack file agree with the names found in the sources
   packConfigs()          parse + pack the config files into data/pack/server/*.dat/.idx (+ client config)
   runServerCompiler()    Engine-TS/tools/pack/Compiler.ts  builds the symbol tables
        |
        |  CompileServerScript({ symbols })       (@lostcityrs/runescript = RuneScriptTS)
        v
   parse (ANTLR)  ->  analyze (register + type check)  ->  codegen  ->  pointer check  ->  write
        |
        v
Engine-TS/data/pack/server/script.dat + script.idx    binary bytecode, one entry per script id
        |
        |  ScriptProvider.load('data/pack')  (World.reload)
        v
ScriptFile objects  ->  ScriptRunner.execute(ScriptState)  (the VM)
```

The numbered facts behind this picture:

1. `npm run build` is `tsx tools/pack/Build.ts`; `npm start` is `npm install && tsx src/app.ts`; `npm run dev` is `tsx watch src/app.ts`. Source: `Engine-TS/package.json:14`, `Engine-TS/package.json:30`, `Engine-TS/package.json:19`.

2. `Build.ts` does nothing but call `packAll`. Source: `Engine-TS/tools/pack/Build.ts:7`
   ```ts
   await packAll(modelFlags);
   ```

3. `app.ts` (the `start`/`quickstart` entry) runs `packAll` itself when the cache or the compiled script file is missing, then starts the world. Source: the `packAll` call is at `Engine-TS/src/app.ts:20`, under the condition at `Engine-TS/src/app.ts:14`
   ```ts
   if (OnDemand.cache.count(0) !== 9 || OnDemand.cache.count(2) === 0 || !fs.existsSync('data/pack/server/script.dat')) {
   ```
   So a fresh start compiles scripts if `data/pack/server/script.dat` is absent. Whether an *existing but stale* `script.dat` is rebuilt on `npm start` is decided inside `packAll` (finding 5), but `app.ts` only calls `packAll` under the condition above. Not verified: what happens on `npm start` when the Content sources changed but all three conditions are false (inference: nothing is repacked then; the `dev` watcher is the live-rebuild path, finding 7).

4. `packAll` is the orchestrator. In order: clear the filesystem cache, `revalidatePack()` (reconcile `.pack` files with sources), `packConfigs()` (data configs), `packClientInterface()`, then conditionally the **script compiler**, then client assets (title, media, textures, wordenc, sound, graphics, midi, maps, version list). Source: `Engine-TS/tools/pack/PackAll.ts:125-146`
   ```ts
   clearFsCache();
   await revalidatePack();
   ```
   and the compiler call at `Engine-TS/tools/pack/PackAll.ts:140-144`
   ```ts
   // relies on reading configs/interfaces for compile-time context
   if (shouldRunServerCompiler()) {
   ```

5. The compiler is run only when something it depends on changed. `shouldRunServerCompiler` returns true if `script.idx` is missing, or any `.rs2` is newer than `script.dat`, or any file with an extension in `COMPILER_DIRECT_SOURCE_EXTENSIONS` is newer, or any of a long list of `.pack` files, engine source files (e.g. `src/engine/script/ScriptOpcode.ts`, `ScriptOpcodePointers.ts`, `tools/pack/Compiler.ts`) or server `.dat` files is newer. Source: `Engine-TS/tools/pack/PackAll.ts:35-44` and the extension list at `Engine-TS/tools/pack/PackAll.ts:21`
   ```ts
   const COMPILER_DIRECT_SOURCE_EXTENSIONS = ['.constant', '.dbrow', '.dbtable', '.inv', '.param', '.varbit', '.varn', '.varp', '.vars'];
   ```

6. The compiler (RuneScriptTS) is consumed as the npm package `@lostcityrs/runescript`. Source: `Engine-TS/tools/pack/Compiler.ts:3`
   ```ts
   import { CompileServerScript } from '@lostcityrs/runescript';
   ```
   `RuneScriptTS/src/Compiler.ts:1-3` re-exports `CompileServerScript` from `RuneScriptTS/src/runescript/ServerScriptCompilerApplication.ts`. (How the package in `node_modules` relates to the `RuneScriptTS/` checkout, i.e. which version `npm install` fetches, is *not verified*; `RuneScriptTS/README.md` says to copy `dist/runescript.js` into the consumer's `node_modules` to test changes, which suggests they are separate installs.)

7. Live reload: `npm run dev` watches files; `DevThread` calls `packAll` again on change and posts `dev_reload`, and `World` answers by calling `reload()`, which re-reads `script.dat`. Source: `Engine-TS/src/cache/DevThread.ts:26`, `Engine-TS/src/engine/World.ts:1766-1767`, `Engine-TS/src/engine/World.ts:274`
   ```ts
   const count = ScriptProvider.load('data/pack');
   ```

8. The default location of the source tree is `../content` relative to `Engine-TS` (all-lowercase) and is overridable with `BUILD_SRC_DIR`. Source: `Engine-TS/src/util/WorldConfig.ts:142` and `Engine-TS/src/util/WorldConfig.ts:276`. In this checkout the directory is named `Content` (capital C). On a case-sensitive file system the default would not resolve; how the project's own setup scripts handle that was *not checked* (`Server/` was not read).

### 1.2 Findings: what `runServerCompiler` hands to the compiler

`Engine-TS/tools/pack/Compiler.ts` is the glue. It builds a table of **symbols** (name <-> id) for every kind of thing a script can mention, then calls `CompileServerScript`. Source: `Engine-TS/tools/pack/Compiler.ts:107` (function start) to `Engine-TS/tools/pack/Compiler.ts:376` (end).

9. **Commands.** Every entry of the engine's `ScriptOpcodeMap` (name -> opcode number) becomes a compiler "command" symbol, and the engine's `ScriptOpcodePointers` table is copied in as per-command pointer rules (`require`, `set`, `corrupt`, ...). Source: `Engine-TS/tools/pack/Compiler.ts:108-147`
   ```ts
   const allCommands = Array.from(ScriptOpcodeMap.entries()).sort((a, b) => a[1] - b[1]);
   ```
   The compiler therefore learns the *opcode id* of each command from the engine; it learns the *signature* (parameter and return types) from `Content/scripts/engine.rs2` (section 5).

10. **Constants.** All `*.constant` files are read; the text after `=` is stored as a string under the name without the `^`. Source: `Engine-TS/tools/pack/Compiler.ts:149-171`. Constants are *text*, parsed later by the compiler against a type hint (section 3, finding 28).

11. **Id maps.** The following kinds are loaded from `Content/pack/<kind>.pack` with `CompilerTypeInfo.load` ("`id=name`" lines): npc, obj, inv, seq, idk, spotanim, loc, interface (components), varp, varbit, varn, vars, param, struct, enum, hunt, mesanim, synth, category, script, dbtable, dbrow, midi. Source: `Engine-TS/tools/pack/Compiler.ts:174-199` (e.g. `Engine-TS/tools/pack/Compiler.ts:174`
    ```ts
    const npcInfo = CompilerTypeInfo.load(`${Environment.build.srcDir}/pack/npc.pack`);
    ```
    ). The `load` function splits each line on `=` and calls `add(parseInt(id), name)`. Source: `Engine-TS/tools/pack/Compiler.ts:40-58`.

12. **Extra type information read from the freshly packed config.** After `packConfigs` has written the server `.dat` files, `Compiler.ts` reloads them (`InvType.load('data/pack')`, `VarPlayerType.load`, `ParamType.load`, `DbTableType.load`, ...) to attach: a `protect` flag per varp / varbit / inv; the script value *type* of each varp / varbit / varn / vars / param (`vartype`); the overlay/non-overlay status of each interface component; and, for every database table column, a synthetic symbol `table:column` with its column types. Source: `Engine-TS/tools/pack/Compiler.ts:201-304`; the column symbols are built at `Engine-TS/tools/pack/Compiler.ts:293` (second quote) and the varp flag at `Engine-TS/tools/pack/Compiler.ts:237` (first quote)
    ```ts
    varpInfo.protect[id] = varp.protect;
    ```
    ```ts
    dbcolumnInfo.add(columnIndex, `${table.debugname}:${table.columnNames[column]}`, false);
    ```
    This is why `PackAll` must run `packConfigs` *before* the script compiler (comment at `Engine-TS/tools/pack/PackAll.ts:140`).

13. **Fixed enumerations from engine code.** Stats, NPC stats and NPC modes come from the engine's `PlayerStatMap`, `NpcStatMap`, `NpcModeMap`; font names and loc shapes are hard-coded lists. Source: `Engine-TS/tools/pack/Compiler.ts:306-335`, e.g. `Engine-TS/tools/pack/Compiler.ts:310`
    ```ts
    const fontmetricsInfo = CompilerTypeInfo.loadArray(['p11_full', 'p12_full', 'b12_full', 'q8_full']);
    ```

14. `CompileServerScript` requires at least the `command` and `runescript` symbol tables, defaults the source path to `../content/scripts`, the output to `./data/pack/server`, and pointer checking to **on**. Engine-TS passes only `symbols`, so these defaults apply. Source: `RuneScriptTS/src/runescript/ServerScriptCompilerApplication.ts` lines `:31-32` (required symbols), `:38` (pointer checking, second quote), `:40` (output, third quote) and `:36` (source path, first quote)
    ```ts
    let sourcePaths: string[] = ['../content/scripts'];
    ```
    ```ts
    let checkPointers: boolean = true;
    ```
    ```ts
    let jagWriterConfig = { output: './data/pack/server' };
    ```

15. `CompileServerScript` registers every command and script name -> id in a `SymbolMapper` (the compiler's "id provider") and copies command pointer rules into a map; secondary-pointer rules are stored under the key `.name`. Source: `RuneScriptTS/src/runescript/ServerScriptCompilerApplication.ts:90-117`, in particular `:106`
    ```ts
    commandPointers.set(`.${name}`, { required: required2, set: setter2, conditionalSet, corrupted: corrupted2 });
    ```

### 1.3 Findings: the compiler's five stages

16. `ScriptCompiler.run('rs2')` loads symbols, then `compile`, then closes the writer. Source: `RuneScriptTS/src/compiler/ScriptCompiler.ts:218-224`. `compile` is five numbered steps; each returns early if its diagnostics contain an error. Source: `RuneScriptTS/src/compiler/ScriptCompiler.ts:238-265`
    ```ts
    // 1) Parse all files.
    ```
    ```ts
    // 2) Analyze the nodes.
    ```
    ```ts
    // 3) Generate code
    ```
    ```ts
    // 4) Check pointers
    ```
    ```ts
    // 5) Write scripts
    ```

17. Parsing walks the source directory recursively (`walkTopDown`, `ScriptCompiler.ts:586`), picks files ending in `.rs2` (`ScriptCompiler.ts:296`), and, because the `macros` feature is on by default, first collects `*.macro` files and expands macros in each source before parsing. Source: `RuneScriptTS/src/compiler/ScriptCompiler.ts:280-292`, `:305-315`. There are **no** `.macro` files under `Content/` (`find Content -name '*.macro'` returned nothing), so macro expansion is a no-op here. The feature flag comment says macros are "EARLY-AUTHENTIC: This was phased out to be replaced by procs." Source: `RuneScriptTS/src/compiler/StrictFeatureLevel.ts:19-25`.

18. "Analyze" is two visitors over every file: `ScriptRegistration` (declares each script's symbol, validates the header, parameter types and return types) and then `TypeChecking` (bodies). Source: `RuneScriptTS/src/compiler/ScriptCompiler.ts:346` and `:363`.

19. Diagnostics are collected per stage; the default handler prints `file:line:col: TYPE: message` plus a caret line and then calls `process.exit(1)` if any error occurred. Source: `RuneScriptTS/src/compiler/diagnostics/DiagnosticsHandler.ts:98-100` and `:143-145`
    ```ts
    console.log(`${location}: ${diag.type}: ${util.format(diag.message, ...diag.messageArgs)}`);
    ```
    ```ts
    process.exit(1);
    ```
    So on an error the compiler calls `process.exit(1)` from inside the diagnostics handler, before `run()` reaches `close()` (the call that writes `script.dat`/`script.idx`, `ScriptCompiler.ts:221-223`); on that path no new `script.dat` is written. What the *caller* (`packAll` in the main process or in the dev worker) then does with the exit was not checked. A second, different early return exists: `checkPointers` returns `false` when the command-pointer map is empty (`ScriptCompiler.ts:441-445`), which makes `compile` skip step 5 *without* any diagnostic; `close()` would then still run. Engine-TS always supplies pointer data (`Compiler.ts:108-147`), so this is a corner of the API, not something Content hits.

### 1.4 Findings: the output file, `script.dat` / `script.idx`

20. The default writer is `JagFileScriptWriter`. It buffers every script's bytes keyed by script id and, on `close()`, writes `script.dat` and `script.idx` into `./data/pack/server`. Source: `RuneScriptTS/src/runescript/writer/JagFileScriptWriter.ts:33` (id from the id provider), `:40-41` (file names)
    ```ts
    const id = this.idProvider.get(script.symbol);
    ```
    The container format is:
    - both files start with a big-endian int32 *entry count including gaps* (`lastId + 1`), `JagFileScriptWriter.ts:50-52`;
    - `script.dat` then has an int32 **version** (27), `JagFileScriptWriter.ts:17`, `:55`
      ```ts
      private static readonly VERSION = 27;
      ```
    - then, for every id from 0 to `lastId`, `script.idx` receives the script's byte length (or 0 for a gap) and `script.dat` receives the bytes. Source: `JagFileScriptWriter.ts:56-67`.

21. The engine side agrees on the version and refuses to start otherwise. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:12` and `:49-52`
    ```ts
    public static readonly COMPILER_VERSION = 27;
    ```
    and the fatal message at `:51` ("Scripts were compiled with an incompatible script compiler. Please run `npm install`, then `npm run build`, and restart the server.").

22. **One script's bytes**, as written by `BinaryScriptWriterContext.finish()` (source `RuneScriptTS/src/runescript/writer/BinaryScriptWriterContext.ts:123-179`) and read back by `ScriptFile.decode` (source `Engine-TS/src/engine/script/ScriptFile.ts:58-127`). In order:
    1. full name string, e.g. `[opnpc1,hans]`, NUL-terminated (`BinaryScriptWriterContext.ts:129`);
    2. source file path, NUL-terminated (`:130`);
    3. int32 **lookup key** (`:132`), the number the engine uses to find "the script for this event" (section 2);
    4. a byte: 0 for most scripts; for `[debugproc,...]` scripts it is the parameter count followed by one type-code byte per parameter (`:135-144`);
    5. uint16 count and then (pc, line) int32 pairs: the line-number table used in error backtraces (`:146-154`);
    6. the instructions: each is a uint16 opcode followed by a 4-byte operand (large) or 1-byte operand (small); `PUSH_CONSTANT_STRING` instead carries a NUL-terminated string (`BinaryScriptWriterContext.ts:63-101`);
    7. a trailer: int32 instruction count, uint16 int-local count, string-local count, int-arg count, string-arg count, a byte switch-table count, the switch tables, and a final uint16 trailer length (`:159-176`).

    `ScriptFile.decode` finds the trailer first (`ScriptFile.ts:64-67`)
    ```ts
    const trailerPos = length - trailerLen - 12 - 2;
    ```
    then reads the header, then the instruction stream. It decides whether an opcode has a 4-byte or 1-byte operand with `isLargeOperand` (`ScriptFile.ts:19-34`), which must agree with the compiler's per-opcode `largeOperand` flag (`RuneScriptTS/src/runescript/ServerScriptOpcode.ts:13-46`).

23. Name used in the header comment: `ScriptFile.decode` is documented as "decodes the same binary format as clientscript2". Source: `Engine-TS/src/engine/script/ScriptFile.ts:57`. (That RuneScript's bytecode shares its layout with the client's CS2 format is the code comment's claim; the CS2 format itself was not read.)

24. `ScriptProvider.parse` reads the entries, calls `ScriptFile.decode(id, ...)` for each non-empty slot, stores the script by id in `scripts[id]`, by name in `scriptNames` (the full `[trigger,name]` string), and in `scriptLookup` by **lookup key** unless the key is the "none" marker. Source: `Engine-TS/src/engine/script/ScriptProvider.ts:59-76`
    ```ts
    scriptNames.set(script.name, id);
    ```
    ```ts
    if (script.info.lookupKey !== 0xffffffff) {
    ```
    *Observation (not a claim about behaviour):* the compiler writes the "no key" marker as the int32 `-1` (`RuneScriptTS/src/runescript/writer/BinaryScriptWriter.ts:65`) and `ScriptFile.decode` reads it with `g4s()`, a **signed** read (`Engine-TS/src/io/Packet.ts:251-255`), giving `-1`. `-1 !== 0xffffffff` (4294967295) is true in JavaScript. Hence, as the code reads, name-keyed scripts (procs, labels, queues, timers, ...) also get inserted into `scriptLookup` under key `-1`, each overwriting the previous one. This is harmless as long as nothing looks up key `-1`; `getByTrigger` with the default `type = -1` builds keys like `trigger | 0x200 | (-1 << 10)`, which are negative but are not `-1` for any trigger id below 256 (arithmetic, finding 47). Not run; logged under "Not checked".

### 1.5 Findings: the id tables (`*.pack`), who owns them, and how names become ids

25. A `.pack` file is plain text, one `id=name` per line. `PackFile.load` accepts only lines matching `^\d+=`; `save` rewrites the file sorted by id. Source: `Engine-TS/tools/pack/PackFileBase.ts:65` and `:120-128`
    ```ts
    if (line.length === 0 || !/^\d+=/g.test(line)) {
    ```
    Real examples: `Content/pack/npc.pack:1-3` is
    ```
    0=hans
    1=man
    2=man2
    ```
    and `Content/pack/loc.pack:2573` is `2572=loc_2572`.

26. Which packs are shared with the client and so must keep stable ids? The code distinguishes *transmitted* packs (`loc`, `npc`, `obj`, `seq`, `flo`, `idk`, `spotanim`, `varp`, `varbit`; the `true` last argument) from the rest. For a **non-transmitted** pack (e.g. `enum`, `inv`, `param`, `struct`, `dbtable`, `dbrow`, `hunt`, `mesanim`, `varn`, `vars`) any name found in a source file but missing from the pack is **auto-registered** with the next free id and the pack file is rewritten; for a **transmitted** pack a missing name is an error ("Missing loc pack ID for: ... You may need to edit .../pack/loc.pack") unless `BUILD_VERIFY=false`. Source: `Engine-TS/tools/pack/PackFile.ts:131-187`, esp. `:143-151` and `:162-174`
    ```ts
    pack.register(pack.max++, names[i]);
    ```
    Declarations: `Engine-TS/tools/pack/PackFile.ts:282-307` (e.g. `:290` `LocPack = new PackFile('loc', validateConfigPack, '.loc', true)` vs `:284` `EnumPack = new PackFile('enum', validateConfigPack, '.enum')`).

27. **Script ids** are assigned the same auto-registering way, from the bracketed header text: `regenScriptPack` crawls every `.rs2` file, takes each line beginning with `[`, keeps the text through `]` *including the brackets*, and registers unknown names with `pack.max++`. `engine.rs2` is skipped, because its `[command,...]` entries are signatures, not scripts. Source: `Engine-TS/tools/pack/PackFile.ts:255-274` and `:366-402`, esp. `:266`, `:370`, `:381`
    ```ts
    const names = crawlConfigNames('.rs2', true);
    ```
    ```ts
    if (file === `${Environment.build.srcDir}/scripts/engine.rs2`) {
    ```
    Consequence: a script's id is just its position in `Content/pack/script.pack`, a file which is **not committed** (`Content/.gitignore:4`, `pack/script.pack`) and is regenerated on every run from the sources; an existing id is kept, new ones are appended. Source for "not committed": `Content/.gitignore:3-4`.

28. **Categories** (the `category=` key on a loc / npc / obj config) get their ids the same generated way: `crawlConfigCategories` scans `.loc`, `.npc`, `.obj` files for lines starting `category=` and registers each distinct value; `category.pack` is also git-ignored. Source: `Engine-TS/tools/pack/PackFile.ts:405-439` (e.g. `:412`), `Content/.gitignore:6`.

29. Folder rules, enforced when `BUILD_VERIFY_FOLDER` is true (the default): `.rs2` files must sit in a directory named `scripts` (or directly below one), config files in a `configs` directory (or directly below), except under `_unpack`. Source: `Engine-TS/tools/pack/PackFile.ts:384-394` and the default `Engine-TS/src/util/WorldConfig.ts:139`.

30. **Name matching is case- and space-insensitive for config symbols.** `SymbolTable` normalizes the names of "basic" symbols (the config symbols loaded from the pack files, section 1.2) with `name.toLowerCase().replace(/\s+/g, '_')`; script symbols (`[proc,x]`) use exact names. Source: `RuneScriptTS/src/compiler/symbol/SymbolTable.ts:20-25`
    ```ts
    return name.toLowerCase().replace(/\s+/g, '_');
    ```

### 1.6 Findings: the config languages (what each file extension is)

The packer crawls `Content/scripts` recursively with `readDirTree` and, for each extension, `readConfigs` parses files of the form

```
[config_name]
key=value
key=value
```

Source for the format: `Engine-TS/tools/pack/config/PackShared.ts:223-257` (block header `[`...`]`, duplicate-name error, "Missing property separator" error), lines starting `//` and empty lines are skipped (`PackShared.ts:219`).

31. **`^constant` substitution happens inside config values too.** While reading a config line, any `^name` in the value that matches a loaded constant is replaced by the constant's text before the value is parsed. Source: `Engine-TS/tools/pack/config/PackShared.ts:262-285` (comment at `:263`) and `loadConstants` at `:323-352`.

32. The extensions the packer handles, what the packer does with each, and one short real example of each. The "id table" column says which pack file holds the name -> id mapping (finding 26). Sources for the per-extension dispatch: `Engine-TS/tools/pack/config/PackShared.ts:475-840` and the pack declarations `Engine-TS/tools/pack/PackFile.ts:278-307`. The list of extensions snapshot-watched is `Engine-TS/tools/pack/PackFile.ts:315`.

| Ext | What one `[block]` defines | Output / consumer | Id table |
|---|---|---|---|
| `.rs2` | scripts (not config) | `script.dat` via RuneScriptTS | `script.pack` (generated) |
| `.constant` | `^name = value` lines (no blocks) | substituted by the packer into configs; kept as text by the compiler | none |
| `.npc` | a non-player character type | server + client `config` archive | `npc.pack` |
| `.loc` | a scenery/location type (trees, doors) | server + client | `loc.pack` |
| `.obj` | an item type | server + client | `obj.pack` |
| `.inv` | an inventory definition (size, stock, scope) | server | `inv.pack` |
| `.seq` | an animation sequence (`frameN=` keys in the example below) | server + client | `seq.pack` |
| `.spotanim` | a spot animation: `model`, `anim`, `ambient`, `contrast` per `Content/scripts/_unpack/274/all.spotanim:1-5` | server + client | `spotanim.pack` |
| `.idk` | an identity-kit config (`IdkConfig.ts`; the packer dispatch was read, the format was not; no example shown) | server + client | `idk.pack` |
| `.flo` | a floor config; the example below sets a `colour` | server + client | `flo.pack` |
| `.param` | a typed parameter that configs can carry (`param=name,value`) | server | `param.pack` |
| `.struct` | a bag of params | server | `struct.pack` |
| `.enum` | an input-type to output-type lookup | server | `enum.pack` |
| `.dbtable` | a database table schema (columns) | server | `dbtable.pack` |
| `.dbrow` | one row of a table | server | `dbrow.pack` |
| `.varp` | a player variable | server (+ client for `clientcode`) | `varp.pack` |
| `.varbit` | a bit range inside a varp | server + client | `varbit.pack` |
| `.varn` | an NPC variable | server | `varn.pack` |
| `.vars` | a world-wide ("shared") variable | server | `vars.pack` |
| `.hunt` | a hunt definition (`type=npc`, `check_npc`, `rate`, ... in the example below) | server | `hunt.pack` |
| `.mesanim` | a named set of chat animations (keys `len1`..`len4` in the example below) | server | `mesanim.pack` |
| `.if` | a client interface (components) | client `interface` archive | `interface.pack` (names `iface:component`) |

   The extension list and the `readConfigs` calls are verified in the cited ranges; the descriptions in the second column are my summary of the example files below (read) and of the `Config.ts` parsers' key names (only partly read: `VarpConfig.ts` fully, the others by their `key ===` branches in the dispatch, not line by line). Treat the "Output / consumer" column as *read at the dispatch level*, not as a full account of the byte formats.

33. Real examples (each is the start of a real file; all are short):

    `.npc`, `Content/scripts/_unpack/225/all.npc:1-8, 30`
    ```
    [man]
    walkanim=human_walk_f,human_walk_b,human_walk_l,human_walk_r
    readyanim=human_ready
    op2=Attack
    op3=Pickpocket
    name=Man
    desc=One of RuneScape's many citizens.
    op1=Talk-to
    ```
    (and line 30 is `category=citizen`, which is what a script header `[opnpc1,_citizen]` refers to, section 2).

    `.loc`, `Content/scripts/skill_woodcutting/configs/trees/willow.loc:1-12`
    ```
    [willowtree]
    name=Willow
    desc=These trees are found near water.
    model=plants_willowtree
    width=2
    length=2
    mapscene=3
    op1=Chop down
    op3=hidden
    category=tree
    param=next_loc_stage,treestump2_green
    param=ent,macro_ent_willow
    ```

    `.obj`, `Content/scripts/skill_cooking/configs/cooking_generic/food_cooked.obj:1-5`
    ```
    [cooked_ugthanki_meat]
    name=Ugthanki meat
    desc=Freshly cooked ugthanki meat.
    cost=5
    model=inv_meat
    ```

    `.inv`, `Content/scripts/skill_crafting/configs/jewellery/jewellery.inv:1-5`
    ```
    [crafting_make_rings]
    scope=temp
    size=6
    dummyinv=yes
    stock1=gold_ring,1,0
    ```

    `.seq`, `Content/scripts/skill_cooking/configs/cooking_source/cooking_sources.seq:1-4`
    ```
    [human_firecooking]
    replaceheldleft=hide
    replaceheldright=hide
    frame1=anim_1233
    ```

    `.param`, `Content/scripts/skill_cooking/configs/gnome_cooking/gnome_cooking.param:1-7`
    ```
    [gnome_cooking_struct]
    type=struct
    default=null

    [cocktail_message]
    type=string
    default=null
    ```

    `.struct`, `Content/scripts/skill_cooking/configs/gnome_cooking/gnome_cooking.struct:1-2`
    ```
    [crunchy_tray]
    param=product,raw_crunchies
    ```

    `.enum`, `Content/scripts/player/configs/stat.enum:1-5`
    ```
    [stats]
    inputtype=int
    outputtype=stat
    default=null
    val=1,attack
    ```

    `.dbtable`, `Content/scripts/skill_woodcutting/configs/trees.dbtable:1-7`
    ```
    [woodcutting_trees]
    column=levelrequired,int
    column=tree,loc,LIST,INDEXED,REQUIRED
    column=productexp,int
    column=product,namedobj
    column=respawnrate,int
    column=successchance,namedobj,int,int,LIST
    ```

    `.dbrow`, `Content/scripts/skill_woodcutting/configs/trees.dbrow:1-4`
    ```
    [normal_tree_table]
    table=woodcutting_trees
    data=tree,tree
    data=tree,lighttree
    ```

    `.varp`, `Content/scripts/tutorial/configs/tutorial.varp:1-2`
    ```
    [tutorial]
    scope=perm
    ```
    and, with the protect key, `Content/scripts/_unpack/225/all.varp:297-299`
    ```
    [temp]
    scope=temp
    protect=no
    ```

    `.varbit`, `Content/scripts/_unpack/274/all.varbit:1-4`
    ```
    [boardgames_rankchange_win]
    basevar=boardgames_varbit3
    startbit=0
    endbit=15
    ```

    `.varn`, `Content/scripts/_unpack/225/all.varn:1-4`
    ```
    [npc_action_delay]

    [npc_attacking_uid]
    type=player_uid
    ```

    `.vars`, `Content/scripts/skill_agility/configs/agility.vars:1-3`
    ```
    [gnome_obstacle_pipe_used]

    [barb_ropeswing_used]
    ```

    `.constant`, `Content/scripts/skill_cooking/configs/gnome_cooking/gnome_cooking.constant:1-4`
    ```
    ^gnome_cocktail = 0
    ^gnome_bowl = 1
    ^gnome_crunchies = 2
    ^gnome_batta = 3
    ```
    and the built-ins in `Content/scripts/engine.constant:1-2` (`^true = 1`, `^false = 0`).

    `.hunt`, `Content/scripts/general/configs/duckling.hunt:1-8`
    ```
    // in osrs, ducklings always hunt 11 ticks after respawn
    [duck_hunt]
    type=npc
    check_npc=duck_female
    check_vis=lineofsight
    find_keephunting=off
    rate=11
    find_newmode=opnpc3
    ```

    `.mesanim`, `Content/scripts/general/configs/goblin.mesanim:1-5`
    ```
    [goblinchat]
    len1=chatgoblin1
    len2=chatgoblin2
    len3=chatgoblin3
    len4=chatgoblin4
    ```

    `.flo`, `Content/scripts/floors/underlay.flo:1-2`
    ```
    [grassland]
    colour=0x35720A
    ```

    `.if`, `Content/scripts/interface_trade/interfaces/tradeside.if:1-6` (here `[inv]` is a *component* of the interface named by the file, `tradeside`)
    ```
    [inv]
    type=inv
    x=16
    y=8
    width=4
    height=7
    ```

34. Variable names share one global namespace: a duplicate name across varp / varbit / varn / vars is rejected at pack time. Source: `Engine-TS/tools/pack/config/PackShared.ts:448-460` (message `Non-unique var name found`).

35. `.if` files are **not** RuneScript. In this revision the "script" lines inside an interface component (`script1op1=stat_level,crafting` / `script1=lt,13`) are a tiny fixed vocabulary of client-evaluated conditions: the packer maps names like `stat_level`, `stat_base_level`, `stat_xp`, `inv_count`, `pushvar` to small integers. Source: `Engine-TS/tools/pack/interface/PackShared.ts:63-80` (`nameToScript`), `:297-309` (comparators), `:311-330` (ops); a Content use is `Content/scripts/skill_crafting/interfaces/leather_crafting.if:735-736`
    ```
    script1op1=stat_level,crafting
    script1=lt,13
    ```
    This partly answers open question 55 for *interface scripts in this revision*: they are an op list packed by `Engine-TS/tools/pack/interface/PackShared.ts`, not RuneScript or CS2 text. Whether the `.if` files under `Content/scripts/_unpack/*` were extracted unchanged from the original cache or authored by the Lost City team is **not** answered by this code (it records no provenance); see Not checked.

### 1.7 Inferences (labelled), section 1

- *Inference A:* because `script.pack` is regenerated from the sources and not committed, script ids are **not stable between machines or even between runs after deletions**. They only need to be consistent between the compiler and the `script.dat` it just wrote, because scripts refer to each other by id inside `script.dat` only. Rests on findings 27 and 20. (The queue/timer *persistence* case, where an id could be saved into a player file, was not checked; the player-save code was not read.)
- *Inference A2:* `regenScriptPack` only ever registers names (`PackFile.ts:264-273`: load, register missing, refresh, save); it never deletes. So a script removed from the sources keeps its line in `script.pack`, and the corresponding slot in `script.dat` is a zero-size gap (`JagFileScriptWriter.ts:56-62`, "Gap, no size"); ids of surviving scripts do not shift. Rests on findings 20 and 27. Not run.
- *Inference B:* the split between "transmitted" (stable ids, committed) and other packs follows from client sharing: the client config archive carries `loc`, `npc`, `obj`, `seq`, ... ids. Rests on findings 26 and the `client` branch of each `rebuildClient*` block at `PackShared.ts:595-820`. The *reason* is the author's design; the code only shows the behavioural difference.
- *Inference C:* since the compiler reads `varp`/`inv`/`param` *types and protect flags* from the packed `.dat` files (finding 12), editing e.g. `protect=no` on a varp changes how already-written scripts type-check (see section 4), and `shouldRunServerCompiler` lists `data/pack/server/varp.dat` as a dependency so it recompiles. Rests on `PackAll.ts:81-95` and `Compiler.ts:229-238`.

### 1.8 Not checked, section 1

- The contents of `Engine-TS/tools/pack/config/*Config.ts` other than `VarpConfig.ts` (key-by-key parsing and byte layout of each config type).
- Client-side consumption of the packed configs and of `data/pack/client/*`.
- `Engine-TS/src/setup.ts`, `Server/`, and how `npm start`/`setup` obtains Content and RuneScriptTS in practice.
- Whether `npm install` fetches `@lostcityrs/runescript` from a registry or links the local checkout.
- Nothing was run: no compile was observed, no `script.dat` was inspected.

### 1.9 Method note: the counts quoted in section 1

"10,938 script headers in 1,416 files" is the result of a one-off Python scan of `Content/scripts` (read-only): every line of every `*.rs2` except `engine.rs2` that matches `^\[[a-z_0-9]+,[^\]]*\]`. Of those, 349 have a subject starting with `_` followed by a name (category scripts) and 22 have subject exactly `_`. It includes `_test/` scripts and counts only header lines, so it is approximate (a header-looking line inside a comment block would be counted). The most common triggers by the same scan are `label` 2,879, `proc` 1,284, `oploc1` 1,020, `if_button` 1,004, `opnpc1` 704.

---

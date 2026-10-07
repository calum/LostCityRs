# Chapter 12: The client side, interface expressions and what runs over several ticks

**Question answered:** Is there a "client script" that runs over multiple game ticks in this revision (274), what client scripts exist, and what on the client really runs across many client cycles?

**Based on commits:**
- Client-TS: `7d6ca61`
- Engine-TS: `1d25566c`
- Content: `65b754f76`

**Method:** read code only. Nothing was run, so every tick number is "read, not observed". Line numbers were taken with `grep -n` on the files at the commits above.

Book: [Multi-tick scripts](README.md).

---

## 1. Client cycles versus server ticks

### Findings

1. The client main loop is `GameShell.run()`. Its nominal period is `deltime = 20` ms. Source: `Client-TS/src/client/GameShell.ts:11` (`protected deltime: number = 20;`).
2. Each frame of that loop computes `ratio` from how long the last 10 frames took and keeps a fixed-timestep accumulator `count`: `while (count < 256) { ... await this.mainloop(); ... count += ratio; }`, then `count &= 0xff`, then `await this.mainredraw()`. Source: `Client-TS/src/client/GameShell.ts:145-203` (ratio at `:158`, clamp at `:161-166`, inner loop `:185-196`, redraw `:203`). So logic (`mainloop`) is *decoupled from drawing*: on a slow frame `ratio < 256` and `mainloop` runs more than once before one redraw; on an on-time frame it runs once.
3. `mainloop()` increments the global cycle counter and runs either the title or the in-game loop: `Client.loopCycle++; ... await this.gameLoop();`. Source: `Client-TS/src/client/Client.ts:1254-1268` (`loopCycle++` at `:1259`). `mainredraw()` calls `gameDraw()` when in game (`Client.ts:1270-1289`).
4. `gameLoop()` (one client cycle, `Client.ts:2037`) does, in this order among other things: decrement `rebootTimer`/`logoutTimer` (`:2043-2049`), read up to 5 server packets (`for (let i = 0; i < 5 && (await this.tcpIn()); i++)`, `:2051`), send mouse/camera events, `movePlayers()`, `moveNpcs()`, `timeoutChat()` (`:2200-2202`), then `this.worldUpdateNum++` (`:2204`), `followCamera()` / `cinemaCamera()` (`:2345-2350`), `camShakeCycle[i]++` (`:2352-2354`), the 90 s idle check (`:2358-2364`).
5. `worldUpdateNum` counts client cycles since the last draw: incremented once per `gameLoop` (`Client.ts:2204`) and reset to 0 at the end of `gameDraw` (`Client.ts:4169`). It is passed as `delta` into projectile movement, spot animation update and interface animation (`proj.move(this.worldUpdateNum)` `:4382`; `spot.update(this.worldUpdateNum)` `:4421`; `animateInterface(..., this.worldUpdateNum)` `:3929`, `:3971`, `:4854`, `:4859`).
6. **The client has no tick counter and no concept of a server tick.** A case-insensitive grep of `Client-TS/src/client/Client.ts` for `tick` finds nothing relevant (the only "600" hits are camera constants at `:1230` and `:4194`). Server timing reaches the client only as *packets arriving* and as numeric fields that the *server converted into client-cycle units*.
7. Evidence of the conversion factor 30 client cycles per server tick (600 ms / 20 ms), three independent places:
   - Client: `UPDATE_REBOOT_TIMER` sets `this.rebootTimer = this.in.g2() * 30;` (`Client.ts:6649-6654`), and the engine sends a tick count: `player.write(new UpdateRebootTimer(this.shutdownTick - this.currentTick))` (`Engine-TS/src/engine/World.ts:1803-1808`, also `:946-948`), encoded as `buf.p2(message.ticks)` (`Engine-TS/src/network/game/server/codec/UpdateRebootTimerEncoder.ts:9-11`).
   - Content: `[proc,seqlength20ms](seq $seq)(int)  return(calc(seqlength($seq) / 30));` with the comment "converts a seq length to the client speed in milliseconds" (`Content/scripts/general/scripts/sequence.rs2:1-3`).
   - Content: `~ranged_dropammo_pvp($ammo, calc($delay / 30));` where `$delay` is the projectile duration returned by `~player_projectile` (`Content/scripts/skill_combat/scripts/pvp/pvp_ranged.rs2:69-70`), i.e. client cycles divided by 30 gives server ticks.
8. The first two bullets of 7 only prove the factor is *used*; that one cycle is exactly 20 ms on screen is the target `deltime`, not a guarantee (frame timing is adaptive, `GameShell.ts:145-196`).

### Inferences (labelled)

- Inference: on an on-time machine the client runs about 30 `gameLoop` cycles per 600 ms server tick. Rests on findings 1, 2 and 7.
- Inference: because packets are read in `gameLoop` (finding 4) and applied immediately (the packet handlers mutate client state directly, e.g. `Client.ts:6656-6675`), a state change from tick T is visible from the next client cycle after its bytes arrive; nothing aligns client cycles to tick boundaries.

---

## 2. Interface component expressions (`IfType.scripts`): the only "client scripts"

### 2.1 Where the data lives (decode)

1. `IfType` fields: `scripts: (Uint16Array | null)[] | null`, `scriptComparator: Uint8Array | null`, `scriptOperand: Uint16Array | null` (`Client-TS/src/config/IfType.ts:56-58`).
2. Wire layout per component (`IfType.init`, `IfType.ts:103-161`): after `type` (g1), `buttonType` (g1), `clientCode` (g2), `width`, `height` (g2 each), `trans` (g1) and the `overLayerId` (g1 [+ g1]) (`:123-135`):
   - `scriptStackCount = g1`; for each: `scriptComparator[i] = g1`, `scriptOperand[i] = g2` (`:137-146`).
   - `scriptCount = g1`; for each: `opcodeCount = g2`, then that many `g2` words into a `Uint16Array` (`:148-161`).
3. The engine decodes the same bytes (`Engine-TS/src/cache/config/Component.ts:75-96`) but a grep of `Engine-TS/src` for `scriptComparator|scriptOperand|\.scripts\b` finds only that decode and the field declarations (`Component.ts:285-286`) plus an unrelated `ScriptProvider.scripts` (`ScriptProvider.ts:85`). By grep, the engine never evaluates these expressions. (Not verified by a full read of `Component.ts` consumers.)

### 2.2 The evaluator: `getIfVar` (opcodes 0-20)

`Client.getIfVar(com, scriptId)` is at `Client-TS/src/client/Client.ts:10398-10536`. Shape: local variables `acc = 0`, `pc = 0`, `arithmetic = 0` (`:10409-10411`); loop reads `opcode = script[pc++]`; `opcode === 0` returns `acc` (`:10417-10420`); each other opcode produces a `register` (default 0) which is combined into `acc` with the *pending* arithmetic operator (`:10517-10531`).

| Opcode | Packer name (`PackShared.ts:63-108`) | Operands (words after the opcode) | Value produced | Cite |
|---|---|---|---|---|
| 0 | (terminator) | none | ends, returns `acc` | `Client.ts:10418-10420` |
| 1 | `stat_level` | skill id | `statEffectiveLevel[skill]` (current, boosted/drained level) | `:10422-10424` |
| 2 | `stat_base_level` | skill id | `statBaseLevel[skill]` | `:10425-10427` |
| 3 | `stat_xp` | skill id | `statXP[skill]` | `:10428-10430` |
| 4 | `inv_count` | component id, obj id | sum of `linkObjNumber[i]` over slots of that component whose `linkObjType[i] === obj + 1` (members-only objs skipped unless `Client.memServer`) | `:10431-10442` |
| 5 | `pushvar` | varp id | `this.var[varp]` | `:10443-10445` |
| 6 | `stat_xp_remaining` | skill id | `Client.levelExperience[statBaseLevel[skill] - 1]` (the xp table entry at the base level; the code reads a table value, not a subtraction) | `:10446-10448` |
| 7 | `op7` | varp id | `((this.var[varp] * 100) / 46875) \| 0` | `:10449-10450` |
| 8 | `op8` | none | `this.localPlayer?.combatLevel \|\| 0` | `:10451-10453` |
| 9 | `op9` | none | sum of `statBaseLevel[i]` over skills with `Skill.used[i]` | `:10454-10460` (skill table `Client-TS/src/client/Skill.ts:3-4`) |
| 10 | `inv_contains` | component id, obj id | `999999999` if any slot of that component holds `obj + 1`, else 0 | `:10461-10473` |
| 11 | `runenergy` | none | `this.runenergy` | `:10474-10476` |
| 12 | `runweight` | none | `this.runweight` | `:10477-10479` |
| 13 | `testbit` | varp id, bit 0..31 | `1` if `var[varp] & (1 << bit)` else `0` | `:10480-10485` |
| 14 | `push_varbit` | varbit id | `(var[basevar] >> startbit) & Client.readbit[endbit - startbit]` | `:10486-10492` (`readbit` table built at `:123-127`) |
| 15 | `subtract` | none | sets *pending operator* = subtract for the next value | `:10493-10495` |
| 16 | `divide` | none | pending operator = divide | `:10496-10498` |
| 17 | `multiply` | none | pending operator = multiply | `:10499-10501` |
| 18 | `coordx` | none | `(localPlayer.x >> 7) + mapBuildBaseX` (absolute tile x) | `:10502-10506` |
| 19 | `coordz` | none | `(localPlayer.z >> 7) + mapBuildBaseZ` (absolute tile z) | `:10507-10511` |
| 20 | `push_constant` | constant | the constant | `:10512-10515` |
| other | | | `register` stays 0, nothing consumed, adds 0 | (no branch; `:10414-10415, 10517-10531`) |

Semantics of combination (`Client.ts:10517-10531`): if the opcode was one of 15/16/17 (`nextArithmetic !== 0`), only `arithmetic = nextArithmetic` is stored; otherwise `acc` is updated with the stored `arithmetic`: 0 add, 1 subtract, 2 divide (`(acc / register) | 0`, **skipped when `register === 0`**, so division by zero leaves `acc` unchanged), 3 multiply (`(acc * register) | 0`); then `arithmetic` is reset to 0. So it is a strict **left-to-right, no-precedence accumulator**, not a stack machine: there is no push/pop, only one accumulator and one pending operator.

Other facts about `getIfVar`:
- `return -2` when the component has no `scripts` array or `scriptId >= scripts.length` (`:10399-10401`); `return -1` when that script slot is `null` (`:10404-10407`); the whole body is in `try { } catch (_e) { return -1; }` (`:10403, 10533-10535`), so a bad component id in opcodes 4/10 (an `undefined` `IfType.list[...]`) yields -1, not a crash.
- **Stateless proof.** The function declares `acc`, `pc`, `arithmetic` locally and only *reads* `this.statEffectiveLevel`, `this.statBaseLevel`, `this.statXP`, `this.var`, `this.runenergy`, `this.runweight`, `this.localPlayer`, `this.mapBuildBase*`, `IfType.list[...].linkObj*`, `VarBitType.list`, `Client.levelExperience`; I read all of `:10398-10536` and found no assignment to any field of `this` or of any `IfType`. There is no loop construct in the language (the only loop is `while (true)` advancing `pc` forward through the array; no opcode changes `pc`), so every script terminates when it reaches its `0` word (or throws and returns -1). No opcode can suspend, call, or schedule.

### 2.3 The comparator: `getIfActive`

`Client-TS/src/client/Client.ts:10365-10396`:

```ts
for (let i = 0; i < com.scriptComparator.length; i++) {
    ...
    const value = this.getIfVar(com, i);
    const operand = com.scriptOperand[i];
    if (comparator === 2)       { if (value >= operand) return false; }   // "lt"
    else if (comparator === 3)  { if (value <= operand) return false; }   // "gt"
    else if (comparator === 4)  { if (value === operand) return false; }  // "neq"
    else if (value !== operand) return false;                              // default: "eq"
}
return true;
```

Semantics, from that code:
- comparator `i` is paired with script `i` (script index = comparator index).
- All comparators are **ANDed**; the first failing one returns false.
- Comparator 2 means *active iff value < operand*; 3 means *value > operand*; 4 means *value != operand*; **anything else, including 0, 1 and 5+, behaves as "equals"**.
- With **no comparators** (`scriptComparator` null) the function returns `false` (`:10366-10368`) - an always-inactive component. (`scripts` may still be present for `%N` text; see 2.5.)
- `operand` is a `Uint16Array` element (`IfType.ts:58, 140`) so it is 0..65535 and cannot be negative.
- The result is just a boolean used to pick the "active" or "inactive" variant (2.4); there is no side effect.

### 2.4 When it is evaluated (all call sites)

Complete list of callers (grep `getIfActive|getIfVar` in `Client.ts`):

| Call site | What it does | Cite |
|---|---|---|
| `TYPE_RECT` draw | active → `colour2` (or `colour2Over` if hovered and non-zero), else `colour` / `colourOver` | `Client.ts:10044-10064` (`getIfActive` at `:10051`) |
| `TYPE_TEXT` draw | same colours; if active and `text2` non-empty, draws `text2` instead of `text` | `:10077-10103` (`:10087`, `:10094-10096`) |
| `TYPE_TEXT` `%1`...`%5` substitution | each `%N` replaced by `inf(getIfVar(child, N-1))`; `inf(v)` is `v < 999999999 ? String(v) : '*'` | `:10124-10170` (calls at `:10132, 10141, 10150, 10159, 10168`), `inf` at `:10361-10363` |
| `TYPE_GRAPHIC` draw | active → `graphic2` else `graphic` | `:10188-10196` (`:10190`) |
| `TYPE_MODEL` draw | active → `modelAnim2` / model2, else `modelAnim` / model1 | `:10197-10228` (`:10207-10214`) |
| `animateInterface` for `TYPE_MODEL` with an anim | picks `modelAnim2` or `modelAnim` to advance | `:10570-10579` (`:10571`) |

Not callers: menu building (`addComponentOptions`, `Client.ts:9632+`) never consults the active state; the right-click options for a button depend only on `buttonType` (`:9799-9843`). So an "inactive" spell/skill icon is **only drawn differently, it can still be clicked** (inference from absence of calls; all call sites are listed above).

Draw timing (so *when* each call runs):
- `drawInterface` is the only recursion over components (`Client.ts:9904-10269`; it also calls `clientComponent(child)` for any child with `clientCode > 0`, `:9929-9931`).
- Overlay and main modal are drawn **every frame** while in the scene: `gameDrawMain` calls `animateInterface` then `drawInterface` for `mainOverlayId` and `mainModalId` (`Client.ts:4853-4861`), and `gameDraw` calls `gameDrawMain` whenever `sceneState === 2` (`:3920-3922`).
- The side panel (`drawSide`, `:11102-11120`) and the chat area are drawn only when `redrawSide` / `redrawChat` is set (`:3943-3946`). `redrawSide` is set by, among others: `UPDATE_STAT` (`:6657`), `UPDATE_INV_FULL/PARTIAL` (`:6263, 6294`), `VARP_SMALL/LARGE/SYNC` when a value changed (`:6971-6975, 6992-6996, 7009-7015`), `IF_SETTEXT` for the open tab (`:6166-6168`), the model-loaded callback (`:1333-1334`), `UPDATE_RUNENERGY` / `UPDATE_RUNWEIGHT` **only when `activeIcon === 12`** (`:6677-6680, 6599-6602`), and the local toggle/select clicks (`:9171, 9185`).
- Consequence (inference from the two bullets above): a script that reads a value whose change does not set `redrawSide` (e.g. `coordz` in a side-panel component) would be re-evaluated only on some other redraw; the wilderness level text avoids this by living on the overlay, which redraws each frame.
- Every evaluation starts from `pc = 0` with no cached result (2.2), so the cost is paid on each redraw of that component.

### 2.5 Text: `%1`..`%5`

`%N` is the N-th script (index N-1) of that component, evaluated on every draw of that text (`Client.ts:10125-10170`). Note the plain `text` is used with `%N` too, even when the component is "inactive" (the replacement loop runs on whichever `text` was selected, `:10079-10096` then `:10124-10170`). A component with scripts but no comparators is therefore a pure "live number label": inactive colour, but `%1` substituted.

### 2.6 How the `.if` source becomes these bytes (packer)

Pack path: `Engine-TS/tools/pack/interface/PackClient.ts` calls `packInterface` (`PackClient.ts:25-42`), implemented in `Engine-TS/tools/pack/interface/PackShared.ts` (read in full, 640 lines).

1. Source files are every `*.if` under the Content `scripts` dir (`loadDir(.../scripts, '.if', ...)`, `PackShared.ts:190`). Lines starting with `[` open a component named `<file>:<name>`; other lines are `key=value` (`:204-240`). A `layer=` key re-parents the component (`:221-233`). The file's un-bracketed leading keys (e.g. `type=overlay`) go to the file's root component (`:235-239`).
2. Name tables: comparator names `eq`=1, `lt`=2, `gt`=3, `neq`=4, unknown=0 (`:48-61`); opcode names to numbers exactly as in the table in 2.2 (`:63-108`; `op7`, `op8`, `op9` are the unnamed opcodes 7, 8, 9); stat names to skill ids, e.g. `attack`=0 ... `runecraft`=20, unknown=-1 (`:110-153`; `slayer` is not listed, so `stat_level,slayer` would pack as -1/65535, not verified in use); button types `normal`1 `target`2 `close`3 `toggle`4 `select`5 `pause`6, else 0 (`:29-46`); component types `layer/overlay`0 `inv`2 `rect`3 `text`4 `graphic`5 `model`6 `invtext`7 (`:7-27`).
3. Per component the header written is `type, buttontype, clientcode (p2 of parseInt), width, height, trans, overlayer` (`:274-295`).
4. **Comparators:** counts `script1`..`script5` keys (`:297-302`) and writes `comparator(parts[0]), p2(parseInt(parts[1]))` for `scriptN=lt,15`-style values (`:304-309`). So the `.if` line `script1=gt,14` means: compare the result of script 1 with `> 14`.
5. **Scripts:** counts `script1op1` ... `script5op1` keys (`:311-318`); for script `j` it iterates `script{j}op1..op20` (`:321-361`), summing the number of words (1 per op plus operand count: `stat_*`, `pushvar`, `push_varbit`, `push_constant` +1; `inv_count`, `inv_contains`, `testbit` +2); writes `p2(opCount+1)` (the `+1` is the terminator), then each op as `p2(opcode)` plus operand words (resolving names through the `InterfacePack`/`ObjPack`/`VarpPack`/`VarbitPack` tables, printing an error on an unknown name) (`:363-452`), then `p2(0)` (`:455-457`). The special case `script2op1=` (an empty op) writes a script of just the terminator (`:363-366`); `stats.if` uses this (e.g. `Content/scripts/player/interfaces/stats.if:113`).
6. Layer children, inv, rect, text, graphic, model and invtext blocks follow (`:460-606`); `actionverb/action/actiontarget` for target buttons and invs (`:608-632`); `option=` for button types 1, 4, 5, 6 (`:634-636`).
7. The server also gets a separate `interface.dat` containing only `id`, name and the `overlay` flag (`PackShared.ts:270-272`).
8. Output: `data/pack/client/interface` jag archive, with a check `Packet.checkcrc(packed, 0, packed.length, 2135735991)` when `Environment.build.verify` is set (`Engine-TS/tools/pack/interface/PackClient.ts:44-47`); `verify` defaults to `true` (`Engine-TS/src/util/WorldConfig.ts:138`).

### 2.7 `buttonType` and `clientCode`

`buttonType` (client enum, `IfType.ts:29-36`): 1 OK, 2 TARGET, 3 CLOSE, 4 TOGGLE, 5 SELECT, 6 CONTINUE; engine mirror `Component.ts:16-22`.

What each does on the client (menu entry creation `Client.ts:9799-9843`, action execution `:9148-9200`):
- `BUTTON_OK` (1): menu entry `buttonText` → `IF_BUTTON`; if `clientCode !== 0` an override from `addSocialOptions` may apply (`:9800-9811`). Selecting: `if (com.clientCode > 0) notify = this.clientButton(com); if (notify) send IF_BUTTON(c)` (`:9148-9160`).
- `BUTTON_TARGET` (2): "use-on" targeting (`:9812-9821`, not traced).
- `BUTTON_CLOSE` (3): menu "Close"; action `closeModal()` locally (`:9822-9826, 9198-9200`).
- `BUTTON_TOGGLE` (4): action sends `IF_BUTTON` **and flips the varp locally** if the component's script 0 starts with opcode 5: `if (com.scripts && com.scripts[0] && com.scripts[0][0] === 5) { varp = com.scripts[0][1]; this.var[varp] = 1 - this.var[varp]; this.clientVar(varp); this.redrawSide = true; }` (`:9162-9173`). This is client-side *prediction*; the server later sends the authoritative value (see section 3 examples).
- `BUTTON_SELECT` (5): sends `IF_BUTTON` and sets the varp to `scriptOperand[0]` locally, again only when script 0 starts with opcode 5 (`:9175-9188`). With `push_varbit` (opcode 14) as the first op nothing is predicted (inference from the `=== 5` test).
- `BUTTON_CONTINUE` (6): only offered while `!this.resumedPauseButton`; action sends `RESUME_PAUSEBUTTON` and sets `resumedPauseButton = true` (`:9190-9196, 9837-9841`); text is replaced by "Please wait..." while set (`:10105-10108`); the flag is cleared on every `IF_OPEN*` (`:5938, 5962, 5986, 6028, 6052`).

`clientCode` (enum `Client-TS/src/client/ClientCode.ts:1-81`) is a **hook into compiled client code, not a script**: friend list rows 1-200 and 701-900, add/delete friend 201/202, size 203, logout 205, bank mode 206, character design 300-327, ignore list 401-503, report abuse 600-613, welcome-screen info 650-655. Two dispatchers in `Client.ts`: `clientComponent(com)` runs **per draw** and rewrites the component (e.g. text/colour/model angle) from client state (`:10691-10960`); `clientButton(com)` runs on click and returns whether to also notify the server (`:10964-11080`; `CC_LOGOUT` sets `logoutTimer = 250` and returns true, `:10985-10987`). Examples of purely local per-cycle behaviour in there: the design preview model spins with `Math.sin(Client.loopCycle / 40.0)` (`:10777-10779`), and the report-abuse text field blinks a cursor with `Client.loopCycle % 20 < 10` (`:10847-10854`). These are TypeScript, not data. Also a varp can carry `clientcode` (`VarpType.list[id].clientcode`), dispatched in `clientVar` for brightness (1), music (3), sound volume (4), mouse buttons (5), chat effects (6), split private chat (8), bank mode (9) (`:10605-10688`); there is no branch for 7 although Content's `option_run` varp has `clientcode=7` (`Content/scripts/interface_controls/configs/player_controls.varp:6-9`; a grep for `clientcode === 7` in `Client.ts` finds nothing).

---

## 3. Real examples from Content, traced end to end

Counts (grep over `Content/scripts`): 197 `*.if` files; 55 contain a `script1=` comparator. Over all `scriptNopM=` lines, the opcode names occur: `inv_contains` 842, `pushvar` 773, `inv_count` 399, `testbit` 279, `stat_level` 117, `stat_base_level` 35, `push_varbit` 34, `stat_xp_remaining` 19, `stat_xp` 19, `push_constant` 12, `subtract` 4, `divide` 4, `coordz` 4, `runweight` 1, `runenergy` 1, `op8` 1, `op9` 1, empty 3. `op7`, `coordx` and `multiply` are not used by any `.if` (by this grep).

### Example A (simple): a live number label - run energy

Source `Content/scripts/interface_controls/interfaces/controls.if:14-25`:
```
[com_1]
type=text
...
script1op1=runenergy
center=yes
font=p12_full
text=%1%
colour=0xFFFF00
```
1. Packed: component type 4; no comparators (no `script1=` key) so `scriptComparator` stays null; one script `[11, 0]`; text `%1%`. (`PackShared.ts:297-309, 311-368`.)
2. The value comes from the server: every phase-10 tick `updateStats()` compares `Math.floor(this.runenergy) / 100 !== Math.floor(this.lastRunEnergy) / 100` and writes `UpdateRunEnergy(this.runenergy)` (`Engine-TS/src/engine/entity/NetworkPlayer.ts:326-329`); the encoder sends `p1((energy / 100) | 0)`, a 0-100 percentage (`.../UpdateRunEnergyEncoder.ts:9-11`; energy is stored in 1/100 units, 10000 max, `Engine-TS/src/engine/entity/Player.ts:293`, `:701-713`).
3. Client stores it: `this.runenergy = this.in.g1();` and sets `redrawSide` only if the run-energy tab is open (`Client.ts:6677-6686`).
4. Draw: `TYPE_TEXT` branch, `getIfActive` → false (no comparators), colour `colour`; `%` found, `%1` replaced by `inf(getIfVar(child, 0))` → opcode 11 → `this.runenergy` (`Client.ts:10124-10132, 10474-10476`); the trailing `%` of the source text stays, giving e.g. `75%`.
5. Visible effect: the number changes only after a new `UPDATE_RUNENERGY` arrived *and* the side panel was redrawn. Multi-tick? The server changes energy every tick the player moves (`Player.updateEnergy` `Player.ts:701-723`), so the number follows server state tick by tick; the label itself has no memory.

### Example B (simple): stat level label pair

`Content/scripts/player/interfaces/stats.if:98-113`-style pair (`[com_86]` `script1op1=stat_level,attack` `text=%1`, `[com_87]` `script1op1=stat_base_level,attack`, `script2op1=`). Client chain: `UPDATE_STAT` handler stores `statXP`, `statEffectiveLevel`, recomputes `statBaseLevel` from `Client.levelExperience`, sets `redrawSide` (`Client.ts:6656-6675`); draw → opcode 1 / 2 (`:10422-10427`). Engine side: `updateStats()` sends `UpdateStat(i, stats[i], levels[i])` when either differs from the last sent (`NetworkPlayer.ts:317-324`). The empty `script2op1=` is the empty-script special case (2.6 item 5).

### Example C (simple): auto-retaliate / run toggle (varp-driven select buttons) with client prediction

Source `controls.if:27-71`: `[com_2]` ... `buttontype=select`, `script1op1=pushvar,option_nodef`, `script1=eq,0`, `graphic=miscgraphics,0`, `activegraphic=miscgraphics,9`; `[com_3]` same var, `script1=eq,1`; `[com_4]`/`[com_5]` use `option_run` with `eq,0` / `eq,1`.
1. Packed: graphic component with one comparator `eq 0` (or 1) and script `[5, <varp id>, 0]`.
2. Click: menu action `SELECT_BUTTON` sends `IF_BUTTON(c)` then, because `scripts[0][0] === 5`, sets `this.var[varp] = scriptOperand[0]`, calls `clientVar`, sets `redrawSide` (`Client.ts:9175-9188`). The very next draw shows the highlighted sprite (`getIfActive` true → `graphic2`, `:10190-10196`) before any server reply: **prediction**.
3. Server: `[if_button,controls:com_5]` runs `p_run(^player_run_on)` after checks and `return`s (`Content/scripts/interface_controls/scripts/player_controls.rs2:34-49`); if `p_finduid(uid)` fails or the run is refused it falls through to `%option_run = %option_run; // resync varp` (`:49`). `P_RUN` calls `activePlayer.setVar(VarPlayerType.RUN, run)` (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:1269-1274`); `setVar` writes a varp packet whenever `varp.transmit` is set, regardless of change (`Engine-TS/src/engine/entity/Player.ts:1765-1780`, `writeVarp` at `:1811`).
4. Client receives `VARP_SMALL` → `varServ[id] = value; if (this.var[id] !== value) { ...; redrawSide }` (`Client.ts:6965-6984`). If the prediction was wrong, the server's value overwrites it; if it was right, the comparison fails and nothing redraws. `VARP_SYNC` ("Resetting variables to authoritative set") restores all `var[i]` from `varServ[i]` (`:7007-7020`).
5. Multi-tick? The visible state is updated at click time (client) and confirmed/corrected on the tick the server handles the click (phase 2 → script → phase 10 packet; timing from the existing `docs/tick/` notes, not re-verified here).

### Example D (simple): prayer toggles (toggle button, optimistic flip, server timer drain)

Source `Content/scripts/skill_prayer/interfaces/prayer.if:3-12`: `[prayer_thickskin]` `type=graphic` `buttontype=toggle` `script1op1=pushvar,prayer0` `script1=eq,1` `activegraphic=prayerglow,0`.
1. Client: `TOGGLE_BUTTON` sends `IF_BUTTON` and flips `var[prayer0]` locally (`Client.ts:9162-9173`).
2. Server: `[if_button,prayer:prayer_thickskin]` → `@activate_prayer_thickskin`, final line `%prayer0 = %prayer0;` to resync (`Content/scripts/skill_prayer/scripts/prayers/thickskin.rs2:1-31`); the label checks stats and sets `%prayer0 = ^false` on failure (`:19-28`), else `%prayer0 = ^true; ~prayer_activate($data)` (`:30-31`). The varp `prayer0` has `transmit=yes`, `protect=no` (`Content/scripts/skill_prayer/configs/prayer.varp:4-6`).
3. **The multi-tick part is entirely on the server:** `~prayer_activate` calls `settimer(prayer_drain, 5)` if none is running (`Content/scripts/skill_prayer/scripts/prayer.rs2:30-34`), and `[timer,prayer_drain]` (`:163-181`, with `~prayers_are_active` at `:117`) accumulates `%prayer_drain_counter`, calls `stat_sub(prayer, $reduce_points, 0)` and, at zero, `mes(...)` and `~prayer_deactivate_all` (sets all `%prayerN = ^false`, clears the drain effect/counter and the timer: `Content/scripts/skill_prayer/scripts/prayer.rs2:135-156`). Each effect reaches the client as ordinary `UPDATE_STAT` / `VARP` / `MESSAGE_GAME` packets on whichever tick they happen. The client keeps no drain timer.

### Example E (complex): wilderness level computed on the client from the player's coordinate

Source `Content/scripts/areas/area_wilderness/interfaces/wilderness_overlay.if:19-45`:
```abbrev
[com_1] layer=com_2 type=text ...
script1op1=coordz
script1op2=subtract
script1op3=push_constant,3520
script1op4=divide
script1op5=push_constant,8
script1op6=push_constant,1
script2op1= (same six ops)
script1=gt,0
script2=lt,100
center=yes  font=p12_full  shadowed=yes
activetext=Level: %1
colour=0xFFFF00  activecolour=0xFFFF00
```
(no plain `text=` key). Server opens it with `if_openoverlay(wilderness_overlay)` in `[proc,wilderness_enter]` (`Content/scripts/areas/area_wilderness/scripts/wilderness.rs2:1-4`) and closes with `if_openoverlay(null)` (`:11-13`).
1. Packed words for script 1: `[19, 15, 20, 3520, 16, 20, 8, 20, 1, 0]` = coordz, subtract, push_constant 3520, divide, push_constant 8, push_constant 1 (`PackShared.ts:63-108, 363-457`). Comparators: `gt 0` and `lt 100`.
2. Evaluation, by `getIfVar` rules (left to right, pending operator): `acc = 0 + z`; pending subtract; `acc = z - 3520`; pending divide; `acc = ((z - 3520) / 8) | 0`; then `push_constant 1` with arithmetic reset to add: `acc += 1`. Result: `floor((z - 3520) / 8) + 1`, where `z` is `(localPlayer.z >> 7) + mapBuildBaseZ` (`Client.ts:10507-10511`). (Truncation is `| 0`, toward zero, so for z below 3520 results around 0 or 1 matter for the comparators; not worked through.)
3. `getIfActive`: active iff result `> 0` and `< 100` (`:10382-10392`).
4. Draw: `TYPE_TEXT`; active → colour2 (the `.if`'s `activecolour`), text = `text2` = `Level: %1` (`:10094-10096`), `%1` → `getIfVar(child, 0)` (`:10132`). When inactive, `text` is empty (`!text` → `continue`, `:10120-10122`), so nothing is drawn.
5. When: overlay is drawn every frame (`:4853-4856`), so the number updates the cycle after the local player's drawn position crosses a tile row.
6. Where `localPlayer.z` changes: client-side movement of the local player (`routeMove`, section 5) fed by `PLAYER_INFO`; **no server packet carries the wilderness level**. This is the strongest example of the client deriving a displayed value across many ticks from its own state with a data-driven expression, yet still stateless: the value is recomputed, never carried over.

### Example F (complex): spell icon availability (rune counts, staves, level)

Source `Content/scripts/skill_magic/interfaces/magic.if:3-24` (`[wind_strike]`):
```abbrev
type=graphic  buttontype=target  overlayer=com_47
script1op1=inv_count,inventory:inv,airrune
script1op2=inv_contains,wornitems:wear,staff_of_air
script1op3=inv_contains,wornitems:wear,air_battlestaff
script1op4=inv_contains,wornitems:wear,mystic_air_staff
script2op1=inv_count,inventory:inv,mindrune
script3op1=stat_level,magic
script1=gt,0   script2=gt,0   script3=gt,0
graphic=magicoff,0   activegraphic=magicon,0
actionverb=Cast on  actiontarget=npc,player  action=Wind strike
```
1. Script 1 adds the count of air runes in the player's inventory component and `999999999` for each staff-of-air-type item found in the worn-items component: accumulator semantics with default add (`Client.ts:10431-10442, 10461-10473, 10517-10531`). `> 0` therefore means "has at least one air rune or wears an air-providing staff".
2. Which data these opcodes read: `IfType.list[inventory:inv].linkObjType/linkObjNumber` and the same for `wornitems:wear`, filled by `UPDATE_INV_FULL` / `UPDATE_INV_PARTIAL` (`Client.ts:6262-6320`), cleared by `UPDATE_INV_STOP_TRANSMIT` (`:6244-6260`). The `+ 1` in the opcode handlers (`script[pc++] + 1`) matches the stored type being obj id + 1 (`:10434, 10464`; non-zero means occupied, `:9964`).
3. All three comparators must hold for `graphic2` (`magicon`) to be drawn instead of `graphic` (`magicoff`) (`:10188-10196`). The `overlayer=com_47` is the hover layer: while the mouse is over the component, `lastOverComId` becomes `overLayerId` (`:9646-9651`) and the hidden layer is allowed to draw (`drawInterface` skips `hide` layers unless hovered, `:9905`).
4. A tooltip-style number such as the rune count in this family uses `inf()` which prints `*` for values >= 999999999 (`:10361-10363`) - the reason `inv_contains` returns 999999999.
5. Timing: inventory/stat packets set `redrawSide`; the icons re-evaluate on the next side redraw after they arrive. Not stateful.

### Example G (complex): stat-gated smelting menu

`Content/scripts/skill_smithing/interfaces/smelting.if:158-170` (`[com_15]`: `script1op1=stat_level,smithing`, `script1=gt,0`, `colour=0xA00000`), `:205-220` (`script1=gt,14` for iron) and later `gt,19`, `gt,29`, `gt,39`, `gt,49`, `gt,69`, `gt,84` (from the grep at `smelting.if:166-523`). The text component has no `activecolour` key, so the packer writes `parseInt(undefined)` = NaN through `p4` (`PackShared.ts:527-532`, `Packet.p4` uses `setInt32`, `Engine-TS/src/io/Packet.ts:323-326`), which as an Int32 is 0 (inference about JS `DataView` semantics; not run), so the active colour is presumably black and the inactive dark red. Not verified visually.
`smithing.if:708-717` is a cleaner variant with explicit `activecolour=0xFFFFFF` and `script1op1=pushvar,modified_smith`, `script1=gt,9` (the "Warhammer" label turns white once the varp exceeds 9).

### Example H: `op8`/`op9` and `push_varbit`

`stats.if:1072-1090`: `script1op1=op8` with `text=Combat Lvl: %1` and `op9` with `text=Total Lvl: %1` (opcode 8 reads `localPlayer.combatLevel`, opcode 9 sums base levels, `Client.ts:10451-10460`). `boardgames_runelink_options.if:650-670`: `script1op1=push_varbit,boardgames_timepermove`, `script1=eq,1`, `buttontype=select` - the only users of `push_varbit` seen; because script 0 does not start with opcode 5, selecting does *not* locally predict (`Client.ts:9180`).

### What no example showed: progress bars

A search of the call-site table (2.4) shows `getIfVar` never feeds `width`, `height`, `x`, `y` or `trans`: scripts can only choose colour, graphic, model, anim, text or insert a number in text. So "bar widths driven by a script" do not exist in this client revision (by the call-site list). Any bar shown at 274 is a graphic/rect swapped by `activegraphic`/`colour2` or server-updated via `IF_SETPOSITION` etc. (not traced).

---

## 4. Server packets: is there any that runs code on the client?

### Findings

1. `Client-TS/src/io/ServerProt.ts` defines 69 server-to-client opcodes (enum `ServerProt`, `:1-96`), with sizes in `ServerProtSizes` (`:98+`). Full list with ids (grouped as in the file): interfaces `IF_OPENCHAT` 166, `IF_OPENMAIN_SIDE` 158, `IF_CLOSE` 171, `IF_SETICON` 215, `IF_SHOWICON` 241, `IF_OPENMAIN` 211, `IF_OPENSIDE` 16, `IF_OPENOVERLAY` 240; interface updates `IF_SETCOLOUR` 183, `IF_SETHIDE` 10, `IF_SETOBJECT` 28, `IF_SETMODEL` 129, `IF_SETANIM` 134, `IF_SETPLAYERHEAD` 192, `IF_SETTEXT` 44, `IF_SETNPCHEAD` 142, `IF_SETPOSITION` 77, `IF_SETSCROLLPOS` 54; tutorial `TUT_FLASH` 90, `TUT_OPEN` 130; inventory `UPDATE_INV_STOP_TRANSMIT` 227, `UPDATE_INV_FULL` 106, `UPDATE_INV_PARTIAL` 172; camera `CAM_LOOKAT` 233, `CAM_SHAKE` 64, `CAM_MOVETO` 200, `CAM_RESET` 101; entities `NPC_INFO` 197, `PLAYER_INFO` 167; social `FRIENDLIST_LOADED` 185, `MESSAGE_GAME` 161, `UPDATE_IGNORELIST` 3, `CHAT_FILTER_SETTINGS` 114, `MESSAGE_PRIVATE` 235, `UPDATE_FRIENDLIST` 247; misc `UNSET_MAP_FLAG` 115, `UPDATE_RUNWEIGHT` 67, `HINT_ARROW` 156, `UPDATE_REBOOT_TIMER` 89, `UPDATE_STAT` 105, `UPDATE_RUNENERGY` 83, `RESET_ANIMS` 47, `UPDATE_PID` 133, `LAST_LOGIN_INFO` 91, `LOGOUT` 88, `P_COUNTDIALOG` 210, `SET_MULTIWAY` 207, `SET_PLAYER_OP` 17, `MINIMAP_TOGGLE` 194; maps `REBUILD_NORMAL` 231; vars `VARP_SMALL` 203, `VARP_LARGE` 245, `VARP_SYNC` 190; audio `SYNTH_SOUND` 34, `MIDI_SONG` 23, `MIDI_JINGLE` 15; zones `UPDATE_ZONE_PARTIAL_FOLLOWS` 32, `UPDATE_ZONE_FULL_FOLLOWS` 153, `UPDATE_ZONE_PARTIAL_ENCLOSED` 195; zone protocol `P_LOCMERGE` 176, `LOC_ANIM` 48, `OBJ_DEL` 52, `OBJ_REVEAL` 219, `LOC_ADD_CHANGE` 138, `MAP_PROJANIM` 107, `LOC_DEL` 173, `OBJ_COUNT` 95, `MAP_ANIM` 85, `OBJ_ADD` 81.
2. None of those names, and none of the handlers, runs code: each handler in `Client.ts` (`:5925-7131`) assigns fields and returns (`this.ptype = -1; return true;`). Every one of the 69 names is referenced in `Client.ts` (checked with a loop of `grep -c "ServerProt\.<name>\b"`; zero reported missing).
3. The engine side agrees: `Engine-TS/src/network/game/server/ServerGameProt.ts` has 59 entries (the non-zone packets) and `ServerGameZoneProt.ts` has 10 (`LOC_MERGE` 176, `LOC_ANIM`, `OBJ_DEL`, `OBJ_REVEAL`, `LOC_ADD_CHANGE`, `MAP_PROJANIM`, `LOC_DEL`, `OBJ_COUNT`, `MAP_ANIM`, `OBJ_ADD`, `ServerGameZoneProt.ts:5-14`); the union of numeric ids equals the client's set of 69 (compared by sorting both id lists; identical). Three engine names differ from the client's: engine `IF_SETTAB` 215 / `IF_SETTAB_ACTIVE` 241 / `RESET_CLIENT_VARCACHE` 190 versus client `IF_SETICON` / `IF_SHOWICON` / `VARP_SYNC`. There is no `RUN_CLIENTSCRIPT`-like opcode on either side.
4. **Unknown opcode behaviour.** After all `if (this.ptype === ServerProt.X)` branches, the fall-through is `console.error("T1 - ...")` then `await this.logout()` (`Client.ts:7133-7135`); a handler exception does the same with "T2" (`:7136-7151`). So an opcode outside the list cannot be ignored; it ends the session.
5. `IF_*` packets change *data* (`IF_SETTEXT`, `IF_SETCOLOUR`, `IF_SETHIDE`, `IF_SETANIM`, `IF_SETPOSITION`, ...: `Client.ts:6079-6217`), they do not install or run expressions; the expressions are fixed in the interface archive at pack time (section 2.6).

### Inference

- Inference: with no code-carrying packet and a stateless evaluator, a "client script spanning ticks" cannot exist in this revision. Rests on findings 1-4 and 2.2.
- Limits: rests on the revision-274 `Client.ts` and engine at the listed commits. It does not say what the original Jagex client contained; `Client-Java` was not read (open question 54).

---

## 5. What really progresses over client cycles (candidates, each checked)

Legend: **P** = driven by server packets over ticks; **C** = client-local per-cycle counter; unit is client cycles (about 20 ms) unless stated.

| Candidate | Driver | Per-cycle advance | Ends when | Cite |
|---|---|---|---|---|
| Entity primary animation (`anim`) | P starts it (PLAYER_INFO/NPC_INFO mask), C runs it | `entityAnim` per `moveEntity` per `gameLoop` | `primaryAnimLoop >= seq.maxloops` or frame out of range, or `anim(null)` | 5.1 |
| Entity walk/run movement | P (route steps per tick) + C (interpolation) | `routeMove` 4-16 units/cycle | route empty | 5.2 |
| Spot animation on an entity | P (SPOTANIM mask) + C | `entityAnim` | `spotanimFrame` past end | 5.3 |
| Projectile (`MAP_PROJANIM`) | P once, C flies it | `proj.move(worldUpdateNum)` | `loopCycle > t2` | 5.4 |
| Ground spot anim (`MAP_ANIM`) | P once, C | `spot.update` | `animComplete` | 5.5 |
| Loc animation (`LOC_ANIM`) | P once, C | `ClientLocAnim.getTempModel` | seq ends or replaced | 5.5 |
| Interface model animation | P (`IF_SETANIM`/`IF_OPEN*`) + C | `animateInterface` | never (loops) or reset | 5.6 |
| Camera move/look (`CAM_MOVETO/LOOKAT`) | P once, C | `cinemaCamera` | target reached; persists until `CAM_RESET` | 5.7 |
| Camera shake (`CAM_SHAKE`) | P once, C | `camShakeCycle++` + sinusoid per frame | only `CAM_RESET` | 5.7 |
| Reboot timer | P once, C | `rebootTimer--` | stays at 1 | 5.8 |
| Chat bubble | P once, C | `chatTimer--` | 0 | 5.8 |
| Hint arrow | P (set/clear), C flashes | draw-time modulo | next `HINT_ARROW` | 5.9 |
| Flashing tab | P (`TUT_FLASH`), C | draw-time modulo | tab clicked | 5.9 |
| Minimap flag / click cross | C | cross: `crossCycle += 20` | reached / 400 | 5.9 |
| Sound / music delays | P once, C | per-cycle decrements | played | 5.10 |
| Idle/logout timers | C | `logoutTimer--`, real-time idle check | see 5.10 | 5.10 |

### 5.1 Entity `anim`: server packet on one tick, played over many cycles

Fully traced because it is the canonical "start on a tick, runs on cycles" case.
1. Server script `anim(seq, delay)` → `playAnimation(seq, delay)`, which sets `animId`, `animDelay` and the `ANIM` mask if the new seq priority is at least the current one (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:196-201`; `Engine-TS/src/engine/entity/Player.ts:1920-1930`). Packet path (mask encoding in `PLAYER_INFO`, phase 10) is in `docs/flows/server-response-woodcutting.md` section 5; not repeated.
2. Client decode of the ANIM mask (`Client.ts:7843-7873`): `seqId = g2` (65535 → -1), `delay = g1`; if the same seq is already playing it follows `duplicatebehaviour` (`RestartMode.RESET`: restart; `RESETLOOP`: reset loop count only, `:7854-7864`); otherwise takes it if `seqId === -1`, nothing playing, or priority >= (`:7865-7872`), setting `primaryAnim`, `primaryAnimFrame = 0`, `primaryAnimCycle = 0`, `primaryAnimDelay = delay`, `primaryAnimLoop = 0`, `preanimRouteLength = routeLength`.
3. Per-cycle advance: `gameLoop` → `movePlayers()`/`moveNpcs()` (`Client.ts:2200-2201`) → `moveEntity` → `entityAnim(e)` (`:3487-3518, 3517`). In `entityAnim` (`:3763-3838`):
   - `primaryAnimDelay > 0` is just decremented once per cycle and holds the animation back (`:3835-3837`); the `delay` value from `anim(seq, delay)` is therefore in **client cycles**.
   - When `primaryAnimDelay === 0`: `primaryAnimCycle++`; while `primaryAnimCycle > seq.getDelay(frame)`: subtract the delay and `primaryAnimFrame++` (`:3810-3817`). `getDelay(frame)` reads `SeqType.delay[frame]`, falling back to the frame's own `AnimFrame` delay, minimum 1 (`Client-TS/src/config/SeqType.ts:57-76`).
   - On running past the last frame: `primaryAnimFrame -= seq.loops; primaryAnimLoop++; if (primaryAnimLoop >= seq.maxloops) primaryAnim = -1;` and also `primaryAnim = -1` if the new frame index is out of range (`:3819-3830`). `SeqType` defaults: `loops = -1`, `maxloops = 99` (`SeqType.ts:31, 37`), so with `loops = -1` the frame index goes to `numFrames + 1`, out of range, and the animation ends after one pass (inference from those two reads); a seq with a `loops` value rewinds by that many frames.
   - `preanim_move`/`postanim_move` can hold movement while the animation plays (`routeMove` `:3576-3587`) or hold the animation until walking finishes (`entityAnim` `:3802-3808`).
4. End condition: either the client finishes it (above) or the server explicitly cancels with `anim(null, 0)` (mask with seq 65535 → `seqId === -1` branch sets `primaryAnim = -1`, `:7844-7872`); `Content/scripts/skill_magic/scripts/spells/teleport.rs2:76` does that after `p_telejump`.
5. Multi-tick? A seq whose total frame delay sum exceeds 30 cycles outlasts one tick. `SeqType.duration` is the sum of frame delays (`Engine-TS/src/cache/config/SeqType.ts:115`) and Content converts it to ticks with `/ 30` (`sequence.rs2:1-3`), but the commented-out `p_delay(~seqlength20ms($anim))` in `Content/scripts/interface_controls/scripts/player_controls.rs2:102` shows the server does not wait for the client animation by default: **the server never learns when the client's animation ends** (no client-to-server packet for it exists in the client protocol list used here; not exhaustively enumerated).

### 5.2 Walking/running: one server step per tick, interpolated across cycles

1. Each `PLAYER_INFO` movement delta calls `moveCode(running, direction)` which unshifts the new tile into `routeX/routeZ/routeRun` (max 9 queued) (`Client-TS/src/dash3d/ClientEntity.ts:102-145`; call sites `Client.ts:7664-7675, 7738-7754, 8069-8085`). How the bits are decoded is open question 14 and is not traced here.
2. `routeMove(e)` (`Client.ts:3568-3693`) moves toward the oldest queued tile `routeX[routeLength-1] * 128 + size * 64`. If the target is more than 256 units away it snaps (`:3594-3598`). Speed per cycle: base 4 (`:3642`), 2 while turning (`:3643-3645`), 6 if more than 2 tiles are queued, 8 if more than 3 (`:3646-3651`), 8 when catching up after an animation delay (`:3652-3655`), doubled for run steps (`moveSpeed <<= 1`, `:3656-3658`), and a run animation if speed >= 8 (`:3660-3662`). A tile is 128 units, so decrementing `routeLength` happens when `x` and `z` equal the target (`:3687-3692`).
3. Inference: a single walk step at speed 4 takes 128 / 4 = 32 cycles = 640 ms nominal, longer than a 600 ms tick, so the queue builds and speeds 6 and 8 are what keep up; run steps at 8-16 units/cycle. Rests on `:3642-3658` and on finding 7 of section 1. Not observed running.
4. `entityFace` handles turning toward `faceEntity`/`dstYaw` (`:3695+`, not read in full).

### 5.3 Spot animations on entities (`SPOTANIM` mask)

Decode (`Client.ts:7952-7968`): `spotanimId = g2`, `heightDelay = g4`; height = high 16 bits, `spotanimLastCycle = Client.loopCycle + (heightDelay & 0xffff)`; frame/cycle reset; if the start is in the future `spotanimFrame = -1`. Advance in `entityAnim`: starts only when `Client.loopCycle >= spotanimLastCycle`, increments `spotanimCycle`, advances frames by `SpotType.list[id].seq` delays, and sets `spotanimId = -1` when the frame index passes `numFrames` (`:3782-3800`). The delay is in client cycles (compared against `loopCycle`). Content e.g. `spotanim_pl(teleport_casting, 92, 0)` (`teleport.rs2:60`: height 92, delay 0).

### 5.4 Projectiles (`MAP_PROJANIM`)

1. Engine: `projanim_*` commands pass `delay`, `duration`, `peak`, `arc` through `World.mapProjAnim` to a zone event (`Engine-TS/src/engine/script/handlers/ServerOps.ts:172-211`, `Engine-TS/src/engine/zone/Zone.ts:401-403`), encoded `p1 coord, p1 dx, p1 dz, p2 target, p2 spotanim, p1 srcHeight, p1 dstHeight, p2 startDelay, p2 endDelay, p1 peak, p1 arc` (`MapProjAnimEncoder.ts:11-23`).
2. Client creates `ClientProj(..., t1 + Client.loopCycle, t2 + Client.loopCycle, ...)` and calls `setTarget` (`Client.ts:7263-7284`); so `startDelay`/`endDelay` are in client cycles from receipt.
3. Per cycle (`addProjectiles`, `Client.ts:4356-4385`): removed when `Client.loopCycle > proj.t2`; before `t1` it is not drawn; from `t1` it re-aims at the target entity (NPC `target > 0`, player `target < 0`) and `proj.move(this.worldUpdateNum)` integrates position with constant velocity in x/z and constant acceleration in y (`Client-TS/src/dash3d/ClientProj.ts:51-92`), also advancing its spot seq.
4. Content computes the cycle counts and hands them back to the server to schedule damage: `$flight = $length + range * $step; $duration = $delay + $flight` returned by `~npc_projectile` (`Content/scripts/skill_combat/scripts/projectile.rs2:7-11`), e.g. arrows `~player_projectile(..., 40, 36, 41, 15, 5, 11, 5)` (`pvp_ranged.rs2:69`), and the result `/ 30` becomes ticks for `inv_dropitem_delayed`/`pvp_damage` (`pvp_ranged.rs2:55-56, 70`). This is the cleanest evidence that server scripts reason in ticks while the client animates in cycles.
5. Inference (arithmetic): with delay 41, length 5, step 5 and a target 8 tiles away, duration = 41 + 5 + 40 = 86 cycles = 2.9 ticks. Not observed.

### 5.5 Ground spot animation and loc animation

- `MAP_ANIM`: `new MapSpotAnim(id, level, x, z, height, Client.loopCycle, time)` (`Client.ts:7285-7296`); `startCycle = cycle + delay` (`MapSpotAnim.ts:19-28`); each cycle `addMapAnim` calls `spot.update(worldUpdateNum)` once `loopCycle >= startCycle`, unlinking when the sequence wraps (`animComplete`, `MapSpotAnim.ts:30-44`; `Client.ts:4416-4430`).
- `LOC_ANIM`: replaces the wall/decor/scene/ground-decor model with `new ClientLocAnim(locId, shape, rotate, heights..., seq, false)` (`Client.ts:7184-7229`); `ClientLocAnim` stores `animCycle = Client.loopCycle` and in `getTempModel` advances `animFrame` by elapsed `loopCycle - animCycle` against frame delays; at the end `animFrame -= loops` and it sets `anim = null` if out of range (`Client-TS/src/dash3d/ClientLocAnim.ts:21-67`). Note this is advanced at *draw* time from elapsed cycles, not in the logic loop.

### 5.6 Interface animation (`modelAnim`, `ifAnimReset`, `animateInterface`)

1. Data: `.if` `anim=` / `activeanim=` (seq names) pack to `modelAnim`, `modelAnim2` (`PackShared.ts:562-580`); decode `IfType.ts:278-290`. 61 `.if` lines in Content use `anim=`/`activeanim=` (grep), e.g. `Content/scripts/general/interfaces/playermap_east.if:55-70` (`script1op1=pushvar,newcomers_pos`, `script1=eq,0`, `activemodel=if_x_mark_x`, `activeanim=x_mark`).
2. Server sets/clears: `IF_SETANIM` assigns `modelAnim` and, if -1, resets `animFrame/animCycle` (`Client.ts:6129-6142`); `IF_OPEN*` calls `ifAnimReset(comId)` (e.g. `IF_OPENCHAT` `:5925-5927`, `IF_OPENOVERLAY` `:6068-6072`), which recursively zeroes `animFrame`/`animCycle` of all children (`:10538-10554`).
3. Per redraw: `animateInterface(id, delta)` (`:10556-10603`) for model components with an anim: picks the active/inactive seq (`getIfActive`), `child.animCycle += delta`, advances frames while `animCycle > getDelay(frame)`, wraps with `animFrame -= type.loops`, and returns `true` if any frame changed; `gameDraw` then sets `redrawSide` / `redrawChat` (`:3928-3933, 3970-3975`); for overlay/main modal it is called and redrawn every frame (`:4853-4861`). `delta` is `worldUpdateNum` (cycles since last draw).
4. Content use: dialogue heads. `chatnpc_page` calls `if_setnpchead(npcchatN:com_0, $npc)` and `if_setanim(npcchatN:com_0, split_getanim($page))` before `if_openchat($interface)` (`Content/scripts/interface_chat/scripts/chat.rs2:283-321`; player version `:228-262`). The head's talking animation then loops locally on the client (no more packets) until the dialogue interface is replaced.

### 5.7 Camera: `CAM_MOVETO`, `CAM_LOOKAT`, `CAM_SHAKE`, `CAM_RESET`

Packets (`Client.ts:6322-6400`):
- `CAM_LOOKAT` (233): `cinemaCam = true`; reads local tile `lx`, `lz` (g1 each), height (g2), `rate` (g1), `rate2` (g1); if `rate2 >= 100` it immediately sets `camPitch/camYaw` toward the target (`:6322-6354`).
- `CAM_MOVETO` (200): `cinemaCam = true`; same fields; if `rate2 >= 100` snaps `camX/camZ/camY` to the target (`:6372-6389`).
- `CAM_SHAKE` (64): reads `axis, ran, amp, rate` and stores `camShake[axis] = true; camShakeAxis[axis] = ran; camShakeRan[axis] = amp; camShakeAmp[axis] = rate; camShakeCycle[axis] = 0` (`:6356-6370`; the stored names are shifted relative to the wire names).
- `CAM_RESET` (101): `cinemaCam = false`; `camShake[0..4] = false` (`:6391-6400`). `REBUILD_NORMAL` also sets `cinemaCam = false` (`:6959`, inside the handler beginning `:6812`).

Engine side: `cam_moveto`/`cam_lookat` are queued in `cameraPackets` and flushed in `updateMap()` with coordinates made relative to the build-area origin (`Engine-TS/src/engine/script/handlers/PlayerOps.ts:207-219`; `Engine-TS/src/engine/entity/NetworkPlayer.ts:238-249`), which is the first call per player in `processClientsOut` (`Engine-TS/src/engine/World.ts:1096-1108`); `cam_shake` and `cam_reset` write their packets immediately (`PlayerOps.ts:221-229`); `CamShakeEncoder` writes `p1 axis, random, amplitude, rate` (`CamShakeEncoder.ts:11-16`). Whether the camera packets are written before or after a `REBUILD_NORMAL` in the same tick was not determined (the comment at `NetworkPlayer.ts:239` says "update the camera after rebuild"; `rebuildNormal` is called from `Player.ts:502` and `:556`, call phases not traced).

Per-cycle behaviour:
- `gameLoop` runs `cinemaCamera()` every cycle when `sceneState === 2 && cinemaCam` (`Client.ts:2348-2350`). It computes the target camera position from `camMoveToLx/Lz/Hei`; for each of x, y, z, if the camera is below the target it adds `camMoveToRate + ((target - cam) * camMoveToRate2 / 1000)` truncated, clamping at the target, and symmetrically downward (`:3305-3350`); then pitch and yaw toward the look-at target using `camLookAtRate` and `camLookAtRate2`, with yaw wrapped on 2048 and clamped pitch 128..383 (`:3352-3410`). The step is one **per cycle**, so total time depends on distance and the two rates.
- When `cinemaCam` is true, `gameDrawMain` skips the normal follow camera and uses roof check 2 (`:4182-4203`); otherwise `camFollow` positions the camera from orbit values (`:4182-4196`).
- Shake: each cycle `camShakeCycle[i]++` (`:2352-2354`); at draw, for each shaking axis `jitter = (random * (axisParam * 2 + 1) - axisParam + sin(camShakeCycle * (camShakeAmp / 100)) * camShakeRan) | 0` is added to x/y/z, yaw or pitch (`:4211-4235`). There is **no expiry**: `camShake[axis]` becomes false only in `CAM_RESET` (`:6394-6396`); a grep for `camShake[` shows only the read sites (`:4187, 4212`), the set (`:6362`) and the reset (`:6395`).

Content usage statistics: of all `cam_moveto`/`cam_lookat` calls the last argument (`rate2`) is mostly >= 100 (so snap, no interpolation): 39 calls with `100`, 18 with `232`; interpolating ones exist: `cam_lookat(..., 10, 50, 10)` (rate 50, rate2 10) in `Content/scripts/quests/quest_horror/scripts/horror_lighthousekeeper.rs2:280-296`; `cam_moveto(0_41_46_15_12, 900, 2, 2)` in `quest_chompybird/scripts/rantz.rs2:319-320`; `cam_moveto(..., 500, 50, 10)` and `cam_lookat(..., 100, 50, 10)` in `quest_horror/scripts/horror_dagannoth.rs2:236, 245`; `cam_moveto(..., 1500, 10, 3)` in `quest_death/scripts/quest_death.rs2:140`. (counts from a grep of the final argument; the "snap" interpretation follows `Client.ts:6331, 6381`.)

Cutscene example with snapping cameras: `tbwt_tamayu_cutscene` sends `cam_lookat(..., 160, 232, 232)` + `cam_moveto(..., 350, 232, 232)` then repeats `cam_moveto` every `p_delay($delay)` with `$delay = 3` (or 2) and ends with `cam_reset` (`Content/scripts/quests/quest_tbwt/scripts/tbwt_tamayu.rs2:202-258`). Because `rate2 = 232 >= 100`, each `cam_moveto` teleports the camera instantly on the client; the "movement" between shots is simply the server waiting `p_delay` ticks.

### 5.8 Countdown and chat timers

- **Reboot timer** ("System update in m:ss"): one packet carries ticks (`UPDATE_REBOOT_TIMER`, `Client.ts:6649-6654`, `* 30`), then every `gameLoop` `if (this.rebootTimer > 1) this.rebootTimer--` (`:2043-2045`), displayed as `rebootTimer / 50` seconds (`:4901-4911`; 50 cycles per second, matching 20 ms). It stops decrementing at 1 and keeps showing until the server logs out (inference from `> 1` and `!== 0`). The server sends it at login (`World.ts:946-948`), on a reconnect (`Player.ts:557-561`) and when a shutdown is requested (`World.ts:1803-1809`, from a friend-server `RELAY_SHUTDOWN`, `World.ts:2048-2051`). This is the best purely client-driven, tick-origin example of a countdown that runs over many ticks.
- **Overhead chat**: `SAY`/`CHAT` masks set `chatTimer = 150` (`Client.ts:7882-7886, 7934`); `timeoutChat()` decrements each cycle and clears the message at 0 (`:2905-2933`). 150 cycles = 3 s nominal.
- **Hitmarks**: `addHitmark` sets `damageCycles[i] = loopCycle + 70` (`ClientEntity.ts:152-161`); drawing compares to `loopCycle` (draw side not read).

### 5.9 Hint arrow, flashing tab, minimap flag

- `HINT_ARROW` stores `hintType` (1 npc, 2-6 tile with offsets, 10 player) and ids/coords (`Client.ts:6610-6647`); there is no timer: it persists until another `HINT_ARROW` (engine `hint_stop`/`hint_coord`, used in `rantz.rs2:312-313`). The NPC arrow flashes with `Client.loopCycle % 20 < 10` (`:4601`).
- `TUT_FLASH` sets `tutFlashIcon` (`:6219-6234`); each tab icon draws only `Client.loopCycle % 20 < 10` while flashing (`:4037-4110`); `tutFlashIcon` is cleared and `TUT_CLICKSIDE` sent when the flashing tab is opened (`:4003-4012`).
- Minimap flag: set by the client's own click (`:5856-5857`), removed when the local player's tile equals it (`:4265-4266`) or by `UNSET_MAP_FLAG` (`:6592-6597`). Click cross animates with `crossCycle += 20` per cycle, ends at >= 400 (`:2206-2212`; drawn with `crossCycle / 100` at `:4841-4843`).

### 5.10 Audio and idle timers

- `SYNTH_SOUND`: queues `waveIds/waveLoops/waveDelay` (`waveDelay = delay + JagFX.delays[soundId]`, max 50) (`Client.ts:7022-7036`); `soundsDoQueue()` each cycle plays entries whose delay is <= 0 and otherwise `waveDelay--` (`:3413-3443`, called at `:2193`).
- `MIDI_JINGLE`: stores `nextMusicDelay = delay` (`:7056-7069`); `soundsDoQueue` subtracts 20 per cycle and when it reaches 0 requests the next song (`:3445-3457`). The unit is therefore milliseconds (20 per 20 ms cycle) in contrast with `waveDelay` (cycles).
- Idle: `if (now - this.idleTimer > 90_000) { this.logoutTimer = 250; this.idleTimer += 10_000; send IDLE_TIMER }` using `performance.now()` real time (`:2358-2364`); `logoutTimer--` per cycle (`:2047-2049`); `CC_LOGOUT` sets 250 (`:10985-10986`). What `logoutTimer` gates is not traced (used at `:2487`, not read).

### Cutscene behaviours (summary)

There is no cutscene mode on the client beyond `cinemaCam`, camera shake and the ordinary interface/anim packets. A "cutscene" in Content is a server script that teleports (`p_teleport`), sets cameras, plays animations and waits with `p_delay` between steps (e.g. `tbwt_tamayu.rs2`, `horror_lighthousekeeper.rs2:268-305`).

---

## 6. The single best client-side multi-cycle example, traced fully: slow `cam_moveto` + `cam_lookat` (and its reset)

Chosen because it is a self-advancing client state machine started by one tick's packets and finished by a later tick's packet. Content: `Content/scripts/quests/quest_chompybird/scripts/rantz.rs2:317-324`:

```
~chatplayer("<p,neutral>Where should I put the 'fatsy toadies'?");
cam_lookat(0_41_46_12_22, 25, 7, 7);
cam_moveto(0_41_46_15_12, 900, 2, 2);
hint_stop();
hint_coord(^hint_center, 0_41_46_12_22, 0);
queue(cr_queue, 0, 0);
~chatnpc(...)
```
1. **Server trigger (tick T):** `cam_lookat`, `cam_moveto` run in a script; each adds a `CameraInfo` to `activePlayer.cameraPackets` (`PlayerOps.ts:207-219`). `queue(cr_queue, 0, 0)` enqueues `[queue,cr_queue]` whose body is `cam_reset;` (`Content/scripts/general/scripts/general_queues.rs2:1-2`). The queue is run by the player queue machinery (timing per `docs/tick/05-players-queues-timers.md`, not re-verified here), but note the dialogue `~chatnpc` after it suspends on `p_pausebutton` (`chat.rs2:323-333`), so the camera reset is not sent until the queue entry runs; whether the queue runs while the script is suspended on `p_pausebutton` is not verified.
2. **Packets:** in phase 10 `updateMap()` writes `CamMoveTo(localX, localZ, height, rotationSpeed, rotationMultiplier)` / `CamLookAt(...)` for each queued `CameraInfo` (`NetworkPlayer.ts:240-249`).
3. **Client decode:** `cinemaCam = true`, fields stored; `rate2 = 2 < 100` so no snap (`Client.ts:6322-6354, 6372-6389`).
4. **Per cycle:** `gameLoop` calls `cinemaCamera()` (`:2348-2350`): x/y/z each move by `rate + (distance * rate2 / 1000)` toward the target, clamped (`:3305-3350`); pitch and yaw follow the look-at target similarly (`:3352-3410`). With `rate = 2, rate2 = 2` the camera moves a few units per cycle toward a point 900 units above ground; the normal follow-camera path is bypassed while `cinemaCam` (`:4182-4203`).
5. **End:** reaching the target only stops *movement* (the clamps), not the mode; `cinemaCam` stays true and the camera keeps looking at the look-at point until `CAM_RESET` (`:6391-6393`), a rebuild (`:6959`) or logout. The reset comes from `cr_queue`.
6. **Inference (arithmetic):** distance covered per cycle at rate 2 is at least 2 units plus a small proportional term; crossing, say, 1000 units takes on the order of several hundred cycles, i.e. many seconds, i.e. many ticks. Not computed exactly nor observed; depends on camera start position.

A second fully traced example with a longer real-time span is in section 7.

---

## 7. Server+client multi-tick pairings in Content

### 7.1 `barmaid.rs2` - the server paces, the client reacts to each packet

`Content/scripts/areas/area_falador/scripts/barmaid.rs2:24-47`:
```abbrev
inv_del(inv, coins, 70);
mes("You buy a Hand of Death cocktail.");
p_delay(2);
stat_sub(attack, 5, 5); ... 
mes("You drink the cocktail.");
p_delay(2);
cam_reset;
cam_shake(0, 0, 15, 2);
mes("You stumble around the room.");
p_delay(3);
mes("The barmaid giggles.");
p_delay(3);
%barcrawl = setbit(%barcrawl, ^risingsun_index);
mes("The barmaid signs your card.");
cam_reset;
~damage_self(...)
```
Server half: the script is a single RuneScript run that is suspended at each `p_delay(n)` and resumed later (`P_DELAY` handler `PlayerOps.ts:376-380` per the open-questions entry; resume order per `docs/tick/05-players-queues-timers.md`; each statement only writes a packet: `mes` → `MESSAGE_GAME`, `inv_del` → `UPDATE_INV_*`, `stat_sub` → `UPDATE_STAT`, `cam_shake` → `CAM_SHAKE`, `cam_reset` → `CAM_RESET`). In ticks: shake starts after 2 + 2 = 4 delayed steps and lasts the following 3 + 3 = 6 ticks (inference from the `p_delay` arguments; actual `p_delay(n)` resumption tick offset is "n+1" in `docs/tick/05` - not re-verified here).
Client half: `CAM_SHAKE(axis 0, random 0, amplitude 15, rate 2)` → stored as `camShakeAxis[0] = 0`, `camShakeRan[0] = 15`, `camShakeAmp[0] = 2`, `camShakeCycle[0] = 0` (`Client.ts:6356-6370`); every cycle `camShakeCycle[0]++` (`:2352-2354`) and every frame `jitter = (random*1 - 0 + sin(cycle * 0.02) * 15) | 0` is added to `camX` (axis 0, `:4211-4218`). The shake stops on the `CAM_RESET` 6 ticks later (`:6391-6396`). Between packets the client runs by itself.

### 7.2 `keg_of_beer.rs2` - the server schedules the end 60 ticks later

`Content/scripts/player/scripts/consumption/effects/scripts/keg_of_beer.rs2:1-11`:
```
anim(viking_keg_drink_full, 0);
...
stat_boost(strength, 2, 10);
stat_drain(attack, 5, 50);
cam_shake(3, 0, 20, 2);
longqueue(cr_queue, 60, 0, ^discard);
```
1. `longqueue` enqueues `[queue,cr_queue]` (body: `cam_reset;`) with delay 60 (`PlayerOps.ts:172-181`).
2. `cam_shake(3, 0, 20, 2)`: axis 3 = yaw (client applies `camYaw = (camYaw + jitter) & 0x7ff` for axis 3, `Client.ts:4223-4224`), `camShakeRan[3] = 20`, `camShakeAmp[3] = 2`.
3. Client: the shake lasts until `CAM_RESET`, i.e. until the queued script runs about 60 ticks later (inference: 60 ticks = 36 s; the queue scheduling semantics from the existing tick notes, not re-verified). During that time the client needs no further packets. Inference (arithmetic): yaw jitter amplitude 20 units out of 2048 per full turn (about 3.5 degrees), oscillation `sin(cycle * 0.02)` with period 2 pi / 0.02 = about 314 cycles = about 6.3 s.
4. The same `stat_boost`/`stat_drain` temporary effects are server-side too; the stats on screen return when the server restores them and sends `UPDATE_STAT` (restore timing is a server timer; not traced).

### 7.3 Dialogue: a server loop that waits for a client click

`[proc,chatnpc]` (`Content/scripts/interface_chat/scripts/chat.rs2:323-334`): `while ($page < $pagetotal) { ~chatnpc_page(...); facesquare(...); npc_setmode(...); p_pausebutton; $page = calc($page + 1); }`. `chatnpc_page` sends `if_setnpchead`, `if_setanim`, `if_settext` ... and `if_openchat($interface)` (`:283-321`).
- Client: `IF_OPENCHAT` calls `ifAnimReset`, sets `chatModalId`, clears `resumedPauseButton` (`Client.ts:5925-5942`); the component with `buttontype=pause` (`Content/scripts/interface_chat/interfaces/npcchat1.if:36`) is `BUTTON_CONTINUE`, offered only while `!resumedPauseButton` (`:9837-9841`); click sends `RESUME_PAUSEBUTTON(c)` and sets the flag (`:9190-9196`), after which the text shows "Please wait..." (`:10105-10108`).
- Server: `P_PAUSEBUTTON` sets the script state to `PAUSEBUTTON` (`PlayerOps.ts:425-427`); `ResumePauseButtonHandler` resumes it only if `activeScript.execution === PAUSEBUTTON` (`Engine-TS/src/network/game/client/handler/ResumePauseButtonHandler.ts:7-14`). Then the loop shows the next page.
- This is a multi-tick, multi-packet conversation whose only "wait" lives on the server. The number of ticks it takes is whatever the player takes to click.

### 7.4 Teleport

`~player_teleport_normal` (`Content/scripts/skill_magic/scripts/spells/teleport.rs2:54-62, 64-76`): `anim(human_castteleport, 0); spotanim_pl(teleport_casting, 92, 0); p_delay(2); ~p_telejump_safe(...)` which does `p_telejump`, `cam_reset`, `anim(null, 0)`. The client plays the cast animation and spot animation over the two ticks (section 5.1, 5.3) and is told to stop by the `anim(null)` (seq 65535) after the jump.

---

## 8. Answers to the sub-questions of the brief

- **Full opcode table 0-20:** section 2.2.
- **Comparator semantics:** section 2.3 (2 = `<`, 3 = `>`, 4 = `!=`, default/1 = `==`; ANDed; no comparators → inactive).
- **State read:** stat arrays, `var[]`, run energy/weight, local player position and combat level, inventories' `linkObj*` arrays, varbit table (2.2).
- **When evaluated:** only at draw time, per component, each draw (2.4); overlay/main modal each frame, side/chat only on redraw flags.
- **Can it keep state or suspend?** No (2.2: local accumulator only, forward-only `pc`, no field writes).
- **Packed examples from `.if`:** section 3 (A-H) with packer rules in 2.6.
- **buttonType/clientCode:** 2.7.
- **Interface animation, entity animation, spot anims, projectiles, loc anims, cameras, hint arrows, flashing tab, minimap flag, chat timers, idle/logout, run energy, sound/music:** section 5.
- **Any packet that runs code:** section 4: no.
- **Server+client pairing:** section 7.

## Is there a client script that spans multiple ticks?

No. Evidence: (1) the only client-side script mechanism, `IfType.scripts`, is evaluated by `getIfVar` as a stateless forward-only accumulator with no field writes, no jumps and no waiting (`Client.ts:10398-10536`), and its boolean result only selects an appearance (`:10365-10396`, call sites in 2.4); (2) the 69 server opcodes contain nothing that executes or installs code, and any unknown opcode makes the client log out (`ServerProt.ts:1-96`; `Client.ts:7133-7135`); (3) the engine never evaluates those expressions (grep, `Component.ts` decode only). Multi-tick behaviour comes from (a) server RuneScript suspension (`p_delay`, `p_pausebutton`, queues, timers) pushing packets on different ticks, and (b) client-local cycle counters (animation frames, camera interpolation/shake, reboot countdown, chat bubble, projectile flight) that a single packet starts and that run at ~30 cycles per tick until their own end or a later packet resets them. The closest thing to "a client-side process spanning several ticks" is the camera (`CAM_MOVETO`/`CAM_LOOKAT` with `rate2 < 100`, and `CAM_SHAKE`) described in sections 5.7 and 6, and the reboot countdown in 5.8; both are compiled TypeScript state machines, not scripts.

## Inferences (collected, labelled)

1. About 30 client cycles per server tick on an on-time client (rests on 1.1-1.2, 1.7).
2. Inactive spell/skill icons remain clickable (rests on the call-site table in 2.4 and `addComponentOptions` not consulting `getIfActive`).
3. A value whose change does not set `redrawSide` is not refreshed in the side panel until some other redraw (rests on 2.4 lists).
4. A walk step takes ~32 cycles at base speed, so the route queue grows and speeds 6/8 catch up (5.2).
5. A `loops = -1` seq ends after one pass (5.1).
6. The `.if` interface data is byte-identical to the original cache when the CRC check passes (`Engine-TS/tools/pack/interface/PackClient.ts:44-47` with `2135735991`, `Engine-TS/src/util/WorldConfig.ts:138` default true), and the Content history records the sources as unpacked ("chore: Unpacked maps, models, configs, interfaces", Content commit `82ff171bb`, via `git log` on `scripts/player/interfaces/stats.if`). So the expressions are original data, written out as text, not written by the Lost City team. This is an inference: the check was not run here, and which `.if` edits happened after the unpack is not diffed (renames, `type=overlay` re-added in `5eb76042e`).
7. Camera shake and `cinemaCam` last indefinitely without a reset (5.7).
8. Yaw shake numbers for the keg (7.2) and timing of the barmaid sequence (7.1) are arithmetic on read constants.

## Not checked / open questions

- **Not run:** nothing was executed; no packet was captured; all timings are from reading code. To resolve: run the client against the server with logging of `Client.loopCycle` at packet receipt and at the end of an `anim`.
- **Packet decoders read only at the places cited:** `PLAYER_INFO`/`NPC_INFO` decoding (`getPlayerPos`, `Client.ts:6409`, `7664-7754, 8069-8085`) is not read; this is open question 14. `entityFace` (`:3695+`), `FACE_ENTITY`/`FACE_COORD` handling and `exactMove` (open question 31) not traced.
- **Draw code not read:** hit marks and health bars (`damageCycles` consumer), hint arrow drawing (`:4601, 4625, 4782` seen via grep only), tab-flash draw (`:4037-4110` grep only), `minimapDraw`, the `TYPE_INV` branch beyond its start. Open question 6 stays partly open: interface drawing, `getIfActive`, entity animation and the timers above are now read; the rest of rendering is not.
- **`IF_TARGET`/`BUTTON_TARGET` flow and `useMode`:** not traced.
- **`RESET_ANIMS`, `LOC_ADD_CHANGE`, `locChangeDoQueue` (`Client.ts:7469`):** not read; the loc-change timers on the client (open question 12/38) remain open.
- **Whether `UPDATE_STAT` for the 25-slot skill array maps `Skill` ids to the `.if` stat names correctly** (`Skill.ts:3` vs `PackShared.ts:110-153`): names compare equal for the 19 used ones; `slayer` has no packer name (see 2.6.2).
- **`Content` `_unpack/274` and the `unpack` tooling:** `Engine-TS/tools/unpack` contains only `checksum.ts`; the tool that wrote the `.if` text files was not found, so how interfaces were unpacked (open question 55) is only supported by the commit message and the pack-time CRC check. To resolve: find the unpack script in the repo history (`git log -S` for `interface` under `Engine-TS/tools`), run `BUILD_VERIFY=true` packing and compare.
- **Is Client-TS a port of the Java client (open question 54)?** `Client-Java` not read. The comment "java tries to report this to the world" at `Client.ts:7133, 7148` and the identically named fields suggest a port, but that is an inference from comments only and is not evidence of semantic equality.
- **Order of camera packets vs `REBUILD_NORMAL` in one tick:** see 5.7; resolve by reading the phases that call `rebuildNormal` (`Player.ts:502, 556`) relative to `processClientsOut`.
- **Queue-versus-suspended-dialogue ordering in the `rantz.rs2` example (section 6 item 1):** whether `cr_queue` runs while the script is parked on `p_pausebutton` was not verified. Resolve with `docs/tick/05-players-queues-timers.md` rules on queue processing while a script is suspended.
- **What `logoutTimer` gates:** `Client.ts:2487` not read.
- **Exact `p_delay(n)` resume tick:** taken from existing notes (open questions 16, 19), not re-verified for the examples in section 7.
- **Content: how many components use `text` and `activetext` with other opcodes in ways not shown;** only the examples listed were read; the opcode histogram in section 3 is a grep, not a parse.
- **Suggested edits to `docs/open-questions.md` (not done, read-only task):** narrow #6 (interface evaluation, entity animation, timers now documented in this draft), narrow #55 (expressions come from the original interface archive per the CRC check and unpack commit; still need the unpack tool), leave #14, #31, #54 open.

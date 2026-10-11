# Skilling tasks 26-40 (relic mode)

**Question this answers:** how were the seven skilling tasks added after the two final bosses, and what keeps them completable with every relic owned?

**Based on:** root `ebe235c` (+ this change), Content `d82f09706` (fork branch `skilling-tasks`), Engine-TS `04db3dc2`. **Method:** read and **run**: `node harness/run.mjs` on Node 24.11.1, full suite 269/269 before rebasing (248 before this work), 237/237 after rebasing onto the Teleport Network commit (Infinite Runes tests removed there); `npx tsc -p harness/tsconfig.json` clean. 

## The tasks

| # | Task | Detected by | Notes |
|---|---|---|---|
| 26 | Mine a coal | `~relic_gathered` -> `~relic_task_obj(coal)` (`mods/relics/scripts/relic_gather.rs2`) | row `relic_task26_coal_obj`; Eternal Vein leaves coal unsmelted (`relic_smelt_ore` returns null) |
| 27 | Smelt a steel bar | `~relic_task_obj(steel_bar)` in `smelting.rs2:222`, or by Eternal Vein (iron ore becomes a steel bar in `relic_gathered`) | furnace menu button `smelting:com_27` |
| 28 | Smith an adamant platebody | new hook in `[proc,smithing_anvil]` (Content smithing.rs2) | needs 5 adamantite bars, Smithing 88 (`smithing.dbrow`) |
| 29 | Smith a rune scimitar | same hook | 2 runite bars, Smithing 90 |
| 30 | Catch a lobster | `~relic_fished` (`raw_lobster`) | Fishing 40 (`rarefish.rs2:23`) |
| 31 | Mine an adamantite ore | `~relic_gathered` | Mining 70 (`mine.dbrow`) |

**Deviation from the brief:** it listed "cook a shark" as a new task, but task 10 is already "Cook a raw shark" (row `relic_task10_shark_obj`). I first added "Catch a shark" as task 32; Calum asked to remove it and keep task 10 (2026-10-11), so there are six new tasks (26-31). Tiers in the rows are all 2 and ignored (`relic_task_try`).

## What changed in the engine of the mode

- `^relic_task_count` is 31 (`relic.constant`). `%relic_tasks_done` is one int varp: 31 tasks use bits 0-30, so **one bit (31) is left** before a second varp is needed. `testbit`/`setbit` are plain `value & (1 << bit)` (`Engine-TS/src/engine/script/handlers/NumberOps.ts:54-67`).
- The "final boss" test in `[queue,relic_task_done]` was `$task >= 24`; it would have made 26-31 owe no offer. It is now `$task = 24 | $task = 25` (`relic_offer.rs2`). Tasks 26-31 owe an offer like 1-23.
- Task menu: rows 26-31 added to `relic_taskmenu.if` (scroll height 358 to 442), `relic_menus.enum`, names in `relic_menus.rs2`, and new pack ids in the Content fork.
- Debug: `::~relic_smith <product>` runs `~smithing_anvil` (the label `attempt_smithing` cannot be called from a debugproc: it reads `last_item`).

## Tests

`tests/relic-skilling-task-flows.ts` defines the tests once and runs them with no relics (`relic-tasks.test.ts`) and with every relic (`relic-all-relics.test.ts`): real coal and adamantite rocks, real furnace menu (steel), the anvil proc (28, 29), the fishing hook (30). The table-row loop in the all-relics file picks up every new row by itself. The all-in-one test had to stop sorting "task >= 24" last (that would have put 26-31 behind the win message box) and compares the full mask as a signed 32-bit value.

## Not checked / open

- The anvil tests call `~smithing_anvil`, not the real interface click (the harness has no inventory-slot button). Fishing tests call the hook, not a real fishing spot (same as tasks 9 and 10).
- No second varp yet: tasks beyond 32 (one bit, 32, is free) need `relic_tasks_done2`. See the proposals thread reply for the fletching, crafting, runecrafting and magic tasks awaiting Calum's pick.

## Extra tasks 32-39 (Calum approved the whole list, 2026-10-11)

| # | Task | Detected by | Level (Content config) |
|---|---|---|---|
| 32 | Make a yew longbow | existing `~relic_task_obj` in `bows.rs2` (stringing), row `yew_longbow` | Fletching 70 (`stringing` dbrow) |
| 33 | Make rune darts | new `~relic_task_obj` in `darts.rs2`, row `rune_dart` | Fletching 81 |
| 34 | Craft a green dragonhide body | new hook in the dragonhide branch of `craft_leather` (`leather.rs2`), row `dragonhide_body` | Crafting 63, 3 dragon leather |
| 35 | Cut a diamond | new hook in `uncut_gem.rs2` (after the crush check), row `diamond` | Crafting 43 |
| 36 | Craft a nature rune | existing hook in `runecraft.rs2` (`~relic_task_obj($rune)`), row `naturerune` | Runecrafting 44, members |
| 37 | Craft a death rune | same, row `deathrune` | Runecrafting 65, members |
| 38 | Cast High Level Alchemy | `~relic_task_spell` after the cast in `alchemy.rs2` (hook task, no row) | Magic 55 |
| 39 | Cast Camelot Teleport | `~relic_task_spell` after `~give_spell_xp` in `teleport.rs2` (hook task, no row) | Magic 45, members |

- **Second varp:** `%relic_tasks_done2` (`relic.varp`, id 372 in `Content/pack/varp.pack`). Tasks 1-31 are bits 0-30 of `%relic_tasks_done`; task N >= 32 is bit N-32 of `%relic_tasks_done2`. `[proc,relic_task_is_done]` and `[proc,relic_task_mark]` (`relic_tasks.rs2`) hide the split; the menu, `relic_task_try` and `[queue,relic_task_done]` use them. `::~relic_reset` and `::~relic_tasks_reset` clear both. Existing characters are unaffected (new perm varp starts at 0).
- Task menu: rows 32-39 (`relic_taskmenu.if`, scroll 442 to 558).
- Tests: `tests/relic-skilling-task-flows.ts` (both worlds): real stringing and dart making, `::~relic_leather` for the dragonhide label (the interface clicks are not driven), real chisel use on a diamond, real spell casts (OPHELDT for alchemy, the Camelot button), table rows for the two runes via the gather hook. Alchemy tests in `relic-skilling.test.ts` preset task 38 as done: finishing it opens a relic offer that would hold their dialogue.
- Not checked: real altar runecrafting for 36 and 37 (the existing hook at `runecraft.rs2:99` is the one task 8 uses; the tests use the gather hook), the dragonhide interface clicks.

## Task 40: reach level 99 in any skill (Calum, 2026-10-11)

- Hook task (no row). `[proc,relic_level99]($level)` in `relic_tasks.rs2` calls `~relic_task_try(40, 4)` when the new level is 99 or more; it is called from `[label,levelup]` in `levelup.rs2` after `~relic_levelup_note` (Content fork, `// relic hook`). Bit 8 of `%relic_tasks_done2`.
- Existing 99s: `[proc,relic_check_99]` checks all 19 base levels and runs from `[proc,relic_on_login]` (after the tutorial check), so a character that already has a 99 gets the task, and an offer, on the next login.
- Rerolls: the count is one per 7 tasks done, so a fully done list (40) gives 5 earned rerolls (7, 14, 21, 28, 35) plus the starting one; the sixth would need 42.
- Menu: `relic_taskmenu:row_40` (scroll 572), enum `relic_task_order` places 40 after task 29. Test default: `tests/helpers.ts` presets bit 8 of `relic_tasks_done2` so bots with a 99 skill do not get an offer mid-test; the tests in `relic-skilling-task-flows.ts` clear it (and spawn with the save, since `relog()` re-applies the defaults).

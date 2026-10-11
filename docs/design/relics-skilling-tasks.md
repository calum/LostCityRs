# Skilling tasks 26-31 (relic mode)

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

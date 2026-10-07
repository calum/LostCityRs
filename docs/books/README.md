# The series: reading order

Four books, meant to be read in this order. Nothing here replaces anything: Book 1 is the tick guide and Book 2 the original history note, both unchanged; Books 3 and 4 build on them.

| Read | Book | Where | What it answers |
|---|---|---|---|
| 1st | **A Short Introduction to the Tick** | [`../guide/a-short-introduction-to-the-tick.md`](../guide/a-short-introduction-to-the-tick.md) | What a tick is, the eleven phases, a player's and an NPC's turn, packets in and out, one worked click, a crib for reading scripts. The vocabulary every later book assumes (`p_delay`, `canAccess`, queues, timers, phase 5). Also an EPUB. |
| 2nd | **Project history**: how Lost City started and how the server was recreated | [`../history/project-origins.md`](../history/project-origins.md) | Who/what is Lost City, when it started, and how a server was recreated when the client cache holds no server logic. (The original note; it stays in `docs/history/`.) |
| 3rd | **An introduction to RuneScript** | [`runescript-intro/README.md`](runescript-intro/README.md) | What the scripting language is, how `.rs2` becomes bytecode the engine runs, how scripts are found, syntax, pointers, commands, three real scripts line by line. |
| 4th | **How multi-tick scripts run** | [`multi-tick-scripts/README.md`](multi-tick-scripts/README.md) | How a script spreads over several ticks (suspension, queues, timers, re-arming loops), eight simple and six complex worked examples, and what the client side does (there is no client script that spans ticks). |

Why this order: the tick guide gives the clock and the vocabulary (the multi-tick book's chapter 4 re-verifies its rules in more detail and extends them, so skipping the guide makes that chapter hard going); the history explains why the scripts exist at all (the cache holds assets only; the team recreated the logic); the RuneScript introduction teaches the language the multi-tick book's examples are written in.

The folder names are creation order, not reading order: `multi-tick-scripts` was written first and says to read `runescript-intro` before it, and both were written after the tick guide. Tick-by-tick engine detail that all three lean on lives in [`../tick/00-overview.md`](../tick/00-overview.md) and its phase notes.

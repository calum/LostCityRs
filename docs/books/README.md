# The series: reading order

Three books, meant to be read in this order. Nothing here replaces anything: the first book is the original history note, unchanged, and the other two build on it.

| Read | Book | Where | What it answers |
|---|---|---|---|
| 1st | **Project history**: how Lost City started and how the server was recreated | [`../history/project-origins.md`](../history/project-origins.md) | Who/what is Lost City, when it started, and how a server was recreated when the client cache holds no server logic. (The original note; it stays in `docs/history/`.) |
| 2nd | **An introduction to RuneScript** | [`runescript-intro/README.md`](runescript-intro/README.md) | What the scripting language is, how `.rs2` becomes bytecode the engine runs, how scripts are found, syntax, pointers, commands, three real scripts line by line. |
| 3rd | **How multi-tick scripts run** | [`multi-tick-scripts/README.md`](multi-tick-scripts/README.md) | How a script spreads over several ticks (suspension, queues, timers, re-arming loops), eight simple and six complex worked examples, and what the client side does (there is no client script that spans ticks). |

Why this order: the history explains why the scripts exist at all (the cache holds assets only; the team recreated the logic); the RuneScript introduction teaches the language the multi-tick book's examples are written in.

The folder names are creation order, not reading order: `multi-tick-scripts` was written first and says to read `runescript-intro` before it. Tick-by-tick engine detail that all three lean on lives in [`../tick/00-overview.md`](../tick/00-overview.md) and its phase notes.

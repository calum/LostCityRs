# Relic menus in the settings tab

**Question this answers:** how do the Tasks and Relics menus work, how are they opened, and what did the real client show?

**Based on:** root `7e34c5b` (+ this note's commit), Content fork `d61913385`, Engine-TS `8c4fa9ca`, Client-TS `a822635`. **Method:** built test-first (`tests/relic-menus.test.ts`, 11 tests; full suite 162 pass), then checked in the real web client with `scripts/headless-client.mjs` (Chromium on Linux, screenshots read by eye).

## What the player sees

The Game Options tab has two orange text buttons at the right of the "Split Private-chat" row, **Tasks** and **Relics** (`Content/scripts/interface_options/interfaces/options.if` and `options_ld.if`, components `relic_tasks`, `relic_relics`; Content commit `d61913385`). Each opens a full-size main interface.

- **Relic Tasks** (`mods/relics/interfaces/relic_taskmenu.if`): "Tasks done: N of 25", a scrolling list of all 25 tasks (`@gre@[x] 1. Defeat a goblin` done, `@whi@[ ] 2. ...` open) and a toggle **Hide completed**. With it on, the done tasks are dropped and the open ones are packed to the top; the choice is stored in the perm varp `relic_hide_done` (`mods/relics/configs/relic.varp`) so it survives relog.
- **Relics** (`relic_relicmenu.if`): XP rate (`8 * 2^tier`, base from `^relic_base_xp` in `relic.constant`, which must match `node.xpRate` in `config/world.json`), the unlocked relics (green) with their effect, the relics not yet unlocked (yellow), and, only when `%relic_pending > 0`, "N relic choices waiting" with a **Choose a relic now** button. The XP Multiplier shows "now 16x" in the unlocked list and "next 32x" in the other until it is maxed.
- Each menu has a link to the other (`Relics >`, `Tasks >`) and the usual Close Window.

## How it works (all in `mods/relics/scripts/relic_menus.rs2` unless noted)

1. Button: `[if_button,options:relic_tasks]` (and the `options_ld:` twins) run `if_close;` then `~relic_taskmenu_open` / `~relic_relicmenu_open`, which call `if_openmain(...)` and fill the rows with `if_settext`. Same shape as `Content/scripts/player/scripts/skill_guide.rs2`: row components come from enums (`mods/relics/configs/relic_menus.enum`, `enum(int, component, relic_task_rows, $row)`), colours are `@gre@`/`@yel@`/`@whi@` tags in the text.
2. The settings tab is an **overlay** interface, so its `[if_button]` scripts run without protected access (`IfButtonHandler.ts`: `executeScript(..., root.overlay == false)`). That is why `relic_hide_done` is `protect=no`; the menus are modal interfaces, whose button scripts do run protected.
3. **Choose a relic now**: `if_close;` then `queue(relic_offer_q, 0, 0)`, the same queue the login hook uses (`relic_offer.rs2`). `relic_offer_pending` answers every pending offer, so closing a dialog and clicking the button gives the same three relics again (the seed is only stored when an offer is answered).
4. `if_sethide` only works on **layers** in this client: `Client-TS/src/client/Client.ts` `IF_SETHIDE` sets `.hide`, and the draw code checks it for `type 0` components only. The first version hid the button directly and the real client still drew it; the button now sits in the layer `choose_box`, which is what the script hides (test `no pending choice hides the choose button`).

## Packing a new interface (what was needed)

- A new `.if` needs ids in `Content/pack/interface.pack` (`id=name`, `id=name:component`) **and** in `Content/pack/interface.order` (interface id, then its components) (`Engine-TS/tools/pack/interface/PackShared.ts`, `packInterface`). `scripts/sync-mods.mjs` now appends these for every `mods/**/interfaces/*.if` (`ensureInterfaceIds`), like it already did for varps and enums. `enum.pack` is gitignored in Content; `varp.pack` and `interface.*` are tracked and the changes were committed with the Content fork commit.
- Adding a component to an **existing** interface (the two buttons in `options.if`) cannot be appended: the new ids must sit inside that interface's group in `interface.order`. Done by hand; the script warns instead of guessing.
- Interfaces are 512x334. The relic list uses font `p11_full` with 12 px rows in two 250 px columns; the longest line (Everlasting Jewellery) ends about 6 px before the second column in the screenshot.

## Checking in the real client

`scripts/headless-client.mjs` clicks in **client pixels** (765x503, relative to the canvas), not screenshot pixels: a screenshot is 1000x700 with the client at offset (118, 83). Clicks with the screenshot's coordinates silently hit nothing. Tutorial Island blocks sidebar tabs and chat is blocked behind open modals, so a throwaway debugproc (not committed) set the tabs and varps. Seen in the client: both buttons open the menus, the toggle hides done tasks and repacks, the `Relics >` link switches menus, **Choose a relic now** closes the menu and shows the offer dialog, and picking updates the lists.

## Not checked

- The low-detail settings tab in the real client (covered by a harness test only).
- Mobile/touch, other browsers, and long-term scrolling behaviour of the task list on a real mouse.
- Whether `^relic_base_xp = 8` matches a player's own `world.json`.
